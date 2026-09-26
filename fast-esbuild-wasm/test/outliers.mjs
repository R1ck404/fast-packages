import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
const { fastTransform } = await import("../src/transform.mjs");
const flags = ["--log-level=silent", "--log-limit=0", "--target=esnext", "--format=cjs", "--platform=neutral", "--loader=js"];
const tsflags = ["--log-level=silent", "--log-limit=0", "--target=esnext", "--format=esm", "--loader=ts"];
const files = [];
(function walk(d) {
  let es;
  try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(m?js|cjs|ts)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      const st = statSync(p);
      if (st.size > 20000 && st.size < 5e6) files.push(p);
    }
  }
})(join(process.cwd(), "../node_modules"));
const warm = readFileSync(join(process.cwd(), "../node_modules/zod/v4/classic/schemas.js"), "utf8");
for (let i = 0; i < 30; i++) fastTransform(flags, warm);
const rows = [];
for (const f of files) {
  const code = readFileSync(f, "utf8");
  const fl = f.endsWith(".ts") ? tsflags : flags;
  if (fastTransform(fl, code) === undefined) continue;
  let best = Infinity;
  for (let i = 0; i < 2; i++) {
    const t = performance.now();
    fastTransform(fl, code);
    best = Math.min(best, performance.now() - t);
  }
  rows.push([code.length / 1e6 / (best / 1000), best, code.length, f]);
}
rows.sort((a, b) => a[0] - b[0]);
console.log(files.length, "files; median MB/s", rows[rows.length >> 1][0].toFixed(1));
for (const r of rows.slice(0, 15)) console.log(r[0].toFixed(2).padStart(7), "MB/s", r[1].toFixed(1).padStart(8), "ms", String(r[2]).padStart(8), r[3].replace(/.*node_modules[\/]/, ""));
