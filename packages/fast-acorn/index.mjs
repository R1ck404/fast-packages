// @r1ck404/fast-acorn: drop-in replacement for acorn 8.18 (same exports, same ASTs,
// same errors). `parse()` / `Parser.parse()` run the fast parser for the
// configurations it supports and fall back to the vendored original for
// everything else — including every input that is not valid JavaScript, so
// errors (message, pos, loc, raisedAt) are produced by acorn itself.
// `parseExpressionAt()` / `Parser.parseExpressionAt()` take the fast path the
// same way. `onComment` (array or function form) is supported: comments are
// buffered and delivered in scan order after a successful fast parse, so a
// fallback never reports a comment twice.
//
// Parser.extend() subclasses take the fast path when they are acorn-jsx
// (jsx-detect.mjs: the genuine acorn-jsx 5.3.2 class, recognised exactly, or
// one made by @r1ck404/fast-acorn-jsx) or only override parseFunctionBody in a
// way the fast parser can host (override.mjs: e.g. Nodepod's topLevelParser).
//
// onToken, onInsertedSemicolon, onTrailingComma, program, startLocation,
// ecmaVersion < 16, other plugins and tokenizer() run the vendored acorn,
// whose nextToken is replaced by a faster one with identical results
// (fasttok.mjs) as long as the parser's tokenizer methods are acorn's own.

import * as V from "./vendor/acorn.mjs";
import "./fasttok.mjs"; // faster nextToken for everything that still runs acorn itself
import { fastParse, fastParseExpressionAt, BodyFacade, exactErrors } from "./parser.mjs";
import { bodyOverrideOf } from "./override.mjs";
import { jsxOptionsOf, registerJsxClass } from "./jsx-detect.mjs";
import { getOptions as fastGetOptions } from "./options.mjs";
// (acorn's public types, as shipped in index.d.ts)
                                                                                    
                                                   
                                                   

// @r1ck404/fast-acorn-jsx hands every class it creates to this hook. Registration
// is by identity, so it survives bundling and minification; only classes
// made directly on this Parser take the native JSX path.
Object.defineProperty(V.Parser, Symbol.for("@r1ck404/fast-acorn:registerJsxClass"), {
  value: (Parser         , cls          , options                     ) => {
    if (Parser === V.Parser) registerJsxClass(cls, options);
  },
});

// (same result as acorn's getOptions, see options.mjs)
const getOptions = fastGetOptions;
const origParse = V.Parser.parse;
const origParseExpressionAt = V.Parser.parseExpressionAt;

function eligible(o                     )          {
  return (
    o.ecmaVersion >= 16 &&
    !o.onToken &&
    !o.program &&
    !o.startLocation &&
    !o.onInsertedSemicolon &&
    !o.onTrailingComma &&
    (o.sourceType === "script" || o.sourceType === "module" || o.sourceType === "commonjs")
  );
}

// acorn's Parser constructor: getOptions(options) (throws exactly like acorn
// for invalid combinations), then String(input) -- done once here, so a
// fallback re-parse does not convert a non-string input a second time
function parseVia(cls          , input         , options         , jsx                   , bodyOverride                     )          {
  const o = getOptions(options);
  const str = String(input);
  if (eligible(o)) {
    try {
      return fastParse(str, o, jsx, bodyOverride);
    } catch (e) {
      // acorn's own "Unexpected token" error, made by the fast parser
      if (exactErrors.has(e)) throw e;
      // BAIL (other syntax errors, unsupported constructs), stack overflow,
      // or any unexpected condition: let the original parser decide
    }
  }
  return origParse.call(cls, str, options);
}

// Parser.parse on the base class takes the fast path, and so does a class
// made by acorn-jsx (see jsx-detect.mjs) or one that only overrides
// parseFunctionBody in a way the fast parser can host (see override.mjs);
// other subclasses created by Parser.extend(...) keep acorn's behaviour.
V.Parser.parse = function parse(                input         , options         )          {
  if (this === V.Parser) return parseVia(this, input, options, null, null);
  const jsx = jsxOptionsOf(this);
  if (jsx !== null) return parseVia(this, input, options, jsx, null);
  const bodyOverride = bodyOverrideOf(this);
  if (bodyOverride !== null) return parseVia(this, input, options, null, bodyOverride);
  return origParse.call(this, input, options);
};

function parseExpressionAtVia(cls          , input         , pos        , options         , jsx                   , bodyOverride                     )             {
  const o = getOptions(options);
  const str = String(input);
  // acorn uses "startPos || 0"; only plain in-range integers are handled here
  if (eligible(o) && typeof pos === "number" && Number.isInteger(pos) && pos >= 0 && pos <= str.length) {
    try {
      return fastParseExpressionAt(str, pos, o, jsx, bodyOverride);
    } catch (e) {
      if (exactErrors.has(e)) throw e;
    }
  }
  return origParseExpressionAt.call(cls, str, pos, options);
}

V.Parser.parseExpressionAt = function parseExpressionAt(                input         , pos        , options         )             {
  if (this === V.Parser) return parseExpressionAtVia(this, input, pos, options, null, null);
  const jsx = jsxOptionsOf(this);
  if (jsx !== null) return parseExpressionAtVia(this, input, pos, options, jsx, null);
  const bodyOverride = bodyOverrideOf(this);
  if (bodyOverride !== null) return parseExpressionAtVia(this, input, pos, options, null, bodyOverride);
  return origParseExpressionAt.call(this, input, pos, options);
};

// super.parseFunctionBody() from an override running on the fast parser's
// facade reaches acorn's method: hand it to the fast parser
const origParseFunctionBody = V.Parser.prototype.parseFunctionBody;
V.Parser.prototype.parseFunctionBody = function (           node     , isArrowFunction          , isMethod          , forInit          )       {
  if (this instanceof BodyFacade) return this.superParseFunctionBody(node, isArrowFunction, isMethod, forInit);
  return origParseFunctionBody.call(this, node, isArrowFunction, isMethod, forInit);
};

export function parse(input        , options         )          {
  return V.Parser.parse(input, options)           ;
}

export function parseExpressionAt(input        , pos        , options         )             {
  return V.Parser.parseExpressionAt(input, pos, options)              ;
}

export function tokenizer(input        , options         )                                                                        {
  return V.Parser.tokenizer(input, options)       ;
}

export const {
  Node,
  Parser,
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
} = V;
// generated from index.mts by tools/ts-build.mjs; edit that file
