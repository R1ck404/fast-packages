// Decode tables for the fast inflate loop (and the slow path's symbol
// decoding). Built from the same code lengths *after* zlib's inflate_table()
// rules accepted them, so validity is decided by zlib's rules; these tables
// only change speed.
//
// entry layout (u32):
//   literal : LIT | lit << 8 | cwlen
//   length  : base << 16 | cwlen << 8 | (cwlen + extra)
//   distance: base << 16 | cwlen << 8 | (cwlen + extra)
//   subtable: EXC | SUB | offset << 16 | subbits << 8 | rootbits
//   EOB     : EXC | EOB | cwlen
//   invalid : EXC | cwlen (never consumed by the fast loop; cwlen is the
//             length zlib's table gives that code: the symbol's own length
//             for symbols 286/287 and 30/31, 1 for the gaps of the only
//             incomplete codes zlib accepts)
// LIT is tested first; EXC/SUB/EOB are only meaningful when LIT is clear.

pub const LIT: u32 = 1 << 31;
pub const EXC: u32 = 1 << 15;
pub const SUB: u32 = 1 << 14;
pub const EOB: u32 = 1 << 13;

pub const LBITS: u32 = 11;
pub const DBITS: u32 = 8;
pub const LSIZE: usize = 8192;
pub const DSIZE: usize = 4352;
pub const TSIZE: usize = LSIZE + DSIZE;

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
        EXC | clen
    }
}

#[inline(always)]
fn dist_entry(sym: usize, clen: u32) -> u32 {
    if sym < 30 {
        ((DBASE[sym] as u32) << 16) | (clen << 8) | (clen + DEXTRA[sym] as u32)
    } else {
        EXC | clen
    }
}

#[inline(always)]
fn reverse(code: u32, len: u32) -> u32 {
    code.reverse_bits() >> (32 - len)
}

/// Histogram of code lengths (index 0 counts unused symbols).
pub fn count_lens(lens: &[u16]) -> [u16; 16] {
    // two interleaved histograms: consecutive equal lengths do not serialize
    // on the same counter
    let mut a = [0u16; 16];
    let mut b = [0u16; 16];
    let mut it = lens.chunks_exact(2);
    for p in &mut it {
        a[(p[0] & 15) as usize] += 1;
        b[(p[1] & 15) as usize] += 1;
    }
    for &l in it.remainder() {
        a[(l & 15) as usize] += 1;
    }
    for i in 0..16 {
        a[i] += b[i];
    }
    a
}

/// Build a fast table for `lens[0..n]` (litlen = true for literal/length);
/// `count` = count_lens(&lens[..n]). The lengths must have passed zlib's
/// checks (not over-subscribed; if incomplete, only a single code of length
/// 1 or no codes at all).
pub fn build(lens: &[u16], n: usize, count: &[u16; 16], litlen: bool, table: &mut [u32]) {
    let root = if litlen { LBITS } else { DBITS };
    let rsize = 1usize << root;
    let entry = |s: usize, l: u32| if litlen { lit_entry(s, l) } else { dist_entry(s, l) };
    // symbols sorted by (length, symbol) = canonical code order
    let mut offs = [0u16; 16];
    for len in 1..15 {
        offs[len + 1] = offs[len] + count[len];
    }
    let total = (offs[15] + count[15]) as usize;
    let mut sorted = [0u16; 288];
    for (s, &l) in lens[..n].iter().enumerate() {
        if l != 0 {
            let o = &mut offs[l as usize];
            sorted[*o as usize] = s as u16;
            *o += 1;
        }
    }
    let mut left: i32 = 1;
    for len in 1..16 {
        left = (left << 1) - count[len] as i32;
    }
    let t = table.as_mut_ptr();
    let mut code: u32 = 0; // canonical code (MSB-first) of sorted[i]
    let mut i = 0usize;
    let mut len: u32 = 1;
    unsafe {
        if left != 0 {
            // incomplete (only one 1-bit code, or none): gaps decode as
            // invalid codes of length 1, like zlib's table
            for e in table[..rsize].iter_mut() {
                *e = EXC | 1;
            }
            while i < total {
                let s = *sorted.get_unchecked(i) as usize;
                let l = *lens.get_unchecked(s) as u32;
                code <<= l - len;
                len = l;
                let e = entry(s, l);
                let mut k = reverse(code, l) as usize;
                while k < rsize {
                    *t.add(k) = e;
                    k += 1usize << l;
                }
                code += 1;
                i += 1;
            }
            return;
        }
        // Complete code, codes that fit the root table: the table is grown
        // by doubling (copying the filled prefix) as the code length grows,
        // and each code is written once at its bit-reversed index. Every
        // index ends up with the entry of the code matching its low bits.
        // (the prefix below the shortest code length holds no entries yet, so
        // the table starts at that size without copying)
        let mut filled = 0usize;
        while i < total {
            let s = *sorted.get_unchecked(i) as usize;
            let l = *lens.get_unchecked(s) as u32;
            if l > root {
                break;
            }
            if filled == 0 {
                filled = 1usize << l;
            }
            while filled < (1usize << l) {
                core::ptr::copy_nonoverlapping(t, t.add(filled), filled);
                filled *= 2;
            }
            code <<= l - len;
            len = l;
            *t.add(reverse(code, l) as usize) = entry(s, l);
            code += 1;
            i += 1;
        }
        if filled == 0 {
            filled = rsize; // only long codes: every root entry is a subtable link
        }
        while filled < rsize {
            core::ptr::copy_nonoverlapping(t, t.add(filled), filled);
            filled *= 2;
        }
        // longer codes: one subtable per root prefix. In canonical order the
        // codes sharing a prefix are contiguous and their lengths ascend, so
        // the last one of a run gives the subtable size.
        let mut free = rsize;
        while i < total {
            let s0 = *sorted.get_unchecked(i) as usize;
            let l0 = *lens.get_unchecked(s0) as u32;
            code <<= l0 - len;
            len = l0;
            let prefix = code >> (l0 - root);
            // find the run end and its longest code
            let mut j = i;
            let mut c = code;
            let mut l = l0;
            let mut maxl;
            loop {
                maxl = l;
                j += 1;
                if j >= total {
                    break;
                }
                let ln = *lens.get_unchecked(*sorted.get_unchecked(j) as usize) as u32;
                let cn = (c + 1) << (ln - l);
                if cn >> (ln - root) != prefix {
                    break;
                }
                c = cn;
                l = ln;
            }
            let sb = maxl - root;
            let size = 1usize << sb;
            let base = free;
            free += size;
            *t.add(reverse(prefix, root) as usize) = EXC | SUB | ((base as u32) << 16) | (sb << 8) | root;
            // fill the run (a complete code covers the whole subtable)
            while i < j {
                let s = *sorted.get_unchecked(i) as usize;
                let l = *lens.get_unchecked(s) as u32;
                code <<= l - len;
                len = l;
                let clen = l - root;
                let e = entry(s, clen);
                let mut k = (reverse(code, l) >> root) as usize;
                let step = 1usize << clen;
                while k < size {
                    *t.add(base + k) = e;
                    k += step;
                }
                code += 1;
                i += 1;
            }
        }
    }
}
