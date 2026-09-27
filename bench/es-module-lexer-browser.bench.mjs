// es-module-lexer in headless Chromium (the way Nodepod runs it).
// Every parse gets a freshly decoded string (like a module loader reading a
// file), so no per-string caches (e.g. Blink's string externalization) help.
// Usage: node bench/es-module-lexer-browser.bench.mjs <impl>   impl: orig | fast | prev
// (BROWSER=firefox|webkit for the other engines; default chromium. Caveat:
// under Playwright, Firefox runs wasm several times slower than when launched
// normally, so those numbers only compare implementations with each other.)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import * as playwright from "playwright-core";
import { root, listFiles, nm } from "./corpus.mjs";

const impl = process.argv[2] || "orig";
const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
const server = createServer((req, res) => {
  const file = join(root, normalize(decodeURIComponent(req.url.split("?")[0])));
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404), res.end();
  // cross-origin isolated (like Nodepod needs for SharedArrayBuffer): 5us timer resolution instead of 100us
  res.writeHead(200, {
    "content-type": mime[extname(file)] || "application/octet-stream",
    "cache-control": "no-store",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
  });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const lib = {
  orig: "/node_modules/es-module-lexer/dist/lexer.js",
  fast: "/packages/fast-es-module-lexer/index.mjs",
  prev: "/.scratch/prev/fast-es-module-lexer/index.mjs",
}[impl];

const files = {
  "zod-errors.js (1.6KB esm)": "/node_modules/zod/v4/classic/errors.js",
  "zod-schemas.js (51KB esm) [utf16]": "/node_modules/zod/v4/classic/schemas.js",
  "react-dom-client.prod (536KB cjs)": "/node_modules/react-dom/cjs/react-dom-client.production.js",
  "rollup node-entry (948KB esm) [utf16]": "/node_modules/rollup/dist/es/shared/node-entry.js",
  "react-dom-client.dev (1MB cjs)": "/node_modules/react-dom/cjs/react-dom-client.development.js",
  "three.module (1.2MB esm)": "/node_modules/three/build/three.module.js",
};
const toUrl = (f) => "/" + f.slice(root.length + 1).split(String.fromCharCode(92)).join("/");
const batches = {
  "zod/v4 modules": listFiles(join(nm, "zod/v4"), [".js"]).map(toUrl),
  "@vue files": listFiles(join(nm, "@vue"), [".js", ".mjs"]).filter((f) => statSync(f).size < 200000).map(toUrl),
  "lodash-es modules": listFiles(join(nm, "lodash-es"), [".js"]).map(toUrl),
  "three/src modules": listFiles(join(nm, "three/src"), [".js"]).map(toUrl),
  "zod files": listFiles(join(nm, "zod"), [".js", ".cjs"]).map(toUrl),
};

const browser = await playwright[process.env.BROWSER || "chromium"].launch();
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && process.stderr.write("[page] " + m.text() + "\n"));
page.on("pageerror", (e) => process.stderr.write("[page] " + e.message + "\n"));
await page.goto(base + "/bench/browser/blank.html");

const results = await page.evaluate(async ({ lib, files, batches }) => {
  const L = await import(lib);
  await L.init;
  const dec = new TextDecoder();
  const bytesOf = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  async function measure(sets) {
    // sets: array of Uint8Array (one parse call each per sample)
    const fresh = () => sets.map((b) => dec.decode(b));
    for (let i = 0; i < 3; i++) for (const s of fresh()) L.parse(s);
    const samples = [];
    const t0 = performance.now();
    while (samples.length < 7 || (performance.now() - t0 < 2000 && samples.length < 300)) {
      const strs = [];
      let total = 0;
      do { strs.push(fresh()); total += sets.reduce((a, b) => a + b.length, 0); } while (total < 2e6 && strs.length < 5000);
      const s0 = performance.now();
      for (const batch of strs) for (const s of batch) L.parse(s);
      samples.push((performance.now() - s0) / strs.length);
    }
    samples.sort((a, b) => a - b);
    return samples[samples.length >> 1];
  }
  const res = [];
  const tiny = new TextEncoder().encode("import a from './a.js';\nexport const b = a + 1;\nexport default b;\n");
  res.push({ name: "tiny module (70B)", ms: await measure([tiny]) });
  for (const [name, url] of Object.entries(files)) {
    const b = await bytesOf(url);
    res.push({ name, bytes: b.length, ms: await measure([b]) });
  }
  for (const [label, urls] of Object.entries(batches)) {
    const bs = await Promise.all(urls.map(bytesOf));
    res.push({ name: `batch: ${bs.length} ${label}`, bytes: bs.reduce((a, b) => a + b.length, 0), ms: await measure(bs) });
  }
  return res;
}, { lib, files, batches });

for (const r of results)
  process.stdout.write("RESULT " + JSON.stringify({ impl, name: r.name, ms: r.ms, min: r.ms, samples: 1, batch: 1, mbps: r.bytes ? r.bytes / 1e6 / (r.ms / 1000) : undefined }) + "\n");
await browser.close();
server.close();
