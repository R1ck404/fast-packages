// Fast one-shot brotli decompression (exports for the JS glue).
//
// `decompress_fast(ptr, len)` must return exactly what `decompress` (the
// original brotli-decompressor path in lib.rs) returns: same bytes on success;
// on any failure it falls back to that path so error messages are identical.

#[path = "fastdec/mod.rs"]
mod fastdec;

// Wrapper-only entry point: p has n input bytes followed by eight zeros.
// Keep the existing exports accepting ordinary, unpadded input.
#[no_mangle]
pub unsafe extern "C" fn decompress_fast_padded(p: *const u8, n: usize) -> i32 {
    match fastdec::decode_padded(core::slice::from_raw_parts(p, n)) {
        Some(out) => { crate::finish(out); 0 }
        None => crate::decompress(p, n),
    }
}

#[no_mangle]
pub unsafe extern "C" fn decompress_fast(p: *const u8, n: usize) -> i32 {
    let input = core::slice::from_raw_parts(p, n);
    match fastdec::decode(input) {
        Some(out) => {
            crate::finish(out);
            0
        }
        // errors and rare stream features: the reference decoder decides
        None => crate::decompress(p, n),
    }
}

// Fast path only (tests/benchmarks): 0 = decoded (result as usual), -1 = the
// input would be handed to the reference decoder.
#[no_mangle]
pub unsafe extern "C" fn decompress_fast_only(p: *const u8, n: usize) -> i32 {
    match fastdec::decode(core::slice::from_raw_parts(p, n)) {
        Some(out) => {
            crate::finish(out);
            0
        }
        None => {
            crate::finish(Vec::new());
            -1
        }
    }
}
