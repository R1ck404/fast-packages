// Port of internal/linker/linker.go (the CSS parts are in linker_css.mjs)
//
// The Go code runs several steps on goroutines; this port runs them
// sequentially in the same order. Output paths are not computed (see
// generateChunksInParallel): a transform always produces exactly one chunk,
// so the chunk file is always the shortest output path and the legal comments
// file is always "<chunk path>.LEGAL.txt".
//
// Other JS-only differences, none of which change the output:
// - the cached runtime AST is cloned partly copy-on-write (graph.mjs), so
//   symbol and "part.symbolUses" writes go through writableSymbol() /
//   writableSymbolChain() / writableSymbolUses()
// - the statements of the runtime's namespace export part are built lazily
//   (createExportsForFile)
// - ast.FollowAllSymbols is skipped (it only exists for goroutine safety)
// - Go's unstable sorts are only used on unique keys here
import { rangeOfIdentifier as cssRangeOfIdentifier } from "./css_lexer.mjs";
import { TypoDetector } from "./css_ast.mjs";
import { goQuote } from "./gostd.mjs";
import type { Timer } from "./timer.mjs";
import { goPathClean } from "./package_json.mjs";
import { GoPanic, goTypeName } from "./gopanic.mjs";
import { isStackOverflow, recoverLinkerPanic } from "./recover.mjs";
import { canRetryDeep, runDeep } from "./deep.mjs";
import { BufferedDigest as Digest } from "./xxhash.mjs";
import { parseGoURL, isFileURL, filePathFromFileURL } from "./gourl.mjs";
import { pathRelativeToOutbase, hashForFileName } from "./bundler_scan.mjs";
import { makePrettyPaths } from "./build_deps.mjs";
import {
  Path,
  RANGE_ZERO,
  Msg,
  MsgData,
  LineColumnTracker,
  goStringLess,
  MsgID_Bundler_AmbiguousReexport,
} from "./logger.mjs";
import { Log, Error as MsgError, Warning as MsgWarning, Debug as MsgDebug, MsgID_Bundler_ImportIsUndefined } from "./logger.mjs";
import { Joiner, quoteForJSON, escapeClosingTag, isInsideNodeModules, utf8Len, goStringBytes } from "./helpers.mjs";
import {
  InvalidRef,
  LocRef,
  NamespaceAlias,
  refSource,
  refInner,
  makeRef,
  followSymbols,
  mergeSymbols,
  ImportStmt,
  ImportRequire,
  ImportDynamic,
  ContainsImportStar,
  ContainsDefaultAlias,
  ContainsESModuleAlias,
  CallsRunTimeReExportFn,
  WrapWithToESM,
  WrapWithToCJS,
  CallRuntimeRequire,
  IsExternalWithoutSideEffects,
  SymbolUnbound,
  SymbolOther,
  SymbolImport,
  SymbolTSEnum,
  ImportItemGenerated,
  ImportItemMissing,
  MustNotBeRenamed,
  IsEmptyFunction,
  IsIdentityFunction,
  CouldPotentiallyBeMutated,
  newSlotCounts,
  slotCountsUnionMax,
  newCharFreq,
  charFreqInclude,
  DefaultNameMinifierJS,
  ImportRecord,
  ShouldNotBeExternalInMetafile,
  ContainsUniqueKey,
} from "./ast.mjs";
import {
  Expr,
  Stmt,
  Binding,
  Part,
  AST,
  Dependency,
  DeclaredSymbol,
  SymbolUse,
  Property,
  Arg,
  Fn,
  FnBody,
  ClauseItem,
  Decl,
  EArrow,
  EAwait,
  EBinary,
  ECall,
  EDot,
  EFunction,
  EIdentifier,
  EImportIdentifier,
  ENumber,
  EObject,
  ERequireString,
  EString,
  ENullShared,
  BIdentifier,
  SBlock,
  SComment,
  SDirective,
  SExportClause,
  SExportDefault,
  SExpr,
  SFunction,
  SClass,
  SImport,
  SLocal,
  SReturn,
  S_IMPORT,
  S_EXPORT_STAR,
  S_EXPORT_FROM,
  S_EXPORT_CLAUSE,
  S_EXPORT_DEFAULT,
  S_FUNCTION,
  S_CLASS,
  S_LOCAL,
  S_EXPR,
  E_OBJECT,
  E_STRING,
  PropertyField,
  PropertyMethod,
  PropertySpread,
  PropertyIsComputed,
  BinOpLogicalAnd,
  ExportsNone,
  ExportsCommonJS,
  ExportsESM,
  ExportsESMWithDynamicFallback,
  exportsKindIsDynamic,
  NSExportPartIndex,
} from "./js_ast.mjs";
import {
  ModePassThrough,
  ModeConvertFormat,
  ModeBundle,
  FormatPreserve,
  FormatIIFE,
  FormatCommonJS,
  FormatESModule,
  formatKeepESMImportExportSyntax,
  shouldCallRuntimeRequire,
  PlatformNode,
  LegalCommentsNone,
  LegalCommentsInline,
  LegalCommentsEndOfFile,
  LegalCommentsLinkedWithComment,
  LegalCommentsExternalWithoutComment,
  SourceMapNone,
  SourceMapInline,
  SourceMapLinkedWithComment,
  SourceMapExternalWithoutComment,
  SourceMapInlineAndExternal,
  LoaderJS,
  LoaderJSX,
  LoaderTS,
  LoaderTSNoAmbiguousLessThan,
  LoaderTSX,
  LoaderCSS,
  LoaderGlobalCSS,
  LoaderLocalCSS,
  LoaderJSON,
  LoaderWithTypeJSON,
  LoaderText,
  LoaderFile,
  loaderIsTypeScript,
  PathTemplate,
  PathPlaceholders,
  HashPlaceholder,
  substituteTemplate,
  hasPlaceholder,
  templateToString,
  metafileFormatMaybeRemoveWhitespace,
  prettyPrintTargetEnvironment,
  loaderIsCSS,
} from "./config.mjs";
import {
  JSRepr,
  CSSRepr,
  CopyRepr,
  OutputFile,
  ImportData,
  ExportData,
  HasSideEffects,
  WrapNone,
  WrapCJS,
  WrapESM,
  EMPTY_ARRAY,
  writableSymbolUses,
  markSymbolUsesShared,
  writableSymbol,
  writableSymbolChain,
  sortedResolvedExportAliases,
  cloneLinkerGraph,
  cloneAST,
  newBitSet,
  compareStringsUTF8,
  sortStringsUTF8,
} from "./graph.mjs";
import { assign, assignStmt, joinWithComma, convertBindingToExpr, forEachIdentifierBindingInDecls } from "./js_ast_helpers.mjs";
import { isIdentifier } from "./js_ident.mjs";
import {
  Keywords,
  rangeOfIdentifier,
} from "./js_lexer.mjs";
import { print as printJS, Options as PrinterOptions, PrintResult, quoteIdentifier, canEscapeIdentifier } from "./js_printer.mjs";
import {
  jsFeatureHas,
  jsFeatureEqual,
  InlineScript,
  Arrow,
  ObjectExtensions,
  DynamicImport,
  ArbitraryModuleNamespaceNames,
  LogicalAssignment,
  JSFeatureNone,
} from "./compat.mjs";
import { computeReservedNames, newNumberRenamer, newMinifyRenamer, sortStableSymbolCountArray, StableSymbolCount, ExportRenamer } from "./renamer.mjs";
import {
  LineColumnOffset,
  SourceMapPieces,
  SourceMapShift,
  SourceMapState,
  MappingsBuffer,
  Chunk as SourceMapChunk,
  appendSourceMapChunk,
} from "./sourcemap.mjs";

const RUNTIME_SOURCE_INDEX = 0; // runtime.SourceIndex

// config.Loader.CanHaveSourceMap()
export function loaderCanHaveSourceMap(loader) {
  switch (loader) {
    case LoaderJS:
    case LoaderJSX:
    case LoaderTS:
    case LoaderTSNoAmbiguousLessThan:
    case LoaderTSX:
    case LoaderCSS:
    case LoaderGlobalCSS:
    case LoaderLocalCSS:
    case LoaderJSON:
    case LoaderWithTypeJSON:
    case LoaderText:
      return true;
  }
  return false;
}

// Go: base64.StdEncoding.EncodeToString(bytes), where the bytes are the UTF-8
// encoding of the JS string "text"
const base64StdChars = new Uint8Array(64);
for (let i = 0; i < 64; i++) base64StdChars[i] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".charCodeAt(i);
let asciiDecoder = null;
export function base64StdEncodeUTF8(text) {
  if (asciiDecoder === null) {
    asciiDecoder = new TextDecoder();
  }
  const bytes = goStringBytes(text);
  const n = bytes.length;
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = base64StdChars[v >> 18];
    out[o++] = base64StdChars[(v >> 12) & 63];
    out[o++] = base64StdChars[(v >> 6) & 63];
    out[o++] = base64StdChars[v & 63];
  }
  if (i < n) {
    // Pad the final group with "="
    const v = (bytes[i] << 16) | (i + 1 < n ? bytes[i + 1] << 8 : 0);
    out[o++] = base64StdChars[v >> 18];
    out[o++] = base64StdChars[(v >> 12) & 63];
    out[o++] = i + 1 < n ? base64StdChars[(v >> 6) & 63] : 61;
    out[o++] = 61;
  }
  return asciiDecoder.decode(out);
}

// ---------------------------------------------------------------------------
// Types

export class linkerContext {
  declare options: any;
  declare timer: Timer | null;
  declare log: any;
  declare fs: any;
  declare res: any;
  declare graph: any;
  declare chunks: any[];
  declare dataForSourceMaps: any;
  declare cycleDetector: any[];
  declare uniqueKeyPrefix: any;
  declare mangledProps: any;
  declare unboundModuleRef: number;
  declare cjsRuntimeRef: number;
  declare esmRuntimeRef: number;
  declare requireOrImportMetaForSourceFn: any;
  declare lazyNSExportStmts: Map<any, any>;
  declare lazyNSExportArgs: Map<any, any>;
  declare computeChunks: () => any;
  declare computeCrossChunkDependencies: () => any;
  declare generateChunksInParallel: (additionalFiles: any) => any;
  declare mangleLocalCSS: (usedLocalNames: any) => any;
  declare mangleProps: (mangleCache: any) => any;
  declare preventExportsFromBeingRenamed: (sourceIndex: any) => any;
  declare scanImportsAndExports: () => any;
  declare treeShakingAndCodeSplitting: () => any;
  constructor(options, log, uniqueKeyPrefix) {
    this.options = options;
    this.timer = null;
    this.log = log;
    this.fs = null;
    this.res = null;
    this.graph = null; // LinkerGraph
    this.chunks = []; // []chunkInfo

    // func() []bundler.DataForSourceMap (only called when source maps are on)
    this.dataForSourceMaps = null;

    // This helps avoid an infinite loop when matching imports to exports
    this.cycleDetector = []; // []importTracker

    this.uniqueKeyPrefix = uniqueKeyPrefix;

    // Property mangling results go here
    this.mangledProps = null; // Map<Ref, string>

    // We may need to refer to the CommonJS "module" symbol for exports
    this.unboundModuleRef = InvalidRef;

    // We may need to refer to the "__esm" and/or "__commonJS" runtime symbols
    this.cjsRuntimeRef = InvalidRef;
    this.esmRuntimeRef = InvalidRef;

    // JS-only: "c.requireOrImportMetaForSource" bound to this context (Go
    // passes the method value to the printer)
    this.requireOrImportMetaForSourceFn = null;

    // JS-only: source index -> builder of the statements of the namespace
    // export part, for parts whose statements are built lazily (see
    // createExportsForFile)
    this.lazyNSExportStmts = new Map();
    // JS-only: source index -> the arguments of that builder
    this.lazyNSExportArgs = new Map();
  }
}

class partRange {
  declare sourceIndex: any;
  declare partIndexBegin: any;
  declare partIndexEnd: any;
  constructor(sourceIndex, partIndexBegin, partIndexEnd) {
    this.sourceIndex = sourceIndex;
    this.partIndexBegin = partIndexBegin;
    this.partIndexEnd = partIndexEnd;
  }
}

class chunkInfo {
  declare uniqueKey: string;
  declare filesWithPartsInChunk: any;
  declare entryBits: any;
  declare crossChunkImports: any[];
  declare chunkRepr: any;
  declare finalTemplate: any[];
  declare finalRelPath: string;
  declare externalLegalComments: string;
  declare outputSourceMap: SourceMapPieces;
  declare intermediateOutput: any;
  declare entryPointBit: number;
  declare sourceIndex: number;
  declare isEntryPoint: boolean;
  declare isExecutable: boolean;
  declare jsonMetadataChunkCallback: any;
  declare isolatedHash: Uint8Array | null;
  constructor() {
    this.jsonMetadataChunkCallback = null; // func(finalOutputSize int) helpers.Joiner
    // JS-only: Go computes this on a goroutine and waits for it only when
    // needed (waitForIsolatedHash); here it is computed on first use
    this.isolatedHash = null;
    this.uniqueKey = "";
    this.filesWithPartsInChunk = null; // Set<number> (Go: map[uint32]bool)
    this.entryBits = null; // BitSet
    this.crossChunkImports = []; // []chunkImport
    this.chunkRepr = null; // chunkReprJS
    this.finalTemplate = null; // []config.PathTemplate
    this.finalRelPath = "";
    this.externalLegalComments = "";
    this.outputSourceMap = new SourceMapPieces(); // sourcemap.SourceMapPieces
    this.intermediateOutput = null;
    this.entryPointBit = 0;
    this.sourceIndex = 0;
    this.isEntryPoint = false;
    this.isExecutable = false;
  }
}

class chunkReprJS {
  declare filesInChunkInOrder: any[];
  declare partsInChunkInOrder: any[];
  declare exportsToOtherChunks: any;
  declare importsFromOtherChunks: any;
  declare crossChunkPrefixStmts: any[];
  declare crossChunkSuffixStmts: any[];
  declare cssChunkIndex: number;
  declare hasCSSChunk: boolean;
  constructor() {
    this.filesInChunkInOrder = [];
    this.partsInChunkInOrder = [];

    // For code splitting
    this.exportsToOtherChunks = null;
    this.importsFromOtherChunks = null;
    this.crossChunkPrefixStmts = EMPTY_ARRAY;
    this.crossChunkSuffixStmts = EMPTY_ARRAY;

    this.cssChunkIndex = 0;
    this.hasCSSChunk = false;
  }
}

class chunkReprCSS {
  declare importsInChunkInOrder: any[];
  constructor(importsInChunkInOrder: any[] = []) {
    this.importsInChunkInOrder = importsInChunkInOrder;
  }
}

class chunkImport {
  declare chunkIndex: number;
  declare importKind: number;
  constructor(chunkIndex: number, importKind: number) {
    this.chunkIndex = chunkIndex;
    this.importKind = importKind;
  }
}

class crossChunkImport {
  declare sortedImportItems: crossChunkImportItem[];
  declare chunkIndex: number;
  constructor(sortedImportItems: crossChunkImportItem[], chunkIndex: number) {
    this.sortedImportItems = sortedImportItems;
    this.chunkIndex = chunkIndex;
  }
}

class crossChunkImportItem {
  declare exportAlias: string;
  declare ref: number;
  constructor(exportAlias: string, ref: number) {
    this.exportAlias = exportAlias;
    this.ref = ref;
  }
}

// outputPieceIndexKind
const outputPieceNone = 0;
const outputPieceAssetIndex = 1;
const outputPieceChunkIndex = 2;

// This is a chunk of source code followed by a reference to another chunk. For
// example, the file "@import 'CHUNK0001'; body { color: black; }" would be
// represented by two pieces, one with the data "@import '" and another with the
// data "'; body { color: black; }". The first would have the chunk index 1 and
// the second would have an invalid chunk index.
class outputPiece {
  declare data: string;
  declare index: number;
  declare kind: number;
  constructor(data: string, index = 0, kind = outputPieceNone) {
    this.data = data;
    this.index = index;
    this.kind = kind;
  }
}

function hashWriteUint32(hash: Digest, value: number) {
  const lengthBytes = new Uint8Array(4);
  lengthBytes[0] = value & 0xff;
  lengthBytes[1] = (value >>> 8) & 0xff;
  lengthBytes[2] = (value >>> 16) & 0xff;
  lengthBytes[3] = value >>> 24;
  hash.write(lengthBytes);
}

// Hash the data in length-prefixed form because boundary locations are
// important. We don't want "a" + "bc" to hash the same as "ab" + "c".
// (The data is a JS string: its UTF-8 bytes are hashed, like Go's []byte.)
function hashWriteLengthPrefixed(hash: Digest, data: string) {
  const bytes = goStringBytes(data);
  hashWriteUint32(hash, bytes.length);
  hash.write(bytes);
}

function joinWithPublicPath(publicPath: string, relPath: string): string {
  if (relPath.startsWith("./")) {
    relPath = relPath.slice(2);

    // Strip any amount of further no-op slashes (i.e. ".///././/x/y" => "x/y")
    for (;;) {
      if (relPath.startsWith("/")) {
        relPath = relPath.slice(1);
      } else if (relPath.startsWith("./")) {
        relPath = relPath.slice(2);
      } else {
        break;
      }
    }
  }

  // Use a relative path if there is no public path
  if (publicPath === "") {
    publicPath = ".";
  }

  // Join with a slash
  let slash = "/";
  if (publicPath.endsWith("/")) {
    slash = "";
  }
  return publicPath + slash + relPath;
}

// Go's url.URL{Path: path}.EscapedPath(): the UTF-8 bytes that
// shouldEscape(c, encodePath) says must be escaped become "%XX"
const hexUpper = "0123456789ABCDEF";
function goURLEscapePath(path: string): string {
  let needsEscape = false;
  for (let i = 0; i < path.length; i++) {
    if (goURLShouldEscapePathChar(path.charCodeAt(i))) {
      needsEscape = true;
      break;
    }
  }
  if (!needsEscape) return path;
  const bytes = goStringBytes(path);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (goURLShouldEscapePathChar(c)) out += "%" + hexUpper[c >> 4] + hexUpper[c & 15];
    else out += String.fromCharCode(c);
  }
  return out;
}

function goURLShouldEscapePathChar(c: number): boolean {
  // Section 2.3 Unreserved characters (alphanum)
  if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57)) return false;
  switch (c) {
    case 45: // -
    case 95: // _
    case 46: // .
    case 126: // ~
      return false;
    case 36: // $
    case 38: // &
    case 43: // +
    case 44: // ,
    case 47: // /
    case 58: // :
    case 59: // ;
    case 61: // =
    case 64: // @
      return false;
    case 63: // ?
      return true;
  }
  // Everything else must be escaped (including every non-ASCII byte)
  return true;
}

// helpers.FileURLFromFilePath(path).Path
function fileURLPathFromFilePath(filePath: string): string {
  // Append a trailing slash so that resolving the URL includes the trailing
  // directory, and turn Windows-style paths with volumes into URL-style paths:
  //
  //   "/Users/User/Desktop" => "/Users/User/Desktop/"
  //   "C:\\Users\\User\\Desktop" => "/C:/Users/User/Desktop/"
  //
  filePath = filePath.replaceAll("\\", "/");
  if (!filePath.startsWith("/")) {
    filePath = "/" + filePath;
  }
  return filePath;
}

// helpers.FilePathFromFileURL(fs, url) given the URL's path
function filePathFromFileURLPath(fs: any, path: string): string {
  // Convert URL-style paths back into Windows-style paths if needed:
  //
  //   "/C:/Users/User/foo.js.map" => "C:\\Users\\User\\foo.js.map"
  //
  if (!fs.cwd().startsWith("/")) {
    if (path.startsWith("/")) path = path.slice(1);
    path = path.replaceAll("/", "\\"); // This is needed for "filepath.Rel()" to work
  }
  return path;
}

// Go's url.URL{Path: path}.String() for a relative path (no scheme or host)
function goURLStringForRelativePath(path: string): string {
  const escaped = goURLEscapePath(path);
  // RFC 3986 Section 4.2: a first path segment with a colon needs a "./" prefix
  const slash = escaped.indexOf("/");
  const segment = slash < 0 ? escaped : escaped.slice(0, slash);
  if (segment.includes(":")) return "./" + escaped;
  return escaped;
}

export class intermediateOutput {
  declare pieces: any;
  declare joiner: any;
  constructor(pieces, joiner) {
    this.pieces = pieces;
    this.joiner = joiner;
  }
}

class stmtList {
  declare insideWrapperPrefix: any[];
  declare insideWrapperSuffix: any[];
  declare outsideWrapperPrefix: any[];
  constructor() {
    // These statements come first, and can be inside the wrapper
    this.insideWrapperPrefix = [];

    // These statements come last, and can be inside the wrapper
    this.insideWrapperSuffix = [];

    this.outsideWrapperPrefix = [];
  }
}

class compileResultJS {
  declare js: string;
  declare extractedLegalComments: any;
  declare jsonMetadataImports: any;
  declare sourceMapChunk: any;
  declare sourceIndex: number;
  declare generatedOffset: any;
  constructor() {
    // js_printer.PrintResult (embedded)
    this.js = "";
    this.extractedLegalComments = null;
    this.jsonMetadataImports = null;
    this.sourceMapChunk = null;

    this.sourceIndex = 0;

    // This is the line and column offset since the previous JavaScript string
    // or the start of the file if this is the first JavaScript string.
    this.generatedOffset = null; // sourcemap.LineColumnOffset
  }
  setPrintResult(result) {
    this.js = result.js;
    this.extractedLegalComments = result.extractedLegalComments === undefined ? null : result.extractedLegalComments;
    this.jsonMetadataImports = result.jsonMetadataImports === undefined ? null : result.jsonMetadataImports;
    this.sourceMapChunk = result.sourceMapChunk === undefined ? null : result.sourceMapChunk;
  }
}

export class compileResultForSourceMap {
  declare sourceMapChunk: any;
  declare generatedOffset: any;
  declare sourceIndex: any;
  declare isNullEntry: any;
  constructor(sourceMapChunk, generatedOffset, sourceIndex, isNullEntry) {
    this.sourceMapChunk = sourceMapChunk; // sourcemap.Chunk
    this.generatedOffset = generatedOffset; // sourcemap.LineColumnOffset
    this.sourceIndex = sourceIndex;
    this.isNullEntry = isNullEntry;
  }
}

// js_printer.RequireOrImportMeta (only read by the printer)
class RequireOrImportMeta {
  declare wrapperRef: number;
  declare exportsRef: number;
  declare isWrapperAsync: boolean;
  constructor(wrapperRef = InvalidRef, exportsRef = InvalidRef, isWrapperAsync = false) {
    this.wrapperRef = wrapperRef;
    this.exportsRef = exportsRef;
    this.isWrapperAsync = isWrapperAsync;
  }
}

export class legalCommentEntry {
  declare sourceIndex: any;
  declare comments: any;
  constructor(sourceIndex, comments) {
    this.sourceIndex = sourceIndex;
    this.comments = comments;
  }
}

// ---------------------------------------------------------------------------
// Link

// Same parameter list as Go's linker.Link (timer, fs and res are unused and
// may be null; dataForSourceMaps is a function returning the
// []bundler.DataForSourceMap, only called when source maps are enabled).
// JS-only: "mangleCache" (a Map<string, string | false> or null) is what Go
// hands to the linker through options.ExclusiveMangleCacheUpdate.
// Returns []OutputFile.
import { findImportedFilesInCSSOrder, mangleLocalCSS as mangleLocalCSSImpl, generateChunkCSS, cssImportSourceIndex } from "./linker_css.mjs";
import { ENameOfSymbol, TemplatePart, ETemplate } from "./js_ast.mjs";
import { LoaderEmpty } from "./config.mjs";
import { WasLoadedWithEmptyLoader } from "./ast.mjs";
import { MsgID_CSS_UndefinedComposesFrom } from "./logger.mjs";

// path.Clean(config.TemplateToString(chunk.finalTemplate)), the name of a
// chunk in the timing information. (A transform does not compute the
// templates, see computeChunks: its only chunk is named after the base name
// of the output file, "<stdin>-out" or "<sourcefile>-out", on Go's mock file
// system for Unix.)
export function chunkNameForTimer(c, chunk): string {
  if (c.fs === null) {
    const p: string = c.options.absOutputFile;
    return goPathClean(p.slice(p.lastIndexOf("/") + 1));
  }
  return goPathClean(templateToString(chunk.finalTemplate));
}

// wrappedLog: the log with its own "has errors" flag, which only counts the
// errors added through it (Link runs once per entry point without code
// splitting, with the same log)
// (a class, not Object.create(log): making the log a prototype on every link
// is slow)
class LinkLog extends Log {
  declare inner: any;
  declare linkHasErrors: boolean;
  constructor(inner) {
    super(inner.level, inner.overrides);
    this.inner = inner;
    this.linkHasErrors = false;
  }
  addMsg(msg) {
    if (msg.kind === MsgError) {
      this.linkHasErrors = true;
    }
    this.inner.addMsg(msg);
  }
  hasErrors() {
    return this.linkHasErrors;
  }
}
function wrappedLog(log) {
  return new LinkLog(log);
}

export function link(
  options,
  timer,
  log,
  fs,
  res,
  inputFiles,
  entryPoints,
  uniqueKeyPrefix,
  reachableFiles,
  dataForSourceMaps,
  mangleCache = null,
  deepClone = false,
  cssUsedLocalNames: Map<string, boolean> | null = null,
) {
  if (timer === null) {
    return linkImpl(options, timer, log, fs, res, inputFiles, entryPoints, uniqueKeyPrefix, reachableFiles, dataForSourceMaps, mangleCache, deepClone, cssUsedLocalNames);
  }
  timer?.begin("Link");
  try {
    return linkImpl(options, timer, log, fs, res, inputFiles, entryPoints, uniqueKeyPrefix, reachableFiles, dataForSourceMaps, mangleCache, deepClone, cssUsedLocalNames);
  } finally {
    timer?.end("Link");
  }
}

function linkImpl(options, timer: Timer | null, log, fs, res, inputFiles, entryPoints, uniqueKeyPrefix, reachableFiles, dataForSourceMaps, mangleCache, deepClone: boolean, cssUsedLocalNames: Map<string, boolean> | null) {
  log = wrappedLog(log);

  timer?.begin("Clone linker graph");
  const c = new linkerContext(options, log, uniqueKeyPrefix);
  c.timer = timer;
  c.fs = fs;
  c.res = res;
  c.dataForSourceMaps = dataForSourceMaps;
  c.graph = cloneLinkerGraph(inputFiles, reachableFiles, entryPoints, options.codeSplitting, deepClone);
  timer?.end("Clone linker graph");

  // Use a smaller version of these functions if we don't need profiler names
  const runtimeRepr = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr;
  if (c.options.profilerNames) {
    c.cjsRuntimeRef = runtimeRepr.ast.namedExports.get("__commonJS").ref;
    c.esmRuntimeRef = runtimeRepr.ast.namedExports.get("__esm").ref;
  } else {
    c.cjsRuntimeRef = runtimeRepr.ast.namedExports.get("__commonJSMin").ref;
    c.esmRuntimeRef = runtimeRepr.ast.namedExports.get("__esmMin").ref;
  }

  const additionalFiles = [];
  for (const entryPoint of entryPoints) {
    const file = c.graph.files[entryPoint.sourceIndex].inputFile;
    const repr = file.repr;
    if (repr instanceof JSRepr) {
      // Loaders default to CommonJS when they are the entry point and the output
      // format is not ESM-compatible since that avoids generating the ESM-to-CJS
      // machinery.
      if (
        repr.ast.hasLazyExport &&
        (c.options.mode === ModePassThrough || (c.options.mode === ModeConvertFormat && !formatKeepESMImportExportSyntax(c.options.outputFormat)))
      ) {
        repr.ast.exportsKind = ExportsCommonJS;
      }

      // Entry points with ES6 exports must generate an exports object when
      // targeting non-ES6 formats. Note that the IIFE format only needs this
      // when the global name is present, since that's the only way the exports
      // can actually be observed externally.
      if (
        repr.ast.exportKeyword.len > 0 &&
        (options.outputFormat === FormatCommonJS || (options.outputFormat === FormatIIFE && options.globalName.length > 0))
      ) {
        repr.ast.usesExportsRef = true;
        repr.meta.forceIncludeExportsForEntryPoint = true;
      }
    } else if (repr instanceof CopyRepr) {
      for (const f of file.additionalFiles) additionalFiles.push(f);
    }
  }

  // Allocate a new unbound symbol called "module" in case we need it later
  if (c.options.outputFormat === FormatCommonJS) {
    c.unboundModuleRef = c.graph.generateNewSymbol(RUNTIME_SOURCE_INDEX, SymbolUnbound, "module");
  } else {
    c.unboundModuleRef = InvalidRef;
  }

  c.scanImportsAndExports();

  // Stop now if there were errors
  if (c.log.hasErrors()) {
    // (Go calls ExclusiveMangleCacheUpdate with a callback that does nothing:
    // "Always do this so that we don't cause other entry points when there
    // are errors")
    return [];
  }

  c.treeShakingAndCodeSplitting();

  if (c.options.mode === ModePassThrough) {
    for (const entryPoint of c.graph.entryPoints()) {
      c.preventExportsFromBeingRenamed(entryPoint.sourceIndex);
    }
  }

  c.computeChunks();
  c.computeCrossChunkDependencies();

  // Merge mangled properties before chunks are generated since the names must
  // be consistent across all chunks, or the generated code will break
  c.timer?.begin("Waiting for mangle cache");
  c.timer?.end("Waiting for mangle cache");
  c.mangleProps(mangleCache);
  c.mangleLocalCSS(cssUsedLocalNames === null ? new Map() : cssUsedLocalNames);

  // Go calls ast.FollowAllSymbols() here so that calls to "ast.FollowSymbols()"
  // in parallel goroutines after this won't hit concurrent map mutation
  // hazards. It only path-compresses symbol links (nothing reads "link"
  // without following it), so the single-threaded port skips it.

  return c.generateChunksInParallel(additionalFiles);
}

Object.assign(linkerContext.prototype, {
  // "mangleCache" is a Map<string, string | false> (Go's
  // map[string]interface{} with string or false values) or null (Go: nil)
  mangleProps(mangleCache) {
    const c = this;
    if (c.timer === null) {
      return c.manglePropsImpl(mangleCache);
    }
    c.timer?.begin("Mangle props");
    try {
      return c.manglePropsImpl(mangleCache);
    } finally {
      c.timer?.end("Mangle props");
    }
  },

  manglePropsImpl(mangleCache) {
    const c = this;
    const mangledProps = new Map();
    c.mangledProps = mangledProps;

    // JS-only: without a mangled property in any file (always the case
    // without "--mangle-props") the result is an empty map and the mangle
    // cache is not changed, so the work below (keyword set, character
    // frequency shuffle, ...) is skipped
    let hasMangledProps = false;
    for (const sourceIndex of c.graph.reachableFiles) {
      if (sourceIndex === RUNTIME_SOURCE_INDEX) continue;
      const repr = c.graph.files[sourceIndex].inputFile.repr;
      if (repr instanceof JSRepr && repr.ast.mangledProps !== null && repr.ast.mangledProps.size > 0) {
        hasMangledProps = true;
        break;
      }
    }
    if (!hasMangledProps) return;

    // Reserve all JS keywords
    const reservedProps = new Set();
    for (const keyword of Keywords.keys()) {
      reservedProps.add(keyword);
    }

    // Reserve all target properties in the cache
    if (mangleCache !== null) {
      for (const [original, remapped] of mangleCache) {
        if (remapped === false) {
          reservedProps.add(original);
        } else {
          reservedProps.add(remapped);
        }
      }
    }

    // Merge all mangled property symbols together
    const freq = newCharFreq();
    const mergedProps = new Map();
    for (const sourceIndex of c.graph.reachableFiles) {
      // Don't mangle anything in the runtime code
      if (sourceIndex === RUNTIME_SOURCE_INDEX) {
        continue;
      }

      // For each file
      const repr = c.graph.files[sourceIndex].inputFile.repr;
      if (repr instanceof JSRepr) {
        // Reserve all non-mangled properties
        if (repr.ast.reservedProps !== null) {
          for (const prop of repr.ast.reservedProps.keys()) {
            reservedProps.add(prop);
          }
        }

        // Merge each mangled property with other ones of the same name
        if (repr.ast.mangledProps !== null) {
          for (const [name, ref] of repr.ast.mangledProps) {
            const existing = mergedProps.get(name);
            if (existing !== undefined) {
              writableSymbolChain(c.graph.symbols, ref);
              writableSymbolChain(c.graph.symbols, existing);
              mergeSymbols(c.graph.symbols, ref, existing);
            } else {
              mergedProps.set(name, ref);
            }
          }
        }

        // Include this file's frequency histogram, which affects the mangled names
        if (repr.ast.charFreq !== null) {
          charFreqInclude(freq, repr.ast.charFreq);
        }
      }
    }

    // Sort by use count (note: does not currently account for live vs. dead code)
    // (Go iterates the map in random order; the sort key is unique per ref)
    const sorted = [];
    const stableSourceIndices = c.graph.stableSourceIndices;
    for (const ref of mergedProps.values()) {
      sorted.push(new StableSymbolCount(stableSourceIndices[refSource(ref)], ref, c.graph.symbols.get(ref).useCountEstimate));
    }
    sortStableSymbolCountArray(sorted);

    // Assign names in order of use count
    const minifier = DefaultNameMinifierJS.shuffleByCharFreq(freq);
    let nextName = 0;
    for (let i = 0; i < sorted.length; i++) {
      const symbolCount = sorted[i];
      const symbol = c.graph.symbols.get(symbolCount.ref);

      // Don't change existing mappings
      if (mangleCache !== null && mangleCache.has(symbol.originalName)) {
        const existing = mangleCache.get(symbol.originalName);
        if (existing !== false) {
          mangledProps.set(symbolCount.ref, existing);
        }
        continue;
      }

      // Generate a new name
      let name = minifier.numberToMinifiedName(nextName);
      nextName++;

      // Avoid reserved properties
      while (reservedProps.has(name)) {
        name = minifier.numberToMinifiedName(nextName);
        nextName++;
      }

      // Track the new mapping
      if (mangleCache !== null) {
        mangleCache.set(symbol.originalName, name);
      }
      mangledProps.set(symbolCount.ref, name);
    }
  },

  validateComposesFromProperties(rootFile, rootRepr) {
    const c = this;
    for (const local of rootRepr.ast.localSymbols) {
      const visited = new Set<number>();
      // (propertyInFile: {file, loc}; a null file means "don't warn again")
      const properties = new Map<string, { file: any; loc: number }>();

      const visit = (file, repr, ref) => {
        if (visited.has(ref)) {
          return;
        }
        visited.add(ref);

        const composes = repr.ast.composes.get(ref);
        if (composes === undefined) {
          return;
        }

        for (const name of composes.importedNames) {
          const record = repr.ast.importRecords[name.importRecordIndex];
          if (record.sourceIndex >= 0) {
            const otherFile = c.graph.files[record.sourceIndex];
            const otherRepr = otherFile.inputFile.repr;
            if (otherRepr instanceof CSSRepr) {
              const otherName = otherRepr.ast.localScope.get(name.alias);
              if (otherName !== undefined) {
                visit(otherFile, otherRepr, otherName.ref);
              }
            }
          }
        }

        for (const name of composes.names) {
          visit(file, repr, name.ref);
        }

        // Warn about cross-file composition with the same CSS properties
        // (Go iterates a map: the messages are sorted by the log later)
        for (const [keyText, keyLoc] of composes.properties) {
          const property = properties.get(keyText);
          if (property === undefined) {
            properties.set(keyText, { file, loc: keyLoc });
            continue;
          }
          if (property.file === file || property.file === null) {
            continue;
          }

          const localOriginalName = c.graph.symbols.get(local.ref).originalName;
          c.log.addMsgID(
            MsgID_CSS_UndefinedComposesFrom,
            new Msg(
              [
                property.file.lineColumnTracker().msgData(cssRangeOfIdentifier(property.file.inputFile.source, property.loc), "The first definition of " + goQuote(keyText) + " is here:"),
                file.lineColumnTracker().msgData(cssRangeOfIdentifier(file.inputFile.source, keyLoc), "The second definition of " + goQuote(keyText) + " is here:"),
                new MsgData(
                  null,
                  null,
                  'The specification of "composes" does not define an order when class declarations from separate files are composed together. ' +
                    "The value of the " +
                    goQuote(keyText) +
                    " property for " +
                    goQuote(localOriginalName) +
                    " may change unpredictably as the code is edited. " +
                    "Make sure that all definitions of " +
                    goQuote(keyText) +
                    " for " +
                    goQuote(localOriginalName) +
                    " are in a single file.",
                ),
              ],
              "",
              rootFile.lineColumnTracker().msgData(cssRangeOfIdentifier(rootFile.inputFile.source, local.loc), "The value of " + goQuote(keyText) + " in the " + goQuote(localOriginalName) + " class is undefined"),
              MsgWarning,
            ),
          );

          // Don't warn more than once
          property.file = null;
          properties.set(keyText, property);
        }
      };

      visit(rootFile, rootRepr, local.ref);
    }
  },

  mangleLocalCSS(usedLocalNames) {
    if (this.timer === null) {
      mangleLocalCSSImpl(this, usedLocalNames, 0);
      return;
    }
    this.timer?.begin("Mangle local CSS");
    try {
      mangleLocalCSSImpl(this, usedLocalNames, 0);
    } finally {
      this.timer?.end("Mangle local CSS");
    }
  },

  enforceNoCyclicChunkImports() {
    const c = this;
    // DFS memoization with 3-colors, more space efficient
    // 0: white (unvisited), 1: gray (visiting), 2: black (visited)
    const colors = new Map<number, number>();
    const validate = (chunkIndex: number): boolean => {
      const color = colors.get(chunkIndex) ?? 0;
      if (color === 1) {
        c.log.addError(null, RANGE_ZERO, "Internal error: generated chunks contain a circular import");
        return true;
      }

      if (color === 2) {
        return false;
      }

      colors.set(chunkIndex, 1);

      for (const chunkImport of c.chunks[chunkIndex].crossChunkImports) {
        // Ignore cycles caused by dynamic "import()" expressions. These are fine
        // because they don't necessarily cause initialization order issues and
        // they don't indicate a bug in our chunk generation algorithm. They arise
        // normally in real code (e.g. two files that import each other).
        if (chunkImport.importKind !== ImportDynamic) {
          // Recursively validate otherChunkIndex
          if (validate(chunkImport.chunkIndex)) {
            return true;
          }
        }
      }

      colors.set(chunkIndex, 2);
      return false;
    };

    for (let i = 0; i < c.chunks.length; i++) {
      if (validate(i)) {
        break;
      }
    }
  },

  generateChunksInParallel(additionalFiles) {
    const c = this;
    if (c.timer === null) {
      return c.generateChunksInParallelImpl(additionalFiles);
    }
    c.timer?.begin("Generate chunks");
    try {
      return c.generateChunksInParallelImpl(additionalFiles);
    } finally {
      c.timer?.end("Generate chunks");
    }
  },

  generateChunksInParallelImpl(additionalFiles) {
    const c = this;

    // Generate each chunk. When a chunk needs to reference the path of another
    // chunk, it will use a temporary path called the "uniqueKey" since the
    // final path hasn't been computed yet (and is in general uncomputable at
    // this point because paths have hashes that include information about
    // chunk dependencies, and chunk dependencies can be cyclic due to dynamic
    // imports).
    for (let chunkIndex = 0; chunkIndex < c.chunks.length; chunkIndex++) {
      const chunk = c.chunks[chunkIndex];
      // (Go: "defer c.recoverInternalError(...)" in both, and the forked
      // timer's "defer c.timer.Join(timer)" and "defer timer.End(timeName)")
      try {
        if (c.timer === null) {
          if (chunk.chunkRepr instanceof chunkReprJS) c.generateChunkJS(chunkIndex, null);
          else generateChunkCSS(c, chunk, null);
          continue;
        }
        const timer = c.timer === null ? null : c.timer.fork();
        const timeName = timer === null ? "" : "Generate chunk " + goQuote(chunkNameForTimer(c, chunk));
        timer?.begin(timeName);
        try {
          if (chunk.chunkRepr instanceof chunkReprJS) {
            c.generateChunkJS(chunkIndex, timer);
          } else {
            generateChunkCSS(c, chunk, timer);
          }
        } finally {
          timer?.end(timeName);
          c.timer?.join(timer);
        }
      } catch (e) {
        recoverLinkerPanic(e, c.log, null);
      }
    }
    c.enforceNoCyclicChunkImports();

    // Compute the final hashes of each chunk, then use those to create the final
    // paths of each chunk. This can technically be done in parallel but it
    // probably doesn't matter so much because we're not hashing that much data.
    const visited = new Array(c.chunks.length).fill(0);
    for (let chunkIndex = 0; chunkIndex < c.chunks.length; chunkIndex++) {
      const chunk = c.chunks[chunkIndex];
      let hashSubstitution = null;

      // JS-only: the transform API only looks at the relative lengths of the
      // output paths (a transform produces exactly one chunk, so the chunk file
      // is always the shortest output path and the legal comments file is
      // always "<chunk path>.LEGAL.txt"), so the path templates are not
      // evaluated and a placeholder is used instead
      if (c.fs === null) {
        chunk.finalRelPath = "<chunk" + chunkIndex + ">";
        continue;
      }

      // Only wait for the hash if necessary
      if (hasPlaceholder(chunk.finalTemplate, HashPlaceholder)) {
        // Compute the final hash using the isolated hashes of the dependencies
        const hash = new Digest();
        c.appendIsolatedHashesForImportedChunks(hash, chunkIndex, visited, ~chunkIndex >>> 0);
        hashSubstitution = hashForFileName(hash.sum());
      }

      // Render the last remaining placeholder in the template
      chunk.finalRelPath = templateToString(substituteTemplate(chunk.finalTemplate, new PathPlaceholders(null, null, hashSubstitution, null)));
    }

    // Generate the final output files by joining file pieces together and
    // substituting the temporary paths for the final paths
    c.timer?.begin("Generate final output files");
    const results = new Array(c.chunks.length);
    for (let chunkIndex = 0; chunkIndex < c.chunks.length; chunkIndex++) {
      const chunk = c.chunks[chunkIndex];
      const outputFiles = [];

      // Each file may optionally contain additional files to be copied to the
      // output directory. This is used by the "file" and "copy" loaders.
      let commentPrefix = "";
      let commentSuffix = "";
      if (chunk.chunkRepr instanceof chunkReprJS) {
        for (const sourceIndex of chunk.chunkRepr.filesInChunkInOrder) {
          for (const f of c.graph.files[sourceIndex].inputFile.additionalFiles) outputFiles.push(f);
        }
        commentPrefix = "//";
      } else {
        for (const entry of chunk.chunkRepr.importsInChunkInOrder) {
          if (entry.kind === cssImportSourceIndex) {
            for (const f of c.graph.files[entry.sourceIndex].inputFile.additionalFiles) outputFiles.push(f);
          }
        }
        commentPrefix = "/*";
        commentSuffix = " */";
      }

      // Path substitution for the chunk itself
      const finalRelDir = c.fs === null ? "" : c.fs.dir(chunk.finalRelPath);
      const outputPath = (relPath) => (c.fs === null ? relPath : c.fs.join(c.options.absOutputDir, relPath));
      const $s = c.substituteFinalPaths(chunk.intermediateOutput, (finalRelPathForImport) => c.pathBetweenChunks(finalRelDir, finalRelPathForImport));
      const outputContentsJoiner = $s[0],
        outputSourceMapShifts = $s[1];

      // Generate the optional legal comments file for this chunk
      if (chunk.externalLegalComments.length > 0) {
        const finalRelPathForLegalComments = chunk.finalRelPath + ".LEGAL.txt";

        // Link the file to the legal comments
        if (c.options.legalComments === LegalCommentsLinkedWithComment) {
          let importPath = c.pathBetweenChunks(finalRelDir, finalRelPathForLegalComments);
          if (importPath.startsWith("./")) importPath = importPath.slice(2);
          outputContentsJoiner.ensureNewlineAtEnd();
          outputContentsJoiner.addString("/*! For license information please see ");
          outputContentsJoiner.addString(importPath);
          outputContentsJoiner.addString(" */\n");
        }

        // Write the external legal comments file
        outputFiles.push(
          new OutputFile(
            metafileFormatMaybeRemoveWhitespace(c.options.metafileFormat, '{\n      "imports": [],\n      "exports": [],\n      "inputs": {},\n      "bytes": ') +
              utf8Len(chunk.externalLegalComments) +
              metafileFormatMaybeRemoveWhitespace(c.options.metafileFormat, "\n    }"),
            outputPath(finalRelPathForLegalComments),
            chunk.externalLegalComments,
          ),
        );
      }

      // Generate the optional source map for this chunk
      if (c.options.sourceMap !== SourceMapNone && chunk.outputSourceMap.hasContent()) {
        const outputSourceMap = chunk.outputSourceMap.finalize(outputSourceMapShifts);
        const finalRelPathForSourceMap = chunk.finalRelPath + ".map";

        // Potentially write a trailing source map comment
        switch (c.options.sourceMap) {
          case SourceMapLinkedWithComment: {
            let importPath = c.pathBetweenChunks(finalRelDir, finalRelPathForSourceMap);
            if (importPath.startsWith("./")) importPath = importPath.slice(2);
            outputContentsJoiner.ensureNewlineAtEnd();
            outputContentsJoiner.addString(commentPrefix);
            outputContentsJoiner.addString("# sourceMappingURL=");
            outputContentsJoiner.addString(goURLEscapePath(importPath));
            outputContentsJoiner.addString(commentSuffix);
            outputContentsJoiner.addString("\n");
            break;
          }

          case SourceMapInline:
          case SourceMapInlineAndExternal:
            outputContentsJoiner.ensureNewlineAtEnd();
            outputContentsJoiner.addString(commentPrefix);
            outputContentsJoiner.addString("# sourceMappingURL=data:application/json;base64,");
            outputContentsJoiner.addString(base64StdEncodeUTF8(outputSourceMap));
            outputContentsJoiner.addString(commentSuffix);
            outputContentsJoiner.addString("\n");
            break;
        }

        // Potentially write the external source map file
        switch (c.options.sourceMap) {
          case SourceMapLinkedWithComment:
          case SourceMapInlineAndExternal:
          case SourceMapExternalWithoutComment:
            outputFiles.push(
              new OutputFile(
                metafileFormatMaybeRemoveWhitespace(c.options.metafileFormat, '{\n      "imports": [],\n      "exports": [],\n      "inputs": {},\n      "bytes": ') +
                  utf8Len(outputSourceMap) +
                  metafileFormatMaybeRemoveWhitespace(c.options.metafileFormat, "\n    }"),
                outputPath(finalRelPathForSourceMap),
                outputSourceMap,
              ),
            );
            break;
        }
      }

      // Finalize the output contents
      const outputContents = outputContentsJoiner.done();

      // Path substitution for the JSON metadata
      let jsonMetadataChunk = "";
      if (c.options.needsMetafile) {
        const jsonMetadataChunkPieces = c.breakJoinerIntoPieces(chunk.jsonMetadataChunkCallback(utf8Len(outputContents)));
        const jsonMetadataChunkBytes = c.substituteFinalPaths(jsonMetadataChunkPieces, (finalRelPathForImport) => {
          const prettyPaths = makePrettyPaths(c.fs, new Path(c.fs.join(c.options.absOutputDir, finalRelPathForImport), "file"));
          return prettyPaths.select(c.options.metafilePathStyle);
        })[0];
        jsonMetadataChunk = jsonMetadataChunkBytes.done();
      }

      // Generate the output file for this chunk
      outputFiles.push(new OutputFile(jsonMetadataChunk, outputPath(chunk.finalRelPath), outputContents, chunk.isExecutable));

      results[chunkIndex] = outputFiles;
    }
    c.timer?.end("Generate final output files");

    // Merge the output files from the different goroutines together in order
    const outputFiles = additionalFiles.slice();
    for (const result of results) for (const f of result) outputFiles.push(f);
    return outputFiles;
  },

  // Given a set of output pieces (i.e. a buffer already divided into the spans
  // between import paths), substitute the final import paths in and then join
  // everything into a single buffer. Returns [joiner, []sourcemap.SourceMapShift].
  substituteFinalPaths(intermediateOutput, modifyPath) {
    const c = this;

    // Optimization: If there can be no substitutions, just reuse the initial
    // joiner that was used when generating the intermediate chunk output
    // instead of creating another one and copying the whole file into it.
    if (intermediateOutput.pieces === null) return [intermediateOutput.joiner, [new SourceMapShift()]];

    const j = new Joiner();
    const shift = new SourceMapShift();
    const shifts = [new SourceMapShift(shift.before.clone(), shift.after.clone())];

    for (const piece of intermediateOutput.pieces) {
      const dataOffset = new LineColumnOffset();
      j.addString(piece.data);
      dataOffset.advanceString(piece.data);
      shift.before.add(dataOffset);
      shift.after.add(dataOffset);

      switch (piece.kind) {
        case outputPieceAssetIndex: {
          const file = c.graph.files[piece.index];
          if (file.inputFile.additionalFiles.length !== 1) throw new GoPanic("Internal error");
          let relPath = c.fs.rel(c.options.absOutputDir, file.inputFile.additionalFiles[0].absPath)[0];

          // Make sure to always use forward slashes, even on Windows
          relPath = relPath.replaceAll("\\", "/");

          const importPath = modifyPath(relPath);
          j.addString(importPath);
          shift.before.advanceString(file.inputFile.uniqueKeyForAdditionalFile);
          shift.after.advanceString(importPath);
          shifts.push(new SourceMapShift(shift.before.clone(), shift.after.clone()));
          break;
        }

        case outputPieceChunkIndex: {
          const chunk = c.chunks[piece.index];
          const importPath = modifyPath(chunk.finalRelPath);
          j.addString(importPath);
          shift.before.advanceString(chunk.uniqueKey);
          shift.after.advanceString(importPath);
          shifts.push(new SourceMapShift(shift.before.clone(), shift.after.clone()));
          break;
        }
      }
    }

    return [j, shifts];
  },

  // (a byte count, like Go)
  accurateFinalByteCount(output, chunkFinalRelDir) {
    const c = this;
    let count = 0;

    // Note: The paths generated here must match "substituteFinalPaths" above
    for (const piece of output.pieces) {
      count += utf8Len(piece.data);

      switch (piece.kind) {
        case outputPieceAssetIndex: {
          const file = c.graph.files[piece.index];
          if (file.inputFile.additionalFiles.length !== 1) throw new GoPanic("Internal error");
          let relPath = c.fs.rel(c.options.absOutputDir, file.inputFile.additionalFiles[0].absPath)[0];

          // Make sure to always use forward slashes, even on Windows
          relPath = relPath.replaceAll("\\", "/");

          const importPath = c.pathBetweenChunks(chunkFinalRelDir, relPath);
          count += utf8Len(importPath);
          break;
        }

        case outputPieceChunkIndex: {
          const chunk = c.chunks[piece.index];
          const importPath = c.pathBetweenChunks(chunkFinalRelDir, chunk.finalRelPath);
          count += utf8Len(importPath);
          break;
        }
      }
    }

    return count;
  },

  pathBetweenChunks(fromRelDir, toRelPath) {
    const c = this;

    // Join with the public path if it has been configured
    if (c.options.publicPath !== "") {
      return joinWithPublicPath(c.options.publicPath, toRelPath);
    }

    // Otherwise, return a relative path
    const $rel = c.fs.rel(fromRelDir, toRelPath);
    if (!$rel[1]) {
      c.log.addError(null, RANGE_ZERO, "Cannot traverse from directory " + goQuote(fromRelDir) + " to chunk " + goQuote(toRelPath));
      return "";
    }
    let relPath = $rel[0];

    // Make sure to always use forward slashes, even on Windows
    relPath = relPath.replaceAll("\\", "/");

    // Make sure the relative path doesn't start with a name, since that could
    // be interpreted as a package path instead of a relative path
    if (!relPath.startsWith("./") && !relPath.startsWith("../")) {
      relPath = "./" + relPath;
    }

    return relPath;
  },

  computeCrossChunkDependencies() {
    const c = this;
    if (c.timer === null) {
      return c.computeCrossChunkDependenciesImpl();
    }
    c.timer?.begin("Compute cross-chunk dependencies");
    try {
      return c.computeCrossChunkDependenciesImpl();
    } finally {
      c.timer?.end("Compute cross-chunk dependencies");
    }
  },

  computeCrossChunkDependenciesImpl() {
    const c = this;
    if (!c.options.codeSplitting) {
      // No need to compute cross-chunk dependencies if there can't be any
      return;
    }

    // chunkMeta: {imports: Set<Ref>, exports: Set<Ref>, dynamicImports: Set<number> | null}
    const chunkMetas = new Array(c.chunks.length);

    // For each chunk, see what symbols it uses from other chunks
    for (let chunkIndex = 0; chunkIndex < c.chunks.length; chunkIndex++) {
      const chunk = c.chunks[chunkIndex];
      const imports = new Set<number>();
      const chunkMeta = { imports, exports: new Set<number>(), dynamicImports: null as Set<number> | null };
      chunkMetas[chunkIndex] = chunkMeta;

      // Go over each file in this chunk (Go iterates a map; the result is a
      // set, so the order doesn't matter)
      for (const sourceIndex of chunk.filesWithPartsInChunk) {
        // Go over each part in this file that's marked for inclusion in this chunk
        const repr = c.graph.files[sourceIndex].inputFile.repr;
        if (!(repr instanceof JSRepr)) continue;
        const parts = repr.ast.parts;
        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
          const part = parts[partIndex];
          if (!part.isLive) {
            continue;
          }

          // Rewrite external dynamic imports to point to the chunk for that entry point
          for (const importRecordIndex of part.importRecordIndices) {
            const record = repr.ast.importRecords[importRecordIndex];
            if (record.sourceIndex >= 0 && c.isExternalDynamicImport(record, sourceIndex)) {
              const otherChunkIndex = c.graph.files[record.sourceIndex].entryPointChunkIndex;
              const clone = record.clone();
              clone.path = new Path(c.chunks[otherChunkIndex].uniqueKey, record.path.namespace, record.path.ignoredSuffix, record.path.importAttributes, record.path.flags);
              clone.sourceIndex = -1;
              clone.flags |= ShouldNotBeExternalInMetafile | ContainsUniqueKey;
              repr.ast.importRecords[importRecordIndex] = clone;

              // Track this cross-chunk dynamic import so we make sure to
              // include its hash when we're calculating the hashes of all
              // dependencies of this chunk.
              if (otherChunkIndex !== chunkIndex) {
                if (chunkMeta.dynamicImports === null) {
                  chunkMeta.dynamicImports = new Set();
                }
                chunkMeta.dynamicImports.add(otherChunkIndex);
              }
            }
          }

          // Remember what chunk each top-level symbol is declared in. Symbols
          // with multiple declarations such as repeated "var" statements with
          // the same name should already be marked as all being in a single
          // chunk. In that case this will overwrite the same value below which
          // is fine.
          for (const declared of part.declaredSymbols) {
            if (declared.isTopLevel) {
              writableSymbol(c.graph.symbols, declared.ref).chunkIndex = chunkIndex;
            }
          }

          // Record each symbol used in this part. This will later be matched up
          // with our map of which chunk a given symbol is declared in to
          // determine if the symbol needs to be imported from another chunk.
          for (let ref of part.symbolUses.keys()) {
            let symbol = c.graph.symbols.get(ref);

            // Ignore unbound symbols, which don't have declarations
            if (symbol.kind === SymbolUnbound) {
              continue;
            }

            // Ignore symbols that are going to be replaced by undefined
            if (symbol.importItemStatus === ImportItemMissing) {
              continue;
            }

            // If this is imported from another file, follow the import
            // reference and reference the symbol in that file instead
            const importData = repr.meta.importsToBind.get(ref);
            if (importData !== undefined) {
              ref = importData.ref;
              symbol = c.graph.symbols.get(ref);
            } else if (repr.meta.wrap === WrapCJS && ref !== repr.ast.wrapperRef) {
              // The only internal symbol that wrapped CommonJS files export
              // is the wrapper itself.
              continue;
            }

            // If this is an ES6 import from a CommonJS file, it will become a
            // property access off the namespace symbol instead of a bare
            // identifier. In that case we want to pull in the namespace symbol
            // instead. The namespace symbol stores the result of "require()".
            if (symbol.namespaceAlias !== null) {
              ref = symbol.namespaceAlias.namespaceRef;
            }

            // We must record this relationship even for symbols that are not
            // imports. Due to code splitting, the definition of a symbol may
            // be moved to a separate chunk than the use of a symbol even if
            // the definition and use of that symbol are originally from the
            // same source file.
            imports.add(ref);
          }
        }
      }

      // Include the exports if this is an entry point chunk
      if (chunk.isEntryPoint) {
        const repr = c.graph.files[chunk.sourceIndex].inputFile.repr;
        if (repr instanceof JSRepr) {
          if (repr.meta.wrap !== WrapCJS) {
            for (const alias of repr.meta.sortedAndFilteredExportAliases) {
              const export_ = repr.meta.resolvedExports.get(alias);
              let targetRef = export_.ref;

              // If this is an import, then target what the import points to
              const importData = c.graph.files[export_.sourceIndex].inputFile.repr.meta.importsToBind.get(targetRef);
              if (importData !== undefined) {
                targetRef = importData.ref;
              }

              // If this is an ES6 import from a CommonJS file, it will become a
              // property access off the namespace symbol instead of a bare
              // identifier. In that case we want to pull in the namespace symbol
              // instead. The namespace symbol stores the result of "require()".
              const symbol = c.graph.symbols.get(targetRef);
              if (symbol.namespaceAlias !== null) {
                targetRef = symbol.namespaceAlias.namespaceRef;
              }

              imports.add(targetRef);
            }
          }

          // Ensure "exports" is included if the current output format needs it
          if (repr.meta.forceIncludeExportsForEntryPoint) {
            imports.add(repr.ast.exportsRef);
          }

          // Include the wrapper if present
          if (repr.meta.wrap !== WrapNone) {
            imports.add(repr.ast.wrapperRef);
          }
        }
      }
    }

    // Mark imported symbols as exported in the chunk from which they are declared
    for (let chunkIndex = 0; chunkIndex < c.chunks.length; chunkIndex++) {
      const chunk = c.chunks[chunkIndex];
      const chunkRepr = chunk.chunkRepr;
      if (!(chunkRepr instanceof chunkReprJS)) continue;
      const chunkMeta = chunkMetas[chunkIndex];

      // Find all uses in this chunk of symbols from other chunks
      chunkRepr.importsFromOtherChunks = new Map();
      for (const importRef of chunkMeta.imports) {
        // Ignore uses that aren't top-level symbols
        const otherChunkIndex = c.graph.symbols.get(importRef).chunkIndex;
        if (otherChunkIndex >= 0) {
          if (otherChunkIndex !== chunkIndex) {
            let items = chunkRepr.importsFromOtherChunks.get(otherChunkIndex);
            if (items === undefined) chunkRepr.importsFromOtherChunks.set(otherChunkIndex, (items = []));
            items.push(new crossChunkImportItem("", importRef));
            chunkMetas[otherChunkIndex].exports.add(importRef);
          }
        }
      }

      // If this is an entry point, make sure we import all chunks belonging to
      // this entry point, even if there are no imports. We need to make sure
      // these chunks are evaluated for their side effects too.
      if (chunk.isEntryPoint) {
        for (let otherChunkIndex = 0; otherChunkIndex < c.chunks.length; otherChunkIndex++) {
          const otherChunk = c.chunks[otherChunkIndex];
          if (otherChunk.chunkRepr instanceof chunkReprJS && chunkIndex !== otherChunkIndex && otherChunk.entryBits.hasBit(chunk.entryPointBit)) {
            if (!chunkRepr.importsFromOtherChunks.has(otherChunkIndex)) chunkRepr.importsFromOtherChunks.set(otherChunkIndex, []);
          }
        }
      }

      // Make sure we also track dynamic cross-chunk imports. These need to be
      // tracked so we count them as dependencies of this chunk for the purpose
      // of hash calculation.
      if (chunkMeta.dynamicImports !== null) {
        const sortedDynamicImports = [...chunkMeta.dynamicImports].sort((a, b) => a - b);
        for (const otherChunkIndex of sortedDynamicImports) {
          chunk.crossChunkImports.push(new chunkImport(otherChunkIndex, ImportDynamic));
        }
      }
    }

    // Generate cross-chunk exports. These must be computed before cross-chunk
    // imports because of export alias renaming, which must consider all export
    // aliases simultaneously to avoid collisions.
    for (let chunkIndex = 0; chunkIndex < c.chunks.length; chunkIndex++) {
      const chunk = c.chunks[chunkIndex];
      const chunkRepr = chunk.chunkRepr;
      if (!(chunkRepr instanceof chunkReprJS)) continue;

      chunkRepr.exportsToOtherChunks = new Map();
      if (c.options.outputFormat !== FormatESModule) throw new GoPanic("Internal error");
      const r = new ExportRenamer();
      const items = [];
      for (const export_ of c.sortedCrossChunkExportItems(chunkMetas[chunkIndex].exports)) {
        let alias;
        if (c.options.minifyIdentifiers) {
          alias = r.nextMinifiedName();
        } else {
          alias = r.nextRenamedName(c.graph.symbols.get(export_.ref).originalName);
        }
        items.push(new ClauseItem(alias, "", 0, new LocRef(0, export_.ref)));
        chunkRepr.exportsToOtherChunks.set(export_.ref, alias);
      }
      if (items.length > 0) {
        chunkRepr.crossChunkSuffixStmts = [new Stmt(new SExportClause(items), 0)];
      }
    }

    // Generate cross-chunk imports. These must be computed after cross-chunk
    // exports because the export aliases must already be finalized so they can
    // be embedded in the generated import statements.
    for (let chunkIndex = 0; chunkIndex < c.chunks.length; chunkIndex++) {
      const chunk = c.chunks[chunkIndex];
      const chunkRepr = chunk.chunkRepr;
      if (!(chunkRepr instanceof chunkReprJS)) continue;

      const crossChunkPrefixStmts = [];

      for (const crossChunkImport_ of c.sortedCrossChunkImports(chunkRepr.importsFromOtherChunks)) {
        if (c.options.outputFormat !== FormatESModule) throw new GoPanic("Internal error");
        const items = [];
        for (const item of crossChunkImport_.sortedImportItems) {
          items.push(new ClauseItem(item.exportAlias, "", 0, new LocRef(0, item.ref)));
        }
        const importRecordIndex = chunk.crossChunkImports.length;
        chunk.crossChunkImports.push(new chunkImport(crossChunkImport_.chunkIndex, ImportStmt));
        if (items.length > 0) {
          // "import {a, b} from './chunk.js'"
          const s = new SImport();
          s.items = items;
          s.importRecordIndex = importRecordIndex;
          crossChunkPrefixStmts.push(new Stmt(s, 0));
        } else {
          // "import './chunk.js'"
          const s = new SImport();
          s.importRecordIndex = importRecordIndex;
          crossChunkPrefixStmts.push(new Stmt(s, 0));
        }
      }

      chunkRepr.crossChunkPrefixStmts = crossChunkPrefixStmts;
    }
  },

  // Sort cross-chunk imports by chunk name for determinism
  sortedCrossChunkImports(importsFromOtherChunks) {
    const c = this;
    const result = [];

    for (const [otherChunkIndex, importItems] of importsFromOtherChunks) {
      // Sort imports from a single chunk by alias for determinism
      const otherChunk = c.chunks[otherChunkIndex];
      const exportsToOtherChunks = otherChunk.chunkRepr.exportsToOtherChunks;
      for (const item of importItems) {
        item.exportAlias = exportsToOtherChunks.get(item.ref);
      }
      // (the aliases are unique within a chunk: an unstable sort is fine)
      importItems.sort((a, b) => compareStringsUTF8(a.exportAlias, b.exportAlias));
      result.push(new crossChunkImport(importItems, otherChunkIndex));
    }

    result.sort((a, b) => a.chunkIndex - b.chunkIndex);
    return result;
  },

  // Sort cross-chunk exports by chunk name for determinism
  sortedCrossChunkExportItems(exportRefs) {
    const c = this;
    const result = [];
    for (const ref of exportRefs) {
      result.push({ stableSourceIndex: c.graph.stableSourceIndices[refSource(ref)], ref });
    }
    result.sort((a, b) => (a.stableSourceIndex !== b.stableSourceIndex ? a.stableSourceIndex - b.stableSourceIndex : refInner(a.ref) - refInner(b.ref)));
    return result;
  },
});

// ---------------------------------------------------------------------------
// scanImportsAndExports

Object.assign(linkerContext.prototype, {
  scanImportsAndExports() {
    const c = this;
    if (c.timer === null) {
      return c.scanImportsAndExportsImpl();
    }
    c.timer?.begin("Scan imports and exports");
    try {
      return c.scanImportsAndExportsImpl();
    } finally {
      c.timer?.end("Scan imports and exports");
    }
  },

  scanImportsAndExportsImpl() {
    const c = this;
    const graph = c.graph;
    const files = graph.files;
    const reachableFiles = graph.reachableFiles;

    // Step 1: Figure out what modules must be CommonJS
    c.timer?.begin("Step 1");
    for (const sourceIndex of reachableFiles) {
      const file = files[sourceIndex];
      let additionalFiles = file.inputFile.additionalFiles;
      const repr = file.inputFile.repr;

      if (repr instanceof CSSRepr) {
        // Inline URLs for non-CSS files into the CSS file
        const cssRecords = repr.ast.importRecords;
        for (let importRecordIndex = 0; importRecordIndex < cssRecords.length; importRecordIndex++) {
          const record = cssRecords[importRecordIndex];
          if (record.sourceIndex >= 0) {
            const otherFile = files[record.sourceIndex];
            const otherRepr = otherFile.inputFile.repr;
            if (otherRepr instanceof JSRepr) {
              record.path = new Path(otherRepr.ast.urlForCSS, "", record.path.ignoredSuffix, record.path.importAttributes, record.path.flags);
              record.sourceIndex = -1;
              if (otherFile.inputFile.loader === LoaderEmpty) {
                record.flags |= WasLoadedWithEmptyLoader;
              } else {
                record.flags |= ShouldNotBeExternalInMetafile;
              }
              if (otherRepr.ast.urlForCSS.includes(c.uniqueKeyPrefix)) {
                record.flags |= ContainsUniqueKey;
              }

              // Copy the additional files to the output directory
              additionalFiles = additionalFiles.concat(otherFile.inputFile.additionalFiles);
            }
          } else if (record.copySourceIndex >= 0) {
            const otherFile = files[record.copySourceIndex];
            const otherRepr = otherFile.inputFile.repr;
            if (otherRepr instanceof CopyRepr) {
              record.path = new Path(otherRepr.urlForCode, "", record.path.ignoredSuffix, record.path.importAttributes, record.path.flags);
              record.copySourceIndex = -1;
              record.flags |= ShouldNotBeExternalInMetafile | ContainsUniqueKey;

              // Copy the additional files to the output directory
              additionalFiles = additionalFiles.concat(otherFile.inputFile.additionalFiles);
            }
          }
        }

        // Validate cross-file "composes: ... from" named imports
        for (const composes of repr.ast.composes.values()) {
          for (const name of composes.importedNames) {
            const record = repr.ast.importRecords[name.importRecordIndex];
            if (record.sourceIndex >= 0) {
              const otherFile = files[record.sourceIndex];
              const otherRepr = otherFile.inputFile.repr;
              if (otherRepr instanceof CSSRepr) {
                if (!otherRepr.ast.localScope.has(name.alias)) {
                  const global = otherRepr.ast.globalScope.get(name.alias);
                  if (global !== undefined) {
                    let hint;
                    if (otherFile.inputFile.loader === LoaderCSS) {
                      hint = 'Use the "local-css" loader for ' + goQuote(otherFile.inputFile.source.prettyPaths.select(c.options.logPathStyle)) + " to enable local names.";
                    } else {
                      hint = 'Use the ":local" selector to change ' + goQuote(name.alias) + " into a local name.";
                    }
                    c.log.addErrorWithNotes(
                      file.lineColumnTracker(),
                      cssRangeOfIdentifier(file.inputFile.source, name.aliasLoc),
                      "Cannot use global name " + goQuote(name.alias) + ' with "composes"',
                      [
                        otherFile.lineColumnTracker().msgData(cssRangeOfIdentifier(otherFile.inputFile.source, global.loc), "The global name " + goQuote(name.alias) + " is defined here:"),
                        new MsgData(null, null, hint),
                      ],
                    );
                  } else {
                    c.log.addError(
                      file.lineColumnTracker(),
                      cssRangeOfIdentifier(file.inputFile.source, name.aliasLoc),
                      "The name " + goQuote(name.alias) + " never appears in " + goQuote(otherFile.inputFile.source.prettyPaths.select(c.options.logPathStyle)),
                    );
                  }
                }
              }
            }
          }
        }

        c.validateComposesFromProperties(file, repr);
      } else if (repr instanceof JSRepr) {
        const records = repr.ast.importRecords;
        for (let importRecordIndex = 0; importRecordIndex < records.length; importRecordIndex++) {
          const record = records[importRecordIndex];
          if (!(record.sourceIndex >= 0)) {
            if (record.copySourceIndex >= 0) {
              const otherFile = files[record.copySourceIndex];
              const otherRepr = otherFile.inputFile.repr;
              if (otherRepr instanceof CopyRepr) {
                // (the record may be shared with other links: replace it)
                const clone = record.clone();
                clone.path = new Path(otherRepr.urlForCode, "", record.path.ignoredSuffix, record.path.importAttributes, record.path.flags);
                clone.copySourceIndex = -1;
                clone.flags |= ShouldNotBeExternalInMetafile | ContainsUniqueKey;
                records[importRecordIndex] = clone;

                // Copy the additional files to the output directory
                additionalFiles = additionalFiles.concat(otherFile.inputFile.additionalFiles);
              }
            }
            continue;
          }

          const otherFile = files[record.sourceIndex];
          const otherRepr = otherFile.inputFile.repr;
          if (!(otherRepr instanceof JSRepr)) throw new GoPanic("interface conversion: graph.InputFileRepr is " + goTypeName("graph", otherRepr) + ", not *graph.JSRepr");

          switch (record.kind) {
            case ImportStmt:
              // Importing using ES6 syntax from a file without any ES6 syntax
              // causes that module to be considered CommonJS-style, even if it
              // doesn't have any CommonJS exports.
              //
              // That means the ES6 imports will become undefined instead of
              // causing errors. This is for compatibility with older CommonJS-
              // style bundlers.
              //
              // We emit a warning in this case but try to avoid turning the module
              // into a CommonJS module if possible. This is possible with named
              // imports (the module stays an ECMAScript module but the imports are
              // rewritten with undefined) but is not possible with star or default
              // imports:
              //
              //   import * as ns from './empty-file'
              //   import defVal from './empty-file'
              //   console.log(ns, defVal)
              //
              // In that case the module *is* considered a CommonJS module because
              // the namespace object must be created.
              if (
                ((record.flags & ContainsImportStar) !== 0 || (record.flags & ContainsDefaultAlias) !== 0) &&
                otherRepr.ast.exportsKind === ExportsNone &&
                !otherRepr.ast.hasLazyExport
              ) {
                otherRepr.meta.wrap = WrapCJS;
                otherRepr.ast.exportsKind = ExportsCommonJS;
              }
              break;

            case ImportRequire:
              // Files that are imported with require() must be wrapped so that
              // they can be lazily-evaluated
              if (otherRepr.ast.exportsKind === ExportsESM) {
                otherRepr.meta.wrap = WrapESM;
              } else {
                otherRepr.meta.wrap = WrapCJS;
                otherRepr.ast.exportsKind = ExportsCommonJS;
              }
              break;

            case ImportDynamic:
              if (!c.options.codeSplitting) {
                // If we're not splitting, then import() is just a require() that
                // returns a promise, so the imported file must also be wrapped
                if (otherRepr.ast.exportsKind === ExportsESM) {
                  otherRepr.meta.wrap = WrapESM;
                } else {
                  otherRepr.meta.wrap = WrapCJS;
                  otherRepr.ast.exportsKind = ExportsCommonJS;
                }
              }
              break;
          }
        }

        // If the output format doesn't have an implicit CommonJS wrapper, any file
        // that uses CommonJS features will need to be wrapped, even though the
        // resulting wrapper won't be invoked by other files. An exception is made
        // for entry point files in CommonJS format (or when in pass-through mode).
        if (
          repr.ast.exportsKind === ExportsCommonJS &&
          (!file.isEntryPoint() || c.options.outputFormat === FormatIIFE || c.options.outputFormat === FormatESModule)
        ) {
          repr.meta.wrap = WrapCJS;
        }
      }

      file.inputFile.additionalFiles = additionalFiles;
    }

    c.timer?.end("Step 1");

    // Step 2: Propagate dynamic export status for export star statements that
    // are re-exports from a module whose exports are not statically analyzable.
    // In this case the export star must be evaluated at run time instead of at
    // bundle time.
    c.timer?.begin("Step 2");
    for (const sourceIndex of reachableFiles) {
      const repr = files[sourceIndex].inputFile.repr;
      if (!(repr instanceof JSRepr)) continue;

      if (repr.meta.wrap !== WrapNone) {
        c.recursivelyWrapDependencies(sourceIndex);
      }

      if (repr.ast.exportStarImportRecords.length > 0) {
        const visited = new Set();
        c.hasDynamicExportsDueToExportStar(sourceIndex, visited);
      }

      // Even if the output file is CommonJS-like, we may still need to wrap
      // CommonJS-style files. Any file that imports a CommonJS-style file will
      // cause that file to need to be wrapped. This is because the import
      // method, whatever it is, will need to invoke the wrapper. Note that
      // this can include entry points (e.g. an entry point that imports a file
      // that imports that entry point).
      for (let $i75 = 0, $a75 = repr.ast.importRecords; $i75 < $a75.length; $i75++) {
        const record = $a75[$i75];
        if (record.sourceIndex >= 0) {
          const otherRepr = files[record.sourceIndex].inputFile.repr;
          if (otherRepr.ast.exportsKind === ExportsCommonJS) {
            c.recursivelyWrapDependencies(record.sourceIndex);
          }
        }
      }
    }

    c.timer?.end("Step 2");

    // Step 3: Resolve "export * from" statements. This must be done after we
    // discover all modules that can have dynamic exports because export stars
    // are ignored for those modules.
    c.timer?.begin("Step 3");
    const exportStarStack = [];
    for (const sourceIndex of reachableFiles) {
      const repr = files[sourceIndex].inputFile.repr;
      if (!(repr instanceof JSRepr)) continue;

      // Expression-style loaders defer code generation until linking. Code
      // generation is done here because at this point we know that the
      // "ExportsKind" field has its final value and will not be changed.
      if (repr.ast.hasLazyExport) {
        c.generateCodeForLazyExport(sourceIndex);
      }

      // Propagate exports for export star statements
      if (repr.ast.exportStarImportRecords.length > 0) {
        c.addExportsForExportStar(repr.meta.resolvedExports, sourceIndex, exportStarStack);
      }

      // Also add a special export so import stars can bind to it. This must be
      // done in this step because it must come after CommonJS module discovery
      // but before matching imports with exports.
      repr.meta.resolvedExportStar = new ExportData(EMPTY_ARRAY, repr.ast.exportsRef, 0, sourceIndex);
    }

    c.timer?.end("Step 3");

    // Step 4: Match imports with exports. This must be done after we process all
    // export stars because imports can bind to export star re-exports.
    c.timer?.begin("Step 4");
    for (const sourceIndex of reachableFiles) {
      const file = files[sourceIndex];
      const repr = file.inputFile.repr;
      if (!(repr instanceof JSRepr)) continue;

      if (repr.ast.namedImports.size > 0) {
        c.matchImportsWithExportsForFile(sourceIndex);
      }

      // If we're exporting as CommonJS and this file was originally CommonJS,
      // then we'll be using the actual CommonJS "exports" and/or "module"
      // symbols. In that case make sure to mark them as such so they don't
      // get minified.
      if (
        file.isEntryPoint() &&
        repr.ast.exportsKind === ExportsCommonJS &&
        repr.meta.wrap === WrapNone &&
        (c.options.outputFormat === FormatPreserve || c.options.outputFormat === FormatCommonJS)
      ) {
        const exportsRef = followSymbols(graph.symbols, repr.ast.exportsRef);
        const moduleRef = followSymbols(graph.symbols, repr.ast.moduleRef);
        writableSymbol(graph.symbols, exportsRef).kind = SymbolUnbound;
        writableSymbol(graph.symbols, moduleRef).kind = SymbolUnbound;
      } else if (repr.meta.forceIncludeExportsForEntryPoint || repr.ast.exportsKind !== ExportsCommonJS) {
        repr.meta.needsExportsVariable = true;
      }

      // Create the wrapper part for wrapped files. This is needed by a later step.
      c.createWrapperForFile(sourceIndex);
    }

    c.timer?.end("Step 4");

    // Step 5: Create namespace exports for every file. This is always necessary
    // for CommonJS files, and is also necessary for other files if they are
    // imported using an import star statement.
    c.timer?.begin("Step 5");
    for (const sourceIndex of reachableFiles) {
      const repr = files[sourceIndex].inputFile.repr;
      if (!(repr instanceof JSRepr)) continue;

      // JS-only: for the cached runtime AST the result of this step is the same
      // in every transform (see sharedStep5Memo)
      let memo = null;
      const memoizable = files[sourceIndex].inputFile.astIsShared && sharedStep5IsMemoizable(repr);
      if (memoizable) {
        memo = sharedStep5Memos.get(repr.ast.namedExports);
        if (memo !== undefined && !globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__ && restoreSharedStep5(c, sourceIndex, repr, memo)) {
          continue;
        }
      }

      // Now that all exports have been resolved, sort and filter them to create
      // something we can iterate over later. (The port sorts first and then
      // filters in sorted order, which gives the same result because the
      // filter looks at each alias on its own; the sorted aliases of the
      // cached runtime AST are reused.)
      const aliases = [];
      nextAlias: for (const alias of sortedResolvedExportAliases(repr)) {
        const export_ = repr.meta.resolvedExports.get(alias);
        const otherFile = files[export_.sourceIndex].inputFile;
        const otherRepr = otherFile.repr;

        // Re-exporting multiple symbols with the same name causes an ambiguous
        // export. These names cannot be used and should not end up in generated code.
        if (export_.potentiallyAmbiguousExportStarRefs.length > 0) {
          let mainRef = export_.ref;
          let mainLoc = export_.nameLoc;
          const imported = otherRepr.meta.importsToBind.get(export_.ref);
          if (imported !== undefined) {
            mainRef = imported.ref;
            mainLoc = imported.nameLoc;
          }

          for (const ambiguousExport of export_.potentiallyAmbiguousExportStarRefs) {
            const ambiguousFile = files[ambiguousExport.sourceIndex].inputFile;
            const ambiguousRepr = ambiguousFile.repr;
            let ambiguousRef = ambiguousExport.ref;
            let ambiguousLoc = ambiguousExport.nameLoc;
            const imported2 = ambiguousRepr.meta.importsToBind.get(ambiguousExport.ref);
            if (imported2 !== undefined) {
              ambiguousRef = imported2.ref;
              ambiguousLoc = imported2.nameLoc;
            }

            if (mainRef !== ambiguousRef) {
              const file = files[sourceIndex].inputFile;
              const otherTracker = new LineColumnTracker(otherFile.source);
              const ambiguousTracker = new LineColumnTracker(ambiguousFile.source);
              c.log.addIDWithNotes(
                MsgID_Bundler_AmbiguousReexport,
                MsgDebug,
                null,
                RANGE_ZERO,
                "Re-export of " + goQuote(alias) + " in " + goQuote(file.source.prettyPaths.select(c.options.logPathStyle)) + " is ambiguous and has been removed",
                [
                  otherTracker.msgData(
                    rangeOfIdentifier(otherFile.source, mainLoc),
                    "One definition of " + goQuote(alias) + " comes from " + goQuote(otherFile.source.prettyPaths.select(c.options.logPathStyle)) + " here:",
                  ),
                  ambiguousTracker.msgData(
                    rangeOfIdentifier(ambiguousFile.source, ambiguousLoc),
                    "Another definition of " + goQuote(alias) + " comes from " + goQuote(ambiguousFile.source.prettyPaths.select(c.options.logPathStyle)) + " here:",
                  ),
                ],
              );
              continue nextAlias;
            }
          }
        }

        // Ignore re-exported imports in TypeScript files that failed to be
        // resolved. These are probably just type-only imports so the best thing to
        // do is to silently omit them from the export list.
        if (otherRepr.meta.isProbablyTypeScriptType.get(export_.ref) === true) {
          continue;
        }

        if (
          c.options.outputFormat === FormatESModule &&
          jsFeatureHas(c.options.unsupportedJSFeatures, ArbitraryModuleNamespaceNames) &&
          c.graph.files[sourceIndex].isEntryPoint()
        ) {
          c.maybeForbidArbitraryModuleNamespaceIdentifier("export", export_.sourceIndex, export_.nameLoc, alias);
        }

        aliases.push(alias);
      }
      repr.meta.sortedAndFilteredExportAliases = aliases;

      // Export creation uses "sortedAndFilteredExportAliases" so this must
      // come second after we fill in that array
      c.createExportsForFile(sourceIndex);

      c.computeDependenciesForFileParts(sourceIndex, repr);

      if (memoizable) {
        const snapshot = snapshotSharedStep5(c, sourceIndex, repr);
        if (memo === undefined) {
          sharedStep5Memos.set(repr.ast.namedExports, snapshot);
        } else if (!sharedStep5SnapshotsEqual(memo, snapshot)) {
          // (Test hook: the memo must match a fresh computation)
          throw new globalThis.Error("@r1ck404/fast-esbuild-wasm: step 5 memo mismatch");
        }
      }
    }

    c.timer?.end("Step 5");

    // Step 6: Bind imports to exports. This adds non-local dependencies on the
    // parts that declare the export to all parts that use the import. Also
    // generate wrapper parts for wrapped files.
    c.timer?.begin("Step 6");
    for (const sourceIndex of reachableFiles) {
      const file = files[sourceIndex];
      const repr = file.inputFile.repr;
      if (!(repr instanceof JSRepr)) continue;

      // Pre-generate symbols for re-exports CommonJS symbols in case they
      // are necessary later. This is done now because the symbols map cannot be
      // mutated later due to parallelism.
      if (file.isEntryPoint() && c.options.outputFormat === FormatESModule) {
        const aliases = repr.meta.sortedAndFilteredExportAliases;
        const copies = new Array(aliases.length);
        for (let i = 0; i < aliases.length; i++) {
          copies[i] = graph.generateNewSymbol(sourceIndex, SymbolOther, "export_" + aliases[i]);
        }
        repr.meta.cjsExportCopies = copies;
      }

      // Use "init_*" for ESM wrappers instead of "require_*"
      if (repr.meta.wrap === WrapESM) {
        writableSymbol(graph.symbols, repr.ast.wrapperRef).originalName = "init_" + file.inputFile.source.identifierName;
      }

      // If this isn't CommonJS, then rename the unused "exports" and "module"
      // variables to avoid them causing the identically-named variables in
      // actual CommonJS files from being renamed. This is purely about
      // aesthetics and is not about correctness. This is done here because by
      // this point, we know the CommonJS status will not change further.
      if (repr.meta.wrap !== WrapCJS && repr.ast.exportsKind !== ExportsCommonJS) {
        const name = file.inputFile.source.identifierName;
        writableSymbol(graph.symbols, repr.ast.exportsRef).originalName = name + "_exports";
        writableSymbol(graph.symbols, repr.ast.moduleRef).originalName = name + "_module";
      }

      // Include the "__export" symbol from the runtime if it was used in the
      // previous step. The previous step can't do this because it's running in
      // parallel and can't safely mutate the "importsToBind" map of another file.
      if (repr.meta.needsExportSymbolFromRuntime) {
        const runtimeRepr = files[RUNTIME_SOURCE_INDEX].inputFile.repr;
        const exportRef = runtimeRepr.ast.moduleScope.members.get("__export").ref;
        graph.generateSymbolImportAndUse(sourceIndex, NSExportPartIndex, exportRef, 1, RUNTIME_SOURCE_INDEX);
      }

      for (const [importRef, importData] of repr.meta.importsToBind) {
        const resolvedRepr = files[importData.sourceIndex].inputFile.repr;
        const partsDeclaringSymbol = resolvedRepr.topLevelSymbolToParts(importData.ref);

        const namedImport = repr.ast.namedImports.get(importRef);
        if (namedImport !== undefined) {
          for (let $i76 = 0, $a76 = namedImport.localPartsWithUses; $i76 < $a76.length; $i76++) {
            const partIndex = $a76[$i76];
            const part = repr.ast.parts[partIndex];

            // Depend on the file containing the imported symbol
            for (const resolvedPartIndex of partsDeclaringSymbol) {
              part.dependencies.push(new Dependency(importData.sourceIndex, resolvedPartIndex));
            }

            // Also depend on any files that re-exported this symbol in between the
            // file containing the import and the file containing the imported symbol
            for (const dep of importData.reExports) part.dependencies.push(dep);
          }
        }

        // Merge these symbols so they will share the same name (merging a
        // symbol with itself is a no-op, e.g. for runtime helpers pulled in by
        // GenerateSymbolImportAndUse, so those don't need to become writable)
        if (importRef !== importData.ref) {
          writableSymbolChain(graph.symbols, importRef);
          writableSymbolChain(graph.symbols, importData.ref);
        }
        mergeSymbols(graph.symbols, importRef, importData.ref);
      }

      // If this is an entry point, depend on all exports so they are included
      if (file.isEntryPoint()) {
        const dependencies = [];

        for (const alias of repr.meta.sortedAndFilteredExportAliases) {
          const export_ = repr.meta.resolvedExports.get(alias);
          let targetSourceIndex = export_.sourceIndex;
          let targetRef = export_.ref;

          // If this is an import, then target what the import points to
          let targetRepr = files[targetSourceIndex].inputFile.repr;
          const importData = targetRepr.meta.importsToBind.get(targetRef);
          if (importData !== undefined) {
            targetSourceIndex = importData.sourceIndex;
            targetRef = importData.ref;
            targetRepr = files[targetSourceIndex].inputFile.repr;
            for (const dep of importData.reExports) dependencies.push(dep);
          }

          // Pull in all declarations of this symbol
          for (const partIndex of targetRepr.topLevelSymbolToParts(targetRef)) {
            dependencies.push(new Dependency(targetSourceIndex, partIndex));
          }
        }

        // Ensure "exports" is included if the current output format needs it
        if (repr.meta.forceIncludeExportsForEntryPoint) {
          dependencies.push(new Dependency(sourceIndex, NSExportPartIndex));
        }

        // Include the wrapper if present
        if (repr.meta.wrap !== WrapNone) {
          dependencies.push(new Dependency(sourceIndex, repr.meta.wrapperPartIndex));
        }

        // Represent these constraints with a dummy part
        const entryPart = new Part();
        entryPart.dependencies = dependencies;
        entryPart.canBeRemovedIfUnused = false;
        const entryPointPartIndex = graph.addPartToFile(sourceIndex, entryPart);
        repr.meta.entryPointPartIndex = entryPointPartIndex;

        // Pull in the "__toCommonJS" symbol if we need it due to being an entry point
        if (repr.meta.forceIncludeExportsForEntryPoint) {
          graph.generateRuntimeSymbolImportAndUse(sourceIndex, entryPointPartIndex, "__toCommonJS", 1);
        }
      }

      // Encode import-specific constraints in the dependency graph
      const parts = repr.ast.parts;
      for (let partIndex = 0, partCount = parts.length; partIndex < partCount; partIndex++) {
        const part = parts[partIndex];
        let toESMUses = 0;
        let toCommonJSUses = 0;
        let runtimeRequireUses = 0;

        // Imports of wrapped files must depend on the wrapper
        for (let $i77 = 0, $a77 = part.importRecordIndices; $i77 < $a77.length; $i77++) {
          const importRecordIndex = $a77[$i77];
          const record = repr.ast.importRecords[importRecordIndex];

          // Don't follow external imports (this includes import() expressions)
          if (!(record.sourceIndex >= 0) || c.isExternalDynamicImport(record, sourceIndex)) {
            // This is an external import. Check if it will be a "require()" call.
            if (
              record.kind === ImportRequire ||
              !formatKeepESMImportExportSyntax(c.options.outputFormat) ||
              (record.kind === ImportDynamic && jsFeatureHas(c.options.unsupportedJSFeatures, DynamicImport))
            ) {
              // We should use "__require" instead of "require" if we're not
              // generating a CommonJS output file, since it won't exist otherwise
              if (shouldCallRuntimeRequire(c.options.mode, c.options.outputFormat)) {
                record.flags |= CallRuntimeRequire;
                runtimeRequireUses++;
              }

              // If this wasn't originally a "require()" call, then we may need
              // to wrap this in a call to the "__toESM" wrapper to convert from
              // CommonJS semantics to ESM semantics.
              //
              // Unfortunately this adds some additional code since the conversion
              // is somewhat complex. As an optimization, we can avoid this if the
              // following things are true:
              //
              // - The import is an ES module statement (e.g. not an "import()" expression)
              // - The ES module namespace object must not be captured
              // - The "default" and "__esModule" exports must not be accessed
              //
              if (
                record.kind !== ImportRequire &&
                (record.kind !== ImportStmt ||
                  (record.flags & ContainsImportStar) !== 0 ||
                  (record.flags & ContainsDefaultAlias) !== 0 ||
                  (record.flags & ContainsESModuleAlias) !== 0)
              ) {
                record.flags |= WrapWithToESM;
                toESMUses++;
              }
            }
            continue;
          }

          const otherSourceIndex = record.sourceIndex;
          const otherRepr = files[otherSourceIndex].inputFile.repr;

          if (otherRepr.meta.wrap !== WrapNone) {
            // Depend on the automatically-generated require wrapper symbol
            const wrapperRef = otherRepr.ast.wrapperRef;
            graph.generateSymbolImportAndUse(sourceIndex, partIndex, wrapperRef, 1, otherSourceIndex);

            // This is an ES6 import of a CommonJS module, so it needs the
            // "__toESM" wrapper as long as it's not a bare "require()"
            if (record.kind !== ImportRequire && otherRepr.ast.exportsKind === ExportsCommonJS) {
              record.flags |= WrapWithToESM;
              toESMUses++;
            }

            // If this is an ESM wrapper, also depend on the exports object
            // since the final code will contain an inline reference to it.
            // This must be done for "require()" and "import()" expressions
            // but does not need to be done for "import" statements since
            // those just cause us to reference the exports directly.
            if (otherRepr.meta.wrap === WrapESM && record.kind !== ImportStmt) {
              graph.generateSymbolImportAndUse(sourceIndex, partIndex, otherRepr.ast.exportsRef, 1, otherSourceIndex);

              // If this is a "require()" call, then we should add the
              // "__esModule" marker to behave as if the module was converted
              // from ESM to CommonJS. This is done via a wrapper instead of
              // by modifying the exports object itself because the same ES
              // module may be simultaneously imported and required, and the
              // importing code should not see "__esModule" while the requiring
              // code should see "__esModule". This is an extremely complex
              // and subtle set of bundler interop issues. See for example
              // https://github.com/evanw/esbuild/issues/1591.
              if (record.kind === ImportRequire) {
                record.flags |= WrapWithToCJS;
                toCommonJSUses++;
              }
            }
          } else if (record.kind === ImportStmt && otherRepr.ast.exportsKind === ExportsESMWithDynamicFallback) {
            // This is an import of a module that has a dynamic export fallback
            // object. In that case we need to depend on that object in case
            // something ends up needing to use it later. This could potentially
            // be omitted in some cases with more advanced analysis if this
            // dynamic export fallback object doesn't end up being needed.
            graph.generateSymbolImportAndUse(sourceIndex, partIndex, otherRepr.ast.exportsRef, 1, otherSourceIndex);
          }
        }

        // If there's an ES6 import of a non-ES6 module, then we're going to need the
        // "__toESM" symbol from the runtime to wrap the result of "require()"
        graph.generateRuntimeSymbolImportAndUse(sourceIndex, partIndex, "__toESM", toESMUses);

        // If there's a CommonJS require of an ES6 module, then we're going to need the
        // "__toCommonJS" symbol from the runtime to wrap the exports object
        graph.generateRuntimeSymbolImportAndUse(sourceIndex, partIndex, "__toCommonJS", toCommonJSUses);

        // If there are unbundled calls to "require()" and we're not generating
        // code for node, then substitute a "__require" wrapper for "require".
        graph.generateRuntimeSymbolImportAndUse(sourceIndex, partIndex, "__require", runtimeRequireUses);

        // If there's an ES6 export star statement of a non-ES6 module, then we're
        // going to need the "__reExport" symbol from the runtime
        let reExportUses = 0;
        for (let $i78 = 0, $a78 = repr.ast.exportStarImportRecords; $i78 < $a78.length; $i78++) {
          const importRecordIndex = $a78[$i78];
          const record = repr.ast.importRecords[importRecordIndex];

          // Is this export star evaluated at run time?
          let happensAtRunTime =
            !(record.sourceIndex >= 0) && (!file.isEntryPoint() || !formatKeepESMImportExportSyntax(c.options.outputFormat));
          if (record.sourceIndex >= 0) {
            const otherSourceIndex = record.sourceIndex;
            const otherRepr = files[otherSourceIndex].inputFile.repr;
            if (otherSourceIndex !== sourceIndex && exportsKindIsDynamic(otherRepr.ast.exportsKind)) {
              happensAtRunTime = true;
            }
            if (otherRepr.ast.exportsKind === ExportsESMWithDynamicFallback) {
              // This looks like "__reExport(exports_a, exports_b)". Make sure to
              // pull in the "exports_b" symbol into this export star. This matters
              // in code splitting situations where the "export_b" symbol might live
              // in a different chunk than this export star.
              graph.generateSymbolImportAndUse(sourceIndex, partIndex, otherRepr.ast.exportsRef, 1, otherSourceIndex);
            }
          }
          if (happensAtRunTime) {
            // Depend on this file's "exports" object for the first argument to "__reExport"
            graph.generateSymbolImportAndUse(sourceIndex, partIndex, repr.ast.exportsRef, 1, sourceIndex);
            record.flags |= CallsRunTimeReExportFn;
            repr.ast.usesExportsRef = true;
            reExportUses++;
          }
        }
        graph.generateRuntimeSymbolImportAndUse(sourceIndex, partIndex, "__reExport", reExportUses);
      }
    }
    c.timer?.end("Step 6");
  },

  // The second half of step 5 of scanImportsAndExports for one file (a
  // separate method only so that V8 optimizes it better)
  computeDependenciesForFileParts(sourceIndex, repr) {
    const c = this;
    const graph = c.graph;
    // Each part tracks the other parts it depends on within this file (Go:
    // map[uint32]uint32; -1 stands for a missing entry)
    const parts = repr.ast.parts;
    const localDependencies = new Int32Array(parts.length).fill(-1);
    const namedImports = repr.ast.namedImports;
    const hasNamedImports = namedImports.size > 0;
    const importsToBind = repr.meta.importsToBind;
    const checkConstValues = graph.constValues.size > 0 && importsToBind.size > 0;
    const overlay = repr.meta.topLevelSymbolToPartsOverlay;
    const fromParser = repr.ast.topLevelSymbolToPartsFromParser;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex];

      // Now that all files have been parsed, determine which property
      // accesses off of imported symbols are inlined enum values and
      // which ones aren't
      if (part.importSymbolPropertyUses.size > 0) {
        for (const [ref, properties] of part.importSymbolPropertyUses) {
          const oldUse = part.symbolUses.get(ref);
          let countEstimate = oldUse === undefined ? 0 : oldUse.countEstimate;

          // Rare path: this import is a TypeScript enum
          const importData = repr.meta.importsToBind.get(ref);
          if (importData !== undefined) {
            const symbol = graph.symbols.get(importData.ref);
            if (symbol.kind === SymbolTSEnum) {
              const enum_ = graph.tsEnums.get(importData.ref);
              if (enum_ !== undefined) {
                let foundNonInlinedEnum = false;
                for (const [name, propertyUse] of properties) {
                  if (!enum_.has(name)) {
                    foundNonInlinedEnum = true;
                    countEstimate += propertyUse.countEstimate;
                  }
                }
                if (foundNonInlinedEnum) {
                  writableSymbolUses(part).set(ref, new SymbolUse(countEstimate));
                }
              }
              continue;
            }
          }

          // Common path: this import isn't a TypeScript enum
          for (const propertyUse of properties.values()) {
            countEstimate += propertyUse.countEstimate;
          }
          writableSymbolUses(part).set(ref, new SymbolUse(countEstimate));
        }
      }

      // Also determine which function calls will be inlined (and so should
      // not count as uses), and which ones will not be (and so should count
      // as uses)
      if (part.symbolCallUses.size > 0) for (const [ref, callUse] of part.symbolCallUses) {
        const oldUse = part.symbolUses.get(ref);
        const countEstimate = oldUse === undefined ? 0 : oldUse.countEstimate;

        // Find the symbol that was called
        let symbol = graph.symbols.get(ref);
        if (symbol.kind === SymbolImport) {
          const importData = repr.meta.importsToBind.get(ref);
          if (importData !== undefined) {
            symbol = graph.symbols.get(importData.ref);
          }
        }
        const flags = symbol.flags;
        let callCountEstimate = callUse.callCountEstimate;

        // Rare path: this is a function that will be inlined
        if ((flags & (IsEmptyFunction | CouldPotentiallyBeMutated)) === IsEmptyFunction) {
          // Every call will be inlined
          continue;
        } else if ((flags & (IsIdentityFunction | CouldPotentiallyBeMutated)) === IsIdentityFunction) {
          // Every single-argument call will be inlined as long as it's not a spread
          callCountEstimate -= callUse.singleArgNonSpreadCallCountEstimate;
          if (callCountEstimate === 0) {
            continue;
          }
        }

        // Common path: this isn't a function that will be inlined
        writableSymbolUses(part).set(ref, new SymbolUse(countEstimate + callCountEstimate));
      }

      // Now that we know this, we can determine cross-part dependencies. (An
      // entry can only be deleted below if this file imports something.)
      const symbolUses = checkConstValues ? writableSymbolUses(part) : part.symbolUses;
      const dependencies = part.dependencies;
      for (const ref of symbolUses.keys()) {
        // Rare path: this import is an inlined const value
        if (checkConstValues) {
          const importData = importsToBind.get(ref);
          if (importData !== undefined && graph.constValues.has(importData.ref)) {
            symbolUses.delete(importData.ref);
            continue;
          }
        }

        // (repr.topLevelSymbolToParts(ref), inlined)
        let otherParts = overlay === null ? undefined : overlay.get(ref);
        if (otherParts === undefined && fromParser !== null) otherParts = fromParser.get(ref);
        if (otherParts !== undefined) {
          for (let i = 0; i < otherParts.length; i++) {
            const otherPartIndex = otherParts[i];
            if (localDependencies[otherPartIndex] !== partIndex) {
              localDependencies[otherPartIndex] = partIndex;
              dependencies.push(new Dependency(sourceIndex, otherPartIndex));
            }
          }
        }

        // Also map from imports to parts that use them
        if (hasNamedImports) {
          const namedImport = namedImports.get(ref);
          if (namedImport !== undefined) {
            namedImport.localPartsWithUses.push(partIndex);
          }
        }
      }
    }
  },

  // (In the fast path only the JSON values of "--define" are lazy exports)
  generateCodeForLazyExport(sourceIndex) {
    const c = this;
    const file = c.graph.files[sourceIndex];
    const repr = file.inputFile.repr;

    // Grab the lazy expression
    if (repr.ast.parts.length < 1) throw new GoPanic("Internal error");
    const part = repr.ast.parts[repr.ast.parts.length - 1];
    if (part.stmts.length !== 1) throw new GoPanic("Internal error");
    let lazyValue = part.stmts[0].data.value;

    // If this JavaScript file is a stub from a CSS file, populate the exports of
    // this JavaScript stub with the local names from that CSS file. This is done
    // now instead of earlier because we need the whole bundle to be present.
    if (repr.cssSourceIndex >= 0) {
      const cssSourceIndex = repr.cssSourceIndex;
      const css = c.graph.files[cssSourceIndex].inputFile.repr;
      if (css instanceof CSSRepr) {
        const exports = new EObject();

        for (const local of css.ast.localSymbols) {
          let value = new Expr(new ENameOfSymbol(local.ref), local.loc);
          const visited = new Set<number>([local.ref]);
          const parts: TemplatePart[] = [];
          let visitComposes: (repr: any, ref: number) => void;

          const visitName = (repr: any, ref: number) => {
            if (!visited.has(ref)) {
              visited.add(ref);
              visitComposes(repr, ref);
              parts.push(new TemplatePart(new Expr(new ENameOfSymbol(ref), 0), "", " "));
            }
          };

          visitComposes = (repr: any, ref: number) => {
            const composes = repr.ast.composes.get(ref);
            if (composes !== undefined) {
              for (const name of composes.importedNames) {
                const record = repr.ast.importRecords[name.importRecordIndex];
                if (record.sourceIndex >= 0) {
                  const otherFile = c.graph.files[record.sourceIndex];
                  const otherRepr = otherFile.inputFile.repr;
                  if (otherRepr instanceof CSSRepr) {
                    const otherName = otherRepr.ast.localScope.get(name.alias);
                    if (otherName !== undefined) {
                      visitName(otherRepr, otherName.ref);
                    }
                  }
                }
              }

              for (const name of composes.names) {
                visitName(repr, name.ref);
              }
            }
          };

          visitComposes(css, local.ref);

          if (parts.length > 0) {
            parts.push(new TemplatePart(value));
            value = new Expr(new ETemplate(null, "", "", parts), value.loc);
          }

          exports.properties.push(new Property(null, new Expr(new EString(c.graph.symbols.get(local.ref).originalName), local.loc), value));
        }

        lazyValue = new Expr(exports, lazyValue.loc);
      }
    }

    // Use "module.exports = value" for CommonJS-style modules
    if (repr.ast.exportsKind === ExportsCommonJS) {
      part.stmts = [
        assignStmt(new Expr(new EDot(new Expr(new EIdentifier(repr.ast.moduleRef), lazyValue.loc), "exports", lazyValue.loc), lazyValue.loc), lazyValue),
      ];
      c.graph.generateSymbolImportAndUse(sourceIndex, 0, repr.ast.moduleRef, 1, sourceIndex);
      return;
    }

    // Otherwise, generate ES6 export statements. These are added as additional
    // parts so they can be tree shaken individually.
    part.stmts = [];

    // Generate a new symbol and link the export into the graph for tree shaking
    const generateExport = (loc, name, alias) => {
      const ref = c.graph.generateNewSymbol(sourceIndex, SymbolOther, name);
      const newPart = new Part();
      newPart.declaredSymbols = [new DeclaredSymbol(ref, true)];
      newPart.canBeRemovedIfUnused = true;
      const partIndex = c.graph.addPartToFile(sourceIndex, newPart);
      c.graph.generateSymbolImportAndUse(sourceIndex, partIndex, repr.ast.moduleRef, 1, sourceIndex);
      repr.meta.topLevelSymbolToPartsOverlay.set(ref, [partIndex]);
      repr.meta.resolvedExports.set(alias, new ExportData(EMPTY_ARRAY, ref, loc, sourceIndex));
      return [ref, partIndex];
    };

    // Unwrap JSON objects into separate top-level variables. This improves tree-
    // shaking by letting you only import part of a JSON file.
    //
    // But don't do this for files loaded via "with { type: 'json' }" as that
    // behavior is specified to not export anything except for the "default"
    // export: https://github.com/tc39/proposal-json-modules
    if (lazyValue.data.k === E_OBJECT && file.inputFile.loader !== LoaderWithTypeJSON) {
      const object = lazyValue.data;
      for (let $i = 0; $i < object.properties.length; $i++) {
        const property = object.properties[$i];
        if (
          property.key.data.k === E_STRING &&
          (!file.isEntryPoint() || isIdentifier(property.key.data.value) || !jsFeatureHas(c.options.unsupportedJSFeatures, ArbitraryModuleNamespaceNames))
        ) {
          const name = property.key.data.value; // helpers.UTF16ToString
          if (name !== "default") {
            const $d = generateExport(property.key.loc, name, name);
            const ref = $d[0], partIndex = $d[1];

            // This initializes the generated variable with a copy of the property
            // value, which is INCORRECT for values that are objects/arrays because
            // they will have separate object identity. This is fixed up later in
            // "generateCodeForFileInChunkJS" by changing the object literal to
            // reference this generated variable instead.
            //
            // Changing the object literal is deferred until that point instead of
            // doing it now because we only want to do this for top-level variables
            // that actually end up being used, and we don't know which ones will
            // end up actually being used at this point (since import binding hasn't
            // happened yet). So we need to wait until after tree shaking happens.
            repr.ast.parts[partIndex].stmts = [
              new Stmt(new SLocal([new Decl(new Binding(new BIdentifier(ref), property.key.loc), property.valueOrNil)], undefined, true), property.key.loc),
            ];
          }
        }
      }
    }

    // Generate the default export
    const $d = generateExport(lazyValue.loc, file.inputFile.source.identifierName + "_default", "default");
    const ref = $d[0], partIndex = $d[1];
    repr.ast.parts[partIndex].stmts = [
      new Stmt(new SExportDefault(new Stmt(new SExpr(lazyValue), lazyValue.loc), new LocRef(lazyValue.loc, ref)), lazyValue.loc),
    ];
  },
});

// ---------------------------------------------------------------------------
// Exports, wrappers and import matching

// matchImportKind
const matchImportIgnore = 0; // The import is either external or undefined
const matchImportNormal = 1; // "sourceIndex" and "ref" are in use
const matchImportNamespace = 2; // "namespaceRef" and "alias" are in use
const matchImportNormalAndNamespace = 3; // Both "matchImportNormal" and "matchImportNamespace"
const matchImportCycle = 4; // The import could not be evaluated due to a cycle
const matchImportProbablyTypeScriptType = 5; // The import is missing but came from a TypeScript file
const matchImportAmbiguous = 6; // The import resolved to multiple symbols via "export * from"

class matchImportResult {
  declare alias: string;
  declare kind: number;
  declare namespaceRef: number;
  declare sourceIndex: number;
  declare nameLoc: number;
  declare otherSourceIndex: number;
  declare otherNameLoc: number;
  declare ref: number;
  constructor(
    kind = matchImportIgnore,
    alias = "",
    namespaceRef = 0,
    sourceIndex = 0,
    nameLoc = 0,
    otherSourceIndex = 0,
    otherNameLoc = 0,
    ref = 0,
  ) {
    this.alias = alias;
    this.kind = kind;
    this.namespaceRef = namespaceRef; // Go zero value of ast.Ref is {0, 0}
    this.sourceIndex = sourceIndex;
    this.nameLoc = nameLoc; // Optional, goes with sourceIndex, ignore if zero
    this.otherSourceIndex = otherSourceIndex;
    this.otherNameLoc = otherNameLoc; // Optional, goes with otherSourceIndex, ignore if zero
    this.ref = ref;
  }
  equals(b) {
    return (
      this.alias === b.alias &&
      this.kind === b.kind &&
      this.namespaceRef === b.namespaceRef &&
      this.sourceIndex === b.sourceIndex &&
      this.nameLoc === b.nameLoc &&
      this.otherSourceIndex === b.otherSourceIndex &&
      this.otherNameLoc === b.otherNameLoc &&
      this.ref === b.ref
    );
  }
}

class importTracker {
  declare sourceIndex: number;
  declare nameLoc: number;
  declare importRef: number;
  constructor(sourceIndex = 0, nameLoc = 0, importRef = 0) {
    this.sourceIndex = sourceIndex;
    this.nameLoc = nameLoc; // Optional, goes with sourceIndex, ignore if zero
    this.importRef = importRef;
  }
}

// importStatus
const importNoMatch = 0; // The imported file has no matching export
const importFound = 1; // The imported file has a matching export
const importCommonJS = 2; // The imported file is CommonJS and has unknown exports
const importDynamicFallback = 3; // The import is missing but there is a dynamic fallback object
const importCommonJSWithoutExports = 4; // The import was treated as a CommonJS import but the file is known to have no exports
const importDisabled = 5; // The imported file was disabled by mapping it to false in the "browser" field of package.json
const importExternal = 6; // The imported file is external and has unknown exports
const importProbablyTypeScriptType = 7; // This is a missing re-export in a TypeScript file, so it's probably a type

Object.assign(linkerContext.prototype, {
  createExportsForFile(sourceIndex) {
    const c = this;
    const file = c.graph.files[sourceIndex];
    const repr = file.inputFile.repr;

    // JS-only: the statements of this part are only needed if the part ends up
    // being printed, and for the cached runtime file that never happens in a
    // transform (nothing can import the runtime's namespace object). So for
    // shared ASTs they are built lazily by nsExportStmtsForPart(); the
    // statements are exactly the ones Go builds here, and everything else
    // (uses, dependencies, declared symbols) is still computed here.
    const lazy = file.inputFile.astIsShared;

    // Generate a getter per export
    const aliases = repr.meta.sortedAndFilteredExportAliases;
    const exportRefs = new Array(aliases.length);
    const exportRefsAreImports = new Array(aliases.length);
    const nsExportDependencies = [];
    const nsExportSymbolUses = new Map();
    for (let i = 0; i < aliases.length; i++) {
      const export_ = repr.meta.resolvedExports.get(aliases[i]);
      let exportRef = export_.ref;
      let exportSourceIndex = export_.sourceIndex;

      // If this is an export of an import, reference the symbol that the import
      // was eventually resolved to. We need to do this because imports have
      // already been resolved by this point, so we can't generate a new import
      // and have that be resolved later.
      const importData = c.graph.files[exportSourceIndex].inputFile.repr.meta.importsToBind.get(exportRef);
      if (importData !== undefined) {
        exportRef = importData.ref;
        exportSourceIndex = importData.sourceIndex;
        for (const dep of importData.reExports) nsExportDependencies.push(dep);
      }

      // Exports of imports need EImportIdentifier in case they need to be re-
      // written to a property access later on
      exportRefs[i] = exportRef;
      exportRefsAreImports[i] = c.graph.symbols.get(exportRef).namespaceAlias !== null;

      // Add a getter property (see buildNSExportStmts)
      nsExportSymbolUses.set(exportRef, new SymbolUse(1));

      // Make sure the part that declares the export is included
      for (const partIndex of c.graph.files[exportSourceIndex].inputFile.repr.topLevelSymbolToParts(exportRef)) {
        // Use a non-local dependency since this is likely from a different
        // file if it came in through an export star
        nsExportDependencies.push(new Dependency(exportSourceIndex, partIndex));
      }
    }

    const declaredSymbols = [];
    const needsExportsVariable = repr.meta.needsExportsVariable;

    // Prefix this part with "var exports = {}" if this isn't a CommonJS entry point
    if (needsExportsVariable) {
      declaredSymbols.push(new DeclaredSymbol(repr.ast.exportsRef, true));
    }

    // "__export(exports, { foo: () => foo })"
    let exportRef = InvalidRef;
    if (aliases.length > 0) {
      const runtimeRepr = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr;
      exportRef = runtimeRepr.ast.moduleScope.members.get("__export").ref;

      // Make sure this file depends on the "__export" symbol
      for (const partIndex of runtimeRepr.topLevelSymbolToParts(exportRef)) {
        nsExportDependencies.push(new Dependency(RUNTIME_SOURCE_INDEX, partIndex));
      }

      // Make sure the CommonJS closure, if there is one, includes "exports"
      repr.ast.usesExportsRef = true;
    }

    // Decorate "module.exports" with the "__esModule" flag to indicate that
    // we used to be an ES module (see buildNSExportStmts)
    const assignModuleExports = repr.meta.forceIncludeExportsForEntryPoint && c.options.outputFormat === FormatCommonJS;

    // No need to generate a part if it'll be empty
    if (needsExportsVariable || aliases.length > 0 || assignModuleExports) {
      const build = () => c.buildNSExportStmts(repr, aliases, exportRefs, exportRefsAreImports, needsExportsVariable, exportRef, assignModuleExports);

      // Initialize the part that was allocated for us earlier. The information
      // here will be used after this during tree shaking.
      const part = new Part();
      if (lazy) {
        part.stmts = EMPTY_ARRAY;
        c.lazyNSExportStmts.set(sourceIndex, build);
        // (Recorded for sharedStep5Memo)
        c.lazyNSExportArgs.set(sourceIndex, [aliases, exportRefs, exportRefsAreImports, needsExportsVariable, exportRef, assignModuleExports]);
      } else {
        part.stmts = build();
      }
      part.symbolUses = nsExportSymbolUses;
      part.dependencies = nsExportDependencies;
      part.declaredSymbols = declaredSymbols;

      // This can be removed if nothing uses it
      part.canBeRemovedIfUnused = true;

      // Make sure this is trimmed if unused even if tree shaking is disabled
      part.forceTreeShaking = true;
      repr.ast.parts[NSExportPartIndex] = part;

      // Pull in the "__export" symbol if it was used
      if (exportRef !== InvalidRef) {
        repr.meta.needsExportSymbolFromRuntime = true;
      }
    }
  },

  // The statements of the namespace export part built by createExportsForFile
  buildNSExportStmts(repr, aliases, exportRefs, exportRefsAreImports, needsExportsVariable, exportRef, assignModuleExports) {
    const c = this;

    // Generate a getter per export
    const properties = [];
    for (let i = 0; i < aliases.length; i++) {
      const alias = aliases[i];

      // Exports of imports need EImportIdentifier in case they need to be re-
      // written to a property access later on
      let value;
      if (exportRefsAreImports[i]) {
        value = new Expr(new EImportIdentifier(exportRefs[i]), 0);
      } else {
        value = new Expr(new EIdentifier(exportRefs[i]), 0);
      }

      // Add a getter property
      const body = new FnBody(new SBlock([new Stmt(new SReturn(value), value.loc)]), 0);
      let getter;
      if (jsFeatureHas(c.options.unsupportedJSFeatures, Arrow)) {
        // (Go's zero Fn has ArgumentsRef {0, 0}, which the printer never reads)
        getter = new Expr(new EFunction(new Fn(null, EMPTY_ARRAY, body)), 0);
      } else {
        getter = new Expr(new EArrow(EMPTY_ARRAY, body, false, false, true), 0);
      }

      // Special case for __proto__ property: use a computed property
      // name to avoid it being treated as the object's prototype
      let flags = 0;
      if (alias === "__proto__" && !jsFeatureHas(c.options.unsupportedJSFeatures, ObjectExtensions)) {
        flags |= PropertyIsComputed;
      }

      properties.push(new Property(null, new Expr(new EString(alias), 0), getter, null, EMPTY_ARRAY, 0, 0, PropertyField, flags));
    }

    const nsExportStmts = [];

    // Prefix this part with "var exports = {}" if this isn't a CommonJS entry point
    if (needsExportsVariable) {
      nsExportStmts.push(
        new Stmt(new SLocal([new Decl(new Binding(new BIdentifier(repr.ast.exportsRef), 0), new Expr(new EObject(), 0))]), 0),
      );
    }

    // "__export(exports, { foo: () => foo })"
    if (properties.length > 0) {
      nsExportStmts.push(
        new Stmt(
          new SExpr(
            new Expr(
              new ECall(new Expr(new EIdentifier(exportRef), 0), [
                new Expr(new EIdentifier(repr.ast.exportsRef), 0),
                new Expr(new EObject(properties), 0),
              ]),
              0,
            ),
          ),
          0,
        ),
      );
    }

    // Decorate "module.exports" with the "__esModule" flag to indicate that
    // we used to be an ES module. This is done by wrapping the exports object
    // instead of by mutating the exports object because other modules in the
    // bundle (including the entry point module) may do "import * as" to get
    // access to the exports object and should NOT see the "__esModule" flag.
    if (assignModuleExports) {
      const runtimeRepr = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr;
      const toCommonJSRef = runtimeRepr.ast.namedExports.get("__toCommonJS").ref;

      // "module.exports = __toCommonJS(exports);"
      nsExportStmts.push(
        assignStmt(
          new Expr(new EDot(new Expr(new EIdentifier(c.unboundModuleRef), 0), "exports"), 0),
          new Expr(new ECall(new Expr(new EIdentifier(toCommonJSRef), 0), [new Expr(new EIdentifier(repr.ast.exportsRef), 0)]), 0),
        ),
      );
    }

    return nsExportStmts;
  },

  // The statements of the namespace export part of a file (see
  // createExportsForFile)
  nsExportStmtsForPart(sourceIndex, part) {
    const c = this;
    const build = c.lazyNSExportStmts.get(sourceIndex);
    if (build !== undefined) {
      c.lazyNSExportStmts.delete(sourceIndex);
      part.stmts = build();
    }
    return part.stmts;
  },

  createWrapperForFile(sourceIndex) {
    const c = this;
    const repr = c.graph.files[sourceIndex].inputFile.repr;

    switch (repr.meta.wrap) {
      // If this is a CommonJS file, we're going to need to generate a wrapper
      // for the CommonJS closure. That will end up looking something like this:
      //
      //   var require_foo = __commonJS((exports, module) => {
      //     ...
      //   });
      //
      // However, that generation is special-cased for various reasons and is
      // done later on. Still, we're going to need to ensure that this file
      // both depends on the "__commonJS" symbol and declares the "require_foo"
      // symbol. Instead of special-casing this during the reachability analysis
      // below, we just append a dummy part to the end of the file with these
      // dependencies and let the general-purpose reachability analysis take care
      // of it.
      case WrapCJS: {
        const runtimeRepr = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr;
        const commonJSParts = runtimeRepr.topLevelSymbolToParts(c.cjsRuntimeRef);

        // Generate the dummy part
        const dependencies = new Array(commonJSParts.length);
        for (let i = 0; i < commonJSParts.length; i++) {
          dependencies[i] = new Dependency(RUNTIME_SOURCE_INDEX, commonJSParts[i]);
        }
        const part = new Part();
        part.symbolUses = new Map([[repr.ast.wrapperRef, new SymbolUse(1)]]);
        part.declaredSymbols = [
          new DeclaredSymbol(repr.ast.exportsRef, true),
          new DeclaredSymbol(repr.ast.moduleRef, true),
          new DeclaredSymbol(repr.ast.wrapperRef, true),
        ];
        part.dependencies = dependencies;
        const partIndex = c.graph.addPartToFile(sourceIndex, part);
        repr.meta.wrapperPartIndex = partIndex;
        c.graph.generateSymbolImportAndUse(sourceIndex, partIndex, c.cjsRuntimeRef, 1, RUNTIME_SOURCE_INDEX);
        break;
      }

      // If this is a lazily-initialized ESM file, we're going to need to
      // generate a wrapper for the ESM closure. That will end up looking
      // something like this:
      //
      //   var init_foo = __esm(() => {
      //     ...
      //   });
      //
      // This depends on the "__esm" symbol and declares the "init_foo" symbol
      // for similar reasons to the CommonJS closure above.
      case WrapESM: {
        const runtimeRepr = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr;
        const esmParts = runtimeRepr.topLevelSymbolToParts(c.esmRuntimeRef);

        // Generate the dummy part
        const dependencies = new Array(esmParts.length);
        for (let i = 0; i < esmParts.length; i++) {
          dependencies[i] = new Dependency(RUNTIME_SOURCE_INDEX, esmParts[i]);
        }
        const part = new Part();
        part.symbolUses = new Map([[repr.ast.wrapperRef, new SymbolUse(1)]]);
        part.declaredSymbols = [new DeclaredSymbol(repr.ast.wrapperRef, true)];
        part.dependencies = dependencies;
        const partIndex = c.graph.addPartToFile(sourceIndex, part);
        repr.meta.wrapperPartIndex = partIndex;
        c.graph.generateSymbolImportAndUse(sourceIndex, partIndex, c.esmRuntimeRef, 1, RUNTIME_SOURCE_INDEX);
        break;
      }
    }
  },

  matchImportsWithExportsForFile(sourceIndex) {
    const c = this;
    const file = c.graph.files[sourceIndex];
    const repr = file.inputFile.repr;

    // Sort imports for determinism. Otherwise our unit tests will randomly
    // fail sometimes when error messages are reordered.
    const sortedImportRefs = [];
    for (const ref of repr.ast.namedImports.keys()) sortedImportRefs.push(refInner(ref));
    sortedImportRefs.sort((a, b) => a - b);

    // Pair imports with their matching exports
    for (const innerIndex of sortedImportRefs) {
      // Re-use memory for the cycle detector
      c.cycleDetector.length = 0;

      const importRef = makeRef(sourceIndex, innerIndex);
      const $d216 = c.matchImportWithExport(new importTracker(sourceIndex, 0, importRef), []);
      let result = $d216[0], reExports = $d216[1];
      if (reExports === null) reExports = EMPTY_ARRAY;
      switch (result.kind) {
        case matchImportIgnore:
          break;

        case matchImportNormal:
          repr.meta.importsToBind.set(importRef, new ImportData(reExports, 0, result.ref, result.sourceIndex));
          break;

        case matchImportNamespace:
          writableSymbol(c.graph.symbols, importRef).namespaceAlias = new NamespaceAlias(result.alias, result.namespaceRef);
          break;

        case matchImportNormalAndNamespace:
          repr.meta.importsToBind.set(importRef, new ImportData(reExports, 0, result.ref, result.sourceIndex));
          writableSymbol(c.graph.symbols, importRef).namespaceAlias = new NamespaceAlias(result.alias, result.namespaceRef);
          break;

        case matchImportCycle: {
          const namedImport = repr.ast.namedImports.get(importRef);
          c.log.addError(file.lineColumnTracker(), rangeOfIdentifier(file.inputFile.source, namedImport.aliasLoc), "Detected cycle while resolving import " + goQuote(namedImport.alias));
          break;
        }

        case matchImportProbablyTypeScriptType:
          repr.meta.isProbablyTypeScriptType.set(importRef, true);
          break;

        case matchImportAmbiguous: {
          const namedImport = repr.ast.namedImports.get(importRef);
          const r = rangeOfIdentifier(file.inputFile.source, namedImport.aliasLoc);
          let notes: MsgData[] | null = null;

          // Provide the locations of both ambiguous exports if possible
          if (result.nameLoc !== 0 && result.otherNameLoc !== 0) {
            const a = c.graph.files[result.sourceIndex];
            const b = c.graph.files[result.otherSourceIndex];
            const ra = rangeOfIdentifier(a.inputFile.source, result.nameLoc);
            const rb = rangeOfIdentifier(b.inputFile.source, result.otherNameLoc);
            notes = [a.lineColumnTracker().msgData(ra, "One matching export is here:"), b.lineColumnTracker().msgData(rb, "Another matching export is here:")];
          }

          const symbol = c.graph.symbols.get(importRef);
          if (symbol.importItemStatus === ImportItemGenerated) {
            const symbol = writableSymbol(c.graph.symbols, importRef);
            // This is a warning instead of an error because although it appears
            // to be a named import, it's actually an automatically-generated
            // named import that was originally a property access on an import
            // star namespace object. Normally this property access would just
            // resolve to undefined at run-time instead of failing at binding-
            // time, so we emit a warning and rewrite the value to the literal
            // "undefined" instead of emitting an error.
            symbol.importItemStatus = ImportItemMissing;
            const msg = "Import " + goQuote(namedImport.alias) + " will always be undefined because there are multiple matching exports";
            c.log.addIDWithNotes(MsgID_Bundler_ImportIsUndefined, MsgWarning, file.lineColumnTracker(), r, msg, notes);
          } else {
            const msg = "Ambiguous import " + goQuote(namedImport.alias) + " has multiple matching exports";
            c.log.addErrorWithNotes(file.lineColumnTracker(), r, msg, notes);
          }
          break;
        }
      }
    }
  },

  // Returns [result, reExports]. Note: "reExportsIn" is appended to in place
  // (callers always continue with the returned array, like Go's append).
  matchImportWithExport(tracker, reExportsIn) {
    const c = this;
    const ambiguousResults = [];
    let reExports = reExportsIn;
    let result = new matchImportResult();

    loop: for (;;) {
      // Make sure we avoid infinite loops trying to resolve cycles:
      //
      //   // foo.js
      //   export {a as b} from './foo.js'
      //   export {b as c} from './foo.js'
      //   export {c as a} from './foo.js'
      //
      // This uses a O(n^2) array scan instead of a O(n) map because the vast
      // majority of cases have one or two elements and Go arrays are cheap to
      // reuse without allocating.
      for (const previousTracker of c.cycleDetector) {
        if (
          tracker.sourceIndex === previousTracker.sourceIndex &&
          tracker.nameLoc === previousTracker.nameLoc &&
          tracker.importRef === previousTracker.importRef
        ) {
          result = new matchImportResult(matchImportCycle);
          break loop;
        }
      }
      c.cycleDetector.push(tracker);

      // Resolve the import by one step
      const $d217 = c.advanceImportTracker(tracker);
      const nextTracker = $d217[0], status = $d217[1], potentiallyAmbiguousExportStarRefs = $d217[2];
      switch (status) {
        case importCommonJS:
        case importCommonJSWithoutExports:
        case importExternal:
        case importDisabled: {
          if (status === importExternal && formatKeepESMImportExportSyntax(c.options.outputFormat)) {
            // Imports from external modules should not be converted to CommonJS
            // if the output format preserves the original ES6 import statements
            break;
          }

          // If it's a CommonJS or external file, rewrite the import to a
          // property access. Don't do this if the namespace reference is invalid
          // though. This is the case for star imports, where the import is the
          // namespace.
          const trackerFile = c.graph.files[tracker.sourceIndex];
          const namedImport = trackerFile.inputFile.repr.ast.namedImports.get(tracker.importRef);
          if (namedImport.namespaceRef !== InvalidRef) {
            if (result.kind === matchImportNormal) {
              result.kind = matchImportNormalAndNamespace;
              result.namespaceRef = namedImport.namespaceRef;
              result.alias = namedImport.alias;
            } else {
              result = new matchImportResult(matchImportNamespace, namedImport.alias, namedImport.namespaceRef);
            }
          }

          // Warn about importing from a file that is known to not have any exports
          if (status === importCommonJSWithoutExports) {
            const symbol = writableSymbol(c.graph.symbols, tracker.importRef);
            symbol.importItemStatus = ImportItemMissing;
            let kind = MsgWarning;
            if (isInsideNodeModules(trackerFile.inputFile.source.keyPath.text)) {
              kind = MsgDebug;
            }
            c.log.addID(
              MsgID_Bundler_ImportIsUndefined,
              kind,
              trackerFile.lineColumnTracker(),
              rangeOfIdentifier(trackerFile.inputFile.source, namedImport.aliasLoc),
              "Import " +
                goQuote(namedImport.alias) +
                " will always be undefined because the file " +
                goQuote(c.graph.files[nextTracker.sourceIndex].inputFile.source.prettyPaths.select(c.options.logPathStyle)) +
                " has no exports",
            );
          }
          break;
        }

        case importDynamicFallback: {
          // If it's a file with dynamic export fallback, rewrite the import to a property access
          const trackerFile = c.graph.files[tracker.sourceIndex];
          const namedImport = trackerFile.inputFile.repr.ast.namedImports.get(tracker.importRef);
          if (result.kind === matchImportNormal) {
            result.kind = matchImportNormalAndNamespace;
            result.namespaceRef = nextTracker.importRef;
            result.alias = namedImport.alias;
          } else {
            result = new matchImportResult(matchImportNamespace, namedImport.alias, nextTracker.importRef);
          }
          break;
        }

        case importNoMatch: {
          const trackerFile = c.graph.files[tracker.sourceIndex];
          const namedImport = trackerFile.inputFile.repr.ast.namedImports.get(tracker.importRef);
          const r = rangeOfIdentifier(trackerFile.inputFile.source, namedImport.aliasLoc);

          // Report mismatched imports and exports
          if (c.graph.symbols.get(tracker.importRef).importItemStatus === ImportItemGenerated) {
            const symbol = writableSymbol(c.graph.symbols, tracker.importRef);

            // This is not an error because although it appears to be a named
            // import, it's actually an automatically-generated named import
            // that was originally a property access on an import star
            // namespace object:
            //
            //   import * as ns from 'foo'
            //   const undefinedValue = ns.notAnExport
            //
            // If this code wasn't bundled, this property access would just resolve
            // to undefined at run-time instead of failing at binding-time, so we
            // emit rewrite the value to the literal "undefined" instead of
            // emitting an error.
            symbol.importItemStatus = ImportItemMissing;

            // Don't emit a log message if this symbol isn't used, since then the
            // log message isn't helpful. This can happen with "import" assignment
            // statements in TypeScript code since they are ambiguously either a
            // type or a value. We consider them to be a type if they aren't used.
            //
            //   import * as ns from 'foo'
            //
            //   // There's no warning here because this is dead code
            //   if (false) ns.notAnExport
            //
            //   // There's no warning here because this is never used
            //   import unused = ns.notAnExport
            //
            if (symbol.useCountEstimate > 0) {
              const nextFile = c.graph.files[nextTracker.sourceIndex].inputFile;
              const msg = new Msg(
                null,
                "",
                trackerFile
                  .lineColumnTracker()
                  .msgData(
                    r,
                    "Import " +
                      goQuote(namedImport.alias) +
                      " will always be undefined because there is no matching export in " +
                      goQuote(nextFile.source.prettyPaths.select(c.options.logPathStyle)),
                  ),
                MsgWarning,
              );
              if (isInsideNodeModules(trackerFile.inputFile.source.keyPath.text)) {
                msg.kind = MsgDebug;
              }
              c.maybeCorrectObviousTypo(nextFile.repr, namedImport.alias, msg);
              c.log.addMsgID(MsgID_Bundler_ImportIsUndefined, msg);
            }
          } else {
            const nextFile = c.graph.files[nextTracker.sourceIndex].inputFile;
            const msg = new Msg(
              null,
              "",
              trackerFile
                .lineColumnTracker()
                .msgData(r, "No matching export in " + goQuote(nextFile.source.prettyPaths.select(c.options.logPathStyle)) + " for import " + goQuote(namedImport.alias)),
              MsgError,
            );
            c.maybeCorrectObviousTypo(nextFile.repr, namedImport.alias, msg);
            c.log.addMsg(msg);
          }
          break;
        }

        case importProbablyTypeScriptType:
          // Omit this import from any namespace export code we generate for
          // import star statements (i.e. "import * as ns from 'path'")
          result = new matchImportResult(matchImportProbablyTypeScriptType);
          break;

        case importFound: {
          // If there are multiple ambiguous results due to use of "export * from"
          // statements, trace them all to see if they point to different things.
          for (const ambiguousTracker of potentiallyAmbiguousExportStarRefs) {
            // If this is a re-export of another import, follow the import
            if (c.graph.files[ambiguousTracker.sourceIndex].inputFile.repr.ast.namedImports.has(ambiguousTracker.ref)) {
              // Save and restore the cycle detector to avoid mixing information
              const oldCycleDetectorLength = c.cycleDetector.length;
              const [ambiguousResult, newReExportFiles] = c.matchImportWithExport(
                new importTracker(ambiguousTracker.sourceIndex, 0, ambiguousTracker.ref),
                reExports,
              );
              c.cycleDetector.length = oldCycleDetectorLength;
              ambiguousResults.push(ambiguousResult);
              reExports = newReExportFiles;
            } else {
              ambiguousResults.push(
                new matchImportResult(matchImportNormal, "", 0, ambiguousTracker.sourceIndex, ambiguousTracker.nameLoc, 0, 0, ambiguousTracker.ref),
              );
            }
          }

          // Defer the actual binding of this import until after we generate
          // namespace export code for all files. This has to be done for all
          // import-to-export matches, not just the initial import to the final
          // export, since all imports and re-exports must be merged together
          // for correctness.
          result = new matchImportResult(matchImportNormal, "", 0, nextTracker.sourceIndex, nextTracker.nameLoc, 0, 0, nextTracker.importRef);

          // Depend on the statement(s) that declared this import symbol in the
          // original file (a null array is Go's nil slice after an ambiguous
          // nested result)
          for (const resolvedPartIndex of c.graph.files[tracker.sourceIndex].inputFile.repr.topLevelSymbolToParts(tracker.importRef)) {
            if (reExports === null) reExports = [];
            reExports.push(new Dependency(tracker.sourceIndex, resolvedPartIndex));
          }

          // If this is a re-export of another import, continue for another
          // iteration of the loop to resolve that import as well
          if (c.graph.files[nextTracker.sourceIndex].inputFile.repr.ast.namedImports.has(nextTracker.importRef)) {
            tracker = nextTracker;
            continue loop;
          }
          break;
        }

        default:
          throw new globalThis.Error("Internal error");
      }

      // Stop now if we didn't explicitly "continue" above
      break;
    }

    // If there is a potential ambiguity, all results must be the same
    for (const ambiguousResult of ambiguousResults) {
      if (!ambiguousResult.equals(result)) {
        if (
          result.kind === matchImportNormal &&
          ambiguousResult.kind === matchImportNormal &&
          result.nameLoc !== 0 &&
          ambiguousResult.nameLoc !== 0
        ) {
          return [
            new matchImportResult(matchImportAmbiguous, "", 0, result.sourceIndex, result.nameLoc, ambiguousResult.sourceIndex, ambiguousResult.nameLoc),
            null,
          ];
        }
        return [new matchImportResult(matchImportAmbiguous), null];
      }
    }

    return [result, reExports];
  },

  maybeForbidArbitraryModuleNamespaceIdentifier(kind, sourceIndex, loc, alias) {
    const c = this;
    if (!isIdentifier(alias)) {
      const file = c.graph.files[sourceIndex];
      const where = prettyPrintTargetEnvironment(c.options.originalTargetEnv, c.options.unsupportedJSFeatureOverridesMask);
      c.log.addError(
        file.lineColumnTracker(),
        file.inputFile.source.rangeOfString(loc),
        "Using the string " + goQuote(alias) + " as an " + kind + " name is not supported in " + where,
      );
    }
  },

  // Attempt to correct an import name with a typo
  maybeCorrectObviousTypo(repr, name, msg) {
    const c = this;
    if (repr.meta.resolvedExportTypos === null) {
      const valid = [...repr.meta.resolvedExports.keys()];
      valid.sort((a, b) => (goStringLess(a, b) ? -1 : goStringLess(b, a) ? 1 : 0));
      repr.meta.resolvedExportTypos = new TypoDetector(valid);
    }

    const $t = repr.meta.resolvedExportTypos.maybeCorrectTypo(name);
    if ($t[1]) {
      const corrected = $t[0];
      msg.data.location.suggestion = corrected;
      const export_ = repr.meta.resolvedExports.get(corrected);
      const importedFile = c.graph.files[export_.sourceIndex];
      const text = "Did you mean to import " + goQuote(corrected) + " instead?";
      let note;
      if (export_.nameLoc === 0) {
        // Don't report a source location for definitions without one. This can
        // happen with automatically-generated exports from non-JavaScript files.
        note = new MsgData(null, null, text);
      } else {
        let r;
        if (loaderIsCSS(importedFile.inputFile.loader)) {
          r = cssRangeOfIdentifier(importedFile.inputFile.source, export_.nameLoc);
        } else {
          r = rangeOfIdentifier(importedFile.inputFile.source, export_.nameLoc);
        }
        note = importedFile.lineColumnTracker().msgData(r, text);
      }
      msg.notes = msg.notes === null ? [note] : [...msg.notes, note];
    }
  },

  recursivelyWrapDependencies(sourceIndex) {
    const c = this;
    const repr = c.graph.files[sourceIndex].inputFile.repr;
    if (repr.meta.didWrapDependencies) return;
    repr.meta.didWrapDependencies = true;

    // Never wrap the runtime file since it always comes first
    if (sourceIndex === RUNTIME_SOURCE_INDEX) return;

    // This module must be wrapped
    if (repr.meta.wrap === WrapNone) {
      if (repr.ast.exportsKind === ExportsCommonJS) {
        repr.meta.wrap = WrapCJS;
      } else {
        repr.meta.wrap = WrapESM;
      }
    }

    // All dependencies must also be wrapped
    for (let $i79 = 0, $a79 = repr.ast.importRecords; $i79 < $a79.length; $i79++) {
      const record = $a79[$i79];
      if (record.sourceIndex >= 0) {
        c.recursivelyWrapDependencies(record.sourceIndex);
      }
    }
  },

  hasDynamicExportsDueToExportStar(sourceIndex, visited) {
    const c = this;

    // Terminate the traversal now if this file already has dynamic exports
    const repr = c.graph.files[sourceIndex].inputFile.repr;
    if (repr.ast.exportsKind === ExportsCommonJS || repr.ast.exportsKind === ExportsESMWithDynamicFallback) {
      return true;
    }

    // Avoid infinite loops due to cycles in the export star graph
    if (visited.has(sourceIndex)) return false;
    visited.add(sourceIndex);

    // Scan over the export star graph
    for (let $i80 = 0, $a80 = repr.ast.exportStarImportRecords; $i80 < $a80.length; $i80++) {
      const importRecordIndex = $a80[$i80];
      const record = repr.ast.importRecords[importRecordIndex];

      // This file has dynamic exports if the exported imports are from a file
      // that either has dynamic exports directly or transitively by itself
      // having an export star from a file with dynamic exports.
      if (
        (!(record.sourceIndex >= 0) &&
          (!c.graph.files[sourceIndex].isEntryPoint() || !formatKeepESMImportExportSyntax(c.options.outputFormat))) ||
        (record.sourceIndex >= 0 && record.sourceIndex !== sourceIndex && c.hasDynamicExportsDueToExportStar(record.sourceIndex, visited))
      ) {
        repr.ast.exportsKind = ExportsESMWithDynamicFallback;
        return true;
      }
    }

    return false;
  },

  // "sourceIndexStack" is used as a stack: Go appends to a slice passed by
  // value, which is equivalent to push-on-entry/pop-on-exit here.
  addExportsForExportStar(resolvedExports, sourceIndex, sourceIndexStack) {
    const c = this;

    // Avoid infinite loops due to cycles in the export star graph
    for (const prevSourceIndex of sourceIndexStack) {
      if (prevSourceIndex === sourceIndex) return;
    }
    sourceIndexStack.push(sourceIndex);
    const repr = c.graph.files[sourceIndex].inputFile.repr;

    for (let $i81 = 0, $a81 = repr.ast.exportStarImportRecords; $i81 < $a81.length; $i81++) {
      const importRecordIndex = $a81[$i81];
      const record = repr.ast.importRecords[importRecordIndex];
      if (!(record.sourceIndex >= 0)) {
        // This will be resolved at run time instead
        continue;
      }
      const otherSourceIndex = record.sourceIndex;

      // Export stars from a CommonJS module don't work because they can't be
      // statically discovered. Just silently ignore them in this case.
      //
      // We could attempt to check whether the imported file still has ES6
      // exports even though it still uses CommonJS features. However, when
      // doing this we'd also have to rewrite any imports of these export star
      // re-exports as property accesses off of a generated require() call.
      const otherRepr = c.graph.files[otherSourceIndex].inputFile.repr;
      if (otherRepr.ast.exportsKind === ExportsCommonJS) {
        // All exports will be resolved at run time instead
        continue;
      }

      // Accumulate this file's exports
      nextExport: for (const [alias, name] of otherRepr.ast.namedExports) {
        // ES6 export star statements ignore exports named "default"
        if (alias === "default") continue;

        // This export star is shadowed if any file in the stack has a matching real named export
        for (const prevSourceIndex of sourceIndexStack) {
          const prevRepr = c.graph.files[prevSourceIndex].inputFile.repr;
          if (prevRepr.ast.namedExports.has(alias)) continue nextExport;
        }

        const existing = resolvedExports.get(alias);
        if (existing === undefined) {
          // Initialize the re-export
          resolvedExports.set(alias, new ExportData(EMPTY_ARRAY, name.ref, name.aliasLoc, otherSourceIndex));

          // Make sure the symbol is marked as imported so that code splitting
          // imports it correctly if it ends up being shared with another chunk
          repr.meta.importsToBind.set(name.ref, new ImportData(EMPTY_ARRAY, 0, name.ref, otherSourceIndex));
        } else if (existing.sourceIndex !== otherSourceIndex) {
          // Two different re-exports colliding makes it potentially ambiguous
          const refs = existing.potentiallyAmbiguousExportStarRefs.slice();
          refs.push(new ImportData(EMPTY_ARRAY, name.aliasLoc, name.ref, otherSourceIndex));
          resolvedExports.set(alias, new ExportData(refs, existing.ref, existing.nameLoc, existing.sourceIndex));
        }
      }

      // Search further through this file's export stars
      c.addExportsForExportStar(resolvedExports, otherSourceIndex, sourceIndexStack);
    }

    sourceIndexStack.pop();
  },

  // Returns [importTracker, importStatus, []ImportData]
  advanceImportTracker(tracker) {
    const c = this;
    const file = c.graph.files[tracker.sourceIndex];
    const repr = file.inputFile.repr;
    const namedImport = repr.ast.namedImports.get(tracker.importRef);

    // Is this an external file?
    const record = repr.ast.importRecords[namedImport.importRecordIndex];
    if (!(record.sourceIndex >= 0)) {
      return [new importTracker(), importExternal, EMPTY_ARRAY];
    }

    // Is this a named import of a file without any exports?
    const otherSourceIndex = record.sourceIndex;
    const otherRepr = c.graph.files[otherSourceIndex].inputFile.repr;
    if (
      !namedImport.aliasIsStar &&
      !otherRepr.ast.hasLazyExport &&
      // CommonJS exports
      otherRepr.ast.exportKeyword.len === 0 &&
      namedImport.alias !== "default" &&
      // ESM exports
      !otherRepr.ast.usesExportsRef &&
      !otherRepr.ast.usesModuleRef
    ) {
      // Just warn about it and replace the import with "undefined"
      return [new importTracker(otherSourceIndex, 0, InvalidRef), importCommonJSWithoutExports, EMPTY_ARRAY];
    }

    // Is this a CommonJS file?
    if (otherRepr.ast.exportsKind === ExportsCommonJS) {
      return [new importTracker(otherSourceIndex, 0, InvalidRef), importCommonJS, EMPTY_ARRAY];
    }

    // Match this import star with an export star from the imported file
    const matchingExportStar = otherRepr.meta.resolvedExportStar;
    if (namedImport.aliasIsStar && matchingExportStar !== null) {
      // Check to see if this is a re-export of another import
      return [
        new importTracker(matchingExportStar.sourceIndex, matchingExportStar.nameLoc, matchingExportStar.ref),
        importFound,
        matchingExportStar.potentiallyAmbiguousExportStarRefs,
      ];
    }

    // Match this import up with an export from the imported file
    const matchingExport = otherRepr.meta.resolvedExports.get(namedImport.alias);
    if (matchingExport !== undefined) {
      // Check to see if this is a re-export of another import
      return [
        new importTracker(matchingExport.sourceIndex, matchingExport.nameLoc, matchingExport.ref),
        importFound,
        matchingExport.potentiallyAmbiguousExportStarRefs,
      ];
    }

    // Is this a file with dynamic exports?
    if (otherRepr.ast.exportsKind === ExportsESMWithDynamicFallback) {
      return [new importTracker(otherSourceIndex, 0, otherRepr.ast.exportsRef), importDynamicFallback, EMPTY_ARRAY];
    }

    // Missing re-exports in TypeScript files are indistinguishable from types
    if (loaderIsTypeScript(file.inputFile.loader) && namedImport.isExported) {
      return [new importTracker(), importProbablyTypeScriptType, EMPTY_ARRAY];
    }

    return [new importTracker(otherSourceIndex), importNoMatch, EMPTY_ARRAY];
  },
});

// ---------------------------------------------------------------------------
// Tree shaking and chunks

class chunkOrder {
  declare sourceIndex: any;
  declare distance: any;
  declare tieBreaker: any;
  constructor(sourceIndex, distance, tieBreaker) {
    this.sourceIndex = sourceIndex;
    this.distance = distance;
    this.tieBreaker = tieBreaker;
  }
}

function appendOrExtendPartRange(ranges, sourceIndex, partIndex) {
  const i = ranges.length - 1;
  if (i >= 0) {
    const r = ranges[i];
    if (r.sourceIndex === sourceIndex && r.partIndexEnd === partIndex) {
      r.partIndexEnd = partIndex + 1;
      return ranges;
    }
  }

  ranges.push(new partRange(sourceIndex, partIndex, partIndex + 1));
  return ranges;
}

// "var a = 1; var b = 2;" => "var a = 1, b = 2;"
export function mergeAdjacentLocalStmts(stmts) {
  if (stmts.length === 0) return stmts;

  let didMergeWithPreviousLocal = false;
  let end = 1;

  for (let i = 1; i < stmts.length; i++) {
    const stmt = stmts[i];

    // Try to merge with the previous variable statement
    const after = stmt.data;
    if (after.k === S_LOCAL) {
      const before = stmts[end - 1].data;
      if (before.k === S_LOCAL) {
        // It must be the same kind of variable statement (i.e. let/var/const)
        if (before.kind === after.kind && before.isExport === after.isExport) {
          if (didMergeWithPreviousLocal) {
            // Avoid O(n^2) behavior for repeated variable declarations
            for (const d of after.decls) before.decls.push(d);
          } else {
            // Be careful to not modify the original statement
            didMergeWithPreviousLocal = true;
            const clone = new SLocal(before.decls.concat(after.decls), before.kind, before.isExport, before.wasTSImportEquals);
            stmts[end - 1] = new Stmt(clone, stmts[end - 1].loc);
          }
          continue;
        }
      }
    }

    // Otherwise, append a normal statement
    didMergeWithPreviousLocal = false;
    stmts[end] = stmt;
    end++;
  }

  stmts.length = end;
  return stmts;
}

Object.assign(linkerContext.prototype, {
  treeShakingAndCodeSplitting() {
    const c = this;

    // Tree shaking: Each entry point marks all files reachable from itself
    c.timer?.begin("Tree shaking");
    for (const entryPoint of c.graph.entryPoints()) {
      c.markFileLiveForTreeShaking(entryPoint.sourceIndex);
    }
    c.timer?.end("Tree shaking");

    // Code splitting: Determine which entry points can reach which files. This
    // has to happen after tree shaking because there is an implicit dependency
    // between live parts within the same file. All liveness has to be computed
    // first before determining which entry points can reach which files.
    c.timer?.begin("Code splitting");
    const entryPoints = c.graph.entryPoints();
    for (let i = 0; i < entryPoints.length; i++) {
      c.markFileReachableForCodeSplitting(entryPoints[i].sourceIndex, i, 0);
    }
    c.timer?.end("Code splitting");
  },

  markFileReachableForCodeSplitting(sourceIndex, entryPointBit, distanceFromEntryPoint) {
    const c = this;
    const file = c.graph.files[sourceIndex];
    if (!file.isLive) return;
    let traverseAgain = false;

    // Track the minimum distance to an entry point
    if (distanceFromEntryPoint < file.distanceFromEntryPoint) {
      file.distanceFromEntryPoint = distanceFromEntryPoint;
      traverseAgain = true;
    }
    distanceFromEntryPoint++;

    // Don't mark this file more than once
    if (file.entryBits.hasBit(entryPointBit) && !traverseAgain) return;
    file.entryBits.setBit(entryPointBit);

    const repr = file.inputFile.repr;
    if (repr instanceof JSRepr) {
      // If the JavaScript stub for a CSS file is included, also include the CSS file
      if (repr.cssSourceIndex >= 0) {
        c.markFileReachableForCodeSplitting(repr.cssSourceIndex, entryPointBit, distanceFromEntryPoint);
      }

      // Traverse into all imported files
      for (let $i82 = 0, $a82 = repr.ast.importRecords; $i82 < $a82.length; $i82++) {
        const record = $a82[$i82];
        if (record.sourceIndex >= 0 && !c.isExternalDynamicImport(record, sourceIndex)) {
          c.markFileReachableForCodeSplitting(record.sourceIndex, entryPointBit, distanceFromEntryPoint);
        }
      }

      // Traverse into all dependencies of all parts in this file
      for (let $i83 = 0, $a83 = repr.ast.parts; $i83 < $a83.length; $i83++) {
        const part = $a83[$i83];
        for (let $i84 = 0, $a84 = part.dependencies; $i84 < $a84.length; $i84++) {
          const dependency = $a84[$i84];
          if (dependency.sourceIndex !== sourceIndex) {
            c.markFileReachableForCodeSplitting(dependency.sourceIndex, entryPointBit, distanceFromEntryPoint);
          }
        }
      }
    } else if (repr instanceof CSSRepr) {
      // Traverse into all dependencies
      for (const record of repr.ast.importRecords) {
        if (record.sourceIndex >= 0) {
          c.markFileReachableForCodeSplitting(record.sourceIndex, entryPointBit, distanceFromEntryPoint);
        }
      }
    }
  },

  markFileLiveForTreeShaking(sourceIndex) {
    const c = this;
    const file = c.graph.files[sourceIndex];

    // Don't mark this file more than once
    if (file.isLive) return;
    file.isLive = true;

    const repr = file.inputFile.repr;
    if (repr instanceof JSRepr) {
      // If the JavaScript stub for a CSS file is included, also include the CSS file
      if (repr.cssSourceIndex >= 0) {
        c.markFileLiveForTreeShaking(repr.cssSourceIndex);
      }

      const parts = repr.ast.parts;
      for (let partIndex = 0, partCount = parts.length; partIndex < partCount; partIndex++) {
        const part = parts[partIndex];
        let canBeRemovedIfUnused = part.canBeRemovedIfUnused;

        // Also include any statement-level imports
        for (let $i85 = 0, $a85 = part.importRecordIndices; $i85 < $a85.length; $i85++) {
          const importRecordIndex = $a85[$i85];
          const record = repr.ast.importRecords[importRecordIndex];
          if (record.kind !== ImportStmt) continue;

          if (record.sourceIndex >= 0) {
            const otherSourceIndex = record.sourceIndex;

            // Don't include this module for its side effects if it can be
            // considered to have no side effects
            const otherFile = c.graph.files[otherSourceIndex];
            if (otherFile.inputFile.sideEffects.kind !== HasSideEffects && !c.options.ignoreDCEAnnotations) {
              continue;
            }

            // Otherwise, include this module for its side effects
            c.markFileLiveForTreeShaking(otherSourceIndex);
          } else if ((record.flags & IsExternalWithoutSideEffects) !== 0) {
            // This can be removed if it's unused
            continue;
          }

          // If we get here then the import was included for its side effects, so
          // we must also keep this part
          canBeRemovedIfUnused = false;
        }

        // Include all parts in this file with side effects, or just include
        // everything if tree-shaking is disabled. Note that we still want to
        // perform tree-shaking on the runtime even if tree-shaking is disabled.
        if (!canBeRemovedIfUnused || (!part.forceTreeShaking && !c.options.treeShaking && file.isEntryPoint())) {
          c.markPartLiveForTreeShaking(sourceIndex, partIndex);
        }
      }
    } else if (repr instanceof CSSRepr) {
      // Include all "@import" rules
      for (const record of repr.ast.importRecords) {
        if (record.sourceIndex >= 0) {
          c.markFileLiveForTreeShaking(record.sourceIndex);
        }
      }
    }
  },

  isExternalDynamicImport(record, sourceIndex) {
    const c = this;
    return (
      c.options.codeSplitting &&
      record.kind === ImportDynamic &&
      c.graph.files[record.sourceIndex].isEntryPoint() &&
      record.sourceIndex !== sourceIndex
    );
  },

  markPartLiveForTreeShaking(sourceIndex, partIndex) {
    const c = this;
    const file = c.graph.files[sourceIndex];
    const repr = file.inputFile.repr;
    const part = repr.ast.parts[partIndex];

    // Don't mark this part more than once
    if (part.isLive) return;
    part.isLive = true;

    // Include the file containing this part
    c.markFileLiveForTreeShaking(sourceIndex);

    // Also include any dependencies
    for (let $i86 = 0, $a86 = part.dependencies; $i86 < $a86.length; $i86++) {
      const dep = $a86[$i86];
      c.markPartLiveForTreeShaking(dep.sourceIndex, dep.partIndex);
    }
  },

  // JavaScript modules are traversed in depth-first postorder. Returns the
  // CSS files imported by JS files in JS order (always empty without CSS).
  findImportedCSSFilesInJSOrder(entryPoint) {
    const c = this;
    const visited = new Set();
    const order = [];

    // Include this file and all files it imports
    const visit = (sourceIndex) => {
      if (visited.has(sourceIndex)) return;
      visited.add(sourceIndex);
      const file = c.graph.files[sourceIndex];
      const repr = file.inputFile.repr;

      // Iterate over each part in the file in order
      for (let $i87 = 0, $a87 = repr.ast.parts; $i87 < $a87.length; $i87++) {
        const part = $a87[$i87];
        // Traverse any files imported by this part. Note that CommonJS calls
        // to "require()" count as imports too, sort of as if the part has an
        // ESM "import" statement in it. This may seem weird because ESM imports
        // are a compile-time concept while CommonJS imports are a run-time
        // concept. But we don't want to manipulate <style> tags at run-time so
        // this is the only way to do it.
        for (let $i88 = 0, $a88 = part.importRecordIndices; $i88 < $a88.length; $i88++) {
          const importRecordIndex = $a88[$i88];
          const record = repr.ast.importRecords[importRecordIndex];
          if (record.sourceIndex >= 0) {
            visit(record.sourceIndex);
          }
        }
      }

      // Iterate over the associated CSS imports in postorder
      if (repr.cssSourceIndex >= 0) {
        order.push(repr.cssSourceIndex);
      }
    };

    // Include all files reachable from the entry point
    visit(entryPoint);

    return order;
  },

  computeChunks() {
    const c = this;
    if (c.timer === null) {
      return c.computeChunksImpl();
    }
    c.timer?.begin("Compute chunks");
    try {
      return c.computeChunksImpl();
    } finally {
      c.timer?.end("Compute chunks");
    }
  },

  computeChunksImpl() {
    const c = this;
    const jsChunks = new Map();
    const cssChunks = new Map();

    // Create chunks for entry points
    const entryPoints = c.graph.entryPoints();
    for (let i = 0; i < entryPoints.length; i++) {
      const entryPoint = entryPoints[i];
      const file = c.graph.files[entryPoint.sourceIndex];

      // Create a chunk for the entry point here to ensure that the chunk is
      // always generated even if the resulting file is empty
      const entryBits = newBitSet(entryPoints.length);
      entryBits.setBit(i);
      const key = entryBits.string();
      const chunk = new chunkInfo();
      chunk.entryBits = entryBits;
      chunk.isEntryPoint = true;
      chunk.sourceIndex = entryPoint.sourceIndex;
      chunk.entryPointBit = i;
      chunk.filesWithPartsInChunk = new Set();

      const repr = file.inputFile.repr;
      if (repr instanceof JSRepr) {
        const chunkRepr = new chunkReprJS();
        chunk.chunkRepr = chunkRepr;
        jsChunks.set(key, chunk);

        // If this JS entry point has an associated CSS entry point, generate it
        // now. This is essentially done by generating a virtual CSS file that
        // only contains "@import" statements in the order that the files were
        // discovered in JS source order, where JS source order is arbitrary but
        // consistent for dynamic imports. Then we run the CSS import order
        // algorithm to determine the final CSS file order for the chunk.
        const cssSourceIndices = c.findImportedCSSFilesInJSOrder(entryPoint.sourceIndex);
        if (cssSourceIndices.length > 0) {
          const order = findImportedFilesInCSSOrder(c, cssSourceIndices);
          const cssFilesWithPartsInChunk = new Set();
          for (const entry of order) {
            if (entry.kind === cssImportSourceIndex) {
              cssFilesWithPartsInChunk.add(entry.sourceIndex);
            }
          }
          const cssChunk = new chunkInfo();
          cssChunk.entryBits = entryBits;
          cssChunk.isEntryPoint = true;
          cssChunk.sourceIndex = entryPoint.sourceIndex;
          cssChunk.entryPointBit = i;
          cssChunk.filesWithPartsInChunk = cssFilesWithPartsInChunk;
          cssChunk.chunkRepr = new chunkReprCSS(order);
          cssChunks.set(key, cssChunk);
          chunkRepr.hasCSSChunk = true;
        }
      } else if (repr instanceof CSSRepr) {
        const order = findImportedFilesInCSSOrder(c, [entryPoint.sourceIndex]);
        for (const entry of order) {
          if (entry.kind === cssImportSourceIndex) {
            chunk.filesWithPartsInChunk.add(entry.sourceIndex);
          }
        }
        chunk.chunkRepr = new chunkReprCSS(order);
        cssChunks.set(key, chunk);
      }
    }

    // Figure out which JS files are in which chunk
    for (const sourceIndex of c.graph.reachableFiles) {
      const file = c.graph.files[sourceIndex];
      if (file.isLive) {
        if (file.inputFile.repr instanceof JSRepr) {
          const key = file.entryBits.string();
          let chunk = jsChunks.get(key);
          if (chunk === undefined) {
            chunk = new chunkInfo();
            chunk.entryBits = file.entryBits;
            chunk.filesWithPartsInChunk = new Set();
            chunk.chunkRepr = new chunkReprJS();
            jsChunks.set(key, chunk);
          }
          chunk.filesWithPartsInChunk.add(sourceIndex);
        }
      }
    }

    // Sort the chunks for determinism. This matters because we use chunk indices
    // as sorting keys in a few places.
    const sortedChunks = [];
    let sortedKeys = [...jsChunks.keys()];
    sortedKeys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // keys are byte strings (char codes 0-255)
    const jsChunkIndicesForCSS = new Map();
    for (const key of sortedKeys) {
      const chunk = jsChunks.get(key);
      if (chunk.chunkRepr.hasCSSChunk) {
        jsChunkIndicesForCSS.set(key, sortedChunks.length);
      }
      sortedChunks.push(chunk);
    }
    sortedKeys = [...cssChunks.keys()];
    sortedKeys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const key of sortedKeys) {
      const chunk = cssChunks.get(key);
      const jsChunkIndex = jsChunkIndicesForCSS.get(key);
      if (jsChunkIndex !== undefined) {
        sortedChunks[jsChunkIndex].chunkRepr.cssChunkIndex = sortedChunks.length;
      }
      sortedChunks.push(chunk);
    }

    // Map from the entry point file to its chunk. We will need this later if
    // a file contains a dynamic import to this entry point, since we'll need
    // to look up the path for this chunk to use with the import.
    for (let chunkIndex = 0; chunkIndex < sortedChunks.length; chunkIndex++) {
      const chunk = sortedChunks[chunkIndex];
      if (chunk.isEntryPoint) {
        const file = c.graph.files[chunk.sourceIndex];

        // JS entry points that import CSS files generate two chunks, a JS chunk
        // and a CSS chunk. Don't link the CSS chunk to the JS file since the CSS
        // chunk is secondary (the JS chunk is primary).
        if (chunk.chunkRepr instanceof chunkReprCSS && file.inputFile.repr instanceof JSRepr) {
          continue;
        }

        file.entryPointChunkIndex = chunkIndex;
      }
    }

    // Determine the order of JS files (and parts) within the chunk ahead of time
    for (const chunk of sortedChunks) {
      const chunkRepr = chunk.chunkRepr;
      if (chunkRepr instanceof chunkReprJS) {
        const $d218 = c.findImportedPartsInJSOrder(chunk);
        const js = $d218[0], jsParts = $d218[1];
        chunkRepr.filesInChunkInOrder = js;
        chunkRepr.partsInChunkInOrder = jsParts;
      }
    }

    // Assign general information to each chunk
    for (let chunkIndex = 0; chunkIndex < sortedChunks.length; chunkIndex++) {
      const chunk = sortedChunks[chunkIndex];

      // Assign a unique key to each chunk. This key encodes the index directly so
      // we can easily recover it later without needing to look it up in a map. The
      // last 8 numbers of the key are the chunk index.
      chunk.uniqueKey = c.uniqueKeyPrefix + "C" + String(chunkIndex).padStart(8, "0");

      // JS-only: the transform API has no file system and never exposes the
      // output paths (see generateChunksInParallel)
      if (c.fs === null) continue;

      // Determine the standard file extension
      const stdExt = chunk.chunkRepr instanceof chunkReprCSS ? c.options.outputExtensionCSS : c.options.outputExtensionJS;

      // Compute the template substitutions
      let dir, base, ext;
      let template;
      if (chunk.isEntryPoint) {
        // Only use the entry path template for user-specified entry points
        const file = c.graph.files[chunk.sourceIndex];
        if (file.isUserSpecifiedEntryPoint()) {
          template = c.options.entryPathTemplate;
        } else {
          template = c.options.chunkPathTemplate;
        }

        if (c.options.absOutputFile !== "") {
          // If the output path was configured explicitly, use it verbatim
          dir = "/";
          base = c.fs.base(c.options.absOutputFile);
          const originalExt = c.fs.ext(base);
          base = base.slice(0, base.length - originalExt.length);

          // Use the extension from the explicit output file path. However, don't do
          // that if this is a CSS chunk but the entry point file is not CSS. In that
          // case use the standard extension. This happens when importing CSS into JS.
          if (file.inputFile.repr instanceof CSSRepr || stdExt !== c.options.outputExtensionCSS) {
            ext = originalExt;
          } else {
            ext = stdExt;
          }
        } else {
          // Otherwise, derive the output path from the input path
          [dir, base] = pathRelativeToOutbase(
            c.graph.files[chunk.sourceIndex].inputFile,
            c.options,
            c.fs,
            !file.isUserSpecifiedEntryPoint(),
            c.graph.entryPoints()[chunk.entryPointBit].outputPath,
          );
          ext = stdExt;
        }
      } else {
        dir = "/";
        base = "chunk";
        ext = stdExt;
        template = c.options.chunkPathTemplate;
      }

      // Determine the output path template
      const templateExt = ext.startsWith(".") ? ext.slice(1) : ext;
      template = template.concat([new PathTemplate(ext)]);
      chunk.finalTemplate = substituteTemplate(template, new PathPlaceholders(dir, base, null, templateExt));
    }

    c.chunks = sortedChunks;
  },

  shouldIncludePart(repr, part) {
    const c = this;

    // As an optimization, ignore parts containing a single import statement to
    // an internal non-wrapped file. These will be ignored anyway and it's a
    // performance hit to spin up a goroutine only to discover this later.
    if (part.stmts.length === 1) {
      const s = part.stmts[0].data;
      if (s.k === S_IMPORT) {
        const record = repr.ast.importRecords[s.importRecordIndex];
        if (record.sourceIndex >= 0 && c.graph.files[record.sourceIndex].inputFile.repr.meta.wrap === WrapNone) {
          return false;
        }
      }
    }
    return true;
  },

  // Returns [js []number, jsParts []partRange]
  findImportedPartsInJSOrder(chunk) {
    const c = this;
    const sorted = [];

    // Attach information to the files for use with sorting
    for (const sourceIndex of chunk.filesWithPartsInChunk) {
      const file = c.graph.files[sourceIndex];
      sorted.push(new chunkOrder(sourceIndex, file.distanceFromEntryPoint, c.graph.stableSourceIndices[sourceIndex]));
    }

    // Sort so files closest to an entry point come first. If two files are
    // equidistant to an entry point, then break the tie by sorting on the
    // stable source index derived from the DFS over all entry points.
    // (The keys are unique, so the unstable Go sort is deterministic.)
    sorted.sort((a, b) => (a.distance !== b.distance ? a.distance - b.distance : a.tieBreaker - b.tieBreaker));

    const visited = new Set();
    const js = [];
    let jsParts = [];
    let jsPartsPrefix = [];

    // Traverse the graph using this stable order and linearize the files with
    // dependencies before dependents
    const visit = (sourceIndex) => {
      if (visited.has(sourceIndex)) return;

      visited.add(sourceIndex);
      const file = c.graph.files[sourceIndex];

      const repr = file.inputFile.repr;
      if (repr instanceof JSRepr) {
        let isFileInThisChunk = chunk.entryBits.equals(file.entryBits);

        // Wrapped files can't be split because they are all inside the wrapper
        const canFileBeSplit = repr.meta.wrap === WrapNone;

        // Make sure the generated call to "__export(exports, ...)" comes first
        // before anything else in this file
        if (canFileBeSplit && isFileInThisChunk && repr.ast.parts[NSExportPartIndex].isLive) {
          jsParts = appendOrExtendPartRange(jsParts, sourceIndex, NSExportPartIndex);
        }

        const parts = repr.ast.parts;
        for (let partIndex = 0, partCount = parts.length; partIndex < partCount; partIndex++) {
          const part = parts[partIndex];
          const isPartInThisChunk = isFileInThisChunk && part.isLive;

          // Also traverse any files imported by this part
          for (let $i89 = 0, $a89 = part.importRecordIndices; $i89 < $a89.length; $i89++) {
            const importRecordIndex = $a89[$i89];
            const record = repr.ast.importRecords[importRecordIndex];
            if (record.sourceIndex >= 0 && (record.kind === ImportStmt || isPartInThisChunk)) {
              if (c.isExternalDynamicImport(record, sourceIndex)) {
                // Don't follow import() dependencies
                continue;
              }
              visit(record.sourceIndex);
            }
          }

          // Then include this part after the files it imports
          if (isPartInThisChunk) {
            isFileInThisChunk = true;
            if (canFileBeSplit && partIndex !== NSExportPartIndex && c.shouldIncludePart(repr, part)) {
              if (sourceIndex === RUNTIME_SOURCE_INDEX) {
                jsPartsPrefix = appendOrExtendPartRange(jsPartsPrefix, sourceIndex, partIndex);
              } else {
                jsParts = appendOrExtendPartRange(jsParts, sourceIndex, partIndex);
              }
            }
          }
        }

        if (isFileInThisChunk) {
          js.push(sourceIndex);

          // CommonJS files are all-or-nothing so all parts must be contiguous
          if (!canFileBeSplit) {
            jsPartsPrefix.push(new partRange(sourceIndex, 0, repr.ast.parts.length));
          }
        }
      }
    };

    // Always put the runtime code first before anything else
    visit(RUNTIME_SOURCE_INDEX);
    for (const data of sorted) {
      visit(data.sourceIndex);
    }
    jsParts = jsPartsPrefix.concat(jsParts);
    return [js, jsParts];
  },

  shouldRemoveImportExportStmt(sourceIndex, stmtList, loc, namespaceRef, importRecordIndex) {
    const c = this;
    const repr = c.graph.files[sourceIndex].inputFile.repr;
    const record = repr.ast.importRecords[importRecordIndex];

    // Is this an external import?
    if (!(record.sourceIndex >= 0)) {
      // Keep the "import" statement if "import" statements are supported
      if (formatKeepESMImportExportSyntax(c.options.outputFormat)) {
        return false;
      }

      // Otherwise, replace this statement with a call to "require()"
      stmtList.insideWrapperPrefix.push(
        new Stmt(
          new SLocal([new Decl(new Binding(new BIdentifier(namespaceRef), loc), new Expr(new ERequireString(importRecordIndex), record.range.loc))]),
          loc,
        ),
      );
      return true;
    }

    // We don't need a call to "require()" if this is a self-import inside a
    // CommonJS-style module, since we can just reference the exports directly.
    if (repr.ast.exportsKind === ExportsCommonJS && followSymbols(c.graph.symbols, namespaceRef) === repr.ast.exportsRef) {
      return true;
    }

    const otherFile = c.graph.files[record.sourceIndex];
    const otherRepr = otherFile.inputFile.repr;
    switch (otherRepr.meta.wrap) {
      case WrapNone:
        // Remove the statement entirely if this module is not wrapped
        break;

      case WrapCJS:
        // Replace the statement with a call to "require()"
        stmtList.insideWrapperPrefix.push(
          new Stmt(
            new SLocal([new Decl(new Binding(new BIdentifier(namespaceRef), loc), new Expr(new ERequireString(importRecordIndex), record.range.loc))]),
            loc,
          ),
        );
        break;

      case WrapESM: {
        // Ignore this file if it's not included in the bundle. This can happen for
        // wrapped ESM files but not for wrapped CommonJS files because we allow
        // tree shaking inside wrapped ESM files.
        if (!otherFile.isLive) break;

        // Replace the statement with a call to "init()"
        let value = new Expr(new ECall(new Expr(new EIdentifier(otherRepr.ast.wrapperRef), loc)), loc);
        if (otherRepr.meta.isAsyncOrHasAsyncDependency) {
          // This currently evaluates sibling dependencies in serial instead of in
          // parallel, which is incorrect. This should be changed to store a promise
          // and await all stored promises after all imports but before any code.
          value = new Expr(new EAwait(value), value.loc);
        }
        stmtList.insideWrapperPrefix.push(new Stmt(new SExpr(value), loc));
        break;
      }
    }

    return true;
  },

  convertStmtsForChunk(sourceIndex, stmtList, partStmts) {
    const c = this;
    const file = c.graph.files[sourceIndex];
    const shouldStripExports = c.options.mode !== ModePassThrough || !file.isEntryPoint();
    const repr = file.inputFile.repr;
    const shouldExtractESMStmtsForWrap = repr.meta.wrap !== WrapNone;

    // If this file is a CommonJS entry point, double-write re-exports to the
    // external CommonJS "module.exports" object in addition to our internal ESM
    // export namespace object. The difference between these two objects is that
    // our internal one must not have the "__esModule" marker while the external
    // one must have the "__esModule" marker. This is done because an ES module
    // importing itself should not see the "__esModule" marker but a CommonJS module
    // importing us should see the "__esModule" marker.
    let moduleExportsForReExportOrNil = null;
    if (c.options.outputFormat === FormatCommonJS && file.isEntryPoint()) {
      moduleExportsForReExportOrNil = new Expr(new EDot(new Expr(new EIdentifier(c.unboundModuleRef), 0), "exports"), 0);
    }

    for (let stmt of partStmts) {
      const s = stmt.data;
      switch (s.k) {
        case S_IMPORT:
          // "import * as ns from 'path'"
          // "import {foo} from 'path'"
          if (c.shouldRemoveImportExportStmt(sourceIndex, stmtList, stmt.loc, s.namespaceRef, s.importRecordIndex)) {
            continue;
          }

          if (jsFeatureHas(c.options.unsupportedJSFeatures, ArbitraryModuleNamespaceNames) && s.items !== null) {
            for (let i = 0; i < s.items.length; i++) {
              const item = s.items[i];
              c.maybeForbidArbitraryModuleNamespaceIdentifier("import", sourceIndex, item.aliasLoc, item.alias);
            }
          }

          // Make sure these don't end up in the wrapper closure
          if (shouldExtractESMStmtsForWrap) {
            stmtList.outsideWrapperPrefix.push(stmt);
            continue;
          }
          break;

        case S_EXPORT_STAR: {
          // "export * as ns from 'path'"
          if (s.alias !== null) {
            if (c.shouldRemoveImportExportStmt(sourceIndex, stmtList, stmt.loc, s.namespaceRef, s.importRecordIndex)) {
              continue;
            }

            if (jsFeatureHas(c.options.unsupportedJSFeatures, ArbitraryModuleNamespaceNames)) {
              c.maybeForbidArbitraryModuleNamespaceIdentifier("export", sourceIndex, s.alias.loc, s.alias.originalName);
            }

            if (shouldStripExports) {
              // Turn this statement into "import * as ns from 'path'"
              stmt = new Stmt(new SImport(null, null, s.alias.loc, s.namespaceRef, s.importRecordIndex), stmt.loc);
            }

            // Make sure these don't end up in the wrapper closure
            if (shouldExtractESMStmtsForWrap) {
              stmtList.outsideWrapperPrefix.push(stmt);
              continue;
            }
            break;
          }

          // "export * from 'path'"
          if (!shouldStripExports) {
            break;
          }
          const record = repr.ast.importRecords[s.importRecordIndex];

          // Is this export star evaluated at run time?
          if (!(record.sourceIndex >= 0) && formatKeepESMImportExportSyntax(c.options.outputFormat)) {
            if ((record.flags & CallsRunTimeReExportFn) !== 0) {
              // Turn this statement into "import * as ns from 'path'"
              stmt = new Stmt(new SImport(null, null, stmt.loc, s.namespaceRef, s.importRecordIndex), stmt.loc);

              // Prefix this module with "__reExport(exports, ns, module.exports)"
              const exportStarRef = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr.ast.moduleScope.members.get("__reExport").ref;
              const args = [new Expr(new EIdentifier(repr.ast.exportsRef), stmt.loc), new Expr(new EIdentifier(s.namespaceRef), stmt.loc)];
              if (moduleExportsForReExportOrNil !== null) {
                args.push(moduleExportsForReExportOrNil);
              }
              stmtList.insideWrapperPrefix.push(
                new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(exportStarRef), stmt.loc), args), stmt.loc)), stmt.loc),
              );

              // Make sure these don't end up in the wrapper closure
              if (shouldExtractESMStmtsForWrap) {
                stmtList.outsideWrapperPrefix.push(stmt);
                continue;
              }
            }
          } else {
            if (record.sourceIndex >= 0) {
              const otherRepr = c.graph.files[record.sourceIndex].inputFile.repr;
              if (otherRepr.meta.wrap === WrapESM) {
                stmtList.insideWrapperPrefix.push(
                  new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(otherRepr.ast.wrapperRef), stmt.loc)), stmt.loc)), stmt.loc),
                );
              }
            }

            if ((record.flags & CallsRunTimeReExportFn) !== 0) {
              let target = null;
              if (record.sourceIndex >= 0) {
                const otherRepr = c.graph.files[record.sourceIndex].inputFile.repr;
                if (otherRepr.ast.exportsKind === ExportsESMWithDynamicFallback) {
                  // Prefix this module with "__reExport(exports, otherExports, module.exports)"
                  target = new EIdentifier(otherRepr.ast.exportsRef);
                }
              }
              if (target === null) {
                // Prefix this module with "__reExport(exports, require(path), module.exports)"
                target = new ERequireString(s.importRecordIndex);
              }
              const exportStarRef = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr.ast.moduleScope.members.get("__reExport").ref;
              const args = [new Expr(new EIdentifier(repr.ast.exportsRef), stmt.loc), new Expr(target, record.range.loc)];
              if (moduleExportsForReExportOrNil !== null) {
                args.push(moduleExportsForReExportOrNil);
              }
              stmtList.insideWrapperPrefix.push(
                new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(exportStarRef), stmt.loc), args), stmt.loc)), stmt.loc),
              );
            }

            // Remove the export star statement
            continue;
          }
          break;
        }

        case S_EXPORT_FROM:
          // "export {foo} from 'path'"
          if (c.shouldRemoveImportExportStmt(sourceIndex, stmtList, stmt.loc, s.namespaceRef, s.importRecordIndex)) {
            continue;
          }

          if (jsFeatureHas(c.options.unsupportedJSFeatures, ArbitraryModuleNamespaceNames)) {
            for (let i = 0; i < s.items.length; i++) {
              const item = s.items[i];
              c.maybeForbidArbitraryModuleNamespaceIdentifier("import", sourceIndex, item.name.loc, item.originalName);
            }
          }

          if (shouldStripExports) {
            // Turn this statement into "import {foo} from 'path'"
            for (let i = 0; i < s.items.length; i++) {
              s.items[i].alias = s.items[i].originalName;
            }
            stmt = new Stmt(new SImport(null, s.items, null, s.namespaceRef, s.importRecordIndex, s.isSingleLine), stmt.loc);
          } else if (jsFeatureHas(c.options.unsupportedJSFeatures, ArbitraryModuleNamespaceNames)) {
            for (let i = 0; i < s.items.length; i++) {
              const item = s.items[i];
              if (item.aliasLoc !== item.name.loc) {
                c.maybeForbidArbitraryModuleNamespaceIdentifier("export", sourceIndex, item.aliasLoc, item.alias);
              }
            }
          }

          // Make sure these don't end up in the wrapper closure
          if (shouldExtractESMStmtsForWrap) {
            stmtList.outsideWrapperPrefix.push(stmt);
            continue;
          }
          break;

        case S_EXPORT_CLAUSE:
          if (shouldStripExports) {
            // Remove export statements entirely
            continue;
          }

          if (jsFeatureHas(c.options.unsupportedJSFeatures, ArbitraryModuleNamespaceNames)) {
            for (let i = 0; i < s.items.length; i++) {
              const item = s.items[i];
              c.maybeForbidArbitraryModuleNamespaceIdentifier("export", sourceIndex, item.aliasLoc, item.alias);
            }
          }

          // Make sure these don't end up in the wrapper closure
          if (shouldExtractESMStmtsForWrap) {
            stmtList.outsideWrapperPrefix.push(stmt);
            continue;
          }
          break;

        case S_FUNCTION:
          // Strip the "export" keyword while bundling
          if (shouldStripExports && s.isExport) {
            // Be careful to not modify the original statement
            stmt = new Stmt(new SFunction(s.fn, false), stmt.loc);
          }
          break;

        case S_CLASS:
          if (shouldStripExports && s.isExport) {
            // Be careful to not modify the original statement
            stmt = new Stmt(new SClass(s.class, false), stmt.loc);
          }
          break;

        case S_LOCAL:
          if (shouldStripExports && s.isExport) {
            // Be careful to not modify the original statement
            stmt = new Stmt(new SLocal(s.decls, s.kind, false, s.wasTSImportEquals), stmt.loc);
          }
          break;

        case S_EXPORT_DEFAULT:
          // If we're bundling, convert "export default" into a normal declaration
          if (shouldStripExports) {
            const s2 = s.value.data;
            switch (s2.k) {
              case S_EXPR:
                // "export default foo;" => "var default = foo;"
                stmt = new Stmt(
                  new SLocal([new Decl(new Binding(new BIdentifier(s.defaultName.ref), s.defaultName.loc), s2.value)]),
                  stmt.loc,
                );
                break;

              case S_FUNCTION: {
                // "export default function() {}" => "function default() {}"
                // "export default function foo() {}" => "function foo() {}"

                // Be careful to not modify the original statement
                const fn = s2.fn.clone();
                fn.name = s.defaultName;
                stmt = new Stmt(new SFunction(fn, false), s.value.loc);
                break;
              }

              case S_CLASS: {
                // "export default class {}" => "class default {}"
                // "export default class Foo {}" => "class Foo {}"

                // Be careful to not modify the original statement
                const class_ = s2.class.clone();
                class_.name = s.defaultName;
                stmt = new Stmt(new SClass(class_, false), s.value.loc);
                break;
              }

              default:
                throw new globalThis.Error("Internal error");
            }
          }
          break;
      }

      stmtList.insideWrapperSuffix.push(stmt);
    }
  },
});

// ---------------------------------------------------------------------------
// Code generation


// js_printer.Options with the fields that both linker call sites set. Fields
// that Go leaves at their zero value are set explicitly (nil maps become empty
// Maps, which behave identically for lookups).
// JS-only: step 5 of scanImportsAndExports for the cached runtime AST.
// createExportsForFile and computeDependenciesForFileParts only depend on the
// file itself for a file that imports nothing, has no export stars, is not
// wrapped and has no extra parts or overlay (the runtime), plus on
// "needsExportsVariable", which is part of the key. Their results (the sorted
// aliases, the namespace export part, and every part's symbol uses and
// dependencies) are memoized per shared AST and copied into later links.
// (Test hook: with __FAST_ESBUILD_VERIFY_RUNTIME_CACHE__ the step always runs
// and must produce what the memo says.)
const sharedStep5Memos = new WeakMap(); // shared namedExports -> snapshot

function sharedStep5IsMemoizable(repr) {
  const meta = repr.meta;
  const ast = repr.ast;
  return (
    meta.wrap === WrapNone &&
    meta.wrapperPartIndex < 0 &&
    !meta.forceIncludeExportsForEntryPoint &&
    meta.importsToBind.size === 0 &&
    meta.isProbablyTypeScriptType.size === 0 &&
    meta.topLevelSymbolToPartsOverlay === null &&
    ast.namedExports !== null &&
    meta.resolvedExports.size === ast.namedExports.size &&
    ast.exportStarImportRecords.length === 0 &&
    ast.namedImports.size === 0
  );
}

function snapshotSharedStep5(c, sourceIndex, repr) {

  const parts = repr.ast.parts;
  const symbolUses = new Array(parts.length);
  const deps = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    symbolUses[i] = parts[i].symbolUses;
    // (These maps are now shared with later links: writes must copy them)
    markSymbolUsesShared(parts[i].symbolUses);
    deps[i] = parts[i].dependencies.slice();
  }
  const nsArgs = c.lazyNSExportArgs.get(sourceIndex) ?? null;
  return {
    needsExportsVariable: repr.meta.needsExportsVariable,
    partsLength: parts.length,
    aliases: repr.meta.sortedAndFilteredExportAliases,
    nsArgs,
    part0DeclaredSymbols: nsArgs !== null ? parts[NSExportPartIndex].declaredSymbols : null,
    symbolUses,
    deps,
    usesExportsRef: repr.ast.usesExportsRef,
    needsExportSymbolFromRuntime: repr.meta.needsExportSymbolFromRuntime,
  };
}

// (false if the memo does not apply: then the step runs)
function restoreSharedStep5(c, sourceIndex, repr, memo): boolean {
  const parts = repr.ast.parts;
  if (memo.needsExportsVariable !== repr.meta.needsExportsVariable || memo.partsLength !== parts.length) {
    return false;
  }
  repr.meta.sortedAndFilteredExportAliases = memo.aliases;
  if (memo.nsArgs !== null) {
    // (See createExportsForFile)
    const part = new Part();
    part.stmts = EMPTY_ARRAY;
    part.declaredSymbols = memo.part0DeclaredSymbols;
    part.canBeRemovedIfUnused = true;
    part.forceTreeShaking = true;
    parts[NSExportPartIndex] = part;
    const args = memo.nsArgs;
    c.lazyNSExportStmts.set(sourceIndex, () => c.buildNSExportStmts(repr, args[0], args[1], args[2], args[3], args[4], args[5]));
    c.lazyNSExportArgs.set(sourceIndex, args);
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    part.symbolUses = memo.symbolUses[i];
    part.dependencies = memo.deps[i].slice();
  }
  if (memo.usesExportsRef) repr.ast.usesExportsRef = true;
  if (memo.needsExportSymbolFromRuntime) repr.meta.needsExportSymbolFromRuntime = true;
  return true;
}

function symbolUsesEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [ref, use] of a) {
    const other = b.get(ref);
    if (other === undefined || other.countEstimate !== use.countEstimate) return false;
  }
  return true;
}

function sharedStep5SnapshotsEqual(a, b) {
  if (
    a.needsExportsVariable !== b.needsExportsVariable ||
    a.partsLength !== b.partsLength ||
    a.usesExportsRef !== b.usesExportsRef ||
    a.needsExportSymbolFromRuntime !== b.needsExportSymbolFromRuntime ||
    a.aliases.join("\0") !== b.aliases.join("\0") ||
    (a.nsArgs === null) !== (b.nsArgs === null)
  ) {
    return false;
  }
  if (a.nsArgs !== null && JSON.stringify(a.nsArgs) !== JSON.stringify(b.nsArgs)) return false;
  if (a.part0DeclaredSymbols !== null && JSON.stringify(a.part0DeclaredSymbols) !== JSON.stringify(b.part0DeclaredSymbols)) return false;
  for (let i = 0; i < a.partsLength; i++) {
    if (!symbolUsesEqual(a.symbolUses[i], b.symbolUses[i])) return false;
    const da = a.deps[i];
    const db = b.deps[i];
    if (da.length !== db.length) return false;
    for (let j = 0; j < da.length; j++) {
      if (da[j].sourceIndex !== db[j].sourceIndex || da[j].partIndex !== db[j].partIndex) return false;
    }
  }
  return true;
}

// JS-only: the printed code of the runtime helpers (the live parts of the
// runtime file) is cached across transforms. The printer's output is a pure
// function of the statements it prints, the printer options, and the names
// the renamer returns for the symbols it prints. For the shared runtime AST
// the statements only depend on which parts are live and on the options (the
// runtime is never wrapped, never an entry point and imports nothing), so an
// entry is keyed by those and remembers every (ref, name) pair the renamer
// returned while printing. It is only reused if the renamer returns the same
// names now: user code can make runtime names collide (e.g. "__defProp2", or
// a nested "key2" next to a top-level "key"). The key includes every option
// that the runtime AST depends on (the unsupported features, MinifySyntax and
// MinifyIdentifiers: see bundler.runtimeCache), so the symbol flags the
// printer reads under MinifySyntax (IsEmptyFunction, ...) are fixed per key.
const runtimePrintCache = new WeakMap(); // runtime Source -> Map<string, entry>

class recordingRenamer {
  declare r: any;
  declare names: Map<any, any>;
  constructor(r) {
    this.r = r;
    this.names = new Map(); // ref -> name
  }
  nameForSymbol(ref) {
    const name = this.r.nameForSymbol(ref);
    this.names.set(ref, name);
    return name;
  }
}

function clonePrintResult(pr) {
  let chunk = pr.sourceMapChunk;
  if (chunk !== null) {
    chunk = new SourceMapChunk(
      new MappingsBuffer(chunk.buffer.data, chunk.buffer.firstNameOffset),
      chunk.quotedNames === null ? null : chunk.quotedNames.slice(),
      chunk.endState.clone(),
      chunk.finalGeneratedColumn,
      chunk.shouldIgnore,
    );
  }
  return new PrintResult(pr.js, pr.extractedLegalComments.slice(), pr.jsonMetadataImports.slice(), chunk);
}

function printRuntimeCached(c, file, partRange, tree, r, o) {
  const repr = file.inputFile.repr;
  // (Anything unusual is printed without the cache)
  if (
    o.indent > 7 ||
    o.outputFormat > 7 ||
    o.legalComments > 7 ||
    o.sourceMap > 7 ||
    c.options.mode > 7 ||
    repr.meta.wrap !== WrapNone ||
    repr.meta.wrapperPartIndex >= 0
  ) {
    return printJS(tree, c.graph.symbols, r, o);
  }
  const optionsKey =
    o.indent |
    (o.outputFormat << 3) |
    (o.legalComments << 6) |
    (o.sourceMap << 9) |
    (c.options.mode << 12) |
    (o.asciiOnly ? 1 << 15 : 0) |
    (o.addSourceMappings ? 1 << 16 : 0) |
    (o.minifyWhitespace ? 1 << 17 : 0) |
    (o.minifySyntax ? 1 << 18 : 0) |
    (o.minifyIdentifiers ? 1 << 19 : 0);
  // (Also part of the key: the line limit and the unsupported features)
  const lineLimit = o.lineLimit;
  const features = o.unsupportedFeatures;
  const parts = repr.ast.parts;
  const begin = partRange.partIndexBegin;
  const end = partRange.partIndexEnd;

  let perSource = runtimePrintCache.get(file.inputFile.source);
  if (perSource === undefined) {
    perSource = [];
    runtimePrintCache.set(file.inputFile.source, perSource);
  }
  entries: for (let e = 0; e < perSource.length; e++) {
    const entry = perSource[e];
    if (
      entry.optionsKey !== optionsKey ||
      entry.lineLimit !== lineLimit ||
      !jsFeatureEqual(entry.features, features) ||
      entry.begin !== begin ||
      entry.end !== end
    ) {
      continue;
    }
    const live = entry.live;
    for (let i = begin; i < end; i++) {
      if (parts[i].isLive !== live[i - begin]) continue entries;
    }
    const refs = entry.refs;
    const names = entry.names;
    for (let i = 0; i < refs.length; i++) {
      if (r.nameForSymbol(refs[i]) !== names[i]) continue entries;
    }
    const cached = clonePrintResult(entry.result);
    // (Test hook: check the cached result against a fresh print)
    if (globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__) {
      const fresh = printJS(tree, c.graph.symbols, r, o);
      if (fresh.js !== cached.js || JSON.stringify(fresh.sourceMapChunk) !== JSON.stringify(cached.sourceMapChunk)) {
        throw new globalThis.Error("@r1ck404/fast-esbuild-wasm: runtime print cache mismatch");
      }
    }
    return cached;
  }

  const recorder = new recordingRenamer(r);
  const result = printJS(tree, c.graph.symbols, recorder, o);
  const live = [];
  for (let i = begin; i < end; i++) live.push(parts[i].isLive);
  if (perSource.length >= 32) perSource.length = 0;
  perSource.push({
    optionsKey,
    lineLimit,
    features,
    begin,
    end,
    live,
    refs: [...recorder.names.keys()],
    names: [...recorder.names.values()],
    result: clonePrintResult(result),
  });
  return result;
}

function makePrinterOptions(c, indent) {
  const o = new PrinterOptions();
  o.requireOrImportMetaForSource = null;
  o.tsEnums = new Map();
  o.constValues = new Map();
  o.mangledProps = c.mangledProps;
  o.inputSourceMap = null;
  o.lineOffsetTables = null;
  o.toCommonJSRef = 0; // Go zero value (ast.Ref{})
  o.toESMRef = 0;
  o.runtimeRequireRef = 0;
  o.unsupportedFeatures = c.options.unsupportedJSFeatures;
  o.indent = indent;
  o.lineLimit = c.options.lineLimit;
  o.outputFormat = c.options.outputFormat;
  o.minifyWhitespace = c.options.minifyWhitespace;
  o.minifyIdentifiers = c.options.minifyIdentifiers;
  o.minifySyntax = c.options.minifySyntax;
  o.asciiOnly = c.options.asciiOnly;
  o.legalComments = c.options.legalComments;
  o.sourceMap = SourceMapNone;
  o.addSourceMappings = false;
  o.needsMetafile = false;
  o.metafileFormat = 0;
  return o;
}

Object.assign(linkerContext.prototype, {
  requireOrImportMetaForSource(sourceIndex) {
    const c = this;
    const repr = c.graph.files[sourceIndex].inputFile.repr;
    const meta = new RequireOrImportMeta();
    meta.wrapperRef = repr.ast.wrapperRef;
    meta.isWrapperAsync = repr.meta.isAsyncOrHasAsyncDependency;
    if (repr.meta.wrap === WrapESM) {
      meta.exportsRef = repr.ast.exportsRef;
    } else {
      meta.exportsRef = InvalidRef;
    }
    return meta;
  },

  generateCodeForFileInChunkJS(r, partRange, toCommonJSRef, toESMRef, runtimeRequireRef, result, dataForSourceMaps) {
    const c = this;
    const file = c.graph.files[partRange.sourceIndex];
    const repr = file.inputFile.repr;
    const nsExportPartIndex = NSExportPartIndex;
    let needsWrapper = false;
    const stmtList_ = new stmtList();

    // The top-level directive must come first (the non-wrapped case is handled
    // by the chunk generation code, although only for the entry point)
    if (repr.meta.wrap !== WrapNone && !file.isEntryPoint()) {
      for (let $i90 = 0, $a90 = repr.ast.directives; $i90 < $a90.length; $i90++) {
        const directive = $a90[$i90];
        stmtList_.insideWrapperPrefix.push(new Stmt(new SDirective(directive), 0));
      }
    }

    // Make sure the generated call to "__export(exports, ...)" comes first
    // before anything else.
    if (
      nsExportPartIndex >= partRange.partIndexBegin &&
      nsExportPartIndex < partRange.partIndexEnd &&
      repr.ast.parts[nsExportPartIndex].isLive
    ) {
      c.convertStmtsForChunk(partRange.sourceIndex, stmtList_, c.nsExportStmtsForPart(partRange.sourceIndex, repr.ast.parts[nsExportPartIndex]));

      // Move everything to the prefix list
      if (repr.meta.wrap === WrapESM) {
        for (const s of stmtList_.insideWrapperSuffix) stmtList_.outsideWrapperPrefix.push(s);
      } else {
        for (const s of stmtList_.insideWrapperSuffix) stmtList_.insideWrapperPrefix.push(s);
      }
      stmtList_.insideWrapperSuffix = [];
    }

    let partIndexForLazyDefaultExport = -1; // ast.Index32
    if (repr.ast.hasLazyExport) {
      const defaultExport = repr.meta.resolvedExports.get("default");
      if (defaultExport !== undefined) {
        partIndexForLazyDefaultExport = repr.topLevelSymbolToParts(defaultExport.ref)[0];
      }
    }

    // Add all other parts in this chunk
    for (let partIndex = partRange.partIndexBegin; partIndex < partRange.partIndexEnd; partIndex++) {
      const part = repr.ast.parts[partIndex];
      if (!part.isLive) {
        // Skip the part if it's not in this chunk
        continue;
      }

      if (partIndex === nsExportPartIndex) {
        // Skip the generated call to "__export()" that was extracted above
        continue;
      }

      // Mark if we hit the dummy part representing the wrapper
      if (partIndex === repr.meta.wrapperPartIndex) {
        needsWrapper = true;
        continue;
      }

      let stmts = part.stmts;

      // If this could be a JSON file that exports a top-level object literal, go
      // over the non-default top-level properties that ended up being imported
      // and substitute references to them into the main top-level object literal.
      // So this JSON file:
      //
      //   {
      //     "foo": [1, 2, 3],
      //     "bar": [4, 5, 6],
      //   }
      //
      // is initially compiled into this:
      //
      //   export var foo = [1, 2, 3];
      //   export var bar = [4, 5, 6];
      //   export default {
      //     foo: [1, 2, 3],
      //     bar: [4, 5, 6],
      //   };
      //
      // But we turn it into this if both "foo" and "default" are imported:
      //
      //   export var foo = [1, 2, 3];
      //   export default {
      //     foo,
      //     bar: [4, 5, 6],
      //   };
      //
      if (partIndexForLazyDefaultExport >= 0 && partIndex === partIndexForLazyDefaultExport) {
        const stmt = stmts[0];
        const defaultExport = stmt.data;
        const defaultExpr = defaultExport.value.data;

        // Be careful: the top-level value in a JSON file is not necessarily an object
        if (defaultExpr.value.data.k === E_OBJECT) {
          const object = defaultExpr.value.data;
          const objectClone = new EObject(object.properties.slice(), object.commaAfterSpread, object.closeBraceLoc, object.isSingleLine, object.isParenthesized);

          // If any top-level properties ended up being imported directly, change
          // the property to just reference the corresponding variable instead
          for (let i = 0; i < object.properties.length; i++) {
            const property = object.properties[i];
            if (property.key.data.k === E_STRING) {
              const name = property.key.data.value;
              if (name !== "default") {
                const export_ = repr.meta.resolvedExports.get(name);
                if (export_ !== undefined) {
                  const part2 = repr.ast.parts[repr.topLevelSymbolToParts(export_.ref)[0]];
                  if (part2.isLive) {
                    const ref = part2.stmts[0].data.decls[0].binding.data.ref;
                    const propertyClone = objectClone.properties[i].clone();
                    propertyClone.valueOrNil = new Expr(new EIdentifier(ref), property.key.loc);
                    objectClone.properties[i] = propertyClone;
                  }
                }
              }
            }
          }

          // Avoid mutating the original AST
          const defaultExprClone = new SExpr(new Expr(objectClone, defaultExpr.value.loc), defaultExpr.isFromClassOrFnThatCanBeRemovedIfUnused);
          const defaultExportClone = new SExportDefault(new Stmt(defaultExprClone, defaultExport.value.loc), defaultExport.defaultName);
          stmts = [new Stmt(defaultExportClone, stmt.loc)];
        }
      }

      c.convertStmtsForChunk(partRange.sourceIndex, stmtList_, stmts);
    }

    // Hoist all import statements before any normal statements. ES6 imports
    // are different than CommonJS imports. All modules imported via ES6 import
    // statements are evaluated before the module doing the importing is
    // evaluated (well, except for cyclic import scenarios). We need to preserve
    // these semantics even when modules imported via ES6 import statements end
    // up being CommonJS modules.
    let stmts = stmtList_.insideWrapperSuffix;
    if (stmtList_.insideWrapperPrefix.length > 0) {
      stmts = stmtList_.insideWrapperPrefix.concat(stmts);
    }
    if (c.options.minifySyntax) {
      stmts = mergeAdjacentLocalStmts(stmts);
    }

    // Optionally wrap all statements in a closure
    if (needsWrapper) {
      switch (repr.meta.wrap) {
        case WrapCJS: {
          // Only include the arguments that are actually used
          const args = [];
          if (repr.ast.usesExportsRef || repr.ast.usesModuleRef) {
            args.push(new Arg(new Binding(new BIdentifier(repr.ast.exportsRef), 0)));
            if (repr.ast.usesModuleRef) {
              args.push(new Arg(new Binding(new BIdentifier(repr.ast.moduleRef), 0)));
            }
          }

          let cjsArgs;
          if (c.options.profilerNames) {
            // "__commonJS({ 'file.js'(exports, module) { ... } })"
            let kind = PropertyField;
            if (!jsFeatureHas(c.options.unsupportedJSFeatures, ObjectExtensions)) {
              kind = PropertyMethod;
            }
            const key = new Expr(new EString(file.inputFile.source.prettyPaths.select(c.options.codePathStyle || 0)), 0);
            const value = new Expr(new EFunction(new Fn(null, args, new FnBody(new SBlock(stmts)))), 0);
            cjsArgs = [new Expr(new EObject([new Property(null, key, value, null, [], 0, 0, kind)]), 0)];
          } else if (jsFeatureHas(c.options.unsupportedJSFeatures, Arrow)) {
            // "__commonJS(function (exports, module) { ... })"
            cjsArgs = [new Expr(new EFunction(new Fn(null, args, new FnBody(new SBlock(stmts)))), 0)];
          } else {
            // "__commonJS((exports, module) => { ... })"
            cjsArgs = [new Expr(new EArrow(args, new FnBody(new SBlock(stmts))), 0)];
          }
          const value = new Expr(new ECall(new Expr(new EIdentifier(c.cjsRuntimeRef), 0), cjsArgs), 0);

          // "var require_foo = __commonJS(...);"
          stmts = stmtList_.outsideWrapperPrefix.concat([
            new Stmt(new SLocal([new Decl(new Binding(new BIdentifier(repr.ast.wrapperRef), 0), value)]), 0),
          ]);
          break;
        }

        case WrapESM: {
          // The wrapper only needs to be "async" if there is a transitive async
          // dependency. For correctness, we must not use "async" if the module
          // isn't async because then calling "require()" on that module would
          // swallow any exceptions thrown during module initialization.
          const isAsync = repr.meta.isAsyncOrHasAsyncDependency;

          // Hoist all top-level "var" and "function" declarations out of the closure
          let decls = [];
          let end = 0;
          const wrapIdentifier = (loc, ref) => {
            decls.push(new Decl(new Binding(new BIdentifier(ref), loc), null));
            return new Expr(new EIdentifier(ref), loc);
          };
          for (let stmt of stmts) {
            const s = stmt.data;
            if (s.k === S_LOCAL) {
              // Convert the declarations to assignments
              let value = null;
              for (let $i91 = 0, $a91 = s.decls; $i91 < $a91.length; $i91++) {
                const decl = $a91[$i91];
                const binding = convertBindingToExpr(decl.binding, wrapIdentifier);
                if (decl.valueOrNil !== null) {
                  value = joinWithComma(value, assign(binding, decl.valueOrNil));
                }
              }
              if (value === null) {
                continue;
              }
              stmt = new Stmt(new SExpr(value), stmt.loc);
            } else if (s.k === S_FUNCTION) {
              stmtList_.outsideWrapperPrefix.push(stmt);
              continue;
            }

            stmts[end] = stmt;
            end++;
          }
          stmts.length = end;

          let esmArgs;
          if (c.options.profilerNames) {
            // "__esm({ 'file.js'() { ... } })"
            let kind = PropertyField;
            if (!jsFeatureHas(c.options.unsupportedJSFeatures, ObjectExtensions)) {
              kind = PropertyMethod;
            }
            const key = new Expr(new EString(file.inputFile.source.prettyPaths.select(c.options.codePathStyle || 0)), 0);
            const value = new Expr(new EFunction(new Fn(null, [], new FnBody(new SBlock(stmts)), InvalidRef, 0, isAsync)), 0);
            esmArgs = [new Expr(new EObject([new Property(null, key, value, null, [], 0, 0, kind)]), 0)];
          } else if (jsFeatureHas(c.options.unsupportedJSFeatures, Arrow)) {
            // "__esm(function () { ... })"
            esmArgs = [new Expr(new EFunction(new Fn(null, [], new FnBody(new SBlock(stmts)), InvalidRef, 0, isAsync)), 0)];
          } else {
            // "__esm(() => { ... })"
            esmArgs = [new Expr(new EArrow([], new FnBody(new SBlock(stmts)), isAsync), 0)];
          }
          const value = new Expr(new ECall(new Expr(new EIdentifier(c.esmRuntimeRef), 0), esmArgs), 0);

          // "var foo, bar;"
          if (!c.options.minifySyntax && decls.length > 0) {
            stmtList_.outsideWrapperPrefix.push(new Stmt(new SLocal(decls), 0));
            decls = [];
          }

          // "var init_foo = __esm(...);"
          decls.push(new Decl(new Binding(new BIdentifier(repr.ast.wrapperRef), 0), value));
          stmts = stmtList_.outsideWrapperPrefix.concat([new Stmt(new SLocal(decls), 0)]);
          break;
        }
      }
    }

    // Only generate a source map if needed
    let addSourceMappings = false;
    let inputSourceMap = null;
    let lineOffsetTables = null;
    if (loaderCanHaveSourceMap(file.inputFile.loader) && c.options.sourceMap !== SourceMapNone) {
      addSourceMappings = true;
      inputSourceMap = file.inputFile.inputSourceMap;
      lineOffsetTables = dataForSourceMaps[partRange.sourceIndex].lineOffsetTables;
    }

    // Indent the file if everything is wrapped in an IIFE
    let indent = 0;
    if (c.options.outputFormat === FormatIIFE) {
      indent++;
    }

    // Convert the AST to JavaScript code
    const printOptions = makePrinterOptions(c, indent);
    printOptions.toCommonJSRef = toCommonJSRef;
    printOptions.toESMRef = toESMRef;
    printOptions.runtimeRequireRef = runtimeRequireRef;
    printOptions.tsEnums = c.graph.tsEnums;
    printOptions.constValues = c.graph.constValues;
    printOptions.sourceMap = c.options.sourceMap;
    printOptions.addSourceMappings = addSourceMappings;
    printOptions.inputSourceMap = inputSourceMap;
    printOptions.lineOffsetTables = lineOffsetTables;
    printOptions.requireOrImportMetaForSource = c.requireOrImportMetaForSourceFn;
    printOptions.needsMetafile = c.options.needsMetafile;
    printOptions.metafileFormat = c.options.metafileFormat;
    const tree = cloneAST(repr.ast);
    tree.directives = []; // This is handled elsewhere
    const treePart = new Part();
    treePart.stmts = stmts;
    tree.parts = [treePart];
    if (partRange.sourceIndex === RUNTIME_SOURCE_INDEX && file.inputFile.astIsShared) {
      result.setPrintResult(printRuntimeCached(c, file, partRange, tree, r, printOptions));
    } else {
      result.setPrintResult(printJS(tree, c.graph.symbols, r, printOptions));
    }
    result.sourceIndex = partRange.sourceIndex;

    if (file.inputFile.loader === LoaderFile) {
      if (result.jsonMetadataImports === null) result.jsonMetadataImports = [];
      else result.jsonMetadataImports = result.jsonMetadataImports.slice();
      result.jsonMetadataImports.push(
        metafileFormatMaybeRemoveWhitespace(c.options.metafileFormat, '\n        {\n          "path": ') +
          quoteForJSON(file.inputFile.uniqueKeyForAdditionalFile, c.options.asciiOnly) +
          metafileFormatMaybeRemoveWhitespace(c.options.metafileFormat, ',\n          "kind": "file-loader"\n        }'),
      );
    }
  },

  generateEntryPointTailJS(r, toCommonJSRef, toESMRef, sourceIndex) {
    const c = this;
    const result = new compileResultJS();
    const file = c.graph.files[sourceIndex];
    const repr = file.inputFile.repr;
    const stmts = [];

    switch (c.options.outputFormat) {
      case FormatPreserve:
        if (repr.meta.wrap !== WrapNone) {
          // "require_foo();"
          // "init_foo();"
          stmts.push(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
        }
        break;

      case FormatIIFE:
        if (repr.meta.wrap === WrapCJS) {
          if (c.options.globalName.length > 0) {
            // "return require_foo();"
            stmts.push(new Stmt(new SReturn(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
          } else {
            // "require_foo();"
            stmts.push(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
          }
        } else {
          if (repr.meta.wrap === WrapESM) {
            // "init_foo();"
            stmts.push(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
          }

          if (repr.meta.forceIncludeExportsForEntryPoint) {
            // "return __toCommonJS(exports);"
            stmts.push(
              new Stmt(
                new SReturn(
                  new Expr(new ECall(new Expr(new EIdentifier(toCommonJSRef), 0), [new Expr(new EIdentifier(repr.ast.exportsRef), 0)]), 0),
                ),
                0,
              ),
            );
          }
        }
        break;

      case FormatCommonJS:
        if (repr.meta.wrap === WrapCJS) {
          // "module.exports = require_foo();"
          stmts.push(
            assignStmt(
              new Expr(new EDot(new Expr(new EIdentifier(c.unboundModuleRef), 0), "exports"), 0),
              new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0),
            ),
          );
        } else {
          if (repr.meta.wrap === WrapESM) {
            // "init_foo();"
            stmts.push(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
          }
        }

        // If we are generating CommonJS for node, encode the known export names in
        // a form that node can understand them. This relies on the specific behavior
        // of this parser, which the node project uses to detect named exports in
        // CommonJS files: https://github.com/guybedford/cjs-module-lexer. Think of
        // this code as an annotation for that parser.
        if (c.options.platform === PlatformNode) {
          // Add a comment since otherwise people will surely wonder what this is.
          // This annotation means you can do this and have it work:
          //
          //   import { name } from './file-from-esbuild.cjs'
          //
          // when "file-from-esbuild.cjs" looks like this:
          //
          //   __export(exports, { name: () => name });
          //   0 && (module.exports = {name});
          //
          // The maintainer of "cjs-module-lexer" is receptive to adding esbuild-
          // friendly patterns to this library. However, this library has already
          // shipped in node and using existing patterns instead of defining new
          // patterns is maximally compatible.
          //
          // An alternative to doing this could be to use "Object.defineProperties"
          // instead of "__export" but support for that would need to be added to
          // "cjs-module-lexer" and then we would need to be ok with not supporting
          // older versions of node that don't have that newly-added support.

          // "{a, b, if: null}"
          const moduleExports = [];
          for (const export_ of repr.meta.sortedAndFilteredExportAliases) {
            if (export_ === "default") {
              // In node the default export is always "module.exports" regardless of
              // what the annotation says. So don't bother generating "default".
              continue;
            }

            // "{if: null}"
            let valueOrNil = null;
            if (Keywords.has(export_) || !isIdentifier(export_)) {
              // Make sure keywords don't cause a syntax error. This has to map to
              // "null" instead of something shorter like "0" because the library
              // "cjs-module-lexer" only supports identifiers in this position, and
              // it thinks "null" is an identifier.
              valueOrNil = new Expr(ENullShared, 0);
            }

            moduleExports.push(new Property(null, new Expr(new EString(export_), 0), valueOrNil));
          }

          // Add annotations for re-exports: "{...require('./foo')}"
          for (let $i92 = 0, $a92 = repr.ast.exportStarImportRecords; $i92 < $a92.length; $i92++) {
            const importRecordIndex = $a92[$i92];
            const record = repr.ast.importRecords[importRecordIndex];
            if (!(record.sourceIndex >= 0)) {
              moduleExports.push(new Property(null, null, new Expr(new ERequireString(importRecordIndex), 0), null, [], 0, 0, PropertySpread));
            }
          }

          if (moduleExports.length > 0) {
            // "0 && (module.exports = {a, b, if: null});"
            const expr = new Expr(
              new EBinary(
                new Expr(new ENumber(0), 0),
                assign(new Expr(new EDot(new Expr(new EIdentifier(c.unboundModuleRef), 0), "exports"), 0), new Expr(new EObject(moduleExports), 0)),
                BinOpLogicalAnd,
              ),
              0,
            );

            if (!c.options.minifyWhitespace) {
              stmts.push(new Stmt(new SComment("// Annotate the CommonJS export names for ESM import in node:"), 0));
            }

            stmts.push(new Stmt(new SExpr(expr), 0));
          }
        }
        break;

      case FormatESModule:
        if (repr.meta.wrap === WrapCJS) {
          // "export default require_foo();"
          stmts.push(
            new Stmt(new SExportDefault(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0), new LocRef(0, 0)), 0),
          );
        } else {
          if (repr.meta.wrap === WrapESM) {
            if (repr.meta.isAsyncOrHasAsyncDependency) {
              // "await init_foo();"
              stmts.push(
                new Stmt(new SExpr(new Expr(new EAwait(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0)), 0),
              );
            } else {
              // "init_foo();"
              stmts.push(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
            }
          }

          const aliases = repr.meta.sortedAndFilteredExportAliases;
          if (aliases.length > 0) {
            // If the output format is ES6 modules and we're an entry point, generate an
            // ES6 export statement containing all exports. Except don't do that if this
            // entry point is a CommonJS-style module, since that would generate an ES6
            // export statement that's not top-level. Instead, we will export the CommonJS
            // exports as a default export later on.
            const items = [];

            for (let i = 0; i < aliases.length; i++) {
              const alias = aliases[i];
              const export_ = repr.meta.resolvedExports.get(alias);
              let exportRef = export_.ref;

              // If this is an export of an import, reference the symbol that the import
              // was eventually resolved to. We need to do this because imports have
              // already been resolved by this point, so we can't generate a new import
              // and have that be resolved later.
              const importData = c.graph.files[export_.sourceIndex].inputFile.repr.meta.importsToBind.get(export_.ref);
              if (importData !== undefined) {
                exportRef = importData.ref;
              }

              // Exports of imports need EImportIdentifier in case they need to be re-
              // written to a property access later on
              if (c.graph.symbols.get(exportRef).namespaceAlias !== null) {
                // Create both a local variable and an export clause for that variable.
                // The local variable is initialized with the initial value of the
                // export. This isn't fully correct because it's a "dead" binding and
                // doesn't update with the "live" value as it changes. But ES6 modules
                // don't have any syntax for bare named getter functions so this is the
                // best we can do.
                const tempRef = repr.meta.cjsExportCopies[i];
                stmts.push(
                  new Stmt(new SLocal([new Decl(new Binding(new BIdentifier(tempRef), 0), new Expr(new EImportIdentifier(exportRef), 0))]), 0),
                );
                items.push(new ClauseItem(alias, "", 0, new LocRef(0, tempRef)));
              } else {
                // Local identifiers can be exported using an export clause. This is done
                // this way instead of leaving the "export" keyword on the local declaration
                // itself both because it lets the local identifier be minified and because
                // it works transparently for re-exports across files.
                items.push(new ClauseItem(alias, "", 0, new LocRef(0, exportRef)));
              }
            }

            stmts.push(new Stmt(new SExportClause(items), 0));
          }
        }
        break;
    }

    if (stmts.length === 0) {
      return result;
    }

    const tree = cloneAST(repr.ast);
    tree.directives = [];
    const treePart = new Part();
    treePart.stmts = stmts;
    tree.parts = [treePart];

    // Indent the file if everything is wrapped in an IIFE
    let indent = 0;
    if (c.options.outputFormat === FormatIIFE) {
      indent++;
    }

    // Convert the AST to JavaScript code
    const printOptions = makePrinterOptions(c, indent);
    printOptions.toCommonJSRef = toCommonJSRef;
    printOptions.toESMRef = toESMRef;
    printOptions.runtimeRequireRef = 0; // Go zero value (ast.Ref{})
    printOptions.requireOrImportMetaForSource = c.requireOrImportMetaForSourceFn;
    result.setPrintResult(printJS(tree, c.graph.symbols, r, printOptions));
    return result;
  },

  renameSymbolsInChunk(chunk, filesInOrder, timer: Timer | null) {
    if (timer === null) return this.renameSymbolsInChunkImpl(chunk, filesInOrder, timer);
    const label = this.options.minifyIdentifiers ? "Minify symbols" : "Rename symbols";
    timer?.begin(label);
    try {
      return this.renameSymbolsInChunkImpl(chunk, filesInOrder, timer);
    } finally {
      timer?.end(label);
    }
  },

  renameSymbolsInChunkImpl(chunk, filesInOrder, timer: Timer | null) {
    const c = this;

    // Determine the reserved names (e.g. can't generate the name "if")
    timer?.begin("Compute reserved names");
    const moduleScopes = new Array(filesInOrder.length);
    for (let i = 0; i < filesInOrder.length; i++) {
      moduleScopes[i] = c.graph.files[filesInOrder[i]].inputFile.repr.ast.moduleScope;
    }
    const reservedNames = computeReservedNames(moduleScopes, c.graph.symbols);

    // Node contains code that scans CommonJS modules in an attempt to statically
    // detect the set of export names that a module will use. However, it doesn't
    // do any scope analysis so it can be fooled by local variables with the same
    // name as the CommonJS module-scope variables "exports" and "module". Avoid
    // using these names in this case even if there is not a risk of a name
    // collision because there is still a risk of node incorrectly detecting
    // something in a nested scope as a top-level export. Here's a case where
    // this happened: https://github.com/evanw/esbuild/issues/3544
    if (c.options.outputFormat === FormatCommonJS && c.options.platform === PlatformNode) {
      reservedNames.set("exports", 1);
      reservedNames.set("module", 1);
    }

    // These are used to implement bundling, and need to be free for use
    if (c.options.mode !== ModePassThrough) {
      reservedNames.set("require", 1);
      reservedNames.set("Promise", 1);
    }
    timer?.end("Compute reserved names");

    // Make sure imports get a chance to be renamed too
    const sortedImportsFromOtherChunks = [];
    if (chunk.chunkRepr.importsFromOtherChunks !== null) {
      for (const imports of chunk.chunkRepr.importsFromOtherChunks.values()) {
        for (const item of imports) {
          sortedImportsFromOtherChunks.push({ stableSourceIndex: c.graph.stableSourceIndices[refSource(item.ref)], ref: item.ref });
        }
      }
      // (the refs are unique: an unstable sort is fine)
      sortedImportsFromOtherChunks.sort((a, b) => (a.stableSourceIndex !== b.stableSourceIndex ? a.stableSourceIndex - b.stableSourceIndex : refInner(a.ref) - refInner(b.ref)));
    }

    // Minification uses frequency analysis to give shorter names to more frequent symbols
    if (c.options.minifyIdentifiers) {
      // Determine the first top-level slot (i.e. not in a nested scope)
      const firstTopLevelSlots = newSlotCounts();
      for (let i = 0; i < filesInOrder.length; i++) {
        slotCountsUnionMax(firstTopLevelSlots, c.graph.files[filesInOrder[i]].inputFile.repr.ast.nestedScopeSlotCounts);
      }
      const r = newMinifyRenamer(c.graph.symbols, firstTopLevelSlots, reservedNames);

      // Accumulate nested symbol usage counts
      // (Go does this for each file in parallel; the nested slot counts are
      // sums, so the order does not matter)
      timer?.begin("Accumulate symbol counts");
      timer?.begin("Parallel phase");
      const allTopLevelSymbols = new Array(filesInOrder.length);
      const stableSourceIndices = c.graph.stableSourceIndices;
      const freq = newCharFreq();
      for (let i = 0; i < filesInOrder.length; i++) {
        const repr = c.graph.files[filesInOrder[i]].inputFile.repr;

        // Do this outside of the goroutine because it's not atomic
        if (repr.ast.charFreq !== null) {
          charFreqInclude(freq, repr.ast.charFreq);
        }

        const topLevelSymbols = [];
        if (repr.ast.usesExportsRef) {
          r.accumulateSymbolCount(topLevelSymbols, repr.ast.exportsRef, 1, stableSourceIndices);
        }
        if (repr.ast.usesModuleRef) {
          r.accumulateSymbolCount(topLevelSymbols, repr.ast.moduleRef, 1, stableSourceIndices);
        }

        const parts = repr.ast.parts;
        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
          const part = parts[partIndex];
          if (!part.isLive) {
            // Skip the part if it's not in this chunk
            continue;
          }

          // Accumulate symbol use counts
          r.accumulateSymbolUseCounts(topLevelSymbols, part.symbolUses, stableSourceIndices);

          // Make sure to also count the declaration in addition to the uses
          const declaredSymbols = part.declaredSymbols;
          for (let j = 0; j < declaredSymbols.length; j++) {
            r.accumulateSymbolCount(topLevelSymbols, declaredSymbols[j].ref, 1, stableSourceIndices);
          }
        }

        sortStableSymbolCountArray(topLevelSymbols);
        allTopLevelSymbols[i] = topLevelSymbols;
      }
      timer?.end("Parallel phase");

      // Accumulate top-level symbol usage counts
      timer?.begin("Serial phase");
      const topLevelSymbols = [];
      for (const stable of sortedImportsFromOtherChunks) {
        r.accumulateSymbolCount(topLevelSymbols, stable.ref, 1, stableSourceIndices);
      }
      for (let i = 0; i < allTopLevelSymbols.length; i++) {
        const array = allTopLevelSymbols[i];
        for (let j = 0; j < array.length; j++) topLevelSymbols.push(array[j]);
      }
      r.allocateTopLevelSymbolSlots(topLevelSymbols);
      timer?.end("Serial phase");
      timer?.end("Accumulate symbol counts");

      // Add all of the character frequency histograms for all files in this
      // chunk together, then use it to compute the character sequence used to
      // generate minified names. This results in slightly better gzip compression
      // over assigning minified names in order (i.e. "a b c ..."). Even though
      // it's a very small win, we still do it because it's simple to do and very
      // cheap to compute.
      const minifier = DefaultNameMinifierJS.shuffleByCharFreq(freq);
      timer?.begin("Assign names by frequency");
      r.assignNamesByFrequency(minifier);
      timer?.end("Assign names by frequency");
      return r;
    }

    // When we're not minifying, just append numbers to symbol names to avoid collisions
    const r = newNumberRenamer(c.graph.symbols, reservedNames);
    const nestedScopes = new Map();

    timer?.begin("Add top-level symbols");
    for (const stable of sortedImportsFromOtherChunks) {
      r.addTopLevelSymbol(stable.ref);
    }
    for (const sourceIndex of filesInOrder) {
      const repr = c.graph.files[sourceIndex].inputFile.repr;
      const scopes = [];

      // Modules wrapped in a CommonJS closure look like this:
      //
      //   // foo.js
      //   var require_foo = __commonJS((exports, module) => {
      //     exports.foo = 123;
      //   });
      //
      // The symbol "require_foo" is stored in "file.ast.WrapperRef". We want
      // to be able to minify everything inside the closure without worrying
      // about collisions with other CommonJS modules. Set up the scopes such
      // that it appears as if the file was structured this way all along. It's
      // not completely accurate (e.g. we don't set the parent of the module
      // scope to this new top-level scope) but it's good enough for the
      // renaming code.
      if (repr.meta.wrap === WrapCJS) {
        r.addTopLevelSymbol(repr.ast.wrapperRef);

        // External import statements will be hoisted outside of the CommonJS
        // wrapper if the output format supports import statements. We need to
        // add those symbols to the top-level scope to avoid causing name
        // collisions. This code special-cases only those symbols.
        if (formatKeepESMImportExportSyntax(c.options.outputFormat)) {
          for (let $i93 = 0, $a93 = repr.ast.parts; $i93 < $a93.length; $i93++) {
            const part = $a93[$i93];
            for (let $i94 = 0, $a94 = part.stmts; $i94 < $a94.length; $i94++) {
              const stmt = $a94[$i94];
              const s = stmt.data;
              switch (s.k) {
                case S_IMPORT:
                  if (!(repr.ast.importRecords[s.importRecordIndex].sourceIndex >= 0)) {
                    r.addTopLevelSymbol(s.namespaceRef);
                    if (s.defaultName !== null) {
                      r.addTopLevelSymbol(s.defaultName.ref);
                    }
                    if (s.items !== null) {
                      for (let $i95 = 0, $a95 = s.items; $i95 < $a95.length; $i95++) {
                        const item = $a95[$i95];
                        r.addTopLevelSymbol(item.name.ref);
                      }
                    }
                  }
                  break;

                case S_EXPORT_STAR:
                  if (!(repr.ast.importRecords[s.importRecordIndex].sourceIndex >= 0)) {
                    r.addTopLevelSymbol(s.namespaceRef);
                  }
                  break;

                case S_EXPORT_FROM:
                  if (!(repr.ast.importRecords[s.importRecordIndex].sourceIndex >= 0)) {
                    r.addTopLevelSymbol(s.namespaceRef);
                    for (let $i96 = 0, $a96 = s.items; $i96 < $a96.length; $i96++) {
                      const item = $a96[$i96];
                      r.addTopLevelSymbol(item.name.ref);
                    }
                  }
                  break;
              }
            }
          }
        }

        nestedScopes.set(sourceIndex, [repr.ast.moduleScope]);
        continue;
      }

      // Modules wrapped in an ESM closure look like this:
      //
      //   // foo.js
      //   var foo, foo_exports = {};
      //   __export(foo_exports, {
      //     foo: () => foo
      //   });
      //   let init_foo = __esm(() => {
      //     foo = 123;
      //   });
      //
      // The symbol "init_foo" is stored in "file.ast.WrapperRef". We need to
      // minify everything inside the closure without introducing a new scope
      // since all top-level variables will be hoisted outside of the closure.
      if (repr.meta.wrap === WrapESM) {
        r.addTopLevelSymbol(repr.ast.wrapperRef);
      }

      // Rename each top-level symbol declaration in this chunk
      for (let $i97 = 0, $a97 = repr.ast.parts; $i97 < $a97.length; $i97++) {
        const part = $a97[$i97];
        if (part.isLive) {
          for (let $i98 = 0, $a98 = part.declaredSymbols; $i98 < $a98.length; $i98++) {
            const declared = $a98[$i98];
            if (declared.isTopLevel) {
              r.addTopLevelSymbol(declared.ref);
            }
          }
          for (const scope of part.scopes) scopes.push(scope);
        }
      }

      nestedScopes.set(sourceIndex, scopes);
    }
    timer?.end("Add top-level symbols");

    // Recursively rename symbols in child scopes now that all top-level
    // symbols have been renamed. This is done in parallel because the symbols
    // inside nested scopes are independent and can't conflict.
    timer?.begin("Assign names by scope");
    r.assignNamesByScope(nestedScopes);
    timer?.end("Assign names by scope");
    return r;
  },

  generateChunkJS(chunkIndex, timer: Timer | null) {
    const c = this;
    const chunk = c.chunks[chunkIndex];
    const chunkRepr = chunk.chunkRepr;
    const compileResults = [];
    const runtimeMembers = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr.ast.moduleScope.members;
    const toCommonJSRef = followSymbols(c.graph.symbols, runtimeMembers.get("__toCommonJS").ref);
    const toESMRef = followSymbols(c.graph.symbols, runtimeMembers.get("__toESM").ref);
    const runtimeRequireRef = followSymbols(c.graph.symbols, runtimeMembers.get("__require").ref);
    const r = c.renameSymbolsInChunk(chunk, chunkRepr.filesInChunkInOrder, timer);
    c.requireOrImportMetaForSourceFn = (sourceIndex) => c.requireOrImportMetaForSource(sourceIndex);
    // (Go's function returns nil when source maps are disabled)
    const dataForSourceMaps = c.options.sourceMap !== SourceMapNone && c.dataForSourceMaps !== null ? c.dataForSourceMaps() : null;

    // Note: This contains placeholders instead of what the placeholders are
    // substituted with. That should be fine though because this should only
    // ever be used for figuring out how many "../" to add to a relative path
    // from a chunk whose final path hasn't been calculated yet to a chunk
    // whose final path has already been calculated. That and placeholders are
    // never substituted with something containing a "/" so substitution should
    // never change the "../" count.
    const chunkAbsDir = c.fs === null ? "" : c.fs.dir(c.fs.join(c.options.absOutputDir, templateToString(chunk.finalTemplate)));

    // Generate JavaScript for each file
    timer?.begin("Print JavaScript files");
    for (const partRange of chunkRepr.partsInChunkInOrder) {
      // Skip the runtime in test output
      if (partRange.sourceIndex === RUNTIME_SOURCE_INDEX && c.options.omitRuntimeForTests) {
        continue;
      }

      const compileResult = new compileResultJS();
      compileResults.push(compileResult);
      // (Go: "defer c.recoverInternalError(...)")
      try {
        c.generateCodeForFileInChunkJS(r, partRange, toCommonJSRef, toESMRef, runtimeRequireRef, compileResult, dataForSourceMaps);
      } catch (e0) {
        let e = e0;
        // (JS-only: nested too deeply for the call stack: printed again in
        // deep mode, see deep.mts)
        if (canRetryDeep() && isStackOverflow(e)) {
          const again = new compileResultJS();
          compileResults[compileResults.length - 1] = again;
          try {
            runDeep(() => c.generateCodeForFileInChunkJS(r, partRange, toCommonJSRef, toESMRef, runtimeRequireRef, again, dataForSourceMaps));
            continue;
          } catch (e1) {
            e = e1;
          }
        }
        recoverLinkerPanic(e, c.log, partRange.sourceIndex === RUNTIME_SOURCE_INDEX ? null : c.graph.files[partRange.sourceIndex].inputFile.source.prettyPaths.select(c.options.logPathStyle));
      }
    }

    // Also generate the cross-chunk binding code
    let crossChunkPrefix = "";
    let crossChunkSuffix = "";
    let jsonMetadataImports = [];
    if (chunkRepr.crossChunkPrefixStmts.length > 0 || chunkRepr.crossChunkSuffixStmts.length > 0 || c.options.needsMetafile) {
      // Indent the file if everything is wrapped in an IIFE
      let indent = 0;
      if (c.options.outputFormat === FormatIIFE) {
        indent++;
      }
      const printOptions = makePrinterOptions(c, indent);
      // (Go leaves ASCIIOnly, LegalComments and the supported features at their
      // zero values here)
      printOptions.asciiOnly = false;
      printOptions.legalComments = 0;
      printOptions.unsupportedFeatures = JSFeatureNone;
      printOptions.mangledProps = null;
      printOptions.needsMetafile = c.options.needsMetafile;
      printOptions.metafileFormat = c.options.metafileFormat;
      const crossChunkImportRecords = new Array(chunk.crossChunkImports.length);
      for (let i = 0; i < chunk.crossChunkImports.length; i++) {
        const chunkImport_ = chunk.crossChunkImports[i];
        crossChunkImportRecords[i] = new ImportRecord(null, null, new Path(c.chunks[chunkImport_.chunkIndex].uniqueKey), RANGE_ZERO, 0, -1, -1, ShouldNotBeExternalInMetafile | ContainsUniqueKey, 0, chunkImport_.importKind);
      }
      const prefixTree = new AST();
      prefixTree.importRecords = crossChunkImportRecords;
      const prefixPart = new Part();
      prefixPart.stmts = chunkRepr.crossChunkPrefixStmts;
      prefixTree.parts = [prefixPart];
      const crossChunkResult = printJS(prefixTree, c.graph.symbols, r, printOptions);
      crossChunkPrefix = crossChunkResult.js;
      jsonMetadataImports = crossChunkResult.jsonMetadataImports;
      const suffixTree = new AST();
      const suffixPart = new Part();
      suffixPart.stmts = chunkRepr.crossChunkSuffixStmts;
      suffixTree.parts = [suffixPart];
      crossChunkSuffix = printJS(suffixTree, c.graph.symbols, r, printOptions).js;
    }

    // Generate the exports for the entry point, if there are any
    let entryPointTail = null;
    if (chunk.isEntryPoint) {
      entryPointTail = c.generateEntryPointTailJS(r, toCommonJSRef, toESMRef, chunk.sourceIndex);
    }

    timer?.end("Print JavaScript files");
    timer?.begin("Join JavaScript files");

    const j = new Joiner();
    // (prevOffset is only read for source maps, so it is only updated then)
    const trackOffset = c.options.sourceMap !== SourceMapNone;
    let prevOffset = new LineColumnOffset();

    // Optionally strip whitespace
    let indent = "";
    let space = " ";
    let newline = "\n";
    if (c.options.minifyWhitespace) {
      space = "";
      newline = "";
    }
    let newlineBeforeComment = false;
    let isExecutable = false;

    // Start with the hashbang if there is one. This must be done before the
    // banner because it only works if it's literally the first character.
    if (chunk.isEntryPoint) {
      const repr = c.graph.files[chunk.sourceIndex].inputFile.repr;
      if (repr.ast.hashbang !== "") {
        const hashbang = repr.ast.hashbang + "\n";
        if (trackOffset) prevOffset.advanceString(hashbang);
        j.addString(hashbang);
        newlineBeforeComment = true;
        isExecutable = true;
      }
    }

    // Then emit the banner after the hashbang. This must come before the
    // "use strict" directive below because some people use the banner to
    // emit a hashbang, which must be the first thing in the file.
    if (c.options.jsBanner.length > 0) {
      if (trackOffset) {
        prevOffset.advanceString(c.options.jsBanner);
        prevOffset.advanceString("\n");
      }
      j.addString(c.options.jsBanner);
      j.addString("\n");
      newlineBeforeComment = true;
    }

    // Add the top-level directive if present (but omit "use strict" in ES
    // modules because all ES modules are automatically in strict mode)
    if (chunk.isEntryPoint) {
      const repr = c.graph.files[chunk.sourceIndex].inputFile.repr;
      for (let $i99 = 0, $a99 = repr.ast.directives; $i99 < $a99.length; $i99++) {
        const directive = $a99[$i99];
        if (directive !== "use strict" || c.options.outputFormat !== FormatESModule) {
          const quoted = quoteForJSON(directive, c.options.asciiOnly) + ";" + newline;
          if (trackOffset) prevOffset.advanceString(quoted);
          j.addString(quoted);
          newlineBeforeComment = true;
        }
      }
    }

    // Optionally wrap with an IIFE
    if (c.options.outputFormat === FormatIIFE) {
      let text = "";
      indent = "  ";
      if (c.options.globalName.length > 0) {
        text = c.generateGlobalNamePrefix();
      }
      if (jsFeatureHas(c.options.unsupportedJSFeatures, Arrow)) {
        text += "(function()" + space + "{" + newline;
      } else {
        text += "(()" + space + "=>" + space + "{" + newline;
      }
      if (trackOffset) prevOffset.advanceString(text);
      j.addString(text);
      newlineBeforeComment = false;
    }

    // Put the cross-chunk prefix inside the IIFE
    if (crossChunkPrefix.length > 0) {
      newlineBeforeComment = true;
      if (trackOffset) prevOffset.advanceBytes(crossChunkPrefix);
      j.addString(crossChunkPrefix);
    }

    // Start the metadata
    const ws = (fmt) => metafileFormatMaybeRemoveWhitespace(c.options.metafileFormat, fmt);
    const jMeta = new Joiner();
    if (c.options.needsMetafile) {
      // Print imports
      let isFirstMeta = true;
      jMeta.addString(ws('{\n      "imports": ['));
      for (const json of jsonMetadataImports) {
        if (isFirstMeta) {
          isFirstMeta = false;
        } else {
          jMeta.addString(",");
        }
        jMeta.addString(json);
      }
      for (const compileResult of compileResults) {
        if (compileResult.jsonMetadataImports === null) continue;
        for (const json of compileResult.jsonMetadataImports) {
          if (isFirstMeta) {
            isFirstMeta = false;
          } else {
            jMeta.addString(",");
          }
          jMeta.addString(json);
        }
      }
      if (!isFirstMeta) {
        jMeta.addString(ws("\n      "));
      }

      // Print exports
      jMeta.addString(ws('],\n      "exports": ['));
      let aliases = [];
      if (formatKeepESMImportExportSyntax(c.options.outputFormat)) {
        if (chunk.isEntryPoint) {
          const fileRepr = c.graph.files[chunk.sourceIndex].inputFile.repr;
          if (fileRepr.meta.wrap === WrapCJS) {
            aliases = ["default"];
          } else {
            aliases = [...fileRepr.meta.resolvedExports.keys()];
          }
        } else {
          aliases = [...chunkRepr.exportsToOtherChunks.values()];
        }
      }
      isFirstMeta = true;
      sortStringsUTF8(aliases); // Sort for determinism
      for (const alias of aliases) {
        if (isFirstMeta) {
          isFirstMeta = false;
        } else {
          jMeta.addString(",");
        }
        jMeta.addString(ws("\n        ") + quoteForJSON(alias, c.options.asciiOnly));
      }
      if (!isFirstMeta) {
        jMeta.addString(ws("\n      "));
      }
      jMeta.addString(ws("],\n"));
      if (chunk.isEntryPoint) {
        const entryPoint = c.graph.files[chunk.sourceIndex].inputFile.source.prettyPaths.select(c.options.metafilePathStyle);
        jMeta.addString(ws('      "entryPoint": ') + quoteForJSON(entryPoint, c.options.asciiOnly) + ws(",\n"));
      }
      if (chunkRepr.hasCSSChunk) {
        jMeta.addString(ws('      "cssBundle": ') + quoteForJSON(c.chunks[chunkRepr.cssChunkIndex].uniqueKey, c.options.asciiOnly) + ws(",\n"));
      }
      jMeta.addString(ws('      "inputs": {'));
    }

    // Concatenate the generated JavaScript chunks together
    const compileResultsForSourceMap = [];
    const legalCommentList = [];
    let metaOrder = null;
    let metaBytes = null;
    let prevFileNameComment = 0;
    if (c.options.needsMetafile) {
      metaOrder = [];
      metaBytes = new Map();
    }
    for (const compileResult of compileResults) {
      if (compileResult.extractedLegalComments !== null && compileResult.extractedLegalComments.length > 0) {
        legalCommentList.push(new legalCommentEntry(compileResult.sourceIndex, compileResult.extractedLegalComments));
      }

      // Add a comment with the file path before the file contents
      if (
        c.options.mode === ModeBundle &&
        !c.options.minifyWhitespace &&
        prevFileNameComment !== compileResult.sourceIndex &&
        compileResult.js.length > 0
      ) {
        if (newlineBeforeComment) {
          if (trackOffset) prevOffset.advanceString("\n");
          j.addString("\n");
        }

        let path = c.graph.files[compileResult.sourceIndex].inputFile.source.prettyPaths.select(c.options.codePathStyle);

        // Make sure newlines in the path can't cause a syntax error. This does
        // not minimize allocations because it's expected that this case never
        // comes up in practice.
        path = path.replaceAll("\r", "\\r");
        path = path.replaceAll("\n", "\\n");
        path = path.replaceAll(String.fromCharCode(0x2028), "\\u2028");
        path = path.replaceAll(String.fromCharCode(0x2029), "\\u2029");

        const text = indent + "// " + path + "\n";
        if (trackOffset) prevOffset.advanceString(text);
        j.addString(text);
        prevFileNameComment = compileResult.sourceIndex;
      }

      // Don't include the runtime in source maps
      if (c.graph.files[compileResult.sourceIndex].inputFile.omitFromSourceMapsAndMetafile) {
        if (trackOffset) prevOffset.advanceString(compileResult.js);
        j.addString(compileResult.js);
      } else {
        // Save the offset to the start of the stored JavaScript
        if (trackOffset) compileResult.generatedOffset = prevOffset.clone();
        j.addString(compileResult.js);

        // Ignore empty source map chunks (a null chunk is Go's zero value)
        if (compileResult.sourceMapChunk !== null && compileResult.sourceMapChunk.shouldIgnore) {
          prevOffset.advanceBytes(compileResult.js);

          // Include a null entry in the source map
          if (compileResult.js.length > 0 && c.options.sourceMap !== SourceMapNone) {
            const n = compileResultsForSourceMap.length;
            if (n > 0 && !compileResultsForSourceMap[n - 1].isNullEntry) {
              compileResultsForSourceMap.push(new compileResultForSourceMap(new SourceMapChunk(), new LineColumnOffset(), compileResult.sourceIndex, true));
            }
          }
        } else {
          if (trackOffset) prevOffset = new LineColumnOffset();

          // Include this file in the source map
          if (c.options.sourceMap !== SourceMapNone) {
            compileResultsForSourceMap.push(
              new compileResultForSourceMap(compileResult.sourceMapChunk, compileResult.generatedOffset, compileResult.sourceIndex, false),
            );
          }
        }

        // Include this file in the metadata
        if (c.options.needsMetafile) {
          // Accumulate file sizes since a given file may be split into multiple parts
          let bytes = metaBytes.get(compileResult.sourceIndex);
          if (bytes === undefined) {
            metaOrder.push(compileResult.sourceIndex);
            metaBytes.set(compileResult.sourceIndex, (bytes = []));
          }
          bytes.push(compileResult.js);
        }
      }

      // Put a newline before the next file path comment
      if (compileResult.js.length > 0) {
        newlineBeforeComment = true;
      }
    }

    // Stick the entry point tail at the end of the file. Deliberately don't
    // include any source mapping information for this because it's automatically
    // generated and doesn't correspond to a location in the input file.
    if (entryPointTail !== null) {
      j.addString(entryPointTail.js);
    }

    // Put the cross-chunk suffix inside the IIFE
    if (crossChunkSuffix.length > 0) {
      if (newlineBeforeComment) {
        j.addString(newline);
      }
      j.addString(crossChunkSuffix);
    }

    // Optionally wrap with an IIFE
    if (c.options.outputFormat === FormatIIFE) {
      j.addString("})();" + newline);
    }

    // Make sure the file ends with a newline
    j.ensureNewlineAtEnd();

    let slashTag = "/script";
    if (jsFeatureHas(c.options.unsupportedJSFeatures, InlineScript)) slashTag = "";
    c.maybeAppendLegalComments(c.options.legalComments, legalCommentList, chunk, j, slashTag);

    if (c.options.jsFooter.length > 0) {
      j.addString(c.options.jsFooter);
      j.addString("\n");
    }

    // The JavaScript contents are done now that the source map comment is in
    chunk.intermediateOutput = c.breakJoinerIntoPieces(j);
    timer?.end("Join JavaScript files");

    if (c.options.sourceMap !== SourceMapNone) {
      timer?.begin("Generate source map");
      const canHaveShifts = chunk.intermediateOutput.pieces !== null;
      chunk.outputSourceMap = c.generateSourceMapForChunk(compileResultsForSourceMap, chunkAbsDir, dataForSourceMaps, canHaveShifts);
      timer?.end("Generate source map");
    }

    // End the metadata lazily. The final output size is not known until the
    // final import paths are substituted into the output pieces generated below.
    if (c.options.needsMetafile) {
      const pieces = new Array(metaOrder.length);
      for (let i = 0; i < metaOrder.length; i++) {
        const slices = metaBytes.get(metaOrder[i]);
        const outputs = new Array(slices.length);
        for (let k = 0; k < slices.length; k++) {
          outputs[k] = c.breakOutputIntoPieces(slices[k]);
        }
        pieces[i] = outputs;
      }
      chunk.jsonMetadataChunkCallback = (finalOutputSize) => {
        const finalRelDir = c.fs.dir(chunk.finalRelPath);
        for (let i = 0; i < metaOrder.length; i++) {
          const sourceIndex = metaOrder[i];
          if (i > 0) {
            jMeta.addString(",");
          }
          let count = 0;
          for (const output of pieces[i]) {
            count += c.accurateFinalByteCount(output, finalRelDir);
          }
          jMeta.addString(
            ws("\n        ") +
              quoteForJSON(c.graph.files[sourceIndex].inputFile.source.prettyPaths.select(c.options.metafilePathStyle), c.options.asciiOnly) +
              ws(': {\n          "bytesInOutput": ') +
              count +
              ws("\n        }"),
          );
        }
        if (metaOrder.length > 0) {
          jMeta.addString(ws("\n      "));
        }
        jMeta.addString(ws('},\n      "bytes": ') + finalOutputSize + ws("\n    }"));
        return jMeta;
      };
    }

    // (the isolated hash is computed when it is needed, see generateIsolatedHash)
    chunk.isExecutable = isExecutable;
  },

  generateGlobalNamePrefix() {
    const c = this;
    let text = "";
    const globalNameAll = c.options.globalName;
    let prefix = globalNameAll[0];
    let globalName = globalNameAll.slice(1);
    let space = " ";
    let join = ";\n";

    if (c.options.minifyWhitespace) {
      space = "";
      join = ";";
    }

    // Assume the "this" and "import.meta" objects always exist
    let isExistingObject = prefix === "this";
    if (prefix === "import" && globalName.length > 0 && globalName[0] === "meta") {
      prefix = "import.meta";
      globalName = globalName.slice(1);
      isExistingObject = true;
    }

    // Use "||=" to make the code more compact when it's supported
    const features = c.options.unsupportedJSFeatures;
    if (globalName.length > 0 && !jsFeatureHas(features, LogicalAssignment)) {
      if (isExistingObject) {
        // Keep the prefix as it is
      } else if (canEscapeIdentifier(prefix, features, c.options.asciiOnly)) {
        if (c.options.asciiOnly) {
          prefix = quoteIdentifier("", prefix, features);
        }
        text = "var " + prefix + join;
      } else {
        prefix = "this[" + quoteForJSON(prefix, c.options.asciiOnly) + "]";
      }
      for (let name of globalName) {
        let dotOrIndex;
        if (canEscapeIdentifier(name, features, c.options.asciiOnly)) {
          if (c.options.asciiOnly) {
            name = quoteIdentifier("", name, features);
          }
          dotOrIndex = "." + name;
        } else {
          dotOrIndex = "[" + quoteForJSON(name, c.options.asciiOnly) + "]";
        }
        if (isExistingObject) {
          prefix = prefix + dotOrIndex;
          isExistingObject = false;
        } else {
          prefix = "(" + prefix + space + "||=" + space + "{})" + dotOrIndex;
        }
      }
      return text + prefix + space + "=" + space;
    }

    if (isExistingObject) {
      text = prefix + space + "=" + space;
    } else if (canEscapeIdentifier(prefix, features, c.options.asciiOnly)) {
      if (c.options.asciiOnly) {
        prefix = quoteIdentifier("", prefix, features);
      }
      text = "var " + prefix + space + "=" + space;
    } else {
      prefix = "this[" + quoteForJSON(prefix, c.options.asciiOnly) + "]";
      text = prefix + space + "=" + space;
    }

    for (let name of globalName) {
      const oldPrefix = prefix;
      if (canEscapeIdentifier(name, features, c.options.asciiOnly)) {
        if (c.options.asciiOnly) {
          name = quoteIdentifier("", name, features);
        }
        prefix = prefix + "." + name;
      } else {
        prefix = prefix + "[" + quoteForJSON(name, c.options.asciiOnly) + "]";
      }
      text += oldPrefix + space + "||" + space + "{}" + join + prefix + space + "=" + space;
    }

    return text;
  },

  // Add all unique legal comments to the end of the file. These are
  // deduplicated because some projects have thousands of files with the same
  // comment. The comment must be preserved in the output for legal reasons but
  // at the same time we want to generate a small bundle when minifying.
  maybeAppendLegalComments(legalComments, legalCommentList, chunk, j, slashTag) {
    const c = this;
    switch (legalComments) {
      case LegalCommentsNone:
      case LegalCommentsInline:
        return;
    }

    const uniqueFirstPartyComments = [];
    let thirdPartyComments = [];
    const hasFirstPartyComment = new Set();

    for (const entry of legalCommentList) {
      const source = c.graph.files[entry.sourceIndex].inputFile.source;
      let packagePath = "";

      // Try to extract a package name from the source path. If we can find a
      // "node_modules" path component in the path, then assume this is a legal
      // comment in third-party code and that everything after "node_modules" is
      // the package name and subpath. If we can't, then assume this is a legal
      // comment in first-party code.
      //
      // The rationale for this behavior: If we just include third-party comments
      // as-is and the third-party comments don't say what package they're from
      // (which isn't uncommon), then it'll look like that comment applies to
      // all code in the file which is very wrong. So we need to somehow say
      // where the comment comes from. But we don't want to say where every
      // comment comes from because people probably won't appreciate this for
      // first-party comments. And we don't want to include the whole path to
      // each third-part module because a) that could contain information about
      // the local machine that people don't want in their bundle and b) that
      // could differ depending on unimportant details like the package manager
      // used to install the packages (npm vs. pnpm vs. yarn).
      if (source.keyPath.namespace !== "dataurl") {
        const path = source.keyPath.text;
        let previous = path.length;
        while (previous > 0) {
          const head = path.slice(0, previous);
          const slash = Math.max(head.lastIndexOf("\\"), head.lastIndexOf("/"));
          const component = path.slice(slash + 1, previous);
          if (component === "node_modules") {
            if (previous < path.length) {
              packagePath = path.slice(previous + 1).split("\\").join("/");
            }
            break;
          }
          previous = slash;
        }
      }

      if (packagePath !== "") {
        thirdPartyComments.push({ packagePaths: [packagePath], comments: entry.comments });
      } else {
        for (const comment of entry.comments) {
          if (!hasFirstPartyComment.has(comment)) {
            hasFirstPartyComment.add(comment);
            uniqueFirstPartyComments.push(comment);
          }
        }
      }
    }

    // Merge package paths with identical comments
    const identical = new Map();
    let end = 0;
    const NUL = String.fromCharCode(0);
    for (const entry of thirdPartyComments) {
      const key = entry.comments.join(NUL);
      const index = identical.get(key);
      if (index !== undefined) {
        const existing = thirdPartyComments[index];
        existing.packagePaths = existing.packagePaths.concat(entry.packagePaths);
      } else {
        identical.set(key, end);
        thirdPartyComments[end] = entry;
        end++;
      }
    }
    thirdPartyComments = thirdPartyComments.slice(0, end);

    switch (legalComments) {
      case LegalCommentsEndOfFile:
        for (const comment of uniqueFirstPartyComments) {
          j.addString(escapeClosingTag(comment, slashTag));
          j.addString("\n");
        }

        if (thirdPartyComments.length > 0) {
          j.addString("/*! Bundled license information:\n");
          for (const entry of thirdPartyComments) {
            j.addString("\n");
            for (const packagePath of entry.packagePaths) {
              j.addString(escapeClosingTag(packagePath, slashTag) + ":\n");
            }
            for (let comment of entry.comments) {
              comment = escapeClosingTag(comment, slashTag);
              if (comment.startsWith("//")) {
                j.addString("  (*" + comment.slice(2) + " *)\n");
              } else if (comment.startsWith("/*") && comment.endsWith("*/")) {
                j.addString("  (" + comment.slice(1, comment.length - 1).split("\n").join("\n  ") + ")\n");
              }
            }
          }
          j.addString("*/\n");
        }
        break;

      case LegalCommentsLinkedWithComment:
      case LegalCommentsExternalWithoutComment: {
        const jComments = new Joiner();

        for (const comment of uniqueFirstPartyComments) {
          jComments.addString(comment);
          jComments.addString("\n");
        }

        if (thirdPartyComments.length > 0) {
          if (uniqueFirstPartyComments.length > 0) {
            jComments.addString("\n");
          }
          jComments.addString("Bundled license information:\n");
          for (const entry of thirdPartyComments) {
            jComments.addString("\n");
            for (const packagePath of entry.packagePaths) {
              jComments.addString(packagePath + ":\n");
            }
            for (const comment of entry.comments) {
              jComments.addString("  " + comment.split("\n").join("\n  ") + "\n");
            }
          }
        }

        chunk.externalLegalComments = jComments.done();
        break;
      }
    }
  },

  breakJoinerIntoPieces(j) {
    const c = this;

    // Optimization: If there can be no substitutions, just reuse the initial
    // joiner that was used when generating the intermediate chunk output
    // instead of creating another one and copying the whole file into it.
    if (!j.contains(c.uniqueKeyPrefix)) {
      return new intermediateOutput(null, j);
    }

    return c.breakOutputIntoPieces(j.done());
  },

  breakOutputIntoPieces(output) {
    const c = this;
    const pieces = [];
    const prefix = c.uniqueKeyPrefix;
    for (;;) {
      // Scan for the next piece boundary
      let boundary = output.indexOf(prefix);

      // Try to parse the piece boundary
      let kind = outputPieceNone;
      let index = 0;
      if (boundary !== -1) {
        const start = boundary + prefix.length;
        if (start + 9 > output.length) {
          boundary = -1;
        } else {
          switch (output.charCodeAt(start)) {
            case 65: // A
              kind = outputPieceAssetIndex;
              break;
            case 67: // C
              kind = outputPieceChunkIndex;
              break;
          }
          for (let k = 1; k < 9; k++) {
            const ch = output.charCodeAt(start + k);
            if (ch < 48 || ch > 57) {
              boundary = -1;
              break;
            }
            index = index * 10 + ch - 48;
          }
        }
      }

      // Validate the boundary
      switch (kind) {
        case outputPieceAssetIndex:
          if (index >= c.graph.files.length) {
            boundary = -1;
          }
          break;

        case outputPieceChunkIndex:
          if (index >= c.chunks.length) {
            boundary = -1;
          }
          break;

        default:
          boundary = -1;
      }

      // If we're at the end, generate one final piece
      if (boundary === -1) {
        pieces.push(new outputPiece(output));
        break;
      }

      // Otherwise, generate an interior piece and continue
      pieces.push(new outputPiece(output.slice(0, boundary), index, kind));
      output = output.slice(boundary + prefix.length + 9);
    }
    return new intermediateOutput(pieces, null);
  },

  appendIsolatedHashesForImportedChunks(hash, chunkIndex, visited, visitedKey) {
    const c = this;

    // Only visit each chunk at most once. This is important because there may be
    // cycles in the chunk import graph. If there's a cycle, we want to include
    // the hash of every chunk involved in the cycle (along with all of their
    // dependencies). This depth-first traversal will naturally do that.
    if (visited[chunkIndex] === visitedKey) {
      return;
    }
    visited[chunkIndex] = visitedKey;
    const chunk = c.chunks[chunkIndex];

    // Visit the other chunks that this chunk imports before visiting this chunk
    for (const chunkImport_ of chunk.crossChunkImports) {
      c.appendIsolatedHashesForImportedChunks(hash, chunkImport_.chunkIndex, visited, visitedKey);
    }

    // Mix in hashes for referenced asset paths (i.e. the "file" loader)
    if (chunk.intermediateOutput.pieces !== null) {
      for (const piece of chunk.intermediateOutput.pieces) {
        if (piece.kind === outputPieceAssetIndex) {
          const file = c.graph.files[piece.index];
          if (file.inputFile.additionalFiles.length !== 1) throw new GoPanic("Internal error");
          let relPath = c.fs.rel(c.options.absOutputDir, file.inputFile.additionalFiles[0].absPath)[0];

          // Make sure to always use forward slashes, even on Windows
          relPath = relPath.replaceAll("\\", "/");

          // Mix in the hash for the relative path, which ends up as a JS string
          hashWriteLengthPrefixed(hash, relPath);
        }
      }
    }

    // Mix in the hash for this chunk
    hash.write(c.isolatedHashForChunk(chunk));
  },

  // generateIsolatedHash (computed on first use, see chunkInfo.isolatedHash)
  isolatedHashForChunk(chunk) {
    const c = this;
    if (chunk.isolatedHash !== null) return chunk.isolatedHash;
    const hash = new Digest();

    // Mix the file names and part ranges of all of the files in this chunk into
    // the hash. Objects that appear identical but that live in separate files or
    // that live in separate parts in the same file must not be merged. This only
    // needs to be done for JavaScript files, not CSS files.
    const chunkRepr = chunk.chunkRepr;
    if (chunkRepr instanceof chunkReprJS) {
      for (const partRange of chunkRepr.partsInChunkInOrder) {
        let filePath;
        const file = c.graph.files[partRange.sourceIndex];
        if (file.inputFile.source.keyPath.namespace === "file") {
          // Use the pretty path as the file name since it should be platform-
          // independent (relative paths and the "/" path separator)
          filePath = file.inputFile.source.prettyPaths.rel;
        } else {
          // If this isn't in the "file" namespace, just use the full path text
          // verbatim. This could be a source of cross-platform differences if
          // plugins are storing platform-specific information in here, but then
          // that problem isn't caused by esbuild itself.
          filePath = file.inputFile.source.keyPath.text;
        }

        // Include the path namespace in the hash
        hashWriteLengthPrefixed(hash, file.inputFile.source.keyPath.namespace);

        // Then include the file path
        hashWriteLengthPrefixed(hash, filePath);

        // Also write the part range. These numbers are deterministic and allocated
        // per-file so this should be a well-behaved base for a hash.
        hashWriteUint32(hash, partRange.partIndexBegin);
        hashWriteUint32(hash, partRange.partIndexEnd);
      }
    }

    // Hash the output path template as part of the content hash because we want
    // any import to be considered different if the import's output path has changed.
    for (const part of chunk.finalTemplate) {
      hashWriteLengthPrefixed(hash, part.data);
    }

    // Also hash the public path. If provided, this is used whenever files
    // reference each other such as cross-chunk imports, asset file references,
    // and source map comments. We always include the hash in all chunks instead
    // of trying to figure out which chunks will include the public path for
    // simplicity and for robustness to code changes in the future.
    if (c.options.publicPath !== "") {
      hashWriteLengthPrefixed(hash, c.options.publicPath);
    }

    // Include the generated output content in the hash. This excludes the
    // randomly-generated import paths (the unique keys) and only includes the
    // data in the spans between them.
    if (chunk.intermediateOutput.pieces !== null) {
      for (const piece of chunk.intermediateOutput.pieces) {
        hashWriteLengthPrefixed(hash, piece.data);
      }
    } else {
      hashWriteLengthPrefixed(hash, chunk.intermediateOutput.joiner.done());
    }

    // Also include the source map data in the hash. The source map is named the
    // same name as the chunk name for ease of discovery. So we want the hash to
    // change if the source map data changes even if the chunk data doesn't change.
    // Otherwise the output path for the source map wouldn't change and the source
    // map wouldn't end up being updated.
    hashWriteLengthPrefixed(hash, chunk.outputSourceMap.prefix);
    hashWriteLengthPrefixed(hash, chunk.outputSourceMap.mappings);
    hashWriteLengthPrefixed(hash, chunk.outputSourceMap.suffix);

    // Store the hash so far. All other chunks that import this chunk will mix
    // this hash into their final hash to ensure that the import path changes
    // if this chunk (or any dependencies of this chunk) is changed.
    chunk.isolatedHash = hash.sum();
    return chunk.isolatedHash;
  },

  // Returns a sourcemap.SourceMapPieces
  generateSourceMapForChunk(results, chunkAbsDir, dataForSourceMaps, canHaveShifts) {
    const c = this;
    const j = new Joiner();
    j.addString('{\n  "version": 3');

    // Only write out the sources for a given source index once
    const sourceIndexToSourcesIndex = new Map();

    // Generate the "sources" and "sourcesContent" arrays
    const items = []; // {source, quotedContents}
    let nextSourcesIndex = 0;
    for (const result of results) {
      if (result.isNullEntry) {
        continue;
      }
      if (sourceIndexToSourcesIndex.has(result.sourceIndex)) {
        continue;
      }
      sourceIndexToSourcesIndex.set(result.sourceIndex, nextSourcesIndex);
      const file = c.graph.files[result.sourceIndex];

      // Simple case: no nested source map
      if (file.inputFile.inputSourceMap === null) {
        let quotedContents = null;
        if (!c.options.excludeSourcesContent) {
          quotedContents = dataForSourceMaps[result.sourceIndex].quotedContents[0];
        }
        const keyPath = file.inputFile.source.keyPath;
        let source = keyPath.text;
        if (keyPath.namespace === "file") {
          // Serialize the file path as a "file://" URL, since source maps encode
          // sources as URLs. While we could output absolute "file://" URLs, it
          // will be turned into a relative path when it's written out below for
          // better readability and to be independent of build directory.
          // (JS-only: the file path is kept next to the URL, which Go parses
          // back into the same path below)
          const urlPath = fileURLPathFromFilePath(source);
          items.push({ source: "file://" + goURLEscapePath(urlPath), quotedContents, fileURLPath: urlPath });
          nextSourcesIndex++;
          continue;
        } else {
          // If the path for this file isn't in the "file" namespace, then write
          // out something arbitrary instead. Source maps encode sources as URLs
          // but plugins are allowed to put almost anything in the "namespace"
          // and "path" fields, so we don't attempt to control whether this forms
          // a valid URL or not.
          //
          // The approach used here is to join the namespace with the path text
          // using a ":" character. It's important to include the namespace
          // because esbuild considers paths with different namespaces to have
          // separate identities. And using a ":" means that the path is more
          // likely to form a valid URL in the source map.
          const ns = keyPath.namespace;
          if (ns !== "") {
            source = ns + ":" + source;
          }
          source += keyPath.ignoredSuffix;
        }
        items.push({ source, quotedContents });
        nextSourcesIndex++;
        continue;
      }

      // Complex case: nested source map
      const sm = file.inputFile.inputSourceMap;
      for (let i = 0; i < sm.sources.length; i++) {
        let quotedContents = null;
        if (!c.options.excludeSourcesContent) {
          quotedContents = dataForSourceMaps[result.sourceIndex].quotedContents[i];
        }
        items.push({ source: sm.sources[i], quotedContents });
      }
      nextSourcesIndex += sm.sources.length;
    }

    // Write the sources
    j.addString(',\n  "sources": [');
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (i !== 0) {
        j.addString(", ");
      }

      // Modify the absolute path to the original file to be relative to the
      // directory that will contain the output file for this chunk
      if (item.fileURLPath !== undefined) {
        const sourcePath = filePathFromFileURLPath(c.fs, item.fileURLPath);
        const $rel = c.fs.rel(chunkAbsDir, sourcePath);
        if ($rel[1]) {
          // Make sure to always use forward slashes, even on Windows
          item.source = goURLStringForRelativePath($rel[0].replaceAll("\\", "/"));

          // Replace certain percent encodings for better readability
          item.source = item.source.replaceAll("%20", " ");
        }
      } else if (c.fs === null) {
        // (The transform API: the file system is Go's mock file system for
        // Unix with "/" as the working directory, and the chunk's directory
        // is "." (the output path template of a transform is only the
        // extension of "sourcefile" + "-out"). A "file://" URL's path is
        // absolute, and the mock file system's Rel fails for a relative base
        // and an absolute target: the source stays as it is.)
      } else {
        const sourceURL = parseGoURL(item.source);
        if (sourceURL !== null && isFileURL(sourceURL)) {
          const sourcePath = filePathFromFileURL(c.fs, sourceURL);
          const $rel = c.fs.rel(chunkAbsDir, sourcePath);
          if ($rel[1]) {
            // Make sure to always use forward slashes, even on Windows
            item.source = goURLStringForRelativePath($rel[0].replaceAll("\\", "/"));

            // Replace certain percent encodings for better readability
            item.source = item.source.replaceAll("%20", " ");
          }
        }
      }

      j.addBytes(quoteForJSON(item.source, c.options.asciiOnly));
    }
    j.addString("]");

    if (c.options.sourceRoot !== "") {
      j.addString(',\n  "sourceRoot": ');
      j.addBytes(quoteForJSON(c.options.sourceRoot, c.options.asciiOnly));
    }

    // Write the sourcesContent
    if (!c.options.excludeSourcesContent) {
      j.addString(',\n  "sourcesContent": [');
      for (let i = 0; i < items.length; i++) {
        if (i !== 0) {
          j.addString(", ");
        }
        j.addBytes(items[i].quotedContents);
      }
      j.addString("]");
    }

    j.addString(',\n  "mappings": "');

    // Write the mappings
    const mappingsStart = j.length;
    let prevEndState = new SourceMapState();
    let prevColumnOffset = 0;
    let totalQuotedNameLen = 0;
    for (const result of results) {
      const chunk = result.sourceMapChunk;
      const offset = result.generatedOffset;
      let sourcesIndex = sourceIndexToSourcesIndex.get(result.sourceIndex);
      if (sourcesIndex === undefined) {
        // If there's no sourcesIndex, then every mapping for this result's
        // sourceIndex were null mappings. We still need to emit the null
        // mapping, but its source index won't matter.
        sourcesIndex = 0;
        if (!result.isNullEntry) {
          throw new Error("Internal error");
        }
      }

      // This should have already been checked earlier
      if (chunk.shouldIgnore) {
        throw new Error("Internal error");
      }

      // Because each file for the bundle is converted to a source map once,
      // the source maps are shared between all entry points in the bundle.
      // The easiest way of getting this to work is to have all source maps
      // generate as if their source index is 0. We then adjust the source
      // index per entry point by modifying the first source mapping. This
      // is done by AppendSourceMapChunk() using the source index passed
      // here.
      const startState = new SourceMapState(offset.lines, offset.columns, sourcesIndex, 0, 0, totalQuotedNameLen);
      if (offset.lines === 0) {
        startState.generatedColumn += prevColumnOffset;
      }

      if (result.isNullEntry) {
        // Emit a "null" mapping (Go replaces the data of its copy of the chunk)
        appendSourceMapChunk(j, prevEndState, startState, new MappingsBuffer("A", chunk.buffer.firstNameOffset));

        // Only the generated position was advanced
        prevEndState.generatedLine = startState.generatedLine;
        prevEndState.generatedColumn = startState.generatedColumn;
      } else {
        // Append the precomputed source map chunk
        appendSourceMapChunk(j, prevEndState, startState, chunk.buffer);

        // Generate the relative offset to start from next time
        const prevOriginalName = prevEndState.originalName;
        prevEndState = chunk.endState.clone();
        prevEndState.sourceIndex += sourcesIndex;
        if (chunk.buffer.firstNameOffset >= 0) {
          prevEndState.originalName += totalQuotedNameLen;
        } else {
          // It's possible for a chunk to have mappings but for none of those
          // mappings to have an associated name. The name is optional and is
          // omitted when the mapping is for a non-name token or if the final
          // and original names are the same. In that case we need to restore
          // the previous original name end state since it wasn't modified after
          // all. If we don't do this, then files after this will adjust their
          // name offsets assuming that the previous generated mapping has this
          // file's offset, which is wrong.
          prevEndState.originalName = prevOriginalName;
        }
        prevColumnOffset = chunk.finalGeneratedColumn;
        totalQuotedNameLen += chunk.quotedNames === null ? 0 : chunk.quotedNames.length;
      }

      // If this was all one line, include the column offset from the start
      if (prevEndState.generatedLine === 0) {
        prevEndState.generatedColumn += startState.generatedColumn;
        prevColumnOffset += startState.generatedColumn;
      }
    }
    const mappingsEnd = j.length;

    // Write the names
    let isFirstName = true;
    j.addString('",\n  "names": [');
    for (const result of results) {
      const quotedNames = result.sourceMapChunk.quotedNames;
      if (quotedNames === null) {
        continue;
      }
      for (const quotedName of quotedNames) {
        if (isFirstName) {
          isFirstName = false;
        } else {
          j.addString(", ");
        }
        j.addBytes(quotedName);
      }
    }
    j.addString("]");

    // Finish the source map
    j.addString("\n}\n");
    const bytes = j.done();

    const pieces = new SourceMapPieces();
    if (!canHaveShifts) {
      // If there cannot be any shifts, then we can avoid doing extra work later
      // on by preserving the source map as a single memory allocation throughout
      // the pipeline. That way we won't need to reallocate it.
      pieces.prefix = bytes;
    } else {
      // Otherwise if there can be shifts, then we need to split this into several
      // slices so that the shifts in the mappings array can be processed. This is
      // more expensive because everything will need to be recombined into a new
      // memory allocation at the end.
      pieces.prefix = bytes.slice(0, mappingsStart);
      pieces.mappings = bytes.slice(mappingsStart, mappingsEnd);
      pieces.suffix = bytes.slice(mappingsEnd);
    }
    return pieces;
  },

  // Marking a symbol as unbound prevents it from being renamed or minified.
  // This is only used when a module is compiled independently. We use a very
  // different way of handling exports and renaming/minifying when bundling.
  preventExportsFromBeingRenamed(sourceIndex) {
    const c = this;
    const repr = c.graph.files[sourceIndex].inputFile.repr;
    if (!(repr instanceof JSRepr)) return;
    let hasImportOrExport = false;

    for (let $i100 = 0, $a100 = repr.ast.parts; $i100 < $a100.length; $i100++) {
      const part = $a100[$i100];
      for (let $i101 = 0, $a101 = part.stmts; $i101 < $a101.length; $i101++) {
        const stmt = $a101[$i101];
        const s = stmt.data;
        switch (s.k) {
          case S_IMPORT:
            // Ignore imports from internal (i.e. non-external) code. Since this
            // function is only called when we're not bundling, these imports are
            // all for files that were generated automatically and aren't part of
            // the original source code (e.g. the runtime or an injected file).
            // We shouldn't consider the file a module if the only ESM imports or
            // exports are automatically generated ones.
            if (repr.ast.importRecords[s.importRecordIndex].sourceIndex >= 0) {
              continue;
            }

            hasImportOrExport = true;
            break;

          case S_LOCAL:
            if (s.isExport) {
              forEachIdentifierBindingInDecls(s.decls, (loc, b) => {
                writableSymbol(c.graph.symbols, b.ref).flags |= MustNotBeRenamed;
              });
              hasImportOrExport = true;
            }
            break;

          case S_FUNCTION:
            if (s.isExport) {
              writableSymbol(c.graph.symbols, s.fn.name.ref).kind = SymbolUnbound;
              hasImportOrExport = true;
            }
            break;

          case S_CLASS:
            if (s.isExport) {
              writableSymbol(c.graph.symbols, s.class.name.ref).kind = SymbolUnbound;
              hasImportOrExport = true;
            }
            break;

          case S_EXPORT_CLAUSE:
          case S_EXPORT_DEFAULT:
          case S_EXPORT_STAR:
            hasImportOrExport = true;
            break;

          case S_EXPORT_FROM:
            hasImportOrExport = true;
            break;
        }
      }
    }

    // Heuristic: If this module has top-level import or export statements, we
    // consider this an ES6 module and only preserve the names of the exported
    // symbols. Everything else is minified since the names are private.
    //
    // Otherwise, we consider this potentially a script-type file instead of an
    // ES6 module. In that case, preserve the names of all top-level symbols
    // since they are all potentially exported (e.g. if this is used in a
    // <script> tag). All symbols in nested scopes are still minified.
    if (!hasImportOrExport) {
      for (const member of repr.ast.moduleScope.members.values()) {
        writableSymbol(c.graph.symbols, member.ref).flags |= MustNotBeRenamed;
      }
    }
  },
});
