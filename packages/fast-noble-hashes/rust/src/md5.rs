// MD5 block function (RFC 1321), fully unrolled. Little-endian words, so the
// block loads are plain i32 loads.

use crate::Md;
use core::ptr::{read_unaligned, write_unaligned};

#[inline(always)]
fn compress(s: &mut [u32; 4], x: [u32; 16]) {
    let [mut a, mut b, mut c, mut d] = *s;
    macro_rules! step {
        ($f:expr, $a:ident, $b:ident, $c:ident, $d:ident, $x:expr, $k:expr, $s:expr) => {
            $a = $b.wrapping_add(
                $a.wrapping_add($f($b, $c, $d))
                    .wrapping_add($k)
                    .wrapping_add($x)
                    .rotate_left($s),
            );
        };
    }
    let f = |b: u32, c: u32, d: u32| (b & c) ^ (!b & d);
    let g = |b: u32, c: u32, d: u32| (d & b) ^ (!d & c);
    let h = |b: u32, c: u32, d: u32| b ^ c ^ d;
    let i = |b: u32, c: u32, d: u32| c ^ (b | !d);

    step!(f, a, b, c, d, x[0], 0xd76aa478, 7);
    step!(f, d, a, b, c, x[1], 0xe8c7b756, 12);
    step!(f, c, d, a, b, x[2], 0x242070db, 17);
    step!(f, b, c, d, a, x[3], 0xc1bdceee, 22);
    step!(f, a, b, c, d, x[4], 0xf57c0faf, 7);
    step!(f, d, a, b, c, x[5], 0x4787c62a, 12);
    step!(f, c, d, a, b, x[6], 0xa8304613, 17);
    step!(f, b, c, d, a, x[7], 0xfd469501, 22);
    step!(f, a, b, c, d, x[8], 0x698098d8, 7);
    step!(f, d, a, b, c, x[9], 0x8b44f7af, 12);
    step!(f, c, d, a, b, x[10], 0xffff5bb1, 17);
    step!(f, b, c, d, a, x[11], 0x895cd7be, 22);
    step!(f, a, b, c, d, x[12], 0x6b901122, 7);
    step!(f, d, a, b, c, x[13], 0xfd987193, 12);
    step!(f, c, d, a, b, x[14], 0xa679438e, 17);
    step!(f, b, c, d, a, x[15], 0x49b40821, 22);

    step!(g, a, b, c, d, x[1], 0xf61e2562, 5);
    step!(g, d, a, b, c, x[6], 0xc040b340, 9);
    step!(g, c, d, a, b, x[11], 0x265e5a51, 14);
    step!(g, b, c, d, a, x[0], 0xe9b6c7aa, 20);
    step!(g, a, b, c, d, x[5], 0xd62f105d, 5);
    step!(g, d, a, b, c, x[10], 0x02441453, 9);
    step!(g, c, d, a, b, x[15], 0xd8a1e681, 14);
    step!(g, b, c, d, a, x[4], 0xe7d3fbc8, 20);
    step!(g, a, b, c, d, x[9], 0x21e1cde6, 5);
    step!(g, d, a, b, c, x[14], 0xc33707d6, 9);
    step!(g, c, d, a, b, x[3], 0xf4d50d87, 14);
    step!(g, b, c, d, a, x[8], 0x455a14ed, 20);
    step!(g, a, b, c, d, x[13], 0xa9e3e905, 5);
    step!(g, d, a, b, c, x[2], 0xfcefa3f8, 9);
    step!(g, c, d, a, b, x[7], 0x676f02d9, 14);
    step!(g, b, c, d, a, x[12], 0x8d2a4c8a, 20);

    step!(h, a, b, c, d, x[5], 0xfffa3942, 4);
    step!(h, d, a, b, c, x[8], 0x8771f681, 11);
    step!(h, c, d, a, b, x[11], 0x6d9d6122, 16);
    step!(h, b, c, d, a, x[14], 0xfde5380c, 23);
    step!(h, a, b, c, d, x[1], 0xa4beea44, 4);
    step!(h, d, a, b, c, x[4], 0x4bdecfa9, 11);
    step!(h, c, d, a, b, x[7], 0xf6bb4b60, 16);
    step!(h, b, c, d, a, x[10], 0xbebfbc70, 23);
    step!(h, a, b, c, d, x[13], 0x289b7ec6, 4);
    step!(h, d, a, b, c, x[0], 0xeaa127fa, 11);
    step!(h, c, d, a, b, x[3], 0xd4ef3085, 16);
    step!(h, b, c, d, a, x[6], 0x04881d05, 23);
    step!(h, a, b, c, d, x[9], 0xd9d4d039, 4);
    step!(h, d, a, b, c, x[12], 0xe6db99e5, 11);
    step!(h, c, d, a, b, x[15], 0x1fa27cf8, 16);
    step!(h, b, c, d, a, x[2], 0xc4ac5665, 23);

    step!(i, a, b, c, d, x[0], 0xf4292244, 6);
    step!(i, d, a, b, c, x[7], 0x432aff97, 10);
    step!(i, c, d, a, b, x[14], 0xab9423a7, 15);
    step!(i, b, c, d, a, x[5], 0xfc93a039, 21);
    step!(i, a, b, c, d, x[12], 0x655b59c3, 6);
    step!(i, d, a, b, c, x[3], 0x8f0ccc92, 10);
    step!(i, c, d, a, b, x[10], 0xffeff47d, 15);
    step!(i, b, c, d, a, x[1], 0x85845dd1, 21);
    step!(i, a, b, c, d, x[8], 0x6fa87e4f, 6);
    step!(i, d, a, b, c, x[15], 0xfe2ce6e0, 10);
    step!(i, c, d, a, b, x[6], 0xa3014314, 15);
    step!(i, b, c, d, a, x[13], 0x4e0811a1, 21);
    step!(i, a, b, c, d, x[4], 0xf7537e82, 6);
    step!(i, d, a, b, c, x[11], 0xbd3af235, 10);
    step!(i, c, d, a, b, x[2], 0x2ad7d2bb, 15);
    step!(i, b, c, d, a, x[9], 0xeb86d391, 21);

    s[0] = s[0].wrapping_add(a);
    s[1] = s[1].wrapping_add(b);
    s[2] = s[2].wrapping_add(c);
    s[3] = s[3].wrapping_add(d);
}

/// `n` consecutive blocks at `p`; one copy of the unrolled rounds, with the
/// state in locals across blocks.
#[inline(never)]
unsafe fn blocks(s: &mut [u32; 4], p: *const u8, n: usize) {
    let mut st = *s;
    for i in 0..n {
        compress(&mut st, read_unaligned(p.add(i * 64) as *const [u32; 16]));
    }
    *s = st;
}

pub struct Md5;
impl Md for Md5 {
    type S = [u32; 4];
    const BL: usize = 64;
    const PAD: usize = 8;
    const LE: bool = true;
    #[inline(always)]
    unsafe fn load(p: *const u8) -> Self::S {
        read_unaligned(p as *const [u32; 4])
    }
    #[inline(always)]
    unsafe fn store(p: *mut u8, s: &Self::S) {
        write_unaligned(p as *mut [u32; 4], *s)
    }
    #[inline(always)]
    unsafe fn blocks(s: &mut Self::S, p: *const u8, n: usize) {
        blocks(s, p, n);
    }
    #[inline(always)]
    unsafe fn encode(s: &Self::S, out: *mut u8) {
        write_unaligned(out as *mut [u32; 4], *s);
    }
}
