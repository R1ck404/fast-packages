// 64-bit LSB-first bit reader over the whole input, which the caller copies
// into a buffer with PAD zero bytes after it. Refill is branchless: one
// unaligned 8-byte load at min(pos, len) (past the end that reads zeros)
// tops the buffer up to 56..63 bits. `pos` keeps counting past the end, so
// reads never fail; the decoder checks `overrun()` (bits consumed beyond the
// input) before reporting success. Bits above `bits` in `val` are always
// either zero or the true next input bits, so re-OR-ing a partially consumed
// byte is harmless.

pub const PAD: usize = 8;

#[derive(Clone, Copy)]
pub struct Br {
    pub val: u64,
    pub bits: u32,
    pub pos: usize,
    ptr: *const u8,
    len: usize,
}

impl Br {
    // `inp` must be followed by PAD zero bytes
    pub fn new(ptr: *const u8, len: usize) -> Br {
        Br { val: 0, bits: 0, pos: 0, ptr, len }
    }

    // restart at byte `pos` with an empty buffer (after raw byte copies)
    pub fn reset_at(&mut self, pos: usize) {
        self.val = 0;
        self.bits = 0;
        self.pos = pos;
    }

    // guarantees at least 56 valid bits
    #[inline(always)]
    pub fn refill(&mut self) {
        let p = if self.pos < self.len { self.pos } else { self.len };
        let w = unsafe { (self.ptr.add(p) as *const u64).read_unaligned() };
        self.val |= u64::from_le(w) << self.bits;
        self.pos += ((63 - self.bits) >> 3) as usize;
        self.bits |= 56;
    }

    #[inline(always)]
    pub fn peek(&self, n: u32) -> u32 {
        (self.val & ((1u64 << n) - 1)) as u32
    }

    #[inline(always)]
    pub fn skip(&mut self, n: u32) {
        self.val >>= n;
        self.bits -= n;
    }

    // caller must have refilled enough (n <= bits)
    #[inline(always)]
    pub fn read(&mut self, n: u32) -> u32 {
        let v = self.peek(n);
        self.skip(n);
        v
    }

    // drops the bits up to the next byte boundary and returns them
    #[inline(always)]
    pub fn align(&mut self) -> u32 {
        let k = self.bits & 7;
        self.read(k)
    }

    // index of the next unconsumed byte (only meaningful when aligned)
    #[inline(always)]
    pub fn byte_pos(&self) -> usize {
        self.pos - (self.bits >> 3) as usize
    }

    // true once more bits were consumed than the input holds
    #[inline(always)]
    pub fn overrun(&self) -> bool {
        self.pos * 8 - self.bits as usize > self.len * 8
    }

    // cheap sufficient test for overrun (more than 8 phantom bytes loaded)
    #[inline(always)]
    pub fn far_past_end(&self) -> bool {
        self.pos > self.len + 8
    }
}
