// Randomized differential test vs native esbuild 0.28.2, aimed at the printer
// and lexer paths that real code rarely exercises: string/template escapes
// (control characters, quotes, "${", "</script", U+2028/9, BOM, surrogate
// pairs, lone surrogates, Latin-1 and BMP characters, under charset ascii and
// utf8), identifiers with non-ASCII characters and escapes, numbers, regular
// expressions, comments, JSX text and attribute strings, property keys, source
// maps over non-ASCII text. A second generator builds programs aimed at the
// minifier (constant folding, statement merging, dead code, renaming with
// nested scopes, labels, keep-names, drop, line limits) and at the lowering
// passes of older targets (classes with fields/private members/static
// blocks, async functions and generators, optional chains, nullish and
// logical assignments, object rest/spread, exponentiation, templates).
//
// usage: node test/fuzz.mjs [--n 3000] [--seed 1] [--show 5]
import { createRequire } from "node:module";
import { flagsFor, VITE_TARGETS, makeRefTransform, makeWasmTransform, ESBUILD_CRASHED, messagesJSON, classifyTransform } from "./flags.mjs";
const require = createRequire(import.meta.url);
const refTransform = makeRefTransform(require);
const wasmTransform = makeWasmTransform(require);
globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__ = true;
const { fastTransform, stats } = await (await import("./engine.mjs")).loadEngine();
// The runtime AST comes from the snapshot, as in the built engine (the test
// hook above checks it against a fresh parse)
{
  // (for the same keys as build.mjs: target esnext without minifySyntax and
  // minifyIdentifiers, with or without compat.InlineScript; every other
  // option set parses the runtime)
  if (!(await import("./engine.mjs")).bundled) {
  const { _testHooks, parseRuntimeForSnapshot, runtimeCacheKey } = await import("../src/bundler.mjs");
  const { encodeSnapshot } = await import("../src/snapshot.mjs");
  const { JSFeatureNone, InlineScript } = await import("../src/compat.mjs");
  const keys = [runtimeCacheKey(JSFeatureNone, false, false), runtimeCacheKey(InlineScript, false, false)];
  _testHooks.setRuntimeSnapshot({ keys, snapshot: encodeSnapshot(parseRuntimeForSnapshot()) });
  }
}

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

// Programs for the minifier and the lowering passes
const NAMES = ["a", "b", "c", "x", "y", "i", "n", "foo", "bar", "$", "_", "e", "t", "o"];
const name = () => pick(NAMES);
const LITERALS = ["0", "1", "-1", "2", "1.5", "1e3", "-0", "NaN", "Infinity", "0x10", "'s'", '"a" + "b"', "'abc'", "`t${1}`", "''", "true", "false", "null", "undefined", "void 0", "[]", "{}", "/re/g", "10n", "'1' * 1", "!0", "!1", "typeof x", "3 ** 2"];
function mexpr(d) {
  if (d > 3) return rnd(2) ? name() : pick(LITERALS);
  switch (rnd(30)) {
    case 0: case 1: return name();
    case 2: case 3: return pick(LITERALS);
    case 4: case 5: return `${mexpr(d + 1)} ${pick(["+", "-", "*", "/", "%", "**", "==", "===", "!=", "!==", "<", ">", "<=", ">=", "&&", "||", "??", "&", "|", "^", "<<", ">>", ">>>", "in", "instanceof", ","])} ${mexpr(d + 1)}`;
    case 6: return `${pick(["!", "-", "+", "~", "typeof ", "void ", "!!"])}${mexpr(d + 1)}`;
    case 7: return `(${mexpr(d + 1)} ? ${mexpr(d + 1)} : ${mexpr(d + 1)})`;
    case 8: return `${name()}(${mexpr(d + 1)}, ${mexpr(d + 1)})`;
    case 9: return `${name()}.${pick(["b", "length", "toString", "call", "prototype"])}${pick(["", "(" + mexpr(d + 1) + ")"])}`;
    case 10: return `${name()}${pick(["?.b", "?.[" + mexpr(d + 1) + "]", "?.(" + mexpr(d + 1) + ")", "?.b.c()", "?.b?.()"])}`;
    case 11: return `${name()}[${pick(["'b'", "'b' + 'c'", "0", "'0'", "'1e3'", mexpr(d + 1)])}]`;
    case 12: return `(${name()} ${pick(["=", "+=", "-=", "*=", "**=", "||=", "&&=", "??=", "|=", ">>>="])} ${mexpr(d + 1)})`;
    case 13: return `(${pick(["(a, b) => a + b", "async x => await x", "x => ({ x })", "() => { return " + mexpr(d + 1) + " }", "(...r) => r", "({ a, ...r }) => r", "([a, b = 1]) => a"])})`;
    case 14: return `{ ${pick(["a", "b: " + mexpr(d + 1), "[" + mexpr(d + 1) + "]: 2", "...s", "get g() { return 1 }", "m() { return this }", "'q-r': 3", "1: 4", "'x': 5", "async *ag() { yield 1 }", "__proto__: null"])}, ${pick(["c", "...t", "d: 1"])} }`;
    case 15: return `[${mexpr(d + 1)}, ...${name()}, , ${mexpr(d + 1)}]`;
    case 16: {
      const member = pick(["#p = 1; m() { return this.#p }", "static s = 2", "x = 3; y", "static { this.z = 1 }", "#m() {} n() { return #m in this }", "get #g() { return 1 } h() { return this.#g }", "static #q = 1; static r() { return this.#q++ }", "constructor() { super(); this.a = 1 }", "accessor k = 1", "m() { return super.m() }"]);
      return `(class ${pick(["", "K "])}${/super/.test(member) || rnd(3) === 0 ? "extends B " : ""}{ ${member} })`;
    }
    case 17: return `\`a\${${mexpr(d + 1)}}b\${${name()}}\``;
    case 18: return `${name()}\`x\${${mexpr(d + 1)}}\``;
    case 19: return `(function ${pick(["", "f"])}(${pick(["", "a", "a = 1", "...r", "{ a }"])}) { ${mstmt(d + 1)} return ${mexpr(d + 1)} })`;
    case 20: return `(() => ${mexpr(d + 1)})()`;
    case 21: return `(async function () { ${pick(["await " + mexpr(d + 1), "for await (const q of " + name() + ") f(q)", "return await " + name()])} })()`;
    case 22: return `new ${pick(["F", "Map", "Set", "Array", "Object", "RegExp"])}(${mexpr(d + 1)})`;
    case 23: return `${name()}${pick(["++", "--"])}`;
    case 24: return `delete ${name()}.p`;
    case 25: return `"${pick(["abc", "x", "use strict", "\\n"])}".${pick(["length", "charCodeAt(1)", "slice(1)", "toString()"])}`;
    case 26: return `String.fromCharCode(${pick(["97", "65, 66", "x"])})`;
    case 27: return `(${pick(["[a, b] = [b, a]", "({ a, ...r } = o)", "{ a: x = 1 } = o"])})`;
    case 28: return `(${mexpr(d + 1)}, ${mexpr(d + 1)})`;
    default: return `console.${pick(["log", "warn"])}(${mexpr(d + 1)})`;
  }
}
// A statement in a single-statement context (always a block, so that
// declarations are allowed)
const mbody = (d) => `{ ${mstmt(d)} }`;
function mstmt(d) {
  if (d > 3) return `${name()} = ${mexpr(d)};`;
  switch (rnd(24)) {
    case 0: return `${pick(["var", "let", "const"])} ${name()}${d}${rnd(999)} = ${mexpr(d + 1)};`;
    case 1: return `${pick(["var", "let", "const"])} { ${pick(["a", "a: b", "a = 1", "[k]: v"])}${d}${rnd(999)}, ...${pick(["rest", "r2"])}${d}${rnd(999)} } = ${name()};`.replace(/\{ (a|a: b|a = 1|\[k\]: v)(\d+)/, (m, p, n) => (p === "a" ? `{ a${n}` : p === "a: b" ? `{ a: b${n}` : p === "a = 1" ? `{ a${n} = 1` : `{ [k]: v${n}`));
    case 2: return `if (${mexpr(d + 1)}) ${mbody(d + 1)} ${pick(["", "else " + mbody(d + 1)])}`;
    case 3: return `if (${mexpr(d + 1)}) { return ${mexpr(d + 1)}; } ${pick(["", "return " + mexpr(d + 1) + ";"])}`;
    case 4: return `for (${pick(["let", "var"])} i = 0; i < ${mexpr(d + 1)}; i++) { ${mstmt(d + 1)} ${pick(["", "continue;", "break;"])} }`;
    case 5: return `for (const ${pick(["k", "[k, v]", "{ k, ...w }"])} ${pick(["in", "of"])} ${name()}) ${mbody(d + 1)}`;
    case 6: return `while (${mexpr(d + 1)}) { ${mstmt(d + 1)} }`;
    case 7: return `do ${mbody(d + 1)} while (${mexpr(d + 1)});`;
    case 8: return `switch (${mexpr(d + 1)}) { case 1: ${mbody(d + 1)} case "a": ${mbody(d + 1)} break; default: ${mbody(d + 1)} }`;
    case 9: {
      const label = pick(["DEV", "L", "outer"]) + d;
      return `${label}: { ${mstmt(d + 1)} if (${mexpr(d + 1)}) break ${label}; ${mstmt(d + 1)} }`;
    }
    case 10: return `try { ${mstmt(d + 1)} } catch ${pick(["", "(err) "])}{ ${mstmt(d + 1)} } ${pick(["", "finally { " + mstmt(d + 1) + " }"])}`;
    case 11: return `return ${mexpr(d + 1)};`;
    case 12: return `throw ${mexpr(d + 1)};`;
    case 13: return "debugger;";
    case 14: return `{ ${mstmt(d + 1)} ${mstmt(d + 1)} }`;
    case 15: return `${pick(["", "async "])}function${pick(["", "*"])} ${pick(["f", "g", "foo"])}${d}${rnd(999)}(${pick(["", "a", "a, b = 2", "...r", "{ a, ...r }", "[a] = []"])}) { ${mstmt(d + 1)} ${mstmt(d + 1)} return ${mexpr(d + 1)}; }`;
    case 16: {
      const member = pick(["#p = 1;", "static s = 2;", "x = 3;", "static { f(this) }", "#m() { return 1 }", "get g() { return this.#h } #h = 1;", "static #q = 1; static r() { return this.#q }", "constructor(a) { super(a); this.a = a }", "async *[Symbol.asyncIterator]() {}", "static accessor z = 1;", "n() { return super.n?.() }"]);
      return `class ${pick(["A", "B", "C"])}${d}${rnd(99)} ${/super/.test(member) || rnd(3) === 0 ? "extends Base " : ""}{ ${member} m() { ${mstmt(d + 1)} } }`;
    }
    case 17: return `console.log(${mexpr(d + 1)});`;
    case 18: return `(${pick(["", "async "])}() => { ${mstmt(d + 1)} })();`;
    case 19: return d === 0 ? `export ${pick(["const", "let", "var"])} ${pick(["ex", "ey"])}${rnd(999)} = ${mexpr(d + 1)};` : `${name()}.p = ${mexpr(d + 1)};`;
    case 20: return `if (${pick(["true", "false", "0", "1", "!0", "x"])}) { ${mstmt(d + 1)} } else { ${mstmt(d + 1)} }`;
    case 21: return `${name()} ${pick(["+=", "||=", "??=", "**="])} ${mexpr(d + 1)};`;
    case 22: return d === 0 ? `${name()}.q = ${mexpr(d + 1)};` : `using res${d}${rnd(999)} = ${name()};`;
    default: return `${mexpr(d + 1)};`;
  }
}
function minProgram() {
  let code = rnd(10) === 0 ? '"use strict";\n' : "";
  const n = 1 + rnd(5);
  for (let i = 0; i < n; i++) {
    const s = mstmt(0);
    // "return" is only valid inside functions: wrap some statements
    code += (!s.startsWith("export") && (/\breturn\b/.test(s) || rnd(3) === 0) ? `function w${i}(${pick(["", "a, b", "x"])}) { ${s} }` : s) + "\n";
  }
  return code;
}
const MIN_SETS = [
  { loader: "js", minify: true },
  { loader: "js", minifySyntax: true },
  { loader: "js", minifyIdentifiers: true, minifyWhitespace: true, charset: "utf8" },
  { loader: "js", format: "esm", minify: true, target: VITE_TARGETS },
  { loader: "js", target: "es2017" },
  { loader: "js", target: "es2015", minify: true, format: "cjs" },
  { loader: "js", target: "es2020", minifySyntax: true, keepNames: true },
  { loader: "js", minify: true, drop: ["console", "debugger"], dropLabels: ["DEV"], pure: ["f"], lineLimit: 50, sourcemap: "external" },
  { loader: "ts", target: ["node14"], minify: true, format: "iife" },
  { loader: "js", minify: true, mangleProps: /^[bpq]$|_$/, mangleQuoted: true, mangleCache: { p: "P", q: false } },
];

// (esbuildCrash: native esbuild itself panicked on the input; skipped.
// okWasm: differs from native esbuild but identical to esbuild-wasm, whose Go
// float->int conversions differ from amd64's, see flags.mjs)
const counts = { ok: 0, okWasm: 0, okError: 0, bail: 0, bothFail: 0, "FALSE-ACCEPT": 0, "FALSE-ERROR": 0, "MSG-MISMATCH": 0, MISMATCH: 0, CRASH: 0, esbuildCrash: 0 };
const BAD = new Set(["FALSE-ACCEPT", "FALSE-ERROR", "MSG-MISMATCH", "MISMATCH", "CRASH"]);
// Same result as esbuild-wasm (see makeWasmTransform)
function sameAsWasm(code, opts, fast) {
  const w = wasmTransform(code, opts);
  return w !== null && messagesJSON(w.warnings) === messagesJSON(fast.warnings) && w.code === fast.code && w.map === fast.map && (w.legalComments ?? undefined) === (fast.legalComments ?? undefined);
}

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
  for (const opts of [
    { loader: "js", format: "cjs" },
    { loader: "js", format: "cjs", sourcemap: "external" },
    { loader: "ts", format: "iife", globalName: "G" },
    { loader: "js", format: "esm" },
    { loader: "js", format: "cjs", minify: true },
    { loader: "js", format: "cjs", target: "es2017" },
    { loader: "ts", format: "iife", globalName: "G", minifyIdentifiers: true, target: "es2020" },
  ]) {
    let ref = null;
    let refError = null;
    try {
      ref = refTransform(code, opts);
      if (ref === ESBUILD_CRASHED) {
        counts.esbuildCrash++;
        continue;
      }
    } catch (e) {
      refError = e;
    }
    const errBefore = stats.error;
    const fast = fastTransform(flagsFor(opts), code, undefined);
    let cat;
    let msgDiff = null;
    if (stats.error !== errBefore) cat = "CRASH";
    else [cat, msgDiff] = classifyTransform(ref, refError, fast);
    if (cat === "MISMATCH" && sameAsWasm(code, opts, fast)) cat = "okWasm";
    counts[cat]++;
    if (BAD.has(cat)) {
      console.log(`${cat} ${JSON.stringify(opts)} ${JSON.stringify(code)}`);
      if (msgDiff !== null) console.log(msgDiff);
      if (cat === "CRASH") console.log("  " + String(stats.lastError && stats.lastError.stack).split("\n").slice(0, 4).join("\n  "));
    }
  }
}
for (let t = 0; t < 2 * N; t++) {
  // (odd iterations: programs for the minifier and the lowering passes)
  const isMin = t % 2 === 1;
  const isJSX = !isMin && rnd(5) === 0;
  let code = "";
  if (isMin) code = minProgram();
  else {
    const n = 1 + rnd(4);
    for (let i = 0; i < n; i++) code += stmt() + "\n";
  }
  if (isJSX) code += jsxProgram();
  for (const opts of isMin ? MIN_SETS : isJSX ? JSX_SETS : OPTION_SETS) {
    let ref = null;
    let refError = null;
    try {
      ref = refTransform(code, opts);
      if (ref === ESBUILD_CRASHED) {
        counts.esbuildCrash++;
        continue;
      }
    } catch (e) {
      refError = e;
    }
    const errBefore = stats.error;
    const fast = fastTransform(flagsFor(opts), code, opts.mangleCache);
    let cat;
    let msgDiff = null;
    if (stats.error !== errBefore) cat = "CRASH";
    else [cat, msgDiff] = classifyTransform(ref, refError, fast);
    if (cat === "MISMATCH" && sameAsWasm(code, opts, fast)) cat = "okWasm";
    counts[cat]++;
    if (BAD.has(cat) && shown++ < showN) {
      console.log(`${cat} ${JSON.stringify(opts)}\n  input: ${JSON.stringify(code)}`);
      if (msgDiff !== null) console.log(msgDiff);
      if (cat === "MISMATCH") console.log(`  esbuild: ${JSON.stringify(ref.code)}\n  fast:    ${JSON.stringify(fast.code)}`);
      if (cat === "CRASH") console.log("  " + String(stats.lastError && stats.lastError.stack).split("\n").slice(0, 4).join("\n  "));
    }
  }
}
console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "));

// (failure: any category other than an identical result, a bail or a
// case esbuild itself crashes on)
process.exitCode = ["FALSE-ACCEPT", "FALSE-ERROR", "MSG-MISMATCH", "MISMATCH", "CRASH"].some((k) => counts[k] > 0) ? 1 : 0;
