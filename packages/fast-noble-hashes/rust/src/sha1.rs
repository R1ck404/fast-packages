// SHA-1 block function (RFC 3174), fully unrolled.

use crate::{load_be32x16, Md};
use core::ptr::{read_unaligned, write_unaligned};

// (the unrolled last rounds leave values that are never read)
#[allow(unused_assignments)]
#[inline(always)]
fn compress(s: &mut [u32; 5], mut w: [u32; 16]) {
    let [mut a, mut b, mut c, mut d, mut e] = *s;
    macro_rules! wi {
        ($i:expr) => {{
            if $i < 16 {
                w[$i]
            } else {
                let v = (w[($i + 13) & 15] ^ w[($i + 8) & 15] ^ w[($i + 2) & 15] ^ w[$i & 15])
                    .rotate_left(1);
                w[$i & 15] = v;
                v
            }
        }};
    }
    macro_rules! rnd {
        ($a:ident, $b:ident, $c:ident, $d:ident, $e:ident, $i:expr) => {
            let x = wi!($i);
            let (f, k) = if $i < 20 {
                (($b & $c) ^ (!$b & $d), 0x5a827999u32)
            } else if $i < 40 {
                ($b ^ $c ^ $d, 0x6ed9eba1)
            } else if $i < 60 {
                (($b & $c) ^ ($b & $d) ^ ($c & $d), 0x8f1bbcdc)
            } else {
                ($b ^ $c ^ $d, 0xca62c1d6)
            };
            $e = $a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add($e)
                .wrapping_add(k)
                .wrapping_add(x);
            $b = $b.rotate_left(30);
        };
    }
    macro_rules! r5 {
        ($i:expr) => {
            rnd!(a, b, c, d, e, $i);
            rnd!(e, a, b, c, d, $i + 1);
            rnd!(d, e, a, b, c, $i + 2);
            rnd!(c, d, e, a, b, $i + 3);
            rnd!(b, c, d, e, a, $i + 4);
        };
    }
    r5!(0);
    r5!(5);
    r5!(10);
    r5!(15);
    r5!(20);
    r5!(25);
    r5!(30);
    r5!(35);
    r5!(40);
    r5!(45);
    r5!(50);
    r5!(55);
    r5!(60);
    r5!(65);
    r5!(70);
    r5!(75);
    s[0] = s[0].wrapping_add(a);
    s[1] = s[1].wrapping_add(b);
    s[2] = s[2].wrapping_add(c);
    s[3] = s[3].wrapping_add(d);
    s[4] = s[4].wrapping_add(e);
}

/// `n` consecutive blocks at `p`; one copy of the unrolled rounds, with the
/// state in locals across blocks.
#[inline(never)]
unsafe fn blocks(s: &mut [u32; 5], p: *const u8, n: usize) {
    let mut st = *s;
    for i in 0..n {
        compress(&mut st, load_be32x16(p.add(i * 64)));
    }
    *s = st;
}

pub struct Sha1;
impl Md for Sha1 {
    type S = [u32; 5];
    const BL: usize = 64;
    const PAD: usize = 8;
    const LE: bool = false;
    #[inline(always)]
    unsafe fn load(p: *const u8) -> Self::S {
        read_unaligned(p as *const [u32; 5])
    }
    #[inline(always)]
    unsafe fn store(p: *mut u8, s: &Self::S) {
        write_unaligned(p as *mut [u32; 5], *s)
    }
    #[inline(always)]
    unsafe fn blocks(s: &mut Self::S, p: *const u8, n: usize) {
        blocks(s, p, n);
    }
    #[inline(always)]
    unsafe fn encode(s: &Self::S, out: *mut u8) {
        for i in 0..5 {
            write_unaligned(out.add(i * 4) as *mut u32, s[i].to_be());
        }
    }
}
