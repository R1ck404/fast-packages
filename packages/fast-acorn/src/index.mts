// @r1ck404/fast-acorn: drop-in replacement for acorn 8.18 (same exports, same ASTs,
// same errors, same callbacks). parse(), parseExpressionAt() and tokenizer()
// -- and Parser.parse / parseExpressionAt / tokenizer on the base class --
// run the fast parser (parser.mjs) for every ecmaVersion and option; so do
// Parser.extend() subclasses it recognises: acorn-jsx (the genuine acorn-jsx
// 5.3.2 class, recognised exactly, or one made by @r1ck404/fast-acorn-jsx;
// jsx-detect.mjs), subclasses that only override parseFunctionBody in a way
// the fast parser can host (override.mjs, e.g. Nodepod's topLevelParser),
// and empty subclasses of those.
//
// Everything else -- other plugins, `new Parser(...)` used directly, a
// patched Parser.prototype -- runs acorn's own parser code (generic.cjs),
// which shares this module's token types, contexts, Node, Position, ...
// It is not loaded until it is needed: Parser.prototype inherits acorn's
// methods from a prototype that receives them on first use. In Node they
// are loaded on demand (synchronously, in a way bundlers do not follow);
// elsewhere `import "@r1ck404/fast-acorn/full"` installs them up front.

import {
  Node,
  Position,
  SourceLocation,
  TokContext,
  Token,
  TokenType,
  defaultOptions,
  getLineInfo,
  getOptions,
  isIdentifierChar,
  isIdentifierStart,
  isNewLine,
  keywordTypes,
  lineBreak,
  lineBreakG,
  nextLineBreak,
  nonASCIIwhitespace,
  tokContexts,
  tokTypes,
  version,
  emptyNewArguments,
  emptyImportSpecifiers,
} from "./shared.mjs";
import { fastParse, fastParseExpressionAt, BodyFacade, tokenizerProto, createTokenizer } from "./parser.mjs";
import { bodyOverrideOf } from "./override.mjs";
import { jsxOptionsOf, registerJsxClass } from "./jsx-detect.mjs";
// (acorn's public types, as shipped in index.d.ts)
import type { Options, Program, Expression } from "../index.js";

// ------------------------------------------------------------ the generic parser

// acorn's Parser.prototype methods and getters, once installed
const genericProto: any = {};
// acorn's constructor body, once installed
let initGeneric: ((this: any, options: any, input: any, startPos?: number) => void) | null = null;
let loadTried = false;


function installGeneric(factory: (core: any, proto: any) => any): void {
  if (initGeneric !== null) return;
  maybePatched = true;
  initGeneric = factory(core, genericProto);
  // super.parseFunctionBody() from a hosted override reaches Parser.prototype's own wrapper
  Object.setPrototypeOf(Parser.prototype, genericProto);
}

// Node: load generic.cjs from the package root (build.mjs makes the path
// "./generic.cjs" in index.mjs, which is there) with a createRequire reached
// through process.getBuiltinModule, which bundlers leave alone; false
// elsewhere
function tryLoadGeneric(): boolean {
  if (initGeneric !== null) return true;
  if (loadTried) return false;
  loadTried = true;
  const g: any = typeof process === "object" && process !== null ? (process as any).getBuiltinModule : undefined;
  if (typeof g !== "function") return false;
  let req;
  try {
    req = g("module").createRequire(import.meta.url);
  } catch {
    return false;
  }
  const file = "../generic.cjs";
  let factory;
  try {
    factory = req(file);
  } catch (e) {
    if (e && (e as any).code === "MODULE_NOT_FOUND") return false;
    throw e;
  }
  installGeneric(factory);
  return true;
}

function needGeneric(): (this: any, options: any, input: any, startPos?: number) => void {
  if (initGeneric === null && !tryLoadGeneric())
    throw new Error(
      "@r1ck404/fast-acorn: acorn's own parser code (for Parser.extend() plugins it does not recognise, a patched " +
        'Parser.prototype, `new Parser()`) is not loaded here. Add `import "@r1ck404/fast-acorn/full";` (or "acorn/full") once, first.',
    );
  return initGeneric;
}

// Until the generic parser is installed, Parser.prototype inherits from a
// proxy: looking up any other name (e.g. a plugin reading
// Parser.prototype.parseStatement) loads it first, where that is possible,
// and adding one (Parser.prototype.x = ...) is noticed.
const lazyTarget = Object.create(Object.prototype);
const lazyProto = new Proxy(lazyTarget, {
  get(target, key, receiver) {
    if (typeof key === "string" && !(key in target)) {
      maybePatched = true;
      if (tryLoadGeneric()) return Reflect.get(genericProto, key, receiver);
    }
    return Reflect.get(target, key, receiver);
  },
  has(target, key) {
    if (typeof key === "string" && !(key in target)) {
      maybePatched = true;
      if (tryLoadGeneric()) return key in genericProto;
    }
    return key in target;
  },
  set(target, key, v, receiver) {
    // (not for objects that inherit from Parser.prototype: tokenizer objects,
    // prototypes of ES5-style subclasses)
    if (receiver === Parser.prototype) maybePatched = true;
    return Reflect.set(target, key, v, receiver);
  },
});

// ------------------------------------------------------------ Parser

// acorn's Parser constructor (runs acorn's own code: an instance made with
// `new` is a real acorn parser)
export function Parser(this: any, options: Options, input: string, startPos?: number) {
  needGeneric().call(this, options, input, startPos);
}
Object.setPrototypeOf(Parser.prototype, lazyProto);

// super.parseFunctionBody() from an override running on the fast parser's
// facade (override.mjs) is handed to the fast parser; otherwise acorn's method
function parseFunctionBody(this: any, node: any, isArrowFunction?: boolean, isMethod?: boolean, forInit?: boolean) {
  if (this instanceof BodyFacade) return (this as any).superParseFunctionBody(node, isArrowFunction, isMethod, forInit);
  needGeneric();
  return genericProto.parseFunctionBody.call(this, node, isArrowFunction, isMethod, forInit);
}
Object.defineProperty(Parser.prototype, "parseFunctionBody", { value: parseFunctionBody, writable: true, configurable: true });

// Parser.prototype modified directly (a property added or replaced,
// parseFunctionBody replaced or deleted): acorn's own code runs, for the base
// class too. A property set back to what it was (acorn's method) is no
// patch. Only checked once anything has looked up or set acorn's methods
// through Parser.prototype, or the generic parser is installed: before, a
// patch cannot have happened unnoticed, except one made with
// Object.defineProperty without reading anything from Parser.prototype first.
var maybePatched = false;
function patched(): boolean {
  if (!maybePatched) return false;
  const p: any = Parser.prototype;
  const names = Object.getOwnPropertyNames(p);
  let own = false;
  for (let i = 0; i < names.length; i++) {
    const k = names[i];
    if (k === "constructor") continue;
    const d: any = Object.getOwnPropertyDescriptor(p, k);
    if (k === "parseFunctionBody") {
      if (d.value !== parseFunctionBody) return true;
      own = true;
    } else if (!("value" in d) || d.value !== genericProto[k]) return true;
  }
  return !own;
}

// how a class parses: null (acorn's code) or [jsx options, body override]
const EMPTY_SUB = /^class\b[^{]*\{\s*\}$/;
const modes = new WeakMap();
function modeOf(C: any): [any, any] | null {
  if (C === Parser) return BASE;
  let m = modes.get(C);
  if (m === undefined) {
    m = null;
    // a subclass with nothing of its own behaves like its parent
    try {
      const parent = Object.getPrototypeOf(C);
      if (
        typeof C === "function" &&
        typeof parent === "function" &&
        C.prototype &&
        Object.getPrototypeOf(C.prototype) === parent.prototype &&
        Reflect.ownKeys(C.prototype).length === 1 &&
        C.prototype.constructor === C &&
        Reflect.ownKeys(C).length === 3 &&
        EMPTY_SUB.test(Function.prototype.toString.call(C))
      )
        m = { parent };
    } catch {}
    modes.set(C, m);
  }
  if (m !== null) {
    // (re-checked: the class could have been modified since)
    if (Reflect.ownKeys(C.prototype).length !== 1 || Reflect.ownKeys(C).length !== 3) return null;
    return modeOf(m.parent);
  }
  const jsx = jsxOptionsOf(C, Parser);
  if (jsx !== null) return [jsx, null];
  const bodyOverride = bodyOverrideOf(C, Parser);
  if (bodyOverride !== null) return [null, bodyOverride];
  return null;
}
const BASE: [any, any] = [null, null];

// (the static methods in acorn's order)
(Parser as any).extend = function extend(this: any, ...plugins: Array<(cls: any) => any>) {
  let cls = this;
  for (let i = 0; i < plugins.length; i++) cls = plugins[i](cls);
  return cls;
};

(Parser as any).parse = function parse(this: any, input: unknown, options: Options): Program {
  const mode = patched() ? null : modeOf(this);
  if (mode !== null) {
    // (acorn's constructor: getOptions first, then String(input))
    const o = getOptions(options);
    return fastParse(String(input), o, mode[0], mode[1]);
  }
  return new this(options, input).parse();
};

(Parser as any).parseExpressionAt = function parseExpressionAt(this: any, input: unknown, pos: number, options: Options): Expression {
  // (a position that is truthy but not a number: acorn's code, with its
  // arithmetic on it; a falsy one is 0 in acorn too)
  const mode = patched() || (typeof pos !== "number" && pos) ? null : modeOf(this);
  if (mode !== null) {
    const o = getOptions(options);
    return fastParseExpressionAt(String(input), pos, o, mode[0], mode[1]);
  }
  const parser = new this(options, input, pos);
  parser.nextToken();
  return parser.parseExpression();
};

let tokProto: any = null;
(Parser as any).tokenizer = function tokenizer(this: any, input: unknown, options: Options) {
  if (this === Parser && !patched()) {
    const o = getOptions(options);
    if (tokProto === null) tokProto = tokenizerProto(Parser.prototype);
    return createTokenizer(tokProto, o, String(input));
  }
  return new this(options, input);
};

// @r1ck404/fast-acorn-jsx hands every class it creates to this hook. Registration
// is by identity, so it survives bundling and minification; only classes
// made directly on this Parser take the native JSX path.
Object.defineProperty(Parser, Symbol.for("@r1ck404/fast-acorn:registerJsxClass"), {
  value: (P: unknown, cls: Function, options: any) => {
    if (P === Parser) registerJsxClass(cls, options);
  },
});
// @r1ck404/fast-acorn/full installs the generic parser through this hook
Object.defineProperty(Parser, Symbol.for("@r1ck404/fast-acorn:installGeneric"), { value: installGeneric });

// ------------------------------------------------------------ exports

export function parse(input: string, options: Options): Program {
  return (Parser as any).parse(input, options);
}

export function parseExpressionAt(input: string, pos: number, options: Options): Expression {
  return (Parser as any).parseExpressionAt(input, pos, options);
}

export function tokenizer(input: string, options: Options) {
  return (Parser as any).tokenizer(input, options);
}

(Parser as any).acorn = {
  Parser,
  version,
  defaultOptions,
  Position,
  SourceLocation,
  getLineInfo,
  Node,
  TokenType,
  tokTypes,
  keywordTypes,
  TokContext,
  tokContexts,
  isIdentifierChar,
  isIdentifierStart,
  Token,
  isNewLine,
  lineBreak,
  lineBreakG,
  nonASCIIwhitespace,
};

// the objects generic.cjs shares with this module
const core = { ...(Parser as any).acorn, nextLineBreak, getOptions, emptyNewArguments, emptyImportSpecifiers };

// acorn's function names (index.mjs is minified): the property names
for (const o of [Parser, (Parser as any).acorn, Position.prototype, { parse, parseExpressionAt, tokenizer }])
  for (const k in o) if (typeof o[k] === "function" && o[k].name !== k) Object.defineProperty(o[k], "name", { value: k });

export {
  Node,
  Position,
  SourceLocation,
  TokContext,
  Token,
  TokenType,
  defaultOptions,
  getLineInfo,
  isIdentifierChar,
  isIdentifierStart,
  isNewLine,
  keywordTypes,
  lineBreak,
  lineBreakG,
  nonASCIIwhitespace,
  tokContexts,
  tokTypes,
  version,
};
