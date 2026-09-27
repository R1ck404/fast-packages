// Runs inside the browser page (see browser.mjs): fast vs original, both
// loaded as native ES modules.
export async function run(fastBase, origBase, iters) {
  const mods = ["sha2", "legacy", "hmac", "pbkdf2", "scrypt"];
  const F = {}, O = {};
  for (const m of mods) {
    F[m] = await import(`${fastBase}/${m}.js`);
    O[m] = await import(`${origBase}/${m}.js`);
  }
  const fast = await import(`${fastBase}/_fast.js`);
  let seed = 4242;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const ri = (n) => Math.floor(rnd() * n);
  const bytes = (n) => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = ri(256);
    return b;
  };
  const CH = ["a", "é", "€", "中", "😀", "\ud800", " "];
  const str = (n) => {
    let s = "";
    while (s.length < n) s += CH[ri(CH.length)];
    return s;
  };
  const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
  const snap = (h) =>
    JSON.stringify(h, (k, v) => (v instanceof Uint8Array ? hex(v) : v instanceof DataView ? `dv${v.byteOffset},${v.byteLength}` : v));
  const attempt = (f) => {
    try {
      const r = f();
      return r instanceof Uint8Array ? hex(r) : typeof r;
    } catch (e) {
      return "err:" + e.message;
    }
  };
  let checks = 0;
  const fails = [];
  const eq = (a, b, what) => {
    checks++;
    if (a !== b && fails.length < 20) fails.push({ what, fast: String(a).slice(0, 120), orig: String(b).slice(0, 120) });
  };
  const input = () => (ri(3) === 0 ? str(ri(ri(10) === 0 ? 30000 : 300)) : bytes(ri(ri(10) === 0 ? 200000 : 3000)));

  const H = [["sha256", "sha2", "SHA256"], ["sha224", "sha2", "SHA224"], ["sha512", "sha2", "SHA512"], ["sha384", "sha2", "SHA384"], ["sha512_256", "sha2", "SHA512_256"], ["sha1", "legacy", "SHA1"], ["md5", "legacy", "MD5"]];
  for (const [name, mod, cls] of H) {
    for (let it = 0; it < iters; it++) {
      const x = input();
      eq(hex(F[mod][name](x)), hex(O[mod][name](x)), `${name}()`);
      const a = new F[mod][cls](), b = new O[mod][cls]();
      for (let k = ri(5); k >= 0; k--) {
        const d = input();
        a.update(d);
        b.update(d);
        eq(snap(a), snap(b), `${name} update fields`);
      }
      eq(hex(a.digest()), hex(b.digest()), `${name} digest`);
      eq(snap(a), snap(b), `${name} digest fields`);
      const key = input(), msg = input();
      eq(attempt(() => F.hmac.hmac(F[mod][name], key, msg)), attempt(() => O.hmac.hmac(O[mod][name], key, msg)), `hmac ${name}`);
      const po = { c: 1 + ri(300), dkLen: 1 + ri(100) };
      eq(attempt(() => F.pbkdf2.pbkdf2(F[mod][name], key, msg, po)), attempt(() => O.pbkdf2.pbkdf2(O[mod][name], key, msg, po)), `pbkdf2 ${name}`);
    }
    eq(attempt(() => F[mod][name](5)), attempt(() => O[mod][name](5)), `${name}(bad)`);
  }
  for (let it = 0; it < iters; it++) {
    const o = { N: 2 ** (1 + ri(10)), r: 1 + ri(8), p: 1 + ri(3), dkLen: 1 + ri(64) };
    const pa = [], pb = [];
    eq(attempt(() => F.scrypt.scrypt("pw", "salt", { ...o, onProgress: (x) => pa.push(x) })), attempt(() => O.scrypt.scrypt("pw", "salt", { ...o, onProgress: (x) => pb.push(x) })), `scrypt ${JSON.stringify(o)}`);
    eq(pa.join(), pb.join(), "scrypt progress");
    if (it % 4 === 0) {
      const ra = await F.scrypt.scryptAsync("pw", "salt", o), rb = await O.scrypt.scryptAsync("pw", "salt", o);
      eq(hex(ra), hex(rb), "scryptAsync");
      const qa = await F.pbkdf2.pbkdf2Async(F.sha2.sha256, "pw", "salt", { c: 5000 }), qb = await O.pbkdf2.pbkdf2Async(O.sha2.sha256, "pw", "salt", { c: 5000 });
      eq(hex(qa), hex(qb), "pbkdf2Async");
    }
  }
  return { checks, fails, wasm: fast.wasmActive(), ua: navigator.userAgent };
}
