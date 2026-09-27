// Raw wasm block-function throughput vs noble (no JS glue).
// usage: node tools/rawbench.mjs [path.wasm]
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sha256, sha512 } from "@noble/hashes/sha2";
import { sha1, md5 } from "@noble/hashes/legacy";
const file = process.argv[2] || new URL("../rust/target/wasm32-unknown-unknown/release/fasthashes.wasm", import.meta.url);
const W = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(file))).exports;
const m8 = () => new Uint8Array(W.memory.buffer);
const IO = W.offset(0), OUT = W.offset(2), ST = W.offset(3), CAP = W.offset(7);
const buf = new Uint8Array(4 << 20);
for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761) >>> 24;
const IV = {
  0: [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19],
  1: [0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a, 0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19],
  2: [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0],
  3: [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476],
};
const BL = { 0: 64, 1: 128, 2: 64, 3: 64 };
const OL = { 0: 32, 1: 64, 2: 20, 3: 16 };
function hash(alg, data) {
  new Int32Array(W.memory.buffer, ST, IV[alg].length).set(IV[alg]);
  const bl = BL[alg];
  let pos = 0;
  while (data.length - pos > CAP) {
    m8().set(data.subarray(pos, pos + CAP), IO);
    W.blocks(alg, CAP / bl);
    pos += CAP;
  }
  const n = data.length - pos;
  m8().set(data.subarray(pos), IO);
  const bits = data.length * 8;
  W.finish(alg, n, bits >>> 0, Math.floor(bits / 2 ** 32));
  return m8().slice(OUT, OUT + OL[alg]);
}
const hex = (u) => Buffer.from(u).toString("hex");
const names = { 0: "sha256", 1: "sha512", 2: "sha1", 3: "md5" };
const noble = { 0: sha256, 1: sha512, 2: sha1, 3: md5 };
for (const alg of [0, 1, 2, 3]) {
  for (const len of [0, 1, 55, 56, 63, 64, 111, 112, 127, 128, 1000, 65536, 65537, 200000]) {
    const d = buf.subarray(0, len);
    const want = createHash(names[alg]).update(d).digest("hex");
    if (hex(hash(alg, d)) !== want) console.log("MISMATCH", names[alg], len);
  }
}
function t(f, reps) { f(); f(); const s = performance.now(); for (let i = 0; i < reps; i++) f(); return (performance.now() - s) / reps; }
for (const alg of [0, 1, 2, 3]) {
  const big = buf;
  const a = t(() => noble[alg](big), 5), b = t(() => hash(alg, big), 20);
  const small = buf.subarray(0, 64);
  const c = t(() => noble[alg](small), 20000) * 1e3, d = t(() => hash(alg, small), 20000) * 1e3;
  console.log(`${names[alg].padEnd(7)} 4MB noble ${(big.length / 1e3 / a).toFixed(0)} MB/s  wasm ${(big.length / 1e3 / b).toFixed(0)} MB/s  x${(a / b).toFixed(2)} | 64B noble ${c.toFixed(0)} ns wasm ${d.toFixed(0)} ns x${(c / d).toFixed(1)}`);
}
