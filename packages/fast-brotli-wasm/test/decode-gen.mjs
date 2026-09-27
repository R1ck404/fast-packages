// Random brotli stream generator for the decoder tests. Writes streams that
// use every format feature — block switches (all three type codes), context
// modes, context maps with RLE and IMTF, simple and complex prefix codes
// (incl. repeat codes, HSKIP, single-symbol code-length codes), NPOSTFIX /
// NDIRECT, implicit and explicit short distance codes, distances at the
// window limit, static dictionary words with all 121 transforms (incl. empty
// results), uncompressed / metadata / empty meta-blocks, 10..24-bit windows,
// final padding and trailing bytes — and keeps a model of the expected output.
// With small probability it injects invalid or unusual constructs (then the
// expected output is unknown and only the reference decides).
// Tables are parsed from the reference decoder's own sources.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, "../rust/vendor/brotli-decompressor/src", f), "utf8");

// ------------------------------------------------------------------ tables
const prefixSrc = src("prefix.rs");
const CMD = [...prefixSrc.matchAll(/CmdLutElement\s*\{\s*insert_len_extra_bits:\s*(\w+),\s*copy_len_extra_bits:\s*(\w+),\s*distance_code:\s*(-?\w+),\s*context:\s*(\w+),\s*insert_len_offset:\s*(\w+),\s*copy_len_offset:\s*(\w+),?\s*\}/g)].map((m) => ({
  insBits: Number(m[1]), copyBits: Number(m[2]), dc: Number(m[3]), ctx: Number(m[4]), insOff: Number(m[5]), copyOff: Number(m[6]),
}));
const BLEN = [...prefixSrc.matchAll(/PrefixCodeRange\s*\{\s*offset:\s*(\d+),\s*nbits:\s*(\d+),?\s*\}/g)].map((m) => ({ off: +m[1], nbits: +m[2] }));
if (CMD.length !== 704 || BLEN.length !== 26) throw new Error("prefix.rs parse failed");

const ctxSrc = src("context.rs");
const ctxText = ctxSrc.slice(ctxSrc.indexOf("kContextLookup:[[u8;512];4] = ["), ctxSrc.lastIndexOf("];")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const CTXL = [...ctxText.slice(ctxText.indexOf("= [") + 3).matchAll(/\d+/g)].map((m) => +m[0]);
if (CTXL.length !== 2048) throw new Error("context.rs parse failed " + CTXL.length);

const dictSrc = src("dictionary/mod.rs");
const numsAfter = (name) => { const i = dictSrc.indexOf(name); return dictSrc.slice(dictSrc.indexOf("[", dictSrc.indexOf("=", i)) + 1, dictSrc.indexOf("]", dictSrc.indexOf("=", i))); };
const DOFF = numsAfter("kBrotliDictionaryOffsetsByLength").split(",").map((s) => +s.trim());
const DBITS = numsAfter("kBrotliDictionarySizeBitsByLength").split(",").map((s) => +s.trim());
const DICT = Uint8Array.from(numsAfter("kBrotliDictionary:").match(/0x[0-9a-fA-F]{2}/g).map(Number));
if (DICT.length !== 122784 || DOFF.length !== 25) throw new Error("dictionary parse failed");

const trSrc = src("transform.rs");
const K = {};
for (const m of trSrc.matchAll(/const (k\w+): u8 = (\d+);/g)) K[m[1]] = +m[2];
const psI = trSrc.indexOf("kPrefixSuffix: [u8; 208] =");
const PS = trSrc.slice(psI + 26, trSrc.indexOf("];", psI)).match(/0x[0-9a-fA-F]{2}/g).map(Number);
const TR = [...trSrc.matchAll(/Transform\s*\{\s*prefix_id:\s*(\w+),\s*transform:\s*(\w+),\s*suffix_id:\s*(\w+),?\s*\}/g)].map((m) => ({ pre: K[m[1]], t: K[m[2]], suf: K[m[3]] }));
if (TR.length !== 121 || PS.length !== 208 || TR.some((x) => x.pre === undefined || x.t === undefined || x.suf === undefined)) throw new Error("transform.rs parse failed");

function toUpper(p, i) {
  if (p[i] < 0xc0) {
    if (p[i] >= 97 && p[i] <= 122) p[i] ^= 32;
    return 1;
  }
  if (p[i] < 0xe0) { p[i + 1] ^= 32; return 2; }
  p[i + 2] ^= 5;
  return 3;
}
// TransformDictionaryWord
function transformWord(word, ti) {
  const T = TR[ti], d = new Uint8Array(96);
  let idx = 0;
  for (let i = T.pre; PS[i] !== 0; i++) d[idx++] = PS[i];
  let skip = T.t < K.kOmitFirst1 ? 0 : T.t - (K.kOmitFirst1 - 1);
  let len = word.length;
  if (skip > len) skip = len;
  const w = word.subarray(skip);
  len -= skip;
  if (T.t <= K.kOmitLast9) len -= T.t;
  for (let i = 0; i < len; i++) d[idx++] = w[i];
  let u = idx - len;
  if (T.t === K.kUppercaseFirst) toUpper(d, u);
  else if (T.t === K.kUppercaseAll) {
    let l = len;
    while (l > 0) { const s = toUpper(d, u); u += s; l -= s; }
  }
  for (let i = T.suf; PS[i] !== 0; i++) d[idx++] = PS[i];
  return d.slice(0, idx);
}
const dictWord = (len, idx) => DICT.subarray(DOFF[len] + idx * len, DOFF[len] + (idx + 1) * len);

// ------------------------------------------------------------------ bit writer
class BW {
  constructor() { this.buf = []; this.acc = 0; this.n = 0; }
  bits(n, v) {
    for (let i = 0; i < n; i++) {
      this.acc |= ((v >>> i) & 1) << this.n;
      if (++this.n === 8) { this.buf.push(this.acc); this.acc = 0; this.n = 0; }
    }
  }
  padBits() { return (8 - this.n) & 7; }
  bytes(b) { for (const x of b) this.buf.push(x); } // only when aligned
  finish() { if (this.n) { this.buf.push(this.acc); this.acc = 0; this.n = 0; } return Uint8Array.from(this.buf); }
}

const bitLen = (x) => { let r = 0; while (x) { x >>>= 1; r++; } return r; };
const rev = (c, n) => { let r = 0; for (let i = 0; i < n; i++) r |= ((c >>> i) & 1) << (n - 1 - i); return r; };

export function genStream(rnd, text) {
  const ri = (n) => Math.floor(rnd() * n);
  const pick = (a) => a[ri(a.length)];
  const chance = (p) => rnd() < p;
  const w = new BW();
  const out = [];
  let expectFast = true, valid = true;
  const desc = [];
  const inject = (what) => { desc.push("!" + what); valid = false; expectFast = false; };

  // ---------------------------------------------------------------- prefix codes
  // random complete code over `syms` (>= 2) with max length `limit`
  function randomLengths(syms, limit, lens) {
    const list = syms.slice();
    for (let i = list.length - 1; i > 0; i--) { const j = ri(i + 1); [list[i], list[j]] = [list[j], list[i]]; }
    const skew = chance(0.5);
    (function split(a, depth) {
      if (a.length === 1) { lens[a[0]] = depth; return; }
      const cap = 2 ** (limit - depth - 1);
      const lo = Math.max(1, a.length - cap), hi = Math.min(a.length - 1, cap);
      const k = skew && chance(0.6) ? (chance(0.5) ? lo : hi) : lo + ri(hi - lo + 1);
      split(a.slice(0, k), depth + 1);
      split(a.slice(k), depth + 1);
    })(list, 0);
  }
  function canonical(lens) {
    const cnt = new Array(17).fill(0);
    for (const l of lens) if (l) cnt[l]++;
    const next = new Array(17).fill(0);
    let code = 0;
    for (let b = 1; b <= 16; b++) { code = (code + cnt[b - 1]) << 1; next[b] = code; }
    next[0] = 0;
    const codes = new Array(lens.length).fill(0);
    for (let s = 0; s < lens.length; s++) if (lens[s]) codes[s] = next[lens[s]]++;
    return codes;
  }
  // builds a code for `alphabet` that covers the used symbols
  function makeCode(alphabet, used) {
    let syms = [...used];
    if (!syms.length) syms = [ri(alphabet)];
    if (chance(0.25)) {
      const extra = 1 + ri(chance(0.2) ? 40 : 3);
      for (let i = 0; i < extra; i++) { const s = ri(alphabet); if (!syms.includes(s)) syms.push(s); }
    }
    const lens = new Array(alphabet).fill(0);
    const c = { alphabet, lens, simple: null };
    if (syms.length <= 4 && (syms.length === 1 || chance(0.6))) {
      // simple code: listing order decides the lengths
      const order = syms.slice().sort(() => rnd() - 0.5);
      let ts = 0;
      if (order.length === 2) { lens[order[0]] = 1; lens[order[1]] = 1; }
      if (order.length === 3) { lens[order[0]] = 1; lens[order[1]] = 2; lens[order[2]] = 2; }
      if (order.length === 4) {
        ts = ri(2);
        const L = ts ? [1, 2, 3, 3] : [2, 2, 2, 2];
        order.forEach((s, i) => (lens[s] = L[i]));
      }
      c.simple = { order, ts };
    } else {
      if (syms.length === 1) { let s; do s = ri(alphabet); while (s === syms[0]); syms.push(s); }
      randomLengths(syms, 15, lens);
    }
    c.codes = canonical(lens);
    return c;
  }
  const sym = (c, s) => {
    if (c.lens[s] === undefined || (c.lens[s] === 0 && !(c.simple && c.simple.order.length === 1 && c.simple.order[0] === s))) throw new Error("symbol not in code");
    w.bits(c.lens[s], rev(c.codes[s], c.lens[s]));
  };
  const CLV = [[0, 2], [7, 4], [3, 3], [2, 2], [1, 2], [15, 4]]; // static code for CL lengths 0..5
  const CL_ORDER = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  function repSeq(n, extra) {
    const m = 1 << extra;
    if (n <= m + 2) return [n - 3];
    return [...repSeq(Math.floor((n - 3) / m) + 2, extra), (n - 3) % m];
  }
  function writeCode(c) {
    const maxBits = bitLen(c.alphabet - 1);
    if (c.simple) {
      const { order, ts } = c.simple;
      w.bits(2, 1);
      w.bits(2, order.length - 1);
      for (const s of order) w.bits(maxBits, s);
      if (order.length === 4) w.bits(1, ts);
      return;
    }
    // run-length code the lengths up to the last used symbol
    const L = c.lens;
    let last = L.length - 1;
    while (L[last] === 0) last--;
    const seq = [];
    let prev = 8, i = 0;
    while (i <= last) {
      const l = L[i];
      let run = 1;
      while (i + run <= last && L[i + run] === l) run++;
      if (l === 0 && run >= 3 && chance(0.85)) {
        for (const e of repSeq(run, 3)) seq.push([17, 3, e]);
        i += run;
      } else if (l !== 0 && l === prev && run >= 3 && chance(0.8)) {
        for (const e of repSeq(run, 2)) seq.push([16, 2, e]);
        i += run;
      } else {
        seq.push([l, 0, 0]);
        if (l) prev = l;
        i++;
      }
    }
    const used = [...new Set(seq.map((x) => x[0]))];
    const cl = new Array(18).fill(0);
    let clSingle = false;
    if (used.length === 1) {
      cl[used[0]] = 1 + ri(5);
      clSingle = true;
    } else randomLengths(used, 5, cl);
    const clCodes = canonical(cl);
    let hskip = 0;
    if (cl[1] === 0 && cl[2] === 0 && chance(0.7)) hskip = cl[3] === 0 && chance(0.5) ? 3 : 2;
    w.bits(2, hskip);
    let space = 32;
    for (let k = hskip; k < 18; k++) {
      const v = cl[CL_ORDER[k]];
      w.bits(CLV[v][1], CLV[v][0]);
      if (v) { space -= 32 >> v; if (space <= 0) break; }
    }
    for (const [s, eb, e] of seq) {
      if (!clSingle) w.bits(cl[s], rev(clCodes[s], cl[s]));
      if (eb) w.bits(eb, e);
    }
  }
  function writeVarU8(n) {
    if (n === 0) return w.bits(1, 0);
    w.bits(1, 1);
    const k = bitLen(n) - 1;
    w.bits(3, k);
    if (k) w.bits(k, n - (1 << k));
  }
  const blenCode = (L) => BLEN.findIndex((b) => L >= b.off && L < b.off + 2 ** b.nbits);
  function writeBlockLen(c, L) {
    const i = blenCode(L);
    sym(c, i);
    w.bits(BLEN[i].nbits, L - BLEN[i].off);
  }
  function writeContextMap(map, ntrees) {
    writeVarU8(ntrees - 1);
    if (ntrees === 1) return;
    const imtf = chance(0.4);
    let vals = map;
    if (imtf) {
      const l = [...Array(256).keys()];
      vals = map.map((v) => { const i = l.indexOf(v); l.splice(i, 1); l.unshift(v); return i; });
    }
    const rleMax = chance(0.5) ? 0 : 1 + ri(chance(0.3) ? 16 : 5);
    const toks = [];
    for (let i = 0; i < vals.length;) {
      if (vals[i] !== 0) { toks.push([vals[i] + rleMax, 0, 0]); i++; continue; }
      let run = 1;
      while (i + run < vals.length && vals[i + run] === 0) run++;
      i += run;
      while (run > 0) {
        const c = Math.min(rleMax, bitLen(run) - 1);
        if (c >= 1 && chance(0.9)) {
          const n = Math.min(run, (1 << (c + 1)) - 1);
          toks.push([c, c, n - (1 << c)]);
          run -= n;
        } else { toks.push([0, 0, 0]); run--; }
      }
    }
    if (rleMax) { w.bits(1, 1); w.bits(4, rleMax - 1); } else w.bits(1, 0);
    const code = makeCode(ntrees + rleMax, new Set(toks.map((t) => t[0])));
    writeCode(code);
    for (const [s, eb, e] of toks) { sym(code, s); if (eb) w.bits(eb, e); }
    w.bits(1, imtf ? 1 : 0);
  }
  function writeMlenNibbles(mlen, exuberant) {
    const v = mlen - 1;
    let nib = v < 1 << 16 ? 4 : v < 1 << 20 ? 5 : 6;
    if (exuberant && nib < 6) nib++;
    w.bits(2, nib - 4);
    for (let i = 0; i < nib; i++) w.bits(4, (v >>> (4 * i)) & 15);
  }
  const randText = (n) => {
    const b = new Uint8Array(n);
    const s = text.length ? ri(text.length) : 0;
    for (let i = 0; i < n; i++) b[i] = chance(0.1) || !text.length ? ri(256) : text[(s + i) % text.length];
    return b;
  };

  // ---------------------------------------------------------------- header
  const large = chance(0.03);
  let wbits;
  if (large) {
    wbits = 10 + ri(21);
    w.bits(1, 1); w.bits(3, 0); w.bits(3, 1); w.bits(1, 0); w.bits(6, wbits);
    expectFast = false;
    desc.push(`largewin${wbits}`);
  } else {
    wbits = chance(0.3) ? 16 : 10 + ri(15);
    if (wbits === 16) w.bits(1, 0);
    else if (wbits === 17) { w.bits(1, 1); w.bits(3, 0); w.bits(3, 0); }
    else if (wbits > 17) { w.bits(1, 1); w.bits(3, wbits - 17); }
    else { w.bits(1, 1); w.bits(3, 0); w.bits(3, wbits - 8); }
    desc.push(`w${wbits}`);
  }
  const mbd = 2 ** wbits - 16;
  const rb = [16, 15, 11, 4];
  let rbIdx = 0;
  const last = () => rb[(rbIdx - 1) & 3];
  let hadData = false;

  // ---------------------------------------------------------------- meta-blocks
  const nmb = 1 + ri(chance(0.2) ? 8 : 3);
  for (let mb = 0; mb < nmb; mb++) {
    const isLast = mb === nmb - 1;
    let kind;
    if (isLast) kind = pick(large ? ["empty", "meta"] : ["comp", "comp", "comp", "empty", "meta"]);
    else kind = pick(large ? ["unc", "meta", "meta0"] : ["comp", "comp", "comp", "comp", "comp", "unc", "meta", "meta0"]);
    if (kind === "empty") { w.bits(1, 1); w.bits(1, 1); desc.push("E"); break; }
    if (kind === "meta" || kind === "meta0") {
      const len = kind === "meta0" ? 0 : ri(chance(0.2) ? 70000 : 40) + 1;
      w.bits(1, isLast ? 1 : 0);
      if (isLast) w.bits(1, 0);
      w.bits(2, 3);
      const reserved = chance(0.01);
      if (reserved) inject("reserved");
      w.bits(1, reserved ? 1 : 0);
      if (len === 0) w.bits(2, 0);
      else {
        const v = len - 1, nb = v < 256 ? 1 : v < 65536 ? 2 : 3;
        w.bits(2, nb);
        for (let i = 0; i < nb; i++) w.bits(8, (v >>> (8 * i)) & 255);
      }
      w.bits(w.padBits(), 0);
      w.bytes(randText(len));
      desc.push(`M${len}`);
      continue;
    }
    if (kind === "unc") {
      const len = 1 + ri(chance(0.2) ? 70000 : 300);
      w.bits(1, 0);
      writeMlenNibbles(len, false);
      w.bits(1, 1);
      const pb = w.padBits();
      const bad = pb > 0 && chance(0.03);
      if (bad) inject("uncpad");
      w.bits(pb, bad ? 1 + ri((1 << pb) - 1) : 0);
      const b = randText(len);
      w.bytes(b);
      for (const x of b) out.push(x);
      hadData = true;
      desc.push(`U${len}`);
      continue;
    }
    // ------------------------------------------------------------ compressed
    const M = chance(0.6) ? 1 + ri(200) : chance(0.75) ? 200 + ri(3000) : 3000 + ri(wbits <= 12 ? 20000 : 40000);
    hadData = true;
    const exub = chance(0.01);
    if (exub) inject("exuberant");
    w.bits(1, isLast ? 1 : 0);
    if (isLast) w.bits(1, 0);
    writeMlenNibbles(M, exub);
    if (!isLast) w.bits(1, 0);

    const nbt = [0, 1, 2].map(() => (chance(0.55) ? 1 : chance(0.9) ? 2 + ri(5) : 2 + ri(chance(0.3) ? 255 : 40)));
    const npostfix = chance(0.5) ? 0 : ri(4);
    const ndRaw = chance(0.5) ? 0 : ri(16);
    const ndirect = ndRaw << npostfix;
    const dalpha = 16 + ndirect + (48 << npostfix);
    const modes = Array.from({ length: nbt[0] }, () => ri(4));
    const ntL = chance(0.4) ? 1 : 1 + ri(chance(0.2) ? 60 : 6);
    const ntD = chance(0.5) ? 1 : 1 + ri(chance(0.2) ? 30 : 4);
    const genMap = (n, nt) => {
      const m = new Array(n).fill(0);
      if (nt === 1) return m;
      const style = ri(4);
      for (let i = 0; i < n; i++) {
        if (style === 0) m[i] = ri(nt);
        else if (style === 1) m[i] = chance(0.7) ? 0 : ri(nt);
        else if (style === 2) m[i] = (i >> (2 + ri(3))) % nt;
        else m[i] = i % nt;
      }
      return m;
    };
    const lmap = genMap(nbt[0] * 64, ntL);
    // make some literal block types trivial (single tree)
    for (let t = 0; t < nbt[0]; t++) if (chance(0.3)) { const v = ri(ntL); for (let j = 0; j < 64; j++) lmap[t * 64 + j] = v; }
    const dmap = genMap(nbt[2] * 4, ntD);
    const randBlockLen = () => (chance(0.7) ? 1 + ri(chance(0.5) ? 8 : 60) : chance(0.9) ? 1 + ri(2000) : 16625 + ri(1 << 16));
    const cat = nbt.map((n) => { const init = n >= 2 ? randBlockLen() : 0; return { n, type: 0, rb: [1, 0], left: n >= 2 ? init : Infinity, init }; });
    const ev = [];
    const next = (c) => {
      const s = cat[c];
      if (s.n >= 2 && s.left === 0) {
        const t = ri(s.n);
        const opts = [t + 2];
        if (t === s.rb[0]) opts.push(0, 0);
        if (t === (s.rb[1] + 1) % s.n) opts.push(1, 1);
        ev.push({ k: "sw", c, sym: pick(opts), len: randBlockLen() });
        s.rb = [s.rb[1], t];
        s.type = t;
        s.left = ev[ev.length - 1].len;
      }
      s.left--;
      return s.type;
    };
    const cmdCode = (ins, copy, implicit) => {
      const cand = [];
      for (let i = 0; i < 704; i++) {
        const e = CMD[i];
        if ((e.dc === 0) !== implicit) continue;
        if (ins >= e.insOff && ins < e.insOff + 2 ** e.insBits && copy >= e.copyOff && copy < e.copyOff + 2 ** e.copyBits) cand.push(i);
      }
      return cand.length ? pick(cand) : -1;
    };
    // distance -> [code, nbits, extra] (long form or direct)
    const distLong = (d) => {
      if (d <= ndirect) return [15 + d, 0, 0];
      const t = d - ndirect - 1;
      const postfix = t & ((1 << npostfix) - 1);
      const u4 = (t >>> npostfix) + 4;
      const nb = bitLen(u4) - 2;
      const b = (u4 >>> nb) & 1;
      const extra = u4 - ((2 + b) << nb);
      const dv = ((nb - 1) << 1) | b;
      return [16 + ndirect + (dv << npostfix) + postfix, nb, extra];
    };
    const shortDist = (c) => {
      if (c === 0) return last();
      const base = rb[(rbIdx + ((0xaaafff1b >>> (2 * c)) & 3)) & 3];
      const v = (0xfa5fa500 >>> (2 * c)) & 3;
      return c & 1 ? base + v : base - v;
    };
    // outcome of distance d with copy length L at max distance maxd
    const dictFor = (d, L, maxd) => {
      if (L < 4 || L > 24) return null;
      const id = d - maxd - 1, sb = DBITS[L], ti = Math.floor(id / 2 ** sb);
      if (ti >= 121) return null;
      return transformWord(dictWord(L, id % 2 ** sb), ti);
    };

    let remaining = M;
    let overrun = false;
    while (remaining > 0) {
      const ctype = next(1);
      let insert = chance(0.3) ? 0 : chance(0.75) ? 1 + ri(8) : chance(0.8) ? 9 + ri(60) : ri(6000);
      if (insert > remaining) insert = remaining;
      if (remaining - insert === 1) insert = remaining;
      if (!overrun && insert === remaining && chance(0.02)) { insert += 1 + ri(5); overrun = true; inject("overrun"); }
      const maxd = Math.min(out.length + insert, mbd);
      const room = remaining - insert;
      // plan the copy: [kind, L, d, distance code info]
      let plan = null;
      if (insert < remaining) {
        for (let tries = 0; !plan && tries < 8; tries++) {
          const k = ri(10);
          let L = chance(0.8) ? 2 + ri(Math.min(room - 1, 40)) : 2 + ri(room - 1);
          if (k <= 1) {
            // reuse last distance: implicit (codes < 128) or explicit short code 0
            const d = last();
            let bytes = null;
            if (d > maxd) { L = 4 + ri(21); bytes = dictFor(d, L, maxd); if (!bytes || bytes.length > room) continue; }
            plan = { L, d, bytes, dist: k === 0 ? "implicit" : [0, 0, 0], push: false };
          } else if (k <= 3) {
            const c = 1 + ri(15);
            const d = shortDist(c);
            if (d <= 0) {
              if (chance(0.02)) { inject("negdist"); plan = { L, d: 1, bytes: null, dist: [c, 0, 0], push: false, bad: true }; }
              continue;
            }
            let bytes = null;
            if (d > maxd) { L = 4 + ri(21); bytes = dictFor(d, L, maxd); if (!bytes || bytes.length > room) continue; }
            plan = { L, d, bytes, dist: [c, 0, 0], push: !bytes };
          } else if (k <= 7) {
            if (maxd < 1) continue;
            const d = chance(0.1) ? maxd : chance(0.6) ? 1 + ri(Math.min(maxd, 64)) : 1 + ri(maxd);
            plan = { L, d, bytes: null, dist: distLong(d), push: true };
            // the same distance through a matching short code sometimes
            if (chance(0.3)) for (let c = 0; c < 16; c++) if (shortDist(c) === d) { plan.dist = [c, 0, 0]; plan.push = c !== 0; break; }
          } else {
            L = 4 + ri(21);
            const sb = DBITS[L];
            const badT = chance(0.01);
            const ti = badT ? 121 + ri(10) : ri(121);
            const id = ti * 2 ** sb + (chance(0.2) ? 0 : ri(2 ** sb));
            const d = maxd + 1 + id;
            if (badT) { inject("transform"); plan = { L, d, bytes: new Uint8Array(0), dist: distLong(d), push: false }; break; }
            const bytes = dictFor(d, L, maxd);
            if (bytes.length > room) continue;
            plan = { L, d, bytes, dist: distLong(d), push: false };
          }
        }
        if (!plan && maxd >= 1) plan = { L: 2 + ri(Math.min(room - 1, 20)), d: 1 + ri(maxd), bytes: null, push: true, dist: null };
        if (!plan) {
          // no history yet: a dictionary word that fits (maybe an empty one)
          const L = 4 + ri(21), widx = ri(2 ** DBITS[L]);
          const tis = [...Array(121).keys()].filter((t) => transformWord(dictWord(L, widx), t).length <= room);
          if (tis.length) {
            const d = maxd + 1 + pick(tis) * 2 ** DBITS[L] + widx;
            plan = { L, d, bytes: dictFor(d, L, maxd), push: false, dist: null };
          }
        }
        if (plan && !plan.dist) plan.dist = distLong(plan.d);
        if (!plan) insert = remaining; // only literals left
      }
      const lastCmd = insert >= remaining;
      // command symbol
      const copyEnc = lastCmd ? 2 + ri(30) : plan.L;
      let code = cmdCode(insert, copyEnc, plan ? plan.dist === "implicit" : chance(0.5));
      if (code < 0 && plan && plan.dist === "implicit") { plan.dist = [0, 0, 0]; code = cmdCode(insert, copyEnc, false); }
      if (code < 0) code = cmdCode(insert, copyEnc, false);
      const e = CMD[code];
      ev.push({ k: "cmd", tree: ctype, sym: code, ins: [e.insBits, insert - e.insOff], cp: [e.copyBits, copyEnc - e.copyOff] });
      // literals
      for (let i = 0; i < insert; i++) {
        const lt = next(0);
        const p1 = out.length ? out[out.length - 1] : 0, p2 = out.length > 1 ? out[out.length - 2] : 0;
        const ctx = CTXL[modes[lt] * 512 + p1] | CTXL[modes[lt] * 512 + 256 + p2];
        const b = chance(0.15) ? ri(256) : text.length ? text[(out.length * 7 + i) % text.length] : ri(256);
        ev.push({ k: "lit", tree: lmap[lt * 64 + ctx], sym: b });
        out.push(b);
      }
      remaining -= insert;
      if (lastCmd) break;
      // distance
      if (plan.dist !== "implicit") {
        const dt = next(2);
        ev.push({ k: "dist", tree: dmap[dt * 4 + e.ctx], sym: plan.dist[0], ext: [plan.dist[1], plan.dist[2]] });
      }
      if (plan.bad) break;
      if (plan.push) { rb[rbIdx & 3] = plan.d; rbIdx++; }
      if (plan.bytes) { for (const x of plan.bytes) out.push(x); remaining -= plan.bytes.length; }
      else { for (let i = 0; i < plan.L; i++) out.push(out[out.length - plan.d]); remaining -= plan.L; }
      if (!valid) break;
    }

    // ------------------------------------------------ encode the meta-block
    const used = (f) => { const s = new Set(); for (const x of ev) if (f(x)) s.add(x.sym); return s; };
    const typeC = [], lenC = [];
    for (let c = 0; c < 3; c++) {
      writeVarU8(nbt[c] - 1);
      if (nbt[c] >= 2) {
        typeC[c] = makeCode(nbt[c] + 2, used((x) => x.k === "sw" && x.c === c));
        const ls = new Set([blenCode(cat[c].init)]);
        for (const x of ev) if (x.k === "sw" && x.c === c) ls.add(blenCode(x.len));
        lenC[c] = makeCode(26, ls);
        writeCode(typeC[c]);
        writeCode(lenC[c]);
        writeBlockLen(lenC[c], cat[c].init);
      }
    }
    w.bits(2, npostfix);
    w.bits(4, ndRaw);
    for (const m of modes) w.bits(2, m);
    writeContextMap(lmap, ntL);
    writeContextMap(dmap, ntD);
    const litC = [], cmdC = [], distC = [];
    for (let t = 0; t < ntL; t++) { litC[t] = makeCode(256, used((x) => x.k === "lit" && x.tree === t)); writeCode(litC[t]); }
    for (let t = 0; t < nbt[1]; t++) { cmdC[t] = makeCode(704, used((x) => x.k === "cmd" && x.tree === t)); writeCode(cmdC[t]); }
    for (let t = 0; t < ntD; t++) { distC[t] = makeCode(dalpha, used((x) => x.k === "dist" && x.tree === t)); writeCode(distC[t]); }
    for (const x of ev) {
      if (x.k === "sw") { sym(typeC[x.c], x.sym); writeBlockLen(lenC[x.c], x.len); }
      else if (x.k === "cmd") { sym(cmdC[x.tree], x.sym); w.bits(x.ins[0], x.ins[1]); w.bits(x.cp[0], x.cp[1]); }
      else if (x.k === "lit") sym(litC[x.tree], x.sym);
      else { sym(distC[x.tree], x.sym); w.bits(x.ext[0], x.ext[1]); }
    }
    desc.push(`C${M}[${nbt.join(",")}|np${npostfix}nd${ndirect}|t${ntL},${ntD}]`);
    if (!valid) break;
    if (isLast) break;
  }
  // final padding / trailing bytes
  const pb = w.padBits();
  if (pb && chance(0.1)) {
    w.bits(pb, 1 + ri((1 << pb) - 1));
    desc.push("pad");
    if (!hadData) inject("finalpad");
  }
  let bytes = w.finish();
  if (chance(0.2)) {
    const t = new Uint8Array(1 + ri(20));
    for (let i = 0; i < t.length; i++) t[i] = ri(256);
    const o = new Uint8Array(bytes.length + t.length);
    o.set(bytes); o.set(t, bytes.length);
    bytes = o;
    desc.push("trail");
  }
  return { bytes, raw: valid ? Uint8Array.from(out) : undefined, expectFast, desc: desc.join(" ") };
}
