// API parity: @r1ck404/fast-brotli-wasm vs brotli-wasm 3.0.1 through the public API
// (CommonJS Node entry and the ESM web entry): results, thrown values (type,
// message), console output of panics, object shapes and stream behaviour.
// usage: node packages/fast-brotli-wasm/test/api.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomBytes, jsonText } from "../../../bench/corpus.mjs";

const require = createRequire(import.meta.url);
const O = require("brotli-wasm");
const F = require("../index.node.cjs");
const Fweb = await import("../pkg.web.mjs");
await Fweb.default(readFileSync(new URL("../fastbrotli.wasm", import.meta.url)));

let checks = 0, failures = 0;
function describe(fn) {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(" ").split("\n")[0]);
  let r;
  try {
    const v = fn();
    r = { ok: ser(v) };
  } catch (e) {
    r = { threw: typeof e === "string" ? "string:" + e : `${e?.constructor?.name}:${e?.message}` };
  } finally {
    console.error = orig;
  }
  if (logged.length) r.console = logged;
  return JSON.stringify(r);
}
function ser(v) {
  if (v instanceof Uint8Array) return { u8: Buffer.from(v).toString("base64"), ctor: v.constructor.name };
  if (v && typeof v === "object") {
    const o = { keys: Object.keys(v), proto: Object.getOwnPropertyNames(Object.getPrototypeOf(v)).sort() };
    for (const k of ["code", "input_offset"]) if (k in v) o[k] = v[k];
    if ("buf" in v) o.buf = ser(v.buf);
    return o;
  }
  return v;
}
function same(label, fo, ff) {
  checks++;
  const a = describe(fo), b = describe(ff);
  if (a !== b) {
    failures++;
    console.log("MISMATCH", label, "\n  orig:", a.slice(0, 300), "\n  fast:", b.slice(0, 300));
  }
}

const text = new TextEncoder().encode("hello hello hello brotli " + jsonText(20000));
const inputs = {
  empty: new Uint8Array(0),
  byte: new Uint8Array([7]),
  text,
  random: randomBytes(5000),
  buffer: Buffer.from("buffer input ".repeat(50)),
  array: [1, 2, 3, 300, -1, 2.7, "5", null],
  string: "not bytes",
  int16: new Int16Array([1, 2, 300, -5]),
  arraylike: { length: 3, 0: 65, 1: 66 },
};
const options = [undefined, {}, { quality: 0 }, { quality: 5 }, { quality: 9 }, { quality: 11 }, { quality: -3 }, { quality: 15 }, { quality: 2 ** 31 }, { quality: 1.5 }, { quality: "5" }, { quality: null }, { other: 1, quality: 4 }, [], [3], [3, 4], null, 5, "x", () => 1, { toJSON: () => 6 }, { toJSON: () => ({ quality: 2 }) }, { toJSON: () => undefined }, new Date(0), { quality: 1e21 }];

for (const [name, inp] of Object.entries(inputs)) {
  for (const opt of options) {
    const q = opt && typeof opt === "object" && typeof opt.quality === "number" && opt.quality >= 10;
    if (q && inp.length > 10000) continue;
    same(`compress(${name}, ${JSON.stringify(opt) ?? String(opt)})`, () => O.compress(inp, opt), () => F.compress(inp, opt));
  }
  same(`web compress(${name})`, () => O.compress(inp, { quality: 4 }), () => Fweb.compress(inp, { quality: 4 }));
}
same("compress(undefined)", () => O.compress(undefined), () => F.compress(undefined));
same("compress(null)", () => O.compress(null), () => F.compress(null));

// decompress: valid streams, corrupt, truncated, junk, non-bytes
const valid = [O.compress(text, { quality: 5 }), O.compress(text), O.compress(new Uint8Array(0)), O.compress(randomBytes(3000), { quality: 1 })];
const bad = [new Uint8Array(0), new Uint8Array([0]), new Uint8Array([255, 255, 255]), valid[0].slice(0, 20), randomBytes(100), new Uint8Array([...valid[2], 1, 2, 3]), [0x0b, 0x02, 0x80, 0x68, 0x69, 0x03], "abc", undefined];
for (const [i, v] of [...valid, ...bad].entries()) {
  same(`decompress #${i}`, () => O.decompress(v), () => F.decompress(v));
  if (v !== undefined) same(`web decompress #${i}`, () => O.decompress(v), () => Fweb.decompress(v));
}

// streams
function compressStream(M, data, quality, chunk, outSize) {
  const s = quality === undefined ? new M.CompressStream() : new M.CompressStream(quality);
  const out = [];
  const log = [];
  let off = 0;
  while (off < data.length) {
    const r = s.compress(data.subarray(off, off + chunk), outSize);
    log.push([r.code, r.input_offset, r.buf.length]);
    out.push(r.buf);
    off += r.input_offset;
    r.free();
  }
  for (let i = 0; i < 1000; i++) {
    const r = s.compress(undefined, outSize);
    log.push([r.code, r.input_offset, r.buf.length]);
    out.push(r.buf);
    const code = r.code;
    r.free();
    if (code === M.BrotliStreamResultCode.ResultSuccess) break;
  }
  log.push(["total_out", s.total_out()]);
  s.free();
  return { log, out: Buffer.concat(out).toString("base64") };
}
function decompressStream(M, data, chunk, outSize) {
  const s = new M.DecompressStream();
  const out = [];
  const log = [];
  let off = 0;
  for (let i = 0; i < 100000; i++) {
    const r = s.decompress(data.subarray(off, off + chunk), outSize);
    log.push([r.code, r.input_offset, r.buf.length]);
    out.push(r.buf);
    off += r.input_offset;
    const code = r.code;
    r.free();
    if (code === M.BrotliStreamResultCode.ResultSuccess) break;
    if (code === M.BrotliStreamResultCode.NeedsMoreInput && off >= data.length) break;
  }
  log.push(["total_out", s.total_out()]);
  s.free();
  return { log, out: Buffer.concat(out).toString("base64") };
}
for (const q of [undefined, 0, 4, 9, 11, 20])
  for (const [chunk, outSize] of [[100000, 100000], [1000, 64], [7, 3], [4096, 1]]) {
    const data = q === 11 ? text.subarray(0, 20000) : text;
    same(`CompressStream q${q} chunk ${chunk} out ${outSize}`, () => compressStream(O, data, q, chunk, outSize), () => compressStream(F, data, q, chunk, outSize));
  }
for (const [i, v] of [...valid, ...bad.filter((b) => b instanceof Uint8Array)].entries())
  for (const [chunk, outSize] of [[100000, 1 << 20], [3, 5], [1, 100]])
    same(`DecompressStream #${i} chunk ${chunk} out ${outSize}`, () => decompressStream(O, v, chunk, outSize), () => decompressStream(F, v, chunk, outSize));

// shapes
same("CompressStream shape", () => { const s = new O.CompressStream(5); const r = ser(s); s.free(); return Object.keys(r); }, () => { const s = new F.CompressStream(5); const r = ser(s); s.free(); return Object.keys(r); });
for (const code of [-1, 2, 3.9, "3", 0]) {
  const setters = (M) => () => {
    const s = new M.DecompressStream();
    const r = s.decompress(valid[0], 10);
    r.code = code;
    r.input_offset = 5.7;
    r.buf = [1, 2, 300];
    return [r.code, r.input_offset, Array.from(r.buf)];
  };
  same(`BrotliStreamResult setters code=${code}`, setters(O), setters(F));
}
// (brotli-wasm's CommonJS module also exposes its wasm-bindgen import
// functions, __wbindgen_* / __wbg_*; those are internals)
const publicKeys = (M) => Object.keys(M).filter((k) => !k.startsWith("__")).sort();
same("module keys", () => publicKeys(O), () => publicKeys(F));
same("web module keys", () => publicKeys(O), () => publicKeys(Fweb).filter((k) => k !== "default").concat("default").sort());
same("BrotliStreamResultCode", () => O.BrotliStreamResultCode, () => F.BrotliStreamResultCode);
same("default export", () => typeof O.default.then, () => typeof F.default.then);

console.log(`checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
