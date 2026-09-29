// A minimal Web Worker (the browser API) for Node on top of worker_threads,
// enough for esbuild-wasm's browser glue in worker mode: blob: URLs as the
// script, postMessage/onmessage in both directions, terminate(). Used by
// test/api.mjs to run the browser builds' worker mode in Node.
import { Worker as NodeWorker } from "node:worker_threads";
import { resolveObjectURL } from "node:buffer";

const prelude = `
const { parentPort } = require("node:worker_threads");
globalThis.self = globalThis;
globalThis.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);
parentPort.on("message", (data) => { if (typeof globalThis.onmessage === "function") globalThis.onmessage({ data }); });
`;

export class WebWorker {
  constructor(url) {
    this.onmessage = null;
    this.onerror = null;
    this.queue = [];
    this.worker = null;
    this.terminated = false;
    const blob = resolveObjectURL(String(url));
    if (!blob) throw new Error("WebWorker shim: only blob: URLs are supported");
    blob.text().then((code) => {
      if (this.terminated) return;
      const w = new NodeWorker(prelude + code, { eval: true });
      w.on("message", (data) => this.onmessage && this.onmessage({ data }));
      w.on("error", (e) => this.onerror && this.onerror({ message: e.message, error: e }));
      this.worker = w;
      for (const [data, transfer] of this.queue) w.postMessage(data, transfer);
      this.queue = null;
    });
  }
  postMessage(data, transfer) {
    if (this.terminated) return;
    if (this.worker !== null) this.worker.postMessage(data, transfer);
    else this.queue.push([data, transfer]);
  }
  terminate() {
    this.terminated = true;
    if (this.worker !== null) this.worker.terminate();
  }
}
