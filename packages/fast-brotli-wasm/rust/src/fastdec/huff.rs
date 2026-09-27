// Prefix code reading and decode tables. Port of brotli-decompressor's
// ReadHuffmanCode / BrotliBuild{Simple,CodeLengths,}HuffmanTable with the same
// acceptance rules (anything the original rejects returns None) and the same
// table layout: 8-bit root table, 2nd-level tables appended after it.
// Entries are generic: `u32` = bits | symbol << 16; `u64` ("wide") =
// bits | info[symbol], i.e. the per-symbol decode info (command lengths,
// distance parameters) comes with the lookup. 2nd-level pointers are
// bits | offset << 16 in both.

use super::bits::Br;

pub const MAX_TABLE: usize = 1080; // BROTLI_HUFFMAN_MAX_TABLE_SIZE (alphabet <= 704)

const CL_ORDER: [u8; 18] = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const CL_PREFIX_LEN: [u8; 16] = [2, 2, 2, 3, 2, 2, 2, 4, 2, 2, 2, 3, 2, 2, 2, 4];
const CL_PREFIX_VAL: [u8; 16] = [0, 4, 3, 2, 0, 4, 3, 1, 0, 4, 3, 2, 0, 4, 3, 5];

pub trait Entry: Copy {
    fn sym(bits: u32, sym: u16, info: &[u64]) -> Self;
    fn ptr(bits: u32, off: usize) -> Self;
}
impl Entry for u32 {
    #[inline(always)]
    fn sym(bits: u32, sym: u16, _: &[u64]) -> u32 {
        bits | (sym as u32) << 16
    }
    #[inline(always)]
    fn ptr(bits: u32, off: usize) -> u32 {
        bits | (off as u32) << 16
    }
}
impl Entry for u64 {
    // symbols are < max_symbol <= info.len()
    #[inline(always)]
    fn sym(bits: u32, sym: u16, info: &[u64]) -> u64 {
        bits as u64 | unsafe { *info.get_unchecked(sym as usize) }
    }
    #[inline(always)]
    fn ptr(bits: u32, off: usize) -> u64 {
        (bits | (off as u32) << 16) as u64
    }
}

pub struct Scratch {
    lens: [u8; 720],
    sorted: [u16; 720],
    cl: [u32; 32],
}

impl Scratch {
    pub fn new() -> Scratch {
        Scratch { lens: [0; 720], sorted: [0; 720], cl: [0; 32] }
    }
}

// Decodes one symbol; needs >= 15 valid bits.
#[inline(always)]
pub unsafe fn read_sym(br: &mut Br, t: *const u32) -> u32 {
    let v = br.val;
    let r = (v & 0xff) as usize;
    let mut e = *t.add(r);
    if (e & 0xff) > 8 {
        let nb = (e & 0xff) - 8;
        let idx = r + (e >> 16) as usize + ((v >> 8) as u32 & ((1u32 << nb) - 1)) as usize;
        br.skip(8);
        e = *t.add(idx);
    }
    br.skip(e & 0xff);
    e >> 16
}

// Same on a wide table; returns the whole entry.
#[inline(always)]
pub unsafe fn read_wide(br: &mut Br, t: *const u64) -> u64 {
    let v = br.val;
    let r = (v & 0xff) as usize;
    let mut e = *t.add(r);
    if (e & 0xff) > 8 {
        let nb = (e & 0xff) as u32 - 8;
        let idx = r + ((e >> 16) & 0xffff) as usize + ((v >> 8) as u32 & ((1u32 << nb) - 1)) as usize;
        br.skip(8);
        e = *t.add(idx);
    }
    br.skip((e & 0xff) as u32);
    e
}

#[inline(always)]
fn rev8(x: u32) -> usize {
    (x as u8).reverse_bits() as usize
}

#[inline(always)]
unsafe fn replicate<E: Entry>(t: *mut E, step: usize, mut end: usize, code: E) {
    loop {
        end -= step;
        *t.add(end) = code;
        if end == 0 {
            break;
        }
    }
}

fn next_table_bits(count: &[u16; 16], mut len: u32) -> u32 {
    let mut left: i32 = 1 << (len - 8);
    while len < 15 {
        left -= count[len as usize] as i32;
        if left <= 0 {
            break;
        }
        len += 1;
        left <<= 1;
    }
    len - 8
}

// Canonical table from symbols sorted by (length, symbol). Returns its size.
unsafe fn build<E: Entry>(t: *mut E, sorted: &[u16], count: &mut [u16; 16], info: &[u64]) -> usize {
    let mut max_len = 15u32;
    while count[max_len as usize] == 0 {
        max_len -= 1;
    }
    let mut table_bits = 8;
    let mut table_size = 256usize;
    let mut total_size = table_size;
    if table_bits > max_len {
        table_bits = max_len;
        table_size = 1 << table_bits;
    }
    let mut key = 0u32;
    let mut key_step = 0x80u32;
    let mut bits = 1u32;
    let mut step = 2usize;
    let mut idx = 0usize;
    loop {
        let mut c = count[bits as usize];
        while c != 0 {
            let code = E::sym(bits, *sorted.get_unchecked(idx), info);
            idx += 1;
            replicate(t.add(rev8(key)), step, table_size, code);
            key += key_step;
            c -= 1;
        }
        step <<= 1;
        key_step >>= 1;
        bits += 1;
        if bits > table_bits {
            break;
        }
    }
    while total_size != table_size {
        core::ptr::copy_nonoverlapping(t, t.add(table_size), table_size);
        table_size <<= 1;
    }
    key_step = 1;
    let mut sub_key = 0x100u32;
    let mut sub_key_step = 0x80u32;
    step = 2;
    let mut len = 9;
    let mut table_free = 0usize;
    while len <= max_len {
        while count[len as usize] != 0 {
            if sub_key == 0x100 {
                table_free += table_size;
                table_bits = next_table_bits(count, len);
                table_size = 1 << table_bits;
                total_size += table_size;
                let sk = rev8(key);
                key += key_step;
                *t.add(sk) = E::ptr(table_bits + 8, table_free - sk);
                sub_key = 0;
            }
            let code = E::sym(len - 8, *sorted.get_unchecked(idx), info);
            idx += 1;
            replicate(t.add(table_free + rev8(sub_key)), step, table_size, code);
            sub_key += sub_key_step;
            count[len as usize] -= 1;
        }
        step <<= 1;
        sub_key_step >>= 1;
        len += 1;
    }
    total_size
}

// 5-bit table for the code length code (BrotliBuildCodeLengthsHuffmanTable)
fn build_cl(t: &mut [u32; 32], cl: &[u8; 18], count: &[u16; 16]) {
    let mut sorted = [0u8; 18];
    let mut offset = [0i32; 6];
    let mut symbol: i32 = -1;
    for bits in 1..6 {
        symbol += count[bits] as i32;
        offset[bits] = symbol;
    }
    offset[0] = 17;
    for s in (0..18).rev() {
        let l = cl[s] as usize;
        sorted[offset[l] as usize] = s as u8;
        offset[l] -= 1;
    }
    if offset[0] == 0 {
        let code = (sorted[0] as u32) << 16;
        for e in t.iter_mut() {
            *e = code;
        }
        return;
    }
    let mut key = 0u32;
    let mut key_step = 0x80u32;
    let mut idx = 0usize;
    let mut step = 2usize;
    for bits in 1..6u32 {
        for _ in 0..count[bits as usize] {
            let code = bits | (sorted[idx] as u32) << 16;
            idx += 1;
            unsafe { replicate(t.as_mut_ptr().add(rev8(key)), step, 32, code) };
            key += key_step;
        }
        step <<= 1;
        key_step >>= 1;
    }
}

// BrotliBuildSimpleHuffmanTable (root 8): always 256 entries
unsafe fn build_simple<E: Entry>(t: *mut E, v: &[u16; 4], n: u32, info: &[u64]) -> usize {
    let e = |bits: u32, val: u16| E::sym(bits, val, info);
    let mut size = 1usize;
    match n {
        0 => *t = e(0, v[0]),
        1 => {
            let (a, b) = if v[1] > v[0] { (v[0], v[1]) } else { (v[1], v[0]) };
            *t = e(1, a);
            *t.add(1) = e(1, b);
            size = 2;
        }
        2 => {
            *t = e(1, v[0]);
            *t.add(2) = e(1, v[0]);
            let (a, b) = if v[2] > v[1] { (v[1], v[2]) } else { (v[2], v[1]) };
            *t.add(1) = e(2, a);
            *t.add(3) = e(2, b);
            size = 4;
        }
        3 => {
            let mut m = *v;
            for i in 0..3 {
                for k in i + 1..4 {
                    if m[k] < m[i] {
                        m.swap(k, i);
                    }
                }
            }
            *t = e(2, m[0]);
            *t.add(2) = e(2, m[1]);
            *t.add(1) = e(2, m[2]);
            *t.add(3) = e(2, m[3]);
            size = 4;
        }
        _ => {
            let mut m = *v;
            if m[3] < m[2] {
                m.swap(3, 2);
            }
            for i in 0..7 {
                *t.add(i) = e(1 + (i as u32 & 1), m[0]);
            }
            *t.add(1) = e(2, m[1]);
            *t.add(3) = e(3, m[2]);
            *t.add(5) = e(2, m[1]);
            *t.add(7) = e(3, m[3]);
            size = 8;
        }
    }
    while size != 256 {
        core::ptr::copy_nonoverlapping(t, t.add(size), size);
        size <<= 1;
    }
    256
}

fn bit_len(mut x: u32) -> u32 {
    let mut r = 0;
    while x != 0 {
        x >>= 1;
        r += 1;
    }
    r
}

// ReadHuffmanCode: appends the table to `tabs` and returns its offset.
// `info` (wide tables only) maps symbols to their decode info.
pub fn read_code<E: Entry>(br: &mut Br, alphabet: u32, max_symbol: u32, tabs: &mut Vec<E>, sc: &mut Scratch, info: &[u64]) -> Option<u32> {
    let alphabet = alphabet & 0x7ff;
    let off = tabs.len();
    tabs.reserve(MAX_TABLE);
    let t = unsafe { tabs.as_mut_ptr().add(off) };
    br.refill();
    let hskip = br.read(2);
    let size;
    if hskip == 1 {
        let nsym = br.read(2);
        let max_bits = bit_len(alphabet - 1);
        let mut v = [0u16; 4];
        for i in 0..=nsym as usize {
            br.refill();
            let s = br.read(max_bits);
            if s >= max_symbol {
                return None;
            }
            v[i] = s as u16;
        }
        for i in 0..nsym as usize {
            for k in i + 1..=nsym as usize {
                if v[i] == v[k] {
                    return None;
                }
            }
        }
        let mut n = nsym;
        if n == 3 {
            br.refill();
            n += br.read(1);
        }
        size = unsafe { build_simple(t, &v, n, info) };
    } else {
        // code length code lengths
        let mut cl = [0u8; 18];
        let mut count = [0u16; 16];
        let mut space = 32u32;
        let mut num_codes = 0u32;
        for i in hskip as usize..18 {
            br.refill();
            let ix = br.peek(4) as usize;
            let v = CL_PREFIX_VAL[ix];
            br.skip(CL_PREFIX_LEN[ix] as u32);
            cl[CL_ORDER[i] as usize] = v;
            if v != 0 {
                space = space.wrapping_sub(32 >> v);
                num_codes += 1;
                count[v as usize] += 1;
                if space.wrapping_sub(1) >= 32 {
                    break;
                }
            }
        }
        if !(num_codes == 1 || space == 0) {
            return None;
        }
        build_cl(&mut sc.cl, &cl, &count);
        // symbol code lengths
        let lens = &mut sc.lens;
        for l in lens[..max_symbol as usize].iter_mut() {
            *l = 0;
        }
        let mut count = [0u16; 16];
        let mut symbol = 0u32;
        let mut repeat = 0u32;
        let mut space = 32768u32;
        let mut prev = 8u32;
        let mut rcl = 0u32;
        while symbol < max_symbol && space > 0 {
            br.refill();
            let p = sc.cl[br.peek(5) as usize];
            br.skip(p & 0xff);
            let code_len = p >> 16;
            if code_len < 16 {
                repeat = 0;
                if code_len != 0 {
                    lens[symbol as usize] = code_len as u8;
                    prev = code_len;
                    space = space.wrapping_sub(32768 >> code_len);
                    count[code_len as usize] += 1;
                }
                symbol += 1;
            } else {
                let extra = code_len - 14;
                let delta_bits = br.read(extra);
                let new_len = if code_len == 16 { prev } else { 0 };
                if rcl != new_len {
                    repeat = 0;
                    rcl = new_len;
                }
                let old = repeat;
                if repeat > 0 {
                    repeat -= 2;
                    repeat <<= extra;
                }
                repeat = repeat.wrapping_add(delta_bits + 3);
                let delta = repeat.wrapping_sub(old);
                if symbol + delta > max_symbol {
                    return None;
                }
                if rcl != 0 {
                    for l in lens[symbol as usize..(symbol + delta) as usize].iter_mut() {
                        *l = rcl as u8;
                    }
                    space = space.wrapping_sub(delta << (15 - rcl));
                    count[rcl as usize] = (count[rcl as usize] as u32 + delta) as u16;
                }
                symbol += delta;
            }
        }
        if space != 0 {
            return None;
        }
        // sort symbols by (length, value)
        let mut offs = [0u16; 16];
        let mut acc = 0u16;
        for l in 1..16 {
            offs[l] = acc;
            acc += count[l];
        }
        for s in 0..max_symbol as usize {
            let l = lens[s] as usize;
            if l != 0 {
                sc.sorted[offs[l] as usize] = s as u16;
                offs[l] += 1;
            }
        }
        size = unsafe { build(t, &sc.sorted, &mut count, info) };
    }
    unsafe { tabs.set_len(off + size) };
    Some(off as u32)
}
