// Differential check in real browsers (Playwright): the ESM build loaded as
// native modules on the main thread (synchronous wasm compile) and in a
// module worker, against @noble/hashes 1.8.0.
// usage: node packages/fast-noble-hashes/test/browser.mjs [chromium,firefox,webkit] [iters]
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import * as pw from "playwright-core";
import { root } from "../../../bench/corpus.mjs";

const names = (process.argv[2] || "chromium,firefox,webkit").split(",");
const iters = Number(process.argv[3] || 10);
// @noble/hashes' utils import "@noble/hashes/crypto" by name (as installed
// under the original name); an import map resolves it for both copies.
const importMap = JSON.stringify({ imports: { "@noble/hashes/crypto": "/node_modules/@noble/hashes/esm/crypto.js" } });
const page = `<!doctype html><meta charset="utf-8"><script type="importmap">${importMap}</script><title>noble</title>`;
// Module workers do not use the page's import map: under /w/ the server
// resolves the one bare specifier itself.
const worker = `
import { run } from "/w/packages/fast-noble-hashes/test/browser-page.mjs";
onmessage = async (e) => postMessage(await run(...e.data));
`;
const CRYPTO_ESM = "/node_modules/@noble/hashes/esm/crypto.js";
const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/noble.html") return res.writeHead(200, { "content-type": "text/html" }), res.end(page);
  if (url === "/noble-worker.mjs") return res.writeHead(200, { "content-type": "text/javascript" }), res.end(worker);
  const rewrite = url.startsWith("/w/");
  const file = join(root, normalize(rewrite ? url.slice(2) : url));
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404), res.end();
  res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  let body = readFileSync(file);
  if (rewrite) body = body.toString().replace(/(["'])@noble\/hashes\/crypto\1/g, JSON.stringify(CRYPTO_ESM));
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const args = ["/packages/fast-noble-hashes/esm", "/node_modules/@noble/hashes/esm", iters];

let failed = false;
for (const name of names) {
  let browser;
  try {
    browser = await pw[name].launch();
  } catch (e) {
    console.log(name, "not available:", e.message.split("\n")[0]);
    continue;
  }
  const p = await browser.newPage();
  p.on("pageerror", (e) => console.log("[page]", e.message));
  await p.goto(base + "/noble.html");
  const main = await p.evaluate(async (args) => (await import("/packages/fast-noble-hashes/test/browser-page.mjs")).run(...args), args);
  let inWorker = null;
  try {
    inWorker = await p.evaluate(
      (args) =>
        new Promise((resolve, reject) => {
          const w = new Worker("/noble-worker.mjs", { type: "module" });
          w.onmessage = (e) => resolve(e.data);
          w.onerror = (e) => reject(new Error(e.message || "worker error"));
          setTimeout(() => reject(new Error("worker timeout")), 240000);
          w.postMessage(["/w" + args[0], "/w" + args[1], args[2]]);
        }),
      args,
    );
  } catch (e) {
    inWorker = { skipped: e.message };
  }
  const ver = main.ua.match(/(Chrome|Firefox|Version)\/[\d.]+/)?.[0];
  for (const [where, r] of [["main thread", main], ["worker", inWorker]]) {
    if (r.skipped) {
      console.log(`${name} ${where}: skipped (${r.skipped})`);
      continue;
    }
    console.log(`${name} ${where}: ${r.checks} checks, ${r.fails.length} failures, wasm ${r.wasm ? "on" : "OFF"} (${ver})`);
    for (const f of r.fails) console.log("  ", JSON.stringify(f));
    if (r.fails.length || !r.wasm) failed = true;
  }
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
