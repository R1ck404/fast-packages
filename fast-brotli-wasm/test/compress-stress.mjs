// Compression equivalence on generated inputs that stress the encoder's edge
// cases (every quality, byte-identical to brotli-wasm 3.0.1): all sizes up to
// 300 bytes, long repeats (matches longer than the Zopfli length limits and
// the relaxation tables), periodic data with drifting periods (distance-cache
// hits at +-1..3), text built from static-dictionary words with case
// transforms and suffixes, low/high entropy binary, and mixtures. Reference
// outputs are cached like compress-equiv's.
// usage: node fast-brotli-wasm/test/compress-stress.mjs [--n=300] [--seed=1] [--q=0,..,11] [--wasm=path]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { root } from "../../bench/corpus.mjs";
import { loadRaw } from "./raw.mjs";

const require = createRequire(import.meta.url);
const B = require("brotli-wasm");
const args = process.argv.slice(2);
const arg = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const qualities = arg("q", "0,1,2,3,4,5,6,7,8,9,10,11").split(",").map(Number);
const N = Number(arg("n", "300"));
let seed = Number(arg("seed", "1")) >>> 0 || 1;
const F = loadRaw(arg("wasm", undefined));

const cacheFile = join(root, ".scratch/brotli-ref-cache.json");
mkdirSync(join(root, ".scratch"), { recursive: true });
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 32);

const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};
const ri = (n) => Math.floor(rnd() * n);
const pick = (a) => a[ri(a.length)];
const enc = new TextEncoder();

const words = ["the", "of", "and", "to", "in", "is", "that", "for", "it", "with", "as", "was", "on", "be", "at", "by", "this", "have", "from", "or", "one", "had", "not", "but", "what", "all", "were", "when", "we", "there", "can", "an", "your", "which", "their", "said", "if", "do", "will", "each", "about", "how", "up", "out", "them", "then", "she", "many", "some", "so", "these", "would", "other", "into", "has", "more", "her", "two", "like", "him", "see", "time", "could", "no", "make", "than", "first", "been", "its", "who", "now", "people", "my", "made", "over", "did", "down", "only", "way", "find", "use", "may", "water", "long", "little", "very", "after", "words", "called", "just", "where", "most", "know", "function", "return", "const", "export", "import", "default", "string", "number", "object", "undefined", "prototype", "information", "international", "development", "government", "University", "COPYRIGHT", "javascript", "http://www.", ".com/", " the ", "ing ", "ed ", " ", "été", "中文"];
const suffixes = [" ", ", ", ". ", "(", "=\"", "='", ">", "\n", "s ", "ed ", "ing ", " of ", " the ", "ly ", ":", "/", "\"", "]"];

function textish(n) {
  let s = "";
  while (s.length < n) {
    let w = pick(words);
    const t = rnd();
    if (t < 0.15) w = w[0].toUpperCase() + w.slice(1);
    else if (t < 0.2) w = w.toUpperCase();
    s += w + pick(suffixes);
    if (rnd() < 0.02) s += ri(100000);
  }
  return enc.encode(s.slice(0, n));
}
function randomBytes(n, alphabet = 256) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = ri(alphabet);
  return b;
}
function repeats(n) {
  // long exact repeats (matches of hundreds/thousands of bytes) with edits
  const unit = randomBytes(1 + ri(rnd() < 0.5 ? 40 : 700), 1 + ri(255));
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = unit[i % unit.length];
  const edits = ri(8);
  for (let e = 0; e < edits; e++) b[ri(n)] = ri(256);
  return b;
}
function periodic(n) {
  // records whose length drifts by -3..3: distance-cache candidates near the last distances
  const out = [];
  let len = 0;
  let period = 8 + ri(120);
  const base = textish(period + 8);
  while (len < n) {
    period = Math.max(4, period + ri(7) - 3);
    const rec = base.slice(0, Math.min(period, base.length));
    const r = rec.slice();
    if (rnd() < 0.5) r[ri(r.length)] = 48 + ri(10);
    out.push(r);
    len += r.length;
  }
  const b = new Uint8Array(len);
  let o = 0;
  for (const r of out) { b.set(r, o); o += r.length; }
  return b.slice(0, n);
}
function lowEntropy(n) {
  const k = 1 + ri(4);
  const b = new Uint8Array(n);
  let run = 0, v = ri(256);
  for (let i = 0; i < n; i++) {
    if (run-- <= 0) { v = ri(k) * 17; run = ri(300); }
    b[i] = v;
  }
  return b;
}
function mixture(n) {
  const gens = [textish, randomBytes, repeats, periodic, lowEntropy];
  const parts = [];
  let len = 0;
  while (len < n) {
    const m = Math.min(n - len, 16 + ri(4000));
    const part = pick(gens)(m);
    parts.push(part);
    len += part.length;
  }
  const b = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { b.set(p, o); o += p.length; }
  return b;
}

const inputs = [];
// every size 0..300 from a few generators
for (let n = 0; n <= 300; n++) inputs.push([`text ${n}`, textish(n)]);
for (let n = 0; n <= 300; n += 7) inputs.push([`random ${n}`, randomBytes(n)], [`repeat ${n}`, repeats(Math.max(n, 1))]);
const gens = [["text", textish], ["random", (n) => randomBytes(n, 1 + ri(256))], ["repeats", repeats], ["periodic", periodic], ["lowentropy", lowEntropy], ["mixture", mixture]];
for (let i = 0; i < N; i++) {
  const [name, g] = gens[i % gens.length];
  const size = rnd() < 0.7 ? 300 + ri(8000) : 8000 + ri(120000);
  inputs.push([`${name} #${i} (${size})`, g(size)]);
}

let total = 0, mismatches = 0, cacheMisses = 0;
const t0 = Date.now();
let lastSave = Date.now();
for (const q of qualities) {
  let qMis = 0;
  for (const [name, bytes] of inputs) {
    const key = `${q}:${sha(bytes)}`;
    let ref = cache[key];
    if (!ref) {
      ref = sha(B.compress(bytes, { quality: q }));
      cache[key] = ref;
      cacheMisses++;
      if (Date.now() - lastSave > 20000) { writeFileSync(cacheFile, JSON.stringify(cache)); lastSave = Date.now(); }
    }
    total++;
    if (sha(F.compress(bytes, q)) !== ref) {
      mismatches++;
      qMis++;
      if (qMis <= 5) console.log(`MISMATCH q${q} ${name} (${bytes.length} bytes)`);
    }
  }
  console.log(`q${q}: ${inputs.length} inputs, mismatches ${qMis}`);
}
writeFileSync(cacheFile, JSON.stringify(cache));
console.log(`total ${total}, mismatches ${mismatches}, new reference entries ${cacheMisses}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(mismatches ? 1 : 0);
