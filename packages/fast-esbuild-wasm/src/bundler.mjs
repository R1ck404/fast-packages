// Port of the transform subset of internal/bundler/bundler.go (ScanBundle for
// config.TransformCall, parseFile for the stdin file, the runtime cache,
// Bundle.Compile) plus the result selection of pkg/api's transformImpl.
//
// In a transform there is no resolver and there are no plugins: the scan
// phase parses exactly two files, the runtime (source index 0, cached per
// runtime-affecting options like Go's globalRuntimeCache) and the stdin file
// (source index 1). Import records are never resolved (that only happens in
// ModeBundle), so every import path stays external except the parser-generated
// "<runtime>" import, whose source index the parser pre-fills.
import { BAIL, bail } from "./bail.mjs";
import { Log, Path, PrettyPaths, Source, RANGE_ZERO, platformIndependentPathDirBaseExt } from "./logger.mjs";
import { ImportRequire, ImportStmt } from "./ast.mjs";
import {
  Options as ConfigOptions,
  TSOptions,
  TransformCall,
  ModeBundle,
  PlatformBrowser,
  SourceMapNone,
  LoaderNone,
  LoaderDefault,
  LoaderJS,
  LoaderJSX,
  LoaderTS,
  LoaderTSNoAmbiguousLessThan,
  LoaderTSX,
  LoaderEmpty,
  LoaderCSS,
  LoaderLocalCSS,
  LoaderJSON,
  LoaderText,
} from "./config.mjs";
import {
  ModuleTypeData,
  ModuleUnknown,
  ModuleESM_MJS,
  ModuleESM_MTS,
  ModuleCommonJS_CJS,
  ModuleCommonJS_CTS,
  generateNonUniqueNameFromPath,
} from "./js_ast.mjs";
import { parse, optionsFromConfig } from "./js_parser.mjs";
import { source as runtimeSource } from "./runtime.mjs";
import { InputFile, JSRepr, EntryPoint, SideEffects, NoSideEffects_EmptyAST, markASTShared } from "./graph.mjs";
import { link, loaderCanHaveSourceMap } from "./linker.mjs";
import { generateLineOffsetTables, quoteForJSONLong } from "./sourcemap.mjs";
import { applyTSConfigOverride } from "./tsconfig.mjs";

const RUNTIME_SOURCE_INDEX = 0; // runtime.SourceIndex

// ---------------------------------------------------------------------------
// Go stdlib / mock file system helpers used by the transform path

// Go's path.Clean (Unix semantics)
function goPathClean(path) {
  if (path === "") return ".";

  const rooted = path.charCodeAt(0) === 47; /* '/' */
  const n = path.length;
  const out = [];
  let r = 0;
  let dotdot = 0;
  if (rooted) {
    out.push("/");
    r = 1;
    dotdot = 1;
  }

  while (r < n) {
    const c = path.charCodeAt(r);
    if (c === 47) {
      // empty path element
      r++;
    } else if (c === 46 && (r + 1 === n || path.charCodeAt(r + 1) === 47)) {
      // . element
      r++;
    } else if (c === 46 && path.charCodeAt(r + 1) === 46 && (r + 2 === n || path.charCodeAt(r + 2) === 47)) {
      // .. element: remove to last /
      r += 2;
      if (out.length > dotdot) {
        // can backtrack
        out.pop();
        while (out.length > dotdot && out[out.length - 1] !== "/") out.pop();
      } else if (!rooted) {
        // cannot backtrack, but not rooted, so append .. element.
        if (out.length > 0) out.push("/");
        out.push(".", ".");
        dotdot = out.length;
      }
    } else {
      // real path element.
      // add slash if needed
      if ((rooted && out.length !== 1) || (!rooted && out.length !== 0)) out.push("/");
      // copy element
      for (; r < n && path.charCodeAt(r) !== 47; r++) out.push(path[r]);
    }
  }

  // Turn empty string into "."
  if (out.length === 0) return ".";
  return out.join("");
}

function splitOnSlash(path) {
  const slash = path.indexOf("/");
  if (slash !== -1) return [path.slice(0, slash), path.slice(slash + 1)];
  return [path, ""];
}

// fs.MockFS(..., fs.MockUnix, "/").Rel(base, target) -> [relPath, ok]
function mockRel(base, target) {
  base = goPathClean(base);
  target = goPathClean(target);

  // Go's implementation does these checks
  if (base === target) return [".", true];
  if (base === ".") base = "";

  // Go's implementation fails when this condition is false. I believe this is
  // because of this part of the contract, from Go's documentation: "An error
  // is returned if targpath can't be made relative to basepath or if knowing
  // the current working directory would be necessary to compute it."
  if ((base.length > 0 && base.charCodeAt(0) === 47) !== (target.length > 0 && target.charCodeAt(0) === 47)) {
    return ["", false];
  }

  // Find the common parent directory
  for (;;) {
    const $d219 = splitOnSlash(base);
    const bHead = $d219[0], bTail = $d219[1];
    const $d220 = splitOnSlash(target);
    const tHead = $d220[0], tTail = $d220[1];
    if (bHead !== tHead) break;
    base = bTail;
    target = tTail;
  }

  // Stop now if base is a subpath of target
  if (base === "") return [target, true];

  // Traverse up to the common parent
  const commonParent = "../".repeat(base.split("/").length);

  // Stop now if target is a subpath of base
  if (target === "") return [commonParent.slice(0, commonParent.length - 1), true];

  // Otherwise, down to the parent
  return [commonParent + target, true];
}

// resolver.MakePrettyPaths
function makePrettyPaths(path) {
  let absPath = path.text;
  let relPath = path.text;

  if (path.namespace === "file") {
    bail(); // (transforms never create "file" namespace paths)
  } else if (path.namespace !== "") {
    absPath = path.namespace + ":" + absPath;
    relPath = path.namespace + ":" + relPath;
  }

  if (path.isDisabled()) {
    absPath = "(disabled):" + absPath;
    relPath = "(disabled):" + relPath;
  }

  return new PrettyPaths(absPath + path.ignoredSuffix, relPath + path.ignoredSuffix);
}

// ---------------------------------------------------------------------------
// Scan phase

class scannerFile {
  ;                                 
  ;                       
  ;                      
  constructor(inputFile) {
    this.jsonMetadataChunk = "";
    this.pluginData = null;
    this.inputFile = inputFile;
  }
}

class tlaCheck {
  ;                      
  ;                     
  ;                    
  ;                                 
  constructor() {
    this.parent = -1; // Index32
    this.depth = -1; // Index32
    this.pass = 0;
    this.importRecordIndex = 0;
  }
}

class parseResult {
  ;                 
  ;                          
  ;                   
  constructor(file = null, ok = false) {
    this.file = file; // scannerFile
    this.tlaCheck = new tlaCheck();
    this.ok = ok;
  }
}

// ast.Index32.GetIndex() on an invalid index is ^uint32(0)
function index32GetIndex(index) {
  return index < 0 ? 0xffffffff : index;
}

export function defaultExtensionToLoaderMap() {
  return new Map([
    ["", LoaderJS], // This represents files without an extension
    [".js", LoaderJS],
    [".mjs", LoaderJS],
    [".cjs", LoaderJS],
    [".jsx", LoaderJSX],
    [".ts", LoaderTS],
    [".cts", LoaderTSNoAmbiguousLessThan],
    [".mts", LoaderTSNoAmbiguousLessThan],
    [".tsx", LoaderTSX],
    [".css", LoaderCSS],
    [".module.css", LoaderLocalCSS],
    [".json", LoaderJSON],
    [".txt", LoaderText],
  ]);
}

// Never mutated, so it can be shared by all transforms
const defaultExtensionToLoader = defaultExtensionToLoaderMap();

// config.LoaderFromFileExtension
function loaderFromFileExtension(extensionToLoader, base) {
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

// Shallow copy of a config.Options (Go passes it by value). Constructing a
// real config.Options keeps the object shape stable (Object.create + assign
// produces slow objects).
function cloneConfigOptions(options) {
  const o = new ConfigOptions();
  for (const key in options) o[key] = options[key];
  return o;
}

// parseFile for the stdin file (the only file a transform loads)
// Go mutates its own copy of config.Options ("args.options") before calling
// js_parser.OptionsFromConfig. Here "options" is shared and not mutated;
// the per-file changes (module type from maybeParseFile, and JSX/TS parsing
// for the loader) are applied to the js_parser.Options that
// OptionsFromConfig returns instead, which is equivalent.
function parseFile(log, keyPath, prettyPaths, sourceIndex, options, moduleTypeData) {
  const parserOptions = () => {
    const o = optionsFromConfig(options);
    o.moduleTypeData = moduleTypeData;
    return o;
  };

  let pathForIdentifierName = keyPath.text;

  // Identifier name generation may use the name of the parent folder if the
  // file name starts with "index". However, this is problematic when the
  // parent folder includes the parent directory of what the developer
  // considers to be the root of the source tree. If that happens, strip the
  // parent folder to avoid including it in the generated name.
  // ("AbsOutputBase" is still empty when the stdin file is parsed.)
  const $d221 = mockRel(options.absOutputBase || "", pathForIdentifierName);
  const relative0 = $d221[0], ok0 = $d221[1];
  if (ok0) {
    let relative = relative0;
    for (;;) {
      let next = relative.startsWith("../") ? relative.slice(3) : relative;
      next = next.startsWith("..\\") ? next.slice(3) : next;
      if (relative === next) break;
      relative = next;
    }
    pathForIdentifierName = relative;
  }

  const source = new Source(prettyPaths, generateNonUniqueNameFromPath(pathForIdentifierName), "", keyPath, sourceIndex);

  let loader;
  const stdin = options.stdin;
  if (stdin !== null) {
    // Special-case stdin
    source.contents = stdin.contents;
    loader = stdin.loader;
    if (loader === LoaderNone) {
      loader = LoaderJS;
    }
  } else {
    bail(); // (plugins and the file system are only used when bundling)
  }

  const $d222 = platformIndependentPathDirBaseExt(source.keyPath.text);
  const base = $d222[1], ext = $d222[2];

  // The special "default" loader determines the loader from the file path
  if (loader === LoaderDefault) {
    // (applyOptionDefaults: a nil "ExtensionToLoader" means the default map)
    const extensionToLoader = options.extensionToLoader === undefined || options.extensionToLoader === null ? defaultExtensionToLoader : options.extensionToLoader;
    loader = loaderFromFileExtension(extensionToLoader, base + ext);
  }

  // (import attributes only exist on resolved paths)

  if (loader === LoaderEmpty) {
    source.contents = "";
  }

  const inputFile = new InputFile(null, null, [], "", new SideEffects(), source, loader);
  const result = new parseResult(new scannerFile(inputFile), false);

  switch (loader) {
    case LoaderJS:
    case LoaderEmpty: {
      const $d223 = parse(log, source, parserOptions());
      const ast = $d223[0], ok = $d223[1];
      if (ast !== null && ast.parts.length <= 1) {
        // Ignore the implicitly-generated namespace export part
        inputFile.sideEffects.kind = NoSideEffects_EmptyAST;
      }
      inputFile.repr = new JSRepr();
      inputFile.repr.ast = ast;
      result.ok = ok;
      break;
    }

    case LoaderJSX: {
      const o = parserOptions();
      o.jsx = options.jsx.clone();
      o.jsx.parse = true;
      const $d224 = parse(log, source, o);
      const ast = $d224[0], ok = $d224[1];
      if (ast !== null && ast.parts.length <= 1) {
        // Ignore the implicitly-generated namespace export part
        inputFile.sideEffects.kind = NoSideEffects_EmptyAST;
      }
      inputFile.repr = new JSRepr();
      inputFile.repr.ast = ast;
      result.ok = ok;
      break;
    }

    case LoaderTS:
    case LoaderTSNoAmbiguousLessThan: {
      const o = parserOptions();
      o.ts = new TSOptions(options.ts.config, true, loader === LoaderTSNoAmbiguousLessThan);
      const $d225 = parse(log, source, o);
      const ast = $d225[0], ok = $d225[1];
      if (ast !== null && ast.parts.length <= 1) {
        // Ignore the implicitly-generated namespace export part
        inputFile.sideEffects.kind = NoSideEffects_EmptyAST;
      }
      inputFile.repr = new JSRepr();
      inputFile.repr.ast = ast;
      result.ok = ok;
      break;
    }

    case LoaderTSX: {
      const o = parserOptions();
      o.ts = new TSOptions(options.ts.config, true, options.ts.noAmbiguousLessThan);
      o.jsx = options.jsx.clone();
      o.jsx.parse = true;
      const $d226 = parse(log, source, o);
      const ast = $d226[0], ok = $d226[1];
      if (ast !== null && ast.parts.length <= 1) {
        // Ignore the implicitly-generated namespace export part
        inputFile.sideEffects.kind = NoSideEffects_EmptyAST;
      }
      inputFile.repr = new JSRepr();
      inputFile.repr.ast = ast;
      result.ok = ok;
      break;
    }

    default:
      bail(); // CSS, JSON, text, binary, file, copy, ... (and LoaderNone: "Do not know how to load path")
  }

  // A failed parse always comes with a logged error in Go (the transform then
  // returns errors); here it can only mean the lexer gave up
  if (!result.ok) bail();

  // Only continue now if parsing was successful
  if (result.ok) {
    // (import records are only resolved when bundling)

    // Attempt to parse the source map if present
    if (loaderCanHaveSourceMap(loader) && options.sourceMap !== SourceMapNone) {
      const sourceMapComment = inputFile.repr.ast.sourceMapComment; // (only JS files here)
      if (sourceMapComment !== null && sourceMapComment.text !== "") {
        // Loading and parsing input source maps is not ported. Only comments
        // for which extractSourceMapFromComment returns no contents without
        // an error or a warning are supported.
        if (!sourceMapCommentIsIgnoredInTransform(sourceMapComment.text)) bail();
      }
    }
  }

  return result;
}

// Returns true if extractSourceMapFromComment is known to return no source
// map for this comment in a transform (a Debug message at most), false if it
// might load a source map or report a warning. (A transform has no resolve
// directory, so relative URLs are ignored, and URLs with a scheme other than
// "file" are ignored too.) Conservative: only simple URLs for which Go's
// url.Parse can't fail are accepted.
const ignoredRelativeSourceMapURL = /^(?!\/\/)[A-Za-z0-9._~!$&'()*+,;=@/-]+$/;
const ignoredHTTPSourceMapURL = /^https?:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=@/-]*)?$/;
function sourceMapCommentIsIgnoredInTransform(text) {
  // Data URLs contain the source map itself
  if (text.startsWith("data:")) return false;
  return ignoredRelativeSourceMapURL.test(text) || ignoredHTTPSourceMapURL.test(text);
}

// Go: globalRuntimeCache. The cached AST is shared by every transform and
// must never be mutated: graph.markASTShared() prepares it once, and
// graph.cloneLinkerGraph clones (eagerly or copy-on-write) whatever the
// linker mutates for files with InputFile.astIsShared set.
class runtimeCache {
  ;                   
  constructor() {
    this.astMap = null; // Map<string, {source, ast}>
  }

  // Returns [source, runtimeAST, ok]
  parseRuntime(options) {
    // All configuration options that the runtime code depends on must go here
    const unsupportedJSFeatures = options.unsupportedJSFeatures;
    const minifySyntax = options.minifySyntax;
    const minifyIdentifiers = options.minifyIdentifiers;
    const key =
      unsupportedJSFeatures === 0 && !minifySyntax && !minifyIdentifiers
        ? "0|0|0" // (the only key the fast path uses; avoids building a string)
        : unsupportedJSFeatures + "|" + (minifySyntax ? 1 : 0) + "|" + (minifyIdentifiers ? 1 : 0);

    // Cache hit? (The source only depends on the key too, so it is cached along
    // with the AST instead of being recreated like Go does.)
    if (this.astMap !== null) {
      const entry = this.astMap.get(key);
      if (entry !== undefined) return [entry.source, entry.ast, true];
    }

    // Determine which source to use
    const source = runtimeSource(unsupportedJSFeatures);

    // Cache miss
    const log = new Log();
    const runtimeOptions = new ConfigOptions();
    // These configuration options must only depend on the key
    runtimeOptions.unsupportedJSFeatures = unsupportedJSFeatures;
    runtimeOptions.minifySyntax = minifySyntax;
    runtimeOptions.minifyIdentifiers = minifyIdentifiers;
    // Always do tree shaking for the runtime because we never want to
    // include unnecessary runtime code
    runtimeOptions.treeShaking = true;
    const $d227 = parse(log, source, optionsFromConfig(runtimeOptions));
    const runtimeAST = $d227[0], ok = $d227[1];
    // (errors in the runtime would throw BAIL from the log)

    // Cache for next time
    if (ok) {
      markASTShared(runtimeAST, RUNTIME_SOURCE_INDEX);
      if (this.astMap === null) this.astMap = new Map();
      this.astMap.set(key, { source, ast: runtimeAST });
    }
    return [source, runtimeAST, ok];
  }
}

const globalRuntimeCache = new runtimeCache();

// For tests: lets a test deep-freeze the cached runtime AST to verify that
// transforms never mutate it.
export const _testHooks = { globalRuntimeCache };

const base64URLChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// 12 random bytes in URL-safe base64 (16 characters). The prefix is never
// written to transform output (see linker.breakJoinerIntoPieces), so a
// non-cryptographic source of randomness is enough.
function generateUniqueKeyPrefix() {
  let s = "";
  for (let i = 0; i < 16; i++) s += base64URLChars[(Math.random() * 64) | 0];
  return s;
}

function applyOptionDefaults(options) {
  // (A missing "extensionToLoader" is replaced by the default map where it is
  // read, so that "options" keeps the config.Options object shape)

  // (output extensions and path templates only affect output paths, which a
  // transform never exposes; see linker.generateChunksInParallel)

  options.profilerNames = !options.minifyIdentifiers;

  // Automatically fix invalid configurations of unsupported features. Any
  // override that marks a feature as unsupported is outside the fast path
  // (the port assumes "unsupportedJSFeatures" is empty).
  if (options.unsupportedJSFeatureOverrides !== 0) bail();

  // If we're not building for the browser, automatically disable support for
  // inline </script> and </style> tags if there aren't currently any overrides.
  // (compat.InlineScript = 1 << 36; the JSFeature mask is a uint64, so use
  // arithmetic instead of JS bitwise operators)
  if (options.platform !== PlatformBrowser) {
    if (Math.floor(options.unsupportedJSFeatures / 68719476736) % 2 === 0) options.unsupportedJSFeatures += 68719476736;
  }
}

class Bundle {
  ;                            
  ;                  
  ;                        
  ;                    
  constructor(uniqueKeyPrefix, files, entryPoints, options) {
    // The unique key prefix is a random string that is unique to every bundling
    // operation. It is used as a prefix for the unique keys assigned to every
    // chunk during linking. These unique keys are used to identify each chunk
    // before the final output paths have been computed.
    this.uniqueKeyPrefix = uniqueKeyPrefix;
    this.files = files; // []scannerFile
    this.entryPoints = entryPoints; // []graph.EntryPoint
    this.options = options;
  }

  // Returns [outputFiles, metafileJSON]
  compile(log, timer, mangleCache, linkFn) {
    const b = this;
    // (Go copies the options to install ExclusiveMangleCacheUpdate, which the
    // fast path doesn't need; the linker never mutates the options)
    const options = b.options;

    const files = new Array(b.files.length);
    for (let i = 0; i < b.files.length; i++) {
      files[i] = b.files[i] === null ? null : b.files[i].inputFile;
    }

    // Get the base path from the options or choose the lowest common ancestor of all entry points
    const allReachableFiles = findReachableFiles(files, b.entryPoints);

    // Compute source map data in parallel with linking
    const dataForSourceMaps = b.computeDataForSourceMapsInParallel(options, allReachableFiles);

    let resultGroups;
    if (options.codeSplitting || b.entryPoints.length === 1) {
      // If code splitting is enabled or if there's only one entry point, link all entry points together
      resultGroups = [linkFn(options, null, log, null, null, files, b.entryPoints, b.uniqueKeyPrefix, allReachableFiles, dataForSourceMaps)];
    } else {
      bail(); // (multiple entry points only happen when bundling)
    }

    // Join the results in entry point order for determinism
    const outputFiles = [];
    for (const group of resultGroups) for (const f of group) outputFiles.push(f);

    // (no metafile)

    // The checks that an output file never overwrites an input file or another
    // output file can't fire for a transform: the stdin file is not in the
    // "file" namespace and the only possible output files are "X",
    // "X.LEGAL.txt" and "X.map".

    return [outputFiles, ""];
  }

  // Returns a function returning []DataForSourceMap (null when source maps are
  // disabled). Go computes this on goroutines; here it is computed eagerly.
  computeDataForSourceMapsInParallel(options, reachableFiles) {
    const b = this;
    if (options.sourceMap === SourceMapNone) {
      return () => null;
    }

    const results = new Array(b.files.length);
    for (let i = 0; i < results.length; i++) results[i] = new DataForSourceMap();

    for (const sourceIndex of reachableFiles) {
      const f = b.files[sourceIndex];
      if (loaderCanHaveSourceMap(f.inputFile.loader)) {
        let approximateLineCount = 0;
        const repr = f.inputFile.repr;
        if (repr instanceof JSRepr) {
          approximateLineCount = repr.ast.approximateLineCount;
        }
        const result = results[sourceIndex];
        result.lineOffsetTables = generateLineOffsetTables(f.inputFile.source.contents, approximateLineCount);
        const sm = f.inputFile.inputSourceMap;
        if (!options.excludeSourcesContent) {
          if (sm === null) {
            // Simple case: no nested source map
            // (helpers.QuoteForJSON; see quoteForJSONLong)
            result.quotedContents = [quoteForJSONLong(f.inputFile.source.contents, options.asciiOnly)];
          } else {
            // Complex case: nested source map
            bail(); // (input source maps are never loaded: see parseFile)
          }
        }
      }
    }

    return () => results;
  }
}

// This is data related to source maps. It's computed in parallel with linking
// and must be ready by the time printing happens. This is beneficial because
// it is somewhat expensive to produce.
class DataForSourceMap {
  ;                             
  ;                           
  constructor() {
    // This data is for the printer. It maps from offsets in the file (which
    // are stored at every AST node) to line and UTF-16 column offsets
    // (required by source maps). See sourcemap.generateLineOffsetTables.
    this.lineOffsetTables = null;

    // This contains the quoted contents of the original source file. It's what
    // needs to be embedded in the "sourcesContent" array in the final source
    // map. Quoting is precomputed because it's somewhat expensive.
    this.quotedContents = null; // []string
  }
}

// Find all files reachable from all entry points. This order should be
// deterministic given that the entry point order is deterministic, since the
// returned order is the postorder of the graph traversal and import record
// order within a given file is deterministic.
function findReachableFiles(files, entryPoints) {
  const visited = new Set();
  const order = [];

  // Include this file and all files it imports
  const visit = (sourceIndex) => {
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

class scanner {
  ;                
  ;                            
  ;                      
  ;                    
  constructor(log, options, uniqueKeyPrefix) {
    this.log = log;
    this.uniqueKeyPrefix = uniqueKeyPrefix;
    this.results = []; // []parseResult
    this.options = options;
  }

  // Transforms only ever have the stdin entry point
  addEntryPoints() {
    const s = this;
    const entryMetas = [];

    // Treat stdin as an extra entry point
    const stdin = s.options.stdin;
    if (stdin !== null) {
      let stdinPath = new Path("<stdin>");
      if (stdin.sourceFile !== "") {
        if (stdin.absResolveDir === "") {
          stdinPath = new Path(stdin.sourceFile);
        } else {
          bail(); // (the build API's stdin with a resolve directory)
        }
      }
      const sourceIndex = s.maybeParseStdin(stdinPath, makePrettyPaths(stdinPath));
      entryMetas.push(new EntryPoint("stdin", sourceIndex));
    } else {
      bail(); // (a transform always has stdin)
    }

    // (There are no other entry points. "AbsOutputBase" would now be set to
    // the current directory, which only affects output paths.)
    return entryMetas;
  }

  // maybeParseFile for the stdin file (inputKindStdin)
  maybeParseStdin(path, prettyPaths) {
    const s = this;

    // Allocate a source index (the source index cache of a fresh CacheSet
    // hands out runtime.SourceIndex + 1 first)
    const sourceIndex = RUNTIME_SOURCE_INDEX + 1;
    while (s.results.length < sourceIndex + 1) s.results.push(new parseResult());

    let moduleTypeData;

    // (No per-file "tsconfig.json" overrides: the stdin resolve result has
    // empty TSConfigJSX/TSConfig/TSAlwaysStrict, so ApplyTo is a no-op. The
    // "tsconfigRaw" override was already applied to s.options in scanBundle.)

    // Set the module type preference using node's module type rules
    const text = path.text;
    const baseModuleTypeData = s.options.moduleTypeData === null || s.options.moduleTypeData === undefined ? new ModuleTypeData() : s.options.moduleTypeData;
    if (text.endsWith(".mjs")) {
      moduleTypeData = new ModuleTypeData(baseModuleTypeData.source, baseModuleTypeData.range, ModuleESM_MJS);
    } else if (text.endsWith(".mts")) {
      moduleTypeData = new ModuleTypeData(baseModuleTypeData.source, baseModuleTypeData.range, ModuleESM_MTS);
    } else if (text.endsWith(".cjs")) {
      moduleTypeData = new ModuleTypeData(baseModuleTypeData.source, baseModuleTypeData.range, ModuleCommonJS_CJS);
    } else if (text.endsWith(".cts")) {
      moduleTypeData = new ModuleTypeData(baseModuleTypeData.source, baseModuleTypeData.range, ModuleCommonJS_CTS);
    } else if (text.endsWith(".js") || text.endsWith(".jsx") || text.endsWith(".ts") || text.endsWith(".tsx")) {
      moduleTypeData = new ModuleTypeData(); // resolveResult.ModuleTypeData (zero)
    } else {
      // The "type" setting in "package.json" only applies to ".js" files
      moduleTypeData = new ModuleTypeData(baseModuleTypeData.source, baseModuleTypeData.range, ModuleUnknown);
    }

    // (Not an injected file, so the mode stays the same)

    s.results[sourceIndex] = parseFile(s.log, path, prettyPaths, sourceIndex, s.options, moduleTypeData);
    return sourceIndex;
  }

  processScannedFiles(entryPointMeta) {
    const s = this;

    // (Pretty-path collisions only change paths of files with import
    // attributes, and transforms have none. There is no metafile.)

    // Traverse the graph to check top-level await
    if (s.iterativelyValidateTLA()) {
      s.reportInvalidTLA();
    }

    // The linker operates on an array of files, so construct that now.
    const files = new Array(s.results.length);
    for (let sourceIndex = 0; sourceIndex < s.results.length; sourceIndex++) {
      const result = s.results[sourceIndex];
      files[sourceIndex] = result.ok ? result.file : null;
    }
    return files;
  }

  iterativelyValidateTLA() {
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

  recursivelyValidateTLA(sourceIndex, pass, didChange) {
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
          for (let $i0 = 0, $a0 = repr.ast.importRecords; $i0 < $a0.length; $i0++) {
            const record = $a0[$i0];
            // Require of a top-level await chain is forbidden
            if (record.kind === ImportRequire && record.sourceIndex >= 0 && s.results[record.sourceIndex].tlaCheck.parent >= 0) {
              s.log.addErrorWithNotes();
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

// ScanBundle for config.TransformCall (no file system, caches, entry points
// or timer: a transform only has the stdin file)
function scanBundle(call, log, options) {
  if (call !== TransformCall) bail();
  options = cloneConfigOptions(options);

  applyOptionDefaults(options);

  // Each bundling operation gets a separate unique key
  const uniqueKeyPrefix = generateUniqueKeyPrefix();

  // This may mutate "options" by the "tsconfig.json" override settings
  // (resolver.NewResolver; the rest of the resolver is only used when
  // bundling). The stdin file's resolve result carries no "tsconfig.json"
  // settings of its own, so these apply to it unchanged.
  applyTSConfigOverride(log, options);

  const s = new scanner(log, options, uniqueKeyPrefix);

  // Always start by parsing the runtime file
  {
    const $d228 = globalRuntimeCache.parseRuntime(options);
    const source = $d228[0], ast = $d228[1], ok = $d228[2];
    const repr = new JSRepr();
    repr.ast = ast;
    const inputFile = new InputFile(repr, null, [], "", new SideEffects(), source, LoaderNone, true);
    inputFile.astIsShared = true;
    const result = new parseResult(new scannerFile(inputFile), ok);
    s.results.push(result);
  }

  // Injected files: "--define" values that aren't primitives (and "inject")
  // generate additional files. Not supported by the fast path.
  if (options.injectedDefines.length > 0 || options.injectedFiles.length > 0) bail();
  s.options.injectedFiles = [];

  const entryPointMeta = s.addEntryPoints();

  // (Import records are only resolved when bundling: nothing to scan)
  if (s.options.mode === ModeBundle) bail();

  const files = s.processScannedFiles(entryPointMeta);

  return new Bundle(uniqueKeyPrefix, files, entryPointMeta, s.options);
}

// Platforms other than "browser" make Go mark compat.InlineScript as
// unsupported, which only changes how "</script" sequences are printed (and
// whether tagged template literals containing "</script" are lowered). The
// port always behaves like the browser platform, so bail whenever that
// difference could be visible.
const closingScriptTagInSource = /<\/script/i;
const escapedClosingScriptTagInOutput = /<\\\/script|< \/script/i;

// Runs bundler.ScanBundle + Bundle.Compile(linker.Link) for a validated
// config.Options of a transform (stdin set, mode pass-through or convert
// format) and selects the results like api.transformImpl. Returns
// { code, map, legalComments } as JS strings; map is "" when there is no
// external source map, legalComments is null when esbuild
// would not return a legal comments file. Throws BAIL when the input or the
// options are not supported by the fast path (including any error or warning).
export function transformBundle(configOptions, log) {
  if (log === undefined || log === null) log = new Log();
  try {
    // Scan over the bundle
    const bundle = scanBundle(TransformCall, log, configOptions);

    // Compile the bundle
    const $d229 = bundle.compile(log, null, null, link);
    const results = $d229[0];

    // Return the results
    let code = "";
    let sourceMap = ""; // (Go: nil, which the service sends as "")
    let legalComments = null;

    let shortestAbsPath = "";
    for (const result of results) {
      if (shortestAbsPath === "" || result.absPath.length < shortestAbsPath.length) {
        shortestAbsPath = result.absPath;
      }
    }

    // Unpack the JavaScript file, the source map file, and the legal comments file
    for (const result of results) {
      switch (result.absPath) {
        case shortestAbsPath:
          code = result.contents;
          break;
        case shortestAbsPath + ".map":
          sourceMap = result.contents;
          break;
        case shortestAbsPath + ".LEGAL.txt":
          legalComments = result.contents;
          break;
      }
    }

    return { code, map: sourceMap, legalComments };
  } catch (e) {
    // Deep recursion (e.g. in the tree shaking pass) can overflow the JS stack
    // where Go would just grow its stack: fall back instead
    if (e instanceof RangeError) throw BAIL;
    throw e;
  }
}
// generated from bundler.mts by tools/ts-build.mjs; edit that file
