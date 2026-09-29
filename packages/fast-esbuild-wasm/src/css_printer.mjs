// Port of internal/css_printer/css_printer.go. See CONVENTIONS.md.
//
// Output buffer (JS-only, like js_printer): Go appends UTF-8 bytes to p.css.
// Here the output is the same: a growable Uint8Array of UTF-8 bytes (p.css,
// p.cssLen), decoded once at the end with TextDecoder("utf-8"). Every
// position the printer compares (currentLineLength, oldLineStart,
// oldLineEnd, the line limit) is a byte length, as in Go, and the source map
// ChunkBuilder receives the byte buffer and its length.
//
// Strings are JS strings (UTF-16). Go's byte loops over ASCII become
// charCodeAt loops; "for i, c := range text" iterates code points with UTF-16
// indices. Where Go compares byte positions within the same string (e.g.
// "i+utf8.RuneLen(c) == n") UTF-16 positions give the same answer. The one
// place where Go mixes a byte index of a string with the output's line length
// (wrapping long strings in printQuotedWithQuote) tracks the byte index
// separately.
//
// printTokensOpts is passed as separate arguments (JS-only; Go passes the
// struct by value and only mutates its own copy).
import { GoPanic } from "./gopanic.mjs";
import { followSymbols, makeRef, ContainsUniqueKey, ShouldNotBeExternalInMetafile, importKindStringForMetafile } from "./ast.mjs";
                                                         
import { cssFeatureHas, InlineStyle } from "./compat_css.mjs";
import {
  LegalCommentsNone,
  LegalCommentsEndOfFile,
  LegalCommentsLinkedWithComment,
  LegalCommentsExternalWithoutComment,
  LegalCommentsInline,
  SourceMapNone,
} from "./config.mjs";
import {
  RAtCharset,
  RAtImport,
  RAtKeyframes,
  RKnownAt,
  RUnknownAt,
  RSelector,
  RQualified,
  RDeclaration,
  RBadDeclaration,
  RComment,
  RAtLayer,
  RAtMedia,
  RAtScope,
  MQType,
  MQNot,
  MQBinary,
  MQArbitraryTokens,
  MQPlainOrBoolean,
  MQRange,
  MQTypeOpNot,
  MQTypeOpOnly,
  MQBinaryOpAnd,
  MQBinaryOpOr,
  MQCmpNone,
  mqCmpString,
  SSHash,
  SSClass,
  SSAttribute,
  SSPseudoClass,
  SSPseudoClassWithSelectorList,
  pseudoClassKindString,
  WhitespaceBefore,
  WhitespaceAfter,
} from "./css_ast.mjs";
                                                                                                                               
import {
  TIdent,
  TSymbol,
  TFunction,
  TDimension,
  TAtKeyword,
  THash,
  TString,
  TURL,
  TUnterminatedString,
  TComma,
  TWhitespace,
  TOpenParen,
  TOpenBrace,
  TOpenBracket,
  TDelimAsterisk,
  TDelimAmpersand,
  wouldStartIdentifierWithoutEscapes,
  isNameContinue,
} from "./css_lexer.mjs";
import { escapeClosingTag, quoteForJSON, decodeGoString, goStringBytes } from "./helpers.mjs";
import { metafileFormatMaybeRemoveWhitespace } from "./config.mjs";
import { goToLower } from "./gostd.mjs";
import { ChunkBuilder } from "./sourcemap.mjs";

const quoteForURL = 0;


// JS-only: one spare output buffer is reused by the next print()
let spareOutputBuffer                    = null;
function takeOutputBuffer()             {
  const buf = spareOutputBuffer;
  if (buf !== null) {
    spareOutputBuffer = null;
    return buf;
  }
  return new Uint8Array(1 << 14);
}
function releaseOutputBuffer(buf            ) {
  if (buf.length <= 1 << 22) spareOutputBuffer = buf;
}

// JS-only: ASCII characters that may need an escape in printQuotedWithQuote
// (every other ASCII character always takes Go's "escapeNone" path)
const QUOTED_CANDIDATE = new Uint8Array(128);
QUOTED_CANDIDATE[0] = 1; // '\x00'
QUOTED_CANDIDATE[13] = 1; // '\r'
QUOTED_CANDIDATE[10] = 1; // '\n'
QUOTED_CANDIDATE[12] = 1; // '\f'
QUOTED_CANDIDATE[92] = 1; // '\\'
QUOTED_CANDIDATE[40] = 1; // '('
QUOTED_CANDIDATE[41] = 1; // ')'
QUOTED_CANDIDATE[32] = 1; // ' '
QUOTED_CANDIDATE[9] = 1; // '\t'
QUOTED_CANDIDATE[34] = 1; // '"'
QUOTED_CANDIDATE[39] = 1; // '\''
QUOTED_CANDIDATE[47] = 1; // '/'

// JS-only: css_lexer.IsNameContinue for ASCII
const NAME_CONTINUE_ASCII = new Uint8Array(128);
for (let c = 0; c < 128; c++) {
  if (isNameContinue(c)) NAME_CONTINUE_ASCII[c] = 1;
}

// printIndent() prints "  " n times; cache the concatenations
const indentCache = [""];
function indentString(n        )         {
  while (indentCache.length <= n) indentCache.push(indentCache[indentCache.length - 1] + "  ");
  return indentCache[n];
}

// Returns true if text[i:i+5] equals "style" ignoring ASCII case (Go's
// strings.EqualFold on a 5-byte slice can only match 5 ASCII characters)
function matchesStyleAt(text        , i        )          {
  const style = "style";
  for (let j = 0; j < 5; j++) {
    let a = text.charCodeAt(i + j);
    if (a >= 65 && a <= 90) a += 32;
    if (a !== style.charCodeAt(j)) return false;
  }
  return true;
}

// Go: utf8.DecodeRuneInString(text[i:]) (a lone surrogate is a raw byte of
// invalid UTF-8, see helpers.decodeGoString: U+FFFD)
function codePointAtIndex(text        , i        )         {
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

// Go: utf8.RuneLen(c) (the UTF-8 byte length; 3 for a lone surrogate, which
// Go's WTF-8 strings would also hold as 3 bytes)
function utf8RuneLen(c        )         {
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
}

class printer {
  ;                        
  ;                          
  ;                                     
  ;                        // Go: css []byte (the bytes before cssLen)
  ;                      
  ;                                           
  ;                                        
  ;                                     
  ;                                     // (only created when used)
  ;                            
  ;                          

  constructor(options         , symbols           , importRecords                ) {
    this.options = options;
    this.symbols = symbols;
    this.importRecords = importRecords;
    this.css = takeOutputBuffer();
    this.cssLen = 0;
    this.hasLegalComment = null;
    this.extractedLegalComments = [];
    this.jsonMetadataImports = [];
    this.builder =
      options.addSourceMappings || options.sourceMap !== SourceMapNone
        ? new ChunkBuilder(options.inputSourceMap, options.lineOffsetTables, options.asciiOnly)
        : null;
    this.oldLineStart = 0;
    this.oldLineEnd = 0;
  }

  // Go: p.builder.AddSourceMapping(loc, originalName, p.css)
  addSourceMapping(loc        , originalName        ) {
    this.builder .addSourceMapping(loc, originalName, this.css, this.cssLen);
  }

  growCSS(needed        )             {
    let size = this.css.length * 2;
    while (size < needed) size *= 2;
    const buf = new Uint8Array(size);
    buf.set(this.css.subarray(0, this.cssLen));
    this.css = buf;
    return buf;
  }

  // Go: p.css = append(p.css, c) for a single byte
  printByte(c        ) {
    let buf = this.css;
    if (this.cssLen + 1 > buf.length) buf = this.growCSS(this.cssLen + 1);
    buf[this.cssLen++] = c;
  }

  // Go: p.css = append(p.css, text[start:end]...) (UTF-8 encoded)
  printRange(text        , start        , end        ) {
    let len = this.cssLen;
    let buf = this.css;
    // (At most 3 bytes per UTF-16 code unit)
    if (len + (end - start) * 3 > buf.length) {
      buf = this.growCSS(len + (end - start) * 3);
    }
    let i = start;
    while (i < end) {
      const c = text.charCodeAt(i++);
      if (c < 0x80) {
        buf[len++] = c;
      } else if (c < 0x800) {
        buf[len++] = 0xc0 | (c >> 6);
        buf[len++] = 0x80 | (c & 63);
      } else {
        if (c >= 0xd800 && c <= 0xdbff && i < end) {
          const c2 = text.charCodeAt(i);
          if (c2 >= 0xdc00 && c2 <= 0xdfff) {
            i++;
            const r = ((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000;
            buf[len++] = 0xf0 | (r >> 18);
            buf[len++] = 0x80 | ((r >> 12) & 63);
            buf[len++] = 0x80 | ((r >> 6) & 63);
            buf[len++] = 0x80 | (r & 63);
            continue;
          }
        }
        if (c >= 0xdc80 && c <= 0xdcff) {
          // A raw byte of invalid UTF-8 (see helpers.decodeGoString)
          buf[len++] = c - 0xdc00;
          continue;
        }
        buf[len++] = 0xe0 | (c >> 12);
        buf[len++] = 0x80 | ((c >> 6) & 63);
        buf[len++] = 0x80 | (c & 63);
      }
    }
    this.cssLen = len;
  }

  // Go: utf8.EncodeRune + append
  printCodePoint(c        ) {
    let len = this.cssLen;
    let buf = this.css;
    if (len + 4 > buf.length) buf = this.growCSS(len + 4);
    if (c < 0x80) {
      buf[len++] = c;
    } else if (c < 0x800) {
      buf[len++] = 0xc0 | (c >> 6);
      buf[len++] = 0x80 | (c & 63);
    } else if (c < 0x10000) {
      buf[len++] = 0xe0 | (c >> 12);
      buf[len++] = 0x80 | ((c >> 6) & 63);
      buf[len++] = 0x80 | (c & 63);
    } else {
      buf[len++] = 0xf0 | (c >> 18);
      buf[len++] = 0x80 | ((c >> 12) & 63);
      buf[len++] = 0x80 | ((c >> 6) & 63);
      buf[len++] = 0x80 | (c & 63);
    }
    this.cssLen = len;
  }

  // The output as a JS string (releases the output buffer)
  cssText()         {
    const text = this.cssLen === 0 ? "" : decodeGoString(this.css.subarray(0, this.cssLen));
    releaseOutputBuffer(this.css);
    this.css = null       ;
    return text;
  }

  recordImportPathForMetafile(importRecordIndex        ) {
    const p = this;
    if (p.options.needsMetafile) {
      const record = p.importRecords[importRecordIndex];
      let external = "";
      if ((record.flags & ShouldNotBeExternalInMetafile) === 0) {
        external = metafileFormatMaybeRemoveWhitespace(p.options.metafileFormat, ',\n          "external": true');
      }
      p.jsonMetadataImports.push(
        metafileFormatMaybeRemoveWhitespace(p.options.metafileFormat, '\n        {\n          "path": ') +
          quoteForJSON(record.path.text, p.options.asciiOnly) +
          metafileFormatMaybeRemoveWhitespace(p.options.metafileFormat, ',\n          "kind": ') +
          quoteForJSON(importKindStringForMetafile(record.kind), p.options.asciiOnly) +
          external +
          metafileFormatMaybeRemoveWhitespace(p.options.metafileFormat, "\n        }"),
      );
    }
  }

  printRule(rule      , indent        , omitTrailingSemicolon         ) {
    const p = this;
    const data = rule.data;
    if (data instanceof RComment) {
      switch (p.options.legalComments) {
        case LegalCommentsNone:
          return;

        case LegalCommentsEndOfFile:
        case LegalCommentsLinkedWithComment:
        case LegalCommentsExternalWithoutComment:
          // Don't record the same legal comment more than once per file
          if (p.hasLegalComment === null) {
            p.hasLegalComment = new Set();
          } else if (p.hasLegalComment.has(data.text)) {
            return;
          }
          p.hasLegalComment.add(data.text);
          p.extractedLegalComments.push(data.text);
          return;
      }
    }

    if (p.options.lineLimit > 0) {
      p.printNewlinePastLineLimit(indent);
    }

    if (p.options.addSourceMappings) {
      let shouldPrintMapping = true;
      if (indent === 0 || p.options.minifyWhitespace) {
        if (data instanceof RSelector || data instanceof RQualified || data instanceof RBadDeclaration) {
          // These rules will begin with a potentially more accurate mapping. We
          // shouldn't print a mapping here if there's no indent in between this
          // mapping and the rule.
          shouldPrintMapping = false;
        }
      }
      if (shouldPrintMapping) {
        p.addSourceMapping(rule.loc, "");
      }
    }

    if (!p.options.minifyWhitespace) {
      p.printIndent(indent);
    }

    if (data instanceof RAtCharset) {
      const r = data;
      // It's not valid to remove the space in between these two tokens
      p.print("@charset ");

      // It's not valid to print the string with single quotes
      p.printQuotedWithQuote(r.encoding, 34 /* '"' */, 0);
      p.print(";");
    } else if (data instanceof RAtImport) {
      const r = data;
      if (p.options.minifyWhitespace) {
        p.print("@import");
      } else {
        p.print("@import ");
      }
      const record = p.importRecords[r.importRecordIndex];
      let flags = 0;
      if ((record.flags & ContainsUniqueKey) !== 0) {
        flags |= printQuotedNoWrap;
      }
      p.printQuoted(record.path.text, flags);
      p.recordImportPathForMetafile(r.importRecordIndex);
      const conditions = r.importConditions;
      if (conditions !== null) {
        let space = !p.options.minifyWhitespace;
        if (conditions.layers.length > 0) {
          if (space) {
            p.print(" ");
          }
          p.printTokens(conditions.layers, 0, 0, false);
          space = true;
        }
        if (conditions.supports.length > 0) {
          if (space) {
            p.print(" ");
          }
          p.printTokens(conditions.supports, 0, 0, false);
          space = true;
        }
        if (conditions.queries.length > 0) {
          if (space) {
            p.print(" ");
          }
          const queries = conditions.queries;
          for (let i = 0; i < queries.length; i++) {
            if (i > 0) {
              if (p.options.minifyWhitespace) {
                p.print(",");
              } else {
                p.print(", ");
              }
            }
            p.printMediaQuery(queries[i], 0);
          }
        }
      }
      p.print(";");
    } else if (data instanceof RAtKeyframes) {
      const r = data;
      p.print("@");
      p.printIdent(r.atToken, identNormal, mayNeedWhitespaceAfter);
      p.print(" ");
      p.printSymbol(r.name.loc, r.name.ref, identNormal, canDiscardWhitespaceAfter);
      if (!p.options.minifyWhitespace) {
        p.print(" ");
      }
      if (p.options.minifyWhitespace) {
        p.print("{");
      } else {
        p.print("{\n");
      }
      indent++;
      const blocks = r.blocks;
      for (let b = 0; b < blocks.length; b++) {
        const block = blocks[b];
        if (p.options.addSourceMappings) {
          p.addSourceMapping(block.loc, "");
        }
        if (!p.options.minifyWhitespace) {
          p.printIndent(indent);
        }
        const selectors = block.selectors;
        for (let i = 0; i < selectors.length; i++) {
          if (i > 0) {
            if (p.options.minifyWhitespace) {
              p.print(",");
            } else {
              p.print(", ");
            }
          }
          p.print(selectors[i]);
        }
        if (!p.options.minifyWhitespace) {
          p.print(" ");
        }
        p.printRuleBlock(block.rules, indent, block.closeBraceLoc);
        if (!p.options.minifyWhitespace) {
          p.print("\n");
        }
      }
      indent--;
      if (p.options.addSourceMappings && r.closeBraceLoc !== 0) {
        p.addSourceMapping(r.closeBraceLoc, "");
      }
      if (!p.options.minifyWhitespace) {
        p.printIndent(indent);
      }
      p.print("}");
    } else if (data instanceof RKnownAt) {
      const r = data;
      p.print("@");
      let whitespace = mayNeedWhitespaceAfter;
      if (r.prelude.length === 0) {
        whitespace = canDiscardWhitespaceAfter;
      }
      p.printIdent(r.atToken, identNormal, whitespace);
      if ((!p.options.minifyWhitespace && r.rules !== null) || r.prelude.length > 0) {
        p.print(" ");
      }
      p.printTokens(r.prelude, 0, 0, false);
      if (r.rules === null) {
        p.print(";");
      } else {
        if (!p.options.minifyWhitespace && r.prelude.length > 0) {
          p.print(" ");
        }
        p.printRuleBlock(r.rules, indent, r.closeBraceLoc);
      }
    } else if (data instanceof RUnknownAt) {
      const r = data;
      const blockLen = r.block === null ? 0 : r.block.length;
      p.print("@");
      let whitespace = mayNeedWhitespaceAfter;
      if (r.prelude.length === 0) {
        whitespace = canDiscardWhitespaceAfter;
      }
      p.printIdent(r.atToken, identNormal, whitespace);
      if ((!p.options.minifyWhitespace && blockLen !== 0) || r.prelude.length > 0) {
        p.print(" ");
      }
      p.printTokens(r.prelude, 0, 0, false);
      if (!p.options.minifyWhitespace && blockLen !== 0 && r.prelude.length > 0) {
        p.print(" ");
      }
      if (blockLen === 0) {
        p.print(";");
      } else {
        p.printTokens(r.block , 0, 0, false);
      }
    } else if (data instanceof RSelector) {
      const r = data;
      p.printComplexSelectors(r.selectors, indent, layoutMultiLine);
      if (!p.options.minifyWhitespace) {
        p.print(" ");
      }
      p.printRuleBlock(r.rules, indent, r.closeBraceLoc);
    } else if (data instanceof RQualified) {
      const r = data;
      const hasWhitespaceAfter = p.printTokens(r.prelude, 0, 0, false);
      if (!hasWhitespaceAfter && !p.options.minifyWhitespace) {
        p.print(" ");
      }
      p.printRuleBlock(r.rules, indent, r.closeBraceLoc);
    } else if (data instanceof RDeclaration) {
      const r = data;
      p.printIdent(r.keyText, identNormal, canDiscardWhitespaceAfter);
      p.print(":");
      const hasWhitespaceAfter = p.printTokens(r.value, indent, 0, true);
      if (r.important) {
        if (!hasWhitespaceAfter && !p.options.minifyWhitespace && r.value.length > 0) {
          p.print(" ");
        }
        p.print("!important");
      }
      if (!omitTrailingSemicolon) {
        p.print(";");
      }
    } else if (data instanceof RBadDeclaration) {
      const r = data;
      p.printTokens(r.tokens, 0, 0, false);
      if (!omitTrailingSemicolon) {
        p.print(";");
      }
    } else if (data instanceof RComment) {
      p.printIndentedComment(indent, data.text);
    } else if (data instanceof RAtLayer) {
      const r = data;
      p.print("@layer");
      const names = r.names;
      for (let i = 0; i < names.length; i++) {
        if (i === 0) {
          p.print(" ");
        } else if (!p.options.minifyWhitespace) {
          p.print(", ");
        } else {
          p.print(",");
        }
        p.print(names[i].join("."));
      }
      if (r.rules === null) {
        p.print(";");
      } else {
        if (!p.options.minifyWhitespace) {
          p.print(" ");
        }
        p.printRuleBlock(r.rules, indent, r.closeBraceLoc);
      }
    } else if (data instanceof RAtMedia) {
      const r = data;
      p.print("@media");
      let flags = 0;
      if (p.options.minifyWhitespace) {
        flags = mqAfterIdentifier;
      } else {
        p.print(" ");
      }
      const queries = r.queries;
      for (let i = 0; i < queries.length; i++) {
        if (i > 0) {
          if (p.options.minifyWhitespace) {
            p.print(",");
          } else {
            p.print(", ");
          }
        }
        p.printMediaQuery(queries[i], flags);
        flags = 0;
      }
      if (!p.options.minifyWhitespace && queries.length > 0) {
        p.print(" ");
      }
      p.printRuleBlock(r.rules, indent, r.closeBraceLoc);
    } else if (data instanceof RAtScope) {
      const r = data;
      p.print("@scope");
      if (r.start.length > 0) {
        if (p.options.minifyWhitespace) {
          p.print("(");
        } else {
          p.print(" (");
        }
        p.printComplexSelectors(r.start, indent, layoutSingleLine);
        p.print(")");
      }
      if (r.end.length > 0) {
        if (p.options.minifyWhitespace) {
          p.print("to (");
        } else {
          p.print(" to (");
        }
        p.printComplexSelectors(r.end, indent, layoutSingleLine);
        p.print(")");
      }
      if (!p.options.minifyWhitespace) {
        p.print(" ");
      }
      p.printRuleBlock(r.rules, indent, r.closeBraceLoc);
    } else {
      // Go: panic("Internal error")
      throw new GoPanic("Internal error");
    }

    if (!p.options.minifyWhitespace) {
      p.print("\n");
    }
  }

  printMediaQuery(query            , flags        ) {
    const p = this;
    const data = query.data;
    if (data instanceof MQArbitraryTokens) {
      if ((flags & mqAfterIdentifier) !== 0) {
        p.print(" ");
      }
      p.printTokens(data.tokens, 0, 0, false);
      return;
    }

    if (data instanceof MQType) {
      const q = data;
      if ((flags & mqAfterIdentifier) !== 0) {
        p.print(" ");
      }
      if (p.options.addSourceMappings) {
        p.addSourceMapping(query.loc, "");
      }
      switch (q.op) {
        case MQTypeOpNot:
          p.print("not ");
          break;
        case MQTypeOpOnly:
          p.print("only ");
          break;
      }
      p.printIdent(q.type, identNormal, 0);
      if (q.andOrNull !== null && q.andOrNull.data !== null) {
        p.print(" and ");
        let flags = 0;
        const binary = q.andOrNull.data;
        if (binary instanceof MQBinary && binary.op === MQBinaryOpOr) {
          flags = mqNeedsParens;
        }
        p.printMediaQuery(q.andOrNull, flags);
      }
    } else if (data instanceof MQNot) {
      const q = data;
      if ((flags & mqNeedsParens) !== 0) {
        p.print("(");
      } else if ((flags & mqAfterIdentifier) !== 0) {
        p.print(" ");
      }
      if (p.options.addSourceMappings) {
        p.addSourceMapping(query.loc, "");
      }
      p.print("not ");
      p.printMediaQuery(q.inner, mqNeedsParens);
      if ((flags & mqNeedsParens) !== 0) {
        p.print(")");
      }
    } else if (data instanceof MQBinary) {
      const q = data;
      if ((flags & mqNeedsParens) !== 0) {
        p.print("(");
      }
      const terms = q.terms;
      for (let i = 0; i < terms.length; i++) {
        if (i > 0) {
          if (!p.options.minifyWhitespace) {
            p.print(" ");
          }
          switch (q.op) {
            case MQBinaryOpAnd:
              p.print("and ");
              break;
            case MQBinaryOpOr:
              p.print("or ");
              break;
          }
        }
        p.printMediaQuery(terms[i], mqNeedsParens);
      }
      if ((flags & mqNeedsParens) !== 0) {
        p.print(")");
      }
    } else if (data instanceof MQPlainOrBoolean) {
      const q = data;
      p.print("(");
      if (p.options.addSourceMappings) {
        p.addSourceMapping(query.loc, "");
      }
      p.printIdent(q.name, identNormal, 0);
      if (q.valueOrNil !== null) {
        if (p.options.minifyWhitespace) {
          p.print(":");
        } else {
          p.print(": ");
        }
        p.printTokens(q.valueOrNil, 0, 0, false);
      }
      p.print(")");
    } else if (data instanceof MQRange) {
      const q = data;
      let space = " ";
      if (p.options.minifyWhitespace) {
        space = "";
      }
      p.print("(");
      if (q.beforeCmp !== MQCmpNone) {
        p.printTokens(q.before, 0, 0, false);
        p.print(space);
        p.print(mqCmpString(q.beforeCmp));
        p.print(space);
      }
      if (p.options.addSourceMappings) {
        p.addSourceMapping(q.nameLoc, "");
      }
      p.printIdent(q.name, identNormal, 0);
      if (q.afterCmp !== MQCmpNone) {
        p.print(space);
        p.print(mqCmpString(q.afterCmp));
        p.print(space);
        p.printTokens(q.after, 0, 0, false);
      }
      p.print(")");
    } else {
      // Go: panic("Internal error")
      throw new GoPanic("Internal error");
    }
  }

  printIndentedComment(indent        , text        ) {
    const p = this;
    // Avoid generating a comment containing the character sequence "</style"
    if (!cssFeatureHas(p.options.unsupportedFeatures, InlineStyle)) {
      text = escapeClosingTag(text, "/style");
    }

    // Re-indent multi-line comments
    let start = 0;
    for (;;) {
      const newline = text.indexOf("\n", start);
      if (newline === -1) {
        break;
      }
      p.printRange(text, start, newline + 1);
      if (!p.options.minifyWhitespace) {
        p.printIndent(indent);
      }
      start = newline + 1;
    }
    p.printRange(text, start, text.length);
  }

  printRuleBlock(rules        , indent        , closeBraceLoc        ) {
    const p = this;
    if (p.options.minifyWhitespace) {
      p.print("{");
    } else {
      p.print("{\n");
    }

    for (let i = 0; i < rules.length; i++) {
      const omitTrailingSemicolon = p.options.minifyWhitespace && i + 1 === rules.length;
      p.printRule(rules[i], indent + 1, omitTrailingSemicolon);
    }

    if (p.options.addSourceMappings && closeBraceLoc !== 0) {
      p.addSourceMapping(closeBraceLoc, "");
    }
    if (!p.options.minifyWhitespace) {
      p.printIndent(indent);
    }
    p.print("}");
  }

  printComplexSelectors(selectors                   , indent        , layout        ) {
    const p = this;
    for (let i = 0; i < selectors.length; i++) {
      const complex = selectors[i];
      if (i > 0) {
        if (p.options.minifyWhitespace) {
          p.print(",");
          if (p.options.lineLimit > 0) {
            p.printNewlinePastLineLimit(indent);
          }
        } else if (layout === layoutMultiLine) {
          p.print(",\n");
          p.printIndent(indent);
        } else {
          p.print(", ");
        }
      }

      const compounds = complex.selectors;
      for (let j = 0; j < compounds.length; j++) {
        p.printCompoundSelector(compounds[j], j === 0, indent);
      }
    }
  }

  printCompoundSelector(sel                  , isFirst         , indent        ) {
    const p = this;
    if (!isFirst && sel.combinator.byte === 0) {
      // A space is required in between compound selectors if there is no
      // combinator in the middle. It's fine to convert "a + b" into "a+b"
      // but not to convert "a b" into "ab".
      if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit(indent)) {
        p.print(" ");
      }
    }

    if (sel.combinator.byte !== 0) {
      if (!isFirst && !p.options.minifyWhitespace) {
        p.print(" ");
      }

      if (p.options.addSourceMappings) {
        p.addSourceMapping(sel.combinator.loc, "");
      }
      p.printByte(sel.combinator.byte);

      if ((p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit(indent)) && !p.options.minifyWhitespace) {
        p.print(" ");
      }
    }

    if (sel.typeSelector !== null) {
      let whitespace = mayNeedWhitespaceAfter;
      if (sel.subclassSelectors.length > 0) {
        // There is no chance of whitespace before a subclass selector or pseudo
        // class selector
        whitespace = canDiscardWhitespaceAfter;
      }
      p.printNamespacedName(sel.typeSelector, whitespace);
    }

    const nestingSelectorLocs = sel.nestingSelectorLocs;
    for (let i = 0; i < nestingSelectorLocs.length; i++) {
      if (p.options.addSourceMappings) {
        p.addSourceMapping(nestingSelectorLocs[i], "");
      }

      p.print("&");
    }

    const subclassSelectors = sel.subclassSelectors;
    for (let i = 0; i < subclassSelectors.length; i++) {
      const ss = subclassSelectors[i];
      let whitespace = mayNeedWhitespaceAfter;

      // There is no chance of whitespace between subclass selectors
      if (i + 1 < subclassSelectors.length) {
        whitespace = canDiscardWhitespaceAfter;
      }

      if (p.options.addSourceMappings) {
        p.addSourceMapping(ss.range.loc, "");
      }

      const s = ss.data;
      if (s instanceof SSHash) {
        p.print("#");

        // This deliberately does not use identHash. From the specification:
        // "In <id-selector>, the <hash-token>'s value must be an identifier."
        p.printSymbol(s.name.loc, s.name.ref, identNormal, whitespace);
      } else if (s instanceof SSClass) {
        p.print(".");
        p.printSymbol(s.name.loc, s.name.ref, identNormal, whitespace);
      } else if (s instanceof SSAttribute) {
        p.print("[");
        p.printNamespacedName(s.namespacedName, canDiscardWhitespaceAfter);
        if (s.matcherOp !== "") {
          p.print(s.matcherOp);
          let printAsIdent = false;

          // Print the value as an identifier if it's possible
          const value = s.matcherValue;
          if (wouldStartIdentifierWithoutEscapes(value)) {
            printAsIdent = true;
            for (let k = 0; k < value.length; ) {
              const c = codePointAtIndex(value, k);
              if (!isNameContinue(c)) {
                printAsIdent = false;
                break;
              }
              k += c > 0xffff ? 2 : 1;
            }
          }

          if (printAsIdent) {
            p.printIdent(value, identNormal, canDiscardWhitespaceAfter);
          } else {
            p.printQuoted(value, 0);
          }
        }
        if (s.matcherModifier !== 0) {
          p.print(" ");
          p.printCodePoint(s.matcherModifier);
        }
        p.print("]");
      } else if (s instanceof SSPseudoClass) {
        p.printPseudoClassSelector(s, whitespace);
      } else if (s instanceof SSPseudoClassWithSelectorList) {
        p.print(":");
        p.print(pseudoClassKindString(s.kind));
        p.print("(");
        if (s.index.a !== "" || s.index.b !== "") {
          p.printNthIndex(s.index);
          if (s.selectors.length > 0) {
            if (p.options.minifyWhitespace && s.selectors[0].selectors[0].typeSelector === null) {
              p.print(" of");
            } else {
              p.print(" of ");
            }
          }
        }
        p.printComplexSelectors(s.selectors, indent, layoutSingleLine);
        p.print(")");
      } else {
        // Go: panic("Internal error")
        throw new GoPanic("Internal error");
      }
    }
  }

  printNthIndex(index          ) {
    const p = this;
    if (index.a !== "") {
      if (index.a === "-1") {
        p.print("-");
      } else if (index.a !== "1") {
        p.print(index.a);
      }
      p.print("n");
      if (index.b !== "") {
        if (!index.b.startsWith("-")) {
          p.print("+");
        }
        p.print(index.b);
      }
    } else if (index.b !== "") {
      p.print(index.b);
    }
  }

  printNamespacedName(nsName                , whitespace        ) {
    const p = this;
    const prefix = nsName.namespacePrefix;
    if (prefix !== null) {
      if (p.options.addSourceMappings) {
        p.addSourceMapping(prefix.range.loc, "");
      }

      switch (prefix.kind) {
        case TIdent:
          p.printIdent(prefix.text, identNormal, canDiscardWhitespaceAfter);
          break;
        case TDelimAsterisk:
          p.print("*");
          break;
        default:
          // Go: panic("Internal error")
          throw new GoPanic("Internal error");
      }

      p.print("|");
    }

    if (p.options.addSourceMappings) {
      p.addSourceMapping(nsName.name.range.loc, "");
    }

    switch (nsName.name.kind) {
      case TIdent:
        p.printIdent(nsName.name.text, identNormal, whitespace);
        break;
      case TDelimAsterisk:
        p.print("*");
        break;
      case TDelimAmpersand:
        p.print("&");
        break;
      default:
        // Go: panic("Internal error")
        throw new GoPanic("Internal error");
    }
  }

  printPseudoClassSelector(pseudo               , whitespace        ) {
    const p = this;
    if (pseudo.isElement) {
      p.print("::");
    } else {
      p.print(":");
    }

    // This checks for "nil" so we can distinguish ":is()" from ":is"
    if (pseudo.args !== null) {
      p.printIdent(pseudo.name, identNormal, canDiscardWhitespaceAfter);
      p.print("(");
      p.printTokens(pseudo.args, 0, 0, false);
      p.print(")");
    } else {
      p.printIdent(pseudo.name, identNormal, whitespace);
    }
  }

  // Go: p.css = append(p.css, text...) (UTF-8 encoded)
  print(text        ) {
    const n = text.length;
    let len = this.cssLen;
    let buf = this.css;
    if (len + n > buf.length) {
      buf = this.growCSS(len + n);
    }
    for (let i = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c >= 0x80) {
        this.cssLen = len;
        this.printRange(text, i, n);
        return;
      }
      buf[len++] = c;
    }
    this.cssLen = len;
  }

  printQuoted(text        , flags        ) {
    this.printQuotedWithQuote(text, bestQuoteCharForString(text, false), flags);
  }

  // "remainingText" is text[i:] in Go: passed here as the text, the index of
  // "c" in it and the UTF-16 width of "c"
  printWithEscape(c        , escape        , text        , i        , width        , mayNeedWhitespaceAfter         ) {
    const p = this;
    if (escape === escapeBackslash && ((c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70))) {
      // Hexadecimal characters cannot use a plain backslash escape
      escape = escapeHex;
    }

    switch (escape) {
      case escapeNone:
        p.printCodePoint(c);
        break;

      case escapeBackslash:
        p.printByte(92 /* '\\' */);
        p.printCodePoint(c);
        break;

      case escapeHex: {
        // Go: fmt.Sprintf("\\%x", c)
        const hex = c.toString(16);
        p.printByte(92 /* '\\' */);
        p.print(hex);

        // Make sure the next character is not interpreted as part of the escape sequence
        if (1 + hex.length < 1 + 6) {
          // (Go reads remainingText[utf8.RuneLen(c)]: a byte, which for a
          // raw byte of invalid UTF-8 (see helpers.decodeGoString) is not
          // the next character. 8 UTF-16 units hold more than 4 bytes.)
          const remaining = goStringBytes(text.slice(i, i + 8));
          const next = utf8RuneLen(c);
          if (next < remaining.length) {
            c = remaining[next];
            if (c === 32 || c === 9 || (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70)) {
              p.printByte(32);
            }
          } else if (mayNeedWhitespaceAfter) {
            // If the last character is a hexadecimal escape, print a space afterwards
            // for the escape sequence to consume. That way we're sure it won't
            // accidentally consume a semantically significant space afterward.
            p.printByte(32);
          }
        }
        break;
      }
    }
  }

  // Note: This function is hot in profiles
  printQuotedWithQuote(text        , quote        , flags        ) {
    const p = this;
    if (quote !== quoteForURL) {
      p.printByte(quote);
    }

    const n = text.length;
    let i = 0;
    let runStart = 0;

    // Only compute the line length if necessary
    let startLineLength = 0;
    let wrapLongLines = false;
    const lineLimit = p.options.lineLimit;
    if (lineLimit > 0 && quote !== quoteForURL && (flags & printQuotedNoWrap) === 0) {
      startLineLength = p.currentLineLength();
      if (startLineLength > lineLimit) {
        startLineLength = lineLimit;
      }
      wrapLongLines = true;
    }

    // Go's "i" is a byte index into the text: "byteI" tracks it (it only
    // matters for wrapping long lines)
    let byteI = 0;
    const asciiOnly = p.options.asciiOnly;

    while (i < n) {
      // Wrap long lines that are over the limit using escaped newlines
      if (wrapLongLines && startLineLength + byteI >= lineLimit) {
        if (runStart < i) {
          p.printRange(text, runStart, i);
          runStart = i;
        }
        p.print("\\\n");
        startLineLength -= lineLimit;
      }

      let c = text.charCodeAt(i);

      // JS-only fast path: ASCII characters that never need an escape
      if (c < 0x80 && QUOTED_CANDIDATE[c] === 0) {
        i++;
        byteI++;
        continue;
      }

      let width = 1;
      let byteWidth = 0;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < n && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        c = ((c - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00) + 0x10000;
        width = 2;
      } else if (c >= 0xd800 && c <= 0xdfff) {
        // A raw byte of invalid UTF-8 (see helpers.decodeGoString): Go's
        // "range" gives utf8.RuneError for it, one byte wide
        c = 0xfffd;
        byteWidth = 1;
      }
      let escape = escapeNone;

      switch (c) {
        case 0:
        case 13:
        case 10:
        case 12:
          // Use a hexadecimal escape for characters that would be invalid escapes
          escape = escapeHex;
          break;

        case 92:
        case quote:
          escape = escapeBackslash;
          break;

        case 40:
        case 41:
        case 32:
        case 9:
        case 34:
        case 39:
          // These characters must be escaped in URL tokens
          if (quote === quoteForURL) {
            escape = escapeBackslash;
          }
          break;

        case 47:
          // Avoid generating the sequence "</style" in CSS code
          if (
            !cssFeatureHas(p.options.unsupportedFeatures, InlineStyle) &&
            i >= 1 &&
            text.charCodeAt(i - 1) === 60 /* '<' */ &&
            i + 6 <= n &&
            matchesStyleAt(text, i + 1)
          ) {
            escape = escapeBackslash;
          }
          break;

        default:
          if ((asciiOnly && c >= 0x80) || c === 0xfeff) {
            escape = escapeHex;
          }
      }

      if (escape !== escapeNone) {
        if (runStart < i) {
          p.printRange(text, runStart, i);
        }
        p.printWithEscape(c, escape, text, i, width, false);
        runStart = i + width;
      }
      i += width;
      byteI += byteWidth > 0 ? byteWidth : utf8RuneLen(c);
    }

    if (runStart < n) {
      p.printRange(text, runStart, n);
    }

    if (quote !== quoteForURL) {
      p.printByte(quote);
    }
  }

  currentLineLength()         {
    const p = this;
    const css = p.css;
    const n = p.cssLen;
    const stop = p.oldLineEnd;

    // Update "oldLineStart" to the start of the current line
    for (let i = n; i > stop; i--) {
      const c = css[i - 1];
      if (c === 13 || c === 10) {
        p.oldLineStart = i;
        break;
      }
    }

    p.oldLineEnd = n;
    return n - p.oldLineStart;
  }

  printNewlinePastLineLimit(indent        )          {
    const p = this;
    if (p.currentLineLength() < p.options.lineLimit) {
      return false;
    }
    p.print("\n");
    if (!p.options.minifyWhitespace) {
      p.printIndent(indent);
    }
    return true;
  }

  // Note: This function is hot in profiles
  printIdent(text        , mode        , whitespace        ) {
    const p = this;
    const n = text.length;

    // Special escape behavior for the first character
    let initialEscape = escapeNone;
    switch (mode) {
      case identNormal:
        if (!wouldStartIdentifierWithoutEscapes(text)) {
          initialEscape = escapeBackslash;
        }
        break;
      case identDimensionUnit:
      case identDimensionUnitAfterExponent:
        if (!wouldStartIdentifierWithoutEscapes(text)) {
          initialEscape = escapeBackslash;
        } else if (n > 0) {
          const c = text.charCodeAt(0);
          if (c >= 48 && c <= 57) {
            // Unit: "2x"
            initialEscape = escapeHex;
          } else if ((c === 101 || c === 69) && mode !== identDimensionUnitAfterExponent) {
            // (Go's text[1] and text[2] are bytes: an ASCII test on the code unit is the same)
            if (n >= 2 && text.charCodeAt(1) >= 48 && text.charCodeAt(1) <= 57) {
              // Unit: "e2x"
              initialEscape = escapeHex;
            } else if (n >= 3 && text.charCodeAt(1) === 45 && text.charCodeAt(2) >= 48 && text.charCodeAt(2) <= 57) {
              // Unit: "e-2x"
              initialEscape = escapeHex;
            }
          }
        }
        break;
    }

    // Fast path: the identifier does not need to be escaped. This fast path is
    // important for performance. For example, doing this sped up end-to-end
    // parsing and printing of a large CSS file from 84ms to 66ms (around 25%
    // faster).
    if (initialEscape === escapeNone) {
      let slowPath = false;
      for (let i = 0; i < n; i++) {
        const c = text.charCodeAt(i);
        if (c >= 0x80 || NAME_CONTINUE_ASCII[c] === 0) {
          slowPath = true;
          break;
        }
      }
      if (!slowPath) {
        // (All ASCII)
        let len = p.cssLen;
        let buf = p.css;
        if (len + n > buf.length) buf = p.growCSS(len + n);
        for (let i = 0; i < n; i++) buf[len++] = text.charCodeAt(i);
        p.cssLen = len;
        return;
      }
    }

    // Slow path: the identifier needs to be escaped. (Go's "i" and "n" are
    // byte offsets: "byteI" and "byteN". Go adds utf8.RuneLen(c), 3 for the
    // utf8.RuneError of a raw byte of invalid UTF-8, which is one byte.)
    const asciiOnly = p.options.asciiOnly;
    const byteN = utf8Length(text);
    let byteI = 0;
    for (let i = 0; i < n; ) {
      const c = codePointAtIndex(text, i);
      const width = c > 0xffff ? 2 : 1;
      const byteWidth = c === 0xfffd && text.charCodeAt(i) !== 0xfffd ? 1 : utf8RuneLen(c);
      let escape = escapeNone;

      if (asciiOnly && c >= 0x80) {
        escape = escapeHex;
      } else if (c === 13 || c === 10 || c === 12 || c === 0xfeff) {
        // Use a hexadecimal escape for characters that would be invalid escapes
        escape = escapeHex;
      } else {
        // Escape non-identifier characters
        if (!isNameContinue(c)) {
          escape = escapeBackslash;
        }

        // Special escape behavior for the first character
        if (i === 0 && initialEscape !== escapeNone) {
          escape = initialEscape;
        }
      }

      // If the last character is a hexadecimal escape, print a space afterwards
      // for the escape sequence to consume. That way we're sure it won't
      // accidentally consume a semantically significant space afterward.
      const mayNeedWhitespaceAfter_ = whitespace === mayNeedWhitespaceAfter && escape !== escapeNone && byteI + utf8RuneLen(c) === byteN;
      p.printWithEscape(c, escape, text, i, width, mayNeedWhitespaceAfter_);
      i += width;
      byteI += byteWidth;
    }
  }

  printSymbol(loc        , ref        , mode        , whitespace        ) {
    const p = this;
    ref = followSymbols(p.symbols, ref);
    let originalName = p.symbols.get(ref).originalName;
    const localNames = p.options.localNames;
    let name = localNames !== null ? localNames.get(ref) : undefined;
    if (name === undefined) {
      name = originalName;
    }
    if (p.options.addSourceMappings) {
      if (originalName === name) {
        originalName = "";
      }
      p.addSourceMapping(loc, originalName);
    }
    p.printIdent(name, mode, whitespace);
  }

  printIndent(indent        ) {
    const p = this;
    let n = indent;
    if (p.options.lineLimit > 0 && n * 2 >= p.options.lineLimit) {
      n = Math.floor(p.options.lineLimit / 2);
    }
    if (n > 0) {
      p.print(indentString(n));
    }
  }

  // Go: printTokens(tokens []css_ast.Token, opts printTokensOpts) with the
  // struct's fields (indent, multiLineCommaPeriod, isDeclaration) as arguments
  printTokens(tokens         , indent        , multiLineCommaPeriod        , isDeclaration         )          {
    const p = this;
    const n = tokens.length;
    let hasWhitespaceAfter = n > 0 && (tokens[0].whitespace & WhitespaceBefore) !== 0;

    // Pretty-print long comma-separated declarations of 3 or more items
    let commaPeriod = multiLineCommaPeriod;
    if (!p.options.minifyWhitespace && isDeclaration) {
      let commaCount = 0;
      for (let i = 0; i < n; i++) {
        const t = tokens[i];
        if (t.kind === TComma) {
          commaCount++;
          if (commaCount >= 2) {
            commaPeriod = 1;
            break;
          }
        }
        if (t.kind === TFunction && functionMultiLineCommaPeriod(t) > 0) {
          commaPeriod = 1;
          break;
        }
      }
    }

    let commaCount = 0;
    for (let i = 0; i < n; i++) {
      const t = tokens[i];
      if (t.kind === TComma) {
        commaCount++;
      }
      if (t.kind === TWhitespace) {
        hasWhitespaceAfter = true;
        continue;
      }
      if (hasWhitespaceAfter) {
        if (commaPeriod > 0 && (i === 0 || (tokens[i - 1].kind === TComma && commaCount % commaPeriod === 0))) {
          p.print("\n");
          p.printIndent(indent + 1);
        } else if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit(indent + 1)) {
          p.print(" ");
        }
      }
      hasWhitespaceAfter = (t.whitespace & WhitespaceAfter) !== 0 || (i + 1 < n && (tokens[i + 1].whitespace & WhitespaceBefore) !== 0);

      let whitespace = mayNeedWhitespaceAfter;
      if (!hasWhitespaceAfter) {
        whitespace = canDiscardWhitespaceAfter;
      }

      if (p.options.addSourceMappings) {
        p.addSourceMapping(t.loc, "");
      }

      switch (t.kind) {
        case TIdent:
          p.printIdent(t.text, identNormal, whitespace);
          break;

        case TSymbol: {
          const ref = makeRef(p.options.inputSourceIndex, t.payloadIndex);
          p.printSymbol(t.loc, ref, identNormal, whitespace);
          break;
        }

        case TFunction:
          p.printIdent(t.text, identNormal, whitespace);
          p.print("(");
          break;

        case TDimension: {
          const value = t.dimensionValue();
          p.print(value);
          let mode = identDimensionUnit;
          if (value.indexOf("e") >= 0 || value.indexOf("E") >= 0) {
            mode = identDimensionUnitAfterExponent;
          }
          p.printIdent(t.dimensionUnit(), mode, whitespace);
          break;
        }

        case TAtKeyword:
          p.print("@");
          p.printIdent(t.text, identNormal, whitespace);
          break;

        case THash:
          p.print("#");
          p.printIdent(t.text, identHash, whitespace);
          break;

        case TString:
          p.printQuoted(t.text, 0);
          break;

        case TURL: {
          const record = p.importRecords[t.payloadIndex];
          const text = record.path.text;
          let tryToAvoidQuote = true;
          let flags = 0;
          if ((record.flags & ContainsUniqueKey) !== 0) {
            flags |= printQuotedNoWrap;

            // If the caller will be substituting a path here later using string
            // substitution, then we can't be sure that it will form a valid URL
            // token when unquoted (e.g. it may contain spaces). So we need to
            // quote the unique key here just in case. For more info see this
            // issue: https://github.com/evanw/esbuild/issues/3410
            tryToAvoidQuote = false;
          } else if (p.options.lineLimit > 0 && p.currentLineLength() + utf8Length(text) >= p.options.lineLimit) {
            tryToAvoidQuote = false;
          }
          p.print("url(");
          p.printQuotedWithQuote(text, bestQuoteCharForString(text, tryToAvoidQuote), flags);
          p.print(")");
          p.recordImportPathForMetafile(t.payloadIndex);
          break;
        }

        case TUnterminatedString:
          // We must end this with a newline so that this string stays unterminated
          p.print(t.text);
          p.print("\n");
          if (!p.options.minifyWhitespace) {
            p.printIndent(indent);
          }
          hasWhitespaceAfter = false;
          break;

        default:
          p.print(t.text);
      }

      if (t.children !== null) {
        let childCommaPeriod = 0;

        if (commaPeriod > 0 && isDeclaration) {
          childCommaPeriod = functionMultiLineCommaPeriod(t);
        }

        if (childCommaPeriod > 0) {
          indent++;
          if (!p.options.minifyWhitespace) {
            p.print("\n");
            p.printIndent(indent + 1);
          }
        }

        p.printTokens(t.children, indent, childCommaPeriod, false);

        if (childCommaPeriod > 0) {
          indent--;
        }

        switch (t.kind) {
          case TFunction:
            p.print(")");
            break;

          case TOpenParen:
            p.print(")");
            break;

          case TOpenBrace:
            p.print("}");
            break;

          case TOpenBracket:
            p.print("]");
            break;
        }
      }
    }
    if (hasWhitespaceAfter) {
      p.print(" ");
    }
    return hasWhitespaceAfter;
  }
}

// Go: len(text) for a string (its UTF-8 byte length)
function utf8Length(text        )         {
  const n = text.length;
  let len = n;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x80) {
      if (c < 0x800) {
        len += 1;
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < n && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        // A surrogate pair: 4 bytes for 2 code units
        len += 2;
        i++;
      } else if (c >= 0xdc80 && c <= 0xdcff) {
        // (a raw byte of invalid UTF-8: one byte)
      } else {
        len += 2;
      }
    }
  }
  return len;
}

export class Options {
  // This will be present if the input file had a source map. In that case we
  // want to map all the way back to the original input file(s).
  ;                           

  // If we're writing out a source map, this table of line start indices lets
  // us do binary search on to figure out what line a given AST node came from
  ;                             

  // Local symbol renaming results go here
  ;                                              

  ;                         
  ;                                
  ;                                    // compat.CSSFeature
  ;                                 
  ;                          
  ;                         
  ;                                  
  ;                             
  ;                              
  ;                              
  constructor(
    inputSourceMap      = null,
    lineOffsetTables      = null,
    localNames                             = null,
    lineLimit = 0,
    inputSourceIndex = 0,
    unsupportedFeatures = 0,
    minifyWhitespace = false,
    asciiOnly = false,
    sourceMap = SourceMapNone,
    addSourceMappings = false,
    legalComments = LegalCommentsInline,
    needsMetafile = false,
    metafileFormat = 0,
  ) {
    this.inputSourceMap = inputSourceMap;
    this.lineOffsetTables = lineOffsetTables;
    this.localNames = localNames;
    this.lineLimit = lineLimit;
    this.inputSourceIndex = inputSourceIndex;
    this.unsupportedFeatures = unsupportedFeatures;
    this.minifyWhitespace = minifyWhitespace;
    this.asciiOnly = asciiOnly;
    this.sourceMap = sourceMap;
    this.addSourceMappings = addSourceMappings;
    this.legalComments = legalComments;
    this.needsMetafile = needsMetafile;
    this.metafileFormat = metafileFormat;
  }
}

export class PrintResult {
  ;                    // JS string (Go: []byte)
  ;                                        
  ;                                     

  // This source map chunk just contains the VLQ-encoded offsets for the "CSS"
  // field above. It's not a full source map. The bundler will be joining many
  // source map chunks together to form the final source map.
  // (A sourcemap.Chunk, or null where Go leaves the zero value because
  // options.SourceMap is SourceMapNone.)
  ;                           

  // JS-only: Go's len(CSS), the UTF-8 byte length of "css"
  ;                      
  constructor(css = "", extractedLegalComments           = [], jsonMetadataImports           = [], sourceMapChunk      = null, cssLen = 0) {
    this.css = css;
    this.extractedLegalComments = extractedLegalComments;
    this.jsonMetadataImports = jsonMetadataImports;
    this.sourceMapChunk = sourceMapChunk;
    this.cssLen = cssLen;
  }
}

// Go: Print(tree css_ast.AST, symbols ast.SymbolMap, options Options) PrintResult
export function print(tree     , symbols           , options         )              {
  const p = new printer(options, symbols, tree.importRecords);
  const rules = tree.rules;
  let css        ;
  let cssLen        ;
  let sourceMapChunk      = null;
  try {
    for (let i = 0; i < rules.length; i++) {
      p.printRule(rules[i], 0, false);
    }
    if (options.sourceMap !== SourceMapNone) {
      // This is expensive. Only do this if it's necessary. For example, skipping
      // this if it's not needed sped up end-to-end parsing and printing of a
      // large CSS file from 66ms to 52ms (around 25% faster).
      sourceMapChunk = p.builder .generateChunk(p.css, p.cssLen);
    }
  } catch (e) {
    // (Keep the output buffer for the next print)
    releaseOutputBuffer(p.css);
    throw e;
  }
  cssLen = p.cssLen;
  css = p.cssText();
  return new PrintResult(css, p.extractedLegalComments, p.jsonMetadataImports, sourceMapChunk, cssLen);
}

// mqFlags
const mqNeedsParens = 1 << 0;
const mqAfterIdentifier = 1 << 1;

// selectorLayout
const layoutMultiLine = 0;
const layoutSingleLine = 1;

export function bestQuoteCharForString(text        , forURL         )         {
  let forURLCost = 0;
  let singleCost = 2;
  let doubleCost = 2;

  // (Only ASCII characters count, so a code unit loop is the same as Go's
  // loop over the runes)
  for (let i = 0, n = text.length; i < n; i++) {
    switch (text.charCodeAt(i)) {
      case 39: // '\''
        forURLCost++;
        singleCost++;
        break;

      case 34: // '"'
        forURLCost++;
        doubleCost++;
        break;

      case 40: // '('
      case 41: // ')'
      case 32: // ' '
      case 9: // '\t'
        forURLCost++;
        break;

      case 92: // '\\'
      case 10: // '\n'
      case 13: // '\r'
      case 12: // '\f'
        forURLCost++;
        singleCost++;
        doubleCost++;
        break;
    }
  }

  // Quotes can sometimes be omitted for URL tokens
  if (forURL && forURLCost < singleCost && forURLCost < doubleCost) {
    return quoteForURL;
  }

  // Prefer double quotes to single quotes if there is no cost difference
  if (singleCost < doubleCost) {
    return 39; // '\''
  }

  return 34; // '"'
}

// printQuotedFlags
const printQuotedNoWrap = 1 << 0;

// escapeKind
const escapeNone = 0;
const escapeBackslash = 1;
const escapeHex = 2;

// identMode
const identNormal = 0;
const identHash = 1;
const identDimensionUnit = 2;
const identDimensionUnitAfterExponent = 3;

// trailingWhitespace
const mayNeedWhitespaceAfter = 0;
const canDiscardWhitespaceAfter = 1;

function functionMultiLineCommaPeriod(token       )         {
  if (token.kind === TFunction) {
    let commaCount = 0;
    const children = token.children;
    if (children === null) {
      // Go: nil pointer dereference
      throw new GoPanic("runtime error: invalid memory address or nil pointer dereference");
    }
    for (let i = 0; i < children.length; i++) {
      if (children[i].kind === TComma) {
        commaCount++;
      }
    }

    switch (goToLower(token.text)) {
      case "linear-gradient":
      case "radial-gradient":
      case "conic-gradient":
      case "repeating-linear-gradient":
      case "repeating-radial-gradient":
      case "repeating-conic-gradient":
        if (commaCount >= 2) {
          return 1;
        }
        break;

      case "matrix":
        if (commaCount === 5) {
          return 2;
        }
        break;

      case "matrix3d":
        if (commaCount === 15) {
          return 4;
        }
        break;
    }
  }
  return 0;
}
// generated from css_printer.mts by tools/ts-build.mjs; edit that file
