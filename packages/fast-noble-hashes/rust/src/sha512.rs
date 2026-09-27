// SHA-512 family block function (FIPS 180-4) on native i64, fully unrolled.
// SHA-384, SHA-512/224 and SHA-512/256 differ only in IV and output length,
// which the JS side supplies.

use crate::{load_be64x16, Md};
use core::ptr::{read_unaligned, write_unaligned};

const K: [u64; 80] = [
    0x428a2f98d728ae22, 0x7137449123ef65cd, 0xb5c0fbcfec4d3b2f, 0xe9b5dba58189dbbc,
    0x3956c25bf348b538, 0x59f111f1b605d019, 0x923f82a4af194f9b, 0xab1c5ed5da6d8118,
    0xd807aa98a3030242, 0x12835b0145706fbe, 0x243185be4ee4b28c, 0x550c7dc3d5ffb4e2,
    0x72be5d74f27b896f, 0x80deb1fe3b1696b1, 0x9bdc06a725c71235, 0xc19bf174cf692694,
    0xe49b69c19ef14ad2, 0xefbe4786384f25e3, 0x0fc19dc68b8cd5b5, 0x240ca1cc77ac9c65,
    0x2de92c6f592b0275, 0x4a7484aa6ea6e483, 0x5cb0a9dcbd41fbd4, 0x76f988da831153b5,
    0x983e5152ee66dfab, 0xa831c66d2db43210, 0xb00327c898fb213f, 0xbf597fc7beef0ee4,
    0xc6e00bf33da88fc2, 0xd5a79147930aa725, 0x06ca6351e003826f, 0x142929670a0e6e70,
    0x27b70a8546d22ffc, 0x2e1b21385c26c926, 0x4d2c6dfc5ac42aed, 0x53380d139d95b3df,
    0x650a73548baf63de, 0x766a0abb3c77b2a8, 0x81c2c92e47edaee6, 0x92722c851482353b,
    0xa2bfe8a14cf10364, 0xa81a664bbc423001, 0xc24b8b70d0f89791, 0xc76c51a30654be30,
    0xd192e819d6ef5218, 0xd69906245565a910, 0xf40e35855771202a, 0x106aa07032bbd1b8,
    0x19a4c116b8d2d0c8, 0x1e376c085141ab53, 0x2748774cdf8eeb99, 0x34b0bcb5e19b48a8,
    0x391c0cb3c5c95a63, 0x4ed8aa4ae3418acb, 0x5b9cca4f7763e373, 0x682e6ff3d6b2b8a3,
    0x748f82ee5defb2fc, 0x78a5636f43172f60, 0x84c87814a1f0ab72, 0x8cc702081a6439ec,
    0x90befffa23631e28, 0xa4506cebde82bde9, 0xbef9a3f7b2c67915, 0xc67178f2e372532b,
    0xca273eceea26619c, 0xd186b8c721c0c207, 0xeada7dd6cde0eb1e, 0xf57d4f7fee6ed178,
    0x06f067aa72176fba, 0x0a637dc5a2c898a6, 0x113f9804bef90dae, 0x1b710b35131c471b,
    0x28db77f523047d84, 0x32caab7b40c72493, 0x3c9ebe0a15c9bebc, 0x431d67c49c100d4c,
    0x4cc5d4becb3e42b6, 0x597f299cfc657e2a, 0x5fcb6fab3ad6faec, 0x6c44198c4a475817,
];

// (the unrolled last rounds leave values that are never read)
#[allow(unused_assignments)]
#[inline(always)]
fn compress(s: &mut [u64; 8], mut w: [u64; 16]) {
    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = *s;
    macro_rules! wi {
        ($i:expr) => {{
            if $i < 16 {
                w[$i]
            } else {
                let w15 = w[($i + 1) & 15];
                let w2 = w[($i + 14) & 15];
                let s0 = w15.rotate_right(1) ^ w15.rotate_right(8) ^ (w15 >> 7);
                let s1 = w2.rotate_right(19) ^ w2.rotate_right(61) ^ (w2 >> 6);
                let v = w[$i & 15]
                    .wrapping_add(s0)
                    .wrapping_add(w[($i + 9) & 15])
                    .wrapping_add(s1);
                w[$i & 15] = v;
                v
            }
        }};
    }
    macro_rules! rnd {
        ($a:ident, $b:ident, $c:ident, $d:ident, $e:ident, $f:ident, $g:ident, $h:ident, $i:expr) => {
            let x = wi!($i);
            let t1 = $h
                .wrapping_add($e.rotate_right(14) ^ $e.rotate_right(18) ^ $e.rotate_right(41))
                .wrapping_add(($e & $f) ^ (!$e & $g))
                .wrapping_add(K[$i])
                .wrapping_add(x);
            let t2 = ($a.rotate_right(28) ^ $a.rotate_right(34) ^ $a.rotate_right(39))
                .wrapping_add(($a & $b) ^ ($a & $c) ^ ($b & $c));
            $d = $d.wrapping_add(t1);
            $h = t1.wrapping_add(t2);
        };
    }
    macro_rules! r8 {
        ($i:expr) => {
            rnd!(a, b, c, d, e, f, g, h, $i);
            rnd!(h, a, b, c, d, e, f, g, $i + 1);
            rnd!(g, h, a, b, c, d, e, f, $i + 2);
            rnd!(f, g, h, a, b, c, d, e, $i + 3);
            rnd!(e, f, g, h, a, b, c, d, $i + 4);
            rnd!(d, e, f, g, h, a, b, c, $i + 5);
            rnd!(c, d, e, f, g, h, a, b, $i + 6);
            rnd!(b, c, d, e, f, g, h, a, $i + 7);
        };
    }
    r8!(0);
    r8!(8);
    r8!(16);
    r8!(24);
    r8!(32);
    r8!(40);
    r8!(48);
    r8!(56);
    r8!(64);
    r8!(72);
    s[0] = s[0].wrapping_add(a);
    s[1] = s[1].wrapping_add(b);
    s[2] = s[2].wrapping_add(c);
    s[3] = s[3].wrapping_add(d);
    s[4] = s[4].wrapping_add(e);
    s[5] = s[5].wrapping_add(f);
    s[6] = s[6].wrapping_add(g);
    s[7] = s[7].wrapping_add(h);
}

/// `n` consecutive blocks at `p`; one copy of the unrolled rounds, with the
/// state in locals across blocks.
#[inline(never)]
unsafe fn blocks(s: &mut [u64; 8], p: *const u8, n: usize) {
    let mut st = *s;
    for i in 0..n {
        compress(&mut st, load_be64x16(p.add(i * 128)));
    }
    *s = st;
}

pub struct Sha512;
impl Md for Sha512 {
    type S = [u64; 8];
    const BL: usize = 128;
    const PAD: usize = 16;
    const LE: bool = false;
    // State in memory as (lo, hi) u32 pairs = native little-endian u64s, which
    // is how the JS side writes noble's (Ah, Al, Bh, Bl, ...) fields.
    #[inline(always)]
    unsafe fn load(p: *const u8) -> Self::S {
        read_unaligned(p as *const [u64; 8])
    }
    #[inline(always)]
    unsafe fn store(p: *mut u8, s: &Self::S) {
        write_unaligned(p as *mut [u64; 8], *s)
    }
    #[inline(always)]
    unsafe fn blocks(s: &mut Self::S, p: *const u8, n: usize) {
        blocks(s, p, n);
    }
    #[inline(always)]
    unsafe fn encode(s: &Self::S, out: *mut u8) {
        for i in 0..8 {
            write_unaligned(out.add(i * 8) as *mut u64, s[i].to_be());
        }
    }
}
