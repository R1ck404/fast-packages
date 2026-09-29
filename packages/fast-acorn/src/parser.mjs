// @r1ck404/fast-acorn: a speed-oriented re-implementation of acorn 8.18's parser.
//
// Every grammar decision mirrors acorn function-for-function (same names,
// same order of checks, same token-context rules for regexp detection, the
// same errors -- message, pos, loc, raisedAt -- at the same points), for
// every ecmaVersion and option, and every AST node is built with exactly the
// keys acorn produces, in the same order. The machinery underneath is
// different: integer token types with flag tables, an ASCII fast path in the
// tokenizer, per-node-type constructors (monomorphic shapes), O(1)
// scope-flag lookups and set-backed scopes, no per-call regexps, a
// precomputed "newline before token" flag.
//
// The parser's methods are module-level functions taking the parse state
// `p` (a State object) as their first argument: a minifier shortens all of
// their names, which keeps browser bundles small, and the state's fields keep
// V8's typed field representations (module-level variables would not, which
// costs about 15%). The functions are `const` bindings where possible, so V8
// knows each call's target.
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
  Token,
  isIdentifierStart,
  isIdentifierChar,
  getLineInfo,
  tokTypes as acornTT,
  tokContexts as acornTC,
  nonASCIIwhitespace,
  emptyNewArguments,
  emptyImportSpecifiers,
} from "./shared.mjs";
import { validateRegExp as acornValidateRegExp } from "./regexp.mjs";

// ------------------------------------------------------------ char tables

const ID_START = new Uint8Array(128);
const ID_CHAR = new Uint8Array(128);
for (let c = 0; c < 128; c++) {
  const s = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95;
  ID_START[c] = s ? 1 : 0;
  ID_CHAR[c] = s || (c >= 48 && c <= 57) ? 1 : 0;
}

const isNewLine = function isNewLine(code) {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

const codePointToString = function codePointToString(code) {
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
// acorn's TokenType object for each token type (the JSX ones are set per
// parse from the plugin's own token types)
const TT_OBJ = new Array(T_COUNT).fill(undefined);
const KEYWORDS = new Map();
{
  // token types in T_* order (tokTypes' own order, with four slots for
  // acorn-jsx's before the keywords): flags come from acorn's TokenType objects
  const types = Object.values(acornTT);
  for (let t = 0; t < T_COUNT; t++) {
    if (t >= T_JSXNAME && t < T_KW_FIRST) continue;
    const o = types[t >= T_KW_FIRST ? t - 4 : t];
    TT_OBJ[t] = o;
    TF[t] = (o.beforeExpr ? F_BEFORE : 0) | (o.startsExpr ? F_STARTS : 0) | (o.isLoop ? F_LOOP : 0) | (o.isAssign ? F_ASSIGN : 0) | (o.prefix ? F_PREFIX : 0) | (o.postfix ? F_POSTFIX : 0);
    if (o.binop != null) BINOP[t] = o.binop;
    if (t >= T_KW_FIRST) {
      KW_NAME[t] = o.keyword;
      KEYWORDS.set(o.keyword, t);
    }
  }
  // acorn-jsx: jsxText beforeExpr, jsxTagStart startsExpr
  TF[T_JSXTEXT] = F_BEFORE;
  TF[T_JSXTAGSTART] = F_STARTS;
}

// index: (len-2)*25*128 + (c0-97)*128 + c1   (len 2..10, c0 a..y, c1 < 128)
const shapeIndex = function shapeIndex(n, c0, c1) {
  return ((n - 2) * 25 + (c0 - 97)) * 128 + c1;
}

// keyword candidates keyed by (length, first char, second char): unique for
// every keyword, so a word is a keyword iff the remaining chars also match
const KW_SHAPE = new Int8Array(9 * 25 * 128).fill(-1);
for (const [name, t] of KEYWORDS) KW_SHAPE[shapeIndex(name.length, name.charCodeAt(0), name.charCodeAt(1))] = t;


// keywords that are only keywords from ES2015 on (before: `export` / `import`
// in modules only)
const KW_ES6 = new Uint8Array(T_COUNT);
KW_ES6[T_CONST] = KW_ES6[T_CLASS] = KW_ES6[T_EXTENDS] = KW_ES6[T_SUPER] = KW_ES6[T_EXPORT] = KW_ES6[T_IMPORT] = 1;

// Names that checkUnreserved / checkLValSimple can object to for
// ecmaVersion >= 5. Like the keywords, each has a unique (length, first
// char, second char) shape, so "is this name restricted at all" costs an
// integer lookup plus a compare instead of string hashing; the precise
// checks only run for these names. (ecmaVersion 3's longer reserved list
// makes every name a candidate.)
const R_SHAPE = new Int8Array(9 * 25 * 128).fill(-1);
const R_NAMES = [];
{
  const names = new Set(KEYWORDS.keys());
  for (const w of "enum await implements interface let package private protected public static yield eval arguments".split(" ")) names.add(w);
  // (no two of these share a shape: test/versions.mjs would fail)
  for (const name of names) {
    R_SHAPE[shapeIndex(name.length, name.charCodeAt(0), name.charCodeAt(1))] = R_NAMES.length;
    R_NAMES.push(name);
  }
}
// false when `name` can never be rejected by the identifier checks
// (checkUnreserved also sees string-literal module export names, e.g.
// `import { "a" } from "m"`: no name -- acorn's regexp tests of undefined
// match nothing there, and the error comes from the checks that follow.)
const restricted = function restricted(p, name) {
  if (typeof name !== "string") return false;
  if (p.ecma < 5) return true;
  const n = name.length;
  if (n < 2 || n > 10) return false;
  const c0 = name.charCodeAt(0), c1 = name.charCodeAt(1);
  if (c0 < 97 || c0 > 121 || c1 >= 128) return false;
  const i = R_SHAPE[shapeIndex(n, c0, c1)];
  return i >= 0 && R_NAMES[i] === name;
}

// operator token values (strings) without slicing the input
const OP1 = new Array(128).fill(undefined);
for (const c of "=!~+-*/%<>&|^?.") OP1[c.charCodeAt(0)] = c;
const OP2 = new Map();
for (const op of ["==", "!=", "+=", "-=", "*=", "/=", "%=", "<=", ">=", "&=", "|=", "^=", "&&", "||", "??", "++", "--", "<<", ">>", "**", "?."])
  OP2.set((op.charCodeAt(0) << 8) | op.charCodeAt(1), op);

// single-character punctuation tokens (not the backquote: ES2015+)
const PUNCT1 = new Int8Array(128).fill(-1);
PUNCT1[40] = T_PARENL; PUNCT1[41] = T_PARENR; PUNCT1[59] = T_SEMI; PUNCT1[44] = T_COMMA;
PUNCT1[91] = T_BRACKETL; PUNCT1[93] = T_BRACKETR; PUNCT1[123] = T_BRACEL; PUNCT1[125] = T_BRACER;
PUNCT1[58] = T_COLON;

// token contexts (acorn's TokContext objects)
const C_B_STAT = 0, C_B_EXPR = 1, C_B_TMPL = 2, C_P_STAT = 3, C_P_EXPR = 4, C_Q_TMPL = 5,
  C_F_STAT = 6, C_F_EXPR = 7, C_F_EXPR_GEN = 8, C_F_GEN = 9,
  // acorn-jsx's tc_oTag ("<tag"), tc_cTag ("</tag"), tc_expr ("<tag>...</tag>", preserveSpace)
  C_J_OTAG = 10, C_J_CTAG = 11, C_J_EXPR = 12;
const CTX_IS_EXPR = [false, true, false, false, true, true, false, true, true, false, false, false, true];
const CTX_IS_FUNC = [false, false, false, false, false, false, true, true, true, true, false, false, false];
const CTX_IS_GEN = [false, false, false, false, false, false, false, false, true, true, false, false, false];
const CTX_OBJ = [acornTC.b_stat, acornTC.b_expr, acornTC.b_tmpl, acornTC.p_stat, acornTC.p_expr, acornTC.q_tmpl,
  acornTC.f_stat, acornTC.f_expr, acornTC.f_expr_gen, acornTC.f_gen, null, null, null];

// scopes
const SCOPE_TOP = 1, SCOPE_FUNCTION = 2, SCOPE_ASYNC = 4, SCOPE_GENERATOR = 8, SCOPE_ARROW = 16,
  SCOPE_SIMPLE_CATCH = 32, SCOPE_SUPER = 64, SCOPE_DIRECT_SUPER = 128, SCOPE_CLASS_STATIC_BLOCK = 256,
  SCOPE_CLASS_FIELD_INIT = 512, SCOPE_SWITCH = 1024,
  SCOPE_VAR = SCOPE_TOP | SCOPE_FUNCTION | SCOPE_CLASS_STATIC_BLOCK;
const functionFlags = function functionFlags(async, generator) {
  return SCOPE_FUNCTION | (async ? SCOPE_ASYNC : 0) | (generator ? SCOPE_GENERATOR : 0);
}
const BIND_NONE = 0, BIND_VAR = 1, BIND_LEXICAL = 2, BIND_FUNCTION = 3, BIND_SIMPLE_CATCH = 4, BIND_OUTSIDE = 5;

// name lists: small arrays, promoted to Sets when they grow
const lhas = function lhas(l, name) {
  if (l === null) return false;
  if (l instanceof Set) return l.has(name);
  for (let i = 0; i < l.length; i++) if (l[i] === name) return true;
  return false;
}
const ladd = function ladd(l, name) {
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
  ;                              
  ;                     
  ;                         
  ;                  
  ;                      
  ;                    
  ;                      
  ;                
  ;                     
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
  ;                        
  ;                                
  ;                              
  ;                            
  ;                          
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
const rdeAcquire = function rdeAcquire(p) {
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
// order acorn's parse functions assign them). A constructor takes (p, start,
// startLoc, fields...) and ends the node at the last token; the few node
// types whose keys depend on the ecmaVersion have one constructor per key
// order (the arguments stay the same, `=a,b` gives the fields assigned, in
// order; `*` stands for the previous entry's type and arguments).
//
// The constructors are compiled from source (one `new Function` for all,
// when the first parse runs, not while the module loads) so that each has
// its own monomorphic store sites; they take the parse state as their first
// argument. The extra keys (loc, sourceFile, range) are added by a helper of
// each type's own (inlined by V8, with store sites of its own), compiled when
// the first parse with locations / ranges / directSourceFile runs. (One
// constructor per type for every option: call sites that see constructors
// for several option sets get slower.) Where `new Function` is not allowed
// (CSP), equivalent closures are used.

// the previous token's end position
const leloc = function leloc(p) {
  let o = p.lastTokEndLoc;
  if (o === null) o = p.lastTokEndLoc = new Position(p.lastTokEndLine, p.lastTokEnd - p.lastTokEndLS);
  return o;
}

const NODE_SPEC =
  "Program:body,sourceType;ExpressionStatement:expression;BlockStatement:body;EmptyStatement:;DebuggerStatement:;" +
  "WithStatement:object,body;ReturnStatement:argument;LabeledStatement:body,label;BreakStatement:label;" +
  "ContinueStatement:label;IfStatement:test,consequent,alternate;SwitchStatement:discriminant,cases;" +
  "SwitchCase:consequent,test;ThrowStatement:argument;TryStatement:block,handler,finalizer;" +
  "CatchClause:param,body;WhileStatement:test,body;DoWhileStatement:body,test;ForStatement:init,test,update,body;" +
  "ForInStatement:left,right,body;ForOfStatement:await,left,right,body;*=left,right,body;" +
  "VariableDeclaration:declarations,kind;VariableDeclarator:id,init;" +
  // functions: (id, expression, generator, async, params, body) -- ES2017+, ES2015/16, ES5
  "FunctionDeclaration:id,expression,generator,async,params,body;*=id,expression,generator,params,body;" +
  "*=id,params,body,expression;FunctionExpression:id,expression,generator,async,params,body;" +
  "*=id,expression,generator,params,body;*=id,params,body,expression;" +
  "ArrowFunctionExpression:id,expression,generator,async,params,body;*=id,expression,generator,params,body;" +
  "ClassDeclaration:id,superClass,body;ClassExpression:id,superClass,body;ClassBody:body;" +
  "MethodDefinition:static,computed,key,kind,value;PropertyDefinition:static,computed,key,value;StaticBlock:body;" +
  "Super:;ThisExpression:;Identifier:name;PrivateIdentifier:name;Literal:value,raw;Literal:value,raw,bigint;" +
  "Literal:value,raw,regex;ArrayExpression:elements;ObjectExpression:properties;ObjectPattern:properties;" +
  "ArrayPattern:elements;Property:method,shorthand,computed,key,value,kind;*=key,value,kind;" +
  "SpreadElement:argument;RestElement:argument;TemplateLiteral:expressions,quasis;TemplateElement:value,tail;" +
  "TaggedTemplateExpression:tag,quasi;SequenceExpression:expressions;UnaryExpression:operator,prefix,argument;" +
  "UpdateExpression:operator,prefix,argument;BinaryExpression:left,operator,right;" +
  "LogicalExpression:left,operator,right;AssignmentExpression:operator,left,right;AssignmentPattern:left,right;" +
  "ConditionalExpression:test,consequent,alternate;CallExpression:callee,arguments,optional;*=callee,arguments;" +
  "NewExpression:callee,arguments;MemberExpression:object,property,computed,optional;*=object,property,computed;" +
  "ChainExpression:expression;YieldExpression:delegate,argument;AwaitExpression:argument;" +
  "MetaProperty:meta,property;ImportExpression:source,options;*=source;ParenthesizedExpression:expression;" +
  "ImportDeclaration:specifiers,source,attributes;*=specifiers,source;ImportSpecifier:imported,local;" +
  "ImportDefaultSpecifier:local;ImportNamespaceSpecifier:local;ImportAttribute:key,value;" +
  "ExportNamedDeclaration:declaration,specifiers,source,attributes;*=declaration,specifiers,source;" +
  "ExportDefaultDeclaration:declaration;ExportAllDeclaration:exported,source,attributes;*=exported,source;" +
  "*=source;ExportSpecifier:local,exported;" +
  // acorn-jsx nodes (key order as acorn-jsx assigns them); JSXText comes
  // from acorn's parseLiteral (incl. its "raw ends with n" bigint rule)
  "JSXIdentifier:name;JSXNamespacedName:namespace,name;JSXMemberExpression:object,property;JSXEmptyExpression:;" +
  "JSXExpressionContainer:expression;JSXSpreadAttribute:argument;JSXAttribute:name,value;" +
  "JSXOpeningElement:attributes,name,selfClosing;JSXOpeningFragment:attributes,selfClosing;" +
  "JSXClosingElement:name;JSXClosingFragment:;JSXElement:openingElement,closingElement,children;" +
  "JSXFragment:openingFragment,closingFragment,children;JSXText:value,raw;JSXText:value,raw,bigint";

// the extra-key helpers, by constructor (filled by defExtras)
const nodeExtras = [];

// The constructors, in NODE_SPEC order
function defNodes(spec) {
  // [type, arguments, fields assigned] for each entry
  const defs = [];
  let type = "", params = "";
  for (const d of spec.split(";")) {
    const c = d.indexOf(":"), e = d.indexOf("=");
    if (d[0] !== "*") {
      type = d.slice(0, c);
      params = e < 0 ? d.slice(c + 1) : d.slice(c + 1, e);
    }
    defs.push([type, params, e < 0 ? params : d.slice(e + 1)]);
  }
  let ctors;
  try {
    // "T:a,b=b" -> function T(p,s,sl,a,b){this.type="T";this.start=s;this.end=p.lastTokEnd;if(p.xtra)X[i](this,p,s,sl);this.b=b;}
    let src = "";
    for (let i = 0; i < defs.length; i++) {
      const [type, params, assigned] = defs[i];
      src += `${i ? "," : ""}function ${type}(p,s,sl,${params}){this.type="${type}";this.start=s;this.end=p.lastTokEnd;if(p.xtra)X[${i}](this,p,s,sl);`;
      if (assigned) for (const f of assigned.split(",")) src += `this.${f}=${f};`;
      src += "}";
    }
    ctors = new Function("X", "return[" + src + "]")(nodeExtras);
  } catch {
    // (no eval: generic constructors, same keys and values)
    ctors = defs.map(([type, params, assigned], i) => {
      const names = params ? params.split(",") : [];
      const idx = assigned ? assigned.split(",").map((f) => names.indexOf(f) + 3) : [];
      return function (           p, s, sl) {
        this.type = type;
        this.start = s;
        this.end = p.lastTokEnd;
        if (p.xtra) nodeExtras[i](this, p, s, sl);
        for (let k = 0; k < idx.length; k++) this[names[idx[k] - 3]] = arguments[idx[k]];
      };
    });
  }
  for (const C of ctors) C.prototype = Node.prototype;
  return ctors;
}

// the extra-key helpers (loc, sourceFile, range), one per constructor
function defExtras(n) {
  let fns;
  try {
    const one =
      "function(n,p,s,sl){if(p.locations)n.loc=new SL(p,sl,p.lastTokEndLoc===null?LEL(p):p.lastTokEndLoc);" +
      "if(p.directSourceFile)n.sourceFile=p.directSourceFile;if(p.ranges)n.range=[s,p.lastTokEnd]}";
    fns = new Function("SL", "LEL", "return[" + (one + ",").repeat(n - 1) + one + "]")(SourceLocation, leloc);
  } catch {
    const extra = function (n, p, s, sl) {
      if (p.locations) n.loc = new SourceLocation(p, sl, leloc(p));
      if (p.directSourceFile) n.sourceFile = p.directSourceFile;
      if (p.ranges) n.range = [s, p.lastTokEnd];
    };
    fns = new Array(n).fill(extra);
  }
  for (let i = 0; i < n; i++) nodeExtras[i] = fns[i];
}

// the constructors in use (set by selectNodes)
var NProgram, NExpressionStatement, NBlockStatement, NEmptyStatement, NDebuggerStatement,
  NWithStatement, NReturnStatement, NLabeledStatement, NBreakStatement, NContinueStatement,
  NIfStatement, NSwitchStatement, NSwitchCase, NThrowStatement,
  NTryStatement, NCatchClause, NWhileStatement, NDoWhileStatement,
  NForStatement, NForInStatement, NVariableDeclaration, NVariableDeclarator,
  NClassDeclaration, NClassExpression, NClassBody,
  NMethodDefinition, NPropertyDefinition, NStaticBlock,
  NSuper, NThisExpression, NIdentifier, NPrivateIdentifier, NLiteral, NLiteralBig, NLiteralRe,
  NArrayExpression, NObjectExpression, NObjectPattern, NArrayPattern,
  NSpreadElement, NRestElement, NTemplateLiteral, NTemplateElement,
  NTaggedTemplateExpression, NSequenceExpression, NUnaryExpression,
  NUpdateExpression, NBinaryExpression, NLogicalExpression,
  NAssignmentExpression, NAssignmentPattern, NConditionalExpression,
  NNewExpression, NChainExpression, NYieldExpression, NAwaitExpression, NMetaProperty,
  NParenthesizedExpression, NImportSpecifier, NImportDefaultSpecifier, NImportNamespaceSpecifier, NImportAttribute,
  NExportDefaultDeclaration, NExportSpecifier,
  NJSXIdentifier, NJSXNamespacedName, NJSXMemberExpression, NJSXEmptyExpression,
  NJSXExpressionContainer, NJSXSpreadAttribute, NJSXAttribute,
  NJSXOpeningElement, NJSXOpeningFragment, NJSXClosingElement,
  NJSXClosingFragment, NJSXElement, NJSXFragment,
  NJSXText, NJSXTextBig,
  // (the ones whose key order depends on the ecmaVersion)
  NForOfStatement, NFunctionDeclaration, NFunctionExpression, NArrowFunctionExpression, NProperty, NCallExpression,
  NMemberExpression, NImportExpression, NImportDeclaration, NExportNamedDeclaration, NExportAllDeclaration;

// the constructors (made by the first parse)
let nodeSet = null;

// the constructors for ecmaVersion v
function selectNodes(v) {
  if (nodeSet === null) nodeSet = defNodes(NODE_SPEC);
  const set = nodeSet;
  let NForOfStatement9, NForOfStatement6, NFunctionDeclaration8, NFunctionDeclaration6, NFunctionDeclaration5,
    NFunctionExpression8, NFunctionExpression6, NFunctionExpression5, NArrowFunctionExpression8, NArrowFunctionExpression6,
    NProperty6, NProperty5, NCallExpression11, NCallExpression5, NMemberExpression11, NMemberExpression5,
    NImportExpression16, NImportExpression11, NImportDeclaration16, NImportDeclaration6,
    NExportNamedDeclaration16, NExportNamedDeclaration6, NExportAllDeclaration16, NExportAllDeclaration11, NExportAllDeclaration6;
  [
  NProgram, NExpressionStatement, NBlockStatement, NEmptyStatement, NDebuggerStatement,
  NWithStatement, NReturnStatement, NLabeledStatement, NBreakStatement, NContinueStatement,
  NIfStatement, NSwitchStatement, NSwitchCase, NThrowStatement,
  NTryStatement, NCatchClause, NWhileStatement, NDoWhileStatement,
  NForStatement, NForInStatement, NForOfStatement9,
  NForOfStatement6, NVariableDeclaration, NVariableDeclarator,
  NFunctionDeclaration8, NFunctionDeclaration6, NFunctionDeclaration5,
  NFunctionExpression8, NFunctionExpression6, NFunctionExpression5,
  NArrowFunctionExpression8, NArrowFunctionExpression6,
  NClassDeclaration, NClassExpression, NClassBody,
  NMethodDefinition, NPropertyDefinition, NStaticBlock,
  NSuper, NThisExpression, NIdentifier, NPrivateIdentifier, NLiteral, NLiteralBig, NLiteralRe,
  NArrayExpression, NObjectExpression, NObjectPattern, NArrayPattern,
  NProperty6, NProperty5,
  NSpreadElement, NRestElement, NTemplateLiteral, NTemplateElement,
  NTaggedTemplateExpression, NSequenceExpression, NUnaryExpression,
  NUpdateExpression, NBinaryExpression, NLogicalExpression,
  NAssignmentExpression, NAssignmentPattern, NConditionalExpression,
  NCallExpression11, NCallExpression5, NNewExpression,
  NMemberExpression11, NMemberExpression5,
  NChainExpression, NYieldExpression, NAwaitExpression, NMetaProperty,
  NImportExpression16, NImportExpression11, NParenthesizedExpression,
  NImportDeclaration16, NImportDeclaration6,
  NImportSpecifier, NImportDefaultSpecifier, NImportNamespaceSpecifier, NImportAttribute,
  NExportNamedDeclaration16, NExportNamedDeclaration6,
  NExportDefaultDeclaration,
  NExportAllDeclaration16, NExportAllDeclaration11, NExportAllDeclaration6,
  NExportSpecifier,
  NJSXIdentifier, NJSXNamespacedName, NJSXMemberExpression, NJSXEmptyExpression,
  NJSXExpressionContainer, NJSXSpreadAttribute, NJSXAttribute,
  NJSXOpeningElement, NJSXOpeningFragment, NJSXClosingElement,
  NJSXClosingFragment, NJSXElement, NJSXFragment,
  NJSXText, NJSXTextBig,
  ] = set;
  NForOfStatement = v >= 9 ? NForOfStatement9 : NForOfStatement6;
  NFunctionDeclaration = v >= 8 ? NFunctionDeclaration8 : v >= 6 ? NFunctionDeclaration6 : NFunctionDeclaration5;
  NFunctionExpression = v >= 8 ? NFunctionExpression8 : v >= 6 ? NFunctionExpression6 : NFunctionExpression5;
  NArrowFunctionExpression = v >= 8 ? NArrowFunctionExpression8 : NArrowFunctionExpression6;
  NProperty = v >= 6 ? NProperty6 : NProperty5;
  NCallExpression = v >= 11 ? NCallExpression11 : NCallExpression5;
  NMemberExpression = v >= 11 ? NMemberExpression11 : NMemberExpression5;
  NImportExpression = v >= 16 ? NImportExpression16 : NImportExpression11;
  NImportDeclaration = v >= 16 ? NImportDeclaration16 : NImportDeclaration6;
  NExportNamedDeclaration = v >= 16 ? NExportNamedDeclaration16 : NExportNamedDeclaration6;
  NExportAllDeclaration = v >= 16 ? NExportAllDeclaration16 : v >= 11 ? NExportAllDeclaration11 : NExportAllDeclaration6;
}

// node with explicit end (finishNodeAt)
const setEnd = function setEnd(p, n, e, endLoc) {
  n.end = e;
  if (p.locations) n.loc.end = endLoc;
  if (p.ranges) n.range[1] = e;
  return n;
}

// acorn's copyNode: a shallow copy (loc/range objects shared)
const copyNode = function copyNode(p, node) {
  const c = new Node(p, node.start, p.startLoc);
  for (const prop in node) c[prop] = node[prop];
  return c;
}

// acorn's finishNodeAt
const finishNodeAt = function finishNodeAt(p, node, t, e, loc) {
  node.type = t;
  node.end = e;
  if (p.options.locations) node.loc.end = loc;
  if (p.options.ranges) node.range[1] = e;
  return node;
}

// AST lists are collected on a per-parse scratch stack (stk / sp) and
// copied into exact-size arrays: an array grown by push() keeps a 17-slot
// backing store (three times the memory of an exact 1-element array), and
// ASTs are full of small lists that all survive into the old generation.
const listFrom = function listFrom(p, base) {
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

// regexp validation (acorn's validator, regexp.mjs), successes cached per
// ecmaVersion + pattern + flags
const regexpOk = new Map();
const validateRegExp = function validateRegExp(p, at, pattern, flags) {
  const key = p.ecma + flags + "/" + pattern;
  if (regexpOk.has(key)) return;
  acornValidateRegExp(p.ecma, (a, m) => raise(p, a, m), at, pattern, flags);
  if (regexpOk.size > 5000) regexpOk.clear();
  regexpOk.set(key, true);
}

const INVALID_TEMPLATE_ESCAPE = { invalidTemplateEscape: true };

// acorn-jsx's getQualifiedJSXName
const jsxQualifiedName = function jsxQualifiedName(object) {
  if (!object) return object;
  if (object.type === "JSXIdentifier") return object.name;
  if (object.type === "JSXNamespacedName") return object.namespace.name + ":" + object.name.name;
  if (object.type === "JSXMemberExpression") return jsxQualifiedName(object.object) + "." + jsxQualifiedName(object.property);
}

// ------------------------------------------------------------ acorn API facade
// For Parser.extend() subclasses overriding parseFunctionBody (override.mjs):
// the subclass's method runs with `this` bound to a BodyFacade, which shows
// the fast parser's state the way acorn's Parser would.

export class BodyFacade {
  ;                   
  ;              
  constructor(p) {
    this.p = p;
    this.fnNode = null;
  }
  get type() {
    return TT_OBJ[this.p.type];
  }
  get endLoc() {
    return eloc(this.p);
  }
  get lastTokEndLoc() {
    return leloc(this.p);
  }
  next(ignoreEscapeSequenceInKeyword) {
    next(this.p, ignoreEscapeSequenceInKeyword);
  }
  startNode() {
    return new Node(this.p, this.p.start, this.p.startLoc);
  }
  startNodeAt(at, loc) {
    return new Node(this.p, at, loc);
  }
  finishNode(node, t) {
    return finishNodeAt(this.p, node, t, this.p.lastTokEnd, leloc(this.p));
  }
  finishNodeAt(node, t, at, loc) {
    return finishNodeAt(this.p, node, t, at, loc);
  }
  exitScope() {
    exitScope(this.p);
  }
  eat(t) {
    if (TT_OBJ[this.p.type] === t) {
      next(this.p);
      return true;
    }
    return false;
  }
  expect(t) {
    this.eat(t) || this.unexpected();
  }
  unexpected(at ) {
    unexpected(this.p, at);
  }
  raise(at, message) {
    raise(this.p, at, message);
  }
  raiseRecoverable(at, message) {
    raise(this.p, at, message);
  }
  // super.parseFunctionBody(node, isArrowFunction, isMethod, forInit): acorn's
  // parseFunctionBody, i.e. the fast parser's, on the function node
  superParseFunctionBody(node, isArrowFunction, isMethod, forInit) {
    // (the override analysis only admits calls with the method's own node)
    if (node !== this.fnNode) throw new Error("fast-acorn: another node");
    node.body = parseFunctionBody(this.p, node.params, node.id, isArrowFunction, isMethod, forInit, node.start);
    node.expression = this.p.fbExpression;
  }
}
// (value, start, end, pos, startLoc, lastTokStart, lastTokEnd, lastTokStartLoc)
for (const k of ["value", "start", "end", "pos", "startLoc", "lastTokStart", "lastTokEnd", "lastTokStartLoc"])
  Object.defineProperty(BodyFacade.prototype, k, {
    get() {
      return this.p[k];
    },
    configurable: true,
  });

// ------------------------------------------------------------ the parser

// Read-only per-configuration tables shared by all parses (building them
// per parse dominated the cost of tiny parses like parseExpressionAt)
const RESERVED_ES3 = "abstract boolean byte char class double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile";
const reservedWordCache = [];
const reservedWordSets = function reservedWordSets(allowReserved, v, isModule) {
  const key = (allowReserved === true ? 0 : v >= 6 ? 2 : v === 5 ? 4 : 6) + (isModule ? 1 : 0);
  let sets = reservedWordCache[key];
  if (sets === undefined) {
    let reserved = "";
    if (allowReserved !== true) {
      reserved = v >= 6 ? "enum" : v === 5 ? "class enum extends super const export import" : RESERVED_ES3;
      if (isModule) reserved += " await";
    }
    const strictWords = (reserved ? reserved + " " : "") + "implements interface let package private protected public static yield";
    sets = [new Set(reserved ? reserved.split(" ") : []), new Set(strictWords.split(" ")), new Set((strictWords + " eval arguments").split(" "))];
    reservedWordCache[key] = sets;
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
const linesBefore = function linesBefore(src, ls) {
  if (lbInput !== src) {
    lbInput = src;
    lbStarts = [];
    lbScanned = 0;
  }
  if (lbScanned < ls) {
    const starts = lbStarts;
    let i = lbScanned;
    for (; i < ls; i++) {
      const c = src.charCodeAt(i);
      if (c === 13) {
        starts.push(i);
        if (src.charCodeAt(i + 1) === 10) i++;
      } else if (c === 10 || c === 0x2028 || c === 0x2029) starts.push(i);
    }
    lbScanned = i;
  }
  const starts = lbStarts;
  let lo = 0, hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] < ls) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

// the ecmaVersion the node constructors are selected for
var nodesFor = -1;

// ---- the parse state (every field initialised with a value of its type, so
// V8 keeps typed field representations)
function State(         ) {
  this.options = null;
  this.input = "";
  this.len = 0;
  this.ecma = 0;
  this.locations = false;
  this.ranges = false;
  this.directSourceFile = null;
  this.sourceFile = null;
  this.xtra = false;
  this.preserveParens = false;
  this.allowReservedNever = false;
  this.checkPrivateFields = false;
  this.onToken = null;
  this.onComment = null;
  this.jsx = false;
  this.jsxNamespaces = false;
  this.jsxNamespacedObjects = false;
  this.jsxTT = null;
  this.jsxReadEntity = null;
  this.bodyOverride = null;
  this.facade = null;
  this.reservedWords = null;
  this.reservedWordsStrict = null;
  this.reservedWordsStrictBind = null;
  this.kwAll = false;
  this.kwModule5 = false;
  this.containsEsc = false;
  this.pos = 0;
  this.curLine = 0;
  this.lineStart = 0;
  this.type = 0;
  this.value = null;
  this.start = 0;
  this.end = 0;
  this.endLine = 0;
  this.endLS = 0;
  this.startLoc = null;
  this.endLoc = null;
  this.lastTokStart = 0;
  this.lastTokEnd = 0;
  this.lastTokStartLoc = null;
  this.lastTokEndLoc = null;
  this.lastTokEndLine = 0;
  this.lastTokEndLS = 0;
  this.nlBefore = false;
  this.ctx = null;
  this.exprAllowed = false;
  this.inTemplateElement = false;
  this.pnComputed = false;
  this.rdePool = [];
  this.stk = null;
  this.sp = 0;
  this.rdeDepth = 0;
  this.fbExpression = false;
  this.clashNames = [];
  this.inModule = false;
  this.strict = false;
  this.potentialArrowAt = 0;
  this.potentialArrowInForAwait = false;
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.labels = null;
  this.undefinedExports = null;
  this.scopePool = [];
  this.scopeStack = null;
  this.topCanAwait = false;
  this.privateNameStack = null;
}

// acorn's Parser constructor, for an input String()-converted and options
// normalized by getOptions() already. startPos: parseExpressionAt's;
// jsxOpts: null, or the options of a recognised acorn-jsx plugin class
// ({ allowNamespaces, allowNamespacedObjects, tokTypes }): parse like that
// class; override: the parseFunctionBody of a recognised subclass.
const init = function init(p, opts, src, startPos, jsxOpts, override) {
  p.options = opts;
  p.jsx = jsxOpts != null;
  p.jsxNamespaces = p.jsx && jsxOpts.allowNamespaces === true;
  p.jsxNamespacedObjects = p.jsx && jsxOpts.allowNamespacedObjects === true;
  p.jsxTT = p.jsx ? jsxOpts.tokTypes : null;
  p.jsxReadEntity = p.jsx ? jsxOpts.readEntity : null;
  p.bodyOverride = override != null ? override : null;
  p.facade = override != null ? new BodyFacade(p) : null;
  p.input = src;
  p.len = src.length;
  p.ecma = opts.ecmaVersion;
  p.locations = !!opts.locations;
  p.ranges = !!opts.ranges;
  p.directSourceFile = opts.directSourceFile;
  p.sourceFile = opts.sourceFile;
  p.xtra = p.locations || !!p.directSourceFile || p.ranges;
  p.preserveParens = !!opts.preserveParens;
  p.allowReservedNever = opts.allowReserved === "never";
  p.checkPrivateFields = !!opts.checkPrivateFields;
  p.onToken = opts.onToken || null;
  p.onComment = opts.onComment || null;

  // keywords: all of them from ES2015 on; before, not const / class /
  // extends / super, and export / import only in modules
  p.kwAll = p.ecma >= 6;
  p.kwModule5 = opts.sourceType === "module";
  const rw = reservedWordSets(opts.allowReserved, p.ecma, opts.sourceType === "module");
  p.reservedWords = rw[0];
  p.reservedWordsStrict = rw[1];
  p.reservedWordsStrictBind = rw[2];

  p.containsEsc = false;
  p.pos = startPos || 0;
  p.curLine = 1;
  if (opts.startLocation) {
    p.lineStart = p.pos - opts.startLocation.column;
    p.curLine = opts.startLocation.line;
  } else if (startPos) {
    p.lineStart = src.lastIndexOf("\n", startPos - 1) + 1;
    if (p.locations) p.curLine = linesBefore(src, p.lineStart);
  } else {
    p.lineStart = 0;
  }
  p.type = T_EOF;
  p.value = null;
  p.start = p.pos;
  p.end = p.pos;
  // With locations, token *end* Positions are created lazily: endLoc /
  // lastTokEndLoc are null until something reads them through eloc() /
  // leloc(), which create the Position from the recorded line / line start
  // and cache it in the slot, so every reader gets the same object (as with
  // acorn's eagerly created ones). About half of them are never read.
  // (Start positions are read at many places; they stay eager.)
  p.endLine = p.lastTokEndLine = p.curLine;
  p.endLS = p.lastTokEndLS = p.lineStart;
  p.startLoc = p.endLoc = curPosition(p);
  p.lastTokStartLoc = p.lastTokEndLoc = null;
  p.lastTokStart = p.lastTokEnd = p.pos;
  p.nlBefore = false;
  p.ctx = [C_B_STAT];
  p.exprAllowed = true;
  p.inTemplateElement = false;
  p.pnComputed = false;
  p.stk = [];
  p.sp = 0;
  p.rdeDepth = 0;
  p.fbExpression = false;

  p.inModule = opts.sourceType === "module";
  p.strict = p.inModule || opts.strict === true || strictDirective(p, p.pos);
  p.potentialArrowAt = -1;
  p.potentialArrowInForAwait = false;
  p.yieldPos = p.awaitPos = p.awaitIdentPos = 0;
  p.labels = [];
  p.undefinedExports = null; // (created on first use)

  if (p.pos === 0 && opts.allowHashBang && src.charCodeAt(0) === 35 && src.charCodeAt(1) === 33) skipLineComment(p, 2);

  p.topCanAwait = (p.inModule && p.ecma >= 13) || !!opts.allowAwaitOutsideFunction;
  p.scopeStack = [];
  enterScope(p, opts.sourceType === "commonjs" ? SCOPE_FUNCTION : SCOPE_TOP);
  p.privateNameStack = [];
}

// ------------------------------------------------------------ parse runs

// parse (kind 0: a program, 1: an expression at `at`); stack overflows
// become acorn's SyntaxError.
// Every parse has a State of its own. (Reusing one is slower: once it is in
// V8's old generation, every store of a new object into it -- a token's
// Position, value, ... -- goes through the write barrier's slow path.)
const asParse = function asParse(kind, src, opts, at, jsxOpts, override) {
  const p = new State();
  const outerNodes = nodesFor;
  try {
    init(p, opts, src, at, jsxOpts, override);
    // (after init: a callback that init runs could start a parse of its own)
    if (p.ecma !== nodesFor) selectNodes((nodesFor = p.ecma));
    if (p.xtra && nodeExtras.length === 0) defExtras(nodeSet.length);
    if (kind === 0) {
      const s = p.start, sl = p.startLoc;
      nextToken(p);
      return parseTopLevel(p, s, sl);
    }
    nextToken(p);
    return parseExpression(p);
  } catch (e) {
    if (e instanceof Error && (/\bstack\b.*\b(exceeded|overflow)\b/i.test(e.message) || /\btoo much recursion\b/i.test(e.message)))
      raise(p, p.start, "Not enough stack space to parse input");
    throw e;
  } finally {
    // (a parse run from a callback of another: that one's node constructors back)
    if (outerNodes !== -1 && nodesFor !== outerNodes) selectNodes((nodesFor = outerNodes));
  }
}

// ------------------------------------------------------------ utilities

const curPosition = function curPosition(p) {
  if (p.locations) return new Position(p.curLine, p.pos - p.lineStart);
}

// the current token's end position
const eloc = function eloc(p) {
  let o = p.endLoc;
  if (o === null) o = p.endLoc = new Position(p.endLine, p.end - p.endLS);
  return o;
}


// acorn's raise / raiseRecoverable
function raise(p, at, message)        {
  const loc = getLineInfo(p.input, at);
  message += " (" + loc.line + ":" + loc.column + ")";
  if (p.sourceFile) message += " in " + p.sourceFile;
  const err = new SyntaxError(message)                                                             ;
  err.pos = at;
  err.loc = loc;
  err.raisedAt = p.pos;
  throw err;
}

function unexpected(p, at )        {
  raise(p, at != null ? at : p.start, "Unexpected token");
}

// acorn's strictDirective, written as a scanner (no regexps)
const strictDirective = function strictDirective(p, from) {
  if (p.ecma < 5) return false;
  for (;;) {
    // (acorn: skipWhiteSpace.exec(input)[0] with lastIndex = from; past the
    // end of the input that is null[0], a TypeError)
    // (lastIndex: ToLength(from))
    if ((from > 0 ? Math.floor(from) : 0) > p.input.length) (null       )[0];
    from = skipWS(p, from);
    const q = p.input.charCodeAt(from);
    if (q !== 34 && q !== 39) return false;
    // find the end of the string literal (\\ escapes anything, incl. newlines)
    let i = from + 1;
    for (;;) {
      if (i >= p.input.length) return false;
      const c = p.input.charCodeAt(i);
      if (c === 92) {
        i += 2;
        continue;
      }
      if (c === q) break;
      i++;
    }
    const content = p.input.slice(from + 1, i);
    const litEnd = i + 1;
    if (content === "use strict") {
      const after = skipWS(p, litEnd);
      const nx = p.input.charAt(after);
      if (nx === ";" || nx === "}") return true;
      let nl = false;
      for (let j = litEnd; j < after; j++) {
        if (isNewLine(p.input.charCodeAt(j))) {
          nl = true;
          break;
        }
      }
      return nl && !(/[(`.[+\-/*%<>=,?^&]/.test(nx) || (nx === "!" && p.input.charAt(after + 1) === "="));
    }
    from = skipWS(p, litEnd);
    if (p.input.charCodeAt(from) === 59) from++;
  }
}

// acorn's skipWhiteSpace regexp: /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g
// returns the position after whitespace and comments starting at `p`
const skipWS = function skipWS(p, q) {
  const src = p.input, n = src.length;
  for (;;) {
    if (q >= n) return q;
    const c = src.charCodeAt(q);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12) {
      q++;
      continue;
    }
    if (c === 47) {
      const n1 = src.charCodeAt(q + 1);
      if (n1 === 47) {
        // \/\/.* -- `.` does not match line terminators
        q += 2;
        while (q < n && !isNewLine(src.charCodeAt(q))) q++;
        continue;
      }
      if (n1 === 42) {
        const e = src.indexOf("*/", q + 2);
        if (e < 0) return q;
        q = e + 2;
        continue;
      }
      return q;
    }
    if (c >= 128 && isJsWhitespace(c)) {
      q++;
      continue;
    }
    return q;
  }
}

// is there a line break between p and q?
const hasBreak = function hasBreak(p, q1, q) {
  for (; q1 < q; q1++) if (isNewLine(p.input.charCodeAt(q1))) return true;
  return false;
}

const eat = function eat(p, t) {
  if (p.type === t) {
    next(p);
    return true;
  }
  return false;
}

const isContextual = function isContextual(p, name) {
  return p.type === T_NAME && p.value === name && !p.containsEsc;
}

const eatContextual = function eatContextual(p, name) {
  if (!isContextual(p, name)) return false;
  next(p);
  return true;
}

const expectContextual = function expectContextual(p, name) {
  if (!eatContextual(p, name)) unexpected(p);
}

const canInsertSemicolon = function canInsertSemicolon(p) {
  return p.type === T_EOF || p.type === T_BRACER || p.nlBefore;
}

const insertSemicolon = function insertSemicolon(p) {
  if (canInsertSemicolon(p)) {
    if (p.options.onInsertedSemicolon) {
      p.options.onInsertedSemicolon(p.lastTokEnd, leloc(p));
    }
    return true;
  }
}

const semicolon = function semicolon(p) {
  if (!eat(p, T_SEMI) && !insertSemicolon(p)) unexpected(p);
}

const afterTrailingComma = function afterTrailingComma(p, t, notNext ) {
  if (p.type === t) {
    if (p.options.onTrailingComma) {
      p.options.onTrailingComma(p.lastTokStart, p.lastTokStartLoc);
    }
    if (!notNext) next(p);
    return true;
  }
}

const expect = function expect(p, t) {
  if (p.type === t) next(p);
  else unexpected(p);
}

const checkPatternErrors = function checkPatternErrors(p, rde, isAssign) {
  if (!rde) return;
  if (rde.trailingComma > -1) raise(p, rde.trailingComma, "Comma is not permitted after the rest element");
  const parens = isAssign ? rde.parenthesizedAssign : rde.parenthesizedBind;
  if (parens > -1) raise(p, parens, isAssign ? "Assigning to rvalue" : "Parenthesized pattern");
}

const checkExpressionErrors = function checkExpressionErrors(p, rde, andThrow ) {
  if (!rde) return false;
  const shorthandAssign = rde.shorthandAssign;
  const doubleProto = rde.doubleProto;
  if (!andThrow) return shorthandAssign >= 0 || doubleProto >= 0;
  if (shorthandAssign >= 0) raise(p, shorthandAssign, "Shorthand property assignments are valid only in destructuring patterns");
  if (doubleProto >= 0) raise(p, doubleProto, "Redefinition of __proto__ property");
}

const checkYieldAwaitInDefaultParams = function checkYieldAwaitInDefaultParams(p) {
  if (p.yieldPos && (!p.awaitPos || p.yieldPos < p.awaitPos)) raise(p, p.yieldPos, "Yield expression cannot be a default value");
  if (p.awaitPos) raise(p, p.awaitPos, "Await expression cannot be a default value");
}

const isSimpleAssignTarget = function isSimpleAssignTarget(expr) {
  if (expr.type === "ParenthesizedExpression") return isSimpleAssignTarget(expr.expression);
  return expr.type === "Identifier" || expr.type === "MemberExpression";
}

// ------------------------------------------------------------ scope

const enterScope = function enterScope(p, flags) {
  const stack = p.scopeStack;
  const depth = stack.length;
  const parent = depth ? stack[depth - 1] : null;
  let sc = p.scopePool[depth];
  if (sc === undefined) p.scopePool[depth] = sc = new Scope(flags, parent, p.topCanAwait);
  else sc.init(flags, parent, p.topCanAwait);
  stack.push(sc);
}

const exitScope = function exitScope(p) {
  p.scopeStack.pop();
}

const currentScope = function currentScope(p) {
  return p.scopeStack[p.scopeStack.length - 1];
}

const currentVarScope = function currentVarScope(p) {
  return p.scopeStack[p.scopeStack.length - 1].varScope;
}

const currentThisScope = function currentThisScope(p) {
  return p.scopeStack[p.scopeStack.length - 1].thisScope;
}

const inFunction = function inFunction(p) {
  return (currentVarScope(p).flags & SCOPE_FUNCTION) > 0;
}
const inGenerator = function inGenerator(p) {
  return (currentVarScope(p).flags & SCOPE_GENERATOR) > 0;
}
const inAsync = function inAsync(p) {
  return (currentVarScope(p).flags & SCOPE_ASYNC) > 0;
}
const canAwait = function canAwait(p) {
  return p.scopeStack[p.scopeStack.length - 1].canAwait;
}
const allowReturn = function allowReturn(p) {
  if (inFunction(p)) return true;
  if (p.options.allowReturnOutsideFunction && currentVarScope(p).flags & SCOPE_TOP) return true;
  return false;
}
const allowSuper = function allowSuper(p) {
  return (currentThisScope(p).flags & SCOPE_SUPER) > 0 || p.options.allowSuperOutsideMethod;
}
const allowDirectSuper = function allowDirectSuper(p) {
  return (currentThisScope(p).flags & SCOPE_DIRECT_SUPER) > 0;
}
const treatFunctionsAsVar = function treatFunctionsAsVar(p) {
  return treatFunctionsAsVarInScope(p, currentScope(p));
}
const allowNewDotTarget = function allowNewDotTarget(p) {
  return p.scopeStack[p.scopeStack.length - 1].allowNewDotTarget;
}
const allowUsing = function allowUsing(p) {
  const flags = currentScope(p).flags;
  if (flags & SCOPE_SWITCH) return false;
  if (!p.inModule && flags & SCOPE_TOP) return false;
  return true;
}
const inClassStaticBlock = function inClassStaticBlock(p) {
  return (currentVarScope(p).flags & SCOPE_CLASS_STATIC_BLOCK) > 0;
}

const treatFunctionsAsVarInScope = function treatFunctionsAsVarInScope(p, scope) {
  return scope.flags & SCOPE_FUNCTION || (!p.inModule && scope.flags & SCOPE_TOP);
}

const declareName = function declareName(p, name, bindingType, at) {
  let redeclared = false;
  if (bindingType === BIND_LEXICAL) {
    const scope = currentScope(p);
    redeclared = lhas(scope.lexical, name) || lhas(scope.functions, name) || lhas(scope.var, name);
    if (scope.lexical === null) scope.firstLexical = name;
    scope.lexical = ladd(scope.lexical, name);
    if (p.inModule && scope.flags & SCOPE_TOP && p.undefinedExports !== null) delete p.undefinedExports[name];
  } else if (bindingType === BIND_SIMPLE_CATCH) {
    const scope = currentScope(p);
    if (scope.lexical === null) scope.firstLexical = name;
    scope.lexical = ladd(scope.lexical, name);
  } else if (bindingType === BIND_FUNCTION) {
    const scope = currentScope(p);
    if (treatFunctionsAsVar(p)) redeclared = lhas(scope.lexical, name);
    else redeclared = lhas(scope.lexical, name) || lhas(scope.var, name);
    scope.functions = ladd(scope.functions, name);
  } else {
    for (let i = p.scopeStack.length - 1; i >= 0; --i) {
      const scope = p.scopeStack[i];
      if (
        (lhas(scope.lexical, name) && !(scope.flags & SCOPE_SIMPLE_CATCH && scope.firstLexical === name)) ||
        (!treatFunctionsAsVarInScope(p, scope) && lhas(scope.functions, name))
      ) {
        redeclared = true;
        break;
      }
      scope.var = ladd(scope.var, name);
      if (p.inModule && scope.flags & SCOPE_TOP && p.undefinedExports !== null) delete p.undefinedExports[name];
      if (scope.flags & SCOPE_VAR) break;
    }
  }
  if (redeclared) raise(p, at, "Identifier '" + name + "' has already been declared");
}

const checkLocalExport = function checkLocalExport(p, id) {
  const top = p.scopeStack[0];
  if (!lhas(top.lexical, id.name) && !lhas(top.var, id.name)) (p.undefinedExports === null ? (p.undefinedExports = Object.create(null)) : p.undefinedExports)[id.name] = id;
}

// ------------------------------------------------------------ tokenizer

// acorn's TokenType object of a token type (JSX: the plugin's own)
const JSX_TT_NAMES = ["jsxName", "jsxText", "jsxTagStart", "jsxTagEnd"];
const ttObj = function ttObj(p, t) {
  return t >= T_JSXNAME && t < T_KW_FIRST ? p.jsxTT[JSX_TT_NAMES[t - T_JSXNAME]] : TT_OBJ[t];
}

// acorn's Token for the current token (the object onToken and getToken hand out)
function FToken(           p, t, v, s, e) {
  this.type = t;
  this.value = v;
  this.start = s;
  this.end = e;
  if (p.locations) this.loc = new SourceLocation(p, p.startLoc, eloc(p));
  if (p.ranges) this.range = [s, e];
}
FToken.prototype = Token.prototype;
const currentToken = function currentToken(p) {
  return new FToken(p, ttObj(p, p.type), p.value, p.start, p.end);
}
const emitToken = function emitToken(p) {
  p.options.onToken(currentToken(p));
}
function escapedKeyword(p) {
  raise(p, p.start, "Escape sequence in keyword " + KW_NAME[p.type]);
}

const next = function next(p, ignoreEscapeSequenceInKeyword ) {
  if (p.containsEsc && !ignoreEscapeSequenceInKeyword && p.type >= T_KW_FIRST) escapedKeyword(p);
  if (p.onToken !== null) emitToken(p);
  p.lastTokEnd = p.end;
  p.lastTokStart = p.start;
  p.lastTokEndLoc = p.endLoc;
  p.lastTokStartLoc = p.startLoc;
  if (p.locations) {
    p.lastTokEndLine = p.endLine;
    p.lastTokEndLS = p.endLS;
  }
  p.nlBefore = false;
  nextToken(p);
}

const nextToken = function nextToken(p) {
  const cx = p.ctx;
  let q = p.pos;
  let code;
  const cur = cx[cx.length - 1];
  if (cur === C_Q_TMPL || cur === C_J_EXPR) {
    // contexts with preserveSpace: q_tmpl (override: template token) and
    // acorn-jsx's tc_expr (readToken -> jsx_readToken)
    p.start = q;
    if (p.locations) p.startLoc = new Position(p.curLine, q - p.lineStart);
    if (q >= p.len) return finishToken(p, T_EOF, undefined);
    if (cur === C_Q_TMPL) return tryReadTemplateToken(p);
    return jsxReadToken(p);
  }
  code = p.input.charCodeAt(q);
  if (code === 32) code = p.input.charCodeAt(++q);
  if (code <= 32 || code === 47 || code >= 128) {
    p.pos = q;
    skipSpace(p);
    q = p.pos;
    code = p.input.charCodeAt(q);
  }
  p.start = q;
  if (p.locations) p.startLoc = new Position(p.curLine, q - p.lineStart);
  if (q >= p.len) {
    p.pos = q;
    return finishToken(p, T_EOF, undefined);
  }
  // (acorn reads curContext.override: an empty context stack is a TypeError)
  if (cur === undefined) return (cur       ).override;
  if (p.jsx && (code === 60 || cur === C_J_OTAG || cur === C_J_CTAG)) {
    p.pos = q;
    if (jsxReadTokenHook(p, code >= 0xd800 && code <= 0xdbff ? fullCharCodeAt(p, q) : code, cur)) return;
  }
  if (code < 128) {
    const t = PUNCT1[code];
    if (t >= 0) {
      p.pos = q + 1;
      return finishToken(p, t, undefined);
    }
    p.pos = q;
    if (ID_START[code] === 1 || code === 92) return readWord(p);
    return getTokenFromCode(p, code);
  }
  p.pos = q;
  const full = fullCharCodeAt(p, q);
  if (isIdentifierStart(full, p.ecma >= 6)) return readWord(p);
  return getTokenFromCode(p, full);
}

const fullCharCodeAt = function fullCharCodeAt(p, q) {
  const code = p.input.charCodeAt(q);
  if (code <= 0xd7ff || code >= 0xdc00) return code;
  const nx = p.input.charCodeAt(q + 1);
  return nx <= 0xdbff || nx >= 0xe000 ? code : (code << 10) + nx - 0x35fdc00;
}

const skipBlockComment = function skipBlockComment(p) {
  const src = p.input;
  const from = p.pos;
  const commentStartLoc = p.onComment !== null ? curPosition(p) : undefined;
  const e = src.indexOf("*/", (p.pos += 2));
  if (e === -1) raise(p, p.pos - 2, "Unterminated comment");
  p.pos = e + 2;
  if (p.locations || !p.nlBefore) {
    for (let i = from + 2; i < e; i++) {
      const c = src.charCodeAt(i);
      if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) {
        p.nlBefore = true;
        if (!p.locations) break;
        if (c === 13 && src.charCodeAt(i + 1) === 10) i++;
        ++p.curLine;
        p.lineStart = i + 1;
      }
    }
  }
  if (p.onComment !== null) p.options.onComment(true, src.slice(from + 2, e), from, p.pos, commentStartLoc, curPosition(p));
}

const skipLineComment = function skipLineComment(p, startSkip) {
  const src = p.input, n = p.len;
  const from = p.pos;
  const commentStartLoc = p.onComment !== null ? curPosition(p) : undefined;
  let q = p.pos + startSkip;
  let ch = src.charCodeAt(q);
  while (q < n && !(ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029)) ch = src.charCodeAt(++q);
  p.pos = q;
  if (p.onComment !== null) p.options.onComment(false, src.slice(from + startSkip, q), from, q, commentStartLoc, curPosition(p));
}

const skipSpace = function skipSpace(p) {
  const src = p.input, n = p.len;
  let q = p.pos;
  loop: while (q < n) {
    const ch = src.charCodeAt(q);
    switch (ch) {
      case 32:
      case 160:
        ++q;
        break;
      case 13:
        if (src.charCodeAt(q + 1) === 10) ++q;
      // falls through
      case 10:
      case 8232:
      case 8233:
        ++q;
        p.nlBefore = true;
        if (p.locations) {
          ++p.curLine;
          p.lineStart = q;
        }
        break;
      case 47:
        switch (src.charCodeAt(q + 1)) {
          case 42:
            p.pos = q;
            skipBlockComment(p);
            q = p.pos;
            break;
          case 47:
            p.pos = q;
            skipLineComment(p, 2);
            q = p.pos;
            break;
          default:
            break loop;
        }
        break;
      default:
        if ((ch > 8 && ch < 14) || (ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch)))) {
          ++q;
        } else {
          break loop;
        }
    }
  }
  p.pos = q;
}

const finishToken = function finishToken(p, t, val) {
  p.end = p.pos;
  if (p.locations) {
    p.endLoc = null;
    p.endLine = p.curLine;
    p.endLS = p.lineStart;
  }
  const prevType = p.type;
  p.type = t;
  p.value = val;
  updateContext(p, prevType);
}

// ---- token contexts (acorn's context.js)

const curContext = function curContext(p) {
  return p.ctx[p.ctx.length - 1];
}

const braceIsBlock = function braceIsBlock(p, prevType) {
  const parent = curContext(p);
  if (parent === C_F_EXPR || parent === C_F_STAT) return true;
  if (prevType === T_COLON && (parent === C_B_STAT || parent === C_B_EXPR)) return !CTX_IS_EXPR[parent];
  if (prevType === T_RETURN || (prevType === T_NAME && p.exprAllowed)) return p.nlBefore;
  if (prevType === T_ELSE || prevType === T_SEMI || prevType === T_EOF || prevType === T_PARENR || prevType === T_ARROW) return true;
  if (prevType === T_BRACEL) return parent === C_B_STAT;
  if (prevType === T_VAR || prevType === T_CONST || prevType === T_NAME) return false;
  return !p.exprAllowed;
}

const inGeneratorContext = function inGeneratorContext(p) {
  const cx = p.ctx;
  for (let i = cx.length - 1; i >= 1; i--) {
    const c = cx[i];
    if (CTX_IS_FUNC[c]) return CTX_IS_GEN[c];
  }
  return false;
}

const updateContext = function updateContext(p, prevType) {
  const t = p.type;
  const cx = p.ctx;
  if (p.jsx) {
    // acorn-jsx's updateContext override
    if (t === T_BRACEL) {
      const cur = cx[cx.length - 1];
      if (cur === C_J_OTAG) cx.push(C_B_EXPR);
      else if (cur === C_J_EXPR) cx.push(C_B_TMPL);
      else cx.push(braceIsBlock(p, prevType) ? C_B_STAT : C_B_EXPR);
      p.exprAllowed = true;
      return;
    }
    if (t === T_SLASH && prevType === T_JSXTAGSTART) {
      cx.length -= 2;
      cx.push(C_J_CTAG);
      p.exprAllowed = false;
      return;
    }
  }
  if (t >= T_KW_FIRST && prevType === T_DOT) {
    p.exprAllowed = false;
    return;
  }
  switch (t) {
    case T_PARENR:
    case T_BRACER: {
      if (cx.length === 1) {
        p.exprAllowed = true;
        return;
      }
      let out = cx.pop();
      if (out === C_B_STAT) {
        const top = cx[cx.length - 1];
        // (acorn reads curContext().token and out.isExpr: on an empty
        // context stack that is a TypeError)
        if (top === undefined) (top       ).token;
        if (CTX_IS_FUNC[top]) out = cx.pop();
      }
      if (out === undefined) (out       ).isExpr;
      p.exprAllowed = !CTX_IS_EXPR[out];
      return;
    }
    case T_BRACEL:
      cx.push(braceIsBlock(p, prevType) ? C_B_STAT : C_B_EXPR);
      p.exprAllowed = true;
      return;
    case T_DOLLARBRACEL:
      cx.push(C_B_TMPL);
      p.exprAllowed = true;
      return;
    case T_PARENL:
      cx.push(prevType === T_IF || prevType === T_FOR || prevType === T_WITH || prevType === T_WHILE ? C_P_STAT : C_P_EXPR);
      p.exprAllowed = true;
      return;
    case T_INCDEC:
      return;
    case T_FUNCTION:
    case T_CLASS:
      if (
        TF[prevType] & F_BEFORE &&
        prevType !== T_ELSE &&
        !(prevType === T_SEMI && cx[cx.length - 1] !== C_P_STAT) &&
        !(prevType === T_RETURN && p.nlBefore) &&
        !((prevType === T_COLON || prevType === T_BRACEL) && cx[cx.length - 1] === C_B_STAT)
      )
        cx.push(C_F_EXPR);
      else cx.push(C_F_STAT);
      p.exprAllowed = false;
      return;
    case T_COLON: {
      const top = cx[cx.length - 1];
      if (top === undefined) (top       ).token;
      if (CTX_IS_FUNC[top]) cx.pop();
    }
      p.exprAllowed = true;
      return;
    case T_BACKQUOTE:
      if (cx[cx.length - 1] === C_Q_TMPL) cx.pop();
      else cx.push(C_Q_TMPL);
      p.exprAllowed = false;
      return;
    case T_STAR:
      if (prevType === T_FUNCTION) {
        const index = cx.length - 1;
        cx[index] = cx[index] === C_F_EXPR ? C_F_EXPR_GEN : C_F_GEN;
      }
      p.exprAllowed = true;
      return;
    case T_NAME: {
      let allowed = false;
      if (p.ecma >= 6 && prevType !== T_DOT) {
        const v = p.value;
        if ((v === "of" && !p.exprAllowed) || (v === "yield" && inGeneratorContext(p))) allowed = true;
      }
      p.exprAllowed = allowed;
      return;
    }
    case T_JSXTAGSTART:
      // acorn-jsx: tokTypes.jsxTagStart.updateContext
      cx.push(C_J_EXPR);
      cx.push(C_J_OTAG);
      p.exprAllowed = false;
      return;
    case T_JSXTAGEND: {
      // acorn-jsx: tokTypes.jsxTagEnd.updateContext
      const out = cx.pop();
      if ((out === C_J_OTAG && prevType === T_SLASH) || out === C_J_CTAG) {
        cx.pop();
        p.exprAllowed = cx[cx.length - 1] === C_J_EXPR;
      } else {
        p.exprAllowed = true;
      }
      return;
    }
    default:
      p.exprAllowed = (TF[t] & F_BEFORE) !== 0;
  }
}

const overrideContext = function overrideContext(p, tokenCtx) {
  const cx = p.ctx;
  if (cx[cx.length - 1] !== tokenCtx) cx[cx.length - 1] = tokenCtx;
}

// ---- token readers

const readToken_dot = function readToken_dot(p) {
  const n1 = p.input.charCodeAt(p.pos + 1);
  if (n1 >= 48 && n1 <= 57) return readNumber(p, true);
  const n2 = p.input.charCodeAt(p.pos + 2);
  if (p.ecma >= 6 && n1 === 46 && n2 === 46) {
    p.pos += 3;
    return finishToken(p, T_ELLIPSIS, undefined);
  }
  ++p.pos;
  return finishToken(p, T_DOT, undefined);
}

const readToken_slash = function readToken_slash(p) {
  const n1 = p.input.charCodeAt(p.pos + 1);
  if (p.exprAllowed) {
    ++p.pos;
    return readRegexp(p);
  }
  if (n1 === 61) return finishOp(p, T_ASSIGN, 2);
  return finishOp(p, T_SLASH, 1);
}

const readToken_mult_modulo_exp = function readToken_mult_modulo_exp(p, code) {
  let n1 = p.input.charCodeAt(p.pos + 1);
  let size = 1;
  let tokentype = code === 42 ? T_STAR : T_MODULO;
  if (p.ecma >= 7 && code === 42 && n1 === 42) {
    ++size;
    tokentype = T_STARSTAR;
    n1 = p.input.charCodeAt(p.pos + 2);
  }
  if (n1 === 61) return finishOp(p, T_ASSIGN, size + 1);
  return finishOp(p, tokentype, size);
}

const readToken_pipe_amp = function readToken_pipe_amp(p, code) {
  const n1 = p.input.charCodeAt(p.pos + 1);
  if (n1 === code) {
    if (p.ecma >= 12 && p.input.charCodeAt(p.pos + 2) === 61) return finishOp(p, T_ASSIGN, 3);
    return finishOp(p, code === 124 ? T_LOGICALOR : T_LOGICALAND, 2);
  }
  if (n1 === 61) return finishOp(p, T_ASSIGN, 2);
  return finishOp(p, code === 124 ? T_BITWISEOR : T_BITWISEAND, 1);
}

const readToken_caret = function readToken_caret(p) {
  const n1 = p.input.charCodeAt(p.pos + 1);
  if (n1 === 61) return finishOp(p, T_ASSIGN, 2);
  return finishOp(p, T_BITWISEXOR, 1);
}

const readToken_plus_min = function readToken_plus_min(p, code) {
  const n1 = p.input.charCodeAt(p.pos + 1);
  if (n1 === code) {
    if (n1 === 45 && !p.inModule && p.input.charCodeAt(p.pos + 2) === 62 && (p.lastTokEnd === 0 || p.nlBefore)) {
      // a `-->` line comment
      skipLineComment(p, 3);
      skipSpace(p);
      return nextToken(p);
    }
    return finishOp(p, T_INCDEC, 2);
  }
  if (n1 === 61) return finishOp(p, T_ASSIGN, 2);
  return finishOp(p, T_PLUSMIN, 1);
}

const readToken_lt_gt = function readToken_lt_gt(p, code) {
  const src = p.input;
  const n1 = src.charCodeAt(p.pos + 1);
  let size = 1;
  if (n1 === code) {
    size = code === 62 && src.charCodeAt(p.pos + 2) === 62 ? 3 : 2;
    if (src.charCodeAt(p.pos + size) === 61) return finishOp(p, T_ASSIGN, size + 1);
    return finishOp(p, T_BITSHIFT, size);
  }
  if (n1 === 33 && code === 60 && !p.inModule && src.charCodeAt(p.pos + 2) === 45 && src.charCodeAt(p.pos + 3) === 45) {
    // `<!--`, an XML-style comment that should be interpreted as a line comment
    skipLineComment(p, 4);
    skipSpace(p);
    return nextToken(p);
  }
  if (n1 === 61) size = 2;
  return finishOp(p, T_RELATIONAL, size);
}

const readToken_eq_excl = function readToken_eq_excl(p, code) {
  const n1 = p.input.charCodeAt(p.pos + 1);
  if (n1 === 61) return finishOp(p, T_EQUALITY, p.input.charCodeAt(p.pos + 2) === 61 ? 3 : 2);
  if (code === 61 && n1 === 62 && p.ecma >= 6) {
    p.pos += 2;
    return finishToken(p, T_ARROW, undefined);
  }
  return finishOp(p, code === 61 ? T_EQ : T_PREFIX, 1);
}

const readToken_question = function readToken_question(p) {
  if (p.ecma >= 11) {
    const n1 = p.input.charCodeAt(p.pos + 1);
    if (n1 === 46) {
      const n2 = p.input.charCodeAt(p.pos + 2);
      if (n2 < 48 || n2 > 57) return finishOp(p, T_QUESTIONDOT, 2);
    }
    if (n1 === 63) {
      if (p.ecma >= 12 && p.input.charCodeAt(p.pos + 2) === 61) return finishOp(p, T_ASSIGN, 3);
      return finishOp(p, T_COALESCE, 2);
    }
  }
  return finishOp(p, T_QUESTION, 1);
}

const readToken_numberSign = function readToken_numberSign(p) {
  let code = 35;
  if (p.ecma >= 13) {
    ++p.pos;
    code = fullCharCodeAt(p, p.pos);
    if (isIdentifierStart(code, true) || code === 92) return finishToken(p, T_PRIVATEID, readWord1(p));
  }
  raise(p, p.pos, "Unexpected character '" + codePointToString(code) + "'");
}

const getTokenFromCode = function getTokenFromCode(p, code) {
  switch (code) {
    case 46:
      return readToken_dot(p);
    case 40:
      ++p.pos;
      return finishToken(p, T_PARENL, undefined);
    case 41:
      ++p.pos;
      return finishToken(p, T_PARENR, undefined);
    case 59:
      ++p.pos;
      return finishToken(p, T_SEMI, undefined);
    case 44:
      ++p.pos;
      return finishToken(p, T_COMMA, undefined);
    case 91:
      ++p.pos;
      return finishToken(p, T_BRACKETL, undefined);
    case 93:
      ++p.pos;
      return finishToken(p, T_BRACKETR, undefined);
    case 123:
      ++p.pos;
      return finishToken(p, T_BRACEL, undefined);
    case 125:
      ++p.pos;
      return finishToken(p, T_BRACER, undefined);
    case 58:
      ++p.pos;
      return finishToken(p, T_COLON, undefined);
    case 96:
      if (p.ecma < 6) break;
      ++p.pos;
      return finishToken(p, T_BACKQUOTE, undefined);
    case 48: {
      const n1 = p.input.charCodeAt(p.pos + 1);
      if (n1 === 120 || n1 === 88) return readRadixNumber(p, 16);
      if (p.ecma >= 6) {
        if (n1 === 111 || n1 === 79) return readRadixNumber(p, 8);
        if (n1 === 98 || n1 === 66) return readRadixNumber(p, 2);
      }
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
      return readNumber(p, false);
    case 34:
    case 39:
      return readString(p, code);
    case 47:
      return readToken_slash(p);
    case 37:
    case 42:
      return readToken_mult_modulo_exp(p, code);
    case 124:
    case 38:
      return readToken_pipe_amp(p, code);
    case 94:
      return readToken_caret(p);
    case 43:
    case 45:
      return readToken_plus_min(p, code);
    case 60:
    case 62:
      return readToken_lt_gt(p, code);
    case 61:
    case 33:
      return readToken_eq_excl(p, code);
    case 63:
      return readToken_question(p);
    case 126:
      return finishOp(p, T_PREFIX, 1);
    case 35:
      return readToken_numberSign(p);
  }
  raise(p, p.pos, "Unexpected character '" + codePointToString(code) + "'");
}

const finishOp = function finishOp(p, t, size) {
  const src = p.input, q = p.pos;
  let str;
  if (size === 1) str = OP1[src.charCodeAt(q)];
  else if (size === 2) str = OP2.get((src.charCodeAt(q) << 8) | src.charCodeAt(q + 1));
  if (str === undefined) str = src.slice(q, q + size);
  p.pos = q + size;
  return finishToken(p, t, str);
}

const readRegexp = function readRegexp(p) {
  const src = p.input;
  let escaped = false, inClass = false;
  const from = p.pos;
  for (;;) {
    if (p.pos >= p.len) raise(p, from, "Unterminated regular expression");
    const ch = src.charCodeAt(p.pos);
    if (ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029) raise(p, from, "Unterminated regular expression");
    if (!escaped) {
      if (ch === 91) inClass = true;
      else if (ch === 93 && inClass) inClass = false;
      else if (ch === 47 && !inClass) break;
      escaped = ch === 92;
    } else escaped = false;
    ++p.pos;
  }
  const pattern = src.slice(from, p.pos);
  ++p.pos;
  const flagsStart = p.pos;
  const flags = readWord1(p);
  if (p.containsEsc) unexpected(p, flagsStart);
  validateRegExp(p, from, pattern, flags);
  let val = null;
  try {
    val = new RegExp(pattern, flags);
  } catch (e) {}
  return finishToken(p, T_REGEXP, { pattern, flags, value: val });
}

const readInt = function readInt(p, radix, n , maybeLegacyOctalNumericLiteral ) {
  const src = p.input;
  const allowSeparators = p.ecma >= 12 && n === undefined;
  const isLegacyOctalNumericLiteral = maybeLegacyOctalNumericLiteral && src.charCodeAt(p.pos) === 48;
  const from = p.pos;
  let total = 0, lastCode = 0;
  for (let i = 0, e = n == null ? Infinity : n; i < e; ++i, ++p.pos) {
    const code = src.charCodeAt(p.pos);
    let val;
    if (allowSeparators && code === 95) {
      if (isLegacyOctalNumericLiteral) raise(p, p.pos, "Numeric separator is not allowed in legacy octal numeric literals");
      if (lastCode === 95) raise(p, p.pos, "Numeric separator must be exactly one underscore");
      if (i === 0) raise(p, p.pos, "Numeric separator is not allowed at the first of digits");
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
  if (allowSeparators && lastCode === 95) raise(p, p.pos - 1, "Numeric separator is not allowed at the last of digits");
  if (p.pos === from || (n != null && p.pos - from !== n)) return null;
  return total;
}

const readRadixNumber = function readRadixNumber(p, radix) {
  const from = p.pos;
  p.pos += 2;
  let val                  = readInt(p, radix);
  if (val == null) raise(p, p.start + 2, "Expected number in radix " + radix);
  if (p.ecma >= 11 && p.input.charCodeAt(p.pos) === 110) {
    val = stringToBigInt(p.input.slice(from, p.pos));
    ++p.pos;
  } else if (isIdentifierStart(fullCharCodeAt(p, p.pos))) raise(p, p.pos, "Identifier directly after number");
  return finishToken(p, T_NUM, val);
}

const readNumber = function readNumber(p, startsWithDot) {
  const src = p.input;
  const from = p.pos;
  // fast path: plain decimal integer (no separators, fraction, exponent)
  if (!startsWithDot) {
    let q = from, v = 0;
    let c = src.charCodeAt(q);
    if (c !== 48 || !((c = src.charCodeAt(q + 1)) >= 48 && c <= 57)) {
      q = from;
      while ((c = src.charCodeAt(q)) >= 48 && c <= 57) {
        v = v * 10 + (c - 48);
        q++;
      }
      if (q - from <= 15 && c !== 46 && c !== 101 && c !== 69 && c !== 95 && c !== 110 && !(c < 128 ? ID_START[c] === 1 || c === 92 : true)) {
        p.pos = q;
        return finishToken(p, T_NUM, v);
      }
    }
  }
  if (!startsWithDot && readInt(p, 10, undefined, true) === null) raise(p, from, "Invalid number");
  let octal = p.pos - from >= 2 && src.charCodeAt(from) === 48;
  if (octal && p.strict) raise(p, from, "Invalid number");
  let n1 = src.charCodeAt(p.pos);
  if (!octal && !startsWithDot && p.ecma >= 11 && n1 === 110) {
    const val = stringToBigInt(src.slice(from, p.pos));
    ++p.pos;
    if (isIdentifierStart(fullCharCodeAt(p, p.pos))) raise(p, p.pos, "Identifier directly after number");
    return finishToken(p, T_NUM, val);
  }
  if (octal && /[89]/.test(src.slice(from, p.pos))) octal = false;
  if (n1 === 46 && !octal) {
    ++p.pos;
    readInt(p, 10);
    n1 = src.charCodeAt(p.pos);
  }
  if ((n1 === 69 || n1 === 101) && !octal) {
    n1 = src.charCodeAt(++p.pos);
    if (n1 === 43 || n1 === 45) ++p.pos;
    if (readInt(p, 10) === null) raise(p, from, "Invalid number");
  }
  if (isIdentifierStart(fullCharCodeAt(p, p.pos))) raise(p, p.pos, "Identifier directly after number");
  const val = stringToNumber(src.slice(from, p.pos), octal);
  return finishToken(p, T_NUM, val);
}

const readCodePoint = function readCodePoint(p) {
  const ch = p.input.charCodeAt(p.pos);
  let code;
  if (ch === 123) {
    if (p.ecma < 6) unexpected(p);
    const codePos = ++p.pos;
    code = readHexChar(p, p.input.indexOf("}", p.pos) - p.pos);
    ++p.pos;
    if (code > 0x10ffff) invalidStringToken(p, codePos, "Code point out of bounds");
  } else {
    code = readHexChar(p, 4);
  }
  return code;
}

const readString = function readString(p, quote) {
  const src = p.input, n = p.len;
  // fast path: no escapes, no line terminators
  let q = p.pos + 1;
  for (;;) {
    if (q >= n) break;
    const ch = src.charCodeAt(q);
    if (ch === quote) {
      const out = src.slice(p.pos + 1, q);
      p.pos = q + 1;
      return finishToken(p, T_STRING, out);
    }
    if (ch === 92 || ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029) break;
    q++;
  }
  let out = "", chunkStart = ++p.pos;
  for (;;) {
    if (p.pos >= n) raise(p, p.start, "Unterminated string constant");
    const ch = src.charCodeAt(p.pos);
    if (ch === quote) break;
    if (ch === 92) {
      out += src.slice(chunkStart, p.pos);
      out += readEscapedChar(p, false);
      chunkStart = p.pos;
    } else if (ch === 0x2028 || ch === 0x2029) {
      if (p.ecma < 10) raise(p, p.start, "Unterminated string constant");
      ++p.pos;
      if (p.locations) {
        p.curLine++;
        p.lineStart = p.pos;
      }
    } else {
      if (isNewLine(ch)) raise(p, p.start, "Unterminated string constant");
      ++p.pos;
    }
  }
  out += src.slice(chunkStart, p.pos++);
  return finishToken(p, T_STRING, out);
}

const tryReadTemplateToken = function tryReadTemplateToken(p) {
  p.inTemplateElement = true;
  try {
    readTmplToken(p);
  } catch (err) {
    if (err === INVALID_TEMPLATE_ESCAPE) readInvalidTemplateToken(p);
    else throw err;
  }
  p.inTemplateElement = false;
}

function invalidStringToken(p, position, message)        {
  if (p.inTemplateElement && p.ecma >= 9) throw INVALID_TEMPLATE_ESCAPE;
  raise(p, position, message);
}

const readTmplToken = function readTmplToken(p) {
  const src = p.input;
  let out = "", chunkStart = p.pos;
  for (;;) {
    if (p.pos >= p.len) raise(p, p.start, "Unterminated template");
    const ch = src.charCodeAt(p.pos);
    if (ch === 96 || (ch === 36 && src.charCodeAt(p.pos + 1) === 123)) {
      if (p.pos === p.start && (p.type === T_TEMPLATE || p.type === T_INVALIDTEMPLATE)) {
        if (ch === 36) {
          p.pos += 2;
          return finishToken(p, T_DOLLARBRACEL, undefined);
        }
        ++p.pos;
        return finishToken(p, T_BACKQUOTE, undefined);
      }
      out += src.slice(chunkStart, p.pos);
      return finishToken(p, T_TEMPLATE, out);
    }
    if (ch === 92) {
      out += src.slice(chunkStart, p.pos);
      out += readEscapedChar(p, true);
      chunkStart = p.pos;
    } else if (isNewLine(ch)) {
      out += src.slice(chunkStart, p.pos);
      ++p.pos;
      switch (ch) {
        case 13:
          if (src.charCodeAt(p.pos) === 10) ++p.pos;
        // falls through
        case 10:
          out += "\n";
          break;
        default:
          out += String.fromCharCode(ch);
          break;
      }
      if (p.locations) {
        ++p.curLine;
        p.lineStart = p.pos;
      }
      chunkStart = p.pos;
    } else {
      ++p.pos;
    }
  }
}

const readInvalidTemplateToken = function readInvalidTemplateToken(p) {
  const src = p.input;
  for (; p.pos < p.len; p.pos++) {
    switch (src[p.pos]) {
      case "\\":
        ++p.pos;
        break;
      case "$":
        if (src[p.pos + 1] !== "{") break;
      // falls through
      case "`":
        return finishToken(p, T_INVALIDTEMPLATE, src.slice(p.start, p.pos));
      case "\r":
        if (src[p.pos + 1] === "\n") ++p.pos;
      // falls through
      case "\n":
      case "\u2028":
      case "\u2029":
        ++p.curLine;
        p.lineStart = p.pos + 1;
        break;
    }
  }
  raise(p, p.start, "Unterminated template");
}

const readEscapedChar = function readEscapedChar(p, inTemplate) {
  const src = p.input;
  let ch = src.charCodeAt(++p.pos);
  ++p.pos;
  switch (ch) {
    case 110:
      return "\n";
    case 114:
      return "\r";
    case 120:
      return String.fromCharCode(readHexChar(p, 2));
    case 117:
      return codePointToString(readCodePoint(p));
    case 116:
      return "\t";
    case 98:
      return "\b";
    case 118:
      return "\u000b";
    case 102:
      return "\f";
    case 13:
      if (src.charCodeAt(p.pos) === 10) ++p.pos;
    // falls through
    case 10:
      if (p.locations) {
        p.lineStart = p.pos;
        ++p.curLine;
      }
      return "";
    case 56:
    case 57:
      if (p.strict) invalidStringToken(p, p.pos - 1, "Invalid escape sequence");
      if (inTemplate) invalidStringToken(p, p.pos - 1, "Invalid escape sequence in template string");
    // falls through
    default:
      if (ch >= 48 && ch <= 55) {
        let octalStr = src.substr(p.pos - 1, 3).match(/^[0-7]+/)[0];
        let octal = parseInt(octalStr, 8);
        if (octal > 255) {
          octalStr = octalStr.slice(0, -1);
          octal = parseInt(octalStr, 8);
        }
        p.pos += octalStr.length - 1;
        ch = src.charCodeAt(p.pos);
        if ((octalStr !== "0" || ch === 56 || ch === 57) && (p.strict || inTemplate))
          invalidStringToken(p, p.pos - 1 - octalStr.length, inTemplate ? "Octal literal in template string" : "Octal literal in strict mode");
        return String.fromCharCode(octal);
      }
      if (isNewLine(ch)) {
        if (p.locations) {
          p.lineStart = p.pos;
          ++p.curLine;
        }
        return "";
      }
      return String.fromCharCode(ch);
  }
}

const readHexChar = function readHexChar(p, n) {
  const codePos = p.pos;
  const v = readInt(p, 16, n);
  if (v === null) invalidStringToken(p, codePos, "Bad character escape sequence");
  return v;
}

// acorn's readWord1 (escapes, astral identifiers)
const readWord1 = function readWord1(p) {
  p.containsEsc = false;
  const src = p.input;
  const astral = p.ecma >= 6;
  let word = "", first = true, chunkStart = p.pos;
  while (p.pos < p.len) {
    const ch = fullCharCodeAt(p, p.pos);
    if (ch < 128 ? ID_CHAR[ch] === 1 : isIdentifierChar(ch, astral)) {
      p.pos += ch <= 0xffff ? 1 : 2;
    } else if (ch === 92) {
      p.containsEsc = true;
      word += src.slice(chunkStart, p.pos);
      const escStart = p.pos;
      if (src.charCodeAt(++p.pos) !== 117) invalidStringToken(p, p.pos, "Expecting Unicode escape sequence \\uXXXX");
      ++p.pos;
      const esc = readCodePoint(p);
      if (!(first ? isIdentifierStart : isIdentifierChar)(esc, astral)) invalidStringToken(p, escStart, "Invalid Unicode escape");
      word += codePointToString(esc);
      chunkStart = p.pos;
    } else {
      break;
    }
    first = false;
  }
  return word + src.slice(chunkStart, p.pos);
}

// the keyword token type of `word` for this ecmaVersion / sourceType, or -1
const keywordOf = function keywordOf(p, word) {
  const k = word.length >= 2 && word.length <= 10 ? KEYWORDS.get(word) : undefined;
  if (k === undefined) return -1;
  if (!p.kwAll && KW_ES6[k] === 1 && !(p.kwModule5 && (k === T_EXPORT || k === T_IMPORT))) return -1;
  return k;
}

const readWord = function readWord(p) {
  const src = p.input, n = p.len;
  const from = p.pos;
  let q = from, c = 0;
  while (q < n && (c = src.charCodeAt(q)) < 128 && ID_CHAR[c] === 1) q++;
  if (q < n && (c >= 128 || c === 92)) {
    // escapes / non-ASCII: acorn's exact slow path
    const word = readWord1(p);
    const k = keywordOf(p, word);
    return finishToken(p, k >= 0 ? k : T_NAME, word);
  }
  p.containsEsc = false;
  p.pos = q;
  const wl = q - from;
  if (wl >= 2 && wl <= 10) {
    const c0 = src.charCodeAt(from);
    const c1 = src.charCodeAt(from + 1);
    if (c0 >= 97 && c0 <= 121 && c1 < 128) {
      const k = KW_SHAPE[shapeIndex(wl, c0, c1)];
      if (k >= 0) {
        const kw = KW_NAME[k];
        let i = 2;
        while (i < wl && src.charCodeAt(from + i) === kw.charCodeAt(i)) i++;
        if (i === wl && (p.kwAll || KW_ES6[k] === 0 || (p.kwModule5 && (k === T_EXPORT || k === T_IMPORT)))) return finishToken(p, k, kw);
      }
    }
  }
  // finishToken + updateContext for a plain name token
  p.end = q;
  if (p.locations) {
    p.endLoc = null;
    p.endLine = p.curLine;
    p.endLS = p.lineStart;
  }
  const prevType = p.type;
  p.type = T_NAME;
  const v = (p.value = src.slice(from, q));
  let allowed = false;
  if (p.ecma >= 6 && prevType !== T_DOT && ((wl === 2 && v === "of" && !p.exprAllowed) || (wl === 5 && v === "yield" && inGeneratorContext(p)))) allowed = true;
  p.exprAllowed = allowed;
}

// ------------------------------------------------------------ acorn-jsx tokens

// acorn-jsx's readToken(code) override, before acorn's own readToken
// (contexts other than tc_expr): returns true when it read a token
const jsxReadTokenHook = function jsxReadTokenHook(p, code, cur) {
  if (cur === C_J_OTAG || cur === C_J_CTAG) {
    if (code < 128 ? ID_START[code] === 1 : isIdentifierStart(code)) {
      jsxReadWord(p);
      return true;
    }
    if (code === 62) {
      ++p.pos;
      finishToken(p, T_JSXTAGEND, undefined);
      return true;
    }
    if ((code === 34 || code === 39) && cur === C_J_OTAG) {
      jsxReadString(p, code);
      return true;
    }
  }
  if (code === 60 && p.exprAllowed && p.input.charCodeAt(p.pos + 1) !== 33) {
    ++p.pos;
    finishToken(p, T_JSXTAGSTART, undefined);
    return true;
  }
  return false;
}

// jsx_readToken: JSX text (children)
const jsxReadToken = function jsxReadToken(p) {
  const src = p.input, n = p.len;
  let out = "", chunkStart = p.pos;
  for (;;) {
    if (p.pos >= n) raise(p, p.start, "Unterminated JSX contents");
    const ch = src.charCodeAt(p.pos);
    switch (ch) {
      case 60:
      case 123:
        if (p.pos === p.start) {
          if (ch === 60 && p.exprAllowed) {
            ++p.pos;
            return finishToken(p, T_JSXTAGSTART, undefined);
          }
          return getTokenFromCode(p, ch);
        }
        out += src.slice(chunkStart, p.pos);
        return finishToken(p, T_JSXTEXT, out);
      case 38:
        out += src.slice(chunkStart, p.pos);
        out += jsxReadEntity(p);
        chunkStart = p.pos;
        break;
      case 62:
      case 125:
        raise(p, p.pos, "Unexpected token `" + src[p.pos] + "`. Did you mean `" + (ch === 62 ? "&gt;" : "&rbrace;") + "` or " + '`{"' + src[p.pos] + '"}' + "`?");
      // falls through (unreachable)
      default:
        if (ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029) {
          out += src.slice(chunkStart, p.pos);
          out += jsxReadNewLine(p, true);
          chunkStart = p.pos;
        } else {
          ++p.pos;
        }
    }
  }
}

const jsxReadNewLine = function jsxReadNewLine(p, normalizeCRLF) {
  const src = p.input;
  const ch = src.charCodeAt(p.pos);
  let out;
  ++p.pos;
  if (ch === 13 && src.charCodeAt(p.pos) === 10) {
    ++p.pos;
    out = normalizeCRLF ? "\n" : "\r\n";
  } else {
    out = String.fromCharCode(ch);
  }
  if (p.locations) {
    ++p.curLine;
    p.lineStart = p.pos;
  }
  return out;
}

const jsxReadString = function jsxReadString(p, quote) {
  const src = p.input, n = p.len;
  let out = "", chunkStart = ++p.pos;
  for (;;) {
    if (p.pos >= n) raise(p, p.start, "Unterminated string constant");
    const ch = src.charCodeAt(p.pos);
    if (ch === quote) break;
    if (ch === 38) {
      out += src.slice(chunkStart, p.pos);
      out += jsxReadEntity(p);
      chunkStart = p.pos;
    } else if (ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029) {
      out += src.slice(chunkStart, p.pos);
      out += jsxReadNewLine(p, false);
      chunkStart = p.pos;
    } else {
      ++p.pos;
    }
  }
  out += src.slice(chunkStart, p.pos++);
  return finishToken(p, T_STRING, out);
}

// jsx_readEntity: the plugin's own method (with its entity table), run on a
// stand-in for the parser that has what it uses
const jsxReadEntity = function jsxReadEntity(p) {
  const self = { input: p.input, pos: p.pos, raise: (at, message) => raise(p, at, message) };
  const entity = p.jsxReadEntity.call(self);
  p.pos = self.pos;
  return entity;
}

// jsx_readWord (the first character is an identifier start)
const jsxReadWord = function jsxReadWord(p) {
  const src = p.input;
  const from = p.pos;
  let ch;
  do {
    ch = src.charCodeAt(++p.pos);
  } while (ch < 128 ? ID_CHAR[ch] === 1 || ch === 45 : isIdentifierChar(ch));
  return finishToken(p, T_JSXNAME, src.slice(from, p.pos));
}

// ------------------------------------------------------------ statements

// acorn's parseTopLevel. (The `program` option: acorn's own code, on the
// given node.)
const parseTopLevel = function parseTopLevel(p, s, sl) {
  const exports = Object.create(null);
  const program = p.options.program;
  let body;
  if (program) {
    if (!program.body) program.body = [];
    while (p.type !== T_EOF) {
      const st = parseStatement(p, null, true, exports);
      program.body.push(st);
    }
    body = program.body;
  } else {
    const base = p.sp;
    while (p.type !== T_EOF) {
      const st = parseStatement(p, null, true, exports);
      p.stk[p.sp++] = st;
    }
    body = listFrom(p, base);
  }
  if (p.inModule && p.undefinedExports !== null) for (const name of Object.keys(p.undefinedExports)) raise(p, p.undefinedExports[name].start, "Export '" + name + "' is not defined");
  adaptDirectivePrologue(p, body);
  next(p);
  const sourceType = p.options.sourceType === "commonjs" ? "script" : p.options.sourceType;
  if (program) {
    program.sourceType = sourceType;
    return finishNodeAt(p, program, "Program", p.lastTokEnd, leloc(p));
  }
  return new NProgram(p, s, sl, body, sourceType);
}

const isLet = function isLet(p, context ) {
  if (p.ecma < 6 || !isContextual(p, "let")) return false;
  const src = p.input;
  let nx = skipWS(p, p.pos);
  let nextCh = fullCharCodeAt(p, nx);
  if (nextCh === 91 || nextCh === 92) return true;
  if (context) return false;
  if (nextCh === 123) return true;
  if (isIdentifierStart(nextCh, true)) {
    const from = nx;
    do nx += nextCh <= 0xffff ? 1 : 2;
    while (isIdentifierChar((nextCh = fullCharCodeAt(p, nx)), true));
    if (nextCh === 92) return true;
    const ident = src.slice(from, nx);
    if (ident !== "in" && ident !== "instanceof") return true;
  }
  return false;
}

const isAsyncFunction = function isAsyncFunction(p) {
  if (p.ecma < 8 || !isContextual(p, "async")) return false;
  const src = p.input;
  const nx = skipWS(p, p.pos);
  if (hasBreak(p, p.pos, nx)) return false;
  let after;
  return (
    src.slice(nx, nx + 8) === "function" &&
    (nx + 8 === src.length || !(isIdentifierChar((after = fullCharCodeAt(p, nx + 8)), true) || after === 92))
  );
}

const isUsingKeyword = function isUsingKeyword(p, isAwaitUsing, isFor) {
  if (p.ecma < 17 || !isContextual(p, isAwaitUsing ? "await" : "using")) return false;
  const src = p.input;
  let nx = skipWS(p, p.pos);
  if (hasBreak(p, p.pos, nx)) return false;
  if (isAwaitUsing) {
    const usingEndPos = nx + 5;
    let after;
    if (src.slice(nx, usingEndPos) !== "using" || usingEndPos === src.length || isIdentifierChar((after = fullCharCodeAt(p, usingEndPos)), true) || after === 92)
      return false;
    nx = skipWS(p, usingEndPos);
    if (hasBreak(p, usingEndPos, nx)) return false;
  }
  let ch = fullCharCodeAt(p, nx);
  if (!isIdentifierStart(ch, true) && ch !== 92) return false;
  const idStart = nx;
  do nx += ch <= 0xffff ? 1 : 2;
  while (isIdentifierChar((ch = fullCharCodeAt(p, nx)), true));
  if (ch === 92) return true;
  const id = src.slice(idStart, nx);
  if (id === "in" || id === "instanceof") return false;
  if (isFor && !isAwaitUsing && id === "of") {
    nx = skipWS(p, nx);
    if (src.charCodeAt(nx) !== 61 || (ch = src.charCodeAt(nx + 1)) === 61 || ch === 62) return false;
  }
  return true;
}

const isAwaitUsing = function isAwaitUsing(p, isFor) {
  return isUsingKeyword(p, true, isFor);
}

const isUsing = function isUsing(p, isFor) {
  return isUsingKeyword(p, false, isFor);
}

const parseStatement = function parseStatement(p, context, topLevel , exports ) {
  let starttype = p.type, kind;
  const s = p.start, sl = p.startLoc;
  if (starttype === T_NAME && isLet(p, context)) {
    starttype = T_VAR;
    kind = "let";
  }
  switch (starttype) {
    case T_BREAK:
    case T_CONTINUE:
      return parseBreakContinueStatement(p, s, sl, starttype === T_BREAK);
    case T_DEBUGGER:
      next(p);
      semicolon(p);
      return new NDebuggerStatement(p, s, sl);
    case T_DO:
      return parseDoStatement(p, s, sl);
    case T_FOR:
      return parseForStatement(p, s, sl);
    case T_FUNCTION:
      if (context && (p.strict || (context !== "if" && context !== "label")) && p.ecma >= 6) unexpected(p);
      return parseFunctionStatement(p, s, sl, false, !context);
    case T_CLASS:
      if (context) unexpected(p);
      return parseClass(p, s, sl, true);
    case T_IF:
      return parseIfStatement(p, s, sl);
    case T_RETURN:
      return parseReturnStatement(p, s, sl);
    case T_SWITCH:
      return parseSwitchStatement(p, s, sl);
    case T_THROW:
      return parseThrowStatement(p, s, sl);
    case T_TRY:
      return parseTryStatement(p, s, sl);
    case T_CONST:
    case T_VAR:
      kind = kind || p.value;
      if (context && kind !== "var") unexpected(p);
      return parseVarStatement(p, s, sl, kind);
    case T_WHILE:
      return parseWhileStatement(p, s, sl);
    case T_WITH:
      return parseWithStatement(p, s, sl);
    case T_BRACEL:
      return parseBlock(p, true, s, sl);
    case T_SEMI:
      next(p);
      return new NEmptyStatement(p, s, sl);
    case T_EXPORT:
    case T_IMPORT: {
      if (p.ecma > 10 && starttype === T_IMPORT) {
        const nx = skipWS(p, p.pos);
        const nextCh = p.input.charCodeAt(nx);
        if (nextCh === 40 || nextCh === 46) return parseExpressionStatement(p, s, sl, parseExpression(p));
      }
      if (!p.options.allowImportExportEverywhere) {
        if (!topLevel) raise(p, p.start, "'import' and 'export' may only appear at the top level");
        if (!p.inModule) raise(p, p.start, "'import' and 'export' may appear only with 'sourceType: module'");
      }
      return starttype === T_IMPORT ? parseImport(p, s, sl) : parseExport(p, s, sl, exports);
    }
    default: {
      if (isAsyncFunction(p)) {
        if (context) unexpected(p);
        next(p);
        return parseFunctionStatement(p, s, sl, true, !context);
      }
      const usingKind = isAwaitUsing(p, false) ? "await using" : isUsing(p, false) ? "using" : null;
      if (usingKind) {
        if (!allowUsing(p)) raise(p, p.start, "Using declaration cannot appear in the top level when source type is `script` or in the bare case statement");
        if (context) raise(p, p.start, "Using declaration is not allowed in single-statement positions");
        if (usingKind === "await using") {
          if (!canAwait(p)) raise(p, p.start, "Await using cannot appear outside of async function");
          next(p);
        }
        next(p);
        const decls = parseVar(p, false, usingKind);
        semicolon(p);
        return new NVariableDeclaration(p, s, sl, decls, usingKind);
      }
      const maybeName = p.value, expr = parseExpression(p);
      if (starttype === T_NAME && expr.type === "Identifier" && eat(p, T_COLON)) return parseLabeledStatement(p, s, sl, maybeName, expr, context);
      return parseExpressionStatement(p, s, sl, expr);
    }
  }
}

const parseBreakContinueStatement = function parseBreakContinueStatement(p, s, sl, isBreak) {
  next(p);
  let label;
  if (eat(p, T_SEMI) || insertSemicolon(p)) label = null;
  else if (p.type !== T_NAME) unexpected(p);
  else {
    label = parseIdent(p);
    semicolon(p);
  }
  let i = 0;
  for (; i < p.labels.length; ++i) {
    const lab = p.labels[i];
    if (label == null || lab.name === label.name) {
      if (lab.kind != null && (isBreak || lab.kind === "loop")) break;
      if (label && isBreak) break;
    }
  }
  if (i === p.labels.length) raise(p, s, "Unsyntactic " + (isBreak ? "break" : "continue"));
  return isBreak ? new NBreakStatement(p, s, sl, label) : new NContinueStatement(p, s, sl, label);
}

const parseDoStatement = function parseDoStatement(p, s, sl) {
  next(p);
  p.labels.push(loopLabel);
  const body = parseStatement(p, "do");
  p.labels.pop();
  expect(p, T_WHILE);
  const test = parseParenExpression(p);
  if (p.ecma >= 6) eat(p, T_SEMI);
  else semicolon(p);
  return new NDoWhileStatement(p, s, sl, body, test);
}

const parseForStatement = function parseForStatement(p, s, sl) {
  next(p);
  const awaitAt = p.ecma >= 9 && canAwait(p) && eatContextual(p, "await") ? p.lastTokStart : -1;
  p.labels.push(loopLabel);
  enterScope(p, 0);
  expect(p, T_PARENL);
  if (p.type === T_SEMI) {
    if (awaitAt > -1) unexpected(p, awaitAt);
    return parseFor(p, s, sl, null);
  }
  const letDecl = isLet(p);
  if (p.type === T_VAR || p.type === T_CONST || letDecl) {
    const is = p.start, isl = p.startLoc, kind = letDecl ? "let" : p.value;
    next(p);
    const decls = parseVar(p, true, kind);
    const init = new NVariableDeclaration(p, is, isl, decls, kind);
    return parseForAfterInit(p, s, sl, init, awaitAt);
  }
  const startsWithLet = isContextual(p, "let");
  let isForOf = false;
  const usingKind = isUsing(p, true) ? "using" : isAwaitUsing(p, true) ? "await using" : null;
  if (usingKind) {
    const is = p.start, isl = p.startLoc;
    next(p);
    if (usingKind === "await using") {
      if (!canAwait(p)) raise(p, p.start, "Await using cannot appear outside of async function");
      next(p);
    }
    const decls = parseVar(p, true, usingKind);
    const init = new NVariableDeclaration(p, is, isl, decls, usingKind);
    return parseForAfterInit(p, s, sl, init, awaitAt);
  }
  const esc = p.containsEsc;
  const rde = rdeAcquire(p);
  const initPos = p.start;
  const init = awaitAt > -1 ? parseExprSubscripts(p, rde, "await") : parseExpression(p, true, rde);
  if (p.type === T_IN || (isForOf = p.ecma >= 6 && isContextual(p, "of"))) {
    let awaitVal;
    if (awaitAt > -1) {
      if (p.type === T_IN) unexpected(p, awaitAt);
      awaitVal = true;
    } else if (isForOf && p.ecma >= 8) {
      if (init.start === initPos && !esc && init.type === "Identifier" && init.name === "async") unexpected(p);
      else if (p.ecma >= 9) awaitVal = false;
    }
    if (startsWithLet && isForOf) raise(p, init.start, "The left-hand side of a for-of loop may not start with 'let'.");
    toAssignable(p, init, false, rde);
    p.rdeDepth--;
    checkLValPattern(p, init);
    return parseForIn(p, s, sl, init, awaitVal);
  } else {
    checkExpressionErrors(p, rde, true);
    p.rdeDepth--;
  }
  if (awaitAt > -1) unexpected(p, awaitAt);
  return parseFor(p, s, sl, init);
}

const parseForAfterInit = function parseForAfterInit(p, s, sl, init, awaitAt) {
  if ((p.type === T_IN || (p.ecma >= 6 && isContextual(p, "of"))) && init.declarations.length === 1) {
    let awaitVal;
    if (p.type === T_IN) {
      if ((init.kind === "using" || init.kind === "await using") && !init.declarations[0].init) raise(p, p.start, "Using declaration is not allowed in for-in loops");
      if (p.ecma >= 9 && awaitAt > -1) unexpected(p, awaitAt);
    } else if (p.ecma >= 9) awaitVal = awaitAt > -1;
    return parseForIn(p, s, sl, init, awaitVal);
  }
  if (awaitAt > -1) unexpected(p, awaitAt);
  return parseFor(p, s, sl, init);
}

const parseFunctionStatement = function parseFunctionStatement(p, s, sl, isAsync, declarationPosition) {
  next(p);
  return parseFunction(p, s, sl, FUNC_STATEMENT | (declarationPosition ? 0 : FUNC_HANGING_STATEMENT), false, isAsync);
}

const parseIfStatement = function parseIfStatement(p, s, sl) {
  next(p);
  const test = parseParenExpression(p);
  const consequent = parseStatement(p, "if");
  const alternate = eat(p, T_ELSE) ? parseStatement(p, "if") : null;
  return new NIfStatement(p, s, sl, test, consequent, alternate);
}

const parseReturnStatement = function parseReturnStatement(p, s, sl) {
  if (!allowReturn(p)) raise(p, p.start, "'return' outside of function");
  next(p);
  let argument;
  if (eat(p, T_SEMI) || insertSemicolon(p)) argument = null;
  else {
    argument = parseExpression(p);
    semicolon(p);
  }
  return new NReturnStatement(p, s, sl, argument);
}

const parseSwitchStatement = function parseSwitchStatement(p, s, sl) {
  next(p);
  const discriminant = parseParenExpression(p);
  const casesBase = p.sp;
  expect(p, T_BRACEL);
  p.labels.push(switchLabel);
  enterScope(p, SCOPE_SWITCH);
  // (stack: the finished cases, then the current case's consequent)
  let cur = null, cs = 0, csl = null, consBase = 0, curTest = null;
  for (let sawDefault = false; p.type !== T_BRACER; ) {
    if (p.type === T_CASE || p.type === T_DEFAULT) {
      const isCase = p.type === T_CASE;
      if (cur) {
        const c = new NSwitchCase(p, cs, csl, listFrom(p, consBase), curTest);
        p.stk[p.sp++] = c;
      }
      cur = true;
      cs = p.start;
      csl = p.startLoc;
      consBase = p.sp;
      next(p);
      if (isCase) {
        curTest = parseExpression(p);
      } else {
        if (sawDefault) raise(p, p.lastTokStart, "Multiple default clauses");
        sawDefault = true;
        curTest = null;
      }
      expect(p, T_COLON);
    } else {
      if (!cur) unexpected(p);
      const st = parseStatement(p, null);
      p.stk[p.sp++] = st;
    }
  }
  exitScope(p);
  if (cur) {
    const c = new NSwitchCase(p, cs, csl, listFrom(p, consBase), curTest);
    p.stk[p.sp++] = c;
  }
  const cases = listFrom(p, casesBase);
  next(p);
  p.labels.pop();
  return new NSwitchStatement(p, s, sl, discriminant, cases);
}

const parseThrowStatement = function parseThrowStatement(p, s, sl) {
  next(p);
  if (p.nlBefore) raise(p, p.lastTokEnd, "Illegal newline after throw");
  const argument = parseExpression(p);
  semicolon(p);
  return new NThrowStatement(p, s, sl, argument);
}

const parseCatchClauseParam = function parseCatchClauseParam(p) {
  const param = parseBindingAtom(p);
  const simple = param.type === "Identifier";
  enterScope(p, simple ? SCOPE_SIMPLE_CATCH : 0);
  checkLValPattern(p, param, simple ? BIND_SIMPLE_CATCH : BIND_LEXICAL);
  expect(p, T_PARENR);
  return param;
}

const parseTryStatement = function parseTryStatement(p, s, sl) {
  next(p);
  const block = parseBlock(p);
  let handler = null;
  if (p.type === T_CATCH) {
    const cs = p.start, csl = p.startLoc;
    next(p);
    let param;
    if (eat(p, T_PARENL)) {
      param = parseCatchClauseParam(p);
    } else {
      if (p.ecma < 10) unexpected(p);
      param = null;
      enterScope(p, 0);
    }
    const body = parseBlock(p, false);
    exitScope(p);
    handler = new NCatchClause(p, cs, csl, param, body);
  }
  const finalizer = eat(p, T_FINALLY) ? parseBlock(p) : null;
  if (!handler && !finalizer) raise(p, s, "Missing catch or finally clause");
  return new NTryStatement(p, s, sl, block, handler, finalizer);
}

const parseVarStatement = function parseVarStatement(p, s, sl, kind, allowMissingInitializer ) {
  next(p);
  const decls = parseVar(p, false, kind, allowMissingInitializer);
  semicolon(p);
  return new NVariableDeclaration(p, s, sl, decls, kind);
}

const parseWhileStatement = function parseWhileStatement(p, s, sl) {
  next(p);
  const test = parseParenExpression(p);
  p.labels.push(loopLabel);
  const body = parseStatement(p, "while");
  p.labels.pop();
  return new NWhileStatement(p, s, sl, test, body);
}

const parseWithStatement = function parseWithStatement(p, s, sl) {
  if (p.strict) raise(p, p.start, "'with' in strict mode");
  next(p);
  const object = parseParenExpression(p);
  const body = parseStatement(p, "with");
  return new NWithStatement(p, s, sl, object, body);
}

const parseLabeledStatement = function parseLabeledStatement(p, s, sl, maybeName, expr, context) {
  for (const label of p.labels) if (label.name === maybeName) raise(p, expr.start, "Label '" + maybeName + "' is already declared");
  const kind = TF[p.type] & F_LOOP ? "loop" : p.type === T_SWITCH ? "switch" : null;
  for (let i = p.labels.length - 1; i >= 0; i--) {
    const label = p.labels[i];
    if (label.statementStart === s) {
      label.statementStart = p.start;
      label.kind = kind;
    } else break;
  }
  p.labels.push({ name: maybeName, kind, statementStart: p.start });
  const body = parseStatement(p, context ? (context.indexOf("label") === -1 ? context + "label" : context) : "label");
  p.labels.pop();
  return new NLabeledStatement(p, s, sl, body, expr);
}

const parseExpressionStatement = function parseExpressionStatement(p, s, sl, expr) {
  semicolon(p);
  return new NExpressionStatement(p, s, sl, expr);
}

const parseBlock = function parseBlock(p, createNewLexicalScope = true, s = p.start, sl = p.startLoc, exitStrict ) {
  const base = p.sp;
  expect(p, T_BRACEL);
  if (createNewLexicalScope) enterScope(p, 0);
  while (p.type !== T_BRACER) {
    const st = parseStatement(p, null);
    p.stk[p.sp++] = st;
  }
  const body = listFrom(p, base);
  if (exitStrict) p.strict = false;
  next(p);
  if (createNewLexicalScope) exitScope(p);
  return new NBlockStatement(p, s, sl, body);
}

const parseFor = function parseFor(p, s, sl, init) {
  expect(p, T_SEMI);
  const test = p.type === T_SEMI ? null : parseExpression(p);
  expect(p, T_SEMI);
  const update = p.type === T_PARENR ? null : parseExpression(p);
  expect(p, T_PARENR);
  const body = parseStatement(p, "for");
  exitScope(p);
  p.labels.pop();
  return new NForStatement(p, s, sl, init, test, update, body);
}

// awaitVal: undefined -> no `await` key, true/false -> key present
const parseForIn = function parseForIn(p, s, sl, init, awaitVal) {
  const isForIn = p.type === T_IN;
  next(p);
  if (
    init.type === "VariableDeclaration" &&
    init.declarations[0].init != null &&
    (!isForIn || p.ecma < 8 || p.strict || init.kind !== "var" || init.declarations[0].id.type !== "Identifier")
  )
    raise(p, init.start, (isForIn ? "for-in" : "for-of") + " loop variable declaration may not have an initializer");
  const right = isForIn ? parseExpression(p) : parseMaybeAssign(p);
  expect(p, T_PARENR);
  const body = parseStatement(p, "for");
  exitScope(p);
  p.labels.pop();
  if (isForIn) return new NForInStatement(p, s, sl, init, right, body);
  return new NForOfStatement(p, s, sl, awaitVal, init, right, body);
}

const parseVar = function parseVar(p, isFor, kind, allowMissingInitializer ) {
  const base = p.sp;
  for (;;) {
    const ds = p.start, dsl = p.startLoc;
    const id = parseVarId(p, kind);
    let init;
    if (eat(p, T_EQ)) {
      init = parseMaybeAssign(p, isFor);
    } else if (!allowMissingInitializer && kind === "const" && !(p.type === T_IN || (p.ecma >= 6 && isContextual(p, "of")))) {
      unexpected(p);
    } else if (!allowMissingInitializer && (kind === "using" || kind === "await using") && p.ecma >= 17 && p.type !== T_IN && !isContextual(p, "of")) {
      raise(p, p.lastTokEnd, "Missing initializer in " + kind + " declaration");
    } else if (!allowMissingInitializer && id.type !== "Identifier" && !(isFor && (p.type === T_IN || isContextual(p, "of")))) {
      raise(p, p.lastTokEnd, "Complex binding patterns require an initialization value");
    } else {
      init = null;
    }
    const d = new NVariableDeclarator(p, ds, dsl, id, init);
    p.stk[p.sp++] = d;
    if (!eat(p, T_COMMA)) break;
  }
  return listFrom(p, base);
}

const parseVarId = function parseVarId(p, kind) {
  const id = kind === "using" || kind === "await using" ? parseIdent(p) : parseBindingAtom(p);
  checkLValPattern(p, id, kind === "var" ? BIND_VAR : BIND_LEXICAL, false);
  return id;
}

// acorn's function node as it is when parseFunctionBody runs (initFunction's
// keys for this ecmaVersion, then params)
const overrideFunctionNode = function overrideFunctionNode(p, s, sl, id, generator, async, params) {
  const node      = new Node(p, s, sl);
  node.id = id;
  // (acorn: node.generator = node.expression = false -- expression first)
  if (p.ecma >= 6) node.generator = node.expression = false;
  if (p.ecma >= 6) node.generator = generator;
  if (p.ecma >= 8) node.async = async;
  node.params = params;
  return node;
}

const runBodyOverride = function runBodyOverride(p, node, isArrowFunction, isMethod, forInit) {
  const f = p.facade;
  const saved = f.fnNode;
  f.fnNode = node;
  p.bodyOverride.call(f, node, isArrowFunction, isMethod, forInit);
  f.fnNode = saved;
}

const parseFunction = function parseFunction(p, s, sl, statement, allowExpressionBody , isAsync , forInit ) {
  // initFunction + parseFunction
  let generator = false;
  if (p.ecma >= 9 || (p.ecma >= 6 && !isAsync)) {
    if (p.type === T_STAR && statement & FUNC_HANGING_STATEMENT) unexpected(p);
    generator = eat(p, T_STAR);
  }
  const async = p.ecma >= 8 ? !!isAsync : false;
  let id = null;
  if (statement & FUNC_STATEMENT) {
    id = statement & FUNC_NULLABLE_ID && p.type !== T_NAME ? null : parseIdent(p);
    if (id && !(statement & FUNC_HANGING_STATEMENT))
      checkLValSimple(p, id, p.strict || generator || async ? (treatFunctionsAsVar(p) ? BIND_VAR : BIND_LEXICAL) : BIND_FUNCTION);
  }
  const oldYieldPos = p.yieldPos, oldAwaitPos = p.awaitPos, oldAwaitIdentPos = p.awaitIdentPos;
  p.yieldPos = 0;
  p.awaitPos = 0;
  p.awaitIdentPos = 0;
  enterScope(p, functionFlags(async, generator));
  if (!(statement & FUNC_STATEMENT)) id = p.type === T_NAME ? parseIdent(p) : null;
  expect(p, T_PARENL);
  const params = parseBindingList(p, T_PARENR, false, p.ecma >= 8);
  checkYieldAwaitInDefaultParams(p);
  if (p.bodyOverride !== null) {
    const node = overrideFunctionNode(p, s, sl, id, generator, async, params);
    runBodyOverride(p, node, allowExpressionBody, false, forInit);
    p.yieldPos = oldYieldPos;
    p.awaitPos = oldAwaitPos;
    p.awaitIdentPos = oldAwaitIdentPos;
    return finishNodeAt(p, node, statement & FUNC_STATEMENT ? "FunctionDeclaration" : "FunctionExpression", p.lastTokEnd, leloc(p));
  }
  const body = parseFunctionBody(p, params, id, allowExpressionBody, false, forInit, s);
  const expression = p.fbExpression;
  p.yieldPos = oldYieldPos;
  p.awaitPos = oldAwaitPos;
  p.awaitIdentPos = oldAwaitIdentPos;
  const C = statement & FUNC_STATEMENT ? NFunctionDeclaration : NFunctionExpression;
  return new C(p, s, sl, id, expression, generator, async, params, body);
}

const parseClass = function parseClass(p, s, sl, isStatement) {
  next(p);
  const oldStrict = p.strict;
  p.strict = true;
  // parseClassId
  let id;
  if (p.type === T_NAME) {
    id = parseIdent(p);
    if (isStatement) checkLValSimple(p, id, BIND_LEXICAL, false);
  } else {
    if (isStatement === true) unexpected(p);
    id = null;
  }
  const superClass = eat(p, T_EXTENDS) ? parseExprSubscripts(p, null, false) : null;
  const privateNameMap = enterClassBody(p);
  const bs = p.start, bsl = p.startLoc;
  let hadConstructor = false;
  const base = p.sp;
  expect(p, T_BRACEL);
  while (p.type !== T_BRACER) {
    const element = parseClassElement(p, superClass !== null);
    if (element) {
      p.stk[p.sp++] = element;
      if (element.type === "MethodDefinition" && element.kind === "constructor") {
        if (hadConstructor) raise(p, element.start, "Duplicate constructor in the same class");
        hadConstructor = true;
      } else if (element.key && element.key.type === "PrivateIdentifier" && isPrivateNameConflicted(privateNameMap, element)) {
        raise(p, element.key.start, "Identifier '#" + element.key.name + "' has already been declared");
      }
    }
  }
  const body = listFrom(p, base);
  p.strict = oldStrict;
  next(p);
  const classBody = new NClassBody(p, bs, bsl, body);
  exitClassBody(p);
  return isStatement ? new NClassDeclaration(p, s, sl, id, superClass, classBody) : new NClassExpression(p, s, sl, id, superClass, classBody);
}

const parseClassElement = function parseClassElement(p, constructorAllowsSuper) {
  if (eat(p, T_SEMI)) return null;
  const s = p.start, sl = p.startLoc;
  let keyName = "";
  let isGenerator = false;
  let isAsync = false;
  let kind = "method";
  let isStatic = false;
  if (eatContextual(p, "static")) {
    if (p.ecma >= 13 && eat(p, T_BRACEL)) return parseClassStaticBlock(p, s, sl);
    if (isClassElementNameStart(p) || p.type === T_STAR) isStatic = true;
    else keyName = "static";
  }
  if (!keyName && p.ecma >= 8 && eatContextual(p, "async")) {
    if ((isClassElementNameStart(p) || p.type === T_STAR) && !canInsertSemicolon(p)) isAsync = true;
    else keyName = "async";
  }
  if (!keyName && (p.ecma >= 9 || !isAsync) && eat(p, T_STAR)) isGenerator = true;
  if (!keyName && !isAsync && !isGenerator) {
    const lastValue = p.value;
    if (eatContextual(p, "get") || eatContextual(p, "set")) {
      if (isClassElementNameStart(p)) kind = lastValue;
      else keyName = lastValue;
    }
  }
  let computed, key;
  if (keyName) {
    computed = false;
    key = new NIdentifier(p, p.lastTokStart, p.lastTokStartLoc, keyName);
  } else if (p.type === T_PRIVATEID) {
    if (p.value === "constructor") raise(p, p.start, "Classes can't have an element named '#constructor'");
    computed = false;
    key = parsePrivateIdent(p);
  } else {
    key = parsePropertyName(p);
    computed = p.pnComputed;
  }
  if (p.ecma < 13 || p.type === T_PARENL || kind !== "method" || isGenerator || isAsync) {
    const isConstructor = !isStatic && checkKeyName(computed, key, "constructor");
    const allowsDirectSuper = isConstructor && constructorAllowsSuper;
    if (isConstructor && kind !== "method") raise(p, key.start, "Constructor can't have get/set modifier");
    kind = isConstructor ? "constructor" : kind;
    // parseClassMethod
    if (kind === "constructor") {
      if (isGenerator) raise(p, key.start, "Constructor can't be a generator");
      if (isAsync) raise(p, key.start, "Constructor can't be an async method");
    } else if (isStatic && checkKeyName(computed, key, "prototype")) raise(p, key.start, "Classes may not have a static property named prototype");
    const val = parseMethod(p, isGenerator, isAsync, allowsDirectSuper);
    if (kind === "get" && val.params.length !== 0) raise(p, val.start, "getter should have no params");
    if (kind === "set" && val.params.length !== 1) raise(p, val.start, "setter should have exactly one param");
    if (kind === "set" && val.params[0].type === "RestElement") raise(p, val.params[0].start, "Setter cannot use rest params");
    return new NMethodDefinition(p, s, sl, isStatic, computed, key, kind, val);
  }
  // parseClassField
  if (checkKeyName(computed, key, "constructor")) raise(p, key.start, "Classes can't have a field named 'constructor'");
  else if (isStatic && checkKeyName(computed, key, "prototype")) raise(p, key.start, "Classes can't have a static field named 'prototype'");
  let val;
  if (eat(p, T_EQ)) {
    enterScope(p, SCOPE_CLASS_FIELD_INIT | SCOPE_SUPER);
    val = parseMaybeAssign(p);
    exitScope(p);
  } else val = null;
  semicolon(p);
  return new NPropertyDefinition(p, s, sl, isStatic, computed, key, val);
}

const isClassElementNameStart = function isClassElementNameStart(p) {
  const t = p.type;
  return t === T_NAME || t === T_PRIVATEID || t === T_NUM || t === T_STRING || t === T_BRACKETL || t >= T_KW_FIRST;
}

const parseClassStaticBlock = function parseClassStaticBlock(p, s, sl) {
  const base = p.sp;
  const oldLabels = p.labels;
  p.labels = [];
  enterScope(p, SCOPE_CLASS_STATIC_BLOCK | SCOPE_SUPER);
  while (p.type !== T_BRACER) {
    const st = parseStatement(p, null);
    p.stk[p.sp++] = st;
  }
  const body = listFrom(p, base);
  next(p);
  exitScope(p);
  p.labels = oldLabels;
  return new NStaticBlock(p, s, sl, body);
}

const enterClassBody = function enterClassBody(p) {
  const element = { declared: Object.create(null), used: [] };
  p.privateNameStack.push(element);
  return element.declared;
}

const exitClassBody = function exitClassBody(p) {
  const { declared, used } = p.privateNameStack.pop();
  if (!p.options.checkPrivateFields) return;
  const n = p.privateNameStack.length;
  const parent = n === 0 ? null : p.privateNameStack[n - 1];
  for (let i = 0; i < used.length; ++i) {
    const id = used[i];
    if (!Object.hasOwn(declared, id.name)) {
      if (parent) parent.used.push(id);
      else raise(p, id.start, "Private field '#" + id.name + "' must be declared in an enclosing class");
    }
  }
}

const parseExportAllDeclaration = function parseExportAllDeclaration(p, s, sl, exports) {
  let exported;
  if (p.ecma >= 11) {
    if (eatContextual(p, "as")) {
      exported = parseModuleExportName(p);
      checkExport(p, exports, exported, p.lastTokStart);
    } else exported = null;
  }
  expectContextual(p, "from");
  if (p.type !== T_STRING) unexpected(p);
  const source = parseExprAtom(p);
  const attributes = p.ecma >= 16 ? parseWithClause(p) : undefined;
  semicolon(p);
  return new NExportAllDeclaration(p, s, sl, exported, source, attributes);
}

const parseExport = function parseExport(p, s, sl, exports) {
  next(p);
  if (eat(p, T_STAR)) return parseExportAllDeclaration(p, s, sl, exports);
  if (eat(p, T_DEFAULT)) {
    checkExport(p, exports, "default", p.lastTokStart);
    const declaration = parseExportDefaultDeclaration(p);
    return new NExportDefaultDeclaration(p, s, sl, declaration);
  }
  let declaration, specifiers, source, attributes;
  if (shouldParseExportStatement(p)) {
    declaration = parseStatement(p, null);
    if (declaration.type === "VariableDeclaration") checkVariableExport(p, exports, declaration.declarations);
    else checkExport(p, exports, declaration.id, declaration.id.start);
    specifiers = [];
    source = null;
    if (p.ecma >= 16) attributes = [];
  } else {
    declaration = null;
    specifiers = parseExportSpecifiers(p, exports);
    if (eatContextual(p, "from")) {
      if (p.type !== T_STRING) unexpected(p);
      source = parseExprAtom(p);
      if (p.ecma >= 16) attributes = parseWithClause(p);
    } else {
      for (const spec of specifiers) {
        checkUnreserved(p, spec.local);
        checkLocalExport(p, spec.local);
        if (spec.local.type === "Literal") raise(p, spec.local.start, "A string literal cannot be used as an exported binding without `from`.");
      }
      source = null;
      if (p.ecma >= 16) attributes = [];
    }
    semicolon(p);
  }
  return new NExportNamedDeclaration(p, s, sl, declaration, specifiers, source, attributes);
}

const parseExportDefaultDeclaration = function parseExportDefaultDeclaration(p) {
  let isAsync;
  if (p.type === T_FUNCTION || (isAsync = isAsyncFunction(p))) {
    const fs = p.start, fsl = p.startLoc;
    next(p);
    if (isAsync) next(p);
    return parseFunction(p, fs, fsl, FUNC_STATEMENT | FUNC_NULLABLE_ID, false, isAsync);
  } else if (p.type === T_CLASS) {
    return parseClass(p, p.start, p.startLoc, "nullableID");
  }
  const declaration = parseMaybeAssign(p);
  semicolon(p);
  return declaration;
}

const checkExport = function checkExport(p, exports, name, at) {
  if (!exports) return;
  if (typeof name !== "string") name = name.type === "Identifier" ? name.name : name.value;
  if (Object.hasOwn(exports, name)) raise(p, at, "Duplicate export '" + name + "'");
  exports[name] = true;
}

const checkPatternExport = function checkPatternExport(p, exports, pat) {
  const t = pat.type;
  if (t === "Identifier") checkExport(p, exports, pat, pat.start);
  else if (t === "ObjectPattern") for (const prop of pat.properties) checkPatternExport(p, exports, prop);
  else if (t === "ArrayPattern") {
    for (const elt of pat.elements) if (elt) checkPatternExport(p, exports, elt);
  } else if (t === "Property") checkPatternExport(p, exports, pat.value);
  else if (t === "AssignmentPattern") checkPatternExport(p, exports, pat.left);
  else if (t === "RestElement") checkPatternExport(p, exports, pat.argument);
}

const checkVariableExport = function checkVariableExport(p, exports, decls) {
  if (!exports) return;
  for (const decl of decls) checkPatternExport(p, exports, decl.id);
}

const shouldParseExportStatement = function shouldParseExportStatement(p) {
  const t = p.type;
  return t === T_VAR || t === T_CONST || t === T_CLASS || t === T_FUNCTION || isLet(p) || isAsyncFunction(p);
}

const parseExportSpecifier = function parseExportSpecifier(p, exports) {
  const s = p.start, sl = p.startLoc;
  const local = parseModuleExportName(p);
  const exported = eatContextual(p, "as") ? parseModuleExportName(p) : local;
  checkExport(p, exports, exported, exported.start);
  return new NExportSpecifier(p, s, sl, local, exported);
}

const parseExportSpecifiers = function parseExportSpecifiers(p, exports) {
  const base = p.sp;
  let first = true;
  expect(p, T_BRACEL);
  while (!eat(p, T_BRACER)) {
    if (!first) {
      expect(p, T_COMMA);
      if (afterTrailingComma(p, T_BRACER)) break;
    } else first = false;
    const n = parseExportSpecifier(p, exports);
    p.stk[p.sp++] = n;
  }
  return listFrom(p, base);
}

const parseImport = function parseImport(p, s, sl) {
  next(p);
  let specifiers, source;
  if (p.type === T_STRING) {
    specifiers = emptyImportSpecifiers;
    source = parseExprAtom(p);
  } else {
    specifiers = parseImportSpecifiers(p);
    expectContextual(p, "from");
    source = p.type === T_STRING ? parseExprAtom(p) : unexpected(p);
  }
  const attributes = p.ecma >= 16 ? parseWithClause(p) : undefined;
  semicolon(p);
  return new NImportDeclaration(p, s, sl, specifiers, source, attributes);
}

const parseImportSpecifier = function parseImportSpecifier(p) {
  const s = p.start, sl = p.startLoc;
  const imported = parseModuleExportName(p);
  let local;
  if (eatContextual(p, "as")) {
    local = parseIdent(p);
  } else {
    checkUnreserved(p, imported);
    local = imported;
  }
  checkLValSimple(p, local, BIND_LEXICAL);
  return new NImportSpecifier(p, s, sl, imported, local);
}

const parseImportDefaultSpecifier = function parseImportDefaultSpecifier(p) {
  const s = p.start, sl = p.startLoc;
  const local = parseIdent(p);
  checkLValSimple(p, local, BIND_LEXICAL);
  return new NImportDefaultSpecifier(p, s, sl, local);
}

const parseImportNamespaceSpecifier = function parseImportNamespaceSpecifier(p) {
  const s = p.start, sl = p.startLoc;
  next(p);
  expectContextual(p, "as");
  const local = parseIdent(p);
  checkLValSimple(p, local, BIND_LEXICAL);
  return new NImportNamespaceSpecifier(p, s, sl, local);
}

const parseImportSpecifiers = function parseImportSpecifiers(p) {
  const base = p.sp;
  let first = true;
  if (p.type === T_NAME) {
    const n = parseImportDefaultSpecifier(p);
    p.stk[p.sp++] = n;
    if (!eat(p, T_COMMA)) return listFrom(p, base);
  }
  if (p.type === T_STAR) {
    const n = parseImportNamespaceSpecifier(p);
    p.stk[p.sp++] = n;
    return listFrom(p, base);
  }
  expect(p, T_BRACEL);
  while (!eat(p, T_BRACER)) {
    if (!first) {
      expect(p, T_COMMA);
      if (afterTrailingComma(p, T_BRACER)) break;
    } else first = false;
    const n = parseImportSpecifier(p);
    p.stk[p.sp++] = n;
  }
  return listFrom(p, base);
}

const parseWithClause = function parseWithClause(p) {
  const nodes = [];
  if (!eat(p, T_WITH)) return nodes;
  expect(p, T_BRACEL);
  const attributeKeys = {};
  let first = true;
  while (!eat(p, T_BRACER)) {
    if (!first) {
      expect(p, T_COMMA);
      if (afterTrailingComma(p, T_BRACER)) break;
    } else first = false;
    const attr = parseImportAttribute(p);
    const keyName = attr.key.type === "Identifier" ? attr.key.name : attr.key.value;
    if (Object.hasOwn(attributeKeys, keyName)) raise(p, attr.key.start, "Duplicate attribute key '" + keyName + "'");
    attributeKeys[keyName] = true;
    nodes.push(attr);
  }
  return nodes;
}

const parseImportAttribute = function parseImportAttribute(p) {
  const s = p.start, sl = p.startLoc;
  const key = p.type === T_STRING ? parseExprAtom(p) : parseIdent(p, !p.allowReservedNever);
  expect(p, T_COLON);
  if (p.type !== T_STRING) unexpected(p);
  const val = parseExprAtom(p);
  return new NImportAttribute(p, s, sl, key, val);
}

const parseModuleExportName = function parseModuleExportName(p) {
  if (p.ecma >= 13 && p.type === T_STRING) {
    const stringLiteral = parseLiteral(p, p.value);
    if (loneSurrogate.test(stringLiteral.value)) raise(p, stringLiteral.start, "An export name cannot include a lone surrogate.");
    return stringLiteral;
  }
  return parseIdent(p, true);
}

const adaptDirectivePrologue = function adaptDirectivePrologue(p, statements) {
  for (let i = 0; i < statements.length && isDirectiveCandidate(p, statements[i]); ++i) {
    statements[i].directive = statements[i].expression.raw.slice(1, -1);
  }
}

const isDirectiveCandidate = function isDirectiveCandidate(p, statement) {
  if (p.ecma < 5 || statement.type !== "ExpressionStatement") return false;
  const e = statement.expression;
  if (e.type !== "Literal" || typeof e.value !== "string") return false;
  const c = p.input[statement.start];
  return c === '"' || c === "'";
}

// ------------------------------------------------------------ lval

const toAssignable = function toAssignable(p, node, isBinding, rde ) {
  if (p.ecma >= 6 && node) {
    switch (node.type) {
      case "Identifier":
        if (inAsync(p) && node.name === "await") raise(p, node.start, "Cannot use 'await' as identifier inside an async function");
        break;
      case "ObjectPattern":
      case "ArrayPattern":
      case "AssignmentPattern":
      case "RestElement":
        break;
      case "ObjectExpression":
        node.type = "ObjectPattern";
        if (rde) checkPatternErrors(p, rde, true);
        for (const prop of node.properties) {
          toAssignable(p, prop, isBinding);
          if (prop.type === "RestElement" && (prop.argument.type === "ArrayPattern" || prop.argument.type === "ObjectPattern")) raise(p, prop.argument.start, "Unexpected token");
        }
        break;
      case "Property":
        if (node.kind !== "init") raise(p, node.key.start, "Object pattern can't contain getter or setter");
        toAssignable(p, node.value, isBinding);
        break;
      case "ArrayExpression":
        node.type = "ArrayPattern";
        if (rde) checkPatternErrors(p, rde, true);
        toAssignableList(p, node.elements, isBinding);
        break;
      case "SpreadElement":
        node.type = "RestElement";
        toAssignable(p, node.argument, isBinding);
        if (node.argument.type === "AssignmentPattern") raise(p, node.argument.start, "Rest elements cannot have a default value");
        break;
      case "AssignmentExpression":
        if (node.operator !== "=") raise(p, node.left.end, "Only '=' operator can be used for specifying default value.");
        node.type = "AssignmentPattern";
        delete node.operator;
        toAssignable(p, node.left, isBinding);
        break;
      case "ParenthesizedExpression":
        toAssignable(p, node.expression, isBinding, rde);
        break;
      case "ChainExpression":
        raise(p, node.start, "Optional chaining cannot appear in left-hand side");
      case "MemberExpression":
        if (!isBinding) break;
      // falls through
      default:
        raise(p, node.start, "Assigning to rvalue");
    }
  } else if (rde) checkPatternErrors(p, rde, true);
  return node;
}

const toAssignableList = function toAssignableList(p, exprList, isBinding) {
  const n = exprList.length;
  for (let i = 0; i < n; i++) {
    const elt = exprList[i];
    if (elt) toAssignable(p, elt, isBinding);
  }
  if (n && p.ecma === 6) {
    const last = exprList[n - 1];
    if (isBinding && last && last.type === "RestElement" && last.argument.type !== "Identifier") unexpected(p, last.argument.start);
  }
  return exprList;
}

const parseSpread = function parseSpread(p, rde) {
  const s = p.start, sl = p.startLoc;
  next(p);
  const argument = parseMaybeAssign(p, false, rde);
  return new NSpreadElement(p, s, sl, argument);
}

const parseRestBinding = function parseRestBinding(p) {
  const s = p.start, sl = p.startLoc;
  next(p);
  if (p.ecma === 6 && p.type !== T_NAME) unexpected(p);
  const argument = parseBindingAtom(p);
  return new NRestElement(p, s, sl, argument);
}

const parseBindingAtom = function parseBindingAtom(p) {
  if (p.ecma >= 6) {
    if (p.type === T_BRACKETL) {
      const s = p.start, sl = p.startLoc;
      next(p);
      const elements = parseBindingList(p, T_BRACKETR, true, true);
      return new NArrayPattern(p, s, sl, elements);
    }
    if (p.type === T_BRACEL) return parseObj(p, true);
  }
  return parseIdent(p);
}

const parseBindingList = function parseBindingList(p, close, allowEmpty, allowTrailingComma) {
  const base = p.sp;
  let first = true;
  while (!eat(p, close)) {
    if (first) first = false;
    else expect(p, T_COMMA);
    if (allowEmpty && p.type === T_COMMA) {
      p.stk[p.sp++] = null;
    } else if (allowTrailingComma && afterTrailingComma(p, close)) {
      break;
    } else if (p.type === T_ELLIPSIS) {
      const rest = parseRestBinding(p);
      p.stk[p.sp++] = rest;
      if (p.type === T_COMMA) raise(p, p.start, "Comma is not permitted after the rest element");
      expect(p, close);
      break;
    } else {
      const e = parseMaybeDefault(p, p.start, p.startLoc);
      p.stk[p.sp++] = e;
    }
  }
  return listFrom(p, base);
}

const parseMaybeDefault = function parseMaybeDefault(p, s, sl, left ) {
  left = left || parseBindingAtom(p);
  if (p.ecma < 6 || !eat(p, T_EQ)) return left;
  const right = parseMaybeAssign(p);
  return new NAssignmentPattern(p, s, sl, left, right);
}

const checkLValSimple = function checkLValSimple(p, expr, bindingType = BIND_NONE, checkClashes ) {
  const isBind = bindingType !== BIND_NONE;
  switch (expr.type) {
    case "Identifier": {
      const name = expr.name;
      if (p.strict && restricted(p, name) && p.reservedWordsStrictBind.has(name)) raise(p, expr.start, (isBind ? "Binding " : "Assigning to ") + name + " in strict mode");
      if (isBind) {
        if (bindingType === BIND_LEXICAL && name === "let") raise(p, expr.start, "let is disallowed as a lexically bound name");
        if (checkClashes) {
          if (checkClashes.includes(name)) raise(p, expr.start, "Argument name clash");
          checkClashes.push(name);
        }
        if (bindingType !== BIND_OUTSIDE) declareName(p, name, bindingType, expr.start);
      }
      break;
    }
    case "ChainExpression":
      raise(p, expr.start, "Optional chaining cannot appear in left-hand side");
    case "MemberExpression":
      if (isBind) raise(p, expr.start, "Binding member expression");
      break;
    case "ParenthesizedExpression":
      if (isBind) raise(p, expr.start, "Binding parenthesized expression");
      return checkLValSimple(p, expr.expression, bindingType, checkClashes);
    default:
      raise(p, expr.start, (isBind ? "Binding" : "Assigning to") + " rvalue");
  }
}

const checkLValPattern = function checkLValPattern(p, expr, bindingType = BIND_NONE, checkClashes ) {
  switch (expr.type) {
    case "ObjectPattern":
      for (const prop of expr.properties) checkLValInnerPattern(p, prop, bindingType, checkClashes);
      break;
    case "ArrayPattern":
      for (const elem of expr.elements) if (elem) checkLValInnerPattern(p, elem, bindingType, checkClashes);
      break;
    default:
      checkLValSimple(p, expr, bindingType, checkClashes);
  }
}

const checkLValInnerPattern = function checkLValInnerPattern(p, expr, bindingType = BIND_NONE, checkClashes) {
  switch (expr.type) {
    case "Property":
      checkLValInnerPattern(p, expr.value, bindingType, checkClashes);
      break;
    case "AssignmentPattern":
      checkLValPattern(p, expr.left, bindingType, checkClashes);
      break;
    case "RestElement":
      checkLValPattern(p, expr.argument, bindingType, checkClashes);
      break;
    default:
      checkLValPattern(p, expr, bindingType, checkClashes);
  }
}

// ------------------------------------------------------------ expressions

// ES2015+: returns whether the object has had an init __proto__ property so far
const checkPropClash = function checkPropClash(p, prop, sawProto, rde) {
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
      } else raise(p, key.start, "Redefinition of __proto__ property");
    }
    return true;
  }
  return sawProto;
}

// ES3 / ES5: redefinitions of plain properties and accessors
const checkPropClash5 = function checkPropClash5(p, prop, propHash) {
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
      return;
  }
  const kind = prop.kind;
  name = "$" + name;
  let other = propHash[name];
  if (other) {
    let redefinition;
    if (kind === "init") redefinition = (p.strict && other.init) || other.get || other.set;
    else redefinition = other.init || other[kind];
    if (redefinition) raise(p, key.start, "Redefinition of property");
  } else {
    other = propHash[name] = { init: false, get: false, set: false };
  }
  other[kind] = true;
}

const parseExpression = function parseExpression(p, forInit , rde ) {
  const s = p.start, sl = p.startLoc;
  const expr = parseMaybeAssign(p, forInit, rde);
  if (p.type === T_COMMA) {
    const base = p.sp;
    p.stk[p.sp++] = expr;
    while (eat(p, T_COMMA)) {
      const e = parseMaybeAssign(p, forInit, rde);
      p.stk[p.sp++] = e;
    }
    return new NSequenceExpression(p, s, sl, listFrom(p, base));
  }
  return expr;
}

const parseMaybeAssign = function parseMaybeAssign(p, forInit , rde ) {
  if (p.type === T_NAME && isContextual(p, "yield")) {
    if (inGenerator(p)) return parseYield(p, forInit);
    else p.exprAllowed = false;
  }
  let ownDestructuringErrors = false, oldParenAssign = -1, oldTrailingComma = -1, oldDoubleProto = -1;
  if (rde) {
    oldParenAssign = rde.parenthesizedAssign;
    oldTrailingComma = rde.trailingComma;
    oldDoubleProto = rde.doubleProto;
    rde.parenthesizedAssign = rde.trailingComma = -1;
  } else {
    rde = rdeAcquire(p);
    ownDestructuringErrors = true;
  }
  const s = p.start, sl = p.startLoc;
  if (p.type === T_PARENL || p.type === T_NAME) {
    p.potentialArrowAt = p.start;
    p.potentialArrowInForAwait = forInit === "await";
  }
  let left = parseMaybeConditional(p, forInit, rde);
  if (TF[p.type] & F_ASSIGN) {
    const operator = p.value;
    if (p.type === T_EQ) left = toAssignable(p, left, false, rde);
    if (!ownDestructuringErrors) rde.parenthesizedAssign = rde.trailingComma = rde.doubleProto = -1;
    if (rde.shorthandAssign >= left.start) rde.shorthandAssign = -1;
    if (p.type === T_EQ) checkLValPattern(p, left);
    else checkLValSimple(p, left);
    next(p);
    const right = parseMaybeAssign(p, forInit);
    if (oldDoubleProto > -1) rde.doubleProto = oldDoubleProto;
    if (ownDestructuringErrors) p.rdeDepth--;
    return new NAssignmentExpression(p, s, sl, operator, left, right);
  } else {
    if (ownDestructuringErrors) {
      checkExpressionErrors(p, rde, true);
      p.rdeDepth--;
      return left;
    }
  }
  if (oldParenAssign > -1) rde.parenthesizedAssign = oldParenAssign;
  if (oldTrailingComma > -1) rde.trailingComma = oldTrailingComma;
  return left;
}

const parseMaybeConditional = function parseMaybeConditional(p, forInit, rde) {
  const s = p.start, sl = p.startLoc;
  // (parseExprOps inlined: it starts at the same position)
  let expr = parseMaybeUnary(p, rde, false, false, forInit);
  if (rde !== null && rde !== undefined && (rde.shorthandAssign >= 0 || rde.doubleProto >= 0)) return expr;
  if (BINOP[p.type] >= 0 && !(expr.start === s && expr.type === "ArrowFunctionExpression")) {
    expr = parseExprOp(p, expr, s, sl, -1, forInit);
    if (rde !== null && rde !== undefined && (rde.shorthandAssign >= 0 || rde.doubleProto >= 0)) return expr;
  }
  if (p.type === T_QUESTION && !(expr.type === "ArrowFunctionExpression" && expr.start === s) && eat(p, T_QUESTION)) {
    const consequent = parseMaybeAssign(p);
    expect(p, T_COLON);
    const alternate = parseMaybeAssign(p, forInit);
    return new NConditionalExpression(p, s, sl, expr, consequent, alternate);
  }
  return expr;
}

const parseExprOp = function parseExprOp(p, left, leftStartPos, leftStartLoc, minPrec, forInit) {
  let prec = BINOP[p.type];
  if (prec >= 0 && (!forInit || p.type !== T_IN)) {
    if (prec > minPrec) {
      const logical = p.type === T_LOGICALOR || p.type === T_LOGICALAND;
      const coalesce = p.type === T_COALESCE;
      if (coalesce) prec = 2;
      const op = p.value;
      next(p);
      const s = p.start, sl = p.startLoc;
      const right = parseExprOp(p, parseMaybeUnary(p, null, false, false, forInit), s, sl, prec, forInit);
      const node = buildBinary(p, leftStartPos, leftStartLoc, left, right, op, logical || coalesce);
      if ((logical && p.type === T_COALESCE) || (coalesce && (p.type === T_LOGICALOR || p.type === T_LOGICALAND)))
        raise(p, p.start, "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses");
      return parseExprOp(p, node, leftStartPos, leftStartLoc, minPrec, forInit);
    }
  }
  return left;
}

const buildBinary = function buildBinary(p, s, sl, left, right, op, logical) {
  if (right.type === "PrivateIdentifier") raise(p, right.start, "Private identifier can only be left side of binary expression");
  return logical ? new NLogicalExpression(p, s, sl, left, op, right) : new NBinaryExpression(p, s, sl, left, op, right);
}

const parseMaybeUnary = function parseMaybeUnary(p, rde, sawUnary, incDec, forInit) {
  const s = p.start, sl = p.startLoc;
  let expr;
  if (p.type === T_NAME && isContextual(p, "await") && canAwait(p)) {
    expr = parseAwait(p, forInit);
    sawUnary = true;
  } else if (TF[p.type] & F_PREFIX) {
    const update = p.type === T_INCDEC;
    const operator = p.value;
    next(p);
    const argument = parseMaybeUnary(p, null, true, update, forInit);
    checkExpressionErrors(p, rde, true);
    if (update) checkLValSimple(p, argument);
    else if (p.strict && operator === "delete" && isLocalVariableAccess(argument)) raise(p, s, "Deleting local variable in strict mode");
    else if (operator === "delete" && isPrivateFieldAccess(argument)) raise(p, s, "Private fields can not be deleted");
    else sawUnary = true;
    expr = update ? new NUpdateExpression(p, s, sl, operator, true, argument) : new NUnaryExpression(p, s, sl, operator, true, argument);
  } else if (!sawUnary && p.type === T_PRIVATEID) {
    if ((forInit || p.privateNameStack.length === 0) && p.options.checkPrivateFields) unexpected(p);
    expr = parsePrivateIdent(p);
    if (p.type !== T_IN) unexpected(p);
  } else {
    // parseExprSubscripts inlined (same start position)
    expr = parseExprAtom(p, rde, forInit);
    if (!(expr.type === "ArrowFunctionExpression" && !(p.lastTokEnd === p.lastTokStart + 1 && p.input.charCodeAt(p.lastTokStart) === 41))) {
      const t = p.type;
      if (t === T_DOT || t === T_PARENL || t === T_BRACKETL || t === T_QUESTIONDOT || t === T_BACKQUOTE) {
        expr = parseSubscripts(p, expr, s, sl, false, forInit);
        if (rde && expr.type === "MemberExpression") {
          if (rde.parenthesizedAssign >= expr.start) rde.parenthesizedAssign = -1;
          if (rde.parenthesizedBind >= expr.start) rde.parenthesizedBind = -1;
          if (rde.trailingComma >= expr.start) rde.trailingComma = -1;
        }
      }
    }
    if (rde !== null && rde !== undefined && (rde.shorthandAssign >= 0 || rde.doubleProto >= 0)) return expr;
    while (TF[p.type] & F_POSTFIX && !canInsertSemicolon(p)) {
      const operator = p.value;
      checkLValSimple(p, expr);
      next(p);
      expr = new NUpdateExpression(p, s, sl, operator, false, expr);
    }
  }
  if (p.type === T_STARSTAR && !incDec && !(expr.type === "ArrowFunctionExpression" && expr.start === s) && eat(p, T_STARSTAR)) {
    if (sawUnary) unexpected(p, p.lastTokStart);
    else return buildBinary(p, s, sl, expr, parseMaybeUnary(p, null, false, false, forInit), "**", false);
  } else {
    return expr;
  }
}

const parseExprSubscripts = function parseExprSubscripts(p, rde, forInit) {
  const s = p.start, sl = p.startLoc;
  const expr = parseExprAtom(p, rde, forInit);
  if (expr.type === "ArrowFunctionExpression" && !(p.lastTokEnd === p.lastTokStart + 1 && p.input.charCodeAt(p.lastTokStart) === 41)) return expr;
  const result = parseSubscripts(p, expr, s, sl, false, forInit);
  if (rde && result.type === "MemberExpression") {
    if (rde.parenthesizedAssign >= result.start) rde.parenthesizedAssign = -1;
    if (rde.parenthesizedBind >= result.start) rde.parenthesizedBind = -1;
    if (rde.trailingComma >= result.start) rde.trailingComma = -1;
  }
  return result;
}

const parseSubscripts = function parseSubscripts(p, base, s, sl, noCalls, forInit) {
  const maybeAsyncArrow =
    p.ecma >= 8 &&
    base.type === "Identifier" &&
    base.name === "async" &&
    p.lastTokEnd === base.end &&
    !canInsertSemicolon(p) &&
    base.end - base.start === 5 &&
    p.potentialArrowAt === base.start;
  let optionalChained = false;
  for (;;) {
    const t = p.type;
    if (t !== T_DOT && t !== T_PARENL && t !== T_BRACKETL && t !== T_QUESTIONDOT && t !== T_BACKQUOTE) {
      if (optionalChained) return new NChainExpression(p, s, sl, base);
      return base;
    }
    let element = parseSubscript(p, base, s, sl, noCalls, maybeAsyncArrow, optionalChained, forInit);
    if (element.optional) optionalChained = true;
    if (element === base || element.type === "ArrowFunctionExpression") {
      if (optionalChained) element = new NChainExpression(p, s, sl, element);
      return element;
    }
    base = element;
  }
}

const parseSubscript = function parseSubscript(p, base, s, sl, noCalls, maybeAsyncArrow, optionalChained, forInit) {
  const t = p.type;
  // quick exit for the common "no subscript follows" case
  if (t !== T_QUESTIONDOT && t !== T_BRACKETL && t !== T_DOT && t !== T_PARENL && t !== T_BACKQUOTE) return base;
  const optional = p.ecma >= 11 && eat(p, T_QUESTIONDOT);
  if (noCalls && optional) raise(p, p.lastTokStart, "Optional chaining cannot appear in the callee of new expressions");
  const computed = eat(p, T_BRACKETL);
  if (computed || (optional && p.type !== T_PARENL && p.type !== T_BACKQUOTE) || eat(p, T_DOT)) {
    let property;
    if (computed) {
      property = parseExpression(p);
      expect(p, T_BRACKETR);
    } else if (p.type === T_PRIVATEID && base.type !== "Super") {
      property = parsePrivateIdent(p);
    } else {
      property = parseIdent(p, !p.allowReservedNever);
    }
    return new NMemberExpression(p, s, sl, base, property, computed, optional);
  } else if (!noCalls && eat(p, T_PARENL)) {
    const rde = rdeAcquire(p), oldYieldPos = p.yieldPos, oldAwaitPos = p.awaitPos, oldAwaitIdentPos = p.awaitIdentPos;
    p.yieldPos = 0;
    p.awaitPos = 0;
    p.awaitIdentPos = 0;
    const exprList = parseExprList(p, T_PARENR, p.ecma >= 8, false, rde);
    p.rdeDepth--; // (fields are read below before anything reuses the slot)
    if (maybeAsyncArrow && !optional && !canInsertSemicolon(p) && eat(p, T_ARROW)) {
      checkPatternErrors(p, rde, false);
      checkYieldAwaitInDefaultParams(p);
      if (p.awaitIdentPos > 0) raise(p, p.awaitIdentPos, "Cannot use 'await' as identifier inside an async function");
      p.yieldPos = oldYieldPos;
      p.awaitPos = oldAwaitPos;
      p.awaitIdentPos = oldAwaitIdentPos;
      return parseArrowExpression(p, s, sl, exprList, true, forInit);
    }
    checkExpressionErrors(p, rde, true);
    p.yieldPos = oldYieldPos || p.yieldPos;
    p.awaitPos = oldAwaitPos || p.awaitPos;
    p.awaitIdentPos = oldAwaitIdentPos || p.awaitIdentPos;
    return new NCallExpression(p, s, sl, base, exprList, optional);
  } else if (p.type === T_BACKQUOTE) {
    if (optional || optionalChained) raise(p, p.start, "Optional chaining cannot appear in the tag of tagged template expressions");
    const quasi = parseTemplate(p, true);
    return new NTaggedTemplateExpression(p, s, sl, base, quasi);
  }
  return base;
}

const parseExprAtom = function parseExprAtom(p, rde , forInit , forNew ) {
  if (p.jsx) {
    // acorn-jsx's parseExprAtom(refShortHandDefaultPos) override: JSX
    // atoms, otherwise super.parseExprAtom(refShortHandDefaultPos) -- which
    // drops forInit and forNew
    if (p.type === T_JSXTEXT) return jsxParseText(p);
    if (p.type === T_JSXTAGSTART) return jsxParseElement(p);
    forInit = undefined;
    forNew = undefined;
  }
  if (p.type === T_SLASH) readRegexp(p);
  const canBeArrow = p.potentialArrowAt === p.start;
  const s = p.start, sl = p.startLoc;
  switch (p.type) {
    case T_SUPER: {
      if (!allowSuper(p)) raise(p, p.start, "'super' keyword outside a method");
      next(p);
      if (p.type === T_PARENL && !allowDirectSuper(p)) raise(p, s, "super() call outside constructor of a subclass");
      if (p.type !== T_DOT && p.type !== T_BRACKETL && p.type !== T_PARENL) unexpected(p);
      return new NSuper(p, s, sl);
    }
    case T_THIS:
      next(p);
      return new NThisExpression(p, s, sl);
    case T_NAME: {
      const esc = p.containsEsc;
      let id = parseIdent(p, false);
      if (p.type === T_FUNCTION && p.ecma >= 8 && !esc && id.name === "async" && !canInsertSemicolon(p) && eat(p, T_FUNCTION)) {
        overrideContext(p, C_F_EXPR);
        return parseFunction(p, s, sl, 0, false, true, forInit);
      }
      if (canBeArrow && (p.type === T_ARROW || p.type === T_NAME) && !canInsertSemicolon(p)) {
        if (eat(p, T_ARROW)) return parseArrowExpression(p, s, sl, [id], false, forInit);
        if (p.type === T_NAME && p.ecma >= 8 && id.name === "async" && !esc && (!p.potentialArrowInForAwait || p.value !== "of" || p.containsEsc)) {
          id = parseIdent(p, false);
          if (canInsertSemicolon(p) || !eat(p, T_ARROW)) unexpected(p);
          return parseArrowExpression(p, s, sl, [id], true, forInit);
        }
      }
      return id;
    }
    case T_REGEXP: {
      const val = p.value;
      const raw = p.input.slice(p.start, p.end);
      next(p);
      return new NLiteralRe(p, s, sl, val.value, raw, { pattern: val.pattern, flags: val.flags });
    }
    case T_NUM:
    case T_STRING:
      return parseLiteral(p, p.value);
    case T_NULL:
    case T_TRUE:
    case T_FALSE: {
      const val = p.type === T_NULL ? null : p.type === T_TRUE;
      const raw = KW_NAME[p.type];
      next(p);
      return new NLiteral(p, s, sl, val, raw);
    }
    case T_PARENL: {
      const st = p.start, expr = parseParenAndDistinguishExpression(p, canBeArrow, forInit);
      if (rde) {
        if (rde.parenthesizedAssign < 0 && !isSimpleAssignTarget(expr)) rde.parenthesizedAssign = st;
        if (rde.parenthesizedBind < 0) rde.parenthesizedBind = st;
      }
      return expr;
    }
    case T_BRACKETL: {
      next(p);
      const elements = parseExprList(p, T_BRACKETR, true, true, rde);
      return new NArrayExpression(p, s, sl, elements);
    }
    case T_BRACEL:
      overrideContext(p, C_B_EXPR);
      return parseObj(p, false, rde);
    case T_FUNCTION:
      next(p);
      return parseFunction(p, s, sl, 0);
    case T_CLASS:
      return parseClass(p, s, sl, false);
    case T_NEW:
      return parseNew(p);
    case T_BACKQUOTE:
      return parseTemplate(p, false);
    case T_IMPORT:
      if (p.ecma >= 11) return parseExprImport(p, forNew);
      return unexpected(p);
    default:
      unexpected(p);
  }
}

const parseExprImport = function parseExprImport(p, forNew) {
  const s = p.start, sl = p.startLoc;
  if (p.containsEsc) raise(p, p.start, "Escape sequence in keyword import");
  next(p);
  if (p.type === T_PARENL && !forNew) {
    return parseDynamicImport(p, s, sl);
  } else if (p.type === T_DOT) {
    const meta = new NIdentifier(p, s, sl, "import");
    return parseImportMeta(p, s, sl, meta);
  }
  unexpected(p);
}

const parseDynamicImport = function parseDynamicImport(p, s, sl) {
  next(p);
  const source = parseMaybeAssign(p);
  let opts;
  if (p.ecma >= 16) {
    if (!eat(p, T_PARENR)) {
      expect(p, T_COMMA);
      if (!afterTrailingComma(p, T_PARENR)) {
        opts = parseMaybeAssign(p);
        if (!eat(p, T_PARENR)) {
          expect(p, T_COMMA);
          if (!afterTrailingComma(p, T_PARENR)) unexpected(p);
        }
      } else opts = null;
    } else opts = null;
  } else if (!eat(p, T_PARENR)) {
    const errorPos = p.start;
    if (eat(p, T_COMMA) && eat(p, T_PARENR)) raise(p, errorPos, "Trailing comma is not allowed in import()");
    else unexpected(p, errorPos);
  }
  return new NImportExpression(p, s, sl, source, opts);
}

const parseImportMeta = function parseImportMeta(p, s, sl, meta) {
  next(p);
  const esc = p.containsEsc;
  const property = parseIdent(p, true);
  if (property.name !== "meta") raise(p, property.start, "The only valid meta property for import is 'import.meta'");
  if (esc) raise(p, s, "'import.meta' must not contain escaped characters");
  if (p.options.sourceType !== "module" && !p.options.allowImportExportEverywhere) raise(p, s, "Cannot use 'import.meta' outside a module");
  return new NMetaProperty(p, s, sl, meta, property);
}

const parseLiteral = function parseLiteral(p, val) {
  const s = p.start, sl = p.startLoc;
  const raw = p.input.slice(p.start, p.end);
  next(p);
  if (raw.charCodeAt(raw.length - 1) === 110) {
    const bigint = val != null ? val.toString() : raw.slice(0, -1).replace(/_/g, "");
    return new NLiteralBig(p, s, sl, val, raw, bigint);
  }
  return new NLiteral(p, s, sl, val, raw);
}

const parseParenExpression = function parseParenExpression(p) {
  expect(p, T_PARENL);
  const val = parseExpression(p);
  expect(p, T_PARENR);
  return val;
}

const parseParenAndDistinguishExpression = function parseParenAndDistinguishExpression(p, canBeArrow, forInit) {
  const s = p.start, sl = p.startLoc;
  let val;
  if (p.ecma >= 6) {
    const allowTrailingComma = p.ecma >= 8;
    next(p);
    const innerStartPos = p.start, innerStartLoc = p.startLoc;
    const base = p.sp;
    let first = true, lastIsComma = false;
    const rde = rdeAcquire(p), oldYieldPos = p.yieldPos, oldAwaitPos = p.awaitPos;
    let spreadStart;
    p.yieldPos = 0;
    p.awaitPos = 0;
    while (p.type !== T_PARENR) {
      first ? (first = false) : expect(p, T_COMMA);
      if (allowTrailingComma && afterTrailingComma(p, T_PARENR, true)) {
        lastIsComma = true;
        break;
      } else if (p.type === T_ELLIPSIS) {
        spreadStart = p.start;
        const r = parseRestBinding(p);
        p.stk[p.sp++] = r;
        if (p.type === T_COMMA) raise(p, p.start, "Comma is not permitted after the rest element");
        break;
      } else {
        const e = parseMaybeAssign(p, false, rde);
        p.stk[p.sp++] = e;
      }
    }
    const exprList = listFrom(p, base);
    const innerEndPos = p.lastTokEnd, innerEndLoc = leloc(p);
    expect(p, T_PARENR);
    if (canBeArrow && !canInsertSemicolon(p) && eat(p, T_ARROW)) {
      checkPatternErrors(p, rde, false);
      p.rdeDepth--;
      checkYieldAwaitInDefaultParams(p);
      p.yieldPos = oldYieldPos;
      p.awaitPos = oldAwaitPos;
      return parseArrowExpression(p, s, sl, exprList, false, forInit);
    }
    if (!exprList.length || lastIsComma) unexpected(p, p.lastTokStart);
    if (spreadStart) unexpected(p, spreadStart);
    checkExpressionErrors(p, rde, true);
    p.rdeDepth--;
    p.yieldPos = oldYieldPos || p.yieldPos;
    p.awaitPos = oldAwaitPos || p.awaitPos;
    if (exprList.length > 1) {
      val = new NSequenceExpression(p, innerStartPos, innerStartLoc, exprList);
      setEnd(p, val, innerEndPos, innerEndLoc);
    } else {
      val = exprList[0];
    }
  } else {
    val = parseParenExpression(p);
  }
  if (p.preserveParens) return new NParenthesizedExpression(p, s, sl, val);
  return val;
}

const parseNew = function parseNew(p) {
  if (p.containsEsc) raise(p, p.start, "Escape sequence in keyword new");
  const s = p.start, sl = p.startLoc;
  next(p);
  if (p.ecma >= 6 && p.type === T_DOT) {
    const meta = new NIdentifier(p, s, sl, "new");
    next(p);
    const esc = p.containsEsc;
    const property = parseIdent(p, true);
    if (property.name !== "target") raise(p, property.start, "The only valid meta property for new is 'new.target'");
    if (esc) raise(p, s, "'new.target' must not contain escaped characters");
    if (!allowNewDotTarget(p)) raise(p, s, "'new.target' can only be used in functions and class static block");
    return new NMetaProperty(p, s, sl, meta, property);
  }
  const cs = p.start, csl = p.startLoc;
  const callee = parseSubscripts(p, parseExprAtom(p, null, false, true), cs, csl, true, false);
  if (callee.type === "Super") raise(p, cs, "Invalid use of 'super'");
  let args;
  if (eat(p, T_PARENL)) args = parseExprList(p, T_PARENR, p.ecma >= 8, false);
  else args = emptyNewArguments;
  return new NNewExpression(p, s, sl, callee, args);
}

const parseTemplateElement = function parseTemplateElement(p, isTagged) {
  const s = p.start, sl = p.startLoc;
  let val;
  if (p.type === T_INVALIDTEMPLATE) {
    if (!isTagged) raise(p, p.start, "Bad escape sequence in untagged template literal");
    val = { raw: normalizeCR(p.value), cooked: null };
  } else {
    val = { raw: normalizeCR(p.input.slice(p.start, p.end)), cooked: p.value };
  }
  next(p);
  const tail = p.type === T_BACKQUOTE;
  return new NTemplateElement(p, s, sl, val, tail);
}

const parseTemplate = function parseTemplate(p, isTagged) {
  const s = p.start, sl = p.startLoc;
  next(p);
  let curElt = parseTemplateElement(p, isTagged);
  if (curElt.tail) {
    next(p);
    return new NTemplateLiteral(p, s, sl, [], [curElt]);
  }
  // quasi, expression, quasi, ... interleaved on the list stack
  const base = p.sp;
  p.stk[p.sp++] = curElt;
  while (!curElt.tail) {
    if (p.type === T_EOF) raise(p, p.pos, "Unterminated template literal");
    expect(p, T_DOLLARBRACEL);
    const e = parseExpression(p);
    p.stk[p.sp++] = e;
    expect(p, T_BRACER);
    curElt = parseTemplateElement(p, isTagged);
    p.stk[p.sp++] = curElt;
  }
  next(p);
  const st = p.stk, cnt = p.sp - base;
  p.sp = base;
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
  return new NTemplateLiteral(p, s, sl, expressions, quasis);
}

const isAsyncProp = function isAsyncProp(p, computed, key) {
  const t = p.type;
  return (
    !computed &&
    key.type === "Identifier" &&
    key.name === "async" &&
    (t === T_NAME || t === T_NUM || t === T_STRING || t === T_BRACKETL || t >= T_KW_FIRST || (p.ecma >= 9 && t === T_STAR)) &&
    !p.nlBefore
  );
}

const parseObj = function parseObj(p, isPattern, rde ) {
  const s = p.start, sl = p.startLoc;
  let first = true;
  let sawProto = false;
  const propHash = p.ecma >= 6 ? null : {};
  const base = p.sp;
  next(p);
  while (!eat(p, T_BRACER)) {
    if (!first) {
      expect(p, T_COMMA);
      if (p.ecma >= 5 && afterTrailingComma(p, T_BRACER)) break;
    } else first = false;
    const prop = parseProperty(p, isPattern, rde);
    if (!isPattern) {
      if (propHash === null) sawProto = checkPropClash(p, prop, sawProto, rde);
      else checkPropClash5(p, prop, propHash);
    }
    p.stk[p.sp++] = prop;
  }
  const properties = listFrom(p, base);
  return isPattern ? new NObjectPattern(p, s, sl, properties) : new NObjectExpression(p, s, sl, properties);
}

const parseProperty = function parseProperty(p, isPattern, rde) {
  const ps = p.start, psl = p.startLoc;
  let isGenerator = false, isAsync, startPos, stLoc;
  if (p.ecma >= 9 && eat(p, T_ELLIPSIS)) {
    if (isPattern) {
      const argument = parseIdent(p, false);
      if (p.type === T_COMMA) raise(p, p.start, "Comma is not permitted after the rest element");
      return new NRestElement(p, ps, psl, argument);
    }
    const argument = parseMaybeAssign(p, false, rde);
    if (p.type === T_COMMA && rde && rde.trailingComma < 0) rde.trailingComma = p.start;
    return new NSpreadElement(p, ps, psl, argument);
  }
  let method = false, shorthand = false;
  if (p.ecma >= 6) {
    if (isPattern || rde) {
      startPos = p.start;
      stLoc = p.startLoc;
    }
    if (!isPattern) isGenerator = eat(p, T_STAR);
  }
  const esc = p.containsEsc;
  let key = parsePropertyName(p);
  let computed = p.pnComputed;
  if (!isPattern && !esc && p.ecma >= 8 && !isGenerator && isAsyncProp(p, computed, key)) {
    isAsync = true;
    isGenerator = p.ecma >= 9 && eat(p, T_STAR);
    key = parsePropertyName(p);
    computed = p.pnComputed;
  } else {
    isAsync = false;
  }
  // parsePropertyValue
  let val, kind;
  if ((isGenerator || isAsync) && p.type === T_COLON) unexpected(p);
  if (eat(p, T_COLON)) {
    val = isPattern ? parseMaybeDefault(p, p.start, p.startLoc) : parseMaybeAssign(p, false, rde);
    kind = "init";
  } else if (p.ecma >= 6 && p.type === T_PARENL) {
    if (isPattern) unexpected(p);
    method = true;
    val = parseMethod(p, isGenerator, isAsync);
    kind = "init";
  } else if (
    !isPattern &&
    !esc &&
    p.ecma >= 5 &&
    !computed &&
    key.type === "Identifier" &&
    (key.name === "get" || key.name === "set") &&
    p.type !== T_COMMA &&
    p.type !== T_BRACER &&
    p.type !== T_EQ
  ) {
    if (isGenerator || isAsync) unexpected(p);
    // parseGetterSetter
    kind = key.name;
    key = parsePropertyName(p);
    computed = p.pnComputed;
    val = parseMethod(p, false);
    const paramCount = kind === "get" ? 0 : 1;
    if (val.params.length !== paramCount) raise(p, val.start, kind === "get" ? "getter should have no params" : "setter should have exactly one param");
    else if (kind === "set" && val.params[0].type === "RestElement") raise(p, val.params[0].start, "Setter cannot use rest params");
  } else if (p.ecma >= 6 && !computed && key.type === "Identifier") {
    if (isGenerator || isAsync) unexpected(p);
    checkUnreserved(p, key);
    if (key.name === "await" && !p.awaitIdentPos) p.awaitIdentPos = startPos;
    if (isPattern) {
      val = parseMaybeDefault(p, startPos, stLoc, copyNode(p, key));
    } else if (p.type === T_EQ && rde) {
      if (rde.shorthandAssign < 0) rde.shorthandAssign = p.start;
      val = parseMaybeDefault(p, startPos, stLoc, copyNode(p, key));
    } else {
      val = copyNode(p, key);
    }
    kind = "init";
    shorthand = true;
  } else unexpected(p);
  return new NProperty(p, ps, psl, method, shorthand, computed, key, val, kind);
}

// returns the key; sets pnComputed (acorn sets both on the prop)
const parsePropertyName = function parsePropertyName(p) {
  if (p.ecma >= 6 && eat(p, T_BRACKETL)) {
    const key = parseMaybeAssign(p);
    expect(p, T_BRACKETR);
    p.pnComputed = true;
    return key;
  }
  const key = p.type === T_NUM || p.type === T_STRING ? parseExprAtom(p) : parseIdent(p, !p.allowReservedNever);
  p.pnComputed = false;
  return key;
}

const parseMethod = function parseMethod(p, isGenerator, isAsync , allowDirectSuper ) {
  const s = p.start, sl = p.startLoc;
  const oldYieldPos = p.yieldPos, oldAwaitPos = p.awaitPos, oldAwaitIdentPos = p.awaitIdentPos;
  const generator = p.ecma >= 6 ? isGenerator : false;
  const async = p.ecma >= 8 ? !!isAsync : false;
  p.yieldPos = 0;
  p.awaitPos = 0;
  p.awaitIdentPos = 0;
  enterScope(p, functionFlags(isAsync, generator) | SCOPE_SUPER | (allowDirectSuper ? SCOPE_DIRECT_SUPER : 0));
  expect(p, T_PARENL);
  const params = parseBindingList(p, T_PARENR, false, p.ecma >= 8);
  checkYieldAwaitInDefaultParams(p);
  if (p.bodyOverride !== null) {
    const node = overrideFunctionNode(p, s, sl, null, generator, async, params);
    runBodyOverride(p, node, false, true, false);
    p.yieldPos = oldYieldPos;
    p.awaitPos = oldAwaitPos;
    p.awaitIdentPos = oldAwaitIdentPos;
    return finishNodeAt(p, node, "FunctionExpression", p.lastTokEnd, leloc(p));
  }
  const body = parseFunctionBody(p, params, null, false, true, false, s);
  const expression = p.fbExpression;
  p.yieldPos = oldYieldPos;
  p.awaitPos = oldAwaitPos;
  p.awaitIdentPos = oldAwaitIdentPos;
  return new NFunctionExpression(p, s, sl, null, expression, generator, async, params, body);
}

const parseArrowExpression = function parseArrowExpression(p, s, sl, params, isAsync, forInit) {
  const oldYieldPos = p.yieldPos, oldAwaitPos = p.awaitPos, oldAwaitIdentPos = p.awaitIdentPos;
  enterScope(p, functionFlags(isAsync, false) | SCOPE_ARROW);
  const async = p.ecma >= 8 ? !!isAsync : false;
  p.yieldPos = 0;
  p.awaitPos = 0;
  p.awaitIdentPos = 0;
  params = toAssignableList(p, params, true);
  if (p.bodyOverride !== null) {
    const node = overrideFunctionNode(p, s, sl, null, false, async, params);
    runBodyOverride(p, node, true, false, forInit);
    p.yieldPos = oldYieldPos;
    p.awaitPos = oldAwaitPos;
    p.awaitIdentPos = oldAwaitIdentPos;
    return finishNodeAt(p, node, "ArrowFunctionExpression", p.lastTokEnd, leloc(p));
  }
  const body = parseFunctionBody(p, params, null, true, false, forInit, s);
  const expression = p.fbExpression;
  p.yieldPos = oldYieldPos;
  p.awaitPos = oldAwaitPos;
  p.awaitIdentPos = oldAwaitIdentPos;
  return new NArrowFunctionExpression(p, s, sl, null, expression, false, async, params, body);
}

// returns the body; sets fbExpression (read it right after the call).
// s: the function node's start
const parseFunctionBody = function parseFunctionBody(p, params, id, isArrowFunction, isMethod, forInit, s) {
  const isExpression = isArrowFunction && p.type !== T_BRACEL;
  const oldStrict = p.strict;
  let useStrict = false;
  let body, expression;
  if (isExpression) {
    body = parseMaybeAssign(p, forInit);
    expression = true;
    checkParams(p, params, false);
  } else {
    const nonSimple = p.ecma >= 7 && !isSimpleParamList(params);
    if (!oldStrict || nonSimple) {
      useStrict = strictDirective(p, p.end);
      if (useStrict && nonSimple) raise(p, s, "Illegal 'use strict' directive in function with non-simple parameter list");
    }
    const oldLabels = p.labels;
    p.labels = [];
    if (useStrict) p.strict = true;
    checkParams(p, params, !oldStrict && !useStrict && !isArrowFunction && !isMethod && isSimpleParamList(params));
    if (p.strict && id) checkLValSimple(p, id, BIND_OUTSIDE);
    body = parseBlock(p, false, p.start, p.startLoc, useStrict && !oldStrict);
    expression = false;
    adaptDirectivePrologue(p, body.body);
    p.labels = oldLabels;
  }
  exitScope(p);
  p.fbExpression = expression;
  return body;
}

const checkParams = function checkParams(p, params, allowDuplicates) {
  // (names seen so far: a reused array; checkLVal* never re-enters here)
  let nameHash = null;
  if (!allowDuplicates) {
    nameHash = p.clashNames;
    nameHash.length = 0;
  }
  for (let i = 0; i < params.length; i++) checkLValInnerPattern(p, params[i], BIND_VAR, nameHash);
}

const parseExprList = function parseExprList(p, close, allowTrailingComma, allowEmpty, rde ) {
  const base = p.sp;
  let first = true;
  while (!eat(p, close)) {
    if (!first) {
      expect(p, T_COMMA);
      if (allowTrailingComma && afterTrailingComma(p, close)) break;
    } else first = false;
    let elt;
    if (allowEmpty && p.type === T_COMMA) elt = null;
    else if (p.type === T_ELLIPSIS) {
      elt = parseSpread(p, rde);
      if (rde && p.type === T_COMMA && rde.trailingComma < 0) rde.trailingComma = p.start;
    } else {
      elt = parseMaybeAssign(p, false, rde);
    }
    p.stk[p.sp++] = elt;
  }
  return listFrom(p, base);
}

const checkUnreserved = function checkUnreserved(p, ref) {
  const name = ref.name;
  if (!restricted(p, name)) return;
  const at = ref.start;
  if (inGenerator(p) && name === "yield") raise(p, at, "Cannot use 'yield' as identifier inside a generator");
  if (inAsync(p) && name === "await") raise(p, at, "Cannot use 'await' as identifier inside an async function");
  if (!(currentThisScope(p).flags & SCOPE_VAR) && name === "arguments") raise(p, at, "Cannot use 'arguments' in class field initializer");
  if (inClassStaticBlock(p) && (name === "arguments" || name === "await")) raise(p, at, "Cannot use " + name + " in class static initialization block");
  if (keywordOf(p, name) >= 0) raise(p, at, "Unexpected keyword '" + name + "'");
  if (p.ecma < 6 && p.input.slice(at, ref.end).indexOf("\\") !== -1) return;
  if ((p.strict ? p.reservedWordsStrict : p.reservedWords).has(name)) {
    if (!inAsync(p) && name === "await") raise(p, at, "Cannot use keyword 'await' outside an async function");
    raise(p, at, "The keyword '" + name + "' is reserved");
  }
}

const parseIdent = function parseIdent(p, liberal ) {
  const s = p.start, sl = p.startLoc;
  let name;
  if (p.type === T_NAME) {
    name = p.value;
  } else if (p.type >= T_KW_FIRST) {
    name = KW_NAME[p.type];
    if ((name === "class" || name === "function") && (p.lastTokEnd !== p.lastTokStart + 1 || p.input.charCodeAt(p.lastTokStart) !== 46)) {
      p.ctx.pop();
    }
    p.type = T_NAME;
  } else {
    unexpected(p);
  }
  next(p, !!liberal);
  const node = new NIdentifier(p, s, sl, name);
  if (!liberal) {
    checkUnreserved(p, node);
    if (name === "await" && !p.awaitIdentPos) p.awaitIdentPos = s;
  }
  return node;
}

const parsePrivateIdent = function parsePrivateIdent(p) {
  const s = p.start, sl = p.startLoc;
  let name;
  if (p.type === T_PRIVATEID) name = p.value;
  else unexpected(p);
  next(p);
  const node = new NPrivateIdentifier(p, s, sl, name);
  if (p.options.checkPrivateFields) {
    if (p.privateNameStack.length === 0) raise(p, s, "Private field '#" + name + "' must be declared in an enclosing class");
    else p.privateNameStack[p.privateNameStack.length - 1].used.push(node);
  }
  return node;
}

const parseYield = function parseYield(p, forInit) {
  if (!p.yieldPos) p.yieldPos = p.start;
  const s = p.start, sl = p.startLoc;
  next(p);
  let delegate, argument;
  if (p.type === T_SEMI || canInsertSemicolon(p) || (p.type !== T_STAR && !(TF[p.type] & F_STARTS))) {
    delegate = false;
    argument = null;
  } else {
    delegate = eat(p, T_STAR);
    argument = parseMaybeAssign(p, forInit);
  }
  return new NYieldExpression(p, s, sl, delegate, argument);
}

const parseAwait = function parseAwait(p, forInit) {
  if (!p.awaitPos) p.awaitPos = p.start;
  const s = p.start, sl = p.startLoc;
  next(p);
  const argument = parseMaybeUnary(p, null, true, false, forInit);
  return new NAwaitExpression(p, s, sl, argument);
}

// ------------------------------------------------------------ acorn-jsx parse functions

// jsx_parseText: parseLiteral(this.value) with type "JSXText"
const jsxParseText = function jsxParseText(p) {
  const s = p.start, sl = p.startLoc;
  const val = p.value;
  const raw = p.input.slice(p.start, p.end);
  next(p);
  if (raw.charCodeAt(raw.length - 1) === 110) {
    const bigint = val != null ? val.toString() : raw.slice(0, -1).replace(/_/g, "");
    return new NJSXTextBig(p, s, sl, val, raw, bigint);
  }
  return new NJSXText(p, s, sl, val, raw);
}

const jsxParseIdentifier = function jsxParseIdentifier(p) {
  const s = p.start, sl = p.startLoc;
  let name;
  if (p.type === T_JSXNAME) name = p.value;
  else if (p.type >= T_KW_FIRST) name = KW_NAME[p.type];
  else unexpected(p);
  next(p);
  return new NJSXIdentifier(p, s, sl, name);
}

const jsxParseNamespacedName = function jsxParseNamespacedName(p) {
  const s = p.start, sl = p.startLoc;
  const name = jsxParseIdentifier(p);
  if (!p.jsxNamespaces || !eat(p, T_COLON)) return name;
  const local = jsxParseIdentifier(p);
  return new NJSXNamespacedName(p, s, sl, name, local);
}

const jsxParseElementName = function jsxParseElementName(p) {
  if (p.type === T_JSXTAGEND) return "";
  const s = p.start, sl = p.startLoc;
  let node = jsxParseNamespacedName(p);
  if (p.type === T_DOT && node.type === "JSXNamespacedName" && !p.jsxNamespacedObjects) unexpected(p);
  while (eat(p, T_DOT)) {
    const property = jsxParseIdentifier(p);
    node = new NJSXMemberExpression(p, s, sl, node, property);
  }
  return node;
}

const jsxParseAttributeValue = function jsxParseAttributeValue(p) {
  switch (p.type) {
    case T_BRACEL: {
      const node = jsxParseExpressionContainer(p);
      if (node.expression.type === "JSXEmptyExpression") raise(p, node.start, "JSX attributes must only be assigned a non-empty expression");
      return node;
    }
    case T_JSXTAGSTART:
    case T_STRING:
      return parseExprAtom(p);
    default:
      raise(p, p.start, "JSX value should be either an expression or a quoted JSX text");
  }
}

// starts at the end of the `{` and ends at the start of the `}`
const jsxParseEmptyExpression = function jsxParseEmptyExpression(p) {
  const node = new NJSXEmptyExpression(p, p.lastTokEnd, leloc(p));
  return setEnd(p, node, p.start, p.startLoc);
}

const jsxParseExpressionContainer = function jsxParseExpressionContainer(p) {
  const s = p.start, sl = p.startLoc;
  next(p);
  const expression = p.type === T_BRACER ? jsxParseEmptyExpression(p) : parseExpression(p);
  expect(p, T_BRACER);
  return new NJSXExpressionContainer(p, s, sl, expression);
}

const jsxParseAttribute = function jsxParseAttribute(p) {
  const s = p.start, sl = p.startLoc;
  if (eat(p, T_BRACEL)) {
    expect(p, T_ELLIPSIS);
    const argument = parseMaybeAssign(p);
    expect(p, T_BRACER);
    return new NJSXSpreadAttribute(p, s, sl, argument);
  }
  const name = jsxParseNamespacedName(p);
  const val = eat(p, T_EQ) ? jsxParseAttributeValue(p) : null;
  return new NJSXAttribute(p, s, sl, name, val);
}

const jsxParseOpeningElementAt = function jsxParseOpeningElementAt(p, s, sl) {
  const base = p.sp;
  const nodeName = jsxParseElementName(p);
  while (p.type !== T_SLASH && p.type !== T_JSXTAGEND) {
    const a = jsxParseAttribute(p);
    p.stk[p.sp++] = a;
  }
  const attributes = listFrom(p, base);
  const selfClosing = eat(p, T_SLASH);
  expect(p, T_JSXTAGEND);
  return nodeName ? new NJSXOpeningElement(p, s, sl, attributes, nodeName, selfClosing) : new NJSXOpeningFragment(p, s, sl, attributes, selfClosing);
}

const jsxParseClosingElementAt = function jsxParseClosingElementAt(p, s, sl) {
  const nodeName = jsxParseElementName(p);
  expect(p, T_JSXTAGEND);
  return nodeName ? new NJSXClosingElement(p, s, sl, nodeName) : new NJSXClosingFragment(p, s, sl);
}

const jsxParseElementAt = function jsxParseElementAt(p, s, sl) {
  const base = p.sp;
  const openingElement = jsxParseOpeningElementAt(p, s, sl);
  let closingElement = null;
  if (!openingElement.selfClosing) {
    contents: for (;;) {
      switch (p.type) {
        case T_JSXTAGSTART: {
          const cs = p.start, csl = p.startLoc;
          next(p);
          if (eat(p, T_SLASH)) {
            closingElement = jsxParseClosingElementAt(p, cs, csl);
            break contents;
          }
          const el = jsxParseElementAt(p, cs, csl);
          p.stk[p.sp++] = el;
          break;
        }
        case T_JSXTEXT: {
          const t = parseExprAtom(p);
          p.stk[p.sp++] = t;
          break;
        }
        case T_BRACEL: {
          const c = jsxParseExpressionContainer(p);
          p.stk[p.sp++] = c;
          break;
        }
        default:
          unexpected(p);
      }
    }
    if (jsxQualifiedName(closingElement.name) !== jsxQualifiedName(openingElement.name))
      raise(p, closingElement.start, "Expected corresponding JSX closing tag for <" + jsxQualifiedName(openingElement.name) + ">");
  }
  const children = listFrom(p, base);
  const isElement = !!openingElement.name;
  if (p.type === T_RELATIONAL && p.value === "<") raise(p, p.start, "Adjacent JSX elements must be wrapped in an enclosing tag");
  return isElement
    ? new NJSXElement(p, s, sl, openingElement, closingElement, children)
    : new NJSXFragment(p, s, sl, openingElement, closingElement, children);
}

const jsxParseElement = function jsxParseElement(p) {
  const s = p.start, sl = p.startLoc;
  next(p);
  return jsxParseElementAt(p, s, sl);
}

// ------------------------------------------------------------ helpers

const isJsWhitespace = function isJsWhitespace(c) {
  // \s in JS regexps (used by acorn's skipWhiteSpace) beyond ASCII
  return (
    c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
  );
}

const normalizeCR = function normalizeCR(s) {
  return s.indexOf("\r") === -1 ? s : s.replace(/\r\n?/g, "\n");
}

const stringToNumber = function stringToNumber(str, isLegacyOctalNumericLiteral) {
  if (isLegacyOctalNumericLiteral) return parseInt(str, 8);
  return parseFloat(str.indexOf("_") === -1 ? str : str.replace(/_/g, ""));
}

const stringToBigInt = function stringToBigInt(str) {
  if (typeof BigInt !== "function") return null;
  return BigInt(str.replace(/_/g, ""));
}

const isLocalVariableAccess = function isLocalVariableAccess(node) {
  return node.type === "Identifier" || (node.type === "ParenthesizedExpression" && isLocalVariableAccess(node.expression));
}

const isPrivateFieldAccess = function isPrivateFieldAccess(node) {
  return (
    (node.type === "MemberExpression" && node.property.type === "PrivateIdentifier") ||
    (node.type === "ChainExpression" && isPrivateFieldAccess(node.expression)) ||
    (node.type === "ParenthesizedExpression" && isPrivateFieldAccess(node.expression))
  );
}

const isSimpleParamList = function isSimpleParamList(params) {
  for (let i = 0; i < params.length; i++) if (params[i].type !== "Identifier") return false;
  return true;
}

const isPrivateNameConflicted = function isPrivateNameConflicted(privateNameMap, element) {
  const name = element.key.name;
  const curr = privateNameMap[name];
  let nx = "true";
  if (element.type === "MethodDefinition" && (element.kind === "get" || element.kind === "set")) nx = (element.static ? "s" : "i") + element.kind;
  if ((curr === "iget" && nx === "iset") || (curr === "iset" && nx === "iget") || (curr === "sget" && nx === "sset") || (curr === "sset" && nx === "sget")) {
    privateNameMap[name] = "true";
    return false;
  } else if (!curr) {
    privateNameMap[name] = nx;
    return false;
  }
  return true;
}

const checkKeyName = function checkKeyName(computed, key, name) {
  return !computed && ((key.type === "Identifier" && key.name === name) || (key.type === "Literal" && key.value === name));
}

// ------------------------------------------------------------ entry points
// (options normalized by getOptions, input a string)

// acorn's parse(): new Parser(options, input) then parse()
export function fastParse(src, opts, jsxOpts , override ) {
  return asParse(0, src, opts, 0, jsxOpts, override);
}

// acorn's parseExpressionAt: new Parser(options, input, pos), nextToken(),
// parseExpression() -- no end-of-input or top-level checks
export function fastParseExpressionAt(src, at, opts, jsxOpts , override ) {
  return asParse(1, src, opts, at, jsxOpts, override);
}

// ------------------------------------------------------------ tokenizer()
// acorn's tokenizer() returns the Parser instance itself; this one is an
// object with the same token API (getToken, iteration, next, the token
// state as properties) around a parse State of its own.

const STATE = Symbol();

const getToken = (p) => {
  next(p);
  return currentToken(p);
};

// the prototype of tokenizer() objects (inheriting from Parser.prototype)
export function tokenizerProto(parentProto) {
  const proto = Object.create(parentProto);
  const acc = (name, get, set ) =>
    Object.defineProperty(proto, name, {
      get() {
        return get(this[STATE]);
      },
      set: set
        ? function (           v) {
            set(this[STATE], v);
          }
        : undefined,
      configurable: true,
    });
  acc("type", (p) => ttObj(p, p.type));
  for (const k of ["value", "start", "end", "startLoc", "lastTokStart", "lastTokEnd", "lastTokStartLoc", "strict", "inModule"]) acc(k, (p) => p[k]);
  for (const k of ["pos", "curLine", "lineStart", "exprAllowed", "containsEsc"]) acc(k, (p) => p[k], (p, v) => (p[k] = v));
  acc("endLoc", (p) => (p.locations ? eloc(p) : p.endLoc));
  acc("lastTokEndLoc", (p) => (p.lastTokStartLoc === null ? null : leloc(p)));
  acc("context", (p) => p.ctx.map((c) => CTX_OBJ[c]));
  proto.getToken = function (         ) {
    return getToken(this[STATE]);
  };
  proto.next = function (           ignoreEscapeSequenceInKeyword) {
    next(this[STATE], ignoreEscapeSequenceInKeyword);
  };
  proto.nextToken = function (         ) {
    nextToken(this[STATE]);
  };
  proto.curPosition = function (         ) {
    return curPosition(this[STATE]);
  };
  proto.curContext = function (         ) {
    return CTX_OBJ[curContext(this[STATE])];
  };
  proto.raise = proto.raiseRecoverable = function (           at, message) {
    raise(this[STATE], at, message);
  };
  proto.unexpected = function (           at) {
    unexpected(this[STATE], at);
  };
  proto[Symbol.iterator] = function (         ) {
    const self = this;
    return {
      next() {
        const token = self.getToken();
        return { done: token.type === acornTT.eof, value: token };
      },
    };
  };
  return proto;
}

export function createTokenizer(proto, opts, src) {
  const tok = Object.create(proto);
  tok.options = opts;
  tok.input = src;
  tok.sourceFile = opts.sourceFile;
  const p = (tok[STATE] = new State());
  init(p, opts, src, 0, null, null);
  return tok;
}
// generated from parser.mts by tools/ts-build.mjs; edit that file
