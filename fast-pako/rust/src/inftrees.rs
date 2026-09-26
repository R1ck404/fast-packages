// Port of pako/lib/zlib/inftrees.js (zlib inftrees.c). Same acceptance rules
// (over-subscribed sets rejected, incomplete sets only allowed for a single
// 1-bit LENS/DISTS code) and the same entry format:
//   bits << 24 | op << 16 | val
// The root table size is a free parameter (it only changes speed, never
// which streams decode or how).

pub const CODES: u8 = 0;
pub const LENS: u8 = 1;
pub const DISTS: u8 = 2;
const MAXBITS: usize = 15;

static LBASE: [u16; 31] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0];
static LEXT: [u8; 31] = [16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78];
static DBASE: [u16; 32] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 0, 0,
];
static DEXT: [u8; 32] = [16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 64, 64];

/// Returns 0 on success (bits updated), -1 for an invalid set of lengths.
pub fn inflate_table(ty: u8, lens: &[u16], codes: usize, table: &mut [u32], work: &mut [u16], bits: &mut u32) -> i32 {
    let mut count = [0u16; MAXBITS + 1];
    let mut offs = [0u16; MAXBITS + 1];
    for sym in 0..codes {
        count[lens[sym] as usize] += 1;
    }
    let mut root = *bits as usize;
    let mut max = MAXBITS;
    while max >= 1 {
        if count[max] != 0 {
            break;
        }
        max -= 1;
    }
    if root > max {
        root = max;
    }
    if max == 0 {
        table[0] = (1 << 24) | (64 << 16);
        table[1] = (1 << 24) | (64 << 16);
        *bits = 1;
        return 0;
    }
    let mut min = 1;
    while min < max {
        if count[min] != 0 {
            break;
        }
        min += 1;
    }
    if root < min {
        root = min;
    }
    let mut left: i32 = 1;
    for len in 1..=MAXBITS {
        left <<= 1;
        left -= count[len] as i32;
        if left < 0 {
            return -1;
        }
    }
    if left > 0 && (ty == CODES || max != 1) {
        return -1;
    }
    offs[1] = 0;
    for len in 1..MAXBITS {
        offs[len + 1] = offs[len] + count[len];
    }
    for sym in 0..codes {
        let l = lens[sym] as usize;
        if l != 0 {
            work[offs[l] as usize] = sym as u16;
            offs[l] += 1;
        }
    }
    let (base, extra, mat): (&[u16], &[u8], u32) = match ty {
        CODES => (&[][..], &[][..], 20),
        LENS => (&LBASE[..], &LEXT[..], 257),
        _ => (&DBASE[..], &DEXT[..], 0),
    };
    let mut huff: u32 = 0;
    let mut sym: usize = 0;
    let mut len: usize = min;
    let mut next: usize = 0;
    let mut curr: usize = root;
    let mut drop: usize = 0;
    let mut low: i64 = -1;
    let mut used: usize = 1 << root;
    let mask: u32 = (used - 1) as u32;
    let _ = used;
    loop {
        let here_bits = (len - drop) as u32;
        let w = work[sym] as u32;
        let (here_op, here_val): (u32, u32) = if w + 1 < mat {
            (0, w)
        } else if w >= mat {
            (extra[(w - mat) as usize] as u32, base[(w - mat) as usize] as u32)
        } else {
            (32 + 64, 0)
        };
        let entry = (here_bits << 24) | (here_op << 16) | here_val;
        let incr = 1u32 << (len - drop);
        let mut fill = 1u32 << curr;
        let min_fill = fill;
        loop {
            fill -= incr;
            table[next + (huff >> drop) as usize + fill as usize] = entry;
            if fill == 0 {
                break;
            }
        }
        let mut incr = 1u32 << (len - 1);
        while huff & incr != 0 {
            incr >>= 1;
        }
        if incr != 0 {
            huff &= incr - 1;
            huff += incr;
        } else {
            huff = 0;
        }
        sym += 1;
        count[len] -= 1;
        if count[len] == 0 {
            if len == max {
                break;
            }
            len = lens[work[sym] as usize] as usize;
        }
        if len > root && (huff & mask) as i64 != low {
            if drop == 0 {
                drop = root;
            }
            next += min_fill as usize;
            curr = len - drop;
            let mut left: i32 = 1 << curr;
            while curr + drop < max {
                left -= count[curr + drop] as i32;
                if left <= 0 {
                    break;
                }
                curr += 1;
                left <<= 1;
            }
            used += 1 << curr;
            low = (huff & mask) as i64;
            table[low as usize] = ((root as u32) << 24) | ((curr as u32) << 16) | (next as u32);
        }
    }
    if huff != 0 {
        table[next + huff as usize] = (((len - drop) as u32) << 24) | (64 << 16);
    }
    *bits = root as u32;
    0
}
