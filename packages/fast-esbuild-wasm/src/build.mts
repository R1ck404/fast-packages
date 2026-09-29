// pkg/api's build-side validation and helpers: validateBuildOptions (and the
// validators only builds use), the plugin filters (config.CompileFilter),
// the results of the plugin callbacks the scanner runs (config.OnResolveResult,
// config.OnLoadResult), api.OutputFile's hash, and formatMessages() /
// analyzeMetafile() (formatMsgsImpl, analyzeMetafileImpl). The build API
// itself is in api_build.mts, the service in service.mts.
import { EObject, ENumber, EString, EArray } from "./js_ast.mjs";
import { GoRegexp, RegexpError, compile as goRegexpCompile } from "./goregexp.mjs";
import * as api from "./cli.mjs";
import {
  validateLoader,
  validateFormat,
  validatePlatform,
  validateLegalComments,
  validateASCIIOnly,
  validateSourceMap,
  validateTreeShaking,
  validateExternalPackages,
  extractPathStyle,
  targetEdition,
  engineList,
} from "./api_validate.mjs";
import { parseJSON, JSONOptions } from "./json_parser.mjs";
import { goQuote, formatFloatFixed, goIntFromFloat } from "./gostd.mjs";
import {
  Log,
  Path,
  RANGE_ZERO,
  OutputOptions,
  Msg,
  newDeferLog,
  DeferLogNoVerboseOrDebug,
  ColorIfTerminal,
  LevelNone,
  TerminalInfo,
  msgToString,
  convertMessagesToInternal,
  goStringLess,
  Source,
} from "./logger.mjs";
import {
  Options,
  StdinInfo,
  JSXOptions,
  PathTemplate,
  NoPlaceholder,
  DirPlaceholder,
  NamePlaceholder,
  HashPlaceholder,
  ExtPlaceholder,
  ModeBundle,
  ModeConvertFormat,
  PlatformBrowser,
  PlatformNode,
  PlatformNeutral,
  FormatPreserve,
  FormatIIFE,
  FormatCommonJS,
  FormatESModule,
  SourceMapNone,
  SourceMapInline,
  legalCommentsHasExternalFile,
  LoaderNone,
  LoaderCopy,
  LoaderFile,
} from "./config.mjs";
import { jsFeatureApplyOverrides } from "./compat.mjs";
import { cssFeatureApplyOverrides } from "./compat_css.mjs";
import { validateDefines, validateJSXExpr, validateSupported, validateRegex, validateFeatures, validateGlobalName, validateKeepNames } from "./transform.mjs";
import { defaultExtensionToLoaderMap } from "./bundler.mjs";
import { sum64 } from "./xxhash.mjs";
import { validatePath, validateExternals, validateAlias, validateResolveExtensions, isValidExtension } from "./build_deps.mjs";

// ---------------------------------------------------------------------------
// pkg/api validation

function validatePathTemplate(template: string): PathTemplate[] {
  if (template === "") return [];
  template = "./" + template.replaceAll("\\", "/");

  const parts: PathTemplate[] = [];
  let search = 0;

  // Split by placeholders
  while (search < template.length) {
    // Jump to the next "["
    const found = template.indexOf("[", search);
    if (found === -1) break;
    search = found;
    const head = template.slice(0, search);
    const tail = template.slice(search);
    let placeholder = NoPlaceholder;

    // Check for a placeholder
    if (tail.startsWith("[dir]")) {
      placeholder = DirPlaceholder;
      search += 5;
    } else if (tail.startsWith("[name]")) {
      placeholder = NamePlaceholder;
      search += 6;
    } else if (tail.startsWith("[hash]")) {
      placeholder = HashPlaceholder;
      search += 6;
    } else if (tail.startsWith("[ext]")) {
      placeholder = ExtPlaceholder;
      search += 5;
    } else {
      // Skip past the "[" so we don't find it again
      search++;
      continue;
    }

    // Add a part for everything up to and including this placeholder
    parts.push(new PathTemplate(head, placeholder));

    // Reset the search after this placeholder
    template = template.slice(search);
    search = 0;
  }

  // Append any remaining data as a part without a placeholder
  if (search < template.length) {
    parts.push(new PathTemplate(template, NoPlaceholder));
  }

  return parts;
}

function validateLoaders(log: Log, loaders: Map<string, number>): Map<string, number> {
  const result = defaultExtensionToLoaderMap();
  for (const [ext, loader] of loaders) {
    if (ext !== "" && !isValidExtension(ext)) {
      log.addError(null, RANGE_ZERO, "Invalid file extension: " + goQuote(ext));
    }
    result.set(ext, validateLoader(loader));
  }
  return result;
}

function validateOutputExtensions(log: Log, outExtensions: Map<string, string> | null): [string, string] {
  let js = "";
  let css = "";
  if (outExtensions !== null) {
    for (const [key, value] of outExtensions) {
      if (!isValidExtension(value)) {
        log.addError(null, RANGE_ZERO, "Invalid output extension: " + goQuote(value));
      }
      if (key === ".js") js = value;
      else if (key === ".css") css = value;
      else log.addError(null, RANGE_ZERO, "Invalid output extension: " + goQuote(key) + " (valid: .css, .js)");
    }
  }
  return [js, css];
}

function validateBannerOrFooter(log: Log, name: string, values: Map<string, string>): [string, string] {
  let js = "";
  let css = "";
  for (const [key, value] of values) {
    if (key === "js") js = value;
    else if (key === "css") css = value;
    else log.addError(null, RANGE_ZERO, "Invalid " + name + " file type: " + goQuote(key) + " (valid: css, js)");
  }
  return [js, css];
}

export class BundlerEntryPoint {
  declare inputPath: string;
  declare outputPath: string;
  declare inputPathInFileNamespace: boolean;
  constructor(inputPath = "", outputPath = "", inputPathInFileNamespace = false) {
    this.inputPath = inputPath;
    this.outputPath = outputPath;
    this.inputPathInFileNamespace = inputPathInFileNamespace;
  }
}

// api_impl.go validateBuildOptions. Returns [config.Options, []bundler.EntryPoint].
export function validateBuildOptions(buildOpts: api.BuildOptions, log: Log, realFS: any): [Options, BundlerEntryPoint[]] {
  const [jsFeatures, cssFeatures, cssPrefixData, targetEnv] = validateFeatures(log, targetEdition(buildOpts.target), engineList(buildOpts.engines));
  const [jsOverrides, jsMask, cssOverrides, cssMask] = validateSupported(log, buildOpts.supported);
  const [outJS, outCSS] = validateOutputExtensions(log, buildOpts.outExtension);
  const [bannerJS, bannerCSS] = validateBannerOrFooter(log, "banner", buildOpts.banner);
  const [footerJS, footerCSS] = validateBannerOrFooter(log, "footer", buildOpts.footer);
  const minify = buildOpts.minifyWhitespace && buildOpts.minifyIdentifiers && buildOpts.minifySyntax;
  const platform = validatePlatform(buildOpts.platform);
  const [defines, injectedDefines] = validateDefines(log, buildOpts.define, buildOpts.pure === null ? [] : buildOpts.pure, (buildOpts.drop & api.DropConsole) !== 0, platform === PlatformBrowser ? minify : null);
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
    validateJSXExpr(log, buildOpts.jsxFactory, "factory"),
    validateJSXExpr(log, buildOpts.jsxFragment, "fragment"),
    false,
    buildOpts.jsx === 1,
    buildOpts.jsx === 2,
    buildOpts.jsxImportSource,
    buildOpts.jsxDev,
    buildOpts.jsxSideEffects,
  );
  options.defines = defines;
  options.injectedDefines = injectedDefines;
  options.platform = platform;
  options.sourceMap = validateSourceMap(buildOpts.sourcemap);
  options.legalComments = validateLegalComments(buildOpts.legalComments, buildOpts.bundle);
  options.sourceRoot = buildOpts.sourceRoot;
  options.excludeSourcesContent = buildOpts.sourcesContent === api.SourcesContentExclude;
  options.minifySyntax = buildOpts.minifySyntax;
  options.minifyWhitespace = buildOpts.minifyWhitespace;
  options.minifyIdentifiers = buildOpts.minifyIdentifiers;
  options.lineLimit = buildOpts.lineLimit;
  options.mangleProps = validateRegex(log, "mangle props", buildOpts.mangleProps);
  options.reserveProps = validateRegex(log, "reserve props", buildOpts.reserveProps);
  options.mangleQuoted = buildOpts.mangleQuoted === api.MangleQuotedTrue;
  options.dropLabels = buildOpts.dropLabels === null ? [] : buildOpts.dropLabels.slice();
  options.dropDebugger = (buildOpts.drop & api.DropDebugger) !== 0;
  options.allowOverwrite = buildOpts.allowOverwrite;
  options.asciiOnly = validateASCIIOnly(buildOpts.charset);
  options.ignoreDCEAnnotations = buildOpts.ignoreAnnotations;
  options.treeShaking = validateTreeShaking(buildOpts.treeShaking, buildOpts.bundle, buildOpts.format);
  options.globalName = validateGlobalName(log, buildOpts.globalName, "(global name)") ?? [];
  options.codeSplitting = buildOpts.splitting;
  options.outputFormat = validateFormat(buildOpts.format);
  options.absOutputFile = validatePath(log, realFS, buildOpts.outfile, "outfile path");
  options.absOutputDir = validatePath(log, realFS, buildOpts.outdir, "outdir path");
  options.absOutputBase = validatePath(log, realFS, buildOpts.outbase, "outbase path");
  options.needsMetafile = buildOpts.metafile;
  options.entryPathTemplate = validatePathTemplate(buildOpts.entryNames);
  options.chunkPathTemplate = validatePathTemplate(buildOpts.chunkNames);
  options.assetPathTemplate = validatePathTemplate(buildOpts.assetNames);
  options.outputExtensionJS = outJS;
  options.outputExtensionCSS = outCSS;
  options.extensionToLoader = validateLoaders(log, buildOpts.loader);
  options.extensionOrder = validateResolveExtensions(log, buildOpts.resolveExtensions);
  options.externalSettings = validateExternals(log, realFS, buildOpts.external === null ? [] : buildOpts.external);
  options.externalPackages = validateExternalPackages(buildOpts.packages);
  options.packageAliases = validateAlias(log, realFS, buildOpts.alias === null ? new Map() : buildOpts.alias);
  options.tsConfigPath = validatePath(log, realFS, buildOpts.tsconfig, "tsconfig path");
  options.tsConfigRaw = buildOpts.tsconfigRaw;
  options.mainFields = buildOpts.mainFields;
  options.publicPath = buildOpts.publicPath;
  options.keepNames = buildOpts.keepNames;
  options.codePathStyle = extractPathStyle(buildOpts.absPaths, api.CodeAbsPath);
  options.logPathStyle = extractPathStyle(buildOpts.absPaths, api.LogAbsPath);
  options.metafilePathStyle = extractPathStyle(buildOpts.absPaths, api.MetafileAbsPath);
  options.injectPaths = buildOpts.inject === null ? [] : buildOpts.inject.slice();
  options.absNodePaths = [];
  options.jsBanner = bannerJS;
  options.jsFooter = footerJS;
  options.cssBanner = bannerCSS;
  options.cssFooter = footerCSS;
  options.preserveSymlinks = buildOpts.preserveSymlinks;

  validateKeepNames(log, options);
  if (buildOpts.conditions !== null) {
    options.conditions = buildOpts.conditions.slice();
  }
  if (options.mainFields !== null) {
    options.mainFields = options.mainFields.slice();
  }
  options.absNodePaths = buildOpts.nodePaths === null ? [] : buildOpts.nodePaths.map((p) => validatePath(log, realFS, p, "node path"));

  const entryPoints: BundlerEntryPoint[] = [];
  let hasEntryPointWithWildcard = false;
  for (const ep of buildOpts.entryPoints === null ? [] : buildOpts.entryPoints) {
    entryPoints.push(new BundlerEntryPoint(ep));
    if (ep.includes("*")) hasEntryPointWithWildcard = true;
  }
  for (const ep of buildOpts.entryPointsAdvanced === null ? [] : buildOpts.entryPointsAdvanced) {
    entryPoints.push(new BundlerEntryPoint(ep.inputPath, ep.outputPath));
    if (ep.inputPath.includes("*")) hasEntryPointWithWildcard = true;
  }
  let entryPointCount = entryPoints.length;
  if (buildOpts.stdin !== null) {
    entryPointCount++;
    options.stdin = new StdinInfo(
      buildOpts.stdin.contents,
      buildOpts.stdin.sourcefile,
      validatePath(log, realFS, buildOpts.stdin.resolveDir, "resolve directory path"),
      validateLoader(buildOpts.stdin.loader),
    );
  }

  if (options.absOutputDir === "" && (entryPointCount > 1 || hasEntryPointWithWildcard)) {
    log.addError(null, RANGE_ZERO, 'Must use "outdir" when there are multiple input files');
  } else if (options.absOutputDir === "" && options.codeSplitting) {
    log.addError(null, RANGE_ZERO, 'Must use "outdir" when code splitting is enabled');
  } else if (options.absOutputFile !== "" && options.absOutputDir !== "") {
    log.addError(null, RANGE_ZERO, 'Cannot use both "outfile" and "outdir"');
  } else if (options.absOutputFile !== "") {
    // If the output file is specified, use it to derive the output directory
    options.absOutputDir = realFS.dir(options.absOutputFile);
  } else if (options.absOutputDir === "") {
    options.writeToStdout = true;

    // Forbid certain features when writing to stdout
    if (options.sourceMap !== SourceMapNone && options.sourceMap !== SourceMapInline) {
      log.addError(null, RANGE_ZERO, "Cannot use an external source map without an output path");
    }
    if (legalCommentsHasExternalFile(options.legalComments)) {
      log.addError(null, RANGE_ZERO, "Cannot use linked or external legal comments without an output path");
    }
    // (Go iterates a map in random order: the first "file" or "copy" loader
    // found decides the message)
    for (const loader of options.extensionToLoader.values()) {
      if (loader === LoaderFile) {
        log.addError(null, RANGE_ZERO, 'Cannot use the "file" loader without an output path');
        break;
      }
      if (loader === LoaderCopy) {
        log.addError(null, RANGE_ZERO, 'Cannot use the "copy" loader without an output path');
        break;
      }
    }

    // Use the current directory as the output directory instead of an empty
    // string because external modules with relative paths need a base directory.
    options.absOutputDir = realFS.cwd();
  }

  if (!buildOpts.bundle) {
    // Disallow bundle-only options when not bundling
    if (options.externalSettings.preResolve.hasMatchers() || options.externalSettings.postResolve.hasMatchers()) {
      log.addError(null, RANGE_ZERO, 'Cannot use "external" without "bundle"');
    }
    if (options.packageAliases.size > 0) {
      log.addError(null, RANGE_ZERO, 'Cannot use "alias" without "bundle"');
    }
  } else if (options.outputFormat === FormatPreserve) {
    // If the format isn't specified, set the default format using the platform
    switch (options.platform) {
      case PlatformBrowser:
        options.outputFormat = FormatIIFE;
        break;
      case PlatformNode:
        options.outputFormat = FormatCommonJS;
        break;
      case PlatformNeutral:
        options.outputFormat = FormatESModule;
        break;
    }
  }

  // Set the output mode using other settings
  if (buildOpts.bundle) {
    options.mode = ModeBundle;
  } else if (options.outputFormat !== FormatPreserve) {
    options.mode = ModeConvertFormat;
  }

  // Automatically enable the "module" condition for better tree shaking
  if (options.conditions === null && options.platform !== PlatformNeutral) {
    options.conditions = ["module"];
  }

  // Code splitting is experimental and currently only enabled for ES6 modules
  if (options.codeSplitting && options.outputFormat !== FormatESModule) {
    log.addError(null, RANGE_ZERO, 'Splitting currently only works with the "esm" format');
  }

  if (options.tsConfigPath !== "" && options.tsConfigRaw !== "") {
    log.addError(null, RANGE_ZERO, 'Cannot provide "tsconfig" as both a raw string and a path');
  }

  // If we aren't writing the output to the file system, then we can allow the
  // output paths to be the same as the input paths. This helps when serving.
  if (!buildOpts.write) {
    options.allowOverwrite = true;
  }

  return [options, entryPoints];
}

// ---------------------------------------------------------------------------
// Plugins: service.go convertPlugins + api_impl.go's plugin wrappers

// config.go compileFilter: Go's regexp.Compile (goregexp.mjs) of a plugin
// filter (with the "(?flags)" prefix from jsRegExpToGoRegExp), cached like
// Go's filterCache. null if it does not compile.
const filterCache = new Map<string, GoRegexp | null>();
function compileFilter(filter: string): GoRegexp | null {
  if (filter === "") {
    return null;
  }
  const cached = filterCache.get(filter);
  if (cached !== undefined) return cached;
  const result = goRegexpCompile(filter);
  const re = result instanceof RegexpError ? null : result;
  filterCache.set(filter, re);
  return re;
}

// config.go CompileFilterForPlugin: [filter, null] or [null, error text]
export function compileFilterForPlugin(pluginName: string, kind: string, filter: string): [GoRegexp | null, string | null] {
  if (filter === "") {
    return [null, "[" + pluginName + "] " + goQuote(kind) + " is missing a filter"];
  }

  const result = compileFilter(filter);
  if (result === null) {
    return [null, "[" + pluginName + "] " + goQuote(kind) + " filter is not a valid Go regular expression: " + goQuote(filter)];
  }

  return [result, null];
}

// config.OnResolveResult
export class OnResolveResult {
  declare pluginName: string;
  declare absWatchFiles: string[] | null;
  declare absWatchDirs: string[] | null;
  declare pluginData: any;
  declare path: Path;
  declare external: boolean;
  declare isSideEffectFree: boolean;
  declare msgs: Msg[];
  declare thrownError: string | null;
  constructor() {
    this.msgs = [];
    this.thrownError = null;
    this.pluginName = "";
    this.absWatchFiles = null;
    this.absWatchDirs = null;
    this.pluginData = null;
    this.path = new Path();
    this.external = false;
    this.isSideEffectFree = false;
  }
}

// config.OnLoadResult ("contents" is the bytes or null)
export class OnLoadResult {
  declare pluginName: string;
  declare absWatchFiles: string[] | null;
  declare absWatchDirs: string[] | null;
  declare contents: Uint8Array | null;
  declare absResolveDir: string;
  declare pluginData: any;
  declare loader: number;
  declare msgs: Msg[];
  declare thrownError: string | null;
  constructor() {
    this.msgs = [];
    this.thrownError = null;
    this.pluginName = "";
    this.absWatchFiles = null;
    this.absWatchDirs = null;
    this.contents = null;
    this.absResolveDir = "";
    this.pluginData = null;
    this.loader = LoaderNone;
  }
}

// api.OutputFile.Hash: base64.RawStdEncoding of the little-endian xxhash
const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function outputFileHash(contents: Uint8Array): string {
  const [h, l] = sum64(contents);
  const bytes = [l & 0xff, (l >>> 8) & 0xff, (l >>> 16) & 0xff, l >>> 24, h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff, h >>> 24];
  let out = "";
  let i = 0;
  for (; i + 2 < 8; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += base64Chars[v >> 18] + base64Chars[(v >> 12) & 63] + base64Chars[(v >> 6) & 63] + base64Chars[v & 63];
  }
  // 8 = 3 + 3 + 2: two bytes left, no padding (RawStdEncoding)
  const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
  out += base64Chars[v >> 18] + base64Chars[(v >> 12) & 63] + base64Chars[(v >> 6) & 63];
  return out;
}

// ---------------------------------------------------------------------------
// formatMessages() and analyzeMetafile(): api_impl.go formatMsgsImpl and
// analyzeMetafileImpl

// formatMsgsImpl ("msgs" are api.Message values): the formatted messages as
// byte strings (one char per UTF-8 byte)
export function formatMsgsImpl(msgs: any[], kind: number, color: boolean, terminalWidth: number, logStyle: number): string[] {
  const logMsgs = convertMessagesToInternal([], kind, msgs);
  const strings: string[] = new Array(logMsgs.length);
  for (let i = 0; i < logMsgs.length; i++) {
    const options = new OutputOptions(0, true, ColorIfTerminal, LevelNone, logStyle);
    strings[i] = msgToString(logMsgs[i], options, new TerminalInfo(false, color, terminalWidth));
  }
  return strings;
}

class metafileEntry {
  declare name: string;
  declare entryPoint: string;
  declare entries: metafileEntry[];
  declare size: number;
  constructor(name: string, entryPoint: string, entries: metafileEntry[], size: number) {
    this.name = name;
    this.entryPoint = entryPoint;
    this.entries = entries;
    this.size = size;
  }
}

// metafileArray.Less
function metafileEntryLess(a: metafileEntry, b: metafileEntry): boolean {
  return a.size > b.size || (a.size === b.size && goStringLess(a.name, b.name));
}
function metafileEntryCompare(a: metafileEntry, b: metafileEntry): number {
  return metafileEntryLess(a, b) ? -1 : metafileEntryLess(b, a) ? 1 : 0;
}

function getObjectProperty(expr: any, key: string): any {
  if (expr !== null && expr.data instanceof EObject) {
    for (const prop of expr.data.properties) {
      if (prop.key.data.value === key) {
        return prop.valueOrNil;
      }
    }
  }
  return null;
}
function getObjectPropertyNumber(expr: any, key: string): ENumber | null {
  const value = getObjectProperty(expr, key);
  return value !== null && value.data instanceof ENumber ? value.data : null;
}
function getObjectPropertyString(expr: any, key: string): EString | null {
  const value = getObjectProperty(expr, key);
  return value !== null && value.data instanceof EString ? value.data : null;
}
function getObjectPropertyObject(expr: any, key: string): EObject | null {
  const value = getObjectProperty(expr, key);
  return value !== null && value.data instanceof EObject ? value.data : null;
}
function getObjectPropertyArray(expr: any, key: string): EArray | null {
  const value = getObjectProperty(expr, key);
  return value !== null && value.data instanceof EArray ? value.data : null;
}

// api_impl.go prettyPrintByteCount ("n" is a Go int: a whole number, beyond
// 2^53 as float64(n))
export function prettyPrintByteCount(n: number): string {
  let size: string;
  if (n < 1024) {
    size = goIntString(n) + "b ";
  } else if (n < 1024 * 1024) {
    size = formatFloatFixed(n / 1024, 1) + "kb";
  } else if (n < 1024 * 1024 * 1024) {
    size = formatFloatFixed(n / (1024 * 1024), 1) + "mb";
  } else {
    size = formatFloatFixed(n / (1024 * 1024 * 1024), 1) + "gb";
  }
  return size;
}

// utf8.RuneCountInString of a string's WTF-8 encoding (a lone surrogate is
// 3 invalid bytes, each counted as a rune)
function runeCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        i++;
        n++;
        continue;
      }
    }
    n += c >= 0xd800 && c <= 0xdfff ? 3 : 1;
  }
  return n;
}

// fmt's %d of a Go int held as a number (exact for every value an int(x)
// conversion of a float64 gives)
function goIntString(n: number): string {
  if (Math.abs(n) < 2 ** 53) return String(n);
  // (int64 values of this size are whole float64 values, except MaxInt64,
  // which a saturating conversion gives and float64 rounds to 2^63)
  if (n >= 2 ** 63) return "9223372036854775807";
  return BigInt(n).toString();
}

interface metafileGraphData {
  parent: string;
  depth: number;
}

interface metafileTableEntry {
  first: string;
  second: string;
  third: string;
  firstLen: number;
  secondLen: number;
  thirdLen: number;
  isTopLevel: boolean;
}

const ESC = String.fromCharCode(27);

export function analyzeMetafileImpl(metafile: string, verbose: boolean, color: boolean): string {
  const log = newDeferLog(DeferLogNoVerboseOrDebug, null);
  const source = new Source(undefined, "", metafile);

  const $j = parseJSON(log, source, new JSONOptions());
  if ($j[1]) {
    const result = $j[0];
    const outputs = getObjectPropertyObject(result, "outputs");
    if (outputs !== null) {
      const entries: metafileEntry[] = [];
      const entryPoints: string[] = [];

      // Scan over the "outputs" object
      for (const output of outputs.properties) {
        const key = output.key.data.value;
        if (!key.endsWith(".map")) {
          let entryPointPath = "";
          const entryPoint = getObjectPropertyString(output.valueOrNil, "entryPoint");
          if (entryPoint !== null) {
            entryPointPath = entryPoint.value;
            entryPoints.push(entryPointPath);
          }

          const bytes = getObjectPropertyNumber(output.valueOrNil, "bytes");
          if (bytes !== null) {
            const inputs = getObjectPropertyObject(output.valueOrNil, "inputs");
            if (inputs !== null) {
              const children: metafileEntry[] = [];

              for (const input of inputs.properties) {
                const bytesInOutput = getObjectPropertyNumber(input.valueOrNil, "bytesInOutput");
                if (bytesInOutput !== null && bytesInOutput.value > 0) {
                  children.push(new metafileEntry(input.key.data.value, "", [], goIntFromFloat(bytesInOutput.value)));
                }
              }

              // FIXME(sort-stability): Go's sort.Sort is not stable (only
              // identical entries compare equal, so the order is the same)
              children.sort(metafileEntryCompare);

              entries.push(new metafileEntry(key, entryPointPath, children, goIntFromFloat(bytes.value)));
            }
          }
        }
      }

      entries.sort(metafileEntryCompare);

      const importsForPath = new Map<string, string[]>();

      // Scan over the "inputs" object
      const inputs = getObjectPropertyObject(result, "inputs");
      if (inputs !== null) {
        for (const prop of inputs.properties) {
          const imports = getObjectPropertyArray(prop.valueOrNil, "imports");
          if (imports !== null) {
            const data: string[] = [];

            for (const item of imports.items) {
              const path = getObjectPropertyString(item, "path");
              if (path !== null) {
                data.push(path.value);
              }
            }

            importsForPath.set(prop.key.data.value, data);
          }
        }
      }

      // Returns a graph with links pointing from imports to importers
      const graphForEntryPoints = (worklist: string[]): Map<string, metafileGraphData> | null => {
        if (!verbose) {
          return null;
        }

        const graph = new Map<string, metafileGraphData>();

        for (const entryPoint of worklist) {
          graph.set(entryPoint, { parent: "", depth: 0 });
        }

        worklist = worklist.slice();
        while (worklist.length > 0) {
          const top = worklist.pop();
          const topData = graph.get(top);
          const childDepth = (topData === undefined ? 0 : topData.depth) + 1;

          const imports = importsForPath.get(top);
          if (imports !== undefined) {
            for (const importPath of imports) {
              const old = graph.get(importPath);
              const imported = old === undefined ? { parent: "", depth: 0xffffffff } : { parent: old.parent, depth: old.depth };

              if (imported.depth > childDepth) {
                imported.depth = childDepth;
                imported.parent = top;
                graph.set(importPath, imported);
                worklist.push(importPath);
              }
            }
          }
        }

        return graph;
      };

      const graphForAllEntryPoints = graphForEntryPoints(entryPoints);

      const table: metafileTableEntry[] = [];
      const colors = color ? { reset: ESC + "[0m", bold: ESC + "[1m", dim: ESC + "[37m" } : { reset: "", bold: "", dim: "" };

      // Build up the table with an entry for each output file (other than ".map" files)
      for (const entry of entries) {
        const second = prettyPrintByteCount(entry.size);
        const third = "100.0%";

        table.push({ first: entry.name, firstLen: runeCount(entry.name), second, secondLen: second.length, third, thirdLen: third.length, isTopLevel: true });

        let graph = graphForAllEntryPoints;
        if (entry.entryPoint !== "") {
          // If there are multiple entry points and this output file is from an
          // entry point, prefer import paths for this entry point. This is less
          // confusing than showing import paths for another entry point.
          graph = graphForEntryPoints([entry.entryPoint]);
        }

        // Add a sub-entry for each input file in this output file
        for (let j = 0; j < entry.entries.length; j++) {
          const child = entry.entries[j];
          let indent = " " + String.fromCharCode(0x251c) + " ";
          if (j + 1 === entry.entries.length) {
            indent = " " + String.fromCharCode(0x2514) + " ";
          }
          const percent = (100.0 * child.size) / entry.size;

          const first = indent + child.name;
          const second = prettyPrintByteCount(child.size);
          const third = formatFloatFixed(percent, 1) + "%";

          table.push({ first, firstLen: runeCount(first), second, secondLen: second.length, third, thirdLen: third.length, isTopLevel: false });

          // If we're in verbose mode, also print the import chain from this file
          // up toward an entry point to show why this file is in the bundle
          if (verbose) {
            indent = " " + String.fromCharCode(0x2502) + " ";
            if (j + 1 === entry.entries.length) {
              indent = "   ";
            }
            const zero = { parent: "", depth: 0 };
            let data = graph.get(child.name) || zero;
            let depth = 0;

            while (data.depth !== 0) {
              table.push({
                first: indent + colors.dim + " ".repeat(depth) + " " + String.fromCharCode(0x2514) + " " + data.parent + colors.reset,
                second: "",
                third: "",
                firstLen: 0,
                secondLen: 0,
                thirdLen: 0,
                isTopLevel: false,
              });
              data = graph.get(data.parent) || zero;
              depth += 3;
            }
          }
        }
      }

      let maxFirstLen = 0;
      let maxSecondLen = 0;
      let maxThirdLen = 0;

      // Calculate column widths
      for (const entry of table) {
        if (maxFirstLen < entry.firstLen) {
          maxFirstLen = entry.firstLen;
        }
        if (maxSecondLen < entry.secondLen) {
          maxSecondLen = entry.secondLen;
        }
        if (maxThirdLen < entry.thirdLen) {
          maxThirdLen = entry.thirdLen;
        }
      }

      let sb = "";

      // Render the columns now that we know the widths
      for (const entry of table) {
        let prefix = "\n";
        let entryColor = colors.bold;
        if (!entry.isTopLevel) {
          prefix = "";
          entryColor = "";
        }

        // Import paths don't have second and third columns
        if (entry.second === "" && entry.third === "") {
          sb += prefix + "  " + entry.first + "\n";
          continue;
        }

        const second = entry.second;
        let secondTrimmed = second;
        while (secondTrimmed.endsWith(" ")) secondTrimmed = secondTrimmed.slice(0, -1);
        let lineChar = " ";
        let extraSpace = 0;

        if (verbose) {
          lineChar = String.fromCharCode(0x2500);
          extraSpace = 1;
        }

        // (strings.Repeat panics on a negative count; the widths never are)
        sb +=
          prefix +
          "  " +
          entryColor +
          entry.first +
          colors.reset +
          " " +
          colors.dim +
          lineChar.repeat(extraSpace + maxFirstLen - entry.firstLen + maxSecondLen - entry.secondLen) +
          colors.reset +
          " " +
          entryColor +
          secondTrimmed +
          colors.reset +
          " " +
          colors.dim +
          lineChar.repeat(extraSpace + maxThirdLen - entry.thirdLen + second.length - secondTrimmed.length) +
          colors.reset +
          " " +
          entryColor +
          entry.third +
          colors.reset +
          "\n";
      }

      return sb;
    }
  }

  return "";
}
