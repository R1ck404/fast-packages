// Independent differential check: @r1ck404/fast-noble-hashes vs @noble/hashes
// 1.8.0 and node:crypto, called the way Nodepod's crypto polyfill does
// (src/polyfills/sync-digest.ts, crypto.ts): one-shot digests of real files
// and npm tarballs (lockfile SRI: sha512 -> base64), streaming hashers fed
// Buffers and strings in random chunks, streaming HMACs, Nodepod's
// hmacSync-based pbkdf2 loop, and scryptSync with Nodepod's defaults.
// usage: node verify/verify-noble-hashes.mjs [nFiles]
import { createRequire } from "node:module";
import { createHash, createHmac, pbkdf2Sync, scryptSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allFiles, sample, readBytes, rnd, rint, pick, Tally, describeErr, root } from "./corpus.mjs";

const require = createRequire(import.meta.url);
const N = Number(process.argv[2] || 1500);
const T = new Tally("noble-hashes");
const lib = (base) => ({
  ...require(`${base}/sha2`),
  ...require(`${base}/legacy`),
  ...require(`${base}/hmac`),
  ...require(`${base}/scrypt`),
});
const O = lib("@noble/hashes");
const F = lib(process.env.FAST_NOBLE || "@r1ck404/fast-noble-hashes");

const b64 = (u) => Buffer.from(u).toString("base64");
function run(fn) {
  try {
    const v = fn();
    return v instanceof Uint8Array ? "B" + b64(v) : "V" + String(v);
  } catch (e) {
    return "E" + describeErr(e);
  }
}

// Nodepod's algorithm table (sync-digest.ts nobleHashFor)
const ALGS = [
  ["SHA-1", "sha1", "sha1"],
  ["SHA-256", "sha256", "sha256"],
  ["SHA-384", "sha384", "sha384"],
  ["SHA-512", "sha512", "sha512"],
  ["MD5", "md5", "md5"],
];

// lockfile integrity of every corpus tarball, as archive-extractor.ts verifySri
for (const f of readdirSync(join(root, "corpus")).filter((x) => x.endsWith(".tgz"))) {
  const bytes = new Uint8Array(readFileSync(join(root, "corpus", f)));
  for (const [, name, ref] of ALGS.slice(1, 4)) {
    const sri = `${name}-${b64(F[name](bytes))}`;
    T.ok(sri === `${name}-${createHash(ref).update(bytes).digest("base64")}`, `SRI ${name} ${f}`);
    T.ok(sri === `${name}-${b64(O[name](bytes))}`, `SRI ${name} ${f} vs noble`);
  }
}

const files = sample(allFiles(), N);
for (const file of files) {
  const data = readBytes(file);
  const [, name, ref] = pick(ALGS);
  const want = createHash(ref).update(data).digest("base64");
  // digestSync
  const one = run(() => F[name](data));
  T.ok(one === "B" + want, `${name}(${file})`);
  T.ok(one === run(() => O[name](data)), `${name}(${file}) vs noble`);
  // createHash().update(...) x n .digest(): Buffers, subarrays and strings
  const text = data.toString();
  const hf = F[name].create(), ho = O[name].create(), hn = createHash(ref);
  const useText = rint(3) === 0;
  const src = useText ? text : data;
  for (let pos = 0; pos < src.length; ) {
    const n = rint(4) === 0 ? rint(8) : rint(4) === 0 ? rint(70000) : rint(2000);
    const piece = src.slice(pos, pos + n);
    const chunk = useText ? piece : rint(2) ? Buffer.from(piece) : piece;
    hf.update(chunk);
    ho.update(chunk);
    hn.update(chunk);
    pos += n;
  }
  const df = run(() => hf.digest());
  T.ok(df === "B" + hn.digest("base64"), `stream ${name} ${file}`);
  T.ok(df === run(() => ho.digest()), `stream ${name} ${file} vs noble`);
  T.ok(run(() => hf.update("x")) === run(() => ho.update("x")), "update after digest");
  // createHmac(alg, key).update(...).digest()
  if (rint(3) === 0) {
    const key = rint(2) ? Buffer.from(rnd().toString(36).repeat(rint(40))) : readBytes(pick(files)).subarray(0, rint(300));
    const mf = F.hmac.create(F[name], new Uint8Array(key)), mo = O.hmac.create(O[name], new Uint8Array(key));
    const cut = rint(data.length + 1);
    mf.update(data.subarray(0, cut)).update(data.subarray(cut));
    mo.update(data.subarray(0, cut)).update(data.subarray(cut));
    const r = run(() => mf.digest());
    T.ok(r === "B" + createHmac(ref, key).update(data).digest("base64"), `hmac ${name} ${file}`);
    T.ok(r === run(() => mo.digest()), `hmac ${name} vs noble`);
  }
}

// Nodepod's pbkdf2Sync: its own loop over one-shot HMACs (sync-digest.ts
// hmacSync = digestSync(opad || digestSync(ipad || data)))
function hmacSync(L, name, key, data) {
  const blockSize = name === "sha384" || name === "sha512" ? 128 : 64;
  const k = key.length > blockSize ? L[name](key) : key;
  const pad = new Uint8Array(blockSize);
  pad.set(k);
  const ipad = pad.map((x) => x ^ 0x36), opad = pad.map((x) => x ^ 0x5c);
  const cat = (a, b) => {
    const o = new Uint8Array(a.length + b.length);
    o.set(a);
    o.set(b, a.length);
    return o;
  };
  return L[name](cat(opad, L[name](cat(ipad, data))));
}
function pbkdf2(L, name, pw, salt, rounds, keyLen, hLen) {
  const out = new Uint8Array(keyLen);
  for (let i = 1, pos = 0; pos < keyLen; i++, pos += hLen) {
    const s = new Uint8Array(salt.length + 4);
    s.set(salt);
    new DataView(s.buffer).setUint32(salt.length, i);
    let u = hmacSync(L, name, pw, s);
    const acc = new Uint8Array(u);
    for (let r = 1; r < rounds; r++) {
      u = hmacSync(L, name, pw, u);
      for (let j = 0; j < acc.length; j++) acc[j] ^= u[j];
    }
    out.set(acc.subarray(0, Math.min(hLen, keyLen - pos)), pos);
  }
  return out;
}
for (let i = 0; i < Math.max(20, N / 30); i++) {
  const [, name, ref] = pick(ALGS);
  const pw = Buffer.from(rnd().toString(36).repeat(1 + rint(30))), salt = Buffer.from(rnd().toString(36));
  const rounds = 1 + rint(300), keyLen = 1 + rint(100), hLen = F[name].outputLen;
  const r = run(() => pbkdf2(F, name, pw, salt, rounds, keyLen, hLen));
  T.ok(r === "B" + pbkdf2Sync(pw, salt, rounds, keyLen, ref).toString("base64"), `pbkdf2 ${name}`);
  T.ok(r === run(() => pbkdf2(O, name, pw, salt, rounds, keyLen, hLen)), `pbkdf2 ${name} vs noble`);
}

// scryptSync(password, salt, keyLen, opts) with Nodepod's defaults
for (let i = 0; i < Math.max(8, N / 150); i++) {
  const opts = rint(3) === 0 ? {} : { N: 2 ** (1 + rint(12)), r: 1 + rint(8), p: 1 + rint(2) };
  const pw = new TextEncoder().encode(rnd().toString(36)), salt = new TextEncoder().encode("salt" + i), keyLen = 1 + rint(64);
  // (Nodepod passes `maxmem: opts?.maxmem`; an undefined maxmem replaces
  // noble's default and throws, in noble and here alike)
  const exact = { N: opts.N ?? 16384, r: opts.r ?? 8, p: opts.p ?? 1, dkLen: keyLen, maxmem: undefined };
  T.ok(run(() => F.scrypt(pw, salt, exact)) === run(() => O.scrypt(pw, salt, exact)), `scrypt maxmem: undefined vs noble`);
  const { maxmem, ...o } = exact;
  const r = run(() => F.scrypt(pw, salt, o));
  T.ok(r === "B" + scryptSync(pw, salt, keyLen, { ...opts, maxmem: 2 ** 30 }).toString("base64"), `scrypt ${JSON.stringify(opts)}`);
  T.ok(r === run(() => O.scrypt(pw, salt, o)), `scrypt ${JSON.stringify(opts)} vs noble`);
}

process.exit(T.report() ? 1 : 0);
