// zlib-rs compiled to wasm: same cases as inflmicro.mjs (single-call inflate) — reference ceiling
import { readFileSync } from "node:fs";
import pako from "pako";
import { loadJs, utf8, jsonText, read, tarballs } from "../../../bench/corpus.mjs";
const W = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(new URL("./zlibrs.wasm.tmp", import.meta.url))), { env: {} }).exports;
const js = utf8(loadJs().find((f) => f.name.includes("react-dom-client.dev")).code);
const cases = [
  ["js 1MB (zlib)", pako.deflate(js), 47],
  ["json 1MB (zlib)", pako.deflate(utf8(jsonText(1 << 20))), 47],
  ["wasm 2MB (raw L1)", pako.deflateRaw(read("esbuild-wasm/esbuild.wasm").subarray(0, 2 << 20), { level: 1 }), -15],
  ["typescript.tgz", tarballs().find((t) => t.name.startsWith("typescript")).bytes, 47],
];
const outCap = 64 << 20;
const outP = W.zalloc(outCap);
const inP = W.zalloc(8 << 20);
for (const [name, c, wb] of cases) {
  new Uint8Array(W.memory.buffer).set(c, inP);
  let out = 0;
  for (let i = 0; i < 5; i++) out = W.run(inP, c.length, outP, outCap, wb);
  let best = Infinity;
  for (let r = 0; r < 15; r++) {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) W.run(inP, c.length, outP, outCap, wb);
    best = Math.min(best, (performance.now() - t0) / 5);
  }
  console.log(`${name.padEnd(20)} ${best.toFixed(3)} ms  ${(out / 1e3 / best).toFixed(0)} MB/s`);
}
