// pkg/api's option types (api.go) and pkg/cli's flag parsing (cli_impl.go
// parseOptionsImpl, parseTargets, parseOptionsForRun, filterAnalyzeFlags,
// parseServeOptionsImpl; cli.go ParseBuildOptions / ParseTransformOptions;
// internal/cli_helpers). The service parses the flags of every "build" and
// "transform" request with these (kindExternal), the CLI its arguments
// (kindInternal).
//
// Enums keep Go's values (api.SourceMapNone = 0, ...). Go's maps are Maps in
// insertion order (Go iterates them in random order; esbuild sorts where the
// order matters).

import { goQuote } from "./gostd.mjs";
import { goStringsToLower } from "./gostrings.mjs";

// ---------------------------------------------------------------------------
// api.go

// SourceMap
export const SourceMapNone = 0;
export const SourceMapInline = 1;
export const SourceMapLinked = 2;
export const SourceMapExternal = 3;
export const SourceMapInlineAndExternal = 4;

// SourcesContent
export const SourcesContentInclude = 0;
export const SourcesContentExclude = 1;

// LegalComments
export const LegalCommentsDefault = 0;
export const LegalCommentsNone = 1;
export const LegalCommentsInline = 2;
export const LegalCommentsEndOfFile = 3;
export const LegalCommentsLinked = 4;
export const LegalCommentsExternal = 5;

// JSX
export const JSXTransform = 0;
export const JSXPreserve = 1;
export const JSXAutomatic = 2;

// Target
export const DefaultTarget = 0;
export const ESNext = 1;
export const ES5 = 2;
export const ES2015 = 3;
export const ES2016 = 4;
export const ES2017 = 5;
export const ES2018 = 6;
export const ES2019 = 7;
export const ES2020 = 8;
export const ES2021 = 9;
export const ES2022 = 10;
export const ES2023 = 11;
export const ES2024 = 12;
export const ES2025 = 13;

// Loader
export const LoaderNone = 0;
export const LoaderBase64 = 1;
export const LoaderBinary = 2;
export const LoaderCopy = 3;
export const LoaderCSS = 4;
export const LoaderDataURL = 5;
export const LoaderDefault = 6;
export const LoaderEmpty = 7;
export const LoaderFile = 8;
export const LoaderGlobalCSS = 9;
export const LoaderJS = 10;
export const LoaderJSON = 11;
export const LoaderJSX = 12;
export const LoaderLocalCSS = 13;
export const LoaderText = 14;
export const LoaderTS = 15;
export const LoaderTSX = 16;

// Platform
export const PlatformDefault = 0;
export const PlatformBrowser = 1;
export const PlatformNode = 2;
export const PlatformNeutral = 3;

// Format
export const FormatDefault = 0;
export const FormatIIFE = 1;
export const FormatCommonJS = 2;
export const FormatESModule = 3;

// Packages
export const PackagesDefault = 0;
export const PackagesBundle = 1;
export const PackagesExternal = 2;

// StderrColor
export const ColorIfTerminal = 0;
export const ColorNever = 1;
export const ColorAlways = 2;

// LogLevel
export const LogLevelSilent = 0;
export const LogLevelVerbose = 1;
export const LogLevelDebug = 2;
export const LogLevelInfo = 3;
export const LogLevelWarning = 4;
export const LogLevelError = 5;

// LogStyle
export const LogStyleDefault = 0;
export const LogStyleVisualStudio = 1;

// Charset
export const CharsetDefault = 0;
export const CharsetASCII = 1;
export const CharsetUTF8 = 2;

// TreeShaking
export const TreeShakingDefault = 0;
export const TreeShakingFalse = 1;
export const TreeShakingTrue = 2;

// Drop
export const DropConsole = 1;
export const DropDebugger = 2;

// MangleQuoted
export const MangleQuotedFalse = 0;
export const MangleQuotedTrue = 1;

// AbsPaths
export const CodeAbsPath = 1;
export const LogAbsPath = 2;
export const MetafileAbsPath = 4;

// EngineName (api_js_table.go)
export const EngineChrome = 0;
export const EngineDeno = 1;
export const EngineEdge = 2;
export const EngineFirefox = 3;
export const EngineHermes = 4;
export const EngineIE = 5;
export const EngineIOS = 6;
export const EngineNode = 7;
export const EngineOpera = 8;
export const EngineRhino = 9;
export const EngineSafari = 10;

export class Engine {
  declare name: number;
  declare version: string;
  constructor(name: number, version: string) {
    this.name = name;
    this.version = version;
  }
}

export class EntryPoint {
  declare inputPath: string;
  declare outputPath: string;
  constructor(inputPath: string, outputPath: string) {
    this.inputPath = inputPath;
    this.outputPath = outputPath;
  }
}

export class StdinOptions {
  declare contents: string;
  declare resolveDir: string;
  declare sourcefile: string;
  declare loader: number;
  constructor() {
    this.contents = "";
    this.resolveDir = "";
    this.sourcefile = "";
    this.loader = LoaderNone;
  }
}

export class BuildOptions {
  declare color: number;
  declare logLevel: number;
  declare logStyle: number;
  declare logLimit: number;
  declare logOverride: Map<string, number>;
  declare absPaths: number;

  declare sourcemap: number;
  declare sourceRoot: string;
  declare sourcesContent: number;

  declare target: number;
  declare engines: Engine[];
  declare supported: Map<string, boolean>;

  declare mangleProps: string;
  declare reserveProps: string;
  declare mangleQuoted: number;
  declare mangleCache: Map<string, any> | null;
  declare drop: number;
  declare dropLabels: string[] | null;
  declare minifyWhitespace: boolean;
  declare minifyIdentifiers: boolean;
  declare minifySyntax: boolean;
  declare lineLimit: number;
  declare charset: number;
  declare treeShaking: number;
  declare ignoreAnnotations: boolean;
  declare legalComments: number;

  declare jsx: number;
  declare jsxFactory: string;
  declare jsxFragment: string;
  declare jsxImportSource: string;
  declare jsxDev: boolean;
  declare jsxSideEffects: boolean;

  declare define: Map<string, string>;
  declare pure: string[] | null;
  declare keepNames: boolean;

  declare globalName: string;
  declare bundle: boolean;
  declare preserveSymlinks: boolean;
  declare splitting: boolean;
  declare outfile: string;
  declare metafile: boolean;
  declare outdir: string;
  declare outbase: string;
  declare absWorkingDir: string;
  declare platform: number;
  declare format: number;
  declare external: string[] | null;
  declare packages: number;
  declare alias: Map<string, string> | null;
  declare mainFields: string[] | null;
  declare conditions: string[] | null;
  declare loader: Map<string, number>;
  declare resolveExtensions: string[] | null;
  declare tsconfig: string;
  declare tsconfigRaw: string;
  declare outExtension: Map<string, string> | null;
  declare publicPath: string;
  declare inject: string[] | null;
  declare banner: Map<string, string>;
  declare footer: Map<string, string>;
  declare nodePaths: string[] | null;

  declare entryNames: string;
  declare chunkNames: string;
  declare assetNames: string;

  declare entryPoints: string[] | null;
  declare entryPointsAdvanced: EntryPoint[] | null;

  declare stdin: StdinOptions | null;
  declare write: boolean;
  declare allowOverwrite: boolean;
  declare plugins: any[] | null;
  // cli.newBuildOptions
  constructor() {
    this.color = ColorIfTerminal;
    this.logLevel = LogLevelSilent;
    this.logStyle = LogStyleDefault;
    this.logLimit = 0;
    this.logOverride = new Map();
    this.absPaths = 0;
    this.sourcemap = SourceMapNone;
    this.sourceRoot = "";
    this.sourcesContent = SourcesContentInclude;
    this.target = DefaultTarget;
    this.engines = [];
    this.supported = new Map();
    this.mangleProps = "";
    this.reserveProps = "";
    this.mangleQuoted = MangleQuotedFalse;
    this.mangleCache = null;
    this.drop = 0;
    this.dropLabels = null;
    this.minifyWhitespace = false;
    this.minifyIdentifiers = false;
    this.minifySyntax = false;
    this.lineLimit = 0;
    this.charset = CharsetDefault;
    this.treeShaking = TreeShakingDefault;
    this.ignoreAnnotations = false;
    this.legalComments = LegalCommentsDefault;
    this.jsx = JSXTransform;
    this.jsxFactory = "";
    this.jsxFragment = "";
    this.jsxImportSource = "";
    this.jsxDev = false;
    this.jsxSideEffects = false;
    this.define = new Map();
    this.pure = null;
    this.keepNames = false;
    this.globalName = "";
    this.bundle = false;
    this.preserveSymlinks = false;
    this.splitting = false;
    this.outfile = "";
    this.metafile = false;
    this.outdir = "";
    this.outbase = "";
    this.absWorkingDir = "";
    this.platform = PlatformDefault;
    this.format = FormatDefault;
    this.external = null;
    this.packages = PackagesDefault;
    this.alias = null;
    this.mainFields = null;
    this.conditions = null;
    this.loader = new Map();
    this.resolveExtensions = null;
    this.tsconfig = "";
    this.tsconfigRaw = "";
    this.outExtension = null;
    this.publicPath = "";
    this.inject = null;
    this.banner = new Map();
    this.footer = new Map();
    this.nodePaths = null;
    this.entryNames = "";
    this.chunkNames = "";
    this.assetNames = "";
    this.entryPoints = null;
    this.entryPointsAdvanced = null;
    this.stdin = null;
    this.write = false;
    this.allowOverwrite = false;
    this.plugins = null;
  }
}

export class TransformOptions {
  declare color: number;
  declare logLevel: number;
  declare logStyle: number;
  declare logLimit: number;
  declare logOverride: Map<string, number>;
  declare absPaths: number;

  declare sourcemap: number;
  declare sourceRoot: string;
  declare sourcesContent: number;

  declare target: number;
  declare engines: Engine[];
  declare supported: Map<string, boolean>;

  declare platform: number;
  declare format: number;
  declare globalName: string;

  declare mangleProps: string;
  declare reserveProps: string;
  declare mangleQuoted: number;
  declare mangleCache: Map<string, any> | null;
  declare drop: number;
  declare dropLabels: string[] | null;
  declare minifyWhitespace: boolean;
  declare minifyIdentifiers: boolean;
  declare minifySyntax: boolean;
  declare lineLimit: number;
  declare charset: number;
  declare treeShaking: number;
  declare ignoreAnnotations: boolean;
  declare legalComments: number;

  declare jsx: number;
  declare jsxFactory: string;
  declare jsxFragment: string;
  declare jsxImportSource: string;
  declare jsxDev: boolean;
  declare jsxSideEffects: boolean;

  declare tsconfigRaw: string;
  declare banner: string;
  declare footer: string;

  declare define: Map<string, string>;
  declare pure: string[] | null;
  declare keepNames: boolean;

  declare sourcefile: string;
  declare loader: number;
  // cli.newTransformOptions
  constructor() {
    this.color = ColorIfTerminal;
    this.logLevel = LogLevelSilent;
    this.logStyle = LogStyleDefault;
    this.logLimit = 0;
    this.logOverride = new Map();
    this.absPaths = 0;
    this.sourcemap = SourceMapNone;
    this.sourceRoot = "";
    this.sourcesContent = SourcesContentInclude;
    this.target = DefaultTarget;
    this.engines = [];
    this.supported = new Map();
    this.platform = PlatformDefault;
    this.format = FormatDefault;
    this.globalName = "";
    this.mangleProps = "";
    this.reserveProps = "";
    this.mangleQuoted = MangleQuotedFalse;
    this.mangleCache = null;
    this.drop = 0;
    this.dropLabels = null;
    this.minifyWhitespace = false;
    this.minifyIdentifiers = false;
    this.minifySyntax = false;
    this.lineLimit = 0;
    this.charset = CharsetDefault;
    this.treeShaking = TreeShakingDefault;
    this.ignoreAnnotations = false;
    this.legalComments = LegalCommentsDefault;
    this.jsx = JSXTransform;
    this.jsxFactory = "";
    this.jsxFragment = "";
    this.jsxImportSource = "";
    this.jsxDev = false;
    this.jsxSideEffects = false;
    this.tsconfigRaw = "";
    this.banner = "";
    this.footer = "";
    this.define = new Map();
    this.pure = null;
    this.keepNames = false;
    this.sourcefile = "";
    this.loader = LoaderNone;
  }
}

// ServeOptions (cli_impl.go parseServeOptionsImpl's result)
export class ServeOptions {
  declare port: number;
  declare host: string;
  declare servedir: string;
  declare keyfile: string;
  declare certfile: string;
  declare fallback: string;
  declare corsOrigin: string[] | null;
  declare onRequest: ((args: any) => void) | null;
  constructor() {
    this.port = 0;
    this.host = "";
    this.servedir = "";
    this.keyfile = "";
    this.certfile = "";
    this.fallback = "";
    this.corsOrigin = null;
    this.onRequest = null;
  }
}

// ---------------------------------------------------------------------------
// internal/cli_helpers

export class ErrorWithNote {
  declare text: string;
  declare note: string;
  constructor(text: string, note: string) {
    this.text = text;
    this.note = note;
  }
}

export function makeErrorWithNote(text: string, note: string): ErrorWithNote {
  return new ErrorWithNote(text, note);
}

// Returns [loader, error]
export function parseLoader(text: string): [number, ErrorWithNote | null] {
  switch (text) {
    case "base64":
      return [LoaderBase64, null];
    case "binary":
      return [LoaderBinary, null];
    case "copy":
      return [LoaderCopy, null];
    case "css":
      return [LoaderCSS, null];
    case "dataurl":
      return [LoaderDataURL, null];
    case "default":
      return [LoaderDefault, null];
    case "empty":
      return [LoaderEmpty, null];
    case "file":
      return [LoaderFile, null];
    case "global-css":
      return [LoaderGlobalCSS, null];
    case "js":
      return [LoaderJS, null];
    case "json":
      return [LoaderJSON, null];
    case "jsx":
      return [LoaderJSX, null];
    case "local-css":
      return [LoaderLocalCSS, null];
    case "text":
      return [LoaderText, null];
    case "ts":
      return [LoaderTS, null];
    case "tsx":
      return [LoaderTSX, null];
    default:
      return [
        LoaderNone,
        makeErrorWithNote(
          "Invalid loader value: " + goQuote(text),
          'Valid values are "base64", "binary", "copy", "css", "dataurl", "empty", "file", "global-css", "js", "json", "jsx", "local-css", "text", "ts", or "tsx".',
        ),
      ];
  }
}

// ---------------------------------------------------------------------------
// cli_impl.go

// parseOptionsKind
export const kindInternal = 0; // parsing it for our own internal use
export const kindExternal = 1; // the result is returned through a public API

export class parseOptionsExtras {
  declare watch: boolean;
  declare watchDelay: number;
  declare metafile: string | null;
  declare mangleCache: string | null;
  constructor() {
    this.watch = false;
    this.watchDelay = 0;
    this.metafile = null;
    this.mangleCache = null;
  }
}

export function isBoolFlag(arg: string, flag: string): boolean {
  if (arg.startsWith(flag)) {
    const remainder = arg.length - flag.length;
    return remainder === 0 || arg.charCodeAt(flag.length) === 0x3d; /* = */
  }
  return false;
}

// Returns [value, error]
export function parseBoolFlag(arg: string, defaultValue: boolean): [boolean, ErrorWithNote | null] {
  const equals = arg.indexOf("=");
  if (equals === -1) {
    return [defaultValue, null];
  }
  const value = arg.slice(equals + 1);
  switch (value) {
    case "false":
      return [false, null];
    case "true":
      return [true, null];
  }
  return [false, makeErrorWithNote("Invalid value " + goQuote(value) + " in " + goQuote(arg), 'Valid values are "true" or "false".')];
}

// strconv.Atoi: [value, ok] (Go's int is 64 bits)
export function goAtoi(s: string): [number, boolean] {
  let i = 0;
  if (s.length > 0 && (s[0] === "+" || s[0] === "-")) i = 1;
  if (i === s.length) return [0, false];
  for (let j = i; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c < 0x30 || c > 0x39) return [0, false];
  }
  const big = BigInt(s);
  if (big > 9223372036854775807n || big < -9223372036854775808n) return [0, false];
  return [Number(big), true];
}

class OptionsError {
  declare err: ErrorWithNote;
  constructor(err: ErrorWithNote) {
    this.err = err;
  }
}

// Returns [extras, error]
export function parseOptionsImpl(osArgs: string[], buildOpts: BuildOptions | null, transformOpts: TransformOptions | null, kind: number): [parseOptionsExtras, ErrorWithNote | null] {
  try {
    return [parseOptionsImplThrowing(osArgs, buildOpts, transformOpts, kind), null];
  } catch (e) {
    if (e instanceof OptionsError) return [new parseOptionsExtras(), e.err];
    throw e;
  }
}

function fail(text: string, note: string): never {
  throw new OptionsError(makeErrorWithNote(text, note));
}
function boolFlag(arg: string, defaultValue: boolean): boolean {
  const [value, err] = parseBoolFlag(arg, defaultValue);
  if (err !== null) throw new OptionsError(err);
  return value;
}

function parseOptionsImplThrowing(osArgs: string[], buildOpts: BuildOptions | null, transformOpts: TransformOptions | null, kind: number): parseOptionsExtras {
  const extras = new parseOptionsExtras();
  let hasBareSourceMapFlag = false;
  // (every option shared by both kinds is set on "opts")
  const opts: any = buildOpts !== null ? buildOpts : transformOpts;

  // Parse the arguments now that we know what we're parsing
  for (const arg of osArgs) {
    if (isBoolFlag(arg, "--bundle") && buildOpts !== null) {
      buildOpts.bundle = boolFlag(arg, true);
    } else if (isBoolFlag(arg, "--preserve-symlinks") && buildOpts !== null) {
      buildOpts.preserveSymlinks = boolFlag(arg, true);
    } else if (isBoolFlag(arg, "--splitting") && buildOpts !== null) {
      buildOpts.splitting = boolFlag(arg, true);
    } else if (isBoolFlag(arg, "--allow-overwrite") && buildOpts !== null) {
      buildOpts.allowOverwrite = boolFlag(arg, true);
    } else if (isBoolFlag(arg, "--watch") && buildOpts !== null) {
      extras.watch = boolFlag(arg, true);
    } else if (arg.startsWith("--watch-delay=") && buildOpts !== null) {
      const value = arg.slice("--watch-delay=".length);
      const [delay, ok] = goAtoi(value);
      if (!ok) {
        fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), "The watch delay must be an integer.");
      }
      extras.watchDelay = delay;
    } else if (isBoolFlag(arg, "--minify")) {
      const value = boolFlag(arg, true);
      opts.minifySyntax = value;
      opts.minifyWhitespace = value;
      opts.minifyIdentifiers = value;
    } else if (isBoolFlag(arg, "--minify-syntax")) {
      opts.minifySyntax = boolFlag(arg, true);
    } else if (isBoolFlag(arg, "--minify-whitespace")) {
      opts.minifyWhitespace = boolFlag(arg, true);
    } else if (isBoolFlag(arg, "--minify-identifiers")) {
      opts.minifyIdentifiers = boolFlag(arg, true);
    } else if (isBoolFlag(arg, "--mangle-quoted")) {
      const value = boolFlag(arg, true);
      opts.mangleQuoted = value ? MangleQuotedTrue : MangleQuotedFalse;
    } else if (arg.startsWith("--mangle-props=")) {
      opts.mangleProps = arg.slice("--mangle-props=".length);
    } else if (arg.startsWith("--reserve-props=")) {
      opts.reserveProps = arg.slice("--reserve-props=".length);
    } else if (arg.startsWith("--mangle-cache=") && buildOpts !== null && kind === kindInternal) {
      extras.mangleCache = arg.slice("--mangle-cache=".length);
    } else if (arg.startsWith("--drop:")) {
      const value = arg.slice("--drop:".length);
      switch (value) {
        case "console":
          opts.drop |= DropConsole;
          break;
        case "debugger":
          opts.drop |= DropDebugger;
          break;
        default:
          fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), 'Valid values are "console" or "debugger".');
      }
    } else if (arg.startsWith("--drop-labels=")) {
      opts.dropLabels = splitWithEmptyCheck(arg.slice("--drop-labels=".length), ",");
    } else if (arg.startsWith("--legal-comments=")) {
      const value = arg.slice("--legal-comments=".length);
      let legalComments: number;
      switch (value) {
        case "none":
          legalComments = LegalCommentsNone;
          break;
        case "inline":
          legalComments = LegalCommentsInline;
          break;
        case "eof":
          legalComments = LegalCommentsEndOfFile;
          break;
        case "linked":
          legalComments = LegalCommentsLinked;
          break;
        case "external":
          legalComments = LegalCommentsExternal;
          break;
        default:
          fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), 'Valid values are "none", "inline", "eof", "linked", or "external".');
      }
      opts.legalComments = legalComments;
    } else if (arg.startsWith("--charset=")) {
      const name = arg.slice("--charset=".length);
      switch (name) {
        case "ascii":
          opts.charset = CharsetASCII;
          break;
        case "utf8":
          opts.charset = CharsetUTF8;
          break;
        default:
          fail("Invalid value " + goQuote(name) + " in " + goQuote(arg), 'Valid values are "ascii" or "utf8".');
      }
    } else if (isBoolFlag(arg, "--tree-shaking")) {
      const value = boolFlag(arg, true);
      opts.treeShaking = value ? TreeShakingTrue : TreeShakingFalse;
    } else if (isBoolFlag(arg, "--ignore-annotations")) {
      opts.ignoreAnnotations = boolFlag(arg, true);
    } else if (isBoolFlag(arg, "--keep-names")) {
      opts.keepNames = boolFlag(arg, true);
    } else if (arg === "--sourcemap") {
      if (buildOpts !== null) {
        buildOpts.sourcemap = SourceMapLinked;
      } else {
        transformOpts!.sourcemap = SourceMapInline;
      }
      hasBareSourceMapFlag = true;
    } else if (arg.startsWith("--sourcemap=")) {
      const value = arg.slice("--sourcemap=".length);
      let sourcemap: number;
      switch (value) {
        case "linked":
          sourcemap = SourceMapLinked;
          break;
        case "inline":
          sourcemap = SourceMapInline;
          break;
        case "external":
          sourcemap = SourceMapExternal;
          break;
        case "both":
          sourcemap = SourceMapInlineAndExternal;
          break;
        default:
          fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), 'Valid values are "linked", "inline", "external", or "both".');
      }
      opts.sourcemap = sourcemap;
      hasBareSourceMapFlag = false;
    } else if (arg.startsWith("--source-root=")) {
      opts.sourceRoot = arg.slice("--source-root=".length);
    } else if (isBoolFlag(arg, "--sources-content")) {
      const value = boolFlag(arg, true);
      opts.sourcesContent = value ? SourcesContentInclude : SourcesContentExclude;
    } else if (arg.startsWith("--sourcefile=")) {
      if (buildOpts !== null) {
        if (buildOpts.stdin === null) {
          buildOpts.stdin = new StdinOptions();
        }
        buildOpts.stdin.sourcefile = arg.slice("--sourcefile=".length);
      } else {
        transformOpts!.sourcefile = arg.slice("--sourcefile=".length);
      }
    } else if (arg.startsWith("--resolve-extensions=") && buildOpts !== null) {
      buildOpts.resolveExtensions = splitWithEmptyCheck(arg.slice("--resolve-extensions=".length), ",");
    } else if (arg.startsWith("--main-fields=") && buildOpts !== null) {
      buildOpts.mainFields = splitWithEmptyCheck(arg.slice("--main-fields=".length), ",");
    } else if (arg.startsWith("--conditions=") && buildOpts !== null) {
      buildOpts.conditions = splitWithEmptyCheck(arg.slice("--conditions=".length), ",");
    } else if (arg.startsWith("--public-path=") && buildOpts !== null) {
      buildOpts.publicPath = arg.slice("--public-path=".length);
    } else if (arg.startsWith("--global-name=")) {
      opts.globalName = arg.slice("--global-name=".length);
    } else if (arg === "--metafile" && buildOpts !== null && kind === kindExternal) {
      buildOpts.metafile = true;
    } else if (arg.startsWith("--metafile=") && buildOpts !== null && kind === kindInternal) {
      const value = arg.slice("--metafile=".length);
      buildOpts.metafile = true;
      extras.metafile = value;
    } else if (arg.startsWith("--outfile=") && buildOpts !== null) {
      buildOpts.outfile = arg.slice("--outfile=".length);
    } else if (arg.startsWith("--outdir=") && buildOpts !== null) {
      buildOpts.outdir = arg.slice("--outdir=".length);
    } else if (arg.startsWith("--outbase=") && buildOpts !== null) {
      buildOpts.outbase = arg.slice("--outbase=".length);
    } else if (arg.startsWith("--tsconfig=") && buildOpts !== null) {
      buildOpts.tsconfig = arg.slice("--tsconfig=".length);
    } else if (arg.startsWith("--tsconfig-raw=")) {
      opts.tsconfigRaw = arg.slice("--tsconfig-raw=".length);
    } else if (arg.startsWith("--entry-names=") && buildOpts !== null) {
      buildOpts.entryNames = arg.slice("--entry-names=".length);
    } else if (arg.startsWith("--chunk-names=") && buildOpts !== null) {
      buildOpts.chunkNames = arg.slice("--chunk-names=".length);
    } else if (arg.startsWith("--asset-names=") && buildOpts !== null) {
      buildOpts.assetNames = arg.slice("--asset-names=".length);
    } else if (arg.startsWith("--define:")) {
      const value = arg.slice("--define:".length);
      const equals = value.indexOf("=");
      if (equals === -1) {
        fail(
          'Missing "=" in ' + goQuote(arg),
          'You need to use "=" to specify both the original value and the replacement value. ' + 'For example, "--define:DEBUG=true" replaces "DEBUG" with "true".',
        );
      }
      opts.define.set(value.slice(0, equals), value.slice(equals + 1));
    } else if (arg.startsWith("--log-override:")) {
      const value = arg.slice("--log-override:".length);
      const equals = value.indexOf("=");
      if (equals === -1) {
        fail(
          'Missing "=" in ' + goQuote(arg),
          'You need to use "=" to specify both the message name and the log level. ' +
            'For example, "--log-override:css-syntax-error=error" turns all "css-syntax-error" log messages into errors.',
        );
      }
      const logLevel = parseLogLevel(value.slice(equals + 1), arg);
      opts.logOverride.set(value.slice(0, equals), logLevel);
    } else if (arg.startsWith("--abs-paths=")) {
      const values = splitWithEmptyCheck(arg.slice("--abs-paths=".length), ",");
      let absPaths = 0;
      for (const value of values) {
        switch (value) {
          case "code":
            absPaths |= CodeAbsPath;
            break;
          case "log":
            absPaths |= LogAbsPath;
            break;
          case "metafile":
            absPaths |= MetafileAbsPath;
            break;
          default:
            fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), 'Valid values are "code", "log", or "metafile".');
        }
      }
      opts.absPaths = absPaths;
    } else if (arg.startsWith("--supported:")) {
      const value = arg.slice("--supported:".length);
      const equals = value.indexOf("=");
      if (equals === -1) {
        fail(
          'Missing "=" in ' + goQuote(arg),
          'You need to use "=" to specify both the name of the feature and whether it is supported or not. ' +
            'For example, "--supported:arrow=false" marks arrow functions as unsupported.',
        );
      }
      const isSupported = boolFlag(arg, true);
      opts.supported.set(value.slice(0, equals), isSupported);
    } else if (arg.startsWith("--pure:")) {
      const value = arg.slice("--pure:".length);
      if (opts.pure === null) opts.pure = [];
      opts.pure.push(value);
    } else if (arg.startsWith("--loader:") && buildOpts !== null) {
      const value = arg.slice("--loader:".length);
      const equals = value.indexOf("=");
      if (equals === -1) {
        fail(
          'Missing "=" in ' + goQuote(arg),
          "You need to specify the file extension that the loader applies to. " + 'For example, "--loader:.js=jsx" applies the "jsx" loader to files with the ".js" extension.',
        );
      }
      const ext = value.slice(0, equals);
      const text = value.slice(equals + 1);
      const [loader, err] = parseLoader(text);
      if (err !== null) {
        throw new OptionsError(err);
      }
      buildOpts.loader.set(ext, loader);
    } else if (arg.startsWith("--loader=")) {
      const value = arg.slice("--loader=".length);
      const [loader, err] = parseLoader(value);
      if (err !== null) {
        throw new OptionsError(err);
      }
      if (loader === LoaderFile || loader === LoaderCopy) {
        fail(
          goQuote(arg) + " is not supported when transforming stdin",
          "Using esbuild to transform stdin only generates one output file, so you cannot use the " + goQuote(value) + " loader " + "since that needs to generate two output files.",
        );
      }
      if (buildOpts !== null) {
        if (buildOpts.stdin === null) {
          buildOpts.stdin = new StdinOptions();
        }
        buildOpts.stdin.loader = loader;
      } else {
        transformOpts!.loader = loader;
      }
    } else if (arg.startsWith("--target=")) {
      const [target, engines, err] = parseTargets(splitWithEmptyCheck(arg.slice("--target=".length), ","), arg);
      if (err !== null) {
        throw new OptionsError(err);
      }
      opts.target = target;
      opts.engines = engines;
    } else if (arg.startsWith("--out-extension:") && buildOpts !== null) {
      const value = arg.slice("--out-extension:".length);
      const equals = value.indexOf("=");
      if (equals === -1) {
        fail(
          'Missing "=" in ' + goQuote(arg),
          'You need to use either "--out-extension:.js=..." or "--out-extension:.css=..." ' + "to specify the file type that the output extension applies to .",
        );
      }
      if (buildOpts.outExtension === null) {
        buildOpts.outExtension = new Map();
      }
      buildOpts.outExtension.set(value.slice(0, equals), value.slice(equals + 1));
    } else if (arg.startsWith("--platform=")) {
      const value = arg.slice("--platform=".length);
      let platform: number;
      switch (value) {
        case "browser":
          platform = PlatformBrowser;
          break;
        case "node":
          platform = PlatformNode;
          break;
        case "neutral":
          platform = PlatformNeutral;
          break;
        default:
          fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), 'Valid values are "browser", "node", or "neutral".');
      }
      opts.platform = platform;
    } else if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      let format: number;
      switch (value) {
        case "iife":
          format = FormatIIFE;
          break;
        case "cjs":
          format = FormatCommonJS;
          break;
        case "esm":
          format = FormatESModule;
          break;
        default:
          fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), 'Valid values are "iife", "cjs", or "esm".');
      }
      opts.format = format;
    } else if (arg.startsWith("--packages=") && buildOpts !== null) {
      const value = arg.slice("--packages=".length);
      let packages: number;
      switch (value) {
        case "bundle":
          packages = PackagesBundle;
          break;
        case "external":
          packages = PackagesExternal;
          break;
        default:
          fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), 'Valid values are "bundle" or "external".');
      }
      buildOpts.packages = packages;
    } else if (arg.startsWith("--external:") && buildOpts !== null) {
      if (buildOpts.external === null) buildOpts.external = [];
      buildOpts.external.push(arg.slice("--external:".length));
    } else if (arg.startsWith("--inject:") && buildOpts !== null) {
      if (buildOpts.inject === null) buildOpts.inject = [];
      buildOpts.inject.push(arg.slice("--inject:".length));
    } else if (arg.startsWith("--alias:") && buildOpts !== null) {
      const value = arg.slice("--alias:".length);
      const equals = value.indexOf("=");
      if (equals === -1) {
        fail(
          'Missing "=" in ' + goQuote(arg),
          'You need to use "=" to specify both the original package name and the replacement package name. ' + 'For example, "--alias:old=new" replaces package "old" with package "new".',
        );
      }
      if (buildOpts.alias === null) {
        buildOpts.alias = new Map();
      }
      buildOpts.alias.set(value.slice(0, equals), value.slice(equals + 1));
    } else if (arg.startsWith("--jsx=")) {
      const value = arg.slice("--jsx=".length);
      let mode: number;
      switch (value) {
        case "transform":
          mode = JSXTransform;
          break;
        case "preserve":
          mode = JSXPreserve;
          break;
        case "automatic":
          mode = JSXAutomatic;
          break;
        default:
          fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), 'Valid values are "transform", "automatic", or "preserve".');
      }
      opts.jsx = mode;
    } else if (arg.startsWith("--jsx-factory=")) {
      opts.jsxFactory = arg.slice("--jsx-factory=".length);
    } else if (arg.startsWith("--jsx-fragment=")) {
      opts.jsxFragment = arg.slice("--jsx-fragment=".length);
    } else if (arg.startsWith("--jsx-import-source=")) {
      opts.jsxImportSource = arg.slice("--jsx-import-source=".length);
    } else if (isBoolFlag(arg, "--jsx-dev")) {
      opts.jsxDev = boolFlag(arg, true);
    } else if (isBoolFlag(arg, "--jsx-side-effects")) {
      opts.jsxSideEffects = boolFlag(arg, true);
    } else if (arg.startsWith("--banner=") && transformOpts !== null) {
      transformOpts.banner = arg.slice("--banner=".length);
    } else if (arg.startsWith("--footer=") && transformOpts !== null) {
      transformOpts.footer = arg.slice("--footer=".length);
    } else if (arg.startsWith("--banner:") && buildOpts !== null) {
      const value = arg.slice("--banner:".length);
      const equals = value.indexOf("=");
      if (equals === -1) {
        fail('Missing "=" in ' + goQuote(arg), 'You need to use either "--banner:js=..." or "--banner:css=..." to specify the language that the banner applies to.');
      }
      buildOpts.banner.set(value.slice(0, equals), value.slice(equals + 1));
    } else if (arg.startsWith("--footer:") && buildOpts !== null) {
      const value = arg.slice("--footer:".length);
      const equals = value.indexOf("=");
      if (equals === -1) {
        fail('Missing "=" in ' + goQuote(arg), 'You need to use either "--footer:js=..." or "--footer:css=..." to specify the language that the footer applies to.');
      }
      buildOpts.footer.set(value.slice(0, equals), value.slice(equals + 1));
    } else if (arg.startsWith("--log-limit=")) {
      const value = arg.slice("--log-limit=".length);
      const [limit, ok] = goAtoi(value);
      if (!ok || limit < 0) {
        fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), "The log limit must be a non-negative integer.");
      }
      opts.logLimit = limit;
    } else if (arg.startsWith("--line-limit=")) {
      const value = arg.slice("--line-limit=".length);
      const [limit, ok] = goAtoi(value);
      if (!ok || limit < 0) {
        fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), "The line limit must be a non-negative integer.");
      }
      opts.lineLimit = limit;

      // Make sure this stays in sync with "PrintErrorToStderr"
    } else if (isBoolFlag(arg, "--color")) {
      const value = boolFlag(arg, true);
      opts.color = value ? ColorAlways : ColorNever;

      // Make sure this stays in sync with "PrintErrorToStderr"
    } else if (arg.startsWith("--log-level=")) {
      const value = arg.slice("--log-level=".length);
      opts.logLevel = parseLogLevel(value, arg);

      // Make sure this stays in sync with "PrintErrorToStderr"
    } else if (arg.startsWith("--log-style=")) {
      const value = arg.slice("--log-style=".length);
      opts.logStyle = parseLogStyle(value, arg);
    } else if (arg.startsWith("'--")) {
      fail(
        "Unexpected single quote character before flag: " + arg,
        "This typically happens when attempting to use single quotes to quote arguments with a shell that doesn't recognize single quotes. " +
          "Try using double quote characters to quote arguments instead.",
      );
    } else if (!arg.startsWith("-") && buildOpts !== null) {
      const equals = arg.indexOf("=");
      if (equals !== -1) {
        if (buildOpts.entryPointsAdvanced === null) buildOpts.entryPointsAdvanced = [];
        buildOpts.entryPointsAdvanced.push(new EntryPoint(arg.slice(equals + 1), arg.slice(0, equals)));
      } else {
        if (buildOpts.entryPoints === null) buildOpts.entryPoints = [];
        buildOpts.entryPoints.push(arg);
      }
    } else {
      const bare = new Set([
        "allow-overwrite",
        "bundle",
        "ignore-annotations",
        "jsx-dev",
        "jsx-side-effects",
        "keep-names",
        "minify-identifiers",
        "minify-syntax",
        "minify-whitespace",
        "minify",
        "preserve-symlinks",
        "sourcemap",
        "splitting",
        "watch",
      ]);

      const equals = new Set([
        "abs-paths",
        "allow-overwrite",
        "asset-names",
        "banner",
        "bundle",
        "certfile",
        "charset",
        "chunk-names",
        "color",
        "conditions",
        "cors-origin",
        "drop-labels",
        "entry-names",
        "footer",
        "format",
        "global-name",
        "ignore-annotations",
        "jsx-factory",
        "jsx-fragment",
        "jsx-import-source",
        "jsx",
        "keep-names",
        "keyfile",
        "legal-comments",
        "loader",
        "log-level",
        "log-limit",
        "main-fields",
        "mangle-cache",
        "mangle-props",
        "mangle-quoted",
        "metafile",
        "minify-identifiers",
        "minify-syntax",
        "minify-whitespace",
        "minify",
        "outbase",
        "outdir",
        "outfile",
        "packages",
        "platform",
        "preserve-symlinks",
        "public-path",
        "reserve-props",
        "resolve-extensions",
        "serve-fallback",
        "serve",
        "servedir",
        "source-root",
        "sourcefile",
        "sourcemap",
        "sources-content",
        "splitting",
        "target",
        "tree-shaking",
        "tsconfig-raw",
        "tsconfig",
        "watch",
        "watch-delay",
      ]);

      const colon = new Set(["alias", "banner", "define", "drop", "external", "footer", "inject", "loader", "log-override", "out-extension", "pure", "supported"]);

      let note = "";

      // Try to provide helpful hints when we can recognize the mistake
      if (arg === "-o") {
        note = 'Use "--outfile=" to configure the output file instead of "-o".';
      } else if (arg === "-v") {
        note = 'Use "--log-level=verbose" to generate verbose logs instead of "-v".';
      } else if (arg.startsWith("--")) {
        let i = arg.indexOf("=");
        if (i !== -1 && colon.has(arg.slice(2, i))) {
          note = "Use " + goQuote(arg.slice(0, i) + ":" + arg.slice(i + 1)) + " instead of " + goQuote(arg) + '. Flags that can be re-specified multiple times use ":" instead of "=".';
        }

        i = arg.indexOf(":");
        if (i !== -1 && equals.has(arg.slice(2, i))) {
          note = "Use " + goQuote(arg.slice(0, i) + "=" + arg.slice(i + 1)) + " instead of " + goQuote(arg) + '. Flags that can only be specified once use "=" instead of ":".';
        }
      } else if (arg.startsWith("-")) {
        let isValid = bare.has(arg.slice(1));
        let fix = "-" + arg;

        const i = arg.indexOf("=");
        if (i !== -1 && equals.has(arg.slice(1, i))) {
          isValid = true;
        } else if (i !== -1 && colon.has(arg.slice(1, i))) {
          isValid = true;
          fix = "-" + arg.slice(0, i) + ":" + arg.slice(i + 1);
        } else {
          const j = arg.indexOf(":");
          if (j !== -1 && colon.has(arg.slice(1, j))) {
            isValid = true;
          } else if (j !== -1 && equals.has(arg.slice(1, j))) {
            isValid = true;
            fix = "-" + arg.slice(0, j) + "=" + arg.slice(j + 1);
          }
        }

        if (isValid) {
          note = "Use " + goQuote(fix) + " instead of " + goQuote(arg) + ". Flags are always specified with two dashes instead of one dash.";
        }
      }

      if (buildOpts !== null) {
        fail("Invalid build flag: " + goQuote(arg), note);
      } else {
        fail("Invalid transform flag: " + goQuote(arg), note);
      }
    }
  }

  // If we're building, the last source map flag is "--sourcemap", and there
  // is no output path, change the source map option to "inline" because we're
  // going to be writing to stdout which can only represent a single file.
  if (buildOpts !== null && hasBareSourceMapFlag && buildOpts.outfile === "" && buildOpts.outdir === "") {
    buildOpts.sourcemap = SourceMapInline;
  }

  return extras;
}

// cli_js_table.go validEngines
const validEngines: [string, number][] = [
  ["chrome", EngineChrome],
  ["deno", EngineDeno],
  ["edge", EngineEdge],
  ["firefox", EngineFirefox],
  ["hermes", EngineHermes],
  ["ie", EngineIE],
  ["ios", EngineIOS],
  ["node", EngineNode],
  ["opera", EngineOpera],
  ["rhino", EngineRhino],
  ["safari", EngineSafari],
];

const validTargets = new Map<string, number>([
  ["esnext", ESNext],
  ["es5", ES5],
  ["es6", ES2015],
  ["es2015", ES2015],
  ["es2016", ES2016],
  ["es2017", ES2017],
  ["es2018", ES2018],
  ["es2019", ES2019],
  ["es2020", ES2020],
  ["es2021", ES2021],
  ["es2022", ES2022],
  ["es2023", ES2023],
  ["es2024", ES2024],
  ["es2025", ES2025],
]);

// Returns [target, engines, error]. (Go iterates validEngines in random
// order: no engine name is a prefix of another, so the order does not
// matter.)
export function parseTargets(targets: string[], arg: string): [number, Engine[], ErrorWithNote | null] {
  let target = DefaultTarget;
  const engines: Engine[] = [];

  outer: for (const value of targets) {
    // (strings.ToLower and toLowerCase differ for a few non-ASCII characters,
    // but no non-ASCII character lowercases to a character of a valid name)
    const valid = validTargets.get(goStringsToLower(value));
    if (valid !== undefined) {
      target = valid;
      continue;
    }

    for (const [engine, name] of validEngines) {
      if (value.startsWith(engine)) {
        const version = value.slice(engine.length);
        if (version === "") {
          return [0, [], makeErrorWithNote("Target " + goQuote(value) + " is missing a version number in " + goQuote(arg), "")];
        }
        engines.push(new Engine(name, version));
        continue outer;
      }
    }

    const names: string[] = ['"esN"'];
    for (const [key] of validEngines) {
      names.push(goQuote(key + "N"));
    }
    names.sort();
    return [
      0,
      [],
      makeErrorWithNote(
        "Invalid target " + goQuote(value) + " in " + goQuote(arg),
        "Valid values are " + names.slice(0, names.length - 1).join(", ") + ", or " + names[names.length - 1] + " where N is a version number.",
      ),
    ];
  }
  return [target, engines, null];
}

export function isArgForBuild(arg: string): boolean {
  return !arg.startsWith("-") || arg === "--bundle";
}

// This returns either BuildOptions, TransformOptions, or an error:
// [buildOptions, transformOptions, extras, error]
export function parseOptionsForRun(osArgs: string[]): [BuildOptions | null, TransformOptions | null, parseOptionsExtras, ErrorWithNote | null] {
  // If there's an entry point or we're bundling, then we're building
  for (const arg of osArgs) {
    if (isArgForBuild(arg)) {
      const options = new BuildOptions();

      // Apply defaults appropriate for the CLI
      options.logLimit = 6;
      options.logLevel = LogLevelInfo;
      options.write = true;

      const [extras, err] = parseOptionsImpl(osArgs, options, null, kindInternal);
      if (err !== null) {
        return [null, null, new parseOptionsExtras(), err];
      }
      return [options, null, extras, null];
    }
  }

  // Otherwise, we're transforming
  const options = new TransformOptions();

  // Apply defaults appropriate for the CLI
  options.logLimit = 6;
  options.logLevel = LogLevelInfo;

  const [, err] = parseOptionsImpl(osArgs, null, options, kindInternal);
  if (err !== null) {
    return [null, null, new parseOptionsExtras(), err];
  }
  if (options.sourcemap !== SourceMapNone && options.sourcemap !== SourceMapInline) {
    let sourceMapMode = "";
    switch (options.sourcemap) {
      case SourceMapExternal:
        sourceMapMode = "external";
        break;
      case SourceMapInlineAndExternal:
        sourceMapMode = "both";
        break;
      case SourceMapLinked:
        sourceMapMode = "linked";
        break;
    }
    return [
      null,
      null,
      new parseOptionsExtras(),
      makeErrorWithNote(
        'Use "--sourcemap" instead of "--sourcemap=' + sourceMapMode + '" when transforming stdin',
        "Using esbuild to transform stdin only generates one output file. You cannot use the " + goQuote(sourceMapMode) + " source map mode " + "since that needs to generate two output files.",
      ),
    ];
  }
  return [null, options, new parseOptionsExtras(), null];
}

export function splitWithEmptyCheck(s: string, sep: string): string[] {
  // Special-case the empty string to return [] instead of [""]
  if (s === "") {
    return [];
  }

  return s.split(sep);
}

// analyzeMode
export const analyzeDisabled = 0;
export const analyzeEnabled = 1;
export const analyzeVerbose = 2;

// Returns [osArgs, analyze]
export function filterAnalyzeFlags(osArgs: string[]): [string[], number] {
  for (const arg of osArgs) {
    if (isArgForBuild(arg)) {
      let analyze = analyzeDisabled;
      const out: string[] = [];
      for (const arg of osArgs) {
        switch (arg) {
          case "--analyze":
            analyze = analyzeEnabled;
            break;
          case "--analyze=verbose":
            analyze = analyzeVerbose;
            break;
          default:
            out.push(arg);
        }
      }
      return [out, analyze];
    }
  }
  return [osArgs, analyzeDisabled];
}

function parseLogLevel(value: string, arg: string): number {
  switch (value) {
    case "verbose":
      return LogLevelVerbose;
    case "debug":
      return LogLevelDebug;
    case "info":
      return LogLevelInfo;
    case "warning":
      return LogLevelWarning;
    case "error":
      return LogLevelError;
    case "silent":
      return LogLevelSilent;
    default:
      fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), 'Valid values are "verbose", "debug", "info", "warning", "error", or "silent".');
  }
}

function parseLogStyle(value: string, arg: string): number {
  switch (value) {
    case "default":
      return LogStyleDefault;
    case "visualstudio":
      return LogStyleVisualStudio;
    default:
      fail("Invalid value " + goQuote(value) + " in " + goQuote(arg), 'Valid values are "default" or "visualstudio".');
  }
}

// ---------------------------------------------------------------------------
// cli.go

// ParseBuildOptions: [options, error text or null]
export function parseBuildOptions(osArgs: string[]): [BuildOptions, string | null] {
  const options = new BuildOptions();
  const [, errWithNote] = parseOptionsImpl(osArgs, options, null, kindExternal);
  return [options, errWithNote !== null ? errWithNote.text : null];
}

// ParseTransformOptions: [options, error text or null]
export function parseTransformOptions(osArgs: string[]): [TransformOptions, string | null] {
  const options = new TransformOptions();
  const [, errWithNote] = parseOptionsImpl(osArgs, null, options, kindExternal);
  return [options, errWithNote !== null ? errWithNote.text : null];
}
