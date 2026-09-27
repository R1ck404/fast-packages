// scrypt ROMix (RFC 7914) over salsa20/8. Runs in its own wasm instance per
// scrypt() call: the instance's memory is grown to hold B, V and a temporary
// block and is dropped (with the instance) afterwards, so a large N does not
// leave a large memory behind.

use core::arch::wasm32::*;
use core::ptr::{copy_nonoverlapping, read_unaligned, write_bytes, write_unaligned};

static mut R: usize = 0;
static mut N: usize = 0;
static mut BW: usize = 0; // u32 words per block (32 * r)
static mut P: usize = 0;
static mut B: *mut u32 = core::ptr::null_mut();
static mut V: *mut u32 = core::ptr::null_mut();
static mut T: *mut u32 = core::ptr::null_mut();
static mut TOTAL: usize = 0;

/// Allocates B (p blocks), V (n blocks) and one temporary block; returns the
/// byte address of B, or 0 if the memory cannot be grown.
#[no_mangle]
pub unsafe extern "C" fn scrypt_init(r: u32, n: u32, p: u32) -> u32 {
    let bs = 128u64 * r as u64;
    let base = memory_size(0) as u64 * 65536;
    let need = bs * (p as u64 + n as u64 + 1);
    if base + need > (1u64 << 32) - 65536 {
        return 0;
    }
    let pages = (need + 65535) / 65536;
    if memory_grow(0, pages as usize) == usize::MAX {
        return 0;
    }
    R = r as usize;
    N = n as usize;
    BW = 32 * r as usize;
    P = p as usize;
    B = base as usize as *mut u32;
    V = B.add(BW * p as usize);
    T = V.add(BW * n as usize);
    TOTAL = need as usize;
    base as u32
}

// B, V and the temporary block hold every 64-byte salsa block with its words
// permuted (word i at position i * 5 % 16, as in scrypt's SSE2 code): the
// four vectors are then the diagonals (x0,x5,x10,x15), (x4,x9,x14,x3),
// (x8,x13,x2,x7), (x12,x1,x6,x11), and each salsa20 half-round is four
// vector quarter-rounds. XOR and copies do not care about the order, and
// Integrify (word 0 of the last block) stays at position 0.

#[inline(always)]
fn rotl(v: v128, n: u32) -> v128 {
    v128_or(i32x4_shl(v, n), u32x4_shr(v, 32 - n))
}

#[inline(always)]
fn salsa8(x: &mut [v128; 4]) {
    let [mut x0, mut x1, mut x2, mut x3] = *x;
    for _ in 0..4 {
        // columns
        x1 = v128_xor(x1, rotl(i32x4_add(x0, x3), 7));
        x2 = v128_xor(x2, rotl(i32x4_add(x1, x0), 9));
        x3 = v128_xor(x3, rotl(i32x4_add(x2, x1), 13));
        x0 = v128_xor(x0, rotl(i32x4_add(x3, x2), 18));
        x1 = i32x4_shuffle::<3, 0, 1, 2>(x1, x1);
        x2 = i32x4_shuffle::<2, 3, 0, 1>(x2, x2);
        x3 = i32x4_shuffle::<1, 2, 3, 0>(x3, x3);
        // rows
        x3 = v128_xor(x3, rotl(i32x4_add(x0, x1), 7));
        x2 = v128_xor(x2, rotl(i32x4_add(x3, x0), 9));
        x1 = v128_xor(x1, rotl(i32x4_add(x2, x3), 13));
        x0 = v128_xor(x0, rotl(i32x4_add(x1, x2), 18));
        x1 = i32x4_shuffle::<1, 2, 3, 0>(x1, x1);
        x2 = i32x4_shuffle::<2, 3, 0, 1>(x2, x2);
        x3 = i32x4_shuffle::<3, 0, 1, 2>(x3, x3);
    }
    x[0] = i32x4_add(x[0], x0);
    x[1] = i32x4_add(x[1], x1);
    x[2] = i32x4_add(x[2], x2);
    x[3] = i32x4_add(x[3], x3);
}

#[inline(always)]
unsafe fn load4(p: *const u32) -> [v128; 4] {
    [
        v128_load(p as *const v128),
        v128_load(p.add(4) as *const v128),
        v128_load(p.add(8) as *const v128),
        v128_load(p.add(12) as *const v128),
    ]
}

#[inline(always)]
unsafe fn store4(p: *mut u32, x: &[v128; 4]) {
    v128_store(p as *mut v128, x[0]);
    v128_store(p.add(4) as *mut v128, x[1]);
    v128_store(p.add(8) as *mut v128, x[2]);
    v128_store(p.add(12) as *mut v128, x[3]);
}

/// BlockMix: 2r salsa20/8 calls; even outputs to the first half of `out`,
/// odd ones to the second half. `inp` and `out` must not overlap.
#[inline(always)]
unsafe fn block_mix(inp: *const u32, out: *mut u32, r: usize) {
    let mut x = load4(inp.add((2 * r - 1) * 16));
    for i in 0..2 * r {
        let b = load4(inp.add(i * 16));
        for k in 0..4 {
            x[k] = v128_xor(x[k], b[k]);
        }
        salsa8(&mut x);
        let dst = if i & 1 == 0 { i / 2 } else { r + i / 2 };
        store4(out.add(dst * 16), &x);
    }
}

/// Permutes the words of every 64-byte block of B into the SIMD order
/// (`inverse`: back).
#[no_mangle]
pub unsafe extern "C" fn scrypt_permute(inverse: u32) {
    let n = BW * P / 16;
    for blk in 0..n {
        let p = B.add(blk * 16);
        let w: [u32; 16] = read_unaligned(p as *const [u32; 16]);
        let mut o = [0u32; 16];
        for i in 0..16 {
            if inverse != 0 {
                o[i * 5 % 16] = w[i];
            } else {
                o[i] = w[i * 5 % 16];
            }
        }
        write_unaligned(p as *mut [u32; 16], o);
    }
}

/// Runs steps [s, e) of ROMix on B[pi]. Steps 0..n-1 fill V (step 0 first
/// copies B[pi] to V[0]), step n-1 mixes V[n-1] into B[pi], steps n..2n-1 are
/// the second loop. One step is one BlockMix, the unit of noble's progress
/// callback.
#[no_mangle]
pub unsafe extern "C" fn scrypt_steps(pi: u32, s: u32, e: u32) {
    let (r, n, bw) = (R, N, BW);
    let b = B.add(pi as usize * bw);
    for step in s as usize..e as usize {
        if step < n - 1 {
            if step == 0 {
                copy_nonoverlapping(b, V, bw);
            }
            block_mix(V.add(step * bw), V.add((step + 1) * bw), r);
        } else if step == n - 1 {
            block_mix(V.add(step * bw), b, r);
        } else {
            let j = *b.add(bw - 16) as usize & (n - 1);
            let vj = V.add(j * bw);
            for k in (0..bw).step_by(4) {
                let v = v128_xor(v128_load(b.add(k) as *const v128), v128_load(vj.add(k) as *const v128));
                v128_store(T.add(k) as *mut v128, v);
            }
            block_mix(T, b, r);
        }
    }
}

/// Zeroes everything scrypt_init allocated.
#[no_mangle]
pub unsafe extern "C" fn scrypt_wipe() {
    if !B.is_null() {
        write_bytes(B as *mut u8, 0, TOTAL);
    }
}
