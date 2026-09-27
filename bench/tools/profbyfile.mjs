// Self time per source file (and top functions per file) from a .cpuprofile
import { readFileSync } from "node:fs";
const prof = JSON.parse(readFileSync(process.argv[2], "utf8"));
const topN = Number(process.argv[3] || 6);
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const fileT = new Map(), fnT = new Map();
let total = 0;
for (let i = 0; i < prof.samples.length; i++) {
  const n = byId.get(prof.samples[i]);
  const dt = prof.timeDeltas[i] || 0;
  total += dt;
  const file = n.callFrame.url ? n.callFrame.url.split(/[\/]/).pop() : n.callFrame.functionName || "(native)";
  fileT.set(file, (fileT.get(file) || 0) + dt);
  const key = file + "::" + (n.callFrame.functionName || "(anon)");
  fnT.set(key, (fnT.get(key) || 0) + dt);
}
for (const [file, t] of [...fileT].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`${((100 * t) / total).toFixed(1).padStart(5)}%  ${file}`);
  const fns = [...fnT].filter(([k]) => k.startsWith(file + "::")).sort((a, b) => b[1] - a[1]).slice(0, topN);
  console.log("        " + fns.map(([k, v]) => `${k.split("::")[1]} ${((100 * v) / total).toFixed(1)}`).join(", "));
}
