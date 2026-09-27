// Real-data differential test: fast-pako vs pako 2.1.0.
//   node fast-pako/test/corpus.mjs [--mb=N] [--dir=<extra dir>]...
// * every corpus/*.tgz: ungzip one-shot, inflate/to:string variants and
//   streaming Inflate with several push sizes (compared chunk by chunk);
// * files from node_modules (+ Nodepod's pnpm store if present, + --dir):
//   packed like Nodepod's memory-volume (files joined into ~128KB groups,
//   deflateRaw level 1, inflateRaw back; big files via Deflate({level:1,
//   raw:true}) in 256KB pushes) and deflate/gzip/deflateRaw at random
//   levels, windowBits and memLevels, each round-tripped.
import pako from "pako";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const fast = (await import(process.env.FASTPAKO_IMPL ? pathToFileURL(resolve(process.env.FASTPAKO_IMPL)).href : "../index.mjs")).default;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const MB = Number((process.argv.find((a) => a.startsWith("--mb=")) || "--mb=80").slice(5));
const dirs = [join(root, "node_modules"), "C:/Users/rickh/Documents/sandbox/Nodepod/node_modules/.pnpm", ...process.argv.filter((a) => a.startsWith("--dir=")).map((a) => a.slice(6))];

let checks = 0, failures = 0;
const fail = (m) => { failures++; if (failures <= 20) console.log("FAIL:", m); };
function eq(a, b) {
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  if (a.buffer.byteLength !== b.buffer.byteLength || a.byteOffset !== b.byteOffset) return false;
  return Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
}
function run(f) { try { return { v: f() }; } catch (e) { return { e: e instanceof Error ? "E:" + e.message : String(e) }; } }
function same(label, fa, fb) {
  checks++;
  const a = run(fa), b = run(fb);
  if ("e" in a || "e" in b) { if (a.e !== b.e) fail(`${label}: ${a.e ?? "ok"} vs ${b.e ?? "ok"}`); return a.v; }
  if (!eq(a.v, b.v)) fail(`${label}: results differ (${a.v?.length} vs ${b.v?.length})`);
  return a.v;
}
let seed = 7;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const ri = (n) => Math.floor(rnd() * n);

// ---------------------------------------------------------------- tarballs
const tgzs = readdirSync(join(root, "corpus")).filter((f) => f.endsWith(".tgz"));
for (const f of tgzs) {
  const t = new Uint8Array(readFileSync(join(root, "corpus", f)));
  const tar = same(`ungzip ${f}`, () => pako.ungzip(t), () => fast.ungzip(t));
  same(`inflate ${f}`, () => pako.inflate(t), () => fast.inflate(t));
  same(`ungzip ${f} AB`, () => pako.ungzip(t.slice().buffer), () => fast.ungzip(t.slice().buffer));
  same(`ungzip ${f} chunk1000`, () => pako.ungzip(t, { chunkSize: 1000 }), () => fast.ungzip(t, { chunkSize: 1000 }));
  for (const ps of [1 << 20, 65536, 16384, 4099]) {
    checks++;
    const log = (P) => { const out = []; const inf = new P.Inflate(); inf.onData = (c) => out.push(Buffer.from(c).toString("base64", 0, 24) + c.length + "/" + c.buffer.byteLength); for (let i = 0; i < t.length; i += ps) inf.push(t.subarray(i, i + ps), i + ps >= t.length); return out.join("|") + `|${inf.err}|${inf.msg}|${inf.strm.total_in}|${inf.strm.total_out}|${inf.strm.adler}`; };
    if (log(pako) !== log(fast)) fail(`Inflate stream ${f} push ${ps}`);
  }
  // re-compress the tar (L1 and default) and back
  if (tar && tar.length < 30e6) {
    const z1 = same(`deflateRaw L1 tar ${f}`, () => pako.deflateRaw(tar, { level: 1 }), () => fast.deflateRaw(tar, { level: 1 }));
    if (z1) same(`inflateRaw L1 tar ${f}`, () => pako.inflateRaw(z1), () => fast.inflateRaw(z1));
    if (tar.length < 12e6) {
      const g = same(`gzip tar ${f}`, () => pako.gzip(tar), () => fast.gzip(tar));
      if (g) same(`ungzip regz ${f}`, () => pako.ungzip(g), () => fast.ungzip(g));
    }
  }
}
console.log(`tarballs: ${tgzs.length}, ${checks} checks, ${failures} failures`);

// ---------------------------------------------------------------- files
const files = [];
let total = 0;
let budget = 0;
function walk(d, depth) {
  if (total > budget || depth > 12) return;
  let ents;
  try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (total > budget) return;
    const p = join(d, e.name);
    if (e.isDirectory()) { if (e.name !== ".bin" && e.name !== ".cache") walk(p, depth + 1); }
    else if (e.isFile() && ri(4) === 0) {
      try { const s = statSync(p).size; if (s >= 1 && s < 8e6) { files.push(p); total += s; } } catch {}
    }
  }
}
for (const d of dirs) { budget = total + (MB * 1e6) / dirs.length; walk(d, 0); }
console.log(`files: ${files.length} (${(total / 1e6).toFixed(1)} MB)`);
const c0 = checks;
let group = [], gsize = 0, gi = 0;
function flushGroup() {
  if (!group.length) return;
  const joined = new Uint8Array(gsize);
  let o = 0;
  for (const g of group) { joined.set(g, o); o += g.length; }
  const z = same(`group#${gi} deflateRaw L1`, () => pako.deflateRaw(joined, { level: 1 }), () => fast.deflateRaw(joined, { level: 1 }));
  if (z) same(`group#${gi} inflateRaw`, () => pako.inflateRaw(z), () => fast.inflateRaw(z));
  gi++;
  group = []; gsize = 0;
}
for (const p of files) {
  let b;
  try { b = new Uint8Array(readFileSync(p)); } catch { continue; }
  if (b.length >= 512 * 1024) {
    // big file: Nodepod solo packing
    const solo = (P) => { const d = new P.Deflate({ level: 1, raw: true }); for (let o = 0; o < b.length; o += 262144) { const e = Math.min(b.length, o + 262144); d.push(b.subarray(o, e), e === b.length); } return d.result; };
    const z = same(`solo ${p}`, () => solo(pako), () => solo(fast));
    if (z) same(`solo inflateRaw ${p}`, () => pako.inflateRaw(z), () => fast.inflateRaw(z));
  } else {
    group.push(b); gsize += b.length;
    if (gsize >= 128 * 1024) flushGroup();
  }
  if (ri(6) === 0) {
    const fn = ["deflate", "gzip", "deflateRaw"][ri(3)];
    const o = { level: ri(10) };
    if (ri(3) === 0) o.windowBits = 9 + ri(7);
    if (ri(4) === 0) o.memLevel = 1 + ri(9);
    const z = same(`${fn} ${JSON.stringify(o)} ${p}`, () => pako[fn](b, { ...o }), () => fast[fn](b, { ...o }));
    const ifn = fn === "deflate" ? "inflate" : fn === "gzip" ? "ungzip" : "inflateRaw";
    const io = fn === "gzip" ? {} : o.windowBits ? { windowBits: o.windowBits } : {};
    if (z) same(`${ifn} ${p}`, () => pako[ifn](z, { ...io }), () => fast[ifn](z, { ...io }));
    if (z && ri(4) === 0 && fn !== "deflateRaw") same(`${ifn} to:string ${p}`, () => pako[ifn](z, { ...io, to: "string" }), () => fast[ifn](z, { ...io, to: "string" }));
  }
}
flushGroup();
console.log(`files: ${checks - c0} checks`);
console.log(`${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
