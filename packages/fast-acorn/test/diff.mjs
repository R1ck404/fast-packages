// Differential test: fast parser vs acorn on every JS file we can find --
// results, errors (message, pos, loc, raisedAt) and callbacks must match.
// node packages/fast-acorn/test/diff.mjs [--limit N] [--dir path] [--locs] [--comments] [--nodepod]
import * as acorn from "acorn";
import { fastParse } from "../src/parser.mjs";
import { getOptions, Node as VNode } from "../src/shared.mjs";
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
  : [join(here, "../../../node_modules"), join(here, "../../../../Nodepod/node_modules/.pnpm")];

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
const errSer = (e) => (e instanceof Error ? `${e.constructor.name}|${e.message}|${e.pos}|${e.loc ? e.loc.line + ":" + e.loc.column : e.loc}|${e.raisedAt}` : "THROW " + String(e));
// object identity structure: which nodes, arrays, loc/Position objects and
// range arrays are shared (acorn shares e.g. a token's Position between all
// nodes starting/ending there, and the Identifier of `export { a }`)
function shareSig(ast) {
  const ids = new Map();
  let next = 0;
  const out = [];
  const id = (o) => {
    if (o === undefined || o === null) return -1;
    let i = ids.get(o);
    if (i === undefined) ids.set(o, (i = next++));
    return i;
  };
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      out.push("a" + id(n));
      for (const x of n) walk(x);
      return;
    }
    if (typeof n.type !== "string") return;
    out.push("n" + id(n));
    if (n.loc) out.push(id(n.loc), id(n.loc.start), id(n.loc.end));
    if (n.range) out.push(id(n.range));
    for (const k in n) if (k !== "loc" && k !== "range") walk(n[k]);
  })(ast);
  return out.join(",");
}

let ok = 0, sameError = 0, falseAccept = 0, falseReject = 0, mismatch = 0, shown = 0;

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
  const sink = (s) => (s ? "\u0000" + ser(s) : "");
  if (refErr) {
    if (!fastErr) {
      falseAccept++;
      if (shown++ < 15) console.log(`FALSE ACCEPT ${file} ${JSON.stringify(opts)}: acorn threw ${refErr.message}`);
      return;
    }
    // the same error, after the same comments
    const a = errSer(refErr) + sink(refSink), b = errSer(fastErr) + sink(fastSink);
    if (a !== b) {
      mismatch++;
      if (shown++ < 15) console.log(`ERROR MISMATCH ${file} ${JSON.stringify(opts)}\n   acorn ${a.slice(0, 300)}\n   fast  ${b.slice(0, 300)}`);
    } else sameError++;
    return;
  }
  if (fastErr) {
    falseReject++;
    if (shown++ < 15) console.log(`FALSE REJECT ${file} ${JSON.stringify(opts)}: ${fastErr.stack}`);
    return;
  }
  const a = ser(ref) + sink(refSink), b = ser(fast) + sink(fastSink);
  if (a !== b) {
    mismatch++;
    if (shown++ < 15) console.log(`MISMATCH ${file} ${JSON.stringify(opts)}\n   ${firstDiff(a, b)}`);
    return;
  }
  if (shareSig(ref) !== shareSig(fast)) {
    mismatch++;
    if (shown++ < 15) console.log(`SHARING ${file} ${JSON.stringify(opts)}`);
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
console.log(`ok ${ok}, same error ${sameError}, FALSE-ACCEPT ${falseAccept}, FALSE-REJECT ${falseReject}, MISMATCH ${mismatch}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(falseAccept || falseReject || mismatch ? 1 : 0);
