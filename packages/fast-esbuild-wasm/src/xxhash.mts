// Port of internal/xxhash (a copy of github.com/cespare/xxhash/v2): XXH64
// with seed 0, streaming (Digest) and one-shot (sum64).
//
// JS-only: uint64 values are kept as two uint32 halves (hi, lo). Results of
// the 64-bit helpers are returned in the module-level registers RH/RL to avoid
// allocations; callers copy them right away.

let RH = 0;
let RL = 0;

// prime1..prime5 as (hi, lo)
const P1H = 0x9e3779b1,
  P1L = 0x85ebca87;
const P2H = 0xc2b2ae3d,
  P2L = 0x27d4eb4f;
const P3H = 0x165667b1,
  P3L = 0x9e3779f9;
const P4H = 0x85ebca77,
  P4L = 0xc2b2ae63;
const P5H = 0x27d4eb2f,
  P5L = 0x165667c5;

// (ah, al) * (bh, bl) mod 2^64
function mul(ah: number, al: number, bh: number, bl: number) {
  const a0 = al & 0xffff,
    a1 = al >>> 16,
    b0 = bl & 0xffff,
    b1 = bl >>> 16;
  const p00 = a0 * b0,
    p01 = a0 * b1,
    p10 = a1 * b0,
    p11 = a1 * b1;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  RL = ((mid << 16) | (p00 & 0xffff)) >>> 0;
  const hi = p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16);
  RH = (hi + Math.imul(al, bh) + Math.imul(ah, bl)) >>> 0;
}

// (ah, al) + (bh, bl) mod 2^64
function add(ah: number, al: number, bh: number, bl: number) {
  const s = al + bl;
  RL = s >>> 0;
  RH = (ah + bh + (s > 0xffffffff ? 1 : 0)) >>> 0;
}

// rotate left by r (0 < r < 64)
function rol(h: number, l: number, r: number) {
  if (r >= 32) {
    const t = h;
    h = l;
    l = t;
    r -= 32;
  }
  if (r === 0) {
    RH = h >>> 0;
    RL = l >>> 0;
    return;
  }
  RH = ((h << r) | (l >>> (32 - r))) >>> 0;
  RL = ((l << r) | (h >>> (32 - r))) >>> 0;
}

// round(acc, input): acc += input * prime2; acc = rol31(acc); acc *= prime1
function round(acch: number, accl: number, ih: number, il: number) {
  mul(ih, il, P2H, P2L);
  add(acch, accl, RH, RL);
  rol(RH, RL, 31);
  mul(RH, RL, P1H, P1L);
}

// mergeRound(acc, val): val = round(0, val); acc ^= val; acc = acc*prime1 + prime4
function mergeRound(acch: number, accl: number, vh: number, vl: number) {
  round(0, 0, vh, vl);
  const xh = (acch ^ RH) >>> 0,
    xl = (accl ^ RL) >>> 0;
  mul(xh, xl, P1H, P1L);
  add(RH, RL, P4H, P4L);
}

function u32(b: Uint8Array, i: number) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

// The final steps of Sum64 given h (after the "total" was added) and the
// remaining bytes b[i:end]
function finish(hh: number, hl: number, b: Uint8Array, i: number, end: number) {
  for (; i + 8 <= end; i += 8) {
    round(0, 0, u32(b, i + 4), u32(b, i));
    hh = (hh ^ RH) >>> 0;
    hl = (hl ^ RL) >>> 0;
    rol(hh, hl, 27);
    mul(RH, RL, P1H, P1L);
    add(RH, RL, P4H, P4L);
    hh = RH;
    hl = RL;
  }
  if (i + 4 <= end) {
    mul(0, u32(b, i), P1H, P1L);
    hh = (hh ^ RH) >>> 0;
    hl = (hl ^ RL) >>> 0;
    rol(hh, hl, 23);
    mul(RH, RL, P2H, P2L);
    add(RH, RL, P3H, P3L);
    hh = RH;
    hl = RL;
    i += 4;
  }
  for (; i < end; i++) {
    mul(0, b[i], P5H, P5L);
    hh = (hh ^ RH) >>> 0;
    hl = (hl ^ RL) >>> 0;
    rol(hh, hl, 11);
    mul(RH, RL, P1H, P1L);
    hh = RH;
    hl = RL;
  }

  // h ^= h >> 33
  hl = (hl ^ (hh >>> 1)) >>> 0;
  // h *= prime2
  mul(hh, hl, P2H, P2L);
  hh = RH;
  hl = RL;
  // h ^= h >> 29
  hl = (hl ^ ((hl >>> 29) | (hh << 3))) >>> 0;
  hh = (hh ^ (hh >>> 29)) >>> 0;
  // h *= prime3
  mul(hh, hl, P3H, P3L);
  hh = RH;
  hl = RL;
  // h ^= h >> 32
  hl = (hl ^ hh) >>> 0;
  RH = hh;
  RL = hl;
}

export class Digest {
  declare v1h: number;
  declare v1l: number;
  declare v2h: number;
  declare v2l: number;
  declare v3h: number;
  declare v3l: number;
  declare v4h: number;
  declare v4l: number;
  declare total: number;
  declare mem: Uint8Array;
  declare n: number;
  constructor() {
    this.v1h = 0;
    this.v1l = 0;
    this.v2h = 0;
    this.v2l = 0;
    this.v3h = 0;
    this.v3l = 0;
    this.v4h = 0;
    this.v4l = 0;
    this.total = 0;
    this.mem = new Uint8Array(32);
    this.n = 0;
    this.reset();
  }

  reset() {
    // v1 = prime1 + prime2
    add(P1H, P1L, P2H, P2L);
    this.v1h = RH;
    this.v1l = RL;
    this.v2h = P2H;
    this.v2l = P2L;
    this.v3h = 0;
    this.v3l = 0;
    // v4 = -prime1
    add(~P1H >>> 0, ~P1L >>> 0, 0, 1);
    this.v4h = RH;
    this.v4l = RL;
    this.total = 0;
    this.n = 0;
  }

  write(b: Uint8Array) {
    const d = this;
    let n = b.length;
    d.total += n;

    if (d.n + n < 32) {
      d.mem.set(b, d.n);
      d.n += n;
      return;
    }

    let off = 0;
    if (d.n > 0) {
      off = 32 - d.n;
      d.mem.set(b.subarray(0, off), d.n);
      const m = d.mem;
      round(d.v1h, d.v1l, u32(m, 4), u32(m, 0));
      d.v1h = RH;
      d.v1l = RL;
      round(d.v2h, d.v2l, u32(m, 12), u32(m, 8));
      d.v2h = RH;
      d.v2l = RL;
      round(d.v3h, d.v3l, u32(m, 20), u32(m, 16));
      d.v3h = RH;
      d.v3l = RL;
      round(d.v4h, d.v4l, u32(m, 28), u32(m, 24));
      d.v4h = RH;
      d.v4l = RL;
      d.n = 0;
    }

    n = b.length;
    if (n - off >= 32) {
      let v1h = d.v1h,
        v1l = d.v1l,
        v2h = d.v2h,
        v2l = d.v2l,
        v3h = d.v3h,
        v3l = d.v3l,
        v4h = d.v4h,
        v4l = d.v4l;
      for (; n - off >= 32; off += 32) {
        round(v1h, v1l, u32(b, off + 4), u32(b, off));
        v1h = RH;
        v1l = RL;
        round(v2h, v2l, u32(b, off + 12), u32(b, off + 8));
        v2h = RH;
        v2l = RL;
        round(v3h, v3l, u32(b, off + 20), u32(b, off + 16));
        v3h = RH;
        v3l = RL;
        round(v4h, v4l, u32(b, off + 28), u32(b, off + 24));
        v4h = RH;
        v4l = RL;
      }
      d.v1h = v1h;
      d.v1l = v1l;
      d.v2h = v2h;
      d.v2l = v2l;
      d.v3h = v3h;
      d.v3l = v3l;
      d.v4h = v4h;
      d.v4l = v4l;
    }

    d.mem.set(b.subarray(off), 0);
    d.n = n - off;
  }

  // Sum64 as [hi, lo] uint32 halves
  sum64(): [number, number] {
    const d = this;
    let hh: number, hl: number;
    if (d.total >= 32) {
      rol(d.v1h, d.v1l, 1);
      let sh = RH,
        sl = RL;
      rol(d.v2h, d.v2l, 7);
      add(sh, sl, RH, RL);
      sh = RH;
      sl = RL;
      rol(d.v3h, d.v3l, 12);
      add(sh, sl, RH, RL);
      sh = RH;
      sl = RL;
      rol(d.v4h, d.v4l, 18);
      add(sh, sl, RH, RL);
      mergeRound(RH, RL, d.v1h, d.v1l);
      mergeRound(RH, RL, d.v2h, d.v2l);
      mergeRound(RH, RL, d.v3h, d.v3l);
      mergeRound(RH, RL, d.v4h, d.v4l);
      hh = RH;
      hl = RL;
    } else {
      add(d.v3h, d.v3l, P5H, P5L);
      hh = RH;
      hl = RL;
    }

    // h += total
    add(hh, hl, Math.floor(d.total / 4294967296) >>> 0, d.total >>> 0);
    finish(RH, RL, d.mem, 0, d.n);
    return [RH, RL];
  }

  // Sum(nil): the big-endian bytes of Sum64
  sum(): Uint8Array {
    const [h, l] = this.sum64();
    return new Uint8Array([h >>> 24, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff, l >>> 24, (l >>> 16) & 0xff, (l >>> 8) & 0xff, l & 0xff]);
  }
}

export function newDigest(): Digest {
  return new Digest();
}

// xxhash.Sum64 (one-shot) as [hi, lo]
export function sum64(b: Uint8Array): [number, number] {
  if (b.length >= WASM_MIN_LENGTH) {
    const w = kernel();
    if (w !== null) return w.sum64([b], b.length);
  }
  return sum64JS(b);
}

function sum64JS(b: Uint8Array): [number, number] {
  const n = b.length;
  let hh: number, hl: number;
  let off = 0;

  if (n >= 32) {
    add(P1H, P1L, P2H, P2L);
    let v1h = RH,
      v1l = RL,
      v2h = P2H,
      v2l = P2L,
      v3h = 0,
      v3l = 0;
    add(~P1H >>> 0, ~P1L >>> 0, 0, 1);
    let v4h = RH,
      v4l = RL;
    for (; n - off >= 32; off += 32) {
      round(v1h, v1l, u32(b, off + 4), u32(b, off));
      v1h = RH;
      v1l = RL;
      round(v2h, v2l, u32(b, off + 12), u32(b, off + 8));
      v2h = RH;
      v2l = RL;
      round(v3h, v3l, u32(b, off + 20), u32(b, off + 16));
      v3h = RH;
      v3l = RL;
      round(v4h, v4l, u32(b, off + 28), u32(b, off + 24));
      v4h = RH;
      v4l = RL;
    }
    rol(v1h, v1l, 1);
    let sh = RH,
      sl = RL;
    rol(v2h, v2l, 7);
    add(sh, sl, RH, RL);
    sh = RH;
    sl = RL;
    rol(v3h, v3l, 12);
    add(sh, sl, RH, RL);
    sh = RH;
    sl = RL;
    rol(v4h, v4l, 18);
    add(sh, sl, RH, RL);
    mergeRound(RH, RL, v1h, v1l);
    mergeRound(RH, RL, v2h, v2l);
    mergeRound(RH, RL, v3h, v3l);
    mergeRound(RH, RL, v4h, v4l);
    hh = RH;
    hl = RL;
  } else {
    hh = P5H;
    hl = P5L;
  }

  add(hh, hl, Math.floor(n / 4294967296) >>> 0, n >>> 0);
  finish(RH, RL, b, off, n);
  return [RH, RL];
}

// ---------------------------------------------------------------------------
// JS-only: a WebAssembly kernel for XXH64 (native 64-bit arithmetic is ~50x
// faster than the uint32 pairs above). Generated by tools/gen_xxhash_wasm.mjs:
// one-shot XXH64 of memory[8, 8 + n), the result stored at memory[0, 8).
// Streaming a Digest gives the same hash as one-shot hashing of all of its
// input, so a Digest just collects its input for the kernel. Without
// WebAssembly (or for small inputs) the JS implementation above runs.
const XXH64_WASM = "AGFzbQEAAAABCwJgAn5+AX5gAX8AAwQDAAABBQMBAAEHEgIGbWVtb3J5AgAFeHhoNjQAAgruAwMhACAAIAFCz9bTvtLHq9lCfnxCH4lCh5Wvr5i23puef34LIwBCACABEAAgAIVCh5Wvr5i23puef35CnaO16oOxjYr6AH0LpQMCAn8EfkEIIQEgAEEIaiECIACtIABBIE8EfiACQSBrIQBC1uuC7ur9ifXgACEDQs/W077Sx6vZQiEEQvnq0NDnyaHk4QAhBgNAIAMgASkDABAAIQMgBCABKQMIEAAhBCAFIAEpAxAQACEFIAYgASkDGBAAIQYgACABQSBqIgFPDQALIANCAYkgBEIHiXwgBUIMiSAGQhKJfHwgAxABIAQQASAFEAEgBhABBULFz9my8eW66icLfCEDA0AgAUEIaiIAIAJLRQRAQgAgASkDABAAIAOFQhuJQoeVr6+Ytt6bnn9+Qp2jteqDsY2K+gB9IQMgACEBDAELCyABQQRqIgAgAk0EQCADIAE1AgBCh5Wvr5i23puef36FQheJQs/W077Sx6vZQn5C+fPd8Zn2masWfCEDIAAhAQsDQCABIAJPRQRAIAMgATEAAELFz9my8eW66id+hUILiUKHla+vmLbem55/fiEDIAFBAWohAQwBCwtBACADIANCIYiFQs/W077Sx6vZQn4iA0IdiCADhUL5893xmfaZqxZ+IgNCIIggA4U3AwAL";
const WASM_MIN_LENGTH = 256;

class xxhKernel {
  declare memory: WebAssembly.Memory;
  declare xxh64: (n: number) => void;
  constructor(memory: WebAssembly.Memory, xxh64: (n: number) => void) {
    this.memory = memory;
    this.xxh64 = xxh64;
  }
  sum64(chunks: Uint8Array[], total: number): [number, number] {
    const need = 8 + total;
    const have = this.memory.buffer.byteLength;
    if (have < need) this.memory.grow(Math.ceil((need - have) / 65536));
    const buffer = this.memory.buffer;
    const bytes = new Uint8Array(buffer, 8, total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.xxh64(total);
    const result = new Uint32Array(buffer, 0, 2);
    return [result[1], result[0]];
  }
}

let kernelInstance: xxhKernel | null | undefined = undefined;
function kernel(): xxhKernel | null {
  if (kernelInstance !== undefined) return kernelInstance;
  try {
    const text = atob(XXH64_WASM);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
    const exports = instance.exports as any;
    kernelInstance = new xxhKernel(exports.memory, exports.xxh64);
  } catch {
    kernelInstance = null;
  }
  return kernelInstance;
}

// A Digest backed by the kernel (see Digest for the JS one)
export class BufferedDigest {
  declare chunks: Uint8Array[];
  declare total: number;
  constructor() {
    this.chunks = [];
    this.total = 0;
  }
  write(b: Uint8Array) {
    this.chunks.push(b);
    this.total += b.length;
  }
  sum64(): [number, number] {
    const w = this.total >= WASM_MIN_LENGTH ? kernel() : null;
    if (w !== null) return w.sum64(this.chunks, this.total);
    const d = new Digest();
    for (const chunk of this.chunks) d.write(chunk);
    return d.sum64();
  }
  sum(): Uint8Array {
    const [h, l] = this.sum64();
    return new Uint8Array([h >>> 24, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff, l >>> 24, (l >>> 16) & 0xff, (l >>> 8) & 0xff, l & 0xff]);
  }
}

export function newDigestForLinker(): BufferedDigest {
  return new BufferedDigest();
}
