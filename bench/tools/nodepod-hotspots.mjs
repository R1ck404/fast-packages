// Where inside Nodepod's own runtime does the time go? For samples whose
// first frame with a URL is Nodepod's worker bundle (dist/__worker__.js,
// from the unminified profiling build), prints self time per Nodepod source
// file (esbuild's `// src/...` markers in the bundle) and per function, plus
// inclusive time per function (each function counted once per sample).
// usage: node bench/tools/nodepod-hotspots.mjs <profile dir> [--dist DIR] [--top N]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "../../..");
const args = process.argv.slice(2);
const dir = args[0];
const dist = args.includes("--dist") ? args[args.indexOf("--dist") + 1] : join(root, ".scratch/nodepod-prof/dist");
const top = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) : 30;

// line (0-based) -> source file of the bundle
const bundle = readFileSync(join(dist, "__worker__.js"), "utf8").split("\n");
const fileAt = [];
let cur = "(bundle)";
for (let i = 0; i < bundle.length; i++) {
  // esbuild's "  // src/polyfills/fs.ts" / "  // ../node_modules/.pnpm/x@1/node_modules/x/dist/x.mjs"
  const m = bundle[i].match(/^\s*\/\/ (\S+\.(?:[mc]?[jt]sx?|json))$/);
  if (m) {
    const nm = m[1].lastIndexOf("node_modules/");
    if (nm >= 0) {
      const parts = m[1].slice(nm + 13).split("/");
      cur = "npm:" + (parts[0].startsWith("@") ? parts[0] + "/" + parts[1] : parts[0]);
    } else cur = m[1].replace(/^(?:\.\.\/)*(?:[^/]+\/)*?(?=src\/)/, "");
  }
  fileAt[i] = cur;
}
const isWorker = (url) => /\/dist\/__worker__\.js/.test(url);

const selfFile = new Map(), selfFn = new Map(), incl = new Map();
let total = 0;
const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
for (const f of readdirSync(dir).filter((x) => x.endsWith(".cpuprofile"))) {
  const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  for (let i = 0; i < p.samples.length; i++) {
    const dt = (p.timeDeltas[i] || 0) / 1000;
    let id = p.samples[i];
    const leafName = byId.get(id).callFrame.functionName;
    if (leafName === "(idle)" || leafName === "(program)" || leafName === "(garbage collector)") continue;
    // first frame with a URL decides whether this sample is Nodepod's
    while (id != null && !byId.get(id).callFrame.url) id = parent.get(id);
    if (id == null || !isWorker(byId.get(id).callFrame.url)) continue;
    total += dt;
    const cf = byId.get(id).callFrame;
    const file = fileAt[cf.lineNumber] || "?";
    add(selfFile, file, dt);
    add(selfFn, `${file} :: ${cf.functionName || "(anon)"}`, dt);
    const seen = new Set();
    for (let c = id; c != null; c = parent.get(c)) {
      const x = byId.get(c).callFrame;
      if (!isWorker(x.url)) continue;
      const k = `${fileAt[x.lineNumber] || "?"} :: ${x.functionName || "(anon)"}`;
      if (seen.has(k)) continue;
      seen.add(k);
      add(incl, k, dt);
    }
  }
}
const show = (title, m, n) => {
  console.log(`\n${title}`);
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1]).slice(0, n)) {
    console.log(`${v.toFixed(0).padStart(7)} ms ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
  }
};
console.log(`time in Nodepod's worker runtime: ${total.toFixed(0)} ms`);
show("self time by source file", selfFile, 15);
show("self time by function", selfFn, top);
show("inclusive time by function", incl, top);
