// Port of the parts of internal/config (config.go, globals.go) used by the
// transform pipeline.
import { EUndefinedShared, ENumber } from "./js_ast.mjs";
import { stringArraysEqual } from "./helpers.mjs";
import { KNOWN_GLOBALS } from "./config_globals.mjs";
import { JSFeatureNone } from "./compat.mjs";
import type { JSFeature } from "./compat.mjs";

export class DefineExpr {
  declare constant: any;
  declare parts: any;
  declare injectedDefineIndex: number;
  constructor(constant = null, parts = null, injectedDefineIndex = -1) {
    this.constant = constant; // js_ast.E or null
    this.parts = parts; // []string or null
    this.injectedDefineIndex = injectedDefineIndex; // Index32
  }
}

export class JSXOptions {
  declare factory: DefineExpr;
  declare fragment: DefineExpr;
  declare parse: boolean;
  declare preserve: boolean;
  declare automaticRuntime: boolean;
  declare importSource: string;
  declare development: boolean;
  declare sideEffects: boolean;
  constructor(
    factory = new DefineExpr(),
    fragment = new DefineExpr(),
    parse = false,
    preserve = false,
    automaticRuntime = false,
    importSource = "",
    development = false,
    sideEffects = false,
  ) {
    this.factory = factory;
    this.fragment = fragment;
    this.parse = parse;
    this.preserve = preserve;
    this.automaticRuntime = automaticRuntime;
    this.importSource = importSource;
    this.development = development;
    this.sideEffects = sideEffects;
  }
  clone() {
    return new JSXOptions(
      this.factory,
      this.fragment,
      this.parse,
      this.preserve,
      this.automaticRuntime,
      this.importSource,
      this.development,
      this.sideEffects,
    );
  }
}

// TSJSX
export const TSJSXNone = 0;
export const TSJSXPreserve = 1;
export const TSJSXReactNative = 2;
export const TSJSXReact = 3;
export const TSJSXReactJSX = 4;
export const TSJSXReactJSXDev = 5;

// MaybeBool
export const Unspecified = 0;
export const True = 1;
export const False = 2;

// TSImportsNotUsedAsValues
export const TSImportsNotUsedAsValues_None = 0;
export const TSImportsNotUsedAsValues_Remove = 1;
export const TSImportsNotUsedAsValues_Preserve = 2;
export const TSImportsNotUsedAsValues_Error = 3;

// TSUnusedImportFlags
export const TSUnusedImport_KeepStmt = 1;
export const TSUnusedImport_KeepValues = 2;

// TSTarget
export const TSTargetUnspecified = 0;
export const TSTargetBelowES2022 = 1;
export const TSTargetAtOrAboveES2022 = 2;

export class TSConfig {
  declare experimentalDecorators: number;
  declare importsNotUsedAsValues: number;
  declare preserveValueImports: number;
  declare target: number;
  declare useDefineForClassFields: number;
  declare verbatimModuleSyntax: number;
  constructor(
    experimentalDecorators = Unspecified,
    importsNotUsedAsValues = TSImportsNotUsedAsValues_None,
    preserveValueImports = Unspecified,
    target = TSTargetUnspecified,
    useDefineForClassFields = Unspecified,
    verbatimModuleSyntax = Unspecified,
  ) {
    this.experimentalDecorators = experimentalDecorators;
    this.importsNotUsedAsValues = importsNotUsedAsValues;
    this.preserveValueImports = preserveValueImports;
    this.target = target;
    this.useDefineForClassFields = useDefineForClassFields;
    this.verbatimModuleSyntax = verbatimModuleSyntax;
  }
  unusedImportFlags() {
    let flags = 0;
    if (this.verbatimModuleSyntax === True) return TSUnusedImport_KeepStmt | TSUnusedImport_KeepValues;
    if (this.preserveValueImports === True) flags |= TSUnusedImport_KeepValues;
    if (
      this.importsNotUsedAsValues === TSImportsNotUsedAsValues_Preserve ||
      this.importsNotUsedAsValues === TSImportsNotUsedAsValues_Error
    ) {
      flags |= TSUnusedImport_KeepStmt;
    }
    return flags;
  }
}

export class TSOptions {
  declare config: TSConfig;
  declare parse: boolean;
  declare noAmbiguousLessThan: boolean;
  constructor(config = new TSConfig(), parse = false, noAmbiguousLessThan = false) {
    this.config = config;
    this.parse = parse;
    this.noAmbiguousLessThan = noAmbiguousLessThan;
  }
}

export class TSAlwaysStrict {
  declare name: string;
  declare source: any;
  declare range: any;
  declare value: boolean;
  constructor(name = "", source = null, range = null, value = false) {
    this.name = name;
    this.source = source;
    this.range = range;
    this.value = value;
  }
}

// Platform
export const PlatformBrowser = 0;
export const PlatformNode = 1;
export const PlatformNeutral = 2;

// SourceMap
export const SourceMapNone = 0;
export const SourceMapInline = 1;
export const SourceMapLinkedWithComment = 2;
export const SourceMapExternalWithoutComment = 3;
export const SourceMapInlineAndExternal = 4;

// LegalComments
export const LegalCommentsInline = 0;
export const LegalCommentsNone = 1;
export const LegalCommentsEndOfFile = 2;
export const LegalCommentsLinkedWithComment = 3;
export const LegalCommentsExternalWithoutComment = 4;

export function legalCommentsHasExternalFile(lc) {
  return lc === LegalCommentsLinkedWithComment || lc === LegalCommentsExternalWithoutComment;
}

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
export const LoaderWithTypeJSON = 12;
export const LoaderJSX = 13;
export const LoaderLocalCSS = 14;
export const LoaderText = 15;
export const LoaderTS = 16;
export const LoaderTSNoAmbiguousLessThan = 17;
export const LoaderTSX = 18;

export const LoaderToString = [
  "none",
  "base64",
  "binary",
  "copy",
  "css",
  "dataurl",
  "default",
  "empty",
  "file",
  "global-css",
  "js",
  "json",
  "json",
  "jsx",
  "local-css",
  "text",
  "ts",
  "ts",
  "tsx",
];

export function loaderIsTypeScript(loader) {
  return loader === LoaderTS || loader === LoaderTSNoAmbiguousLessThan || loader === LoaderTSX;
}
export function loaderIsCSS(loader) {
  return loader === LoaderCSS || loader === LoaderGlobalCSS || loader === LoaderLocalCSS;
}

// Format
export const FormatPreserve = 0;
export const FormatIIFE = 1;
export const FormatCommonJS = 2;
export const FormatESModule = 3;

export function formatKeepESMImportExportSyntax(f) {
  return f === FormatPreserve || f === FormatESModule;
}
export function formatString(f) {
  switch (f) {
    case FormatIIFE:
      return "iife";
    case FormatCommonJS:
      return "cjs";
    case FormatESModule:
      return "esm";
  }
  return "";
}

export class StdinInfo {
  declare contents: string;
  declare sourceFile: string;
  declare absResolveDir: string;
  declare loader: number;
  constructor(contents = "", sourceFile = "", absResolveDir = "", loader = LoaderNone) {
    this.contents = contents;
    this.sourceFile = sourceFile;
    this.absResolveDir = absResolveDir;
    this.loader = loader;
  }
}

// APICall
export const BuildCall = 0;
export const TransformCall = 1;

// Mode
export const ModePassThrough = 0;
export const ModeConvertFormat = 1;
export const ModeBundle = 2;

export function shouldCallRuntimeRequire(mode, outputFormat) {
  return mode === ModeBundle && outputFormat !== FormatCommonJS;
}

// The subset of config.Options that the transform pipeline reads.
export class Options {
  declare moduleTypeData: any;
  declare defines: any;
  declare tsAlwaysStrict: any;
  declare mangleProps: any;
  declare reserveProps: any;
  declare originalTargetEnv: string;
  declare dropLabels: any[];
  declare absOutputFile: string;
  declare globalName: any[];
  declare tsConfigRaw: string;
  declare injectedDefines: any[];
  declare injectedFiles: any[];
  declare jsBanner: string;
  declare jsFooter: string;
  declare cssBanner: string;
  declare cssFooter: string;
  declare sourceRoot: string;
  declare stdin: any;
  declare jsx: JSXOptions;
  declare lineLimit: number;
  declare unsupportedJSFeatures: JSFeature;
  declare unsupportedJSFeatureOverrides: JSFeature;
  declare unsupportedJSFeatureOverridesMask: JSFeature;
  declare cssPrefixData: Map<number, number> | null;
  declare unsupportedCSSFeatures: number;
  declare unsupportedCSSFeatureOverrides: number;
  declare unsupportedCSSFeatureOverridesMask: number;
  declare ts: TSOptions;
  declare mode: number;
  declare minifyWhitespace: boolean;
  declare minifyIdentifiers: boolean;
  declare minifySyntax: boolean;
  declare profilerNames: boolean;
  declare codeSplitting: boolean;
  declare legalComments: number;
  declare asciiOnly: boolean;
  declare keepNames: boolean;
  declare ignoreDCEAnnotations: boolean;
  declare treeShaking: boolean;
  declare dropDebugger: boolean;
  declare mangleQuoted: boolean;
  declare platform: number;
  declare outputFormat: number;
  declare sourceMap: number;
  declare excludeSourcesContent: boolean;
  declare omitRuntimeForTests: boolean;
  declare omitJSXRuntimeForTests: boolean;
  // (the build API's fields)
  declare cancelFlag: CancelFlag | null;
  declare extensionOrder: string[] | null;
  declare mainFields: string[] | null;
  declare conditions: string[] | null;
  declare absNodePaths: string[];
  declare externalSettings: ExternalSettings;
  declare externalPackages: boolean;
  declare packageAliases: Map<string, string> | null;
  declare absOutputDir: string;
  declare absOutputBase: string;
  declare outputExtensionJS: string;
  declare outputExtensionCSS: string;
  declare tsConfigPath: string;
  declare extensionToLoader: Map<string, number> | null;
  declare publicPath: string;
  declare injectPaths: string[];
  declare entryPathTemplate: PathTemplate[];
  declare chunkPathTemplate: PathTemplate[];
  declare assetPathTemplate: PathTemplate[];
  declare plugins: Plugin[];
  declare preserveSymlinks: boolean;
  declare watchMode: boolean;
  declare allowOverwrite: boolean;
  declare logPathStyle: number;
  declare codePathStyle: number;
  declare metafilePathStyle: number;
  declare sourcemapPathStyle: number;
  declare writeToStdout: boolean;
  declare metafileFormat: number;
  declare needsMetafile: boolean;
  constructor() {
    this.moduleTypeData = null; // js_ast.ModuleTypeData
    this.defines = null; // ProcessedDefines
    this.tsAlwaysStrict = null;
    this.mangleProps = null;
    this.reserveProps = null;
    this.originalTargetEnv = "";
    this.dropLabels = [];
    this.absOutputFile = "";
    this.globalName = [];
    this.tsConfigRaw = "";
    this.injectedDefines = [];
    this.injectedFiles = [];
    this.jsBanner = "";
    this.jsFooter = "";
    this.cssBanner = "";
    this.cssFooter = "";
    this.sourceRoot = "";
    this.stdin = null; // StdinInfo
    this.jsx = new JSXOptions();
    this.lineLimit = 0;
    this.unsupportedJSFeatures = JSFeatureNone;
    this.unsupportedJSFeatureOverrides = JSFeatureNone;
    this.unsupportedJSFeatureOverridesMask = JSFeatureNone;
    this.cssPrefixData = null; // map[css_ast.D]compat.CSSPrefix
    this.unsupportedCSSFeatures = 0; // compat.CSSFeature
    this.unsupportedCSSFeatureOverrides = 0;
    this.unsupportedCSSFeatureOverridesMask = 0;
    this.ts = new TSOptions();
    this.mode = ModePassThrough;
    this.minifyWhitespace = false;
    this.minifyIdentifiers = false;
    this.minifySyntax = false;
    this.profilerNames = false;
    this.codeSplitting = false;
    this.legalComments = LegalCommentsInline;
    this.asciiOnly = false;
    this.keepNames = false;
    this.ignoreDCEAnnotations = false;
    this.treeShaking = false;
    this.dropDebugger = false;
    this.mangleQuoted = false;
    this.platform = PlatformBrowser;
    this.outputFormat = FormatPreserve;
    this.sourceMap = SourceMapNone;
    this.excludeSourcesContent = false;
    this.omitRuntimeForTests = false;
    this.omitJSXRuntimeForTests = false;
    this.cancelFlag = null;
    this.extensionOrder = null;
    this.mainFields = null;
    this.conditions = null;
    this.absNodePaths = [];
    this.externalSettings = new ExternalSettings();
    this.externalPackages = false;
    this.packageAliases = null;
    this.absOutputDir = "";
    this.absOutputBase = "";
    this.outputExtensionJS = "";
    this.outputExtensionCSS = "";
    this.tsConfigPath = "";
    this.extensionToLoader = null;
    this.publicPath = "";
    this.injectPaths = [];
    this.entryPathTemplate = [];
    this.chunkPathTemplate = [];
    this.assetPathTemplate = [];
    this.plugins = [];
    this.preserveSymlinks = false;
    this.watchMode = false;
    this.allowOverwrite = false;
    this.logPathStyle = 0; // logger.RelPath
    this.codePathStyle = 0;
    this.metafilePathStyle = 0;
    this.sourcemapPathStyle = 0;
    this.writeToStdout = false;
    this.metafileFormat = UnminifiedMetafile;
    this.needsMetafile = false;
  }
}

// ---------------------------------------------------------------------------
// config.go: the build API's types

export class WildcardPattern {
  declare prefix: string;
  declare suffix: string;
  constructor(prefix = "", suffix = "") {
    this.prefix = prefix;
    this.suffix = suffix;
  }
}

export class ExternalMatchers {
  declare exact: Map<string, boolean>;
  declare patterns: WildcardPattern[];
  constructor(exact = new Map<string, boolean>(), patterns: WildcardPattern[] = []) {
    this.exact = exact;
    this.patterns = patterns;
  }
  hasMatchers() {
    return this.exact.size > 0 || this.patterns.length > 0;
  }
}

export class ExternalSettings {
  declare preResolve: ExternalMatchers;
  declare postResolve: ExternalMatchers;
  constructor(preResolve = new ExternalMatchers(), postResolve = new ExternalMatchers()) {
    this.preResolve = preResolve;
    this.postResolve = postResolve;
  }
}

export class CancelFlag {
  declare value: boolean;
  constructor() {
    this.value = false;
  }
  cancel() {
    this.value = true;
  }
}

// This checks for null in one place so we don't have to do that everywhere
export function cancelFlagDidCancel(flag: CancelFlag | null) {
  return flag !== null && flag.value;
}

// MaybeBool: Unspecified, True, False (above)

// PathPlaceholder
export const NoPlaceholder = 0;
export const DirPlaceholder = 1;
export const NamePlaceholder = 2;
export const HashPlaceholder = 3;
export const ExtPlaceholder = 4;

export class PathTemplate {
  declare data: string;
  declare placeholder: number;
  constructor(data = "", placeholder = NoPlaceholder) {
    this.data = data;
    this.placeholder = placeholder;
  }
}

// PathPlaceholders: null means "not set" (Go: a nil *string)
export class PathPlaceholders {
  declare dir: string | null;
  declare name: string | null;
  declare hash: string | null;
  declare ext: string | null;
  constructor(dir: string | null = null, name: string | null = null, hash: string | null = null, ext: string | null = null) {
    this.dir = dir;
    this.name = name;
    this.hash = hash;
    this.ext = ext;
  }
  get(placeholder: number): string | null {
    switch (placeholder) {
      case DirPlaceholder:
        return this.dir;
      case NamePlaceholder:
        return this.name;
      case HashPlaceholder:
        return this.hash;
      case ExtPlaceholder:
        return this.ext;
    }
    return null;
  }
}

export function templateToString(template: PathTemplate[]): string {
  if (template.length === 1 && template[0].placeholder === NoPlaceholder) {
    // Avoid allocations in this case
    return template[0].data;
  }
  let sb = "";
  for (const part of template) {
    sb += part.data;
    switch (part.placeholder) {
      case DirPlaceholder:
        sb += "[dir]";
        break;
      case NamePlaceholder:
        sb += "[name]";
        break;
      case HashPlaceholder:
        sb += "[hash]";
        break;
      case ExtPlaceholder:
        sb += "[ext]";
        break;
    }
  }
  return sb;
}

export function hasPlaceholder(template: PathTemplate[], placeholder: number): boolean {
  for (const part of template) {
    if (part.placeholder === placeholder) return true;
  }
  return false;
}

export function substituteTemplate(template: PathTemplate[], placeholders: PathPlaceholders): PathTemplate[] {
  // Don't allocate if no substitution is possible and the template is already minimal
  let shouldSubstitute = false;
  for (let i = 0; i < template.length; i++) {
    const part = template[i];
    if (placeholders.get(part.placeholder) !== null || (part.placeholder === NoPlaceholder && i + 1 < template.length)) {
      shouldSubstitute = true;
      break;
    }
  }
  if (!shouldSubstitute) return template;

  // Otherwise, substitute and merge as appropriate
  const result: PathTemplate[] = [];
  for (const original of template) {
    const part = new PathTemplate(original.data, original.placeholder);
    const sub = placeholders.get(part.placeholder);
    if (sub !== null) {
      part.data += sub;
      part.placeholder = NoPlaceholder;
    }
    const last = result.length - 1;
    if (last >= 0 && result[last].placeholder === NoPlaceholder) {
      result[last].data += part.data;
      result[last].placeholder = part.placeholder;
    } else {
      result.push(part);
    }
  }
  return result;
}

export class InjectableExport {
  declare alias: string;
  declare loc: number;
  constructor(alias = "", loc = 0) {
    this.alias = alias;
    this.loc = loc;
  }
}

// Plugin API. "filter" is an object with Go's MatchString (see
// build.mjs compileFilterForPlugin).
export class Plugin {
  declare name: string;
  declare onStart: OnStart[];
  declare onResolve: OnResolve[];
  declare onLoad: OnLoad[];
  constructor(name = "", onStart: OnStart[] = [], onResolve: OnResolve[] = [], onLoad: OnLoad[] = []) {
    this.name = name;
    this.onStart = onStart;
    this.onResolve = onResolve;
    this.onLoad = onLoad;
  }
}

export class OnStart {
  declare callback: any;
  declare name: string;
  constructor(callback = null, name = "") {
    this.callback = callback;
    this.name = name;
  }
}

export class OnResolve {
  declare filter: any;
  declare callback: any;
  declare name: string;
  declare namespace: string;
  constructor(filter = null, callback = null, name = "", namespace = "") {
    this.filter = filter;
    this.callback = callback;
    this.name = name;
    this.namespace = namespace;
  }
}

export class OnLoad {
  declare filter: any;
  declare callback: any;
  declare name: string;
  declare namespace: string;
  constructor(filter = null, callback = null, name = "", namespace = "") {
    this.filter = filter;
    this.callback = callback;
    this.name = name;
    this.namespace = namespace;
  }
}

export function pluginAppliesToPath(path: { text: string; namespace: string }, filter: { matchString(s: string): boolean }, namespace: string): boolean {
  return (namespace === "" || path.namespace === namespace) && filter.matchString(path.text);
}

// MetafileFormat
export const UnminifiedMetafile = 0;
export const MinifiedMetafile = 1;

export function metafileFormatMaybeRemoveWhitespace(mf: number, fmt: string): string {
  if (mf === MinifiedMetafile) {
    let result = "";
    for (let i = 0; i < fmt.length; i++) {
      const c = fmt.charCodeAt(i);
      if (c !== 32 && c !== 10) result += fmt[i];
    }
    return result;
  }
  return fmt;
}

// Loader.CanHaveSourceMap
export function loaderCanHaveSourceMap(loader: number): boolean {
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

// config.LoaderFromFileExtension
export function loaderFromFileExtension(extensionToLoader: Map<string, number>, base: string): number {
  // Pick the loader with the longest matching extension. So if there's an
  // extension for ".css" and for ".module.css", we want to match the one for
  // ".module.css" before the one for ".css".
  let i = base.indexOf(".");
  if (i !== -1) {
    for (;;) {
      const loader = extensionToLoader.get(base.slice(i));
      if (loader !== undefined) return loader;
      base = base.slice(i + 1);
      i = base.indexOf(".");
      if (i === -1) break;
    }
  } else {
    // If there's no extension, explicitly check for an extensionless loader
    const loader = extensionToLoader.get("");
    if (loader !== undefined) return loader;
  }
  return LoaderNone;
}

export class InjectedDefine {
  declare data: any;
  declare name: string;
  declare source: any;
  constructor(data = null, name = "", source = null) {
    this.data = data;
    this.name = name;
    this.source = source;
  }
}

export class InjectedFile {
  declare exports: any[];
  declare defineName: string;
  declare source: any;
  declare isCopyLoader: boolean;
  constructor(exports_ = [], defineName = "", source = null, isCopyLoader = false) {
    this.exports = exports_;
    this.defineName = defineName;
    this.source = source;
    this.isCopyLoader = isCopyLoader;
  }
}

// ---------------------------------------------------------------------------
// globals.go

export class DefineData {
  declare keyParts: any;
  declare defineExpr: any;
  declare flags: number;
  constructor(keyParts = null, defineExpr = null, flags = 0) {
    this.keyParts = keyParts; // []string
    this.defineExpr = defineExpr; // *DefineExpr
    this.flags = flags;
  }
}

// DefineFlags
export const CanBeRemovedIfUnused = 1 << 0;
export const CallCanBeUnwrappedIfUnused = 1 << 1;
export const MethodCallsMustBeReplacedWithUndefined = 1 << 2;
export const IsSymbolInstance = 1 << 3;

function mergeDefineData(old, new_) {
  return new DefineData(new_.keyParts, new_.defineExpr, new_.flags | old.flags);
}

export class ProcessedDefines {
  declare identifierDefines: Map<any, any>;
  declare dotDefines: Map<any, any>;
  constructor(identifierDefines = new Map(), dotDefines = new Map()) {
    this.identifierDefines = identifierDefines; // Map<string, DefineData>
    this.dotDefines = dotDefines; // Map<string, DefineData[]>
  }
}

let processedGlobals = null;

export function processDefines(userDefines) {
  // Optimization: reuse known globals if there are no user-specified defines
  const hasUserDefines = userDefines.length !== 0;
  if (!hasUserDefines && processedGlobals !== null) return processedGlobals;

  const result = new ProcessedDefines();

  // Mark these property accesses as free of side effects.
  for (const parts of KNOWN_GLOBALS) {
    const tail = parts[parts.length - 1];
    if (parts.length === 1) {
      result.identifierDefines.set(tail, new DefineData(null, null, CanBeRemovedIfUnused));
    } else {
      let flags = CanBeRemovedIfUnused;
      // All properties on the "Symbol" global are currently symbol instances
      if (parts[0] === "Symbol") flags |= IsSymbolInstance;
      let list = result.dotDefines.get(tail);
      if (list === undefined) result.dotDefines.set(tail, (list = []));
      list.push(new DefineData(parts, null, flags));
    }
  }

  // Swap in certain literal values because those can be constant folded
  result.identifierDefines.set("undefined", new DefineData(null, new DefineExpr(EUndefinedShared)));
  result.identifierDefines.set("NaN", new DefineData(null, new DefineExpr(new ENumber(NaN))));
  result.identifierDefines.set("Infinity", new DefineData(null, new DefineExpr(new ENumber(Infinity))));

  // Then copy the user-specified defines in afterwards, which will overwrite
  // any known globals above.
  for (const data of userDefines) {
    // Identifier defines are special-cased
    if (data.keyParts.length === 1) {
      const name = data.keyParts[0];
      result.identifierDefines.set(name, mergeDefineData(result.identifierDefines.get(name) ?? new DefineData(), data));
      continue;
    }

    const tail = data.keyParts[data.keyParts.length - 1];
    let dotDefines = result.dotDefines.get(tail);
    dotDefines = dotDefines === undefined ? [] : dotDefines.slice();
    let found = false;

    // Try to merge with existing dot defines first
    for (let i = 0; i < dotDefines.length; i++) {
      if (stringArraysEqual(data.keyParts, dotDefines[i].keyParts)) {
        dotDefines[i] = mergeDefineData(dotDefines[i], data);
        found = true;
        break;
      }
    }

    if (!found) dotDefines.push(data);
    result.dotDefines.set(tail, dotDefines);
  }

  // Potentially cache the result for next time
  if (!hasUserDefines && processedGlobals === null) processedGlobals = result;
  return result;
}

// config.PrettyPrintTargetEnvironment (the mask is a compat.JSFeature)
export function prettyPrintTargetEnvironment(originalTargetEnv: string, unsupportedJSFeatureOverridesMask: { lo: number; hi: number }): string {
  let where = "the configured target environment";
  let overrides = "";
  const popcount = (x: number) => {
    let n = 0;
    for (x >>>= 0; x !== 0; x >>>= 1) n += x & 1;
    return n;
  };
  const count = popcount(unsupportedJSFeatureOverridesMask.lo) + popcount(unsupportedJSFeatureOverridesMask.hi);
  if (count !== 0) overrides = " + " + count + " override" + (count === 1 ? "" : "s");
  if (originalTargetEnv !== "") where = where + " (" + originalTargetEnv + overrides + ")";
  return where;
}
