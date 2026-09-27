// Equivalence tests: @r1ck404/fast-pako must behave exactly like pako 2.1.0.
// node packages/fast-pako/test/equiv.mjs [--quick]
import pako from "pako";
import fast from "../index.mjs";
import { loadJs, utf8, randomBytes, read } from "../../../bench/corpus.mjs";

const QUICK = process.argv.includes("--quick");
let failures = 0, checks = 0;
const fail = (msg) => { failures++; if (failures < 40) console.log("FAIL:", msg); };

// deterministic PRNG
let seed = 0x9e3779b9;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const ri = (n) => Math.floor(rnd() * n);

function eqBytes(a, b) {
  if (a === b) return true;
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// run fn on both impls; compare returned value or thrown value
function outcome(fn) {
  try {
    const r = fn();
    return { ok: true, r };
  } catch (e) {
    return { ok: false, e: e instanceof Error ? `Error:${e.message}` : e };
  }
}
function same(label, fa, fb) {
  checks++;
  const a = outcome(fa), b = outcome(fb);
  if (a.ok !== b.ok) return fail(`${label}: pako ${a.ok ? "returned" : "threw " + a.e} / fast ${b.ok ? "returned" : "threw " + b.e}`);
  if (!a.ok) { if (a.e !== b.e) fail(`${label}: thrown ${JSON.stringify(a.e)} vs ${JSON.stringify(b.e)}`); return; }
  const x = a.r, y = b.r;
  if (typeof x === "string" || typeof y === "string") { if (x !== y) fail(`${label}: string results differ (${x?.length} vs ${y?.length})`); return; }
  if (x === undefined || y === undefined) { if (x !== y) fail(`${label}: ${x} vs ${y}`); return; }
  if (!eqBytes(x, y)) fail(`${label}: bytes differ (len ${x.length} vs ${y.length})`);
  if (x.buffer && y.buffer && (x.byteOffset !== y.byteOffset || x.buffer.byteLength !== y.buffer.byteLength)) fail(`${label}: result buffer shape differs`);
}

// ---------------------------------------------------------------- inputs
const js = loadJs();
const text = utf8(js.find((f) => f.name.includes("zod-schemas")).code);
const big = utf8(js.find((f) => f.name.includes("react-dom-client.prod")).code).subarray(0, QUICK ? 120000 : 400000);
const wasmBin = read("esbuild-wasm/esbuild.wasm").subarray(100000, QUICK ? 160000 : 300000);
const inputs = [
  ["empty", new Uint8Array(0)],
  ["1byte", new Uint8Array([65])],
  ["2bytes", new Uint8Array([0, 255])],
  ["tiny", utf8("hello hello hello")],
  ["zeros 70000", new Uint8Array(70000)],
  ["run+text", utf8("a".repeat(5000) + "xyz".repeat(3000) + "the quick brown fox ".repeat(500))],
  ["text 51KB", text],
  ["random 40000", randomBytes(40000)],
  ["random 70000", randomBytes(70000, 7)],
  ["binary", wasmBin],
  ["js big", big],
];

// ---------------------------------------------------------------- one-shot deflate
const levels = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
for (const [name, d] of inputs) {
  const heavy = d.length > 100000;
  for (const level of levels) {
    if (heavy && QUICK && level % 3 !== 0) continue;
    for (const fnName of ["deflate", "deflateRaw", "gzip"]) {
      same(`${fnName} ${name} L${level}`, () => pako[fnName](d, { level }), () => fast[fnName](d, { level }));
    }
  }
  for (const strategy of [1, 2, 3, 4]) same(`deflate ${name} strat${strategy}`, () => pako.deflate(d, { strategy }), () => fast.deflate(d, { strategy }));
  for (const memLevel of [1, 2, 5, 9]) same(`deflate ${name} mem${memLevel}`, () => pako.deflate(d, { memLevel, level: 5 }), () => fast.deflate(d, { memLevel, level: 5 }));
  for (const windowBits of [8, 9, 10, 12, 14]) {
    same(`deflate ${name} wb${windowBits}`, () => pako.deflate(d, { windowBits }), () => fast.deflate(d, { windowBits }));
    same(`deflateRaw ${name} wb${windowBits}`, () => pako.deflateRaw(d, { windowBits }), () => fast.deflateRaw(d, { windowBits }));
  }
  for (const chunkSize of [64, 100, 1000, 65536]) {
    same(`deflate ${name} L0 chunk${chunkSize}`, () => pako.deflate(d, { level: 0, chunkSize }), () => fast.deflate(d, { level: 0, chunkSize }));
    same(`deflate ${name} L6 chunk${chunkSize}`, () => pako.deflate(d, { chunkSize }), () => fast.deflate(d, { chunkSize }));
  }
}
// string / ArrayBuffer / Buffer inputs
for (const s of ["", "héllo wörld ✓ 😀", "x".repeat(10000) + "\u0000\uD800 lone"]) {
  same("deflate string", () => pako.deflate(s), () => fast.deflate(s));
  same("gzip string", () => pako.gzip(s), () => fast.gzip(s));
}
same("deflate ArrayBuffer", () => pako.deflate(text.slice().buffer), () => fast.deflate(text.slice().buffer));
same("deflate Buffer", () => pako.deflate(Buffer.from(text)), () => fast.deflate(Buffer.from(text)));
// invalid options
for (const o of [{ level: 10 }, { level: -2 }, { memLevel: 0 }, { memLevel: 10 }, { windowBits: 7 }, { windowBits: 16, raw: true }, { strategy: 5 }, { method: 7 }, { windowBits: 8, raw: true }, { windowBits: 8, gzip: true }]) {
  same(`deflate opts ${JSON.stringify(o)}`, () => pako.deflate(text, { ...o }), () => fast.deflate(text, { ...o }));
}
same("deflate opts string", () => pako.deflate(text, "abc"), () => fast.deflate(text, "abc"));
// options object mutation (deflateRaw/gzip set flags on the caller's object)
{
  const o1 = { level: 3 }, o2 = { level: 3 };
  pako.deflateRaw(text, o1); fast.deflateRaw(text, o2);
  checks++; if (JSON.stringify(o1) !== JSON.stringify(o2)) fail("deflateRaw options mutation");
}
// dictionary
for (const dict of ["hello world dictionary", utf8("the quick brown fox"), new Uint8Array(40000).fill(7), text.slice(0, 33000).buffer]) {
  for (const fnName of ["deflate", "deflateRaw"]) {
    same(`${fnName} dict`, () => pako[fnName](text, { dictionary: dict }), () => fast[fnName](text, { dictionary: dict }));
  }
  same("gzip dict (error)", () => pako.gzip(text, { dictionary: dict }), () => fast.gzip(text, { dictionary: dict }));
}
// gzip header
const headers = [
  { text: true, time: 123456789, os: 7, name: "file.txt", comment: "a comment", hcrc: true, extra: [1, 2, 3, 4] },
  { name: "" , comment: "" },
  { extra: [] },
  { extra: new Uint8Array(300).fill(9), hcrc: 1 },
  { time: -5, os: 300, name: "näme\u0000rest" },
  { time: 2 ** 33 + 17 },
];
for (const header of headers) {
  same(`gzip header ${JSON.stringify(header).slice(0, 60)}`, () => pako.gzip(text, { header }), () => fast.gzip(text, { header }));
  same(`deflate header (ignored)`, () => pako.deflate(text, { header }), () => fast.deflate(text, { header }));
}

// ---------------------------------------------------------------- one-shot inflate
const compressedSet = [];
for (const [name, d] of inputs) {
  for (const level of [0, 1, 6, 9]) {
    compressedSet.push([`${name} z L${level}`, pako.deflate(d, { level }), {}]);
    compressedSet.push([`${name} raw L${level}`, pako.deflateRaw(d, { level }), { raw: true }]);
    compressedSet.push([`${name} gz L${level}`, pako.gzip(d, { level }), {}]);
  }
  compressedSet.push([`${name} fixed`, pako.deflate(d, { strategy: 4 }), {}]);
  compressedSet.push([`${name} wb9`, pako.deflate(d, { windowBits: 9 }), {}]);
  compressedSet.push([`${name} raw wb10`, pako.deflateRaw(d, { windowBits: 10 }), { raw: true, windowBits: 10 }]);
}
for (const [name, c, opt] of compressedSet) {
  same(`inflate ${name}`, () => pako.inflate(c, { ...opt }), () => fast.inflate(c, { ...opt }));
  same(`inflate ${name} to:string`, () => pako.inflate(c, { ...opt, to: "string" }), () => fast.inflate(c, { ...opt, to: "string" }));
  same(`inflate ${name} chunk1000`, () => pako.inflate(c, { ...opt, chunkSize: 1000 }), () => fast.inflate(c, { ...opt, chunkSize: 1000 }));
  if (!opt.raw) same(`ungzip/inflate ${name} wb15`, () => pako.inflate(c, { windowBits: 15 }), () => fast.inflate(c, { windowBits: 15 }));
}
// window size limits
for (const wb of [8, 9, 10, 12, 15, 0, 16, 31, 32, 47]) {
  const c = pako.deflate(big, { windowBits: 12 });
  same(`inflate wb${wb}`, () => pako.inflate(c, { windowBits: wb }), () => fast.inflate(c, { windowBits: wb }));
  const r = pako.deflateRaw(big, { windowBits: 12 });
  same(`inflateRaw wb${wb}`, () => pako.inflateRaw(r, { windowBits: wb }), () => fast.inflateRaw(r, { windowBits: wb }));
}
// dictionaries
{
  const dict = utf8("the quick brown fox jumps over the lazy dog");
  const c = pako.deflate(text, { dictionary: dict });
  same("inflate need dict", () => pako.inflate(c), () => fast.inflate(c));
  same("inflate dict", () => pako.inflate(c, { dictionary: dict }), () => fast.inflate(c, { dictionary: dict }));
  same("inflate wrong dict", () => pako.inflate(c, { dictionary: "nope" }), () => fast.inflate(c, { dictionary: "nope" }));
  const r = pako.deflateRaw(text, { dictionary: dict });
  same("inflateRaw dict", () => pako.inflateRaw(r, { dictionary: dict }), () => fast.inflateRaw(r, { dictionary: dict }));
  same("inflateRaw dict string", () => pako.inflateRaw(r, { dictionary: "the quick brown fox jumps over the lazy dog" }), () => fast.inflateRaw(r, { dictionary: "the quick brown fox jumps over the lazy dog" }));
}
// multi-member gzip, trailing data
{
  const a = pako.gzip(text), b = pako.gzip(big), z = pako.deflate(text);
  const cat = (...xs) => { const n = xs.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };
  const cases = [
    ["2 members", cat(a, b)], ["3 members", cat(b, a, b)], ["member + zeros", cat(a, new Uint8Array(100))],
    ["member + garbage", cat(a, utf8("garbage!"))], ["member + 0 + garbage", cat(a, new Uint8Array([0, 1, 2]))],
    ["zlib + zlib", cat(z, z)], ["gzip + zlib", cat(a, z)], ["truncated", a.subarray(0, a.length - 3)],
    ["truncated mid", b.subarray(0, b.length >> 1)], ["header only", a.subarray(0, 10)], ["empty", new Uint8Array(0)],
  ];
  for (const [n, c] of cases) {
    same(`inflate ${n}`, () => pako.inflate(c), () => fast.inflate(c));
    same(`inflate ${n} AB`, () => pako.inflate(c.slice().buffer), () => fast.inflate(c.slice().buffer));
    same(`inflate ${n} str`, () => pako.inflate(c, { to: "string" }), () => fast.inflate(c, { to: "string" }));
  }
}
// invalid UTF-8 / BOMs in string mode at chunk boundaries
{
  const parts = [];
  for (let i = 0; i < 3000; i++) parts.push(i % 7 === 0 ? "﻿" : i % 11 === 0 ? "😀" : "ab");
  const s = utf8(parts.join(""));
  for (const cs of [64, 65, 100, 1024]) {
    const c = pako.deflate(s);
    same(`inflate utf8 chunk${cs}`, () => pako.inflate(c, { to: "string", chunkSize: cs }), () => fast.inflate(c, { to: "string", chunkSize: cs }));
    const bad = s.slice(); for (let i = 0; i < bad.length; i += 97) bad[i] = 0xf0 + (i & 7);
    const cb = pako.deflate(bad);
    same(`inflate bad utf8 chunk${cs}`, () => pako.inflate(cb, { to: "string", chunkSize: cs }), () => fast.inflate(cb, { to: "string", chunkSize: cs }));
  }
}
// corruption fuzz
{
  const bases = [pako.deflate(text), pako.gzip(big.subarray(0, 50000)), pako.deflateRaw(wasmBin.subarray(0, 30000)), pako.deflate(text, { level: 1 }), pako.deflate(randomBytes(3000))];
  const n = QUICK ? 1500 : 6000;
  for (let i = 0; i < n; i++) {
    const base = bases[i % bases.length];
    const c = base.slice();
    const kind = ri(4);
    if (kind === 0) { const k = 1 + ri(4); for (let j = 0; j < k; j++) c[ri(c.length)] ^= 1 << ri(8); }
    else if (kind === 1) c[ri(Math.min(c.length, 40))] = ri(256);
    else if (kind === 2) { const p = ri(c.length); c[p] = ri(256); c[Math.min(c.length - 1, p + 1)] = ri(256); }
    else { const p = ri(c.length); for (let j = p; j < Math.min(c.length, p + 8); j++) c[j] = ri(256); }
    const raw = base === bases[2];
    const input = rnd() < 0.2 ? c.subarray(0, ri(c.length)) : c;
    same(`fuzz#${i}`, () => pako.inflate(input, raw ? { raw: true } : undefined), () => fast.inflate(input, raw ? { raw: true } : undefined));
  }
}

// ---------------------------------------------------------------- streaming Deflate
function runDeflateStream(P, opts, pieces) {
  const log = [];
  const d = new P.Deflate({ ...opts });
  d.onData = function (chunk) { log.push(["data", Array.from(chunk).join(","), chunk.length, chunk.buffer.byteLength, chunk.byteOffset]); this.chunks.push(chunk); };
  const origEnd = d.onEnd;
  for (const [data, flush] of pieces) {
    const r = d.push(data, flush);
    log.push(["push", r, d.err, d.msg, d.ended, d.strm.total_in, d.strm.total_out, d.strm.avail_in, d.strm.adler, d.strm.data_type]);
  }
  log.push(["end", d.err, d.msg, d.result ? Array.from(d.result).join(",") : null]);
  return JSON.stringify(log);
}
const flushes = [0, 0, 0, 1, 2, 3, 5, false, true];
const nStream = QUICK ? 60 : 250;
for (let i = 0; i < nStream; i++) {
  const src = [text, big.subarray(0, 60000), wasmBin.subarray(0, 50000), randomBytes(20000, i + 1)][i % 4];
  const opts = { level: [0, 1, 6, 9][ri(4)], chunkSize: [64, 256, 1000, 16384][ri(4)], raw: rnd() < 0.3, gzip: rnd() < 0.3, strategy: rnd() < 0.2 ? ri(5) : 0 };
  const pieces = [];
  let p = 0;
  while (p < src.length) {
    const n = 1 + ri(Math.min(20000, src.length - p));
    pieces.push([src.subarray(p, p + n), flushes[ri(flushes.length)]]);
    p += n;
  }
  pieces.push([new Uint8Array(0), true]);
  if (rnd() < 0.3) pieces.push([new Uint8Array([1, 2, 3]), 0]);
  checks++;
  const a = runDeflateStream(pako, opts, pieces), b = runDeflateStream(fast, opts, pieces);
  if (a !== b) fail(`Deflate stream #${i} ${JSON.stringify(opts)}`);
}

// ---------------------------------------------------------------- streaming Inflate
function runInflateStream(P, opts, pieces) {
  const log = [];
  let inf;
  try { inf = new P.Inflate({ ...opts }); } catch (e) { return "ctor:" + e.message; }
  inf.onData = function (chunk) { log.push(["data", typeof chunk === "string" ? chunk : Array.from(chunk).join(","), chunk.length]); this.chunks.push(chunk); };
  for (const [data, flush] of pieces) {
    const r = inf.push(data, flush);
    log.push(["push", r, inf.err, inf.msg, inf.ended, inf.strm.total_in, inf.strm.total_out, inf.strm.avail_in, inf.strm.adler]);
  }
  const h = inf.header;
  log.push(["hdr", h.text, h.time, h.xflags, h.os, h.extra ? Array.from(h.extra).join(",") : h.extra, h.extra_len, h.name, h.comment, h.hcrc, h.done]);
  log.push(["end", inf.err, inf.msg, typeof inf.result === "string" ? inf.result : inf.result ? Array.from(inf.result).join(",") : null]);
  return JSON.stringify(log);
}
for (let i = 0; i < nStream; i++) {
  const src = [text, big.subarray(0, 60000), wasmBin.subarray(0, 50000)][i % 3];
  const kind = ri(3);
  const c = kind === 0 ? pako.deflate(src) : kind === 1 ? pako.gzip(src, { header: { name: "n.txt", comment: "c", extra: [9, 8, 7], hcrc: true, time: 5 } }) : pako.deflateRaw(src);
  let input = c;
  if (rnd() < 0.15) { input = c.slice(); input[ri(input.length)] ^= 0x10; }
  const opts = { chunkSize: [64, 1000, 65536][ri(3)], raw: kind === 2, to: rnd() < 0.3 ? "string" : "" };
  const pieces = [];
  let p = 0;
  while (p < input.length) {
    const n = 1 + ri(Math.min(5000, input.length - p));
    pieces.push([input.subarray(p, p + n), [0, 0, 0, 2, 4, false, true][ri(7)]]);
    p += n;
  }
  checks++;
  const a = runInflateStream(pako, opts, pieces), b = runInflateStream(fast, opts, pieces);
  if (a !== b) fail(`Inflate stream #${i} ${JSON.stringify(opts)} kind ${kind}`);
}

console.log(`${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
