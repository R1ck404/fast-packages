// The fast transform entry point. It takes exactly what esbuild's JS glue would
// send to the Go service for a "transform" request (the flag list built by
// flagsForTransformOptions + the raw input) and returns the response object
// the Go service would send back ({errors, warnings, codeFS, code, mapFS, map,
// legalComments?}), or undefined if the request is outside the supported
// subset (then the caller forwards the request to the real esbuild-wasm).
//
// Flag handling mirrors pkg/cli parseOptionsImpl (for transform) and the
// option validation in pkg/api transformImpl. Anything we do not fully
// replicate bails, including every flag value that makes Go report an error.
import { BAIL, LEXER_PANIC } from "./bail.mjs";
import { Log } from "./logger.mjs";
import {
  Options,
  StdinInfo,
  DefineData,
  DefineExpr,
  JSXOptions,
  processDefines,
  LoaderJS,
  LoaderJSX,
  LoaderTS,
  LoaderTSX,
  PlatformBrowser,
  PlatformNode,
  PlatformNeutral,
  FormatPreserve,
  FormatIIFE,
  FormatCommonJS,
  FormatESModule,
  ModeConvertFormat,
  ModePassThrough,
  LegalCommentsInline,
  LegalCommentsNone,
  LegalCommentsEndOfFile,
  SourceMapNone,
  SourceMapInline,
  SourceMapLinkedWithComment,
  SourceMapExternalWithoutComment,
  SourceMapInlineAndExternal,
} from "./config.mjs";
import { parseDefineExpr, compareStringsUTF8 } from "./js_parser.mjs";
import { isIdentifier } from "./js_ident.mjs";
import { Keywords } from "./js_lexer.mjs";
import { transformBundle } from "./bundler.mjs";

export const stats = { fast: 0, bail: 0, error: 0, lastError: null };

const LOG_LEVELS = new Set(["verbose", "debug", "info", "warning", "error", "silent"]);

// isBoolFlag + parseBoolFlag. Returns true/false, or throws BAIL for an
// invalid value (Go reports an error then).
function isBoolFlag(arg, flag) {
  if (arg.startsWith(flag)) {
    const rest = arg.length - flag.length;
    return rest === 0 || arg.charCodeAt(flag.length) === 61; // '='
  }
  return false;
}
function parseBoolFlag(arg, defaultValue) {
  const equals = arg.indexOf("=");
  if (equals === -1) return defaultValue;
  const value = arg.slice(equals + 1);
  if (value === "false") return false;
  if (value === "true") return true;
  throw BAIL;
}

// strconv.Atoi-compatible non-negative integer check
function isNonNegativeAtoi(value) {
  return /^[+-]?[0-9]+$/.test(value) && Number(value) >= 0 && Number(value) <= 2147483647;
}

// A conservative stand-in for js_parser.ParseGlobalName: dot-separated names
// where the first part is an identifier, "this" or "import.meta" and the rest
// are identifiers or keywords. Anything else (index syntax, whitespace,
// escapes, ...) bails.
function parseGlobalNameSimple(text) {
  if (text === "") return null;
  const parts = text.split(".");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) {
      if (part === "import") {
        if (parts.length < 2 || parts[1] !== "meta") throw BAIL;
        i++;
        continue;
      }
      if (part === "this") continue;
      if (!isIdentifier(part) || Keywords.has(part)) throw BAIL;
    } else if (!isIdentifier(part)) {
      throw BAIL;
    }
  }
  return parts;
}

// api_impl.go mapKeyForDefine: length-prefixed parts
function mapKeyForDefine(parts) {
  let key = "";
  for (const part of parts) key += part.length + ":" + part + "\0";
  return key;
}

function validateDefines(defines) {
  // sort.Strings(sortedKeys)
  const sortedKeys = [...defines.keys()].sort(compareStringsUTF8);
  const rawDefines = new Map();
  const nodeEnvMapKey = mapKeyForDefine(["process", "env", "NODE_ENV"]);
  for (const key of sortedKeys) {
    const value = defines.get(key);
    const keyParts = parseGlobalNameSimple(key);
    if (keyParts === null) throw BAIL;
    const mapKey = mapKeyForDefine(keyParts);
    const [defineExpr, injectExpr] = parseDefineExpr(value);
    if (defineExpr.constant !== null || (defineExpr.parts !== null && defineExpr.parts.length > 0)) {
      rawDefines.set(mapKey, new DefineData(keyParts, defineExpr));
      // Go emits a "suspicious define" warning for this
      if (defineExpr.parts !== null && defineExpr.parts.length === 1 && mapKey === nodeEnvMapKey) throw BAIL;
      continue;
    }
    // Non-primitive JSON values become injected defines; invalid values are errors
    if (injectExpr !== null) throw BAIL;
    throw BAIL;
  }
  return processDefines([...rawDefines.values()]);
}

function validateJSXExpr(text, name) {
  if (text !== "") {
    const [expr] = parseDefineExpr(text);
    if ((expr.parts !== null && expr.parts.length > 0) || (name === "fragment" && expr.constant !== null)) return expr;
    throw BAIL; // log.AddError: invalid JSX factory/fragment
  }
  return new DefineExpr();
}

// Parse the flags of a transform request into a config.Options, or throw BAIL.
function configFromFlags(flags, input) {
  let loader = LoaderJS; // LoaderNone defaults to JS
  let sourcefile = "";
  let format = FormatPreserve;
  let formatIsDefault = true;
  let platform = PlatformBrowser;
  let legalComments = LegalCommentsInline; // validateLegalComments(default, bundle=false)
  let asciiOnly = true;
  let treeShaking = null; // TreeShakingDefault
  let ignoreAnnotations = false;
  let globalName = "";
  let banner = "";
  let footer = "";
  let targetEnv = "";
  let jsxMode = 0; // 0 = default/transform, 1 = preserve, 2 = automatic
  let jsxFactory = "";
  let jsxFragment = "";
  let jsxImportSource = "";
  let jsxDev = false;
  let jsxSideEffects = false;
  let sourceMap = SourceMapNone; // validateSourceMap(api.SourceMapNone)
  let sourceRoot = "";
  let excludeSourcesContent = false;
  let tsConfigRaw = "";
  const defines = new Map();

  for (const arg of flags) {
    if (isBoolFlag(arg, "--color")) {
      parseBoolFlag(arg, true);
    } else if (arg.startsWith("--log-level=")) {
      if (!LOG_LEVELS.has(arg.slice(12))) throw BAIL;
    } else if (arg.startsWith("--log-limit=")) {
      if (!isNonNegativeAtoi(arg.slice(12))) throw BAIL;
    } else if (arg.startsWith("--legal-comments=")) {
      const value = arg.slice(17);
      if (value === "none") legalComments = LegalCommentsNone;
      else if (value === "inline") legalComments = LegalCommentsInline;
      else if (value === "eof") legalComments = LegalCommentsEndOfFile;
      else throw BAIL; // linked (error for transform), external, or invalid
    } else if (arg === "--sourcemap") {
      // A bare "--sourcemap" means "inline" for a transform
      sourceMap = SourceMapInline;
    } else if (arg.startsWith("--sourcemap=")) {
      const value = arg.slice(12);
      if (value === "linked") sourceMap = SourceMapLinkedWithComment;
      else if (value === "inline") sourceMap = SourceMapInline;
      else if (value === "external") sourceMap = SourceMapExternalWithoutComment;
      else if (value === "both") sourceMap = SourceMapInlineAndExternal;
      else throw BAIL;
    } else if (arg.startsWith("--source-root=")) {
      // (flags reach Go as UTF-8, which turns lone surrogates into U+FFFD)
      sourceRoot = arg.slice(14);
      if (!sourceRoot.isWellFormed()) sourceRoot = sourceRoot.toWellFormed();
    } else if (isBoolFlag(arg, "--sources-content")) {
      excludeSourcesContent = !parseBoolFlag(arg, true);
    } else if (arg.startsWith("--target=")) {
      if (arg !== "--target=esnext") throw BAIL;
      targetEnv = '"esnext"';
    } else if (arg.startsWith("--format=")) {
      const value = arg.slice(9);
      formatIsDefault = false;
      if (value === "iife") format = FormatIIFE;
      else if (value === "cjs") format = FormatCommonJS;
      else if (value === "esm") format = FormatESModule;
      else throw BAIL;
    } else if (arg.startsWith("--global-name=")) {
      globalName = arg.slice(14);
    } else if (arg.startsWith("--platform=")) {
      const value = arg.slice(11);
      if (value === "browser") platform = PlatformBrowser;
      else if (value === "node") platform = PlatformNode;
      else if (value === "neutral") platform = PlatformNeutral;
      else throw BAIL;
    } else if (arg.startsWith("--charset=")) {
      const value = arg.slice(10);
      if (value === "ascii") asciiOnly = true;
      else if (value === "utf8") asciiOnly = false;
      else throw BAIL;
    } else if (isBoolFlag(arg, "--tree-shaking")) {
      treeShaking = parseBoolFlag(arg, true);
    } else if (isBoolFlag(arg, "--ignore-annotations")) {
      ignoreAnnotations = parseBoolFlag(arg, true);
    } else if (arg.startsWith("--jsx=")) {
      const value = arg.slice(6);
      if (value === "transform") jsxMode = 0;
      else if (value === "preserve") jsxMode = 1;
      else if (value === "automatic") jsxMode = 2;
      else throw BAIL;
    } else if (arg.startsWith("--jsx-factory=")) {
      jsxFactory = arg.slice(14);
    } else if (arg.startsWith("--jsx-fragment=")) {
      jsxFragment = arg.slice(15);
    } else if (arg.startsWith("--jsx-import-source=")) {
      jsxImportSource = arg.slice(20);
    } else if (isBoolFlag(arg, "--jsx-dev")) {
      jsxDev = parseBoolFlag(arg, true);
    } else if (isBoolFlag(arg, "--jsx-side-effects")) {
      jsxSideEffects = parseBoolFlag(arg, true);
    } else if (arg.startsWith("--define:")) {
      const value = arg.slice(9);
      const equals = value.indexOf("=");
      if (equals === -1) throw BAIL;
      defines.set(value.slice(0, equals), value.slice(equals + 1));
    } else if (arg.startsWith("--sourcefile=")) {
      sourcefile = arg.slice(13);
      if (!sourcefile.isWellFormed()) sourcefile = sourcefile.toWellFormed();
    } else if (arg.startsWith("--loader=")) {
      const value = arg.slice(9);
      if (value === "js") loader = LoaderJS;
      else if (value === "jsx") loader = LoaderJSX;
      else if (value === "ts") loader = LoaderTS;
      else if (value === "tsx") loader = LoaderTSX;
      else throw BAIL;
    } else if (arg.startsWith("--banner=")) {
      banner = arg.slice(9);
    } else if (arg.startsWith("--footer=")) {
      footer = arg.slice(9);
    } else if (arg.startsWith("--tsconfig-raw=")) {
      // (parsed and applied in bundler.scanBundle, like Go's NewResolver).
      // The glue sends flags to Go as UTF-8 (TextEncoder), which turns lone
      // surrogates into U+FFFD.
      tsConfigRaw = arg.slice(15);
      if (!tsConfigRaw.isWellFormed()) tsConfigRaw = tsConfigRaw.toWellFormed();
    } else {
      // --log-style, --log-override, --minify*, --line-limit,
      // --drop*, --abs-paths, --mangle-*, --reserve-props, --supported,
      // --pure, --keep-names, and anything unknown
      throw BAIL;
    }
  }

  // transformImpl
  if (sourcefile === "") sourcefile = "<stdin>";

  // Linked source maps don't make sense because there's no output file name
  // (Go: log.AddError "Cannot transform with linked source maps")
  if (sourceMap === SourceMapLinkedWithComment) throw BAIL;

  const options = new Options();
  options.unsupportedJSFeatures = 0;
  options.originalTargetEnv = targetEnv;
  options.jsx = new JSXOptions(
    validateJSXExpr(jsxFactory, "factory"),
    validateJSXExpr(jsxFragment, "fragment"),
    false,
    jsxMode === 1,
    jsxMode === 2,
    jsxImportSource,
    jsxDev,
    jsxSideEffects,
  );
  options.defines = validateDefines(defines);
  options.injectedDefines = [];
  options.platform = platform;
  options.sourceMap = sourceMap;
  options.legalComments = legalComments;
  options.sourceRoot = sourceRoot;
  options.excludeSourcesContent = excludeSourcesContent;
  options.outputFormat = format;
  options.globalName = globalName !== "" ? parseGlobalNameSimple(globalName) : [];
  options.minifySyntax = false;
  options.minifyWhitespace = false;
  options.minifyIdentifiers = false;
  options.lineLimit = 0;
  options.mangleProps = null;
  options.reserveProps = null;
  options.mangleQuoted = false;
  options.dropLabels = [];
  options.dropDebugger = false;
  options.asciiOnly = asciiOnly;
  options.ignoreDCEAnnotations = ignoreAnnotations;
  // validateTreeShaking(value, bundle=false, format)
  options.treeShaking = treeShaking === null ? !formatIsDefault && format === FormatIIFE : treeShaking;
  options.absOutputFile = sourcefile + "-out";
  options.keepNames = false;
  options.stdin = new StdinInfo(input, sourcefile, "", loader);
  options.jsBanner = banner;
  options.jsFooter = footer;
  options.tsConfigRaw = tsConfigRaw;
  options.mode = format !== FormatPreserve ? ModeConvertFormat : ModePassThrough;
  return options;
}

let utf8Decoder = null;

// Parsed options per distinct flag list. validateDefines/processDefines are
// expensive (they rebuild the ~800 known-global defines) and their results are
// read-only afterwards, so they are shared between calls with the same flags.
const configCache = new Map();
function cachedConfigFromFlags(flags, input) {
  // (Flag values may contain newlines, e.g. a JSONC "--tsconfig-raw=" with a
  // block comment, so joining with a separator would be ambiguous)
  const key = JSON.stringify(flags);
  let cached = configCache.get(key);
  if (cached === undefined) {
    cached = configFromFlags(flags, "");
    if (configCache.size >= 64) configCache.clear();
    configCache.set(key, cached);
  }
  const options = Object.assign(new Options(), cached);
  options.stdin = new StdinInfo(input, cached.stdin.sourceFile, "", cached.stdin.loader);
  return options;
}

// Returns the Go service's transform response, or undefined to fall back.
export function fastTransform(flags, input, mangleCache) {
  if (mangleCache) return undefined;
  try {
    // The glue encodes strings with TextEncoder (lone surrogates -> U+FFFD);
    // byte inputs are passed through untouched, so invalid UTF-8 must bail.
    if (typeof input === "string") {
      if (!input.isWellFormed()) input = input.toWellFormed();
    } else {
      if (utf8Decoder === null) utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      input = utf8Decoder.decode(input);
    }
    // Flags reach Go through the same UTF-8 encoding, so a lone surrogate in
    // any flag value (banner, footer, define, global name, ...) arrives as
    // U+FFFD. (A new array: the glue's flag list must not be mutated.)
    for (let i = 0; i < flags.length; i++) {
      if (!flags[i].isWellFormed()) {
        flags = flags.map((f) => f.toWellFormed());
        break;
      }
    }
    const options = cachedConfigFromFlags(flags, input);
    const result = transformBundle(options, new Log());
    let code = result.code;
    // The glue decodes response strings with a default TextDecoder, which
    // drops a leading BOM.
    if (code.charCodeAt(0) === 0xfeff) code = code.slice(1);
    // ("map" is the external source map, "" when there is none)
    const response = { errors: [], warnings: [], codeFS: false, code, mapFS: false, map: result.map };
    if (result.legalComments !== null && result.legalComments !== undefined) {
      let lc = result.legalComments;
      if (lc.charCodeAt(0) === 0xfeff) lc = lc.slice(1);
      response.legalComments = lc;
    }
    stats.fast++;
    return response;
  } catch (e) {
    if (e === BAIL || e === LEXER_PANIC) {
      stats.bail++;
    } else {
      // A bug in the port: never let it escape, fall back to esbuild
      stats.error++;
      stats.lastError = e;
    }
    return undefined;
  }
}
