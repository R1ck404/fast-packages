// Generates generic.cjs from acorn 8.18.0 (node_modules): acorn's parser
// itself -- every Parser.prototype method, getter and the constructor body --
// as a factory that installs the methods on a given prototype object and
// takes the shared building blocks (TokenType and the token types, TokContext
// and the contexts, Node, Position, SourceLocation, Token, getOptions, the
// character classification functions, ...) from @r1ck404/fast-acorn's core,
// so identity checks between plugin code, the generic parser and the fast
// parser hold. This is what runs Parser.extend() plugins the fast parser does
// not recognise; it is loaded on first use (index.mjs) or by
// @r1ck404/fast-acorn/full.
//   node packages/fast-acorn/tools/gen-generic.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";
import MagicString from "magic-string";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../../package.json"));
const acornDir = dirname(require.resolve("acorn/package.json"));
const pkg = JSON.parse(readFileSync(join(acornDir, "package.json"), "utf8"));
if (pkg.version !== "8.18.0") throw new Error("expected acorn 8.18.0, found " + pkg.version);
const src = readFileSync(join(acornDir, "dist/acorn.mjs"), "utf8");
const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });
const ms = new MagicString(src);

// shared objects taken from the core (name in acorn.mjs -> name on `core`)
const SHARED = {
  isIdentifierStart: "isIdentifierStart",
  isIdentifierChar: "isIdentifierChar",
  TokenType: "TokenType",
  keywords: "keywordTypes",
  types$1: "tokTypes",
  lineBreak: "lineBreak",
  lineBreakG: "lineBreakG",
  isNewLine: "isNewLine",
  nextLineBreak: "nextLineBreak",
  nonASCIIwhitespace: "nonASCIIwhitespace",
  Position: "Position",
  SourceLocation: "SourceLocation",
  getLineInfo: "getLineInfo",
  defaultOptions: "defaultOptions",
  getOptions: "getOptions",
  TokContext: "TokContext",
  types: "tokContexts",
  Node: "Node",
  Token: "Token",
  empty: "emptyNewArguments",
  empty$1: "emptyImportSpecifiers",
};
// declarations that belong to the shared objects above (dropped here)
const DROP_DECLS = new Set([
  "astralIdentifierCodes", "astralIdentifierStartCodes", "nonASCIIidentifierChars", "nonASCIIidentifierStartChars",
  "nonASCIIidentifierStart", "nonASCIIidentifier", "isInAstralSet", "binop", "beforeExpr", "startsExpr", "kw",
  "warnedAboutEcmaVersion", "pushComment", "version", "parse", "parseExpressionAt", "tokenizer",
  ...Object.keys(SHARED),
]);
const declNames = (st) => {
  if (st.type === "FunctionDeclaration") return [st.id.name];
  if (st.type === "VariableDeclaration") return st.declarations.map((d) => d.id.name);
  return [];
};
const isMember = (n, obj, prop) => n.type === "MemberExpression" && !n.computed && n.object.type === "Identifier" && n.object.name === obj && (prop === undefined || n.property.name === prop);

let sawCtor = false;
for (const st of ast.body) {
  const names = declNames(st);
  if (names.length) {
    const drop = names.filter((n) => DROP_DECLS.has(n));
    if (drop.length === names.length) {
      ms.remove(st.start, st.end);
      continue;
    }
    if (drop.length) throw new Error("mixed declaration " + names.join());
    // var Parser = function Parser(options, input, startPos) {...}  ->  the constructor body
    if (names[0] === "Parser") {
      ms.overwrite(st.start, st.declarations[0].init.start, "var initParser = ");
      sawCtor = true;
    }
    continue;
  }
  if (st.type === "ExportNamedDeclaration") {
    ms.remove(st.start, st.end);
    continue;
  }
  if (st.type === "ExpressionStatement") {
    const e = st.expression;
    const target = e.type === "AssignmentExpression" ? e.left : null;
    // X.updateContext = ..., Position.prototype.offset = ..., Parser.acorn / extend / parse / ... = ...
    if (target) {
      let root = target;
      while (root.type === "MemberExpression") root = root.object;
      let rhs = e.right;
      while (rhs.type === "AssignmentExpression") rhs = rhs.right;
      const rootName = root.type === "Identifier" ? root.name : null;
      if (rootName === "types$1" || rootName === "Position" || (rootName === "Parser" && target.object.type === "Identifier")) {
        ms.remove(st.start, st.end);
        continue;
      }
    }
  }
}
if (!sawCtor) throw new Error("Parser constructor not found");

// Parser.prototype -> proto (method definitions, pp$N aliases, defineProperties)
(function walk(n) {
  if (!n || typeof n.type !== "string") return;
  if (isMember(n, "Parser", "prototype")) {
    ms.overwrite(n.start, n.end, "proto");
    return;
  }
  for (const k in n) {
    const v = n[k];
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v.type === "string") walk(v);
  }
})(ast);

let body = ms.toString();
// strip comments and blank lines (acorn's source, for size; the logic is untouched)
{
  const kept = [];
  const b2 = acorn.parse(body, { ecmaVersion: "latest", sourceType: "module", onComment: (block, text, s, e) => kept.push([s, e]) });
  void b2;
  const m2 = new MagicString(body);
  for (const [s, e] of kept) m2.remove(s, e);
  body = m2.toString().replace(/[ \t]+$/gm, "").replace(/\n{2,}/g, "\n");
}
// anything left that refers to acorn's own Parser object is a bug (the one
// allowed occurrence is the constructor function's own name)
{
  const refs = body.match(/\bParser\b/g) || [];
  if (refs.length !== 1) throw new Error("unexpected references to Parser: " + refs.length);
}

const imports = Object.entries(SHARED).map(([local, shared]) => `${local} = core.${shared}`).join(",\n    ");
const out = `// Generated by tools/gen-generic.mjs from acorn ${pkg.version} (MIT, Marijn Haverbeke and contributors). Do not edit.
// acorn's own parser: installs every Parser.prototype method and getter on
// \`proto\` and returns the constructor body; the shared objects come from
// @r1ck404/fast-acorn's core (see the tool).
"use strict";
module.exports = function installGenericParser(core, proto) {
  var ${imports};
${body}
  return initParser;
};
`;
writeFileSync(join(here, "../generic.cjs"), out);
console.log("wrote generic.cjs", out.length, "bytes");
