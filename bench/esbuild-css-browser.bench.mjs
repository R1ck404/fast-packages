// CSS transforms in a real browser (headless Chromium via playwright-core):
// browser build, default worker mode, wasm streamed from URL.
// Usage: node bench/compare.mjs esbuild-css-browser wasm fast
//   impl: wasm (esbuild-wasm 0.28.2 browser build) | fast (this checkout's packages/fast-esbuild-wasm)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize, dirname, basename } from "node:path";
import { chromium } from "playwright-core";
import { root } from "./corpus.mjs";

const impl = process.argv[2] || "wasm";
let sandbox = root;
while (dirname(sandbox) !== sandbox && basename(sandbox) !== "nodepod-fast-packages") sandbox = dirname(sandbox);
sandbox = dirname(sandbox);
const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".css": "text/plain" };

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = url.startsWith("/sandbox/") ? join(sandbox, normalize(url.slice(9))) : join(root, normalize(url));
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const libs = {
  wasm: { script: "/node_modules/esbuild-wasm/lib/browser.js", wasm: "/node_modules/esbuild-wasm/esbuild.wasm" },
  fast: { script: "/packages/fast-esbuild-wasm/lib/browser.js", wasm: "/packages/fast-esbuild-wasm/esbuild.wasm" },
}[impl];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error" || process.env.BENCH_VERBOSE) process.stderr.write("[page] " + m.text() + "\n");
});
await page.goto(base + "/bench/browser/blank.html");
await page.evaluate(async ({ script, wasm }) => {
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = script;
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  await self.esbuild.initialize({ wasmURL: wasm });
}, libs);

const sheets = [
  ["prism theme", "/sandbox/Nodepod/node_modules/.pnpm/prismjs@1.30.0/node_modules/prismjs/themes/prism-okaidia.css"],
  ["playwright report.css", "/node_modules/playwright-core/lib/vite/htmlReport/report.css"],
  ["bootstrap.min.css", "/sandbox/better-web-rendering/.tmp-libav-h264-decoder/build/ffmpeg-9.0/doc/bootstrap.min.css"],
  ["pdf_viewer.css", "/sandbox/debt-helper/node_modules/.pnpm/pdfjs-dist@6.3.289/node_modules/pdfjs-dist/web/pdf_viewer.css"],
  ["tailwind app build", "/sandbox/mouse/dist/assets/index-EmzhzJWi.css"],
];

const results = await page.evaluate(
  async ({ sheets, timeBudget }) => {
    const esbuild = self.esbuild;
    const VITE_TARGETS = ["chrome107", "edge107", "firefox104", "safari16"];
    const optionSets = [
      ["css", { loader: "css" }],
      ["minify", { loader: "css", minify: true }],
      ["vite build (minify + targets)", { loader: "css", target: VITE_TARGETS, minify: true }],
    ];
    async function measure(fn) {
      for (let i = 0; i < 2; i++) await fn();
      const samples = [];
      const t0 = performance.now();
      while (samples.length < 5 || (performance.now() - t0 < timeBudget && samples.length < 200)) {
        const s = performance.now();
        await fn();
        samples.push(performance.now() - s);
      }
      samples.sort((a, b) => a - b);
      return samples[samples.length >> 1];
    }
    const res = [];
    res.push({ name: "css transform latency: tiny rule", ms: await measure(() => esbuild.transform("a { color: red }", { loader: "css", minify: true })) });
    for (const [name, url] of sheets) {
      const r = await fetch(url);
      if (!r.ok) continue;
      const code = await r.text();
      for (const [optName, opts] of optionSets) {
        res.push({ name: `${name} (${(code.length / 1024).toFixed(code.length < 10240 ? 1 : 0)}KB): ${optName}`, bytes: code.length, ms: await measure(() => esbuild.transform(code, opts)) });
      }
    }
    const stats = esbuild[Symbol.for("@r1ck404/fast-esbuild-wasm:stats")];
    return { res, stats: stats ? { fast: stats.fast, error: stats.error, lastError: stats.lastError && String(stats.lastError.message) } : null };
  },
  { sheets, timeBudget: Number(process.env.BENCH_TIME || 1500) },
);
for (const r of results.res) {
  process.stdout.write("RESULT " + JSON.stringify({ impl, name: r.name, ms: r.ms, min: r.ms, samples: 1, batch: 1, mbps: r.bytes ? r.bytes / 1e6 / (r.ms / 1000) : undefined }) + "\n");
}
if (results.stats && results.stats.error > 0) process.stderr.write("engine errors: " + JSON.stringify(results.stats) + "\n");
await browser.close();
server.close();
process.exit(0);
