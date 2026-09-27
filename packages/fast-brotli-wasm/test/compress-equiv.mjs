// Compression equivalence: fastbrotli vs brotli-wasm 3.0.1, byte for byte, on a
// corpus at every quality. Reference outputs are cached (sha256 per input and
// quality) in .scratch/brotli-ref-cache.json since q10/q11 are slow.
// usage: node packages/fast-brotli-wasm/test/compress-equiv.mjs [--q=0,1,..] [--max=N files] [--wasm=path]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { listFiles, nm, root, randomBytes, jsonText } from "../../../bench/corpus.mjs";
import { loadRaw } from "./raw.mjs";

const require = createRequire(import.meta.url);
const B = require("brotli-wasm");
const args = process.argv.slice(2);
const arg = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const qualities = arg("q", "0,1,2,3,4,5,6,7,8,9,10,11").split(",").map(Number);
const maxFiles = Number(arg("max", "400"));
const F = loadRaw(arg("wasm", undefined));

const cacheFile = join(root, ".scratch/brotli-ref-cache.json");
mkdirSync(join(root, ".scratch"), { recursive: true });
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 32);

// corpus: deterministic selection of real files of many kinds and sizes
const inputs = [];
const add = (name, bytes) => inputs.push({ name, bytes });
add("empty", new Uint8Array(0));
add("1 byte", new Uint8Array([65]));
add("2 bytes", new Uint8Array([0, 255]));
add("zeros 100KB", new Uint8Array(100000));
add("random 64KB", randomBytes(65536));
add("random 200B", randomBytes(200, 7));
add("json 300KB", new TextEncoder().encode(jsonText(300000)));
add("abc repeat 70KB", new TextEncoder().encode("abcabcabd".repeat(8000)));
const kinds = [".js", ".mjs", ".cjs", ".json", ".md", ".d.ts", ".map", ".wasm", ".css", ".html", ".txt", ".ttf", ".woff2", ".png"];
const dirArg = arg("dir", "");
const all = listFiles(dirArg || nm, kinds).sort();
const offset = Number(arg("offset", "0"));
let picked = 0;
for (let i = offset; i < all.length && picked < maxFiles; i += Math.max(1, Math.floor(all.length / maxFiles))) {
  const b = readFileSync(all[i]);
  if (b.length > 600000) continue;
  add(all[i], new Uint8Array(b));
  picked++;
}
// a few big ones for the fast qualities
const big = ["react-dom/cjs/react-dom-client.development.js", "typescript/lib/typescript.js"].map((f) => join(nm, f)).filter(existsSync);

let total = 0, mismatches = 0, cacheMisses = 0;
const t0 = Date.now();
let lastSave = Date.now();
for (const q of qualities) {
  const list = q >= 10 ? inputs : [...inputs, ...big.map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(f)) }))];
  let qMis = 0, tRef = 0, tFast = 0;
  for (const { name, bytes } of list) {
    const key = `${q}:${sha(bytes)}`;
    let ref = cache[key];
    if (!ref) {
      const s = performance.now();
      ref = sha(B.compress(bytes, { quality: q }));
      tRef += performance.now() - s;
      cache[key] = ref;
      cacheMisses++;
      if (Date.now() - lastSave > 20000) { writeFileSync(cacheFile, JSON.stringify(cache)); lastSave = Date.now(); }
    }
    const s = performance.now();
    const out = F.compress(bytes, q);
    tFast += performance.now() - s;
    total++;
    if (sha(out) !== ref) {
      mismatches++;
      qMis++;
      if (qMis <= 5) console.log(`MISMATCH q${q} ${name} (${bytes.length} bytes)`);
    }
  }
  console.log(`q${q}: ${list.length} inputs, mismatches ${qMis}, fast total ${(tFast / 1000).toFixed(1)}s${tRef ? `, ref (uncached) ${(tRef / 1000).toFixed(1)}s` : ""}`);
}
writeFileSync(cacheFile, JSON.stringify(cache));
console.log(`total ${total}, mismatches ${mismatches}, new reference entries ${cacheMisses}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(mismatches ? 1 : 0);
