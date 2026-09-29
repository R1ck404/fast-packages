// The fast transform entry point. It takes exactly what esbuild's JS glue would
// send to the Go service for a "transform" request (the flag list built by
// flagsForTransformOptions + the raw input) and returns the response object
// the Go service would send back ({errors, warnings, codeFS, code, mapFS, map,
// legalComments?}), or undefined if the engine threw (a Go panic, or a bug in
// the port: then the caller forwards the request to the service, which
// reports it like esbuild).
//
// Flag handling mirrors pkg/cli parseOptionsImpl (for transform) and the
// option validation in pkg/api transformImpl.
import { deepRetry } from "./deep.mjs";
import { API, CLIAPI, JSAPI, GoAPI } from "./logger.mjs";
import { legalCommentsHasExternalFile } from "./config.mjs";
import { parseGlobalName } from "./global_name_parser.mjs";
import { GoRegexp, RegexpError, compile as goRegexpCompile } from "./goregexp.mjs";
import * as api from "./cli.mjs";
import { utf8ByteString, bytesToByteString } from "./bundler_scan.mjs";
import { LoaderBase64, LoaderBinary, LoaderDataURL } from "./config.mjs";
import { parseTransformOptions } from "./cli.mjs";
import { validateLoader, validateFormat, validatePlatform, validateLegalComments, validateASCIIOnly, validateSourceMap, validateTreeShaking, targetEdition, engineList, outputOptionsFor } from "./api_validate.mjs";
export { GoRegexp };
import { utf8Len, decodedWTF8, decodeGoString } from "./helpers.mjs";
import { goQuote } from "./gostd.mjs";
import {
  Log,
  newStderrLog,
  OutputOptions,
  convertMessagesToPacket,
  packetString,
  stringToMsgIDs,
  Error as MsgError,
  Warning as MsgWarning,
  ColorIfTerminal,
  ColorNever,
  ColorAlways,
  StyleDefault,
  StyleVisualStudio,
  RelPath,
  LevelVerbose,
  LevelDebug,
  LevelInfo,
  LevelWarning,
  LevelError,
  LevelSilent,
  Msg,
  MsgData,
  MsgLocation,
  PrettyPaths,
  Path,
  RANGE_ZERO,
  newDeferLog,
  DeferLogAll,
  MsgID_JS_SuspiciousDefine,
} from "./logger.mjs";
import {
  Options,
  StdinInfo,
  DefineData,
  DefineExpr,
  InjectedDefine,
  MethodCallsMustBeReplacedWithUndefined,
  CallCanBeUnwrappedIfUnused,
  JSXOptions,
  processDefines,
  LoaderJS,
  LoaderJSX,
  LoaderTS,
  LoaderTSX,
  LoaderCSS,
  LoaderGlobalCSS,
  LoaderLocalCSS,
  loaderIsCSS,
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
  LegalCommentsLinkedWithComment,
  prettyPrintTargetEnvironment,
} from "./config.mjs";
import { Source } from "./logger.mjs";
import { EString } from "./js_ast.mjs";
import { parseDefineExpr, compareStringsUTF8 } from "./js_parser.mjs";
import { isIdentifier } from "./js_ident.mjs";
import { Keywords } from "./js_lexer.mjs";
import { transformBundle } from "./bundler.mjs";
import {
  Semver,
  compareSemver,
  semverString,
  unsupportedJSFeatures as compatUnsupportedJSFeatures,
  engineString,
  jsFeatureHas,
  jsFeatureOr,
  jsFeatureApplyOverrides,
  JSFeatureNone,
  StringToJSFeature,
  FunctionNameConfigurable,
  ES as EngineES,
  Chrome,
  Deno,
  Edge,
  Firefox,
  Hermes,
  IE,
  IOS,
  Node,
  Opera,
  Rhino,
  Safari,
} from "./compat.mjs";
import type { JSFeature } from "./compat.mjs";
import { StringToCSSFeature, unsupportedCSSFeatures as compatUnsupportedCSSFeatures, cssPrefixData as compatCSSPrefixData, cssFeatureApplyOverrides } from "./compat_css.mjs";

// Fast-path statistics, exposed as esbuild[Symbol.for("@r1ck404/fast-esbuild-wasm:stats")]:
//   fast         transforms answered by the shortcut
//   error        transforms passed on to the service because the engine threw
//                (a Go panic, or a bug in the port; the exception is in
//                lastError)
export const stats = {
  fast: 0,
  error: 0,
  lastError: null as any,
};

// A flag the fast path does not handle, or a value Go reports an error for
// (configFromFlags' other results: the log options, the messages validating
// the options logged, and how many of them come before the mangle cache's)
let parsedLogOptions: OutputOptions | null = null;
let parsedMsgs: Msg[] = [];
let parsedMsgsBeforeMangleCache = 0;

// api_impl.go validateGlobalName
export function validateGlobalName(log: Log, text: string, path: string): string[] | null {
  if (text !== "") {
    const source = new Source(new PrettyPaths(path, path), "", text, new Path(path));
    const $r = parseGlobalName(log, source);
    if ($r[1]) {
      return $r[0];
    }
  }
  return null;
}

// api_impl.go mapKeyForDefine: length-prefixed parts
export function mapKeyForDefine(parts) {
  let key = "";
  for (const part of parts) key += part.length + ":" + part + "\0";
  return key;
}

// api_impl.go validateDefines. Returns [ProcessedDefines, []InjectedDefine].
export function validateDefines(log: Log, defines: Map<string, string>, pureFns: string[], dropConsole: boolean, browserBuildMinify: boolean | null = null): [any, InjectedDefine[]] {
  // Sort injected defines for determinism, since the imports will be injected
  // into every file in the order that we return them from this function
  const sortedKeys = [...defines.keys()].sort(compareStringsUTF8);
  const rawDefines = new Map();
  const nodeEnvMapKey = mapKeyForDefine(["process", "env", "NODE_ENV"]);
  const injectedDefines: InjectedDefine[] = [];
  for (const key of sortedKeys) {
    const value = defines.get(key);
    const keyParts = validateGlobalName(log, key, "(define name)");
    if (keyParts === null) {
      continue;
    }
    const mapKey = mapKeyForDefine(keyParts);

    // Parse the value
    const $d = parseDefineExpr(value);
    const defineExpr = $d[0], injectExpr = $d[1];

    // Define simple expressions
    if (defineExpr.constant !== null || (defineExpr.parts !== null && defineExpr.parts.length > 0)) {
      rawDefines.set(mapKey, new DefineData(keyParts, defineExpr));

      // Try to be helpful for common mistakes
      if (defineExpr.parts !== null && defineExpr.parts.length === 1 && mapKey === nodeEnvMapKey) {
        const part = defineExpr.parts[0];
        let location: MsgLocation | null = null;
        switch (API.kind) {
          case CLIAPI:
            location = new MsgLocation(new PrettyPaths("<cli>", "<cli>"), "", "--define:process.env.NODE_ENV=" + part, '\\"' + part + '\\"', 1, 30, utf8Len(part));
            break;
          case JSAPI:
            location = new MsgLocation(new PrettyPaths("<js>", "<js>"), "", "define: { 'process.env.NODE_ENV': '" + part + "' }", "'\"" + part + "\"'", 1, 34, utf8Len(part) + 2);
            break;
          case GoAPI:
            location = new MsgLocation(new PrettyPaths("<go>", "<go>"), "", 'Define: map[string]string{"process.env.NODE_ENV": "' + part + '"}', '"\\"' + part + '\\""', 1, 50, utf8Len(part) + 2);
            break;
        }
        const data = new MsgData(
          null,
          location,
          goQuote(key) + " is defined as an identifier instead of a string (surround " + goQuote(value) + " with quotes to get a string)",
        );
        log.addMsgID(MsgID_JS_SuspiciousDefine, new Msg(null, "", data, MsgWarning));
      }
      continue;
    }

    // Inject complex expressions
    if (injectExpr !== null) {
      const index = injectedDefines.length;
      injectedDefines.push(new InjectedDefine(injectExpr, key, new Source(undefined, "", value)));
      rawDefines.set(mapKey, new DefineData(keyParts, new DefineExpr(null, null, index)));
      continue;
    }

    // Anything else is unsupported
    log.addError(null, RANGE_ZERO, "Invalid define value (must be an entity name or JS literal): " + value);
  }

  // If we're bundling for the browser, add a special-cased define for
  // "process.env.NODE_ENV" that is "development" when not minifying and
  // "production" when minifying. This is a convention from the React world
  // that must be handled to avoid all React code crashing instantly. This
  // is only done if it's not already defined so that you can override it if
  // necessary. (Build API only: "browserBuildMinify" is null for transforms,
  // else whether all three minify settings are on.)
  if (browserBuildMinify !== null) {
    if (!rawDefines.has(mapKeyForDefine(["process"]))) {
      if (!rawDefines.has(mapKeyForDefine(["process.env"]))) {
        if (!rawDefines.has(nodeEnvMapKey)) {
          const value = browserBuildMinify ? "production" : "development";
          rawDefines.set(nodeEnvMapKey, new DefineData(["process", "env", "NODE_ENV"], new DefineExpr(new EString(value))));
        }
      }
    }
  }

  // If we're dropping all console API calls, replace each one with undefined
  if (dropConsole) {
    const consoleParts = ["console"];
    const consoleMapKey = mapKeyForDefine(consoleParts);
    const old = rawDefines.get(consoleMapKey);
    rawDefines.set(consoleMapKey, new DefineData(consoleParts, old === undefined ? null : old.defineExpr, (old === undefined ? 0 : old.flags) | MethodCallsMustBeReplacedWithUndefined));
  }

  for (const key of pureFns) {
    const keyParts = validateGlobalName(log, key, "(pure name)");
    if (keyParts === null) {
      continue;
    }
    const mapKey = mapKeyForDefine(keyParts);

    // Merge with any previously-specified defines
    const old = rawDefines.get(mapKey);
    rawDefines.set(mapKey, new DefineData(keyParts, old === undefined ? null : old.defineExpr, (old === undefined ? 0 : old.flags) | CallCanBeUnwrappedIfUnused));
  }

  return [processDefines([...rawDefines.values()]), injectedDefines];
}

export function validateJSXExpr(log: Log, text: string, name: string) {
  if (text !== "") {
    const [expr] = parseDefineExpr(text);
    if ((expr.parts !== null && expr.parts.length > 0) || (name === "fragment" && expr.constant !== null)) return expr;
    log.addError(null, RANGE_ZERO, "Invalid JSX " + name + ": " + goQuote(text));
  }
  return new DefineExpr();
}

// api_impl.go validateSupported. Returns [jsFeature, jsMask, cssFeature,
// cssMask]: the features set to false, and every feature given.
export function validateSupported(log: Log, supported: Map<string, boolean>): [JSFeature, JSFeature, number, number] {
  let overrides = JSFeatureNone;
  let mask = JSFeatureNone;
  let cssFeature = 0;
  let cssMask = 0;
  // (Go iterates a map in random order: the features are a set, and with
  // several invalid names, the order of the errors is random in Go too)
  for (const [key, value] of supported) {
    const js = StringToJSFeature.get(key);
    if (js !== undefined) {
      mask = jsFeatureOr(mask, js);
      if (!value) overrides = jsFeatureOr(overrides, js);
    } else if (StringToCSSFeature.has(key)) {
      const css = StringToCSSFeature.get(key);
      cssMask |= css;
      if (!value) cssFeature |= css;
    } else {
      log.addError(null, RANGE_ZERO, goQuote(key) + ' is not a valid feature name for the "supported" setting');
    }
  }
  return [overrides, mask, cssFeature, cssMask];
}

// api_impl.go validateRegex: Go's regexp.Compile (goregexp.mjs) for
// "--mangle-props=" and "--reserve-props=". Returns null for "" (Go: nil,
// the setting is off) and for an invalid expression (after the error).
export function validateRegex(log: Log, what: string, value: string): GoRegexp | null {
  if (value === "") {
    return null;
  }
  const regex = goRegexpCompile(value);
  if (regex instanceof RegexpError) {
    log.addError(null, RANGE_ZERO, "The " + goQuote(what) + " setting is not a valid Go regular expression: " + value);
    return null;
  }
  return regex;
}
const versionRegex = /^([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?(-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$/;

// strconv.Atoi for a string of ASCII digits (or undefined), or null on error
// (Go's int has 64 bits: a larger number is a range error. The value is only
// compared with the versions of the compatibility tables, for which a
// number above 2^53 is as large as the exact value.)
function atoiDigits(text) {
  if (text === undefined || text === "") return null;
  if (text.length > 18 && BigInt(text) > BigInt("9223372036854775807")) return null;
  return Number(text);
}

// api_impl.go validateFeatures. Returns [jsFeatures, cssFeatures,
// cssPrefixData, targetEnv].
export function validateFeatures(log: Log, target: number, engines: [number, string][]): [JSFeature, number, Map<number, number> | null, string] {
  if (target === 0 && engines.length === 0) return [JSFeatureNone, 0, null, ""];

  const constraints = new Map<number, Semver>();
  const targets = [];

  if (target > 0) constraints.set(EngineES, new Semver([target]));

  for (const [name, versionText] of engines) {
    const match = versionRegex.exec(versionText);
    if (match !== null) {
      const major = atoiDigits(match[1]);
      if (major !== null) {
        const parts = [major];
        const minor = atoiDigits(match[2]);
        if (minor !== null) {
          parts.push(minor);
          const patch = atoiDigits(match[3]);
          if (patch !== null) parts.push(patch);
        }
        const new_ = new Semver(parts, match[4] === undefined ? "" : match[4]);
        const old = constraints.get(name);
        if (old !== undefined && compareSemver(old, new_) < 0) continue;
        constraints.set(name, new_);
        continue;
      }
    }
    const text = 'All version numbers passed to esbuild must be in the format "X", "X.Y", or "X.Y.Z" where X, Y, and Z are non-negative integers.';

    log.addErrorWithNotes(null, RANGE_ZERO, "Invalid version: " + goQuote(versionText), [new MsgData(null, null, text)]);
  }

  for (const [engine, version] of constraints) targets.push(engineString(engine) + semverString(version));
  if (target === -1) targets.push("esnext");

  // sort.Strings + helpers.StringArrayToQuotedCommaSeparatedString
  targets.sort(compareStringsUTF8);
  const targetEnv = targets.map((t) => goQuote(t)).join(", ");

  return [compatUnsupportedJSFeatures(constraints), compatUnsupportedCSSFeatures(constraints), compatCSSPrefixData(constraints), targetEnv];
}

// Parse the flags of a transform request into a config.Options (with the
// messages of transformImpl's validation in parsedMsgs), or throws a CLIError
// where the service answers with an error.
function configFromFlags(flags, input) {
  // cli.ParseTransformOptions (the service answers an error with it)
  const [transformOpts, parseErr] = parseTransformOptions(flags);
  if (parseErr !== null) throw new CLIError(parseErr);
  return configFromTransformOptions(transformOpts);
}

// transformImpl's validation of an api.TransformOptions (see configFromFlags)
function configFromTransformOptions(transformOpts: api.TransformOptions) {
  // (logged into a deferred log without overrides: they are applied when
  // the messages are replayed into each transform's log)
  const log = newDeferLog(DeferLogAll, null);

  // transformImpl: apply default values
  let sourcefile = transformOpts.sourcefile;
  if (sourcefile === "") sourcefile = "<stdin>";
  const loader = validateLoader(transformOpts.loader === api.LoaderNone ? api.LoaderJS : transformOpts.loader);

  // (the api options as the locals below)
  const format = validateFormat(transformOpts.format);
  const platform = validatePlatform(transformOpts.platform);
  const legalComments = validateLegalComments(transformOpts.legalComments, false /* bundle */);
  const asciiOnly = validateASCIIOnly(transformOpts.charset);
  const ignoreAnnotations = transformOpts.ignoreAnnotations;
  const globalName = transformOpts.globalName;
  const banner = transformOpts.banner;
  const footer = transformOpts.footer;
  const jsxMode = transformOpts.jsx; // (api.JSXTransform = 0, JSXPreserve = 1, JSXAutomatic = 2)
  const jsxFactory = transformOpts.jsxFactory;
  const jsxFragment = transformOpts.jsxFragment;
  const jsxImportSource = transformOpts.jsxImportSource;
  const jsxDev = transformOpts.jsxDev;
  const jsxSideEffects = transformOpts.jsxSideEffects;
  const sourceMap = validateSourceMap(transformOpts.sourcemap);
  const sourceRoot = transformOpts.sourceRoot;
  const excludeSourcesContent = transformOpts.sourcesContent === api.SourcesContentExclude;
  const tsConfigRaw = transformOpts.tsconfigRaw;
  const defines = transformOpts.define;
  const supported = transformOpts.supported;
  const minifySyntax = transformOpts.minifySyntax;
  const minifyWhitespace = transformOpts.minifyWhitespace;
  const minifyIdentifiers = transformOpts.minifyIdentifiers;
  const keepNames = transformOpts.keepNames;
  const dropConsole = (transformOpts.drop & api.DropConsole) !== 0;
  const dropDebugger = (transformOpts.drop & api.DropDebugger) !== 0;
  const dropLabels: string[] = transformOpts.dropLabels === null ? [] : transformOpts.dropLabels.slice();
  const pureFns: string[] = transformOpts.pure === null ? [] : transformOpts.pure;
  const lineLimit = transformOpts.lineLimit;
  const target = targetEdition(transformOpts.target);
  const engines = engineList(transformOpts.engines);
  const mangleProps = transformOpts.mangleProps;
  const reserveProps = transformOpts.reserveProps;
  const mangleQuoted = transformOpts.mangleQuoted === api.MangleQuotedTrue;
  const treeShaking = validateTreeShaking(transformOpts.treeShaking, false /* bundle */, transformOpts.format);


  const [jsFeatures, cssFeatures, cssPrefixData, targetEnv] = validateFeatures(log, target, engines);
  const [jsOverrides, jsMask, cssOverrides, cssMask] = validateSupported(log, supported);
  const $v = validateDefines(log, defines, pureFns, dropConsole);
  // (the mangle cache comes with each call: its errors come here, see
  // fastTransform)
  const msgsBeforeMangleCache = log.msgs.length;
  const options = new Options();
  options.cssPrefixData = cssPrefixData;
  options.unsupportedJSFeatures = jsFeatureApplyOverrides(jsFeatures, jsOverrides, jsMask);
  options.unsupportedCSSFeatures = cssFeatureApplyOverrides(cssFeatures, cssOverrides, cssMask);
  options.unsupportedJSFeatureOverrides = jsOverrides;
  options.unsupportedJSFeatureOverridesMask = jsMask;
  options.unsupportedCSSFeatureOverrides = cssOverrides;
  options.unsupportedCSSFeatureOverridesMask = cssMask;
  options.originalTargetEnv = targetEnv;
  options.jsx = new JSXOptions(
    validateJSXExpr(log, jsxFactory, "factory"),
    validateJSXExpr(log, jsxFragment, "fragment"),
    false,
    jsxMode === 1,
    jsxMode === 2,
    jsxImportSource,
    jsxDev,
    jsxSideEffects,
  );
  options.defines = $v[0];
  options.injectedDefines = $v[1];
  options.platform = platform;
  options.sourceMap = sourceMap;
  options.legalComments = legalComments;
  options.sourceRoot = sourceRoot;
  options.excludeSourcesContent = excludeSourcesContent;
  options.outputFormat = format;
  options.globalName = validateGlobalName(log, globalName, "(global name)") ?? [];
  options.minifySyntax = minifySyntax;
  options.minifyWhitespace = minifyWhitespace;
  options.minifyIdentifiers = minifyIdentifiers;
  options.lineLimit = lineLimit;
  // (flag values reach Go as UTF-8: lone surrogates become U+FFFD)
  options.mangleProps = validateRegex(log, "mangle props", mangleProps);
  options.reserveProps = validateRegex(log, "reserve props", reserveProps);
  options.mangleQuoted = mangleQuoted;
  options.dropLabels = dropLabels;
  options.dropDebugger = dropDebugger;
  options.asciiOnly = asciiOnly;
  options.ignoreDCEAnnotations = ignoreAnnotations;
  options.treeShaking = treeShaking;
  options.absOutputFile = sourcefile + "-out";
  options.keepNames = keepNames;
  options.stdin = new StdinInfo("", sourcefile, "", loader);
  if (loaderIsCSS(loader)) {
    options.cssBanner = banner;
    options.cssFooter = footer;
  } else {
    options.jsBanner = banner;
    options.jsFooter = footer;
  }
  options.tsConfigRaw = tsConfigRaw;
  options.mode = format !== FormatPreserve ? ModeConvertFormat : ModePassThrough;

  validateKeepNames(log, options);
  if (sourceMap === SourceMapLinkedWithComment) {
    // Linked source maps don't make sense because there's no output file name
    log.addError(null, RANGE_ZERO, "Cannot transform with linked source maps");
  }
  if (API.kind === CLIAPI) {
    if (legalCommentsHasExternalFile(legalComments)) {
      log.addError(null, RANGE_ZERO, "Cannot transform with linked or external legal comments");
    }
  } else if (legalComments === LegalCommentsLinkedWithComment) {
    log.addError(null, RANGE_ZERO, "Cannot transform with linked legal comments");
  }

  parsedLogOptions = outputOptionsFor(transformOpts);
  parsedMsgs = log.msgs;
  parsedMsgsBeforeMangleCache = msgsBeforeMangleCache;
  return options;
}

// api_impl.go validateKeepNames
export function validateKeepNames(log: Log, options: Options) {
  if (options.keepNames && jsFeatureHas(options.unsupportedJSFeatures, FunctionNameConfigurable)) {
    const where = prettyPrintTargetEnvironment(options.originalTargetEnv, options.unsupportedJSFeatureOverridesMask);
    log.addErrorWithNotes(null, RANGE_ZERO, 'The "keep names" setting cannot be used with ' + where, [
      new MsgData(
        null,
        null,
        'In this environment, the "Function.prototype.name" property is not configurable and assigning to it will throw an error. ' +
          'Either use a newer target environment or disable the "keep names" setting.',
      ),
    ]);
  }
}

// The error of cli_helpers.MakeErrorWithNote for a flag cli.ParseTransformOptions
// or ParseBuildOptions rejects: the service answers with {error: text}
export class CLIError {
  declare text: string;
  constructor(text: string) {
    this.text = text;
  }
}
let utf8Decoder: TextDecoder | null = null;

/** The Go service's response packet for a "transform" request */
interface TransformResponse {
  errors: any[];
  warnings: any[];
  codeFS: boolean;
  code: string;
  mapFS: boolean;
  map: string;
  legalComments?: string;
  mangleCache?: Record<string, string | false>;
}

// api_impl.go cloneMangleCache, applied to the object the glue would encode
// into the request (validated by the glue: every value is a string or false).
// Returns a Map (Go's map[string]interface{}).
export function cloneMangleCache(log: Log, mangleCache: Record<string, string | false>): Map<string, string | false> {
  const clone = new Map<string, string | false>();
  for (const key in mangleCache) {
    let v = mangleCache[key];
    // (the glue encodes keys and values as UTF-8: lone surrogates become
    // U+FFFD, and Go's map keeps the last of keys that become equal)
    const k = key.toWellFormed();
    if (typeof v === "string") v = v.toWellFormed();
    if (v === "__proto__") {
      // This could cause problems for our binary serialization protocol. It's
      // also unnecessary because we already avoid mangling this property name.
      log.addError(null, RANGE_ZERO, "Invalid identifier name " + goQuote(k) + " in mangle cache");
    } else if (typeof v === "string") {
      clone.set(k, v);
    } else if (v === false) {
      clone.set(k, v);
    } else {
      log.addError(null, RANGE_ZERO, "Expected " + goQuote(k) + " in mangle cache to map to either a string or false");
    }
  }
  return clone;
}

// The response's "mangleCache": the service encodes a Go map with sorted keys
// (stdio_protocol.go) and the glue decodes it into a plain object in that order
export function mangleCacheToResponse(mangleCache: Map<string, string | false>): Record<string, string | false> {
  const keys = [...mangleCache.keys()].sort(compareStringsUTF8);
  const value = {};
  // (the glue decodes keys and strings with a default TextDecoder, which
  // drops a leading BOM and turns each byte of a lone surrogate's WTF-8
  // encoding into U+FFFD)
  const noBOM = packetString;
  for (const k of keys) {
    const v = mangleCache.get(k);
    value[noBOM(k)] = typeof v === "string" ? noBOM(v) : v;
  }
  return value;
}
// Parsed options per distinct flag list. validateDefines/processDefines are
// expensive (they rebuild the ~800 known-global defines) and their results are
// read-only afterwards, so they are shared between calls with the same flags.
// (The injected defines' JSON values are copied per call by the bundler,
// since linking mutates them.)
//
// The cached config.Options object itself is handed to transformBundle with
// the input in "stdin" (set by fastTransform and reset afterwards): the first
// thing the bundler does is to make its own copy (bundler.scanBundle), so the
// cached object is never mutated otherwise.
const configCache = new Map(); // key -> {options, stdinTemplate}
let lastFlags: string[] | null = null; // (the flags and entry of the previous call)
let lastEntry = null;
function cachedConfigFromFlags(flags) {
  // Consecutive calls usually use the same options
  if (lastFlags !== null && lastFlags.length === flags.length) {
    let same = true;
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] !== lastFlags[i]) {
        same = false;
        break;
      }
    }
    if (same) return lastEntry;
  }
  // (Flag values may contain newlines, e.g. a JSONC "--tsconfig-raw=" with a
  // block comment, so joining with a separator would be ambiguous)
  const key = JSON.stringify(flags);
  let entry = configCache.get(key);
  if (entry === undefined) {
    const options = configFromFlags(flags, "");
    entry = { options, stdinTemplate: options.stdin, logOptions: parsedLogOptions, msgs: parsedMsgs, msgsBeforeMangleCache: parsedMsgsBeforeMangleCache };
    if (configCache.size >= 64) configCache.clear();
    configCache.set(key, entry);
  }
  lastFlags = flags.slice();
  lastEntry = entry;
  return entry;
}

// JS-only: warming the engine up. A transform of a cold engine is slow
// because V8 compiles every function on its first call and then runs it in
// the interpreter; these transforms go through the common paths of the
// lexer, parser, TypeScript and JSX, lowering, linker, renamer, printer and
// source maps once. The glue runs them while the Go binary compiles (in
// esbuild's worker, or in the page with worker: false), one step per task.
// They do not count in the statistics. Returns whether there are more steps.
const WARMUP_JS =
  'import def, { a as b, c } from "./dep";\nimport * as ns from "node:path";\n' +
  "export const x = { a: 1, b: [2, 3], ...c, [b]: `t${def}`, m() { return this.a } };\n" +
  "export default class K extends Array { static s = 1; #p = 2; get p() { return this.#p } async *gen(...r) { for await (const v of r) yield v?.q ?? /re/g.test(v) } }\n" +
  "export function f(a = 1, { b, c: [d] } = {}) { let s = ''; for (let i = 0; i < 10; i++) s += i; while (a--) if (!b) break; else continue; switch (d) { case 1: return 1; default: } try { throw new Error(s) } catch (e) { return typeof e === 'object' && e instanceof Error ? e.message : void 0 } finally { a = b = null } }\n" +
  "const g = async (x) => await x, h = function* () { yield* [1, 2] }; label: { break label }\n" +
  "if (typeof require !== 'undefined') globalThis.z = ns.join(g, h, 1e3, 0x10, 1n, 'u\\u00e9', (-x.a) ** 2, x.a >>> 1 | 2 & ~3, x?.[0]?.(1));\n";
const WARMUP_TS =
  "import type { T } from './t';\nimport { v, type U } from './u';\n" +
  "export interface I<X extends object = {}> { a: X; b?: readonly string[]; (x: number): void }\n" +
  "export type M<K> = { [P in keyof K]?: K[P] extends Function ? never : K[P] } | [a: 1, ...b: 2[]];\n" +
  "export enum E { A, B = 'b', C = 1 << 2 }\nnamespace N { export const n = 1 }\ndeclare module 'm' { const q: number }\n" +
  "export abstract class C<X> implements I<X> { private readonly r = 1; constructor(public a: X, protected p?: number) { this.r } abstract m(): void; declare d: string; static #s?: T = v as unknown as T }\n" +
  "export function h<X,>(x: X, ...rest: Array<U>): asserts x is X { return <any>x satisfies X }\n" +
  "let o = v!.w as const, t = <T,>(y: T): T => y, u: typeof v = v;\n";
const WARMUP_TSX =
  "import React, { useState } from 'react';\n" +
  "export function App({ items, n = 0 }: { items: string[]; n?: number }) {\n  const [s, set] = useState<number>(n);\n" +
  "  return <div className=\"app\" onClick={() => set(s + 1)} {...{ id: 'x' }}>{items.map((x, i) => <span key={i}>{x}</span>)}<>{s} &amp; text</><input disabled /></div>;\n}\n";
// CSS: what Vite's CSS minification sends (minify, browser targets)
const WARMUP_CSS =
  '@import "base.css" layer(base);\n:root { --accent: #ff0000; }\n.btn, a:hover > .icon::before { color: rgb(255 0 0 / 50%); margin: 0px 0px 0px 0px; background: linear-gradient(to right, #fff 0%, hsl(120deg 50% 50%) 100%) }\n' +
  "@media (min-width: 640px) { .card:is(.a, .b) { padding: calc(1rem + 2px); font: bold 12px/1.5 'Helvetica Neue', sans-serif; transform: translate(0, 0) } }\n" +
  ".nav { & .item { border-radius: 4px 4px 4px 4px } &:focus-visible { outline: 2px solid currentColor } }\n@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }\n";
// (the first step is small: it compiles the paths every transform takes)
const WARMUP_TINY = 'import { a } from "b";\nexport const c = (d) => a(d + 1, `${d}`);\nexport default class E { f() { return this.g } }\n';
const WARMUP_STEPS: [string[], string][] = [
  [["--log-level=silent", "--log-limit=0", "--loader=js"], WARMUP_TINY],
  [["--log-level=silent", "--log-limit=0", "--loader=js"], WARMUP_JS],
  [["--log-level=silent", "--log-limit=0", "--format=cjs", "--platform=neutral", "--loader=js"], WARMUP_JS],
  [["--log-level=silent", "--log-limit=0", "--target=esnext", "--supported:dynamic-import=true", "--supported:import-meta=true", "--sourcemap=external", "--sourcefile=/warmup.ts", "--loader=ts"], WARMUP_TS],
  [["--log-level=silent", "--log-limit=0", "--format=esm", "--jsx=automatic", "--sourcemap=external", "--sourcefile=/warmup.tsx", "--loader=tsx"], WARMUP_TSX],
  [["--log-level=silent", "--log-limit=0", "--target=chrome107,edge107,firefox104,safari16", "--minify", "--loader=css"], WARMUP_CSS],
];
export const warmupStats = { steps: 0, failed: 0 }; // (for tests: every step must take the fast path)
export function warmup(step: number): boolean {
  if (step < 0 || step >= WARMUP_STEPS.length) return false;
  const saved = { ...stats };
  try {
    warmupStats.steps++;
    if (fastTransform(WARMUP_STEPS[step][0], WARMUP_STEPS[step][1], undefined) === undefined) warmupStats.failed++;
  } finally {
    Object.assign(stats, saved);
  }
  return step + 1 < WARMUP_STEPS.length;
}

// Adds msgs[start:end] (logged into a deferred log without overrides) to "log"
function replayMsgs(log: Log, msgs: Msg[], start: number, end: number) {
  for (let i = start; i < end; i++) {
    const m = msgs[i];
    const copy = new Msg(m.notes, m.pluginName, m.data, m.kind, m.id);
    if (m.id !== 0) log.addMsgID(m.id, copy);
    else log.addMsg(copy);
  }
}

// api.Transform's result for the service (cmd/esbuild/service.go
// handleTransformRequest): the messages, and the contents as strings
export class TransformResult {
  declare msgs: Msg[];
  declare code: string;
  declare map: string;
  declare legalComments: string | null;
  declare mangleCache: Map<string, string | false> | null;
  declare logPathStyle: number;
  constructor(msgs: Msg[], code: string, map: string, legalComments: string | null, mangleCache: Map<string, string | false> | null, logPathStyle: number) {
    this.logPathStyle = logPathStyle;
    this.msgs = msgs;
    this.code = code;
    this.map = map;
    this.legalComments = legalComments;
    this.mangleCache = mangleCache;
  }
}

// cli.ParseTransformOptions alone: the CLIError for the flags, or null
export function checkTransformFlags(flags: string[]): CLIError | null {
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i].isWellFormed()) {
      flags = flags.map((f) => f.toWellFormed());
      break;
    }
  }
  try {
    cachedConfigFromFlags(flags);
  } catch (e) {
    if (!(e instanceof CLIError)) throw e;
    return e;
  }
  return null;
}

// cli.ParseTransformOptions + api.Transform for the flags and the input of
// a "transform" request. Returns the result, or a CLIError for the flags.
// ("input" is Go's string(bytes): a Uint8Array, or a string that the glue
// would encode as UTF-8.)
export function transformFromFlags(flags: string[], input: string | Uint8Array, mangleCache: Record<string, string | false> | null | undefined): TransformResult | CLIError {
  // Flags reach Go through the same UTF-8 encoding, so a lone surrogate in
  // any flag value (banner, footer, define, global name, ...) arrives as
  // U+FFFD. (A new array: the glue's flag list must not be mutated.)
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i].isWellFormed()) {
      flags = flags.map((f) => f.toWellFormed());
      break;
    }
  }
  let entry;
  try {
    entry = cachedConfigFromFlags(flags);
  } catch (e) {
    if (!(e instanceof CLIError)) throw e;
    return e;
  }
  return transformWithEntry(entry, input, mangleCache);
}

// api.Transform(input, transformOpts) (the command line's transform, which
// does not go through flags)
export function transformWithOptions(transformOpts: api.TransformOptions, input: Uint8Array): TransformResult {
  const options = configFromTransformOptions(transformOpts);
  const entry = { options, stdinTemplate: options.stdin, logOptions: parsedLogOptions, msgs: parsedMsgs, msgsBeforeMangleCache: parsedMsgsBeforeMangleCache };
  const mangleCache: Record<string, string | false> | null = null;
  if (transformOpts.mangleCache !== null) {
    const obj: any = {};
    for (const [k, v] of transformOpts.mangleCache) {
      if (k === "__proto__") Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
      else obj[k] = v;
    }
    return transformWithEntry(entry, input, obj);
  }
  return transformWithEntry(entry, input, mangleCache);
}

function transformWithEntry(entry: any, input: string | Uint8Array, mangleCache: Record<string, string | false> | null | undefined): TransformResult {
  // (JS-only: a stack overflow that no recover() turned into an error runs
  // the transform again in deep mode, see deep.mts)
  return deepRetry(() => transformWithEntryOnce(entry, input, mangleCache));
}

function transformWithEntryOnce(entry: any, input: string | Uint8Array, mangleCache: Record<string, string | false> | null | undefined): TransformResult {
  {
    const options = entry.options;
    const stdin = entry.stdinTemplate;

    // The input: Go gets the bytes (the glue encodes strings with
    // TextEncoder: lone surrogates -> U+FFFD). The loaders that use the
    // bytes get a byte string (one char per byte); the others the text.
    if (stdin.loader === LoaderBase64 || stdin.loader === LoaderBinary || stdin.loader === LoaderDataURL) {
      input = typeof input === "string" ? utf8ByteString(input.toWellFormed()) : bytesToByteString(input);
    } else if (typeof input === "string") {
      if (!input.isWellFormed()) input = input.toWellFormed();
    } else {
      input = decodeGoString(input);
    }
    const log = newStderrLog(entry.logOptions);

    // The messages of validating the options, with the mangle cache's in
    // between like transformImpl
    replayMsgs(log, entry.msgs, 0, entry.msgsBeforeMangleCache);
    // (the glue only sends a mangle cache when there is one)
    let clonedMangleCache: Map<string, string | false> | null = null;
    if (mangleCache) clonedMangleCache = cloneMangleCache(log, mangleCache);
    replayMsgs(log, entry.msgs, entry.msgsBeforeMangleCache, entry.msgs.length);

    let result;
    if (log.hasErrors()) {
      // Stop now if there were errors
      result = { code: "", map: "", legalComments: null };
    } else {
      options.stdin = new StdinInfo(input as string, stdin.sourceFile, "", stdin.loader);
      try {
        result = transformBundle(options, log, clonedMangleCache);
      } finally {
        // (don't keep the input alive)
        options.stdin = stdin;
      }
    }
    const msgs = log.done();
    log.flushStderr();
    // (only returned when the request had one: Go returns the updated clone,
    // but only for a successful build)
    return new TransformResult(msgs, result.code, result.map, result.legalComments === undefined ? null : result.legalComments, clonedMangleCache !== null && !log.hasErrors() ? clonedMangleCache : null, options.logPathStyle);
  }
}

// Returns the Go service's transform response as the glue decodes it, or
// undefined when the engine throws (a bug in the port; the request then goes
// to the service, which reports it).
export function fastTransform(
  flags: string[],
  input: string | Uint8Array,
  mangleCache: Record<string, string | false> | undefined,
): TransformResponse | undefined {
  try {
    const result = transformFromFlags(flags, input, mangleCache);
    if (result instanceof CLIError) {
      // (handleTransformRequest: encodeErrorPacket)
      stats.fast++;
      return { error: result.text } as any;
    }
    const msgs = result.msgs;
    let errors: any[] = [];
    let warnings: any[] = [];
    if (msgs.length > 0) {
      errors = convertMessagesToPacket(MsgError, msgs, result.logPathStyle);
      warnings = convertMessagesToPacket(MsgWarning, msgs, result.logPathStyle);
    }
    // (the glue decodes response strings with a default TextDecoder, which
    // drops a leading BOM and replaces invalid UTF-8)
    const code = packetString(result.code);
    // ("map" is the external source map, "" when there is none)
    const response: TransformResponse = { errors, warnings, codeFS: false, code, mapFS: false, map: packetString(result.map) };
    if (result.legalComments !== null && result.legalComments !== undefined) {
      response.legalComments = packetString(result.legalComments);
    }
    if (result.mangleCache !== null) response.mangleCache = mangleCacheToResponse(result.mangleCache);
    stats.fast++;
    return response;
  } catch (e) {
    // A Go panic (the service then reports it like esbuild does) or a bug in
    // the port: the request goes to the service
    stats.error++;
    stats.lastError = e;
    return undefined;
  }
}

