// Shared helpers for the decoder tests/benchmarks: loads the raw fastbrotli
// wasm (no imports) and wraps its exports. A trap (Rust panic -> unreachable)
// leaves the instance's shadow stack pointer unrestored, so after any trap
// the instance is recreated.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
export const wasmPath = process.env.FASTBROTLI_WASM || join(here, "../fastbrotli.wasm");
const wasmModule = new WebAssembly.Module(readFileSync(wasmPath));

let ex = null;
function inst() {
  if (!ex) ex = new WebAssembly.Instance(wasmModule, {}).exports;
  return ex;
}

// Runs export `name` on `input`; returns { ok, bytes } or { ok:false, err }
// (err = the reference's UTF-8 error text) or { trap: message }.
export function call(name, input, arg) {
  const e = inst();
  const n = input.length;
  const padding = name === "decompress_fast_padded" ? 8 : 0;
  const p = e.alloc(n + padding);
  new Uint8Array(e.memory.buffer, p, n).set(input);
  if (padding) new Uint8Array(e.memory.buffer, p + n, padding).fill(0);
  let r;
  try {
    r = arg === undefined ? e[name](p, n) : e[name](p, n, arg);
  } catch (err) {
    ex = null;
    return { ok: false, trap: String(err && err.message || err) };
  }
  const h = new Uint32Array(e.memory.buffer, e.hdr(), 2);
  const out = new Uint8Array(e.memory.buffer, h[0], h[1]).slice();
  e.release();
  e.free(p, n + padding);
  if (r === -1) return { ok: false, bail: true };
  return r === 0 ? { ok: true, bytes: out } : { ok: false, err: new TextDecoder().decode(out) };
}

// raw call without copying the result (benchmarks); returns the status
export function callRaw(name, p, n) {
  const e = inst();
  const r = e[name](p, n);
  e.release();
  return r;
}
export function exportsNow() {
  return inst();
}

export const fastDecode = (b) => call(inst().decompress_fast_padded ? "decompress_fast_padded" : "decompress_fast", b);
export const fastOnly = (b) => call("decompress_fast_only", b);
export const refDecode = (b) => call("decompress", b);
export const wasmCompress = (b, q) => call("compress", b, q);

// brotli-wasm@3.0.1 from node_modules (the package we replace)
const require = createRequire(import.meta.url);
export const brotliWasm = require("brotli-wasm");
export function origDecode(b) {
  try {
    return { ok: true, bytes: brotliWasm.decompress(b) };
  } catch (err) {
    if (err instanceof WebAssembly.RuntimeError) return { ok: false, trap: err.message };
    return { ok: false, err: typeof err === "string" ? err : String(err && err.message || err) };
  }
}

export function eqBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// same outcome: identical bytes, identical error text, or both trapped
export function sameOutcome(a, b) {
  if (a.ok !== b.ok) return false;
  if (a.ok) return eqBytes(a.bytes, b.bytes);
  if (a.trap !== undefined || b.trap !== undefined) return a.trap !== undefined && b.trap !== undefined;
  return a.err === b.err;
}

export const describe = (o) => (o.ok ? `ok(${o.bytes.length})` : o.trap !== undefined ? `trap(${o.trap})` : `err(${o.err})`);
