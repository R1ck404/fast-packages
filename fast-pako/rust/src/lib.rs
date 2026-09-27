// fastzlib: wasm core of fast-pako. Exposes zlib-level state machines that
// are exact ports of pako's, plus the pako `push()` loops (chunking,
// multi-member handling, to:'string' segmentation) so results, chunk
// boundaries and error behaviour match pako 2.1.0 exactly.

mod checksum;
mod deflate;
mod fasttab;
mod inflate;
mod inftrees;
mod trees;

use deflate::{Deflate, GzHead};
use inflate::Inflate;

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    /// kind: 0 = full chunk, 1 = partial chunk (subarray), 2 = string segment
    fn js_emit(kind: u32, ptr: *const u8, len: usize, chunk_size: usize);
}

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
    fn layout(n: usize) -> std::alloc::Layout {
        unsafe { std::alloc::Layout::from_size_align_unchecked(n, 16) }
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
                let p = std::alloc::alloc(Self::layout(need));
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
        use std::alloc::{alloc, dealloc, handle_alloc_error, realloc};
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
            unsafe { std::alloc::dealloc(self.ptr, Self::layout(self.cap)) };
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

#[no_mangle]
pub extern "C" fn fz_alloc(n: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

#[no_mangle]
pub unsafe extern "C" fn fz_free(p: *mut u8, n: usize) {
    drop(Vec::from_raw_parts(p, 0, n.max(1)));
}

/// Shared result block read by JS after each call.
#[repr(C)]
pub struct Res {
    pub status: i32,    // 0
    pub ret: i32,       // 1  push() return value (1 = true)
    pub ended: i32,     // 2  onEnd called
    pub end_status: i32,// 3
    pub msg: i32,       // 4  strm.msg id
    pub out_ptr: u32,   // 5
    pub out_len: u32,   // 6
    pub adler: u32,     // 7
    pub avail_in: u32,  // 8
    pub next_in: u32,   // 9
    pub avail_out: u32, // 10
    pub next_out: u32,  // 11
    pub data_type: i32, // 12
    pub seg_ptr: u32,   // 13 string segments (pairs of u32 start,len)
    pub seg_len: u32,   // 14 number of segments
    pub hv: u32,        // 15 header version
    pub total_in: f64,  // 16..17
    pub total_out: f64, // 18..19
}

static mut RES: Res = Res {
    status: 0,
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
    total_in: 0.0,
    total_out: 0.0,
};

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn fz_res() -> *const Res {
    unsafe { &RES as *const Res }
}

#[allow(static_mut_refs)]
fn res() -> &'static mut Res {
    unsafe { &mut RES }
}

// ---------------------------------------------------------------- deflate

pub struct DefSession {
    d: Box<Deflate>,
    out: OutBuf,
    chunk_base: usize,
    chunk_size: usize,
    produced: usize,
    streaming: bool,
    input: OutBuf,
}

/// Create (or re-initialize) a deflate session. Returns 0 and sets
/// RES.status on invalid parameters.
#[no_mangle]
pub unsafe extern "C" fn def_init(prev: *mut DefSession, level: i32, method: i32, wbits: i32, mem_level: i32, strategy: i32, chunk_size: usize, streaming: i32) -> *mut DefSession {
    let r = res();
    if !prev.is_null() {
        let s = &mut *prev;
        let st = s.d.reinit(level, method, wbits, mem_level, strategy);
        if st != 0 {
            r.status = st;
            return core::ptr::null_mut();
        }
        s.chunk_size = chunk_size;
        s.streaming = streaming != 0;
        s.chunk_base = 0;
        s.produced = 0;
        r.status = 0;
        return prev;
    }
    match Deflate::new(level, method, wbits, mem_level, strategy) {
        Ok(d) => {
            r.status = 0;
            Box::into_raw(Box::new(DefSession {
                d,
                out: OutBuf::new(),
                chunk_base: 0,
                chunk_size,
                produced: 0,
                streaming: streaming != 0,
                input: OutBuf::new(),
            }))
        }
        Err(e) => {
            r.status = e;
            core::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn def_destroy(s: *mut DefSession) {
    if !s.is_null() {
        drop(Box::from_raw(s));
    }
}

/// Buffer for the next push's input (valid until the next call).
#[no_mangle]
pub unsafe extern "C" fn def_input(s: *mut DefSession, n: usize) -> *mut u8 {
    let s = &mut *s;
    s.input.reserve_exact(n + SLACK, 0);
    s.input.ptr()
}

#[no_mangle]
pub unsafe extern "C" fn def_set_header(
    s: *mut DefSession,
    text: i32,
    hcrc: i32,
    time: u32,
    os: u32,
    extra_ptr: *const u8,
    extra_len: i32,
    name_ptr: *const u8,
    name_len: i32,
    comment_ptr: *const u8,
    comment_len: i32,
) -> i32 {
    let s = &mut *s;
    let v = |p: *const u8, n: i32| -> Option<Vec<u8>> {
        if n < 0 {
            None
        } else {
            Some(core::slice::from_raw_parts(p, n as usize).to_vec())
        }
    };
    s.d.set_header(GzHead {
        text: text != 0,
        hcrc: hcrc != 0,
        time,
        os: os as u8,
        extra: v(extra_ptr, extra_len),
        name: v(name_ptr, name_len),
        comment: v(comment_ptr, comment_len),
    })
}

#[no_mangle]
pub unsafe extern "C" fn def_set_dict(s: *mut DefSession, p: *const u8, n: usize) -> i32 {
    let s = &mut *s;
    let dict = core::slice::from_raw_parts(p, n).to_vec();
    s.d.set_dictionary(&dict)
}

unsafe fn def_new_chunk(s: &mut DefSession) {
    if s.streaming {
        s.chunk_base = 0;
    } else {
        s.chunk_base = s.produced;
    }
    let need = s.chunk_base + s.chunk_size + SLACK;
    s.out.reserve(need, s.chunk_base);
    s.d.output = s.out.ptr().add(s.chunk_base);
    s.d.next_out = 0;
    s.d.avail_out = s.chunk_size;
}

unsafe fn def_emit(s: &mut DefSession, full: bool) {
    let len = s.d.next_out;
    if s.streaming {
        js_emit(if full { 0 } else { 1 }, s.out.ptr().add(s.chunk_base), len, s.chunk_size);
    } else {
        s.produced = s.chunk_base + len;
    }
}

/// pako Deflate.prototype.push for input already placed in def_input().
#[no_mangle]
pub unsafe extern "C" fn def_push(sp: *mut DefSession, len: usize, flush: i32) -> i32 {
    let s = &mut *sp;
    let r = res();
    r.ended = 0;
    s.d.input = s.input.ptr() as *const u8;
    s.d.next_in = 0;
    s.d.avail_in = len;
    if !s.streaming && s.produced == 0 && s.d.avail_out == 0 {
        s.chunk_base = 0;
        // one-shot: capacity hint only (compressed output is rarely > len/2
        // for real data; the buffer still grows on demand)
        s.out.hint((len / 2).min(1 << 28) + s.chunk_size + SLACK);
    }
    let mut ret = 1;
    loop {
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

// ---------------------------------------------------------------- inflate

pub struct InfSession {
    s: Box<Inflate>,
    out: OutBuf,
    chunk_base: usize,
    chunk_size: usize,
    produced: usize,
    streaming: bool,
    to_string: bool,
    input: OutBuf,
    dict: Option<Vec<u8>>,
    segs: Vec<u32>,
    wbits: i32,
    ended: bool,
}

#[no_mangle]
pub unsafe extern "C" fn inf_init(prev: *mut InfSession, wbits: i32, chunk_size: usize, streaming: i32, to_string: i32) -> *mut InfSession {
    let r = res();
    if !prev.is_null() {
        let s = &mut *prev;
        let st = s.s.reinit(wbits);
        if st != 0 {
            r.status = st;
            return core::ptr::null_mut();
        }
        s.chunk_size = chunk_size;
        s.streaming = streaming != 0;
        s.to_string = to_string != 0;
        s.chunk_base = 0;
        s.produced = 0;
        s.dict = None;
        s.segs.clear();
        s.wbits = wbits;
        s.ended = false;
        r.status = 0;
        s.s.get_header();
        s.s.contiguous = streaming == 0;
        s.s.defer_check = streaming == 0;
        return prev;
    }
    match Inflate::new(wbits) {
        Ok(mut st) => {
            r.status = 0;
            st.get_header();
            st.contiguous = streaming == 0;
            st.defer_check = streaming == 0;
            Box::into_raw(Box::new(InfSession {
                s: st,
                out: OutBuf::new(),
                chunk_base: 0,
                chunk_size,
                produced: 0,
                streaming: streaming != 0,
                to_string: to_string != 0,
                input: OutBuf::new(),
                dict: None,
                segs: Vec::new(),
                wbits,
                ended: false,
            }))
        }
        Err(e) => {
            r.status = e;
            core::ptr::null_mut()
        }
    }
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

/// Store the dictionary option; in raw mode it is applied immediately
/// (pako does that in the constructor). Returns the zlib status.
#[no_mangle]
pub unsafe extern "C" fn inf_set_dict(s: *mut InfSession, p: *const u8, n: usize, raw: i32) -> i32 {
    let s = &mut *s;
    let d = core::slice::from_raw_parts(p, n).to_vec();
    let mut st = 0;
    if raw != 0 {
        st = s.s.set_dictionary(&d);
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

/// pako strings.utf8border(buf, max) with buf.length == chunk_size
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
    let need = s.chunk_base + s.chunk_size + SLACK;
    s.out.reserve(need, s.chunk_base);
    s.s.out_base = s.out.ptr();
    s.s.output = s.out.ptr().add(s.chunk_base);
    s.s.next_out = 0;
    s.s.avail_out = s.chunk_size;
}

/// pako Inflate.prototype.push. `ab` = input was an ArrayBuffer (pako's
/// multi-member check then reads `undefined`, which is always !== 0).
#[no_mangle]
pub unsafe extern "C" fn inf_push(sp: *mut InfSession, len: usize, flush: i32, ab: i32) -> i32 {
    let s = &mut *sp;
    let r = res();
    r.ended = 0;
    s.segs.clear();
    s.s.input = s.input.ptr() as *const u8;
    s.s.next_in = 0;
    s.s.avail_in = len;
    let data = s.input.ptr() as *const u8;
    if !s.streaming && s.produced == 0 && s.chunk_base == 0 {
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
        s.out.hint(hint.min(cap) + s.chunk_size + SLACK);
    }
    let mut ret = 1;
    loop {
        if s.s.avail_out == 0 {
            inf_new_chunk(s);
        }
        let mut status = s.s.inflate(flush);
        if status == inflate::Z_NEED_DICT {
            if let Some(d) = s.dict.take() {
                status = s.s.set_dictionary(&d);
                if status == 0 {
                    status = s.s.inflate(flush);
                } else if status == inflate::Z_DATA_ERROR {
                    status = inflate::Z_NEED_DICT;
                }
                s.dict = Some(d);
            }
        }
        while s.s.avail_in > 0 && status == inflate::Z_STREAM_END && s.s.wrap > 0 && (ab != 0 || *data.add(s.s.next_in) != 0) {
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
                let border = utf8border(chunk, s.chunk_size, next_out);
                let tail = next_out - border;
                if s.streaming {
                    js_emit(2, s.out.ptr().add(s.chunk_base), border, s.chunk_size);
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
                    let need = s.chunk_base + s.chunk_size + SLACK;
                    s.out.reserve(need, s.produced);
                    s.s.out_base = s.out.ptr();
                    s.s.output = s.out.ptr().add(s.chunk_base);
                }
                s.s.next_out = tail;
                s.s.avail_out = s.chunk_size - tail;
            } else if s.streaming {
                js_emit(if s.chunk_size == next_out { 0 } else { 1 }, s.out.ptr().add(s.chunk_base), next_out, s.chunk_size);
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
    ret
}

/// Header snapshot for JS: returns pointer to a small struct.
#[repr(C)]
pub struct HeadOut {
    text: u32,
    time: u32,
    xflags: u32,
    os: u32,
    extra_ptr: u32,
    extra_len: i32, // -1 = null
    extra_field_len: u32,
    name_ptr: u32,
    name_len: i32,
    comment_ptr: u32,
    comment_len: i32,
    hcrc: u32,
    done: u32,
}

static mut HEAD_OUT: HeadOut = HeadOut {
    text: 0,
    time: 0,
    xflags: 0,
    os: 0,
    extra_ptr: 0,
    extra_len: -1,
    extra_field_len: 0,
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
            o.extra_len = e.len() as i32;
        }
        None => o.extra_len = -1,
    }
    o.extra_field_len = h.extra_len;
    match &h.name {
        Some(e) => {
            o.name_ptr = e.as_ptr() as u32;
            o.name_len = e.len() as i32;
        }
        None => o.name_len = -1,
    }
    match &h.comment {
        Some(e) => {
            o.comment_ptr = e.as_ptr() as u32;
            o.comment_len = e.len() as i32;
        }
        None => o.comment_len = -1,
    }
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

#[no_mangle]
pub extern "C" fn fz_crc32(crc: u32, p: *const u8, n: usize) -> u32 {
    checksum::crc32(crc, unsafe { core::slice::from_raw_parts(p, n) })
}

#[no_mangle]
pub extern "C" fn fz_adler32(a: u32, p: *const u8, n: usize) -> u32 {
    checksum::adler32(a, unsafe { core::slice::from_raw_parts(p, n) })
}
