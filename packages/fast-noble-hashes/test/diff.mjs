// Differential test against @noble/hashes 1.8.0 (node_modules): digests,
// every instance field after every call (buffers included), clones,
// errors, one-shot hashers, HMAC, PBKDF2 (sync/async), scrypt (sync/async,
// progress callbacks), plus node:crypto as an independent reference.
// usage: node test/diff.mjs [--quick] [--cjs] [--seed N]
import { createRequire } from "node:module";
import { createHash, createHmac, pbkdf2Sync, scryptSync } from "node:crypto";

const args = process.argv.slice(2);
const quick = args.includes("--quick");
const cjs = args.includes("--cjs");
const seedArg = args.indexOf("--seed");
let seed = seedArg >= 0 ? Number(args[seedArg + 1]) : 12345;
const require = createRequire(import.meta.url);

async function load(base) {
  const mods = {};
  for (const m of ["sha2", "legacy", "hmac", "pbkdf2", "scrypt", "hkdf", "utils", "sha256", "sha512", "sha1"]) {
    mods[m] = cjs ? require(`${base}/${m}`) : await import(`${base}/${m}`);
  }
  return mods;
}
const F = await load("@r1ck404/fast-noble-hashes");
const O = await load("@noble/hashes");
// the fast paths must actually be in use (or, with --nowasm, not)
const fastMod = cjs ? require("../_fast.js") : await import("../esm/_fast.js");
if (fastMod.wasmActive() !== !args.includes("--nowasm")) throw new Error("wasm active: " + fastMod.wasmActive());

// deterministic PRNG (xorshift32)
function rnd() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}
const ri = (n) => Math.floor(rnd() * n);
function bytes(n) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = ri(256);
  return b;
}
const hex = (u) => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString("hex");
const CHARS = ["a", "z", "0", " ", "é", "ß", "€", "中", "😀", "\ud800", "\udc00", "\n", "\u0000"];
function str(n) {
  let s = "";
  while (s.length < n) s += CHARS[ri(CHARS.length)];
  return s;
}

let checks = 0, fails = 0;
function eq(a, b, what) {
  checks++;
  if (a !== b) {
    fails++;
    if (fails < 30) console.log("FAIL", what, "\n  fast:", String(a).slice(0, 300), "\n  orig:", String(b).slice(0, 300));
  }
}
// after every call, nothing may be left in the wasm scratch memory
function clean(what) {
  checks++;
  if (!fastMod.scratchIsClean()) {
    fails++;
    if (fails < 30) console.log("FAIL wasm memory not wiped after", what);
  }
}
function snap(h) {
  const o = {};
  for (const k of Object.keys(h)) {
    const v = h[k];
    o[k] =
      v instanceof Uint8Array ? "u8:" + hex(v)
        : v instanceof DataView ? `dv:${v.byteOffset},${v.byteLength},${v.buffer === h.buffer?.buffer}`
          : v && typeof v === "object" ? snap(v)
            : v;
  }
  return JSON.stringify(o) + "|" + Object.getPrototypeOf(h).constructor.name;
}
function attempt(f) {
  try {
    const r = f();
    return r instanceof Uint8Array ? "ok:" + hex(r) : "ok:" + typeof r;
  } catch (e) {
    return "err:" + e.constructor.name + ":" + e.message;
  }
}
async function attemptAsync(f) {
  try {
    const r = await f();
    return r instanceof Uint8Array ? "ok:" + hex(r) : "ok:" + typeof r;
  } catch (e) {
    return "err:" + e.constructor.name + ":" + e.message;
  }
}

const HASHES = [
  ["sha256", "sha2", "SHA256", "sha256"],
  ["sha224", "sha2", "SHA224", "sha224"],
  ["sha512", "sha2", "SHA512", "sha512"],
  ["sha384", "sha2", "SHA384", "sha384"],
  ["sha512_224", "sha2", "SHA512_224", "sha512-224"],
  ["sha512_256", "sha2", "SHA512_256", "sha512-256"],
  ["sha1", "legacy", "SHA1", "sha1"],
  ["md5", "legacy", "MD5", "md5"],
  ["ripemd160", "legacy", "RIPEMD160", "ripemd160"],
];

// a random input as the (fast, orig) pair of arguments
function input(maxLen) {
  const kind = ri(10);
  const len = ri(4) === 0 ? ri(maxLen) : ri(300);
  if (kind === 0) {
    const s = str(len);
    return [s, s];
  }
  if (kind === 1) {
    // subarray at an odd offset of a larger buffer
    const b = bytes(len + 7);
    return [b.subarray(3, 3 + len), b.subarray(3, 3 + len)];
  }
  if (kind === 2) {
    const b = Buffer.from(bytes(len));
    return [b, b];
  }
  const b = bytes(len);
  return [b, b];
}

// ------------------------------------------------------------ streaming
function streaming(iters) {
  for (const [name, mod, cls] of HASHES) {
    for (let it = 0; it < iters; it++) {
      let a = new F[mod][cls]();
      let b = new O[mod][cls]();
      const blockLen = a.blockLen;
      const all = [];
      const nops = 1 + ri(8);
      for (let op = 0; op < nops; op++) {
        let [x, y] = input(ri(20) === 0 ? 200000 : 3000);
        if (ri(5) === 0) {
          // lengths around block multiples
          const n = blockLen * ri(4) + ri(3) - 1;
          x = y = bytes(Math.max(0, n));
        }
        eq(attempt(() => a.update(x) && 0), attempt(() => b.update(y) && 0), `${name} update`);
        all.push(typeof x === "string" ? Buffer.from(x) : Buffer.from(x));
        eq(snap(a), snap(b), `${name} fields after update`);
        clean(`${name} update`);
        if (ri(6) === 0) {
          const ca = a.clone(), cb = b.clone();
          eq(snap(ca), snap(cb), `${name} clone`);
          if (ri(2)) {
            a = ca;
            b = cb;
          } else {
            ca.update("x");
            cb.update("x");
            eq(snap(ca), snap(cb), `${name} clone update`);
            eq(hex(ca.digest()), hex(cb.digest()), `${name} clone digest`);
          }
        }
        if (ri(10) === 0) {
          // _cloneInto an existing instance
          const ta = new F[mod][cls](), tb = new O[mod][cls]();
          ta.update(bytes(ri(200)));
          tb.update(ta.buffer.slice(0, 0));
          a._cloneInto(ta);
          b._cloneInto(tb);
          eq(snap(ta).replace(/"buffer":"u8:[0-9a-f]*"/, ""), snap(tb).replace(/"buffer":"u8:[0-9a-f]*"/, ""), `${name} _cloneInto`);
        }
      }
      const r = ri(4);
      if (r === 0) {
        const oa = new Uint8Array(a.outputLen + ri(5)), ob = new Uint8Array(oa.length);
        eq(attempt(() => a.digestInto(oa)), attempt(() => b.digestInto(ob)), `${name} digestInto`);
        eq(hex(oa), hex(ob), `${name} digestInto out`);
        eq(snap(a), snap(b), `${name} fields after digestInto`);
      } else if (r === 1) {
        // digestInto a subarray of a larger buffer
        const oa = new Uint8Array(a.outputLen + 16), ob = new Uint8Array(oa.length);
        eq(attempt(() => a.digestInto(oa.subarray(5))), attempt(() => b.digestInto(ob.subarray(5))), `${name} digestInto sub`);
        eq(hex(oa), hex(ob), `${name} digestInto sub out`);
        eq(snap(a), snap(b), `${name} fields after digestInto sub`);
      } else {
        const da = a.digest(), db = b.digest();
        eq(hex(da), hex(db), `${name} digest`);
        eq(da.buffer.byteLength + ":" + da.byteOffset, db.buffer.byteLength + ":" + db.byteOffset, `${name} digest array`);
        eq(snap(a), snap(b), `${name} fields after digest`);
        clean(`${name} digest`);
        const ref = HASHES.find((h) => h[0] === name)[3];
        eq(hex(da), createHash(ref).update(Buffer.concat(all)).digest("hex"), `${name} vs node:crypto`);
      }
      // everything after the end errors the same way
      eq(attempt(() => a.update("x")), attempt(() => b.update("x")), `${name} update after digest`);
      eq(attempt(() => a.digest()), attempt(() => b.digest()), `${name} digest twice`);
      a.destroy();
      b.destroy();
      eq(snap(a), snap(b), `${name} destroyed`);
    }
  }
}

// ------------------------------------------------------------ errors
function errors() {
  const bad = [undefined, null, 1, {}, [1, 2], new Uint16Array(4), new ArrayBuffer(4), new DataView(new ArrayBuffer(4)), Symbol("s")];
  for (const [name, mod, cls] of HASHES) {
    for (const v of bad) {
      eq(attempt(() => F[mod][name](v)), attempt(() => O[mod][name](v)), `${name}(bad ${String(v?.constructor?.name ?? typeof v)})`);
      eq(attempt(() => new F[mod][cls]().update(v)), attempt(() => new O[mod][cls]().update(v)), `${name}.update(bad)`);
    }
    for (const n of [0, 5, 15, 16, 19, 27, 28]) {
      const a = new F[mod][cls](), b = new O[mod][cls]();
      eq(attempt(() => a.digestInto(new Uint8Array(n))), attempt(() => b.digestInto(new Uint8Array(n))), `${name}.digestInto(${n})`);
      eq(snap(a), snap(b), `${name} fields after bad digestInto`);
    }
    const a = new F[mod][cls](), b = new O[mod][cls]();
    eq(attempt(() => a.digestInto([1, 2, 3])), attempt(() => b.digestInto([1, 2, 3])), `${name}.digestInto(array)`);
    a.destroy();
    b.destroy();
    eq(attempt(() => a.update("x")), attempt(() => b.update("x")), `${name} update destroyed`);
    eq(attempt(() => a.digest()), attempt(() => b.digest()), `${name} digest destroyed`);
  }
}

// streamed strings of 3-byte UTF-8 around the wasm buffer size, after
// 0..blockLen-1 buffered bytes
function stringEdges() {
  for (const [name, mod, cls] of HASHES) {
    const bl = new F[mod][cls]().blockLen;
    for (const pre of [0, 1, bl - 1]) {
      for (const n of [21845 - 43, 21845 - 22, 21845 - 1, 21845, 21846]) {
        const x = "中".repeat(n);
        const a = new F[mod][cls](), b = new O[mod][cls]();
        a.update(new Uint8Array(pre));
        b.update(new Uint8Array(pre));
        a.update(x);
        b.update(x);
        eq(snap(a), snap(b), `${name} string edge pre=${pre} n=${n}`);
        eq(hex(a.digest()), hex(b.digest()), `${name} string edge digest`);
        clean("string edge");
      }
    }
  }
}

// instances whose parameters were changed from outside run noble's code
function tampered() {
  for (const [name, mod, cls] of HASHES) {
    for (const [field, value] of [["outputLen", 16], ["outputLen", 12], ["padOffset", 20], ["isLE", true], ["blockLen", 32]]) {
      const a = new F[mod][cls](), b = new O[mod][cls]();
      a.update("abc");
      b.update("abc");
      a[field] = b[field] = value;
      const d = bytes(ri(300));
      eq(attempt(() => a.update(d) && 0), attempt(() => b.update(d) && 0), `${name} tampered ${field} update`);
      eq(snap(a), snap(b), `${name} tampered ${field} fields`);
      eq(attempt(() => a.digest()), attempt(() => b.digest()), `${name} tampered ${field} digest`);
    }
  }
}

// ------------------------------------------------------------ one-shot
function oneshot(iters) {
  for (const [name, mod, cls, ref] of HASHES) {
    const fa = F[mod][name], fb = O[mod][name];
    eq([fa.name, fa.length, fa.outputLen, fa.blockLen, Object.keys(fa).join()].join(), [fb.name, fb.length, fb.outputLen, fb.blockLen, Object.keys(fb).join()].join(), `${name} hasher shape`);
    eq(fa.create().constructor, F[mod][cls], `${name}.create()`);
    eq(snap(fa.create()), snap(fb.create()), `${name}.create() fields`);
    for (let it = 0; it < iters; it++) {
      const big = ri(15) === 0;
      let [x, y] = input(big ? 300000 : 70000);
      if (ri(8) === 0) {
        // long strings: past the direct-encode limit
        x = y = str(21846 + ri(3) - 1 + (ri(3) === 0 ? ri(100000) : 0));
      }
      const da = fa(x), db = fb(y);
      eq(hex(da), hex(db), `${name}(msg)`);
      clean(`${name}(msg)`);
      eq(da.constructor.name + da.byteOffset + ":" + da.buffer.byteLength, db.constructor.name + db.byteOffset + ":" + db.buffer.byteLength, `${name}() result array`);
      eq(hex(da), createHash(ref).update(typeof x === "string" ? Buffer.from(x) : x).digest("hex"), `${name}() vs node:crypto`);
    }
    // strings of 3-byte UTF-8 (and lone surrogates, also 3 bytes) around
    // the size that still fits the wasm input buffer (64 KB / 3)
    for (let n = 21830; n <= 21860; n++) {
      for (const ch of ["中", "�", "€"]) {
        const x = ch.repeat(n - 1) + "a";
        eq(hex(fa(x)), hex(fb(x)), `${name}(${n} x 3-byte chars)`);
      }
    }
    // every length around the block and padding boundaries
    for (let n = 0; n <= 300; n++) {
      const d = bytes(n);
      eq(hex(fa(d)), hex(fb(d)), `${name}(${n} bytes)`);
    }
  }
  // deprecated aliases are the same objects
  eq(F.sha256.sha256, F.sha2.sha256, "sha256 alias");
  eq(F.sha512.sha384, F.sha2.sha384, "sha512 alias");
  eq(F.sha1.sha1, F.legacy.sha1, "sha1 alias");
}

// ------------------------------------------------------------ hmac
function hmacs(iters) {
  for (const [name, mod, , ref] of HASHES) {
    for (let it = 0; it < iters; it++) {
      const [ka, kb] = input(ri(4) === 0 ? 400 : 100);
      const [ma, mb] = input(5000);
      const r1 = attempt(() => F.hmac.hmac(F[mod][name], ka, ma));
      eq(r1, attempt(() => O.hmac.hmac(O[mod][name], kb, mb)), `hmac ${name}`);
      const kbuf = typeof ka === "string" ? Buffer.from(ka) : ka;
      eq(r1, "ok:" + createHmac(ref, kbuf).update(typeof ma === "string" ? Buffer.from(ma) : ma).digest("hex"), `hmac ${name} vs node:crypto`);
      const a = F.hmac.hmac.create(F[mod][name], ka), b = O.hmac.hmac.create(O[mod][name], kb);
      eq(snap(a), snap(b), `hmac ${name} fields`);
      a.update(ma);
      b.update(mb);
      const ca = a.clone(), cb = b.clone();
      eq(snap(ca), snap(cb), `hmac ${name} clone`);
      eq(hex(a.digest()), hex(b.digest()), `hmac ${name} digest`);
      eq(snap(a), snap(b), `hmac ${name} fields after digest`);
      ca.update("more");
      cb.update("more");
      eq(hex(ca.digest()), hex(cb.digest()), `hmac ${name} clone digest`);
    }
  }
  // hkdf goes through hmac
  for (let it = 0; it < iters; it++) {
    const ikm = bytes(ri(100)), salt = ri(3) ? bytes(ri(100)) : undefined, info = bytes(ri(50)), len = 1 + ri(200);
    for (const h of ["sha256", "sha512", "sha1"]) {
      const mod = h === "sha1" ? "legacy" : "sha2";
      eq(attempt(() => F.hkdf.hkdf(F[mod][h], ikm, salt, info, len)), attempt(() => O.hkdf.hkdf(O[mod][h], ikm, salt, info, len)), `hkdf ${h}`);
    }
  }
}

// ------------------------------------------------------------ pbkdf2
async function pbkdf2s(iters) {
  for (const [name, mod, , ref] of HASHES) {
    for (let it = 0; it < iters; it++) {
      const c = ri(4) === 0 ? 1 : 1 + ri(ri(3) === 0 ? 5000 : 50);
      const dkLen = ri(4) === 0 ? 1 + ri(8) : 1 + ri(200);
      const [pa, pb] = input(ri(5) === 0 ? 300 : 40);
      const [sa, sb] = input(60);
      const r1 = attempt(() => F.pbkdf2.pbkdf2(F[mod][name], pa, sa, { c, dkLen }));
      eq(r1, attempt(() => O.pbkdf2.pbkdf2(O[mod][name], pb, sb, { c, dkLen })), `pbkdf2 ${name} c=${c} dkLen=${dkLen}`);
      clean("pbkdf2");
      if (name !== "ripemd160") {
        const bp = typeof pa === "string" ? Buffer.from(pa) : pa, bs = typeof sa === "string" ? Buffer.from(sa) : sa;
        eq(r1, "ok:" + pbkdf2Sync(bp, bs, c, dkLen, ref).toString("hex"), `pbkdf2 ${name} vs node:crypto`);
      }
      if (it % 4 === 0) {
        const tick = ri(3);
        eq(
          await attemptAsync(() => F.pbkdf2.pbkdf2Async(F[mod][name], pa, sa, { c, dkLen, asyncTick: tick })),
          r1,
          `pbkdf2Async ${name} c=${c}`,
        );
      }
    }
  }
  // custom hashers built from noble's classes also use wasm; errors
  const own = F.utils.createHasher(() => new F.sha2.SHA256());
  eq(attempt(() => F.pbkdf2.pbkdf2(own, "p", "s", { c: 100 })), attempt(() => O.pbkdf2.pbkdf2(O.sha2.sha256, "p", "s", { c: 100 })), "pbkdf2 createHasher");
  for (const opts of [{ c: 0 }, { c: -1 }, { c: 1.5 }, {}, { c: 1, dkLen: -1 }, { c: 1, dkLen: 0 }, { c: 2, asyncTick: "x" }, undefined, null]) {
    eq(attempt(() => F.pbkdf2.pbkdf2(F.sha2.sha256, "p", "s", opts)), attempt(() => O.pbkdf2.pbkdf2(O.sha2.sha256, "p", "s", opts)), `pbkdf2 opts ${JSON.stringify(opts)}`);
    eq(await attemptAsync(() => F.pbkdf2.pbkdf2Async(F.sha2.sha256, "p", "s", opts)), await attemptAsync(() => O.pbkdf2.pbkdf2Async(O.sha2.sha256, "p", "s", opts)), `pbkdf2Async opts ${JSON.stringify(opts)}`);
  }
  for (const [p, s] of [[1, "s"], ["p", 1], [null, "s"], ["p", [1]]]) {
    eq(attempt(() => F.pbkdf2.pbkdf2(F.sha2.sha256, p, s, { c: 2 })), attempt(() => O.pbkdf2.pbkdf2(O.sha2.sha256, p, s, { c: 2 })), "pbkdf2 bad input");
  }
  eq(attempt(() => F.pbkdf2.pbkdf2({}, "p", "s", { c: 2 })), attempt(() => O.pbkdf2.pbkdf2({}, "p", "s", { c: 2 })), "pbkdf2 bad hash");
}

// ------------------------------------------------------------ scrypt
async function scrypts(iters) {
  for (let it = 0; it < iters; it++) {
    const N = 2 ** (1 + ri(quick ? 8 : 11));
    const r = 1 + ri(8);
    const p = 1 + ri(3);
    const dkLen = 1 + ri(100);
    const [pa, pb] = input(50);
    const [sa, sb] = input(50);
    const progA = [], progB = [];
    const withProgress = ri(2) === 0;
    const oa = { N, r, p, dkLen, ...(withProgress ? { onProgress: (x) => progA.push(x) } : {}) };
    const ob = { N, r, p, dkLen, ...(withProgress ? { onProgress: (x) => progB.push(x) } : {}) };
    const r1 = attempt(() => F.scrypt.scrypt(pa, sa, oa));
    eq(r1, attempt(() => O.scrypt.scrypt(pb, sb, ob)), `scrypt N=${N} r=${r} p=${p}`);
    eq(progA.join(), progB.join(), `scrypt progress N=${N} r=${r} p=${p}`);
    const bp = typeof pa === "string" ? Buffer.from(pa) : pa, bs = typeof sa === "string" ? Buffer.from(sa) : sa;
    eq(r1, "ok:" + scryptSync(bp, bs, dkLen, { N, r, p, maxmem: 2 ** 31 }).toString("hex"), "scrypt vs node:crypto");
    if (it % 3 === 0) {
      const pa2 = [], pb2 = [];
      const tick = ri(3);
      eq(
        await attemptAsync(() => F.scrypt.scryptAsync(pa, sa, { ...oa, asyncTick: tick, ...(withProgress ? { onProgress: (x) => pa2.push(x) } : {}) })),
        await attemptAsync(() => O.scrypt.scryptAsync(pb, sb, { ...ob, asyncTick: tick, ...(withProgress ? { onProgress: (x) => pb2.push(x) } : {}) })),
        `scryptAsync N=${N}`,
      );
      eq(pa2.join(), pb2.join(), "scryptAsync progress");
    }
  }
  const bad = [
    { N: 1, r: 1, p: 1 }, { N: 3, r: 1, p: 1 }, { N: 2 ** 33, r: 1, p: 1 }, { N: 16, r: 0, p: 1 }, { N: 16, r: 1, p: 0 },
    { N: 16, r: 1, p: 1, dkLen: 0 }, { N: 16, r: 1, p: 1, maxmem: 100 }, { N: 16, r: 1, p: 1, onProgress: 5 },
    { N: 16, r: -1, p: 1 }, { N: 16, r: 1.5, p: 1 }, { N: 2 ** 20, r: 8, p: 1, maxmem: 2 ** 20 }, {}, undefined,
  ];
  for (const o of bad) {
    eq(attempt(() => F.scrypt.scrypt("p", "s", o)), attempt(() => O.scrypt.scrypt("p", "s", o)), `scrypt opts ${JSON.stringify(o)}`);
  }
  // total BlockMix count not a multiple of the report interval: the last
  // report comes from the `cnt === total` branch
  for (const o of [{ N: 2 ** 14, r: 1, p: 3 }, { N: 2 ** 13, r: 1, p: 7 }]) {
    const la = [], lb = [];
    eq(attempt(() => F.scrypt.scrypt("p", "s", { ...o, onProgress: (x) => la.push(x) })), attempt(() => O.scrypt.scrypt("p", "s", { ...o, onProgress: (x) => lb.push(x) })), `scrypt ${JSON.stringify(o)}`);
    eq(la.length + ":" + la.join(), lb.length + ":" + lb.join(), `scrypt progress ${JSON.stringify(o)}`);
  }
  // an onProgress that throws part-way
  const thrower = (log) => (x) => {
    log.push(x);
    if (log.length === 3) throw new Error("stop");
  };
  const la = [], lb = [];
  eq(attempt(() => F.scrypt.scrypt("p", "s", { N: 1024, r: 2, p: 2, onProgress: thrower(la) })), attempt(() => O.scrypt.scrypt("p", "s", { N: 1024, r: 2, p: 2, onProgress: thrower(lb) })), "scrypt onProgress throws");
  eq(la.join(), lb.join(), "scrypt onProgress throws log");
}

// ------------------------------------------------------------ subclasses
function subclasses() {
  const make = (M) => {
    class Weird256 extends M.sha2.SHA256 {
      process(view, offset) {
        super.process(view, offset);
        this.A ^= 1;
      }
    }
    class Weird1 extends M.legacy.SHA1 {
      roundClean() {
        super.roundClean();
        this.E ^= 2;
      }
    }
    return { Weird256, Weird1, w256: M.utils.createHasher(() => new Weird256()), w1: M.utils.createHasher(() => new Weird1()) };
  };
  const a = make(F), b = make(O);
  for (let it = 0; it < 20; it++) {
    const d = bytes(ri(3) ? ri(300) : ri(5000));
    for (const h of ["w256", "w1"]) {
      eq(hex(a[h](d)), hex(b[h](d)), `subclass ${h}`);
      const x = a[h].create(), y = b[h].create();
      x.update(d.subarray(0, 10)).update(d.subarray(10));
      y.update(d.subarray(0, 10)).update(d.subarray(10));
      eq(snap(x), snap(y), `subclass ${h} fields`);
      eq(attempt(() => F.hmac.hmac(a[h], d, "m")), attempt(() => O.hmac.hmac(b[h], d, "m")), `subclass ${h} hmac`);
      const po = { c: 1 + ri(30), dkLen: 1 + ri(70) };
      eq(attempt(() => F.pbkdf2.pbkdf2(a[h], d, "salt", po)), attempt(() => O.pbkdf2.pbkdf2(b[h], d, "salt", po)), `subclass ${h} pbkdf2`);
    }
  }
}

const t0 = Date.now();
const n = quick ? 1 : 10;
streaming(40 * n);
errors();
tampered();
stringEdges();
oneshot(40 * n);
hmacs(10 * n);
subclasses();
await pbkdf2s(6 * n);
await scrypts(quick ? 6 : 40);
console.log(`${cjs ? "cjs" : "esm"}${args.includes("--nowasm") ? " (no wasm)" : ""}: ${checks} checks, ${fails} failures (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
