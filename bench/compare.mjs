// Driver: node bench/compare.mjs <suite> <implA> <implB> ...
// Runs bench/<suite>.bench.mjs once per implementation, each in a fresh node
// process, then prints a comparison table (first impl is the baseline).
// BENCH_FILTER=<regex> limits cases. Results are also saved to results/.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fmtMs } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [suite, ...impls] = process.argv.slice(2);
if (!suite || impls.length === 0) {
  console.error("usage: node bench/compare.mjs <suite> <baselineImpl> [otherImpl...]");
  process.exit(1);
}

const all = {};
for (const impl of impls) {
  process.stderr.write(`running ${suite} with ${impl}...\n`);
  const r = spawnSync(process.execPath, ["--expose-gc", "--max-old-space-size=8192", join(here, `${suite}.bench.mjs`), impl], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    process.exit(1);
  }
  all[impl] = {};
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("RESULT ")) {
      const res = JSON.parse(line.slice(7));
      all[impl][res.name] = res;
    } else if (line.trim()) process.stderr.write(`  [${impl}] ${line}\n`);
  }
}

const base = impls[0];
const names = Object.keys(all[base]);
const rows = [];
for (const name of names) {
  const row = { case: name };
  for (const impl of impls) {
    const r = all[impl][name];
    if (!r) { row[impl] = "-"; continue; }
    let cell = fmtMs(r.ms);
    if (r.mbps) cell += ` (${r.mbps.toFixed(1)} MB/s)`;
    if (impl !== base && all[base][name]) cell += `  x${(all[base][name].ms / r.ms).toFixed(2)}`;
    row[impl] = cell;
  }
  rows.push(row);
}

const cols = ["case", ...impls];
const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
const line = (vals) => "| " + vals.map((v, i) => String(v).padEnd(widths[i])).join(" | ") + " |";
const out = [line(cols), "|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|", ...rows.map((r) => line(cols.map((c) => r[c])))].join("\n");
console.log(out);

mkdirSync(join(here, "..", "results"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(join(here, "..", "results", `${suite}-${impls.join("_vs_")}-${stamp}.md`), out + "\n\n```json\n" + JSON.stringify(all, null, 1) + "\n```\n");
