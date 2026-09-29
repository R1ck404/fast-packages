// Small raw-deflate decoder that unpacks the main fastzlib module on first
// use. fastzlib.wasm is embedded deflate-compressed (about 40% of its size,
// and so is its base64); this module is embedded as plain base64.
//
// It only decodes what build.mjs produces (and checks at build time):
// dynamic-Huffman blocks with codes of at most 11 bits, so one table lookup
// decodes any symbol. The input must be followed by 8 zero bytes. Nothing
// outside the given buffers (+8) is read or written, and malformed input
// only yields a wrong length (the caller checks it).
//
// It runs once, in V8's baseline compiler (Liftoff): the bit buffer lives in
// locals (no pointer to it escapes) and one refill covers a whole
// length/distance pair.

#![no_std]

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

/// longest code (and table bits)
const TB: u32 = 11;

/// decode table for lens (sym << 4 | len; 0 = no code); false if a length
/// is too long
fn build(tab: &mut [u16; 1 << TB], lens: &[u8]) -> bool {
    let mut count = [0u16; 16];
    for &l in lens {
        count[(l & 15) as usize] += 1;
    }
    count[0] = 0;
    let mut next = [0u16; 16];
    let mut code = 0u16;
    for l in 1..16 {
        code = (code + count[l - 1]) << 1;
        next[l] = code;
    }
    *tab = [0; 1 << TB];
    for (s, &l) in lens.iter().enumerate() {
        let l = (l & 15) as u32;
        if l == 0 {
            continue;
        }
        if l > TB {
            return false;
        }
        let c = next[l as usize];
        next[l as usize] += 1;
        let mut i = ((c as u32).reverse_bits() >> (32 - l)) as usize;
        while i < 1 << TB {
            tab[i] = ((s as u16) << 4) | l as u16;
            i += 1 << l;
        }
    }
    true
}

static LBASE: [u16; 29] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
static LEXT: [u8; 29] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
static DBASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
static DEXT: [u8; 30] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
static ORDER: [u8; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

static mut LIT: [u16; 1 << TB] = [0; 1 << TB];
static mut DIST: [u16; 1 << TB] = [0; 1 << TB];

/// Decode the text form of the compressed module in place (n characters at
/// p) and return its length in bytes; 8 zero bytes follow. Every two
/// characters of the alphabet (printable ASCII without `"`, `<` and `\`,
/// 92 characters) are a 13-bit value, first character lowest; the values
/// are the bits of the bytes, lowest first (build.mjs encodes).
#[no_mangle]
pub unsafe extern "C" fn text(p: *mut u8, n: usize) -> usize {
    let ix = |c: u8| -> u32 {
        let c = c as u32;
        c - 32 - (c > 0x22) as u32 - (c > 0x3c) as u32 - (c > 0x5c) as u32
    };
    let mut acc = 0u32;
    let mut nb = 0u32;
    let mut o = 0usize;
    let mut i = 0usize;
    while i + 1 < n {
        acc |= (ix(*p.add(i)) + 92 * ix(*p.add(i + 1))) << nb;
        nb += 13;
        while nb >= 8 {
            *p.add(o) = acc as u8;
            o += 1;
            acc >>= 8;
            nb -= 8;
        }
        i += 2;
    }
    core::ptr::write_bytes(p.add(o), 0, 8);
    o
}

/// Decode the raw deflate stream src[..n] into dst[..cap]; returns the
/// decoded length (0 on errors).
#[no_mangle]
#[allow(static_mut_refs)]
pub unsafe extern "C" fn inflate(src: *const u8, n: usize, dst: *mut u8, cap: usize) -> usize {
    let lt = &mut LIT;
    let dt = &mut DIST;
    let end = src.add(n);
    let mut p = src;
    let mut hold: u64 = 0;
    let mut bits: u32 = 0;
    let mut o = 0usize;
    // at least 56 bits in hold afterwards (whole bytes are consumed; the
    // partial byte above them is loaded again, same bits, next time; at the
    // end the padding supplies zeros)
    macro_rules! refill {
        () => {{
            hold |= (p as *const u64).read_unaligned() << bits;
            if p < end {
                p = p.add(((63 - bits) >> 3) as usize);
            }
            bits |= 56;
        }};
    }
    macro_rules! take {
        ($k:expr) => {{
            let k = $k as u32;
            let v = (hold & ((1u64 << k) - 1)) as usize;
            hold >>= k;
            bits -= k;
            v
        }};
    }
    macro_rules! sym {
        ($t:expr) => {{
            let e = $t[(hold & ((1 << TB) - 1)) as usize] as u32;
            let l = e & 15;
            if l == 0 {
                return 0;
            }
            hold >>= l;
            bits -= l;
            (e >> 4) as usize
        }};
    }
    loop {
        refill!();
        let last = take!(1);
        if take!(2) != 2 {
            return 0;
        }
        let nl = take!(5) + 257;
        let nd = take!(5) + 1;
        let nc = take!(4) + 4;
        let mut cl = [0u8; 19];
        for i in 0..nc {
            refill!();
            cl[ORDER[i] as usize] = take!(3) as u8;
        }
        let mut lens = [0u8; 320];
        if !build(lt, &cl) {
            return 0;
        }
        let mut i = 0;
        while i < nl + nd {
            refill!();
            let s = sym!(lt);
            let (rep, val) = match s {
                0..=15 => (1, s as u8),
                16 if i > 0 => (3 + take!(2), lens[i - 1]),
                17 => (3 + take!(3), 0),
                18 => (11 + take!(7), 0),
                _ => return 0,
            };
            if i + rep > nl + nd {
                return 0;
            }
            for _ in 0..rep {
                lens[i] = val;
                i += 1;
            }
        }
        if !build(lt, &lens[..nl]) || !build(dt, &lens[nl..nl + nd]) {
            return 0;
        }
        loop {
            // 56 bits: a length code, its extra bits, a distance code and
            // its extra bits need at most 11 + 5 + 11 + 13
            refill!();
            let s = sym!(lt);
            if s < 256 {
                if o >= cap {
                    return 0;
                }
                *dst.add(o) = s as u8;
                o += 1;
            } else if s == 256 {
                break;
            } else {
                let i = s - 257;
                if i >= 29 {
                    return 0;
                }
                let len = LBASE[i] as usize + take!(LEXT[i]);
                let d = sym!(dt);
                if d >= 30 {
                    return 0;
                }
                let dist = DBASE[d] as usize + take!(DEXT[d]);
                if dist > o || o + len > cap {
                    return 0;
                }
                if dist >= 8 && o + len + 8 <= cap {
                    // 8 bytes at a time (up to 7 more, rewritten later)
                    let mut k = o;
                    while k < o + len {
                        (dst.add(k) as *mut u64).write_unaligned((dst.add(k - dist) as *const u64).read_unaligned());
                        k += 8;
                    }
                } else {
                    for k in o..o + len {
                        *dst.add(k) = *dst.add(k - dist);
                    }
                }
                o += len;
            }
        }
        if last != 0 {
            return o;
        }
    }
}
