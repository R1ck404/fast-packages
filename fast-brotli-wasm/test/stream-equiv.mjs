// Stream API equivalence: CompressStream and DecompressStream of
// fast-brotli-wasm vs brotli-wasm 3.0.1, call by call (result code,
// input_offset, output bytes, total_out, thrown errors) over random input
// and output chunk sizes: DecompressStream on node-zlib streams with random
// parameters, brotli-wasm output, truncated and corrupted streams;
// CompressStream at every quality on real files and generated data.
// usage: node fast-brotli-wasm/test/stream-equiv.mjs [--n=400] [--seed=1]
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { listFiles, nm } from "../../bench/corpus.mjs";

const require = createRequire(import.meta.url);
const O = require("brotli-wasm");
const F = require("../index.node.cjs");
const args = process.argv.slice(2);
const arg = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const N = Number(arg("n", "400"));
let seed = Number(arg("seed", "1")) >>> 0 || 1;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};
const ri = (n) => Math.floor(rnd() * n);
const pick = (a) => a[ri(a.length)];
const C = zlib.constants;

const files = listFiles(nm, [".js", ".json", ".md", ".css", ".map", ".ts"]).sort();
const sample = () => {
  for (;;) {
    const b = readFileSync(pick(files));
    if (b.length > 0 && b.length < 400000) return new Uint8Array(b);
  }
};
const sizes = () => pick([[1, 1], [3, 7], [16, 16], [64, 4096], [4096, 64], [65536, 65536], [1 + ri(5000), 1 + ri(5000)], [1 + ri(100), 1 + ri(100000)]]);

let checks = 0, failures = 0;
function run(M, fn) {
  try {
    return { ok: fn(M) };
  } catch (e) {
    return { err: e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e) };
  }
}
function same(name, fn) {
  checks++;
  const a = JSON.stringify(run(O, fn));
  const b = JSON.stringify(run(F, fn));
  if (a !== b) {
    failures++;
    if (failures <= 20) console.log(`MISMATCH ${name}\n  orig ${a.slice(0, 300)}\n  fast ${b.slice(0, 300)}`);
  }
}
const b64 = (parts) => Buffer.concat(parts).toString("base64");

function decompressStream(M, data, inChunk, outSize) {
  const s = new M.DecompressStream();
  const log = [], out = [];
  let off = 0;
  try {
    for (let i = 0; i < 200000; i++) {
      const r = s.decompress(data.subarray(off, off + inChunk), outSize);
      log.push(r.code, r.input_offset, r.buf.length);
      out.push(r.buf);
      off += r.input_offset;
      const code = r.code;
      r.free();
      if (code === 1) break;
      if (code === 2 && off >= data.length) break;
    }
    log.push("total", s.total_out());
  } finally {
    s.free();
  }
  return [log, b64(out)];
}
function compressStream(M, data, q, inChunk, outSize) {
  const s = q === undefined ? new M.CompressStream() : new M.CompressStream(q);
  const log = [], out = [];
  let off = 0;
  try {
    while (off < data.length) {
      const r = s.compress(data.subarray(off, off + inChunk), outSize);
      log.push(r.code, r.input_offset, r.buf.length);
      out.push(r.buf);
      off += r.input_offset;
      r.free();
    }
    for (let i = 0; i < 100000; i++) {
      const r = s.compress(undefined, outSize);
      log.push(r.code, r.input_offset, r.buf.length);
      out.push(r.buf);
      const code = r.code;
      r.free();
      if (code === 1) break;
    }
    log.push("total", s.total_out());
  } finally {
    s.free();
  }
  return [log, b64(out)];
}

const t0 = Date.now();
// DecompressStream
for (let i = 0; i < N; i++) {
  const raw = sample();
  let packed;
  const kind = ri(4);
  if (kind === 0) {
    packed = new Uint8Array(zlib.brotliCompressSync(raw, { params: { [C.BROTLI_PARAM_QUALITY]: ri(12), [C.BROTLI_PARAM_LGWIN]: 10 + ri(15), [C.BROTLI_PARAM_MODE]: ri(3) } }));
  } else if (kind === 1) {
    packed = O.compress(raw, { quality: ri(12) });
  } else {
    packed = new Uint8Array(zlib.brotliCompressSync(raw, { params: { [C.BROTLI_PARAM_QUALITY]: ri(12) } }));
    if (kind === 2) packed = packed.subarray(0, ri(packed.length + 1)); // truncated
    else {
      packed = packed.slice();
      for (let e = 1 + ri(4); e > 0; e--) packed[ri(packed.length)] ^= 1 << ri(8); // corrupted
    }
  }
  const [inChunk, outSize] = sizes();
  same(`DecompressStream #${i} kind ${kind} (${packed.length} bytes) in ${inChunk} out ${outSize}`, (M) => decompressStream(M, packed, inChunk, outSize));
}
console.log(`DecompressStream: ${checks} checks, ${failures} failures (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
// CompressStream
const c0 = checks;
for (let i = 0; i < Math.ceil(N / 4); i++) {
  let data = sample();
  if (ri(3) === 0) data = data.subarray(0, ri(2000));
  const q = pick([undefined, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  if (q !== undefined && q >= 10) data = data.subarray(0, 60000);
  if (q === undefined) data = data.subarray(0, 60000);
  const [inChunk, outSize] = sizes();
  same(`CompressStream #${i} q${q} (${data.length} bytes) in ${inChunk} out ${outSize}`, (M) => compressStream(M, data, q, inChunk, outSize));
}
console.log(`CompressStream: ${checks - c0} checks`);
console.log(`checks: ${checks}, failures: ${failures}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failures ? 1 : 0);
