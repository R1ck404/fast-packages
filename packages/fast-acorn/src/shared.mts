// acorn 8.18's shared building blocks, exported as acorn exports them and
// used by both the fast parser (parser.mts) and, when a plugin needs it, the
// generic parser (generic.cjs), so that identity checks like
// `this.type === tokTypes.name` hold across all of them: TokenType and the
// token type objects (with acorn's context-update hooks), TokContext and the
// token contexts, Position, SourceLocation, Node, Token, the character
// classification functions, defaultOptions / getOptions.

import { IDENT_DATA } from "./ident-data.mjs";

export const version = "8.18.0";

// ------------------------------------------------------------ identifiers
// acorn's tables (tools/gen-ident.mjs), decoded into bitmaps for the Basic
// Multilingual Plane and [lo, hi] range lists for the astral planes, on the
// first lookup of a non-ASCII character (not at import).
// `code >> 5` / `code & 31` truncate like String.fromCharCode does in
// acorn's regexp test, for the non-integer codes callers may pass.

let START_BITS: Int32Array = null, PART_BITS: Int32Array = null;
const ASTRAL_START: number[] = [], ASTRAL_PART: number[] = [];
function decodeTables() {
  START_BITS = new Int32Array(2048);
  PART_BITS = new Int32Array(2048);
  let i = 0;
  const s = IDENT_DATA;
  const num = () => {
    let n = 0, d;
    while ((d = s.charCodeAt(i++) - (s.charCodeAt(i - 1) > 92 ? 36 : 35)) >= 45) n = n * 45 + d - 45;
    return n * 45 + d;
  };
  const fill = (bits: Int32Array, lo: number, hi: number) => {
    for (; lo <= hi && lo & 31; lo++) bits[lo >> 5] |= 1 << (lo & 31);
    for (; lo + 31 <= hi; lo += 32) bits[lo >> 5] = -1;
    for (; lo <= hi; lo++) bits[lo >> 5] |= 1 << (lo & 31);
  };
  for (let k = 0; k < 4; k++) {
    let prev = k < 2 ? 0 : 0x10000;
    for (let n = num(); n > 0; n--) {
      const lo = prev + num();
      prev = lo + num();
      if (k === 0) fill(START_BITS, lo, prev);
      else if (k === 1) fill(PART_BITS, lo, prev);
      else (k === 2 ? ASTRAL_START : ASTRAL_PART).push(lo, prev);
    }
  }
  // (the part list holds what only continues an identifier)
  for (let j = 0; j < 2048; j++) PART_BITS[j] |= START_BITS[j];
}

function isInAstralSet(code: number, set: number[]): boolean {
  for (let i = 0; i < set.length; i += 2) {
    if (set[i] > code) return false;
    if (set[i + 1] >= code) return true;
  }
  return false;
}

// Test whether a given character code starts an identifier.
export function isIdentifierStart(code: number, astral?: boolean): boolean {
  if (code < 65) return code === 36;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;
  if (START_BITS === null) decodeTables();
  if (code <= 0xffff) return code >= 0xaa && ((START_BITS[code >> 5] >>> (code & 31)) & 1) === 1;
  if (astral === false) return false;
  return isInAstralSet(code, ASTRAL_START);
}

// Test whether a given character is part of an identifier.
export function isIdentifierChar(code: number, astral?: boolean): boolean {
  if (code < 48) return code === 36;
  if (code < 58) return true;
  if (code < 65) return false;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;
  if (START_BITS === null) decodeTables();
  if (code <= 0xffff) return code >= 0xaa && ((PART_BITS[code >> 5] >>> (code & 31)) & 1) === 1;
  if (astral === false) return false;
  return isInAstralSet(code, ASTRAL_START) || isInAstralSet(code, ASTRAL_PART);
}

// ------------------------------------------------------------ token types

export function TokenType(this: any, label: string, conf?: any) {
  if (conf === void 0) conf = {};
  this.label = label;
  this.keyword = conf.keyword;
  this.beforeExpr = !!conf.beforeExpr;
  this.startsExpr = !!conf.startsExpr;
  this.isLoop = !!conf.isLoop;
  this.isAssign = !!conf.isAssign;
  this.prefix = !!conf.prefix;
  this.postfix = !!conf.postfix;
  this.binop = conf.binop || null;
  this.updateContext = null;
}

function binop(name: string, prec: number) {
  return new TokenType(name, { beforeExpr: true, binop: prec });
}
const beforeExpr = { beforeExpr: true }, startsExpr = { startsExpr: true };

// Map keyword names to token types.
export const keywordTypes: Record<string, any> = {};

function kw(name: string, options?: any) {
  if (options === void 0) options = {};
  options.keyword = name;
  return (keywordTypes[name] = new TokenType(name, options));
}

export const tokTypes: Record<string, any> = {
  num: new TokenType("num", startsExpr),
  regexp: new TokenType("regexp", startsExpr),
  string: new TokenType("string", startsExpr),
  name: new TokenType("name", startsExpr),
  privateId: new TokenType("privateId", startsExpr),
  eof: new TokenType("eof"),

  bracketL: new TokenType("[", { beforeExpr: true, startsExpr: true }),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{", { beforeExpr: true, startsExpr: true }),
  braceR: new TokenType("}"),
  parenL: new TokenType("(", { beforeExpr: true, startsExpr: true }),
  parenR: new TokenType(")"),
  comma: new TokenType(",", beforeExpr),
  semi: new TokenType(";", beforeExpr),
  colon: new TokenType(":", beforeExpr),
  dot: new TokenType("."),
  question: new TokenType("?", beforeExpr),
  questionDot: new TokenType("?."),
  arrow: new TokenType("=>", beforeExpr),
  template: new TokenType("template"),
  invalidTemplate: new TokenType("invalidTemplate"),
  ellipsis: new TokenType("...", beforeExpr),
  backQuote: new TokenType("`", startsExpr),
  dollarBraceL: new TokenType("${", { beforeExpr: true, startsExpr: true }),

  eq: new TokenType("=", { beforeExpr: true, isAssign: true }),
  assign: new TokenType("_=", { beforeExpr: true, isAssign: true }),
  incDec: new TokenType("++/--", { prefix: true, postfix: true, startsExpr: true }),
  prefix: new TokenType("!/~", { beforeExpr: true, prefix: true, startsExpr: true }),
  logicalOR: binop("||", 1),
  logicalAND: binop("&&", 2),
  bitwiseOR: binop("|", 3),
  bitwiseXOR: binop("^", 4),
  bitwiseAND: binop("&", 5),
  equality: binop("==/!=/===/!==", 6),
  relational: binop("</>/<=/>=", 7),
  bitShift: binop("<</>>/>>>", 8),
  plusMin: new TokenType("+/-", { beforeExpr: true, binop: 9, prefix: true, startsExpr: true }),
  modulo: binop("%", 10),
  star: binop("*", 10),
  slash: binop("/", 10),
  starstar: new TokenType("**", { beforeExpr: true }),
  coalesce: binop("??", 1),

  _break: kw("break"),
  _case: kw("case", beforeExpr),
  _catch: kw("catch"),
  _continue: kw("continue"),
  _debugger: kw("debugger"),
  _default: kw("default", beforeExpr),
  _do: kw("do", { isLoop: true, beforeExpr: true }),
  _else: kw("else", beforeExpr),
  _finally: kw("finally"),
  _for: kw("for", { isLoop: true }),
  _function: kw("function", startsExpr),
  _if: kw("if"),
  _return: kw("return", beforeExpr),
  _switch: kw("switch"),
  _throw: kw("throw", beforeExpr),
  _try: kw("try"),
  _var: kw("var"),
  _const: kw("const"),
  _while: kw("while", { isLoop: true }),
  _with: kw("with"),
  _new: kw("new", { beforeExpr: true, startsExpr: true }),
  _this: kw("this", startsExpr),
  _super: kw("super", startsExpr),
  _class: kw("class", startsExpr),
  _extends: kw("extends", beforeExpr),
  _export: kw("export"),
  _import: kw("import", startsExpr),
  _null: kw("null", startsExpr),
  _true: kw("true", startsExpr),
  _false: kw("false", startsExpr),
  _in: kw("in", { beforeExpr: true, binop: 7 }),
  _instanceof: kw("instanceof", { beforeExpr: true, binop: 7 }),
  _typeof: kw("typeof", { beforeExpr: true, prefix: true, startsExpr: true }),
  _void: kw("void", { beforeExpr: true, prefix: true, startsExpr: true }),
  _delete: kw("delete", { beforeExpr: true, prefix: true, startsExpr: true }),
};

// ------------------------------------------------------------ whitespace

export const lineBreak = /\r\n?|\n|\u2028|\u2029/;
export const lineBreakG = new RegExp(lineBreak.source, "g");

export function isNewLine(code: number): boolean {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

export function nextLineBreak(code: string, from: number, end?: number): number {
  if (end === void 0) end = code.length;
  for (let i = from; i < end; i++) {
    const next = code.charCodeAt(i);
    if (isNewLine(next)) return i < end - 1 && next === 13 && code.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
  }
  return -1;
}

export const nonASCIIwhitespace = /[\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/;

// ------------------------------------------------------------ token contexts

export function TokContext(this: any, token: string, isExpr?: boolean, preserveSpace?: boolean, override?: any, generator?: boolean) {
  this.token = token;
  this.isExpr = !!isExpr;
  this.preserveSpace = !!preserveSpace;
  this.override = override;
  this.generator = !!generator;
}

export const tokContexts: Record<string, any> = {
  b_stat: new TokContext("{", false),
  b_expr: new TokContext("{", true),
  b_tmpl: new TokContext("${", false),
  p_stat: new TokContext("(", false),
  p_expr: new TokContext("(", true),
  q_tmpl: new TokContext("`", true, true, function (p: any) {
    return p.tryReadTemplateToken();
  }),
  f_stat: new TokContext("function", false),
  f_expr: new TokContext("function", true),
  f_expr_gen: new TokContext("function", true, false, null, true),
  f_gen: new TokContext("function", false, false, null, true),
};

// acorn's token-specific context updates (run by the generic parser and by
// plugins calling them; the fast parser has its own copy of this logic)
{
  const tt = tokTypes, types = tokContexts;
  tt.parenR.updateContext = tt.braceR.updateContext = function (this: any) {
    if (this.context.length === 1) {
      this.exprAllowed = true;
      return;
    }
    let out = this.context.pop();
    if (out === types.b_stat && this.curContext().token === "function") out = this.context.pop();
    this.exprAllowed = !out.isExpr;
  };
  tt.braceL.updateContext = function (this: any, prevType: any) {
    this.context.push(this.braceIsBlock(prevType) ? types.b_stat : types.b_expr);
    this.exprAllowed = true;
  };
  tt.dollarBraceL.updateContext = function (this: any) {
    this.context.push(types.b_tmpl);
    this.exprAllowed = true;
  };
  tt.parenL.updateContext = function (this: any, prevType: any) {
    const statementParens = prevType === tt._if || prevType === tt._for || prevType === tt._with || prevType === tt._while;
    this.context.push(statementParens ? types.p_stat : types.p_expr);
    this.exprAllowed = true;
  };
  tt.incDec.updateContext = function () {
    // tokExprAllowed stays unchanged
  };
  tt._function.updateContext = tt._class.updateContext = function (this: any, prevType: any) {
    if (
      prevType.beforeExpr &&
      prevType !== tt._else &&
      !(prevType === tt.semi && this.curContext() !== types.p_stat) &&
      !(prevType === tt._return && lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) &&
      !((prevType === tt.colon || prevType === tt.braceL) && this.curContext() === types.b_stat)
    )
      this.context.push(types.f_expr);
    else this.context.push(types.f_stat);
    this.exprAllowed = false;
  };
  tt.colon.updateContext = function (this: any) {
    if (this.curContext().token === "function") this.context.pop();
    this.exprAllowed = true;
  };
  tt.backQuote.updateContext = function (this: any) {
    if (this.curContext() === types.q_tmpl) this.context.pop();
    else this.context.push(types.q_tmpl);
    this.exprAllowed = false;
  };
  tt.star.updateContext = function (this: any, prevType: any) {
    if (prevType === tt._function) {
      const index = this.context.length - 1;
      if (this.context[index] === types.f_expr) this.context[index] = types.f_expr_gen;
      else this.context[index] = types.f_gen;
    }
    this.exprAllowed = true;
  };
  tt.name.updateContext = function (this: any, prevType: any) {
    let allowed = false;
    if (this.options.ecmaVersion >= 6 && prevType !== tt.dot) {
      if ((this.value === "of" && !this.exprAllowed) || (this.value === "yield" && this.inGeneratorContext())) allowed = true;
    }
    this.exprAllowed = allowed;
  };
}

// ------------------------------------------------------------ locations

export function Position(this: any, line: number, col: number) {
  this.line = line;
  this.column = col;
}
Position.prototype.offset = function offset(n: number) {
  return new Position(this.line, this.column + n);
};

export function SourceLocation(this: any, p: any, start: any, end?: any) {
  this.start = start;
  this.end = end;
  if (p.sourceFile !== null) this.source = p.sourceFile;
}

// The line/column position of a character offset.
export function getLineInfo(input: string, offset: number) {
  for (let line = 1, cur = 0; ; ) {
    const nextBreak = nextLineBreak(input, cur, offset);
    if (nextBreak < 0) return new Position(line, offset - cur);
    ++line;
    cur = nextBreak;
  }
}

// ------------------------------------------------------------ nodes, tokens

export function Node(this: any, parser: any, pos: number, loc?: any) {
  this.type = "";
  this.start = pos;
  this.end = 0;
  if (parser.options.locations) this.loc = new SourceLocation(parser, loc);
  if (parser.options.directSourceFile) this.sourceFile = parser.options.directSourceFile;
  if (parser.options.ranges) this.range = [pos, 0];
}

// the object handed to onToken and returned by tokenizer().getToken()
export function Token(this: any, p: any) {
  this.type = p.type;
  this.value = p.value;
  this.start = p.start;
  this.end = p.end;
  if (p.options.locations) this.loc = new SourceLocation(p, p.startLoc, p.endLoc);
  if (p.options.ranges) this.range = [p.start, p.end];
}

// acorn's shared empty arrays: `new X` without arguments, `import "x"`
export const emptyNewArguments: any[] = [];
export const emptyImportSpecifiers: any[] = [];

// ------------------------------------------------------------ options

export const defaultOptions: Record<string, any> = {
  ecmaVersion: null,
  sourceType: "script",
  strict: false,
  onInsertedSemicolon: null,
  onTrailingComma: null,
  allowReserved: null,
  allowReturnOutsideFunction: false,
  allowImportExportEverywhere: false,
  allowAwaitOutsideFunction: null,
  allowSuperOutsideMethod: null,
  allowHashBang: false,
  checkPrivateFields: true,
  locations: false,
  startLocation: null,
  onToken: null,
  onComment: null,
  ranges: false,
  program: null,
  sourceFile: null,
  directSourceFile: null,
  preserveParens: false,
};
const KEYS = Object.keys(defaultOptions);
const NKEYS = KEYS.length;

let warnedAboutEcmaVersion = false;
const hasOwn = Object.hasOwn;
const NONE = Object.freeze(Object.create(null));

function pushComment(options: any, array: any[]) {
  return function (this: any, block: boolean, text: string, start: number, end: number, startLoc?: any, endLoc?: any) {
    const comment: any = {
      type: block ? "Block" : "Line",
      value: text,
      start: start,
      end: end,
    };
    if (options.locations) comment.loc = new SourceLocation(this, startLoc, endLoc);
    if (options.ranges) comment.range = [start, end];
    array.push(comment);
  };
}

// acorn's getOptions. The result is built as an object literal with
// defaultOptions' keys in their order (reading each key exactly as acorn
// does) while defaultOptions still has exactly its original keys (checked
// on every call: users may modify acorn.defaultOptions); otherwise with
// acorn's loop.
// getOptions' object literal (defaultOptions' keys in their order, each read
// the way acorn's loop reads it), compiled on first use; where `new
// Function` is not allowed, the equivalent loop
let literal: ((o: any, d: any) => any) | null = null;
function makeLiteral() {
  try {
    return new Function("H", "return function(o,d){return{" + KEYS.map((k) => `${k}:H(o,"${k}")?o.${k}:d.${k}`).join(",") + "}}")(hasOwn);
  } catch {
    return (o: any, d: any) => {
      const r = {};
      for (const k of KEYS) r[k] = hasOwn(o, k) ? o[k] : d[k];
      return r;
    };
  }
}

export function getOptions(opts: any): any {
  const d = defaultOptions;
  let i = 0, options;
  for (const k in d) if (k !== KEYS[i++]) i = -1;
  if (i === NKEYS) {
    if (literal === null) literal = makeLiteral();
    options = literal(opts ? opts : NONE, d);
  } else {
    options = {};
    for (const opt in d) options[opt] = opts && hasOwn(opts, opt) ? opts[opt] : d[opt];
  }

  if (options.ecmaVersion === "latest") {
    options.ecmaVersion = 1e8;
  } else if (options.ecmaVersion == null) {
    if (!warnedAboutEcmaVersion && typeof console === "object" && console.warn) {
      warnedAboutEcmaVersion = true;
      console.warn("Since Acorn 8.0.0, options.ecmaVersion is required.\nDefaulting to 2020, but this will stop working in the future.");
    }
    options.ecmaVersion = 11;
  } else if (options.ecmaVersion >= 2015) {
    options.ecmaVersion -= 2009;
  }

  if (options.allowReserved == null) options.allowReserved = options.ecmaVersion < 5;

  if (!opts || opts.allowHashBang == null) options.allowHashBang = options.ecmaVersion >= 14;

  if (Array.isArray(options.onToken)) {
    const tokens = options.onToken;
    options.onToken = function (token: any) {
      return tokens.push(token);
    };
  }
  if (Array.isArray(options.onComment)) options.onComment = pushComment(options, options.onComment);

  if (options.sourceType === "commonjs" && options.allowAwaitOutsideFunction) throw new Error("Cannot use allowAwaitOutsideFunction with sourceType: commonjs");

  return options;
}
