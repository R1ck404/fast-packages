// The engine's side of esbuild-wasm's browser glue (build.mjs bundles this
// module into lib/browser*.js and esm/browser*.js and patches the glue to
// call it). There is no Go binary: esbuild's service (cmd/esbuild/service.go,
// src/service.mts) runs in the page, and the glue talks to it with the same
// packets it would send to Go (start below).
//
// Transforms take a shortcut (the glue asks transform() below first): the
// engine returns the response Go would send for the request, without
// encoding packets, and where it runs depends on the "worker" option:
//
//   worker: false  the engine runs in the calling thread, like Go does
//   worker: true   (the default) the engine runs in a worker of its own:
//                  the page posts the transform request (the flags esbuild's
//                  glue made and the input) to it and the engine answers with
//                  the response packet. The engine's worker starts in
//                  initialize() and warms the engine up. If it cannot be
//                  started or fails, the engine runs in the page.
//                  Inputs up to SMALL_INPUT run in the page until the
//                  engine's worker has started and warmed up (~40 ms after
//                  initialize(); a first small transform in the page takes
//                  ~15 ms), and again once the page's engine has warmed up
//                  in idle time: the trip to a worker and back costs ~50 us
//                  plus ~2 us per KB in Chromium, which is 40% of a 1.6 KB
//                  transform and 7% of an 80 KB one, while a 64 KB transform
//                  keeps the page busy for ~2.5 ms at most (a large one: tens
//                  of ms).
//
// Everything else (build(), context(), formatMessages(), analyzeMetafile())
// goes to the service in the page. Its file system is esbuild-wasm's: none
// (every call fails like Go's ENOSYS stub), or, with worker: false and a
// "globalThis.fs" with Node's synchronous API, that one.
//
// __fastEngineFactory (a function returning the engine, src/engine.mts) is
// declared next to this code by build.mjs.

declare const __fastEngineFactory: () => Engine;

interface Stats {
  fast: number;
  error: number;
  lastError: any;
}
interface ServiceInstance {
  write(bytes: Uint8Array): void;
  close(): void;
}
interface Engine {
  fastTransform(flags: string[], input: string | Uint8Array, mangleCache: any): any;
  stats: Stats;
  warmup(step: number): boolean;
  Service: new (host: { output(bytes: Uint8Array): void; hostFS: any; crash(error: any): void }) => ServiceInstance;
}

// Inputs up to this many characters (bytes for a Uint8Array) run in the page
// in worker mode, once the page's engine is warm. (Tests can change it with
// globalThis.__FAST_ESBUILD_SMALL_INPUT__ before initialize(): -1 sends every
// transform to the worker.)
const SMALL_INPUT = 64 * 1024;
let smallInput = SMALL_INPUT;

let threadEngine: Engine | null = null;
function engine(): Engine {
  return threadEngine || (threadEngine = __fastEngineFactory());
}

// ---------------------------------------------------------------------------
// Statistics: the sum of the page's engine and the worker's engine

let workerStats: Stats | null = null; // (the worker's, as of its last fallback, plus fast transforms since)
let lastFallbackFrom: "thread" | "worker" | null = null;

function sum(key: "fast" | "error"): number {
  return (threadEngine !== null ? threadEngine.stats[key] : 0) + (workerStats !== null ? workerStats[key] : 0);
}
function lastFallbackStats(): Stats | null {
  if (lastFallbackFrom === "thread") return threadEngine !== null ? threadEngine.stats : null;
  if (lastFallbackFrom === "worker") return workerStats;
  return null;
}

// esbuild[Symbol.for("@r1ck404/fast-esbuild-wasm:stats")]
export const stats = {
  // Transforms the shortcut answered, and the ones it passed on to the
  // service because the engine threw ("error": a Go panic, which the service
  // then reports like esbuild, or a bug in the port)
  get fast() {
    return sum("fast");
  },
  get error() {
    return sum("error");
  },
  // The exception of the most recent pass-on caused by a bug in the port
  // (from the worker: {message, stack})
  get lastError() {
    const s = lastFallbackStats();
    return s !== null ? s.lastError : null;
  },
  // Where transforms run: "worker" (the engine's worker, small inputs in
  // the page once smallInThread is true), "thread" (worker: false, or the
  // engine's worker could not be used), or null before initialize()
  get engineIn() {
    return engineWorker !== null || workerPending !== null ? "worker" : mode === null ? null : "thread";
  },
  get smallInThread() {
    return (engineWorker !== null || workerPending !== null) && smallInput >= 0 && (threadWarm || !workerWarm);
  },
  // The file system of the service: "none" (esbuild-wasm's ENOSYS stub),
  // "globalThis.fs" or "node" (node.mjs), null before initialize()
  get fs() {
    return mode === null ? null : serviceHostFS === null ? "none" : nodeHost !== null ? "node" : "globalThis.fs";
  },
};

// ---------------------------------------------------------------------------
// The page

let mode: "thread" | "worker" | null = null;
let engineWorker: Worker | null = null;
let nextRequest = 0;
let pending = new Map<number, (response: any) => void>();
let workerWarm = false; // (the engine's worker has warmed up)
let service: ServiceInstance | null = null;
let workerPending: (() => void) | null = null; // (creates the engine's worker)
function ensureWorker() {
  const create = workerPending;
  workerPending = null;
  if (create !== null) create();
}
let currentSession: object | null = null; // (the started service's, until stop)
let serviceHostFS: any = null;

// node.mjs (this build in Node): the real file system (Node's fs module)
// and the process's working directory as the default "absWorkingDir"
// instead of esbuild-wasm's "/"; no Go binary to locate (there is no
// "location" in Node)
let nodeHost: { fs: any; cwd: string } | null = null;
export function setNodeHost(host: { fs: any; cwd: string } | null) {
  nodeHost = host;
}
export function defaultWD(): string {
  return nodeHost !== null ? nodeHost.cwd : "/";
}

// initialize() of the glue: (as in esbuild-wasm) the URL of the Go binary is
// resolved, which may throw
export function resolveWasmURL(wasmURL: string, wasmModule: any) {
  if (!wasmModule && nodeHost === null) new URL(wasmURL, location.href).toString();
}

// Called when the glue starts the service (initialize). "read" gets the
// service's output (Go's stdout), "rejectAll" is esbuild-wasm's in-thread
// failure handler. Returns the service's stdin. (initialize() does not wait
// for the engine: it is created in a task of its own right after, or by the
// first request if that comes first.)
export function start(useWorker: boolean, read: (bytes: Uint8Array) => void, rejectAll: (error: any) => void): { write(bytes: Uint8Array): void } {
  stop();
  mode = useWorker ? "worker" : "thread";
  const small = (globalThis as any).__FAST_ESBUILD_SMALL_INPUT__;
  smallInput = typeof small === "number" ? small : SMALL_INPUT;
  workerWarm = false;

  // The service. Its file system is the one Go uses: in a worker the stub,
  // in this thread globalThis.fs (when it is a real one)
  serviceHostFS = nodeHost !== null ? nodeHost.fs : useWorker ? null : detectHostFS();
  let crashed = false;
  const session = {};
  currentSession = session;
  let s: ServiceInstance | null = null;
  const theService = (): ServiceInstance => {
    if (s === null) {
      s = new (engine().Service)({
        // (Go's stdout reaches the page in a later task; the service runs
        // after the caller's stack unwinds too, see write below)
        output: (bytes) => queueMicrotask(() => {
          if (currentSession === session) read(bytes);
        }),
        hostFS: serviceHostFS,
        crash: (error) => {
          // A panic ends Go's program: it prints the panic, and the requests
          // made from then on fail (in this thread) or get no response (in a
          // worker)
          crashed = true;
          printPanic(error);
        },
      });
      service = s;
    }
    return s;
  };
  const stdin = {
    write(bytes: Uint8Array) {
      if (currentSession !== session) return;
      if (crashed) {
        if (!useWorker) queueMicrotask(() => rejectAll(new Error("Go program has already exited")));
        return;
      }
      queueMicrotask(() => {
        if (currentSession === session && !crashed) theService().write(bytes);
      });
    },
  };
  // (the engine and the service, in the background)
  setTimeout(() => {
    if (currentSession === session) theService();
  }, 0);

  if (!useWorker) {
    // In this thread: run the first (small) warm-up step soon after
    // initialize(), when this thread is often idle. (The first transform
    // compiles the rest.)
    setTimeout(() => warmupNow(1), 0);
    return stdin;
  }
  // (the engine's worker is created in a task of its own right after
  // initialize(), or by the first transform if that comes first)
  workerPending = () => {
    try {
      const source = "self.__fastEngineFactory = (" + __fastEngineFactory.toString() + ");\n(" + engineWorkerMain.toString() + ")();\n";
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      const w = new Worker(url);
      w.onmessage = ({ data }) => {
        // (the first message says that the worker has read its code)
        if (data.ready) {
          URL.revokeObjectURL(url);
          if (smallInput >= 0 && !threadWarm) warmThreadWhenIdle();
        } else if (data.warm) {
          if (engineWorker === w) workerWarm = true;
        } else onWorkerMessage(w, data);
      };
      w.onerror = () => useThread(w);
      engineWorker = w;
    } catch {
      engineWorker = null;
    }
  };
  setTimeout(ensureWorker, 0);
  return stdin;
}

// Go's report of a panic on stderr (esbuild-wasm prints it with
// console.log): the panic value, then (instead of Go's goroutine trace) the
// JavaScript stack
function printPanic(error: any) {
  let text: string;
  if (error !== null && typeof error === "object" && error.name === "GoPanic") text = "panic: " + error.value;
  else text = "panic: " + (error !== null && typeof error === "object" && "message" in error ? String(error.message) : String(error));
  const stack = error !== null && typeof error === "object" && typeof error.stack === "string" ? error.stack : "";
  console.log(text + "\n\n" + stack);
}

// Called when the glue stops the service (stop)
export function stop() {
  currentSession = null;
  workerPending = null;
  if (service !== null) {
    service.close();
    service = null;
  }
  if (engineWorker !== null) {
    engineWorker.terminate();
    useThread(engineWorker);
  }
  mode = null;
}

// The engine's worker failed: transforms run in the page from now on, the
// requests it did not answer go to the service
function useThread(w: Worker) {
  if (engineWorker !== w) return;
  engineWorker = null;
  const callbacks = pending;
  pending = new Map();
  for (const callback of callbacks.values()) callback(undefined);
}

// A reply: [id, response] for a fast transform (the page counts those
// itself), [id, undefined, stats] when the engine threw
function onWorkerMessage(w: Worker, data: any) {
  if (engineWorker !== w) return;
  const response = data[1];
  if (response !== undefined) {
    if (workerStats === null) workerStats = { fast: 0, error: 0, lastError: null };
    workerStats.fast++;
  } else {
    const stats = data[2];
    const prev = workerStats;
    workerStats = stats;
    if (stats.error > (prev === null ? 0 : prev.error)) lastFallbackFrom = "worker";
  }
  const callback = pending.get(data[0]);
  if (callback !== undefined) {
    pending.delete(data[0]);
    callback(response);
  }
}

// Requests made in the same task go to the worker in one message
let outbox: any[] | null = null;
function flush() {
  const batch = outbox;
  outbox = null;
  if (engineWorker !== null) engineWorker.postMessage(batch);
}

// The transform hook. Returns the Go service's response packet for a
// "transform" request, undefined when the engine threw (then the request
// goes to the service), or null when the request went to the engine's
// worker, which answers through "callback" (with undefined when the engine
// threw).
export function transform(flags: string[], input: string | Uint8Array, mangleCache: any, callback: (response: any) => void): any {
  ensureWorker();
  if (engineWorker !== null && !((threadWarm || !workerWarm) && input.length <= smallInput)) {
    const id = nextRequest++;
    pending.set(id, callback);
    if (outbox === null) {
      outbox = [];
      queueMicrotask(flush);
    }
    outbox.push(id, flags, input, mangleCache);
    return null;
  }
  const e = engine();
  const before = e.stats.error;
  const response = e.fastTransform(flags, input, mangleCache);
  if (e.stats.error !== before) lastFallbackFrom = "thread";
  return response;
}

// Runs the first "steps" warm-up steps in this thread (synchronously) that
// have not run yet
let warmupStep = 0;
export function warmupNow(steps: number) {
  while (warmupStep < steps) {
    const more = engine().warmup(warmupStep++);
    if (!more) break;
  }
}

// Worker mode: warms the page's engine up. The first (small) step runs when
// the engine's worker is running (starting a worker needs the page's thread
// in Chromium; unless a small transform already ran in the page meanwhile,
// this compiles the paths every transform takes), and small inputs run in
// the page from then on. The other steps run one at a time when the page is
// idle (requestIdleCallback) and no transform is waiting for the worker. (A
// step takes a few ms to tens of ms while the engine is cold.)
let threadWarm = false;
function warmThreadWhenIdle() {
  const ric = (globalThis as any).requestIdleCallback;
  const schedule = (f: (deadline?: any) => void) => (typeof ric === "function" ? ric(f) : setTimeout(f, 20));
  const step = (deadline?: any) => {
    if (mode !== "worker" || engineWorker === null) return;
    if (pending.size > 0 || outbox !== null || (deadline !== undefined && deadline.timeRemaining() < 15)) {
      schedule(step);
      return;
    }
    if (engine().warmup(warmupStep++)) schedule(step);
  };
  setTimeout(() => {
    if (mode !== "worker" || engineWorker === null) return;
    if (warmupStep === 0) engine().warmup(warmupStep++);
    threadWarm = true;
    schedule(step);
  }, 0);
}

// ---------------------------------------------------------------------------
// The engine's worker. This function runs from its source text, after
// "self.__fastEngineFactory" has been defined: it must not refer to anything
// outside of itself.

function engineWorkerMain() {
  const self_ = self as any;
  postMessage({ ready: true });
  const engine = self_.__fastEngineFactory() as Engine;

  // Warm up one step per task, so that requests are answered in between
  let step = 0;
  // (the page runs small inputs itself until the first step is done)
  const warmup = () => {
    const more = engine.warmup(step++);
    if (step === 1) postMessage({ warm: true });
    if (more) setTimeout(warmup, 0);
  };
  setTimeout(warmup, 0);

  const statsCopy = (s: Stats) => ({
    fast: s.fast,
    error: s.error,
    lastError: s.lastError === null ? null : { message: String(s.lastError && s.lastError.message), stack: String(s.lastError && s.lastError.stack) },
  });

  // A batch of requests: [id, flags, input, mangleCache, id, ...]. Each is
  // answered as soon as it is done.
  self_.onmessage = ({ data }: MessageEvent) => {
    for (let i = 0; i < data.length; i += 4) {
      const response = engine.fastTransform(data[i + 1], data[i + 2], data[i + 3]);
      postMessage(response !== undefined ? [data[i], response] : [data[i], undefined, statsCopy(engine.stats)]);
    }
  };
}

// The file system Go uses in this thread (worker: false): esbuild-wasm's
// stub, where every call fails (null), or a real one (Node's fs, with sync
// APIs). Anything else is treated like the stub.
function detectHostFS(): any {
  const fs = (globalThis as any).fs;
  if (fs === undefined || fs === null) return null;
  const needed = ["readdirSync", "statSync", "lstatSync", "fstatSync", "readFileSync", "readlinkSync", "openSync", "readSync", "closeSync"];
  if (needed.every((name) => typeof fs[name] === "function")) return fs;
  return null;
}
