// Independent differential check: @r1ck404/fast-acorn (+ @r1ck404/fast-acorn-jsx) vs acorn
// 8.18 (+ acorn-jsx 5.3.2)
// using the option sets and subclasses Nodepod uses, plus tokenizer,
// onComment, parseExpressionAt and error paths (truncations / edits).
// usage: node verify/verify-acorn.mjs [nFiles] [nJsx]
import * as O from "acorn";
import acornJsx from "acorn-jsx";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { allFiles, sample, readText, rnd, rint, pick, Tally, here, describeErr } from "./corpus.mjs";

const F = await import(process.env.FAST_ACORN || "@r1ck404/fast-acorn");
const N = Number(process.argv[2] || 1500);
const NJ = Number(process.argv[3] || 1500);
const T = new Tally("acorn");

// structural serialization incl. constructor names, key order, regex/bigint values
function ser(x, out = []) {
  if (x === null) out.push("null");
  else if (x === undefined) out.push("undef");
  else if (typeof x === "number") out.push(Object.is(x, -0) ? "-0" : String(x));
  else if (typeof x === "bigint") out.push(x + "n");
  else if (typeof x === "string") out.push(JSON.stringify(x));
  else if (typeof x === "boolean") out.push(String(x));
  else if (x instanceof RegExp) out.push("RegExp" + String(x));
  else if (Array.isArray(x)) {
    out.push("[");
    for (let i = 0; i < x.length; i++) {
      if (i) out.push(",");
      ser(x[i], out);
    }
    out.push("]");
  } else if (typeof x === "object") {
    out.push((x.constructor ? x.constructor.name : "null-proto") + "{");
    for (const k of Object.keys(x)) {
      out.push(k, ":");
      ser(x[k], out);
      out.push(",");
    }
    out.push("}");
  } else out.push(typeof x);
  return out;
}
const S = (x) => ser(x).join("");
function errDesc(e) {
  if (!(e instanceof Error)) return describeErr(e);
  return `${e.constructor.name}|${e.message}|pos=${e.pos}|raisedAt=${e.raisedAt}|loc=${e.loc && e.loc.line + ":" + e.loc.column}|${e.loc && e.loc.constructor.name}`;
}
function run(fn) {
  try {
    return "OK " + S(fn());
  } catch (e) {
    return "ERR " + errDesc(e);
  }
}
function cmp(what, fo, ff) {
  const a = run(fo), b = run(ff);
  if (!T.ok(a === b, what)) {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    T.first[T.first.length - 1] += `\n    acorn: ...${a.slice(Math.max(0, i - 80), i + 120)}\n    fast : ...${b.slice(Math.max(0, i - 80), i + 120)}`;
  }
  return a;
}

// Nodepod's syntax-transforms.ts topLevelParser, applied to a given acorn
function topLevel(acorn) {
  const tt = acorn.tokTypes;
  const skipBodies = (Base) =>
    class extends Base {
      parseFunctionBody(node, isArrowFunction, isMethod, forInit) {
        const self = this;
        if (self.type !== tt.braceL) {
          super.parseFunctionBody(node, isArrowFunction, isMethod, forInit);
          return;
        }
        const body = self.startNode();
        let depth = 0;
        do {
          if (self.type === tt.braceL || self.type === tt.dollarBraceL) depth++;
          else if (self.type === tt.braceR) depth--;
          else if (self.type === tt.eof) self.unexpected();
          self.next();
        } while (depth > 0);
        body.body = [];
        node.body = self.finishNode(body, "BlockStatement");
        node.expression = false;
        self.exitScope();
      }
    };
  return acorn.Parser.extend(skipBodies);
}
const TopO = topLevel(O), TopF = topLevel(F);
const JsxO = O.Parser.extend(acornJsx()), JsxF = F.Parser.extend(acornJsx());
// @r1ck404/fast-acorn-jsx (what a minified bundle uses): registered with @r1ck404/fast-acorn
const fastJsx = createRequire(import.meta.url)(process.env.FAST_ACORN_JSX || "@r1ck404/fast-acorn-jsx");
const JsxS = F.Parser.extend(fastJsx()), JsxSO = O.Parser.extend(fastJsx());
const JsxNsO = O.Parser.extend(acornJsx({ allowNamespacedObjects: true })), JsxNsF = F.Parser.extend(acornJsx({ allowNamespacedObjects: true }));
const JsxNoNsO = O.Parser.extend(acornJsx({ allowNamespaces: false })), JsxNoNsF = F.Parser.extend(acornJsx({ allowNamespaces: false }));

const L = "latest";
const rollupOpts = (st) => ({ ecmaVersion: L, sourceType: st, allowReturnOutsideFunction: false, locations: true });

function tokens(acorn, src, opts) {
  const out = [];
  for (const t of acorn.tokenizer(src, opts)) {
    out.push([t.type.label, t.value, t.start, t.end, t.loc && [t.loc.start.line, t.loc.start.column, t.loc.end.line, t.loc.end.column]]);
    if (out.length > 200000) break;
  }
  return out;
}

function edits(src) {
  const outs = [];
  outs.push(src.slice(0, rint(src.length + 1)));
  const EDITS = ["/", "'", '"', "`", "{", "}", "(", ")", "${", "*/", "/*", "//", "\n", "<", ">", "</", "/>", "=", "=>", "?.", "#", "@", "\\u0061", "é", " ", "async ", "await ", "yield ", "let ", "class ", "0x", "1n", ".", "...", ";"];
  const p = rint(src.length + 1);
  outs.push(src.slice(0, p) + pick(EDITS) + src.slice(p));
  const q = rint(src.length);
  outs.push(src.slice(0, q) + src.slice(q + 1 + rint(20)));
  return outs;
}

function checkSource(name, src, isModuleGuess, deep) {
  const sts = isModuleGuess ? ["module", "script"] : ["script", "module"];
  cmp(`${name} parse ${sts[0]}`, () => O.parse(src, { ecmaVersion: L, sourceType: sts[0] }), () => F.parse(src, { ecmaVersion: L, sourceType: sts[0] }));
  cmp(`${name} rollup module+locations`, () => O.parse(src, rollupOpts("module")), () => F.parse(src, rollupOpts("module")));
  cmp(`${name} jsx module+locations`, () => JsxO.parse(src, rollupOpts("module")), () => JsxF.parse(src, rollupOpts("module")));
  cmp(`${name} topLevel module`, () => TopO.parse(src, { ecmaVersion: L, sourceType: "module" }), () => TopF.parse(src, { ecmaVersion: L, sourceType: "module" }));
  if (!deep) return;
  cmp(`${name} parse ${sts[1]} ranges`, () => O.parse(src, { ecmaVersion: L, sourceType: sts[1], ranges: true }), () => F.parse(src, { ecmaVersion: L, sourceType: sts[1], ranges: true }));
  {
    const ca = [], cb = [];
    cmp(`${name} onComment array + locations`, () => [O.parse(src, { ecmaVersion: L, sourceType: sts[0], onComment: ca, locations: true }), ca], () => [F.parse(src, { ecmaVersion: L, sourceType: sts[0], onComment: cb, locations: true }), cb]);
    const fa = [], fb = [];
    cmp(`${name} onComment fn`, () => [O.parse(src, { ecmaVersion: L, sourceType: sts[0], onComment: (...a) => fa.push(a) }), fa], () => [F.parse(src, { ecmaVersion: L, sourceType: sts[0], onComment: (...a) => fb.push(a) }), fb]);
  }
  cmp(`${name} script allowReturn+hashbang`, () => O.parse(src, { ecmaVersion: L, sourceType: "script", allowReturnOutsideFunction: true, allowHashBang: true, locations: true, ranges: true, sourceFile: "x.js" }), () => F.parse(src, { ecmaVersion: L, sourceType: "script", allowReturnOutsideFunction: true, allowHashBang: true, locations: true, ranges: true, sourceFile: "x.js" }));
  if (src.length < 300000) cmp(`${name} tokenizer`, () => tokens(O, src, { ecmaVersion: L, sourceType: sts[0], locations: true }), () => tokens(F, src, { ecmaVersion: L, sourceType: sts[0], locations: true }));
  for (let k = 0; k < 3; k++) {
    const pos = rint(src.length);
    cmp(`${name} parseExpressionAt ${pos}`, () => O.parseExpressionAt(src, pos, { ecmaVersion: L, sourceType: sts[0] }), () => F.parseExpressionAt(src, pos, { ecmaVersion: L, sourceType: sts[0] }));
  }
  if (src.length < 200000) {
    for (const e of edits(src)) {
      cmp(`${name} edit parse`, () => O.parse(e, rollupOpts(sts[0])), () => F.parse(e, rollupOpts(sts[0])));
      cmp(`${name} edit jsx`, () => JsxO.parse(e, rollupOpts("module")), () => JsxF.parse(e, rollupOpts("module")));
    }
  }
}

const exts = [".js", ".mjs", ".cjs"];
const files = sample(allFiles((n) => exts.some((e) => n.endsWith(e))), N, 10 << 20);
console.log("js files:", files.length);
let t0 = Date.now();
for (let i = 0; i < files.length; i++) {
  const src = readText(files[i]);
  const isMod = files[i].endsWith(".mjs") || /^\s*(import|export)\s/m.test(src);
  checkSource(files[i].slice(-70), src, isMod, i % 2 === 0);
  if (i % 200 === 0) process.stderr.write(`  js ${i}/${files.length} ${((Date.now() - t0) / 1000).toFixed(0)}s fails=${T.fails}\n`);
}
const jdir = join(here, "jsx-corpus");
let jfiles = [];
try {
  jfiles = readdirSync(jdir).map((f) => join(jdir, f));
} catch {}
jfiles = jfiles.filter(() => rnd() < NJ / Math.max(1, jfiles.length));
console.log("jsx files:", jfiles.length);
t0 = Date.now();
for (let i = 0; i < jfiles.length; i++) {
  const src = readText(jfiles[i]);
  const name = jfiles[i].slice(-24);
  cmp(`${name} jsx module+locations`, () => JsxO.parse(src, rollupOpts("module")), () => JsxF.parse(src, rollupOpts("module")));
  cmp(`${name} jsx plain`, () => JsxO.parse(src, { ecmaVersion: L, sourceType: "module" }), () => JsxF.parse(src, { ecmaVersion: L, sourceType: "module" }));
  cmp(`${name} @r1ck404/fast-acorn-jsx on @r1ck404/fast-acorn`, () => JsxO.parse(src, rollupOpts("module")), () => JsxS.parse(src, rollupOpts("module")));
  cmp(`${name} @r1ck404/fast-acorn-jsx on acorn`, () => JsxO.parse(src, rollupOpts("module")), () => JsxSO.parse(src, rollupOpts("module")));
  cmp(`${name} jsx nsObjects`, () => JsxNsO.parse(src, { ecmaVersion: L, sourceType: "module", ranges: true }), () => JsxNsF.parse(src, { ecmaVersion: L, sourceType: "module", ranges: true }));
  cmp(`${name} jsx noNs`, () => JsxNoNsO.parse(src, { ecmaVersion: L, sourceType: "module" }), () => JsxNoNsF.parse(src, { ecmaVersion: L, sourceType: "module" }));
  cmp(`${name} plain acorn (rollup first try)`, () => O.parse(src, rollupOpts("module")), () => F.parse(src, rollupOpts("module")));
  if (i % 3 === 0 && src.length < 100000) {
    cmp(`${name} jsx tokenizer`, () => tokens(JsxO, src, { ecmaVersion: L, sourceType: "module", locations: true }), () => tokens(JsxF, src, { ecmaVersion: L, sourceType: "module", locations: true }));
    for (const e of edits(src)) cmp(`${name} jsx edit`, () => JsxO.parse(e, rollupOpts("module")), () => JsxF.parse(e, rollupOpts("module")));
    const ca = [], cb = [];
    cmp(`${name} jsx onComment`, () => [JsxO.parse(src, { ecmaVersion: L, sourceType: "module", onComment: ca }), ca], () => [JsxF.parse(src, { ecmaVersion: L, sourceType: "module", onComment: cb }), cb]);
  }
  if (i % 200 === 0) process.stderr.write(`  jsx ${i}/${jfiles.length} ${((Date.now() - t0) / 1000).toFixed(0)}s fails=${T.fails}\n`);
}

// hand-written JSX edge cases
const jsxCases = [
  "<a b='&amp;&#123;&#x41;&nbsp;&bogus;&' c=\"x\" {...d} e />",
  "<a:b c:d='1'></a:b>",
  "<a.b.c></a.b.c>",
  "<></>",
  "<>text {x} &lt; <b/>\r\n  more\n</>",
  "<div>{/* c */}</div>",
  "<div>{}</div>",
  "x = <a>{`t${1}`}</a>",
  "<a b={<c/>}>{[1,2].map(i => <i key={i}/>)}</a>",
  "<a></b>",
  "<a.b:c/>",
  "<a:b.c/>",
  "<a>></a>",
  "<a>}</a>",
  "<Ünï ç='1'/>",
  "<a-b c-d='1'/>",
  "f(<a/>, <b/>)",
  "a < b > c",
  "<a> </a>",
  "<svg:rect xlink:href='#x'/>",
  "class A { render() { return <div className={this.x}>hi</div> } }",
  "async () => <a/>",
  "<a b=<c/> />",
];
for (const c of jsxCases) {
  cmp(`jsxcase ${c}`, () => JsxO.parse(c, rollupOpts("module")), () => JsxF.parse(c, rollupOpts("module")));
  cmp(`jsxcase fast-acorn-jsx ${c}`, () => JsxO.parse(c, rollupOpts("module")), () => JsxS.parse(c, rollupOpts("module")));
  cmp(`jsxcase nsobj ${c}`, () => JsxNsO.parse(c, rollupOpts("module")), () => JsxNsF.parse(c, rollupOpts("module")));
  cmp(`jsxcase nons ${c}`, () => JsxNoNsO.parse(c, rollupOpts("module")), () => JsxNoNsF.parse(c, rollupOpts("module")));
  cmp(`jsxcase tok ${c}`, () => tokens(JsxO, c, { ecmaVersion: L, sourceType: "module" }), () => tokens(JsxF, c, { ecmaVersion: L, sourceType: "module" }));
}
process.exit(T.report() ? 1 : 0);
