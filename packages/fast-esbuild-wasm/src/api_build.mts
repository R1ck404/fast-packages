// pkg/api's build API (api_impl.go contextImpl, internalContext, rebuildImpl,
// loadPlugins and the plugin wrappers, printSummary; api.go Build): used by
// the service (service.mts) for "build" requests and by the CLI.
//
// Go's goroutines are async functions here. A context runs at most one build
// at a time (concurrent rebuilds wait for the active one), like Go's.
//
// Messages of the public API (api.Message) are APIMessage objects; plugin
// callbacks return [result, errorText] (Go: (result, error)).

import { newTimerIfEnabled } from "./timer.mjs";
import { decodeGoString } from "./helpers.mjs";
import { GoPanic } from "./gopanic.mjs";
import * as api from "./cli.mjs";
import {
  Log,
  Msg,
  MsgData,
  MsgLocation,
  Path,
  PrettyPaths,
  RANGE_ZERO,
  API as LoggerAPI,
  GoAPI,
  newDeferLog,
  newStderrLog,
  DeferLogNoVerboseOrDebug,
  Error as MsgError,
  Warning as MsgWarning,
  LevelInfo,
  LevelDebug,
  LevelVerbose,
  LevelSilent,
  OutputOptions,
  msgIDToString,
  convertErrorsAndWarningsToInternal,
  printSummary as loggerPrintSummary,
  SummaryTableEntry,
  writeStdoutBytes,
} from "./logger.mjs";
import { Options as ConfigOptions, OnStart, OnResolve, OnLoad, Plugin as ConfigPlugin, CancelFlag, cancelFlagDidCancel, BuildCall } from "./config.mjs";
import { ImportEntryPoint, ImportStmt, ImportRequire, ImportDynamic, ImportRequireResolve, ImportAt, ImportComposesFrom, ImportURL } from "./ast.mjs";
import { goQuote } from "./gostd.mjs";
import { validateBuildOptions, OnResolveResult as ConfigOnResolveResult, OnLoadResult as ConfigOnLoadResult, outputFileHash, prettyPrintByteCount, compileFilterForPlugin } from "./build.mjs";
import { scanBundle, runOnResolvePlugins, resolveFailureErrorTextSuggestionNotes } from "./bundler_scan.mjs";
import { link } from "./linker.mjs";
import { newCacheSet, newResolver, validatePath } from "./build_deps.mjs";
import { realFS as makeRealFS, RealFSOptions, mkdirAll, osWriteFile, osRemove, osReadFileHost, osGetwd } from "./fs.mjs";
import { validateColor, validateLogLevel, validateLogStyle, validateLogOverrides, extractPathStyle, validateLoader } from "./api_validate.mjs";
import { watcher } from "./watcher.mjs";
import { encodeWTF8 } from "./service_protocol.mjs";

// Go's string(bytes) of bytes from the host (e.g. the stdin contents of a
// build request)
export function goStringFromBytes(bytes: Uint8Array): string {
  return decodeGoString(bytes);
}

// ---------------------------------------------------------------------------
// api.Message

export class APILocation {
  declare file: string;
  declare namespace: string;
  declare line: number; // 1-based
  declare column: number; // 0-based, in bytes
  declare length: number; // in bytes
  declare lineText: string;
  declare suggestion: string;
  constructor(file: string, namespace: string, line: number, column: number, length: number, lineText: string, suggestion: string) {
    this.file = file;
    this.namespace = namespace;
    this.line = line;
    this.column = column;
    this.length = length;
    this.lineText = lineText;
    this.suggestion = suggestion;
  }
}

export class APINote {
  declare text: string;
  declare location: APILocation | null;
  constructor(text: string, location: APILocation | null) {
    this.text = text;
    this.location = location;
  }
}

export class APIMessage {
  declare id: string;
  declare pluginName: string;
  declare text: string;
  declare location: APILocation | null;
  declare notes: APINote[];
  // (Go's interface{}: the int a plugin's message came with, or undefined)
  declare detail: any;
  constructor(id: string, pluginName: string, text: string, location: APILocation | null, notes: APINote[], detail: any) {
    this.id = id;
    this.pluginName = pluginName;
    this.text = text;
    this.location = location;
    this.notes = notes;
    this.detail = detail;
  }
}

function convertLocationToPublic(loc: MsgLocation | null, pathStyle: number): APILocation | null {
  if (loc !== null) {
    return new APILocation(loc.file.select(pathStyle), loc.namespace, loc.line, loc.column, loc.length, loc.lineText, loc.suggestion);
  }
  return null;
}

// api_impl.go convertMessagesToPublic
export function convertMessagesToPublic(kind: number, msgs: Msg[], pathStyle: number): APIMessage[] {
  const filtered: APIMessage[] = [];
  for (const msg of msgs) {
    if (msg.kind === kind) {
      const notes: APINote[] = [];
      if (msg.notes !== null) {
        for (const note of msg.notes) {
          notes.push(new APINote(note.text, convertLocationToPublic(note.location, pathStyle)));
        }
      }
      filtered.push(new APIMessage(msgIDToString(msg.id), msg.pluginName, msg.data.text, convertLocationToPublic(msg.data.location, pathStyle), notes, msg.data.userDetail));
    }
  }
  return filtered;
}

// api_impl.go cloneMangleCache ("mangleCache" is Go's map[string]interface{}:
// the values of a request are strings or booleans)
export function cloneMangleCache(log: Log, mangleCache: Map<string, any> | null): Map<string, any> | null {
  if (mangleCache === null) {
    return null;
  }
  const clone = new Map<string, any>();
  for (const [k, v] of mangleCache) {
    if (v === "__proto__") {
      // This could cause problems for our binary serialization protocol. It's
      // also unnecessary because we already avoid mangling this property name.
      log.addError(null, RANGE_ZERO, "Invalid identifier name " + goQuote(k) + " in mangle cache");
    } else if (typeof v === "string" || v === false) {
      clone.set(k, v);
    } else {
      log.addError(null, RANGE_ZERO, "Expected " + goQuote(k) + " in mangle cache to map to either a string or false");
    }
  }
  return clone;
}

// ---------------------------------------------------------------------------
// api.go types

export class OutputFile {
  declare path: string;
  declare contents: Uint8Array;
  declare hash: string;
  constructor(path: string, contents: Uint8Array, hash: string) {
    this.path = path;
    this.contents = contents;
    this.hash = hash;
  }
}

export class BuildResult {
  declare errors: APIMessage[];
  declare warnings: APIMessage[];
  declare outputFiles: OutputFile[] | null;
  declare metafile: string;
  declare mangleCache: Map<string, string | false> | null;
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.outputFiles = null;
    this.metafile = "";
    this.mangleCache = null;
  }
}

// api.SideEffects
export const SideEffectsTrue = 0;
export const SideEffectsFalse = 1;

// api.ResolveKind
export const ResolveNone = 0;
export const ResolveEntryPoint = 1;
export const ResolveJSImportStatement = 2;
export const ResolveJSRequireCall = 3;
export const ResolveJSDynamicImport = 4;
export const ResolveJSRequireResolve = 5;
export const ResolveCSSImportRule = 6;
export const ResolveCSSComposesFrom = 7;
export const ResolveCSSURLToken = 8;

export class OnStartResult {
  declare errors: APIMessage[];
  declare warnings: APIMessage[];
  constructor(errors: APIMessage[] = [], warnings: APIMessage[] = []) {
    this.errors = errors;
    this.warnings = warnings;
  }
}

export class OnEndResult {
  declare errors: APIMessage[];
  declare warnings: APIMessage[];
  constructor(errors: APIMessage[] = [], warnings: APIMessage[] = []) {
    this.errors = errors;
    this.warnings = warnings;
  }
}

export class OnResolveOptions {
  declare filter: string;
  declare namespace: string;
  constructor(filter: string, namespace: string) {
    this.filter = filter;
    this.namespace = namespace;
  }
}

export class OnResolveArgs {
  declare path: string;
  declare importer: string;
  declare namespace: string;
  declare resolveDir: string;
  declare kind: number;
  declare pluginData: any;
  declare with: Record<string, string>;
  constructor(path: string, importer: string, namespace: string, resolveDir: string, kind: number, pluginData: any, with_: Record<string, string>) {
    this.path = path;
    this.importer = importer;
    this.namespace = namespace;
    this.resolveDir = resolveDir;
    this.kind = kind;
    this.pluginData = pluginData;
    this.with = with_;
  }
}

export class OnResolveResult {
  declare pluginName: string;
  declare errors: APIMessage[];
  declare warnings: APIMessage[];
  declare path: string;
  declare external: boolean;
  declare sideEffects: number; // (SideEffectsTrue is the zero value)
  declare namespace: string;
  declare suffix: string;
  declare pluginData: any;
  declare watchFiles: string[] | null;
  declare watchDirs: string[] | null;
  constructor() {
    this.pluginName = "";
    this.errors = [];
    this.warnings = [];
    this.path = "";
    this.external = false;
    this.sideEffects = SideEffectsTrue;
    this.namespace = "";
    this.suffix = "";
    this.pluginData = null;
    this.watchFiles = null;
    this.watchDirs = null;
  }
}

export class OnLoadOptions {
  declare filter: string;
  declare namespace: string;
  constructor(filter: string, namespace: string) {
    this.filter = filter;
    this.namespace = namespace;
  }
}

export class OnLoadArgs {
  declare path: string;
  declare namespace: string;
  declare suffix: string;
  declare pluginData: any;
  declare with: Record<string, string>;
  constructor(path: string, namespace: string, suffix: string, pluginData: any, with_: Record<string, string>) {
    this.path = path;
    this.namespace = namespace;
    this.suffix = suffix;
    this.pluginData = pluginData;
    this.with = with_;
  }
}

export class OnLoadResult {
  declare pluginName: string;
  declare errors: APIMessage[];
  declare warnings: APIMessage[];
  declare contents: Uint8Array | null;
  declare resolveDir: string;
  declare loader: number; // api.Loader
  declare pluginData: any;
  declare watchFiles: string[] | null;
  declare watchDirs: string[] | null;
  constructor() {
    this.pluginName = "";
    this.errors = [];
    this.warnings = [];
    this.contents = null;
    this.resolveDir = "";
    this.loader = api.LoaderNone;
    this.pluginData = null;
    this.watchFiles = null;
    this.watchDirs = null;
  }
}

export class ResolveOptions {
  declare pluginName: string;
  declare importer: string;
  declare namespace: string;
  declare resolveDir: string;
  declare kind: number;
  declare pluginData: any;
  declare with: Map<string, string> | null;
  constructor() {
    this.pluginName = "";
    this.importer = "";
    this.namespace = "";
    this.resolveDir = "";
    this.kind = ResolveNone;
    this.pluginData = null;
    this.with = null;
  }
}

export class ResolveResult {
  declare errors: APIMessage[];
  declare warnings: APIMessage[];
  declare path: string;
  declare external: boolean;
  declare sideEffects: boolean;
  declare namespace: string;
  declare suffix: string;
  declare pluginData: any;
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.path = "";
    this.external = false;
    this.sideEffects = false;
    this.namespace = "";
    this.suffix = "";
    this.pluginData = null;
  }
}

// Plugin callbacks: async, returning [result, error text or null]
export type OnStartCallback = () => Promise<[OnStartResult, string | null]>;
export type OnEndCallback = (result: BuildResult) => Promise<[OnEndResult, string | null]>;
export type OnResolveCallback = (args: OnResolveArgs) => Promise<[OnResolveResult, string | null]>;
export type OnLoadCallback = (args: OnLoadArgs) => Promise<[OnLoadResult, string | null]>;

export class PluginBuild {
  declare initialOptions: api.BuildOptions;
  declare resolve: (path: string, options: ResolveOptions) => Promise<ResolveResult>;
  declare onStart: (callback: OnStartCallback) => void;
  declare onEnd: (callback: OnEndCallback) => void;
  declare onDispose: (callback: () => void) => void;
  declare onResolve: (options: OnResolveOptions, callback: OnResolveCallback) => void;
  declare onLoad: (options: OnLoadOptions, callback: OnLoadCallback) => void;
}

export class Plugin {
  declare name: string;
  declare setup: (build: PluginBuild) => void;
  constructor(name: string, setup: (build: PluginBuild) => void) {
    this.name = name;
    this.setup = setup;
  }
}

export class WatchOptions {
  declare delay: number;
  constructor(delay = 0) {
    this.delay = delay;
  }
}

// ---------------------------------------------------------------------------
// Build API

class onEndCallback {
  declare pluginName: string;
  declare fn: OnEndCallback;
  constructor(pluginName: string, fn: OnEndCallback) {
    this.pluginName = pluginName;
    this.fn = fn;
  }
}

class rebuildArgs {
  declare caches: any;
  declare onEndCallbacks: onEndCallback[];
  declare onDisposeCallbacks: (() => void)[];
  declare logOptions: OutputOptions;
  declare logWarnings: Msg[];
  declare entryPoints: any[];
  declare options: ConfigOptions;
  declare mangleCache: Map<string, any> | null;
  declare absWorkingDir: string;
  declare write: boolean;
  declare hostFS: any;
  clone(): rebuildArgs {
    const a = new rebuildArgs();
    a.caches = this.caches;
    a.onEndCallbacks = this.onEndCallbacks;
    a.onDisposeCallbacks = this.onDisposeCallbacks;
    a.logOptions = this.logOptions;
    a.logWarnings = this.logWarnings;
    a.entryPoints = this.entryPoints;
    a.options = cloneConfigOptions(this.options);
    a.mangleCache = this.mangleCache;
    a.absWorkingDir = this.absWorkingDir;
    a.write = this.write;
    a.hostFS = this.hostFS;
    return a;
  }
}

function cloneConfigOptions(options: ConfigOptions): ConfigOptions {
  const o = new ConfigOptions();
  for (const key in options) (o as any)[key] = (options as any)[key];
  return o;
}

export class rebuildState {
  declare result: BuildResult;
  declare watchData: any;
  declare options: ConfigOptions | null;
  constructor(result = new BuildResult(), watchData: any = null, options: ConfigOptions | null = null) {
    this.result = result;
    this.watchData = watchData;
    this.options = options;
  }
}

// contextImpl. "hostFS" is the file system Go's "os" package uses (Node's fs
// module, or null for esbuild-wasm's ENOSYS stub in a browser).
export function contextImpl(buildOpts: api.BuildOptions, hostFS: any): [internalContext | null, APIMessage[]] {
  const logOptions = new OutputOptions(
    buildOpts.logLimit,
    true,
    validateColor(buildOpts.color),
    validateLogLevel(buildOpts.logLevel),
    validateLogStyle(buildOpts.logStyle),
    extractPathStyle(buildOpts.absPaths, api.LogAbsPath),
    validateLogOverrides(buildOpts.logOverride),
  );

  // Validate that the current working directory is an absolute path
  const absWorkingDir = buildOpts.absWorkingDir;
  // This is a long-lived file system object so do not cache calls to
  // ReadDirectory() (they are normally cached for the duration of a build
  // for performance).
  const [realFS, err] = makeRealFS(new RealFSOptions(absWorkingDir, false, true), hostFS);
  if (err !== null) {
    const log = newStderrLog(logOptions);
    log.addError(null, RANGE_ZERO, err);
    const msgs = log.done();
    log.flushStderr();
    return [null, convertMessagesToPublic(MsgError, msgs, logOptions.pathStyle)];
  }

  // Do not re-evaluate plugins when rebuilding. Also make sure the working
  // directory doesn't change, since breaking that invariant would break the
  // validation that we just did above.
  const caches = newCacheSet();
  const log = newDeferLog(DeferLogNoVerboseOrDebug, logOptions.overrides);
  const [onEndCallbacks, onDisposeCallbacks, finalizeBuildOptions] = loadPlugins(buildOpts, realFS, log, caches);
  const [options, entryPoints] = validateBuildOptions(buildOpts, log, realFS);
  finalizeBuildOptions(options);
  if (buildOpts.absWorkingDir !== absWorkingDir) {
    throw new GoPanic('Mutating "AbsWorkingDir" is not allowed');
  }

  // If we have errors already, then refuse to build any further. This only
  // happens when the build options themselves contain validation errors.
  const msgs = log.done();
  if (log.hasErrors()) {
    if (logOptions.logLevel < LevelSilent) {
      // Print all deferred validation log messages to stderr. We defer all log
      // messages that are generated above because warnings are re-printed for
      // every rebuild and we don't want to double-print these warnings for the
      // first build.
      const stderr = newStderrLog(logOptions);
      for (const msg of msgs) {
        stderr.addMsg(msg);
      }
      stderr.done();
      stderr.flushStderr();
    }
    return [null, convertMessagesToPublic(MsgError, msgs, options.logPathStyle)];
  }

  const args = new rebuildArgs();
  args.caches = caches;
  args.onEndCallbacks = onEndCallbacks;
  args.onDisposeCallbacks = onDisposeCallbacks;
  args.logOptions = logOptions;
  args.logWarnings = msgs;
  args.entryPoints = entryPoints;
  args.options = options;
  args.mangleCache = buildOpts.mangleCache;
  args.absWorkingDir = absWorkingDir;
  args.write = buildOpts.write;
  args.hostFS = hostFS;

  return [new internalContext(args, realFS, absWorkingDir), []];
}

class buildInProgress {
  declare state: rebuildState;
  declare done: Promise<void>;
  declare resolve: () => void;
  declare cancel: CancelFlag;
  constructor() {
    this.state = new rebuildState();
    this.done = new Promise((resolve) => (this.resolve = resolve));
    this.cancel = new CancelFlag();
  }
}

export class internalContext {
  declare args: rebuildArgs;
  declare activeBuild: buildInProgress | null;
  declare recentBuild: BuildResult | null;
  declare realFS: any;
  declare absWorkingDir: string;
  declare watcher: watcher | null;
  declare didDispose: boolean;

  // This saves just enough information to be able to compute a useful diff
  // between two sets of output files. That way we don't need to hold both
  // sets of output files in memory at once to compute a diff.
  declare latestHashes: Map<string, string> | null;

  constructor(args: rebuildArgs, realFS: any, absWorkingDir: string) {
    this.args = args;
    this.activeBuild = null;
    this.recentBuild = null;
    this.realFS = realFS;
    this.absWorkingDir = absWorkingDir;
    this.watcher = null;
    this.didDispose = false;
    this.latestHashes = null;
  }

  async rebuild(): Promise<rebuildState> {
    const ctx = this;

    // Ignore disposed contexts
    if (ctx.didDispose) {
      return new rebuildState();
    }

    // If there's already an active build, just return that build's result
    const active = ctx.activeBuild;
    if (active !== null) {
      await active.done;
      return active.state;
    }

    // Otherwise, start a new build
    const build = new buildInProgress();
    ctx.activeBuild = build;
    const args = ctx.args.clone();
    const watcher = ctx.watcher;
    const oldHashes = ctx.latestHashes;
    args.options.cancelFlag = build.cancel;

    // Do the build
    const [state, newHashes] = await rebuildImpl(args, oldHashes);
    build.state = state;
    if (watcher !== null) {
      watcher.setWatchData(build.state.watchData);
    }

    // Store the recent build for the dev server
    const recentBuild = build.state.result;
    ctx.activeBuild = null;
    ctx.recentBuild = recentBuild;
    ctx.latestHashes = newHashes;

    // Clear the recent build after it goes stale
    const timer = setTimeout(() => {
      if (ctx.recentBuild === recentBuild) {
        ctx.recentBuild = null;
      }
    }, 250);
    unrefTimer(timer);

    build.resolve();
    return build.state;
  }

  async Rebuild(): Promise<BuildResult> {
    return (await this.rebuild()).result;
  }

  // Returns an error text or null
  Watch(options: WatchOptions): string | null {
    const ctx = this;

    // Ignore disposed contexts
    if (ctx.didDispose) {
      return "Cannot watch a disposed context";
    }

    // Don't allow starting watch mode multiple times
    if (ctx.watcher !== null) {
      return "Watch mode has already been enabled";
    }

    const logLevel = ctx.args.logOptions.logLevel;
    ctx.watcher = new watcher(
      ctx.realFS,
      logLevel === LevelInfo || logLevel === LevelDebug || logLevel === LevelVerbose,
      ctx.args.logOptions.color,
      ctx.args.logOptions.pathStyle,
      async () => (await ctx.rebuild()).watchData,
      options.delay,
    );

    // All subsequent builds will be watch mode builds
    ctx.args.options.watchMode = true;

    // Start the file watcher
    ctx.watcher.start();

    // Do the first watch mode build on another goroutine
    (async () => {
      await null; // (it runs once this goroutine blocks)
      const build = ctx.activeBuild;

      // If there's an active build, then it's not a watch build. Wait for it to
      // finish first so we don't just get this build when we call "Rebuild()".
      if (build !== null) {
        await build.done;
      }

      // Trigger a rebuild now that we know all future builds will pick up on
      // our watcher. This build will populate the initial watch data, which is
      // necessary to be able to know what file system changes are relevant.
      await ctx.Rebuild();
    })();
    return null;
  }

  // serve_wasm.go: the serve API is not in the WebAssembly build
  Serve(options: api.ServeOptions): [any, string | null] {
    return [null, 'The "serve" API is not supported when using WebAssembly'];
  }

  async Cancel(): Promise<void> {
    const ctx = this;

    // Ignore disposed contexts
    if (ctx.didDispose) {
      return;
    }

    const build = ctx.activeBuild;

    if (build !== null) {
      // Tell observers to cut this build short
      build.cancel.cancel();

      // Wait for the build to finish before returning
      await build.done;
    }
  }

  async Dispose(): Promise<void> {
    const ctx = this;

    // Only dispose once
    if (ctx.didDispose) {
      return;
    }
    ctx.didDispose = true;
    ctx.recentBuild = null;
    const build = ctx.activeBuild;

    if (ctx.watcher !== null) {
      await ctx.watcher.stop();
    }

    // It's important to wait for the build to finish before returning. The JS
    // API will unregister its callbacks when it returns. If that happens while
    // the build is still in progress, that might cause the JS API to generate
    // errors when we send it events (e.g. when it runs "onEnd" callbacks) that
    // we then print to the terminal, which would be confusing.
    if (build !== null) {
      await build.done;
    }

    // Run each "OnDispose" callback on its own goroutine
    for (const fn of ctx.args.onDisposeCallbacks) {
      queueMicrotask(fn);
    }
  }
}

// Timers must not keep a Node process alive (Go's goroutines don't)
export function unrefTimer(timer: any) {
  if (timer !== null && typeof timer === "object" && typeof timer.unref === "function") timer.unref();
}

// api.go Build
export async function build(options: api.BuildOptions, hostFS: any): Promise<BuildResult> {
  const start = Date.now();

  const [ctx, errors] = contextImpl(options, hostFS);
  if (ctx === null) {
    const result = new BuildResult();
    result.errors = errors;
    return result;
  }

  const result = await ctx.Rebuild();

  if (ctx.args.logOptions.logLevel <= LevelInfo && !ctx.args.options.writeToStdout) {
    printSummary(ctx.args.logOptions.color, result.outputFiles === null ? [] : result.outputFiles, start, hostFS);
  }

  await ctx.Dispose();
  return result;
}

function printSummary(color: number, outputFiles: OutputFile[], start: number, hostFS: any) {
  if (outputFiles.length === 0) {
    return;
  }

  const table: SummaryTableEntry[] = new Array(outputFiles.length);
  for (let i = 0; i < table.length; i++) table[i] = new SummaryTableEntry();

  const cwd = osGetwd(hostFS);
  if (cwd !== null) {
    const [realFS, err] = makeRealFS(new RealFSOptions(cwd), hostFS);
    if (err === null) {
      for (let i = 0; i < outputFiles.length; i++) {
        const file = outputFiles[i];
        let [path, ok] = realFS.rel(realFS.cwd(), file.path);
        if (!ok) {
          path = file.path;
        }
        const base = realFS.base(path);
        const n = file.contents.length;
        table[i] = new SummaryTableEntry(path.slice(0, path.length - base.length), base, prettyPrintByteCount(n), n, base.endsWith(".map"));
      }
    }
  }

  // Don't print the time taken by the build if we're running under Yarn 1
  // since Yarn 1 always prints its own copy of the time taken by each command
  const userAgent = lookupEnv("npm_config_user_agent");
  if (userAgent !== undefined) {
    if (userAgent.includes("yarn/1.")) {
      loggerPrintSummary(color, table, null);
      return;
    }
  }

  loggerPrintSummary(color, table, start);
}

// os.LookupEnv. The Go process's environment is set by the host: in Node,
// what bin/esbuild keeps of the process's (NO_COLOR, NODE_PATH,
// npm_config_user_agent and WT_SESSION); nothing in a browser (esbuild-wasm's
// go.env is empty).
let goEnv: Map<string, string> = new Map();
export function setGoEnv(env: Map<string, string>) {
  goEnv = env;
}
export function lookupEnv(name: string): string | undefined {
  return goEnv.get(name);
}

async function rebuildImpl(args: rebuildArgs, oldHashes: Map<string, string> | null): Promise<[rebuildState, Map<string, string>]> {
  const log = newStderrLog(args.logOptions);

  // All validation warnings are repeated for every rebuild
  for (const msg of args.logWarnings) {
    log.addMsg(msg);
  }

  // Convert and validate the buildOpts
  const [realFS, err] = makeRealFS(new RealFSOptions(args.absWorkingDir, args.options.watchMode, false), args.hostFS);
  if (err !== null) {
    // This should already have been checked by the caller
    throw new GoPanic(err);
  }

  const result = new BuildResult();
  let watchData: any = null;
  let toWriteToStdout: Uint8Array | null = null;

  const timer = newTimerIfEnabled();

  // Scan over the bundle
  const bundle = await scanBundle(BuildCall, log, realFS, args.caches, args.entryPoints, args.options, timer);
  watchData = realFS.watchData();
  const newHashes = new Map<string, string>();

  // Stop now if there were errors
  let results: any[] = [];
  let metafile = "";
  if (!log.hasErrors()) {
    // Compile the bundle
    result.mangleCache = cloneMangleCache(log, args.mangleCache);
    [results, metafile] = bundle.compile(log, timer, result.mangleCache, link);

    // Canceling a build generates a single error at the end of the build
    if (cancelFlagDidCancel(args.options.cancelFlag)) {
      log.addError(null, RANGE_ZERO, "The build was canceled");
    }

    // Stop now if there were errors
    if (!log.hasErrors()) {
      result.metafile = metafile;

      // Populate the results to return
      result.outputFiles = new Array(results.length);
      for (let i = 0; i < results.length; i++) {
        const item = results[i];
        if (args.options.writeToStdout) {
          item.absPath = "<stdout>";
        }
        const contents = typeof item.contents === "string" ? encodeWTF8(item.contents) : item.contents;
        item.contents = contents;
        const hash = outputFileHash(contents);
        result.outputFiles[i] = new OutputFile(item.absPath, contents, hash);
        newHashes.set(item.absPath, hash);
      }
    }
  }

  // Write output files before "OnEnd" callbacks run so they can expect
  // output files to exist on the file system. "OnEnd" callbacks can be
  // used to move output files to a different location after the build.
  if (args.write) {
    timer?.begin("Write output files");
    if (args.options.writeToStdout) {
      // Special-case writing to stdout
      if (log.hasErrors()) {
        // No output is printed if there were any build errors
      } else if (results.length !== 1) {
        log.addError(null, RANGE_ZERO, "Internal error: did not expect to generate " + results.length + " files when writing to stdout");
      } else {
        // Print this later on, at the end of the current function
        toWriteToStdout = results[0].contents;
      }
    } else {
      // Delete old files that are no longer relevant
      const toDelete: string[] = [];
      if (oldHashes !== null) {
        for (const absPath of oldHashes.keys()) {
          if (!newHashes.has(absPath)) {
            toDelete.push(absPath);
          }
        }
      }

      // Only write output files if there were no errors. See this issue
      // for why: https://github.com/evanw/esbuild/issues/3643
      const shouldWriteFiles = !log.hasErrors();

      // (Go processes all file operations in parallel)
      for (const item of results) {
        if (!shouldWriteFiles) {
          break;
        }
        const oldHash = oldHashes !== null ? oldHashes.get(item.absPath) : undefined;
        if (oldHash !== undefined && oldHash === newHashes.get(item.absPath)) {
          const [contents, readErr] = osReadFileHost(args.hostFS, item.absPath);
          if (readErr === null && bytesEqual(contents, item.contents)) {
            // Skip writing out files that haven't changed since last time
            continue;
          }
        }
        const mkdirErr = mkdirAll(realFS, args.hostFS, realFS.dir(item.absPath), 0o755);
        if (mkdirErr !== null) {
          log.addError(null, RANGE_ZERO, "Failed to create output directory: " + mkdirErr.error());
        } else {
          let mode = 0o666;
          if (item.isExecutable) {
            mode = 0o777;
          }
          const writeErr = osWriteFile(args.hostFS, item.absPath, item.contents, mode);
          if (writeErr !== null) {
            log.addError(null, RANGE_ZERO, "Failed to write to output file: " + writeErr.error());
          }
        }
      }
      for (const absPath of toDelete) {
        osRemove(args.hostFS, absPath);
      }
    }
    timer?.end("Write output files");
  }

  // Only return the mangle cache for a successful build
  if (log.hasErrors()) {
    result.mangleCache = null;
  }

  // Populate the result object with the messages so far
  const msgs = log.peek();
  result.errors = convertMessagesToPublic(MsgError, msgs, args.options.logPathStyle);
  result.warnings = convertMessagesToPublic(MsgWarning, msgs, args.options.logPathStyle);

  // Run any registered "OnEnd" callbacks now. These always run regardless of
  // whether the current build has bee canceled or not. They can check for
  // errors by checking the error array in the build result, and canceled
  // builds should always have at least one error.
  timer?.begin("On-end callbacks");
  for (const onEnd of args.onEndCallbacks) {
    const [fromPlugin, thrown] = await onEnd.fn(result);

    // Report errors and warnings generated by the plugin
    for (const e of fromPlugin.errors) {
      if (e.pluginName === "") {
        e.pluginName = onEnd.pluginName;
      }
    }
    for (const w of fromPlugin.warnings) {
      if (w.pluginName === "") {
        w.pluginName = onEnd.pluginName;
      }
    }

    // Report errors thrown by the plugin itself
    if (thrown !== null) {
      fromPlugin.errors.push(new APIMessage("", onEnd.pluginName, thrown, null, [], undefined));
    }

    // Log any errors and warnings generated above
    for (const msg of convertErrorsAndWarningsToInternal(fromPlugin.errors, fromPlugin.warnings)) {
      log.addMsg(msg);
    }

    // Add the errors and warnings to the result object
    for (const e of fromPlugin.errors) result.errors.push(e);
    for (const w of fromPlugin.warnings) result.warnings.push(w);

    // Stop if an "onEnd" callback failed. This counts as a build failure.
    if (fromPlugin.errors.length > 0) {
      break;
    }
  }
  timer?.end("On-end callbacks");

  // Log timing information now that we're all done
  timer?.log(log);

  // End the log after "OnEnd" callbacks have added any additional errors and/or
  // warnings. This may may print any warnings that were deferred up until this
  // point, as well as a message with the number of errors and/or warnings
  // omitted due to the configured log limit.
  log.done();
  log.flushStderr();

  // Only write to stdout after the log has been finalized. We want this output
  // to show up in the terminal after the message that was printed above.
  if (toWriteToStdout !== null) {
    writeStdoutBytes(toWriteToStdout);
  }

  return [new rebuildState(result, watchData, args.options), newHashes];
}

function bytesEqual(a: Uint8Array | null, b: Uint8Array): boolean {
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Plugin API

class pluginImpl {
  declare log: Log;
  declare fs: any;
  declare plugin: ConfigPlugin;
  constructor(log: Log, fs: any, plugin: ConfigPlugin) {
    this.log = log;
    this.fs = fs;
    this.plugin = plugin;
  }

  onStart(callback: OnStartCallback) {
    const impl = this;
    impl.plugin.onStart.push(
      new OnStart(async () => {
        const [response, err] = await callback();
        if (err !== null) {
          return { msgs: [], thrownError: err };
        }

        // Convert log messages
        return { msgs: convertErrorsAndWarningsToInternal(response.errors, response.warnings), thrownError: null };
      }, impl.plugin.name),
    );
  }

  onResolve(options: OnResolveOptions, callback: OnResolveCallback) {
    const impl = this;
    const [filter, err] = compileFilterForPlugin(impl.plugin.name, "OnResolve", options.filter);
    if (filter === null) {
      impl.log.addError(null, RANGE_ZERO, err!);
      return;
    }

    impl.plugin.onResolve.push(
      new OnResolve(
        filter,
        async (args: any): Promise<ConfigOnResolveResult> => {
          const result = new ConfigOnResolveResult();
          let [response, err] = await callback(
            new OnResolveArgs(args.path, args.importer.text, args.importer.namespace, args.resolveDir, importKindToResolveKind(args.kind), args.pluginData, args.withMap),
          );
          result.pluginName = response.pluginName;
          result.absWatchFiles = impl.validatePathsArray(response.watchFiles, "watch file");
          result.absWatchDirs = impl.validatePathsArray(response.watchDirs, "watch directory");

          // Restrict the suffix to start with "?" or "#" for now to match esbuild's behavior
          if (err === null && response.suffix !== "" && response.suffix[0] !== "?" && response.suffix[0] !== "#") {
            err = "Invalid path suffix " + goQuote(response.suffix) + ' returned from plugin (must start with "?" or "#")';
          }

          if (err !== null) {
            result.thrownError = err;
            return result;
          }

          result.path = new Path(response.path, response.namespace, response.suffix);
          result.external = response.external;
          result.isSideEffectFree = response.sideEffects === SideEffectsFalse;
          result.pluginData = response.pluginData;

          // Convert log messages
          result.msgs = convertErrorsAndWarningsToInternal(response.errors, response.warnings);

          // Warn if the plugin returned things without resolving the path
          if (response.path === "" && !response.external) {
            let what = "";
            if (response.namespace !== "") {
              what = "namespace";
            } else if (response.suffix !== "") {
              what = "suffix";
            } else if (response.pluginData !== null) {
              what = "pluginData";
            } else if (response.watchFiles !== null) {
              what = "watchFiles";
            } else if (response.watchDirs !== null) {
              what = "watchDirs";
            }
            if (what !== "") {
              let path = "path";
              if (LoggerAPI.kind === GoAPI) {
                what = what[0].toUpperCase() + what.slice(1);
                path = "Path";
              }
              result.msgs.push(new Msg(null, "", new MsgData(undefined, null, "Returning " + goQuote(what) + " doesn't do anything when " + goQuote(path) + " is empty"), MsgWarning));
            }
          }
          return result;
        },
        impl.plugin.name,
        options.namespace,
      ),
    );
  }

  onLoad(options: OnLoadOptions, callback: OnLoadCallback) {
    const impl = this;
    const [filter, err] = compileFilterForPlugin(impl.plugin.name, "OnLoad", options.filter);
    if (filter === null) {
      impl.log.addError(null, RANGE_ZERO, err!);
      return;
    }

    impl.plugin.onLoad.push(
      new OnLoad(
        filter,
        async (args: any): Promise<ConfigOnLoadResult> => {
          const result = new ConfigOnLoadResult();
          const [response, err] = await callback(new OnLoadArgs(args.path.text, args.path.namespace, args.path.ignoredSuffix, args.pluginData, args.withMap));
          result.pluginName = response.pluginName;
          result.absWatchFiles = impl.validatePathsArray(response.watchFiles, "watch file");
          result.absWatchDirs = impl.validatePathsArray(response.watchDirs, "watch directory");

          if (err !== null) {
            result.thrownError = err;
            return result;
          }

          result.contents = response.contents;
          result.loader = validateLoader(response.loader);
          result.pluginData = response.pluginData;
          const pathKind = "resolve directory path for plugin " + goQuote(impl.plugin.name);
          const absPath = validatePath(impl.log, impl.fs, response.resolveDir, pathKind);
          if (absPath !== "") {
            result.absResolveDir = absPath;
          }

          // Convert log messages
          result.msgs = convertErrorsAndWarningsToInternal(response.errors, response.warnings);
          return result;
        },
        impl.plugin.name,
        options.namespace,
      ),
    );
  }

  validatePathsArray(pathsIn: string[] | null, name: string): string[] | null {
    let pathsOut: string[] | null = null;
    if (pathsIn !== null && pathsIn.length > 0) {
      const pathKind = name + " path for plugin " + goQuote(this.plugin.name);
      for (const relPath of pathsIn) {
        const absPath = validatePath(this.log, this.fs, relPath, pathKind);
        if (absPath !== "") {
          if (pathsOut === null) pathsOut = [];
          pathsOut.push(absPath);
        }
      }
    }
    return pathsOut;
  }
}

// logger.EncodeImportAttributes(with).DecodeIntoMap() as the object the
// scanner passes along
function withObject(value: Map<string, string> | null): Record<string, string> {
  const obj: Record<string, string> = {};
  if (value !== null) {
    for (const k of [...value.keys()].sort()) {
      if (k === "__proto__") Object.defineProperty(obj, k, { value: value.get(k), enumerable: true, writable: true, configurable: true });
      else obj[k] = value.get(k)!;
    }
  }
  return obj;
}

function importKindToResolveKind(kind: number): number {
  switch (kind) {
    case ImportEntryPoint:
      return ResolveEntryPoint;
    case ImportStmt:
      return ResolveJSImportStatement;
    case ImportRequire:
      return ResolveJSRequireCall;
    case ImportDynamic:
      return ResolveJSDynamicImport;
    case ImportRequireResolve:
      return ResolveJSRequireResolve;
    case ImportAt:
      return ResolveCSSImportRule;
    case ImportComposesFrom:
      return ResolveCSSComposesFrom;
    case ImportURL:
      return ResolveCSSURLToken;
  }
  throw new GoPanic("Internal error");
}

function resolveKindToImportKind(kind: number): number {
  switch (kind) {
    case ResolveEntryPoint:
      return ImportEntryPoint;
    case ResolveJSImportStatement:
      return ImportStmt;
    case ResolveJSRequireCall:
      return ImportRequire;
    case ResolveJSDynamicImport:
      return ImportDynamic;
    case ResolveJSRequireResolve:
      return ImportRequireResolve;
    case ResolveCSSImportRule:
      return ImportAt;
    case ResolveCSSComposesFrom:
      return ImportComposesFrom;
    case ResolveCSSURLToken:
      return ImportURL;
  }
  throw new GoPanic("Internal error");
}

// Returns [onEndCallbacks, onDisposeCallbacks, finalizeBuildOptions]
function loadPlugins(initialOptions: api.BuildOptions, fs: any, log: Log, caches: any): [onEndCallback[], (() => void)[], (options: ConfigOptions) => void] {
  // Clone the plugin array to guard against mutation during iteration
  const clone = initialOptions.plugins === null ? [] : initialOptions.plugins.slice();

  let optionsForResolve: ConfigOptions | null = null;
  const plugins: ConfigPlugin[] = [];
  const onEndCallbacks: onEndCallback[] = [];
  const onDisposeCallbacks: (() => void)[] = [];

  // This is called after the build options have been validated
  const finalizeBuildOptions = (options: ConfigOptions) => {
    options.plugins = plugins;
    optionsForResolve = options;
  };

  for (let i = 0; i < clone.length; i++) {
    const item = clone[i];
    if (item.name === "") {
      log.addError(null, RANGE_ZERO, "Plugin at index " + i + " is missing a name");
      continue;
    }

    const impl = new pluginImpl(log, fs, new ConfigPlugin(item.name));

    const resolve = async (path: string, options: ResolveOptions): Promise<ResolveResult> => {
      const result = new ResolveResult();

      // If options are missing, then this is being called before plugin setup
      // has finished. That isn't allowed because plugin setup is allowed to
      // change the initial options object, which can affect path resolution.
      if (optionsForResolve === null) {
        result.errors = [new APIMessage("", "", 'Cannot call "resolve" before plugin setup has completed', null, [], undefined)];
        return result;
      }

      if (options.kind === ResolveNone) {
        result.errors = [new APIMessage("", "", 'Must specify "kind" when calling "resolve"', null, [], undefined)];
        return result;
      }

      // Make a new resolver so it has its own log
      const log = newDeferLog(DeferLogNoVerboseOrDebug, validateLogOverrides(initialOptions.logOverride));
      const optionsClone = cloneConfigOptions(optionsForResolve);
      const resolver = newResolver(BuildCall, fs, log, caches, optionsClone);

      // Make sure the resolve directory is an absolute path, which can fail
      const absResolveDir = validatePath(log, fs, options.resolveDir, "resolve directory");
      if (log.hasErrors()) {
        const msgs = log.done();
        result.errors = convertMessagesToPublic(MsgError, msgs, optionsClone.logPathStyle);
        result.warnings = convertMessagesToPublic(MsgWarning, msgs, optionsClone.logPathStyle);
        return result;
      }

      // Run path resolution
      const kind = resolveKindToImportKind(options.kind);
      const [resolveResult] = await runOnResolvePlugins(
        plugins,
        resolver,
        log,
        fs,
        caches,
        null, // importSource
        RANGE_ZERO, // importPathRange
        new Path(options.importer, options.namespace),
        path,
        withObject(options.with),
        kind,
        absResolveDir,
        options.pluginData,
        optionsClone.logPathStyle,
      );
      const msgs = log.done();

      // Populate the result
      result.errors = convertMessagesToPublic(MsgError, msgs, optionsClone.logPathStyle);
      result.warnings = convertMessagesToPublic(MsgWarning, msgs, optionsClone.logPathStyle);
      if (resolveResult !== null) {
        result.path = resolveResult.pathPair.primary.text;
        result.external = resolveResult.pathPair.isExternal;
        result.sideEffects = resolveResult.primarySideEffectsData === null;
        result.namespace = resolveResult.pathPair.primary.namespace;
        result.suffix = resolveResult.pathPair.primary.ignoredSuffix;
        result.pluginData = resolveResult.pluginData;
      } else if (result.errors.length === 0) {
        // Always fail with at least one error
        let pluginName = item.name;
        if (options.pluginName !== "") {
          pluginName = options.pluginName;
        }
        const [text, , notes] = resolveFailureErrorTextSuggestionNotes(
          resolver,
          path,
          kind,
          pluginName,
          fs,
          absResolveDir,
          optionsForResolve.platform,
          new PrettyPaths(),
          "",
          optionsClone.logPathStyle,
        );
        for (const m of convertMessagesToPublic(MsgError, [new Msg(notes, "", new MsgData(undefined, null, text))], optionsClone.logPathStyle)) {
          result.errors.push(m);
        }
      }
      return result;
    };

    const build = new PluginBuild();
    build.initialOptions = initialOptions;
    build.resolve = resolve;
    build.onStart = (fn) => impl.onStart(fn);
    build.onEnd = (fn) => {
      onEndCallbacks.push(new onEndCallback(item.name, fn));
    };
    build.onDispose = (fn) => {
      onDisposeCallbacks.push(fn);
    };
    build.onResolve = (options, fn) => impl.onResolve(options, fn);
    build.onLoad = (options, fn) => impl.onLoad(options, fn);
    item.setup(build);

    plugins.push(impl.plugin);
  }

  return [onEndCallbacks, onDisposeCallbacks, finalizeBuildOptions];
}
