// @r1ck404/fast-acorn: a faster `nextToken` for the vendored acorn Parser itself.
//
// Everything that runs real acorn — Parser.extend() plugins (e.g. Nodepod's
// topLevelParser), tokenizer(), and the re-parse that produces the exact
// SyntaxError after the fast parser bails — spends most of its time in
// acorn's tokenizer. This module replaces Parser.prototype.nextToken with a
// version that reads the common tokens (whitespace, comments, identifiers,
// keywords, punctuation, operators, plain strings and decimal integers)
// inline, producing exactly the state acorn's own methods would produce:
// this.type is the real TokenType object, this.context holds the real
// TokContext objects, startLoc/endLoc are fresh Position objects, etc.
//
// Anything else (escapes, non-ASCII, templates, regexps, numbers other than
// plain decimal integers, HTML comments, errors) is delegated to the original
// method, called exactly as acorn calls it. The fast path is only used for a
// parser whose tokenizer methods (every method whose behaviour is reproduced
// inline here) are acorn's originals and whose token types' context-update
// hooks are untouched; a plugin that overrides any of them (acorn-jsx
// overrides readToken and updateContext) gets acorn's original nextToken.

import { Parser, tokTypes as tt, tokContexts as tc, keywordTypes, Position } from "./vendor/acorn.mjs";

const pp = Parser.prototype;
const origNextToken = pp.nextToken;

// Methods whose bodies are reproduced inline by the fast path. (Methods the
// fast path *calls* — readRegexp, readString, readWord, ... for the cases it
// does not handle — are called through `this`, just like acorn does.)
const INLINED = [
  "curContext",
  "skipSpace",
  "skipBlockComment",
  "skipLineComment",
  "curPosition",
  "finishToken",
  "updateContext",
  "braceIsBlock",
  "inGeneratorContext",
  "readToken",
  "fullCharCodeAtPos",
  "fullCharCodeAt",
  "readWord",
  "readWord1",
  "getTokenFromCode",
  "readToken_dot",
  "readToken_slash",
  "readToken_mult_modulo_exp",
  "readToken_pipe_amp",
  "readToken_caret",
  "readToken_plus_min",
  "readToken_lt_gt",
  "readToken_eq_excl",
  "readToken_question",
  "finishOp",
  "readNumber",
  "readInt",
  "readString",
];
const ORIG = INLINED.map((name) => pp[name]);
for (let i = 0; i < ORIG.length; i++) if (typeof ORIG[i] !== "function") throw new Error("fasttok: missing " + INLINED[i]);

// token types and their context-update hooks as acorn defined them
const TT_LIST = Object.keys(tt).map((k) => tt[k]);
const TT_UC = TT_LIST.map((t) => t.updateContext);
const TT_BEFORE = TT_LIST.map((t) => t.beforeExpr);
const TT_KEYWORD = TT_LIST.map((t) => t.keyword);

// keyword lookup for ecmaVersion >= 6: the regexp acorn builds for it is
// cached (wordsRegexp), so it can be recognised by identity
const KW6_WORDS =
  "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this const class extends export import super".split(
    " ",
  );
const KW6_TYPES = KW6_WORDS.map((w) => keywordTypes[w]);
let KW6_RE = null;
{
  const probe = new Parser({ ecmaVersion: "latest" }, "");
  KW6_RE = probe.keywords;
  if (!(KW6_RE instanceof RegExp) || KW6_RE.source !== "^(?:" + KW6_WORDS.join("|") + ")$") throw new Error("fasttok: keyword regexp");
}
// (length, first char, second char) is unique for every keyword
const KW_SHAPE = new Int8Array(9 * 26 * 128).fill(-1);
function shapeIndex(n, c0, c1) {
  return ((n - 2) * 26 + (c0 - 97)) * 128 + c1;
}
for (let i = 0; i < KW6_WORDS.length; i++) {
  const w = KW6_WORDS[i];
  const idx = shapeIndex(w.length, w.charCodeAt(0), w.charCodeAt(1));
  if (KW_SHAPE[idx] >= 0) throw new Error("fasttok: keyword shape collision");
  KW_SHAPE[idx] = i;
}

const ID_START = new Uint8Array(128);
const ID_CHAR = new Uint8Array(128);
for (let c = 0; c < 128; c++) {
  const s = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95;
  ID_START[c] = s ? 1 : 0;
  ID_CHAR[c] = s || (c >= 48 && c <= 57) ? 1 : 0;
}

// operator strings without slicing the input
const OP1 = new Array(128).fill(undefined);
for (const c of "=!~+-*/%<>&|^?.") OP1[c.charCodeAt(0)] = c;
const OP2 = new Map();
for (const op of ["==", "!=", "+=", "-=", "*=", "/=", "%=", "<=", ">=", "&=", "|=", "^=", "&&", "||", "??", "++", "--", "<<", ">>", "**", "?."])
  OP2.set((op.charCodeAt(0) << 8) | op.charCodeAt(1), op);

const nonASCIIwhitespace = /[  -   　﻿]/;

const FT = Symbol("fastAcornTokenizer");

function canFast(p) {
  const o = p.options;
  if (o === null || typeof o !== "object" || !(o.ecmaVersion >= 13)) return false;
  if (typeof p.input !== "string" || !Array.isArray(p.context)) return false;
  for (let i = 0; i < INLINED.length; i++) if (p[INLINED[i]] !== ORIG[i]) return false;
  for (let i = 0; i < TT_LIST.length; i++) {
    const t = TT_LIST[i];
    if (t.updateContext !== TT_UC[i] || t.beforeExpr !== TT_BEFORE[i] || t.keyword !== TT_KEYWORD[i]) return false;
  }
  for (let i = 0; i < KW6_WORDS.length; i++) if (keywordTypes[KW6_WORDS[i]] !== KW6_TYPES[i]) return false;
  return true;
}

pp.nextToken = function nextToken() {
  let f = this[FT];
  if (f === undefined) f = this[FT] = canFast(this);
  if (f === true) return fastNextToken(this);
  return origNextToken.call(this);
};

function isNL(c) {
  return c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
}

// lineBreak.test(input.slice(from, to))
function hasLineBreak(input, from, to) {
  for (let i = from; i < to; i++) {
    const c = input.charCodeAt(i);
    if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

// acorn's skipSpace (+ skipBlockComment / skipLineComment when there is no
// onComment callback; with one, the original comment methods are called)
function skipSpace(p, input, len, locations, onComment) {
  let pos = p.pos;
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
        if (locations) {
          ++p.curLine;
          p.lineStart = pos;
        }
        break;
      case 47: {
        const n = input.charCodeAt(pos + 1);
        if (n === 42) {
          if (onComment) {
            p.pos = pos;
            p.skipBlockComment();
            pos = p.pos;
            break;
          }
          const end = input.indexOf("*/", pos + 2);
          if (end === -1) {
            // unterminated: acorn raises
            p.pos = pos;
            p.skipBlockComment();
            pos = p.pos;
            break;
          }
          const start = pos;
          pos = end + 2;
          if (locations) {
            // nextLineBreak(input, pos, this.pos) loop
            for (let i = start; i < pos; i++) {
              const c = input.charCodeAt(i);
              if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) {
                if (c === 13 && i < pos - 1 && input.charCodeAt(i + 1) === 10) i++;
                ++p.curLine;
                p.lineStart = i + 1;
              }
            }
          }
          break;
        }
        if (n === 47) {
          if (onComment) {
            p.pos = pos;
            p.skipLineComment(2);
            pos = p.pos;
            break;
          }
          pos += 2;
          while (pos < len) {
            const c = input.charCodeAt(pos);
            if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) break;
            ++pos;
          }
          break;
        }
        break loop;
      }
      default:
        if ((ch > 8 && ch < 14) || (ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch)))) ++pos;
        else break loop;
    }
  }
  p.pos = pos;
}

function inGeneratorContext(ctx) {
  for (let i = ctx.length - 1; i >= 1; i--) {
    const c = ctx[i];
    if (c.token === "function") return c.generator;
  }
  return false;
}

function braceIsBlock(p, ctx, prevType) {
  const parent = ctx[ctx.length - 1];
  if (parent === tc.f_expr || parent === tc.f_stat) return true;
  if (prevType === tt.colon && (parent === tc.b_stat || parent === tc.b_expr)) return !parent.isExpr;
  if (prevType === tt._return || (prevType === tt.name && p.exprAllowed)) return hasLineBreak(p.input, p.lastTokEnd, p.start);
  if (prevType === tt._else || prevType === tt.semi || prevType === tt.eof || prevType === tt.parenR || prevType === tt.arrow) return true;
  if (prevType === tt.braceL) return parent === tc.b_stat;
  if (prevType === tt._var || prevType === tt._const || prevType === tt.name) return false;
  return !p.exprAllowed;
}

// finishToken(type, val) + updateContext(prevType), specialised per kind of
// token type (their context hooks are acorn's own: checked in canFast)

// types without an updateContext hook that are not keywords
function finishPlain(p, type, val, end) {
  p.pos = end;
  p.end = end;
  if (p.options.locations) p.endLoc = new Position(p.curLine, end - p.lineStart);
  p.type = type;
  p.value = val;
  p.exprAllowed = type.beforeExpr;
}

function finishName(p, val, end) {
  p.pos = end;
  p.end = end;
  if (p.options.locations) p.endLoc = new Position(p.curLine, end - p.lineStart);
  const prevType = p.type;
  p.type = tt.name;
  p.value = val;
  let allowed = false;
  if (prevType !== tt.dot) {
    if ((val === "of" && !p.exprAllowed) || (val === "yield" && inGeneratorContext(p.context))) allowed = true;
  }
  p.exprAllowed = allowed;
}

function finishKeyword(p, type, val, end) {
  p.pos = end;
  p.end = end;
  if (p.options.locations) p.endLoc = new Position(p.curLine, end - p.lineStart);
  const prevType = p.type;
  p.type = type;
  p.value = val;
  if (prevType === tt.dot) {
    p.exprAllowed = false;
    return;
  }
  if (type === tt._function || type === tt._class) {
    const ctx = p.context;
    if (
      prevType.beforeExpr &&
      prevType !== tt._else &&
      !(prevType === tt.semi && ctx[ctx.length - 1] !== tc.p_stat) &&
      !(prevType === tt._return && hasLineBreak(p.input, p.lastTokEnd, p.start)) &&
      !((prevType === tt.colon || prevType === tt.braceL) && ctx[ctx.length - 1] === tc.b_stat)
    )
      ctx.push(tc.f_expr);
    else ctx.push(tc.f_stat);
    p.exprAllowed = false;
    return;
  }
  p.exprAllowed = type.beforeExpr;
}

// parenR / braceR
function finishClose(p, type, end) {
  p.pos = end;
  p.end = end;
  if (p.options.locations) p.endLoc = new Position(p.curLine, end - p.lineStart);
  p.type = type;
  p.value = undefined;
  const ctx = p.context;
  if (ctx.length === 1) {
    p.exprAllowed = true;
    return;
  }
  let out = ctx.pop();
  if (out === tc.b_stat && ctx[ctx.length - 1].token === "function") out = ctx.pop();
  p.exprAllowed = !out.isExpr;
}

function finishParenL(p, end) {
  p.pos = end;
  p.end = end;
  if (p.options.locations) p.endLoc = new Position(p.curLine, end - p.lineStart);
  const prevType = p.type;
  p.type = tt.parenL;
  p.value = undefined;
  p.context.push(prevType === tt._if || prevType === tt._for || prevType === tt._with || prevType === tt._while ? tc.p_stat : tc.p_expr);
  p.exprAllowed = true;
}

function finishBraceL(p, end) {
  p.pos = end;
  p.end = end;
  if (p.options.locations) p.endLoc = new Position(p.curLine, end - p.lineStart);
  const prevType = p.type;
  p.type = tt.braceL;
  p.value = undefined;
  const ctx = p.context;
  ctx.push(braceIsBlock(p, ctx, prevType) ? tc.b_stat : tc.b_expr);
  p.exprAllowed = true;
}

function finishColon(p, end) {
  p.pos = end;
  p.end = end;
  if (p.options.locations) p.endLoc = new Position(p.curLine, end - p.lineStart);
  p.type = tt.colon;
  p.value = undefined;
  const ctx = p.context;
  if (ctx[ctx.length - 1].token === "function") ctx.pop();
  p.exprAllowed = true;
}

function finishBackQuote(p, end) {
  p.pos = end;
  p.end = end;
  if (p.options.locations) p.endLoc = new Position(p.curLine, end - p.lineStart);
  p.type = tt.backQuote;
  p.value = undefined;
  const ctx = p.context;
  if (ctx[ctx.length - 1] === tc.q_tmpl) ctx.pop();
  else ctx.push(tc.q_tmpl);
  p.exprAllowed = false;
}

function finishStar(p, val, end) {
  p.pos = end;
  p.end = end;
  if (p.options.locations) p.endLoc = new Position(p.curLine, end - p.lineStart);
  const prevType = p.type;
  p.type = tt.star;
  p.value = val;
  if (prevType === tt._function) {
    const ctx = p.context;
    const index = ctx.length - 1;
    if (ctx[index] === tc.f_expr) ctx[index] = tc.f_expr_gen;
    else ctx[index] = tc.f_gen;
  }
  p.exprAllowed = true;
}

// incDec: exprAllowed is left unchanged
function finishIncDec(p, val, end) {
  p.pos = end;
  p.end = end;
  if (p.options.locations) p.endLoc = new Position(p.curLine, end - p.lineStart);
  p.type = tt.incDec;
  p.value = val;
}

// operator value strings without slicing the input
function opStr(input, pos, size) {
  let str;
  if (size === 1) str = OP1[input.charCodeAt(pos)];
  else if (size === 2) str = OP2.get((input.charCodeAt(pos) << 8) | input.charCodeAt(pos + 1));
  if (str === undefined) str = input.slice(pos, pos + size);
  return str;
}

// finishOp for operator types without a context hook
function finishOp(p, type, pos, size) {
  return finishPlain(p, type, opStr(p.input, pos, size), pos + size);
}

function fastNextToken(p) {
  const ctx = p.context;
  const cur = ctx[ctx.length - 1];
  // (an empty context stack makes acorn throw a TypeError: let it)
  if (cur === undefined) return origNextToken.call(p);
  const input = p.input, len = input.length;
  const o = p.options;
  const locations = o.locations;
  if (!cur.preserveSpace) {
    const c = input.charCodeAt(p.pos);
    // most tokens follow a single space or nothing
    if (c === 32) {
      const c2 = input.charCodeAt(++p.pos);
      if (c2 <= 32 || c2 === 47 || c2 >= 128) skipSpace(p, input, len, locations, o.onComment);
    } else if (c <= 32 || c === 47 || c >= 128) skipSpace(p, input, len, locations, o.onComment);
  }
  const pos = p.pos;
  p.start = pos;
  if (locations) p.startLoc = new Position(p.curLine, pos - p.lineStart);
  if (pos >= len) return finishPlain(p, tt.eof, undefined, pos);
  if (cur.override) return cur.override(p);
  const code = input.charCodeAt(pos);
  if (code >= 128) return p.readToken(p.fullCharCodeAtPos());
  if (ID_START[code] === 1) {
    // readWord (ASCII identifiers; anything else takes acorn's readWord)
    let q = pos + 1, c = 0;
    while (q < len && (c = input.charCodeAt(q)) < 128 && ID_CHAR[c] === 1) q++;
    if (q < len && (c >= 128 || c === 92)) return p.readWord();
    p.containsEsc = false;
    const n = q - pos;
    if (n >= 2 && n <= 10 && code >= 97 && code <= 122) {
      const c1 = input.charCodeAt(pos + 1);
      if (c1 < 128) {
        const k = KW_SHAPE[shapeIndex(n, code, c1)];
        if (k >= 0) {
          const kw = KW6_WORDS[k];
          let i = 2;
          while (i < n && input.charCodeAt(pos + i) === kw.charCodeAt(i)) i++;
          if (i === n) {
            if (p.keywords === KW6_RE) return finishKeyword(p, KW6_TYPES[k], kw, q);
            return p.readWord();
          }
        }
      }
    }
    if (p.keywords !== KW6_RE) return p.readWord();
    return finishName(p, input.slice(pos, q), q);
  }
  switch (code) {
    case 40:
      return finishParenL(p, pos + 1);
    case 41:
      return finishClose(p, tt.parenR, pos + 1);
    case 59:
      return finishPlain(p, tt.semi, undefined, pos + 1);
    case 44:
      return finishPlain(p, tt.comma, undefined, pos + 1);
    case 91:
      return finishPlain(p, tt.bracketL, undefined, pos + 1);
    case 93:
      return finishPlain(p, tt.bracketR, undefined, pos + 1);
    case 123:
      return finishBraceL(p, pos + 1);
    case 125:
      return finishClose(p, tt.braceR, pos + 1);
    case 58:
      return finishColon(p, pos + 1);
    case 96:
      return finishBackQuote(p, pos + 1);
    case 46: {
      const next = input.charCodeAt(pos + 1);
      if (next >= 48 && next <= 57) return p.readNumber(true);
      if (next === 46 && input.charCodeAt(pos + 2) === 46) return finishPlain(p, tt.ellipsis, undefined, pos + 3);
      return finishPlain(p, tt.dot, undefined, pos + 1);
    }
    case 48: {
      const next = input.charCodeAt(pos + 1);
      if (next === 120 || next === 88) return p.readRadixNumber(16);
      if (next === 111 || next === 79) return p.readRadixNumber(8);
      if (next === 98 || next === 66) return p.readRadixNumber(2);
      if (next >= 48 && next <= 57) return p.readNumber(false);
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
    case 57: {
      // plain decimal integer (up to 15 digits: exact, equal to parseFloat)
      let q = pos, v = 0, c;
      while ((c = input.charCodeAt(q)) >= 48 && c <= 57) {
        v = v * 10 + (c - 48);
        q++;
      }
      if (q - pos <= 15 && c !== 46 && c !== 101 && c !== 69 && c !== 95 && c !== 110 && c < 128 && ID_START[c] !== 1 && c !== 92)
        return finishPlain(p, tt.num, v, q);
      return p.readNumber(false);
    }
    case 34:
    case 39: {
      // string without escapes or line breaks
      for (let q = pos + 1; q < len; q++) {
        const ch = input.charCodeAt(q);
        if (ch === code) return finishPlain(p, tt.string, input.slice(pos + 1, q), q + 1);
        if (ch === 92 || ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029) break;
      }
      return p.readString(code);
    }
    case 47: {
      if (p.exprAllowed) {
        p.pos = pos + 1;
        return p.readRegexp();
      }
      if (input.charCodeAt(pos + 1) === 61) return finishOp(p, tt.assign, pos, 2);
      return finishOp(p, tt.slash, pos, 1);
    }
    case 37:
    case 42: {
      let next = input.charCodeAt(pos + 1);
      let size = 1;
      let type = code === 42 ? tt.star : tt.modulo;
      if (code === 42 && next === 42) {
        ++size;
        type = tt.starstar;
        next = input.charCodeAt(pos + 2);
      }
      if (next === 61) return finishOp(p, tt.assign, pos, size + 1);
      if (type === tt.star) return finishStar(p, "*", pos + 1);
      return finishOp(p, type, pos, size);
    }
    case 124:
    case 38: {
      const next = input.charCodeAt(pos + 1);
      if (next === code) {
        if (input.charCodeAt(pos + 2) === 61) return finishOp(p, tt.assign, pos, 3);
        return finishOp(p, code === 124 ? tt.logicalOR : tt.logicalAND, pos, 2);
      }
      if (next === 61) return finishOp(p, tt.assign, pos, 2);
      return finishOp(p, code === 124 ? tt.bitwiseOR : tt.bitwiseAND, pos, 1);
    }
    case 94:
      if (input.charCodeAt(pos + 1) === 61) return finishOp(p, tt.assign, pos, 2);
      return finishOp(p, tt.bitwiseXOR, pos, 1);
    case 43:
    case 45: {
      const next = input.charCodeAt(pos + 1);
      if (next === code) {
        // `-->` may be an HTML comment: acorn's own method decides
        if (next === 45 && input.charCodeAt(pos + 2) === 62) return p.readToken_plus_min(code);
        return finishIncDec(p, code === 43 ? "++" : "--", pos + 2);
      }
      if (next === 61) return finishOp(p, tt.assign, pos, 2);
      return finishOp(p, tt.plusMin, pos, 1);
    }
    case 60:
    case 62: {
      const next = input.charCodeAt(pos + 1);
      let size = 1;
      if (next === code) {
        size = code === 62 && input.charCodeAt(pos + 2) === 62 ? 3 : 2;
        if (input.charCodeAt(pos + size) === 61) return finishOp(p, tt.assign, pos, size + 1);
        return finishOp(p, tt.bitShift, pos, size);
      }
      // `<!--` may be an HTML comment
      if (next === 33 && code === 60) return p.readToken_lt_gt(code);
      if (next === 61) size = 2;
      return finishOp(p, tt.relational, pos, size);
    }
    case 61:
    case 33: {
      const next = input.charCodeAt(pos + 1);
      if (next === 61) return finishOp(p, tt.equality, pos, input.charCodeAt(pos + 2) === 61 ? 3 : 2);
      if (code === 61 && next === 62) return finishPlain(p, tt.arrow, undefined, pos + 2);
      return finishOp(p, code === 61 ? tt.eq : tt.prefix, pos, 1);
    }
    case 63: {
      const next = input.charCodeAt(pos + 1);
      if (next === 46) {
        const next2 = input.charCodeAt(pos + 2);
        if (next2 < 48 || next2 > 57) return finishOp(p, tt.questionDot, pos, 2);
      }
      if (next === 63) {
        if (input.charCodeAt(pos + 2) === 61) return finishOp(p, tt.assign, pos, 3);
        return finishOp(p, tt.coalesce, pos, 2);
      }
      return finishOp(p, tt.question, pos, 1);
    }
    case 126:
      return finishOp(p, tt.prefix, pos, 1);
  }
  // `\` (escaped identifier), `#`, and characters acorn rejects
  return p.readToken(code);
}

export const _fastTokenizerInstalled = true;
