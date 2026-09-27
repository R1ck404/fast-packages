// Line-level ticks for functions matching a regex: node proflines.mjs prof.cpuprofile "print$|printExpr"
import { readFileSync } from "node:fs";
const prof = JSON.parse(readFileSync(process.argv[2], "utf8"));
const re = new RegExp(process.argv[3]);
const lines = new Map();
for (const n of prof.nodes) {
  if (!re.test(n.callFrame.functionName) || !n.positionTicks) continue;
  const file = n.callFrame.url.split(/[\/]/).pop();
  for (const pt of n.positionTicks) {
    const k = `${file}:${pt.line} (${n.callFrame.functionName})`;
    lines.set(k, (lines.get(k) || 0) + pt.ticks);
  }
}
for (const [k, v] of [...lines].sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[4] || 25))) console.log(String(v).padStart(6), k);
