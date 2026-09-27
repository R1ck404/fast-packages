// @r1ck404/fast-pako: drop-in replacement for pako 2.1.0 (same API, same bytes, same
// errors). The hot paths run in a Rust→wasm port of pako's zlib code; anything
// unusual (exotic option values, non-byte inputs, missing wasm) is handed to
// the vendored original, so behaviour is identical in every case.

import V from "./vendor/pako.esm.mjs";
import wasmB64 from "./fastzlib.wasm.mjs";

/** pako's options (both directions) */
export interface Options {
  level?: number;
  method?: number;
  windowBits?: number;
  memLevel?: number;
  strategy?: number;
  chunkSize?: number;
  dictionary?: string | ArrayBuffer | Uint8Array;
  header?: GzipHeaderOptions;
  raw?: boolean;
  gzip?: boolean;
  to?: "" | "string";
}
interface GzipHeaderOptions {
  text?: boolean;
  time?: number;
  os?: number;
  extra?: ArrayLike<number>;
  name?: string;
  comment?: string;
  hcrc?: boolean;
}
/** what pako accepts as input */
export type Data = Uint8Array | ArrayBuffer | string;

/** exports of rust/src/lib.rs (pointers and sizes are byte offsets / counts) */
interface FzExports {
  memory: WebAssembly.Memory;
  fz_res(): number;
  fz_alloc(n: number): number;
  fz_free(p: number, n: number): void;
  def_init(prev: number, level: number, method: number, windowBits: number, memLevel: number, strategy: number, chunkSize: number, streaming: number): number;
  def_set_header(s: number, text: number, hcrc: number, time: number, os: number, extraPtr: number, extraLen: number, namePtr: number, nameLen: number, commentPtr: number, commentLen: number): void;
  def_set_dict(s: number, p: number, n: number): number;
  def_input(s: number, n: number): number;
  def_push(s: number, n: number, flush: number): number;
  def_trim(s: number, keep: number): void;
  def_destroy(s: number): void;
  inf_init(prev: number, windowBits: number, chunkSize: number, streaming: number, toString: number): number;
  inf_set_dict(s: number, p: number, n: number, raw: number): number;
  inf_input(s: number, n: number): number;
  inf_push(s: number, n: number, flush: number, isArrayBuffer: number): number;
  inf_header(s: number): number;
  inf_trim(s: number, keep: number): void;
  inf_destroy(s: number): void;
}
/** js_emit(kind, ptr, len, chunkSize): kind 0 = full chunk, 1 = partial, 2 = string */
type EmitHandler = (kind: number, ptr: number, len: number, chunkSize?: number) => void;

const VDeflate = V.Deflate;
const VInflate = V.Inflate;
export const constants = V.constants;

const Z_NO_FLUSH = 0, Z_SYNC_FLUSH = 2, Z_FULL_FLUSH = 3, Z_FINISH = 4;
const Z_OK = 0, Z_STREAM_END = 1;

const msg: Record<number | string, string> = {
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

const toStr = Object.prototype.toString;
const isAB = (x: unknown): x is ArrayBuffer => toStr.call(x) === "[object ArrayBuffer]";
const hasOwn = Object.prototype.hasOwnProperty;

// pako's utils.assign
function assign<T extends object>(obj: T, ...sources: object[]): T & Options;
function assign(obj: any /*, ...sources */) {
  for (let i = 1; i < arguments.length; i++) {
    const source = arguments[i];
    if (!source) continue;
    if (typeof source !== "object") throw new TypeError(source + "must be non-object");
    for (const p in source) if (hasOwn.call(source, p)) obj[p] = source[p];
  }
  return obj;
}

function flattenChunks(chunks: Uint8Array[]): Uint8Array {
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

const encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;
const string2buf = (s: string): Uint8Array => encoder.encode(s);

// ------------------------------------------------------------------ wasm

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  if (typeof Buffer === "function") return new Uint8Array(Buffer.from(s, "base64"));
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(s);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let W: FzExports | null = null; // wasm exports
let emitHandler: EmitHandler | null = null;
function initWasm(module: WebAssembly.Module): void {
  const inst = new WebAssembly.Instance(module, {
    env: { js_emit: (kind, ptr, len, chunkSize) => emitHandler(kind, ptr, len, chunkSize) },
  });
  W = inst.exports as unknown as FzExports;
}
let wasmModuleBytes: Uint8Array<ArrayBuffer> | null = null;
try {
  // (__FASTZLIB_BYTES: a build with function names, for wasm profiling)
  wasmModuleBytes = globalThis.__FASTZLIB_BYTES || b64decode(wasmB64);
  initWasm(new WebAssembly.Module(wasmModuleBytes));
} catch (e) {
  // e.g. main-thread sync compile limits: use the original until ready
  W = null;
  if (wasmModuleBytes && typeof WebAssembly === "object") {
    WebAssembly.compile(wasmModuleBytes).then(initWasm, () => {});
  }
}

let memBuf: ArrayBuffer | null = null, m8: Uint8Array | null = null, m32: Int32Array | null = null, mu32: Uint32Array | null = null, mf64: Float64Array | null = null;
function views(): void {
  const b = W.memory.buffer;
  if (b !== memBuf) {
    memBuf = b;
    m8 = new Uint8Array(b);
    m32 = new Int32Array(b);
    mu32 = new Uint32Array(b);
    mf64 = new Float64Array(b);
  }
}
let RESP = 0; // byte offset of the Res block
function res(): number {
  views();
  if (!RESP) RESP = W.fz_res();
  return RESP >> 2;
}
// Res field indexes (i32 units)
const R_STATUS = 0, R_RET = 1, R_ENDED = 2, R_END_STATUS = 3, R_MSG = 4, R_OUT_PTR = 5, R_OUT_LEN = 6, R_ADLER = 7,
  R_AVAIL_IN = 8, R_NEXT_IN = 9, R_AVAIL_OUT = 10, R_NEXT_OUT = 11, R_DATA_TYPE = 12, R_SEG_PTR = 13, R_SEG_LEN = 14,
  R_HV = 15, R_TOTAL_IN = 16, R_TOTAL_OUT = 18;

const TRIM = 8 << 20;
const isInt = Number.isInteger;

// ------------------------------------------------------------------ deflate

// Parameters for which the wasm path is exactly equivalent to pako.
function fastDeflateOpts(opt: Options): boolean {
  if (!W) return false;
  const { level, method, windowBits, memLevel, strategy, chunkSize, header, dictionary } = opt;
  if (!isInt(level) || !isInt(method) || !isInt(windowBits) || !isInt(memLevel) || !isInt(strategy) || !isInt(chunkSize)) return false;
  if (chunkSize < 64 || chunkSize > 1 << 30) return false;
  if (header) {
    const { extra, name, comment } = header;
    if (extra && !(Array.isArray(extra) || ArrayBuffer.isView(extra))) return false;
    if (extra && extra.length > 16384) return false;
    if (name && typeof name !== "string") return false;
    if (comment && typeof comment !== "string") return false;
  }
  if (dictionary && !(typeof dictionary === "string" || isAB(dictionary) || dictionary instanceof Uint8Array)) return false;
  return true;
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  let n = 0;
  for (; n < s.length; n++) {
    const c = s.charCodeAt(n) & 0xff;
    if (c === 0) break; // pako stops at the first NUL (it is the terminator)
    out[n] = c;
  }
  return out.subarray(0, n);
}

function writeBytes(bytes: Uint8Array): number {
  const p = W.fz_alloc(bytes.length);
  views();
  m8.set(bytes, p);
  return p;
}

// Ended streaming sessions are kept (a few, with big buffers released) and
// re-initialized by the next constructor: equivalent to a fresh state, but
// avoids allocating and zeroing windows/hash tables for every stream.
const POOL_MAX = 4, POOL_TRIM = 1 << 20;
const freeDef: number[] = [], freeInf: number[] = [];
function releaseDef(s: number): void {
  if (freeDef.length < POOL_MAX) { W.def_trim(s, POOL_TRIM); freeDef.push(s); } else W.def_destroy(s);
}
function releaseInf(s: number): void {
  if (freeInf.length < POOL_MAX) { W.inf_trim(s, POOL_TRIM); freeInf.push(s); } else W.inf_destroy(s);
}

let defPool = 0;

// set up a wasm deflate session per pako's Deflate constructor; throws like it
function defSession(prev: number, opt: Options, streaming: boolean): number {
  const s = W.def_init(prev, opt.level, opt.method, opt.windowBits, opt.memLevel, opt.strategy, opt.chunkSize, streaming ? 1 : 0);
  if (!s) {
    const st = m32[res() + R_STATUS];
    if (prev && streaming) freeDef.push(prev); // left intact by a failed re-init
    throw new Error(msg[st]);
  }
  if (!streaming) defPool = s;
  try {
    if (opt.header) {
      const h = opt.header;
      const extra = h.extra ? new Uint8Array(h.extra) : null;
      const name = h.name ? latin1Bytes(h.name) : null;
      const comment = h.comment ? latin1Bytes(h.comment) : null;
      const allocs: [number, number][] = [];
      const put = (b: Uint8Array | null): [number, number] => {
        if (!b) return [0, -1];
        const p = writeBytes(b);
        allocs.push([p, b.length]);
        return [p, b.length];
      };
      const [ep, el] = put(extra);
      const [np, nl] = put(name);
      const [cp, cl] = put(comment);
      W.def_set_header(s, h.text ? 1 : 0, h.hcrc ? 1 : 0, (h.time | 0) >>> 0, (h.os & 0xff) >>> 0, ep, el, np, nl, cp, cl);
      for (const [p, n] of allocs) W.fz_free(p, n);
    }
    if (opt.dictionary) {
      let dict = opt.dictionary;
      if (typeof dict === "string") dict = string2buf(dict);
      else if (isAB(dict)) dict = new Uint8Array(dict);
      const p = writeBytes(dict as Uint8Array);
      const st = W.def_set_dict(s, p, (dict as Uint8Array).length);
      W.fz_free(p, (dict as Uint8Array).length);
      if (st !== Z_OK) throw new Error(msg[st]);
    }
  } catch (e) {
    if (streaming) releaseDef(s);
    throw e;
  }
  return s;
}

function deflateOnce(input: Data, options?: Options): Uint8Array | null {
  const opt = assign(
    { level: -1, method: 8, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: 0 },
    options || {},
  );
  if (opt.raw && opt.windowBits > 0) opt.windowBits = -opt.windowBits;
  else if (opt.gzip && opt.windowBits > 0 && opt.windowBits < 16) opt.windowBits += 16;

  let data: Uint8Array;
  if (typeof input === "string") data = string2buf(input);
  else if (isAB(input)) data = new Uint8Array(input);
  else if (input instanceof Uint8Array) data = input;
  else return null;
  if (!fastDeflateOpts(opt)) return null;

  const s = defSession(defPool, opt, false);
  const inPtr = W.def_input(s, data.length);
  views();
  m8.set(data, inPtr);
  W.def_push(s, data.length, Z_FINISH);
  const r = res();
  const status = m32[r + R_END_STATUS];
  if (!m32[r + R_ENDED] || status !== Z_OK) {
    // not reachable with Z_FINISH; mirror pako's throw just in case
    const m = m32[r + R_MSG];
    throw (m ? msg[m] : "") || msg[status];
  }
  const p = mu32[r + R_OUT_PTR], n = mu32[r + R_OUT_LEN];
  const out = m8.slice(p, p + n);
  if (n > TRIM || data.length > TRIM) W.def_trim(s, TRIM);
  return out;
}

export function deflate(input: Data, options?: Options): Uint8Array {
  const r = W ? deflateOnce(input, options) : null;
  if (r !== null) return r;
  return V.deflate(input, options);
}

export function deflateRaw(input: Data, options?: Options): Uint8Array {
  options = options || {};
  options.raw = true;
  return deflate(input, options);
}

export function gzip(input: Data, options?: Options): Uint8Array {
  options = options || {};
  options.gzip = true;
  return deflate(input, options);
}

// ---- streaming Deflate class

const S = Symbol("fastpako");
const S_OPT = Symbol("fastpako.options");
const taTag = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag).get;
const isTypedArray = (x: unknown): boolean => taTag.call(x) !== undefined; // any TypedArray, not DataView
// nothing has gone through the stream yet
const untouched = (self: any): boolean => self.strm.total_in === 0 && self.strm.total_out === 0;
// continue this (still untouched) stream in the original implementation
function toVendor(self: any, VClass: Function, kind: number, s: number): any {
  if (kind === 0) releaseDef(s);
  else releaseInf(s);
  self[S] = null;
  if (registry) registry.unregister(self);
  VClass.call(self, self[S_OPT]);
  return self;
}
const registry = typeof FinalizationRegistry === "function"
  ? new FinalizationRegistry<[number, number]>(([kind, s]) => { if (W) (kind === 0 ? W.def_destroy : W.inf_destroy)(s); })
  : null;

function ZStream(this: any): void {
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

function syncStrm(strm: any, r: number, isInflate: boolean): void {
  const m = m32[r + R_MSG];
  strm.msg = isInflate ? INF_MSG[m] : m ? msg[m] : strm.msg;
  strm.adler = m32[r + R_ADLER];
  strm.avail_in = mu32[r + R_AVAIL_IN];
  strm.next_in = mu32[r + R_NEXT_IN];
  strm.avail_out = mu32[r + R_AVAIL_OUT];
  strm.next_out = mu32[r + R_NEXT_OUT];
  strm.data_type = m32[r + R_DATA_TYPE];
  strm.total_in = mf64[(RESP >> 3) + (R_TOTAL_IN >> 1)];
  strm.total_out = mf64[(RESP >> 3) + (R_TOTAL_OUT >> 1)];
}

export function Deflate(this: any, options?: Options): void {
  this.options = assign(
    { level: -1, method: 8, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: 0 },
    options || {},
  );
  const opt = this.options;
  if (opt.raw && opt.windowBits > 0) opt.windowBits = -opt.windowBits;
  else if (opt.gzip && opt.windowBits > 0 && opt.windowBits < 16) opt.windowBits += 16;

  if (!fastDeflateOpts(opt)) {
    // exact original behaviour
    Object.defineProperty(this, S, { value: null, writable: true });
    VDeflate.call(this, options);
    return;
  }
  this.err = 0;
  this.msg = "";
  this.ended = false;
  this.chunks = [];
  this.strm = new (ZStream as any)();
  this.strm.avail_out = 0;
  const s = defSession(freeDef.length ? freeDef.pop() : 0, opt, true);
  Object.defineProperty(this, S, { value: s, writable: true });
  Object.defineProperty(this, S_OPT, { value: options, writable: true });
  this.strm.state = {};
  if (opt.dictionary) this._dict_set = true;
  if (registry) registry.register(this, [0, s], this);
}

Deflate.prototype.push = function (this: any, data: Data | ArrayLike<number>, flush_mode?: number | boolean): boolean {
  const s = this[S];
  if (!s) return VDeflate.prototype.push.call(this, data, flush_mode);
  if (this.ended) return false;
  let fm: number;
  if (flush_mode === ~~flush_mode) fm = flush_mode;
  else fm = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;
  let input: any;
  if (typeof data === "string") input = string2buf(data);
  else if (isAB(data)) input = new Uint8Array(data);
  else input = data;
  if (!(input instanceof Uint8Array)) {
    // typed arrays are read exactly like pako reads them (via set());
    // other inputs are fed to pako's JS zlib as-is, with results we
    // cannot mirror: an untouched stream is handed to the original
    if (!isTypedArray(input)) {
      if (untouched(this)) return toVendor(this, VDeflate, 0, s).push(data, flush_mode);
      // mid-stream: pako throws when zlib reads such input (strm.input is
      // read with .length, then .subarray): same errors, generated alike
      const strm: { input: any } = { input };
      if (strm.input.length !== 0) strm.input.subarray();
    }
    input = Uint8Array.from(input, (v: number) => v);
  }
  const strm = this.strm;
  strm.input = input;
  const chunkSize = this.options.chunkSize;
  const self = this;
  const prevEmit = emitHandler;
  emitHandler = (kind: number, ptr: number, len: number) => {
    views();
    const chunk = new Uint8Array(chunkSize);
    chunk.set(m8.subarray(ptr, ptr + len));
    strm.output = chunk;
    self.onData(kind === 0 ? chunk : chunk.subarray(0, len));
  };
  let ret: number;
  try {
    const inPtr = W.def_input(s, input.length);
    views();
    m8.set(input, inPtr);
    ret = W.def_push(s, input.length, fm);
  } finally {
    emitHandler = prevEmit;
  }
  const r = res();
  syncStrm(strm, r, false);
  if (m32[r + R_ENDED]) {
    const st = m32[r + R_END_STATUS];
    strm.state = null;
    this.onEnd(st);
    this.ended = true;
    releaseDef(s);
    this[S] = 0;
    if (registry) registry.unregister(this);
    return st === Z_OK;
  }
  return ret === 1;
};

Deflate.prototype.onData = function (this: any, chunk: Uint8Array): void {
  this.chunks.push(chunk);
};

Deflate.prototype.onEnd = function (this: any, status: number): void {
  if (status === Z_OK) this.result = flattenChunks(this.chunks);
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};

// ------------------------------------------------------------------ inflate

function normalizeInflateOpts(options?: Options): Options {
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

function fastInflateOpts(opt: Options): boolean {
  if (!W) return false;
  if (!isInt(opt.windowBits) || !isInt(opt.chunkSize) || opt.chunkSize < 64 || opt.chunkSize > 1 << 30) return false;
  const d = opt.dictionary;
  if (d && !(typeof d === "string" || isAB(d) || d instanceof Uint8Array)) return false;
  return true;
}

let infPool = 0;
const decoder = typeof TextDecoder === "function" ? new TextDecoder() : null;

function infSession(prev: number, opt: Options, streaming: boolean): number {
  const s = W.inf_init(prev, opt.windowBits, opt.chunkSize, streaming ? 1 : 0, opt.to === "string" ? 1 : 0);
  if (!s) {
    const st = m32[res() + R_STATUS];
    if (prev && streaming) freeInf.push(prev); // still a valid session
    throw new Error(msg[st]);
  }
  if (!streaming) infPool = s;
  if (opt.dictionary) {
    let dict = opt.dictionary;
    if (typeof dict === "string") dict = string2buf(dict);
    else if (isAB(dict)) dict = new Uint8Array(dict);
    opt.dictionary = dict;
    const p = writeBytes(dict as Uint8Array);
    const st = W.inf_set_dict(s, p, (dict as Uint8Array).length, opt.raw ? 1 : 0);
    W.fz_free(p, (dict as Uint8Array).length);
    if (opt.raw && st !== Z_OK) {
      if (streaming) releaseInf(s);
      throw new Error(msg[st]);
    }
  }
  return s;
}

const UNDEF = {};

function inflateOnce(input: Uint8Array | ArrayBuffer, options?: Options): Uint8Array | string | undefined | typeof UNDEF {
  const opt = normalizeInflateOpts(options);
  let data: Uint8Array;
  if (input instanceof Uint8Array) data = input;
  else if (isAB(input)) data = new Uint8Array(input);
  else return UNDEF;
  if (!fastInflateOpts(opt)) return UNDEF;
  const s = infSession(infPool, opt, false);
  const inPtr = W.inf_input(s, data.length);
  views();
  m8.set(data, inPtr);
  W.inf_push(s, data.length, Z_NO_FLUSH, isAB(input) ? 1 : 0);
  const r = res();
  let out: Uint8Array | string | undefined;
  if (m32[r + R_ENDED]) {
    const status = m32[r + R_END_STATUS];
    if (status !== Z_OK) {
      const m = INF_MSG[m32[r + R_MSG]];
      throw m || msg[status];
    }
    if (opt.to === "string") {
      const segs = m32[r + R_SEG_PTR] >> 2, ns = m32[r + R_SEG_LEN], base = mu32[r + R_OUT_PTR];
      let str = "";
      for (let i = 0; i < ns; i++) {
        const a = base + mu32[segs + 2 * i], n = mu32[segs + 2 * i + 1];
        str += decoder.decode(m8.subarray(a, a + n));
      }
      out = str;
    } else {
      const p = mu32[r + R_OUT_PTR], n = mu32[r + R_OUT_LEN];
      out = m8.slice(p, p + n);
    }
  } else {
    out = undefined;
  }
  if (mu32[r + R_OUT_LEN] > TRIM || data.length > TRIM) W.inf_trim(s, TRIM);
  return out;
}

export function inflate(input: Uint8Array | ArrayBuffer, options?: Options): Uint8Array | string | undefined {
  if (W) {
    const r = inflateOnce(input, options);
    if (r !== UNDEF) return r as Uint8Array | string | undefined;
  }
  return V.inflate(input, options);
}

export function inflateRaw(input: Uint8Array | ArrayBuffer, options?: Options): Uint8Array | string | undefined {
  options = options || {};
  options.raw = true;
  return inflate(input, options);
}

export const ungzip = inflate;

// ---- streaming Inflate class

function GZheader(this: any): void {
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

export function Inflate(this: any, options?: Options): void {
  const opt = normalizeInflateOpts(options);
  if (!fastInflateOpts(opt)) {
    Object.defineProperty(this, S, { value: null, writable: true });
    VInflate.call(this, options);
    return;
  }
  this.options = opt;
  this.err = 0;
  this.msg = "";
  this.ended = false;
  this.chunks = [];
  this.strm = new (ZStream as any)();
  this.strm.avail_out = 0;
  const s = infSession(freeInf.length ? freeInf.pop() : 0, opt, true);
  Object.defineProperty(this, S, { value: s, writable: true });
  Object.defineProperty(this, S_OPT, { value: options, writable: true });
  Object.defineProperty(this, "_hv", { value: 0, writable: true });
  this.strm.state = {};
  this.header = new (GZheader as any)();
  if (registry) registry.register(this, [1, s], this);
}

function readHeader(self: any, s: number): void {
  views();
  const h = W.inf_header(s) >> 2;
  const hd = self.header;
  hd.text = mu32[h];
  hd.time = m32[h + 1];
  hd.xflags = mu32[h + 2];
  hd.os = mu32[h + 3];
  const el = m32[h + 5];
  hd.extra = el < 0 ? null : m8.slice(mu32[h + 4], mu32[h + 4] + el);
  hd.extra_len = mu32[h + 6];
  const nl = m32[h + 8];
  hd.name = nl < 0 ? null : String.fromCharCode.apply(null, m8.subarray(mu32[h + 7], mu32[h + 7] + nl) as unknown as number[]);
  const cl = m32[h + 10];
  hd.comment = cl < 0 ? null : String.fromCharCode.apply(null, m8.subarray(mu32[h + 9], mu32[h + 9] + cl) as unknown as number[]);
  hd.hcrc = mu32[h + 11];
  hd.done = !!mu32[h + 12];
}

Inflate.prototype.push = function (this: any, data: Uint8Array | ArrayBuffer | ArrayLike<number>, flush_mode?: number | boolean): boolean {
  const s = this[S];
  if (!s) return VInflate.prototype.push.call(this, data, flush_mode);
  if (this.ended) return false;
  let fm: number;
  if (flush_mode === ~~flush_mode) fm = flush_mode;
  else fm = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;
  const ab = isAB(data);
  let input: any = ab ? new Uint8Array(data) : data;
  if (!(input instanceof Uint8Array)) {
    // pako's JS inflate reads element values as they are: only byte
    // arrays convert exactly; anything else on an untouched stream is
    // handed to the original
    if (!(input instanceof Uint8ClampedArray)) {
      if (untouched(this)) return toVendor(this, VInflate, 1, s).push(data, flush_mode);
      void input.length; // null / undefined throw here in pako too
    }
    input = Uint8Array.from(input, (v: number) => v);
  }
  const strm = this.strm;
  strm.input = input;
  const chunkSize = this.options.chunkSize;
  const self = this;
  const prevEmit = emitHandler;
  emitHandler = (kind: number, ptr: number, len: number) => {
    views();
    if (kind === 2) {
      self.onData(decoder.decode(m8.subarray(ptr, ptr + len)));
    } else {
      const chunk = new Uint8Array(chunkSize);
      chunk.set(m8.subarray(ptr, ptr + len));
      strm.output = chunk;
      self.onData(kind === 0 ? chunk : chunk.subarray(0, len));
    }
  };
  let ret: number;
  try {
    const inPtr = W.inf_input(s, input.length);
    views();
    m8.set(input, inPtr);
    ret = W.inf_push(s, input.length, fm, ab ? 1 : 0);
  } finally {
    emitHandler = prevEmit;
  }
  const r = res();
  syncStrm(strm, r, true);
  if (m32[r + R_HV] !== this._hv) {
    this._hv = m32[r + R_HV];
    readHeader(this, s);
  }
  if (m32[r + R_ENDED]) {
    const st = m32[r + R_END_STATUS];
    if (st === Z_OK) strm.state = null;
    this.onEnd(st);
    this.ended = true;
    releaseInf(s);
    this[S] = 0;
    if (registry) registry.unregister(this);
    return st === Z_OK;
  }
  return ret === 1;
};

Inflate.prototype.onData = function (this: any, chunk: Uint8Array | string): void {
  this.chunks.push(chunk);
};

Inflate.prototype.onEnd = function (this: any, status: number): void {
  if (status === Z_OK) {
    if (this.options.to === "string") this.result = this.chunks.join("");
    else this.result = flattenChunks(this.chunks);
  }
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};

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
