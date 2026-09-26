// Decode tables for the fast inflate loop. Built from the same code lengths
// *after* zlib's inflate_table() accepted them, so validity is decided by
// zlib's rules; these tables only change speed.
//
// entry layout (u32):
//   literal : LIT | [DBL | lit2 << 16] | lit1 << 8 | consumed bits
//             (DBL: the root entry decodes two literals at once)
//   length  : base << 16 | cwlen << 8 | (cwlen + extra)
//   distance: base << 16 | cwlen << 8 | (cwlen + extra)
//   subtable: EXC | SUB | offset << 16 | subbits << 8 | rootbits
//   EOB     : EXC | EOB | cwlen
//   invalid : EXC (never consumed by the fast loop)
// LIT is tested first; EXC/SUB/EOB are only meaningful when LIT is clear.

pub const LIT: u32 = 1 << 31;
pub const DBL: u32 = 1 << 30;
pub const EXC: u32 = 1 << 15;
pub const SUB: u32 = 1 << 14;
pub const EOB: u32 = 1 << 13;

pub const LBITS: u32 = 11;
pub const DBITS: u32 = 8;
pub const LSIZE: usize = 8192;
pub const DSIZE: usize = 4352;

static LBASE: [u16; 29] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
static LEXTRA: [u8; 29] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
static DBASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
static DEXTRA: [u8; 30] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

#[inline(always)]
fn lit_entry(sym: usize, clen: u32) -> u32 {
    if sym < 256 {
        LIT | ((sym as u32) << 8) | clen
    } else if sym == 256 {
        EXC | EOB | clen
    } else if sym < 286 {
        let i = sym - 257;
        ((LBASE[i] as u32) << 16) | (clen << 8) | (clen + LEXTRA[i] as u32)
    } else {
        EXC
    }
}

#[inline(always)]
fn dist_entry(sym: usize, clen: u32) -> u32 {
    if sym < 30 {
        ((DBASE[sym] as u32) << 16) | (clen << 8) | (clen + DEXTRA[sym] as u32)
    } else {
        EXC
    }
}

fn reverse(code: u32, len: u32) -> u32 {
    code.reverse_bits() >> (32 - len)
}

/// Build a fast table for `lens[0..n]` (litlen = true for literal/length).
pub fn build(lens: &[u16], n: usize, litlen: bool, table: &mut [u32]) {
    let root = if litlen { LBITS } else { DBITS };
    let rsize = 1usize << root;
    for e in table[..rsize].iter_mut() {
        *e = EXC;
    }
    let mut count = [0u32; 16];
    for s in 0..n {
        count[lens[s] as usize] += 1;
    }
    count[0] = 0;
    let mut next = [0u32; 16];
    let mut code = 0u32;
    for len in 1..16 {
        code = (code + count[len - 1]) << 1;
        next[len] = code;
    }
    let mut sub_max = [0u8; 4096];
    let mut codes = [0u32; 320];
    let mut any_long = false;
    for s in 0..n {
        let len = lens[s] as u32;
        if len == 0 {
            continue;
        }
        let rev = reverse(next[len as usize], len);
        next[len as usize] += 1;
        codes[s] = rev;
        if len <= root {
            let e = if litlen { lit_entry(s, len) } else { dist_entry(s, len) };
            let mut i = rev as usize;
            let step = 1usize << len;
            while i < rsize {
                table[i] = e;
                i += step;
            }
        } else {
            any_long = true;
            let p = (rev as usize) & (rsize - 1);
            if sub_max[p] < len as u8 {
                sub_max[p] = len as u8;
            }
        }
    }
    if any_long {
        let mut sub_off = [0u16; 4096];
        let mut free = rsize;
        for p in 0..rsize {
            let m = sub_max[p] as u32;
            if m == 0 {
                continue;
            }
            let sb = m - root;
            let size = 1usize << sb;
            sub_off[p] = free as u16;
            for e in table[free..free + size].iter_mut() {
                *e = EXC;
            }
            table[p] = EXC | SUB | ((free as u32) << 16) | (sb << 8) | root;
            free += size;
        }
        for s in 0..n {
            let len = lens[s] as u32;
            if len <= root {
                continue;
            }
            let rev = codes[s];
            let p = (rev as usize) & (rsize - 1);
            let sb = sub_max[p] as u32 - root;
            let off = sub_off[p] as usize;
            let clen = len - root;
            let e = if litlen { lit_entry(s, clen) } else { dist_entry(s, clen) };
            let mut i = (rev >> root) as usize;
            let step = 1usize << clen;
            let size = 1usize << sb;
            while i < size {
                table[off + i] = e;
                i += step;
            }
        }
    }
    if litlen {
        // pair literals: a root entry whose first code is a literal and whose
        // remaining index bits fully determine a second literal
        let mut single = [0u32; 4096];
        single[..rsize].copy_from_slice(&table[..rsize]);
        for i in 0..rsize {
            let e1 = single[i];
            if e1 & LIT == 0 {
                continue;
            }
            let l1 = e1 & 0xff;
            let e2 = single[i >> l1];
            if e2 & LIT == 0 || e2 & DBL != 0 {
                continue;
            }
            let l2 = e2 & 0xff;
            if l1 + l2 > root {
                continue;
            }
            table[i] = LIT | DBL | (((e2 >> 8) & 0xff) << 16) | (e1 & 0xff00) | (l1 + l2);
        }
    }
}
