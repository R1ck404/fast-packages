// Error differential test through the public API: fast-acorn's parse /
// parseExpressionAt vs acorn 8.18 on mutated corpus files (truncations,
// insertions of syntax-relevant snippets, deletions) and on JSX files parsed
// as plain JavaScript (Nodepod's rollup parseAst tries plain acorn first):
// the result or the error (class, message, pos, loc, raisedAt) must match.
// Also counts how many errors the fast parser produced itself.
//
// node fast-acorn/test/error-diff.mjs [--limit N] [--nodepod] [--mutations N] [--jsx N]
import * as acorn from "acorn";
import * as fast from "../index.mjs";
import { errorStats, fastParse, BAIL, exactErrors } from "../parser.mjs";
import { _getOptions } from "../vendor/acorn.mjs";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const argVal = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const limit = Number(argVal("--limit", Infinity));
const mutations = Number(argVal("--mutations", 6));
const jsxCount = Number(argVal("--jsx", Infinity));
const here = fileURLToPath(new URL(".", import.meta.url));
const dirs = [join(here, "../../node_modules"), ...(args.includes("--nodepod") ? [join(here, "../../../Nodepod/node_modules/.pnpm")] : [])];
const jsxDir = join(here, "../../.scratch/verify/jsx-corpus");

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
      if (e.name !== ".git") collect(p, out, seen);
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

const rep = (k, v) => (typeof v === "bigint" ? "$big:" + v : v instanceof RegExp ? "$re:" + v : v);
// (loc must be an instance of the library's own Position class)
const errSer = (e, lib) => (e instanceof Error ? `${e.constructor.name}|${e.message}|${e.pos}|${e.loc ? e.loc.line + ":" + e.loc.column + ":" + (Object.getPrototypeOf(e.loc) === lib.Position.prototype) : e.loc}|${e.raisedAt}|${Object.keys(e).join(",")}` : "THROW " + String(e));
let checks = 0, errors = 0, mismatch = 0, shown = 0;
function check(what, code, fn) {
  checks++;
  let a, b;
  try {
    a = "OK " + JSON.stringify(fn(acorn, code), rep);
  } catch (e) {
    a = "ERR " + errSer(e, acorn);
  }
  try {
    b = "OK " + JSON.stringify(fn(fast, code), rep);
  } catch (e) {
    b = "ERR " + errSer(e, fast);
  }
  if (a.startsWith("ERR")) errors++;
  if (a !== b) {
    mismatch++;
    if (shown++ < 20) console.log(`MISMATCH ${what}\n  acorn: ${a.slice(0, 300)}\n  fast:  ${b.slice(0, 300)}`);
  }
}

let seed = 31337;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const SN = ["(", ")", "{", "}", "[", "]", ";", ",", "=", "=>", ".", "`", "'", '"', "/", "*", "<", ">", "if", "else", "function", "class", "let", "const", "var", "return", "import", "export", "async", "await", "yield", "new", "?", ":", "...", "#x", "@", "\n", "0", "a", "**", "!", "++", "for (", "of", "in", "static", "get", "super", "this", "`${", "/*", "//", "\\u0061", "08", "1n", "?.", "??", "&&="];
function mutate(c) {
  const r = rnd(), pos = Math.floor(rnd() * (c.length + 1));
  if (r < 0.25) return c.slice(0, pos);
  if (r < 0.7) return c.slice(0, pos) + SN[Math.floor(rnd() * SN.length)] + c.slice(pos);
  if (r < 0.9) return c.slice(0, pos) + c.slice(pos + 1 + Math.floor(rnd() * 6));
  // small window (errors early, cheap)
  return c.slice(Math.max(0, pos - 300), pos + 300);
}

const files = [];
const seen = new Set();
for (const d of dirs) collect(d, files, seen);
const jsxFiles = existsSync(jsxDir) ? readdirSync(jsxDir).slice(0, jsxCount).map((f) => join(jsxDir, f)) : [];
console.log(`${files.length} js files, ${jsxFiles.length} jsx files`);
const t0 = performance.now();
for (const f of files) {
  let code;
  try {
    code = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const st = /\.mjs$/.test(f) || /^\s*(import|export)\b/m.test(code) ? "module" : "script";
  for (let m = 0; m < mutations; m++) {
    const mc = mutate(code);
    const o = { ecmaVersion: "latest", sourceType: m % 3 === 2 ? (st === "module" ? "script" : "module") : st, locations: m % 2 === 1, sourceFile: m % 5 === 4 ? "file.js" : undefined };
    check(f + " #" + m, mc, (lib, c) => lib.parse(c, o));
  }
  // parseExpressionAt at a random position of a mutated file
  const mc = mutate(code);
  const pos = Math.floor(rnd() * mc.length);
  check(f + " expr@" + pos, mc, (lib, c) => lib.parseExpressionAt(c, pos, { ecmaVersion: "latest", sourceType: st }));
}
for (const f of jsxFiles) {
  const code = readFileSync(f, "utf8");
  // rollup parseAst's first attempt (plain acorn) on JSX
  check(f + " (jsx as js)", code, (lib, c) => lib.parse(c, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: false, locations: true }));
  check(f + " (jsx as js, mutated)", mutate(code), (lib, c) => lib.parse(c, { ecmaVersion: "latest", sourceType: "module" }));
}
// token soup: short random token sequences (dense coverage of error paths)
const soupCount = Number(argVal("--soup", 200000));
const TOKENS = [
  "a", "b", "x", "async", "await", "yield", "let", "of", "get", "set", "static", "as", "from", "using", "arguments", "eval", "enum", "constructor", "prototype", "__proto__",
  "var", "const", "function", "class", "extends", "super", "this", "new", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue",
  "throw", "try", "catch", "finally", "import", "export", "in", "instanceof", "typeof", "void", "delete", "null", "true", "false", "debugger", "with",
  "(", ")", "[", "]", "{", "}", ";", ",", ".", "?.", "...", "=>", "=", "+=", "**=", "&&=", "??=", "?", ":", "+", "-", "*", "**", "/", "%", "<", ">", "<=", "==", "===", "!", "~", "++", "--", "&&", "||", "??", "|", "&", "^", "<<", ">>>",
  "1", "0x1f", "1n", "1.5e3", "08", "0o7", "1_000", "'s'", '"d"', "`t`", "`a${", "}`", "/re/g", "#p", "\n", " ", "/*c*/", "//c\n", "\\u0061", "@",
];
const OPTS = [
  { ecmaVersion: "latest", sourceType: "script" },
  { ecmaVersion: "latest", sourceType: "module" },
  { ecmaVersion: "latest", sourceType: "script", allowAwaitOutsideFunction: true },
  { ecmaVersion: "latest", sourceType: "script", allowImportExportEverywhere: true },
  { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true, locations: true },
  { ecmaVersion: "latest", sourceType: "commonjs" },
  { ecmaVersion: "latest", sourceType: "script", allowReserved: "never", preserveParens: true },
];
let crashes = 0;
for (let i = 0; i < soupCount; i++) {
  const n = 1 + Math.floor(rnd() * 14);
  let code = "";
  for (let k = 0; k < n; k++) code += TOKENS[Math.floor(rnd() * TOKENS.length)] + (rnd() < 0.7 ? " " : "");
  const o = OPTS[i % OPTS.length];
  check("soup " + JSON.stringify(code) + " " + JSON.stringify(o), code, (lib, c) => lib.parse(c, o));
  // the fast parser itself must only ever return, BAIL, or throw an exact error
  const exactBefore = errorStats.exact;
  try {
    fastParse(code, _getOptions(o));
    errorStats.exact = exactBefore;
  } catch (e) {
    errorStats.exact = exactBefore;
    if (e !== BAIL && !exactErrors.has(e)) {
      crashes++;
      if (crashes < 10) console.log("CRASH", JSON.stringify(code), JSON.stringify(o), e && e.stack);
    }
  }
  if (i % 4 === 0) check("soup-expr " + JSON.stringify(code), code, (lib, c) => lib.parseExpressionAt(c, 0, o));
}
console.log(`checks ${checks}, errors ${errors} (of which the fast parser produced ${errorStats.exact}), MISMATCH ${mismatch}, fast-parser crashes ${crashes}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(mismatch || crashes ? 1 : 0);
