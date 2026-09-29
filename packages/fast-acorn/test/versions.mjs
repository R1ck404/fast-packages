// Every ecmaVersion and every option against acorn 8.18 (node_modules),
// through @r1ck404/fast-acorn's public API: parse, parseExpressionAt and
// tokenizer() on the corpus, mutations of it and short random token
// sequences; results, errors (class, message, pos, loc, raisedAt), and
// everything the callbacks saw (onToken as array and function, onComment
// as array and function, onInsertedSemicolon, onTrailingComma), with a
// serializer that also covers key order, prototypes and object identity.
//
// node packages/fast-acorn/test/versions.mjs [--limit N] [--mutations N] [--soup N] [--seed N]
import * as acorn from "acorn";
import * as fast from "../index.mjs";
import { idSer } from "./idser.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const argVal = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const limit = Number(argVal("--limit", 300));
const mutations = Number(argVal("--mutations", 1));
const soupCount = Number(argVal("--soup", 150000));
let seed = Number(argVal("--seed", 20260928));
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const here = fileURLToPath(new URL(".", import.meta.url));

const VERSIONS = [3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 2015, 2019, 2022, 2026, "latest", undefined];
const SOURCE_TYPES = ["script", "module", "commonjs"];
// option sets beyond ecmaVersion / sourceType ("cb:*" become callbacks)
const EXTRAS = [
  {},
  { locations: true, ranges: true },
  { onToken: "cb:array", onComment: "cb:array", locations: true },
  { onToken: "cb:fn", onComment: "cb:fn", onInsertedSemicolon: "cb:fn", onTrailingComma: "cb:fn", locations: true, ranges: true },
  { onInsertedSemicolon: "cb:fn", onTrailingComma: "cb:fn" },
  { allowReserved: true },
  { allowReserved: false },
  { allowReserved: "never", preserveParens: true },
  { allowReturnOutsideFunction: true, allowImportExportEverywhere: true },
  { allowAwaitOutsideFunction: true },
  { allowSuperOutsideMethod: true, allowHashBang: false },
  { allowHashBang: true, checkPrivateFields: false },
  { strict: true },
  { sourceFile: "f.js", directSourceFile: "d.js", locations: true },
  { sourceFile: "f.js", ranges: true },
  { program: "cb:program", locations: true },
  { startLocation: { line: 10, column: 4 }, locations: true },
];

// options for one side (callbacks record into `log`)
function mkOpts(base, log) {
  const o = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === "cb:array") o[k] = log;
    else if (v === "cb:fn") o[k] = function (...a) {
      log.push([k, this === o ? "this=options" : "this=?", ...a]);
    };
    else if (v === "cb:program") o[k] = { type: "Program", start: 0, end: 0, body: [], extra: 1 };
    else o[k] = v;
  }
  return o;
}
const errSer = (e) =>
  e instanceof Error
    ? `ERR ${e.constructor.name}|${e.message}|${e.pos}|${e.loc ? e.loc.line + ":" + e.loc.column : e.loc}|${e.raisedAt}|${Object.keys(e).join(",")}`
    : "THROW " + String(e);
// (for the program option, the given node object is serialized with the result)
function outcome(fn, log, o) {
  let r;
  try {
    r = idSer([fn(), log, o.program || null]);
  } catch (e) {
    r = errSer(e) + " " + idSer([log, o.program || null]);
  }
  return r;
}

let checks = 0, errors = 0, mismatch = 0, shown = 0;
function compare(what, a, b) {
  checks++;
  if (a.startsWith("ERR") || a.startsWith("THROW")) errors++;
  if (a !== b) {
    mismatch++;
    if (shown++ < 20) {
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      console.log(`MISMATCH ${what}\n  acorn: \u2026${a.slice(Math.max(0, i - 200), i + 200)}\n  fast:  \u2026${b.slice(Math.max(0, i - 200), i + 200)}`);
    }
  }
}
function checkParse(what, code, base) {
  const la = [], lb = [];
  const oa = mkOpts(base, la), ob = mkOpts(base, lb);
  compare(what + " " + JSON.stringify(base), outcome(() => acorn.parse(code, oa), la, oa), outcome(() => fast.parse(code, ob), lb, ob));
}
function checkExpr(what, code, pos, base) {
  const la = [], lb = [];
  const oa = mkOpts(base, la), ob = mkOpts(base, lb);
  compare(what + " @" + pos + " " + JSON.stringify(base), outcome(() => acorn.parseExpressionAt(code, pos, oa), la, oa), outcome(() => fast.parseExpressionAt(code, pos, ob), lb, ob));
}
function tokenStream(lib, code, o) {
  const out = [];
  try {
    const t = lib.tokenizer(code, o);
    for (let i = 0; ; i++) {
      const tok = t.getToken();
      out.push(tok, t.pos, t.start, t.end, t.value, t.type, t.exprAllowed, t.curLine, t.lineStart, t.lastTokEnd);
      if (tok.type === lib.tokTypes.eof || i > 2e6) break;
    }
  } catch (e) {
    out.push(errSer(e));
  }
  return out;
}
function checkTokens(what, code, base) {
  const la = [], lb = [];
  const oa = mkOpts(base, la), ob = mkOpts(base, lb);
  compare(what + " " + JSON.stringify(base), idSer([tokenStream(acorn, code, oa), la]), idSer([tokenStream(fast, code, ob), lb]));
  // iteration protocol
  checks++;
  const ia = [], ib = [];
  try {
    for (const t of acorn.tokenizer(code, mkOpts({ ...base, onToken: undefined, onComment: undefined }, []))) ia.push(t);
  } catch (e) {
    ia.push(errSer(e));
  }
  try {
    for (const t of fast.tokenizer(code, mkOpts({ ...base, onToken: undefined, onComment: undefined }, []))) ib.push(t);
  } catch (e) {
    ib.push(errSer(e));
  }
  compare(what + " (iterator)", idSer(ia), idSer(ib));
}

const SN = ["(", ")", "{", "}", "[", "]", ";", ",", "=", "=>", ".", "`", "'", '"', "/", "*", "<", ">", "if", "else", "function", "class", "let", "const", "var", "return", "import", "export", "async", "await", "yield", "new", "?", ":", "...", "#x", "@", "\n", "0", "a", "**", "!", "++", "for (", "of", "in", "static", "get", "super", "this", "`${", "/*", "//", "\\u0061", "08", "1n", "?.", "??", "&&=", "\u2028", "\u00e9", "\u{1F600}"];
function mutate(c) {
  const r = rnd(), p = Math.floor(rnd() * (c.length + 1));
  if (r < 0.25) return c.slice(0, p);
  if (r < 0.7) return c.slice(0, p) + pick(SN) + c.slice(p);
  if (r < 0.9) return c.slice(0, p) + c.slice(p + 1 + Math.floor(rnd() * 6));
  return c.slice(Math.max(0, p - 300), p + 300);
}

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
      const st = statSync(p);
      if (st.size > 300_000 || st.size === 0) continue;
      const key = st.size + ":" + e.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
}
const files = [];
collect(join(here, "../../../node_modules"), files, new Set());
console.log(`${files.length} files`);
const t0 = performance.now();
let fi = 0;
for (const f of files) {
  const code = readFileSync(f, "utf8");
  fi++;
  // every version with the plain options and one rotating option set
  for (const v of VERSIONS) {
    const st = SOURCE_TYPES[(fi + VERSIONS.indexOf(v)) % 3];
    const base = { ecmaVersion: v, sourceType: st };
    if (v === undefined) delete base.ecmaVersion;
    checkParse(f, code, base);
    const extra = EXTRAS[(fi * 7 + VERSIONS.indexOf(v)) % EXTRAS.length];
    const withExtra = { ...base, ...extra };
    if (!(withExtra.sourceType === "commonjs" && withExtra.allowAwaitOutsideFunction)) checkParse(f, code, withExtra);
    for (let m = 0; m < mutations; m++) checkParse(f + " (mutated)", mutate(code), withExtra);
  }
  // tokenizer() and parseExpressionAt, rotating versions / options
  const v = VERSIONS[fi % VERSIONS.length];
  const tbase = { ecmaVersion: v === undefined ? "latest" : v, sourceType: fi & 1 ? "module" : "script", ...pick([{}, { locations: true, ranges: true }, { onComment: "cb:fn", onToken: "cb:array" }]) };
  checkTokens(f + " tokenizer", code, tbase);
  checkTokens(f + " tokenizer (mutated)", mutate(code), tbase);
  const pos = Math.floor(rnd() * (code.length + 1));
  checkExpr(f + " parseExpressionAt", code, pos, { ...tbase, locations: true });
}
const afterCorpus = checks;

// token soup: every version / option combination on short random inputs
const TOKENS = [
  "a", "b", "x", "async", "await", "yield", "let", "of", "get", "set", "static", "as", "from", "using", "arguments", "eval", "enum", "constructor", "prototype", "__proto__",
  "var", "const", "function", "class", "extends", "super", "this", "new", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue",
  "throw", "try", "catch", "finally", "import", "export", "in", "instanceof", "typeof", "void", "delete", "null", "true", "false", "debugger", "with", "target", "meta",
  "(", ")", "[", "]", "{", "}", ";", ",", ".", "?.", "...", "=>", "=", "+=", "**=", "&&=", "||=", "??=", "?", ":", "+", "-", "*", "**", "/", "%", "<", ">", "<=", "==", "===", "!", "~", "++", "--", "&&", "||", "??", "|", "&", "^", "<<", ">>>",
  "1", "0x1f", "1n", "1.5e3", "08", "07", "0o7", "0b1", "1_000", "'s'", '"d"', "'\\u{1F600}'", "'\\08'", "'\\x4'", "`t`", "`a${", "}`", "`\\u{`", "/re/g", "/(?<a>x)\\k<a>/u", "/[/", "#p", "\n", " ", "/*c*/", "/*\n*/", "//c\n", "<!--", "-->", "\\u0061", "\\u{62}", "\\u0069f", "@", "'use strict';", "\u2028",
  "implements", "package", "private", "protected", "public", "interface", "abstract", "int", "goto", "#!x\n",
];
for (let i = 0; i < soupCount; i++) {
  const n = 1 + Math.floor(rnd() * 12);
  let code = "";
  for (let k = 0; k < n; k++) code += pick(TOKENS) + (rnd() < 0.7 ? " " : "");
  const v = VERSIONS[i % VERSIONS.length];
  const base = { ecmaVersion: v === undefined ? "latest" : v, sourceType: SOURCE_TYPES[(i >> 2) % 3], ...EXTRAS[(i >> 4) % EXTRAS.length] };
  if (base.sourceType === "commonjs" && base.allowAwaitOutsideFunction) base.sourceType = "script";
  checkParse("soup " + JSON.stringify(code), code, base);
  if (i % 3 === 0) checkExpr("soup-expr " + JSON.stringify(code), code, Math.floor(rnd() * (code.length + 1)), base);
  if (i % 5 === 0) checkTokens("soup-tokens " + JSON.stringify(code), code, base);
}
console.log(`corpus checks ${afterCorpus}; total checks ${checks}, errors ${errors}, MISMATCH ${mismatch}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(mismatch ? 1 : 0);
