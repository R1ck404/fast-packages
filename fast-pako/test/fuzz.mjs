// Differential fuzz tests: fast-pako vs pako 2.1.0 (node_modules).
//   node fast-pako/test/fuzz.mjs [--quick] [--seed=N]
// Complements equiv.mjs with
//  * crafted deflate streams hitting every decoder corner (invalid fixed
//    symbols, incomplete/empty distance codes, 15-bit codes, bad sets),
//  * random dynamic Huffman headers followed by random bits,
//  * streaming Inflate with tiny/random pushes and flush modes, comparing
//    every observable field (incl. strm.data_type = bits held + flags),
//  * random deflate options (level/windowBits/memLevel/strategy/chunkSize)
//    on mixed data, streaming Deflate with random pushes and flush modes,
//  * Nodepod usage patterns (deflateRaw level 1 of joined files,
//    Deflate({level:1, raw:true}) in slices, inflateRaw back),
//  * error shapes (thrown values, err/msg, ended, result).
import pako from "pako";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
// FASTPAKO_IMPL=<path to an index.mjs> tests another build (e.g. a snapshot)
const fast = (await import(process.env.FASTPAKO_IMPL ? pathToFileURL(resolve(process.env.FASTPAKO_IMPL)).href : "../index.mjs")).default;
import { loadJs, utf8, randomBytes, read } from "../../bench/corpus.mjs";

const QUICK = process.argv.includes("--quick");
const seedArg = process.argv.find((a) => a.startsWith("--seed="));
let seed = seedArg ? Number(seedArg.slice(7)) >>> 0 || 1 : 0x2545f491;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const ri = (n) => Math.floor(rnd() * n);
const pick = (a) => a[ri(a.length)];

let failures = 0, checks = 0;
const fail = (m) => { failures++; if (failures <= 30) console.log("FAIL:", m); };

// ------------------------------------------------------------ comparison
const show = (v) => {
  if (v instanceof Uint8Array) return "u8[" + v.length + "]:" + (v.length < 4096 ? Array.from(v).join(",") : hash(v));
  if (typeof v === "string") return "str:" + (v.length < 4096 ? JSON.stringify(v) : v.length + ":" + hash(utf8(v)));
  return typeof v + ":" + String(v);
};
function hash(u8) { let h = 0x811c9dc5; for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + "/" + u8.length; }
function outcome(fn) {
  try { const r = fn(); return "ok " + show(r) + (r instanceof Uint8Array ? ` off${r.byteOffset} buf${r.buffer.byteLength}` : ""); }
  catch (e) { return "throw " + (e instanceof Error ? "Error:" + e.message : typeof e + ":" + String(e)); }
}
function same(label, fa, fb) {
  checks++;
  const a = outcome(fa), b = outcome(fb);
  if (a !== b) fail(`${label}: pako ${a.slice(0, 120)} | fast ${b.slice(0, 120)}`);
}

function inflateLog(P, opts, pieces) {
  const log = [];
  let inf;
  try { inf = new P.Inflate({ ...opts }); } catch (e) { return "ctor:" + e.message; }
  inf.onData = function (c) { log.push("d" + show(c)); this.chunks.push(c); };
  for (const [data, flush] of pieces) {
    let r;
    try { r = inf.push(data, flush); } catch (e) { log.push("throw " + e.message); break; }
    const s = inf.strm;
    log.push(`p ${r} ${inf.err} ${inf.msg} ${inf.ended} ${s.total_in} ${s.total_out} ${s.avail_in} ${s.next_in} ${s.adler >>> 0} ${s.data_type} ${s.avail_out}`);
  }
  const h = inf.header;
  if (h) log.push(`h ${h.text} ${h.time} ${h.xflags} ${h.os} ${h.extra && Array.from(h.extra)} ${h.extra_len} ${h.name} ${h.comment} ${h.hcrc} ${h.done}`);
  log.push(`e ${inf.err} ${inf.msg} ${inf.result === undefined ? "undef" : show(inf.result)}`);
  return log.join("\n");
}
function deflateLog(P, opts, pieces) {
  const log = [];
  let d;
  try { d = new P.Deflate({ ...opts }); } catch (e) { return "ctor:" + e.message; }
  d.onData = function (c) { log.push("d" + show(c) + ` ${c.byteOffset} ${c.buffer.byteLength}`); this.chunks.push(c); };
  for (const [data, flush] of pieces) {
    let r;
    try { r = d.push(data, flush); } catch (e) { log.push("throw " + e.message); break; }
    const s = d.strm;
    log.push(`p ${r} ${d.err} ${d.msg} ${d.ended} ${s.total_in} ${s.total_out} ${s.avail_in} ${s.next_in} ${s.adler >>> 0} ${s.data_type} ${s.avail_out}`);
  }
  log.push(`e ${d.err} ${d.msg} ${d.result === undefined ? "undef" : show(d.result)}`);
  return log.join("\n");
}
function splitPieces(buf, sizes, flushes) {
  const pieces = [];
  let p = 0;
  while (p < buf.length) { const n = Math.max(1, Math.min(buf.length - p, typeof sizes === "function" ? sizes() : sizes)); pieces.push([buf.subarray(p, p + n), flushes ? pick(flushes) : 0]); p += n; }
  return pieces;
}
function cmpInflateStream(label, input, opts, pieces) {
  checks++;
  const a = inflateLog(pako, opts, pieces), b = inflateLog(fast, opts, pieces);
  if (a !== b) {
    const la = a.split("\n"), lb = b.split("\n");
    let i = 0; while (i < la.length && la[i] === lb[i]) i++;
    fail(`${label} ${JSON.stringify(opts)} line ${i}: pako ${String(la[i]).slice(0, 150)} | fast ${String(lb[i]).slice(0, 150)}`);
  }
}
function cmpDeflateStream(label, opts, pieces) {
  checks++;
  const a = deflateLog(pako, opts, pieces), b = deflateLog(fast, opts, pieces);
  if (a !== b) {
    const la = a.split("\n"), lb = b.split("\n");
    let i = 0; while (i < la.length && la[i] === lb[i]) i++;
    fail(`${label} ${JSON.stringify(opts)} line ${i}: pako ${String(la[i]).slice(0, 150)} | fast ${String(lb[i]).slice(0, 150)}`);
  }
}

// ------------------------------------------------------------ bit writer
class Bits {
  constructor() { this.out = []; this.acc = 0; this.n = 0; }
  put(v, n) { for (let i = 0; i < n; i++) { this.acc |= ((v >>> i) & 1) << this.n; if (++this.n === 8) { this.out.push(this.acc); this.acc = 0; this.n = 0; } } }
  putRev(code, len) { for (let i = len - 1; i >= 0; i--) this.put((code >>> i) & 1, 1); } // Huffman codes MSB-first
  bytes() { const o = this.out.slice(); if (this.n) o.push(this.acc); return new Uint8Array(o); }
}
function canon(lens) {
  const count = new Array(16).fill(0); for (const l of lens) if (l) count[l]++;
  const next = new Array(16).fill(0); let code = 0;
  for (let b = 1; b < 16; b++) { code = (code + count[b - 1]) << 1; next[b] = code; }
  return lens.map((l) => (l ? next[l]++ : -1));
}
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
// write a dynamic block header for litlen lens (257..286) and dist lens (1..32)
function dynHeader(bw, last, llens, dlens, clOverride) {
  bw.put(last ? 1 : 0, 1); bw.put(2, 2);
  bw.put(llens.length - 257, 5); bw.put(dlens.length - 1, 5);
  const all = [...llens, ...dlens];
  // code-length code: plain lengths 0..15 only (no repeat codes), 5-bit fixed-ish code
  const clLens = clOverride || new Array(19).fill(0).map((_, s) => (s < 16 ? 4 : 0));
  if (!clOverride) { clLens[16] = 0; }
  let hclen = 19; while (hclen > 4 && clLens[CL_ORDER[hclen - 1]] === 0) hclen--;
  bw.put(hclen - 4, 4);
  for (let i = 0; i < hclen; i++) bw.put(clLens[CL_ORDER[i]], 3);
  const clCodes = canon(clLens);
  for (const l of all) { if (clCodes[l] < 0) throw new Error("no cl code for " + l); bw.putRev(clCodes[l], clLens[l]); }
  return { lcodes: canon(llens), dcodes: canon(dlens) };
}
// valid-ish length lens with some long codes: Kraft-complete by construction
function randomCompleteLens(n, maxLen) {
  // start with a random full binary tree via splitting
  let leaves = [0]; // depths
  while (leaves.length < n) {
    const i = ri(leaves.length);
    if (leaves[i] >= maxLen) { if (leaves.every((d) => d >= maxLen)) break; continue; }
    const d = leaves[i] + 1; leaves.splice(i, 1, d, d);
  }
  while (leaves.length < n) leaves.push(0);
  // shuffle
  for (let i = leaves.length - 1; i > 0; i--) { const j = ri(i + 1); [leaves[i], leaves[j]] = [leaves[j], leaves[i]]; }
  return leaves.slice(0, n);
}

// ------------------------------------------------------------ crafted streams
const crafted = [];
{
  // fixed block with literal 286 / 287 (invalid) after some literals
  const fixedLitCode = (s) => (s < 144 ? [0x30 + s, 8] : s < 256 ? [0x190 + s - 144, 9] : s < 280 ? [s - 256, 7] : [0xc0 + s - 280, 8]);
  for (const bad of [286, 287]) {
    const bw = new Bits(); bw.put(1, 1); bw.put(1, 2);
    for (const c of "hello") { const [code, len] = fixedLitCode(c.charCodeAt(0)); bw.putRev(code, len); }
    const [code, len] = fixedLitCode(bad); bw.putRev(code, len);
    bw.put(0x5a5a, 16);
    crafted.push([`fixed lit ${bad}`, bw.bytes()]);
  }
  // fixed block with dist code 30 / 31
  for (const dc of [30, 31, 29, 0]) {
    const bw = new Bits(); bw.put(1, 1); bw.put(1, 2);
    for (const c of "abcabc") { const [code, len] = fixedLitCode(c.charCodeAt(0)); bw.putRev(code, len); }
    const [code, len] = fixedLitCode(257); bw.putRev(code, len); // length 3
    bw.putRev(dc, 5); bw.put(0, 13);
    const [ec, el] = fixedLitCode(256); bw.putRev(ec, el);
    bw.put(0, 8);
    crafted.push([`fixed dist ${dc}`, bw.bytes()]);
  }
  // dynamic: incomplete distance code (single 1-bit code), using code 0 then the missing code 1
  for (const useMissing of [false, true]) {
    const llens = new Array(258).fill(0); for (let i = 0; i < 256; i++) llens[i] = 9; llens[256] = 9; llens[257] = 9;
    // 258 symbols of length 9 is over-subscribed? 512 slots, 258 used -> incomplete: fix by giving remaining lengths
    const L = randomCompleteLens(258, 12); for (let i = 0; i < 258; i++) llens[i] = L[i] || 12;
    const fixL = completeFix(llens);
    const dlens = [1];
    const bw = new Bits();
    let hdr;
    try { hdr = dynHeader(bw, true, fixL, dlens); } catch { continue; }
    for (const c of "xyzxyz") bw.putRev(hdr.lcodes[c.charCodeAt(0)], fixL[c.charCodeAt(0)]);
    bw.putRev(hdr.lcodes[257], fixL[257]); // length 3
    bw.put(useMissing ? 1 : 0, 1); // distance code bit
    bw.putRev(hdr.lcodes[256], fixL[256]);
    bw.put(0, 16);
    crafted.push([`dyn single dist code ${useMissing ? "missing" : "ok"}`, bw.bytes()]);
  }
  // dynamic: no distance codes at all, but a length symbol follows
  {
    const llens = completeFix(randomCompleteLens(258, 10));
    const bw = new Bits(); const hdr = dynHeader(bw, true, llens, [0]);
    bw.putRev(hdr.lcodes[65], llens[65]); bw.putRev(hdr.lcodes[257], llens[257]); bw.put(ri(2), 1); bw.put(0, 24);
    crafted.push(["dyn no dist codes + length", bw.bytes()]);
  }
  // over-subscribed / incomplete sets
  {
    const ll = new Array(257).fill(8); // 257 codes of 8 bits: over-subscribed
    const bw = new Bits(); try { dynHeader(bw, true, ll, [1]); } catch {} bw.put(0, 32); crafted.push(["over-subscribed litlen", bw.bytes()]);
    const ll2 = new Array(257).fill(9); ll2[0] = 0; // incomplete litlen
    const bw2 = new Bits(); try { dynHeader(bw2, true, ll2, [1]); } catch {} bw2.put(0, 32); crafted.push(["incomplete litlen", bw2.bytes()]);
    const ll3 = completeFix(randomCompleteLens(258, 9));
    const bw3 = new Bits(); try { dynHeader(bw3, true, ll3, [2, 2, 2]); } catch {} bw3.put(0, 32); crafted.push(["incomplete dists (3x2)", bw3.bytes()]);
    const bw4 = new Bits(); try { dynHeader(bw4, true, ll3, [1, 1, 1]); } catch {} bw4.put(0, 32); crafted.push(["over-subscribed dists", bw4.bytes()]);
  }
}
// make lengths Kraft-complete (lengthen/shorten greedily), max 15
function completeFix(lens) {
  const l = lens.map((x) => Math.min(15, Math.max(1, x)));
  const k = () => l.reduce((s, x) => s + 2 ** (15 - x), 0);
  let guard = 0;
  while (k() > 2 ** 15 && guard++ < 10000) { let i = ri(l.length); if (l[i] < 15) l[i]++; }
  while (k() < 2 ** 15 && guard++ < 20000) { const need = 2 ** 15 - k(); let best = -1; for (let i = 0; i < l.length; i++) if (l[i] > 1 && 2 ** (15 - l[i]) <= need) { best = i; break; } if (best < 0) break; l[best]--; }
  return l;
}

const pushSizes = QUICK ? [1, 3, 7] : [1, 2, 3, 5, 7, 11, 64];
for (const [name, bytes] of crafted) {
  for (const raw of [true]) {
    same(`crafted ${name} one-shot`, () => pako.inflateRaw(bytes), () => fast.inflateRaw(bytes));
    same(`crafted ${name} one-shot str`, () => pako.inflateRaw(bytes, { to: "string" }), () => fast.inflateRaw(bytes, { to: "string" }));
    for (const ps of pushSizes) for (const fl of [[0], [2], [0, 2, 3, 5, 6], [4]]) cmpInflateStream(`crafted ${name} push${ps} fl${fl}`, bytes, { raw: true, chunkSize: 64 }, splitPieces(bytes, ps, fl));
  }
}

// ------------------------------------------------------------ random dynamic headers + random bits
{
  const n = QUICK ? 1500 : 6000;
  for (let t = 0; t < n; t++) {
    const bw = new Bits();
    const nl = 257 + ri(30), nd = 1 + ri(30);
    let llens, dlens;
    const kind = ri(6);
    if (kind === 0) { llens = new Array(nl).fill(0).map(() => ri(16)); dlens = new Array(nd).fill(0).map(() => ri(16)); }
    else { llens = completeFix(randomCompleteLens(nl, 9 + ri(7))); dlens = kind === 1 ? [ri(2)] : completeFix(randomCompleteLens(nd, 3 + ri(13))); if (kind === 2) dlens = new Array(nd).fill(0); }
    if (ri(4) === 0) llens[256] = 0;
    let hdr;
    try { hdr = dynHeader(bw, rnd() < 0.7, llens, dlens); } catch { continue; }
    // symbols: mostly valid codes then random bits
    const nsym = ri(200);
    for (let i = 0; i < nsym; i++) {
      const r = rnd();
      if (r < 0.6) { const s = ri(256); if (hdr.lcodes[s] >= 0) bw.putRev(hdr.lcodes[s], llens[s]); }
      else if (r < 0.9) {
        const s = 257 + ri(nl - 257); if (hdr.lcodes[s] < 0) continue; bw.putRev(hdr.lcodes[s], llens[s]);
        bw.put(ri(32), [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0][s - 257] || 0);
        const d = ri(Math.min(nd, 8)); if (hdr.dcodes[d] >= 0) { bw.putRev(hdr.dcodes[d], dlens[d]); bw.put(0, [0, 0, 0, 0, 1, 1, 2, 2][d]); } else bw.put(ri(4), 2);
      } else bw.put(ri(256), 8);
    }
    if (hdr.lcodes[256] >= 0 && rnd() < 0.5) bw.putRev(hdr.lcodes[256], llens[256]);
    for (let i = 0; i < ri(8); i++) bw.put(ri(256), 8);
    const bytes = bw.bytes();
    same(`randhdr#${t}`, () => pako.inflateRaw(bytes), () => fast.inflateRaw(bytes));
    if (t % 4 === 0) cmpInflateStream(`randhdr#${t} stream`, bytes, { raw: true, chunkSize: pick([64, 100, 1000]) }, splitPieces(bytes, () => 1 + ri(9), [0, 0, 2, 3, 5, 6, false, true]));
  }
}
// random fixed-Huffman blocks (only these can contain literal codes 286/287
// and distance codes 30/31), mixed with valid symbols and stored blocks
{
  const fixedLit = (s) => (s < 144 ? [0x30 + s, 8] : s < 256 ? [0x190 + s - 144, 9] : s < 280 ? [s - 256, 7] : [0xc0 + s - 280, 8]);
  const LX = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0];
  const DX = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0];
  const n = QUICK ? 800 : 3000;
  for (let t = 0; t < n; t++) {
    const bw = new Bits();
    const nblocks = 1 + ri(3);
    let produced = 0;
    for (let b = 0; b < nblocks; b++) {
      const last = b === nblocks - 1;
      if (rnd() < 0.15) { // stored block
        bw.put(last ? 1 : 0, 1); bw.put(0, 2); if (bw.n) bw.put(0, 8 - bw.n);
        const len = ri(40); const bad = rnd() < 0.1;
        bw.put(len, 16); bw.put(bad ? len : ~len & 0xffff, 16);
        for (let i = 0; i < len; i++) bw.put(65 + ri(26), 8);
        produced += len;
        continue;
      }
      bw.put(last ? 1 : 0, 1); bw.put(1, 2);
      const nsym = ri(120);
      for (let i = 0; i < nsym; i++) {
        const r = rnd();
        if (r < 0.55) { const [c, l] = fixedLit(ri(256)); bw.putRev(c, l); produced++; }
        else if (r < 0.93) {
          const s = rnd() < 0.97 ? 257 + ri(29) : 286 + ri(2);
          const [c, l] = fixedLit(s); bw.putRev(c, l); bw.put(ri(32), LX[s - 257] || 0);
          const d = rnd() < 0.95 ? ri(Math.min(30, 2 + 2 * Math.floor(Math.log2(produced + 1)))) : 30 + ri(2);
          bw.putRev(d, 5); bw.put(ri(1 << 13), DX[d]);
          produced += 3;
        } else bw.put(ri(256), 1 + ri(8));
      }
      if (rnd() < 0.8) { const [c, l] = fixedLit(256); bw.putRev(c, l); }
    }
    for (let i = 0; i < ri(6); i++) bw.put(ri(256), 8);
    const bytes = bw.bytes();
    const wb = pick([15, 15, 15, 9, 10, 12]);
    same(`randfixed#${t}`, () => pako.inflateRaw(bytes, { windowBits: wb }), () => fast.inflateRaw(bytes, { windowBits: wb }));
    if (t % 3 === 0) cmpInflateStream(`randfixed#${t} stream`, bytes, { raw: true, windowBits: wb, chunkSize: pick([64, 100, 1000]) }, splitPieces(bytes, () => 1 + ri(7), [0, 0, 2, 3, 5, 6, false, true]));
  }
}

// ------------------------------------------------------------ inputs
const js = loadJs();
const text = utf8(js.find((f) => f.name.includes("zod-schemas")).code);
const big = utf8(js.find((f) => f.name.includes("react-dom-client.prod")).code).subarray(0, QUICK ? 150000 : 500000);
const bin = read("esbuild-wasm/esbuild.wasm").subarray(0, QUICK ? 100000 : 300000);
function mixed(n) {
  const out = new Uint8Array(n); let p = 0;
  while (p < n) {
    const k = ri(6), len = Math.min(n - p, 1 + ri(3000));
    if (k === 0) out.fill(ri(256), p, p + len);
    else if (k === 1) out.set(randomBytes(len, ri(1e9) + 1), p);
    else if (k === 2) { const s = ri(text.length - len - 1); out.set(text.subarray(Math.max(0, s), Math.max(0, s) + len), p); }
    else if (k === 3) { const s = ri(bin.length - len - 1); out.set(bin.subarray(Math.max(0, s), Math.max(0, s) + len), p); }
    else if (k === 4 && p > 0) { const d = 1 + ri(Math.min(p, 40000)); for (let i = 0; i < len; i++) out[p + i] = out[p + i - d]; }
    else { const period = 1 + ri(20); for (let i = 0; i < len; i++) out[p + i] = (i % period) * 7; }
    p += len;
  }
  return out;
}

// ------------------------------------------------------------ random deflate options (one-shot)
{
  const n = QUICK ? 150 : 600;
  for (let t = 0; t < n; t++) {
    const data = pick([() => mixed(1 + ri(200000)), () => text.subarray(0, ri(text.length)), () => big.subarray(ri(1000), ri(big.length)), () => mixed(ri(300)), () => new Uint8Array(ri(5))])();
    const o = {};
    if (rnd() < 0.8) o.level = ri(11) - 1;
    if (rnd() < 0.3) o.windowBits = 8 + ri(8);
    if (rnd() < 0.3) o.memLevel = 1 + ri(9);
    if (rnd() < 0.25) o.strategy = ri(5);
    if (rnd() < 0.2) o.chunkSize = pick([64, 100, 1000, 16384, 1 << 20]);
    const fn = pick(["deflate", "deflateRaw", "gzip"]);
    same(`${fn} ${JSON.stringify(o)} len${data.length}`, () => pako[fn](data, { ...o }), () => fast[fn](data, { ...o }));
    // and back (inflate side with the same windowBits)
    let c;
    try { c = pako[fn](data, { ...o }); } catch { continue; }
    const io = { chunkSize: pick([64, 1000, 65536, 1 << 20]) };
    if (o.windowBits && fn !== "gzip") io.windowBits = o.windowBits;
    const ifn = fn === "deflate" ? "inflate" : fn === "deflateRaw" ? "inflateRaw" : "ungzip";
    same(`${ifn} back ${JSON.stringify(io)}`, () => pako[ifn](c, { ...io }), () => fast[ifn](c, { ...io }));
  }
}

// ------------------------------------------------------------ streaming Deflate with random pushes / flushes
{
  const n = QUICK ? 60 : 250;
  for (let t = 0; t < n; t++) {
    const data = pick([() => mixed(1 + ri(120000)), () => text, () => big.subarray(0, 80000)])();
    const o = { level: ri(11) - 1, chunkSize: pick([64, 256, 1000, 16384, 65536]) };
    if (rnd() < 0.3) o.raw = true; else if (rnd() < 0.3) o.gzip = true;
    if (rnd() < 0.3) o.windowBits = 9 + ri(7);
    if (rnd() < 0.3) o.memLevel = 1 + ri(9);
    if (rnd() < 0.2) o.strategy = ri(5);
    const pieces = splitPieces(data, () => (rnd() < 0.3 ? 1 + ri(50) : 1 + ri(30000)), [0, 0, 0, 0, 1, 2, 3, 5, false]);
    pieces.push([new Uint8Array(0), rnd() < 0.8 ? true : 2]);
    if (rnd() < 0.2) pieces.push([new Uint8Array([1, 2, 3]), 0]);
    cmpDeflateStream(`Deflate stream #${t}`, o, pieces);
  }
}

// ------------------------------------------------------------ streaming Inflate: random pushes on valid + corrupted data
{
  const n = QUICK ? 80 : 300;
  for (let t = 0; t < n; t++) {
    const data = pick([() => mixed(1 + ri(100000)), () => text, () => big.subarray(0, 100000)])();
    const kind = ri(3);
    const lvl = ri(10);
    const c = (kind === 0 ? pako.deflate(data, { level: lvl }) : kind === 1 ? pako.gzip(data, { level: lvl }) : pako.deflateRaw(data, { level: lvl })).slice();
    if (rnd() < 0.4) { const k = 1 + ri(3); for (let j = 0; j < k; j++) c[ri(c.length)] ^= 1 << ri(8); }
    const input = rnd() < 0.2 ? c.subarray(0, ri(c.length)) : c;
    const o = { chunkSize: pick([64, 100, 1000, 65536]), raw: kind === 2 };
    if (rnd() < 0.25) o.to = "string";
    const pieces = splitPieces(input, () => (rnd() < 0.5 ? 1 + ri(8) : 1 + ri(6000)), [0, 0, 0, 2, 3, 4, 5, 6, false, true]);
    cmpInflateStream(`Inflate stream #${t} kind${kind}`, input, o, pieces);
    same(`inflate one-shot #${t}`, () => pako.inflate(input, o.raw ? { raw: true } : {}), () => fast.inflate(input, o.raw ? { raw: true } : {}));
  }
}

// ------------------------------------------------------------ Nodepod patterns
{
  const files = js.map((f) => utf8(f.code.slice(0, 30000 + ri(90000))));
  for (let t = 0; t < (QUICK ? 10 : 40); t++) {
    // memory-volume group: several files joined to ~128KB, deflateRaw level 1
    const parts = []; let size = 0;
    while (size < 128 * 1024) { const f = pick(files); const s = ri(f.length), l = Math.min(f.length - s, 1 + ri(20000)); parts.push(f.subarray(s, s + l)); size += l; }
    const joined = new Uint8Array(size); let o = 0; for (const p of parts) { joined.set(p, o); o += p.length; }
    same(`nodepod group deflateRaw L1 #${t}`, () => pako.deflateRaw(joined, { level: 1 }), () => fast.deflateRaw(joined, { level: 1 }));
    const packed = fast.deflateRaw(joined, { level: 1 });
    same(`nodepod group inflateRaw #${t}`, () => pako.inflateRaw(packed), () => fast.inflateRaw(packed));
  }
  // solo file: Deflate({level:1, raw:true}) pushed in 256KB pieces, result, then inflateRaw
  for (const f of [big, mixed(700000), bin]) {
    const run = (P) => { const d = new P.Deflate({ level: 1, raw: true }); for (let o = 0; o < f.length; o += 262144) { const e = Math.min(f.length, o + 262144); d.push(f.subarray(o, e), e === f.length); } return d.err ? "err" + d.err : d.result; };
    same(`nodepod solo Deflate L1 raw ${f.length}`, () => run(pako), () => run(fast));
    const r = run(fast);
    same(`nodepod solo inflateRaw ${f.length}`, () => pako.inflateRaw(r), () => fast.inflateRaw(r));
  }
  // zlib polyfill style: Deflate/Inflate engines with push(chunk,false) + push(empty,true)
  for (const opts of [{}, { level: 9 }, { gzip: true }, { raw: true, level: 3 }]) {
    const pieces = splitPieces(big.subarray(0, 200000), () => 1 + ri(70000), [false]);
    pieces.push([new Uint8Array(0), true]);
    cmpDeflateStream("polyfill Deflate", opts, pieces);
  }
}

// ------------------------------------------------------------ multi-member streams
{
  const cat = (xs) => { const o = new Uint8Array(xs.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };
  const n = QUICK ? 60 : 250;
  for (let t = 0; t < n; t++) {
    const members = [];
    const kind = ri(3); // gzip, zlib, mixed
    const k = 2 + ri(4);
    for (let i = 0; i < k; i++) {
      const d = pick([() => mixed(ri(3000)), () => mixed(ri(90000)), () => text.subarray(0, ri(text.length)), () => new Uint8Array(0)])();
      const z = kind === 0 || (kind === 2 && rnd() < 0.5) ? pako.gzip(d, { level: ri(10) }) : pako.deflate(d, { level: ri(10) });
      if (rnd() < 0.15) { const c = z.slice(); c[c.length - 1 - ri(8)] ^= 1 << ri(8); members.push(c); } else members.push(z);
      if (rnd() < 0.1) members.push(new Uint8Array([0, 0, 0]));
    }
    const input = cat(members);
    const o = { chunkSize: pick([64, 1000, 16384, 65536, 1 << 20]) };
    if (rnd() < 0.3) o.to = "string";
    same(`multi-member #${t} kind${kind} ${JSON.stringify(o)}`, () => pako.inflate(input, { ...o }), () => fast.inflate(input, { ...o }));
    if (t % 5 === 0) cmpInflateStream(`multi-member stream #${t}`, input, o, splitPieces(input, () => 1 + ri(20000), [0, 0, 2, false]));
  }
}

// ------------------------------------------------------------ error shapes
{
  const good = pako.deflate(text);
  const cases = [
    ["inflate garbage", (P) => P.inflate(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))],
    ["inflate truncated", (P) => P.inflate(good.subarray(0, good.length >> 1))],
    ["ungzip zlib", (P) => P.ungzip(good, { windowBits: 31 })],
    ["inflate bad check", (P) => { const c = good.slice(); c[c.length - 1] ^= 1; return P.inflate(c); }],
    ["inflateRaw zlib", (P) => P.inflateRaw(good)],
    // trailer ISIZE is only a capacity hint: huge / zero / garbage values
    ...[0xffffffff, 0, 0x7fffffff, 12345].map((v) => [`ungzip ISIZE=${v}`, (P) => { const c = pako.gzip(text); new DataView(c.buffer).setUint32(c.length - 4, v, true); return P.ungzip(c); }]),
    ["ungzip 18-byte member", (P) => P.ungzip(pako.gzip(new Uint8Array(0)))],
    // non-byte inputs to streams: pako feeds them to its JS zlib as they are
    ...[[104, 105, 104, 105], [300, 1000], new Uint16Array([1, 2, 300]), new Float32Array([1.5, 300]), new DataView(new ArrayBuffer(4)), { length: 0 }, { length: 2, 0: 1, 1: 2 }, null, undefined].flatMap((x, k) => [
      [`Deflate.push exotic#${k}`, (P) => { const d = new P.Deflate({ level: k % 3 * 3 }); d.push(x, true); return `${d.err}|${d.msg}|${d.ended}|${d.result && Array.from(d.result)}`; }],
      [`Deflate.push exotic#${k} after data`, (P) => { const d = new P.Deflate(); d.push(utf8("abc"), 2); try { d.push(x, true); } catch (e) { return "throw " + e.message; } return `${d.err}|${d.msg}|${d.result && Array.from(d.result)}`; }],
      [`Inflate.push exotic#${k}`, (P) => { const i = new P.Inflate(); i.push(x, true); return `${i.err}|${i.msg}|${i.ended}|${i.result && Array.from(i.result)}`; }],
    ]),
    ["Inflate.push Array", (P) => { const i = new P.Inflate(); i.push(Array.from(good), true); return i.result; }],
    ["Inflate.push Uint16Array>255", (P) => { const c = Uint16Array.from(good); c[5] += 256; const i = new P.Inflate(); i.push(c, true); return `${i.err}|${i.msg}|${i.result && i.result.length}`; }],
    ["Inflate.push Uint8ClampedArray", (P) => { const i = new P.Inflate(); i.push(new Uint8ClampedArray(good), true); return i.result; }],
    ["deflate level 11", (P) => P.deflate(text, { level: 11 })],
    ["Inflate err fields", (P) => { const i = new P.Inflate(); i.push(new Uint8Array([0x78, 0x9c, 0xff, 0xff, 0xff]), true); return `${i.err}|${i.msg}|${i.ended}|${i.result}`; }],
    ["Deflate bad opts", (P) => { try { new P.Deflate({ level: 42 }); return "no"; } catch (e) { return "throw " + e.message; } }],
    ["Inflate wb 7", (P) => { try { new P.Inflate({ windowBits: 7, raw: true }); return "no"; } catch (e) { return "throw " + e.message; } }],
  ];
  for (const [n, f] of cases) same(n, () => f(pako), () => f(fast));
}

console.log(`${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
