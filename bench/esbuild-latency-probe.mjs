// Probe where esbuild-wasm's per-call latency goes (browser, worker mode):
// wraps the worker's setTimeout/postMessage to count timers and timestamps.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { chromium } from "playwright-core";
import { root } from "./corpus.mjs";

const mime = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
const server = createServer((req, res) => {
  const file = join(root, normalize(decodeURIComponent(req.url.split("?")[0])));
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404), res.end();
  res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text()));
await page.goto(base + "/bench/browser/blank.html");
const r = await page.evaluate(async () => {
  // instrument workers created from blobs: prepend a timer probe
  const NativeWorker = self.Worker;
  self.Worker = function (url, opts) {
    const probe = `
      const __st = self.setTimeout; let __n = 0, __d = {};
      self.setTimeout = (f, d, ...a) => { __n++; __d[d|0] = (__d[d|0]||0)+1; return __st(f, d, ...a); };
      self.__probe = () => ({ timers: __n, delays: __d });
      let __h = null;
      Object.defineProperty(self, "onmessage", { configurable: true, get() { return __h; }, set(h) {
        __h = h;
        self.addEventListener("message", (e) => { if (e.data === "__probe") postMessage({ __probe: self.__probe() }); });
      } });
      self.addEventListener("message", (e) => { if (e.data !== "__probe" && __h) __h(e); });
    `;
    const blob = new Blob([probe + "\nimportScripts(" + JSON.stringify(url) + ");"], { type: "text/javascript" });
    const w = new NativeWorker(URL.createObjectURL(blob), opts);
    self.__worker = w;
    return w;
  };
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "/node_modules/esbuild-wasm/lib/browser.js";
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  await esbuild.initialize({ wasmURL: "/node_modules/esbuild-wasm/esbuild.wasm" });
  for (let i = 0; i < 20; i++) await esbuild.transform("", { loader: "js" });
  const t0 = performance.now();
  const N = 100;
  for (let i = 0; i < N; i++) await esbuild.transform("", { loader: "js" });
  const per = (performance.now() - t0) / N;
  const probe = await new Promise((res) => {
    const w = self.__worker;
    const prev = w.onmessage;
    w.onmessage = (e) => { if (e.data && e.data.__probe) { w.onmessage = prev; res(e.data.__probe); } else prev(e); };
    w.postMessage("__probe");
  });
  // raw postMessage round trip to a trivial worker for comparison
  const echo = new NativeWorker(URL.createObjectURL(new Blob(["onmessage = (e) => postMessage(e.data)"], { type: "text/javascript" })));
  await new Promise((res) => { echo.onmessage = res; echo.postMessage(0); });
  const t1 = performance.now();
  for (let i = 0; i < N; i++) await new Promise((res) => { echo.onmessage = res; echo.postMessage(new Uint8Array(64)); });
  const rtt = (performance.now() - t1) / N;
  return { perTransformMs: per, rawWorkerRoundTripMs: rtt, workerTimersTotal: probe };
});
console.log(r);
await browser.close();
server.close();
