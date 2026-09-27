// LZ77 match copy (forward, overlapping) with 16-byte SIMD chunks. The
// common case (len <= 32) is branch-free; it may write up to 32 bytes past
// the end of the match, callers keep SLACK bytes of spare capacity.

#[cfg(target_arch = "wasm32")]
use core::arch::wasm32::*;

// PAT[d][i] = i % d: swizzle that repeats a d-byte period (d = 1..15)
#[cfg(target_arch = "wasm32")]
static PAT: [[u8; 16]; 16] = {
    let mut p = [[0u8; 16]; 16];
    let mut d = 1;
    while d < 16 {
        let mut i = 0;
        while i < 16 {
            p[d][i] = (i % d) as u8;
            i += 1;
        }
        d += 1;
    }
    p
};

// largest multiple of d that is <= 16
#[cfg(target_arch = "wasm32")]
static STEP: [u8; 16] = {
    let mut s = [16u8; 16];
    let mut d = 1;
    while d < 16 {
        s[d] = (16 - 16 % d) as u8;
        d += 1;
    }
    s
};

#[cfg(target_arch = "wasm32")]
#[inline(always)]
pub unsafe fn copy_match(dst: *mut u8, d: usize, len: usize) {
    let src = dst.sub(d);
    if d >= 16 {
        // with d >= 16 every chunk reads bytes that are already final
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
        let v = i8x16_swizzle(v128_load(src as *const v128), v128_load(PAT.get_unchecked(d).as_ptr() as *const v128));
        let step = *STEP.get_unchecked(d) as usize;
        v128_store(dst as *mut v128, v);
        v128_store(dst.add(step) as *mut v128, v);
        if len > 2 * step {
            let mut i = 2 * step;
            loop {
                v128_store(dst.add(i) as *mut v128, v);
                i += step;
                if i >= len {
                    break;
                }
            }
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[inline(always)]
pub unsafe fn copy_match(dst: *mut u8, d: usize, len: usize) {
    for i in 0..len {
        *dst.add(i) = *dst.add(i).sub(d);
    }
}
