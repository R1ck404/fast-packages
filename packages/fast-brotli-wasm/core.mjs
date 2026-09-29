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
                                    
                             
                                                                
                
                           
                                   
                  
                                                                                                         
                                              
                                                          
                                           
                                                 
                                                                
                           
                                  
                                                                                                       
                   
                           
                                  
                                                                             
 
/** brotli-wasm's compress() options */
                          
                   
 
/** what brotli-wasm copies in (passArray8ToWasm0: anything array-like) */
                                      

export const BrotliStreamResultCode = Object.freeze({
  ResultSuccess: 1,
  1: "ResultSuccess",
  NeedsMoreInput: 2,
  2: "NeedsMoreInput",
  NeedsMoreOutput: 3,
  3: "NeedsMoreOutput",
});

export function bind(W                   ) {
  const H = W.hdr() >>> 2;
  const decode = W.decompress_fast || W.decompress;
  let mem                     = null;
  let U8            , U32             ;
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
  function pass(arg       )                   {
    const len = arg.length;
    const p = W.alloc(len * 1);
    views();
    U8.set(arg, p);
    return [p, len];
  }
  // the result in HDR (bytes or message); the wasm side keeps it until release()
  function take()             {
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
  function panic(message        )        {
    if (++panics <= 2) {
      console.error(`panicked at '${message}', src/lib.rs:38:44\n\nStack:\n\n${new Error().stack}\n\n`);
    }
    throw new WebAssembly.RuntimeError("unreachable");
  }

  function quality(raw_options                     )         {
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

  function compress(buf       , raw_options          )             {
    const [p, len] = pass(buf);
    let q        ;
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

  function decompress(buf       )             {
    const [p, len] = pass(buf);
    const st = decode(p, len);
    W.free(p, len);
    const out = take();
    if (st !== 0) throw utf8.decode(out);
    return out;
  }

  const isLikeNone = (x         )                        => x === undefined || x === null;
  const state = new WeakMap                                                  (); // BrotliStreamResult -> [code, buf, input_offset]
  let resultIds = 0;

  class BrotliStreamResult {
                        
    static __wrap(code        , buf            , input_offset        )                     {
      const obj = Object.create(BrotliStreamResult.prototype);
      obj.ptr = ++resultIds;
      state.set(obj, [code, buf, input_offset]);
      return obj;
    }
    __destroy_into_raw()         {
      const ptr = this.ptr;
      this.ptr = 0;
      return ptr;
    }
    free()       {
      this.__destroy_into_raw();
      state.delete(this);
    }
    get code()         {
      return state.get(this)[0] >>> 0;
    }
    set code(arg0        ) {
      // a BrotliStreamResultCode on the Rust side
      const v = arg0 >>> 0;
      if (v !== 1 && v !== 2 && v !== 3) throw new Error("invalid enum value passed");
      state.get(this)[0] = v;
    }
    get buf()             {
      return state.get(this)[1].slice();
    }
    set buf(arg0       ) {
      const a = new Uint8Array(arg0.length * 1);
      a.set(arg0);
      state.get(this)[1] = a;
    }
    get input_offset()         {
      return state.get(this)[2] >>> 0;
    }
    set input_offset(arg0        ) {
      state.get(this)[2] = arg0 >>> 0;
    }
  }

  function streamResult(st        )                     {
    const out = take();
    if (st !== 0) throw new Error(utf8.decode(out));
    return BrotliStreamResult.__wrap(U32[H + 2], out, U32[H + 3]);
  }

  class CompressStream {
    ;                   
    static __wrap(ptr        )                 {
      const obj = Object.create(CompressStream.prototype);
      obj.ptr = ptr;
      return obj;
    }
    __destroy_into_raw() {
      const ptr = this.ptr;
      this.ptr = 0;
      return ptr;
    }
    free()       {
      W.cs_free(this.__destroy_into_raw());
    }
    constructor(quality         ) {
      return CompressStream.__wrap(W.cs_new(!isLikeNone(quality), isLikeNone(quality) ? 0 : quality));
    }
    compress(input_opt                          , output_size        )                     {
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
    ;                   
    static __wrap(ptr        )                   {
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
    decompress(input       , output_size        )                     {
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
function rustFloat(x        )         {
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
// generated from core.mts by tools/ts-build.mjs; edit that file
