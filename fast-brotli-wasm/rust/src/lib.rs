// fastbrotli: wasm core of fast-brotli-wasm, a drop-in for brotli-wasm 3.0.1.
//
// Same crates as brotli-wasm (brotli 5.0.0, brotli-decompressor 4.0.0, vendored
// with speed-ups that keep the output byte-identical, see vendor/brotli), the
// same calls for every API, and a plain C ABI instead of wasm-bindgen: JS
// passes pointers and reads results from HDR.

use brotli::enc::encode::{
    BrotliEncoderDestroyInstance, BrotliEncoderOperation, BrotliEncoderParameter,
    BrotliEncoderStateStruct,
};
use brotli::enc::StandardAlloc;
use brotli::{BrotliDecompressStream, BrotliResult, BrotliState};
use serde::Deserialize;

// fast one-shot decoder (see dec_api.rs)
#[cfg(feature = "fastdec")]
mod dec_api;

static mut OUT: Vec<u8> = Vec::new();

/// Results: [0] data pointer, [1] data length (the output, or a UTF-8 error
/// message), [2] quality / stream result code, [3] stream input offset.
pub(crate) static mut HDR: [u32; 8] = [0; 8];

#[no_mangle]
pub extern "C" fn hdr() -> *const u32 {
    #[allow(unused_unsafe)]
    unsafe {
        core::ptr::addr_of!(HDR) as *const u32
    }
}

#[no_mangle]
pub extern "C" fn alloc(n: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

#[no_mangle]
pub unsafe extern "C" fn free(p: *mut u8, n: usize) {
    drop(Vec::from_raw_parts(p, 0, n.max(1)));
}

#[allow(static_mut_refs)]
pub(crate) unsafe fn finish(out: Vec<u8>) {
    OUT = out;
    HDR[0] = OUT.as_ptr() as u32;
    HDR[1] = OUT.len() as u32;
}

#[no_mangle]
#[allow(static_mut_refs)]
pub unsafe extern "C" fn release() {
    OUT = Vec::new();
}

// ------------------------------------------------------------------ options

#[derive(Deserialize)]
struct Options {
    #[serde(default = "default_quality")]
    quality: i32,
}

fn default_quality() -> i32 {
    11
}

/// brotli-wasm reads `compress` options as `serde_json::from_str(JSON.stringify(options)).unwrap()`.
/// 0: quality in HDR[2]; 1: that unwrap panics, the panic message is the result.
#[no_mangle]
pub unsafe extern "C" fn parse_options(p: *const u8, n: usize) -> i32 {
    let json = core::str::from_utf8_unchecked(core::slice::from_raw_parts(p, n));
    match serde_json::from_str::<Options>(json) {
        Ok(o) => {
            HDR[2] = o.quality as u32;
            0
        }
        Err(e) => {
            finish(format!("called `Result::unwrap()` on an `Err` value: {:?}", e).into_bytes());
            1
        }
    }
}

// ------------------------------------------------------------------ one-shot

#[no_mangle]
#[allow(static_mut_refs)]
pub unsafe extern "C" fn compress(p: *const u8, n: usize, quality: i32) -> i32 {
    let input = core::slice::from_raw_parts(p, n);
    let mut out = Vec::<u8>::new();
    let mut params = brotli::enc::BrotliEncoderParams::default();
    params.quality = quality;
    // the whole input is known: lets the q10/q11 hasher size itself to it
    brotli::enc::hash_to_binary_tree::FAST_INPUT_SIZE_HINT = n.max(1);
    let r = brotli::BrotliCompress(&mut &input[..], &mut out, &params);
    brotli::enc::hash_to_binary_tree::FAST_INPUT_SIZE_HINT = 0;
    match r {
        Ok(_) => {
            finish(out);
            0
        }
        Err(e) => {
            finish(format!("Brotli compress failed: {:?}", e).into_bytes());
            1
        }
    }
}

/// The original decoder path (brotli-decompressor), as in brotli-wasm.
#[no_mangle]
#[allow(static_mut_refs)]
pub unsafe extern "C" fn decompress(p: *const u8, n: usize) -> i32 {
    let input = core::slice::from_raw_parts(p, n);
    let mut out = Vec::<u8>::new();
    match brotli::BrotliDecompress(&mut &input[..], &mut out) {
        Ok(_) => {
            finish(out);
            0
        }
        Err(e) => {
            finish(format!("Brotli decompress failed: {:?}", e).into_bytes());
            1
        }
    }
}

// ------------------------------------------------------------------ streams
// Same code as brotli-wasm's src/stream.rs; results go to HDR/OUT.

const RESULT_SUCCESS: u32 = 1;
const NEEDS_MORE_INPUT: u32 = 2;
const NEEDS_MORE_OUTPUT: u32 = 3;

unsafe fn stream_result(code: u32, buf: Vec<u8>, input_offset: usize) -> i32 {
    finish(buf);
    HDR[2] = code;
    HDR[3] = input_offset as u32;
    0
}

unsafe fn stream_error(msg: &str) -> i32 {
    finish(msg.as_bytes().to_vec());
    1
}

pub struct CompressStream {
    state: BrotliEncoderStateStruct<StandardAlloc>,
    total_out: usize,
}

impl Drop for CompressStream {
    fn drop(&mut self) {
        BrotliEncoderDestroyInstance(&mut self.state);
    }
}

#[no_mangle]
pub extern "C" fn cs_new(has_quality: u32, quality: u32) -> *mut CompressStream {
    let alloc = StandardAlloc::default();
    let mut state = BrotliEncoderStateStruct::new(alloc);
    if has_quality != 0 {
        state.set_parameter(BrotliEncoderParameter::BROTLI_PARAM_QUALITY, quality);
    }
    Box::into_raw(Box::new(CompressStream { state, total_out: 0 }))
}

#[no_mangle]
pub unsafe extern "C" fn cs_free(s: *mut CompressStream) {
    drop(Box::from_raw(s));
}

#[no_mangle]
pub unsafe extern "C" fn cs_total_out(s: *mut CompressStream) -> usize {
    (*s).total_out
}

#[no_mangle]
pub unsafe extern "C" fn cs_compress(
    s: *mut CompressStream,
    has_input: u32,
    in_ptr: *const u8,
    in_len: usize,
    output_size: usize,
) -> i32 {
    let this = &mut *s;
    let mut nop_callback = |_data: &mut brotli::interface::PredictionModeContextMap<
        brotli::interface::InputReferenceMut,
    >,
                            _cmds: &mut [brotli::interface::StaticCommand],
                            _mb: brotli::interface::InputPair,
                            _mfv: &mut StandardAlloc| ();
    let mut output = vec![0; output_size];
    let mut input_offset = 0;
    let mut available_out = output_size;
    let mut output_offset = 0;
    if has_input != 0 {
        let input = core::slice::from_raw_parts(in_ptr, in_len);
        let op = BrotliEncoderOperation::BROTLI_OPERATION_PROCESS;
        let mut available_in = input.len();
        if this.state.compress_stream(
            op,
            &mut available_in,
            input,
            &mut input_offset,
            &mut available_out,
            &mut output,
            &mut output_offset,
            &mut Some(this.total_out),
            &mut nop_callback,
        ) {
            if available_in == 0 {
                output.truncate(output_offset);
                stream_result(NEEDS_MORE_INPUT, output, input_offset)
            } else if available_out == 0 {
                stream_result(NEEDS_MORE_OUTPUT, output, input_offset)
            } else {
                stream_error("Unexpected Brotli streaming compress: both available_in & available_out are not 0 after a successful processing")
            }
        } else {
            stream_error("Brotli streaming compress failed: When processing")
        }
    } else {
        let op = BrotliEncoderOperation::BROTLI_OPERATION_FINISH;
        let input = Vec::new().into_boxed_slice();
        let mut available_in = 0;
        while !this.state.is_finished() && available_out > 0 {
            if !this.state.compress_stream(
                op,
                &mut available_in,
                &input,
                &mut input_offset,
                &mut available_out,
                &mut output,
                &mut output_offset,
                &mut Some(this.total_out),
                &mut nop_callback,
            ) {
                return stream_error("Brotli streaming compress failed: When finishing");
            }
        }
        if available_out == 0 {
            stream_result(NEEDS_MORE_OUTPUT, output, input_offset)
        } else {
            output.truncate(output_offset);
            stream_result(RESULT_SUCCESS, output, input_offset)
        }
    }
}

pub struct DecompressStream {
    state: BrotliState<StandardAlloc, StandardAlloc, StandardAlloc>,
    total_out: usize,
}

#[no_mangle]
pub extern "C" fn ds_new() -> *mut DecompressStream {
    let alloc = StandardAlloc::default();
    Box::into_raw(Box::new(DecompressStream {
        state: BrotliState::new(alloc, alloc, alloc),
        total_out: 0,
    }))
}

#[no_mangle]
pub unsafe extern "C" fn ds_free(s: *mut DecompressStream) {
    drop(Box::from_raw(s));
}

#[no_mangle]
pub unsafe extern "C" fn ds_total_out(s: *mut DecompressStream) -> usize {
    (*s).total_out
}

#[no_mangle]
pub unsafe extern "C" fn ds_decompress(
    s: *mut DecompressStream,
    in_ptr: *const u8,
    in_len: usize,
    output_size: usize,
) -> i32 {
    let this = &mut *s;
    let input = core::slice::from_raw_parts(in_ptr, in_len);
    let mut output = vec![0; output_size];
    let mut available_in = input.len();
    let mut input_offset = 0;
    let mut available_out = output_size;
    let mut output_offset = 0;
    match BrotliDecompressStream(
        &mut available_in,
        &mut input_offset,
        input,
        &mut available_out,
        &mut output_offset,
        &mut output,
        &mut this.total_out,
        &mut this.state,
    ) {
        BrotliResult::ResultFailure => {
            let err_code = this.state.error_code as i32;
            stream_error(&format!("Brotli streaming decompress failed: Error code {}", err_code))
        }
        BrotliResult::NeedsMoreOutput => stream_result(NEEDS_MORE_OUTPUT, output, input_offset),
        BrotliResult::ResultSuccess => {
            output.truncate(output_offset);
            stream_result(RESULT_SUCCESS, output, input_offset)
        }
        BrotliResult::NeedsMoreInput => {
            output.truncate(output_offset);
            stream_result(NEEDS_MORE_INPUT, output, input_offset)
        }
    }
}

/// Benchmark helper (feature "bench"): H10 match finding over the input.
#[cfg(feature = "bench")]
#[no_mangle]
pub unsafe extern "C" fn bench_find_matches(p: *const u8, n: usize) -> u64 {
    brotli::enc::backward_references::hq::FastBenchFindAllMatches(core::slice::from_raw_parts(p, n))
}
