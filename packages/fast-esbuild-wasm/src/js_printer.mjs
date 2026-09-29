// Port of internal/js_printer/js_printer.go. See CONVENTIONS.md.
//
// Output buffer: Go appends UTF-8 bytes to p.js and compares len(p.js) with
// saved positions (stmtStart, prevOpEnd, ...). Here the output is the same:
// a growable Uint8Array of UTF-8 bytes (p.jsBuf, p.jsLen), decoded once at the
// end with TextDecoder("utf-8"), which is very fast for the common ASCII-only
// output. This allocates nothing per print() (unlike += ropes or an array of
// chunks) and allows reading the last bytes back like Go does. Every saved
// position is a byte length, as in Go. (A lone surrogate is written as its
// 3 WTF-8 bytes like in Go, and a raw byte of invalid UTF-8 from the source
// text, e.g. in a comment, as that byte: helpers.decodeGoString turns the
// output back into a string, which keeps them. Strings escape lone
// surrogates, so only raw source text can print them.)
//
// Source mappings: addSourceMapping passes the UTF-8 output buffer and its
// length to the sourcemap.ChunkBuilder, which counts generated columns in
// UTF-16 code units exactly like Go does.
import { GoPanic, goTypeName } from "./gopanic.mjs";
import {
  JSFeatureNone,
  jsFeatureHas,
  InlineScript,
  UnicodeEscapes,
  ObjectExtensions,
  TemplateLiteral,
  DynamicImport,
  Arrow,
  ImportAssertions,
  ImportAttributes,
  FunctionOrClassPropertyAccess,
  Bigint,
} from "./compat.mjs";
                                              
import { escapeClosingTag, formatFloatG, containsNonBMPCodePoint, quoteForJSON, decodeGoString } from "./helpers.mjs";
import { metafileFormatMaybeRemoveWhitespace } from "./config.mjs";
import {
  InvalidRef,
  followSymbols,
  ImportDynamic,
  ImportRequire,
  ImportRequireResolve,
  ImportStmt,
  DeferPhase,
  SourcePhase,
  WrapWithToESM,
  WrapWithToCJS,
  CallRuntimeRequire,
  ImportItemMissing,
  SymbolUnbound,
  SymbolTSEnum,
  IsEmptyFunction,
  IsIdentityFunction,
  CouldPotentiallyBeMutated,
  AssertKeyword,
  assertOrWithKeywordString,
  ShouldNotBeExternalInMetafile,
  importKindStringForMetafile,
} from "./ast.mjs";
import {
  LLowest,
  LComma,
  LYield,
  LAssign,
  LConditional,
  LLogicalAnd,
  LMultiply,
  LPrefix,
  LPostfix,
  LNew,
  LCall,
  UnOpNeg,
  UnOpPos,
  UnOpCpl,
  UnOpNot,
  UnOpTypeof,
  UnOpDelete,
  UnOpPreDec,
  UnOpPreInc,
  UnOpPostDec,
  BinOpAdd,
  BinOpSub,
  BinOpGt,
  BinOpIn,
  BinOpComma,
  BinOpPow,
  BinOpNullishCoalescing,
  BinOpLogicalOr,
  BinOpLogicalAnd,
  AssignTargetNone,
  OpTable,
  opCodeIsPrefix,
  opCodeIsLeftAssociative,
  opCodeIsRightAssociative,
  opCodeUnaryAssignTarget,
  OptionalChainNone,
  OptionalChainStart,
  DirectEval,
  TargetWasOriginallyPropertyAccess,
  PropertyGetter,
  PropertySetter,
  PropertyAutoAccessor,
  PropertySpread,
  PropertyClassStaticBlock,
  PropertyIsComputed,
  PropertyIsStatic,
  PropertyWasShorthand,
  PropertyPreferQuotedKey,
  propertyKindIsMethodDefinition,
  LocalVar,
  LocalLet,
  LocalConst,
  LocalUsing,
  LocalAwaitUsing,
  ConstValueNone,
  constValueToExpr,
  moduleTypeIsESM,
  ModuleUnknown,
  Expr,
  Stmt,
  EArray,
  EBinary,
  EIf,
  EInlinedEnum,
  ENumber,
  EString,
  ETemplate,
  EUnary,
  EUndefinedShared,
  SExpr,
  B_MISSING,
  B_IDENTIFIER,
  B_ARRAY,
  B_OBJECT,
  E_ARRAY,
  E_UNARY,
  E_BINARY,
  E_BOOLEAN,
  E_SUPER,
  E_NULL,
  E_UNDEFINED,
  E_THIS,
  E_NEW,
  E_NEW_TARGET,
  E_IMPORT_META,
  E_CALL,
  E_DOT,
  E_INDEX,
  E_ARROW,
  E_FUNCTION,
  E_CLASS,
  E_IDENTIFIER,
  E_IMPORT_IDENTIFIER,
  E_PRIVATE_IDENTIFIER,
  E_NAME_OF_SYMBOL,
  E_JSX_ELEMENT,
  E_JSX_TEXT,
  E_MISSING,
  E_NUMBER,
  E_BIG_INT,
  E_OBJECT,
  E_SPREAD,
  E_STRING,
  E_TEMPLATE,
  E_REG_EXP,
  E_INLINED_ENUM,
  E_ANNOTATION,
  E_AWAIT,
  E_YIELD,
  E_IF,
  E_REQUIRE_STRING,
  E_REQUIRE_RESOLVE_STRING,
  E_IMPORT_STRING,
  E_IMPORT_CALL,
  S_BLOCK,
  S_COMMENT,
  S_DEBUGGER,
  S_DIRECTIVE,
  S_EMPTY,
  S_EXPORT_CLAUSE,
  S_EXPORT_FROM,
  S_EXPORT_DEFAULT,
  S_EXPORT_STAR,
  S_EXPR,
  S_FUNCTION,
  S_CLASS,
  S_LABEL,
  S_IF,
  S_FOR,
  S_FOR_IN,
  S_FOR_OF,
  S_DO_WHILE,
  S_WHILE,
  S_WITH,
  S_TRY,
  S_SWITCH,
  S_IMPORT,
  S_RETURN,
  S_THROW,
  S_LOCAL,
  S_BREAK,
  S_CONTINUE,
} from "./js_ast.mjs";
import {
  LegalCommentsInline,
  LegalCommentsNone,
  LegalCommentsEndOfFile,
  LegalCommentsLinkedWithComment,
  LegalCommentsExternalWithoutComment,
  FormatPreserve,
  SourceMapNone,
} from "./config.mjs";
import { isIdentifier, isIdentifierES5AndESNext, isIdentifierES5AndESNextUTF16, isIdentifierContinue } from "./js_ident.mjs";
import {
  joinWithComma,
  isPropertyAccess,
  isOptionalChain,
  inlinePrimitivesIntoTemplate,
  makeHelperContext,
  toNumberWithoutSideEffects,
  toInt32,
  shouldFoldBinaryOperatorWhenMinifying,
  foldBinaryOperator,
  toBooleanWithSideEffects,
  NoSideEffects,
} from "./js_ast_helpers.mjs";
import { ChunkBuilder } from "./sourcemap.mjs";

const hexChars = "0123456789ABCDEF";
const firstASCII = 0x20;
const lastASCII = 0x7e;
const firstHighSurrogate = 0xd800;
const lastHighSurrogate = 0xdbff;
const firstLowSurrogate = 0xdc00;
const lastLowSurrogate = 0xdfff;

// A backslash followed by "u". Never written literally in this file (see
// CONVENTIONS.md section 6b).
const BSU = "\\" + "u";

// Go: '\\', 'u', hexChars[c>>12], hexChars[(c>>8)&15], hexChars[(c>>4)&15], hexChars[c&15]
function hex4(c) {
  return BSU + hexChars[c >> 12] + hexChars[(c >> 8) & 15] + hexChars[(c >> 4) & 15] + hexChars[c & 15];
}

// Go: fmt.Sprintf("\\u{%X}", c)
function unicodeEscapeBraces(c) {
  return BSU + "{" + c.toString(16).toUpperCase() + "}";
}

// Go: math.Signbit(x) for a non-NaN float64
function signbit(x) {
  return x < 0 || (x === 0 && 1 / x < 0);
}


// Code points that js_ast.IsIdentifierContinue accepts in the ASCII range
const identContinueASCII = new Uint8Array(128);
for (let c = 0; c < 128; c++) {
  if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36) {
    identContinueASCII[c] = 1;
  }
}

// printIndent() prints "  " Indent times; cache the concatenations
const indentCache = [""];
function indentString(n) {
  while (indentCache.length <= n) indentCache.push(indentCache[indentCache.length - 1] + "  ");
  return indentCache[n];
}

// Returns true if text[i:i+6] equals "script" ignoring ASCII case
function matchesScriptAt(text, i) {
  const script = "script";
  for (let j = 0; j < 6; j++) {
    let a = text.charCodeAt(i + j);
    if (a >= 65 && a <= 90) a += 32;
    if (a !== script.charCodeAt(j)) return false;
  }
  return true;
}

// Go: strings.EqualFold(value[:7], "/script") where len(value) >= 7 bytes. A
// match needs 7 runes in 7 bytes, i.e. 7 ASCII characters, so this is an ASCII
// case-insensitive compare of the first 7 UTF-16 code units.
function startsWithSlashScriptFold(value) {
  if (value.length < 7 || value.charCodeAt(0) !== 47) return false;
  return matchesScriptAt(value, 1);
}

// Exported for other packages (the linker). "js" is the prefix to append to
// (Go's []byte, may be null or ""). The result is a JS string.
export function quoteIdentifier(js, name, unsupportedFeatures           ) {
  let out = js === null || js === undefined ? "" : js;
  let isASCII = false;
  let asciiStart = 0;
  const n = name.length;
  for (let i = 0; i < n; i++) {
    const at = i;
    let c = name.charCodeAt(i);
    let lone = false;
    if (c >= firstHighSurrogate && c <= lastLowSurrogate) {
      lone = true;
      if (c <= lastHighSurrogate && i + 1 < n) {
        const c2 = name.charCodeAt(i + 1);
        if (c2 >= firstLowSurrogate && c2 <= lastLowSurrogate) {
          c = (c << 10) + c2 + (0x10000 - (firstHighSurrogate << 10) - firstLowSurrogate);
          i++;
          lone = false;
        }
      }
    }
    if (c >= firstASCII && c <= lastASCII) {
      // Fast path: a run of ASCII characters
      if (!isASCII) {
        isASCII = true;
        asciiStart = at;
      }
    } else {
      // Slow path: escape non-ACSII characters
      if (isASCII) {
        out += name.slice(asciiStart, at);
        isASCII = false;
      }
      if (lone) {
        // Go ranges over the 3 WTF-8 bytes of a lone surrogate as 3 x U+FFFD
        out += hex4(0xfffd) + hex4(0xfffd) + hex4(0xfffd);
      } else if (c <= 0xffff) {
        out += hex4(c);
      } else if (!jsFeatureHas(unsupportedFeatures, UnicodeEscapes)) {
        out += unicodeEscapeBraces(c);
      } else {
        // Go: panic("Internal error: Cannot encode identifier: Unicode escapes are unsupported")
        throw new GoPanic("Internal error: Cannot encode identifier: Unicode escapes are unsupported");
      }
    }
  }
  if (isASCII) {
    // Print one final run of ASCII characters
    out += name.slice(asciiStart);
  }
  return out;
}

// The per-character logic of Go's printUnquotedUTF16 (the "wrapLongLines"
// logic is in printUnquotedUTF16WrapLongLines). "c" is text[i]. Returns the
// escape sequence to print instead of the character, or null if the
// character is printed verbatim. escapeNextIsPair tells whether the character
// was the first half of a surrogate pair (then both code units are consumed).
let escapeNextIsPair = false;

// Characters below 0x7f that may need an escape (all others are printed
// verbatim, as in Go's "Common case: just append a single byte")
const ESCAPE_CANDIDATE = new Uint8Array(0x7f);
for (const c of [0x00, 0x07, 0x08, 0x0a, 0x0b, 0x0c, 0x0d, 0x1b, 0x22, 0x24, 0x27, 0x2f, 0x5c, 0x60]) ESCAPE_CANDIDATE[c] = 1;

function escapeUnquotedChar(text, at, c, quote, asciiOnly, inlineScriptOK, unicodeEscapesOK) {
  const n = text.length;
  const i = at + 1; // (Go's "i" after decoding the character)
  escapeNextIsPair = false;

  switch (c) {
    // Special-case the null character since it may mess with code written in C
    // that treats null characters as the end of the string.
    case 0x00:
      // We don't want "\x001" to be written as "\01"
      if (i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) {
        return "\\x00";
      }
      return "\\0";

    // Special-case the bell character since it may cause dumping this file to
    // the terminal to make a sound, which is undesirable. Note that we can't
    // use an octal literal to print this shorter since octal literals are not
    // allowed in strict mode (or in template strings).
    case 0x07:
      return "\\x07";

    case 0x08:
      return "\\b";

    case 0x0c:
      return "\\f";

    case 0x0a:
      if (quote === 0x60) {
        return null; // A real newline
      }
      return "\\n";

    case 0x0d:
      return "\\r";

    case 0x0b:
      return "\\v";

    case 0x1b:
      return "\\x1B";

    case 0x5c:
      return "\\\\";

    case 0x2f:
      // Avoid generating the sequence "</script" in JS code
      if (inlineScriptOK && i >= 2 && text.charCodeAt(i - 2) === 60 && i + 6 <= n && matchesScriptAt(text, i)) {
        return "\\/";
      }
      return null;

    case 0x27:
      return quote === 0x27 ? "\\'" : null;

    case 0x22:
      return quote === 0x22 ? '\\"' : null;

    case 0x60:
      return quote === 0x60 ? "\\`" : null;

    case 0x24:
      if (quote === 0x60 && i < n && text.charCodeAt(i) === 0x7b) {
        return "\\$";
      }
      return null;

    case 0x2028:
      return BSU + "2028";

    case 0x2029:
      return BSU + "2029";

    case 0xfeff:
      return BSU + "FEFF";
  }

  // Common case: just append a single byte
  if (c <= lastASCII) {
    return null;
  }

  // Is this a high surrogate?
  if (c >= firstHighSurrogate && c <= lastHighSurrogate) {
    // Is there a next character?
    if (i < n) {
      const c2 = text.charCodeAt(i);

      // Is it a low surrogate?
      if (c2 >= firstLowSurrogate && c2 <= lastLowSurrogate) {
        const r = (c << 10) + c2 + (0x10000 - (firstHighSurrogate << 10) - firstLowSurrogate);
        escapeNextIsPair = true;

        // Escape this character if UTF-8 isn't allowed
        if (asciiOnly) {
          if (unicodeEscapesOK) {
            return unicodeEscapeBraces(r);
          }
          return hex4(c) + hex4(c2);
        }

        // Otherwise, encode to UTF-8
        return null;
      }
    }

    // Write an unpaired high surrogate
    return hex4(c);
  }

  // Is this an unpaired low surrogate or four-digit hex escape?
  if ((c >= firstLowSurrogate && c <= lastLowSurrogate) || (asciiOnly && c > 0xff)) {
    return hex4(c);
  }

  // Can this be a two-digit hex escape?
  if (asciiOnly) {
    return "\\x" + hexChars[c >> 4] + hexChars[c & 15];
  }

  // Otherwise, just encode to UTF-8
  return null;
}

// printQuotedFlags
const printQuotedAllowBacktick = 1 << 0;
const printQuotedNoWrap = 1 << 1;

// printAfterDecorator
const printNewlineAfterDecorator = 0;
const printSpaceAfterDecorator = 1;

// exprStartFlags
const stmtStartFlag = 1 << 0;
const exportDefaultStartFlag = 1 << 1;
const arrowExprStartFlag = 1 << 2;
const forOfInitStartFlag = 1 << 3;

// printExprFlags
const isNewTarget = 1 << 0;
const forbidIn = 1 << 1;
const hasNonOptionalChainParent = 1 << 2;
const exprResultIsUnused = 1 << 3;
const didAlreadySimplifyUnusedExprs = 1 << 4;
const isFollowedByOf = 1 << 5;
const isInsideForAwait = 1 << 6;
const isDeleteTarget = 1 << 7;
const isCallTargetOrTemplateTag = 1 << 8;
const isPropertyAccessTarget = 1 << 9;
const parentWasUnaryOrBinaryOrIfTest = 1 << 10;

// printStmtFlags
const canOmitStatement = 1 << 0;

// Go's "expr.Data" where a nil Expr is null
function exprData(expr) {
  return expr === null ? null : expr.data;
}

// Output buffers are reused across print() calls (printing is not
// re-entrant; a nested print simply allocates its own buffer).
let spareOutputBuffer = null;
function takeOutputBuffer() {
  const buf = spareOutputBuffer;
  if (buf !== null) {
    spareOutputBuffer = null;
    return buf;
  }
  return new Uint8Array(1 << 15);
}
function releaseOutputBuffer(buf) {
  if (buf !== null && buf.length <= 1 << 22) spareOutputBuffer = buf;
}

// A bitset of the locations that have expression comments (the keys of
// "exprComments"), so that the lookups done for every printed expression are a
// bit test instead of a Map lookup. The map is complete when printing starts
// (only the parser adds to it), and the same map is printed part by part, so
// the bitset is cached per map. null means "no filter" (some key is not a
// small non-negative integer, which never happens for source locations).
const exprCommentBitsCache = new WeakMap();
function exprCommentBitsFor(exprComments) {
  let entry = exprCommentBitsCache.get(exprComments);
  if (entry === undefined || entry.size !== exprComments.size) {
    let max = 0;
    let ok = true;
    for (const loc of exprComments.keys()) {
      if (!(typeof loc === "number" && loc >= 0 && loc <= 0x3fffffff && Math.floor(loc) === loc)) {
        ok = false;
        break;
      }
      if (loc > max) max = loc;
    }
    let bits = null;
    if (ok) {
      bits = new Int32Array((max >>> 5) + 1);
      for (const loc of exprComments.keys()) bits[loc >>> 5] |= 1 << (loc & 31);
    }
    entry = { size: exprComments.size, bits };
    exprCommentBitsCache.set(exprComments, entry);
  }
  return entry.bits;
}

// False if "loc" certainly has no expression comments (see exprCommentBitsFor)
function mayHaveExprComments(bits, loc) {
  if (bits === null) return true;
  const i = loc >>> 5;
  return i < bits.length && (bits[i] & (1 << (loc & 31))) !== 0;
}

// Writes the UTF-8 encoding of text[i:end) (a single code point) to buf at
// "len" and returns the new length
function encodeUTF8Into(buf, len, text, i, end) {
  const c = text.charCodeAt(i);
  if (c < 0x80) {
    buf[len++] = c;
  } else if (c < 0x800) {
    buf[len++] = 0xc0 | (c >> 6);
    buf[len++] = 0x80 | (c & 63);
  } else if (end - i === 2) {
    const r = (c << 10) + text.charCodeAt(i + 1) + (0x10000 - (firstHighSurrogate << 10) - firstLowSurrogate);
    buf[len++] = 0xf0 | (r >> 18);
    buf[len++] = 0x80 | ((r >> 12) & 63);
    buf[len++] = 0x80 | ((r >> 6) & 63);
    buf[len++] = 0x80 | (r & 63);
  } else {
    buf[len++] = 0xe0 | (c >> 12);
    buf[len++] = 0x80 | ((c >> 6) & 63);
    buf[len++] = 0x80 | (c & 63);
  }
  return len;
}

// Go: utf8.DecodeLastRune(p[:n]) (the rune only)
function decodeLastRune(p, n) {
  if (n === 0) return 0xfffd;
  let start = n - 1;
  const c = p[start];
  if (c < 0x80) return c;
  let lim = n - 4;
  if (lim < 0) lim = 0;
  for (start--; start >= lim; start--) {
    if ((p[start] & 0xc0) !== 0x80) break;
  }
  if (start < 0) start = 0;
  // utf8.DecodeRune(p[start:n]) must consume exactly n - start bytes
  const size = n - start;
  const b0 = p[start];
  let r;
  if (b0 >= 0xc2 && b0 <= 0xdf) {
    if (size !== 2) return 0xfffd;
    const b1 = p[start + 1];
    if ((b1 & 0xc0) !== 0x80) return 0xfffd;
    r = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
  } else if (b0 >= 0xe0 && b0 <= 0xef) {
    if (size !== 3) return 0xfffd;
    const b1 = p[start + 1];
    const b2 = p[start + 2];
    const lo = b0 === 0xe0 ? 0xa0 : 0x80;
    const hi = b0 === 0xed ? 0x9f : 0xbf;
    if (b1 < lo || b1 > hi || (b2 & 0xc0) !== 0x80) return 0xfffd;
    r = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
  } else if (b0 >= 0xf0 && b0 <= 0xf4) {
    if (size !== 4) return 0xfffd;
    const b1 = p[start + 1];
    const b2 = p[start + 2];
    const b3 = p[start + 3];
    const lo = b0 === 0xf0 ? 0x90 : 0x80;
    const hi = b0 === 0xf4 ? 0x8f : 0xbf;
    if (b1 < lo || b1 > hi || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return 0xfffd;
    r = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
  } else {
    return 0xfffd;
  }
  return r;
}

function isASCII(text) {
  for (let i = 0, n = text.length; i < n; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

class printer {
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
  ;                            
  ;                          
  ;                               
  ;                          
  ;                      
  ;                       
  ;                                  
  ;                                
  ;                            
  constructor(symbols, renamer, importRecords, options, moduleType, exprComments, wasLazyExport) {
    // JS-only: cached "!options.UnsupportedFeatures.Has(compat.X)" for the
    // features checked per character
    this.inlineScriptOK = !jsFeatureHas(options.unsupportedFeatures, InlineScript);
    this.unicodeEscapesOK = !jsFeatureHas(options.unsupportedFeatures, UnicodeEscapes);
    this.symbols = symbols; // ast.SymbolMap
    this.astHelpers = null; // js_ast.HelperContext (set by print())
    this.renamer = renamer;
    this.importRecords = importRecords;
    this.callTarget = null; // js_ast.E
    this.exprComments = exprComments; // Map<Loc, string[]> or null
    this.printedExprComments = null; // Set<Loc>
    this.exprCommentBits = null; // see exprCommentBitsFor
    this.hasLegalComment = null; // Set<string>
    this.extractedLegalComments = [];
    this.jsBuf = takeOutputBuffer(); // Go: js []byte (see the comment at the top)
    this.jsLen = 0; // Go: len(p.js), in UTF-16 code units
    this.jsonMetadataImports = [];
    this.binaryExprStack = []; // []binaryExprVisitor
    this.binaryExprVisitorPool = []; // JS-only: see acquireBinaryExprVisitor
    this.options = options;
    // sourcemap.ChunkBuilder, only created when it is used (source mappings are
    // added or a source map chunk is generated), else null
    this.builder =
      options.addSourceMappings || options.sourceMap !== SourceMapNone
        ? new ChunkBuilder(options.inputSourceMap, options.lineOffsetTables, options.asciiOnly)
        : null;
    this.addSourceMappings = options.addSourceMappings; // Go: p.options.AddSourceMappings
    this.printNextIndentAsSpace = false;

    this.stmtStart = -1;
    this.exportDefaultStart = -1;
    this.arrowExprStart = -1;
    this.forOfInitStart = -1;

    this.withNesting = 0;
    this.prevOpEnd = -1;
    this.needSpaceBeforeDot = -1;
    this.prevRegExpEnd = -1;
    this.noLeadingNewlineHere = -1;
    this.oldLineStart = 0;
    this.oldLineEnd = 0;
    this.needsSemicolon = false;
    this.wasLazyExport = wasLazyExport;
    this.prevOp = UnOpPos; // js_ast.OpCode zero value
    this.moduleType = moduleType;

    // JS-only: whether any symbol is flagged IsEmptyFunction or
    // IsIdentityFunction (see simplifyUnusedExpr)
    this.hasInlinableCalls = true;

    // JS-only: the comma expressions (their EBinary data) that
    // simplifyUnusedExpr returned unchanged (see simplifyUnusedCommaChain)
    this.unchangedByInlining = null;

    // JS-only: lateConstantFoldUnaryOrBinaryOrIfExpr only changes an
    // expression if it contains an inlined constant (options.ConstValues) or
    // a cross-module enum value (options.TSEnums). Without either it returns
    // its argument, so the pre-pass in printExpr is skipped.
    this.canLateFold =
      (options.constValues !== null && options.constValues.size > 0) || (options.tsEnums !== null && options.tsEnums.size > 0);
  }

  // Go: p.js = append(p.js, text...) (UTF-8 encoded)
  print(text) {
    const n = text.length;
    let len = this.jsLen;
    let buf = this.jsBuf;
    if (len + n > buf.length) {
      buf = this.growJS(len + n);
    }
    for (let i = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c >= 0x80) {
        this.jsLen = len;
        this.printUTF8From(text, i);
        return;
      }
      buf[len++] = c;
    }
    this.jsLen = len;
  }

  // Appends the UTF-8 encoding of text[i:] (WTF-8 for a lone surrogate, like
  // Go's strings)
  printUTF8From(text, i) {
    const n = text.length;
    let len = this.jsLen;
    let buf = this.jsBuf;
    // (At most 3 bytes per UTF-16 code unit)
    if (len + (n - i) * 3 > buf.length) buf = this.growJS(len + (n - i) * 3);
    while (i < n) {
      const c = text.charCodeAt(i++);
      if (c < 0x80) {
        buf[len++] = c;
      } else if (c < 0x800) {
        buf[len++] = 0xc0 | (c >> 6);
        buf[len++] = 0x80 | (c & 63);
      } else {
        if (c >= firstHighSurrogate && c <= lastHighSurrogate && i < n) {
          const c2 = text.charCodeAt(i);
          if (c2 >= firstLowSurrogate && c2 <= lastLowSurrogate) {
            i++;
            const r = (c << 10) + c2 + (0x10000 - (firstHighSurrogate << 10) - firstLowSurrogate);
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
    this.jsLen = len;
  }

  growJS(needed) {
    let size = this.jsBuf.length * 2;
    while (size < needed) size *= 2;
    const buf = new Uint8Array(size);
    buf.set(this.jsBuf.subarray(0, this.jsLen));
    this.jsBuf = buf;
    return buf;
  }

  // The output as a JS string
  jsText() {
    const text = this.jsLen === 0 ? "" : decodeGoString(this.jsBuf.subarray(0, this.jsLen));
    releaseOutputBuffer(this.jsBuf);
    this.jsBuf = null;
    return text;
  }

  // Go: p.js[len(p.js)-1] (0 if empty)
  lastChar() {
    return this.jsLen > 0 ? this.jsBuf[this.jsLen - 1] : 0;
  }

  // Go: printBytes (same as print here)
  printBytes(bytes) {
    this.print(bytes);
  }

  // Go: utf8.DecodeLastRune(p.js). Returns 0xFFFD for an empty buffer or an
  // invalid sequence (e.g. the WTF-8 bytes of a lone surrogate).
  lastCodePoint() {
    return decodeLastRune(this.jsBuf, this.jsLen);
  }

  // Characters that can never need an escape are copied straight into the
  // output buffer; all others (see ESCAPE_CANDIDATE) go through the exact
  // per-character logic of Go's printUnquotedUTF16 (escapeUnquotedChar).
  printUnquotedUTF16(text, quote, flags) {
    // Only compute the line length if necessary
    if (this.options.lineLimit > 0 && (flags & printQuotedNoWrap) === 0) {
      this.printUnquotedUTF16WrapLongLines(text, quote);
      return;
    }

    const n = text.length;
    let len = this.jsLen;
    let buf = this.jsBuf;
    if (len + n > buf.length) buf = this.growJS(len + n);
    let i = 0;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c < 0x7f && ESCAPE_CANDIDATE[c] === 0) {
        buf[len++] = c;
        i++;
        continue;
      }
      const esc = escapeUnquotedChar(text, i, c, quote, this.options.asciiOnly, this.inlineScriptOK, this.unicodeEscapesOK);
      if (esc === null) {
        // Printed verbatim (one code unit, or a surrogate pair)
        if (c < 0x80) {
          buf[len++] = c;
          i++;
          continue;
        }
        // Non-ASCII: UTF-8 encode it (at most 4 bytes for 2 code units, or 3
        // for one; the n - i bytes reserved for the rest include 1 or 2 of them)
        const end = i + (escapeNextIsPair ? 2 : 1);
        if (len + 2 + (n - i) > buf.length) {
          this.jsLen = len;
          buf = this.growJS(len + 2 + (n - i));
        }
        len = encodeUTF8Into(buf, len, text, i, end);
        i = end;
        continue;
      }
      i += escapeNextIsPair ? 2 : 1;
      // The escape is longer than what it replaces: make room for it and the rest
      const m = esc.length;
      if (len + m + (n - i) > buf.length) {
        this.jsLen = len;
        buf = this.growJS(len + m + (n - i));
      }
      for (let k = 0; k < m; k++) buf[len + k] = esc.charCodeAt(k);
      len += m;
    }
    this.jsLen = len;
  }

  // Go's printUnquotedUTF16 with "wrapLongLines" set (LineLimit > 0 and no
  // printQuotedNoWrap flag). As in Go, "i" counts UTF-16 code units of the
  // text while the line length is in bytes.
  printUnquotedUTF16WrapLongLines(text, quote) {
    const lineLimit = this.options.lineLimit;
    let startLineLength = this.currentLineLength();
    if (startLineLength > lineLimit) {
      startLineLength = lineLimit;
    }

    const n = text.length;
    let i = 0;
    while (i < n) {
      // Wrap long lines that are over the limit using escaped newlines
      if (startLineLength + i >= lineLimit) {
        this.print("\\\n");
        startLineLength -= lineLimit;
      }

      const c = text.charCodeAt(i);
      let width = 1;
      let esc = null;
      if (!(c < 0x7f && ESCAPE_CANDIDATE[c] === 0)) {
        esc = escapeUnquotedChar(text, i, c, quote, this.options.asciiOnly, this.inlineScriptOK, this.unicodeEscapesOK);
        if (escapeNextIsPair) width = 2;
      }
      if (esc !== null) {
        this.print(esc);
      } else {
        if (c === 0x0a) {
          // (Only reached for a backtick quote: otherwise it is escaped)
          startLineLength = -(i + 1); // Printing a real newline resets the line length
        }
        this.print(width === 1 ? text[i] : text.slice(i, i + 2));
      }
      i += width;
    }
  }

  // JSX tag syntax doesn't support character escapes so non-ASCII identifiers
  // must be printed as UTF-8 even when the charset is set to ASCII.
  printJSXTag(tagOrNil) {
    const p = this;
    if (tagOrNil === null) return;
    const e = tagOrNil.data;
    switch (e.k) {
      case E_STRING:
        p.addSourceMapping(tagOrNil.loc);
        p.print(e.value);
        break;

      case E_IDENTIFIER: {
        const name = p.renamer.nameForSymbol(e.ref);
        p.addSourceMappingForName(tagOrNil.loc, name, e.ref);
        p.print(name);
        break;
      }

      case E_DOT:
        p.printJSXTag(e.target);
        p.print(".");
        p.addSourceMapping(e.nameLoc);
        p.print(e.name);
        break;

      default:
        p.printExpr(tagOrNil, LLowest, 0);
    }
  }

  printQuotedUTF8(text, flags) {
    this.printQuotedUTF16(text, flags);
  }

  addSourceMapping(loc) {
    if (this.addSourceMappings) {
      this.builder.addSourceMapping(loc, "", this.jsBuf, this.jsLen);
    }
  }

  addSourceMappingForName(loc, name, ref) {
    if (this.addSourceMappings) {
      const originalName = this.symbols.get(followSymbols(this.symbols, ref)).originalName;
      if (originalName !== name) {
        this.builder.addSourceMapping(loc, originalName, this.jsBuf, this.jsLen);
      } else {
        this.builder.addSourceMapping(loc, "", this.jsBuf, this.jsLen);
      }
    }
  }

  printIndent() {
    const p = this;
    if (p.options.minifyWhitespace) {
      return;
    }

    if (p.printNextIndentAsSpace) {
      p.print(" ");
      p.printNextIndentAsSpace = false;
      return;
    }

    let indent = p.options.indent;
    if (p.options.lineLimit > 0 && indent * 2 >= p.options.lineLimit) {
      indent = Math.trunc(p.options.lineLimit / 2);
    }
    if (indent > 0) {
      p.print(indentString(indent));
    }
  }

  mangledPropName(ref) {
    const p = this;
    ref = followSymbols(p.symbols, ref);
    if (p.options.mangledProps !== null) {
      const name = p.options.mangledProps.get(ref);
      if (name !== undefined) {
        return name;
      }
    }
    return p.renamer.nameForSymbol(ref);
  }

  // Go: p.options.ConstValues[ref] when its Kind is not ConstValueNone, else null
  constValue(ref) {
    const constValues = this.options.constValues;
    if (constValues === null) return null;
    const value = constValues.get(ref);
    if (value === undefined || value.kind === ConstValueNone) return null;
    return value;
  }

  // Returns the js_ast.TSEnumValue or null (instead of Go's (value, ok) pair)
  tryToGetImportedEnumValue(target, name) {
    const p = this;
    const id = target.data;
    if (id.k === E_IMPORT_IDENTIFIER) {
      const ref = followSymbols(p.symbols, id.ref);
      if (p.symbols.get(ref).kind === SymbolTSEnum) {
        const tsEnums = p.options.tsEnums;
        const enum_ = tsEnums !== null ? tsEnums.get(ref) : undefined;
        if (enum_ !== undefined) {
          const value = enum_.get(name);
          return value !== undefined ? value : null;
        }
      }
    }
    return null;
  }

  // Go returns (value, name, ok); the name is the same JS string as the input
  // here, so this returns the js_ast.TSEnumValue or null.
  tryToGetImportedEnumValueUTF16(target, name) {
    return this.tryToGetImportedEnumValue(target, name);
  }

  printClauseAlias(loc, alias) {
    const p = this;
    if (isIdentifier(alias)) {
      p.printSpaceBeforeIdentifier();
      p.addSourceMapping(loc);
      p.printIdentifier(alias);
    } else {
      p.addSourceMapping(loc);
      p.printQuotedUTF8(alias, 0);
    }
  }

  // Note: The functions below check whether something can be printed as an
  // identifier or if it needs to be quoted (e.g. "x.y" vs. "x['y']") using the
  // ES5 identifier validity test to maximize cross-platform portability. Even
  // though newer JavaScript environments can handle more Unicode characters,
  // there isn't a published document that says which Unicode versions are
  // supported by which browsers. Even if a character is considered valid in the
  // latest version of Unicode, we don't know if the browser we're targeting
  // contains an older version of Unicode or not. So for safety, we quote
  // anything that isn't guaranteed to be compatible with ES5, the oldest
  // JavaScript language target that we support.

  canPrintIdentifier(name) {
    return isIdentifierES5AndESNext(name) && (!this.options.asciiOnly || this.unicodeEscapesOK || !containsNonBMPCodePoint(name));
  }

  canPrintIdentifierUTF16(name) {
    return (
      isIdentifierES5AndESNextUTF16(name) && (!this.options.asciiOnly || this.unicodeEscapesOK || !containsNonBMPCodePoint(name))
    );
  }

  printIdentifier(name) {
    // (QuoteIdentifier leaves pure-ASCII names unchanged)
    if (!this.options.asciiOnly) {
      this.print(name);
      return;
    }
    // Copy while checking for non-ASCII characters (the length is only
    // committed if all of them are ASCII)
    const n = name.length;
    const len = this.jsLen;
    let buf = this.jsBuf;
    if (len + n > buf.length) buf = this.growJS(len + n);
    for (let i = 0; i < n; i++) {
      const c = name.charCodeAt(i);
      if (c > 0x7f) {
        this.print(quoteIdentifier("", name, this.options.unsupportedFeatures));
        return;
      }
      buf[len + i] = c;
    }
    this.jsLen = len + n;
  }

  // This is the same as "printIdentifier(StringToUTF16(bytes))" without any
  // unnecessary temporary allocations
  printIdentifierUTF16(name) {
    // Without ASCIIOnly every code point is printed as-is (identifiers never
    // contain lone surrogates, which Go would print as U+FFFD)
    if (!this.options.asciiOnly) {
      this.print(name);
      return;
    }

    let out = "";
    let start = 0;
    const n = name.length;
    for (let i = 0; i < n; i++) {
      const at = i;
      let c = name.charCodeAt(i);

      if (c >= firstHighSurrogate && c <= lastHighSurrogate && i + 1 < n) {
        const c2 = name.charCodeAt(i + 1);
        if (c2 >= firstLowSurrogate && c2 <= lastLowSurrogate) {
          c = (c << 10) + c2 + (0x10000 - (firstHighSurrogate << 10) - firstLowSurrogate);
          i++;
        }
      }

      if (c > lastASCII) {
        if (start < at) out += name.slice(start, at);
        if (c <= 0xffff) {
          out += hex4(c);
        } else if (this.unicodeEscapesOK) {
          out += unicodeEscapeBraces(c);
        } else {
          // Go: panic("Internal error: Cannot encode identifier: Unicode escapes are unsupported")
          throw new GoPanic("Internal error: Cannot encode identifier: Unicode escapes are unsupported");
        }
        start = i + 1;
      }
    }
    if (start === 0) {
      out = name;
    } else if (start < n) {
      out += name.slice(start);
    }
    this.print(out);
  }

  printNumber(value, level) {
    const p = this;
    const absValue = Math.abs(value);

    if (value !== value) {
      p.printSpaceBeforeIdentifier();
      if (p.withNesting !== 0) {
        // "with (x) NaN" really means "x.NaN" so avoid identifiers when "with" is present
        const wrap = level >= LMultiply;
        if (wrap) {
          p.print("(");
        }
        if (p.options.minifyWhitespace) {
          p.print("0/0");
        } else {
          p.print("0 / 0");
        }
        if (wrap) {
          p.print(")");
        }
      } else {
        p.print("NaN");
      }
    } else if (value === Infinity || value === -Infinity) {
      // "with (x) Infinity" really means "x.Infinity" so avoid identifiers when "with" is present
      const wrap =
        ((p.options.minifySyntax || p.withNesting !== 0) && level >= LMultiply) || (value === -Infinity && level >= LPrefix);
      if (wrap) {
        p.print("(");
      }
      if (value === -Infinity) {
        p.printSpaceBeforeOperator(UnOpNeg);
        p.print("-");
      } else {
        p.printSpaceBeforeIdentifier();
      }
      if (!p.options.minifySyntax && p.withNesting === 0) {
        p.print("Infinity");
      } else if (p.options.minifyWhitespace) {
        p.print("1/0");
      } else {
        p.print("1 / 0");
      }
      if (wrap) {
        p.print(")");
      }
    } else {
      if (!signbit(value)) {
        p.printSpaceBeforeIdentifier();
        p.printNonNegativeFloat(absValue);
      } else if (level >= LPrefix) {
        // Expressions such as "(-1).toString" need to wrap negative numbers.
        // Instead of testing for "value < 0" we test for "signbit(value)" and
        // "!isNaN(value)" because we need this to be true for "-0" and "-0 < 0"
        // is false.
        p.print("(-");
        p.printNonNegativeFloat(absValue);
        p.print(")");
      } else {
        p.printSpaceBeforeOperator(UnOpNeg);
        p.print("-");
        p.printNonNegativeFloat(absValue);
      }
    }
  }

  willPrintExprCommentsAtLoc(loc) {
    const p = this;
    if (p.options.minifyWhitespace || p.exprComments === null || !mayHaveExprComments(p.exprCommentBits, loc)) return false;
    const comments = p.exprComments.get(loc);
    return comments !== undefined && comments !== null && !p.printedExprComments.has(loc);
  }

  willPrintExprCommentsForAnyOf(exprs) {
    for (let i = 0; i < exprs.length; i++) {
      if (this.willPrintExprCommentsAtLoc(exprs[i].loc)) {
        return true;
      }
    }
    return false;
  }

  printBinding(binding) {
    const p = this;
    const b = binding.data;
    switch (b.k) {
      case B_MISSING:
        p.addSourceMapping(binding.loc);
        break;

      case B_IDENTIFIER: {
        const name = p.renamer.nameForSymbol(b.ref);
        p.printSpaceBeforeIdentifier();
        p.addSourceMappingForName(binding.loc, name, b.ref);
        p.printIdentifier(name);
        break;
      }

      case B_ARRAY: {
        let isMultiLine = (b.items.length > 0 && !b.isSingleLine) || p.willPrintExprCommentsAtLoc(b.closeBracketLoc);
        if (!p.options.minifyWhitespace && !isMultiLine) {
          for (let $i64 = 0, $a64 = b.items; $i64 < $a64.length; $i64++) {
            const item = $a64[$i64];
            if (p.willPrintExprCommentsAtLoc(item.loc)) {
              isMultiLine = true;
              break;
            }
          }
        }
        p.addSourceMapping(binding.loc);
        p.print("[");
        if (b.items.length > 0 || isMultiLine) {
          if (isMultiLine) {
            p.options.indent++;
          }

          for (let i = 0; i < b.items.length; i++) {
            const item = b.items[i];
            if (i !== 0) {
              p.print(",");
            }
            if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
              if (isMultiLine) {
                p.printNewline();
                p.printIndent();
              } else if (i !== 0) {
                p.printSpace();
              }
            }
            p.printExprCommentsAtLoc(item.loc);
            if (b.hasSpread && i + 1 === b.items.length) {
              p.addSourceMapping(item.loc);
              p.print("...");
              p.printExprCommentsAtLoc(item.binding.loc);
            }
            p.printBinding(item.binding);

            if (item.defaultValueOrNil !== null) {
              p.printSpace();
              p.print("=");
              p.printSpace();
              p.printExprWithoutLeadingNewline(item.defaultValueOrNil, LComma, 0);
            }

            // Make sure there's a comma after trailing missing items
            if (item.binding.data.k === B_MISSING && i === b.items.length - 1) {
              p.print(",");
            }
          }

          if (isMultiLine) {
            p.printNewline();
            p.printExprCommentsAfterCloseTokenAtLoc(b.closeBracketLoc);
            p.options.indent--;
            p.printIndent();
          }
        }
        p.addSourceMapping(b.closeBracketLoc);
        p.print("]");
        break;
      }

      case B_OBJECT: {
        let isMultiLine = (b.properties.length > 0 && !b.isSingleLine) || p.willPrintExprCommentsAtLoc(b.closeBraceLoc);
        if (!p.options.minifyWhitespace && !isMultiLine) {
          for (let $i65 = 0, $a65 = b.properties; $i65 < $a65.length; $i65++) {
            const property = $a65[$i65];
            if (p.willPrintExprCommentsAtLoc(property.loc)) {
              isMultiLine = true;
              break;
            }
          }
        }
        p.addSourceMapping(binding.loc);
        p.print("{");
        if (b.properties.length > 0 || isMultiLine) {
          if (isMultiLine) {
            p.options.indent++;
          }

          for (let i = 0; i < b.properties.length; i++) {
            const property = b.properties[i];
            if (i !== 0) {
              p.print(",");
            }
            if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
              if (isMultiLine) {
                p.printNewline();
                p.printIndent();
              } else {
                p.printSpace();
              }
            }

            p.printExprCommentsAtLoc(property.loc);

            if (property.isSpread) {
              p.addSourceMapping(property.loc);
              p.print("...");
              p.printExprCommentsAtLoc(property.value.loc);
            } else {
              if (property.isComputed) {
                p.addSourceMapping(property.loc);
                const isMultiLine = p.willPrintExprCommentsAtLoc(property.key.loc) || p.willPrintExprCommentsAtLoc(property.closeBracketLoc);
                p.print("[");
                if (isMultiLine) {
                  p.printNewline();
                  p.options.indent++;
                  p.printIndent();
                }
                p.printExpr(property.key, LComma, 0);
                if (isMultiLine) {
                  p.printNewline();
                  p.printExprCommentsAfterCloseTokenAtLoc(property.closeBracketLoc);
                  p.options.indent--;
                  p.printIndent();
                }
                if (property.closeBracketLoc > property.loc) {
                  p.addSourceMapping(property.closeBracketLoc);
                }
                p.print("]:");
                p.printSpace();
                p.printBinding(property.value);

                if (property.defaultValueOrNil !== null) {
                  p.printSpace();
                  p.print("=");
                  p.printSpace();
                  p.printExprWithoutLeadingNewline(property.defaultValueOrNil, LComma, 0);
                }
                continue;
              }

              const key = property.key.data;
              if (key.k === E_STRING && !property.preferQuotedKey && p.canPrintIdentifierUTF16(key.value)) {
                // Use a shorthand property if the names are the same
                const id = property.value.data;
                if (
                  id.k === B_IDENTIFIER &&
                  !p.willPrintExprCommentsAtLoc(property.value.loc) &&
                  key.value === p.renamer.nameForSymbol(id.ref)
                ) {
                  if (p.addSourceMappings) {
                    p.addSourceMappingForName(property.key.loc, key.value, id.ref);
                  }
                  p.printIdentifierUTF16(key.value);
                  if (property.defaultValueOrNil !== null) {
                    p.printSpace();
                    p.print("=");
                    p.printSpace();
                    p.printExprWithoutLeadingNewline(property.defaultValueOrNil, LComma, 0);
                  }
                  continue;
                }

                p.addSourceMapping(property.key.loc);
                p.printIdentifierUTF16(key.value);
              } else if (key.k === E_NAME_OF_SYMBOL) {
                const name = p.mangledPropName(key.ref);
                if (p.canPrintIdentifier(name)) {
                  p.addSourceMappingForName(property.key.loc, name, key.ref);
                  p.printIdentifier(name);

                  // Use a shorthand property if the names are the same
                  const id = property.value.data;
                  if (
                    id.k === B_IDENTIFIER &&
                    !p.willPrintExprCommentsAtLoc(property.value.loc) &&
                    name === p.renamer.nameForSymbol(id.ref)
                  ) {
                    if (property.defaultValueOrNil !== null) {
                      p.printSpace();
                      p.print("=");
                      p.printSpace();
                      p.printExprWithoutLeadingNewline(property.defaultValueOrNil, LComma, 0);
                    }
                    continue;
                  }
                } else {
                  p.addSourceMapping(property.key.loc);
                  p.printQuotedUTF8(name, 0);
                }
              } else {
                p.printExpr(property.key, LLowest, 0);
              }

              p.print(":");
              p.printSpace();
            }
            p.printBinding(property.value);

            if (property.defaultValueOrNil !== null) {
              p.printSpace();
              p.print("=");
              p.printSpace();
              p.printExprWithoutLeadingNewline(property.defaultValueOrNil, LComma, 0);
            }
          }

          if (isMultiLine) {
            p.printNewline();
            p.printExprCommentsAfterCloseTokenAtLoc(b.closeBraceLoc);
            p.options.indent--;
            p.printIndent();
          } else {
            // This block is only reached if len(b.Properties) > 0
            p.printSpace();
          }
        }
        p.addSourceMapping(b.closeBraceLoc);
        p.print("}");
        break;
      }

      default:
        // Go: panic("Unexpected binding of type ...")
        throw new GoPanic("Unexpected binding of type " + goTypeName("js_ast", b));
    }
  }

  printSpace() {
    if (!this.options.minifyWhitespace) {
      this.print(" ");
    }
  }

  printNewline() {
    if (!this.options.minifyWhitespace) {
      this.print("\n");
    }
  }

  // (The output buffer holds UTF-8 bytes, so this is Go's byte-based length)
  currentLineLength() {
    const p = this;
    const js = p.jsBuf;
    const n = p.jsLen;
    const stop = p.oldLineEnd;

    // Update "oldLineStart" to the start of the current line
    for (let i = n; i > stop; i--) {
      const c = js[i - 1];
      if (c === 13 || c === 10) {
        p.oldLineStart = i;
        break;
      }
    }

    p.oldLineEnd = n;
    return n - p.oldLineStart;
  }

  printNewlinePastLineLimit() {
    const p = this;
    if (p.currentLineLength() < p.options.lineLimit) {
      return false;
    }
    p.print("\n");
    p.printIndent();
    return true;
  }

  printSpaceBeforeOperator(next) {
    const p = this;
    if (p.prevOpEnd === p.jsLen) {
      const prev = p.prevOp;

      // "+ + y" => "+ +y"
      // "+ ++ y" => "+ ++y"
      // "x + + y" => "x+ +y"
      // "x ++ + y" => "x+++y"
      // "x + ++ y" => "x+ ++y"
      // "-- >" => "-- >"
      // "< ! --" => "<! --"
      if (
        ((prev === BinOpAdd || prev === UnOpPos) && (next === BinOpAdd || next === UnOpPos || next === UnOpPreInc)) ||
        ((prev === BinOpSub || prev === UnOpNeg) && (next === BinOpSub || next === UnOpNeg || next === UnOpPreDec)) ||
        (prev === UnOpPostDec && next === BinOpGt) ||
        (prev === UnOpNot && next === UnOpPreDec && p.jsLen > 1 && p.jsBuf[p.jsLen - 2] === 60)
      ) {
        p.print(" ");
      }
    }
  }

  printSemicolonAfterStatement() {
    if (!this.options.minifyWhitespace) {
      this.print(";\n");
    } else {
      this.needsSemicolon = true;
    }
  }

  printSemicolonIfNeeded() {
    if (this.needsSemicolon) {
      this.print(";");
      this.needsSemicolon = false;
    }
  }

  printSpaceBeforeIdentifier() {
    const c = this.lastChar();
    if ((c < 0x80 ? identContinueASCII[c] === 1 : isIdentifierContinue(this.lastCodePoint())) || this.prevRegExpEnd === this.jsLen) {
      this.print(" ");
    }
  }

  // Go takes a fnArgsOpts struct; its fields are passed positionally here
  // (openParenLoc and addMappingForOpenParenLoc are only used by arrows).
  printFnArgs(args, hasRestArg, isArrow, openParenLoc = 0, addMappingForOpenParenLoc = false) {
    const p = this;
    let wrap = true;

    // Minify "(a) => {}" as "a=>{}"
    if (p.options.minifyWhitespace && !hasRestArg && isArrow && args.length === 1) {
      if (args[0].binding.data.k === B_IDENTIFIER && args[0].defaultOrNil === null) {
        wrap = false;
      }
    }

    if (wrap) {
      if (addMappingForOpenParenLoc) {
        p.addSourceMapping(openParenLoc);
      }
      p.print("(");
    }

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (i !== 0) {
        p.print(",");
        p.printSpace();
      }
      p.printDecorators(arg.decorators, printSpaceAfterDecorator);
      if (hasRestArg && i + 1 === args.length) {
        p.print("...");
      }
      p.printBinding(arg.binding);

      if (arg.defaultOrNil !== null) {
        p.printSpace();
        p.print("=");
        p.printSpace();
        p.printExprWithoutLeadingNewline(arg.defaultOrNil, LComma, 0);
      }
    }

    if (wrap) {
      p.print(")");
    }
  }

  printFn(fn) {
    this.printFnArgs(fn.args, fn.hasRestArg, false);
    this.printSpace();
    this.printBlock(fn.body.loc, fn.body.block);
  }

  // Returns omitIndentAfter
  printDecorators(decorators, defaultMode) {
    const p = this;
    let oldMode = defaultMode;
    if (decorators === null) {
      return oldMode === printSpaceAfterDecorator;
    }

    for (const decorator of decorators) {
      let wrap = false;
      let wasCallTarget = false;
      let expr = decorator.value;
      let mode = defaultMode;
      if (decorator.omitNewlineAfter) {
        mode = printSpaceAfterDecorator;
      }

      outer: for (;;) {
        const isCallTarget = wasCallTarget;
        wasCallTarget = false;

        const e = expr.data;
        switch (e.k) {
          case E_IDENTIFIER:
            // "@foo"
            break outer;

          case E_CALL:
            // "@foo()"
            expr = e.target;
            wasCallTarget = true;
            continue;

          case E_DOT:
            // "@foo.bar"
            if (p.canPrintIdentifier(e.name)) {
              expr = e.target;
              continue;
            }

            // "@foo.<non-identifier>" => "@(foo['<non-identifier>'])"
            break;

          case E_INDEX:
            if (e.index.data.k === E_PRIVATE_IDENTIFIER) {
              // "@foo.#bar"
              expr = e.target;
              continue;
            }

            // "@(foo[bar])"
            break;

          case E_IMPORT_IDENTIFIER: {
            const ref = followSymbols(p.symbols, e.ref);
            const symbol = p.symbols.get(ref);

            if (symbol.importItemStatus === ImportItemMissing) {
              // "@(void 0)"
              break;
            }

            if (symbol.namespaceAlias !== null && isCallTarget && e.wasOriginallyIdentifier) {
              // "@((0, import_ns.fn)())"
              break;
            }

            if (p.constValue(ref) !== null) {
              // "@(<inlined constant>)"
              break;
            }

            // "@foo"
            // "@import_ns.fn"
            break outer;
          }

          default:
            // "@(foo + bar)"
            // "@(() => {})"
            break;
        }

        wrap = true;
        break outer;
      }

      p.addSourceMapping(decorator.atLoc);
      if (oldMode === printNewlineAfterDecorator) {
        p.printIndent();
      }

      p.print("@");
      if (wrap) {
        p.print("(");
      }
      p.printExpr(decorator.value, LLowest, 0);
      if (wrap) {
        p.print(")");
      }

      switch (mode) {
        case printNewlineAfterDecorator:
          p.printNewline();
          break;

        case printSpaceAfterDecorator:
          p.printSpace();
          break;
      }
      oldMode = mode;
    }

    return oldMode === printSpaceAfterDecorator;
  }

  printClass(class_) {
    const p = this;
    if (class_.extendsOrNil !== null) {
      p.print(" extends");
      p.printSpace();
      p.printExpr(class_.extendsOrNil, LNew - 1, 0);
    }
    p.printSpace();

    p.addSourceMapping(class_.bodyLoc);
    p.print("{");
    p.printNewline();
    p.options.indent++;

    for (let $i66 = 0, $a66 = class_.properties; $i66 < $a66.length; $i66++) {
      const item = $a66[$i66];
      p.printSemicolonIfNeeded();
      const omitIndent = p.printDecorators(item.decorators, printNewlineAfterDecorator);
      if (!omitIndent) {
        p.printIndent();
      }

      if (item.kind === PropertyClassStaticBlock) {
        p.addSourceMapping(item.loc);
        p.print("static");
        p.printSpace();
        p.printBlock(item.classStaticBlock.loc, item.classStaticBlock.block);
        p.printNewline();
        continue;
      }

      p.printProperty(item);

      // Need semicolons after class fields
      if (item.valueOrNil === null) {
        p.printSemicolonAfterStatement();
      } else {
        p.printNewline();
      }
    }

    p.needsSemicolon = false;
    p.printExprCommentsAfterCloseTokenAtLoc(class_.closeBraceLoc);
    p.options.indent--;
    p.printIndent();
    if (class_.closeBraceLoc > class_.bodyLoc) {
      p.addSourceMapping(class_.closeBraceLoc);
    }
    p.print("}");
  }

  printProperty(property) {
    const p = this;
    p.printExprCommentsAtLoc(property.loc);

    if (property.kind === PropertySpread) {
      p.addSourceMapping(property.loc);
      p.print("...");
      p.printExpr(property.valueOrNil, LComma, 0);
      return;
    }

    // Handle key syntax compression for cross-module constant inlining of enums
    // (Go mutates its copy of the property: "propertyKey" and "propertyFlags"
    // are that copy's Key and Flags)
    let propertyKey = property.key;
    let propertyFlags = property.flags;
    let keyFlags = 0;
    if (p.options.minifySyntax && (propertyFlags & PropertyIsComputed) !== 0) {
      propertyKey = p.lateConstantFoldUnaryOrBinaryOrIfExpr(propertyKey);
      keyFlags |= parentWasUnaryOrBinaryOrIfTest;

      if (propertyKey.data.k === E_INLINED_ENUM) {
        propertyKey = propertyKey.data.value;
      }

      // Remove the computed flag if it's no longer needed
      const key = propertyKey.data;
      switch (key.k) {
        case E_NUMBER:
          propertyFlags &= ~PropertyIsComputed;
          break;

        case E_STRING:
          if (key.value !== "__proto__" && key.value !== "constructor" && key.value !== "prototype") {
            propertyFlags &= ~PropertyIsComputed;
          }
          break;
      }
    }

    if ((propertyFlags & PropertyIsStatic) !== 0) {
      p.printSpaceBeforeIdentifier();
      p.addSourceMapping(property.loc);
      p.print("static");
      p.printSpace();
    }

    switch (property.kind) {
      case PropertyGetter:
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(property.loc);
        p.print("get");
        p.printSpace();
        break;

      case PropertySetter:
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(property.loc);
        p.print("set");
        p.printSpace();
        break;

      case PropertyAutoAccessor:
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(property.loc);
        p.print("accessor");
        p.printSpace();
        break;
    }

    const value = property.valueOrNil;
    const isMethodFn = value !== null && value.data.k === E_FUNCTION && propertyKindIsMethodDefinition(property.kind);
    if (isMethodFn) {
      const fn = value.data.fn;
      if (fn.isAsync) {
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(property.loc);
        p.print("async");
        p.printSpace();
      }
      if (fn.isGenerator) {
        p.addSourceMapping(property.loc);
        p.print("*");
      }
    }

    let isComputed = (propertyFlags & PropertyIsComputed) !== 0;

    // Automatically print numbers that would cause a syntax error as computed properties
    if (!isComputed) {
      const key = propertyKey.data;
      if (key.k === E_NUMBER) {
        if (signbit(key.value) || (key.value === Infinity && p.options.minifySyntax)) {
          // "{ -1: 0 }" must be printed as "{ [-1]: 0 }"
          // "{ 1/0: 0 }" must be printed as "{ [1/0]: 0 }"
          isComputed = true;
        }
      }
    }

    if (isComputed) {
      p.addSourceMapping(property.loc);
      const isMultiLine = p.willPrintExprCommentsAtLoc(propertyKey.loc) || p.willPrintExprCommentsAtLoc(property.closeBracketLoc);
      p.print("[");
      if (isMultiLine) {
        p.printNewline();
        p.options.indent++;
        p.printIndent();
      }
      p.printExpr(propertyKey, LComma, keyFlags);
      if (isMultiLine) {
        p.printNewline();
        p.printExprCommentsAfterCloseTokenAtLoc(property.closeBracketLoc);
        p.options.indent--;
        p.printIndent();
      }
      if (property.closeBracketLoc > property.loc) {
        p.addSourceMapping(property.closeBracketLoc);
      }
      p.print("]");

      if (value !== null) {
        if (isMethodFn) {
          p.printFn(value.data.fn);
          return;
        }

        p.print(":");
        p.printSpace();
        p.printExprWithoutLeadingNewline(value, LComma, 0);
      }

      if (property.initializerOrNil !== null) {
        p.printSpace();
        p.print("=");
        p.printSpace();
        p.printExprWithoutLeadingNewline(property.initializerOrNil, LComma, 0);
      }
      return;
    }

    const key = propertyKey.data;
    switch (key.k) {
      case E_PRIVATE_IDENTIFIER: {
        const name = p.renamer.nameForSymbol(key.ref);
        p.addSourceMappingForName(propertyKey.loc, name, key.ref);
        p.printIdentifier(name);
        break;
      }

      case E_NAME_OF_SYMBOL: {
        const name = p.mangledPropName(key.ref);
        if (p.canPrintIdentifier(name)) {
          p.printSpaceBeforeIdentifier();
          p.addSourceMappingForName(propertyKey.loc, name, key.ref);
          p.printIdentifier(name);

          // Use a shorthand property if the names are the same
          if (!jsFeatureHas(p.options.unsupportedFeatures, ObjectExtensions) && value !== null && !p.willPrintExprCommentsAtLoc(value.loc)) {
            const e = value.data;
            switch (e.k) {
              case E_IDENTIFIER:
                if (name === p.renamer.nameForSymbol(e.ref)) {
                  if (property.initializerOrNil !== null) {
                    p.printSpace();
                    p.print("=");
                    p.printSpace();
                    p.printExprWithoutLeadingNewline(property.initializerOrNil, LComma, 0);
                  }
                  return;
                }
                break;

              case E_IMPORT_IDENTIFIER: {
                // Make sure we're not using a property access instead of an identifier
                const ref = followSymbols(p.symbols, e.ref);
                const symbol = p.symbols.get(ref);
                if (symbol.namespaceAlias === null && name === p.renamer.nameForSymbol(ref) && p.constValue(ref) === null) {
                  if (property.initializerOrNil !== null) {
                    p.printSpace();
                    p.print("=");
                    p.printSpace();
                    p.printExprWithoutLeadingNewline(property.initializerOrNil, LComma, 0);
                  }
                  return;
                }
                break;
              }
            }
          }
        } else {
          p.addSourceMapping(propertyKey.loc);
          p.printQuotedUTF8(name, 0);
        }
        break;
      }

      case E_STRING: {
        if ((propertyFlags & PropertyPreferQuotedKey) === 0 && p.canPrintIdentifierUTF16(key.value)) {
          p.printSpaceBeforeIdentifier();

          // Use a shorthand property if the names are the same
          if (!jsFeatureHas(p.options.unsupportedFeatures, ObjectExtensions) && value !== null && !p.willPrintExprCommentsAtLoc(value.loc)) {
            const e = value.data;
            switch (e.k) {
              case E_IDENTIFIER:
                if (canUseShorthandProperty(key.value, p.renamer.nameForSymbol(e.ref), propertyFlags)) {
                  if (p.addSourceMappings) {
                    p.addSourceMappingForName(propertyKey.loc, key.value, e.ref);
                  }
                  p.printIdentifierUTF16(key.value);
                  if (property.initializerOrNil !== null) {
                    p.printSpace();
                    p.print("=");
                    p.printSpace();
                    p.printExprWithoutLeadingNewline(property.initializerOrNil, LComma, 0);
                  }
                  return;
                }
                break;

              case E_IMPORT_IDENTIFIER: {
                // Make sure we're not using a property access instead of an identifier
                const ref = followSymbols(p.symbols, e.ref);
                const symbol = p.symbols.get(ref);
                if (
                  symbol.namespaceAlias === null &&
                  canUseShorthandProperty(key.value, p.renamer.nameForSymbol(ref), propertyFlags) &&
                  p.constValue(ref) === null
                ) {
                  if (p.addSourceMappings) {
                    p.addSourceMappingForName(propertyKey.loc, key.value, ref);
                  }
                  p.printIdentifierUTF16(key.value);
                  if (property.initializerOrNil !== null) {
                    p.printSpace();
                    p.print("=");
                    p.printSpace();
                    p.printExprWithoutLeadingNewline(property.initializerOrNil, LComma, 0);
                  }
                  return;
                }
                break;
              }
            }
          }

          // The JavaScript specification special-cases the property identifier
          // "__proto__" with a colon after it to set the prototype of the object.
          // If we keep the identifier but add a colon then we'll cause a behavior
          // change because the prototype will now be set. Avoid using an identifier
          // by using a computed property with a string instead. For more info see:
          // https://tc39.es/ecma262/#sec-runtime-semantics-propertydefinitionevaluation
          if (
            (propertyFlags & PropertyWasShorthand) !== 0 &&
            !jsFeatureHas(p.options.unsupportedFeatures, ObjectExtensions) &&
            key.value === "__proto__"
          ) {
            p.print("[");
            p.addSourceMapping(propertyKey.loc);
            p.printQuotedUTF16(key.value, 0);
            p.print("]");
            break;
          }

          p.addSourceMapping(propertyKey.loc);
          p.printIdentifierUTF16(key.value);
        } else {
          p.addSourceMapping(propertyKey.loc);
          p.printQuotedUTF16(key.value, 0);
        }
        break;
      }

      default:
        p.printExpr(propertyKey, LLowest, keyFlags);
    }

    if (isMethodFn) {
      p.printFn(value.data.fn);
      return;
    }

    if (value !== null) {
      p.print(":");
      p.printSpace();
      p.printExprWithoutLeadingNewline(value, LComma, 0);
    }

    if (property.initializerOrNil !== null) {
      p.printSpace();
      p.print("=");
      p.printSpace();
      p.printExprWithoutLeadingNewline(property.initializerOrNil, LComma, 0);
    }
  }

  printQuotedUTF16(data, flags) {
    if (jsFeatureHas(this.options.unsupportedFeatures, TemplateLiteral)) {
      flags &= ~printQuotedAllowBacktick;
    }

    let singleCost = 0;
    let doubleCost = 0;
    let backtickCost = 0;

    const n = data.length;
    for (let i = 0; i < n; i++) {
      switch (data.charCodeAt(i)) {
        case 0x0a:
          if (this.options.minifySyntax) {
            // The backslash for the newline costs an extra character for old-style
            // string literals when compared to a template literal
            backtickCost--;
          }
          break;
        case 0x27:
          singleCost++;
          break;
        case 0x22:
          doubleCost++;
          break;
        case 0x60:
          backtickCost++;
          break;
        case 0x24:
          // "${" sequences need to be escaped in template literals
          if (i + 1 < n && data.charCodeAt(i + 1) === 0x7b) {
            backtickCost++;
          }
          break;
      }
    }

    let c = '"';
    let quote = 0x22;
    if (doubleCost > singleCost) {
      c = "'";
      quote = 0x27;
      if (singleCost > backtickCost && (flags & printQuotedAllowBacktick) !== 0) {
        c = "`";
        quote = 0x60;
      }
    } else if (doubleCost > backtickCost && (flags & printQuotedAllowBacktick) !== 0) {
      c = "`";
      quote = 0x60;
    }

    this.print(c);
    this.printUnquotedUTF16(data, quote, flags);
    this.print(c);
  }

  // Go uses "defer" for the closing tokens; here they are printed explicitly on
  // every exit path in the same (LIFO) order.
  printRequireOrImportExpr(importRecordIndex, level, flags, closeParenLoc, phase) {
    const p = this;
    const record = p.importRecords[importRecordIndex];

    let deferWrapParen = false;
    if (level >= LNew || (flags & isNewTarget) !== 0) {
      p.print("(");
      deferWrapParen = true;
      level = LLowest;
    }

    if (record.sourceIndex < 0) {
      // External "require()"
      if (record.kind !== ImportDynamic) {
        // Wrap this with a call to "__toESM()" if this is a CommonJS file
        const wrapWithToESM = (record.flags & WrapWithToESM) !== 0;
        if (wrapWithToESM) {
          p.printSpaceBeforeIdentifier();
          p.printIdentifier(p.renamer.nameForSymbol(p.options.toESMRef));
          p.print("(");
        }

        // Potentially substitute our own "__require" stub for "require"
        p.printSpaceBeforeIdentifier();
        if ((record.flags & CallRuntimeRequire) !== 0) {
          p.printIdentifier(p.renamer.nameForSymbol(p.options.runtimeRequireRef));
        } else {
          p.print("require");
        }

        const isMultiLine = p.willPrintExprCommentsAtLoc(record.range.loc) || p.willPrintExprCommentsAtLoc(closeParenLoc);
        p.print("(");
        if (isMultiLine) {
          p.printNewline();
          p.options.indent++;
          p.printIndent();
        }
        p.printExprCommentsAtLoc(record.range.loc);
        p.printPath(importRecordIndex, ImportRequire);
        if (isMultiLine) {
          p.printNewline();
          p.printExprCommentsAfterCloseTokenAtLoc(closeParenLoc);
          p.options.indent--;
          p.printIndent();
        }
        if (closeParenLoc > record.range.loc) {
          p.addSourceMapping(closeParenLoc);
        }
        p.print(")");

        // Finish the call to "__toESM()"
        if (wrapWithToESM) {
          if (moduleTypeIsESM(p.moduleType)) {
            p.print(",");
            p.printSpace();
            p.print("1");
          }
          p.print(")");
        }
        if (deferWrapParen) p.print(")");
        return;
      }

      // External "import()"
      let kind = ImportDynamic;
      const dynamicImportOK = !jsFeatureHas(p.options.unsupportedFeatures, DynamicImport);
      let deferDotThenSuffix = false;
      let deferToESMSuffix = false;
      if (dynamicImportOK) {
        p.printSpaceBeforeIdentifier();
        switch (phase) {
          case DeferPhase:
            p.print("import.defer(");
            break;
          case SourcePhase:
            p.print("import.source(");
            break;
          default:
            p.print("import(");
        }
      } else {
        kind = ImportRequire;
        p.printSpaceBeforeIdentifier();
        p.print("Promise.resolve()");
        p.printDotThenPrefix();
        deferDotThenSuffix = true;

        // Wrap this with a call to "__toESM()" if this is a CommonJS file
        if ((record.flags & WrapWithToESM) !== 0) {
          p.printSpaceBeforeIdentifier();
          p.printIdentifier(p.renamer.nameForSymbol(p.options.toESMRef));
          p.print("(");
          deferToESMSuffix = true;
        }

        // Potentially substitute our own "__require" stub for "require"
        p.printSpaceBeforeIdentifier();
        if ((record.flags & CallRuntimeRequire) !== 0) {
          p.printIdentifier(p.renamer.nameForSymbol(p.options.runtimeRequireRef));
        } else {
          p.print("require");
        }

        p.print("(");
      }
      const isMultiLine =
        p.willPrintExprCommentsAtLoc(record.range.loc) ||
        p.willPrintExprCommentsAtLoc(closeParenLoc) ||
        (record.assertOrWith !== null &&
          dynamicImportOK &&
          (!jsFeatureHas(p.options.unsupportedFeatures, ImportAssertions) ||
            !jsFeatureHas(p.options.unsupportedFeatures, ImportAttributes)) &&
          p.willPrintExprCommentsAtLoc(record.assertOrWith.outerOpenBraceLoc));
      if (isMultiLine) {
        p.printNewline();
        p.options.indent++;
        p.printIndent();
      }
      p.printExprCommentsAtLoc(record.range.loc);
      p.printPath(importRecordIndex, kind);
      if (dynamicImportOK) {
        p.printImportCallAssertOrWith(record.assertOrWith, isMultiLine);
      }
      if (isMultiLine) {
        p.printNewline();
        p.printExprCommentsAfterCloseTokenAtLoc(closeParenLoc);
        p.options.indent--;
        p.printIndent();
      }
      if (closeParenLoc > record.range.loc) {
        p.addSourceMapping(closeParenLoc);
      }
      p.print(")");

      // Deferred calls, in reverse order of registration
      if (deferToESMSuffix) {
        if (moduleTypeIsESM(p.moduleType)) {
          p.print(",");
          p.printSpace();
          p.print("1");
        }
        p.print(")");
      }
      if (deferDotThenSuffix) p.printDotThenSuffix();
      if (deferWrapParen) p.print(")");
      return;
    }

    const meta = p.options.requireOrImportMetaForSource(record.sourceIndex);

    // Don't need the namespace object if the result is unused anyway
    // (Go mutates its local copy of "meta")
    let exportsRef = meta.exportsRef;
    if ((flags & exprResultIsUnused) !== 0) {
      exportsRef = InvalidRef;
    }

    // Internal "import()" of async ESM
    if (record.kind === ImportDynamic && meta.isWrapperAsync) {
      p.printSpaceBeforeIdentifier();
      p.printIdentifier(p.renamer.nameForSymbol(meta.wrapperRef));
      p.print("()");
      if (exportsRef !== InvalidRef) {
        p.printDotThenPrefix();
        p.printSpaceBeforeIdentifier();
        p.printIdentifier(p.renamer.nameForSymbol(exportsRef));
        p.printDotThenSuffix();
      }
      if (deferWrapParen) p.print(")");
      return;
    }

    // Internal "require()" or "import()"
    let deferDotThenSuffix = false;
    if (record.kind === ImportDynamic) {
      p.printSpaceBeforeIdentifier();
      p.print("Promise.resolve()");
      level = p.printDotThenPrefix();
      deferDotThenSuffix = true;
    }

    // Make sure the comma operator is properly wrapped
    let deferCommaParen = false;
    if (exportsRef !== InvalidRef && level >= LComma) {
      p.print("(");
      deferCommaParen = true;
    }

    // Wrap this with a call to "__toESM()" if this is a CommonJS file
    const wrapWithToESM = (record.flags & WrapWithToESM) !== 0;
    if (wrapWithToESM) {
      p.printSpaceBeforeIdentifier();
      p.printIdentifier(p.renamer.nameForSymbol(p.options.toESMRef));
      p.print("(");
    }

    // Call the wrapper
    p.printSpaceBeforeIdentifier();
    p.printIdentifier(p.renamer.nameForSymbol(meta.wrapperRef));
    p.print("()");

    // Return the namespace object if this is an ESM file
    if (exportsRef !== InvalidRef) {
      p.print(",");
      p.printSpace();

      // Wrap this with a call to "__toCommonJS()" if this is an ESM file
      const wrapWithTpCJS = (record.flags & WrapWithToCJS) !== 0;
      if (wrapWithTpCJS) {
        p.printIdentifier(p.renamer.nameForSymbol(p.options.toCommonJSRef));
        p.print("(");
      }
      p.printIdentifier(p.renamer.nameForSymbol(exportsRef));
      if (wrapWithTpCJS) {
        p.print(")");
      }
    }

    // Finish the call to "__toESM()"
    if (wrapWithToESM) {
      if (moduleTypeIsESM(p.moduleType)) {
        p.print(",");
        p.printSpace();
        p.print("1");
      }
      p.print(")");
    }

    // Deferred calls, in reverse order of registration
    if (deferCommaParen) p.print(")");
    if (deferDotThenSuffix) p.printDotThenSuffix();
    if (deferWrapParen) p.print(")");
  }

  printDotThenPrefix() {
    const p = this;
    if (jsFeatureHas(p.options.unsupportedFeatures, Arrow)) {
      p.print(".then(function()");
      p.printSpace();
      p.print("{");
      p.printNewline();
      p.options.indent++;
      p.printIndent();
      p.print("return");
      p.printSpace();
      return LLowest;
    } else {
      p.print(".then(()");
      p.printSpace();
      p.print("=>");
      p.printSpace();
      return LComma;
    }
  }

  printDotThenSuffix() {
    const p = this;
    if (jsFeatureHas(p.options.unsupportedFeatures, Arrow)) {
      if (!p.options.minifyWhitespace) {
        p.print(";");
      }
      p.printNewline();
      p.options.indent--;
      p.printIndent();
      p.print("})");
    } else {
      p.print(")");
    }
  }

  printUndefined(loc, level) {
    const p = this;
    if (level >= LPrefix) {
      p.addSourceMapping(loc);
      p.print("(void 0)");
    } else {
      p.printSpaceBeforeIdentifier();
      p.addSourceMapping(loc);
      p.print("void 0");
    }
  }

  // Call this before printing an expression to see if it turned out to be empty.
  // We use this to do inlining of empty functions at print time. It can't happen
  // during parse time because a) parse time only has two passes and we only know
  // if a function can be inlined at the end of the second pass (due to is-mutated
  // analysis) and b) we want to enable cross-module inlining of empty functions
  // which has to happen after linking.
  //
  // This function returns "nil" to indicate that the expression should be removed
  // completely.
  //
  // This function doesn't need to search everywhere inside the entire expression
  // for calls to inline. Calls are automatically inlined when printed. However,
  // the printer replaces the call with "undefined" since the result may still
  // be needed by the caller. If the caller knows that it doesn't need the result,
  // it should call this function first instead so we don't print "undefined".
  //
  // This is a separate function instead of trying to work this logic into the
  // printer because it's too late to eliminate the expression entirely when we're
  // in the printer. We may have already printed the leading indent, for example.
  //
  // Port note: the only rewrites happen for calls to symbols flagged
  // IsEmptyFunction / IsIdentityFunction. JS-only: when no symbol has either
  // flag at all (checked once in print()) nothing can change, so this returns
  // right away. Comma chains are handled by simplifyUnusedCommaChain.
  simplifyUnusedExpr(expr) {
    const p = this;
    if (!p.hasInlinableCalls) {
      return expr;
    }
    const e = expr.data;
    switch (e.k) {
      case E_BINARY:
        // Calls to be inlined may be hidden inside a comma operator chain
        if (e.op === BinOpComma) {
          return p.simplifyUnusedCommaChain(expr);
        }
        break;

      case E_CALL: {
        let symbolFlags = 0;
        const target = e.target.data;
        switch (target.k) {
          case E_IDENTIFIER:
            symbolFlags = p.symbols.get(target.ref).flags;
            break;
          case E_IMPORT_IDENTIFIER: {
            const ref = followSymbols(p.symbols, target.ref);
            symbolFlags = p.symbols.get(ref).flags;
            break;
          }
        }

        // Replace non-mutated empty functions with their arguments at print time
        if ((symbolFlags & (IsEmptyFunction | CouldPotentiallyBeMutated)) === IsEmptyFunction) {
          let replacement = null;
          for (let i = 0; i < e.args.length; i++) {
            let arg = e.args[i];
            if (arg.data.k === E_SPREAD) {
              arg = new Expr(new EArray([arg], 0, 0, true), arg.loc);
            }
            replacement = joinWithComma(replacement, p.astHelpers.simplifyUnusedExpr(p.simplifyUnusedExpr(arg), p.options.unsupportedFeatures));
          }
          return replacement; // Don't add "undefined" here because the result isn't used
        }

        // Inline non-mutated identity functions at print time
        if ((symbolFlags & (IsIdentityFunction | CouldPotentiallyBeMutated)) === IsIdentityFunction && e.args.length === 1) {
          const arg = e.args[0];
          if (arg.data.k !== E_SPREAD) {
            return p.astHelpers.simplifyUnusedExpr(p.simplifyUnusedExpr(arg), p.options.unsupportedFeatures);
          }
        }
        break;
      }
    }

    return expr;
  }

  // The comma case of Go's simplifyUnusedExpr:
  //
  //   left := p.simplifyUnusedExpr(e.Left)
  //   right := p.simplifyUnusedExpr(e.Right)
  //   if left.Data != e.Left.Data || right.Data != e.Right.Data {
  //     return js_ast.JoinWithComma(left, right)
  //   }
  //   return expr
  //
  // JS-only: this walks the left spine of the chain iteratively (no JS stack
  // overflow on very long chains) in the same evaluation order (the leftmost
  // operand first, then the right operands from the innermost comma out).
  // The result is a pure function of the subtree (the printer never mutates
  // the AST and symbol flags do not change while printing), so the comma
  // nodes that come back unchanged are remembered: Go re-simplifies the left
  // operand at every level of a chain (see checkAndPrepare), which is O(n^2).
  simplifyUnusedCommaChain(expr) {
    const p = this;
    let memo = p.unchangedByInlining;
    if (memo === null) {
      memo = new Set();
      p.unchangedByInlining = memo;
    }
    const spine = [];
    let current = expr;
    while (current.data.k === E_BINARY && current.data.op === BinOpComma && !memo.has(current.data)) {
      spine.push(current);
      current = current.data.left;
    }
    let result = current.data.k === E_BINARY && current.data.op === BinOpComma ? current : p.simplifyUnusedExpr(current);
    for (let i = spine.length - 1; i >= 0; i--) {
      const node = spine[i];
      const e = node.data;
      const left = result;
      const right = p.simplifyUnusedExpr(e.right);
      if (exprData(left) !== e.left.data || exprData(right) !== e.right.data) {
        result = joinWithComma(left, right);
      } else {
        memo.add(e);
        result = node;
      }
    }
    return result;
  }

  // This assumes the original expression was some form of indirect value, such
  // as a value returned from a function call or the result of a comma operator.
  // In this case, there is no special behavior with the "delete" operator or
  // with function calls. If we substitute this indirect value for another value
  // due to inlining, we have to make sure we don't accidentally introduce special
  // behavior.
  guardAgainstBehaviorChangeDueToSubstitution(expr, flags) {
    const p = this;
    let wrap = false;

    if ((flags & isDeleteTarget) !== 0) {
      // "delete id(x)" must not become "delete x"
      // "delete (empty(), x)" must not become "delete x"
      const binary = exprData(expr);
      if (binary === null || binary.k !== E_BINARY || binary.op !== BinOpComma) {
        wrap = true;
      }
    } else if ((flags & isCallTargetOrTemplateTag) !== 0) {
      // "id(x.y)()" must not become "x.y()"
      // "id(x.y)``" must not become "x.y``"
      // "(empty(), x.y)()" must not become "x.y()"
      // "(empty(), eval)()" must not become "eval()"
      switch (exprData(expr) === null ? 0 : expr.data.k) {
        case E_DOT:
        case E_INDEX:
          wrap = true;
          break;
        case E_IDENTIFIER:
          if (p.isUnboundEvalIdentifier(expr)) {
            wrap = true;
          }
          break;
      }
    }

    if (wrap) {
      const loc = expr === null ? 0 : expr.loc;
      expr = new Expr(new EBinary(new Expr(new ENumber(0), loc), expr, BinOpComma), loc);
    }

    return expr;
  }

  // Constant folding is already implemented once in the parser. A smaller form
  // of constant folding (just for numbers) is implemented here to clean up cross-
  // module numeric constants and bitwise operations. This is not a general-
  // purpose/optimal approach and never will be. For example, we can't affect
  // tree shaking at this stage because it has already happened.
  lateConstantFoldUnaryOrBinaryOrIfExpr(expr) {
    const p = this;
    const e = expr.data;
    switch (e.k) {
      case E_IMPORT_IDENTIFIER: {
        const ref = followSymbols(p.symbols, e.ref);
        const value = p.constValue(ref);
        if (value !== null) {
          return constValueToExpr(expr.loc, value);
        }
        break;
      }

      case E_DOT: {
        const value = p.tryToGetImportedEnumValue(e.target, e.name);
        if (value !== null) {
          let inlinedValue;
          if (value.string !== null) {
            inlinedValue = new Expr(new EString(value.string), expr.loc);
          } else {
            inlinedValue = new Expr(new ENumber(value.number), expr.loc);
          }

          if (e.name.includes("*/")) {
            // Don't wrap with a comment
            return inlinedValue;
          }

          // Wrap with a comment
          return new Expr(new EInlinedEnum(inlinedValue, e.name), inlinedValue.loc);
        }
        break;
      }

      case E_UNARY: {
        const value = p.lateConstantFoldUnaryOrBinaryOrIfExpr(e.value);

        // Only fold again if something chained
        if (value.data !== e.value.data) {
          // Only fold certain operations (just like the parser)
          const r = toNumberWithoutSideEffects(value.data);
          if (r[1]) {
            const v = r[0];
            switch (e.op) {
              case UnOpPos:
                return new Expr(new ENumber(v), expr.loc);

              case UnOpNeg:
                return new Expr(new ENumber(-v), expr.loc);

              case UnOpCpl:
                return new Expr(new ENumber(~toInt32(v)), expr.loc);
            }
          }

          // Don't mutate the original AST
          expr = new Expr(new EUnary(value, e.op), expr.loc);
        }
        break;
      }

      case E_BINARY: {
        const left = p.lateConstantFoldUnaryOrBinaryOrIfExpr(e.left);
        const right = p.lateConstantFoldUnaryOrBinaryOrIfExpr(e.right);

        // Only fold again if something changed
        if (left.data !== e.left.data || right.data !== e.right.data) {
          const binary = new EBinary(left, right, e.op);

          // Only fold certain operations (just like the parser)
          if (shouldFoldBinaryOperatorWhenMinifying(binary)) {
            const result = foldBinaryOperator(expr.loc, binary);
            if (result !== null) {
              return result;
            }
          }

          // Don't mutate the original AST
          expr = new Expr(binary, expr.loc);
        }
        break;
      }

      case E_IF: {
        const test = p.lateConstantFoldUnaryOrBinaryOrIfExpr(e.test);

        // Only fold again if something changed
        if (test.data !== e.test.data) {
          const r = toBooleanWithSideEffects(test.data);
          if (r[2] && r[1] === NoSideEffects) {
            if (r[0]) {
              return p.lateConstantFoldUnaryOrBinaryOrIfExpr(e.yes);
            } else {
              return p.lateConstantFoldUnaryOrBinaryOrIfExpr(e.no);
            }
          }

          // Don't mutate the original AST
          expr = new Expr(new EIf(test, e.yes, e.no), expr.loc);
        }
        break;
      }
    }

    return expr;
  }

  isUnboundIdentifier(expr) {
    const id = expr.data;
    return id.k === E_IDENTIFIER && this.symbols.get(followSymbols(this.symbols, id.ref)).kind === SymbolUnbound;
  }

  isIdentifierOrNumericConstantOrPropertyAccess(expr) {
    const e = expr.data;
    switch (e.k) {
      case E_IDENTIFIER:
      case E_DOT:
      case E_INDEX:
        return true;
      case E_NUMBER:
        return e.value === Infinity || e.value !== e.value;
    }
    return false;
  }

  saveExprStartFlags() {
    const p = this;
    let flags = 0;
    const n = p.jsLen;
    if (p.stmtStart === n) {
      flags |= stmtStartFlag;
    }
    if (p.exportDefaultStart === n) {
      flags |= exportDefaultStartFlag;
    }
    if (p.arrowExprStart === n) {
      flags |= arrowExprStartFlag;
    }
    if (p.forOfInitStart === n) {
      flags |= forOfInitStartFlag;
    }
    return flags;
  }

  restoreExprStartFlags(flags) {
    const p = this;
    if (flags !== 0) {
      const n = p.jsLen;
      if ((flags & stmtStartFlag) !== 0) {
        p.stmtStart = n;
      }
      if ((flags & exportDefaultStartFlag) !== 0) {
        p.exportDefaultStart = n;
      }
      if ((flags & arrowExprStartFlag) !== 0) {
        p.arrowExprStart = n;
      }
      if ((flags & forOfInitStartFlag) !== 0) {
        p.forOfInitStart = n;
      }
    }
  }

  // Print any stored comments that are associated with this location
  printExprCommentsAtLoc(loc) {
    const p = this;
    if (p.options.minifyWhitespace || p.exprComments === null || !mayHaveExprComments(p.exprCommentBits, loc)) {
      return;
    }
    const comments = p.exprComments.get(loc);
    if (comments !== undefined && comments !== null && !p.printedExprComments.has(loc)) {
      const flags = p.saveExprStartFlags();

      // We must never generate a newline before certain expressions. For example,
      // generating a newline before the expression in a "return" statement will
      // cause a semicolon to be inserted, which would change the code's behavior.
      if (p.noLeadingNewlineHere === p.jsLen) {
        for (const comment of comments) {
          if (comment.startsWith("//")) {
            p.print("/*");
            p.print(comment.slice(2));
            if (comment.startsWith("// ")) {
              p.print(" ");
            }
            p.print("*/");
          } else {
            p.print(comment.split("\n").join(""));
          }
          p.printSpace();
        }
      } else {
        for (const comment of comments) {
          p.printIndentedComment(comment);
          p.printIndent();
        }
      }

      // Mark these comments as printed so we don't print them again
      p.printedExprComments.add(loc);

      p.restoreExprStartFlags(flags);
    }
  }

  printExprCommentsAfterCloseTokenAtLoc(loc) {
    const p = this;
    if (p.exprComments === null || !mayHaveExprComments(p.exprCommentBits, loc)) {
      return;
    }
    const comments = p.exprComments.get(loc);
    if (comments !== undefined && comments !== null && !p.printedExprComments.has(loc)) {
      const flags = p.saveExprStartFlags();

      for (const comment of comments) {
        p.printIndent();
        p.printIndentedComment(comment);
      }

      // Mark these comments as printed so we don't print them again
      p.printedExprComments.add(loc);

      p.restoreExprStartFlags(flags);
    }
  }

  printExprWithoutLeadingNewline(expr, level, flags) {
    const p = this;
    if (!p.options.minifyWhitespace && p.willPrintExprCommentsAtLoc(expr.loc)) {
      p.print("(");
      p.printNewline();
      p.options.indent++;
      p.printIndent();
      p.printExpr(expr, level, flags);
      p.printNewline();
      p.options.indent--;
      p.printIndent();
      p.print(")");
      return;
    }

    p.noLeadingNewlineHere = p.jsLen;
    p.printExpr(expr, level, flags);
  }

  // The larger cases of Go's printExpr type switch live in separate methods
  // (printEJSXElement, printECall, ...) to keep this hot function small. Go's
  // printExpr has no code after the switch, so an early "return" in a case is
  // the same as returning from the helper.
  printExpr(expr, level, flags) {
    const p = this;

    // If syntax compression is enabled, do a pre-pass over unary and binary
    // operators to inline bitwise operations of cross-module inlined constants.
    // This makes the output a little tighter if people construct bit masks in
    // other files. This is not a general-purpose constant folding pass. In
    // particular, it has no effect on tree shaking because that pass has already
    // been run.
    //
    // This sets a flag to avoid doing this when the parent is a unary or binary
    // operator so that we don't trigger O(n^2) behavior when traversing over a
    // large expression tree.
    //
    // (JS-only: skipped when it can't change anything, see "canLateFold")
    if (p.options.minifySyntax && (flags & parentWasUnaryOrBinaryOrIfTest) === 0 && p.canLateFold) {
      const k = expr.data.k;
      if (k === E_UNARY || k === E_BINARY || k === E_IF) {
        expr = p.lateConstantFoldUnaryOrBinaryOrIfExpr(expr);
      }
    }

    p.printExprCommentsAtLoc(expr.loc);

    const e = expr.data;
    switch (e.k) {
      case E_MISSING:
        p.addSourceMapping(expr.loc);
        break;

      case E_ANNOTATION:
        p.printExpr(e.value, level, flags);
        break;

      case E_UNDEFINED:
        p.printUndefined(expr.loc, level);
        break;

      case E_SUPER:
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(expr.loc);
        p.print("super");
        break;

      case E_NULL:
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(expr.loc);
        p.print("null");
        break;

      case E_THIS:
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(expr.loc);
        p.print("this");
        break;

      case E_SPREAD:
        p.addSourceMapping(expr.loc);
        p.print("...");
        p.printExpr(e.value, LComma, 0);
        break;

      case E_NEW_TARGET:
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(expr.loc);
        p.print("new.target");
        break;

      case E_IMPORT_META:
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(expr.loc);
        p.print("import.meta");
        break;

      case E_NAME_OF_SYMBOL: {
        const name = p.mangledPropName(e.ref);
        p.addSourceMappingForName(expr.loc, name, e.ref);

        if (!p.options.minifyWhitespace && e.hasPropertyKeyComment) {
          p.print("/* @__KEY__ */ ");
        }

        p.printQuotedUTF8(name, printQuotedAllowBacktick);
        break;
      }

      case E_JSX_ELEMENT:
        p.printEJSXElement(expr, e);
        break;

      case E_NEW:
        p.printENew(expr, e, level);
        break;

      case E_CALL:
        p.printECall(expr, e, level, flags);
        break;

      case E_REQUIRE_STRING:
        p.addSourceMapping(expr.loc);
        p.printRequireOrImportExpr(e.importRecordIndex, level, flags, e.closeParenLoc, 0 /* ast.EvaluationPhase */);
        break;

      case E_REQUIRE_RESOLVE_STRING: {
        const recordLoc = p.importRecords[e.importRecordIndex].range.loc;
        const isMultiLine = p.willPrintExprCommentsAtLoc(recordLoc) || p.willPrintExprCommentsAtLoc(e.closeParenLoc);
        const wrap = level >= LNew || (flags & isNewTarget) !== 0;
        if (wrap) {
          p.print("(");
        }
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(expr.loc);
        p.print("require.resolve(");
        if (isMultiLine) {
          p.printNewline();
          p.options.indent++;
          p.printIndent();
          p.printExprCommentsAtLoc(recordLoc);
        }
        p.printPath(e.importRecordIndex, ImportRequireResolve);
        if (isMultiLine) {
          p.printNewline();
          p.printExprCommentsAfterCloseTokenAtLoc(e.closeParenLoc);
          p.options.indent--;
          p.printIndent();
        }
        if (e.closeParenLoc > expr.loc) {
          p.addSourceMapping(e.closeParenLoc);
        }
        p.print(")");
        if (wrap) {
          p.print(")");
        }
        break;
      }

      case E_IMPORT_STRING:
        p.addSourceMapping(expr.loc);
        p.printRequireOrImportExpr(e.importRecordIndex, level, flags, e.closeParenLoc, p.importRecords[e.importRecordIndex].phase);
        break;

      case E_IMPORT_CALL:
        p.printEImportCall(expr, e, level, flags);
        break;

      case E_DOT:
        p.printEDot(expr, e, level, flags);
        break;

      case E_INDEX:
        p.printEIndex(expr, e, level, flags);
        break;

      case E_IF: {
        const wrap = level >= LConditional;
        if (wrap) {
          p.print("(");
          flags &= ~forbidIn;
        }
        p.printExpr(e.test, LConditional, (flags & forbidIn) | parentWasUnaryOrBinaryOrIfTest);
        p.printSpace();
        p.print("?");
        if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
          p.printSpace();
        }
        p.printExprWithoutLeadingNewline(e.yes, LYield, 0);
        p.printSpace();
        p.print(":");
        if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
          p.printSpace();
        }
        p.printExprWithoutLeadingNewline(e.no, LYield, flags & forbidIn);
        if (wrap) {
          p.print(")");
        }
        break;
      }

      case E_ARROW: {
        const wrap = e.isParenthesized || level >= LAssign;

        if (wrap) {
          p.print("(");
        }
        if (!p.options.minifyWhitespace && e.hasNoSideEffectsComment) {
          p.print("/* @__NO_SIDE_EFFECTS__ */ ");
        }
        if (e.isAsync) {
          p.addSourceMapping(expr.loc);
          p.printSpaceBeforeIdentifier();
          p.print("async");
          p.printSpace();
        }

        p.printFnArgs(e.args, e.hasRestArg, true, expr.loc, !e.isAsync);
        p.printSpace();
        p.print("=>");
        p.printSpace();

        let wasPrinted = false;
        const stmts = e.body.block.stmts;
        if (stmts.length === 1 && e.preferExpr) {
          const s = stmts[0].data;
          if (s.k === S_RETURN && s.valueOrNil !== null) {
            let nestedFlags = 0;
            if ((flags & forbidIn) !== 0 && !wrap) {
              nestedFlags |= forbidIn;
            }
            p.arrowExprStart = p.jsLen;
            p.printExprWithoutLeadingNewline(s.valueOrNil, LComma, nestedFlags);
            wasPrinted = true;
          }
        }
        if (!wasPrinted) {
          p.printBlock(e.body.loc, e.body.block);
        }
        if (wrap) {
          p.print(")");
        }
        break;
      }

      case E_FUNCTION: {
        const n = p.jsLen;
        const wrap =
          e.isParenthesized ||
          p.stmtStart === n ||
          p.exportDefaultStart === n ||
          ((flags & isPropertyAccessTarget) !== 0 && jsFeatureHas(p.options.unsupportedFeatures, FunctionOrClassPropertyAccess));
        if (wrap) {
          p.print("(");
        }
        if (!p.options.minifyWhitespace && e.fn.hasNoSideEffectsComment) {
          p.print("/* @__NO_SIDE_EFFECTS__ */ ");
        }
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(expr.loc);
        if (e.fn.isAsync) {
          p.print("async ");
        }
        p.print("function");
        if (e.fn.isGenerator) {
          p.print("*");
          p.printSpace();
        }
        if (e.fn.name !== null) {
          p.printSpaceBeforeIdentifier();
          const name = p.renamer.nameForSymbol(e.fn.name.ref);
          p.addSourceMappingForName(e.fn.name.loc, name, e.fn.name.ref);
          p.printIdentifier(name);
        }
        p.printFn(e.fn);
        if (wrap) {
          p.print(")");
        }
        break;
      }

      case E_CLASS: {
        const n = p.jsLen;
        const wrap =
          p.stmtStart === n ||
          p.exportDefaultStart === n ||
          ((flags & isPropertyAccessTarget) !== 0 && jsFeatureHas(p.options.unsupportedFeatures, FunctionOrClassPropertyAccess));
        if (wrap) {
          p.print("(");
        }
        p.printDecorators(e.class.decorators, printSpaceAfterDecorator);
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(expr.loc);
        p.print("class");
        if (e.class.name !== null) {
          p.print(" ");
          const name = p.renamer.nameForSymbol(e.class.name.ref);
          p.addSourceMappingForName(e.class.name.loc, name, e.class.name.ref);
          p.printIdentifier(name);
        }
        p.printClass(e.class);
        if (wrap) {
          p.print(")");
        }
        break;
      }

      case E_ARRAY:
        p.printEArray(expr, e);
        break;

      case E_OBJECT:
        p.printEObject(expr, e);
        break;

      case E_BOOLEAN:
        p.addSourceMapping(expr.loc);
        if (p.options.minifySyntax) {
          if (level >= LPrefix) {
            p.print(e.value ? "(!0)" : "(!1)");
          } else {
            p.print(e.value ? "!0" : "!1");
          }
        } else {
          p.printSpaceBeforeIdentifier();
          p.print(e.value ? "true" : "false");
        }
        break;

      case E_STRING: {
        let qflags = 0;
        if (e.containsUniqueKey) {
          qflags = printQuotedNoWrap;
        }
        p.addSourceMapping(expr.loc);

        if (!p.options.minifyWhitespace && e.hasPropertyKeyComment) {
          p.print("/* @__KEY__ */ ");
        }

        // If this was originally a template literal, print it as one as long as we're not minifying
        if (e.preferTemplate && !p.options.minifySyntax && !jsFeatureHas(p.options.unsupportedFeatures, TemplateLiteral)) {
          p.print("`");
          p.printUnquotedUTF16(e.value, 0x60, qflags);
          p.print("`");
          break;
        }

        p.printQuotedUTF16(e.value, qflags | printQuotedAllowBacktick);
        break;
      }

      case E_TEMPLATE:
        p.printETemplate(expr, e, level, flags);
        break;

      case E_REG_EXP: {
        // Avoid forming a single-line comment or "</script" sequence
        if (p.inlineScriptOK && p.jsLen > 0) {
          const last = p.lastChar();
          if (last === 47 || (last === 60 && startsWithSlashScriptFold(e.value))) {
            p.print(" ");
          }
        }

        p.addSourceMapping(expr.loc);
        p.print(e.value);

        // Need a space before the next identifier to avoid it turning into flags
        p.prevRegExpEnd = p.jsLen;
        break;
      }

      case E_INLINED_ENUM:
        p.printExpr(e.value, level, flags);

        if (!p.options.minifyWhitespace && !p.options.minifyIdentifiers) {
          p.print(" /* ");
          p.print(e.comment);
          p.print(" */");
        }
        break;

      case E_BIG_INT:
        if (!jsFeatureHas(p.options.unsupportedFeatures, Bigint)) {
          p.printSpaceBeforeIdentifier();
          p.addSourceMapping(expr.loc);
          p.print(e.value);
          p.print("n");
          break;
        }
        p.printEBigIntCall(expr, e, level, flags);
        break;

      case E_NUMBER:
        p.addSourceMapping(expr.loc);
        p.printNumber(e.value, level);
        break;

      case E_IDENTIFIER: {
        const name = p.renamer.nameForSymbol(e.ref);
        const wrap =
          p.jsLen === p.forOfInitStart &&
          (name === "let" || ((flags & isFollowedByOf) !== 0 && (flags & isInsideForAwait) === 0 && name === "async"));

        if (wrap) {
          p.print("(");
        }

        p.printSpaceBeforeIdentifier();
        p.addSourceMappingForName(expr.loc, name, e.ref);
        p.printIdentifier(name);

        if (wrap) {
          p.print(")");
        }
        break;
      }

      case E_IMPORT_IDENTIFIER:
        p.printEImportIdentifier(expr, e, level, flags);
        break;

      case E_AWAIT: {
        const wrap = level >= LPrefix;

        if (wrap) {
          p.print("(");
        }

        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(expr.loc);
        p.print("await");
        p.printSpace();
        p.printExpr(e.value, LPrefix - 1, 0);

        if (wrap) {
          p.print(")");
        }
        break;
      }

      case E_YIELD: {
        const wrap = level >= LAssign;

        if (wrap) {
          p.print("(");
        }

        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(expr.loc);
        p.print("yield");

        if (e.valueOrNil !== null) {
          if (e.isStar) {
            p.print("*");
          }
          p.printSpace();
          p.printExprWithoutLeadingNewline(e.valueOrNil, LYield, 0);
        }

        if (wrap) {
          p.print(")");
        }
        break;
      }

      case E_UNARY: {
        const entry = OpTable[e.op];
        const wrap = level >= entry.level;
        const isPrefix = opCodeIsPrefix(e.op);

        if (wrap) {
          p.print("(");
        }

        if (!isPrefix) {
          p.printExpr(e.value, LPostfix - 1, parentWasUnaryOrBinaryOrIfTest);
        }

        if (entry.isKeyword) {
          p.printSpaceBeforeIdentifier();
          if (isPrefix) {
            p.addSourceMapping(expr.loc);
          }
          p.print(entry.text);
          p.printSpace();
        } else {
          p.printSpaceBeforeOperator(e.op);
          if (isPrefix) {
            p.addSourceMapping(expr.loc);
          }
          p.print(entry.text);
          p.prevOp = e.op;
          p.prevOpEnd = p.jsLen;
        }

        if (isPrefix) {
          let valueFlags = parentWasUnaryOrBinaryOrIfTest;
          if (e.op === UnOpDelete) {
            valueFlags |= isDeleteTarget;
          }

          // Never turn "typeof (0, x)" into "typeof x" or "delete (0, x)" into "delete x"
          if (
            (e.op === UnOpTypeof && !e.wasOriginallyTypeofIdentifier && p.isUnboundIdentifier(e.value)) ||
            (e.op === UnOpDelete &&
              !e.wasOriginallyDeleteOfIdentifierOrPropertyAccess &&
              p.isIdentifierOrNumericConstantOrPropertyAccess(e.value))
          ) {
            p.print("(0,");
            p.printSpace();
            p.printExpr(e.value, LPrefix - 1, valueFlags);
            p.print(")");
          } else {
            p.printExpr(e.value, LPrefix - 1, valueFlags);
          }
        }

        if (wrap) {
          p.print(")");
        }
        break;
      }

      case E_BINARY:
        p.printEBinary(e, level, flags);
        break;

      default:
        // Go: panic("Unexpected expression of type ...")
        throw new GoPanic("Unexpected expression of type " + goTypeName("js_ast", e));
    }
  }

  printEJSXElement(expr, e) {
    const p = this;

    // Start the opening tag
    p.addSourceMapping(expr.loc);
    p.print("<");
    p.printJSXTag(e.tagOrNil);
    if (!e.isTagSingleLine) {
      p.options.indent++;
    }

    // Print the attributes
    for (let $i67 = 0, $a67 = e.properties; $i67 < $a67.length; $i67++) {
      const property = $a67[$i67];
      if (e.isTagSingleLine) {
        p.printSpace();
      } else {
        p.printNewline();
        p.printIndent();
      }

      if (property.kind === PropertySpread) {
        if (p.willPrintExprCommentsAtLoc(property.loc)) {
          p.print("{");
          p.printNewline();
          p.options.indent++;
          p.printIndent();
          p.printExprCommentsAtLoc(property.loc);
          p.print("...");
          p.printExpr(property.valueOrNil, LComma, 0);
          p.printNewline();
          p.options.indent--;
          p.printIndent();
          p.print("}");
        } else {
          p.print("{...");
          p.printExpr(property.valueOrNil, LComma, 0);
          p.print("}");
        }
        continue;
      }

      p.printSpaceBeforeIdentifier();
      const key = property.key.data;
      if (key.k === E_NAME_OF_SYMBOL) {
        const name = p.mangledPropName(key.ref);
        p.addSourceMappingForName(property.key.loc, name, key.ref);
        p.printIdentifier(name);
      } else if (key.k === E_STRING) {
        p.addSourceMapping(property.key.loc);
        p.print(key.value);
      } else {
        p.print("{...{");
        p.printSpace();
        p.print("[");
        p.printExpr(property.key, LComma, 0);
        p.print("]:");
        p.printSpace();
        p.printExpr(property.valueOrNil, LComma, 0);
        p.printSpace();
        p.print("}}");
        continue;
      }

      const isMultiLine = p.willPrintExprCommentsAtLoc(property.valueOrNil.loc);
      const value = property.valueOrNil.data;

      if ((property.flags & PropertyWasShorthand) !== 0) {
        // Implicit "true" value
        if (value.k === E_BOOLEAN && value.value) {
          continue;
        }

        // JSX element as JSX attribute value
        if (value.k === E_JSX_ELEMENT) {
          p.print("=");
          p.printExpr(property.valueOrNil, LLowest, 0);
          continue;
        }
      }

      // Special-case raw text
      if (value.k === E_JSX_TEXT) {
        p.print("=");
        p.addSourceMapping(property.valueOrNil.loc);
        p.print(value.raw);
        continue;
      }

      // Generic JS value
      p.print("={");
      if (isMultiLine) {
        p.printNewline();
        p.options.indent++;
        p.printIndent();
      }
      p.printExpr(property.valueOrNil, LComma, 0);
      if (isMultiLine) {
        p.printNewline();
        p.options.indent--;
        p.printIndent();
      }
      p.print("}");
    }

    // End the opening tag
    if (!e.isTagSingleLine) {
      p.options.indent--;
      if (e.properties.length > 0) {
        p.printNewline();
        p.printIndent();
      }
    }
    if (e.tagOrNil !== null && e.nullableChildren.length === 0) {
      if (e.isTagSingleLine || e.properties.length === 0) {
        p.printSpace();
      }
      p.addSourceMapping(e.closeLoc);
      p.print("/>");
      return;
    }
    p.print(">");

    // Print the children. A nil child (Go: Expr{Loc: loc, Data: nil}, from
    // "{/* comment */}") is "new Expr(null, loc)" (the parser never creates a
    // null entry).
    for (const childOrNil of e.nullableChildren) {
      const child = childOrNil === null ? null : childOrNil.data;
      if (child !== null && child.k === E_JSX_ELEMENT) {
        p.printExpr(childOrNil, LLowest, 0);
      } else if (child !== null && child.k === E_JSX_TEXT) {
        p.addSourceMapping(childOrNil.loc);
        p.print(child.raw);
      } else if (child !== null) {
        const isMultiLine = p.willPrintExprCommentsAtLoc(childOrNil.loc);
        p.print("{");
        if (isMultiLine) {
          p.printNewline();
          p.options.indent++;
          p.printIndent();
        }
        p.printExpr(childOrNil, LComma, 0);
        if (isMultiLine) {
          p.printNewline();
          p.options.indent--;
          p.printIndent();
        }
        p.print("}");
      } else {
        p.print("{");
        if (childOrNil !== null && p.willPrintExprCommentsAtLoc(childOrNil.loc)) {
          // Note: Some people use these comments for AST transformations
          p.printNewline();
          p.options.indent++;
          p.printExprCommentsAfterCloseTokenAtLoc(childOrNil.loc);
          p.options.indent--;
          p.printIndent();
        }
        p.print("}");
      }
    }

    // Print the closing tag
    p.addSourceMapping(e.closeLoc);
    p.print("</");
    p.printJSXTag(e.tagOrNil);
    p.print(">");
  }

  printENew(expr, e, level) {
    const p = this;
    let wrap = level >= LCall;

    const hasPureComment = !p.options.minifyWhitespace && e.canBeUnwrappedIfUnused;
    if (hasPureComment && level >= LPostfix) {
      wrap = true;
    }

    if (wrap) {
      p.print("(");
    }

    if (hasPureComment) {
      p.addSourceMapping(expr.loc);
      p.print("/* @__PURE__ */ ");
    }

    p.printSpaceBeforeIdentifier();
    p.addSourceMapping(expr.loc);
    p.print("new");
    p.printSpace();
    p.printExpr(e.target, LNew, isNewTarget);

    // Omit the "()" when minifying, but only when safe to do so
    const isMultiLine =
      !p.options.minifyWhitespace &&
      ((e.isMultiLine && e.args.length > 0) || p.willPrintExprCommentsForAnyOf(e.args) || p.willPrintExprCommentsAtLoc(e.closeParenLoc));
    if (!p.options.minifyWhitespace || e.args.length > 0 || level >= LPostfix || isMultiLine) {
      let needsNewline = true;
      p.print("(");
      if (isMultiLine) {
        p.options.indent++;
      }
      for (let i = 0; i < e.args.length; i++) {
        if (i !== 0) {
          p.print(",");
        }
        if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
          if (isMultiLine) {
            if (needsNewline) {
              p.printNewline();
            }
            p.printIndent();
          } else if (i !== 0) {
            p.printSpace();
          }
        }
        p.printExpr(e.args[i], LComma, 0);
        needsNewline = true;
      }
      if (isMultiLine) {
        if (needsNewline || p.willPrintExprCommentsAtLoc(e.closeParenLoc)) {
          p.printNewline();
        }
        p.printExprCommentsAfterCloseTokenAtLoc(e.closeParenLoc);
        p.options.indent--;
        p.printIndent();
      }
      if (e.closeParenLoc > expr.loc) {
        p.addSourceMapping(e.closeParenLoc);
      }
      p.print(")");
    }

    if (wrap) {
      p.print(")");
    }
  }

  printECall(expr, e, level, flags) {
    const p = this;

    if (p.options.minifySyntax) {
      let symbolFlags = 0;
      const target = e.target.data;
      switch (target.k) {
        case E_IDENTIFIER:
          symbolFlags = p.symbols.get(target.ref).flags;
          break;
        case E_IMPORT_IDENTIFIER: {
          const ref = followSymbols(p.symbols, target.ref);
          symbolFlags = p.symbols.get(ref).flags;
          break;
        }
      }

      // Replace non-mutated empty functions with their arguments at print time
      if ((symbolFlags & (IsEmptyFunction | CouldPotentiallyBeMutated)) === IsEmptyFunction) {
        let replacement = null;
        for (let i = 0; i < e.args.length; i++) {
          let arg = e.args[i];
          if (arg.data.k === E_SPREAD) {
            arg = new Expr(new EArray([arg], 0, 0, true), arg.loc);
          }
          replacement = joinWithComma(replacement, p.astHelpers.simplifyUnusedExpr(arg, p.options.unsupportedFeatures));
        }
        if (replacement === null || (flags & exprResultIsUnused) === 0) {
          replacement = joinWithComma(replacement, new Expr(EUndefinedShared, expr.loc));
        }
        p.printExpr(p.guardAgainstBehaviorChangeDueToSubstitution(replacement, flags), level, flags);
        return;
      }

      // Inline non-mutated identity functions at print time
      if ((symbolFlags & (IsIdentityFunction | CouldPotentiallyBeMutated)) === IsIdentityFunction && e.args.length === 1) {
        let arg = e.args[0];
        if (arg.data.k !== E_SPREAD) {
          if ((flags & exprResultIsUnused) !== 0) {
            arg = p.astHelpers.simplifyUnusedExpr(arg, p.options.unsupportedFeatures);
            if (arg === null) {
              // (Go sets the Data of the zero Expr, whose Loc is 0)
              arg = new Expr(EUndefinedShared, 0);
            }
          }
          p.printExpr(p.guardAgainstBehaviorChangeDueToSubstitution(arg, flags), level, flags);
          return;
        }
      }

      // Inline IIFEs that return expressions at print time
      if (e.args.length === 0) {
        // Note: Do not inline async arrow functions as they are not IIFEs. In
        // particular, they are not necessarily invoked immediately, and any
        // exceptions involved in their evaluation will be swallowed without
        // bubbling up to the surrounding context.
        const arrow = e.target.data;
        if (arrow.k === E_ARROW && arrow.args.length === 0 && !arrow.isAsync) {
          const stmts = arrow.body.block.stmts;

          // "(() => {})()" => "void 0"
          if (stmts.length === 0) {
            const value = new Expr(EUndefinedShared, expr.loc);
            p.printExpr(p.guardAgainstBehaviorChangeDueToSubstitution(value, flags), level, flags);
            return;
          }

          // "(() => 123)()" => "123"
          if (stmts.length === 1) {
            const stmt = stmts[0].data;
            if (stmt.k === S_RETURN) {
              let value = stmt.valueOrNil;
              if (value === null) {
                // (Go sets the Data of the zero Expr, whose Loc is 0)
                value = new Expr(EUndefinedShared, 0);
              }
              p.printExpr(p.guardAgainstBehaviorChangeDueToSubstitution(value, flags), level, flags);
              return;
            }
          }
        }
      }
    }

    let wrap = level >= LNew || (flags & isNewTarget) !== 0;
    let targetFlags = 0;
    if (e.optionalChain === OptionalChainNone) {
      targetFlags = hasNonOptionalChainParent;
    } else if ((flags & hasNonOptionalChainParent) !== 0) {
      wrap = true;
    }

    const hasPureComment = !p.options.minifyWhitespace && e.canBeUnwrappedIfUnused;
    if (hasPureComment && level >= LPostfix) {
      wrap = true;
    }

    if (wrap) {
      p.print("(");
    }

    if (hasPureComment) {
      const startFlags = p.saveExprStartFlags();
      p.addSourceMapping(expr.loc);
      p.print("/* @__PURE__ */ ");
      p.restoreExprStartFlags(startFlags);
    }

    // We don't ever want to accidentally generate a direct eval expression here
    p.callTarget = e.target.data;
    if (
      (e.kind !== DirectEval && p.isUnboundEvalIdentifier(e.target) && e.optionalChain === OptionalChainNone) ||
      (e.kind !== TargetWasOriginallyPropertyAccess && isPropertyAccess(e.target))
    ) {
      p.print("(0,");
      p.printSpace();
      p.printExpr(e.target, LPostfix, isCallTargetOrTemplateTag);
      p.print(")");
    } else {
      p.printExpr(e.target, LPostfix, isCallTargetOrTemplateTag | targetFlags);
    }

    if (e.optionalChain === OptionalChainStart) {
      p.print("?.");
    }

    const isMultiLine =
      !p.options.minifyWhitespace &&
      ((e.isMultiLine && e.args.length > 0) || p.willPrintExprCommentsForAnyOf(e.args) || p.willPrintExprCommentsAtLoc(e.closeParenLoc));
    p.print("(");
    if (isMultiLine) {
      p.options.indent++;
    }
    for (let i = 0; i < e.args.length; i++) {
      if (i !== 0) {
        p.print(",");
      }
      if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
        if (isMultiLine) {
          p.printNewline();
          p.printIndent();
        } else if (i !== 0) {
          p.printSpace();
        }
      }
      p.printExpr(e.args[i], LComma, 0);
    }
    if (isMultiLine) {
      p.printNewline();
      p.printExprCommentsAfterCloseTokenAtLoc(e.closeParenLoc);
      p.options.indent--;
      p.printIndent();
    }
    if (e.closeParenLoc > expr.loc) {
      p.addSourceMapping(e.closeParenLoc);
    }
    p.print(")");

    if (wrap) {
      p.print(")");
    }
  }

  printEImportCall(expr, e, level, flags) {
    const p = this;

    // Only print the second argument if either import assertions or import attributes are supported
    const printImportAssertOrWith =
      e.optionsOrNil !== null &&
      (!jsFeatureHas(p.options.unsupportedFeatures, ImportAssertions) || !jsFeatureHas(p.options.unsupportedFeatures, ImportAttributes));
    const isMultiLine =
      !p.options.minifyWhitespace &&
      (p.willPrintExprCommentsAtLoc(e.expr.loc) ||
        (printImportAssertOrWith && p.willPrintExprCommentsAtLoc(e.optionsOrNil.loc)) ||
        p.willPrintExprCommentsAtLoc(e.closeParenLoc));
    const wrap = level >= LNew || (flags & isNewTarget) !== 0;
    if (wrap) {
      p.print("(");
    }
    p.printSpaceBeforeIdentifier();
    p.addSourceMapping(expr.loc);
    switch (e.phase) {
      case DeferPhase:
        p.print("import.defer(");
        break;
      case SourcePhase:
        p.print("import.source(");
        break;
      default:
        p.print("import(");
    }
    if (isMultiLine) {
      p.printNewline();
      p.options.indent++;
      p.printIndent();
    }
    p.printExpr(e.expr, LComma, 0);

    if (printImportAssertOrWith) {
      p.print(",");
      if (isMultiLine) {
        p.printNewline();
        p.printIndent();
      } else {
        p.printSpace();
      }
      p.printExpr(e.optionsOrNil, LComma, 0);
    }

    if (isMultiLine) {
      p.printNewline();
      p.printExprCommentsAfterCloseTokenAtLoc(e.closeParenLoc);
      p.options.indent--;
      p.printIndent();
    }
    p.print(")");
    if (wrap) {
      p.print(")");
    }
  }

  printEDot(expr, e, level, flags) {
    const p = this;
    let wrap = false;
    if (e.optionalChain === OptionalChainNone) {
      flags |= hasNonOptionalChainParent;

      // Inline cross-module TypeScript enum references here
      const value = p.tryToGetImportedEnumValue(e.target, e.name);
      if (value !== null) {
        if (value.string !== null) {
          p.printQuotedUTF16(value.string, printQuotedAllowBacktick);
        } else {
          p.printNumber(value.number, level);
        }
        if (!p.options.minifyWhitespace && !p.options.minifyIdentifiers && !e.name.includes("*/")) {
          p.print(" /* ");
          p.print(e.name);
          p.print(" */");
        }
        return;
      }
    } else {
      if ((flags & (isNewTarget | hasNonOptionalChainParent)) !== 0) {
        wrap = true;
        p.print("(");
      }
      flags &= ~(isNewTarget | hasNonOptionalChainParent);
    }
    p.printExpr(e.target, LPostfix, (flags & (isNewTarget | hasNonOptionalChainParent)) | isPropertyAccessTarget);
    if (p.canPrintIdentifier(e.name)) {
      if (e.optionalChain !== OptionalChainStart && p.needSpaceBeforeDot === p.jsLen) {
        // "1.toString" is a syntax error, so print "1 .toString" instead
        p.print(" ");
      }
      if (e.optionalChain === OptionalChainStart) {
        p.print("?.");
      } else {
        p.print(".");
      }
      if (p.options.lineLimit > 0) {
        p.printNewlinePastLineLimit();
      }
      p.addSourceMapping(e.nameLoc);
      p.printIdentifier(e.name);
    } else {
      if (e.optionalChain === OptionalChainStart) {
        p.print("?.");
      }
      p.print("[");
      p.addSourceMapping(e.nameLoc);
      p.printQuotedUTF8(e.name, printQuotedAllowBacktick);
      p.print("]");
    }
    if (wrap) {
      p.print(")");
    }
  }

  // Go registers "defer p.print(")")" for optional chains; here the closing
  // parenthesis is printed explicitly on every exit path.
  printEIndex(expr, e, level, flags) {
    const p = this;
    let deferParen = false;
    if (e.optionalChain === OptionalChainNone) {
      flags |= hasNonOptionalChainParent;

      // Inline cross-module TypeScript enum references here
      const index = e.index.data;
      if (index.k === E_STRING) {
        const value = p.tryToGetImportedEnumValueUTF16(e.target, index.value);
        if (value !== null) {
          const name = index.value;
          if (value.string !== null) {
            p.printQuotedUTF16(value.string, printQuotedAllowBacktick);
          } else {
            p.printNumber(value.number, level);
          }
          if (!p.options.minifyWhitespace && !p.options.minifyIdentifiers && !name.includes("*/")) {
            p.print(" /* ");
            p.print(name);
            p.print(" */");
          }
          return;
        }
      }
    } else {
      if ((flags & (isNewTarget | hasNonOptionalChainParent)) !== 0) {
        p.print("(");
        deferParen = true;
      }
      flags &= ~(isNewTarget | hasNonOptionalChainParent);
    }
    p.printExpr(e.target, LPostfix, (flags & (isNewTarget | hasNonOptionalChainParent)) | isPropertyAccessTarget);
    if (e.optionalChain === OptionalChainStart) {
      p.print("?.");
    }

    const index = e.index.data;
    switch (index.k) {
      case E_PRIVATE_IDENTIFIER: {
        if (e.optionalChain !== OptionalChainStart) {
          p.print(".");
        }
        const name = p.renamer.nameForSymbol(index.ref);
        p.addSourceMappingForName(e.index.loc, name, index.ref);
        p.printIdentifier(name);
        if (deferParen) p.print(")");
        return;
      }

      case E_NAME_OF_SYMBOL: {
        const name = p.mangledPropName(index.ref);
        if (p.canPrintIdentifier(name)) {
          if (e.optionalChain !== OptionalChainStart) {
            p.print(".");
          }
          p.addSourceMappingForName(e.index.loc, name, index.ref);
          p.printIdentifier(name);
          if (deferParen) p.print(")");
          return;
        }
        break;
      }

      case E_INLINED_ENUM:
        if (p.options.minifySyntax) {
          const str = index.value.data;
          if (str.k === E_STRING && p.canPrintIdentifierUTF16(str.value)) {
            if (e.optionalChain !== OptionalChainStart) {
              p.print(".");
            }
            p.addSourceMapping(index.value.loc);
            p.printIdentifierUTF16(str.value);
            if (deferParen) p.print(")");
            return;
          }
        }
        break;

      case E_DOT:
        if (p.options.minifySyntax) {
          const value = p.tryToGetImportedEnumValue(index.target, index.name);
          if (value !== null && value.string !== null && p.canPrintIdentifierUTF16(value.string)) {
            if (e.optionalChain !== OptionalChainStart) {
              p.print(".");
            }
            p.addSourceMapping(e.index.loc);
            p.printIdentifierUTF16(value.string);
            if (deferParen) p.print(")");
            return;
          }
        }
        break;
    }

    const isMultiLine = p.willPrintExprCommentsAtLoc(e.index.loc) || p.willPrintExprCommentsAtLoc(e.closeBracketLoc);
    p.print("[");
    if (isMultiLine) {
      p.printNewline();
      p.options.indent++;
      p.printIndent();
    }
    p.printExpr(e.index, LLowest, 0);
    if (isMultiLine) {
      p.printNewline();
      p.printExprCommentsAfterCloseTokenAtLoc(e.closeBracketLoc);
      p.options.indent--;
      p.printIndent();
    }
    if (e.closeBracketLoc > expr.loc) {
      p.addSourceMapping(e.closeBracketLoc);
    }
    p.print("]");
    if (deferParen) p.print(")");
  }

  printEArray(expr, e) {
    const p = this;
    const isMultiLine =
      (e.items.length > 0 && !e.isSingleLine) || p.willPrintExprCommentsForAnyOf(e.items) || p.willPrintExprCommentsAtLoc(e.closeBracketLoc);
    p.addSourceMapping(expr.loc);
    p.print("[");
    if (e.items.length > 0 || isMultiLine) {
      if (isMultiLine) {
        p.options.indent++;
      }

      for (let i = 0; i < e.items.length; i++) {
        const item = e.items[i];
        if (i !== 0) {
          p.print(",");
        }
        if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
          if (isMultiLine) {
            p.printNewline();
            p.printIndent();
          } else if (i !== 0) {
            p.printSpace();
          }
        }
        p.printExpr(item, LComma, 0);

        // Make sure there's a comma after trailing missing items
        if (item.data.k === E_MISSING && i === e.items.length - 1) {
          p.print(",");
        }
      }

      if (isMultiLine) {
        p.printNewline();
        p.printExprCommentsAfterCloseTokenAtLoc(e.closeBracketLoc);
        p.options.indent--;
        p.printIndent();
      }
    }
    if (e.closeBracketLoc > expr.loc) {
      p.addSourceMapping(e.closeBracketLoc);
    }
    p.print("]");
  }

  printEObject(expr, e) {
    const p = this;
    let isMultiLine = (e.properties.length > 0 && !e.isSingleLine) || p.willPrintExprCommentsAtLoc(e.closeBraceLoc);
    if (!p.options.minifyWhitespace && !isMultiLine) {
      for (let $i68 = 0, $a68 = e.properties; $i68 < $a68.length; $i68++) {
        const property = $a68[$i68];
        if (p.willPrintExprCommentsAtLoc(property.loc)) {
          isMultiLine = true;
          break;
        }
      }
    }
    const n = p.jsLen;
    const wrap = p.stmtStart === n || p.arrowExprStart === n;
    if (wrap) {
      p.print("(");
    }
    p.addSourceMapping(expr.loc);
    p.print("{");
    if (e.properties.length > 0 || isMultiLine) {
      if (isMultiLine) {
        p.options.indent++;
      }

      for (let i = 0; i < e.properties.length; i++) {
        if (i !== 0) {
          p.print(",");
        }
        if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
          if (isMultiLine) {
            p.printNewline();
            p.printIndent();
          } else {
            p.printSpace();
          }
        }
        p.printProperty(e.properties[i]);
      }

      if (isMultiLine) {
        p.printNewline();
        p.printExprCommentsAfterCloseTokenAtLoc(e.closeBraceLoc);
        p.options.indent--;
        p.printIndent();
      } else if (e.properties.length > 0) {
        p.printSpace();
      }
    }
    if (e.closeBraceLoc > expr.loc) {
      p.addSourceMapping(e.closeBraceLoc);
    }
    p.print("}");
    if (wrap) {
      p.print(")");
    }
  }

  printETemplate(expr, e, level, flags) {
    const p = this;
    if (e.tagOrNil === null && (p.options.minifySyntax || p.wasLazyExport)) {
      // Inline enums and mangled properties when minifying
      let replaced = null;
      for (let i = 0; i < e.parts.length; i++) {
        let part = e.parts[i];
        let inlinedValue = null;
        const e2 = part.value.data;
        switch (e2.k) {
          case E_NAME_OF_SYMBOL:
            inlinedValue = new EString(p.mangledPropName(e2.ref));
            inlinedValue.hasPropertyKeyComment = e2.hasPropertyKeyComment;
            break;
          case E_DOT: {
            const value = p.tryToGetImportedEnumValue(e2.target, e2.name);
            if (value !== null) {
              if (value.string !== null) {
                inlinedValue = new EString(value.string);
              } else {
                inlinedValue = new ENumber(value.number);
              }
            }
            break;
          }
        }
        if (inlinedValue !== null) {
          if (replaced === null) {
            replaced = e.parts.slice(0, i);
          }
          // Go mutates its local copy of the part
          part = part.clone();
          part.value = new Expr(inlinedValue, part.value.loc);
          replaced.push(part);
        } else if (replaced !== null) {
          replaced.push(part);
        }
      }
      if (replaced !== null) {
        const copy = new ETemplate(
          e.tagOrNil,
          e.headRaw,
          e.headCooked,
          replaced,
          e.headLoc,
          e.legacyOctalLoc,
          e.canBeUnwrappedIfUnused,
          e.tagWasOriginallyPropertyAccess,
        );
        const e2 = inlinePrimitivesIntoTemplate(0, copy).data;
        switch (e2.k) {
          case E_STRING:
            p.printQuotedUTF16(e2.value, printQuotedAllowBacktick);
            return;
          case E_TEMPLATE:
            e = e2;
            break;
        }
      }

      // Convert no-substitution template literals into strings if it's smaller
      if (e.parts.length === 0) {
        p.addSourceMapping(expr.loc);
        p.printQuotedUTF16(e.headCooked, printQuotedAllowBacktick);
        return;
      }
    }

    if (e.tagOrNil !== null) {
      const tagK = e.tagOrNil.data.k;
      const tagIsPropertyAccess = tagK === E_DOT || tagK === E_INDEX;
      if (!e.tagWasOriginallyPropertyAccess && tagIsPropertyAccess) {
        // Prevent "x``" from becoming "y.z``"
        p.print("(0,");
        p.printSpace();
        p.printExpr(e.tagOrNil, LLowest, isCallTargetOrTemplateTag);
        p.print(")");
      } else if (isOptionalChain(e.tagOrNil)) {
        // Optional chains are forbidden in template tags
        p.print("(");
        p.printExpr(e.tagOrNil, LLowest, isCallTargetOrTemplateTag);
        p.print(")");
      } else {
        p.printExpr(e.tagOrNil, LPostfix, isCallTargetOrTemplateTag | (flags & isNewTarget));
      }
    } else {
      p.addSourceMapping(expr.loc);
    }
    p.print("`");
    if (e.tagOrNil !== null) {
      p.print(e.headRaw);
    } else {
      p.printUnquotedUTF16(e.headCooked, 0x60, 0);
    }
    for (let $i69 = 0, $a69 = e.parts; $i69 < $a69.length; $i69++) {
      const part = $a69[$i69];
      p.print("${");
      p.printExpr(part.value, LLowest, 0);
      p.addSourceMapping(part.tailLoc);
      p.print("}");
      if (e.tagOrNil !== null) {
        p.print(part.tailRaw);
      } else {
        p.printUnquotedUTF16(part.tailCooked, 0x60, 0);
      }
    }
    p.print("`");
  }

  printEImportIdentifier(expr, e, level, flags) {
    const p = this;

    // Potentially use a property access instead of an identifier
    const ref = followSymbols(p.symbols, e.ref);
    const symbol = p.symbols.get(ref);

    if (symbol.importItemStatus === ImportItemMissing) {
      p.printUndefined(expr.loc, level);
    } else if (symbol.namespaceAlias !== null) {
      const wrap = p.callTarget === e && e.wasOriginallyIdentifier;
      if (wrap) {
        p.print("(0,");
        p.printSpace();
      }
      p.printSpaceBeforeIdentifier();
      p.addSourceMapping(expr.loc);
      p.printIdentifier(p.renamer.nameForSymbol(symbol.namespaceAlias.namespaceRef));
      const alias = symbol.namespaceAlias.alias;
      if (!e.preferQuotedKey && p.canPrintIdentifier(alias)) {
        p.print(".");
        p.addSourceMappingForName(expr.loc, alias, ref);
        p.printIdentifier(alias);
      } else {
        p.print("[");
        p.addSourceMappingForName(expr.loc, alias, ref);
        p.printQuotedUTF8(alias, printQuotedAllowBacktick);
        p.print("]");
      }
      if (wrap) {
        p.print(")");
      }
    } else {
      const value = p.constValue(ref);
      if (value !== null) {
        // Handle inlined constants
        p.printExpr(constValueToExpr(expr.loc, value), level, flags);
      } else {
        p.printSpaceBeforeIdentifier();
        const name = p.renamer.nameForSymbol(ref);
        p.addSourceMappingForName(expr.loc, name, ref);
        p.printIdentifier(name);
      }
    }
  }

  // The EBigInt case of Go's printExpr when compat.Bigint is unsupported
  printEBigIntCall(expr, e, level, flags) {
    const p = this;
    let wrap = level >= LNew || (flags & isNewTarget) !== 0;
    const hasPureComment = !p.options.minifyWhitespace;

    if (hasPureComment && level >= LPostfix) {
      wrap = true;
    }

    if (wrap) {
      p.print("(");
    }

    if (hasPureComment) {
      const startFlags = p.saveExprStartFlags();
      p.addSourceMapping(expr.loc);
      p.print("/* @__PURE__ */ ");
      p.restoreExprStartFlags(startFlags);
    }

    let value = e.value;
    let useQuotes = true;

    // When minifying, try to convert to a shorter form
    if (p.options.minifySyntax) {
      // Go: fmt.Sscan(value, &i) with a big.Int (the base prefix determines
      // the base), then i.String()
      const str = goScanBigInt(value);

      // Print without quotes if it can be converted exactly
      // (Go: strconv.ParseFloat(str, 64) succeeds and fmt.Sprintf("%.0f", num) == str)
      const num = Number(str);
      if (isFinite(num) && BigInt(num).toString() === str) {
        useQuotes = false;
      }

      // Print the converted form if it's shorter (long hex strings may not be shorter)
      if (str.length < value.length) {
        value = str;
      }
    }

    p.printSpaceBeforeIdentifier();
    p.addSourceMapping(expr.loc);

    if (useQuotes) {
      p.print('BigInt("');
    } else {
      p.print("BigInt(");
    }

    p.print(value);

    if (useQuotes) {
      p.print('")');
    } else {
      p.print(")");
    }

    if (wrap) {
      p.print(")");
    }
  }

  // The handling of binary expressions is convoluted because we're using
  // iteration on the heap instead of recursion on the call stack to avoid
  // stack overflow for deeply-nested ASTs. See the comments for the similar
  // code in the JavaScript parser for details.
  printEBinary(e, level, flags) {
    const p = this;
    let v = p.acquireBinaryExprVisitor(e, level, flags);

    // Use a single stack to reduce allocation overhead
    const stackBottom = p.binaryExprStack.length;

    for (;;) {
      // Check whether this node is a special case, and stop if it is
      if (!v.checkAndPrepare(p)) {
        p.binaryExprVisitorPool.push(v); // (done with it)
        break;
      }

      const left = v.e.left;
      const leftBinary = left.data;

      // Stop iterating if iteration doesn't apply to the left node
      if (leftBinary.k !== E_BINARY) {
        p.printExpr(left, v.leftLevel, v.leftFlags);
        v.visitRightAndFinish(p);
        p.binaryExprVisitorPool.push(v); // (done with it)
        break;
      }

      // Manually run the code at the start of "printExpr"
      p.printExprCommentsAtLoc(left.loc);

      // Only allocate heap memory on the stack for nested binary expressions
      p.binaryExprStack.push(v);
      v = p.acquireBinaryExprVisitor(leftBinary, v.leftLevel, v.leftFlags);
    }

    // Process all binary operations from the deepest-visited node back toward
    // our original top-level binary operation
    for (;;) {
      const n = p.binaryExprStack.length - 1;
      if (n < stackBottom) {
        break;
      }
      const v2 = p.binaryExprStack.pop();
      v2.visitRightAndFinish(p);
      p.binaryExprVisitorPool.push(v2); // (done with it)
    }
  }

  // JS-only: binaryExprVisitor objects are reused. A visitor is only used by
  // the printEBinary call that acquired it (until its visitRightAndFinish has
  // returned), so it can go back to the pool then.
  acquireBinaryExprVisitor(e, level, flags) {
    const pool = this.binaryExprVisitorPool;
    if (pool.length === 0) return new binaryExprVisitor(e, level, flags);
    const v = pool.pop();
    v.e = e;
    v.level = level;
    v.flags = flags;
    v.leftLevel = LLowest;
    v.leftFlags = 0;
    v.entry = null;
    v.wrap = false;
    v.rightLevel = LLowest;
    return v;
  }

  isUnboundEvalIdentifier(value) {
    const id = value.data;
    if (id.k === E_IDENTIFIER) {
      // Using the original name here is ok since unbound symbols are not renamed
      const symbol = this.symbols.get(followSymbols(this.symbols, id.ref));
      return symbol.kind === SymbolUnbound && symbol.originalName === "eval";
    }
    return false;
  }

  // (smallIntToBytes is String(n) here)

  printNonNegativeFloat(absValue) {
    const p = this;

    // We can avoid the slow call to strconv.FormatFloat() for integers less than
    // 1000 because we know that exponential notation will always be longer than
    // the integer representation. This is not the case for 1000 which is "1e3".
    if (absValue < 1000) {
      if (Number.isInteger(absValue)) {
        p.printBytes(String(absValue));

        // Integers always need a space before "." to avoid making a decimal point
        p.needSpaceBeforeDot = p.jsLen;
        return;
      }
    }

    let result = formatFloatG(absValue);

    // Simplify the exponent
    // "e+05" => "e5"
    // "e-05" => "e-5"
    const e = result.lastIndexOf("e");
    if (e !== -1) {
      let from = e + 1;
      let to = from;

      switch (result.charCodeAt(from)) {
        case 0x2b: // '+'
          // Strip off the leading "+"
          from++;
          break;

        case 0x2d: // '-'
          // Skip past the leading "-"
          to++;
          from++;
          break;
      }

      // Strip off leading zeros
      while (from < result.length && result.charCodeAt(from) === 0x30) {
        from++;
      }

      result = result.slice(0, to) + result.slice(from);
    }

    const dot = result.indexOf(".");

    if (dot === 1 && result.charCodeAt(0) === 0x30) {
      // Simplify numbers starting with "0."
      let afterDot = 2;

      // Strip off the leading zero when minifying
      // "0.5" => ".5"
      if (p.options.minifyWhitespace) {
        result = result.slice(1);
        afterDot--;
      }

      // Try using an exponent
      // "0.001" => "1e-3"
      if (result.charCodeAt(afterDot) === 0x30) {
        let i = afterDot + 1;
        while (result.charCodeAt(i) === 0x30) {
          i++;
        }
        const remaining = result.slice(i);
        const exponent = String(afterDot - i - remaining.length);

        // Only switch if it's actually shorter
        if (result.length > remaining.length + 1 + exponent.length) {
          result = remaining + "e" + exponent;
        }
      }
    } else if (dot !== -1) {
      // Try to get rid of a "." and maybe also an "e"
      const e = result.lastIndexOf("e");
      if (e !== -1) {
        const integer = result.slice(0, dot);
        const fraction = result.slice(dot + 1, e);
        const exponent = parseSmallInt(result.slice(e + 1)) - fraction.length;

        // Handle small exponents by appending zeros instead
        if (exponent >= 0 && exponent <= 2) {
          // "1.2e1" => "12"
          // "1.2e2" => "120"
          // "1.2e3" => "1200"
          if (result.length >= integer.length + fraction.length + exponent) {
            result = integer + fraction;
            for (let i = 0; i < exponent; i++) {
              result += "0";
            }
          }
        } else {
          // "1.2e4" => "12e3"
          const exponentText = String(exponent);
          if (result.length >= integer.length + fraction.length + 1 + exponentText.length) {
            result = integer + fraction + "e" + exponentText;
          }
        }
      }
    } else if (result.charCodeAt(result.length - 1) === 0x30) {
      // Simplify numbers ending with "0" by trying to use an exponent
      // "1000" => "1e3"
      let i = result.length - 1;
      while (i > 0 && result.charCodeAt(i - 1) === 0x30) {
        i--;
      }
      const remaining = result.slice(0, i);
      const exponent = String(result.length - i);

      // Only switch if it's actually shorter
      if (result.length > remaining.length + 1 + exponent.length) {
        result = remaining + "e" + exponent;
      }
    }

    // Numbers in this range can potentially be printed with one fewer byte as
    // hex. This compares against 0xFFFF_FFFF_FFFF_F800 instead of comparing
    // against 0xFFFF_FFFF_FFFF_FFFF because 0xFFFF_FFFF_FFFF_FFFF when converted
    // to float64 rounds up to 0x1_0000_0000_0000_0180, which can no longer fit
    // into uint64. In Go, the result of converting float64 to uint64 outside of
    // the uint64 range is implementation-dependent and is different on amd64 vs.
    // arm64. The float64 value 0xFFFF_FFFF_FFFF_F800 is the biggest value that
    // is below the float64 value 0x1_0000_0000_0000_0180, so we use that instead.
    if (p.options.minifyWhitespace && absValue >= 1000000000000 && absValue <= 0xfffffffffffff800) {
      if (Number.isInteger(absValue)) {
        const hex = BigInt(absValue).toString(16);
        if (2 + hex.length < result.length) {
          result = "0x" + hex;
        }
      }
    }

    p.printBytes(result);

    // We'll need a space before "." if it could be parsed as a decimal point
    if (result.indexOf(".") === -1 && result.indexOf("e") === -1 && result.indexOf("x") === -1) {
      p.needSpaceBeforeDot = p.jsLen;
    }
  }

  printDeclStmt(isExport, keyword, decls) {
    const p = this;
    p.printIndent();
    p.printSpaceBeforeIdentifier();
    if (isExport) {
      p.print("export ");
    }
    p.printDecls(keyword, decls, 0);
    p.printSemicolonAfterStatement();
  }

  printForLoopInit(init, flags) {
    const p = this;
    const s = init.data;
    switch (s.k) {
      case S_EXPR:
        p.printExpr(s.value, LLowest, flags | exprResultIsUnused);
        break;
      case S_LOCAL:
        switch (s.kind) {
          case LocalAwaitUsing:
            p.printDecls("await using", s.decls, flags);
            break;
          case LocalConst:
            p.printDecls("const", s.decls, flags);
            break;
          case LocalLet:
            p.printDecls("let", s.decls, flags);
            break;
          case LocalUsing:
            p.printDecls("using", s.decls, flags);
            break;
          case LocalVar:
            p.printDecls("var", s.decls, flags);
            break;
        }
        break;
      default:
        // Go: panic("Internal error")
        throw new GoPanic("Internal error");
    }
  }

  printDecls(keyword, decls, flags) {
    const p = this;
    p.print(keyword);
    p.printSpace();

    for (let i = 0; i < decls.length; i++) {
      const decl = decls[i];
      if (i !== 0) {
        p.print(",");
        if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
          p.printSpace();
        }
      }
      p.printBinding(decl.binding);

      if (decl.valueOrNil !== null) {
        p.printSpace();
        p.print("=");
        p.printSpace();
        p.printExprWithoutLeadingNewline(decl.valueOrNil, LComma, flags);
      }
    }
  }

  printBody(body, isSingleLine) {
    const p = this;
    const block = body.data;
    if (block.k === S_BLOCK) {
      p.printSpace();
      p.printBlock(body.loc, block);
      p.printNewline();
    } else if (isSingleLine) {
      p.printNextIndentAsSpace = true;
      p.printStmt(body, 0);
    } else {
      p.printNewline();
      p.options.indent++;
      p.printStmt(body, 0);
      p.options.indent--;
    }
  }

  printBlock(loc, block) {
    const p = this;
    p.addSourceMapping(loc);
    p.print("{");
    p.printNewline();

    p.options.indent++;
    for (let $i70 = 0, $a70 = block.stmts; $i70 < $a70.length; $i70++) {
      const stmt = $a70[$i70];
      p.printSemicolonIfNeeded();
      p.printStmt(stmt, canOmitStatement);
    }
    p.options.indent--;
    p.needsSemicolon = false;

    p.printIndent();
    if (block.closeBraceLoc > loc) {
      p.addSourceMapping(block.closeBraceLoc);
    }
    p.print("}");
  }

  printIf(s) {
    const p = this;
    p.printSpaceBeforeIdentifier();
    p.print("if");
    p.printSpace();
    p.print("(");
    if (p.willPrintExprCommentsAtLoc(s.test.loc)) {
      p.printNewline();
      p.options.indent++;
      p.printIndent();
      p.printExpr(s.test, LLowest, 0);
      p.printNewline();
      p.options.indent--;
      p.printIndent();
    } else {
      p.printExpr(s.test, LLowest, 0);
    }
    p.print(")");

    // Simplify the else branch, which may disappear entirely
    let no = s.noOrNil;
    if (no !== null && no.data.k === S_EXPR) {
      const expr = no.data;
      const value = p.simplifyUnusedExpr(expr.value);
      if (value === null) {
        no = null;
      } else if (value.data !== expr.value.data) {
        no = new Stmt(new SExpr(value), no.loc);
      }
    }

    const yes = s.yes.data;
    if (yes.k === S_BLOCK) {
      p.printSpace();
      p.printBlock(s.yes.loc, yes);

      if (no !== null) {
        p.printSpace();
      } else {
        p.printNewline();
      }
    } else if (wrapToAvoidAmbiguousElse(yes)) {
      p.printSpace();
      p.print("{");
      p.printNewline();

      p.options.indent++;
      p.printStmt(s.yes, canOmitStatement);
      p.options.indent--;
      p.needsSemicolon = false;

      p.printIndent();
      p.print("}");

      if (no !== null) {
        p.printSpace();
      } else {
        p.printNewline();
      }
    } else {
      p.printBody(s.yes, s.isSingleLineYes);

      if (no !== null) {
        p.printIndent();
      }
    }

    if (no !== null) {
      p.printSemicolonIfNeeded();
      p.printSpaceBeforeIdentifier();
      p.print("else");

      const noData = no.data;
      if (noData.k === S_BLOCK) {
        p.printSpace();
        p.printBlock(no.loc, noData);
        p.printNewline();
      } else if (noData.k === S_IF) {
        p.printIf(noData);
      } else {
        p.printBody(no, s.isSingleLineNo);
      }
    }
  }

  printIndentedComment(text) {
    const p = this;

    // Avoid generating a comment containing the character sequence "</script"
    if (p.inlineScriptOK) text = escapeClosingTag(text, "/script");

    if (text.startsWith("/*")) {
      // Re-indent multi-line comments
      for (;;) {
        const newline = text.indexOf("\n");
        if (newline === -1) {
          break;
        }
        p.print(text.slice(0, newline + 1));
        p.printIndent();
        text = text.slice(newline + 1);
      }
      p.print(text);
      p.printNewline();
    } else {
      // Print a mandatory newline after single-line comments
      p.print(text);
      p.print("\n");
    }
  }

  printPath(importRecordIndex, importKind) {
    const p = this;
    const record = p.importRecords[importRecordIndex];
    p.addSourceMapping(record.range.loc);
    p.printQuotedUTF8(record.path.text, printQuotedNoWrap);

    if (p.options.needsMetafile) {
      let external = "";
      if ((record.flags & ShouldNotBeExternalInMetafile) === 0) {
        external = metafileFormatMaybeRemoveWhitespace(p.options.metafileFormat, ',\n          "external": true');
      }
      p.jsonMetadataImports.push(
        metafileFormatMaybeRemoveWhitespace(p.options.metafileFormat, '\n        {\n          "path": ') +
          quoteForJSON(record.path.text, p.options.asciiOnly) +
          metafileFormatMaybeRemoveWhitespace(p.options.metafileFormat, ',\n          "kind": ') +
          quoteForJSON(importKindStringForMetafile(importKind), p.options.asciiOnly) +
          external +
          metafileFormatMaybeRemoveWhitespace(p.options.metafileFormat, "\n        }"),
      );
    }

    if (record.assertOrWith !== null && importKind === ImportStmt) {
      let feature = ImportAttributes;
      if (record.assertOrWith.keyword === AssertKeyword) {
        feature = ImportAssertions;
      }

      // Omit import assertions/attributes on this import statement if they would cause a syntax error
      if (jsFeatureHas(p.options.unsupportedFeatures, feature)) {
        return;
      }

      p.printSpace();
      p.addSourceMapping(record.assertOrWith.keywordLoc);
      p.print(assertOrWithKeywordString(record.assertOrWith.keyword));
      p.printSpace();
      p.printImportAssertOrWithClause(record.assertOrWith);
    }
  }

  printImportCallAssertOrWith(assertOrWith, outerIsMultiLine) {
    const p = this;

    // Omit import assertions/attributes if we know the "import()" syntax doesn't
    // support a second argument (i.e. both import assertions and import
    // attributes aren't supported) and doing so would cause a syntax error
    if (
      assertOrWith === null ||
      (jsFeatureHas(p.options.unsupportedFeatures, ImportAssertions) && jsFeatureHas(p.options.unsupportedFeatures, ImportAttributes))
    ) {
      return;
    }

    const isMultiLine =
      p.willPrintExprCommentsAtLoc(assertOrWith.keywordLoc) ||
      p.willPrintExprCommentsAtLoc(assertOrWith.innerOpenBraceLoc) ||
      p.willPrintExprCommentsAtLoc(assertOrWith.outerCloseBraceLoc);

    p.print(",");
    if (outerIsMultiLine) {
      p.printNewline();
      p.printIndent();
    } else {
      p.printSpace();
    }
    p.printExprCommentsAtLoc(assertOrWith.outerOpenBraceLoc);
    p.addSourceMapping(assertOrWith.outerOpenBraceLoc);
    p.print("{");

    if (isMultiLine) {
      p.printNewline();
      p.options.indent++;
      p.printIndent();
    } else {
      p.printSpace();
    }

    p.printExprCommentsAtLoc(assertOrWith.keywordLoc);
    p.addSourceMapping(assertOrWith.keywordLoc);
    p.print(assertOrWithKeywordString(assertOrWith.keyword));
    p.print(":");

    if (p.willPrintExprCommentsAtLoc(assertOrWith.innerOpenBraceLoc)) {
      p.printNewline();
      p.options.indent++;
      p.printIndent();
      p.printExprCommentsAtLoc(assertOrWith.innerOpenBraceLoc);
      p.printImportAssertOrWithClause(assertOrWith);
      p.options.indent--;
    } else {
      p.printSpace();
      p.printImportAssertOrWithClause(assertOrWith);
    }

    if (isMultiLine) {
      p.printNewline();
      p.printExprCommentsAfterCloseTokenAtLoc(assertOrWith.outerCloseBraceLoc);
      p.options.indent--;
      p.printIndent();
    } else {
      p.printSpace();
    }

    p.addSourceMapping(assertOrWith.outerCloseBraceLoc);
    p.print("}");
  }

  printImportAssertOrWithClause(assertOrWith) {
    const p = this;
    let isMultiLine = p.willPrintExprCommentsAtLoc(assertOrWith.innerCloseBraceLoc);
    if (!isMultiLine) {
      for (const entry of assertOrWith.entries) {
        if (p.willPrintExprCommentsAtLoc(entry.keyLoc) || p.willPrintExprCommentsAtLoc(entry.valueLoc)) {
          isMultiLine = true;
          break;
        }
      }
    }

    p.addSourceMapping(assertOrWith.innerOpenBraceLoc);
    p.print("{");
    if (isMultiLine) {
      p.options.indent++;
    }

    for (let i = 0; i < assertOrWith.entries.length; i++) {
      const entry = assertOrWith.entries[i];
      if (i > 0) {
        p.print(",");
      }
      if (isMultiLine) {
        p.printNewline();
        p.printIndent();
      } else {
        p.printSpace();
      }

      p.printExprCommentsAtLoc(entry.keyLoc);
      p.addSourceMapping(entry.keyLoc);
      if (!entry.preferQuotedKey && p.canPrintIdentifierUTF16(entry.key)) {
        p.printSpaceBeforeIdentifier();
        p.printIdentifierUTF16(entry.key);
      } else {
        p.printQuotedUTF16(entry.key, 0);
      }

      p.print(":");

      if (p.willPrintExprCommentsAtLoc(entry.valueLoc)) {
        p.printNewline();
        p.options.indent++;
        p.printIndent();
        p.printExprCommentsAtLoc(entry.valueLoc);
        p.addSourceMapping(entry.valueLoc);
        p.printQuotedUTF16(entry.value, 0);
        p.options.indent--;
      } else {
        p.printSpace();
        p.addSourceMapping(entry.valueLoc);
        p.printQuotedUTF16(entry.value, 0);
      }
    }

    if (isMultiLine) {
      p.printNewline();
      p.printExprCommentsAfterCloseTokenAtLoc(assertOrWith.innerCloseBraceLoc);
      p.options.indent--;
      p.printIndent();
    } else if (assertOrWith.entries.length > 0) {
      p.printSpace();
    }

    p.addSourceMapping(assertOrWith.innerCloseBraceLoc);
    p.print("}");
  }

  printStmt(stmt, flags) {
    const p = this;
    if (p.options.lineLimit > 0) {
      p.printNewlinePastLineLimit();
    }

    const s = stmt.data;
    switch (s.k) {
      case S_COMMENT: {
        const text = s.text;

        if (s.isLegalComment) {
          switch (p.options.legalComments) {
            case LegalCommentsNone:
              return;

            case LegalCommentsEndOfFile:
            case LegalCommentsLinkedWithComment:
            case LegalCommentsExternalWithoutComment:
              // Don't record the same legal comment more than once per file
              if (p.hasLegalComment === null) {
                p.hasLegalComment = new Set();
              } else if (p.hasLegalComment.has(text)) {
                return;
              }
              p.hasLegalComment.add(text);
              p.extractedLegalComments.push(text);
              return;
          }
        }

        p.printIndent();
        p.addSourceMapping(stmt.loc);
        p.printIndentedComment(text);
        break;
      }

      case S_FUNCTION: {
        if (!p.options.minifyWhitespace && s.fn.hasNoSideEffectsComment) {
          p.printIndent();
          p.print("// @__NO_SIDE_EFFECTS__\n");
        }
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        if (s.isExport) {
          p.print("export ");
        }
        if (s.fn.isAsync) {
          p.print("async ");
        }
        p.print("function");
        if (s.fn.isGenerator) {
          p.print("*");
          p.printSpace();
        }
        p.printSpaceBeforeIdentifier();
        const name = p.renamer.nameForSymbol(s.fn.name.ref);
        p.addSourceMappingForName(s.fn.name.loc, name, s.fn.name.ref);
        p.printIdentifier(name);
        p.printFn(s.fn);
        p.printNewline();
        break;
      }

      case S_CLASS: {
        const omitIndent = p.printDecorators(s.class.decorators, printNewlineAfterDecorator);
        if (!omitIndent) {
          p.printIndent();
        }
        p.printSpaceBeforeIdentifier();
        p.addSourceMapping(stmt.loc);
        if (s.isExport) {
          p.print("export ");
        }
        p.print("class ");
        const name = p.renamer.nameForSymbol(s.class.name.ref);
        p.addSourceMappingForName(s.class.name.loc, name, s.class.name.ref);
        p.printIdentifier(name);
        p.printClass(s.class);
        p.printNewline();
        break;
      }

      case S_EMPTY:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.print(";");
        p.printNewline();
        break;

      case S_EXPORT_DEFAULT:
        p.printSExportDefault(stmt, s);
        break;

      case S_EXPORT_STAR:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("export");
        p.printSpace();
        p.print("*");
        p.printSpace();
        if (s.alias !== null) {
          p.print("as");
          p.printSpace();
          p.printClauseAlias(s.alias.loc, s.alias.originalName);
          p.printSpace();
          p.printSpaceBeforeIdentifier();
        }
        p.print("from");
        p.printSpace();
        p.printPath(s.importRecordIndex, ImportStmt);
        p.printSemicolonAfterStatement();
        break;

      case S_EXPORT_CLAUSE:
        p.printSExportClause(stmt, s);
        break;

      case S_EXPORT_FROM:
        p.printSExportFrom(stmt, s);
        break;

      case S_LOCAL:
        p.addSourceMapping(stmt.loc);
        switch (s.kind) {
          case LocalAwaitUsing:
            p.printDeclStmt(s.isExport, "await using", s.decls);
            break;
          case LocalConst:
            p.printDeclStmt(s.isExport, "const", s.decls);
            break;
          case LocalLet:
            p.printDeclStmt(s.isExport, "let", s.decls);
            break;
          case LocalUsing:
            p.printDeclStmt(s.isExport, "using", s.decls);
            break;
          case LocalVar:
            p.printDeclStmt(s.isExport, "var", s.decls);
            break;
        }
        break;

      case S_IF:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printIf(s);
        break;

      case S_DO_WHILE: {
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("do");
        const block = s.body.data;
        if (block.k === S_BLOCK) {
          p.printSpace();
          p.printBlock(s.body.loc, block);
          p.printSpace();
        } else {
          p.printNewline();
          p.options.indent++;
          p.printStmt(s.body, 0);
          p.printSemicolonIfNeeded();
          p.options.indent--;
          p.printIndent();
        }
        p.print("while");
        p.printSpace();
        p.print("(");
        if (p.willPrintExprCommentsAtLoc(s.test.loc)) {
          p.printNewline();
          p.options.indent++;
          p.printIndent();
          p.printExpr(s.test, LLowest, 0);
          p.printNewline();
          p.options.indent--;
          p.printIndent();
        } else {
          p.printExpr(s.test, LLowest, 0);
        }
        p.print(")");
        p.printSemicolonAfterStatement();
        break;
      }

      case S_FOR_IN: {
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("for");
        p.printSpace();
        p.print("(");
        const hasInitComment = p.willPrintExprCommentsAtLoc(s.init.loc);
        const hasValueComment = p.willPrintExprCommentsAtLoc(s.value.loc);
        if (hasInitComment || hasValueComment) {
          p.printNewline();
          p.options.indent++;
          p.printIndent();
        }
        p.printForLoopInit(s.init, forbidIn);
        p.printSpace();
        p.printSpaceBeforeIdentifier();
        p.print("in");
        if (hasValueComment) {
          p.printNewline();
          p.printIndent();
        } else {
          p.printSpace();
        }
        p.printExpr(s.value, LLowest, 0);
        if (hasInitComment || hasValueComment) {
          p.printNewline();
          p.options.indent--;
          p.printIndent();
        }
        p.print(")");
        p.printBody(s.body, s.isSingleLineBody);
        break;
      }

      case S_FOR_OF: {
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("for");
        if (s.await.len > 0) {
          p.print(" await");
        }
        p.printSpace();
        p.print("(");
        const hasInitComment = p.willPrintExprCommentsAtLoc(s.init.loc);
        const hasValueComment = p.willPrintExprCommentsAtLoc(s.value.loc);
        let initFlags = forbidIn | isFollowedByOf;
        if (s.await.len > 0) {
          initFlags |= isInsideForAwait;
        }
        if (hasInitComment || hasValueComment) {
          p.printNewline();
          p.options.indent++;
          p.printIndent();
        }
        p.forOfInitStart = p.jsLen;
        p.printForLoopInit(s.init, initFlags);
        p.printSpace();
        p.printSpaceBeforeIdentifier();
        p.print("of");
        if (hasValueComment) {
          p.printNewline();
          p.printIndent();
        } else {
          p.printSpace();
        }
        p.printExpr(s.value, LComma, 0);
        if (hasInitComment || hasValueComment) {
          p.printNewline();
          p.options.indent--;
          p.printIndent();
        }
        p.print(")");
        p.printBody(s.body, s.isSingleLineBody);
        break;
      }

      case S_WHILE:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("while");
        p.printSpace();
        p.print("(");
        if (p.willPrintExprCommentsAtLoc(s.test.loc)) {
          p.printNewline();
          p.options.indent++;
          p.printIndent();
          p.printExpr(s.test, LLowest, 0);
          p.printNewline();
          p.options.indent--;
          p.printIndent();
        } else {
          p.printExpr(s.test, LLowest, 0);
        }
        p.print(")");
        p.printBody(s.body, s.isSingleLineBody);
        break;

      case S_WITH:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("with");
        p.printSpace();
        p.print("(");
        if (p.willPrintExprCommentsAtLoc(s.value.loc)) {
          p.printNewline();
          p.options.indent++;
          p.printIndent();
          p.printExpr(s.value, LLowest, 0);
          p.printNewline();
          p.options.indent--;
          p.printIndent();
        } else {
          p.printExpr(s.value, LLowest, 0);
        }
        p.print(")");
        p.withNesting++;
        p.printBody(s.body, s.isSingleLineBody);
        p.withNesting--;
        break;

      case S_LABEL: {
        // Avoid printing a source mapping that masks the one from the label
        if (!p.options.minifyWhitespace && (p.options.indent > 0 || p.printNextIndentAsSpace)) {
          p.addSourceMapping(stmt.loc);
          p.printIndent();
        }

        p.printSpaceBeforeIdentifier();
        const name = p.renamer.nameForSymbol(s.name.ref);
        p.addSourceMappingForName(s.name.loc, name, s.name.ref);
        p.printIdentifier(name);
        p.print(":");
        p.printBody(s.stmt, s.isSingleLineStmt);
        break;
      }

      case S_TRY:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("try");
        p.printSpace();
        p.printBlock(s.blockLoc, s.block);

        if (s.catch !== null) {
          p.printSpace();
          p.print("catch");
          if (s.catch.bindingOrNil !== null) {
            p.printSpace();
            p.print("(");
            p.printBinding(s.catch.bindingOrNil);
            p.print(")");
          }
          p.printSpace();
          p.printBlock(s.catch.blockLoc, s.catch.block);
        }

        if (s.finally !== null) {
          p.printSpace();
          p.print("finally");
          p.printSpace();
          p.printBlock(s.finally.loc, s.finally.block);
        }

        p.printNewline();
        break;

      case S_FOR:
        p.printSFor(stmt, s);
        break;

      case S_SWITCH:
        p.printSSwitch(stmt, s);
        break;

      case S_IMPORT:
        p.printSImport(stmt, s);
        break;

      case S_BLOCK:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printBlock(stmt.loc, s);
        p.printNewline();
        break;

      case S_DEBUGGER:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("debugger");
        p.printSemicolonAfterStatement();
        break;

      case S_DIRECTIVE:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.printQuotedUTF16(s.value, 0);
        p.printSemicolonAfterStatement();
        break;

      case S_BREAK:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("break");
        if (s.label !== null) {
          p.print(" ");
          const name = p.renamer.nameForSymbol(s.label.ref);
          p.addSourceMappingForName(s.label.loc, name, s.label.ref);
          p.printIdentifier(name);
        }
        p.printSemicolonAfterStatement();
        break;

      case S_CONTINUE:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("continue");
        if (s.label !== null) {
          p.print(" ");
          const name = p.renamer.nameForSymbol(s.label.ref);
          p.addSourceMappingForName(s.label.loc, name, s.label.ref);
          p.printIdentifier(name);
        }
        p.printSemicolonAfterStatement();
        break;

      case S_RETURN:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("return");
        if (s.valueOrNil !== null) {
          p.printSpace();
          p.printExprWithoutLeadingNewline(s.valueOrNil, LLowest, 0);
        }
        p.printSemicolonAfterStatement();
        break;

      case S_THROW:
        p.addSourceMapping(stmt.loc);
        p.printIndent();
        p.printSpaceBeforeIdentifier();
        p.print("throw");
        p.printSpace();
        p.printExprWithoutLeadingNewline(s.value, LLowest, 0);
        p.printSemicolonAfterStatement();
        break;

      case S_EXPR: {
        let value = s.value;

        // Omit calls to empty functions from the output completely
        if (p.options.minifySyntax) {
          value = p.simplifyUnusedExpr(value);
          if (value === null) {
            // If this statement is not in a block, then we still need to emit something
            if ((flags & canOmitStatement) === 0) {
              // "if (x) empty();" => "if (x) ;"
              p.addSourceMapping(stmt.loc);
              p.printIndent();
              p.print(";");
              p.printNewline();
            } else {
              // "if (x) { empty(); }" => "if (x) {}"
            }
            break;
          }
        }

        // Avoid printing a source mapping when the expression would print one in
        // the same spot. We don't want to accidentally mask the mapping it emits.
        if (!p.options.minifyWhitespace && (p.options.indent > 0 || p.printNextIndentAsSpace)) {
          p.addSourceMapping(stmt.loc);
          p.printIndent();
        }

        p.stmtStart = p.jsLen;
        p.printExpr(value, LLowest, exprResultIsUnused);
        p.printSemicolonAfterStatement();
        break;
      }

      default:
        // Go: panic("Unexpected statement of type ...")
        throw new GoPanic("Unexpected statement of type " + goTypeName("js_ast", s));
    }
  }

  printSExportDefault(stmt, s) {
    const p = this;
    if (!p.options.minifyWhitespace) {
      const s2 = s.value.data;
      if (s2.k === S_FUNCTION && s2.fn.hasNoSideEffectsComment) {
        p.printIndent();
        p.print("// @__NO_SIDE_EFFECTS__\n");
      }
    }
    let omitIndent = false;
    if (s.value.data.k === S_CLASS) {
      omitIndent = p.printDecorators(s.value.data.class.decorators, printNewlineAfterDecorator);
    }
    p.addSourceMapping(stmt.loc);
    if (!omitIndent) {
      p.printIndent();
    }
    p.printSpaceBeforeIdentifier();
    p.print("export default");
    p.printSpace();

    const s2 = s.value.data;
    switch (s2.k) {
      case S_EXPR:
        // Functions and classes must be wrapped to avoid confusion with their statement forms
        p.exportDefaultStart = p.jsLen;

        p.printExprWithoutLeadingNewline(s2.value, LComma, 0);
        p.printSemicolonAfterStatement();
        return;

      case S_FUNCTION:
        p.printSpaceBeforeIdentifier();
        if (s2.fn.isAsync) {
          p.print("async ");
        }
        p.print("function");
        if (s2.fn.isGenerator) {
          p.print("*");
          p.printSpace();
        }
        if (s2.fn.name !== null) {
          p.printSpaceBeforeIdentifier();
          const name = p.renamer.nameForSymbol(s2.fn.name.ref);
          p.addSourceMappingForName(s2.fn.name.loc, name, s2.fn.name.ref);
          p.printIdentifier(name);
        }
        p.printFn(s2.fn);
        p.printNewline();
        break;

      case S_CLASS:
        p.printSpaceBeforeIdentifier();
        p.print("class");
        if (s2.class.name !== null) {
          p.print(" ");
          const name = p.renamer.nameForSymbol(s2.class.name.ref);
          p.addSourceMappingForName(s2.class.name.loc, name, s2.class.name.ref);
          p.printIdentifier(name);
        }
        p.printClass(s2.class);
        p.printNewline();
        break;

      default:
        // Go: panic("Internal error")
        throw new GoPanic("Internal error");
    }
  }

  printSExportClause(stmt, s) {
    const p = this;
    p.addSourceMapping(stmt.loc);
    p.printIndent();
    p.printSpaceBeforeIdentifier();
    p.print("export");
    p.printSpace();
    p.print("{");

    if (!s.isSingleLine) {
      p.options.indent++;
    }

    for (let i = 0; i < s.items.length; i++) {
      const item = s.items[i];
      if (i !== 0) {
        p.print(",");
      }

      if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
        if (s.isSingleLine) {
          p.printSpace();
        } else {
          p.printNewline();
          p.printIndent();
        }
      }

      const name = p.renamer.nameForSymbol(item.name.ref);
      p.addSourceMappingForName(item.name.loc, name, item.name.ref);
      p.printIdentifier(name);
      if (name !== item.alias) {
        p.print(" as");
        p.printSpace();
        p.printClauseAlias(item.aliasLoc, item.alias);
      }
    }

    if (!s.isSingleLine) {
      p.options.indent--;
      p.printNewline();
      p.printIndent();
    } else if (s.items.length > 0) {
      p.printSpace();
    }

    p.print("}");
    p.printSemicolonAfterStatement();
  }

  printSExportFrom(stmt, s) {
    const p = this;
    p.addSourceMapping(stmt.loc);
    p.printIndent();
    p.printSpaceBeforeIdentifier();
    p.print("export");
    p.printSpace();
    p.print("{");

    if (!s.isSingleLine) {
      p.options.indent++;
    }

    for (let i = 0; i < s.items.length; i++) {
      const item = s.items[i];
      if (i !== 0) {
        p.print(",");
      }

      if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
        if (s.isSingleLine) {
          p.printSpace();
        } else {
          p.printNewline();
          p.printIndent();
        }
      }

      p.printClauseAlias(item.name.loc, item.originalName);
      if (item.originalName !== item.alias) {
        p.printSpace();
        p.printSpaceBeforeIdentifier();
        p.print("as");
        p.printSpace();
        p.printClauseAlias(item.aliasLoc, item.alias);
      }
    }

    if (!s.isSingleLine) {
      p.options.indent--;
      p.printNewline();
      p.printIndent();
    } else if (s.items.length > 0) {
      p.printSpace();
    }

    p.print("}");
    p.printSpace();
    p.print("from");
    p.printSpace();
    p.printPath(s.importRecordIndex, ImportStmt);
    p.printSemicolonAfterStatement();
  }

  printSFor(stmt, s) {
    const p = this;
    let init = s.initOrNil;
    let update = s.updateOrNil;

    // Omit calls to empty functions from the output completely
    if (p.options.minifySyntax) {
      if (init !== null && init.data.k === S_EXPR) {
        const expr = init.data;
        const value = p.simplifyUnusedExpr(expr.value);
        if (value === null) {
          init = null;
        } else if (value.data !== expr.value.data) {
          init = new Stmt(new SExpr(value), init.loc);
        }
      }
      if (update !== null) {
        update = p.simplifyUnusedExpr(update);
      }
    }

    p.addSourceMapping(stmt.loc);
    p.printIndent();
    p.printSpaceBeforeIdentifier();
    p.print("for");
    p.printSpace();
    p.print("(");
    const isMultiLine =
      (init !== null && p.willPrintExprCommentsAtLoc(init.loc)) ||
      (s.testOrNil !== null && p.willPrintExprCommentsAtLoc(s.testOrNil.loc)) ||
      (update !== null && p.willPrintExprCommentsAtLoc(update.loc));
    if (isMultiLine) {
      p.printNewline();
      p.options.indent++;
      p.printIndent();
    }
    if (init !== null) {
      p.printForLoopInit(init, forbidIn);
    }
    p.print(";");
    if (isMultiLine) {
      p.printNewline();
      p.printIndent();
    } else {
      p.printSpace();
    }
    if (s.testOrNil !== null) {
      p.printExpr(s.testOrNil, LLowest, 0);
    }
    p.print(";");
    if (!isMultiLine) {
      p.printSpace();
    } else if (update !== null) {
      p.printNewline();
      p.printIndent();
    }
    if (update !== null) {
      p.printExpr(update, LLowest, exprResultIsUnused);
    }
    if (isMultiLine) {
      p.printNewline();
      p.options.indent--;
      p.printIndent();
    }
    p.print(")");
    p.printBody(s.body, s.isSingleLineBody);
  }

  printSSwitch(stmt, s) {
    const p = this;
    p.addSourceMapping(stmt.loc);
    p.printIndent();
    p.printSpaceBeforeIdentifier();
    p.print("switch");
    p.printSpace();
    p.print("(");
    if (p.willPrintExprCommentsAtLoc(s.test.loc)) {
      p.printNewline();
      p.options.indent++;
      p.printIndent();
      p.printExpr(s.test, LLowest, 0);
      p.printNewline();
      p.options.indent--;
      p.printIndent();
    } else {
      p.printExpr(s.test, LLowest, 0);
    }
    p.print(")");
    p.printSpace();
    p.addSourceMapping(s.bodyLoc);
    p.print("{");
    p.printNewline();
    p.options.indent++;

    for (let $i71 = 0, $a71 = s.cases; $i71 < $a71.length; $i71++) {
      const c = $a71[$i71];
      p.printSemicolonIfNeeded();
      p.printIndent();
      p.printExprCommentsAtLoc(c.loc);
      p.addSourceMapping(c.loc);

      if (c.valueOrNil !== null) {
        p.print("case");
        p.printSpace();
        p.printExpr(c.valueOrNil, LLogicalAnd, 0);
      } else {
        p.print("default");
      }
      p.print(":");

      if (c.body.length === 1) {
        const block = c.body[0].data;
        if (block.k === S_BLOCK) {
          p.printSpace();
          p.printBlock(c.body[0].loc, block);
          p.printNewline();
          continue;
        }
      }

      p.printNewline();
      p.options.indent++;
      for (const stmt of c.body) {
        p.printSemicolonIfNeeded();
        p.printStmt(stmt, canOmitStatement);
      }
      p.options.indent--;
    }

    p.options.indent--;
    p.printIndent();
    p.addSourceMapping(s.closeBraceLoc);
    p.print("}");
    p.printNewline();
    p.needsSemicolon = false;
  }

  printSImport(stmt, s) {
    const p = this;
    let itemCount = 0;

    p.addSourceMapping(stmt.loc);
    p.printIndent();
    p.printSpaceBeforeIdentifier();
    switch (p.importRecords[s.importRecordIndex].phase) {
      case DeferPhase:
        p.print("import defer");
        break;
      case SourcePhase:
        p.print("import source");
        break;
      default:
        p.print("import");
    }
    p.printSpace();

    if (s.defaultName !== null) {
      p.printSpaceBeforeIdentifier();
      const name = p.renamer.nameForSymbol(s.defaultName.ref);
      p.addSourceMappingForName(s.defaultName.loc, name, s.defaultName.ref);
      p.printIdentifier(name);
      itemCount++;
    }

    if (s.items !== null) {
      if (itemCount > 0) {
        p.print(",");
        p.printSpace();
      }

      p.print("{");
      if (!s.isSingleLine) {
        p.options.indent++;
      }

      for (let i = 0; i < s.items.length; i++) {
        const item = s.items[i];
        if (i !== 0) {
          p.print(",");
        }

        if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
          if (s.isSingleLine) {
            p.printSpace();
          } else {
            p.printNewline();
            p.printIndent();
          }
        }

        p.printClauseAlias(item.aliasLoc, item.alias);

        const name = p.renamer.nameForSymbol(item.name.ref);
        if (name !== item.alias) {
          p.printSpace();
          p.printSpaceBeforeIdentifier();
          p.print("as ");
          p.addSourceMappingForName(item.name.loc, name, item.name.ref);
          p.printIdentifier(name);
        }
      }

      if (!s.isSingleLine) {
        p.options.indent--;
        p.printNewline();
        p.printIndent();
      } else if (s.items.length > 0) {
        p.printSpace();
      }

      p.print("}");
      itemCount++;
    }

    if (s.starNameLoc !== null) {
      if (itemCount > 0) {
        p.print(",");
        p.printSpace();
      }

      p.print("*");
      p.printSpace();
      p.print("as ");
      const name = p.renamer.nameForSymbol(s.namespaceRef);
      p.addSourceMappingForName(s.starNameLoc, name, s.namespaceRef);
      p.printIdentifier(name);
      itemCount++;
    }

    if (itemCount > 0) {
      p.printSpace();
      p.printSpaceBeforeIdentifier();
      p.print("from");
      p.printSpace();
    }

    p.printPath(s.importRecordIndex, ImportStmt);
    p.printSemicolonAfterStatement();
  }
}

// The handling of binary expressions is convoluted because we're using
// iteration on the heap instead of recursion on the call stack to avoid
// stack overflow for deeply-nested ASTs. See the comments for the similar
// code in the JavaScript parser for details.
class binaryExprVisitor {
  ;              
  ;                     
  ;                     
  ;                         
  ;                         
  ;                  
  ;                     
  ;                          
  constructor(e = null, level = LLowest, flags = 0) {
    // Inputs
    this.e = e; // *js_ast.EBinary
    this.level = level;
    this.flags = flags;

    // Input for visiting the left child
    this.leftLevel = LLowest;
    this.leftFlags = 0;

    // "Local variables" passed from "checkAndPrepare" to "visitRightAndFinish"
    this.entry = null; // js_ast.OpTableEntry
    this.wrap = false;
    this.rightLevel = LLowest;
  }

  checkAndPrepare(p) {
    const v = this;
    const e = v.e;

    // If this is a comma operator then either the result is unused (and we
    // should have already simplified unused expressions), or the result is used
    // (and we can still simplify unused expressions inside the left operand)
    if (e.op === BinOpComma) {
      if ((v.flags & didAlreadySimplifyUnusedExprs) === 0) {
        const left = p.simplifyUnusedExpr(e.left);
        let right = e.right;
        if ((v.flags & exprResultIsUnused) !== 0) {
          right = p.simplifyUnusedExpr(right);
        }
        if (exprData(left) !== e.left.data || exprData(right) !== e.right.data) {
          // Pass a flag so we don't needlessly re-simplify the same expression
          p.printExpr(
            p.guardAgainstBehaviorChangeDueToSubstitution(joinWithComma(left, right), v.flags),
            v.level,
            v.flags | didAlreadySimplifyUnusedExprs,
          );
          return false;
        }
      } else {
        // Pass a flag so we don't needlessly re-simplify the same expression
        v.flags |= didAlreadySimplifyUnusedExprs;
      }
    }

    v.entry = OpTable[e.op];
    v.wrap = v.level >= v.entry.level || (e.op === BinOpIn && (v.flags & forbidIn) !== 0);

    // Destructuring assignments must be parenthesized
    const n = p.jsLen;
    if (p.stmtStart === n || p.arrowExprStart === n) {
      if (e.left.data.k === E_OBJECT) {
        v.wrap = true;
      }
    }

    if (v.wrap) {
      p.print("(");
      v.flags &= ~forbidIn;
    }

    v.leftLevel = v.entry.level - 1;
    v.rightLevel = v.entry.level - 1;

    if (opCodeIsRightAssociative(e.op)) {
      v.leftLevel = v.entry.level;
    }
    if (opCodeIsLeftAssociative(e.op)) {
      v.rightLevel = v.entry.level;
    }

    switch (e.op) {
      case BinOpNullishCoalescing: {
        // "??" can't directly contain "||" or "&&" without being wrapped in parentheses
        const left = e.left.data;
        if (left.k === E_BINARY && (left.op === BinOpLogicalOr || left.op === BinOpLogicalAnd)) {
          v.leftLevel = LPrefix;
        }
        const right = e.right.data;
        if (right.k === E_BINARY && (right.op === BinOpLogicalOr || right.op === BinOpLogicalAnd)) {
          v.rightLevel = LPrefix;
        }
        break;
      }

      case BinOpPow: {
        // "**" can't contain certain unary expressions
        const left = e.left.data;
        if (left.k === E_UNARY && opCodeUnaryAssignTarget(left.op) === AssignTargetNone) {
          v.leftLevel = LCall;
        } else if (left.k === E_AWAIT) {
          v.leftLevel = LCall;
        } else if (left.k === E_UNDEFINED) {
          // Undefined is printed as "void 0"
          v.leftLevel = LCall;
        } else if (left.k === E_NUMBER) {
          // Negative numbers are printed using a unary operator
          v.leftLevel = LCall;
        } else if (p.options.minifySyntax) {
          // When minifying, booleans are printed as "!0 and "!1"
          if (left.k === E_BOOLEAN) {
            v.leftLevel = LCall;
          }
        }
        break;
      }
    }

    // Special-case "#foo in bar"
    const private_ = e.left.data;
    if (private_.k === E_PRIVATE_IDENTIFIER && e.op === BinOpIn) {
      const name = p.renamer.nameForSymbol(private_.ref);
      p.addSourceMappingForName(e.left.loc, name, private_.ref);
      p.printIdentifier(name);
      v.visitRightAndFinish(p);
      return false;
    }

    if (e.op === BinOpComma) {
      // The result of the left operand of the comma operator is unused
      v.leftFlags = (v.flags & forbidIn) | exprResultIsUnused | parentWasUnaryOrBinaryOrIfTest;
    } else {
      v.leftFlags = (v.flags & forbidIn) | parentWasUnaryOrBinaryOrIfTest;
    }
    return true;
  }

  visitRightAndFinish(p) {
    const v = this;
    const e = v.e;

    if (e.op !== BinOpComma) {
      p.printSpace();
    }

    if (v.entry.isKeyword) {
      p.printSpaceBeforeIdentifier();
      p.print(v.entry.text);
    } else {
      p.printSpaceBeforeOperator(e.op);
      p.print(v.entry.text);
      p.prevOp = e.op;
      p.prevOpEnd = p.jsLen;
    }

    if (p.options.lineLimit <= 0 || !p.printNewlinePastLineLimit()) {
      p.printSpace();
    }

    if (e.op === BinOpComma) {
      // The result of the right operand of the comma operator is unused if the caller doesn't use it
      p.printExpr(e.right, v.rightLevel, (v.flags & (forbidIn | exprResultIsUnused)) | parentWasUnaryOrBinaryOrIfTest);
    } else {
      p.printExpr(e.right, v.rightLevel, (v.flags & forbidIn) | parentWasUnaryOrBinaryOrIfTest);
    }

    if (v.wrap) {
      p.print(")");
    }
  }
}

function canUseShorthandProperty(key, name, flags) {
  // The JavaScript specification special-cases the property identifier
  // "__proto__" with a colon after it to set the prototype of the object. If
  // we remove the colon then we'll cause a behavior change because the
  // prototype will no longer be set, but we also don't want to add a colon
  // if it was omitted. Always use a shorthand property if the property is not
  // "__proto__", otherwise try to preserve the original shorthand status. See:
  // https://tc39.es/ecma262/#sec-runtime-semantics-propertydefinitionevaluation
  if (key !== name) {
    return false;
  }
  return key === name && (name !== "__proto__" || (flags & PropertyWasShorthand) !== 0);
}

function parseSmallInt(bytes) {
  let i = 0;
  const wasNegative = bytes.charCodeAt(0) === 0x2d;
  if (wasNegative) {
    i = 1;
  }

  // Parse the integer without any error checking. This doesn't need to handle
  // integer overflow because these integers are floating-point exponents which
  // never go up that high.
  let n = 0;
  for (; i < bytes.length; i++) {
    n = n * 10 + (bytes.charCodeAt(i) - 0x30);
  }

  if (wasNegative) {
    return -n;
  }
  return n;
}

// JS-only helper for the printer's hasInlinableCalls flag
function anySymbolHasFlags(symbols, flags) {
  const all = symbols.symbolsForSource;
  for (let i = 0; i < all.length; i++) {
    const inner = all[i];
    if (inner === null || inner === undefined) continue;
    for (let j = 0; j < inner.length; j++) {
      if ((inner[j].flags & flags) !== 0) return true;
    }
  }
  return false;
}

function wrapToAvoidAmbiguousElse(s) {
  for (;;) {
    switch (s.k) {
      case S_IF:
        if (s.noOrNil === null) {
          return true;
        }
        s = s.noOrNil.data;
        break;

      case S_FOR:
        s = s.body.data;
        break;

      case S_FOR_IN:
        s = s.body.data;
        break;

      case S_FOR_OF:
        s = s.body.data;
        break;

      case S_WHILE:
        s = s.body.data;
        break;

      case S_WITH:
        s = s.body.data;
        break;

      case S_LABEL:
        s = s.stmt.data;
        break;

      default:
        return false;
    }
  }
}

export function canEscapeIdentifier(name, unsupportedFeatures           , asciiOnly) {
  return (
    isIdentifierES5AndESNext(name) &&
    (!asciiOnly || !jsFeatureHas(unsupportedFeatures, UnicodeEscapes) || !containsNonBMPCodePoint(name))
  );
}

export class Options {
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
  ;                              
  ;                              
  constructor(
    requireOrImportMetaForSource = null, // func(uint32) RequireOrImportMeta
    tsEnums = null, // Map<Ref, Map<string, js_ast.TSEnumValue>>
    constValues = null, // Map<Ref, js_ast.ConstValue>
    mangledProps = null, // Map<Ref, string>
    inputSourceMap = null, // (source maps are not supported)
    lineOffsetTables = null, // (source maps are not supported)
    toCommonJSRef = InvalidRef,
    toESMRef = InvalidRef,
    runtimeRequireRef = InvalidRef,
    unsupportedFeatures = JSFeatureNone, // compat.JSFeature
    indent = 0,
    lineLimit = 0,
    outputFormat = FormatPreserve,
    minifyWhitespace = false,
    minifyIdentifiers = false,
    minifySyntax = false,
    asciiOnly = false,
    legalComments = LegalCommentsInline,
    sourceMap = SourceMapNone,
    addSourceMappings = false,
    needsMetafile = false,
    metafileFormat = 0,
  ) {
    // CommonJS files will return the "require_*" wrapper function and an invalid
    // exports object reference. Lazily-initialized ESM files will return the
    // "init_*" wrapper function and the exports object for that file.
    this.requireOrImportMetaForSource = requireOrImportMetaForSource;

    // Cross-module inlining of TypeScript enums is actually done during printing
    this.tsEnums = tsEnums;

    // Cross-module inlining of detected inlinable constants is also done during printing
    this.constValues = constValues;

    // Property mangling results go here
    this.mangledProps = mangledProps;

    // This will be present if the input file had a source map. In that case we
    // want to map all the way back to the original input file(s).
    this.inputSourceMap = inputSourceMap;

    // If we're writing out a source map, this table of line start indices lets
    // us do binary search on to figure out what line a given AST node came from
    this.lineOffsetTables = lineOffsetTables;

    this.toCommonJSRef = toCommonJSRef;
    this.toESMRef = toESMRef;
    this.runtimeRequireRef = runtimeRequireRef;
    this.unsupportedFeatures = unsupportedFeatures;
    this.indent = indent;
    this.lineLimit = lineLimit;
    this.outputFormat = outputFormat;
    this.minifyWhitespace = minifyWhitespace;
    this.minifyIdentifiers = minifyIdentifiers;
    this.minifySyntax = minifySyntax;
    this.asciiOnly = asciiOnly;
    this.legalComments = legalComments;
    this.sourceMap = sourceMap;
    this.addSourceMappings = addSourceMappings;
    this.needsMetafile = needsMetafile;
    this.metafileFormat = metafileFormat;
  }

  clone() {
    return new Options(
      this.requireOrImportMetaForSource,
      this.tsEnums,
      this.constValues,
      this.mangledProps,
      this.inputSourceMap,
      this.lineOffsetTables,
      this.toCommonJSRef,
      this.toESMRef,
      this.runtimeRequireRef,
      this.unsupportedFeatures,
      this.indent,
      this.lineLimit,
      this.outputFormat,
      this.minifyWhitespace,
      this.minifyIdentifiers,
      this.minifySyntax,
      this.asciiOnly,
      this.legalComments,
      this.sourceMap,
      this.addSourceMappings,
      this.needsMetafile,
      this.metafileFormat,
    );
  }
}

export class RequireOrImportMeta {
  ;                          
  ;                          
  ;                               
  constructor(wrapperRef = InvalidRef, exportsRef = InvalidRef, isWrapperAsync = false) {
    // CommonJS files will return the "require_*" wrapper function and an invalid
    // exports object reference. Lazily-initialized ESM files will return the
    // "init_*" wrapper function and the exports object for that file.
    this.wrapperRef = wrapperRef;
    this.exportsRef = exportsRef;
    this.isWrapperAsync = isWrapperAsync;
  }
}

export class PrintResult {
  ;                  
  ;                                     
  ;                                  
  ;                           
  constructor(js = "", extractedLegalComments = [], jsonMetadataImports = [], sourceMapChunk = null) {
    this.js = js; // JS string (Go: []byte)
    this.extractedLegalComments = extractedLegalComments; // []string
    this.jsonMetadataImports = jsonMetadataImports; // []string

    // This source map chunk just contains the VLQ-encoded offsets for the "JS"
    // field above. It's not a full source map. The bundler will be joining many
    // source map chunks together to form the final source map.
    // (A sourcemap.Chunk, or null where Go leaves the zero value because
    // options.SourceMap is SourceMapNone.)
    this.sourceMapChunk = sourceMapChunk;
  }
}

// Go: Print(tree js_ast.AST, symbols ast.SymbolMap, r renamer.Renamer, options Options) PrintResult

export function print(tree, symbols, r, options) {
  // Go copies the Options struct (the printer mutates p.options.Indent)
  options = options instanceof Options ? options.clone() : Object.assign(new Options(), options);

  const moduleType = tree.moduleTypeData !== null ? tree.moduleTypeData.type : ModuleUnknown;

  // An empty map behaves exactly like a nil one; using null skips the
  // per-expression lookups
  let exprComments = tree.exprComments;
  if (exprComments === undefined || (exprComments !== null && exprComments.size === 0)) {
    exprComments = null;
  }

  const p = new printer(symbols, r, tree.importRecords, options, moduleType, exprComments, tree.hasLazyExport);

  if (p.exprComments !== null) {
    p.printedExprComments = new Set();
    p.exprCommentBits = exprCommentBitsFor(p.exprComments);
  }

  p.astHelpers = makeHelperContext((ref) => {
    ref = followSymbols(symbols, ref);
    return symbols.get(ref).kind === SymbolUnbound;
  });

  // JS-only: the parser only sets IsEmptyFunction / IsIdentityFunction when
  // minifying syntax, and a transform parses and prints with the same
  // MinifySyntax setting, so without it no symbol can carry them and the scan
  // over all symbols is skipped.
  p.hasInlinableCalls = options.minifySyntax && anySymbolHasFlags(symbols, IsEmptyFunction | IsIdentityFunction);

  // Add the top-level directive if present
  if (tree.directives !== null) {
    for (let $i72 = 0, $a72 = tree.directives; $i72 < $a72.length; $i72++) {
      const directive = $a72[$i72];
      p.printIndent();
      p.printQuotedUTF8(directive, 0);
      p.print(";");
      p.printNewline();
    }
  }

  for (let $i73 = 0, $a73 = tree.parts; $i73 < $a73.length; $i73++) {
    const part = $a73[$i73];
    for (let $i74 = 0, $a74 = part.stmts; $i74 < $a74.length; $i74++) {
      const stmt = $a74[$i74];
      p.printStmt(stmt, canOmitStatement);
      p.printSemicolonIfNeeded();
    }
  }

  let sourceMapChunk = null;
  if (options.sourceMap !== SourceMapNone) {
    // This is expensive. Only do this if it's necessary.
    // (Must run before jsText() releases the output buffer.)
    sourceMapChunk = p.builder.generateChunk(p.jsBuf, p.jsLen);
  }
  return new PrintResult(p.jsText(), p.extractedLegalComments, p.jsonMetadataImports, sourceMapChunk);
}

// fmt.Sscan(value, &i) for a big.Int i ("%v": big.Int's scan with base 0,
// which takes the base from a "0b", "0o", "0x" or "0" prefix and allows
// underscores between digits), then i.String(). The value is the text of a
// bigint literal; scanning stops at the first character that is not a digit.
function goScanBigInt(value        )         {
  let s = value;
  let base = 10;
  if (s.length >= 2 && s[0] === "0") {
    const c = s[1];
    if (c === "b" || c === "B") {
      base = 2;
      s = s.slice(2);
    } else if (c === "o" || c === "O") {
      base = 8;
      s = s.slice(2);
    } else if (c === "x" || c === "X") {
      base = 16;
      s = s.slice(2);
    } else {
      base = 8;
      s = s.slice(1);
    }
  }
  const b = BigInt(base);
  let n = BigInt(0);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "_") continue;
    const d = parseInt(ch, 36);
    if (!(d < base)) break;
    n = n * b + BigInt(d);
  }
  return n.toString();
}
// generated from js_printer.mts by tools/ts-build.mjs; edit that file
