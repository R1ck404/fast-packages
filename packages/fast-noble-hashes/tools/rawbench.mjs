// Raw throughput of the hash family modules (no class glue: one-shot hashes
// straight through the exports) against noble's, as build.mjs leaves them
// in wasm/target/ and with their round constants from esm/_fast.js.
// usage: node tools/rawbench.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sha256, sha512 } from "@noble/hashes/sha2";
import { sha1, md5 } from "@noble/hashes/legacy";
import * as fast from "../esm/_fast.js";
import { MEM, CAP } from "../wasm/kernels.mjs";

const dir = new URL("../wasm/target/", import.meta.url);
const IV = {
  sha256: [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19],
  sha512: [0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1, 0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179],
  sha1: [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0],
  md5: [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476],
};
const K = { sha256: fast.K(64), sha512: fast.K(80), md5: () => Array.from({ length: 64 }, (_, i) => BigInt(Math.floor(2 ** 32 * Math.abs(Math.sin(i + 1))))) };
const OL = { sha256: 32, sha512: 64, sha1: 20, md5: 16 };
const noble = { sha256, sha512, sha1, md5 };
const buf = new Uint8Array(4 << 20).map((_, i) => (i * 2654435761) >>> 24);
const hex = (u) => Buffer.from(u).toString("hex");
function t(f, reps) {
  f();
  f();
  const s = performance.now();
  for (let i = 0; i < reps; i++) f();
  return (performance.now() - s) / reps;
}
for (const alg of Object.keys(IV)) {
  const W = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(new URL(`${alg}.wasm`, dir)))).exports;
  const m8 = new Uint8Array(W.m.buffer), i32 = new Int32Array(W.m.buffer);
  if (K[alg]) new BigUint64Array(W.m.buffer, MEM.KB).set(K[alg]());
  const hash = (data) => {
    i32.set(IV[alg]);
    let pos = 0;
    for (let i = 0; i < data.length; i += CAP) {
      m8.set(data.subarray(i, i + CAP), MEM.IO);
      pos = W.u(pos, Math.min(CAP, data.length - i));
    }
    W.d(pos, data.length);
    const r = m8.slice(MEM.O, MEM.O + OL[alg]);
    W.z();
    return r;
  };
  for (const len of [0, 1, 55, 56, 63, 64, 111, 112, 127, 128, 1000, CAP - 1, CAP, CAP + 1, 200000]) {
    const d = buf.subarray(0, len);
    if (hex(hash(d)) !== createHash(alg).update(d).digest("hex")) console.log("MISMATCH", alg, len);
  }
  const a = t(() => noble[alg](buf), 5), b = t(() => hash(buf), 20);
  const small = buf.subarray(0, 64);
  const c = t(() => noble[alg](small), 20000) * 1e3, d = t(() => hash(small), 20000) * 1e3;
  console.log(`${alg.padEnd(7)} 4MB noble ${(buf.length / 1e3 / a).toFixed(0)} MB/s  wasm ${(buf.length / 1e3 / b).toFixed(0)} MB/s  x${(a / b).toFixed(2)} | 64B noble ${c.toFixed(0)} ns wasm ${d.toFixed(0)} ns x${(c / d).toFixed(1)}`);
}
