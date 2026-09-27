// Port of pako/lib/zlib/trees.js (zlib trees.c). Tree construction is kept
// operation-for-operation identical (same heap, same tie breaking) so the
// emitted bit stream is byte-identical. The literal/distance encoding loop
// (compress_block) uses a 64-bit accumulator and is normalized back to zlib's
// 16-bit bi_buf state afterwards, so every externally visible state
// (pending bytes, bi_valid) matches pako exactly.

use crate::deflate::Deflate;

pub const LENGTH_CODES: usize = 29;
pub const LITERALS: usize = 256;
pub const L_CODES: usize = LITERALS + 1 + LENGTH_CODES;
pub const D_CODES: usize = 30;
pub const BL_CODES: usize = 19;
pub const HEAP_SIZE: usize = 2 * L_CODES + 1;
pub const MAX_BITS: usize = 15;
const MAX_BL_BITS: usize = 7;
const END_BLOCK: usize = 256;
const REP_3_6: usize = 16;
const REPZ_3_10: usize = 17;
const REPZ_11_138: usize = 18;
const STORED_BLOCK: u32 = 0;
const STATIC_TREES: u32 = 1;
const DYN_TREES: u32 = 2;
const Z_FIXED: i32 = 4;
const Z_BINARY: i32 = 0;
const Z_TEXT: i32 = 1;
const Z_UNKNOWN: i32 = 2;
pub const MIN_MATCH: usize = 3;
pub const MAX_MATCH: usize = 258;

pub static EXTRA_LBITS: [u8; 29] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
pub static EXTRA_DBITS: [u8; 30] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
static EXTRA_BLBITS: [u8; 19] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7];
static BL_ORDER: [u8; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const fn bi_reverse(mut code: u32, mut len: u32) -> u32 {
    let mut res = 0u32;
    loop {
        res |= code & 1;
        code >>= 1;
        res <<= 1;
        len -= 1;
        if len == 0 {
            break;
        }
    }
    res >> 1
}

pub struct Static {
    pub ltree: [u16; (L_CODES + 2) * 2],
    pub dtree: [u16; D_CODES * 2],
    pub dist_code: [u8; 512],
    pub length_code: [u8; 256],
    pub base_length: [u8; LENGTH_CODES],
    pub base_dist: [u16; D_CODES],
}

const fn gen_codes_const(tree: &mut [u16; (L_CODES + 2) * 2], max_code: usize, bl_count: &[u16; MAX_BITS + 1]) {
    let mut next_code = [0u16; MAX_BITS + 1];
    let mut code: u32 = 0;
    let mut bits = 1;
    while bits <= MAX_BITS {
        code = (code + bl_count[bits - 1] as u32) << 1;
        next_code[bits] = code as u16;
        bits += 1;
    }
    let mut n = 0;
    while n <= max_code {
        let len = tree[n * 2 + 1] as usize;
        if len != 0 {
            tree[n * 2] = bi_reverse(next_code[len] as u32, len as u32) as u16;
            next_code[len] += 1;
        }
        n += 1;
    }
}

const fn make_static() -> Static {
    let mut s = Static {
        ltree: [0; (L_CODES + 2) * 2],
        dtree: [0; D_CODES * 2],
        dist_code: [0; 512],
        length_code: [0; 256],
        base_length: [0; LENGTH_CODES],
        base_dist: [0; D_CODES],
    };
    let mut length = 0usize;
    let mut code = 0usize;
    while code < LENGTH_CODES - 1 {
        s.base_length[code] = length as u8;
        let mut n = 0;
        while n < (1 << EXTRA_LBITS[code]) {
            s.length_code[length] = code as u8;
            length += 1;
            n += 1;
        }
        code += 1;
    }
    s.length_code[length - 1] = code as u8;
    let mut dist = 0usize;
    code = 0;
    while code < 16 {
        s.base_dist[code] = dist as u16;
        let mut n = 0;
        while n < (1 << EXTRA_DBITS[code]) {
            s.dist_code[dist] = code as u8;
            dist += 1;
            n += 1;
        }
        code += 1;
    }
    dist >>= 7;
    while code < D_CODES {
        s.base_dist[code] = (dist << 7) as u16;
        let mut n = 0;
        while n < (1 << (EXTRA_DBITS[code] - 7)) {
            s.dist_code[256 + dist] = code as u8;
            dist += 1;
            n += 1;
        }
        code += 1;
    }
    let mut bl_count = [0u16; MAX_BITS + 1];
    let mut n = 0;
    while n <= 143 {
        s.ltree[n * 2 + 1] = 8;
        n += 1;
        bl_count[8] += 1;
    }
    while n <= 255 {
        s.ltree[n * 2 + 1] = 9;
        n += 1;
        bl_count[9] += 1;
    }
    while n <= 279 {
        s.ltree[n * 2 + 1] = 7;
        n += 1;
        bl_count[7] += 1;
    }
    while n <= 287 {
        s.ltree[n * 2 + 1] = 8;
        n += 1;
        bl_count[8] += 1;
    }
    gen_codes_const(&mut s.ltree, L_CODES + 1, &bl_count);
    let mut n = 0;
    while n < D_CODES {
        s.dtree[n * 2 + 1] = 5;
        s.dtree[n * 2] = bi_reverse(n as u32, 5) as u16;
        n += 1;
    }
    s
}

pub static ST: Static = make_static();

#[inline(always)]
pub fn d_code(dist: usize) -> usize {
    if dist < 256 {
        ST.dist_code[dist] as usize
    } else {
        ST.dist_code[256 + (dist >> 7)] as usize
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TreeKind {
    L,
    D,
    Bl,
}

// ---- bit output (exact zlib semantics, Buf_size = 16) ----

impl Deflate {
    #[inline(always)]
    pub fn put_byte(&mut self, b: u8) {
        unsafe { *self.pending_buf.get_unchecked_mut(self.pending) = b };
        self.pending += 1;
    }

    #[inline(always)]
    pub fn put_short(&mut self, w: u32) {
        self.put_byte((w & 0xff) as u8);
        self.put_byte(((w >> 8) & 0xff) as u8);
    }

    #[inline(always)]
    pub fn send_bits(&mut self, value: u32, length: u32) {
        if self.bi_valid > 16 - length {
            self.bi_buf |= (value << self.bi_valid) & 0xffff;
            let b = self.bi_buf;
            self.put_short(b);
            self.bi_buf = value >> (16 - self.bi_valid);
            self.bi_valid += length;
            self.bi_valid -= 16;
        } else {
            self.bi_buf |= (value << self.bi_valid) & 0xffff;
            self.bi_valid += length;
        }
    }

    fn bi_flush(&mut self) {
        if self.bi_valid == 16 {
            let b = self.bi_buf;
            self.put_short(b);
            self.bi_buf = 0;
            self.bi_valid = 0;
        } else if self.bi_valid >= 8 {
            let b = self.bi_buf;
            self.put_byte((b & 0xff) as u8);
            self.bi_buf >>= 8;
            self.bi_valid -= 8;
        }
    }

    fn bi_windup(&mut self) {
        if self.bi_valid > 8 {
            let b = self.bi_buf;
            self.put_short(b);
        } else if self.bi_valid > 0 {
            let b = self.bi_buf;
            self.put_byte(b as u8);
        }
        self.bi_buf = 0;
        self.bi_valid = 0;
    }

    fn tree(&mut self, k: TreeKind) -> &mut [u16] {
        match k {
            TreeKind::L => &mut self.dyn_ltree[..],
            TreeKind::D => &mut self.dyn_dtree[..],
            TreeKind::Bl => &mut self.bl_tree[..],
        }
    }

    fn gen_bitlen(&mut self, k: TreeKind) {
        let max_code = match k {
            TreeKind::L => self.l_max_code,
            TreeKind::D => self.d_max_code,
            TreeKind::Bl => self.bl_max_code,
        } as usize;
        let (stree, has_stree, extra, base, max_length): (&[u16], bool, &[u8], usize, usize) = match k {
            TreeKind::L => (&ST.ltree[..], true, &EXTRA_LBITS[..], LITERALS + 1, MAX_BITS),
            TreeKind::D => (&ST.dtree[..], true, &EXTRA_DBITS[..], 0, MAX_BITS),
            TreeKind::Bl => (&[][..], false, &EXTRA_BLBITS[..], 0, MAX_BL_BITS),
        };
        for b in 0..=MAX_BITS {
            self.bl_count[b] = 0;
        }
        let heap_max = self.heap_max;
        // (a copy of the heap array was made here before: 1 KB per call)
        let heap_p = self.heap.as_ptr();
        let heap = |i: usize| -> u16 { unsafe { *heap_p.add(i) } };
        let mut overflow: i32 = 0;
        let mut opt_len = self.opt_len;
        let mut static_len = self.static_len;
        let mut bl_count = self.bl_count;
        {
            let tree = self.tree(k);
            tree[heap(heap_max) as usize * 2 + 1] = 0;
            let mut h = heap_max + 1;
            while h < HEAP_SIZE {
                let n = heap(h) as usize;
                let mut bits = tree[tree[n * 2 + 1] as usize * 2 + 1] as usize + 1;
                if bits > max_length {
                    bits = max_length;
                    overflow += 1;
                }
                tree[n * 2 + 1] = bits as u16;
                if n > max_code {
                    h += 1;
                    continue;
                }
                bl_count[bits] += 1;
                let mut xbits = 0usize;
                if n >= base {
                    xbits = extra[n - base] as usize;
                }
                let f = tree[n * 2] as i64;
                opt_len += f * (bits + xbits) as i64;
                if has_stree {
                    static_len += f * (stree[n * 2 + 1] as usize + xbits) as i64;
                }
                h += 1;
            }
            if overflow != 0 {
                loop {
                    let mut bits = max_length - 1;
                    while bl_count[bits] == 0 {
                        bits -= 1;
                    }
                    bl_count[bits] -= 1;
                    bl_count[bits + 1] += 2;
                    bl_count[max_length] -= 1;
                    overflow -= 2;
                    if overflow <= 0 {
                        break;
                    }
                }
                let mut h = HEAP_SIZE;
                let mut bits = max_length;
                while bits != 0 {
                    let mut n = bl_count[bits];
                    while n != 0 {
                        h -= 1;
                        let m = heap(h) as usize;
                        if m > max_code {
                            continue;
                        }
                        if tree[m * 2 + 1] as usize != bits {
                            opt_len += (bits as i64 - tree[m * 2 + 1] as i64) * tree[m * 2] as i64;
                            tree[m * 2 + 1] = bits as u16;
                        }
                        n -= 1;
                    }
                    bits -= 1;
                }
            }
        }
        self.opt_len = opt_len;
        self.static_len = static_len;
        self.bl_count = bl_count;
    }

    fn build_tree(&mut self, k: TreeKind) {
        let (has_stree, elems): (bool, usize) = match k {
            TreeKind::L => (true, L_CODES),
            TreeKind::D => (true, D_CODES),
            TreeKind::Bl => (false, BL_CODES),
        };
        let stree: *const u16 = match k {
            TreeKind::L => ST.ltree.as_ptr(),
            TreeKind::D => ST.dtree.as_ptr(),
            TreeKind::Bl => core::ptr::null(),
        };
        let tree: *mut u16 = match k {
            TreeKind::L => self.dyn_ltree.as_mut_ptr(),
            TreeKind::D => self.dyn_dtree.as_mut_ptr(),
            TreeKind::Bl => self.bl_tree.as_mut_ptr(),
        };
        // zlib's smaller(n, m) (freq, then depth <=) as one compare of
        // key = freq << 10 | depth (depth < 1024: at most 572 nodes)
        let heap = self.heap.as_mut_ptr();
        let key = self.hkey.as_mut_ptr();
        let mut heap_len: usize = 0;
        let mut heap_max: usize = HEAP_SIZE;
        let mut max_code: i32 = -1;
        let mut opt_len = self.opt_len;
        let mut static_len = self.static_len;
        unsafe {
            for n in 0..elems {
                let f = *tree.add(n * 2);
                if f != 0 {
                    heap_len += 1;
                    *heap.add(heap_len) = n as u16;
                    max_code = n as i32;
                    *key.add(n) = (f as u32) << 10;
                } else {
                    *tree.add(n * 2 + 1) = 0;
                }
            }
            while heap_len < 2 {
                let node = if max_code < 2 {
                    max_code += 1;
                    max_code as usize
                } else {
                    0
                };
                heap_len += 1;
                *heap.add(heap_len) = node as u16;
                *tree.add(node * 2) = 1;
                *key.add(node) = 1 << 10;
                opt_len -= 1;
                if has_stree {
                    static_len -= *stree.add(node * 2 + 1) as i64;
                }
            }
            let mut n = heap_len >> 1;
            while n >= 1 {
                pqdownheap(heap, key, heap_len, n);
                n -= 1;
            }
            let mut node = elems;
            loop {
                let n = *heap.add(1) as usize;
                *heap.add(1) = *heap.add(heap_len);
                heap_len -= 1;
                pqdownheap(heap, key, heap_len, 1);
                let m = *heap.add(1) as usize;
                heap_max -= 1;
                *heap.add(heap_max) = n as u16;
                heap_max -= 1;
                *heap.add(heap_max) = m as u16;
                let f = (*tree.add(n * 2)).wrapping_add(*tree.add(m * 2));
                *tree.add(node * 2) = f;
                let dn = *key.add(n) & 1023;
                let dm = *key.add(m) & 1023;
                *key.add(node) = ((f as u32) << 10) | (if dn >= dm { dn } else { dm }) + 1;
                *tree.add(n * 2 + 1) = node as u16;
                *tree.add(m * 2 + 1) = node as u16;
                *heap.add(1) = node as u16;
                node += 1;
                pqdownheap(heap, key, heap_len, 1);
                if heap_len < 2 {
                    break;
                }
            }
            heap_max -= 1;
            *heap.add(heap_max) = *heap.add(1);
        }
        self.heap_len = heap_len;
        self.heap_max = heap_max;
        self.opt_len = opt_len;
        self.static_len = static_len;
        match k {
            TreeKind::L => self.l_max_code = max_code,
            TreeKind::D => self.d_max_code = max_code,
            TreeKind::Bl => self.bl_max_code = max_code,
        }
        self.gen_bitlen(k);
        let bl_count = self.bl_count;
        gen_codes(self.tree(k), max_code as usize, &bl_count);
    }

    fn scan_tree(&mut self, k: TreeKind, max_code: usize) {
        let mut bl = self.bl_tree;
        {
            let tree = self.tree(k);
            let mut prevlen: i32 = -1;
            let mut nextlen = tree[1] as i32;
            let mut count = 0;
            let mut max_count = 7;
            let mut min_count = 4;
            if nextlen == 0 {
                max_count = 138;
                min_count = 3;
            }
            tree[(max_code + 1) * 2 + 1] = 0xffff;
            for n in 0..=max_code {
                let curlen = nextlen;
                nextlen = tree[(n + 1) * 2 + 1] as i32;
                count += 1;
                if count < max_count && curlen == nextlen {
                    continue;
                } else if count < min_count {
                    bl[curlen as usize * 2] = bl[curlen as usize * 2].wrapping_add(count as u16);
                } else if curlen != 0 {
                    if curlen != prevlen {
                        bl[curlen as usize * 2] = bl[curlen as usize * 2].wrapping_add(1);
                    }
                    bl[REP_3_6 * 2] = bl[REP_3_6 * 2].wrapping_add(1);
                } else if count <= 10 {
                    bl[REPZ_3_10 * 2] = bl[REPZ_3_10 * 2].wrapping_add(1);
                } else {
                    bl[REPZ_11_138 * 2] = bl[REPZ_11_138 * 2].wrapping_add(1);
                }
                count = 0;
                prevlen = curlen;
                if nextlen == 0 {
                    max_count = 138;
                    min_count = 3;
                } else if curlen == nextlen {
                    max_count = 6;
                    min_count = 3;
                } else {
                    max_count = 7;
                    min_count = 4;
                }
            }
        }
        self.bl_tree = bl;
    }

    #[inline(always)]
    fn send_code_bl(&mut self, c: usize) {
        let code = self.bl_tree[c * 2] as u32;
        let len = self.bl_tree[c * 2 + 1] as u32;
        self.send_bits(code, len);
    }

    fn send_tree(&mut self, k: TreeKind, max_code: usize) {
        let mut prevlen: i32 = -1;
        let mut nextlen = self.tree(k)[1] as i32;
        let mut count: i32 = 0;
        let mut max_count = 7;
        let mut min_count = 4;
        if nextlen == 0 {
            max_count = 138;
            min_count = 3;
        }
        for n in 0..=max_code {
            let curlen = nextlen;
            nextlen = self.tree(k)[(n + 1) * 2 + 1] as i32;
            count += 1;
            if count < max_count && curlen == nextlen {
                continue;
            } else if count < min_count {
                loop {
                    self.send_code_bl(curlen as usize);
                    count -= 1;
                    if count == 0 {
                        break;
                    }
                }
            } else if curlen != 0 {
                if curlen != prevlen {
                    self.send_code_bl(curlen as usize);
                    count -= 1;
                }
                self.send_code_bl(REP_3_6);
                self.send_bits((count - 3) as u32, 2);
            } else if count <= 10 {
                self.send_code_bl(REPZ_3_10);
                self.send_bits((count - 3) as u32, 3);
            } else {
                self.send_code_bl(REPZ_11_138);
                self.send_bits((count - 11) as u32, 7);
            }
            count = 0;
            prevlen = curlen;
            if nextlen == 0 {
                max_count = 138;
                min_count = 3;
            } else if curlen == nextlen {
                max_count = 6;
                min_count = 3;
            } else {
                max_count = 7;
                min_count = 4;
            }
        }
    }

    fn build_bl_tree(&mut self) -> usize {
        let lmc = self.l_max_code as usize;
        let dmc = self.d_max_code as usize;
        self.scan_tree(TreeKind::L, lmc);
        self.scan_tree(TreeKind::D, dmc);
        self.build_tree(TreeKind::Bl);
        let mut max_blindex = BL_CODES - 1;
        while max_blindex >= 3 {
            if self.bl_tree[BL_ORDER[max_blindex] as usize * 2 + 1] != 0 {
                break;
            }
            max_blindex -= 1;
        }
        self.opt_len += 3 * (max_blindex as i64 + 1) + 5 + 5 + 4;
        max_blindex
    }

    fn send_all_trees(&mut self, lcodes: usize, dcodes: usize, blcodes: usize) {
        self.send_bits((lcodes - 257) as u32, 5);
        self.send_bits((dcodes - 1) as u32, 5);
        self.send_bits((blcodes - 4) as u32, 4);
        for rank in 0..blcodes {
            let l = self.bl_tree[BL_ORDER[rank] as usize * 2 + 1] as u32;
            self.send_bits(l, 3);
        }
        self.send_tree(TreeKind::L, lcodes - 1);
        self.send_tree(TreeKind::D, dcodes - 1);
    }

    fn detect_data_type(&self) -> i32 {
        let mut block_mask: u32 = 0xf3ffc07f;
        let mut n = 0;
        while n <= 31 {
            if (block_mask & 1) != 0 && self.dyn_ltree[n * 2] != 0 {
                return Z_BINARY;
            }
            n += 1;
            block_mask >>= 1;
        }
        if self.dyn_ltree[9 * 2] != 0 || self.dyn_ltree[10 * 2] != 0 || self.dyn_ltree[13 * 2] != 0 {
            return Z_TEXT;
        }
        for n in 32..LITERALS {
            if self.dyn_ltree[n * 2] != 0 {
                return Z_TEXT;
            }
        }
        Z_BINARY
    }

    pub fn init_block(&mut self) {
        for n in 0..L_CODES {
            self.dyn_ltree[n * 2] = 0;
        }
        for n in 0..D_CODES {
            self.dyn_dtree[n * 2] = 0;
        }
        for n in 0..BL_CODES {
            self.bl_tree[n * 2] = 0;
        }
        self.dyn_ltree[END_BLOCK * 2] = 1;
        self.opt_len = 0;
        self.static_len = 0;
        self.sym_next = 0;
        self.matches = 0;
    }

    pub fn tr_init(&mut self) {
        self.bi_buf = 0;
        self.bi_valid = 0;
        self.init_block();
    }

    pub fn tr_stored_block(&mut self, buf: usize, stored_len: usize, last: bool) {
        self.send_bits((STORED_BLOCK << 1) + last as u32, 3);
        self.bi_windup();
        self.put_short(stored_len as u32);
        self.put_short(!(stored_len as u32));
        if stored_len != 0 {
            let p = self.pending;
            self.pending_buf[p..p + stored_len].copy_from_slice(&self.window[buf..buf + stored_len]);
        }
        self.pending += stored_len;
    }

    pub fn tr_align(&mut self) {
        self.send_bits(STATIC_TREES << 1, 3);
        let code = ST.ltree[END_BLOCK * 2] as u32;
        let len = ST.ltree[END_BLOCK * 2 + 1] as u32;
        self.send_bits(code, len);
        self.bi_flush();
    }

    /// buf < 0 means "block data no longer in the window" (-1 in pako)
    pub fn tr_flush_block(&mut self, buf: isize, stored_len: usize, last: bool) {
        let mut opt_lenb: i64;
        let static_lenb: i64;
        let mut max_blindex = 0usize;
        if self.level > 0 {
            if self.data_type == Z_UNKNOWN {
                self.data_type = self.detect_data_type();
            }
            self.build_tree(TreeKind::L);
            self.build_tree(TreeKind::D);
            max_blindex = self.build_bl_tree();
            opt_lenb = ((self.opt_len + 3 + 7) as u32 >> 3) as i64;
            static_lenb = ((self.static_len + 3 + 7) as u32 >> 3) as i64;
            if static_lenb <= opt_lenb {
                opt_lenb = static_lenb;
            }
        } else {
            opt_lenb = stored_len as i64 + 5;
            static_lenb = opt_lenb;
        }
        if (stored_len as i64 + 4 <= opt_lenb) && buf != -1 {
            self.tr_stored_block(buf as usize, stored_len, last);
        } else if self.strategy == Z_FIXED || static_lenb == opt_lenb {
            self.send_bits((STATIC_TREES << 1) + last as u32, 3);
            self.compress_block(true);
        } else {
            self.send_bits((DYN_TREES << 1) + last as u32, 3);
            let l = self.l_max_code as usize + 1;
            let d = self.d_max_code as usize + 1;
            self.send_all_trees(l, d, max_blindex + 1);
            self.compress_block(false);
        }
        self.init_block();
        if last {
            self.bi_windup();
        }
    }

    /// Send the block data with the given trees.
    ///
    /// Each symbol is emitted with one combined (code | extra bits) value
    /// from per-block tables and a branchless 64-bit bit writer (8-byte
    /// store, advance by whole bytes). The bit stream is identical to zlib's
    /// send_bits sequence; afterwards (pending, bi_buf, bi_valid) are set to
    /// exactly the state zlib's 16-bit writer would have: it writes whole
    /// 16-bit units from `pending`, so bi_valid = ((B - 1) mod 16) + 1 for B
    /// bits sent since then (bi_valid is in 1..=16 after the END_BLOCK code).
    fn compress_block(&mut self, fixed: bool) {
        if fixed {
            unsafe { self.compress_block_with(|lc| FIXED_CTAB[CT_LIT + lc], |lc| FIXED_CTAB[CT_LEN + lc], |c| FIXED_CTAB[CT_DIST + c], FIXED_CTAB[CT_EOB]) }
        } else if self.sym_next >= 3 * CT_MIN_SYMS {
            build_ctab(&self.dyn_ltree, &self.dyn_dtree, &mut self.ctab);
            let t = self.ctab.as_ptr();
            unsafe { self.compress_block_with(|lc| *t.add(CT_LIT + lc), |lc| *t.add(CT_LEN + lc), |c| *t.add(CT_DIST + c), *t.add(CT_EOB)) }
        } else {
            // small block: look entries up directly instead of building tables
            let lt = self.dyn_ltree.as_ptr();
            let dt = self.dyn_dtree.as_ptr();
            unsafe {
                let eob = ((*lt.add(END_BLOCK * 2 + 1) as u32) << 24) | *lt.add(END_BLOCK * 2) as u32;
                self.compress_block_with(
                    |lc| ((*lt.add(lc * 2 + 1) as u32) << 24) | *lt.add(lc * 2) as u32,
                    |lc| len_entry(lt, lc),
                    |c| ((*dt.add(c * 2 + 1) as u32 + EXTRA_DBITS[c] as u32) << 24) | ((*dt.add(c * 2 + 1) as u32) << 16) | *dt.add(c * 2) as u32,
                    eob,
                )
            }
        }
    }

    #[inline(always)]
    unsafe fn compress_block_with(&mut self, lit: impl Fn(usize) -> u32, len: impl Fn(usize) -> u32, dcode: impl Fn(usize) -> u32, eob: u32) {
        {
            let out = self.pending_buf.as_mut_ptr();
            let p0 = out.add(self.pending);
            let mut p = p0;
            let mut bb: u64 = self.bi_buf as u64;
            let mut nb: u64 = self.bi_valid as u64;
            macro_rules! flush {
                () => {{
                    (p as *mut u64).write_unaligned(bb.to_le());
                    p = p.add((nb >> 3) as usize);
                    bb >>= nb & 56;
                    nb &= 7;
                }};
            }
            flush!();
            let mut s = self.sym_buf.as_ptr();
            let end = s.add(self.sym_next);
            while s < end {
                // sym_buf has slack, so a 4-byte load is fine
                let w = (s as *const u32).read_unaligned().to_le();
                s = s.add(3);
                let dist = w & 0xffff;
                let lc = ((w >> 16) & 0xff) as usize;
                if dist == 0 {
                    let e = lit(lc);
                    bb |= ((e & 0xff_ffff) as u64) << nb;
                    nb += (e >> 24) as u64;
                } else {
                    let e = len(lc);
                    bb |= ((e & 0xff_ffff) as u64) << nb;
                    nb += (e >> 24) as u64;
                    let d = (dist - 1) as usize;
                    let c = d_code(d);
                    let t = dcode(c);
                    let v = (t & 0xffff) as u64 | (((d - ST.base_dist[c] as usize) as u64) << ((t >> 16) & 0xff));
                    bb |= v << nb;
                    nb += (t >> 24) as u64;
                }
                flush!();
            }
            let e = eob;
            bb |= ((e & 0xff_ffff) as u64) << nb;
            nb += (e >> 24) as u64;
            flush!();
            // the partial byte (if any) is in pending_buf now as well
            let total = 8 * (p as usize - p0 as usize) as u64 + nb;
            let bv = ((total - 1) & 15) + 1;
            let np = p0.add(((total - bv) >> 3) as usize);
            let bi = (np as *const u16).read_unaligned().to_le() as u32 & ((1u32 << bv) - 1);
            self.pending = np as usize - out as usize;
            self.bi_buf = bi;
            self.bi_valid = bv as u32;
        }
    }

    #[inline(always)]
    pub fn tr_tally(&mut self, dist: usize, lc: usize) -> bool {
        let sn = self.sym_next;
        unsafe {
            let p = self.sym_buf.as_mut_ptr().add(sn);
            *p = dist as u8;
            *p.add(1) = (dist >> 8) as u8;
            *p.add(2) = lc as u8;
        }
        self.sym_next = sn + 3;
        if dist == 0 {
            unsafe {
                let f = self.dyn_ltree.get_unchecked_mut(lc * 2);
                *f = f.wrapping_add(1);
            }
        } else {
            self.matches += 1;
            let d = dist - 1;
            unsafe {
                let f = self.dyn_ltree.get_unchecked_mut((ST.length_code[lc] as usize + LITERALS + 1) * 2);
                *f = f.wrapping_add(1);
                let g = self.dyn_dtree.get_unchecked_mut(d_code(d) * 2);
                *g = g.wrapping_add(1);
            }
        }
        self.sym_next == self.sym_end
    }
}

/// zlib pqdownheap with smaller(a, b) = key[a] <= key[b]
#[inline(always)]
unsafe fn pqdownheap(heap: *mut u16, key: *const u32, heap_len: usize, mut k: usize) {
    let v = *heap.add(k);
    let kv = *key.add(v as usize);
    let mut j = k << 1;
    while j <= heap_len {
        let mut hj = *heap.add(j);
        if j < heap_len {
            let hj1 = *heap.add(j + 1);
            if *key.add(hj1 as usize) <= *key.add(hj as usize) {
                j += 1;
                hj = hj1;
            }
        }
        if kv <= *key.add(hj as usize) {
            break;
        }
        *heap.add(k) = hj;
        k = j;
        j <<= 1;
    }
    *heap.add(k) = v;
}

const fn make_rev8() -> [u8; 256] {
    let mut t = [0u8; 256];
    let mut i = 0;
    while i < 256 {
        t[i] = (i as u8).reverse_bits();
        i += 1;
    }
    t
}
static REV8: [u8; 256] = make_rev8();

/// bi_reverse(code, len) for len in 1..=16 (only the low `len` bits count)
#[inline(always)]
fn rev_bits(code: u32, len: u32) -> u32 {
    let r = ((REV8[(code & 0xff) as usize] as u32) << 8) | REV8[((code >> 8) & 0xff) as usize] as u32;
    r >> (16 - len)
}

fn gen_codes(tree: &mut [u16], max_code: usize, bl_count: &[u16; MAX_BITS + 1]) {
    let mut next_code = [0u32; MAX_BITS + 1];
    let mut code: u32 = 0;
    for bits in 1..=MAX_BITS {
        code = (code + bl_count[bits - 1] as u32) << 1;
        next_code[bits] = code & 0xffff; // ush in zlib/pako
    }
    for n in 0..=max_code {
        let len = tree[n * 2 + 1] as usize;
        if len == 0 {
            continue;
        }
        tree[n * 2] = rev_bits(next_code[len], len as u32) as u16;
        next_code[len] = (next_code[len] + 1) & 0xffff;
    }
}

// ---- combined emission tables (compress_block) ----
// entry: nbits << 24 | value (Huffman code bits, then extra bits above them)
//   [CT_LIT + lc]  literal lc
//   [CT_LEN + lc]  match length lc + 3 (length code + extra bits)
//   [CT_DIST + c]  distance code c: (clen + extra) << 24 | clen << 16 | code
//   [CT_EOB]       END_BLOCK
pub const CT_LIT: usize = 0;
pub const CT_LEN: usize = 256;
pub const CT_DIST: usize = 512;
pub const CT_EOB: usize = 543;
pub const CT_SIZE: usize = 544;

const fn ctab_fill(lt: &[u16], dt: &[u16], t: &mut [u32; CT_SIZE]) {
    let mut i = 0;
    while i < 256 {
        t[CT_LIT + i] = ((lt[i * 2 + 1] as u32) << 24) | lt[i * 2] as u32;
        i += 1;
    }
    let mut lc = 0;
    while lc < 256 {
        let code = ST.length_code[lc] as usize;
        let c = lt[(code + LITERALS + 1) * 2] as u32;
        let clen = lt[(code + LITERALS + 1) * 2 + 1] as u32;
        let extra = EXTRA_LBITS[code] as u32;
        let v = if extra != 0 { c | ((lc as u32 - ST.base_length[code] as u32) << clen) } else { c };
        t[CT_LEN + lc] = ((clen + extra) << 24) | v;
        lc += 1;
    }
    let mut c = 0;
    while c < D_CODES {
        let clen = dt[c * 2 + 1] as u32;
        t[CT_DIST + c] = ((clen + EXTRA_DBITS[c] as u32) << 24) | (clen << 16) | dt[c * 2] as u32;
        c += 1;
    }
    t[CT_EOB] = ((lt[END_BLOCK * 2 + 1] as u32) << 24) | lt[END_BLOCK * 2] as u32;
}

fn build_ctab(lt: &[u16], dt: &[u16], t: &mut [u32; CT_SIZE]) {
    ctab_fill(lt, dt, t);
}

const fn make_fixed_ctab() -> [u32; CT_SIZE] {
    let mut t = [0u32; CT_SIZE];
    let s = make_static();
    ctab_fill(&s.ltree, &s.dtree, &mut t);
    t
}

static FIXED_CTAB: [u32; CT_SIZE] = make_fixed_ctab();

/// below this many symbols a dynamic block is emitted without building tables
const CT_MIN_SYMS: usize = 600;

/// emission entry for match length lc + 3 read straight from a tree
#[inline(always)]
unsafe fn len_entry(lt: *const u16, lc: usize) -> u32 {
    let code = ST.length_code[lc] as usize;
    let c = *lt.add((code + LITERALS + 1) * 2) as u32;
    let clen = *lt.add((code + LITERALS + 1) * 2 + 1) as u32;
    let extra = EXTRA_LBITS[code] as u32;
    let v = if extra != 0 { c | ((lc as u32 - ST.base_length[code] as u32) << clen) } else { c };
    ((clen + extra) << 24) | v
}
