// Runs a benchmark suite for several implementations in alternating fresh
// processes (A B A B ...) and reports the best (minimum) median per case.
// Robust against CPU frequency drift (battery / thermal throttling).
// usage: node bench/interleave.mjs <suite> <rounds> <implA> <implB> [...]
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [suite, roundsArg, ...impls] = process.argv.slice(2);
const rounds = Number(roundsArg);
const best = {}; // impl -> case -> result
const order = [];
for (let r = 0; r < rounds; r++) {
  for (const impl of impls) {
    process.stderr.write(`round ${r + 1}/${rounds}: ${impl}...\n`);
    const out = spawnSync(process.execPath, ["--expose-gc", "--max-old-space-size=8192", join(here, `${suite}.bench.mjs`), impl], {
      encoding: "utf8",
      maxBuffer: 1 << 26,
      env: process.env,
    });
    if (out.status !== 0) {
      process.stderr.write(out.stdout + out.stderr);
      process.exit(1);
    }
    for (const line of out.stdout.split("\n")) {
      if (!line.startsWith("RESULT ")) continue;
      const res = JSON.parse(line.slice(7));
      if (!order.includes(res.name)) order.push(res.name);
      const cur = (best[impl] ??= {})[res.name];
      if (!cur || res.ms < cur.ms) best[impl][res.name] = res;
    }
  }
}
const fmt = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : ms >= 1 ? ms.toFixed(2) + " ms" : (ms * 1000).toFixed(1) + " us");
const base = impls[0];
const rows = [["case", ...impls]];
for (const name of order) {
  const b = best[base]?.[name];
  rows.push([
    name,
    ...impls.map((impl) => {
      const r = best[impl]?.[name];
      if (!r) return "-";
      const speed = impl !== base && b ? `  x${(b.ms / r.ms).toFixed(2)}` : "";
      return fmt(r.ms) + speed;
    }),
  ]);
}
const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
const lines = rows.map((r) => "| " + r.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |");
lines.splice(1, 0, "|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|");
const table = lines.join("\n");
console.log(table);
mkdirSync(join(here, "../results"), { recursive: true });
const file = join(here, `../results/${suite}-${impls.join("_vs_")}-interleaved-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
writeFileSync(file, table + "\n\n```json\n" + JSON.stringify(best, null, 1) + "\n```\n");
console.log("\nwritten " + file);
