// usage: node tools/lexer_smoke.mjs [--no-acorn] [--runs N] [extra files...]
//
// Smoke test for src/js_lexer.mjs: walks every token of some real files with
// next() the way a parser would (scanRegExp() where a regexp can start,
// rescanCloseBraceAsTemplateToken() for "}" that closes a template "${"),
// checks nothing throws, prints token counts and timings. Unless --no-acorn is
// given it also compares token boundaries and decoded values against acorn's
// tokenizer (JS files, and TS files where acorn copes). Plus a few unit checks
// of escape/number/JSX decoding. Correctness vs Go is verified elsewhere by
// whole-pipeline differential tests.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Log, Source, PrettyPaths, Path } from "../src/logger.mjs";
import { TSOptions, TSConfig } from "../src/config.mjs";
import * as L from "../src/js_lexer.mjs";
import { BAIL, LEXER_PANIC } from "../src/bail.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const useAcorn = !args.includes("--no-acorn");
let runs = 5;
const extra = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--runs") runs = +args[++i];
  else if (args[i] !== "--no-acorn") extra.push(resolve(args[i]));
}

const BS = String.fromCharCode(92);
let failures = 0;
let lastCheck = "";
function check(name, actual, expected) {
  lastCheck = name;
  const ok = Object.is(actual, expected) || (typeof expected === "string" && actual === expected);
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}: got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
  }
}

function makeSource(file, contents) {
  return new Source(new PrettyPaths(file, file), "", contents, new Path(file));
}

function lex(text, tsParse = false) {
  return L.newLexer(new Log(), makeSource("<input>", text), new TSOptions(new TSConfig(), tsParse));
}

// ---------------------------------------------------------------------------
// Unit checks

function unitChecks() {
  check("T numbering", L.TWith, 106);
  check("tIsAssign", L.tIsAssign(L.TSlashEquals) && !L.tIsAssign(L.TSlash), true);

  // Numbers
  const nums = [
    ["0x1F", 31],
    ["0b101", 5],
    ["0o17", 15],
    ["017", 15],
    ["019", 19],
    ["0819", 819],
    ["08.5", 8.5],
    ["1_000_000", 1000000],
    ["1e3", 1000],
    [".5", 0.5],
    ["5.", 5],
    ["0.1", 0.1],
    ["123456789", 123456789],
    ["1234567890", 1234567890],
    ["9007199254740993", 9007199254740992],
    ["123456789012345678901234567890", 1.2345678901234568e29],
    ["1e400", Infinity],
    ["1e-400", 0],
    ["0xFFFFFFFFFFFFFFFFF", 295147905179352830000],
    ["1_2.3_4e1_0", 12.34e10],
  ];
  for (const [text, value] of nums) {
    const lexer = lex(text);
    check("number token " + text, lexer.token, L.TNumericLiteral);
    check("number value " + text, lexer.number, value);
    lexer.next();
    check("number end " + text, lexer.token, L.TEndOfFile);
  }
  for (const [text, value] of [
    ["123n", "123"],
    ["0x1Fn", "0x1F"],
    ["1_0n", "10"],
    ["0n", "0"],
  ]) {
    const lexer = lex(text);
    check("bigint token " + text, lexer.token, L.TBigIntegerLiteral);
    check("bigint text " + text, lexer.identifier, value);
  }
  for (const text of ["1__0", "1_", "0_1", "08_1", "01n", "0b2", "3in"]) {
    let threw = null;
    try {
      lex(text);
    } catch (e) {
      threw = e;
    }
    check("number error " + text, threw, BAIL);
  }

  // String escapes (inputs are built with BS to keep this file free of escapes)
  const strs = [
    ['"' + BS + 'x41"', "A"],
    ['"' + BS + 'u0042"', "B"],
    ['"' + BS + 'u{43}"', "C"],
    ['"' + BS + 'u{1F600}"', String.fromCodePoint(0x1f600)],
    ['"' + BS + '101"', "A"],
    ['"' + BS + '0"', String.fromCharCode(0)],
    ['"' + BS + '08"', String.fromCharCode(0) + "8"],
    ['"' + BS + '400"', String.fromCharCode(32) + "0"],
    ['"' + BS + '9"', "9"],
    ['"a' + BS + "\nb" + '"', "ab"],
    ['"a' + BS + "\r\nb" + '"', "ab"],
    ['"' + BS + 'uD800"', String.fromCharCode(0xd800)],
    ['"' + BS + 'uDC00' + BS + 'uD800"', String.fromCharCode(0xdc00, 0xd800)],
    ['"' + BS + "b" + BS + "f" + BS + "n" + BS + "r" + BS + "t" + BS + 'v"', String.fromCharCode(8, 12, 10, 13, 9, 11)],
    ['"caf' + String.fromCharCode(0xe9) + '"', "caf" + String.fromCharCode(0xe9)],
    ["'x" + String.fromCodePoint(0x1f600) + "y'", "x" + String.fromCodePoint(0x1f600) + "y"],
    ["`a\r\nb\rc`", "a\nb\nc"],
    ['"' + BS + 'q"', "q"],
  ];
  for (const [text, value] of strs) {
    const lexer = lex(text);
    const t = lexer.token;
    check("string token " + JSON.stringify(text), t === L.TStringLiteral || t === L.TNoSubstitutionTemplateLiteral, true);
    const decoded = t === L.TStringLiteral ? lexer.stringLiteral() : lexer.cookedAndRawTemplateContents()[0];
    check("string value " + JSON.stringify(text), decoded, value);
  }
  {
    const lexer = lex('"' + BS + '101"');
    lexer.stringLiteral();
    check("legacy octal loc", lexer.legacyOctalLoc, 1);
  }
  {
    // Invalid escapes: cooked is null for templates, BAIL for strings
    const lexer = lex("`" + BS + "unicode`");
    const [cooked, raw] = lexer.cookedAndRawTemplateContents();
    check("template invalid cooked", cooked, null);
    check("template invalid raw", raw, BS + "unicode");
    let threw = null;
    try {
      lex('"' + BS + 'xZZ"').stringLiteral();
    } catch (e) {
      threw = e;
    }
    check("string invalid escape", threw, BAIL);
    threw = null;
    try {
      lex('"' + BS + 'u{110000}"').stringLiteral();
    } catch (e) {
      threw = e;
    }
    check("string out of range escape", threw, BAIL);
    // Go wraps the value; tagged templates keep going
    check("template out of range cooked", lex("`" + BS + "u{110000}`").cookedAndRawTemplateContents()[0], String.fromCharCode(0xd800, 0xdc00));
  }
  {
    // Template parts with rescan
    const lexer = lex("`a${x}b${y}c`");
    check("template head", lexer.token, L.TTemplateHead);
    check("template head cooked", lexer.stringLiteral(), "a");
    lexer.next();
    check("template x", lexer.identifier, "x");
    lexer.next();
    lexer.rescanCloseBraceAsTemplateToken();
    check("template middle", lexer.token, L.TTemplateMiddle);
    check("template middle raw", lexer.cookedAndRawTemplateContents()[1], "b");
    lexer.next();
    lexer.next();
    lexer.rescanCloseBraceAsTemplateToken();
    check("template tail", lexer.token, L.TTemplateTail);
    check("template tail cooked", lexer.stringLiteral(), "c");
  }

  // Identifiers
  {
    let lexer = lex(BS + "u0061sync");
    check("escaped ident", lexer.identifier, "async");
    check("escaped ident token", lexer.token, L.TIdentifier);
    check("escaped ident not contextual", lexer.isContextualKeyword("async"), false);
    lexer = lex(BS + "u0076ar");
    check("escaped keyword", lexer.token, L.TEscapedKeyword);
    lexer = lex("#priv" + BS + "u0061 x");
    check("private escaped", lexer.token, L.TPrivateIdentifier);
    check("private escaped name", lexer.identifier, "#priva");
    lexer = lex("async of");
    check("contextual", lexer.isContextualKeyword("async"), true);
    lexer = lex(String.fromCharCode(0x3c0) + "x" + String.fromCodePoint(0x10400) + " y");
    check("unicode ident", lexer.identifier, String.fromCharCode(0x3c0) + "x" + String.fromCodePoint(0x10400));
    lexer.next();
    check("unicode ident next", lexer.identifier, "y");
    lexer = lex("instanceof instanceofx in");
    check("kw1", lexer.token, L.TInstanceof);
    lexer.next();
    check("kw2", lexer.token, L.TIdentifier);
    lexer.next();
    check("kw3", lexer.token, L.TIn);
  }

  // Comments and pragmas
  {
    const text =
      "/*! legal */ /* @__PURE__ */ // #__NO_SIDE_EFFECTS__\n/** @jsx h */ /* @jsxFrag Frag */ foo /* @license x */ bar\n" +
      "//# sourceMappingURL=data:abc\n";
    const lexer = lex(text);
    check("comment token", lexer.identifier, "foo");
    check("comment newline", lexer.hasNewlineBefore, true);
    check("pure", (lexer.hasCommentBefore & L.PureCommentBefore) !== 0, true);
    check("nse", (lexer.hasCommentBefore & L.NoSideEffectsCommentBefore) !== 0, true);
    check("legal count", lexer.legalCommentsBeforeToken.length, 1);
    check("comments count", lexer.commentsBeforeToken.length, 3);
    check("jsx pragma", lexer.jsxFactoryPragmaComment.text, "h");
    check("jsx pragma loc", lexer.jsxFactoryPragmaComment.range.loc, text.indexOf("h */"));
    check("jsxFrag pragma", lexer.jsxFragmentPragmaComment.text, "Frag");
    const saved = lexer.clone();
    lexer.next();
    check("bar", lexer.identifier, "bar");
    check("legal count 2", lexer.legalCommentsBeforeToken.length, 1);
    check("clone keeps comments", saved.commentsBeforeToken.length, 3);
    lexer.next();
    check("eof", lexer.token, L.TEndOfFile);
    check("sourceMappingURL", lexer.sourceMappingURL.text, "data:abc");
    check("all comments", lexer.allComments.length, 7);
    check("clone restored", saved.identifier, "foo");
    saved.next();
    check("clone next", saved.identifier, "bar");
  }
  {
    // Multi-line comment newline detection and approximate newline count
    const lexer = lex("a /*\n\n*/ b /* x */ c\n\r\nd");
    lexer.next();
    check("ml newline", lexer.hasNewlineBefore, true);
    lexer.next();
    check("ml no newline", lexer.hasNewlineBefore, false);
    lexer.next();
    check("d", lexer.identifier, "d");
    check("approx newlines", lexer.approximateNewlineCount, 4);
  }

  // Regexps
  {
    const lexer = lex("/a[/]b" + BS + "/c/gimsuyd x");
    check("regexp start", lexer.token, L.TSlash);
    lexer.scanRegExp();
    check("regexp raw", lexer.raw(), "/a[/]b" + BS + "/c/gimsuyd");
    lexer.next();
    check("after regexp", lexer.identifier, "x");
    let threw = null;
    try {
      const l2 = lex("/a/gg");
      l2.scanRegExp();
    } catch (e) {
      threw = e;
    }
    check("regexp dup flag", threw, BAIL);
  }

  // Punctuation splitting
  {
    const lexer = lex(">>>= <<= ?. ?.5 ??= ... =>");
    check("p1", lexer.token, L.TGreaterThanGreaterThanGreaterThanEquals);
    lexer.expectGreaterThan(false);
    check("p1b", lexer.token, L.TGreaterThanGreaterThanEquals);
    lexer.next();
    check("p2", lexer.token, L.TLessThanLessThanEquals);
    lexer.next();
    check("p3", lexer.token, L.TQuestionDot);
    lexer.next();
    check("p4", lexer.token, L.TQuestion);
    lexer.next();
    check("p4b", lexer.number, 0.5);
    lexer.next();
    check("p5", lexer.token, L.TQuestionQuestionEquals);
    lexer.next();
    check("p6", lexer.token, L.TDotDotDot);
    lexer.next();
    check("p7", lexer.token, L.TEqualsGreaterThan);
  }

  // Hashbang, errors, speculative (log disabled) errors
  {
    const lexer = lex("#!/usr/bin/env node\nx");
    check("hashbang", lexer.token, L.THashbang);
    check("hashbang text", lexer.identifier, "#!/usr/bin/env node");
    let threw = null;
    try {
      lex("x ` y").next();
    } catch (e) {
      threw = e;
    }
    check("unterminated template", threw, BAIL);
    const l2 = lex("x");
    l2.isLogDisabled = true;
    threw = null;
    try {
      l2.expect(L.TSemicolon);
    } catch (e) {
      threw = e;
    }
    check("disabled log panics", threw, LEXER_PANIC);
    threw = null;
    try {
      lex("a\n--> html comment").next();
    } catch (e) {
      threw = e;
    }
    check("html comment warning bails", threw, BAIL);
  }

  // JSX
  check(
    "jsx entities",
    L.decodeJSXEntities("", "a &amp; b &#65; &#x41; &#-5; &#+66; &bogus; & &nbsp;"),
    "a & b A A " + String.fromCharCode(0xfffb) + " B &bogus; & " + String.fromCharCode(0xa0),
  );
  check("jsx entities big", L.decodeJSXEntities("", "&#x1F600;&#99999999;&#2147483648;"), String.fromCodePoint(0x1f600) + runeToUTF16Go(99999999) + "&#2147483648;");
  check("jsx whitespace", L.fixWhitespaceAndDecodeJSXEntities("  hello \n   world  \n\n  !  "), "  hello world !  ");
  {
    const lexer = lex('<div a="x&amp;y" b=' + "'" + BS + "'" + '>text &lt;\n  more</div>', false);
    check("jsx <", lexer.token, L.TLessThan);
    lexer.nextInsideJSXElement();
    check("jsx div", lexer.identifier, "div");
    lexer.nextInsideJSXElement();
    check("jsx a", lexer.identifier, "a");
    lexer.nextInsideJSXElement();
    check("jsx =", lexer.token, L.TEquals);
    lexer.nextInsideJSXElement();
    check("jsx attr", lexer.stringLiteral(), "x&y");
    lexer.nextInsideJSXElement();
    lexer.nextInsideJSXElement();
    lexer.nextInsideJSXElement();
    check("jsx attr2", lexer.stringLiteral(), BS);
    check("jsx backslash quote", lexer.previousBackslashQuoteInJSX.len, 2);
    lexer.nextInsideJSXElement();
    check("jsx >", lexer.token, L.TGreaterThan);
    lexer.nextJSXElementChild();
    check("jsx child", lexer.stringLiteral(), "text < more");
    lexer.nextJSXElementChild();
    check("jsx child <", lexer.token, L.TLessThan);
  }

  // rangeOfIdentifier
  {
    const src = makeSource("x", "  foo" + BS + "u{62}ar + #priv 'str'");
    check("range ident", L.rangeOfIdentifier(src, 2).len, 11);
    check("range private", L.rangeOfIdentifier(src, 16).len, 5);
    check("range string", L.rangeOfIdentifier(src, 22).len, 5);
  }
}

function runeToUTF16Go(c) {
  if (c <= 0xffff) return String.fromCharCode(c & 0xffff);
  c -= 0x10000;
  return String.fromCharCode(0xd800 + ((c >> 10) & 0x3ff), 0xdc00 + (c & 0x3ff));
}

// ---------------------------------------------------------------------------
// Token walks

// Can a regexp start after this (significant) token? Heuristic for the plain walk.
function regexAllowedAfter(t) {
  switch (t) {
    case -1:
      return true;
    case L.TIdentifier:
    case L.TPrivateIdentifier:
    case L.TNumericLiteral:
    case L.TBigIntegerLiteral:
    case L.TStringLiteral:
    case L.TNoSubstitutionTemplateLiteral:
    case L.TTemplateTail:
    case L.TCloseParen:
    case L.TCloseBracket:
    case L.TCloseBrace:
    case L.TPlusPlus:
    case L.TMinusMinus:
    case L.TThis:
    case L.TSuper:
    case L.TNull:
    case L.TTrue:
    case L.TFalse:
    case L.TSlash: // (a regexp we just scanned)
      return false;
  }
  return true;
}

// Walks all tokens. "isRegExpAt(start)" decides whether a "/" starts a regexp
// (null: use the heuristic). "onToken(lexer, kind)" is called for every token.
function walk(file, contents, tsParse, isRegExpAt, onToken) {
  const lexer = L.newLexer(new Log(), makeSource(file, contents), new TSOptions(new TSConfig(), tsParse));
  const braceStack = [];
  let prev = -1;
  let count = 0;
  while (lexer.token !== L.TEndOfFile) {
    let t = lexer.token;
    let isRegExp = false;
    if (t === L.TSlash || t === L.TSlashEquals) {
      if (isRegExpAt === null ? regexAllowedAfter(prev) : isRegExpAt(lexer.start)) {
        lexer.scanRegExp();
        isRegExp = true;
      }
    } else if (t === L.TCloseBrace) {
      if (braceStack.pop() === 1) {
        lexer.rescanCloseBraceAsTemplateToken();
        t = lexer.token;
      }
    } else if (t === L.TOpenBrace) {
      braceStack.push(0);
    }
    if (t === L.TTemplateHead || t === L.TTemplateMiddle) braceStack.push(1);
    if (onToken !== null) onToken(lexer, isRegExp);
    prev = isRegExp ? L.TSlash : t;
    count++;
    lexer.next();
  }
  return count;
}

// Decode every literal too (like the parser does)
function decodeAll(lexer) {
  const t = lexer.token;
  if (t === L.TStringLiteral) lexer.stringLiteral();
  else if (t >= L.TNoSubstitutionTemplateLiteral && t <= L.TTemplateTail && t !== L.TNumericLiteral && t !== L.TStringLiteral && t !== L.TBigIntegerLiteral) {
    lexer.cookedAndRawTemplateContents();
  }
}

// ---------------------------------------------------------------------------
// acorn differential

async function loadAcorn() {
  const p = resolve(root, "../node_modules/acorn/dist/acorn.mjs");
  if (!existsSync(p)) return null;
  return await import(pathToFileURL(p).href);
}

function acornDiff(acorn, file, contents, tsParse) {
  const tt = acorn.tokTypes;
  let toks;
  try {
    toks = [...acorn.tokenizer(contents, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true })];
  } catch (e) {
    return { skipped: "acorn: " + e.message };
  }
  const regexStarts = new Set();
  for (const tok of toks) if (tok.type === tt.regexp) regexStarts.add(tok.start);

  let ai = 0;
  let mismatches = 0;
  const report = (msg) => {
    if (mismatches++ < 10) console.log(`  MISMATCH ${file}: ${msg}`);
  };
  walk(file, contents, tsParse, (start) => regexStarts.has(start), (lexer, isRegExp) => {
    const start = lexer.start;
    const end = lexer.end;
    // Skip zero-width acorn tokens (empty template chunks) before this token
    while (ai < toks.length && toks[ai].end <= start && toks[ai].start === toks[ai].end) ai++;
    if (ai >= toks.length || toks[ai].start !== start) {
      report(`token at ${start} (${JSON.stringify(contents.slice(start, end))}) vs acorn at ${ai < toks.length ? toks[ai].start : "eof"}`);
      while (ai < toks.length && toks[ai].start < end) ai++;
      return;
    }
    const first = toks[ai];
    let last = first;
    while (ai < toks.length && toks[ai].start < end) last = toks[ai++];
    // (a trailing empty template chunk belongs to this token too)
    if (last.end !== end) {
      report(`token ${JSON.stringify(contents.slice(start, end))} at ${start} ends at ${end}, acorn at ${last.end}`);
      return;
    }
    const t = lexer.token;
    if (isRegExp) {
      if (first.type !== tt.regexp) report(`regexp at ${start}`);
      return;
    }
    if (t === L.TNumericLiteral) {
      if (first.type !== tt.num || !Object.is(first.value, lexer.number)) report(`number ${contents.slice(start, end)}: ${lexer.number} vs ${first.value}`);
    } else if (t === L.TBigIntegerLiteral) {
      if (first.type !== tt.num || typeof first.value !== "bigint" || BigInt(lexer.identifier) !== first.value) {
        report(`bigint ${contents.slice(start, end)}: ${lexer.identifier} vs ${first.value}`);
      }
    } else if (t === L.TStringLiteral) {
      const s = lexer.stringLiteral();
      if (first.type !== tt.string || s !== first.value) report(`string at ${start}: ${JSON.stringify(s)} vs ${JSON.stringify(first.value)}`);
    } else if (t === L.TNoSubstitutionTemplateLiteral || (t >= L.TTemplateHead && t <= L.TTemplateTail)) {
      const [cooked] = lexer.cookedAndRawTemplateContents();
      const chunk = toks.slice(0, ai).reverse().find((x) => x.type === tt.template || x.type === tt.invalidTemplate);
      const expected = chunk && chunk.start >= start ? (chunk.type === tt.invalidTemplate ? null : chunk.value) : "";
      if (cooked !== expected) report(`template at ${start}: ${JSON.stringify(cooked)} vs ${JSON.stringify(expected)}`);
      if (t !== L.TNoSubstitutionTemplateLiteral && t !== L.TTemplateTail && lexer.stringLiteral() !== cooked && cooked !== null) {
        report(`template stringLiteral at ${start}`);
      }
    } else if (t === L.TIdentifier || t === L.TEscapedKeyword || t >= L.TBreak) {
      if (first.value !== lexer.identifier) report(`identifier at ${start}: ${lexer.identifier} vs ${first.value}`);
    } else if (t === L.TPrivateIdentifier) {
      if (first.type !== tt.privateId || "#" + first.value !== lexer.identifier) report(`private at ${start}`);
    }
  });
  while (ai < toks.length && toks[ai].start === toks[ai].end) ai++;
  if (ai !== toks.length) report(`acorn has ${toks.length - ai} extra tokens`);
  return { mismatches, acornTokens: toks.length };
}

// ---------------------------------------------------------------------------

const files = [];
const nm = resolve(root, "../node_modules");
for (const f of [
  "zod/v4/classic/schemas.js",
  "three/build/three.module.js",
  "react-dom/cjs/react-dom-client.development.js",
  "typescript/lib/typescript.js",
]) {
  const p = join(nm, f);
  if (existsSync(p)) files.push({ path: p, ts: false });
}
const tsDir = resolve(root, "../../../src");
if (existsSync(tsDir)) {
  for (const f of readdirSync(tsDir)) if (f.endsWith(".ts")) files.push({ path: join(tsDir, f), ts: true });
}
for (const p of extra) files.push({ path: p, ts: /\.m?tsx?$/.test(p) });

try {
  unitChecks();
} catch (e) {
  failures++;
  console.log(`FAIL unit checks threw ${e === BAIL ? "BAIL" : e === LEXER_PANIC ? "LEXER_PANIC" : e && e.stack} after check "${lastCheck}"`);
}
console.log(failures === 0 ? "unit checks: ok" : `unit checks: ${failures} FAILED`);

const acorn = useAcorn ? await loadAcorn() : null;
let totalTokens = 0;
let totalBytes = 0;
let totalBest = 0;
let tsTokens = 0;
let tsFiles = 0;
let acornMismatches = 0;
for (const { path, ts } of files) {
  let contents = readFileSync(path, "utf8");
  // (strip a leading BOM)
  if (contents.charCodeAt(0) === 0xfeff) contents = contents.slice(1);
  let count;
  try {
    count = walk(path, contents, ts, null, decodeAll);
  } catch (e) {
    failures++;
    console.log(`FAIL ${path}: threw ${e === BAIL ? "BAIL" : e === LEXER_PANIC ? "LEXER_PANIC" : e && e.stack}`);
    continue;
  }
  let best = Infinity;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    walk(path, contents, ts, null, null);
    const dt = performance.now() - t0;
    if (dt < best) best = dt;
  }
  totalTokens += count;
  totalBytes += contents.length;
  totalBest += best;
  if (ts) {
    tsTokens += count;
    tsFiles++;
  }
  let diff = "";
  if (acorn !== null) {
    const r = acornDiff(acorn, path, contents, ts);
    if (r.skipped) diff = ` (acorn diff skipped: ${r.skipped.slice(0, 60)})`;
    else {
      diff = r.mismatches === 0 ? " (acorn: identical)" : ` (acorn: ${r.mismatches} mismatches)`;
      acornMismatches += r.mismatches;
    }
  }
  if (!ts) {
    console.log(`${path.slice(nm.length + 1)}: ${count} tokens, ${(contents.length / 1024).toFixed(0)} KB, best ${best.toFixed(1)} ms (${((contents.length / 1e6) / (best / 1000)).toFixed(0)} MB/s)${diff}`);
  } else if (diff !== " (acorn: identical)") {
    console.log(`${path}: ${count} tokens${diff}`);
  }
}
if (tsFiles > 0) console.log(`${tsFiles} .ts files: ${tsTokens} tokens`);
console.log(`total: ${totalTokens} tokens, ${(totalBytes / 1e6).toFixed(1)} MB, ${totalBest.toFixed(0)} ms (best of ${runs})`);
if (acorn !== null) console.log(`acorn mismatches: ${acornMismatches}`);
console.log(failures === 0 && acornMismatches === 0 ? "OK" : "FAILED");
process.exit(failures === 0 ? 0 : 1);
