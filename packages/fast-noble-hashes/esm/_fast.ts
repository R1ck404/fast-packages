/**
 * @r1ck404/fast-noble-hashes: the wasm kernels and their glue.
 *
 * SHA-256/224, SHA-512/384/512_224/512_256, SHA-1 and MD5 keep noble's
 * classes and instance fields, but their compression functions are wasm:
 * `process()` hands one block to it, `HashMD.update` / `digestInto` (see
 * _md.js) hand it whole messages, moving the state words between the
 * instance fields and wasm memory around each call and leaving every field
 * (buffer included) exactly as noble's code would. The one-shot hashers
 * (`sha256(msg)`), PBKDF2's iteration loop and scrypt's ROMix run entirely
 * in wasm. WebAssembly is required: without it these throw on first use.
 *
 * Each hash family is a wasm module of its own, shipped as a template
 * (WASM_<FAMILY>, a few hundred bytes; wasm/kernels.mjs) that expand()
 * turns into fully unrolled code when the family is first used. A family
 * is defined in the module of its hashers (sha2.js, legacy.js, scrypt.js),
 * so a bundle carries only the families its imports reach.
 * @module
 */
import { abytes, nextTick, utf8ToBytes } from './utils.js';
import type { CHash, Hash } from './utils.js';

/** exports of a hash family's module (wasm/kernels.mjs) */
interface HashExports {
  m: WebAssembly.Memory;
  /** noble's update of the buffer image (pos bytes) with n bytes at IO; the new pos */
  u(pos: number, n: number): number;
  /** noble's padding and last block(s) of a len-byte message (pos bytes buffered); digest at O */
  d(pos: number, len: number): void;
  /** `it` PBKDF2-HMAC iterations */
  p(ol: number, it: number): void;
  /** zeroes the scratch memory */
  z(): void;
}
/** exports of the scrypt module (wasm/scrypt.wat) */
interface ScryptExports {
  m: WebAssembly.Memory;
  s(pi: number, s: number, e: number): void;
  w(): void;
}
/** One of noble's HashMD instances (fields are protected in noble's types). */
type MD = Hash<any> & Record<PropertyKey, any>;
/** noble's HMAC (fields are private in its types) */
type Prf = Record<PropertyKey, any>;
type Progress = ((progress: number) => void) | undefined;
/** A wasm module (a hash family or scrypt), compiled on first use. */
export interface Family {
  /** the template (hash families) or the module (scrypt), as text (see bytes()) */
  t: string;
  /** block length (hash families) */
  b?: number;
  /** constants of the family for the common template */
  c?: number[];
  /** number of state words (the rotating locals of the rounds) */
  r?: number;
  /** round constants, written to KB as 64-bit words */
  k?: () => bigint[];
  /** the family's own placeholders */
  x?: (v: number, j: number) => number;
  /** exports of the instance, once it exists */
  e?: HashExports;
  m?: Uint8Array;
  i?: Int32Array;
  /** DataView of the memory (process), the buffer image, io */
  d?: DataView;
  v?: Uint8Array;
  o?: Uint8Array;
  /** the bytes of the last message() (null: at IO) */
  q?: Uint8Array | null;
  /** the compiled scrypt module */
  s?: WebAssembly.Module;
  /** get() of the family's classes (as their hasher registers it) */
  g?: () => number[];
}

// the kernel of each class with one (a template instance, see fastHasher)
const KERNELS = new Map<Function, MD>();

// memory (wasm/kernels.mjs): digest, PBKDF2 sum, buffer image, input and
// its size, round constants
const O = 128, T = 192, B = 384, IO = 640, CAP = 64256, KB = 64896;

let enc: TextEncoder | undefined;
// every family created so far (tests)
const FAMILIES: Family[] = [];

/**
 * The wasm is embedded as text that bundlers and minifiers leave as it is
 * and that gzip and brotli compress almost like the bytes: printable ASCII
 * without `"` and backslash (93 characters, digits 0..92). Digit k >= 2 is
 * the byte k - 8 (mod 256: 250..255, 0..84), digits k < 2 and d the byte
 * 93k + d + 85 (85..249); see build.mjs.
 */
export function bytes(s: string): Uint8Array<ArrayBuffer> {
  // (only ever decoded to be compiled: the error of a missing WebAssembly)
  if (typeof WebAssembly != 'object') throw new Error('fast-noble-hashes needs WebAssembly');
  const o: number[] = [];
  const ix = (i: number) => {
    const c = s.charCodeAt(i);
    return c - (c > 92 ? 34 : c > 34 ? 33 : 32);
  };
  for (let i = 0, k; i < s.length; ) o.push(((k = ix(i++)) < 2 ? k * 93 + ix(i++) + 85 : k - 8) & 255);
  return new Uint8Array(o);
}

/**
 * A family's module from the common template and the family's (see
 * wasm/asm.mjs for the commands).
 */
export function expand(f: Family): Uint8Array<ArrayBuffer> {
  const o = new Uint8Array(1 << 15);
  const T = bytes(COMMON);
  const F = bytes(f.t);
  const r = f.r;
  let n = 0;
  // signed LEB128 (also valid for the unsigned values, all below 2^31)
  const leb = (v: number) => {
    for (;;) {
      const b = v & 127;
      v >>= 7;
      if (v == (b & 64 ? -1 : 0)) return (o[n++] = b);
      o[n++] = b | 128;
    }
  };
  const ex = (t: Uint8Array, a: number, z: number, j: number): void => {
    while (a < z) {
      let v = t[a++];
      if (v < 255 || (v = t[a++]) == 255) o[n++] = v;
      else if (v < 16) o[n++] = 3 + ((v - (j % r) + r) % r);
      else if (v < 32) o[n++] = 3 + r + ((v - 16 + j) & 15);
      else if (v == 33) leb(t[a + 1] + t[a + 2] * 256 + t[a] * j), (a += 3);
      else if (v == 35) leb(f.c[t[a++]]);
      else if (v == 42) ex(F, 0, F.length, 0);
      else if (v < 48) {
        // 40 repeat (k times), 43 when (s <= j < k)
        const k = t[a++];
        const s = v > 40 ? t[a++] : 0;
        const L = t[a++] | (t[a++] << 8);
        if (v < 43) for (let i = 0; i < k; i++) ex(t, a, a + L, i);
        else if (j >= s && j < k) ex(t, a, a + L, j);
        a += L;
      } else leb(f.x(v, j));
    }
  };
  ex(T, 0, T.length, 0);
  return o.subarray(0, n);
}

/**
 * A wasm module for the hashers of a family (block length bl, padOffset
 * po, r state words, round constants k, own placeholders x), or for scrypt
 * (text only).
 * Nothing is decoded or compiled until its first use.
 */
export function wasmFamily(t: string, bl?: number, po?: number, r?: number, k?: () => bigint[], x?: (v: number, j: number) => number): Family {
  // (see famConsts in wasm/kernels.mjs)
  const f: Family = { t, b: bl, c: [bl, po + 1, B + bl - 8, 512 + bl - 8], r, k, x };
  FAMILIES.push(f);
  return f;
}

/** The instance of a hash family (created on its first use). */
function inst(f: Family): Family {
  if (!f.e) {
    // (the bytes first: the error of a missing WebAssembly)
    const b = expand(f);
    const e = new WebAssembly.Instance(new WebAssembly.Module(b)).exports as unknown as HashExports;
    const m = new Uint8Array(e.m.buffer);
    f.m = m;
    f.i = new Int32Array(e.m.buffer);
    f.v = m.subarray(B, B + f.b);
    // (io: message() never writes past CAP bytes)
    f.o = m.subarray(IO);
    // the round constants: 64-bit words (taken mod 2^64)
    if (f.k) new BigUint64Array(e.m.buffer, KB).set(f.k());
    f.e = e;
  }
  return f;
}

/**
 * SHA-2 round constants: floor(cbrt(p) * 2^64) for the first n primes p,
 * whose low 64 bits are the first 64 bits of the fractional parts of their
 * cube roots (SHA-512); SHA-256's are the high halves of the first 64.
 */
export const K = (n: number) => (): bigint[] => {
  const k: bigint[] = [];
  for (let p = 2; k.length < n; p++) {
    let d = 2;
    while (d * d <= p && p % d) d++;
    if (d * d > p) {
      // Newton from just above the root: floor(cbrt(p * 2^192))
      const N = BigInt(p) << 192n;
      let x = BigInt(Math.floor(Math.cbrt(p) * 2 ** 40) + 2) << 24n;
      for (let y; (y = (2n * x + N / (x * x)) / 3n) < x; ) x = y;
      k.push(x);
    }
  }
  return k;
};

/** MD5's placeholders: 49 the rotation of step j, 50 the byte offset of its message word. */
export const MD5_X = (v: number, j: number): number =>
  v < 50
    ? [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21][(j >> 4) * 4 + (j & 3)]
    : 4 * ([j, 5 * j + 1, 3 * j + 5, 7 * j][j >> 4] & 15);

// ---------------------------------------------------------------- state
// The state words: 32-bit words, or (high, low) pairs for SHA-512 (the
// order of the classes' get() / set()).

function put(h: MD, f: Family): void {
  const i = f.i;
  // (SHA-256, SHA-1, MD5: their fields A.., read directly; this site sees
  // few classes and stays fast. A missing field is 0: the wasm ignores it.)
  if (f.b > 64) i.set(h.get());
  else (i[0] = h.A), (i[1] = h.B), (i[2] = h.C), (i[3] = h.D), (i[4] = h.E), (i[5] = h.F), (i[6] = h.G), (i[7] = h.H);
}
function take(h: MD, i: Int32Array): void {
  h.set(i[0], i[1], i[2], i[3], i[4], i[5], i[6], i[7], i[8], i[9], i[10], i[11], i[12], i[13], i[14], i[15]);
}

/**
 * The kernel of h's class (a template instance of it, with its family as
 * `f`), if h is an instance of exactly that class (subclasses may override
 * process()) whose block/output/padding parameters were not changed.
 */
function kernel(h: MD): MD | undefined {
  // (no cache of the last one found: it made hmac 1.5x slower in Chromium)
  const k = KERNELS.get(h.constructor);
  return k && h.blockLen === k.blockLen && h.outputLen === k.outputLen && h.padOffset === k.padOffset && h.isLE === k.isLE
    ? k
    : undefined;
}

/**
 * The byte length of a message; a string that fits is UTF-8 encoded
 * straight into IO (f.q = null), otherwise f.q holds its bytes (noble's
 * utf8ToBytes for strings).
 */
function message(f: Family, data: string | Uint8Array): number {
  if (typeof data == 'string') {
    if (data.length * 3 <= CAP) {
      f.q = null;
      return (enc ||= new TextEncoder()).encodeInto(data, f.o).written;
    }
    data = utf8ToBytes(data);
  }
  f.q = data;
  return data.length;
}

/**
 * The n message bytes (f.q, or already at IO) into the state after pos
 * buffered ones, in chunks of io; returns the new pos. (The first chunk
 * completes the buffered block: the buffer image stays noble's, see u() in
 * wasm/kernels.mjs.)
 */
function feed(f: Family, pos: number, n: number): number {
  const data = f.q;
  if (!data) return f.e.u(pos, n);
  for (let i = 0, c; i < n; i += c) {
    c = Math.min(CAP - pos, n - i);
    f.m.set(c < n ? data.subarray(i, i + c) : data, IO);
    pos = f.e.u(pos, c);
  }
  return pos;
}

/**
 * HashMD.update (after aexists(); x: the data) or, with `digest`,
 * HashMD.digestInto (after its checks and `finished = true`; x: out).
 * False: noble's code runs.
 */
export function fastMD(h: MD, x: any, digest?: number): boolean {
  const { buffer, pos } = h;
  let n = 0;
  if (!digest && typeof x != 'string') {
    abytes(x);
    // bytes that stay in the buffer (of any HashMD): what noble's loop does
    if (pos + x.length < h.blockLen) {
      buffer.set(x, pos);
      h.pos += x.length;
      h.length += x.length;
      h.roundClean();
      return true;
    }
  }
  const k = kernel(h);
  // (a length that is no byte count below 2^32: noble's BigInt(length * 8)
  // decides)
  if (!k || (digest && h.length !== h.length >>> 0)) return false;
  const f = inst(k.f);
  const m = f.m;
  if (!digest) {
    n = message(f, x);
    // (a string that stays in the buffer)
    if (pos + n < f.b) {
      for (let i = 0; i < n; i++) (buffer[pos + i] = m[IO + i]), (m[IO + i] = 0);
      h.pos += n;
      h.length += n;
      return true;
    }
  }
  put(h, f);
  // (whole blocks from pos 0 leave noble's buffer as it was)
  const keep = !digest && !pos && !(n % f.b);
  keep || m.set(buffer, B);
  if (digest) f.e.d(pos, h.length);
  else {
    h.pos = feed(f, pos, n);
    h.length += n;
  }
  // (after a digest: the last block processed, as in noble; then the
  // digest, as `out` may be the buffer)
  keep || buffer.set(f.v);
  if (digest) x.set((k.o ||= m.subarray(O, O + k.outputLen)));
  take(h, f.i);
  f.e.z();
  return true;
}

/**
 * The compression function of family f on the block at `offset` of `view`,
 * read the way noble's process() reads it (same errors).
 */
export function fastProcess(h: MD, view: DataView, offset: any, f: Family): void {
  inst(f);
  const d = (f.d ||= new DataView(f.m.buffer));
  try {
    // (offset += 4 as in noble, which also concatenates a string offset)
    for (let j = 0; j < f.b; j += 4, offset += 4) d.setUint32(IO + j, view.getUint32(offset));
    // (noble's get() of the family: it reads the fields as noble's process()
    // does, also for a subclass with a get() of its own)
    f.i.set((f.g || h.get).call(h));
    f.e.u(0, f.b);
    take(h, f.i);
  } finally {
    f.e.z();
  }
}

/**
 * utils.createHasher with a one-shot path that never creates an instance:
 * same function shape (name, length, outputLen, blockLen, create). Also
 * registers the kernel of family f for the class hashCons creates.
 */
export function fastHasher(hashCons: () => MD, f: Family): CHash {
  const t = hashCons();
  const iv = new Int32Array(t.get());
  const outputLen = t.outputLen;
  const hashC = (msg: string | Uint8Array): Uint8Array => {
    if (typeof msg != 'string') abytes(msg);
    const F = inst(f);
    F.i.set(iv);
    const n = message(F, msg);
    F.e.d(feed(F, 0, n), n);
    const res = F.m.slice(O, O + outputLen);
    F.e.z();
    return res;
  };
  hashC.outputLen = outputLen;
  hashC.blockLen = t.blockLen;
  // (like noble's `() => hashCons()`: no name, no parameters)
  hashC.create = hashCons;
  t.f = f;
  f.g = t.get;
  KERNELS.set(t.constructor, t);
  return hashC as CHash;
}

// ---------------------------------------------------------------- PBKDF2

/**
 * The kernel for PBKDF2's PRF (noble's HMAC over one of the classes above,
 * right after construction), or undefined.
 */
export function fastPrf(PRF: Prf): MD | undefined {
  const { iHash, oHash } = PRF;
  const k = kernel(iHash);
  // (both hashes right after the key block, one block each: neither
  // finished nor destroyed, or HMAC's constructor would have thrown)
  if (k && kernel(oHash) === k && !iHash.pos && !oHash.pos && iHash.length + oHash.length === 2 * k.blockLen) return k;
}

/**
 * n PBKDF2 iterations in wasm: U = PRF(U), acc ^= U. `u` and `acc` (both
 * PRF.outputLen long) are read and written back.
 */
function pbkdf2Run(PRF: Prf, k: MD, u: Uint8Array, acc: Uint8Array, n: number): void {
  const f = inst(k.f);
  const ol = u.length;
  f.i.set(PRF.iHash.get());
  f.i.set(PRF.oHash.get(), 16);
  f.m.set(u, B);
  f.m.set(acc, T);
  f.e.p(ol, n);
  u.set(f.m.subarray(B, B + ol));
  acc.set(f.m.subarray(T, T + ol));
  f.e.z();
}

/**
 * Iterations 2..c of one PBKDF2 block (`u` = U1, Ti = its first Ti.length
 * bytes on entry), as noble's loop computes them.
 */
export function fastPbkdf2(PRF: Prf, k: MD, u: Uint8Array, Ti: Uint8Array, iters: number): void {
  const acc = u.slice();
  // (in slices: the wasm counter is 32-bit)
  for (; iters > 0; iters -= 2 ** 30) pbkdf2Run(PRF, k, u, acc, Math.min(iters, 2 ** 30));
  Ti.set(acc.subarray(0, Ti.length));
  acc.fill(0);
}

/**
 * Async version: slices that double while one takes less than a quarter of
 * `asyncTick` ms; yields like noble's asyncLoop every `asyncTick` ms.
 */
export async function fastPbkdf2Async(PRF: Prf, k: MD, u: Uint8Array, Ti: Uint8Array, iters: number, asyncTick: number): Promise<void> {
  const acc = u.slice();
  for (let step = 256, ts = Date.now(); iters > 0; ) {
    const n = Math.min(step, iters);
    const t0 = Date.now();
    pbkdf2Run(PRF, k, u, acc, n);
    iters -= n;
    if (Date.now() - t0 < asyncTick / 4 && step < 2 ** 30) step *= 2;
    const diff = Date.now() - ts;
    if (diff >= 0 && diff < asyncTick) continue;
    await nextTick();
    ts += diff;
  }
  Ti.set(acc.subarray(0, Ti.length));
  acc.fill(0);
}

// ---------------------------------------------------------------- scrypt

/**
 * A fresh instance of the scrypt module (f) for ROMix of B (bytes, copied
 * in): its memory grown for B (p blocks), V (N blocks) and a temporary block
 * after the first page (the RangeError of Memory.grow() when they do not
 * fit into 4 GiB), their layout at 0 (see wasm/scrypt.wat).
 */
function scryptStart(f: Family, B: Uint8Array, r: number, N: number, p: number): ScryptExports {
  // (scrypt's PBKDF2-SHA256 before this reports a missing WebAssembly)
  const w = new WebAssembly.Instance((f.s ||= new WebAssembly.Module(bytes(f.t)))).exports as unknown as ScryptExports;
  const bs = 128 * r;
  const need = bs * (N + p + 1);
  w.m.grow(Math.ceil(need / 65536));
  new Int32Array(w.m.buffer).set([N, bs, 65536, 65536 + bs * p, 65536 + bs * (p + N), need]);
  permute(w, B);
  return w;
}

/**
 * B's words into the instance (or back): every 64-byte block with word
 * 5i mod 16 at position i, the diagonal order of salsa20's SIMD rounds.
 */
function permute(w: ScryptExports, B: Uint8Array, back?: number): void {
  // (B: pbkdf2's output, a buffer of its own)
  const b = new Int32Array(B.buffer);
  const v = new Int32Array(w.m.buffer, 65536, b.length);
  for (let i = 0; i < b.length; i++) {
    const j = (i & ~15) | ((i * 5) & 15);
    if (back) b[j] = v[i];
    else v[i] = b[j];
  }
}

/**
 * The steps [s, e) of ROMix on block pi of B (one step = one BlockMix, 2N
 * per block) up to where noble's blockMixCb reports progress; each report
 * after the slice was run.
 */
function* scryptSlices(N: number, p: number, onProgress: Progress): Generator<[number, number, number]> {
  const steps = 2 * N;
  const total = steps * p;
  const per = Math.max(Math.floor(total / 10000), 1);
  for (let cnt = 0; cnt < total; ) {
    const pi = Math.floor(cnt / steps);
    const s = cnt - pi * steps;
    const e = onProgress ? Math.min(steps, s + Math.min((Math.floor(cnt / per) + 1) * per, total) - cnt) : steps;
    yield [pi, s, e];
    cnt += e - s;
    if (onProgress && (!(cnt % per) || cnt === total)) onProgress(cnt / total);
  }
}

/**
 * scrypt's loops: ROMix of all p blocks of B (in place), with noble's
 * progress callbacks: steps (one step = one BlockMix, 2N per block) up to
 * where noble's blockMixCb reports progress, then the report.
 */
export function fastScrypt(f: Family, B: Uint8Array, r: number, N: number, p: number, onProgress: Progress): void {
  const w = scryptStart(f, B, r, N, p);
  const steps = 2 * N;
  const total = steps * p;
  const per = Math.max(Math.floor(total / 10000), 1);
  try {
    for (let cnt = 0, e, pi; cnt < total; cnt = e) {
      pi = Math.floor(cnt / steps);
      e = Math.min(total, (Math.floor(cnt / per) + 1) * per, (pi + 1) * steps);
      // (r = 0: empty blocks, nothing to mix; noble still reports progress)
      if (r) w.s(pi, cnt - pi * steps, e - pi * steps);
      if (onProgress && (!(e % per) || e === total)) onProgress(e / total);
    }
    permute(w, B, 1);
  } finally {
    w.w();
  }
}

/**
 * Async version: slices that double while one takes less than a quarter of
 * `asyncTick` ms; yields like noble's asyncLoop every `asyncTick` ms.
 */
export async function fastScryptAsync(f: Family, B: Uint8Array, r: number, N: number, p: number, onProgress: Progress, asyncTick: number): Promise<void> {
  const w = scryptStart(f, B, r, N, p);
  try {
    let step = 16;
    let ts = Date.now();
    for (const [pi, s, e0] of scryptSlices(N, p, onProgress)) {
      for (let s1 = s; s1 < e0; ) {
        const e = Math.min(e0, s1 + step);
        const t0 = Date.now();
        if (r) w.s(pi, s1, e);
        if (Date.now() - t0 < asyncTick / 4) step *= 2;
        s1 = e;
        const diff = Date.now() - ts;
        if (diff >= 0 && diff < asyncTick) continue;
        await nextTick();
        ts += diff;
      }
    }
    permute(w, B, 1);
  } finally {
    w.w();
  }
}

// ---------------------------------------------------------------- tests

/**
 * Tests: loads every hash family created so far (as its first use would)
 * and returns whether all of them run (false if there are none or without
 * WebAssembly).
 */
export function wasmActive(): boolean {
  try {
    for (const f of FAMILIES) if (f.b) inst(f);
    else if (!f.s) {
      const b = bytes(f.t);
      f.s = new WebAssembly.Module(b);
    }
    return FAMILIES.length > 0;
  } catch (e) {
    return false;
  }
}

/** Tests: whether every family created so far was loaded (by its first use). */
export function wasmLoaded(): boolean {
  return FAMILIES.length > 0 && FAMILIES.every((f) => f.e || f.s);
}

/** Tests: how many families were created (in a bundle: the modules it kept). */
export function wasmFamilies(): number {
  return FAMILIES.length;
}

/** Tests: whether no message bytes or state are left in wasm memory (all but K). */
export function scratchIsClean(): boolean {
  for (const f of FAMILIES) for (let i = 0; f.i && i < KB >> 2; i++) if (f.i[i]) return false;
  return true;
}

// ---------------------------------------------------------------- wasm
// generated by build.mjs from wasm/ (everything below this line)
/** the template of the SHA256 module */
export const WASM_SHA256 = "3 {n0 ci+A K* G,j(Q-S)k)I*&)-(J9))KDID&6,+*)0/.-43218765&4-(J9j*(Q95)k)Q+(J-j*J(9(Q18)I)Q+(J-))J(J*,)(Qj v)(T(9^)I(9I(:k0 DI(:k; D ?I(:k, B ? 6I(B 6I(Gk: DI(Gk< D ?I(Gk3 B ? 6J(9I(0k)Q+(J1 P& 6I(9 6I(-k/ DI(-k4 D ?I(-kB D ? 6I(/I(-I(.I(/ ? = ? 6K(0I(, 6J(,I(0I()k+ DI()k6 D ?I()k? D ? 6I()I(* =I(+I()I(* > = > 6J(0(Q1B)I)I(J*,)I)Q+(J-)) 6`+(J-))I*k!/) 6J*I+k* 7K+6)44g+* K* G,jI*I, 6I)I, 6&)-)K-I-&6,+*)0/.-43218765&4-)I,k9 6K,I+s6)44O** GI)I*&;K+I+&60/.-,+*)87654321&F)a,)4";
/** the template of the SHA512 module */
export const WASM_SHA512 = "3 o #0 V|+A J* G,j(Q9O)I*&3,(J1))KDID&60/.-,+*)87654321&F)J(9(Q1;)I)R,(J1))lI UJ(J*,)(Qz v)(T(9^)I(9I(:l* VI(:l1 V QI(:l0 T Q HI(B HI(Gl< VI(Glg V QI(Gl/ T Q HJ(9I(0k)R,(J1 L& HI(9 HI(-l7 VI(-l; V QI(-lR V Q HI(/I(-I(.I(/ Q O Q HK(0I(, HJ(,I(0I()lE VI()lK V QI()lP V Q HI()I(* OI(+I()I(* P O P HJ(0(Q1H)I)I(J*,)I)R,(J1))lI U HlI Ua,(J1))I*k L* 6J*I+k* 7K+6)44g+* K* G,jI*I, 6I)I, 6&)-)K-I-&6,+*)0/.-43218765&4-)I,k9 6K,I+s6)44O** GI)I*&;K+I+&60/.-,+*)87654321&F)a,)4";
/** the template of the MD5 module */
export const WASM_MD5 = "3 h@0!';*- K,j(Q-8)I)Q+(J-))J(J*,)(Qj ;)I(*I()I*Q+([ 6k)Q+(J1 L& 6(T9)8)I(,I(*I(+I(, ? = ?(TI98)I(+I(,I(*I(+ ? = ?(TYI4)I(*I(+ ?I(, ?(TjY7)I(+I(*I(,k K ? > ? 6k(Z C 6J()(Q-B)I)I(J*,)I)Q+(J-)) 6`+(J-))I*k!/) 6J*I+k* 7K+6)44N** K,jI*I, 6I)I, 6&)-)&4-)I,k9 6K,I+s6)442)I)I*a,)4";
/** the template of the SHA1 module */
export const WASM_SHA1 = "3 cQ0'K+> K* G,j(Q-S)k)I*&)-(J9))KAIA&6,+*)0/.-43218765&4-(J9j*(Q95)k)Q+(J-j*J(9(Q.8)I)Q+(J-))J(J*,)(Qz o)(T(9>)I(FI(A ?I(; ?I(9 ?k* CJ(9I(-I(9 6(T=)?)k f!c U!C. 6I(,I(*I(+I(, ? = ?(TQ=;)k n!F!V!f/ 6I(*I(+ ?I(, ?(TfQC)k!K!i!^!h D 6I(*I(+ =I(,I(*I(+ > = >(Tzf;)k!E O W!B H 6I(*I(+ ?I(, ? 6I()k. C 6J(-I(*kG CJ(*(Q.B)I)I(J*,)I)Q+(J-)) 6`+(J-))I*k!/) 6J*I+k* 7K+6)44g+* K* G,jI*I, 6I)I, 6&)-)K-I-&6,+*)0/.-43218765&4-)I,k9 6K,I+s6)44O** GI)I*&;K+I+&60/.-,+*)87654321&F)a,)4";
/** the common template of the hash family modules (wasm/kernels.mjs) */
export const COMMON = ") - ? 9*)))*H/ ,, K K K) ,+ K K* K ,+ K H) ,+ K K) ,)) ,+ K J),10)).*+,-.,*)*0>.* 9+)* A),* 0)-* <).* F)/(S Y**+ K+jI)-jk(L)I) 7K,I*I,I*sDJ+k L,I) 6k L.I+%3))I)I+ 6K)k(L)q6*k)k L,k*9)4I*I+ 7k(L) :K,-jk)k L.I+ 6I,9)4I+I,k(L) 8 6J+I*I+ 7K)-jk L,k L.I+ 6I)%3))44k L.k)I*%4)I)4 *)I)k L*d) L,k M,I) 6k)k(L)k* 7I) 7%4)I)k(L* 6k(L)u-jk)k L,k*9)k L,k)k(L)%4)4k(L+I*%0l, R9+k)k L,k*9)k)k L*k!/)9*4!!+** JI)k L*d) L,k(L+I)k(L) 6 zl, RK+9+k(L,I+9+,j(Q-=)k)k)&)-(J9))&4-(J9)*k L+k L,k*9)k L+k L-I)9*I)k L*`+ L-(Q-=)k)k)&)-(J9j)&4-(J9)*k L+k L-k*9)k L+k L,I)9*I)k L*`+ L,(Q-I)k)k)&)-(J9!/)k)&)-(J9 L*&{&4-(J9!/)I*k* 7K*6)445)k)k)k L/%4)4";
/** scrypt's ROMix (wasm/scrypt.wat) */
export const WASM_SCRYPT = ") - ? 9*)))*8, ,+ K K) ,)) ,, K K K),-,)+*.,*)*06,* 9+)* ?)** C)+3 L., m,+, K2 GI)k-Q+)K- 6kj 6K+&)-)J.I+&)-9J0I+&)-IJ1I+&)-YJ/,jI.I)I,k/ @ 6K+&)-)&{K3J.I0I+&)-9&{K4J0I1I+&)-I&{K5J1I/I+&)-Y&{K6J/k1J+,jI.I/I1I0I.I/& {*K/k0& x*I/kB& z*&z&{K/I.& {*K.k2& x*I.k@& z*&z&{K0I/& {*K.k6& x*I.k<& z*&z&{K2I0& {*K.k;& x*I.k7& z*&z&{J.I0I0&612345678)*+,-./0J1I2I2&6-./012345678)*+,J0I/I/&65678)*+,-./01234J/I+k* 7K+6)4I*I,k* Bk/ @I-k* Bk)I,k* =D 6 6K+I.I3& {*K.&4-)I+I0I4& {*K0&4-9I+I1I5& {*K1&4-II+I/I6& {*K/&4-YI,k* 6K,I-k/ Bs6)44!8**/ Kk)Q+)k* 7J.k5Q+)J/k9Q+)J0k1Q+)I)k-Q+)K) 8 6J-,jI*I+s-jI/I)I* 8 6J,I*I.s-jI*o-jI/I-I)%3))4I,I)I, 69).I*I.p-jI,I-9).I/I)I- 6kj 6Q+)I. =I) 8 6J1k)J,,jI,I0 6I,I- 6&)-)I,I1 6&)-)&{&4-)I,k9 6K,I)s6)4I0I-9)44I*k* 6J*5*444:)k1Q+)k)k=Q+)%4)4";
