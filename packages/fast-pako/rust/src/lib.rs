// fastzlib: wasm core of @r1ck404/fast-pako. Exposes zlib-level state machines that
// are exact ports of pako's, plus the pako `push()` loops (chunking,
// multi-member handling, to:'string' segmentation) so results, chunk
// boundaries and error behaviour match pako 2.1.0 exactly.

#![cfg_attr(not(test), no_std)]

extern crate alloc;

use alloc::boxed::Box;
use alloc::vec::Vec;

mod checksum;
mod deflate;
mod heap;
mod fasttab;
mod inflate;
mod inftrees;
mod trees;

use deflate::Deflate;
use inflate::Inflate;

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    /// kind: 0 = full chunk, 1 = partial chunk (subarray), 2 = string segment
    fn js_emit(kind: u32, ptr: *const u8, len: usize, chunk_size: usize);
    /// input access with pako's JS semantics, and pako's own exceptions
    /// (OP_*); may throw (which unwinds the wasm call)
    #[link_name = "js_op"]
    fn js_op_import(op: u32, a: usize, b: usize, c: usize) -> i32;
}

/// deflate: `buf.set(strm.input.subarray(a, a + b))` into memory at c
pub const OP_DCOPY: u32 = 0;
/// inflate: `buf.set(input.subarray(a, a + b))` into memory at c (c = 0:
/// only the subarray() call)
pub const OP_ICOPY: u32 = 1;
/// inflate: element a as int32 (`input[a] << 0`)
pub const OP_ELEM: u32 = 2;
/// inflate: element a of a gzip name/comment: 0 if falsy, else 0x10000 |
/// the code String.fromCharCode gives it
pub const OP_CHAR: u32 = 3;
/// inflate: `data[a] !== 0` (the multi-member check in Inflate.push)
pub const OP_NZ: u32 = 4;
/// throw: configuration_table[s.level].func is not a function
pub const OP_NOFUNC: u32 = 5;
/// throw: new Uint8Array(extra_len) (length in Res.arg)
pub const OP_EXTRA: u32 = 6;
/// throw: the dictionary has no subarray() (updatewindow)
pub const OP_DICT: u32 = 7;
/// throw: TypedArray set() out of bounds
pub const OP_RANGE: u32 = 8;
/// throw: a Deflate.push pako never returns from (see def_push)
pub const OP_LOOP: u32 = 9;

#[cfg(target_arch = "wasm32")]
#[inline(always)]
pub fn js_op(op: u32, a: usize, b: usize, c: usize) -> i32 {
    unsafe { js_op_import(op, a, b, c) }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn js_op(_op: u32, _a: usize, _b: usize, _c: usize) -> i32 {
    panic!("js_op")
}

/// an op that always throws
#[cold]
#[inline(never)]
pub fn js_throw(op: u32) -> ! {
    js_op(op, 0, 0, 0);
    #[cfg(target_arch = "wasm32")]
    core::arch::wasm32::unreachable();
    #[cfg(not(target_arch = "wasm32"))]
    unreachable!()
}
// no panic machinery: bounds-check failures and the like just trap
#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(all(target_arch = "wasm32", not(test)))]
#[global_allocator]
static ALLOC: heap::Global = heap::Global;

#[cfg(not(target_arch = "wasm32"))]
pub static mut EMITTED: Vec<(u32, Vec<u8>)> = Vec::new();

#[cfg(not(target_arch = "wasm32"))]
#[allow(static_mut_refs)]
unsafe fn js_emit(kind: u32, ptr: *const u8, len: usize, _chunk_size: usize) {
    EMITTED.push((kind, core::slice::from_raw_parts(ptr, len).to_vec()));
}

#[cfg(test)]
mod tests;

const SLACK: usize = 64;

// ---------------------------------------------------------------- memory

/// Growable byte buffer that is never zero-filled (only bytes written by the
/// codec are ever read back) and can be presized from a size hint.
pub struct OutBuf {
    ptr: *mut u8,
    cap: usize,
}

impl OutBuf {
    pub const fn new() -> OutBuf {
        OutBuf { ptr: core::ptr::null_mut(), cap: 0 }
    }
    #[inline(always)]
    pub fn ptr(&self) -> *mut u8 {
        self.ptr
    }
    #[inline(always)]
    pub fn cap(&self) -> usize {
        self.cap
    }
    #[inline(always)]
    fn layout(n: usize) -> alloc::alloc::Layout {
        unsafe { alloc::alloc::Layout::from_size_align_unchecked(n, 16) }
    }
    /// Ensure capacity >= need (doubling), preserving bytes [0, keep).
    #[inline]
    pub fn reserve(&mut self, need: usize, keep: usize) {
        if need > self.cap {
            let mut n = self.cap.max(1 << 16);
            while n < need {
                n *= 2;
            }
            self.set_cap(n, keep);
        }
    }
    /// Ensure capacity >= need (exact size), preserving bytes [0, keep).
    pub fn reserve_exact(&mut self, need: usize, keep: usize) {
        if need > self.cap {
            self.set_cap(need, keep);
        }
    }
    /// Best-effort capacity hint for an empty buffer: failure is ignored
    /// (the buffer then grows on demand as usual).
    pub fn hint(&mut self, need: usize) {
        if need > self.cap {
            unsafe {
                let p = alloc::alloc::alloc(Self::layout(need));
                if !p.is_null() {
                    self.free();
                    self.ptr = p;
                    self.cap = need;
                }
            }
        }
    }
    #[cold]
    #[inline(never)]
    fn set_cap(&mut self, n: usize, keep: usize) {
        use alloc::alloc::{alloc, dealloc, handle_alloc_error, realloc};
        unsafe {
            let p = if self.ptr.is_null() {
                alloc(Self::layout(n))
            } else if keep * 2 >= self.cap {
                realloc(self.ptr, Self::layout(self.cap), n)
            } else {
                let p = alloc(Self::layout(n));
                if !p.is_null() {
                    core::ptr::copy_nonoverlapping(self.ptr, p, keep);
                    dealloc(self.ptr, Self::layout(self.cap));
                }
                p
            };
            if p.is_null() {
                handle_alloc_error(Self::layout(n));
            }
            self.ptr = p;
            self.cap = n;
        }
    }
    pub fn free(&mut self) {
        if !self.ptr.is_null() {
            unsafe { alloc::alloc::dealloc(self.ptr, Self::layout(self.cap)) };
            self.ptr = core::ptr::null_mut();
            self.cap = 0;
        }
    }
}

impl Drop for OutBuf {
    fn drop(&mut self) {
        self.free();
    }
}

/// Shared result block, filled by the push functions (and before each
/// js_emit, so onData sees the stream fields pako would show).
#[repr(C)]
pub struct Res {
    pub ret: i32,        // 0  push() return value (1 = true)
    pub ended: i32,      // 1  onEnd called
    pub end_status: i32, // 2
    pub msg: i32,        // 3  strm.msg id
    pub out_ptr: u32,    // 4
    pub out_len: u32,    // 5
    pub adler: u32,      // 6
    pub avail_in: u32,   // 7
    pub next_in: u32,    // 8
    pub avail_out: u32,  // 9
    pub next_out: u32,   // 10
    pub data_type: i32,  // 11
    pub seg_ptr: u32,    // 12 string segments (pairs of u32 start,len)
    pub seg_len: u32,    // 13 number of segments
    pub hv: u32,         // 14 header version
    pub pad: u32,        // 15
    pub total_in: f64,   // 16..17
    pub total_out: f64,  // 18..19
    pub arg: f64,        // 20..21 argument of a js_op
}

static mut RES: Res = Res {
    ret: 0,
    ended: 0,
    end_status: 0,
    msg: 0,
    out_ptr: 0,
    out_len: 0,
    adler: 0,
    avail_in: 0,
    next_in: 0,
    avail_out: 0,
    next_out: 0,
    data_type: 0,
    seg_ptr: 0,
    seg_len: 0,
    hv: 0,
    pad: 0,
    total_in: 0.0,
    total_out: 0.0,
    arg: 0.0,
};

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn fz_res() -> *const Res {
    unsafe { &RES as *const Res }
}

#[allow(static_mut_refs)]
pub fn res() -> &'static mut Res {
    unsafe { &mut RES }
}

// ---------------------------------------------------------------- deflate

pub struct DefSession {
    d: Box<Deflate>,
    out: OutBuf,
    chunk_base: usize,
    /// chunkSize for new chunks (the option, read at every push)
    chunk_size: usize,
    /// size of the current chunk
    cur_cs: usize,
    produced: usize,
    streaming: bool,
    input: OutBuf,
}

/// Create (or re-initialize) a deflate session with deflateInit2's
/// parameters as derived by the JS glue (see Deflate::reinit). hdr: the
/// header pako writes without a dictionary or header option (1 << 16 | the
/// zlib header, 2 << 16 | gzip XFL; 0: none or set later).
#[no_mangle]
pub unsafe extern "C" fn def_init(prev: *mut DefSession, cfg: usize, flags: u32, wrap: i32, w_log: usize, hash_log: usize, hash_shift: usize, lit_log: usize, streaming: i32, hdr: u32) -> *mut DefSession {
    let sp = if prev.is_null() {
        Box::into_raw(Box::new(DefSession {
            d: Deflate::new(),
            out: OutBuf::new(),
            chunk_base: 0,
            chunk_size: 0,
            cur_cs: 0,
            produced: 0,
            streaming: false,
            input: OutBuf::new(),
        }))
    } else {
        prev
    };
    let s = &mut *sp;
    s.d.reinit(cfg, flags, wrap, w_log, hash_log, hash_shift, lit_log);
    if hdr >> 16 == 1 {
        s.d.set_header(&(hdr as u16).to_be_bytes(), false, 0);
    } else if hdr != 0 {
        s.d.set_header(&[31, 139, 8, 0, 0, 0, 0, 0, hdr as u8, 3], false, 0);
    }
    s.d.ext = false;
    s.streaming = streaming != 0;
    s.chunk_base = 0;
    s.produced = 0;
    sp
}

#[no_mangle]
pub unsafe extern "C" fn def_destroy(s: *mut DefSession) {
    if !s.is_null() {
        drop(Box::from_raw(s));
    }
}

/// Buffer for the next push's input, header or dictionary (valid until the
/// next call).
#[no_mangle]
pub unsafe extern "C" fn def_input(s: *mut DefSession, n: usize) -> *mut u8 {
    let s = &mut *s;
    s.input.reserve_exact(n + SLACK, 0);
    s.input.ptr()
}

/// The header bytes (n at offset off in def_input), whether a header crc
/// follows, and where the bytes it covers begin.
#[no_mangle]
pub unsafe extern "C" fn def_set_header(s: *mut DefSession, off: usize, n: usize, hcrc: i32, c0: usize) {
    let s = &mut *s;
    s.d.set_header(core::slice::from_raw_parts(s.input.ptr().add(off), n), hcrc != 0, c0);
}

/// deflateSetDictionary with the dictionary bytes (n, in def_input); `has`:
/// `adler` is the dictionary's check value (computed by the JS glue).
#[no_mangle]
pub unsafe extern "C" fn def_set_dict(s: *mut DefSession, n: usize, adler: u32, has: i32) -> i32 {
    let s = &mut *s;
    let dict = core::slice::from_raw_parts(s.input.ptr(), n).to_vec();
    s.d.set_dictionary(&dict, if has != 0 { Some(adler) } else { None })
}

unsafe fn def_new_chunk(s: &mut DefSession) {
    if s.streaming {
        s.chunk_base = 0;
    } else {
        s.chunk_base = s.produced;
    }
    s.cur_cs = s.chunk_size;
    let need = s.chunk_base + s.cur_cs + SLACK;
    s.out.reserve(need, s.chunk_base);
    s.d.output = s.out.ptr().add(s.chunk_base);
    s.d.next_out = 0;
    s.d.avail_out = s.cur_cs;
}

unsafe fn def_emit(s: &mut DefSession, full: bool) {
    let len = s.d.next_out;
    if s.streaming {
        def_fill_res(s);
        js_emit(if full { 0 } else { 1 }, s.out.ptr().add(s.chunk_base), len, s.cur_cs);
    } else {
        s.produced = s.chunk_base + len;
    }
}

/// pako Deflate.prototype.push for input already placed in def_input()
/// (ext: read through js_op instead).
#[no_mangle]
pub unsafe extern "C" fn def_push(sp: *mut DefSession, len: usize, flush: i32, chunk_size: usize, ext: i32) -> i32 {
    let s = &mut *sp;
    let r = res();
    r.ended = 0;
    s.chunk_size = chunk_size;
    s.d.ext = ext != 0;
    s.d.input = s.input.ptr() as *const u8;
    s.d.next_in = 0;
    s.d.avail_in = len;
    if !s.streaming && s.produced == 0 && s.d.avail_out == 0 {
        s.chunk_base = 0;
        // one-shot: capacity hint only (compressed output is rarely > len/2
        // for real data; the buffer still grows on demand)
        s.out.hint((len / 2).min(1 << 28) + chunk_size + SLACK);
    }
    let mut ret = 1;
    // pako can loop forever: Z_PARTIAL_FLUSH into chunks of 1 byte writes a
    // new empty block per chunk. More output than the input, window, pending
    // buffer and markers can account for means that loop.
    let t0 = s.d.total_out;
    let budget = (len as u64) + 2 * s.d.w_size as u64 + 4 * s.d.lit_bufsize as u64 + (1 << 20);
    loop {
        if s.d.total_out - t0 > budget {
            js_throw(OP_LOOP);
        }
        if s.d.avail_out == 0 {
            def_new_chunk(s);
        }
        if (flush == 2 || flush == 3) && s.d.avail_out <= 6 {
            def_emit(s, false);
            s.d.avail_out = 0;
            continue;
        }
        let mut status = s.d.deflate(flush);
        if status == 1 {
            if s.d.next_out > 0 {
                def_emit(s, false);
            }
            status = s.d.end_status();
            r.ended = 1;
            r.end_status = status;
            ret = (status == 0) as i32;
            break;
        }
        if s.d.avail_out == 0 {
            def_emit(s, true);
            continue;
        }
        if flush > 0 && s.d.next_out > 0 {
            def_emit(s, false);
            s.d.avail_out = 0;
            continue;
        }
        if s.d.avail_in == 0 {
            break;
        }
    }
    r.ret = ret;
    def_fill_res(s);
    ret
}

unsafe fn def_fill_res(s: &mut DefSession) {
    let r = res();
    r.msg = s.d.msg;
    r.adler = s.d.adler;
    r.avail_in = s.d.avail_in as u32;
    r.next_in = s.d.next_in as u32;
    r.avail_out = s.d.avail_out as u32;
    r.next_out = s.d.next_out as u32;
    r.data_type = s.d.data_type;
    r.total_in = s.d.total_in as f64;
    r.total_out = s.d.total_out as f64;
    r.out_ptr = s.out.ptr() as u32;
    r.out_len = s.produced as u32;
}

/// crc32 (for the JS glue: pako's gzip header crc after an exception)
#[no_mangle]
pub unsafe extern "C" fn fz_crc32(crc: u32, p: *const u8, n: usize) -> u32 {
    checksum::crc32(crc, core::slice::from_raw_parts(p, n))
}

/// the stream fields as they are (after an exception thrown by a js_op or
/// an onData handler)
#[no_mangle]
pub unsafe extern "C" fn def_res(s: *mut DefSession) {
    def_fill_res(&mut *s);
}

// ---------------------------------------------------------------- inflate

pub struct InfSession {
    s: Box<Inflate>,
    out: OutBuf,
    chunk_base: usize,
    chunk_size: usize,
    cur_cs: usize,
    produced: usize,
    streaming: bool,
    to_string: bool,
    input: OutBuf,
    dict: Option<Vec<u8>>,
    /// inflate::DICT_* and the id computed by the JS glue
    dict_ext: u32,
    dict_id: u32,
    segs: Vec<u32>,
    ended: bool,
}

/// Create (or re-initialize) an inflate session (wrap and wbits as pako's
/// inflateReset2 derives them, computed by the JS glue).
#[no_mangle]
pub unsafe extern "C" fn inf_init(prev: *mut InfSession, wrap: i32, wbits: u32, streaming: i32) -> *mut InfSession {
    let sp = if prev.is_null() {
        Box::into_raw(Box::new(InfSession {
            s: Inflate::new(),
            out: OutBuf::new(),
            chunk_base: 0,
            chunk_size: 0,
            cur_cs: 0,
            produced: 0,
            streaming: false,
            to_string: false,
            input: OutBuf::new(),
            dict: None,
            dict_ext: 0,
            dict_id: 0,
            segs: Vec::new(),
            ended: false,
        }))
    } else {
        prev
    };
    let s = &mut *sp;
    s.s.reinit(wrap, wbits);
    s.streaming = streaming != 0;
    s.chunk_base = 0;
    s.produced = 0;
    s.dict = None;
    s.segs.clear();
    s.ended = false;
    s.s.get_header();
    s.s.contiguous = streaming == 0;
    s.s.defer_check = streaming == 0;
    s.s.wide = false;
    s.s.nan_have = false;
    sp
}

#[no_mangle]
pub unsafe extern "C" fn inf_destroy(s: *mut InfSession) {
    if !s.is_null() {
        drop(Box::from_raw(s));
    }
}

#[no_mangle]
pub unsafe extern "C" fn inf_input(s: *mut InfSession, n: usize) -> *mut u8 {
    let s = &mut *s;
    s.input.reserve_exact(n + SLACK, 0);
    s.input.ptr()
}

/// Store the dictionary option (n bytes in inf_input; ext: inflate::DICT_*,
/// 4 = none (a falsy option); id: its id when computed by the JS glue); in
/// raw mode it is applied immediately (pako does that in the constructor).
/// Returns the zlib status.
#[no_mangle]
pub unsafe extern "C" fn inf_set_dict(s: *mut InfSession, n: usize, raw: i32, ext: u32, id: u32) -> i32 {
    let s = &mut *s;
    if ext == 4 {
        s.dict = None;
        return 0;
    }
    let d = core::slice::from_raw_parts(s.input.ptr(), n).to_vec();
    s.dict_ext = ext;
    s.dict_id = id;
    let mut st = 0;
    if raw != 0 {
        st = s.s.set_dictionary(&d, ext, id);
    }
    s.dict = Some(d);
    st
}

static UTF8LEN: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut q = 0;
    while q < 256 {
        t[q] = if q >= 252 {
            6
        } else if q >= 248 {
            5
        } else if q >= 240 {
            4
        } else if q >= 224 {
            3
        } else if q >= 192 {
            2
        } else {
            1
        };
        q += 1;
    }
    t[254] = 1;
    t
};

/// pako strings.utf8border(buf, max) with buf.length == chunk_len
fn utf8border(buf: &[u8], chunk_len: usize, max0: usize) -> usize {
    let mut max = if max0 == 0 { chunk_len } else { max0 };
    if max > chunk_len {
        max = chunk_len;
    }
    let mut pos: isize = max as isize - 1;
    while pos >= 0 && (buf[pos as usize] & 0xC0) == 0x80 {
        pos -= 1;
    }
    if pos < 0 {
        return max;
    }
    if pos == 0 {
        return max;
    }
    if pos as usize + UTF8LEN[buf[pos as usize] as usize] as usize > max {
        pos as usize
    } else {
        max
    }
}

unsafe fn inf_new_chunk(s: &mut InfSession) {
    if s.streaming {
        s.chunk_base = 0;
    } else {
        s.chunk_base = s.produced;
    }
    s.cur_cs = s.chunk_size;
    let need = s.chunk_base + s.cur_cs + SLACK;
    s.out.reserve(need, s.chunk_base);
    s.s.out_base = s.out.ptr();
    s.s.output = s.out.ptr().add(s.chunk_base);
    s.s.next_out = 0;
    s.s.avail_out = s.cur_cs;
}

/// inf_push flags: the input was an ArrayBuffer (data[i] is undefined)
const IF_AB: i32 = 1;
/// options.to === 'string'
const IF_STRING: i32 = 2;
/// input elements are read through js_op
const IF_WIDE: i32 = 4;
/// (wide) pako's avail_in is NaN
const IF_NAN: i32 = 8;
/// strm.input is falsy
const IF_NULL: i32 = 16;

/// pako Inflate.prototype.push for input placed in inf_input() (or read
/// through js_op: IF_WIDE; len is then the element count).
#[no_mangle]
pub unsafe extern "C" fn inf_push(sp: *mut InfSession, len: usize, flush: i32, flags: i32, chunk_size: usize) -> i32 {
    let s = &mut *sp;
    let r = res();
    r.ended = 0;
    s.segs.clear();
    s.chunk_size = chunk_size;
    s.to_string = flags & IF_STRING != 0;
    let wide = flags & IF_WIDE != 0;
    let nan = flags & IF_NAN != 0;
    if wide {
        s.s.set_wide();
    }
    s.s.nan_have = nan;
    s.s.input = if flags & IF_NULL != 0 { core::ptr::null() } else { s.input.ptr() as *const u8 };
    s.s.next_in = 0;
    s.s.avail_in = len;
    let data = s.input.ptr() as *const u8;
    if !s.streaming && s.produced == 0 && s.chunk_base == 0 && !wide {
        // one-shot: size the output buffer up front (only a capacity hint;
        // the chunking below is unchanged). A gzip member's trailer holds
        // the uncompressed size; otherwise guess 4x.
        // (a corrupt trailer can claim anything: cap the hint at 64x the
        // input and never fail on it)
        let cap = len.saturating_mul(64).saturating_add(1 << 20).min(1 << 28);
        let mut hint = len.saturating_mul(4);
        if len >= 18 && (s.s.wrap & 2) != 0 && *data == 0x1f && *data.add(1) == 0x8b {
            hint = (data.add(len - 4) as *const u32).read_unaligned() as usize;
        }
        s.out.hint(hint.min(cap) + chunk_size + SLACK);
    }
    let mut ret = 1;
    loop {
        if s.s.avail_out == 0 {
            inf_new_chunk(s);
        }
        let mut status = s.s.inflate(flush);
        if status == inflate::Z_NEED_DICT {
            if let Some(d) = s.dict.as_deref() {
                status = s.s.set_dictionary(d, s.dict_ext, s.dict_id);
                if status == 0 {
                    status = s.s.inflate(flush);
                } else if status == inflate::Z_DATA_ERROR {
                    status = inflate::Z_NEED_DICT;
                }
            }
        }
        // (the next member starts unless the next input element is 0)
        while s.s.avail_in > 0
            && !nan
            && status == inflate::Z_STREAM_END
            && s.s.wrap > 0
            && (flags & IF_AB != 0 || if wide { js_op(OP_NZ, s.s.next_in, 0, 0) != 0 } else { *data.add(s.s.next_in) != 0 })
        {
            s.s.reset();
            status = s.s.inflate(flush);
        }
        match status {
            inflate::Z_STREAM_ERROR | inflate::Z_DATA_ERROR | inflate::Z_NEED_DICT | inflate::Z_MEM_ERROR => {
                r.ended = 1;
                r.end_status = status;
                s.ended = true;
                ret = 0;
                break;
            }
            _ => {}
        }
        let last_avail_out = s.s.avail_out;
        if s.s.next_out != 0 && (s.s.avail_out == 0 || status == inflate::Z_STREAM_END) {
            let next_out = s.s.next_out;
            if s.to_string {
                let chunk = core::slice::from_raw_parts(s.out.ptr().add(s.chunk_base), next_out);
                let border = utf8border(chunk, s.cur_cs, next_out);
                let tail = next_out - border;
                // (pako realigns the counters before onData)
                s.s.next_out = tail;
                s.s.avail_out = s.cur_cs - tail;
                if s.streaming {
                    inf_fill_res(s);
                    js_emit(2, s.out.ptr().add(s.chunk_base), border, s.cur_cs);
                    if tail != 0 {
                        let base = s.out.ptr().add(s.chunk_base);
                        core::ptr::copy(base.add(border), base, tail);
                    }
                } else {
                    s.segs.push(s.chunk_base as u32);
                    s.segs.push(border as u32);
                    // the chunk now logically starts at the tail
                    s.chunk_base += border;
                    s.produced = s.chunk_base + tail;
                    let need = s.chunk_base + s.cur_cs + SLACK;
                    s.out.reserve(need, s.produced);
                    s.s.out_base = s.out.ptr();
                    s.s.output = s.out.ptr().add(s.chunk_base);
                }
            } else if s.streaming {
                inf_fill_res(s);
                js_emit(if s.cur_cs == next_out { 0 } else { 1 }, s.out.ptr().add(s.chunk_base), next_out, s.cur_cs);
            } else {
                s.produced = s.chunk_base + next_out;
            }
        }
        if status == inflate::Z_OK && last_avail_out == 0 {
            continue;
        }
        if status == inflate::Z_STREAM_END {
            let st = s.s.end();
            r.ended = 1;
            r.end_status = st;
            s.ended = true;
            ret = 1;
            break;
        }
        if s.s.avail_in == 0 {
            break;
        }
    }
    // non-streaming: bytes written into the current (unemitted) chunk still
    // count as produced output for the one-shot result
    if !s.streaming && !s.to_string && !s.ended {
        s.produced = s.chunk_base + s.s.next_out;
    }
    r.ret = ret;
    inf_fill_res(s);
    ret
}

unsafe fn inf_fill_res(s: &mut InfSession) {
    let r = res();
    r.msg = s.s.msg as i32;
    r.adler = s.s.adler;
    r.avail_in = s.s.avail_in as u32;
    r.next_in = s.s.next_in as u32;
    r.avail_out = s.s.avail_out as u32;
    r.next_out = s.s.next_out as u32;
    r.data_type = s.s.data_type;
    r.total_in = s.s.total_in as f64;
    r.total_out = s.s.total_out as f64;
    r.out_ptr = s.out.ptr() as u32;
    r.out_len = s.produced as u32;
    r.seg_ptr = s.segs.as_ptr() as u32;
    r.seg_len = (s.segs.len() / 2) as u32;
    r.hv = s.s.head.version;
}

/// the stream fields as they are (after an exception)
#[no_mangle]
pub unsafe extern "C" fn inf_res(s: *mut InfSession) {
    inf_fill_res(&mut *s);
}

/// Header snapshot for JS: returns pointer to a small struct.
#[repr(C)]
pub struct HeadOut {
    time: f64,
    extra_len: f64,
    text: u32,
    xflags: u32,
    os: i32,
    extra_ptr: u32,
    extra_bytes: i32, // -1 = null
    name_ptr: u32,
    name_len: i32, // UTF-16 code units; -1 = null
    comment_ptr: u32,
    comment_len: i32,
    hcrc: u32,
    done: u32,
}

static mut HEAD_OUT: HeadOut = HeadOut {
    time: 0.0,
    extra_len: 0.0,
    text: 0,
    xflags: 0,
    os: 0,
    extra_ptr: 0,
    extra_bytes: -1,
    name_ptr: 0,
    name_len: 0,
    comment_ptr: 0,
    comment_len: 0,
    hcrc: 0,
    done: 0,
};

#[no_mangle]
#[allow(static_mut_refs)]
pub unsafe extern "C" fn inf_header(sp: *mut InfSession) -> *const HeadOut {
    let h = &(*sp).s.head;
    let o = &mut HEAD_OUT;
    o.text = h.text;
    o.time = h.time;
    o.xflags = h.xflags;
    o.os = h.os;
    match &h.extra {
        Some(e) => {
            o.extra_ptr = e.as_ptr() as u32;
            o.extra_bytes = e.len() as i32;
        }
        None => o.extra_bytes = -1,
    }
    o.extra_len = h.extra_len;
    let v = |x: &Option<Vec<u16>>| match x {
        Some(e) => (e.as_ptr() as u32, e.len() as i32),
        None => (0, -1),
    };
    (o.name_ptr, o.name_len) = v(&h.name);
    (o.comment_ptr, o.comment_len) = v(&h.comment);
    o.hcrc = h.hcrc;
    o.done = h.done as u32;
    o as *const HeadOut
}

/// Release big buffers of a pooled session (keeps memory bounded).
#[no_mangle]
pub unsafe extern "C" fn inf_trim(sp: *mut InfSession, keep: usize) {
    let s = &mut *sp;
    if s.out.cap() > keep {
        s.out.free();
    }
    if s.input.cap() > keep {
        s.input.free();
    }
}

#[no_mangle]
pub unsafe extern "C" fn def_trim(sp: *mut DefSession, keep: usize) {
    let s = &mut *sp;
    if s.out.cap() > keep {
        s.out.free();
    }
    if s.input.cap() > keep {
        s.input.free();
    }
}

/// `n` through an opaque stack round trip: the bound of small setup loops
/// (once per stream or block), so LLVM keeps them as loops instead of
/// unrolling them for speed nobody needs there.
#[inline(always)]
pub(crate) fn rolled(n: usize) -> usize {
    core::hint::black_box(n)
}
