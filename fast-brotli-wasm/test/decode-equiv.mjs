// Equivalence tests for decompress_fast: must behave exactly like the
// reference `decompress` export (brotli-decompressor, same wasm) and like
// brotli-wasm@3.0.1's decompress from node_modules: identical bytes on
// success, identical error string on failure (or both trapping).
// Also checks that valid streams really take the fast path (decompress_fast_only)
// so the comparisons exercise the new decoder, not the fallback.
// node fast-brotli-wasm/test/decode-equiv.mjs [--quick] [--seed N] [--fuzz N]
import zlib from "node:zlib";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fastDecode, fastOnly, refDecode, origDecode, brotliWasm, sameOutcome, describe, eqBytes } from "./decode-common.mjs";
import { genStream } from "./decode-gen.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const nm = join(here, "../../node_modules");
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? +process.argv[i + 1] : def;
};
const QUICK = process.argv.includes("--quick");
const SEED = arg("--seed", 1);
const FUZZ = arg("--fuzz", QUICK ? 20000 : 150000);
const GEN = arg("--gen", QUICK ? 3000 : 20000);
const C = zlib.constants;

// ------------------------------------------------------------------ prng
let seed = (SEED * 0x9e3779b9) >>> 0 || 1;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};
const ri = (n) => Math.floor(rnd() * n);
const pick = (a) => a[ri(a.length)];
function randBytes(n) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = ri(256);
  return b;
}

// ------------------------------------------------------------------ checking
const stats = { checks: 0, mismatches: 0, fastOk: 0, routedOk: 0, routedErr: 0, trapped: 0, unexpectedFallback: 0, origChecked: 0 };
const bySection = {};
let section = "";
const failDir = join(tmpdir(), "fastbrotli-decode-failures");
function fail(msg, input) {
  stats.mismatches++;
  if (stats.mismatches <= 30) {
    mkdirSync(failDir, { recursive: true });
    const f = join(failDir, `fail-${stats.mismatches}.br`);
    writeFileSync(f, input);
    console.log(`FAIL [${section}] ${msg} (input saved to ${f})`);
  }
}

// `raw`: expected output for encoder-produced streams; `expectFast`: the fast
// path must decode it (no fallback). `withOrig`: also compare with brotli-wasm.
function check(label, input, { raw, expectFast = raw !== undefined, withOrig = true } = {}) {
  stats.checks++;
  const s = (bySection[section] ??= { checks: 0, fastOk: 0, routed: 0 });
  s.checks++;
  const f = fastDecode(input);
  const r = refDecode(input);
  if (!sameOutcome(f, r)) return fail(`${label}: fast ${describe(f)} vs reference ${describe(r)}`, input);
  if (withOrig) {
    stats.origChecked++;
    const o = origDecode(input);
    if (!sameOutcome(f, o)) return fail(`${label}: fast ${describe(f)} vs brotli-wasm ${describe(o)}`, input);
  }
  if (raw !== undefined && !(f.ok && eqBytes(f.bytes, raw))) return fail(`${label}: output != original data (${describe(f)})`, input);
  const p = fastOnly(input);
  if (p.ok) {
    stats.fastOk++;
    s.fastOk++;
    if (!sameOutcome(p, r)) return fail(`${label}: fast-only ${describe(p)} vs reference ${describe(r)}`, input);
  } else {
    s.routed++;
    if (r.trap !== undefined) stats.trapped++;
    else if (r.ok) stats.routedOk++;
    else stats.routedErr++;
    if (expectFast) {
      stats.unexpectedFallback++;
      fail(`${label}: valid stream not handled by the fast path`, input);
    }
  }
}

const isLargeWindow = (c) => c.length > 0 && (c[0] & 0x7f) === 0x11;

function nodeCompress(raw, params) {
  return new Uint8Array(zlib.brotliCompressSync(raw, { params }));
}

async function streamOps(params, ops) {
  const s = zlib.createBrotliCompress({ params });
  const chunks = [];
  s.on("data", (d) => chunks.push(d));
  const done = new Promise((res, rej) => { s.on("end", res); s.on("error", rej); });
  for (const [data, flag] of ops) {
    s._defaultFlushFlag = flag;
    await new Promise((res, rej) => s.write(data, (e) => (e ? rej(e) : res())));
  }
  s._defaultFlushFlag = C.BROTLI_OPERATION_PROCESS;
  s.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}

function randomParams(rawLen) {
  const p = {};
  const q = ri(12);
  p[C.BROTLI_PARAM_QUALITY] = q;
  if (rnd() < 0.7) p[C.BROTLI_PARAM_LGWIN] = 10 + ri(15);
  if (rnd() < 0.3) p[C.BROTLI_PARAM_MODE] = pick([C.BROTLI_MODE_GENERIC, C.BROTLI_MODE_TEXT, C.BROTLI_MODE_FONT]);
  if (rnd() < 0.2) p[C.BROTLI_PARAM_LGBLOCK] = 16 + ri(9);
  if (rnd() < 0.15) p[C.BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING] = 1;
  if (rnd() < 0.3) p[C.BROTLI_PARAM_SIZE_HINT] = rawLen;
  if (rnd() < 0.25) {
    // encoder only honours these at q >= 10 (and validates ndirect)
    const np = ri(4);
    p[C.BROTLI_PARAM_NPOSTFIX] = np;
    p[C.BROTLI_PARAM_NDIRECT] = ri(16) << np;
  }
  return p;
}
const fmtParams = (p) => Object.entries(p).map(([k, v]) => `${k}=${v}`).join(",");

// ------------------------------------------------------------------ corpus
function listFiles(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (/\.(js|mjs|cjs|json|md|ts|css|txt|map|html|yml|d\.ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

const t0 = Date.now();
const files = listFiles(nm, []).sort();
const corpus = [];
for (const f of files) {
  const b = new Uint8Array(readFileSync(f));
  if (b.length <= (QUICK ? 65536 : 262144)) corpus.push({ name: f.slice(nm.length + 1), bytes: b });
}
const sample = QUICK ? corpus.filter((_, i) => i % 6 === 0) : corpus;
console.log(`corpus: ${corpus.length} files <= ${QUICK ? "64" : "256"}KB (${sample.length} used), seed ${SEED}`);

// (a1) Node's C encoder, random parameters per file
section = "node zlib, random params";
for (const { name, bytes } of sample) {
  const p = randomParams(bytes.length);
  let comp;
  try { comp = nodeCompress(bytes, p); } catch (e) { continue; }
  check(`${name} ${fmtParams(p)}`, comp, { raw: bytes, withOrig: rnd() < 0.5 });
}
console.log(`  ${section}: ${bySection[section].checks} streams (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// (a2) every quality / a spread of windows on a handful of files
section = "node zlib, q0-11 x lgwin";
const spread = [
  "zod/v4/classic/errors.js", "zod/v4/classic/schemas.js", "react-dom/cjs/react-dom-client.production.js", "react/package.json",
].map((r) => ({ name: r, bytes: new Uint8Array(readFileSync(join(nm, r))) }));
for (const { name, bytes } of spread) {
  for (let q = 0; q <= 11; q++) {
    for (const w of QUICK ? [10, 16, 22] : [10, 12, 16, 18, 20, 22, 24]) {
      if (bytes.length > 200000 && q >= 10 && w !== 22) continue;
      for (const mode of [C.BROTLI_MODE_GENERIC, C.BROTLI_MODE_TEXT, C.BROTLI_MODE_FONT]) {
        if (mode !== C.BROTLI_MODE_GENERIC && (w !== 22 || bytes.length > 200000)) continue;
        const p = { [C.BROTLI_PARAM_QUALITY]: q, [C.BROTLI_PARAM_LGWIN]: w, [C.BROTLI_PARAM_MODE]: mode };
        check(`${name} ${fmtParams(p)}`, nodeCompress(bytes, p), { raw: bytes });
      }
    }
  }
}
// distance parameters (honoured at q >= 10)
for (let np = 0; np < 4; np++) {
  for (const nd of [0, 1, 7, 15]) {
    const p = { [C.BROTLI_PARAM_QUALITY]: 10 + (np & 1), [C.BROTLI_PARAM_NPOSTFIX]: np, [C.BROTLI_PARAM_NDIRECT]: nd << np };
    check(`zod schemas ${fmtParams(p)}`, nodeCompress(spread[1].bytes, p), { raw: spread[1].bytes });
  }
}
console.log(`  ${section}: ${bySection[section].checks} streams (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// (a3) brotli-wasm's own encoder (Rust brotli 5.0.0), q0..q11
section = "brotli-wasm compress";
{
  const small = sample.filter((f) => f.bytes.length <= 65536);
  const step = QUICK ? 4 : 1;
  for (let i = 0; i < small.length; i += step) {
    const { name, bytes } = small[i];
    const q = i % 12;
    const comp = brotliWasm.compress(bytes, { quality: q });
    check(`${name} brotli-wasm q${q}`, comp, { raw: bytes, withOrig: rnd() < 0.3 });
  }
  for (let q = 0; q <= 11; q++) {
    const b = spread[2].bytes;
    check(`react-dom brotli-wasm q${q}`, brotliWasm.compress(b, { quality: q }), { raw: b });
  }
}
console.log(`  ${section}: ${bySection[section].checks} streams (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// (a4) special inputs
section = "special inputs";
{
  const specials = [
    ["empty", new Uint8Array(0)],
    ["1 byte", new Uint8Array([0x41])],
    ["2 bytes", new Uint8Array([0, 255])],
    ["zeros 1MB", new Uint8Array(1 << 20)],
    ["0xff 70000", new Uint8Array(70000).fill(255)],
    ["abc repeat", new TextEncoder().encode("abc".repeat(100000))],
    ["period 1..40", (() => { const a = []; for (let p = 1; p <= 40; p++) for (let i = 0; i < 3000; i++) a.push((i % p) * 7 + p); return new Uint8Array(a); })()],
    ["random 1000", randBytes(1000)],
    ["random 100000", randBytes(100000)],
    ["random 300000", randBytes(300000)],
    ["text+random mix", (() => { const t = spread[1].bytes; const r = randBytes(50000); const o = new Uint8Array(t.length + r.length + t.length); o.set(t); o.set(r, t.length); o.set(t, t.length + r.length); return o; })()],
  ];
  for (let v = 0; v < 256; v++) specials.push([`1 byte ${v}`, new Uint8Array([v])]);
  for (const [name, bytes] of specials) {
    for (const q of [0, 1, 2, 4, 5, 9, 10, 11]) {
      if (bytes.length > 100000 && q >= 10 && name !== "zeros 1MB") continue;
      if (name.startsWith("1 byte ") && q !== 5 && q !== 11) continue;
      for (const w of [10, 16, 24]) {
        if (name.startsWith("1 byte ") && w !== 16) continue;
        const p = { [C.BROTLI_PARAM_QUALITY]: q, [C.BROTLI_PARAM_LGWIN]: w };
        check(`${name} ${fmtParams(p)}`, nodeCompress(bytes, p), { raw: bytes });
      }
    }
    if (bytes.length <= 100000) {
      for (const q of [0, 5, 11]) check(`${name} brotli-wasm q${q}`, brotliWasm.compress(bytes, { quality: q }), { raw: bytes });
    }
  }
  // raw non-brotli inputs
  for (let v = 0; v < 256; v++) check(`raw byte ${v}`, new Uint8Array([v]));
  for (let v = 0; v < 65536; v += QUICK ? 97 : 1) check(`raw 2 bytes ${v}`, new Uint8Array([v & 255, v >> 8]), { withOrig: v % 16 === 0 });
}
console.log(`  ${section}: ${bySection[section].checks} streams (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// (a5) large data, windows smaller than the data
section = "large data";
{
  const big = [];
  for (const r of ["typescript/lib/typescript.js", "three/build/three.module.js", "rollup/dist/es/shared/node-entry.js"]) {
    try { big.push({ name: r, bytes: new Uint8Array(readFileSync(join(nm, r))) }); } catch {}
  }
  const cat = new Uint8Array(big.reduce((a, b) => a + b.bytes.length, 0));
  let o = 0;
  for (const b of big) { cat.set(b.bytes, o); o += b.bytes.length; }
  const cases = QUICK
    ? [[1, 16], [5, 22]]
    : [[0, 16], [1, 10], [1, 16], [2, 18], [4, 20], [5, 22], [5, 24], [7, 16], [9, 24]];
  for (const [q, w] of cases) {
    const p = { [C.BROTLI_PARAM_QUALITY]: q, [C.BROTLI_PARAM_LGWIN]: w };
    check(`concat ${(cat.length / 1e6).toFixed(1)}MB ${fmtParams(p)}`, nodeCompress(cat, p), { raw: cat });
  }
  const rb = randBytes(QUICK ? 1 << 20 : 5 << 20);
  check(`random ${rb.length} q5 w16`, nodeCompress(rb, { [C.BROTLI_PARAM_QUALITY]: 5, [C.BROTLI_PARAM_LGWIN]: 16 }), { raw: rb });
  if (!QUICK) {
    const b = big[1].bytes;
    for (const q of [10, 11]) check(`three.module q${q} w18`, nodeCompress(b, { [C.BROTLI_PARAM_QUALITY]: q, [C.BROTLI_PARAM_LGWIN]: 18 }), { raw: b });
  }
}
console.log(`  ${section}: ${bySection[section].checks} streams (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// (a6) large-window streams: the reference accepts them (BrotliDecompress
// enables large windows); the fast path routes them to the reference.
section = "large window";
for (const { name, bytes } of [spread[1], spread[2], { name: "zeros 1MB", bytes: new Uint8Array(1 << 20) }]) {
  for (const w of [10, 16, 22, 24, 25, 28, 30]) {
    for (const q of [1, 5, 11]) {
      if (bytes.length > 100000 && q === 11) continue;
      const p = { [C.BROTLI_PARAM_QUALITY]: q, [C.BROTLI_PARAM_LGWIN]: w, [C.BROTLI_PARAM_LARGE_WINDOW]: 1 };
      const comp = nodeCompress(bytes, p);
      check(`${name} ${fmtParams(p)}`, comp, { raw: bytes, expectFast: !isLargeWindow(comp) });
    }
  }
}
console.log(`  ${section}: ${bySection[section].checks} streams (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// (a7) streaming encoder with flushes, empty flushes and metadata blocks
section = "flush / metadata streams";
{
  const n = QUICK ? 150 : 1000;
  for (let i = 0; i < n; i++) {
    const src = pick(sample).bytes;
    const params = { [C.BROTLI_PARAM_QUALITY]: ri(12), [C.BROTLI_PARAM_LGWIN]: 10 + ri(15) };
    const ops = [];
    const expect = [];
    let pos = 0;
    const nops = 1 + ri(8);
    for (let k = 0; k < nops; k++) {
      const kind = ri(10);
      if (kind < 2) {
        ops.push([Buffer.from(randBytes(ri(3) === 0 ? ri(300) : ri(20))), C.BROTLI_OPERATION_EMIT_METADATA]);
      } else if (kind < 3) {
        ops.push([Buffer.alloc(0), C.BROTLI_OPERATION_FLUSH]);
      } else {
        const len = Math.min(src.length - pos, ri(4) === 0 ? ri(4) : ri(src.length + 1));
        const chunk = src.subarray(pos, pos + len);
        pos += len;
        expect.push(chunk);
        ops.push([Buffer.from(chunk), kind < 7 ? C.BROTLI_OPERATION_FLUSH : C.BROTLI_OPERATION_PROCESS]);
      }
    }
    const raw = new Uint8Array(Buffer.concat(expect));
    const comp = await streamOps(params, ops);
    check(`flush stream #${i} ${fmtParams(params)} ops=${ops.map((o) => o[1] + ":" + o[0].length).join(" ")}`, comp, { raw });
  }
}
console.log(`  ${section}: ${bySection[section].checks} streams (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// (a8) synthetic streams from the random stream generator (every feature:
// block switches, context modes/maps with RLE+IMTF, NPOSTFIX/NDIRECT, short
// distance codes, dictionary words with all transforms, uncompressed/metadata/
// empty meta-blocks, small windows, padding and trailing bytes)
section = "generated streams";
const genPool = [];
for (let i = 0; i < GEN; i++) {
  const g = genStream(rnd, pick(sample).bytes);
  if (genPool.length < 400 && g.bytes.length < 4000) genPool.push(g.bytes);
  check(`generated #${i} (${g.desc})`, g.bytes, { raw: g.raw, expectFast: g.expectFast, withOrig: i % 4 === 0 });
}
console.log(`  ${section}: ${bySection[section].checks} streams (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// ------------------------------------------------------------------ fuzzing
section = "fuzz (mutated streams)";
{
  // seed pool: small valid streams of many shapes
  const seeds = [...genPool];
  const smallSrc = sample.filter((f) => f.bytes.length < 6000);
  while (seeds.length < 900) {
    const src = pick(smallSrc).bytes;
    const p = randomParams(src.length);
    if (rnd() < 0.2) seeds.push(brotliWasm.compress(src, { quality: ri(12) }));
    else seeds.push(nodeCompress(src, p));
  }
  // exhaustive truncation + single-bit flips on a few seeds
  for (let s = 0; s < (QUICK ? 3 : 12); s++) {
    const b = seeds[s * 7 % seeds.length];
    for (let n = 0; n < b.length; n++) check(`truncate ${n}/${b.length}`, b.subarray(0, n), { withOrig: n % 8 === 0 });
    for (let bit = 0; bit < Math.min(b.length * 8, 4000); bit++) {
      const m = b.slice();
      m[bit >> 3] ^= 1 << (bit & 7);
      check(`bitflip ${bit}`, m, { withOrig: bit % 8 === 0 });
    }
  }
  for (let i = 0; i < FUZZ; i++) {
    const b = pick(seeds);
    let m = b.slice();
    const kind = ri(9);
    let what;
    if (kind <= 2) {
      const k = 1 + ri(kind === 0 ? 1 : 4);
      for (let j = 0; j < k; j++) { const bit = ri(m.length * 8); m[bit >> 3] ^= 1 << (bit & 7); }
      what = `${k} bit flips`;
    } else if (kind === 3) {
      m = m.subarray(0, ri(m.length));
      what = "truncated";
    } else if (kind === 4) {
      const at = ri(m.length + 1), k = 1 + ri(4);
      const o = new Uint8Array(m.length + k);
      o.set(m.subarray(0, at)); o.set(randBytes(k), at); o.set(m.subarray(at), at + k);
      m = o;
      what = `insert ${k}`;
    } else if (kind === 5) {
      const at = ri(m.length), k = 1 + ri(Math.min(4, m.length - at));
      const o = new Uint8Array(m.length - k);
      o.set(m.subarray(0, at)); o.set(m.subarray(at + k), at);
      m = o;
      what = `delete ${k}`;
    } else if (kind === 6) {
      const t = randBytes(1 + ri(ri(2) ? 4 : 100));
      const o = new Uint8Array(m.length + t.length);
      o.set(m); o.set(t, m.length);
      m = o;
      what = "trailing garbage";
    } else if (kind === 7) {
      m[ri(m.length)] = ri(256);
      what = "byte overwrite";
    } else {
      m = randBytes(1 + ri(64));
      what = "random bytes";
    }
    check(`fuzz #${i} ${what}`, m, { withOrig: i % 3 === 0 });
  }
}
console.log(`  ${section}: ${bySection[section].checks} streams (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// ------------------------------------------------------------------ report
console.log("\nper section: checks / decoded by fast path / routed to reference");
for (const [k, v] of Object.entries(bySection)) console.log(`  ${k.padEnd(28)} ${String(v.checks).padStart(7)} ${String(v.fastOk).padStart(7)} ${String(v.routed).padStart(7)}`);
console.log(
  `\n${stats.checks} checks (${stats.origChecked} also against brotli-wasm): ${stats.mismatches} mismatches; ` +
    `fast path decoded ${stats.fastOk}, routed to reference ${stats.routedOk + stats.routedErr + stats.trapped} ` +
    `(reference ok ${stats.routedOk}, error ${stats.routedErr}, trap ${stats.trapped}); unexpected fallbacks ${stats.unexpectedFallback}; ` +
    `${((Date.now() - t0) / 1000).toFixed(0)}s`,
);
process.exit(stats.mismatches ? 1 : 0);
