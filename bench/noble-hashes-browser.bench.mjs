// @noble/hashes in headless Chromium (native ES modules, main thread).
// Usage: node bench/noble-hashes-browser.bench.mjs <impl>   impl: orig | fast | prev
// (BROWSER=firefox|webkit for the other engines; default chromium)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import * as playwright from "playwright-core";
import { root } from "./corpus.mjs";

const impl = process.argv[2] || "orig";
const lib = {
  orig: "/node_modules/@noble/hashes/esm",
  fast: "/packages/fast-noble-hashes/esm",
  prev: "/.scratch/prev/fast-noble-hashes/esm",
}[impl];
if (!lib) throw new Error("unknown impl " + impl);
// @noble/hashes' utils import "@noble/hashes/crypto" by package name
const page = `<!doctype html><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports: { "@noble/hashes/crypto": "/node_modules/@noble/hashes/esm/crypto.js" } })}</script><title>bench</title>`;
const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/bench.html") return res.writeHead(200, { "content-type": "text/html", "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" }), res.end(page);
  const file = join(root, normalize(url));
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404), res.end();
  // cross-origin isolated (like Nodepod): 5us timer resolution
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
const tgz = ["/corpus/react-dom-19.3.0.tgz", "/corpus/typescript-5.9.3.tgz"].filter((u) => existsSync(join(root, u)));

const browser = await playwright[process.env.BROWSER || "chromium"].launch();
const p = await browser.newPage();
p.on("pageerror", (e) => process.stderr.write("[page] " + e.message + "\n"));
await p.goto(base + "/bench.html");
const results = await p.evaluate(
  async ({ lib, tgz }) => {
    const { sha256, sha512 } = await import(lib + "/sha2.js");
    const { sha1, md5 } = await import(lib + "/legacy.js");
    const { hmac } = await import(lib + "/hmac.js");
    const { pbkdf2 } = await import(lib + "/pbkdf2.js");
    const { scrypt } = await import(lib + "/scrypt.js");
    function measure(fn, maxMs = 1500) {
      for (let i = 0, t = performance.now(); i < 3 || performance.now() - t < 200; i++) fn();
      const samples = [];
      const t0 = performance.now();
      while (samples.length < 7 || (performance.now() - t0 < maxMs && samples.length < 300)) {
        let n = 0;
        const s0 = performance.now();
        do {
          fn();
          n++;
        } while (performance.now() - s0 < 20);
        samples.push((performance.now() - s0) / n);
      }
      samples.sort((a, b) => a - b);
      return samples[samples.length >> 1];
    }
    const MB = new Uint8Array(1 << 20);
    crypto.getRandomValues(MB.subarray(0, 65536));
    for (let i = 65536; i < MB.length; i += 65536) MB.set(MB.subarray(0, 65536), i);
    const KB1 = MB.subarray(0, 1024);
    const key = "node_modules/.vite/deps/react-dom_client.js?v=4f9c2a1b";
    const res = [];
    const add = (name, fn, bytes, maxMs) => res.push({ name, bytes, ms: measure(fn, maxMs) });
    for (const u of tgz) {
      const b = new Uint8Array(await (await fetch(u)).arrayBuffer());
      add(`sha512 ${u.split("/").pop()} (${(b.length / 1e6).toFixed(1)} MB, lockfile integrity)`, () => sha512(b), b.length);
    }
    for (const [name, h] of [["sha256", sha256], ["sha512", sha512], ["sha1", sha1], ["md5", md5]]) {
      add(`${name} 1 MB`, () => h(MB), MB.length);
      add(`${name} 1 KB`, () => h(KB1), 1024);
      add(`${name} 56-char string`, () => h(key));
      add(`${name}.create().update(56-char string).digest()`, () => h.create().update(key).digest());
    }
    add("sha256.create(), 1 MB in 16 KB updates", () => {
      const h = sha256.create();
      for (let i = 0; i < MB.length; i += 16384) h.update(MB.subarray(i, i + 16384));
      return h.digest();
    }, MB.length);
    add("hmac sha256, 56-char string", () => hmac(sha256, "secret-key", key));
    add("pbkdf2 sha256, c=10000", () => pbkdf2(sha256, "password", "salt", { c: 10000, dkLen: 32 }));
    add("pbkdf2 sha512, c=10000", () => pbkdf2(sha512, "password", "salt", { c: 10000, dkLen: 64 }));
    add("scrypt N=2^14 r=8 p=1", () => scrypt("password", "salt", { N: 2 ** 14, r: 8, p: 1, dkLen: 64 }), 0, 4000);
    return res;
  },
  { lib, tgz },
);
for (const r of results)
  process.stdout.write("RESULT " + JSON.stringify({ impl, name: r.name, ms: r.ms, min: r.ms, samples: 1, batch: 1, mbps: r.bytes ? r.bytes / 1e6 / (r.ms / 1000) : undefined }) + "\n");
await browser.close();
server.close();
