// A/B timing of decompress_fast_only between wasm builds (pure decode time).
// Paired ABBA rounds, median of per-round ratios (robust on a noisy machine),
// plus min times. node decode-ab.mjs base.wasm other.wasm [...]
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const nm = new URL("../../node_modules/", import.meta.url);
const rd = (r) => new Uint8Array(readFileSync(new URL(r, nm)));
const C = zlib.constants;
const QUICK = process.env.QUICK === "1";
const files = [["zod-err 1.6K", "zod/v4/classic/errors.js"], ["schemas 51K", "zod/v4/classic/schemas.js"], ["react-dom 536K", "react-dom/cjs/react-dom-client.production.js"], ["rollup 948K", "rollup/dist/es/shared/node-entry.js"]];
const cases = [];
for (const [n, f] of files) for (const q of QUICK ? [1, 11] : [1, 5, 9, 11]) {
  const raw = rd(f);
  cases.push({ label: `${n} q${q}`, comp: new Uint8Array(zlib.brotliCompressSync(raw, { params: { [C.BROTLI_PARAM_QUALITY]: q, [C.BROTLI_PARAM_SIZE_HINT]: raw.length } })) });
}
const wasms = process.argv.slice(2).map((p) => new WebAssembly.Instance(new WebAssembly.Module(readFileSync(p)), {}).exports);
const ROUNDS = +(process.env.ROUNDS || 60);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const logs = wasms.map(() => 0);
for (const c of cases) {
  const runs = wasms.map((ex) => {
    const p = ex.alloc(c.comp.length);
    new Uint8Array(ex.memory.buffer, p, c.comp.length).set(c.comp);
    return () => { if (ex.decompress_fast_only(p, c.comp.length) !== 0) throw new Error("fail"); ex.release(); };
  });
  runs.forEach((r) => { for (let i = 0; i < 20; i++) r(); });
  let t0 = performance.now(), k = 0;
  while (performance.now() - t0 < 20) { runs[0](); k++; }
  const batch = Math.max(1, Math.round((k * 2) / (performance.now() - t0)));
  const time = (run) => { const s = performance.now(); for (let j = 0; j < batch; j++) run(); return (performance.now() - s) / batch; };
  const mins = wasms.map(() => Infinity);
  const ratios = wasms.map(() => []);
  for (let r = 0; r < ROUNDS; r++) {
    for (let i = 1; i < wasms.length; i++) {
      const a1 = time(runs[0]), b1 = time(runs[i]), b2 = time(runs[i]), a2 = time(runs[0]);
      ratios[i].push((a1 + a2) / (b1 + b2));
      mins[0] = Math.min(mins[0], a1, a2);
      mins[i] = Math.min(mins[i], b1, b2);
    }
  }
  const rs = ratios.map((x, i) => (i === 0 ? 1 : med(x)));
  rs.forEach((r, i) => (logs[i] += Math.log(r)));
  console.log(c.label.padEnd(18), mins.map((b) => (b * 1000).toFixed(1).padStart(8) + "us").join(" "), "  ", rs.slice(1).map((r) => r.toFixed(3) + "x").join(" "));
}
console.log("geomean speedup vs first (median paired ratio):", logs.slice(1).map((t) => Math.exp(t / cases.length).toFixed(3) + "x").join(" "));
