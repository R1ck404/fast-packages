// Decompression benchmark: brotli-wasm@3.0.1 decompress (JS API, copies
// in/out), our reference `decompress` export (brotli-decompressor, opt-level 3)
// and `decompress_fast`, both called with the input already in wasm memory
// plus a copy-out of the result (same work brotli-wasm's glue does).
// Min-of-samples, implementations interleaved round by round (noisy machine).
// node fast-brotli-wasm/test/decode-bench.mjs [--quick] [--rounds N]
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { brotliWasm, exportsNow, eqBytes } from "./decode-common.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const nm = join(here, "../../node_modules");
const QUICK = process.argv.includes("--quick");
const ri = process.argv.indexOf("--rounds");
const ROUNDS = ri > 0 ? +process.argv[ri + 1] : QUICK ? 5 : 15;

const rd = (rel) => new Uint8Array(readFileSync(join(nm, rel)));
function jsonText(target) {
  const items = [];
  let size = 0;
  for (let i = 0; size < target; i++) {
    const s = JSON.stringify({ id: i, name: `package-${i % 977}`, version: `${i % 13}.${i % 7}.${i % 29}`, deps: { a: "^1.0.0", ["b" + (i % 31)]: "~2.3.4" }, ok: i % 3 === 0 });
    items.push(s);
    size += s.length + 1;
  }
  return new TextEncoder().encode("[" + items.join(",") + "]");
}
// npm-package-like: many small files concatenated (package.json, README, js)
function npmLike() {
  const files = ["react/package.json", "react/README.md", "react/index.js", "react/cjs/react.production.js", "zod/package.json", "zod/v4/classic/errors.js", "zod/v4/classic/schemas.js", "zod/v4/core/util.js"];
  const parts = [];
  for (const f of files) {
    try { parts.push(rd(f)); } catch {}
  }
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const inputs = [
  ["zod errors.js 1.6KB", rd("zod/v4/classic/errors.js")],
  ["json 16KB", jsonText(16000)],
  ["zod schemas.js 51KB", rd("zod/v4/classic/schemas.js")],
  ["npm-like 90KB", npmLike()],
  ["react-dom prod 536KB", rd("react-dom/cjs/react-dom-client.production.js")],
  ["rollup 948KB", rd("rollup/dist/es/shared/node-entry.js")],
];
const configs = QUICK
  ? [[1, 22], [5, 22], [9, 22], [11, 22]]
  : [[1, 22], [5, 22], [9, 22], [11, 22], [5, 16], [11, 16], [9, 24]];

const C = zlib.constants;
const cases = [];
for (const [name, raw] of inputs) {
  for (const [q, w] of configs) {
    if (w === 16 && raw.length < 100000) continue;
    const comp = new Uint8Array(zlib.brotliCompressSync(raw, { params: { [C.BROTLI_PARAM_QUALITY]: q, [C.BROTLI_PARAM_LGWIN]: w, [C.BROTLI_PARAM_SIZE_HINT]: raw.length } }));
    cases.push({ label: `${name} q${q} w${w}`, raw, comp });
  }
}

const now = () => performance.now();
const e = exportsNow();

function makeRunners(c) {
  const n = c.comp.length;
  const p = e.alloc(n);
  new Uint8Array(e.memory.buffer, p, n).set(c.comp);
  const hdr = e.hdr();
  const viaExport = (name) => () => {
    if (e[name](p, n) !== 0) throw new Error(name + " failed");
    const h = new Uint32Array(e.memory.buffer, hdr, 2);
    const out = new Uint8Array(e.memory.buffer, h[0], h[1]).slice();
    e.release();
    return out;
  };
  return {
    "brotli-wasm": () => brotliWasm.decompress(c.comp),
    reference: viaExport("decompress"),
    fast: viaExport("decompress_fast"),
    fastOnly: viaExport("decompress_fast_only"),
  };
}

const IMPLS = ["brotli-wasm", "reference", "fast"];
const results = [];
for (const c of cases) {
  const run = makeRunners(c);
  // correctness + the fast path must really be taken
  for (const k of [...IMPLS, "fastOnly"]) {
    if (!eqBytes(run[k](), c.raw)) throw new Error(`${c.label}: ${k} output mismatch`);
  }
  // calibrate a batch to ~20ms for the slowest impl
  let t0 = now(), calls = 0;
  while (now() - t0 < 60) { run.reference(); calls++; }
  const batch = Math.max(1, Math.round((20 * calls) / (now() - t0)));
  const best = Object.fromEntries(IMPLS.map((k) => [k, Infinity]));
  for (let r = 0; r < ROUNDS; r++) {
    for (const k of IMPLS) {
      const s = now();
      for (let i = 0; i < batch; i++) run[k]();
      best[k] = Math.min(best[k], (now() - s) / batch);
    }
  }
  const row = { case: c.label, in: c.comp.length, out: c.raw.length };
  for (const k of IMPLS) row[k] = best[k];
  results.push(row);
  const mbps = (ms) => ((c.raw.length / 1e6) / (ms / 1e3)).toFixed(0);
  console.log(
    `${c.label.padEnd(34)} ${String(c.comp.length).padStart(7)} -> ${String(c.raw.length).padStart(7)}  ` +
      IMPLS.map((k) => `${k} ${best[k].toFixed(3)}ms (${mbps(best[k])}MB/s)`).join("  ") +
      `  | fast vs ref ${(best.reference / best.fast).toFixed(2)}x, vs brotli-wasm ${(best["brotli-wasm"] / best.fast).toFixed(2)}x`,
  );
}
const geo = (k) => Math.exp(results.reduce((a, r) => a + Math.log(r[k] / r.fast), 0) / results.length);
console.log(`\ngeomean speedup of decompress_fast: vs reference ${geo("reference").toFixed(2)}x, vs brotli-wasm ${geo("brotli-wasm").toFixed(2)}x`);
