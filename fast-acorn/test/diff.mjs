// Differential test: fast parser vs acorn on every JS file we can find.
// node fast-acorn/test/diff.mjs [--limit N] [--dir path] [--locs]
import * as acorn from "acorn";
import { fastParse, BAIL } from "../parser.mjs";
import { _getOptions as getOptions, Node as VNode } from "../vendor/acorn.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const withLocs = args.includes("--locs");
const withComments = args.includes("--comments");
const withNodepod = args.includes("--nodepod");
const here = fileURLToPath(new URL(".", import.meta.url));
const dirs = args.includes("--dir")
  ? [args[args.indexOf("--dir") + 1]]
  : [join(here, "../../node_modules"), join(here, "../../../../../Nodepod/node_modules/.pnpm")];

function collect(dir, out, seen) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === ".git") continue;
      collect(p, out, seen);
    } else if (/\.(m|c)?js$/.test(e.name)) {
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.size > 3_000_000 || st.size === 0) continue;
      const key = st.size + ":" + e.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
}

const files = [];
const seen = new Set();
for (const d of dirs) collect(d, files, seen);
console.log(`${files.length} files`);

const replacer = (k, v) => (typeof v === "bigint" ? { $bigint: v.toString() } : v instanceof RegExp ? { $re: String(v) } : v);
const ser = (ast) => JSON.stringify(ast, replacer);

let ok = 0, bails = 0, bothFail = 0, falseAccept = 0, mismatch = 0, shown = 0;
const bailSamples = [];

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `@${i}: acorn …${a.slice(Math.max(0, i - 80), i + 80)}…\n   fast  …${b.slice(Math.max(0, i - 80), i + 80)}…`;
}

function check(file, code, opts0) {
  // With "comments" set, each side gets its own onComment sink: the array form
  // (acorn's pushComment objects) or the function form (raw callback args)
  let refSink = null, fastSink = null, refOpts = opts0, fastOpts = opts0;
  if (opts0.comments) {
    const { comments, ...rest } = opts0;
    refSink = [];
    fastSink = [];
    if (comments === "array") {
      refOpts = { ...rest, onComment: refSink };
      fastOpts = { ...rest, onComment: fastSink };
    } else {
      refOpts = { ...rest, onComment: (...a) => refSink.push(a) };
      fastOpts = { ...rest, onComment: (...a) => fastSink.push(a) };
    }
  }
  const opts = refOpts;
  let ref, refErr = null;
  try {
    ref = acorn.parse(code, refOpts);
  } catch (e) {
    refErr = e;
  }
  let fast, fastErr = null;
  try {
    fast = fastParse(code, getOptions(fastOpts));
  } catch (e) {
    fastErr = e;
  }
  if (refErr) {
    if (fastErr) bothFail++;
    else {
      falseAccept++;
      if (shown++ < 15) console.log(`FALSE ACCEPT ${file} ${JSON.stringify(opts)}: acorn threw ${refErr.message}`);
    }
    return;
  }
  if (fastErr) {
    bails++;
    if (fastErr !== BAIL) {
      if (shown++ < 15) console.log(`CRASH ${file}: ${fastErr.stack}`);
    } else if (bailSamples.length < 30) bailSamples.push(file);
    return;
  }
  const a = ser(ref) + (refSink ? "\u0000" + ser(refSink) : ""), b = ser(fast) + (fastSink ? "\u0000" + ser(fastSink) : "");
  if (a !== b) {
    mismatch++;
    if (shown++ < 15) console.log(`MISMATCH ${file} ${JSON.stringify(opts)}\n   ${firstDiff(a, b)}`);
    return;
  }
  if (!(fast instanceof VNode)) {
    mismatch++;
    if (shown++ < 15) console.log(`PROTO ${file}`);
    return;
  }
  ok++;
}

const t0 = performance.now();
for (const file of files) {
  let code;
  try {
    code = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const sourceType = /\.mjs$/.test(file) || /^\s*(import|export)\b/m.test(code) ? "module" : "script";
  check(file, code, { ecmaVersion: "latest", sourceType });
  if (withLocs) check(file, code, { ecmaVersion: "latest", sourceType, locations: true, ranges: true });
  if (withNodepod) {
    // the option combinations Nodepod itself passes to acorn.parse
    check(file, code, { ecmaVersion: "latest", sourceType: "script", allowAwaitOutsideFunction: true });
    check(file, code, { ecmaVersion: "latest", sourceType: "script", allowImportExportEverywhere: true });
    check(file, code, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true, locations: true });
  }
  if (withComments) {
    check(file, code, { ecmaVersion: "latest", sourceType, comments: "array", locations: true, ranges: true });
    check(file, code, { ecmaVersion: "latest", sourceType, comments: "fn" });
  }
}
console.log(`ok ${ok}, bail ${bails}, bothFail ${bothFail}, FALSE-ACCEPT ${falseAccept}, MISMATCH ${mismatch}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
if (bailSamples.length) console.log("bail samples:\n  " + bailSamples.slice(0, 10).join("\n  "));
process.exit(falseAccept || mismatch ? 1 : 0);
