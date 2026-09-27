// @r1ck404/fast-acorn: a speed-oriented re-implementation of acorn 8.18's parser.
//
// Every grammar decision mirrors acorn function-for-function (same names,
// same order of checks, same token-context rules for regexp detection), and
// every AST node is built with exactly the keys acorn produces, in the same
// order. The machinery underneath is different: integer token types with
// flag tables, an ASCII fast path in the tokenizer, per-node-type
// constructors (monomorphic shapes), O(1) scope-flag lookups and set-backed
// scopes, no per-call regexps, a precomputed "newline before token" flag.
//
// Errors: "Unexpected token" is raised here exactly as acorn raises it
// (same message, pos, loc, raisedAt; see unexpected()) when no plugin or
// onComment callback is involved. Every other error throws BAIL instead and
// the caller re-runs the original acorn, which then produces the exact
// SyntaxError (or, should this parser ever be stricter than acorn, the AST).
// Only configurations with ecmaVersion >= 16 ("latest") and without
// onToken / onInsertedSemicolon / onTrailingComma callbacks take this path.
//
// Modes for Parser.extend() subclasses: JSX (the acorn-jsx 5.3.2 plugin,
// see jsx-detect.mjs) and a hosted parseFunctionBody override (override.mjs,
// BodyFacade below).
//
// Memory: AST lists are built as exact-size arrays (listFrom), token end
// Positions are created only when a node needs them (leloc), and the
// parser keeps acorn's object sharing (a token's Position is shared by all
// nodes starting/ending there; acorn's own shared empty arrays are used).

import {
  Node,
  Position,
  SourceLocation,
  Parser as VParser,
  isIdentifierStart,
  isIdentifierChar,
  lineBreak,
  _RegExpValidationState as RegExpValidationState,
  _emptyNewArguments,
  _emptyImportSpecifiers,
  tokTypes as acornTT,
  getLineInfo,
} from "./vendor/acorn.mjs";
import { XHTMLEntities } from "./jsx-data.mjs";

export const BAIL = { fastAcornBail: true };

// "Unexpected token" errors made by the fast parser itself (see unexpected())
export const exactErrors = new WeakSet();
export const errorStats = { exact: 0 };
function bail() {
  throw BAIL;
}

// ------------------------------------------------------------ char tables

const ID_START = new Uint8Array(128);
const ID_CHAR = new Uint8Array(128);
for (let c = 0; c < 128; c++) {
  const s = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95;
  ID_START[c] = s ? 1 : 0;
  ID_CHAR[c] = s || (c >= 48 && c <= 57) ? 1 : 0;
}

function isNewLine(code) {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}
const nonASCIIwhitespace = /[  -   　﻿]/;

function codePointToString(code) {
  if (code <= 0xffff) return String.fromCharCode(code);
  code -= 0x10000;
  return String.fromCharCode((code >> 10) + 0xd800, (code & 1023) + 0xdc00);
}
const loneSurrogate = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])/;

// ------------------------------------------------------------ tokens

const T_NUM = 0, T_REGEXP = 1, T_STRING = 2, T_NAME = 3, T_PRIVATEID = 4, T_EOF = 5,
  T_BRACKETL = 6, T_BRACKETR = 7, T_BRACEL = 8, T_BRACER = 9, T_PARENL = 10, T_PARENR = 11,
  T_COMMA = 12, T_SEMI = 13, T_COLON = 14, T_DOT = 15, T_QUESTION = 16, T_QUESTIONDOT = 17,
  T_ARROW = 18, T_TEMPLATE = 19, T_INVALIDTEMPLATE = 20, T_ELLIPSIS = 21, T_BACKQUOTE = 22,
  T_DOLLARBRACEL = 23, T_EQ = 24, T_ASSIGN = 25, T_INCDEC = 26, T_PREFIX = 27,
  T_LOGICALOR = 28, T_LOGICALAND = 29, T_BITWISEOR = 30, T_BITWISEXOR = 31, T_BITWISEAND = 32,
  T_EQUALITY = 33, T_RELATIONAL = 34, T_BITSHIFT = 35, T_PLUSMIN = 36, T_MODULO = 37, T_STAR = 38,
  T_SLASH = 39, T_STARSTAR = 40, T_COALESCE = 41,
  // acorn-jsx token types (only produced in JSX mode)
  T_JSXNAME = 42, T_JSXTEXT = 43, T_JSXTAGSTART = 44, T_JSXTAGEND = 45,
  T_BREAK = 46, T_CASE = 47, T_CATCH = 48, T_CONTINUE = 49, T_DEBUGGER = 50, T_DEFAULT = 51,
  T_DO = 52, T_ELSE = 53, T_FINALLY = 54, T_FOR = 55, T_FUNCTION = 56, T_IF = 57, T_RETURN = 58,
  T_SWITCH = 59, T_THROW = 60, T_TRY = 61, T_VAR = 62, T_CONST = 63, T_WHILE = 64, T_WITH = 65,
  T_NEW = 66, T_THIS = 67, T_SUPER = 68, T_CLASS = 69, T_EXTENDS = 70, T_EXPORT = 71, T_IMPORT = 72,
  T_NULL = 73, T_TRUE = 74, T_FALSE = 75, T_IN = 76, T_INSTANCEOF = 77, T_TYPEOF = 78, T_VOID = 79,
  T_DELETE = 80;
const T_COUNT = 81;
const T_KW_FIRST = T_BREAK;

const F_BEFORE = 1, F_STARTS = 2, F_LOOP = 4, F_ASSIGN = 8, F_PREFIX = 16, F_POSTFIX = 32;
const TF = new Uint8Array(T_COUNT);
const BINOP = new Int8Array(T_COUNT).fill(-1);
const KW_NAME = new Array(T_COUNT).fill(undefined);
function tdef(t, flags, binop?) {
  TF[t] = flags;
  if (binop != null) BINOP[t] = binop;
}
tdef(T_NUM, F_STARTS); tdef(T_REGEXP, F_STARTS); tdef(T_STRING, F_STARTS); tdef(T_NAME, F_STARTS);
tdef(T_PRIVATEID, F_STARTS); tdef(T_EOF, 0);
tdef(T_BRACKETL, F_BEFORE | F_STARTS); tdef(T_BRACKETR, 0); tdef(T_BRACEL, F_BEFORE | F_STARTS);
tdef(T_BRACER, 0); tdef(T_PARENL, F_BEFORE | F_STARTS); tdef(T_PARENR, 0);
tdef(T_COMMA, F_BEFORE); tdef(T_SEMI, F_BEFORE); tdef(T_COLON, F_BEFORE); tdef(T_DOT, 0);
tdef(T_QUESTION, F_BEFORE); tdef(T_QUESTIONDOT, 0); tdef(T_ARROW, F_BEFORE); tdef(T_TEMPLATE, 0);
tdef(T_INVALIDTEMPLATE, 0); tdef(T_ELLIPSIS, F_BEFORE); tdef(T_BACKQUOTE, F_STARTS);
tdef(T_DOLLARBRACEL, F_BEFORE | F_STARTS);
tdef(T_EQ, F_BEFORE | F_ASSIGN); tdef(T_ASSIGN, F_BEFORE | F_ASSIGN);
tdef(T_INCDEC, F_PREFIX | F_POSTFIX | F_STARTS); tdef(T_PREFIX, F_BEFORE | F_PREFIX | F_STARTS);
tdef(T_LOGICALOR, F_BEFORE, 1); tdef(T_LOGICALAND, F_BEFORE, 2); tdef(T_BITWISEOR, F_BEFORE, 3);
tdef(T_BITWISEXOR, F_BEFORE, 4); tdef(T_BITWISEAND, F_BEFORE, 5); tdef(T_EQUALITY, F_BEFORE, 6);
tdef(T_RELATIONAL, F_BEFORE, 7); tdef(T_BITSHIFT, F_BEFORE, 8);
tdef(T_PLUSMIN, F_BEFORE | F_PREFIX | F_STARTS, 9); tdef(T_MODULO, F_BEFORE, 10);
tdef(T_STAR, F_BEFORE, 10); tdef(T_SLASH, F_BEFORE, 10); tdef(T_STARSTAR, F_BEFORE);
tdef(T_COALESCE, F_BEFORE, 1);
tdef(T_JSXNAME, 0); tdef(T_JSXTEXT, F_BEFORE); tdef(T_JSXTAGSTART, F_STARTS); tdef(T_JSXTAGEND, 0);
const KEYWORDS = new Map();
function kw(t, name, flags, binop?) {
  tdef(t, flags, binop);
  KW_NAME[t] = name;
  KEYWORDS.set(name, t);
}
kw(T_BREAK, "break", 0); kw(T_CASE, "case", F_BEFORE); kw(T_CATCH, "catch", 0);
kw(T_CONTINUE, "continue", 0); kw(T_DEBUGGER, "debugger", 0); kw(T_DEFAULT, "default", F_BEFORE);
kw(T_DO, "do", F_LOOP | F_BEFORE); kw(T_ELSE, "else", F_BEFORE); kw(T_FINALLY, "finally", 0);
kw(T_FOR, "for", F_LOOP); kw(T_FUNCTION, "function", F_STARTS); kw(T_IF, "if", 0);
kw(T_RETURN, "return", F_BEFORE); kw(T_SWITCH, "switch", 0); kw(T_THROW, "throw", F_BEFORE);
kw(T_TRY, "try", 0); kw(T_VAR, "var", 0); kw(T_CONST, "const", 0); kw(T_WHILE, "while", F_LOOP);
kw(T_WITH, "with", 0); kw(T_NEW, "new", F_BEFORE | F_STARTS); kw(T_THIS, "this", F_STARTS);
kw(T_SUPER, "super", F_STARTS); kw(T_CLASS, "class", F_STARTS); kw(T_EXTENDS, "extends", F_BEFORE);
kw(T_EXPORT, "export", 0); kw(T_IMPORT, "import", F_STARTS); kw(T_NULL, "null", F_STARTS);
kw(T_TRUE, "true", F_STARTS); kw(T_FALSE, "false", F_STARTS); kw(T_IN, "in", F_BEFORE, 7);
kw(T_INSTANCEOF, "instanceof", F_BEFORE, 7); kw(T_TYPEOF, "typeof", F_BEFORE | F_PREFIX | F_STARTS);
kw(T_VOID, "void", F_BEFORE | F_PREFIX | F_STARTS); kw(T_DELETE, "delete", F_BEFORE | F_PREFIX | F_STARTS);

// keyword candidates keyed by (length, first char, second char): unique for
// every keyword, so a word is a keyword iff the remaining chars also match
const KW_SHAPE = new Int8Array(9 * 25 * 128).fill(-1);
for (const [name, t] of KEYWORDS) KW_SHAPE[shapeIndex(name.length, name.charCodeAt(0), name.charCodeAt(1))] = t;

// index: (len-2)*25*128 + (c0-97)*128 + c1   (len 2..10, c0 a..y, c1 < 128)
function shapeIndex(n, c0, c1) {
  return ((n - 2) * 25 + (c0 - 97)) * 128 + c1;
}
// Names that checkUnreserved / checkLValSimple can object to. Like the
// keywords, each has a unique (length, first char, second char) shape, so
// "is this name restricted at all" costs an integer lookup plus a compare
// instead of string hashing; the precise checks only run for these names.
const R_KEYWORD = 1, R_RESERVED = 2, R_RESERVED_MODULE = 4, R_STRICT = 8, R_STRICT_BIND = 16, R_OTHER = 32;
const RESTRICTED = new Map();
function rdef(name, bit) {
  RESTRICTED.set(name, (RESTRICTED.get(name) || 0) | bit);
}
for (const [name] of KEYWORDS) rdef(name, R_KEYWORD);
rdef("enum", R_RESERVED);
rdef("await", R_RESERVED_MODULE);
for (const w of "implements interface let package private protected public static yield".split(" ")) rdef(w, R_STRICT);
for (const w of "eval arguments".split(" ")) rdef(w, R_STRICT_BIND);
for (const w of "yield await arguments let".split(" ")) rdef(w, R_OTHER);
const R_SHAPE = new Int8Array(9 * 25 * 128).fill(-1);
const R_NAMES = [];
const R_MASKS = [];
for (const [name, mask] of RESTRICTED) {
  const idx = shapeIndex(name.length, name.charCodeAt(0), name.charCodeAt(1));
  if (R_SHAPE[idx] >= 0) throw new Error("restricted shape collision " + name);
  R_SHAPE[idx] = R_NAMES.length;
  R_NAMES.push(name);
  R_MASKS.push(mask);
}
// 0 when `name` can never be rejected by the identifier checks.
// (checkUnreserved also sees string-literal module export names, e.g.
// `import { "a" } from "m"`: no name -- acorn's regexp tests of undefined
// match nothing there, and the error comes from the checks that follow.)
function restrictedMask(name) {
  if (typeof name !== "string") return 0;
  const n = name.length;
  if (n < 2 || n > 10) return 0;
  const c0 = name.charCodeAt(0), c1 = name.charCodeAt(1);
  if (c0 < 97 || c0 > 121 || c1 >= 128) return 0;
  const i = R_SHAPE[shapeIndex(n, c0, c1)];
  if (i < 0) return 0;
  return R_NAMES[i] === name ? R_MASKS[i] : 0;
}

// operator token values (strings) without slicing the input
const OP1 = new Array(128).fill(undefined);
for (const c of "=!~+-*/%<>&|^?.") OP1[c.charCodeAt(0)] = c;
const OP2 = new Map();
for (const op of ["==", "!=", "+=", "-=", "*=", "/=", "%=", "<=", ">=", "&=", "|=", "^=", "&&", "||", "??", "++", "--", "<<", ">>", "**", "?."])
  OP2.set((op.charCodeAt(0) << 8) | op.charCodeAt(1), op);

// single-character punctuation tokens
const PUNCT1 = new Int8Array(128).fill(-1);
PUNCT1[40] = T_PARENL; PUNCT1[41] = T_PARENR; PUNCT1[59] = T_SEMI; PUNCT1[44] = T_COMMA;
PUNCT1[91] = T_BRACKETL; PUNCT1[93] = T_BRACKETR; PUNCT1[123] = T_BRACEL; PUNCT1[125] = T_BRACER;
PUNCT1[58] = T_COLON; PUNCT1[96] = T_BACKQUOTE;

// token contexts (acorn's TokContext objects)
const C_B_STAT = 0, C_B_EXPR = 1, C_B_TMPL = 2, C_P_STAT = 3, C_P_EXPR = 4, C_Q_TMPL = 5,
  C_F_STAT = 6, C_F_EXPR = 7, C_F_EXPR_GEN = 8, C_F_GEN = 9,
  // acorn-jsx's tc_oTag ("<tag"), tc_cTag ("</tag"), tc_expr ("<tag>...</tag>", preserveSpace)
  C_J_OTAG = 10, C_J_CTAG = 11, C_J_EXPR = 12;
const CTX_IS_EXPR = [false, true, false, false, true, true, false, true, true, false, false, false, true];
const CTX_IS_FUNC = [false, false, false, false, false, false, true, true, true, true, false, false, false];
const CTX_IS_GEN = [false, false, false, false, false, false, false, false, true, true, false, false, false];

// scopes
const SCOPE_TOP = 1, SCOPE_FUNCTION = 2, SCOPE_ASYNC = 4, SCOPE_GENERATOR = 8, SCOPE_ARROW = 16,
  SCOPE_SIMPLE_CATCH = 32, SCOPE_SUPER = 64, SCOPE_DIRECT_SUPER = 128, SCOPE_CLASS_STATIC_BLOCK = 256,
  SCOPE_CLASS_FIELD_INIT = 512, SCOPE_SWITCH = 1024,
  SCOPE_VAR = SCOPE_TOP | SCOPE_FUNCTION | SCOPE_CLASS_STATIC_BLOCK;
function functionFlags(async, generator) {
  return SCOPE_FUNCTION | (async ? SCOPE_ASYNC : 0) | (generator ? SCOPE_GENERATOR : 0);
}
const BIND_NONE = 0, BIND_VAR = 1, BIND_LEXICAL = 2, BIND_FUNCTION = 3, BIND_SIMPLE_CATCH = 4, BIND_OUTSIDE = 5;

// name lists: small arrays, promoted to Sets when they grow
function lhas(l, name) {
  if (l === null) return false;
  if (l instanceof Set) return l.has(name);
  for (let i = 0; i < l.length; i++) if (l[i] === name) return true;
  return false;
}
function ladd(l, name) {
  if (l === null) return [name];
  if (l instanceof Set) {
    l.add(name);
    return l;
  }
  l.push(name);
  if (l.length > 16) return new Set(l);
  return l;
}

class Scope {
  declare allowNewDotTarget: any;
  declare canAwait: any;
  declare firstLexical: any;
  declare flags: any;
  declare functions: any;
  declare lexical: any;
  declare thisScope: any;
  declare var: any;
  declare varScope: any;
  constructor(flags, parent, topCanAwait) {
    this.init(flags, parent, topCanAwait);
  }
  init(flags, parent, topCanAwait) {
    this.flags = flags;
    this.var = null;
    this.lexical = null;
    this.functions = null;
    this.firstLexical = null;
    const varLike = flags & (SCOPE_VAR | SCOPE_CLASS_FIELD_INIT | SCOPE_CLASS_STATIC_BLOCK);
    this.varScope = varLike ? this : parent.varScope;
    this.thisScope = varLike && !(flags & SCOPE_ARROW) ? this : parent.thisScope;
    // canAwait / allowNewDotTarget: acorn walks the stack; the answer only
    // depends on the chain, so it is computed once per scope
    if (flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT)) this.canAwait = false;
    else if (flags & SCOPE_FUNCTION) this.canAwait = (flags & SCOPE_ASYNC) > 0;
    else this.canAwait = parent ? parent.canAwait : topCanAwait;
    if (flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT) || (flags & SCOPE_FUNCTION && !(flags & SCOPE_ARROW)))
      this.allowNewDotTarget = true;
    else this.allowNewDotTarget = parent ? parent.allowNewDotTarget : false;
  }
}

class DestructuringErrors {
  declare doubleProto: any;
  declare parenthesizedAssign: any;
  declare parenthesizedBind: any;
  declare shorthandAssign: any;
  declare trailingComma: any;
  constructor() {
    this.shorthandAssign = -1;
    this.trailingComma = -1;
    this.parenthesizedAssign = -1;
    this.parenthesizedBind = -1;
    this.doubleProto = -1;
  }
}

// DestructuringErrors records are only live while the function that created
// them runs, so they come from a stack indexed by nesting depth
function rdeAcquire(p) {
  const pool = p.rdePool;
  let r = pool[p.rdeDepth];
  if (r === undefined) pool[p.rdeDepth] = r = new DestructuringErrors();
  else {
    r.shorthandAssign = -1;
    r.trailingComma = -1;
    r.parenthesizedAssign = -1;
    r.parenthesizedBind = -1;
    r.doubleProto = -1;
  }
  p.rdeDepth++;
  return r;
}

// ------------------------------------------------------------ AST nodes
// One constructor per node type: keys are created in exactly acorn's order
// (type, start, end, [loc], [sourceFile], [range], then the fields in the
// order acorn's parse functions assign them).

function extra(n, p, s, sl) {
  if (p.locations) n.loc = new SourceLocation(p, sl, p.leloc());
  if (p.directSourceFile) n.sourceFile = p.directSourceFile;
  if (p.ranges) n.range = [s, p.lastTokEnd];
}

function defNode(type, fields) {
  const args = fields.map((_, i) => "a" + i).join(", ");
  const body =
    `this.type = ${JSON.stringify(type)}; this.start = s; this.end = p.lastTokEnd;\n` +
    // loc/sourceFile/range stored inline so each constructor keeps its own
    // monomorphic store ICs (an out-of-line helper would see every shape)
    `if (p.xtra) {\n` +
    `  if (p.locations) this.loc = new SourceLocation(p, sl, p.leloc());\n` +
    `  if (p.directSourceFile) this.sourceFile = p.directSourceFile;\n` +
    `  if (p.ranges) this.range = [s, p.lastTokEnd];\n` +
    `}\n` +
    fields.map((f, i) => `this.${f} = a${i};`).join("\n");
  const C = new Function("SourceLocation", `return function ${type}(p, s, sl${args ? ", " + args : ""}) {\n${body}\n}`)(SourceLocation);
  C.prototype = Node.prototype;
  return C;
}

const NProgram = defNode("Program", ["body", "sourceType"]);
const NExpressionStatement = defNode("ExpressionStatement", ["expression"]);
const NBlockStatement = defNode("BlockStatement", ["body"]);
const NEmptyStatement = defNode("EmptyStatement", []);
const NDebuggerStatement = defNode("DebuggerStatement", []);
const NWithStatement = defNode("WithStatement", ["object", "body"]);
const NReturnStatement = defNode("ReturnStatement", ["argument"]);
const NLabeledStatement = defNode("LabeledStatement", ["body", "label"]);
const NBreakStatement = defNode("BreakStatement", ["label"]);
const NContinueStatement = defNode("ContinueStatement", ["label"]);
const NIfStatement = defNode("IfStatement", ["test", "consequent", "alternate"]);
const NSwitchStatement = defNode("SwitchStatement", ["discriminant", "cases"]);
const NSwitchCase = defNode("SwitchCase", ["consequent", "test"]);
const NThrowStatement = defNode("ThrowStatement", ["argument"]);
const NTryStatement = defNode("TryStatement", ["block", "handler", "finalizer"]);
const NCatchClause = defNode("CatchClause", ["param", "body"]);
const NWhileStatement = defNode("WhileStatement", ["test", "body"]);
const NDoWhileStatement = defNode("DoWhileStatement", ["body", "test"]);
const NForStatement = defNode("ForStatement", ["init", "test", "update", "body"]);
const NForInStatement = defNode("ForInStatement", ["left", "right", "body"]);
const NForOfStatement = defNode("ForOfStatement", ["await", "left", "right", "body"]);
const NForInStatementAwait = defNode("ForInStatement", ["await", "left", "right", "body"]);
const NVariableDeclaration = defNode("VariableDeclaration", ["declarations", "kind"]);
const NVariableDeclarator = defNode("VariableDeclarator", ["id", "init"]);
const NFunctionDeclaration = defNode("FunctionDeclaration", ["id", "expression", "generator", "async", "params", "body"]);
const NFunctionExpression = defNode("FunctionExpression", ["id", "expression", "generator", "async", "params", "body"]);
const NArrowFunctionExpression = defNode("ArrowFunctionExpression", ["id", "expression", "generator", "async", "params", "body"]);
const NClassDeclaration = defNode("ClassDeclaration", ["id", "superClass", "body"]);
const NClassExpression = defNode("ClassExpression", ["id", "superClass", "body"]);
const NClassBody = defNode("ClassBody", ["body"]);
const NMethodDefinition = defNode("MethodDefinition", ["static", "computed", "key", "kind", "value"]);
const NPropertyDefinition = defNode("PropertyDefinition", ["static", "computed", "key", "value"]);
const NStaticBlock = defNode("StaticBlock", ["body"]);
const NSuper = defNode("Super", []);
const NThisExpression = defNode("ThisExpression", []);
const NIdentifier = defNode("Identifier", ["name"]);
const NPrivateIdentifier = defNode("PrivateIdentifier", ["name"]);
const NLiteral = defNode("Literal", ["value", "raw"]);
const NLiteralBig = defNode("Literal", ["value", "raw", "bigint"]);
const NLiteralRe = defNode("Literal", ["value", "raw", "regex"]);
const NArrayExpression = defNode("ArrayExpression", ["elements"]);
const NObjectExpression = defNode("ObjectExpression", ["properties"]);
const NObjectPattern = defNode("ObjectPattern", ["properties"]);
const NArrayPattern = defNode("ArrayPattern", ["elements"]);
const NProperty = defNode("Property", ["method", "shorthand", "computed", "key", "value", "kind"]);
const NSpreadElement = defNode("SpreadElement", ["argument"]);
const NRestElement = defNode("RestElement", ["argument"]);
const NTemplateLiteral = defNode("TemplateLiteral", ["expressions", "quasis"]);
const NTemplateElement = defNode("TemplateElement", ["value", "tail"]);
const NTaggedTemplateExpression = defNode("TaggedTemplateExpression", ["tag", "quasi"]);
const NSequenceExpression = defNode("SequenceExpression", ["expressions"]);
const NUnaryExpression = defNode("UnaryExpression", ["operator", "prefix", "argument"]);
const NUpdateExpression = defNode("UpdateExpression", ["operator", "prefix", "argument"]);
const NBinaryExpression = defNode("BinaryExpression", ["left", "operator", "right"]);
const NLogicalExpression = defNode("LogicalExpression", ["left", "operator", "right"]);
const NAssignmentExpression = defNode("AssignmentExpression", ["operator", "left", "right"]);
const NAssignmentPattern = defNode("AssignmentPattern", ["left", "right"]);
const NConditionalExpression = defNode("ConditionalExpression", ["test", "consequent", "alternate"]);
const NCallExpression = defNode("CallExpression", ["callee", "arguments", "optional"]);
const NNewExpression = defNode("NewExpression", ["callee", "arguments"]);
const NMemberExpression = defNode("MemberExpression", ["object", "property", "computed", "optional"]);
const NChainExpression = defNode("ChainExpression", ["expression"]);
const NYieldExpression = defNode("YieldExpression", ["delegate", "argument"]);
const NAwaitExpression = defNode("AwaitExpression", ["argument"]);
const NMetaProperty = defNode("MetaProperty", ["meta", "property"]);
const NImportExpression = defNode("ImportExpression", ["source", "options"]);
const NParenthesizedExpression = defNode("ParenthesizedExpression", ["expression"]);
const NImportDeclaration = defNode("ImportDeclaration", ["specifiers", "source", "attributes"]);
const NImportSpecifier = defNode("ImportSpecifier", ["imported", "local"]);
const NImportDefaultSpecifier = defNode("ImportDefaultSpecifier", ["local"]);
const NImportNamespaceSpecifier = defNode("ImportNamespaceSpecifier", ["local"]);
const NImportAttribute = defNode("ImportAttribute", ["key", "value"]);
const NExportNamedDeclaration = defNode("ExportNamedDeclaration", ["declaration", "specifiers", "source", "attributes"]);
const NExportDefaultDeclaration = defNode("ExportDefaultDeclaration", ["declaration"]);
const NExportAllDeclaration = defNode("ExportAllDeclaration", ["exported", "source", "attributes"]);
const NExportSpecifier = defNode("ExportSpecifier", ["local", "exported"]);
// acorn-jsx nodes (key order as acorn-jsx assigns them)
const NJSXIdentifier = defNode("JSXIdentifier", ["name"]);
const NJSXNamespacedName = defNode("JSXNamespacedName", ["namespace", "name"]);
const NJSXMemberExpression = defNode("JSXMemberExpression", ["object", "property"]);
const NJSXEmptyExpression = defNode("JSXEmptyExpression", []);
const NJSXExpressionContainer = defNode("JSXExpressionContainer", ["expression"]);
const NJSXSpreadAttribute = defNode("JSXSpreadAttribute", ["argument"]);
const NJSXAttribute = defNode("JSXAttribute", ["name", "value"]);
const NJSXOpeningElement = defNode("JSXOpeningElement", ["attributes", "name", "selfClosing"]);
const NJSXOpeningFragment = defNode("JSXOpeningFragment", ["attributes", "selfClosing"]);
const NJSXClosingElement = defNode("JSXClosingElement", ["name"]);
const NJSXClosingFragment = defNode("JSXClosingFragment", []);
const NJSXElement = defNode("JSXElement", ["openingElement", "closingElement", "children"]);
const NJSXFragment = defNode("JSXFragment", ["openingFragment", "closingFragment", "children"]);
// JSXText comes from acorn's parseLiteral (incl. its "raw ends with n" bigint rule)
const NJSXText = defNode("JSXText", ["value", "raw"]);
const NJSXTextBig = defNode("JSXText", ["value", "raw", "bigint"]);

// node with explicit end (finishNodeAt)
function setEnd(p, n, end, endLoc) {
  n.end = end;
  if (p.locations) n.loc.end = endLoc;
  if (p.ranges) n.range[1] = end;
  return n;
}

// acorn's copyNode: a shallow copy (loc/range objects shared)
function copyNode(p, node) {
  const c = new Node(p.nodeShim, node.start, undefined);
  for (const prop in node) c[prop] = node[prop];
  return c;
}

// acorn's own shared empty arrays (`new X` arguments, `import "x"`
// specifiers): the very same objects, as in every acorn AST
const emptyNewArguments = _emptyNewArguments;
const emptyImportSpecifiers = _emptyImportSpecifiers;

// AST lists are collected on a per-parser scratch stack (p.stk / p.sp) and
// copied into exact-size arrays: an array grown by push() keeps a 17-slot
// backing store (three times the memory of an exact 1-element array), and
// ASTs are full of small lists that all survive into the old generation.
function listFrom(p, base) {
  const st = p.stk, n = p.sp - base;
  let r;
  if (n === 0) r = [];
  else if (n === 1) r = [st[base]];
  else if (n === 2) r = [st[base], st[base + 1]];
  else if (n === 3) r = [st[base], st[base + 1], st[base + 2]];
  else r = st.slice(base, p.sp);
  p.sp = base;
  return r;
}
const loopLabel = { kind: "loop" }, switchLabel = { kind: "switch" };
const FUNC_STATEMENT = 1, FUNC_HANGING_STATEMENT = 2, FUNC_NULLABLE_ID = 4;

// regexp validation (acorn's own validator), cached per pattern+flags
const regexpOk = new Map();
let regexpParser = null;
let regexpState = null;
function validateRegExp(start, pattern, flags) {
  const key = flags + "/" + pattern;
  if (regexpOk.has(key)) return;
  if (!regexpParser) {
    regexpParser = new VParser({ ecmaVersion: "latest" }, "");
    regexpState = new RegExpValidationState(regexpParser);
  }
  try {
    regexpState.reset(start, pattern, flags);
    regexpParser.validateRegExpFlags(regexpState);
    regexpParser.validateRegExpPattern(regexpState);
  } catch (e) {
    bail();
  }
  if (regexpOk.size > 5000) regexpOk.clear();
  regexpOk.set(key, true);
}

const INVALID_TEMPLATE_ESCAPE = { invalidTemplateEscape: true };

// acorn-jsx's entity helpers
const hexNumber = /^[\da-fA-F]+$/;
const decimalNumber = /^\d+$/;
function jsxQualifiedName(object) {
  if (!object) return object;
  if (object.type === "JSXIdentifier") return object.name;
  if (object.type === "JSXNamespacedName") return object.namespace.name + ":" + object.name.name;
  if (object.type === "JSXMemberExpression") return jsxQualifiedName(object.object) + "." + jsxQualifiedName(object.property);
}

// ------------------------------------------------------------ acorn API facade
// For Parser.extend() subclasses overriding parseFunctionBody (override.mjs):
// the subclass's method runs with `this` bound to a BodyFacade, which shows
// the fast parser's state the way acorn's Parser would.

// acorn's TokenType object for each token type
const TT_OBJ = new Array(T_COUNT).fill(undefined);
{
  const names = ["num", "regexp", "string", "name", "privateId", "eof", "bracketL", "bracketR", "braceL", "braceR", "parenL", "parenR",
    "comma", "semi", "colon", "dot", "question", "questionDot", "arrow", "template", "invalidTemplate", "ellipsis", "backQuote",
    "dollarBraceL", "eq", "assign", "incDec", "prefix", "logicalOR", "logicalAND", "bitwiseOR", "bitwiseXOR", "bitwiseAND",
    "equality", "relational", "bitShift", "plusMin", "modulo", "star", "slash", "starstar", "coalesce"];
  for (let t = 0; t < names.length; t++) TT_OBJ[t] = acornTT[names[t]];
  for (let t = T_KW_FIRST; t < T_COUNT; t++) TT_OBJ[t] = acornTT["_" + KW_NAME[t]];
  for (let t = 0; t < T_COUNT; t++) if (t < T_JSXNAME || t >= T_KW_FIRST) if (!TT_OBJ[t]) throw new Error("@r1ck404/fast-acorn: token type " + t);
}

// acorn's finishNodeAt
function finishNodeAt(p, node, type, pos, loc) {
  node.type = type;
  node.end = pos;
  if (p.options.locations) node.loc.end = loc;
  if (p.options.ranges) node.range[1] = pos;
  return node;
}

export class BodyFacade {
  declare fnNode: any;
  declare p: any;
  constructor(p) {
    this.p = p;
    this.fnNode = null;
  }
  get type() {
    return TT_OBJ[this.p.type];
  }
  get value() {
    return this.p.value;
  }
  get start() {
    return this.p.start;
  }
  get end() {
    return this.p.end;
  }
  get pos() {
    return this.p.pos;
  }
  get startLoc() {
    return this.p.startLoc;
  }
  get endLoc() {
    return this.p.eloc();
  }
  get lastTokStart() {
    return this.p.lastTokStart;
  }
  get lastTokEnd() {
    return this.p.lastTokEnd;
  }
  get lastTokStartLoc() {
    return this.p.lastTokStartLoc;
  }
  get lastTokEndLoc() {
    return this.p.leloc();
  }
  next(ignoreEscapeSequenceInKeyword) {
    this.p.next(ignoreEscapeSequenceInKeyword);
  }
  startNode() {
    const p = this.p;
    return new Node(p.nodeShim, p.start, p.startLoc);
  }
  startNodeAt(pos, loc) {
    return new Node(this.p.nodeShim, pos, loc);
  }
  finishNode(node, type) {
    const p = this.p;
    return finishNodeAt(p, node, type, p.lastTokEnd, p.leloc());
  }
  finishNodeAt(node, type, pos, loc) {
    return finishNodeAt(this.p, node, type, pos, loc);
  }
  exitScope() {
    this.p.exitScope();
  }
  eat(type) {
    if (TT_OBJ[this.p.type] === type) {
      this.p.next();
      return true;
    }
    return false;
  }
  expect(type) {
    this.eat(type) || this.unexpected();
  }
  // errors: acorn produces them (re-parse)
  unexpected() {
    bail();
  }
  raise() {
    bail();
  }
  raiseRecoverable() {
    bail();
  }
  // super.parseFunctionBody(node, isArrowFunction, isMethod, forInit): acorn's
  // parseFunctionBody, i.e. the fast parser's, on the function node
  superParseFunctionBody(node, isArrowFunction, isMethod, forInit) {
    if (node !== this.fnNode) bail();
    const p = this.p;
    node.body = p.parseFunctionBody(node.params, node.id, isArrowFunction, isMethod, forInit);
    node.expression = p.fbExpression;
  }
}

// ------------------------------------------------------------ the parser

// Read-only per-configuration tables shared by all parser instances (building
// them per instance dominated the cost of tiny parses like parseExpressionAt)
const reservedWordCache = new Map();
function reservedWordSets(notAllowReserved, isModule) {
  const key = (notAllowReserved ? 2 : 0) + (isModule ? 1 : 0);
  let sets = reservedWordCache.get(key);
  if (sets === undefined) {
    const reserved = notAllowReserved ? "enum" + (isModule ? " await" : "") : "";
    const strictWords = (reserved ? reserved + " " : "") + "implements interface let package private protected public static yield";
    sets = [new Set(reserved ? reserved.split(" ") : []), new Set(strictWords.split(" ")), new Set((strictWords + " eval arguments").split(" "))];
    reservedWordCache.set(key, sets);
  }
  return sets;
}


// acorn (parseExpressionAt with locations): curLine =
// input.slice(0, lineStart).split(lineBreak).length, i.e. 1 + the number of
// lineBreak matches (CR LF, CR, LF, LS, PS) that start before lineStart. The match
// starts of the last input are kept (parseExpressionAt is typically called
// many times on one template) and extended as needed; lineStart always
// follows a "\n", so a scan never ends between the two halves of a \r\n.
let lbInput = null, lbStarts = [], lbScanned = 0;
function linesBefore(input, lineStart) {
  if (lbInput !== input) {
    lbInput = input;
    lbStarts = [];
    lbScanned = 0;
  }
  if (lbScanned < lineStart) {
    const starts = lbStarts;
    let i = lbScanned;
    for (; i < lineStart; i++) {
      const c = input.charCodeAt(i);
      if (c === 13) {
        starts.push(i);
        if (input.charCodeAt(i + 1) === 10) i++;
      } else if (c === 10 || c === 0x2028 || c === 0x2029) starts.push(i);
    }
    lbScanned = i;
  }
  const starts = lbStarts;
  let lo = 0, hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] < lineStart) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

export class FastParser {
  declare allowReservedNever: any;
  declare awaitIdentPos: any;
  declare awaitPos: any;
  declare bodyOverride: any;
  declare checkPrivateFields: any;
  declare clashNames: any;
  declare commentBuf: any;
  declare containsEsc: any;
  declare ctx: any;
  declare curLine: any;
  declare directSourceFile: any;
  declare ecma: any;
  declare end: any;
  declare endLS: any;
  declare endLine: any;
  declare endLoc: any;
  declare exactErrors: any;
  declare exprAllowed: any;
  declare facade: any;
  declare fbExpression: any;
  declare inModule: any;
  declare inTemplateElement: any;
  declare input: any;
  declare jsx: any;
  declare jsxNamespacedObjects: any;
  declare jsxNamespaces: any;
  declare labels: any;
  declare lastTokEnd: any;
  declare lastTokEndLS: any;
  declare lastTokEndLine: any;
  declare lastTokEndLoc: any;
  declare lastTokStart: any;
  declare lastTokStartLoc: any;
  declare len: any;
  declare lineStart: any;
  declare locations: any;
  declare nlBefore: any;
  declare nodeShim: any;
  declare onInsertedSemicolon: any;
  declare onTrailingComma: any;
  declare options: any;
  declare pnComputed: any;
  declare pos: any;
  declare potentialArrowAt: any;
  declare potentialArrowInForAwait: any;
  declare preserveParens: any;
  declare privateNameStack: any;
  declare ranges: any;
  declare rdeDepth: any;
  declare rdePool: any;
  declare reservedWords: any;
  declare reservedWordsStrict: any;
  declare reservedWordsStrictBind: any;
  declare scopePool: any;
  declare scopeStack: any;
  declare sourceFile: any;
  declare sp: any;
  declare start: any;
  declare startLoc: any;
  declare stk: any;
  declare strict: any;
  declare topCanAwait: any;
  declare type: any;
  declare undefinedExports: any;
  declare value: any;
  declare xtra: any;
  declare yieldPos: any;
  constructor(options, input, startPos, jsx, bodyOverride) {
    // options: already normalized by acorn's getOptions()
    // startPos: only for parseExpressionAt (acorn's Parser(options, input, startPos))
    // jsx: null, or the options of a recognised acorn-jsx plugin class
    //   ({ allowNamespaces, allowNamespacedObjects }): parse like that class
    this.options = options;
    this.jsx = jsx != null;
    this.jsxNamespaces = jsx != null && jsx.allowNamespaces === true;
    this.jsxNamespacedObjects = jsx != null && jsx.allowNamespacedObjects === true;
    // parseFunctionBody override of a recognised Parser.extend() subclass
    this.bodyOverride = bodyOverride != null ? bodyOverride : null;
    this.facade = bodyOverride != null ? new BodyFacade(this) : null;
    this.input = input;
    this.len = input.length;
    this.ecma = options.ecmaVersion;
    this.locations = !!options.locations;
    // onComment calls are buffered and delivered after a successful parse, so
    // a bail (which re-runs real acorn) never reports a comment twice
    this.commentBuf = options.onComment ? [] : null;
    // unexpected() throws acorn's "Unexpected token" SyntaxError itself (no
    // re-parse), except where acorn would have called other code first: a
    // plugin (JSX / parseFunctionBody override) or onComment callbacks
    this.exactErrors = this.commentBuf === null && jsx == null && bodyOverride == null;
    this.ranges = !!options.ranges;
    this.directSourceFile = options.directSourceFile;
    this.sourceFile = options.sourceFile;
    this.xtra = this.locations || !!this.directSourceFile || this.ranges;
    this.preserveParens = !!options.preserveParens;
    this.allowReservedNever = options.allowReserved === "never";
    this.checkPrivateFields = !!options.checkPrivateFields;
    this.onInsertedSemicolon = options.onInsertedSemicolon;
    this.onTrailingComma = options.onTrailingComma;
    // acorn's Node constructor reads parser.options; copyNode needs a shim
    this.nodeShim = { options, sourceFile: options.sourceFile };

    const rw = reservedWordSets(options.allowReserved !== true, options.sourceType === "module");
    this.reservedWords = rw[0];
    this.reservedWordsStrict = rw[1];
    this.reservedWordsStrictBind = rw[2];

    this.containsEsc = false;
    this.pos = startPos || 0;
    this.curLine = 1;
    if (startPos) {
      // (acorn: only a \n starts the line here, but all line breaks count)
      this.lineStart = input.lastIndexOf("\n", startPos - 1) + 1;
      if (this.locations) this.curLine = linesBefore(input, this.lineStart);
    } else {
      this.lineStart = 0;
    }
    this.type = T_EOF;
    this.value = null;
    this.start = this.pos;
    this.end = this.pos;
    // With locations, token *end* Positions are created lazily: endLoc /
    // lastTokEndLoc are null until something reads the latter through
    // leloc(), which creates the Position from the recorded line / line start
    // and caches it in the slot, so every reader gets the same object (as
    // with acorn's eagerly created ones). About half of them are never read.
    // (Start positions are read at many places; they stay eager.)
    this.endLine = this.lastTokEndLine = this.curLine;
    this.endLS = this.lastTokEndLS = this.lineStart;
    this.startLoc = this.endLoc = this.curPosition();
    this.lastTokStartLoc = null;
    this.lastTokEndLoc = this.locations ? null : undefined;
    this.lastTokStart = this.lastTokEnd = this.pos;
    this.nlBefore = false;
    this.ctx = [C_B_STAT];
    this.exprAllowed = true;
    this.inTemplateElement = false;
    this.pnComputed = false;
    this.rdePool = [];
    this.stk = [];
    this.sp = 0;
    this.rdeDepth = 0;
    this.fbExpression = false;
    this.clashNames = [];

    this.inModule = options.sourceType === "module";
    this.strict = this.inModule || options.strict === true || this.strictDirective(this.pos);
    this.potentialArrowAt = -1;
    this.potentialArrowInForAwait = false;
    this.yieldPos = this.awaitPos = this.awaitIdentPos = 0;
    this.labels = [];
    this.undefinedExports = Object.create(null);
    this.scopePool = [];

    if (this.pos === 0 && options.allowHashBang && this.input.charCodeAt(0) === 35 && this.input.charCodeAt(1) === 33) this.skipLineComment(2);

    this.topCanAwait = (this.inModule && this.ecma >= 13) || !!options.allowAwaitOutsideFunction;
    this.scopeStack = [];
    this.enterScope(options.sourceType === "commonjs" ? SCOPE_FUNCTION : SCOPE_TOP);
    this.privateNameStack = [];
  }

  // ------------------------------------------------------------ utilities

  curPosition() {
    if (this.locations) return new Position(this.curLine, this.pos - this.lineStart);
  }

  // the current token's end position
  eloc() {
    let o = this.endLoc;
    if (o === null) o = this.endLoc = new Position(this.endLine, this.end - this.endLS);
    return o;
  }

  leloc() {
    let o = this.lastTokEndLoc;
    if (o === null) o = this.lastTokEndLoc = new Position(this.lastTokEndLine, this.lastTokEnd - this.lastTokEndLS);
    return o;
  }

  raise() {
    bail();
  }

  // acorn: this.raise(pos != null ? pos : this.start, "Unexpected token")
  unexpected(pos?) {
    if (!this.exactErrors) bail();
    if (pos == null) pos = this.start;
    const loc = getLineInfo(this.input, pos);
    let message = "Unexpected token (" + loc.line + ":" + loc.column + ")";
    if (this.sourceFile) message += " in " + this.sourceFile;
    const err = new SyntaxError(message) as SyntaxError & { pos: number; loc: any; raisedAt: number };
    err.pos = pos;
    err.loc = loc;
    err.raisedAt = this.pos;
    exactErrors.add(err);
    errorStats.exact++;
    throw err;
  }

  // acorn's strictDirective, written as a scanner (no regexps)
  strictDirective(start) {
    const input = this.input;
    for (;;) {
      start = this.skipWS(start);
      const q = input.charCodeAt(start);
      if (q !== 34 && q !== 39) return false;
      // find the end of the string literal (\\ escapes anything, incl. newlines)
      let i = start + 1;
      for (;;) {
        if (i >= input.length) return false;
        const c = input.charCodeAt(i);
        if (c === 92) {
          i += 2;
          continue;
        }
        if (c === q) break;
        i++;
      }
      const content = input.slice(start + 1, i);
      const litEnd = i + 1;
      if (content === "use strict") {
        const after = this.skipWS(litEnd);
        const next = input.charAt(after);
        if (next === ";" || next === "}") return true;
        let nl = false;
        for (let j = litEnd; j < after; j++) {
          if (isNewLine(input.charCodeAt(j))) {
            nl = true;
            break;
          }
        }
        return nl && !(/[(`.[+\-/*%<>=,?^&]/.test(next) || (next === "!" && input.charAt(after + 1) === "="));
      }
      start = this.skipWS(litEnd);
      if (input.charCodeAt(start) === 59) start++;
    }
  }

  // acorn's skipWhiteSpace regexp: /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g
  // returns the position after whitespace and comments starting at `pos`
  skipWS(pos) {
    const input = this.input, len = input.length;
    for (;;) {
      if (pos >= len) return pos;
      const c = input.charCodeAt(pos);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12) {
        pos++;
        continue;
      }
      if (c === 47) {
        const n = input.charCodeAt(pos + 1);
        if (n === 47) {
          // \/\/.* — `.` does not match line terminators
          pos += 2;
          while (pos < len && !isNewLine(input.charCodeAt(pos))) pos++;
          continue;
        }
        if (n === 42) {
          const e = input.indexOf("*/", pos + 2);
          if (e < 0) return pos;
          pos = e + 2;
          continue;
        }
        return pos;
      }
      if (c >= 128 && isJsWhitespace(c)) {
        pos++;
        continue;
      }
      return pos;
    }
  }

  eat(type) {
    if (this.type === type) {
      this.next();
      return true;
    }
    return false;
  }

  isContextual(name) {
    return this.type === T_NAME && this.value === name && !this.containsEsc;
  }

  eatContextual(name) {
    if (!this.isContextual(name)) return false;
    this.next();
    return true;
  }

  expectContextual(name) {
    if (!this.eatContextual(name)) this.unexpected();
  }

  canInsertSemicolon() {
    return this.type === T_EOF || this.type === T_BRACER || this.nlBefore;
  }

  insertSemicolon() {
    if (this.canInsertSemicolon()) {
      if (this.onInsertedSemicolon) this.onInsertedSemicolon(this.lastTokEnd, this.leloc());
      return true;
    }
  }

  semicolon() {
    if (!this.eat(T_SEMI) && !this.insertSemicolon()) this.unexpected();
  }

  afterTrailingComma(tokType, notNext?) {
    if (this.type === tokType) {
      if (this.onTrailingComma) this.onTrailingComma(this.lastTokStart, this.lastTokStartLoc);
      if (!notNext) this.next();
      return true;
    }
  }

  expect(type) {
    if (this.type === type) this.next();
    else this.unexpected();
  }

  checkPatternErrors(rde, isAssign) {
    if (!rde) return;
    if (rde.trailingComma > -1) bail();
    const parens = isAssign ? rde.parenthesizedAssign : rde.parenthesizedBind;
    if (parens > -1) bail();
  }

  checkExpressionErrors(rde, andThrow?) {
    if (!rde) return false;
    const shorthandAssign = rde.shorthandAssign;
    const doubleProto = rde.doubleProto;
    if (!andThrow) return shorthandAssign >= 0 || doubleProto >= 0;
    if (shorthandAssign >= 0) bail();
    if (doubleProto >= 0) bail();
  }

  checkYieldAwaitInDefaultParams() {
    if (this.yieldPos && (!this.awaitPos || this.yieldPos < this.awaitPos)) bail();
    if (this.awaitPos) bail();
  }

  isSimpleAssignTarget(expr) {
    if (expr.type === "ParenthesizedExpression") return this.isSimpleAssignTarget(expr.expression);
    return expr.type === "Identifier" || expr.type === "MemberExpression";
  }

  // ------------------------------------------------------------ scope

  enterScope(flags) {
    const stack = this.scopeStack;
    const depth = stack.length;
    const parent = depth ? stack[depth - 1] : null;
    let sc = this.scopePool[depth];
    if (sc === undefined) this.scopePool[depth] = sc = new Scope(flags, parent, this.topCanAwait);
    else sc.init(flags, parent, this.topCanAwait);
    stack.push(sc);
  }

  exitScope() {
    this.scopeStack.pop();
  }

  currentScope() {
    return this.scopeStack[this.scopeStack.length - 1];
  }

  currentVarScope() {
    return this.scopeStack[this.scopeStack.length - 1].varScope;
  }

  currentThisScope() {
    return this.scopeStack[this.scopeStack.length - 1].thisScope;
  }

  get inFunction() {
    return (this.currentVarScope().flags & SCOPE_FUNCTION) > 0;
  }
  get inGenerator() {
    return (this.currentVarScope().flags & SCOPE_GENERATOR) > 0;
  }
  get inAsync() {
    return (this.currentVarScope().flags & SCOPE_ASYNC) > 0;
  }
  get canAwait() {
    return this.scopeStack[this.scopeStack.length - 1].canAwait;
  }
  get allowReturn() {
    if (this.inFunction) return true;
    if (this.options.allowReturnOutsideFunction && this.currentVarScope().flags & SCOPE_TOP) return true;
    return false;
  }
  get allowSuper() {
    return (this.currentThisScope().flags & SCOPE_SUPER) > 0 || this.options.allowSuperOutsideMethod;
  }
  get allowDirectSuper() {
    return (this.currentThisScope().flags & SCOPE_DIRECT_SUPER) > 0;
  }
  get treatFunctionsAsVar() {
    return this.treatFunctionsAsVarInScope(this.currentScope());
  }
  get allowNewDotTarget() {
    return this.scopeStack[this.scopeStack.length - 1].allowNewDotTarget;
  }
  get allowUsing() {
    const flags = this.currentScope().flags;
    if (flags & SCOPE_SWITCH) return false;
    if (!this.inModule && flags & SCOPE_TOP) return false;
    return true;
  }
  get inClassStaticBlock() {
    return (this.currentVarScope().flags & SCOPE_CLASS_STATIC_BLOCK) > 0;
  }

  treatFunctionsAsVarInScope(scope) {
    return scope.flags & SCOPE_FUNCTION || (!this.inModule && scope.flags & SCOPE_TOP);
  }

  declareName(name, bindingType) {
    let redeclared = false;
    if (bindingType === BIND_LEXICAL) {
      const scope = this.currentScope();
      redeclared = lhas(scope.lexical, name) || lhas(scope.functions, name) || lhas(scope.var, name);
      if (scope.lexical === null) scope.firstLexical = name;
      scope.lexical = ladd(scope.lexical, name);
      if (this.inModule && scope.flags & SCOPE_TOP) delete this.undefinedExports[name];
    } else if (bindingType === BIND_SIMPLE_CATCH) {
      const scope = this.currentScope();
      if (scope.lexical === null) scope.firstLexical = name;
      scope.lexical = ladd(scope.lexical, name);
    } else if (bindingType === BIND_FUNCTION) {
      const scope = this.currentScope();
      if (this.treatFunctionsAsVar) redeclared = lhas(scope.lexical, name);
      else redeclared = lhas(scope.lexical, name) || lhas(scope.var, name);
      scope.functions = ladd(scope.functions, name);
    } else {
      for (let i = this.scopeStack.length - 1; i >= 0; --i) {
        const scope = this.scopeStack[i];
        if (
          (lhas(scope.lexical, name) && !(scope.flags & SCOPE_SIMPLE_CATCH && scope.firstLexical === name)) ||
          (!this.treatFunctionsAsVarInScope(scope) && lhas(scope.functions, name))
        ) {
          redeclared = true;
          break;
        }
        scope.var = ladd(scope.var, name);
        if (this.inModule && scope.flags & SCOPE_TOP) delete this.undefinedExports[name];
        if (scope.flags & SCOPE_VAR) break;
      }
    }
    if (redeclared) bail();
  }

  checkLocalExport(id) {
    const top = this.scopeStack[0];
    if (!lhas(top.lexical, id.name) && !lhas(top.var, id.name)) this.undefinedExports[id.name] = id;
  }

  // ------------------------------------------------------------ tokenizer

  next(ignoreEscapeSequenceInKeyword?) {
    if (!ignoreEscapeSequenceInKeyword && this.type >= T_KW_FIRST && this.containsEsc) bail();
    this.lastTokEnd = this.end;
    this.lastTokStart = this.start;
    this.lastTokEndLoc = this.endLoc;
    this.lastTokStartLoc = this.startLoc;
    if (this.locations) {
      this.lastTokEndLine = this.endLine;
      this.lastTokEndLS = this.endLS;
    }
    this.nlBefore = false;
    this.nextToken();
  }

  nextToken() {
    const ctx = this.ctx;
    if (ctx.length === 0) bail();
    const input = this.input;
    let pos = this.pos;
    let code;
    const cur = ctx[ctx.length - 1];
    if (cur === C_Q_TMPL || cur === C_J_EXPR) {
      // contexts with preserveSpace: q_tmpl (override: template token) and
      // acorn-jsx's tc_expr (readToken -> jsx_readToken)
      this.start = pos;
      if (this.locations) this.startLoc = new Position(this.curLine, pos - this.lineStart);
      if (pos >= this.len) return this.finishToken(T_EOF, undefined);
      if (cur === C_Q_TMPL) return this.tryReadTemplateToken();
      return this.jsxReadToken();
    }
    code = input.charCodeAt(pos);
    if (code === 32) code = input.charCodeAt(++pos);
    if (code <= 32 || code === 47 || code >= 128) {
      this.pos = pos;
      this.skipSpace();
      pos = this.pos;
      code = input.charCodeAt(pos);
    }
    this.start = pos;
    if (this.locations) this.startLoc = new Position(this.curLine, pos - this.lineStart);
    if (pos >= this.len) {
      this.pos = pos;
      return this.finishToken(T_EOF, undefined);
    }
    if (this.jsx && (code === 60 || cur === C_J_OTAG || cur === C_J_CTAG)) {
      this.pos = pos;
      if (this.jsxReadTokenHook(code, cur)) return;
    }
    if (code < 128) {
      const t = PUNCT1[code];
      if (t >= 0) {
        this.pos = pos + 1;
        return this.finishToken(t, undefined);
      }
      this.pos = pos;
      if (ID_START[code] === 1 || code === 92) return this.readWord();
      return this.getTokenFromCode(code);
    }
    this.pos = pos;
    const full = this.fullCharCodeAt(pos);
    if (isIdentifierStart(full, true)) return this.readWord();
    return this.getTokenFromCode(full);
  }

  fullCharCodeAt(pos) {
    const code = this.input.charCodeAt(pos);
    if (code <= 0xd7ff || code >= 0xdc00) return code;
    const next = this.input.charCodeAt(pos + 1);
    return next <= 0xdbff || next >= 0xe000 ? code : (code << 10) + next - 0x35fdc00;
  }

  skipBlockComment() {
    const input = this.input;
    const start = this.pos;
    const startLoc = this.commentBuf !== null && this.locations ? new Position(this.curLine, start - this.lineStart) : undefined;
    const end = input.indexOf("*/", (this.pos += 2));
    if (end === -1) bail();
    this.pos = end + 2;
    if (this.locations || !this.nlBefore) {
      for (let i = start + 2; i < end; i++) {
        const c = input.charCodeAt(i);
        if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) {
          this.nlBefore = true;
          if (!this.locations) break;
          if (c === 13 && input.charCodeAt(i + 1) === 10) i++;
          ++this.curLine;
          this.lineStart = i + 1;
        }
      }
    }
    if (this.commentBuf !== null) {
      this.commentBuf.push(true, input.slice(start + 2, end), start, this.pos, startLoc, this.locations ? new Position(this.curLine, this.pos - this.lineStart) : undefined);
    }
  }

  skipLineComment(startSkip) {
    const input = this.input, len = this.len;
    const start = this.pos;
    let pos = this.pos + startSkip;
    let ch = input.charCodeAt(pos);
    while (pos < len && !(ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029)) ch = input.charCodeAt(++pos);
    this.pos = pos;
    if (this.commentBuf !== null) {
      const startLoc = this.locations ? new Position(this.curLine, start - this.lineStart) : undefined;
      this.commentBuf.push(false, input.slice(start + startSkip, pos), start, pos, startLoc, this.locations ? new Position(this.curLine, pos - this.lineStart) : undefined);
    }
  }

  skipSpace() {
    const input = this.input, len = this.len;
    let pos = this.pos;
    loop: while (pos < len) {
      const ch = input.charCodeAt(pos);
      switch (ch) {
        case 32:
        case 160:
          ++pos;
          break;
        case 13:
          if (input.charCodeAt(pos + 1) === 10) ++pos;
        // falls through
        case 10:
        case 8232:
        case 8233:
          ++pos;
          this.nlBefore = true;
          if (this.locations) {
            ++this.curLine;
            this.lineStart = pos;
          }
          break;
        case 47:
          switch (input.charCodeAt(pos + 1)) {
            case 42:
              this.pos = pos;
              this.skipBlockComment();
              pos = this.pos;
              break;
            case 47:
              this.pos = pos;
              this.skipLineComment(2);
              pos = this.pos;
              break;
            default:
              break loop;
          }
          break;
        default:
          if ((ch > 8 && ch < 14) || (ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch)))) {
            ++pos;
          } else {
            break loop;
          }
      }
    }
    this.pos = pos;
  }

  finishToken(type, val) {
    this.end = this.pos;
    if (this.locations) {
      this.endLoc = null;
      this.endLine = this.curLine;
      this.endLS = this.lineStart;
    }
    const prevType = this.type;
    this.type = type;
    this.value = val;
    this.updateContext(prevType);
  }

  // ---- token contexts (acorn's context.js)

  curContext() {
    return this.ctx[this.ctx.length - 1];
  }

  braceIsBlock(prevType) {
    const parent = this.curContext();
    if (parent === C_F_EXPR || parent === C_F_STAT) return true;
    if (prevType === T_COLON && (parent === C_B_STAT || parent === C_B_EXPR)) return !CTX_IS_EXPR[parent];
    if (prevType === T_RETURN || (prevType === T_NAME && this.exprAllowed)) return this.nlBefore;
    if (prevType === T_ELSE || prevType === T_SEMI || prevType === T_EOF || prevType === T_PARENR || prevType === T_ARROW) return true;
    if (prevType === T_BRACEL) return parent === C_B_STAT;
    if (prevType === T_VAR || prevType === T_CONST || prevType === T_NAME) return false;
    return !this.exprAllowed;
  }

  inGeneratorContext() {
    const ctx = this.ctx;
    for (let i = ctx.length - 1; i >= 1; i--) {
      const c = ctx[i];
      if (CTX_IS_FUNC[c]) return CTX_IS_GEN[c];
    }
    return false;
  }

  updateContext(prevType) {
    const type = this.type;
    if (this.jsx) {
      // acorn-jsx's updateContext override
      if (type === T_BRACEL) {
        const ctx = this.ctx;
        const cur = ctx[ctx.length - 1];
        if (cur === C_J_OTAG) ctx.push(C_B_EXPR);
        else if (cur === C_J_EXPR) ctx.push(C_B_TMPL);
        else ctx.push(this.braceIsBlock(prevType) ? C_B_STAT : C_B_EXPR);
        this.exprAllowed = true;
        return;
      }
      if (type === T_SLASH && prevType === T_JSXTAGSTART) {
        const ctx = this.ctx;
        ctx.length -= 2;
        ctx.push(C_J_CTAG);
        this.exprAllowed = false;
        return;
      }
    }
    if (type >= T_KW_FIRST && prevType === T_DOT) {
      this.exprAllowed = false;
      return;
    }
    const ctx = this.ctx;
    switch (type) {
      case T_PARENR:
      case T_BRACER: {
        if (ctx.length === 1) {
          this.exprAllowed = true;
          return;
        }
        let out = ctx.pop();
        if (out === C_B_STAT && CTX_IS_FUNC[ctx[ctx.length - 1]]) out = ctx.pop();
        this.exprAllowed = !CTX_IS_EXPR[out];
        return;
      }
      case T_BRACEL:
        ctx.push(this.braceIsBlock(prevType) ? C_B_STAT : C_B_EXPR);
        this.exprAllowed = true;
        return;
      case T_DOLLARBRACEL:
        ctx.push(C_B_TMPL);
        this.exprAllowed = true;
        return;
      case T_PARENL:
        ctx.push(prevType === T_IF || prevType === T_FOR || prevType === T_WITH || prevType === T_WHILE ? C_P_STAT : C_P_EXPR);
        this.exprAllowed = true;
        return;
      case T_INCDEC:
        return;
      case T_FUNCTION:
      case T_CLASS:
        if (
          TF[prevType] & F_BEFORE &&
          prevType !== T_ELSE &&
          !(prevType === T_SEMI && ctx[ctx.length - 1] !== C_P_STAT) &&
          !(prevType === T_RETURN && this.nlBefore) &&
          !((prevType === T_COLON || prevType === T_BRACEL) && ctx[ctx.length - 1] === C_B_STAT)
        )
          ctx.push(C_F_EXPR);
        else ctx.push(C_F_STAT);
        this.exprAllowed = false;
        return;
      case T_COLON:
        if (CTX_IS_FUNC[ctx[ctx.length - 1]]) ctx.pop();
        this.exprAllowed = true;
        return;
      case T_BACKQUOTE:
        if (ctx[ctx.length - 1] === C_Q_TMPL) ctx.pop();
        else ctx.push(C_Q_TMPL);
        this.exprAllowed = false;
        return;
      case T_STAR:
        if (prevType === T_FUNCTION) {
          const index = ctx.length - 1;
          ctx[index] = ctx[index] === C_F_EXPR ? C_F_EXPR_GEN : C_F_GEN;
        }
        this.exprAllowed = true;
        return;
      case T_NAME: {
        let allowed = false;
        if (prevType !== T_DOT) {
          const v = this.value;
          if ((v === "of" && !this.exprAllowed) || (v === "yield" && this.inGeneratorContext())) allowed = true;
        }
        this.exprAllowed = allowed;
        return;
      }
      case T_JSXTAGSTART:
        // acorn-jsx: tokTypes.jsxTagStart.updateContext
        ctx.push(C_J_EXPR);
        ctx.push(C_J_OTAG);
        this.exprAllowed = false;
        return;
      case T_JSXTAGEND: {
        // acorn-jsx: tokTypes.jsxTagEnd.updateContext
        const out = ctx.pop();
        if ((out === C_J_OTAG && prevType === T_SLASH) || out === C_J_CTAG) {
          ctx.pop();
          this.exprAllowed = ctx[ctx.length - 1] === C_J_EXPR;
        } else {
          this.exprAllowed = true;
        }
        return;
      }
      default:
        this.exprAllowed = (TF[type] & F_BEFORE) !== 0;
    }
  }

  overrideContext(tokenCtx) {
    const ctx = this.ctx;
    if (ctx[ctx.length - 1] !== tokenCtx) ctx[ctx.length - 1] = tokenCtx;
  }

  // ---- token readers

  readToken_dot() {
    const next = this.input.charCodeAt(this.pos + 1);
    if (next >= 48 && next <= 57) return this.readNumber(true);
    const next2 = this.input.charCodeAt(this.pos + 2);
    if (next === 46 && next2 === 46) {
      this.pos += 3;
      return this.finishToken(T_ELLIPSIS, undefined);
    }
    ++this.pos;
    return this.finishToken(T_DOT, undefined);
  }

  readToken_slash() {
    const next = this.input.charCodeAt(this.pos + 1);
    if (this.exprAllowed) {
      ++this.pos;
      return this.readRegexp();
    }
    if (next === 61) return this.finishOp(T_ASSIGN, 2);
    return this.finishOp(T_SLASH, 1);
  }

  readToken_mult_modulo_exp(code) {
    let next = this.input.charCodeAt(this.pos + 1);
    let size = 1;
    let tokentype = code === 42 ? T_STAR : T_MODULO;
    if (code === 42 && next === 42) {
      ++size;
      tokentype = T_STARSTAR;
      next = this.input.charCodeAt(this.pos + 2);
    }
    if (next === 61) return this.finishOp(T_ASSIGN, size + 1);
    return this.finishOp(tokentype, size);
  }

  readToken_pipe_amp(code) {
    const next = this.input.charCodeAt(this.pos + 1);
    if (next === code) {
      const next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 === 61) return this.finishOp(T_ASSIGN, 3);
      return this.finishOp(code === 124 ? T_LOGICALOR : T_LOGICALAND, 2);
    }
    if (next === 61) return this.finishOp(T_ASSIGN, 2);
    return this.finishOp(code === 124 ? T_BITWISEOR : T_BITWISEAND, 1);
  }

  readToken_caret() {
    const next = this.input.charCodeAt(this.pos + 1);
    if (next === 61) return this.finishOp(T_ASSIGN, 2);
    return this.finishOp(T_BITWISEXOR, 1);
  }

  readToken_plus_min(code) {
    const next = this.input.charCodeAt(this.pos + 1);
    if (next === code) {
      if (next === 45 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 62 && (this.lastTokEnd === 0 || this.nlBefore)) {
        this.skipLineComment(3);
        this.skipSpace();
        return this.nextToken();
      }
      return this.finishOp(T_INCDEC, 2);
    }
    if (next === 61) return this.finishOp(T_ASSIGN, 2);
    return this.finishOp(T_PLUSMIN, 1);
  }

  readToken_lt_gt(code) {
    const input = this.input;
    const next = input.charCodeAt(this.pos + 1);
    let size = 1;
    if (next === code) {
      size = code === 62 && input.charCodeAt(this.pos + 2) === 62 ? 3 : 2;
      if (input.charCodeAt(this.pos + size) === 61) return this.finishOp(T_ASSIGN, size + 1);
      return this.finishOp(T_BITSHIFT, size);
    }
    if (next === 33 && code === 60 && !this.inModule && input.charCodeAt(this.pos + 2) === 45 && input.charCodeAt(this.pos + 3) === 45) {
      this.skipLineComment(4);
      this.skipSpace();
      return this.nextToken();
    }
    if (next === 61) size = 2;
    return this.finishOp(T_RELATIONAL, size);
  }

  readToken_eq_excl(code) {
    const next = this.input.charCodeAt(this.pos + 1);
    if (next === 61) return this.finishOp(T_EQUALITY, this.input.charCodeAt(this.pos + 2) === 61 ? 3 : 2);
    if (code === 61 && next === 62) {
      this.pos += 2;
      return this.finishToken(T_ARROW, undefined);
    }
    return this.finishOp(code === 61 ? T_EQ : T_PREFIX, 1);
  }

  readToken_question() {
    const next = this.input.charCodeAt(this.pos + 1);
    if (next === 46) {
      const next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 < 48 || next2 > 57) return this.finishOp(T_QUESTIONDOT, 2);
    }
    if (next === 63) {
      const next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 === 61) return this.finishOp(T_ASSIGN, 3);
      return this.finishOp(T_COALESCE, 2);
    }
    return this.finishOp(T_QUESTION, 1);
  }

  readToken_numberSign() {
    ++this.pos;
    const code = this.fullCharCodeAt(this.pos);
    if (isIdentifierStart(code, true) || code === 92) return this.finishToken(T_PRIVATEID, this.readWord1());
    bail();
  }

  getTokenFromCode(code) {
    switch (code) {
      case 46:
        return this.readToken_dot();
      case 40:
        ++this.pos;
        return this.finishToken(T_PARENL, undefined);
      case 41:
        ++this.pos;
        return this.finishToken(T_PARENR, undefined);
      case 59:
        ++this.pos;
        return this.finishToken(T_SEMI, undefined);
      case 44:
        ++this.pos;
        return this.finishToken(T_COMMA, undefined);
      case 91:
        ++this.pos;
        return this.finishToken(T_BRACKETL, undefined);
      case 93:
        ++this.pos;
        return this.finishToken(T_BRACKETR, undefined);
      case 123:
        ++this.pos;
        return this.finishToken(T_BRACEL, undefined);
      case 125:
        ++this.pos;
        return this.finishToken(T_BRACER, undefined);
      case 58:
        ++this.pos;
        return this.finishToken(T_COLON, undefined);
      case 96:
        ++this.pos;
        return this.finishToken(T_BACKQUOTE, undefined);
      case 48: {
        const next = this.input.charCodeAt(this.pos + 1);
        if (next === 120 || next === 88) return this.readRadixNumber(16);
        if (next === 111 || next === 79) return this.readRadixNumber(8);
        if (next === 98 || next === 66) return this.readRadixNumber(2);
      }
      // falls through
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        return this.readNumber(false);
      case 34:
      case 39:
        return this.readString(code);
      case 47:
        return this.readToken_slash();
      case 37:
      case 42:
        return this.readToken_mult_modulo_exp(code);
      case 124:
      case 38:
        return this.readToken_pipe_amp(code);
      case 94:
        return this.readToken_caret();
      case 43:
      case 45:
        return this.readToken_plus_min(code);
      case 60:
      case 62:
        return this.readToken_lt_gt(code);
      case 61:
      case 33:
        return this.readToken_eq_excl(code);
      case 63:
        return this.readToken_question();
      case 126:
        return this.finishOp(T_PREFIX, 1);
      case 35:
        return this.readToken_numberSign();
    }
    bail();
  }

  finishOp(type, size) {
    const input = this.input, pos = this.pos;
    let str;
    if (size === 1) str = OP1[input.charCodeAt(pos)];
    else if (size === 2) str = OP2.get((input.charCodeAt(pos) << 8) | input.charCodeAt(pos + 1));
    if (str === undefined) str = input.slice(pos, pos + size);
    this.pos = pos + size;
    return this.finishToken(type, str);
  }

  readRegexp() {
    const input = this.input;
    let escaped = false, inClass = false;
    const start = this.pos;
    for (;;) {
      if (this.pos >= this.len) bail();
      const ch = input.charCodeAt(this.pos);
      if (ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029) bail();
      if (!escaped) {
        if (ch === 91) inClass = true;
        else if (ch === 93 && inClass) inClass = false;
        else if (ch === 47 && !inClass) break;
        escaped = ch === 92;
      } else escaped = false;
      ++this.pos;
    }
    const pattern = input.slice(start, this.pos);
    ++this.pos;
    const flags = this.readWord1();
    if (this.containsEsc) bail();
    validateRegExp(start, pattern, flags);
    let value = null;
    try {
      value = new RegExp(pattern, flags);
    } catch (e) {}
    return this.finishToken(T_REGEXP, { pattern, flags, value });
  }

  readInt(radix, len?, maybeLegacyOctalNumericLiteral?) {
    const input = this.input;
    const allowSeparators = len === undefined;
    const isLegacyOctalNumericLiteral = maybeLegacyOctalNumericLiteral && input.charCodeAt(this.pos) === 48;
    const start = this.pos;
    let total = 0, lastCode = 0;
    for (let i = 0, e = len == null ? Infinity : len; i < e; ++i, ++this.pos) {
      const code = input.charCodeAt(this.pos);
      let val;
      if (allowSeparators && code === 95) {
        if (isLegacyOctalNumericLiteral) bail();
        if (lastCode === 95) bail();
        if (i === 0) bail();
        lastCode = code;
        continue;
      }
      if (code >= 97) val = code - 97 + 10;
      else if (code >= 65) val = code - 65 + 10;
      else if (code >= 48 && code <= 57) val = code - 48;
      else val = Infinity;
      if (val >= radix) break;
      lastCode = code;
      total = total * radix + val;
    }
    if (allowSeparators && lastCode === 95) bail();
    if (this.pos === start || (len != null && this.pos - start !== len)) return null;
    return total;
  }

  readRadixNumber(radix) {
    const start = this.pos;
    this.pos += 2;
    let val: number | bigint = this.readInt(radix);
    if (val == null) bail();
    if (this.input.charCodeAt(this.pos) === 110) {
      val = stringToBigInt(this.input.slice(start, this.pos));
      ++this.pos;
    } else if (isIdentifierStart(this.fullCharCodeAt(this.pos))) bail();
    return this.finishToken(T_NUM, val);
  }

  readNumber(startsWithDot) {
    const input = this.input;
    const start = this.pos;
    // fast path: plain decimal integer (no separators, fraction, exponent)
    if (!startsWithDot) {
      let p = start, v = 0;
      let c = input.charCodeAt(p);
      if (c !== 48 || !((c = input.charCodeAt(p + 1)) >= 48 && c <= 57) ) {
        p = start;
        while ((c = input.charCodeAt(p)) >= 48 && c <= 57) {
          v = v * 10 + (c - 48);
          p++;
        }
        if (p - start <= 15 && c !== 46 && c !== 101 && c !== 69 && c !== 95 && c !== 110 && !(c < 128 ? ID_START[c] === 1 || c === 92 : true)) {
          this.pos = p;
          return this.finishToken(T_NUM, v);
        }
      }
    }
    if (!startsWithDot && this.readInt(10, undefined, true) === null) bail();
    let octal = this.pos - start >= 2 && input.charCodeAt(start) === 48;
    if (octal && this.strict) bail();
    let next = input.charCodeAt(this.pos);
    if (!octal && !startsWithDot && next === 110) {
      const val = stringToBigInt(input.slice(start, this.pos));
      ++this.pos;
      if (isIdentifierStart(this.fullCharCodeAt(this.pos))) bail();
      return this.finishToken(T_NUM, val);
    }
    if (octal && /[89]/.test(input.slice(start, this.pos))) octal = false;
    if (next === 46 && !octal) {
      ++this.pos;
      this.readInt(10);
      next = input.charCodeAt(this.pos);
    }
    if ((next === 69 || next === 101) && !octal) {
      next = input.charCodeAt(++this.pos);
      if (next === 43 || next === 45) ++this.pos;
      if (this.readInt(10) === null) bail();
    }
    if (isIdentifierStart(this.fullCharCodeAt(this.pos))) bail();
    const val = stringToNumber(input.slice(start, this.pos), octal);
    return this.finishToken(T_NUM, val);
  }

  readCodePoint() {
    const ch = this.input.charCodeAt(this.pos);
    let code;
    if (ch === 123) {
      const codePos = ++this.pos;
      code = this.readHexChar(this.input.indexOf("}", this.pos) - this.pos);
      ++this.pos;
      if (code > 0x10ffff) this.invalidStringToken(codePos);
    } else {
      code = this.readHexChar(4);
    }
    return code;
  }

  readString(quote) {
    const input = this.input, len = this.len;
    // fast path: no escapes, no line terminators
    let p = this.pos + 1;
    for (;;) {
      if (p >= len) break;
      const ch = input.charCodeAt(p);
      if (ch === quote) {
        const out = input.slice(this.pos + 1, p);
        this.pos = p + 1;
        return this.finishToken(T_STRING, out);
      }
      if (ch === 92 || ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029) break;
      p++;
    }
    let out = "", chunkStart = ++this.pos;
    for (;;) {
      if (this.pos >= len) bail();
      const ch = input.charCodeAt(this.pos);
      if (ch === quote) break;
      if (ch === 92) {
        out += input.slice(chunkStart, this.pos);
        out += this.readEscapedChar(false);
        chunkStart = this.pos;
      } else if (ch === 0x2028 || ch === 0x2029) {
        ++this.pos;
        if (this.locations) {
          this.curLine++;
          this.lineStart = this.pos;
        }
      } else {
        if (isNewLine(ch)) bail();
        ++this.pos;
      }
    }
    out += input.slice(chunkStart, this.pos++);
    return this.finishToken(T_STRING, out);
  }

  tryReadTemplateToken() {
    this.inTemplateElement = true;
    try {
      this.readTmplToken();
    } catch (err) {
      if (err === INVALID_TEMPLATE_ESCAPE) this.readInvalidTemplateToken();
      else throw err;
    }
    this.inTemplateElement = false;
  }

  invalidStringToken(position) {
    if (this.inTemplateElement) throw INVALID_TEMPLATE_ESCAPE;
    bail();
  }

  readTmplToken() {
    const input = this.input;
    let out = "", chunkStart = this.pos;
    for (;;) {
      if (this.pos >= this.len) bail();
      const ch = input.charCodeAt(this.pos);
      if (ch === 96 || (ch === 36 && input.charCodeAt(this.pos + 1) === 123)) {
        if (this.pos === this.start && (this.type === T_TEMPLATE || this.type === T_INVALIDTEMPLATE)) {
          if (ch === 36) {
            this.pos += 2;
            return this.finishToken(T_DOLLARBRACEL, undefined);
          }
          ++this.pos;
          return this.finishToken(T_BACKQUOTE, undefined);
        }
        out += input.slice(chunkStart, this.pos);
        return this.finishToken(T_TEMPLATE, out);
      }
      if (ch === 92) {
        out += input.slice(chunkStart, this.pos);
        out += this.readEscapedChar(true);
        chunkStart = this.pos;
      } else if (isNewLine(ch)) {
        out += input.slice(chunkStart, this.pos);
        ++this.pos;
        switch (ch) {
          case 13:
            if (input.charCodeAt(this.pos) === 10) ++this.pos;
          // falls through
          case 10:
            out += "\n";
            break;
          default:
            out += String.fromCharCode(ch);
            break;
        }
        if (this.locations) {
          ++this.curLine;
          this.lineStart = this.pos;
        }
        chunkStart = this.pos;
      } else {
        ++this.pos;
      }
    }
  }

  readInvalidTemplateToken() {
    const input = this.input;
    for (; this.pos < this.len; this.pos++) {
      switch (input[this.pos]) {
        case "\\":
          ++this.pos;
          break;
        case "$":
          if (input[this.pos + 1] !== "{") break;
        // falls through
        case "`":
          return this.finishToken(T_INVALIDTEMPLATE, input.slice(this.start, this.pos));
        case "\r":
          if (input[this.pos + 1] === "\n") ++this.pos;
        // falls through
        case "\n":
        case " ":
        case " ":
          ++this.curLine;
          this.lineStart = this.pos + 1;
          break;
      }
    }
    bail();
  }

  readEscapedChar(inTemplate) {
    const input = this.input;
    let ch = input.charCodeAt(++this.pos);
    ++this.pos;
    switch (ch) {
      case 110:
        return "\n";
      case 114:
        return "\r";
      case 120:
        return String.fromCharCode(this.readHexChar(2));
      case 117:
        return codePointToString(this.readCodePoint());
      case 116:
        return "\t";
      case 98:
        return "\b";
      case 118:
        return "\u000b";
      case 102:
        return "\f";
      case 13:
        if (input.charCodeAt(this.pos) === 10) ++this.pos;
      // falls through
      case 10:
        if (this.locations) {
          this.lineStart = this.pos;
          ++this.curLine;
        }
        return "";
      case 56:
      case 57:
        if (this.strict) this.invalidStringToken(this.pos - 1);
        if (inTemplate) this.invalidStringToken(this.pos - 1);
      // falls through
      default:
        if (ch >= 48 && ch <= 55) {
          let octalStr = input.substr(this.pos - 1, 3).match(/^[0-7]+/)[0];
          let octal = parseInt(octalStr, 8);
          if (octal > 255) {
            octalStr = octalStr.slice(0, -1);
            octal = parseInt(octalStr, 8);
          }
          this.pos += octalStr.length - 1;
          ch = input.charCodeAt(this.pos);
          if ((octalStr !== "0" || ch === 56 || ch === 57) && (this.strict || inTemplate)) this.invalidStringToken(this.pos - 1 - octalStr.length);
          return String.fromCharCode(octal);
        }
        if (isNewLine(ch)) {
          if (this.locations) {
            this.lineStart = this.pos;
            ++this.curLine;
          }
          return "";
        }
        return String.fromCharCode(ch);
    }
  }

  readHexChar(len) {
    const codePos = this.pos;
    const n = this.readInt(16, len);
    if (n === null) this.invalidStringToken(codePos);
    return n;
  }

  // acorn's readWord1 (escapes, astral identifiers)
  readWord1() {
    this.containsEsc = false;
    const input = this.input;
    let word = "", first = true, chunkStart = this.pos;
    while (this.pos < this.len) {
      const ch = this.fullCharCodeAt(this.pos);
      if (ch < 128 ? ID_CHAR[ch] === 1 : isIdentifierChar(ch, true)) {
        this.pos += ch <= 0xffff ? 1 : 2;
      } else if (ch === 92) {
        this.containsEsc = true;
        word += input.slice(chunkStart, this.pos);
        const escStart = this.pos;
        if (input.charCodeAt(++this.pos) !== 117) this.invalidStringToken(this.pos);
        ++this.pos;
        const esc = this.readCodePoint();
        if (!(first ? isIdentifierStart : isIdentifierChar)(esc, true)) this.invalidStringToken(escStart);
        word += codePointToString(esc);
        chunkStart = this.pos;
      } else {
        break;
      }
      first = false;
    }
    return word + input.slice(chunkStart, this.pos);
  }

  readWord() {
    const input = this.input, len = this.len;
    const start = this.pos;
    let p = start, c = 0, h = 0;
    while (p < len && (c = input.charCodeAt(p)) < 128 && ID_CHAR[c] === 1) p++;
    if (p < len && (c >= 128 || c === 92)) {
      // escapes / non-ASCII: acorn's exact slow path
      const word = this.readWord1();
      const k = word.length >= 2 && word.length <= 10 ? KEYWORDS.get(word) : undefined;
      return this.finishToken(k !== undefined ? k : T_NAME, word);
    }
    this.containsEsc = false;
    this.pos = p;
    const n = p - start;
    if (n >= 2 && n <= 10) {
      const c0 = input.charCodeAt(start);
      const c1 = input.charCodeAt(start + 1);
      if (c0 >= 97 && c0 <= 121 && c1 < 128) {
        const k = KW_SHAPE[shapeIndex(n, c0, c1)];
        if (k >= 0) {
          const kw = KW_NAME[k];
          let i = 2;
          while (i < n && input.charCodeAt(start + i) === kw.charCodeAt(i)) i++;
          if (i === n) return this.finishToken(k, kw);
        }
      }
    }
    // finishToken + updateContext for a plain name token
    this.end = p;
    if (this.locations) {
      this.endLoc = null;
      this.endLine = this.curLine;
      this.endLS = this.lineStart;
    }
    const prevType = this.type;
    this.type = T_NAME;
    const v = (this.value = input.slice(start, p));
    let allowed = false;
    if (prevType !== T_DOT && ((n === 2 && v === "of" && !this.exprAllowed) || (n === 5 && v === "yield" && this.inGeneratorContext()))) allowed = true;
    this.exprAllowed = allowed;
  }

  // ------------------------------------------------------------ acorn-jsx tokens

  // acorn-jsx's readToken(code) override, before acorn's own readToken
  // (contexts other than tc_expr): returns true when it read a token
  jsxReadTokenHook(code, cur) {
    if (cur === C_J_OTAG || cur === C_J_CTAG) {
      // (non-ASCII here: an astral or non-ASCII tag name, or an error)
      if (code >= 128) bail();
      if (ID_START[code] === 1) {
        this.jsxReadWord();
        return true;
      }
      if (code === 62) {
        ++this.pos;
        this.finishToken(T_JSXTAGEND, undefined);
        return true;
      }
      if ((code === 34 || code === 39) && cur === C_J_OTAG) {
        this.jsxReadString(code);
        return true;
      }
    }
    if (code === 60 && this.exprAllowed && this.input.charCodeAt(this.pos + 1) !== 33) {
      ++this.pos;
      this.finishToken(T_JSXTAGSTART, undefined);
      return true;
    }
    return false;
  }

  // jsx_readToken: JSX text (children)
  jsxReadToken() {
    const input = this.input, len = this.len;
    let out = "", chunkStart = this.pos;
    for (;;) {
      if (this.pos >= len) bail();
      const ch = input.charCodeAt(this.pos);
      switch (ch) {
        case 60:
        case 123:
          if (this.pos === this.start) {
            if (ch === 60 && this.exprAllowed) {
              ++this.pos;
              return this.finishToken(T_JSXTAGSTART, undefined);
            }
            return this.getTokenFromCode(ch);
          }
          out += input.slice(chunkStart, this.pos);
          return this.finishToken(T_JSXTEXT, out);
        case 38:
          out += input.slice(chunkStart, this.pos);
          out += this.jsxReadEntity();
          chunkStart = this.pos;
          break;
        case 62:
        case 125:
          bail();
        // falls through (unreachable)
        default:
          if (ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029) {
            out += input.slice(chunkStart, this.pos);
            out += this.jsxReadNewLine(true);
            chunkStart = this.pos;
          } else {
            ++this.pos;
          }
      }
    }
  }

  jsxReadNewLine(normalizeCRLF) {
    const input = this.input;
    const ch = input.charCodeAt(this.pos);
    let out;
    ++this.pos;
    if (ch === 13 && input.charCodeAt(this.pos) === 10) {
      ++this.pos;
      out = normalizeCRLF ? "\n" : "\r\n";
    } else {
      out = String.fromCharCode(ch);
    }
    if (this.locations) {
      ++this.curLine;
      this.lineStart = this.pos;
    }
    return out;
  }

  jsxReadString(quote) {
    const input = this.input, len = this.len;
    let out = "", chunkStart = ++this.pos;
    for (;;) {
      if (this.pos >= len) bail();
      const ch = input.charCodeAt(this.pos);
      if (ch === quote) break;
      if (ch === 38) {
        out += input.slice(chunkStart, this.pos);
        out += this.jsxReadEntity();
        chunkStart = this.pos;
      } else if (ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029) {
        out += input.slice(chunkStart, this.pos);
        out += this.jsxReadNewLine(false);
        chunkStart = this.pos;
      } else {
        ++this.pos;
      }
    }
    out += input.slice(chunkStart, this.pos++);
    return this.finishToken(T_STRING, out);
  }

  // jsx_readEntity, verbatim (string indexing, the plain-object entity table
  // and String.fromCharCode's truncation included)
  jsxReadEntity() {
    const input = this.input;
    let str = "", count = 0, entity;
    let ch = input[this.pos];
    if (ch !== "&") bail();
    const startPos = ++this.pos;
    while (this.pos < input.length && count++ < 10) {
      ch = input[this.pos++];
      if (ch === ";") {
        if (str[0] === "#") {
          if (str[1] === "x") {
            str = str.substr(2);
            if (hexNumber.test(str)) entity = String.fromCharCode(parseInt(str, 16));
          } else {
            str = str.substr(1);
            if (decimalNumber.test(str)) entity = String.fromCharCode(parseInt(str, 10));
          }
        } else {
          entity = XHTMLEntities[str];
        }
        break;
      }
      str += ch;
    }
    if (!entity) {
      this.pos = startPos;
      return "&";
    }
    return entity;
  }

  // jsx_readWord (the first character is an ASCII identifier start)
  jsxReadWord() {
    const input = this.input;
    const start = this.pos;
    let ch;
    do {
      ch = input.charCodeAt(++this.pos);
    } while (ch < 128 ? ID_CHAR[ch] === 1 || ch === 45 : isIdentifierChar(ch));
    return this.finishToken(T_JSXNAME, input.slice(start, this.pos));
  }

  // ------------------------------------------------------------ statements

  parseTopLevel(s, sl) {
    const exports = Object.create(null);
    const base = this.sp;
    while (this.type !== T_EOF) {
      const st = this.parseStatement(null, true, exports);
      this.stk[this.sp++] = st;
    }
    const body = listFrom(this, base);
    if (this.inModule) {
      for (const name in this.undefinedExports) bail();
    }
    this.adaptDirectivePrologue(body);
    this.next();
    const sourceType = this.options.sourceType === "commonjs" ? "script" : this.options.sourceType;
    return new NProgram(this, s, sl, body, sourceType);
  }

  isLet(context?) {
    if (!this.isContextual("let")) return false;
    const input = this.input;
    let next = this.skipWS(this.pos);
    let nextCh = this.fullCharCodeAt(next);
    if (nextCh === 91 || nextCh === 92) return true;
    if (context) return false;
    if (nextCh === 123) return true;
    if (isIdentifierStart(nextCh, true)) {
      const start = next;
      do next += nextCh <= 0xffff ? 1 : 2;
      while (isIdentifierChar((nextCh = this.fullCharCodeAt(next)), true));
      if (nextCh === 92) return true;
      const ident = input.slice(start, next);
      if (ident !== "in" && ident !== "instanceof") return true;
    }
    return false;
  }

  isAsyncFunction() {
    if (!this.isContextual("async")) return false;
    const input = this.input;
    const next = this.skipWS(this.pos);
    for (let i = this.pos; i < next; i++) if (isNewLine(input.charCodeAt(i))) return false;
    let after;
    return (
      input.slice(next, next + 8) === "function" &&
      (next + 8 === input.length || !(isIdentifierChar((after = this.fullCharCodeAt(next + 8)), true) || after === 92))
    );
  }

  isUsingKeyword(isAwaitUsing, isFor) {
    if (this.ecma < 17 || !this.isContextual(isAwaitUsing ? "await" : "using")) return false;
    const input = this.input;
    let next = this.skipWS(this.pos);
    for (let i = this.pos; i < next; i++) if (isNewLine(input.charCodeAt(i))) return false;
    if (isAwaitUsing) {
      const usingEndPos = next + 5;
      let after;
      if (
        input.slice(next, usingEndPos) !== "using" ||
        usingEndPos === input.length ||
        isIdentifierChar((after = this.fullCharCodeAt(usingEndPos)), true) ||
        after === 92
      )
        return false;
      next = this.skipWS(usingEndPos);
      for (let i = usingEndPos; i < next; i++) if (isNewLine(input.charCodeAt(i))) return false;
    }
    let ch = this.fullCharCodeAt(next);
    if (!isIdentifierStart(ch, true) && ch !== 92) return false;
    const idStart = next;
    do next += ch <= 0xffff ? 1 : 2;
    while (isIdentifierChar((ch = this.fullCharCodeAt(next)), true));
    if (ch === 92) return true;
    const id = input.slice(idStart, next);
    if (id === "in" || id === "instanceof") return false;
    if (isFor && !isAwaitUsing && id === "of") {
      next = this.skipWS(next);
      if (input.charCodeAt(next) !== 61 || (ch = input.charCodeAt(next + 1)) === 61 || ch === 62) return false;
    }
    return true;
  }

  isAwaitUsing(isFor) {
    return this.isUsingKeyword(true, isFor);
  }

  isUsing(isFor) {
    return this.isUsingKeyword(false, isFor);
  }

  parseStatement(context, topLevel?, exports?) {
    let starttype = this.type, kind;
    const s = this.start, sl = this.startLoc;
    if (starttype === T_NAME && this.isLet(context)) {
      starttype = T_VAR;
      kind = "let";
    }
    switch (starttype) {
      case T_BREAK:
      case T_CONTINUE:
        return this.parseBreakContinueStatement(s, sl, starttype === T_BREAK);
      case T_DEBUGGER:
        this.next();
        this.semicolon();
        return new NDebuggerStatement(this, s, sl);
      case T_DO:
        return this.parseDoStatement(s, sl);
      case T_FOR:
        return this.parseForStatement(s, sl);
      case T_FUNCTION:
        if (context && (this.strict || (context !== "if" && context !== "label"))) this.unexpected();
        return this.parseFunctionStatement(s, sl, false, !context);
      case T_CLASS:
        if (context) this.unexpected();
        return this.parseClass(s, sl, true);
      case T_IF:
        return this.parseIfStatement(s, sl);
      case T_RETURN:
        return this.parseReturnStatement(s, sl);
      case T_SWITCH:
        return this.parseSwitchStatement(s, sl);
      case T_THROW:
        return this.parseThrowStatement(s, sl);
      case T_TRY:
        return this.parseTryStatement(s, sl);
      case T_CONST:
      case T_VAR:
        kind = kind || this.value;
        if (context && kind !== "var") this.unexpected();
        return this.parseVarStatement(s, sl, kind);
      case T_WHILE:
        return this.parseWhileStatement(s, sl);
      case T_WITH:
        return this.parseWithStatement(s, sl);
      case T_BRACEL:
        return this.parseBlock(true, s, sl);
      case T_SEMI:
        this.next();
        return new NEmptyStatement(this, s, sl);
      case T_EXPORT:
      case T_IMPORT: {
        if (starttype === T_IMPORT) {
          const next = this.skipWS(this.pos);
          const nextCh = this.input.charCodeAt(next);
          if (nextCh === 40 || nextCh === 46) return this.parseExpressionStatement(s, sl, this.parseExpression());
        }
        if (!this.options.allowImportExportEverywhere) {
          if (!topLevel) bail();
          if (!this.inModule) bail();
        }
        return starttype === T_IMPORT ? this.parseImport(s, sl) : this.parseExport(s, sl, exports);
      }
      default: {
        if (this.isAsyncFunction()) {
          if (context) this.unexpected();
          this.next();
          return this.parseFunctionStatement(s, sl, true, !context);
        }
        const usingKind = this.isAwaitUsing(false) ? "await using" : this.isUsing(false) ? "using" : null;
        if (usingKind) {
          if (!this.allowUsing) bail();
          if (context) bail();
          if (usingKind === "await using") {
            if (!this.canAwait) bail();
            this.next();
          }
          this.next();
          const decls = this.parseVar(false, usingKind);
          this.semicolon();
          return new NVariableDeclaration(this, s, sl, decls, usingKind);
        }
        const maybeName = this.value, expr = this.parseExpression();
        if (starttype === T_NAME && expr.type === "Identifier" && this.eat(T_COLON)) return this.parseLabeledStatement(s, sl, maybeName, expr, context);
        return this.parseExpressionStatement(s, sl, expr);
      }
    }
  }

  parseBreakContinueStatement(s, sl, isBreak) {
    this.next();
    let label;
    if (this.eat(T_SEMI) || this.insertSemicolon()) label = null;
    else if (this.type !== T_NAME) this.unexpected();
    else {
      label = this.parseIdent();
      this.semicolon();
    }
    let i = 0;
    for (; i < this.labels.length; ++i) {
      const lab = this.labels[i];
      if (label == null || lab.name === label.name) {
        if (lab.kind != null && (isBreak || lab.kind === "loop")) break;
        if (label && isBreak) break;
      }
    }
    if (i === this.labels.length) bail();
    return isBreak ? new NBreakStatement(this, s, sl, label) : new NContinueStatement(this, s, sl, label);
  }

  parseDoStatement(s, sl) {
    this.next();
    this.labels.push(loopLabel);
    const body = this.parseStatement("do");
    this.labels.pop();
    this.expect(T_WHILE);
    const test = this.parseParenExpression();
    this.eat(T_SEMI);
    return new NDoWhileStatement(this, s, sl, body, test);
  }

  parseForStatement(s, sl) {
    this.next();
    const awaitAt = this.canAwait && this.eatContextual("await") ? this.lastTokStart : -1;
    this.labels.push(loopLabel);
    this.enterScope(0);
    this.expect(T_PARENL);
    if (this.type === T_SEMI) {
      if (awaitAt > -1) this.unexpected(awaitAt);
      return this.parseFor(s, sl, null);
    }
    const isLet = this.isLet();
    if (this.type === T_VAR || this.type === T_CONST || isLet) {
      const is = this.start, isl = this.startLoc, kind = isLet ? "let" : this.value;
      this.next();
      const decls = this.parseVar(true, kind);
      const init = new NVariableDeclaration(this, is, isl, decls, kind);
      return this.parseForAfterInit(s, sl, init, awaitAt);
    }
    const startsWithLet = this.isContextual("let");
    let isForOf = false;
    const usingKind = this.isUsing(true) ? "using" : this.isAwaitUsing(true) ? "await using" : null;
    if (usingKind) {
      const is = this.start, isl = this.startLoc;
      this.next();
      if (usingKind === "await using") {
        if (!this.canAwait) bail();
        this.next();
      }
      const decls = this.parseVar(true, usingKind);
      const init = new NVariableDeclaration(this, is, isl, decls, usingKind);
      return this.parseForAfterInit(s, sl, init, awaitAt);
    }
    const containsEsc = this.containsEsc;
    const rde = rdeAcquire(this);
    const initPos = this.start;
    const init = awaitAt > -1 ? this.parseExprSubscripts(rde, "await") : this.parseExpression(true, rde);
    if (this.type === T_IN || (isForOf = this.isContextual("of"))) {
      let awaitVal;
      if (awaitAt > -1) {
        if (this.type === T_IN) this.unexpected(awaitAt);
        awaitVal = true;
      } else if (isForOf) {
        if (init.start === initPos && !containsEsc && init.type === "Identifier" && init.name === "async") this.unexpected();
        else awaitVal = false;
      }
      if (startsWithLet && isForOf) bail();
      this.toAssignable(init, false, rde);
      this.rdeDepth--;
      this.checkLValPattern(init);
      return this.parseForIn(s, sl, init, awaitVal);
    } else {
      this.checkExpressionErrors(rde, true);
      this.rdeDepth--;
    }
    if (awaitAt > -1) this.unexpected(awaitAt);
    return this.parseFor(s, sl, init);
  }

  parseForAfterInit(s, sl, init, awaitAt) {
    if ((this.type === T_IN || this.isContextual("of")) && init.declarations.length === 1) {
      let awaitVal;
      if (this.type === T_IN) {
        if ((init.kind === "using" || init.kind === "await using") && !init.declarations[0].init) bail();
        if (awaitAt > -1) this.unexpected(awaitAt);
      } else awaitVal = awaitAt > -1;
      return this.parseForIn(s, sl, init, awaitVal);
    }
    if (awaitAt > -1) this.unexpected(awaitAt);
    return this.parseFor(s, sl, init);
  }

  parseFunctionStatement(s, sl, isAsync, declarationPosition) {
    this.next();
    return this.parseFunction(s, sl, FUNC_STATEMENT | (declarationPosition ? 0 : FUNC_HANGING_STATEMENT), false, isAsync);
  }

  parseIfStatement(s, sl) {
    this.next();
    const test = this.parseParenExpression();
    const consequent = this.parseStatement("if");
    const alternate = this.eat(T_ELSE) ? this.parseStatement("if") : null;
    return new NIfStatement(this, s, sl, test, consequent, alternate);
  }

  parseReturnStatement(s, sl) {
    if (!this.allowReturn) bail();
    this.next();
    let argument;
    if (this.eat(T_SEMI) || this.insertSemicolon()) argument = null;
    else {
      argument = this.parseExpression();
      this.semicolon();
    }
    return new NReturnStatement(this, s, sl, argument);
  }

  parseSwitchStatement(s, sl) {
    this.next();
    const discriminant = this.parseParenExpression();
    const casesBase = this.sp;
    this.expect(T_BRACEL);
    this.labels.push(switchLabel);
    this.enterScope(SCOPE_SWITCH);
    // (stack: the finished cases, then the current case's consequent)
    let cur = null, cs = 0, csl = null, consBase = 0, curTest = null;
    for (let sawDefault = false; this.type !== T_BRACER; ) {
      if (this.type === T_CASE || this.type === T_DEFAULT) {
        const isCase = this.type === T_CASE;
        if (cur) {
          const c = new NSwitchCase(this, cs, csl, listFrom(this, consBase), curTest);
          this.stk[this.sp++] = c;
        }
        cur = true;
        cs = this.start;
        csl = this.startLoc;
        consBase = this.sp;
        this.next();
        if (isCase) {
          curTest = this.parseExpression();
        } else {
          if (sawDefault) bail();
          sawDefault = true;
          curTest = null;
        }
        this.expect(T_COLON);
      } else {
        if (!cur) this.unexpected();
        const st = this.parseStatement(null);
        this.stk[this.sp++] = st;
      }
    }
    this.exitScope();
    if (cur) {
      const c = new NSwitchCase(this, cs, csl, listFrom(this, consBase), curTest);
      this.stk[this.sp++] = c;
    }
    const cases = listFrom(this, casesBase);
    this.next();
    this.labels.pop();
    return new NSwitchStatement(this, s, sl, discriminant, cases);
  }

  parseThrowStatement(s, sl) {
    this.next();
    if (this.nlBefore) bail();
    const argument = this.parseExpression();
    this.semicolon();
    return new NThrowStatement(this, s, sl, argument);
  }

  parseCatchClauseParam() {
    const param = this.parseBindingAtom();
    const simple = param.type === "Identifier";
    this.enterScope(simple ? SCOPE_SIMPLE_CATCH : 0);
    this.checkLValPattern(param, simple ? BIND_SIMPLE_CATCH : BIND_LEXICAL);
    this.expect(T_PARENR);
    return param;
  }

  parseTryStatement(s, sl) {
    this.next();
    const block = this.parseBlock();
    let handler = null;
    if (this.type === T_CATCH) {
      const cs = this.start, csl = this.startLoc;
      this.next();
      let param;
      if (this.eat(T_PARENL)) {
        param = this.parseCatchClauseParam();
      } else {
        param = null;
        this.enterScope(0);
      }
      const body = this.parseBlock(false);
      this.exitScope();
      handler = new NCatchClause(this, cs, csl, param, body);
    }
    const finalizer = this.eat(T_FINALLY) ? this.parseBlock() : null;
    if (!handler && !finalizer) bail();
    return new NTryStatement(this, s, sl, block, handler, finalizer);
  }

  parseVarStatement(s, sl, kind, allowMissingInitializer?) {
    this.next();
    const decls = this.parseVar(false, kind, allowMissingInitializer);
    this.semicolon();
    return new NVariableDeclaration(this, s, sl, decls, kind);
  }

  parseWhileStatement(s, sl) {
    this.next();
    const test = this.parseParenExpression();
    this.labels.push(loopLabel);
    const body = this.parseStatement("while");
    this.labels.pop();
    return new NWhileStatement(this, s, sl, test, body);
  }

  parseWithStatement(s, sl) {
    if (this.strict) bail();
    this.next();
    const object = this.parseParenExpression();
    const body = this.parseStatement("with");
    return new NWithStatement(this, s, sl, object, body);
  }

  parseLabeledStatement(s, sl, maybeName, expr, context) {
    for (const label of this.labels) if (label.name === maybeName) bail();
    const kind = TF[this.type] & F_LOOP ? "loop" : this.type === T_SWITCH ? "switch" : null;
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const label = this.labels[i];
      if (label.statementStart === s) {
        label.statementStart = this.start;
        label.kind = kind;
      } else break;
    }
    this.labels.push({ name: maybeName, kind, statementStart: this.start });
    const body = this.parseStatement(context ? (context.indexOf("label") === -1 ? context + "label" : context) : "label");
    this.labels.pop();
    return new NLabeledStatement(this, s, sl, body, expr);
  }

  parseExpressionStatement(s, sl, expr) {
    this.semicolon();
    return new NExpressionStatement(this, s, sl, expr);
  }

  parseBlock(createNewLexicalScope = true, s = this.start, sl = this.startLoc, exitStrict?) {
    const base = this.sp;
    this.expect(T_BRACEL);
    if (createNewLexicalScope) this.enterScope(0);
    while (this.type !== T_BRACER) {
      const st = this.parseStatement(null);
      this.stk[this.sp++] = st;
    }
    const body = listFrom(this, base);
    if (exitStrict) this.strict = false;
    this.next();
    if (createNewLexicalScope) this.exitScope();
    return new NBlockStatement(this, s, sl, body);
  }

  parseFor(s, sl, init) {
    this.expect(T_SEMI);
    const test = this.type === T_SEMI ? null : this.parseExpression();
    this.expect(T_SEMI);
    const update = this.type === T_PARENR ? null : this.parseExpression();
    this.expect(T_PARENR);
    const body = this.parseStatement("for");
    this.exitScope();
    this.labels.pop();
    return new NForStatement(this, s, sl, init, test, update, body);
  }

  // awaitVal: undefined -> no `await` key, true/false -> key present
  parseForIn(s, sl, init, awaitVal) {
    const isForIn = this.type === T_IN;
    this.next();
    if (
      init.type === "VariableDeclaration" &&
      init.declarations[0].init != null &&
      (!isForIn || this.strict || init.kind !== "var" || init.declarations[0].id.type !== "Identifier")
    )
      bail();
    const right = isForIn ? this.parseExpression() : this.parseMaybeAssign();
    this.expect(T_PARENR);
    const body = this.parseStatement("for");
    this.exitScope();
    this.labels.pop();
    if (isForIn) {
      if (awaitVal === undefined) return new NForInStatement(this, s, sl, init, right, body);
      return new NForInStatementAwait(this, s, sl, awaitVal, init, right, body);
    }
    if (awaitVal === undefined) bail(); // (can't happen for ecmaVersion >= 9)
    return new NForOfStatement(this, s, sl, awaitVal, init, right, body);
  }

  parseVar(isFor, kind, allowMissingInitializer?) {
    const base = this.sp;
    for (;;) {
      const ds = this.start, dsl = this.startLoc;
      const id = this.parseVarId(kind);
      let init;
      if (this.eat(T_EQ)) {
        init = this.parseMaybeAssign(isFor);
      } else if (!allowMissingInitializer && kind === "const" && !(this.type === T_IN || this.isContextual("of"))) {
        this.unexpected();
      } else if (!allowMissingInitializer && (kind === "using" || kind === "await using") && this.ecma >= 17 && this.type !== T_IN && !this.isContextual("of")) {
        bail();
      } else if (!allowMissingInitializer && id.type !== "Identifier" && !(isFor && (this.type === T_IN || this.isContextual("of")))) {
        bail();
      } else {
        init = null;
      }
      const d = new NVariableDeclarator(this, ds, dsl, id, init);
      this.stk[this.sp++] = d;
      if (!this.eat(T_COMMA)) break;
    }
    return listFrom(this, base);
  }

  parseVarId(kind) {
    const id = kind === "using" || kind === "await using" ? this.parseIdent() : this.parseBindingAtom();
    this.checkLValPattern(id, kind === "var" ? BIND_VAR : BIND_LEXICAL, false);
    return id;
  }

  // acorn's function node as it is when parseFunctionBody runs (initFunction's
  // key order: id, expression, generator, async; then params)
  overrideFunctionNode(s, sl, id, generator, async, params) {
    const node: any = new Node(this.nodeShim, s, sl);
    node.id = id;
    node.expression = false;
    node.generator = generator;
    node.async = async;
    node.params = params;
    return node;
  }

  runBodyOverride(node, isArrowFunction, isMethod, forInit) {
    const f = this.facade;
    const saved = f.fnNode;
    f.fnNode = node;
    this.bodyOverride.call(f, node, isArrowFunction, isMethod, forInit);
    f.fnNode = saved;
  }

  parseFunction(s, sl, statement, allowExpressionBody?, isAsync?, forInit?) {
    // initFunction + parseFunction
    if (this.type === T_STAR && statement & FUNC_HANGING_STATEMENT) this.unexpected();
    const generator = this.eat(T_STAR);
    const async = !!isAsync;
    let id = null;
    if (statement & FUNC_STATEMENT) {
      id = statement & FUNC_NULLABLE_ID && this.type !== T_NAME ? null : this.parseIdent();
      if (id && !(statement & FUNC_HANGING_STATEMENT))
        this.checkLValSimple(id, this.strict || generator || async ? (this.treatFunctionsAsVar ? BIND_VAR : BIND_LEXICAL) : BIND_FUNCTION);
    }
    const oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
    this.yieldPos = 0;
    this.awaitPos = 0;
    this.awaitIdentPos = 0;
    this.enterScope(functionFlags(async, generator));
    if (!(statement & FUNC_STATEMENT)) id = this.type === T_NAME ? this.parseIdent() : null;
    this.expect(T_PARENL);
    const params = this.parseBindingList(T_PARENR, false, true);
    this.checkYieldAwaitInDefaultParams();
    if (this.bodyOverride !== null) {
      const node = this.overrideFunctionNode(s, sl, id, generator, async, params);
      this.runBodyOverride(node, allowExpressionBody, false, forInit);
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return finishNodeAt(this, node, statement & FUNC_STATEMENT ? "FunctionDeclaration" : "FunctionExpression", this.lastTokEnd, this.leloc());
    }
    const body = this.parseFunctionBody(params, id, allowExpressionBody, false, forInit);
    const expression = this.fbExpression;
    this.yieldPos = oldYieldPos;
    this.awaitPos = oldAwaitPos;
    this.awaitIdentPos = oldAwaitIdentPos;
    const C = statement & FUNC_STATEMENT ? NFunctionDeclaration : NFunctionExpression;
    return new C(this, s, sl, id, expression, generator, async, params, body);
  }

  parseClass(s, sl, isStatement) {
    this.next();
    const oldStrict = this.strict;
    this.strict = true;
    // parseClassId
    let id;
    if (this.type === T_NAME) {
      id = this.parseIdent();
      if (isStatement) this.checkLValSimple(id, BIND_LEXICAL, false);
    } else {
      if (isStatement === true) this.unexpected();
      id = null;
    }
    const superClass = this.eat(T_EXTENDS) ? this.parseExprSubscripts(null, false) : null;
    const privateNameMap = this.enterClassBody();
    const bs = this.start, bsl = this.startLoc;
    let hadConstructor = false;
    const base = this.sp;
    this.expect(T_BRACEL);
    while (this.type !== T_BRACER) {
      const element = this.parseClassElement(superClass !== null);
      if (element) {
        this.stk[this.sp++] = element;
        if (element.type === "MethodDefinition" && element.kind === "constructor") {
          if (hadConstructor) bail();
          hadConstructor = true;
        } else if (element.key && element.key.type === "PrivateIdentifier" && isPrivateNameConflicted(privateNameMap, element)) {
          bail();
        }
      }
    }
    const body = listFrom(this, base);
    this.strict = oldStrict;
    this.next();
    const classBody = new NClassBody(this, bs, bsl, body);
    this.exitClassBody();
    return isStatement ? new NClassDeclaration(this, s, sl, id, superClass, classBody) : new NClassExpression(this, s, sl, id, superClass, classBody);
  }

  parseClassElement(constructorAllowsSuper) {
    if (this.eat(T_SEMI)) return null;
    const s = this.start, sl = this.startLoc;
    let keyName = "";
    let isGenerator = false;
    let isAsync = false;
    let kind = "method";
    let isStatic = false;
    if (this.eatContextual("static")) {
      if (this.eat(T_BRACEL)) return this.parseClassStaticBlock(s, sl);
      if (this.isClassElementNameStart() || this.type === T_STAR) isStatic = true;
      else keyName = "static";
    }
    if (!keyName && this.eatContextual("async")) {
      if ((this.isClassElementNameStart() || this.type === T_STAR) && !this.canInsertSemicolon()) isAsync = true;
      else keyName = "async";
    }
    if (!keyName && this.eat(T_STAR)) isGenerator = true;
    if (!keyName && !isAsync && !isGenerator) {
      const lastValue = this.value;
      if (this.eatContextual("get") || this.eatContextual("set")) {
        if (this.isClassElementNameStart()) kind = lastValue;
        else keyName = lastValue;
      }
    }
    let computed, key;
    if (keyName) {
      computed = false;
      key = new NIdentifier(this, this.lastTokStart, this.lastTokStartLoc, keyName);
    } else if (this.type === T_PRIVATEID) {
      if (this.value === "constructor") bail();
      computed = false;
      key = this.parsePrivateIdent();
    } else {
      key = this.parsePropertyName();
      computed = this.pnComputed;
    }
    if (this.type === T_PARENL || kind !== "method" || isGenerator || isAsync) {
      const isConstructor = !isStatic && checkKeyName(computed, key, "constructor");
      const allowsDirectSuper = isConstructor && constructorAllowsSuper;
      if (isConstructor && kind !== "method") bail();
      kind = isConstructor ? "constructor" : kind;
      // parseClassMethod
      if (kind === "constructor") {
        if (isGenerator) bail();
        if (isAsync) bail();
      } else if (isStatic && checkKeyName(computed, key, "prototype")) bail();
      const value = this.parseMethod(isGenerator, isAsync, allowsDirectSuper);
      if (kind === "get" && value.params.length !== 0) bail();
      if (kind === "set" && value.params.length !== 1) bail();
      if (kind === "set" && value.params[0].type === "RestElement") bail();
      return new NMethodDefinition(this, s, sl, isStatic, computed, key, kind, value);
    }
    // parseClassField
    if (checkKeyName(computed, key, "constructor")) bail();
    else if (isStatic && checkKeyName(computed, key, "prototype")) bail();
    let value;
    if (this.eat(T_EQ)) {
      this.enterScope(SCOPE_CLASS_FIELD_INIT | SCOPE_SUPER);
      value = this.parseMaybeAssign();
      this.exitScope();
    } else value = null;
    this.semicolon();
    return new NPropertyDefinition(this, s, sl, isStatic, computed, key, value);
  }

  isClassElementNameStart() {
    const t = this.type;
    return t === T_NAME || t === T_PRIVATEID || t === T_NUM || t === T_STRING || t === T_BRACKETL || t >= T_KW_FIRST;
  }

  parseClassStaticBlock(s, sl) {
    const base = this.sp;
    const oldLabels = this.labels;
    this.labels = [];
    this.enterScope(SCOPE_CLASS_STATIC_BLOCK | SCOPE_SUPER);
    while (this.type !== T_BRACER) {
      const st = this.parseStatement(null);
      this.stk[this.sp++] = st;
    }
    const body = listFrom(this, base);
    this.next();
    this.exitScope();
    this.labels = oldLabels;
    return new NStaticBlock(this, s, sl, body);
  }

  enterClassBody() {
    const element = { declared: Object.create(null), used: [] };
    this.privateNameStack.push(element);
    return element.declared;
  }

  exitClassBody() {
    const { declared, used } = this.privateNameStack.pop();
    if (!this.checkPrivateFields) return;
    const len = this.privateNameStack.length;
    const parent = len === 0 ? null : this.privateNameStack[len - 1];
    for (let i = 0; i < used.length; ++i) {
      const id = used[i];
      if (!Object.hasOwn(declared, id.name)) {
        if (parent) parent.used.push(id);
        else bail();
      }
    }
  }

  parseExportAllDeclaration(s, sl, exports) {
    let exported;
    if (this.eatContextual("as")) {
      exported = this.parseModuleExportName();
      this.checkExport(exports, exported, this.lastTokStart);
    } else exported = null;
    this.expectContextual("from");
    if (this.type !== T_STRING) this.unexpected();
    const source = this.parseExprAtom();
    const attributes = this.parseWithClause();
    this.semicolon();
    return new NExportAllDeclaration(this, s, sl, exported, source, attributes);
  }

  parseExport(s, sl, exports) {
    this.next();
    if (this.eat(T_STAR)) return this.parseExportAllDeclaration(s, sl, exports);
    if (this.eat(T_DEFAULT)) {
      this.checkExport(exports, "default", this.lastTokStart);
      const declaration = this.parseExportDefaultDeclaration();
      return new NExportDefaultDeclaration(this, s, sl, declaration);
    }
    let declaration, specifiers, source, attributes;
    if (this.shouldParseExportStatement()) {
      declaration = this.parseStatement(null);
      if (declaration.type === "VariableDeclaration") this.checkVariableExport(exports, declaration.declarations);
      else this.checkExport(exports, declaration.id, declaration.id.start);
      specifiers = [];
      source = null;
      attributes = [];
    } else {
      declaration = null;
      specifiers = this.parseExportSpecifiers(exports);
      if (this.eatContextual("from")) {
        if (this.type !== T_STRING) this.unexpected();
        source = this.parseExprAtom();
        attributes = this.parseWithClause();
      } else {
        for (const spec of specifiers) {
          this.checkUnreserved(spec.local);
          this.checkLocalExport(spec.local);
          if (spec.local.type === "Literal") bail();
        }
        source = null;
        attributes = [];
      }
      this.semicolon();
    }
    return new NExportNamedDeclaration(this, s, sl, declaration, specifiers, source, attributes);
  }

  parseExportDefaultDeclaration() {
    let isAsync;
    if (this.type === T_FUNCTION || (isAsync = this.isAsyncFunction())) {
      const fs = this.start, fsl = this.startLoc;
      this.next();
      if (isAsync) this.next();
      return this.parseFunction(fs, fsl, FUNC_STATEMENT | FUNC_NULLABLE_ID, false, isAsync);
    } else if (this.type === T_CLASS) {
      return this.parseClass(this.start, this.startLoc, "nullableID");
    }
    const declaration = this.parseMaybeAssign();
    this.semicolon();
    return declaration;
  }

  checkExport(exports, name, pos) {
    if (!exports) return;
    if (typeof name !== "string") name = name.type === "Identifier" ? name.name : name.value;
    if (Object.hasOwn(exports, name)) bail();
    exports[name] = true;
  }

  checkPatternExport(exports, pat) {
    const type = pat.type;
    if (type === "Identifier") this.checkExport(exports, pat, pat.start);
    else if (type === "ObjectPattern") for (const prop of pat.properties) this.checkPatternExport(exports, prop);
    else if (type === "ArrayPattern") {
      for (const elt of pat.elements) if (elt) this.checkPatternExport(exports, elt);
    } else if (type === "Property") this.checkPatternExport(exports, pat.value);
    else if (type === "AssignmentPattern") this.checkPatternExport(exports, pat.left);
    else if (type === "RestElement") this.checkPatternExport(exports, pat.argument);
  }

  checkVariableExport(exports, decls) {
    if (!exports) return;
    for (const decl of decls) this.checkPatternExport(exports, decl.id);
  }

  shouldParseExportStatement() {
    const t = this.type;
    return t === T_VAR || t === T_CONST || t === T_CLASS || t === T_FUNCTION || this.isLet() || this.isAsyncFunction();
  }

  parseExportSpecifier(exports) {
    const s = this.start, sl = this.startLoc;
    const local = this.parseModuleExportName();
    const exported = this.eatContextual("as") ? this.parseModuleExportName() : local;
    this.checkExport(exports, exported, exported.start);
    return new NExportSpecifier(this, s, sl, local, exported);
  }

  parseExportSpecifiers(exports) {
    const base = this.sp;
    let first = true;
    this.expect(T_BRACEL);
    while (!this.eat(T_BRACER)) {
      if (!first) {
        this.expect(T_COMMA);
        if (this.afterTrailingComma(T_BRACER)) break;
      } else first = false;
      const n = this.parseExportSpecifier(exports);
      this.stk[this.sp++] = n;
    }
    return listFrom(this, base);
  }

  parseImport(s, sl) {
    this.next();
    let specifiers, source;
    if (this.type === T_STRING) {
      specifiers = emptyImportSpecifiers;
      source = this.parseExprAtom();
    } else {
      specifiers = this.parseImportSpecifiers();
      this.expectContextual("from");
      source = this.type === T_STRING ? this.parseExprAtom() : this.unexpected();
    }
    const attributes = this.parseWithClause();
    this.semicolon();
    return new NImportDeclaration(this, s, sl, specifiers, source, attributes);
  }

  parseImportSpecifier() {
    const s = this.start, sl = this.startLoc;
    const imported = this.parseModuleExportName();
    let local;
    if (this.eatContextual("as")) {
      local = this.parseIdent();
    } else {
      this.checkUnreserved(imported);
      local = imported;
    }
    this.checkLValSimple(local, BIND_LEXICAL);
    return new NImportSpecifier(this, s, sl, imported, local);
  }

  parseImportDefaultSpecifier() {
    const s = this.start, sl = this.startLoc;
    const local = this.parseIdent();
    this.checkLValSimple(local, BIND_LEXICAL);
    return new NImportDefaultSpecifier(this, s, sl, local);
  }

  parseImportNamespaceSpecifier() {
    const s = this.start, sl = this.startLoc;
    this.next();
    this.expectContextual("as");
    const local = this.parseIdent();
    this.checkLValSimple(local, BIND_LEXICAL);
    return new NImportNamespaceSpecifier(this, s, sl, local);
  }

  parseImportSpecifiers() {
    const base = this.sp;
    let first = true;
    if (this.type === T_NAME) {
      const n = this.parseImportDefaultSpecifier();
      this.stk[this.sp++] = n;
      if (!this.eat(T_COMMA)) return listFrom(this, base);
    }
    if (this.type === T_STAR) {
      const n = this.parseImportNamespaceSpecifier();
      this.stk[this.sp++] = n;
      return listFrom(this, base);
    }
    this.expect(T_BRACEL);
    while (!this.eat(T_BRACER)) {
      if (!first) {
        this.expect(T_COMMA);
        if (this.afterTrailingComma(T_BRACER)) break;
      } else first = false;
      const n = this.parseImportSpecifier();
      this.stk[this.sp++] = n;
    }
    return listFrom(this, base);
  }

  parseWithClause() {
    const nodes = [];
    if (!this.eat(T_WITH)) return nodes;
    this.expect(T_BRACEL);
    const attributeKeys = {};
    let first = true;
    while (!this.eat(T_BRACER)) {
      if (!first) {
        this.expect(T_COMMA);
        if (this.afterTrailingComma(T_BRACER)) break;
      } else first = false;
      const attr = this.parseImportAttribute();
      const keyName = attr.key.type === "Identifier" ? attr.key.name : attr.key.value;
      if (Object.hasOwn(attributeKeys, keyName)) bail();
      attributeKeys[keyName] = true;
      nodes.push(attr);
    }
    return nodes;
  }

  parseImportAttribute() {
    const s = this.start, sl = this.startLoc;
    const key = this.type === T_STRING ? this.parseExprAtom() : this.parseIdent(!this.allowReservedNever);
    this.expect(T_COLON);
    if (this.type !== T_STRING) this.unexpected();
    const value = this.parseExprAtom();
    return new NImportAttribute(this, s, sl, key, value);
  }

  parseModuleExportName() {
    if (this.type === T_STRING) {
      const stringLiteral = this.parseLiteral(this.value);
      if (loneSurrogate.test(stringLiteral.value)) bail();
      return stringLiteral;
    }
    return this.parseIdent(true);
  }

  adaptDirectivePrologue(statements) {
    for (let i = 0; i < statements.length && this.isDirectiveCandidate(statements[i]); ++i) {
      statements[i].directive = statements[i].expression.raw.slice(1, -1);
    }
  }

  isDirectiveCandidate(statement) {
    if (statement.type !== "ExpressionStatement") return false;
    const e = statement.expression;
    if (e.type !== "Literal" || typeof e.value !== "string") return false;
    const c = this.input.charCodeAt(statement.start);
    return c === 34 || c === 39;
  }

  // ------------------------------------------------------------ lval

  toAssignable(node, isBinding, rde?) {
    if (node) {
      switch (node.type) {
        case "Identifier":
          if (this.inAsync && node.name === "await") bail();
          break;
        case "ObjectPattern":
        case "ArrayPattern":
        case "AssignmentPattern":
        case "RestElement":
          break;
        case "ObjectExpression":
          node.type = "ObjectPattern";
          if (rde) this.checkPatternErrors(rde, true);
          for (const prop of node.properties) {
            this.toAssignable(prop, isBinding);
            if (prop.type === "RestElement" && (prop.argument.type === "ArrayPattern" || prop.argument.type === "ObjectPattern")) bail();
          }
          break;
        case "Property":
          if (node.kind !== "init") bail();
          this.toAssignable(node.value, isBinding);
          break;
        case "ArrayExpression":
          node.type = "ArrayPattern";
          if (rde) this.checkPatternErrors(rde, true);
          this.toAssignableList(node.elements, isBinding);
          break;
        case "SpreadElement":
          node.type = "RestElement";
          this.toAssignable(node.argument, isBinding);
          if (node.argument.type === "AssignmentPattern") bail();
          break;
        case "AssignmentExpression":
          if (node.operator !== "=") bail();
          node.type = "AssignmentPattern";
          delete node.operator;
          this.toAssignable(node.left, isBinding);
          break;
        case "ParenthesizedExpression":
          this.toAssignable(node.expression, isBinding, rde);
          break;
        case "ChainExpression":
          bail();
          break;
        case "MemberExpression":
          if (!isBinding) break;
        // falls through
        default:
          bail();
      }
    } else if (rde) this.checkPatternErrors(rde, true);
    return node;
  }

  toAssignableList(exprList, isBinding) {
    const end = exprList.length;
    for (let i = 0; i < end; i++) {
      const elt = exprList[i];
      if (elt) this.toAssignable(elt, isBinding);
    }
    return exprList;
  }

  parseSpread(rde) {
    const s = this.start, sl = this.startLoc;
    this.next();
    const argument = this.parseMaybeAssign(false, rde);
    return new NSpreadElement(this, s, sl, argument);
  }

  parseRestBinding() {
    const s = this.start, sl = this.startLoc;
    this.next();
    const argument = this.parseBindingAtom();
    return new NRestElement(this, s, sl, argument);
  }

  parseBindingAtom() {
    if (this.type === T_BRACKETL) {
      const s = this.start, sl = this.startLoc;
      this.next();
      const elements = this.parseBindingList(T_BRACKETR, true, true);
      return new NArrayPattern(this, s, sl, elements);
    }
    if (this.type === T_BRACEL) return this.parseObj(true);
    return this.parseIdent();
  }

  parseBindingList(close, allowEmpty, allowTrailingComma) {
    const base = this.sp;
    let first = true;
    while (!this.eat(close)) {
      if (first) first = false;
      else this.expect(T_COMMA);
      if (allowEmpty && this.type === T_COMMA) {
        this.stk[this.sp++] = null;
      } else if (allowTrailingComma && this.afterTrailingComma(close)) {
        break;
      } else if (this.type === T_ELLIPSIS) {
        const rest = this.parseRestBinding();
        this.stk[this.sp++] = rest;
        if (this.type === T_COMMA) bail();
        this.expect(close);
        break;
      } else {
        const e = this.parseMaybeDefault(this.start, this.startLoc);
        this.stk[this.sp++] = e;
      }
    }
    return listFrom(this, base);
  }

  parseMaybeDefault(s, sl, left?) {
    left = left || this.parseBindingAtom();
    if (!this.eat(T_EQ)) return left;
    const right = this.parseMaybeAssign();
    return new NAssignmentPattern(this, s, sl, left, right);
  }

  checkLValSimple(expr, bindingType = BIND_NONE, checkClashes?) {
    const isBind = bindingType !== BIND_NONE;
    switch (expr.type) {
      case "Identifier":
        if (this.strict && restrictedMask(expr.name) !== 0 && this.reservedWordsStrictBind.has(expr.name)) bail();
        if (isBind) {
          if (bindingType === BIND_LEXICAL && expr.name === "let") bail();
          if (checkClashes) {
            if (checkClashes.includes(expr.name)) bail();
            checkClashes.push(expr.name);
          }
          if (bindingType !== BIND_OUTSIDE) this.declareName(expr.name, bindingType);
        }
        break;
      case "ChainExpression":
        bail();
        break;
      case "MemberExpression":
        if (isBind) bail();
        break;
      case "ParenthesizedExpression":
        if (isBind) bail();
        return this.checkLValSimple(expr.expression, bindingType, checkClashes);
      default:
        bail();
    }
  }

  checkLValPattern(expr, bindingType = BIND_NONE, checkClashes?) {
    switch (expr.type) {
      case "ObjectPattern":
        for (const prop of expr.properties) this.checkLValInnerPattern(prop, bindingType, checkClashes);
        break;
      case "ArrayPattern":
        for (const elem of expr.elements) if (elem) this.checkLValInnerPattern(elem, bindingType, checkClashes);
        break;
      default:
        this.checkLValSimple(expr, bindingType, checkClashes);
    }
  }

  checkLValInnerPattern(expr, bindingType = BIND_NONE, checkClashes) {
    switch (expr.type) {
      case "Property":
        this.checkLValInnerPattern(expr.value, bindingType, checkClashes);
        break;
      case "AssignmentPattern":
        this.checkLValPattern(expr.left, bindingType, checkClashes);
        break;
      case "RestElement":
        this.checkLValPattern(expr.argument, bindingType, checkClashes);
        break;
      default:
        this.checkLValPattern(expr, bindingType, checkClashes);
    }
  }

  // ------------------------------------------------------------ expressions

  // returns whether the object has had an init __proto__ property so far
  checkPropClash(prop, sawProto, rde) {
    if (prop.type === "SpreadElement") return sawProto;
    if (prop.computed || prop.method || prop.shorthand) return sawProto;
    const key = prop.key;
    let name;
    switch (key.type) {
      case "Identifier":
        name = key.name;
        break;
      case "Literal":
        name = String(key.value);
        break;
      default:
        return sawProto;
    }
    if (name === "__proto__" && prop.kind === "init") {
      if (sawProto) {
        if (rde) {
          if (rde.doubleProto < 0) rde.doubleProto = key.start;
        } else bail();
      }
      return true;
    }
    return sawProto;
  }

  parseExpression(forInit?, rde?) {
    const s = this.start, sl = this.startLoc;
    const expr = this.parseMaybeAssign(forInit, rde);
    if (this.type === T_COMMA) {
      const base = this.sp;
      this.stk[this.sp++] = expr;
      while (this.eat(T_COMMA)) {
        const e = this.parseMaybeAssign(forInit, rde);
        this.stk[this.sp++] = e;
      }
      return new NSequenceExpression(this, s, sl, listFrom(this, base));
    }
    return expr;
  }

  parseMaybeAssign(forInit?, rde?, afterLeftParse?) {
    if (this.type === T_NAME && this.isContextual("yield")) {
      if (this.inGenerator) return this.parseYield(forInit);
      else this.exprAllowed = false;
    }
    let ownDestructuringErrors = false, oldParenAssign = -1, oldTrailingComma = -1, oldDoubleProto = -1;
    if (rde) {
      oldParenAssign = rde.parenthesizedAssign;
      oldTrailingComma = rde.trailingComma;
      oldDoubleProto = rde.doubleProto;
      rde.parenthesizedAssign = rde.trailingComma = -1;
    } else {
      rde = rdeAcquire(this);
      ownDestructuringErrors = true;
    }
    const s = this.start, sl = this.startLoc;
    if (this.type === T_PARENL || this.type === T_NAME) {
      this.potentialArrowAt = this.start;
      this.potentialArrowInForAwait = forInit === "await";
    }
    let left = this.parseMaybeConditional(forInit, rde);
    if (afterLeftParse) left = afterLeftParse.call(this, left, s, sl);
    if (TF[this.type] & F_ASSIGN) {
      const operator = this.value;
      if (this.type === T_EQ) left = this.toAssignable(left, false, rde);
      if (!ownDestructuringErrors) rde.parenthesizedAssign = rde.trailingComma = rde.doubleProto = -1;
      if (rde.shorthandAssign >= left.start) rde.shorthandAssign = -1;
      if (this.type === T_EQ) this.checkLValPattern(left);
      else this.checkLValSimple(left);
      this.next();
      const right = this.parseMaybeAssign(forInit);
      if (oldDoubleProto > -1) rde.doubleProto = oldDoubleProto;
      if (ownDestructuringErrors) this.rdeDepth--;
      return new NAssignmentExpression(this, s, sl, operator, left, right);
    } else {
      if (ownDestructuringErrors) {
        this.checkExpressionErrors(rde, true);
        this.rdeDepth--;
        return left;
      }
    }
    if (oldParenAssign > -1) rde.parenthesizedAssign = oldParenAssign;
    if (oldTrailingComma > -1) rde.trailingComma = oldTrailingComma;
    return left;
  }

  parseMaybeConditional(forInit, rde) {
    const s = this.start, sl = this.startLoc;
    // (parseExprOps inlined: it starts at the same position)
    let expr = this.parseMaybeUnary(rde, false, false, forInit);
    if (rde !== null && rde !== undefined && (rde.shorthandAssign >= 0 || rde.doubleProto >= 0)) return expr;
    if (BINOP[this.type] >= 0 && !(expr.start === s && expr.type === "ArrowFunctionExpression")) {
      expr = this.parseExprOp(expr, s, sl, -1, forInit);
      if (rde !== null && rde !== undefined && (rde.shorthandAssign >= 0 || rde.doubleProto >= 0)) return expr;
    }
    if (this.type === T_QUESTION && !(expr.type === "ArrowFunctionExpression" && expr.start === s) && this.eat(T_QUESTION)) {
      const consequent = this.parseMaybeAssign();
      this.expect(T_COLON);
      const alternate = this.parseMaybeAssign(forInit);
      return new NConditionalExpression(this, s, sl, expr, consequent, alternate);
    }
    return expr;
  }

  parseExprOps(forInit, rde) {
    const s = this.start, sl = this.startLoc;
    const expr = this.parseMaybeUnary(rde, false, false, forInit);
    if (this.checkExpressionErrors(rde)) return expr;
    return expr.start === s && expr.type === "ArrowFunctionExpression" ? expr : this.parseExprOp(expr, s, sl, -1, forInit);
  }

  parseExprOp(left, leftStartPos, leftStartLoc, minPrec, forInit) {
    let prec = BINOP[this.type];
    if (prec >= 0 && (!forInit || this.type !== T_IN)) {
      if (prec > minPrec) {
        const logical = this.type === T_LOGICALOR || this.type === T_LOGICALAND;
        const coalesce = this.type === T_COALESCE;
        if (coalesce) prec = 2;
        const op = this.value;
        this.next();
        const s = this.start, sl = this.startLoc;
        const right = this.parseExprOp(this.parseMaybeUnary(null, false, false, forInit), s, sl, prec, forInit);
        const node = this.buildBinary(leftStartPos, leftStartLoc, left, right, op, logical || coalesce);
        if ((logical && this.type === T_COALESCE) || (coalesce && (this.type === T_LOGICALOR || this.type === T_LOGICALAND))) bail();
        return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, forInit);
      }
    }
    return left;
  }

  buildBinary(s, sl, left, right, op, logical) {
    if (right.type === "PrivateIdentifier") bail();
    return logical ? new NLogicalExpression(this, s, sl, left, op, right) : new NBinaryExpression(this, s, sl, left, op, right);
  }

  parseMaybeUnary(rde, sawUnary, incDec, forInit) {
    const s = this.start, sl = this.startLoc;
    let expr;
    if (this.type === T_NAME && this.isContextual("await") && this.canAwait) {
      expr = this.parseAwait(forInit);
      sawUnary = true;
    } else if (TF[this.type] & F_PREFIX) {
      const update = this.type === T_INCDEC;
      const operator = this.value;
      this.next();
      const argument = this.parseMaybeUnary(null, true, update, forInit);
      this.checkExpressionErrors(rde, true);
      if (update) this.checkLValSimple(argument);
      else if (this.strict && operator === "delete" && isLocalVariableAccess(argument)) bail();
      else if (operator === "delete" && isPrivateFieldAccess(argument)) bail();
      else sawUnary = true;
      expr = update ? new NUpdateExpression(this, s, sl, operator, true, argument) : new NUnaryExpression(this, s, sl, operator, true, argument);
    } else if (!sawUnary && this.type === T_PRIVATEID) {
      if ((forInit || this.privateNameStack.length === 0) && this.checkPrivateFields) this.unexpected();
      expr = this.parsePrivateIdent();
      if (this.type !== T_IN) this.unexpected();
    } else {
      // parseExprSubscripts inlined (same start position)
      expr = this.parseExprAtom(rde, forInit);
      if (!(expr.type === "ArrowFunctionExpression" && !(this.lastTokEnd === this.lastTokStart + 1 && this.input.charCodeAt(this.lastTokStart) === 41))) {
        const t = this.type;
        if (t === T_DOT || t === T_PARENL || t === T_BRACKETL || t === T_QUESTIONDOT || t === T_BACKQUOTE) {
          expr = this.parseSubscripts(expr, s, sl, false, forInit);
          if (rde && expr.type === "MemberExpression") {
            if (rde.parenthesizedAssign >= expr.start) rde.parenthesizedAssign = -1;
            if (rde.parenthesizedBind >= expr.start) rde.parenthesizedBind = -1;
            if (rde.trailingComma >= expr.start) rde.trailingComma = -1;
          }
        }
      }
      if (rde !== null && rde !== undefined && (rde.shorthandAssign >= 0 || rde.doubleProto >= 0)) return expr;
      while (TF[this.type] & F_POSTFIX && !this.canInsertSemicolon()) {
        const operator = this.value;
        this.checkLValSimple(expr);
        this.next();
        expr = new NUpdateExpression(this, s, sl, operator, false, expr);
      }
    }
    if (this.type === T_STARSTAR && !incDec && !(expr.type === "ArrowFunctionExpression" && expr.start === s) && this.eat(T_STARSTAR)) {
      if (sawUnary) this.unexpected(this.lastTokStart);
      else return this.buildBinary(s, sl, expr, this.parseMaybeUnary(null, false, false, forInit), "**", false);
    } else {
      return expr;
    }
  }

  parseExprSubscripts(rde, forInit) {
    const s = this.start, sl = this.startLoc;
    const expr = this.parseExprAtom(rde, forInit);
    if (expr.type === "ArrowFunctionExpression" && !(this.lastTokEnd === this.lastTokStart + 1 && this.input.charCodeAt(this.lastTokStart) === 41)) return expr;
    const result = this.parseSubscripts(expr, s, sl, false, forInit);
    if (rde && result.type === "MemberExpression") {
      if (rde.parenthesizedAssign >= result.start) rde.parenthesizedAssign = -1;
      if (rde.parenthesizedBind >= result.start) rde.parenthesizedBind = -1;
      if (rde.trailingComma >= result.start) rde.trailingComma = -1;
    }
    return result;
  }

  parseSubscripts(base, s, sl, noCalls, forInit) {
    const maybeAsyncArrow =
      base.type === "Identifier" &&
      base.name === "async" &&
      this.lastTokEnd === base.end &&
      !this.canInsertSemicolon() &&
      base.end - base.start === 5 &&
      this.potentialArrowAt === base.start;
    let optionalChained = false;
    for (;;) {
      const t = this.type;
      if (t !== T_DOT && t !== T_PARENL && t !== T_BRACKETL && t !== T_QUESTIONDOT && t !== T_BACKQUOTE) {
        if (optionalChained) return new NChainExpression(this, s, sl, base);
        return base;
      }
      let element = this.parseSubscript(base, s, sl, noCalls, maybeAsyncArrow, optionalChained, forInit);
      if (element.optional) optionalChained = true;
      if (element === base || element.type === "ArrowFunctionExpression") {
        if (optionalChained) element = new NChainExpression(this, s, sl, element);
        return element;
      }
      base = element;
    }
  }

  parseSubscript(base, s, sl, noCalls, maybeAsyncArrow, optionalChained, forInit) {
    const t = this.type;
    // quick exit for the common "no subscript follows" case
    if (t !== T_QUESTIONDOT && t !== T_BRACKETL && t !== T_DOT && t !== T_PARENL && t !== T_BACKQUOTE) return base;
    const optional = this.eat(T_QUESTIONDOT);
    if (noCalls && optional) bail();
    const computed = this.eat(T_BRACKETL);
    if (computed || (optional && this.type !== T_PARENL && this.type !== T_BACKQUOTE) || this.eat(T_DOT)) {
      let property;
      if (computed) {
        property = this.parseExpression();
        this.expect(T_BRACKETR);
      } else if (this.type === T_PRIVATEID && base.type !== "Super") {
        property = this.parsePrivateIdent();
      } else {
        property = this.parseIdent(!this.allowReservedNever);
      }
      return new NMemberExpression(this, s, sl, base, property, computed, optional);
    } else if (!noCalls && this.eat(T_PARENL)) {
      const rde = rdeAcquire(this), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
      this.yieldPos = 0;
      this.awaitPos = 0;
      this.awaitIdentPos = 0;
      const exprList = this.parseExprList(T_PARENR, true, false, rde);
      this.rdeDepth--; // (fields are read below before anything reuses the slot)
      if (maybeAsyncArrow && !optional && !this.canInsertSemicolon() && this.eat(T_ARROW)) {
        this.checkPatternErrors(rde, false);
        this.checkYieldAwaitInDefaultParams();
        if (this.awaitIdentPos > 0) bail();
        this.yieldPos = oldYieldPos;
        this.awaitPos = oldAwaitPos;
        this.awaitIdentPos = oldAwaitIdentPos;
        return this.parseArrowExpression(s, sl, exprList, true, forInit);
      }
      this.checkExpressionErrors(rde, true);
      this.yieldPos = oldYieldPos || this.yieldPos;
      this.awaitPos = oldAwaitPos || this.awaitPos;
      this.awaitIdentPos = oldAwaitIdentPos || this.awaitIdentPos;
      return new NCallExpression(this, s, sl, base, exprList, optional);
    } else if (this.type === T_BACKQUOTE) {
      if (optional || optionalChained) bail();
      const quasi = this.parseTemplate(true);
      return new NTaggedTemplateExpression(this, s, sl, base, quasi);
    }
    return base;
  }

  parseExprAtom(rde?, forInit?, forNew?) {
    if (this.jsx) {
      // acorn-jsx's parseExprAtom(refShortHandDefaultPos) override: JSX
      // atoms, otherwise super.parseExprAtom(refShortHandDefaultPos) -- which
      // drops forInit and forNew
      if (this.type === T_JSXTEXT) return this.jsxParseText();
      if (this.type === T_JSXTAGSTART) return this.jsxParseElement();
      forInit = undefined;
      forNew = undefined;
    }
    if (this.type === T_SLASH) this.readRegexp();
    const canBeArrow = this.potentialArrowAt === this.start;
    const s = this.start, sl = this.startLoc;
    switch (this.type) {
      case T_SUPER: {
        if (!this.allowSuper) bail();
        this.next();
        if (this.type === T_PARENL && !this.allowDirectSuper) bail();
        if (this.type !== T_DOT && this.type !== T_BRACKETL && this.type !== T_PARENL) this.unexpected();
        return new NSuper(this, s, sl);
      }
      case T_THIS:
        this.next();
        return new NThisExpression(this, s, sl);
      case T_NAME: {
        const containsEsc = this.containsEsc;
        let id = this.parseIdent(false);
        if (this.type === T_FUNCTION && !containsEsc && id.name === "async" && !this.canInsertSemicolon() && this.eat(T_FUNCTION)) {
          this.overrideContext(C_F_EXPR);
          return this.parseFunction(s, sl, 0, false, true, forInit);
        }
        if (canBeArrow && (this.type === T_ARROW || this.type === T_NAME) && !this.canInsertSemicolon()) {
          if (this.eat(T_ARROW)) return this.parseArrowExpression(s, sl, [id], false, forInit);
          if (this.type === T_NAME && id.name === "async" && !containsEsc && (!this.potentialArrowInForAwait || this.value !== "of" || this.containsEsc)) {
            id = this.parseIdent(false);
            if (this.canInsertSemicolon() || !this.eat(T_ARROW)) this.unexpected();
            return this.parseArrowExpression(s, sl, [id], true, forInit);
          }
        }
        return id;
      }
      case T_REGEXP: {
        const value = this.value;
        const raw = this.input.slice(this.start, this.end);
        this.next();
        return new NLiteralRe(this, s, sl, value.value, raw, { pattern: value.pattern, flags: value.flags });
      }
      case T_NUM:
      case T_STRING:
        return this.parseLiteral(this.value);
      case T_NULL:
      case T_TRUE:
      case T_FALSE: {
        const value = this.type === T_NULL ? null : this.type === T_TRUE;
        const raw = KW_NAME[this.type];
        this.next();
        return new NLiteral(this, s, sl, value, raw);
      }
      case T_PARENL: {
        const start = this.start, expr = this.parseParenAndDistinguishExpression(canBeArrow, forInit);
        if (rde) {
          if (rde.parenthesizedAssign < 0 && !this.isSimpleAssignTarget(expr)) rde.parenthesizedAssign = start;
          if (rde.parenthesizedBind < 0) rde.parenthesizedBind = start;
        }
        return expr;
      }
      case T_BRACKETL: {
        this.next();
        const elements = this.parseExprList(T_BRACKETR, true, true, rde);
        return new NArrayExpression(this, s, sl, elements);
      }
      case T_BRACEL:
        this.overrideContext(C_B_EXPR);
        return this.parseObj(false, rde);
      case T_FUNCTION:
        this.next();
        return this.parseFunction(s, sl, 0);
      case T_CLASS:
        return this.parseClass(s, sl, false);
      case T_NEW:
        return this.parseNew();
      case T_BACKQUOTE:
        return this.parseTemplate(false);
      case T_IMPORT:
        return this.parseExprImport(forNew);
      default:
        this.unexpected();
    }
  }

  parseExprImport(forNew) {
    const s = this.start, sl = this.startLoc;
    if (this.containsEsc) bail();
    this.next();
    if (this.type === T_PARENL && !forNew) {
      return this.parseDynamicImport(s, sl);
    } else if (this.type === T_DOT) {
      const meta = new NIdentifier(this, s, sl, "import");
      // acorn: startNodeAt(node.start, node.loc && node.loc.start) then finishNode — same end as now
      return this.parseImportMeta(s, sl, meta);
    }
    this.unexpected();
  }

  parseDynamicImport(s, sl) {
    this.next();
    const source = this.parseMaybeAssign();
    let options;
    if (!this.eat(T_PARENR)) {
      this.expect(T_COMMA);
      if (!this.afterTrailingComma(T_PARENR)) {
        options = this.parseMaybeAssign();
        if (!this.eat(T_PARENR)) {
          this.expect(T_COMMA);
          if (!this.afterTrailingComma(T_PARENR)) this.unexpected();
        }
      } else options = null;
    } else options = null;
    return new NImportExpression(this, s, sl, source, options);
  }

  parseImportMeta(s, sl, meta) {
    this.next();
    const containsEsc = this.containsEsc;
    const property = this.parseIdent(true);
    if (property.name !== "meta") bail();
    if (containsEsc) bail();
    if (this.options.sourceType !== "module" && !this.options.allowImportExportEverywhere) bail();
    return new NMetaProperty(this, s, sl, meta, property);
  }

  // ------------------------------------------------------------ acorn-jsx parse functions

  // jsx_parseText: parseLiteral(this.value) with type "JSXText"
  jsxParseText() {
    const s = this.start, sl = this.startLoc;
    const value = this.value;
    const raw = this.input.slice(this.start, this.end);
    this.next();
    if (raw.charCodeAt(raw.length - 1) === 110) {
      const bigint = value != null ? value.toString() : raw.slice(0, -1).replace(/_/g, "");
      return new NJSXTextBig(this, s, sl, value, raw, bigint);
    }
    return new NJSXText(this, s, sl, value, raw);
  }

  jsxParseIdentifier() {
    const s = this.start, sl = this.startLoc;
    let name;
    if (this.type === T_JSXNAME) name = this.value;
    else if (this.type >= T_KW_FIRST) name = KW_NAME[this.type];
    else this.unexpected();
    this.next();
    return new NJSXIdentifier(this, s, sl, name);
  }

  jsxParseNamespacedName() {
    const s = this.start, sl = this.startLoc;
    const name = this.jsxParseIdentifier();
    if (!this.jsxNamespaces || !this.eat(T_COLON)) return name;
    const local = this.jsxParseIdentifier();
    return new NJSXNamespacedName(this, s, sl, name, local);
  }

  jsxParseElementName() {
    if (this.type === T_JSXTAGEND) return "";
    const s = this.start, sl = this.startLoc;
    let node = this.jsxParseNamespacedName();
    if (this.type === T_DOT && node.type === "JSXNamespacedName" && !this.jsxNamespacedObjects) this.unexpected();
    while (this.eat(T_DOT)) {
      const property = this.jsxParseIdentifier();
      node = new NJSXMemberExpression(this, s, sl, node, property);
    }
    return node;
  }

  jsxParseAttributeValue() {
    switch (this.type) {
      case T_BRACEL: {
        const node = this.jsxParseExpressionContainer();
        if (node.expression.type === "JSXEmptyExpression") bail();
        return node;
      }
      case T_JSXTAGSTART:
      case T_STRING:
        return this.parseExprAtom();
      default:
        bail();
    }
  }

  // starts at the end of the `{` and ends at the start of the `}`
  jsxParseEmptyExpression() {
    const node = new NJSXEmptyExpression(this, this.lastTokEnd, this.leloc());
    return setEnd(this, node, this.start, this.startLoc);
  }

  jsxParseExpressionContainer() {
    const s = this.start, sl = this.startLoc;
    this.next();
    const expression = this.type === T_BRACER ? this.jsxParseEmptyExpression() : this.parseExpression();
    this.expect(T_BRACER);
    return new NJSXExpressionContainer(this, s, sl, expression);
  }

  jsxParseAttribute() {
    const s = this.start, sl = this.startLoc;
    if (this.eat(T_BRACEL)) {
      this.expect(T_ELLIPSIS);
      const argument = this.parseMaybeAssign();
      this.expect(T_BRACER);
      return new NJSXSpreadAttribute(this, s, sl, argument);
    }
    const name = this.jsxParseNamespacedName();
    const value = this.eat(T_EQ) ? this.jsxParseAttributeValue() : null;
    return new NJSXAttribute(this, s, sl, name, value);
  }

  jsxParseOpeningElementAt(s, sl) {
    const base = this.sp;
    const nodeName = this.jsxParseElementName();
    while (this.type !== T_SLASH && this.type !== T_JSXTAGEND) {
      const a = this.jsxParseAttribute();
      this.stk[this.sp++] = a;
    }
    const attributes = listFrom(this, base);
    const selfClosing = this.eat(T_SLASH);
    this.expect(T_JSXTAGEND);
    return nodeName ? new NJSXOpeningElement(this, s, sl, attributes, nodeName, selfClosing) : new NJSXOpeningFragment(this, s, sl, attributes, selfClosing);
  }

  jsxParseClosingElementAt(s, sl) {
    const nodeName = this.jsxParseElementName();
    this.expect(T_JSXTAGEND);
    return nodeName ? new NJSXClosingElement(this, s, sl, nodeName) : new NJSXClosingFragment(this, s, sl);
  }

  jsxParseElementAt(s, sl) {
    const base = this.sp;
    const openingElement = this.jsxParseOpeningElementAt(s, sl);
    let closingElement = null;
    if (!openingElement.selfClosing) {
      contents: for (;;) {
        switch (this.type) {
          case T_JSXTAGSTART: {
            const cs = this.start, csl = this.startLoc;
            this.next();
            if (this.eat(T_SLASH)) {
              closingElement = this.jsxParseClosingElementAt(cs, csl);
              break contents;
            }
            const el = this.jsxParseElementAt(cs, csl);
            this.stk[this.sp++] = el;
            break;
          }
          case T_JSXTEXT: {
            const t = this.parseExprAtom();
            this.stk[this.sp++] = t;
            break;
          }
          case T_BRACEL: {
            const c = this.jsxParseExpressionContainer();
            this.stk[this.sp++] = c;
            break;
          }
          default:
            this.unexpected();
        }
      }
      if (jsxQualifiedName(closingElement.name) !== jsxQualifiedName(openingElement.name)) bail();
    }
    const children = listFrom(this, base);
    const isElement = !!openingElement.name;
    // "Adjacent JSX elements must be wrapped in an enclosing tag"
    if (this.type === T_RELATIONAL && this.value === "<") bail();
    return isElement
      ? new NJSXElement(this, s, sl, openingElement, closingElement, children)
      : new NJSXFragment(this, s, sl, openingElement, closingElement, children);
  }

  jsxParseElement() {
    const s = this.start, sl = this.startLoc;
    this.next();
    return this.jsxParseElementAt(s, sl);
  }

  parseLiteral(value) {
    const s = this.start, sl = this.startLoc;
    const raw = this.input.slice(this.start, this.end);
    this.next();
    if (raw.charCodeAt(raw.length - 1) === 110) {
      const bigint = value != null ? value.toString() : raw.slice(0, -1).replace(/_/g, "");
      return new NLiteralBig(this, s, sl, value, raw, bigint);
    }
    return new NLiteral(this, s, sl, value, raw);
  }

  parseParenExpression() {
    this.expect(T_PARENL);
    const val = this.parseExpression();
    this.expect(T_PARENR);
    return val;
  }

  parseParenAndDistinguishExpression(canBeArrow, forInit) {
    const s = this.start, sl = this.startLoc;
    let val;
    this.next();
    const innerStartPos = this.start, innerStartLoc = this.startLoc;
    const base = this.sp;
    let first = true, lastIsComma = false;
    const rde = rdeAcquire(this), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos;
    let spreadStart;
    this.yieldPos = 0;
    this.awaitPos = 0;
    while (this.type !== T_PARENR) {
      first ? (first = false) : this.expect(T_COMMA);
      if (this.afterTrailingComma(T_PARENR, true)) {
        lastIsComma = true;
        break;
      } else if (this.type === T_ELLIPSIS) {
        spreadStart = this.start;
        const r = this.parseRestBinding();
        this.stk[this.sp++] = r;
        if (this.type === T_COMMA) bail();
        break;
      } else {
        const e = this.parseMaybeAssign(false, rde);
        this.stk[this.sp++] = e;
      }
    }
    const exprList = listFrom(this, base);
    const innerEndPos = this.lastTokEnd, innerEndLoc = this.leloc();
    this.expect(T_PARENR);
    if (canBeArrow && !this.canInsertSemicolon() && this.eat(T_ARROW)) {
      this.checkPatternErrors(rde, false);
      this.rdeDepth--;
      this.checkYieldAwaitInDefaultParams();
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      return this.parseArrowExpression(s, sl, exprList, false, forInit);
    }
    if (!exprList.length || lastIsComma) this.unexpected(this.lastTokStart);
    if (spreadStart) this.unexpected(spreadStart);
    this.checkExpressionErrors(rde, true);
    this.rdeDepth--;
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;
    if (exprList.length > 1) {
      val = new NSequenceExpression(this, innerStartPos, innerStartLoc, exprList);
      setEnd(this, val, innerEndPos, innerEndLoc);
    } else {
      val = exprList[0];
    }
    if (this.preserveParens) return new NParenthesizedExpression(this, s, sl, val);
    return val;
  }

  parseNew() {
    if (this.containsEsc) bail();
    const s = this.start, sl = this.startLoc;
    this.next();
    if (this.type === T_DOT) {
      const meta = new NIdentifier(this, s, sl, "new");
      this.next();
      const containsEsc = this.containsEsc;
      const property = this.parseIdent(true);
      if (property.name !== "target") bail();
      if (containsEsc) bail();
      if (!this.allowNewDotTarget) bail();
      return new NMetaProperty(this, s, sl, meta, property);
    }
    const cs = this.start, csl = this.startLoc;
    const callee = this.parseSubscripts(this.parseExprAtom(null, false, true), cs, csl, true, false);
    if (callee.type === "Super") bail();
    let args;
    if (this.eat(T_PARENL)) args = this.parseExprList(T_PARENR, true, false);
    else args = emptyNewArguments;
    return new NNewExpression(this, s, sl, callee, args);
  }

  parseTemplateElement(isTagged) {
    const s = this.start, sl = this.startLoc;
    let value;
    if (this.type === T_INVALIDTEMPLATE) {
      if (!isTagged) bail();
      value = { raw: normalizeCR(this.value), cooked: null };
    } else {
      value = { raw: normalizeCR(this.input.slice(this.start, this.end)), cooked: this.value };
    }
    this.next();
    const tail = this.type === T_BACKQUOTE;
    return new NTemplateElement(this, s, sl, value, tail);
  }

  parseTemplate(isTagged) {
    const s = this.start, sl = this.startLoc;
    this.next();
    let curElt = this.parseTemplateElement(isTagged);
    if (curElt.tail) {
      this.next();
      return new NTemplateLiteral(this, s, sl, [], [curElt]);
    }
    // quasi, expression, quasi, ... interleaved on the list stack
    const base = this.sp;
    this.stk[this.sp++] = curElt;
    while (!curElt.tail) {
      if (this.type === T_EOF) bail();
      this.expect(T_DOLLARBRACEL);
      const e = this.parseExpression();
      this.stk[this.sp++] = e;
      this.expect(T_BRACER);
      curElt = this.parseTemplateElement(isTagged);
      this.stk[this.sp++] = curElt;
    }
    this.next();
    const st = this.stk, cnt = this.sp - base;
    this.sp = base;
    let expressions, quasis;
    if (cnt === 3) {
      expressions = [st[base + 1]];
      quasis = [st[base], st[base + 2]];
    } else if (cnt === 5) {
      expressions = [st[base + 1], st[base + 3]];
      quasis = [st[base], st[base + 2], st[base + 4]];
    } else {
      expressions = [];
      quasis = [];
      for (let i = 0; i < cnt; i++) (i & 1 ? expressions : quasis).push(st[base + i]);
    }
    return new NTemplateLiteral(this, s, sl, expressions, quasis);
  }

  isAsyncProp(computed, key) {
    const t = this.type;
    return (
      !computed &&
      key.type === "Identifier" &&
      key.name === "async" &&
      (t === T_NAME || t === T_NUM || t === T_STRING || t === T_BRACKETL || t >= T_KW_FIRST || t === T_STAR) &&
      !this.nlBefore
    );
  }

  parseObj(isPattern, rde?) {
    const s = this.start, sl = this.startLoc;
    let first = true;
    let sawProto = false;
    const base = this.sp;
    this.next();
    while (!this.eat(T_BRACER)) {
      if (!first) {
        this.expect(T_COMMA);
        if (this.afterTrailingComma(T_BRACER)) break;
      } else first = false;
      const prop = this.parseProperty(isPattern, rde);
      if (!isPattern) sawProto = this.checkPropClash(prop, sawProto, rde);
      this.stk[this.sp++] = prop;
    }
    const properties = listFrom(this, base);
    return isPattern ? new NObjectPattern(this, s, sl, properties) : new NObjectExpression(this, s, sl, properties);
  }

  parseProperty(isPattern, rde) {
    const ps = this.start, psl = this.startLoc;
    let isGenerator, isAsync, startPos, startLoc;
    if (this.eat(T_ELLIPSIS)) {
      if (isPattern) {
        const argument = this.parseIdent(false);
        if (this.type === T_COMMA) bail();
        return new NRestElement(this, ps, psl, argument);
      }
      const argument = this.parseMaybeAssign(false, rde);
      if (this.type === T_COMMA && rde && rde.trailingComma < 0) rde.trailingComma = this.start;
      return new NSpreadElement(this, ps, psl, argument);
    }
    let method = false, shorthand = false;
    if (isPattern || rde) {
      startPos = this.start;
      startLoc = this.startLoc;
    }
    if (!isPattern) isGenerator = this.eat(T_STAR);
    const containsEsc = this.containsEsc;
    let key = this.parsePropertyName();
    let computed = this.pnComputed;
    if (!isPattern && !containsEsc && !isGenerator && this.isAsyncProp(computed, key)) {
      isAsync = true;
      isGenerator = this.eat(T_STAR);
      key = this.parsePropertyName();
      computed = this.pnComputed;
    } else {
      isAsync = false;
    }
    // parsePropertyValue
    let value, kind;
    if ((isGenerator || isAsync) && this.type === T_COLON) this.unexpected();
    if (this.eat(T_COLON)) {
      value = isPattern ? this.parseMaybeDefault(this.start, this.startLoc) : this.parseMaybeAssign(false, rde);
      kind = "init";
    } else if (this.type === T_PARENL) {
      if (isPattern) this.unexpected();
      method = true;
      value = this.parseMethod(isGenerator, isAsync);
      kind = "init";
    } else if (
      !isPattern &&
      !containsEsc &&
      !computed &&
      key.type === "Identifier" &&
      (key.name === "get" || key.name === "set") &&
      this.type !== T_COMMA &&
      this.type !== T_BRACER &&
      this.type !== T_EQ
    ) {
      if (isGenerator || isAsync) this.unexpected();
      // parseGetterSetter
      kind = key.name;
      key = this.parsePropertyName();
      computed = this.pnComputed;
      value = this.parseMethod(false);
      const paramCount = kind === "get" ? 0 : 1;
      if (value.params.length !== paramCount) bail();
      else if (kind === "set" && value.params[0].type === "RestElement") bail();
    } else if (!computed && key.type === "Identifier") {
      if (isGenerator || isAsync) this.unexpected();
      this.checkUnreserved(key);
      if (key.name === "await" && !this.awaitIdentPos) this.awaitIdentPos = startPos;
      if (isPattern) {
        value = this.parseMaybeDefault(startPos, startLoc, copyNode(this, key));
      } else if (this.type === T_EQ && rde) {
        if (rde.shorthandAssign < 0) rde.shorthandAssign = this.start;
        value = this.parseMaybeDefault(startPos, startLoc, copyNode(this, key));
      } else {
        value = copyNode(this, key);
      }
      kind = "init";
      shorthand = true;
    } else this.unexpected();
    return new NProperty(this, ps, psl, method, shorthand, computed, key, value, kind);
  }

  // returns the key; sets this.pnComputed (acorn sets both on the prop)
  parsePropertyName() {
    if (this.eat(T_BRACKETL)) {
      const key = this.parseMaybeAssign();
      this.expect(T_BRACKETR);
      this.pnComputed = true;
      return key;
    }
    const key = this.type === T_NUM || this.type === T_STRING ? this.parseExprAtom() : this.parseIdent(!this.allowReservedNever);
    this.pnComputed = false;
    return key;
  }

  parseMethod(isGenerator, isAsync?, allowDirectSuper?) {
    const s = this.start, sl = this.startLoc;
    const oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
    const generator = isGenerator;
    const async = !!isAsync;
    this.yieldPos = 0;
    this.awaitPos = 0;
    this.awaitIdentPos = 0;
    this.enterScope(functionFlags(isAsync, generator) | SCOPE_SUPER | (allowDirectSuper ? SCOPE_DIRECT_SUPER : 0));
    this.expect(T_PARENL);
    const params = this.parseBindingList(T_PARENR, false, true);
    this.checkYieldAwaitInDefaultParams();
    if (this.bodyOverride !== null) {
      const node = this.overrideFunctionNode(s, sl, null, generator, async, params);
      this.runBodyOverride(node, false, true, false);
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return finishNodeAt(this, node, "FunctionExpression", this.lastTokEnd, this.leloc());
    }
    const body = this.parseFunctionBody(params, null, false, true, false);
    const expression = this.fbExpression;
    this.yieldPos = oldYieldPos;
    this.awaitPos = oldAwaitPos;
    this.awaitIdentPos = oldAwaitIdentPos;
    return new NFunctionExpression(this, s, sl, null, expression, generator, async, params, body);
  }

  parseArrowExpression(s, sl, params, isAsync, forInit) {
    const oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
    this.enterScope(functionFlags(isAsync, false) | SCOPE_ARROW);
    const async = !!isAsync;
    this.yieldPos = 0;
    this.awaitPos = 0;
    this.awaitIdentPos = 0;
    params = this.toAssignableList(params, true);
    if (this.bodyOverride !== null) {
      const node = this.overrideFunctionNode(s, sl, null, false, async, params);
      this.runBodyOverride(node, true, false, forInit);
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return finishNodeAt(this, node, "ArrowFunctionExpression", this.lastTokEnd, this.leloc());
    }
    const body = this.parseFunctionBody(params, null, true, false, forInit);
    const expression = this.fbExpression;
    this.yieldPos = oldYieldPos;
    this.awaitPos = oldAwaitPos;
    this.awaitIdentPos = oldAwaitIdentPos;
    return new NArrowFunctionExpression(this, s, sl, null, expression, false, async, params, body);
  }

  // returns the body; sets this.fbExpression (read it right after the call)
  parseFunctionBody(params, id, isArrowFunction, isMethod, forInit) {
    const isExpression = isArrowFunction && this.type !== T_BRACEL;
    const oldStrict = this.strict;
    let useStrict = false;
    let body, expression;
    if (isExpression) {
      body = this.parseMaybeAssign(forInit);
      expression = true;
      this.checkParams(params, false);
    } else {
      const nonSimple = !isSimpleParamList(params);
      if (!oldStrict || nonSimple) {
        useStrict = this.strictDirective(this.end);
        if (useStrict && nonSimple) bail();
      }
      const oldLabels = this.labels;
      this.labels = [];
      if (useStrict) this.strict = true;
      this.checkParams(params, !oldStrict && !useStrict && !isArrowFunction && !isMethod && isSimpleParamList(params));
      if (this.strict && id) this.checkLValSimple(id, BIND_OUTSIDE);
      body = this.parseBlock(false, this.start, this.startLoc, useStrict && !oldStrict);
      expression = false;
      this.adaptDirectivePrologue(body.body);
      this.labels = oldLabels;
    }
    this.exitScope();
    this.fbExpression = expression;
    return body;
  }

  checkParams(params, allowDuplicates) {
    // (names seen so far: a reused array; checkLVal* never re-enters here)
    let nameHash = null;
    if (!allowDuplicates) {
      nameHash = this.clashNames;
      nameHash.length = 0;
    }
    for (let i = 0; i < params.length; i++) this.checkLValInnerPattern(params[i], BIND_VAR, nameHash);
  }

  parseExprList(close, allowTrailingComma, allowEmpty, rde?) {
    const base = this.sp;
    let first = true;
    while (!this.eat(close)) {
      if (!first) {
        this.expect(T_COMMA);
        if (allowTrailingComma && this.afterTrailingComma(close)) break;
      } else first = false;
      let elt;
      if (allowEmpty && this.type === T_COMMA) elt = null;
      else if (this.type === T_ELLIPSIS) {
        elt = this.parseSpread(rde);
        if (rde && this.type === T_COMMA && rde.trailingComma < 0) rde.trailingComma = this.start;
      } else {
        elt = this.parseMaybeAssign(false, rde);
      }
      this.stk[this.sp++] = elt;
    }
    return listFrom(this, base);
  }

  checkUnreserved(ref) {
    const name = ref.name;
    if (restrictedMask(name) === 0) return;
    if (name === "yield" && this.inGenerator) bail();
    if (name === "await" && this.inAsync) bail();
    if (name === "arguments" && !(this.currentThisScope().flags & SCOPE_VAR)) bail();
    if (this.inClassStaticBlock && (name === "arguments" || name === "await")) bail();
    if (KEYWORDS.has(name)) bail();
    if ((this.strict ? this.reservedWordsStrict : this.reservedWords).has(name)) bail();
  }

  parseIdent(liberal?) {
    const s = this.start, sl = this.startLoc;
    let name;
    if (this.type === T_NAME) {
      name = this.value;
    } else if (this.type >= T_KW_FIRST) {
      name = KW_NAME[this.type];
      if ((name === "class" || name === "function") && (this.lastTokEnd !== this.lastTokStart + 1 || this.input.charCodeAt(this.lastTokStart) !== 46)) {
        this.ctx.pop();
      }
      this.type = T_NAME;
    } else {
      this.unexpected();
    }
    this.next(!!liberal);
    const node = new NIdentifier(this, s, sl, name);
    if (!liberal) {
      this.checkUnreserved(node);
      if (name === "await" && !this.awaitIdentPos) this.awaitIdentPos = s;
    }
    return node;
  }

  parsePrivateIdent() {
    const s = this.start, sl = this.startLoc;
    let name;
    if (this.type === T_PRIVATEID) name = this.value;
    else this.unexpected();
    this.next();
    const node = new NPrivateIdentifier(this, s, sl, name);
    if (this.checkPrivateFields) {
      if (this.privateNameStack.length === 0) bail();
      else this.privateNameStack[this.privateNameStack.length - 1].used.push(node);
    }
    return node;
  }

  parseYield(forInit) {
    if (!this.yieldPos) this.yieldPos = this.start;
    const s = this.start, sl = this.startLoc;
    this.next();
    let delegate, argument;
    if (this.type === T_SEMI || this.canInsertSemicolon() || (this.type !== T_STAR && !(TF[this.type] & F_STARTS))) {
      delegate = false;
      argument = null;
    } else {
      delegate = this.eat(T_STAR);
      argument = this.parseMaybeAssign(forInit);
    }
    return new NYieldExpression(this, s, sl, delegate, argument);
  }

  parseAwait(forInit) {
    if (!this.awaitPos) this.awaitPos = this.start;
    const s = this.start, sl = this.startLoc;
    this.next();
    const argument = this.parseMaybeUnary(null, true, false, forInit);
    return new NAwaitExpression(this, s, sl, argument);
  }
}

// ------------------------------------------------------------ helpers

function isJsWhitespace(c) {
  // \s in JS regexps (used by acorn's skipWhiteSpace) beyond ASCII
  return (
    c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
  );
}

function normalizeCR(s) {
  return s.indexOf("\r") === -1 ? s : s.replace(/\r\n?/g, "\n");
}

function stringToNumber(str, isLegacyOctalNumericLiteral) {
  if (isLegacyOctalNumericLiteral) return parseInt(str, 8);
  return parseFloat(str.indexOf("_") === -1 ? str : str.replace(/_/g, ""));
}

function stringToBigInt(str) {
  if (typeof BigInt !== "function") return null;
  return BigInt(str.replace(/_/g, ""));
}

function isLocalVariableAccess(node) {
  return node.type === "Identifier" || (node.type === "ParenthesizedExpression" && isLocalVariableAccess(node.expression));
}

function isPrivateFieldAccess(node) {
  return (
    (node.type === "MemberExpression" && node.property.type === "PrivateIdentifier") ||
    (node.type === "ChainExpression" && isPrivateFieldAccess(node.expression)) ||
    (node.type === "ParenthesizedExpression" && isPrivateFieldAccess(node.expression))
  );
}

function isSimpleParamList(params) {
  for (let i = 0; i < params.length; i++) if (params[i].type !== "Identifier") return false;
  return true;
}

function isPrivateNameConflicted(privateNameMap, element) {
  const name = element.key.name;
  const curr = privateNameMap[name];
  let next = "true";
  if (element.type === "MethodDefinition" && (element.kind === "get" || element.kind === "set")) next = (element.static ? "s" : "i") + element.kind;
  if ((curr === "iget" && next === "iset") || (curr === "iset" && next === "iget") || (curr === "sget" && next === "sset") || (curr === "sset" && next === "sget")) {
    privateNameMap[name] = "true";
    return false;
  } else if (!curr) {
    privateNameMap[name] = next;
    return false;
  }
  return true;
}

function checkKeyName(computed, key, name) {
  return !computed && ((key.type === "Identifier" && key.name === name) || (key.type === "Literal" && key.value === name));
}

function flushComments(p, options) {
  const buf = p.commentBuf;
  if (buf !== null) {
    // Deliver the comments in scan order, called as a method of the options
    // object exactly like acorn's "this.options.onComment(...)"
    for (let i = 0; i < buf.length; i += 6) options.onComment(buf[i], buf[i + 1], buf[i + 2], buf[i + 3], buf[i + 4], buf[i + 5]);
  }
}

// acorn's Parser.parseExpressionAt: new Parser(options, input, pos),
// nextToken(), parseExpression() -- no end-of-input or top-level checks
export function fastParseExpressionAt(input, pos, options, jsx, bodyOverride) {
  const p = new FastParser(options, input, pos, jsx, bodyOverride);
  p.nextToken();
  const expr = p.parseExpression();
  flushComments(p, options);
  return expr;
}

export function fastParse(input, options, jsx, bodyOverride?) {
  const p = new FastParser(options, input, 0, jsx, bodyOverride);
  const s = p.start, sl = p.startLoc;
  p.nextToken();
  const program = p.parseTopLevel(s, sl);
  flushComments(p, options);
  return program;
}
