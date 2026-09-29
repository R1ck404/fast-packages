// Differential test for parseExpressionAt: acorn 8.18 vs the fast parser
// (directly and through the public API) at sampled start positions in real
// files; results and errors must match.
// usage: node packages/fast-acorn/test/expr-diff.mjs [--limit N]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";
import { fastParseExpressionAt } from "../src/parser.mjs";
import { getOptions } from "../src/shared.mjs";
import * as fastIndex from "../src/index.mjs";
import { idSer } from "./idser.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const limit = Number(args.includes("--limit") ? args[args.indexOf("--limit") + 1] : Infinity);
const files = [];
(function walk(d) {
  let es;
  try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(m?js|cjs)$/.test(e.name) && statSync(p).size < 2e6) files.push(p);
  }
})(join(here, "../../../node_modules"));
files.length = Math.min(files.length, limit);

const errSer = (e) => (e instanceof Error ? `ERR ${e.constructor.name}|${e.message}|${e.pos}|${e.loc ? e.loc.line + ":" + e.loc.column : e.loc}|${e.raisedAt}` : "THROW " + String(e));
const run = (f) => {
  try {
    return idSer(f());
  } catch (e) {
    return errSer(e);
  }
};
let ok = 0, sameError = 0, mismatch = 0, idx = 0;
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
    const a = run(() => acorn.Parser.parseExpressionAt(code, pos, opts));
    const b = run(() => fastParseExpressionAt(code, pos, getOptions(opts)));
    // also through the public entry point
    const c = run(() => fastIndex.parseExpressionAt(code, pos, opts));
    if (a !== b || a !== c) {
      mismatch++;
      if (mismatch < 6) console.log("MISMATCH", file, pos, "\n  acorn:", a.slice(0, 200), "\n  fast: ", b.slice(0, 200), "\n  index:", c.slice(0, 200));
      continue;
    }
    if (a.startsWith("ERR")) sameError++;
    else ok++;
  }
}
console.log(`${files.length} files: ok ${ok}, same error ${sameError}, MISMATCH ${mismatch} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(mismatch ? 1 : 0);
