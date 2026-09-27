// @noble/hashes benchmark. Usage: node bench/noble-hashes.bench.mjs <impl>
//   impl: orig (@noble/hashes 1.8.0) | fast (@r1ck404/fast-noble-hashes) | prev (snapshot in .scratch/prev)
// The cases follow Nodepod's use: npm lockfile integrity (sha512 of
// tarballs), crypto.createHash / createHmac in sandboxed code (short
// strings and streamed chunks), pbkdf2Sync / scryptSync.
import { createRequire } from "node:module";
import { runSuite } from "./harness.mjs";
import { tarballs, randomBytes } from "./corpus.mjs";

const impl = process.argv[2] || "orig";
const require = createRequire(import.meta.url);
const base = impl === "fast" ? "@r1ck404/fast-noble-hashes" : impl === "prev" ? "../.scratch/prev/fast-noble-hashes" : impl === "orig" ? "@noble/hashes" : null;
if (!base) throw new Error("unknown impl " + impl);
const load = (m) => require(impl === "prev" ? `${base}/${m}.js` : `${base}/${m}`);
const { sha256, sha384, sha512 } = load("sha2");
const { sha1, md5 } = load("legacy");
const { hmac } = load("hmac");
const { pbkdf2 } = load("pbkdf2");
const { scrypt } = load("scrypt");

const MB = randomBytes(1 << 20);
const KB64 = MB.subarray(0, 65536);
const KB1 = MB.subarray(0, 1024);
const key = "node_modules/.vite/deps/react-dom_client.js?v=4f9c2a1b"; // a cache-key-like string
const tgz = tarballs().filter((t) => /typescript|react-dom/.test(t.name));

const cases = [];
for (const t of tgz) {
  cases.push({ name: `sha512 ${t.name} (${(t.bytes.length / 1e6).toFixed(1)} MB, lockfile integrity)`, bytes: t.bytes.length, fn: () => sha512(t.bytes) });
}
for (const [name, h] of [["sha256", sha256], ["sha512", sha512], ["sha384", sha384], ["sha1", sha1], ["md5", md5]]) {
  cases.push({ name: `${name} 1 MB`, bytes: MB.length, fn: () => h(MB) });
  if (name === "sha256" || name === "sha512") cases.push({ name: `${name} 64 KB`, bytes: KB64.length, fn: () => h(KB64) });
  cases.push({ name: `${name} 1 KB`, bytes: KB1.length, fn: () => h(KB1) });
  cases.push({ name: `${name} 56-char string`, fn: () => h(key) });
}
// createHash(alg).update(str).digest() as Nodepod's polyfill does it
for (const [name, h] of [["sha256", sha256], ["sha1", sha1], ["md5", md5]]) {
  cases.push({ name: `${name}.create().update(56-char string).digest()`, fn: () => h.create().update(key).digest() });
}
cases.push({
  name: "sha256.create(), 1 MB in 16 KB updates",
  bytes: MB.length,
  fn: () => {
    const h = sha256.create();
    for (let i = 0; i < MB.length; i += 16384) h.update(MB.subarray(i, i + 16384));
    return h.digest();
  },
});
cases.push({
  name: "sha256.create(), 64 KB in 100 B updates",
  bytes: KB64.length,
  fn: () => {
    const h = sha256.create();
    for (let i = 0; i < KB64.length; i += 100) h.update(KB64.subarray(i, i + 100));
    return h.digest();
  },
});
cases.push({ name: "hmac sha256, 56-char string", fn: () => hmac(sha256, "secret-key", key) });
cases.push({ name: "hmac sha256, 1 KB", fn: () => hmac(sha256, "secret-key", KB1) });
cases.push({ name: "pbkdf2 sha256, c=10000", fn: () => pbkdf2(sha256, "password", "salt", { c: 10000, dkLen: 32 }), opts: { minSamples: 5 } });
cases.push({ name: "pbkdf2 sha512, c=10000", fn: () => pbkdf2(sha512, "password", "salt", { c: 10000, dkLen: 64 }), opts: { minSamples: 5 } });
cases.push({ name: "scrypt N=2^14 r=8 p=1", fn: () => scrypt("password", "salt", { N: 2 ** 14, r: 8, p: 1, dkLen: 64 }), opts: { minSamples: 3, maxTimeMs: 4000 } });

await runSuite(impl, cases);
