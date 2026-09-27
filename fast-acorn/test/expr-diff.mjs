// Differential test for parseExpressionAt: real acorn vs the fast path at
// sampled start positions in real files.
// usage: node fast-acorn/test/expr-diff.mjs [--limit N]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// reference: acorn 8.18 from node_modules. (Not ../vendor/acorn.mjs: its
// Parser.parseExpressionAt is the fast path once ../index.mjs is loaded.)
import * as acorn from "acorn";
import * as V from "../vendor/acorn.mjs";
import { fastParseExpressionAt } from "../parser.mjs";
import * as fastIndex from "../index.mjs";
import { idSer } from "./idser.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const limit = Number(args.includes("--limit") ? args[args.indexOf("--limit") + 1] : Infinity);
const getOptions = V._getOptions;
const files = [];
(function walk(d) {
  let es;
  try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(m?js|cjs)$/.test(e.name) && statSync(p).size < 2e6) files.push(p);
  }
})(join(here, "../../node_modules"));
files.length = Math.min(files.length, limit);

const replacer = (k, v) => (typeof v === "bigint" ? `${v}n` : v instanceof RegExp ? String(v) : v);
let ok = 0, bail = 0, bothFail = 0, falseAccept = 0, mismatch = 0, idx = 0;
const t0 = performance.now();
for (const file of files) {
  const code = readFileSync(file, "utf8");
  const sourceType = /^\s*(import|export)\b/m.test(code) ? "module" : "script";
  const re = /(?:=|return|\(|,|\{|\?|:)[ \t]*/g;
  const positions = [];
  let m;
  while ((m = re.exec(code)) !== null) positions.push(m.index + m[0].length);
  const step = Math.max(1, Math.floor(positions.length / 30));
  for (let i = 0; i < positions.length; i += step) {
    const pos = positions[i];
    const opts = { ecmaVersion: "latest", sourceType, locations: (idx++ & 1) === 0 };
    let a, aErr = null;
    try { a = idSer(acorn.Parser.parseExpressionAt(code, pos, opts)); } catch (e) { aErr = e; }
    let b, bErr = null;
    try { b = idSer(fastParseExpressionAt(code, pos, getOptions(opts))); } catch (e) { bErr = e; }
    if (aErr) { if (bErr) bothFail++; else { falseAccept++; if (falseAccept < 6) console.log("FALSE-ACCEPT", file, pos, aErr.message); } continue; }
    if (bErr) { bail++; continue; }
    if (a !== b) { mismatch++; if (mismatch < 6) console.log("MISMATCH", file, pos); continue; }
    // also through the public entry point (must agree with acorn, via fast path or fallback)
    const c = idSer(fastIndex.parseExpressionAt(code, pos, opts));
    if (c !== a) { mismatch++; if (mismatch < 6) console.log("INDEX-MISMATCH", file, pos); continue; }
    ok++;
  }
}
console.log(`${files.length} files: ok ${ok}, bail ${bail}, bothFail ${bothFail}, FALSE-ACCEPT ${falseAccept}, MISMATCH ${mismatch} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
