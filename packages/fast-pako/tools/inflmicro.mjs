// Focused inflate microbenchmark on the built wasm (min of runs, in MB/s of output).
// usage: node packages/fast-pako/tools/inflmicro.mjs [wasmPath]
import { readFileSync } from "node:fs";
import pako from "pako";
import { loadJs, utf8, jsonText, read, tarballs } from "../../../bench/corpus.mjs";

const wasmPath = process.argv[2] || new URL("../fastzlib.wasm", import.meta.url);
const inst = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), { env: { js_emit() {} } });
const W = inst.exports;

const js = utf8(loadJs().find((f) => f.name.includes("react-dom-client.dev")).code);
const cases = [
  ["js 1MB (zlib)", pako.deflate(js), js.length],
  ["json 1MB (zlib)", pako.deflate(utf8(jsonText(1 << 20))), 1 << 20],
  ["wasm 2MB (raw L1)", pako.deflateRaw(read("esbuild-wasm/esbuild.wasm").subarray(0, 2 << 20), { level: 1 }), 2 << 20],
  ["typescript.tgz", tarballs().find((t) => t.name.startsWith("typescript")).bytes, 0],
];
let sess = 0;
function inflateOnce(c) {
  sess = W.inf_init(sess, c === cases[2][1] ? -15 : 47, 65536, 0, 0);
  const p = W.inf_input(sess, c.length);
  new Uint8Array(W.memory.buffer).set(c, p);
  W.inf_push(sess, c.length, 0, 0);
  const res = new Uint32Array(W.memory.buffer, W.fz_res(), 16);
  return res[6];
}
for (const [name, c] of cases) {
  let out = 0;
  for (let i = 0; i < 5; i++) out = inflateOnce(c);
  let best = Infinity;
  for (let r = 0; r < 15; r++) {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) inflateOnce(c);
    best = Math.min(best, (performance.now() - t0) / 5);
  }
  console.log(`${name.padEnd(20)} ${best.toFixed(3)} ms  ${(out / 1e3 / best).toFixed(0)} MB/s`);
}
