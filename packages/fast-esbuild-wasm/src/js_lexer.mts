// Port of internal/js_lexer (js_lexer.go and tables.go). See CONVENTIONS.md.
//
// The lexer converts a source file to a stream of tokens. Unlike many
// compilers, esbuild does not run the lexer to completion before the parser is
// started. Instead, the lexer is called repeatedly by the parser as the parser
// parses the file. This is because many tokens are context-sensitive and need
// high-level information from the parser. Examples are regular expression
// literals and JSX elements.
//
// JS port notes:
// - The source is a JS string and all offsets (current/start/end, every Loc)
//   are UTF-16 indices. "codePoint" is a full code point (surrogate pairs are
//   decoded) and step() advances by 1 or 2 code units.
// - js_lexer.MaybeSubstring is a plain JS string, []uint16 is a JS string.
// - panic(LexerPanic{}) is "throw LEXER_PANIC".
// - A few loops (whitespace, comments, string bodies, identifiers) scan ahead
//   with charCodeAt and then step() onto the next interesting character. This
//   has exactly the same effect as stepping one code point at a time.
import { LEXER_PANIC } from "./gopanic.mjs";
import {
  Range,
  RANGE_ZERO,
  Span,
  LineColumnTracker,
  Msg,
  MsgData,
  Error as KindError,
  Warning as KindWarning,
  MsgID_JS_HTMLCommentInJS,
} from "./logger.mjs";
import { TSOptions } from "./config.mjs";
import { parseFloat64 } from "./helpers.mjs";
import { goQuote } from "./gostd.mjs";
import { isIdentifier, isIdentifierStart, isIdentifierContinue, isWhitespace } from "./js_ident.mjs";

export { LexerPanic, LEXER_PANIC } from "./gopanic.mjs";

const ASCII_STRING_DQ = /[^\x20-\x7e]|["\\$]/g;
const ASCII_STRING_SQ = /[^\x20-\x7e]|['\\$]/g;
const ASCII_STRING_BT = /[^\x20-\x7e]|[`\\$]/g;

// ---------------------------------------------------------------------------
// T (token kinds). If you add a new token, remember to add it to
// "tokenToString" too.

export const TEndOfFile = 0;
export const TSyntaxError = 1;

// "#!/usr/bin/env node"
export const THashbang = 2;

// Literals
export const TNoSubstitutionTemplateLiteral = 3; // Contents are in lexer.stringLiteral() (string)
export const TNumericLiteral = 4; // Contents are in lexer.number (float64)
export const TStringLiteral = 5; // Contents are in lexer.stringLiteral() (string)
export const TBigIntegerLiteral = 6; // Contents are in lexer.identifier (string)

// Pseudo-literals
export const TTemplateHead = 7; // Contents are in lexer.stringLiteral() (string)
export const TTemplateMiddle = 8; // Contents are in lexer.stringLiteral() (string)
export const TTemplateTail = 9; // Contents are in lexer.stringLiteral() (string)

// Punctuation
export const TAmpersand = 10;
export const TAmpersandAmpersand = 11;
export const TAsterisk = 12;
export const TAsteriskAsterisk = 13;
export const TAt = 14;
export const TBar = 15;
export const TBarBar = 16;
export const TCaret = 17;
export const TCloseBrace = 18;
export const TCloseBracket = 19;
export const TCloseParen = 20;
export const TColon = 21;
export const TComma = 22;
export const TDot = 23;
export const TDotDotDot = 24;
export const TEqualsEquals = 25;
export const TEqualsEqualsEquals = 26;
export const TEqualsGreaterThan = 27;
export const TExclamation = 28;
export const TExclamationEquals = 29;
export const TExclamationEqualsEquals = 30;
export const TGreaterThan = 31;
export const TGreaterThanEquals = 32;
export const TGreaterThanGreaterThan = 33;
export const TGreaterThanGreaterThanGreaterThan = 34;
export const TLessThan = 35;
export const TLessThanEquals = 36;
export const TLessThanLessThan = 37;
export const TMinus = 38;
export const TMinusMinus = 39;
export const TOpenBrace = 40;
export const TOpenBracket = 41;
export const TOpenParen = 42;
export const TPercent = 43;
export const TPlus = 44;
export const TPlusPlus = 45;
export const TQuestion = 46;
export const TQuestionDot = 47;
export const TQuestionQuestion = 48;
export const TSemicolon = 49;
export const TSlash = 50;
export const TTilde = 51;

// Assignments (keep in sync with tIsAssign() below)
export const TAmpersandAmpersandEquals = 52;
export const TAmpersandEquals = 53;
export const TAsteriskAsteriskEquals = 54;
export const TAsteriskEquals = 55;
export const TBarBarEquals = 56;
export const TBarEquals = 57;
export const TCaretEquals = 58;
export const TEquals = 59;
export const TGreaterThanGreaterThanEquals = 60;
export const TGreaterThanGreaterThanGreaterThanEquals = 61;
export const TLessThanLessThanEquals = 62;
export const TMinusEquals = 63;
export const TPercentEquals = 64;
export const TPlusEquals = 65;
export const TQuestionQuestionEquals = 66;
export const TSlashEquals = 67;

// Class-private fields and methods
export const TPrivateIdentifier = 68;

// Identifiers
export const TIdentifier = 69; // Contents are in lexer.identifier (string)
export const TEscapedKeyword = 70; // A keyword that has been escaped as an identifier

// Reserved words
export const TBreak = 71;
export const TCase = 72;
export const TCatch = 73;
export const TClass = 74;
export const TConst = 75;
export const TContinue = 76;
export const TDebugger = 77;
export const TDefault = 78;
export const TDelete = 79;
export const TDo = 80;
export const TElse = 81;
export const TEnum = 82;
export const TExport = 83;
export const TExtends = 84;
export const TFalse = 85;
export const TFinally = 86;
export const TFor = 87;
export const TFunction = 88;
export const TIf = 89;
export const TImport = 90;
export const TIn = 91;
export const TInstanceof = 92;
export const TNew = 93;
export const TNull = 94;
export const TReturn = 95;
export const TSuper = 96;
export const TSwitch = 97;
export const TThis = 98;
export const TThrow = 99;
export const TTrue = 100;
export const TTry = 101;
export const TTypeof = 102;
export const TVar = 103;
export const TVoid = 104;
export const TWhile = 105;
export const TWith = 106;

// (t T) IsAssign()
export function tIsAssign(t) {
  return t >= TAmpersandAmpersandEquals && t <= TSlashEquals;
}

// map[string]T. Missing keys are the zero value (TEndOfFile).
export const Keywords = new Map([
  // Reserved words
  ["break", TBreak],
  ["case", TCase],
  ["catch", TCatch],
  ["class", TClass],
  ["const", TConst],
  ["continue", TContinue],
  ["debugger", TDebugger],
  ["default", TDefault],
  ["delete", TDelete],
  ["do", TDo],
  ["else", TElse],
  ["enum", TEnum],
  ["export", TExport],
  ["extends", TExtends],
  ["false", TFalse],
  ["finally", TFinally],
  ["for", TFor],
  ["function", TFunction],
  ["if", TIf],
  ["import", TImport],
  ["in", TIn],
  ["instanceof", TInstanceof],
  ["new", TNew],
  ["null", TNull],
  ["return", TReturn],
  ["super", TSuper],
  ["switch", TSwitch],
  ["this", TThis],
  ["throw", TThrow],
  ["true", TTrue],
  ["try", TTry],
  ["typeof", TTypeof],
  ["var", TVar],
  ["void", TVoid],
  ["while", TWhile],
  ["with", TWith],
]);

// map[string]bool (all values are true, so both .has() and .get() work)
export const StrictModeReservedWords = new Map([
  ["implements", true],
  ["interface", true],
  ["let", true],
  ["package", true],
  ["private", true],
  ["protected", true],
  ["public", true],
  ["static", true],
  ["yield", true],
]);

// JS-only: "Keywords" bucketed by length and first letter (all keywords are
// 2-10 lowercase ASCII letters). Each bucket is [text, token, text, token, ...].
const KEYWORD_BUCKETS = new Array(11 * 26);
for (const [text, token] of Keywords) {
  const index = text.length * 26 + (text.charCodeAt(0) - 97);
  if (KEYWORD_BUCKETS[index] === undefined) KEYWORD_BUCKETS[index] = [];
  KEYWORD_BUCKETS[index].push(text, token);
}

// Lower-camel aliases of the two package-level maps above
export const keywords = Keywords;
export const strictModeReservedWords = StrictModeReservedWords;

// CommentBefore
export const PureCommentBefore = 1 << 0;
export const KeyCommentBefore = 1 << 1;
export const NoSideEffectsCommentBefore = 1 << 2;

// JSONFlavor
// Specification: https://json.org/
export const JSON = 0;
// TypeScript's JSON superset is not documented but appears to allow:
// - Comments: https://github.com/microsoft/TypeScript/issues/4987
// - Trailing commas
// - Full JS number syntax
export const TSConfigJSON = 1;
// This is used by the JavaScript lexer
export const NotJSON = 2;

// identifierKind
const normalIdentifier = 0;
const privateIdentifier = 1;

// KeyOrValue
export const KeyRange = 0;
export const ValueRange = 1;
export const KeyAndValueRange = 2;

// pragmaArg
const pragmaNoSpaceFirst = 0;
const pragmaSkipSpaceFirst = 1;

const SPAN_ZERO = new Span();
const TS_OPTIONS_ZERO = new TSOptions();

// ASCII identifier characters: 1 = start (and continue), 2 = continue only
const ASCII_IDENT = new Uint8Array(128);
for (let c = 97; c <= 122; c++) ASCII_IDENT[c] = 1;
for (let c = 65; c <= 90; c++) ASCII_IDENT[c] = 1;
ASCII_IDENT[95] = 1; // '_'
ASCII_IDENT[36] = 1; // '$'
for (let c = 48; c <= 57; c++) ASCII_IDENT[c] = 2;

// Side channel for decodeRune(): the width in UTF-16 code units of the last
// decoded code point (0 at the end of the text, like Go's DecodeRuneInString)
let runeWidth = 0;

// Like utf8.DecodeRuneInString(text[i:]) (returns U+FFFD with width 0 at the end)
function decodeRune(text, i) {
  if (i >= text.length) {
    runeWidth = 0;
    return 0xfffd;
  }
  const c = text.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
    const c2 = text.charCodeAt(i + 1);
    if (c2 >= 0xdc00 && c2 <= 0xdfff) {
      runeWidth = 2;
      return ((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000;
    }
  }
  runeWidth = 1;
  // (a lone surrogate in source text is a raw byte of invalid UTF-8)
  if (c >= 0xd800 && c <= 0xdfff) return 0xfffd;
  return c;
}

// The value of a run of source text: raw bytes of invalid UTF-8 (lone
// surrogates, see helpers.decodeGoString) decode as U+FFFD, like Go's
// utf8.DecodeRuneInString
function sourceRunValue(text: string): string {
  return text.isWellFormed() ? text : text.toWellFormed();
}

// Appending a rune to a []uint16 like the Go code does:
//   if c <= 0xFFFF { append(uint16(c)) } else { c -= 0x10000; append(pair) }
// (c may be negative or above 0x10FFFF after int32 wrap-around.)
function runeToUTF16(c) {
  if (c <= 0xffff) return String.fromCharCode(c & 0xffff);
  c -= 0x10000;
  return String.fromCharCode(0xd800 + ((c >> 10) & 0x3ff), 0xdc00 + (c & 0x3ff));
}


// ---------------------------------------------------------------------------
// Lexer

export class Lexer {
  declare legalCommentsBeforeToken: any[];
  declare commentsBeforeToken: any[];
  declare allComments: any[];
  declare identifier: string;
  declare log: any;
  declare source: any;
  declare jsxFactoryPragmaComment: Span;
  declare jsxFragmentPragmaComment: Span;
  declare jsxRuntimePragmaComment: Span;
  declare jsxImportSourcePragmaComment: Span;
  declare sourceMappingURL: Span;
  declare badArrowInTSXSuggestion: string;
  declare decodedStringLiteralOrNil: any;
  declare encodedStringLiteralText: string;
  declare errorSuffix: string;
  declare tracker: any;
  declare encodedStringLiteralStart: number;
  declare number: number;
  declare current: number;
  declare start: number;
  declare end: number;
  declare approximateNewlineCount: number;
  declare couldBeBadArrowInTSX: number;
  declare badArrowInTSXRange: Range;
  declare legacyOctalLoc: number;
  declare awaitKeywordLoc: number;
  declare fnOrArrowStartLoc: number;
  declare previousBackslashQuoteInJSX: Range;
  declare legacyHTMLCommentRange: Range;
  declare codePoint: any; // (not number: step() changes it behind TypeScript's narrowing)
  declare prevErrorLoc: number;
  declare json: number;
  declare token: number;
  declare ts: TSOptions;
  declare hasNewlineBefore: boolean;
  declare hasCommentBefore: number;
  declare isLegacyOctalLiteral: boolean;
  declare prevTokenWasAwaitKeyword: boolean;
  declare rescanCloseBraceAsTemplateTokenFlag: boolean;
  declare forGlobalName: boolean;
  declare isLogDisabled: boolean;
  declare contents: string;
  declare commentHashFrom: number;
  declare commentHashPos: number;
  declare commentAtFrom: number;
  declare commentAtPos: number;
  // Creates the zero value (js_lexer.Lexer{}). Use newLexer() & co. to lex.
  constructor() {
    this.legalCommentsBeforeToken = []; // []logger.Range
    this.commentsBeforeToken = []; // []logger.Range
    this.allComments = []; // []logger.Range
    this.identifier = ""; // MaybeSubstring
    this.log = null;
    this.source = null;
    this.jsxFactoryPragmaComment = SPAN_ZERO;
    this.jsxFragmentPragmaComment = SPAN_ZERO;
    this.jsxRuntimePragmaComment = SPAN_ZERO;
    this.jsxImportSourcePragmaComment = SPAN_ZERO;
    this.sourceMappingURL = SPAN_ZERO;
    this.badArrowInTSXSuggestion = "";

    // Escape sequences in string literals are decoded lazily because they are
    // not interpreted inside tagged templates, and tagged templates can contain
    // invalid escape sequences. If the decoded string is null, the encoded value
    // should be passed to "tryToDecodeEscapeSequences" first.
    this.decodedStringLiteralOrNil = null;
    this.encodedStringLiteralText = "";

    this.errorSuffix = "";
    this.tracker = null;

    this.encodedStringLiteralStart = 0;

    this.number = 0;
    this.current = 0;
    this.start = 0;
    this.end = 0;
    this.approximateNewlineCount = 0;
    this.couldBeBadArrowInTSX = 0;
    this.badArrowInTSXRange = RANGE_ZERO;
    this.legacyOctalLoc = 0;
    this.awaitKeywordLoc = 0;
    this.fnOrArrowStartLoc = 0;
    this.previousBackslashQuoteInJSX = RANGE_ZERO;
    this.legacyHTMLCommentRange = RANGE_ZERO;
    this.codePoint = 0;
    this.prevErrorLoc = 0;
    this.json = JSON; // the Go zero value of JSONFlavor
    this.token = TEndOfFile;
    this.ts = TS_OPTIONS_ZERO;
    this.hasNewlineBefore = false;
    this.hasCommentBefore = 0; // CommentBefore flags
    this.isLegacyOctalLiteral = false;
    this.prevTokenWasAwaitKeyword = false;
    // Go's field "rescanCloseBraceAsTemplateToken" (renamed because the
    // RescanCloseBraceAsTemplateToken() method has the same JS name)
    this.rescanCloseBraceAsTemplateTokenFlag = false;
    this.forGlobalName = false;

    // The log is disabled during speculative scans that may backtrack
    this.isLogDisabled = false;

    // JS-only: cached "source.contents"
    this.contents = "";

    // JS-only: caches for nextCommentSpecial() (pure functions of "contents")
    this.commentHashFrom = 0;
    this.commentHashPos = -1;
    this.commentAtFrom = 0;
    this.commentAtPos = -1;
  }

  // Go copies the lexer struct for backtracking ("oldLexer := p.lexer").
  // Arrays are shared by reference, except that an empty comment array is
  // replaced by a fresh one so that comments appended by one copy are never
  // visible in the other (next() only ever appends to an array that it has
  // just emptied, and it replaces non-empty arrays instead of truncating them).
  clone() {
    const c = new Lexer();
    c.legalCommentsBeforeToken = this.legalCommentsBeforeToken.length === 0 ? [] : this.legalCommentsBeforeToken;
    c.commentsBeforeToken = this.commentsBeforeToken.length === 0 ? [] : this.commentsBeforeToken;
    c.allComments = this.allComments;
    c.identifier = this.identifier;
    c.log = this.log;
    c.source = this.source;
    c.jsxFactoryPragmaComment = this.jsxFactoryPragmaComment;
    c.jsxFragmentPragmaComment = this.jsxFragmentPragmaComment;
    c.jsxRuntimePragmaComment = this.jsxRuntimePragmaComment;
    c.jsxImportSourcePragmaComment = this.jsxImportSourcePragmaComment;
    c.sourceMappingURL = this.sourceMappingURL;
    c.badArrowInTSXSuggestion = this.badArrowInTSXSuggestion;
    c.decodedStringLiteralOrNil = this.decodedStringLiteralOrNil;
    c.encodedStringLiteralText = this.encodedStringLiteralText;
    c.errorSuffix = this.errorSuffix;
    c.tracker = this.tracker;
    c.encodedStringLiteralStart = this.encodedStringLiteralStart;
    c.number = this.number;
    c.current = this.current;
    c.start = this.start;
    c.end = this.end;
    c.approximateNewlineCount = this.approximateNewlineCount;
    c.couldBeBadArrowInTSX = this.couldBeBadArrowInTSX;
    c.badArrowInTSXRange = this.badArrowInTSXRange;
    c.legacyOctalLoc = this.legacyOctalLoc;
    c.awaitKeywordLoc = this.awaitKeywordLoc;
    c.fnOrArrowStartLoc = this.fnOrArrowStartLoc;
    c.previousBackslashQuoteInJSX = this.previousBackslashQuoteInJSX;
    c.legacyHTMLCommentRange = this.legacyHTMLCommentRange;
    c.codePoint = this.codePoint;
    c.prevErrorLoc = this.prevErrorLoc;
    c.json = this.json;
    c.token = this.token;
    c.ts = this.ts;
    c.hasNewlineBefore = this.hasNewlineBefore;
    c.hasCommentBefore = this.hasCommentBefore;
    c.isLegacyOctalLiteral = this.isLegacyOctalLiteral;
    c.prevTokenWasAwaitKeyword = this.prevTokenWasAwaitKeyword;
    c.rescanCloseBraceAsTemplateTokenFlag = this.rescanCloseBraceAsTemplateTokenFlag;
    c.forGlobalName = this.forGlobalName;
    c.isLogDisabled = this.isLogDisabled;
    c.contents = this.contents;
    c.commentHashFrom = this.commentHashFrom;
    c.commentHashPos = this.commentHashPos;
    c.commentAtFrom = this.commentAtFrom;
    c.commentAtPos = this.commentAtPos;
    return c;
  }

  loc() {
    return this.start;
  }

  range() {
    return new Range(this.start, this.end - this.start);
  }

  raw() {
    return this.contents.slice(this.start, this.end);
  }

  rawIdentifier() {
    return this.contents.slice(this.start, this.end);
  }

  stringLiteral() {
    if (this.decodedStringLiteralOrNil === null) {
      // Lazily decode escape sequences if needed
      const result = this.tryToDecodeEscapeSequences(this.encodedStringLiteralStart, this.encodedStringLiteralText, true /* reportErrors */);
      if (!result[1]) {
        this.end = result[2];
        this.syntaxError();
      } else {
        this.decodedStringLiteralOrNil = result[0];
      }
    }
    return this.decodedStringLiteralOrNil;
  }

  // Returns [cooked (string or null), raw (string)]
  cookedAndRawTemplateContents() {
    let raw = "";

    switch (this.token) {
      case TNoSubstitutionTemplateLiteral:
      case TTemplateTail:
        // "`x`" or "}x`"
        raw = this.contents.slice(this.start + 1, this.end - 1);
        break;

      case TTemplateHead:
      case TTemplateMiddle:
        // "`x${" or "}x${"
        raw = this.contents.slice(this.start + 1, this.end - 2);
        break;
    }

    if (raw.indexOf("\r") !== -1) {
      // From the specification:
      //
      // 11.8.6.1 Static Semantics: TV and TRV
      //
      // TV excludes the code units of LineContinuation while TRV includes
      // them. <CR><LF> and <CR> LineTerminatorSequences are normalized to
      // <LF> for both TV and TRV. An explicit EscapeSequence is needed to
      // include a <CR> or <CR><LF> sequence.
      let out = "";
      let runStart = 0;
      const n = raw.length;
      let i = 0;
      while (i < n) {
        const c = raw.charCodeAt(i);
        i++;
        if (c === 13) {
          out += raw.slice(runStart, i - 1) + "\n";

          // Convert '\r\n' into '\n'
          if (i < n && raw.charCodeAt(i) === 10) i++;
          runStart = i;
        }
      }
      raw = out + raw.slice(runStart);
    }

    // This will return null on failure, which will become "undefined" for the tag
    const cooked = this.tryToDecodeEscapeSequences(this.start + 1, raw, false /* reportErrors */)[0];
    return [cooked, raw];
  }

  isIdentifierOrKeyword() {
    return this.token >= TIdentifier;
  }

  // Same as "token === TIdentifier && raw() === text" without allocating
  isContextualKeyword(text) {
    return this.token === TIdentifier && this.end - this.start === text.length && this.contents.startsWith(text, this.start);
  }

  expectContextualKeyword(text) {
    if (!this.isContextualKeyword(text)) {
      this.expectedString('"' + text + '"');
    }
    this.next();
  }

  syntaxError() {
    const loc = this.end;
    let message = "Unexpected end of file";
    const contents = this.source.contents;
    if (this.end < contents.length) {
      const c = decodeRune(contents, this.end);
      if (c < 0x20) {
        message = 'Syntax error "\\x' + c.toString(16).toUpperCase().padStart(2, "0") + '"';
      } else if (c >= 0x80) {
        message = 'Syntax error "\\u{' + c.toString(16) + '}"';
      } else if (c !== 34) {
        message = 'Syntax error "' + String.fromCharCode(c) + '"';
      } else {
        message = "Syntax error '\"'";
      }
    }
    this.addRangeError(new Range(loc, 0), message);
    throw LEXER_PANIC;
  }

  expectedString(text) {
    // Provide a friendly error message about "await" without "async"
    if (this.prevTokenWasAwaitKeyword) {
      let notes = null;
      if (this.fnOrArrowStartLoc !== -1) {
        const note = this.tracker.msgData(new Range(this.fnOrArrowStartLoc, 0), 'Consider adding the "async" keyword here:');
        note.location.suggestion = "async";
        notes = [note];
      }
      this.addRangeErrorWithNotes(rangeOfIdentifier(this.source, this.awaitKeywordLoc), '"await" can only be used inside an "async" function', notes);
      throw LEXER_PANIC;
    }

    let found = goQuote(this.raw());
    if (this.start === this.source.contents.length) {
      found = "end of file";
    }

    let suggestion = "";
    if (text.length >= 2 && text.charCodeAt(0) === 34 && text.charCodeAt(text.length - 1) === 34) {
      suggestion = text.slice(1, text.length - 1);
    }

    this.addRangeErrorWithSuggestion(this.range(), "Expected " + text + this.errorSuffix + " but found " + found, suggestion);
    throw LEXER_PANIC;
  }

  expected(token) {
    const text = tokenToString.get(token);
    if (text !== undefined) {
      this.expectedString(text);
    } else {
      this.unexpected();
    }
  }

  unexpected() {
    let found = goQuote(this.raw());
    if (this.start === this.source.contents.length) {
      found = "end of file";
    }
    this.addRangeError(this.range(), "Unexpected " + found + this.errorSuffix);
    throw LEXER_PANIC;
  }

  expect(token) {
    if (this.token !== token) {
      this.expected(token);
    }
    this.next();
  }

  expectOrInsertSemicolon() {
    if (this.token === TSemicolon || (!this.hasNewlineBefore && this.token !== TCloseBrace && this.token !== TEndOfFile)) {
      this.expect(TSemicolon);
    }
  }

  // This parses a single "<" token. If that is the first part of a longer token,
  // this function splits off the first "<" and leaves the remainder of the
  // current token as another, smaller token. For example, "<<=" becomes "<=".
  expectLessThan(isInsideJSXElement) {
    switch (this.token) {
      case TLessThan:
        if (isInsideJSXElement) {
          this.nextInsideJSXElement();
        } else {
          this.next();
        }
        break;

      case TLessThanEquals:
        this.token = TEquals;
        this.start++;
        this.maybeExpandEquals();
        break;

      case TLessThanLessThan:
        this.token = TLessThan;
        this.start++;
        break;

      case TLessThanLessThanEquals:
        this.token = TLessThanEquals;
        this.start++;
        break;

      default:
        this.expected(TLessThan);
    }
  }

  // This parses a single ">" token. If that is the first part of a longer token,
  // this function splits off the first ">" and leaves the remainder of the
  // current token as another, smaller token. For example, ">>=" becomes ">=".
  expectGreaterThan(isInsideJSXElement) {
    switch (this.token) {
      case TGreaterThan:
        if (isInsideJSXElement) {
          this.nextInsideJSXElement();
        } else {
          this.next();
        }
        break;

      case TGreaterThanEquals:
        this.token = TEquals;
        this.start++;
        this.maybeExpandEquals();
        break;

      case TGreaterThanGreaterThan:
        this.token = TGreaterThan;
        this.start++;
        break;

      case TGreaterThanGreaterThanEquals:
        this.token = TGreaterThanEquals;
        this.start++;
        break;

      case TGreaterThanGreaterThanGreaterThan:
        this.token = TGreaterThanGreaterThan;
        this.start++;
        break;

      case TGreaterThanGreaterThanGreaterThanEquals:
        this.token = TGreaterThanGreaterThanEquals;
        this.start++;
        break;

      default:
        this.expected(TGreaterThan);
    }
  }

  maybeExpandEquals() {
    switch (this.codePoint) {
      case 62: // '>'
        // "=" + ">" = "=>"
        this.token = TEqualsGreaterThan;
        this.step();
        break;

      case 61: // '='
        // "=" + "=" = "=="
        this.token = TEqualsEquals;
        this.step();

        // Note: Go compares the *token* with the rune '=' (61) here, which is
        // never true right after setting it to TEqualsEquals. Kept as-is.
        if (this.token === 61) {
          // "=" + "==" = "==="
          this.token = TEqualsEqualsEquals;
          this.step();
        }
        break;
    }
  }

  expectJSXElementChild(token) {
    if (this.token !== token) {
      this.expected(token);
    }
    this.nextJSXElementChild();
  }

  nextJSXElementChild() {
    this.hasNewlineBefore = false;
    const originalStart = this.end;

    // (Go wraps this in a "for { ... break }" loop that runs exactly once)
    this.start = this.end;
    this.token = 0;

    switch (this.codePoint) {
      case -1: // This indicates the end of the file
        this.token = TEndOfFile;
        break;

      case 123: // '{'
        this.step();
        this.token = TOpenBrace;
        break;

      case 60: // '<'
        this.step();
        this.token = TLessThan;
        break;

      default: {
        let needsFixing = false;

        stringLiteral: for (;;) {
          switch (this.codePoint) {
            case -1:
            case 123: // '{'
            case 60: // '<'
              // Stop when the string ends
              break stringLiteral;

            case 38: // '&'
            case 13: // '\r'
            case 10: // '\n'
            case 0x2028:
            case 0x2029:
              // This needs fixing if it has an entity or if it's a multi-line string
              needsFixing = true;
              this.step();
              break;

            case 125: // '}'
            case 62: {
              // '>'
              // These technically aren't valid JSX: https://facebook.github.io/jsx/
              //
              //   JSXTextCharacter :
              //     * SourceCharacter but not one of {, <, > or }
              //
              let replacement;
              if (this.codePoint === 125) {
                replacement = "{'}'}";
              } else {
                replacement = "{'>'}";
              }
              const msg = new Msg(
                null,
                "",
                this.tracker.msgData(new Range(this.end, 1), 'The character "' + String.fromCharCode(this.codePoint) + '" is not valid inside a JSX element'),
                KindError,
              );

              // Attempt to provide a better error message if this looks like an arrow function
              if (this.couldBeBadArrowInTSX > 0 && this.codePoint === 62 && this.contents.charCodeAt(this.end - 1) === 61) {
                msg.notes = [
                  this.tracker.msgData(
                    this.badArrowInTSXRange,
                    "TypeScript's TSX syntax interprets arrow functions with a single generic type parameter as an opening JSX element. " +
                      "If you want it to be interpreted as an arrow function instead, you need to add a trailing comma after the type parameter to disambiguate:",
                  ),
                ];
                msg.notes[0].location.suggestion = this.badArrowInTSXSuggestion;
              } else {
                msg.notes = [new MsgData(null, null, "Did you mean to escape it as " + goQuote(replacement) + " instead?")];
                msg.data.location.suggestion = replacement;
                if (!this.ts.parse) {
                  // TypeScript treats this as an error but Babel doesn't treat this
                  // as an error yet, so allow this in JS for now.
                  msg.kind = KindWarning;
                }
              }

              this.log.addMsg(msg);
              this.step();
              break;
            }

            default:
              // Non-ASCII strings need the slow path
              if (this.codePoint >= 0x80) {
                needsFixing = true;
              }
              this.step();
          }
        }

        this.token = TStringLiteral;
        const text = this.contents.slice(originalStart, this.end);

        if (needsFixing) {
          // Slow path
          this.decodedStringLiteralOrNil = fixWhitespaceAndDecodeJSXEntities(text);
        } else {
          // Fast path (the text is ASCII, so it is its own UTF-16 decoding)
          this.decodedStringLiteralOrNil = text;
        }
      }
    }
  }

  expectInsideJSXElement(token) {
    if (this.token !== token) {
      this.expected(token);
    }
    this.nextInsideJSXElement();
  }

  nextInsideJSXElement() {
    this.hasNewlineBefore = false;

    for (;;) {
      this.start = this.end;
      this.token = 0;

      const cp = this.codePoint;
      // (0x2028/0x2029 share the '\n' case; other non-ASCII code points go to "default")
      switch (cp < 0x80 ? cp : cp === 0x2028 || cp === 0x2029 ? 10 : 0x80) {
        case -1: // This indicates the end of the file
          this.token = TEndOfFile;
          break;

        case 13: // '\r'
        case 10: // '\n', 'U+2028', 'U+2029'
          this.step();
          this.hasNewlineBefore = true;
          continue;

        case 9: // '\t'
        case 32: // ' '
          this.step();
          continue;

        case 46: // '.'
          this.step();
          this.token = TDot;
          break;

        case 58: // ':'
          this.step();
          this.token = TColon;
          break;

        case 61: // '='
          this.step();
          this.token = TEquals;
          break;

        case 123: // '{'
          this.step();
          this.token = TOpenBrace;
          break;

        case 125: // '}'
          this.step();
          this.token = TCloseBrace;
          break;

        case 60: // '<'
          this.step();
          this.token = TLessThan;
          break;

        case 62: // '>'
          this.step();
          this.token = TGreaterThan;
          break;

        case 47: // '/'
          // '/' or '//' or '/* ... */'
          this.step();
          switch (this.codePoint) {
            case 47: // '/'
              singleLineComment: for (;;) {
                this.step();
                switch (this.codePoint) {
                  case 13:
                  case 10:
                  case 0x2028:
                  case 0x2029:
                    break singleLineComment;

                  case -1: // This indicates the end of the file
                    break singleLineComment;
                }
              }
              continue;

            case 42: {
              // '*'
              this.step();
              const startRange = this.range();
              multiLineComment: for (;;) {
                switch (this.codePoint) {
                  case 42: // '*'
                    this.step();
                    if (this.codePoint === 47) {
                      this.step();
                      break multiLineComment;
                    }
                    break;

                  case 13:
                  case 10:
                  case 0x2028:
                  case 0x2029:
                    this.step();
                    this.hasNewlineBefore = true;
                    break;

                  case -1: // This indicates the end of the file
                    this.start = this.end;
                    this.addRangeErrorWithNotes(new Range(this.start, 0), 'Expected "*/" to terminate multi-line comment', [
                      this.tracker.msgData(startRange, "The multi-line comment starts here:"),
                    ]);
                    throw LEXER_PANIC;

                  default:
                    this.step();
                }
              }
              continue;
            }

            default:
              this.token = TSlash;
          }
          break;

        case 39: // '\''
        case 34: {
          // '"'
          let backslashLoc = 0;
          let backslashLen = 0;
          const quote = this.codePoint;
          let needsDecode = false;
          this.step();

          stringLiteral: for (;;) {
            const c = this.codePoint;
            switch (c) {
              case -1: // This indicates the end of the file
                this.syntaxError();
                break;

              case 38: // '&'
                needsDecode = true;
                this.step();
                break;

              case 92: // '\\'
                backslashLoc = this.end;
                backslashLen = 1;
                this.step();
                continue stringLiteral;

              default:
                if (c === quote) {
                  if (backslashLen > 0) {
                    backslashLen++;
                    this.previousBackslashQuoteInJSX = new Range(backslashLoc, backslashLen);
                  }
                  this.step();
                  break stringLiteral;
                }

                // Non-ASCII strings need the slow path
                if (c >= 0x80) {
                  needsDecode = true;
                }
                this.step();
            }
            backslashLoc = 0;
            backslashLen = 0;
          }

          this.token = TStringLiteral;
          const text = this.contents.slice(this.start + 1, this.end - 1);

          if (needsDecode) {
            // Slow path
            this.decodedStringLiteralOrNil = decodeJSXEntities("", text);
          } else {
            // Fast path (the text is ASCII, so it is its own UTF-16 decoding)
            this.decodedStringLiteralOrNil = text;
          }
          break;
        }

        default:
          // Check for unusual whitespace characters
          if (isWhitespace(this.codePoint)) {
            this.step();
            continue;
          }

          if (isIdentifierStart(this.codePoint)) {
            this.step();
            while (isIdentifierContinue(this.codePoint) || this.codePoint === 45 /* '-' */) {
              this.step();
            }

            this.identifier = this.rawIdentifier();
            this.token = TIdentifier;
            break;
          }

          this.end = this.current;
          this.token = TSyntaxError;
      }

      return;
    }
  }

  next() {
    this.hasNewlineBefore = this.end === 0;
    this.hasCommentBefore = 0;
    this.prevTokenWasAwaitKeyword = false;
    // Go truncates these with "[:0]". Replacing non-empty arrays instead keeps
    // arrays that a clone() may share immutable (see clone()).
    if (this.legalCommentsBeforeToken.length !== 0) this.legalCommentsBeforeToken = [];
    if (this.commentsBeforeToken.length !== 0) this.commentsBeforeToken = [];

    for (;;) {
      this.start = this.end;
      this.token = 0;

      const cp = this.codePoint;
      // (0x2028/0x2029 share the '\n' case; other non-ASCII code points go to "default")
      switch (cp < 0x80 ? cp : cp === 0x2028 || cp === 0x2029 ? 10 : 0x80) {
        case -1: // This indicates the end of the file
          this.token = TEndOfFile;
          break;

        case 35: // '#'
          if (this.start === 0 && this.contents.startsWith("#!")) {
            // "#!/usr/bin/env node"
            this.token = THashbang;
            hashbang: for (;;) {
              this.step();
              switch (this.codePoint) {
                case 13:
                case 10:
                case 0x2028:
                case 0x2029:
                  break hashbang;

                case -1: // This indicates the end of the file
                  break hashbang;
              }
            }
            this.identifier = this.rawIdentifier();
          } else {
            // "#foo"
            this.step();
            if (this.codePoint === 92) {
              this.identifier = this.scanIdentifierWithEscapes(privateIdentifier)[0];
            } else {
              if (!isIdentifierStart(this.codePoint)) {
                this.syntaxError();
              }
              this.step();
              while (isIdentifierContinue(this.codePoint)) {
                this.step();
              }
              if (this.codePoint === 92) {
                this.identifier = this.scanIdentifierWithEscapes(privateIdentifier)[0];
              } else {
                this.identifier = this.rawIdentifier();
              }
            }
            this.token = TPrivateIdentifier;
          }
          break;

        case 13: // '\r'
        case 10: // '\n', 'U+2028', 'U+2029'
          this.step();
          this.hasNewlineBefore = true;
          continue;

        case 9: // '\t'
        case 32: {
          // ' '
          // (JS-only: skip the whole run of spaces and tabs at once)
          const contents = this.contents;
          const n = contents.length;
          let i = this.current;
          while (i < n) {
            const c = contents.charCodeAt(i);
            if (c !== 32 && c !== 9) break;
            i++;
          }
          this.current = i;
          this.step();
          continue;
        }

        case 40: // '('
          this.step();
          this.token = TOpenParen;
          break;

        case 41: // ')'
          this.step();
          this.token = TCloseParen;
          break;

        case 91: // '['
          this.step();
          this.token = TOpenBracket;
          break;

        case 93: // ']'
          this.step();
          this.token = TCloseBracket;
          break;

        case 123: // '{'
          this.step();
          this.token = TOpenBrace;
          break;

        case 125: // '}'
          this.step();
          this.token = TCloseBrace;
          break;

        case 44: // ','
          this.step();
          this.token = TComma;
          break;

        case 58: // ':'
          this.step();
          this.token = TColon;
          break;

        case 59: // ';'
          this.step();
          this.token = TSemicolon;
          break;

        case 64: // '@'
          this.step();
          this.token = TAt;
          break;

        case 126: // '~'
          this.step();
          this.token = TTilde;
          break;

        case 63: // '?'
          // '?' or '?.' or '??' or '??='
          this.step();
          switch (this.codePoint) {
            case 63: // '?'
              this.step();
              switch (this.codePoint) {
                case 61: // '='
                  this.step();
                  this.token = TQuestionQuestionEquals;
                  break;
                default:
                  this.token = TQuestionQuestion;
              }
              break;
            case 46: {
              // '.'
              this.token = TQuestion;
              const current = this.current;
              const contents = this.contents;

              // Lookahead to disambiguate with 'a?.1:b'
              if (current < contents.length) {
                const c = contents.charCodeAt(current);
                if (c < 48 || c > 57) {
                  this.step();
                  this.token = TQuestionDot;
                }
              }
              break;
            }
            default:
              this.token = TQuestion;
          }
          break;

        case 37: // '%'
          // '%' or '%='
          this.step();
          switch (this.codePoint) {
            case 61: // '='
              this.step();
              this.token = TPercentEquals;
              break;
            default:
              this.token = TPercent;
          }
          break;

        case 38: // '&'
          // '&' or '&=' or '&&' or '&&='
          this.step();
          switch (this.codePoint) {
            case 61: // '='
              this.step();
              this.token = TAmpersandEquals;
              break;
            case 38: // '&'
              this.step();
              switch (this.codePoint) {
                case 61: // '='
                  this.step();
                  this.token = TAmpersandAmpersandEquals;
                  break;
                default:
                  this.token = TAmpersandAmpersand;
              }
              break;
            default:
              this.token = TAmpersand;
          }
          break;

        case 124: // '|'
          // '|' or '|=' or '||' or '||='
          this.step();
          switch (this.codePoint) {
            case 61: // '='
              this.step();
              this.token = TBarEquals;
              break;
            case 124: // '|'
              this.step();
              switch (this.codePoint) {
                case 61: // '='
                  this.step();
                  this.token = TBarBarEquals;
                  break;
                default:
                  this.token = TBarBar;
              }
              break;
            default:
              this.token = TBar;
          }
          break;

        case 94: // '^'
          // '^' or '^='
          this.step();
          switch (this.codePoint) {
            case 61: // '='
              this.step();
              this.token = TCaretEquals;
              break;
            default:
              this.token = TCaret;
          }
          break;

        case 43: // '+'
          // '+' or '+=' or '++'
          this.step();
          switch (this.codePoint) {
            case 61: // '='
              this.step();
              this.token = TPlusEquals;
              break;
            case 43: // '+'
              this.step();
              this.token = TPlusPlus;
              break;
            default:
              this.token = TPlus;
          }
          break;

        case 45: // '-'
          // '-' or '-=' or '--' or '-->'
          this.step();
          switch (this.codePoint) {
            case 61: // '='
              this.step();
              this.token = TMinusEquals;
              break;
            case 45: // '-'
              this.step();

              // Handle legacy HTML-style comments
              if (this.codePoint === 62 && this.hasNewlineBefore) {
                this.step();
                this.legacyHTMLCommentRange = this.range();
                this.log.addID(
                  MsgID_JS_HTMLCommentInJS,
                  KindWarning,
                  this.tracker,
                  this.range(),
                  'Treating "-->" as the start of a legacy HTML single-line comment',
                );
                singleLineHTMLCloseComment: for (;;) {
                  switch (this.codePoint) {
                    case 13:
                    case 10:
                    case 0x2028:
                    case 0x2029:
                      break singleLineHTMLCloseComment;

                    case -1: // This indicates the end of the file
                      break singleLineHTMLCloseComment;
                  }
                  this.step();
                }
                continue;
              }

              this.token = TMinusMinus;
              break;
            default:
              this.token = TMinus;
              if (this.json === JSON && this.codePoint !== 46 && (this.codePoint < 48 || this.codePoint > 57)) {
                this.unexpected();
              }
          }
          break;

        case 42: // '*'
          // '*' or '*=' or '**' or '**='
          this.step();
          switch (this.codePoint) {
            case 61: // '='
              this.step();
              this.token = TAsteriskEquals;
              break;

            case 42: // '*'
              this.step();
              switch (this.codePoint) {
                case 61: // '='
                  this.step();
                  this.token = TAsteriskAsteriskEquals;
                  break;

                default:
                  this.token = TAsteriskAsterisk;
              }
              break;

            default:
              this.token = TAsterisk;
          }
          break;

        case 47: // '/'
          // '/' or '/=' or '//' or '/* ... */'
          this.step();
          if (this.forGlobalName) {
            this.token = TSlash;
            break;
          }
          switch (this.codePoint) {
            case 61: // '='
              this.step();
              this.token = TSlashEquals;
              break;

            case 47: {
              // '/'
              // (JS-only: find the end of the line with charCodeAt, then step onto it)
              const contents = this.contents;
              const n = contents.length;
              let i = this.current;
              while (i < n) {
                const c = contents.charCodeAt(i);
                if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) break;
                i++;
              }
              this.current = i;
              this.step();
              if (this.json === JSON) {
                this.addRangeError(this.range(), "JSON does not support comments");
              }
              this.scanCommentText();
              continue;
            }

            case 42: {
              // '*'
              this.step();
              const startRange = this.range();
              // (JS-only: scan for "*/" with charCodeAt. Same effect as the Go loop,
              // which steps one code point at a time and sets "hasNewlineBefore"
              // for every newline, including "approximateNewlineCount".)
              const contents = this.contents;
              const n = contents.length;
              const first = this.end;
              let i = first;
              let sawNewline = false;
              let newlineCount = 0;
              let found = false;
              while (i < n) {
                const c = contents.charCodeAt(i);
                if (c === 42) {
                  if (i + 1 < n && contents.charCodeAt(i + 1) === 47) {
                    found = true;
                    break;
                  }
                } else if (c === 10) {
                  sawNewline = true;
                  if (i > first) newlineCount++;
                } else if (c === 13 || c === 0x2028 || c === 0x2029) {
                  sawNewline = true;
                }
                i++;
              }
              this.approximateNewlineCount += newlineCount;
              if (sawNewline) this.hasNewlineBefore = true;
              if (!found) {
                // This indicates the end of the file
                this.current = n;
                this.step();
                this.start = this.end;
                this.addRangeErrorWithNotes(new Range(this.start, 0), 'Expected "*/" to terminate multi-line comment', [
                  this.tracker.msgData(startRange, "The multi-line comment starts here:"),
                ]);
                throw LEXER_PANIC;
              }
              this.current = i + 2;
              this.step();
              if (this.json === JSON) {
                this.addRangeError(this.range(), "JSON does not support comments");
              }
              this.scanCommentText();
              continue;
            }

            default:
              this.token = TSlash;
          }
          break;

        case 61: // '='
          // '=' or '=>' or '==' or '==='
          this.step();
          switch (this.codePoint) {
            case 62: // '>'
              this.step();
              this.token = TEqualsGreaterThan;
              break;
            case 61: // '='
              this.step();
              switch (this.codePoint) {
                case 61: // '='
                  this.step();
                  this.token = TEqualsEqualsEquals;
                  break;
                default:
                  this.token = TEqualsEquals;
              }
              break;
            default:
              this.token = TEquals;
          }
          break;

        case 60: // '<'
          // '<' or '<<' or '<=' or '<<=' or '<!--'
          this.step();
          switch (this.codePoint) {
            case 61: // '='
              this.step();
              this.token = TLessThanEquals;
              break;
            case 60: // '<'
              this.step();
              switch (this.codePoint) {
                case 61: // '='
                  this.step();
                  this.token = TLessThanLessThanEquals;
                  break;
                default:
                  this.token = TLessThanLessThan;
              }
              break;

            // Handle legacy HTML-style comments
            case 33: // '!'
              if (this.contents.startsWith("<!--", this.start)) {
                this.step();
                this.step();
                this.step();
                this.legacyHTMLCommentRange = this.range();
                this.log.addID(
                  MsgID_JS_HTMLCommentInJS,
                  KindWarning,
                  this.tracker,
                  this.range(),
                  'Treating "<!--" as the start of a legacy HTML single-line comment',
                );
                singleLineHTMLOpenComment: for (;;) {
                  switch (this.codePoint) {
                    case 13:
                    case 10:
                    case 0x2028:
                    case 0x2029:
                      break singleLineHTMLOpenComment;

                    case -1: // This indicates the end of the file
                      break singleLineHTMLOpenComment;
                  }
                  this.step();
                }
                continue;
              }

              this.token = TLessThan;
              break;

            default:
              this.token = TLessThan;
          }
          break;

        case 62: // '>'
          // '>' or '>>' or '>>>' or '>=' or '>>=' or '>>>='
          this.step();
          switch (this.codePoint) {
            case 61: // '='
              this.step();
              this.token = TGreaterThanEquals;
              break;
            case 62: // '>'
              this.step();
              switch (this.codePoint) {
                case 61: // '='
                  this.step();
                  this.token = TGreaterThanGreaterThanEquals;
                  break;
                case 62: // '>'
                  this.step();
                  switch (this.codePoint) {
                    case 61: // '='
                      this.step();
                      this.token = TGreaterThanGreaterThanGreaterThanEquals;
                      break;
                    default:
                      this.token = TGreaterThanGreaterThanGreaterThan;
                  }
                  break;
                default:
                  this.token = TGreaterThanGreaterThan;
              }
              break;
            default:
              this.token = TGreaterThan;
          }
          break;

        case 33: // '!'
          // '!' or '!=' or '!=='
          this.step();
          switch (this.codePoint) {
            case 61: // '='
              this.step();
              switch (this.codePoint) {
                case 61: // '='
                  this.step();
                  this.token = TExclamationEqualsEquals;
                  break;
                default:
                  this.token = TExclamationEquals;
              }
              break;
            default:
              this.token = TExclamation;
          }
          break;

        case 39: // '\''
        case 34: // '"'
        case 96: {
          // '`'
          const quote = cp;
          let needsSlowPath = false;
          let suffixLen = 1;

          if (quote !== 96) {
            this.token = TStringLiteral;
          } else if (this.rescanCloseBraceAsTemplateTokenFlag) {
            this.token = TTemplateTail;
          } else {
            this.token = TNoSubstitutionTemplateLiteral;
          }
          this.step();

          stringLiteral: for (;;) {
            let c = this.codePoint;

            // (JS-only: skip over a run of printable ASCII characters that need no
            // special handling, then step onto the next character)
            if (c >= 0x20 && c < 0x7f && c !== quote && c !== 92 && c !== 36) {
              const contents = this.contents;
              const n = contents.length;
              let i = this.end + 1;
              const prefixEnd = Math.min(n, i + 128);
              while (i < prefixEnd) {
                const c2 = contents.charCodeAt(i);
                if (c2 < 0x20 || c2 >= 0x7f || c2 === quote || c2 === 92 || c2 === 36) break;
                i++;
              }
              if (i === prefixEnd && i < n) {
                const stop = quote === 34 ? ASCII_STRING_DQ : quote === 39 ? ASCII_STRING_SQ : ASCII_STRING_BT;
                stop.lastIndex = i;
                const match = stop.exec(contents);
                i = match === null ? n : match.index;
              }
              this.current = i;
              this.step();
              c = this.codePoint;
            }

            switch (c) {
              case 92: // '\\'
                needsSlowPath = true;
                this.step();

                // Handle Windows CRLF
                if (this.codePoint === 13 && this.json !== JSON) {
                  this.step();
                  if (this.codePoint === 10) {
                    this.step();
                  }
                  continue stringLiteral;
                }
                break;

              case -1: // This indicates the end of the file
                this.addRangeError(new Range(this.end, 0), "Unterminated string literal");
                throw LEXER_PANIC;

              case 13: // '\r'
                if (quote !== 96) {
                  this.addRangeError(new Range(this.end, 0), "Unterminated string literal");
                  throw LEXER_PANIC;
                }

                // Template literals require newline normalization
                needsSlowPath = true;
                break;

              case 10: // '\n'
                if (quote !== 96) {
                  this.addRangeError(new Range(this.end, 0), "Unterminated string literal");
                  throw LEXER_PANIC;
                }
                break;

              case 36: // '$'
                if (quote === 96) {
                  this.step();
                  if (this.codePoint === 123) {
                    suffixLen = 2;
                    this.step();
                    if (this.rescanCloseBraceAsTemplateTokenFlag) {
                      this.token = TTemplateMiddle;
                    } else {
                      this.token = TTemplateHead;
                    }
                    break stringLiteral;
                  }
                  continue stringLiteral;
                }
                break;

              default:
                if (c === quote) {
                  this.step();
                  break stringLiteral;
                }

                // Non-ASCII strings need the slow path
                if (c >= 0x80) {
                  needsSlowPath = true;
                } else if (this.json === JSON && c < 0x20) {
                  this.syntaxError();
                }
            }
            this.step();
          }

          const text = this.contents.slice(this.start + 1, this.end - suffixLen);

          if (needsSlowPath) {
            // Slow path
            this.decodedStringLiteralOrNil = null;
            this.encodedStringLiteralStart = this.start + 1;
            this.encodedStringLiteralText = text;
          } else {
            // Fast path (the text is ASCII, so it is its own UTF-16 decoding)
            this.decodedStringLiteralOrNil = text;
          }

          if (quote === 39 && (this.json === JSON || this.json === TSConfigJSON)) {
            this.addRangeError(this.range(), "JSON strings must use double quotes");
          }
          break;
        }

        // Note: This case is hot in profiles
        case 95: // '_'
        case 36: // '$'
        case 97: case 98: case 99: case 100: case 101: case 102: case 103: case 104: case 105:
        case 106: case 107: case 108: case 109: case 110: case 111: case 112: case 113: case 114:
        case 115: case 116: case 117: case 118: case 119: case 120: case 121: case 122:
        case 65: case 66: case 67: case 68: case 69: case 70: case 71: case 72: case 73:
        case 74: case 75: case 76: case 77: case 78: case 79: case 80: case 81: case 82:
        case 83: case 84: case 85: case 86: case 87: case 88: case 89: case 90: {
          // This is a fast path for long ASCII identifiers. Doing this in a loop
          // first instead of doing "step()" and "isIdentifierContinue()" like we
          // do after this is noticeably faster in the common case of ASCII-only
          // text.
          const contents = this.contents;
          const n = contents.length;
          let i = this.current;
          while (i < n) {
            const c = contents.charCodeAt(i);
            if (c >= 0x80 || ASCII_IDENT[c] === 0) break;
            i++;
          }
          this.current = i;

          // Now do the slow path for any remaining non-ASCII identifier characters
          this.step();
          if (this.codePoint >= 0x80) {
            while (isIdentifierContinue(this.codePoint)) {
              this.step();
            }
          }

          // If there's a slash, then we're in the extra-slow (and extra-rare) case
          // where the identifier has embedded escapes
          if (this.codePoint === 92) {
            const result = this.scanIdentifierWithEscapes(normalIdentifier);
            this.identifier = result[0];
            this.token = result[1];
            break;
          }

          // Otherwise (if there was no escape) we can slice the code verbatim.
          // (JS-only: "Keywords[raw]" is done with a bucket lookup by length and
          // first letter plus startsWith(), which avoids hashing a new string.
          // For keywords the identifier is the equal, interned keyword string.)
          const start = this.start;
          const len = this.end - start;
          let token = TIdentifier;
          let identifier = null;
          if (len >= 2 && len <= 10 && cp >= 97 && cp <= 122) {
            const bucket = KEYWORD_BUCKETS[len * 26 + (cp - 97)];
            if (bucket !== undefined) {
              for (let k = 0; k < bucket.length; k += 2) {
                // (the first letter and the length already match)
                const text = bucket[k];
                let m = 1;
                while (m < len && contents.charCodeAt(start + m) === text.charCodeAt(m)) m++;
                if (m === len) {
                  identifier = text;
                  token = bucket[k + 1];
                  break;
                }
              }
            }
          }
          this.identifier = identifier === null ? contents.slice(start, this.end) : identifier;
          this.token = token;
          break;
        }

        case 92: {
          // '\\'
          const result = this.scanIdentifierWithEscapes(normalIdentifier);
          this.identifier = result[0];
          this.token = result[1];
          break;
        }

        case 46: // '.'
        case 48: case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57:
          this.parseNumericLiteralOrDot();
          break;

        default:
          // Check for unusual whitespace characters
          if (isWhitespace(this.codePoint)) {
            this.step();
            continue;
          }

          if (isIdentifierStart(this.codePoint)) {
            this.step();
            while (isIdentifierContinue(this.codePoint)) {
              this.step();
            }
            if (this.codePoint === 92) {
              const result = this.scanIdentifierWithEscapes(normalIdentifier);
              this.identifier = result[0];
              this.token = result[1];
            } else {
              this.token = TIdentifier;
              this.identifier = this.rawIdentifier();
            }
            break;
          }

          this.end = this.current;
          this.token = TSyntaxError;
      }

      return;
    }
  }

  // This is an edge case that doesn't really exist in the wild, so it doesn't
  // need to be as fast as possible. Returns [identifier, token].
  scanIdentifierWithEscapes(kind) {
    // First pass: scan over the identifier to see how long it is
    for (;;) {
      // Scan a unicode escape sequence. There is at least one because that's
      // what caused us to get on this slow path in the first place.
      if (this.codePoint === 92) {
        this.step();
        if (this.codePoint !== 117 /* 'u' */) {
          this.syntaxError();
        }
        this.step();
        if (this.codePoint === 123) {
          // Variable-length
          this.step();
          while (this.codePoint !== 125) {
            if (isHexDigit(this.codePoint)) {
              this.step();
            } else {
              this.syntaxError();
            }
          }
          this.step();
        } else {
          // Fixed-length
          for (let j = 0; j < 4; j++) {
            if (isHexDigit(this.codePoint)) {
              this.step();
            } else {
              this.syntaxError();
            }
          }
        }
        continue;
      }

      // Stop when we reach the end of the identifier
      if (!isIdentifierContinue(this.codePoint)) {
        break;
      }
      this.step();
    }

    // Second pass: re-use our existing escape sequence parser
    const result = this.tryToDecodeEscapeSequences(this.start, this.raw(), true /* reportErrors */);
    if (!result[1]) {
      this.end = result[2];
      this.syntaxError();
    }
    const text = result[0];

    // Even though it was escaped, it must still be a valid identifier
    let identifier = text;
    if (kind === privateIdentifier) {
      identifier = identifier.slice(1); // Skip over the "#"
    }
    if (!isIdentifier(identifier)) {
      this.addRangeError(new Range(this.start, this.end - this.start), "Invalid identifier: " + goQuote(text));
    }

    // Escaped keywords are not allowed to work as actual keywords, but they are
    // allowed wherever we allow identifiers or keywords. For example:
    //
    //   // This is an error (equivalent to "var var;")
    //   var var;
    //
    //   // This is an error (equivalent to "var foo;" except for this rule)
    //   var foo;
    //
    //   // This is a fine (equivalent to "foo.var;")
    //   foo.var;
    //
    if (Keywords.has(text)) {
      return [text, TEscapedKeyword];
    } else {
      return [text, TIdentifier];
    }
  }

  parseNumericLiteralOrDot() {
    // Number or dot
    const first = this.codePoint;
    this.step();

    // Dot without a digit after it
    if (first === 46 && (this.codePoint < 48 || this.codePoint > 57)) {
      // "..."
      if (this.codePoint === 46 && this.current < this.contents.length && this.contents.charCodeAt(this.current) === 46) {
        this.step();
        this.step();
        this.token = TDotDotDot;
        return;
      }

      // "."
      this.token = TDot;
      return;
    }

    let underscoreCount = 0;
    let lastUnderscoreEnd = 0;
    let hasDotOrExponent = first === 46;
    let isMissingDigitAfterDot = false;
    let base = 0;
    this.isLegacyOctalLiteral = false;

    // Assume this is a number, but potentially change to a bigint later
    this.token = TNumericLiteral;

    // Check for binary, octal, or hexadecimal literal
    if (first === 48) {
      switch (this.codePoint) {
        case 98: // 'b'
        case 66: // 'B'
          base = 2;
          break;

        case 111: // 'o'
        case 79: // 'O'
          base = 8;
          break;

        case 120: // 'x'
        case 88: // 'X'
          base = 16;
          break;

        case 48: case 49: case 50: case 51: case 52: case 53: case 54: case 55: // '0'-'7'
        case 95: // '_'
          base = 8;
          this.isLegacyOctalLiteral = true;
          break;

        case 56: // '8'
        case 57: // '9'
          this.isLegacyOctalLiteral = true;
          break;
      }
    }

    if (base !== 0) {
      // Integer literal
      let isFirst = true;
      let isInvalidLegacyOctalLiteral = false;
      this.number = 0;
      if (!this.isLegacyOctalLiteral) {
        this.step();
      }

      integerLiteral: for (;;) {
        const c = this.codePoint;
        switch (c) {
          case 95: // '_'
            // Cannot have multiple underscores in a row
            if (lastUnderscoreEnd > 0 && this.end === lastUnderscoreEnd + 1) {
              this.syntaxError();
            }

            // The first digit must exist
            if (isFirst || this.isLegacyOctalLiteral) {
              this.syntaxError();
            }

            lastUnderscoreEnd = this.end;
            underscoreCount++;
            break;

          case 48: // '0'
          case 49: // '1'
            this.number = this.number * base + (c - 48);
            break;

          case 50: case 51: case 52: case 53: case 54: case 55: // '2'-'7'
            if (base === 2) {
              this.syntaxError();
            }
            this.number = this.number * base + (c - 48);
            break;

          case 56: // '8'
          case 57: // '9'
            if (this.isLegacyOctalLiteral) {
              isInvalidLegacyOctalLiteral = true;
            } else if (base < 10) {
              this.syntaxError();
            }
            this.number = this.number * base + (c - 48);
            break;

          case 65: case 66: case 67: case 68: case 69: case 70: // 'A'-'F'
            if (base !== 16) {
              this.syntaxError();
            }
            this.number = this.number * base + (c + 10 - 65);
            break;

          case 97: case 98: case 99: case 100: case 101: case 102: // 'a'-'f'
            if (base !== 16) {
              this.syntaxError();
            }
            this.number = this.number * base + (c + 10 - 97);
            break;

          default:
            // The first digit must exist
            if (isFirst) {
              this.syntaxError();
            }

            break integerLiteral;
        }

        this.step();
        isFirst = false;
      }

      const isBigIntegerLiteral = this.codePoint === 110 /* 'n' */ && !hasDotOrExponent;

      // Slow path: do we need to re-scan the input as text?
      if (isBigIntegerLiteral || isInvalidLegacyOctalLiteral) {
        let text = this.rawIdentifier();

        // Can't use a leading zero for bigint literals
        if (isBigIntegerLiteral && this.isLegacyOctalLiteral) {
          this.syntaxError();
        }

        // Filter out underscores
        if (underscoreCount > 0) {
          text = removeUnderscores(text);
        }

        // Store bigints as text to avoid precision loss
        if (isBigIntegerLiteral) {
          this.identifier = text;
        } else if (isInvalidLegacyOctalLiteral) {
          // Legacy octal literals may turn out to be a base 10 literal after all
          // (strconv.ParseFloat: the text is a plain run of decimal digits here)
          this.number = parseFloat64(text);
        }
      }
    } else {
      // Floating-point literal
      const isInvalidLegacyOctalLiteral = first === 48 && (this.codePoint === 56 || this.codePoint === 57);

      // Initial digits
      for (;;) {
        if (this.codePoint < 48 || this.codePoint > 57) {
          if (this.codePoint !== 95) {
            break;
          }

          // Cannot have multiple underscores in a row
          if (lastUnderscoreEnd > 0 && this.end === lastUnderscoreEnd + 1) {
            this.syntaxError();
          }

          // The specification forbids underscores in this case
          if (isInvalidLegacyOctalLiteral) {
            this.syntaxError();
          }

          lastUnderscoreEnd = this.end;
          underscoreCount++;
        }
        this.step();
      }

      // Fractional digits
      if (first !== 46 && this.codePoint === 46) {
        // An underscore must not come last
        if (lastUnderscoreEnd > 0 && this.end === lastUnderscoreEnd + 1) {
          this.end--;
          this.syntaxError();
        }

        hasDotOrExponent = true;
        this.step();
        if (this.codePoint === 95) {
          this.syntaxError();
        }
        isMissingDigitAfterDot = true;
        for (;;) {
          if (this.codePoint >= 48 && this.codePoint <= 57) {
            isMissingDigitAfterDot = false;
          } else {
            if (this.codePoint !== 95) {
              break;
            }

            // Cannot have multiple underscores in a row
            if (lastUnderscoreEnd > 0 && this.end === lastUnderscoreEnd + 1) {
              this.syntaxError();
            }

            lastUnderscoreEnd = this.end;
            underscoreCount++;
          }
          this.step();
        }
      }

      // Exponent
      if (this.codePoint === 101 || this.codePoint === 69) {
        // An underscore must not come last
        if (lastUnderscoreEnd > 0 && this.end === lastUnderscoreEnd + 1) {
          this.end--;
          this.syntaxError();
        }

        hasDotOrExponent = true;
        this.step();
        if (this.codePoint === 43 || this.codePoint === 45) {
          this.step();
        }
        if (this.codePoint < 48 || this.codePoint > 57) {
          this.syntaxError();
        }
        for (;;) {
          if (this.codePoint < 48 || this.codePoint > 57) {
            if (this.codePoint !== 95) {
              break;
            }

            // Cannot have multiple underscores in a row
            if (lastUnderscoreEnd > 0 && this.end === lastUnderscoreEnd + 1) {
              this.syntaxError();
            }

            lastUnderscoreEnd = this.end;
            underscoreCount++;
          }
          this.step();
        }
      }

      // Take a slice of the text to parse
      let text = this.rawIdentifier();

      // Filter out underscores
      if (underscoreCount > 0) {
        text = removeUnderscores(text);
      }

      if (this.codePoint === 110 /* 'n' */ && !hasDotOrExponent) {
        // The only bigint literal that can start with 0 is "0n"
        if (text.length > 1 && first === 48) {
          this.syntaxError();
        }

        // Store bigints as text to avoid precision loss
        this.identifier = text;
      } else if (!hasDotOrExponent && this.end - this.start < 10) {
        // Parse a 32-bit integer (very fast path)
        let number = 0;
        for (let i = 0, n = text.length; i < n; i++) {
          number = number * 10 + (text.charCodeAt(i) - 48);
        }
        this.number = number;
      } else {
        // Parse a double-precision floating-point number
        this.number = parseFloat64(text);
      }
    }

    // An underscore must not come last
    if (lastUnderscoreEnd > 0 && this.end === lastUnderscoreEnd + 1) {
      this.end--;
      this.syntaxError();
    }

    // Handle bigint literals after the underscore-at-end check above
    if (this.codePoint === 110 /* 'n' */ && !hasDotOrExponent) {
      this.token = TBigIntegerLiteral;
      this.step();
    }

    // Identifiers can't occur immediately after numbers
    if (isIdentifierStart(this.codePoint)) {
      this.syntaxError();
    }

    // None of these are allowed in JSON
    if (this.json === JSON && (first === 46 || base !== 0 || underscoreCount > 0 || isMissingDigitAfterDot)) {
      this.unexpected();
    }
  }

  scanRegExp() {
    for (;;) {
      switch (this.codePoint) {
        case 47: {
          // '/'
          this.step();
          let bits = 0;
          while (isIdentifierContinue(this.codePoint)) {
            switch (this.codePoint) {
              case 100: // 'd'
              case 103: // 'g'
              case 105: // 'i'
              case 109: // 'm'
              case 115: // 's'
              case 117: // 'u'
              case 118: // 'v'
              case 121: {
                // 'y'
                const bit = 1 << (this.codePoint - 97);
                if ((bit & bits) !== 0) {
                  // Reject duplicate flags (Go logs this directly, ignoring "isLogDisabled")
                  const r1 = new Range(this.start, 1);
                  const r2 = new Range(this.end, 1);
                  while (r1.loc < r2.loc && this.source.contents.charCodeAt(r1.loc) !== this.codePoint) {
                    r1.loc++;
                  }
                  const flag = String.fromCharCode(this.codePoint);
                  this.log.addErrorWithNotes(this.tracker, r2, 'Duplicate flag "' + flag + '" in regular expression', [
                    this.tracker.msgData(r1, 'The first "' + flag + '" was here:'),
                  ]);
                } else {
                  bits |= bit;
                }
                this.step();
                break;
              }

              default:
                this.syntaxError();
            }
          }
          return;
        }

        case 91: // '['
          this.step();
          while (this.codePoint !== 93 /* ']' */) {
            this.scanRegExpValidateAndStep();
          }
          this.step();
          break;

        default:
          this.scanRegExpValidateAndStep();
      }
    }
  }

  // The "validateAndStep" closure inside Go's ScanRegExp()
  scanRegExpValidateAndStep() {
    if (this.codePoint === 92) {
      this.step();
    }

    switch (this.codePoint) {
      case -1: // This indicates the end of the file
      case 13: // Newlines aren't allowed in regular expressions
      case 10:
      case 0x2028:
      case 0x2029:
        this.addRangeError(new Range(this.end, 0), "Unterminated regular expression");
        throw LEXER_PANIC;

      default:
        this.step();
    }
  }

  // If this fails, this returns "[null, false, end]" where "end" is the value to
  // store to "lexer.end" before calling "lexer.syntaxError()" if relevant.
  // Otherwise returns "[decoded, true, 0]".
  tryToDecodeEscapeSequences(start, text, reportErrors): [any, boolean, number] {
    // (JS-only: the decoded pieces, joined at the end; appending with += would
    // build a deep rope for strings with many escapes)
    const decoded = [];
    const n = text.length;
    let i = 0;

    // (JS-only: characters other than '\r' and '\\' decode to themselves, so
    // they are copied in runs)
    let runStart = 0;

    while (i < n) {
      const c = text.charCodeAt(i);
      if (c !== 13 && c !== 92) {
        i++;
        continue;
      }
      if (runStart < i) decoded.push(sourceRunValue(text.slice(runStart, i)));
      const width = 1;
      i += width;

      if (c === 13) {
        // From the specification:
        //
        // 11.8.6.1 Static Semantics: TV and TRV
        //
        // TV excludes the code units of LineContinuation while TRV includes
        // them. <CR><LF> and <CR> LineTerminatorSequences are normalized to
        // <LF> for both TV and TRV. An explicit EscapeSequence is needed to
        // include a <CR> or <CR><LF> sequence.

        // Convert '\r\n' into '\n'
        if (i < n && text.charCodeAt(i) === 10) {
          i++;
        }

        // Convert '\r' into '\n'
        decoded.push("\n");
        runStart = i;
        continue;
      }

      // c === '\\'
      const c2 = decodeRune(text, i);
      const width2 = runeWidth;
      i += width2;

      let value = 0;
      let skip = false;

      switch (c2) {
        case 98: // 'b'
          value = 8;
          break;

        case 102: // 'f'
          value = 12;
          break;

        case 110: // 'n'
          value = 10;
          break;

        case 114: // 'r'
          value = 13;
          break;

        case 116: // 't'
          value = 9;
          break;

        case 118: // 'v'
          if (this.json === JSON) {
            return [null, false, start + i - width2];
          }

          value = 11;
          break;

        case 48: case 49: case 50: case 51: case 52: case 53: case 54: case 55: {
          // '0'-'7'
          const octalStart = i - 2;
          if (this.json === JSON) {
            return [null, false, start + i - width2];
          }

          // 1-3 digit octal
          let isBad = false;
          value = c2 - 48;
          const c3 = decodeRune(text, i);
          const width3 = runeWidth;
          switch (c3) {
            case 48: case 49: case 50: case 51: case 52: case 53: case 54: case 55: {
              value = value * 8 + c3 - 48;
              i += width3;
              const c4 = decodeRune(text, i);
              const width4 = runeWidth;
              switch (c4) {
                case 48: case 49: case 50: case 51: case 52: case 53: case 54: case 55: {
                  const temp = value * 8 + c4 - 48;
                  if (temp < 256) {
                    value = temp;
                    i += width4;
                  }
                  break;
                }
                case 56: // '8'
                case 57: // '9'
                  isBad = true;
                  break;
              }
              break;
            }
            case 56: // '8'
            case 57: // '9'
              isBad = true;
              break;
          }

          // Forbid the use of octal literals other than "\0"
          // (text[octalStart:i] != "\\0")
          if (isBad || !(i - octalStart === 2 && c2 === 48)) {
            this.legacyOctalLoc = start + octalStart;
          }
          break;
        }

        case 56: // '8'
        case 57: // '9'
          value = c2;

          // Forbid the invalid octal literals "\8" and "\9"
          this.legacyOctalLoc = start + i - 2;
          break;

        case 120: {
          // 'x'
          if (this.json === JSON) {
            return [null, false, start + i - width2];
          }

          // 2-digit hexadecimal
          value = 0;
          for (let j = 0; j < 2; j++) {
            const c3 = decodeRune(text, i);
            const width3 = runeWidth;
            i += width3;
            const d = hexDigitValue(c3);
            if (d < 0) {
              return [null, false, start + i - width3];
            }
            value = (value * 16) | d;
          }
          break;
        }

        case 117: {
          // 'u'
          // Unicode
          value = 0;

          // Check the first character
          let c3 = decodeRune(text, i);
          let width3 = runeWidth;
          i += width3;

          if (c3 === 123) {
            // '{'
            if (this.json === JSON) {
              return [null, false, start + i - width2];
            }

            // Variable-length
            const hexStart = i - width - width2 - width3;
            let isFirst = true;
            let isOutOfRange = false;
            variableLength: for (;;) {
              c3 = decodeRune(text, i);
              width3 = runeWidth;
              i += width3;

              if (c3 === 125) {
                // '}'
                if (isFirst) {
                  return [null, false, start + i - width3];
                }
                break variableLength;
              }
              const d = hexDigitValue(c3);
              if (d < 0) {
                return [null, false, start + i - width3];
              }
              // (Go's rune is an int32, so this wraps around like Go does)
              value = Math.imul(value, 16) | d;

              if (value > 0x10ffff) {
                isOutOfRange = true;
              }

              isFirst = false;
            }

            if (isOutOfRange && reportErrors) {
              this.addRangeError(new Range(start + hexStart, i - hexStart), "Unicode escape sequence is out of range");
              throw LEXER_PANIC;
            }
          } else {
            // Fixed-length
            for (let j = 0; j < 4; j++) {
              const d = hexDigitValue(c3);
              if (d < 0) {
                return [null, false, start + i - width3];
              }
              value = (value * 16) | d;

              if (j < 3) {
                c3 = decodeRune(text, i);
                width3 = runeWidth;
                i += width3;
              }
            }
          }
          break;
        }

        case 13: // '\r'
          if (this.json === JSON) {
            return [null, false, start + i - width2];
          }

          // Ignore line continuations. A line continuation is not an escaped newline.
          if (i < n && text.charCodeAt(i) === 10) {
            // Make sure Windows CRLF counts as a single newline
            i++;
          }
          skip = true;
          break;

        case 10: // '\n'
        case 0x2028:
        case 0x2029:
          if (this.json === JSON) {
            return [null, false, start + i - width2];
          }

          // Ignore line continuations. A line continuation is not an escaped newline.
          skip = true;
          break;

        default:
          if (this.json === JSON) {
            switch (c2) {
              case 34: // '"'
              case 92: // '\\'
              case 47: // '/'
                break;

              default:
                return [null, false, start + i - width2];
            }
          }

          value = c2;
      }

      if (!skip) {
        decoded.push(runeToUTF16(value));
      }
      runStart = i;
    }

    if (runStart === 0) return [sourceRunValue(text), true, 0];
    if (runStart < n) decoded.push(sourceRunValue(text.slice(runStart)));
    return [decoded.join(""), true, 0];
  }

  rescanCloseBraceAsTemplateToken() {
    if (this.token !== TCloseBrace) {
      this.expected(TCloseBrace);
    }

    this.rescanCloseBraceAsTemplateTokenFlag = true;
    this.codePoint = 96; // '`'
    this.current = this.end;
    this.end -= 1;
    this.next();
    this.rescanCloseBraceAsTemplateTokenFlag = false;
  }

  step() {
    const i = this.current;
    const contents = this.contents;

    // Use -1 to indicate the end of the file
    let codePoint = -1;
    let width = 0;
    if (i < contents.length) {
      codePoint = contents.charCodeAt(i);
      width = 1;
      if ((codePoint & 0xf800) === 0xd800) {
        if ((codePoint & 0xfc00) === 0xd800 && i + 1 < contents.length && (contents.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
          codePoint = ((codePoint - 0xd800) << 10) + (contents.charCodeAt(i + 1) - 0xdc00) + 0x10000;
          width = 2;
        } else {
          // A raw byte of invalid UTF-8 (see helpers.decodeGoString): Go
          // decodes it as utf8.RuneError
          codePoint = 0xfffd;
        }
      }

      // Track the approximate number of newlines in the file so we can preallocate
      // the line offset table in the printer for source maps. This count is
      // approximate because it handles "\n" and "\r\n" (the common cases) but not
      // "\r" or "U+2028" or "U+2029".
      if (codePoint === 10) {
        this.approximateNewlineCount++;
      }
    }

    this.codePoint = codePoint;
    this.end = i;
    this.current = i + width;
  }

  addRangeError(r, text) {
    // Don't report multiple errors in the same spot
    if (r.loc === this.prevErrorLoc) {
      return;
    }
    this.prevErrorLoc = r.loc;

    if (!this.isLogDisabled) {
      this.log.addError(this.tracker, r, text);
    }
  }

  addRangeErrorWithSuggestion(r, text, suggestion) {
    // Don't report multiple errors in the same spot
    if (r.loc === this.prevErrorLoc) {
      return;
    }
    this.prevErrorLoc = r.loc;

    if (!this.isLogDisabled) {
      const data = this.tracker.msgData(r, text);
      data.location.suggestion = suggestion;
      this.log.addMsg(new Msg(null, "", data, KindError));
    }
  }

  addRangeErrorWithNotes(r, text, notes) {
    // Don't report multiple errors in the same spot
    if (r.loc === this.prevErrorLoc) {
      return;
    }
    this.prevErrorLoc = r.loc;

    if (!this.isLogDisabled) {
      this.log.addErrorWithNotes(this.tracker, r, text, notes);
    }
  }

  // JS-only: returns the index of the first '#' or '@' at or after "j" (or the
  // length of the contents). indexOf() results are cached: "commentHashPos" is
  // the first '#' at or after "commentHashFrom", so it is also the first one at
  // or after any "j" with commentHashFrom <= j <= commentHashPos (same for '@').
  // Comments are scanned left to right, so this is amortized linear.
  nextCommentSpecial(j) {
    const contents = this.contents;
    if (j < this.commentHashFrom || j > this.commentHashPos) {
      const p = contents.indexOf("#", j);
      this.commentHashFrom = j;
      this.commentHashPos = p < 0 ? contents.length : p;
    }
    if (j < this.commentAtFrom || j > this.commentAtPos) {
      const p = contents.indexOf("@", j);
      this.commentAtFrom = j;
      this.commentAtPos = p < 0 ? contents.length : p;
    }
    return this.commentHashPos < this.commentAtPos ? this.commentHashPos : this.commentAtPos;
  }

  scanCommentText() {
    // (JS-only: works on offsets into "contents" instead of slicing the comment)
    const contents = this.contents;
    const textStart = this.start;
    const textEnd = this.end;
    const textLen = textEnd - textStart;
    let hasLegalAnnotation = textLen > 2 && contents.charCodeAt(textStart + 2) === 33; // '!'
    const isMultiLineComment = contents.charCodeAt(textStart + 1) === 42; // '*'
    let omitFromGeneralCommentPreservation = false;

    // Save the original comment text so we can subtract comments from the
    // character frequency analysis used by symbol minification
    this.allComments.push(this.range());

    // Omit the trailing "*/" from the checks below
    let endOfCommentText = textEnd;
    if (isMultiLineComment) {
      endOfCommentText -= 2;
    }

    // (JS-only: only '#' and '@' matter here, so jump from one to the next)
    for (let j = this.nextCommentSpecial(textStart); j < textEnd; j = this.nextCommentSpecial(j + 1)) {
      const c = contents.charCodeAt(j);
      if (c === 35) {
        // '#'
        // rest := text[i+1 : endOfCommentText]
        const rest = j + 1;
        if (hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "__PURE__")) {
          omitFromGeneralCommentPreservation = true;
          this.hasCommentBefore |= PureCommentBefore;
        } else if (hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "__KEY__")) {
          omitFromGeneralCommentPreservation = true;
          this.hasCommentBefore |= KeyCommentBefore;
        } else if (hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "__NO_SIDE_EFFECTS__")) {
          omitFromGeneralCommentPreservation = true;
          this.hasCommentBefore |= NoSideEffectsCommentBefore;
        } else if (j - textStart === 2 && hasPrefix(contents, rest, endOfCommentText, " sourceMappingURL=")) {
          const arg = scanForPragmaArg(pragmaNoSpaceFirst, rest, " sourceMappingURL=", contents.slice(rest, endOfCommentText));
          if (arg !== null) {
            omitFromGeneralCommentPreservation = true;
            this.sourceMappingURL = arg;
          }
        }
      } else if (c === 64) {
        // '@'
        const rest = j + 1;
        if (hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "__PURE__")) {
          omitFromGeneralCommentPreservation = true;
          this.hasCommentBefore |= PureCommentBefore;
        } else if (hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "__KEY__")) {
          omitFromGeneralCommentPreservation = true;
          this.hasCommentBefore |= KeyCommentBefore;
        } else if (hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "__NO_SIDE_EFFECTS__")) {
          omitFromGeneralCommentPreservation = true;
          this.hasCommentBefore |= NoSideEffectsCommentBefore;
        } else if (
          hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "preserve") ||
          hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "license")
        ) {
          hasLegalAnnotation = true;
        } else if (hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "jsx")) {
          const arg = scanForPragmaArg(pragmaSkipSpaceFirst, rest, "jsx", contents.slice(rest, endOfCommentText));
          if (arg !== null) {
            this.jsxFactoryPragmaComment = arg;
          }
        } else if (hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "jsxFrag")) {
          const arg = scanForPragmaArg(pragmaSkipSpaceFirst, rest, "jsxFrag", contents.slice(rest, endOfCommentText));
          if (arg !== null) {
            this.jsxFragmentPragmaComment = arg;
          }
        } else if (hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "jsxRuntime")) {
          const arg = scanForPragmaArg(pragmaSkipSpaceFirst, rest, "jsxRuntime", contents.slice(rest, endOfCommentText));
          if (arg !== null) {
            this.jsxRuntimePragmaComment = arg;
          }
        } else if (hasPrefixWithWordBoundary(contents, rest, endOfCommentText, "jsxImportSource")) {
          const arg = scanForPragmaArg(pragmaSkipSpaceFirst, rest, "jsxImportSource", contents.slice(rest, endOfCommentText));
          if (arg !== null) {
            this.jsxImportSourcePragmaComment = arg;
          }
        } else if (j - textStart === 2 && hasPrefix(contents, rest, endOfCommentText, " sourceMappingURL=")) {
          const arg = scanForPragmaArg(pragmaNoSpaceFirst, rest, " sourceMappingURL=", contents.slice(rest, endOfCommentText));
          if (arg !== null) {
            omitFromGeneralCommentPreservation = true;
            this.sourceMappingURL = arg;
          }
        }
      }
    }

    if (hasLegalAnnotation) {
      this.legalCommentsBeforeToken.push(this.range());
    }

    if (!omitFromGeneralCommentPreservation) {
      this.commentsBeforeToken.push(this.range());
    }
  }
}

// ---------------------------------------------------------------------------
// Constructors

export function newLexer(log, source, ts) {
  const lexer = new Lexer();
  lexer.log = log;
  lexer.source = source;
  lexer.contents = source.contents;
  lexer.tracker = new LineColumnTracker(source);
  lexer.prevErrorLoc = -1;
  lexer.fnOrArrowStartLoc = -1;
  lexer.ts = ts;
  lexer.json = NotJSON;
  lexer.step();
  lexer.next();
  return lexer;
}

export function newLexerGlobalName(log, source) {
  const lexer = new Lexer();
  lexer.log = log;
  lexer.source = source;
  lexer.contents = source.contents;
  lexer.tracker = new LineColumnTracker(source);
  lexer.prevErrorLoc = -1;
  lexer.fnOrArrowStartLoc = -1;
  lexer.forGlobalName = true;
  lexer.json = NotJSON;
  lexer.step();
  lexer.next();
  return lexer;
}

export function newLexerJSON(log, source, json, errorSuffix) {
  const lexer = new Lexer();
  lexer.log = log;
  lexer.source = source;
  lexer.contents = source.contents;
  lexer.tracker = new LineColumnTracker(source);
  lexer.prevErrorLoc = -1;
  lexer.fnOrArrowStartLoc = -1;
  lexer.errorSuffix = errorSuffix;
  lexer.json = json;
  lexer.step();
  lexer.next();
  return lexer;
}

// ---------------------------------------------------------------------------
// Ranges

export function rangeOfIdentifier(source, loc) {
  const text = source.contents;
  const n = text.length;
  if (loc >= n) {
    return new Range(loc, 0);
  }

  let i = loc;
  let c = decodeRune(text, i);

  // Handle private names
  if (c === 35) {
    i++;
    c = decodeRune(text, i);
  }

  if (isIdentifierStart(c) || c === 92) {
    // Search for the end of the identifier
    while (i < n) {
      const c2 = decodeRune(text, i);
      const width2 = runeWidth;
      if (c2 === 92) {
        i += width2;

        // Skip over bracketed unicode escapes such as "\u{10000}"
        if (i + 2 < n && text.charCodeAt(i) === 117 && text.charCodeAt(i + 1) === 123) {
          i += 2;
          while (i < n) {
            if (text.charCodeAt(i) === 125) {
              i++;
              break;
            }
            i++;
          }
        }
      } else if (!isIdentifierContinue(c2)) {
        return new Range(loc, i - loc);
      } else {
        i += width2;
      }
    }
  }

  // When minifying, this identifier may have originally been a string
  return source.rangeOfString(loc);
}

export function rangeOfImportAssertOrWith(source, assertOrWith, which) {
  if (which === KeyRange) {
    return rangeOfIdentifier(source, assertOrWith.keyLoc);
  }
  if (which === ValueRange) {
    return source.rangeOfString(assertOrWith.valueLoc);
  }
  const loc = rangeOfIdentifier(source, assertOrWith.keyLoc).loc;
  const valueRange = source.rangeOfString(assertOrWith.valueLoc);
  return new Range(loc, valueRange.loc + valueRange.len - loc);
}

// ---------------------------------------------------------------------------
// JSX entities

// "decoded" is the string decoded so far (Go appends to a []uint16); returns
// the new decoded string.
export function decodeJSXEntities(decoded, text) {
  // (JS-only: text other than entities decodes to itself, so it is copied in
  // runs between "&" characters)
  const n = text.length;
  let i = 0;
  let runStart = 0;

  while (i < n) {
    const amp = text.indexOf("&", i);
    if (amp < 0) {
      break;
    }
    i = amp + 1;

    const semi = text.indexOf(";", i);
    const length = semi < 0 ? -1 : semi - i;
    if (length > 0) {
      const entity = text.slice(i, i + length);
      let c = 0;
      let ok = false;
      if (entity.charCodeAt(0) === 35) {
        // '#'
        let number = entity.slice(1);
        let base = 10;
        if (number.length > 1 && number.charCodeAt(0) === 120) {
          // 'x'
          number = number.slice(1);
          base = 16;
        }
        const value = parseInt32(number, base);
        if (value !== null) {
          c = value;
          ok = true;
        }
      } else {
        const value = jsxEntity.get(entity);
        if (value !== undefined) {
          c = value;
          ok = true;
        }
      }
      if (ok) {
        decoded += sourceRunValue(text.slice(runStart, amp)) + runeToUTF16(c);
        i += length + 1;
        runStart = i;
      }
    }
  }

  return decoded + sourceRunValue(runStart === 0 ? text : text.slice(runStart));
}

export function fixWhitespaceAndDecodeJSXEntities(text) {
  let afterLastNonWhitespace = -1;
  let decoded = "";
  let i = 0;
  const n = text.length;

  // Trim whitespace off the end of the first line
  let firstNonWhitespace = 0;

  // Split into lines
  while (i < n) {
    const c = decodeRune(text, i);
    const width = runeWidth;

    switch (c) {
      case 13: // '\r'
      case 10: // '\n'
      case 0x2028:
      case 0x2029:
        // Newline
        if (firstNonWhitespace !== -1 && afterLastNonWhitespace !== -1) {
          if (decoded.length > 0) {
            decoded += " ";
          }

          // Trim whitespace off the start and end of lines in the middle
          decoded = decodeJSXEntities(decoded, text.slice(firstNonWhitespace, afterLastNonWhitespace));
        }

        // Reset for the next line
        firstNonWhitespace = -1;
        break;

      case 9: // '\t'
      case 32: // ' '
        // Whitespace
        break;

      default:
        // Check for unusual whitespace characters
        if (!isWhitespace(c)) {
          afterLastNonWhitespace = i + width;
          if (firstNonWhitespace === -1) {
            firstNonWhitespace = i;
          }
        }
    }

    i += width;
  }

  if (firstNonWhitespace !== -1) {
    if (decoded.length > 0) {
      decoded += " ";
    }

    // Trim whitespace off the start of the last line
    decoded = decodeJSXEntities(decoded, text.slice(firstNonWhitespace));
  }

  return decoded;
}

// strconv.ParseInt(s, base, 32) for base 10 or 16. Returns null on error.
function parseInt32(s, base) {
  const n = s.length;
  if (n === 0) {
    return null;
  }
  let i = 0;
  let neg = false;
  const c0 = s.charCodeAt(0);
  if (c0 === 43) {
    // '+'
    i = 1;
  } else if (c0 === 45) {
    // '-'
    neg = true;
    i = 1;
  }
  if (i >= n) {
    return null;
  }
  let un = 0;
  for (; i < n; i++) {
    const c = s.charCodeAt(i);
    let d;
    if (c >= 48 && c <= 57) d = c - 48;
    else if (c >= 97 && c <= 122) d = c - 97 + 10;
    else if (c >= 65 && c <= 90) d = c - 65 + 10;
    else return null;
    if (d >= base) {
      return null;
    }
    un = un * base + d;
    if (un > 0xffffffff) {
      return null; // out of range for ParseUint(s, base, 32)
    }
  }
  const cutoff = 0x80000000;
  if (!neg && un >= cutoff) {
    return null;
  }
  if (neg && un > cutoff) {
    return null;
  }
  return neg ? -un : un;
}

// ---------------------------------------------------------------------------
// Comment helpers

// hasPrefixWithWordBoundary(text[from:to], prefix)
function hasPrefixWithWordBoundary(text, from, to, prefix) {
  const t = to - from;
  const p = prefix.length;
  if (t >= p && text.startsWith(prefix, from)) {
    if (t === p) {
      return true;
    }
    let c = text.charCodeAt(from + p);
    if (c >= 0xd800 && c <= 0xdbff && from + p + 1 < to) {
      const c2 = text.charCodeAt(from + p + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = ((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000;
      }
    }
    if (!isIdentifierContinue(c)) {
      return true;
    }
  }
  return false;
}

// strings.HasPrefix(text[from:to], prefix)
function hasPrefix(text, from, to, prefix) {
  return to - from >= prefix.length && text.startsWith(prefix, from);
}

// Returns a logger.Span, or null for "!ok"
function scanForPragmaArg(kind, start, pragma, text) {
  text = text.slice(pragma.length);
  start += pragma.length;

  if (text === "") {
    return null;
  }

  // One or more whitespace characters
  let c = decodeRune(text, 0);
  let width = runeWidth;
  if (kind === pragmaSkipSpaceFirst) {
    if (!isWhitespace(c)) {
      return null;
    }
    while (isWhitespace(c)) {
      text = text.slice(width);
      start += width;
      if (text === "") {
        return null;
      }
      c = decodeRune(text, 0);
      width = runeWidth;
    }
  }

  // One or more non-whitespace characters
  let i = 0;
  while (!isWhitespace(c)) {
    i += width;
    if (i >= text.length) {
      break;
    }
    c = decodeRune(text, i);
    width = runeWidth;
    if (isWhitespace(c)) {
      break;
    }
  }

  return new Span(text.slice(0, i), new Range(start, i));
}

export function isUpperASCII(c) {
  return c >= 65 && c <= 90;
}

export function isLetterASCII(c) {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
}

// ---------------------------------------------------------------------------
// Small helpers (JS-only)

function isHexDigit(c) {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

function hexDigitValue(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c + 10 - 97;
  if (c >= 65 && c <= 70) return c + 10 - 65;
  return -1;
}

function removeUnderscores(text) {
  let out = "";
  let runStart = 0;
  for (let i = 0, n = text.length; i < n; i++) {
    if (text.charCodeAt(i) === 95) {
      out += text.slice(runStart, i);
      runStart = i + 1;
    }
  }
  return out + text.slice(runStart);
}

// ---------------------------------------------------------------------------
// tables.go

// map[T]string
export const tokenToString = new Map([
  [TEndOfFile, "end of file"],
  [TSyntaxError, "syntax error"],
  [THashbang, "hashbang comment"],
  [TNoSubstitutionTemplateLiteral, "template literal"],
  [TNumericLiteral, "number"],
  [TStringLiteral, "string"],
  [TBigIntegerLiteral, "bigint"],
  [TTemplateHead, "template literal"],
  [TTemplateMiddle, "template literal"],
  [TTemplateTail, "template literal"],
  [TAmpersand, '"&"'],
  [TAmpersandAmpersand, '"&&"'],
  [TAsterisk, '"*"'],
  [TAsteriskAsterisk, '"**"'],
  [TAt, '"@"'],
  [TBar, '"|"'],
  [TBarBar, '"||"'],
  [TCaret, '"^"'],
  [TCloseBrace, '"}"'],
  [TCloseBracket, '"]"'],
  [TCloseParen, '")"'],
  [TColon, '":"'],
  [TComma, '","'],
  [TDot, '"."'],
  [TDotDotDot, '"..."'],
  [TEqualsEquals, '"=="'],
  [TEqualsEqualsEquals, '"==="'],
  [TEqualsGreaterThan, '"=>"'],
  [TExclamation, '"!"'],
  [TExclamationEquals, '"!="'],
  [TExclamationEqualsEquals, '"!=="'],
  [TGreaterThan, '">"'],
  [TGreaterThanEquals, '">="'],
  [TGreaterThanGreaterThan, '">>"'],
  [TGreaterThanGreaterThanGreaterThan, '">>>"'],
  [TLessThan, '"<"'],
  [TLessThanEquals, '"<="'],
  [TLessThanLessThan, '"<<"'],
  [TMinus, '"-"'],
  [TMinusMinus, '"--"'],
  [TOpenBrace, '"{"'],
  [TOpenBracket, '"["'],
  [TOpenParen, '"("'],
  [TPercent, '"%"'],
  [TPlus, '"+"'],
  [TPlusPlus, '"++"'],
  [TQuestion, '"?"'],
  [TQuestionDot, '"?."'],
  [TQuestionQuestion, '"??"'],
  [TSemicolon, '";"'],
  [TSlash, '"/"'],
  [TTilde, '"~"'],
  [TAmpersandAmpersandEquals, '"&&="'],
  [TAmpersandEquals, '"&="'],
  [TAsteriskAsteriskEquals, '"**="'],
  [TAsteriskEquals, '"*="'],
  [TBarBarEquals, '"||="'],
  [TBarEquals, '"|="'],
  [TCaretEquals, '"^="'],
  [TEquals, '"="'],
  [TGreaterThanGreaterThanEquals, '">>="'],
  [TGreaterThanGreaterThanGreaterThanEquals, '">>>="'],
  [TLessThanLessThanEquals, '"<<="'],
  [TMinusEquals, '"-="'],
  [TPercentEquals, '"%="'],
  [TPlusEquals, '"+="'],
  [TQuestionQuestionEquals, '"??="'],
  [TSlashEquals, '"/="'],
  [TPrivateIdentifier, "private identifier"],
  [TIdentifier, "identifier"],
  [TEscapedKeyword, "escaped keyword"],
  [TBreak, '"break"'],
  [TCase, '"case"'],
  [TCatch, '"catch"'],
  [TClass, '"class"'],
  [TConst, '"const"'],
  [TContinue, '"continue"'],
  [TDebugger, '"debugger"'],
  [TDefault, '"default"'],
  [TDelete, '"delete"'],
  [TDo, '"do"'],
  [TElse, '"else"'],
  [TEnum, '"enum"'],
  [TExport, '"export"'],
  [TExtends, '"extends"'],
  [TFalse, '"false"'],
  [TFinally, '"finally"'],
  [TFor, '"for"'],
  [TFunction, '"function"'],
  [TIf, '"if"'],
  [TImport, '"import"'],
  [TIn, '"in"'],
  [TInstanceof, '"instanceof"'],
  [TNew, '"new"'],
  [TNull, '"null"'],
  [TReturn, '"return"'],
  [TSuper, '"super"'],
  [TSwitch, '"switch"'],
  [TThis, '"this"'],
  [TThrow, '"throw"'],
  [TTrue, '"true"'],
  [TTry, '"try"'],
  [TTypeof, '"typeof"'],
  [TVar, '"var"'],
  [TVoid, '"void"'],
  [TWhile, '"while"'],
  [TWith, '"with"'],
]);

// This is from https://github.com/microsoft/TypeScript/blob/master/src/compiler/transformers/jsx.ts
// map[string]rune
export const jsxEntity = new Map([
  ["quot", 0x0022],
  ["amp", 0x0026],
  ["apos", 0x0027],
  ["lt", 0x003c],
  ["gt", 0x003e],
  ["nbsp", 0x00a0],
  ["iexcl", 0x00a1],
  ["cent", 0x00a2],
  ["pound", 0x00a3],
  ["curren", 0x00a4],
  ["yen", 0x00a5],
  ["brvbar", 0x00a6],
  ["sect", 0x00a7],
  ["uml", 0x00a8],
  ["copy", 0x00a9],
  ["ordf", 0x00aa],
  ["laquo", 0x00ab],
  ["not", 0x00ac],
  ["shy", 0x00ad],
  ["reg", 0x00ae],
  ["macr", 0x00af],
  ["deg", 0x00b0],
  ["plusmn", 0x00b1],
  ["sup2", 0x00b2],
  ["sup3", 0x00b3],
  ["acute", 0x00b4],
  ["micro", 0x00b5],
  ["para", 0x00b6],
  ["middot", 0x00b7],
  ["cedil", 0x00b8],
  ["sup1", 0x00b9],
  ["ordm", 0x00ba],
  ["raquo", 0x00bb],
  ["frac14", 0x00bc],
  ["frac12", 0x00bd],
  ["frac34", 0x00be],
  ["iquest", 0x00bf],
  ["Agrave", 0x00c0],
  ["Aacute", 0x00c1],
  ["Acirc", 0x00c2],
  ["Atilde", 0x00c3],
  ["Auml", 0x00c4],
  ["Aring", 0x00c5],
  ["AElig", 0x00c6],
  ["Ccedil", 0x00c7],
  ["Egrave", 0x00c8],
  ["Eacute", 0x00c9],
  ["Ecirc", 0x00ca],
  ["Euml", 0x00cb],
  ["Igrave", 0x00cc],
  ["Iacute", 0x00cd],
  ["Icirc", 0x00ce],
  ["Iuml", 0x00cf],
  ["ETH", 0x00d0],
  ["Ntilde", 0x00d1],
  ["Ograve", 0x00d2],
  ["Oacute", 0x00d3],
  ["Ocirc", 0x00d4],
  ["Otilde", 0x00d5],
  ["Ouml", 0x00d6],
  ["times", 0x00d7],
  ["Oslash", 0x00d8],
  ["Ugrave", 0x00d9],
  ["Uacute", 0x00da],
  ["Ucirc", 0x00db],
  ["Uuml", 0x00dc],
  ["Yacute", 0x00dd],
  ["THORN", 0x00de],
  ["szlig", 0x00df],
  ["agrave", 0x00e0],
  ["aacute", 0x00e1],
  ["acirc", 0x00e2],
  ["atilde", 0x00e3],
  ["auml", 0x00e4],
  ["aring", 0x00e5],
  ["aelig", 0x00e6],
  ["ccedil", 0x00e7],
  ["egrave", 0x00e8],
  ["eacute", 0x00e9],
  ["ecirc", 0x00ea],
  ["euml", 0x00eb],
  ["igrave", 0x00ec],
  ["iacute", 0x00ed],
  ["icirc", 0x00ee],
  ["iuml", 0x00ef],
  ["eth", 0x00f0],
  ["ntilde", 0x00f1],
  ["ograve", 0x00f2],
  ["oacute", 0x00f3],
  ["ocirc", 0x00f4],
  ["otilde", 0x00f5],
  ["ouml", 0x00f6],
  ["divide", 0x00f7],
  ["oslash", 0x00f8],
  ["ugrave", 0x00f9],
  ["uacute", 0x00fa],
  ["ucirc", 0x00fb],
  ["uuml", 0x00fc],
  ["yacute", 0x00fd],
  ["thorn", 0x00fe],
  ["yuml", 0x00ff],
  ["OElig", 0x0152],
  ["oelig", 0x0153],
  ["Scaron", 0x0160],
  ["scaron", 0x0161],
  ["Yuml", 0x0178],
  ["fnof", 0x0192],
  ["circ", 0x02c6],
  ["tilde", 0x02dc],
  ["Alpha", 0x0391],
  ["Beta", 0x0392],
  ["Gamma", 0x0393],
  ["Delta", 0x0394],
  ["Epsilon", 0x0395],
  ["Zeta", 0x0396],
  ["Eta", 0x0397],
  ["Theta", 0x0398],
  ["Iota", 0x0399],
  ["Kappa", 0x039a],
  ["Lambda", 0x039b],
  ["Mu", 0x039c],
  ["Nu", 0x039d],
  ["Xi", 0x039e],
  ["Omicron", 0x039f],
  ["Pi", 0x03a0],
  ["Rho", 0x03a1],
  ["Sigma", 0x03a3],
  ["Tau", 0x03a4],
  ["Upsilon", 0x03a5],
  ["Phi", 0x03a6],
  ["Chi", 0x03a7],
  ["Psi", 0x03a8],
  ["Omega", 0x03a9],
  ["alpha", 0x03b1],
  ["beta", 0x03b2],
  ["gamma", 0x03b3],
  ["delta", 0x03b4],
  ["epsilon", 0x03b5],
  ["zeta", 0x03b6],
  ["eta", 0x03b7],
  ["theta", 0x03b8],
  ["iota", 0x03b9],
  ["kappa", 0x03ba],
  ["lambda", 0x03bb],
  ["mu", 0x03bc],
  ["nu", 0x03bd],
  ["xi", 0x03be],
  ["omicron", 0x03bf],
  ["pi", 0x03c0],
  ["rho", 0x03c1],
  ["sigmaf", 0x03c2],
  ["sigma", 0x03c3],
  ["tau", 0x03c4],
  ["upsilon", 0x03c5],
  ["phi", 0x03c6],
  ["chi", 0x03c7],
  ["psi", 0x03c8],
  ["omega", 0x03c9],
  ["thetasym", 0x03d1],
  ["upsih", 0x03d2],
  ["piv", 0x03d6],
  ["ensp", 0x2002],
  ["emsp", 0x2003],
  ["thinsp", 0x2009],
  ["zwnj", 0x200c],
  ["zwj", 0x200d],
  ["lrm", 0x200e],
  ["rlm", 0x200f],
  ["ndash", 0x2013],
  ["mdash", 0x2014],
  ["lsquo", 0x2018],
  ["rsquo", 0x2019],
  ["sbquo", 0x201a],
  ["ldquo", 0x201c],
  ["rdquo", 0x201d],
  ["bdquo", 0x201e],
  ["dagger", 0x2020],
  ["Dagger", 0x2021],
  ["bull", 0x2022],
  ["hellip", 0x2026],
  ["permil", 0x2030],
  ["prime", 0x2032],
  ["Prime", 0x2033],
  ["lsaquo", 0x2039],
  ["rsaquo", 0x203a],
  ["oline", 0x203e],
  ["frasl", 0x2044],
  ["euro", 0x20ac],
  ["image", 0x2111],
  ["weierp", 0x2118],
  ["real", 0x211c],
  ["trade", 0x2122],
  ["alefsym", 0x2135],
  ["larr", 0x2190],
  ["uarr", 0x2191],
  ["rarr", 0x2192],
  ["darr", 0x2193],
  ["harr", 0x2194],
  ["crarr", 0x21b5],
  ["lArr", 0x21d0],
  ["uArr", 0x21d1],
  ["rArr", 0x21d2],
  ["dArr", 0x21d3],
  ["hArr", 0x21d4],
  ["forall", 0x2200],
  ["part", 0x2202],
  ["exist", 0x2203],
  ["empty", 0x2205],
  ["nabla", 0x2207],
  ["isin", 0x2208],
  ["notin", 0x2209],
  ["ni", 0x220b],
  ["prod", 0x220f],
  ["sum", 0x2211],
  ["minus", 0x2212],
  ["lowast", 0x2217],
  ["radic", 0x221a],
  ["prop", 0x221d],
  ["infin", 0x221e],
  ["ang", 0x2220],
  ["and", 0x2227],
  ["or", 0x2228],
  ["cap", 0x2229],
  ["cup", 0x222a],
  ["int", 0x222b],
  ["there4", 0x2234],
  ["sim", 0x223c],
  ["cong", 0x2245],
  ["asymp", 0x2248],
  ["ne", 0x2260],
  ["equiv", 0x2261],
  ["le", 0x2264],
  ["ge", 0x2265],
  ["sub", 0x2282],
  ["sup", 0x2283],
  ["nsub", 0x2284],
  ["sube", 0x2286],
  ["supe", 0x2287],
  ["oplus", 0x2295],
  ["otimes", 0x2297],
  ["perp", 0x22a5],
  ["sdot", 0x22c5],
  ["lceil", 0x2308],
  ["rceil", 0x2309],
  ["lfloor", 0x230a],
  ["rfloor", 0x230b],
  ["lang", 0x2329],
  ["rang", 0x232a],
  ["loz", 0x25ca],
  ["spades", 0x2660],
  ["clubs", 0x2663],
  ["hearts", 0x2665],
  ["diams", 0x2666],
]);
