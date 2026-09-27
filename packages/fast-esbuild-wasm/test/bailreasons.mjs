// Finds unnecessary bails: inputs where esbuild succeeds without warnings but
// the fast path declines. Aggregates the bail sites (from BAIL_TRACE stacks).
// usage: node test/bailreasons.mjs [--limit N] [--opts name,...] [--dir path] [--examples N]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const { fastTransform } = await import("../src/transform.mjs");
const { BAIL_TRACE } = await import("../src/bail.mjs");
BAIL_TRACE.enabled = true;

const args = process.argv.slice(2);
const get = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const limit = Number(get("--limit", Infinity));
const onlyOpts = get("--opts", null)?.split(",");
const nExamples = Number(get("--examples", 2));
const dirs = args.flatMap((a, i) => (a === "--dir" ? [args[i + 1]] : []));
if (dirs.length === 0) dirs.push(join(here, "../../../node_modules"), join(here, "../../../../Nodepod/src"));

const importMetaDefine = {
  "import.meta.url": "import_meta.url",
  "import.meta.dirname": "import_meta.dirname",
  "import.meta.filename": "import_meta.filename",
  "import.meta": "import_meta",
};
const nodepodCjs = (loader) => ({ loader, format: "cjs", target: "esnext", platform: "neutral", define: importMetaDefine });
const OPTION_SETS = {
  js: [
    ["js", { loader: "js" }],
    ["cjs", nodepodCjs("js")],
    ["esm", { loader: "js", format: "esm" }],
    ["iife", { loader: "js", format: "iife" }],
  ],
  ts: [
    ["ts", { loader: "ts" }],
    ["ts-cjs", nodepodCjs("ts")],
  ],
  tsx: [["tsx", { loader: "tsx" }]],
  jsx: [["jsx", { loader: "jsx" }]],
};
// "tsconfigRaw" sets: only run when selected with --opts
const TSCONFIG_SETS = {
  js: [["js-strict", { loader: "js", tsconfigRaw: { compilerOptions: { strict: true } } }]],
  ts: [
    ["ts-vite", { loader: "ts", target: "esnext", tsconfigRaw: { compilerOptions: { useDefineForClassFields: true, verbatimModuleSyntax: true } } }],
    ["ts-decorators", { loader: "ts", tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } }],
    ["ts-es2019", { loader: "ts", tsconfigRaw: { compilerOptions: { target: "es2019" } } }],
    ["ts-strict", { loader: "ts", tsconfigRaw: { compilerOptions: { importsNotUsedAsValues: "preserve", alwaysStrict: true } } }],
  ],
  tsx: [
    ["tsx-decorators", { loader: "tsx", tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } }],
    ["tsx-preact", { loader: "tsx", tsconfigRaw: { compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" } } }],
  ],
  jsx: [["jsx-dev", { loader: "jsx", format: "esm", tsconfigRaw: { compilerOptions: { jsx: "react-jsxdev", jsxImportSource: "@emotion/react" } } }]],
};
if (onlyOpts) for (const kind in TSCONFIG_SETS) OPTION_SETS[kind].push(...TSCONFIG_SETS[kind]);
function flagsFor(o) {
  const flags = ["--log-level=silent", "--log-limit=0"];
  if (o.target) flags.push(`--target=${o.target}`);
  if (o.format) flags.push(`--format=${o.format}`);
  if (o.platform) flags.push(`--platform=${o.platform}`);
  if (o.tsconfigRaw) flags.push(`--tsconfig-raw=${typeof o.tsconfigRaw === "string" ? o.tsconfigRaw : JSON.stringify(o.tsconfigRaw)}`);
  if (o.define) for (const key in o.define) flags.push(`--define:${key}=${o.define[key]}`);
  if (o.loader) flags.push(`--loader=${o.loader}`);
  return flags;
}
function kindOf(file) {
  if (/\.d\.[mc]?ts$/.test(file)) return "ts";
  const ext = extname(file);
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
    if (e.isDirectory()) yield* walk(p, seen);
    else if (kindOf(p)) {
      try {
        const st = statSync(p);
        const key = `${st.size}:${st.ino}:${st.mtimeMs}`;
        if (st.size > 12e6 || seen.has(key)) continue;
        seen.add(key);
      } catch {
        continue;
      }
      yield p;
    }
  }
}

const seen = new Set();
const files = [];
for (const d of dirs) for (const f of walk(resolve(d), seen)) files.push(f);
files.length = Math.min(files.length, limit);

const sites = new Map();
let total = 0;
for (const file of files) {
  const code = readFileSync(file, "utf8");
  for (const [name, opts] of OPTION_SETS[kindOf(file)]) {
    if (onlyOpts && !onlyOpts.includes(name)) continue;
    let ref;
    try {
      ref = esbuild.transformSync(code, opts);
    } catch {
      continue;
    }
    if (ref.warnings.length > 0) continue;
    BAIL_TRACE.stack = null;
    if (fastTransform(flagsFor(opts), code, undefined) !== undefined) continue;
    total++;
    const frames = (BAIL_TRACE.stack || "(no trace: direct throw BAIL / LEXER_PANIC / RangeError)")
      .split("\n")
      .slice(1)
      .map((l) => l.trim().replace(/^at /, "").replace(/\(file:.*\/src\//, "(").replace(/file:.*\/src\//, ""))
      .filter((l) => !/bail\.mjs|logger\.mjs/.test(l))
      .slice(0, 3)
      .join(" <- ");
    const key = `[${name}] ${frames}`;
    let entry = sites.get(key);
    if (!entry) sites.set(key, (entry = { n: 0, examples: [] }));
    entry.n++;
    if (entry.examples.length < nExamples) entry.examples.push(file);
  }
}
console.log(`${total} unnecessary bails in ${files.length} files`);
for (const [key, { n, examples }] of [...sites].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${String(n).padStart(5)}  ${key}`);
  for (const e of examples) console.log(`         e.g. ${e}`);
}
