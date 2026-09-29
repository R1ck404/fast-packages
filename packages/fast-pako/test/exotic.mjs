// Differential fuzz of what pako does with unusual values: options of every
// type and value (strings, fractions, NaN, arrays, booleans, out of range,
// odd windowBits), inputs that are not Uint8Arrays (other typed arrays,
// plain arrays with values > 255, negatives and non-numbers, strings,
// DataViews, ArrayBuffers, array-likes, ...), gzip header fields and
// dictionaries of odd types, and pushes of such values mid-stream.
// fast-pako (which has no copy of pako) against pako 2.1.0 from node_modules:
// return values, thrown values (type and message), every onData chunk (and
// the stream fields onData sees), every observable field after every push,
// the options object afterwards. Cases where pako never returns are not
// generated (they are pinned in the "documented" section at the end, with
// the other documented differences, see README "Differences").
//   node packages/fast-pako/test/exotic.mjs [--quick] [--seed=N]
import pako from "pako";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadJs, utf8, randomBytes } from "../../../bench/corpus.mjs";
const fast = (await import(process.env.FASTPAKO_IMPL ? pathToFileURL(resolve(process.env.FASTPAKO_IMPL)).href : "../index.mjs")).default;

const QUICK = process.argv.includes("--quick");
const seedArg = process.argv.find((a) => a.startsWith("--seed="));
let seed = seedArg ? Number(seedArg.slice(7)) >>> 0 || 1 : 0x51f15e;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const ri = (n) => Math.floor(rnd() * n);
const pick = (a) => a[ri(a.length)];

let failures = 0, checks = 0, documented = 0;
const fail = (m) => { failures++; if (failures <= 40) console.log("FAIL:", m); };

// ------------------------------------------------------------ showing values
function hash(u8) { let h = 0x811c9dc5; for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
function show(v, d = 0) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "undefined") return "undefined";
  if (t === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (t === "bigint") return v + "n";
  if (t === "boolean") return String(v);
  if (t === "symbol") return "symbol";
  if (t === "function") return "fn";
  if (t === "string") return v.length > 200 ? "str" + v.length + ":" + hash(utf8(v)) : JSON.stringify(v);
  if (ArrayBuffer.isView(v)) {
    if (v instanceof DataView) return "DataView" + v.byteLength;
    const a = Array.from(v, (x) => (typeof x === "bigint" ? x + "n" : Object.is(x, -0) ? "-0" : String(x)));
    const body = a.length > 300 ? a.length + ":" + hash(utf8(a.join(","))) : a.join(",");
    return `${v.constructor.name}[${body}]@${v.byteOffset}/${v.buffer.byteLength}`;
  }
  if (v instanceof ArrayBuffer) return "AB" + v.byteLength;
  if (d > 2) return "…";
  if (Array.isArray(v)) return "[" + (v.length > 50 ? v.length + ":" + hash(utf8(v.map((x) => show(x, d + 1)).join(","))) : v.map((x) => show(x, d + 1)).join(",")) + "]";
  if (t === "object") return "{" + Object.keys(v).map((k) => k + ":" + show(v[k], d + 1)).join(",") + "}";
  return String(v);
}
const errStr = (e) => (e instanceof Error ? e.constructor.name + ": " + e.message : "thrown " + typeof e + ": " + String(e));
const isDoc = (s) => s.includes("fast-pako:");
const docKinds = {};
const docHit = (s) => { documented++; const k = s.slice(s.indexOf("fast-pako:") + 11).split(" ").slice(0, 2).join(" "); docKinds[k] = (docKinds[k] || 0) + 1; };
// TRACE=1: name each case before running it (to find a case that never returns)
let tlast = Date.now();
const trace = process.env.TRACE ? (s) => { const now = Date.now(); process.stderr.write((now - tlast) + "ms before | " + s + String.fromCharCode(10)); tlast = now; } : () => {};

// the fields of a stream object a caller can see (not strm.output: pako's
// working buffer, and strm.state only as present or not; see README)
function fields(o) {
  const s = o.strm;
  const out = [`err=${show(o.err)} msg=${show(o.msg)} ended=${o.ended} chunks=${o.chunks && o.chunks.length} result=${show(o.result)}`,
    `strm ${show(s.next_in)} ${show(s.avail_in)} ${show(s.total_in)} ${show(s.next_out)} ${show(s.avail_out)} ${show(s.total_out)} ${show(s.msg)} ${show(s.data_type)} ${show(s.adler)} state=${s.state === null ? "null" : typeof s.state} input=${show(s.input)}`,
    `opts ${show(o.options)} dict_set=${show(o._dict_set)}`];
  const h = o.header;
  if (h) out.push(`hdr ${show(h.text)} ${show(h.time)} ${show(h.xflags)} ${show(h.os)} ${show(h.extra)} ${show(h.extra_len)} ${show(h.name)} ${show(h.comment)} ${show(h.hcrc)} ${show(h.done)}`);
  return out.join(" | ");
}

// run a stream: constructor, pushes (each [data, flush]), logging everything
function streamLog(P, Cls, mkOpts, pieces, liveOnData) {
  const log = [];
  trace((P === pako ? "pako " : "fast ") + Cls + " " + show(mkOpts()) + " " + pieces.map(([mk, f]) => show(mk()).slice(0, 40) + "/" + show(f)).join(" "));
  let o;
  try { o = new P[Cls](mkOpts()); } catch (e) { return "ctor " + errStr(e); }
  log.push("init " + fields(o));
  if (liveOnData) {
    o.onData = function (c) { log.push("data " + show(c) + " :: " + fields(this)); this.chunks.push(c); };
  } else {
    const od = o.onData;
    o.onData = function (c) { log.push("data " + show(c)); od.call(this, c); };
  }
  for (const [mk, flush] of pieces) {
    let r;
    try { r = o.push(mk(), flush); } catch (e) { log.push("push threw " + errStr(e) + " :: " + fields(o)); break; }
    log.push("push " + show(r) + " :: " + fields(o));
  }
  return log.join("\n");
}
function oneShot(P, fn, mkInput, mkOpts) {
  const opts = mkOpts();
  trace((P === pako ? "pako " : "fast ") + fn + " " + show(opts) + " " + show(mkInput()).slice(0, 80));
  let r;
  try { r = "ok " + show(P[fn](mkInput(), opts)); } catch (e) { r = "threw " + errStr(e); }
  return r + " | opts " + show(opts);
}
// the two strings around their first difference
function diffAt(a, b) {
  let j = 0;
  while (j < a.length && a[j] === b[j]) j++;
  const f = Math.max(0, j - 150);
  return `
  pako @${j} ${a.slice(f, j + 150)}
  fast @${j} ${b.slice(f, j + 150)}`;
}
function compare(label, a, b, docOk) {
  checks++;
  if (a === b) return;
  const la = a.split("\n"), lb = b.split("\n");
  let i = 0;
  while (i < la.length && la[i] === lb[i]) i++;
  const fb = String(lb[i]);
  if (isDoc(fb) && docOk) { documented++; return; }
  fail(`${label} line ${i}:${diffAt(String(la[i]), fb)}`);
}

// ------------------------------------------------------------ data
const js = loadJs(true);
const text = utf8(js.find((f) => f.name.includes("zod-schemas")).code);
const texts = [text.subarray(0, 3000), text.subarray(5000, 5300), utf8("hello hello hello hello"), new Uint8Array(0), randomBytes(2000, 3), new Uint8Array(1500).fill(97)];

// value pools; functions make a fresh value per implementation
const obj3 = () => ({ valueOf() { return 3; }, toString() { return "3"; } });
const LEVEL = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, -2, "5", "0", "9", "6", "-1", "1", 5.5, 0.5, 9.5, 6.0, NaN, null, undefined, true, false, [5], [0], "length", "map", "abc", " 5", "05", obj3, Infinity, -0];
const WBITS = [8, 9, 10, 12, 15, -9, -10, -15, 25, 31, 7, 16, 32, -8, 0, "9", "15", "12", 9.5, 10.5, 15.5, -9.5, 25.5, NaN, null, undefined, true, [12], "abc", "-10", -15.5, 23, 24, 31.9, 47, 48, -16];
const MEM = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 10, -1, "1", "4", "7", 1.5, 8.9, 9.5, true, [1], [7], NaN, null, undefined, "abc", 2.5];
const STRAT = [0, 1, 2, 3, 4, -1, 5, "1", "2", "3", "4", 1.5, 2.5, 3.5, NaN, null, undefined, true, [2], "abc", 0.5];
const METHOD = [8, "8", 8.0, 7, 9, null, undefined, [8], true];
const CHUNK = [1, 2, 5, 7, 16, 63, 64, 100, 1000, 16384, 65536, 200.0, 3, 6, 4096];
const INF_WBITS = [0, 8, 9, 10, 12, 15, 16, 24, 31, 32, 40, 47, 48, -8, -9, -12, -15, -16, 7, "15", "12", "0", 9.5, -9.5, -12.5, 15.5, NaN, null, undefined, true, false, [15], "abc", "-10", Infinity, -Infinity, 1e3];
const bytes = (n, s = 1) => () => randomBytes(n, s);
const DICT_ANY = ["", "dict", "the quick brown fox jumps", () => "abc ".repeat(2000), () => new Uint8Array(0), bytes(500), bytes(40000, 9),
  () => Uint16Array.from([1, 2, 300, 65535, 7, 0]), () => new Float32Array([1.5, -1, 300, NaN, 2.7, -0.5]), () => new Int8Array([-1, -128, 5, 127, 0]),
  () => new Float64Array([0.5, 1e10, -3.25, Infinity, 7]), () => text.slice(0, 700).buffer, () => Buffer.from(utf8("buffer dictionary").buffer),
  () => new Uint8ClampedArray([1, 255, 0, 9]), () => "ü✓ unicode dict", () => new Uint16Array(40000).fill(7)];
// no numeric length / not a typed array: only where pako does not loop
const DICT_ODD = [() => [1, 2, 3], () => [300, -1, "7", null], () => ({ length: 0 }), () => [], () => ({ length: 2, 0: 5, 1: 6 }), () => new BigInt64Array(2),
  () => 5, () => true, () => new DataView(new ArrayBuffer(8)), () => ({}), () => [1.5, 2.5]];
const HEADER_FIELDS = {
  text: [true, false, 1, 0, "", "x", null, undefined],
  time: [0, 1, 123456789, -5, 2 ** 32 + 7, 2 ** 31, 1.9, -1.5, "1234", NaN, null, undefined, Infinity, [5], () => 10n, obj3],
  os: [0, 3, 7, 255, 300, -1, "12", 1.5, null, undefined, NaN, () => 10n],
  extra: [() => [], () => [1, 2, 3], () => [300, -1, 1.5, "7", null, "x", true], bytes(300), () => Uint16Array.from([1, 300, 70000 & 0xffff]), () => new Float32Array([1.5, -2, 256.5]),
    "abc", "5", 5, () => ({ length: 3, 0: 1 }), () => ({ length: "4", 0: 9, 1: 8 }), () => new ArrayBuffer(10), () => new DataView(new ArrayBuffer(6)), null, undefined, true,
    bytes(70000, 4), () => new BigInt64Array(2), bytes(600, 5), () => Array.from({ length: 700 }, (_, i) => i), () => ({ length: 1e6 })],
  name: ["", "file.txt", "näme", "a\u0000b", "✓ unicode ☃", () => "x".repeat(70000), 5, () => ["a"], () => new String("abc"), null, undefined, true, () => ({ length: 2, charCodeAt: (i) => 65 + i }), "Āā"],
  comment: ["", "a comment", "c\u0000d", () => "y".repeat(2000), 7, () => ["b"], null, undefined, () => new String("zz")],
  hcrc: [true, false, 1, 0, "", null, undefined],
};
const val = (x) => (typeof x === "function" ? x() : x);
function mkHeader() {
  if (rnd() < 0.08) { const v = pick([true, 5, "abc", () => [], () => ({})]); return () => val(v); }
  const keys = Object.keys(HEADER_FIELDS).filter(() => rnd() < 0.6);
  const vals = keys.map((k) => pick(HEADER_FIELDS[k]));
  return () => { const h = {}; keys.forEach((k, i) => { h[k] = val(vals[i]); }); return h; };
}

// deflate options: a factory of fresh option objects
function mkDeflateOpts() {
  if (rnd() < 0.04) { const v = pick([undefined, null, 0, "", "abc", 5, true]); return () => v; }
  const spec = [];
  const add = (k, pool, p) => { if (rnd() < p) spec.push([k, pick(pool)]); };
  add("level", LEVEL, 0.6);
  add("windowBits", WBITS, 0.35);
  add("memLevel", MEM, 0.3);
  add("strategy", STRAT, 0.3);
  add("method", METHOD, 0.15);
  add("chunkSize", CHUNK, 0.3);
  if (rnd() < 0.25) spec.push(["raw", pick([true, 1, "yes", false, 0])]);
  if (rnd() < 0.3) spec.push(["gzip", pick([true, 1, false])]);
  if (rnd() < 0.3) spec.push(["header", mkHeader()]);
  if (rnd() < 0.25) {
    const oddDict = rnd() < 0.3;
    spec.push(["dictionary", pick(oddDict ? DICT_ODD : DICT_ANY)]);
    // (a dictionary without a numeric length makes pako's zlib adler32 loop
    // forever: those only with gzip or raw)
    if (oddDict) spec.push(rnd() < 0.5 ? ["raw", true] : ["gzip", true]);
  }
  return () => { const o = {}; for (const [k, v] of spec) o[k] = k === "header" ? v() : val(v); return o; };
}
function mkInflateOpts(base) {
  const spec = Object.entries(base || {});
  const add = (k, pool, p) => { if (rnd() < p) spec.push([k, pick(pool)]); };
  add("windowBits", INF_WBITS, 0.3);
  add("chunkSize", CHUNK, 0.35);
  if (rnd() < 0.3) spec.push(["to", pick(["string", "", "String", null])]);
  if (rnd() < 0.15) spec.push(["raw", pick([true, false, 1])]);
  if (rnd() < 0.2) spec.push(["dictionary", pick(DICT_ANY)]);
  return () => { const o = {}; for (const [k, v] of spec) o[k] = val(v); return o; };
}

// inputs to deflate that are not plain byte arrays (factories)
function mkDeflateInput() {
  const src = pick(texts);
  const k = ri(17);
  const b = src.slice(0, ri(src.length + 1));
  switch (k) {
    case 0: return () => new TextDecoder().decode(b);
    case 1: { const k = ri(50); return () => "x\uD800y\uDFFFz" + "é".repeat(k); }
    case 2: return () => Uint16Array.from(b, (x, i) => (i % 7 ? x : x + 256 * (i % 3)));
    case 3: return () => Float64Array.from(b, (x, i) => (i % 5 ? x : i % 2 ? x + 0.5 : -x));
    case 4: return () => Int8Array.from(b);
    case 5: return () => new Float32Array([NaN, Infinity, -Infinity, -0, 1e10, ...b.subarray(0, 50)]);
    case 6: return () => Array.from(b);
    case 7: return () => [];
    case 8: return () => ({ length: 0 });
    case 9: return () => new DataView(b.slice().buffer);
    case 10: return () => b.slice().buffer;
    case 11: return () => new Uint8ClampedArray(b);
    case 12: return () => Buffer.from(b.slice().buffer);
    case 13: { const n = ri(3); return () => new BigInt64Array(n); }
    case 14: { const v = pick([5, true, 0, null, undefined]); return () => (v === 0 ? {} : v); }
    case 15: return () => Uint32Array.from(b, (x) => x * 16777217);
    default: { const k = ri(3); return () => new Uint8Array(b.buffer, b.byteOffset, b.length).subarray(k); }
  }
}

// compressed samples, then the same bytes as values pako reads differently
const samples = [];
{
  const d = text.subarray(0, 4000);
  samples.push(["zlib", pako.deflate(d), {}]);
  samples.push(["zlib L0", pako.deflate(d, { level: 0 }), {}]);
  samples.push(["raw", pako.deflateRaw(d), { raw: true }]);
  samples.push(["raw stored", pako.deflateRaw(d.subarray(0, 700), { level: 0 }), { raw: true }]);
  samples.push(["gzip", pako.gzip(d), {}]);
  samples.push(["gzip hdr", pako.gzip(d.subarray(0, 2000), { header: { name: "file.name", comment: "a comment", extra: [1, 2, 3, 4, 5], hcrc: true, time: 99999, os: 9, text: true } }), {}]);
  samples.push(["gzip x2", (() => { const a = pako.gzip(d.subarray(0, 500)), b = pako.gzip(d.subarray(500, 900), { header: { name: "second", extra: [9, 9] } }); const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; })(), {}]);
  samples.push(["zlib dict", pako.deflate(d.subarray(0, 1000), { dictionary: "the quick brown fox jumps" }), { dictionary: "the quick brown fox jumps" }]);
  samples.push(["zlib fixed", pako.deflate(d.subarray(0, 300), { strategy: 4 }), {}]);
  samples.push(["zlib L9 wb9", pako.deflate(randomBytes(3000, 5).map((x) => x & 7), { level: 9, windowBits: 9 }), {}]);
  samples.push(["empty gzip", pako.gzip(new Uint8Array(0)), {}]);
}
function mkInflateInput(c) {
  const k = ri(16);
  const mut = (arr, f, p) => { for (let i = 0; i < arr.length; i++) if (rnd() < p) arr[i] = f(arr[i], i); return arr; };
  switch (k) {
    case 0: { const a = Array.from(c); return () => a.slice(); }
    case 1: { const a = Uint16Array.from(c); return () => a.slice(); }
    case 2: { const a = mut(Uint16Array.from(c), (x) => x + 256 * (1 + ri(200)), 0.02 + rnd() * 0.1); return () => a.slice(); }
    case 3: { const a = Int8Array.from(c); return () => a.slice(); }
    case 4: { const a = mut(Float64Array.from(c), (x) => x + pick([0.5, 0.25, -0.5, 1e10, NaN, Infinity, -1]), 0.05); return () => a.slice(); }
    case 5: { const vals = mut(Array.from(c), (x) => pick([String(x), "a", null, undefined, true, false, x + 256, -x, x + 0.5, [x], obj3()]), 0.03); return () => vals.slice(); }
    case 6: { const s = String.fromCharCode(...c.subarray(0, 60000)); return () => s; }
    case 7: { const s = String.fromCharCode(...mut(Array.from(c.subarray(0, 60000)), (x) => x + 256 * ri(100), 0.03)); return () => s; }
    case 8: { const a = Array.from(c); return () => { const o = { length: a.length }; a.forEach((x, i) => { o[i] = x; }); return o; }; }
    case 9: { const a = Array.from(c), k = ri(3); return () => { const x = a.slice(); x.length += k; return x; }; }
    case 10: { const a = Int32Array.from(c, (x) => (rnd() < 0.02 ? x - 256 * ri(3) : x)); return () => a.slice(); }
    case 11: return () => new Uint8ClampedArray(c);
    case 12: return () => new DataView(c.slice().buffer);
    case 13: { const v = pick([0, false, NaN, "", 5, true, 1]); return () => (v === 1 ? {} : v); }
    case 14: { const a = mut(Array.from(c), () => 0, 0.01); return () => a.slice(); }
    default: { const a = Float32Array.from(c); return () => a.slice(); }
  }
}

// ------------------------------------------------------------ one-shot calls
const N1 = QUICK ? 500 : 3000;
for (let t = 0; t < N1; t++) {
  const fn = pick(["deflate", "deflateRaw", "gzip"]);
  const mkOpts = mkDeflateOpts();
  const mkIn = mkDeflateInput();
  const b = oneShot(fast, fn, mkIn, mkOpts);
  // (where fast-pako reports a documented difference pako may never return)
  if (isDoc(b)) { docHit(b); continue; }
  const a = oneShot(pako, fn, mkIn, mkOpts);
  compare(`${fn}#${t} ${show(mkOpts())} in ${show(mkIn()).slice(0, 60)}`, a, b, false);
}
for (let t = 0; t < N1; t++) {
  const [name, c, base] = pick(samples);
  const fn = base.raw ? "inflateRaw" : pick(["inflate", "ungzip", "inflate"]);
  const mkOpts = mkInflateOpts(base.raw ? {} : base);
  const mkIn = rnd() < 0.15 ? (() => { const x = c.slice(); return () => x; })() : mkInflateInput(c);
  const b = oneShot(fast, fn, mkIn, mkOpts);
  if (isDoc(b)) { docHit(b); continue; }
  const a = oneShot(pako, fn, mkIn, mkOpts);
  compare(`${fn}#${t} ${name} ${show(mkOpts())} in ${show(mkIn()).slice(0, 60)}`, a, b, false);
}

// ------------------------------------------------------------ streams
const NS = QUICK ? 150 : 900;
for (let t = 0; t < NS; t++) {
  const mkOpts = mkDeflateOpts();
  let o0;
  try { o0 = mkOpts(); } catch { o0 = {}; }
  const cs = o0 && typeof o0 === "object" && "chunkSize" in o0 ? +o0.chunkSize : 16384;
  const pieces = [];
  const n = 1 + ri(6);
  for (let i = 0; i < n; i++) {
    const mk = mkDeflateInput();
    let flush = pick([0, 0, 1, 2, 3, 4, 5, false, true, undefined, 1.5, "2"]);
    let v;
    try { v = mk(); } catch { v = null; }
    const L = v == null ? 0 : v.length;
    // (pako never returns from invalid flush modes with input, falsy input,
    // or SYNC/FULL flushes into chunks of 6 bytes or less)
    if ((flush === 2 || flush === 3 || flush === "2") && cs <= 6) flush = 0;
    if (v === 0 || v === false || (typeof v === "number" && v !== v)) continue;
    pieces.push([mk, flush]);
    void L;
  }
  pieces.push([() => new Uint8Array(0), pick([true, 4, 2, 0])]);
  const live = rnd() < 0.5;
  const b = streamLog(fast, "Deflate", mkOpts, pieces, live);
  if (isDoc(b)) { docHit(b); continue; }
  const a = streamLog(pako, "Deflate", mkOpts, pieces, live);
  compare(`Deflate stream #${t} ${show(mkOpts())}`, a, b, false);
}
for (let t = 0; t < NS; t++) {
  const [name, c, base] = pick(samples);
  const mkOpts = mkInflateOpts(base);
  const whole = mkInflateInput(c);
  const w0 = whole();
  // split the chosen representation into pushes (typed arrays: subarrays;
  // arrays / array-likes / strings: slices)
  const pieces = [];
  const len = w0 == null || typeof w0 !== "object" && typeof w0 !== "string" ? 0 : w0.length >>> 0;
  if (!(typeof len === "number" && len > 0) || rnd() < 0.1) pieces.push([whole, pick([0, 2, 4, true])]);
  else {
    let p = 0;
    while (p < len) {
      const q = Math.min(len, p + 1 + (rnd() < 0.5 ? ri(8) : ri(1500)));
      const [s0, s1] = [p, q];
      pieces.push([() => { const w = whole(); return typeof w === "string" || Array.isArray(w) ? w.slice(s0, s1) : ArrayBuffer.isView(w) ? w.subarray(s0, s1) : Array.prototype.slice.call(w, s0, s1); }, pick([0, 0, 0, 2, 3, 4, 5, 6, false, true])]);
      p = q;
    }
  }
  const live = rnd() < 0.5;
  const b = streamLog(fast, "Inflate", mkOpts, pieces, live);
  if (isDoc(b)) { docHit(b); continue; }
  const a = streamLog(pako, "Inflate", mkOpts, pieces, live);
  compare(`Inflate stream #${t} ${name} ${show(mkOpts())} in ${show(w0).slice(0, 50)}`, a, b, false);
}

// ------------------------------------------------------------ targeted cases
{
  const good = pako.deflate(text.subarray(0, 2000));
  const cases = [
    // Uint8Array subclass and cross-kind typed arrays
    ["Inflate BigInt64Array", (P) => { const i = new P.Inflate(); try { i.push(new BigInt64Array(3), true); } catch (e) { return errStr(e) + " " + fields(i); } return fields(i); }],
    ["deflate BigInt64Array", (P) => P.deflate(new BigInt64Array(2))],
    ["deflate BigUint64Array empty", (P) => P.deflate(new BigUint64Array(0))],
    ["inflate DataView", (P) => P.inflate(new DataView(good.slice().buffer))],
    ["inflate SharedArrayBuffer", (P) => { const sab = new SharedArrayBuffer(good.length); new Uint8Array(sab).set(good); return P.inflate(sab); }],
    ["deflate SharedArrayBuffer", (P) => P.deflate(new SharedArrayBuffer(8))],
    ["inflate number", (P) => P.inflate(5)],
    ["inflate 0", (P) => P.inflate(0)],
    ["inflate ''", (P) => P.inflate("")],
    ["inflate null", (P) => P.inflate(null)],
    ["deflate undefined", (P) => P.deflate(undefined)],
    ["deflate symbol level", (P) => P.deflate("x", { level: Symbol() })],
    ["Deflate level 'length' push", (P) => { const d = new P.Deflate({ level: "length" }); try { d.push("abc", true); } catch (e) { return errStr(e) + " " + fields(d); } return fields(d); }],
    ["Deflate level 'length' huffman", (P) => { const d = new P.Deflate({ level: "length", strategy: 2 }); d.push(text.subarray(0, 3000), true); return fields(d); }],
    ["Deflate level 'map' rle", (P) => { const d = new P.Deflate({ level: "map", strategy: 3 }); d.push(text.subarray(0, 3000), true); return fields(d); }],
    ["Deflate level '0' huffman", (P) => { const d = new P.Deflate({ level: "0", strategy: 2 }); d.push(text.subarray(0, 3000), true); return fields(d); }],
    ["deflate memLevel '1'", (P) => P.deflate(text, { memLevel: "1" })],
    ["deflate memLevel '4' L9", (P) => P.deflate(text, { memLevel: "4", level: 9 })],
    ["deflate memLevel '7'", (P) => P.deflate(text, { memLevel: "7" })],
    ["deflate memLevel '8' L1", (P) => P.deflate(text.subarray(0, 20000), { memLevel: "8", level: 1 })],
    ["deflate memLevel [7] gzip", (P) => P.gzip(text, { memLevel: [7] })],
    ["gzip header throws at time (BigInt), stream", (P) => { const d = new P.Deflate({ gzip: true, header: { time: 5n } }); let r = ""; for (let k = 0; k < 2; k++) { try { d.push("abc", k === 1); } catch (e) { r += errStr(e) + ";"; } } return r; }],
    ["gzip header name array: exception, then pako resumes the header", (P) => { const d = new P.Deflate({ gzip: true, header: { name: ["x"], comment: "c", hcrc: true } }); const r = []; for (let k = 0; k < 3; k++) { try { d.push("abc" + k, k === 2); r.push("ok " + fields(d)); } catch (e) { r.push(errStr(e) + " " + fields(d)); } } return r.join(" || "); }],
    ["gzip header extra fixed after an exception", (P) => { const h = { extra: [1, 2], time: 7n, name: "n" }; const d = new P.Deflate({ gzip: true, header: h }); const r = []; for (let k = 0; k < 3; k++) { try { d.push("abc", k === 2); r.push("ok"); } catch (e) { r.push(errStr(e)); h.time = 9; } } return r.join() + " " + fields(d); }],
    ["gzip header plain-array extra near the pending size, memLevel 1", (P) => { const d = new P.Deflate({ gzip: true, memLevel: 1, header: { extra: Array.from({ length: 505 }, (_, i) => i & 255) } }); const r = []; for (let k = 0; k < 3; k++) { try { d.push("abc", k === 2); r.push("ok"); } catch (e) { r.push(errStr(e)); } } return r.join() + " " + fields(d); }],
    ["gzip header name array", (P) => P.gzip("abc", { header: { name: ["a"] } })],
    ["gzip header extra wraps, memLevel 1, plain array", (P) => P.gzip("abc", { memLevel: 1, header: { extra: Array.from({ length: 600 }, (_, i) => i) } })],
    ["gzip header extra wraps, memLevel 1, Uint16Array", (P) => P.gzip("abc", { memLevel: 1, header: { extra: Uint16Array.from({ length: 900 }, (_, i) => i), hcrc: true, name: "n".repeat(700), comment: "c".repeat(300) }, chunkSize: 100 })],
    ["gzip header long name memLevel 1 small chunks", (P) => { const d = new P.Deflate({ gzip: true, memLevel: 1, chunkSize: 64, header: { name: "q".repeat(3000), hcrc: true } }); const log = []; d.onData = function (c) { log.push(c.length + ":" + this.strm.adler + ":" + this.strm.total_out); this.chunks.push(c); }; d.push("x", true); return log.join(",") + " " + fields(d); }],
    ["multi-member gzip with growing extra (pako reuses the buffer)", (P) => { const a = pako.gzip("a", { header: { extra: [1, 2] } }), b = pako.gzip("b", { header: { extra: [3, 4, 5, 6, 7] } }); const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); const i = new P.Inflate(); try { i.push(o, true); } catch (e) { return errStr(e) + " " + fields(i); } return fields(i); }],
    ["multi-member gzip with shrinking extra", (P) => { const a = pako.gzip("a", { header: { extra: [1, 2, 3, 4] } }), b = pako.gzip("b", { header: { extra: [9] } }); const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); const i = new P.Inflate(); i.push(o, true); return fields(i); }],
    ["multi-member gzip name then none then name (null + name)", (P) => { const parts = [pako.gzip("a", { header: { name: "one" } }), pako.gzip("b"), pako.gzip("c", { header: { name: "two", comment: "x" } })]; const o = new Uint8Array(parts.reduce((s, x) => s + x.length, 0)); let q = 0; for (const x of parts) { o.set(x, q); q += x.length; } const i = new P.Inflate(); i.push(o, true); return fields(i); }],
    ["Inflate dictionary replaced after construction", (P) => { const c = pako.deflate(text.subarray(0, 900), { dictionary: "abc" }); const i = new P.Inflate({ dictionary: "zzz" }); i.options.dictionary = utf8("abc"); i.push(c, true); return fields(i); }],
    ["Inflate plain-array dictionary", (P) => { const c = pako.deflate(text.subarray(0, 900), { dictionary: new Uint8Array([97, 98, 99]) }); const i = new P.Inflate({ dictionary: [97, 98, 99] }); try { i.push(c, true); } catch (e) { return errStr(e) + " " + fields(i); } return fields(i); }],
    ["Inflate wrong plain-array dictionary", (P) => { const c = pako.deflate(text.subarray(0, 900), { dictionary: "abc" }); const i = new P.Inflate({ dictionary: [1, 2, 3] }); i.push(c, true); return fields(i); }],
    ["Inflate BigInt dictionary needed", (P) => { const c = pako.deflate(text.subarray(0, 900), { dictionary: "abc" }); const i = new P.Inflate({ dictionary: new BigInt64Array(1) }); try { i.push(c, true); } catch (e) { return errStr(e) + " " + fields(i); } return fields(i); }],
    ["Inflate Uint16Array dictionary", (P) => { const dict = Uint16Array.from([97, 98, 355]); const c = pako.deflate(text.subarray(0, 900), { dictionary: new Uint8Array(dict) }); const i = new P.Inflate({ dictionary: dict }); i.push(c, true); return fields(i); }],
    ["inflateRaw number dictionary", (P) => P.inflateRaw(pako.deflateRaw("abc"), { dictionary: 5 })],
    ["Inflate raw option + windowBits 47 + dictionary", (P) => { try { new P.Inflate({ raw: true, windowBits: 47, dictionary: "x" }); return "no"; } catch (e) { return errStr(e); } }],
    ["Inflate falsy input then data", (P) => { const i = new P.Inflate(); const r = [i.push(0), fields(i)]; return r.join(" "); }],
    ["Inflate DataView first push", (P) => { const i = new P.Inflate(); i.push(new DataView(new ArrayBuffer(4))); return fields(i); }],
    ["Inflate raw DataView first push", (P) => { const i = new P.Inflate({ raw: true }); i.push(new DataView(new ArrayBuffer(4))); return fields(i); }],
    ["Inflate gzip-only DataView", (P) => { const i = new P.Inflate({ windowBits: 31 }); i.push(new DataView(new ArrayBuffer(4))); return fields(i); }],
    ["Deflate DataView after data", (P) => { const d = new P.Deflate({ level: 0 }); d.push(text.subarray(0, 100)); try { d.push(new DataView(new ArrayBuffer(4))); } catch (e) { return errStr(e) + " " + fields(d); } return fields(d); }],
    ["Deflate plain array L0 big chunk", (P) => { const d = new P.Deflate({ level: 0, chunkSize: 40000 }); try { d.push(Array.from(text.subarray(0, 100)), true); } catch (e) { return errStr(e) + " " + fields(d); } return fields(d); }],
    ["Deflate onData throws", (P) => { const d = new P.Deflate({ chunkSize: 64 }); let n = 0; d.onData = function (c) { if (++n === 3) throw new Error("boom"); this.chunks.push(c); }; try { d.push(text.subarray(0, 3000), true); } catch (e) { return errStr(e) + " " + fields(d); } return fields(d); }],
    ["options getters and prototype-less options", (P) => { const o = Object.create(null); o.level = 3; return P.deflate("abc", o); }],
    ["options inherited keys ignored", (P) => P.deflate("abcabc", Object.create({ level: 0 }))],
    ["windowBits string raw", (P) => P.deflateRaw(text, { windowBits: "10" })],
    ["windowBits string gzip", (P) => P.gzip(text, { windowBits: "10" })],
    ["windowBits 9.5 zlib", (P) => P.deflate(text, { windowBits: 9.5 })],
    ["inflate windowBits NaN", (P) => P.inflate(pako.deflate(text, { windowBits: 9 }), { windowBits: NaN })],
    ["inflate windowBits undefined (explicit)", (P) => P.inflate(good, { windowBits: undefined })],
    ["inflate windowBits NaN tiny distances", (P) => P.inflate(pako.deflate("aaaaaaaaaaaaaaaaaaaaaaaaaaab"), { windowBits: NaN })],
    ["inflateRaw windowBits -9.5", (P) => P.inflateRaw(pako.deflateRaw(text, { windowBits: 9 }), { windowBits: -9.5 })],
    ["negative chunkSize", (P) => P.deflate("abc", { chunkSize: -5 })],
    ["negative chunkSize inflate", (P) => P.inflate(good, { chunkSize: -5 })],
    ["huge chunkSize", (P) => P.deflate("abc", { chunkSize: 2 ** 53 })],
    ["Deflate strm.adler after construction", (P) => [new P.Deflate().strm.adler, new P.Deflate({ gzip: true }).strm.adler, new P.Deflate({ raw: true }).strm.adler, new P.Deflate({ dictionary: "abc" }).strm.adler].join()],
    ["Inflate strm.adler after construction", (P) => [new P.Inflate().strm.adler, new P.Inflate({ windowBits: 31 }).strm.adler, new P.Inflate({ raw: true }).strm.adler, new P.Inflate({ windowBits: 15 }).strm.adler].join()],
    ["constants", (P) => JSON.stringify(P.constants) + Object.keys(P).join()],
    // deflate() / inflate() go through the stream classes' prototypes in pako
    ["patched Deflate.prototype.onData, deflate()", (P) => { const o = P.Deflate.prototype.onData; const log = []; P.Deflate.prototype.onData = function (c) { log.push(c.length + ":" + this.strm.total_out); o.call(this, c); }; try { return show(P.deflate(text, { chunkSize: 1000 })) + log.join(); } finally { P.Deflate.prototype.onData = o; } }],
    ["patched Inflate.prototype.onEnd, inflate()", (P) => { const o = P.Inflate.prototype.onEnd; P.Inflate.prototype.onEnd = function (st) { o.call(this, st); this.result = "patched " + st; }; try { return P.inflate(good); } finally { P.Inflate.prototype.onEnd = o; } }],
    ["patched Inflate.prototype.push, ungzip()", (P) => { const o = P.Inflate.prototype.push; P.Inflate.prototype.push = function (d, f) { return o.call(this, d, f === undefined ? 2 : f); }; try { return show(P.ungzip(pako.gzip(text.subarray(0, 500)))); } finally { P.Inflate.prototype.push = o; } }],
  ];
  for (const [n, f] of cases) {
    checks++;
    let a, b;
    const sh = (x) => (typeof x === "string" ? x : show(x));
    try { a = "ok " + sh(f(pako)); } catch (e) { a = "threw " + errStr(e); }
    try { b = "ok " + sh(f(fast)); } catch (e) { b = "threw " + errStr(e); }
    if (a !== b) fail(`${n}:${diffAt(a, b)}`);
  }
}

// ------------------------------------------------------------ documented differences
// (README "Differences"): where pako never returns or corrupts its own state,
// fast-pako throws an Error saying so. pako itself is not run where it hangs.
{
  const doc = (name, f, re) => {
    checks++;
    let m = "returned";
    try { f(fast); } catch (e) { m = e.message; }
    if (!(m.startsWith("fast-pako:") && re.test(m))) fail(`documented ${name}: ${m}`);
  };
  doc("chunkSize 0 (pako loops forever)", (P) => P.deflate("abc", { chunkSize: 0 }), /chunkSize 0/);
  doc("chunkSize null", (P) => new P.Inflate({ chunkSize: null }).push(pako.deflate("a")), /chunkSize null/);
  doc("chunkSize fractional", (P) => P.deflate("abc", { chunkSize: 100.5 }), /chunkSize 100.5/);
  doc("chunkSize undefined", (P) => P.inflate(pako.deflate("a"), { chunkSize: undefined }), /chunkSize undefined/);
  doc('chunkSize string (pako: next_out += "64")',(P) => P.deflate("abc", { chunkSize: "64" }), /chunkSize "64"/);
  doc("chunkSize true", (P) => P.inflate(pako.deflate("a"), { chunkSize: true }), /chunkSize true/);
  doc("chunkSize [100] (pako allocates 1-byte chunks)", (P) => new P.Deflate({ chunkSize: [100] }).push("abc", true), /chunkSize 100/);
  doc("Deflate.push flush 7 with input", (P) => new P.Deflate().push("abc", 7), /flush mode 7/);
  doc("Deflate.push flush -1 with input", (P) => new P.Deflate().push("abc", -1), /flush mode -1/);
  doc("Deflate.push(0)", (P) => new P.Deflate().push(0), /never returns/);
  doc("Deflate chunkSize 6 + Z_SYNC_FLUSH", (P) => new P.Deflate({ chunkSize: 6 }).push("abc", 2), /chunkSize 6/);
  doc("Deflate chunkSize 1 + Z_PARTIAL_FLUSH (an empty block per chunk, forever)", (P) => new P.Deflate({ chunkSize: 1 }).push("hello", 1), /never returns/);
  doc("256-byte window: windowBits 8.5", (P) => P.deflate("abc", { windowBits: 8.5 }), /-byte window/);
  doc("256-byte window: windowBits '8'", (P) => P.deflate("abc", { windowBits: "8" }), /-byte window/);
  doc("256-byte window: raw -8.5", (P) => P.deflateRaw("abc", { windowBits: -8.5 }), /-byte window/);
  doc("memLevel '9' (1-symbol buffer)", (P) => P.deflate("abc", { memLevel: "9" }), /memLevel 9/);
  doc("memLevel '3'", (P) => P.deflate("abc", { memLevel: "3" }), /memLevel 3/);
  doc("memLevel '2' (hundreds of MB)", (P) => P.deflate("abc", { memLevel: "2" }), /memLevel 2/);
  doc("zlib dictionary without numeric length", (P) => P.deflate("abc", { dictionary: new DataView(new ArrayBuffer(3)) }), /never returns/);
  doc("Inflate dictionary without numeric length, needed", (P) => { const i = new P.Inflate({ dictionary: 5 }); i.push(pako.deflate("abc", { dictionary: "x" }), true); }, /never returns/);
  doc("inflate array-like of length 2.5", (P) => P.inflate({ length: 2.5, 0: 120, 1: 156 }), /input length 2.5/);
  doc("inflate array-like of length -1", (P) => P.inflate({ length: -1 }), /input length -1/);
  // these pako runs (it writes corrupt data or garbage counters): fast-pako throws instead
  checks++;
  let pr;
  try { pr = pako.deflate(text, { windowBits: 8.5 }); } catch (e) { pr = e; }
  if (!(pr instanceof Uint8Array || pr instanceof Error)) fail("pako windowBits 8.5");
  const pin = (name, cond) => { checks++; if (!cond) fail("documented " + name); };
  // gzip extra field over 16 MB (reachable only with input elements that
  // are not bytes): pako allocates it, fast-pako throws
  {
    const c = pako.gzip("x", { header: { extra: [1, 2] } });
    const w = Float64Array.from(c);
    w[10] = 2 + 1e10; // XLEN low byte: 1e10 + 2 as int32
    let m = "";
    try { fast.ungzip(w); } catch (e) { m = e.message; }
    pin("extra field over 16 MB", /^fast-pako: gzip extra field of \d+ bytes/.test(m));
  }
  // strm.output: pako's working chunk; fast-pako: the last chunk given to onData
  {
    const a = new pako.Deflate(), b = new fast.Deflate();
    a.push("abc"); b.push("abc");
    pin("strm.output while a chunk fills", a.strm.output instanceof Uint8Array && a.strm.output.length === 16384 && b.strm.output === null);
    a.push("", true); b.push("", true);
    pin("strm.output after onData", b.strm.output instanceof Uint8Array && b.strm.output.subarray(0, b.result.length).join() === b.result.join());
  }
  // strm.state: pako's internal state object; fast-pako: an empty object while open
  {
    const a = new pako.Inflate(), b = new fast.Inflate();
    pin("strm.state", a.strm.state && Object.keys(a.strm.state).length > 10 && b.strm.state && Object.keys(b.strm.state).length === 0);
    b.push(pako.deflate("x"), true);
    pin("strm.state after end", b.strm.state === null);
  }
  // how often option getters / valueOf run (the results are the same)
  {
    const count = (P) => { let n = 0; const level = { valueOf() { n++; return 5; }, toString() { n++; return "5"; } }; const r = P.deflate(text.subarray(0, 100), { level }); return [n, r.join()]; };
    const [na, ra] = count(pako), [nb, rb] = count(fast);
    pin("valueOf calls " + na + " vs " + nb + ", same result", ra === rb && nb > 0);
  }
  // a stream after exceptions from pako's gzip header code: pako resumes its
  // half-written header on the next push (compared in the targeted cases);
  // where every push fails again, pako also flushes the bytes it had put
  // so far into strm.output each time, and fast-pako does not
  {
    const run = (P) => { const d = new P.Deflate({ gzip: true, header: { time: 5n } }); const r = []; for (let k = 0; k < 3; k++) { try { d.push("abc", k === 2); r.push("ok"); } catch (e) { r.push(errStr(e) + " total_out=" + d.strm.total_out); } } return r; };
    const a = run(pako), b = run(fast);
    pin("same exception at every push", a.length === b.length && a.every((x, i) => x.split(" total_out")[0] === b[i].split(" total_out")[0]));
    pin("strm counters of a stream whose header keeps failing (" + a.join("; ") + " | " + b.join("; ") + ")", a[0] === b[0] && a[2] !== b[2]);
  }
}

console.log(`${checks} checks, ${failures} failures (${documented} documented differences hit: ${JSON.stringify(docKinds)})`);
process.exit(failures ? 1 : 0);
