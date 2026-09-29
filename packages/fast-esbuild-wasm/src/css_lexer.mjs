// Port of internal/css_lexer/css_lexer.go. See CONVENTIONS.md.
//
// The lexer converts a source file to a stream of tokens. Unlike esbuild's
// JavaScript lexer, this CSS lexer runs to completion before the CSS parser
// begins, resulting in a single array of all tokens in the file.
//
// JS port notes:
// - The source is a JS string and all offsets (every Loc, Range, UnitOffset)
//   are UTF-16 indices. "codePoint" is a full code point (surrogate pairs are
//   decoded) and step() advances by 1 or 2 code units. Go looks at single
//   bytes in a few places (contents[i]); the UTF-16 code unit gives the same
//   answer for every ASCII test done there (bytes >= 0x80 of a multi-byte
//   sequence and code units >= 0x80 are both "not ASCII").
// - The token being built lives in lexer fields (tokStart/tokLen/...) and a
//   Token object is created once per token.
import { goQuote } from "./gostd.mjs";
import {
  Range,
  Span,
  MsgID_CSS_JSCommentInCSS,
  MsgID_CSS_CSSSyntaxError,
  Warning,
  LineColumnTracker,
} from "./logger.mjs";
                                                

// ---------------------------------------------------------------------------
// T (token kinds)

const eof = -1;

export const TEndOfFile = 0;
export const TAtKeyword = 1;
export const TUnterminatedString = 2;
export const TBadURL = 3;
export const TCDC = 4; // "-->"
export const TCDO = 5; // "<!--"
export const TCloseBrace = 6;
export const TCloseBracket = 7;
export const TCloseParen = 8;
export const TColon = 9;
export const TComma = 10;
export const TDelim = 11;
export const TDelimAmpersand = 12;
export const TDelimAsterisk = 13;
export const TDelimBar = 14;
export const TDelimCaret = 15;
export const TDelimDollar = 16;
export const TDelimDot = 17;
export const TDelimEquals = 18;
export const TDelimExclamation = 19;
export const TDelimGreaterThan = 20;
export const TDelimLessThan = 21;
export const TDelimMinus = 22;
export const TDelimPlus = 23;
export const TDelimSlash = 24;
export const TDelimTilde = 25;
export const TDimension = 26;
export const TFunction = 27;
export const THash = 28;
export const TIdent = 29;
export const TNumber = 30;
export const TOpenBrace = 31;
export const TOpenBracket = 32;
export const TOpenParen = 33;
export const TPercentage = 34;
export const TSemicolon = 35;
export const TString = 36;
export const TURL = 37;
export const TWhitespace = 38;

// This is never something that the lexer generates directly. Instead this is
// an esbuild-specific token for global/local names that "TIdent" tokens may
// be changed into.
export const TSymbol = 39;

const tokenToString = [
  "end of file",
  "@-keyword",
  "bad string token",
  "bad URL token",
  '"-->"',
  '"<!--"',
  '"}"',
  '"]"',
  '")"',
  '":"',
  '","',
  "delimiter",
  '"&"',
  '"*"',
  '"|"',
  '"^"',
  '"$"',
  '"."',
  '"="',
  '"!"',
  '">"',
  '"<"',
  '"-"',
  '"+"',
  '"/"',
  '"~"',
  "dimension",
  "function token",
  "hash token",
  "identifier",
  "number",
  '"{"',
  '"["',
  '"("',
  "percentage",
  '";"',
  "string token",
  "URL token",
  "whitespace",

  "identifier",
];

// Go: func (t T) String() string
export function tString(t        )         {
  return tokenToString[t];
}

// Go: func (t T) IsNumeric() bool
export function tIsNumeric(t        )          {
  return t === TNumber || t === TPercentage || t === TDimension;
}

// TokenFlags
export const IsID = 1 << 0;
export const DidWarnAboutSingleLineComment = 1 << 1;

// This token struct is designed to be memory-efficient. It just references a
// range in the input file instead of directly containing the substring of text
// since a range takes up less memory than a string.
//
// JS-only: a Token is its own (immutable) Range ("token.range" returns the
// token), which saves an allocation per token.
export class Token extends Range {
  ;                          
  ;                    
  ;                     
  constructor(loc = 0, len = 0, unitOffset = 0, kind = TEndOfFile, flags = 0) {
    super(loc, len);
    this.unitOffset = unitOffset;
    this.kind = kind;
    this.flags = flags;
  }

  get range()        {
    return this;
  }

  clone()        {
    return new Token(this.loc, this.len, this.unitOffset, this.kind, this.flags);
  }

  decodedText(contents        )         {
    const raw = contents.slice(this.range.loc, this.range.loc + this.range.len);

    switch (this.kind) {
      case TIdent:
      case TDimension:
        return decodeEscapesInToken(raw);

      case TAtKeyword:
      case THash:
        return decodeEscapesInToken(raw.slice(1));

      case TFunction:
        return decodeEscapesInToken(raw.slice(0, raw.length - 1));

      case TString:
        return decodeEscapesInToken(raw.slice(1, raw.length - 1));

      case TURL: {
        let start = 4;
        let end = raw.length;

        // Note: URL tokens with syntax errors may not have a trailing ")"
        if (raw.charCodeAt(end - 1) === 41 /* ) */) {
          end--;
        }

        // Trim leading and trailing whitespace
        while (start < end && isWhitespace(raw.charCodeAt(start))) {
          start++;
        }
        while (start < end && isWhitespace(raw.charCodeAt(end - 1))) {
          end--;
        }

        return decodeEscapesInToken(raw.slice(start, end));
      }
    }

    return raw;
  }
}

export class Comment {
  ;                    
  ;                   
  ;                               
  constructor(text = "", loc = 0, tokenIndexAfter = 0) {
    this.text = text;
    this.loc = loc;
    this.tokenIndexAfter = tokenIndexAfter;
  }
}

export class TokenizeResult {
  ;                       
  ;                            
  ;                                
  ;                              
  ;                                    
  constructor(tokens         , allComments         , legalComments           , sourceMapComment      , approximateLineCount        ) {
    this.tokens = tokens;
    this.allComments = allComments;
    this.legalComments = legalComments;
    this.sourceMapComment = sourceMapComment;
    this.approximateLineCount = approximateLineCount;
  }
}

export class Options {
  ;                                  
  constructor(recordAllComments = false) {
    this.recordAllComments = recordAllComments;
  }
}

class lexer {
  ;                                  
  ;                
  ;                      
  ;                        
  ;                            
  ;                                             
  ;                              
  ;                                       
  ;                       
  ;                                       
  ;                       // (not number: step() changes it behind TypeScript's narrowing)
  // The token being built (Go: lexer.Token)
  ;                        
  ;                      
  ;                             
  ;                       
  ;                        
  ;                                  
  constructor(options         , log     , source        ) {
    this.tracker = new LineColumnTracker(source);
    this.recordAllComments = options.recordAllComments;
    this.log = log;
    this.source = source;
    this.contents = source.contents;
    this.allComments = [];
    this.legalCommentsBefore = null;
    this.sourceMappingURL = new Span();
    this.approximateNewlineCount = 0;
    this.current = 0;
    this.oldSingleLineCommentEnd = 0;
    this.codePoint = 0;
    this.tokStart = 0;
    this.tokLen = 0;
    this.tokUnitOffset = 0;
    this.tokKind = TEndOfFile;
    this.tokFlags = 0;
  }

  tokEnd()         {
    return this.tokStart + this.tokLen;
  }

  step() {
    const contents = this.contents;
    const current = this.current;
    let codePoint        ;
    let width        ;
    if (current < contents.length) {
      codePoint = contents.charCodeAt(current);
      width = 1;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
        if (codePoint <= 0xdbff && current + 1 < contents.length && (contents.charCodeAt(current + 1) & 0xfc00) === 0xdc00) {
          codePoint = ((codePoint - 0xd800) << 10) + (contents.charCodeAt(current + 1) - 0xdc00) + 0x10000;
          width = 2;
        } else {
          // A raw byte of invalid UTF-8 (see helpers.decodeGoString)
          codePoint = 0xfffd;
        }
      }
    } else {
      // Use -1 to indicate the end of the file
      codePoint = eof;
      width = 0;
    }

    // Track the approximate number of newlines in the file so we can preallocate
    // the line offset table in the printer for source maps. The line offset table
    // is the #1 highest allocation in the heap profile, so this is worth doing.
    // This count is approximate because it handles "\n" and "\r\n" (the common
    // cases) but not "\r" or "U+2028" or "U+2029". Getting this wrong is harmless
    // because it's only a preallocation. The array will just grow if it's too small.
    if (codePoint === 10) {
      this.approximateNewlineCount++;
    }

    this.codePoint = codePoint;
    this.tokLen = current - this.tokStart;
    this.current = current + width;
  }

  next() {
    // Reference: https://www.w3.org/TR/css-syntax-3/

    for (;;) {
      this.tokStart = this.tokStart + this.tokLen;
      this.tokLen = 0;
      this.tokUnitOffset = 0;
      this.tokKind = TEndOfFile;
      this.tokFlags = 0;

      switch (this.codePoint) {
        case eof:
          this.tokKind = TEndOfFile;
          break;

        case 47: // '/'
          this.step();
          switch (this.codePoint) {
            case 42: // '*'
              this.step();
              this.consumeToEndOfMultiLineComment(this.tokStart);
              continue;
            case 47: {
              // '/'
              // Warn when people use "//" comments, which are invalid in CSS
              const loc = this.tokStart;
              if (loc >= this.oldSingleLineCommentEnd) {
                const contents = this.contents;
                let end = this.current;
                while (end < contents.length && !isNewline(contents.charCodeAt(end))) {
                  end++;
                }
                this.log.addID(MsgID_CSS_JSCommentInCSS, Warning, this.tracker, new Range(loc, 2), 'Comments in CSS use "/* ... */" instead of "//"');
                this.oldSingleLineCommentEnd = end;
                this.tokFlags |= DidWarnAboutSingleLineComment;
              }
              break;
            }
          }
          this.tokKind = TDelimSlash;
          break;

        case 32:
        case 9:
        case 10:
        case 13:
        case 12: // ' ', '\t', '\n', '\r', '\f'
          this.step();
          for (;;) {
            if (isWhitespace(this.codePoint)) {
              this.step();
            } else if (this.codePoint === 47 && this.current < this.contents.length && this.contents.charCodeAt(this.current) === 42) {
              const startLoc = this.tokStart + this.tokLen;
              this.step();
              this.step();
              this.consumeToEndOfMultiLineComment(startLoc);
            } else {
              break;
            }
          }
          this.tokKind = TWhitespace;
          break;

        case 34:
        case 39: // '"', '\''
          this.tokKind = this.consumeString();
          break;

        case 35: // '#'
          this.step();
          if (isNameContinue(this.codePoint) || this.isValidEscape()) {
            this.tokKind = THash;
            if (this.wouldStartIdentifier()) {
              this.tokFlags |= IsID;
            }
            this.consumeName();
          } else {
            this.tokKind = TDelim;
          }
          break;

        case 40: // '('
          this.step();
          this.tokKind = TOpenParen;
          break;

        case 41: // ')'
          this.step();
          this.tokKind = TCloseParen;
          break;

        case 91: // '['
          this.step();
          this.tokKind = TOpenBracket;
          break;

        case 93: // ']'
          this.step();
          this.tokKind = TCloseBracket;
          break;

        case 123: // '{'
          this.step();
          this.tokKind = TOpenBrace;
          break;

        case 125: // '}'
          this.step();
          this.tokKind = TCloseBrace;
          break;

        case 44: // ','
          this.step();
          this.tokKind = TComma;
          break;

        case 58: // ':'
          this.step();
          this.tokKind = TColon;
          break;

        case 59: // ';'
          this.step();
          this.tokKind = TSemicolon;
          break;

        case 43: // '+'
          if (this.wouldStartNumber()) {
            this.tokKind = this.consumeNumeric();
          } else {
            this.step();
            this.tokKind = TDelimPlus;
          }
          break;

        case 46: // '.'
          if (this.wouldStartNumber()) {
            this.tokKind = this.consumeNumeric();
          } else {
            this.step();
            this.tokKind = TDelimDot;
          }
          break;

        case 45: // '-'
          if (this.wouldStartNumber()) {
            this.tokKind = this.consumeNumeric();
          } else if (this.current + 2 <= this.contents.length && this.contents.charCodeAt(this.current) === 45 && this.contents.charCodeAt(this.current + 1) === 62) {
            // "->"
            this.step();
            this.step();
            this.step();
            this.tokKind = TCDC;
          } else if (this.wouldStartIdentifier()) {
            this.tokKind = this.consumeIdentLike();
          } else {
            this.step();
            this.tokKind = TDelimMinus;
          }
          break;

        case 60: // '<'
          if (
            this.current + 3 <= this.contents.length &&
            this.contents.charCodeAt(this.current) === 33 &&
            this.contents.charCodeAt(this.current + 1) === 45 &&
            this.contents.charCodeAt(this.current + 2) === 45
          ) {
            // "!--"
            this.step();
            this.step();
            this.step();
            this.step();
            this.tokKind = TCDO;
          } else {
            this.step();
            this.tokKind = TDelimLessThan;
          }
          break;

        case 64: // '@'
          this.step();
          if (this.wouldStartIdentifier()) {
            this.consumeName();
            this.tokKind = TAtKeyword;
          } else {
            this.tokKind = TDelim;
          }
          break;

        case 92: // '\\'
          if (this.isValidEscape()) {
            this.tokKind = this.consumeIdentLike();
          } else {
            this.step();
            this.log.addError(this.tracker, new Range(this.tokStart, this.tokLen), "Invalid escape");
            this.tokKind = TDelim;
          }
          break;

        case 48:
        case 49:
        case 50:
        case 51:
        case 52:
        case 53:
        case 54:
        case 55:
        case 56:
        case 57:
          this.tokKind = this.consumeNumeric();
          break;

        case 62: // '>'
          this.step();
          this.tokKind = TDelimGreaterThan;
          break;

        case 126: // '~'
          this.step();
          this.tokKind = TDelimTilde;
          break;

        case 38: // '&'
          this.step();
          this.tokKind = TDelimAmpersand;
          break;

        case 42: // '*'
          this.step();
          this.tokKind = TDelimAsterisk;
          break;

        case 124: // '|'
          this.step();
          this.tokKind = TDelimBar;
          break;

        case 33: // '!'
          this.step();
          this.tokKind = TDelimExclamation;
          break;

        case 61: // '='
          this.step();
          this.tokKind = TDelimEquals;
          break;

        case 94: // '^'
          this.step();
          this.tokKind = TDelimCaret;
          break;

        case 36: // '$'
          this.step();
          this.tokKind = TDelimDollar;
          break;

        default:
          if (isNameStart(this.codePoint)) {
            this.tokKind = this.consumeIdentLike();
          } else {
            this.step();
            this.tokKind = TDelim;
          }
      }

      return;
    }
  }

  consumeToEndOfMultiLineComment(startLoc        ) {
    let startOfSourceMappingURL = 0;
    let isLegalComment = false;

    switch (this.codePoint) {
      case 35:
      case 64: // '#', '@'
        // Keep track of the contents of the "sourceMappingURL=" comment
        if (this.contents.startsWith(" sourceMappingURL=", this.current)) {
          startOfSourceMappingURL = this.current + 18; // len(" sourceMappingURL=")
        }
        break;

      case 33: // '!'
        // Remember if this is a legal comment
        isLegalComment = true;
        break;
    }

    // (JS-only: skip to the next "*" directly; step() onto it keeps
    // "approximateNewlineCount" right because the skipped text is counted)
    for (;;) {
      switch (this.codePoint) {
        case 42: {
          // '*'
          const endOfSourceMappingURL = this.current - 1;
          this.step();
          if (this.codePoint === 47) {
            // '/'
            const commentEnd = this.current;
            this.step();

            // Record the source mapping URL
            if (startOfSourceMappingURL !== 0) {
              const text = this.contents.slice(startOfSourceMappingURL, endOfSourceMappingURL);
              let len = 0;
              while (len < text.length && !isWhitespace(text.charCodeAt(len))) {
                len++;
              }
              this.sourceMappingURL = new Span(text.slice(0, len), new Range(startOfSourceMappingURL, len));
            }

            // Record all comments
            const commentRange = new Range(startLoc, commentEnd - startLoc);
            if (this.recordAllComments) {
              this.allComments.push(commentRange);
            }

            // Record legal comments
            if (isLegalComment || containsAtPreserveOrAtLicense(this.contents, startLoc, commentEnd)) {
              const text = this.source.commentTextWithoutIndent(commentRange);
              if (this.legalCommentsBefore === null) this.legalCommentsBefore = [];
              this.legalCommentsBefore.push(new Comment(text, startLoc, 0));
            }
            return;
          }
          break;
        }

        case eof: // This indicates the end of the file
          this.log.addErrorWithNotes(this.tracker, new Range(this.tokEnd(), 0), 'Expected "*/" to terminate multi-line comment', [
            this.tracker.msgData(new Range(startLoc, 2), "The multi-line comment starts here:"),
          ]);
          return;

        default: {
          // Skip ahead to the character before the next "*" (or the end)
          const contents = this.contents;
          let i = this.current;
          const n = contents.length;
          let newlines = 0;
          while (i < n) {
            const c = contents.charCodeAt(i);
            if (c === 42) break;
            if (c === 10) newlines++;
            i++;
          }
          if (i > this.current) {
            // Step onto the last skipped code unit's position: set up the
            // state as if step() had been called for every skipped character
            this.approximateNewlineCount += newlines;
            this.current = i;
          }
          this.step();
        }
      }
    }
  }

  isValidEscape()          {
    if (this.codePoint !== 92) {
      return false;
    }
    const c = codePointAtOrEOF(this.contents, this.current);
    return !isNewline(c);
  }

  wouldStartIdentifier()          {
    if (isNameStart(this.codePoint)) {
      return true;
    }

    if (this.codePoint === 45) {
      // '-'
      const contents = this.contents;
      if (isDecodingError(contents, this.current)) {
        return false; // Decoding error
      }
      const c = codePointAtOrEOF(contents, this.current);
      if (isNameStart(c) || c === 45) {
        return true;
      }
      if (c === 92) {
        const c2 = codePointAtOrEOF(contents, this.current + 1);
        return !isNewline(c2);
      }
      return false;
    }

    return this.isValidEscape();
  }

  wouldStartNumber()          {
    const cp = this.codePoint;
    if (cp >= 48 && cp <= 57) {
      return true;
    } else if (cp === 46) {
      const contents = this.contents;
      if (this.current < contents.length) {
        const c = contents.charCodeAt(this.current);
        return c >= 48 && c <= 57;
      }
    } else if (cp === 43 || cp === 45) {
      const contents = this.contents;
      const n = contents.length;
      if (this.current < n) {
        let c = contents.charCodeAt(this.current);
        if (c >= 48 && c <= 57) {
          return true;
        }
        if (c === 46 && this.current + 1 < n) {
          c = contents.charCodeAt(this.current + 1);
          return c >= 48 && c <= 57;
        }
      }
    }
    return false;
  }

  // Note: This function is hot in profiles
  consumeName()         {
    // Common case: no escapes, identifier is a substring of the input. Doing this
    // in a tight loop that avoids UTF-8 decoding and that increments a single
    // number instead of doing "step()" is noticeably faster.
    const contents = this.contents;
    if (isNameContinue(this.codePoint)) {
      const n = contents.length;
      let i = this.current;
      while (i < n && isNameContinueUnit(contents.charCodeAt(i))) {
        i++;
      }
      this.current = i;
      this.step();
    }
    const raw = contents.slice(this.tokStart, this.tokStart + this.tokLen);
    if (!this.isValidEscape()) {
      return raw;
    }

    // Uncommon case: escapes, identifier is allocated
    let sb = raw;
    sb += String.fromCodePoint(this.consumeEscape());
    for (;;) {
      if (isNameContinue(this.codePoint)) {
        sb += String.fromCodePoint(this.codePoint);
        this.step();
      } else if (this.isValidEscape()) {
        sb += String.fromCodePoint(this.consumeEscape());
      } else {
        break;
      }
    }
    return sb;
  }

  consumeEscape()         {
    this.step(); // Skip the backslash
    const c = this.codePoint;

    let hex = isHex(c);
    if (hex >= 0) {
      this.step();
      for (let i = 0; i < 5; i++) {
        const next = isHex(this.codePoint);
        if (next >= 0) {
          this.step();
          hex = hex * 16 + next;
        } else {
          break;
        }
      }
      if (isWhitespace(this.codePoint)) {
        this.step();
      }
      if (hex === 0 || (hex >= 0xd800 && hex <= 0xdfff) || hex > 0x10ffff) {
        return 0xfffd; // utf8.RuneError
      }
      return hex;
    }

    if (c === eof) {
      return 0xfffd; // utf8.RuneError
    }

    this.step();
    return c;
  }

  consumeIdentLike()         {
    const name = this.consumeName();

    if (this.codePoint === 40) {
      // '('
      const matchingLoc = this.tokStart + this.tokLen;
      this.step();
      if (name.length === 3) {
        const u = name.charCodeAt(0),
          r = name.charCodeAt(1),
          l = name.charCodeAt(2);
        if ((u === 117 || u === 85) && (r === 114 || r === 82) && (l === 108 || l === 76)) {
          // Save state
          const approximateNewlineCount = this.approximateNewlineCount;
          const codePoint = this.codePoint;
          const tokenRangeLen = this.tokLen;
          const current = this.current;

          // Check to see if this is a URL token instead of a function
          while (isWhitespace(this.codePoint)) {
            this.step();
          }
          if (this.codePoint !== 34 && this.codePoint !== 39) {
            return this.consumeURL(matchingLoc);
          }

          // Restore state (i.e. backtrack)
          this.approximateNewlineCount = approximateNewlineCount;
          this.codePoint = codePoint;
          this.tokLen = tokenRangeLen;
          this.current = current;
        }
      }
      return TFunction;
    }

    return TIdent;
  }

  consumeURL(matchingLoc        )         {
    validURL: for (;;) {
      switch (this.codePoint) {
        case 41: // ')'
          this.step();
          return TURL;

        case eof: {
          const loc = this.tokEnd();
          this.log.addIDWithNotes(MsgID_CSS_CSSSyntaxError, Warning, this.tracker, new Range(loc, 0), 'Expected ")" to end URL token', [this.tracker.msgData(new Range(matchingLoc, 1), 'The unbalanced "(" is here:')]);
          return TURL;
        }

        case 32:
        case 9:
        case 10:
        case 13:
        case 12:
          this.step();
          while (isWhitespace(this.codePoint)) {
            this.step();
          }
          if (this.codePoint !== 41) {
            const loc = this.tokEnd();
            this.log.addIDWithNotes(MsgID_CSS_CSSSyntaxError, Warning, this.tracker, new Range(loc, 0), 'Expected ")" to end URL token', [this.tracker.msgData(new Range(matchingLoc, 1), 'The unbalanced "(" is here:')]);
            if (this.codePoint === eof) {
              return TURL;
            }
            break validURL;
          }
          this.step();
          return TURL;

        case 34:
        case 39:
        case 40: {
          // '"', '\'', '('
          const r = new Range(this.tokEnd(), 1);
          this.log.addIDWithNotes(MsgID_CSS_CSSSyntaxError, Warning, this.tracker, r, 'Expected ")" to end URL token', [this.tracker.msgData(new Range(matchingLoc, 1), 'The unbalanced "(" is here:')]);
          break validURL;
        }

        case 92: // '\\'
          if (!this.isValidEscape()) {
            const r = new Range(this.tokEnd(), 1);
            this.log.addID(MsgID_CSS_CSSSyntaxError, Warning, this.tracker, r, "Invalid escape");
            break validURL;
          }
          this.consumeEscape();
          break;

        default:
          if (isNonPrintable(this.codePoint)) {
            const r = new Range(this.tokEnd(), 1);
            this.log.addID(MsgID_CSS_CSSSyntaxError, Warning, this.tracker, r, "Unexpected non-printable character in URL token");
            break validURL;
          }
          this.step();
      }
    }

    // Consume the remnants of a bad url
    for (;;) {
      switch (this.codePoint) {
        case 41:
        case eof:
          this.step();
          return TBadURL;

        case 92:
          if (this.isValidEscape()) {
            this.consumeEscape();
          }
          break;
      }
      this.step();
    }
  }

  consumeString()         {
    const quote = this.codePoint;
    this.step();

    for (;;) {
      switch (this.codePoint) {
        case 92: // '\\'
          this.step();

          // Handle Windows CRLF
          if (this.codePoint === 13) {
            this.step();
            if (this.codePoint === 10) {
              this.step();
            }
            continue;
          }

          // Otherwise, fall through to ignore the character after the backslash
          break;

        case eof:
        case 10:
        case 13:
        case 12:
          this.log.addID(MsgID_CSS_CSSSyntaxError, Warning, this.tracker, new Range(this.tokEnd(), 0), "Unterminated string token");
          return TUnterminatedString;

        case quote:
          this.step();
          return TString;
      }
      this.step();
    }
  }

  consumeNumeric()         {
    // Skip over leading sign
    if (this.codePoint === 43 || this.codePoint === 45) {
      this.step();
    }

    // Skip over leading digits
    while (this.codePoint >= 48 && this.codePoint <= 57) {
      this.step();
    }

    // Skip over digits after dot
    if (this.codePoint === 46) {
      this.step();
      while (this.codePoint >= 48 && this.codePoint <= 57) {
        this.step();
      }
    }

    // Skip over exponent
    if (this.codePoint === 101 || this.codePoint === 69) {
      const contents = this.contents;

      // Look ahead before advancing to make sure this is an exponent, not a unit
      if (this.current < contents.length) {
        let c = contents.charCodeAt(this.current);
        if ((c === 43 || c === 45) && this.current + 1 < contents.length) {
          c = contents.charCodeAt(this.current + 1);
        }

        // Only consume this if it's an exponent
        if (c >= 48 && c <= 57) {
          this.step();
          if (this.codePoint === 43 || this.codePoint === 45) {
            this.step();
          }
          while (this.codePoint >= 48 && this.codePoint <= 57) {
            this.step();
          }
        }
      }
    }

    // Determine the numeric type
    if (this.wouldStartIdentifier()) {
      this.tokUnitOffset = this.tokLen;
      this.consumeName();
      return TDimension;
    }
    if (this.codePoint === 37) {
      // '%'
      this.step();
      return TPercentage;
    }
    return TNumber;
  }
}

export function tokenize(log     , source        , options         )                 {
  const lexer_ = new lexer(options, log, source);
  lexer_.step();

  // The U+FEFF character is usually a zero-width non-breaking space. However,
  // when it's used at the start of a text stream it is called a BOM (byte order
  // mark) instead and indicates that the text stream is UTF-8 encoded. This is
  // problematic for us because CSS does not treat U+FEFF as whitespace. Only
  // " \t\r\n\f" characters are treated as whitespace. Skip over the BOM if it
  // is present so it doesn't cause us trouble when we try to parse it.
  if (lexer_.codePoint === 0xfeff) {
    lexer_.step();
  }

  lexer_.next();
  const tokens          = [];
  const legalComments            = [];
  while (lexer_.tokKind !== TEndOfFile) {
    if (lexer_.legalCommentsBefore !== null) {
      for (const comment of lexer_.legalCommentsBefore) {
        comment.tokenIndexAfter = tokens.length;
        legalComments.push(comment);
      }
      lexer_.legalCommentsBefore = null;
    }
    tokens.push(new Token(lexer_.tokStart, lexer_.tokLen, lexer_.tokUnitOffset, lexer_.tokKind, lexer_.tokFlags));
    lexer_.next();
  }
  if (lexer_.legalCommentsBefore !== null) {
    for (const comment of lexer_.legalCommentsBefore) {
      comment.tokenIndexAfter = tokens.length;
      legalComments.push(comment);
    }
    lexer_.legalCommentsBefore = null;
  }
  return new TokenizeResult(tokens, lexer_.allComments, legalComments, lexer_.sourceMappingURL, lexer_.approximateNewlineCount + 1);
}

// Go iterates the runes of the comment text and checks for "@preserve" or
// "@license" after each "@"
function containsAtPreserveOrAtLicense(contents        , start        , end        )          {
  for (let i = start; i < end; i++) {
    if (contents.charCodeAt(i) === 64) {
      if (i + 9 <= end && contents.startsWith("preserve", i + 1)) return true;
      if (i + 8 <= end && contents.startsWith("license", i + 1)) return true;
    }
  }
  return false;
}

// Returns the code point at "i" (decoding a surrogate pair), or eof (-1)
// past the end. (Go: utf8.DecodeRuneInString returns RuneError with width 0
// for an empty string, which callers treat like eof.)
// (A lone surrogate is a raw byte of invalid UTF-8, see
// helpers.decodeGoString: utf8.RuneError.)
function codePointAtOrEOF(text        , i        )         {
  if (i >= text.length) return eof;
  const c = text.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdfff) {
    if (c <= 0xdbff && i + 1 < text.length) {
      const c2 = text.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) return ((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000;
    }
    return 0xfffd;
  }
  return c;
}

// Whether utf8.DecodeRuneInString(text[i:]) fails (RuneError with a width
// of 0 or 1: the end of the text, or a raw byte of invalid UTF-8)
function isDecodingError(text        , i        )          {
  if (i >= text.length) return true;
  const c = text.charCodeAt(i);
  if (c < 0xd800 || c > 0xdfff) return false;
  return !(c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00);
}

export function wouldStartIdentifierWithoutEscapes(text        )          {
  if (isDecodingError(text, 0)) {
    return false; // Decoding error
  }
  const c = codePointAtOrEOF(text, 0);
  if (isNameStart(c)) {
    return true;
  }

  if (c === 45) {
    // '-'
    if (isDecodingError(text, 1)) {
      return false; // Decoding error
    }
    const c2 = codePointAtOrEOF(text, 1);
    if (isNameStart(c2) || c2 === 45) {
      return true;
    }
  }
  return false;
}

export function rangeOfIdentifier(source        , loc        )        {
  const text = source.contents;
  const n = text.length;
  if (loc >= n) {
    return new Range(loc, 0);
  }

  let i = loc;

  for (;;) {
    let c = codePointAtOrEOF(text, i);
    let width = c > 0xffff ? 2 : 1;
    if (c !== eof && isNameContinue(c)) {
      i += width;
      continue;
    }

    // Handle an escape
    if (c === 92 && i + 1 < n && !isNewline(text.charCodeAt(i + 1))) {
      i += width; // Skip the backslash
      c = codePointAtOrEOF(text, i);
      width = c > 0xffff ? 2 : 1;
      if (isHex(c) >= 0) {
        i += width;
        c = codePointAtOrEOF(text, i);
        width = c > 0xffff ? 2 : 1;
        for (let j = 0; j < 5; j++) {
          if (isHex(c) < 0) {
            break;
          }
          i += width;
          c = codePointAtOrEOF(text, i);
          width = c > 0xffff ? 2 : 1;
        }
        if (isWhitespace(c)) {
          i += width;
        }
      }
      continue;
    }

    break;
  }

  // Don't end with a whitespace
  if (i > loc && isWhitespace(text.charCodeAt(i - 1))) {
    i--;
  }

  return new Range(loc, i - loc);
}

export function isNameStart(c        )          {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c >= 0x80 || c === 0;
}

export function isNameContinue(c        )          {
  return isNameStart(c) || (c >= 48 && c <= 57) || c === 45;
}

// isNameContinue for a single UTF-16 code unit (Go checks single bytes in
// consumeName's fast path; code units >= 0x80 are name characters either way)
function isNameContinueUnit(c        )          {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c >= 0x80 || c === 0 || (c >= 48 && c <= 57) || c === 45;
}

function isNewline(c        )          {
  return c === 10 || c === 13 || c === 12;
}

function isWhitespace(c        )          {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

// Go: func isHex(c rune) (int, bool). Returns the value, or -1.
function isHex(c        )         {
  if (c >= 48 && c <= 57) {
    return c - 48;
  }
  if (c >= 97 && c <= 102) {
    return c + (10 - 97);
  }
  if (c >= 65 && c <= 70) {
    return c + (10 - 65);
  }
  return -1;
}

function isNonPrintable(c        )          {
  return c <= 0x08 || c === 0x0b || (c >= 0x0e && c <= 0x1f) || c === 0x7f;
}

function decodeEscapesInToken(inner        )         {
  let i = 0;

  while (i < inner.length) {
    const c = inner.charCodeAt(i);
    if (c === 92 || c === 0) {
      break;
    }
    i++;
  }

  if (i === inner.length) {
    return inner;
  }

  let sb = inner.slice(0, i);
  const n = inner.length;

  while (i < n) {
    // (JS-only: copy a run of plain characters at once; only "\\" and NUL
    // are special, and neither is part of a surrogate pair)
    let j = i;
    let c = inner.charCodeAt(j);
    while (c !== 92 && c !== 0) {
      if (++j === n) break;
      c = inner.charCodeAt(j);
    }
    if (j > i) {
      // (Go decodes these runes: a raw byte of invalid UTF-8, see
      // helpers.decodeGoString, becomes utf8.RuneError)
      const run = inner.slice(i, j);
      sb += run.isWellFormed() ? run : run.toWellFormed();
      i = j;
      if (i === n) break;
    }
    i++;

    if (c !== 92) {
      // (NUL)
      sb += String.fromCharCode(0xfffd);
      continue;
    }

    if (i >= n) {
      sb += String.fromCharCode(0xfffd);
      continue;
    }

    c = codePointAtOrEOF(inner, i);
    i += c > 0xffff ? 2 : 1;
    let hex = isHex(c);

    if (hex < 0) {
      if (c === 10 || c === 12) {
        continue;
      }

      // Handle Windows CRLF
      if (c === 13) {
        if (i < n && inner.charCodeAt(i) === 10) {
          i++;
        }
        continue;
      }

      // If we get here, this is not a valid escape. However, this is still
      // allowed. In this case the backslash is just ignored.
      sb += String.fromCodePoint(c);
      continue;
    }

    // Parse up to five additional hex characters (so six in total)
    for (let j = 0; j < 5 && i < n; j++) {
      const next = isHex(inner.charCodeAt(i));
      if (next >= 0) {
        i++;
        hex = hex * 16 + next;
      } else {
        break;
      }
    }

    if (i < n) {
      if (isWhitespace(inner.charCodeAt(i))) {
        i++;
      }
    }

    if (hex === 0 || (hex >= 0xd800 && hex <= 0xdfff) || hex > 0x10ffff) {
      sb += String.fromCharCode(0xfffd);
      continue;
    }

    sb += String.fromCodePoint(hex);
  }

  return sb;
}
// generated from css_lexer.mts by tools/ts-build.mjs; edit that file
