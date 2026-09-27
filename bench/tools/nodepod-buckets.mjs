// CPU time per "bucket" (npm package, CDN module, Nodepod file, GC, ...)
// from .cpuprofile files of a Nodepod run. Every sample goes to the first
// frame up its stack that has a URL:
//   vfs://<path>          code Nodepod evaluated (needs the profiling build
//                         that tags modules with sourceURLs):
//                         npm:<package> from .../node_modules/<package>/,
//                         otherwise "app code"
//   esm.sh / jsdelivr     cdn:<package> (rollup, rolldown and oxide wasm, ...)
//   wasm://               attributed to the nearest JS caller: "<bucket> [wasm]"
//   .../dist/...          nodepod:<file> (its own runtime)
// Samples with no URL on the stack are "(gc)", "(program)" or "(native)".
// Not busy time, left out: "(idle)", and "(waiting)": a thread blocked in a
// wasm memory.atomic.wait (see wasm-waits.mjs), which the profiler shows as
// running the waiting function.
// usage: node bench/tools/nodepod-buckets.mjs <dir|file.cpuprofile ...> [--top N] [--threads]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { waitFunctions } from "./wasm-waits.mjs";

export function bucketOfUrl(url) {
  if (!url) return null;
  if (url.startsWith("vfs://")) {
    const p = url.slice(6);
    const i = p.lastIndexOf("/node_modules/");
    if (i < 0) return "app code";
    const rest = p.slice(i + 14).split("/");
    return "npm:" + (rest[0].startsWith("@") ? rest[0] + "/" + rest[1] : rest[0]);
  }
  if (url.startsWith("wasm://")) return "[wasm]";
  const cdn = url.match(/esm\.sh\/(?:v\d+\/)?(@[^@/]+\/[^@/]+|[^@/]+)@/) || url.match(/jsdelivr\.net\/npm\/(@[^@/]+\/[^@/]+|[^@/]+)@/);
  if (cdn) return "cdn:" + cdn[1];
  if (/^esbuild-wasm-/.test(url)) return "cdn:esbuild-wasm";
  const dist = url.match(/\/dist\/(.+?)(?:\?.*)?$/);
  if (dist) return "nodepod:" + dist[1].replace(/-[A-Za-z0-9_-]{8}\.(c?js|mjs)$/, ".$1");
  if (url.startsWith("blob:")) return "blob:";
  try {
    const u = new URL(url);
    return "other:" + u.host + u.pathname.split("/").slice(0, 3).join("/");
  } catch {
    return "other:" + url.slice(0, 60);
  }
}

const WASM_FN = /^wasm-function\[(\d+)\]$/;

/**
 * { total, idle, waiting, buckets: Map<bucket, ms> } for one profile (ms);
 * waits: Map<wasm url, Set<function index>> from waitsOf()
 */
export function bucketize(prof, waits = new Map()) {
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const memo = new Map();
  const bucketOf = (id) => {
    let b = memo.get(id);
    if (b !== undefined) return b;
    const { functionName: leaf, url } = byId.get(id).callFrame;
    const wi = waits.has(url) ? leaf.match(WASM_FN) : null;
    if (wi && waits.get(url).has(Number(wi[1]))) b = "(waiting)";
    else if (leaf === "(idle)") b = "(idle)";
    else if (leaf === "(garbage collector)") b = "(gc)";
    else if (leaf === "(program)") b = "(program)";
    else {
      let wasm = false;
      b = "(native)";
      for (let cur = id; cur != null; cur = parent.get(cur)) {
        const x = bucketOfUrl(byId.get(cur).callFrame.url);
        if (x === null) continue;
        if (x === "[wasm]") {
          wasm = true;
          continue;
        }
        b = wasm ? x + " [wasm]" : x;
        break;
      }
      if (b === "(native)" && wasm) b = "(wasm, no JS caller)";
    }
    memo.set(id, b);
    return b;
  };
  const buckets = new Map();
  let total = 0, idle = 0, waiting = 0;
  for (let i = 0; i < prof.samples.length; i++) {
    const dt = (prof.timeDeltas[i] || 0) / 1000;
    const b = bucketOf(prof.samples[i]);
    if (b === "(idle)") idle += dt;
    else if (b === "(waiting)") waiting += dt;
    else {
      total += dt;
      buckets.set(b, (buckets.get(b) || 0) + dt);
    }
  }
  return { total, idle, waiting, buckets };
}

/** wait functions of every wasm module (fetched over http) the profiles ran */
export async function waitsOf(profs) {
  const urls = new Set();
  for (const p of profs) {
    for (const n of p.nodes) {
      const u = n.callFrame.url;
      if (/^https?:/.test(u) && /\.wasm(\?|$)/.test(u)) urls.add(u);
    }
  }
  const waits = new Map();
  for (const u of urls) {
    try {
      waits.set(u, await waitFunctions(u));
    } catch (e) {
      console.error(`(no wait analysis for ${u}: ${String(e.message).split("\n")[0]})`);
    }
  }
  return waits;
}

export async function report(files, { top = 25, threads = false } = {}) {
  const profs = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
  const waits = await waitsOf(profs);
  const all = new Map();
  let total = 0, waiting = 0;
  const lines = [];
  profs.forEach((p, i) => {
    const r = bucketize(p, waits);
    total += r.total;
    waiting += r.waiting;
    for (const [b, t] of r.buckets) all.set(b, (all.get(b) || 0) + t);
    if (threads) {
      const name = basename(files[i]).replace(/\.cpuprofile$/, "").slice(0, 64).padEnd(64);
      lines.push(`  ${name} busy ${r.total.toFixed(0).padStart(6)} ms, blocked in wasm waits ${r.waiting.toFixed(0).padStart(6)} ms`);
    }
  });
  const out = [`busy CPU, all threads: ${total.toFixed(0)} ms (not counted: ${waiting.toFixed(0)} ms of threads blocked in wasm waits)`];
  if (threads) out.push(...lines);
  for (const [b, t] of [...all].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    out.push(`${t.toFixed(0).padStart(8)} ms ${((100 * t) / total).toFixed(1).padStart(5)}%  ${b}`);
  }
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const top = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) : 25;
  const paths = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--top");
  const files = paths.flatMap((p) =>
    statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".cpuprofile")).map((f) => join(p, f)) : [p],
  );
  console.log(await report(files, { top, threads: args.includes("--threads") }));
}
