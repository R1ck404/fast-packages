// Port of pako/lib/zlib/deflate.js (zlib 1.2.12 deflate.c as ported by pako).
// Every decision (hash chains, lazy matching, block flushing, stored-block
// sizing, window sliding) is kept identical so the output is byte-identical
// to pako. Speed comes from: 8-byte-at-a-time match comparison, unchecked
// indexing in the hot loops, 64-bit bit output (trees.rs), fast checksums,
// and reusing buffers instead of reallocating per stream.

use crate::checksum::{adler32, crc32};
use crate::trees::*;

pub const Z_NO_FLUSH: i32 = 0;
pub const Z_PARTIAL_FLUSH: i32 = 1;
pub const Z_FULL_FLUSH: i32 = 3;
pub const Z_FINISH: i32 = 4;
pub const Z_BLOCK: i32 = 5;
pub const Z_OK: i32 = 0;
pub const Z_STREAM_END: i32 = 1;
pub const Z_STREAM_ERROR: i32 = -2;
pub const Z_DATA_ERROR: i32 = -3;
pub const Z_BUF_ERROR: i32 = -5;
const Z_FILTERED: i32 = 1;
const Z_HUFFMAN_ONLY: i32 = 2;
const Z_RLE: i32 = 3;
const Z_FIXED: i32 = 4;
const Z_UNKNOWN: i32 = 2;
const Z_DEFLATED: i32 = 8;

const MAX_MEM_LEVEL: i32 = 9;
const MIN_LOOKAHEAD: usize = MAX_MATCH + MIN_MATCH + 1;
const PRESET_DICT: u32 = 0x20;

const INIT_STATE: i32 = 42;
const GZIP_STATE: i32 = 57;
const EXTRA_STATE: i32 = 69;
const NAME_STATE: i32 = 73;
const COMMENT_STATE: i32 = 91;
const HCRC_STATE: i32 = 103;
const BUSY_STATE: i32 = 113;
const FINISH_STATE: i32 = 666;

const BS_NEED_MORE: i32 = 1;
const BS_BLOCK_DONE: i32 = 2;
const BS_FINISH_STARTED: i32 = 3;
const BS_FINISH_DONE: i32 = 4;

const OS_CODE: u8 = 0x03;

// message ids (mapped to pako's message strings in JS)
pub const MSG_NONE: i32 = 0;
pub const MSG_STREAM_ERROR: i32 = -2;
pub const MSG_DATA_ERROR: i32 = -3;
pub const MSG_BUF_ERROR: i32 = -5;

// slack after buffers so 8-byte loads/stores never leave the allocation
const SLACK: usize = 16;

#[derive(Clone, Copy)]
struct Config {
    good_length: u16,
    max_lazy: u16,
    nice_length: u16,
    max_chain: u16,
    func: u8, // 0 stored, 1 fast, 2 slow
}

const CONFIG: [Config; 10] = [
    Config { good_length: 0, max_lazy: 0, nice_length: 0, max_chain: 0, func: 0 },
    Config { good_length: 4, max_lazy: 4, nice_length: 8, max_chain: 4, func: 1 },
    Config { good_length: 4, max_lazy: 5, nice_length: 16, max_chain: 8, func: 1 },
    Config { good_length: 4, max_lazy: 6, nice_length: 32, max_chain: 32, func: 1 },
    Config { good_length: 4, max_lazy: 4, nice_length: 16, max_chain: 16, func: 2 },
    Config { good_length: 8, max_lazy: 16, nice_length: 32, max_chain: 32, func: 2 },
    Config { good_length: 8, max_lazy: 16, nice_length: 128, max_chain: 128, func: 2 },
    Config { good_length: 8, max_lazy: 32, nice_length: 128, max_chain: 256, func: 2 },
    Config { good_length: 32, max_lazy: 128, nice_length: 258, max_chain: 1024, func: 2 },
    Config { good_length: 32, max_lazy: 258, nice_length: 258, max_chain: 4096, func: 2 },
];

pub struct GzHead {
    pub text: bool,
    pub hcrc: bool,
    pub time: u32,
    pub os: u8,
    pub extra: Option<Vec<u8>>,
    pub name: Option<Vec<u8>>,
    pub comment: Option<Vec<u8>>,
}

pub struct Deflate {
    // ---- z_stream ----
    pub input: *const u8,
    pub next_in: usize,
    pub avail_in: usize,
    pub total_in: u64,
    pub output: *mut u8,
    pub next_out: usize,
    pub avail_out: usize,
    pub total_out: u64,
    pub msg: i32,
    pub data_type: i32,
    pub adler: u32,
    // ---- state ----
    pub status: i32,
    pub pending_buf: Vec<u8>,
    pub pending_buf_size: usize,
    pub pending_out: usize,
    pub pending: usize,
    pub wrap: i32,
    pub gzhead: Option<GzHead>,
    pub gzindex: usize,
    pub last_flush: i32,
    pub w_size: usize,
    pub w_bits: usize,
    pub w_mask: usize,
    pub window: Vec<u8>,
    pub window_size: usize,
    pub prev: Vec<u16>,
    pub head: Vec<u16>,
    pub ins_h: usize,
    pub hash_size: usize,
    pub hash_bits: usize,
    pub hash_mask: usize,
    pub hash_shift: usize,
    pub block_start: isize,
    pub match_length: usize,
    pub prev_match: usize,
    pub match_available: bool,
    pub strstart: usize,
    pub match_start: usize,
    pub lookahead: usize,
    pub prev_length: usize,
    pub max_chain_length: usize,
    pub max_lazy_match: usize,
    pub level: i32,
    pub strategy: i32,
    pub good_match: usize,
    pub nice_match: usize,
    pub dyn_ltree: [u16; HEAP_SIZE * 2],
    pub dyn_dtree: [u16; (2 * D_CODES + 1) * 2],
    pub bl_tree: [u16; (2 * BL_CODES + 1) * 2],
    pub l_max_code: i32,
    pub d_max_code: i32,
    pub bl_max_code: i32,
    pub bl_count: [u16; MAX_BITS + 1],
    pub heap: [u16; 2 * L_CODES + 1],
    pub heap_len: usize,
    pub heap_max: usize,
    pub depth: [u16; 2 * L_CODES + 1],
    pub sym_buf: Vec<u8>,
    pub lit_bufsize: usize,
    pub sym_next: usize,
    pub sym_end: usize,
    pub opt_len: i64,
    pub static_len: i64,
    pub matches: usize,
    pub insert: usize,
    pub bi_buf: u32,
    pub bi_valid: u32,
    /// highest window index ever written (bytes above are still zero)
    pub win_dirty: usize,
    /// per-block emission tables (compress_block): literals, lengths, dist codes
    pub ctab: [u32; crate::trees::CT_SIZE],
    /// heap keys for build_tree: freq << 10 | depth
    pub hkey: [u32; HEAP_SIZE],
}

impl Deflate {
    /// deflateInit2. Returns Err(status) on bad parameters.
    pub fn new(level: i32, method: i32, window_bits: i32, mem_level: i32, strategy: i32) -> Result<Box<Deflate>, i32> {
        let mut level = level;
        let mut window_bits = window_bits;
        let mut wrap = 1;
        if level == -1 {
            level = 6;
        }
        if window_bits < 0 {
            wrap = 0;
            window_bits = -window_bits;
        } else if window_bits > 15 {
            wrap = 2;
            window_bits -= 16;
        }
        if mem_level < 1
            || mem_level > MAX_MEM_LEVEL
            || method != Z_DEFLATED
            || window_bits < 8
            || window_bits > 15
            || level < 0
            || level > 9
            || strategy < 0
            || strategy > Z_FIXED
            || (window_bits == 8 && wrap != 1)
        {
            return Err(Z_STREAM_ERROR);
        }
        if window_bits == 8 {
            window_bits = 9;
        }
        let w_bits = window_bits as usize;
        let w_size = 1usize << w_bits;
        let hash_bits = mem_level as usize + 7;
        let hash_size = 1usize << hash_bits;
        let lit_bufsize = 1usize << (mem_level as usize + 6);
        let mut s = Box::new(Deflate {
            input: core::ptr::null(),
            next_in: 0,
            avail_in: 0,
            total_in: 0,
            output: core::ptr::null_mut(),
            next_out: 0,
            avail_out: 0,
            total_out: 0,
            msg: MSG_NONE,
            data_type: Z_UNKNOWN,
            adler: 0,
            status: INIT_STATE,
            pending_buf: vec![0u8; lit_bufsize * 4 + SLACK],
            pending_buf_size: lit_bufsize * 4,
            pending_out: 0,
            pending: 0,
            wrap,
            gzhead: None,
            gzindex: 0,
            last_flush: -1,
            w_size,
            w_bits,
            w_mask: w_size - 1,
            window: vec![0u8; w_size * 2 + MAX_MATCH + SLACK],
            window_size: 0,
            prev: vec![0u16; w_size],
            head: vec![0u16; hash_size],
            ins_h: 0,
            hash_size,
            hash_bits,
            hash_mask: hash_size - 1,
            hash_shift: (hash_bits + MIN_MATCH - 1) / MIN_MATCH,
            block_start: 0,
            match_length: 0,
            prev_match: 0,
            match_available: false,
            strstart: 0,
            match_start: 0,
            lookahead: 0,
            prev_length: 0,
            max_chain_length: 0,
            max_lazy_match: 0,
            level,
            strategy,
            good_match: 0,
            nice_match: 0,
            dyn_ltree: [0; HEAP_SIZE * 2],
            dyn_dtree: [0; (2 * D_CODES + 1) * 2],
            bl_tree: [0; (2 * BL_CODES + 1) * 2],
            l_max_code: 0,
            d_max_code: 0,
            bl_max_code: 0,
            bl_count: [0; MAX_BITS + 1],
            heap: [0; 2 * L_CODES + 1],
            heap_len: 0,
            heap_max: 0,
            depth: [0; 2 * L_CODES + 1],
            sym_buf: vec![0u8; lit_bufsize * 3 + SLACK],
            lit_bufsize,
            sym_next: 0,
            sym_end: (lit_bufsize - 1) * 3,
            opt_len: 0,
            static_len: 0,
            matches: 0,
            insert: 0,
            bi_buf: 0,
            bi_valid: 0,
            win_dirty: 0,
            ctab: [0; crate::trees::CT_SIZE],
            hkey: [0; HEAP_SIZE],
        });
        s.reset();
        Ok(s)
    }

    /// Re-initialize an existing state for new parameters, reusing buffers
    /// when the sizes allow (equivalent to a freshly allocated pako state).
    pub fn reinit(&mut self, level: i32, method: i32, window_bits: i32, mem_level: i32, strategy: i32) -> i32 {
        let mut level = level;
        let mut window_bits = window_bits;
        let mut wrap = 1;
        if level == -1 {
            level = 6;
        }
        if window_bits < 0 {
            wrap = 0;
            window_bits = -window_bits;
        } else if window_bits > 15 {
            wrap = 2;
            window_bits -= 16;
        }
        if mem_level < 1
            || mem_level > MAX_MEM_LEVEL
            || method != Z_DEFLATED
            || window_bits < 8
            || window_bits > 15
            || level < 0
            || level > 9
            || strategy < 0
            || strategy > Z_FIXED
            || (window_bits == 8 && wrap != 1)
        {
            return Z_STREAM_ERROR;
        }
        if window_bits == 8 {
            window_bits = 9;
        }
        let w_bits = window_bits as usize;
        let w_size = 1usize << w_bits;
        let hash_bits = mem_level as usize + 7;
        let hash_size = 1usize << hash_bits;
        let lit_bufsize = 1usize << (mem_level as usize + 6);
        // window must look freshly zeroed (stale bytes past the input can
        // influence match selection exactly like in pako's fresh arrays)
        let need_win = w_size * 2 + MAX_MATCH + SLACK;
        if self.window.len() < need_win {
            self.window = vec![0u8; need_win];
        } else {
            let d = core::cmp::min(self.win_dirty + MAX_MATCH + SLACK, self.window.len());
            self.window[..d].fill(0);
        }
        self.win_dirty = 0;
        if self.prev.len() < w_size {
            self.prev = vec![0u16; w_size];
        }
        if self.head.len() != hash_size {
            self.head = vec![0u16; hash_size];
        }
        if self.pending_buf.len() < lit_bufsize * 4 + SLACK {
            self.pending_buf = vec![0u8; lit_bufsize * 4 + SLACK];
        }
        if self.sym_buf.len() < lit_bufsize * 3 + SLACK {
            self.sym_buf = vec![0u8; lit_bufsize * 3 + SLACK];
        }
        self.input = core::ptr::null();
        self.next_in = 0;
        self.avail_in = 0;
        self.total_in = 0;
        self.output = core::ptr::null_mut();
        self.next_out = 0;
        self.avail_out = 0;
        self.total_out = 0;
        self.msg = MSG_NONE;
        self.data_type = Z_UNKNOWN;
        self.adler = 0;
        self.status = INIT_STATE;
        self.pending_buf_size = lit_bufsize * 4;
        self.pending_out = 0;
        self.pending = 0;
        self.wrap = wrap;
        self.gzhead = None;
        self.gzindex = 0;
        self.last_flush = -1;
        self.w_size = w_size;
        self.w_bits = w_bits;
        self.w_mask = w_size - 1;
        self.hash_size = hash_size;
        self.hash_bits = hash_bits;
        self.hash_mask = hash_size - 1;
        self.hash_shift = (hash_bits + MIN_MATCH - 1) / MIN_MATCH;
        self.lit_bufsize = lit_bufsize;
        self.sym_end = (lit_bufsize - 1) * 3;
        self.level = level;
        self.strategy = strategy;
        self.dyn_ltree = [0; HEAP_SIZE * 2];
        self.dyn_dtree = [0; (2 * D_CODES + 1) * 2];
        self.bl_tree = [0; (2 * BL_CODES + 1) * 2];
        self.heap = [0; 2 * L_CODES + 1];
        self.depth = [0; 2 * L_CODES + 1];
        self.bl_count = [0; MAX_BITS + 1];
        self.match_start = 0;
        self.prev_match = 0;
        self.reset();
        Z_OK
    }

    fn reset_keep(&mut self) {
        self.total_in = 0;
        self.total_out = 0;
        self.data_type = Z_UNKNOWN;
        self.pending = 0;
        self.pending_out = 0;
        if self.wrap < 0 {
            self.wrap = -self.wrap;
        }
        self.status = if self.wrap == 2 {
            GZIP_STATE
        } else if self.wrap != 0 {
            INIT_STATE
        } else {
            BUSY_STATE
        };
        self.adler = if self.wrap == 2 { 0 } else { 1 };
        self.last_flush = -2;
        self.tr_init();
    }

    pub fn reset(&mut self) {
        self.reset_keep();
        self.lm_init();
    }

    fn lm_init(&mut self) {
        self.window_size = 2 * self.w_size;
        let hs = self.hash_size;
        self.head[..hs].fill(0);
        let c = CONFIG[self.level as usize];
        self.max_lazy_match = c.max_lazy as usize;
        self.good_match = c.good_length as usize;
        self.nice_match = c.nice_length as usize;
        self.max_chain_length = c.max_chain as usize;
        self.strstart = 0;
        self.block_start = 0;
        self.lookahead = 0;
        self.insert = 0;
        self.match_length = MIN_MATCH - 1;
        self.prev_length = MIN_MATCH - 1;
        self.match_available = false;
        self.ins_h = 0;
    }

    #[inline(always)]
    fn hash(&self, prev: usize, data: u8) -> usize {
        ((prev << self.hash_shift) ^ data as usize) & self.hash_mask
    }

    fn slide_hash(&mut self) {
        let wsize = self.w_size as u16;
        for m in self.head[..self.hash_size].iter_mut() {
            *m = if *m >= wsize { *m - wsize } else { 0 };
        }
        for m in self.prev[..self.w_size].iter_mut() {
            *m = if *m >= wsize { *m - wsize } else { 0 };
        }
    }

    fn flush_pending(&mut self) {
        let mut len = self.pending;
        if len > self.avail_out {
            len = self.avail_out;
        }
        if len == 0 {
            return;
        }
        unsafe {
            core::ptr::copy_nonoverlapping(self.pending_buf.as_ptr().add(self.pending_out), self.output.add(self.next_out), len);
        }
        self.next_out += len;
        self.pending_out += len;
        self.total_out += len as u64;
        self.avail_out -= len;
        self.pending -= len;
        if self.pending == 0 {
            self.pending_out = 0;
        }
    }

    fn flush_block_only(&mut self, last: bool) {
        let buf = if self.block_start >= 0 { self.block_start } else { -1 };
        let stored_len = (self.strstart as isize - self.block_start) as usize;
        self.tr_flush_block(buf, stored_len, last);
        self.block_start = self.strstart as isize;
        self.flush_pending();
    }

    #[inline(always)]
    fn put_short_msb(&mut self, b: u32) {
        self.put_byte(((b >> 8) & 0xff) as u8);
        self.put_byte((b & 0xff) as u8);
    }

    /// read_buf into the window at `start` (dst = window) — returns bytes read
    fn read_buf_window(&mut self, start: usize, size: usize) -> usize {
        let mut len = self.avail_in;
        if len > size {
            len = size;
        }
        if len == 0 {
            return 0;
        }
        self.avail_in -= len;
        let src = unsafe { core::slice::from_raw_parts(self.input.add(self.next_in), len) };
        self.window[start..start + len].copy_from_slice(src);
        if start + len > self.win_dirty {
            self.win_dirty = start + len;
        }
        if self.wrap == 1 {
            self.adler = adler32(self.adler, src);
        } else if self.wrap == 2 {
            self.adler = crc32(self.adler, src);
        }
        self.next_in += len;
        self.total_in += len as u64;
        len
    }

    /// read_buf directly into the output (deflate_stored)
    fn read_buf_output(&mut self, len0: usize) -> usize {
        let mut len = self.avail_in;
        if len > len0 {
            len = len0;
        }
        if len == 0 {
            return 0;
        }
        self.avail_in -= len;
        let src = unsafe { core::slice::from_raw_parts(self.input.add(self.next_in), len) };
        unsafe { core::ptr::copy_nonoverlapping(src.as_ptr(), self.output.add(self.next_out), len) };
        if self.wrap == 1 {
            self.adler = adler32(self.adler, src);
        } else if self.wrap == 2 {
            self.adler = crc32(self.adler, src);
        }
        self.next_in += len;
        self.total_in += len as u64;
        len
    }

    /// longest_match — identical semantics to pako: bytes at offsets 0,1 and
    /// best_len-1,best_len are checked first, offset 2 is assumed equal, and
    /// offsets 3..=258 are compared (here 8 at a time).
    #[inline(always)]
    fn longest_match(&mut self, mut cur_match: usize) -> usize {
        let mut chain_length = self.max_chain_length;
        let scan = self.strstart;
        let mut best_len = self.prev_length;
        let mut nice_match = self.nice_match;
        let limit = if self.strstart > self.w_size - MIN_LOOKAHEAD { self.strstart - (self.w_size - MIN_LOOKAHEAD) } else { 0 };
        let wmask = self.w_mask;
        let win = self.window.as_ptr();
        let prev = self.prev.as_ptr();
        if self.prev_length >= self.good_match {
            chain_length >>= 2;
        }
        if nice_match > self.lookahead {
            nice_match = self.lookahead;
        }
        unsafe {
            let rd16 = |p: usize| -> u16 { (win.add(p) as *const u16).read_unaligned() };
            let rd64 = |p: usize| -> u64 { (win.add(p) as *const u64).read_unaligned() };
            let scan_start = rd16(scan);
            let mut scan_end = rd16(scan + best_len - 1);
            loop {
                let m = cur_match;
                if rd16(m + best_len - 1) == scan_end && rd16(m) == scan_start {
                    // compare offsets 3..=258
                    let mut len = 3usize;
                    loop {
                        let x = rd64(scan + len) ^ rd64(m + len);
                        if x != 0 {
                            len += (x.trailing_zeros() >> 3) as usize;
                            break;
                        }
                        len += 8;
                        if len >= MAX_MATCH {
                            break;
                        }
                    }
                    if len > MAX_MATCH {
                        len = MAX_MATCH;
                    }
                    if len > best_len {
                        self.match_start = cur_match;
                        best_len = len;
                        if len >= nice_match {
                            break;
                        }
                        scan_end = rd16(scan + best_len - 1);
                    }
                }
                cur_match = *prev.add(cur_match & wmask) as usize;
                if cur_match <= limit {
                    break;
                }
                chain_length -= 1;
                if chain_length == 0 {
                    break;
                }
            }
        }
        if best_len <= self.lookahead {
            best_len
        } else {
            self.lookahead
        }
    }

    fn fill_window(&mut self) {
        let w_size = self.w_size;
        loop {
            let mut more = self.window_size - self.lookahead - self.strstart;
            if self.strstart >= w_size + (w_size - MIN_LOOKAHEAD) {
                self.window.copy_within(w_size..w_size + w_size - more, 0);
                self.match_start = self.match_start.wrapping_sub(w_size);
                self.strstart -= w_size;
                self.block_start -= w_size as isize;
                if self.insert > self.strstart {
                    self.insert = self.strstart;
                }
                self.slide_hash();
                more += w_size;
            }
            if self.avail_in == 0 {
                break;
            }
            let n = self.read_buf_window(self.strstart + self.lookahead, more);
            self.lookahead += n;
            if self.lookahead + self.insert >= MIN_MATCH {
                let mut str = self.strstart - self.insert;
                self.ins_h = self.window[str] as usize;
                self.ins_h = self.hash(self.ins_h, self.window[str + 1]);
                while self.insert != 0 {
                    self.ins_h = self.hash(self.ins_h, self.window[str + MIN_MATCH - 1]);
                    self.prev[str & self.w_mask] = self.head[self.ins_h];
                    self.head[self.ins_h] = str as u16;
                    str += 1;
                    self.insert -= 1;
                    if self.lookahead + self.insert < MIN_MATCH {
                        break;
                    }
                }
            }
            if !(self.lookahead < MIN_LOOKAHEAD && self.avail_in != 0) {
                break;
            }
        }
    }

    fn deflate_stored(&mut self, flush: i32) -> i32 {
        let mut min_block = if self.pending_buf_size - 5 > self.w_size { self.w_size } else { self.pending_buf_size - 5 };
        let mut len: usize;
        let mut left: usize;
        let mut have: usize;
        let mut last = false;
        let mut used = self.avail_in;
        loop {
            len = 65535;
            have = ((self.bi_valid + 42) >> 3) as usize;
            if self.avail_out < have {
                break;
            }
            have = self.avail_out - have;
            left = (self.strstart as isize - self.block_start) as usize;
            if len > left + self.avail_in {
                len = left + self.avail_in;
            }
            if len > have {
                len = have;
            }
            if len < min_block && ((len == 0 && flush != Z_FINISH) || flush == Z_NO_FLUSH || len != left + self.avail_in) {
                break;
            }
            last = flush == Z_FINISH && len == left + self.avail_in;
            self.tr_stored_block(0, 0, last);
            let p = self.pending;
            self.pending_buf[p - 4] = len as u8;
            self.pending_buf[p - 3] = (len >> 8) as u8;
            self.pending_buf[p - 2] = !len as u8;
            self.pending_buf[p - 1] = (!len >> 8) as u8;
            self.flush_pending();
            if left != 0 {
                if left > len {
                    left = len;
                }
                let bs = self.block_start as usize;
                unsafe {
                    core::ptr::copy_nonoverlapping(self.window.as_ptr().add(bs), self.output.add(self.next_out), left);
                }
                self.next_out += left;
                self.avail_out -= left;
                self.total_out += left as u64;
                self.block_start += left as isize;
                len -= left;
            }
            if len != 0 {
                self.read_buf_output(len);
                self.next_out += len;
                self.avail_out -= len;
                self.total_out += len as u64;
            }
            if last {
                break;
            }
        }
        used -= self.avail_in;
        if used != 0 {
            if used >= self.w_size {
                self.matches = 2;
                let src = unsafe { core::slice::from_raw_parts(self.input.add(self.next_in - self.w_size), self.w_size) };
                let ws = self.w_size;
                self.window[..ws].copy_from_slice(src);
                if ws > self.win_dirty {
                    self.win_dirty = ws;
                }
                self.strstart = self.w_size;
                self.insert = self.strstart;
            } else {
                if self.window_size - self.strstart <= used {
                    self.strstart -= self.w_size;
                    let ws = self.w_size;
                    let ss = self.strstart;
                    self.window.copy_within(ws..ws + ss, 0);
                    if self.matches < 2 {
                        self.matches += 1;
                    }
                    if self.insert > self.strstart {
                        self.insert = self.strstart;
                    }
                }
                let src = unsafe { core::slice::from_raw_parts(self.input.add(self.next_in - used), used) };
                let ss = self.strstart;
                self.window[ss..ss + used].copy_from_slice(src);
                if ss + used > self.win_dirty {
                    self.win_dirty = ss + used;
                }
                self.strstart += used;
                self.insert += if used > self.w_size - self.insert { self.w_size - self.insert } else { used };
            }
            self.block_start = self.strstart as isize;
        }
        if last {
            return BS_FINISH_DONE;
        }
        if flush != Z_NO_FLUSH && flush != Z_FINISH && self.avail_in == 0 && self.strstart as isize == self.block_start {
            return BS_BLOCK_DONE;
        }
        have = self.window_size - self.strstart;
        if self.avail_in > have && self.block_start >= self.w_size as isize {
            self.block_start -= self.w_size as isize;
            self.strstart -= self.w_size;
            let ws = self.w_size;
            let ss = self.strstart;
            self.window.copy_within(ws..ws + ss, 0);
            if self.matches < 2 {
                self.matches += 1;
            }
            have += self.w_size;
            if self.insert > self.strstart {
                self.insert = self.strstart;
            }
        }
        if have > self.avail_in {
            have = self.avail_in;
        }
        if have != 0 {
            let ss = self.strstart;
            self.read_buf_window(ss, have);
            self.strstart += have;
            self.insert += if have > self.w_size - self.insert { self.w_size - self.insert } else { have };
        }
        have = ((self.bi_valid + 42) >> 3) as usize;
        have = if self.pending_buf_size - have > 65535 { 65535 } else { self.pending_buf_size - have };
        min_block = if have > self.w_size { self.w_size } else { have };
        left = (self.strstart as isize - self.block_start) as usize;
        if left >= min_block || ((left != 0 || flush == Z_FINISH) && flush != Z_NO_FLUSH && self.avail_in == 0 && left <= have) {
            len = if left > have { have } else { left };
            last = flush == Z_FINISH && self.avail_in == 0 && len == left;
            let bs = self.block_start as usize;
            self.tr_stored_block(bs, len, last);
            self.block_start += len as isize;
            self.flush_pending();
        }
        if last {
            BS_FINISH_STARTED
        } else {
            BS_NEED_MORE
        }
    }

    #[inline(always)]
    fn insert_string(&mut self, pos: usize) -> usize {
        unsafe {
            let h = ((self.ins_h << self.hash_shift) ^ *self.window.get_unchecked(pos + MIN_MATCH - 1) as usize) & self.hash_mask;
            self.ins_h = h;
            let head = *self.head.get_unchecked(h);
            *self.prev.get_unchecked_mut(pos & self.w_mask) = head;
            *self.head.get_unchecked_mut(h) = pos as u16;
            head as usize
        }
    }

    fn deflate_fast(&mut self, flush: i32) -> i32 {
        let mut hash_head: usize;
        let mut bflush: bool;
        loop {
            if self.lookahead < MIN_LOOKAHEAD {
                self.fill_window();
                if self.lookahead < MIN_LOOKAHEAD && flush == Z_NO_FLUSH {
                    return BS_NEED_MORE;
                }
                if self.lookahead == 0 {
                    break;
                }
            }
            hash_head = 0;
            if self.lookahead >= MIN_MATCH {
                hash_head = self.insert_string(self.strstart);
            }
            if hash_head != 0 && (self.strstart - hash_head) <= (self.w_size - MIN_LOOKAHEAD) {
                self.match_length = self.longest_match(hash_head);
            }
            if self.match_length >= MIN_MATCH {
                bflush = self.tr_tally(self.strstart - self.match_start, self.match_length - MIN_MATCH);
                self.lookahead -= self.match_length;
                if self.match_length <= self.max_lazy_match && self.lookahead >= MIN_MATCH {
                    self.match_length -= 1;
                    loop {
                        self.strstart += 1;
                        self.insert_string(self.strstart);
                        self.match_length -= 1;
                        if self.match_length == 0 {
                            break;
                        }
                    }
                    self.strstart += 1;
                } else {
                    self.strstart += self.match_length;
                    self.match_length = 0;
                    self.ins_h = self.window[self.strstart] as usize;
                    self.ins_h = self.hash(self.ins_h, self.window[self.strstart + 1]);
                }
            } else {
                let c = self.window[self.strstart] as usize;
                bflush = self.tr_tally(0, c);
                self.lookahead -= 1;
                self.strstart += 1;
            }
            if bflush {
                self.flush_block_only(false);
                if self.avail_out == 0 {
                    return BS_NEED_MORE;
                }
            }
        }
        self.insert = if self.strstart < MIN_MATCH - 1 { self.strstart } else { MIN_MATCH - 1 };
        if flush == Z_FINISH {
            self.flush_block_only(true);
            if self.avail_out == 0 {
                return BS_FINISH_STARTED;
            }
            return BS_FINISH_DONE;
        }
        if self.sym_next != 0 {
            self.flush_block_only(false);
            if self.avail_out == 0 {
                return BS_NEED_MORE;
            }
        }
        BS_BLOCK_DONE
    }

    fn deflate_slow(&mut self, flush: i32) -> i32 {
        let mut hash_head: usize;
        let mut bflush: bool;
        loop {
            if self.lookahead < MIN_LOOKAHEAD {
                self.fill_window();
                if self.lookahead < MIN_LOOKAHEAD && flush == Z_NO_FLUSH {
                    return BS_NEED_MORE;
                }
                if self.lookahead == 0 {
                    break;
                }
            }
            hash_head = 0;
            if self.lookahead >= MIN_MATCH {
                hash_head = self.insert_string(self.strstart);
            }
            self.prev_length = self.match_length;
            self.prev_match = self.match_start;
            self.match_length = MIN_MATCH - 1;
            if hash_head != 0 && self.prev_length < self.max_lazy_match && self.strstart - hash_head <= (self.w_size - MIN_LOOKAHEAD) {
                self.match_length = self.longest_match(hash_head);
                if self.match_length <= 5
                    && (self.strategy == Z_FILTERED || (self.match_length == MIN_MATCH && self.strstart - self.match_start > 4096))
                {
                    self.match_length = MIN_MATCH - 1;
                }
            }
            if self.prev_length >= MIN_MATCH && self.match_length <= self.prev_length {
                let max_insert = self.strstart + self.lookahead - MIN_MATCH;
                bflush = self.tr_tally(self.strstart - 1 - self.prev_match, self.prev_length - MIN_MATCH);
                self.lookahead -= self.prev_length - 1;
                self.prev_length -= 2;
                loop {
                    self.strstart += 1;
                    if self.strstart <= max_insert {
                        self.insert_string(self.strstart);
                    }
                    self.prev_length -= 1;
                    if self.prev_length == 0 {
                        break;
                    }
                }
                self.match_available = false;
                self.match_length = MIN_MATCH - 1;
                self.strstart += 1;
                if bflush {
                    self.flush_block_only(false);
                    if self.avail_out == 0 {
                        return BS_NEED_MORE;
                    }
                }
            } else if self.match_available {
                let c = self.window[self.strstart - 1] as usize;
                bflush = self.tr_tally(0, c);
                if bflush {
                    self.flush_block_only(false);
                }
                self.strstart += 1;
                self.lookahead -= 1;
                if self.avail_out == 0 {
                    return BS_NEED_MORE;
                }
            } else {
                self.match_available = true;
                self.strstart += 1;
                self.lookahead -= 1;
            }
        }
        if self.match_available {
            let c = self.window[self.strstart - 1] as usize;
            self.tr_tally(0, c);
            self.match_available = false;
        }
        self.insert = if self.strstart < MIN_MATCH - 1 { self.strstart } else { MIN_MATCH - 1 };
        if flush == Z_FINISH {
            self.flush_block_only(true);
            if self.avail_out == 0 {
                return BS_FINISH_STARTED;
            }
            return BS_FINISH_DONE;
        }
        if self.sym_next != 0 {
            self.flush_block_only(false);
            if self.avail_out == 0 {
                return BS_NEED_MORE;
            }
        }
        BS_BLOCK_DONE
    }

    fn deflate_rle(&mut self, flush: i32) -> i32 {
        let mut bflush: bool;
        loop {
            if self.lookahead <= MAX_MATCH {
                self.fill_window();
                if self.lookahead <= MAX_MATCH && flush == Z_NO_FLUSH {
                    return BS_NEED_MORE;
                }
                if self.lookahead == 0 {
                    break;
                }
            }
            self.match_length = 0;
            if self.lookahead >= MIN_MATCH && self.strstart > 0 {
                let win = &self.window;
                let mut scan = self.strstart - 1;
                let prev = win[scan];
                if prev == win[scan + 1] && prev == win[scan + 2] && prev == win[scan + 3] {
                    scan += 3;
                    let strend = self.strstart + MAX_MATCH;
                    // same termination as the 8x-unrolled JS loop
                    loop {
                        let mut stop = false;
                        for _ in 0..8 {
                            scan += 1;
                            if prev != win[scan] {
                                stop = true;
                                break;
                            }
                        }
                        if stop || scan >= strend {
                            break;
                        }
                    }
                    self.match_length = MAX_MATCH - (strend - scan);
                    if self.match_length > self.lookahead {
                        self.match_length = self.lookahead;
                    }
                }
            }
            if self.match_length >= MIN_MATCH {
                bflush = self.tr_tally(1, self.match_length - MIN_MATCH);
                self.lookahead -= self.match_length;
                self.strstart += self.match_length;
                self.match_length = 0;
            } else {
                let c = self.window[self.strstart] as usize;
                bflush = self.tr_tally(0, c);
                self.lookahead -= 1;
                self.strstart += 1;
            }
            if bflush {
                self.flush_block_only(false);
                if self.avail_out == 0 {
                    return BS_NEED_MORE;
                }
            }
        }
        self.insert = 0;
        if flush == Z_FINISH {
            self.flush_block_only(true);
            if self.avail_out == 0 {
                return BS_FINISH_STARTED;
            }
            return BS_FINISH_DONE;
        }
        if self.sym_next != 0 {
            self.flush_block_only(false);
            if self.avail_out == 0 {
                return BS_NEED_MORE;
            }
        }
        BS_BLOCK_DONE
    }

    fn deflate_huff(&mut self, flush: i32) -> i32 {
        let mut bflush: bool;
        loop {
            if self.lookahead == 0 {
                self.fill_window();
                if self.lookahead == 0 {
                    if flush == Z_NO_FLUSH {
                        return BS_NEED_MORE;
                    }
                    break;
                }
            }
            self.match_length = 0;
            let c = self.window[self.strstart] as usize;
            bflush = self.tr_tally(0, c);
            self.lookahead -= 1;
            self.strstart += 1;
            if bflush {
                self.flush_block_only(false);
                if self.avail_out == 0 {
                    return BS_NEED_MORE;
                }
            }
        }
        self.insert = 0;
        if flush == Z_FINISH {
            self.flush_block_only(true);
            if self.avail_out == 0 {
                return BS_FINISH_STARTED;
            }
            return BS_FINISH_DONE;
        }
        if self.sym_next != 0 {
            self.flush_block_only(false);
            if self.avail_out == 0 {
                return BS_NEED_MORE;
            }
        }
        BS_BLOCK_DONE
    }

    fn state_ok(&self) -> bool {
        matches!(
            self.status,
            INIT_STATE | GZIP_STATE | EXTRA_STATE | NAME_STATE | COMMENT_STATE | HCRC_STATE | BUSY_STATE | FINISH_STATE
        )
    }

    fn err(&mut self, code: i32) -> i32 {
        self.msg = code;
        code
    }

    #[inline(always)]
    fn hcrc_update(&mut self, beg: usize) {
        if self.gzhead.as_ref().map_or(false, |h| h.hcrc) && self.pending > beg {
            self.adler = crc32(self.adler, &self.pending_buf[beg..self.pending]);
        }
    }

    /// deflate(strm, flush) — the zlib state machine (output = self.output)
    pub fn deflate(&mut self, flush: i32) -> i32 {
        if !self.state_ok() || flush > Z_BLOCK || flush < 0 {
            return self.err(Z_STREAM_ERROR);
        }
        if self.output.is_null() || (self.avail_in != 0 && self.input.is_null()) || (self.status == FINISH_STATE && flush != Z_FINISH) {
            let e = if self.avail_out == 0 { Z_BUF_ERROR } else { Z_STREAM_ERROR };
            return self.err(e);
        }
        let old_flush = self.last_flush;
        self.last_flush = flush;
        let rank = |f: i32| f * 2 - if f > 4 { 9 } else { 0 };
        if self.pending != 0 {
            self.flush_pending();
            if self.avail_out == 0 {
                self.last_flush = -1;
                return Z_OK;
            }
        } else if self.avail_in == 0 && rank(flush) <= rank(old_flush) && flush != Z_FINISH {
            return self.err(Z_BUF_ERROR);
        }
        if self.status == FINISH_STATE && self.avail_in != 0 {
            return self.err(Z_BUF_ERROR);
        }
        if self.status == INIT_STATE && self.wrap == 0 {
            self.status = BUSY_STATE;
        }
        if self.status == INIT_STATE {
            let mut header: u32 = (Z_DEFLATED as u32 + ((self.w_bits as u32 - 8) << 4)) << 8;
            let level_flags: u32 = if self.strategy >= Z_HUFFMAN_ONLY || self.level < 2 {
                0
            } else if self.level < 6 {
                1
            } else if self.level == 6 {
                2
            } else {
                3
            };
            header |= level_flags << 6;
            if self.strstart != 0 {
                header |= PRESET_DICT;
            }
            header += 31 - (header % 31);
            self.put_short_msb(header);
            if self.strstart != 0 {
                let a = self.adler;
                self.put_short_msb(a >> 16);
                self.put_short_msb(a & 0xffff);
            }
            self.adler = 1;
            self.status = BUSY_STATE;
            self.flush_pending();
            if self.pending != 0 {
                self.last_flush = -1;
                return Z_OK;
            }
        }
        if self.status == GZIP_STATE {
            self.adler = 0;
            self.put_byte(31);
            self.put_byte(139);
            self.put_byte(8);
            let xfl = if self.level == 9 {
                2
            } else if self.strategy >= Z_HUFFMAN_ONLY || self.level < 2 {
                4
            } else {
                0
            };
            if self.gzhead.is_none() {
                self.put_byte(0);
                self.put_byte(0);
                self.put_byte(0);
                self.put_byte(0);
                self.put_byte(0);
                self.put_byte(xfl);
                self.put_byte(OS_CODE);
                self.status = BUSY_STATE;
                self.flush_pending();
                if self.pending != 0 {
                    self.last_flush = -1;
                    return Z_OK;
                }
            } else {
                let h = self.gzhead.as_ref().unwrap();
                let flags = (h.text as u8)
                    + if h.hcrc { 2 } else { 0 }
                    + if h.extra.is_some() { 4 } else { 0 }
                    + if h.name.is_some() { 8 } else { 0 }
                    + if h.comment.is_some() { 16 } else { 0 };
                let time = h.time;
                let os = h.os;
                let hcrc = h.hcrc;
                let extra_len = h.extra.as_ref().map(|e| e.len());
                self.put_byte(flags);
                self.put_byte((time & 0xff) as u8);
                self.put_byte(((time >> 8) & 0xff) as u8);
                self.put_byte(((time >> 16) & 0xff) as u8);
                self.put_byte(((time >> 24) & 0xff) as u8);
                self.put_byte(xfl);
                self.put_byte(os);
                if let Some(el) = extra_len {
                    if el != 0 {
                        self.put_byte((el & 0xff) as u8);
                        self.put_byte(((el >> 8) & 0xff) as u8);
                    }
                }
                if hcrc {
                    self.adler = crc32(self.adler, &self.pending_buf[..self.pending]);
                }
                self.gzindex = 0;
                self.status = EXTRA_STATE;
            }
        }
        if self.status == EXTRA_STATE {
            if self.gzhead.as_ref().unwrap().extra.is_some() {
                let mut beg = self.pending;
                let extra_len = self.gzhead.as_ref().unwrap().extra.as_ref().unwrap().len();
                let mut left = (extra_len & 0xffff) - self.gzindex;
                while self.pending + left > self.pending_buf_size {
                    let copy = self.pending_buf_size - self.pending;
                    {
                        let h = self.gzhead.as_ref().unwrap();
                        let ex = h.extra.as_ref().unwrap();
                        let p = self.pending;
                        let gi = self.gzindex;
                        self.pending_buf[p..p + copy].copy_from_slice(&ex[gi..gi + copy]);
                    }
                    self.pending = self.pending_buf_size;
                    self.hcrc_update(beg);
                    self.gzindex += copy;
                    self.flush_pending();
                    if self.pending != 0 {
                        self.last_flush = -1;
                        return Z_OK;
                    }
                    beg = 0;
                    left -= copy;
                }
                {
                    let h = self.gzhead.as_ref().unwrap();
                    let ex = h.extra.as_ref().unwrap();
                    let p = self.pending;
                    let gi = self.gzindex;
                    let avail = ex.len().saturating_sub(gi);
                    let n = core::cmp::min(left, avail);
                    self.pending_buf[p..p + n].copy_from_slice(&ex[gi..gi + n]);
                }
                self.pending += left;
                self.hcrc_update(beg);
                self.gzindex = 0;
            }
            self.status = NAME_STATE;
        }
        if self.status == NAME_STATE {
            if self.gzhead.as_ref().unwrap().name.is_some() {
                let mut beg = self.pending;
                loop {
                    if self.pending == self.pending_buf_size {
                        self.hcrc_update(beg);
                        self.flush_pending();
                        if self.pending != 0 {
                            self.last_flush = -1;
                            return Z_OK;
                        }
                        beg = 0;
                    }
                    let val = {
                        let name = self.gzhead.as_ref().unwrap().name.as_ref().unwrap();
                        if self.gzindex < name.len() {
                            let v = name[self.gzindex];
                            self.gzindex += 1;
                            v
                        } else {
                            0
                        }
                    };
                    self.put_byte(val);
                    if val == 0 {
                        break;
                    }
                }
                self.hcrc_update(beg);
                self.gzindex = 0;
            }
            self.status = COMMENT_STATE;
        }
        if self.status == COMMENT_STATE {
            if self.gzhead.as_ref().unwrap().comment.is_some() {
                let mut beg = self.pending;
                loop {
                    if self.pending == self.pending_buf_size {
                        self.hcrc_update(beg);
                        self.flush_pending();
                        if self.pending != 0 {
                            self.last_flush = -1;
                            return Z_OK;
                        }
                        beg = 0;
                    }
                    let val = {
                        let c = self.gzhead.as_ref().unwrap().comment.as_ref().unwrap();
                        if self.gzindex < c.len() {
                            let v = c[self.gzindex];
                            self.gzindex += 1;
                            v
                        } else {
                            0
                        }
                    };
                    self.put_byte(val);
                    if val == 0 {
                        break;
                    }
                }
                self.hcrc_update(beg);
            }
            self.status = HCRC_STATE;
        }
        if self.status == HCRC_STATE {
            if self.gzhead.as_ref().unwrap().hcrc {
                if self.pending + 2 > self.pending_buf_size {
                    self.flush_pending();
                    if self.pending != 0 {
                        self.last_flush = -1;
                        return Z_OK;
                    }
                }
                let a = self.adler;
                self.put_byte((a & 0xff) as u8);
                self.put_byte(((a >> 8) & 0xff) as u8);
                self.adler = 0;
            }
            self.status = BUSY_STATE;
            self.flush_pending();
            if self.pending != 0 {
                self.last_flush = -1;
                return Z_OK;
            }
        }
        if self.avail_in != 0 || self.lookahead != 0 || (flush != Z_NO_FLUSH && self.status != FINISH_STATE) {
            let bstate = if self.level == 0 {
                self.deflate_stored(flush)
            } else if self.strategy == Z_HUFFMAN_ONLY {
                self.deflate_huff(flush)
            } else if self.strategy == Z_RLE {
                self.deflate_rle(flush)
            } else if CONFIG[self.level as usize].func == 1 {
                self.deflate_fast(flush)
            } else {
                self.deflate_slow(flush)
            };
            if bstate == BS_FINISH_STARTED || bstate == BS_FINISH_DONE {
                self.status = FINISH_STATE;
            }
            if bstate == BS_NEED_MORE || bstate == BS_FINISH_STARTED {
                if self.avail_out == 0 {
                    self.last_flush = -1;
                }
                return Z_OK;
            }
            if bstate == BS_BLOCK_DONE {
                if flush == Z_PARTIAL_FLUSH {
                    self.tr_align();
                } else if flush != Z_BLOCK {
                    self.tr_stored_block(0, 0, false);
                    if flush == Z_FULL_FLUSH {
                        let hs = self.hash_size;
                        self.head[..hs].fill(0);
                        if self.lookahead == 0 {
                            self.strstart = 0;
                            self.block_start = 0;
                            self.insert = 0;
                        }
                    }
                }
                self.flush_pending();
                if self.avail_out == 0 {
                    self.last_flush = -1;
                    return Z_OK;
                }
            }
        }
        if flush != Z_FINISH {
            return Z_OK;
        }
        if self.wrap <= 0 {
            return Z_STREAM_END;
        }
        if self.wrap == 2 {
            let a = self.adler;
            let t = self.total_in as u32;
            self.put_byte((a & 0xff) as u8);
            self.put_byte(((a >> 8) & 0xff) as u8);
            self.put_byte(((a >> 16) & 0xff) as u8);
            self.put_byte(((a >> 24) & 0xff) as u8);
            self.put_byte((t & 0xff) as u8);
            self.put_byte(((t >> 8) & 0xff) as u8);
            self.put_byte(((t >> 16) & 0xff) as u8);
            self.put_byte(((t >> 24) & 0xff) as u8);
        } else {
            let a = self.adler;
            self.put_short_msb(a >> 16);
            self.put_short_msb(a & 0xffff);
        }
        self.flush_pending();
        if self.wrap > 0 {
            self.wrap = -self.wrap;
        }
        if self.pending != 0 {
            Z_OK
        } else {
            Z_STREAM_END
        }
    }

    /// deflateEnd status (state is kept for reuse by the caller)
    pub fn end_status(&mut self) -> i32 {
        if !self.state_ok() {
            return Z_STREAM_ERROR;
        }
        let status = self.status;
        self.status = 0; // no longer valid (pako sets strm.state = null)
        if status == BUSY_STATE {
            self.msg = MSG_DATA_ERROR;
            Z_DATA_ERROR
        } else {
            Z_OK
        }
    }

    pub fn set_header(&mut self, head: GzHead) -> i32 {
        if !self.state_ok() || self.wrap != 2 {
            return Z_STREAM_ERROR;
        }
        self.gzhead = Some(head);
        Z_OK
    }

    pub fn set_dictionary(&mut self, dictionary: &[u8]) -> i32 {
        let mut dict_length = dictionary.len();
        if !self.state_ok() {
            return Z_STREAM_ERROR;
        }
        let wrap = self.wrap;
        if wrap == 2 || (wrap == 1 && self.status != INIT_STATE) || self.lookahead != 0 {
            return Z_STREAM_ERROR;
        }
        if wrap == 1 {
            self.adler = adler32(self.adler, dictionary);
        }
        self.wrap = 0;
        let mut dict = dictionary;
        if dict_length >= self.w_size {
            if wrap == 0 {
                let hs = self.hash_size;
                self.head[..hs].fill(0);
                self.strstart = 0;
                self.block_start = 0;
                self.insert = 0;
            }
            dict = &dictionary[dict_length - self.w_size..dict_length];
            dict_length = self.w_size;
        }
        let avail = self.avail_in;
        let next = self.next_in;
        let input = self.input;
        self.avail_in = dict_length;
        self.next_in = 0;
        self.input = dict.as_ptr();
        self.fill_window();
        while self.lookahead >= MIN_MATCH {
            let mut str = self.strstart;
            let mut n = self.lookahead - (MIN_MATCH - 1);
            loop {
                self.ins_h = self.hash(self.ins_h, self.window[str + MIN_MATCH - 1]);
                self.prev[str & self.w_mask] = self.head[self.ins_h];
                self.head[self.ins_h] = str as u16;
                str += 1;
                n -= 1;
                if n == 0 {
                    break;
                }
            }
            self.strstart = str;
            self.lookahead = MIN_MATCH - 1;
            self.fill_window();
        }
        self.strstart += self.lookahead;
        self.block_start = self.strstart as isize;
        self.insert = self.lookahead;
        self.lookahead = 0;
        self.match_length = MIN_MATCH - 1;
        self.prev_length = MIN_MATCH - 1;
        self.match_available = false;
        self.next_in = next;
        self.input = input;
        self.avail_in = avail;
        self.wrap = wrap;
        Z_OK
    }
}
