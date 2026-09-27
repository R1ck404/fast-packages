// Independent differential check: fast-brotli-wasm vs brotli-wasm 3.0.1.
// compress() default (q11, what Nodepod's zlib polyfill calls) and random
// qualities on real files in random order (state leakage), decompress of
// valid/corrupt/truncated streams, and the stream classes with random chunking.
// usage: node .scratch/verify/verify-brotli.mjs [nFiles]
import { createRequire } from "node:module";
import { join } from "node:path";
import { allFiles, sample, readBytes, eqBytes, rnd, rint, pick, Tally, describeErr, root } from "./corpus.mjs";

const require = createRequire(import.meta.url);
const O = require("brotli-wasm");
const F = require(process.env.FAST_BROTLI || join(root, "fast-brotli-wasm/index.node.cjs"));
const N = Number(process.argv[2] || 600);
const T = new Tally("brotli");

function run(fn) {
  try {
    const v = fn();
    return v instanceof Uint8Array ? "B" + Buffer.from(v).toString("base64") : "V" + String(v);
  } catch (e) {
    return "E" + describeErr(e);
  }
}
function cmp(what, fo, ff) {
  const a = run(fo), b = run(ff);
  T.ok(a === b, `${what}: orig=${a.slice(0, 120)} fast=${b.slice(0, 120)}`);
  return a;
}

function streamCompress(B, q, data, chunks, outSize) {
  const log = [];
  const s = new B.CompressStream(q);
  let pos = 0;
  for (const n of chunks) {
    const input = data.subarray(pos, pos + n);
    pos += n;
    let off = 0;
    for (let guard = 0; guard < 100000; guard++) {
      const r = s.compress(input.subarray(off), outSize);
      log.push(r.code + ":" + r.input_offset + ":" + Buffer.from(r.buf).toString("base64"));
      off += r.input_offset;
      const code = r.code;
      r.free();
      if (code !== 3 && off >= input.length) break;
    }
  }
  for (let guard = 0; guard < 100000; guard++) {
    const r = s.compress(undefined, outSize);
    log.push("f" + r.code + ":" + Buffer.from(r.buf).toString("base64"));
    const code = r.code;
    r.free();
    if (code === 1) break;
  }
  log.push("total=" + s.total_out());
  s.free();
  return log.join("|");
}
function streamDecompress(B, data, chunks, outSize) {
  const log = [];
  const s = new B.DecompressStream();
  let pos = 0;
  try {
    for (const n of chunks) {
      const input = data.subarray(pos, pos + n);
      pos += n;
      let off = 0;
      for (let guard = 0; guard < 100000; guard++) {
        const r = s.decompress(input.subarray(off), outSize);
        log.push(r.code + ":" + r.input_offset + ":" + Buffer.from(r.buf).toString("base64"));
        off += r.input_offset;
        const code = r.code;
        r.free();
        if (code === 1) return log.join("|") + "|total=" + s.total_out();
        if (code === 2 && off >= input.length) break;
      }
    }
  } catch (e) {
    log.push("E" + describeErr(e));
  }
  return log.join("|") + "|total=" + s.total_out();
}
const chunking = (len) => {
  const out = [];
  let left = len;
  while (left > 0) {
    const n = pick([1, 13, 1000, 65536, len]);
    out.push(n);
    left -= n;
  }
  return out.length ? out : [0];
};

const files = sample(allFiles(), N, 1 << 20);
for (let i = files.length - 1; i > 0; i--) {
  const j = rint(i + 1);
  [files[i], files[j]] = [files[j], files[i]];
}
console.log("files:", files.length);
const t0 = Date.now();
for (let i = 0; i < files.length; i++) {
  const data = readBytes(files[i]);
  const name = files[i].slice(-60);
  // Nodepod: compress(new Uint8Array(data)) = quality 11 (skip q11 on the largest, orig is slow)
  let packed;
  if (data.length <= 300000) {
    const r = cmp(`${name} compress()`, () => O.compress(data), () => F.compress(data));
    if (r[0] === "B") packed = F.compress(data);
  }
  const q = rint(12);
  const r2 = cmp(`${name} compress q${q}`, () => O.compress(data, { quality: q }), () => F.compress(data, { quality: q }));
  if (!packed && r2[0] === "B") packed = F.compress(data, { quality: q });
  if (packed) {
    cmp(`${name} decompress`, () => O.decompress(packed), () => F.decompress(packed));
    const bad = packed.slice();
    bad[rint(bad.length)] ^= 1 << rint(8);
    cmp(`${name} decompress corrupt`, () => O.decompress(bad), () => F.decompress(bad));
    cmp(`${name} decompress trunc`, () => O.decompress(packed.subarray(0, rint(packed.length))), () => F.decompress(packed.subarray(0, rint(packed.length))));
    if (i % 4 === 0) {
      const ch = chunking(packed.length), os = pick([1, 100, 4096, 65536]);
      cmp(`${name} DecompressStream ${os}`, () => streamDecompress(O, packed, ch, os), () => streamDecompress(F, packed, ch, os));
    }
  }
  if (i % 8 === 0 && data.length <= 200000) {
    const ch = chunking(data.length), os = pick([16, 1000, 65536]), sq = pick([undefined, 0, 1, 5, 9, 11]);
    cmp(`${name} CompressStream q${sq} ${os}`, () => streamCompress(O, sq, data, ch, os), () => streamCompress(F, sq, data, ch, os));
  }
  if (i % 50 === 0) process.stderr.write(`  ${i}/${files.length} ${((Date.now() - t0) / 1000).toFixed(0)}s fails=${T.fails}\n`);
}
// API edge cases
const e = new Uint8Array(0);
cmp("compress empty", () => O.compress(e), () => F.compress(e));
cmp("decompress empty", () => O.decompress(e), () => F.decompress(e));
cmp("compress array", () => O.compress([1, 2, 3]), () => F.compress([1, 2, 3]));
for (const opt of [{}, { quality: 0 }, { quality: 12 }, { quality: -1 }, { quality: "5" }, { quality: 5.5 }, { foo: 1 }, { quality: null }])
  cmp(`compress opts ${JSON.stringify(opt)}`, () => O.compress(new Uint8Array([1, 2, 3, 1, 2, 3]), opt), () => F.compress(new Uint8Array([1, 2, 3, 1, 2, 3]), opt));
cmp("decompress garbage", () => O.decompress(new Uint8Array([1, 2, 3, 4])), () => F.decompress(new Uint8Array([1, 2, 3, 4])));
process.exit(T.report() ? 1 : 0);
