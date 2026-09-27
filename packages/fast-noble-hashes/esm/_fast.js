/**
 * @r1ck404/fast-noble-hashes: the wasm fast paths.
 *
 * SHA-256/224, SHA-512/384/512_224/512_256, SHA-1 and MD5 keep noble's own
 * classes and instance fields. `HashMD.update` / `digestInto` (see _md.js)
 * hand whole blocks and the padding to the wasm block functions, moving the
 * state words between the instance fields and wasm memory around each call,
 * so every instance ends up field-for-field where noble's JS would leave it.
 * The one-shot hashers (`sha256(msg)`), PBKDF2's iteration loop and scrypt's
 * ROMix run entirely in wasm. Without WebAssembly everything runs noble's
 * original code.
 * @module
 */
import wasmB64 from './_fastwasm.js';
import { abytes, nextTick, toBytes, utf8ToBytes } from './utils.js';
                                              

/** exports of rust/src/lib.rs (offsets and sizes in bytes) */
                       
                             
                                                                  
                            
                                       
                                                                       
                                                           
               
                                                       
                                                       
                                        
                      
 
/**
 * One of noble's HashMD instances (SHA256, SHA512, SHA1, MD5 and their
 * variants): its fields are protected in noble's types, so this is loose.
 */
                                               
/** moves the state words between the instance fields and an Int32Array */
                                                         
/** what defineFast puts on a prototype under FAST */
                         
              
                 
                
                
             
             
             
              
 
/** noble's HMAC (fields are private in its types) */
                                    
/** a scrypt instance from fastScrypt */
                             
                            
                            
                                                
               
 
                                                         

/** Marks the prototypes of the classes with a wasm kernel. */
export const FAST = /* @__PURE__ */ Symbol('fast-noble-hashes');

// wasm alg ids
const A_SHA256 = 0, A_SHA512 = 1, A_SHA1 = 2, A_MD5 = 3;

function b64decode(s        )                          {
  if (typeof Buffer === 'function') return new Uint8Array(Buffer.from(s, 'base64'));
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(s);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let MOD                            = null; // compiled module (scrypt instantiates it once per call)
let W                     = null; // exports of the shared instance
let m8            , m32            , ioView            ,
  IO        , FIN        , OUT        , ST        , ST2        , U        , T        , CAP        , ST32        , ST232        ;
function initWasm(mod                    )       {
  const w = new WebAssembly.Instance(mod, {}).exports                          ;
  // (the shared instance never grows its memory, so the views stay valid)
  m8 = new Uint8Array(w.memory.buffer);
  m32 = new Int32Array(w.memory.buffer);
  IO = w.offset(0);
  FIN = w.offset(1);
  OUT = w.offset(2);
  ST = w.offset(3);
  ST2 = w.offset(4);
  U = w.offset(5);
  T = w.offset(6);
  CAP = w.offset(7);
  ST32 = ST >> 2;
  ST232 = ST2 >> 2;
  ioView = m8.subarray(IO, IO + CAP);
  MOD = mod;
  W = w;
}
/* @__PURE__ */ (() => {
  let bytes                                 = null;
  try {
    if (typeof WebAssembly !== 'object') return;
    bytes = b64decode(wasmB64);
    initWasm(new WebAssembly.Module(bytes));
  } catch (e) {
    // e.g. a main-thread sync compile limit: noble's JS until it is ready
    W = null;
    if (bytes) WebAssembly.compile(bytes).then(initWasm, () => {});
  }
})();

// ---------------------------------------------------------------- state
// State words of each class as noble stores them (int32 fields), in the
// order the wasm expects: 32-bit words, or (lo, hi) pairs for SHA-512.

const L8                                   = {
  save(h, m, i) {
    m[i] = h.A; m[i + 1] = h.B; m[i + 2] = h.C; m[i + 3] = h.D;
    m[i + 4] = h.E; m[i + 5] = h.F; m[i + 6] = h.G; m[i + 7] = h.H;
  },
  load(h, m, i) {
    h.A = m[i]; h.B = m[i + 1]; h.C = m[i + 2]; h.D = m[i + 3];
    h.E = m[i + 4]; h.F = m[i + 5]; h.G = m[i + 6]; h.H = m[i + 7];
  },
};
const L5                                   = {
  save(h, m, i) {
    m[i] = h.A; m[i + 1] = h.B; m[i + 2] = h.C; m[i + 3] = h.D; m[i + 4] = h.E;
  },
  load(h, m, i) {
    h.A = m[i]; h.B = m[i + 1]; h.C = m[i + 2]; h.D = m[i + 3]; h.E = m[i + 4];
  },
};
const L4                                   = {
  save(h, m, i) {
    m[i] = h.A; m[i + 1] = h.B; m[i + 2] = h.C; m[i + 3] = h.D;
  },
  load(h, m, i) {
    h.A = m[i]; h.B = m[i + 1]; h.C = m[i + 2]; h.D = m[i + 3];
  },
};
const L64                                   = {
  save(h, m, i) {
    m[i] = h.Al; m[i + 1] = h.Ah; m[i + 2] = h.Bl; m[i + 3] = h.Bh;
    m[i + 4] = h.Cl; m[i + 5] = h.Ch; m[i + 6] = h.Dl; m[i + 7] = h.Dh;
    m[i + 8] = h.El; m[i + 9] = h.Eh; m[i + 10] = h.Fl; m[i + 11] = h.Fh;
    m[i + 12] = h.Gl; m[i + 13] = h.Gh; m[i + 14] = h.Hl; m[i + 15] = h.Hh;
  },
  load(h, m, i) {
    h.Al = m[i]; h.Ah = m[i + 1]; h.Bl = m[i + 2]; h.Bh = m[i + 3];
    h.Cl = m[i + 4]; h.Ch = m[i + 5]; h.Dl = m[i + 6]; h.Dh = m[i + 7];
    h.El = m[i + 8]; h.Eh = m[i + 9]; h.Fl = m[i + 10]; h.Fh = m[i + 11];
    h.Gl = m[i + 12]; h.Gh = m[i + 13]; h.Hl = m[i + 14]; h.Hh = m[i + 15];
  },
};

/**
 * Registers a wasm kernel for one of noble's classes. Only instances whose
 * constructor is exactly `cls` use it (subclasses may override process()),
 * and only while their block/output/padding parameters are the class's own.
 */
export function defineFast(cls              , kind                                      )       {
  const [alg, layout]                                             =
    kind === 'sha256' ? [A_SHA256, L8] :
    kind === 'sha512' ? [A_SHA512, L64] :
    kind === 'sha1' ? [A_SHA1, L5] : [A_MD5, L4];
  const t = new cls();
  Object.defineProperty(cls.prototype, FAST, {
    value: {
      alg, ctor: cls, save: layout.save, load: layout.load,
      bl: t.blockLen, ol: t.outputLen, po: t.padOffset, le: t.isLE,
    },
  });
}

function usable(h    , k        )          {
  return h.blockLen === k.bl && h.outputLen === k.ol && h.padOffset === k.po && h.isLE === k.le;
}

function bitsLo(len        )         {
  return (len * 8) >>> 0;
}
function bitsHi(len        )         {
  return Math.floor((len * 8) / 4294967296) >>> 0;
}

// cached views into wasm memory (no allocation per call)
const ioAt               = [];
const outAt               = [];
function ioFrom(i        )             {
  return (ioAt[i] ||= m8.subarray(IO + i, IO + CAP));
}
function outView(n        )             {
  return (outAt[n] ||= m8.subarray(OUT, OUT + n));
}
function finView(bl        )             {
  return (outAt[1000 + bl] ||= m8.subarray(FIN, FIN + bl));
}
function ioBlock(bl        )             {
  return (outAt[2000 + bl] ||= m8.subarray(IO, IO + bl));
}

let encoder                     = null;

/**
 * HashMD.update after aexists(): validates `data` like toBytes/abytes and
 * hashes it. Returns false (nothing done, noble's code runs) when wasm is
 * unavailable or the instance was tampered with.
 */
export function fastUpdate(h    , data     , k        )          {
  if (W === null || !usable(h, k)) return false;
  if (typeof data === 'string') {
    if (data.length * 3 <= CAP - k.bl) return updateString(h, data, k);
    data = utf8ToBytes(data);
  } else abytes(data);
  const len = data.length;
  const bl = k.bl;
  const bpos = h.pos;
  const buffer = h.buffer;
  if (bpos + len < bl) {
    // stays in the buffer, as in noble
    buffer.set(data, bpos);
    h.pos = bpos + len;
    h.length += len;
    return true;
  }
  k.save(h, m32, ST32);
  if (len <= CAP - bl) {
    // buffered bytes and data together in io (no per-call views)
    if (bpos > 0) m8.set(buffer, IO);
    m8.set(data, IO + bpos);
    const total = bpos + len;
    const end = total - (total % bl);
    // noble's buffer: the block it completed (if any), then the new tail
    if (bpos > 0) buffer.set(ioBlock(bl));
    for (let i = end; i < total; i++) buffer[i - end] = m8[IO + i];
    m8.fill(0, IO + end, IO + total);
    W.blocks(k.alg, end / bl);
    h.pos = total - end;
    h.length += len;
    k.load(h, m32, ST32);
    W.wipe();
    return true;
  }
  let dpos = 0;
  let io = 0;
  if (bpos > 0) {
    // noble completes its buffer and processes it from there
    const take = bl - bpos;
    buffer.set(data.subarray(0, take), bpos);
    m8.set(buffer, IO);
    io = bl;
    dpos = take;
  }
  const end = len - ((len - dpos) % bl);
  for (;;) {
    const n = Math.min(CAP - io, end - dpos);
    if (n > 0) {
      m8.set(n === len ? data : data.subarray(dpos, dpos + n), IO + io);
      io += n;
      dpos += n;
    }
    if (io > 0) W.blocks(k.alg, io / bl);
    io = 0;
    if (dpos >= end) break;
  }
  if (end < len) buffer.set(data.subarray(end), 0);
  h.pos = len - end;
  h.length += len;
  k.load(h, m32, ST32);
  W.wipe();
  return true;
}

/**
 * update() with a string: UTF-8 encoded straight into wasm memory after the
 * buffered bytes, instead of into a new array (noble's utf8ToBytes).
 */
function updateString(h    , str        , k        )          {
  const bl = k.bl;
  const bpos = h.pos;
  const buffer = h.buffer;
  for (let i = 0; i < bpos; i++) m8[IO + i] = buffer[i];
  encoder ||= new TextEncoder();
  const n = encoder.encodeInto(str, ioFrom(bpos)).written;
  const total = bpos + n;
  if (total < bl) {
    for (let i = bpos; i < total; i++) buffer[i] = m8[IO + i];
    m8.fill(0, IO, IO + total);
    h.pos = total;
    h.length += n;
    return true;
  }
  k.save(h, m32, ST32);
  const end = total - (total % bl);
  // noble's buffer: the block it completed (if any), then the new tail
  if (bpos > 0) buffer.set(ioBlock(bl));
  for (let i = end; i < total; i++) buffer[i - end] = m8[IO + i];
  m8.fill(0, IO + end, IO + total);
  W.blocks(k.alg, end / bl);
  h.pos = total - end;
  h.length += n;
  k.load(h, m32, ST32);
  W.wipe();
  return true;
}

/** HashMD.digestInto after its checks (and `finished = true`). */
export function fastDigestInto(h    , out            , k        )          {
  if (W === null || !usable(h, k)) return false;
  const buffer = h.buffer;
  k.save(h, m32, ST32);
  // (the whole buffer: finish reads pos bytes and clears the block)
  m8.set(buffer, IO);
  const length = h.length;
  W.finish(k.alg, h.pos, bitsLo(length), bitsHi(length));
  // noble's buffer ends up holding the last block it processed
  buffer.set(finView(k.bl));
  k.load(h, m32, ST32);
  out.set(outView(k.ol));
  W.wipe();
  return true;
}

/** Whole message into the state in ST, then finish: the digest is in OUT. */
function hashBytes(alg        , bl        , data            )       {
  const len = data.length;
  let pos = 0;
  while (len - pos > CAP) {
    m8.set(data.subarray(pos, pos + CAP), IO);
    W.blocks(alg, CAP / bl);
    pos += CAP;
  }
  m8.set(pos === 0 ? data : data.subarray(pos), IO);
  W.finish(alg, len - pos, bitsLo(len), bitsHi(len));
}

/**
 * utils.createHasher with a one-shot path that never creates an instance:
 * same function shape (name, length, outputLen, blockLen, create).
 */
export function fastHasher(hashCons          )        {
  const hashC = (msg                     )             => {
    if (W !== null) {
      let data      = msg;
      if (typeof msg === 'string') {
        if (msg.length * 3 <= CAP) {
          encoder ||= new TextEncoder();
          const n = encoder.encodeInto(msg, ioView).written;
          m32.set(iv, ST32);
          W.finish(alg, n, bitsLo(n), bitsHi(n));
          const res = m8.slice(OUT, OUT + outputLen);
          W.wipe();
          return res;
        }
        data = utf8ToBytes(msg);
      } else abytes(msg);
      m32.set(iv, ST32);
      hashBytes(alg, blockLen, data);
      const res = m8.slice(OUT, OUT + outputLen);
      W.wipe();
      return res;
    }
    return hashCons().update(toBytes(msg)).digest();
  };
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  const k = tmp[FAST];
  const { alg } = k;
  const { outputLen, blockLen } = tmp;
  const iv = new Int32Array(16);
  k.save(tmp, iv, 0);
  return hashC;
}

// ---------------------------------------------------------------- PBKDF2

/**
 * The kernel for PBKDF2's PRF (noble's HMAC over one of the classes above,
 * right after construction), or undefined.
 */
export function fastPrf(PRF     )                     {
  if (W === null) return undefined;
  const { iHash, oHash } = PRF;
  const k = iHash && iHash[FAST];
  if (k === undefined || iHash.constructor !== k.ctor || oHash.constructor !== k.ctor) return undefined;
  const bl = iHash.blockLen;
  if (iHash.pos !== 0 || oHash.pos !== 0 || iHash.length !== bl || oHash.length !== bl) return undefined;
  if (iHash.finished || oHash.finished || iHash.destroyed || oHash.destroyed) return undefined;
  return k;
}

// iterations per wasm call (keeps the async version responsive)
const PBKDF2_CHUNK = 1 << 30;

/**
 * PBKDF2 iterations in wasm: U = PRF(U), acc ^= U, `iters` times. `u` and
 * `acc` (both PRF.outputLen long) are read and written back.
 */
function pbkdf2Run(PRF     , k        , u            , acc            , iters        )       {
  const ol = u.length;
  k.save(PRF.iHash, m32, ST32);
  k.save(PRF.oHash, m32, ST232);
  m8.set(u, U);
  m8.set(acc, T);
  W.pbkdf2(k.alg, ol, iters);
  u.set(m8.subarray(U, U + ol));
  acc.set(m8.subarray(T, T + ol));
  W.wipe();
}

/**
 * Iterations 2..c of one PBKDF2 block (`u` = U1, Ti = its first Ti.length
 * bytes on entry), as noble's loop computes them.
 */
export function fastPbkdf2(PRF     , k        , u            , Ti            , iters        )       {
  const acc = u.slice();
  for (let done = 0; done < iters; ) {
    const n = Math.min(PBKDF2_CHUNK, iters - done);
    pbkdf2Run(PRF, k, u, acc, n);
    done += n;
  }
  Ti.set(acc.subarray(0, Ti.length));
  acc.fill(0);
}

/**
 * Async version: runs as many iterations per slice as fit in `asyncTick`
 * ms, then yields like noble's asyncLoop.
 */
export async function fastPbkdf2Async(PRF     , k        , u            , Ti            , iters        , asyncTick        )                {
  const acc = u.slice();
  let done = 0;
  let step = 256;
  let ts = Date.now();
  while (done < iters) {
    const n = Math.min(step, iters - done);
    const t0 = Date.now();
    pbkdf2Run(PRF, k, u, acc, n);
    done += n;
    const spent = Date.now() - t0;
    if (spent < asyncTick / 4 && step < PBKDF2_CHUNK) step *= 2;
    const diff = Date.now() - ts;
    if (diff >= 0 && diff < asyncTick) continue;
    await nextTick();
    ts += diff;
  }
  Ti.set(acc.subarray(0, Ti.length));
  acc.fill(0);
}

// ---------------------------------------------------------------- scrypt

/**
 * ROMix in a fresh wasm instance sized for (r, N, p), or null (no wasm, or
 * the memory cannot be allocated: then noble's JS runs).
 */
export function fastScrypt(r        , N        , p        )                    {
  if (MOD === null || N > 2 ** 31) return null;
  let w             ;
  try {
    w = new WebAssembly.Instance(MOD, {}).exports                          ;
  } catch (e) {
    return null;
  }
  const b = w.scrypt_init(r, N, p);
  if (b === 0) return null;
  const bytes = 128 * r * p;
  return {
    /** copies B in */
    setB(B) {
      new Uint8Array(w.memory.buffer, b, bytes).set(B);
      w.scrypt_permute(0);
    },
    /** copies B out */
    getB(B) {
      w.scrypt_permute(1);
      B.set(new Uint8Array(w.memory.buffer, b, bytes));
    },
    steps: w.scrypt_steps,
    wipe: w.scrypt_wipe,
  };
}

/**
 * scrypt's loops for all p blocks of B (bytes, updated in place), calling
 * onProgress at the same BlockMix counts as noble's blockMixCb.
 */
function scryptSlices(F            , N        , p        , onProgress          )                                                                              {
  const steps = 2 * N;
  const total = steps * p;
  const per = Math.max(Math.floor(total / 10000), 1);
  let cnt = 0;
  // one slice: [pi, s, e) up to the next progress report
  return () => {
    if (cnt >= total) return false;
    const pi = Math.floor(cnt / steps);
    const s = cnt - pi * steps;
    let e = steps;
    if (onProgress) {
      const next = Math.min((Math.floor(cnt / per) + 1) * per, total);
      e = Math.min(steps, s + (next - cnt));
    }
    return [pi, s, e, (n        ) => {
      cnt += n;
      if (onProgress && (!(cnt % per) || cnt === total)) onProgress(cnt / total);
    }];
  };
}

export function fastScryptRun(F            , B            , N        , p        , onProgress          )       {
  try {
    F.setB(B);
    const next = scryptSlices(F, N, p, onProgress);
    for (let sl; (sl = next()); ) {
      const [pi, s, e, done] = sl;
      F.steps(pi, s, e);
      done(e - s);
    }
    F.getB(B);
  } finally {
    F.wipe();
  }
}

/** Async version: slices of at most ~asyncTick ms, yielding like asyncLoop. */
export async function fastScryptRunAsync(F            , B            , N        , p        , onProgress          , asyncTick        )                {
  try {
    F.setB(B);
    const next = scryptSlices(F, N, p, onProgress);
    let step = 16;
    let ts = Date.now();
    for (let sl; (sl = next()); ) {
      const [pi, s, e0, done] = sl;
      for (let s1 = s; s1 < e0; ) {
        const e = Math.min(e0, s1 + step);
        const t0 = Date.now();
        F.steps(pi, s1, e);
        if (Date.now() - t0 < asyncTick / 4) step *= 2;
        s1 = e;
        const diff = Date.now() - ts;
        if (diff >= 0 && diff < asyncTick) continue;
        await nextTick();
        ts += diff;
      }
      done(e0 - s);
    }
    F.getB(B);
  } finally {
    F.wipe();
  }
}

/** Whether the wasm paths are in use (tests). */
export function wasmActive()          {
  return W !== null;
}

/** Whether no message bytes or state are left in wasm memory (tests). */
export function scratchIsClean()          {
  if (W === null) return true;
  for (let i = IO; i < T + 64; i++) if (m8[i] !== 0) return false;
  return true;
}
// generated from _fast.ts by tools/ts-build.mjs; edit that file
