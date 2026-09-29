// adler32 / crc32 with the same results as pako's (and zlib's).
//
// adler32: wasm SIMD. Each 16-byte vector adds its byte sum to s1 and its
// (16..1)-weighted sum to s2; the running s1 contributes 16*s1 to s2 per
// vector. Reduced modulo 65521 at least every NMAX bytes, like zlib.
//
// crc32: slice-by-8 tables, run over three independent lanes at once (the
// table lookups of the lanes overlap), lanes joined with zlib's
// crc32_combine math (multiplication by x^(8n) mod P).

const BASE: u32 = 65521;
const NMAX: usize = 5552;

fn adler32_scalar(adler: u32, buf: &[u8]) -> u32 {
    let mut s1 = adler & 0xffff;
    let mut s2 = (adler >> 16) & 0xffff;
    let mut p = buf;
    while !p.is_empty() {
        let n = if p.len() > NMAX { NMAX } else { p.len() };
        let (chunk, rest) = p.split_at(n);
        for &b in chunk {
            s1 += b as u32;
            s2 += s1;
        }
        s1 %= BASE;
        s2 %= BASE;
        p = rest;
    }
    s1 | (s2 << 16)
}

#[cfg(target_arch = "wasm32")]
pub fn adler32(adler: u32, buf: &[u8]) -> u32 {
    use core::arch::wasm32::*;
    if buf.len() < 64 {
        return adler32_scalar(adler, buf);
    }
    let mut s1 = (adler & 0xffff) as u64;
    let mut s2 = ((adler >> 16) & 0xffff) as u64;
    let w_lo = i16x8(16, 15, 14, 13, 12, 11, 10, 9);
    let w_hi = i16x8(8, 7, 6, 5, 4, 3, 2, 1);
    let mut p = buf.as_ptr();
    let mut left = buf.len();
    // blocks of at most NMAX bytes (multiple of 16)
    while left >= 16 {
        let n = core::cmp::min(left, NMAX & !15) & !15;
        let vecs = n / 16;
        let mut v_s1 = u32x4_splat(0);
        let mut v_ps = u32x4_splat(0);
        let mut v_s2 = u32x4_splat(0);
        unsafe {
            for _ in 0..vecs {
                let v = v128_load(p as *const v128);
                v_ps = u32x4_add(v_ps, v_s1);
                let pairs = u16x8_extadd_pairwise_u8x16(v);
                v_s1 = u32x4_add(v_s1, u32x4_extadd_pairwise_u16x8(pairs));
                let lo = u16x8_extend_low_u8x16(v);
                let hi = u16x8_extend_high_u8x16(v);
                v_s2 = u32x4_add(v_s2, i32x4_dot_i16x8(lo, w_lo));
                v_s2 = u32x4_add(v_s2, i32x4_dot_i16x8(hi, w_hi));
                p = p.add(16);
            }
        }
        let hs = |v: v128| -> u64 {
            u32x4_extract_lane::<0>(v) as u64 + u32x4_extract_lane::<1>(v) as u64 + u32x4_extract_lane::<2>(v) as u64 + u32x4_extract_lane::<3>(v) as u64
        };
        s2 += (n as u64) * s1 + 16 * hs(v_ps) + hs(v_s2);
        s1 += hs(v_s1);
        s1 %= BASE as u64;
        s2 %= BASE as u64;
        left -= n;
    }
    let rest = unsafe { core::slice::from_raw_parts(p, left) };
    adler32_scalar((s1 as u32) | ((s2 as u32) << 16), rest)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn adler32(adler: u32, buf: &[u8]) -> u32 {
    adler32_scalar(adler, buf)
}

/// crc32 tables (slice-by-8), built on first use: 8 KB of table data is
/// smaller as ~100 bytes of code (and takes a few microseconds to build).
static mut CRC_TABLES: [[u32; 256]; 8] = [[0; 256]; 8];
static mut CRC_READY: bool = false;

#[inline(always)]
#[allow(static_mut_refs)]
fn crc_tables() -> &'static [[u32; 256]; 8] {
    unsafe {
        if !CRC_READY {
            make_crc_tables();
        }
        &CRC_TABLES
    }
}

#[cold]
#[inline(never)]
#[allow(static_mut_refs)]
unsafe fn make_crc_tables() {
    let t = &mut CRC_TABLES;
    for n in 0..256 {
        let mut c = n as u32;
        for _ in 0..crate::rolled(8) {
            c = if c & 1 != 0 { 0xEDB88320 ^ (c >> 1) } else { c >> 1 };
        }
        t[0][n] = c;
    }
    for n in 0..256 {
        let mut c = t[0][n];
        for k in 1..8 {
            c = t[0][(c & 0xff) as usize] ^ (c >> 8);
            t[k][n] = c;
        }
    }
    CRC_READY = true;
}
#[cfg(test)]
const POLY: u32 = 0xedb88320;

/// a*b mod P (reflected), zlib multmodp
#[cfg(test)]
pub(crate) const fn multmodp(a: u32, mut b: u32) -> u32 {
    let mut m: u32 = 1 << 31;
    let mut p: u32 = 0;
    loop {
        if a & m != 0 {
            p ^= b;
            if a & (m - 1) == 0 {
                break;
            }
        }
        m >>= 1;
        b = if b & 1 != 0 { (b >> 1) ^ POLY } else { b >> 1 };
    }
    p
}

#[cfg(test)]
const fn make_x2n() -> [u32; 32] {
    let mut t = [0u32; 32];
    let mut p: u32 = 1 << 30;
    t[0] = p;
    let mut n = 1;
    while n < 32 {
        p = multmodp(p, p);
        t[n] = p;
        n += 1;
    }
    t
}


/// x^(n * 2^k) mod P
#[cfg(test)]
const fn x2nmodp(mut n: u64, mut k: u32) -> u32 {
    let t = make_x2n();
    let mut p: u32 = 1 << 31;
    while n != 0 {
        if n & 1 != 0 {
            p = multmodp(t[(k & 31) as usize], p);
        }
        n >>= 1;
        k += 1;
    }
    p
}

#[cfg(test)]
const LANE: usize = 8192;
#[cfg(test)]
static LANE_OP: u32 = x2nmodp(LANE as u64, 3);

#[inline(always)]
fn crc_word(t: &[[u32; 256]; 8], c: u32, lo: u32, hi: u32) -> u32 {
    let lo = lo ^ c;
    t[7][(lo & 0xff) as usize]
        ^ t[6][((lo >> 8) & 0xff) as usize]
        ^ t[5][((lo >> 16) & 0xff) as usize]
        ^ t[4][(lo >> 24) as usize]
        ^ t[3][(hi & 0xff) as usize]
        ^ t[2][((hi >> 8) & 0xff) as usize]
        ^ t[1][((hi >> 16) & 0xff) as usize]
        ^ t[0][(hi >> 24) as usize]
}

fn crc32_1(crc: u32, buf: &[u8]) -> u32 {
    let t = crc_tables();
    let mut c = !crc;
    let mut chunks = buf.chunks_exact(8);
    for b in &mut chunks {
        let lo = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
        let hi = u32::from_le_bytes([b[4], b[5], b[6], b[7]]);
        c = crc_word(t, c, lo, hi);
    }
    for &b in chunks.remainder() {
        c = t[0][((c ^ b as u32) & 0xff) as usize] ^ (c >> 8);
    }
    !c
}

// ---- sparse-relation reduction ("Chorba"-style) for large buffers --------
//
// With y = x^64, the CRC-32 polynomial P divides
//     Q(y) = y^300 + y^155 + y^117 + y^89 + 1
// (found by a meet-in-the-middle search; checked by `chorba_relation` test).
// The message is a polynomial with 64-bit little-endian words as
// coefficients of y (word 0 = highest degree, bit order reflected like the
// table CRC). A word w at stream position i with at least 300 words after
// it can therefore be replaced by w at positions i+145, i+183, i+211 and
// i+300 without changing the value mod P. Doing this for every word except
// the last 300 leaves a message that is zero except for those 300 words,
// whose CRC (register starting at 0) is the CRC of the whole buffer. The
// initial register value is folded in by XORing it into the first 4 bytes.
//
// Pull form: e[i] = in[i] ^ e[i-145] ^ e[i-183] ^ e[i-211] ^ e[i-300]
// (e[j] = 0 for j < 0), computed for the eliminated words; the tail words
// take contributions only from eliminated words.
const C_SPAN: usize = 300;
const C_O1: usize = 145;
const C_O2: usize = 183;
const C_O3: usize = 211;
const C_O4: usize = 300;
const C_BLK: usize = 2048;
/// below this many bytes the table method is used
const C_MIN: usize = 8 * C_SPAN * 3;

#[repr(C, align(16))]
struct Scratch([u64; C_SPAN + C_BLK + 2]);
static mut C_SCR: Scratch = Scratch([0; C_SPAN + C_BLK + 2]);

#[allow(static_mut_refs)]
fn crc32_sparse(crc: u32, buf: &[u8]) -> u32 {
    debug_assert!(buf.len() >= C_MIN);
    let nw = buf.len() / 8;
    let body = nw - C_SPAN; // words [0, body) are eliminated
    let inp = buf.as_ptr();
    unsafe {
        let s = C_SCR.0.as_mut_ptr();
        core::ptr::write_bytes(s, 0, C_SPAN);
        let init = (!crc) as u64;
        let mut i = 0usize;
        while i < body {
            let b = core::cmp::min(C_BLK, body - i);
            let dst = s.add(C_SPAN);
            let src = inp.add(8 * i);
            let mut j = 0usize;
            if i == 0 {
                // first word carries the initial register value
                let w = (src as *const u64).read_unaligned() ^ init;
                *dst = w ^ *dst.sub(C_O1) ^ *dst.sub(C_O2) ^ *dst.sub(C_O3) ^ *dst.sub(C_O4);
                j = 1;
            }
            sparse_block(src, dst, j, b);
            // keep the last C_SPAN e values in front
            core::ptr::copy(s.add(b), s, C_SPAN);
            i += b;
        }
        // tail words (register starts at 0: init was folded into word 0,
        // or into the tail's first word if nothing was eliminated)
        let mut tail = [0u64; C_SPAN];
        let e = s; // e[body - C_SPAN + k] = s[k]
        for m in 0..C_SPAN {
            let mut w = (inp.add(8 * (body + m)) as *const u64).read_unaligned();
            if body + m == 0 {
                w ^= init;
            }
            if m < C_O1 {
                w ^= *e.add(C_SPAN + m - C_O1);
            }
            if m < C_O2 {
                w ^= *e.add(C_SPAN + m - C_O2);
            }
            if m < C_O3 {
                w ^= *e.add(C_SPAN + m - C_O3);
            }
            if m < C_O4 {
                w ^= *e.add(C_SPAN + m - C_O4);
            }
            tail[m] = w.to_le();
        }
        let tb = core::slice::from_raw_parts(tail.as_ptr() as *const u8, 8 * C_SPAN);
        let c = crc32_1(0xffff_ffff, tb);
        crc32_1(c, &buf[8 * nw..])
    }
}

/// dst[k] = src[k] ^ dst[k-O1] ^ dst[k-O2] ^ dst[k-O3] ^ dst[k-O4] for k in from..n
#[cfg(target_arch = "wasm32")]
#[inline(always)]
unsafe fn sparse_block(src: *const u8, dst: *mut u64, from: usize, n: usize) {
    use core::arch::wasm32::*;
    let mut k = from;
    if k & 1 != 0 && k < n {
        let w = (src.add(8 * k) as *const u64).read_unaligned();
        *dst.add(k) = w ^ *dst.add(k).sub(C_O1) ^ *dst.add(k).sub(C_O2) ^ *dst.add(k).sub(C_O3) ^ *dst.add(k).sub(C_O4);
        k += 1;
    }
    while k + 2 <= n {
        let d = dst.add(k);
        let v = v128_load(src.add(8 * k) as *const v128);
        let a = v128_xor(v128_load(d.sub(C_O1) as *const v128), v128_load(d.sub(C_O2) as *const v128));
        let b = v128_xor(v128_load(d.sub(C_O3) as *const v128), v128_load(d.sub(C_O4) as *const v128));
        v128_store(d as *mut v128, v128_xor(v, v128_xor(a, b)));
        k += 2;
    }
    if k < n {
        let w = (src.add(8 * k) as *const u64).read_unaligned();
        *dst.add(k) = w ^ *dst.add(k).sub(C_O1) ^ *dst.add(k).sub(C_O2) ^ *dst.add(k).sub(C_O3) ^ *dst.add(k).sub(C_O4);
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[inline(always)]
unsafe fn sparse_block(src: *const u8, dst: *mut u64, from: usize, n: usize) {
    for k in from..n {
        let w = u64::from_le((src.add(8 * k) as *const u64).read_unaligned());
        *dst.add(k) = w ^ *dst.add(k).sub(C_O1) ^ *dst.add(k).sub(C_O2) ^ *dst.add(k).sub(C_O3) ^ *dst.add(k).sub(C_O4);
    }
}

/// Table method only (reference for tests).
#[cfg(test)]
pub fn crc32_tables(crc: u32, buf: &[u8]) -> u32 {
    crc32_lanes(crc, buf)
}

#[inline(never)]
pub fn crc32(crc: u32, buf: &[u8]) -> u32 {
    if buf.len() >= C_MIN {
        return crc32_sparse(crc, buf);
    }
    crc32_1(crc, buf)
}

#[cfg(test)]
fn crc32_lanes(crc: u32, buf: &[u8]) -> u32 {
    let t = crc_tables();
    let mut c = crc;
    let mut p = buf;
    while p.len() >= 3 * LANE {
        // three independent lanes; raw (un-inverted) register values
        let mut a = !c;
        let mut b = !0u32;
        let mut d = !0u32;
        unsafe {
            let pa = p.as_ptr();
            let pb = pa.add(LANE);
            let pd = pa.add(2 * LANE);
            let mut i = 0;
            while i < LANE {
                let a_lo = (pa.add(i) as *const u32).read_unaligned();
                let a_hi = (pa.add(i + 4) as *const u32).read_unaligned();
                let b_lo = (pb.add(i) as *const u32).read_unaligned();
                let b_hi = (pb.add(i + 4) as *const u32).read_unaligned();
                let d_lo = (pd.add(i) as *const u32).read_unaligned();
                let d_hi = (pd.add(i + 4) as *const u32).read_unaligned();
                a = crc_word(t, a, a_lo, a_hi);
                b = crc_word(t, b, b_lo, b_hi);
                d = crc_word(t, d, d_lo, d_hi);
                i += 8;
            }
        }
        // standard crc values of the three lanes, then combine
        let ca = !a;
        let cb = !b;
        let cd = !d;
        let ab = multmodp(LANE_OP, ca) ^ cb;
        c = multmodp(LANE_OP, ab) ^ cd;
        p = &p[3 * LANE..];
    }

    crc32_1(c, p)
}
