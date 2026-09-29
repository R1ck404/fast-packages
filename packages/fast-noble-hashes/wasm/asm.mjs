// Build-time assembler for the wasm templates (wasm/kernels.mjs). Code is a
// flat array of byte values. Template commands are ESC (255) sequences that
// expand() in esm/_fast.ts replaces when a family is first used; a literal
// 255 is written ESC ESC. The command bytes (after ESC):
//   0..15        state local k of round j: first state local + (k - j) mod r
//   16..31       message local k of round j: first message local + (k + j) mod 16
//   33 m lo hi   (signed LEB of) lo + 256 hi + m * j: memory offsets
//   35 i         (signed LEB of) the family's constant i
//   40 n L L     the next L bytes n times, with j = 0 .. n - 1
//   41 L L       (build time: resolveSizes() puts the length the next L
//                bytes expand to in front of them)
//   42           the family's template
//   43 e s L L   the next L bytes if s <= j < e
//   48..         the family's own placeholders (MD5), signed LEB
export const ESC = 255;

export function uleb(v) {
  const o = [];
  do {
    let b = v & 127;
    v = Math.floor(v / 128);
    if (v) b |= 128;
    o.push(b);
  } while (v);
  return o;
}
export function sleb(v) {
  v = BigInt(v);
  const o = [];
  for (;;) {
    const b = Number(v & 127n);
    v >>= 7n;
    if ((v === 0n && !(b & 64)) || (v === -1n && b & 64)) return o.push(b), o;
    o.push(b | 128);
  }
}
const lit = (bytes) => bytes.flatMap((b) => (b === ESC ? [ESC, ESC] : [b]));

// ---- placeholders
export const R = (k) => ({ ph: [ESC, k] });
export const W = (k) => ({ ph: [ESC, 16 + k] });
export const J = (m, base = 0) => ({ ph: [ESC, 33, m, base & 255, base >> 8] });
/** state local j: the local index 3 + j */
export const SJ = J(1, 3);
export const C = (i) => ({ ph: [ESC, 35, i] });
export const X = (v) => ({ ph: [ESC, v] });

const imm = (x) => (x && typeof x === "object" && x.ph ? x.ph : null);
const loc = (x) => imm(x) || lit(uleb(x));

// ---- instructions
export const get = (x) => [0x20, ...loc(x)];
export const set = (x) => [0x21, ...loc(x)];
export const tee = (x) => [0x22, ...loc(x)];
export const i32 = (v) => [0x41, ...(imm(v) || lit(sleb(v)))];
export const i64 = (v) => [0x42, ...(imm(v) || lit(sleb(v)))];
const memarg = (align, off) => [align, ...(imm(off) || lit(uleb(off)))];
export const ld32 = (off = 0) => [0x28, ...memarg(2, off)];
export const ld64 = (off = 0) => [0x29, ...memarg(3, off)];
export const st32 = (off = 0) => [0x36, ...memarg(2, off)];
export const st64 = (off = 0) => [0x37, ...memarg(3, off)];
export const st8 = (off = 0) => [0x3a, ...memarg(0, off)];
export const v128ld = (off = 0) => [0xfd, 0x00, ...memarg(4, off)];
export const v128st = (off = 0) => [0xfd, 0x0b, ...memarg(4, off)];
export const v128ld64splat = (off = 0) => [0xfd, 0x0a, ...memarg(3, off)];
export const shuffle = (mask) => [0xfd, 0x0d, ...mask];
export const i64x2splat = [0xfd, 0x12];
export const i64x2extract0 = [0xfd, 0x1d, 0];
export const v128xor = [0xfd, 0x51];
export const memcopy = [0xfc, 10, 0, 0];
export const memfill = [0xfc, 11, 0];
export const i64truncSatF64U = [0xfc, 7];
export const call = (f) => [0x10, ...(imm(f) || uleb(f))];
const OPS = {
  "i32.ne": 0x47, "i32.lt_u": 0x49, "i32.gt_u": 0x4b,
  "i32.add": 0x6a, "i32.sub": 0x6b, "i32.mul": 0x6c, "i32.div_u": 0x6e, "i32.and": 0x71, "i32.or": 0x72, "i32.xor": 0x73,
  "i32.shr_u": 0x76, "i32.rotl": 0x77, "i32.rotr": 0x78,
  "i64.add": 0x7c, "i64.and": 0x83, "i64.or": 0x84, "i64.xor": 0x85, "i64.shl": 0x86, "i64.shr_u": 0x88, "i64.rotl": 0x89, "i64.rotr": 0x8a,
  "i64.extend_i32_u": 0xad, select: 0x1b,
};
export const op = (name) => {
  if (!(name in OPS)) throw new Error("unknown op " + name);
  return [OPS[name]];
};
export const block = [0x02, 0x40], loop = [0x03, 0x40], if_ = [0x04, 0x40], end = [0x0b];
export const br_if = (d) => [0x0d, d];

export const cat = (...xs) => xs.flat(Infinity);

// ---- template commands
const len2 = (n) => {
  if (n > 65535) throw new Error("template block too long");
  return [n & 255, n >> 8];
};
/** body n times, with j = 0 .. n - 1 */
export const repeat = (n, ...body) => {
  const b = cat(body);
  return [ESC, 40, n, ...len2(b.length), ...b];
};
/** body prefixed with its expanded length */
export const sized = (...body) => {
  const b = cat(body);
  return [ESC, 41, ...len2(b.length), ...b];
};
/** the family template */
export const FAMILY = [ESC, 42];
/** body only when s <= j < e */
export const range = (s, e, ...body) => {
  const b = cat(body);
  return [ESC, 43, e, s, ...len2(b.length), ...b];
};
/** body only when j >= s */
export const when = (s, ...body) => range(s, 255, ...body);

// ---- build time: expansion (as expand() in esm/_fast.ts) and sizes

/**
 * The bytes a template expands to for family f ({ t: its template, r, c,
 * x }), as expand() in esm/_fast.ts computes them.
 */
export function expandTemplate(T, f) {
  const o = [];
  const leb = (v) => o.push(...sleb(v));
  const ex = (t, a, z, j) => {
    while (a < z) {
      let v = t[a++];
      if (v < 255 || (v = t[a++]) === 255) o.push(v);
      else if (v < 16) o.push(3 + ((v - (j % f.r) + f.r) % f.r));
      else if (v < 32) o.push(3 + f.r + ((v - 16 + j) & 15));
      else if (v === 33) leb(t[a + 1] + t[a + 2] * 256 + t[a] * j), (a += 3);
      else if (v === 35) leb(f.c[t[a++]]);
      else if (v === 42) ex(f.t, 0, f.t.length, 0);
      else if (v === 40 || v === 43) {
        const k = t[a++], s = v === 43 ? t[a++] : 0, L = t[a++] | (t[a++] << 8);
        if (v === 40) for (let i = 0; i < k; i++) ex(t, a, a + L, i);
        else if (j >= s && j < k) ex(t, a, a + L, j);
        a += L;
      } else if (v >= 48) leb(f.x(v, j));
      else throw new Error("unknown template command " + v);
    }
  };
  ex(T, 0, T.length, 0);
  return o;
}

/**
 * The template with its sized blocks (41) resolved for family f: each is
 * prefixed with the literal length it expands to. (So expand() needs no
 * lengths: the family constants have the same LEB width in every family,
 * which build.mjs checks.)
 */
export function resolveSizes(T, f) {
  const o = [];
  for (let a = 0; a < T.length; ) {
    if (T[a] !== ESC) {
      o.push(T[a++]);
      continue;
    }
    const v = T[a + 1];
    if (v === 41) {
      const L = T[a + 2] | (T[a + 3] << 8);
      const body = resolveSizes(T.slice(a + 4, a + 4 + L), f);
      o.push(...lit(uleb(expandTemplate(body, f).length)), ...body);
      a += 4 + L;
      continue;
    }
    // other commands, copied with their parameters (and blocks)
    const n = v === 33 ? 5 : v === 35 ? 3 : v === 40 ? 5 + (T[a + 3] | (T[a + 4] << 8)) : v === 43 ? 6 + (T[a + 4] | (T[a + 5] << 8)) : 2;
    o.push(...T.slice(a, a + n));
    a += n;
  }
  return o;
}

// ---- module pieces
export const vec = (items) => [...uleb(items.length), ...items.flat()];
export const section = (id, body) => [id, ...lit(uleb(body.length)), ...body];
export const str = (s) => [...uleb(s.length), ...[...s].map((c) => c.charCodeAt(0))];
/** a function body: locals as [[count, type], ...] */
export const func = (locals, ...code) => sized(vec(locals.map(([n, t]) => [...uleb(n), t])), ...code, end);
export const T = { i32: 0x7f, i64: 0x7e, f64: 0x7c, v128: 0x7b };
