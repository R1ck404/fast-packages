// The shipped build: index.mjs (src/ bundled and minified by build.mjs),
// full.mjs and generic.cjs.
//   - index.mjs is up to date with src/
//   - its exports, their names and Parser's statics look like acorn's
//   - it parses, tokenizes and fails exactly like acorn (a corpus sample,
//     several option sets) and like src/index.mjs
//   - in Node, an unrecognised plugin loads generic.cjs on demand
//   - a browser bundle (esbuild) of the main entry contains none of acorn's
//     generic parser code; run where there is no `process`, the fast paths
//     work (JSX via @r1ck404/fast-acorn-jsx too) and an unrecognised plugin or
//     a patched Parser.prototype throws the documented error; a bundle that
//     also imports "@r1ck404/fast-acorn/full" runs them like acorn
//
// node packages/fast-acorn/test/bundle.mjs [--limit N]
import * as acorn from "acorn";
import * as fast from "../index.mjs";
import * as src from "../src/index.mjs";
import { idSer } from "./idser.mjs";
import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = fileURLToPath(new URL(".", import.meta.url));
const pkg = join(here, "..");
const root = join(pkg, "../..");
const require = createRequire(import.meta.url);
const acornJsx = require("acorn-jsx");
const args = process.argv.slice(2);
const limit = Number(args.includes("--limit") ? args[args.indexOf("--limit") + 1] : 150);

let fails = 0, checks = 0, shown = 0;
function fail(msg) {
  fails++;
  if (shown++ < 25) console.log("FAIL " + msg);
}
function ok(cond, msg) {
  checks++;
  if (!cond) fail(msg);
}
const errSer = (e) => (e instanceof Error ? `ERR ${e.constructor.name}|${e.message}|${e.pos}|${e.loc ? e.loc.line + ":" + e.loc.column : e.loc}|${e.raisedAt}` : "THROW " + String(e));
const run = (f) => {
  try {
    return idSer(f());
  } catch (e) {
    return errSer(e);
  }
};
function same(what, fa, fb) {
  checks++;
  const a = run(fa), b = run(fb);
  if (a !== b) {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    fail(`${what}\n  expected: …${a.slice(Math.max(0, i - 150), i + 150)}\n  actual:   …${b.slice(Math.max(0, i - 150), i + 150)}`);
  }
}

// ---- up to date
try {
  execFileSync(process.execPath, [join(pkg, "build.mjs"), "--check"], { encoding: "utf8" });
  ok(true);
} catch (e) {
  fail("index.mjs is not what build.mjs makes from src/ (run node packages/fast-acorn/build.mjs)\n" + (e.stdout || ""));
}

// ---- exports, names, statics
const genericLoaded = (lib) => typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(lib.Parser.prototype), "parseStatement") !== "undefined";
ok(JSON.stringify(Object.keys(fast).sort()) === JSON.stringify(Object.keys(acorn).sort()), "export names: " + Object.keys(fast));
for (const k of Object.keys(acorn)) {
  ok(typeof fast[k] === typeof acorn[k], "typeof " + k);
  if (typeof acorn[k] === "function") ok(fast[k].name === acorn[k].name && fast[k].length === acorn[k].length, `name/length of ${k}: ${fast[k].name}/${fast[k].length}`);
}
ok(JSON.stringify(Object.keys(fast.Parser)) === JSON.stringify(Object.keys(acorn.Parser)), "Parser's own keys: " + Object.keys(fast.Parser));
for (const k of ["extend", "parse", "parseExpressionAt", "tokenizer"])
  ok(fast.Parser[k].name === acorn.Parser[k].name && fast.Parser[k].length === acorn.Parser[k].length, "Parser." + k + " name/length");
ok(new fast.Position(1, 2).offset.name === "offset", "Position#offset name");
ok(fast.version === acorn.version, "version");
ok(fast.parse("a", { ecmaVersion: "latest" }).constructor === fast.Node, "nodes are Node instances");

// ---- same results as acorn (and as the sources)
const files = [];
(function walk(d) {
  let es;
  try {
    es = readdirSync(d, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of es) {
    if (files.length >= limit) return;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(m|c)?js$/.test(e.name) && statSync(p).size < 150_000) files.push(p);
  }
})(join(root, "node_modules"));
const OPTS = [
  { ecmaVersion: "latest", sourceType: "module" },
  { ecmaVersion: 2020, sourceType: "script", locations: true, ranges: true },
  { ecmaVersion: 5, sourceType: "script", allowReserved: true, allowHashBang: true },
  { ecmaVersion: "latest", sourceType: "module", locations: true, preserveParens: true, allowAwaitOutsideFunction: true },
];
const withCallbacks = (o) => {
  const log = [];
  return [{ ...o, onComment: (...a) => log.push(a), onToken: (t) => log.push(t), onInsertedSemicolon: (...a) => log.push(a), onTrailingComma: (...a) => log.push(a) }, log];
};
for (const [i, f] of files.entries()) {
  const code = readFileSync(f, "utf8");
  const o = OPTS[i % OPTS.length];
  same("parse " + f, () => acorn.parse(code, o), () => fast.parse(code, o));
  if (i % 5 === 0) same("parse (sources) " + f, () => src.parse(code, o), () => fast.parse(code, o));
  if (i % 4 === 0) {
    same("callbacks " + f, () => {
      const [oo, log] = withCallbacks(o);
      return [acorn.parse(code, oo), log];
    }, () => {
      const [oo, log] = withCallbacks(o);
      return [fast.parse(code, oo), log];
    });
    same("tokenizer " + f, () => [...acorn.tokenizer(code, o)], () => [...fast.tokenizer(code, o)]);
  }
  if (i % 3 === 0) {
    const at = code.indexOf("(");
    if (at >= 0) same("parseExpressionAt " + f, () => acorn.parseExpressionAt(code, at, o), () => fast.parseExpressionAt(code, at, o));
  }
  // an error somewhere in the file
  const cut = code.slice(0, (code.length * 0.7) | 0) + " @# )";
  same("error " + f, () => acorn.parse(cut, o), () => fast.parse(cut, o));
}
for (const code of ["const x = <A b='1' {...c}>{d} text &amp; &#123;</A>;", "<a:b c:d='e'/>", "<></>", "<a>{/* c */}</a>"])
  for (const o of OPTS.slice(0, 2)) {
    same("jsx " + code, () => acorn.Parser.extend(acornJsx()).parse(code, o), () => fast.Parser.extend(acornJsx()).parse(code, o));
    same("fast-acorn-jsx " + code, () => acorn.Parser.extend(acornJsx()).parse(code, o), () => fast.Parser.extend(require("@r1ck404/fast-acorn-jsx")()).parse(code, o));
  }
ok(!genericLoaded(fast), "generic parser loaded by the fast paths");

// ---- Node: an unrecognised plugin loads generic.cjs next to index.mjs
const hashComments = (lib) =>
  lib.Parser.extend(
    (Base) =>
      class extends Base {
        getTokenFromCode(code) {
          if (code === 35 && this.input.charCodeAt(this.pos + 1) === 32) {
            this.skipLineComment(1);
            this.skipSpace();
            return this.nextToken();
          }
          return super.getTokenFromCode(code);
        }
      },
  );
const PLUGIN_INPUT = "x = 1 # a comment\ny = f(2, `t${3}`)";
same("unrecognised plugin (Node, on demand)", () => hashComments(acorn).parse(PLUGIN_INPUT, { ecmaVersion: "latest", locations: true }), () => hashComments(fast).parse(PLUGIN_INPUT, { ecmaVersion: "latest", locations: true }));
ok(genericLoaded(fast), "generic parser not loaded for a plugin");

// ---- browser bundles
// method names only acorn's generic parser has (not the fast parser, nor acorn-jsx)
const GENERIC_ONLY = ["parseBindingListItem", "checkPatternErrors", "readToken_pipe_amp", "parseVarStatement", "checkLValPattern"];
{
  const g = readFileSync(join(pkg, "generic.cjs"), "utf8");
  const missing = GENERIC_ONLY.filter((m) => !g.includes(m));
  ok(missing.length === 0, "not in generic.cjs: " + missing);
}
function bundle(entry) {
  const r = buildSync({
    stdin: { contents: entry, resolveDir: root, loader: "js" },
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
    alias: { acorn: "@r1ck404/fast-acorn" },
  });
  return r.outputFiles[0].text;
}
const ENTRY_BODY = `
globalThis.out = {};
const opts = { ecmaVersion: "latest", locations: true };
const tryJson = (f) => { try { return JSON.stringify(f()); } catch (e) { return "ERR " + e.message; } };
out.plain = tryJson(() => acorn.parse("let a = b => b * 2; export {a}", { ...opts, sourceType: "module" }));
out.jsx = tryJson(() => acorn.Parser.extend(jsx()).parse("x = <a b={1}>t &amp; {c}</a>", opts));
// the genuine acorn-jsx, minified: not recognised (acorn's generic parser runs it)
out.genuineJsx = tryJson(() => acorn.Parser.extend(genuineJsx()).parse("x = <a b={1}>t &amp; {c}</a>", opts));
out.plugin = tryJson(() => (${hashComments.toString()})(acorn).parse(${JSON.stringify(PLUGIN_INPUT)}, opts));
out.patched = tryJson(() => {
  const orig = acorn.Parser.prototype.parseLiteral;
  acorn.Parser.prototype.parseLiteral = function (v) { const n = orig.call(this, v); n.patched = true; return n; };
  try { return acorn.parse("x = 1", opts); } finally { acorn.Parser.prototype.parseLiteral = orig; }
});
out.patchedAfter = tryJson(() => acorn.parse("x = 1", opts));
out.exprPos = tryJson(() => acorn.parseExpressionAt("a + b; c", "4", { ecmaVersion: "latest" }));
`;
const expectPlain = JSON.stringify(acorn.parse("let a = b => b * 2; export {a}", { ecmaVersion: "latest", locations: true, sourceType: "module" }));
const expectJsx = JSON.stringify(acorn.Parser.extend(acornJsx()).parse("x = <a b={1}>t &amp; {c}</a>", { ecmaVersion: "latest", locations: true }));
const expectPlugin = JSON.stringify(hashComments(acorn).parse(PLUGIN_INPUT, { ecmaVersion: "latest", locations: true }));
const expectPatched = (() => {
  const orig = acorn.Parser.prototype.parseLiteral;
  acorn.Parser.prototype.parseLiteral = function (v) {
    const n = orig.call(this, v);
    n.patched = true;
    return n;
  };
  try {
    return JSON.stringify(acorn.parse("x = 1", { ecmaVersion: "latest", locations: true }));
  } finally {
    acorn.Parser.prototype.parseLiteral = orig;
  }
})();
const expectExprPos = JSON.stringify(acorn.parseExpressionAt("a + b; c", "4", { ecmaVersion: "latest" }));
const expectAfter = JSON.stringify(acorn.parse("x = 1", { ecmaVersion: "latest", locations: true }));
const runInBrowserLike = (code) => {
  const ctx = vm.createContext({ console });
  vm.runInContext(code, ctx);
  ok(typeof ctx.process === "undefined", "a process in the vm context");
  return ctx.out;
};
{
  const code = bundle(`import * as acorn from "@r1ck404/fast-acorn"; import jsx from "@r1ck404/fast-acorn-jsx"; import genuineJsx from "acorn-jsx";` + ENTRY_BODY);
  for (const m of GENERIC_ONLY) ok(!code.includes(m), "the default bundle contains generic parser code: " + m);
  const out = runInBrowserLike(code);
  ok(out.plain === expectPlain, "browser bundle: parse");
  ok(out.jsx === expectJsx, "browser bundle: jsx via @r1ck404/fast-acorn-jsx: " + out.jsx.slice(0, 200));
  const msg = 'Add `import "@r1ck404/fast-acorn/full";`';
  ok(out.plugin.startsWith("ERR ") && out.plugin.includes(msg), "browser bundle without /full: unrecognised plugin: " + out.plugin.slice(0, 300));
  ok(out.patched.startsWith("ERR ") && out.patched.includes(msg), "browser bundle without /full: patched prototype: " + out.patched.slice(0, 300));
  ok(out.patchedAfter === expectAfter, "browser bundle without /full: parse after a failed patch");
  ok(out.genuineJsx.startsWith("ERR ") && out.genuineJsx.includes(msg), "browser bundle without /full: minified genuine acorn-jsx: " + out.genuineJsx.slice(0, 300));
  ok(out.exprPos.startsWith("ERR ") && out.exprPos.includes(msg), "browser bundle without /full: parseExpressionAt at a string position: " + out.exprPos.slice(0, 300));
}
{
  const code = bundle(`import "@r1ck404/fast-acorn/full"; import * as acorn from "@r1ck404/fast-acorn"; import jsx from "@r1ck404/fast-acorn-jsx"; import genuineJsx from "acorn-jsx";` + ENTRY_BODY);
  ok(GENERIC_ONLY.some((m) => code.includes(m)), "the /full bundle lacks the generic parser");
  const out = runInBrowserLike(code);
  ok(out.plain === expectPlain, "/full bundle: parse");
  ok(out.jsx === expectJsx, "/full bundle: jsx");
  ok(out.genuineJsx === expectJsx, "/full bundle: minified genuine acorn-jsx");
  ok(out.plugin === expectPlugin, "/full bundle: unrecognised plugin: " + out.plugin.slice(0, 300));
  ok(out.patched === expectPatched, "/full bundle: patched prototype: " + out.patched.slice(0, 300));
  ok(out.patchedAfter === expectAfter, "/full bundle: parse after unpatching");
  ok(out.exprPos === expectExprPos, "/full bundle: parseExpressionAt at a string position: " + out.exprPos.slice(0, 300));
}

console.log(`bundle: ${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
