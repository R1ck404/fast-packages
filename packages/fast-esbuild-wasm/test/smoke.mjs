// Small targeted cases: fast transform vs native esbuild, printing full
// outputs on mismatch. usage: node test/smoke.mjs [--only name] [--opts name] [--verbose]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const { fastTransform, stats } = await import("../src/transform.mjs");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const onlyOpts = args.includes("--opts") ? args[args.indexOf("--opts") + 1].split(",") : null;
const verbose = args.includes("--verbose");

const importMetaDefine = {
  "import.meta.url": "import_meta.url",
  "import.meta.dirname": "import_meta.dirname",
  "import.meta.filename": "import_meta.filename",
  "import.meta": "import_meta",
};
const JS_OPTS = [
  ["js", { loader: "js" }],
  ["cjs", { loader: "js", format: "cjs", target: "esnext", platform: "neutral", define: importMetaDefine }],
  ["esm", { loader: "js", format: "esm" }],
  ["iife", { loader: "js", format: "iife" }],
];
const TS_OPTS = [
  ["ts", { loader: "ts" }],
  ["ts-cjs", { loader: "ts", format: "cjs", target: "esnext", platform: "neutral", define: importMetaDefine }],
];
const JSX_OPTS = [
  ["jsx", { loader: "jsx" }],
  ["jsx-auto", { loader: "jsx", jsx: "automatic" }],
  ["jsx-auto-cjs", { loader: "jsx", jsx: "automatic", format: "cjs" }],
  ["jsx-dev", { loader: "jsx", jsx: "automatic", jsxDev: true }],
  ["jsx-preserve", { loader: "jsx", jsx: "preserve" }],
];

const JS_CASES = {
  empty: "",
  let: "let a = 1",
  exportConst: "export const x = 1; import y from 'z'",
  fn: "function f(a, b = 2, ...c) { return a + b + c.length }",
  class: "class A extends B { #x = 1; static y; static { init() } constructor() { super(); } get z() { return this.#x } static #p() {} }",
  arrow: "const f = async (a) => { await a; }; const g = x => x * 2; const h = () => ({})",
  template: "const s = `a${b}c${`d${e}`}`; tag`x${1}\\n`; String.raw`\\u`",
  regex: "const r = /a[/]b/gi.test(s) ? 1 : 2; x = a / b / c",
  obj: "const o = { a, b: 2, [c]: 3, ...d, get e() { return 1 }, f() {}, 'g-h': 4, 5: 6, async *i() {} }",
  destructure: "const { a, b: [c, d = 1], ...e } = obj; [x, y] = [y, x]; ({ a: z } = q)",
  loops: "for (let i = 0; i < 10; i++) { if (i % 2) continue; } for (const k in o) {} for (const v of a) {} while (x) break; do {} while (0)",
  switch: "switch (x) { case 1: a(); break; case 2: case 3: { b() } default: c() }",
  try: "try { a() } catch (e) { b(e) } finally { c() } try {} catch {}",
  labels: "outer: for (;;) { inner: for (;;) { break outer } }",
  optional: "a?.b?.[c]?.(d) ?? e; x ||= 1; y &&= 2; z ??= 3",
  numbers: "x = [0, 1.5, 1e21, 0x10, 0b11, 0o17, 1_000_000, .5, 5., 123n, 1e-7, 0.1 + 0.2, 1/0, -0, 2**53, 1e300 * 10]",
  strings: "x = ['a', \"b\", 'it\\'s', \"\\u00e9\", '\\n\\t', \"a\\\"b\", '\\x41', '\\0', `\\``]",
  comments: "/*! legal */\n// normal\nconst a = /* @__PURE__ */ f(); /** doc */ function g() {}\n//! another legal\n/* @license MIT */",
  importExport:
    "import a, { b as c } from 'd'; import * as ns from 'e'; export { a, c as f }; export * from 'g'; export * as h from 'i'; export default function j() {} console.log(ns.k)",
  dynamicImport: "const m = await import('x'); require('y'); import('z').then(q => q)",
  importMeta: "console.log(import.meta.url, import.meta)",
  directives: "'use strict'; 'use client'; a()",
  hashbang: "#!/usr/bin/env node\nconsole.log(1)",
  constFold: "if (false) { a() } else { b() } x = 1 + 2; y = 'a' + 'b'; z = typeof x === 'undefined'; if (1) c(); w = !0; v = void 0",
  generators: "function* g() { yield 1; yield* h() } async function* ag() { for await (const x of y) {} }",
  new: "new Foo; new Foo(); new (a.b)(); new a.b.c(); new (f())(); new new A()()",
  seq: "a = (b, c); (d, e)(); (0, f.g)()",
  inFor: "for (var x = ('a' in b); x;) {}",
  exportDefaultExpr: "export default 1 + 2",
  exportDefaultClass: "export default class {}",
  exportVar: "export var a = 1, b = 2; export let c; export function d() {} export class E {}",
  cjsStyle: "module.exports = { a: 1 }; exports.b = 2; require('c')",
  thisTop: "console.log(this); function f() { return this }",
  getterSetter: "class A { get x() { return 1 } set x(v) {} static get y() {} }",
  unicode: "const caf\\u00e9 = 1; const \\u{1F600}x = 2;".replace(/\\u\{1F600\}/, ""),
  nonAscii: "const s = 'caf\u00e9 \u{1F600}'; const t = `\u2028`;",
  asyncArrowCall: "async () => {}; async function f() { await Promise.all([a, b]) }",
  deleteTypeof: "delete a.b; typeof c; void 0; !d; -e; +f; ~g",
  precedence: "a = b ? c : d ? e : f; x = (a, b) ? c : d; y = a ** -b; z = (-a) ** b; w = a in b; v = !(a instanceof B)",
  keywordsAsProps: "a.class; a.default; ({ if: 1, new: 2 }); class K { static() {} get() {} set() {} }",
  emptyStmts: ";;; if (a); else;",
  withStmt: "with (a) { b }",
  evalCall: "eval('x'); (0, eval)('y')",
  arguments: "function f() { return arguments.length }",
  shadowing: "let a = 1; { let a = 2; { const a = 3 } } function g(a) { var a; }",
  varHoist: "a = 1; var a; function b() { c = 2; var c } b()",
  bigObject: "export const o = { a: [1, 2, { b: [3, { c: 4 }] }], d: function () { return { e: 5 } } }",
  asi: "a\n++b\nc\n(d)\nreturn_ = 1\nlet x = 1\n[1, 2].forEach(f)",
  classExpr: "const A = class B { m() { return B } }; export const C = class {}",
  privateIn: "class A { #x; static has(o) { return #x in o } }",
  accessor: "class A { accessor x = 1; static accessor y }",
  decorators: "@dec class A { @dec m() {} @dec x = 1 }",
  using: "{ using a = b(); await using c = d(); }",
  newTarget: "function F() { if (!new.target) throw 1 }",
  superProp: "class A extends B { m() { return super.m() + super['n'] } }",
  regexFlags: "x = /a/dgimsuyv; y = /[\\]/]/",
  htmlComment: "x = 1 <!-- foo\n-->bar",
  closingScript: String.raw`/*! a </script> b */
x = '</script>'; y = /<\/script/; z = tag${"`"}</script>${"`"}; w = a </script/i; v = ${"`"}</SCRIPT ${"${1}"}${"`"}`,
};

const TS_CASES = {
  types: "let a: number = 1; function f(x: string, y?: number): void {} type T = { a: string }; interface I { m(): void }",
  enum: "enum C { X, Y = 2, Z } const enum D { A = 'a', B = A + 'b' } export enum E { F = 1 << 2 } console.log(C.X, D.B)",
  namespace: "namespace N { export const a = 1; export function f() { return a } } namespace N.M { export let b = 2 } declare namespace Q { let c: number }",
  paramProps: "class D extends B { constructor(private x: number, public readonly y = 2) { super(); } }",
  casts: "let v = <any>w; const e = f as g; const s = h satisfies J; k!.l; m!();",
  typeImports: "import type { U } from 'u'; import { type V, W } from 'v'; export type { T } from 't'; import X from 'x'; console.log(W)",
  unusedImports: "import a from 'a'; import { b } from 'b'; import * as c from 'c'; import 'd';",
  abstract: "abstract class Z { abstract m(): void; protected n?: string; declare o: number; p!: number }",
  generics: "function id<T extends object = {}>(x: T): T { return x } const g = id<string>('a'); class K<T> implements I<T> {}",
  overloads: "function f(a: string): string; function f(a: number): number; function f(a: any) { return a }",
  declare: "declare const a: number; declare function b(): void; declare class C {} declare module 'm' { export const x: number } declare global { interface Window { y: 1 } }",
  exportEquals: "export = foo; import bar = require('bar'); import baz = N.M",
  fieldsInit: "class A { a = 1; b: number; static c = 2; ['d'] = 3; }",
  arrowGeneric: "const f = <T,>(x: T) => x; const g = async <T>(x: T): Promise<T> => x",
  optionalParams: "function f(this: Window, a?: number, ...b: string[]) {}",
  indexSig: "interface I { [k: string]: number } type M = { [K in keyof T]?: T[K] }",
  tsEnumReverse: "enum E { A = 1, B = A * 2, C = 'x'.length }",
};

const JSX_CASES = {
  basic: "const a = <div className='x' id={y}>hello {name}<br/></div>",
  fragment: "const b = <><A /><B.C d='e' {...f} /></>",
  entities: "const c = <p>&nbsp;&amp; &lt;tag&gt; &#123; &#x41;</p>",
  whitespace: "const d = <div>\n  line one\n  line two  \n  {x}\n</div>",
  namespaced: "const e = <svg:rect xlink:href='#a' />",
  keyAfterSpread: "const f = <div {...p} key='k' />",
  pragma: "/** @jsx h */\nconst g = <div />",
};

// Source map cases (non-ASCII text is built at run time so this file stays ASCII)
const E9 = String.fromCharCode(0xe9); // e-acute (BMP, 2 UTF-8 bytes)
const CJK = String.fromCharCode(0x4e2d, 0x6587); // 3 UTF-8 bytes each
const SMILE = String.fromCodePoint(0x1f600); // astral: 2 UTF-16 code units
const MATH_A = String.fromCodePoint(0x1d400); // astral identifier start
const LS = String.fromCharCode(0x2028); // line separator
const SM_JS_CASES = {
  smEmpty: "",
  smCommentOnly: "// just a comment\n",
  smLegalOnly: "/*! legal */\n",
  smBasic: "export const a = 1;\nfunction foo(x, y) {\n  return x + y;\n}\nconsole.log(foo(a, 2));\n",
  smNonAscii: `const caf${E9} = "${E9}t${E9} ${CJK}"; /* ${CJK} */ function f(${E9}) { return ${E9} + caf${E9} }\nlet ${CJK} = f(1), b = "${CJK}${E9}"; console.log(${CJK}, b)\n`,
  smAstral: `const s = "${SMILE}${SMILE}x"; let ${MATH_A} = s.length; const t = \`${SMILE}\${s}${SMILE}\`;\nconsole.log(${MATH_A}, t, "${SMILE}".length) // ${SMILE}\nfoo(${MATH_A})\n`,
  smCRLF: "let a = 1;\r\nfunction f() {\r\n  return a\r\n}\r\n\r\nf();\ra();\r\n/* multi\r\n line */ b()\r\n",
  smLineSep: `a();${LS}b(); const x = 1${LS}+ 2;\nc(x)\n`,
  smTemplate: "const t = `line1\n  line2 ${a +\n b}\n line3 ${`nested\n${c}`}`;\nconsole.log(t, tag`x\n${y}\n`, `\r\n`)\n",
  smNames: "import { a as b } from 'x'; import * as ns from 'y';\nexport const c = b + ns.z;\nfunction d() { let b = 1; { let b = 2; return b } }\nexport default class { m() { return c } }\nexport { d as e }\n",
  smHashbang: "#!/usr/bin/env node\n'use strict';\n'use client'\nconst x = require('fs');\nmodule.exports = x;\n",
  smClass: "class A extends B {\n  #p = 1;\n  static s = 2;\n  constructor() { super(); this.q = { a, b: [1, 2], ...c } }\n  get g() { return this.#p }\n  static { init() }\n}\nnew A()\n",
  smDestructure: "const { a, b: [c, d = 1], ...e } = obj;\n[x, y] = [y, x];\nfor (const [k, v] of Object.entries(o)) { if (k) continue; else break }\n",
  smControl: "label: for (let i = 0; i < 10; i++) {\n  switch (i) {\n    case 1: break label;\n    default: continue label;\n  }\n}\ntry { a() } catch (e) { b(e) } finally { c() }\ndo x++; while (x < 5)\n",
  smLongLine: "x = [" + Array.from({ length: 300 }, (_, i) => `f${i % 7}(${i})`).join(", ") + "];\n",
  smRequire: "const a = require('a'), b = import('b'), c = require.resolve('c');\nexport * from 'd'; export * as e from 'e'; export { f } from 'f'\n",
  // "//# sourceMappingURL=" comments: relative and https URLs are ignored by a
  // transform; a data URL would be loaded as an input source map (bails)
  smMapCommentRelative: "export const a = 1;\n//# sourceMappingURL=index.js.map\n",
  smMapCommentHttps: "a()\n//@ sourceMappingURL=https://cdn.example.com/x/a.js.map",
  smMapCommentData: "a()\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImEuanMiXSwibWFwcGluZ3MiOiJBQUFBIn0=\n",
  smLegalEof: "/*! legal one */\nexport function f() {\n  //! legal two\n  return 1\n}\n",
};
const SM_TS_CASES = {
  smTs: "enum C { X, Y = 2 }\nnamespace N { export const a: number = 1 }\nclass D { constructor(private x: number, public y = 2) {} m<T>(a: T): T { return a } }\nlet v = <any>w as string;\nexport type T = { a: string };\nconsole.log(C.X, N.a, new D(1))\n",
  smTsNonAscii: `interface ${CJK} { a: string }\nconst x: ${CJK} = { a: "${SMILE}" };\r\nfunction g(this: Window, a?: number): void { console.log(a, x) }\n`,
};
const SM_JSX_CASES = {
  smJsx: "const a = <div className='x' id={y}>\n  hello {name}\n  <br/>\n  <A.B c=\"d\" {...e} />\n</div>;\nconst b = <>\n  <C />text\n</>\n",
  smJsxNonAscii: `const a = <p title="${E9}${SMILE}">${CJK} ${SMILE}\n  {x} &amp; ${E9}</p>\n`,
};
const smOpts = (loader) => [
  ["map-ext", { loader, sourcemap: "external", sourcefile: "input." + loader }],
  ["map-inline", { loader, sourcemap: "inline" }],
  ["map-both-utf8", { loader, sourcemap: "both", charset: "utf8", sourcefile: `d${E9}r/${CJK}.${loader}` }],
  ["map-cjs", { loader, format: "cjs", sourcemap: true, sourceRoot: "/r" + E9 + "/" }],
  ["map-esm-nocontent", { loader, format: "esm", sourcemap: "external", sourcesContent: false }],
  ["map-iife", { loader, format: "iife", globalName: "G", sourcemap: "both", banner: "/* b */\n// c", footer: "/* f */" }],
];

// Mirror of the glue's flagsForTransformOptions (option order matters)
function flagsFor(o) {
  const flags = ["--log-level=silent", "--log-limit=0"];
  if (o.legalComments) flags.push(`--legal-comments=${o.legalComments}`);
  if (o.sourceRoot !== undefined) flags.push(`--source-root=${o.sourceRoot}`);
  if (o.sourcesContent !== undefined) flags.push(`--sources-content=${o.sourcesContent}`);
  if (o.target) flags.push(`--target=${o.target}`);
  if (o.format) flags.push(`--format=${o.format}`);
  if (o.globalName) flags.push(`--global-name=${o.globalName}`);
  if (o.platform) flags.push(`--platform=${o.platform}`);
  if (o.tsconfigRaw) flags.push(`--tsconfig-raw=${typeof o.tsconfigRaw === "string" ? o.tsconfigRaw : JSON.stringify(o.tsconfigRaw)}`);
  if (o.charset) flags.push(`--charset=${o.charset}`);
  if (o.jsx) flags.push(`--jsx=${o.jsx}`);
  if (o.jsxDev) flags.push(`--jsx-dev`);
  if (o.define) for (const key in o.define) flags.push(`--define:${key}=${o.define[key]}`);
  if (o.sourcemap) flags.push(`--sourcemap=${o.sourcemap === true ? "external" : o.sourcemap}`);
  if (o.sourcefile) flags.push(`--sourcefile=${o.sourcefile}`);
  if (o.loader) flags.push(`--loader=${o.loader}`);
  if (o.banner) flags.push(`--banner=${o.banner}`);
  if (o.footer) flags.push(`--footer=${o.footer}`);
  return flags;
}

let ok = 0,
  bad = 0,
  bail = 0;
function run(cases, optSets) {
  for (const [name, code] of Object.entries(cases)) {
    if (only && name !== only) continue;
    for (const [optName, opts] of optSets) {
      if (onlyOpts && !onlyOpts.includes(optName)) continue;
      let ref = null;
      let refErr = null;
      try {
        ref = esbuild.transformSync(code, opts);
      } catch (e) {
        refErr = e.message.split("\n").slice(0, 2).join(" ");
      }
      const errBefore = stats.error;
      const fast = fastTransform(flagsFor(opts), code, undefined);
      if (stats.error !== errBefore) {
        bad++;
        console.log(`CRASH ${name} [${optName}]: ${String(stats.lastError?.stack).split("\n").slice(0, 8).join("\n    ")}`);
      } else if (fast === undefined) {
        bail++;
        if (verbose || !refErr) console.log(`bail  ${name} [${optName}]${refErr ? " (esbuild errors too)" : ""}`);
      } else if (ref === null) {
        bad++;
        console.log(`FALSE-ACCEPT ${name} [${optName}]: esbuild says ${refErr}`);
      } else if (ref.warnings.length) {
        bad++;
        console.log(`WARN-ACCEPT ${name} [${optName}]: ${ref.warnings[0].text}`);
      } else if (ref.code !== fast.code) {
        bad++;
        console.log(`MISMATCH ${name} [${optName}]\n--- esbuild ---\n${ref.code}--- fast ---\n${fast.code}---`);
      } else if (ref.map !== fast.map) {
        bad++;
        console.log(`MISMATCH (map) ${name} [${optName}]\n--- esbuild ---\n${ref.map}--- fast ---\n${fast.map}---`);
      } else {
        ok++;
        if (verbose) console.log(`ok    ${name} [${optName}]`);
      }
    }
  }
}
run(JS_CASES, JS_OPTS);
run(TS_CASES, TS_OPTS);
run(JSX_CASES, JSX_OPTS);
run(SM_JS_CASES, [
  ...smOpts("js"),
  ["map-legal-eof", { loader: "js", legalComments: "eof", sourcemap: "both", sourcefile: 'C:\\dir\\"q".js' }],
  ["map-file-url", { loader: "js", sourcemap: "external", sourcefile: "file:///a/b.js" }],
]);
run(SM_TS_CASES, smOpts("ts"));
run(SM_JSX_CASES, [...smOpts("jsx"), ["map-jsx-auto", { loader: "jsx", jsx: "automatic", jsxDev: true, sourcemap: "external" }]]);
run({ ...SM_JSX_CASES, ...SM_TS_CASES }, smOpts("tsx"));

// "tsconfigRaw" cases: [name, code, options, expected]. "ok" means the fast
// path must accept and match esbuild; "bail" means esbuild reports an error or
// a warning (checked below), so the fast path must decline.
const BS = String.fromCharCode(92); // backslash (keeps escapes out of this file)
const tc = (compilerOptions) => ({ compilerOptions });
const CLASS_SRC =
  "class A extends B { constructor(private x: number, public readonly y = 2, protected z?: string) { super(); } a = 1; b: number; declare c: string; d!: number; static e = 2; static f; ['g'] = 3; #h = 4; static { init() } }\n" +
  "class C { x = this.y; constructor(public y: number) {} }\nexport class D { declare readonly e: number; f?: string; static g: number }";
const DECORATOR_SRC =
  "@dec class A { @prop x = 1; @prop() static y: string; @method m(@param a, @param() b: number) {} @get get g() { return 1 } constructor(@inject(T) private t: T) {} }\n" +
  "@a @b.c(1) class D { @d ['computed']() {} @e static s() {} }\nfunction f() { @g class E { @h x } return E }";
const IMPORTS_SRC =
  "import { a, type b } from 'a'; import c from 'c'; import * as d from 'd'; import type e from 'e'; import {} from 'f'; import g, { h } from 'g'; import 'i';\n" +
  "export { j } from 'j'; export type { k } from 'k'; let l: b = h; console.log(l)";
const JSX_SRC = "const a = <div a='1' {...p}>{b}<>x</><A.B key='k' /></div>";
const TSCONFIG_CASES = [
  // class fields
  ["useDefine-false", CLASS_SRC, { loader: "ts", tsconfigRaw: tc({ useDefineForClassFields: false }) }, "ok"],
  ["target-es2019", CLASS_SRC, { loader: "ts", tsconfigRaw: tc({ target: "es2019" }) }, "ok"],
  ["target-ES2022", CLASS_SRC, { loader: "ts", tsconfigRaw: tc({ target: "ES2022" }) }, "ok"],
  ["target-es2019-define", CLASS_SRC, { loader: "ts", tsconfigRaw: tc({ target: "ES2019", useDefineForClassFields: true }) }, "ok"],
  ["useDefine-false-cjs", CLASS_SRC, { loader: "ts", format: "cjs", tsconfigRaw: tc({ useDefineForClassFields: false }) }, "ok"],
  ["useDefine-false-js", "class A { a = 1; static b = 2 }", { loader: "js", tsconfigRaw: tc({ useDefineForClassFields: false }) }, "ok"],
  // experimental decorators
  ["decorators", DECORATOR_SRC, { loader: "ts", tsconfigRaw: tc({ experimentalDecorators: true }) }, "ok"],
  ["decorators-assign", DECORATOR_SRC, { loader: "ts", tsconfigRaw: tc({ experimentalDecorators: true, useDefineForClassFields: false }) }, "ok"],
  ["decorators-export", "export @dec class B { @p x = 1 }\nexport default @dec() class { constructor(@i a) {} }", { loader: "ts", tsconfigRaw: tc({ experimentalDecorators: true }) }, "ok"],
  ["decorators-esm", DECORATOR_SRC, { loader: "ts", format: "esm", tsconfigRaw: tc({ experimentalDecorators: true }) }, "ok"],
  ["decorators-tsx", "@dec class A { @m render() { return <div /> } }", { loader: "tsx", tsconfigRaw: tc({ experimentalDecorators: true }) }, "ok"],
  ["decorators-off", "@dec class A { @m x = 1 }", { loader: "ts", tsconfigRaw: tc({ experimentalDecorators: false }) }, "ok"],
  // JSX settings
  ["jsx-react-jsx", JSX_SRC, { loader: "tsx", tsconfigRaw: tc({ jsx: "react-jsx" }) }, "ok"],
  ["jsx-react-jsxdev", JSX_SRC, { loader: "tsx", tsconfigRaw: tc({ jsx: "react-jsxdev" }) }, "ok"],
  ["jsx-react-overrides", JSX_SRC, { loader: "tsx", jsx: "automatic", jsxDev: true, tsconfigRaw: tc({ jsx: "react" }) }, "ok"],
  ["jsx-factory", JSX_SRC, { loader: "tsx", tsconfigRaw: tc({ jsxFactory: "h", jsxFragmentFactory: "Fragment" }) }, "ok"],
  ["jsx-factory-dotted", JSX_SRC, { loader: "jsx", tsconfigRaw: tc({ jsxFactory: "preact.h", jsxFragmentFactory: "preact.Fragment" }) }, "ok"],
  ["jsx-factory-this", JSX_SRC, { loader: "jsx", tsconfigRaw: tc({ jsxFactory: "this.h" }) }, "ok"],
  ["jsx-factory-empty", JSX_SRC, { loader: "jsx", tsconfigRaw: tc({ jsxFactory: "", jsxFragmentFactory: "" }) }, "ok"],
  ["jsx-preserve-ignored", JSX_SRC, { loader: "tsx", tsconfigRaw: tc({ jsx: "preserve" }) }, "ok"],
  ["jsx-react-native", JSX_SRC, { loader: "tsx", tsconfigRaw: tc({ jsx: "react-native" }) }, "ok"],
  ["jsx-uppercase", JSX_SRC, { loader: "tsx", format: "cjs", tsconfigRaw: tc({ jsx: "React-JSX", jsxImportSource: "solid-js/h" }) }, "ok"],
  ["jsx-unknown-value", JSX_SRC, { loader: "tsx", tsconfigRaw: tc({ jsx: "react-jsx2" }) }, "ok"],
  ["jsx-import-escape", JSX_SRC, { loader: "jsx", tsconfigRaw: '{"compilerOptions":{"jsx":"react-jsx","jsxImportSource":"' + BS + 'u0070react"}}' }, "ok"],
  ["jsx-pragma-wins", "/** @jsxImportSource foo */\n" + JSX_SRC, { loader: "tsx", tsconfigRaw: tc({ jsx: "react-jsx", jsxImportSource: "preact" }) }, "ok"],
  ["jsx-factory-pragma", "/** @jsx q */\n" + JSX_SRC, { loader: "tsx", tsconfigRaw: tc({ jsxFactory: "h" }) }, "ok"],
  ["jsx-ts-loader", "let a = 1", { loader: "ts", tsconfigRaw: tc({ jsx: "react-jsx" }) }, "ok"],
  // unused imports
  ["verbatim", IMPORTS_SRC, { loader: "ts", tsconfigRaw: tc({ verbatimModuleSyntax: true }) }, "ok"],
  ["verbatim-false", IMPORTS_SRC, { loader: "ts", tsconfigRaw: tc({ verbatimModuleSyntax: false }) }, "ok"],
  ["verbatim-cjs", IMPORTS_SRC, { loader: "ts", format: "cjs", tsconfigRaw: tc({ verbatimModuleSyntax: true }) }, "ok"],
  ["preserveValueImports", IMPORTS_SRC, { loader: "ts", tsconfigRaw: tc({ preserveValueImports: true }) }, "ok"],
  ["importsNotUsed-preserve", IMPORTS_SRC, { loader: "ts", tsconfigRaw: tc({ importsNotUsedAsValues: "preserve" }) }, "ok"],
  ["importsNotUsed-error", IMPORTS_SRC, { loader: "ts", tsconfigRaw: tc({ importsNotUsedAsValues: "error" }) }, "ok"],
  ["importsNotUsed-remove", IMPORTS_SRC, { loader: "ts", tsconfigRaw: tc({ importsNotUsedAsValues: "remove" }) }, "ok"],
  ["pvi-and-inuav", IMPORTS_SRC, { loader: "ts", tsconfigRaw: tc({ preserveValueImports: true, importsNotUsedAsValues: "error" }) }, "ok"],
  // strict mode
  ["alwaysStrict", "x = 1; function f() { return this }", { loader: "ts", tsconfigRaw: tc({ alwaysStrict: true }) }, "ok"],
  ["alwaysStrict-directive", "'use strict'; x()", { loader: "ts", tsconfigRaw: tc({ alwaysStrict: true }) }, "ok"],
  ["alwaysStrict-over-strict", "x = 1", { loader: "ts", tsconfigRaw: tc({ strict: true, alwaysStrict: false }) }, "ok"],
  ["strict-js-cjs", "exports.a = 1; function f() {}", { loader: "js", format: "cjs", tsconfigRaw: tc({ strict: true }) }, "ok"],
  ["strict-iife", "var a = 1", { loader: "js", format: "iife", tsconfigRaw: tc({ strict: true }) }, "ok"],
  ["strict-esm", "export let a = 1", { loader: "ts", format: "esm", tsconfigRaw: tc({ strict: true }) }, "ok"],
  ["strict-with", "with (a) b()", { loader: "js", tsconfigRaw: tc({ strict: true }) }, "bail"],
  ["strict-octal", "x = 010", { loader: "ts", tsconfigRaw: tc({ alwaysStrict: true }) }, "bail"],
  // JSON flavor and ignored fields
  ["jsonc", CLASS_SRC, { loader: "ts", tsconfigRaw: '// line\n{ /* block */ "compilerOptions": { "useDefineForClassFields": false, }, // trailing\n}' }, "ok"],
  ["empty-object", CLASS_SRC, { loader: "ts", tsconfigRaw: "{}" }, "ok"],
  ["array-top", CLASS_SRC, { loader: "ts", tsconfigRaw: "[1, 2,]" }, "ok"],
  ["numbers", "x()", { loader: "ts", tsconfigRaw: '{"a": 0x10, "b": -1.5e3, "c": .5, "d": 1_000, "e": null, "f": [true, false]}' }, "ok"],
  ["extends-ignored", CLASS_SRC, { loader: "ts", tsconfigRaw: { extends: "./missing.json", compilerOptions: { useDefineForClassFields: false } } }, "ok"],
  ["extends-array", "x()", { loader: "ts", tsconfigRaw: { extends: ["a", "@b/c", 1] } }, "ok"],
  ["compilerOptions-null", "x()", { loader: "ts", tsconfigRaw: { compilerOptions: null } }, "ok"],
  ["wrong-types", CLASS_SRC, { loader: "ts", tsconfigRaw: tc({ experimentalDecorators: "true", target: 5, jsx: 1, strict: "yes", paths: [] }) }, "ok"],
  ["baseUrl-paths", "import a from '@/a'; a()", { loader: "ts", tsconfigRaw: tc({ baseUrl: ".", paths: { "@/*": ["src/*", 1], "x": ["y"] } }) }, "ok"],
  ["paths-relative", "x()", { loader: "ts", tsconfigRaw: tc({ paths: { "@/*": ["./src/*", "../x", ".", "..", "/abs/*", "c:/d/*"] } }) }, "ok"],
  ["paths-configDir", "x()", { loader: "ts", tsconfigRaw: tc({ paths: { "@/*": ["${configDir}/src/*"] } }) }, "ok"],
  ["unknown-options", "x()", { loader: "ts", tsconfigRaw: { compilerOptions: { module: "esnext", lib: ["dom"], emitDecoratorMetadata: true }, include: ["src"] } }, "ok"],
  // invalid values and syntax: esbuild warns or errors
  ["bad-target", "x()", { loader: "ts", tsconfigRaw: tc({ target: "es2099" }) }, "bail"],
  ["bad-importsNotUsed", "x()", { loader: "ts", tsconfigRaw: tc({ importsNotUsedAsValues: "bogus" }) }, "bail"],
  ["bad-jsxFactory", JSX_SRC, { loader: "jsx", tsconfigRaw: tc({ jsxFactory: "h()" }) }, "bail"],
  ["bad-jsxFragment", JSX_SRC, { loader: "jsx", tsconfigRaw: tc({ jsxFragmentFactory: "a..b" }) }, "bail"],
  ["top-level-option", "x()", { loader: "ts", tsconfigRaw: { jsx: "react-jsx" } }, "bail"],
  ["duplicate-key", "x()", { loader: "ts", tsconfigRaw: '{"compilerOptions": {"strict": true, "strict": false}}' }, "bail"],
  ["single-quotes", "x()", { loader: "ts", tsconfigRaw: "{'compilerOptions': {}}" }, "bail"],
  ["syntax-error", "x()", { loader: "ts", tsconfigRaw: "{" }, "bail"],
  ["trailing-garbage", "x()", { loader: "ts", tsconfigRaw: "{} x" }, "bail"],
  ["unterminated-comment", "x()", { loader: "ts", tsconfigRaw: "{} /*" }, "bail"],
  ["bigint", "x()", { loader: "ts", tsconfigRaw: '{"a": 1n}' }, "bail"],
  ["identifier-value", "x()", { loader: "ts", tsconfigRaw: '{"a": undefined}' }, "bail"],
  ["paths-no-baseUrl", "x()", { loader: "ts", tsconfigRaw: tc({ paths: { "@/*": ["src/*"] } }) }, "bail"],
  ["paths-two-stars", "x()", { loader: "ts", tsconfigRaw: tc({ baseUrl: ".", paths: { "@/*/*": ["./*"] } }) }, "bail"],
  ["paths-not-array", "x()", { loader: "ts", tsconfigRaw: tc({ baseUrl: ".", paths: { "@/*": "./src/*" } }) }, "bail"],
];
for (const [name, code, opts, expected] of TSCONFIG_CASES) {
  if (only && name !== only) continue;
  if (onlyOpts && !onlyOpts.includes("tsconfig")) continue;
  let ref = null;
  let refErr = null;
  try {
    ref = esbuild.transformSync(code, opts);
  } catch (e) {
    refErr = e.message.split("\n").slice(0, 2).join(" ");
  }
  const errBefore = stats.error;
  const fast = fastTransform(flagsFor(opts), code, undefined);
  const refFails = ref === null || ref.warnings.length > 0;
  let verdict;
  if (stats.error !== errBefore) verdict = `CRASH: ${String(stats.lastError?.stack).split("\n").slice(0, 8).join("\n    ")}`;
  else if (fast !== undefined && ref === null) verdict = `FALSE-ACCEPT: esbuild says ${refErr}`;
  else if (fast !== undefined && ref.warnings.length) verdict = `WARN-ACCEPT: ${ref.warnings[0].text}`;
  else if (fast !== undefined && ref.code !== fast.code) verdict = `MISMATCH\n--- esbuild ---\n${ref.code}--- fast ---\n${fast.code}---`;
  else if (expected === "ok" && fast === undefined) verdict = `UNNECESSARY BAIL${refFails ? ` (but esbuild ${refErr ? "errors: " + refErr : "warns: " + ref.warnings[0].text})` : ""}`;
  else if (expected === "bail" && !refFails) verdict = "EXPECTED esbuild to warn or error, but it succeeded";
  if (verdict !== undefined) {
    bad++;
    console.log(`${verdict.split(":")[0].split("\n")[0]} tsconfig/${name}: ${verdict}`);
  } else if (fast === undefined) {
    bail++;
    if (verbose) console.log(`bail  tsconfig/${name} (esbuild ${refErr ? "errors" : "warns"})`);
  } else {
    ok++;
    if (verbose) console.log(`ok    tsconfig/${name}`);
  }
}
console.log(`ok ${ok}, bad ${bad}, bail ${bail}`);
