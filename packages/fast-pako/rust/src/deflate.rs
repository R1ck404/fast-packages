// Port of pako/lib/zlib/deflate.js (zlib 1.2.12 deflate.c as ported by pako).
// Every decision (hash chains, lazy matching, block flushing, stored-block
// sizing, window sliding) is kept identical so the output is byte-identical
// to pako. Speed comes from: 8-byte-at-a-time match comparison, unchecked
// indexing in the hot loops, 64-bit bit output (trees.rs), fast checksums,
// and reusing buffers instead of reallocating per stream.

use alloc::boxed::Box;
use alloc::vec;
use alloc::vec::Vec;
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
const Z_UNKNOWN: i32 = 2;

// Parameter flags. The JS glue runs pako's option handling (deflateInit2's
// checks, JS comparisons and coercions included) and passes the outcome;
// e.g. a level of "0" (string) is not `=== 0` but still indexes the
// configuration table and is not `> 0`.
/// level === 0: deflate_stored before any strategy
pub const F_STRICT0: u32 = 1;
/// level > 0 (otherwise _tr_flush_block forces stored blocks)
pub const F_GT0: u32 = 2;
/// strategy === Z_FILTERED
pub const F_FILTERED: u32 = 4;
/// strategy === Z_HUFFMAN_ONLY
pub const F_HUFF: u32 = 8;
/// strategy === Z_RLE
pub const F_RLE: u32 = 16;
/// strategy === Z_FIXED
pub const F_FIXED: u32 = 32;

const MIN_LOOKAHEAD: usize = MAX_MATCH + MIN_MATCH + 1;

const INIT_STATE: i32 = 42;
const GZIP_STATE: i32 = 57;
const BUSY_STATE: i32 = 113;
const FINISH_STATE: i32 = 666;

const BS_NEED_MORE: i32 = 1;
const BS_BLOCK_DONE: i32 = 2;
const BS_FINISH_STARTED: i32 = 3;
const BS_FINISH_DONE: i32 = 4;

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
    func: u8, // 0 stored, 1 fast, 2 slow, 3 not a function (see deflate())
}

const CONFIG: [Config; 11] = [
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
    // a level that indexes something else on pako's configuration table
    // (e.g. "length"): its .func is called on the first deflate() call
    Config { good_length: 0, max_lazy: 0, nice_length: 0, max_chain: 0, func: 3 },
];

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
    /// the zlib or gzip header (built by the JS glue), written by deflate()
    /// through pending_buf like pako's header states
    pub hdr: Vec<u8>,
    pub hdr_pos: usize,
    /// header bytes covered by the gzip header crc: [hdr_c0, hdr_crc)
    /// (hdr_crc 0: no FHCRC)
    pub hdr_crc: usize,
    pub hdr_c0: usize,
    /// input is read through js_op (not a Uint8Array: pako's subarray+set)
    pub ext: bool,
    pub last_flush: i32,
    pub w_size: usize,
    pub w_mask: usize,
    pub window: Vec<u8>,
    pub window_size: usize,
    pub prev: Vec<u16>,
    pub head: Vec<u16>,
    pub ins_h: usize,
    pub hash_size: usize,
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
    /// index into CONFIG (the configuration_table entry pako's level selects)
    pub cfg: usize,
    /// F_* flags
    pub flags: u32,
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
    /// MAX_MATCH, read from memory: a constant bound gets the compare loop
    /// of longest_match fully unrolled (32 copies in deflate_fast and _slow)
    pub cmp_max: usize,
}

impl Deflate {
    /// An empty state: reinit() (deflateInit2) validates the parameters,
    /// allocates the buffers and sets every field like a fresh pako state.
    pub fn new() -> Box<Deflate> {
        crate::trees::init_tables();
        Box::new(Deflate {
            input: core::ptr::null(),
            next_in: 0,
            avail_in: 0,
            total_in: 0,
            output: core::ptr::null_mut(),
            next_out: 0,
            avail_out: 0,
            total_out: 0,
            msg: MSG_NONE,
            data_type: 0,
            adler: 0,
            status: 0,
            pending_buf: Vec::new(),
            pending_buf_size: 0,
            pending_out: 0,
            pending: 0,
            wrap: 0,
            hdr: Vec::new(),
            hdr_pos: 0,
            hdr_crc: 0,
            hdr_c0: 0,
            ext: false,
            last_flush: 0,
            w_size: 0,
            w_mask: 0,
            window: Vec::new(),
            window_size: 0,
            prev: Vec::new(),
            head: Vec::new(),
            ins_h: 0,
            hash_size: 0,
            hash_mask: 0,
            hash_shift: 0,
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
            cfg: 0,
            flags: 0,
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
            sym_buf: Vec::new(),
            lit_bufsize: 0,
            sym_next: 0,
            sym_end: 0,
            opt_len: 0,
            static_len: 0,
            matches: 0,
            insert: 0,
            bi_buf: 0,
            bi_valid: 0,
            win_dirty: 0,
            ctab: [0; crate::trees::CT_SIZE],
            hkey: [0; HEAP_SIZE],
            cmp_max: MAX_MATCH,
        })
    }

    /// Re-initialize an existing state for new parameters, reusing buffers
    /// when the sizes allow (equivalent to a freshly allocated pako state).
    /// The parameters are deflateInit2's, already validated and derived by
    /// the JS glue: CONFIG index, F_* flags, wrap, log2 of the window, hash
    /// table and literal buffer sizes, and the hash shift (all as pako
    /// computes them, e.g. with a string memLevel).
    pub fn reinit(&mut self, cfg: usize, flags: u32, wrap: i32, w_log: usize, hash_log: usize, hash_shift: usize, lit_log: usize) {
        let w_size = 1usize << w_log;
        let hash_size = 1usize << hash_log;
        let lit_bufsize = 1usize << lit_log;
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
        self.hdr.clear();
        self.hdr_pos = 0;
        self.hdr_crc = 0;
        self.last_flush = -1;
        self.w_size = w_size;
        self.w_mask = w_size - 1;
        self.hash_size = hash_size;
        self.hash_mask = hash_size - 1;
        self.hash_shift = hash_shift;
        self.lit_bufsize = lit_bufsize;
        self.sym_end = (lit_bufsize - 1) * 3;
        self.cfg = cfg;
        self.flags = flags;
        self.dyn_ltree = [0; HEAP_SIZE * 2];
        self.dyn_dtree = [0; (2 * D_CODES + 1) * 2];
        self.bl_tree = [0; (2 * BL_CODES + 1) * 2];
        self.heap = [0; 2 * L_CODES + 1];
        self.depth = [0; 2 * L_CODES + 1];
        self.bl_count = [0; MAX_BITS + 1];
        self.match_start = 0;
        self.prev_match = 0;
        self.reset();
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
        let c = CONFIG[self.cfg];
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
        slide(&mut self.head[..self.hash_size], wsize);
        slide(&mut self.prev[..self.w_size], wsize);
    }

    #[inline(never)]
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

    /// append bytes to pending_buf (headers, trailers)
    #[inline(never)]
    fn put_bytes(&mut self, b: &[u8]) {
        let p = self.pending;
        self.pending_buf[p..p + b.len()].copy_from_slice(b);
        self.pending += b.len();
    }

    /// Copy input[from..from + n] to dst: the bytes of a Uint8Array, or (ext)
    /// through the JS glue with pako's own `buf.set(strm.input.subarray(..))`,
    /// which converts other typed arrays and throws for anything else.
    #[inline(always)]
    unsafe fn copy_in(&self, from: usize, dst: *mut u8, n: usize) {
        if self.ext {
            crate::js_op(crate::OP_DCOPY, from, n, dst as usize);
        } else {
            core::ptr::copy_nonoverlapping(self.input.add(from), dst, n);
        }
    }

    /// pako's read_buf into `dst` (the window, or the output for
    /// deflate_stored); returns the number of bytes read
    fn read_buf(&mut self, dst: *mut u8, size: usize) -> usize {
        let mut len = self.avail_in;
        if len > size {
            len = size;
        }
        if len == 0 {
            return 0;
        }
        self.avail_in -= len;
        let src = unsafe {
            self.copy_in(self.next_in, dst, len);
            core::slice::from_raw_parts(dst, len)
        };
        if self.wrap == 1 {
            self.adler = adler32(self.adler, src);
        } else if self.wrap == 2 {
            self.adler = crc32(self.adler, src);
        }
        self.next_in += len;
        self.total_in += len as u64;
        len
    }

    /// read_buf into the window at `start`
    fn read_buf_window(&mut self, start: usize, size: usize) -> usize {
        let dst = unsafe { self.window.as_mut_ptr().add(start) };
        let n = self.read_buf(dst, size);
        if start + n > self.win_dirty {
            self.win_dirty = start + n;
        }
        n
    }

    /// read_buf directly into the output (deflate_stored)
    fn read_buf_output(&mut self, len0: usize) -> usize {
        self.read_buf(unsafe { self.output.add(self.next_out) }, len0)
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
            let max_match = self.cmp_max;
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
                        if len >= max_match {
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
                let ws = self.w_size;
                let dst = self.window.as_mut_ptr();
                unsafe { self.copy_in(self.next_in - ws, dst, ws) };
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
                let ss = self.strstart;
                let dst = unsafe { self.window.as_mut_ptr().add(ss) };
                unsafe { self.copy_in(self.next_in - used, dst, used) };
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
                    && (self.flags & F_FILTERED != 0 || (self.match_length == MIN_MATCH && self.strstart - self.match_start > 4096))
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
        matches!(self.status, INIT_STATE | GZIP_STATE | BUSY_STATE | FINISH_STATE)
    }

    fn err(&mut self, code: i32) -> i32 {
        self.msg = code;
        code
    }

    /// pako's header states (INIT_STATE, GZIP_STATE .. HCRC_STATE): the
    /// header bytes, built by the JS glue (set_header), go through
    /// pending_buf, which is flushed whenever it is full, with the gzip
    /// header crc in strm.adler updated before every flush. Returns true
    /// when deflate() has to return Z_OK (output full).
    #[cold]
    #[inline(never)]
    fn write_header(&mut self) -> bool {
        if self.wrap == 2 && self.hdr_pos == 0 {
            self.adler = 0;
        }
        loop {
            let pos = self.hdr_pos;
            let n = core::cmp::min(self.hdr.len() - pos, self.pending_buf_size - self.pending);
            let p = self.pending;
            self.pending_buf[p..p + n].copy_from_slice(&self.hdr[pos..pos + n]);
            if pos + n > self.hdr_c0 && pos < self.hdr_crc {
                let a = core::cmp::max(pos, self.hdr_c0);
                let e = core::cmp::min(pos + n, self.hdr_crc);
                self.adler = crc32(self.adler, &self.hdr[a..e]);
            }
            self.pending += n;
            self.hdr_pos += n;
            if self.hdr_pos == self.hdr.len() {
                break;
            }
            self.flush_pending();
            if self.pending != 0 {
                return true;
            }
        }
        self.adler = if self.wrap == 2 { 0 } else { 1 };
        self.status = BUSY_STATE;
        self.flush_pending();
        self.pending != 0
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
        if self.status != BUSY_STATE && self.status != FINISH_STATE && self.write_header() {
            self.last_flush = -1;
            return Z_OK;
        }
        if self.avail_in != 0 || self.lookahead != 0 || (flush != Z_NO_FLUSH && self.status != FINISH_STATE) {
            let f = self.flags;
            let func = CONFIG[self.cfg].func;
            let bstate = if f & F_STRICT0 != 0 || (f & (F_HUFF | F_RLE) == 0 && func == 0) {
                self.deflate_stored(flush)
            } else if f & F_HUFF != 0 {
                self.deflate_huff(flush)
            } else if f & F_RLE != 0 {
                self.deflate_rle(flush)
            } else if func == 1 {
                self.deflate_fast(flush)
            } else if func == 2 {
                self.deflate_slow(flush)
            } else {
                // pako: configuration_table[s.level].func(s, flush) throws
                crate::js_throw(crate::OP_NOFUNC)
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
            let mut t8 = [0u8; 8];
            t8[..4].copy_from_slice(&self.adler.to_le_bytes());
            t8[4..].copy_from_slice(&(self.total_in as u32).to_le_bytes());
            self.put_bytes(&t8);
        } else {
            self.put_bytes(&self.adler.to_be_bytes());
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

    /// The header bytes (built by the JS glue from pako's header options),
    /// whether pako appends a header crc (then computed here) and where the
    /// bytes it covers begin (after bytes of failed attempts).
    pub fn set_header(&mut self, blob: &[u8], hcrc: bool, c0: usize) {
        self.hdr.clear();
        self.hdr.extend_from_slice(blob);
        self.hdr_pos = 0;
        self.hdr_crc = 0;
        self.hdr_c0 = c0;
        if hcrc {
            let c = crc32(0, &blob[c0..]);
            self.hdr.extend_from_slice(&[c as u8, (c >> 8) as u8]);
            self.hdr_crc = blob.len();
        }
    }

    /// deflateSetDictionary. `adler`: the dictionary's check value when the
    /// JS glue computed it (pako's adler32 over the raw element values of a
    /// dictionary that is not a Uint8Array).
    pub fn set_dictionary(&mut self, dictionary: &[u8], adler: Option<u32>) -> i32 {
        let mut dict_length = dictionary.len();
        if !self.state_ok() {
            return Z_STREAM_ERROR;
        }
        let wrap = self.wrap;
        if wrap == 2 || (wrap == 1 && self.status != INIT_STATE) || self.lookahead != 0 {
            return Z_STREAM_ERROR;
        }
        if wrap == 1 {
            self.adler = match adler {
                Some(a) => a,
                None => adler32(self.adler, dictionary),
            };
        }
        self.wrap = 0;
        let ext = self.ext;
        self.ext = false;
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
        self.ext = ext;
        Z_OK
    }
}

/// m = max(m - w, 0) for every entry (explicit SIMD: the crate is built
/// without auto-vectorization, which mostly bloated cold code)
fn slide(v: &mut [u16], w: u16) {
    let mut chunks = v.chunks_exact_mut(8);
    #[cfg(target_arch = "wasm32")]
    {
        use core::arch::wasm32::*;
        let ws = u16x8_splat(w);
        for c in &mut chunks {
            unsafe {
                let q = c.as_mut_ptr() as *mut v128;
                v128_store(q, u16x8_sub_sat(v128_load(q), ws));
            }
        }
    }
    for m in chunks.into_remainder() {
        *m = m.saturating_sub(w);
    }
}
