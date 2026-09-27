// wasm core of @r1ck404/fast-noble-hashes: the Merkle-Damgard block
// functions of SHA-256, SHA-512, SHA-1 and MD5, their padding/finalisation,
// the PBKDF2-HMAC iteration loop and scrypt's ROMix. The JS side keeps all
// hash state in noble's own objects and moves it in and out of `M.st` around
// each call.
#![no_std]

use core::arch::wasm32::*;
use core::ptr::{addr_of_mut, copy_nonoverlapping, write_bytes, write_unaligned};

mod md5;
mod scrypt;
mod sha1;
mod sha256;
mod sha512;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

pub trait Md {
    type S: Copy;
    /// block length in bytes
    const BL: usize;
    /// bytes of length field noble reserves (its `padOffset`)
    const PAD: usize;
    /// little-endian words and length (MD5)
    const LE: bool;
    unsafe fn load(p: *const u8) -> Self::S;
    unsafe fn store(p: *mut u8, s: &Self::S);
    unsafe fn blocks(s: &mut Self::S, p: *const u8, n: usize);
    #[inline(always)]
    unsafe fn block(s: &mut Self::S, p: *const u8) {
        Self::blocks(s, p, 1)
    }
    /// the full state as digest bytes (the JS side truncates to outputLen)
    unsafe fn encode(s: &Self::S, out: *mut u8);
}

#[inline(always)]
pub unsafe fn load_be32x16(p: *const u8) -> [u32; 16] {
    let mut w = [0u32; 16];
    for k in 0..4 {
        let v = v128_load(p.add(k * 16) as *const v128);
        let v = i8x16_shuffle::<3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12>(v, v);
        w[k * 4] = u32x4_extract_lane::<0>(v);
        w[k * 4 + 1] = u32x4_extract_lane::<1>(v);
        w[k * 4 + 2] = u32x4_extract_lane::<2>(v);
        w[k * 4 + 3] = u32x4_extract_lane::<3>(v);
    }
    w
}

#[inline(always)]
pub unsafe fn load_be64x16(p: *const u8) -> [u64; 16] {
    let mut w = [0u64; 16];
    for k in 0..8 {
        let v = v128_load(p.add(k * 16) as *const v128);
        let v = i8x16_shuffle::<7, 6, 5, 4, 3, 2, 1, 0, 15, 14, 13, 12, 11, 10, 9, 8>(v, v);
        w[k * 2] = u64x2_extract_lane::<0>(v);
        w[k * 2 + 1] = u64x2_extract_lane::<1>(v);
    }
    w
}

pub const IO_CAP: usize = 1 << 16;

#[repr(C, align(16))]
pub struct Mem {
    io: [u8; IO_CAP],
    fin: [u8; 128],
    fin2: [u8; 128],
    out: [u8; 64],
    st: [u8; 64],
    st2: [u8; 64],
    u: [u8; 64],
    t: [u8; 64],
}

static mut M: Mem = Mem {
    io: [0; IO_CAP],
    fin: [0; 128],
    fin2: [0; 128],
    out: [0; 64],
    st: [0; 64],
    st2: [0; 64],
    u: [0; 64],
    t: [0; 64],
};

#[inline(always)]
fn m() -> *mut Mem {
    addr_of_mut!(M)
}

/// Byte offsets of the buffers: 0 io, 1 fin, 2 out, 3 st, 4 st2, 5 u, 6 t;
/// 7 is the size of io.
#[no_mangle]
pub unsafe extern "C" fn offset(i: u32) -> u32 {
    let mm = m();
    match i {
        0 => addr_of_mut!((*mm).io) as u32,
        1 => addr_of_mut!((*mm).fin) as u32,
        2 => addr_of_mut!((*mm).out) as u32,
        3 => addr_of_mut!((*mm).st) as u32,
        4 => addr_of_mut!((*mm).st2) as u32,
        5 => addr_of_mut!((*mm).u) as u32,
        6 => addr_of_mut!((*mm).t) as u32,
        _ => IO_CAP as u32,
    }
}

#[inline(always)]
unsafe fn run_blocks<H: Md>(s: &mut H::S, p: *const u8, n: usize) {
    if n > 0 {
        H::blocks(s, p, n);
    }
}

unsafe fn blocks_impl<H: Md>(n: usize) {
    let mm = m();
    let io = addr_of_mut!((*mm).io) as *mut u8;
    let st = addr_of_mut!((*mm).st) as *mut u8;
    let mut s = H::load(st);
    run_blocks::<H>(&mut s, io, n);
    H::store(st, &s);
    write_bytes(io, 0, n * H::BL);
}

/// Pads the block in `fin` whose first `tail` bytes are message bytes and
/// compresses it (twice if the length field does not fit), exactly as
/// noble's HashMD.digestInto does with its buffer. `fin` is left holding the
/// last block processed.
#[inline(always)]
unsafe fn pad_final<H: Md>(s: &mut H::S, fin: *mut u8, tail: usize, bits_lo: u32, bits_hi: u32) {
    *fin.add(tail) = 0x80;
    write_bytes(fin.add(tail + 1), 0, H::BL - tail - 1);
    if H::PAD > H::BL - (tail + 1) {
        H::block(s, fin);
        write_bytes(fin, 0, H::BL);
    }
    if H::LE {
        write_unaligned(fin.add(H::BL - 8) as *mut u32, bits_lo.to_le());
        write_unaligned(fin.add(H::BL - 4) as *mut u32, bits_hi.to_le());
    } else {
        write_unaligned(fin.add(H::BL - 8) as *mut u32, bits_hi.to_be());
        write_unaligned(fin.add(H::BL - 4) as *mut u32, bits_lo.to_be());
    }
    H::block(s, fin);
}

/// Hashes the `n` bytes in io onto the state and finalises: whole blocks
/// first, then the padded tail in `fin`. Digest bytes go to `out`.
unsafe fn finish_impl<H: Md>(n: usize, bits_lo: u32, bits_hi: u32) {
    let mm = m();
    let io = addr_of_mut!((*mm).io) as *mut u8;
    let fin = addr_of_mut!((*mm).fin) as *mut u8;
    let st = addr_of_mut!((*mm).st) as *mut u8;
    let mut s = H::load(st);
    let full = n / H::BL;
    run_blocks::<H>(&mut s, io, full);
    let tail = n - full * H::BL;
    copy_nonoverlapping(io.add(full * H::BL), fin, tail);
    pad_final::<H>(&mut s, fin, tail, bits_lo, bits_hi);
    H::store(st, &s);
    H::encode(&s, addr_of_mut!((*mm).out) as *mut u8);
    // (at least a block: callers may copy a whole buffer and pass a shorter n)
    write_bytes(io, 0, core::cmp::max(n, H::BL));
}

/// PBKDF2 iterations 2..c: `st`/`st2` hold the HMAC inner/outer states after
/// their key block, `u` holds U1 and `t` the running XOR (outlen bytes).
unsafe fn pbkdf2_impl<H: Md>(outlen: usize, iters: u32) {
    let mm = m();
    let fin = addr_of_mut!((*mm).fin) as *mut u8;
    let fin2 = addr_of_mut!((*mm).fin2) as *mut u8;
    let u = addr_of_mut!((*mm).u) as *mut u8;
    let t = addr_of_mut!((*mm).t) as *mut u8;
    let is = H::load(addr_of_mut!((*mm).st) as *const u8);
    let os = H::load(addr_of_mut!((*mm).st2) as *const u8);
    let bits = ((H::BL + outlen) * 8) as u32;
    // both blocks: outlen message bytes, then padding and the length of
    // (key block + outlen)
    for f in [fin, fin2] {
        write_bytes(f, 0, H::BL);
        *f.add(outlen) = 0x80;
        if H::LE {
            write_unaligned(f.add(H::BL - 8) as *mut u32, bits.to_le());
        } else {
            write_unaligned(f.add(H::BL - 4) as *mut u32, bits.to_be());
        }
    }
    copy_nonoverlapping(u, fin, outlen);
    let mut tmp = [0u8; 64];
    let mut acc = [0u8; 64];
    copy_nonoverlapping(t, acc.as_mut_ptr(), outlen);
    for _ in 0..iters {
        let mut s = is;
        H::block(&mut s, fin);
        H::encode(&s, tmp.as_mut_ptr());
        copy_nonoverlapping(tmp.as_ptr(), fin2, outlen);
        let mut s = os;
        H::block(&mut s, fin2);
        H::encode(&s, tmp.as_mut_ptr());
        copy_nonoverlapping(tmp.as_ptr(), fin, outlen);
        for i in 0..outlen {
            acc[i] ^= tmp[i];
        }
    }
    copy_nonoverlapping(fin, u, outlen);
    copy_nonoverlapping(acc.as_ptr(), t, outlen);
    write_bytes(fin, 0, H::BL);
    write_bytes(fin2, 0, H::BL);
    write_bytes(tmp.as_mut_ptr(), 0, 64);
    write_bytes(acc.as_mut_ptr(), 0, 64);
}

// alg ids (shared with the JS side)
const SHA256: u32 = 0;
const SHA512: u32 = 1;
const SHA1: u32 = 2;
const MD5: u32 = 3;

/// Hashes `n` whole blocks from io onto the state in `st`.
#[no_mangle]
pub unsafe extern "C" fn blocks(alg: u32, n: u32) {
    match alg {
        SHA256 => blocks_impl::<sha256::Sha256>(n as usize),
        SHA512 => blocks_impl::<sha512::Sha512>(n as usize),
        SHA1 => blocks_impl::<sha1::Sha1>(n as usize),
        MD5 => blocks_impl::<md5::Md5>(n as usize),
        _ => {}
    }
}

/// Hashes `n` bytes from io onto the state in `st` and finalises with a
/// message length of (bits_hi:bits_lo) bits.
#[no_mangle]
pub unsafe extern "C" fn finish(alg: u32, n: u32, bits_lo: u32, bits_hi: u32) {
    match alg {
        SHA256 => finish_impl::<sha256::Sha256>(n as usize, bits_lo, bits_hi),
        SHA512 => finish_impl::<sha512::Sha512>(n as usize, bits_lo, bits_hi),
        SHA1 => finish_impl::<sha1::Sha1>(n as usize, bits_lo, bits_hi),
        MD5 => finish_impl::<md5::Md5>(n as usize, bits_lo, bits_hi),
        _ => {}
    }
}

#[no_mangle]
pub unsafe extern "C" fn pbkdf2(alg: u32, outlen: u32, iters: u32) {
    match alg {
        SHA256 => pbkdf2_impl::<sha256::Sha256>(outlen as usize, iters),
        SHA512 => pbkdf2_impl::<sha512::Sha512>(outlen as usize, iters),
        SHA1 => pbkdf2_impl::<sha1::Sha1>(outlen as usize, iters),
        MD5 => pbkdf2_impl::<md5::Md5>(outlen as usize, iters),
        _ => {}
    }
}

/// Zeroes the fixed buffers (not io, which blocks/finish clear as they go).
#[no_mangle]
pub unsafe extern "C" fn wipe() {
    let mm = m();
    write_bytes(addr_of_mut!((*mm).fin) as *mut u8, 0, 128 + 128 + 64 * 5);
}
