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

const fn make_crc_tables() -> [[u32; 256]; 8] {
    let mut t = [[0u32; 256]; 8];
    let mut n = 0;
    while n < 256 {
        let mut c = n as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 { 0xEDB88320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        t[0][n] = c;
        n += 1;
    }
    let mut n = 0;
    while n < 256 {
        let mut c = t[0][n];
        let mut k = 1;
        while k < 8 {
            c = t[0][(c & 0xff) as usize] ^ (c >> 8);
            t[k][n] = c;
            k += 1;
        }
        n += 1;
    }
    t
}

static CRC_TABLES: [[u32; 256]; 8] = make_crc_tables();
const POLY: u32 = 0xedb88320;

/// a*b mod P (reflected), zlib multmodp
const fn multmodp(a: u32, mut b: u32) -> u32 {
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
static X2N: [u32; 32] = make_x2n();

/// x^(n * 2^k) mod P
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

const LANE: usize = 8192;
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
    let t = &CRC_TABLES;
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

pub fn crc32(crc: u32, buf: &[u8]) -> u32 {
    let t = &CRC_TABLES;
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
    let _ = &X2N;
    crc32_1(c, p)
}
