// fast-acorn: drop-in replacement for acorn 8.18 (same exports, same ASTs,
// same errors). `parse()` / `Parser.parse()` run the fast parser for the
// configurations it supports and fall back to the vendored original for
// everything else — including every input that is not valid JavaScript, so
// errors (message, pos, loc, raisedAt) are produced by acorn itself.
// `parseExpressionAt()` / `Parser.parseExpressionAt()` take the fast path the
// same way. `onComment` (array or function form) is supported: comments are
// buffered and delivered in scan order after a successful fast parse, so a
// fallback never reports a comment twice. onToken, onInsertedSemicolon,
// onTrailingComma, program, startLocation, ecmaVersion < 16, Parser.extend()
// plugins and tokenizer() use the original implementation unchanged.

import * as V from "./vendor/acorn.mjs";
import { fastParse, fastParseExpressionAt } from "./parser.mjs";

const getOptions = V._getOptions;
const origParse = V.Parser.parse;
const origParseExpressionAt = V.Parser.parseExpressionAt;

function eligible(o) {
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

function tryFast(input, options) {
  const o = getOptions(options); // throws exactly like acorn for invalid combos
  if (!eligible(o)) return undefined;
  try {
    return fastParse(String(input), o);
  } catch (e) {
    // BAIL (syntax error or unsupported construct), stack overflow, or any
    // unexpected condition: let the original parser decide
    return undefined;
  }
}

// Parser.parse on the base class takes the fast path; subclasses created by
// Parser.extend(...) keep acorn's original behaviour.
V.Parser.parse = function parse(input, options) {
  if (this === V.Parser) {
    const r = tryFast(input, options);
    if (r !== undefined) return r;
  }
  return origParse.call(this, input, options);
};

function tryFastExpressionAt(input, pos, options) {
  const o = getOptions(options);
  if (!eligible(o)) return undefined;
  input = String(input);
  // acorn uses "startPos || 0"; only plain in-range integers are handled here
  if (typeof pos !== "number" || !Number.isInteger(pos) || pos < 0 || pos > input.length) return undefined;
  try {
    return fastParseExpressionAt(input, pos, o);
  } catch (e) {
    return undefined;
  }
}

V.Parser.parseExpressionAt = function parseExpressionAt(input, pos, options) {
  if (this === V.Parser) {
    const r = tryFastExpressionAt(input, pos, options);
    if (r !== undefined) return r;
  }
  return origParseExpressionAt.call(this, input, pos, options);
};

export function parse(input, options) {
  return V.Parser.parse(input, options);
}

export function parseExpressionAt(input, pos, options) {
  return V.Parser.parseExpressionAt(input, pos, options);
}

export function tokenizer(input, options) {
  return V.Parser.tokenizer(input, options);
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
