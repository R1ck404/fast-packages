// fastlexer: wasm core of @r1ck404/fast-es-module-lexer.
//
// A function-by-function port of es-module-lexer 1.7.0's src/lexer.c. Every
// function keeps the original's control flow, including its quirks (e.g.
// `export d...` is always read as `export default`, `if (import.meta) {`
// drops the import.meta record), so results are identical. What changes is
// how the input is walked:
//
// * The main loop only stops at characters that can do something: ( ) { } '
//   " / ` and the pairs "ex", "im", "cl" (candidates for export / import /
//   class). A SIMD nibble-table classifier finds them 64 chars at a time,
//   together with the non-whitespace chars: every other character only
//   updates lastTokenPos in the original, so lastTokenPos is derived from
//   that mask (last non-whitespace char before the stop).
// * String literals, templates and comments are skipped with SIMD scans.
// * The source is one byte per UTF-16 code unit: the lexer only tells apart
//   ASCII chars and U+00A0 (whitespace to it), every other unit behaves the
//   same. parse8 takes such bytes (ASCII or Latin-1 as is), parse16 UTF-16
//   (narrowed in place, units above 0xff become 0xff), parse_utf8 UTF-8
//   (squashed in place, non-ASCII becomes 0x80 or 0xa0).
//
// Malformed code can make the original read memory outside its source:
// before it (its bracket stack), past the NUL terminator (its records), a
// bracket-stack slot never written in this parse, or a NULL pointer. Its
// answer then depends on what earlier parses left there. This port answers
// as a fresh instance of the original does (its first parse): `outside`
// computes what that instance's memory holds at the address (zero, or what
// this parse wrote there: bracket-stack entries, records), and traps where
// that instance traps (reads past its memory, a record that does not fit in
// it). The one exception: the original's stacks have room for 1024 open
// brackets and 512 open import( calls, and deeper nesting overwrites its own
// copy of the source; here they have room for 16384 and 4096, and deeper
// nesting is a parse error.
//
// no_std and no allocator (the code size of the wasm is part of what the
// package costs): the source buffer and the records live in linear memory
// after the statics, grown with memory.grow; a panic cannot happen (no
// indexing that is not provably in bounds) and would trap.

#![no_std]

use core::arch::wasm32::*;

#[panic_handler]
fn on_panic(_: &core::panic::PanicInfo) -> ! {
    unreachable()
}

// es-module-lexer 1.7.0's wasm: the source (UTF-16) at __heap_base, its
// records right after the NUL terminator, the bracket stack (1024 slots of
// token + position) right below the source; 64 KB of memory, grown by its
// JS glue to at least __heap_base + 4 * (len + 1) bytes. Index i of the
// source is address O_SRC + 2 * i.
const O_SRC: u32 = 14656;
const O_STACK: u32 = O_SRC - 8 * 1024;
#[inline(always)]
fn oaddr(i: i32) -> u32 {
    O_SRC.wrapping_add((i as u32).wrapping_mul(2))
}

const EMPTY: i32 = (1024 - O_SRC as i32) / 2; // lastTokenPos == EMPTY_CHAR (address 1024)
const NULLP: i32 = -(O_SRC as i32) / 2; // a NULL position (address 0)
const NULL: i32 = -1; // NULL pointer fields of records

// OpenTokenState
const ANY_PAREN: u8 = 1;
const ANY_BRACE: u8 = 2;
const TEMPLATE: u8 = 3;
const TEMPLATE_BRACE: u8 = 4;
const IMPORT_PAREN: u8 = 5;
const CLASS_BRACE: u8 = 6;

// Import.dynamic markers
const D_STANDARD: i32 = -1;
const D_META: i32 = -2;

// stack sizes (see above; static memory, which costs nothing in the module)
const OT_MAX: i32 = 16384;
const UNSET: u8 = 0; // token stack slot not written in this parse
const DYN_MAX: i32 = 4096;

// Records, in the order they are made, in one stream of i32 words (read by
// the JS side as it is): an import is 9 words, an export 5, the first word
// says which (a dropped import keeps its place). (The original's records
// have the same sizes, 36 and 20 bytes, in the same order: see `outside`.)
const K_IMPORT: i32 = 1;
const K_EXPORT: i32 = 2;
const K_DROPPED: i32 = 3;

#[repr(C)]
struct Imp {
    kind: i32,
    start: i32,
    end: i32,
    ss: i32,
    se: i32,
    dynamic: i32,
    ai: i32,
    ty: i32,
    /// safe (the name is the literal) while parsing; then how the JS side
    /// gets the name: 0 none, 1 the literal's body verbatim (no escapes: then
    /// eval of the literal is its body), 3 eval the literal
    name: i32,
}

#[repr(C)]
struct Exp {
    kind: i32,
    start: i32,
    end: i32,
    ls: i32,
    le: i32,
}

const fn c(x: u8) -> u32 {
    x as u32
}

#[inline(always)]
const fn is_ws_not_br(ch: u32) -> bool {
    ch == 9 || ch == 11 || ch == 12 || ch == 32 || ch == 160
}
#[inline(always)]
const fn is_br_or_ws(ch: u32) -> bool {
    ch > 8 && ch < 14 || ch == 32 || ch == 160
}
// char classes of the chars below 128 (and U+00A0), one bit each
const F_PUNCT: u32 = 1; // is_punctuator
const F_PND: u32 = 2; // is_br_or_ws_or_punctuator_not_dot
const F_EXPR: u32 = 4; // is_expression_punctuator
const F_BWP: u32 = 8; // is_br_or_ws || is_punctuator
const fn class_of(ch: u32) -> u32 {
    let brws = ch > 8 && ch < 14 || ch == 32 || ch == 160;
    let punct = ch == c(b'!')
        || ch == c(b'%')
        || ch == c(b'&')
        || ch > 39 && ch < 48
        || ch > 57 && ch < 64
        || ch == c(b'[')
        || ch == c(b']')
        || ch == c(b'^')
        || ch > 122 && ch < 127;
    let expr = ch == c(b'!')
        || ch == c(b'%')
        || ch == c(b'&')
        || ch > 39 && ch < 47 && ch != 41
        || ch > 57 && ch < 64
        || ch == c(b'[')
        || ch == c(b'^')
        || ch > 122 && ch < 127 && ch != c(b'}');
    (punct as u32) * F_PUNCT
        | ((brws || punct && ch != c(b'.')) as u32) * F_PND
        | (expr as u32) * F_EXPR
        | ((brws || punct) as u32) * F_BWP
}
#[inline(always)]
fn cls(ch: u32) -> u32 {
    const fn table() -> [u8; 128] {
        let mut t = [0u8; 128];
        let mut ch = 0;
        while ch < 128 {
            t[ch as usize] = class_of(ch) as u8;
            ch += 1;
        }
        t
    }
    static T: [u8; 128] = table();
    if ch < 128 {
        T[ch as usize] as u32
    } else if ch == 160 {
        const { class_of(160) }
    } else {
        0
    }
}
#[inline(always)]
fn is_punctuator(ch: u32) -> bool {
    cls(ch) & F_PUNCT != 0
}
#[inline(always)]
fn is_br_or_ws_or_punctuator_not_dot(ch: u32) -> bool {
    cls(ch) & F_PND != 0
}
#[inline(always)]
fn is_expression_punctuator(ch: u32) -> bool {
    cls(ch) & F_EXPR != 0
}
#[inline(always)]
fn is_br_or_ws_or_punctuator(ch: u32) -> bool {
    cls(ch) & F_BWP != 0
}
#[inline(always)]
fn is_quote(ch: u32) -> bool {
    ch == c(b'\'') || ch == c(b'"')
}

// ------------------------------------------------------------------ SIMD

// Main-loop classifier: a nibble-table lookup per char (LO1[lo] & HI1[hi])
// and one for the char after it (LO2/HI2). class(v) & class2(v[+1]) marks:
//   b0: " ' ( ) /    b1: { }    b2: `
//   b3: e followed by x    b4: i followed by m    b5: c followed by l
// (LO2/HI2 have b0..b2 set everywhere and b6, b7 clear, so the AND is < 64).
// class(v) alone also marks whitespace (what the main loop skips):
//   b6: 9..=13    b7: 32
const LO1: v128 = u8x16(
    0x84, 0, 0x01, 0x20, 0, 0x08, 0, 0x01, 0x01, 0x51, 0x40, 0x42, 0x40, 0x42, 0, 0x01,
);
const HI1: v128 = u8x16(0x40, 0, 0x81, 0, 0, 0, 0x3c, 0x02, 0, 0, 0, 0, 0, 0, 0, 0);
const LO2: v128 = u8x16(
    0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x0f, 0x07, 0x07, 0x07, 0x27, 0x17, 0x07, 0x07,
);
const HI2: v128 = u8x16(
    0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x37, 0x0f, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07,
);
const NIB: v128 = u8x16(15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15);

/// SIMD constants as runtime values: V8 rematerializes every v128.const at
/// each use (several instructions each), so the hot loops take them from
/// here once (a volatile read cannot be constant-folded back).
#[derive(Clone, Copy)]
struct K {
    lo1: v128,
    hi1: v128,
    lo2: v128,
    hi2: v128,
    nib: v128,
}
static KTAB: [v128; 5] = [LO1, HI1, LO2, HI2, NIB];

#[inline(always)]
fn consts() -> K {
    unsafe {
        let p = core::ptr::addr_of!(KTAB) as *const v128;
        K {
            lo1: core::ptr::read_volatile(p),
            hi1: core::ptr::read_volatile(p.add(1)),
            lo2: core::ptr::read_volatile(p.add(2)),
            hi2: core::ptr::read_volatile(p.add(3)),
            nib: core::ptr::read_volatile(p.add(4)),
        }
    }
}

/// 16 chars starting at index i
#[inline(always)]
unsafe fn ld(src: *const u8, i: i32) -> v128 {
    v128_load(src.add(i as usize) as *const v128)
}

/// For the 64 chars at b: (stop chars, non-whitespace chars) as bit masks.
/// Whitespace here is what the main loop skips: 9..=13 and 32.
#[inline(always)]
unsafe fn block_masks(k: &K, src: *const u8, b: i32) -> (u64, u64) {
    let mut stops = 0u64;
    let mut ws = 0u64;
    let mut j = 0;
    while j < 4 {
        let i = b + j * 16;
        let v = ld(src, i);
        let v1 = ld(src, i + 1);
        // u16 shifts: the bits shifted in from the neighbouring byte are
        // masked off by `nib` (no 8-bit shift on x64)
        let c1 = v128_and(
            u8x16_swizzle(k.lo1, v128_and(v, k.nib)),
            u8x16_swizzle(k.hi1, v128_and(u16x8_shr(v, 4), k.nib)),
        );
        let c2 = v128_and(
            u8x16_swizzle(k.lo2, v128_and(v1, k.nib)),
            u8x16_swizzle(k.hi2, v128_and(u16x8_shr(v1, 4), k.nib)),
        );
        let s = u8x16_bitmask(i8x16_gt(v128_and(c1, c2), i8x16_splat(0))) as u64;
        // bit 7 of each byte = b7 | b6 of class(v)
        let w = u8x16_bitmask(v128_or(c1, i16x8_shl(c1, 1))) as u64;
        stops |= s << (j * 16);
        ws |= w << (j * 16);
        j += 1;
    }
    (stops, !ws)
}

/// State of the main loop's scan, handed to and from `hot`.
struct Hot {
    last: i32,
    depth: i32,
    /// current block, its remaining stops and its non-whitespace chars
    b: i32,
    p: i32,
    m: u64,
    nonws: u64,
    /// chars of the next block to leave out (the main loop restarts inside it)
    skip: i32,
    /// next_brace_is_class
    nbic: i32,
    /// end of the current last import (a `{` right after it needs a check)
    head_end: i32,
    dyn_depth: i32,
}

/// First index >= from (and < len) holding one of the bytes a, b, c, d, or len.
#[inline(always)]
unsafe fn scan_any(src: *const u8, len: i32, from: i32, a: u8, b: u8, c: u8, d: u8) -> i32 {
    let (va, vb, vc, vd) = (u8x16_splat(a), u8x16_splat(b), u8x16_splat(c), u8x16_splat(d));
    let mut i = from.max(0);
    while i < len {
        let v = ld(src, i);
        let m = v128_or(v128_or(u8x16_eq(v, va), u8x16_eq(v, vb)), v128_or(u8x16_eq(v, vc), u8x16_eq(v, vd)));
        let bits = u8x16_bitmask(m) as u32;
        if bits != 0 {
            return (i + bits.trailing_zeros() as i32).min(len);
        }
        i += 16;
    }
    len
}

/// The main loop's common case: walk the stops, handling the brackets that
/// need nothing but a push or pop and the e/i/c that do not start
/// export/import/class. Returns at the first other stop (h.p; its bit is
/// still in h.m, lastTokenPos for it in h.last), or false at the end of the
/// input. (Kept apart from the dispatcher for everything else, with the state
/// passed through `Hot`, this loop has few live values; V8's register
/// allocator spills a lot in the combined loop. wasm-opt inlines it again,
/// which is fine: the loop structure is what counts.)
#[inline(never)]
unsafe fn hot(h: &mut Hot, src: *const u8, len: i32) -> bool {
    let k = consts();
    let tok = core::ptr::addr_of_mut!(OT_TOK) as *mut u8;
    let tpos = core::ptr::addr_of_mut!(OT_POS) as *mut i32;
    let blk = core::ptr::addr_of_mut!(BLK) as *mut u64;
    let mut last = h.last;
    let mut depth = h.depth;
    let mut b = h.b;
    let mut m = h.m;
    let mut nonws = h.nonws;
    let mut nbic = h.nbic;
    let head_end = h.head_end;
    let dyn_depth = h.dyn_depth;
    let more;
    let mut p = len;
    'scan: loop {
        while m == 0 {
            // leaving block b: its last non-whitespace char (at or after the
            // start of the scan or the previous stop, which is one itself) is
            // lastTokenPos so far
            if nonws != 0 {
                last = b + 63 - nonws.leading_zeros() as i32;
            }
            b += 64;
            if b >= len {
                more = false;
                break 'scan;
            }
            let (s, w) = block_masks(&k, src, b);
            core::ptr::write_volatile(blk, s);
            core::ptr::write_volatile(blk.add(1), w);
            // (the first block after a restart: only from the restart on;
            // volatile, else LLVM makes a copy of the loop for it)
            let keep = !0u64 << core::ptr::read_volatile(&h.skip);
            core::ptr::write_volatile(&mut h.skip, 0);
            m = s & keep;
            nonws = w & keep;
        }
        // (no stop at or past len: the padding after the source is NUL)
        let q = b + m.trailing_zeros() as i32;
        // every char skipped is whitespace or a plain token char: the last
        // non-whitespace one is what lastTokenPos would be
        let w = nonws & ((m - 1) & !m);
        if w != 0 {
            last = b + 63 - w.leading_zeros() as i32;
        }
        let ch = *src.add(q as usize);
        if ch == b'(' {
            if depth >= OT_MAX {
                p = q;
                more = true;
                break;
            }
            *tok.add(depth as usize) = ANY_PAREN;
            *tpos.add(depth as usize) = last;
            depth += 1;
        } else if ch == b')' {
            if depth == 0 || dyn_depth > 0 && *tok.add(depth as usize - 1) == IMPORT_PAREN {
                p = q;
                more = true;
                break;
            }
            depth -= 1;
        } else if ch == b'{' {
            if depth >= OT_MAX || last == head_end {
                p = q;
                more = true;
                break;
            }
            *tok.add(depth as usize) = if nbic != 0 { CLASS_BRACE } else { ANY_BRACE };
            *tpos.add(depth as usize) = last;
            depth += 1;
            nbic = 0;
        } else if ch == b'}' {
            if depth == 0 || *tok.add(depth as usize - 1) == TEMPLATE_BRACE {
                p = q;
                more = true;
                break;
            }
            depth -= 1;
        } else if ch == b'e' || ch == b'i' || ch == b'c' {
            // (the classifier only stops at e, i, c followed by x, m, l)
            let r = src.add(q as usize + 2);
            let kw = if ch == b'c' {
                *r == b'a' && *r.add(1) == b's' && *r.add(2) == b's'
            } else {
                (ch == b'i' || depth == 0) && *r == b'p' && *r.add(1) == b'o' && *r.add(2) == b'r' && *r.add(3) == b't'
            };
            if kw {
                p = q;
                more = true;
                break;
            }
        } else {
            p = q;
            more = true;
            break;
        }
        m &= m - 1;
        last = q;
    }
    h.last = last;
    h.depth = depth;
    h.b = b;
    h.p = p;
    h.m = m;
    h.nonws = nonws;
    h.nbic = nbic;
    more
}

// ------------------------------------------------------------------ lexer

struct Lx {
    src: *const u8,
    len: i32,
    end: i32,
    pos: i32,
    last: i32,
    facade: bool,
    has_module_syntax: bool,
    last_slash_was_division: bool,
    next_brace_is_class: bool,
    has_error: bool,
    parse_error: i32,
    depth: i32,
    dyn_depth: i32,
    /// the last import record in the list and the one before it (0: none)
    import_head: usize,
    import_head_last: usize,
    /// the last export record (0: none)
    last_export: usize,
    /// start and end of the record stream, end of memory
    base: usize,
    top: usize,
    limit: usize,
    /// memory size of a fresh original instance parsing this source, and
    /// where our records reach the end of it
    omem: u64,
    rlimit: usize,
}

/// The RuntimeError a wasm memory access out of bounds throws (the
/// original's trap, in the engine's words).
#[cold]
fn trap() -> ! {
    unsafe { core::ptr::read_volatile(usize::MAX as *const u8) };
    unreachable()
}

const fn pack(s: &[u8]) -> u64 {
    let mut w = 0u64;
    let mut k = 0;
    while k < s.len() {
        w |= (s[k] as u64) << (8 * k);
        k += 1;
    }
    w
}
/// `s` at p (memcmp): kw!(self, p, b"...")
macro_rules! kw {
    ($l:expr, $p:expr, $s:expr) => {
        $l.memeq($p, const { pack($s) }, $s.len() as u32)
    };
}
macro_rules! rpkn {
    ($l:expr, $p:expr, $s:expr) => {
        $l.rpkn($p, const { pack($s) }, $s.len() as u32)
    };
}

impl Lx {
    #[inline(always)]
    fn raw(&self, i: i32) -> u32 {
        unsafe { *self.src.add(i as usize) as u32 }
    }

    /// `*p` of the original: in range [0, len] (len is the NUL terminator).
    /// (Out of line: it is used in many places, none of them hot.)
    #[inline(never)]
    fn at(&mut self, i: i32) -> u32 {
        self.at_i(i)
    }
    /// at(i), inlined (the loops that walk the source char by char)
    #[inline(always)]
    fn at_i(&mut self, i: i32) -> u32 {
        if (i as u32) <= (self.len as u32) {
            self.raw(i)
        } else {
            self.outside(i)
        }
    }

    /// `*p` for p outside the source: the char at address oaddr(p) of a fresh
    /// instance of the original, or its trap. Below the source is its
    /// bracket stack (slots written in this parse, zero elsewhere), past the
    /// NUL terminator its records (as they are now) and then zeros.
    #[cold]
    #[inline(never)]
    fn outside(&mut self, i: i32) -> u32 {
        unsafe { HDR[7] += 1 };
        let a = oaddr(i);
        if a as u64 + 2 > self.omem {
            trap();
        }
        // (o: the offset in the stack or the records, which start at the
        // address after the NUL terminator: 2-byte aligned only)
        let o = if a < O_SRC { a.wrapping_sub(O_STACK) } else { a - oaddr(self.len + 1) };
        let v = if a < O_SRC {
            let s = (o >> 3) as i32;
            if a < O_STACK || self.tok_at(s) == UNSET {
                0
            } else if o & 4 == 0 {
                self.tok_at(s) as u32
            } else {
                oaddr(self.tpos_at(s))
            }
        } else {
            self.record_word(o >> 2)
        };
        (v >> ((o & 2) * 8)) & 0xffff
    }

    /// Word w of the original's records (the same records in the same order,
    /// as pointers and a `next` link per list instead of our kinds), 0 after
    /// them.
    fn record_word(&self, w: u32) -> u32 {
        // our word for each word of the original's Import (start, end,
        // statement_start, statement_end, assert_index, dynamic, safe, type)
        const IMP: [u8; 8] = [1, 2, 3, 4, 6, 5, 8, 7];
        let mut w = w as usize;
        let mut a = self.base;
        while a < self.top {
            let r = a as *const i32;
            let k = unsafe { *r };
            let n = if k == K_EXPORT { 5 } else { 9 };
            if w < n {
                if w == n - 1 {
                    // next: the next record of the same list (a dropped import
                    // is in none)
                    let mut b = a + 4 * n;
                    while k != K_DROPPED && b < self.top {
                        let kb = unsafe { *(b as *const i32) };
                        if kb == k {
                            return oaddr(self.len + 1) + (b - self.base) as u32;
                        }
                        b += if kb == K_EXPORT { 20 } else { 36 };
                    }
                    return 0;
                }
                let x = unsafe { *r.add(if k == K_EXPORT { w + 1 } else { IMP[w] as usize }) };
                return if k != K_EXPORT && w >= 6 {
                    x as u32
                } else if k != K_EXPORT && w == 5 && x < 0 {
                    // STANDARD_IMPORT 1, IMPORT_META 2
                    x.wrapping_neg() as u32
                } else if x == NULL {
                    0
                } else {
                    oaddr(x)
                };
            }
            w -= n;
            a += 4 * n;
        }
        0
    }

    /// room for n more bytes of records (a fresh original traps when its
    /// records do not fit in its memory)
    #[inline(always)]
    fn reserve(&mut self, n: usize) {
        if self.top + n > self.rlimit {
            unsafe { HDR[7] += 1 };
            trap();
        }
        if self.top + n > self.limit {
            self.limit = grow_memory(self.top + n);
        }
    }

    // ---- open token stack
    #[inline(always)]
    fn push(&mut self, tok: u8, p: i32) {
        if (self.depth as u32) >= OT_MAX as u32 {
            self.syntax_error();
            return;
        }
        unsafe {
            OT_TOK[self.depth as usize] = tok;
            OT_POS[self.depth as usize] = p;
        }
        self.depth += 1;
    }
    /// Slot i of the token stack; UNSET: not written in this parse (a fresh
    /// original has zero there: token 0, position NULL)
    #[inline(always)]
    fn tok_at(&self, i: i32) -> u8 {
        if (i as u32) < OT_MAX as u32 {
            unsafe { OT_TOK[i as usize] }
        } else {
            UNSET
        }
    }
    #[inline(always)]
    fn tpos_at(&self, i: i32) -> i32 {
        if self.tok_at(i) == UNSET {
            return NULLP;
        }
        unsafe { OT_POS[i as usize] }
    }
    /// `--openTokenDepth` (never below zero: every pop follows a push)
    #[inline(always)]
    fn pop(&mut self) {
        if self.depth <= 0 {
            self.syntax_error();
            return;
        }
        self.depth -= 1;
    }

    // ---- records
    #[inline(never)]
    fn add_import(&mut self, ss: i32, start: i32, end: i32, dynamic: i32) {
        self.reserve(core::mem::size_of::<Imp>());
        let (se, ty) = if dynamic == D_META {
            (end, 3)
        } else if dynamic == D_STANDARD {
            (end + 1, 1)
        } else {
            (NULL, 2)
        };
        let a = self.top;
        unsafe {
            *(a as *mut Imp) = Imp {
                kind: K_IMPORT,
                start,
                end,
                ss,
                se,
                dynamic,
                ai: NULL,
                ty,
                name: (dynamic == D_STANDARD) as i32,
            };
        }
        self.top = a + core::mem::size_of::<Imp>();
        self.import_head_last = self.import_head;
        self.import_head = a;
        if dynamic == D_META || dynamic == D_STANDARD {
            self.has_module_syntax = true;
        }
    }
    #[inline(always)]
    fn head(&mut self) -> &mut Imp {
        unsafe { &mut *(self.import_head as *mut Imp) }
    }
    #[inline(never)]
    fn add_export(&mut self, start: i32, end: i32, ls: i32, le: i32) {
        self.reserve(core::mem::size_of::<Exp>());
        let a = self.top;
        unsafe { *(a as *mut Exp) = Exp { kind: K_EXPORT, start, end, ls, le } };
        self.top = a + core::mem::size_of::<Exp>();
        self.last_export = a;
        self.has_module_syntax = true;
    }

    // ---- helpers over positions
    /// `s` (at most 8 chars, no NUL) at p. In the original a comparison
    /// (memcmp) stops at the first mismatch, at the latest at the NUL
    /// terminator: from p in [0, len] nothing outside the source is read, so
    /// one 8-byte load (the padding covers it) compares the same; from any
    /// other p it reads outside, char by char.
    /// (want: the chars packed little-endian, n of them; see kw!; inlined:
    /// a call per keyword check costs small modules ~5% in Chromium)
    #[inline(always)]
    fn memeq(&mut self, p: i32, want: u64, n: u32) -> bool {
        if (p as u32) <= (self.len as u32) {
            let got = unsafe { core::ptr::read_unaligned(self.src.add(p as usize) as *const u64) };
            got & (!0u64 >> (64 - 8 * n)) == want
        } else {
            self.memeq_outside(p, want, n)
        }
    }
    #[cold]
    #[inline(never)]
    fn memeq_outside(&mut self, p: i32, want: u64, n: u32) -> bool {
        {
            let mut k = 0;
            while k < n {
                if self.at(p + k as i32) != (want >> (8 * k)) as u8 as u32 {
                    return false;
                }
                k += 1;
            }
            true
        }
    }
    #[inline(never)]
    fn is_spread(&mut self, p: i32) -> bool {
        self.at(p) == c(b'.') && self.at(p - 1) == c(b'.') && self.at(p - 2) == c(b'.')
    }
    #[inline(never)]
    fn is_br_or_ws_or_punctuator_or_spread_not_dot(&mut self, p: i32) -> bool {
        let ch = self.at_i(p);
        ch > 8 && ch < 14
            || ch == 32
            || ch == 160
            || is_punctuator(ch) && (self.is_spread(p) || self.at(p) != c(b'.'))
    }
    #[inline(always)]
    fn keyword_start(&mut self, p: i32) -> bool {
        p == 0 || self.is_br_or_ws_or_punctuator_or_spread_not_dot(p - 1)
    }
    // (`pos < source` in the original compares addresses, unsigned: a
    // position computed from NULL wraps around and is not below the source)
    #[inline(never)]
    fn rpk1(&mut self, p: i32, c1: u8) -> bool {
        if oaddr(p) < O_SRC {
            return false;
        }
        self.at(p) == c1 as u32 && (p == 0 || is_br_or_ws_or_punctuator_not_dot(self.at(p - 1)))
    }
    #[inline(never)]
    fn rpkn(&mut self, p: i32, want: u64, n: u32) -> bool {
        let n1 = n as i32;
        if oaddr(p - n1 + 1) < O_SRC {
            return false;
        }
        let n = n1;
        self.memeq(p - n + 1, want, n1 as u32)
            && (p - n + 1 == 0 || self.is_br_or_ws_or_punctuator_or_spread_not_dot(p - n))
    }
    #[inline(never)]
    fn is_expression_keyword(&mut self, p: i32) -> bool {
        let ch = self.at(p);
        if ch > 127 {
            return false;
        }
        match ch as u8 {
            b'd' => match self.at(p - 1) {
                x if x == c(b'i') => rpkn!(self, p - 2, b"vo"),
                x if x == c(b'l') => rpkn!(self, p - 2, b"yie"),
                _ => false,
            },
            b'e' => {
                let c1 = self.at(p - 1);
                if c1 == c(b's') {
                    let c2 = self.at(p - 2);
                    if c2 == c(b'l') {
                        self.rpk1(p - 3, b'e')
                    } else if c2 == c(b'a') {
                        self.rpk1(p - 3, b'c')
                    } else {
                        false
                    }
                } else if c1 == c(b't') {
                    rpkn!(self, p - 2, b"dele")
                } else if c1 == c(b'u') {
                    rpkn!(self, p - 2, b"contin")
                } else {
                    false
                }
            }
            b'f' => {
                if self.at(p - 1) != c(b'o') || self.at(p - 2) != c(b'e') {
                    return false;
                }
                let c3 = self.at(p - 3);
                if c3 == c(b'c') {
                    rpkn!(self, p - 4, b"instan")
                } else if c3 == c(b'p') {
                    rpkn!(self, p - 4, b"ty")
                } else {
                    false
                }
            }
            b'k' => rpkn!(self, p - 1, b"brea"),
            b'n' => self.rpk1(p - 1, b'i') || rpkn!(self, p - 1, b"retur"),
            b'o' => self.rpk1(p - 1, b'd'),
            b'r' => rpkn!(self, p - 1, b"debugge"),
            b't' => rpkn!(self, p - 1, b"awai"),
            b'w' => {
                let c1 = self.at(p - 1);
                if c1 == c(b'e') {
                    self.rpk1(p - 2, b'n')
                } else if c1 == c(b'o') {
                    rpkn!(self, p - 2, b"thr")
                } else {
                    false
                }
            }
            _ => false,
        }
    }
    #[inline(never)]
    fn is_paren_keyword(&mut self, p: i32) -> bool {
        rpkn!(self, p, b"while") || rpkn!(self, p, b"for") || rpkn!(self, p, b"if")
    }
    #[inline(never)]
    fn is_break_or_continue(&mut self, p: i32) -> bool {
        let ch = self.at(p);
        if ch == c(b'k') {
            return rpkn!(self, p - 1, b"brea");
        }
        if ch == c(b'e') && self.at(p - 1) == c(b'u') {
            return rpkn!(self, p - 2, b"contin");
        }
        false
    }
    #[inline(never)]
    fn is_expression_terminator(&mut self, p: i32) -> bool {
        let ch = self.at(p);
        if ch == c(b'>') {
            return self.at(p - 1) == c(b'=');
        }
        if ch == c(b';') || ch == c(b')') {
            return true;
        }
        if ch == c(b'h') {
            return rpkn!(self, p - 1, b"catc");
        }
        if ch == c(b'y') {
            return rpkn!(self, p - 1, b"finall");
        }
        if ch == c(b'e') {
            return rpkn!(self, p - 1, b"els");
        }
        false
    }

    #[cold]
    #[inline(never)]
    fn syntax_error(&mut self) {
        self.has_error = true;
        self.parse_error = self.pos;
        self.pos = self.end + 1;
    }

    // ---- SIMD scanners: first index >= from matching, or len
    #[inline(always)]
    fn scan_string(&self, from: i32, quote: u32) -> i32 {
        unsafe {
            let q = u8x16_splat(quote as u8);
            let bs = u8x16_splat(b'\\');
            let lf = u8x16_splat(b'\n');
            let cr = u8x16_splat(b'\r');
            let mut i = from;
            while i < self.len {
                let v = ld(self.src, i);
                let m = v128_or(
                    v128_or(u8x16_eq(v, q), u8x16_eq(v, bs)),
                    v128_or(u8x16_eq(v, lf), u8x16_eq(v, cr)),
                );
                let bits = u8x16_bitmask(m) as u32;
                if bits != 0 {
                    return (i + bits.trailing_zeros() as i32).min(self.len);
                }
                i += 16;
            }
            self.len
        }
    }
    #[inline(always)]
    fn scan_newline(&self, from: i32) -> i32 {
        unsafe {
            let lf = u8x16_splat(b'\n');
            let cr = u8x16_splat(b'\r');
            let mut i = from;
            while i < self.len {
                let v = ld(self.src, i);
                let bits = u8x16_bitmask(v128_or(u8x16_eq(v, lf), u8x16_eq(v, cr))) as u32;
                if bits != 0 {
                    return (i + bits.trailing_zeros() as i32).min(self.len);
                }
                i += 16;
            }
            self.len
        }
    }
    /// "*/" or (when !br) a line break
    #[inline(always)]
    fn scan_block_end(&self, from: i32, br: bool) -> i32 {
        unsafe {
            let star = u8x16_splat(b'*');
            let slash = u8x16_splat(b'/');
            let lf = u8x16_splat(b'\n');
            let cr = u8x16_splat(b'\r');
            let mut i = from;
            while i < self.len {
                let v = ld(self.src, i);
                let v1 = ld(self.src, i + 1);
                let mut m = v128_and(u8x16_eq(v, star), u8x16_eq(v1, slash));
                if !br {
                    m = v128_or(m, v128_or(u8x16_eq(v, lf), u8x16_eq(v, cr)));
                }
                let bits = u8x16_bitmask(m) as u32;
                if bits != 0 {
                    return (i + bits.trailing_zeros() as i32).min(self.len);
                }
                i += 16;
            }
            self.len
        }
    }
    /// "${", "`" or "\"
    #[inline(always)]
    fn scan_template(&self, from: i32) -> i32 {
        unsafe {
            let dollar = u8x16_splat(b'$');
            let brace = u8x16_splat(b'{');
            let tick = u8x16_splat(b'`');
            let bs = u8x16_splat(b'\\');
            let mut i = from;
            while i < self.len {
                let v = ld(self.src, i);
                let v1 = ld(self.src, i + 1);
                let m = v128_or(
                    v128_and(u8x16_eq(v, dollar), u8x16_eq(v1, brace)),
                    v128_or(u8x16_eq(v, tick), u8x16_eq(v, bs)),
                );
                let bits = u8x16_bitmask(m) as u32;
                if bits != 0 {
                    return (i + bits.trailing_zeros() as i32).min(self.len);
                }
                i += 16;
            }
            self.len
        }
    }

    // ---- the lexer (names follow lexer.c)

    fn parse(&mut self) -> bool {
        self.facade = true;
        self.has_module_syntax = false;
        self.dyn_depth = 0;
        self.depth = 0;
        self.last = EMPTY;
        self.last_slash_was_division = false;
        self.parse_error = 0;
        self.has_error = false;
        self.next_brace_is_class = false;
        self.pos = -1;
        self.end = self.len - 1;

        let mut goto_main = false;
        loop {
            let old = self.pos;
            self.pos += 1;
            if !(old < self.end) {
                break;
            }
            let ch = self.raw(self.pos);
            if ch == 32 || ch < 14 && ch > 8 {
                continue;
            }
            if ch == c(b'e') {
                if self.depth == 0 && self.keyword_start(self.pos) && kw!(self, self.pos + 1, b"xport") {
                    self.try_parse_export_statement();
                    if !self.facade {
                        self.last = self.pos;
                        goto_main = true;
                        break;
                    }
                }
            } else if ch == c(b'i') {
                if self.keyword_start(self.pos) && kw!(self, self.pos + 1, b"mport") {
                    self.try_parse_import_statement();
                }
            } else if ch == c(b';') {
            } else {
                if ch == c(b'/') {
                    let next = self.at(self.pos + 1);
                    if next == c(b'/') || next == c(b'*') {
                        self.skip_comment(next, true);
                        continue;
                    }
                }
                self.facade = false;
                self.pos -= 1;
                goto_main = true;
                break;
            }
            self.last = self.pos;
        }

        if !goto_main && self.has_error {
            return false;
        }

        self.main_loop();

        !(self.depth != 0 || self.has_error || self.dyn_depth != 0)
    }

    fn main_loop(&mut self) {
        let src = self.src;
        let len = self.len;
        let ot_tok = core::ptr::addr_of_mut!(OT_TOK) as *mut u8;
        let ot_pos = core::ptr::addr_of_mut!(OT_POS) as *mut i32;
        let raw = |i: i32| -> u32 { unsafe { *src.add(i as usize) as u32 } };
        // `s` matches at i (i + s.len() <= len + 1: a mismatch at the NUL
        // terminator ends the comparison before anything past it is read)
        let eq = |i: i32, s: &[u8]| -> bool {
            let mut j = 0;
            while j < s.len() {
                if raw(i + j as i32) != s[j] as u32 {
                    return false;
                }
                j += 1;
            }
            true
        };
        // the hot state lives in locals; it is written back to self around
        // every call of an out-of-line handler
        let mut pos = self.pos;
        let mut last = self.last;
        let mut depth = self.depth;
        macro_rules! sync_out {
            () => {
                self.pos = pos;
                self.last = last;
                self.depth = depth;
            };
        }
        macro_rules! sync_in {
            () => {
                pos = self.pos;
                last = self.last;
                depth = self.depth;
            };
        }
        // (a full stack is a parse error: has_error is set, pos is past end)
        macro_rules! push {
            ($t:expr, $p:expr) => {
                if (depth as u32) >= OT_MAX as u32 {
                    sync_out!();
                    self.syntax_error();
                    return;
                }
                unsafe {
                    *ot_tok.add(depth as usize) = $t;
                    *ot_pos.add(depth as usize) = $p;
                }
                depth += 1;
            };
        }
        // 64-char block cache: stop chars and non-whitespace chars of block
        // h.b, kept in memory (only needed when the scan restarts)
        let blk = core::ptr::addr_of_mut!(BLK) as *mut u64;
        let mut h = Hot {
            last: 0,
            depth: 0,
            b: -64,
            p: 0,
            m: 0,
            nonws: 0,
            skip: 0,
            nbic: 0,
            head_end: NULL,
            dyn_depth: 0,
        };
        loop {
            // (re)start from pos
            let from = pos + 1;
            if from >= len {
                pos = from;
                sync_out!();
                return;
            }
            // only stops and non-whitespace at or after from (chars before it
            // belong to a comment, string etc. that was skipped): from the
            // masks of its block if they are the cached ones, else hot makes
            // them
            let nb = from & !63;
            if nb == h.b {
                let keep = !0u64 << (from - nb);
                unsafe {
                    h.m = core::ptr::read_volatile(blk) & keep;
                    h.nonws = core::ptr::read_volatile(blk.add(1)) & keep;
                }
            } else {
                h.b = nb - 64;
                h.m = 0;
                h.nonws = 0;
                h.skip = from - nb;
            }
            // stops that leave pos at the stop continue with the same masks:
            // then the previous stop (non-whitespace) bounds the search for
            // lastTokenPos by itself
            loop {
                h.last = last;
                h.depth = depth;
                h.nbic = self.next_brace_is_class as i32;
                h.head_end = if self.import_head != 0 { self.head().end } else { NULL };
                h.dyn_depth = self.dyn_depth;
                // brackets that need nothing else are handled in there
                let more = unsafe { hot(&mut h, src, len) };
                last = h.last;
                depth = h.depth;
                self.next_brace_is_class = h.nbic != 0;
                if !more {
                    // no stop left: the rest only moves lastTokenPos
                    pos = len;
                    sync_out!();
                    return;
                }
                let p = h.p;
                h.m &= h.m - 1;
                pos = p;
                let ch = raw(p);
                match ch as u8 {
                    b'(' => {
                        push!(ANY_PAREN, last);
                    }
                    b')' => {
                        if depth == 0 {
                            sync_out!();
                            self.syntax_error();
                            return;
                        }
                        depth -= 1;
                        // (slot depth was written: tok_at cannot fail)
                        if self.dyn_depth > 0 && unsafe { *ot_tok.add(depth as usize) } == IMPORT_PAREN {
                            self.dynamic_import_end(p, last);
                        }
                    }
                    b'{' => {
                        let l = last;
                        // at(l): l is EMPTY or a position before p
                        if self.import_head != 0 && l >= 0 && raw(l) == c(b')') && self.head().end == l {
                            self.drop_import_head();
                        }
                        let t = if self.next_brace_is_class { CLASS_BRACE } else { ANY_BRACE };
                        push!(t, l);
                        self.next_brace_is_class = false;
                    }
                    b'}' => {
                        if depth == 0 {
                            sync_out!();
                            self.syntax_error();
                            return;
                        }
                        depth -= 1;
                        if unsafe { *ot_tok.add(depth as usize) } == TEMPLATE_BRACE {
                            sync_out!();
                            self.template_string();
                            sync_in!();
                            last = pos;
                            break;
                        }
                    }
                    b'\'' | b'"' => {
                        // string_literal with a local position
                        let ok = loop {
                            if !(pos + 1 < len) {
                                pos += 1;
                                break false;
                            }
                            let q = self.scan_string(pos + 1, ch);
                            if q >= len {
                                pos = len;
                                break false;
                            }
                            pos = q;
                            let e = raw(q);
                            if e == ch {
                                break true;
                            }
                            if e == c(b'\\') {
                                pos += 1;
                                if self.at(pos) == c(b'\r') && self.at(pos + 1) == c(b'\n') {
                                    pos += 1;
                                }
                                continue;
                            }
                            // line break
                            break false;
                        };
                        if !ok {
                            sync_out!();
                            self.syntax_error();
                            sync_in!();
                        }
                        last = pos;
                        break;
                    }
                    // (the classifier only stops at e, i, c followed by x, m, l;
                    // keyword_start has no side effect that matters when the
                    // keyword does not match, so it goes last)
                    b'e' => {
                        if depth == 0 && eq(p + 2, b"port") && self.keyword_start(p) {
                            sync_out!();
                            self.try_parse_export_statement();
                            sync_in!();
                            last = pos;
                            break;
                        }
                    }
                    b'i' => {
                        if eq(p + 2, b"port") && self.keyword_start(p) {
                            sync_out!();
                            self.try_parse_import_statement();
                            sync_in!();
                            last = pos;
                            break;
                        }
                    }
                    b'c' => {
                        if eq(p + 2, b"ass") && is_br_or_ws(raw(p + 5)) && self.keyword_start(p) {
                            self.next_brace_is_class = true;
                        }
                    }
                    b'/' => {
                        let next = raw(p + 1);
                        sync_out!();
                        if next == c(b'/') {
                            self.line_comment();
                            sync_in!();
                            break;
                        } else if next == c(b'*') {
                            self.block_comment(true);
                            sync_in!();
                            break;
                        }
                        self.slash();
                        sync_in!();
                        last = pos;
                        break;
                    }
                    b'`' => {
                        push!(TEMPLATE, last);
                        sync_out!();
                        self.template_string();
                        sync_in!();
                        last = pos;
                        break;
                    }
                    _ => {}
                }
                last = pos;
            }
        }
    }

    /// `)` closing a dynamic import's parens
    #[inline(never)]
    fn dynamic_import_end(&mut self, p: i32, last: i32) {
        let imp = unsafe { &mut *(*(core::ptr::addr_of_mut!(DYN) as *mut usize).add(self.dyn_depth as usize - 1) as *mut Imp) };
        if imp.end == NULL {
            imp.end = last + 1;
        }
        imp.se = p + 1;
        self.dyn_depth -= 1;
    }

    /// `{` after the `)` of the last import (`import(...) {`): not an import
    #[inline(never)]
    fn drop_import_head(&mut self) {
        // (the original unlinks what follows import_head_last: a second drop
        // without an import in between drops nothing)
        if self.import_head != self.import_head_last {
            self.head().kind = K_DROPPED;
        }
        self.import_head = self.import_head_last;
    }

    /// Division / regex ambiguity (the `/` case of the main switch)
    #[inline(never)]
    fn slash(&mut self) {
        let last = self.last;
        let lt = self.at(last);
        let depth = self.depth;
        let regex = is_expression_punctuator(lt)
            && !(lt == c(b'.') && {
                let d = self.at(last - 1);
                d >= c(b'0') && d <= c(b'9')
            })
            && !(lt == c(b'+') && self.at(last - 1) == c(b'+'))
            && !(lt == c(b'-') && self.at(last - 1) == c(b'-'))
            || lt == c(b')') && {
                let tp = self.tpos_at(depth);
                self.is_paren_keyword(tp)
            }
            || depth > 0
                && self.tok_at(depth - 1) == ANY_PAREN
                && self.at(last) == c(b'f')
                && self.at(last - 1) == c(b'o')
                && {
                    let tp = self.tpos_at(depth - 1);
                    rpkn!(self, tp, b"for")
                }
            || lt == c(b'}')
                && ({
                    let tp = self.tpos_at(depth);
                    self.is_expression_terminator(tp)
                } || self.tok_at(depth) == CLASS_BRACE)
            || self.is_expression_keyword(last)
            || lt == c(b'/') && self.last_slash_was_division
            || lt == 0;
        if regex {
            self.regular_expression();
            self.last_slash_was_division = false;
            return;
        }
        let in_export = self.last_export != 0 && {
            let e = unsafe { &*(self.last_export as *const Exp) };
            last >= e.start && last <= e.end
        };
        if in_export {
            // export default /some-regexp/
            self.regular_expression();
            self.last_slash_was_division = false;
            return;
        }
        // Final check - if the last token was "break x" or "continue x"
        loop {
            if !(self.last > 0) {
                break;
            }
            self.last -= 1;
            let l = self.last;
            if is_br_or_ws_or_punctuator_not_dot(self.at(l)) {
                break;
            }
        }
        let l = self.last;
        if is_ws_not_br(self.at(l)) {
            loop {
                if !(self.last > 0) {
                    break;
                }
                self.last -= 1;
                let l = self.last;
                if !is_ws_not_br(self.at(l)) {
                    break;
                }
            }
            let l = self.last;
            if self.is_break_or_continue(l) {
                self.regular_expression();
                self.last_slash_was_division = false;
                return;
            }
        }
        self.last_slash_was_division = true;
    }

    #[inline(never)]
    fn try_parse_import_statement(&mut self) {
        let start_pos = self.pos;
        self.pos += 6;
        let mut ch = self.cw_i(true);
        let maybe_phase_pos = self.pos;
        let mut phase: i32 = 0;

        if ch == c(b'.') {
            // import.meta
            self.pos += 1;
            ch = self.comment_whitespace(true);
            let last = self.last;
            if ch == c(b'm')
                && kw!(self, self.pos + 1, b"eta")
                && (self.is_spread(last) || self.at(last) != c(b'.'))
            {
                self.add_import(start_pos, start_pos, self.pos + 4, D_META);
                return;
            } else if ch == c(b's')
                && kw!(self, self.pos + 1, b"ource")
                && (self.is_spread(last) || self.at(last) != c(b'.'))
            {
                phase = 1;
                self.pos += 6;
                ch = self.comment_whitespace(true);
            } else if ch == c(b'd')
                && kw!(self, self.pos + 1, b"efer")
                && (self.is_spread(last) || self.at(last) != c(b'.'))
            {
                phase = 2;
                self.pos += 5;
                ch = self.comment_whitespace(true);
            } else {
                return;
            }
        } else if self.pos > start_pos + 6
            && ch == c(b's')
            && kw!(self, self.pos + 1, b"ource")
            && is_br_or_ws(self.at(self.pos + 6))
        {
            phase = 1;
            self.pos += 6;
            ch = self.comment_whitespace(true);
            // need a space after the source keyword, and must not be followed by from keyword
            if self.pos == maybe_phase_pos + 6
                || ch == c(b'f')
                    && kw!(self, self.pos + 1, b"rom")
                    && is_br_or_ws_or_punctuator_not_dot(self.at(self.pos + 4))
            {
                self.pos = maybe_phase_pos;
                phase = 0;
            }
        } else if self.pos > start_pos + 5
            && ch == c(b'd')
            && kw!(self, self.pos + 1, b"efer")
            && is_br_or_ws(self.at(self.pos + 5))
        {
            phase = 2;
            self.pos += 5;
            ch = self.comment_whitespace(true);
            // need a * after the defer keyword
            if ch != c(b'*') {
                self.pos = maybe_phase_pos;
                phase = 0;
            }
        }

        // dynamic import
        if ch == c(b'(') {
            let p = self.pos;
            self.push(IMPORT_PAREN, p);
            let last = self.last;
            if self.at(last) == c(b'.') {
                return;
            }
            let dynamic_pos = self.pos;
            self.pos += 1;
            ch = self.comment_whitespace(true);
            let p = self.pos;
            self.add_import(start_pos, p, NULL, dynamic_pos);
            if phase > 0 {
                self.head().ty = if phase == 1 { 5 } else { 7 };
            }
            if self.dyn_depth >= DYN_MAX {
                self.syntax_error();
                return;
            }
            unsafe { *(core::ptr::addr_of_mut!(DYN) as *mut usize).add(self.dyn_depth as usize) = self.import_head };
            self.dyn_depth += 1;
            if ch == c(b'\'') || ch == c(b'"') {
                self.string_literal(ch);
            } else {
                self.pos -= 1;
                return;
            }
            self.pos += 1;
            let end_pos = self.pos;
            ch = self.comment_whitespace(true);
            if ch == c(b',') {
                self.pos += 1;
                self.comment_whitespace(true);
                let p = self.pos;
                let h = self.head();
                h.end = end_pos;
                h.ai = p;
                h.name = 1;
                self.pos -= 1;
            } else if ch == c(b')') {
                self.pop();
                let p = self.pos;
                let h = self.head();
                h.end = end_pos;
                h.se = p + 1;
                h.name = 1;
                self.dyn_depth -= 1;
            } else {
                self.pos -= 1;
            }
            return;
        }

        if ch == c(b'{') && phase == 0 {
            // import statement only permitted at base-level
            if self.depth != 0 {
                self.pos -= 1;
                return;
            }
            while self.pos < self.end {
                // chars other than / ' " } only move this loop on by one:
                // skip them (up to end - 1, the loop's own end game stays)
                let q = unsafe { scan_any(self.src, self.len, self.pos, b'/', b'\'', b'"', b'}') }.min(self.end - 1);
                if q > self.pos {
                    self.pos = q;
                }
                ch = self.comment_whitespace(true);
                if is_quote(ch) {
                    self.string_literal(ch);
                } else if ch == c(b'}') {
                    self.pos += 1;
                    break;
                }
                self.pos += 1;
            }
            ch = self.comment_whitespace(true);
            if ch == c(b'f') && !kw!(self, self.pos + 1, b"rom") {
                self.syntax_error();
                return;
            }
            self.pos += 4;
            ch = self.comment_whitespace(true);
            if !is_quote(ch) {
                self.syntax_error();
                return;
            }
            self.read_import_string(start_pos, ch, 0);
        } else {
            if !(ch == c(b'"') || ch == c(b'\'') || ch == c(b'*')) {
                // no space after "import" -> not an import keyword
                if self.pos == start_pos + 6 {
                    self.pos -= 1;
                    return;
                }
            }
            // import defer * as foo mandates *; import statement only permitted at base-level
            if phase == 2 && ch != c(b'*') || self.depth != 0 {
                self.pos -= 1;
                return;
            }
            // the first quote before end
            let q = unsafe { scan_any(self.src, self.len, self.pos, b'\'', b'"', b'\'', b'"') };
            if q < self.end && q >= self.pos {
                self.pos = q;
                ch = self.raw(q);
                self.read_import_string(start_pos, ch, phase);
                return;
            }
            if self.pos < self.end {
                self.pos = self.end;
            }
            self.syntax_error();
        }
    }

    #[inline(never)]
    fn try_parse_export_statement(&mut self) {
        let s_start_pos = self.pos;
        let prev_top = self.top;
        self.pos += 6;
        let cur_pos = self.pos;
        let mut ch = self.cw_i(true);

        if self.pos == cur_pos && !is_punctuator(ch) {
            return;
        }

        if ch == c(b'{') {
            self.pos += 1;
            ch = self.comment_whitespace(true);
            loop {
                let start_pos = self.pos;
                if !is_quote(ch) {
                    ch = self.read_to_ws_or_punctuator(ch);
                } else {
                    self.string_literal(ch);
                    self.pos += 1;
                }
                let end_pos = self.pos;
                self.comment_whitespace(true);
                ch = self.read_export_as(start_pos, end_pos);
                if ch == c(b',') {
                    self.pos += 1;
                    ch = self.comment_whitespace(true);
                }
                if ch == c(b'}') {
                    break;
                }
                if self.pos == start_pos {
                    self.syntax_error();
                    return;
                }
                if self.pos > self.end {
                    self.syntax_error();
                    return;
                }
            }
            self.has_module_syntax = true; // to handle "export {}"
            self.pos += 1;
            ch = self.comment_whitespace(true);
        } else if ch == c(b'*') {
            self.pos += 1;
            self.comment_whitespace(true);
            let p = self.pos;
            self.read_export_as(p, p);
            ch = self.comment_whitespace(true);
        } else {
            self.facade = false;
            let chb = if ch < 128 { ch as u8 } else { 0 };
            match chb {
                // export default ...
                b'd' => {
                    let start_pos = self.pos;
                    self.pos += 7;
                    ch = self.cw_i(true);
                    let mut local_name = false;
                    let mut do_function = false;
                    if ch == c(b'a') {
                        // export default async? function*? name? (){}
                        if kw!(self, self.pos + 1, b"sync") && is_ws_not_br(self.at(self.pos + 5)) {
                            self.pos += 5;
                            ch = self.comment_whitespace(false);
                            do_function = true;
                        }
                    } else if ch == c(b'f') {
                        do_function = true;
                    } else if ch == c(b'c') {
                        // export default class name? {}
                        if kw!(self, self.pos + 1, b"lass") && {
                            let d = self.at(self.pos + 5);
                            is_br_or_ws(d) || self.at(self.pos + 5) == c(b'{')
                        } {
                            self.pos += 5;
                            ch = self.comment_whitespace(true);
                            if ch != c(b'{') {
                                local_name = true;
                            }
                        }
                    }
                    if do_function {
                        if kw!(self, self.pos + 1, b"unction") && {
                            let d = self.at(self.pos + 8);
                            is_br_or_ws(d) || self.at(self.pos + 8) == c(b'*') || self.at(self.pos + 8) == c(b'(')
                        } {
                            self.pos += 8;
                            ch = self.comment_whitespace(true);
                            if ch == c(b'*') {
                                self.pos += 1;
                                ch = self.comment_whitespace(true);
                            }
                            if ch != c(b'(') {
                                local_name = true;
                            }
                        }
                    }
                    if local_name {
                        let local_start_pos = self.pos;
                        self.read_to_ws_or_punctuator(ch);
                        if self.pos > local_start_pos {
                            let p = self.pos;
                            self.add_export(start_pos, start_pos + 7, local_start_pos, p);
                            self.pos -= 1;
                            return;
                        }
                    }
                    self.add_export(start_pos, start_pos + 7, NULL, NULL);
                    self.pos = start_pos + 6;
                    return;
                }
                // export async? function*? name () {
                b'a' | b'f' => {
                    if chb == b'a' {
                        self.pos += 5;
                        self.comment_whitespace(false);
                    }
                    self.pos += 8;
                    ch = self.comment_whitespace(true);
                    if ch == c(b'*') {
                        self.pos += 1;
                        ch = self.comment_whitespace(true);
                    }
                    let start_pos = self.pos;
                    self.read_to_ws_or_punctuator(ch);
                    let p = self.pos;
                    self.add_export(start_pos, p, start_pos, p);
                    self.pos -= 1;
                    return;
                }
                // export class name ... / export var/let/const name = ...(, name = ...)+
                b'c' | b'v' | b'l' => {
                    if chb == b'c' {
                        if kw!(self, self.pos + 1, b"lass")
                            && is_br_or_ws_or_punctuator_not_dot(self.at(self.pos + 5))
                        {
                            self.pos += 5;
                            ch = self.comment_whitespace(true);
                            let start_pos = self.pos;
                            self.read_to_ws_or_punctuator(ch);
                            let p = self.pos;
                            self.add_export(start_pos, p, start_pos, p);
                            self.pos -= 1;
                            return;
                        }
                        self.pos += 2;
                    }
                    self.pos += 3;
                    self.facade = false;
                    ch = self.cw_i(true);
                    let mut start_pos = self.pos;
                    ch = self.read_to_ws_or_punctuator(ch);
                    // very basic destructuring support only of the singular form:
                    //   export const { a, b, ...c }
                    let mut destructuring = ch == c(b'{') || ch == c(b'[');
                    let destructuring_pos = self.pos;
                    if destructuring {
                        self.pos += 1;
                        ch = self.comment_whitespace(true);
                        start_pos = self.pos;
                        ch = self.read_to_ws_or_punctuator(ch);
                    }
                    loop {
                        if self.pos == start_pos {
                            break;
                        }
                        let p = self.pos;
                        self.add_export(start_pos, p, start_pos, p);
                        ch = self.cw_i(true);
                        if destructuring && (ch == c(b'}') || ch == c(b']')) {
                            destructuring = false;
                            break;
                        }
                        if ch != c(b',') {
                            self.pos -= 1;
                            break;
                        }
                        self.pos += 1;
                        ch = self.comment_whitespace(true);
                        start_pos = self.pos;
                        // internal destructurings unsupported
                        if ch == c(b'{') || ch == c(b'[') {
                            self.pos -= 1;
                            break;
                        }
                        ch = self.read_to_ws_or_punctuator(ch);
                    }
                    // if stuck inside destructuring syntax, backtrack
                    if destructuring {
                        self.pos = destructuring_pos - 1;
                    }
                    return;
                }
                _ => return,
            }
        }

        // from ...
        if ch == c(b'f') && kw!(self, self.pos + 1, b"rom") {
            self.pos += 4;
            let q = self.comment_whitespace(true);
            self.read_import_string(s_start_pos, q, 0);
            // There were no local names.
            let mut a = prev_top;
            while a < self.top {
                let e = unsafe { &mut *(a as *mut Exp) };
                if e.kind == K_EXPORT {
                    e.ls = NULL;
                    e.le = NULL;
                    a += core::mem::size_of::<Exp>();
                } else {
                    a += core::mem::size_of::<Imp>();
                }
            }
        } else {
            self.pos -= 1;
        }
    }

    #[inline(never)]
    fn read_export_as(&mut self, mut start_pos: i32, mut end_pos: i32) -> u32 {
        let mut ch = self.at(self.pos);
        let local_start = if start_pos == end_pos { NULL } else { start_pos };
        let local_end = if start_pos == end_pos { NULL } else { end_pos };
        if ch == c(b'a') {
            self.pos += 2;
            ch = self.comment_whitespace(true);
            start_pos = self.pos;
            if !is_quote(ch) {
                ch = self.read_to_ws_or_punctuator(ch);
            } else {
                self.string_literal(ch);
                self.pos += 1;
            }
            end_pos = self.pos;
            ch = self.comment_whitespace(true);
        }
        if self.pos != start_pos {
            self.add_export(start_pos, end_pos, local_start, local_end);
        }
        ch
    }

    #[inline(never)]
    fn read_import_string(&mut self, ss: i32, ch0: u32, phase: i32) {
        let mut ch = ch0;
        let start_pos = self.pos + 1;
        if ch == c(b'\'') || ch == c(b'"') {
            self.string_literal(ch);
        } else {
            self.syntax_error();
            return;
        }
        let p = self.pos;
        self.add_import(ss, start_pos, p, D_STANDARD);
        if phase > 0 {
            self.head().ty = if phase == 1 { 4 } else { 6 };
        }
        self.pos += 1;
        ch = self.cw_i(false);
        if !(ch == c(b'a') && kw!(self, self.pos + 1, b"ssert"))
            && !(ch == c(b'w')
                && self.at(self.pos + 1) == c(b'i')
                && self.at(self.pos + 2) == c(b't')
                && self.at(self.pos + 3) == c(b'h'))
        {
            self.pos -= 1;
            return;
        }
        let assert_index = self.pos;
        self.pos += if ch == c(b'a') { 6 } else { 4 };
        ch = self.comment_whitespace(true);
        if ch != c(b'{') {
            self.pos = assert_index;
            return;
        }
        let assert_start = self.pos;
        loop {
            self.pos += 1;
            ch = self.comment_whitespace(true);
            if ch == c(b'\'') || ch == c(b'"') {
                self.string_literal(ch);
                self.pos += 1;
                ch = self.comment_whitespace(true);
            } else {
                ch = self.read_to_ws_or_punctuator(ch);
            }
            if ch != c(b':') {
                self.pos = assert_index;
                return;
            }
            self.pos += 1;
            ch = self.comment_whitespace(true);
            if ch == c(b'\'') || ch == c(b'"') {
                self.string_literal(ch);
            } else {
                self.pos = assert_index;
                return;
            }
            self.pos += 1;
            ch = self.comment_whitespace(true);
            if ch == c(b',') {
                self.pos += 1;
                ch = self.comment_whitespace(true);
                if ch == c(b'}') {
                    break;
                }
                continue;
            }
            if ch == c(b'}') {
                break;
            }
            self.pos = assert_index;
            return;
        }
        let p = self.pos;
        let h = self.head();
        h.ai = assert_start;
        h.se = p + 1;
    }

    /// the comment at pos (`next`: the char after the slash)
    #[inline(never)]
    fn skip_comment(&mut self, next: u32, br: bool) {
        if next == c(b'/') {
            self.line_comment();
        } else {
            self.block_comment(br);
        }
    }
    #[inline(never)]
    fn comment_whitespace(&mut self, br: bool) -> u32 {
        let mut ch;
        loop {
            ch = self.at_i(self.pos);
            if ch == c(b'/') {
                let next = self.at_i(self.pos + 1);
                if next == c(b'/') || next == c(b'*') {
                    self.skip_comment(next, br);
                } else {
                    return ch;
                }
            } else if if br { !is_br_or_ws(ch) } else { !is_ws_not_br(ch) } {
                return ch;
            }
            let old = self.pos;
            self.pos += 1;
            if !(old < self.end) {
                break;
            }
        }
        ch
    }
    /// comment_whitespace at the calls nearly every import / export
    /// statement makes (~10% on small modules): its loop over plain
    /// whitespace inside the source inlined, without calls; the rest
    /// (comments, the end of the source, outside it) is comment_whitespace's
    /// from where this one stopped
    #[inline(always)]
    fn cw_i(&mut self, br: bool) -> u32 {
        loop {
            let p = self.pos;
            if (p as u32) >= self.len as u32 {
                break;
            }
            let ch = self.raw(p);
            if !(if br { is_br_or_ws(ch) } else { is_ws_not_br(ch) }) {
                if ch == c(b'/') {
                    break;
                }
                return ch;
            }
            if !(p < self.end) {
                break;
            }
            self.pos = p + 1;
        }
        self.comment_whitespace(br)
    }

    fn template_string(&mut self) {
        loop {
            if !(self.pos < self.end) {
                self.pos += 1;
                break;
            }
            let q = self.scan_template(self.pos + 1);
            if q >= self.len {
                self.pos = self.len;
                break;
            }
            self.pos = q;
            let ch = self.raw(q);
            if ch == c(b'$') {
                // followed by '{' (scan_template only stops at "${")
                self.pos += 1;
                let p = self.pos;
                self.push(TEMPLATE_BRACE, p);
                return;
            }
            if ch == c(b'`') {
                self.pop();
                if self.has_error {
                    return;
                }
                let d = self.depth;
                if self.tok_at(d) != TEMPLATE {
                    self.syntax_error();
                }
                return;
            }
            // backslash
            self.pos += 1;
        }
        self.syntax_error();
    }

    fn block_comment(&mut self, br: bool) {
        self.pos += 1;
        if !(self.pos < self.end) {
            self.pos += 1;
            return;
        }
        let q = self.scan_block_end(self.pos + 1, br);
        if q >= self.len {
            self.pos = self.len;
            return;
        }
        self.pos = q;
        if self.raw(q) == c(b'*') {
            self.pos += 1;
        }
    }

    fn line_comment(&mut self) {
        if !(self.pos < self.end) {
            self.pos += 1;
            return;
        }
        let q = self.scan_newline(self.pos + 1);
        self.pos = if q >= self.len { self.len } else { q };
    }

    #[inline(never)]
    fn string_literal(&mut self, quote: u32) {
        loop {
            if !(self.pos < self.end) {
                self.pos += 1;
                break;
            }
            let q = self.scan_string(self.pos + 1, quote);
            if q >= self.len {
                self.pos = self.len;
                break;
            }
            self.pos = q;
            let ch = self.raw(q);
            if ch == quote {
                return;
            }
            if ch == c(b'\\') {
                self.pos += 1;
                let e = self.at(self.pos);
                if e == c(b'\r') && self.at(self.pos + 1) == c(b'\n') {
                    self.pos += 1;
                }
                continue;
            }
            // line break
            break;
        }
        self.syntax_error();
    }

    #[inline(never)]
    fn regex_character_class(&mut self) -> u32 {
        loop {
            if !(self.pos < self.end) {
                self.pos += 1;
                break;
            }
            self.pos += 1;
            let ch = self.raw(self.pos);
            if ch == c(b']') {
                return ch;
            }
            if ch == c(b'\\') {
                self.pos += 1;
            } else if ch == c(b'\n') || ch == c(b'\r') {
                break;
            }
        }
        self.syntax_error();
        0
    }

    #[inline(never)]
    fn regular_expression(&mut self) {
        loop {
            if !(self.pos < self.end) {
                self.pos += 1;
                break;
            }
            self.pos += 1;
            let ch = self.raw(self.pos);
            if ch == c(b'/') {
                return;
            }
            if ch == c(b'[') {
                self.regex_character_class();
            } else if ch == c(b'\\') {
                self.pos += 1;
            } else if ch == c(b'\n') || ch == c(b'\r') {
                break;
            }
        }
        self.syntax_error();
    }

    #[inline(never)]
    fn read_to_ws_or_punctuator(&mut self, ch0: u32) -> u32 {
        let mut ch = ch0;
        loop {
            if is_br_or_ws_or_punctuator(ch) {
                return ch;
            }
            self.pos += 1;
            ch = self.at_i(self.pos);
            if ch == 0 {
                return ch;
            }
        }
    }
}

// ------------------------------------------------------------------ exports

const PAD: usize = 128; // zeroed bytes after the source (SIMD over-read)
const PAGE: usize = 65536;

// token stack; slots written by a parse are cleared (UNSET) before the next
static mut OT_TOK: [u8; OT_MAX as usize] = [UNSET; OT_MAX as usize];
static mut OT_POS: [i32; OT_MAX as usize] = [0; OT_MAX as usize];
static mut BLK: [u64; 2] = [0; 2];
static mut DYN: [usize; DYN_MAX as usize] = [0; DYN_MAX as usize];
// source buffer (start of the heap: the memory past the statics), its
// capacity in bytes, end of memory
static mut SRC: usize = 0;
static mut CAP: usize = 0;
static mut LIMIT: usize = 0;

/// Result header: status (0 ok, 1 parse error), error index, facade,
/// hasModuleSyntax, start and end of the records (byte offsets), the source
/// buffer's capacity, and how many reads went outside the source (tests).
/// (Exported: the export is a global holding its address, which JS reads
/// without a call into wasm.)
#[no_mangle]
static mut HDR: [i32; 8] = [0; 8];

/// Memory up to at least `need` (bytes); returns the end of memory.
#[cold]
#[inline(never)]
fn grow_memory(need: usize) -> usize {
    let cur = memory_size(0) * PAGE;
    if need > cur {
        // (at least 1/8 more: fewer grows, each detaches the JS views)
        let pages = ((need - cur + PAGE - 1) / PAGE).max(cur / PAGE / 8);
        if memory_grow(0, pages) == usize::MAX {
            unreachable();
        }
    }
    memory_size(0) * PAGE
}


/// Source buffer of at least `n` bytes (plus padding): 3 per UTF-16 unit
/// for UTF-8, 2 for UTF-16, 1 for bytes. Its size in bytes is in HDR[6]
/// afterwards.
#[no_mangle]
pub extern "C" fn buf(n: u32) -> *mut u8 {
    unsafe {
        if SRC == 0 {
            SRC = memory_size(0) * PAGE;
        }
        let n = n as usize;
        // (CAP == 0: nothing allocated yet, even for n == 0)
        if n > CAP || CAP == 0 {
            CAP = (n.max(CAP * 3 / 2).max(PAGE - PAD) + 7) & !7;
            LIMIT = grow_memory(SRC + CAP + PAD);
        }
        HDR[6] = CAP as i32;
        SRC as *mut u8
    }
}

/// UTF-8 (n bytes, as written by TextEncoder.encodeInto) to one byte per
/// UTF-16 code unit, in place. The lexer only tells apart ASCII chars and
/// U+00A0 (whitespace to it); every other code unit behaves the same, so a
/// sequence becomes 0x80 (0xa0 for U+00A0), a 4-byte one two of them (a
/// surrogate pair). 16 bytes at a time while they are ASCII.
unsafe fn squash(p: *mut u8, n: usize) {
    let mut i = 0usize;
    let mut o = 0usize;
    while i < n {
        if i + 16 <= n {
            let v = v128_load(p.add(i) as *const v128);
            if u8x16_bitmask(v) == 0 {
                v128_store(p.add(o) as *mut v128, v);
                i += 16;
                o += 16;
                continue;
            }
        }
        let b = *p.add(i);
        if b < 0x80 {
            *p.add(o) = b;
            o += 1;
        } else if b >= 0xc0 {
            *p.add(o) = if b == 0xc2 && *p.add(i + 1) == 0xa0 { 0xa0 } else { 0x80 };
            o += 1;
            if b >= 0xf0 {
                *p.add(o) = 0x80;
                o += 1;
            }
        }
        i += 1;
    }
}

/// A lexer over the source buffer (len chars) with the given stacks, its
/// records from `base`.
unsafe fn lexer(len: u32, base: usize) -> Lx {
    // a fresh original: 64 KB of memory, grown by its JS glue (whole pages)
    // to hold __heap_base + 4 * (len + 1) bytes; its records start after the
    // NUL terminator
    let omem = ((O_SRC as u64 + 4 * (len as u64 + 1) + PAGE as u64 - 1) / PAGE as u64).max(1) * PAGE as u64;
    let rlimit = base as u64 + omem.saturating_sub(O_SRC as u64 + 2 * (len as u64 + 1));
    Lx {
        src: SRC as *const u8,
        len: len as i32,
        end: len as i32 - 1,
        pos: -1,
        last: EMPTY,
        facade: true,
        has_module_syntax: false,
        last_slash_was_division: false,
        next_brace_is_class: false,
        has_error: false,
        parse_error: 0,
        depth: 0,
        dyn_depth: 0,
        import_head: 0,
        import_head_last: 0,
        last_export: 0,
        base,
        top: base,
        limit: LIMIT,
        omem,
        rlimit: rlimit.min(usize::MAX as u64) as usize,
    }
}

fn run(len: u32) -> i32 {
    unsafe {
        let src = SRC as *mut u8;
        // NUL terminator + zero padding (v128 stores: a memory.fill is a call
        // out of wasm in V8; the zero is opaque so that LLVM does not turn the
        // stores back into one)
        let zero = opaque(i8x16_splat(0));
        let mut i = 0usize;
        while i < PAD {
            v128_store(src.add(len as usize + i) as *mut v128, zero);
            i += 16;
        }
        // the slots written by the last parse are a prefix of the stack
        let tok = core::ptr::addr_of_mut!(OT_TOK) as *mut u8;
        let mut i = 0usize;
        while i < OT_MAX as usize && v128_any_true(v128_load(tok.add(i) as *const v128)) {
            v128_store(tok.add(i) as *mut v128, zero);
            i += 16;
        }
        // the records follow the source
        let base = (SRC + len as usize + PAD + 7) & !7;
        let mut lx = lexer(len, base);
        let ok = lx.parse();
        LIMIT = lx.limit;

        let status = if ok { 0 } else { 1 };
        HDR[0] = status;
        HDR[1] = lx.parse_error;
        HDR[2] = lx.facade as i32;
        HDR[3] = lx.has_module_syntax as i32;
        HDR[4] = base as i32;
        HDR[5] = lx.top as i32;
        if ok {
            // how the JS side gets the import names
            let mut a = base;
            while a < lx.top {
                let r = &mut *(a as *mut Imp);
                if r.kind == K_EXPORT {
                    a += core::mem::size_of::<Exp>();
                    continue;
                }
                if r.name != 0 {
                    let (s, e) = if r.dynamic == D_STANDARD { (r.start, r.end) } else { (r.start + 1, r.end - 1) };
                    r.name = if has_backslash(src, s, e) { 3 } else { 1 };
                }
                a += core::mem::size_of::<Imp>();
            }
        }
        status
    }
}

/// A backslash in src[a..b)?
fn has_backslash(src: *const u8, a: i32, b: i32) -> bool {
    let mut i = a;
    while i < b {
        if unsafe { *src.add(i as usize) } == b'\\' {
            return true;
        }
        i += 1;
    }
    false
}

/// Lex `len` ASCII chars (one byte each) in the source buffer.
#[no_mangle]
pub extern "C" fn parse8(len: u32) -> i32 {
    run(len)
}

/// Lex a string of `len` UTF-16 units stored as `n` bytes of UTF-8.
#[no_mangle]
pub extern "C" fn parse_utf8(len: u32, n: u32) -> i32 {
    // (the units are len: TextEncoder writes a lone surrogate as U+FFFD, one unit)
    unsafe { squash(SRC as *mut u8, n as usize) };
    run(len)
}

/// A value the optimizer cannot see through: V8 rematerializes a v128.const
/// at every use inside a loop, a value loaded once stays in a register.
#[inline(always)]
fn opaque(v: v128) -> v128 {
    unsafe { core::ptr::read_volatile(&v) }
}

/// UTF-16 (n units, little endian, as written by Node's ucs2Write) to one
/// byte per unit, in place. The lexer only tells apart ASCII chars and
/// U+00A0; every other unit behaves like 0x80, so Latin-1 stays as it is and
/// everything above becomes 0xff. 32 units at a time, the last block past
/// the end (into the buffer's padding, which run() then clears).
unsafe fn narrow(p: *mut u8, n: usize) {
    let ff = opaque(u16x8_splat(0xff));
    let mut i = 0usize;
    while i < n {
        let a = u16x8_min(v128_load(p.add(2 * i) as *const v128), ff);
        let b = u16x8_min(v128_load(p.add(2 * i + 16) as *const v128), ff);
        let c = u16x8_min(v128_load(p.add(2 * i + 32) as *const v128), ff);
        let d = u16x8_min(v128_load(p.add(2 * i + 48) as *const v128), ff);
        v128_store(p.add(i) as *mut v128, u8x16_narrow_i16x8(a, b));
        v128_store(p.add(i + 16) as *mut v128, u8x16_narrow_i16x8(c, d));
        i += 32;
    }
}

/// Lex a string of `len` UTF-16 units stored as 2 * len bytes (UTF-16LE).
#[no_mangle]
pub extern "C" fn parse16(len: u32) -> i32 {
    unsafe { narrow(SRC as *mut u8, len as usize) };
    run(len)
}
