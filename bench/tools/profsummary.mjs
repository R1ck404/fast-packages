// Summarize a .cpuprofile: self time per function (top N)
import { readFileSync } from "node:fs";
const prof = JSON.parse(readFileSync(process.argv[2], "utf8"));
const N = Number(process.argv[3] || 25);
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = prof.timeDeltas;
for (let i = 0; i < prof.samples.length; i++) {
  const n = byId.get(prof.samples[i]);
  const key = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url ? n.callFrame.url.split(/[\/]/).pop() : ""}:${n.callFrame.lineNumber}`;
  self.set(key, (self.get(key) || 0) + (dt[i] || 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, N))
  console.log((v / 1000).toFixed(1).padStart(9) + " ms " + ((100 * v) / total).toFixed(1).padStart(5) + "%  " + k);
