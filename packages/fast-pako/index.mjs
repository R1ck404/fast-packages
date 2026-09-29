// @r1ck404/fast-pako: drop-in replacement for pako 2.1.0 (same API, same bytes,
// same errors). pako's zlib runs as a Rust→wasm port (rust/); this module is
// pako's JS layer (lib/deflate.js, lib/inflate.js) around it: options,
// input conversion, chunks, onData/onEnd, strings, errors. It also does what
// pako's zlib code does with JavaScript values: the option coercions of
// deflateInit2/inflateReset2 (a level of "5", a windowBits of 9.5, a memLevel
// of "8", ...), reading input elements that are not bytes, and the
// exceptions pako's own code throws, which are produced here by the same
// expressions so that they carry the same messages.
//
// Nothing happens at import: the wasm is decoded and compiled on first use.

import { boot, packed, size } from "./fastzlib.wasm.mjs";

/** pako's options (both directions) */
                          
                 
                  
                      
                    
                    
                     
                                                 
                             
                
                 
                     
 
                             
                 
                
              
                            
                
                   
                 
 
/** what pako accepts as input */
                                                     

/** exports of rust/src/lib.rs (pointers and sizes are byte offsets / counts) */
                     
                             
                                      
                   
                                                                                                                                                                     
                                          
                                                                                    
                                                                         
                                                                                        
                           
                                                      
                                          
                               
                                                                                 
                                          
                                                                                   
                                                                                          
                                
                           
                                          
                               
 
/** js_emit(kind, ptr, len, chunkSize): kind 0 = full chunk, 1 = partial, 2 = string */
                                                                                       

// pako's lib/zlib/constants.js
export const constants = {
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_TREES: 6,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  Z_BINARY: 0,
  Z_TEXT: 1,
  Z_UNKNOWN: 2,
  Z_DEFLATED: 8,
};

// pako's lib/zlib/messages.js
const msg                                  = {
  2: "need dictionary",
  1: "stream end",
  0: "",
  "-1": "file error",
  "-2": "stream error",
  "-3": "data error",
  "-4": "insufficient memory",
  "-5": "buffer error",
  "-6": "incompatible version",
};

// strm.msg of inflate, by the id rust/src/inflate.rs reports
const INF_MSG = [
  "",
  "incorrect header check",
  "unknown compression method",
  "invalid window size",
  "unknown header flags set",
  "header crc mismatch",
  "invalid block type",
  "invalid stored block lengths",
  "too many length or distance symbols",
  "invalid code lengths set",
  "invalid bit length repeat",
  "invalid code -- missing end-of-block",
  "invalid literal/lengths set",
  "invalid distances set",
  "invalid literal/length code",
  "invalid distance code",
  "invalid distance too far back",
  "incorrect data check",
  "incorrect length check",
];

const Z_NO_FLUSH = 0, Z_FINISH = 4, Z_OK = 0;

const toStr = Object.prototype.toString;
const isAB = (x         )                   => toStr.call(x) === "[object ArrayBuffer]";
const hasOwn = Object.prototype.hasOwnProperty;
// the [Symbol.toStringTag] of a typed array ("Uint8Array", ...), else undefined
const taTag = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag).get;
const tagOf = (x         )                     => taTag.call(x);
const isBytes = (t                    )          => t === "Uint8Array" || t === "Uint8ClampedArray";

// pako's utils.assign
                                                                             
function assign(obj      /*, ...sources */) {
  for (let i = 1; i < arguments.length; i++) {
    const source = arguments[i];
    if (!source) continue;
    if (typeof source !== "object") throw new TypeError(source + "must be non-object");
    for (const p in source) if (hasOwn.call(source, p)) obj[p] = source[p];
  }
  return obj;
}

function flattenChunks(chunks              )             {
  let len = 0;
  for (let i = 0, l = chunks.length; i < l; i++) len += chunks[i].length;
  const result = new Uint8Array(len);
  for (let i = 0, pos = 0, l = chunks.length; i < l; i++) {
    const chunk = chunks[i];
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

let encoder                     = null, decoder                     = null;
const string2buf = (s        )             => (encoder ||= new TextEncoder()).encode(s);
const buf2string = (b            )         => (decoder ||= new TextDecoder()).decode(b);

// Where pako never returns or corrupts its own data, fast-pako throws this
// (README "Differences")
const unsupported = (what        , why         = "pako never returns")        => new Error("fast-pako: " + what + " (" + why + ")");

// pako's adler32 over the raw element values (dictionaries that are not
// Uint8Arrays: JS addition, so elements that are not bytes count as they are)
function adler32(adler        , buf     , len     , pos        )         {
  // (pako loops forever unless len is a whole number)
  if (!(len >= 0 && len % 1 === 0)) throw unsupported("dictionary length " + String(len));
  let s1 = (adler & 0xffff) | 0, s2 = ((adler >>> 16) & 0xffff) | 0, n = 0;
  while (len !== 0) {
    n = len > 2000 ? 2000 : len;
    len -= n;
    do {
      s1 = (s1 + buf[pos++]) | 0;
      s2 = (s2 + s1) | 0;
    } while (--n);
    s1 %= 65521;
    s2 %= 65521;
  }
  return (s1 | (s2 << 16)) | 0;
}

// ------------------------------------------------------------------ wasm


/** exports of rust/boot (decoder of the embedded core) */
;                      
                             
                                                                             
                                     
                    
                                                                    
 

let W                   = null; // wasm exports
let SP                    ; // its __stack_pointer (restored after exceptions)
let RESP = 0; // byte offset of the Res block
let memBuf                     = null, m8                    = null, m16                     = null, m32                    = null,
  mu32                     = null, mf64                      = null;
function views()       {
  const b = W.memory.buffer;
  if (b !== memBuf) {
    memBuf = b;
    m8 = new Uint8Array(b);
    m16 = new Uint16Array(b);
    m32 = new Int32Array(b);
    mu32 = new Uint32Array(b);
    mf64 = new Float64Array(b);
  }
}

// The core module is embedded deflate-compressed, as text; the boot module
// decodes it. Done on first use (Nodepod imports this module in every worker).
function load()            {
  let bytes                         ;
  try {
    let bb                         ;
    // (natively where there is a way: a loop over atob costs 0.07 ms)
    if (typeof Buffer === "function") bb = new Uint8Array(Buffer.from(boot, "base64"));
    else if (Uint8Array.fromBase64) bb = Uint8Array.fromBase64(boot);
    else {
      const bin = atob(boot);
      bb = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bb[i] = bin.charCodeAt(i);
    }
    const e = new WebAssembly.Instance(new WebAssembly.Module(bb)).exports                          ;
    // the text (decoded in place, then 8 zero bytes: the decoder reads
    // ahead), the module
    const n = packed.length;
    const base = e.memory.grow(Math.ceil((n + 8 + size) / 65536)) * 65536;
    (encoder ||= new TextEncoder()).encodeInto(packed, new Uint8Array(e.memory.buffer, base, n));
    if (e.inflate(base, e.text(base, n), base + n + 8, size) !== size) throw new Error("corrupt module");
    bytes = new Uint8Array(e.memory.buffer, base + n + 8, size);
    W = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
      env: { js_emit: (kind, ptr, len, chunkSize) => cur.emit(kind, ptr, len, chunkSize), js_op: jsOp },
    }).exports                        ;
  } catch (e) {
    throw new Error("fast-pako needs WebAssembly (" + (e && e.message) + ")");
  }
  SP = W.__stack_pointer;
  RESP = W.fz_res();
  views();
  return W;
}
const wasm = ()            => W || load();

// Res field indexes (int32 units; f64 fields at R_TOTAL_IN / 2 ...)
const R_RET = 0, R_ENDED = 1, R_END_STATUS = 2, R_MSG = 3, R_OUT_PTR = 4, R_OUT_LEN = 5, R_ADLER = 6, R_AVAIL_IN = 7, R_NEXT_IN = 8,
  R_AVAIL_OUT = 9, R_NEXT_OUT = 10, R_DATA_TYPE = 11, R_SEG_PTR = 12, R_SEG_LEN = 13, R_HV = 14, R_TOTAL_IN = 16, R_TOTAL_OUT = 18, R_ARG = 20;
const res = ()         => (views(), RESP >> 2);

const TRIM = 8 << 20;

// ------------------------------------------------------------------ the current call

// what the imports work on (saved and restored around every call into the
// wasm: onData handlers may start other streams)
                
            
                                                
            
                                                                  
            
                           
 
let cur              = null;

// pako's configuration_table as far as its indexes go: an array of 10
const configuration_table      = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// js_op: pako's own expressions on the JavaScript values (so that they
// convert and throw exactly like pako's)
function jsOp(op        , a        , b        , c        )         {
  switch (op) {
    case 0: {
      // deflate's read_buf: buf.set(strm.input.subarray(next_in, next_in + len), start)
      const strm = cur.strm;
      const src = strm.input.subarray(a, a + b);
      views();
      new Uint8Array(memBuf, c, b).set(src);
      return 0;
    }
    case 1: {
      // inflate: output.set(input.subarray(next, next + copy), put)
      const input = cur.strm.input;
      const src = input.subarray(a, a + b);
      if (c) {
        views();
        new Uint8Array(memBuf, c, b).set(src);
      }
      return 0;
    }
    case 2:
      // inflate: hold += input[next++] << bits
      return cur.strm.input[a] << 0;
    case 3: {
      // inflate, gzip name/comment: if (len) head.name += String.fromCharCode(len)
      const len = cur.strm.input[a];
      return len ? 0x10000 | String.fromCharCode(len).charCodeAt(0) : 0;
    }
    case 4:
      // Inflate.push: data[strm.next_in] !== 0
      return cur.data[a] !== 0 ? 1 : 0;
    case 5: {
      // deflate: configuration_table[s.level].func(s, flush)
      const s = { level: cur.h.p.level };
      configuration_table[s.level].func(s, 0);
      break;
    }
    case 6: {
      // inflate: state.head.extra = new Uint8Array(state.head.extra_len)
      views();
      const len = mf64[RESP / 8 + R_ARG / 2];
      new Uint8Array(len);
      throw unsupported("gzip extra field of " + len + " bytes", "not kept");
    }
    case 7: {
      // inflate on Z_NEED_DICT: the exception computing the dictionary's
      // id, or updatewindow's state.window.set(src.subarray(...))
      if (cur.h.dictErr) throw cur.h.dictErr;
      const src = cur.h.dict;
      src.subarray(0, 0);
      break;
    }
    case 8:
      // TypedArray set() past the end
      new Uint8Array(1).set(new Uint8Array(2), 0);
      break;
    case 9:
      throw unsupported("a partial flush per chunk");
  }
  throw new TypeError("fast-pako: unexpected op " + op);
}

// ------------------------------------------------------------------ streams

function ZStream(         )       {
  this.input = null;
  this.next_in = 0;
  this.avail_in = 0;
  this.total_in = 0;
  this.output = null;
  this.next_out = 0;
  this.avail_out = 0;
  this.total_out = 0;
  this.msg = "";
  this.state = null;
  this.data_type = 2;
  this.adler = 0;
}

/** strm fields from the Res block */
function syncStrm(strm     , isInflate         )       {
  const r = res();
  const m = m32[r + R_MSG];
  strm.msg = isInflate ? INF_MSG[m] : m ? msg[m] : strm.msg;
  strm.adler = m32[r + R_ADLER];
  strm.avail_in = mu32[r + R_AVAIL_IN];
  strm.next_in = mu32[r + R_NEXT_IN];
  strm.avail_out = mu32[r + R_AVAIL_OUT];
  strm.next_out = mu32[r + R_NEXT_OUT];
  strm.data_type = m32[r + R_DATA_TYPE];
  strm.total_in = mf64[(r >> 1) + (R_TOTAL_IN >> 1)];
  strm.total_out = mf64[(r >> 1) + (R_TOTAL_OUT >> 1)];
}

// Ended streaming sessions are kept (a few, with big buffers released) and
// re-initialized by the next constructor: equivalent to a fresh state, but
// avoids allocating and zeroing windows/hash tables for every stream.
const POOL_MAX = 4, POOL_TRIM = 1 << 20;
const freeDef           = [], freeInf           = [];
function releaseDef(s        )       {
  if (freeDef.length < POOL_MAX) {
    W.def_trim(s, POOL_TRIM);
    freeDef.push(s);
  } else W.def_destroy(s);
}
function releaseInf(s        )       {
  if (freeInf.length < POOL_MAX) {
    W.inf_trim(s, POOL_TRIM);
    freeInf.push(s);
  } else W.inf_destroy(s);
}
// the one-shot sessions (taken while in use)
let defPool = 0, infPool = 0;

const registry = typeof FinalizationRegistry === "function"
  ? new FinalizationRegistry                  (([kind, s]) => (kind ? W.inf_destroy : W.def_destroy)(s))
  : null;

// hidden per-stream state
const S = Symbol("fastpako");
                  
                                    
            
                                
                      
                                                       
               
                                                                 
            
                                                                        
                  
                                                                              
                     
                                     
             
                      
               
                                                                       
                                           
            
               
                                                                      
                    
                                                                      
                
 
const hidden = (self     , h        )       => {
  Object.defineProperty(self, S, { value: h, writable: true });
};

// chunkSize as pako uses it: new Uint8Array(chunkSize) for every chunk, and
// chunkSize itself as avail_out, counted down and added to other counters.
// Whole numbers >= 1 work; with others pako throws (natural RangeError
// below), loops forever or corrupts its counters (a string chunkSize makes
// them strings: next_out += "64").
function chunkNum(cs     )         {
  if (typeof cs === "number" && cs >= 1 && cs <= 1 << 30 && cs % 1 === 0) return cs;
  new Uint8Array(cs);
  throw unsupported("chunkSize " + (typeof cs === "string" ? '"' + cs + '"' : String(cs)), "pako miscounts or never returns");
}

// run a push in the wasm with the call context set; `after` syncs strm
// fields (also when an exception comes through)
function run(call      , fn              , after                           )         {
  const prev = cur, sp = SP.value;
  cur = call;
  let ok = false;
  try {
    const r = fn();
    ok = true;
    return r;
  } finally {
    SP.value = sp;
    cur = prev;
    after(!ok);
  }
}

// ------------------------------------------------------------------ deflate

// deflate parameter flags (rust/src/deflate.rs F_*)
const F_STRICT0 = 1, F_GT0 = 2, F_FILTERED = 4, F_HUFF = 8, F_RLE = 16, F_FIXED = 32;

                     
             
              
                
               
                  
               
               
                 
               
                           
                 
                 
              
 

const log2 = (n        )         => 31 - Math.clz32(n);

// pako's deflateInit2 (+ the DeflateState it allocates, lm_init) for the
// options: throws what pako throws, else the parameters for the wasm
function defParams(opt     )            {
  let level = opt.level, windowBits = opt.windowBits;
  const method = opt.method, memLevel = opt.memLevel, strategy = opt.strategy;
  let wrap = 1;
  if (level === -1) level = 6;
  if (windowBits < 0) {
    wrap = 0;
    windowBits = -windowBits;
  } else if (windowBits > 15) {
    wrap = 2;
    windowBits -= 16;
  }
  if (memLevel < 1 || memLevel > 9 || method !== 8 || windowBits < 8 || windowBits > 15 || level < 0 || level > 9 || strategy < 0 || strategy > 4 || (windowBits === 8 && wrap !== 1)) {
    throw new Error(msg[-2]);
  }
  if (windowBits === 8) windowBits = 9;
  const wsize = 1 << windowBits;
  const hashBits = memLevel + 7;
  const hashSize = 1 << hashBits;
  const hashShift = ~~((hashBits + 3 - 1) / 3);
  const litBufsize = 1 << (memLevel + 6);
  // (pako allocates its hash table and pending buffer with these sizes)
  if (hashSize < 0) new Uint16Array(hashSize);
  if (litBufsize < 0) new Uint8Array(litBufsize * 4);
  if (wsize < 512) throw unsupported("windowBits " + String(opt.windowBits), "pako's " + wsize + "-byte window corrupts data");
  if (litBufsize < 128 || litBufsize > 1 << 24 || hashSize > 1 << 25) {
    throw unsupported("memLevel " + String(memLevel), "pako's buffers: " + litBufsize + " symbols, " + hashSize + " hash entries");
  }
  // lm_init: configuration_table[s.level].max_lazy etc.
  const c      = configuration_table[level];
  if (c === undefined) c.max_lazy;
  return {
    level,
    cfg: typeof c === "number" ? c : 10,
    flags: (level === 0 ? F_STRICT0 : 0) | (level > 0 ? F_GT0 : 0) | (strategy === 1 ? F_FILTERED : 0) | (strategy === 2 ? F_HUFF : 0) |
      (strategy === 3 ? F_RLE : 0) | (strategy === 4 ? F_FIXED : 0),
    wrap,
    windowBits,
    wlog: log2(wsize),
    hlog: log2(hashSize),
    hshift: hashShift & 31,
    llog: log2(litBufsize),
    lflags: strategy >= 2 || level < 2 ? 0 : level < 6 ? 1 : level === 6 ? 2 : 3,
    xfl: level === 9 ? 2 : strategy >= 2 || level < 2 ? 4 : 0,
  };
}

// pako's Deflate constructor after options: deflateInit2, deflateSetHeader,
// the dictionary. Returns the session.
function defInit(self     , opt     , streaming         )         {
  const p = defParams(opt);
  const w = wasm();
  const head = p.wrap === 2 && opt.header ? opt.header : null;
  // (the header now unless it depends on the dictionary or header option)
  const hc = head || (opt.dictionary && p.wrap === 1) ? 0 : stdHeader(p);
  let s        ;
  if (streaming) s = w.def_init(freeDef.length ? freeDef.pop() : 0, p.cfg, p.flags, p.wrap, p.wlog, p.hlog, p.hshift, p.llog, 1, hc);
  else {
    s = w.def_init(defPool, p.cfg, p.flags, p.wrap, p.wlog, p.hlog, p.hshift, p.llog, 0, hc);
    defPool = 0;
  }
  const h         = { s, p, hdr: p.wrap === 0 || hc !== 0, head, preset: false, gz: null, hv: 0, wrap: p.wrap, dict: null, dictErr: null, nanTotal: false, wide: false };
  hidden(self, h);
  const strm = self.strm;
  strm.adler = p.wrap === 2 ? 0 : 1;
  strm.state = {};
  if (opt.dictionary) {
    try {
      let dict     ;
      if (typeof opt.dictionary === "string") dict = string2buf(opt.dictionary);
      else if (isAB(opt.dictionary)) dict = new Uint8Array(opt.dictionary);
      else dict = opt.dictionary;
      // deflateSetDictionary(strm, dict)
      const dictLength = dict.length;
      if (p.wrap === 2) throw new Error(msg[-2]);
      const t = tagOf(dict);
      let adler = 0, has = 0;
      if (p.wrap === 1 && !isBytes(t)) {
        adler = adler32(1, dict, dictLength, 0);
        has = 1;
      }
      let bytes            ;
      if (t) bytes = isBytes(t) ? dict : new Uint8Array(dict);
      else {
        // fill_window reads it with subarray()
        const wsize = 1 << p.wlog;
        if (dictLength >= wsize) {
          const dictionary = dict;
          dictionary.subarray(dictLength - wsize, dictLength);
        } else if (dictLength !== 0) {
          const strm = { input: dict };
          strm.input.subarray(0, dictLength);
        }
        bytes = new Uint8Array(0);
      }
      const n = bytes.length;
      const ptr = w.def_input(s, n);
      views();
      m8.set(bytes, ptr);
      w.def_set_dict(s, n, adler, has);
      w.def_res(s);
      syncStrm(strm, false);
      h.preset = n > 0;
      self._dict_set = true;
    } catch (e) {
      if (streaming) releaseDef(s);
      else defPool = s;
      throw e;
    }
  }
  return s;
}

/** pako's gzip header state: status (0 GZIP_STATE .. 4 HCRC_STATE),
 * gzindex, the bytes put so far, where the current GZIP_STATE pass began */
;                  
             
             
              
             
                                                                        
             
             
 

// the header bytes pako's deflate() writes first (zlib, or gzip from the
// header option, read now like pako reads it: on the first deflate call)
function defHeader(h        , strm     )       {
  const p = h.p;
  let b          ;
  let hcrc = 0, c0 = 0;
  if (p.wrap === 1) {
    const header = zlibHeader(p, h.preset);
    b = [(header >>> 8) & 0xff, header & 0xff];
    if (h.preset) {
      const a = strm.adler;
      b.push((a >>> 24) & 0xff, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff);
    }
  } else {
    // pako's header states, resumable like pako's: an exception leaves the
    // bytes put so far (flushed by the next push, which goes on from there),
    // the state and gzindex (s.gzindex++ happens before a failing call)
    const g = h.gz || (h.gz = { st: 0, gi: 0, b: [], c0: 0, h: false, ce: 0 });
    b = g.b;
    const base = b.length;
    const put_byte = (v        )       => void b.push(v);
    // (names as in pako's code: its exceptions read the same)
    const s = { gzhead: h.head, get gzindex() { return g.gi; }, set gzindex(v) { g.gi = v; } };
    if (g.st === 0) {
      g.c0 = b.length;
      put_byte(31);
      put_byte(139);
      put_byte(8);
      put_byte((s.gzhead.text ? 1 : 0) + (s.gzhead.hcrc ? 2 : 0) + (!s.gzhead.extra ? 0 : 4) + (!s.gzhead.name ? 0 : 8) + (!s.gzhead.comment ? 0 : 16));
      put_byte(s.gzhead.time & 0xff);
      put_byte((s.gzhead.time >> 8) & 0xff);
      put_byte((s.gzhead.time >> 16) & 0xff);
      put_byte((s.gzhead.time >> 24) & 0xff);
      put_byte(p.xfl);
      put_byte(s.gzhead.os & 0xff);
      if (s.gzhead.extra && s.gzhead.extra.length) {
        put_byte(s.gzhead.extra.length & 0xff);
        put_byte((s.gzhead.extra.length >> 8) & 0xff);
      }
      g.h = !!s.gzhead.hcrc;
      g.ce = b.length;
      s.gzindex = 0;
      g.st = 1;
    }
    if (g.st === 1) {
      if (s.gzhead.extra) {
        let left = (s.gzhead.extra.length & 0xffff) - s.gzindex;
        // more than fits in the pending buffer: pako copies it in parts with
        // s.gzhead.extra.subarray(...), flushing in between
        const pbs = 4 << p.llog;
        let pending = b.length - base;
        while (pending + left > pbs) {
          const copy = pbs - pending;
          const part = new Uint8Array(copy);
          part.set(s.gzhead.extra.subarray(s.gzindex, s.gzindex + copy));
          for (let i = 0; i < copy; i++) put_byte(part[i]);
          s.gzindex += copy;
          pending = 0;
          left -= copy;
        }
        const gzhead_extra = new Uint8Array(s.gzhead.extra);
        const rest = gzhead_extra.subarray(s.gzindex, s.gzindex + left);
        for (let i = 0; i < left; i++) put_byte(i < rest.length ? rest[i] : 0);
        g.ce = b.length;
        s.gzindex = 0;
      }
      g.st = 2;
    }
    if (g.st === 2) {
      if (s.gzhead.name) {
        let val        ;
        do {
          val = s.gzindex < s.gzhead.name.length ? s.gzhead.name.charCodeAt(s.gzindex++) & 0xff : 0;
          put_byte(val);
        } while (val !== 0);
        g.ce = b.length;
        s.gzindex = 0;
      }
      g.st = 3;
    }
    if (g.st === 3) {
      if (s.gzhead.comment) {
        let val        ;
        do {
          val = s.gzindex < s.gzhead.comment.length ? s.gzhead.comment.charCodeAt(s.gzindex++) & 0xff : 0;
          put_byte(val);
        } while (val !== 0);
      }
      g.st = 4;
    }
    hcrc = s.gzhead.hcrc ? 1 : 0;
    c0 = g.c0;
  }
  const ptr = W.def_input(h.s, b.length);
  views();
  m8.set(b, ptr);
  W.def_set_header(h.s, 0, b.length, hcrc, c0);
  h.hdr = true;
}

// pako's zlib header (preset: FDICT)
function zlibHeader(p           , preset         )         {
  const header = ((8 + ((p.windowBits - 8) << 4)) << 8) | (p.lflags << 6) | (preset ? 0x20 : 0);
  return header + 31 - (header % 31);
}
// def_init's code for the header pako writes without a dictionary or header
// option: 1 << 16 | the zlib header, or 2 << 16 | gzip XFL (raw: 0)
const stdHeader = (p           )         => (p.wrap === 1 ? 0x10000 | zlibHeader(p, false) : p.wrap ? 0x20000 | p.xfl : 0);

// pako Deflate.prototype.push after the input conversion, for a session
function defPush(self     , h        , strm     , flush        , streaming         )         {
  const cs = self.options.chunkSize;
  const n0 = chunkNum(cs);
  const input = strm.input;
  const L = strm.avail_in;
  const t = tagOf(input);
  let n        , ext = 0;
  if (isBytes(t)) n = input.length;
  else {
    // read through js_op: pako's subarray() + set()
    ext = 1;
    n = L >= 0 && L % 1 === 0 && L < 2 ** 31 ? +L : L > 0 && L < 2 ** 31 ? Math.ceil(L) : 1 << 30;
  }
  // (pako never returns from these)
  if (((flush !== (flush & 7) || flush > 5) && L !== 0) || (!input && L !== 0)) throw unsupported("flush mode " + flush + " / input");
  if ((flush === 2 || flush === 3) && n0 <= 6) throw unsupported("chunkSize " + n0 + " with flush mode " + flush);
  const w = W;
  if (!h.hdr) {
    // (pako reads the header in its first deflate() call, after allocating
    // the first output chunk)
    try {
      defHeader(h, strm);
    } catch (e) {
      if (strm.avail_out === 0) {
        strm.next_out = 0;
        strm.avail_out = n0;
      }
      // strm.adler: pako's header crc so far
      const g = h.gz;
      if (g) {
        const k = g.ce - g.c0;
        let a = 0;
        if (g.h && g.st && k > 0) {
          const p = W.def_input(h.s, k);
          views();
          m8.set(g.b.slice(g.c0, g.ce), p);
          a = W.fz_crc32(0, p, k);
        }
        strm.adler = a;
      }
      throw e;
    }
  }
  const s = h.s;
  // (ext: an input buffer anyway, the session's input pointer must not be null)
  const p = w.def_input(s, ext ? 0 : n);
  if (!ext) {
    views();
    m8.set(input, p);
  }
  let handler              = null;
  if (streaming) {
    handler = (kind, ptr, len, chunkSize) => {
      syncStrm(strm, false);
      views();
      const chunk = new Uint8Array(chunkSize);
      chunk.set(m8.subarray(ptr, ptr + len));
      strm.output = chunk;
      self.onData(kind === 0 ? chunk : chunk.subarray(0, len));
    };
  }
  return run({ h, strm, data: null, emit: handler }, () => w.def_push(s, n, flush, n0, ext), (thrown) => {
    if (thrown) w.def_res(s);
    syncStrm(strm, false);
    // (pako's read_buf: strm.avail_in -= len, with avail_in = input.length)
    if (ext && typeof L !== "number") strm.avail_in = strm.avail_in === n ? L : NaN;
  });
}

function defConvert(strm     , data     )       {
  if (typeof data === "string") strm.input = string2buf(data);
  else if (isAB(data)) strm.input = new Uint8Array(data);
  else strm.input = data;
  strm.next_in = 0;
  strm.avail_in = strm.input.length;
}

const flushMode = (f     )         => (f === ~~f ? f : f === true ? Z_FINISH : Z_NO_FLUSH);

export function Deflate(           options          )       {
  this.options = assign({ level: -1, method: 8, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: 0 }, options || {});
  const opt = this.options;
  if (opt.raw && opt.windowBits > 0) opt.windowBits = -opt.windowBits;
  else if (opt.gzip && opt.windowBits > 0 && opt.windowBits < 16) opt.windowBits += 16;
  this.err = 0;
  this.msg = "";
  this.ended = false;
  this.chunks = [];
  this.strm = new (ZStream       )();
  this.strm.avail_out = 0;
  const s = defInit(this, opt, true);
  if (registry) registry.register(this, [0, s], this);
}

Deflate.prototype.push = function (           data                          , flush_mode                   )          {
  const h         = this[S];
  if (this.ended) return false;
  const fm = flushMode(flush_mode);
  const strm = this.strm;
  defConvert(strm, data);
  const ret = defPush(this, h, strm, fm, true);
  const r = res();
  if (m32[r + R_ENDED]) {
    const st = m32[r + R_END_STATUS];
    strm.state = null;
    this.onEnd(st);
    this.ended = true;
    releaseDef(h.s);
    h.s = 0;
    if (registry) registry.unregister(this);
    return st === Z_OK;
  }
  return ret === 1;
};

Deflate.prototype.onData = function (           chunk            )       {
  this.chunks.push(chunk);
};

Deflate.prototype.onEnd = function (           status        )       {
  if (status === Z_OK) this.result = flattenChunks(this.chunks);
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};

// the prototype methods pako's deflate() / inflate() would call through a
// stream object (patched ones: they are called)
const DP = Deflate.prototype, dPush = DP.push, dData = DP.onData, dEnd = DP.onEnd;

// pako's deflate(): new Deflate(options), push(input, true), result or throw.
// Runs the same code without the stream object's chunks (one-shot session).
export function deflate(input      , options          )             {
  if (DP.push !== dPush || DP.onData !== dData || DP.onEnd !== dEnd) {
    const deflator = new Deflate(options);
    deflator.push(input, true);
    if (deflator.err) throw deflator.msg || msg[deflator.err];
    return deflator.result;
  }
  const opt = assign({ level: -1, method: 8, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: 0 }, options || {});
  if (opt.raw && opt.windowBits > 0) opt.windowBits = -opt.windowBits;
  else if (opt.gzip && opt.windowBits > 0 && opt.windowBits < 16) opt.windowBits += 16;
  const cs = opt.chunkSize;
  let s        , total        ;
  const t = tagOf(input);
  if ((typeof input === "string" || isBytes(t) || isAB(input)) && !opt.dictionary && typeof cs === "number" && cs >= 1 && cs <= 1 << 30 && cs % 1 === 0) {
    // bytes, a plain header: straight to the one-shot session
    const p = defParams(opt);
    if ((p.wrap === 2 && opt.header) || p.cfg === 10) s = 0;
    else {
      const data             = typeof input === "string" ? string2buf(input) : t ? (input              ) : new Uint8Array(input               );
      const w = wasm();
      s = w.def_init(defPool, p.cfg, p.flags, p.wrap, p.wlog, p.hlog, p.hshift, p.llog, 0, stdHeader(p));
      defPool = 0;
      const n = data.length;
      const ptr = w.def_input(s, n);
      views();
      m8.set(data, ptr);
      w.def_push(s, n, Z_FINISH, cs, 0);
      defPool = s;
      total = n;
    }
  }
  if (!s) {
    const self      = { options: opt };
    const strm = (self.strm = new (ZStream       )());
    s = defInit(self, opt, false);
    const h         = self[S];
    try {
      defConvert(strm, input);
      defPush(self, h, strm, Z_FINISH, false);
    } finally {
      defPool = s;
    }
    total = strm.total_in;
  }
  const r = res();
  const status = m32[r + R_END_STATUS];
  if (!m32[r + R_ENDED] || status !== Z_OK) {
    // not reachable with Z_FINISH; mirror pako's throw just in case
    const m = m32[r + R_MSG];
    throw (m && msg[m]) || msg[status];
  }
  const p = mu32[r + R_OUT_PTR], n = mu32[r + R_OUT_LEN];
  const out = m8.slice(p, p + n);
  if (n > TRIM || total > TRIM) W.def_trim(s, TRIM);
  return out;
}

export function deflateRaw(input      , options          )             {
  options = options || {};
  options.raw = true;
  return deflate(input, options);
}

export function gzip(input      , options          )             {
  options = options || {};
  options.gzip = true;
  return deflate(input, options);
}

// ------------------------------------------------------------------ inflate

// wbits for the wasm when pako's is NaN / undefined (1 << wbits is 1, and
// comparisons with it are false)
const NAN_WBITS = 255;

// pako's Inflate constructor up to inflateInit2 (+ inflateReset2's checks)
function infNormalize(options     )      {
  const opt = assign({ chunkSize: 1024 * 64, windowBits: 15, to: "" }, options || {});
  if (opt.raw && opt.windowBits >= 0 && opt.windowBits < 16) {
    opt.windowBits = -opt.windowBits;
    if (opt.windowBits === 0) opt.windowBits = -15;
  }
  if (opt.windowBits >= 0 && opt.windowBits < 16 && !(options && options.windowBits)) opt.windowBits += 32;
  if (opt.windowBits > 15 && opt.windowBits < 48) {
    if ((opt.windowBits & 15) === 0) opt.windowBits |= 15;
  }
  return opt;
}

// inflateInit2 → inflateReset2(strm, windowBits), then the dictionary option
// inflateReset2's wrap and wbits (wrap << 8 | wbits), or its error
function infWrap(opt     )         {
  let windowBits = opt.windowBits, wrap        ;
  if (windowBits < 0) {
    wrap = 0;
    windowBits = -windowBits;
  } else {
    wrap = (windowBits >> 4) + 5;
    if (windowBits < 48) windowBits &= 15;
  }
  if (windowBits && (windowBits < 8 || windowBits > 15)) throw new Error(msg[-2]);
  return (wrap << 8) | (windowBits === 0 ? 0 : windowBits >= 8 ? Math.floor(windowBits) : NAN_WBITS);
}

function infInit(self     , opt     , streaming         )         {
  const ww = infWrap(opt), wrap = ww >> 8, wbits = ww & 255;
  const w = wasm();
  let s        ;
  if (streaming) s = w.inf_init(freeInf.length ? freeInf.pop() : 0, wrap, wbits, 1);
  else {
    s = w.inf_init(infPool, wrap, wbits, 0);
    infPool = 0;
  }
  const h         = { s, p: null, hdr: false, head: null, preset: false, gz: null, hv: 0, wrap, dict: undefined, dictErr: null, nanTotal: false, wide: false };
  hidden(self, h);
  const strm = self.strm;
  if (wrap) strm.adler = wrap & 1;
  strm.state = {};
  if (streaming) self.header = new (GZheader       )();
  if (opt.dictionary) {
    try {
      if (typeof opt.dictionary === "string") opt.dictionary = string2buf(opt.dictionary);
      else if (isAB(opt.dictionary)) opt.dictionary = new Uint8Array(opt.dictionary);
      if (opt.raw) {
        // inflateSetDictionary(strm, opt.dictionary) now: a stream error
        // unless raw, else updatewindow() reads it with subarray()
        const dictionary = opt.dictionary;
        void dictionary.length;
        if (wrap !== 0) throw new Error(msg[-2]);
        const src = dictionary;
        if (!tagOf(src)) src.subarray(0, 0);
        infDict(h, dictionary, 1);
      } else if (wrap) infDict(h, opt.dictionary, 0);
      else h.dict = opt.dictionary;
    } catch (e) {
      if (streaming) releaseInf(s);
      else infPool = s;
      throw e;
    }
  }
  return s;
}

// give the session the dictionary pako would use on Z_NEED_DICT: its
// bytes, and (not a Uint8Array) the id pako computes over the raw values
// (adler32(1, dictionary, dictionary.length, 0)), or the exception that
// throws, both only raised when pako would compute them
const DICT_JS = 1, DICT_POISON = 2, DICT_THROW = 3, DICT_NONE = 4;
function infDict(h        , dict     , raw        )       {
  h.dict = dict;
  h.dictErr = null;
  let bytes             = null, id = 0, kind = DICT_NONE;
  if (dict) {
    const t = tagOf(dict);
    if (isBytes(t)) {
      bytes = dict;
      kind = 0;
    } else {
      try {
        if (!raw) id = adler32(1, dict, dict.length, 0);
        kind = DICT_JS;
        // updatewindow: state.window.set(src.subarray(...)) (typed arrays:
        // their values as bytes)
        if (t) bytes = new Uint8Array(dict);
        else kind = DICT_POISON;
      } catch (e) {
        if (raw) throw e;
        h.dictErr = e;
        kind = DICT_THROW;
      }
    }
  }
  const n = bytes ? bytes.length : 0;
  const ptr = W.inf_input(h.s, n);
  views();
  if (bytes) m8.set(bytes, ptr);
  W.inf_set_dict(h.s, n, raw, kind, id);
}

// input flags (rust/src/lib.rs IF_*)
const IF_AB = 1, IF_STRING = 2, IF_WIDE = 4, IF_NAN = 8, IF_NULL = 16;

// pako Inflate.prototype.push after the input conversion, for a session
function infPush(self     , h        , strm     , data     , flush        , streaming         )         {
  const opt = self.options;
  const cs = opt.chunkSize;
  const n0 = chunkNum(cs);
  const dictionary = opt.dictionary;
  const toString = opt.to === "string";
  const input = strm.input;
  const L = strm.avail_in;
  const t = tagOf(input);
  let n = 0, flags = (isAB(data) ? IF_AB : 0) | (toString ? IF_STRING : 0);
  let bytes      = null;
  // (once a stream read elements with JS semantics it keeps doing so: its
  // bit buffer may hold more than bytes)
  if (h.wide) bytes = null;
  else if (isBytes(t)) bytes = input;
  else if (t && byteValued(input)) bytes = input;
  if (!bytes) {
    h.wide = true;
    // elements read one by one with pako's semantics
    // pako counts down from avail_in = input.length: a whole number, or
    // NaN (no numeric length: it never reaches 0)
    flags |= IF_WIDE;
    const v = typeof L === "number" || L === undefined ? L : +L;
    if (v >= (typeof L === "number" ? 0 : 1) && v % 1 === 0 && v < 2 ** 31) n = v;
    else if (v !== v || v === undefined) {
      flags |= IF_NAN;
      n = 1 << 30;
    } else throw unsupported("input length " + String(L), "pako reads at fractional or negative positions");
    if (!input) flags |= IF_NULL;
  }
  const w = W;
  const s = h.s;
  // (both use the session's input buffer: the dictionary first)
  if (dictionary !== h.dict && h.wrap) infDict(h, dictionary, 0);
  if (bytes) {
    n = bytes.length;
    const p = w.inf_input(s, n);
    views();
    m8.set(bytes, p);
  } else w.inf_input(s, 0);
  let handler              = null;
  if (streaming) {
    handler = (kind, ptr, len, chunkSize) => {
      syncStrm(strm, true);
      if (h.nanTotal) strm.total_in = NaN;
      syncHeader(self, h, false);
      views();
      if (kind === 2) {
        self.onData(buf2string(m8.subarray(ptr, ptr + len)));
      } else {
        const chunk = new Uint8Array(chunkSize);
        chunk.set(m8.subarray(ptr, ptr + len));
        strm.output = chunk;
        self.onData(kind === 0 ? chunk : chunk.subarray(0, len));
      }
    };
  }
  return run({ h, strm, data, emit: handler }, () => w.inf_push(s, n, flush, flags, n0), (thrown) => {
    if (thrown) w.inf_res(s);
    syncStrm(strm, true);
    if (flags & IF_NAN) {
      strm.avail_in = strm.next_in ? NaN : L;
      // (inflate() returns early for a falsy input)
      if (!(flags & IF_NULL)) h.nanTotal = true;
    }
    if (h.nanTotal) strm.total_in = NaN;
    if (streaming) syncHeader(self, h, thrown);
  });
}

// a typed array whose elements are all bytes reads like a Uint8Array
function byteValued(a     )          {
  for (let i = 0, l = a.length; i < l; i++) {
    const v = a[i];
    if (!(typeof v === "number" && v >= 0 && v <= 255 && v % 1 === 0)) return false;
  }
  return true;
}

function infConvert(strm     , data     )       {
  if (isAB(data)) strm.input = new Uint8Array(data);
  else strm.input = data;
  strm.next_in = 0;
  strm.avail_in = strm.input.length;
}

function GZheader(         )       {
  this.text = 0;
  this.time = 0;
  this.xflags = 0;
  this.os = 0;
  this.extra = null;
  this.extra_len = 0;
  this.name = "";
  this.comment = "";
  this.hcrc = 0;
  this.done = false;
}

const u16str = (p        , n        )         => {
  let str = "";
  for (let i = 0; i < n; i += 8192) str += String.fromCharCode.apply(null, m16.subarray((p >> 1) + i, (p >> 1) + Math.min(n, i + 8192))                       );
  return str;
};

// the header object is pako's live gzip header state
function syncHeader(self     , h        , always         )       {
  const r = res();
  const v = m32[r + R_HV];
  if (always || v !== h.hv) {
    h.hv = v;
    readHeader(self, h.s);
  }
}

function readHeader(self     , s        )       {
  const h = W.inf_header(s);
  views();
  const i = h >> 2, f = h >> 3;
  const hd = self.header;
  hd.text = mu32[i + 4];
  hd.time = mf64[f];
  hd.xflags = mu32[i + 5];
  hd.os = m32[i + 6];
  const el = m32[i + 8];
  hd.extra = el < 0 ? null : m8.slice(mu32[i + 7], mu32[i + 7] + el);
  hd.extra_len = mf64[f + 1];
  const nl = m32[i + 10];
  hd.name = nl < 0 ? null : u16str(mu32[i + 9], nl);
  const cl = m32[i + 12];
  hd.comment = cl < 0 ? null : u16str(mu32[i + 11], cl);
  hd.hcrc = mu32[i + 13];
  hd.done = !!mu32[i + 14];
}

export function Inflate(           options          )       {
  this.options = infNormalize(options);
  this.err = 0;
  this.msg = "";
  this.ended = false;
  this.chunks = [];
  this.strm = new (ZStream       )();
  this.strm.avail_out = 0;
  const s = infInit(this, this.options, true);
  if (registry) registry.register(this, [1, s], this);
}

Inflate.prototype.push = function (           data                                              , flush_mode                   )          {
  const h         = this[S];
  if (this.ended) return false;
  const fm = flushMode(flush_mode);
  const strm = this.strm;
  infConvert(strm, data);
  const ret = infPush(this, h, strm, data, fm, true);
  const r = res();
  if (m32[r + R_ENDED]) {
    const st = m32[r + R_END_STATUS];
    if (st === Z_OK) strm.state = null;
    this.onEnd(st);
    this.ended = true;
    releaseInf(h.s);
    h.s = 0;
    if (registry) registry.unregister(this);
    return st === Z_OK;
  }
  return ret === 1;
};

Inflate.prototype.onData = function (           chunk                     )       {
  this.chunks.push(chunk);
};

Inflate.prototype.onEnd = function (           status        )       {
  if (status === Z_OK) {
    if (this.options.to === "string") this.result = this.chunks.join("");
    else this.result = flattenChunks(this.chunks);
  }
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};

// pako's inflate(): new Inflate(options), push(input), result or throw. One-
// shot session (output in one buffer, no chunk objects).
const IP = Inflate.prototype, iPush = IP.push, iData = IP.onData, iEnd = IP.onEnd;

export function inflate(input                          , options          )                                  {
  if (IP.push !== iPush || IP.onData !== iData || IP.onEnd !== iEnd) {
    const inflator = new Inflate(options);
    inflator.push(input);
    if (inflator.err) throw inflator.msg || msg[inflator.err];
    return inflator.result;
  }
  const opt = infNormalize(options);
  const cs = opt.chunkSize;
  let s = 0;
  const t = tagOf(input);
  if ((isBytes(t) || isAB(input)) && !opt.dictionary && typeof cs === "number" && cs >= 1 && cs <= 1 << 30 && cs % 1 === 0) {
    // bytes, no dictionary: straight to the one-shot session
    const ww = infWrap(opt);
    const data             = t ? (input              ) : new Uint8Array(input               );
    const w = wasm();
    s = w.inf_init(infPool, ww >> 8, ww & 255, 0);
    infPool = 0;
    const ptr = w.inf_input(s, data.length);
    views();
    m8.set(data, ptr);
    w.inf_push(s, data.length, Z_NO_FLUSH, (t ? 0 : IF_AB) | (opt.to === "string" ? IF_STRING : 0), cs);
    infPool = s;
  } else {
    const self      = { options: opt };
    const strm = (self.strm = new (ZStream       )());
    s = infInit(self, opt, false);
    const h         = self[S];
    try {
      infConvert(strm, input);
      infPush(self, h, strm, input, Z_NO_FLUSH, false);
    } finally {
      infPool = s;
    }
  }
  const r = res();
  let out                                 ;
  if (m32[r + R_ENDED]) {
    const status = m32[r + R_END_STATUS];
    if (status !== Z_OK) throw INF_MSG[m32[r + R_MSG]] || msg[status];
    if (opt.to === "string") {
      const segs = m32[r + R_SEG_PTR] >> 2, ns = m32[r + R_SEG_LEN], base = mu32[r + R_OUT_PTR];
      let str = "";
      for (let i = 0; i < ns; i++) {
        const a = base + mu32[segs + 2 * i], n = mu32[segs + 2 * i + 1];
        str += buf2string(m8.subarray(a, a + n));
      }
      out = str;
    } else {
      const p = mu32[r + R_OUT_PTR], n = mu32[r + R_OUT_LEN];
      out = m8.slice(p, p + n);
    }
  }
  if (mu32[r + R_OUT_LEN] > TRIM || mu32[r + R_NEXT_IN] > TRIM) W.inf_trim(s, TRIM);
  return out;
}

export function inflateRaw(input                          , options          )                                  {
  options = options || {};
  options.raw = true;
  return inflate(input, options);
}

export const ungzip = inflate;

export default {
  Deflate,
  deflate,
  deflateRaw,
  gzip,
  Inflate,
  inflate,
  inflateRaw,
  ungzip,
  constants,
};
// generated from index.mts by tools/ts-build.mjs; edit that file
