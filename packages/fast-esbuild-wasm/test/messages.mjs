// Messages: errors and warnings (every field: text, location with line,
// column, length and lineText, suggestion, notes, id, plugin name) and what
// esbuild prints to the console at each log level, compared with esbuild.
//
//   1. snippets that trigger each kind of message (JavaScript, TypeScript,
//      JSX, CSS, option-dependent ones), under every log level, log limits,
//      log overrides, both log styles and colors: the response's messages vs
//      native esbuild, the console output vs esbuild-wasm's (Go writes it to
//      stderr; esbuild-wasm's Node API runs Go in a child process whose
//      stderr is captured here)
//   2. esbuild's own parser tests (internal/js_parser/*_test.go of an
//      esbuild checkout: every expectParseError/expectPrinted input, with
//      the loader and target of the helper) and the JavaScript files of its
//      bundler tests, transformed and compared with native esbuild
//   3. mutated real files (truncated, a character deleted, garbage inserted:
//      mostly syntax errors) compared with native esbuild
//   4. formatMessages() and analyzeMetafile() vs esbuild-wasm, which must not
//      load the Go binary
//   5. build() and context() with options that do not validate, files that
//      do not load (source map comments, data URLs) and plugins returning
//      odd results, vs esbuild-wasm (results and console output); none may
//      go to Go
//
// usage: node test/messages.mjs [--esbuild <checkout>] [--mutations N] [--seed S] [--show N] [--part 1,2,3,4,5] [--jobs N]
//
// The parts run in parallel processes (see shard.mjs) unless --jobs 1 or
// --part is given.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { flagsFor, makeRefTransform, ESBUILD_CRASHED, classifyTransform, VITE_TARGETS } from "./flags.mjs";
import { parseGoStringExpr } from "./css-inputs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const refTransform = makeRefTransform(require);
globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__ = true;
const { fastTransform, stats } = await (await import("./engine.mjs")).loadEngine();
const { setStderr } = await (await import("./engine.mjs")).loadEngine();
// (what the engine prints goes nowhere, except where part 1 compares it)
const discard = () => {};
setStderr(discard);

const args = process.argv.slice(2);
const getArg = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const esbuildSrc = getArg("--esbuild", join(tmpdir(), "esbuild-src"));
const nMutations = Number(getArg("--mutations", 3000));
let seed = Number(getArg("--seed", 12345));
const showN = Number(getArg("--show", 5));
const { shardOf, jobsOf, runShards, printSummary, addUp } = await import("./shard.mjs");
const shard = shardOf(args);
// (a shard process runs one part)
const parts = new Set(shard !== null ? [shard.index + 1] : getArg("--part", "1,2,3,4,5").split(",").map(Number));

let failures = 0;
const counts = {};
const shown = {};
function tally(part, cat, what, detail) {
  const key = part + " " + cat;
  counts[key] = (counts[key] || 0) + 1;
  if (cat === "ok" || cat === "okPrinted" || cat === "okReordered" || cat === "okError" || cat === "bail" || cat === "bothFail" || cat === "esbuildCrash") return;
  failures++;
  shown[key] = (shown[key] || 0) + 1;
  if (shown[key] <= showN) {
    console.log(`${cat} [${part}] ${what}`);
    if (detail) console.log(detail);
  }
}

// One transform through the engine, compared with native esbuild
function compare(part, code, opts, what) {
  let ref = null;
  let refError = null;
  try {
    // (the log level only decides what is printed)
    ref = refTransform(code, { ...opts, logLevel: "silent" });
  } catch (e) {
    refError = e;
  }
  if (ref === ESBUILD_CRASHED) return tally(part, "esbuildCrash");
  const errBefore = stats.error;
  const fast = fastTransform(flagsFor(opts), code, opts.mangleCache);
  if (stats.error !== errBefore) return tally(part, "CRASH", what, "  " + String(stats.lastError && stats.lastError.stack).split("\n").slice(0, 5).join("\n  "));
  const [cat, diff] = classifyTransform(ref, refError, fast);
  if (cat === "bail" || cat === "bothFail") {
    const lb = stats.lastBail;
    const key = (lb ? lb.reason + (lb.detail ? ": " + lb.detail.slice(0, 60) : "") : "?");
    bailReasons.set(key, (bailReasons.get(key) || 0) + 1);
    if (!bailExamples.has(key)) bailExamples.set(key, JSON.stringify(code).slice(0, 100) + " " + JSON.stringify(opts).slice(0, 200));
  }
  tally(part, cat, what + " " + JSON.stringify(code.length > 300 ? code.slice(0, 300) + "..." : code) + " " + JSON.stringify(opts), diff);
}
const bailReasons = new Map();
const bailExamples = new Map();

// ---------------------------------------------------------------------------
// 1. Snippets

const JS_SNIPPETS = [
  // syntax errors (lexer and parser)
  "a b",
  "let x = ;",
  "/* unterminated",
  "'unterminated string",
  "`template ${",
  "/regex",
  "x = /a/gg",
  "\\u0030x = 1",
  "a = \\u{110000}",
  "class { }",
  "function f() { await x }",
  "async function f() { let await = 1 }",
  "function* g() { yield\n* 1 }",
  "for (async of []) ;",
  "x => \n {}",
  "(a, ...b,) => 1",
  "let [a, ...b,] = c",
  "let { ...a, b } = c",
  "({ a = 1 })",
  "a ?? b || c",
  "a || b ?? c",
  "new a?.b()",
  "a?.b`c`",
  "super()",
  "this = 1",
  "import.meta = 1",
  "1 = 2",
  "let let = 1",
  "const x;",
  "for (let a, b of c) ;",
  "for (let a = 1 of c) ;",
  "label: label: ;",
  "break foo",
  "continue",
  "while (1) { continue foo }",
  "return",
  "export { x }",
  "export default 1; export default 2",
  "export { a as b, c as b }; var a, c",
  "import { eval } from 'x'",
  "delete x.#y",
  "class A { #x; static { delete this.#x } }",
  "class A { m() { this.#y } }",
  "class A { constructor() {} constructor() {} }",
  "class A { get constructor() {} }",
  "class A { static prototype() {} }",
  "class A { #constructor = 1 }",
  "({ get a(x) {} })",
  "({ set a() {} })",
  "function f(a, a) { 'use strict' }",
  "function f(a = 1) { 'use strict' }",
  "'use strict'; with (x) {}",
  "'use strict'; delete x",
  "'use strict'; var eval",
  "'use strict'; 010",
  "'use strict'; '\\01'",
  "`\\01`",
  "if (1) function f() {}",
  "'use strict'; if (1) function f() {}",
  "switch (x) { default: default: }",
  "let x; let x",
  "export let x; export function x() {}",
  "<div>",
  "x = <div></span>",
  "a <!-- b",
  "x\n--> comment",
  "export {}; a <!-- b",
  "let \\u{1F600} = 1",
  "a.b?.c = 1",
  "let [a] = [1]; [a, b] = 1; ({ a: 1 } = 2)",
  "x = import(a, b, c)",
  "x = import(a, { with: 1 })",
  "import x from 'y' with { type: 'json', type: 'json' }",
  "import x from 'y' assert { type: 'json' }",
  "@dec class A {}",
  "class A { @dec #x }",
  "function f(@dec x) {}",
  "try {} catch ({ a, a }) {}",
  "x = 1 +",
  "'\\u{d800}'",
  "a b",
  "import 'x'; return",
  "#!/usr/bin/env node\nx y",
  "for await (x of y) ;",
  "for (let x of [], y) ;",
  "a => { 'use strict'; with (b) {} }",
  "({ __proto__: 1, __proto__: 2 })",
  "x = { async *[Symbol.iterator]() {}, get ['a']() {}, set a(v) {} }",
  "class A { static { await 1 } }",
  "using x = y",
  "{ using x = y }",
  "switch (x) { case 1: using y = z }",
  "for (using x in y) ;",
  "function f() { new.target } new.target",
  "x = a?.b?.#c",
  "yield x",
  "function* g() { function h() { yield 1 } }",
  "async () => { for await (const x of y) {} }",
  "a\n++\nb",
  "let x = 1n; let y = 0xFFn",
  "x = 1_000_; y = 0_1",
  "x = 08.5; y = 09",
  "throw\nx",
  // warnings (JavaScript)
  "if (x === NaN) y()",
  "if (x == -0) y()",
  "if (x !== []) y()",
  "if (typeof x == 'null') y()",
  "if (typeof x === 'strin') y()",
  "if (!a in b) y()",
  "if (!a instanceof B) y()",
  "switch (x) { case 1: case 1: }",
  "switch (x) { case 'a': case 'a': }",
  "switch (x) { case NaN: case -0: }",
  "x = { a: 1, a: 2 }",
  "class A { a() {} a() {} }",
  "eval('x')",
  "function f() { return\nx + 1 }",
  "const x = 1; x = 2",
  "const x = 1; x++",
  "import x from 'y'; x = 1",
  "import * as ns from 'y'; ns.a = 1; ns()",
  "import * as ns from 'y'; new ns()",
  "class A { static #x() {} static f() { A.#x = 1 } }",
  "class A { get #x() { return 1 } f() { this.#x = 1 } }",
  "class A { set #x(v) {} f() { return this.#x } }",
  "class A { m() { delete super.x } }",
  "a = b => 1 || b <= 0",
  "a = b => 0 && b <= 1",
  "x = (a === b) ?? c",
  "x = {} ?? y",
  "x = require(a)",
  "x = require(a, b)",
  "x = require('y')",
  "x = import(a)",
  "require.resolve('x')",
  "x = typeof require; y = require",
  "export default 1; module.exports = 2",
  "export const a = 1; exports.b = 2",
  "import.meta.url",
  "x = import.meta",
  "this.x = 1; export {}",
  "try { x = 1n } catch {}",
  "/(?<name>a)(?<=b)\\p{L}/su",
  "x = /a/v",
  "x = /a/d",
  "a <!-- b",
  "/* @__PURE__ */ x()",
  "x = 'a' in {}",
  "x = { ...a, get b() {} }",
  "class A { static [A.x] = 1 }",
  "var \\u{10000} = 1",
  "x = '\\u{10000}'",
];

const TS_SNIPPETS = [
  "let x: = 1",
  "enum E { A B }",
  "enum E { A = 1 B }",
  "type T<in in T> = T",
  "type T = [function: number]",
  "interface\nI {}",
  "export interface\nI {}",
  "class A { declare #x: number }",
  "class A { declare [key: string]: any }",
  "class A { declare m() {} }",
  "abstract class A { abstract m() { } }",
  "x = <T>(y) => y",
  "x = a as any + 1",
  "x = a as number ?? b",
  "x = 1 as any ** 2",
  "namespace N { export const x = 1 } N = 2",
  "import x = require('y'); x = 1",
  "export = 1; export default 2",
  "class A { constructor(public x = 1, x) {} }",
  "let x!: number = 1",
  "function f(this: void, ...a,) {}",
  "declare module 'x' { export default 1 }",
  "@dec export @dec class A {}",
  "class A { @dec static { } }",
  "x = <div>",
  "const enum E { A = 'a' + 1 }",
  "export type { A } from 'b'; export { type }",
  "import type A, { B } from 'c'",
];

const JSX_SNIPPETS = [
  "x = <div a a />",
  "x = <div>}</div>",
  "x = <div>></div>",
  "x = <div a=\"\\\"\" b />",
  "x = <a.b-c />",
  "x = <a:b:c />",
  "x = <div></div><div></div>",
  "x = <div key />",
  "x = <div __source={1} />",
  "x = <></div>",
  "x = <div>",
  "/** @jsx h */ /** @jsxFrag F */ /** @jsxRuntime auto */ x = <div />",
  "/** @jsxImportSource foo */ x = <div />",
  "/** @jsx 123 */ x = <div />",
  "import * as ns from 'x'; <ns />",
];

const CSS_SNIPPETS = [
  "a { color: red",
  "a { color red }",
  "a { colr: red }",
  "a { background-clor: red }",
  "// comment\na {}",
  "a { b: url(a b) }",
  "a { b: url(a\"b) }",
  "a { b: url(\u0001) }",
  "a { b: \"unterminated\n}",
  "@charset \"latin1\";",
  "a {} @charset \"utf-8\";",
  "a {} @import \"x.css\";",
  "a { @import \"x.css\"; }",
  "@namespace x url(y);",
  "@layer initial;",
  "@keyframes none {}",
  "a { width: calc(1px+2px) }",
  "a { width: calc(1px -2px) }",
  "a { width: calc(-(1px)) }",
  "a { &div {} }",
  "a { b { &c {} } }",
  "a:is(.b, .c) {}",
  "a:has(.b, .c) {}",
  ":global(.a, .b) {}",
  "a { composes: b }",
  ".a { composes: b from global }",
  ".a { composes: b from \"x.css\" }",
  ".a b { composes: c }",
  ".a { composes: b from local }",
  "a { \\ }",
  "/* unterminated",
  "a { b: c } }",
  "a[b = c] {}",
  "a:nth-child(2n+) {}",
  "@media (min-width: 100px {}",
  "a { color: #gggggg }",
  ".a { .b & { } }",
  "a { @media (x) { & b { } } }",
];

const LOG_VARIANTS = [
  {},
  { logLevel: "warning" },
  { logLevel: "info" },
  { logLevel: "debug" },
  { logLevel: "verbose" },
  { logLevel: "error" },
  { logLevel: "warning", logLimit: 1 },
  { logLevel: "info", logLimit: 2 },
  { logLevel: "warning", logStyle: "visualstudio" },
  { logLevel: "warning", color: true },
  { logLevel: "info", color: false },
  {
    logLevel: "info",
    logOverride: {
      "equals-nan": "error",
      "equals-negative-zero": "silent",
      "duplicate-case": "debug",
      "commonjs-variable-in-esm": "info",
      "unsupported-require-call": "warning",
      "direct-eval": "warning",
      "indirect-require": "warning",
      "unsupported-dynamic-import": "warning",
      "unsupported-regexp": "warning",
      "this-is-undefined-in-esm": "warning",
      "css-syntax-error": "error",
      "unsupported-css-property": "silent",
      "js-comment-in-css": "info",
    },
  },
];

const SNIPPET_SETS = [];
for (const code of JS_SNIPPETS) {
  SNIPPET_SETS.push([code, { loader: "js" }]);
  SNIPPET_SETS.push([code, { loader: "js", format: "esm", target: "es2015", sourcefile: "dir/file.js" }]);
  SNIPPET_SETS.push([code, { loader: "js", format: "cjs", platform: "node", target: "es5", minify: true }]);
}
for (const code of TS_SNIPPETS) {
  SNIPPET_SETS.push([code, { loader: "ts" }]);
  SNIPPET_SETS.push([code, { loader: "ts", format: "esm", tsconfigRaw: { compilerOptions: { experimentalDecorators: true } } }]);
}
for (const code of JSX_SNIPPETS) {
  SNIPPET_SETS.push([code, { loader: "jsx" }]);
  SNIPPET_SETS.push([code, { loader: "tsx", jsx: "automatic", jsxDev: true }]);
  SNIPPET_SETS.push([code, { loader: "js" }]);
}
for (const code of CSS_SNIPPETS) {
  SNIPPET_SETS.push([code, { loader: "css" }]);
  SNIPPET_SETS.push([code, { loader: "local-css", minify: true, target: "chrome80" }]);
  SNIPPET_SETS.push([code, { loader: "css", target: ["safari12", "ie11"], sourcefile: "styles/a.css" }]);
}
// Messages that depend on options
SNIPPET_SETS.push(["x = 1", { loader: "js", target: "es5", keepNames: true }]);
SNIPPET_SETS.push(["let \u{10000}y = 1", { loader: "js", target: "es5", charset: "ascii" }]);
SNIPPET_SETS.push(["process.env.NODE_ENV = 1", { loader: "js", define: { "process.env.NODE_ENV": '"production"' } }]);
SNIPPET_SETS.push(["a.b.c = 1; a.b.c++", { loader: "js", define: { "a.b.c": "1" } }]);
SNIPPET_SETS.push(["x = 1 ** 2; async function* f() {} for await (x of y) ;", { loader: "js", target: "es5", format: "esm" }]);
SNIPPET_SETS.push(["let [a, ...[b]] = c", { loader: "js", target: "es5" }]);
SNIPPET_SETS.push(["export default await x", { loader: "js", target: "es2020", format: "esm" }]);
SNIPPET_SETS.push(["export default await x", { loader: "js", format: "cjs" }]);
SNIPPET_SETS.push(["x = import('a', { with: { type: 'json' } }); y = import('b', c)", { loader: "js", target: "chrome90" }]);
SNIPPET_SETS.push(["import x from 'y' assert { type: 'json' }", { loader: "js", target: "chrome120" }]);
SNIPPET_SETS.push(["import defer * as x from 'y'; import source y from 'z'", { loader: "js", target: "es2020" }]);
SNIPPET_SETS.push(["x = /(?<a>b)/", { loader: "js", target: "es2017", supported: { "regexp-named-capture-groups": false } }]);
SNIPPET_SETS.push(["x = 1n", { loader: "js", target: ["chrome60", "firefox60"], supported: { arrow: false } }]);
SNIPPET_SETS.push(["let x: number = <T,>(y) => y", { loader: "ts", tsconfigRaw: { compilerOptions: { target: "es1234", importsNotUsedAsValues: "bogus", jsx: "bogus" } } }]);
SNIPPET_SETS.push(["x", { loader: "ts", tsconfigRaw: '{ "compilerOptions": { "jsxFactory": "a-b", "paths": { "a*b*": ["c"] } }, "jsx": "react" }' }]);
SNIPPET_SETS.push(["x", { loader: "ts", tsconfigRaw: '{ "compilerOptions": { "paths": { "a": "b", "c": ["d"] } } }' }]);
SNIPPET_SETS.push(["x", { loader: "js", tsconfigRaw: "{ bad json" }]);
SNIPPET_SETS.push(["//# sourceMappingURL=data:application/json;base64,e30=\nx", { loader: "js", sourcemap: true }]);
SNIPPET_SETS.push(["x", { loader: "jsx", jsxFactory: "h", jsxFragment: "F", jsx: "automatic" }]);
SNIPPET_SETS.push(["x = <div/>", { loader: "jsx", jsxImportSource: "preact" }]);
// Options that do not validate (transformImpl's errors and warnings, and the
// service's error for a flag it rejects)
for (const o of [
  { target: "foo" },
  { target: "chrome" },
  { target: ["es2020", "node"] },
  { target: "chrome1.2.3.4" },
  { target: ["chromeabc", "node1.x"] },
  { supported: { bogus: true, arrow: false } }, // (one invalid name: Go logs them in random map order)
  { define: { x: "a b" } },
  { define: { "a-b": "1" } },
  { define: { "a[0]": "1" } },
  { define: { "a['b']": "1", "import.meta.x": "2", "this.y": "3", "a.if": "4" } },
  { define: { "import.x": "1" } },
  { define: { "1a": "1" } },
  { define: { "process.env.NODE_ENV": "production" } },
  { define: { "process.env.NODE_ENV": "é" } },
  { jsxFactory: "a-b" },
  { jsxFragment: "1+" },
  { jsxFactory: "123" },
  { globalName: "a-b", format: "iife" },
  { globalName: "a[0]", format: "iife" },
  { globalName: "a['b'].c", format: "iife" },
  { globalName: "a.", format: "iife" },
  { pure: ["a-b", "c"] },
  { keepNames: true, target: "es5" },
  { keepNames: true, target: "chrome30", supported: { arrow: false } },
  { sourcemap: "linked" },
  { legalComments: "linked" },
  { mangleCache: { a: "__proto__", b: "c" } },
  { absPaths: ["code", "log", "metafile"], define: { "a-b": "1" } },
  { absPaths: ["log", "bogus"] },
  { loader: "bogus" },
  { loader: "file" },
  { target: "es5", keepNames: true, supported: { bogus: true }, define: { x: "a b" }, jsxFactory: "1", sourcemap: "linked" },
]) {
  SNIPPET_SETS.push(["x = <div/>", { loader: "jsx", ...o }]);
}

function part1() {
  // Messages vs native esbuild
  for (const [code, opts] of SNIPPET_SETS) {
    for (const v of LOG_VARIANTS) compare(1, code, { ...opts, ...v }, "snippet");
  }

  // Console output vs esbuild-wasm (Go in a child process: its stderr)
  const cases = [];
  for (const [code, opts] of SNIPPET_SETS) {
    for (const v of LOG_VARIANTS) {
      if (v.logLevel === undefined || v.logLevel === "silent") continue;
      cases.push([code, { ...opts, ...v }]);
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "fast-esbuild-msg-"));
  try {
    const input = join(dir, "cases.json");
    writeFileSync(input, JSON.stringify(cases.map(([code, opts]) => [code, opts.logOverride === undefined ? opts : opts, opts.mangleProps])));
    const script = join(dir, "ref.cjs");
    writeFileSync(
      script,
      `const esbuild = require(${JSON.stringify(require.resolve("esbuild-wasm"))});
const cases = JSON.parse(require("fs").readFileSync(${JSON.stringify(input)}, "utf8"));
for (let i = 0; i < cases.length; i++) {
  process.stderr.write("\\u0000CASE " + i + "\\u0000");
  try { esbuild.transformSync(cases[i][0], cases[i][1]); } catch {}
}
process.stderr.write("\\u0000CASE end\\u0000");
`,
    );
    const r = spawnSync(process.execPath, [script], { encoding: "utf8", maxBuffer: 1 << 28 });
    const refOut = new Map();
    const chunks = r.stderr.split("\u0000CASE ");
    for (const chunk of chunks.slice(1)) {
      const end = chunk.indexOf("\u0000");
      refOut.set(chunk.slice(0, end), chunk.slice(end + 1));
    }
    let printed = "";
    setStderr((text) => (printed += text));
    try {
      for (let i = 0; i < cases.length; i++) {
        const [code, opts] = cases[i];
        printed = "";
        const fast = fastTransform(flagsFor(opts), code, opts.mangleCache);
        if (fast === undefined) {
          tally(1, "bail");
          continue;
        }
        const expected = refOut.get(String(i));
        if (expected === undefined) tally(1, "CONSOLE-MISSING", JSON.stringify(code) + " " + JSON.stringify(opts));
        else if (expected !== printed) {
          let k = 0;
          while (k < expected.length && expected[k] === printed[k]) k++;
          tally(1, "CONSOLE-MISMATCH", JSON.stringify(code) + " " + JSON.stringify(opts), `  at ${k}\n    esbuild-wasm: ${JSON.stringify(expected.slice(Math.max(0, k - 100), k + 100))}\n    fast:         ${JSON.stringify(printed.slice(Math.max(0, k - 100), k + 100))}`);
        } else tally(1, "ok");
      }
    } finally {
      setStderr(discard);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 2. esbuild's own tests

// The helper names of js_parser_test.go & co and the options they imply.
// Returns null for helpers that are skipped.
function optionsForHelper(name, extra) {
  let loader = "js";
  if (/TSX$|TSX[A-Z]/.test(name)) loader = "tsx";
  else if (/TS/.test(name)) loader = "ts";
  else if (/JSX/.test(name)) loader = "jsx";
  else if (/JSON/.test(name)) return null;
  const o = { loader };
  if (/Mangle/.test(name)) o.minifySyntax = true;
  if (/ASCII/.test(name)) o.charset = "ascii";
  if (/ExperimentalDecorator/.test(name)) o.tsconfigRaw = { compilerOptions: { experimentalDecorators: true } };
  if (/JSXAutomatic/.test(name)) o.jsx = "automatic";
  if (/Target/.test(name)) {
    if (!/^\d+$/.test(extra)) return null;
    o.target = "es" + (extra === "5" ? "5" : extra);
  } else if (extra !== null) return null;
  return o;
}

function goTestInputs() {
  const out = [];
  const dir = join(esbuildSrc, "internal", "js_parser");
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith("_test.go")) continue;
    const go = readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n");
    const re = /\b(expect\w*)\(t, /g;
    let m;
    while ((m = re.exec(go)) !== null) {
      let i = m.index + m[0].length;
      let extra = null;
      if (go[i] !== '"' && go[i] !== "`") {
        const comma = go.indexOf(", ", i);
        if (comma < 0) continue;
        extra = go.slice(i, comma);
        i = comma + 2;
      }
      const r = parseGoStringExpr(go, i);
      if (r === null) continue;
      const opts = optionsForHelper(m[1], extra);
      if (opts !== null) out.push([`${f}:${m[1]}`, r[0], opts]);
    }
  }
  // The JavaScript and TypeScript files of the bundler tests
  const bdir = join(esbuildSrc, "internal", "bundler_tests");
  if (existsSync(bdir)) {
    for (const f of readdirSync(bdir)) {
      if (!f.endsWith("_test.go")) continue;
      const go = readFileSync(join(bdir, f), "utf8").replace(/\r\n/g, "\n");
      const re = /"(\/[^"\n]+\.(js|jsx|ts|tsx|mjs|cjs|mts|cts))":\s+/g;
      let m;
      while ((m = re.exec(go)) !== null) {
        const r = parseGoStringExpr(go, m.index + m[0].length);
        if (r === null) continue;
        const ext = m[2];
        const loader = ext === "jsx" ? "jsx" : ext === "tsx" ? "tsx" : ext === "ts" || ext === "mts" || ext === "cts" ? "ts" : "js";
        out.push([`${f}:${m[1]}`, r[0], { loader, sourcefile: m[1] }]);
      }
    }
  }
  return out;
}

function part2() {
  const inputs = goTestInputs();
  if (inputs.length === 0) console.log(`(part 2 skipped: no esbuild checkout at ${esbuildSrc})`);
  for (const [name, code, opts] of inputs) {
    compare(2, code, opts, name);
    compare(2, code, { ...opts, format: "esm", minify: true, logLevel: "warning" }, name);
    compare(2, code, { ...opts, format: "cjs", target: "es2015" }, name);
  }
  return inputs.length;
}

// ---------------------------------------------------------------------------
// 3. Mutated real files

function random(n) {
  // (xorshift32)
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) % n;
}

function corpusFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== ".git" && out.length < 20000) walk(p);
      } else if (/\.(js|mjs|cjs|ts|tsx|jsx|css)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        try {
          if (statSync(p).size < 200000) out.push(p);
        } catch {}
      }
    }
  };
  walk(join(here, "../../../node_modules"));
  return out;
}

const GARBAGE = ["(", ")", "{", "}", "[", "]", ";", ",", ".", "=", "=>", "<", ">", "/", "*", "`", "'", '"', "\\", "#", "@", "?", ":", "!", "\n", " ", "await ", "yield ", "let ", "class ", "function ", "import ", "export ", "é", " ", "😀", "}}", "/*"];

function part3() {
  const files = corpusFiles();
  if (files.length === 0) return 0;
  for (let t = 0; t < nMutations; t++) {
    const file = files[random(files.length)];
    let code;
    try {
      code = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const pos = code.length === 0 ? 0 : random(code.length);
    switch (random(3)) {
      case 0:
        code = code.slice(0, pos);
        break;
      case 1:
        code = code.slice(0, pos) + code.slice(pos + 1 + random(3));
        break;
      default:
        code = code.slice(0, pos) + GARBAGE[random(GARBAGE.length)] + code.slice(pos);
    }
    if (!code.isWellFormed()) code = code.toWellFormed();
    const ext = extname(file);
    const loader = ext === ".css" ? (random(2) ? "css" : "local-css") : ext === ".ts" ? "ts" : ext === ".tsx" ? "tsx" : ext === ".jsx" ? "jsx" : "js";
    const optionSets =
      loader === "css" || loader === "local-css"
        ? [{ loader }, { loader, minify: true, target: VITE_TARGETS }]
        : [{ loader }, { loader, format: "esm", minify: true }, { loader, format: "cjs", target: "es2015", logLevel: "warning" }];
    for (const opts of optionSets) compare(3, code, opts, file.slice(file.lastIndexOf("node_modules")));
  }
  return nMutations;
}

// ---------------------------------------------------------------------------
// 4. formatMessages() and analyzeMetafile()

async function part4() {
  const STATS = Symbol.for("@r1ck404/fast-esbuild-wasm:stats");
  const fast = (await import("../node.mjs")).default;
  await fast.initialize({});
  const ref = require("esbuild-wasm");

  const loc = (o) => ({ file: "src/a.js", line: 3, column: 4, length: 2, lineText: "let x = foo.bar;", ...o });
  const messages = [
    [],
    [{ text: "plain" }],
    [{ text: "with location", location: loc() }],
    [{ text: "with id", id: "equals-nan", location: loc() }],
    [{ text: "with plugin", pluginName: "my-plugin", location: loc({ namespace: "custom" }) }],
    [{ text: "suggestion", location: loc({ suggestion: "baz" }) }],
    [{ text: "notes", location: loc(), notes: [{ text: "a note" }, { text: "note with location", location: loc({ line: 1, column: 0, length: 3 }) }, { text: "multi\nline note https://esbuild.github.io/api/ (see)." }] }],
    [{ text: "tabs", location: loc({ lineText: "\t\tlet x = 1;\t// comment", column: 6, length: 3 }) }],
    [{ text: "long line", location: loc({ lineText: "x".repeat(500) + "target" + "y".repeat(500), column: 500, length: 6 }) }],
    [{ text: "end of line", location: loc({ column: 16, length: 0 }) }],
    [{ text: "out of range", location: loc({ line: -1, column: 100, length: 50 }) }],
    [{ text: "unicode", location: loc({ lineText: "const é = '😀 ünïcödé';", column: 9, length: 7 }) }],
    [{ text: "multi-line lineText", location: loc({ lineText: "first\nsecond", column: 2, length: 1 }) }],
    [{ text: "a", location: loc() }, { text: "b" }, { text: "c", location: loc({ file: "" }) }],
    [{ text: "BOM", location: loc({ lineText: "﻿x = 1", column: 3, length: 1 }) }],
  ];
  const variants = [
    { kind: "error" },
    { kind: "warning" },
    { kind: "error", color: true },
    { kind: "warning", terminalWidth: 40 },
    { kind: "error", terminalWidth: 120, color: true },
    { kind: "warning", terminalWidth: 10 },
  ];
  for (const msgs of messages) {
    for (const v of variants) {
      const a = await ref.formatMessages(msgs, v);
      const b = await fast.formatMessages(msgs, v);
      const same = JSON.stringify(a) === JSON.stringify(b);
      tally(4, same ? "ok" : "FORMAT-MISMATCH", JSON.stringify(msgs).slice(0, 200) + " " + JSON.stringify(v), same ? "" : "  esbuild-wasm: " + JSON.stringify(a) + "\n  fast:         " + JSON.stringify(b));
    }
  }
  // log styles (the glue checks the value, Go reports an unknown one)
  for (const logStyle of ["visualstudio", "default"]) {
    const a = await ref.formatMessages(messages[6], { kind: "error", logStyle }).catch((e) => "threw " + e.message);
    const b = await fast.formatMessages(messages[6], { kind: "error", logStyle }).catch((e) => "threw " + e.message);
    tally(4, JSON.stringify(a) === JSON.stringify(b) ? "ok" : "FORMAT-MISMATCH", "logStyle " + logStyle, "  " + JSON.stringify(a) + "\n  " + JSON.stringify(b));
  }

  // analyzeMetafile: metafiles of real builds (esbuild-wasm's) and odd ones
  const metafiles = [];
  const fixture = mkdtempSync(join(tmpdir(), "fast-esbuild-meta-"));
  try {
    writeFileSync(join(fixture, "a.js"), "import { b } from './b.js'; import './c.js'; console.log(b, import('./d.js'))");
    writeFileSync(join(fixture, "b.js"), "export const b = '" + "x".repeat(3000) + "'; export { c } from './c.js'");
    writeFileSync(join(fixture, "c.js"), "export const c = 'é'.repeat(2)");
    writeFileSync(join(fixture, "d.js"), "export default 1");
    writeFileSync(join(fixture, "e.js"), "import './c.js'; export const e = 1");
    for (const opts of [{}, { splitting: true, format: "esm" }, { minify: true, sourcemap: true }]) {
      const r = await ref.build({ entryPoints: [join(fixture, "a.js"), join(fixture, "e.js")], bundle: true, write: false, metafile: true, outdir: join(fixture, "out"), absWorkingDir: fixture, logLevel: "silent", ...opts });
      metafiles.push(r.metafile);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
  metafiles.push({ outputs: {} }, { inputs: {}, outputs: { "x.js": { bytes: 0, inputs: {} } } });
  metafiles.push({ outputs: { "big.js": { bytes: 5 * 1024 * 1024 * 1024 + 7, inputs: { "a.js": { bytesInOutput: 3 * 1024 * 1024 }, "b.js": { bytesInOutput: 1023 } } } } });
  metafiles.push({ outputs: { "a.js": { bytes: 10, inputs: { "x.js": { bytesInOutput: 5 }, "y.js": { bytesInOutput: 5 } }, entryPoint: "x.js" } }, inputs: { "x.js": { imports: [{ path: "y.js" }] }, "y.js": { imports: [] } } });
  for (const metafile of metafiles) {
    for (const v of [{}, { verbose: true }, { color: true }, { verbose: true, color: true }]) {
      const a = await ref.analyzeMetafile(metafile, v);
      const b = await fast.analyzeMetafile(metafile, v);
      tally(4, a === b ? "ok" : "ANALYZE-MISMATCH", JSON.stringify(metafile).slice(0, 100) + " " + JSON.stringify(v), a === b ? "" : "  esbuild-wasm: " + JSON.stringify(a) + "\n  fast:         " + JSON.stringify(b));
    }
  }
  for (const text of ["not json", "{}", "[1]", '{"outputs": 1}']) {
    const a = await ref.analyzeMetafile(text);
    const b = await fast.analyzeMetafile(text);
    tally(4, a === b ? "ok" : "ANALYZE-MISMATCH", text, "  " + JSON.stringify(a) + "\n  " + JSON.stringify(b));
  }

  fast.stop();
  ref.stop();
}

// ---------------------------------------------------------------------------
// 5. build() and context() with options that do not validate (contextImpl's
// validation messages, the service's error for a flag it rejects, the
// warnings every rebuild repeats) vs esbuild-wasm: the results, and what is
// printed (esbuild-wasm in a child process: its stderr)

// The printed messages (each starts with a line "✘ [ERROR]" or "▲ [WARNING]",
// possibly in color), sorted; the summary line stays last
function messageBlocks(text) {
  const blocks = [];
  let current = "";
  for (const line of text.split("\n")) {
    // (a message, or the summary line of the log, e.g. "10 warnings")
    if ((/^(\x1b\[[0-9;]*m)*[✘▲▶→●⬥] /.test(line) || /^(\x1b\[[0-9;]*m)*[0-9]+ (error|warning)/.test(line)) && current !== "") {
      blocks.push(current);
      current = "";
    }
    current += line + "\n";
  }
  blocks.push(current);
  // (the last message is followed by one more newline than the others)
  return JSON.stringify(blocks.map((b) => b.replace(/\n+$/, "")).sort());
}

// (the time a build took, in api.Build's summary)
function normalizeTime(text) {
  return text.replace(/Done in [0-9]+ms/g, "Done in <n>ms");
}

async function part5() {
  const STATS = Symbol.for("@r1ck404/fast-esbuild-wasm:stats");
  // (Go's wasm_exec.js uses globalThis.fs when it is set: the real file
  // system, which the engine's builds then use too)
  globalThis.fs = require("node:fs");
  const fast = (await import("../node.mjs")).default;
  await fast.initialize({});
  const dir = mkdtempSync(join(tmpdir(), "fast-esbuild-build-msg-"));
  try {
    writeFileSync(join(dir, "a.js"), "import './b.js'; export const a = process.env.NODE_ENV");
    writeFileSync(join(dir, "b.js"), "console.log('b')");
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    const cases = [
      { entryPoints: [a, b] },
      { entryPoints: [a], splitting: true, format: "esm" },
      { entryPoints: [a], outfile: join(dir, "o.js"), outdir: join(dir, "out") },
      { entryPoints: [a], sourcemap: "external" },
      { entryPoints: [a], legalComments: "external" },
      { entryPoints: [a], loader: { ".png": "file" } },
      { entryPoints: [a], loader: { ".png": "copy" }, bundle: true },
      { entryPoints: [a], loader: { png: "text" }, outdir: join(dir, "out") },
      { entryPoints: [a], external: ["x"] },
      { entryPoints: [a], alias: { x: "y" } },
      // (one error per map: Go iterates maps in random order)
      { entryPoints: [a], alias: { "./x": "y", "@z": "w" }, bundle: true },
      { entryPoints: [a], alias: { "@z": "" }, bundle: true },
      { entryPoints: [a], external: ["a*b*c"], bundle: true },
      { entryPoints: [a], splitting: true, outdir: join(dir, "out"), format: "cjs" },
      { entryPoints: [a], tsconfig: join(dir, "t.json"), tsconfigRaw: "{}" },
      { entryPoints: [a], resolveExtensions: ["js", ".ts."] },
      { entryPoints: [a], outExtension: { ".js": "mjs" }, outdir: join(dir, "out") },
      { entryPoints: [a], outExtension: { ".ts": ".mjs" }, outdir: join(dir, "out") },
      { entryPoints: [a], banner: { ts: "x" } },
      { entryPoints: [a], target: "foo" },
      { entryPoints: [a], absPaths: ["log", "bogus"] },
      { entryPoints: [a], loader: { ".js": "bogus" } },
      { stdin: { contents: "x", loader: "file" } },
      { stdin: { contents: "x", loader: "bogus" } },
      { entryPoints: [a], bundle: true, absPaths: ["log"], define: { x: "a b" } },
      { entryPoints: [a], target: "chrome" },
      { entryPoints: [a], target: "node1.2.3.4" },
      { entryPoints: [a], supported: { bogus: true } },
      { entryPoints: [a], define: { x: "a b" } },
      { entryPoints: [a], define: { "a-b": "1" } },
      { entryPoints: [a], pure: ["x["] },
      { entryPoints: [a], jsxFactory: "1" },
      { entryPoints: [a], globalName: "a-b", format: "iife" },
      { entryPoints: [a], keepNames: true, target: "es5" },
      { entryPoints: [a], metafile: true, mangleCache: { p: "q" }, outfile: join(dir, "o.js"), outdir: join(dir, "out") },
      { entryPoints: [a, b], sourcemap: "external", legalComments: "linked", external: ["y"], supported: { bogus: true }, keepNames: true, target: "es5" },
      // (a warning and a successful build)
      { entryPoints: [a], bundle: true, define: { "process.env.NODE_ENV": "production" } },
    ];
    // Messages of loading files: source map comments and data URLs that do
    // not decode
    const comments = ["data:application/json;base64,e30", "data:application/json;base64,e3=0", "data:application/json;base64,@@@@", "data:application/json;base64,e30=\nx", "data:application/json,%zz", "data:application/json,%é", "%zz.map", ":x.map", "a b:c", "http://a b/x.map", "http://a:b/x.map", "http://%41/x.map", "x.map#%zz", "https://example.com/x.map"];
    comments.forEach((c, i) => writeFileSync(join(dir, "sm" + i + ".js"), "export const x" + i + " = " + i + ";\n//# sourceMappingURL=" + c + "\n"));
    writeFileSync(join(dir, "sm.js"), comments.map((c, i) => "import './sm" + i + ".js';\n").join(""));
    cases.push({ entryPoints: [join(dir, "sm.js")], bundle: true, sourcemap: true, outdir: join(dir, "out") });
    for (const url of ["data:text/javascript;base64,@@", "data:text/javascript,%zz", "data:text/javascript;base64,eA", "data:text/javascript,x%2"]) {
      const name = "du" + cases.length + ".js";
      writeFileSync(join(dir, name), "import " + JSON.stringify(url) + ";");
      cases.push({ entryPoints: [join(dir, name)], bundle: true });
    }
    // Plugins (as source text: evaluated in both processes). (An exception
    // thrown by a plugin is reported with a location from its stack trace,
    // which differs between the two processes.)
    const plugins = [
      "({ name: 'p', setup(b) { b.onLoad({ filter: /b[.]js$/ }, () => ({ contents: 'x', loader: 'bogus' })) } })",
      "({ name: 'p', setup(b) { b.onResolve({ filter: /^[.][/]b/ }, (a) => ({ path: a.resolveDir + '/b.js', suffix: 'bad' })) } })",
      "({ name: 'p', setup(b) { b.onResolve({ filter: /^[.][/]b/ }, () => ({ namespace: 'ns' })) } })",
      "({ name: 'p', setup(b) { b.onLoad({ filter: /b[.]js$/ }, () => ({ contents: 'x', errors: [{ text: 'e', location: { line: -1, column: 3, length: -2, lineText: 'abc' } }], warnings: [{ text: 'w', detail: 1, notes: [{ text: 'n', location: { file: 'f', line: 2 } }] }] })) } })",
      "({ name: 'p', setup(b) { b.onLoad({ filter: /b[.]js$/ }, () => ({ contents: 'x', loader: 'file' })) } })",
    ];
    for (const p of plugins) cases.push({ entryPoints: [a], bundle: true, __plugin: p });
    const variants = [{ logLevel: "silent" }, { logLevel: "warning" }, { logLevel: "error" }, { logLevel: "warning", logLimit: 1 }, { logLevel: "warning", logOverride: { "suspicious-define": "error" } }, { logLevel: "warning", color: true }];
    const all = [];
    for (const c of cases) for (const v of variants) for (const isContext of [false, true]) all.push([{ write: false, absWorkingDir: dir, ...c, ...v }, isContext]);
    // (the "info" level: a build prints the summary of api.Build, with the
    // time the build took, which is normalized below)
    for (const c of cases) for (const isContext of [false, true]) all.push([{ write: false, absWorkingDir: dir, ...c, logLevel: "info" }, isContext]);

    // esbuild-wasm (Go) in a child process
    const input = join(dir, "cases.json");
    writeFileSync(input, JSON.stringify(all));
    const script = join(dir, "ref.cjs");
    writeFileSync(
      script,
      `const esbuild = require(${JSON.stringify(require.resolve("esbuild-wasm"))});
const cases = JSON.parse(require("fs").readFileSync(${JSON.stringify(input)}, "utf8"));
const shape = (r) => ({ errors: r.errors, warnings: r.warnings, outputFiles: r.outputFiles && r.outputFiles.map((f) => [f.path, f.text]), metafile: r.metafile, mangleCache: r.mangleCache });
(async () => {
  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const [options, isContext] = cases[i];
    if (options.__plugin) {
      options.plugins = [eval(options.__plugin)];
      delete options.__plugin;
    }
    process.stderr.write("\\u0000CASE " + i + "\\u0000");
    try {
      if (isContext) {
        const ctx = await esbuild.context(options);
        const r = await ctx.rebuild();
        const r2 = await ctx.rebuild();
        await ctx.dispose();
        results.push({ ok: [shape(r), shape(r2)] });
      } else {
        results.push({ ok: shape(await esbuild.build(options)) });
      }
    } catch (e) {
      results.push({ threw: { message: e.message, errors: e.errors, warnings: e.warnings } });
    }
  }
  process.stderr.write("\\u0000CASE end\\u0000");
  require("fs").writeFileSync(${JSON.stringify(join(dir, "ref.json"))}, JSON.stringify(results));
  esbuild.stop();
})();
`,
    );
    const r = spawnSync(process.execPath, [script], { encoding: "utf8", maxBuffer: 1 << 28 });
    const refResults = JSON.parse(readFileSync(join(dir, "ref.json"), "utf8"));
    const refOut = new Map();
    for (const chunk of r.stderr.split("\u0000CASE ").slice(1)) {
      const end = chunk.indexOf("\u0000");
      refOut.set(chunk.slice(0, end), chunk.slice(end + 1));
    }

    const shape = (r) => ({ errors: r.errors, warnings: r.warnings, outputFiles: r.outputFiles && r.outputFiles.map((f) => [f.path, f.text]), metafile: r.metafile, mangleCache: r.mangleCache });
    const log = console.log;
    let printed = "";
    for (let i = 0; i < all.length; i++) {
      const [options, isContext] = all[i];
      const pluginSource = options.__plugin;
      if (pluginSource) {
        options.plugins = [eval(pluginSource)];
        delete options.__plugin;
      }
      printed = "";
      console.log = (text) => (printed += text + "\n");
      let result;
      try {
        if (isContext) {
          const ctx = await fast.context(options);
          const r = await ctx.rebuild();
          const r2 = await ctx.rebuild();
          await ctx.dispose();
          result = { ok: [shape(r), shape(r2)] };
        } else {
          result = { ok: shape(await fast.build(options)) };
        }
      } catch (e) {
        result = { threw: { message: e.message, errors: e.errors, warnings: e.warnings } };
      } finally {
        console.log = log;
      }
      const what = JSON.stringify(options).replaceAll(dir.replaceAll("\\", "\\\\"), "<dir>") + (isContext ? " (context)" : "");
      const a = JSON.stringify(refResults[i]);
      const b = JSON.parse(JSON.stringify(result));
      if (a !== JSON.stringify(b)) tally(5, "BUILD-MISMATCH", what, "  esbuild-wasm: " + a.slice(0, 1500) + "\n  fast:         " + JSON.stringify(b).slice(0, 1500));
      else if (normalizeTime(refOut.get(String(i)) ?? "") !== normalizeTime(printed)) {
        // (Go parses the files of a build in parallel goroutines: the order in
        // which messages of different files are printed depends on its
        // scheduling. The printed messages must be the same, in any order.)
        if (messageBlocks(normalizeTime(refOut.get(String(i)) ?? "")) === messageBlocks(normalizeTime(printed))) tally(5, "okReordered");
        else tally(5, "CONSOLE-MISMATCH", what, "  esbuild-wasm: " + JSON.stringify(refOut.get(String(i))) + "\n  fast:         " + JSON.stringify(printed));
      } else tally(5, printed !== "" ? "okPrinted" : "ok");
    }
    return all.length;
  } finally {
    rmSync(dir, { recursive: true, force: true });
    fast.stop();
  }
}

// ---------------------------------------------------------------------------

const t0 = performance.now();
if (shard === null && !args.includes("--part") && jobsOf(args) > 1) {
  const sums = addUp(await runShards(fileURLToPath(import.meta.url), args, 5));
  console.log(`messages: ${SNIPPET_SETS.length} snippets x ${LOG_VARIANTS.length} log settings, ${sums.goInputs} inputs of esbuild's tests, ${sums.mutations} mutated files, ${sums.builds} builds (${((performance.now() - t0) / 1000).toFixed(1)}s in 5 processes)`);
  console.log(Object.keys(sums.counts).sort((a, b) => Number(a.split(" ")[0]) - Number(b.split(" ")[0])).map((k) => `${k} ${sums.counts[k]}`).join(", "));
  if (Object.keys(sums.bailReasons).length > 0) {
    console.log("bail reasons:");
    for (const [k, n] of Object.entries(sums.bailReasons).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(String(n).padStart(7) + "  " + k);
  }
  console.log(sums.failures === 0 ? "messages: all identical" : `messages: ${sums.failures} failures`);
  process.exit(sums.failures === 0 ? 0 : 1);
}
if (parts.has(1)) part1();
let goInputs = 0;
if (parts.has(2)) goInputs = part2();
let mutations = 0;
if (parts.has(3)) mutations = part3();
if (parts.has(4)) await part4();
let builds = 0;
if (parts.has(5)) builds = await part5();
if (shard !== null) {
  printSummary({ counts, failures, goInputs, mutations, builds, bailReasons: Object.fromEntries(bailReasons) });
  process.exit(0);
}
console.log(`messages: ${SNIPPET_SETS.length} snippets x ${LOG_VARIANTS.length} log settings, ${goInputs} inputs of esbuild's tests, ${mutations} mutated files, ${builds} builds (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "));
if (bailReasons.size > 0) {
  console.log("bail reasons:");
  for (const [k, n] of [...bailReasons].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(String(n).padStart(7) + "  " + k + "\n           e.g. " + bailExamples.get(k));
}
console.log(failures === 0 ? "messages: all identical" : `messages: ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
