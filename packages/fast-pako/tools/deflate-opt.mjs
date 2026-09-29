// Raw-deflate encoder for build.mjs: optimal parsing and block splitting in
// the manner of zopfli (a few percent smaller than zlib -9), so the embedded
// wasm core is smaller. Slow (a few hundred ms for 50 KB), build time only.
// Emits only dynamic-Huffman blocks; maxBits limits the code lengths (the
// boot decoder takes 11). build.mjs checks the round trip.
//
//   import { deflateOpt } from "./tools/deflate-opt.mjs";
//   const packed = deflateOpt(bytes, { iterations: 30, maxBits: 11 });

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// symbol of each match length 3..258 and distance 1..32768
const LSYM = new Uint16Array(259);
for (let s = 0; s < 29; s++) for (let l = LBASE[s]; l < LBASE[s] + (1 << LEXT[s]) && l <= 258; l++) LSYM[l] = s;
LSYM[258] = 28;
const DSYM = new Uint8Array(32769);
for (let s = 0; s < 30; s++) for (let d = DBASE[s]; d < DBASE[s] + (1 << DEXT[s]) && d <= 32768; d++) DSYM[d] = s;

const WINDOW = 32768;
// longest Huffman code (deflate allows 15; build.mjs uses 12 for its small decoder)
let MAXBITS = 15;

/**
 * For every position: the smallest distance for each match length, as
 * breakpoints (lengths ascending, distances ascending): at position i the
 * lengths (len[k-1], len[k]] use dist[k].
 */
function findMatches(data, maxChain) {
  const n = data.length;
  const head = new Int32Array(1 << 16).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const start = new Int32Array(n + 1);
  const lens = [], dists = [];
  const hash = (i) => ((data[i] << 8) ^ (data[i + 1] << 4) ^ data[i + 2]) & 0xffff;
  for (let i = 0; i < n; i++) {
    start[i] = lens.length;
    if (i + 3 > n) continue;
    const h = hash(i);
    const max = Math.min(258, n - i);
    let best = 2;
    let j = head[h];
    let chain = maxChain;
    while (j >= 0 && i - j <= WINDOW && chain-- > 0) {
      if (data[j + best] === data[i + best]) {
        let l = 0;
        while (l < max && data[j + l] === data[i + l]) l++;
        if (l > best) {
          lens.push(l);
          dists.push(i - j);
          best = l;
          if (l === max) break;
        }
      }
      j = prev[j];
    }
    prev[i] = head[h];
    head[h] = i;
  }
  start[n] = lens.length;
  return { start, lens: Int32Array.from(lens), dists: Int32Array.from(dists) };
}

/** code lengths (<= limit) for the frequencies, package-merge */
function codeLengths(freq, limit) {
  const n = freq.length;
  const out = new Uint8Array(n);
  const leaves = [];
  for (let i = 0; i < n; i++) if (freq[i] > 0) leaves.push(i);
  if (leaves.length === 0) return out;
  if (leaves.length === 1) {
    out[leaves[0]] = 1;
    return out;
  }
  leaves.sort((a, b) => freq[a] - freq[b] || a - b);
  // items: { w, sym } leaf or { w, a, b } package
  const leafItems = leaves.map((s) => ({ w: freq[s], sym: s }));
  let list = leafItems;
  for (let level = 1; level < limit; level++) {
    const pk = [];
    for (let k = 0; k + 1 < list.length; k += 2) pk.push({ w: list[k].w + list[k + 1].w, a: list[k], b: list[k + 1] });
    // merge leaves and packages by weight (leaves first on ties)
    const merged = [];
    let x = 0, y = 0;
    while (x < leafItems.length || y < pk.length) {
      if (y >= pk.length || (x < leafItems.length && leafItems[x].w <= pk[y].w)) merged.push(leafItems[x++]);
      else merged.push(pk[y++]);
    }
    list = merged;
  }
  const take = 2 * leaves.length - 2;
  const stack = list.slice(0, take);
  while (stack.length) {
    const it = stack.pop();
    if (it.sym !== undefined) out[it.sym]++;
    else stack.push(it.a, it.b);
  }
  return out;
}

/** canonical codes (bit-reversed, ready for LSB-first output) */
function canonical(lens) {
  const count = new Uint16Array(16);
  for (const l of lens) count[l]++;
  count[0] = 0;
  const next = new Uint16Array(16);
  let code = 0;
  for (let b = 1; b < 16; b++) {
    code = (code + count[b - 1]) << 1;
    next[b] = code;
  }
  const codes = new Uint16Array(lens.length);
  for (let s = 0; s < lens.length; s++) {
    const l = lens[s];
    if (!l) continue;
    let c = next[l]++, r = 0;
    for (let k = 0; k < l; k++) {
      r = (r << 1) | (c & 1);
      c >>= 1;
    }
    codes[s] = r;
  }
  return codes;
}

/** run-length encoding of the code lengths (symbols 0..18 with extra bits) */
function rleLengths(lens) {
  const out = []; // [sym, extra]
  let i = 0;
  while (i < lens.length) {
    const v = lens[i];
    let run = 1;
    while (i + run < lens.length && lens[i + run] === v) run++;
    if (v === 0 && run >= 3) {
      let r = run;
      while (r >= 11) {
        const k = Math.min(r, 138);
        out.push([18, k - 11]);
        r -= k;
      }
      if (r >= 3) {
        out.push([17, r - 3]);
        r = 0;
      }
      while (r-- > 0) out.push([0, 0]);
    } else if (v !== 0 && run >= 4) {
      out.push([v, 0]);
      let r = run - 1;
      while (r >= 3) {
        const k = Math.min(r, 6);
        out.push([16, k - 3]);
        r -= k;
      }
      while (r-- > 0) out.push([v, 0]);
    } else {
      for (let k = 0; k < run; k++) out.push([v, 0]);
    }
    i += run;
  }
  return out;
}

/** symbol list -> block description with exact bit size */
function planBlock(syms) {
  // syms: flat array of pairs [litOrLen, dist] (dist 0 = literal byte)
  const lf = new Uint32Array(286), df = new Uint32Array(30);
  for (let k = 0; k < syms.length; k += 2) {
    const a = syms[k], d = syms[k + 1];
    if (d === 0) lf[a]++;
    else {
      lf[257 + LSYM[a]]++;
      df[DSYM[d]]++;
    }
  }
  lf[256] = 1;
  // at least two distance codes (zlib does the same)
  let nd = 0;
  for (const f of df) if (f) nd++;
  if (nd < 2) {
    if (!df[0]) df[0] = 1;
    else df[1] = 1;
  }
  const ll = codeLengths(lf, MAXBITS), dl = codeLengths(df, MAXBITS);
  let hlit = 286;
  while (hlit > 257 && !ll[hlit - 1]) hlit--;
  let hdist = 30;
  while (hdist > 1 && !dl[hdist - 1]) hdist--;
  const all = [...ll.subarray(0, hlit), ...dl.subarray(0, hdist)];
  const rle = rleLengths(all);
  const cf = new Uint32Array(19);
  for (const [s] of rle) cf[s]++;
  const cl = codeLengths(cf, 7);
  let hclen = 19;
  while (hclen > 4 && !cl[ORDER[hclen - 1]]) hclen--;
  let bits = 3 + 14 + 3 * hclen;
  for (const [s] of rle) bits += cl[s] + (s === 16 ? 2 : s === 17 ? 3 : s === 18 ? 7 : 0);
  for (let s = 0; s < 286; s++) bits += lf[s] * ll[s];
  for (let s = 0; s < 29; s++) bits += lf[257 + s] * LEXT[s];
  for (let s = 0; s < 30; s++) bits += df[s] * (dl[s] + DEXT[s]);
  return { syms, ll, dl, hlit, hdist, rle, cl, hclen, bits };
}

/** symbol frequencies of a parse */
function stats(syms) {
  const lf = new Float64Array(286), df = new Float64Array(30);
  for (let k = 0; k < syms.length; k += 2) {
    const a = syms[k], d = syms[k + 1];
    if (d === 0) lf[a]++;
    else {
      lf[257 + LSYM[a]]++;
      df[DSYM[d]]++;
    }
  }
  lf[256] = 1;
  return { lf, df };
}

/** bit costs of every literal/length and distance symbol (entropy of the frequencies) */
function costModel({ lf, df }) {
  const ent = (f) => {
    let sum = 0;
    for (const x of f) sum += x;
    const lg = Math.log2(sum || 1);
    return f.map((x) => (x > 0 ? lg - Math.log2(x) : lg + 1));
  };
  const lc = ent(lf), dc = ent(df);
  const lenCost = new Float64Array(259);
  for (let l = 3; l <= 258; l++) lenCost[l] = lc[257 + LSYM[l]] + LEXT[LSYM[l]];
  const distCost = new Float64Array(30);
  for (let s = 0; s < 30; s++) distCost[s] = dc[s] + DEXT[s];
  return { lit: lc, lenCost, distCost };
}

/** shortest path over [from, to) of the input under the model -> symbols */
function optimalParse(data, m, from, to, model) {
  const n = to - from;
  const cost = new Float64Array(n + 1).fill(Infinity);
  const len = new Uint16Array(n + 1), dist = new Uint16Array(n + 1);
  cost[0] = 0;
  const { lit, lenCost, distCost } = model;
  for (let i = 0; i < n; i++) {
    const c0 = cost[i];
    const p = from + i;
    const cl = c0 + lit[data[p]];
    if (cl < cost[i + 1]) {
      cost[i + 1] = cl;
      len[i + 1] = 1;
      dist[i + 1] = 0;
    }
    let prevLen = 2;
    const maxl = to - p;
    for (let k = m.start[p]; k < m.start[p + 1]; k++) {
      const upto = Math.min(m.lens[k], maxl);
      const d = m.dists[k];
      const dc = c0 + distCost[DSYM[d]];
      for (let l = prevLen + 1; l <= upto; l++) {
        const c = dc + lenCost[l];
        if (c < cost[i + l]) {
          cost[i + l] = c;
          len[i + l] = l;
          dist[i + l] = d;
        }
      }
      if (upto > prevLen) prevLen = upto;
    }
  }
  const rev = [];
  for (let i = n; i > 0; ) {
    const l = len[i];
    if (l === 1) rev.push(data[from + i - 1], 0);
    else rev.push(l, dist[i]);
    i -= l;
  }
  const syms = [];
  for (let k = rev.length - 2; k >= 0; k -= 2) syms.push(rev[k], rev[k + 1]);
  return syms;
}

/** greedy parse (longest match at each position) for the first statistics */
function greedyParse(data, m, from, to) {
  const syms = [];
  for (let p = from; p < to; ) {
    let l = 0, d = 0;
    for (let k = m.start[p]; k < m.start[p + 1]; k++) if (m.lens[k] > l) { l = Math.min(m.lens[k], to - p); d = m.dists[k]; }
    if (l >= 3) { syms.push(l, d); p += l; } else { syms.push(data[p], 0); p++; }
  }
  return syms;
}

// zopfli's iteration: parse with the costs of the previous parse; once it
// stalls, restart from randomly perturbed statistics of the best one, and
// from then on blend in the previous statistics (converges slower, better)
function iterate(data, m, from, to, iterations) {
  let seed = 1;
  const ran = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8;
  let st = stats(greedyParse(data, m, from, to));
  let best = null, bestSt = null, last = null, lastCost = -1, randomized = false;
  for (let it = 0; it < iterations; it++) {
    const syms = optimalParse(data, m, from, to, costModel(st));
    const plan = planBlock(syms);
    if (!best || plan.bits < best.bits) {
      best = plan;
      bestSt = st;
    }
    last = st;
    st = stats(syms);
    if (randomized) {
      for (let s = 0; s < 286; s++) st.lf[s] += 0.5 * last.lf[s];
      for (let s = 0; s < 30; s++) st.df[s] += 0.5 * last.df[s];
    }
    if (it > 5 && plan.bits === lastCost) {
      st = { lf: Float64Array.from(bestSt.lf), df: Float64Array.from(bestSt.df) };
      for (const f of [st.lf, st.df]) for (let s = 0; s < f.length; s++) if ((ran() >> 4) % 3 === 0) f[s] = f[ran() % f.length];
      st.lf[256] = 1;
      randomized = true;
    }
    lastCost = plan.bits;
  }
  return best;
}

/** byte length covered by symbols [0, k) */
function bytesOf(syms, k) {
  let b = 0;
  for (let i = 0; i < k; i += 2) b += syms[i + 1] === 0 ? 1 : syms[i];
  return b;
}

/** split points (symbol indexes) of a symbol list where separate blocks are smaller */
function splitPoints(syms, lo, hi, depth, out) {
  if (depth > 5 || hi - lo < 2 * 200) return;
  const whole = planBlock(syms.slice(lo, hi)).bits;
  let bestS = -1, bestBits = whole - 96;
  const steps = 48;
  for (let t = 1; t < steps; t++) {
    const s = lo + 2 * Math.round(((hi - lo) / 2) * (t / steps));
    const b = planBlock(syms.slice(lo, s)).bits + planBlock(syms.slice(s, hi)).bits;
    if (b < bestBits) {
      bestBits = b;
      bestS = s;
    }
  }
  if (bestS < 0) return;
  splitPoints(syms, lo, bestS, depth + 1, out);
  out.push(bestS);
  splitPoints(syms, bestS, hi, depth + 1, out);
}

class BitWriter {
  constructor() {
    this.buf = [];
    this.acc = 0;
    this.n = 0;
  }
  put(v, len) {
    for (let k = 0; k < len; k++) {
      this.acc |= ((v >>> k) & 1) << this.n;
      if (++this.n === 8) {
        this.buf.push(this.acc);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  finish() {
    if (this.n) this.buf.push(this.acc);
    return Uint8Array.from(this.buf);
  }
}

function emitBlock(w, plan, last) {
  const { syms, ll, dl, hlit, hdist, rle, cl, hclen } = plan;
  w.put(last ? 1 : 0, 1);
  w.put(2, 2);
  w.put(hlit - 257, 5);
  w.put(hdist - 1, 5);
  w.put(hclen - 4, 4);
  for (let k = 0; k < hclen; k++) w.put(cl[ORDER[k]], 3);
  const cc = canonical(cl);
  for (const [s, x] of rle) {
    w.put(cc[s], cl[s]);
    if (s === 16) w.put(x, 2);
    else if (s === 17) w.put(x, 3);
    else if (s === 18) w.put(x, 7);
  }
  const lc = canonical(ll), dc = canonical(dl);
  for (let k = 0; k < syms.length; k += 2) {
    const a = syms[k], d = syms[k + 1];
    if (d === 0) w.put(lc[a], ll[a]);
    else {
      const s = LSYM[a];
      w.put(lc[257 + s], ll[257 + s]);
      w.put(a - LBASE[s], LEXT[s]);
      const t = DSYM[d];
      w.put(dc[t], dl[t]);
      w.put(d - DBASE[t], DEXT[t]);
    }
  }
  w.put(lc[256], ll[256]);
}

export function deflateOpt(data, { iterations = 15, maxChain = 8192, maxBits = 15 } = {}) {
  MAXBITS = maxBits;
  data = Uint8Array.from(data);
  const m = findMatches(data, maxChain);
  // one parse of everything, then blocks where the statistics change
  const whole = iterate(data, m, 0, data.length, iterations);
  const cuts = [];
  splitPoints(whole.syms, 0, whole.syms.length, 0, cuts);
  const bounds = [0, ...cuts.map((c) => bytesOf(whole.syms, c)), data.length];
  const w = new BitWriter();
  for (let b = 0; b + 1 < bounds.length; b++) {
    const plan = iterate(data, m, bounds[b], bounds[b + 1], iterations);
    emitBlock(w, plan, b + 2 === bounds.length);
  }
  return w.finish();
}
