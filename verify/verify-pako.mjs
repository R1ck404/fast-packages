// Independent differential check: @r1ck404/fast-pako vs pako 2.1.0, Nodepod-style usage
// plus randomized options, streaming, corruption and truncation.
// usage: node verify/verify-pako.mjs [nFiles]
import pako from "pako";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allFiles, sample, readBytes, eqBytes, capture, rnd, rint, pick, Tally, root } from "./corpus.mjs";

const F = (await import(process.env.FAST_PAKO || "@r1ck404/fast-pako")).default;
const N = Number(process.argv[2] || 1200);
const T = new Tally("pako");

function same(a, b) {
  if (a.ok !== b.ok) return false;
  if (!a.ok) return a.e === b.e;
  const x = a.v, y = b.v;
  if (x instanceof Uint8Array || y instanceof Uint8Array) return eqBytes(x, y);
  return x === y;
}
const show = (r) => (r.ok ? (r.v instanceof Uint8Array ? `bytes(${r.v.length})` : typeof r.v === "string" ? `str(${r.v.length})` : String(r.v)) : r.e);

function cmp(what, fa, fb) {
  const a = capture(fa), b = capture(fb);
  T.ok(same(a, b), `${what}: pako=${show(a)} fast=${show(b)}`);
  return a;
}

function randDeflateOpts() {
  const o = {};
  if (rnd() < 0.8) o.level = rint(11) - 1;
  if (rnd() < 0.3) o.memLevel = 1 + rint(9);
  if (rnd() < 0.3) o.strategy = rint(5);
  if (rnd() < 0.3) o.windowBits = 8 + rint(8);
  if (rnd() < 0.2) o.chunkSize = pick([64, 100, 1000, 4096, 16384, 65536]);
  const w = rint(3);
  if (w === 1) o.raw = true;
  else if (w === 2) o.gzip = true;
  return o;
}

// streaming run capturing every observable
function stream(Cls, opts, data, pushes) {
  const log = [];
  const s = new Cls(opts);
  const origOnData = s.onData;
  s.onData = function (c) {
    log.push(typeof c === "string" ? "s:" + c : "b:" + Buffer.from(c).toString("base64"));
    origOnData.call(this, c);
  };
  let pos = 0;
  for (const [n, mode] of pushes) {
    const end = Math.min(data.length, pos + n);
    const r = s.push(data.subarray(pos, end), end >= data.length && mode === undefined ? true : mode ?? false);
    log.push(`ret=${r} err=${s.err} msg=${s.msg} ended=${s.ended} ti=${s.strm?.total_in} to=${s.strm?.total_out} ad=${s.strm?.adler}`);
    pos = end;
    if (s.ended) break;
  }
  if (!s.ended) {
    const r = s.push(new Uint8Array(0), true);
    log.push(`final ret=${r} err=${s.err} msg=${s.msg}`);
  }
  log.push(s.result instanceof Uint8Array ? "result:" + Buffer.from(s.result).toString("base64") : "result:" + String(s.result));
  if (s.header) log.push("hdr:" + JSON.stringify(s.header));
  return log.join("\n");
}
function randPushes(len) {
  const out = [];
  let left = len;
  while (left > 0) {
    const n = pick([1, 7, 100, 1000, 16384, 65536, 1 << 20, len]);
    const mode = rnd() < 0.1 ? pick([0, 2, 3]) : undefined;
    out.push([n, mode]);
    left -= n;
  }
  return out;
}

const files = sample(allFiles(), N);
console.log("files:", files.length);
let t0 = Date.now();
for (let fi = 0; fi < files.length; fi++) {
  const data = readBytes(files[fi]);
  const name = files[fi].slice(-60);
  // Nodepod: content packing
  const p1 = cmp(`${name} deflateRaw L1`, () => pako.deflateRaw(data, { level: 1 }), () => F.deflateRaw(data, { level: 1 }));
  if (p1.ok) {
    cmp(`${name} inflateRaw L1`, () => pako.inflateRaw(p1.v), () => F.inflateRaw(p1.v));
    T.ok(eqBytes(F.inflateRaw(p1.v), data), `${name} roundtrip`);
  }
  // Nodepod: zlib polyfill defaults
  const g = cmp(`${name} gzip`, () => pako.gzip(data), () => F.gzip(data));
  if (g.ok) {
    cmp(`${name} ungzip`, () => pako.ungzip(g.v), () => F.ungzip(g.v));
    cmp(`${name} ungzip to:string`, () => pako.ungzip(g.v, { to: "string" }), () => F.ungzip(g.v, { to: "string" }));
    // corruption + truncation
    const bad = g.v.slice();
    const k = rint(bad.length);
    bad[k] ^= 1 << rint(8);
    cmp(`${name} ungzip corrupt@${k}`, () => pako.ungzip(bad), () => F.ungzip(bad));
    const cut = g.v.subarray(0, rint(g.v.length));
    cmp(`${name} ungzip trunc@${cut.length}`, () => pako.ungzip(cut), () => F.ungzip(cut));
  }
  // randomized one-shot
  for (let r = 0; r < 2; r++) {
    const o = randDeflateOpts();
    const c = cmp(`${name} deflate ${JSON.stringify(o)}`, () => pako.deflate(data, { ...o }), () => F.deflate(data, { ...o }));
    if (c.ok) {
      const io = { raw: o.raw, windowBits: o.raw ? 15 : undefined };
      if (!o.raw) delete io.raw;
      if (io.windowBits === undefined) delete io.windowBits;
      cmp(`${name} inflate ${JSON.stringify(io)}`, () => pako.inflate(c.v, { ...io }), () => F.inflate(c.v, { ...io }));
    }
  }
  // streaming (Nodepod: Deflate({level:1, raw:true}) pushed in slices; zlib streams)
  if (fi % 3 === 0) {
    const pushes = randPushes(data.length);
    const o = rnd() < 0.5 ? { level: 1, raw: true } : randDeflateOpts();
    const a = capture(() => stream(pako.Deflate, { ...o }, data, pushes));
    const b = capture(() => stream(F.Deflate, { ...o }, data, pushes));
    T.ok(a.ok === b.ok && (a.ok ? a.v === b.v : a.e === b.e), `${name} Deflate stream ${JSON.stringify(o)} ${JSON.stringify(pushes)}\n${(a.v || a.e || "").slice(0, 300)}\n---\n${(b.v || b.e || "").slice(0, 300)}`);
    const comp = pako.deflate(data, { level: 6, raw: !!o.raw });
    const ip = randPushes(comp.length);
    const io = o.raw ? { raw: true } : {};
    if (rnd() < 0.3) io.chunkSize = pick([64, 1000, 16384]);
    if (rnd() < 0.2) io.to = "string";
    const c = capture(() => stream(pako.Inflate, { ...io }, comp, ip));
    const d = capture(() => stream(F.Inflate, { ...io }, comp, ip));
    T.ok(c.ok === d.ok && (c.ok ? c.v === d.v : c.e === d.e), `${name} Inflate stream ${JSON.stringify(io)} ${JSON.stringify(ip)}`);
  }
  if (fi % 200 === 0) process.stderr.write(`  ${fi}/${files.length} ${((Date.now() - t0) / 1000).toFixed(0)}s fails=${T.fails}\n`);
}

// npm tarballs (install hot path)
try {
  for (const f of readdirSync(join(root, "corpus")).filter((f) => f.endsWith(".tgz"))) {
    const tgz = new Uint8Array(readFileSync(join(root, "corpus", f)));
    cmp(`ungzip ${f}`, () => pako.ungzip(tgz), () => F.ungzip(tgz));
    const ab = tgz.slice().buffer;
    cmp(`ungzip(ArrayBuffer) ${f}`, () => pako.ungzip(ab), () => F.ungzip(ab));
  }
} catch (e) {
  console.log("no corpus tarballs:", e.message);
}

// odd inputs: strings, arrays, empty, options objects reused
const odd = ["", "hello", "héllo wörld ✓ 😀", "\0\0\0", "a".repeat(100000)];
for (const s of odd) {
  cmp(`deflate str ${s.length}`, () => pako.deflate(s), () => F.deflate(s));
  cmp(`gzip str ${s.length}`, () => pako.gzip(s, { header: { name: "x.txt", comment: "c", time: 5, os: 3, extra: [1, 2, 3], hcrc: true } }), () => F.gzip(s, { header: { name: "x.txt", comment: "c", time: 5, os: 3, extra: [1, 2, 3], hcrc: true } }));
  const d = pako.deflate(s);
  cmp(`inflate str ${s.length} to:string`, () => pako.inflate(d, { to: "string" }), () => F.inflate(d, { to: "string" }));
}
cmp("inflate empty", () => pako.inflate(new Uint8Array(0)), () => F.inflate(new Uint8Array(0)));
cmp("inflate garbage", () => pako.inflate(new Uint8Array([1, 2, 3, 4, 5])), () => F.inflate(new Uint8Array([1, 2, 3, 4, 5])));
cmp("inflateRaw garbage", () => pako.inflateRaw(new Uint8Array([255, 255, 255])), () => F.inflateRaw(new Uint8Array([255, 255, 255])));
cmp("deflate array", () => pako.deflate([1, 2, 3]), () => F.deflate([1, 2, 3]));
cmp("deflate bad level", () => pako.deflate("x", { level: 42 }), () => F.deflate("x", { level: 42 }));
cmp("deflate dict", () => pako.deflate("hello hello", { dictionary: "hello" }), () => F.deflate("hello hello", { dictionary: "hello" }));
{
  const d = pako.deflate("hello hello", { dictionary: "hello" });
  cmp("inflate dict", () => pako.inflate(d, { dictionary: "hello" }), () => F.inflate(d, { dictionary: "hello" }));
  cmp("inflate missing dict", () => pako.inflate(d), () => F.inflate(d));
}
process.exit(T.report() ? 1 : 0);
