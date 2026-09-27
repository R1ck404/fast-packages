// fast-es-module-lexer: drop-in replacement for es-module-lexer 1.7.0 (same
// exports: ImportType, init, initSync, parse; same results, same errors).
//
// The lexer is a port of es-module-lexer's lexer.c (rust/src/lib.rs) that
// skips over code with SIMD instead of walking it char by char. Sources go
// into wasm memory by the fastest means the engine has: Node's Buffer
// latin1Write/ucs2Write (memcpy), a wasm loop over the JS-string builtins in
// other V8 hosts (Chromium), TextEncoder.encodeInto elsewhere (Firefox and
// Safari); either way they end up as one byte per UTF-16 code unit, which is
// all the lexer distinguishes. Results
// come back as one int array instead of a wasm call per field, and specifier
// strings without escapes are sliced instead of eval'd (eval of a plain
// quoted literal is its body). Inputs where the original's behaviour depends
// on memory outside the source (see lib.rs) are handed to the vendored
// original, as are non-string arguments.

import * as V from "./vendor/lexer.js";
import wasmBase64, { copy8 as copyBase64 } from "./lexer.wasm.mjs";

export const ImportType = V.ImportType;

const b64 = (str) =>
  typeof Buffer !== "undefined" ? Buffer.from(str, "base64") : Uint8Array.from(atob(str), (x) => x.charCodeAt(0));
const wasmBytes = () => b64(wasmBase64);

let W = null;
let memBuf = null;
let U8, I32;
let H = 0; // header index into I32
let srcPtr = 0; // source buffer in wasm memory
let cap = -1; // capacity of the source buffer in bytes
let srcView = null; // Uint8Array over the source buffer
let NB = null; // Node: Buffer over wasm memory
let C8 = null; // V8: copy8(string, from, to, base, 255, cca) (wasm JS-string builtins)
// how sources get into wasm memory: 0 Node Buffer, 1 V8 builtins, 2 encodeInto
let mode = 2;

// Node.js: Buffer's latin1Write / ucs2Write put a string into wasm memory at
// memcpy speed (TextEncoder.encodeInto is ~1-2 ns per char). Only the real
// Node, not a Buffer polyfill in a browser.
const NodeBuffer =
  typeof process === "object" &&
  process !== null &&
  process.versions != null &&
  typeof process.versions.node === "string" &&
  (typeof navigator === "undefined" || String(navigator.userAgent).startsWith("Node.js")) &&
  typeof Buffer === "function" &&
  typeof Buffer.prototype.latin1Write === "function" &&
  typeof Buffer.prototype.ucs2Write === "function"
    ? Buffer
    : null;
// Which of the two to use: a string's one-byte representation means all its
// chars are <= 0xff (then latin1Write is exact). v8.isStringOneByteRepresentation
// (Node >= 22.15) tells in O(1), but loading node:v8 costs ~1ms, so it is
// only fetched once a few hundred KB went through. Until then a regexp that
// cannot match a one-byte string (V8 answers that in O(1) as well; on a
// two-byte string it stops at the first char above 0xff).
let isOneByte = null;
let nodeChars = 0;
let v8IsOneByte = null;
function loadIsOneByte() {
  if (v8IsOneByte === null) {
    v8IsOneByte = NON_LATIN1_TEST;
    try {
      const v8 = typeof process.getBuiltinModule === "function" ? process.getBuiltinModule("node:v8") : null;
      if (v8 && typeof v8.isStringOneByteRepresentation === "function") v8IsOneByte = v8.isStringOneByteRepresentation;
    } catch {}
  }
  isOneByte = v8IsOneByte;
}
const NON_LATIN1 = /[^\x00-\xff]/;
const NON_LATIN1_TEST = (s) => !NON_LATIN1.test(s);

// V8 (Chromium, Deno): a wasm loop over the JS-string builtins copies a
// string 1.5-4x faster than TextEncoder.encodeInto (a scalar UTF-8 encoder in
// Blink). Firefox and Safari have a fast encodeInto and slow charCodeAt
// builtins, so they keep encodeInto.
function isV8() {
  try {
    JSON.parse("null").x;
  } catch (e) {
    return /^Cannot read propert/.test(e.message);
  }
  return false;
}
function copyModule() {
  try {
    const m = new WebAssembly.Module(b64(copyBase64), { builtins: ["js-string"] });
    // without builtin support the import would have to come from JS (slow)
    if (WebAssembly.Module.imports(m).some((i) => i.module !== "env")) return null;
    return new WebAssembly.Instance(m, { env: { memory: W.memory } }).exports.copy8;
  } catch {
    return null;
  }
}

// copy8 reads strings with intoCharCodeArray until V8 has had the time to
// optimize it (~0.5M chars), then with charCodeAt (fastest, but ~10x slower
// than encodeInto in V8's baseline code; see build.mjs)
let c8cca = 0;
let c8chars = 0;
let c8fixed = false; // (tests)

function setup(instance) {
  if (W) return;
  W = instance.exports;
  H = W.hdr() >> 2;
  if (NodeBuffer !== null) mode = 0;
  else if (isV8() && (C8 = copyModule()) !== null) mode = 1;
  refresh();
}

function refresh() {
  __stats.mode = ["node", "v8", "encode"][mode];
  memBuf = W.memory.buffer;
  U8 = new Uint8Array(memBuf);
  I32 = new Int32Array(memBuf);
  if (mode === 0) NB = NodeBuffer.from(memBuf);
  if (cap >= 0) srcView = new Uint8Array(memBuf, srcPtr, cap);
}

/** test hook: force how sources are copied ("node" | "node-re" | "v8" | "v8-into" | "encode") */
export function __mode(m) {
  initSync();
  if (m === "node" && NodeBuffer !== null) (mode = 0), loadIsOneByte();
  else if (m === "node-re" && NodeBuffer !== null) (mode = 0), (isOneByte = NON_LATIN1_TEST);
  else if ((m === "v8" || m === "v8-into") && (C8 || (C8 = copyModule()))) (mode = 1), (c8cca = m === "v8" ? 1 : 0), (c8fixed = true);
  else if (m === "encode") mode = 2;
  else throw new Error("mode not available: " + m);
  refresh();
}

/** make room for n bytes of source */
function grow(n) {
  srcPtr = W.buf(n);
  if (I32.length === 0) refresh();
  cap = I32[H + 6];
  refresh();
}

/**
 * Wait for init to resolve before calling `parse`.
 */
export const init = WebAssembly.compile(wasmBytes())
  .then(WebAssembly.instantiate)
  .then((instance) => {
    setup(instance);
  });

export const initSync = () => {
  if (W) return;
  setup(new WebAssembly.Instance(new WebAssembly.Module(wasmBytes())));
};

const encoder = new TextEncoder();

/** counters for tests */
export const __stats = { fallback: 0, mode: "" };

function original(source, name) {
  __stats.fallback++;
  V.initSync();
  return V.parse(source, name);
}

// es-module-lexer decodes quoted names with `(0, eval)(literal)`
function decode(str) {
  try {
    return (0, eval)(str);
  } catch (e) {}
}

// `decode(str)` without eval when str is a quoted literal with no escapes
// (export names; the lexer tells for import specifiers): then eval returns
// exactly its body
function literal(str) {
  const len = str.length;
  if (len >= 2) {
    const q = str.charCodeAt(0);
    if ((q === 39 || q === 34) && str.charCodeAt(len - 1) === q) {
      const body = str.slice(1, len - 1);
      if (
        body.indexOf("\\") === -1 &&
        body.indexOf(q === 39 ? "'" : '"') === -1 &&
        body.indexOf("\n") === -1 &&
        body.indexOf("\r") === -1
      )
        return body;
    }
  }
  return decode(str);
}

/**
 * Outputs the list of exports and locations of import specifiers,
 * including dynamic import and import meta handling.
 *
 * @param source Source code to parser
 * @param name Optional sourcename
 * @returns Tuple contaning imports list and exports list.
 */
export function parse(source, name = "@") {
  if (!W) return init.then(() => parse(source));
  if (typeof source !== "string") return original(source, name);

  const len = source.length;
  // bytes per UTF-16 unit: UTF-16 (Node, two-byte strings), bytes (V8), UTF-8
  const need = mode === 1 ? len : mode === 0 ? 2 * len : 3 * len;
  if (need > cap) grow(need);

  let status = -1;
  if (mode === 0) {
    if (isOneByte === null && (nodeChars += len) > 262144) loadIsOneByte();
    if (isOneByte !== null ? isOneByte(source) : !NON_LATIN1.test(source)) {
      NB.latin1Write(source, srcPtr, len);
      status = W.parse8(len);
    } else {
      NB.ucs2Write(source, srcPtr, len * 2);
      status = W.parse16(len);
    }
  } else if (mode === 1) {
    C8(source, 0, len, srcPtr, 255, c8cca);
    if (c8cca === 0 && (c8chars += len) > 1e6 && !c8fixed) c8cca = 1;
    status = W.parse8(len);
  } else {
    if (len <= 128) {
      // a JS copy beats the fixed cost of encodeInto for short strings
      // (Latin-1 bytes are as good as the reduced form, see parse16)
      const u8 = U8;
      let any = 0;
      for (let i = 0, j = srcPtr; i < len; i++, j++) {
        const c = source.charCodeAt(i);
        any |= c;
        u8[j] = c;
      }
      if (any < 256) status = W.parse8(len);
    }
    if (status < 0) {
      // UTF-8 into wasm memory; the wasm side reduces it to one byte per UTF-16
      // code unit (a no-op for ASCII) so positions are UTF-16 indices
      const written = encoder.encodeInto(source, srcView).written;
      status = written === len ? W.parse8(len) : W.parse_utf8(len, written);
    }
  }
  // (a memory.grow detaches the old buffer: its views read as empty)
  if (I32.length === 0) refresh();

  if (status !== 0) {
    if (status === 2) return original(source, name);
    const e = I32[H + 1];
    throw Object.assign(
      new Error(`Parse error ${name}:${source.slice(0, e).split("\n").length}:${e - source.lastIndexOf("\n", e - 1)}`),
      { idx: e },
    );
  }

  const I = I32;
  const ni = I[H + 4];
  const ne = I[H + 5];
  let o = I[H + 6] >> 2;
  const imports = [];
  const exports = [];
  for (let k = 0; k < ni; k++, o += 8) {
    const s = I[o], e = I[o + 1], ss = I[o + 2], se = I[o + 3], d = I[o + 4], a = I[o + 5], t = I[o + 6], f = I[o + 7];
    // (static: s..e is the body of the literal; dynamic: the literal)
    let n;
    if (f === 1) n = d === -1 ? source.slice(s, e) : source.slice(s + 1, e - 1);
    else if (f !== 0) n = decode(d === -1 ? source.slice(s - 1, e + 1) : source.slice(s, e));
    imports.push({ n, t, s, e, ss, se, d, a });
  }
  for (let k = 0; k < ne; k++, o += 4) {
    const s = I[o], e = I[o + 1], ls = I[o + 2], le = I[o + 3];
    let n = source.slice(s, e);
    let c = source.charCodeAt(s);
    if ((c === 34 || c === 39) && s < e) n = literal(n);
    let ln;
    if (ls >= 0) {
      ln = source.slice(ls, le);
      c = source.charCodeAt(ls);
      if ((c === 34 || c === 39) && ls < le) ln = literal(ln);
    }
    exports.push({ s, e, ls, le, n, ln });
  }
  return [imports, exports, !!I[H + 2], !!I[H + 3]];
}
