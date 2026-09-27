// Randomized differential test vs native esbuild 0.28.2, aimed at the printer
// and lexer paths that real code rarely exercises: string/template escapes
// (control characters, quotes, "${", "</script", U+2028/9, BOM, surrogate
// pairs, lone surrogates, Latin-1 and BMP characters, under charset ascii and
// utf8), identifiers with non-ASCII characters and escapes, numbers, regular
// expressions, comments, JSX text and attribute strings, property keys, source
// maps over non-ASCII text.
//
// usage: node test/fuzz.mjs [--n 3000] [--seed 1] [--show 5]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__ = true;
const { fastTransform, stats } = await import("../src/transform.mjs");

const args = process.argv.slice(2);
const getArg = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const N = Number(getArg("--n", 3000));
let seed = Number(getArg("--seed", 1)) >>> 0 || 1;
const showN = Number(getArg("--show", 5));

function rnd(n) {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed % n;
}
const pick = (a) => a[rnd(a.length)];
const ch = (c) => String.fromCharCode(c);

// Characters that are interesting inside string-like literals
const STRING_CHARS = [
  "a", "b", "Z", "0", "1", "9", " ", "$", "{", "}", "$", "/", "<", ">", "s", "c", "r", "i", "p", "t",
  "'", '"', "`", "\\\\", "\\n", "\\r", "\\t", "\\0", "\\x07", "\\b", "\\f", "\\v", "\\x1b", "\\u2028", "\\u2029",
  "\\ufeff", "\\x7f", "\\xe4", "\\xff", "\\u0100", "\\u20ac", "\\ud83d\\ude00", "\\ud800", "\\udc00", "\\u{1F600}",
  "\\u{10FFFF}", "\\x00", "\\x01", "\\x1f", "\\x80", "\\xa0",
  ch(0xe4), ch(0x20ac), ch(0x3042), ch(0xd83d) + ch(0xde00), ch(0x2028), ch(0x2029), ch(0xfeff), ch(0xa0), ch(0x7f),
  "</script", "</SCRIPT", "<\\/script", "${", "$\\{",
];
function stringBody(quote) {
  let s = "";
  const n = rnd(12);
  for (let i = 0; i < n; i++) {
    let c = pick(STRING_CHARS);
    if (c === quote) c = "\\" + c;
    if (quote !== "`" && (c === ch(0x2028) || c === ch(0x2029))) c = "x";
    if (quote === "`" && c === "${") c = "$";
    s += c;
  }
  // A trailing backslash would escape the quote
  if (s.endsWith("\\") && !s.endsWith("\\\\")) s += "\\";
  return s;
}
const IDENT_PARTS = ["a", "b", "_", "$", "x1", ch(0xe4), ch(0x3b1), "\\u0061", "\\u{62}", ch(0x2118), "Z", ch(0x1d400 >> 10 | 0) === "" ? "q" : "q"];
function ident() {
  let s = pick(["a", "b", "_", "$", "Foo", ch(0xe4), ch(0x3b1), "\\u0061", "\\u{63}"]);
  const n = rnd(3);
  for (let i = 0; i < n; i++) s += pick(IDENT_PARTS);
  return s;
}
const NUMBERS = ["0", "1", "1.5", ".5", "1e21", "1e-7", "0x1F", "0o17", "0b101", "1_000", "123456789012345678901234567890", "5e-324", "1.7976931348623157e308", "0.1", "1n", "0xFFn", "2e+3"];
function expr(d) {
  switch (d > 3 ? rnd(4) : rnd(14)) {
    case 0: {
      const q = pick(["'", '"']);
      return q + stringBody(q) + q;
    }
    case 1:
      return "`" + stringBody("`") + "`";
    case 2:
      return "`" + stringBody("`") + "${" + expr(d + 1) + "}" + stringBody("`") + "`";
    case 3:
      return pick(NUMBERS);
    case 4:
      return "tag`" + stringBody("`") + "`";
    case 5:
      return "{ " + pick(["a", "'b c'", '"d"', "1", "'" + ch(0xe4) + "'", "[k]", "'\\u2028'", "if", "'</script>'"]) + ": " + expr(d + 1) + " }";
    case 6:
      return expr(d + 1) + "." + pick(["x", "if", "\\u0061b", ch(0xe4), "_$"]);
    case 7:
      return expr(d + 1) + "[" + expr(d + 1) + "]";
    case 8:
      return "/" + pick(["a+", "[/]", "\\/</script>", ch(0xe4), "\\u{1F600}", "x" + ch(0xd83d) + ch(0xde00)]) + "/" + pick(["", "g", "u", "gi"]);
    case 9:
      return "(" + expr(d + 1) + " " + pick(["+", "-", "<", "</", "&&", "??", ","]) + " " + expr(d + 1) + ")";
    case 10:
      return "f(" + expr(d + 1) + ", " + expr(d + 1) + ")";
    case 11:
      return "/* " + pick(["c", "@__PURE__", "#__PURE__", ch(0xe4), "</script>"]) + " */ " + expr(d + 1);
    case 12:
      return "[" + expr(d + 1) + ", ...x]";
    default:
      return ident();
  }
}
function stmt() {
  switch (rnd(8)) {
    case 0:
      return `var ${ident()} = ${expr(0)};`;
    case 1:
      return `x = ${expr(0)};`;
    case 2:
      return `//${pick([" c", ch(0xe4), " @license x", ch(0x2028) === "" ? "" : " z"])}\nf(${expr(0)});`;
    case 3:
      return `/*! legal ${pick(["a", ch(0xe4), "</script>"])} */\ng(${expr(0)});`;
    case 4:
      return `export const ${ident()}${rnd(1000)} = ${expr(0)};`;
    case 5:
      return `import ${pick(["x" + rnd(9), "{ y" + rnd(9) + " }", "* as ns" + rnd(9)])} from ${pick(["'m'", '"n' + ch(0xe4) + '"', "'</script>'"])};`;
    case 6:
      return `label${rnd(9)}: for (const k in ${expr(0)}) break;`;
    default:
      return `if (${expr(0)}) { h(${expr(0)}); }`;
  }
}
function jsxProgram() {
  const text = () => pick(["hi", ch(0xe4) + " x", "a &amp; b", "&#x1F600;", "  multi\n  line  ", "&nbsp;", "x" + ch(0xd83d) + ch(0xde00)]);
  return `const e = <div title=${pick(['"a&amp;b"', "'" + ch(0xe4) + "'", '"x\\\\y"', "{" + expr(1) + "}"])}>${text()}{${expr(1)}}<b>${text()}</b></div>;\n`;
}

const OPTION_SETS = [
  { loader: "js" },
  { loader: "js", charset: "utf8" },
  { loader: "js", format: "cjs", platform: "neutral" },
  { loader: "js", format: "esm", sourcemap: "external", sourcesContent: false },
  { loader: "js", charset: "utf8", sourcemap: "external" },
  { loader: "ts", format: "esm" },
];
const JSX_SETS = [{ loader: "jsx" }, { loader: "jsx", charset: "utf8", sourcemap: "external" }, { loader: "tsx", jsx: "automatic" }];

function flagsFor(o) {
  const flags = ["--log-level=silent", "--log-limit=0"];
  if (o.sourcesContent !== undefined) flags.push(`--sources-content=${o.sourcesContent}`);
  if (o.format) flags.push(`--format=${o.format}`);
  if (o.platform) flags.push(`--platform=${o.platform}`);
  if (o.charset) flags.push(`--charset=${o.charset}`);
  if (o.jsx) flags.push(`--jsx=${o.jsx}`);
  if (o.sourcemap) flags.push(`--sourcemap=${o.sourcemap}`);
  if (o.loader) flags.push(`--loader=${o.loader}`);
  return flags;
}

const counts = { ok: 0, bail: 0, bothFail: 0, FALSE_ACCEPT: 0, MISMATCH: 0, CRASH: 0 };
let shown = 0;

// User code whose top-level names collide with runtime helpers (renamed to
// "__defProp2" etc.) or with the helpers' nested names (renamed to "key2"
// etc.), interleaved with code that doesn't: exercises the runtime print cache
const RUNTIME_NAME_CASES = [
  "export const x = 1; import y from 'z'",
  "var __defProp = 1; export const x = __defProp; import * as ns from 'm'; ns.f()",
  "var key = 1, name = 2, mod = 3, target = 4, all = 5, from = 6, to = 7, except = 8, desc = 9, isNodeMode = 10; export default key + name; import d from 'e'",
  "export const x = 1; import y from 'z'",
  "let __toESM = 0, __copyProps = 1, __export = 2, __toCommonJS = 3, __create = 4, __getProtoOf = 5; export { __toESM }; import q from 'r'",
  "var desc = 0; export * from 'a'; export { b } from 'c'; import * as n from 'n'",
  "export class A { static #p = 1; m() { return A.#p } } export const f = async () => { await 0 }",
  "const x = require('y'); module.exports = x",
  "export const x = 1; import y from 'z'",
];
for (const code of RUNTIME_NAME_CASES) {
  for (const opts of [{ loader: "js", format: "cjs" }, { loader: "js", format: "cjs", sourcemap: "external" }, { loader: "ts", format: "iife", globalName: "G" }, { loader: "js", format: "esm" }]) {
    let ref = null;
    try {
      ref = esbuild.transformSync(code, opts);
      if (ref.warnings.length > 0) ref = null;
    } catch {}
    const errBefore = stats.error;
    const flags = flagsFor(opts);
    if (opts.globalName) flags.splice(2, 0, "--global-name=" + opts.globalName);
    const fast = fastTransform(flags, code, undefined);
    let cat;
    if (stats.error !== errBefore) cat = "CRASH";
    else if (fast === undefined) cat = ref === null ? "bothFail" : "bail";
    else if (ref === null) cat = "FALSE_ACCEPT";
    else if (fast.code !== ref.code || fast.map !== ref.map) cat = "MISMATCH";
    else cat = "ok";
    counts[cat]++;
    if (cat === "MISMATCH" || cat === "CRASH" || cat === "FALSE_ACCEPT") {
      console.log(`${cat} ${JSON.stringify(opts)} ${JSON.stringify(code)}`);
      if (cat === "CRASH") console.log("  " + String(stats.lastError && stats.lastError.stack).split("\n").slice(0, 4).join("\n  "));
    }
  }
}
for (let t = 0; t < N; t++) {
  const isJSX = rnd(5) === 0;
  let code = "";
  const n = 1 + rnd(4);
  for (let i = 0; i < n; i++) code += stmt() + "\n";
  if (isJSX) code += jsxProgram();
  for (const opts of isJSX ? JSX_SETS : OPTION_SETS) {
    let ref = null;
    try {
      ref = esbuild.transformSync(code, opts);
      if (ref.warnings.length > 0) ref = null;
    } catch {}
    const errBefore = stats.error;
    const fast = fastTransform(flagsFor(opts), code, undefined);
    let cat;
    if (stats.error !== errBefore) cat = "CRASH";
    else if (fast === undefined) cat = ref === null ? "bothFail" : "bail";
    else if (ref === null) cat = "FALSE_ACCEPT";
    else if (fast.code !== ref.code || fast.map !== ref.map || (fast.legalComments ?? undefined) !== (ref.legalComments ?? undefined)) cat = "MISMATCH";
    else cat = "ok";
    counts[cat]++;
    if ((cat === "MISMATCH" || cat === "CRASH" || cat === "FALSE_ACCEPT") && shown++ < showN) {
      console.log(`${cat} ${JSON.stringify(opts)}\n  input: ${JSON.stringify(code)}`);
      if (cat === "MISMATCH") console.log(`  esbuild: ${JSON.stringify(ref.code)}\n  fast:    ${JSON.stringify(fast.code)}`);
      if (cat === "CRASH") console.log("  " + String(stats.lastError && stats.lastError.stack).split("\n").slice(0, 4).join("\n  "));
    }
  }
}
console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "));
