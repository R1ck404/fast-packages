// Small allocator for the wasm build (replaces std's dlmalloc, ~8 KB of
// code): first fit over an address-ordered free list, neighbours merged on
// free, the free block at the end of the heap given back to the untouched
// "top" area, and realloc in place when the block is last or followed by a
// free block. The allocation pattern is a handful of blocks per session
// (state, window, hash tables, input/output buffers), so the list stays
// short.
//
// Block: 16-byte header (size of the whole block, a multiple of 16), then
// the payload (16-aligned). A free block keeps the address of the next free
// block after its size.

use core::alloc::{GlobalAlloc, Layout};

const HDR: usize = 16;
const MIN_SPLIT: usize = 32;

pub struct Heap {
    /// first free block (0: none)
    free: usize,
    /// end of the carved blocks; [top, end) is unused memory
    top: usize,
    end: usize,
}

#[inline(always)]
unsafe fn size_of_block(b: usize) -> usize {
    *(b as *const usize)
}
#[inline(always)]
unsafe fn set_size(b: usize, s: usize) {
    *(b as *mut usize) = s;
}
#[inline(always)]
unsafe fn next_of(b: usize) -> usize {
    *((b + 8) as *const usize)
}
#[inline(always)]
unsafe fn set_next(b: usize, n: usize) {
    *((b + 8) as *mut usize) = n;
}

/// block size for a payload of n bytes (None on overflow)
#[inline(always)]
fn block_size(n: usize) -> Option<usize> {
    n.checked_add(HDR + 15).map(|s| s & !15)
}

impl Heap {
    pub const fn new() -> Heap {
        Heap { free: 0, top: 0, end: 0 }
    }

    /// Make [top, top + need) available; false if memory cannot grow.
    #[inline(never)]
    unsafe fn reserve_top(&mut self, need: usize) -> bool {
        if self.top == 0 {
            let (b, e) = initial_region();
            self.top = (b + 15) & !15;
            self.end = e;
        }
        let want = match self.top.checked_add(need) {
            Some(w) => w,
            None => return false,
        };
        if want > self.end {
            match grow(want - self.end) {
                Some(new_end) => self.end = new_end,
                None => return false,
            }
        }
        true
    }

    #[inline(never)]
    pub unsafe fn alloc(&mut self, n: usize) -> *mut u8 {
        let need = match block_size(n) {
            Some(s) => s,
            None => return core::ptr::null_mut(),
        };
        // first fit
        let mut prev = 0usize;
        let mut b = self.free;
        while b != 0 {
            let s = size_of_block(b);
            if s >= need {
                let nx = next_of(b);
                let rest = if s - need >= MIN_SPLIT {
                    let r = b + need;
                    set_size(r, s - need);
                    set_next(r, nx);
                    set_size(b, need);
                    r
                } else {
                    nx
                };
                if prev == 0 {
                    self.free = rest;
                } else {
                    set_next(prev, rest);
                }
                return (b + HDR) as *mut u8;
            }
            prev = b;
            b = next_of(b);
        }
        if !self.reserve_top(need) {
            return core::ptr::null_mut();
        }
        let b = self.top;
        self.top += need;
        set_size(b, need);
        (b + HDR) as *mut u8
    }

    #[inline(never)]
    pub unsafe fn free(&mut self, p: *mut u8) {
        let mut b = p as usize - HDR;
        let mut s = size_of_block(b);
        // find the neighbours in the address-ordered list
        let mut prev = 0usize;
        let mut nx = self.free;
        while nx != 0 && nx < b {
            prev = nx;
            nx = next_of(nx);
        }
        if nx != 0 && b + s == nx {
            s += size_of_block(nx);
            nx = next_of(nx);
        }
        if prev != 0 && prev + size_of_block(prev) == b {
            b = prev;
            s += size_of_block(prev);
            // prev's predecessor link stays; find it only if b goes to top
        }
        if b + s == self.top {
            // give the block back to the top area: unlink it (it is prev or new)
            self.top = b;
            if b == prev {
                self.unlink(prev);
            }
            return;
        }
        set_size(b, s);
        set_next(b, nx);
        if b != prev {
            if prev == 0 {
                self.free = b;
            } else {
                set_next(prev, b);
            }
        }
    }

    unsafe fn unlink(&mut self, b: usize) {
        if self.free == b {
            self.free = next_of(b);
            return;
        }
        let mut q = self.free;
        while next_of(q) != b {
            q = next_of(q);
        }
        set_next(q, next_of(b));
    }

    #[inline(never)]
    pub unsafe fn realloc(&mut self, p: *mut u8, old: usize, n: usize) -> *mut u8 {
        let need = match block_size(n) {
            Some(s) => s,
            None => return core::ptr::null_mut(),
        };
        let b = p as usize - HDR;
        let s = size_of_block(b);
        if need <= s {
            return p;
        }
        if b + s == self.top {
            if !self.reserve_top(need - s) {
                return core::ptr::null_mut();
            }
            self.top = b + need;
            set_size(b, need);
            return p;
        }
        // followed by a free block that is big enough?
        let after = b + s;
        let mut prev = 0usize;
        let mut q = self.free;
        while q != 0 && q < after {
            prev = q;
            q = next_of(q);
        }
        if q == after {
            let qs = size_of_block(q);
            if s + qs >= need {
                let nx = next_of(q);
                let total = s + qs;
                let rest = if total - need >= MIN_SPLIT {
                    let r = b + need;
                    set_size(r, total - need);
                    set_next(r, nx);
                    set_size(b, need);
                    r
                } else {
                    set_size(b, total);
                    nx
                };
                if prev == 0 {
                    self.free = rest;
                } else {
                    set_next(prev, rest);
                }
                return p;
            }
        }
        let np = self.alloc(n);
        if !np.is_null() {
            core::ptr::copy_nonoverlapping(p, np, if old < n { old } else { n });
            self.free(p);
        }
        np
    }
}

#[cfg(target_arch = "wasm32")]
unsafe fn initial_region() -> (usize, usize) {
    extern "C" {
        static __heap_base: u8;
    }
    (&__heap_base as *const u8 as usize, core::arch::wasm32::memory_size::<0>() << 16)
}

/// Grow memory by at least `by` bytes; returns the new end.
#[cfg(target_arch = "wasm32")]
unsafe fn grow(by: usize) -> Option<usize> {
    let pages = (by + 0xffff) >> 16;
    if core::arch::wasm32::memory_grow::<0>(pages) == usize::MAX {
        return None;
    }
    Some(core::arch::wasm32::memory_size::<0>() << 16)
}

// native tests: a fixed arena standing in for wasm memory
#[cfg(not(target_arch = "wasm32"))]
pub static mut ARENA: (usize, usize, usize) = (0, 0, 0); // base, committed end, limit

#[cfg(not(target_arch = "wasm32"))]
unsafe fn initial_region() -> (usize, usize) {
    (ARENA.0, ARENA.1)
}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn grow(by: usize) -> Option<usize> {
    let e = ARENA.1 + ((by + 0xffff) & !0xffff);
    if e > ARENA.2 {
        return None;
    }
    ARENA.1 = e;
    Some(e)
}

pub struct Global;

static mut HEAP: Heap = Heap::new();

#[allow(static_mut_refs)]
unsafe impl GlobalAlloc for Global {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        if l.align() > 16 {
            return core::ptr::null_mut();
        }
        HEAP.alloc(l.size())
    }
    unsafe fn dealloc(&self, p: *mut u8, _l: Layout) {
        HEAP.free(p)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        HEAP.realloc(p, l.size(), n)
    }
}

#[cfg(test)]
mod heap_tests {
    use super::*;

    /// Random alloc/free/realloc against an arena; checks that live blocks
    /// never overlap, contents survive realloc, and freed memory is reused
    /// (the heap does not grow past the peak of live bytes by much).
    #[test]
    fn heap_fuzz() {
        unsafe {
            let limit = 512 << 20;
            let mem = std::alloc::alloc(std::alloc::Layout::from_size_align(limit + 16, 16).unwrap()) as usize;
            ARENA = (mem + 8, mem + 8, mem + limit); // unaligned base on purpose
            let mut h = Heap::new();
            let mut live: Vec<(usize, usize, u8)> = Vec::new();
            let mut rng: u64 = 0x9e3779b97f4a7c15;
            let mut next = || {
                rng ^= rng << 13;
                rng ^= rng >> 7;
                rng ^= rng << 17;
                rng
            };
            let mut peak = 0usize;
            for step in 0..200_000u32 {
                let r = next();
                let op = r % 10;
                let target = if (step / 20000) % 2 == 0 { 40 } else { 8 };
                if live.is_empty() || (op < 6 && live.len() < target) {
                    let n = match (r >> 8) % 4 {
                        0 => ((r >> 16) % 64) as usize,
                        1 => ((r >> 16) % 4096) as usize,
                        2 => ((r >> 16) % 70000) as usize,
                        _ => ((r >> 16) % 600000) as usize,
                    };
                    let p = h.alloc(n) as usize;
                    assert!(p != 0 && p % 16 == 0);
                    let tag = step as u8;
                    core::ptr::write_bytes(p as *mut u8, tag, n);
                    live.push((p, n, tag));
                } else if op < 8 || live.len() >= target {
                    let i = (r >> 8) as usize % live.len();
                    let (p, n, tag) = live.swap_remove(i);
                    for k in [0, n / 2, n.wrapping_sub(1)] {
                        if k < n {
                            assert_eq!(*((p + k) as *const u8), tag);
                        }
                    }
                    h.free(p as *mut u8);
                } else {
                    let i = (r >> 8) as usize % live.len();
                    let (p, n, tag) = live[i];
                    let m = n + ((r >> 16) % 200000) as usize;
                    let q = h.realloc(p as *mut u8, n, m) as usize;
                    assert!(q != 0 && q % 16 == 0);
                    for k in [0, n / 2, n.wrapping_sub(1)] {
                        if k < n {
                            assert_eq!(*((q + k) as *const u8), tag);
                        }
                    }
                    core::ptr::write_bytes(q as *mut u8, tag, m);
                    live[i] = (q, m, tag);
                }
                let total: usize = live.iter().map(|x| x.1).sum();
                peak = peak.max(total);
                if step % 997 == 0 {
                    let mut v: Vec<(usize, usize)> = live.iter().map(|x| (x.0 - HDR, size_of_block(x.0 - HDR))).collect();
                    v.sort();
                    for w in v.windows(2) {
                        assert!(w[0].0 + w[0].1 <= w[1].0, "overlap");
                    }
                    // free list sorted, no adjacent free blocks, nothing at top
                    let mut b = h.free;
                    let mut last = 0;
                    while b != 0 {
                        assert!(b > last && (last == 0 || last + size_of_block(last) < b));
                        assert!(b + size_of_block(b) < h.top);
                        last = b;
                        b = next_of(b);
                    }
                    for &(p, s) in &v {
                        assert!(p + s <= h.top);
                    }
                }
            }
            let used = h.end - ARENA.0;
            assert!(used < 4 * peak + (8 << 20), "heap grew to {} for a peak of {}", used, peak);
            eprintln!("heap_fuzz: heap {} KB, peak live {} KB", used >> 10, peak >> 10);
        }
    }
}
