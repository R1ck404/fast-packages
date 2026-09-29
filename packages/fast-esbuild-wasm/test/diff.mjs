// Differential test: @r1ck404/fast-esbuild-wasm's JS transform vs real esbuild 0.28.2
// (the native package; same Go code as esbuild-wasm) over a corpus of real
// files and option sets.
//
// usage: node test/diff.mjs [--limit N] [--dir path]... [--opts name,name] [--file path]
//                           [--show N] [--stop] [--quiet] [--no-nm]
//   --opts    option sets to run (a trailing "*" matches a prefix, e.g. "min*")
//   --no-nm   skip node_modules directories while walking --dir trees
// Categories:
//   ok            identical output
//   bail          fast path declined (falls back to esbuild) — fine
//   bothFail      esbuild errors and the fast path declined — fine
//   FALSE-ACCEPT  esbuild errors but the fast path produced output — BUG
//   FALSE-ERROR   the fast path reports errors but esbuild succeeds — BUG
//   MSG-MISMATCH  different errors or warnings (every field, in order) — BUG
//   MISMATCH      different output — BUG
//   CRASH         the port threw a non-bail exception (would fall back, but is a bug)
//   esbuildCrash  native esbuild itself panicked (an esbuild bug) — skipped
//   okWasm        differs from native esbuild but identical to esbuild-wasm
//                 (Go's float->int conversions differ between amd64 and wasm)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { flagsFor, VITE_TARGETS, VITE5_TARGETS, makeRefTransform, makeWasmTransform, ESBUILD_CRASHED, messagesJSON, firstMessageDiff } from "./flags.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const refTransform = makeRefTransform(require);
const wasmTransform = makeWasmTransform(require);
// Check every hit of the runtime print cache against a fresh print
globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__ = true;
const { fastTransform, stats } = await (await import("./engine.mjs")).loadEngine();
// The runtime AST comes from the snapshot, as in the built engine (the test
// hook above checks it against a fresh parse)
{
  // (for the same keys as build.mjs: target esnext without minifySyntax and
  // minifyIdentifiers, with or without compat.InlineScript; every other
  // option set parses the runtime)
  if (!(await import("./engine.mjs")).bundled) {
  const { _testHooks, parseRuntimeForSnapshot, runtimeCacheKey } = await import("../src/bundler.mjs");
  const { encodeSnapshot } = await import("../src/snapshot.mjs");
  const { JSFeatureNone, InlineScript } = await import("../src/compat.mjs");
  const keys = [runtimeCacheKey(JSFeatureNone, false, false), runtimeCacheKey(InlineScript, false, false)];
  _testHooks.setRuntimeSnapshot({ keys, snapshot: encodeSnapshot(parseRuntimeForSnapshot()) });
  }
}

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const getAll = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const limit = Number(getArg("--limit", Infinity));
const showN = Number(getArg("--show", 5));
const stopOnFail = args.includes("--stop");
const quiet = args.includes("--quiet");
// (in parallel: see shard.mjs; --jobs 1 runs in this process)
const { shardOf, jobsOf, runShards, printSummary, addUp, shardList } = await import("./shard.mjs");
const shard = shardOf(args);
const onlyOptsList = getArg("--opts", null)?.split(",");
const onlyOpts = onlyOptsList && { includes: (name) => onlyOptsList.some((o) => (o.endsWith("*") ? name.startsWith(o.slice(0, -1)) : o === name)) };
const singleFile = getArg("--file", null);
const skipNodeModules = args.includes("--no-nm");

const importMetaDefine = {
  "import.meta.url": "import_meta.url",
  "import.meta.dirname": "import_meta.dirname",
  "import.meta.filename": "import_meta.filename",
  "import.meta": "import_meta",
};
const nodepodCjs = (loader) => ({ loader, format: "cjs", target: "esnext", platform: "neutral", define: importMetaDefine });

// "tsconfigRaw" option sets (the object form is JSON.stringify'd by the glue,
// the string form is passed through verbatim)
const tsVite = (loader) => ({ loader, target: "esnext", tsconfigRaw: { compilerOptions: { useDefineForClassFields: true, verbatimModuleSyntax: true } } });
const tsDecorators = (loader) => ({ loader, tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } });

// What Vite (5, 6, 7) sends: the "vite:esbuild" plugin for .ts/.tsx/.jsx
// ("supported" is Vite's defaultEsbuildSupported; "jsxDev" and "jsx" come
// from the default config and the React plugin; tsconfigRaw is what
// transformWithEsbuild derives from tsconfig.json), and the "vite:define"
// plugin (SSR modules in dev, every module in a build) with its process.env
// defines, which are objects.
const viteSupported = { "dynamic-import": true, "import-meta": true };
const viteDev = (loader, sourcefile, extra) => ({
  target: "esnext",
  charset: "utf8",
  treeShaking: false,
  supported: viteSupported,
  sourcemap: true,
  sourcefile,
  loader,
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  ...extra,
});
// Vite's build "renderChunk" (Vite 7: the default targets, "supported",
// minify, tree shaking, a source map; resolveEsbuildTranspileOptions +
// transformWithEsbuild): a normal build, an ES library build (no whitespace
// minification), and a build with build.minify other than esbuild (target
// lowering only); Vite 5: its default targets and charset utf8
const viteChunk = (extra) => ({
  sourcemap: true,
  sourcefile: "assets/index-DkDA3m1c.js",
  loader: "js",
  target: VITE_TARGETS,
  format: "esm",
  supported: viteSupported,
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  ...extra,
});
const viteDefine = {
  loader: "js",
  platform: "neutral",
  define: {
    "process.env": "{}",
    "global.process.env": "{}",
    "globalThis.process.env": "{}",
    "process.env.NODE_ENV": '"development"',
    "global.process.env.NODE_ENV": '"development"',
    "globalThis.process.env.NODE_ENV": '"development"',
  },
  sourcefile: "/src/entry-server.js",
  sourcemap: true,
};
// Object and array defines (injected as "<define:...>" files)
const jsonDefines = {
  "process.env": "{}",
  "import.meta.env": '{"BASE_URL":"/","MODE":"production","DEV":false,"PROD":true,"SSR":false}',
  __APP__: '{"name": "app", "list": [1, 2, {"x": null}], "nested": {"a": {"b": []}}, "default": 0, "a-b": -1.5e3}',
  __LIST__: "[1, \"2\", [3, [true]], {}]",
  "window.__CFG__": "{ 'single': 'quotes', /* comment */ \"trailing\": [1,], }",
  __BIG__: "123n",
};

// option sets per file kind
const OPTION_SETS = {
  js: [
    ["js", { loader: "js" }],
    ["cjs", nodepodCjs("js")],
    ["esm", { loader: "js", format: "esm" }],
    ["iife", { loader: "js", format: "iife" }],
    ["js-strict", { loader: "js", tsconfigRaw: { compilerOptions: { strict: true } } }],
    // source maps
    ["js-map", { loader: "js", sourcemap: true, sourcefile: "input.js" }],
    ["cjs-map", { ...nodepodCjs("js"), sourcemap: "external", sourcefile: "/node_modules/pkg/index.js" }],
    ["esm-map", { loader: "js", format: "esm", sourcemap: "both", sourcesContent: false, sourceRoot: "/src/" }],
    ["iife-map", { loader: "js", format: "iife", sourcemap: "inline", charset: "utf8", banner: "/* b" + String.fromCharCode(0xe4) + "nner */", footer: "//f" }],
    // Vite's define plugin, object/array defines, "supported" overrides
    ["vite-define", viteDefine],
    ["define-json", { loader: "js", format: "cjs", define: jsonDefines }],
    ["define-json-map", { loader: "js", format: "esm", define: jsonDefines, sourcemap: "both", sourcefile: "/src/m.js", treeShaking: true }],
    ["supported", { loader: "js", supported: { "dynamic-import": true, "import-meta": true, "inline-script": false, nesting: false, "top-level-await": true } }],
    ["supported-node", { loader: "js", platform: "node", format: "esm", supported: { "inline-script": true, bigint: true } }],
    // "supported" set to false: lowered like for a target without the feature
    ["supported-false", { loader: "js", supported: { arrow: false, "optional-chain": false, "nullish-coalescing": false, "class-field": false, "logical-assignment": false, "object-rest-spread": false } }],
    ["supported-false-min", { loader: "js", format: "esm", minify: true, target: "es2020", supported: { "async-await": false, "template-literal": false, "dynamic-import": true } }],
    // minification
    ["min", { loader: "js", minify: true }],
    ["min-ws", { loader: "js", minifyWhitespace: true }],
    ["min-ids", { loader: "js", minifyIdentifiers: true }],
    ["min-syntax", { loader: "js", minifySyntax: true }],
    ["min-esm", { loader: "js", format: "esm", minify: true }],
    ["min-cjs", { ...nodepodCjs("js"), minify: true }],
    ["min-iife-map", { loader: "js", format: "iife", globalName: "lib", minify: true, sourcemap: "external", sourcefile: "x.js", legalComments: "eof" }],
    ["min-keep-names", { loader: "js", minify: true, keepNames: true, charset: "utf8" }],
    ["min-drop", { loader: "js", minifySyntax: true, minifyWhitespace: true, drop: ["console", "debugger"], dropLabels: ["DEV", "x"], pure: ["foo", "bar.baz"], lineLimit: 120 }],
    ["min-mangle", { loader: "js", minify: true, mangleProps: /_$/, reserveProps: /^__/, mangleQuoted: true, mangleCache: { options_: "O", state_: false } }],
    // targets
    ["es2015", { loader: "js", target: "es2015" }],
    ["es2017-cjs", { ...nodepodCjs("js"), target: "es2017" }],
    ["es2020", { loader: "js", target: "es2020" }],
    ["node14", { loader: "js", target: "node14", platform: "node" }],
    ["node18-esm-map", { loader: "js", target: "node18", format: "esm", sourcemap: true }],
    // Vite's build (renderChunk): the default browser targets with minify,
    // and the options for an ES library build (no whitespace minification)
    ["vite-chunk", { loader: "js", target: VITE_TARGETS, charset: "utf8", format: "esm", minify: true, treeShaking: true }],
    ["vite-lib-es", { loader: "js", target: VITE_TARGETS, charset: "utf8", format: "esm", minifyIdentifiers: true, minifySyntax: true, treeShaking: true }],
    ["vite-chunk-cjs-map", { loader: "js", target: "es2019", format: "cjs", minify: true, treeShaking: true, sourcemap: true, sourcefile: "chunk.js" }],
    ["vite5-chunk", { loader: "js", target: VITE5_TARGETS, charset: "utf8", format: "esm", minify: true, treeShaking: true }],
    ["chrome87-min", { loader: "js", target: ["chrome87", "firefox78"], minify: true }],
    // exactly what Vite 7 / Vite 5 send from renderChunk
    ["vite7-chunk", viteChunk({ minify: true, treeShaking: true })],
    ["vite7-lib-es", viteChunk({ minifyIdentifiers: true, minifySyntax: true, treeShaking: true })],
    ["vite7-chunk-nomin", viteChunk({ treeShaking: false })],
    ["vite5-chunk-supported", viteChunk({ target: VITE5_TARGETS, charset: "utf8", minify: true, treeShaking: true })],
  ],
  ts: [
    ["ts", { loader: "ts" }],
    ["ts-cjs", nodepodCjs("ts")],
    ["ts-vite", tsVite("ts")],
    ["ts-decorators", tsDecorators("ts")],
    ["ts-es2019", { loader: "ts", tsconfigRaw: { compilerOptions: { target: "es2019" } } }],
    ["ts-jsonc", { loader: "ts", tsconfigRaw: '{ /* c */ "compilerOptions": { "preserveValueImports": true, }, }' }],
    ["ts-strict", { loader: "ts", tsconfigRaw: { compilerOptions: { importsNotUsedAsValues: "preserve", alwaysStrict: true } } }],
    // source maps
    ["ts-map", { loader: "ts", sourcemap: "inline", sourcesContent: false }],
    ["ts-cjs-map", { ...nodepodCjs("ts"), sourcemap: true, sourcefile: "src/file.ts", sourceRoot: "https://example.com/r" + String.fromCharCode(0xf6, 0xf6) + "t/" }],
    ["ts-vite-dev", viteDev("ts", "/home/app/src/file.ts")],
    // minification and targets
    ["ts-min", { loader: "ts", minify: true }],
    ["ts-es2017", { loader: "ts", target: "es2017" }],
    ["ts-vite-targets", { ...tsVite("ts"), target: VITE_TARGETS }],
    ["ts-node18-cjs", { ...nodepodCjs("ts"), target: "node18" }],
    ["ts-es2020-min-map", { loader: "ts", target: "es2020", minify: true, sourcemap: "inline" }],
    ["ts-decorators-es2015", { ...tsDecorators("ts"), target: "es2015" }],
    ["ts-supported-false", { ...viteDev("ts", "/home/app/src/file.ts"), supported: { ...viteSupported, "class-field": false, "optional-chain": false, "async-await": false } }],
  ],
  tsx: [
    ["tsx", { loader: "tsx" }],
    ["tsx-auto", { loader: "tsx", jsx: "automatic", format: "esm" }],
    ["tsx-vite", { ...tsVite("tsx"), tsconfigRaw: { compilerOptions: { useDefineForClassFields: true, verbatimModuleSyntax: true, jsx: "react-jsx" } } }],
    ["tsx-decorators", tsDecorators("tsx")],
    ["tsx-preact", { loader: "tsx", tsconfigRaw: { compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" } } }],
    ["tsx-factory", { loader: "tsx", jsx: "automatic", tsconfigRaw: { compilerOptions: { jsx: "react", jsxFactory: "h", jsxFragmentFactory: "Fragment", strict: true } } }],
    // source maps
    ["tsx-map", { loader: "tsx", sourcemap: "external", sourcefile: "App.tsx" }],
    ["tsx-auto-map", { loader: "tsx", jsx: "automatic", format: "esm", sourcemap: "both", charset: "utf8" }],
    ["tsx-vite-dev", viteDev("tsx", "/home/app/src/App.tsx", { jsx: "automatic", jsxDev: true })],
    // minification and targets
    ["tsx-min", { loader: "tsx", jsx: "automatic", minify: true }],
    ["tsx-vite-targets", { ...tsVite("tsx"), target: VITE_TARGETS, tsconfigRaw: { compilerOptions: { useDefineForClassFields: true, jsx: "react-jsx" } } }],
  ],
  jsx: [
    ["jsx", { loader: "jsx" }],
    ["jsx-cjs", nodepodCjs("jsx")],
    ["jsx-dev", { loader: "jsx", format: "esm", tsconfigRaw: { compilerOptions: { jsx: "react-jsxdev", jsxImportSource: "@emotion/react" } } }],
    // source maps
    ["jsx-map", { loader: "jsx", sourcemap: true }],
    ["jsx-cjs-map", { ...nodepodCjs("jsx"), sourcemap: "inline", sourcefile: "c" + String.fromCharCode(0xf6) + "mp.jsx" }],
    // minification and targets
    ["jsx-min-es2018", { loader: "jsx", minify: true, target: "es2018" }],
  ],
};

function kindOf(file) {
  const ext = extname(file);
  if (file.endsWith(".d.ts") || file.endsWith(".d.mts") || file.endsWith(".d.cts")) return "ts";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "js";
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "ts";
  if (ext === ".tsx") return "tsx";
  if (ext === ".jsx") return "jsx";
  return null;
}

function* walk(dir, seen) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === ".git" || (skipNodeModules && e.name === "node_modules")) continue;
      yield* walk(p, seen);
    } else if (e.isFile() || e.isSymbolicLink()) {
      if (!kindOf(p)) continue;
      let real;
      try {
        const st = statSync(p);
        if (st.size > 12e6) continue;
        real = `${st.size}:${st.ino}:${st.mtimeMs}`;
      } catch {
        continue;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      yield p;
    }
  }
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const line = a.slice(0, i).split("\n").length;
  const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - 80), i + 80));
  return `  first difference at char ${i} (line ${line})\n    esbuild: ${ctx(a)}\n    fast:    ${ctx(b)}`;
}

let files;
const fromParent = shardList(args);
if (fromParent !== null) files = fromParent;
else if (singleFile) files = [resolve(singleFile)];
else {
  const dirs = getAll("--dir");
  if (dirs.length === 0) dirs.push(join(here, "../../../node_modules"), join(here, "../../../../Nodepod/src"));
  const seen = new Set();
  files = [];
  for (const d of dirs) for (const f of walk(resolve(d), seen)) files.push(f);
}
// (a shard process takes the parent's list)
if (fromParent === null) files = files.slice(0, limit);

const counts = { ok: 0, okWasm: 0, okError: 0, bail: 0, bothFail: 0, "FALSE-ACCEPT": 0, "FALSE-ERROR": 0, "MSG-MISMATCH": 0, MISMATCH: 0, CRASH: 0, esbuildCrash: 0 };
// Same result as esbuild-wasm (see makeWasmTransform)
function sameAsWasm(code, opts, fast) {
  const w = wasmTransform(code, opts);
  return w !== null && messagesJSON(w.warnings) === messagesJSON(fast.warnings) && w.code === fast.code && w.map === fast.map && (w.legalComments ?? undefined) === (fast.legalComments ?? undefined);
}

const perOpt = {};
const bailReasons = new Map();
const shown = {};
const t0 = performance.now();
let tFast = 0;
let tRef = 0;
if (shard === null && jobsOf(args) > 1 && files.length > 1) {
  const n = Math.min(jobsOf(args), files.length);
  const sums = addUp(await runShards(fileURLToPath(import.meta.url), args, n, process.env, files));
  console.log(`${files.length} files in ${((performance.now() - t0) / 1000).toFixed(1)}s (esbuild native ${(sums.tRef / 1000).toFixed(1)}s, fast ${(sums.tFast / 1000).toFixed(1)}s, in ${n} processes)`);
  console.log(Object.entries(sums.counts).map(([k, v]) => `${k} ${v}`).join(", "));
  const names = [];
  for (const sets of Object.values(OPTION_SETS)) for (const [name] of sets) if (sums.perOpt[name] && !names.includes(name)) names.push(name);
  console.log(names.map((k) => `${k}: ok ${sums.perOpt[k].ok} bail ${sums.perOpt[k].bail} bad ${sums.perOpt[k].bad}`).join(" | "));
  process.exitCode = ["FALSE-ACCEPT", "FALSE-ERROR", "MSG-MISMATCH", "MISMATCH", "CRASH"].some((k) => sums.counts[k] > 0) ? 1 : 0;
  process.exit();
}
let fileIndex = 0;
outer: for (const file of files) {
  if (shard !== null && !shard.take(fileIndex++)) continue;
  const kind = kindOf(file);
  let code;
  try {
    code = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [name, opts] of OPTION_SETS[kind]) {
    if (onlyOpts && !onlyOpts.includes(name)) continue;
    let ref = null;
    let refError = null; // (esbuild's messages when it fails)
    let t = performance.now();
    try {
      ref = refTransform(code, opts);
    } catch (e) {
      refError = e;
    }
    tRef += performance.now() - t;
    if (ref === ESBUILD_CRASHED) {
      counts.esbuildCrash++;
      continue;
    }
    const errBefore = stats.error;
    t = performance.now();
    const fast = fastTransform(flagsFor(opts), code, opts.mangleCache);
    tFast += performance.now() - t;
    let cat;
    let msgDiff = null;
    if (stats.error !== errBefore) cat = "CRASH";
    else if (fast === undefined) cat = ref === null ? "bothFail" : "bail";
    else if (ref === null) {
      if (fast.errors.length === 0) cat = "FALSE-ACCEPT";
      else if (refError === null || !Array.isArray(refError.errors)) cat = "MSG-MISMATCH";
      else if ((msgDiff = firstMessageDiff(refError.errors, fast.errors) || firstMessageDiff(refError.warnings, fast.warnings)) !== null) cat = "MSG-MISMATCH";
      else cat = "okError";
    } else if (fast.errors.length > 0) cat = "FALSE-ERROR";
    else if ((msgDiff = firstMessageDiff(ref.warnings, fast.warnings)) !== null) cat = "MSG-MISMATCH";
    else if (fast.code !== ref.code || (fast.legalComments ?? undefined) !== (ref.legalComments ?? undefined)) cat = "MISMATCH";
    else if (fast.map !== ref.map) cat = "MISMATCH";
    else if (JSON.stringify(fast.mangleCache) !== JSON.stringify(ref.mangleCache)) cat = "MISMATCH";
    else cat = "ok";
    if (cat === "MISMATCH" && sameAsWasm(code, opts, fast)) cat = "okWasm";
    counts[cat]++;
    if (cat === "bail" || cat === "bothFail") {
      const lb = stats.lastBail;
      const key = (cat === "bothFail" ? "[esbuild fails] " : "") + (lb ? lb.reason + (lb.detail ? ": " + lb.detail.slice(0, 70) : "") : "?");
      bailReasons.set(key, (bailReasons.get(key) || 0) + 1);
    }
    (perOpt[name] ??= { ok: 0, bail: 0, bad: 0 })[cat === "ok" || cat === "okWasm" || cat === "okError" ? "ok" : cat === "bail" || cat === "bothFail" ? "bail" : "bad"]++;
    if (cat !== "ok" && cat !== "okError" && cat !== "bail" && cat !== "bothFail") {
      shown[cat] = (shown[cat] || 0) + 1;
      if (!quiet && shown[cat] <= showN) {
        console.log(`${cat} [${name}] ${file}`);
        if (cat === "MISMATCH") console.log(fast.code !== ref.code ? firstDiff(ref.code, fast.code) : fast.map !== ref.map ? "  (source map)\n" + firstDiff(ref.map, fast.map) : "  (mangle cache)");
        if (cat === "CRASH") console.log("  " + String(stats.lastError && stats.lastError.stack).split("\n").slice(0, 6).join("\n  "));
        if (cat === "FALSE-ACCEPT") console.log("  esbuild: " + (refError && refError.errors ? refError.errors[0].text : String(refError)));
        if (cat === "FALSE-ERROR") console.log("  fast: " + fast.errors[0].text);
        if (cat === "MSG-MISMATCH") console.log(msgDiff || "  (esbuild threw: " + String(refError) + ")");
      }
      if (stopOnFail) break outer;
    }
  }
}
if (shard !== null) {
  printSummary({ counts, perOpt, tRef, tFast });
  process.exit();
}
console.log(`${files.length} files in ${((performance.now() - t0) / 1000).toFixed(1)}s (esbuild native ${(tRef / 1000).toFixed(1)}s, fast ${(tFast / 1000).toFixed(1)}s)`);
console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "));
console.log(Object.entries(perOpt).map(([k, v]) => `${k}: ok ${v.ok} bail ${v.bail} bad ${v.bad}`).join(" | "));
// Why the fast path declined (stats.lastBail), most frequent first
if (bailReasons.size > 0) {
  console.log("bail reasons:");
  for (const [k, n] of [...bailReasons].sort((a, b) => b[1] - a[1]).slice(0, args.includes("--reasons") ? 1000 : 15)) console.log(String(n).padStart(7) + "  " + k);
}

// (failure: any category other than an identical result, a bail or a
// case esbuild itself crashes on)
process.exitCode = ["FALSE-ACCEPT", "FALSE-ERROR", "MSG-MISMATCH", "MISMATCH", "CRASH"].some((k) => counts[k] > 0) ? 1 : 0;
