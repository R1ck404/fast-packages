// Differential test for JSX: acorn 8.18 + acorn-jsx 5.3.2 (node_modules)
// against @r1ck404/fast-acorn's Parser.extend(acornJsx(...)) -- through the public API
// and through the fast parser directly: results and errors (message, pos,
// loc, raisedAt) must be identical. Inputs: a JSX corpus (default verify/jsx-corpus), the
// JS corpus (--js N files), generated JSX, and mutations of all of those.
//
// node packages/fast-acorn/test/jsx-diff.mjs [--dir jsxdir] [--js N] [--gen N] [--mutations N] [--limit N]
import * as ref from "acorn";
import * as fast from "../src/index.mjs";
import * as V from "../src/shared.mjs";
import { fastParse } from "../src/parser.mjs";
import { jsxOptionsOf } from "../src/jsx-detect.mjs";
import fastJsx from "@r1ck404/fast-acorn-jsx";
import { idSer } from "./idser.mjs";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const acornJsx = require("acorn-jsx");
const args = process.argv.slice(2);
const argVal = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const here = fileURLToPath(new URL(".", import.meta.url));
const jsxDir = argVal("--dir", join(here, "../../../verify/jsx-corpus"));
const jsCount = Number(argVal("--js", 1500));
const genCount = Number(argVal("--gen", 20000));
const mutations = Number(argVal("--mutations", 4));
const limit = Number(argVal("--limit", Infinity));

const PLUGIN_OPTS = [undefined, { allowNamespaces: false }, { allowNamespacedObjects: true }];
const pairs = PLUGIN_OPTS.map((po) => ({
  po,
  R: ref.Parser.extend(acornJsx(po)),
  F: fast.Parser.extend(acornJsx(po)), // genuine acorn-jsx on @r1ck404/fast-acorn: recognised by source
  G: fast.Parser.extend(fastJsx(po)), // @r1ck404/fast-acorn-jsx: registered
}));
for (const p of pairs) {
  if (!jsxOptionsOf(p.F, fast.Parser)) throw new Error("genuine acorn-jsx class not recognised: " + JSON.stringify(p.po));
  if (!jsxOptionsOf(p.G, fast.Parser)) throw new Error("@r1ck404/fast-acorn-jsx class not recognised: " + JSON.stringify(p.po));
}

const replacer = (k, v) => (typeof v === "bigint" ? { $bigint: v.toString() } : v instanceof RegExp ? { $re: String(v) } : typeof v === "function" ? { $fn: v.name } : v);
const ser = (x) => JSON.stringify(x, replacer);
const errSer = (e) => (e instanceof Error ? `${e.constructor.name}: ${e.message} pos=${e.pos} loc=${e.loc && e.loc.line + ":" + e.loc.column} raisedAt=${e.raisedAt}` : "THROW " + String(e));
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `@${i}: ref …${a.slice(Math.max(0, i - 100), i + 100)}…\n   fast …${b.slice(Math.max(0, i - 100), i + 100)}…`;
}

let checks = 0, fastOk = 0, falseReject = 0, bothErr = 0, mismatch = 0, falseAccept = 0, shown = 0;
function fail(kind, name, detail) {
  if (kind === "FALSE-ACCEPT") falseAccept++;
  else if (kind === "FALSE-REJECT") falseReject++;
  else mismatch++;
  if (shown++ < 25) console.log(`${kind} ${name}\n  ${detail}`);
}

const OPTION_SETS = [
  { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: false, locations: true }, // rollup parseAst
  { ecmaVersion: "latest", sourceType: "module" },
  { ecmaVersion: "latest", sourceType: "script", locations: true, ranges: true, onComment: "array" },
  { ecmaVersion: "latest", sourceType: "module", onComment: "fn", preserveParens: true, allowReturnOutsideFunction: true },
];

function withSinks(opts) {
  const log = [];
  const o = { ...opts };
  if (opts.onComment === "array") o.onComment = log;
  else if (opts.onComment === "fn") o.onComment = (...a) => log.push(a);
  return { o, log };
}

function check(name, code, opts, pair, which) {
  checks++;
  const Cls = which === "G" ? pair.G : pair.F;
  const a = withSinks(opts), b = withSinks(opts);
  let ra, ea = null, rb, eb = null;
  try {
    ra = idSer(pair.R.parse(code, a.o)) + "\u0000" + ser(a.log);
  } catch (e) {
    ea = errSer(e) + "\u0000" + ser(a.log);
  }
  try {
    const ast = Cls.parse(code, b.o);
    rb = idSer(ast) + "\u0000" + ser(b.log);
    if (!(ast instanceof V.Node)) return fail("PROTO", name, "");
  } catch (e) {
    eb = errSer(e) + "\u0000" + ser(b.log);
  }
  if (ea !== null || eb !== null) {
    if (ea !== eb) return fail("MISMATCH(error)", name + " " + JSON.stringify(opts) + " " + JSON.stringify(pair.po), `ref: ${ea}\n  fast: ${eb}`);
  } else if (ra !== rb) return fail("MISMATCH", name + " " + JSON.stringify(opts) + " " + JSON.stringify(pair.po), firstDiff(ra, rb));
  // the fast parser alone: the same result, or the same error
  const c = withSinks(opts);
  let rc = null, ec = null;
  try {
    rc = idSer(fastParse(code, V.getOptions(c.o), jsxOptionsOf(Cls, fast.Parser))) + "\u0000" + ser(c.log);
  } catch (e) {
    ec = errSer(e) + "\u0000" + ser(c.log);
  }
  if (ea !== null) {
    if (ec === null) return fail("FALSE-ACCEPT", name + " " + JSON.stringify(opts), ea);
    if (ec !== ea) return fail("MISMATCH(direct error)", name + " " + JSON.stringify(opts), `ref: ${ea}\n  fast: ${ec}`);
    bothErr++;
  } else if (ec !== null) return fail("FALSE-REJECT", name + " " + JSON.stringify(opts), ec);
  else {
    if (rc !== ra) return fail("MISMATCH(direct)", name, firstDiff(ra, rc));
    fastOk++;
  }
}

// ---- inputs
let seed = 987654321;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const NAMES = ["div", "a", "Foo", "Foo.Bar", "x.y.z", "svg:rect", "ns:tag", "my-elem", "data-x", "_a", "$b", "if", "class", "A1", "h1"];
const ATTRS = ["className", "id", "data-foo", "xlink:href", "aria-label", "on:click", "key", "for", "class", "a-b-c", "x"];
const TEXTS = ["hello", " world ", "&amp;", "&lt;&gt;", "&nbsp;", "&#x41;", "&#65;", "&bogus;", "& ;", "&#xZZ;", "&toString;", "a\nb", "a\r\nb", "\r", " ", "  ", "café", "😀", "then", "x = 1n", "'quoted'", '"dq"', "&amp", "&#x1F600;", "&aaaaaaaaaaaa;", "\t"];
function genAttrValue(d) {
  const r = rnd();
  if (r < 0.35) return '"' + pick(TEXTS).replace(/"/g, "") + '"';
  if (r < 0.55) return "'" + pick(TEXTS).replace(/'/g, "") + "'";
  if (r < 0.85) return "{" + genExpr(d) + "}";
  return genElement(d + 1);
}
function genExpr(d) {
  const r = rnd();
  if (d > 3 || r < 0.3) return pick(["x", "1", "'s'", "a.b", "f()", "`t${x}`", "/re/g", "a < b", "a > b"]);
  if (r < 0.5) return "cond ? " + genElement(d + 1) + " : null";
  if (r < 0.65) return "items.map((i) => " + genElement(d + 1) + ")";
  if (r < 0.75) return "a && " + genElement(d + 1);
  if (r < 0.85) return "/* c */ x";
  return genElement(d + 1);
}
function genElement(d) {
  if (d > 4) return "<br/>";
  const frag = rnd() < 0.12;
  const name = frag ? "" : pick(NAMES);
  let s = "<" + name;
  if (!frag) {
    const na = Math.floor(rnd() * 4);
    for (let i = 0; i < na; i++) {
      const r = rnd();
      if (r < 0.15) s += " {...props}";
      else if (r < 0.3) s += " " + pick(ATTRS);
      else s += " " + pick(ATTRS) + "=" + genAttrValue(d);
      if (rnd() < 0.1) s += "\n  ";
      if (rnd() < 0.05) s += " /* c */ ";
    }
  }
  if (!frag && rnd() < 0.3) return s + (rnd() < 0.5 ? " />" : "/>");
  s += ">";
  const nc = Math.floor(rnd() * 5);
  for (let i = 0; i < nc; i++) {
    const r = rnd();
    if (r < 0.4) s += pick(TEXTS);
    else if (r < 0.6) s += "{" + genExpr(d) + "}";
    else if (r < 0.65) s += "{}";
    else if (r < 0.68) s += "{/* only comment */}";
    else s += genElement(d + 1);
  }
  return s + "</" + name + ">";
}
function genProgram() {
  const r = rnd();
  const el = genElement(0);
  if (r < 0.3) return "const x = " + el + ";";
  if (r < 0.5) return "export default function C() {\n  return (\n    " + el + "\n  );\n}";
  if (r < 0.6) return "f(" + el + ", " + genElement(0) + ")";
  if (r < 0.7) return "x = cond ? " + el + " : " + genElement(0) + ";";
  if (r < 0.8) return "function* g() { yield " + el + "; }";
  if (r < 0.85) return "const y = () => " + el + ";\n" + el + ".props";
  return el;
}
const SNIPPETS = ["<", ">", "</", "/>", "<>", "</>", "{", "}", "{...", "&amp;", "&#x41;", "&bogus;", "&", "\r\n", "\n", "'", '"', ":", ".", "-", "=", "é", "😀", "/*", "//", "`", "${", "<a>", "</a>", "<!--", "-->", "\\", "#", "@", "then", " ", "a:b", "</b>"];
function mutate(code) {
  const r = rnd();
  const pos = Math.floor(rnd() * (code.length + 1));
  if (r < 0.3) return code.slice(0, pos);
  if (r < 0.65) return code.slice(0, pos) + pick(SNIPPETS) + code.slice(pos);
  if (r < 0.9) return code.slice(0, pos) + code.slice(pos + 1 + Math.floor(rnd() * 8));
  const q = Math.floor(rnd() * code.length);
  return code.slice(0, Math.min(pos, q)) + code.slice(Math.max(pos, q));
}

const t0 = performance.now();
function checkExprAt(name, code, pair) {
  checks++;
  const pos = Math.floor(rnd() * (code.length + 1));
  const o = { ecmaVersion: "latest", sourceType: "module", locations: rnd() < 0.5 };
  let ra, rb;
  try {
    ra = idSer(pair.R.parseExpressionAt(code, pos, o));
  } catch (e) {
    ra = "ERR " + errSer(e);
  }
  try {
    rb = idSer((rnd() < 0.5 ? pair.F : pair.G).parseExpressionAt(code, pos, o));
  } catch (e) {
    rb = "ERR " + errSer(e);
  }
  if (ra !== rb) fail("MISMATCH(parseExpressionAt)", name + " @" + pos, firstDiff(ra, rb));
}
function runInput(name, code, full) {
  // rotate the (plugin options x option set x class) combinations
  checkExprAt(name, code, pick(pairs));
  for (let i = 0; i < (full ? pairs.length : 1); i++) {
    const pair = full ? pairs[i] : pick(pairs);
    const opts = full && i === 0 ? OPTION_SETS : [pick(OPTION_SETS)];
    for (const o of opts) check(name, code, o, pair, rnd() < 0.5 ? "F" : "G");
  }
}

// 1. JSX corpus
let jsxFiles = [];
if (existsSync(jsxDir)) jsxFiles = readdirSync(jsxDir).filter((f) => /\.(jsx|js)$/.test(f)).slice(0, limit);
console.log(`jsx corpus: ${jsxFiles.length} files from ${jsxDir}`);
for (const f of jsxFiles) {
  const code = readFileSync(join(jsxDir, f), "utf8");
  runInput(f, code, true);
  for (let m = 0; m < mutations; m++) runInput(f + " (mutated)", mutate(code), false);
}
const afterCorpus = { checks, fastOk, bothErr };
// 2. JS corpus parsed with the JSX classes
const jsFiles = [];
(function walk(d) {
  let es;
  try {
    es = readdirSync(d, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of es) {
    if (jsFiles.length >= jsCount) return;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(m|c)?js$/.test(e.name) && statSync(p).size < 1_000_000) jsFiles.push(p);
  }
})(join(here, "../../../node_modules"));
for (const f of jsFiles) {
  const code = readFileSync(f, "utf8");
  runInput(f, code, false);
  runInput(f + " (mutated)", mutate(code), false);
}
// 3. generated JSX
for (let i = 0; i < genCount; i++) {
  const code = genProgram();
  runInput("gen#" + i + " " + JSON.stringify(code).slice(0, 200), code, i % 10 === 0);
  if (i % 2 === 0) runInput("gen#" + i + " (mutated)", mutate(code), false);
}
console.log(`jsx corpus part: checks ${afterCorpus.checks}, same result ${afterCorpus.fastOk}, same error ${afterCorpus.bothErr}`);
console.log(`total: checks ${checks}, same result ${fastOk}, same error ${bothErr}, FALSE-ACCEPT ${falseAccept}, FALSE-REJECT ${falseReject}, MISMATCH ${mismatch}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(falseAccept || falseReject || mismatch ? 1 : 0);
