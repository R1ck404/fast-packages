// Port of internal/bundler/bundler.go for the build API: the scan phase
// (ScanBundle with the resolver, plugins, entry points, "inject" files and
// every loader), Bundle.Compile with its checks and the metafile. (The
// transform API's subset is src/bundler.mts, which this file shares the
// runtime cache with.)
//
// Go runs "parseFile" and the plugin callbacks on goroutines and collects the
// results on a channel. Here "parseFile" is an async function (plugin
// callbacks are requests to the glue, answered asynchronously), and the
// results are collected in a queue in the order they complete. The order in
// which files are scanned (and so their source indices) doesn't change the
// output: esbuild's own scan order depends on goroutine scheduling too, and the
// linker only uses orders derived from the import graph.
//
// Errors and warnings are logged like Go logs them (see logger.mts).
import { cssFeatureHas, InlineStyle as CSSInlineStyle } from "./compat_css.mjs";
import type { Timer } from "./timer.mjs";
import { API, CLIAPI, JSAPI, GoAPI } from "./logger.mjs";
import { BuiltInNodeModules, DebugMeta } from "./resolver.mjs";
import {
  KeyRange,
  ValueRange,
  rangeOfImportAssertOrWith,
  rangeOfIdentifier,
  KeyAndValueRange,
} from "./js_lexer.mjs";
import { GoPanic } from "./gopanic.mjs";
import { recoverParsePanic } from "./recover.mjs";
import { goStringsToLower } from "./gostrings.mjs";
import { unicodeToLower } from "./goregexp.mjs";
import {
  Log,
  Path,
  PathDisabled,
  PrettyPaths,
  Source,
  RANGE_ZERO,
  platformIndependentPathDirBaseExt,
  LevelDebug,
  LineColumnTracker,
  Warning,
  Debug,
  MsgData,
  Msg,
  newDeferLog,
  DeferLogNoVerboseOrDebug,
  MsgID_Bundler_RequireResolveNotExternal,
  MsgID_Bundler_IgnoredDynamicImport,
  MsgID_SourceMap_UnsupportedSourceMapComment,
  MsgID_SourceMap_MissingSourceMap,
  Range,
  MsgLocation,
  MsgID_Bundler_DifferentPathCase,
  Error as MsgError,
  MsgID_Bundler_IgnoredBareImport,
  parseWithTempLog,
} from "./logger.mjs";
import {
  ImportRecord,
  ImportEntryPoint,
  ImportStmt,
  ImportRequire,
  ImportDynamic,
  ImportRequireResolve,
  ImportAt,
  ImportComposesFrom,
  ImportURL,
  importKindStringForMetafile,
  EvaluationPhase,
  DeferPhase,
  SourcePhase,
  IsUnused,
  HandlesImportErrors,
  WasOriginallyBareImport,
  IsExternalWithoutSideEffects,
  AssertTypeJSON,
  findAssertOrWithEntry,
} from "./ast.mjs";
import {
  Options as ConfigOptions,
  InjectedFile,
  InjectableExport,
  TSOptions,
  ModeBundle,
  PlatformBrowser,
  PlatformNode,
  FormatESModule,
  formatString,
  SourceMapNone,
  LoaderNone,
  LoaderBase64,
  LoaderBinary,
  LoaderCopy,
  LoaderCSS,
  LoaderDataURL,
  LoaderDefault,
  LoaderEmpty,
  LoaderFile,
  LoaderGlobalCSS,
  LoaderJS,
  LoaderJSON,
  LoaderWithTypeJSON,
  LoaderJSX,
  LoaderLocalCSS,
  LoaderText,
  LoaderTS,
  LoaderTSNoAmbiguousLessThan,
  LoaderTSX,
  LoaderToString,
  PathTemplate,
  PathPlaceholders,
  DirPlaceholder,
  NamePlaceholder,
  HashPlaceholder,
  templateToString,
  substituteTemplate,
  hasPlaceholder,
  pluginAppliesToPath,
  cancelFlagDidCancel,
  MinifiedMetafile,
  metafileFormatMaybeRemoveWhitespace,
  loaderCanHaveSourceMap,
  loaderFromFileExtension,
} from "./config.mjs";
import {
  jsFeatureHas,
  jsFeatureOr,
  AsyncAwait,
  AsyncGenerator,
  ForAwait,
  TopLevelAwait,
  Generator,
  ObjectAccessors,
  ClassPrivateAccessor,
  ClassPrivateStaticAccessor,
  ClassField,
  ClassPrivateField,
  ClassStaticField,
  ClassPrivateStaticField,
  Class,
  ClassPrivateBrandCheck,
  ClassPrivateMethod,
  ClassPrivateStaticMethod,
  ClassStaticBlocks,
  InlineScript,
  FromBase64,
} from "./compat.mjs";
import {
  ModuleESM_MJS,
  ModuleESM_MTS,
  ModuleCommonJS_CJS,
  ModuleCommonJS_CTS,
  ModuleUnknown,
  ModuleTypeData,
  ExportsCommonJS,
  ExportsESM,
  generateNonUniqueNameFromPath,
  ensureValidIdentifier,
  Expr,
  EString,
  ENullShared,
  EObject,
  EArrow,
  Property,
  Stmt,
  SReturn,
  FnBody,
  SBlock,
  EImportString,
  ERequireString,
} from "./js_ast.mjs";
import { parse, optionsFromConfig, lazyExportAST, globResolveAST, HelperCall } from "./js_parser.mjs";
import { isIdentifier } from "./js_ident.mjs";
import { parseJSON, JSONOptions } from "./json_parser.mjs";
import { InputFile, OutputFile, JSRepr, CSSRepr, CopyRepr, EntryPoint as GraphEntryPoint, SideEffects, NoSideEffects_EmptyAST, NoSideEffects_PureData, NoSideEffects_PureData_FromPlugin, NoSideEffects_PackageJSON, HasSideEffects } from "./graph.mjs";
import { quoteForJSON, quoteSingle, utf8Len, isInsideNodeModules, parseGlobPattern, globPatternToString, decodeGoString, goStringBytes, goStringByteLength } from "./helpers.mjs";
import { goQuote } from "./gostd.mjs";
import { generateLineOffsetTables, quoteForJSONLong } from "./sourcemap.mjs";
import { parseRuntimeCached, cloneJSONValueForInject, defaultExtensionToLoaderMap } from "./bundler.mjs";
import { BufferedDigest as Digest } from "./xxhash.mjs";
import { detectContentType } from "./sniff.mjs";
import {
  makePrettyPaths,
  isPackagePath,
  parseDataURL,
  newResolver,
  sourceIndexNormal,
  sourceIndexJSStubForCSS,
  fsCacheReadFile,
  FileEntry,
  newResolveResultFromPlugin,
  newSideEffectsData,
  cloneResolveResult,
  ENOENT,
} from "./build_deps.mjs";
import { MIMETypeUnsupported, MIMETypeTextCSS, MIMETypeTextJavaScript, MIMETypeApplicationJSON } from "./dataurl.mjs";
import { parseSourceMap } from "./sourcemap_parser.mjs";
import { parse as parseCSS, optionsFromConfig as cssOptionsFromConfig } from "./css_parser.mjs";
import { SourceContent } from "./sourcemap.mjs";
import type { SourceMap } from "./sourcemap.mjs";
import { parseGoURL, isFileURL, fileURLFromFilePath, filePathFromFileURL, lastURLParseError } from "./gourl.mjs";

const RUNTIME_SOURCE_INDEX = 0; // runtime.SourceIndex

// ---------------------------------------------------------------------------
// Import attributes: logger.ImportAttributes is a sorted list of [key, value]
// pairs (Go packs them into a string); null means none

export type ImportAttributes = readonly (readonly [string, string])[] | null;

export function encodeImportAttributes(value: Record<string, string> | Map<string, string> | null): ImportAttributes {
  if (value === null) return null;
  const entries: [string, string][] = value instanceof Map ? [...value] : Object.entries(value);
  if (entries.length === 0) return null;
  // (Go: sort.Strings on the keys, by bytes; the keys are unique)
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return Object.freeze(entries.map((e) => Object.freeze([e[0], e[1]] as const)));
}

// DecodeIntoMap as the sorted object Go's service sends ("with")
export function importAttributesToObject(attrs: ImportAttributes): Record<string, string> {
  const result: Record<string, string> = {};
  if (attrs !== null) for (const [k, v] of attrs) result[k] = v;
  return result;
}

function importAttributesKey(attrs: ImportAttributes): string {
  if (attrs === null) return "";
  let key = "";
  for (const [k, v] of attrs) key += k.length + ":" + k + v.length + ":" + v;
  return key;
}

// A string key for a logger.Path (Go uses the struct as a map key)
function pathKey(path: Path): string {
  return path.namespace + "\0" + path.text + "\0" + path.ignoredSuffix + "\0" + importAttributesKey(path.importAttributes) + "\0" + path.flags;
}

// ---------------------------------------------------------------------------

class scannerFile {
  declare jsonMetadataChunk: string;
  declare pluginData: any;
  declare inputFile: InputFile;
  // JS-only: len(Source.Contents) in Go (the byte length)
  declare contentsByteLength: number;
  constructor(inputFile: InputFile = null, pluginData: any = null) {
    this.jsonMetadataChunk = "";
    this.pluginData = pluginData;
    this.inputFile = inputFile;
    this.contentsByteLength = 0;
  }
}

export class DataForSourceMap {
  declare lineOffsetTables: any;
  declare quotedContents: string[] | null;
  constructor() {
    this.lineOffsetTables = null;
    this.quotedContents = null;
  }
}

class parseArgs {
  declare fs: any;
  declare log: Log;
  declare res: any;
  declare caches: any;
  declare prettyPaths: PrettyPaths;
  declare importSource: Source | null;
  declare importWith: any;
  declare sideEffects: SideEffects;
  declare pluginData: any;
  declare inject: ((file: InjectedFile) => void) | null;
  declare uniqueKeyPrefix: string;
  declare keyPath: Path;
  declare options: ConfigOptions;
  declare importPathRange: any;
  declare sourceIndex: number;
  declare skipResolve: boolean;
}

class parseResult {
  declare resolveResults: any[];
  declare globResolveResults: Map<number, globResolveResult> | null;
  declare file: scannerFile;
  declare tlaCheck: tlaCheck;
  declare ok: boolean;
  constructor(file: scannerFile = null, ok = false) {
    this.resolveResults = [];
    this.globResolveResults = null;
    // (Go's zero value for a failed parse: a file without a representation)
    this.file = file !== null ? file : new scannerFile(new InputFile(null, null, [], "", new SideEffects(), new Source()));
    this.tlaCheck = new tlaCheck();
    this.ok = ok;
  }
}

class globResolveResult {
  declare resolveResults: Map<string, any>;
  declare absPath: string;
  declare prettyPaths: PrettyPaths;
  declare exportAlias: string;
  constructor(resolveResults: Map<string, any>, absPath: string, prettyPaths: PrettyPaths, exportAlias: string) {
    this.resolveResults = resolveResults;
    this.absPath = absPath;
    this.prettyPaths = prettyPaths;
    this.exportAlias = exportAlias;
  }
}

class tlaCheck {
  declare parent: number;
  declare depth: number;
  declare pass: number;
  declare importRecordIndex: number;
  constructor() {
    this.parent = -1; // Index32
    this.depth = -1; // Index32
    this.pass = 0;
    this.importRecordIndex = 0;
  }
}

// ast.Index32.GetIndex() on an invalid index is ^uint32(0)
function index32GetIndex(index: number) {
  return index < 0 ? 0xffffffff : index;
}

// Go's strings.TrimPrefix(strings.TrimPrefix(s, "../"), "..\\") loop
function stripLeadingDotDots(relative: string): string {
  for (;;) {
    let next = relative.startsWith("../") ? relative.slice(3) : relative;
    next = next.startsWith("..\\") ? next.slice(3) : next;
    if (relative === next) return relative;
    relative = next;
  }
}

// Byte strings: Go keeps file contents as bytes. Contents that the binary
// loaders use as bytes are kept as a JS string with one character per byte
// ("latin1"); contents that are parsed as text are decoded from UTF-8.

let latin1Decoder: TextDecoder | null = null;
export function bytesToByteString(bytes: Uint8Array): string {
  // (TextDecoder "latin1" is windows-1252 in browsers: decode by hand)
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as any);
  }
  return s;
}

export function byteStringToBytes(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

// base64.StdEncoding.EncodeToString of bytes (a byte string)
const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function base64StdEncodeByteString(s: string): string {
  const n = s.length;
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8) | s.charCodeAt(i + 2);
    out.push(base64Chars[v >> 18] + base64Chars[(v >> 12) & 63] + base64Chars[(v >> 6) & 63] + base64Chars[v & 63]);
  }
  if (i < n) {
    const v = (s.charCodeAt(i) << 16) | (i + 1 < n ? s.charCodeAt(i + 1) << 8 : 0);
    out.push(base64Chars[v >> 18] + base64Chars[(v >> 12) & 63] + (i + 1 < n ? base64Chars[(v >> 6) & 63] : "=") + "=");
  }
  return out.join("");
}

// []byte(text) as a byte string
export function utf8ByteString(text: string): string {
  return bytesToByteString(goStringBytes(text));
}

// The loaders whose contents are bytes rather than text
function loaderUsesBytes(loader: number): boolean {
  return loader === LoaderBase64 || loader === LoaderBinary || loader === LoaderDataURL || loader === LoaderFile || loader === LoaderCopy;
}

// Go: fmt.Sprintf("%sA%08d", prefix, sourceIndex)
function uniqueKeyForSourceIndex(prefix: string, sourceIndex: number): string {
  return prefix + "A" + String(sourceIndex).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// parseFile

// The contents of a file as loaded: bytes (from a plugin or the file system)
// or a JS string (stdin, already decoded)
class loadedContents {
  declare bytes: Uint8Array | null;
  declare text: string | null;
  constructor(bytes: Uint8Array | null, text: string | null) {
    this.bytes = bytes;
    this.text = text;
  }
}

async function parseFile(args: parseArgs): Promise<parseResult> {
  let pathForIdentifierName = args.keyPath.text;

  // Identifier name generation may use the name of the parent folder if the
  // file name starts with "index". However, this is problematic when the
  // parent folder includes the parent directory of what the developer
  // considers to be the root of the source tree. If that happens, strip the
  // parent folder to avoid including it in the generated name.
  const $rel = args.fs.rel(args.options.absOutputBase, pathForIdentifierName);
  if ($rel[1]) {
    pathForIdentifierName = stripLeadingDotDots($rel[0]);
  }

  const source = new Source(args.prettyPaths, generateNonUniqueNameFromPath(pathForIdentifierName), "", args.keyPath, args.sourceIndex);

  let loader: number;
  let absResolveDir: string;
  let pluginName = "";
  let pluginData: any = null;
  let contents: loadedContents;

  const stdin = args.options.stdin;
  if (stdin !== null) {
    // Special-case stdin
    contents = new loadedContents(null, stdin.contents);
    loader = stdin.loader;
    if (loader === LoaderNone) {
      loader = LoaderJS;
    }
    absResolveDir = args.options.stdin.absResolveDir;
  } else {
    const [result, ok, loaded] = await runOnLoadPlugins(
      args.options.plugins,
      args.fs,
      args.caches,
      args.log,
      source,
      args.importSource,
      args.importPathRange,
      args.pluginData,
      args.options.watchMode,
      args.options.logPathStyle,
    );
    if (!ok) {
      if (args.inject !== null) args.inject(new InjectedFile([], "", source));
      return new parseResult();
    }
    loader = result.loader;
    absResolveDir = result.absResolveDir;
    pluginName = result.pluginName;
    pluginData = result.pluginData;
    contents = loaded;
  }

  const $dbe = platformIndependentPathDirBaseExt(source.keyPath.text);
  const base = $dbe[1],
    ext = $dbe[2];

  // The special "default" loader determines the loader from the file path
  if (loader === LoaderDefault) {
    loader = loaderFromFileExtension(args.options.extensionToLoader, base + ext);
  }

  // Reject unsupported import attributes when the loader isn't "copy" (since
  // "copy" is kind of like "external"). But only do this if this file was not
  // loaded by a plugin. Plugins are allowed to assign whatever semantics they
  // want to import attributes.
  if (loader !== LoaderCopy && pluginName === "") {
    const attrs = source.keyPath.importAttributes as ImportAttributes;
    if (attrs !== null) {
      for (const [key, value] of attrs) {
        let errorText;
        let errorRange;

        // We currently only handle a few standardized types:
        if (key !== "type") {
          errorText = "Importing with the " + goQuote(key) + " attribute is not supported";
          errorRange = KeyRange;
        } else if (value === "json") {
          loader = LoaderWithTypeJSON;
          continue;
        } else if (value === "bytes") {
          loader = LoaderBinary;
          continue;
        } else if (value === "text") {
          loader = LoaderText;
          continue;
        } else {
          errorText = "Importing with a type attribute of " + goQuote(value) + " is not supported";
          errorRange = ValueRange;
        }

        // Everything else is an error
        let r = args.importPathRange;
        if (args.importWith !== null) {
          r = rangeOfImportAssertOrWith(args.importSource, findAssertOrWithEntry(args.importWith.entries, key), errorRange);
        }
        const tracker = new LineColumnTracker(args.importSource);
        args.log.addError(tracker, r, errorText);
        if (args.inject !== null) args.inject(new InjectedFile([], "", source));
        return new parseResult();
      }
    }
  }

  // JS-only: turn the contents into the string the loader works on
  let byteLength: number;
  if (loader === LoaderEmpty) {
    source.contents = "";
    byteLength = 0;
  } else if (loaderUsesBytes(loader)) {
    source.contents = contents.bytes !== null ? bytesToByteString(contents.bytes) : utf8ByteString(contents.text);
    byteLength = source.contents.length;
  } else if (contents.bytes !== null) {
    source.contents = decodeGoString(contents.bytes);
    byteLength = contents.bytes.length;
  } else {
    source.contents = contents.text;
    byteLength = -1; // (computed when needed)
  }

  const result = new parseResult(new scannerFile(new InputFile(null, null, [], "", args.sideEffects, source, loader), pluginData), false);
  result.file.contentsByteLength = byteLength;

  // (Go: a deferred recover() turns a panic into an error; see recoverParsePanic)
  try {
  const parserOptions = () => {
    const o = optionsFromConfig(args.options);
    return o;
  };

  switch (loader) {
    case LoaderJS:
    case LoaderEmpty: {
      const $p = parseWithTempLog(args.log, (tempLog) => parse(tempLog, source, parserOptions()));
      const ast = $p[0];
      if (ast !== null && ast.parts.length <= 1) {
        // Ignore the implicitly-generated namespace export part
        result.file.inputFile.sideEffects = new SideEffects(result.file.inputFile.sideEffects.data, NoSideEffects_EmptyAST);
      }
      result.file.inputFile.repr = new JSRepr();
      result.file.inputFile.repr.ast = ast;
      result.ok = $p[1];
      break;
    }

    case LoaderJSX: {
      const o = parserOptions();
      o.jsx = args.options.jsx.clone();
      o.jsx.parse = true;
      const $p = parseWithTempLog(args.log, (tempLog) => parse(tempLog, source, o));
      const ast = $p[0];
      if (ast !== null && ast.parts.length <= 1) {
        result.file.inputFile.sideEffects = new SideEffects(result.file.inputFile.sideEffects.data, NoSideEffects_EmptyAST);
      }
      result.file.inputFile.repr = new JSRepr();
      result.file.inputFile.repr.ast = ast;
      result.ok = $p[1];
      break;
    }

    case LoaderTS:
    case LoaderTSNoAmbiguousLessThan: {
      const o = parserOptions();
      o.ts = new TSOptions(args.options.ts.config, true, loader === LoaderTSNoAmbiguousLessThan);
      const $p = parseWithTempLog(args.log, (tempLog) => parse(tempLog, source, o));
      const ast = $p[0];
      if (ast !== null && ast.parts.length <= 1) {
        result.file.inputFile.sideEffects = new SideEffects(result.file.inputFile.sideEffects.data, NoSideEffects_EmptyAST);
      }
      result.file.inputFile.repr = new JSRepr();
      result.file.inputFile.repr.ast = ast;
      result.ok = $p[1];
      break;
    }

    case LoaderTSX: {
      const o = parserOptions();
      o.ts = new TSOptions(args.options.ts.config, true, args.options.ts.noAmbiguousLessThan);
      o.jsx = args.options.jsx.clone();
      o.jsx.parse = true;
      const $p = parseWithTempLog(args.log, (tempLog) => parse(tempLog, source, o));
      const ast = $p[0];
      if (ast !== null && ast.parts.length <= 1) {
        result.file.inputFile.sideEffects = new SideEffects(result.file.inputFile.sideEffects.data, NoSideEffects_EmptyAST);
      }
      result.file.inputFile.repr = new JSRepr();
      result.file.inputFile.repr.ast = ast;
      result.ok = $p[1];
      break;
    }

    case LoaderCSS:
    case LoaderGlobalCSS:
    case LoaderLocalCSS: {
      // (caches.CSSCache.Parse: the messages go through a temporary log; the
      // cache itself only saves time)
      const ast = parseWithTempLog(args.log, (tempLog) => parseCSS(tempLog, source, cssOptionsFromConfig(loader, args.options)));
      result.file.inputFile.repr = new CSSRepr(ast);
      result.ok = true;
      break;
    }

    case LoaderJSON:
    case LoaderWithTypeJSON: {
      const $j = parseWithTempLog(args.log, (tempLog) => parseJSON(tempLog, source, new JSONOptions(args.options.unsupportedJSFeatures)));
      const expr = $j[0] !== null ? $j[0] : new Expr(null, 0); // (Go's zero Expr when the parse failed)
      const ast = lazyExportAST(args.log, source, optionsFromConfig(args.options), expr, null);
      if (loader === LoaderWithTypeJSON) {
        // The exports kind defaults to "none", in which case the linker picks
        // either ESM or CommonJS depending on the situation. Dynamic imports
        // causes the linker to pick CommonJS which uses "require()" and then
        // converts the return value to ESM, which adds extra properties that
        // aren't supposed to be there when "{ with: { type: 'json' } }" is
        // present. So if there's an import attribute, we force the type to
        // be ESM to avoid this.
        ast.exportsKind = ExportsESM;
      }
      result.file.inputFile.sideEffects = new SideEffects(result.file.inputFile.sideEffects.data, pluginName !== "" ? NoSideEffects_PureData_FromPlugin : NoSideEffects_PureData);
      result.file.inputFile.repr = new JSRepr();
      result.file.inputFile.repr.ast = ast;
      result.ok = $j[1];
      break;
    }

    case LoaderText: {
      // Strip any UTF-8 BOM from the text
      if (source.contents.charCodeAt(0) === 0xfeff) {
        source.contents = source.contents.slice(1);
        if (byteLength >= 0) byteLength -= 3;
        result.file.contentsByteLength = byteLength;
      }
      const encoded = base64StdEncodeByteString(utf8ByteString(source.contents));
      // (helpers.StringToUTF16: raw bytes of invalid UTF-8 become U+FFFD)
      const expr = new Expr(new EString(source.contents.isWellFormed() ? source.contents : source.contents.toWellFormed()), 0);
      const ast = lazyExportAST(args.log, source, optionsFromConfig(args.options), expr, null);
      ast.urlForCSS = "data:text/plain;base64," + encoded;
      result.file.inputFile.sideEffects = new SideEffects(result.file.inputFile.sideEffects.data, pluginName !== "" ? NoSideEffects_PureData_FromPlugin : NoSideEffects_PureData);
      result.file.inputFile.repr = new JSRepr();
      result.file.inputFile.repr.ast = ast;
      result.ok = true;
      break;
    }

    case LoaderBase64: {
      const mimeType = guessMimeType(ext, source.contents);
      const encoded = base64StdEncodeByteString(source.contents);
      const expr = new Expr(new EString(encoded), 0);
      const ast = lazyExportAST(args.log, source, optionsFromConfig(args.options), expr, null);
      ast.urlForCSS = "data:" + mimeType + ";base64," + encoded;
      result.file.inputFile.sideEffects = new SideEffects(result.file.inputFile.sideEffects.data, pluginName !== "" ? NoSideEffects_PureData_FromPlugin : NoSideEffects_PureData);
      result.file.inputFile.repr = new JSRepr();
      result.file.inputFile.repr.ast = ast;
      result.ok = true;
      break;
    }

    case LoaderBinary: {
      const encoded = base64StdEncodeByteString(source.contents);
      const expr = new Expr(new EString(encoded), 0);
      let helper: HelperCall;
      if (jsFeatureHas(args.options.unsupportedJSFeatures, FromBase64)) {
        if (args.options.platform === PlatformNode) {
          helper = new HelperCall(null, "__toBinaryNode");
        } else {
          helper = new HelperCall(null, "__toBinary");
        }
      } else {
        helper = new HelperCall(["Uint8Array", "fromBase64"], "");
      }
      const ast = lazyExportAST(args.log, source, optionsFromConfig(args.options), expr, helper);
      ast.urlForCSS = "data:application/octet-stream;base64," + encoded;
      result.file.inputFile.sideEffects = new SideEffects(result.file.inputFile.sideEffects.data, pluginName !== "" ? NoSideEffects_PureData_FromPlugin : NoSideEffects_PureData);
      result.file.inputFile.repr = new JSRepr();
      result.file.inputFile.repr.ast = ast;
      result.ok = true;
      break;
    }

    case LoaderDataURL: {
      const mimeType = guessMimeType(ext, source.contents);
      let url = encodeStringAsShortestDataURL(mimeType, source.contents);
      if (source.keyPath.ignoredSuffix.startsWith("#")) {
        // Preserve URL fragments as they are meaningful in CSS
        url += source.keyPath.ignoredSuffix;
      }
      const expr = new Expr(new EString(url), 0);
      const ast = lazyExportAST(args.log, source, optionsFromConfig(args.options), expr, null);
      ast.urlForCSS = url;
      result.file.inputFile.sideEffects = new SideEffects(result.file.inputFile.sideEffects.data, pluginName !== "" ? NoSideEffects_PureData_FromPlugin : NoSideEffects_PureData);
      result.file.inputFile.repr = new JSRepr();
      result.file.inputFile.repr.ast = ast;
      result.ok = true;
      break;
    }

    case LoaderFile: {
      const uniqueKey = uniqueKeyForSourceIndex(args.uniqueKeyPrefix, args.sourceIndex);
      const uniqueKeyPath = uniqueKey + source.keyPath.ignoredSuffix;
      const expr = new Expr(new EString(uniqueKeyPath, 0, false, false, true), 0);
      const ast = lazyExportAST(args.log, source, optionsFromConfig(args.options), expr, null);
      ast.urlForCSS = uniqueKeyPath;
      result.file.inputFile.sideEffects = new SideEffects(result.file.inputFile.sideEffects.data, pluginName !== "" ? NoSideEffects_PureData_FromPlugin : NoSideEffects_PureData);
      result.file.inputFile.repr = new JSRepr();
      result.file.inputFile.repr.ast = ast;
      result.ok = true;

      // Mark that this file is from the "file" loader
      result.file.inputFile.uniqueKeyForAdditionalFile = uniqueKey;
      break;
    }

    case LoaderCopy: {
      const uniqueKey = uniqueKeyForSourceIndex(args.uniqueKeyPrefix, args.sourceIndex);
      const uniqueKeyPath = uniqueKey + source.keyPath.ignoredSuffix;
      result.file.inputFile.repr = new CopyRepr(uniqueKeyPath);
      result.ok = true;

      // Mark that this file is from the "copy" loader
      result.file.inputFile.uniqueKeyForAdditionalFile = uniqueKey;
      break;
    }

    default: {
      let message;
      if (source.keyPath.namespace === "file" && ext !== "") {
        message = "No loader is configured for " + goQuote(ext) + " files: " + source.prettyPaths.select(args.options.logPathStyle);
      } else {
        message = "Do not know how to load path: " + source.prettyPaths.select(args.options.logPathStyle);
      }
      const tracker = new LineColumnTracker(args.importSource);
      args.log.addError(tracker, args.importPathRange, message);
    }
  }

  // Only continue now if parsing was successful
  if (result.ok) {
    // Run the resolver on the parse thread so it's not run on the main thread.
    // That way the main thread isn't blocked if the resolver takes a while.
    const recordsPtr = result.file.inputFile.repr.importRecords();
    if (args.options.mode === ModeBundle && !args.skipResolve && recordsPtr !== null) {
      // Clone the import records because they will be mutated later
      const records = new Array(recordsPtr.length);
      for (let i = 0; i < records.length; i++) records[i] = recordsPtr[i].clone();
      result.file.inputFile.repr.ast.importRecords = records;
      result.resolveResults = new Array(records.length).fill(null);

      if (records.length > 0) {
        // (Go: a map from {kind, path, attrs} to the cached entry)
        const resolverCache = new Map<string, { resolveResult: any; debug: DebugMeta; didLogError: boolean }>();
        const tracker = new LineColumnTracker(source);

        for (let importRecordIndex = 0; importRecordIndex < records.length; importRecordIndex++) {
          // Don't try to resolve imports that are already resolved
          const record = records[importRecordIndex];
          if (record.sourceIndex >= 0) {
            continue;
          }

          // Encode the import attributes
          let attrs: ImportAttributes = null;
          if (record.assertOrWith !== null && record.assertOrWith.keyword === 1 /* ast.WithKeyword */) {
            const data = new Map<string, string>();
            for (const entry of record.assertOrWith.entries) data.set(entry.key, entry.value);
            attrs = encodeImportAttributes(data);
          }

          // Special-case glob pattern imports
          if (record.globPattern !== null) {
            let prettyPath = globPatternToString(record.globPattern.parts);
            let phase = "";
            switch (record.phase) {
              case DeferPhase:
                phase = ".defer";
                break;
              case SourcePhase:
                phase = ".source";
                break;
            }
            switch (record.globPattern.kind) {
              case ImportRequire:
                prettyPath = "require" + phase + "(" + goQuote(prettyPath) + ")";
                break;
              case ImportDynamic:
                prettyPath = "import" + phase + "(" + goQuote(prettyPath) + ")";
                break;
            }
            const $g = args.res.resolveGlob(absResolveDir, record.globPattern.parts, record.globPattern.kind, prettyPath);
            const results: Map<string, any> | null = $g[0];
            if (results !== null) {
              const msg = $g[1];
              if (msg !== null) {
                args.log.addID(msg.id, msg.kind, tracker, record.range, msg.text);
              }
              if (result.globResolveResults === null) {
                result.globResolveResults = new Map();
              }
              let allAreExternal = true;
              for (const [key, r] of results) {
                if (!r.pathPair.isExternal) {
                  allAreExternal = false;
                }
                // (Go stores a copy of each result)
                const copy = cloneResolveResult(r);
                copy.pathPair.primary = withImportAttributes(copy.pathPair.primary, attrs);
                if (copy.pathPair.hasSecondary()) {
                  copy.pathPair.secondary = withImportAttributes(copy.pathPair.secondary, attrs);
                }
                results.set(key, copy);
              }
              result.globResolveResults.set(
                importRecordIndex,
                new globResolveResult(
                  results,
                  args.fs.join(absResolveDir, "(glob)"),
                  new PrettyPaths(prettyPath + " in " + result.file.inputFile.source.prettyPaths.abs, prettyPath + " in " + result.file.inputFile.source.prettyPaths.rel),
                  record.globPattern.exportAlias,
                ),
              );

              // Forbid bundling of imports with explicit phases
              if (record.phase !== EvaluationPhase) {
                reportExplicitPhaseImport(args.log, tracker, record.range, record.phase, allAreExternal, args.options.outputFormat);
              }
            } else {
              args.log.addError(tracker, record.range, "Could not resolve " + prettyPath);
            }
            continue;
          }

          // Ignore records that the parser has discarded. This is used to remove
          // type-only imports in TypeScript files.
          if ((record.flags & IsUnused) !== 0) {
            continue;
          }

          // Cache the path in case it's imported multiple times in this file
          const cacheKey = record.kind + "\0" + record.path.text + "\0" + importAttributesKey(attrs);
          let entry = resolverCache.get(cacheKey);
          if (entry !== undefined) {
            result.resolveResults[importRecordIndex] = entry.resolveResult;
          } else {
            // Run the resolver and log an error if the path couldn't be resolved
            const $r = await runOnResolvePlugins(
              args.options.plugins,
              args.res,
              args.log,
              args.fs,
              args.caches,
              source,
              record.range,
              source.keyPath,
              record.path.text,
              importAttributesToObject(attrs),
              record.kind,
              absResolveDir,
              pluginData,
              args.options.logPathStyle,
            );
            const resolveResult = $r[0];
            if (resolveResult !== null) {
              resolveResult.pathPair.primary = withImportAttributes(resolveResult.pathPair.primary, attrs);
              if (resolveResult.pathPair.secondary !== null && resolveResult.pathPair.secondary !== undefined && resolveResult.pathPair.secondary.text !== "") {
                resolveResult.pathPair.secondary = withImportAttributes(resolveResult.pathPair.secondary, attrs);
              }
            }
            entry = { resolveResult, debug: $r[2], didLogError: $r[1] };
            resolverCache.set(cacheKey, entry);

            // All "require.resolve()" imports should be external because we don't
            // want to waste effort traversing into them
            if (record.kind === ImportRequireResolve) {
              if (resolveResult !== null && resolveResult.pathPair.isExternal) {
                // Allow path substitution as long as the result is external
                result.resolveResults[importRecordIndex] = resolveResult;
              } else if ((record.flags & HandlesImportErrors) === 0) {
                args.log.addID(MsgID_Bundler_RequireResolveNotExternal, Warning, tracker, record.range, goQuote(record.path.text) + ' should be marked as external for use with "require.resolve"');
              }
              continue;
            }
          }

          // Check whether we should log an error every time the result is nil,
          // even if it's from the cache. Do this because the error may not
          // have been logged for nil entries if the previous instances had
          // the "HandlesImportErrors" flag.
          if (entry.resolveResult === null) {
            // Failed imports inside a try/catch are silently turned into
            // external imports instead of causing errors. This matches a common
            // code pattern for conditionally importing a module with a graceful
            // fallback.
            if (!entry.didLogError && (record.flags & HandlesImportErrors) === 0) {
              // Report an error
              const $e = resolveFailureErrorTextSuggestionNotes(
                args.res,
                record.path.text,
                record.kind,
                pluginName,
                args.fs,
                absResolveDir,
                args.options.platform,
                source.prettyPaths,
                entry.debug.modifiedImportPath,
                args.options.logPathStyle,
              );
              entry.debug.logErrorMsg(args.log, source, record.range, $e[0], $e[1], $e[2]);

              // Only report this error once per unique import path in the file
              entry.didLogError = true;
            } else if (!entry.didLogError && (record.flags & HandlesImportErrors) !== 0) {
              // Report a debug message about why there was no error
              args.log.addIDWithNotes(
                MsgID_Bundler_IgnoredDynamicImport,
                Debug,
                tracker,
                record.range,
                "Importing " + goQuote(record.path.text) + " was allowed even though it could not be resolved because dynamic import failures appear to be handled here:",
                [tracker.msgData(rangeOfIdentifier(source, record.errorHandlerLoc), "The handler for dynamic import failures is here:")],
              );
            }
            continue;
          }

          // Forbid bundling of imports with explicit phases
          if (record.phase !== EvaluationPhase) {
            reportExplicitPhaseImport(args.log, tracker, record.range, record.phase, entry.resolveResult.pathPair.isExternal, args.options.outputFormat);
          }

          result.resolveResults[importRecordIndex] = entry.resolveResult;
        }
      }
    }

    // Attempt to parse the source map if present
    if (loaderCanHaveSourceMap(loader) && args.options.sourceMap !== SourceMapNone) {
      const repr = result.file.inputFile.repr;
      const sourceMapComment = repr instanceof JSRepr || repr instanceof CSSRepr ? repr.ast.sourceMapComment : null;
      if (sourceMapComment !== null && sourceMapComment.text !== "") {
        const sourceMap = loadInputSourceMap(args.log, args.fs, args.caches, source, sourceMapComment, absResolveDir, args.options, args.prettyPaths);
        if (sourceMap !== undefined) result.file.inputFile.inputSourceMap = sourceMap;
      }
    }
  }

  // Note: We must always send on the "inject" channel before we send on the
  // "results" channel to avoid deadlock
  if (args.inject !== null) {
    let exports: InjectableExport[] = [];

    const repr = result.file.inputFile.repr;
    if (repr instanceof JSRepr) {
      const aliases = [...repr.ast.namedExports.keys()];
      aliases.sort(compareStringsGo); // Sort for determinism
      exports = new Array(aliases.length);
      for (let i = 0; i < aliases.length; i++) {
        exports[i] = new InjectableExport(aliases[i], repr.ast.namedExports.get(aliases[i]).aliasLoc);
      }
    }

    // Once we send on the "inject" channel, the main thread may mutate the
    // "options" object to populate the "InjectedFiles" field. So we must
    // only send on the "inject" channel after we're done using the "options"
    // object so we don't introduce a data race.
    const isCopyLoader = loader === LoaderCopy;
    if (isCopyLoader && args.skipResolve) {
      // This is not allowed because the import path would have to be rewritten,
      // but import paths are not rewritten when bundling isn't enabled.
      args.log.addError(null, RANGE_ZERO, "Cannot inject " + goQuote(source.prettyPaths.select(args.options.logPathStyle)) + ' with the "copy" loader without bundling enabled');
    }
    args.inject(new InjectedFile(exports, "", source, isCopyLoader));
  }
  } catch (e) {
    recoverParsePanic(e, args.log, source.prettyPaths.select(args.options.logPathStyle));
    // (Go does not answer an injected file here, and would wait forever)
    if (args.inject !== null) args.inject(new InjectedFile([], "", source));
    return result;
  }

  return result;
}

// Go's sort.Strings: byte-wise (UTF-8) order
export function compareStringsGo(a: string, b: string): number {
  // UTF-16 code unit order equals UTF-8 byte order except for surrogates vs.
  // U+E000..U+FFFF; handle the general case exactly
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a.charCodeAt(i),
      cb = b.charCodeAt(i);
    if (ca !== cb) {
      const sa = ca >= 0xd800 && ca <= 0xdfff,
        sb = cb >= 0xd800 && cb <= 0xdfff;
      if (sa !== sb) return sa ? 1 : -1;
      return ca < cb ? -1 : 1;
    }
  }
  return a.length - b.length;
}

function withImportAttributes(path: Path, attrs: ImportAttributes): Path {
  const p = path.clone();
  p.importAttributes = attrs;
  return p;
}

// The part of parseFile that loads a file's input source map from its
// "sourceMappingURL" comment: the parsed source map (null if it did not
// parse), or undefined if there is none (also used by transforms, with Go's
// empty mock file system)
export function loadInputSourceMap(log0: Log, fs: any, caches: any, source: Source, sourceMapComment: any, absResolveDir: string, options: ConfigOptions, filePrettyPaths: PrettyPaths): SourceMap | null | undefined {
  const tracker = new LineColumnTracker(source);
        const $x = extractSourceMapFromComment(log0, fs, caches, source, tracker, sourceMapComment, absResolveDir, options.logPathStyle);
        const path = $x[0],
          contents = $x[1];
        if (contents === null) return undefined;
        {
          const prettyPaths = makePrettyPaths(fs, path);
          const log = newDeferLog(DeferLogNoVerboseOrDebug, log0.overrides);

          const sourceMap = parseSourceMap(log, new Source(prettyPaths, "", contents, path));

          const msgs = log.done();
          if (msgs.length > 0) {
            let text;
            if (path.namespace === "file") {
              text =
                "The source map " +
                goQuote(prettyPaths.select(options.logPathStyle)) +
                " was referenced by the file " +
                goQuote(filePrettyPaths.select(options.logPathStyle)) +
                " here:";
            } else {
              text = "This source map came from the file " + goQuote(filePrettyPaths.select(options.logPathStyle)) + " here:";
            }
            const note = tracker.msgData(sourceMapComment.range, text);
            for (const msg of msgs) {
              msg.notes = msg.notes === null ? [note] : [...msg.notes, note];
              log0.addMsg(msg);
            }
          }

          // If "sourcesContent" entries aren't present, try filling them in
          // using the file system. This includes both generating the entire
          // "sourcesContent" array if it's absent as well as filling in
          // individual null entries in the array if the array is present.
          if (sourceMap !== null && !options.excludeSourcesContent) {
            // Make sure "sourcesContent" is big enough
            while (sourceMap.sourcesContent.length < sourceMap.sources.length) {
              sourceMap.sourcesContent.push(new SourceContent());
            }

            for (let i = 0; i < sourceMap.sources.length; i++) {
              let sourceText = sourceMap.sources[i];

              // Convert absolute paths to "file://" URLs, which is especially important
              // for Windows where file paths don't look like URLs at all (they use "\"
              // as a path separator and start with a "C:\" volume label instead of "/").
              if (path.namespace === "file" && fs.isAbs(sourceText)) {
                sourceText = fileURLFromFilePath(sourceText).toString();
                sourceMap.sources[i] = sourceText;
              }

              // Attempt to fill in null entries using the file system
              if (sourceMap.sourcesContent[i].value === null) {
                const sourceURL = parseGoURL(sourceText);
                if (sourceURL !== null && isFileURL(sourceURL)) {
                  const $f = fsCacheReadFile(caches, fs, filePathFromFileURL(fs, sourceURL));
                  if ($f[1] === null) {
                    sourceMap.sourcesContent[i] = new SourceContent("", decodeGoString($f[0]));
                  }
                }
              }
            }
          }

          return sourceMap;
        }
}

// extractSourceMapFromComment. Returns [path, contents or null].
function extractSourceMapFromComment(
  log: Log,
  fs: any,
  caches: any,
  source: Source,
  tracker: LineColumnTracker,
  comment: any,
  absResolveDir: string,
  logPathStyle: number,
): [Path, string | null] {
  // Support data URLs
  const $d = parseDataURL(comment.text);
  if ($d[1]) {
    const $data = $d[0].decodeData();
    if ($data[1] !== null) {
      log.addID(MsgID_SourceMap_UnsupportedSourceMapComment, Warning, tracker, comment.range, "Unsupported source map comment: " + $data[1]);
      return [new Path(), null];
    }
    const path = source.keyPath.clone();
    path.ignoredSuffix = "#sourceMappingURL";
    return [path, decodeGoString($data[0])];
  }

  // Support file URLs of two forms:
  //
  //   Relative: "./foo.js.map"
  //   Absolute: "file:///Users/User/Desktop/foo.js.map"
  //
  let absPath: string;
  const commentURL = parseGoURL(comment.text);
  if (commentURL === null) {
    // Show a warning if the comment can't be parsed as a URL
    log.addID(MsgID_SourceMap_UnsupportedSourceMapComment, Warning, tracker, comment.range, "Unsupported source map comment: " + lastURLParseError);
    return [new Path(), null];
  } else if (commentURL.scheme !== "" && commentURL.scheme !== "file") {
    // URLs with schemes other than "file" are unsupported (e.g. "https"),
    // but don't warn the user about this because it's not a bug they can fix
    log.addID(MsgID_SourceMap_UnsupportedSourceMapComment, Debug, tracker, comment.range, "Unsupported source map comment: Unsupported URL scheme " + goQuote(commentURL.scheme));
    return [new Path(), null];
  } else if (commentURL.host !== "" && commentURL.host !== "localhost") {
    // File URLs with hosts are unsupported (e.g. "file://foo.js.map")
    log.addID(
      MsgID_SourceMap_UnsupportedSourceMapComment,
      Warning,
      tracker,
      comment.range,
      "Unsupported source map comment: Unsupported host " + goQuote(commentURL.host) + " in file URL",
    );
    return [new Path(), null];
  } else if (isFileURL(commentURL)) {
    // Handle absolute file URLs
    absPath = filePathFromFileURL(fs, commentURL);
  } else if (absResolveDir === "") {
    // Fail if plugins don't set a resolve directory
    log.addID(MsgID_SourceMap_UnsupportedSourceMapComment, Debug, tracker, comment.range, "Unsupported source map comment: Cannot resolve relative URL without a resolve directory");
    return [new Path(), null];
  } else {
    // Join the (potentially relative) URL path from the comment text
    // to the resolve directory path to form the final absolute path
    const absResolveURL = fileURLFromFilePath(absResolveDir);
    if (!absResolveURL.path.endsWith("/")) {
      absResolveURL.path += "/";
    }
    absPath = filePathFromFileURL(fs, absResolveURL.resolveReference(commentURL));
  }

  // Try to read the file contents
  const path = new Path(absPath, "file");
  const $f = fsCacheReadFile(caches, fs, absPath);
  if ($f[1] === ENOENT) {
    log.addID(MsgID_SourceMap_MissingSourceMap, Debug, tracker, comment.range, "Cannot read file: " + absPath);
    return [new Path(), null];
  } else if ($f[1] !== null) {
    const prettyPaths = makePrettyPaths(fs, path);
    log.addID(MsgID_SourceMap_MissingSourceMap, Warning, tracker, comment.range, "Cannot read file " + goQuote(prettyPaths.select(logPathStyle)) + ": " + $f[1].error());
    return [new Path(), null];
  }
  return [path, decodeGoString($f[0])];
}

// Returns true if extractSourceMapFromComment is known to find no source map
// for this comment without a warning (conservative; see bundler.mts)
const ignoredHTTPSourceMapURL = /^https?:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=@/-]*)?$/;
const ignoredRelativeSourceMapURL = /^(?!\/\/)[A-Za-z0-9._~!$&'()*+,;=@/-]+$/;
function sourceMapCommentIsIgnored(text: string, absResolveDir: string): boolean {
  if (text.startsWith("data:")) return false;
  if (ignoredHTTPSourceMapURL.test(text)) return true;
  // Relative URLs are ignored without a resolve directory
  return absResolveDir === "" && ignoredRelativeSourceMapURL.test(text) && !text.startsWith("/");
}

function reportExplicitPhaseImport(log: Log, tracker: LineColumnTracker, r: Range, phase: number, isExternal: boolean, format: number) {
  let phaseText;
  switch (phase) {
    case DeferPhase:
      phaseText = "deferred";
      break;
    case SourcePhase:
      phaseText = "source phase";
      break;
    default:
      return;
  }
  if (format !== FormatESModule) {
    log.addError(tracker, r, "Bundling " + phaseText + " imports with the " + goQuote(formatString(format)) + " output format is not supported");
  } else if (!isExternal) {
    log.addError(tracker, r, "Bundling with " + phaseText + " imports is not supported unless they are external");
  }
}

// Returns [text, suggestion, notes]
export function resolveFailureErrorTextSuggestionNotes(
  res: any,
  path: string,
  kind: number,
  pluginName: string,
  fs: any,
  absResolveDir: string,
  platform: number,
  originatingFilePaths: PrettyPaths,
  modifiedImportPath: string,
  logPathStyle: number,
): [string, string, MsgData[] | null] {
  let text;
  let suggestion = "";
  let notes: MsgData[] | null = null;
  if (modifiedImportPath !== "") {
    text = "Could not resolve " + goQuote(modifiedImportPath) + " (originally " + goQuote(path) + ")";
    notes = [
      new MsgData(
        null,
        null,
        "The path " +
          goQuote(path) +
          " was remapped to " +
          goQuote(modifiedImportPath) +
          " using the alias feature, which then couldn't be resolved. " +
          "Keep in mind that import path aliases are resolved in the current working directory.",
      ),
    ];
    path = modifiedImportPath;
  } else {
    text = "Could not resolve " + goQuote(path);
  }
  let hint = "";

  if (isPackagePath(path) && !fs.isAbs(path)) {
    hint = "You can mark the path " + goQuote(path) + " as external to exclude it from the bundle, which will remove this error and leave the unresolved path in the bundle.";
    if (kind === ImportRequire) {
      hint += ' You can also surround this "require" call with a try/catch block to handle this failure at run-time instead of bundle-time.';
    } else if (kind === ImportDynamic) {
      hint += ' You can also add ".catch()" here to handle this failure at run-time instead of bundle-time.';
    }
    if (pluginName === "" && !fs.isAbs(path)) {
      const query = res.probeResolvePackageAsRelative(absResolveDir, path, kind)[0];
      if (query !== null) {
        const prettyPaths = makePrettyPaths(fs, query.pathPair.primary);
        hint =
          "Use the relative path " +
          goQuote("./" + path) +
          " to reference the file " +
          goQuote(prettyPaths.select(logPathStyle)) +
          ". " +
          'Without the leading "./", the path ' +
          goQuote(path) +
          " is being interpreted as a package path instead.";
        suggestion = quoteForJSON("./" + path, false);
      }
    }
  }

  if (platform !== PlatformNode) {
    const pkg = path.startsWith("node:") ? path.slice(5) : path;
    if (BuiltInNodeModules.has(pkg)) {
      let how = "";
      switch (API.kind) {
        case CLIAPI:
          how = "--platform=node";
          break;
        case JSAPI:
          how = "platform: 'node'";
          break;
        case GoAPI:
          how = "Platform: api.PlatformNode";
          break;
      }
      hint =
        "The package " +
        goQuote(path) +
        " wasn't found on the file system but is built into node. " +
        "Are you trying to bundle for node? You can use " +
        goQuote(how) +
        " to do that, which will remove this error.";
    }
  }

  if (absResolveDir === "" && pluginName !== "") {
    let where = "";
    if (originatingFilePaths.abs !== "" || originatingFilePaths.rel !== "") {
      where = " for the file " + goQuote(originatingFilePaths.select(logPathStyle));
    }
    hint = "The plugin " + goQuote(pluginName) + " didn't set a resolve directory" + where + ", " + "so esbuild did not search for " + goQuote(path) + " on the file system.";
  }

  if (hint !== "") {
    if (notes === null) notes = [];
    if (modifiedImportPath !== "") {
      // Add a newline if there's already a paragraph of text
      notes.push(new MsgData());

      // Don't add a suggestion if the path was rewritten using an alias
      suggestion = "";
    }
    notes.push(new MsgData(null, null, hint));
  }
  return [text, suggestion, notes];
}

// guessMimeType ("contents" is a byte string)
export function guessMimeType(extension: string, contents: string): string {
  let mimeType = mimeTypeByExtension(extension);
  if (mimeType === "") {
    mimeType = detectContentType(contents);
  }

  // Turn "text/plain; charset=utf-8" into "text/plain;charset=utf-8"
  return mimeType.replaceAll("; ", ";");
}

// helpers.EncodeStringAsShortestDataURL on a byte string
export function encodeStringAsShortestDataURL(mimeType: string, text: string): string {
  // Try "data:mimeType;base64,..."
  let encoded = "data:" + mimeType + ";base64," + base64StdEncodeByteString(text);

  // Try "data:mimeType,..." (percent-escaped)
  const [percent, ok] = encodeStringAsPercentEscapedDataURL(mimeType, text);
  if (ok && percent.length < encoded.length) {
    encoded = percent;
  }
  return encoded;
}

// helpers.EncodeStringAsPercentEscapedDataURL on a byte string. Go decodes
// rune by rune and gives up on invalid UTF-8; here the whole text is checked
// first (the same thing for the result), then walked by UTF-8 sequence.
function encodeStringAsPercentEscapedDataURL(mimeType: string, text: string): [string, boolean] {
  const hex = "0123456789ABCDEF";
  let sb = "data:" + mimeType + ",";
  let i = 0;
  const n = text.length;
  let runStart = 0;

  // Scan for trailing characters that need to be escaped
  let trailingStart = n;
  while (trailingStart > 0) {
    const c = text.charCodeAt(trailingStart - 1);
    if (c > 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) break;
    trailingStart--;
  }

  // We can't encode invalid UTF-8 data
  if (decodeUTF8ByteStringOrNull(text) === null) return ["", false];

  for (; i < n; ) {
    const c = text.charCodeAt(i);
    let width = 1;
    if (c >= 0x80) {
      width = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : 2;
    }

    // Escape this character if needed
    if (c === 0x09 || c === 0x0a || c === 0x0d || c === 0x23 /* # */ || i >= trailingStart || (c === 0x25 /* % */ && i + 2 < n && isHex(text.charCodeAt(i + 1)) && isHex(text.charCodeAt(i + 2)))) {
      if (runStart < i) {
        sb += text.slice(runStart, i);
      }
      sb += "%" + hex[c >> 4] + hex[c & 15];
      runStart = i + width;
    }

    i += width;
  }

  if (runStart < n) {
    sb += text.slice(runStart);
  }

  // The result is a byte string again: turn it into a JS string
  return [decodeUTF8ByteStringOrNull(sb), true];
}

function isHex(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

let utf8Decoder: TextDecoder | null = null;
function decodeUTF8ByteStringOrNull(s: string): string | null {
  if (utf8Decoder === null) utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    return utf8Decoder.decode(byteStringToBytes(s));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plugins

// bundler.go sanitizeLocation
function sanitizeLocation(fs: any, loc: MsgLocation | null) {
  if (loc !== null) {
    if (loc.namespace === "") {
      loc.namespace = "file";
    }
    if (loc.file.abs !== "" || loc.file.rel !== "") {
      loc.file = makePrettyPaths(fs, new Path(loc.file.abs, loc.namespace));
    }
  }
}

// bundler.go logPluginMessages ("thrown" is the text of the thrown error)
function logPluginMessages(fs: any, log: Log, name: string, msgs: Msg[], thrown: string | null, importSource: Source | null, importPathRange: any): boolean {
  let didLogError = false;
  const tracker = new LineColumnTracker(importSource);

  // Report errors and warnings generated by the plugin
  for (const msg of msgs) {
    if (msg.pluginName === "") {
      msg.pluginName = name;
    }
    if (msg.kind === MsgError) {
      didLogError = true;
    }

    // Sanitize the locations
    if (msg.notes !== null) for (const note of msg.notes) sanitizeLocation(fs, note.location);
    if (msg.data.location === null) {
      msg.data.location = tracker.msgLocationOrNil(importPathRange);
    } else {
      sanitizeLocation(fs, msg.data.location);
      if (importSource !== null) {
        if (msg.data.location.file.abs === "" && msg.data.location.file.rel === "") {
          msg.data.location.file = importSource.prettyPaths;
        }
        const note = tracker.msgData(importPathRange, "The plugin " + goQuote(name) + " was triggered by this import");
        msg.notes = msg.notes === null ? [note] : [...msg.notes, note];
      }
    }

    log.addMsg(msg);
  }

  // Report errors thrown by the plugin itself
  if (thrown !== null) {
    didLogError = true;
    // (UserDetail is the Go error, which the service encodes as no detail)
    log.addMsg(new Msg(null, name, new MsgData(null, tracker.msgLocationOrNil(importPathRange), thrown), MsgError));
  }

  return didLogError;
}

// RunOnResolvePlugins. Returns [ResolveResult | null, didLogError, DebugMeta].
export async function runOnResolvePlugins(
  plugins: any[],
  res: any,
  log: Log,
  fs: any,
  caches: any,
  importSource: Source | null,
  importPathRange: any,
  importer: Path,
  path: string,
  importAttributes: Record<string, string>,
  kind: number,
  absResolveDir: string,
  pluginData: any,
  logPathStyle: number,
): Promise<[any, boolean, any]> {
  const applyPath = { text: path, namespace: importer.namespace };

  // Apply resolver plugins in order until one succeeds
  for (const plugin of plugins) {
    for (const onResolve of plugin.onResolve) {
      if (!pluginAppliesToPath(applyPath, onResolve.filter, onResolve.namespace)) {
        continue;
      }

      const result = await onResolve.callback({ path, resolveDir: absResolveDir, kind, pluginData, importer, withMap: importAttributes });
      let pluginName = result.pluginName;
      if (pluginName === "") {
        pluginName = plugin.name;
      }
      const didLogError = logPluginMessages(fs, log, pluginName, result.msgs, result.thrownError, importSource, importPathRange);

      // Plugins can also provide additional file system paths to watch
      readWatchPaths(fs, caches, result.absWatchFiles, result.absWatchDirs);

      // Stop now if there was an error
      if (didLogError) {
        return [null, true, new DebugMeta()];
      }

      // The "file" namespace is the default for non-external paths, but not
      // for external paths. External paths must explicitly specify the "file"
      // namespace.
      const nsFromPlugin = result.path.namespace;
      if (result.path.namespace === "" && !result.external) {
        result.path.namespace = "file";
      }

      // Otherwise, continue on to the next resolver if this loader didn't succeed
      if (result.path.text === "") {
        if (result.external) {
          result.path = new Path(path);
        } else {
          continue;
        }
      }

      // Paths in the file namespace must be absolute paths
      if (result.path.namespace === "file" && !fs.isAbs(result.path.text)) {
        const tracker = new LineColumnTracker(importSource);
        if (nsFromPlugin === "file") {
          log.addError(tracker, importPathRange, "Plugin " + goQuote(pluginName) + ' returned a path in the "file" namespace that is not an absolute path: ' + result.path.text);
        } else {
          log.addError(tracker, importPathRange, "Plugin " + goQuote(pluginName) + " returned a non-absolute path: " + result.path.text + " (set a namespace if this is not a file path)");
        }
        return [null, true, new DebugMeta()];
      }

      let sideEffectsData = null;
      if (result.isSideEffectFree) {
        sideEffectsData = newSideEffectsData(pluginName);
      }

      return [newResolveResultFromPlugin(result.path, result.external, result.pluginData, sideEffectsData), false, new DebugMeta()];
    }
  }

  // Resolve relative to the resolve directory by default. All paths in the
  // "file" namespace automatically have a resolve directory. Loader plugins
  // can also configure a custom resolve directory for files in other namespaces.
  const $r = res.resolve(absResolveDir, path, kind);
  const result = $r[0];

  // Warn when the case used for importing differs from the actual file name
  if (result !== null && result.differentCase !== null && result.differentCase !== undefined && !isInsideNodeModules(absResolveDir)) {
    const diffCase = result.differentCase;
    const actualPaths = makePrettyPaths(fs, new Path(fs.join(diffCase.dir, diffCase.actual), "file"));
    const queryPaths = makePrettyPaths(fs, new Path(fs.join(diffCase.dir, diffCase.query), "file"));
    const tracker = new LineColumnTracker(importSource);
    log.addID(
      MsgID_Bundler_DifferentPathCase,
      Warning,
      tracker,
      importPathRange,
      "Use " + goQuote(actualPaths.select(logPathStyle)) + " instead of " + goQuote(queryPaths.select(logPathStyle)) + " to avoid issues with case-sensitive file systems",
    );
  }

  return [result, false, $r[1]];
}

// Plugins can also provide additional file system paths to watch
function readWatchPaths(fs: any, caches: any, absWatchFiles: string[] | null, absWatchDirs: string[] | null) {
  if (absWatchFiles !== null) {
    for (const file of absWatchFiles) {
      fsCacheReadFile(caches, fs, file);
    }
  }
  if (absWatchDirs !== null) {
    for (const dir of absWatchDirs) {
      const $d = fs.readDirectory(dir);
      if ($d[1] === null) {
        $d[0].sortedKeys();
      }
    }
  }
}

class loaderPluginResult {
  declare pluginData: any;
  declare absResolveDir: string;
  declare pluginName: string;
  declare loader: number;
  constructor(loader = LoaderNone, absResolveDir = "", pluginName = "", pluginData: any = null) {
    this.pluginData = pluginData;
    this.absResolveDir = absResolveDir;
    this.pluginName = pluginName;
    this.loader = loader;
  }
}

// runOnLoadPlugins. Returns [loaderPluginResult, ok, contents].
async function runOnLoadPlugins(
  plugins: any[],
  fs: any,
  caches: any,
  log: Log,
  source: Source,
  importSource: Source | null,
  importPathRange: any,
  pluginData: any,
  isWatchMode: boolean,
  logPathStyle: number,
): Promise<[loaderPluginResult, boolean, loadedContents]> {
  const withMap = importAttributesToObject(source.keyPath.importAttributes as ImportAttributes);

  // Apply loader plugins in order until one succeeds
  for (const plugin of plugins) {
    for (const onLoad of plugin.onLoad) {
      if (!pluginAppliesToPath(source.keyPath, onLoad.filter, onLoad.namespace)) {
        continue;
      }

      const result = await onLoad.callback({ pluginData, path: source.keyPath, withMap });
      let pluginName = result.pluginName;
      if (pluginName === "") {
        pluginName = plugin.name;
      }
      const didLogError = logPluginMessages(fs, log, pluginName, result.msgs, result.thrownError, importSource, importPathRange);

      // Plugins can also provide additional file system paths to watch
      readWatchPaths(fs, caches, result.absWatchFiles, result.absWatchDirs);

      // Stop now if there was an error
      if (didLogError) {
        if (isWatchMode && source.keyPath.namespace === "file") {
          fsCacheReadFile(caches, fs, source.keyPath.text); // Read the file for watch mode tracking
        }
        return [new loaderPluginResult(), false, null];
      }

      // Otherwise, continue on to the next loader if this loader didn't succeed
      if (result.contents === null) {
        continue;
      }

      let loader = result.loader;
      if (loader === LoaderNone) {
        loader = LoaderJS;
      }
      if (result.absResolveDir === "" && source.keyPath.namespace === "file") {
        result.absResolveDir = fs.dir(source.keyPath.text);
      }
      if (isWatchMode && source.keyPath.namespace === "file") {
        fsCacheReadFile(caches, fs, source.keyPath.text); // Read the file for watch mode tracking
      }
      return [new loaderPluginResult(loader, result.absResolveDir, pluginName, result.pluginData), true, new loadedContents(result.contents, null)];
    }
  }

  // Force disabled modules to be empty
  if (source.keyPath.isDisabled()) {
    return [new loaderPluginResult(LoaderEmpty), true, new loadedContents(null, "")];
  }

  // Read normal modules from disk
  if (source.keyPath.namespace === "file") {
    const $f = fsCacheReadFile(caches, fs, source.keyPath.text);
    if ($f[1] === null) {
      return [new loaderPluginResult(LoaderDefault, fs.dir(source.keyPath.text)), true, new loadedContents($f[0], null)];
    }
    const tracker = new LineColumnTracker(importSource);
    if ($f[1] === ENOENT) {
      log.addError(tracker, importPathRange, "Cannot read file: " + source.keyPath.text);
      return [new loaderPluginResult(), false, null];
    } else {
      const prettyPaths = makePrettyPaths(fs, source.keyPath);
      log.addError(tracker, importPathRange, "Cannot read file " + goQuote(prettyPaths.select(logPathStyle)) + ": " + $f[1].error());
      return [new loaderPluginResult(), false, null];
    }
  }

  // Native support for data URLs. This is supported natively by node:
  // https://nodejs.org/docs/latest/api/esm.html#esm_data_imports
  if (source.keyPath.namespace === "dataurl") {
    const $p = parseDataURL(source.keyPath.text);
    if ($p[1]) {
      const $d = $p[0].decodeData();
      if ($d[1] !== null) {
        const tracker = new LineColumnTracker(importSource);
        log.addError(tracker, importPathRange, "Could not load data URL: " + $d[1]);
        // (source.Contents stays empty)
        return [new loaderPluginResult(LoaderNone), true, new loadedContents(null, "")];
      } else {
        const contents = new loadedContents($d[0], null);
        const mimeType = $p[0].decodeMIMEType();
        if (mimeType !== MIMETypeUnsupported) {
          switch (mimeType) {
            case MIMETypeTextCSS:
              return [new loaderPluginResult(LoaderCSS), true, contents];
            case MIMETypeTextJavaScript:
              return [new loaderPluginResult(LoaderJS), true, contents];
            case MIMETypeApplicationJSON:
              return [new loaderPluginResult(LoaderJSON), true, contents];
          }
        }
        // (Go: "source.Contents = contents" and then LoaderNone below)
        return [new loaderPluginResult(LoaderNone), true, contents];
      }
    }
  }

  // Otherwise, fail to load the path
  return [new loaderPluginResult(LoaderNone), true, new loadedContents(null, "")];
}

// Identify the path by its lowercase absolute path name with Windows-specific
// slashes substituted for standard slashes. This should hopefully avoid path
// issues on Windows where multiple different paths can refer to the same
// underlying file.
function canonicalFileSystemPathForWindows(absPath: string): string {
  return goStringsToLower(absPath).replaceAll("\\", "/");
}

// bundler.HashForFileName: the first 8 characters of the base32 encoding
const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function hashForFileName(hashBytes: Uint8Array): string {
  // 8 base32 characters = 40 bits = the first 5 bytes
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < 5; i++) {
    value = (value << 8) | hashBytes[i];
    bits += 8;
    while (bits >= 5) {
      out += base32Chars[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

// helpers.MimeTypeByExtension
const builtinTypesLower = new Map([
  // Text
  [".css", "text/css; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".markdown", "text/markdown; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".xhtml", "application/xhtml+xml; charset=utf-8"],
  [".xml", "text/xml; charset=utf-8"],

  // Images
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],

  // Audio
  [".mp3", "audio/mpeg"],

  // Fonts
  [".eot", "application/vnd.ms-fontobject"],
  [".otf", "font/otf"],
  [".sfnt", "font/sfnt"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],

  // Other
  [".pdf", "application/pdf"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json"],
]);

function mimeTypeByExtension(ext: string): string {
  let contentType = builtinTypesLower.get(ext) ?? "";
  if (contentType === "") {
    contentType = builtinTypesLower.get(goStringsToLower(ext)) ?? "";
  }
  return contentType;
}

// ---------------------------------------------------------------------------
// The scanner

class visitedFile {
  declare sourceIndex: number;
  constructor(sourceIndex: number) {
    this.sourceIndex = sourceIndex;
  }
}

export class EntryPoint {
  declare inputPath: string;
  declare outputPath: string;
  declare inputPathInFileNamespace: boolean;
  constructor(inputPath = "", outputPath = "", inputPathInFileNamespace = false) {
    this.inputPath = inputPath;
    this.outputPath = outputPath;
    this.inputPathInFileNamespace = inputPathInFileNamespace;
  }
}

const base64URLChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// 12 random bytes in URL-safe base64 (16 characters). Never written to the
// output (chunks and files are referenced by these keys only until their final
// paths are known).
function generateUniqueKeyPrefix(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let i = 0; i < 12; i++) bytes[i] = (Math.random() * 256) | 0;
  let s = "";
  for (let i = 0; i < 12; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += base64URLChars[v >> 18] + base64URLChars[(v >> 12) & 63] + base64URLChars[(v >> 6) & 63] + base64URLChars[v & 63];
  }
  return s;
}

// inputKind
const inputKindNormal = 0;
const inputKindEntryPoint = 1;
const inputKindStdin = 2;

class scanner {
  declare log: Log;
  declare fs: any;
  declare res: any;
  declare caches: any;
  declare uniqueKeyPrefix: string;
  declare results: parseResult[];
  declare visited: Map<string, visitedFile>;
  declare options: ConfigOptions;
  declare timer: Timer | null;
  declare remaining: number;
  // JS-only: the result channel
  declare queue: parseResult[];
  declare waiters: (() => void)[];
  declare failure: any;
  declare failed: boolean;
  constructor(log: Log, fs: any, res: any, caches: any, options: ConfigOptions, uniqueKeyPrefix: string) {
    this.log = log;
    this.fs = fs;
    this.res = res;
    this.caches = caches;
    this.uniqueKeyPrefix = uniqueKeyPrefix;
    this.results = [];
    this.visited = new Map();
    this.options = options;
    this.timer = null;
    this.remaining = 0;
    this.queue = [];
    this.waiters = [];
    this.failure = null;
    this.failed = false;
  }

  wake() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  // "s.resultChannel <- result" from a parse task
  send(promise: Promise<parseResult>) {
    promise.then(
      (result) => {
        this.queue.push(result);
        this.wake();
      },
      (e) => {
        if (!this.failed) {
          this.failed = true;
          this.failure = e;
        }
        this.wake();
      },
    );
  }

  // Waits until something happened (a result or a failure)
  waitForEvent(): Promise<void> {
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  // "<-s.resultChannel"
  async receive(): Promise<parseResult> {
    for (;;) {
      if (this.failed) throw this.failure;
      if (this.queue.length > 0) return this.queue.shift();
      await this.waitForEvent();
    }
  }

  // This returns the source index of the resulting file
  maybeParseFile(
    resolveResult: any,
    prettyPaths: PrettyPaths,
    importSource: Source | null,
    importPathRange: any,
    importWith: any,
    kind: number,
    inject: ((file: InjectedFile) => void) | null,
  ): number {
    const s = this;
    const path: Path = resolveResult.pathPair.primary;
    let visitedKey = path;
    if (visitedKey.namespace === "file") {
      visitedKey = visitedKey.clone();
      visitedKey.text = canonicalFileSystemPathForWindows(visitedKey.text);
    }
    const key = pathKey(visitedKey);

    // Only parse a given file path once
    const existing = s.visited.get(key);
    if (existing !== undefined) {
      if (inject !== null) inject(new InjectedFile());
      return existing.sourceIndex;
    }

    const visited = new visitedFile(s.allocateSourceIndex(visitedKey, sourceIndexNormal));
    s.visited.set(key, visited);
    s.remaining++;
    const optionsClone = cloneOptions(s.options);
    if (kind !== inputKindStdin) {
      optionsClone.stdin = null;
    }

    // Allow certain properties to be overridden by "tsconfig.json"
    if (resolveResult.tsConfigJSX !== null && resolveResult.tsConfigJSX !== undefined) {
      const jsx = optionsClone.jsx.clone();
      resolveResult.tsConfigJSX.applyTo(jsx);
      optionsClone.jsx = jsx;
    }
    if (resolveResult.tsConfig !== null && resolveResult.tsConfig !== undefined) {
      optionsClone.ts = new TSOptions(resolveResult.tsConfig, optionsClone.ts.parse, optionsClone.ts.noAmbiguousLessThan);
    }
    if (resolveResult.tsAlwaysStrict !== null && resolveResult.tsAlwaysStrict !== undefined) {
      optionsClone.tsAlwaysStrict = resolveResult.tsAlwaysStrict;
    }

    // Set the module type preference using node's module type rules
    const base = optionsClone.moduleTypeData === null || optionsClone.moduleTypeData === undefined ? new ModuleTypeData() : optionsClone.moduleTypeData;
    const text = path.text;
    if (text.endsWith(".mjs")) {
      optionsClone.moduleTypeData = new ModuleTypeData(base.source, base.range, ModuleESM_MJS);
    } else if (text.endsWith(".mts")) {
      optionsClone.moduleTypeData = new ModuleTypeData(base.source, base.range, ModuleESM_MTS);
    } else if (text.endsWith(".cjs")) {
      optionsClone.moduleTypeData = new ModuleTypeData(base.source, base.range, ModuleCommonJS_CJS);
    } else if (text.endsWith(".cts")) {
      optionsClone.moduleTypeData = new ModuleTypeData(base.source, base.range, ModuleCommonJS_CTS);
    } else if (text.endsWith(".js") || text.endsWith(".jsx") || text.endsWith(".ts") || text.endsWith(".tsx")) {
      optionsClone.moduleTypeData = resolveResult.moduleTypeData === undefined || resolveResult.moduleTypeData === null ? new ModuleTypeData() : resolveResult.moduleTypeData;
    } else {
      // The "type" setting in "package.json" only applies to ".js" files
      optionsClone.moduleTypeData = new ModuleTypeData(base.source, base.range, ModuleUnknown);
    }

    // Enable bundling for injected files so we always do tree shaking. We
    // never want to include unnecessary code from injected files since they
    // are essentially bundled. However, if we do this we should skip the
    // resolving step when we're not bundling. It'd be strange to get
    // resolution errors when the top-level bundling controls are disabled.
    let skipResolve = false;
    if (inject !== null && optionsClone.mode !== ModeBundle) {
      optionsClone.mode = ModeBundle;
      skipResolve = true;
    }

    // Special-case pretty-printed paths for data URLs
    if (path.namespace === "dataurl") {
      if (parseDataURL(path.text)[1]) {
        // (Go slices bytes, which can cut a character in two)
        let prettyPath = path.text;
        if (goStringByteLength(prettyPath) > 65) {
          prettyPath = decodeGoString(goStringBytes(prettyPath).subarray(0, 65));
        }
        prettyPath = prettyPath.replaceAll("\n", "\\n");
        if (goStringByteLength(prettyPath) > 64) {
          prettyPath = decodeGoString(goStringBytes(prettyPath).subarray(0, 64)) + "...";
        }
        prettyPath = "<" + prettyPath + ">";
        prettyPaths = new PrettyPaths(prettyPath, prettyPath);
      }
    }

    let sideEffects = new SideEffects();
    if (resolveResult.primarySideEffectsData !== null && resolveResult.primarySideEffectsData !== undefined) {
      sideEffects = new SideEffects(resolveResult.primarySideEffectsData, NoSideEffects_PackageJSON);
    }

    const args = new parseArgs();
    args.fs = s.fs;
    args.log = s.log;
    args.res = s.res;
    args.caches = s.caches;
    args.keyPath = path;
    args.prettyPaths = prettyPaths;
    args.sourceIndex = visited.sourceIndex;
    args.importSource = importSource;
    args.sideEffects = sideEffects;
    args.importPathRange = importPathRange;
    args.importWith = importWith;
    args.pluginData = resolveResult.pluginData === undefined ? null : resolveResult.pluginData;
    args.options = optionsClone;
    args.inject = inject;
    args.skipResolve = skipResolve;
    args.uniqueKeyPrefix = s.uniqueKeyPrefix;
    s.send(parseFile(args));

    return visited.sourceIndex;
  }

  allocateSourceIndex(path: Path, kind: number): number {
    const s = this;
    // Allocate a source index using the shared source index cache so that
    // subsequent builds reuse the same source index and therefore use the
    // cached parse results for increased speed.
    const sourceIndex = s.caches.sourceIndexCache.get(path, kind);

    // Grow the results array to fit this source index
    while (s.results.length < sourceIndex + 1) s.results.push(new parseResult());
    return sourceIndex;
  }

  allocateGlobSourceIndex(parentSourceIndex: number, globIndex: number): number {
    const s = this;
    // Allocate a source index using the shared source index cache so that
    // subsequent builds reuse the same source index and therefore use the
    // cached parse results for increased speed.
    const sourceIndex = s.caches.sourceIndexCache.getGlob(parentSourceIndex, globIndex);

    // Grow the results array to fit this source index
    while (s.results.length < sourceIndex + 1) s.results.push(new parseResult());
    return sourceIndex;
  }

  generateResultForGlobResolve(
    sourceIndex: number,
    fakeSourcePath: string,
    importSource: Source,
    importRange: any,
    importWith: any,
    kind: number,
    phase: number,
    result: globResolveResult,
    assertions: any,
  ): parseResult {
    const s = this;
    const keys = [...result.resolveResults.keys()].sort(compareStringsGo);

    const object = new EObject([]);
    const importRecords: ImportRecord[] = [];
    const resolveResults: any[] = [];

    for (const key of keys) {
      const resolveResult = result.resolveResults.get(key);
      let value: Expr;

      const importRecordIndex = importRecords.length;
      let recordSourceIndex = -1;

      if (!resolveResult.pathPair.isExternal) {
        recordSourceIndex = s.maybeParseFile(resolveResult, makePrettyPaths(s.fs, resolveResult.pathPair.primary), importSource, importRange, importWith, inputKindNormal, null);
      }

      let path: Path = resolveResult.pathPair.primary;

      // If the path to the external module is relative to the source
      // file, rewrite the path to be relative to the working directory
      if (path.namespace === "file") {
        const $rel = s.fs.rel(s.options.absOutputDir, path.text);
        if ($rel[1]) {
          // Prevent issues with path separators being different on Windows
          let relPath = $rel[0].replaceAll("\\", "/");
          if (isPackagePath(relPath)) {
            relPath = "./" + relPath;
          }
          path = path.clone();
          path.text = relPath;
        }
      }

      resolveResults.push(resolveResult);
      importRecords.push(new ImportRecord(assertions, null, path, RANGE_ZERO, 0, recordSourceIndex, -1, 0, phase, kind));

      switch (kind) {
        case ImportDynamic:
          value = new Expr(new EImportString(importRecordIndex), 0);
          break;
        case ImportRequire:
          value = new Expr(new ERequireString(importRecordIndex), 0);
          break;
        default:
          throw new GoPanic("Internal error");
      }

      const property = new Property();
      property.key = new Expr(new EString(key), 0);
      property.valueOrNil = new Expr(new EArrow([], new FnBody(new SBlock([new Stmt(new SReturn(value), 0)]), 0), false, false, true), 0);
      object.properties.push(property);
    }

    const source = new Source(result.prettyPaths, "", "", new Path(fakeSourcePath, "file"), sourceIndex);
    const ast = globResolveAST(s.log, source, importRecords, object, result.exportAlias);

    // Fill out "nil" for any additional imports (i.e. from the runtime)
    while (resolveResults.length < ast.importRecords.length) {
      resolveResults.push(null);
    }

    const inputFile = new InputFile(new JSRepr(undefined, ast), null, [], "", new SideEffects(), source, 0, true);
    const parsed = new parseResult(new scannerFile(inputFile), true);
    parsed.resolveResults = resolveResults;
    return parsed;
  }

  async preprocessInjectedFiles() {
    const s = this;
    const injectedFiles: InjectedFile[] = [];

    // These are virtual paths that are generated for compound "--define" values.
    // They are special-cased and are not available for plugins to intercept.
    for (const define of s.options.injectedDefines) {
      // These should be unique by construction so no need to check for collisions
      const visitedKey = new Path("<define:" + define.name + ">");
      const sourceIndex = s.allocateSourceIndex(visitedKey, sourceIndexNormal);
      s.visited.set(pathKey(visitedKey), new visitedFile(sourceIndex));
      const source = new Source(makePrettyPaths(s.fs, visitedKey), ensureValidIdentifier(visitedKey.text), define.source.contents, visitedKey, sourceIndex);

      // The first "len(InjectedDefine)" injected files intentionally line up
      // with the injected defines by index. The index will be used to import
      // references to them in the parser.
      injectedFiles.push(new InjectedFile([], define.name, source));

      // Generate the file inline here since it has already been parsed
      const expr = new Expr(cloneJSONValueForInject(define.data), 0);
      const ast = lazyExportAST(s.log, source, optionsFromConfig(s.options), expr, null);
      const inputFile = new InputFile(null, null, [], "", new SideEffects(null, NoSideEffects_PureData), source, LoaderJSON);
      inputFile.repr = new JSRepr();
      inputFile.repr.ast = ast;
      const result = new parseResult(new scannerFile(inputFile), true);
      result.file.contentsByteLength = utf8Len(define.source.contents);

      // Append to the channel on a goroutine in case it blocks due to capacity
      s.remaining++;
      s.send(Promise.resolve(result));
    }

    // Add user-specified injected files. Run resolver plugins on these files
    // so plugins can alter where they resolve to. These are run in parallel in
    // case any of these plugins block.
    const injectResolveResults: any[] = new Array(s.options.injectPaths.length).fill(null);
    const injectAbsResolveDir = s.fs.cwd();
    await Promise.all(
      s.options.injectPaths.map(async (importPath, i) => {
        const importer = new Path();

        // Add a leading "./" if it's missing, similar to entry points
        let absPath = importPath;
        if (!s.fs.isAbs(absPath)) {
          absPath = s.fs.join(injectAbsResolveDir, absPath);
        }
        const dir = s.fs.dir(absPath);
        const base = s.fs.base(absPath);
        const $d = s.fs.readDirectory(dir);
        if ($d[1] === null) {
          const entry = $d[0].get(base)[0];
          if (entry !== null && entry.kind(s.fs) === FileEntry) {
            importer.namespace = "file";
            if (!s.fs.isAbs(importPath) && isPackagePath(importPath)) {
              importPath = "./" + importPath;
            }
          }
        }

        // Run the resolver and log an error if the path couldn't be resolved
        const $r = await runOnResolvePlugins(s.options.plugins, s.res, s.log, s.fs, s.caches, null, RANGE_ZERO, importer, importPath, {}, ImportEntryPoint, injectAbsResolveDir, null, s.options.logPathStyle);
        const resolveResult = $r[0];
        if (resolveResult !== null) {
          if (resolveResult.pathPair.isExternal) {
            s.log.addError(null, RANGE_ZERO, "The injected path " + goQuote(importPath) + " cannot be marked as external");
          } else {
            injectResolveResults[i] = resolveResult;
          }
        } else if (!$r[1]) {
          $r[2].logErrorMsg(s.log, null, RANGE_ZERO, "Could not resolve " + goQuote(importPath), "", null);
        }
      }),
    );

    if (cancelFlagDidCancel(s.options.cancelFlag)) return;

    // Parse all entry points that were resolved successfully
    const waits: Promise<InjectedFile>[] = [];
    for (const resolveResult of injectResolveResults) {
      if (resolveResult !== null) {
        let resolveInject: (file: InjectedFile) => void;
        waits.push(new Promise<InjectedFile>((resolve) => (resolveInject = resolve)));
        s.maybeParseFile(resolveResult, makePrettyPaths(s.fs, resolveResult.pathPair.primary), null, RANGE_ZERO, null, inputKindNormal, resolveInject);
      }
    }
    const results = await s.waitForAll(waits);
    for (const r of results) injectedFiles.push(r);

    // It's safe to mutate the options object to add the injected files here
    // because there aren't any concurrent "parseFile" goroutines at this point.
    s.options.injectedFiles = injectedFiles;
  }

  // Waits for these promises, or throws the failure of a parse task
  async waitForAll<T>(waits: Promise<T>[]): Promise<T[]> {
    let result: T[] = null;
    let done = false;
    Promise.all(waits).then((v) => {
      result = v;
      done = true;
      this.wake();
    });
    for (;;) {
      if (done) return result;
      if (this.failed) throw this.failure;
      await this.waitForEvent();
    }
  }

  async addEntryPoints(entryPoints: EntryPoint[]): Promise<GraphEntryPoint[]> {
    const s = this;

    // Reserve a slot for each entry point
    const entryMetas: GraphEntryPoint[] = [];

    // Treat stdin as an extra entry point
    const stdin = s.options.stdin;
    if (stdin !== null) {
      let stdinPath = new Path("<stdin>");
      if (stdin.sourceFile !== "") {
        if (stdin.absResolveDir === "") {
          stdinPath = new Path(stdin.sourceFile);
        } else if (s.fs.isAbs(stdin.sourceFile)) {
          stdinPath = new Path(stdin.sourceFile, "file");
        } else {
          stdinPath = new Path(s.fs.join(stdin.absResolveDir, stdin.sourceFile), "file");
        }
      }
      const resolveResult = newResolveResultFromPlugin(stdinPath, false, null, null);
      const sourceIndex = s.maybeParseFile(resolveResult, makePrettyPaths(s.fs, stdinPath), null, RANGE_ZERO, null, inputKindStdin, null);
      entryMetas.push(new GraphEntryPoint("stdin", sourceIndex));
    }

    if (cancelFlagDidCancel(s.options.cancelFlag)) return null;

    // Check each entry point ahead of time to see if it's a real file
    const entryPointAbsResolveDir = s.fs.cwd();
    for (const entryPoint of entryPoints) {
      let absPath = entryPoint.inputPath;
      if (absPath.includes("*")) {
        continue; // Ignore glob patterns
      }
      if (!s.fs.isAbs(absPath)) {
        absPath = s.fs.join(entryPointAbsResolveDir, absPath);
      }
      const dir = s.fs.dir(absPath);
      const base = s.fs.base(absPath);
      const $d = s.fs.readDirectory(dir);
      if ($d[1] === null) {
        const entry = $d[0].get(base)[0];
        if (entry !== null && entry.kind(s.fs) === FileEntry) {
          entryPoint.inputPathInFileNamespace = true;

          // Entry point paths without a leading "./" are interpreted as package
          // paths. This happens because they go through general path resolution
          // like all other import paths so that plugins can run on them. Requiring
          // a leading "./" for a relative path simplifies writing plugins because
          // entry points aren't a special case.
          //
          // However, requiring a leading "./" also breaks backward compatibility
          // and makes working with the CLI more difficult. So attempt to insert
          // "./" automatically when needed. We don't want to unconditionally insert
          // a leading "./" because the path may not be a file system path. For
          // example, it may be a URL. So only insert a leading "./" when the path
          // is an exact match for an existing file.
          if (!s.fs.isAbs(entryPoint.inputPath) && isPackagePath(entryPoint.inputPath)) {
            entryPoint.inputPath = "./" + entryPoint.inputPath;
          }
        }
      }
    }

    if (cancelFlagDidCancel(s.options.cancelFlag)) return null;

    // Add any remaining entry points. Run resolver plugins on these entry points
    // so plugins can alter where they resolve to. These are run in parallel in
    // case any of these plugins block.
    const entryPointInfos: { results: any[] | null; isGlob: boolean }[] = entryPoints.map(() => ({ results: null, isGlob: false }));
    await Promise.all(
      entryPoints.map(async (entryPoint, i) => {
        const importer = new Path();
        if (entryPoint.inputPathInFileNamespace) {
          importer.namespace = "file";
        }

        // Special-case glob patterns here
        if (entryPoint.inputPath.includes("*")) {
          const pattern = parseGlobPattern(entryPoint.inputPath);
          if (pattern.length > 1) {
            const prettyPattern = goQuote(entryPoint.inputPath);
            const $g = s.res.resolveGlob(entryPointAbsResolveDir, pattern, ImportEntryPoint, prettyPattern);
            const results: Map<string, any> | null = $g[0];
            if (results !== null) {
              const keys = [...results.keys()].sort(compareStringsGo);
              const info = { results: [] as any[], isGlob: true };
              for (const key of keys) {
                // (Go stores a copy of each result)
                info.results.push(cloneResolveResult(results.get(key)));
              }
              entryPointInfos[i] = info;
              if ($g[1] !== null) {
                s.log.addID($g[1].id, $g[1].kind, null, RANGE_ZERO, $g[1].text);
              }
            } else {
              s.log.addError(null, RANGE_ZERO, "Could not resolve " + goQuote(entryPoint.inputPath));
            }
            return;
          }
        }

        // Run the resolver and log an error if the path couldn't be resolved
        const $r = await runOnResolvePlugins(s.options.plugins, s.res, s.log, s.fs, s.caches, null, RANGE_ZERO, importer, entryPoint.inputPath, {}, ImportEntryPoint, entryPointAbsResolveDir, null, s.options.logPathStyle);
        const resolveResult = $r[0];
        if (resolveResult !== null) {
          if (resolveResult.pathPair.isExternal) {
            s.log.addError(null, RANGE_ZERO, "The entry point " + goQuote(entryPoint.inputPath) + " cannot be marked as external");
          } else {
            entryPointInfos[i] = { results: [resolveResult], isGlob: false };
          }
        } else if (!$r[1]) {
          let notes: MsgData[] | null = null;
          if (!s.fs.isAbs(entryPoint.inputPath)) {
            const query = s.res.probeResolvePackageAsRelative(entryPointAbsResolveDir, entryPoint.inputPath, ImportEntryPoint)[0];
            if (query !== null) {
              const prettyPaths = makePrettyPaths(s.fs, query.pathPair.primary);
              notes = [
                new MsgData(
                  null,
                  null,
                  "Use the relative path " +
                    goQuote("./" + entryPoint.inputPath) +
                    " to reference the file " +
                    goQuote(prettyPaths.select(s.options.logPathStyle)) +
                    ". " +
                    'Without the leading "./", the path ' +
                    goQuote(entryPoint.inputPath) +
                    " is being interpreted as a package path instead.",
                ),
              ];
            }
          }
          $r[2].logErrorMsg(s.log, null, RANGE_ZERO, "Could not resolve " + goQuote(entryPoint.inputPath), "", notes);
        }
      }),
    );

    if (cancelFlagDidCancel(s.options.cancelFlag)) return null;

    // Determine output paths for all entry points that were resolved successfully
    const entryPointsToParse: { index: number; parse: () => number }[] = [];
    for (let i = 0; i < entryPointInfos.length; i++) {
      const info = entryPointInfos[i];
      if (info.results === null) {
        continue;
      }

      for (const resolveResult of info.results) {
        const prettyPaths = makePrettyPaths(s.fs, resolveResult.pathPair.primary);
        let outputPath = entryPoints[i].outputPath;
        let outputPathWasAutoGenerated = false;

        // If the output path is missing, automatically generate one from the input path
        if (outputPath === "") {
          if (info.isGlob) {
            outputPath = prettyPaths.rel;
          } else {
            outputPath = entryPoints[i].inputPath;
          }
          let windowsVolumeLabel = "";

          // The ":" character is invalid in file paths on Windows except when
          // it's used as a volume separator. Special-case that here so volume
          // labels don't break on Windows.
          if (s.fs.isAbs(outputPath) && outputPath.length >= 3 && outputPath[1] === ":") {
            const c = outputPath.charCodeAt(0);
            if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) {
              const c2 = outputPath[2];
              if (c2 === "/" || c2 === "\\") {
                windowsVolumeLabel = outputPath.slice(0, 3);
                outputPath = outputPath.slice(3);
              }
            }
          }

          // For cross-platform robustness, do not allow characters in the output
          // path that are invalid on Windows. This is especially relevant when
          // the input path is something other than a file path, such as a URL.
          outputPath = sanitizeFilePathForVirtualModulePath(outputPath);
          if (windowsVolumeLabel !== "") {
            outputPath = windowsVolumeLabel + outputPath;
          }
          outputPathWasAutoGenerated = true;
        }

        // Defer parsing for this entry point until later
        entryPointsToParse.push({
          index: entryMetas.length,
          parse: () => s.maybeParseFile(resolveResult, prettyPaths, null, RANGE_ZERO, null, inputKindEntryPoint, null),
        });

        entryMetas.push(new GraphEntryPoint(outputPath, -1 /* ast.InvalidRef.SourceIndex */, outputPathWasAutoGenerated));
      }
    }

    // Turn all automatically-generated output paths into absolute paths
    for (const entryPoint of entryMetas) {
      if (entryPoint.outputPathWasAutoGenerated && !s.fs.isAbs(entryPoint.outputPath)) {
        entryPoint.outputPath = s.fs.join(entryPointAbsResolveDir, entryPoint.outputPath);
      }
    }

    // Automatically compute "outbase" if it wasn't provided
    if (s.options.absOutputBase === "") {
      s.options.absOutputBase = lowestCommonAncestorDirectory(s.fs, entryMetas);
      if (s.options.absOutputBase === "") {
        s.options.absOutputBase = entryPointAbsResolveDir;
      }
    }

    // Only parse entry points after "AbsOutputBase" has been determined
    for (const toParse of entryPointsToParse) {
      entryMetas[toParse.index].sourceIndex = toParse.parse();
    }

    // Turn all output paths back into relative paths, but this time relative to
    // the "outbase" value we computed above
    for (const entryPoint of entryMetas) {
      if (s.fs.isAbs(entryPoint.outputPath)) {
        if (!entryPoint.outputPathWasAutoGenerated) {
          // If an explicit absolute output path was specified, use the path
          // relative to the "outdir" directory
          const $rel = s.fs.rel(s.options.absOutputDir, entryPoint.outputPath);
          if ($rel[1]) {
            entryPoint.outputPath = $rel[0];
          }
        } else {
          // Otherwise if the absolute output path was derived from the input
          // path, use the path relative to the "outbase" directory
          const $rel = s.fs.rel(s.options.absOutputBase, entryPoint.outputPath);
          if ($rel[1]) {
            entryPoint.outputPath = $rel[0];
          }

          // Strip the file extension from the output path if there is one so the
          // "out extension" setting is used instead
          const last = Math.max(entryPoint.outputPath.lastIndexOf("/"), entryPoint.outputPath.lastIndexOf("."), entryPoint.outputPath.lastIndexOf("\\"));
          if (last !== -1 && entryPoint.outputPath[last] === ".") {
            entryPoint.outputPath = entryPoint.outputPath.slice(0, last);
          }
        }
      }
    }

    return entryMetas;
  }

  async scanAllDependencies() {
    const s = this;

    // Continue scanning until all dependencies have been discovered
    while (s.remaining > 0) {
      if (cancelFlagDidCancel(s.options.cancelFlag)) return;

      const result = await s.receive();
      s.remaining--;
      if (!result.ok) {
        continue;
      }

      // Don't try to resolve paths if we're not bundling
      const records = result.file.inputFile.repr.importRecords();
      if (s.options.mode === ModeBundle && records !== null) {
        for (let importRecordIndex = 0; importRecordIndex < records.length; importRecordIndex++) {
          const record = records[importRecordIndex];

          // This is used for error messages
          let with_ = null;
          if (record.assertOrWith !== null && record.assertOrWith.keyword === 1 /* ast.WithKeyword */) {
            with_ = record.assertOrWith;
          }

          // Skip this import record if the previous resolver call failed
          const resolveResult = result.resolveResults[importRecordIndex];
          if (resolveResult === null || resolveResult === undefined) {
            const globResults = result.globResolveResults !== null ? result.globResolveResults.get(importRecordIndex) : undefined;
            if (globResults !== undefined) {
              const sourceIndex = s.allocateGlobSourceIndex(result.file.inputFile.source.index, importRecordIndex);
              record.sourceIndex = sourceIndex;
              s.results[sourceIndex] = s.generateResultForGlobResolve(
                sourceIndex,
                globResults.absPath,
                result.file.inputFile.source,
                record.range,
                with_,
                record.globPattern.kind,
                record.phase,
                globResults,
                record.assertOrWith,
              );
            }
            continue;
          }

          const path: Path = resolveResult.pathPair.primary;
          if (!resolveResult.pathPair.isExternal) {
            // Handle a path within the bundle
            const sourceIndex = s.maybeParseFile(resolveResult, makePrettyPaths(s.fs, path), result.file.inputFile.source, record.range, with_, inputKindNormal, null);
            record.sourceIndex = sourceIndex;
          } else {
            // Allow this import statement to be removed if something marked it as "sideEffects: false"
            if (resolveResult.primarySideEffectsData !== null && resolveResult.primarySideEffectsData !== undefined) {
              record.flags |= IsExternalWithoutSideEffects;
            }

            // If the path to the external module is relative to the source
            // file, rewrite the path to be relative to the working directory
            if (path.namespace === "file") {
              const $rel = s.fs.rel(s.options.absOutputDir, path.text);
              if ($rel[1]) {
                // Prevent issues with path separators being different on Windows
                let relPath = $rel[0].replaceAll("\\", "/");
                if (isPackagePath(relPath)) {
                  relPath = "./" + relPath;
                }
                const p = record.path.clone();
                p.text = relPath;
                record.path = p;
              } else {
                record.path = path;
              }
            } else {
              record.path = path;
            }
          }
        }
      }

      s.results[result.file.inputFile.source.index] = result;
    }
  }

  processScannedFiles(entryPointMeta: GraphEntryPoint[]): scannerFile[] {
    const s = this;

    // Build a set of entry point source indices for quick lookup
    const entryPointSourceIndexToMetaIndex = new Map<number, number>();
    for (let i = 0; i < entryPointMeta.length; i++) {
      entryPointSourceIndexToMetaIndex.set(entryPointMeta[i].sourceIndex, i);
    }

    // Check for pretty-printed path collisions
    const importAttributeNameCollisions = new Map<string, number[]>();
    for (let sourceIndex = 0; sourceIndex < s.results.length; sourceIndex++) {
      const result = s.results[sourceIndex];
      if (result.ok) {
        const prettyPaths = result.file.inputFile.source.prettyPaths;
        const k = prettyPaths.abs + "\0" + prettyPaths.rel;
        let list = importAttributeNameCollisions.get(k);
        if (list === undefined) importAttributeNameCollisions.set(k, (list = []));
        list.push(sourceIndex);
      }
    }

    // Import attributes can result in the same file being imported multiple
    // times in different ways. If that happens, append the import attributes
    // to the pretty-printed file names to disambiguate them. This renaming
    // must happen before we construct the metafile JSON chunks below.
    for (const sourceIndices of importAttributeNameCollisions.values()) {
      if (sourceIndices.length === 1) {
        continue;
      }

      for (const sourceIndex of sourceIndices) {
        const source = s.results[sourceIndex].file.inputFile.source;
        const attrs = source.keyPath.importAttributes as ImportAttributes;
        if (attrs === null || attrs.length === 0) {
          continue;
        }

        let sb = " with {";
        for (let i = 0; i < attrs.length; i++) {
          const [key, value] = attrs[i];
          if (i > 0) {
            sb += ",";
          }
          sb += " ";
          if (isIdentifier(key)) {
            sb += key;
          } else {
            sb += quoteSingle(key, false);
          }
          sb += ": ";
          sb += quoteSingle(value, false);
        }
        sb += " }";
        source.prettyPaths = new PrettyPaths(source.prettyPaths.abs + sb, source.prettyPaths.rel + sb);
      }
    }

    // Automatically minify the metafile JSON if the bundle is really big
    if (s.results.length > 256) {
      s.options.metafileFormat = MinifiedMetafile;
    }
    const mf = s.options.metafileFormat;
    const ws = (fmt: string) => metafileFormatMaybeRemoveWhitespace(mf, fmt);

    // Now that all files have been scanned, process the final file import records
    // (Go ranges over the slice as it was: the JavaScript stubs for CSS files
    // added in this loop are not visited)
    const resultCount = s.results.length;
    for (let sourceIndex = 0; sourceIndex < resultCount; sourceIndex++) {
      const result = s.results[sourceIndex];
      if (!result.ok) {
        continue;
      }

      let sb = "";
      let isFirstImport = true;

      // Begin the metadata chunk
      if (s.options.needsMetafile) {
        sb += quoteForJSON(result.file.inputFile.source.prettyPaths.select(s.options.metafilePathStyle), s.options.asciiOnly);
        sb += ws(": {\n      \"bytes\": ") + contentsByteLength(result.file) + ws(",\n      \"imports\": [");
      }

      // Don't try to resolve paths if we're not bundling
      const records = result.file.inputFile.repr.importRecords();
      if (s.options.mode === ModeBundle && records !== null) {
        const tracker = new LineColumnTracker(result.file.inputFile.source);

        for (let importRecordIndex = 0; importRecordIndex < records.length; importRecordIndex++) {
          const record = records[importRecordIndex];

          // Save the import attributes to the metafile
          let metafileWith = "";
          if (s.options.needsMetafile) {
            const with_ = record.assertOrWith;
            if (with_ !== null && with_.keyword === 1 /* ast.WithKeyword */ && with_.entries.length > 0) {
              let data = ws(",\n          \"with\": {");
              for (let i = 0; i < with_.entries.length; i++) {
                const entry = with_.entries[i];
                if (i > 0) {
                  data += ",";
                }
                data += ws("\n            ");
                data += quoteForJSON(entry.key, s.options.asciiOnly);
                data += ws(": ");
                data += quoteForJSON(entry.value, s.options.asciiOnly);
              }
              data += ws("\n          }");
              metafileWith = data;
            }
          }

          // Skip this import record if the previous resolver call failed
          const resolveResult = result.resolveResults[importRecordIndex];
          if (resolveResult === null || resolveResult === undefined || !(record.sourceIndex >= 0)) {
            if (s.options.needsMetafile) {
              if (isFirstImport) {
                isFirstImport = false;
                sb += ws("\n        ");
              } else {
                sb += ws(",\n        ");
              }
              sb +=
                ws("{\n          \"path\": ") +
                quoteForJSON(record.path.text, s.options.asciiOnly) +
                ws(",\n          \"kind\": ") +
                quoteForJSON(importKindStringForMetafile(record.kind), s.options.asciiOnly) +
                ws(",\n          \"external\": true") +
                metafileWith +
                ws("\n        }");
            }
            continue;
          }

          // Now that all files have been scanned, look for packages that are imported
          // both with "import" and "require". Rewrite any imports that reference the
          // "module" package.json field to the "main" package.json field instead.
          //
          // This attempts to automatically avoid the "dual package hazard" where a
          // package has both a CommonJS module version and an ECMAScript module
          // version and exports a non-object in CommonJS (often a function). If we
          // pick the "module" field and the package is imported with "require" then
          // code expecting a function will crash.
          const secondary = resolveResult.pathPair.secondary;
          if (secondary !== null && secondary !== undefined && secondary.text !== "") {
            let secondaryKey = secondary;
            if (secondaryKey.namespace === "file") {
              secondaryKey = secondaryKey.clone();
              secondaryKey.text = canonicalFileSystemPathForWindows(secondaryKey.text);
            }
            const secondaryVisited = s.visited.get(pathKey(secondaryKey));
            if (secondaryVisited !== undefined) {
              record.sourceIndex = secondaryVisited.sourceIndex;
            }
          }

          // Generate metadata about each import
          const otherResult = s.results[record.sourceIndex];
          const otherFile = otherResult.file;
          if (s.options.needsMetafile) {
            if (isFirstImport) {
              isFirstImport = false;
              sb += ws("\n        ");
            } else {
              sb += ws(",\n        ");
            }
            sb +=
              ws("{\n          \"path\": ") +
              quoteForJSON(otherFile.inputFile.source.prettyPaths.select(s.options.metafilePathStyle), s.options.asciiOnly) +
              ws(",\n          \"kind\": ") +
              quoteForJSON(importKindStringForMetafile(record.kind), s.options.asciiOnly) +
              ws(",\n          \"original\": ") +
              quoteForJSON(record.path.text, s.options.asciiOnly) +
              metafileWith +
              ws("\n        }");
          }

          // Validate that imports with "assert { type: 'json' }" were imported
          // with the JSON loader. This is done to match the behavior of these
          // import assertions in a real JavaScript runtime. In addition, we also
          // allow the copy loader since this is sort of like marking the path
          // as external (the import assertions are kept and the real JavaScript
          // runtime evaluates them, not us).
          if ((record.flags & AssertTypeJSON) !== 0 && otherResult.ok && otherFile.inputFile.loader !== LoaderJSON && otherFile.inputFile.loader !== LoaderCopy) {
            s.log.addErrorWithNotes(
              tracker,
              record.range,
              "The file " +
                goQuote(otherFile.inputFile.source.prettyPaths.select(s.options.logPathStyle)) +
                " was loaded with the " +
                goQuote(LoaderToString[otherFile.inputFile.loader]) +
                " loader",
              [
                tracker.msgData(
                  rangeOfImportAssertOrWith(result.file.inputFile.source, findAssertOrWithEntry(record.assertOrWith.entries, "type"), KeyAndValueRange),
                  'This import assertion requires the loader to be "json" instead:',
                ),
                new MsgData(
                  null,
                  null,
                  'You need to either reconfigure esbuild to ensure that the loader for this file is "json" or you need to remove this import assertion.',
                ),
              ],
            );
          }

          switch (record.kind) {
            case ImportComposesFrom:
              // Using a JavaScript file with CSS "composes" is not allowed
              if (otherFile.inputFile.repr instanceof JSRepr && otherFile.inputFile.loader !== LoaderEmpty) {
                s.log.addErrorWithNotes(tracker, record.range, 'Cannot use "composes" with ' + goQuote(otherFile.inputFile.source.prettyPaths.select(s.options.logPathStyle)), [
                  new MsgData(
                    null,
                    null,
                    'You can only use "composes" with CSS files and ' +
                      goQuote(otherFile.inputFile.source.prettyPaths.select(s.options.logPathStyle)) +
                      " is not a CSS file (it was loaded with the " +
                      goQuote(LoaderToString[otherFile.inputFile.loader]) +
                      " loader).",
                  ),
                ]);
              }
              break;

            case ImportAt:
              // Using a JavaScript file with CSS "@import" is not allowed
              if (otherFile.inputFile.repr instanceof JSRepr && otherFile.inputFile.loader !== LoaderEmpty) {
                s.log.addErrorWithNotes(tracker, record.range, "Cannot import " + goQuote(otherFile.inputFile.source.prettyPaths.select(s.options.logPathStyle)) + " into a CSS file", [
                  new MsgData(
                    null,
                    null,
                    'An "@import" rule can only be used to import another CSS file and ' +
                      goQuote(otherFile.inputFile.source.prettyPaths.select(s.options.logPathStyle)) +
                      " is not a CSS file (it was loaded with the " +
                      goQuote(LoaderToString[otherFile.inputFile.loader]) +
                      " loader).",
                  ),
                ]);
              }
              break;

            case ImportURL: {
              // Using a JavaScript or CSS file with CSS "url()" is not allowed
              const otherRepr = otherFile.inputFile.repr;
              if (otherRepr instanceof CSSRepr) {
                s.log.addErrorWithNotes(tracker, record.range, "Cannot use " + goQuote(otherFile.inputFile.source.prettyPaths.select(s.options.logPathStyle)) + " as a URL", [
                  new MsgData(
                    null,
                    null,
                    'You can\'t use a "url()" token to reference a CSS file, and ' +
                      goQuote(otherFile.inputFile.source.prettyPaths.select(s.options.logPathStyle)) +
                      " is a CSS file (it was loaded with the " +
                      goQuote(LoaderToString[otherFile.inputFile.loader]) +
                      " loader).",
                  ),
                ]);
              } else if (otherRepr instanceof JSRepr) {
                if (otherRepr.ast.urlForCSS === "" && otherFile.inputFile.loader !== LoaderEmpty) {
                  s.log.addErrorWithNotes(tracker, record.range, "Cannot use " + goQuote(otherFile.inputFile.source.prettyPaths.select(s.options.logPathStyle)) + " as a URL", [
                    new MsgData(
                      null,
                      null,
                      'You can\'t use a "url()" token to reference the file ' +
                        goQuote(otherFile.inputFile.source.prettyPaths.select(s.options.logPathStyle)) +
                        " because it was loaded with the " +
                        goQuote(LoaderToString[otherFile.inputFile.loader]) +
                        " loader, which doesn't provide a URL to embed in the resulting CSS.",
                    ),
                  ]);
                }
              }
              break;
            }
          }

          // If the imported file uses the "copy" loader, then move it from
          // "SourceIndex" to "CopySourceIndex" so we don't end up bundling it.
          if (otherFile.inputFile.repr instanceof CopyRepr) {
            record.copySourceIndex = record.sourceIndex;
            record.sourceIndex = -1;
            continue;
          }

          // If an import from a JavaScript file targets a CSS file, generate a
          // JavaScript stub to ensure that JavaScript files only ever import
          // other JavaScript files.
          if (result.file.inputFile.repr instanceof JSRepr && otherFile.inputFile.repr instanceof CSSRepr) {
            const css = otherFile.inputFile.repr;
            if (s.options.writeToStdout) {
              s.log.addError(tracker, record.range, "Cannot import " + goQuote(otherFile.inputFile.source.prettyPaths.select(s.options.logPathStyle)) + " into a JavaScript file without an output path configured");
            } else if (!(css.jsSourceIndex >= 0)) {
              let stubKey = otherFile.inputFile.source.keyPath;
              if (stubKey.namespace === "file") {
                stubKey = stubKey.clone();
                stubKey.text = canonicalFileSystemPathForWindows(stubKey.text);
              }
              const sourceIndex = s.allocateSourceIndex(stubKey, sourceIndexJSStubForCSS);
              const other = otherFile.inputFile.source;
              const source = new Source(other.prettyPaths, other.identifierName, other.contents, other.keyPath, sourceIndex);
              const stubRepr = new JSRepr();
              // Note: The actual export object will be filled in by the linker
              stubRepr.ast = lazyExportAST(s.log, source, optionsFromConfig(s.options), new Expr(ENullShared, 0), null);
              stubRepr.cssSourceIndex = record.sourceIndex;
              s.results[sourceIndex] = new parseResult(new scannerFile(new InputFile(stubRepr, null, [], "", new SideEffects(), source, otherFile.inputFile.loader)), true);
              css.jsSourceIndex = sourceIndex;
            }
            record.sourceIndex = css.jsSourceIndex;
            if (!(css.jsSourceIndex >= 0)) {
              continue;
            }
          }

          // Warn about this import if it's a bare import statement without any
          // imported names (i.e. a side-effect-only import) and the module has
          // been marked as having no side effects.
          //
          // Except don't do this if this file is inside "node_modules" since
          // it's a bug in the package and the user won't be able to do anything
          // about it. Note that this can result in esbuild silently generating
          // broken code. If this actually happens for people, it's probably worth
          // re-enabling the warning about code inside "node_modules".
          if ((record.flags & WasOriginallyBareImport) !== 0 && !s.options.ignoreDCEAnnotations && !isInsideNodeModules(result.file.inputFile.source.keyPath.text)) {
            const otherModule = s.results[record.sourceIndex].file.inputFile;
            if (
              otherModule.sideEffects.kind !== HasSideEffects &&
              // Do not warn if this is from a plugin, since removing the import
              // would cause the plugin to not run, and running a plugin is a side
              // effect.
              otherModule.sideEffects.kind !== NoSideEffects_PureData_FromPlugin &&
              // Do not warn if this has no side effects because the parsed AST
              // is empty. This is the case for ".d.ts" files, for example.
              otherModule.sideEffects.kind !== NoSideEffects_EmptyAST
            ) {
              let notes: MsgData[] | null = null;
              let by = "";
              const data = otherModule.sideEffects.data;
              if (data !== null && data !== undefined) {
                if (data.pluginName !== "") {
                  by = " by plugin " + goQuote(data.pluginName);
                } else {
                  let text;
                  if (data.isSideEffectsArrayInJSON) {
                    text = 'It was excluded from the "sideEffects" array in the enclosing "package.json" file:';
                  } else {
                    text = '"sideEffects" is false in the enclosing "package.json" file:';
                  }
                  const tracker2 = new LineColumnTracker(data.source);
                  notes = [tracker2.msgData(data.range, text)];
                }
              }
              s.log.addIDWithNotes(
                MsgID_Bundler_IgnoredBareImport,
                Warning,
                tracker,
                record.range,
                "Ignoring this import because " + goQuote(otherModule.source.prettyPaths.select(s.options.logPathStyle)) + " was marked as having no side effects" + by,
                notes,
              );
            }
          }
        }
      }

      // End the metadata chunk
      if (s.options.needsMetafile) {
        if (!isFirstImport) {
          sb += ws("\n      ");
        }
        const repr = result.file.inputFile.repr;
        if (repr instanceof JSRepr && (repr.ast.exportsKind === ExportsCommonJS || repr.ast.exportsKind === ExportsESM)) {
          const format = repr.ast.exportsKind === ExportsESM ? "esm" : "cjs";
          sb += ws("],\n      \"format\": ") + JSON.stringify(format);
        } else {
          sb += "]";
        }
        const attrs = result.file.inputFile.source.keyPath.importAttributes as ImportAttributes;
        if (attrs !== null && attrs.length > 0) {
          sb += ws(",\n      \"with\": {");
          for (let i = 0; i < attrs.length; i++) {
            if (i > 0) {
              sb += ",";
            }
            sb += ws("\n        ") + quoteForJSON(attrs[i][0], s.options.asciiOnly) + ws(": ") + quoteForJSON(attrs[i][1], s.options.asciiOnly);
          }
          sb += ws("\n      }");
        }
        sb += ws("\n    }");
      }

      result.file.jsonMetadataChunk = sb;

      // If this file is from the "file" or "copy" loaders, generate an additional file
      if (result.file.inputFile.uniqueKeyForAdditionalFile !== "") {
        const bytes = result.file.inputFile.source.contents; // (a byte string)
        let template = s.options.assetPathTemplate;

        // Use the entry path template instead of the asset path template if this
        // file is an entry point and uses the "copy" loader. With the "file" loader
        // the JS stub is the entry point, but with the "copy" loader the file is
        // the entry point itself.
        let customFilePath = "";
        let useOutputFile = false;
        let isEntryPoint = false;
        if (result.file.inputFile.loader === LoaderCopy) {
          const metaIndex = entryPointSourceIndexToMetaIndex.get(sourceIndex);
          if (metaIndex !== undefined) {
            template = s.options.entryPathTemplate;
            customFilePath = entryPointMeta[metaIndex].outputPath;
            useOutputFile = s.options.absOutputFile !== "";
            isEntryPoint = true;
          }
        }

        // Add a hash to the file name to prevent multiple files with the same name
        // but different contents from colliding
        let hash = "";
        if (hasPlaceholder(template, HashPlaceholder)) {
          const h = new Digest();
          h.write(byteStringToBytes(bytes));
          hash = hashForFileName(h.sum());
        }

        // This should use similar logic to how the linker computes output paths
        let dir: string, base: string, ext: string;
        if (useOutputFile) {
          // If the output path was configured explicitly, use it verbatim
          dir = "/";
          base = s.fs.base(s.options.absOutputFile);
          ext = s.fs.ext(base);
          base = base.slice(0, base.length - ext.length);
        } else {
          // Otherwise, derive the output path from the input path
          // Generate the input for the template
          const originalExt = platformIndependentPathDirBaseExt(result.file.inputFile.source.keyPath.text)[2];
          [dir, base] = pathRelativeToOutbase(result.file.inputFile, s.options, s.fs, false /* avoidIndex */, customFilePath);
          ext = originalExt;
        }

        // Apply the path template
        const templateExt = ext.startsWith(".") ? ext.slice(1) : ext;
        const relPath = templateToString(substituteTemplate(template, new PathPlaceholders(dir, base, hash, templateExt))) + ext;

        // Optionally add metadata about the file
        let jsonMetadataChunk = "";
        if (s.options.needsMetafile) {
          const inputs =
            ws("{\n        ") +
            quoteForJSON(result.file.inputFile.source.prettyPaths.select(s.options.metafilePathStyle), s.options.asciiOnly) +
            ws(": {\n          \"bytesInOutput\": ") +
            bytes.length +
            ws("\n        }\n      }");
          let entryPointJSON = "";
          if (isEntryPoint) {
            entryPointJSON = ws("\"entryPoint\": ") + quoteForJSON(result.file.inputFile.source.prettyPaths.select(s.options.metafilePathStyle), s.options.asciiOnly) + ws(",\n      ");
          }
          jsonMetadataChunk = ws("{\n      \"imports\": [],\n      \"exports\": [],\n      ") + entryPointJSON + ws("\"inputs\": ") + inputs + ws(",\n      \"bytes\": ") + bytes.length + ws("\n    }");
        }

        // Generate the additional file to copy into the output directory
        result.file.inputFile.additionalFiles = [new OutputFile(jsonMetadataChunk, s.fs.join(s.options.absOutputDir, relPath), byteStringToBytes(bytes) as any)];
      }

      s.results[sourceIndex] = result;
    }

    // Traverse the graph to check top-level await
    if (s.iterativelyValidateTLA()) {
      s.reportInvalidTLA();
    }

    // The linker operates on an array of files, so construct that now. This
    // can't be constructed earlier because we generate new parse results for
    // JavaScript stub files for CSS imports above.
    const files = new Array(s.results.length);
    for (let sourceIndex = 0; sourceIndex < s.results.length; sourceIndex++) {
      const result = s.results[sourceIndex];
      files[sourceIndex] = result.ok ? result.file : null;
    }
    return files;
  }

  iterativelyValidateTLA(): boolean {
    const s = this;
    let pass = 1;
    let hasTLA = false;

    // Iterate until a fixed point has been reached to handle graph cycles
    for (;;) {
      const didChange = { value: false };
      for (let sourceIndex = 0; sourceIndex < s.results.length; sourceIndex++) {
        s.recursivelyValidateTLA(sourceIndex, pass, didChange);
      }
      if (!didChange.value) return hasTLA;
      pass++;
      hasTLA = true;
    }
  }

  recursivelyValidateTLA(sourceIndex: number, pass: number, didChange: { value: boolean }): tlaCheck {
    const s = this;
    const result = s.results[sourceIndex];

    // Use a "pass" integer instead of a separate "visited" set
    if (result.ok && result.tlaCheck.pass !== pass) {
      result.tlaCheck.pass = pass;

      const repr = result.file.inputFile.repr;
      if (repr instanceof JSRepr) {
        // If this module contains top-level await, set its parent to itself
        if (repr.ast.liveTopLevelAwaitKeyword.len > 0 && index32GetIndex(result.tlaCheck.parent) !== sourceIndex) {
          result.tlaCheck.parent = sourceIndex;
          result.tlaCheck.depth = 1;
          didChange.value = true;
        }

        // Check all import statements and require calls (only import statements are valid)
        const records = repr.ast.importRecords;
        for (let importRecordIndex = 0; importRecordIndex < records.length; importRecordIndex++) {
          const record = records[importRecordIndex];
          if (record.sourceIndex >= 0 && (record.kind === ImportRequire || record.kind === ImportStmt)) {
            const parent = s.recursivelyValidateTLA(record.sourceIndex, pass, didChange);

            // Track the shallowest top-level await parent (used to report invalid import chains later on)
            if (record.kind === ImportStmt && index32GetIndex(parent.depth) < ((index32GetIndex(result.tlaCheck.depth) - 1) >>> 0)) {
              result.tlaCheck.parent = record.sourceIndex;
              result.tlaCheck.depth = index32GetIndex(parent.depth) + 1;
              result.tlaCheck.importRecordIndex = importRecordIndex;
              didChange.value = true;
              continue;
            }
          }
        }
      }
    }

    return result.tlaCheck;
  }

  reportInvalidTLA() {
    const s = this;
    for (let sourceIndex = 0; sourceIndex < s.results.length; sourceIndex++) {
      const result = s.results[sourceIndex];

      if (result.ok && result.tlaCheck.parent >= 0) {
        const repr = result.file.inputFile.repr;
        if (repr instanceof JSRepr) {
          for (const record of repr.ast.importRecords) {
            // Require of a top-level await chain is forbidden
            if (record.kind === ImportRequire && record.sourceIndex >= 0 && s.results[record.sourceIndex].tlaCheck.parent >= 0) {
              const notes: MsgData[] = [];
              let tlaPrettyPaths = new PrettyPaths();
              let otherSourceIndex = record.sourceIndex;

              // Build up a chain of relevant notes for all of the imports
              for (;;) {
                const parentResult = s.results[otherSourceIndex];
                const parentRepr = parentResult.file.inputFile.repr as JSRepr;

                if (parentRepr.ast.liveTopLevelAwaitKeyword.len > 0) {
                  tlaPrettyPaths = parentResult.file.inputFile.source.prettyPaths;
                  const tracker = new LineColumnTracker(parentResult.file.inputFile.source);
                  notes.push(tracker.msgData(parentRepr.ast.liveTopLevelAwaitKeyword, "The top-level await in " + goQuote(tlaPrettyPaths.select(s.options.logPathStyle)) + " is here:"));
                  break;
                }

                if (!(parentResult.tlaCheck.parent >= 0)) {
                  notes.push(new MsgData(null, null, "unexpected invalid index"));
                  break;
                }

                otherSourceIndex = parentResult.tlaCheck.parent;

                const tracker = new LineColumnTracker(parentResult.file.inputFile.source);
                notes.push(
                  tracker.msgData(
                    parentRepr.ast.importRecords[parentResult.tlaCheck.importRecordIndex].range,
                    "The file " +
                      goQuote(parentResult.file.inputFile.source.prettyPaths.select(s.options.logPathStyle)) +
                      " imports the file " +
                      goQuote(s.results[otherSourceIndex].file.inputFile.source.prettyPaths.select(s.options.logPathStyle)) +
                      " here:",
                  ),
                );
              }

              let text;
              const importedPrettyPaths = s.results[record.sourceIndex].file.inputFile.source.prettyPaths;

              if (importedPrettyPaths.abs === tlaPrettyPaths.abs && importedPrettyPaths.rel === tlaPrettyPaths.rel) {
                text = "This require call is not allowed because the imported file " + goQuote(importedPrettyPaths.select(s.options.logPathStyle)) + " contains a top-level await";
              } else {
                text = "This require call is not allowed because the transitive dependency " + goQuote(tlaPrettyPaths.select(s.options.logPathStyle)) + " contains a top-level await";
              }

              const tracker = new LineColumnTracker(result.file.inputFile.source);
              s.log.addErrorWithNotes(tracker, record.range, text, notes);
            }
          }

          // Make sure that if we wrap this module in a closure, the closure is also
          // async. This happens when you call "import()" on this module and code
          // splitting is off.
          repr.meta.isAsyncOrHasAsyncDependency = true;
        }
      }
    }
  }
}

function contentsByteLength(file: scannerFile): number {
  if (file.contentsByteLength < 0) file.contentsByteLength = utf8Len(file.inputFile.source.contents);
  return file.contentsByteLength;
}

function cloneOptions(options: ConfigOptions): ConfigOptions {
  const o = new ConfigOptions();
  for (const key in options) (o as any)[key] = (options as any)[key];
  return o;
}

function lowestCommonAncestorDirectory(fs: any, entryPoints: GraphEntryPoint[]): string {
  // Ignore any explicitly-specified output paths
  const absPaths: string[] = [];
  for (const entryPoint of entryPoints) {
    if (entryPoint.outputPathWasAutoGenerated) {
      absPaths.push(entryPoint.outputPath);
    }
  }

  if (absPaths.length === 0) {
    return "";
  }

  let lowestAbsDir: string = fs.dir(absPaths[0]);

  for (const absPath of absPaths.slice(1)) {
    const absDir: string = fs.dir(absPath);
    let lastSlash = 0;
    let a = 0;
    let b = 0;

    for (;;) {
      // (Go decodes runes; the comparison below only needs code points)
      const runeA = a < absDir.length ? absDir.codePointAt(a) : -1;
      const runeB = b < lowestAbsDir.length ? lowestAbsDir.codePointAt(b) : -1;
      const widthA = runeA < 0 ? 0 : runeA > 0xffff ? 2 : 1;
      const widthB = runeB < 0 ? 0 : runeB > 0xffff ? 2 : 1;
      const boundaryA = widthA === 0 || runeA === 47 || runeA === 92;
      const boundaryB = widthB === 0 || runeB === 47 || runeB === 92;

      if (boundaryA && boundaryB) {
        if (widthA === 0 || widthB === 0) {
          // Truncate to the smaller path if one path is a prefix of the other
          lowestAbsDir = absDir.slice(0, a);
          break;
        } else {
          // Track the longest common directory so far
          lastSlash = a;
        }
      } else if (boundaryA !== boundaryB || unicodeToLower(runeA) !== unicodeToLower(runeB)) {
        // If we're at the top-level directory, then keep the slash
        if (lastSlash < absDir.length && !hasSlash(absDir.slice(0, lastSlash))) {
          lastSlash++;
        }

        // If both paths are different at this point, stop and set the lowest so
        // far to the common parent directory. Compare using a case-insensitive
        // comparison to handle paths on Windows.
        lowestAbsDir = absDir.slice(0, lastSlash);
        break;
      }

      a += widthA;
      b += widthB;
    }
  }

  return lowestAbsDir;
}

function hasSlash(s: string): boolean {
  return s.includes("/") || s.includes("\\");
}


// where the mapping is not one code point)
// ---------------------------------------------------------------------------
// ScanBundle

// The build API's ScanBundle. "options" is the caller's copy (Go passes it by
// value); it is mutated like Go mutates its copy.
export async function scanBundle(call: number, log: Log, fs: any, caches: any, entryPoints: EntryPoint[], options: ConfigOptions, timer: Timer | null): Promise<Bundle> {
  if (timer === null) {
    return await scanBundleImpl(call, log, fs, caches, entryPoints, options, timer);
  }
  timer?.begin("Scan phase");
  try {
    return await scanBundleImpl(call, log, fs, caches, entryPoints, options, timer);
  } finally {
    timer?.end("Scan phase");
  }
}

async function scanBundleImpl(call: number, log: Log, fs: any, caches: any, entryPoints: EntryPoint[], options: ConfigOptions, timer: Timer | null): Promise<Bundle> {
  applyOptionDefaults(options);

  // Run "onStart" plugins in parallel. IMPORTANT: We always need to run all
  // "onStart" callbacks even when the build is cancelled, because plugins may
  // rely on invariants that are started in "onStart" and ended in "onEnd".
  // This works because "onEnd" callbacks are always run as well.
  timer?.begin("On-start callbacks");
  const onStarts: Promise<void>[] = [];
  for (const plugin of options.plugins) {
    for (const onStart of plugin.onStart) {
      onStarts.push(
        onStart.callback().then((result: any) => {
          if (result !== undefined && result !== null) logPluginMessages(fs, log, plugin.name, result.msgs, result.thrownError, null, RANGE_ZERO);
        }),
      );
    }
  }

  // Each bundling operation gets a separate unique key
  const uniqueKeyPrefix = generateUniqueKeyPrefix();

  // This may mutate "options" by the "tsconfig.json" override settings
  const res = newResolver(call, fs, log, caches, options);

  const s = new scanner(log, fs, res, caches, options, uniqueKeyPrefix);
  s.timer = timer;

  // Always start by parsing the runtime file
  s.results.push(new parseResult());
  s.remaining++;
  {
    const $rt = parseRuntimeCached(options);
    const source = $rt[0],
      ast = $rt[1],
      ok = $rt[2];
    const repr = new JSRepr();
    repr.ast = ast;
    const inputFile = new InputFile(repr, null, [], "", new SideEffects(), source, LoaderNone, true);
    inputFile.astIsShared = true;
    s.send(Promise.resolve(new parseResult(new scannerFile(inputFile), ok)));
  }

  // Wait for all "onStart" plugins here before continuing. People sometimes run
  // setup code in "onStart" that "onLoad" expects to be able to use without
  // "onLoad" needing to block on the completion of their "onStart" callback.
  await Promise.all(onStarts);
  timer?.end("On-start callbacks");

  // We can check the cancel flag now that all "onStart" callbacks are done
  if (cancelFlagDidCancel(options.cancelFlag)) return new Bundle(fs, res, [], [], uniqueKeyPrefix, options);

  // (the timer's Begin/End of these methods are around the calls)
  timer?.begin("Preprocess injected files");
  try {
    await s.preprocessInjectedFiles();
  } finally {
    timer?.end("Preprocess injected files");
  }

  if (cancelFlagDidCancel(options.cancelFlag)) return new Bundle(fs, res, [], [], uniqueKeyPrefix, options);

  let entryPointMeta: GraphEntryPoint[];
  timer?.begin("Add entry points");
  try {
    entryPointMeta = await s.addEntryPoints(entryPoints);
  } finally {
    timer?.end("Add entry points");
  }

  if (cancelFlagDidCancel(options.cancelFlag)) return new Bundle(fs, res, [], [], uniqueKeyPrefix, options);

  timer?.begin("Scan all dependencies");
  try {
    await s.scanAllDependencies();
  } finally {
    timer?.end("Scan all dependencies");
  }

  if (cancelFlagDidCancel(options.cancelFlag)) return new Bundle(fs, res, [], [], uniqueKeyPrefix, options);

  let files: scannerFile[];
  timer?.begin("Process scanned files");
  try {
    files = s.processScannedFiles(entryPointMeta);
  } finally {
    timer?.end("Process scanned files");
  }

  if (cancelFlagDidCancel(options.cancelFlag)) return new Bundle(fs, res, [], [], uniqueKeyPrefix, options);

  return new Bundle(fs, s.res, files, entryPointMeta, uniqueKeyPrefix, s.options);
}

function applyOptionDefaults(options: ConfigOptions) {
  if (options.extensionToLoader === null) {
    options.extensionToLoader = defaultExtensionToLoaderMap();
  }
  if (options.outputExtensionJS === "") {
    options.outputExtensionJS = ".js";
  }
  if (options.outputExtensionCSS === "") {
    options.outputExtensionCSS = ".css";
  }

  // Configure default path templates
  if (options.entryPathTemplate.length === 0) {
    options.entryPathTemplate = [new PathTemplate("./", DirPlaceholder), new PathTemplate("/", NamePlaceholder)];
  }
  if (options.chunkPathTemplate.length === 0) {
    options.chunkPathTemplate = [new PathTemplate("./", NamePlaceholder), new PathTemplate("-", HashPlaceholder)];
  }
  if (options.assetPathTemplate.length === 0) {
    options.assetPathTemplate = [new PathTemplate("./", NamePlaceholder), new PathTemplate("-", HashPlaceholder)];
  }

  options.profilerNames = !options.minifyIdentifiers;

  // Automatically fix invalid configurations of unsupported features
  fixInvalidUnsupportedJSFeatureOverrides(options, AsyncAwait, jsFeatureOr(jsFeatureOr(AsyncGenerator, ForAwait), TopLevelAwait));
  fixInvalidUnsupportedJSFeatureOverrides(options, Generator, AsyncGenerator);
  fixInvalidUnsupportedJSFeatureOverrides(options, ObjectAccessors, jsFeatureOr(ClassPrivateAccessor, ClassPrivateStaticAccessor));
  fixInvalidUnsupportedJSFeatureOverrides(options, ClassField, ClassPrivateField);
  fixInvalidUnsupportedJSFeatureOverrides(options, ClassStaticField, ClassPrivateStaticField);
  fixInvalidUnsupportedJSFeatureOverrides(
    options,
    Class,
    [
      ClassPrivateAccessor,
      ClassPrivateBrandCheck,
      ClassPrivateField,
      ClassPrivateMethod,
      ClassPrivateStaticAccessor,
      ClassPrivateStaticField,
      ClassPrivateStaticMethod,
      ClassStaticBlocks,
      ClassStaticField,
    ].reduce(jsFeatureOr, ClassField),
  );

  // If we're not building for the browser, automatically disable support for
  // inline </script> and </style> tags if there aren't currently any overrides
  if (options.platform !== PlatformBrowser) {
    if (!jsFeatureHas(options.unsupportedJSFeatureOverridesMask, InlineScript)) {
      options.unsupportedJSFeatures = jsFeatureOr(options.unsupportedJSFeatures, InlineScript);
    }
    if (!cssFeatureHas(options.unsupportedCSSFeatureOverridesMask, CSSInlineStyle)) {
      options.unsupportedCSSFeatures |= CSSInlineStyle;
    }
  }
}

function fixInvalidUnsupportedJSFeatureOverrides(options: ConfigOptions, implies: any, implied: any) {
  // If this feature is unsupported, that implies that the other features must also be unsupported
  if (jsFeatureHas(options.unsupportedJSFeatureOverrides, implies)) {
    options.unsupportedJSFeatures = jsFeatureOr(options.unsupportedJSFeatures, implied);
    options.unsupportedJSFeatureOverrides = jsFeatureOr(options.unsupportedJSFeatureOverrides, implied);
    options.unsupportedJSFeatureOverridesMask = jsFeatureOr(options.unsupportedJSFeatureOverridesMask, implied);
  }
}

// ---------------------------------------------------------------------------
// Compile

export class Bundle {
  declare fs: any;
  declare res: any;
  declare files: scannerFile[];
  declare entryPoints: GraphEntryPoint[];
  declare uniqueKeyPrefix: string;
  declare options: ConfigOptions;
  constructor(fs: any, res: any, files: scannerFile[], entryPoints: GraphEntryPoint[], uniqueKeyPrefix: string, options: ConfigOptions) {
    this.fs = fs;
    this.res = res;
    this.files = files;
    this.entryPoints = entryPoints;
    this.uniqueKeyPrefix = uniqueKeyPrefix;
    this.options = options;
  }

  // Returns [[]graph.OutputFile, metafileJSON]. "mangleCache" is a Map or null.
  compile(log: Log, timer: Timer | null, mangleCache: Map<string, string | false> | null, linkFn: any): [OutputFile[], string] {
    if (timer === null) {
      return this.compileImpl(log, timer, mangleCache, linkFn);
    }
    timer?.begin("Compile phase");
    try {
      return this.compileImpl(log, timer, mangleCache, linkFn);
    } finally {
      timer?.end("Compile phase");
    }
  }

  compileImpl(log: Log, timer: Timer | null, mangleCache: Map<string, string | false> | null, linkFn: any): [OutputFile[], string] {
    const b = this;
    if (cancelFlagDidCancel(b.options.cancelFlag)) {
      return [[], ""];
    }

    const options = b.options;

    const files = new Array(b.files.length);
    for (let i = 0; i < b.files.length; i++) {
      files[i] = b.files[i] === null ? null : b.files[i].inputFile;
    }

    // Get the base path from the options or choose the lowest common ancestor of all entry points
    const allReachableFiles = findReachableFiles(files, b.entryPoints);

    // Compute source map data in parallel with linking
    timer?.begin("Spawn source map tasks");
    const dataForSourceMaps = b.computeDataForSourceMapsInParallel(options, allReachableFiles);
    timer?.end("Spawn source map tasks");

    // (options.ExclusiveMangleCacheUpdate's CSS state: shared by every link)
    const cssUsedLocalNames = new Map<string, boolean>();

    let resultGroups: OutputFile[][];
    if (options.codeSplitting || b.entryPoints.length === 1) {
      // If code splitting is enabled or if there's only one entry point, link all entry points together
      resultGroups = [linkFn(options, timer, log, b.fs, b.res, files, b.entryPoints, b.uniqueKeyPrefix, allReachableFiles, dataForSourceMaps, mangleCache, false, cssUsedLocalNames)];
    } else {
      // Otherwise, link each entry point with the runtime file separately
      // (Go links them in parallel and serializes the mangle cache updates in
      // entry point order; here they simply run in order)
      resultGroups = new Array(b.entryPoints.length);
      for (let i = 0; i < b.entryPoints.length; i++) {
        const entryPoints = [b.entryPoints[i]];
        // (JS-only: every link but the last deep-clones the files it mutates;
        // Go always clones)
        const deepClone = i < b.entryPoints.length - 1;
        const forked = timer === null ? null : timer.fork();
        resultGroups[i] = linkFn(cloneOptions(options), forked, log, b.fs, b.res, files, entryPoints, b.uniqueKeyPrefix, findReachableFiles(files, entryPoints), dataForSourceMaps, mangleCache, deepClone, cssUsedLocalNames);
        timer?.join(forked);
      }
    }

    // Join the results in entry point order for determinism
    let outputFiles: OutputFile[] = [];
    for (const group of resultGroups) for (const f of group) outputFiles.push(f);

    // Also generate the metadata file if necessary
    let metafileJSON = "";
    if (options.needsMetafile) {
      timer?.begin("Generate metadata JSON");
      metafileJSON = b.generateMetadataJSON(outputFiles, allReachableFiles, options);
      timer?.end("Generate metadata JSON");
    }

    if (!options.writeToStdout) {
      // Make sure an output file never overwrites an input file
      if (!options.allowOverwrite) {
        const sourceAbsPaths = new Map<string, number>();
        for (const sourceIndex of allReachableFiles) {
          const keyPath = b.files[sourceIndex].inputFile.source.keyPath;
          if (keyPath.namespace === "file") {
            const absPathKey = canonicalFileSystemPathForWindows(keyPath.text);
            sourceAbsPaths.set(absPathKey, sourceIndex);
          }
        }
        for (const outputFile of outputFiles) {
          const absPathKey = canonicalFileSystemPathForWindows(outputFile.absPath);
          const sourceIndex = sourceAbsPaths.get(absPathKey);
          if (sourceIndex !== undefined) {
            let hint = "";
            switch (API.kind) {
              case CLIAPI:
                hint = ' (use "--allow-overwrite" to allow this)';
                break;
              case JSAPI:
                hint = ' (use "allowOverwrite: true" to allow this)';
                break;
              case GoAPI:
                hint = ' (use "AllowOverwrite: true" to allow this)';
                break;
            }
            log.addError(null, RANGE_ZERO, "Refusing to overwrite input file " + goQuote(b.files[sourceIndex].inputFile.source.prettyPaths.select(options.logPathStyle)) + hint);
          }
        }
      }

      // Make sure an output file never overwrites another output file. This
      // is almost certainly unintentional and would otherwise happen silently.
      //
      // Make an exception for files that have identical contents. In that case
      // the duplicate is just silently filtered out. This can happen with the
      // "file" loader, for example.
      const outputFileMap = new Map<string, any>();
      let end = 0;
      for (const outputFile of outputFiles) {
        const absPathKey = canonicalFileSystemPathForWindows(outputFile.absPath);
        const contents = outputFileMap.get(absPathKey);

        // If this isn't a duplicate, keep the output file
        if (contents === undefined) {
          outputFileMap.set(absPathKey, outputFile.contents);
          outputFiles[end] = outputFile;
          end++;
          continue;
        }

        // If the names and contents are both the same, only keep the first one
        if (contentsEqual(contents, outputFile.contents)) {
          continue;
        }

        // Otherwise, generate an error
        let outputPath = outputFile.absPath;
        const rel = b.fs.rel(b.fs.cwd(), outputPath);
        if (rel[1]) {
          outputPath = rel[0];
        }
        log.addError(null, RANGE_ZERO, "Two output files share the same path but have different contents: " + outputPath);
      }
      outputFiles = outputFiles.slice(0, end);
    }

    return [outputFiles, metafileJSON];
  }

  // Returns a function returning []DataForSourceMap (null when source maps are
  // disabled). Go computes this on goroutines; here it is computed lazily.
  computeDataForSourceMapsInParallel(options: ConfigOptions, reachableFiles: number[]): () => DataForSourceMap[] | null {
    const b = this;
    if (options.sourceMap === SourceMapNone) {
      return () => null;
    }

    let results: DataForSourceMap[] | null = null;
    return () => {
      if (results !== null) return results;
      results = new Array(b.files.length);
      for (let i = 0; i < results.length; i++) results[i] = new DataForSourceMap();

      for (const sourceIndex of reachableFiles) {
        const f = b.files[sourceIndex];
        if (loaderCanHaveSourceMap(f.inputFile.loader)) {
          let approximateLineCount = 0;
          const repr = f.inputFile.repr;
          if (repr instanceof JSRepr || repr instanceof CSSRepr) {
            approximateLineCount = repr.ast.approximateLineCount;
          }
          const result = results[sourceIndex];
          result.lineOffsetTables = generateLineOffsetTables(f.inputFile.source.contents, approximateLineCount);
          const sm = f.inputFile.inputSourceMap;
          if (!options.excludeSourcesContent) {
            if (sm === null) {
              // Simple case: no nested source map
              result.quotedContents = [quoteForJSONLong(f.inputFile.source.contents, options.asciiOnly)];
            } else {
              // Complex case: nested source map
              result.quotedContents = new Array(sm.sources.length);
              const nullContents = "null";
              for (let i = 0; i < sm.sources.length; i++) {
                // Missing contents become a "null" literal
                let quotedContents = nullContents;
                if (i < sm.sourcesContent.length) {
                  const value = sm.sourcesContent[i];
                  if (value.quoted !== "" && (!options.asciiOnly || !isASCIIOnly(value.quoted))) {
                    // Just use the value directly from the input file
                    quotedContents = value.quoted;
                  } else if (value.value !== null) {
                    // Re-quote non-ASCII values if output is ASCII-only.
                    // Also quote values that haven't been quoted yet
                    // (happens when the entire "sourcesContent" array is
                    // absent and the source has been found on the file
                    // system using the "sources" array).
                    quotedContents = quoteForJSON(value.value, options.asciiOnly);
                  }
                }
                result.quotedContents[i] = quotedContents;
              }
            }
          }
        }
      }
      return results;
    };
  }

  generateMetadataJSON(results: OutputFile[], allReachableFiles: number[], options: ConfigOptions): string {
    const b = this;
    const ws = (fmt: string) => metafileFormatMaybeRemoveWhitespace(options.metafileFormat, fmt);
    let sb = ws("{\n  \"inputs\": {");

    // Write inputs
    let isFirst = true;
    for (const sourceIndex of allReachableFiles) {
      if (b.files[sourceIndex].inputFile.omitFromSourceMapsAndMetafile) {
        continue;
      }
      const file = b.files[sourceIndex];
      if (file.jsonMetadataChunk.length > 0) {
        if (isFirst) {
          isFirst = false;
          sb += ws("\n    ");
        } else {
          sb += ws(",\n    ");
        }
        sb += file.jsonMetadataChunk;
      }
    }

    sb += ws("\n  },\n  \"outputs\": {");

    // Write outputs
    isFirst = true;
    const pathMap = new Set<string>();
    for (const result of results) {
      if (result.jsonMetadataChunk.length > 0) {
        const prettyPaths = makePrettyPaths(b.fs, new Path(result.absPath, "file"));
        const path = prettyPaths.select(b.options.metafilePathStyle);
        if (pathMap.has(path)) {
          // Don't write out the same path twice (can happen with the "file" loader)
          continue;
        }
        if (isFirst) {
          isFirst = false;
          sb += ws("\n    ");
        } else {
          sb += ws(",\n    ");
        }
        pathMap.add(path);
        sb += quoteForJSON(path, options.asciiOnly) + ws(": ");
        sb += result.jsonMetadataChunk;
      }
    }

    sb += ws("\n  }\n}");
    sb += "\n";
    return sb;
  }
}

// (Go iterates over the runes of the UTF-8 text: code points 0x20-0x7E
// only; a lone surrogate is U+FFFD there, which is not ASCII either)
function isASCIIOnly(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) {
      return false;
    }
  }
  return true;
}

function contentsEqual(a: any, b: any): boolean {
  if (typeof a === "string" && typeof b === "string") return a === b;
  const ab = typeof a === "string" ? utf8Bytes(a) : a;
  const bb = typeof b === "string" ? utf8Bytes(b) : b;
  if (ab.length !== bb.length) return false;
  for (let i = 0; i < ab.length; i++) if (ab[i] !== bb[i]) return false;
  return true;
}

function utf8Bytes(s: string): Uint8Array {
  return goStringBytes(s);
}

// Find all files reachable from all entry points. This order should be
// deterministic given that the entry point order is deterministic, since the
// returned order is the postorder of the graph traversal and import record
// order within a given file is deterministic.
export function findReachableFiles(files: InputFile[], entryPoints: GraphEntryPoint[]): number[] {
  const visited = new Set<number>();
  const order: number[] = [];

  // Include this file and all files it imports
  const visit = (sourceIndex: number) => {
    if (!visited.has(sourceIndex)) {
      visited.add(sourceIndex);
      const file = files[sourceIndex];
      const repr = file.repr;
      if (repr instanceof JSRepr && repr.cssSourceIndex >= 0) {
        visit(repr.cssSourceIndex);
      }
      const records = repr.importRecords();
      if (records !== null) {
        for (const record of records) {
          if (record.sourceIndex >= 0) {
            visit(record.sourceIndex);
          } else if (record.copySourceIndex >= 0) {
            visit(record.copySourceIndex);
          }
        }
      }

      // Each file must come after its dependencies
      order.push(sourceIndex);
    }
  };

  // The runtime is always included in case it's needed
  visit(RUNTIME_SOURCE_INDEX);

  // Include all files reachable from any entry point
  for (const entryPoint of entryPoints) {
    visit(entryPoint.sourceIndex);
  }

  return order;
}

// Returns the path of this file relative to "outbase", which is then ready to
// be joined with the absolute output directory path. The directory and name
// components are returned separately for convenience. Returns [relDir, baseName].
export function pathRelativeToOutbase(inputFile: InputFile, options: ConfigOptions, fs: any, avoidIndex: boolean, customFilePath: string): [string, string] {
  let relDir = "/";
  let baseName = "";
  let absPath = inputFile.source.keyPath.text;

  if (customFilePath !== "") {
    // Use the configured output path if present
    absPath = customFilePath;
    if (!fs.isAbs(absPath)) {
      absPath = fs.join(options.absOutputBase, absPath);
    }
  } else if (inputFile.source.keyPath.namespace !== "file") {
    // Come up with a path for virtual paths (i.e. non-file-system paths)
    const $d = platformIndependentPathDirBaseExt(absPath);
    let base = $d[1];
    if (avoidIndex && base === "index") {
      base = platformIndependentPathDirBaseExt($d[0])[1];
    }
    baseName = sanitizeFilePathForVirtualModulePath(base);
    return [relDir, baseName];
  } else {
    // Heuristic: If the file is named something like "index.js", then use
    // the name of the parent directory instead. This helps avoid the
    // situation where many chunks are named "index" because of people
    // dynamically-importing npm packages that make use of node's implicit
    // "index" file name feature.
    if (avoidIndex) {
      let base: string = fs.base(absPath);
      base = base.slice(0, base.length - fs.ext(base).length);
      if (base === "index") {
        absPath = fs.dir(absPath);
      }
    }
  }

  // Try to get a relative path to the base directory
  const $rel = fs.rel(options.absOutputBase, absPath);
  if (!$rel[1]) {
    // This can fail in some situations such as on different drives on
    // Windows. In that case we just use the file name.
    baseName = fs.base(absPath);
  } else {
    const relPath: string = $rel[0];
    // Now we finally have a relative path
    relDir = fs.dir(relPath) + "/";
    baseName = fs.base(relPath);

    // Use platform-independent slashes
    relDir = relDir.replaceAll("\\", "/");

    // Replace leading "../" so we don't try to write outside of the output
    // directory. This normally can't happen because "AbsOutputBase" is
    // automatically computed to contain all entry point files, but it can
    // happen if someone sets it manually via the "outbase" API option.
    //
    // Note that we can't just strip any leading "../" because that could
    // cause two separate entry point paths to collide. For example, there
    // could be both "src/index.js" and "../src/index.js" as entry points.
    let dotDotCount = 0;
    while (relDir.slice(dotDotCount * 3).startsWith("../")) {
      dotDotCount++;
    }
    if (dotDotCount > 0) {
      // The use of "_.._" here is somewhat arbitrary but it is unlikely to
      // collide with a folder named by a human and it works on Windows
      // (Windows doesn't like names that end with a "."). And not starting
      // with a "." means that it will not be hidden on Unix.
      relDir = "_.._/".repeat(dotDotCount) + relDir.slice(dotDotCount * 3);
    }
    while (relDir.endsWith("/")) {
      relDir = relDir.slice(0, relDir.length - 1);
    }
    relDir = "/" + relDir;
    if (relDir.endsWith("/.")) {
      relDir = relDir.slice(0, relDir.length - 1);
    }
  }

  // Strip the file extension if the output path is an input file
  if (customFilePath === "") {
    const ext: string = fs.ext(baseName);
    baseName = baseName.slice(0, baseName.length - ext.length);
  }
  return [relDir, baseName];
}

export function sanitizeFilePathForVirtualModulePath(path: string): string {
  // Convert it to a safe file path. See: https://stackoverflow.com/a/31976060
  let sb = "";
  let needsGap = false;
  for (const ch of path) {
    const c = ch.codePointAt(0);
    let forbidden = false;
    switch (c) {
      case 0: // These characters are forbidden on Unix and Windows
      case 60: // <   (these characters are forbidden on Windows)
      case 62: // >
      case 58: // :
      case 34: // "
      case 124: // |
      case 63: // ?
      case 42: // *
        forbidden = true;
        break;
      default:
        if (c < 0x20) {
          // These characters are forbidden on Windows
          forbidden = true;
        }
    }
    if (!forbidden) {
      // Turn runs of invalid characters into a '_'
      if (needsGap) {
        sb += "_";
        needsGap = false;
      }
      sb += ch;
      continue;
    }
    if (sb.length > 0) {
      needsGap = true;
    }
  }

  // Make sure the name isn't empty
  if (sb.length === 0) {
    return "_";
  }

  // Note: An extension will be added to this base name, so there is no need to
  // avoid forbidden file names such as ".." since ".js" is a valid file name.
  return sb;
}

