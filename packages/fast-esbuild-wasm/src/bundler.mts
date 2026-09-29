// Port of the transform subset of internal/bundler/bundler.go (ScanBundle for
// config.TransformCall, parseFile for the stdin file, the runtime cache,
// Bundle.Compile) plus the result selection of pkg/api's transformImpl.
//
// In a transform there is no resolver and there are no plugins: the scan
// phase has the runtime (source index 0, cached per runtime-affecting options
// like Go's globalRuntimeCache), one "<define:NAME>" file per object or array
// "--define" value (source indices 1...) and the stdin file (the next index).
// Import records are never resolved (that only happens in ModeBundle), so
// every import path stays external except the parser-generated "<runtime>"
// and "<define:NAME>" imports, whose source indices the parser pre-fills.
import { goQuote } from "./gostd.mjs";
import { GoPanic } from "./gopanic.mjs";
import { newTimerIfEnabled, type Timer } from "./timer.mjs";
import { recoverParsePanic } from "./recover.mjs";
import {
  jsFeatureHas,
  jsFeatureOr,
  jsFeatureIsEmpty,
  JSFeatureNone,
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
} from "./compat.mjs";
import type { JSFeature } from "./compat.mjs";
import {
  Log,
  Path,
  PrettyPaths,
  Source,
  RANGE_ZERO,
  platformIndependentPathDirBaseExt,
  parseWithTempLog,
  MsgData,
  LineColumnTracker,
} from "./logger.mjs";
import { ImportRequire, ImportStmt } from "./ast.mjs";
import {
  Options as ConfigOptions,
  InjectedFile,
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
  LoaderGlobalCSS,
  LoaderLocalCSS,
  loaderIsCSS,
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
  ensureValidIdentifier,
  Expr,
  EArray,
  EObject,
  EString,
  ENumber,
  EBoolean,
  EBigInt,
  E_ARRAY,
  E_OBJECT,
  E_STRING,
  E_NUMBER,
  E_BOOLEAN,
  E_BIG_INT,
  E_NULL,
} from "./js_ast.mjs";
import { parse, optionsFromConfig, lazyExportAST } from "./js_parser.mjs";
import { source as runtimeSource } from "./runtime.mjs";
import { InputFile, JSRepr, CSSRepr, EntryPoint, SideEffects, NoSideEffects_EmptyAST, NoSideEffects_PureData, markASTShared } from "./graph.mjs";
import { link, loaderCanHaveSourceMap } from "./linker.mjs";
import { generateLineOffsetTables, quoteForJSONLong } from "./sourcemap.mjs";
import { quoteForJSON } from "./helpers.mjs";
import { loadInputSourceMap } from "./bundler_scan.mjs";
import { base64StdEncodeByteString, utf8ByteString, guessMimeType, encodeStringAsShortestDataURL } from "./bundler_scan.mjs";
import { parseJSON, JSONOptions } from "./json_parser.mjs";
import { HelperCall } from "./js_parser.mjs";
import { ExportsESM } from "./js_ast.mjs";
import { FromBase64 } from "./compat.mjs";
import { LoaderWithTypeJSON, LoaderBase64, LoaderBinary, LoaderDataURL, LoaderFile, LoaderCopy, LoaderToString, PlatformNode } from "./config.mjs";
import { newCacheSet } from "./build_deps.mjs";
import { ENOENT, GoError } from "./fs.mjs";
import { applyTSConfigOverride } from "./tsconfig.mjs";
import { encodeSnapshot, decodeSnapshot } from "./snapshot.mjs";
import { parse as parseCSS, optionsFromConfig as cssOptionsFromConfig } from "./css_parser.mjs";
import { cssFeatureHas, InlineStyle as CSSInlineStyle } from "./compat_css.mjs";
import { transformBundleCSS } from "./linker_css.mjs";

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
export function mockRel(base, target) {
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
export function makePrettyPaths(path) {
  let absPath = path.text;
  let relPath = path.text;

  if (path.namespace === "file") {
    throw new GoPanic("Internal error"); // (transforms never create "file" namespace paths)
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
  declare jsonMetadataChunk: string;
  declare pluginData: any;
  declare inputFile: any;
  constructor(inputFile) {
    this.jsonMetadataChunk = "";
    this.pluginData = null;
    this.inputFile = inputFile;
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

class parseResult {
  declare file: any;
  declare tlaCheck: tlaCheck;
  declare ok: boolean;
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
export function cloneConfigOptions(options) {
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
export function parseFile(log, keyPath, prettyPaths, sourceIndex, options, moduleTypeData) {
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
    throw new GoPanic("Internal error"); // (a transform always has stdin)
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

  // (Go: a deferred recover() turns a panic into an error; see recoverParsePanic)
  try {
  switch (loader) {
    case LoaderJS:
    case LoaderEmpty: {
      const $d223 = parseWithTempLog(log, (tempLog) => parse(tempLog, source, parserOptions()));
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
      const $d224 = parseWithTempLog(log, (tempLog) => parse(tempLog, source, o));
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
      const $d225 = parseWithTempLog(log, (tempLog) => parse(tempLog, source, o));
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
      const $d226 = parseWithTempLog(log, (tempLog) => parse(tempLog, source, o));
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

    case LoaderCSS:
    case LoaderGlobalCSS:
    case LoaderLocalCSS: {
      inputFile.repr = new CSSRepr(parseWithTempLog(log, (tempLog) => parseCSS(tempLog, source, cssOptionsFromConfig(loader, options))));
      result.ok = true;
      break;
    }

    case LoaderJSON:
    case LoaderWithTypeJSON: {
      const $j = parseWithTempLog(log, (tempLog) => parseJSON(tempLog, source, new JSONOptions(options.unsupportedJSFeatures)));
      const expr = $j[0] !== null ? $j[0] : new Expr(null, 0); // (Go's zero Expr when the parse failed)
      const ast = lazyExportAST(log, source, parserOptions(), expr, null);
      if (loader === LoaderWithTypeJSON) {
        // (import attributes only exist when bundling)
        ast.exportsKind = ExportsESM;
      }
      inputFile.sideEffects = new SideEffects(inputFile.sideEffects.data, NoSideEffects_PureData);
      inputFile.repr = new JSRepr();
      inputFile.repr.ast = ast;
      result.ok = $j[1];
      break;
    }

    case LoaderText: {
      // Strip any UTF-8 BOM from the text
      if (source.contents.charCodeAt(0) === 0xfeff) {
        source.contents = source.contents.slice(1);
      }
      const encoded = base64StdEncodeByteString(utf8ByteString(source.contents));
      // (helpers.StringToUTF16: raw bytes of invalid UTF-8 become U+FFFD)
      const expr = new Expr(new EString(source.contents.isWellFormed() ? source.contents : source.contents.toWellFormed()), 0);
      const ast = lazyExportAST(log, source, parserOptions(), expr, null);
      ast.urlForCSS = "data:text/plain;base64," + encoded;
      inputFile.sideEffects = new SideEffects(inputFile.sideEffects.data, NoSideEffects_PureData);
      inputFile.repr = new JSRepr();
      inputFile.repr.ast = ast;
      result.ok = true;
      break;
    }

    // (the contents of these loaders are the input's bytes: a byte string,
    // see fastTransform)
    case LoaderBase64: {
      const mimeType = guessMimeType(ext, source.contents);
      const encoded = base64StdEncodeByteString(source.contents);
      const expr = new Expr(new EString(encoded), 0);
      const ast = lazyExportAST(log, source, parserOptions(), expr, null);
      ast.urlForCSS = "data:" + mimeType + ";base64," + encoded;
      inputFile.sideEffects = new SideEffects(inputFile.sideEffects.data, NoSideEffects_PureData);
      inputFile.repr = new JSRepr();
      inputFile.repr.ast = ast;
      result.ok = true;
      break;
    }

    case LoaderBinary: {
      const encoded = base64StdEncodeByteString(source.contents);
      const expr = new Expr(new EString(encoded), 0);
      let helper: HelperCall;
      if (jsFeatureHas(options.unsupportedJSFeatures, FromBase64)) {
        if (options.platform === PlatformNode) {
          helper = new HelperCall(null, "__toBinaryNode");
        } else {
          helper = new HelperCall(null, "__toBinary");
        }
      } else {
        helper = new HelperCall(["Uint8Array", "fromBase64"], "");
      }
      const ast = lazyExportAST(log, source, parserOptions(), expr, helper);
      ast.urlForCSS = "data:application/octet-stream;base64," + encoded;
      inputFile.sideEffects = new SideEffects(inputFile.sideEffects.data, NoSideEffects_PureData);
      inputFile.repr = new JSRepr();
      inputFile.repr.ast = ast;
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
      const ast = lazyExportAST(log, source, parserOptions(), expr, null);
      ast.urlForCSS = url;
      inputFile.sideEffects = new SideEffects(inputFile.sideEffects.data, NoSideEffects_PureData);
      inputFile.repr = new JSRepr();
      inputFile.repr.ast = ast;
      result.ok = true;
      break;
    }

    case LoaderFile:
    case LoaderCopy:
      // (the flag parser rejects these loaders for a transform, and the
      // default extension map has neither)
      throw new Error("Internal error: " + LoaderToString[loader] + " loader in a transform");

    default: {
      // (a transform's path is never in the "file" namespace)
      const message = "Do not know how to load path: " + source.prettyPaths.select(options.logPathStyle);
      log.addError(null, RANGE_ZERO, message);
    }
  }


  // Only continue now if parsing was successful
  if (result.ok) {
    // (import records are only resolved when bundling)

    // Attempt to parse the source map if present
    if (loaderCanHaveSourceMap(loader) && options.sourceMap !== SourceMapNone) {
      const sourceMapComment = inputFile.repr.ast.sourceMapComment; // (JSRepr or CSSRepr)
      if (sourceMapComment !== null && sourceMapComment.text !== "") {
        // (a transform has no resolve directory, and its file system is
        // Go's empty mock file system: only data URLs can load a map)
        const sourceMap = loadInputSourceMap(log, transformMockFS, newCacheSet(), source, sourceMapComment, "", options, source.prettyPaths);
        if (sourceMap !== undefined) inputFile.inputSourceMap = sourceMap;
      }
    }
  }
  } catch (e) {
    recoverParsePanic(e, log, source.prettyPaths.select(options.logPathStyle));
  }

  return result;
}

// A deep copy of a value from js_parser.ParseJSON (null, booleans, numbers,
// big integers, strings, arrays and objects of those)
function cloneJSONValue(data) {
  switch (data.k) {
    case E_ARRAY: {
      const items = new Array(data.items.length);
      for (let i = 0; i < items.length; i++) {
        const item = data.items[i];
        items[i] = new Expr(cloneJSONValue(item.data), item.loc);
      }
      return new EArray(items, data.commaAfterSpread, data.closeBracketLoc, data.isSingleLine, data.isParenthesized);
    }
    case E_OBJECT: {
      const properties = new Array(data.properties.length);
      for (let i = 0; i < properties.length; i++) {
        const property = data.properties[i].clone();
        property.key = new Expr(cloneJSONValue(property.key.data), property.key.loc);
        property.valueOrNil = new Expr(cloneJSONValue(property.valueOrNil.data), property.valueOrNil.loc);
        properties[i] = property;
      }
      return new EObject(properties, data.commaAfterSpread, data.closeBraceLoc, data.isSingleLine, data.isParenthesized);
    }
    case E_STRING:
      return new EString(data.value, data.legacyOctalLoc, data.preferTemplate, data.hasPropertyKeyComment, data.containsUniqueKey);
    case E_NUMBER:
      return new ENumber(data.value);
    case E_BOOLEAN:
      return new EBoolean(data.value);
    case E_BIG_INT:
      return new EBigInt(data.value);
    case E_NULL:
      return data; // (js_ast.ENullShared)
  }
  throw new GoPanic("Internal error"); // (a JSON value is one of the above)
}

// Go: globalRuntimeCache. The cached AST is shared by every transform and
// must never be mutated: graph.markASTShared() prepares it once, and
// graph.cloneLinkerGraph clones (eagerly or copy-on-write) whatever the
// linker mutates for files with InputFile.astIsShared set.
class runtimeCache {
  declare astMap: any;
  constructor() {
    this.astMap = null; // Map<string, {source, ast}>
  }

  // Returns [source, runtimeAST, ok]
  parseRuntime(options) {
    // All configuration options that the runtime code depends on must go here
    const unsupportedJSFeatures = options.unsupportedJSFeatures;
    const minifySyntax = options.minifySyntax;
    const minifyIdentifiers = options.minifyIdentifiers;
    const key = runtimeCacheKey(unsupportedJSFeatures, minifySyntax, minifyIdentifiers);

    // Cache hit? (The source only depends on the key too, so it is cached along
    // with the AST instead of being recreated like Go does.)
    if (this.astMap !== null) {
      const entry = this.astMap.get(key);
      if (entry !== undefined) return [entry.source, entry.ast, true];
    }

    // Determine which source to use
    const source = runtimeSource(unsupportedJSFeatures);

    // JS-only: decode the AST that build.mjs made with this parser at build
    // time (see snapshot.mjs), for exactly the keys it was made for (build.mjs
    // checks that the runtime parses the same for each of them)
    if (runtimeSnapshot !== null && runtimeSnapshot.keys.includes(key)) {
      const runtimeAST = decodeSnapshot(runtimeSnapshot.snapshot);
      _testHooks.snapshotDecodes++;
      // (Test hook: the snapshot must match a fresh parse)
      if (globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__) {
        const fresh = parseRuntimeForSnapshot(unsupportedJSFeatures, minifySyntax, minifyIdentifiers);
        if (encodeSnapshot(fresh) !== encodeSnapshot(runtimeAST)) throw new globalThis.Error("@r1ck404/fast-esbuild-wasm: runtime snapshot mismatch");
      }
      markASTShared(runtimeAST, RUNTIME_SOURCE_INDEX);
      if (this.astMap === null) this.astMap = new Map();
      this.astMap.set(key, { source, ast: runtimeAST });
      return [source, runtimeAST, true];
    }

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

// (for the build API's scan phase, bundler_scan.mts)
export function parseRuntimeCached(options) {
  return globalRuntimeCache.parseRuntime(options);
}
export function cloneJSONValueForInject(data) {
  return cloneJSONValue(data);
}

// The key of the runtime cache: everything the runtime's parse depends on
export function runtimeCacheKey(unsupportedJSFeatures: JSFeature, minifySyntax: boolean, minifyIdentifiers: boolean): string {
  return jsFeatureIsEmpty(unsupportedJSFeatures) && !minifySyntax && !minifyIdentifiers
    ? "0|0|0" // (the most common key; avoids building a string)
    : unsupportedJSFeatures.toString() + "|" + (minifySyntax ? 1 : 0) + "|" + (minifyIdentifiers ? 1 : 0);
}

// The runtime AST snapshot (snapshot.mjs) and the runtime cache keys it is
// for, baked into the engine by build.mjs (esbuild "define", an object:
// {keys, snapshot}); null when running from the source modules unless a test
// installs one (the snapshot may then be its text).
declare const __FAST_RUNTIME_SNAPSHOT__: { keys: string[]; snapshot: object | string };
let runtimeSnapshot: { keys: string[]; snapshot: object | string } | null = typeof __FAST_RUNTIME_SNAPSHOT__ !== "undefined" ? __FAST_RUNTIME_SNAPSHOT__ : null;

// For tests: lets a test deep-freeze the cached runtime AST to verify that
// transforms never mutate it, install or remove the runtime snapshot (which
// also empties the cache), and count how often the snapshot was decoded.
export const _testHooks = {
  globalRuntimeCache,
  setRuntimeSnapshot(snapshot: { keys: string[]; snapshot: object | string } | null) {
    runtimeSnapshot = snapshot;
    globalRuntimeCache.astMap = null;
  },
  snapshotDecodes: 0,
};

// Parses the runtime like runtimeCache.parseRuntime does on a cache miss,
// without the cache or the snapshot (build.mjs makes the snapshot from it)
export function parseRuntimeForSnapshot(unsupportedJSFeatures: JSFeature = JSFeatureNone, minifySyntax = false, minifyIdentifiers = false) {
  const runtimeOptions = new ConfigOptions();
  runtimeOptions.unsupportedJSFeatures = unsupportedJSFeatures;
  runtimeOptions.minifySyntax = minifySyntax;
  runtimeOptions.minifyIdentifiers = minifyIdentifiers;
  runtimeOptions.treeShaking = true;
  const $d = parse(new Log(), runtimeSource(unsupportedJSFeatures), optionsFromConfig(runtimeOptions));
  if (!$d[1]) throw new globalThis.Error("runtime parse failed");
  return $d[0];
}

const base64URLChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// 12 random bytes in URL-safe base64 (16 characters). The prefix is never
// written to transform output (see linker.breakJoinerIntoPieces), so a
// non-cryptographic source of randomness is enough.
export function generateUniqueKeyPrefix() {
  let s = "";
  for (let i = 0; i < 16; i++) s += base64URLChars[(Math.random() * 64) | 0];
  return s;
}

export function applyOptionDefaults(options) {
  // (A missing "extensionToLoader" is replaced by the default map where it is
  // read, so that "options" keeps the config.Options object shape)

  // (output extensions and path templates only affect output paths, which a
  // transform never exposes; see linker.generateChunksInParallel)

  options.profilerNames = !options.minifyIdentifiers;

  // Automatically fix invalid configurations of unsupported features
  fixInvalidUnsupportedJSFeatureOverrides(options, AsyncAwait, jsFeatureOr(jsFeatureOr(AsyncGenerator, ForAwait), TopLevelAwait));
  fixInvalidUnsupportedJSFeatureOverrides(options, Generator, AsyncGenerator);
  fixInvalidUnsupportedJSFeatureOverrides(options, ObjectAccessors, jsFeatureOr(ClassPrivateAccessor, ClassPrivateStaticAccessor));
  fixInvalidUnsupportedJSFeatureOverrides(options, ClassField, ClassPrivateField);
  fixInvalidUnsupportedJSFeatureOverrides(options, ClassStaticField, ClassPrivateStaticField);
  fixInvalidUnsupportedJSFeatureOverrides(options, Class, CLASS_IMPLIED_FEATURES);

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

const CLASS_IMPLIED_FEATURES = [
  ClassPrivateAccessor,
  ClassPrivateBrandCheck,
  ClassPrivateField,
  ClassPrivateMethod,
  ClassPrivateStaticAccessor,
  ClassPrivateStaticField,
  ClassPrivateStaticMethod,
  ClassStaticBlocks,
  ClassStaticField,
].reduce(jsFeatureOr, ClassField);

function fixInvalidUnsupportedJSFeatureOverrides(options, implies, implied) {
  // If this feature is unsupported, that implies that the other features must also be unsupported
  if (jsFeatureHas(options.unsupportedJSFeatureOverrides, implies)) {
    options.unsupportedJSFeatures = jsFeatureOr(options.unsupportedJSFeatures, implied);
    options.unsupportedJSFeatureOverrides = jsFeatureOr(options.unsupportedJSFeatureOverrides, implied);
    options.unsupportedJSFeatureOverridesMask = jsFeatureOr(options.unsupportedJSFeatureOverridesMask, implied);
  }
}

class Bundle {
  declare uniqueKeyPrefix: any;
  declare files: any;
  declare entryPoints: any;
  declare options: any;
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

  // Returns [outputFiles, metafileJSON]. "mangleCache" is a Map<string,
  // string | false> or null (Go: nil).
  compile(log, timer, mangleCache, linkFn) {
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

  compileImpl(log, timer, mangleCache, linkFn) {
    const b = this;
    // (Go copies the options to install ExclusiveMangleCacheUpdate, which
    // hands "mangleCache" to the linker; here it is passed to linkFn directly.
    // The linker never mutates the options.)
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

    let resultGroups;
    if (options.codeSplitting || b.entryPoints.length === 1) {
      // If code splitting is enabled or if there's only one entry point, link all entry points together
      resultGroups = [
        linkFn(options, timer, log, null, null, files, b.entryPoints, b.uniqueKeyPrefix, allReachableFiles, dataForSourceMaps, mangleCache),
      ];
    } else {
      throw new GoPanic("Internal error"); // (a transform has one entry point)
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
            result.quotedContents = nestedQuotedContents(sm, options.asciiOnly);
          }
        }
      }
    }

    return () => results;
  }
}

// bundler.go computeDataForSourceMapsInParallel's "Complex case: nested
// source map": the quoted "sourcesContent" of an input source map
export function nestedQuotedContents(sm: any, asciiOnly: boolean): string[] {
  const quotedContents = new Array(sm.sources.length);
  const nullContents = "null";
  for (let i = 0; i < sm.sources.length; i++) {
    // Missing contents become a "null" literal
    let quoted = nullContents;
    if (i < sm.sourcesContent.length) {
      const value = sm.sourcesContent[i];
      if (value.quoted !== "" && (!asciiOnly || !isASCIIOnlyText(value.quoted))) {
        // Just use the value directly from the input file
        quoted = value.quoted;
      } else if (value.value !== null) {
        // Re-quote non-ASCII values if output is ASCII-only. Also quote values
        // that haven't been quoted yet (happens when the entire
        // "sourcesContent" array is absent and the source has been found on
        // the file system using the "sources" array).
        quoted = quoteForJSON(value.value, asciiOnly);
      }
    }
    quotedContents[i] = quoted;
  }
  return quotedContents;
}

function isASCIIOnlyText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

// fs.MockFS(make(map[string]string), fs.MockUnix, "/"): the file system of a
// transform (only what loading an input source map can use)
export const transformMockFS = {
  cwd(): string {
    return "/";
  },
  readFile(path: string): [Uint8Array | null, any, any] {
    return [null, ENOENT, ENOENT];
  },
  modKey(path: string): [any, any] {
    return [null, new GoError("This is not available during tests")];
  },
  isAbs(p: string): boolean {
    return p.startsWith("/");
  },
};

// This is data related to source maps. It's computed in parallel with linking
// and must be ready by the time printing happens. This is beneficial because
// it is somewhat expensive to produce.
export class DataForSourceMap {
  declare lineOffsetTables: any;
  declare quotedContents: any;
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
  declare log: any;
  declare uniqueKeyPrefix: any;
  declare results: any[];
  declare options: any;
  declare sourceIndexCache: Map<string, number>;
  constructor(log, options, uniqueKeyPrefix) {
    this.log = log;
    this.uniqueKeyPrefix = uniqueKeyPrefix;
    this.results = []; // []parseResult
    this.options = options;
    this.sourceIndexCache = new Map(); // path text -> source index (all paths are in the "" namespace)
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
          throw new GoPanic("Internal error"); // (a transform's stdin has no resolve directory)
        }
      }
      const sourceIndex = s.maybeParseStdin(stdinPath, makePrettyPaths(stdinPath));
      entryMetas.push(new EntryPoint("stdin", sourceIndex));
    } else {
      throw new GoPanic("Internal error"); // (a transform always has stdin)
    }

    // (There are no other entry points. "AbsOutputBase" would now be set to
    // the current directory, which only affects output paths.)
    return entryMetas;
  }

  // Go: allocateSourceIndex with the fresh cache.SourceIndexCache of a
  // transform (source indices are handed out in order after the runtime's,
  // the same path gets the same index)
  allocateSourceIndex(path) {
    const s = this;
    let sourceIndex = s.sourceIndexCache.get(path.text);
    if (sourceIndex === undefined) {
      sourceIndex = RUNTIME_SOURCE_INDEX + 1 + s.sourceIndexCache.size;
      s.sourceIndexCache.set(path.text, sourceIndex);
    }

    // Grow the results array to fit this source index
    while (s.results.length < sourceIndex + 1) s.results.push(new parseResult());
    return sourceIndex;
  }

  // The "--define" half of preprocessInjectedFiles (a transform has no
  // "inject" paths)
  preprocessInjectedFiles() {
    const s = this;
    const injectedFiles = [];

    // These are virtual paths that are generated for compound "--define" values.
    // They are special-cased and are not available for plugins to intercept.
    for (let $i = 0; $i < s.options.injectedDefines.length; $i++) {
      const define = s.options.injectedDefines[$i];
      // These should be unique by construction so no need to check for collisions
      const visitedKey = new Path("<define:" + define.name + ">");
      const sourceIndex = s.allocateSourceIndex(visitedKey);
      const source = new Source(makePrettyPaths(visitedKey), ensureValidIdentifier(visitedKey.text), define.source.contents, visitedKey, sourceIndex);

      // The first "len(InjectedDefine)" injected files intentionally line up
      // with the injected defines by index. The index will be used to import
      // references to them in the parser.
      injectedFiles.push(new InjectedFile([], define.name, source));

      // Generate the file inline here since it has already been parsed.
      // (The value is copied: the cached options share it between transforms,
      // while Go parses it anew for each one.)
      const expr = new Expr(cloneJSONValue(define.data), 0);
      const ast = lazyExportAST(s.log, source, optionsFromConfig(s.options), expr, null);
      const inputFile = new InputFile(null, null, [], "", new SideEffects(null, NoSideEffects_PureData), source, LoaderJSON);
      inputFile.repr = new JSRepr();
      inputFile.repr.ast = ast;
      s.results[sourceIndex] = new parseResult(new scannerFile(inputFile), true);
    }

    s.options.injectedFiles = injectedFiles;
  }

  // maybeParseFile for the stdin file (inputKindStdin)
  maybeParseStdin(path, prettyPaths) {
    const s = this;

    // Only parse a given file path once. (A "sourcefile" equal to a
    // "<define:...>" path is the injected file: it is the entry point then.)
    const visited = s.sourceIndexCache.get(path.text);
    if (visited !== undefined) return visited;
    const sourceIndex = s.allocateSourceIndex(path);

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

// ScanBundle for config.TransformCall (no file system, caches or entry
// points: a transform only has the stdin file)
function scanBundle(call, log, options, timer: Timer | null) {
  if (timer === null) {
    return scanBundleImpl(call, log, options, timer);
  }
  timer?.begin("Scan phase");
  try {
    return scanBundleImpl(call, log, options, timer);
  } finally {
    timer?.end("Scan phase");
  }
}

function scanBundleImpl(call, log, options, timer: Timer | null) {
  options = cloneConfigOptions(options);

  applyOptionDefaults(options);

  timer?.begin("On-start callbacks");
  timer?.end("On-start callbacks");

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

  // Injected files: "--define" values that aren't primitives generate
  // additional files (and "inject" paths, which only the build API has)
  timer?.begin("Preprocess injected files");
  s.preprocessInjectedFiles();
  timer?.end("Preprocess injected files");

  timer?.begin("Add entry points");
  const entryPointMeta = s.addEntryPoints();
  timer?.end("Add entry points");

  // (Import records are only resolved when bundling: nothing to scan)
  timer?.begin("Scan all dependencies");
  timer?.end("Scan all dependencies");

  timer?.begin("Process scanned files");
  const files = s.processScannedFiles(entryPointMeta);
  timer?.end("Process scanned files");

  return new Bundle(uniqueKeyPrefix, files, entryPointMeta, s.options);
}

// Runs bundler.ScanBundle + Bundle.Compile(linker.Link) for a validated
// config.Options of a transform (stdin set, mode pass-through or convert
// format) and selects the results like api.transformImpl. Returns
// { code, map, legalComments } as JS strings; map is "" when there is no
// external source map, legalComments is null when esbuild
// would not return a legal comments file.
// Whether the stdin file of a transform has the path of an injected define
// file ("<define:NAME>"): see scanner.maybeParseStdin
function stdinIsInjectedDefine(options) {
  const stdin = options.stdin;
  if (stdin.sourceFile === "") return false;
  for (let i = 0; i < options.injectedDefines.length; i++) {
    if ("<define:" + options.injectedDefines[i].name + ">" === stdin.sourceFile) return true;
  }
  return false;
}

// "mangleCache" is the Map<string, string | false> that api.transformImpl gets
// from cloneMangleCache (null for Go's nil); the linker updates it in place.
export function transformBundle(configOptions, log, mangleCache = null) {
  if (log === undefined || log === null) log = new Log();
  const timer = newTimerIfEnabled();
  if (timer === null) return transformBundleImpl(configOptions, log, mangleCache, null);
  try {
    return transformBundleImpl(configOptions, log, mangleCache, timer);
  } finally {
    timer?.log(log);
  }
}

function transformBundleImpl(configOptions, log, mangleCache, timer: Timer | null) {
  {
    // A CSS stdin file: see linker_css.mjs (JS-only: the JS runtime and the
    // JavaScript half of the linker never contribute to a CSS transform)
    // (unless the entry point is an injected "<define:...>" file because the
    // "sourcefile" has its name: then it is a JavaScript transform)
    if (loaderIsCSS(configOptions.stdin.loader) && !stdinIsInjectedDefine(configOptions)) return transformBundleCSS(configOptions, log, mangleCache, timer);

    // Scan over the bundle
    const bundle = scanBundle(TransformCall, log, configOptions, timer);

    // Stop now if there were errors
    if (log.hasErrors()) return { code: "", map: "", legalComments: null };

    // Compile the bundle
    const $d229 = bundle.compile(log, timer, mangleCache, link);
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
  }
}
