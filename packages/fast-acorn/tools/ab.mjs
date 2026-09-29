// A/B harness for parser variants: alternates variants in fresh processes for
// several rounds and reports the minimum time per file (robust to turbo /
// thermal noise). usage: node packages/fast-acorn/tools/ab.mjs <parserA.mjs> <parserB.mjs> [rounds] [--locs]
// (each a parser.mjs with its shared.mjs next to it, e.g. packages/fast-acorn/src/parser.mjs)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [a, b, roundsArg] = process.argv.slice(2);
const rounds = Number(roundsArg || 4);
const locs = process.argv.includes("--locs") || process.env.AB_LOCS === "1";
const self = fileURLToPath(import.meta.url);

if (process.env.AB_CHILD) {
  const { fastParse } = await import(process.env.AB_CHILD);
  const { getOptions } = await import(new URL("./shared.mjs", process.env.AB_CHILD).href);
  const { loadJs } = await import("../../../bench/corpus.mjs");
  const files = loadJs(true);
  const out = {};
  for (const f of files) {
    const opts = getOptions({ ecmaVersion: "latest", sourceType: f.module ? "module" : "script", locations: locs });
    const reps = f.code.length < 100000 ? 200 : 8;
    for (let i = 0; i < 3; i++) fastParse(f.code, opts);
    let best = Infinity;
    for (let r = 0; r < reps; r++) {
      const t = performance.now();
      fastParse(f.code, opts);
      best = Math.min(best, performance.now() - t);
    }
    out[f.name] = best;
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}

const toUrl = (p) => new URL(p, "file:///" + process.cwd().replace(/\\/g, "/") + "/").href;
const res = { A: {}, B: {} };
for (let r = 0; r < rounds; r++) {
  for (const [k, mod] of [["A", a], ["B", b]]) {
    const out = spawnSync(process.execPath, [self], { env: { ...process.env, AB_CHILD: toUrl(mod), AB_LOCS: locs ? "1" : "0" }, encoding: "utf8" });
    if (out.status !== 0) {
      console.error(out.stderr);
      process.exit(1);
    }
    const j = JSON.parse(out.stdout.trim().split("\n").pop());
    for (const [f, ms] of Object.entries(j)) res[k][f] = Math.min(res[k][f] ?? Infinity, ms);
  }
}
let sa = 0, sb = 0;
for (const f of Object.keys(res.A)) {
  sa += res.A[f];
  sb += res.B[f];
  console.log(`${f.padEnd(36)} A ${res.A[f].toFixed(3).padStart(9)}  B ${res.B[f].toFixed(3).padStart(9)}  B/A ${(res.B[f] / res.A[f]).toFixed(3)}`);
}
console.log(`TOTAL A ${sa.toFixed(2)}  B ${sb.toFixed(2)}  B/A ${(sb / sa).toFixed(3)}`);
