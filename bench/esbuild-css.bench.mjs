// CSS transforms: esbuild-wasm vs @r1ck404/fast-esbuild-wasm (this checkout's
// packages/fast-esbuild-wasm/node.mjs) vs native esbuild on real stylesheets.
// Usage: node bench/compare.mjs esbuild-css wasm fast [native]
//   or:  node bench/esbuild-css.bench.mjs <impl>
import { runSuite } from "./harness.mjs";
import { nm, root } from "./corpus.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const impl = process.argv[2] || "wasm";

async function loadImpl(name) {
  if (name === "wasm") {
    globalThis.self ??= globalThis;
    const esbuild = require("esbuild-wasm/lib/browser.js");
    const t0 = performance.now();
    const wasmModule = await WebAssembly.compile(readFileSync(join(nm, "esbuild-wasm/esbuild.wasm")));
    await esbuild.initialize({ wasmModule, worker: false });
    process.stdout.write("INIT " + (performance.now() - t0).toFixed(1) + "\n");
    return esbuild;
  }
  if (name === "native") return await import("esbuild");
  if (name === "fast") {
    // (by path: node_modules/@r1ck404 may point at another checkout)
    const t0 = performance.now();
    const esbuild = await import("../packages/fast-esbuild-wasm/node.mjs");
    await esbuild.initialize({});
    process.stdout.write("INIT " + (performance.now() - t0).toFixed(1) + "\n");
    return esbuild;
  }
  throw new Error("unknown impl " + name);
}

const esbuild = await loadImpl(impl);
const STATS = Symbol.for("@r1ck404/fast-esbuild-wasm:stats");

// Real stylesheets: the repository's node_modules, and when present, builds
// of projects next to the repository checkout (Tailwind, Bootstrap, ...)
let sandbox = root;
while (dirname(sandbox) !== sandbox && basename(sandbox) !== "nodepod-fast-packages") sandbox = dirname(sandbox);
sandbox = dirname(sandbox);
const candidates = [
  ["prism theme", join(sandbox, "Nodepod/node_modules/.pnpm/prismjs@1.30.0/node_modules/prismjs/themes/prism-okaidia.css")],
  ["playwright report.css", join(nm, "playwright-core/lib/vite/htmlReport/report.css")],
  ["playwright dashboard", join(nm, "playwright-core/lib/vite/dashboard/assets/index-BY2S1tHT.css")],
  ["bootstrap.min.css", join(sandbox, "better-web-rendering/.tmp-libav-h264-decoder/build/ffmpeg-9.0/doc/bootstrap.min.css")],
  ["pdf_viewer.css", join(sandbox, "debt-helper/node_modules/.pnpm/pdfjs-dist@6.3.289/node_modules/pdfjs-dist/web/pdf_viewer.css")],
  ["tailwind app build", join(sandbox, "mouse/dist/assets/index-EmzhzJWi.css")],
];
const sheets = [];
for (const [name, path] of candidates) {
  if (!existsSync(path)) continue;
  const code = readFileSync(path, "utf8");
  sheets.push({ name: `${name} (${(code.length / 1024).toFixed(code.length < 10240 ? 1 : 0)}KB)`, code });
}

// Vite 7's CSS minification call (vite:css-post minifyCSS)
const VITE_TARGETS = ["chrome107", "edge107", "firefox104", "safari16"];
const optionSets = [
  ["css", { loader: "css" }],
  ["minify", { loader: "css", minify: true }],
  ["vite build (minify + targets)", { loader: "css", target: VITE_TARGETS, minify: true }],
  ["local-css + map", { loader: "local-css", sourcemap: true, sourcefile: "app.module.css" }],
];

const cases = [];
for (const s of sheets) {
  for (const [optName, opts] of optionSets) {
    cases.push({ name: `${s.name}: ${optName}`, bytes: s.code.length, fn: () => esbuild.transform(s.code, opts) });
  }
}

const results = await runSuite(impl, cases, { maxTimeMs: Number(process.env.BENCH_TIME || 1500) });
if (impl === "fast") {
  const st = esbuild.default ? esbuild.default[STATS] : esbuild[STATS];
  if (st && st.error > 0) process.stderr.write(`engine errors: ${st.error}, last ${st.lastError && st.lastError.message}\n`);
}
void results;
process.exit(0);
