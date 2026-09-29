// End-to-end check of the browser builds through the patched glue vs
// esbuild-wasm's browser build (the original package): results, errors and
// result shapes of transform(), build(), formatMessages() and
// analyzeMetafile(), in both modes:
//   - node.mjs (lib/browser.js, worker: false: the engine in this thread)
//   - esm/browser.js in worker mode (transforms in the engine's worker, the
//     service in the page), with a Web Worker shim over worker_threads
//     (webworker.mjs)
// plus the statistics, the warm-up inputs, the runtime snapshot, stop() and
// initialize() again, the minified builds, a blocked or failing engine
// worker, initialize()'s validation (the binary itself is never downloaded
// or compiled: nothing runs Go), and the export surface of all four builds.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { WebWorker } from "./webworker.mjs";
const require = createRequire(import.meta.url);
globalThis.self ??= globalThis;
// (checks the runtime AST snapshot baked into the build against a fresh parse,
// and every runtime cache hit, in this thread)
globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__ = true;
const STATS = Symbol.for("@r1ck404/fast-esbuild-wasm:stats");
// (any WebAssembly.Module passes initialize()'s validation: this one is empty)
const wasmModule = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
const refWasmModule = new WebAssembly.Module(readFileSync(require.resolve("esbuild-wasm/esbuild.wasm")));

const fast = await import("../node.mjs");
await fast.initialize({});
const ref = require("esbuild-wasm/lib/browser.js");
await ref.initialize({ wasmModule: refWasmModule, worker: false });

// worker mode: another instance of the glue (the ES module build). First
// every transform goes to the engine's worker; the small inputs that run in
// the page once its engine is warm are checked further down.
globalThis.Worker = WebWorker;
globalThis.__FAST_ESBUILD_SMALL_INPUT__ = -1;
const fastWorker = await import("../esm/browser.js");
await fastWorker.initialize({ wasmModule });

let failures = 0;
let checks = 0;
const check = (ok, what, detail) => {
  checks++;
  if (!ok) {
    failures++;
    console.log("FAIL", what, detail === undefined ? "" : detail);
  }
};

const lone = String.fromCharCode(0xd800);
const cases = [
  ["/*! legal */ x", { legalComments: "external" }],
  // lone surrogates in flag values reach the service as U+FFFD (UTF-8 encoded flags)
  ["a", { banner: "/* " + lone + " */" }],
  ["x", { define: { x: JSON.stringify("s" + lone) } }],
  ["a", { footer: "//" + lone }],
  ["export const a = 1", { loader: "js", format: "cjs" }],
  ["let x: number = 1; export default x", { loader: "ts" }],
  ["const a = <div/>", { loader: "jsx", jsx: "automatic" }],
  ["module.exports = 1", { format: "esm" }],
  ["if (x === NaN) y()", {}], // warning
  ["let = ", {}], // syntax error
  ["x", { minify: true }],
  // minification, targets (lowering), Vite's renderChunk options, mangling
  // with a mangle cache (returned in the result), keep names, drop, pure,
  // line limit; unsupported targets / invalid values -> esbuild's errors
  ["export class A { #p = 1; static s = 2; get p() { return this.#p } }\nexport const f = async (x) => { for await (const y of x) console.log(y?.z ?? 1) }", { minify: true, target: "es2017", format: "esm" }],
  ["export const long_name = 1; function inner(first, second) { return first + second ** 2 } console.log(inner(long_name, 2))", { target: ["chrome107", "edge107", "firefox104", "safari16"], charset: "utf8", format: "esm", minify: true, treeShaking: true }],
  ["x.foo_ = 1; x.bar_ = 2; x.keep_ = 3; x.other = 4", { mangleProps: /_$/, mangleCache: { foo_: "Q", keep_: false } }],
  ["x.foo_ = 1; x['bar_'] = 2", { mangleProps: /_$/, mangleQuoted: true, reserveProps: /^bar/ }],
  ["export const f = function () {}; export class C {} console.log(f.name)", { minify: true, keepNames: true }],
  ["console.log(1); debugger; DEV: { foo(2) } foo(3); bar.baz(4); const unused = foo(5)", { minifySyntax: true, drop: ["console", "debugger"], dropLabels: ["DEV"], pure: ["foo"], lineLimit: 10, treeShaking: true }],
  ["let x = { a, ...b }; x ??= y?.z", { target: "es2015", sourcemap: true, sourcefile: "t.js" }],
  ["const { a } = b", { target: "es5" }], // esbuild error
  ["const x = 1", { target: "chrome" }], // invalid target
  ["x.a_ = 1", { mangleProps: /(?<n>a)_/ }], // a regexp Go's RE2 rejects
  ["/*! legal */ a()", { legalComments: "eof" }],
  ["a", { banner: "/* b */", footer: "/* f */" }],
  ["﻿let a = 1", {}],
  [new TextEncoder().encode("export let b = 'café'"), { format: "cjs", charset: "utf8" }],
  [new Uint8Array([0x61, 0x3d, 0x22, 0xff, 0x22]), {}], // invalid UTF-8
  [new Uint8Array([0x2f, 0x2f, 0xc3, 0x0a, 0x78]), { minify: true }],
  ["let s = '" + lone + "'", { charset: "utf8" }],
  // an input source map
  ["//# sourceMappingURL=data:application/json;base64,e30=\nx", { sourcemap: true }],
  ['x()\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify({ version: 3, sources: ["a.ts"], sourcesContent: ["x()"], mappings: "AAAA" })).toString("base64"), { sourcemap: true }],
  // source maps: external (result.map) and inline + external (data URL comment)
  ["export const a = 1;\nfunction f(x) {\n  return x * 2;\n}\nconsole.log(f(a));\n", { loader: "js", format: "cjs", sourcemap: true, sourcefile: "a.js" }],
  ["let x: number = 1;\r\nexport default `\n${x}` // \u{1F600}\n", { loader: "ts", sourcemap: "both", sourcesContent: false, sourceRoot: "/src/" }],
  ["x", { sourcemap: true, sourcefile: "file:///a/b.js" }],
  // tsconfigRaw: object form (JSON.stringify'd by the glue), JSONC string form,
  // and an invalid value (a warning)
  ["class A { constructor(private x: number) {} y = 1; declare z: string }\n@dec class B { @m m(@p a) {} }", { loader: "ts", tsconfigRaw: { compilerOptions: { useDefineForClassFields: false, experimentalDecorators: true, alwaysStrict: true } } }],
  ["import { T } from 't'; export const a = <div>{1}</div>", { loader: "tsx", tsconfigRaw: '{ /* c */ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "preact", "verbatimModuleSyntax": true, }, }' }],
  ["x()", { loader: "ts", tsconfigRaw: { compilerOptions: { target: "es2099" } } }],
  // "supported" (Vite sends dynamic-import and import-meta) and object defines
  ["export const m = import.meta.url; import('./x')", { loader: "ts", target: "esnext", supported: { "dynamic-import": true, "import-meta": true }, sourcemap: true, sourcefile: "/src/m.ts" }],
  ["x = '</script>'", { supported: { "inline-script": false, nesting: false } }],
  ["let f = () => 1", { supported: { arrow: false } }], // lowered like for a target without arrows
  ["class A { x = 1; #y = 2; static z = a?.b; m() { return this.#y } }", { supported: { "class-field": false, "optional-chain": false } }], // implies private fields
  ["export const m = import.meta.url; import('./x')", { supported: { "dynamic-import": true, "import-meta": true, "top-level-await": false }, target: "es2020", format: "esm" }],
  ["if (x === NaN) y()", { logOverride: { "equals-nan": "error" } }],
  ["if (x === NaN) y()", { logOverride: { "equals-nan": "silent" }, logLevel: "warning" }],
  // Vite 7's build renderChunk: its default targets, minify, "supported"
  ["export const long_name = async () => { for await (const x of y) console.log(x?.z) }; import('./chunk.js')", { sourcemap: true, sourcefile: "assets/index.js", loader: "js", target: ["chrome107", "edge107", "firefox104", "safari16"], format: "esm", supported: { "dynamic-import": true, "import-meta": true }, minify: true, treeShaking: true, tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } } }],
  ["x", { supported: { "not-a-feature": true } }], // error
  ["console.log(process.env.NODE_ENV, process.env.X, globalThis.process.env)", { define: { "process.env": "{}", "globalThis.process.env": "{}", "process.env.NODE_ENV": '"production"' }, platform: "neutral", sourcemap: true, sourcefile: "/src/entry.js" }],
  ["console.log(import.meta.env.MODE, cfg.list)", { define: { "import.meta.env": '{"MODE":"production","DEV":false}', cfg: '{"list":[1,{"a":null}],"default":2}' }, format: "cjs" }],
  // CSS: Vite's CSS minification, local names, lowering, source maps, legal
  // comments; warnings ("//" comment, ...)
  ['@import "a.css" screen;\n.a { color: #ff0000; margin: 0px 0px 0px 0px; & .b { color: rgb(0 0 0 / 50%) } }\n@media (width >= 600px) { .c { inset: 0 } }', { loader: "css", target: ["chrome107", "edge107", "firefox104", "safari16"], minify: true }],
  ['/*! legal */\n.foo { color: red } .bar { composes: foo; background: url("x y.png") }\n@keyframes spin { to { transform: rotate(360deg) } }', { loader: "local-css", sourcemap: true, sourcefile: "/src/app.module.css", legalComments: "eof" }],
  ["/*! a */ .a { color: red }", { loader: "css", legalComments: "external" }],
  [".a { color: hwb(120 10% 20%) } :is(.b, .c) > .d { font-weight: bold }", { loader: "css", target: "safari12", minifySyntax: true, charset: "utf8" }],
  ["a { color: red } // comment", { loader: "css" }],
  ["a { color: red", { loader: "global-css", minify: true }],
  ["@charset 1", { loader: "css" }],
  // messages printed at the "warning" level, and options that do not validate
  ["if (x === NaN) y(); let = ", { logLevel: "warning" }],
  ["x", { keepNames: true, target: "es5", define: { y: "a b" } }],
  ["x", { target: "foo" }],
  ["x", { loader: "bogus" }],
  // errors in the glue
  [123, {}],
  ["x", { target: 5 }],
  ["x", { notAnOption: true }],
];

const run = async (lib, input, opts) => {
  try {
    return { res: await lib.transform(input, opts) };
  } catch (e) {
    return { err: e.message };
  }
};

for (const [name, lib] of [
  ["node.mjs (worker: false)", fast],
  ["esm/browser.js (worker mode)", fastWorker],
]) {
  let ok = 0;
  for (const [input, opts] of cases) {
    const a = await run(ref, input, opts);
    const b = await run(lib, input, opts);
    const same = JSON.stringify(a) === JSON.stringify(b);
    if (same) ok++;
    else check(false, `${name}: ${JSON.stringify(input).slice(0, 40)} ${JSON.stringify(opts)}`, "\n  ref:  " + JSON.stringify(a).slice(0, 300) + "\n  fast: " + JSON.stringify(b).slice(0, 300));
  }
  const stats = (lib.default ?? lib)[STATS];
  console.log(`${name}: ${ok}/${cases.length} identical`, { fast: stats.fast, error: stats.error, engineIn: stats.engineIn });
  check(stats.error === 0, `${name}: no engine errors`, stats.lastError);
  check(stats.fast >= cases.length - 3, `${name}: the shortcut answers every transform the glue sends`, { fast: stats.fast });
}
check(fast.default[STATS].engineIn === "thread", "node.mjs runs the engine in this thread");
check(fastWorker.default[STATS].engineIn === "worker", "worker mode runs the engine in its worker");
check(fast.default[STATS].fs === "node", "node.mjs: the service uses the real file system", fast.default[STATS].fs);
check(fastWorker.default[STATS].fs === "none", "esm/browser.js: the service has no file system", fastWorker.default[STATS].fs);

// the warm-up steps all take the fast path (the engine from the sources)
{
  const t = await import("../src/transform.mjs");
  let step = 0;
  while (t.warmup(step++));
  check(t.warmupStats.steps === step && t.warmupStats.failed === 0, "warm-up steps take the fast path", t.warmupStats);
  check(t.stats.fast === 0 && t.stats.error === 0, "warm-up steps do not count", t.stats);
}

// the runtime AST snapshot is only used for the runtime cache keys it was
// made for (target esnext, no minifySyntax/minifyIdentifiers, with or
// without compat.InlineScript); every other key parses the runtime (and the
// test hook compares every decode with a fresh parse)
{
  const t = await import("../src/transform.mjs");
  const b = await import("../src/bundler.mjs");
  const { encodeSnapshot } = await import("../src/snapshot.mjs");
  const { JSFeatureNone, InlineScript } = await import("../src/compat.mjs");
  const keys = [b.runtimeCacheKey(JSFeatureNone, false, false), b.runtimeCacheKey(InlineScript, false, false)];
  b._testHooks.setRuntimeSnapshot({ keys, snapshot: encodeSnapshot(b.parseRuntimeForSnapshot()) });
  const decodes = () => b._testHooks.snapshotDecodes;
  const expect = [
    [["--loader=js"], 1],
    [["--platform=node", "--loader=js"], 1], // (compat.InlineScript)
    [["--supported:inline-script=false", "--loader=js"], 0], // (the same key as the line above)
    [["--minify", "--loader=js"], 0],
    [["--minify-syntax", "--loader=js"], 0],
    [["--minify-identifiers", "--loader=js"], 0],
    [["--target=es2019", "--loader=js"], 0],
    [["--target=chrome107,edge107,firefox104,safari16", "--minify", "--loader=js"], 0],
    [["--supported:arrow=false", "--loader=js"], 0],
    [["--target=esnext", "--supported:dynamic-import=true", "--supported:import-meta=true", "--loader=js"], 0], // (cached)
  ];
  for (const [flags, n] of expect) {
    const before = decodes();
    const r = t.fastTransform(["--log-level=silent", "--log-limit=0", ...flags], "export const f = () => a?.b ?? `${c}`", undefined);
    check(r !== undefined && decodes() - before === n, `runtime snapshot for ${flags.join(" ")}: decoded ${decodes() - before} times, expected ${n}`, t.stats.lastError);
  }
  b._testHooks.setRuntimeSnapshot(null);
}

// stop() and initialize() again (worker mode starts a new engine worker),
// now with small inputs in the page once its engine has warmed up
await fastWorker.stop();
check(fastWorker.default[STATS].engineIn === null, "stop() stops the engine worker", fastWorker.default[STATS].engineIn);
globalThis.__FAST_ESBUILD_SMALL_INPUT__ = 64;
await fastWorker.initialize({ wasmModule });
{
  const stats = fastWorker.default[STATS];
  const t0 = Date.now();
  while (!stats.smallInThread && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 20));
  check(stats.smallInThread, "worker mode: the page's engine warms up");
  let ok = 0;
  for (const [input, opts] of cases) {
    const a = await run(ref, input, opts);
    const b = await run(fastWorker, input, opts);
    if (JSON.stringify(a) === JSON.stringify(b)) ok++;
    else check(false, `worker mode, small inputs in the page: ${JSON.stringify(input).slice(0, 40)} ${JSON.stringify(opts)}`, "\n  ref:  " + JSON.stringify(a).slice(0, 300) + "\n  fast: " + JSON.stringify(b).slice(0, 300));
  }
  console.log(`esm/browser.js (worker mode, inputs <= 64 in the page): ${ok}/${cases.length} identical`, { fast: stats.fast, error: stats.error, engineIn: stats.engineIn });
  check(stats.engineIn === "worker", "worker mode after stop() + initialize()");
}

// the minified build (its engine is minified separately, see build.mjs)
{
  const min = require("../lib/browser.min.js");
  await min.initialize({ wasmModule, worker: false });
  let ok = 0;
  for (const [input, opts] of cases) {
    const a = await run(ref, input, opts);
    const b = await run(min, input, opts);
    if (JSON.stringify(a) === JSON.stringify(b)) ok++;
    else check(false, `lib/browser.min.js: ${JSON.stringify(input).slice(0, 40)} ${JSON.stringify(opts)}`, "\n  ref:  " + JSON.stringify(a).slice(0, 300) + "\n  fast: " + JSON.stringify(b).slice(0, 300));
  }
  const stats = min[STATS];
  console.log(`lib/browser.min.js (worker: false): ${ok}/${cases.length} identical`, { fast: stats.fast, error: stats.error });
  check(stats.error === 0 && stats.fast >= cases.length - 3, "lib/browser.min.js: fast path, no engine errors", stats.lastError);
}

// worker mode when the engine's worker cannot be used: its creation throws
// (e.g. a Content-Security-Policy), or it fails later (an "error" event).
// The engine then runs in the page. (esm/browser.min.js: another instance.)
{
  globalThis.Worker = class extends WebWorker {
    constructor(url) {
      throw new Error("blocked");
    }
  };
  const lib = await import("../esm/browser.min.js");
  await lib.initialize({ wasmModule });
  const a = await run(ref, "export let x: number = 1", { loader: "ts", format: "cjs" });
  const b = await run(lib, "export let x: number = 1", { loader: "ts", format: "cjs" });
  const stats = lib.default[STATS];
  check(JSON.stringify(a) === JSON.stringify(b) && stats.engineIn === "thread" && stats.fast === 1, "worker mode, engine worker blocked: runs in the page", { engineIn: stats.engineIn, fast: stats.fast });
  await lib.stop();
  globalThis.Worker = class extends WebWorker {
    constructor(url) {
      super(url);
      setTimeout(() => this.onerror && this.onerror({ message: "failed" }), 0);
    }
  };
  await lib.initialize({ wasmModule });
  await new Promise((r) => setTimeout(r, 50));
  const c = await run(lib, "export let x: number = 1", { loader: "ts", format: "cjs" });
  check(JSON.stringify(a) === JSON.stringify(c) && stats.engineIn === "thread" && stats.fast === 2, "worker mode, engine worker failed: runs in the page", { engineIn: stats.engineIn, fast: stats.fast });
  await lib.stop();
  globalThis.Worker = WebWorker;
}

// Fresh instances of the glue (the ES module build, imported again with a
// query), in both modes: concurrent calls of every kind, stop() and
// initialize() again, initialize()'s validation errors.
{
  const { createServer } = await import("node:http");
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  globalThis.location = { href: base + "/" };
  let instance = 0;
  const fresh = (build = "esm/browser.js") => import(`../${build}?fresh${instance++}`);
  const freshRef = () => import(`esbuild-wasm/esm/browser.js?fresh${instance++}`);
  const settle = async (p) => {
    try {
      return { res: await p };
    } catch (e) {
      return { err: e.message };
    }
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const buildOpts = (tag) => ({
    stdin: { contents: `import x from "./y"; import "./s.css"; console.log(x, ${JSON.stringify(tag)})`, resolveDir: "/" },
    bundle: true,
    write: false,
    format: "esm",
    outdir: "/out",
    metafile: true,
    plugins: [
      {
        name: "vfs",
        setup(b) {
          b.onResolve({ filter: /^\.\/(y|s\.css)$/ }, (args) => ({ path: args.path === "./y" ? "/y.js" : "/s.css", namespace: "vfs" }));
          b.onLoad({ filter: /\.js$/, namespace: "vfs" }, () => ({ contents: "export default 42", loader: "js" }));
          b.onLoad({ filter: /\.css$/, namespace: "vfs" }, () => ({ contents: ".a { color: red }", loader: "css" }));
        },
      },
    ],
  });
  const buildText = (r) => (r.res ? { res: r.res.outputFiles.map((f) => [f.path, f.text]), warnings: r.res.warnings, metafile: r.res.metafile } : r);

  // (serviceInWorker: the service, and with it build() and the plugin protocol, runs in the engine's worker;
  // smallInput: -1 sends every transform there as well)
  const modes = [
    { worker: false },
    { worker: true },
    { worker: true, serviceInWorker: true },
    { worker: true, serviceInWorker: true, smallInput: -1 },
  ];
  for (const opts of modes) {
    const { worker } = opts;
    const mode = !worker ? "worker: false" : "worker mode" + (opts.serviceInWorker ? ", service in the worker" : "") + (opts.smallInput === -1 ? ", every transform in the worker" : "");
    const lib = await fresh();
    const stats = lib.default[STATS];
    await lib.initialize({ wasmModule, ...opts });
    const calls = (m) => [
      settle(m.transform("/*! legal */ x", { legalComments: "external" })),
      settle(m.transform("x", { logOverride: { "equals-nan": "error" } })),
      settle(m.transform("let = ", {})),
      settle(m.build(buildOpts("a")).then((r) => buildText({ res: r }))),
      settle(m.formatMessages([{ text: "hi", location: { file: "f.js", line: 1, column: 0, lineText: "hi" } }], { kind: "error" })),
      settle(m.analyzeMetafile({ inputs: {}, outputs: { "o.js": { bytes: 10, inputs: {}, imports: [], exports: [] } } })),
      settle(m.transform("export let x: number = 1", { loader: "ts", format: "cjs" })),
      settle(m.build(buildOpts("b")).then((r) => buildText({ res: r }))),
      settle(m.build({ entryPoints: ["/nope.js"], write: false, logLevel: "silent" }).then((r) => buildText({ res: r }))),
      settle(m.context(buildOpts("c")).then(async (ctx) => {
        const r = await ctx.rebuild();
        await ctx.dispose();
        return buildText({ res: r });
      })),
    ];
    const got = await Promise.all(calls(lib));
    const want = await Promise.all(calls(ref));
    for (let i = 0; i < want.length; i++) check(same(got[i], want[i]), `${mode}: concurrent call ${i}`, "\n  ref:  " + JSON.stringify(want[i]).slice(0, 300) + "\n  fast: " + JSON.stringify(got[i]).slice(0, 300));
    check(stats.error === 0, `${mode}: no engine errors`, stats.lastError);
    // stop() and initialize() again
    await lib.stop();
    await lib.initialize({ wasmModule, ...opts });
    const c = await settle(lib.transform("/*! legal */ x", { legalComments: "external" }));
    check(same(c, want[0]), `${mode}: stop() + initialize()`, c);
    await lib.stop();

    // a wasm URL, which is never downloaded
    const lib2 = await fresh();
    const init = await settle(lib2.initialize({ wasmURL: "/esbuild.wasm", ...opts }));
    check(init.err === undefined && requests === 0, `${mode}: initialize() does not download the wasm URL`, { init, requests });
    const t = await settle(lib2.transform("let a = 1", {}));
    check(t.res !== undefined && t.res.code === "let a = 1;\n", `${mode}: a transform without the binary`, t);
    await lib2.stop();
  }

  // initialize()'s own errors are esbuild-wasm's
  {
    const r = await freshRef();
    const lib = await fresh();
    const tries = [undefined, {}, { wasmURL: 1 }, { wasmModule: {} }, { worker: "no" }, { wasmURL: "/esbuild.wasm", nope: 1 }, { wasmURL: "http://[bad" }];
    for (const opts of tries) {
      const a = await settle(Promise.resolve().then(() => r.initialize(opts)));
      const b = await settle(Promise.resolve().then(() => lib.initialize(opts)));
      check(a.err !== undefined && same(a, b), `initialize(${JSON.stringify(opts)}) fails like esbuild-wasm's`, { ref: a, fast: b });
    }
    for (const [opts, message] of [
      [{ wasmModule, serviceInWorker: "yes" }, '"serviceInWorker" must be a boolean'],
      [{ wasmModule, smallInput: 1.5 }, '"smallInput" must be an integer'],
      [{ wasmModule, smallInput: "1" }, '"smallInput" must be an integer'],
    ]) {
      const e = await settle(Promise.resolve().then(() => lib.initialize(opts)));
      check(e.err === message, `initialize(${JSON.stringify({ ...opts, wasmModule: "…" })}) is rejected like a wrong esbuild option`, e);
    }
    await lib.initialize({ wasmModule, worker: false });
    await r.initialize({ wasmModule: refWasmModule, worker: false });
    const a = await settle(Promise.resolve().then(() => r.initialize({ wasmModule: refWasmModule, worker: false })));
    const b = await settle(Promise.resolve().then(() => lib.initialize({ wasmModule, worker: false })));
    check(a.err !== undefined && same(a, b), `a second initialize() fails like esbuild-wasm's`, { ref: a, fast: b });
    // calls before initialize()
    const r2 = await freshRef();
    const lib2 = await fresh();
    const c = await settle(Promise.resolve().then(() => r2.transform("x")));
    const d = await settle(Promise.resolve().then(() => lib2.transform("x")));
    check(c.err !== undefined && same(c, d), "transform() before initialize() fails like esbuild-wasm's", { ref: c, fast: d });
    await r.stop();
    await lib.stop();
  }
  // node.mjs (stopped and initialized again): its initialize() errors are
  // esbuild-wasm's too
  {
    const n = fast;
    await n.stop();
    for (const opts of [{ worker: 1 }, { nope: 1 }]) {
      const r = await freshRef();
      const a = await settle(Promise.resolve().then(() => r.initialize({ wasmModule: refWasmModule, ...opts })));
      const b = await settle(Promise.resolve().then(() => n.initialize(opts)));
      check(a.err !== undefined && same(a, b), `node.mjs initialize(${JSON.stringify(opts)})`, { ref: a, fast: b });
    }
    const init = await settle(n.initialize());
    check(init.err === undefined, "node.mjs: initialize() again", init);
    const again = await settle(Promise.resolve().then(() => n.initialize()));
    check(again.err === 'Cannot call "initialize" more than once', "node.mjs: a second initialize() fails", again);
  }
  delete globalThis.location;
  server.close();
}

// the public surface is esbuild-wasm's: same export names in every build
const keys = (m) => Object.keys(m).sort().join(",");
const surfaces = [
  ["lib/browser.js", keys(require("../lib/browser.js")), keys(ref)],
  ["lib/browser.min.js", keys(require("../lib/browser.min.js")), keys(require("esbuild-wasm/lib/browser.min.js"))],
  ["esm/browser.js", keys(await import("../esm/browser.js")), keys(await import("esbuild-wasm/esm/browser.js"))],
  ["esm/browser.min.js", keys(await import("../esm/browser.min.js")), keys(await import("esbuild-wasm/esm/browser.min.js"))],
  ["lib/main.js", keys(require("../lib/main.js")), keys(require("esbuild-wasm/lib/main.js"))],
];
let surfaceBad = 0;
for (const [name, a, b] of surfaces) if (a !== b) (surfaceBad++, console.log("EXPORTS DIFFER", name, a, "vs", b));
console.log(`export surface: ${surfaces.length - surfaceBad}/${surfaces.length} identical`);
if (surfaceBad) failures++;
await fastWorker.stop();
await fast.stop();
await ref.stop();
require("../lib/main.js").stop();
require("esbuild-wasm/lib/main.js").stop();
console.log(failures === 0 ? `api: all ${checks} checks passed` : `api: ${failures} of ${checks} checks FAILED`);
process.exit(failures === 0 ? 0 : 1);
