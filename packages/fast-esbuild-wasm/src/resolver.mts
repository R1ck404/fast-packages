// Port of internal/resolver/resolver.go (plus helpers/glob.go, which
// ResolveGlob uses). The methods defined in package_json.go live in
// package_json.mjs and are installed onto the Resolver class below.
//
// The resolver is synchronous (Go's mutex is a no-op here). Go's
// "resolverQuery" (a Resolver plus the per-query "debugMeta", "debugLogs" and
// "kind") is the Resolver itself: the public entry points (resolve,
// resolveGlob, probeResolvePackageAsRelative) set the per-query fields, and
// nothing reenters them.
//
// Debug logs (r.debugLogs) are built like Go builds them: when the log
// level is Debug or lower, every query collects notes that are logged as a
// Debug message (failure) or a Verbose message (success).
//
// Yarn PnP: see yarnpnp.mjs (whose methods are installed below).
//
// Multiple return values are arrays. Failures return shared frozen arrays
// (JS-only; never mutate a returned array).
import { API, CLIAPI, JSAPI, GoAPI } from "./logger.mjs";
import { goQuote } from "./gostd.mjs";
import {
  installYarnPnPMethods,
  compileYarnPnPData,
  pnpData,
  pnpResult,
  pnpErrorGeneric,
  pnpErrorDependencyNotFound,
  pnpErrorUnfulfilledPeerDependency,
  pnpSuccess,
  pnpStatusIsError,
  pnpIgnoreErrorsAboutMissingFiles,
  pnpReportErrorsAboutMissingFiles,
} from "./yarnpnp.mjs";
import {
  Path,
  PrettyPaths,
  Source,
  Range,
  LineColumnTracker,
  Error as MsgError,
  Warning,
  Debug,
  PathDisabled,
  MsgID_TSConfigJSON_Cycle,
  MsgID_TSConfigJSON_Missing,
  MsgID_Bundler_EmptyGlob,
  goStringLess,
  Msg,
  MsgData,
  Verbose,
  MsgID_None,
  LevelDebug,
  LevelVerbose,
} from "./logger.mjs";
import { importKindStringForMetafile } from "./ast.mjs";
import {
  ImportEntryPoint,
  ImportStmt,
  ImportRequire,
  ImportDynamic,
  ImportRequireResolve,
  ImportURL,
  importKindIsFromCSS,
  importKindMustResolveToCSS,
} from "./ast.mjs";
import {
  BuildCall,
  PlatformBrowser,
  PlatformNode,
  LoaderNone,
  LoaderJS,
  LoaderJSX,
  loaderIsCSS,
  loaderIsTypeScript,
  loaderFromFileExtension,
  formatKeepESMImportExportSyntax,
  TSConfig,
  TSOptions,
  PlatformNeutral,
} from "./config.mjs";
import type { Options, ExternalMatchers } from "./config.mjs";
import { jsFeatureHas, NodeColonPrefixImport, NodeColonPrefixRequire } from "./compat.mjs";
import {
  isInsideNodeModules,
  quoteForJSON,
} from "./helpers.mjs";
import { ModuleTypeData } from "./js_ast.mjs";
import {
  ENOENT,
  ENOTDIR,
  EACCES,
  EPERM,
  DirEntry,
  FileEntry,
  DifferentCase,
  makeEmptyDirEntries,
  parseYarnPnPVirtualPath,
} from "./fs.mjs";
import type { FS, DirEntries } from "./fs.mjs";
import type { CacheSet } from "./cache.mjs";
import {
  TSConfigJSON,
  TSConfigJSX,
  parseTSConfigJSON,
  isValidTSConfigPathNoBaseURLPattern,
  getProperty as tsGetProperty,
  getString as tsGetString,
  getBool as tsGetBool,
} from "./tsconfig.mjs";
import { parseDataURL, MIMETypeUnsupported } from "./dataurl.mjs";
import {
  installPackageJSONMethods,
  esmParsePackageName,
  absolutePathKind,
  packagePathKind,
  pjStatusExact,
  pjStatusExactEndsWithStar,
  pjStatusInexact,
  pjStatusPackageResolve,
  pjStatusModuleNotFound,
  pjStatusModuleNotFoundMissingExtension,
  pjStatusUnsupportedDirectoryImport,
  pjStatusUnsupportedDirectoryImportMissingIndex,
  pjStatusPackagePathNotExported,
  pjStatusInvalidModuleSpecifier,
  pjStatusInvalidPackageConfiguration,
  pjStatusInvalidPackageTarget,
  pjStatusPackageImportNotDefined,
  pjStatusUndefinedNoConditionsMatch,
  goPathJoin,
} from "./package_json.mjs";
import type { packageJSON, pjMap, pjDebug } from "./package_json.mjs";

// resolver.go's getProperty/getString/getBool (shared with tsconfig.mjs)
export const getProperty = tsGetProperty;
export const getString = tsGetString;
export const getBool = tsGetBool;

// Indexed by config.Platform (PlatformBrowser, PlatformNode, PlatformNeutral)
export const defaultMainFields: string[][] = [
  // Note that this means if a package specifies "main", "module", and
  // "browser" then "browser" will win out over "module". This is the
  // same behavior as webpack: https://github.com/webpack/webpack/issues/4674.
  //
  // This is deliberate because the presence of the "browser" field is a
  // good signal that the "module" field may have non-browser stuff in it,
  // which will crash or fail to be bundled when targeting the browser.
  ["browser", "module", "main"],

  // Note that this means if a package specifies "module" and "main", the ES6
  // module will not be selected. This means tree shaking will not work when
  // targeting node environments.
  //
  // This is unfortunately necessary for compatibility. Some packages
  // incorrectly treat the "module" field as "code for the browser". It
  // actually means "code for ES6 environments" which includes both node
  // and the browser.
  //
  // If you want to enable tree shaking when targeting node, you will have to
  // configure the main fields to be "module" and then "main". Keep in mind
  // that some packages may break if you do this.
  ["main", "module"],

  // The neutral platform is for people that don't want esbuild to try to
  // pick good defaults for their platform. In that case, the list of main
  // fields is empty by default. You must explicitly configure it yourself.
  [],
];

// These are the main fields to use when the "main fields" setting is configured
// to something unusual, such as something without the "main" field.
export const mainFieldsForFailure = ["main", "module"];

// js_ast.ModuleTypeData{} (shared, never mutated)
export const NO_MODULE_TYPE_DATA = Object.freeze(new ModuleTypeData()) as ModuleTypeData;

// config.TSConfigJSX{} (shared, never mutated)
export const EMPTY_TSCONFIG_JSX = Object.freeze(new TSConfigJSX()) as TSConfigJSX;

// Path resolution is a mess. One tricky issue is the "module" override for the
// "main" field in "package.json" files. Bundlers generally prefer "module" over
// "main" but that breaks packages that export a function in "main" for use with
// "require()", since resolving to "module" means an object will be returned. We
// attempt to handle this automatically by having import statements resolve to
// "module" but switch that out later for "main" if "require()" is used too.
export class PathPair {
  // Either secondary will be empty, or primary will be "module" and secondary
  // will be "main"
  declare primary: Path;
  declare secondary: Path;
  declare isExternal: boolean;
  constructor(primary: Path = new Path(), secondary: Path = new Path(), isExternal = false) {
    this.primary = primary;
    this.secondary = secondary;
    this.isExternal = isExternal;
  }

  iter(): Path[] {
    if (!this.hasSecondary()) return [this.primary];
    return [this.primary, this.secondary];
  }

  hasSecondary(): boolean {
    return this.secondary.text !== "";
  }
}

export class SideEffectsData {
  declare source: Source | null;

  // If non-empty, this false value came from a plugin
  declare pluginName: string;

  declare range: Range;

  // If true, "sideEffects" was an array. If false, "sideEffects" was false.
  declare isSideEffectsArrayInJSON: boolean;

  constructor(source: Source | null = null, pluginName = "", range = new Range(0, 0), isSideEffectsArrayInJSON = false) {
    this.source = source;
    this.pluginName = pluginName;
    this.range = range;
    this.isSideEffectsArrayInJSON = isSideEffectsArrayInJSON;
  }
}

export class ResolveResult {
  declare pathPair: PathPair;

  // If this was resolved by a plugin, the plugin gets to store its data here
  declare pluginData: any;

  declare differentCase: DifferentCase | null;

  // If present, any ES6 imports to this file can be considered to have no side
  // effects. This means they should be removed if unused.
  declare primarySideEffectsData: SideEffectsData | null;

  // These are from "tsconfig.json". JS-only: "tsConfigJSX" is shared with the
  // parsed "tsconfig.json" (Go copies the struct); never mutate it.
  declare tsConfigJSX: TSConfigJSX;
  declare tsConfig: TSConfig | null;
  declare tsAlwaysStrict: any;

  // This is the "type" field from "package.json" (shared, never mutate it)
  declare moduleTypeData: ModuleTypeData;

  constructor(pathPair: PathPair, differentCase: DifferentCase | null = null, primarySideEffectsData: SideEffectsData | null = null) {
    this.pathPair = pathPair;
    this.pluginData = null;
    this.differentCase = differentCase;
    this.primarySideEffectsData = primarySideEffectsData;
    this.tsConfigJSX = EMPTY_TSCONFIG_JSX;
    this.tsConfig = null;
    this.tsAlwaysStrict = null;
    this.moduleTypeData = NO_MODULE_TYPE_DATA;
  }
}

// suggestionRange
export const suggestionRangeFull = 0;
export const suggestionRangeEnd = 1;

export class DebugLogs {
  declare what: string;
  declare indent: string;
  declare notes: MsgData[];
  constructor(what: string) {
    this.what = what;
    this.indent = "";
    this.notes = [];
  }

  addNote(text: string) {
    if (this.indent !== "") {
      text = this.indent + text;
    }
    this.notes.push(new MsgData(null, null, text, true));
  }

  increaseIndent() {
    this.indent += "  ";
  }

  decreaseIndent() {
    this.indent = this.indent.slice(2);
  }
}

// flushMode
const flushDueToFailure = 0;
const flushDueToSuccess = 1;

export class DebugMeta {
  declare notes: any[] | null;
  declare suggestionText: string;
  declare suggestionMessage: string;
  declare suggestionRange: number;
  declare modifiedImportPath: string;
  constructor() {
    this.notes = null;
    this.suggestionText = "";
    this.suggestionMessage = "";
    this.suggestionRange = suggestionRangeFull;
    this.modifiedImportPath = "";
  }

  logErrorMsg(log: any, source: Source | null, r: Range, text: string, suggestion: string, notes: any[] | null) {
    const tracker = new LineColumnTracker(source);
    let dmNotes = this.notes;

    if (source !== null && this.suggestionMessage !== "") {
      let suggestionRange = r;
      if (this.suggestionRange === suggestionRangeEnd) {
        suggestionRange = new Range(r.loc + r.len - 1, 0);
      }
      const data = tracker.msgData(suggestionRange, this.suggestionMessage);
      data.location.suggestion = this.suggestionText;
      dmNotes = dmNotes === null ? [data] : [...dmNotes, data];
    }

    const allNotes = dmNotes === null ? notes : notes === null ? dmNotes : [...dmNotes, ...notes];
    const msg = new Msg(allNotes, "", tracker.msgData(r, text), MsgError);

    if (msg.data.location !== null && suggestion !== "") {
      msg.data.location.suggestion = suggestion;
    }

    log.addMsg(msg);
  }
}

// ---------------------------------------------------------------------------

class dirInfo {
  // These objects are immutable, so we can just point to the parent directory
  // and avoid having to lock the cache again
  declare parent: dirInfo | null;

  // A pointer to the enclosing dirInfo with a valid "browser" field in
  // package.json. We need this to remap paths after they have been resolved.
  declare enclosingBrowserScope: dirInfo | null;

  // All relevant information about this directory
  declare absPath: string;
  declare pnpManifestAbsPath: string;
  declare entries: DirEntries;
  declare packageJSON: packageJSON | null; // Is there a "package.json" file in this directory?
  declare enclosingPackageJSON: packageJSON | null; // Is there a "package.json" file in this directory or a parent directory?
  declare enclosingTSConfigJSON: TSConfigJSON | null; // Is there a "tsconfig.json" file in this directory or a parent directory?
  declare absRealPath: string; // If non-empty, this is the real absolute path resolving any symlinks
  declare isNodeModules: boolean; // Is the base name "node_modules"?
  declare hasNodeModules: boolean; // Is there a "node_modules" subdirectory?
  declare isInsideNodeModules: boolean; // Is this within a  "node_modules" subtree?
  constructor(absPath: string, parent: dirInfo | null, entries: DirEntries) {
    this.parent = parent;
    this.enclosingBrowserScope = null;
    this.absPath = absPath;
    this.pnpManifestAbsPath = "";
    this.entries = entries;
    this.packageJSON = null;
    this.enclosingPackageJSON = null;
    this.enclosingTSConfigJSON = null;
    this.absRealPath = "";
    this.isNodeModules = false;
    this.hasNodeModules = false;
    this.isInsideNodeModules = false;
  }
}

// Errors of parseTSConfig (Go: errors.New)
const errParseErrorImportCycle = { error: () => "(import cycle)" };
const errParseErrorAlreadyLogged = { error: () => "(error already logged)" };

// finalizeImportsExportsKind
const finalizeImportsExportsNormal = 0;
const finalizeImportsExportsYarnPnPTSConfigExtends = 1;

// TypeScript-specific behavior: if the extension is ".js" or ".jsx", try
// replacing it with ".ts" or ".tsx". At the time of writing this specific
// behavior comes from the function "loadModuleFromFile()" in the file
// "moduleNameResolver.ts" in the TypeScript compiler source code.
//
// We don't care about ".d.ts" files because we can't do anything with
// those, so we ignore that part of the behavior.
//
// (Go iterates over a map; at most one of these suffixes can match)
function rewrittenFileExtensions(base: string): string[] | null {
  // Note that the official compiler code always tries ".ts" before
  // ".tsx" even if the original extension was ".jsx".
  if (base.endsWith(".js") || base.endsWith(".jsx")) return REWRITE_JS;
  if (base.endsWith(".mjs")) return REWRITE_MJS;
  if (base.endsWith(".cjs")) return REWRITE_CJS;
  return null;
}
const REWRITE_JS = [".ts", ".tsx"];
const REWRITE_MJS = [".mts"];
const REWRITE_CJS = [".cts"];

// Shared failure results
const EMPTY_PATH_PAIR = Object.freeze(new PathPair(Object.freeze(new Path()) as Path, Object.freeze(new Path()) as Path)) as PathPair;
type PairResult = [PathPair, boolean, DifferentCase | null];
type PairResult4 = [PathPair, boolean, DifferentCase | null, SideEffectsData | null];
const FAIL3: PairResult = Object.freeze([EMPTY_PATH_PAIR, false, null]) as any;
const FAIL4: PairResult4 = Object.freeze([EMPTY_PATH_PAIR, false, null, null]) as any;
const FILE_FAIL: [string, boolean, DifferentCase | null] = Object.freeze(["", false, null]) as any;
const NOT_BUILT_IN: [PathPair, boolean, SideEffectsData | null] = Object.freeze([EMPTY_PATH_PAIR, false, null]) as any;
const KEEP_SEARCHING: [PathPair, boolean, DifferentCase | null, SideEffectsData | null, boolean] = Object.freeze([EMPTY_PATH_PAIR, false, null, null, false]) as any;

function pairResult(primary: Path, diffCase: DifferentCase | null): PairResult {
  return [new PathPair(primary), true, diffCase];
}

// Go's strings.IndexAny(s, "?#")
function indexOfQueryOrHash(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 63 || c === 35) return i;
  }
  return -1;
}

function hasCaseInsensitiveSuffix(s: string, suffix: string): boolean {
  // (the suffix is ASCII: only ASCII characters and U+212A/U+017F can match)
  if (s.length < suffix.length) return false;
  const tail = s.slice(s.length - suffix.length);
  for (let i = 0; i < tail.length; i++) {
    if (tail.charCodeAt(i) >= 0x80) return hasCaseInsensitiveSuffixSlow(s, suffix);
  }
  return tail.toLowerCase() === suffix.toLowerCase();
}

// (Go compares the last len(suffix) bytes; a non-ASCII rune there is
// multi-byte, so only U+212A KELVIN SIGN or U+017F LATIN SMALL LETTER LONG S
// (both fold to ASCII letters) could still match, and only if the bytes line
// up, which they never do for the ASCII suffix ".d.ts")
function hasCaseInsensitiveSuffixSlow(s: string, suffix: string): boolean {
  return false;
}

export class Resolver {
  declare fs: FS;
  declare log: any;
  declare caches: CacheSet;

  declare tsConfigOverride: TSConfigJSON | null;

  // These are sets that represent various conditions for the "exports" field
  // in package.json.
  declare esmConditionsDefault: Set<string>;
  declare esmConditionsImport: Set<string>;
  declare esmConditionsRequire: Set<string>;

  // A special filtered import order for CSS "@import" imports.
  //
  // The "resolve extensions" setting determines the order of implicit
  // extensions to try when resolving imports with the extension omitted.
  // What we currently do is to create a special filtered version of the
  // configured "resolve extensions" order for CSS files that filters out any
  // extension that has been explicitly configured with a non-CSS loader.
  declare cssExtensionOrder: string[];

  // A special sorted import order for imports inside packages.
  //
  // We sort TypeScript file extensions after JavaScript file extensions (but
  // only within packages) so that esbuild doesn't load the original source
  // code in these scenarios. Instead we should load the compiled code, which
  // is what will be loaded by node at run-time.
  declare nodeModulesExtensionOrder: string[];

  // This cache maps a directory path to information about that directory and
  // all parent directories
  declare dirCache: Map<string, dirInfo | null>;

  declare pnpManifestWasChecked: boolean;
  declare pnpManifest: pnpData | null;

  declare options: Options;

  // resolverQuery
  declare debugMeta: DebugMeta;
  declare debugLogs: DebugLogs | null;
  declare kind: number;

  constructor(fs: FS, log: any, options: Options, caches: CacheSet) {
    this.fs = fs;
    this.log = log;
    this.caches = caches;
    this.tsConfigOverride = null;
    this.esmConditionsDefault = new Set();
    this.esmConditionsImport = new Set();
    this.esmConditionsRequire = new Set();
    this.cssExtensionOrder = [];
    this.nodeModulesExtensionOrder = [];
    this.dirCache = new Map();
    this.pnpManifestWasChecked = false;
    this.pnpManifest = null;
    this.options = options;
    this.debugMeta = new DebugMeta();
    this.debugLogs = null;
    this.kind = ImportEntryPoint;
  }

  // (the methods of yarnpnp.go, installed below)
  declare resolveToUnqualified: (specifier: string, parentURL: string, manifest: pnpData) => pnpResult;
  declare extractYarnPnPDataFromJSON: (pnpDataPath: string, mode: number) => [any, Source];
  declare tryToExtractYarnPnPDataFromJS: (pnpDataPath: string, mode: number) => [any, Source];

  // (the methods of package_json.go, installed below)
  declare checkBrowserMap: (resolveDirInfo: dirInfo, inputPath: string, kind: number) => string | null | undefined;
  declare parsePackageJSON: (inputPath: string) => packageJSON | null;
  declare esmHandlePostConditions: (resolved: string, status: number, debug: pjDebug) => [string, number, pjDebug];
  declare esmPackageImportsResolve: (specifier: string, imports: any, conditions: Set<string>) => [string, number, pjDebug];
  declare esmPackageExportsResolve: (packageURL: string, subpath: string, exports: any, conditions: Set<string>) => [string, number, pjDebug];
  declare esmPackageExportsReverseResolve: (query: string, root: any, conditions: Set<string>) => [boolean, string, Range];

  // Returns [result, debugMeta]
  resolve(sourceDir: string, importPath: string, kind: number): [ResolveResult | null, DebugMeta] {

    const debugMeta = new DebugMeta();
    const r = this;
    r.debugMeta = debugMeta;
    r.kind = kind;
    r.debugLogs = null;
    if (r.log.level <= LevelDebug) {
      r.debugLogs = new DebugLogs(
        "Resolving import " + goQuote(importPath) + " in directory " + goQuote(sourceDir) + " of type " + goQuote(importKindStringForMetafile(kind)),
      );
    }

    // Apply package alias substitutions first
    if (r.options.packageAliases !== null && isPackagePath(importPath)) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Checking for package alias matches");
      }
      let longestKey = "";
      let longestValue = "";

      for (const [key, value] of r.options.packageAliases) {
        if (
          key.length > longestKey.length &&
          importPath.startsWith(key) &&
          (importPath.length === key.length || importPath.charCodeAt(key.length) === 47)
        ) {
          longestKey = key;
          longestValue = value;
        }
      }

      if (longestKey !== "") {
        debugMeta.modifiedImportPath = longestValue;
        const tail = importPath.slice(longestKey.length);
        if (tail !== "/") {
          // Don't include the trailing characters if they are equal to a
          // single slash. This comes up because you can abuse this quirk of
          // node's path resolution to force node to load the package from the
          // file system instead of as a built-in module. For example, "util"
          // is node's built-in module while "util/" is one on the file system.
          // Leaving the trailing slash in place causes problems for people:
          // https://github.com/evanw/esbuild/issues/2730. It should be ok to
          // always strip the trailing slash even when using the alias feature
          // to swap one package for another (except when you swap a reference
          // to one built-in node module with another but really why would you
          // do that).
          debugMeta.modifiedImportPath += tail;
        }
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("  Matched with alias from " + goQuote(longestKey) + " to " + goQuote(longestValue));
          r.debugLogs.addNote("  Modified import path from " + goQuote(importPath) + " to " + goQuote(debugMeta.modifiedImportPath));
        }
        importPath = debugMeta.modifiedImportPath;

        // Resolve the package using the current path instead of the original
        // path. This is trying to resolve the substitute in the top-level
        // package instead of the nested package, which lets the top-level
        // package control the version of the substitution. It's also critical
        // when using Yarn PnP because Yarn PnP doesn't allow nested packages
        // to "reach outside" of their normal dependency lists.
        sourceDir = r.fs.cwd();
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("  Changed resolve directory to " + goQuote(sourceDir));
        }
      } else if (r.debugLogs !== null) {
        r.debugLogs.addNote("  Failed to find any package alias matches");
      }
    }

    // Certain types of URLs default to being external for convenience
    const isExplicitlyExternal = r.isExternal(r.options.externalSettings.preResolve, importPath, kind);
    if (
      isExplicitlyExternal ||
      // "fill: url(#filter);"
      (kind === ImportURL && importPath.startsWith("#")) ||
      // "background: url(http://example.com/images/image.png);"
      importPath.startsWith("http://") ||
      // "background: url(https://example.com/images/image.png);"
      importPath.startsWith("https://") ||
      // "background: url(//example.com/images/image.png);"
      importPath.startsWith("//")
    ) {
      if (r.debugLogs !== null) {
        if (isExplicitlyExternal) {
          r.debugLogs.addNote("The path " + goQuote(importPath) + " was marked as external by the user");
        } else {
          r.debugLogs.addNote("Marking this path as implicitly external");
        }
      }

      r.flushDebugLogs(flushDueToSuccess);
      return [new ResolveResult(new PathPair(new Path(importPath), new Path(), true)), debugMeta];
    }

    {
      const b = r.checkForBuiltInNodeModules(importPath);
      if (b[1]) {
        r.flushDebugLogs(flushDueToSuccess);
        return [new ResolveResult(b[0], null, b[2]), debugMeta];
      }
    }

    {
      const d = parseDataURL(importPath);
      if (d[1]) {
        // "import 'data:text/javascript,console.log(123)';"
        // "@import 'data:text/css,body{background:white}';"
        if (d[0].decodeMIMEType() !== MIMETypeUnsupported) {
          if (r.debugLogs !== null) {
            r.debugLogs.addNote('Putting this path in the "dataurl" namespace');
          }
          r.flushDebugLogs(flushDueToSuccess);
          return [new ResolveResult(new PathPair(new Path(importPath, "dataurl"))), debugMeta];
        }

        // "background: url(data:image/png;base64,iVBORw0KGgo=);"
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("Marking this data URL as external");
        }
        r.flushDebugLogs(flushDueToSuccess);
        return [new ResolveResult(new PathPair(new Path(importPath), new Path(), true)), debugMeta];
      }
    }

    // Fail now if there is no directory to resolve in. This can happen for
    // virtual modules (e.g. stdin) if a resolve directory is not specified.
    if (sourceDir === "") {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Cannot resolve this path without a directory");
      }
      r.flushDebugLogs(flushDueToFailure);
      return [null, debugMeta];
    }

    // Glob imports only work in a multi-path context
    if (importPath.indexOf("*") !== -1) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Cannot resolve a path containing a wildcard character in a single-path context");
      }
      r.flushDebugLogs(flushDueToFailure);
      return [null, debugMeta];
    }

    // Check for the Yarn PnP manifest if it hasn't already been checked for
    if (!r.pnpManifestWasChecked) {
      r.pnpManifestWasChecked = true;

      // Use the current working directory to find the Yarn PnP manifest. We
      // can't necessarily use the entry point locations because the entry
      // point locations aren't necessarily file paths. For example, they could
      // be HTTP URLs that will be handled by a plugin.
      for (let info = r.dirInfoCached(r.fs.cwd()); info !== null; info = info.parent) {
        const absPath = info.pnpManifestAbsPath;
        if (absPath !== "") {
          if (absPath.endsWith(".json")) {
            const $j = r.extractYarnPnPDataFromJSON(absPath, pnpReportErrorsAboutMissingFiles);
            if ($j[0].data !== null) {
              r.pnpManifest = compileYarnPnPData(absPath, r.fs.dir(absPath), $j[0], $j[1]);
            }
          } else {
            const $j = r.tryToExtractYarnPnPDataFromJS(absPath, pnpReportErrorsAboutMissingFiles);
            if ($j[0].data !== null) {
              r.pnpManifest = compileYarnPnPData(absPath, r.fs.dir(absPath), $j[0], $j[1]);
            }
          }
          if (r.debugLogs !== null && r.pnpManifest !== null && r.pnpManifest.invalidIgnorePatternData !== "") {
            r.debugLogs.addNote('  Invalid Go regular expression for "ignorePatternData": ' + r.pnpManifest.invalidIgnorePatternData);
          }
          break;
        }
      }
    }

    const sourceDirInfo = r.dirInfoCached(sourceDir);
    if (sourceDirInfo === null) {
      // Bail if the directory is missing for some reason
      return [null, debugMeta];
    }

    let result = r.resolveWithoutSymlinks(sourceDir, sourceDirInfo, importPath);
    if (result === null) {
      // If resolution failed, try again with the URL query and/or hash removed
      const suffix = indexOfQueryOrHash(importPath);
      if (suffix < 1) {
        r.flushDebugLogs(flushDueToFailure);
        return [null, debugMeta];
      }
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Retrying resolution after removing the suffix " + goQuote(importPath.slice(suffix)));
      }
      const result2 = r.resolveWithoutSymlinks(sourceDir, sourceDirInfo, importPath.slice(0, suffix));
      if (result2 === null) {
        r.flushDebugLogs(flushDueToFailure);
        return [null, debugMeta];
      } else {
        result = result2;
        result.pathPair.primary.ignoredSuffix = importPath.slice(suffix);
        if (result.pathPair.hasSecondary()) {
          result.pathPair.secondary.ignoredSuffix = importPath.slice(suffix);
        }
      }
    }

    // If successful, resolve symlinks using the directory info cache
    r.finalizeResolve(result);
    r.flushDebugLogs(flushDueToSuccess);
    return [result, debugMeta];
  }

  // This returns null on failure and non-null on success. Note that this may
  // return an empty map to indicate a successful search that returned zero
  // results. Returns [results, warning] where the warning is a message object
  // ({id, kind, text}) the caller logs.
  // (Go returns a map; this map is in the order the files were found)
  resolveGlob(sourceDir: string, importPathPattern: GlobPart[], kind: number, prettyPattern: string): [Map<string, ResolveResult> | null, any] {
    const r = this;
    r.debugMeta = new DebugMeta();
    r.kind = kind;
    r.debugLogs = null;

    if (r.log.level <= LevelDebug) {
      r.debugLogs = new DebugLogs(
        "Resolving glob import " + prettyPattern + " in directory " + goQuote(sourceDir) + " of type " + goQuote(importKindStringForMetafile(kind)),
      );
    }

    if (importPathPattern.length === 0) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Ignoring empty glob pattern");
      }
      r.flushDebugLogs(flushDueToFailure);
      return [null, null];
    }
    let firstPrefix = importPathPattern[0].prefix;

    // Glob patterns only work for relative URLs
    if (!firstPrefix.startsWith("./") && !firstPrefix.startsWith("../") && !firstPrefix.startsWith(".\\") && !firstPrefix.startsWith("..\\")) {
      if (kind === ImportEntryPoint) {
        // Be permissive about forgetting "./" for entry points since it's common
        // to omit "./" on the command line. But don't accidentally treat absolute
        // paths as relative (even on Windows).
        if (!r.fs.isAbs(firstPrefix)) {
          firstPrefix = "./" + firstPrefix;
        }
      } else {
        // Don't allow omitting "./" for other imports since node doesn't let you do this either
        if (r.debugLogs !== null) {
          r.debugLogs.addNote(`Ignoring glob import that doesn't start with "./" or "../"`);
        }
        r.flushDebugLogs(flushDueToFailure);
        return [null, null];
      }
    }

    // Handle leading directories in the pattern (including "../")
    let dirPrefix = 0;
    for (;;) {
      let slash = -1;
      for (let i = dirPrefix; i < firstPrefix.length; i++) {
        const c = firstPrefix.charCodeAt(i);
        if (c === 47 || c === 92) {
          slash = i - dirPrefix;
          break;
        }
      }
      if (slash === -1) break;
      const starAt = firstPrefix.indexOf("*", dirPrefix);
      const star = starAt === -1 ? -1 : starAt - dirPrefix;
      if (star !== -1 && slash > star) break;
      dirPrefix += slash + 1;
    }

    // If the pattern is an absolute path, then just replace source directory.
    // Otherwise join the source directory with the prefix from the pattern.
    {
      const suffix = firstPrefix.slice(0, dirPrefix);
      if (r.fs.isAbs(suffix)) {
        sourceDir = suffix;
      } else {
        sourceDir = r.fs.join(sourceDir, suffix);
      }
    }

    // Look up the directory to start from
    const sourceDirInfo = r.dirInfoCached(sourceDir);
    if (sourceDirInfo === null) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Failed to find the directory " + goQuote(sourceDir));
      }
      r.flushDebugLogs(flushDueToFailure);
      return [null, null];
    }

    // Turn the glob pattern into a regular expression
    let canMatchOnSlash = false;
    let wasGlobStar = false;
    let sb = "^";
    for (let i = 0; i < importPathPattern.length; i++) {
      const part = importPathPattern[i];
      let prefix = part.prefix;
      if (i === 0) {
        prefix = firstPrefix;
      }
      if (wasGlobStar && prefix.length > 0 && (prefix.charCodeAt(0) === 47 || prefix.charCodeAt(0) === 92)) {
        prefix = prefix.slice(1); // Move over the "/" after a globstar
      }
      sb += regexpQuoteMeta(prefix);
      switch (part.wildcard) {
        case GlobAllIncludingSlash:
          // It's a globstar, so match zero or more path segments
          sb += "(?:[^/]*(?:/|$))*";
          canMatchOnSlash = true;
          wasGlobStar = true;
          break;
        case GlobAllExceptSlash:
          // It's not a globstar, so only match one path segment
          sb += "[^/]*";
          wasGlobStar = false;
          break;
      }
    }
    sb += "$";
    const re = new RegExp(sb, "u");

    // Initialize "results" to a non-null value to indicate that the glob is valid
    const results = new Map<string, ResolveResult>();

    const visit = (info: dirInfo, dir: string) => {
      const keys = info.entries.sortedKeys() as string[];
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        const entry = info.entries.get(key)[0] as any;
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("Considering entry " + goQuote(r.fs.join(info.absPath, key)));
          r.debugLogs.increaseIndent();
        }

        switch (entry.kind(r.fs)) {
          case DirEntry:
            // To avoid infinite loops, don't follow any symlinks
            if (canMatchOnSlash && entry.symlink(r.fs) === "") {
              const childDirInfo = r.dirInfoCached(r.fs.join(info.absPath, key));
              if (childDirInfo !== null) {
                visit(childDirInfo, dir + key + "/");
              }
            }
            break;

          case FileEntry: {
            const relPath = dir + key;
            if (re.test(relPath)) {
              let result: ResolveResult;

              if (r.isExternal(r.options.externalSettings.preResolve, relPath, kind)) {
                result = new ResolveResult(new PathPair(new Path(relPath), new Path(), true));

                if (r.debugLogs !== null) {
                  r.debugLogs.addNote("The path " + goQuote(result.pathPair.primary.text) + " was marked as external by the user");
                }
              } else {
                const absPath = r.fs.join(info.absPath, key);
                result = new ResolveResult(new PathPair(new Path(absPath, "file")));
              }

              r.finalizeResolve(result);
              results.set(relPath, result);
            }
            break;
          }
        }

        if (r.debugLogs !== null) {
          r.debugLogs.decreaseIndent();
        }
      }
    };

    visit(sourceDirInfo, firstPrefix.slice(0, dirPrefix));

    let warning: any = null;
    if (results.size === 0) {
      warning = { id: MsgID_Bundler_EmptyGlob, kind: Warning, text: `The glob pattern ${prettyPattern} did not match any files` };
    }

    r.flushDebugLogs(flushDueToSuccess);
    return [results, warning];
  }

  isExternal(matchers: ExternalMatchers, path: string, kind: number): boolean {
    if (kind === ImportEntryPoint) {
      // Never mark an entry point as external. This is not useful.
      return false;
    }
    if (matchers.exact.has(path)) {
      return true;
    }
    const patterns = matchers.patterns;
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      if (this.debugLogs !== null) {
        this.debugLogs.addNote("Checking " + goQuote(path) + " against the external pattern " + goQuote(pattern.prefix + "*" + pattern.suffix));
      }
      if (path.length >= pattern.prefix.length + pattern.suffix.length && path.startsWith(pattern.prefix) && path.endsWith(pattern.suffix)) {
        return true;
      }
    }
    return false;
  }

  // This tries to run "Resolve" on a package path as a relative path. If
  // successful, the user just forgot a leading "./" in front of the path.
  probeResolvePackageAsRelative(sourceDir: string, importPath: string, kind: number): [ResolveResult | null, DebugMeta] {
    const debugMeta = new DebugMeta();
    const r = this;
    r.debugMeta = debugMeta;
    r.kind = kind;
    r.debugLogs = null;
    const absPath = r.fs.join(sourceDir, importPath);

    const l = r.loadAsFileOrDirectory(absPath);
    if (l[1]) {
      const result = new ResolveResult(l[0], l[2]);
      r.finalizeResolve(result);
      r.flushDebugLogs(flushDueToSuccess);
      return [result, debugMeta];
    }

    return [null, debugMeta];
  }

  finalizeResolve(result: ResolveResult) {
    const r = this;
    if (!result.pathPair.isExternal && r.isExternal(r.options.externalSettings.postResolve, result.pathPair.primary.text, r.kind)) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("The path " + goQuote(result.pathPair.primary.text) + " was marked as external by the user");
      }
      result.pathPair.isExternal = true;
    } else {
      const count = result.pathPair.hasSecondary() ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const path = i === 0 ? result.pathPair.primary : result.pathPair.secondary;
        if (path.namespace !== "file") {
          continue;
        }
        let info = r.dirInfoCached(r.fs.dir(path.text));
        if (info === null) {
          continue;
        }
        let base = r.fs.base(path.text);

        // If the path contains symlinks, rewrite the path to the real path
        if (!r.options.preserveSymlinks) {
          const entry = info.entries.get(base)[0];
          if (entry !== null) {
            let symlink = entry.symlink(r.fs);
            if (symlink !== "") {
              // This means the entry itself is a symlink
            } else if (info.absRealPath !== "") {
              // There is at least one parent directory with a symlink
              symlink = r.fs.join(info.absRealPath, base);
            }
            if (symlink !== "") {
              if (r.debugLogs !== null) {
                r.debugLogs.addNote("Resolved symlink " + goQuote(path.text) + " to " + goQuote(symlink));
              }
              path.text = symlink;

              // Look up the directory over again if it was changed
              info = r.dirInfoCached(r.fs.dir(path.text));
              if (info === null) {
                continue;
              }
              base = r.fs.base(path.text);
            }
          }
        }

        // Path attributes are only taken from the primary path
        if (i > 0) {
          continue;
        }

        // Path attributes are not taken from disabled files
        if (path.isDisabled()) {
          continue;
        }

        // Look up this file in the "sideEffects" map in the nearest enclosing
        // directory with a "package.json" file.
        //
        // Only do this for the primary path. Some packages have the primary
        // path marked as having side effects and the secondary path marked
        // as not having side effects. This is likely a bug in the package
        // definition but we don't want to consider the primary path as not
        // having side effects just because the secondary path is marked as
        // not having side effects.
        const pkgJSON = info.enclosingPackageJSON;
        if (pkgJSON !== null) {
          if (pkgJSON.sideEffectsMap !== null) {
            let hasSideEffects = false;
            const pathLookup = path.text.replaceAll("\\", "/"); // Avoid problems with Windows-style slashes
            if (pkgJSON.sideEffectsMap.has(pathLookup)) {
              // Fast path: map lookup
              hasSideEffects = true;
            } else if (pkgJSON.sideEffectsRegexps !== null) {
              // Slow path: glob tests
              const regexps = pkgJSON.sideEffectsRegexps;
              for (let j = 0; j < regexps.length; j++) {
                if (regexps[j].test(pathLookup)) {
                  hasSideEffects = true;
                  break;
                }
              }
            }
            if (!hasSideEffects) {
              if (r.debugLogs !== null) {
                r.debugLogs.addNote("Marking this file as having no side effects due to " + goQuote(pkgJSON.source.keyPath.text));
              }
              result.primarySideEffectsData = pkgJSON.sideEffectsData;
            }
          }

          // Also copy over the "type" field
          result.moduleTypeData = pkgJSON.moduleTypeData;
        }

        // Copy various fields from the nearest enclosing "tsconfig.json" file if present
        const tsConfigJSON = r.tsConfigForDir(info);
        if (tsConfigJSON !== null) {
          result.tsConfig = tsConfigJSON.settings;
          result.tsConfigJSX = tsConfigJSON.jsxSettings;
          result.tsAlwaysStrict = tsConfigJSON.tsAlwaysStrictOrStrict();

          if (r.debugLogs !== null) {
            r.debugLogs.addNote("This import is under the effect of " + goQuote(tsConfigJSON.absPath));
            if (result.tsConfigJSX.jsxFactory !== null) {
              r.debugLogs.addNote('"jsxFactory" is ' + goQuote(result.tsConfigJSX.jsxFactory.join(".")) + " due to " + goQuote(tsConfigJSON.absPath));
            }
            if (result.tsConfigJSX.jsxFragmentFactory !== null) {
              r.debugLogs.addNote('"jsxFragment" is ' + goQuote(result.tsConfigJSX.jsxFragmentFactory.join(".")) + " due to " + goQuote(tsConfigJSON.absPath));
            }
          }
        }
      }
    }

    if (r.debugLogs !== null) {
      r.debugLogs.addNote("Primary path is " + goQuote(result.pathPair.primary.text) + " in namespace " + goQuote(result.pathPair.primary.namespace));
      if (result.pathPair.hasSecondary()) {
        r.debugLogs.addNote("Secondary path is " + goQuote(result.pathPair.secondary.text) + " in namespace " + goQuote(result.pathPair.secondary.namespace));
      }
    }
  }

  flushDebugLogs(mode: number) {
    const r = this;
    if (r.debugLogs !== null) {
      if (mode === flushDueToFailure) {
        r.log.addIDWithNotes(MsgID_None, Debug, null, new Range(0, 0), r.debugLogs.what, r.debugLogs.notes);
      } else if (r.log.level <= LevelVerbose) {
        r.log.addIDWithNotes(MsgID_None, Verbose, null, new Range(0, 0), r.debugLogs.what, r.debugLogs.notes);
      }
    }
  }

  resolveWithoutSymlinks(sourceDir: string, sourceDirInfo: dirInfo, importPath: string): ResolveResult | null {
    const r = this;

    // This implements the module resolution algorithm from node.js, which is
    // described here: https://nodejs.org/api/modules.html#modules_all_together
    let result: ResolveResult | null = null;

    // Return early if this is already an absolute path. In addition to asking
    // the file system whether this is an absolute path, we also explicitly check
    // whether it starts with a "/" and consider that an absolute path too. This
    // is because relative paths can technically start with a "/" on Windows
    // because it's not an absolute path on Windows. Then people might write code
    // with imports that start with a "/" that works fine on Windows only to
    // experience unexpected build failures later on other operating systems.
    // Treating these paths as absolute paths on all platforms means Windows
    // users will not be able to accidentally make use of these paths.
    if (importPath.startsWith("/") || r.fs.isAbs(importPath)) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("The import " + goQuote(importPath) + " is being treated as an absolute path");
      }

      // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file
      const tsConfigJSON = r.tsConfigForDir(sourceDirInfo);
      if (tsConfigJSON !== null && tsConfigJSON.paths !== null) {
        const m = r.matchTSConfigPaths(tsConfigJSON, importPath);
        if (m[1]) {
          return new ResolveResult(m[0], m[2]);
        }
      }

      // Run node's resolution rules (e.g. adding ".js")
      const l = r.loadAsFileOrDirectory(importPath);
      if (l[1]) {
        return new ResolveResult(l[0], l[2]);
      } else {
        return null;
      }
    }

    // Check both relative and package paths for CSS URL tokens, with relative
    // paths taking precedence over package paths to match Webpack behavior.
    const isPackage = isPackagePath(importPath);
    let checkRelative = !isPackage || importKindIsFromCSS(r.kind);
    let checkPackage = isPackage;

    if (checkRelative) {
      const absPath = r.fs.join(sourceDir, importPath);

      // Check for external packages first
      if (r.isExternal(r.options.externalSettings.postResolve, absPath, r.kind)) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("The path " + goQuote(absPath) + " was marked as external by the user");
        }
        return new ResolveResult(new PathPair(new Path(absPath, "file"), new Path(), true));
      }

      // Node's actual behavior deviates from its published algorithm by not
      // running the "LOAD_AS_FILE" step if the import path looks like it
      // resolves to a directory instead of a file. Attempt to replicate that
      // behavior here. This really only matters for intentionally confusing
      // edge cases where a directory is named the same thing as a file.
      // Unfortunately people actually create situations like this.
      let hasTrailingSlash =
        importPath === "." ||
        importPath === ".." ||
        importPath.endsWith("/") ||
        importPath.endsWith("/.") ||
        importPath.endsWith("/..");

      // Check the "browser" map
      const importDirInfo = r.dirInfoCached(r.fs.dir(absPath));
      if (importDirInfo !== null) {
        const remapped = r.checkBrowserMap(importDirInfo, absPath, absolutePathKind);
        if (remapped !== undefined) {
          if (remapped === null) {
            return new ResolveResult(new PathPair(new Path(absPath, "file", "", null, PathDisabled)));
          }
          const rr = r.resolveWithoutRemapping(importDirInfo.enclosingBrowserScope as dirInfo, remapped);
          if (rr[1]) {
            result = new ResolveResult(rr[0], rr[2], rr[3]);
            hasTrailingSlash = false;
            checkRelative = false;
            checkPackage = false;
          }
        }
      }

      if (hasTrailingSlash) {
        const l = r.loadAsDirectory(absPath);
        if (l[1]) {
          checkPackage = false;
          result = new ResolveResult(l[0], l[2]);
        } else if (!checkPackage) {
          return null;
        }
      } else {
        if (checkRelative) {
          const l = r.loadAsFileOrDirectory(absPath);
          if (l[1]) {
            checkPackage = false;
            result = new ResolveResult(l[0], l[2]);
          } else if (!checkPackage) {
            return null;
          }
        }
      }
    }

    if (checkPackage) {
      // Support remapping one package path to another via the "browser" field
      const remapped = r.checkBrowserMap(sourceDirInfo, importPath, packagePathKind);
      if (remapped !== undefined) {
        if (remapped === null) {
          // "browser": {"module": false}
          const n = r.loadNodeModules(importPath, sourceDirInfo, false /* forbidImports */);
          if (n[1]) {
            const absolute = n[0];
            absolute.primary = new Path(absolute.primary.text, "file", "", null, PathDisabled);
            if (absolute.hasSecondary()) {
              absolute.secondary = new Path(absolute.secondary.text, "file", "", null, PathDisabled);
            }
            return new ResolveResult(absolute, n[2], n[3]);
          } else {
            return new ResolveResult(new PathPair(new Path(importPath, "", "", null, PathDisabled)), n[2]);
          }
        }

        // "browser": {"module": "./some-file"}
        // "browser": {"module": "another-module"}
        importPath = remapped;
        sourceDirInfo = sourceDirInfo.enclosingBrowserScope as dirInfo;
      }

      const rr = r.resolveWithoutRemapping(sourceDirInfo, importPath);
      if (rr[1]) {
        result = new ResolveResult(rr[0], rr[2], rr[3]);
      } else {
        // Note: node's "self references" are not currently supported
        return null;
      }
    }

    // (Go returns a pointer to its zero-initialized "result" if nothing set it)
    return result !== null ? result : new ResolveResult(new PathPair());
  }

  resolveWithoutRemapping(sourceDirInfo: dirInfo, importPath: string): PairResult4 {
    const r = this;
    if (isPackagePath(importPath)) {
      return r.loadNodeModules(importPath, sourceDirInfo, false /* forbidImports */);
    } else {
      const l = r.loadAsFileOrDirectory(r.fs.join(sourceDirInfo.absPath, importPath));
      if (!l[1]) return FAIL4;
      return [l[0], true, l[2], null];
    }
  }

  // ---------------------------------------------------------------------------

  tsConfigForDir(info: dirInfo): TSConfigJSON | null {
    if (info.isInsideNodeModules) {
      return null;
    }
    if (this.tsConfigOverride !== null) {
      return this.tsConfigOverride;
    }
    return info.enclosingTSConfigJSON;
  }

  dirInfoCached(path: string): dirInfo | null {
    // First, check the cache
    let cached = this.dirCache.get(path);

    // Cache hit: stop now
    if (cached === undefined) {
      // Update the cache to indicate failure. Even if the read failed, we don't
      // want to retry again later. The directory is inaccessible so trying again
      // is wasted. Doing this before calling "dirInfoUncached" prevents stack
      // overflow in case this directory is recursively encountered again.
      this.dirCache.set(path, null);

      // Cache miss: read the info
      cached = this.dirInfoUncached(path);

      // Only update the cache again on success
      if (cached !== null) {
        this.dirCache.set(path, cached);
      }
    }

    if (this.debugLogs !== null) {
      if (cached === null) {
        this.debugLogs.addNote("Failed to read directory " + goQuote(path));
      } else {
        const count = cached.entries.peekEntryCount();
        let entries = "entries";
        if (count === 1) {
          entries = "entry";
        }
        this.debugLogs.addNote("Read " + count + " " + entries + " for directory " + goQuote(path));
      }
    }

    return cached;
  }

  // This may return "errParseErrorAlreadyLogged" in which case there was a
  // syntax error, but it's already been reported. No further errors should be
  // logged.
  //
  // Nested calls may also return "errParseErrorImportCycle". In that case the
  // caller is responsible for logging an appropriate error message.
  //
  // Returns [result, error]
  parseTSConfig(file: string, visited: Map<string, boolean> | null, configDir: string): [TSConfigJSON | null, any] {
    const r = this;

    // Resolve any symlinks first before parsing the file
    if (!r.options.preserveSymlinks) {
      const real = r.fs.evalSymlinks(file);
      if (real[1]) {
        file = real[0];
      }
    }

    // Don't infinite loop if a series of "extends" links forms a cycle
    if (visited !== null && visited.get(file) === true) {
      return [null, errParseErrorImportCycle];
    }

    const f = r.caches.fsCache.readFileText(r.fs, file);
    if (r.debugLogs !== null && f[2] !== null) {
      r.debugLogs.addNote("Failed to read file " + goQuote(file) + ": " + f[2].error());
    }
    if (f[1] !== null) {
      return [null, f[1]];
    }
    if (r.debugLogs !== null) {
      r.debugLogs.addNote("The file " + goQuote(file) + " exists");
    }

    const keyPath = new Path(file, "file");
    const source = new Source(makePrettyPaths(r.fs, keyPath), "", f[0], keyPath);
    if (visited !== null) {
      // This is only non-null for "build" API calls. This is null for "transform"
      // API calls, which tells us to not process "extends" fields.
      visited.set(file, true);
    }
    const result = r.parseTSConfigFromSource(source, visited, configDir);
    if (visited !== null) {
      // Reset this to back false in case something uses TypeScript 5.0's multiple
      // inheritance feature for "tsconfig.json" files. It should be valid to visit
      // the same base "tsconfig.json" file multiple times from different multiple
      // inheritance subtrees.
      visited.set(file, false);
    }
    return result;
  }

  // Returns [result, error]
  parseTSConfigFromSource(source: Source, visited: Map<string, boolean> | null, configDir: string): [TSConfigJSON | null, any] {
    const r = this;
    const tracker = new LineColumnTracker(source);
    const fileDir = r.fs.dir(source.keyPath.text);
    const isExtends = visited !== null && visited.size > 1;

    const result: TSConfigJSON | null = parseTSConfigJSON(r.log, source, r.caches.jsonCache, r.fs, fileDir, configDir, (extends_: string, extendsRange: Range): TSConfigJSON | null => {
      // (Go's "defer r.debugLogs.decreaseIndent()" in this closure)
      let deferredDecreaseIndent = 0;
      try {
      if (visited === null) {
        // If this is null, then we're in a "transform" API call. In that case we
        // deliberately skip processing "extends" fields. This is because the
        // "transform" API is supposed to be without a file system.
        return null;
      }

      // Note: This doesn't use the normal node module resolution algorithm
      // both because it's different (e.g. we don't want to match a directory)
      // and because it would deadlock since we're currently in the middle of
      // populating the directory info cache.

      // Returns [result, shouldReturn]
      const maybeFinishOurSearch = (base: TSConfigJSON | null, err: any, extendsFile: string): [TSConfigJSON | null, boolean] => {
        if (err === null) {
          return [base, true];
        }

        if (err === ENOENT) {
          // Return false to indicate that we should continue searching
          return [null, false];
        }

        if (err === errParseErrorImportCycle) {
          r.log.addID(MsgID_TSConfigJSON_Cycle, Warning, tracker, extendsRange, "Base config file " + goQuote(extends_) + " forms cycle");
        } else if (err !== errParseErrorAlreadyLogged) {
          const prettyPaths = makePrettyPaths(r.fs, new Path(extendsFile, "file"));
          r.log.addError(tracker, extendsRange, "Cannot read file " + goQuote(prettyPaths.select(r.options.logPathStyle)) + ": " + err.error());
        }
        return [null, true];
      };

      // (Go's "goto pnpError")
      let pnpError = false;

      // Check for a Yarn PnP manifest and use that to rewrite the path
      if (isPackagePath(extends_)) {
        let pnpData = r.pnpManifest;

        // If we haven't loaded the Yarn PnP manifest yet, try to find one
        if (pnpData === null) {
          let current = fileDir;
          for (;;) {
            if (parseYarnPnPVirtualPath(current) === null) {
              let absPath = r.fs.join(current, ".pnp.data.json");
              let $j = r.extractYarnPnPDataFromJSON(absPath, pnpIgnoreErrorsAboutMissingFiles);
              if ($j[0].data !== null) {
                pnpData = compileYarnPnPData(absPath, current, $j[0], $j[1]);
                break;
              }

              absPath = r.fs.join(current, ".pnp.cjs");
              $j = r.tryToExtractYarnPnPDataFromJS(absPath, pnpIgnoreErrorsAboutMissingFiles);
              if ($j[0].data !== null) {
                pnpData = compileYarnPnPData(absPath, current, $j[0], $j[1]);
                break;
              }

              absPath = r.fs.join(current, ".pnp.js");
              $j = r.tryToExtractYarnPnPDataFromJS(absPath, pnpIgnoreErrorsAboutMissingFiles);
              if ($j[0].data !== null) {
                pnpData = compileYarnPnPData(absPath, current, $j[0], $j[1]);
                break;
              }
            }

            // Go to the parent directory, stopping at the file system root
            const next = r.fs.dir(current);
            if (current === next) {
              break;
            }
            current = next;
          }
        }

        if (pnpData !== null) {
          const result = r.resolveToUnqualified(extends_, fileDir, pnpData);
          if (result.status === pnpErrorGeneric) {
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("The Yarn PnP path resolution algorithm returned an error");
            }
            pnpError = true;
          } else if (result.status === pnpSuccess) {
            // If Yarn PnP path resolution succeeded, run a custom abbreviated
            // version of node's module resolution algorithm. The Yarn PnP
            // specification says to use node's module resolution algorithm verbatim
            // but that isn't what Yarn actually does. See this for more info:
            // https://github.com/evanw/esbuild/issues/2473#issuecomment-1216774461
            const $d = r.fs.readDirectory(result.pkgDirPath);
            if ($d[2] === null) {
              const entry = $d[0].get("package.json")[0];
              if (entry !== null && entry.kind(r.fs) === FileEntry) {
                // Check the "exports" map
                const pj = r.parsePackageJSON(result.pkgDirPath);
                if (pj !== null && pj.exportsMap !== null) {
                  const a = r.esmResolveAlgorithm(finalizeImportsExportsYarnPnPTSConfigExtends, result.pkgIdent, "." + result.pkgSubpath, pj, result.pkgDirPath, source.keyPath.text);
                  if (a[1]) {
                    const absolute = a[0].primary.text;
                    const p = r.parseTSConfig(absolute, visited, configDir);
                    const m = maybeFinishOurSearch(p[0], p[1], absolute);
                    if (m[1]) {
                      return m[0];
                    }
                  }
                  pnpError = true;
                }
              }
            }

            // Continue with the module resolution algorithm from node.js
            if (!pnpError) {
              extends_ = r.fs.join(result.pkgDirPath, result.pkgSubpath);
            }
          }
        }
      }

      if (pnpError) {
        // (goto pnpError)
      } else if (isPackagePath(extends_) && !r.fs.isAbs(extends_)) {
        const esm = esmParsePackageName(extends_);
        const esmPackageName = esm[0];
        const esmPackageSubpath = esm[1];
        if (r.debugLogs !== null && esm[2]) {
          r.debugLogs.addNote("Parsed tsconfig package name " + goQuote(esmPackageName) + " and package subpath " + goQuote(esmPackageSubpath));
        }

        // If this is still a package path, try to resolve it to a "node_modules" directory
        let current = fileDir;
        for (;;) {
          // Skip "node_modules" folders
          if (r.fs.base(current) !== "node_modules") {
            let join = r.fs.join(current, "node_modules", extends_);

            // Check to see if "package.json" exists
            const pkgDir = r.fs.join(current, "node_modules", esmPackageName);
            const pjFile = r.fs.join(pkgDir, "package.json");
            const $pj = r.fs.readFile(pjFile);
            if ($pj[1] === null) {
              const pj = r.parsePackageJSON(pkgDir);
              if (pj !== null) {
                // Try checking the "tsconfig" field of "package.json". The ability to use "extends" like this was added in TypeScript 3.2:
                // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-2.html#tsconfigjson-inheritance-via-nodejs-packages
                if (pj.tsconfig !== "") {
                  join = pj.tsconfig;
                  if (!r.fs.isAbs(join)) {
                    join = r.fs.join(pkgDir, join);
                  }
                }

                // Try checking the "exports" map. The ability to use "extends" like this was added in TypeScript 5.0:
                // https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/
                if (pj.exportsMap !== null) {
                  if (r.debugLogs !== null) {
                    r.debugLogs.addNote("Looking for " + goQuote(esmPackageSubpath) + ' in "exports" map in ' + goQuote(pj.source.keyPath.text));
                    r.debugLogs.increaseIndent();
                    deferredDecreaseIndent++;
                  }

                  // Note: TypeScript appears to always treat this as a "require" import
                  const conditions = r.esmConditionsRequire;
                  let e = r.esmPackageExportsResolve("/", esmPackageSubpath, pj.exportsMap.root, conditions);
                  e = r.esmHandlePostConditions(e[0], e[1], e[2]);
                  const resolvedPath = e[0];
                  const status = e[1];

                  // This is a very abbreviated version of our ESM resolution
                  if (status === pjStatusExact || status === pjStatusExactEndsWithStar) {
                    const fileToCheck = r.fs.join(pkgDir, resolvedPath);
                    const p = r.parseTSConfig(fileToCheck, visited, configDir);
                    const m = maybeFinishOurSearch(p[0], p[1], fileToCheck);
                    if (m[1]) {
                      return m[0];
                    }
                  }
                }
              }
            } else if (r.debugLogs !== null && $pj[2] !== null) {
              r.debugLogs.addNote("Failed to read file " + goQuote(pjFile) + ": " + $pj[2].error());
            }

            const filesToCheck = [r.fs.join(join, "tsconfig.json"), join, join + ".json"];
            for (let i = 0; i < filesToCheck.length; i++) {
              const fileToCheck = filesToCheck[i];
              const p = r.parseTSConfig(fileToCheck, visited, configDir);
              const err = p[1];

              // Explicitly ignore matches if they are directories instead of files
              if (err !== null && err !== ENOENT) {
                const d = r.fs.readDirectory(r.fs.dir(fileToCheck));
                if (d[1] === null) {
                  const entry = d[0].get(r.fs.base(fileToCheck))[0];
                  if (entry !== null && entry.kind(r.fs) === DirEntry) {
                    continue;
                  }
                }
              }

              const m = maybeFinishOurSearch(p[0], err, fileToCheck);
              if (m[1]) {
                return m[0];
              }
            }
          }

          // Go to the parent directory, stopping at the file system root
          const next = r.fs.dir(current);
          if (current === next) {
            break;
          }
          current = next;
        }
      } else {
        let extendsFile = extends_;

        // The TypeScript compiler has a strange behavior that seems like a bug
        // where "." and ".." behave differently than other forms such as "./."
        // or "../." and are interpreted as having an implicit "tsconfig.json"
        // suffix.
        //
        // I believe their bug is caused by some parts of their code checking for
        // relative paths using the literal "./" and "../" prefixes (requiring
        // the slash) and other parts checking using the regular expression
        // /^\.\.?($|[\\/])/ (with the slash optional).
        //
        // In any case, people are now relying on this behavior. One example is
        // this: https://github.com/esbuild-kit/tsx/pull/158. So we replicate this
        // bug in esbuild as well.
        if (extendsFile === "." || extendsFile === "..") {
          extendsFile += "/tsconfig.json";
        }

        // If this is a regular path, search relative to the enclosing directory
        if (!r.fs.isAbs(extendsFile)) {
          extendsFile = r.fs.join(fileDir, extendsFile);
        }
        let p = r.parseTSConfig(extendsFile, visited, configDir);

        // TypeScript's handling of "extends" has some specific edge cases. We
        // must only try adding ".json" if it's not already present, which is
        // unlike how node path resolution works. We also need to explicitly
        // ignore matches if they are directories instead of files. Some users
        // name directories the same name as their config files.
        if (p[1] !== null && !extendsFile.endsWith(".json")) {
          const d = r.fs.readDirectory(r.fs.dir(extendsFile));
          if (d[1] === null) {
            const extendsBase = r.fs.base(extendsFile);
            const entry = d[0].get(extendsBase)[0];
            if (entry === null || entry.kind(r.fs) !== FileEntry) {
              const entry2 = d[0].get(extendsBase + ".json")[0];
              if (entry2 !== null && entry2.kind(r.fs) === FileEntry) {
                p = r.parseTSConfig(extendsFile + ".json", visited, configDir);
              }
            }
          }
        }

        const m = maybeFinishOurSearch(p[0], p[1], extendsFile);
        if (m[1]) {
          return m[0];
        }
      }

      // Suppress warnings about missing base config files inside "node_modules"
      // pnpError:
      if (!isInsideNodeModules(source.keyPath.text)) {
        let notes: MsgData[] | null = null;
        if (r.debugLogs !== null) {
          notes = r.debugLogs.notes;
        }
        r.log.addIDWithNotes(MsgID_TSConfigJSON_Missing, Warning, tracker, extendsRange, "Cannot find base config file " + goQuote(extends_), notes);
      }

      return null;
      } finally {
        for (; deferredDecreaseIndent > 0; deferredDecreaseIndent--) (r.debugLogs as DebugLogs).decreaseIndent();
      }
    });

    if (result === null) {
      return [null, errParseErrorAlreadyLogged];
    }

    // Now that we have parsed the entire "tsconfig.json" file, filter out any
    // paths that are invalid due to being a package-style path without a base
    // URL specified. This must be done here instead of when we're parsing the
    // original file because TypeScript allows one "tsconfig.json" file to
    // specify "baseUrl" and inherit a "paths" from another file via "extends".
    // (Go iterates over a map here; the order doesn't matter: the log sorts
    // the warnings, which are at different locations)
    if (!isExtends && result.paths !== null && result.baseURL === null) {
      for (const [key, paths] of result.paths.map) {
        let end = 0;
        for (let i = 0; i < paths.length; i++) {
          const path = paths[i];
          if (isValidTSConfigPathNoBaseURLPattern(path.text, r.log, result.paths.source, null, path.loc)) {
            paths[end] = path;
            end++;
          }
        }
        if (end < paths.length) {
          result.paths.map.set(key, paths.slice(0, end));
        }
      }
    }

    return [result, null];
  }

  dirInfoUncached(path: string): dirInfo | null {
    const r = this;

    // Get the info for the parent directory
    let parentInfo: dirInfo | null = null;
    const parentDir = r.fs.dir(path);
    if (parentDir !== path) {
      parentInfo = r.dirInfoCached(parentDir);

      // Stop now if the parent directory doesn't exist
      if (parentInfo === null) {
        return null;
      }
    }

    // List the directories
    const d = r.fs.readDirectory(path);
    let entries = d[0];
    let err = d[1];
    if (err === EACCES || err === EPERM) {
      // Just pretend this directory is empty if we can't access it. This is the
      // case on Unix for directories that only have the execute permission bit
      // set. It means we will just pass through the empty directory and
      // continue to check the directories above it, which is now node behaves.
      entries = makeEmptyDirEntries(path);
      err = null;
    }
    if (r.debugLogs !== null && d[2] !== null) {
      r.debugLogs.addNote("Failed to read directory " + goQuote(path) + ": " + d[2].error());
    }
    if (err !== null) {
      // Ignore "ENOTDIR" here so that calling "ReadDirectory" on a file behaves
      // as if there is nothing there at all instead of causing an error due to
      // the directory actually being a file. This is a workaround for situations
      // where people try to import from a path containing a file as a parent
      // directory. The "pnpm" package manager generates a faulty "NODE_PATH"
      // list which contains such paths and treating them as missing means we just
      // ignore them during path resolution.
      if (err !== ENOENT && err !== ENOTDIR) {
        const prettyPaths = makePrettyPaths(r.fs, new Path(path, "file"));
        r.log.addError(null, new Range(0, 0), "Cannot read directory " + goQuote(prettyPaths.select(r.options.logPathStyle)) + ": " + err.error());
      }
      return null;
    }
    const info = new dirInfo(path, parentInfo, entries);

    // A "node_modules" directory isn't allowed to directly contain another "node_modules" directory
    const base = r.fs.base(path);
    if (base === "node_modules") {
      info.isNodeModules = true;
      info.isInsideNodeModules = true;
    } else {
      const entry = entries.get("node_modules")[0];
      if (entry !== null) {
        info.hasNodeModules = entry.kind(r.fs) === DirEntry;
      }
    }

    // Propagate the browser scope into child directories
    if (parentInfo !== null) {
      info.enclosingPackageJSON = parentInfo.enclosingPackageJSON;
      info.enclosingBrowserScope = parentInfo.enclosingBrowserScope;
      info.enclosingTSConfigJSON = parentInfo.enclosingTSConfigJSON;
      if (parentInfo.isInsideNodeModules) {
        info.isInsideNodeModules = true;
      }

      // Make sure "absRealPath" is the real path of the directory (resolving any symlinks)
      if (!r.options.preserveSymlinks) {
        const entry = parentInfo.entries.get(base)[0];
        if (entry !== null) {
          const symlink = entry.symlink(r.fs);
          if (symlink !== "") {
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("Resolved symlink " + goQuote(path) + " to " + goQuote(symlink));
            }
            info.absRealPath = symlink;
          } else if (parentInfo.absRealPath !== "") {
            const symlink2 = r.fs.join(parentInfo.absRealPath, base);
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("Resolved symlink " + goQuote(path) + " to " + goQuote(symlink2));
            }
            info.absRealPath = symlink2;
          }
        }
      }
    }

    // Record if this directory has a package.json file
    {
      const entry = entries.get("package.json")[0];
      if (entry !== null && entry.kind(r.fs) === FileEntry) {
        info.packageJSON = r.parsePackageJSON(path);

        // Propagate this "package.json" file into child directories
        if (info.packageJSON !== null) {
          info.enclosingPackageJSON = info.packageJSON;
          if (info.packageJSON.browserMap !== null) {
            info.enclosingBrowserScope = info;
          }
        }
      }
    }

    // Record if this directory has a tsconfig.json or jsconfig.json file
    if (r.tsConfigOverride === null) {
      let tsConfigPath = "";
      const entry = entries.get("tsconfig.json")[0];
      if (entry !== null && entry.kind(r.fs) === FileEntry) {
        tsConfigPath = r.fs.join(path, "tsconfig.json");
      } else {
        const entry2 = entries.get("jsconfig.json")[0];
        if (entry2 !== null && entry2.kind(r.fs) === FileEntry) {
          tsConfigPath = r.fs.join(path, "jsconfig.json");
        }
      }

      // Except don't do this if we're inside a "node_modules" directory. Package
      // authors often publish their "tsconfig.json" files to npm because of
      // npm's default-include publishing model and because these authors
      // probably don't know about ".npmignore" files.
      //
      // People trying to use these packages with esbuild have historically
      // complained that esbuild is respecting "tsconfig.json" in these cases.
      // The assumption is that the package author published these files by
      // accident.
      //
      // Ignoring "tsconfig.json" files inside "node_modules" directories breaks
      // the use case of publishing TypeScript code and having it be transpiled
      // for you, but that's the uncommon case and likely doesn't work with
      // many other tools anyway. So now these files are ignored.
      if (tsConfigPath !== "" && !info.isInsideNodeModules) {
        const p = r.parseTSConfig(tsConfigPath, new Map(), r.fs.dir(tsConfigPath));
        info.enclosingTSConfigJSON = p[0];
        const err = p[1];
        if (err !== null) {
          if (err === ENOENT) {
            const prettyPaths = makePrettyPaths(r.fs, new Path(tsConfigPath, "file"));
            r.log.addError(null, new Range(0, 0), "Cannot find tsconfig file " + goQuote(prettyPaths.select(r.options.logPathStyle)));
          } else if (err !== errParseErrorAlreadyLogged) {
            const prettyPaths = makePrettyPaths(r.fs, new Path(tsConfigPath, "file"));
            r.log.addID(MsgID_TSConfigJSON_Missing, Debug, null, new Range(0, 0), "Cannot read file " + goQuote(prettyPaths.select(r.options.logPathStyle)) + ": " + err.error());
          }
        }
      }
    }

    // Record if this directory has a Yarn PnP manifest. This must not be done
    // for Yarn virtual paths because that will result in duplicate copies of
    // the same manifest which will result in multiple copies of the same virtual
    // directory in the same path, which we don't handle (and which also doesn't
    // match Yarn's behavior).
    if (r.pnpManifest === null) {
      if (parseYarnPnPVirtualPath(path) === null) {
        let pnp = entries.get(".pnp.data.json")[0];
        if (pnp !== null && pnp.kind(r.fs) === FileEntry) {
          info.pnpManifestAbsPath = r.fs.join(path, ".pnp.data.json");
        } else {
          pnp = entries.get(".pnp.cjs")[0];
          if (pnp !== null && pnp.kind(r.fs) === FileEntry) {
            info.pnpManifestAbsPath = r.fs.join(path, ".pnp.cjs");
          } else {
            pnp = entries.get(".pnp.js")[0];
            if (pnp !== null && pnp.kind(r.fs) === FileEntry) {
              info.pnpManifestAbsPath = r.fs.join(path, ".pnp.js");
            }
          }
        }
      }
    }

    return info;
  }

  // Returns [absolute, ok, differentCase]
  loadAsFile(path: string, extensionOrder: string[]): [string, boolean, DifferentCase | null] {
    const r = this;
    const debugLogs = r.debugLogs;
    if (debugLogs !== null) {
      debugLogs.addNote("Attempting to load " + goQuote(path) + " as a file");
      debugLogs.increaseIndent();
      try {
        return r.loadAsFileImpl(path, extensionOrder);
      } finally {
        debugLogs.decreaseIndent();
      }
    }
    return r.loadAsFileImpl(path, extensionOrder);
  }

  loadAsFileImpl(path: string, extensionOrder: string[]): [string, boolean, DifferentCase | null] {
    const r = this;

    // Read the directory entries once to minimize locking
    const dirPath = r.fs.dir(path);
    const d = r.fs.readDirectory(dirPath);
    if (r.debugLogs !== null && d[2] !== null) {
      r.debugLogs.addNote("Failed to read directory " + goQuote(dirPath) + ": " + d[2].error());
    }
    if (d[1] !== null) {
      if (d[1] !== ENOENT) {
        const prettyPaths = makePrettyPaths(r.fs, new Path(dirPath, "file"));
        r.log.addError(null, new Range(0, 0), "Cannot read directory " + goQuote(prettyPaths.select(r.options.logPathStyle)) + ": " + d[1].error());
      }
      return FILE_FAIL;
    }
    const entries = d[0];

    const base = r.fs.base(path);

    // Given "./x.js", node's algorithm tries things in the following order:
    //
    //   ./x.js
    //   ./x.js.js
    //   ./x.js.json
    //   ./x.js.node
    //   ./x.js/index.js
    //   ./x.js/index.json
    //   ./x.js/index.node
    //
    // Given "./x.js", TypeScript's algorithm tries things in the following order:
    //
    //   ./x.js.ts
    //   ./x.js.tsx
    //   ./x.js.d.ts
    //   ./x.ts
    //   ./x.tsx
    //   ./x.d.ts
    //   ./x.js/index.ts
    //   ./x.js/index.tsx
    //   ./x.js/index.d.ts
    //   ./x.js.js
    //   ./x.js.jsx
    //   ./x.js
    //   ./x.jsx
    //   ./x.js/index.js
    //   ./x.js/index.jsx
    //
    // Our order below is a blend of both. We try to follow node's algorithm but
    // with the features of TypeScript's algorithm (omitting ".d.ts" files, which
    // don't contain code). This means we should end up checking the same files
    // as TypeScript, but in a different order.

    // (tryFile)
    const tryFile = (baseWithSuffix: string): [string, boolean, DifferentCase | null] | null => {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Checking for file " + goQuote(baseWithSuffix));
      }
      const g = entries.get(baseWithSuffix);
      const entry = g[0];
      if (entry !== null && entry.kind(r.fs) === FileEntry) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("Found file " + goQuote(baseWithSuffix));
        }
        return [r.fs.join(dirPath, baseWithSuffix), true, g[1]];
      }
      return null;
    };

    // Try the plain path without any extensions
    {
      const t = tryFile(base);
      if (t !== null) {
        return t;
      }
    }

    // Try the path with extensions
    for (let i = 0; i < extensionOrder.length; i++) {
      const t = tryFile(base + extensionOrder[i]);
      if (t !== null) {
        return t;
      }
    }

    // TypeScript-specific behavior: try rewriting ".js" to ".ts"
    const exts = rewrittenFileExtensions(base);
    if (exts !== null) {
      const lastDot = base.lastIndexOf(".");
      for (let i = 0; i < exts.length; i++) {
        const t = tryFile(base.slice(0, lastDot) + exts[i]);
        if (t !== null) {
          return t;
        }
      }
    }

    if (r.debugLogs !== null) {
      r.debugLogs.addNote("Failed to find file " + goQuote(base));
    }
    return FILE_FAIL;
  }

  loadAsIndex(info: dirInfo, extensionOrder: string[]): PairResult {
    const r = this;

    // Try the "index" file with extensions
    for (let i = 0; i < extensionOrder.length; i++) {
      const base = "index" + extensionOrder[i];
      const g = info.entries.get(base);
      const entry = g[0];
      if (entry !== null && entry.kind(r.fs) === FileEntry) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("Found file " + goQuote(r.fs.join(info.absPath, base)));
        }
        return pairResult(new Path(r.fs.join(info.absPath, base), "file"), g[1]);
      }
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Failed to find file " + goQuote(r.fs.join(info.absPath, base)));
      }
    }

    return FAIL3;
  }

  loadAsIndexWithBrowserRemapping(info: dirInfo, path: string, extensionOrder: string[]): PairResult {
    const r = this;

    // Potentially remap using the "browser" field
    const absPath = r.fs.join(path, "index");
    const remapped = r.checkBrowserMap(info, absPath, absolutePathKind);
    if (remapped !== undefined) {
      if (remapped === null) {
        return pairResult(new Path(absPath, "file", "", null, PathDisabled), null);
      }
      const remappedAbs = r.fs.join(path, remapped);

      // Is this a file?
      const f = r.loadAsFile(remappedAbs, extensionOrder);
      if (f[1]) {
        return pairResult(new Path(f[0], "file"), f[2]);
      }

      // Is it a directory with an index?
      const fieldDirInfo = r.dirInfoCached(remappedAbs);
      if (fieldDirInfo !== null) {
        const l = r.loadAsIndex(fieldDirInfo, extensionOrder);
        if (l[1]) {
          return [l[0], true, null];
        }
      }

      return FAIL3;
    }

    return r.loadAsIndex(info, extensionOrder);
  }

  loadAsFileOrDirectory(path: string): PairResult {
    const r = this;
    let extensionOrder = r.options.extensionOrder as string[];
    if (importKindMustResolveToCSS(r.kind)) {
      // Use a special import order for CSS "@import" imports
      extensionOrder = r.cssExtensionOrder;
    } else if (isInsideNodeModules(path)) {
      // Use a special import order for imports inside "node_modules"
      extensionOrder = r.nodeModulesExtensionOrder;
    }

    // Is this a file?
    const f = r.loadAsFile(path, extensionOrder);
    if (f[1]) {
      return pairResult(new Path(f[0], "file"), f[2]);
    }

    return r.loadAsDirectory(path);
  }

  loadAsDirectory(path: string): PairResult {
    const r = this;
    let extensionOrder = r.options.extensionOrder as string[];
    if (importKindMustResolveToCSS(r.kind)) {
      // Use a special import order for CSS "@import" imports
      extensionOrder = r.cssExtensionOrder;
    } else if (isInsideNodeModules(path)) {
      // Use a special import order for imports inside "node_modules"
      extensionOrder = r.nodeModulesExtensionOrder;
    }

    // Is this a directory?
    const debugLogs = r.debugLogs;
    if (debugLogs !== null) {
      debugLogs.addNote("Attempting to load " + goQuote(path) + " as a directory");
      debugLogs.increaseIndent();
      try {
        return r.loadAsDirectoryImpl(path, extensionOrder);
      } finally {
        debugLogs.decreaseIndent();
      }
    }
    return r.loadAsDirectoryImpl(path, extensionOrder);
  }

  loadAsDirectoryImpl(path: string, extensionOrder: string[]): PairResult {
    const r = this;
    const info = r.dirInfoCached(path);
    if (info === null) {
      return FAIL3;
    }

    // Try using the main field(s) from "package.json"
    {
      const m = r.loadAsMainField(info, path, extensionOrder);
      if (m[1]) {
        return m;
      }
    }

    // Look for an "index" file with known extensions
    {
      const l = r.loadAsIndexWithBrowserRemapping(info, path, extensionOrder);
      if (l[1]) {
        return l;
      }
    }

    return FAIL3;
  }

  // (loadAsMainField's "loadMainField" closure)
  loadMainField(info: dirInfo, path: string, extensionOrder: string[], fieldRelPath: string, field: string): PairResult {
    const r = this;
    const debugLogs = r.debugLogs;
    if (debugLogs !== null) {
      debugLogs.addNote("Found main field " + goQuote(field) + " with path " + goQuote(fieldRelPath));
      debugLogs.increaseIndent();
      try {
        return r.loadMainFieldImpl(info, path, extensionOrder, fieldRelPath);
      } finally {
        debugLogs.decreaseIndent();
      }
    }
    return r.loadMainFieldImpl(info, path, extensionOrder, fieldRelPath);
  }

  loadMainFieldImpl(info: dirInfo, path: string, extensionOrder: string[], fieldRelPath: string): PairResult {
    const r = this;

    // Potentially remap using the "browser" field
    let fieldAbsPath = r.fs.join(path, fieldRelPath);
    const remapped = r.checkBrowserMap(info, fieldAbsPath, absolutePathKind);
    if (remapped !== undefined) {
      if (remapped === null) {
        return pairResult(new Path(fieldAbsPath, "file", "", null, PathDisabled), null);
      }
      fieldAbsPath = r.fs.join(path, remapped);
    }

    // Is this a file?
    const f = r.loadAsFile(fieldAbsPath, extensionOrder);
    if (f[1]) {
      return pairResult(new Path(f[0], "file"), f[2]);
    }

    // Is it a directory with an index?
    const fieldDirInfo = r.dirInfoCached(fieldAbsPath);
    if (fieldDirInfo !== null) {
      const l = r.loadAsIndexWithBrowserRemapping(fieldDirInfo, fieldAbsPath, extensionOrder);
      if (l[1]) {
        return [l[0], true, null];
      }
    }

    return FAIL3;
  }

  loadAsMainField(info: dirInfo, path: string, extensionOrder: string[]): PairResult {
    const r = this;
    const pj = info.packageJSON;
    if (pj === null) {
      return FAIL3;
    }

    const mainFieldValues = pj.mainFields;
    let mainFieldKeys = r.options.mainFields;
    let autoMain = false;

    // If the user has not explicitly specified a "main" field order,
    // use a default one determined by the current platform target
    if (mainFieldKeys === null) {
      mainFieldKeys = defaultMainFields[r.options.platform];
      autoMain = true;
    }

    const debugLogs = r.debugLogs;
    if (debugLogs !== null) {
      debugLogs.addNote("Searching for main fields in " + goQuote(pj.source.keyPath.text));
      debugLogs.increaseIndent();
      try {
        return r.loadAsMainFieldImpl(info, path, extensionOrder, pj, mainFieldValues, mainFieldKeys as string[], autoMain);
      } finally {
        debugLogs.decreaseIndent();
      }
    }
    return r.loadAsMainFieldImpl(info, path, extensionOrder, pj, mainFieldValues, mainFieldKeys as string[], autoMain);
  }

  loadAsMainFieldImpl(info: dirInfo, path: string, extensionOrder: string[], pj: packageJSON, mainFieldValues: Map<string, any>, mainFieldKeys: string[], autoMain: boolean): PairResult {
    const r = this;
    let foundSomething = false;

    for (let k = 0; k < mainFieldKeys.length; k++) {
      const key = mainFieldKeys[k];
      const value = mainFieldValues.get(key);
      if (value === undefined) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("Did not find main field " + goQuote(key));
        }
        continue;
      }
      foundSomething = true;

      const m = r.loadMainField(info, path, extensionOrder, value.relPath, key);
      if (!m[1]) {
        continue;
      }
      const absolute = m[0];

      // If the user did not manually configure a "main" field order, then
      // use a special per-module automatic algorithm to decide whether to
      // use "module" or "main" based on whether the package is imported
      // using "import" or "require".
      if (autoMain && key === "module") {
        let absoluteMain: PathPair = EMPTY_PATH_PAIR;
        let okMain = false;
        let diffCaseMain: DifferentCase | null = null;

        const main = mainFieldValues.get("main");
        if (main !== undefined) {
          const mm = r.loadMainField(info, path, extensionOrder, main.relPath, "main");
          if (mm[1]) {
            absoluteMain = mm[0];
            okMain = true;
            diffCaseMain = mm[2];
          }
        } else {
          // Some packages have a "module" field without a "main" field but
          // still have an implicit "index.js" file. In that case, treat that
          // as the value for "main".
          const mm = r.loadAsIndexWithBrowserRemapping(info, path, extensionOrder);
          if (mm[1]) {
            absoluteMain = mm[0];
            okMain = true;
            diffCaseMain = mm[2];
          }
        }

        if (okMain) {
          // If both the "main" and "module" fields exist, use "main" if the
          // path is for "require" and "module" if the path is for "import".
          // If we're using "module", return enough information to be able to
          // fall back to "main" later if something ended up using "require()"
          // with this same path. The goal of this code is to avoid having
          // both the "module" file and the "main" file in the bundle at the
          // same time.
          if (r.kind !== ImportRequire) {
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("Resolved to " + goQuote(absolute.primary.text) + ' using the "module" field in ' + goQuote(pj.source.keyPath.text));
              r.debugLogs.addNote('The fallback path in case of "require" is ' + goQuote(absoluteMain.primary.text));
            }
            return [
              new PathPair(
                // This is the whole point of the path pair
                absolute.primary,
                absoluteMain.primary,
              ),
              true,
              m[2],
            ];
          } else {
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("Resolved to " + goQuote(absoluteMain.primary.text) + ' because of "require"');
            }
            return [absoluteMain, true, diffCaseMain];
          }
        }
      }

      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Resolved to " + goQuote(absolute.primary.text) + " using the " + goQuote(key) + " field in " + goQuote(pj.source.keyPath.text));
      }
      return m;
    }

    // Let the user know if "main" exists but was skipped due to mis-configuration
    if (!foundSomething) {
      for (const field of mainFieldsForFailure) {
        const main = mainFieldValues.get(field);
        if (main !== undefined) {
          const tracker = new LineColumnTracker(pj.source);
          const keyRange = pj.source.rangeOfString(main.keyLoc);
          if (r.debugMeta.notes === null) r.debugMeta.notes = [];
          if (mainFieldKeys.length === 0 && r.options.platform === PlatformNeutral) {
            r.debugMeta.notes.push(
              tracker.msgData(keyRange, "The " + goQuote(field) + ' field here was ignored. Main fields must be configured explicitly when using the "neutral" platform.'),
            );
          } else {
            r.debugMeta.notes.push(
              tracker.msgData(keyRange, "The " + goQuote(field) + " field here was ignored because the list of main fields to use is currently set to [" + quotedCommaSeparated(mainFieldKeys) + "]."),
            );
          }
          break;
        }
      }
    }

    return FAIL3;
  }

  // This closely follows the behavior of "tryLoadModuleUsingPaths()" in the
  // official TypeScript compiler
  matchTSConfigPaths(tsConfigJSON: TSConfigJSON, path: string): PairResult {
    const r = this;
    const debugLogs = r.debugLogs;
    if (debugLogs !== null) {
      debugLogs.addNote("Matching " + goQuote(path) + ' against "paths" in ' + goQuote(tsConfigJSON.absPath));
      debugLogs.increaseIndent();
      try {
        return r.matchTSConfigPathsImpl(tsConfigJSON, path);
      } finally {
        debugLogs.decreaseIndent();
      }
    }
    return r.matchTSConfigPathsImpl(tsConfigJSON, path);
  }

  matchTSConfigPathsImpl(tsConfigJSON: TSConfigJSON, path: string): PairResult {
    const r = this;
    let absBaseURL = tsConfigJSON.baseURLForPaths;

    // The explicit base URL should take precedence over the implicit base URL
    // if present. This matters when a tsconfig.json file overrides "baseUrl"
    // from another extended tsconfig.json file but doesn't override "paths".
    if (tsConfigJSON.baseURL !== null) {
      absBaseURL = tsConfigJSON.baseURL;
    }

    if (r.debugLogs !== null) {
      r.debugLogs.addNote("Using " + goQuote(absBaseURL) + ' as "baseUrl"');
    }

    const pathsMap: Map<string, any[]> = tsConfigJSON.paths.map;

    // Check for exact matches first
    {
      const originalPaths = pathsMap.get(path);
      if (originalPaths !== undefined) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("Found an exact match for " + goQuote(path) + ' in "paths"');
        }
        for (let i = 0; i < originalPaths.length; i++) {
          const originalPath = originalPaths[i];

          // Ignore ".d.ts" files because this rule is obviously only here for type checking
          if (hasCaseInsensitiveSuffix(originalPath.text, ".d.ts")) {
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("Ignoring substitution " + goQuote(originalPath.text) + ' because it ends in ".d.ts"');
            }
            continue;
          }

          // Load the original path relative to the "baseUrl" from tsconfig.json
          let absoluteOriginalPath = originalPath.text;
          if (!r.fs.isAbs(absoluteOriginalPath)) {
            absoluteOriginalPath = r.fs.join(absBaseURL, absoluteOriginalPath);
          }
          const l = r.loadAsFileOrDirectory(absoluteOriginalPath);
          if (l[1]) {
            return l;
          }
        }
        return FAIL3;
      }
    }

    // Check for pattern matches next
    let longestMatchPrefixLength = -1;
    let longestMatchSuffixLength = -1;
    let longestMatchPrefix = "";
    let longestMatchSuffix = "";
    let longestMatchOriginalPaths: any[] | null = null;
    for (const [key, originalPaths] of pathsMap) {
      const starIndex = key.indexOf("*");
      if (starIndex !== -1) {
        const prefix = key.slice(0, starIndex);
        const suffix = key.slice(starIndex + 1);

        // Find the match with the longest prefix. If two matches have the same
        // prefix length, pick the one with the longest suffix. This second edge
        // case isn't handled by the TypeScript compiler, but we handle it
        // because we want the output to always be deterministic and Go map
        // iteration order is deliberately non-deterministic.
        // (both are a prefix and a suffix of "path", so comparing UTF-16
        // lengths gives the same order as Go's byte lengths)
        if (
          path.startsWith(prefix) &&
          path.endsWith(suffix) &&
          (prefix.length > longestMatchPrefixLength || (prefix.length === longestMatchPrefixLength && suffix.length > longestMatchSuffixLength))
        ) {
          longestMatchPrefixLength = prefix.length;
          longestMatchSuffixLength = suffix.length;
          longestMatchPrefix = prefix;
          longestMatchSuffix = suffix;
          longestMatchOriginalPaths = originalPaths;
        }
      }
    }

    // If there is at least one match, only consider the one with the longest
    // prefix. This matches the behavior of the TypeScript compiler.
    if (longestMatchPrefixLength !== -1) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Found a fuzzy match for " + goQuote(longestMatchPrefix + "*" + longestMatchSuffix) + ' in "paths"');
      }

      const originalPaths = longestMatchOriginalPaths as any[];
      for (let i = 0; i < originalPaths.length; i++) {
        // Swap out the "*" in the original path for whatever the "*" matched
        const matchedText = path.slice(longestMatchPrefix.length, path.length - longestMatchSuffix.length);
        const originalPath = originalPaths[i].text.replace("*", () => matchedText);

        // Ignore ".d.ts" files because this rule is obviously only here for type checking
        if (hasCaseInsensitiveSuffix(originalPath, ".d.ts")) {
          if (r.debugLogs !== null) {
            r.debugLogs.addNote("Ignoring substitution " + goQuote(originalPath) + ' because it ends in ".d.ts"');
          }
          continue;
        }

        // Load the original path relative to the "baseUrl" from tsconfig.json
        let absoluteOriginalPath = originalPath;
        if (!r.fs.isAbs(originalPath)) {
          absoluteOriginalPath = r.fs.join(absBaseURL, originalPath);
        }
        const l = r.loadAsFileOrDirectory(absoluteOriginalPath);
        if (l[1]) {
          return l;
        }
      }
    }

    return FAIL3;
  }

  loadPackageImports(importPath: string, dirInfoPackageJSON: dirInfo): PairResult4 {
    const r = this;
    const debugLogs = r.debugLogs;
    if (debugLogs !== null) {
      const pj = dirInfoPackageJSON.packageJSON as packageJSON;
      debugLogs.addNote("Looking for " + goQuote(importPath) + ' in "imports" map in ' + goQuote(pj.source.keyPath.text));
      debugLogs.increaseIndent();
      try {
        return r.loadPackageImportsImpl(importPath, dirInfoPackageJSON);
      } finally {
        debugLogs.decreaseIndent();
      }
    }
    return r.loadPackageImportsImpl(importPath, dirInfoPackageJSON);
  }

  loadPackageImportsImpl(importPath: string, dirInfoPackageJSON: dirInfo): PairResult4 {
    const r = this;
    const pj = dirInfoPackageJSON.packageJSON as packageJSON;
    const importsMap = pj.importsMap as pjMap;

    // Filter out invalid module specifiers now where we have more information for
    // a better error message instead of later when we're inside the algorithm.
    if (importPath === "#") {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("The path " + goQuote(importPath) + ' must not equal "#".');
      }
      const tracker = new LineColumnTracker(pj.source);
      if (r.debugMeta.notes === null) r.debugMeta.notes = [];
      r.debugMeta.notes.push(
        tracker.msgData(importsMap.root.firstToken, 'This "imports" map was ignored because the module specifier ' + goQuote(importPath) + " is invalid:"),
      );
      return FAIL4;
    }

    // The condition set is determined by the kind of import
    let conditions = r.esmConditionsDefault;
    switch (r.kind) {
      case ImportStmt:
      case ImportDynamic:
        conditions = r.esmConditionsImport;
        break;
      case ImportRequire:
      case ImportRequireResolve:
        conditions = r.esmConditionsRequire;
        break;
    }

    let e = r.esmPackageImportsResolve(importPath, importsMap.root, conditions);
    e = r.esmHandlePostConditions(e[0], e[1], e[2]);
    const resolvedPath = e[0];
    const status = e[1];

    if (status === pjStatusPackageResolve) {
      const b = r.checkForBuiltInNodeModules(resolvedPath);
      if (b[1]) {
        return [b[0], true, null, b[2]];
      }

      // The import path was remapped via "imports" to another import path
      // that now needs to be resolved too. Set "forbidImports" to true
      // so we don't try to resolve "imports" again and end up in a loop.
      const l = r.loadNodeModules(resolvedPath, dirInfoPackageJSON, true /* forbidImports */);
      if (!l[1]) {
        const tracker = new LineColumnTracker(pj.source);
        const note = tracker.msgData(e[2].token, "The remapped path " + goQuote(resolvedPath) + " could not be resolved:");
        r.debugMeta.notes = r.debugMeta.notes === null ? [note] : [note, ...r.debugMeta.notes];
      }
      return l;
    }

    const f = r.finalizeImportsExportsResult(
      finalizeImportsExportsNormal,
      dirInfoPackageJSON.absPath,
      conditions,
      importsMap,
      pj,
      resolvedPath,
      status,
      e[2],
      "",
      "",
      "",
    );
    if (!f[1]) return FAIL4;
    return [f[0], true, f[2], null];
  }

  esmResolveAlgorithm(kind: number, esmPackageName: string, esmPackageSubpath: string, pj: packageJSON, absPkgPath: string, absPath: string): PairResult {
    const r = this;
    const debugLogs = r.debugLogs;
    if (debugLogs !== null) {
      debugLogs.addNote("Looking for " + goQuote(esmPackageSubpath) + ' in "exports" map in ' + goQuote(pj.source.keyPath.text));
      debugLogs.increaseIndent();
      try {
        return r.esmResolveAlgorithmImpl(kind, esmPackageName, esmPackageSubpath, pj, absPkgPath, absPath);
      } finally {
        debugLogs.decreaseIndent();
      }
    }
    return r.esmResolveAlgorithmImpl(kind, esmPackageName, esmPackageSubpath, pj, absPkgPath, absPath);
  }

  esmResolveAlgorithmImpl(
    kind: number,
    esmPackageName: string,
    esmPackageSubpath: string,
    pj: packageJSON,
    absPkgPath: string,
    absPath: string,
  ): PairResult {
    const r = this;

    // The condition set is determined by the kind of import
    let conditions = r.esmConditionsDefault;
    switch (r.kind) {
      case ImportStmt:
      case ImportDynamic:
        conditions = r.esmConditionsImport;
        break;
      case ImportRequire:
      case ImportRequireResolve:
        conditions = r.esmConditionsRequire;
        break;
      case ImportEntryPoint:
        // Treat entry points as imports instead of requires for consistency with
        // Webpack and Rollup. More information:
        //
        // * https://github.com/evanw/esbuild/issues/1956
        // * https://github.com/nodejs/node/issues/41686
        // * https://github.com/evanw/entry-point-resolve-test
        //
        conditions = r.esmConditionsImport;
        break;
    }

    // Resolve against the path "/", then join it with the absolute
    // directory path. This is done because ESM package resolution uses
    // URLs while our path resolution uses file system paths. We don't
    // want problems due to Windows paths, which are very unlike URL
    // paths. We also want to avoid any "%" characters in the absolute
    // directory path accidentally being interpreted as URL escapes.
    const exportsMap = pj.exportsMap as pjMap;
    let e = r.esmPackageExportsResolve("/", esmPackageSubpath, exportsMap.root, conditions);
    e = r.esmHandlePostConditions(e[0], e[1], e[2]);

    return r.finalizeImportsExportsResult(kind, absPkgPath, conditions, exportsMap, pj, e[0], e[1], e[2], esmPackageName, esmPackageSubpath, absPath);
  }

  loadNodeModules(importPath: string, info: dirInfo, forbidImports: boolean): PairResult4 {
    const r = this;
    const debugLogs = r.debugLogs;
    if (debugLogs !== null) {
      debugLogs.addNote("Searching for " + goQuote(importPath) + ' in "node_modules" directories starting from ' + goQuote(info.absPath));
      debugLogs.increaseIndent();
      try {
        return r.loadNodeModulesImpl(importPath, info, forbidImports);
      } finally {
        debugLogs.decreaseIndent();
      }
    }
    return r.loadNodeModulesImpl(importPath, info, forbidImports);
  }

  loadNodeModulesImpl(importPath: string, info: dirInfo, forbidImports: boolean): PairResult4 {
    const r = this;

    // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file
    {
      const tsConfigJSON = r.tsConfigForDir(info);
      if (tsConfigJSON !== null) {
        // Try path substitutions first
        if (tsConfigJSON.paths !== null) {
          const m = r.matchTSConfigPaths(tsConfigJSON, importPath);
          if (m[1]) {
            return [m[0], true, m[2], null];
          }
        }

        // Try looking up the path relative to the base URL
        if (tsConfigJSON.baseURL !== null) {
          const basePath = r.fs.join(tsConfigJSON.baseURL, importPath);
          const l = r.loadAsFileOrDirectory(basePath);
          if (l[1]) {
            return [l[0], true, l[2], null];
          }
        }
      }
    }

    // Find the parent directory with the "package.json" file
    let dirInfoPackageJSON: dirInfo | null = info;
    while (dirInfoPackageJSON !== null && dirInfoPackageJSON.packageJSON === null) {
      dirInfoPackageJSON = dirInfoPackageJSON.parent;
    }

    // Check for subpath imports: https://nodejs.org/api/packages.html#subpath-imports
    if (dirInfoPackageJSON !== null && importPath.startsWith("#") && !forbidImports && (dirInfoPackageJSON.packageJSON as packageJSON).importsMap !== null) {
      return r.loadPackageImports(importPath, dirInfoPackageJSON);
    }

    // "import 'pkg'" when all packages are external (vs. "import './pkg'")
    if (r.options.externalPackages && isPackagePath(importPath)) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Marking this path as external because it's a package path");
      }
      return [new PathPair(new Path(importPath), new Path(), true), true, null, null];
    }

    // If Yarn PnP is active, use it to find the package
    if (r.pnpManifest !== null) {
      const result = r.resolveToUnqualified(importPath, info.absPath, r.pnpManifest);
      if (pnpStatusIsError(result.status)) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("The Yarn PnP path resolution algorithm returned an error");
        }

        // Try to provide more information about this error if it's available
        switch (result.status) {
          case pnpErrorDependencyNotFound:
            r.debugMeta.notes = [
              r.pnpManifest.tracker.msgData(
                result.errorRange,
                "The Yarn Plug'n'Play manifest forbids importing " + goQuote(result.errorIdent) + " here because it's not listed as a dependency of this package:",
              ),
            ];
            break;

          case pnpErrorUnfulfilledPeerDependency:
            r.debugMeta.notes = [
              r.pnpManifest.tracker.msgData(
                result.errorRange,
                "The Yarn Plug'n'Play manifest says this package has a peer dependency on " +
                  goQuote(result.errorIdent) +
                  ", but the package " +
                  goQuote(result.errorIdent) +
                  " has not been installed:",
              ),
            ];
            break;
        }

        return FAIL4;
      } else if (result.status === pnpSuccess) {
        const absPath = r.fs.join(result.pkgDirPath, result.pkgSubpath);

        // If Yarn PnP path resolution succeeded, run a custom abbreviated
        // version of node's module resolution algorithm. The Yarn PnP
        // specification says to use node's module resolution algorithm verbatim
        // but that isn't what Yarn actually does. See this for more info:
        // https://github.com/evanw/esbuild/issues/2473#issuecomment-1216774461
        const pkgDirInfo = r.dirInfoCached(result.pkgDirPath);
        if (pkgDirInfo !== null) {
          // Check the "exports" map
          const pj = pkgDirInfo.packageJSON;
          if (pj !== null && pj.exportsMap !== null) {
            const a = r.esmResolveAlgorithm(finalizeImportsExportsNormal, result.pkgIdent, "." + result.pkgSubpath, pj, pkgDirInfo.absPath, absPath);
            if (!a[1]) return FAIL4;
            return [a[0], true, a[2], null];
          }

          // Check the "browser" map
          const remapped = r.checkBrowserMap(pkgDirInfo, absPath, absolutePathKind);
          if (remapped !== undefined) {
            if (remapped === null) {
              return [new PathPair(new Path(absPath, "file", "", null, PathDisabled)), true, null, null];
            }
            const rr = r.resolveWithoutRemapping(pkgDirInfo.enclosingBrowserScope as dirInfo, remapped);
            if (rr[1]) {
              return [rr[0], true, rr[2], rr[3]];
            }
          }

          const l = r.loadAsFileOrDirectory(absPath);
          if (l[1]) {
            return [l[0], true, l[2], null];
          }
        }

        if (r.debugLogs !== null) {
          r.debugLogs.addNote("Failed to resolve " + goQuote(absPath) + " to a file");
        }
        return FAIL4;
      }
    }

    // Try to parse the package name using node's ESM-specific rules
    const esm = esmParsePackageName(importPath);
    const esmPackageName = esm[0];
    const esmPackageSubpath = esm[1];
    const esmOK = esm[2];
    if (r.debugLogs !== null && esmOK) {
      r.debugLogs.addNote("Parsed package name " + goQuote(esmPackageName) + " and package subpath " + goQuote(esmPackageSubpath));
    }

    // Check for self-references
    if (dirInfoPackageJSON !== null) {
      const pj = dirInfoPackageJSON.packageJSON as packageJSON;
      if (pj.name === esmPackageName && pj.exportsMap !== null) {
        const a = r.esmResolveAlgorithm(
          finalizeImportsExportsNormal,
          esmPackageName,
          esmPackageSubpath,
          pj,
          dirInfoPackageJSON.absPath,
          r.fs.join(dirInfoPackageJSON.absPath, esmPackageSubpath),
        );
        if (!a[1]) return FAIL4;
        return [a[0], true, a[2], null];
      }
    }

    // Then check for the package in any enclosing "node_modules" directories
    let d: dirInfo | null = info;
    for (;;) {
      // Skip directories that are themselves called "node_modules", since we
      // don't ever want to search for "node_modules/node_modules"
      if (d.hasNodeModules) {
        const t = r.tryToResolvePackage(r.fs.join(d.absPath, "node_modules"), importPath, esmOK, esmPackageName, esmPackageSubpath);
        if (t[4]) {
          return [t[0], t[1], t[2], t[3]];
        }
      }

      // Go to the parent directory, stopping at the file system root
      d = d.parent;
      if (d === null) {
        break;
      }
    }

    // Then check the global "NODE_PATH" environment variable. It has been
    // clarified that this step comes last after searching for "node_modules"
    // directories: https://github.com/nodejs/node/issues/38128.
    const absNodePaths = r.options.absNodePaths;
    for (let i = 0; i < absNodePaths.length; i++) {
      const t = r.tryToResolvePackage(absNodePaths[i], importPath, esmOK, esmPackageName, esmPackageSubpath);
      if (t[4]) {
        return [t[0], t[1], t[2], t[3]];
      }
    }

    return FAIL4;
  }

  // Common package resolution logic shared between "node_modules" and
  // "NODE_PATHS" (loadNodeModules' "tryToResolvePackage" closure). Returns
  // [pathPair, ok, differentCase, sideEffects, shouldStop].
  tryToResolvePackage(
    absDir: string,
    importPath: string,
    esmOK: boolean,
    esmPackageName: string,
    esmPackageSubpath: string,
  ): [PathPair, boolean, DifferentCase | null, SideEffectsData | null, boolean] {
    const r = this;
    const absPath = r.fs.join(absDir, importPath);
    if (r.debugLogs !== null) {
      r.debugLogs.addNote("Checking for a package in the directory " + goQuote(absPath));
    }

    // Try node's new package resolution rules
    if (esmOK) {
      const absPkgPath = r.fs.join(absDir, esmPackageName);
      const pkgDirInfo = r.dirInfoCached(absPkgPath);
      if (pkgDirInfo !== null) {
        // Check the "exports" map
        const pj = pkgDirInfo.packageJSON;
        if (pj !== null && pj.exportsMap !== null) {
          const a = r.esmResolveAlgorithm(finalizeImportsExportsNormal, esmPackageName, esmPackageSubpath, pj, absPkgPath, absPath);
          return [a[0], a[1], a[2], null, true];
        }

        // Check the "browser" map
        const remapped = r.checkBrowserMap(pkgDirInfo, absPath, absolutePathKind);
        if (remapped !== undefined) {
          if (remapped === null) {
            return [new PathPair(new Path(absPath, "file", "", null, PathDisabled)), true, null, null, true];
          }
          const rr = r.resolveWithoutRemapping(pkgDirInfo.enclosingBrowserScope as dirInfo, remapped);
          if (rr[1]) {
            return [rr[0], true, rr[2], rr[3], true];
          }
        }
      }
    }

    // Try node's old package resolution rules
    const l = r.loadAsFileOrDirectory(absPath);
    if (l[1]) {
      return [l[0], true, l[2], null, true];
    }

    return KEEP_SEARCHING;
  }

  // Returns [pathPair, ok, sideEffects]
  checkForBuiltInNodeModules(importPath: string): [PathPair, boolean, SideEffectsData | null] {
    const r = this;

    // "import fs from 'fs'"
    if (r.options.platform === PlatformNode && BuiltInNodeModules.has(importPath)) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Marking this path as implicitly external due to it being a node built-in");
      }

      r.flushDebugLogs(flushDueToSuccess);
      return [
        new PathPair(new Path(importPath), new Path(), true),
        true,
        new SideEffectsData(), // Mark this with "sideEffects: false"
      ];
    }

    // "import fs from 'node:fs'"
    // "require('node:fs')"
    if (r.options.platform === PlatformNode && importPath.startsWith("node:")) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote('Marking this path as implicitly external due to the "node:" prefix');
      }

      // If this is a known node built-in module, mark it with "sideEffects: false"
      let sideEffects: SideEffectsData | null = null;
      if (BuiltInNodeModules.has(importPath.slice(5))) {
        sideEffects = new SideEffectsData();
      }

      // Check whether the path will end up as "import" or "require"
      const convertImportToRequire = !formatKeepESMImportExportSyntax(r.options.outputFormat);
      const isImport = !convertImportToRequire && (r.kind === ImportStmt || r.kind === ImportDynamic);
      const isRequire =
        r.kind === ImportRequire || r.kind === ImportRequireResolve || (convertImportToRequire && (r.kind === ImportStmt || r.kind === ImportDynamic));

      // Check for support with "import"
      if (isImport && jsFeatureHas(r.options.unsupportedJSFeatures, NodeColonPrefixImport)) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote(`Removing the "node:" prefix because the target environment doesn't support it with "import" statements`);
        }

        // Automatically strip the prefix if it's not supported
        importPath = importPath.slice(5);
      }

      // Check for support with "require"
      if (isRequire && jsFeatureHas(r.options.unsupportedJSFeatures, NodeColonPrefixRequire)) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote(`Removing the "node:" prefix because the target environment doesn't support it with "require" calls`);
        }

        // Automatically strip the prefix if it's not supported
        importPath = importPath.slice(5);
      }

      r.flushDebugLogs(flushDueToSuccess);
      return [new PathPair(new Path(importPath), new Path(), true), true, sideEffects];
    }

    return NOT_BUILT_IN;
  }

  finalizeImportsExportsResult(
    kind: number,
    absDirPath: string,
    conditions: Set<string>,
    importExportMap: pjMap,
    pj: packageJSON,

    // Resolution results
    resolvedPath: string,
    status: number,
    debug: pjDebug,

    // Only for exports
    esmPackageName: string,
    esmPackageSubpath: string,
    absImportPath: string,
  ): PairResult {
    const r = this;

    let missingSuffix = "";

    if ((status === pjStatusExact || status === pjStatusExactEndsWithStar || status === pjStatusInexact) && resolvedPath.startsWith("/")) {
      let absResolvedPath = r.fs.join(absDirPath, resolvedPath);

      switch (status) {
        case pjStatusExact:
        case pjStatusExactEndsWithStar: {
          if (r.debugLogs !== null) {
            r.debugLogs.addNote("The resolved path " + goQuote(absResolvedPath) + " is exact");
          }

          // Avoid calling "dirInfoCached" recursively for "tsconfig.json" extends with Yarn PnP
          if (kind === finalizeImportsExportsYarnPnPTSConfigExtends) {
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("Resolved to " + goQuote(absResolvedPath));
            }
            return pairResult(new Path(absResolvedPath, "file"), null);
          }

          const resolvedDirInfo = r.dirInfoCached(r.fs.dir(absResolvedPath));
          const base = r.fs.base(absResolvedPath);
          let extensionOrder = r.options.extensionOrder as string[];
          if (importKindMustResolveToCSS(r.kind)) {
            extensionOrder = r.cssExtensionOrder;
          }

          if (resolvedDirInfo === null) {
            status = pjStatusModuleNotFound;
          } else {
            let g = resolvedDirInfo.entries.get(base);
            let entry = g[0];
            let diffCase = g[1];

            // TypeScript-specific behavior: try rewriting ".js" to ".ts"
            if (entry === null) {
              const exts = rewrittenFileExtensions(base);
              if (exts !== null) {
                const lastDot = base.lastIndexOf(".");
                for (let i = 0; i < exts.length; i++) {
                  const baseWithExt = base.slice(0, lastDot) + exts[i];
                  g = resolvedDirInfo.entries.get(baseWithExt);
                  entry = g[0];
                  diffCase = g[1];
                  if (entry !== null) {
                    absResolvedPath = r.fs.join(resolvedDirInfo.absPath, baseWithExt);
                    break;
                  }
                }
              }
            }

            if (entry === null) {
              const endsWithStar = status === pjStatusExactEndsWithStar;
              status = pjStatusModuleNotFound;

              // Try to have a friendly error message if people forget the extension
              if (endsWithStar) {
                for (let i = 0; i < extensionOrder.length; i++) {
                  if (resolvedDirInfo.entries.get(base + extensionOrder[i])[0] !== null) {
                    if (r.debugLogs !== null) {
                      r.debugLogs.addNote("The import " + goQuote(goPathJoin(esmPackageName, esmPackageSubpath)) + " is missing the extension " + goQuote(extensionOrder[i]));
                    }
                    status = pjStatusModuleNotFoundMissingExtension;
                    missingSuffix = extensionOrder[i];
                    break;
                  }
                }
              }
            } else {
              const entryKind = entry.kind(r.fs);
              if (entryKind === DirEntry) {
                if (r.debugLogs !== null) {
                  r.debugLogs.addNote("The path " + goQuote(absResolvedPath) + " is a directory, which is not allowed");
                }
                const endsWithStar = status === pjStatusExactEndsWithStar;
                status = pjStatusUnsupportedDirectoryImport;

                // Try to have a friendly error message if people forget the "/index.js" suffix
                if (endsWithStar) {
                  const resolvedDirInfo2 = r.dirInfoCached(absResolvedPath);
                  if (resolvedDirInfo2 !== null) {
                    for (let i = 0; i < extensionOrder.length; i++) {
                      const base2 = "index" + extensionOrder[i];
                      const e2 = resolvedDirInfo2.entries.get(base2)[0];
                      if (e2 !== null && e2.kind(r.fs) === FileEntry) {
                        status = pjStatusUnsupportedDirectoryImportMissingIndex;
                        missingSuffix = "/" + base2;
                        if (r.debugLogs !== null) {
                          r.debugLogs.addNote("The import " + goQuote(goPathJoin(esmPackageName, esmPackageSubpath)) + " is missing the suffix " + goQuote(missingSuffix));
                        }
                        break;
                      }
                    }
                  }
                }
              } else if (entryKind !== FileEntry) {
                status = pjStatusModuleNotFound;
              } else {
                if (r.debugLogs !== null) {
                  r.debugLogs.addNote("Resolved to " + goQuote(absResolvedPath));
                }
                return pairResult(new Path(absResolvedPath, "file"), diffCase);
              }
            }
          }
          break;
        }

        case pjStatusInexact: {
          // If this was resolved against an expansion key ending in a "/"
          // instead of a "*", we need to try CommonJS-style implicit
          // extension and/or directory detection.
          if (r.debugLogs !== null) {
            r.debugLogs.addNote("The resolved path " + goQuote(absResolvedPath) + " is inexact");
          }
          const l = r.loadAsFileOrDirectory(absResolvedPath);
          if (l[1]) {
            return l;
          }
          status = pjStatusModuleNotFound;
          break;
        }
      }
    }

    if (resolvedPath.startsWith("/")) {
      resolvedPath = "." + resolvedPath;
    }

    // Provide additional details about the failure to help with debugging
    const tracker = new LineColumnTracker(pj.source);
    const dm = r.debugMeta;
    switch (status) {
      case pjStatusInvalidModuleSpecifier:
        dm.notes = [tracker.msgData(debug.token, "The module specifier " + goQuote(resolvedPath) + " is invalid" + debug.invalidBecause + ":")];
        break;

      case pjStatusInvalidPackageConfiguration:
        dm.notes = [tracker.msgData(debug.token, "The package configuration has an invalid value here:")];
        break;

      case pjStatusInvalidPackageTarget: {
        let why = "The package target " + goQuote(resolvedPath) + " is invalid" + debug.invalidBecause + ":";
        if (resolvedPath === "") {
          // "PACKAGE_TARGET_RESOLVE" is specified to throw an "Invalid
          // Package Target" error for what is actually an invalid package
          // configuration error
          why = "The package configuration has an invalid value here:";
        }
        dm.notes = [tracker.msgData(debug.token, why)];
        break;
      }

      case pjStatusPackagePathNotExported: {
        if (debug.isBecauseOfNullLiteral) {
          dm.notes = [
            tracker.msgData(
              debug.token,
              "The path " + goQuote(esmPackageSubpath) + " cannot be imported from package " + goQuote(esmPackageName) + " because it was explicitly disabled by the package author here:",
            ),
          ];
          break;
        }

        dm.notes = [tracker.msgData(debug.token, "The path " + goQuote(esmPackageSubpath) + " is not exported by package " + goQuote(esmPackageName) + ":")];

        // If this fails, try to resolve it using the old algorithm
        const l = r.loadAsFileOrDirectory(absImportPath);
        if (l[1] && l[0].primary.namespace === "file") {
          const rel = r.fs.rel(absDirPath, l[0].primary.text);
          if (rel[1]) {
            const query = "." + goPathJoin("/", rel[0].split("\\").join("/"));

            // If that succeeds, try to do a reverse lookup using the
            // "exports" map for the currently-active set of conditions
            const rev = r.esmPackageExportsReverseResolve(query, importExportMap.root, conditions);
            if (rev[0]) {
              const subpath = rev[1];
              dm.notes.push(tracker.msgData(rev[2], "The file " + goQuote(query) + " is exported at path " + goQuote(subpath) + ":"));

              // Provide an inline suggestion message with the correct import path
              const prettyPaths = makePrettyPaths(r.fs, l[0].primary);
              const actualImportPath = goPathJoin(esmPackageName, subpath);
              dm.suggestionText = quoteForJSON(actualImportPath, false);
              dm.suggestionMessage = "Import from " + goQuote(actualImportPath) + " to get the file " + goQuote(prettyPaths.select(r.options.logPathStyle)) + ":";
            }
          }
        }
        break;
      }

      case pjStatusPackageImportNotDefined:
        dm.notes = [tracker.msgData(debug.token, "The package import " + goQuote(resolvedPath) + ' is not defined in this "imports" map:')];
        break;

      case pjStatusModuleNotFound:
      case pjStatusModuleNotFoundMissingExtension:
        dm.notes = [tracker.msgData(debug.token, "The module " + goQuote(resolvedPath) + " was not found on the file system:")];

        // Provide an inline suggestion message with the correct import path
        if (status === pjStatusModuleNotFoundMissingExtension) {
          const prettyPaths = makePrettyPaths(r.fs, new Path(r.fs.join(absDirPath, resolvedPath + missingSuffix), "file"));
          const actualImportPath = goPathJoin(esmPackageName, esmPackageSubpath + missingSuffix);
          dm.suggestionRange = suggestionRangeEnd;
          dm.suggestionText = missingSuffix;
          dm.suggestionMessage = "Import from " + goQuote(actualImportPath) + " to get the file " + goQuote(prettyPaths.select(r.options.logPathStyle)) + ":";
        }
        break;

      case pjStatusUnsupportedDirectoryImport:
      case pjStatusUnsupportedDirectoryImportMissingIndex:
        dm.notes = [
          tracker.msgData(debug.token, "Importing the directory " + goQuote(resolvedPath) + " is forbidden by this package:"),
          tracker.msgData(pj.source.rangeOfString(importExportMap.propertyKeyLoc), "The presence of " + goQuote(importExportMap.propertyKey) + " here makes importing a directory forbidden:"),
        ];

        // Provide an inline suggestion message with the correct import path
        if (status === pjStatusUnsupportedDirectoryImportMissingIndex) {
          const prettyPaths = makePrettyPaths(r.fs, new Path(r.fs.join(absDirPath, resolvedPath + missingSuffix), "file"));
          const actualImportPath = goPathJoin(esmPackageName, esmPackageSubpath + missingSuffix);
          dm.suggestionRange = suggestionRangeEnd;
          dm.suggestionText = missingSuffix;
          dm.suggestionMessage = "Import from " + goQuote(actualImportPath) + " to get the file " + goQuote(prettyPaths.select(r.options.logPathStyle)) + ":";
        }
        break;

      case pjStatusUndefinedNoConditionsMatch: {
        const keys = [...conditions].sort((a, b) => (goStringLess(a, b) ? -1 : goStringLess(b, a) ? 1 : 0));
        const unmatched = debug.unmatchedConditions === null ? [] : debug.unmatchedConditions;
        const unmatchedConditions = unmatched.map((key) => key.key);

        dm.notes = [
          tracker.msgData(importExportMap.root.firstToken, "The path " + goQuote(esmPackageSubpath) + " is not currently exported by package " + goQuote(esmPackageName) + ":"),
          tracker.msgData(
            debug.token,
            "None of the conditions in the package definition (" +
              quotedCommaSeparated(unmatchedConditions) +
              ") match any of the currently active conditions (" +
              quotedCommaSeparated(keys) +
              "):",
          ),
        ];

        let didSuggestEnablingCondition = false;
        for (const key of unmatched) {
          switch (key.key) {
            case "import":
              if (r.kind === ImportRequire || r.kind === ImportRequireResolve) {
                dm.suggestionMessage =
                  'Consider using an "import" statement to import this file, ' + 'which will work because the "import" condition is supported by this package:';
              }
              break;

            case "require":
              if (r.kind === ImportStmt || r.kind === ImportDynamic) {
                dm.suggestionMessage =
                  'Consider using a "require()" call to import this file, ' + 'which will work because the "require" condition is supported by this package:';
              }
              break;

            default:
              // Note: Don't suggest the adding the "types" condition because
              // TypeScript uses that for type definitions, which are not
              // intended to be included in a bundle as executable code
              if (!didSuggestEnablingCondition && key.key !== "types") {
                let how = "";
                switch (API.kind) {
                  case CLIAPI:
                    how = '"--conditions=' + key.key + '"';
                    break;
                  case JSAPI:
                    how = "\"conditions: ['" + key.key + "']\"";
                    break;
                  case GoAPI:
                    how = "'Conditions: []string{" + goQuote(key.key) + "}'";
                    break;
                }
                dm.notes.push(
                  tracker.msgData(
                    key.keyRange,
                    "Consider enabling the " + goQuote(key.key) + " condition if this package expects it to be enabled. " + "You can use " + how + " to do that:",
                  ),
                );
                didSuggestEnablingCondition = true;
              }
          }
        }
        break;
      }
    }

    return FAIL3;
  }
}

installPackageJSONMethods(Resolver.prototype);
installYarnPnPMethods(Resolver.prototype);

export function newResolver(call: number, fs: FS, log: any, caches: CacheSet, options: Options): Resolver {
  const extensionOrder = options.extensionOrder !== null ? options.extensionOrder : [];
  const extensionToLoader = options.extensionToLoader !== null ? options.extensionToLoader : new Map<string, number>();

  // Filter out non-CSS extensions for CSS "@import" imports
  const cssExtensionOrder: string[] = [];
  for (let i = 0; i < extensionOrder.length; i++) {
    const ext = extensionOrder[i];
    const loader = loaderFromFileExtension(extensionToLoader, ext);
    if (loader === LoaderNone || loaderIsCSS(loader)) {
      cssExtensionOrder.push(ext);
    }
  }

  // Sort all TypeScript file extensions after all JavaScript file extensions
  // for imports of files inside of "node_modules" directories. But insert
  // the TypeScript file extensions right after the last JavaScript file
  // extension instead of at the end so that they might come before the
  // first CSS file extension, which is important to people that publish
  // TypeScript and CSS code to npm with the same file names for both.
  const nodeModulesExtensionOrder: string[] = [];
  let split = 0;
  for (let i = 0; i < extensionOrder.length; i++) {
    const loader = loaderFromFileExtension(extensionToLoader, extensionOrder[i]);
    if (loader === LoaderJS || loader === LoaderJSX) {
      split = i + 1; // Split after the last JavaScript extension
    }
  }
  if (split !== 0) {
    // Only do this if there are any JavaScript extensions
    for (let i = 0; i < split; i++) {
      // Non-TypeScript extensions before the split
      const ext = extensionOrder[i];
      if (!loaderIsTypeScript(loaderFromFileExtension(extensionToLoader, ext))) {
        nodeModulesExtensionOrder.push(ext);
      }
    }
    for (let i = 0; i < extensionOrder.length; i++) {
      // All TypeScript extensions
      const ext = extensionOrder[i];
      if (loaderIsTypeScript(loaderFromFileExtension(extensionToLoader, ext))) {
        nodeModulesExtensionOrder.push(ext);
      }
    }
    for (let i = split; i < extensionOrder.length; i++) {
      // Non-TypeScript extensions after the split
      const ext = extensionOrder[i];
      if (!loaderIsTypeScript(loaderFromFileExtension(extensionToLoader, ext))) {
        nodeModulesExtensionOrder.push(ext);
      }
    }
  }

  // Generate the condition sets for interpreting the "exports" field
  const esmConditionsDefault = new Set<string>(["default"]);
  const esmConditionsImport = new Set<string>(["import"]);
  const esmConditionsRequire = new Set<string>(["require"]);
  if (options.conditions !== null) {
    for (let i = 0; i < options.conditions.length; i++) {
      esmConditionsDefault.add(options.conditions[i]);
    }
  }
  switch (options.platform) {
    case PlatformBrowser:
      esmConditionsDefault.add("browser");
      break;
    case PlatformNode:
      esmConditionsDefault.add("node");
      break;
  }
  for (const key of esmConditionsDefault) {
    esmConditionsImport.add(key);
    esmConditionsRequire.add(key);
  }

  // (Go copies the options struct: the resolver keeps its own shallow copy)
  const optionsCopy = Object.assign(Object.create(Object.getPrototypeOf(options)), options) as Options;
  optionsCopy.extensionOrder = extensionOrder; // (Go ranges over a nil slice like an empty one)
  const res = new Resolver(fs, log, optionsCopy, caches);
  res.cssExtensionOrder = cssExtensionOrder;
  res.nodeModulesExtensionOrder = nodeModulesExtensionOrder;
  res.esmConditionsDefault = esmConditionsDefault;
  res.esmConditionsImport = esmConditionsImport;
  res.esmConditionsRequire = esmConditionsRequire;

  // Handle the "tsconfig.json" override when the resolver is created. This
  // isn't done when we validate the build options both because the code for
  // "tsconfig.json" handling is already in the resolver, and because we want
  // watch mode to pick up changes to "tsconfig.json" and rebuild.
  if (options.tsConfigPath !== "" || options.tsConfigRaw !== "") {
    res.debugMeta = new DebugMeta();
    res.kind = ImportEntryPoint;
    let visited: Map<string, boolean> | null = null;
    if (call === BuildCall) {
      visited = new Map();
    }
    let p: [TSConfigJSON | null, any];
    if (options.tsConfigPath !== "") {
      if (res.log.level <= LevelDebug) {
        res.debugLogs = new DebugLogs("Resolving tsconfig file " + goQuote(options.tsConfigPath));
      }
      p = res.parseTSConfig(options.tsConfigPath, visited, fs.dir(options.tsConfigPath));
    } else {
      const source = new Source(
        new PrettyPaths("<tsconfig.json>", "<tsconfig.json>"),
        "",
        options.tsConfigRaw,
        new Path(fs.join(fs.cwd(), "<tsconfig.json>"), "file"),
      );
      p = res.parseTSConfigFromSource(source, visited, fs.cwd());
    }
    res.tsConfigOverride = p[0];
    const err = p[1];
    if (err !== null) {
      if (err === ENOENT) {
        const prettyPaths = makePrettyPaths(res.fs, new Path(options.tsConfigPath, "file"));
        res.log.addError(null, new Range(0, 0), "Cannot find tsconfig file " + goQuote(prettyPaths.select(options.logPathStyle)));
      } else if (err !== errParseErrorAlreadyLogged) {
        const prettyPaths = makePrettyPaths(res.fs, new Path(options.tsConfigPath, "file"));
        res.log.addError(null, new Range(0, 0), "Cannot read file " + goQuote(prettyPaths.select(options.logPathStyle)) + ": " + err.error());
      }
    } else {
      res.flushDebugLogs(flushDueToSuccess);
    }
    res.debugLogs = null;
  }

  // Mutate the provided options by settings from "tsconfig.json" if present.
  // (The "ts" and "jsx" sub-objects may be shared, so they are replaced with
  // modified copies instead of being mutated.)
  if (res.tsConfigOverride !== null) {
    const s = res.tsConfigOverride.settings;
    options.ts = new TSOptions(
      new TSConfig(s.experimentalDecorators, s.importsNotUsedAsValues, s.preserveValueImports, s.target, s.useDefineForClassFields, s.verbatimModuleSyntax),
      options.ts.parse,
      options.ts.noAmbiguousLessThan,
    );
    const jsx = options.jsx.clone();
    res.tsConfigOverride.jsxSettings.applyTo(jsx);
    options.jsx = jsx;
    options.tsAlwaysStrict = res.tsConfigOverride.tsAlwaysStrictOrStrict();
  }

  return res;
}

// helpers.StringArrayToQuotedCommaSeparatedString
function quotedCommaSeparated(a: string[]): string {
  return a.map((s) => goQuote(s)).join(", ");
}

export function makePrettyPaths(fs: FS, path: Path): PrettyPaths {
  let absPath = path.text;
  let relPath = path.text;

  if (path.namespace === "file") {
    const rel = fs.rel(fs.cwd(), relPath);
    if (rel[1]) {
      relPath = rel[0];
    }

    // These human-readable paths are used in error messages, comments in output
    // files, source names in source maps, and paths in the metadata JSON file.
    // These should be platform-independent so our output doesn't depend on which
    // operating system it was run. Replace Windows backward slashes with standard
    // forward slashes.
    relPath = relPath.replaceAll("\\", "/");
  } else if (path.namespace !== "") {
    absPath = `${path.namespace}:${absPath}`;
    relPath = `${path.namespace}:${relPath}`;
  }

  if (path.isDisabled()) {
    absPath = "(disabled):" + absPath;
    relPath = "(disabled):" + relPath;
  }

  return new PrettyPaths(absPath + path.ignoredSuffix, relPath + path.ignoredSuffix);
}

// Package paths are loaded from a "node_modules" directory. Non-package paths
// are relative or absolute paths.
export function isPackagePath(path: string): boolean {
  return !path.startsWith("/") && !path.startsWith("./") && !path.startsWith("../") && path !== "." && path !== "..";
}

// This list can be obtained with the following command:
//
//	node --experimental-wasi-unstable-preview1 -p "[...require('module').builtinModules].join('\n')"
//
// Be sure to use the *LATEST* version of node when updating this list!
export const BuiltInNodeModules = new Set<string>([
  "_http_agent",
  "_http_client",
  "_http_common",
  "_http_incoming",
  "_http_outgoing",
  "_http_server",
  "_stream_duplex",
  "_stream_passthrough",
  "_stream_readable",
  "_stream_transform",
  "_stream_wrap",
  "_stream_writable",
  "_tls_common",
  "_tls_wrap",
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

// regexp.QuoteMeta
function regexpQuoteMeta(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    switch (c) {
      case 92: // \
      case 46: // .
      case 43: // +
      case 42: // *
      case 63: // ?
      case 40: // (
      case 41: // )
      case 124: // |
      case 91: // [
      case 93: // ]
      case 123: // {
      case 125: // }
      case 94: // ^
      case 36: // $
        out += "\\";
        break;
    }
    out += s[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// helpers/glob.go
// (ported in helpers.mjs)
import { GlobNone, GlobAllExceptSlash, GlobAllIncludingSlash, GlobPart, parseGlobPattern, globPatternToString } from "./helpers.mjs";
export { GlobNone, GlobAllExceptSlash, GlobAllIncludingSlash, GlobPart, parseGlobPattern, globPatternToString };
