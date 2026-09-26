// Differential test: fast-esbuild-wasm's JS transform vs real esbuild 0.28.2
// (the native package; same Go code as esbuild-wasm) over a corpus of real
// files and option sets.
//
// usage: node test/diff.mjs [--limit N] [--dir path]... [--opts name,name] [--file path]
//                           [--show N] [--stop] [--quiet]
// Categories:
//   ok            identical output
//   bail          fast path declined (falls back to esbuild) — fine
//   bothFail      esbuild errors and the fast path declined — fine
//   FALSE-ACCEPT  esbuild errors but the fast path produced output — BUG
//   WARN-ACCEPT   esbuild warns but the fast path produced output — BUG
//   MISMATCH      different output — BUG
//   CRASH         the port threw a non-bail exception (would fall back, but is a bug)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const { fastTransform, stats } = await import("../src/transform.mjs");

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
const onlyOpts = getArg("--opts", null)?.split(",");
const singleFile = getArg("--file", null);

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
  ],
  jsx: [
    ["jsx", { loader: "jsx" }],
    ["jsx-cjs", nodepodCjs("jsx")],
    ["jsx-dev", { loader: "jsx", format: "esm", tsconfigRaw: { compilerOptions: { jsx: "react-jsxdev", jsxImportSource: "@emotion/react" } } }],
    // source maps
    ["jsx-map", { loader: "jsx", sourcemap: true }],
    ["jsx-cjs-map", { ...nodepodCjs("jsx"), sourcemap: "inline", sourcefile: "c" + String.fromCharCode(0xf6) + "mp.jsx" }],
  ],
};

// Mirror of the glue's flagsForTransformOptions for the options used here
function flagsFor(o) {
  const flags = ["--log-level=silent", "--log-limit=0"];
  if (o.legalComments) flags.push(`--legal-comments=${o.legalComments}`);
  if (o.sourceRoot !== undefined) flags.push(`--source-root=${o.sourceRoot}`);
  if (o.sourcesContent !== undefined) flags.push(`--sources-content=${o.sourcesContent}`);
  if (o.target) flags.push(`--target=${o.target}`);
  if (o.format) flags.push(`--format=${o.format}`);
  if (o.globalName) flags.push(`--global-name=${o.globalName}`);
  if (o.platform) flags.push(`--platform=${o.platform}`);
  if (o.tsconfigRaw) flags.push(`--tsconfig-raw=${typeof o.tsconfigRaw === "string" ? o.tsconfigRaw : JSON.stringify(o.tsconfigRaw)}`);
  if (o.charset) flags.push(`--charset=${o.charset}`);
  if (o.treeShaking !== undefined) flags.push(`--tree-shaking=${o.treeShaking}`);
  if (o.jsx) flags.push(`--jsx=${o.jsx}`);
  if (o.jsxFactory) flags.push(`--jsx-factory=${o.jsxFactory}`);
  if (o.jsxFragment) flags.push(`--jsx-fragment=${o.jsxFragment}`);
  if (o.jsxImportSource) flags.push(`--jsx-import-source=${o.jsxImportSource}`);
  if (o.jsxDev) flags.push(`--jsx-dev`);
  if (o.define) for (const key in o.define) flags.push(`--define:${key}=${o.define[key]}`);
  if (o.sourcemap) flags.push(`--sourcemap=${o.sourcemap === true ? "external" : o.sourcemap}`);
  if (o.sourcefile) flags.push(`--sourcefile=${o.sourcefile}`);
  if (o.loader) flags.push(`--loader=${o.loader}`);
  if (o.banner) flags.push(`--banner=${o.banner}`);
  if (o.footer) flags.push(`--footer=${o.footer}`);
  return flags;
}

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
      if (e.name === ".git") continue;
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
if (singleFile) files = [resolve(singleFile)];
else {
  const dirs = getAll("--dir");
  if (dirs.length === 0) dirs.push(join(here, "../../node_modules"), join(here, "../../../../src"));
  const seen = new Set();
  files = [];
  for (const d of dirs) for (const f of walk(resolve(d), seen)) files.push(f);
}
files = files.slice(0, limit);

const counts = { ok: 0, bail: 0, bothFail: 0, "FALSE-ACCEPT": 0, "WARN-ACCEPT": 0, MISMATCH: 0, CRASH: 0 };
const perOpt = {};
const shown = {};
const t0 = performance.now();
let tFast = 0;
let tRef = 0;
outer: for (const file of files) {
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
    let t = performance.now();
    try {
      ref = esbuild.transformSync(code, opts);
    } catch {}
    tRef += performance.now() - t;
    const errBefore = stats.error;
    t = performance.now();
    const fast = fastTransform(flagsFor(opts), code, undefined);
    tFast += performance.now() - t;
    let cat;
    if (stats.error !== errBefore) cat = "CRASH";
    else if (fast === undefined) cat = ref === null ? "bothFail" : "bail";
    else if (ref === null) cat = "FALSE-ACCEPT";
    else if (ref.warnings.length > 0) cat = "WARN-ACCEPT";
    else if (fast.code !== ref.code || (fast.legalComments ?? undefined) !== (ref.legalComments ?? undefined)) cat = "MISMATCH";
    else if (fast.map !== ref.map) cat = "MISMATCH";
    else cat = "ok";
    counts[cat]++;
    (perOpt[name] ??= { ok: 0, bail: 0, bad: 0 })[cat === "ok" ? "ok" : cat === "bail" || cat === "bothFail" ? "bail" : "bad"]++;
    if (cat !== "ok" && cat !== "bail" && cat !== "bothFail") {
      shown[cat] = (shown[cat] || 0) + 1;
      if (!quiet && shown[cat] <= showN) {
        console.log(`${cat} [${name}] ${file}`);
        if (cat === "MISMATCH") console.log(fast.code !== ref.code ? firstDiff(ref.code, fast.code) : "  (source map)\n" + firstDiff(ref.map, fast.map));
        if (cat === "CRASH") console.log("  " + String(stats.lastError && stats.lastError.stack).split("\n").slice(0, 6).join("\n  "));
        if (cat === "WARN-ACCEPT") console.log("  warning: " + ref.warnings[0].text);
      }
      if (stopOnFail) break outer;
    }
  }
}
console.log(`${files.length} files in ${((performance.now() - t0) / 1000).toFixed(1)}s (esbuild native ${(tRef / 1000).toFixed(1)}s, fast ${(tFast / 1000).toFixed(1)}s)`);
console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "));
console.log(Object.entries(perOpt).map(([k, v]) => `${k}: ok ${v.ok} bail ${v.bail} bad ${v.bad}`).join(" | "));
