// SHA-256 / SHA-224 block function (FIPS 180-4), fully unrolled so the
// message schedule and the working variables live in wasm locals.

use crate::{load_be32x16, Md};
use core::ptr::{read_unaligned, write_unaligned};

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

// (the unrolled last rounds leave values that are never read)
#[allow(unused_assignments)]
#[inline(always)]
fn compress(s: &mut [u32; 8], mut w: [u32; 16]) {
    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = *s;
    // Maj(a, b, c) = b ^ ((a ^ b) & (b ^ c)); this round's a ^ b is the next
    // round's b ^ c
    let mut bc = b ^ c;
    macro_rules! wi {
        ($i:expr) => {{
            if $i < 16 {
                w[$i]
            } else {
                let w15 = w[($i + 1) & 15];
                let w2 = w[($i + 14) & 15];
                let s0 = w15.rotate_right(7) ^ w15.rotate_right(18) ^ (w15 >> 3);
                let s1 = w2.rotate_right(17) ^ w2.rotate_right(19) ^ (w2 >> 10);
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
                .wrapping_add($e.rotate_right(6) ^ $e.rotate_right(11) ^ $e.rotate_right(25))
                .wrapping_add($g ^ ($e & ($f ^ $g)))
                .wrapping_add(K[$i])
                .wrapping_add(x);
            let ab = $a ^ $b;
            let t2 = ($a.rotate_right(2) ^ $a.rotate_right(13) ^ $a.rotate_right(22))
                .wrapping_add($b ^ (ab & bc));
            bc = ab;
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
unsafe fn blocks(s: &mut [u32; 8], p: *const u8, n: usize) {
    let mut st = *s;
    for i in 0..n {
        compress(&mut st, load_be32x16(p.add(i * 64)));
    }
    *s = st;
}

pub struct Sha256;
impl Md for Sha256 {
    type S = [u32; 8];
    const BL: usize = 64;
    const PAD: usize = 8;
    const LE: bool = false;
    #[inline(always)]
    unsafe fn load(p: *const u8) -> Self::S {
        read_unaligned(p as *const [u32; 8])
    }
    #[inline(always)]
    unsafe fn store(p: *mut u8, s: &Self::S) {
        write_unaligned(p as *mut [u32; 8], *s)
    }
    #[inline(always)]
    unsafe fn blocks(s: &mut Self::S, p: *const u8, n: usize) {
        blocks(s, p, n);
    }
    #[inline(always)]
    unsafe fn encode(s: &Self::S, out: *mut u8) {
        for i in 0..8 {
            write_unaligned(out.add(i * 4) as *mut u32, s[i].to_be());
        }
    }
}
