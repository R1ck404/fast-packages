// The engine's side of esbuild-wasm's Node API (lib/main.js; build.mjs
// bundles this module into it and patches the API to call it), and of the
// command line (bin/esbuild).
//
// esbuild-wasm runs Go in a child process ("node bin/esbuild --service=0.28.2
// --ping") and talks to it over its stdin/stdout. Here the service
// (cmd/esbuild/service.go, src/service.mts) runs in a worker thread instead,
// behind an object with the parts of a ChildProcess that lib/main.js uses
// (spawn): the packets go through postMessage instead of pipes. The worker
// thread has a call stack like Go's (Go's stacks grow up to 1 GB; a
// JavaScript thread's stack is fixed, ~1 MB by default, which limits how
// deeply nested the code esbuild parses and prints can be: see
// SERVICE_STACK_MB). The Go process's surroundings are reproduced: its
// working directory (the one it was started in), its environment (what
// bin/esbuild keeps: NO_COLOR, NODE_PATH, npm_config_user_agent and
// WT_SESSION), its stderr (the process's), and the real file system.
//
// Transforms take a shortcut in this thread (the glue asks transform()
// below first, like in the browser build); a transform the engine cannot
// finish here (its input is nested too deeply for this thread's stack) goes
// to the service.
//
// The *Sync APIs: esbuild-wasm runs transformSync(), formatMessagesSync()
// and analyzeMetafileSync() in a worker thread (their arguments and results
// cross the thread boundary through structured cloning), or, without worker
// threads, as a child process per call (execFileSync). Here they run in this
// thread (the arguments and results are cloned like at a thread boundary:
// acrossWorkerBoundary), and so does the per-call service (execServiceSync),
// except for buildSync() and for calls whose input is nested too deeply for
// this thread's stack: those keep esbuild-wasm's child process, bin/esbuild.
//
// bin/esbuild runs the command line in a worker thread with a large stack
// too (workerMain), or in this thread where there are no worker threads.
//
// The engine comes from __fastEngineFactory (declared next to this code by
// build.mjs), created on first use.

declare const __fastEngineFactory: () => any;

// The stack of the threads that run the service and the command line. Go's
// goroutine stacks grow up to 1 GB (the memory is only used when needed).
const SERVICE_STACK_MB = process.arch === "x64" || process.arch === "arm64" || process.arch === "ppc64" || process.arch === "s390x" || process.arch === "loong64" || process.arch === "riscv64" ? 1024 : 256;

let workerThreads: any = null;
function getWorkerThreads(): any {
  if (workerThreads === null) {
    try {
      workerThreads = require("worker_threads");
    } catch {
      workerThreads = false;
    }
  }
  return workerThreads;
}

let engineInstance: any = null;
export function engine(): any {
  if (engineInstance === null) {
    engineInstance = __fastEngineFactory();
    configureGoProcess();
  }
  return engineInstance;
}

// The Go process of this thread: stderr and stdout are the process's (in a
// worker thread, written directly to the file descriptors like a child
// process's are), the environment is what bin/esbuild passes on
const GO_ENV_VARS = ["NO_COLOR", "NODE_PATH", "npm_config_user_agent", "WT_SESSION"];
function configureGoProcess() {
  const e = engineInstance;
  const wt = getWorkerThreads();
  if (wt && !wt.isMainThread) {
    const fs = require("fs");
    e.setStderrBytes((bytes: Uint8Array) => writeAllSync(fs, 2, bytes));
    e.setStdout((bytes: Uint8Array) => writeAllSync(fs, 1, bytes));
  } else {
    e.setStderrBytes((bytes: Uint8Array) => process.stderr.write(bytes));
    e.setStdout((bytes: Uint8Array) => process.stdout.write(bytes));
    // (this thread's stack is small: input nested too deeply for it goes to
    // the service or the child process, which have large stacks)
    if (wt) e.setPropagateStackOverflow(true);
  }
  const env = new Map<string, string>();
  for (const key of GO_ENV_VARS) {
    const value = process.env[key];
    if (typeof value === "string") env.set(key, value);
  }
  e.setGoEnv(env);
}

function writeAllSync(fs: any, fd: number, bytes: Uint8Array) {
  let offset = 0;
  while (offset < bytes.length) {
    try {
      offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
    } catch (e: any) {
      if (e && e.code === "EAGAIN") continue;
      throw e;
    }
  }
}

// The transform shortcut (build.mjs patch "transform fast path"): the
// response the service would send, or undefined when the engine threw (the
// request then goes to the service)
export function transform(flags: string[], input: string | Uint8Array, mangleCache: any, callback: (response: any) => void): any {
  return engine().fastTransform(flags, input, mangleCache);
}

export const stats = {
  get fast() {
    return engineInstance !== null ? engineInstance.stats.fast : 0;
  },
  get error() {
    return engineInstance !== null ? engineInstance.stats.error : 0;
  },
  get lastError() {
    return engineInstance !== null ? engineInstance.stats.lastError : null;
  },
  get engineIn() {
    return "thread";
  },
};

// Go's report of a panic that ends the process: the panic value, then
// (instead of Go's goroutine trace) the JavaScript stack
function panicText(error: any): string {
  let text: string;
  if (error !== null && typeof error === "object" && error.name === "GoPanic") text = "panic: " + error.value;
  else text = "panic: " + (error !== null && typeof error === "object" && "message" in error ? String(error.message) : String(error));
  const stack = error !== null && typeof error === "object" && typeof error.stack === "string" ? error.stack : "";
  return text + "\n\n" + stack + "\n";
}

function isStackOverflow(error: any): boolean {
  return error instanceof RangeError && /call stack/i.test(error.message);
}

type Listener = (...args: any[]) => void;
class Emitter {
  declare listeners: Map<string, Listener[]>;
  constructor() {
    this.listeners = new Map();
  }
  on(event: string, f: Listener) {
    let list = this.listeners.get(event);
    if (list === undefined) this.listeners.set(event, (list = []));
    list.push(f);
    return this;
  }
  emit(event: string, ...args: any[]) {
    const list = this.listeners.get(event);
    if (list !== undefined) for (const f of list.slice()) f(...args);
  }
}

// A ChildProcess running "esbuild --service=0.28.2 --ping" with its working
// directory at "cwd": child.stdin.write(bytes, callback), child.stdout's
// "data" and "end" events, child.ref() / unref() (a ref'd child keeps the
// Node process alive), child.kill(), and "error" events
export function spawn(cwd: string, fs: any): any {
  const wt = getWorkerThreads();
  if (!wt) return spawnInThread(cwd, fs);
  const stdin: any = new Emitter();
  const stdout: any = new Emitter();
  const child: any = new Emitter();
  let destroyed = false;
  const env: Record<string, string> = {};
  for (const key of GO_ENV_VARS) {
    const value = process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  const worker = new wt.Worker(__filename, {
    workerData: { fastEsbuildService: { cwd, env } },
    resourceLimits: { stackSizeMb: SERVICE_STACK_MB },
    // (like esbuild's own worker thread: no preload scripts)
    execArgv: [],
  });
  worker.on("message", (bytes: Uint8Array) => {
    if (!destroyed) stdout.emit("data", bytes);
  });
  worker.on("error", (error: any) => child.emit("error", error));
  worker.on("exit", () => {
    if (!destroyed) stdout.emit("end");
  });
  stdin.write = (bytes: Uint8Array, callback?: (err: any) => void) => {
    worker.postMessage(bytes);
    if (callback) queueMicrotask(() => callback(null));
    return true;
  };
  stdin.unref = () => {};
  stdin.destroy = () => {};
  stdout.unref = () => {};
  stdout.destroy = () => {
    destroyed = true;
  };
  child.ref = () => worker.ref();
  child.unref = () => worker.unref();
  child.kill = () => {
    worker.terminate();
  };
  child.stdin = stdin;
  child.stdout = stdout;
  return child;
}

// The same without worker threads: the service in this thread
function spawnInThread(cwd: string, fs: any): any {
  const e = engine();
  const stdin: any = new Emitter();
  const stdout: any = new Emitter();
  const child: any = new Emitter();
  let destroyed = false;
  let killed = false;
  let keepAlive: any = null;

  e.setGetwd(() => cwd);
  const service = new e.Service({
    // (the child's stdout reaches the API in a later task)
    output: (bytes: Uint8Array) => {
      queueMicrotask(() => {
        if (!destroyed) stdout.emit("data", bytes);
      });
    },
    hostFS: fs,
    crash: (error: any) => {
      // Go prints the panic and exits with status 2: stdout ends
      process.stderr.write(panicText(error));
      queueMicrotask(() => {
        if (!destroyed) stdout.emit("end");
      });
    },
  });

  stdin.write = (bytes: Uint8Array, callback?: (err: any) => void) => {
    queueMicrotask(() => {
      if (!killed) service.write(bytes);
      if (callback) callback(null);
    });
    return true;
  };
  stdin.unref = () => {};
  stdin.destroy = () => {};
  stdout.unref = () => {};
  stdout.destroy = () => {
    destroyed = true;
  };
  child.ref = () => {
    if (keepAlive === null && !killed) keepAlive = setInterval(() => {}, 0x7fffffff);
  };
  child.unref = () => {
    if (keepAlive !== null) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
  };
  child.kill = () => {
    killed = true;
    child.unref();
    service.close();
  };
  child.stdin = stdin;
  child.stdout = stdout;
  return child;
}

// runServiceSync's execFileSync("node bin/esbuild --service=0.28.2") with
// "stdin" as the input: the output. A build (buildSync without worker
// threads) runs in that child process ("run"); everything else runs in this
// thread, unless its input is nested too deeply for this thread's stack
// (then the child process runs it).
export function execServiceSync(stdin: Uint8Array, cwd: string, fs: any, run: () => Uint8Array, commandLine: string): Uint8Array {
  const e = engine();
  if (requestCommand(stdin) === "build") return run();
  const chunks: Uint8Array[] = [];
  let panic: any = null;
  e.setGetwd(() => cwd);
  const service = new e.Service({
    output: (bytes: Uint8Array) => chunks.push(bytes),
    hostFS: fs,
    crash: (error: any) => {
      panic = error;
    },
  });
  // (what the service prints to stderr waits until it is known whether the
  // child process runs the call instead)
  const printed: Uint8Array[] = [];
  e.setStderrBytes((bytes: Uint8Array) => printed.push(bytes));
  try {
    service.write(stdin);
    service.close();
  } finally {
    configureGoProcess();
  }
  if (panic !== null && isStackOverflow(panic)) return run();
  for (const bytes of printed) process.stderr.write(bytes);
  if (panic !== null) {
    // (execFileSync throws when the child fails: Go exits with status 2
    // after printing the panic to the inherited stderr)
    process.stderr.write(panicText(panic));
    const err: any = new Error("Command failed: " + commandLine);
    err.status = 2;
    err.signal = null;
    err.stdout = Buffer.concat(chunks);
    err.stderr = null;
    throw err;
  }
  return Buffer.concat(chunks);
}

// The "command" of the request packet in "stdin" (a length-prefixed packet
// whose value is a map; the key "command" with a string value)
function requestCommand(stdin: Uint8Array): string | null {
  try {
    const text = Buffer.from(stdin).toString("latin1");
    const i = text.indexOf("\x07\x00\x00\x00command\x03");
    if (i < 0) return null;
    const at = i + 12;
    const n = stdin[at] | (stdin[at + 1] << 8) | (stdin[at + 2] << 16) | (stdin[at + 3] << 24);
    return text.slice(at + 4, at + 4 + n);
  } catch {
    return null;
  }
}

// What crossing a worker thread boundary does to the arguments of a *Sync
// call (postMessage clones them, and throws for what cannot be cloned) and
// to its result or error (cloned back; the error's own enumerable properties
// are copied onto the clone)
export function acrossWorkerBoundary(args: any[], call: (args: any[]) => any): any {
  const clonedArgs = structuredClone(args);
  let result: any;
  try {
    result = call(clonedArgs);
  } catch (reject) {
    const properties: any = {};
    if (reject && typeof reject === "object") {
      for (const key in reject) properties[key] = (reject as any)[key];
    }
    const cloned = structuredClone({ reject, properties });
    for (const key in cloned.properties) cloned.reject[key] = cloned.properties[key];
    throw cloned.reject;
  }
  return structuredClone(result);
}

// ---------------------------------------------------------------------------
// The command line (bin/esbuild) and the threads lib/main.js starts itself in

// The CLI host of this thread
function cliHost(): any {
  return {
    fs: require("fs"),
    stdin: process.stdin,
    exit: (code: number) => {
      process.exitCode = code;
    },
    exitNow: (code: number) => process.exit(code),
    panic: (error: any) => {
      writeAllSync(require("fs"), 2, Buffer.from(panicText(error)));
      process.exit(2);
    },
    keepAlive: () => {
      setInterval(() => {}, 0x7fffffff);
    },
  };
}

// bin/esbuild: esbuild's cmd/esbuild main() with these arguments, in a worker
// thread with a large stack (see SERVICE_STACK_MB) whose stdin is this
// process's; the exit code becomes this process's
export function main(args: string[]) {
  const wt = getWorkerThreads();
  if (!wt) {
    engine().runMain(args, cliHost());
    return;
  }
  const worker = new wt.Worker(__filename, {
    workerData: { fastEsbuildCLI: { args } },
    resourceLimits: { stackSizeMb: SERVICE_STACK_MB },
    execArgv: [],
    stdin: true,
  });
  // (stdin is read when the command line reads it: when it listens)
  let piping = false;
  worker.on("message", (message: any) => {
    if (message === "stdin" && !piping) {
      piping = true;
      process.stdin.pipe(worker.stdin);
    }
  });
  worker.on("error", (error: any) => {
    process.stderr.write(panicText(error));
    process.exitCode = 2;
  });
  worker.on("exit", (code: number) => {
    if (process.exitCode === undefined) process.exitCode = code;
    if (piping) {
      process.stdin.unpipe(worker.stdin);
      process.stdin.destroy();
    }
  });
}

// lib/main.js, loaded in a thread it started itself: the service (spawn) or
// the command line (main)
export function workerMain() {
  const wt = getWorkerThreads();
  if (!wt || wt.isMainThread || wt.workerData === null || typeof wt.workerData !== "object") return;
  const data = wt.workerData;
  if (data.fastEsbuildService) {
    const e = engine();
    const cwd: string = data.fastEsbuildService.cwd;
    const env = new Map<string, string>();
    for (const key of Object.keys(data.fastEsbuildService.env)) env.set(key, data.fastEsbuildService.env[key]);
    e.setGoEnv(env);
    e.setGetwd(() => cwd);
    const fs = require("fs");
    const service = new e.Service({
      output: (bytes: Uint8Array) => wt.parentPort.postMessage(bytes),
      hostFS: fs,
      crash: (error: any) => {
        // Go prints the panic and exits with status 2
        writeAllSync(fs, 2, Buffer.from(panicText(error)));
        process.exit(2);
      },
    });
    wt.parentPort.on("message", (bytes: Uint8Array) => service.write(bytes));
    return;
  }
  if (data.fastEsbuildCLI) {
    const host = cliHost();
    // (stdin comes from the main thread once the command line listens)
    const stdin = process.stdin;
    let asked = false;
    host.stdin = {
      on(event: string, f: any) {
        if (!asked) {
          asked = true;
          wt.parentPort.postMessage("stdin");
        }
        stdin.on(event, f);
        return this;
      },
    };
    engine().runMain(data.fastEsbuildCLI.args, host);
  }
}
