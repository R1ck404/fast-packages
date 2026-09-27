// Fast one-shot brotli decoder. The whole stream is decoded straight into one
// output Vec; since that Vec is the complete history there is no ring buffer,
// no wrap handling and no chunked output copies.
//
// Contract: decode() returns Some(out) only for inputs on which
// brotli-decompressor 4.0.0's BrotliDecompress (the brotli-wasm reference)
// returns Ok(out). Every error, and a few legal-but-odd cases whose reference
// behaviour depends on its internal 4 KiB I/O chunking (block length overrun)
// or that we don't implement (large-window streams), return None so the
// caller can run the reference decoder. Reference quirks mirrored here:
// - trailing bytes after the last meta-block are ignored;
// - the final padding bits are only checked when no data meta-block was seen
//   (once the ring buffer exists the reference overwrites PADDING_2 with the
//   result of its final output flush);
// - distances beyond min(pos, window - 16) are static dictionary references.

#[path = "../../vendor/brotli-decompressor/src/prefix.rs"]
#[allow(dead_code)]
mod prefix;
#[path = "../../vendor/brotli-decompressor/src/context.rs"]
#[allow(dead_code)]
mod context;
mod bits;
mod cmds;
mod copy;
mod huff;

use bits::Br;
use huff::{read_code, read_sym, Scratch};
use prefix::kBlockLengthPrefixCode;

// writes may run this far past the meta-block end (copy_match: 32)
const SLACK: usize = 64;
const NO_SWITCH: u32 = u32::MAX;

// Widened command table entries: bits | insert extra bits << 8 | copy extra
// bits << 13 | implicit distance << 18 | distance context << 19 | insert
// offset << 21 | copy offset << 36 (from kCmdLut).
const CMD_INFO: [u64; 704] = {
    let mut a = [0u64; 704];
    let mut i = 0;
    while i < 704 {
        let v = &prefix::kCmdLut[i];
        a[i] = (v.insert_len_extra_bits as u64) << 8
            | (v.copy_len_extra_bits as u64) << 13
            | ((v.distance_code == 0) as u64) << 18
            | (v.context as u64) << 19
            | (v.insert_len_offset as u64) << 21
            | (v.copy_len_offset as u64) << 36;
        i += 1;
    }
    a
};

// Widened distance table entries. Codes >= 16: extra bits << 8 | PUSH |
// base << 32, distance = base + (extra << npostfix). Short codes 0..15:
// SHORT | ring index << 17 | PUSH (not code 0) | delta (i8) << 24.
const D_SHORT: u64 = 1 << 16;
const D_PUSH: u64 = 1 << 20;
const SHORT_IDX: [u64; 16] = [0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
const SHORT_OFF: [i8; 16] = [0, 0, 0, 0, -1, 1, -2, 2, -3, 3, -1, 1, -2, 2, -3, 3];
fn dist_info(code: u32, npostfix: u32, ndirect: u32) -> u64 {
    if code < 16 {
        let push = if code != 0 { D_PUSH } else { 0 };
        return D_SHORT | SHORT_IDX[code as usize] << 17 | push | (SHORT_OFF[code as usize] as u8 as u64) << 24;
    }
    let (nb, base) = if code < 16 + ndirect {
        (0, code - 15)
    } else {
        let dv = code - 16 - ndirect;
        let postfix = dv & ((1 << npostfix) - 1);
        let dv = dv >> npostfix;
        let nbits = (dv >> 1) + 1;
        let offset = ((2 + (dv & 1)) << nbits) - 4;
        (nbits, (offset << npostfix) + postfix + ndirect + 1)
    };
    (nb as u64) << 8 | D_PUSH | (base as u64) << 32
}

pub fn decode(input: &[u8]) -> Option<Vec<u8>> {
    if input.is_empty() {
        return None;
    }
    // private copy with PAD zero bytes after it (branchless refill)
    let mut inp = Vec::with_capacity(input.len() + bits::PAD);
    inp.extend_from_slice(input);
    inp.extend_from_slice(&[0; bits::PAD]);
    let mut d = Dec {
        br: Br::new(inp.as_ptr(), input.len()),
        inp: &inp[..input.len()],
        out: Vec::new(),
        mbd: 0,
        dist: [4, 11, 15, 16],
        had_data: false,
        tabs: Vec::new(),
        sc: Scratch::new(),
        cmap: Vec::new(),
        dcmap: Vec::new(),
        modes: Vec::new(),
        trivial: Vec::new(),
        lit_off: Vec::new(),
        cmd_off: Vec::new(),
        dist_off: Vec::new(),
        wtabs: Vec::new(),
    };
    d.run()?;
    Some(d.out)
}

struct Dec<'a> {
    br: Br,
    inp: &'a [u8],
    out: Vec<u8>,
    mbd: usize, // max backward distance: (1 << wbits) - 16
    dist: [u32; 4], // last, 2nd, 3rd, 4th last distance
    had_data: bool,
    tabs: Vec<u32>,
    sc: Scratch,
    cmap: Vec<u8>,
    dcmap: Vec<u8>,
    modes: Vec<u8>,
    trivial: Vec<bool>,
    lit_off: Vec<u32>,
    cmd_off: Vec<u32>,
    dist_off: Vec<u32>,
    wtabs: Vec<u64>, // command and distance tables, entries widened
}

// per meta-block block-switch state
struct Blocks {
    num: [u32; 3],
    len: [u32; 3],
    rb: [u32; 6],
    type_tree: [u32; 3],
    len_tree: [u32; 3],
}

#[inline(always)]
fn var_u8(br: &mut Br) -> u32 {
    if br.read(1) == 0 {
        return 0;
    }
    let n = br.read(3);
    if n == 0 {
        return 1;
    }
    (1 << n) + br.read(n)
}

#[inline(always)]
unsafe fn block_len(br: &mut Br, t: *const u32) -> u32 {
    let s = read_sym(br, t) as usize;
    let p = kBlockLengthPrefixCode.get_unchecked(s);
    p.offset as u32 + br.read(p.nbits as u32)
}

// DecodeBlockTypeAndLength for category `c`: (reader, new type, new length).
// The reader goes by value so the hot loop's copy can live in locals.
#[cold]
#[inline(never)]
unsafe fn switch(mut br: Br, tabs: *const u32, b: &mut Blocks, c: usize) -> (Br, u32, u32) {
    br.refill();
    let s = read_sym(&mut br, tabs.add(b.type_tree[c] as usize));
    let len = block_len(&mut br, tabs.add(b.len_tree[c] as usize));
    let max = b.num[c];
    let mut t = if s == 1 {
        b.rb[c * 2 + 1] + 1
    } else if s == 0 {
        b.rb[c * 2]
    } else {
        s - 2
    };
    if t >= max {
        t -= max;
    }
    b.rb[c * 2] = b.rb[c * 2 + 1];
    b.rb[c * 2 + 1] = t;
    (br, t, len)
}

impl<'a> Dec<'a> {
    fn run(&mut self) -> Option<()> {
        let br = &mut self.br;
        br.refill();
        let wbits = if br.read(1) == 0 {
            16
        } else {
            let n = br.read(3);
            if n != 0 {
                17 + n
            } else {
                let n = br.read(3);
                if n == 1 {
                    return None; // large window: reference path
                }
                if n != 0 {
                    8 + n
                } else {
                    17
                }
            }
        };
        self.mbd = (1usize << wbits) - 16;
        loop {
            if self.br.far_past_end() {
                return None;
            }
            let br = &mut self.br;
            br.refill();
            let is_last = br.read(1) != 0;
            if is_last && br.read(1) != 0 {
                break; // ISEMPTY
            }
            let nib = br.read(2);
            if nib == 3 {
                // metadata
                if br.read(1) != 0 {
                    return None;
                }
                let nbytes = br.read(2);
                let mut mlen = 0usize;
                for i in 0..nbytes {
                    br.refill();
                    let b = br.read(8);
                    if i + 1 == nbytes && nbytes > 1 && b == 0 {
                        return None;
                    }
                    mlen |= (b as usize) << (8 * i);
                }
                if nbytes > 0 {
                    mlen += 1;
                }
                if br.align() != 0 {
                    return None;
                }
                self.raw_bytes(mlen, false)?;
                if is_last {
                    break;
                }
                continue;
            }
            let nibbles = nib + 4;
            let mut mlen = 0usize;
            for i in 0..nibbles {
                let b = br.read(4);
                if i + 1 == nibbles && nibbles > 4 && b == 0 {
                    return None;
                }
                mlen |= (b as usize) << (4 * i);
            }
            mlen += 1;
            let unc = !is_last && br.read(1) != 0;
            self.had_data = true;
            if unc {
                if br.align() != 0 {
                    return None;
                }
                self.raw_bytes(mlen, true)?;
                continue;
            }
            self.metablock(mlen)?;
            if is_last {
                break;
            }
        }
        if self.br.align() != 0 && !self.had_data {
            return None;
        }
        if self.br.overrun() {
            return None;
        }
        Some(())
    }

    // byte-aligned uncompressed / metadata payload
    fn raw_bytes(&mut self, n: usize, keep: bool) -> Option<()> {
        let p = self.br.byte_pos();
        if p > self.inp.len() || self.inp.len() - p < n {
            return None;
        }
        if keep {
            self.out.extend_from_slice(&self.inp[p..p + n]);
        }
        self.br.reset_at(p + n);
        Some(())
    }

    fn context_map(&mut self, size: usize, dist: bool) -> Option<u32> {
        let br = &mut self.br;
        br.refill();
        let ntrees = var_u8(br) + 1;
        let map = if dist { &mut self.dcmap } else { &mut self.cmap };
        map.clear();
        map.resize(size, 0);
        if ntrees <= 1 {
            return Some(ntrees);
        }
        br.refill();
        let rle_max = if br.read(1) != 0 { br.read(4) + 1 } else { 0 };
        let alpha = ntrees + rle_max;
        let off = read_code(br, alpha, alpha, &mut self.tabs, &mut self.sc, &[])?;
        let t = unsafe { self.tabs.as_ptr().add(off as usize) };
        let mut i = 0usize;
        while i < size {
            br.refill();
            let code = unsafe { read_sym(br, t) };
            if code == 0 {
                i += 1;
            } else if code > rle_max {
                map[i] = (code - rle_max) as u8;
                i += 1;
            } else {
                let reps = (1usize << code) + br.read(code) as usize;
                if i + reps > size {
                    return None;
                }
                i += reps;
            }
        }
        // the table was only needed here
        self.tabs.truncate(off as usize);
        br.refill();
        if br.read(1) != 0 {
            let mut mtf = [0u8; 256];
            for (i, m) in mtf.iter_mut().enumerate() {
                *m = i as u8;
            }
            for v in map.iter_mut() {
                let idx = *v as usize;
                let value = mtf[idx];
                *v = value;
                mtf.copy_within(0..idx, 1);
                mtf[0] = value;
            }
        }
        Some(ntrees)
    }

    fn metablock(&mut self, mlen: usize) -> Option<()> {
        self.tabs.clear();
        let mut b = Blocks { num: [1; 3], len: [NO_SWITCH; 3], rb: [1, 0, 1, 0, 1, 0], type_tree: [0; 3], len_tree: [0; 3] };
        for c in 0..3 {
            self.br.refill();
            let n = var_u8(&mut self.br) + 1;
            b.num[c] = n;
            if n >= 2 {
                b.type_tree[c] = read_code(&mut self.br, n + 2, n + 2, &mut self.tabs, &mut self.sc, &[])?;
                b.len_tree[c] = read_code(&mut self.br, 26, 26, &mut self.tabs, &mut self.sc, &[])?;
                self.br.refill();
                b.len[c] = unsafe { block_len(&mut self.br, self.tabs.as_ptr().add(b.len_tree[c] as usize)) };
            }
        }
        self.br.refill();
        let pd = self.br.read(6);
        let npostfix = pd & 3;
        let ndirect = (pd >> 2) << npostfix;
        self.modes.clear();
        for _ in 0..b.num[0] {
            self.br.refill();
            let m = self.br.read(2);
            self.modes.push(m as u8);
        }
        let nlit = self.context_map((b.num[0] as usize) << 6, false)?;
        let ndist = self.context_map((b.num[2] as usize) << 2, true)?;
        self.lit_off.clear();
        for _ in 0..nlit {
            let o = read_code(&mut self.br, 256, 256, &mut self.tabs, &mut self.sc, &[])?;
            self.lit_off.push(o);
        }
        self.wtabs.clear();
        self.cmd_off.clear();
        for _ in 0..b.num[1] {
            let o = read_code(&mut self.br, 704, 704, &mut self.wtabs, &mut self.sc, &CMD_INFO)?;
            self.cmd_off.push(o);
        }
        let dalpha = 16 + ndirect + (48 << npostfix);
        let mut dinfo = [0u64; 544];
        for code in 0..dalpha {
            dinfo[code as usize] = dist_info(code, npostfix, ndirect);
        }
        self.dist_off.clear();
        for _ in 0..ndist {
            let o = read_code(&mut self.br, dalpha, dalpha, &mut self.wtabs, &mut self.sc, &dinfo)?;
            self.dist_off.push(o);
        }
        self.trivial.clear();
        for t in 0..b.num[0] as usize {
            let m = &self.cmap[t << 6..(t + 1) << 6];
            self.trivial.push(m.iter().all(|&x| x == m[0]));
        }
        unsafe { self.commands(mlen, &mut b, npostfix) }
    }
}
