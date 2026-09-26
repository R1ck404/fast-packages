// Summarize a .heapprofile (sampling heap profiler): allocated bytes by function
import { readFileSync } from "node:fs";
const prof = JSON.parse(readFileSync(process.argv[2], "utf8"));
const N = Number(process.argv[3] || 30);
const by = new Map();
let total = 0;
(function walk(node) {
  const cf = node.callFrame;
  const key = `${cf.functionName || "(anon)"} ${cf.url ? cf.url.split(/[\/]/).pop() : ""}:${cf.lineNumber}`;
  by.set(key, (by.get(key) || 0) + node.selfSize);
  total += node.selfSize;
  for (const c of node.children) walk(c);
})(prof.head);
for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, N))
  console.log(((v / 1048576).toFixed(1) + " MB").padStart(10) + ((100 * v) / total).toFixed(1).padStart(6) + "%  " + k);
