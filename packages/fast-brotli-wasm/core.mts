// JS side of @r1ck404/fast-brotli-wasm: the brotli-wasm 3.0.1 API (compress,
// decompress, CompressStream, DecompressStream, BrotliStreamResult,
// BrotliStreamResultCode) over the plain C ABI of fastbrotli.wasm.
//
// Behaviour follows brotli-wasm's wasm-bindgen glue exactly: inputs are copied
// the way passArray8ToWasm0 copies them (so array-likes convert the same way),
// compress/decompress failures throw strings, stream failures throw Errors,
// compress options go through JSON.stringify and serde_json's parsing
// (rust/options; bad options panic: console.error + RuntimeError
// "unreachable", like console_error_panic_hook), results are fresh
// Uint8Arrays, and wrapper objects only own a `ptr`.

/** exports of rust/src (pointers and sizes are byte offsets / counts) */
export interface FastBrotliExports {
  memory: WebAssembly.Memory;
  /** the result header: [ptr, len, code, input_offset] (u32) */
  hdr(): number;
  alloc(n: number): number;
  free(p: number, n: number): void;
  release(): void;
  /** 0: quality in HDR[2]; 1: panic message in HDR; 2: the same, with a float (HDR[4..6]) for the NUL */
  parse_options(p: number, n: number): number;
  compress(p: number, n: number, quality: number): number;
  decompress(p: number, n: number): number;
  decompress_fast?(p: number, n: number): number;
  cs_new(hasQuality: number | boolean, quality: number): number;
  cs_free(s: number): void;
  cs_total_out(s: number): number;
  cs_compress(s: number, hasInput: number | boolean, p: number, n: number, outputSize: number): number;
  ds_new(): number;
  ds_free(s: number): void;
  ds_total_out(s: number): number;
  ds_decompress(s: number, p: number, n: number, outputSize: number): number;
}
/** brotli-wasm's compress() options */
export interface Options {
  quality?: number;
}
/** what brotli-wasm copies in (passArray8ToWasm0: anything array-like) */
export type Input = ArrayLike<number>;

export const BrotliStreamResultCode = Object.freeze({
  ResultSuccess: 1,
  1: "ResultSuccess",
  NeedsMoreInput: 2,
  2: "NeedsMoreInput",
  NeedsMoreOutput: 3,
  3: "NeedsMoreOutput",
});

// The optional padded entry point reads eight zero bytes after the input.
export function bind(W: FastBrotliExports & { decompress_fast_padded?: (p: number, n: number) => number }) {
  const H = W.hdr() >>> 2;
  const decode = W.decompress_fast || W.decompress;
  const paddedDecode = W.decompress_fast_padded;
  let mem: ArrayBuffer | null = null;
  let U8: Uint8Array, U32: Uint32Array;
  const views = () => {
    if (W.memory.buffer !== mem) {
      mem = W.memory.buffer;
      U8 = new Uint8Array(mem);
      U32 = new Uint32Array(mem);
    }
  };
  const utf8 = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
  const encoder = new TextEncoder();

  // passArray8ToWasm0
  function pass(arg: Input, padding = 0): [number, number, number?] {
    const len = arg.length;
    // Small inputs don't consistently repay the extra wrapper work. Preserve the old
    // coercion/allocation path for exotic array-like lengths too.
    if (padding && (!Number.isInteger(len) || len < 262144 || len > 0xfffffff7)) padding = 0;
    const p = W.alloc(len * 1 + padding);
    views();
    U8.set(arg, p);
    if (padding) U8.fill(0, p + len * 1, p + len * 1 + padding);
    return padding ? [p, len, padding] : [p, len];
  }
  // the result in HDR (bytes or message); the wasm side keeps it until release()
  function take(): Uint8Array {
    views();
    const p = U32[H];
    const out = U8.slice(p, p + U32[H + 1]);
    W.release();
    return out;
  }

  // A panic that traps never finishes, so Rust's panic count keeps growing:
  // in brotli-wasm only the first two panics reach console_error_panic_hook,
  // later ones abort without calling it.
  let panics = 0;
  function panic(message: string): never {
    if (++panics <= 2) {
      console.error(`panicked at '${message}', src/lib.rs:38:44\n\nStack:\n\n${new Error().stack}\n\n`);
    }
    throw new WebAssembly.RuntimeError("unreachable");
  }

  function quality(raw_options: Options | undefined): number {
    if (raw_options === undefined) return 11;
    if (!(typeof raw_options === "object" && raw_options !== null)) throw "Options is not an object";
    const json = JSON.stringify(raw_options);
    json.length; // (a toJSON returning undefined fails here, as in wasm-bindgen)
    const [p, n] = pass(encoder.encode(json));
    const st = W.parse_options(p, n);
    W.free(p, n);
    if (st) {
      // (2: a float goes where the message has a NUL; wasm leaves its Display to JS)
      const message = utf8.decode(take());
      panic(st === 2 ? message.replace("\0", rustFloat(new Float64Array(U32.slice(H + 4, H + 6).buffer)[0])) : message);
    }
    return U32[H + 2] | 0;
  }

  function compress(buf: Input, raw_options?: Options): Uint8Array {
    const [p, len] = pass(buf);
    let q: number;
    try {
      q = quality(raw_options);
    } catch (e) {
      W.free(p, len);
      throw e;
    }
    const st = W.compress(p, len, q);
    W.free(p, len);
    const out = take();
    if (st !== 0) throw utf8.decode(out);
    return out;
  }

  function decompress(buf: Input): Uint8Array {
    const [p, len, padded] = pass(buf, paddedDecode ? 8 : 0);
    const padding = padded || 0;
    const st = padding ? paddedDecode!(p, len) : decode(p, len);
    W.free(p, len * 1 + padding);
    const out = take();
    if (st !== 0) throw utf8.decode(out);
    return out;
  }

  const isLikeNone = (x: unknown): x is null | undefined => x === undefined || x === null;
  const state = new WeakMap<BrotliStreamResult, [number, Uint8Array, number]>(); // BrotliStreamResult -> [code, buf, input_offset]
  let resultIds = 0;

  class BrotliStreamResult {
    declare ptr: number;
    static __wrap(code: number, buf: Uint8Array, input_offset: number): BrotliStreamResult {
      const obj = Object.create(BrotliStreamResult.prototype);
      obj.ptr = ++resultIds;
      state.set(obj, [code, buf, input_offset]);
      return obj;
    }
    __destroy_into_raw(): number {
      const ptr = this.ptr;
      this.ptr = 0;
      return ptr;
    }
    free(): void {
      this.__destroy_into_raw();
      state.delete(this);
    }
    get code(): number {
      return state.get(this)[0] >>> 0;
    }
    set code(arg0: number) {
      // a BrotliStreamResultCode on the Rust side
      const v = arg0 >>> 0;
      if (v !== 1 && v !== 2 && v !== 3) throw new Error("invalid enum value passed");
      state.get(this)[0] = v;
    }
    get buf(): Uint8Array {
      return state.get(this)[1].slice();
    }
    set buf(arg0: Input) {
      const a = new Uint8Array(arg0.length * 1);
      a.set(arg0);
      state.get(this)[1] = a;
    }
    get input_offset(): number {
      return state.get(this)[2] >>> 0;
    }
    set input_offset(arg0: number) {
      state.get(this)[2] = arg0 >>> 0;
    }
  }

  function streamResult(st: number): BrotliStreamResult {
    const out = take();
    if (st !== 0) throw new Error(utf8.decode(out));
    return BrotliStreamResult.__wrap(U32[H + 2], out, U32[H + 3]);
  }

  class CompressStream {
    declare ptr: number;
    static __wrap(ptr: number): CompressStream {
      const obj = Object.create(CompressStream.prototype);
      obj.ptr = ptr;
      return obj;
    }
    __destroy_into_raw() {
      const ptr = this.ptr;
      this.ptr = 0;
      return ptr;
    }
    free(): void {
      W.cs_free(this.__destroy_into_raw());
    }
    constructor(quality?: number) {
      return CompressStream.__wrap(W.cs_new(!isLikeNone(quality), isLikeNone(quality) ? 0 : quality));
    }
    compress(input_opt: Input | null | undefined, output_size: number): BrotliStreamResult {
      let p = 0, len = 0;
      const has = !isLikeNone(input_opt);
      if (has) [p, len] = pass(input_opt);
      const st = W.cs_compress(this.ptr, has, p, len, output_size);
      if (has) W.free(p, len);
      return streamResult(st);
    }
    total_out() {
      return W.cs_total_out(this.ptr) >>> 0;
    }
  }

  class DecompressStream {
    declare ptr: number;
    static __wrap(ptr: number): DecompressStream {
      const obj = Object.create(DecompressStream.prototype);
      obj.ptr = ptr;
      return obj;
    }
    __destroy_into_raw() {
      const ptr = this.ptr;
      this.ptr = 0;
      return ptr;
    }
    free() {
      W.ds_free(this.__destroy_into_raw());
    }
    constructor() {
      return DecompressStream.__wrap(W.ds_new());
    }
    decompress(input: Input, output_size: number): BrotliStreamResult {
      const [p, len] = pass(input);
      const st = W.ds_decompress(this.ptr, p, len, output_size);
      W.free(p, len);
      return streamResult(st);
    }
    total_out() {
      return W.ds_total_out(this.ptr) >>> 0;
    }
  }

  return { compress, decompress, BrotliStreamResult, BrotliStreamResultCode, CompressStream, DecompressStream };
}

/** f64 as Rust's Display prints it: the shortest digits that round-trip, never an exponent */
function rustFloat(x: number): string {
  const sign = x < 0 || Object.is(x, -0) ? "-" : "";
  x = Math.abs(x);
  const s = String(x), e = s.indexOf("e"), mant = e < 0 ? s : s.slice(0, e), dot = mant.indexOf(".");
  // x ~ digits * 10^exp
  let digits = mant.replace(".", "").replace(/^0+(?=.)/, "");
  let exp = (e < 0 ? 0 : +s.slice(e + 1)) - (dot < 0 ? 0 : mant.length - dot - 1);
  while (digits.length > 1 && digits.endsWith("0")) (digits = digits.slice(0, -1)), exp++;
  // Of two shortest candidates equally close to x, JS takes the even one and
  // Rust the larger one: x exactly halfway to the next candidate?
  const bits = new BigUint64Array(new Float64Array([x]).buffer)[0];
  const biased = Number(bits >> 52n), sig = bits & 0xfffffffffffffn;
  const m = biased ? sig | (1n << 52n) : sig, q = biased ? biased - 1075 : -1074; // x = m * 2^q
  let lhs = 2n * m, rhs = 2n * BigInt(digits) + 1n; // 2x = (2 * digits + 1) * 10^exp ?
  if (q > 0) lhs <<= BigInt(q);
  else rhs <<= BigInt(-q);
  if (exp > 0) rhs *= 10n ** BigInt(exp);
  else lhs *= 10n ** BigInt(-exp);
  if (lhs === rhs) {
    const up = String(BigInt(digits) + 1n);
    if (+`${up}e${exp}` === x) digits = up;
  }
  const p = digits.length + exp; // position of the point
  return sign + (p <= 0 ? "0." + "0".repeat(-p) + digits : p >= digits.length ? digits + "0".repeat(p - digits.length) : digits.slice(0, p) + "." + digits.slice(p));
}
