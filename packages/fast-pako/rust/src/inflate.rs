// Port of pako/lib/zlib/inflate.js (+ inffast.js). The state machine is kept
// case-for-case identical, including pako quirks (dmax = 1 << wbits for zlib
// streams, and updatewindow() never re-initializing wsize after
// inflateReset). The inner decode loop is a new implementation: 64-bit bit
// buffer with branchless refill, 16-byte match copies. At every point where
// control returns to the slow path the bit buffer is canonical (fewer than 8
// bits held, unused whole bytes given back), which is exactly the state the
// original produces, so all externally visible state matches.
//
// Only one decode table per code is built (fasttab.rs); zlib's own tables
// for literal/length and distance codes are not: inflate_table()'s accept/
// reject rules are applied to the code lengths (code_ok), and the slow path
// decodes from the fast table with zlib's pull/drop behaviour (a code whose
// length fits the held bits is determined by them, so the number of bytes
// pulled only depends on the code length; invalid entries carry the length
// zlib's table gives them). One-shot sessions (contiguous output) also skip
// the window copies (the window is the output right before the current
// position) and compute each member's check value at its CHECK state.

use crate::checksum::{adler32, crc32};
use crate::inftrees::{code_ok, inflate_table, CODES, DISTS, LENS};

pub const Z_NO_FLUSH: i32 = 0;
pub const Z_FINISH: i32 = 4;
pub const Z_BLOCK: i32 = 5;
pub const Z_TREES: i32 = 6;
pub const Z_OK: i32 = 0;
pub const Z_STREAM_END: i32 = 1;
pub const Z_NEED_DICT: i32 = 2;
pub const Z_STREAM_ERROR: i32 = -2;
pub const Z_DATA_ERROR: i32 = -3;
pub const Z_MEM_ERROR: i32 = -4;
pub const Z_BUF_ERROR: i32 = -5;
const Z_DEFLATED: u64 = 8;

// modes
pub const HEAD: u32 = 16180;
const FLAGS: u32 = 16181;
const TIME: u32 = 16182;
const OS: u32 = 16183;
const EXLEN: u32 = 16184;
const EXTRA: u32 = 16185;
const NAME: u32 = 16186;
const COMMENT: u32 = 16187;
const HCRC: u32 = 16188;
const DICTID: u32 = 16189;
const DICT: u32 = 16190;
pub const TYPE: u32 = 16191;
const TYPEDO: u32 = 16192;
const STORED: u32 = 16193;
const COPY_: u32 = 16194;
const COPY: u32 = 16195;
const TABLE: u32 = 16196;
const LENLENS: u32 = 16197;
const CODELENS: u32 = 16198;
const LEN_: u32 = 16199;
const LEN: u32 = 16200;
const LENEXT: u32 = 16201;
const DIST: u32 = 16202;
const DISTEXT: u32 = 16203;
const MATCH: u32 = 16204;
const LIT: u32 = 16205;
const CHECK: u32 = 16206;
const LENGTH: u32 = 16207;
const DONE: u32 = 16208;
pub const BAD: u32 = 16209;
const MEM: u32 = 16210;
const SYNC: u32 = 16211;

// strm.msg ids (strings live in JS)
pub const M_NONE: u8 = 0;
pub const M_INCORRECT_HEADER: u8 = 1;
pub const M_UNKNOWN_METHOD: u8 = 2;
pub const M_INVALID_WINDOW: u8 = 3;
pub const M_UNKNOWN_FLAGS: u8 = 4;
pub const M_HEADER_CRC: u8 = 5;
pub const M_INVALID_BLOCK_TYPE: u8 = 6;
pub const M_INVALID_STORED: u8 = 7;
pub const M_TOO_MANY: u8 = 8;
pub const M_INVALID_CODE_LENGTHS: u8 = 9;
pub const M_INVALID_REPEAT: u8 = 10;
pub const M_MISSING_EOB: u8 = 11;
pub const M_INVALID_LITLEN_SET: u8 = 12;
pub const M_INVALID_DIST_SET: u8 = 13;
pub const M_INVALID_LITLEN_CODE: u8 = 14;
pub const M_INVALID_DIST_CODE: u8 = 15;
pub const M_TOO_FAR: u8 = 16;
pub const M_DATA_CHECK: u8 = 17;
pub const M_LENGTH_CHECK: u8 = 18;



/// code-length code table (zlib inflate_table, 7-bit root, no subtables)
const LEN_TABLE: usize = 128;


static ORDER: [u8; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

use crate::fasttab::{EOB as EOB_F, EXC as EXC_F, LIT as LIT_F, SUB as SUB_F};
const LMASK: u64 = (1 << crate::fasttab::LBITS) - 1;
const DMASK: u64 = (1 << crate::fasttab::DBITS) - 1;

/// bits of the code (not its extra bits) a literal/length table entry needs
#[inline(always)]
fn lneed(e: u32) -> u32 {
    if e & (LIT_F | EXC_F) != 0 {
        e & 0xff
    } else {
        (e >> 8) & 0xf
    }
}

/// same for a distance table entry
#[inline(always)]
fn dneed(e: u32) -> u32 {
    if e & EXC_F != 0 {
        e & 0xff
    } else {
        (e >> 8) & 0xf
    }
}

pub struct Head {
    pub active: bool,
    pub text: u32,
    pub time: u32,
    pub xflags: u32,
    pub os: u32,
    pub extra: Option<Vec<u8>>,
    pub extra_len: u32,
    pub name: Option<Vec<u8>>,
    pub comment: Option<Vec<u8>>,
    pub hcrc: u32,
    pub done: bool,
    pub version: u32,
}

impl Head {
    pub fn new() -> Head {
        Head {
            active: false,
            text: 0,
            time: 0,
            xflags: 0,
            os: 0,
            extra: None,
            extra_len: 0,
            name: Some(Vec::new()),
            comment: Some(Vec::new()),
            hcrc: 0,
            done: false,
            version: 0,
        }
    }
}

static mut FIXED_FAST: Option<Box<[u32; crate::fasttab::TSIZE]>> = None;

/// fast tables for the fixed code (literal/length at 0, distance at LSIZE)
#[allow(static_mut_refs)]
#[inline(always)]
fn fixed_fast() -> *const u32 {
    unsafe {
        if FIXED_FAST.is_none() {
            init_fixed_fast();
        }
        FIXED_FAST.as_ref().unwrap().as_ptr()
    }
}

#[inline(never)]
#[cold]
#[allow(static_mut_refs)]
fn init_fixed_fast() {
    unsafe {
        if FIXED_FAST.is_none() {
            let mut lens = [0u16; 288];
            for (i, l) in lens.iter_mut().enumerate() {
                *l = if i < 144 { 8 } else if i < 256 { 9 } else if i < 280 { 7 } else { 8 };
            }
            let mut t = Box::new([0u32; crate::fasttab::TSIZE]);
            crate::fasttab::build(&lens, 288, &crate::fasttab::count_lens(&lens), true, &mut t[..crate::fasttab::LSIZE]);
            let d = [5u16; 32];
            crate::fasttab::build(&d, 32, &crate::fasttab::count_lens(&d), false, &mut t[crate::fasttab::LSIZE..]);
            FIXED_FAST = Some(t);
        }
    }
}

pub static mut FAST_ON: bool = true;
#[no_mangle]
pub extern "C" fn fz_set_fast(on: i32) { unsafe { FAST_ON = on != 0 } }
#[no_mangle]
pub static mut DBG_ITERS: u32 = 0;

pub struct Inflate {
    // z_stream
    pub input: *const u8,
    pub next_in: usize,
    pub avail_in: usize,
    pub total_in: u64,
    pub output: *mut u8,
    pub next_out: usize,
    pub avail_out: usize,
    pub total_out: u64,
    pub msg: u8,
    pub adler: u32,
    pub data_type: i32,
    pub valid: bool,
    // state
    pub mode: u32,
    last: bool,
    pub wrap: i32,
    havedict: bool,
    flags: i32,
    dmax: u32,
    check: u32,
    total: u64,
    pub head: Head,
    wbits: u32,
    wsize: usize,
    whave: usize,
    wnext: usize,
    window: Option<Vec<u8>>,
    win_present: bool,
    hold: u64,
    bits: u32,
    length: u32,
    offset: u32,
    extra: u32,
    use_fixed: bool,
    lenbits: u32,
    distbits: u32,
    ncode: u32,
    nlen: u32,
    ndist: u32,
    have: u32,
    lens: [u16; 320],
    work: [u16; 288],
    lendyn: Box<[u32; LEN_TABLE]>,
    ftab: Box<[u32; crate::fasttab::TSIZE]>,
    pub contiguous: bool,
    /// one-shot: the check value of a member is computed at its CHECK state
    /// over the (contiguous) output instead of per call (not observable)
    pub defer_check: bool,
    /// start of the session output buffer (offsets survive reallocation)
    pub out_base: *const u8,
    chk_off: usize,
    sane: bool,
    back: i32,
    was: u32,
}

impl Inflate {
    pub fn new(window_bits: i32) -> Result<Box<Inflate>, i32> {
        let mut s = Box::new(Inflate {
            input: core::ptr::null(),
            next_in: 0,
            avail_in: 0,
            total_in: 0,
            output: core::ptr::null_mut(),
            next_out: 0,
            avail_out: 0,
            total_out: 0,
            msg: M_NONE,
            adler: 0,
            data_type: 0,
            valid: true,
            mode: HEAD,
            last: false,
            wrap: 0,
            havedict: false,
            flags: 0,
            dmax: 0,
            check: 0,
            total: 0,
            head: Head::new(),
            wbits: 0,
            wsize: 0,
            whave: 0,
            wnext: 0,
            window: None,
            win_present: false,
            hold: 0,
            bits: 0,
            length: 0,
            offset: 0,
            extra: 0,
            use_fixed: false,
            lenbits: 0,
            distbits: 0,
            ncode: 0,
            nlen: 0,
            ndist: 0,
            have: 0,
            lens: [0; 320],
            work: [0; 288],
            lendyn: Box::new([0; LEN_TABLE]),
            ftab: Box::new([0; crate::fasttab::TSIZE]),
            contiguous: false,
            defer_check: false,
            out_base: core::ptr::null(),
            chk_off: 0,
            sane: true,
            back: 0,
            was: 0,
        });
        let r = s.reset2(window_bits);
        if r != Z_OK {
            return Err(r);
        }
        Ok(s)
    }

    /// Reuse an existing state as if freshly created by inflateInit2.
    pub fn reinit(&mut self, window_bits: i32) -> i32 {
        self.input = core::ptr::null();
        self.next_in = 0;
        self.avail_in = 0;
        self.total_in = 0;
        self.output = core::ptr::null_mut();
        self.next_out = 0;
        self.avail_out = 0;
        self.total_out = 0;
        self.msg = M_NONE;
        self.adler = 0;
        self.data_type = 0;
        self.valid = true;
        self.head = Head::new();
        self.window_reset_for_init();
        self.mode = HEAD;
        self.reset2(window_bits)
    }

    fn window_reset_for_init(&mut self) {
        // a fresh pako state has window === null; keep the allocation but
        // remember that it is logically absent
        self.win_present = false;
    }

    fn state_ok(&self) -> bool {
        self.valid && self.mode >= HEAD && self.mode <= SYNC
    }

    pub fn reset_keep(&mut self) -> i32 {
        if !self.state_ok() {
            return Z_STREAM_ERROR;
        }
        self.total_in = 0;
        self.total_out = 0;
        self.total = 0;
        self.msg = M_NONE;
        if self.wrap != 0 {
            self.adler = (self.wrap & 1) as u32;
        }
        self.mode = HEAD;
        self.last = false;
        self.havedict = false;
        self.flags = -1;
        self.dmax = 32768;
        self.head.active = false;
        self.hold = 0;
        self.bits = 0;
        self.use_fixed = false;
        self.sane = true;
        self.back = -1;
        Z_OK
    }

    pub fn reset(&mut self) -> i32 {
        if !self.state_ok() {
            return Z_STREAM_ERROR;
        }
        self.wsize = 0;
        self.whave = 0;
        self.wnext = 0;
        self.reset_keep()
    }

    pub fn reset2(&mut self, mut window_bits: i32) -> i32 {
        if !self.state_ok() {
            return Z_STREAM_ERROR;
        }
        let wrap;
        if window_bits < 0 {
            wrap = 0;
            window_bits = -window_bits;
        } else {
            wrap = (window_bits >> 4) + 5;
            if window_bits < 48 {
                window_bits &= 15;
            }
        }
        if window_bits != 0 && (window_bits < 8 || window_bits > 15) {
            self.valid = false;
            return Z_STREAM_ERROR;
        }
        if self.win_present && self.wbits != window_bits as u32 {
            self.win_present = false;
        }
        self.wrap = wrap;
        self.wbits = window_bits as u32;
        self.reset()
    }

    pub fn get_header(&mut self) -> i32 {
        if !self.state_ok() {
            return Z_STREAM_ERROR;
        }
        if (self.wrap & 2) == 0 {
            return Z_STREAM_ERROR;
        }
        self.head.active = true;
        self.head.done = false;
        self.head.version += 1;
        Z_OK
    }

    fn updatewindow(&mut self, src: *const u8, end: usize, mut copy: usize) {
        if !self.win_present {
            self.wsize = 1 << self.wbits;
            self.wnext = 0;
            self.whave = 0;
            let need = self.wsize;
            match &mut self.window {
                Some(w) if w.len() >= need => {}
                _ => self.window = Some(vec![0u8; core::cmp::max(need, 1 << 15) + 16]), // +16: vector copies read past
            }
            self.win_present = true;
        }
        let wsize = self.wsize;
        if self.contiguous {
            // the window bytes are the output right before the current
            // position; only the bookkeeping is needed
            if copy >= wsize {
                self.wnext = 0;
                self.whave = wsize;
            } else {
                let dist = core::cmp::min(wsize - self.wnext, copy);
                if copy - dist != 0 {
                    self.wnext = copy - dist;
                    self.whave = wsize;
                } else {
                    self.wnext += dist;
                    if self.wnext == wsize {
                        self.wnext = 0;
                    }
                    if self.whave < wsize {
                        self.whave += dist;
                    }
                }
            }
            return;
        }
        let win = self.window.as_mut().unwrap();
        unsafe {
            if copy >= wsize {
                core::ptr::copy_nonoverlapping(src.add(end - wsize), win.as_mut_ptr(), wsize);
                self.wnext = 0;
                self.whave = wsize;
            } else {
                let mut dist = wsize - self.wnext;
                if dist > copy {
                    dist = copy;
                }
                core::ptr::copy_nonoverlapping(src.add(end - copy), win.as_mut_ptr().add(self.wnext), dist);
                copy -= dist;
                if copy != 0 {
                    core::ptr::copy_nonoverlapping(src.add(end - copy), win.as_mut_ptr(), copy);
                    self.wnext = copy;
                    self.whave = wsize;
                } else {
                    self.wnext += dist;
                    if self.wnext == wsize {
                        self.wnext = 0;
                    }
                    if self.whave < wsize {
                        self.whave += dist;
                    }
                }
            }
        }
    }

    pub fn set_dictionary(&mut self, dictionary: &[u8]) -> i32 {
        if !self.state_ok() {
            return Z_STREAM_ERROR;
        }
        if self.wrap != 0 && self.mode != DICT {
            return Z_STREAM_ERROR;
        }
        if self.mode == DICT {
            let dictid = adler32(1, dictionary);
            if dictid != self.check {
                return Z_DATA_ERROR;
            }
        }
        let n = dictionary.len();
        self.contiguous = false;
        self.updatewindow(dictionary.as_ptr(), n, n);
        self.havedict = true;
        Z_OK
    }

    pub fn end(&mut self) -> i32 {
        if !self.state_ok() {
            return Z_STREAM_ERROR;
        }
        self.win_present = false;
        self.valid = false;
        Z_OK
    }

    /// fast decode tables of the current block (literal/length at 0,
    /// distance at LSIZE)
    #[inline(always)]
    fn fast_tab(&self) -> *const u32 {
        if self.use_fixed {
            fixed_fast()
        } else {
            self.ftab.as_ptr()
        }
    }

    fn check_span(&mut self, p: *const u8, len: usize) {
        let data = unsafe { core::slice::from_raw_parts(p, len) };
        self.check = if self.flags != 0 { crc32(self.check, data) } else { adler32(self.check, data) };
        self.adler = self.check;
    }

    fn check_update(&mut self, from: usize, len: usize) {
        let data = unsafe { core::slice::from_raw_parts(self.output.add(from), len) };
        self.check = if self.flags != 0 { crc32(self.check, data) } else { adler32(self.check, data) };
        self.adler = self.check;
    }

    pub fn inflate(&mut self, flush: i32) -> i32 {
        if !self.state_ok() || self.output.is_null() || (self.input.is_null() && self.avail_in != 0) {
            return Z_STREAM_ERROR;
        }
        if self.mode == TYPE {
            self.mode = TYPEDO;
        }
        let input = self.input;
        let output = self.output;
        let mut put = self.next_out;
        let mut left = self.avail_out;
        let mut next = self.next_in;
        let mut have = self.avail_in;
        let mut hold = self.hold;
        let mut bits = self.bits;
        let in0 = have;
        let mut out0 = left;
        let mut ret = Z_OK;
        let mut hbuf = [0u8; 4];

        'inf_leave: loop {
        macro_rules! pullbyte {
            () => {{
                if have == 0 {
                    break 'inf_leave;
                }
                have -= 1;
                hold |= (unsafe { *input.add(next) } as u64) << bits;
                next += 1;
                bits += 8;
            }};
        }
        macro_rules! needbits {
            ($n:expr) => {{
                while bits < ($n) {
                    pullbyte!();
                }
            }};
        }
        macro_rules! dropbits {
            ($n:expr) => {{
                hold >>= $n;
                bits -= $n;
            }};
        }
        macro_rules! initbits {
            () => {{
                hold = 0;
                bits = 0;
            }};
        }
        macro_rules! crc2 {
            ($h:expr) => {{
                hbuf[0] = ($h & 0xff) as u8;
                hbuf[1] = (($h >> 8) & 0xff) as u8;
                self.check = crc32(self.check, &hbuf[..2]);
            }};
        }
        macro_rules! mark_check {
            () => {{
                if self.defer_check {
                    self.chk_off = (output as usize + put) - self.out_base as usize;
                }
            }};
        }
        macro_rules! bad {
            ($m:expr) => {{
                self.msg = $m;
                self.mode = BAD;
            }};
        }

            match self.mode {
                HEAD => {
                    if self.wrap == 0 {
                        self.mode = TYPEDO;
                        continue;
                    }
                    needbits!(16);
                    if (self.wrap & 2) != 0 && hold == 0x8b1f {
                        if self.wbits == 0 {
                            self.wbits = 15;
                        }
                        self.check = 0;
                        crc2!(hold);
                        initbits!();
                        self.mode = FLAGS;
                        continue;
                    }
                    if self.head.active {
                        self.head.done = false;
                        self.head.version += 1;
                    }
                    if (self.wrap & 1) == 0 || (((hold & 0xff) << 8) + (hold >> 8)) % 31 != 0 {
                        bad!(M_INCORRECT_HEADER);
                        continue;
                    }
                    if (hold & 0x0f) != Z_DEFLATED {
                        bad!(M_UNKNOWN_METHOD);
                        continue;
                    }
                    dropbits!(4);
                    let len = (hold & 0x0f) as u32 + 8;
                    if self.wbits == 0 {
                        self.wbits = len;
                    }
                    if len > 15 || len > self.wbits {
                        bad!(M_INVALID_WINDOW);
                        continue;
                    }
                    self.dmax = 1 << self.wbits;
                    self.flags = 0;
                    self.check = 1;
                    self.adler = 1;
                    mark_check!();
                    self.mode = if hold & 0x200 != 0 { DICTID } else { TYPE };
                    initbits!();
                }
                FLAGS => {
                    needbits!(16);
                    self.flags = hold as i32;
                    if (self.flags & 0xff) != 8 {
                        bad!(M_UNKNOWN_METHOD);
                        continue;
                    }
                    if (self.flags & 0xe000) != 0 {
                        bad!(M_UNKNOWN_FLAGS);
                        continue;
                    }
                    if self.head.active {
                        self.head.text = ((hold >> 8) & 1) as u32;
                        self.head.version += 1;
                    }
                    if (self.flags & 0x0200) != 0 && (self.wrap & 4) != 0 {
                        crc2!(hold);
                    }
                    initbits!();
                    self.mode = TIME;
                }
                TIME => {
                    needbits!(32);
                    if self.head.active {
                        self.head.time = hold as u32;
                        self.head.version += 1;
                    }
                    if (self.flags & 0x0200) != 0 && (self.wrap & 4) != 0 {
                        hbuf = (hold as u32).to_le_bytes();
                        self.check = crc32(self.check, &hbuf[..4]);
                    }
                    initbits!();
                    self.mode = OS;
                }
                OS => {
                    needbits!(16);
                    if self.head.active {
                        self.head.xflags = (hold & 0xff) as u32;
                        self.head.os = (hold >> 8) as u32;
                        self.head.version += 1;
                    }
                    if (self.flags & 0x0200) != 0 && (self.wrap & 4) != 0 {
                        crc2!(hold);
                    }
                    initbits!();
                    self.mode = EXLEN;
                }
                EXLEN => {
                    if (self.flags & 0x0400) != 0 {
                        needbits!(16);
                        self.length = hold as u32;
                        if self.head.active {
                            self.head.extra_len = hold as u32;
                            self.head.version += 1;
                        }
                        if (self.flags & 0x0200) != 0 && (self.wrap & 4) != 0 {
                            crc2!(hold);
                        }
                        initbits!();
                    } else if self.head.active {
                        self.head.extra = None;
                        self.head.version += 1;
                    }
                    self.mode = EXTRA;
                }
                EXTRA => {
                    if (self.flags & 0x0400) != 0 {
                        let mut copy = self.length as usize;
                        if copy > have {
                            copy = have;
                        }
                        if copy != 0 {
                            let src = unsafe { core::slice::from_raw_parts(input.add(next), copy) };
                            if self.head.active {
                                let len = (self.head.extra_len - self.length) as usize;
                                if self.head.extra.is_none() {
                                    self.head.extra = Some(vec![0u8; self.head.extra_len as usize]);
                                }
                                let ex = self.head.extra.as_mut().unwrap();
                                if len + copy <= ex.len() {
                                    ex[len..len + copy].copy_from_slice(src);
                                }
                                self.head.version += 1;
                            }
                            if (self.flags & 0x0200) != 0 && (self.wrap & 4) != 0 {
                                self.check = crc32(self.check, src);
                            }
                            have -= copy;
                            next += copy;
                            self.length -= copy as u32;
                        }
                        if self.length != 0 {
                            break 'inf_leave;
                        }
                    }
                    self.length = 0;
                    self.mode = NAME;
                }
                NAME => {
                    if (self.flags & 0x0800) != 0 {
                        if have == 0 {
                            break 'inf_leave;
                        }
                        let mut copy = 0usize;
                        let mut len;
                        loop {
                            len = unsafe { *input.add(next + copy) };
                            copy += 1;
                            if self.head.active && len != 0 {
                                if let Some(n) = self.head.name.as_mut() {
                                    n.push(len);
                                } else {
                                    self.head.name = Some(vec![len]);
                                }
                            }
                            if !(len != 0 && copy < have) {
                                break;
                            }
                        }
                        if self.head.active {
                            self.head.version += 1;
                        }
                        if (self.flags & 0x0200) != 0 && (self.wrap & 4) != 0 {
                            let src = unsafe { core::slice::from_raw_parts(input.add(next), copy) };
                            self.check = crc32(self.check, src);
                        }
                        have -= copy;
                        next += copy;
                        if len != 0 {
                            break 'inf_leave;
                        }
                    } else if self.head.active {
                        self.head.name = None;
                        self.head.version += 1;
                    }
                    self.length = 0;
                    self.mode = COMMENT;
                }
                COMMENT => {
                    if (self.flags & 0x1000) != 0 {
                        if have == 0 {
                            break 'inf_leave;
                        }
                        let mut copy = 0usize;
                        let mut len;
                        loop {
                            len = unsafe { *input.add(next + copy) };
                            copy += 1;
                            if self.head.active && len != 0 {
                                if let Some(n) = self.head.comment.as_mut() {
                                    n.push(len);
                                } else {
                                    self.head.comment = Some(vec![len]);
                                }
                            }
                            if !(len != 0 && copy < have) {
                                break;
                            }
                        }
                        if self.head.active {
                            self.head.version += 1;
                        }
                        if (self.flags & 0x0200) != 0 && (self.wrap & 4) != 0 {
                            let src = unsafe { core::slice::from_raw_parts(input.add(next), copy) };
                            self.check = crc32(self.check, src);
                        }
                        have -= copy;
                        next += copy;
                        if len != 0 {
                            break 'inf_leave;
                        }
                    } else if self.head.active {
                        self.head.comment = None;
                        self.head.version += 1;
                    }
                    self.mode = HCRC;
                }
                HCRC => {
                    if (self.flags & 0x0200) != 0 {
                        needbits!(16);
                        if (self.wrap & 4) != 0 && hold != (self.check & 0xffff) as u64 {
                            bad!(M_HEADER_CRC);
                            continue;
                        }
                        initbits!();
                    }
                    if self.head.active {
                        self.head.hcrc = ((self.flags >> 9) & 1) as u32;
                        self.head.done = true;
                        self.head.version += 1;
                    }
                    self.check = 0;
                    self.adler = 0;
                    mark_check!();
                    self.mode = TYPE;
                }
                DICTID => {
                    needbits!(32);
                    self.check = (hold as u32).swap_bytes();
                    self.adler = self.check;
                    initbits!();
                    self.mode = DICT;
                }
                DICT => {
                    if !self.havedict {
                        self.next_out = put;
                        self.avail_out = left;
                        self.next_in = next;
                        self.avail_in = have;
                        self.hold = hold;
                        self.bits = bits;
                        return Z_NEED_DICT;
                    }
                    self.check = 1;
                    self.adler = 1;
                    mark_check!();
                    self.mode = TYPE;
                }
                TYPE | TYPEDO => {
                    if self.mode == TYPE && (flush == Z_BLOCK || flush == Z_TREES) {
                        break 'inf_leave;
                    }
                    if self.last {
                        dropbits!(bits & 7);
                        self.mode = CHECK;
                        continue;
                    }
                    needbits!(3);
                    self.last = (hold & 1) != 0;
                    dropbits!(1);
                    match hold & 3 {
                        0 => self.mode = STORED,
                        1 => {
                            self.use_fixed = true;
                            self.lenbits = 9;
                            self.distbits = 5;
                            self.mode = LEN_;
                            if flush == Z_TREES {
                                dropbits!(2);
                                break 'inf_leave;
                            }
                        }
                        2 => self.mode = TABLE,
                        _ => bad!(M_INVALID_BLOCK_TYPE),
                    }
                    dropbits!(2);
                }
                STORED => {
                    dropbits!(bits & 7);
                    needbits!(32);
                    if (hold & 0xffff) != ((hold >> 16) ^ 0xffff) {
                        bad!(M_INVALID_STORED);
                        continue;
                    }
                    self.length = (hold & 0xffff) as u32;
                    initbits!();
                    self.mode = COPY_;
                    if flush == Z_TREES {
                        break 'inf_leave;
                    }
                }
                COPY_ => {
                    self.mode = COPY;
                }
                COPY => {
                    let mut copy = self.length as usize;
                    if copy != 0 {
                        if copy > have {
                            copy = have;
                        }
                        if copy > left {
                            copy = left;
                        }
                        if copy == 0 {
                            break 'inf_leave;
                        }
                        unsafe { core::ptr::copy_nonoverlapping(input.add(next), output.add(put), copy) };
                        have -= copy;
                        next += copy;
                        left -= copy;
                        put += copy;
                        self.length -= copy as u32;
                        continue;
                    }
                    self.mode = TYPE;
                }
                TABLE => {
                    needbits!(14);
                    self.nlen = (hold & 0x1f) as u32 + 257;
                    dropbits!(5);
                    self.ndist = (hold & 0x1f) as u32 + 1;
                    dropbits!(5);
                    self.ncode = (hold & 0x0f) as u32 + 4;
                    dropbits!(4);
                    if self.nlen > 286 || self.ndist > 30 {
                        bad!(M_TOO_MANY);
                        continue;
                    }
                    self.have = 0;
                    self.mode = LENLENS;
                }
                LENLENS => {
                    while self.have < self.ncode {
                        needbits!(3);
                        self.lens[ORDER[self.have as usize] as usize] = (hold & 0x07) as u16;
                        self.have += 1;
                        dropbits!(3);
                    }
                    while self.have < 19 {
                        self.lens[ORDER[self.have as usize] as usize] = 0;
                        self.have += 1;
                    }
                    self.use_fixed = false;
                    let mut b = 7;
                    let r = inflate_table(CODES, &self.lens, 19, &mut self.lendyn[..], &mut self.work, &mut b);
                    self.lenbits = b;
                    if r != 0 {
                        bad!(M_INVALID_CODE_LENGTHS);
                        continue;
                    }
                    self.have = 0;
                    self.mode = CODELENS;
                }
                CODELENS => {
                    let lcode = self.lendyn.as_ptr();
                    while self.have < self.nlen + self.ndist {
                        let mut here;
                        loop {
                            here = unsafe { *lcode.add((hold & ((1u64 << self.lenbits) - 1)) as usize) };
                            if (here >> 24) <= bits {
                                break;
                            }
                            pullbyte!();
                        }
                        let here_bits = here >> 24;
                        let here_val = (here & 0xffff) as u16;
                        if here_val < 16 {
                            dropbits!(here_bits);
                            self.lens[self.have as usize] = here_val;
                            self.have += 1;
                        } else {
                            let len: u16;
                            let mut copy: u32;
                            if here_val == 16 {
                                needbits!(here_bits + 2);
                                dropbits!(here_bits);
                                if self.have == 0 {
                                    bad!(M_INVALID_REPEAT);
                                    break;
                                }
                                len = self.lens[self.have as usize - 1];
                                copy = 3 + (hold & 0x03) as u32;
                                dropbits!(2);
                            } else if here_val == 17 {
                                needbits!(here_bits + 3);
                                dropbits!(here_bits);
                                len = 0;
                                copy = 3 + (hold & 0x07) as u32;
                                dropbits!(3);
                            } else {
                                needbits!(here_bits + 7);
                                dropbits!(here_bits);
                                len = 0;
                                copy = 11 + (hold & 0x7f) as u32;
                                dropbits!(7);
                            }
                            if self.have + copy > self.nlen + self.ndist {
                                bad!(M_INVALID_REPEAT);
                                break;
                            }
                            while copy > 0 {
                                self.lens[self.have as usize] = len;
                                self.have += 1;
                                copy -= 1;
                            }
                        }
                    }
                    if self.mode == BAD {
                        continue;
                    }
                    if self.lens[256] == 0 {
                        bad!(M_MISSING_EOB);
                        continue;
                    }
                    // zlib's validity rules for the two sets (the tables
                    // themselves are only built in the fast format)
                    let nlen = self.nlen as usize;
                    let lcount = crate::fasttab::count_lens(&self.lens[..nlen]);
                    if !code_ok(LENS, &lcount) {
                        bad!(M_INVALID_LITLEN_SET);
                        continue;
                    }
                    let ndist = self.ndist as usize;
                    let lens_d: [u16; 32] = {
                        let mut t = [0u16; 32];
                        t[..ndist].copy_from_slice(&self.lens[nlen..nlen + ndist]);
                        t
                    };
                    let dcount = crate::fasttab::count_lens(&lens_d[..ndist]);
                    if !code_ok(DISTS, &dcount) {
                        bad!(M_INVALID_DIST_SET);
                        continue;
                    }
                    crate::fasttab::build(&self.lens[..], nlen, &lcount, true, &mut self.ftab[..crate::fasttab::LSIZE]);
                    crate::fasttab::build(&lens_d, ndist, &dcount, false, &mut self.ftab[crate::fasttab::LSIZE..]);
                    self.mode = LEN_;
                    if flush == Z_TREES {
                        break 'inf_leave;
                    }
                }
                LEN_ => {
                    self.mode = LEN;
                }
                LEN => {
                    // zlib inflate_fast entry assumption: < 8 bits held (after a
                    // resume mid-symbol the slow path first finishes that symbol)
                    if unsafe { FAST_ON } && bits < 8 && have > 16 && left > 258 + 40 {
                        self.next_out = put;
                        self.avail_out = left;
                        self.next_in = next;
                        self.avail_in = have;
                        self.hold = hold;
                        self.bits = bits;
                        let bailed = unsafe { self.inflate_fast(out0) };
                        put = self.next_out;
                        left = self.avail_out;
                        next = self.next_in;
                        have = self.avail_in;
                        hold = self.hold;
                        bits = self.bits;
                        if self.mode == TYPE {
                            self.back = -1;
                        }
                        if !bailed || self.mode != LEN {
                            continue;
                        }
                        // the fast loop stopped at a symbol it leaves to the
                        // exact slow path: decode that one symbol below
                    }
                    // Symbol decoding from the fast table with zlib's exact
                    // pull/drop behaviour: pull bytes until the code's full
                    // length is held (a code whose length fits the held bits
                    // is fully determined by them, so this matches zlib's own
                    // tables), drop the code bits, then act on the symbol.
                    // Invalid entries carry the length zlib's table gives them.
                    self.back = 0;
                    let lt = self.fast_tab();
                    let mut e;
                    loop {
                        e = unsafe { *lt.add((hold & LMASK) as usize) };
                        if lneed(e) <= bits {
                            break;
                        }
                        pullbyte!();
                    }
                    if e & (LIT_F | EXC_F | SUB_F) == EXC_F | SUB_F {
                        let rb = e & 0xff;
                        let sb = (e >> 8) & 0xf;
                        let off = ((e >> 16) & 0x7fff) as usize;
                        let mut e2;
                        loop {
                            e2 = unsafe { *lt.add(off + ((hold >> rb) & ((1u64 << sb) - 1)) as usize) };
                            if rb + lneed(e2) <= bits {
                                break;
                            }
                            pullbyte!();
                        }
                        dropbits!(rb);
                        self.back += rb as i32;
                        e = e2;
                    }
                    let n = lneed(e);
                    dropbits!(n);
                    self.back += n as i32;
                    if e & LIT_F != 0 {
                        self.length = (e >> 8) & 0xff;
                        self.mode = LIT;
                        continue;
                    }
                    if e & EXC_F != 0 {
                        if e & EOB_F != 0 {
                            self.back = -1;
                            self.mode = TYPE;
                            continue;
                        }
                        bad!(M_INVALID_LITLEN_CODE);
                        continue;
                    }
                    self.length = e >> 16;
                    self.extra = (e & 0xff) - n;
                    self.mode = LENEXT;
                }
                LENEXT => {
                    if self.extra != 0 {
                        needbits!(self.extra);
                        self.length += (hold & ((1u64 << self.extra) - 1)) as u32;
                        dropbits!(self.extra);
                        self.back += self.extra as i32;
                    }
                    self.was = self.length;
                    self.mode = DIST;
                }
                DIST => {
                    let dt = unsafe { self.fast_tab().add(crate::fasttab::LSIZE) };
                    let mut e;
                    loop {
                        e = unsafe { *dt.add((hold & DMASK) as usize) };
                        if dneed(e) <= bits {
                            break;
                        }
                        pullbyte!();
                    }
                    if e & (EXC_F | SUB_F) == EXC_F | SUB_F {
                        let rb = e & 0xff;
                        let sb = (e >> 8) & 0xf;
                        let off = ((e >> 16) & 0x7fff) as usize;
                        let mut e2;
                        loop {
                            e2 = unsafe { *dt.add(off + ((hold >> rb) & ((1u64 << sb) - 1)) as usize) };
                            if rb + dneed(e2) <= bits {
                                break;
                            }
                            pullbyte!();
                        }
                        dropbits!(rb);
                        self.back += rb as i32;
                        e = e2;
                    }
                    let n = dneed(e);
                    dropbits!(n);
                    self.back += n as i32;
                    if e & EXC_F != 0 {
                        bad!(M_INVALID_DIST_CODE);
                        continue;
                    }
                    self.offset = e >> 16;
                    self.extra = (e & 0xff) - n;
                    self.mode = DISTEXT;
                }
                DISTEXT => {
                    if self.extra != 0 {
                        needbits!(self.extra);
                        self.offset += (hold & ((1u64 << self.extra) - 1)) as u32;
                        dropbits!(self.extra);
                        self.back += self.extra as i32;
                    }
                    if self.offset > self.dmax {
                        bad!(M_TOO_FAR);
                        continue;
                    }
                    self.mode = MATCH;
                }
                MATCH => {
                    if left == 0 {
                        break 'inf_leave;
                    }
                    let mut copy = out0 - left;
                    let from_win: bool;
                    let mut from: usize;
                    if self.offset as usize > copy {
                        copy = self.offset as usize - copy;
                        if copy > self.whave && self.sane {
                            bad!(M_TOO_FAR);
                            continue;
                        }
                        if self.contiguous {
                            // the window bytes precede the output: copy the
                            // whole (possibly overlapping) match in one go;
                            // the end state equals zlib's piecewise copy
                            let n = core::cmp::min(self.length as usize, left);
                            left -= n;
                            self.length -= n as u32;
                            unsafe {
                                let d = output.add(put);
                                let s = d.sub(self.offset as usize);
                                for i in 0..n {
                                    *d.add(i) = *s.add(i);
                                }
                            }
                            put += n;
                            if self.length == 0 {
                                self.mode = LEN;
                            }
                            continue;
                        }
                        if copy > self.wnext {
                            copy -= self.wnext;
                            from = self.wsize - copy;
                        } else {
                            from = self.wnext - copy;
                        }
                        if copy > self.length as usize {
                            copy = self.length as usize;
                        }
                        from_win = true;
                    } else {
                        from = put - self.offset as usize;
                        copy = self.length as usize;
                        from_win = false;
                    }
                    if copy > left {
                        copy = left;
                    }
                    left -= copy;
                    self.length -= copy as u32;
                    unsafe {
                        if from_win {
                            let w = self.window.as_ref().unwrap().as_ptr();
                            for _ in 0..copy {
                                *output.add(put) = *w.add(from);
                                put += 1;
                                from += 1;
                            }
                        } else {
                            for _ in 0..copy {
                                *output.add(put) = *output.add(from);
                                put += 1;
                                from += 1;
                            }
                        }
                    }
                    if self.length == 0 {
                        self.mode = LEN;
                    }
                }
                LIT => {
                    if left == 0 {
                        break 'inf_leave;
                    }
                    unsafe { *output.add(put) = self.length as u8 };
                    put += 1;
                    left -= 1;
                    self.mode = LEN;
                }
                CHECK => {
                    if self.wrap != 0 {
                        needbits!(32);
                        out0 -= left;
                        self.total_out += out0 as u64;
                        self.total += out0 as u64;
                        if (self.wrap & 4) != 0 {
                            if self.defer_check {
                                let start = self.out_base as usize + self.chk_off;
                                let end = output as usize + put;
                                if end > start {
                                    self.check_span(start as *const u8, end - start);
                                }
                            } else if out0 != 0 {
                                self.check_update(put - out0, out0);
                            }
                        }
                        out0 = left;
                        let h = hold as u32;
                        let v = if self.flags != 0 { h } else { h.swap_bytes() };
                        if (self.wrap & 4) != 0 && v != self.check {
                            bad!(M_DATA_CHECK);
                            continue;
                        }
                        initbits!();
                    }
                    self.mode = LENGTH;
                }
                LENGTH => {
                    if self.wrap != 0 && self.flags != 0 {
                        needbits!(32);
                        if (self.wrap & 4) != 0 && hold as u32 != self.total as u32 {
                            bad!(M_LENGTH_CHECK);
                            continue;
                        }
                        initbits!();
                    }
                    self.mode = DONE;
                }
                DONE => {
                    ret = Z_STREAM_END;
                    break 'inf_leave;
                }
                BAD => {
                    ret = Z_DATA_ERROR;
                    break 'inf_leave;
                }
                MEM => {
                    return Z_MEM_ERROR;
                }
                _ => {
                    return Z_STREAM_ERROR;
                }
            }
        }
        // inf_leave
        self.next_out = put;
        self.avail_out = left;
        self.next_in = next;
        self.avail_in = have;
        self.hold = hold;
        self.bits = bits;
        if self.wsize != 0 || (out0 != self.avail_out && self.mode < BAD && (self.mode < CHECK || flush != Z_FINISH)) {
            let produced = out0 - self.avail_out;
            self.updatewindow(output, self.next_out, produced);
        }
        let in_used = in0 - self.avail_in;
        let out_used = out0 - self.avail_out;
        self.total_in += in_used as u64;
        self.total_out += out_used as u64;
        self.total += out_used as u64;
        if (self.wrap & 4) != 0 && out_used != 0 && !self.defer_check {
            let from = self.next_out - out_used;
            self.check_update(from, out_used);
        }
        self.data_type = self.bits as i32
            + if self.last { 64 } else { 0 }
            + if self.mode == TYPE { 128 } else { 0 }
            + if self.mode == LEN_ || self.mode == COPY_ { 256 } else { 0 };
        if ((in_used == 0 && out_used == 0) || flush == Z_FINISH) && ret == Z_OK {
            ret = Z_BUF_ERROR;
        }
        ret
    }

    /// Fast decode loop (libdeflate-style tables, 64-bit bit buffer with
    /// branchless refill, next-entry preloading). Runs until end of block or
    /// until fewer than 16 input / 298 output bytes remain. Anything unusual
    /// (invalid code, distance beyond the window or dmax) is left for the
    /// exact slow path: the loop stops at the start of that symbol with a
    /// canonical bit buffer, exactly where zlib's slow path would stand.
    /// Reads may run up to 8 bytes past the input (the session buffers carry
    /// slack); only bits from real input are ever consumed.
    ///
    /// Written to keep few values live (V8 has ~10 usable registers): plain
    /// pointers, one table base, and in the match path the bit count is only
    /// committed at the end so a bail-out needs just the saved `hold`.
    #[inline(never)]
    unsafe fn inflate_fast(&mut self, start: usize) -> bool {
        use crate::fasttab::{DBITS, EOB, EXC, LBITS, LIT, LSIZE, SUB};
        let in0 = self.input.add(self.next_in);
        let mut ip = in0;
        // at every loop check bits is in 56..=63, so "at least 16 unread
        // input bytes" (ip - bits/8 < end - 16) is ip < end - 9
        let ip_lim = in0.add(self.avail_in - 9);
        let out0 = self.output.add(self.next_out);
        let mut op = out0;
        let op_lim = out0.add(self.avail_out - (258 + 40));
        let dmax = self.dmax as usize;
        // Matches are copied straight from the output buffer when valid
        // (dist <= produced-in-this-call + whave, zlib's rule) and the
        // source bytes are in this buffer: with contiguous output all of the
        // window is right before `beg`; otherwise only the current chunk
        // (from self.output) is, and older bytes come from the window.
        // op - reach_base = min(produced + whave, op - lin_base).
        let beg = out0 as usize - (start - self.avail_out);
        let reach_base = if self.contiguous {
            beg - self.whave
        } else {
            core::cmp::max(beg.saturating_sub(self.whave), self.output as usize)
        };
        let mut bailed = false;
        let mut hold = self.hold;
        let mut bits = self.bits as u64;
        let lt = if self.use_fixed { fixed_fast() } else { self.ftab.as_ptr() };
        let dt = lt.add(LSIZE);
        const LMASK: u64 = (1 << LBITS) - 1;
        const DMASK: u64 = (1 << DBITS) - 1;

        macro_rules! refill {
            () => {{
                hold |= (ip as *const u64).read_unaligned() << bits;
                ip = ip.add(((63 - bits) >> 3) as usize);
                bits |= 56;
            }};
        }
        macro_rules! lit {
            ($e:expr) => {{
                let e = $e;
                let n = (e & 0xff) as u64;
                hold >>= n;
                bits -= n;
                *op = (e >> 8) as u8;
                op = op.add(1);
            }};
        }

        refill!();
        let mut e = *lt.add((hold & LMASK) as usize);
        'main: while ip < ip_lim && op < op_lim {
            if e & LIT != 0 {
                lit!(e);
                e = *lt.add((hold & LMASK) as usize);
                if e & LIT != 0 {
                    lit!(e);
                    e = *lt.add((hold & LMASK) as usize);
                    if e & LIT != 0 {
                        lit!(e);
                        e = *lt.add((hold & LMASK) as usize);
                        refill!();
                        continue 'main;
                    }
                }
                refill!();
            }
            // symbol start: from here until the commit below, `bits` and
            // `ip` stay at the symbol start and `used` counts consumed bits
            let sh = hold;
            let mut used: u64;
            if e & EXC != 0 {
                if e & SUB != 0 {
                    used = (e & 0xff) as u64;
                    hold >>= used;
                    e = *lt.add(((e >> 16) & 0x7fff) as usize + (hold & ((1u64 << ((e >> 8) & 0xf)) - 1)) as usize);
                    if e & LIT != 0 {
                        bits -= used;
                        lit!(e);
                        e = *lt.add((hold & LMASK) as usize);
                        refill!();
                        continue 'main;
                    }
                    if e & EXC != 0 {
                        if e & EOB != 0 {
                            let n = (e & 0xff) as u64;
                            hold >>= n;
                            bits -= used + n;
                            self.mode = TYPE;
                        } else {
                            hold = sh;
                            bailed = true;
                        }
                        break 'main;
                    }
                } else if e & EOB != 0 {
                    let n = (e & 0xff) as u64;
                    hold >>= n;
                    bits -= n;
                    self.mode = TYPE;
                    break 'main;
                } else {
                    bailed = true;
                    break 'main;
                }
            } else {
                used = 0;
            }
            // length (+ extra bits in one go)
            let t = (e & 0xff) as u64;
            let len = (e >> 16) as usize + ((hold & ((1u64 << t) - 1)) >> ((e >> 8) & 0xf)) as usize;
            hold >>= t;
            used += t;
            let mut d = *dt.add((hold & DMASK) as usize);
            if d & EXC != 0 {
                if d & SUB != 0 {
                    let n = (d & 0xff) as u64;
                    hold >>= n;
                    used += n;
                    d = *dt.add(((d >> 16) & 0x7fff) as usize + (hold & ((1u64 << ((d >> 8) & 0xf)) - 1)) as usize);
                }
                if d & EXC != 0 {
                    hold = sh;
                    bailed = true;
                    break 'main;
                }
            }
            let t = (d & 0xff) as u64;
            let dist = (d >> 16) as usize + ((hold & ((1u64 << t) - 1)) >> ((d >> 8) & 0xf)) as usize;
            hold >>= t;
            // One well-predicted compare covers the rare cases: beyond dmax,
            // beyond the window (both reported by the exact slow path) and,
            // when the output is not contiguous, reaching into the window.
            if dist > core::cmp::min(dmax, (op as usize).wrapping_sub(reach_base)) {
                let produced = op as usize - beg;
                if dist > dmax || dist - produced > self.whave {
                    hold = sh;
                    bailed = true;
                    break 'main;
                }
                bits -= used + t;
                op = self.window_copy(op, dist, len, dist - produced);
                e = *lt.add((hold & LMASK) as usize);
                refill!();
                continue 'main;
            }
            bits -= used + t;
            let ne = *lt.add((hold & LMASK) as usize);
            refill!();
            copy_match(op, dist, len);
            op = op.add(len);
            e = ne;
        }
        // give back whole unused bytes; keep < 8 bits (canonical state)
        ip = ip.sub((bits >> 3) as usize);
        bits &= 7;
        hold &= (1u64 << bits) - 1;
        let used_in = ip as usize - in0 as usize;
        self.avail_in -= used_in;
        self.next_in += used_in;
        let produced = op as usize - out0 as usize;
        self.avail_out -= produced;
        self.next_out += produced;
        self.hold = hold;
        self.bits = bits as u32;
        bailed
    }
}

#[cfg(target_arch = "wasm32")]
const fn pat_tables() -> ([[u8; 16]; 16], [[u8; 16]; 16]) {
    let mut idx = [[0u8; 16]; 16];
    let mut adv = [[0u8; 16]; 16];
    let mut d = 1;
    while d < 16 {
        let mut i = 0;
        while i < 16 {
            idx[d][i] = (i % d) as u8;
            adv[d][i] = ((16 + i) % d) as u8;
            i += 1;
        }
        d += 1;
    }
    (idx, adv)
}

#[cfg(target_arch = "wasm32")]
static PAT: ([[u8; 16]; 16], [[u8; 16]; 16]) = pat_tables();

impl Inflate {
    /// match that starts in the sliding window (zlib inffast logic); returns new out
    #[inline(never)]
    #[cold]
    unsafe fn window_copy(&self, mut op: *mut u8, dist: usize, mut len: usize, mut op2: usize) -> *mut u8 {
        let w = self.window.as_ref().unwrap().as_ptr();
        let wsize = self.wsize;
        let wnext = self.wnext;
        let from: usize;
        if wnext == 0 {
            from = wsize - op2;
            if op2 < len {
                len -= op2;
                copy_short(w.add(from), op, op2);
                op = op.add(op2);
                copy_match(op, dist, len);
                return op.add(len);
            }
        } else if wnext < op2 {
            let f = wsize + wnext - op2;
            op2 -= wnext;
            if op2 < len {
                len -= op2;
                copy_short(w.add(f), op, op2);
                op = op.add(op2);
                if wnext < len {
                    len -= wnext;
                    copy_short(w, op, wnext);
                    op = op.add(wnext);
                    copy_match(op, dist, len);
                    return op.add(len);
                }
                from = 0;
            } else {
                from = f;
            }
        } else {
            from = wnext - op2;
            if op2 < len {
                len -= op2;
                copy_short(w.add(from), op, op2);
                op = op.add(op2);
                copy_match(op, dist, len);
                return op.add(len);
            }
        }
        copy_short(w.add(from), op, len);
        op.add(len)
    }
}

/// Copy a match of `len` bytes from `out - dist` to `out` (may overlap).
/// Writes up to 31 bytes past `out + len` (callers leave that slack). The
/// first 32 bytes are copied unconditionally so short matches (most of
/// them) take no data-dependent loop branch.
#[cfg(target_arch = "wasm32")]
#[inline(always)]
unsafe fn copy_match(dst: *mut u8, dist: usize, len: usize) {
    use core::arch::wasm32::{i8x16_swizzle, v128, v128_load, v128_store};
    let src = dst.sub(dist);
    if dist >= 16 {
        v128_store(dst as *mut v128, v128_load(src as *const v128));
        v128_store(dst.add(16) as *mut v128, v128_load(src.add(16) as *const v128));
        if len > 32 {
            let mut i = 32;
            loop {
                v128_store(dst.add(i) as *mut v128, v128_load(src.add(i) as *const v128));
                i += 16;
                if i >= len {
                    break;
                }
            }
        }
    } else {
        // periodic pattern of period `dist`: build 16 bytes with a swizzle,
        // then advance the phase by 16 % dist per vector
        let base = v128_load(src as *const v128);
        let mut v = i8x16_swizzle(base, v128_load(PAT.0[dist].as_ptr() as *const v128));
        let adv = v128_load(PAT.1[dist].as_ptr() as *const v128);
        v128_store(dst as *mut v128, v);
        v = i8x16_swizzle(v, adv);
        v128_store(dst.add(16) as *mut v128, v);
        if len > 32 {
            let mut i = 32;
            loop {
                v = i8x16_swizzle(v, adv);
                v128_store(dst.add(i) as *mut v128, v);
                i += 16;
                if i >= len {
                    break;
                }
            }
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[inline(always)]
unsafe fn copy_match(dst: *mut u8, dist: usize, len: usize) {
    // portable version (native builds)
    let src = dst.sub(dist);
    if dist >= 8 {
        let mut i = 0;
        loop {
            (dst.add(i) as *mut u64).write_unaligned((src.add(i) as *const u64).read_unaligned());
            i += 8;
            if i >= len {
                break;
            }
        }
    } else {
        for i in 0..len {
            *dst.add(i) = *src.add(i);
        }
    }
}

/// Copy `n` (<= 258) bytes between non-overlapping buffers with 16-byte
/// vectors instead of memory.copy (which costs a call in V8). Reads and
/// writes up to 15 bytes past the range (window and output carry slack).
#[cfg(target_arch = "wasm32")]
#[inline(always)]
unsafe fn copy_short(src: *const u8, dst: *mut u8, n: usize) {
    use core::arch::wasm32::{v128, v128_load, v128_store};
    let mut i = 0;
    while i < n {
        v128_store(dst.add(i) as *mut v128, v128_load(src.add(i) as *const v128));
        i += 16;
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[inline(always)]
unsafe fn copy_short(src: *const u8, dst: *mut u8, n: usize) {
    core::ptr::copy_nonoverlapping(src, dst, n);
}
