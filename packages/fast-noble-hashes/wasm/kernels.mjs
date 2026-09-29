// The wasm of the hash families as templates (see wasm/asm.mjs), expanded
// on first use by expand() in esm/_fast.ts into fully unrolled block
// functions: a few hundred bytes to ship per family instead of 3-11 KB.
//
// Every family module has the same exports (COMMON, generic over the
// family's constants) and three functions of its own (the family template):
//   c(s, p, n)    n blocks at p onto the state at s (get() order: 32-bit
//                 words, or (high, low) pairs for SHA-512)
//   out(s, d, n)  n bytes of the digest of the state at s to d
//   w(a, L)       the 64-bit message length L (bits) at a, as the family
//                 stores it (big- or little-endian)
// Round constants K are written to KB by the JS side as 64-bit words (K(),
// noble's MD5 K).
import * as A from "./asm.mjs";
const { get, set, tee, i32, i64, op, R, W, J, SJ, C, X, repeat, when, range, T } = A;

// memory (bytes): S state, S2 PBKDF2 outer state, O digest, TT PBKDF2 sum,
// Q state copy, SCR big-endian block words, B buffer image (and PBKDF2's
// first block), P2 PBKDF2's second block, IO input, KB round constants
export const MEM = { S: 0, S2: 64, O: 128, TT: 192, Q: 256, SCR: 320, B: 384, P2: 512, IO: 640, KB: 64896 };
export const CAP = MEM.KB - MEM.IO;
const { S, S2, O, TT, Q, SCR, B, P2, IO, KB } = MEM;
// family constants C(i): block length, padOffset + 1, the addresses of the
// length fields (each the same LEB width in every family: see
// resolveSizes in wasm/asm.mjs)
export const famConsts = (bl, po) => [bl, po + 1, B + bl - 8, P2 + bl - 8];
const F_C = 0, F_OUT = 1, F_W = 2;

const I32 = (n) => op(`i32.${n}`), I64 = (n) => op(`i64.${n}`);
const BSWAP32 = [3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12];
const BSWAP64 = [7, 6, 5, 4, 3, 2, 1, 0, 15, 14, 13, 12, 11, 10, 9, 8];

// ------------------------------------------------------------ common
const TYPES = A.vec([
  [0x60, ...A.vec([T.i32, T.i32, T.i32]), 0], // 0 c(s, p, n), out(s, d, n)
  [0x60, ...A.vec([T.i32, T.i32]), ...A.vec([T.i32])], // 1 u(pos, n) -> pos
  [0x60, ...A.vec([T.i32, T.f64]), 0], // 2 d(pos, len)
  [0x60, ...A.vec([T.i32, T.i32]), 0], // 3 p(ol, it)
  [0x60, 0, 0], // 4 z()
  [0x60, ...A.vec([T.i32, T.i64]), 0], // 5 w(a, L)
]);
// c, out, w, u, d, p, z
const FUNCS = A.vec([[0], [0], [5], [1], [2], [3], [4]]);
const EXPORTS = A.vec([
  [...A.str("m"), 2, 0],
  [...A.str("u"), 0, 3],
  [...A.str("d"), 0, 4],
  [...A.str("p"), 0, 5],
  [...A.str("z"), 0, 6],
]);

// u(pos, n): noble's HashMD.update on the buffer image at B (pos bytes) with
// the n bytes at IO: completes the buffered block, hashes whole blocks
// straight from IO, keeps the tail; zeroes IO. Returns the new pos.
const U_ = (() => {
  const $pos = 0, $n = 1, $i = 2, $k = 3;
  return A.func(
    [[2, T.i32]],
    A.block,
    get($pos), A.if_,
    // i = min(BL - pos, n) bytes complete the buffered block
    i32(C(0)), get($pos), I32("sub"), tee($k), get($n), get($k), get($n), I32("lt_u"), op("select"), set($i),
    i32(B), get($pos), I32("add"), i32(IO), get($i), A.memcopy,
    get($pos), get($i), I32("add"), tee($pos), i32(C(0)), I32("ne"), A.br_if(1),
    i32(S), i32(B), i32(1), A.call(F_C),
    A.end,
    get($n), get($i), I32("sub"), i32(C(0)), I32("div_u"), tee($k), A.if_,
    i32(S), i32(IO), get($i), I32("add"), get($k), A.call(F_C),
    A.end,
    get($i), get($k), i32(C(0)), I32("mul"), I32("add"), set($i),
    // (memory.copy and memory.fill cost a call each: none for 0 bytes)
    get($n), get($i), I32("sub"), tee($pos), A.if_,
    i32(B), i32(IO), get($i), I32("add"), get($pos), A.memcopy,
    A.end,
    A.end,
    i32(IO), i32(0), get($n), A.memfill,
    get($pos),
  );
})();
// d(pos, len): noble's HashMD.digestInto on the buffer image (pos bytes) of
// a len-byte message: padding and length, one or two blocks; the image ends
// up holding the last block, the digest goes to O
const D_ = (() => {
  const $pos = 0, $len = 1;
  return A.func(
    [],
    get($pos), i32(0x80), A.st8(B),
    i32(B + 1), get($pos), I32("add"), i32(0), i32(C(0)), i32(1), I32("sub"), get($pos), I32("sub"), A.memfill,
    // (padOffset > BL - (pos + 1): the length needs a second block)
    get($pos), i32(C(1)), I32("add"), i32(C(0)), I32("gt_u"), A.if_,
    i32(S), i32(B), i32(1), A.call(F_C),
    i32(B), i32(0), i32(C(0)), A.memfill,
    A.end,
    i32(C(2)), get($len), A.i64truncSatF64U, i64(3), I64("shl"), A.call(F_W),
    i32(S), i32(B), i32(1), A.call(F_C),
    i32(S), i32(O), i32(64), A.call(F_OUT),
  );
})();
// p(ol, it): `it` PBKDF2-HMAC iterations. S/S2: the HMAC's inner/outer state
// after the key block; B: U (ol bytes, updated); TT: the XOR of the Us
const P_ = (() => {
  const $ol = 0, $it = 1, $L = 2;
  return A.func(
    [[1, T.i64]],
    get($ol), i32(0x80), A.st8(B),
    i32(C(2)), get($ol), i32(C(0)), I32("add"), op("i64.extend_i32_u"), i64(3), I64("shl"), tee($L), A.call(F_W),
    i32(C(3)), get($L), A.call(F_W),
    A.loop,
    repeat(4, i32(0), i32(0), A.v128ld(J(16, S)), A.v128st(J(16, Q))),
    i32(Q), i32(B), i32(1), A.call(F_C),
    i32(Q), i32(P2), get($ol), A.call(F_OUT),
    // (out() wrote whole vectors: the words after the digest are those of
    // the state beyond it, or zero)
    get($ol), i32(0x80), A.st32(P2),
    repeat(4, i32(0), i32(0), A.v128ld(J(16, S2)), A.v128st(J(16, Q))),
    i32(Q), i32(P2), i32(1), A.call(F_C),
    i32(Q), i32(B), get($ol), A.call(F_OUT),
    get($ol), i32(0x80), A.st32(B),
    repeat(4, i32(0), i32(0), A.v128ld(J(16, TT)), i32(0), A.v128ld(J(16, B)), A.v128xor, A.v128st(J(16, TT))),
    get($it), i32(1), I32("sub"), tee($it), A.br_if(0),
    A.end,
  );
})();
// z(): zeroes the scratch memory and the first block of IO
const Z_ = A.func([], i32(0), i32(0), i32(IO + 128), A.memfill);

export const COMMON_BODIES = A.cat(U_, D_, P_, Z_);
export const COMMON = A.cat(
  [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
  A.section(1, TYPES),
  A.section(3, FUNCS),
  A.section(5, A.vec([[0x00, 0x01]])),
  A.section(7, EXPORTS),
  // the code section: its header and the family's functions (see
  // familyText), then the common ones
  A.FAMILY,
  COMMON_BODIES,
);

// ------------------------------------------------------------ families
// out(s, d, n) as big-endian / little-endian 32-bit words
// (in 16-byte vectors: n rounded up; p() repairs its padding byte)
const OUT_BE = A.func([[1, T.i32], [1, T.v128]], A.loop, get(1), get(3), I32("add"), get(0), get(3), I32("add"), A.v128ld(0), tee(4), get(4), A.shuffle(BSWAP32), A.v128st(0), get(3), i32(16), I32("add"), tee(3), get(2), I32("lt_u"), A.br_if(0), A.end);
const OUT_LE = A.func([[1, T.i32]], A.loop, get(1), get(3), I32("add"), get(0), get(3), I32("add"), A.v128ld(0), A.v128st(0), get(3), i32(16), I32("add"), tee(3), get(2), I32("lt_u"), A.br_if(0), A.end);
const W_BE = A.func([[1, T.v128]], get(0), get(1), A.i64x2splat, tee(2), get(2), A.shuffle(BSWAP64), A.i64x2extract0, A.st64(0));
const W_LE = A.func([], get(0), get(1), A.st64(0));
// the loop over the blocks: p += bl; while (--n)
const next = (bl) => [get(1), i32(bl), I32("add"), set(1), get(2), i32(1), I32("sub"), tee(2), A.br_if(0), A.end];
// the state words to locals and back (+=)
const load32 = (r) => repeat(r, get(0), A.ld32(J(4)), set(SJ));
const store32 = (r) => repeat(r, get(0), get(SJ), get(0), A.ld32(J(4)), I32("add"), A.st32(J(4)));
// the big-endian 32-bit words of the block to the message locals (through SCR)
const loadBE32 = (v) => [
  repeat(4, i32(0), get(1), A.v128ld(J(16)), tee(v), get(v), A.shuffle(BSWAP32), A.v128st(J(16, SCR))),
  repeat(16, i32(0), A.ld32(J(4, SCR)), set(W(0))),
];
const [a, b, c, d, e, f, g, h] = [0, 1, 2, 3, 4, 5, 6, 7].map(R);

// SHA-256: params s p n, state 3..10, W 11..26, v 27. Round j (a..h rotate):
// h += K[j] + W[j] + S1(e) + Ch(e, f, g); d += h; h += S0(a) + Maj(a, b, c)
// (the additions of values known early come first)
const ROUND256 = [
  get(h), i32(0), A.ld32(J(8, KB + 4)), I32("add"), get(W(0)), I32("add"),
  get(e), i32(6), I32("rotr"), get(e), i32(11), I32("rotr"), I32("xor"), get(e), i32(25), I32("rotr"), I32("xor"), I32("add"),
  get(g), get(e), get(f), get(g), I32("xor"), I32("and"), I32("xor"), I32("add"),
  tee(h),
  get(d), I32("add"), set(d),
  get(h),
  get(a), i32(2), I32("rotr"), get(a), i32(13), I32("rotr"), I32("xor"), get(a), i32(22), I32("rotr"), I32("xor"), I32("add"),
  get(a), get(b), I32("and"), get(c), get(a), get(b), I32("or"), I32("and"), I32("or"), I32("add"),
  set(h),
];
// W[j] (j >= 16) in place of W[j - 16]: += s0(W[j - 15]) + W[j - 7] + s1(W[j - 2])
const SCHED256 = [
  get(W(0)),
  get(W(1)), i32(7), I32("rotr"), get(W(1)), i32(18), I32("rotr"), I32("xor"), get(W(1)), i32(3), I32("shr_u"), I32("xor"), I32("add"),
  get(W(9)), I32("add"),
  get(W(14)), i32(17), I32("rotr"), get(W(14)), i32(19), I32("rotr"), I32("xor"), get(W(14)), i32(10), I32("shr_u"), I32("xor"), I32("add"),
  set(W(0)),
];
export const SHA256 = A.cat(
  A.func([[24, T.i32], [1, T.v128]], A.loop, loadBE32(27), load32(8), repeat(64, when(16, SCHED256), ROUND256), store32(8), next(64)),
  OUT_BE,
  W_BE,
);

// SHA-512: state 3..10 and W 11..26 as i64, v 27; the state words are
// (high, low) pairs in memory
const r64 = (x, k) => [get(x), i64(k), I64("rotr")];
const ROUND512 = [
  get(h), i32(0), A.ld64(J(8, KB)), I64("add"), get(W(0)), I64("add"),
  r64(e, 14), r64(e, 18), I64("xor"), r64(e, 41), I64("xor"), I64("add"),
  get(g), get(e), get(f), get(g), I64("xor"), I64("and"), I64("xor"), I64("add"),
  tee(h),
  get(d), I64("add"), set(d),
  get(h),
  r64(a, 28), r64(a, 34), I64("xor"), r64(a, 39), I64("xor"), I64("add"),
  get(a), get(b), I64("and"), get(c), get(a), get(b), I64("or"), I64("and"), I64("or"), I64("add"),
  set(h),
];
const SCHED512 = [
  get(W(0)),
  r64(W(1), 1), r64(W(1), 8), I64("xor"), get(W(1)), i64(7), I64("shr_u"), I64("xor"), I64("add"),
  get(W(9)), I64("add"),
  r64(W(14), 19), r64(W(14), 61), I64("xor"), get(W(14)), i64(6), I64("shr_u"), I64("xor"), I64("add"),
  set(W(0)),
];
export const SHA512 = A.cat(
  A.func(
    [[24, T.i64], [1, T.v128]],
    A.loop,
    repeat(16, get(1), A.v128ld64splat(J(8)), tee(27), get(27), A.shuffle(BSWAP64), A.i64x2extract0, set(W(0))),
    repeat(8, get(0), A.ld64(J(8)), i64(32), I64("rotl"), set(SJ)),
    repeat(80, when(16, SCHED512), ROUND512),
    repeat(8, get(0), get(SJ), get(0), A.ld64(J(8)), i64(32), I64("rotl"), I64("add"), i64(32), I64("rotl"), A.st64(J(8))),
    next(128),
  ),
  OUT_BE,
  W_BE,
);

// SHA-1: state 3..7, W 8..23, v 24. Round j (a..e rotate):
// e += W[j] + K + f(b, c, d) + rotl(a, 5); b = rotl(b, 30); K and f by the
// round's fifth of the 80
const SCHED1 = [get(W(13)), get(W(8)), I32("xor"), get(W(2)), I32("xor"), get(W(0)), I32("xor"), i32(1), I32("rotl"), set(W(0))];
const [a1, b1, c1, d1] = [a, b, c, d];
const CH1 = [get(d1), get(b1), get(c1), get(d1), I32("xor"), I32("and"), I32("xor")];
const PAR1 = [get(b1), get(c1), I32("xor"), get(d1), I32("xor")];
const MAJ1 = [get(b1), get(c1), I32("and"), get(d1), get(b1), get(c1), I32("or"), I32("and"), I32("or")];
const ROUND1 = [
  get(e), get(W(0)), I32("add"),
  range(0, 20, i32(0x5a827999), I32("add"), CH1),
  range(20, 40, i32(0x6ed9eba1), I32("add"), PAR1),
  range(40, 60, i32(0x8f1bbcdc | 0), I32("add"), MAJ1),
  range(60, 80, i32(0xca62c1d6 | 0), I32("add"), PAR1),
  I32("add"), get(a), i32(5), I32("rotl"), I32("add"), set(e),
  get(b), i32(30), I32("rotl"), set(b),
];
export const SHA1 = A.cat(
  A.func(
    [[21, T.i32], [1, T.v128]],
    A.loop,
    loadBE32(24),
    load32(5),
    repeat(80, when(16, SCHED1), ROUND1),
    store32(5),
    next(64),
  ),
  OUT_BE,
  W_BE,
);

// MD5: state 3..6; the message words are read from memory. Step j (a..d
// rotate): a = b + rotl(a + X[g(j)] + K[j] + f(b, c, d), s(j)); X(50) is
// 4 g(j), X(49) is s(j) (MD5_X in esm/_fast.ts)
const step5 = (fn) => [
  get(b), get(a), get(1), A.ld32(X(50)), I32("add"), i32(0), A.ld32(J(8, KB)), I32("add"), fn, I32("add"), i32(X(49)), I32("rotl"), I32("add"), set(a),
];
const F5 = [get(d), get(b), get(c), get(d), I32("xor"), I32("and"), I32("xor")];
const G5 = [get(c), get(d), get(b), get(c), I32("xor"), I32("and"), I32("xor")];
const H5 = [get(b), get(c), I32("xor"), get(d), I32("xor")];
const I5 = [get(c), get(b), get(d), i32(-1), I32("xor"), I32("or"), I32("xor")];
export const MD5 = A.cat(
  A.func(
    [[4, T.i32]],
    A.loop,
    load32(4),
    repeat(64, step5([range(0, 16, F5), range(16, 32, G5), range(32, 48, H5), range(48, 64, I5)])),
    store32(4),
    next(64),
  ),
  OUT_LE,
  W_LE,
);

// family parameters for expand(): state locals count r (the message locals
// follow them), block length, padOffset
export const FAMILIES = {
  SHA256: { t: SHA256, r: 8, bl: 64, po: 8 },
  SHA512: { t: SHA512, r: 8, bl: 128, po: 16 },
  SHA1: { t: SHA1, r: 5, bl: 64, po: 8 },
  MD5: { t: MD5, r: 4, bl: 64, po: 8, x: (v, j) => (v < 50 ? [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21][(j >> 4) * 4 + (j & 3)] : 4 * ([j, 5 * j + 1, 3 * j + 5, 7 * j][j >> 4] & 15)) },
};

/**
 * The template a family ships: the code section's header (the size of the
 * whole section, as the family's functions and the common ones expand) and
 * its functions, sizes resolved.
 */
export function familyText(name) {
  const { t, r, bl, po, x } = FAMILIES[name];
  const f = { t: [], r, c: famConsts(bl, po), x };
  const own = A.resolveSizes(t, f);
  const size = 1 + A.expandTemplate(own, f).length + A.expandTemplate(A.resolveSizes(COMMON_BODIES, f), f).length;
  return A.cat(10, A.uleb(size).flatMap((b) => (b === A.ESC ? [A.ESC, A.ESC] : [b])), 7, own);
}
/** The common template, sizes resolved (the same for every family). */
export function commonText() {
  const texts = Object.values(FAMILIES).map(({ r, bl, po, x }) => A.resolveSizes(COMMON, { t: [], r, c: famConsts(bl, po), x }));
  if (texts.some((t) => t.join() !== texts[0].join())) throw new Error("COMMON: sizes differ between families");
  return texts[0];
}
