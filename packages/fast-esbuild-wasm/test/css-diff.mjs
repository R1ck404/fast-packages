// Differential test for CSS: @r1ck404/fast-esbuild-wasm's CSS transform
// (loader css / local-css / global-css) vs real esbuild 0.28.2 (the native
// package; same Go code as esbuild-wasm) over a corpus of real stylesheets,
// the CSS inputs of esbuild's own parser and printer tests, and option sets.
//
// usage: node test/css-diff.mjs [--limit N] [--dir path]... [--opts name,name] [--file path]
//                               [--show N] [--stop] [--quiet] [--no-tests] [--no-nm]
//   --dir       walk these trees for .css files (default: the repository's
//               node_modules and the sibling projects of the repository)
//   --no-tests  skip the inputs extracted from esbuild's Go tests
//   --opts      option sets to run (a trailing "*" matches a prefix)
// Categories: see test/diff.mjs (ok, okWasm, bail, bothFail, FALSE-ACCEPT,
// WARN-ACCEPT, MISMATCH, CRASH, esbuildCrash).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { flagsFor, makeRefTransform, makeWasmTransform, ESBUILD_CRASHED, messagesJSON, classifyTransform } from "./flags.mjs";
import { extractGoTestInputs, CSS_OPTION_SETS } from "./css-inputs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const refTransform = makeRefTransform(require);
const wasmTransform = makeWasmTransform(require);
// Check memoized values against fresh computations (see CONVENTIONS.md)
globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__ = true;
const { fastTransform, stats } = await (await import("./engine.mjs")).loadEngine();

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const getAll = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const limit = Number(getArg("--limit", Infinity));
const showN = Number(getArg("--show", 5));
const stopOnFail = args.includes("--stop");
const quiet = args.includes("--quiet");
// (in parallel: see shard.mjs; --jobs 1 runs in this process)
const { shardOf, jobsOf, runShards, printSummary, addUp, shardList } = await import("./shard.mjs");
const shard = shardOf(args);
const onlyOptsList = getArg("--opts", null)?.split(",");
const onlyOpts = onlyOptsList && { includes: (name) => onlyOptsList.some((o) => (o.endsWith("*") ? name.startsWith(o.slice(0, -1)) : o === name)) };
const singleFile = getArg("--file", null);
const skipNodeModules = args.includes("--no-nm");
const noTests = args.includes("--no-tests");


function* walk(dir, seen) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === ".git" || (skipNodeModules && e.name === "node_modules")) continue;
      yield* walk(p, seen);
    } else if ((e.isFile() || e.isSymbolicLink()) && e.name.endsWith(".css")) {
      let text;
      try {
        const st = statSync(p);
        if (st.size > 8e6) continue;
        text = readFileSync(p, "utf8");
      } catch {
        continue;
      }
      // (the same stylesheet is often installed many times)
      const hash = createHash("sha1").update(text).digest("hex");
      if (seen.has(hash)) continue;
      seen.add(hash);
      yield [p, text];
    }
  }
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const line = a.slice(0, i).split("\n").length;
  const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - 80), i + 80));
  return `  first difference at char ${i} (line ${line})\n    esbuild: ${ctx(a)}\n    fast:    ${ctx(b)}`;
}

// [name, text] inputs
let inputs = [];
const fromParent = shardList(args);
if (fromParent !== null) inputs = fromParent;
else if (singleFile) inputs = [[resolve(singleFile), readFileSync(resolve(singleFile), "utf8")]];
else {
  const dirs = getAll("--dir");
  if (dirs.length === 0) {
    dirs.push(join(here, "../../../node_modules"));
    // (the projects next to the repository checkout, e.g. ~/sandbox/*)
    let dir = here;
    while (dirname(dir) !== dir && basename(dir) !== "nodepod-fast-packages") dir = dirname(dir);
    if (basename(dir) === "nodepod-fast-packages") dirs.push(dirname(dir));
  }
  const seen = new Set();
  if (!noTests) {
    const esbuildSrc = join(tmpdir(), "esbuild-src");
    if (existsSync(esbuildSrc)) {
      for (const [name, text] of extractGoTestInputs(esbuildSrc)) {
        const hash = createHash("sha1").update(text).digest("hex");
        if (seen.has(hash)) continue;
        seen.add(hash);
        inputs.push([name, text]);
      }
    } else {
      console.log(`(no esbuild checkout at ${esbuildSrc}: skipping the inputs of esbuild's CSS tests)`);
    }
  }
  for (const d of dirs) for (const f of walk(resolve(d), seen)) inputs.push(f);
}
// (a shard process takes the parent's list)
if (fromParent === null) inputs = inputs.slice(0, limit);

const counts = { ok: 0, okWasm: 0, okError: 0, bail: 0, bothFail: 0, "FALSE-ACCEPT": 0, "FALSE-ERROR": 0, "MSG-MISMATCH": 0, MISMATCH: 0, CRASH: 0, esbuildCrash: 0 };
const bailReasons = new Map();
function sameAsWasm(code, opts, fast) {
  const w = wasmTransform(code, opts);
  return w !== null && messagesJSON(w.warnings) === messagesJSON(fast.warnings) && w.code === fast.code && w.map === fast.map && (w.legalComments ?? undefined) === (fast.legalComments ?? undefined);
}

const perOpt = {};
const shown = {};
const bailSites = {};
const t0 = performance.now();
let tFast = 0;
let tRef = 0;
if (shard === null && jobsOf(args) > 1 && inputs.length > 1) {
  const n = Math.min(jobsOf(args), inputs.length);
  const sums = addUp(await runShards(fileURLToPath(import.meta.url), args, n, process.env, inputs));
  console.log(`${inputs.length} inputs in ${((performance.now() - t0) / 1000).toFixed(1)}s (esbuild native ${(sums.tRef / 1000).toFixed(1)}s, fast ${(sums.tFast / 1000).toFixed(1)}s, in ${n} processes)`);
  console.log(Object.entries(sums.counts).map(([k, v]) => `${k} ${v}`).join(", "));
  console.log(CSS_OPTION_SETS.map(([k]) => k).filter((k) => sums.perOpt[k]).map((k) => `${k}: ok ${sums.perOpt[k].ok} bail ${sums.perOpt[k].bail} bad ${sums.perOpt[k].bad}`).join(" | "));
  process.exitCode = ["FALSE-ACCEPT", "FALSE-ERROR", "MSG-MISMATCH", "MISMATCH", "CRASH"].some((k) => sums.counts[k] > 0) ? 1 : 0;
  process.exit();
}
let inputIndex = 0;
outer: for (const [name, code] of inputs) {
  if (shard !== null && !shard.take(inputIndex++)) continue;
  for (const [optName, opts] of CSS_OPTION_SETS) {
    if (onlyOpts && !onlyOpts.includes(optName)) continue;
    let ref = null;
    let refError = null;
    let t = performance.now();
    try {
      ref = refTransform(code, opts);
    } catch (e) {
      refError = e;
    }
    tRef += performance.now() - t;
    if (ref === ESBUILD_CRASHED) {
      counts.esbuildCrash++;
      continue;
    }
    const errBefore = stats.error;
    t = performance.now();
    const fast = fastTransform(flagsFor(opts), code, opts.mangleCache);
    tFast += performance.now() - t;
    let cat;
    let msgDiff = null;
    if (stats.error !== errBefore) cat = "CRASH";
    else [cat, msgDiff] = classifyTransform(ref, refError, fast);
    if (cat === "MISMATCH" && sameAsWasm(code, opts, fast)) cat = "okWasm";
    if (cat === "bail" || cat === "bothFail") {
      const lb = stats.lastBail;
      const key = (cat === "bothFail" ? "[esbuild fails] " : "") + (lb ? lb.reason + (lb.detail ? ": " + lb.detail.slice(0, 70) : "") : "?");
      bailReasons.set(key, (bailReasons.get(key) || 0) + 1);
    }
    if (cat === "bail" && ref !== null && ref.warnings.length === 0) {
      // A bail although esbuild succeeds without warnings: record the site
      const key = `${stats.lastBail.reason}: ${stats.lastBail.detail}`;
      bailSites[key] = (bailSites[key] || 0) + 1;
    }
    counts[cat]++;
    (perOpt[optName] ??= { ok: 0, bail: 0, bad: 0 })[cat === "ok" || cat === "okWasm" || cat === "okError" ? "ok" : cat === "bail" || cat === "bothFail" ? "bail" : "bad"]++;
    if (cat !== "ok" && cat !== "bail" && cat !== "bothFail" && cat !== "okWasm" && cat !== "okError") {
      shown[cat] = (shown[cat] || 0) + 1;
      if (!quiet && shown[cat] <= showN) {
        console.log(`${cat} [${optName}] ${name}`);
        if (cat === "MISMATCH") console.log(fast.code !== ref.code ? firstDiff(ref.code, fast.code) : fast.map !== ref.map ? "  (source map)\n" + firstDiff(ref.map, fast.map) : "  (legal comments)\n" + firstDiff(String(ref.legalComments), String(fast.legalComments)));
        if (cat === "CRASH") console.log("  " + String(stats.lastError && stats.lastError.stack).split("\n").slice(0, 8).join("\n  "));
        if (msgDiff !== null) console.log(msgDiff);
        if (code.length < 300) console.log("  input: " + JSON.stringify(code));
      }
      if (stopOnFail) break outer;
    }
  }
}
if (shard !== null) {
  printSummary({ counts, perOpt, tRef, tFast });
  process.exit();
}
console.log(`${inputs.length} inputs in ${((performance.now() - t0) / 1000).toFixed(1)}s (esbuild native ${(tRef / 1000).toFixed(1)}s, fast ${(tFast / 1000).toFixed(1)}s)`);
console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "));
console.log(Object.entries(perOpt).map(([k, v]) => `${k}: ok ${v.ok} bail ${v.bail} bad ${v.bad}`).join(" | "));
const sites = Object.entries(bailSites).sort((a, b) => b[1] - a[1]);
if (sites.length > 0) {
  console.log("bails where esbuild succeeds without warnings:");
  for (const [k, v] of sites.slice(0, 30)) console.log(`  ${v}  ${k}`);
}
if (bailReasons.size > 0) {
  console.log("bail reasons:");
  for (const [k, n] of [...bailReasons].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(String(n).padStart(7) + "  " + k);
}

// (failure: any category other than an identical result, a bail or a
// case esbuild itself crashes on)
process.exitCode = ["FALSE-ACCEPT", "FALSE-ERROR", "MSG-MISMATCH", "MISMATCH", "CRASH"].some((k) => counts[k] > 0) ? 1 : 0;
