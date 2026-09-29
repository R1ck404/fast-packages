// Without WebAssembly (e.g. a CSP without 'wasm-unsafe-eval'): the SHA-2,
// SHA-1 and MD5 hashers, HMAC / HKDF / PBKDF2 over them and scrypt throw
// Error("fast-noble-hashes needs WebAssembly") when they first need a
// compression function (their classes can still be created and take bytes
// that stay in the buffer); input errors come first, as in noble; every
// other algorithm runs noble's code unchanged. ESM and CommonJS.
// usage: node test/nowasm.mjs
import { createRequire } from "node:module";

globalThis.WebAssembly = undefined;
const require = createRequire(import.meta.url);
const MSG = "fast-noble-hashes needs WebAssembly";
let checks = 0, fails = 0;
const eq = (a, b, what) => {
  checks++;
  if (a !== b) {
    fails++;
    if (fails < 30) console.log("FAIL", what, "\n  fast:", String(a).slice(0, 200), "\n  orig:", String(b).slice(0, 200));
  }
};
const run = (f) => {
  try {
    const r = f();
    return r instanceof Uint8Array ? "ok:" + Buffer.from(r).toString("hex") : "ok:" + typeof r;
  } catch (e) {
    return "err:" + e.constructor.name + ":" + e.message;
  }
};
const runAsync = async (f) => {
  try {
    const r = await f();
    return "ok:" + Buffer.from(r).toString("hex");
  } catch (e) {
    return "err:" + e.constructor.name + ":" + e.message;
  }
};
const snap = (h) => JSON.stringify(h, (k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v instanceof DataView ? "dv" : v));
// (eskdf is left out: its scrypt and pbkdf2 are other functions)
const MODS = ["sha2", "legacy", "hmac", "hkdf", "pbkdf2", "scrypt", "sha3", "sha3-addons", "blake1", "blake2", "blake3", "argon2", "utils"];
const data = new Uint8Array(200).map((_, i) => i * 7);

for (const cjs of [false, true]) {
  const load = async (base) => {
    const o = {};
    for (const m of MODS) Object.assign(o, cjs ? require(`${base}/${m}`) : await import(`${base}/${m}`));
    return o;
  };
  const F = await load("@r1ck404/fast-noble-hashes");
  const O = await load("@noble/hashes");
  const fmt = cjs ? "cjs" : "esm";
  const FAST = [["sha256", "SHA256"], ["sha224", "SHA224"], ["sha512", "SHA512"], ["sha384", "SHA384"], ["sha512_224", "SHA512_224"], ["sha512_256", "SHA512_256"], ["sha1", "SHA1"], ["md5", "MD5"]];
  for (const [name, cls] of FAST) {
    for (const x of ["", "abc", data]) eq(run(() => F[name](x)), "err:Error:" + MSG, `${fmt} ${name}(${x.length})`);
    // input errors first
    eq(run(() => F[name](5)), run(() => O[name](5)), `${fmt} ${name}(bad)`);
    // an instance: created, bytes that stay in the buffer, then the error
    const a = new F[cls](), b = new O[cls]();
    eq(snap(a), snap(b), `${fmt} new ${cls}`);
    a.update(data.subarray(0, 10));
    b.update(data.subarray(0, 10));
    eq(snap(a), snap(b), `${fmt} ${cls} small update`);
    eq(run(() => a.update(data)), "err:Error:" + MSG, `${fmt} ${cls} block`);
    eq(run(() => new F[cls]().digest()), "err:Error:" + MSG, `${fmt} ${cls} digest`);
    eq(run(() => new F[cls]().update("x")), "err:Error:" + MSG, `${fmt} ${cls} string`);
    eq(run(() => F.hmac(F[name], "key", "msg")), "err:Error:" + MSG, `${fmt} hmac ${name}`);
    eq(run(() => F.hkdf(F[name], "ikm", "salt", "info", 32)), "err:Error:" + MSG, `${fmt} hkdf ${name}`);
    eq(run(() => F.pbkdf2(F[name], "pw", "salt", { c: 2 })), "err:Error:" + MSG, `${fmt} pbkdf2 ${name}`);
    eq(await runAsync(() => F.pbkdf2Async(F[name], "pw", "salt", { c: 2 })), "err:Error:" + MSG, `${fmt} pbkdf2Async ${name}`);
  }
  eq(run(() => F.scrypt("pw", "salt", { N: 16, r: 1, p: 1 })), "err:Error:" + MSG, `${fmt} scrypt`);
  eq(await runAsync(() => F.scryptAsync("pw", "salt", { N: 16, r: 1, p: 1 })), "err:Error:" + MSG, `${fmt} scryptAsync`);
  eq(run(() => F.scrypt("pw", "salt", { N: 3, r: 1, p: 1 })), run(() => O.scrypt("pw", "salt", { N: 3, r: 1, p: 1 })), `${fmt} scrypt bad N`);
  // everything else is noble's
  const OTHER = ["sha3_224", "sha3_256", "sha3_384", "sha3_512", "keccak_256", "shake128", "shake256", "blake2b", "blake2s", "blake3", "ripemd160", "blake256", "blake512", "k12", "turboshake128"];
  for (const name of OTHER) {
    if (!F[name]) continue;
    for (const x of ["", "abc", data]) eq(run(() => F[name](x)), run(() => O[name](x)), `${fmt} ${name}`);
    eq(run(() => F.hmac(F[name], "key", data)), run(() => O.hmac(O[name], "key", data)), `${fmt} hmac ${name}`);
  }
  eq(run(() => F.hkdf(F.sha3_256, "ikm", "salt", "info", 50)), run(() => O.hkdf(O.sha3_256, "ikm", "salt", "info", 50)), `${fmt} hkdf sha3`);
  eq(run(() => F.pbkdf2(F.ripemd160, "pw", "salt", { c: 20, dkLen: 40 })), run(() => O.pbkdf2(O.ripemd160, "pw", "salt", { c: 20, dkLen: 40 })), `${fmt} pbkdf2 ripemd160`);
  eq(await runAsync(() => F.pbkdf2Async(F.sha3_256, "pw", "salt", { c: 20 })), await runAsync(() => O.pbkdf2Async(O.sha3_256, "pw", "salt", { c: 20 })), `${fmt} pbkdf2Async sha3`);
  eq(run(() => F.argon2id("password", "saltsalt", { t: 1, m: 64, p: 1 })), run(() => O.argon2id("password", "saltsalt", { t: 1, m: 64, p: 1 })), `${fmt} argon2id`);
  const r1 = new F.RIPEMD160(), r2 = new O.RIPEMD160();
  r1.update(data);
  r2.update(data);
  eq(snap(r1), snap(r2), `${fmt} RIPEMD160 fields`);
}
console.log(`nowasm: ${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
