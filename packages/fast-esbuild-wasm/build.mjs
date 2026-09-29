// Builds @r1ck404/fast-esbuild-wasm from the official esbuild-wasm 0.28.2 package
// (node_modules), with the same file layout minus the Go binary:
//
//   lib/browser.js, lib/browser.min.js, esm/browser.js, esm/browser.min.js
//       = esbuild-wasm's browser builds with small patches + the engine
//         (src/engine.mjs: esbuild's pipeline and its service, ported to
//         JavaScript) and its glue (src/glue.mjs) bundled in (the .min files
//         are the patched builds minified)
//   lib/main.js
//       = esbuild-wasm's Node API with small patches + the engine and its
//         Node host (src/node_host.mjs)
//   bin/esbuild
//       = the command line (esbuild's cmd/esbuild, in the engine), on top of
//         lib/main.js
//   *.d.ts, LICENSE.md
//       = copied unchanged
//
// There is no esbuild.wasm, wasm_exec.js or wasm_exec_node.js: nothing runs
// Go. Everything esbuild's JavaScript API sends to Go's service goes to the
// engine's service (src/service.mts, a port of cmd/esbuild/service.go), in
// the same packets, and comes back the same way.
//
// Patches to the browser glue (everything else is untouched, so option
// validation, flag generation, result shaping and every other API behave
// identically):
//   1. transform(): before sending a "transform" request to the service, ask
//      the engine (src/glue.mjs: in the calling thread with worker: false, in
//      a worker of its own otherwise); it returns the exact response packet
//      the service would send, which then flows through the same
//      response-handling code. (A synchronous call sends its request to the
//      service, which answers it synchronously, like before.)
//   2. initialize(): validates its options and resolves the wasm URL as
//      before, then starts the service in this thread (src/glue.mjs, start)
//      instead of loading the Go binary into esbuild's worker (or its
//      in-thread stand-in); what the glue writes to Go's stdin goes to the
//      service, the service's output to the glue. stop() stops it.
// Patches to the Node API (lib/main.js):
//   1. the same transform shortcut, in this thread;
//   3. the service's child process ("node bin/esbuild --service=... --ping")
//      becomes the in-process service behind a ChildProcess-like object
//      (src/node_host.mjs, spawn);
//   4. the one-shot service of runServiceSync (execFileSync of bin/esbuild)
//      runs in this thread (execServiceSync); only a buildSync() without
//      worker threads (the service builds asynchronously) still runs
//      bin/esbuild, which is this package's command line;
//   5. transformSync(), formatMessagesSync() and analyzeMetafileSync() run in
//      this thread instead of esbuild's worker thread (acrossWorkerBoundary
//      clones their arguments and results like the thread boundary did).
// Fast-path statistics (for tests and benchmarks) are a non-enumerable
// property of the module object: esbuild[Symbol.for("@r1ck404/fast-esbuild-wasm:stats")].
//
// The engine: src/engine.mjs bundled into a function expression
// ("__fastEngineFactory", which returns the engine), with
//   - the runtime AST snapshot (src/snapshot.mjs) baked in, so the first
//     transform does not parse esbuild's runtime helpers,
//   - parentheses around the function, which make V8 compile it while the
//     script loads (a lazily compiled function would be pre-parsed then and
//     parsed again on the first transform, ~20 ms). The browser's engine
//     worker gets the engine from its source text (Function.prototype.toString).
//
// usage: node packages/fast-esbuild-wasm/build.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { genDeep } from "./tools/gen-deep.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuildWasmDir = dirname(require.resolve("esbuild-wasm/package.json"));
const STATS = `Symbol.for("@r1ck404/fast-esbuild-wasm:stats")`;
const NODE = `Symbol.for("@r1ck404/fast-esbuild-wasm:node")`;
const FACTORY_PLACEHOLDER = "__FAST_ENGINE_FACTORY_PLACEHOLDER__";

function patch(text, from, to, what) {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + 1) >= 0) throw new Error(`patch "${what}" did not match exactly once`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

// Replaces the text from "from" up to and including "to"
function patchRange(text, from, to, replacement, what) {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + 1) >= 0) throw new Error(`patch "${what}" did not match exactly once (start)`);
  const j = text.indexOf(to, i + from.length);
  if (j < 0) throw new Error(`patch "${what}" did not match (end)`);
  return text.slice(0, i) + replacement + text.slice(j + to.length);
}

// 1. The transform shortcut ("host" is __fastGlue or __fastNode). The request
// is only built (and the input encoded) when it goes to the service.
function patchTransform(glue, host) {
  return patch(
    glue,
    `        let request = {
          command: "transform",
          flags,
          inputFS: inputPath !== null,
          input: inputPath !== null ? encodeUTF8(inputPath) : typeof input === "string" ? encodeUTF8(input) : input
        };
        if (mangleCache) request.mangleCache = mangleCache;
        sendRequest(refs, request, (error, response) => {`,
    `        let makeRequest = () => {
          let request = {
            command: "transform",
            flags,
            inputFS: inputPath !== null,
            input: inputPath !== null ? encodeUTF8(inputPath) : typeof input === "string" ? encodeUTF8(input) : input
          };
          if (mangleCache) request.mangleCache = mangleCache;
          return request;
        };
        ((cb) => {
          let fastResponse = inputPath === null && !streamIn.isSync ? ${host}.transform(flags, input, mangleCache, (r) => r !== void 0 ? (r.error ? cb(r.error, {}) : cb(null, r)) : sendRequest(refs, makeRequest(), cb)) : void 0;
          if (fastResponse === void 0) sendRequest(refs, makeRequest(), cb);
          else if (fastResponse !== null) {
            queueMicrotask(() => fastResponse.error ? cb(fastResponse.error, {}) : cb(null, fastResponse));
          }
        })((error, response) => {`,
    "transform fast path",
  );
}

function patchBrowserGlue(glue) {
  glue = patchTransform(glue, "__fastGlue");

  // 1b. Two options of initialize() (worker mode): "serviceInWorker" and "smallInput" (src/glue.mts)
  glue = patch(
    glue,
    `  let worker = getFlag(options, keys, "worker", mustBeBoolean);
  checkForInvalidFlags(options, keys, "in initialize() call");
  return {
    wasmURL,
    wasmModule,
    worker
  };`,
    `  let worker = getFlag(options, keys, "worker", mustBeBoolean);
  let serviceInWorker = getFlag(options, keys, "serviceInWorker", mustBeBoolean);
  let smallInput = getFlag(options, keys, "smallInput", mustBeInteger);
  checkForInvalidFlags(options, keys, "in initialize() call");
  return {
    wasmURL,
    wasmModule,
    worker,
    serviceInWorker,
    smallInput
  };`,
    "initialize options",
  );
  glue = patch(
    glue,
    `  initializePromise = startRunningService(wasmURL || "", wasmModule, useWorker);`,
    `  __fastGlue.setOptions(options);
  initializePromise = startRunningService(wasmURL || "", wasmModule, useWorker);`,
    "initialize hand-over",
  );

  // 2. The service in this thread instead of Go (lib/browser.js uses a
  // generator for async functions)
  const head = glue.includes(`var startRunningService = async (wasmURL, wasmModule, useWorker) => {\n`)
    ? `var startRunningService = async (wasmURL, wasmModule, useWorker) => {\n`
    : `var startRunningService = (wasmURL, wasmModule, useWorker) => __async(null, null, function* () {\n`;
  glue = patchRange(
    glue,
    head,
    `  stopService = () => {\n    worker.terminate();\n`,
    head +
      `  let rejectAllWith;
  const rejectAllPromise = new Promise((resolve) => rejectAllWith = resolve);
  __fastGlue.resolveWasmURL(wasmURL, wasmModule);
  let { readFromStdout, service } = createChannel({
    writeToStdin(bytes) {
      stdin.write(bytes);
    },
    isSync: false,
    hasFS: false,
    esbuild: browser_exports
  });
  let stdin = __fastGlue.start(useWorker, (data) => readFromStdout(data), (error) => rejectAllWith(error));
  stopService = () => {
    __fastGlue.stop();
`,
    "service",
  );
  // (node.mjs: the process's working directory)
  if (glue.split(`        defaultWD: "/",
`).length !== 3) throw new Error(`patch "defaultWD" did not match exactly twice`);
  glue = glue.split(`        defaultWD: "/",
`).join(`        defaultWD: __fastGlue.defaultWD(),
`);
  return glue;
}

function patchNodeMain(main, decls) {
  main = patch(main, `"use strict";\n`, `"use strict";\n` + decls, "engine injection (main)");
  main = patchTransform(main, "__fastNode");

  // 3. The service's child process
  main = patch(
    main,
    `  let child = child_process.spawn(command, args.concat(\`--service=\${"0.28.2"}\`, "--ping"), {
    windowsHide: true,
    stdio: ["pipe", "pipe", "inherit"],
    cwd: defaultWD
  });`,
    `  let child = __fastNode.spawn(defaultWD, fs2);`,
    "in-process service",
  );

  // 4. runServiceSync's child process
  main = patch(
    main,
    `  let stdout = child_process.execFileSync(command, args.concat(\`--service=\${"0.28.2"}\`), {
    cwd: defaultWD,
    windowsHide: true,
    input: stdin,
    // We don't know how large the output could be. If it's too large, the
    // command will fail with ENOBUFS. Reserve 16mb for now since that feels
    // like it should be enough. Also allow overriding this with an environment
    // variable.
    maxBuffer: +process.env.ESBUILD_MAX_BUFFER || 16 * 1024 * 1024
  });`,
    `  let stdout = __fastNode.execServiceSync(stdin, defaultWD, fs2, () => child_process.execFileSync(command, args.concat(\`--service=\${"0.28.2"}\`), {
    cwd: defaultWD,
    windowsHide: true,
    input: stdin,
    // We don't know how large the output could be. If it's too large, the
    // command will fail with ENOBUFS. Reserve 16mb for now since that feels
    // like it should be enough. Also allow overriding this with an environment
    // variable.
    maxBuffer: +process.env.ESBUILD_MAX_BUFFER || 16 * 1024 * 1024
  }), [command, ...args, \`--service=\${"0.28.2"}\`].join(" "));`,
    "sync service",
  );

  // 5. The synchronous calls in this thread
  // (esbuild-wasm runs these in its worker thread by calling the async API
  // there, so their messages name the async call: "callName")
  for (const [name, call, args, asyncName] of [
    ["transformSync", "transformSync(input, options)", "input, options", "transform"],
    ["formatMessagesSync", "formatMessagesSync(messages, options)", "messages, options", "formatMessages"],
    ["analyzeMetafileSync", "analyzeMetafileSync(metafile, options)", "metafile, options", "analyzeMetafile"],
  ]) {
    main = patch(
      main,
      `var ${name} = (${args}) => {
  if (worker_threads && !isInternalWorkerThread) {
    if (!workerThreadService) workerThreadService = startWorkerThreadService(worker_threads);
    return workerThreadService.${call};
  }
`,
      `var ${name} = (${args}) => {
  if (worker_threads && !isInternalWorkerThread) {
    return __fastNode.acrossWorkerBoundary([${args}], ([${args}]) => ${name}InThread(${args}, "${asyncName}"));
  }
  return ${name}InThread(${args}, "${name}");
};
var ${name}InThread = (${args}, callName) => {
`,
      name,
    );
    const at = main.indexOf(`var ${name}InThread = `);
    const callNameAt = main.indexOf(`callName: "${name}",`, at);
    if (at < 0 || callNameAt < 0 || callNameAt - at > 400) throw new Error(`callName of ${name} not found`);
    main = main.slice(0, callNameAt) + "callName," + main.slice(callNameAt + `callName: "${name}",`.length);
  }

  // The threads lib/main.js starts itself in (the service, bin/esbuild)
  main = patch(main, `var node_default = node_exports;
`, `var node_default = node_exports;
__fastNode.workerMain();
`, "worker threads");

  // Statistics, and the engine for bin/esbuild
  main = patch(
    main,
    `module.exports = __toCommonJS(node_exports);`,
    `module.exports = Object.defineProperties(__toCommonJS(node_exports), { [${STATS}]: { value: __fastNode.stats }, [${NODE}]: { value: { engine: __fastNode.engine, main: __fastNode.main } } });`,
    "stats (main)",
  );
  return main;
}

// Declarations at the top of the glue: the engine factory (a placeholder,
// replaced after minification) and the glue module
function engineDecls(glueCode) {
  return `var __fastEngineFactory = ${FACTORY_PLACEHOLDER};\n${glueCode}\n`;
}

// lib/browser.js: a UMD wrapper; the engine goes at the top of its body
function buildLib(glue, decls) {
  let out = patchBrowserGlue(glue);
  const marker = `(module=>{\n"use strict";\n`;
  if (!out.startsWith(marker)) throw new Error("unexpected lib/browser.js prologue");
  out = patch(out, marker, marker + decls, "engine injection (lib)");
  return patch(
    out,
    `module.exports = __toCommonJS(browser_exports);`,
    `module.exports = Object.defineProperties(__toCommonJS(browser_exports), { [${STATS}]: { value: __fastGlue.stats }, [${NODE}]: { value: { warmup: __fastGlue.warmupNow, setNodeHost: __fastGlue.setNodeHost, initialized: () => initializePromise !== void 0 } } });`,
    "stats (lib)",
  );
}

// esm/browser.js: an ES module; the engine goes at the top
function buildEsm(glue, decls) {
  let out = decls + patchBrowserGlue(glue);
  return patch(
    out,
    `var browser_default = browser_exports;`,
    `Object.defineProperties(browser_exports, { [${STATS}]: { value: __fastGlue.stats }, [${NODE}]: { value: { warmup: __fastGlue.warmupNow, setNodeHost: __fastGlue.setNodeHost, initialized: () => initializePromise !== void 0 } } });\nvar browser_default = browser_exports;`,
    "stats (esm)",
  );
}

// Replaces the factory placeholder (once) with the engine's code
// The engine's iife minified with its top level kept: the body is minified
// as a script, whose top-level names (the engine's functions, classes and
// variables) esbuild keeps; only the names inside them change
function compactEngine(esbuild, text) {
  const head = "var __fastEngine = (() => {\n";
  const tail = "  return __toCommonJS(engine_exports);\n})();\n";
  if (!text.startsWith(head) || !text.endsWith(tail)) throw new Error("unexpected engine bundle");
  const body = text.slice(head.length, text.length - tail.length) + "var __fastEngineExports = __toCommonJS(engine_exports);\n";
  const min = esbuild.transformSync(body, { minify: true, target: "es2022", legalComments: "none" }).code;
  return `var __fastEngine = (() => {\n${min}return __fastEngineExports;\n})();\n`;
}

function insertEngine(code, factory) {
  return patch(code, FACTORY_PLACEHOLDER, factory, "engine factory");
}

// The runtime AST snapshot (see src/snapshot.mts), made with the port's own
// parser, and the runtime cache keys it serves: no unsupported features, or
// only compat.InlineScript (non-browser platforms), without minifySyntax and
// minifyIdentifiers (target esnext; every other key parses at run time).
// Checks that compat.InlineScript does not change the parse and that every
// object two independent parses share is one the codec knows (anything else
// would lose its identity).
async function runtimeSnapshot() {
  const src = (f) => import(pathToFileURL(join(here, "src", f)).href);
  const { parseRuntimeForSnapshot, runtimeCacheKey } = await src("bundler.mjs");
  const { encodeSnapshot } = await src("snapshot.mjs");
  const { JSFeatureNone, InlineScript } = await src("compat.mjs");
  const a = parseRuntimeForSnapshot(JSFeatureNone, false, false);
  const text = encodeSnapshot(a);
  if (encodeSnapshot(parseRuntimeForSnapshot(InlineScript, false, false)) !== text) throw new Error("runtime snapshot: compat.InlineScript changes the runtime's AST");
  const keys = [runtimeCacheKey(JSFeatureNone, false, false), runtimeCacheKey(InlineScript, false, false)];
  const reach = (root) => {
    const seen = new Set();
    const stack = [root];
    while (stack.length > 0) {
      const v = stack.pop();
      if (v === null || typeof v !== "object" || seen.has(v)) continue;
      seen.add(v);
      if (v instanceof Map) for (const [k, x] of v) stack.push(k, x);
      else if (v instanceof Set) for (const x of v) stack.push(x);
      else for (const k of Object.keys(v)) stack.push(v[k]);
    }
    return seen;
  };
  const second = reach(parseRuntimeForSnapshot(JSFeatureNone, false, false));
  const js_ast = await src("js_ast.mjs");
  const logger = await src("logger.mjs");
  const known = new Set([logger.RANGE_ZERO, js_ast.EThisShared, js_ast.EUndefinedShared, js_ast.ENullShared, js_ast.EMissingShared, js_ast.ESuperShared, js_ast.BMissingShared, js_ast.SEmptyShared, js_ast.SDebuggerShared, js_ast.STypeScriptShared]);
  for (const v of reach(a)) {
    if (!second.has(v) || known.has(v)) continue;
    // (the lexer's zero Span is only read)
    if (v instanceof logger.Span && v.text === "" && v.range === logger.RANGE_ZERO) continue;
    throw new Error("runtime snapshot: unknown shared object " + (v.constructor && v.constructor.name));
  }
  return { keys, snapshot: JSON.parse(text) };
}

// bin/esbuild: the command line, on top of lib/main.js
const BIN = `#!/usr/bin/env node

// esbuild's command line (cmd/esbuild), run by the engine in lib/main.js
require("../lib/main.js")[Symbol.for("@r1ck404/fast-esbuild-wasm:node")].main(process.argv.slice(2));
`;

async function main() {
  const esbuild = require("esbuild");
  const { version } = JSON.parse(readFileSync(join(esbuildWasmDir, "package.json"), "utf8"));
  if (version !== "0.28.2") throw new Error("expected esbuild-wasm 0.28.2, found " + version);
  const snapshot = await runtimeSnapshot();

  // the engine: an iife assigning __fastEngine, wrapped in the factory
  const engine = await esbuild.build({
    entryPoints: [join(here, "src/engine.mjs")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__fastEngine",
    target: "es2022",
    legalComments: "none",
    // (FAST_ESBUILD_NO_SNAPSHOT=1 builds without it, for comparisons)
    define: process.env.FAST_ESBUILD_NO_SNAPSHOT ? {} : { __FAST_RUNTIME_SNAPSHOT__: JSON.stringify(snapshot) }, // (a JSON value: an object literal)
  });
  // (deep mode: the generator copies of the recursive functions, see
  // src/deep.mts; FAST_ESBUILD_NO_DEEP=1 builds without them, for comparisons)
  const deepText = process.env.FAST_ESBUILD_NO_DEEP ? engine.outputFiles[0].text : genDeep(engine.outputFiles[0].text, { log: console.log }).code;
  // (compacted in the builds that are not minified: the less a page has to
  // parse, the sooner the script has loaded; the names of the functions and
  // classes stay, for the JavaScript stacks in panic messages)
  const engineText = process.env.FAST_ESBUILD_KEEP_WHITESPACE ? deepText : compactEngine(esbuild, deepText);
  const factory = `(function () {\n${engineText}\nreturn __fastEngine;\n})`;
  const factoryMin = (() => {
    const code = esbuild.transformSync(`var __f = ${factory};`, { minify: true, target: "es2022", legalComments: "none" }).code;
    // (esbuild keeps the parentheses; they are added back if it ever drops them)
    if (code.startsWith("var __f=(function(") && code.endsWith("});\n")) return code.slice("var __f=".length, -2);
    if (code.startsWith("var __f=function(") && code.endsWith("};\n")) return "(" + code.slice("var __f=".length, -2) + ")";
    throw new Error("unexpected minified engine factory");
  })();

  // the glue modules: iifes assigning __fastGlue (browser) and __fastNode
  const bundleGlue = async (entry, globalName, platform) =>
    (
      await esbuild.build({
        entryPoints: [join(here, entry)],
        bundle: true,
        write: false,
        format: "iife",
        globalName,
        platform,
        target: "es2022",
        legalComments: "none",
      })
    ).outputFiles[0].text;
  const decls = engineDecls(await bundleGlue("src/glue.mjs", "__fastGlue", "browser"));
  const nodeDecls = engineDecls(await bundleGlue("src/node_host.mjs", "__fastNode", "node"));

  mkdirSync(join(here, "lib"), { recursive: true });
  mkdirSync(join(here, "esm"), { recursive: true });
  mkdirSync(join(here, "bin"), { recursive: true });
  const lib = buildLib(readFileSync(join(esbuildWasmDir, "lib/browser.js"), "utf8"), decls);
  const esm = buildEsm(readFileSync(join(esbuildWasmDir, "esm/browser.js"), "utf8"), decls);
  const nodeMain = patchNodeMain(readFileSync(join(esbuildWasmDir, "lib/main.js"), "utf8"), nodeDecls);
  const outputs = {
    "lib/browser.js": insertEngine(lib, factory),
    "esm/browser.js": insertEngine(esm, factory),
    // minified like the official .min.js files (same syntax target); the
    // engine is minified on its own so that its parentheses survive
    "lib/browser.min.js": insertEngine(esbuild.transformSync((process.env.FAST_ESBUILD_DUMP && writeFileSync(process.env.FAST_ESBUILD_DUMP, lib), lib), { minify: true, target: "es2022", legalComments: "none" }).code, factoryMin),
    "esm/browser.min.js": insertEngine(esbuild.transformSync(esm, { minify: true, format: "esm", target: "es2022", legalComments: "none" }).code, factoryMin),
    "lib/main.js": insertEngine(nodeMain, factory),
    "bin/esbuild": BIN,
  };
  for (const [file, code] of Object.entries(outputs)) {
    writeFileSync(join(here, file), code);
    console.log(`${file}: ${(code.length / 1024).toFixed(0)} KB`);
  }
  // unchanged upstream files
  for (const file of ["lib/main.d.ts", "lib/browser.d.ts", "esm/browser.d.ts", "LICENSE.md"]) copyFileSync(join(esbuildWasmDir, file), join(here, file));
  // the two initialize() options this package adds (see src/glue.mts)
  for (const file of ["lib/browser.d.ts", "esm/browser.d.ts"]) {
    const dts = readFileSync(join(here, file), "utf8");
    writeFileSync(
      join(here, file),
      patch(
        dts,
        `   * to false.
   */
  worker?: boolean
}`,
        `   * to false.
   */
  worker?: boolean

  /**
   * (@r1ck404/fast-esbuild-wasm) In worker mode, run esbuild's service in the
   * worker as well: build(), context(), formatMessages() and the plugin
   * protocol (plugin callbacks still run in the calling thread, as they do in
   * esbuild-wasm) so that bundling never occupies the page's thread. By
   * default only transforms run in the worker and the rest in the page.
   * Ignored with "worker: false".
   */
  serviceInWorker?: boolean

  /**
   * (@r1ck404/fast-esbuild-wasm) In worker mode, transforms of inputs up to
   * this many characters (bytes for a Uint8Array) run in the page instead of
   * the worker (default 65536). Use -1 to send every transform to the worker.
   */
  smallInput?: number
}`,
        "initialize option types",
      ),
    );
  }
  console.log("copied *.d.ts, LICENSE.md from esbuild-wasm " + version);
  // (no Go: remove what earlier builds of this package had)
  for (const file of ["esbuild.wasm", "esbuild.wasm.stamp", "wasm_exec.js", "wasm_exec_node.js"]) {
    if (existsSync(join(here, file))) rmSync(join(here, file));
  }
}

await main();
