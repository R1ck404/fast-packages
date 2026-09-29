// Differential test for build(): @r1ck404/fast-esbuild-wasm (the JS engine)
// against the reference over
// many real bundling scenarios. Every result must be identical: output files
// (paths, contents, hashes), metafile JSON, mangle cache, errors and
// warnings. Plugin callbacks must run exactly as often as with the reference.
//
//   plugin FS  every package in node_modules bundled through an in-memory
//              plugin file system (namespace "m", no real file system: the way
//              esbuild-wasm runs in a browser), reference: esbuild-wasm's own
//              browser build (lib/browser.js, worker: false)
//
// Usage: node test/build-diff.mjs [--limit N] [--filter re] [--opts re] [--verbose]
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, dirname, posix, resolve as pathResolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const LIMIT = Number(arg("--limit", "1000000"));
const FILTER = new RegExp(arg("--filter", "."));
const OPTS = new RegExp(arg("--opts", "."));
const VERBOSE = args.includes("--verbose");
const REAL_FS = arg("--fs", "plugin") === "real";
// (in parallel: see shard.mjs; --jobs 1 runs in this process)
const { shardOf, jobsOf, runShards, printSummary, addUp } = await import("./shard.mjs");
const shard = shardOf(args);

const STATS = Symbol.for("@r1ck404/fast-esbuild-wasm:stats");
// (real FS: node.mjs, which uses the real file system; plugin FS: the
// browser build, worker: false, like the reference; its initialize()
// validates "wasmModule" and ignores it)
let fast;
if (REAL_FS) {
  fast = (await import("../node.mjs")).default;
  await fast.initialize({});
} else {
  globalThis.self ??= globalThis;
  fast = require("../lib/browser.js");
  await fast.initialize({ wasmModule: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])), worker: false });
}
let ref;
if (REAL_FS) ref = require("esbuild");
else {
  ref = require("esbuild-wasm/lib/browser.js");
  await ref.initialize({ wasmModule: new WebAssembly.Module(readFileSync(require.resolve("esbuild-wasm/esbuild.wasm"))), worker: false });
}

// ---------------------------------------------------------------------------
// The in-memory file system: the repository's node_modules as "/node_modules"

const nodeModules = pathResolve(here, "../../../node_modules");
const toReal = (p) => join(nodeModules, ...p.replace(/^\/node_modules\/?/, "").split("/"));
const toVirtual = (real) => "/node_modules/" + real.slice(nodeModules.length + 1).split(sep).join("/");
const fileCache = new Map();
function readVirtual(p) {
  let v = fileCache.get(p);
  if (v === undefined) {
    try {
      v = readFileSync(toReal(p));
    } catch {
      v = null;
    }
    fileCache.set(p, v);
  }
  return v;
}
function isFile(p) {
  if (!p.startsWith("/node_modules/")) return extraFiles.has(p);
  try {
    return statSync(toReal(p)).isFile();
  } catch {
    return false;
  }
}
const extraFiles = new Map();
extraFiles.set("/inject.js", "export let injectedValue = 42; export function injectedFn() { return injectedValue }\n");
extraFiles.set("/entry2.js", 'export const second = "two";\nexport default function () { return second }\n');

const EXTS = ["", ".js", ".mjs", ".cjs", ".json", "/index.js", "/index.mjs", "/index.cjs", "/index.json"];
function resolveVirtual(fromDir, spec) {
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") || spec === "." || spec === "..") {
    const base = spec.startsWith("/") ? spec : posix.join(fromDir, spec);
    for (const ext of EXTS) if (isFile(base + ext)) return base + ext;
    return null;
  }
  if (!fromDir.startsWith("/node_modules")) fromDir = "/node_modules";
  try {
    const real = createRequire(join(toReal(fromDir), "x.js")).resolve(spec);
    if (!real.startsWith(nodeModules)) return null; // (node builtins)
    return toVirtual(real);
  } catch {
    return null;
  }
}

function loaderFor(p) {
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".ts") || p.endsWith(".mts") || p.endsWith(".cts")) return "ts";
  if (p.endsWith(".tsx")) return "tsx";
  if (p.endsWith(".jsx")) return "jsx";
  if (p.endsWith(".txt") || p.endsWith(".md")) return "text";
  return "js";
}

// The plugin, with a log of its callbacks (each must run as often as with
// the reference)
function memfs(log) {
  return {
    name: "memfs",
    setup(b) {
      b.onStart(() => {
        log.push("start");
      });
      b.onResolve({ filter: /.*/ }, (a) => {
        log.push("resolve " + a.kind + " " + a.importer + " " + a.path);
        if (a.kind === "entry-point") return { path: a.path, namespace: "m" };
        const dir = a.importer ? posix.dirname(a.importer) : "/";
        const resolved = resolveVirtual(a.resolveDir || dir, a.path);
        if (resolved === null) return { external: true };
        return { path: resolved, namespace: "m" };
      });
      b.onLoad({ filter: /.*/, namespace: "m" }, (a) => {
        log.push("load " + a.path);
        const extra = extraFiles.get(a.path);
        const contents = extra !== undefined ? extra : readVirtual(a.path);
        if (contents === null) return undefined;
        return { contents, loader: loaderFor(a.path), resolveDir: posix.dirname(a.path) };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Scenarios

function packageEntries() {
  const entries = [];
  const pkgs = [];
  for (const name of readdirSync(nodeModules)) {
    if (name.startsWith(".")) continue;
    if (name.startsWith("@")) {
      for (const sub of readdirSync(join(nodeModules, name))) pkgs.push(name + "/" + sub);
    } else pkgs.push(name);
  }
  for (const pkg of pkgs.sort()) {
    const dir = join(nodeModules, ...pkg.split("/"));
    let json;
    try {
      json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const seen = new Set();
    const add = (real) => {
      if (real === null || !real.startsWith(nodeModules) || seen.has(real)) return;
      if (!/\.(m|c)?js$|\.json$/.test(real)) return;
      seen.add(real);
      entries.push({ pkg, entry: toVirtual(real) });
    };
    try {
      add(createRequire(join(dir, "x.js")).resolve(pkg));
    } catch {}
    if (typeof json.module === "string") {
      const m = join(dir, json.module);
      if (existsSync(m)) add(m);
    }
  }
  return entries;
}

// Option sets. "entries" says which entry points: "one" (the package entry),
// "two" (plus /entry2.js)
const OPTION_SETS = [
  { name: "esm", entries: "one", options: { bundle: true, format: "esm" } },
  { name: "cjs-node", entries: "one", options: { bundle: true, format: "cjs", platform: "node" } },
  { name: "iife-min", entries: "one", options: { bundle: true, format: "iife", globalName: "G", minify: true } },
  { name: "esm-es2015-keep", entries: "one", options: { bundle: true, format: "esm", target: "es2015", keepNames: true } },
  { name: "cjs-sourcemap-inline", entries: "one", options: { bundle: true, format: "cjs", sourcemap: "inline" } },
  { name: "esm-outdir-meta", entries: "one", options: { bundle: true, format: "esm", outdir: "out", metafile: true, sourcemap: "external", entryNames: "[dir]/[name]-[hash]" } },
  { name: "split", entries: "two", options: { bundle: true, format: "esm", splitting: true, outdir: "out", metafile: true, chunkNames: "chunks/[name]-[hash]" } },
  { name: "two-nosplit", entries: "two", options: { bundle: true, format: "cjs", outdir: "out", metafile: true } },
  { name: "neutral-min-legal", entries: "one", options: { bundle: true, platform: "neutral", minify: true, legalComments: "external", outdir: "out" } },
  { name: "define-inject", entries: "one", options: { bundle: true, format: "esm", define: { "process.env.NODE_ENV": '"production"' }, inject: ["/inject.js"] } },
  { name: "no-bundle-cjs", entries: "one", options: { format: "cjs" } },
  { name: "linked-map", entries: "one", options: { bundle: true, format: "esm", outfile: "out/bundle.js", sourcemap: true, sourcesContent: false } },
];

// ---------------------------------------------------------------------------
// Real file system (--fs real): the same packages from the real node_modules
// through the resolver, plus small projects for the resolver's features
// (tsconfig paths/baseUrl/extends/jsx, exports/imports maps and conditions,
// the "browser" field, sideEffects, loaders)

const worktreeRoot = pathResolve(here, "../../..");
const fixtureRoot = join(tmpdir(), "esb-build-diff-fixtures" + (shard === null ? "" : "-" + shard.index));

// A plugin that only watches (the resolver and the file system do the work)
function observer(log) {
  return {
    name: "observer",
    setup(b) {
      b.onStart(() => {
        log.push("start");
      });
      b.onResolve({ filter: /^[^.]/ }, (a) => {
        log.push("resolve " + a.kind + " " + a.importer + " " + a.path);
        return undefined;
      });
      b.onLoad({ filter: /\.json$/ }, (a) => {
        log.push("load " + a.path);
        return undefined;
      });
    },
  };
}

const REAL_FS_OPTION_SETS = [
  { name: "browser-default", entries: "one", options: { bundle: true } },
  { name: "node-packages-external", entries: "one", options: { bundle: true, platform: "node", format: "esm", packages: "external" } },
  { name: "main-fields-conditions", entries: "one", options: { bundle: true, format: "esm", mainFields: ["main", "module"], conditions: ["development"] } },
  { name: "external-alias", entries: "one", options: { bundle: true, format: "esm", external: ["react", "*.json"], alias: { lodash: "lodash-es" } } },
];

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

const FIXTURE_FILES = {
  "inject.js": "export let injectedValue = 42; export function injectedFn() { return injectedValue }\n",
  "entry2.js": 'export const second = "two";\nexport default function () { return second }\n',

  // A TypeScript project
  "ts/tsconfig.base.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["src/lib/*"], "~/*": ["./src/*"] } } }),
  "ts/tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.json", compilerOptions: { jsx: "react-jsx", experimentalDecorators: true, useDefineForClassFields: false } }),
  "ts/tsconfig.other.json": JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "h", jsxFragmentFactory: "Frag", paths: { "@lib/*": ["./src/lib/*"], "~/*": ["./src/*"] } } }),
  "ts/node_modules/react/package.json": JSON.stringify({ name: "react", exports: { ".": "./index.js", "./jsx-runtime": "./jsx-runtime.js", "./jsx-dev-runtime": "./jsx-runtime.js" } }),
  "ts/node_modules/react/index.js": "exports.createElement = function () {}; exports.Fragment = 'F';\n",
  "ts/node_modules/react/jsx-runtime.js": "exports.jsx = exports.jsxs = exports.jsxDEV = function () {}; exports.Fragment = 'F';\n",
  "ts/package.json": JSON.stringify({ name: "ts-proj", type: "module", imports: { "#internal": "./src/internal.js", "#dep/*": "dep/*" } }),
  "ts/src/index.ts": [
    'import { add } from "@lib/math";',
    'import { mul } from "~/lib/mul";',
    'import data from "./data.json";',
    'import { version } from "./data.json";',
    'import txt from "./readme.txt";',
    'import logo from "./logo.png";',
    'import App from "./App";',
    'import { internal } from "#internal";',
    'import dep, { named } from "dep";',
    'import feature from "dep/feature";',
    'import extra from "#dep/extra.js";',
    'import type { T } from "./types";',
    "function log(target: any, key: string) {}",
    "class K { @log method() {} x: number = 1 }",
    "export const t: T = 1 as T;",
    "export default [add(1, 2), mul(2, 3), data.name, version, txt, logo, App, internal, dep, named, feature, extra, new K()];",
    'export const lazy = () => import("./lazy");',
    "",
  ].join("\n"),
  "ts/src/types.ts": "export type T = number;\n",
  "ts/src/lazy.ts": 'import { add } from "@lib/math";\nexport const lazyValue = add(40, 2);\n',
  "ts/src/lib/math.ts": "export function add(a: number, b: number): number { return a + b }\nexport function unused() { return 1 }\n",
  "ts/src/lib/mul.ts": "export const mul = (a: number, b: number) => a * b;\n",
  "ts/src/App.tsx": "export default function App() { return <><div className=\"app\">hi</div></> }\n",
  "ts/src/internal.js": "export const internal = 'internal';\n",
  "ts/src/data.json": JSON.stringify({ name: "data", version: "1.2.3", nested: { a: [1, 2, 3] } }),
  "ts/src/readme.txt": "Hello, text loader\n",
  "ts/node_modules/dep/package.json": JSON.stringify({
    name: "dep",
    sideEffects: ["./esm/effect.js"],
    exports: {
      ".": { import: "./esm/index.js", require: "./cjs/index.js" },
      "./feature": { browser: "./feature-browser.js", node: "./feature-node.js", default: "./feature.js" },
      "./*": "./extras/*",
      "./package.json": "./package.json",
    },
  }),
  "ts/node_modules/dep/esm/index.js": 'import "./effect.js";\nimport "./pure.js";\nexport const named = "esm";\nexport default "dep-esm";\n',
  "ts/node_modules/dep/esm/effect.js": "globalThis.effect = 1;\n",
  "ts/node_modules/dep/esm/pure.js": "globalThis.pure = 1;\n",
  "ts/node_modules/dep/cjs/index.js": 'exports.named = "cjs"; exports.default = "dep-cjs";\n',
  "ts/node_modules/dep/feature.js": 'export default "feature";\n',
  "ts/node_modules/dep/feature-browser.js": 'export default "feature-browser";\n',
  "ts/node_modules/dep/feature-node.js": 'export default "feature-node";\n',
  "ts/node_modules/dep/extras/extra.js": 'export default "extra";\n',

  // A CommonJS project with the "browser" field
  "cjs/package.json": JSON.stringify({ name: "cjs-proj", main: "./src/index.js", browser: { "./src/server.js": "./src/client.js", fs: false, "./src/gone.js": false } }),
  "cjs/src/index.js": 'const impl = require("./server");\nconst fs = require("fs");\nconst gone = require("./gone");\nconst pkg = require("pkg");\nmodule.exports = { impl, fs, gone, pkg, main: require("../package.json").name };\n',
  "cjs/src/server.js": 'module.exports = "server";\n',
  "cjs/src/client.js": 'module.exports = "client";\n',
  "cjs/src/gone.js": 'module.exports = "gone";\n',
  "cjs/node_modules/pkg/package.json": JSON.stringify({ name: "pkg", main: "main.js", module: "module.js", browser: "browser.js" }),
  "cjs/node_modules/pkg/main.js": 'module.exports = "main";\n',
  "cjs/node_modules/pkg/module.js": 'export default "module";\n',
  "cjs/node_modules/pkg/browser.js": 'module.exports = "browser";\n',

  // Glob imports and glob entry points
  "glob/src/index.js": [
    "const name = globalThis.name;",
    "export const a = import(`./pages/${name}.js`);",
    'export const b = require("./pages/" + name + ".js");',
    'export const c = import("./pages/sub/" + name);',
    "export const d = require(`./data/${name}.json`);",
    "export const e = import(`./pages/${name}/index.js`);",
    "",
  ].join("\n"),
  "glob/src/data-urls.js": [
    `import a from "data:text/javascript,export default 'js'";`,
    `import b from 'data:application/json,{"x":1,"y":[2]}';`,
    `import c from "data:text/javascript;base64,ZXhwb3J0IGRlZmF1bHQgImI2NCI=";`,
    `import d from "data:text/javascript,export%20default%20%22percent%22%3B%20export%20const%20long%20%3D%20%22aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%22";`,
    `console.log(a, b, c, d);`,
    "",
  ].join("\n"),
  "glob/src/pages/a.js":'export default "a";\n',
  "glob/src/pages/b.js": 'module.exports = "b";\n',
  "glob/src/pages/sub/c.js": 'export default "c";\n',
  "glob/src/pages/sub/d.ts": 'export default "d" as string;\n',
  "glob/src/pages/x/index.js": 'export default "x";\n',
  "glob/src/data/one.json": '{ "one": 1 }\n',
  "glob/src/data/two.json": '{ "two": 2 }\n',
};

function writeFixtures() {
  for (const [rel, contents] of Object.entries(FIXTURE_FILES)) {
    const file = join(fixtureRoot, ...rel.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  writeFileSync(join(fixtureRoot, "ts", "src", "logo.png"), PNG);
}
if (REAL_FS) writeFixtures();

function projectJobs() {
  const ts = join(fixtureRoot, "ts");
  const cjs = join(fixtureRoot, "cjs");
  const loader = { ".png": "file", ".txt": "text" };
  const tsEntry = join(ts, "src", "index.ts");
  const cjsEntry = join(cjs, "src", "index.js");
  const glob = join(fixtureRoot, "glob");
  const globEntry = join(glob, "src", "index.js");
  const sets = [
    ["ts", tsEntry, { bundle: true, format: "esm", outdir: "out", loader, metafile: true }],
    ["ts", tsEntry, { bundle: true, format: "esm", outdir: "out", loader, splitting: true, minify: true, sourcemap: "external", metafile: true, assetNames: "assets/[name]-[hash]" }],
    ["ts", tsEntry, { bundle: true, format: "cjs", platform: "node", outdir: "out", loader: { ".png": "dataurl", ".txt": "base64" } }],
    ["ts", tsEntry, { bundle: true, format: "esm", outdir: "out", loader: { ".png": "binary", ".txt": "text" }, tsconfig: "tsconfig.other.json" }],
    ["ts", tsEntry, { bundle: true, format: "iife", outfile: "out/app.js", loader: { ".png": "copy", ".txt": "empty" }, platform: "neutral", mainFields: ["module", "main"] }],
    ["ts", tsEntry, { bundle: true, format: "esm", outdir: "out", loader, conditions: ["custom"], external: ["dep"] }],
    ["ts", tsEntry, { bundle: true, format: "esm", outdir: "out", loader, tsconfigRaw: { compilerOptions: { jsx: "preserve", baseUrl: ".", paths: { "@lib/*": ["src/lib/*"], "~/*": ["src/*"] } } }, outExtension: { ".js": ".mjs" } }],
    ["cjs", cjsEntry, { bundle: true, outdir: "out" }],
    ["cjs", cjsEntry, { bundle: true, outdir: "out", platform: "node" }],
    ["cjs", cjsEntry, { bundle: true, outdir: "out", format: "esm", mainFields: ["module", "main"], minify: true, metafile: true }],
    ["cjs", cjsEntry, { bundle: true, outdir: "out", platform: "neutral", mainFields: ["browser", "main"], external: ["fs"] }],
    ["glob", globEntry, { bundle: true, format: "esm", outdir: "out", metafile: true }],
    ["glob", globEntry, { bundle: true, format: "esm", outdir: "out", splitting: true, minify: true }],
    ["glob", globEntry, { bundle: true, format: "cjs", outdir: "out", sourcemap: true }],
    ["glob", join(glob, "src", "data-urls.js"), { bundle: true, format: "esm", outdir: "out", metafile: true, sourcemap: true }],
    ["glob", join(glob, "src", "data-urls.js"), { bundle: true, format: "iife", minify: true }],
    ["glob", "src/pages/**/*.js",{ bundle: true, format: "esm", outdir: "out", metafile: true }],
    ["glob", "./src/pages/*.js", { bundle: true, format: "esm", outbase: "src", outdir: "out", splitting: true }],
  ];
  return sets.map(([pkg, entry, options], i) => ({
    pkg: "fixture:" + pkg,
    entry,
    set: { name: "project-" + i },
    options: { entryPoints: [entry], absWorkingDir: { ts, cjs, glob }[pkg], ...options },
  }));
}

// ---------------------------------------------------------------------------
// Comparison

function describe(result) {
  if (result.error) return { error: result.error, errors: JSON.stringify(result.errors), warnings: JSON.stringify(result.warnings) };
  const r = result.value;
  return {
    outputFiles: (r.outputFiles || []).map((f) => ({ path: f.path, hash: f.hash, text: Buffer.from(f.contents).toString("latin1") })),
    metafile: r.metafile === undefined ? undefined : JSON.stringify(r.metafile),
    mangleCache: r.mangleCache === undefined ? undefined : JSON.stringify(r.mangleCache),
    errors: JSON.stringify(r.errors),
    warnings: JSON.stringify(r.warnings),
  };
}

async function runBuild(esbuild, options) {
  const log = [];
  try {
    const value = await esbuild.build({ ...options, write: false, logLevel: "silent", plugins: [REAL_FS ? observer(log) : memfs(log)] });
    return { value, log };
  } catch (e) {
    return { error: String(e && e.message), errors: e && e.errors, warnings: e && e.warnings, log };
  }
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

let total = 0;
let same = 0;
let diff = 0;
let bothFailed = 0;
const bailReasons = new Map();
let fastBuilds = 0;
const entries = packageEntries().filter((e) => FILTER.test(e.pkg));
const jobs = [];
for (const { pkg, entry } of entries) {
  for (const set of REAL_FS ? OPTION_SETS.concat(REAL_FS_OPTION_SETS) : OPTION_SETS) {
    if (!OPTS.test(set.name)) continue;
    if (REAL_FS) {
      const entryPoints = set.entries === "two" ? [toReal(entry), join(fixtureRoot, "entry2.js")] : [toReal(entry)];
      const options = { entryPoints, absWorkingDir: worktreeRoot, ...set.options };
      if (options.inject) options.inject = [join(fixtureRoot, "inject.js")];
      jobs.push({ pkg, entry, set, options });
    } else {
      const entryPoints = set.entries === "two" ? [entry, "/entry2.js"] : [entry];
      jobs.push({ pkg, entry, set, options: { entryPoints, ...set.options } });
    }
  }
}
if (REAL_FS) {
  for (const job of projectJobs()) if (FILTER.test(job.pkg) && OPTS.test(job.set.name)) jobs.push(job);
}
if (shard === null && jobsOf(args) > 1) {
  const n = Math.min(jobsOf(args), Math.max(1, jobs.length));
  const t0 = performance.now();
  const sums = addUp(await runShards(fileURLToPath(import.meta.url), args, n));
  console.log(`\nbuild-diff (${REAL_FS ? "real FS vs native esbuild" : "plugin FS"}): ${sums.total} builds, ${sums.same} same, ${sums.diff} different (${sums.bothFailed} failed in both), fast path ${sums.fastBuilds} (${((performance.now() - t0) / 1000).toFixed(0)}s in ${n} processes)`);
  fast.stop();
  ref.stop();
  process.exit(sums.diff > 0 ? 1 : 0);
}
let jobIndex = 0;
outer: for (const { pkg, entry, set, options } of jobs) {
  if (shard !== null) {
    const i = jobIndex++;
    if (i >= LIMIT) break;
    if (!shard.take(i)) continue;
  }
  {
    if (total >= LIMIT) break outer;
    total++;
    const a = await runBuild(ref, options);
    const b = await runBuild(fast, options);
    const took = 1; // (every build runs in the engine)
    fastBuilds += took;
    const da = describe(a),
      db = describe(b);
    const ja = JSON.stringify(da),
      jb = JSON.stringify(db);
    const logA = a.log.slice().sort().join("\n"),
      logB = b.log.slice().sort().join("\n");
    if (a.error && b.error && ja === jb) bothFailed++;
    if (ja === jb && logA === logB) {
      same++;
      continue;
    }
    diff++;
    console.log(`DIFF ${pkg} ${entry} [${set.name}] (${took ? "fast" : "go"})`);
    if (logA !== logB) {
      console.log("  plugin callbacks differ: ref " + a.log.length + ", fast " + b.log.length);
      const sa = new Set(a.log),
        sb = new Set(b.log);
      for (const x of a.log) if (!sb.has(x)) console.log("    only ref: " + x);
      for (const x of b.log) if (!sa.has(x)) console.log("    only fast: " + x);
      const count = (l) => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
      const ca = count(a.log),
        cb = count(b.log);
      for (const [k, v] of cb) if (ca.get(k) !== v && sa.has(k)) console.log(`    count ${k}: ref ${ca.get(k)}, fast ${v}`);
    }
    if (ja !== jb) {
      if (da.error || db.error) {
        console.log("  ref: " + (da.error || "ok") + "\n  fast: " + (db.error || "ok"));
        for (const k of ["errors", "warnings"]) {
          if (da[k] !== db[k]) {
            const i = firstDiff(da[k] || "", db[k] || "");
            console.log(`  ${k} differs at ${i}:\n    ref:  ${JSON.stringify((da[k] || "").slice(Math.max(0, i - 80), i + 200))}\n    fast: ${JSON.stringify((db[k] || "").slice(Math.max(0, i - 80), i + 200))}`);
          }
        }
      } else {
        for (const k of ["metafile", "mangleCache", "errors", "warnings"]) {
          if (da[k] !== db[k]) {
            const i = firstDiff(da[k] || "", db[k] || "");
            console.log(`  ${k} differs at ${i}:\n    ref:  ${JSON.stringify((da[k] || "").slice(Math.max(0, i - 80), i + 120))}\n    fast: ${JSON.stringify((db[k] || "").slice(Math.max(0, i - 80), i + 120))}`);
          }
        }
        if (da.outputFiles.length !== db.outputFiles.length) console.log(`  outputFiles: ref ${da.outputFiles.length}, fast ${db.outputFiles.length}: ${da.outputFiles.map((f) => f.path)} / ${db.outputFiles.map((f) => f.path)}`);
        for (let k = 0; k < Math.min(da.outputFiles.length, db.outputFiles.length); k++) {
          const fa = da.outputFiles[k],
            fb = db.outputFiles[k];
          if (fa.path !== fb.path) console.log(`  path ${k}: ref ${fa.path}, fast ${fb.path}`);
          if (fa.text !== fb.text) {
            const i = firstDiff(fa.text, fb.text);
            console.log(`  file ${fa.path} differs at ${i} (of ${fa.text.length}/${fb.text.length}):\n    ref:  ${JSON.stringify(fa.text.slice(Math.max(0, i - 100), i + 150))}\n    fast: ${JSON.stringify(fb.text.slice(Math.max(0, i - 100), i + 150))}`);
            if (!VERBOSE) break;
          } else if (fa.hash !== fb.hash) console.log(`  hash ${k}: ref ${fa.hash}, fast ${fb.hash}`);
        }
      }
    }
  }
}

// Real FS: context() rebuilds while files change (the file system cache must
// see every change, like Go's)
if (REAL_FS && FILTER.test("fixture:context") && total < LIMIT && (shard === null || shard.index === 0)) {
  const dir = join(fixtureRoot, "ctx");
  const file = (name) => join(dir, "src", name);
  const write = (name, text) => {
    mkdirSync(dirname(file(name)), { recursive: true });
    writeFileSync(file(name), text);
  };
  const steps = [
    () => {
      rmSync(join(dir, "src"), { recursive: true, force: true });
      write("index.js", 'import { v } from "./lib.js";\nconsole.log(v);\n');
      write("lib.js", "export const v = 1;\n");
    },
    () => write("lib.js", "export const v = 2; export const w = 3;\n"),
    () => write("index.js", 'import { v, w } from "./lib.js";\nimport extra from "./extra.js";\nconsole.log(v, w, extra);\n'),
    () => write("extra.js", "export default 'extra';\n"),
    () => write("index.js", 'import { v } from "./lib.js";\nconsole.log(v);\n'),
  ];
  const run = async (esbuild) => {
    steps[0]();
    const log = [];
    const ctx = await esbuild.context({ entryPoints: [file("index.js")], absWorkingDir: dir, bundle: true, write: false, logLevel: "silent", format: "esm", metafile: true, plugins: [observer(log)] });
    const out = [];
    for (let i = 0; i < steps.length; i++) {
      if (i > 0) {
        steps[i]();
        // (a different modification time and size for every change)
        await new Promise((r) => setTimeout(r, 20));
      }
      try {
        out.push(describe({ value: await ctx.rebuild() }));
      } catch (e) {
        out.push({ error: String(e && e.message) });
      }
    }
    await ctx.dispose();
    return { out: JSON.stringify(out), log: log.join("\n") };
  };
  const a = await run(ref);
  const b = await run(fast);
  total++;
  fastBuilds++;
  if (a.out === b.out && a.log === b.log) same++;
  else {
    diff++;
    console.log("DIFF context rebuilds with changing files" + (a.log !== b.log ? " (plugin callbacks differ)" : ""));
    if (VERBOSE) console.log("  ref:  " + a.out + "\n  fast: " + b.out);
  }
}

if (shard !== null) {
  fast.stop();
  ref.stop();
  printSummary({ total, same, diff, bothFailed, fastBuilds });
  process.exit(0);
}
console.log(`\nbuild-diff (${REAL_FS ? "real FS vs native esbuild" : "plugin FS"}): ${total} builds, ${same} same, ${diff} different (${bothFailed} failed in both), fast path ${fastBuilds}`);
const sorted = [...bailReasons].sort((a, b) => b[1] - a[1]);
if (sorted.length > 0) console.log("fallbacks to Go:\n" + sorted.map(([k, v]) => `  ${v}  ${k}`).join("\n"));
fast.stop();
ref.stop();
process.exit(diff > 0 ? 1 : 0);
