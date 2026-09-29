// Independent differential check: @r1ck404/fast-esbuild-wasm vs official esbuild-wasm
// 0.28.2 through the public transform() API (result objects, warnings, errors),
// with Nodepod's module-transformer options and Vite-style ts/tsx options.
// usage: node verify/verify-esbuild.mjs [nJs] [nTs]
import * as O from "esbuild-wasm";
import { join, delimiter } from "node:path";
import { pathToFileURL } from "node:url";
import { allFiles, sample, readText, rnd, rint, pick, Tally, root, walk, here } from "./corpus.mjs";

const F = await import(process.env.FAST_ESBUILD ? pathToFileURL(process.env.FAST_ESBUILD).href : "@r1ck404/fast-esbuild-wasm/node.mjs");
await F.initialize({});
const stats = F.default[Symbol.for("@r1ck404/fast-esbuild-wasm:stats")];
const NJ = Number(process.argv[2] || 800);
const NT = Number(process.argv[3] || 600);
const T = new Tally("esbuild");

const nodepod = (file) => ({
  loader: file.endsWith(".jsx") ? "jsx" : file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") || file.endsWith(".mts") || file.endsWith(".cts") ? "ts" : "js",
  format: "cjs",
  target: "esnext",
  platform: "neutral",
  define: {
    "import.meta.url": "import_meta.url",
    "import.meta.dirname": "import_meta.dirname",
    "import.meta.filename": "import_meta.filename",
    "import.meta": "import_meta",
  },
});
const viteTs = (file) => ({
  loader: file.endsWith(".tsx") ? "tsx" : "ts",
  sourcemap: true,
  sourcefile: file.replace(/\\/g, "/"),
  target: "esnext",
  format: "esm",
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: true, jsx: "react-jsx" } },
});
const variants = [
  (f) => ({}),
  (f) => ({ loader: f.endsWith(".tsx") ? "tsx" : f.match(/\.[cm]?ts$/) ? "ts" : "js", format: "esm", sourcemap: "external", sourcesContent: false }),
  (f) => ({ loader: f.endsWith(".tsx") ? "tsx" : f.match(/\.[cm]?ts$/) ? "ts" : "js", format: "iife", globalName: "G", legalComments: "eof" }),
  (f) => ({ loader: f.endsWith(".tsx") ? "tsx" : f.match(/\.[cm]?ts$/) ? "ts" : "jsx", jsx: "automatic", jsxDev: true, sourcemap: "inline" }),
  (f) => ({ minify: true }), // fallback path
  (f) => ({ target: "es2019", format: "cjs" }), // fallback path
];

const ser = (r) => JSON.stringify(r, (k, v) => (v instanceof Uint8Array ? "u8:" + Buffer.from(v).toString("base64") : v));
async function run(E, src, opts) {
  try {
    return "OK " + ser(await E.transform(src, opts));
  } catch (e) {
    return "ERR " + e.message + " " + ser(e.errors) + " " + ser(e.warnings);
  }
}
async function cmp(what, src, opts) {
  const [a, b] = await Promise.all([run(O, src, { ...opts }), run(F, src, { ...opts })]);
  if (!T.ok(a === b, what)) {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    T.first[T.first.length - 1] += `\n    wasm: ...${a.slice(Math.max(0, i - 100), i + 150)}\n    fast: ...${b.slice(Math.max(0, i - 100), i + 150)}`;
  }
}

const jsFiles = sample(allFiles((n) => /\.(m|c)?js$/.test(n)), NJ, 1 << 20);
// TS/TSX sources: TS_DIRS (path-delimited), default the directory containing
// this repo (other projects checked out next to it)
const tsDirs = process.env.TS_DIRS ? process.env.TS_DIRS.split(delimiter) : [join(root, "..")];
const tsAll = tsDirs.flatMap((d) => walk(d, (n) => (/\.(m|c)?tsx?$/.test(n) && !n.endsWith(".d.ts")))).filter((f) => !f.includes(".git"));
const tsFiles = sample(tsAll, NT, 512 << 10);
console.log("js:", jsFiles.length, "ts:", tsFiles.length);
const t0 = Date.now();
const all = [...jsFiles, ...tsFiles];
for (let i = 0; i < all.length; i++) {
  const f = all[i];
  const src = readText(f);
  const name = f.slice(-60);
  const jobs = [cmp(`${name} nodepod`, src, nodepod(f))];
  if (/\.tsx?$/.test(f)) jobs.push(cmp(`${name} vite`, src, viteTs(f)));
  const v = pick(variants);
  jobs.push(cmp(`${name} variant ${JSON.stringify(v(f))}`, src, v(f)));
  // truncation (error path) now and then
  if (i % 10 === 0) jobs.push(cmp(`${name} trunc`, src.slice(0, rint(src.length)), nodepod(f)));
  await Promise.all(jobs);
  if (i % 100 === 0) process.stderr.write(`  ${i}/${all.length} ${((Date.now() - t0) / 1000).toFixed(0)}s fails=${T.fails} fast=${stats.fast} error=${stats.error}\n`);
}
console.log("fast path stats:", JSON.stringify({ fast: stats.fast, error: stats.error }));
await O.stop?.();
process.exit(T.report() ? 1 : 0);
