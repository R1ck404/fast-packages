// Port of internal/linker/linker.go: the subset that is reachable from
// api.Transform (exactly one JS entry point plus the runtime file, no code
// splitting, no CSS, no metafile, no minification, no property mangling; source
// maps without input source maps). Everything else bails. See CONVENTIONS.md.
//
// The Go code runs several steps on goroutines; this port runs them
// sequentially in the same order. Output paths are not computed (see
// generateChunksInParallel): a transform always produces exactly one chunk,
// so the chunk file is always the shortest output path and the legal comments
// file is always "<chunk path>.LEGAL.txt".
//
// Other JS-only differences, none of which change the output:
// - the cached runtime AST is cloned partly copy-on-write (graph.mjs), so
//   symbol and "part.symbolUses" writes go through writableSymbol() /
//   writableSymbolChain() / writableSymbolUses()
// - the statements of the runtime's namespace export part are built lazily
//   (createExportsForFile)
// - ast.FollowAllSymbols is skipped (it only exists for goroutine safety)
// - Go's unstable sorts are only used on unique keys here
import { bail } from "./bail.mjs";
import { Error as MsgError, Warning as MsgWarning, Debug as MsgDebug, MsgID_Bundler_ImportIsUndefined } from "./logger.mjs";
import { Joiner, quoteForJSON, escapeClosingTag, isInsideNodeModules } from "./helpers.mjs";
import {
  InvalidRef,
  LocRef,
  NamespaceAlias,
  refSource,
  refInner,
  makeRef,
  followSymbols,
  mergeSymbols,
  ImportStmt,
  ImportRequire,
  ImportDynamic,
  ContainsImportStar,
  ContainsDefaultAlias,
  ContainsESModuleAlias,
  CallsRunTimeReExportFn,
  WrapWithToESM,
  WrapWithToCJS,
  CallRuntimeRequire,
  IsExternalWithoutSideEffects,
  SymbolUnbound,
  SymbolOther,
  SymbolImport,
  SymbolTSEnum,
  ImportItemGenerated,
  ImportItemMissing,
  MustNotBeRenamed,
  IsEmptyFunction,
  IsIdentityFunction,
  CouldPotentiallyBeMutated,
} from "./ast.mjs";
import {
  Expr,
  Stmt,
  Binding,
  Part,
  Dependency,
  DeclaredSymbol,
  SymbolUse,
  Property,
  Arg,
  Fn,
  FnBody,
  ClauseItem,
  Decl,
  EArrow,
  EAwait,
  EBinary,
  ECall,
  EDot,
  EFunction,
  EIdentifier,
  EImportIdentifier,
  ENumber,
  EObject,
  ERequireString,
  EString,
  ENullShared,
  BIdentifier,
  SBlock,
  SComment,
  SDirective,
  SExportClause,
  SExportDefault,
  SExpr,
  SFunction,
  SClass,
  SImport,
  SLocal,
  SReturn,
  S_IMPORT,
  S_EXPORT_STAR,
  S_EXPORT_FROM,
  S_EXPORT_CLAUSE,
  S_EXPORT_DEFAULT,
  S_FUNCTION,
  S_CLASS,
  S_LOCAL,
  S_EXPR,
  PropertyField,
  PropertyMethod,
  PropertySpread,
  PropertyIsComputed,
  BinOpLogicalAnd,
  ExportsNone,
  ExportsCommonJS,
  ExportsESM,
  ExportsESMWithDynamicFallback,
  exportsKindIsDynamic,
  NSExportPartIndex,
} from "./js_ast.mjs";
import {
  ModePassThrough,
  ModeConvertFormat,
  ModeBundle,
  FormatPreserve,
  FormatIIFE,
  FormatCommonJS,
  FormatESModule,
  formatKeepESMImportExportSyntax,
  shouldCallRuntimeRequire,
  PlatformNode,
  LegalCommentsNone,
  LegalCommentsInline,
  LegalCommentsEndOfFile,
  LegalCommentsLinkedWithComment,
  LegalCommentsExternalWithoutComment,
  SourceMapNone,
  SourceMapInline,
  SourceMapLinkedWithComment,
  SourceMapExternalWithoutComment,
  SourceMapInlineAndExternal,
  LoaderJS,
  LoaderJSX,
  LoaderTS,
  LoaderTSNoAmbiguousLessThan,
  LoaderTSX,
  LoaderCSS,
  LoaderGlobalCSS,
  LoaderLocalCSS,
  LoaderJSON,
  LoaderWithTypeJSON,
  LoaderText,
  loaderIsTypeScript,
} from "./config.mjs";
import {
  JSRepr,
  CSSRepr,
  CopyRepr,
  OutputFile,
  ImportData,
  ExportData,
  HasSideEffects,
  WrapNone,
  WrapCJS,
  WrapESM,
  EMPTY_ARRAY,
  writableSymbolUses,
  writableSymbol,
  writableSymbolChain,
  sortedResolvedExportAliases,
  cloneLinkerGraph,
  cloneAST,
  newBitSet,
} from "./graph.mjs";
import { assign, assignStmt, joinWithComma, convertBindingToExpr, forEachIdentifierBindingInDecls } from "./js_ast_helpers.mjs";
import { isIdentifier, isIdentifierES5AndESNext } from "./js_ident.mjs";
import { Keywords } from "./js_lexer.mjs";
import { print as printJS, Options as PrinterOptions } from "./js_printer.mjs";
import { computeReservedNames, newNumberRenamer } from "./renamer.mjs";
import {
  LineColumnOffset,
  SourceMapPieces,
  SourceMapShift,
  SourceMapState,
  MappingsBuffer,
  Chunk as SourceMapChunk,
  appendSourceMapChunk,
} from "./sourcemap.mjs";

const RUNTIME_SOURCE_INDEX = 0; // runtime.SourceIndex

// config.Loader.CanHaveSourceMap()
export function loaderCanHaveSourceMap(loader) {
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

// Go: base64.StdEncoding.EncodeToString(bytes), where the bytes are the UTF-8
// encoding of the JS string "text"
const base64StdChars = new Uint8Array(64);
for (let i = 0; i < 64; i++) base64StdChars[i] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".charCodeAt(i);
let utf8Encoder = null;
let asciiDecoder = null;
function base64StdEncodeUTF8(text) {
  if (utf8Encoder === null) {
    utf8Encoder = new TextEncoder();
    asciiDecoder = new TextDecoder();
  }
  const bytes = utf8Encoder.encode(text);
  const n = bytes.length;
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = base64StdChars[v >> 18];
    out[o++] = base64StdChars[(v >> 12) & 63];
    out[o++] = base64StdChars[(v >> 6) & 63];
    out[o++] = base64StdChars[v & 63];
  }
  if (i < n) {
    // Pad the final group with "="
    const v = (bytes[i] << 16) | (i + 1 < n ? bytes[i + 1] << 8 : 0);
    out[o++] = base64StdChars[v >> 18];
    out[o++] = base64StdChars[(v >> 12) & 63];
    out[o++] = i + 1 < n ? base64StdChars[(v >> 6) & 63] : 61;
    out[o++] = 61;
  }
  return asciiDecoder.decode(out);
}

// ---------------------------------------------------------------------------
// Types

class linkerContext {
  constructor(options, log, uniqueKeyPrefix) {
    this.options = options;
    this.log = log;
    this.graph = null; // LinkerGraph
    this.chunks = []; // []chunkInfo

    // func() []bundler.DataForSourceMap (only called when source maps are on)
    this.dataForSourceMaps = null;

    // This helps avoid an infinite loop when matching imports to exports
    this.cycleDetector = []; // []importTracker

    this.uniqueKeyPrefix = uniqueKeyPrefix;

    // Property mangling results go here
    this.mangledProps = null; // Map<Ref, string>

    // We may need to refer to the CommonJS "module" symbol for exports
    this.unboundModuleRef = InvalidRef;

    // We may need to refer to the "__esm" and/or "__commonJS" runtime symbols
    this.cjsRuntimeRef = InvalidRef;
    this.esmRuntimeRef = InvalidRef;

    // JS-only: "c.requireOrImportMetaForSource" bound to this context (Go
    // passes the method value to the printer)
    this.requireOrImportMetaForSourceFn = null;

    // JS-only: source index -> builder of the statements of the namespace
    // export part, for parts whose statements are built lazily (see
    // createExportsForFile)
    this.lazyNSExportStmts = new Map();
  }
}

class partRange {
  constructor(sourceIndex, partIndexBegin, partIndexEnd) {
    this.sourceIndex = sourceIndex;
    this.partIndexBegin = partIndexBegin;
    this.partIndexEnd = partIndexEnd;
  }
}

class chunkInfo {
  constructor() {
    this.uniqueKey = "";
    this.filesWithPartsInChunk = null; // Set<number> (Go: map[uint32]bool)
    this.entryBits = null; // BitSet
    this.crossChunkImports = []; // []chunkImport
    this.chunkRepr = null; // chunkReprJS
    this.finalRelPath = "";
    this.externalLegalComments = "";
    this.outputSourceMap = new SourceMapPieces(); // sourcemap.SourceMapPieces
    this.intermediateOutput = null;
    this.entryPointBit = 0;
    this.sourceIndex = 0;
    this.isEntryPoint = false;
    this.isExecutable = false;
  }
}

class chunkReprJS {
  constructor() {
    this.filesInChunkInOrder = [];
    this.partsInChunkInOrder = [];

    // For code splitting
    this.exportsToOtherChunks = null;
    this.importsFromOtherChunks = null;
    this.crossChunkPrefixStmts = EMPTY_ARRAY;
    this.crossChunkSuffixStmts = EMPTY_ARRAY;

    this.cssChunkIndex = 0;
    this.hasCSSChunk = false;
  }
}

// Only the "joiner" form exists in the port: output containing the unique key
// prefix bails (see breakJoinerIntoPieces).
class intermediateOutput {
  constructor(pieces, joiner) {
    this.pieces = pieces;
    this.joiner = joiner;
  }
}

class stmtList {
  constructor() {
    // These statements come first, and can be inside the wrapper
    this.insideWrapperPrefix = [];

    // These statements come last, and can be inside the wrapper
    this.insideWrapperSuffix = [];

    this.outsideWrapperPrefix = [];
  }
}

class compileResultJS {
  constructor() {
    // js_printer.PrintResult (embedded)
    this.js = "";
    this.extractedLegalComments = null;
    this.jsonMetadataImports = null;
    this.sourceMapChunk = null;

    this.sourceIndex = 0;

    // This is the line and column offset since the previous JavaScript string
    // or the start of the file if this is the first JavaScript string.
    this.generatedOffset = null; // sourcemap.LineColumnOffset
  }
  setPrintResult(result) {
    this.js = result.js;
    this.extractedLegalComments = result.extractedLegalComments === undefined ? null : result.extractedLegalComments;
    this.jsonMetadataImports = result.jsonMetadataImports === undefined ? null : result.jsonMetadataImports;
    this.sourceMapChunk = result.sourceMapChunk === undefined ? null : result.sourceMapChunk;
  }
}

class compileResultForSourceMap {
  constructor(sourceMapChunk, generatedOffset, sourceIndex, isNullEntry) {
    this.sourceMapChunk = sourceMapChunk; // sourcemap.Chunk
    this.generatedOffset = generatedOffset; // sourcemap.LineColumnOffset
    this.sourceIndex = sourceIndex;
    this.isNullEntry = isNullEntry;
  }
}

// js_printer.RequireOrImportMeta (only read by the printer)
class RequireOrImportMeta {
  constructor(wrapperRef = InvalidRef, exportsRef = InvalidRef, isWrapperAsync = false) {
    this.wrapperRef = wrapperRef;
    this.exportsRef = exportsRef;
    this.isWrapperAsync = isWrapperAsync;
  }
}

class legalCommentEntry {
  constructor(sourceIndex, comments) {
    this.sourceIndex = sourceIndex;
    this.comments = comments;
  }
}

// ---------------------------------------------------------------------------
// Link

// Same parameter list as Go's linker.Link (timer, fs and res are unused and
// may be null; dataForSourceMaps is a function returning the
// []bundler.DataForSourceMap, only called when source maps are enabled).
// Returns []OutputFile.
export function link(options, timer, log, fs, res, inputFiles, entryPoints, uniqueKeyPrefix, reachableFiles, dataForSourceMaps) {
  const c = new linkerContext(options, log, uniqueKeyPrefix);
  c.dataForSourceMaps = dataForSourceMaps;
  c.graph = cloneLinkerGraph(inputFiles, reachableFiles, entryPoints, options.codeSplitting);

  // Use a smaller version of these functions if we don't need profiler names
  const runtimeRepr = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr;
  if (c.options.profilerNames) {
    c.cjsRuntimeRef = runtimeRepr.ast.namedExports.get("__commonJS").ref;
    c.esmRuntimeRef = runtimeRepr.ast.namedExports.get("__esm").ref;
  } else {
    c.cjsRuntimeRef = runtimeRepr.ast.namedExports.get("__commonJSMin").ref;
    c.esmRuntimeRef = runtimeRepr.ast.namedExports.get("__esmMin").ref;
  }

  const additionalFiles = [];
  for (const entryPoint of entryPoints) {
    const file = c.graph.files[entryPoint.sourceIndex].inputFile;
    const repr = file.repr;
    if (repr instanceof JSRepr) {
      // Loaders default to CommonJS when they are the entry point and the output
      // format is not ESM-compatible since that avoids generating the ESM-to-CJS
      // machinery.
      if (
        repr.ast.hasLazyExport &&
        (c.options.mode === ModePassThrough || (c.options.mode === ModeConvertFormat && !formatKeepESMImportExportSyntax(c.options.outputFormat)))
      ) {
        repr.ast.exportsKind = ExportsCommonJS;
      }

      // Entry points with ES6 exports must generate an exports object when
      // targeting non-ES6 formats. Note that the IIFE format only needs this
      // when the global name is present, since that's the only way the exports
      // can actually be observed externally.
      if (
        repr.ast.exportKeyword.len > 0 &&
        (options.outputFormat === FormatCommonJS || (options.outputFormat === FormatIIFE && options.globalName.length > 0))
      ) {
        repr.ast.usesExportsRef = true;
        repr.meta.forceIncludeExportsForEntryPoint = true;
      }
    } else if (repr instanceof CopyRepr) {
      for (const f of file.additionalFiles) additionalFiles.push(f);
    }
  }

  // Allocate a new unbound symbol called "module" in case we need it later
  if (c.options.outputFormat === FormatCommonJS) {
    c.unboundModuleRef = c.graph.generateNewSymbol(RUNTIME_SOURCE_INDEX, SymbolUnbound, "module");
  } else {
    c.unboundModuleRef = InvalidRef;
  }

  c.scanImportsAndExports();

  // (Errors throw BAIL, so there is no "stop now if there were errors" check)

  c.treeShakingAndCodeSplitting();

  if (c.options.mode === ModePassThrough) {
    for (const entryPoint of c.graph.entryPoints()) {
      c.preventExportsFromBeingRenamed(entryPoint.sourceIndex);
    }
  }

  c.computeChunks();
  c.computeCrossChunkDependencies();

  // Merge mangled properties before chunks are generated since the names must
  // be consistent across all chunks, or the generated code will break
  c.mangleProps(null);
  c.mangleLocalCSS(null);

  // Go calls ast.FollowAllSymbols() here so that calls to "ast.FollowSymbols()"
  // in parallel goroutines after this won't hit concurrent map mutation
  // hazards. It only path-compresses symbol links (nothing reads "link"
  // without following it), so the single-threaded port skips it.

  return c.generateChunksInParallel(additionalFiles);
}

Object.assign(linkerContext.prototype, {
  // Property mangling is not supported by the fast path. With no mangled
  // properties Go's mangleProps just produces an empty map.
  mangleProps(mangleCache) {
    const c = this;
    const mangledProps = new Map();
    c.mangledProps = mangledProps;

    for (const sourceIndex of c.graph.reachableFiles) {
      // Don't mangle anything in the runtime code
      if (sourceIndex === RUNTIME_SOURCE_INDEX) continue;

      const repr = c.graph.files[sourceIndex].inputFile.repr;
      if (repr instanceof JSRepr) {
        if (repr.ast.mangledProps !== null && repr.ast.mangledProps.size > 0) bail(); // (mangle props only)
      }
    }
  },

  mangleLocalCSS(usedLocalNames) {
    const c = this;
    for (const sourceIndex of c.graph.reachableFiles) {
      if (c.graph.files[sourceIndex].inputFile.repr instanceof CSSRepr) bail(); // (CSS only)
    }
  },

  generateChunksInParallel(additionalFiles) {
    const c = this;

    // Generate each chunk. When a chunk needs to reference the path of another
    // chunk, it will use a temporary path called the "uniqueKey" (code
    // splitting only).
    for (let chunkIndex = 0; chunkIndex < c.chunks.length; chunkIndex++) {
      const chunk = c.chunks[chunkIndex];
      if (chunk.chunkRepr instanceof chunkReprJS) {
        c.generateChunkJS(chunkIndex);
      } else {
        bail(); // (CSS only)
      }
    }
    // (enforceNoCyclicChunkImports: there are no cross-chunk imports)

    // Compute the final paths of each chunk. The transform API only looks at
    // the relative lengths of the output paths (see the top of this file), so
    // the path templates are not evaluated and a non-empty placeholder is used
    // instead. There is no "[hash]" placeholder in the transform API's entry
    // path template.
    for (let chunkIndex = 0; chunkIndex < c.chunks.length; chunkIndex++) {
      c.chunks[chunkIndex].finalRelPath = "<chunk" + chunkIndex + ">";
    }

    // Generate the final output files by joining file pieces together
    const results = new Array(c.chunks.length);
    for (let chunkIndex = 0; chunkIndex < c.chunks.length; chunkIndex++) {
      const chunk = c.chunks[chunkIndex];
      const outputFiles = [];

      // Each file may optionally contain additional files to be copied to the
      // output directory. This is used by the "file" and "copy" loaders.
      // (Only JS chunks exist here.)
      for (const sourceIndex of chunk.chunkRepr.filesInChunkInOrder) {
        for (const f of c.graph.files[sourceIndex].inputFile.additionalFiles) outputFiles.push(f);
      }
      const commentPrefix = "//";
      const commentSuffix = "";

      // Path substitution for the chunk itself
      const [outputContentsJoiner, outputSourceMapShifts] = c.substituteFinalPaths(chunk.intermediateOutput);

      // Generate the optional legal comments file for this chunk
      if (chunk.externalLegalComments.length > 0) {
        const finalRelPathForLegalComments = chunk.finalRelPath + ".LEGAL.txt";

        // Link the file to the legal comments
        if (c.options.legalComments === LegalCommentsLinkedWithComment) bail(); // (build only)

        // Write the external legal comments file
        outputFiles.push(new OutputFile("", finalRelPathForLegalComments, chunk.externalLegalComments));
      }

      // Generate the optional source map for this chunk
      if (c.options.sourceMap !== SourceMapNone && chunk.outputSourceMap.hasContent()) {
        const outputSourceMap = chunk.outputSourceMap.finalize(outputSourceMapShifts);
        const finalRelPathForSourceMap = chunk.finalRelPath + ".map";

        // Potentially write a trailing source map comment
        switch (c.options.sourceMap) {
          case SourceMapLinkedWithComment:
            bail(); // (build only: transforms reject linked source maps)
            break;

          case SourceMapInline:
          case SourceMapInlineAndExternal:
            outputContentsJoiner.ensureNewlineAtEnd();
            outputContentsJoiner.addString(commentPrefix);
            outputContentsJoiner.addString("# sourceMappingURL=data:application/json;base64,");
            outputContentsJoiner.addString(base64StdEncodeUTF8(outputSourceMap));
            outputContentsJoiner.addString(commentSuffix);
            outputContentsJoiner.addString("\n");
            break;
        }

        // Potentially write the external source map file
        switch (c.options.sourceMap) {
          case SourceMapLinkedWithComment:
          case SourceMapInlineAndExternal:
          case SourceMapExternalWithoutComment:
            outputFiles.push(new OutputFile("", finalRelPathForSourceMap, outputSourceMap));
            break;
        }
      }

      // Finalize the output contents
      const outputContents = outputContentsJoiner.done();

      // Generate the output file for this chunk
      outputFiles.push(new OutputFile("", chunk.finalRelPath, outputContents, chunk.isExecutable));

      results[chunkIndex] = outputFiles;
    }

    // Merge the output files together in order
    const outputFiles = additionalFiles.slice();
    for (const result of results) for (const f of result) outputFiles.push(f);
    return outputFiles;
  },

  // Given a set of output pieces (i.e. a buffer already divided into the spans
  // between import paths), substitute the final import paths in and then join
  // everything into a single buffer. Returns [joiner, []sourcemap.SourceMapShift].
  substituteFinalPaths(intermediateOutput) {
    // Optimization: If there can be no substitutions, just reuse the initial
    // joiner that was used when generating the intermediate chunk output
    // instead of creating another one and copying the whole file into it.
    if (intermediateOutput.pieces === null) return [intermediateOutput.joiner, [new SourceMapShift()]];
    bail(); // (code splitting / "file" and "copy" loaders only)
  },

  computeCrossChunkDependencies() {
    const c = this;
    if (!c.options.codeSplitting) {
      // No need to compute cross-chunk dependencies if there can't be any
      return;
    }
    bail(); // (code splitting only)
  },
});

// ---------------------------------------------------------------------------
// scanImportsAndExports

Object.assign(linkerContext.prototype, {
  scanImportsAndExports() {
    const c = this;
    const graph = c.graph;
    const files = graph.files;
    const reachableFiles = graph.reachableFiles;

    // Step 1: Figure out what modules must be CommonJS
    for (const sourceIndex of reachableFiles) {
      const file = files[sourceIndex];
      const additionalFiles = file.inputFile.additionalFiles;
      const repr = file.inputFile.repr;

      if (repr instanceof CSSRepr) {
        bail(); // (CSS only)
      } else if (repr instanceof JSRepr) {
        const records = repr.ast.importRecords;
        for (let importRecordIndex = 0; importRecordIndex < records.length; importRecordIndex++) {
          const record = records[importRecordIndex];
          if (!(record.sourceIndex >= 0)) {
            if (record.copySourceIndex >= 0) {
              const otherFile = files[record.copySourceIndex];
              if (otherFile.inputFile.repr instanceof CopyRepr) bail(); // ("copy" loader only)
            }
            continue;
          }

          const otherFile = files[record.sourceIndex];
          const otherRepr = otherFile.inputFile.repr;
          if (!(otherRepr instanceof JSRepr)) bail(); // Go: type assertion panic

          switch (record.kind) {
            case ImportStmt:
              // Importing using ES6 syntax from a file without any ES6 syntax
              // causes that module to be considered CommonJS-style, even if it
              // doesn't have any CommonJS exports.
              //
              // That means the ES6 imports will become undefined instead of
              // causing errors. This is for compatibility with older CommonJS-
              // style bundlers.
              //
              // We emit a warning in this case but try to avoid turning the module
              // into a CommonJS module if possible. This is possible with named
              // imports (the module stays an ECMAScript module but the imports are
              // rewritten with undefined) but is not possible with star or default
              // imports:
              //
              //   import * as ns from './empty-file'
              //   import defVal from './empty-file'
              //   console.log(ns, defVal)
              //
              // In that case the module *is* considered a CommonJS module because
              // the namespace object must be created.
              if (
                ((record.flags & ContainsImportStar) !== 0 || (record.flags & ContainsDefaultAlias) !== 0) &&
                otherRepr.ast.exportsKind === ExportsNone &&
                !otherRepr.ast.hasLazyExport
              ) {
                otherRepr.meta.wrap = WrapCJS;
                otherRepr.ast.exportsKind = ExportsCommonJS;
              }
              break;

            case ImportRequire:
              // Files that are imported with require() must be wrapped so that
              // they can be lazily-evaluated
              if (otherRepr.ast.exportsKind === ExportsESM) {
                otherRepr.meta.wrap = WrapESM;
              } else {
                otherRepr.meta.wrap = WrapCJS;
                otherRepr.ast.exportsKind = ExportsCommonJS;
              }
              break;

            case ImportDynamic:
              if (!c.options.codeSplitting) {
                // If we're not splitting, then import() is just a require() that
                // returns a promise, so the imported file must also be wrapped
                if (otherRepr.ast.exportsKind === ExportsESM) {
                  otherRepr.meta.wrap = WrapESM;
                } else {
                  otherRepr.meta.wrap = WrapCJS;
                  otherRepr.ast.exportsKind = ExportsCommonJS;
                }
              }
              break;
          }
        }

        // If the output format doesn't have an implicit CommonJS wrapper, any file
        // that uses CommonJS features will need to be wrapped, even though the
        // resulting wrapper won't be invoked by other files. An exception is made
        // for entry point files in CommonJS format (or when in pass-through mode).
        if (
          repr.ast.exportsKind === ExportsCommonJS &&
          (!file.isEntryPoint() || c.options.outputFormat === FormatIIFE || c.options.outputFormat === FormatESModule)
        ) {
          repr.meta.wrap = WrapCJS;
        }
      }

      file.inputFile.additionalFiles = additionalFiles;
    }

    // Step 2: Propagate dynamic export status for export star statements that
    // are re-exports from a module whose exports are not statically analyzable.
    // In this case the export star must be evaluated at run time instead of at
    // bundle time.
    for (const sourceIndex of reachableFiles) {
      const repr = files[sourceIndex].inputFile.repr;
      if (!(repr instanceof JSRepr)) continue;

      if (repr.meta.wrap !== WrapNone) {
        c.recursivelyWrapDependencies(sourceIndex);
      }

      if (repr.ast.exportStarImportRecords.length > 0) {
        const visited = new Set();
        c.hasDynamicExportsDueToExportStar(sourceIndex, visited);
      }

      // Even if the output file is CommonJS-like, we may still need to wrap
      // CommonJS-style files. Any file that imports a CommonJS-style file will
      // cause that file to need to be wrapped. This is because the import
      // method, whatever it is, will need to invoke the wrapper. Note that
      // this can include entry points (e.g. an entry point that imports a file
      // that imports that entry point).
      for (const record of repr.ast.importRecords) {
        if (record.sourceIndex >= 0) {
          const otherRepr = files[record.sourceIndex].inputFile.repr;
          if (otherRepr.ast.exportsKind === ExportsCommonJS) {
            c.recursivelyWrapDependencies(record.sourceIndex);
          }
        }
      }
    }

    // Step 3: Resolve "export * from" statements. This must be done after we
    // discover all modules that can have dynamic exports because export stars
    // are ignored for those modules.
    const exportStarStack = [];
    for (const sourceIndex of reachableFiles) {
      const repr = files[sourceIndex].inputFile.repr;
      if (!(repr instanceof JSRepr)) continue;

      // Expression-style loaders defer code generation until linking. Code
      // generation is done here because at this point we know that the
      // "ExportsKind" field has its final value and will not be changed.
      if (repr.ast.hasLazyExport) {
        c.generateCodeForLazyExport(sourceIndex);
      }

      // Propagate exports for export star statements
      if (repr.ast.exportStarImportRecords.length > 0) {
        c.addExportsForExportStar(repr.meta.resolvedExports, sourceIndex, exportStarStack);
      }

      // Also add a special export so import stars can bind to it. This must be
      // done in this step because it must come after CommonJS module discovery
      // but before matching imports with exports.
      repr.meta.resolvedExportStar = new ExportData(EMPTY_ARRAY, repr.ast.exportsRef, 0, sourceIndex);
    }

    // Step 4: Match imports with exports. This must be done after we process all
    // export stars because imports can bind to export star re-exports.
    for (const sourceIndex of reachableFiles) {
      const file = files[sourceIndex];
      const repr = file.inputFile.repr;
      if (!(repr instanceof JSRepr)) continue;

      if (repr.ast.namedImports.size > 0) {
        c.matchImportsWithExportsForFile(sourceIndex);
      }

      // If we're exporting as CommonJS and this file was originally CommonJS,
      // then we'll be using the actual CommonJS "exports" and/or "module"
      // symbols. In that case make sure to mark them as such so they don't
      // get minified.
      if (
        file.isEntryPoint() &&
        repr.ast.exportsKind === ExportsCommonJS &&
        repr.meta.wrap === WrapNone &&
        (c.options.outputFormat === FormatPreserve || c.options.outputFormat === FormatCommonJS)
      ) {
        const exportsRef = followSymbols(graph.symbols, repr.ast.exportsRef);
        const moduleRef = followSymbols(graph.symbols, repr.ast.moduleRef);
        writableSymbol(graph.symbols, exportsRef).kind = SymbolUnbound;
        writableSymbol(graph.symbols, moduleRef).kind = SymbolUnbound;
      } else if (repr.meta.forceIncludeExportsForEntryPoint || repr.ast.exportsKind !== ExportsCommonJS) {
        repr.meta.needsExportsVariable = true;
      }

      // Create the wrapper part for wrapped files. This is needed by a later step.
      c.createWrapperForFile(sourceIndex);
    }

    // Step 5: Create namespace exports for every file. This is always necessary
    // for CommonJS files, and is also necessary for other files if they are
    // imported using an import star statement.
    for (const sourceIndex of reachableFiles) {
      const repr = files[sourceIndex].inputFile.repr;
      if (!(repr instanceof JSRepr)) continue;

      // Now that all exports have been resolved, sort and filter them to create
      // something we can iterate over later. (The port sorts first and then
      // filters in sorted order, which gives the same result because the
      // filter looks at each alias on its own; the sorted aliases of the
      // cached runtime AST are reused.)
      const aliases = [];
      nextAlias: for (const alias of sortedResolvedExportAliases(repr)) {
        const export_ = repr.meta.resolvedExports.get(alias);
        const otherFile = files[export_.sourceIndex].inputFile;
        const otherRepr = otherFile.repr;

        // Re-exporting multiple symbols with the same name causes an ambiguous
        // export. These names cannot be used and should not end up in generated code.
        if (export_.potentiallyAmbiguousExportStarRefs.length > 0) {
          let mainRef = export_.ref;
          const imported = otherRepr.meta.importsToBind.get(export_.ref);
          if (imported !== undefined) {
            mainRef = imported.ref;
          }

          for (const ambiguousExport of export_.potentiallyAmbiguousExportStarRefs) {
            const ambiguousRepr = files[ambiguousExport.sourceIndex].inputFile.repr;
            let ambiguousRef = ambiguousExport.ref;
            const imported2 = ambiguousRepr.meta.importsToBind.get(ambiguousExport.ref);
            if (imported2 !== undefined) {
              ambiguousRef = imported2.ref;
            }

            if (mainRef !== ambiguousRef) {
              // (a Debug message about the ambiguous re-export is dropped here)
              continue nextAlias;
            }
          }
        }

        // Ignore re-exported imports in TypeScript files that failed to be
        // resolved. These are probably just type-only imports so the best thing to
        // do is to silently omit them from the export list.
        if (otherRepr.meta.isProbablyTypeScriptType.get(export_.ref) === true) {
          continue;
        }

        // (the ArbitraryModuleNamespaceNames check needs a lowered target)

        aliases.push(alias);
      }
      repr.meta.sortedAndFilteredExportAliases = aliases;

      // Export creation uses "sortedAndFilteredExportAliases" so this must
      // come second after we fill in that array
      c.createExportsForFile(sourceIndex);

      c.computeDependenciesForFileParts(sourceIndex, repr);
    }

    // Step 6: Bind imports to exports. This adds non-local dependencies on the
    // parts that declare the export to all parts that use the import. Also
    // generate wrapper parts for wrapped files.
    for (const sourceIndex of reachableFiles) {
      const file = files[sourceIndex];
      const repr = file.inputFile.repr;
      if (!(repr instanceof JSRepr)) continue;

      // Pre-generate symbols for re-exports CommonJS symbols in case they
      // are necessary later. This is done now because the symbols map cannot be
      // mutated later due to parallelism.
      if (file.isEntryPoint() && c.options.outputFormat === FormatESModule) {
        const aliases = repr.meta.sortedAndFilteredExportAliases;
        const copies = new Array(aliases.length);
        for (let i = 0; i < aliases.length; i++) {
          copies[i] = graph.generateNewSymbol(sourceIndex, SymbolOther, "export_" + aliases[i]);
        }
        repr.meta.cjsExportCopies = copies;
      }

      // Use "init_*" for ESM wrappers instead of "require_*"
      if (repr.meta.wrap === WrapESM) {
        writableSymbol(graph.symbols, repr.ast.wrapperRef).originalName = "init_" + file.inputFile.source.identifierName;
      }

      // If this isn't CommonJS, then rename the unused "exports" and "module"
      // variables to avoid them causing the identically-named variables in
      // actual CommonJS files from being renamed. This is purely about
      // aesthetics and is not about correctness. This is done here because by
      // this point, we know the CommonJS status will not change further.
      if (repr.meta.wrap !== WrapCJS && repr.ast.exportsKind !== ExportsCommonJS) {
        const name = file.inputFile.source.identifierName;
        writableSymbol(graph.symbols, repr.ast.exportsRef).originalName = name + "_exports";
        writableSymbol(graph.symbols, repr.ast.moduleRef).originalName = name + "_module";
      }

      // Include the "__export" symbol from the runtime if it was used in the
      // previous step. The previous step can't do this because it's running in
      // parallel and can't safely mutate the "importsToBind" map of another file.
      if (repr.meta.needsExportSymbolFromRuntime) {
        const runtimeRepr = files[RUNTIME_SOURCE_INDEX].inputFile.repr;
        const exportRef = runtimeRepr.ast.moduleScope.members.get("__export").ref;
        graph.generateSymbolImportAndUse(sourceIndex, NSExportPartIndex, exportRef, 1, RUNTIME_SOURCE_INDEX);
      }

      for (const [importRef, importData] of repr.meta.importsToBind) {
        const resolvedRepr = files[importData.sourceIndex].inputFile.repr;
        const partsDeclaringSymbol = resolvedRepr.topLevelSymbolToParts(importData.ref);

        const namedImport = repr.ast.namedImports.get(importRef);
        if (namedImport !== undefined) {
          for (const partIndex of namedImport.localPartsWithUses) {
            const part = repr.ast.parts[partIndex];

            // Depend on the file containing the imported symbol
            for (const resolvedPartIndex of partsDeclaringSymbol) {
              part.dependencies.push(new Dependency(importData.sourceIndex, resolvedPartIndex));
            }

            // Also depend on any files that re-exported this symbol in between the
            // file containing the import and the file containing the imported symbol
            for (const dep of importData.reExports) part.dependencies.push(dep);
          }
        }

        // Merge these symbols so they will share the same name (merging a
        // symbol with itself is a no-op, e.g. for runtime helpers pulled in by
        // GenerateSymbolImportAndUse, so those don't need to become writable)
        if (importRef !== importData.ref) {
          writableSymbolChain(graph.symbols, importRef);
          writableSymbolChain(graph.symbols, importData.ref);
        }
        mergeSymbols(graph.symbols, importRef, importData.ref);
      }

      // If this is an entry point, depend on all exports so they are included
      if (file.isEntryPoint()) {
        const dependencies = [];

        for (const alias of repr.meta.sortedAndFilteredExportAliases) {
          const export_ = repr.meta.resolvedExports.get(alias);
          let targetSourceIndex = export_.sourceIndex;
          let targetRef = export_.ref;

          // If this is an import, then target what the import points to
          let targetRepr = files[targetSourceIndex].inputFile.repr;
          const importData = targetRepr.meta.importsToBind.get(targetRef);
          if (importData !== undefined) {
            targetSourceIndex = importData.sourceIndex;
            targetRef = importData.ref;
            targetRepr = files[targetSourceIndex].inputFile.repr;
            for (const dep of importData.reExports) dependencies.push(dep);
          }

          // Pull in all declarations of this symbol
          for (const partIndex of targetRepr.topLevelSymbolToParts(targetRef)) {
            dependencies.push(new Dependency(targetSourceIndex, partIndex));
          }
        }

        // Ensure "exports" is included if the current output format needs it
        if (repr.meta.forceIncludeExportsForEntryPoint) {
          dependencies.push(new Dependency(sourceIndex, NSExportPartIndex));
        }

        // Include the wrapper if present
        if (repr.meta.wrap !== WrapNone) {
          dependencies.push(new Dependency(sourceIndex, repr.meta.wrapperPartIndex));
        }

        // Represent these constraints with a dummy part
        const entryPart = new Part();
        entryPart.dependencies = dependencies;
        entryPart.canBeRemovedIfUnused = false;
        const entryPointPartIndex = graph.addPartToFile(sourceIndex, entryPart);
        repr.meta.entryPointPartIndex = entryPointPartIndex;

        // Pull in the "__toCommonJS" symbol if we need it due to being an entry point
        if (repr.meta.forceIncludeExportsForEntryPoint) {
          graph.generateRuntimeSymbolImportAndUse(sourceIndex, entryPointPartIndex, "__toCommonJS", 1);
        }
      }

      // Encode import-specific constraints in the dependency graph
      const parts = repr.ast.parts;
      for (let partIndex = 0, partCount = parts.length; partIndex < partCount; partIndex++) {
        const part = parts[partIndex];
        let toESMUses = 0;
        let toCommonJSUses = 0;
        let runtimeRequireUses = 0;

        // Imports of wrapped files must depend on the wrapper
        for (const importRecordIndex of part.importRecordIndices) {
          const record = repr.ast.importRecords[importRecordIndex];

          // Don't follow external imports (this includes import() expressions)
          if (!(record.sourceIndex >= 0) || c.isExternalDynamicImport(record, sourceIndex)) {
            // This is an external import. Check if it will be a "require()" call.
            if (record.kind === ImportRequire || !formatKeepESMImportExportSyntax(c.options.outputFormat)) {
              // (the "import()" lowering case needs a lowered target)

              // We should use "__require" instead of "require" if we're not
              // generating a CommonJS output file, since it won't exist otherwise
              if (shouldCallRuntimeRequire(c.options.mode, c.options.outputFormat)) {
                record.flags |= CallRuntimeRequire;
                runtimeRequireUses++;
              }

              // If this wasn't originally a "require()" call, then we may need
              // to wrap this in a call to the "__toESM" wrapper to convert from
              // CommonJS semantics to ESM semantics.
              //
              // Unfortunately this adds some additional code since the conversion
              // is somewhat complex. As an optimization, we can avoid this if the
              // following things are true:
              //
              // - The import is an ES module statement (e.g. not an "import()" expression)
              // - The ES module namespace object must not be captured
              // - The "default" and "__esModule" exports must not be accessed
              //
              if (
                record.kind !== ImportRequire &&
                (record.kind !== ImportStmt ||
                  (record.flags & ContainsImportStar) !== 0 ||
                  (record.flags & ContainsDefaultAlias) !== 0 ||
                  (record.flags & ContainsESModuleAlias) !== 0)
              ) {
                record.flags |= WrapWithToESM;
                toESMUses++;
              }
            }
            continue;
          }

          const otherSourceIndex = record.sourceIndex;
          const otherRepr = files[otherSourceIndex].inputFile.repr;

          if (otherRepr.meta.wrap !== WrapNone) {
            // Depend on the automatically-generated require wrapper symbol
            const wrapperRef = otherRepr.ast.wrapperRef;
            graph.generateSymbolImportAndUse(sourceIndex, partIndex, wrapperRef, 1, otherSourceIndex);

            // This is an ES6 import of a CommonJS module, so it needs the
            // "__toESM" wrapper as long as it's not a bare "require()"
            if (record.kind !== ImportRequire && otherRepr.ast.exportsKind === ExportsCommonJS) {
              record.flags |= WrapWithToESM;
              toESMUses++;
            }

            // If this is an ESM wrapper, also depend on the exports object
            // since the final code will contain an inline reference to it.
            // This must be done for "require()" and "import()" expressions
            // but does not need to be done for "import" statements since
            // those just cause us to reference the exports directly.
            if (otherRepr.meta.wrap === WrapESM && record.kind !== ImportStmt) {
              graph.generateSymbolImportAndUse(sourceIndex, partIndex, otherRepr.ast.exportsRef, 1, otherSourceIndex);

              // If this is a "require()" call, then we should add the
              // "__esModule" marker to behave as if the module was converted
              // from ESM to CommonJS. This is done via a wrapper instead of
              // by modifying the exports object itself because the same ES
              // module may be simultaneously imported and required, and the
              // importing code should not see "__esModule" while the requiring
              // code should see "__esModule". This is an extremely complex
              // and subtle set of bundler interop issues. See for example
              // https://github.com/evanw/esbuild/issues/1591.
              if (record.kind === ImportRequire) {
                record.flags |= WrapWithToCJS;
                toCommonJSUses++;
              }
            }
          } else if (record.kind === ImportStmt && otherRepr.ast.exportsKind === ExportsESMWithDynamicFallback) {
            // This is an import of a module that has a dynamic export fallback
            // object. In that case we need to depend on that object in case
            // something ends up needing to use it later. This could potentially
            // be omitted in some cases with more advanced analysis if this
            // dynamic export fallback object doesn't end up being needed.
            graph.generateSymbolImportAndUse(sourceIndex, partIndex, otherRepr.ast.exportsRef, 1, otherSourceIndex);
          }
        }

        // If there's an ES6 import of a non-ES6 module, then we're going to need the
        // "__toESM" symbol from the runtime to wrap the result of "require()"
        graph.generateRuntimeSymbolImportAndUse(sourceIndex, partIndex, "__toESM", toESMUses);

        // If there's a CommonJS require of an ES6 module, then we're going to need the
        // "__toCommonJS" symbol from the runtime to wrap the exports object
        graph.generateRuntimeSymbolImportAndUse(sourceIndex, partIndex, "__toCommonJS", toCommonJSUses);

        // If there are unbundled calls to "require()" and we're not generating
        // code for node, then substitute a "__require" wrapper for "require".
        graph.generateRuntimeSymbolImportAndUse(sourceIndex, partIndex, "__require", runtimeRequireUses);

        // If there's an ES6 export star statement of a non-ES6 module, then we're
        // going to need the "__reExport" symbol from the runtime
        let reExportUses = 0;
        for (const importRecordIndex of repr.ast.exportStarImportRecords) {
          const record = repr.ast.importRecords[importRecordIndex];

          // Is this export star evaluated at run time?
          let happensAtRunTime =
            !(record.sourceIndex >= 0) && (!file.isEntryPoint() || !formatKeepESMImportExportSyntax(c.options.outputFormat));
          if (record.sourceIndex >= 0) {
            const otherSourceIndex = record.sourceIndex;
            const otherRepr = files[otherSourceIndex].inputFile.repr;
            if (otherSourceIndex !== sourceIndex && exportsKindIsDynamic(otherRepr.ast.exportsKind)) {
              happensAtRunTime = true;
            }
            if (otherRepr.ast.exportsKind === ExportsESMWithDynamicFallback) {
              // This looks like "__reExport(exports_a, exports_b)". Make sure to
              // pull in the "exports_b" symbol into this export star. This matters
              // in code splitting situations where the "export_b" symbol might live
              // in a different chunk than this export star.
              graph.generateSymbolImportAndUse(sourceIndex, partIndex, otherRepr.ast.exportsRef, 1, otherSourceIndex);
            }
          }
          if (happensAtRunTime) {
            // Depend on this file's "exports" object for the first argument to "__reExport"
            graph.generateSymbolImportAndUse(sourceIndex, partIndex, repr.ast.exportsRef, 1, sourceIndex);
            record.flags |= CallsRunTimeReExportFn;
            repr.ast.usesExportsRef = true;
            reExportUses++;
          }
        }
        graph.generateRuntimeSymbolImportAndUse(sourceIndex, partIndex, "__reExport", reExportUses);
      }
    }
  },

  // The second half of step 5 of scanImportsAndExports for one file (a
  // separate method only so that V8 optimizes it better)
  computeDependenciesForFileParts(sourceIndex, repr) {
    const c = this;
    const graph = c.graph;
    // Each part tracks the other parts it depends on within this file (Go:
    // map[uint32]uint32; -1 stands for a missing entry)
    const parts = repr.ast.parts;
    const localDependencies = new Int32Array(parts.length).fill(-1);
    const namedImports = repr.ast.namedImports;
    const hasNamedImports = namedImports.size > 0;
    const importsToBind = repr.meta.importsToBind;
    const checkConstValues = graph.constValues.size > 0 && importsToBind.size > 0;
    const overlay = repr.meta.topLevelSymbolToPartsOverlay;
    const fromParser = repr.ast.topLevelSymbolToPartsFromParser;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex];

      // Now that all files have been parsed, determine which property
      // accesses off of imported symbols are inlined enum values and
      // which ones aren't
      if (part.importSymbolPropertyUses.size > 0) {
        for (const [ref, properties] of part.importSymbolPropertyUses) {
          const oldUse = part.symbolUses.get(ref);
          let countEstimate = oldUse === undefined ? 0 : oldUse.countEstimate;

          // Rare path: this import is a TypeScript enum
          const importData = repr.meta.importsToBind.get(ref);
          if (importData !== undefined) {
            const symbol = graph.symbols.get(importData.ref);
            if (symbol.kind === SymbolTSEnum) {
              const enum_ = graph.tsEnums.get(importData.ref);
              if (enum_ !== undefined) {
                let foundNonInlinedEnum = false;
                for (const [name, propertyUse] of properties) {
                  if (!enum_.has(name)) {
                    foundNonInlinedEnum = true;
                    countEstimate += propertyUse.countEstimate;
                  }
                }
                if (foundNonInlinedEnum) {
                  writableSymbolUses(part).set(ref, new SymbolUse(countEstimate));
                }
              }
              continue;
            }
          }

          // Common path: this import isn't a TypeScript enum
          for (const propertyUse of properties.values()) {
            countEstimate += propertyUse.countEstimate;
          }
          writableSymbolUses(part).set(ref, new SymbolUse(countEstimate));
        }
      }

      // Also determine which function calls will be inlined (and so should
      // not count as uses), and which ones will not be (and so should count
      // as uses)
      if (part.symbolCallUses.size > 0) for (const [ref, callUse] of part.symbolCallUses) {
        const oldUse = part.symbolUses.get(ref);
        const countEstimate = oldUse === undefined ? 0 : oldUse.countEstimate;

        // Find the symbol that was called
        let symbol = graph.symbols.get(ref);
        if (symbol.kind === SymbolImport) {
          const importData = repr.meta.importsToBind.get(ref);
          if (importData !== undefined) {
            symbol = graph.symbols.get(importData.ref);
          }
        }
        const flags = symbol.flags;
        let callCountEstimate = callUse.callCountEstimate;

        // Rare path: this is a function that will be inlined
        if ((flags & (IsEmptyFunction | CouldPotentiallyBeMutated)) === IsEmptyFunction) {
          // Every call will be inlined
          continue;
        } else if ((flags & (IsIdentityFunction | CouldPotentiallyBeMutated)) === IsIdentityFunction) {
          // Every single-argument call will be inlined as long as it's not a spread
          callCountEstimate -= callUse.singleArgNonSpreadCallCountEstimate;
          if (callCountEstimate === 0) {
            continue;
          }
        }

        // Common path: this isn't a function that will be inlined
        writableSymbolUses(part).set(ref, new SymbolUse(countEstimate + callCountEstimate));
      }

      // Now that we know this, we can determine cross-part dependencies. (An
      // entry can only be deleted below if this file imports something.)
      const symbolUses = checkConstValues ? writableSymbolUses(part) : part.symbolUses;
      const dependencies = part.dependencies;
      for (const ref of symbolUses.keys()) {
        // Rare path: this import is an inlined const value
        if (checkConstValues) {
          const importData = importsToBind.get(ref);
          if (importData !== undefined && graph.constValues.has(importData.ref)) {
            symbolUses.delete(importData.ref);
            continue;
          }
        }

        // (repr.topLevelSymbolToParts(ref), inlined)
        let otherParts = overlay === null ? undefined : overlay.get(ref);
        if (otherParts === undefined && fromParser !== null) otherParts = fromParser.get(ref);
        if (otherParts !== undefined) {
          for (let i = 0; i < otherParts.length; i++) {
            const otherPartIndex = otherParts[i];
            if (localDependencies[otherPartIndex] !== partIndex) {
              localDependencies[otherPartIndex] = partIndex;
              dependencies.push(new Dependency(sourceIndex, otherPartIndex));
            }
          }
        }

        // Also map from imports to parts that use them
        if (hasNamedImports) {
          const namedImport = namedImports.get(ref);
          if (namedImport !== undefined) {
            namedImport.localPartsWithUses.push(partIndex);
          }
        }
      }
    }
  },

  generateCodeForLazyExport(sourceIndex) {
    bail(); // (only for non-JS loaders, which the fast path never uses)
  },
});

// ---------------------------------------------------------------------------
// Exports, wrappers and import matching

// matchImportKind
const matchImportIgnore = 0; // The import is either external or undefined
const matchImportNormal = 1; // "sourceIndex" and "ref" are in use
const matchImportNamespace = 2; // "namespaceRef" and "alias" are in use
const matchImportNormalAndNamespace = 3; // Both "matchImportNormal" and "matchImportNamespace"
const matchImportCycle = 4; // The import could not be evaluated due to a cycle
const matchImportProbablyTypeScriptType = 5; // The import is missing but came from a TypeScript file
const matchImportAmbiguous = 6; // The import resolved to multiple symbols via "export * from"

class matchImportResult {
  constructor(
    kind = matchImportIgnore,
    alias = "",
    namespaceRef = 0,
    sourceIndex = 0,
    nameLoc = 0,
    otherSourceIndex = 0,
    otherNameLoc = 0,
    ref = 0,
  ) {
    this.alias = alias;
    this.kind = kind;
    this.namespaceRef = namespaceRef; // Go zero value of ast.Ref is {0, 0}
    this.sourceIndex = sourceIndex;
    this.nameLoc = nameLoc; // Optional, goes with sourceIndex, ignore if zero
    this.otherSourceIndex = otherSourceIndex;
    this.otherNameLoc = otherNameLoc; // Optional, goes with otherSourceIndex, ignore if zero
    this.ref = ref;
  }
  equals(b) {
    return (
      this.alias === b.alias &&
      this.kind === b.kind &&
      this.namespaceRef === b.namespaceRef &&
      this.sourceIndex === b.sourceIndex &&
      this.nameLoc === b.nameLoc &&
      this.otherSourceIndex === b.otherSourceIndex &&
      this.otherNameLoc === b.otherNameLoc &&
      this.ref === b.ref
    );
  }
}

class importTracker {
  constructor(sourceIndex = 0, nameLoc = 0, importRef = 0) {
    this.sourceIndex = sourceIndex;
    this.nameLoc = nameLoc; // Optional, goes with sourceIndex, ignore if zero
    this.importRef = importRef;
  }
}

// importStatus
const importNoMatch = 0; // The imported file has no matching export
const importFound = 1; // The imported file has a matching export
const importCommonJS = 2; // The imported file is CommonJS and has unknown exports
const importDynamicFallback = 3; // The import is missing but there is a dynamic fallback object
const importCommonJSWithoutExports = 4; // The import was treated as a CommonJS import but the file is known to have no exports
const importDisabled = 5; // The imported file was disabled by mapping it to false in the "browser" field of package.json
const importExternal = 6; // The imported file is external and has unknown exports
const importProbablyTypeScriptType = 7; // This is a missing re-export in a TypeScript file, so it's probably a type

Object.assign(linkerContext.prototype, {
  createExportsForFile(sourceIndex) {
    const c = this;
    const file = c.graph.files[sourceIndex];
    const repr = file.inputFile.repr;

    // JS-only: the statements of this part are only needed if the part ends up
    // being printed, and for the cached runtime file that never happens in a
    // transform (nothing can import the runtime's namespace object). So for
    // shared ASTs they are built lazily by nsExportStmtsForPart(); the
    // statements are exactly the ones Go builds here, and everything else
    // (uses, dependencies, declared symbols) is still computed here.
    const lazy = file.inputFile.astIsShared;

    // Generate a getter per export
    const aliases = repr.meta.sortedAndFilteredExportAliases;
    const exportRefs = new Array(aliases.length);
    const exportRefsAreImports = new Array(aliases.length);
    const nsExportDependencies = [];
    const nsExportSymbolUses = new Map();
    for (let i = 0; i < aliases.length; i++) {
      const export_ = repr.meta.resolvedExports.get(aliases[i]);
      let exportRef = export_.ref;
      let exportSourceIndex = export_.sourceIndex;

      // If this is an export of an import, reference the symbol that the import
      // was eventually resolved to. We need to do this because imports have
      // already been resolved by this point, so we can't generate a new import
      // and have that be resolved later.
      const importData = c.graph.files[exportSourceIndex].inputFile.repr.meta.importsToBind.get(exportRef);
      if (importData !== undefined) {
        exportRef = importData.ref;
        exportSourceIndex = importData.sourceIndex;
        for (const dep of importData.reExports) nsExportDependencies.push(dep);
      }

      // Exports of imports need EImportIdentifier in case they need to be re-
      // written to a property access later on
      exportRefs[i] = exportRef;
      exportRefsAreImports[i] = c.graph.symbols.get(exportRef).namespaceAlias !== null;

      // Add a getter property (see buildNSExportStmts)
      nsExportSymbolUses.set(exportRef, new SymbolUse(1));

      // Make sure the part that declares the export is included
      for (const partIndex of c.graph.files[exportSourceIndex].inputFile.repr.topLevelSymbolToParts(exportRef)) {
        // Use a non-local dependency since this is likely from a different
        // file if it came in through an export star
        nsExportDependencies.push(new Dependency(exportSourceIndex, partIndex));
      }
    }

    const declaredSymbols = [];
    const needsExportsVariable = repr.meta.needsExportsVariable;

    // Prefix this part with "var exports = {}" if this isn't a CommonJS entry point
    if (needsExportsVariable) {
      declaredSymbols.push(new DeclaredSymbol(repr.ast.exportsRef, true));
    }

    // "__export(exports, { foo: () => foo })"
    let exportRef = InvalidRef;
    if (aliases.length > 0) {
      const runtimeRepr = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr;
      exportRef = runtimeRepr.ast.moduleScope.members.get("__export").ref;

      // Make sure this file depends on the "__export" symbol
      for (const partIndex of runtimeRepr.topLevelSymbolToParts(exportRef)) {
        nsExportDependencies.push(new Dependency(RUNTIME_SOURCE_INDEX, partIndex));
      }

      // Make sure the CommonJS closure, if there is one, includes "exports"
      repr.ast.usesExportsRef = true;
    }

    // Decorate "module.exports" with the "__esModule" flag to indicate that
    // we used to be an ES module (see buildNSExportStmts)
    const assignModuleExports = repr.meta.forceIncludeExportsForEntryPoint && c.options.outputFormat === FormatCommonJS;

    // No need to generate a part if it'll be empty
    if (needsExportsVariable || aliases.length > 0 || assignModuleExports) {
      const build = () => c.buildNSExportStmts(repr, aliases, exportRefs, exportRefsAreImports, needsExportsVariable, exportRef, assignModuleExports);

      // Initialize the part that was allocated for us earlier. The information
      // here will be used after this during tree shaking.
      const part = new Part();
      if (lazy) {
        part.stmts = EMPTY_ARRAY;
        c.lazyNSExportStmts.set(sourceIndex, build);
      } else {
        part.stmts = build();
      }
      part.symbolUses = nsExportSymbolUses;
      part.dependencies = nsExportDependencies;
      part.declaredSymbols = declaredSymbols;

      // This can be removed if nothing uses it
      part.canBeRemovedIfUnused = true;

      // Make sure this is trimmed if unused even if tree shaking is disabled
      part.forceTreeShaking = true;
      repr.ast.parts[NSExportPartIndex] = part;

      // Pull in the "__export" symbol if it was used
      if (exportRef !== InvalidRef) {
        repr.meta.needsExportSymbolFromRuntime = true;
      }
    }
  },

  // The statements of the namespace export part built by createExportsForFile
  buildNSExportStmts(repr, aliases, exportRefs, exportRefsAreImports, needsExportsVariable, exportRef, assignModuleExports) {
    const c = this;

    // Generate a getter per export
    const properties = [];
    for (let i = 0; i < aliases.length; i++) {
      const alias = aliases[i];

      // Exports of imports need EImportIdentifier in case they need to be re-
      // written to a property access later on
      let value;
      if (exportRefsAreImports[i]) {
        value = new Expr(new EImportIdentifier(exportRefs[i]), 0);
      } else {
        value = new Expr(new EIdentifier(exportRefs[i]), 0);
      }

      // Add a getter property
      const body = new FnBody(new SBlock([new Stmt(new SReturn(value), value.loc)]), 0);
      // (compat.Arrow is always supported by the fast path)
      const getter = new Expr(new EArrow(EMPTY_ARRAY, body, false, false, true), 0);

      // Special case for __proto__ property: use a computed property
      // name to avoid it being treated as the object's prototype
      let flags = 0;
      if (alias === "__proto__") {
        flags |= PropertyIsComputed;
      }

      properties.push(new Property(null, new Expr(new EString(alias), 0), getter, null, EMPTY_ARRAY, 0, 0, PropertyField, flags));
    }

    const nsExportStmts = [];

    // Prefix this part with "var exports = {}" if this isn't a CommonJS entry point
    if (needsExportsVariable) {
      nsExportStmts.push(
        new Stmt(new SLocal([new Decl(new Binding(new BIdentifier(repr.ast.exportsRef), 0), new Expr(new EObject(), 0))]), 0),
      );
    }

    // "__export(exports, { foo: () => foo })"
    if (properties.length > 0) {
      nsExportStmts.push(
        new Stmt(
          new SExpr(
            new Expr(
              new ECall(new Expr(new EIdentifier(exportRef), 0), [
                new Expr(new EIdentifier(repr.ast.exportsRef), 0),
                new Expr(new EObject(properties), 0),
              ]),
              0,
            ),
          ),
          0,
        ),
      );
    }

    // Decorate "module.exports" with the "__esModule" flag to indicate that
    // we used to be an ES module. This is done by wrapping the exports object
    // instead of by mutating the exports object because other modules in the
    // bundle (including the entry point module) may do "import * as" to get
    // access to the exports object and should NOT see the "__esModule" flag.
    if (assignModuleExports) {
      const runtimeRepr = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr;
      const toCommonJSRef = runtimeRepr.ast.namedExports.get("__toCommonJS").ref;

      // "module.exports = __toCommonJS(exports);"
      nsExportStmts.push(
        assignStmt(
          new Expr(new EDot(new Expr(new EIdentifier(c.unboundModuleRef), 0), "exports"), 0),
          new Expr(new ECall(new Expr(new EIdentifier(toCommonJSRef), 0), [new Expr(new EIdentifier(repr.ast.exportsRef), 0)]), 0),
        ),
      );
    }

    return nsExportStmts;
  },

  // The statements of the namespace export part of a file (see
  // createExportsForFile)
  nsExportStmtsForPart(sourceIndex, part) {
    const c = this;
    const build = c.lazyNSExportStmts.get(sourceIndex);
    if (build !== undefined) {
      c.lazyNSExportStmts.delete(sourceIndex);
      part.stmts = build();
    }
    return part.stmts;
  },

  createWrapperForFile(sourceIndex) {
    const c = this;
    const repr = c.graph.files[sourceIndex].inputFile.repr;

    switch (repr.meta.wrap) {
      // If this is a CommonJS file, we're going to need to generate a wrapper
      // for the CommonJS closure. That will end up looking something like this:
      //
      //   var require_foo = __commonJS((exports, module) => {
      //     ...
      //   });
      //
      // However, that generation is special-cased for various reasons and is
      // done later on. Still, we're going to need to ensure that this file
      // both depends on the "__commonJS" symbol and declares the "require_foo"
      // symbol. Instead of special-casing this during the reachability analysis
      // below, we just append a dummy part to the end of the file with these
      // dependencies and let the general-purpose reachability analysis take care
      // of it.
      case WrapCJS: {
        const runtimeRepr = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr;
        const commonJSParts = runtimeRepr.topLevelSymbolToParts(c.cjsRuntimeRef);

        // Generate the dummy part
        const dependencies = new Array(commonJSParts.length);
        for (let i = 0; i < commonJSParts.length; i++) {
          dependencies[i] = new Dependency(RUNTIME_SOURCE_INDEX, commonJSParts[i]);
        }
        const part = new Part();
        part.symbolUses = new Map([[repr.ast.wrapperRef, new SymbolUse(1)]]);
        part.declaredSymbols = [
          new DeclaredSymbol(repr.ast.exportsRef, true),
          new DeclaredSymbol(repr.ast.moduleRef, true),
          new DeclaredSymbol(repr.ast.wrapperRef, true),
        ];
        part.dependencies = dependencies;
        const partIndex = c.graph.addPartToFile(sourceIndex, part);
        repr.meta.wrapperPartIndex = partIndex;
        c.graph.generateSymbolImportAndUse(sourceIndex, partIndex, c.cjsRuntimeRef, 1, RUNTIME_SOURCE_INDEX);
        break;
      }

      // If this is a lazily-initialized ESM file, we're going to need to
      // generate a wrapper for the ESM closure. That will end up looking
      // something like this:
      //
      //   var init_foo = __esm(() => {
      //     ...
      //   });
      //
      // This depends on the "__esm" symbol and declares the "init_foo" symbol
      // for similar reasons to the CommonJS closure above.
      case WrapESM: {
        const runtimeRepr = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr;
        const esmParts = runtimeRepr.topLevelSymbolToParts(c.esmRuntimeRef);

        // Generate the dummy part
        const dependencies = new Array(esmParts.length);
        for (let i = 0; i < esmParts.length; i++) {
          dependencies[i] = new Dependency(RUNTIME_SOURCE_INDEX, esmParts[i]);
        }
        const part = new Part();
        part.symbolUses = new Map([[repr.ast.wrapperRef, new SymbolUse(1)]]);
        part.declaredSymbols = [new DeclaredSymbol(repr.ast.wrapperRef, true)];
        part.dependencies = dependencies;
        const partIndex = c.graph.addPartToFile(sourceIndex, part);
        repr.meta.wrapperPartIndex = partIndex;
        c.graph.generateSymbolImportAndUse(sourceIndex, partIndex, c.esmRuntimeRef, 1, RUNTIME_SOURCE_INDEX);
        break;
      }
    }
  },

  matchImportsWithExportsForFile(sourceIndex) {
    const c = this;
    const file = c.graph.files[sourceIndex];
    const repr = file.inputFile.repr;

    // Sort imports for determinism. Otherwise our unit tests will randomly
    // fail sometimes when error messages are reordered.
    const sortedImportRefs = [];
    for (const ref of repr.ast.namedImports.keys()) sortedImportRefs.push(refInner(ref));
    sortedImportRefs.sort((a, b) => a - b);

    // Pair imports with their matching exports
    for (const innerIndex of sortedImportRefs) {
      // Re-use memory for the cycle detector
      c.cycleDetector.length = 0;

      const importRef = makeRef(sourceIndex, innerIndex);
      let [result, reExports] = c.matchImportWithExport(new importTracker(sourceIndex, 0, importRef), []);
      if (reExports === null) reExports = EMPTY_ARRAY;
      switch (result.kind) {
        case matchImportIgnore:
          break;

        case matchImportNormal:
          repr.meta.importsToBind.set(importRef, new ImportData(reExports, 0, result.ref, result.sourceIndex));
          break;

        case matchImportNamespace:
          writableSymbol(c.graph.symbols, importRef).namespaceAlias = new NamespaceAlias(result.alias, result.namespaceRef);
          break;

        case matchImportNormalAndNamespace:
          repr.meta.importsToBind.set(importRef, new ImportData(reExports, 0, result.ref, result.sourceIndex));
          writableSymbol(c.graph.symbols, importRef).namespaceAlias = new NamespaceAlias(result.alias, result.namespaceRef);
          break;

        case matchImportCycle:
          c.log.addError();
          break;

        case matchImportProbablyTypeScriptType:
          repr.meta.isProbablyTypeScriptType.set(importRef, true);
          break;

        case matchImportAmbiguous: {
          const symbol = c.graph.symbols.get(importRef);
          if (symbol.importItemStatus === ImportItemGenerated) {
            const symbol = writableSymbol(c.graph.symbols, importRef);
            // This is a warning instead of an error because although it appears
            // to be a named import, it's actually an automatically-generated
            // named import that was originally a property access on an import
            // star namespace object. Normally this property access would just
            // resolve to undefined at run-time instead of failing at binding-
            // time, so we emit a warning and rewrite the value to the literal
            // "undefined" instead of emitting an error.
            symbol.importItemStatus = ImportItemMissing;
            c.log.addIDWithNotes(MsgID_Bundler_ImportIsUndefined, MsgWarning);
          } else {
            c.log.addErrorWithNotes();
          }
          break;
        }
      }
    }
  },

  // Returns [result, reExports]. Note: "reExportsIn" is appended to in place
  // (callers always continue with the returned array, like Go's append).
  matchImportWithExport(tracker, reExportsIn) {
    const c = this;
    const ambiguousResults = [];
    let reExports = reExportsIn;
    let result = new matchImportResult();

    loop: for (;;) {
      // Make sure we avoid infinite loops trying to resolve cycles:
      //
      //   // foo.js
      //   export {a as b} from './foo.js'
      //   export {b as c} from './foo.js'
      //   export {c as a} from './foo.js'
      //
      // This uses a O(n^2) array scan instead of a O(n) map because the vast
      // majority of cases have one or two elements and Go arrays are cheap to
      // reuse without allocating.
      for (const previousTracker of c.cycleDetector) {
        if (
          tracker.sourceIndex === previousTracker.sourceIndex &&
          tracker.nameLoc === previousTracker.nameLoc &&
          tracker.importRef === previousTracker.importRef
        ) {
          result = new matchImportResult(matchImportCycle);
          break loop;
        }
      }
      c.cycleDetector.push(tracker);

      // Resolve the import by one step
      const [nextTracker, status, potentiallyAmbiguousExportStarRefs] = c.advanceImportTracker(tracker);
      switch (status) {
        case importCommonJS:
        case importCommonJSWithoutExports:
        case importExternal:
        case importDisabled: {
          if (status === importExternal && formatKeepESMImportExportSyntax(c.options.outputFormat)) {
            // Imports from external modules should not be converted to CommonJS
            // if the output format preserves the original ES6 import statements
            break;
          }

          // If it's a CommonJS or external file, rewrite the import to a
          // property access. Don't do this if the namespace reference is invalid
          // though. This is the case for star imports, where the import is the
          // namespace.
          const trackerFile = c.graph.files[tracker.sourceIndex];
          const namedImport = trackerFile.inputFile.repr.ast.namedImports.get(tracker.importRef);
          if (namedImport.namespaceRef !== InvalidRef) {
            if (result.kind === matchImportNormal) {
              result.kind = matchImportNormalAndNamespace;
              result.namespaceRef = namedImport.namespaceRef;
              result.alias = namedImport.alias;
            } else {
              result = new matchImportResult(matchImportNamespace, namedImport.alias, namedImport.namespaceRef);
            }
          }

          // Warn about importing from a file that is known to not have any exports
          if (status === importCommonJSWithoutExports) {
            const symbol = writableSymbol(c.graph.symbols, tracker.importRef);
            symbol.importItemStatus = ImportItemMissing;
            let kind = MsgWarning;
            if (isInsideNodeModules(trackerFile.inputFile.source.keyPath.text)) {
              kind = MsgDebug;
            }
            c.log.addID(MsgID_Bundler_ImportIsUndefined, kind);
          }
          break;
        }

        case importDynamicFallback: {
          // If it's a file with dynamic export fallback, rewrite the import to a property access
          const trackerFile = c.graph.files[tracker.sourceIndex];
          const namedImport = trackerFile.inputFile.repr.ast.namedImports.get(tracker.importRef);
          if (result.kind === matchImportNormal) {
            result.kind = matchImportNormalAndNamespace;
            result.namespaceRef = nextTracker.importRef;
            result.alias = namedImport.alias;
          } else {
            result = new matchImportResult(matchImportNamespace, namedImport.alias, nextTracker.importRef);
          }
          break;
        }

        case importNoMatch: {
          const trackerFile = c.graph.files[tracker.sourceIndex];

          // Report mismatched imports and exports
          if (c.graph.symbols.get(tracker.importRef).importItemStatus === ImportItemGenerated) {
            const symbol = writableSymbol(c.graph.symbols, tracker.importRef);

            // This is not an error because although it appears to be a named
            // import, it's actually an automatically-generated named import
            // that was originally a property access on an import star
            // namespace object:
            //
            //   import * as ns from 'foo'
            //   const undefinedValue = ns.notAnExport
            //
            // If this code wasn't bundled, this property access would just resolve
            // to undefined at run-time instead of failing at binding-time, so we
            // emit rewrite the value to the literal "undefined" instead of
            // emitting an error.
            symbol.importItemStatus = ImportItemMissing;

            // Don't emit a log message if this symbol isn't used, since then the
            // log message isn't helpful. This can happen with "import" assignment
            // statements in TypeScript code since they are ambiguously either a
            // type or a value. We consider them to be a type if they aren't used.
            //
            //   import * as ns from 'foo'
            //
            //   // There's no warning here because this is dead code
            //   if (false) ns.notAnExport
            //
            //   // There's no warning here because this is never used
            //   import unused = ns.notAnExport
            //
            if (symbol.useCountEstimate > 0) {
              let kind = MsgWarning;
              if (isInsideNodeModules(trackerFile.inputFile.source.keyPath.text)) {
                kind = MsgDebug;
              }
              c.log.addMsgID(MsgID_Bundler_ImportIsUndefined, { kind });
            }
          } else {
            c.log.addMsg({ kind: MsgError });
          }
          break;
        }

        case importProbablyTypeScriptType:
          // Omit this import from any namespace export code we generate for
          // import star statements (i.e. "import * as ns from 'path'")
          result = new matchImportResult(matchImportProbablyTypeScriptType);
          break;

        case importFound: {
          // If there are multiple ambiguous results due to use of "export * from"
          // statements, trace them all to see if they point to different things.
          for (const ambiguousTracker of potentiallyAmbiguousExportStarRefs) {
            // If this is a re-export of another import, follow the import
            if (c.graph.files[ambiguousTracker.sourceIndex].inputFile.repr.ast.namedImports.has(ambiguousTracker.ref)) {
              // Save and restore the cycle detector to avoid mixing information
              const oldCycleDetectorLength = c.cycleDetector.length;
              const [ambiguousResult, newReExportFiles] = c.matchImportWithExport(
                new importTracker(ambiguousTracker.sourceIndex, 0, ambiguousTracker.ref),
                reExports,
              );
              c.cycleDetector.length = oldCycleDetectorLength;
              ambiguousResults.push(ambiguousResult);
              reExports = newReExportFiles;
            } else {
              ambiguousResults.push(
                new matchImportResult(matchImportNormal, "", 0, ambiguousTracker.sourceIndex, ambiguousTracker.nameLoc, 0, 0, ambiguousTracker.ref),
              );
            }
          }

          // Defer the actual binding of this import until after we generate
          // namespace export code for all files. This has to be done for all
          // import-to-export matches, not just the initial import to the final
          // export, since all imports and re-exports must be merged together
          // for correctness.
          result = new matchImportResult(matchImportNormal, "", 0, nextTracker.sourceIndex, nextTracker.nameLoc, 0, 0, nextTracker.importRef);

          // Depend on the statement(s) that declared this import symbol in the
          // original file (a null array is Go's nil slice after an ambiguous
          // nested result)
          for (const resolvedPartIndex of c.graph.files[tracker.sourceIndex].inputFile.repr.topLevelSymbolToParts(tracker.importRef)) {
            if (reExports === null) reExports = [];
            reExports.push(new Dependency(tracker.sourceIndex, resolvedPartIndex));
          }

          // If this is a re-export of another import, continue for another
          // iteration of the loop to resolve that import as well
          if (c.graph.files[nextTracker.sourceIndex].inputFile.repr.ast.namedImports.has(nextTracker.importRef)) {
            tracker = nextTracker;
            continue loop;
          }
          break;
        }

        default:
          throw new globalThis.Error("Internal error");
      }

      // Stop now if we didn't explicitly "continue" above
      break;
    }

    // If there is a potential ambiguity, all results must be the same
    for (const ambiguousResult of ambiguousResults) {
      if (!ambiguousResult.equals(result)) {
        if (
          result.kind === matchImportNormal &&
          ambiguousResult.kind === matchImportNormal &&
          result.nameLoc !== 0 &&
          ambiguousResult.nameLoc !== 0
        ) {
          return [
            new matchImportResult(matchImportAmbiguous, "", 0, result.sourceIndex, result.nameLoc, ambiguousResult.sourceIndex, ambiguousResult.nameLoc),
            null,
          ];
        }
        return [new matchImportResult(matchImportAmbiguous), null];
      }
    }

    return [result, reExports];
  },

  recursivelyWrapDependencies(sourceIndex) {
    const c = this;
    const repr = c.graph.files[sourceIndex].inputFile.repr;
    if (repr.meta.didWrapDependencies) return;
    repr.meta.didWrapDependencies = true;

    // Never wrap the runtime file since it always comes first
    if (sourceIndex === RUNTIME_SOURCE_INDEX) return;

    // This module must be wrapped
    if (repr.meta.wrap === WrapNone) {
      if (repr.ast.exportsKind === ExportsCommonJS) {
        repr.meta.wrap = WrapCJS;
      } else {
        repr.meta.wrap = WrapESM;
      }
    }

    // All dependencies must also be wrapped
    for (const record of repr.ast.importRecords) {
      if (record.sourceIndex >= 0) {
        c.recursivelyWrapDependencies(record.sourceIndex);
      }
    }
  },

  hasDynamicExportsDueToExportStar(sourceIndex, visited) {
    const c = this;

    // Terminate the traversal now if this file already has dynamic exports
    const repr = c.graph.files[sourceIndex].inputFile.repr;
    if (repr.ast.exportsKind === ExportsCommonJS || repr.ast.exportsKind === ExportsESMWithDynamicFallback) {
      return true;
    }

    // Avoid infinite loops due to cycles in the export star graph
    if (visited.has(sourceIndex)) return false;
    visited.add(sourceIndex);

    // Scan over the export star graph
    for (const importRecordIndex of repr.ast.exportStarImportRecords) {
      const record = repr.ast.importRecords[importRecordIndex];

      // This file has dynamic exports if the exported imports are from a file
      // that either has dynamic exports directly or transitively by itself
      // having an export star from a file with dynamic exports.
      if (
        (!(record.sourceIndex >= 0) &&
          (!c.graph.files[sourceIndex].isEntryPoint() || !formatKeepESMImportExportSyntax(c.options.outputFormat))) ||
        (record.sourceIndex >= 0 && record.sourceIndex !== sourceIndex && c.hasDynamicExportsDueToExportStar(record.sourceIndex, visited))
      ) {
        repr.ast.exportsKind = ExportsESMWithDynamicFallback;
        return true;
      }
    }

    return false;
  },

  // "sourceIndexStack" is used as a stack: Go appends to a slice passed by
  // value, which is equivalent to push-on-entry/pop-on-exit here.
  addExportsForExportStar(resolvedExports, sourceIndex, sourceIndexStack) {
    const c = this;

    // Avoid infinite loops due to cycles in the export star graph
    for (const prevSourceIndex of sourceIndexStack) {
      if (prevSourceIndex === sourceIndex) return;
    }
    sourceIndexStack.push(sourceIndex);
    const repr = c.graph.files[sourceIndex].inputFile.repr;

    for (const importRecordIndex of repr.ast.exportStarImportRecords) {
      const record = repr.ast.importRecords[importRecordIndex];
      if (!(record.sourceIndex >= 0)) {
        // This will be resolved at run time instead
        continue;
      }
      const otherSourceIndex = record.sourceIndex;

      // Export stars from a CommonJS module don't work because they can't be
      // statically discovered. Just silently ignore them in this case.
      //
      // We could attempt to check whether the imported file still has ES6
      // exports even though it still uses CommonJS features. However, when
      // doing this we'd also have to rewrite any imports of these export star
      // re-exports as property accesses off of a generated require() call.
      const otherRepr = c.graph.files[otherSourceIndex].inputFile.repr;
      if (otherRepr.ast.exportsKind === ExportsCommonJS) {
        // All exports will be resolved at run time instead
        continue;
      }

      // Accumulate this file's exports
      nextExport: for (const [alias, name] of otherRepr.ast.namedExports) {
        // ES6 export star statements ignore exports named "default"
        if (alias === "default") continue;

        // This export star is shadowed if any file in the stack has a matching real named export
        for (const prevSourceIndex of sourceIndexStack) {
          const prevRepr = c.graph.files[prevSourceIndex].inputFile.repr;
          if (prevRepr.ast.namedExports.has(alias)) continue nextExport;
        }

        const existing = resolvedExports.get(alias);
        if (existing === undefined) {
          // Initialize the re-export
          resolvedExports.set(alias, new ExportData(EMPTY_ARRAY, name.ref, name.aliasLoc, otherSourceIndex));

          // Make sure the symbol is marked as imported so that code splitting
          // imports it correctly if it ends up being shared with another chunk
          repr.meta.importsToBind.set(name.ref, new ImportData(EMPTY_ARRAY, 0, name.ref, otherSourceIndex));
        } else if (existing.sourceIndex !== otherSourceIndex) {
          // Two different re-exports colliding makes it potentially ambiguous
          const refs = existing.potentiallyAmbiguousExportStarRefs.slice();
          refs.push(new ImportData(EMPTY_ARRAY, name.aliasLoc, name.ref, otherSourceIndex));
          resolvedExports.set(alias, new ExportData(refs, existing.ref, existing.nameLoc, existing.sourceIndex));
        }
      }

      // Search further through this file's export stars
      c.addExportsForExportStar(resolvedExports, otherSourceIndex, sourceIndexStack);
    }

    sourceIndexStack.pop();
  },

  // Returns [importTracker, importStatus, []ImportData]
  advanceImportTracker(tracker) {
    const c = this;
    const file = c.graph.files[tracker.sourceIndex];
    const repr = file.inputFile.repr;
    const namedImport = repr.ast.namedImports.get(tracker.importRef);

    // Is this an external file?
    const record = repr.ast.importRecords[namedImport.importRecordIndex];
    if (!(record.sourceIndex >= 0)) {
      return [new importTracker(), importExternal, EMPTY_ARRAY];
    }

    // Is this a named import of a file without any exports?
    const otherSourceIndex = record.sourceIndex;
    const otherRepr = c.graph.files[otherSourceIndex].inputFile.repr;
    if (
      !namedImport.aliasIsStar &&
      !otherRepr.ast.hasLazyExport &&
      // CommonJS exports
      otherRepr.ast.exportKeyword.len === 0 &&
      namedImport.alias !== "default" &&
      // ESM exports
      !otherRepr.ast.usesExportsRef &&
      !otherRepr.ast.usesModuleRef
    ) {
      // Just warn about it and replace the import with "undefined"
      return [new importTracker(otherSourceIndex, 0, InvalidRef), importCommonJSWithoutExports, EMPTY_ARRAY];
    }

    // Is this a CommonJS file?
    if (otherRepr.ast.exportsKind === ExportsCommonJS) {
      return [new importTracker(otherSourceIndex, 0, InvalidRef), importCommonJS, EMPTY_ARRAY];
    }

    // Match this import star with an export star from the imported file
    const matchingExportStar = otherRepr.meta.resolvedExportStar;
    if (namedImport.aliasIsStar && matchingExportStar !== null) {
      // Check to see if this is a re-export of another import
      return [
        new importTracker(matchingExportStar.sourceIndex, matchingExportStar.nameLoc, matchingExportStar.ref),
        importFound,
        matchingExportStar.potentiallyAmbiguousExportStarRefs,
      ];
    }

    // Match this import up with an export from the imported file
    const matchingExport = otherRepr.meta.resolvedExports.get(namedImport.alias);
    if (matchingExport !== undefined) {
      // Check to see if this is a re-export of another import
      return [
        new importTracker(matchingExport.sourceIndex, matchingExport.nameLoc, matchingExport.ref),
        importFound,
        matchingExport.potentiallyAmbiguousExportStarRefs,
      ];
    }

    // Is this a file with dynamic exports?
    if (otherRepr.ast.exportsKind === ExportsESMWithDynamicFallback) {
      return [new importTracker(otherSourceIndex, 0, otherRepr.ast.exportsRef), importDynamicFallback, EMPTY_ARRAY];
    }

    // Missing re-exports in TypeScript files are indistinguishable from types
    if (loaderIsTypeScript(file.inputFile.loader) && namedImport.isExported) {
      return [new importTracker(), importProbablyTypeScriptType, EMPTY_ARRAY];
    }

    return [new importTracker(otherSourceIndex), importNoMatch, EMPTY_ARRAY];
  },
});

// ---------------------------------------------------------------------------
// Tree shaking and chunks

class chunkOrder {
  constructor(sourceIndex, distance, tieBreaker) {
    this.sourceIndex = sourceIndex;
    this.distance = distance;
    this.tieBreaker = tieBreaker;
  }
}

function appendOrExtendPartRange(ranges, sourceIndex, partIndex) {
  const i = ranges.length - 1;
  if (i >= 0) {
    const r = ranges[i];
    if (r.sourceIndex === sourceIndex && r.partIndexEnd === partIndex) {
      r.partIndexEnd = partIndex + 1;
      return ranges;
    }
  }

  ranges.push(new partRange(sourceIndex, partIndex, partIndex + 1));
  return ranges;
}

// "var a = 1; var b = 2;" => "var a = 1, b = 2;"
export function mergeAdjacentLocalStmts(stmts) {
  if (stmts.length === 0) return stmts;

  let didMergeWithPreviousLocal = false;
  let end = 1;

  for (let i = 1; i < stmts.length; i++) {
    const stmt = stmts[i];

    // Try to merge with the previous variable statement
    const after = stmt.data;
    if (after.k === S_LOCAL) {
      const before = stmts[end - 1].data;
      if (before.k === S_LOCAL) {
        // It must be the same kind of variable statement (i.e. let/var/const)
        if (before.kind === after.kind && before.isExport === after.isExport) {
          if (didMergeWithPreviousLocal) {
            // Avoid O(n^2) behavior for repeated variable declarations
            for (const d of after.decls) before.decls.push(d);
          } else {
            // Be careful to not modify the original statement
            didMergeWithPreviousLocal = true;
            const clone = new SLocal(before.decls.concat(after.decls), before.kind, before.isExport, before.wasTSImportEquals);
            stmts[end - 1] = new Stmt(clone, stmts[end - 1].loc);
          }
          continue;
        }
      }
    }

    // Otherwise, append a normal statement
    didMergeWithPreviousLocal = false;
    stmts[end] = stmt;
    end++;
  }

  stmts.length = end;
  return stmts;
}

Object.assign(linkerContext.prototype, {
  treeShakingAndCodeSplitting() {
    const c = this;

    // Tree shaking: Each entry point marks all files reachable from itself
    for (const entryPoint of c.graph.entryPoints()) {
      c.markFileLiveForTreeShaking(entryPoint.sourceIndex);
    }

    // Code splitting: Determine which entry points can reach which files. This
    // has to happen after tree shaking because there is an implicit dependency
    // between live parts within the same file. All liveness has to be computed
    // first before determining which entry points can reach which files.
    const entryPoints = c.graph.entryPoints();
    for (let i = 0; i < entryPoints.length; i++) {
      c.markFileReachableForCodeSplitting(entryPoints[i].sourceIndex, i, 0);
    }
  },

  markFileReachableForCodeSplitting(sourceIndex, entryPointBit, distanceFromEntryPoint) {
    const c = this;
    const file = c.graph.files[sourceIndex];
    if (!file.isLive) return;
    let traverseAgain = false;

    // Track the minimum distance to an entry point
    if (distanceFromEntryPoint < file.distanceFromEntryPoint) {
      file.distanceFromEntryPoint = distanceFromEntryPoint;
      traverseAgain = true;
    }
    distanceFromEntryPoint++;

    // Don't mark this file more than once
    if (file.entryBits.hasBit(entryPointBit) && !traverseAgain) return;
    file.entryBits.setBit(entryPointBit);

    const repr = file.inputFile.repr;
    if (repr instanceof JSRepr) {
      // If the JavaScript stub for a CSS file is included, also include the CSS file
      if (repr.cssSourceIndex >= 0) {
        c.markFileReachableForCodeSplitting(repr.cssSourceIndex, entryPointBit, distanceFromEntryPoint);
      }

      // Traverse into all imported files
      for (const record of repr.ast.importRecords) {
        if (record.sourceIndex >= 0 && !c.isExternalDynamicImport(record, sourceIndex)) {
          c.markFileReachableForCodeSplitting(record.sourceIndex, entryPointBit, distanceFromEntryPoint);
        }
      }

      // Traverse into all dependencies of all parts in this file
      for (const part of repr.ast.parts) {
        for (const dependency of part.dependencies) {
          if (dependency.sourceIndex !== sourceIndex) {
            c.markFileReachableForCodeSplitting(dependency.sourceIndex, entryPointBit, distanceFromEntryPoint);
          }
        }
      }
    } else if (repr instanceof CSSRepr) {
      bail(); // (CSS only)
    }
  },

  markFileLiveForTreeShaking(sourceIndex) {
    const c = this;
    const file = c.graph.files[sourceIndex];

    // Don't mark this file more than once
    if (file.isLive) return;
    file.isLive = true;

    const repr = file.inputFile.repr;
    if (repr instanceof JSRepr) {
      // If the JavaScript stub for a CSS file is included, also include the CSS file
      if (repr.cssSourceIndex >= 0) {
        c.markFileLiveForTreeShaking(repr.cssSourceIndex);
      }

      const parts = repr.ast.parts;
      for (let partIndex = 0, partCount = parts.length; partIndex < partCount; partIndex++) {
        const part = parts[partIndex];
        let canBeRemovedIfUnused = part.canBeRemovedIfUnused;

        // Also include any statement-level imports
        for (const importRecordIndex of part.importRecordIndices) {
          const record = repr.ast.importRecords[importRecordIndex];
          if (record.kind !== ImportStmt) continue;

          if (record.sourceIndex >= 0) {
            const otherSourceIndex = record.sourceIndex;

            // Don't include this module for its side effects if it can be
            // considered to have no side effects
            const otherFile = c.graph.files[otherSourceIndex];
            if (otherFile.inputFile.sideEffects.kind !== HasSideEffects && !c.options.ignoreDCEAnnotations) {
              continue;
            }

            // Otherwise, include this module for its side effects
            c.markFileLiveForTreeShaking(otherSourceIndex);
          } else if ((record.flags & IsExternalWithoutSideEffects) !== 0) {
            // This can be removed if it's unused
            continue;
          }

          // If we get here then the import was included for its side effects, so
          // we must also keep this part
          canBeRemovedIfUnused = false;
        }

        // Include all parts in this file with side effects, or just include
        // everything if tree-shaking is disabled. Note that we still want to
        // perform tree-shaking on the runtime even if tree-shaking is disabled.
        if (!canBeRemovedIfUnused || (!part.forceTreeShaking && !c.options.treeShaking && file.isEntryPoint())) {
          c.markPartLiveForTreeShaking(sourceIndex, partIndex);
        }
      }
    } else if (repr instanceof CSSRepr) {
      bail(); // (CSS only)
    }
  },

  isExternalDynamicImport(record, sourceIndex) {
    const c = this;
    return (
      c.options.codeSplitting &&
      record.kind === ImportDynamic &&
      c.graph.files[record.sourceIndex].isEntryPoint() &&
      record.sourceIndex !== sourceIndex
    );
  },

  markPartLiveForTreeShaking(sourceIndex, partIndex) {
    const c = this;
    const file = c.graph.files[sourceIndex];
    const repr = file.inputFile.repr;
    const part = repr.ast.parts[partIndex];

    // Don't mark this part more than once
    if (part.isLive) return;
    part.isLive = true;

    // Include the file containing this part
    c.markFileLiveForTreeShaking(sourceIndex);

    // Also include any dependencies
    for (const dep of part.dependencies) {
      c.markPartLiveForTreeShaking(dep.sourceIndex, dep.partIndex);
    }
  },

  // JavaScript modules are traversed in depth-first postorder. Returns the
  // CSS files imported by JS files in JS order (always empty without CSS).
  findImportedCSSFilesInJSOrder(entryPoint) {
    const c = this;
    const visited = new Set();
    const order = [];

    // Include this file and all files it imports
    const visit = (sourceIndex) => {
      if (visited.has(sourceIndex)) return;
      visited.add(sourceIndex);
      const file = c.graph.files[sourceIndex];
      const repr = file.inputFile.repr;

      // Iterate over each part in the file in order
      for (const part of repr.ast.parts) {
        // Traverse any files imported by this part. Note that CommonJS calls
        // to "require()" count as imports too, sort of as if the part has an
        // ESM "import" statement in it. This may seem weird because ESM imports
        // are a compile-time concept while CommonJS imports are a run-time
        // concept. But we don't want to manipulate <style> tags at run-time so
        // this is the only way to do it.
        for (const importRecordIndex of part.importRecordIndices) {
          const record = repr.ast.importRecords[importRecordIndex];
          if (record.sourceIndex >= 0) {
            visit(record.sourceIndex);
          }
        }
      }

      // Iterate over the associated CSS imports in postorder
      if (repr.cssSourceIndex >= 0) {
        order.push(repr.cssSourceIndex);
      }
    };

    // Include all files reachable from the entry point
    visit(entryPoint);

    return order;
  },

  computeChunks() {
    const c = this;
    const jsChunks = new Map();

    // Create chunks for entry points
    const entryPoints = c.graph.entryPoints();
    for (let i = 0; i < entryPoints.length; i++) {
      const entryPoint = entryPoints[i];
      const file = c.graph.files[entryPoint.sourceIndex];

      // Create a chunk for the entry point here to ensure that the chunk is
      // always generated even if the resulting file is empty
      const entryBits = newBitSet(entryPoints.length);
      entryBits.setBit(i);
      const key = entryBits.string();
      const chunk = new chunkInfo();
      chunk.entryBits = entryBits;
      chunk.isEntryPoint = true;
      chunk.sourceIndex = entryPoint.sourceIndex;
      chunk.entryPointBit = i;
      chunk.filesWithPartsInChunk = new Set();

      const repr = file.inputFile.repr;
      if (repr instanceof JSRepr) {
        const chunkRepr = new chunkReprJS();
        chunk.chunkRepr = chunkRepr;
        jsChunks.set(key, chunk);

        // If this JS entry point has an associated CSS entry point, generate it
        // now (CSS only)
        const cssSourceIndices = c.findImportedCSSFilesInJSOrder(entryPoint.sourceIndex);
        if (cssSourceIndices.length > 0) bail(); // (CSS only)
      } else {
        bail(); // (CSS only)
      }
    }

    // Figure out which JS files are in which chunk
    for (const sourceIndex of c.graph.reachableFiles) {
      const file = c.graph.files[sourceIndex];
      if (file.isLive) {
        if (file.inputFile.repr instanceof JSRepr) {
          const key = file.entryBits.string();
          let chunk = jsChunks.get(key);
          if (chunk === undefined) {
            chunk = new chunkInfo();
            chunk.entryBits = file.entryBits;
            chunk.filesWithPartsInChunk = new Set();
            chunk.chunkRepr = new chunkReprJS();
            jsChunks.set(key, chunk);
          }
          chunk.filesWithPartsInChunk.add(sourceIndex);
        }
      }
    }

    // Sort the chunks for determinism. This matters because we use chunk indices
    // as sorting keys in a few places.
    const sortedChunks = [];
    const sortedKeys = [...jsChunks.keys()];
    sortedKeys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // keys are byte strings (char codes 0-255)
    for (const key of sortedKeys) {
      sortedChunks.push(jsChunks.get(key));
    }

    // A transform always has exactly one entry point and no code splitting,
    // so every live file ends up in the entry point's chunk.
    if (sortedChunks.length !== 1) bail();

    // Map from the entry point file to its chunk. We will need this later if
    // a file contains a dynamic import to this entry point, since we'll need
    // to look up the path for this chunk to use with the import.
    for (let chunkIndex = 0; chunkIndex < sortedChunks.length; chunkIndex++) {
      const chunk = sortedChunks[chunkIndex];
      if (chunk.isEntryPoint) {
        c.graph.files[chunk.sourceIndex].entryPointChunkIndex = chunkIndex;
      }
    }

    // Determine the order of JS files (and parts) within the chunk ahead of time
    for (const chunk of sortedChunks) {
      const chunkRepr = chunk.chunkRepr;
      const [js, jsParts] = c.findImportedPartsInJSOrder(chunk);
      chunkRepr.filesInChunkInOrder = js;
      chunkRepr.partsInChunkInOrder = jsParts;
    }

    // Assign general information to each chunk
    for (let chunkIndex = 0; chunkIndex < sortedChunks.length; chunkIndex++) {
      const chunk = sortedChunks[chunkIndex];

      // Assign a unique key to each chunk. This key encodes the index directly so
      // we can easily recover it later without needing to look it up in a map. The
      // last 8 numbers of the key are the chunk index.
      chunk.uniqueKey = c.uniqueKeyPrefix + "C" + String(chunkIndex).padStart(8, "0");

      // (The output path template is not evaluated, see generateChunksInParallel)
    }

    c.chunks = sortedChunks;
  },

  shouldIncludePart(repr, part) {
    const c = this;

    // As an optimization, ignore parts containing a single import statement to
    // an internal non-wrapped file. These will be ignored anyway and it's a
    // performance hit to spin up a goroutine only to discover this later.
    if (part.stmts.length === 1) {
      const s = part.stmts[0].data;
      if (s.k === S_IMPORT) {
        const record = repr.ast.importRecords[s.importRecordIndex];
        if (record.sourceIndex >= 0 && c.graph.files[record.sourceIndex].inputFile.repr.meta.wrap === WrapNone) {
          return false;
        }
      }
    }
    return true;
  },

  // Returns [js []number, jsParts []partRange]
  findImportedPartsInJSOrder(chunk) {
    const c = this;
    const sorted = [];

    // Attach information to the files for use with sorting
    for (const sourceIndex of chunk.filesWithPartsInChunk) {
      const file = c.graph.files[sourceIndex];
      sorted.push(new chunkOrder(sourceIndex, file.distanceFromEntryPoint, c.graph.stableSourceIndices[sourceIndex]));
    }

    // Sort so files closest to an entry point come first. If two files are
    // equidistant to an entry point, then break the tie by sorting on the
    // stable source index derived from the DFS over all entry points.
    // (The keys are unique, so the unstable Go sort is deterministic.)
    sorted.sort((a, b) => (a.distance !== b.distance ? a.distance - b.distance : a.tieBreaker - b.tieBreaker));

    const visited = new Set();
    const js = [];
    let jsParts = [];
    let jsPartsPrefix = [];

    // Traverse the graph using this stable order and linearize the files with
    // dependencies before dependents
    const visit = (sourceIndex) => {
      if (visited.has(sourceIndex)) return;

      visited.add(sourceIndex);
      const file = c.graph.files[sourceIndex];

      const repr = file.inputFile.repr;
      if (repr instanceof JSRepr) {
        let isFileInThisChunk = chunk.entryBits.equals(file.entryBits);

        // Wrapped files can't be split because they are all inside the wrapper
        const canFileBeSplit = repr.meta.wrap === WrapNone;

        // Make sure the generated call to "__export(exports, ...)" comes first
        // before anything else in this file
        if (canFileBeSplit && isFileInThisChunk && repr.ast.parts[NSExportPartIndex].isLive) {
          jsParts = appendOrExtendPartRange(jsParts, sourceIndex, NSExportPartIndex);
        }

        const parts = repr.ast.parts;
        for (let partIndex = 0, partCount = parts.length; partIndex < partCount; partIndex++) {
          const part = parts[partIndex];
          const isPartInThisChunk = isFileInThisChunk && part.isLive;

          // Also traverse any files imported by this part
          for (const importRecordIndex of part.importRecordIndices) {
            const record = repr.ast.importRecords[importRecordIndex];
            if (record.sourceIndex >= 0 && (record.kind === ImportStmt || isPartInThisChunk)) {
              if (c.isExternalDynamicImport(record, sourceIndex)) {
                // Don't follow import() dependencies
                continue;
              }
              visit(record.sourceIndex);
            }
          }

          // Then include this part after the files it imports
          if (isPartInThisChunk) {
            isFileInThisChunk = true;
            if (canFileBeSplit && partIndex !== NSExportPartIndex && c.shouldIncludePart(repr, part)) {
              if (sourceIndex === RUNTIME_SOURCE_INDEX) {
                jsPartsPrefix = appendOrExtendPartRange(jsPartsPrefix, sourceIndex, partIndex);
              } else {
                jsParts = appendOrExtendPartRange(jsParts, sourceIndex, partIndex);
              }
            }
          }
        }

        if (isFileInThisChunk) {
          js.push(sourceIndex);

          // CommonJS files are all-or-nothing so all parts must be contiguous
          if (!canFileBeSplit) {
            jsPartsPrefix.push(new partRange(sourceIndex, 0, repr.ast.parts.length));
          }
        }
      }
    };

    // Always put the runtime code first before anything else
    visit(RUNTIME_SOURCE_INDEX);
    for (const data of sorted) {
      visit(data.sourceIndex);
    }
    jsParts = jsPartsPrefix.concat(jsParts);
    return [js, jsParts];
  },

  shouldRemoveImportExportStmt(sourceIndex, stmtList, loc, namespaceRef, importRecordIndex) {
    const c = this;
    const repr = c.graph.files[sourceIndex].inputFile.repr;
    const record = repr.ast.importRecords[importRecordIndex];

    // Is this an external import?
    if (!(record.sourceIndex >= 0)) {
      // Keep the "import" statement if "import" statements are supported
      if (formatKeepESMImportExportSyntax(c.options.outputFormat)) {
        return false;
      }

      // Otherwise, replace this statement with a call to "require()"
      stmtList.insideWrapperPrefix.push(
        new Stmt(
          new SLocal([new Decl(new Binding(new BIdentifier(namespaceRef), loc), new Expr(new ERequireString(importRecordIndex), record.range.loc))]),
          loc,
        ),
      );
      return true;
    }

    // We don't need a call to "require()" if this is a self-import inside a
    // CommonJS-style module, since we can just reference the exports directly.
    if (repr.ast.exportsKind === ExportsCommonJS && followSymbols(c.graph.symbols, namespaceRef) === repr.ast.exportsRef) {
      return true;
    }

    const otherFile = c.graph.files[record.sourceIndex];
    const otherRepr = otherFile.inputFile.repr;
    switch (otherRepr.meta.wrap) {
      case WrapNone:
        // Remove the statement entirely if this module is not wrapped
        break;

      case WrapCJS:
        // Replace the statement with a call to "require()"
        stmtList.insideWrapperPrefix.push(
          new Stmt(
            new SLocal([new Decl(new Binding(new BIdentifier(namespaceRef), loc), new Expr(new ERequireString(importRecordIndex), record.range.loc))]),
            loc,
          ),
        );
        break;

      case WrapESM: {
        // Ignore this file if it's not included in the bundle. This can happen for
        // wrapped ESM files but not for wrapped CommonJS files because we allow
        // tree shaking inside wrapped ESM files.
        if (!otherFile.isLive) break;

        // Replace the statement with a call to "init()"
        let value = new Expr(new ECall(new Expr(new EIdentifier(otherRepr.ast.wrapperRef), loc)), loc);
        if (otherRepr.meta.isAsyncOrHasAsyncDependency) {
          // This currently evaluates sibling dependencies in serial instead of in
          // parallel, which is incorrect. This should be changed to store a promise
          // and await all stored promises after all imports but before any code.
          value = new Expr(new EAwait(value), value.loc);
        }
        stmtList.insideWrapperPrefix.push(new Stmt(new SExpr(value), loc));
        break;
      }
    }

    return true;
  },

  convertStmtsForChunk(sourceIndex, stmtList, partStmts) {
    const c = this;
    const file = c.graph.files[sourceIndex];
    const shouldStripExports = c.options.mode !== ModePassThrough || !file.isEntryPoint();
    const repr = file.inputFile.repr;
    const shouldExtractESMStmtsForWrap = repr.meta.wrap !== WrapNone;

    // If this file is a CommonJS entry point, double-write re-exports to the
    // external CommonJS "module.exports" object in addition to our internal ESM
    // export namespace object. The difference between these two objects is that
    // our internal one must not have the "__esModule" marker while the external
    // one must have the "__esModule" marker. This is done because an ES module
    // importing itself should not see the "__esModule" marker but a CommonJS module
    // importing us should see the "__esModule" marker.
    let moduleExportsForReExportOrNil = null;
    if (c.options.outputFormat === FormatCommonJS && file.isEntryPoint()) {
      moduleExportsForReExportOrNil = new Expr(new EDot(new Expr(new EIdentifier(c.unboundModuleRef), 0), "exports"), 0);
    }

    for (let stmt of partStmts) {
      const s = stmt.data;
      switch (s.k) {
        case S_IMPORT:
          // "import * as ns from 'path'"
          // "import {foo} from 'path'"
          if (c.shouldRemoveImportExportStmt(sourceIndex, stmtList, stmt.loc, s.namespaceRef, s.importRecordIndex)) {
            continue;
          }

          // (the ArbitraryModuleNamespaceNames check needs a lowered target)

          // Make sure these don't end up in the wrapper closure
          if (shouldExtractESMStmtsForWrap) {
            stmtList.outsideWrapperPrefix.push(stmt);
            continue;
          }
          break;

        case S_EXPORT_STAR: {
          // "export * as ns from 'path'"
          if (s.alias !== null) {
            if (c.shouldRemoveImportExportStmt(sourceIndex, stmtList, stmt.loc, s.namespaceRef, s.importRecordIndex)) {
              continue;
            }

            if (shouldStripExports) {
              // Turn this statement into "import * as ns from 'path'"
              stmt = new Stmt(new SImport(null, null, s.alias.loc, s.namespaceRef, s.importRecordIndex), stmt.loc);
            }

            // Make sure these don't end up in the wrapper closure
            if (shouldExtractESMStmtsForWrap) {
              stmtList.outsideWrapperPrefix.push(stmt);
              continue;
            }
            break;
          }

          // "export * from 'path'"
          if (!shouldStripExports) {
            break;
          }
          const record = repr.ast.importRecords[s.importRecordIndex];

          // Is this export star evaluated at run time?
          if (!(record.sourceIndex >= 0) && formatKeepESMImportExportSyntax(c.options.outputFormat)) {
            if ((record.flags & CallsRunTimeReExportFn) !== 0) {
              // Turn this statement into "import * as ns from 'path'"
              stmt = new Stmt(new SImport(null, null, stmt.loc, s.namespaceRef, s.importRecordIndex), stmt.loc);

              // Prefix this module with "__reExport(exports, ns, module.exports)"
              const exportStarRef = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr.ast.moduleScope.members.get("__reExport").ref;
              const args = [new Expr(new EIdentifier(repr.ast.exportsRef), stmt.loc), new Expr(new EIdentifier(s.namespaceRef), stmt.loc)];
              if (moduleExportsForReExportOrNil !== null) {
                args.push(moduleExportsForReExportOrNil);
              }
              stmtList.insideWrapperPrefix.push(
                new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(exportStarRef), stmt.loc), args), stmt.loc)), stmt.loc),
              );

              // Make sure these don't end up in the wrapper closure
              if (shouldExtractESMStmtsForWrap) {
                stmtList.outsideWrapperPrefix.push(stmt);
                continue;
              }
            }
          } else {
            if (record.sourceIndex >= 0) {
              const otherRepr = c.graph.files[record.sourceIndex].inputFile.repr;
              if (otherRepr.meta.wrap === WrapESM) {
                stmtList.insideWrapperPrefix.push(
                  new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(otherRepr.ast.wrapperRef), stmt.loc)), stmt.loc)), stmt.loc),
                );
              }
            }

            if ((record.flags & CallsRunTimeReExportFn) !== 0) {
              let target = null;
              if (record.sourceIndex >= 0) {
                const otherRepr = c.graph.files[record.sourceIndex].inputFile.repr;
                if (otherRepr.ast.exportsKind === ExportsESMWithDynamicFallback) {
                  // Prefix this module with "__reExport(exports, otherExports, module.exports)"
                  target = new EIdentifier(otherRepr.ast.exportsRef);
                }
              }
              if (target === null) {
                // Prefix this module with "__reExport(exports, require(path), module.exports)"
                target = new ERequireString(s.importRecordIndex);
              }
              const exportStarRef = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr.ast.moduleScope.members.get("__reExport").ref;
              const args = [new Expr(new EIdentifier(repr.ast.exportsRef), stmt.loc), new Expr(target, record.range.loc)];
              if (moduleExportsForReExportOrNil !== null) {
                args.push(moduleExportsForReExportOrNil);
              }
              stmtList.insideWrapperPrefix.push(
                new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(exportStarRef), stmt.loc), args), stmt.loc)), stmt.loc),
              );
            }

            // Remove the export star statement
            continue;
          }
          break;
        }

        case S_EXPORT_FROM:
          // "export {foo} from 'path'"
          if (c.shouldRemoveImportExportStmt(sourceIndex, stmtList, stmt.loc, s.namespaceRef, s.importRecordIndex)) {
            continue;
          }

          if (shouldStripExports) {
            // Turn this statement into "import {foo} from 'path'"
            for (let i = 0; i < s.items.length; i++) {
              s.items[i].alias = s.items[i].originalName;
            }
            stmt = new Stmt(new SImport(null, s.items, null, s.namespaceRef, s.importRecordIndex, s.isSingleLine), stmt.loc);
          }

          // Make sure these don't end up in the wrapper closure
          if (shouldExtractESMStmtsForWrap) {
            stmtList.outsideWrapperPrefix.push(stmt);
            continue;
          }
          break;

        case S_EXPORT_CLAUSE:
          if (shouldStripExports) {
            // Remove export statements entirely
            continue;
          }

          // Make sure these don't end up in the wrapper closure
          if (shouldExtractESMStmtsForWrap) {
            stmtList.outsideWrapperPrefix.push(stmt);
            continue;
          }
          break;

        case S_FUNCTION:
          // Strip the "export" keyword while bundling
          if (shouldStripExports && s.isExport) {
            // Be careful to not modify the original statement
            stmt = new Stmt(new SFunction(s.fn, false), stmt.loc);
          }
          break;

        case S_CLASS:
          if (shouldStripExports && s.isExport) {
            // Be careful to not modify the original statement
            stmt = new Stmt(new SClass(s.class, false), stmt.loc);
          }
          break;

        case S_LOCAL:
          if (shouldStripExports && s.isExport) {
            // Be careful to not modify the original statement
            stmt = new Stmt(new SLocal(s.decls, s.kind, false, s.wasTSImportEquals), stmt.loc);
          }
          break;

        case S_EXPORT_DEFAULT:
          // If we're bundling, convert "export default" into a normal declaration
          if (shouldStripExports) {
            const s2 = s.value.data;
            switch (s2.k) {
              case S_EXPR:
                // "export default foo;" => "var default = foo;"
                stmt = new Stmt(
                  new SLocal([new Decl(new Binding(new BIdentifier(s.defaultName.ref), s.defaultName.loc), s2.value)]),
                  stmt.loc,
                );
                break;

              case S_FUNCTION: {
                // "export default function() {}" => "function default() {}"
                // "export default function foo() {}" => "function foo() {}"

                // Be careful to not modify the original statement
                const fn = s2.fn.clone();
                fn.name = s.defaultName;
                stmt = new Stmt(new SFunction(fn, false), s.value.loc);
                break;
              }

              case S_CLASS: {
                // "export default class {}" => "class default {}"
                // "export default class Foo {}" => "class Foo {}"

                // Be careful to not modify the original statement
                const class_ = s2.class.clone();
                class_.name = s.defaultName;
                stmt = new Stmt(new SClass(class_, false), s.value.loc);
                break;
              }

              default:
                throw new globalThis.Error("Internal error");
            }
          }
          break;
      }

      stmtList.insideWrapperSuffix.push(stmt);
    }
  },
});

// ---------------------------------------------------------------------------
// Code generation

// js_printer.QuoteIdentifier(nil, name, 0)
function quoteIdentifier(name) {
  const hexChars = "0123456789ABCDEF";
  let js = "";
  let isASCII = false;
  let asciiStart = 0;
  const n = name.length;
  for (let i = 0; i < n; ) {
    let c = name.charCodeAt(i);
    let width = 1;
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const c2 = name.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = ((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000;
        width = 2;
      }
    }
    if (c >= 0x20 && c <= 0x7e) {
      // Fast path: a run of ASCII characters
      if (!isASCII) {
        isASCII = true;
        asciiStart = i;
      }
    } else {
      // Slow path: escape non-ACSII characters
      if (isASCII) {
        js += name.slice(asciiStart, i);
        isASCII = false;
      }
      if (c <= 0xffff) {
        js += "\\u" + hexChars[c >> 12] + hexChars[(c >> 8) & 15] + hexChars[(c >> 4) & 15] + hexChars[c & 15];
      } else {
        js += "\\u{" + c.toString(16).toUpperCase() + "}";
      }
    }
    i += width;
  }
  if (isASCII) {
    // Print one final run of ASCII characters
    js += name.slice(asciiStart);
  }
  return js;
}

// js_printer.CanEscapeIdentifier(name, 0, asciiOnly): with no unsupported
// features, Unicode escapes are always available
function canEscapeIdentifier(name) {
  return isIdentifierES5AndESNext(name);
}

// js_printer.Options with the fields that both linker call sites set. Fields
// that Go leaves at their zero value are set explicitly (nil maps become empty
// Maps, which behave identically for lookups).
function makePrinterOptions(c, indent) {
  const o = new PrinterOptions();
  o.requireOrImportMetaForSource = null;
  o.tsEnums = new Map();
  o.constValues = new Map();
  o.mangledProps = c.mangledProps;
  o.inputSourceMap = null;
  o.lineOffsetTables = null;
  o.toCommonJSRef = 0; // Go zero value (ast.Ref{})
  o.toESMRef = 0;
  o.runtimeRequireRef = 0;
  o.unsupportedFeatures = c.options.unsupportedJSFeatures;
  o.indent = indent;
  o.lineLimit = c.options.lineLimit;
  o.outputFormat = c.options.outputFormat;
  o.minifyWhitespace = c.options.minifyWhitespace;
  o.minifyIdentifiers = c.options.minifyIdentifiers;
  o.minifySyntax = c.options.minifySyntax;
  o.asciiOnly = c.options.asciiOnly;
  o.legalComments = c.options.legalComments;
  o.sourceMap = SourceMapNone;
  o.addSourceMappings = false;
  o.needsMetafile = false;
  o.metafileFormat = 0;
  return o;
}

Object.assign(linkerContext.prototype, {
  requireOrImportMetaForSource(sourceIndex) {
    const c = this;
    const repr = c.graph.files[sourceIndex].inputFile.repr;
    const meta = new RequireOrImportMeta();
    meta.wrapperRef = repr.ast.wrapperRef;
    meta.isWrapperAsync = repr.meta.isAsyncOrHasAsyncDependency;
    if (repr.meta.wrap === WrapESM) {
      meta.exportsRef = repr.ast.exportsRef;
    } else {
      meta.exportsRef = InvalidRef;
    }
    return meta;
  },

  generateCodeForFileInChunkJS(r, partRange, toCommonJSRef, toESMRef, runtimeRequireRef, result, dataForSourceMaps) {
    const c = this;
    const file = c.graph.files[partRange.sourceIndex];
    const repr = file.inputFile.repr;
    const nsExportPartIndex = NSExportPartIndex;
    let needsWrapper = false;
    const stmtList_ = new stmtList();

    // The top-level directive must come first (the non-wrapped case is handled
    // by the chunk generation code, although only for the entry point)
    if (repr.meta.wrap !== WrapNone && !file.isEntryPoint()) {
      for (const directive of repr.ast.directives) {
        stmtList_.insideWrapperPrefix.push(new Stmt(new SDirective(directive), 0));
      }
    }

    // Make sure the generated call to "__export(exports, ...)" comes first
    // before anything else.
    if (
      nsExportPartIndex >= partRange.partIndexBegin &&
      nsExportPartIndex < partRange.partIndexEnd &&
      repr.ast.parts[nsExportPartIndex].isLive
    ) {
      c.convertStmtsForChunk(partRange.sourceIndex, stmtList_, c.nsExportStmtsForPart(partRange.sourceIndex, repr.ast.parts[nsExportPartIndex]));

      // Move everything to the prefix list
      if (repr.meta.wrap === WrapESM) {
        for (const s of stmtList_.insideWrapperSuffix) stmtList_.outsideWrapperPrefix.push(s);
      } else {
        for (const s of stmtList_.insideWrapperSuffix) stmtList_.insideWrapperPrefix.push(s);
      }
      stmtList_.insideWrapperSuffix = [];
    }

    if (repr.ast.hasLazyExport) {
      bail(); // (only for non-JS loaders)
    }

    // Add all other parts in this chunk
    for (let partIndex = partRange.partIndexBegin; partIndex < partRange.partIndexEnd; partIndex++) {
      const part = repr.ast.parts[partIndex];
      if (!part.isLive) {
        // Skip the part if it's not in this chunk
        continue;
      }

      if (partIndex === nsExportPartIndex) {
        // Skip the generated call to "__export()" that was extracted above
        continue;
      }

      // Mark if we hit the dummy part representing the wrapper
      if (partIndex === repr.meta.wrapperPartIndex) {
        needsWrapper = true;
        continue;
      }

      c.convertStmtsForChunk(partRange.sourceIndex, stmtList_, part.stmts);
    }

    // Hoist all import statements before any normal statements. ES6 imports
    // are different than CommonJS imports. All modules imported via ES6 import
    // statements are evaluated before the module doing the importing is
    // evaluated (well, except for cyclic import scenarios). We need to preserve
    // these semantics even when modules imported via ES6 import statements end
    // up being CommonJS modules.
    let stmts = stmtList_.insideWrapperSuffix;
    if (stmtList_.insideWrapperPrefix.length > 0) {
      stmts = stmtList_.insideWrapperPrefix.concat(stmts);
    }
    if (c.options.minifySyntax) {
      stmts = mergeAdjacentLocalStmts(stmts);
    }

    // Optionally wrap all statements in a closure
    if (needsWrapper) {
      switch (repr.meta.wrap) {
        case WrapCJS: {
          // Only include the arguments that are actually used
          const args = [];
          if (repr.ast.usesExportsRef || repr.ast.usesModuleRef) {
            args.push(new Arg(new Binding(new BIdentifier(repr.ast.exportsRef), 0)));
            if (repr.ast.usesModuleRef) {
              args.push(new Arg(new Binding(new BIdentifier(repr.ast.moduleRef), 0)));
            }
          }

          let cjsArgs;
          if (c.options.profilerNames) {
            // "__commonJS({ 'file.js'(exports, module) { ... } })"
            // (compat.ObjectExtensions is always supported by the fast path)
            const kind = PropertyMethod;
            const key = new Expr(new EString(file.inputFile.source.prettyPaths.select(c.options.codePathStyle || 0)), 0);
            const value = new Expr(new EFunction(new Fn(null, args, new FnBody(new SBlock(stmts)))), 0);
            cjsArgs = [new Expr(new EObject([new Property(null, key, value, null, [], 0, 0, kind)]), 0)];
          } else {
            // "__commonJS((exports, module) => { ... })"
            cjsArgs = [new Expr(new EArrow(args, new FnBody(new SBlock(stmts))), 0)];
          }
          const value = new Expr(new ECall(new Expr(new EIdentifier(c.cjsRuntimeRef), 0), cjsArgs), 0);

          // "var require_foo = __commonJS(...);"
          stmts = stmtList_.outsideWrapperPrefix.concat([
            new Stmt(new SLocal([new Decl(new Binding(new BIdentifier(repr.ast.wrapperRef), 0), value)]), 0),
          ]);
          break;
        }

        case WrapESM: {
          // The wrapper only needs to be "async" if there is a transitive async
          // dependency. For correctness, we must not use "async" if the module
          // isn't async because then calling "require()" on that module would
          // swallow any exceptions thrown during module initialization.
          const isAsync = repr.meta.isAsyncOrHasAsyncDependency;

          // Hoist all top-level "var" and "function" declarations out of the closure
          let decls = [];
          let end = 0;
          const wrapIdentifier = (loc, ref) => {
            decls.push(new Decl(new Binding(new BIdentifier(ref), loc), null));
            return new Expr(new EIdentifier(ref), loc);
          };
          for (let stmt of stmts) {
            const s = stmt.data;
            if (s.k === S_LOCAL) {
              // Convert the declarations to assignments
              let value = null;
              for (const decl of s.decls) {
                const binding = convertBindingToExpr(decl.binding, wrapIdentifier);
                if (decl.valueOrNil !== null) {
                  value = joinWithComma(value, assign(binding, decl.valueOrNil));
                }
              }
              if (value === null) {
                continue;
              }
              stmt = new Stmt(new SExpr(value), stmt.loc);
            } else if (s.k === S_FUNCTION) {
              stmtList_.outsideWrapperPrefix.push(stmt);
              continue;
            }

            stmts[end] = stmt;
            end++;
          }
          stmts.length = end;

          let esmArgs;
          if (c.options.profilerNames) {
            // "__esm({ 'file.js'() { ... } })"
            // (compat.ObjectExtensions is always supported by the fast path)
            const kind = PropertyMethod;
            const key = new Expr(new EString(file.inputFile.source.prettyPaths.select(c.options.codePathStyle || 0)), 0);
            const value = new Expr(new EFunction(new Fn(null, [], new FnBody(new SBlock(stmts)), InvalidRef, 0, isAsync)), 0);
            esmArgs = [new Expr(new EObject([new Property(null, key, value, null, [], 0, 0, kind)]), 0)];
          } else {
            // "__esm(() => { ... })"
            esmArgs = [new Expr(new EArrow([], new FnBody(new SBlock(stmts)), isAsync), 0)];
          }
          const value = new Expr(new ECall(new Expr(new EIdentifier(c.esmRuntimeRef), 0), esmArgs), 0);

          // "var foo, bar;"
          if (!c.options.minifySyntax && decls.length > 0) {
            stmtList_.outsideWrapperPrefix.push(new Stmt(new SLocal(decls), 0));
            decls = [];
          }

          // "var init_foo = __esm(...);"
          decls.push(new Decl(new Binding(new BIdentifier(repr.ast.wrapperRef), 0), value));
          stmts = stmtList_.outsideWrapperPrefix.concat([new Stmt(new SLocal(decls), 0)]);
          break;
        }
      }
    }

    // Only generate a source map if needed
    let addSourceMappings = false;
    let inputSourceMap = null;
    let lineOffsetTables = null;
    if (loaderCanHaveSourceMap(file.inputFile.loader) && c.options.sourceMap !== SourceMapNone) {
      addSourceMappings = true;
      inputSourceMap = file.inputFile.inputSourceMap;
      lineOffsetTables = dataForSourceMaps[partRange.sourceIndex].lineOffsetTables;
    }

    // Indent the file if everything is wrapped in an IIFE
    let indent = 0;
    if (c.options.outputFormat === FormatIIFE) {
      indent++;
    }

    // Convert the AST to JavaScript code
    const printOptions = makePrinterOptions(c, indent);
    printOptions.toCommonJSRef = toCommonJSRef;
    printOptions.toESMRef = toESMRef;
    printOptions.runtimeRequireRef = runtimeRequireRef;
    printOptions.tsEnums = c.graph.tsEnums;
    printOptions.constValues = c.graph.constValues;
    printOptions.sourceMap = c.options.sourceMap;
    printOptions.addSourceMappings = addSourceMappings;
    printOptions.inputSourceMap = inputSourceMap;
    printOptions.lineOffsetTables = lineOffsetTables;
    printOptions.requireOrImportMetaForSource = c.requireOrImportMetaForSourceFn;
    const tree = cloneAST(repr.ast);
    tree.directives = []; // This is handled elsewhere
    const treePart = new Part();
    treePart.stmts = stmts;
    tree.parts = [treePart];
    result.setPrintResult(printJS(tree, c.graph.symbols, r, printOptions));
    result.sourceIndex = partRange.sourceIndex;
  },

  generateEntryPointTailJS(r, toCommonJSRef, toESMRef, sourceIndex) {
    const c = this;
    const result = new compileResultJS();
    const file = c.graph.files[sourceIndex];
    const repr = file.inputFile.repr;
    const stmts = [];

    switch (c.options.outputFormat) {
      case FormatPreserve:
        if (repr.meta.wrap !== WrapNone) {
          // "require_foo();"
          // "init_foo();"
          stmts.push(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
        }
        break;

      case FormatIIFE:
        if (repr.meta.wrap === WrapCJS) {
          if (c.options.globalName.length > 0) {
            // "return require_foo();"
            stmts.push(new Stmt(new SReturn(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
          } else {
            // "require_foo();"
            stmts.push(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
          }
        } else {
          if (repr.meta.wrap === WrapESM) {
            // "init_foo();"
            stmts.push(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
          }

          if (repr.meta.forceIncludeExportsForEntryPoint) {
            // "return __toCommonJS(exports);"
            stmts.push(
              new Stmt(
                new SReturn(
                  new Expr(new ECall(new Expr(new EIdentifier(toCommonJSRef), 0), [new Expr(new EIdentifier(repr.ast.exportsRef), 0)]), 0),
                ),
                0,
              ),
            );
          }
        }
        break;

      case FormatCommonJS:
        if (repr.meta.wrap === WrapCJS) {
          // "module.exports = require_foo();"
          stmts.push(
            assignStmt(
              new Expr(new EDot(new Expr(new EIdentifier(c.unboundModuleRef), 0), "exports"), 0),
              new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0),
            ),
          );
        } else {
          if (repr.meta.wrap === WrapESM) {
            // "init_foo();"
            stmts.push(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
          }
        }

        // If we are generating CommonJS for node, encode the known export names in
        // a form that node can understand them. This relies on the specific behavior
        // of this parser, which the node project uses to detect named exports in
        // CommonJS files: https://github.com/guybedford/cjs-module-lexer. Think of
        // this code as an annotation for that parser.
        if (c.options.platform === PlatformNode) {
          // Add a comment since otherwise people will surely wonder what this is.
          // This annotation means you can do this and have it work:
          //
          //   import { name } from './file-from-esbuild.cjs'
          //
          // when "file-from-esbuild.cjs" looks like this:
          //
          //   __export(exports, { name: () => name });
          //   0 && (module.exports = {name});
          //
          // The maintainer of "cjs-module-lexer" is receptive to adding esbuild-
          // friendly patterns to this library. However, this library has already
          // shipped in node and using existing patterns instead of defining new
          // patterns is maximally compatible.
          //
          // An alternative to doing this could be to use "Object.defineProperties"
          // instead of "__export" but support for that would need to be added to
          // "cjs-module-lexer" and then we would need to be ok with not supporting
          // older versions of node that don't have that newly-added support.

          // "{a, b, if: null}"
          const moduleExports = [];
          for (const export_ of repr.meta.sortedAndFilteredExportAliases) {
            if (export_ === "default") {
              // In node the default export is always "module.exports" regardless of
              // what the annotation says. So don't bother generating "default".
              continue;
            }

            // "{if: null}"
            let valueOrNil = null;
            if (Keywords.has(export_) || !isIdentifier(export_)) {
              // Make sure keywords don't cause a syntax error. This has to map to
              // "null" instead of something shorter like "0" because the library
              // "cjs-module-lexer" only supports identifiers in this position, and
              // it thinks "null" is an identifier.
              valueOrNil = new Expr(ENullShared, 0);
            }

            moduleExports.push(new Property(null, new Expr(new EString(export_), 0), valueOrNil));
          }

          // Add annotations for re-exports: "{...require('./foo')}"
          for (const importRecordIndex of repr.ast.exportStarImportRecords) {
            const record = repr.ast.importRecords[importRecordIndex];
            if (!(record.sourceIndex >= 0)) {
              moduleExports.push(new Property(null, null, new Expr(new ERequireString(importRecordIndex), 0), null, [], 0, 0, PropertySpread));
            }
          }

          if (moduleExports.length > 0) {
            // "0 && (module.exports = {a, b, if: null});"
            const expr = new Expr(
              new EBinary(
                new Expr(new ENumber(0), 0),
                assign(new Expr(new EDot(new Expr(new EIdentifier(c.unboundModuleRef), 0), "exports"), 0), new Expr(new EObject(moduleExports), 0)),
                BinOpLogicalAnd,
              ),
              0,
            );

            if (!c.options.minifyWhitespace) {
              stmts.push(new Stmt(new SComment("// Annotate the CommonJS export names for ESM import in node:"), 0));
            }

            stmts.push(new Stmt(new SExpr(expr), 0));
          }
        }
        break;

      case FormatESModule:
        if (repr.meta.wrap === WrapCJS) {
          // "export default require_foo();"
          stmts.push(
            new Stmt(new SExportDefault(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0), new LocRef(0, 0)), 0),
          );
        } else {
          if (repr.meta.wrap === WrapESM) {
            if (repr.meta.isAsyncOrHasAsyncDependency) {
              // "await init_foo();"
              stmts.push(
                new Stmt(new SExpr(new Expr(new EAwait(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0)), 0),
              );
            } else {
              // "init_foo();"
              stmts.push(new Stmt(new SExpr(new Expr(new ECall(new Expr(new EIdentifier(repr.ast.wrapperRef), 0)), 0)), 0));
            }
          }

          const aliases = repr.meta.sortedAndFilteredExportAliases;
          if (aliases.length > 0) {
            // If the output format is ES6 modules and we're an entry point, generate an
            // ES6 export statement containing all exports. Except don't do that if this
            // entry point is a CommonJS-style module, since that would generate an ES6
            // export statement that's not top-level. Instead, we will export the CommonJS
            // exports as a default export later on.
            const items = [];

            for (let i = 0; i < aliases.length; i++) {
              const alias = aliases[i];
              const export_ = repr.meta.resolvedExports.get(alias);
              let exportRef = export_.ref;

              // If this is an export of an import, reference the symbol that the import
              // was eventually resolved to. We need to do this because imports have
              // already been resolved by this point, so we can't generate a new import
              // and have that be resolved later.
              const importData = c.graph.files[export_.sourceIndex].inputFile.repr.meta.importsToBind.get(export_.ref);
              if (importData !== undefined) {
                exportRef = importData.ref;
              }

              // Exports of imports need EImportIdentifier in case they need to be re-
              // written to a property access later on
              if (c.graph.symbols.get(exportRef).namespaceAlias !== null) {
                // Create both a local variable and an export clause for that variable.
                // The local variable is initialized with the initial value of the
                // export. This isn't fully correct because it's a "dead" binding and
                // doesn't update with the "live" value as it changes. But ES6 modules
                // don't have any syntax for bare named getter functions so this is the
                // best we can do.
                const tempRef = repr.meta.cjsExportCopies[i];
                stmts.push(
                  new Stmt(new SLocal([new Decl(new Binding(new BIdentifier(tempRef), 0), new Expr(new EImportIdentifier(exportRef), 0))]), 0),
                );
                items.push(new ClauseItem(alias, "", 0, new LocRef(0, tempRef)));
              } else {
                // Local identifiers can be exported using an export clause. This is done
                // this way instead of leaving the "export" keyword on the local declaration
                // itself both because it lets the local identifier be minified and because
                // it works transparently for re-exports across files.
                items.push(new ClauseItem(alias, "", 0, new LocRef(0, exportRef)));
              }
            }

            stmts.push(new Stmt(new SExportClause(items), 0));
          }
        }
        break;
    }

    if (stmts.length === 0) {
      return result;
    }

    const tree = cloneAST(repr.ast);
    tree.directives = [];
    const treePart = new Part();
    treePart.stmts = stmts;
    tree.parts = [treePart];

    // Indent the file if everything is wrapped in an IIFE
    let indent = 0;
    if (c.options.outputFormat === FormatIIFE) {
      indent++;
    }

    // Convert the AST to JavaScript code
    const printOptions = makePrinterOptions(c, indent);
    printOptions.toCommonJSRef = toCommonJSRef;
    printOptions.toESMRef = toESMRef;
    printOptions.runtimeRequireRef = 0; // Go zero value (ast.Ref{})
    printOptions.requireOrImportMetaForSource = c.requireOrImportMetaForSourceFn;
    result.setPrintResult(printJS(tree, c.graph.symbols, r, printOptions));
    return result;
  },

  renameSymbolsInChunk(chunk, filesInOrder) {
    const c = this;

    // Determine the reserved names (e.g. can't generate the name "if")
    const moduleScopes = new Array(filesInOrder.length);
    for (let i = 0; i < filesInOrder.length; i++) {
      moduleScopes[i] = c.graph.files[filesInOrder[i]].inputFile.repr.ast.moduleScope;
    }
    const reservedNames = computeReservedNames(moduleScopes, c.graph.symbols);

    // Node contains code that scans CommonJS modules in an attempt to statically
    // detect the set of export names that a module will use. However, it doesn't
    // do any scope analysis so it can be fooled by local variables with the same
    // name as the CommonJS module-scope variables "exports" and "module". Avoid
    // using these names in this case even if there is not a risk of a name
    // collision because there is still a risk of node incorrectly detecting
    // something in a nested scope as a top-level export. Here's a case where
    // this happened: https://github.com/evanw/esbuild/issues/3544
    if (c.options.outputFormat === FormatCommonJS && c.options.platform === PlatformNode) {
      reservedNames.set("exports", 1);
      reservedNames.set("module", 1);
    }

    // These are used to implement bundling, and need to be free for use
    if (c.options.mode !== ModePassThrough) {
      reservedNames.set("require", 1);
      reservedNames.set("Promise", 1);
    }

    // Make sure imports get a chance to be renamed too (code splitting only)
    if (chunk.chunkRepr.importsFromOtherChunks !== null && chunk.chunkRepr.importsFromOtherChunks.size > 0) bail();

    // Minification uses frequency analysis to give shorter names to more frequent symbols
    if (c.options.minifyIdentifiers) bail(); // (minify only)

    // When we're not minifying, just append numbers to symbol names to avoid collisions
    const r = newNumberRenamer(c.graph.symbols, reservedNames);
    const nestedScopes = new Map();

    for (const sourceIndex of filesInOrder) {
      const repr = c.graph.files[sourceIndex].inputFile.repr;
      const scopes = [];

      // Modules wrapped in a CommonJS closure look like this:
      //
      //   // foo.js
      //   var require_foo = __commonJS((exports, module) => {
      //     exports.foo = 123;
      //   });
      //
      // The symbol "require_foo" is stored in "file.ast.WrapperRef". We want
      // to be able to minify everything inside the closure without worrying
      // about collisions with other CommonJS modules. Set up the scopes such
      // that it appears as if the file was structured this way all along. It's
      // not completely accurate (e.g. we don't set the parent of the module
      // scope to this new top-level scope) but it's good enough for the
      // renaming code.
      if (repr.meta.wrap === WrapCJS) {
        r.addTopLevelSymbol(repr.ast.wrapperRef);

        // External import statements will be hoisted outside of the CommonJS
        // wrapper if the output format supports import statements. We need to
        // add those symbols to the top-level scope to avoid causing name
        // collisions. This code special-cases only those symbols.
        if (formatKeepESMImportExportSyntax(c.options.outputFormat)) {
          for (const part of repr.ast.parts) {
            for (const stmt of part.stmts) {
              const s = stmt.data;
              switch (s.k) {
                case S_IMPORT:
                  if (!(repr.ast.importRecords[s.importRecordIndex].sourceIndex >= 0)) {
                    r.addTopLevelSymbol(s.namespaceRef);
                    if (s.defaultName !== null) {
                      r.addTopLevelSymbol(s.defaultName.ref);
                    }
                    if (s.items !== null) {
                      for (const item of s.items) {
                        r.addTopLevelSymbol(item.name.ref);
                      }
                    }
                  }
                  break;

                case S_EXPORT_STAR:
                  if (!(repr.ast.importRecords[s.importRecordIndex].sourceIndex >= 0)) {
                    r.addTopLevelSymbol(s.namespaceRef);
                  }
                  break;

                case S_EXPORT_FROM:
                  if (!(repr.ast.importRecords[s.importRecordIndex].sourceIndex >= 0)) {
                    r.addTopLevelSymbol(s.namespaceRef);
                    for (const item of s.items) {
                      r.addTopLevelSymbol(item.name.ref);
                    }
                  }
                  break;
              }
            }
          }
        }

        nestedScopes.set(sourceIndex, [repr.ast.moduleScope]);
        continue;
      }

      // Modules wrapped in an ESM closure look like this:
      //
      //   // foo.js
      //   var foo, foo_exports = {};
      //   __export(foo_exports, {
      //     foo: () => foo
      //   });
      //   let init_foo = __esm(() => {
      //     foo = 123;
      //   });
      //
      // The symbol "init_foo" is stored in "file.ast.WrapperRef". We need to
      // minify everything inside the closure without introducing a new scope
      // since all top-level variables will be hoisted outside of the closure.
      if (repr.meta.wrap === WrapESM) {
        r.addTopLevelSymbol(repr.ast.wrapperRef);
      }

      // Rename each top-level symbol declaration in this chunk
      for (const part of repr.ast.parts) {
        if (part.isLive) {
          for (const declared of part.declaredSymbols) {
            if (declared.isTopLevel) {
              r.addTopLevelSymbol(declared.ref);
            }
          }
          for (const scope of part.scopes) scopes.push(scope);
        }
      }

      nestedScopes.set(sourceIndex, scopes);
    }

    // Recursively rename symbols in child scopes now that all top-level
    // symbols have been renamed. This is done in parallel because the symbols
    // inside nested scopes are independent and can't conflict.
    r.assignNamesByScope(nestedScopes);
    return r;
  },

  generateChunkJS(chunkIndex) {
    const c = this;
    const chunk = c.chunks[chunkIndex];
    const chunkRepr = chunk.chunkRepr;
    const compileResults = [];
    const runtimeMembers = c.graph.files[RUNTIME_SOURCE_INDEX].inputFile.repr.ast.moduleScope.members;
    const toCommonJSRef = followSymbols(c.graph.symbols, runtimeMembers.get("__toCommonJS").ref);
    const toESMRef = followSymbols(c.graph.symbols, runtimeMembers.get("__toESM").ref);
    const runtimeRequireRef = followSymbols(c.graph.symbols, runtimeMembers.get("__require").ref);
    const r = c.renameSymbolsInChunk(chunk, chunkRepr.filesInChunkInOrder);
    c.requireOrImportMetaForSourceFn = (sourceIndex) => c.requireOrImportMetaForSource(sourceIndex);
    // (Go's function returns nil when source maps are disabled)
    const dataForSourceMaps = c.options.sourceMap !== SourceMapNone && c.dataForSourceMaps !== null ? c.dataForSourceMaps() : null;

    // (Go computes "chunkAbsDir" here. It is only used to make "file://"
    // source URLs relative, which generateSourceMapForChunk bails on.)
    const chunkAbsDir = "";

    // Generate JavaScript for each file
    for (const partRange of chunkRepr.partsInChunkInOrder) {
      // Skip the runtime in test output
      if (partRange.sourceIndex === RUNTIME_SOURCE_INDEX && c.options.omitRuntimeForTests) {
        continue;
      }

      const compileResult = new compileResultJS();
      compileResults.push(compileResult);
      c.generateCodeForFileInChunkJS(r, partRange, toCommonJSRef, toESMRef, runtimeRequireRef, compileResult, dataForSourceMaps);
    }

    // Also generate the cross-chunk binding code. Without code splitting
    // there are no cross-chunk statements and printing nothing yields "".
    if (chunkRepr.crossChunkPrefixStmts.length > 0 || chunkRepr.crossChunkSuffixStmts.length > 0) bail(); // (code splitting only)
    const crossChunkPrefix = "";
    const crossChunkSuffix = "";

    // Generate the exports for the entry point, if there are any
    let entryPointTail = null;
    if (chunk.isEntryPoint) {
      entryPointTail = c.generateEntryPointTailJS(r, toCommonJSRef, toESMRef, chunk.sourceIndex);
    }

    const j = new Joiner();
    // (prevOffset is only read for source maps, so it is only updated then)
    const trackOffset = c.options.sourceMap !== SourceMapNone;
    let prevOffset = new LineColumnOffset();

    // Optionally strip whitespace
    let indent = "";
    let space = " ";
    let newline = "\n";
    if (c.options.minifyWhitespace) {
      space = "";
      newline = "";
    }
    let newlineBeforeComment = false;
    let isExecutable = false;

    // Start with the hashbang if there is one. This must be done before the
    // banner because it only works if it's literally the first character.
    if (chunk.isEntryPoint) {
      const repr = c.graph.files[chunk.sourceIndex].inputFile.repr;
      if (repr.ast.hashbang !== "") {
        const hashbang = repr.ast.hashbang + "\n";
        if (trackOffset) prevOffset.advanceString(hashbang);
        j.addString(hashbang);
        newlineBeforeComment = true;
        isExecutable = true;
      }
    }

    // Then emit the banner after the hashbang. This must come before the
    // "use strict" directive below because some people use the banner to
    // emit a hashbang, which must be the first thing in the file.
    if (c.options.jsBanner.length > 0) {
      if (trackOffset) {
        prevOffset.advanceString(c.options.jsBanner);
        prevOffset.advanceString("\n");
      }
      j.addString(c.options.jsBanner);
      j.addString("\n");
      newlineBeforeComment = true;
    }

    // Add the top-level directive if present (but omit "use strict" in ES
    // modules because all ES modules are automatically in strict mode)
    if (chunk.isEntryPoint) {
      const repr = c.graph.files[chunk.sourceIndex].inputFile.repr;
      for (const directive of repr.ast.directives) {
        if (directive !== "use strict" || c.options.outputFormat !== FormatESModule) {
          const quoted = quoteForJSON(directive, c.options.asciiOnly) + ";" + newline;
          if (trackOffset) prevOffset.advanceString(quoted);
          j.addString(quoted);
          newlineBeforeComment = true;
        }
      }
    }

    // Optionally wrap with an IIFE
    if (c.options.outputFormat === FormatIIFE) {
      let text = "";
      indent = "  ";
      if (c.options.globalName.length > 0) {
        text = c.generateGlobalNamePrefix();
      }
      // (compat.Arrow is always supported by the fast path)
      text += "(()" + space + "=>" + space + "{" + newline;
      if (trackOffset) prevOffset.advanceString(text);
      j.addString(text);
      newlineBeforeComment = false;
    }

    // Put the cross-chunk prefix inside the IIFE
    if (crossChunkPrefix.length > 0) {
      newlineBeforeComment = true;
      if (trackOffset) prevOffset.advanceBytes(crossChunkPrefix);
      j.addString(crossChunkPrefix);
    }

    // Concatenate the generated JavaScript chunks together
    const compileResultsForSourceMap = [];
    const legalCommentList = [];
    let prevFileNameComment = 0;
    for (const compileResult of compileResults) {
      if (compileResult.extractedLegalComments !== null && compileResult.extractedLegalComments.length > 0) {
        legalCommentList.push(new legalCommentEntry(compileResult.sourceIndex, compileResult.extractedLegalComments));
      }

      // Add a comment with the file path before the file contents
      if (
        c.options.mode === ModeBundle &&
        !c.options.minifyWhitespace &&
        prevFileNameComment !== compileResult.sourceIndex &&
        compileResult.js.length > 0
      ) {
        bail(); // (bundle only)
      }

      // Don't include the runtime in source maps
      if (c.graph.files[compileResult.sourceIndex].inputFile.omitFromSourceMapsAndMetafile) {
        if (trackOffset) prevOffset.advanceString(compileResult.js);
        j.addString(compileResult.js);
      } else {
        // Save the offset to the start of the stored JavaScript
        if (trackOffset) compileResult.generatedOffset = prevOffset.clone();
        j.addString(compileResult.js);

        // Ignore empty source map chunks (a null chunk is Go's zero value)
        if (compileResult.sourceMapChunk !== null && compileResult.sourceMapChunk.shouldIgnore) {
          prevOffset.advanceBytes(compileResult.js);

          // Include a null entry in the source map
          if (compileResult.js.length > 0 && c.options.sourceMap !== SourceMapNone) {
            const n = compileResultsForSourceMap.length;
            if (n > 0 && !compileResultsForSourceMap[n - 1].isNullEntry) {
              compileResultsForSourceMap.push(new compileResultForSourceMap(new SourceMapChunk(), new LineColumnOffset(), compileResult.sourceIndex, true));
            }
          }
        } else {
          if (trackOffset) prevOffset = new LineColumnOffset();

          // Include this file in the source map
          if (c.options.sourceMap !== SourceMapNone) {
            compileResultsForSourceMap.push(
              new compileResultForSourceMap(compileResult.sourceMapChunk, compileResult.generatedOffset, compileResult.sourceIndex, false),
            );
          }
        }

        // (no metafile)
      }

      // Put a newline before the next file path comment
      if (compileResult.js.length > 0) {
        newlineBeforeComment = true;
      }
    }

    // Stick the entry point tail at the end of the file. Deliberately don't
    // include any source mapping information for this because it's automatically
    // generated and doesn't correspond to a location in the input file.
    if (entryPointTail !== null) {
      j.addString(entryPointTail.js);
    }

    // Put the cross-chunk suffix inside the IIFE
    if (crossChunkSuffix.length > 0) {
      if (newlineBeforeComment) {
        j.addString(newline);
      }
      j.addString(crossChunkSuffix);
    }

    // Optionally wrap with an IIFE
    if (c.options.outputFormat === FormatIIFE) {
      j.addString("})();" + newline);
    }

    // Make sure the file ends with a newline
    j.ensureNewlineAtEnd();

    // Note: platforms other than "browser" mark compat.InlineScript as
    // unsupported (bundler.applyOptionDefaults), which makes Go use an empty
    // slash tag here. The port always escapes like the browser platform; the
    // bundler bails when that could make a difference (see transformBundle).
    let slashTag = "/script";
    if (Math.floor(c.options.unsupportedJSFeatures / 68719476736) % 2 === 1) slashTag = "";
    c.maybeAppendLegalComments(c.options.legalComments, legalCommentList, chunk, j, slashTag);

    if (c.options.jsFooter.length > 0) {
      j.addString(c.options.jsFooter);
      j.addString("\n");
    }

    // The JavaScript contents are done now that the source map comment is in
    chunk.intermediateOutput = c.breakJoinerIntoPieces(j);

    if (c.options.sourceMap !== SourceMapNone) {
      const canHaveShifts = chunk.intermediateOutput.pieces !== null;
      chunk.outputSourceMap = c.generateSourceMapForChunk(compileResultsForSourceMap, chunkAbsDir, dataForSourceMaps, canHaveShifts);
    }

    // (hashing is only needed for "[hash]" placeholders, which transforms don't have)
    chunk.isExecutable = isExecutable;
  },

  generateGlobalNamePrefix() {
    const c = this;
    let text = "";
    const globalNameAll = c.options.globalName;
    let prefix = globalNameAll[0];
    let globalName = globalNameAll.slice(1);
    let space = " ";
    let join = ";\n";

    if (c.options.minifyWhitespace) {
      space = "";
      join = ";";
    }

    // Assume the "this" and "import.meta" objects always exist
    let isExistingObject = prefix === "this";
    if (prefix === "import" && globalName.length > 0 && globalName[0] === "meta") {
      prefix = "import.meta";
      globalName = globalName.slice(1);
      isExistingObject = true;
    }

    // Use "||=" to make the code more compact when it's supported
    // (compat.LogicalAssignment is always supported by the fast path)
    if (globalName.length > 0) {
      if (isExistingObject) {
        // Keep the prefix as it is
      } else if (canEscapeIdentifier(prefix)) {
        if (c.options.asciiOnly) {
          prefix = quoteIdentifier(prefix);
        }
        text = "var " + prefix + join;
      } else {
        prefix = "this[" + quoteForJSON(prefix, c.options.asciiOnly) + "]";
      }
      for (let name of globalName) {
        let dotOrIndex;
        if (canEscapeIdentifier(name)) {
          if (c.options.asciiOnly) {
            name = quoteIdentifier(name);
          }
          dotOrIndex = "." + name;
        } else {
          dotOrIndex = "[" + quoteForJSON(name, c.options.asciiOnly) + "]";
        }
        if (isExistingObject) {
          prefix = prefix + dotOrIndex;
          isExistingObject = false;
        } else {
          prefix = "(" + prefix + space + "||=" + space + "{})" + dotOrIndex;
        }
      }
      return text + prefix + space + "=" + space;
    }

    if (isExistingObject) {
      text = prefix + space + "=" + space;
    } else if (canEscapeIdentifier(prefix)) {
      if (c.options.asciiOnly) {
        prefix = quoteIdentifier(prefix);
      }
      text = "var " + prefix + space + "=" + space;
    } else {
      prefix = "this[" + quoteForJSON(prefix, c.options.asciiOnly) + "]";
      text = prefix + space + "=" + space;
    }

    // (unreachable: "globalName" is empty here because of the "||=" case above)
    for (let name of globalName) {
      const oldPrefix = prefix;
      if (canEscapeIdentifier(name)) {
        if (c.options.asciiOnly) {
          name = quoteIdentifier(name);
        }
        prefix = prefix + "." + name;
      } else {
        prefix = prefix + "[" + quoteForJSON(name, c.options.asciiOnly) + "]";
      }
      text += oldPrefix + space + "||" + space + "{}" + join + prefix + space + "=" + space;
    }

    return text;
  },

  // Add all unique legal comments to the end of the file. These are
  // deduplicated because some projects have thousands of files with the same
  // comment. The comment must be preserved in the output for legal reasons but
  // at the same time we want to generate a small bundle when minifying.
  maybeAppendLegalComments(legalComments, legalCommentList, chunk, j, slashTag) {
    const c = this;
    switch (legalComments) {
      case LegalCommentsNone:
      case LegalCommentsInline:
        return;
    }

    const uniqueFirstPartyComments = [];
    let thirdPartyComments = [];
    const hasFirstPartyComment = new Set();

    for (const entry of legalCommentList) {
      const source = c.graph.files[entry.sourceIndex].inputFile.source;
      let packagePath = "";

      // Try to extract a package name from the source path. If we can find a
      // "node_modules" path component in the path, then assume this is a legal
      // comment in third-party code and that everything after "node_modules" is
      // the package name and subpath. If we can't, then assume this is a legal
      // comment in first-party code.
      //
      // The rationale for this behavior: If we just include third-party comments
      // as-is and the third-party comments don't say what package they're from
      // (which isn't uncommon), then it'll look like that comment applies to
      // all code in the file which is very wrong. So we need to somehow say
      // where the comment comes from. But we don't want to say where every
      // comment comes from because people probably won't appreciate this for
      // first-party comments. And we don't want to include the whole path to
      // each third-part module because a) that could contain information about
      // the local machine that people don't want in their bundle and b) that
      // could differ depending on unimportant details like the package manager
      // used to install the packages (npm vs. pnpm vs. yarn).
      if (source.keyPath.namespace !== "dataurl") {
        const path = source.keyPath.text;
        let previous = path.length;
        while (previous > 0) {
          const head = path.slice(0, previous);
          const slash = Math.max(head.lastIndexOf("\\"), head.lastIndexOf("/"));
          const component = path.slice(slash + 1, previous);
          if (component === "node_modules") {
            if (previous < path.length) {
              packagePath = path.slice(previous + 1).split("\\").join("/");
            }
            break;
          }
          previous = slash;
        }
      }

      if (packagePath !== "") {
        thirdPartyComments.push({ packagePaths: [packagePath], comments: entry.comments });
      } else {
        for (const comment of entry.comments) {
          if (!hasFirstPartyComment.has(comment)) {
            hasFirstPartyComment.add(comment);
            uniqueFirstPartyComments.push(comment);
          }
        }
      }
    }

    // Merge package paths with identical comments
    const identical = new Map();
    let end = 0;
    const NUL = String.fromCharCode(0);
    for (const entry of thirdPartyComments) {
      const key = entry.comments.join(NUL);
      const index = identical.get(key);
      if (index !== undefined) {
        const existing = thirdPartyComments[index];
        existing.packagePaths = existing.packagePaths.concat(entry.packagePaths);
      } else {
        identical.set(key, end);
        thirdPartyComments[end] = entry;
        end++;
      }
    }
    thirdPartyComments = thirdPartyComments.slice(0, end);

    switch (legalComments) {
      case LegalCommentsEndOfFile:
        for (const comment of uniqueFirstPartyComments) {
          j.addString(escapeClosingTag(comment, slashTag));
          j.addString("\n");
        }

        if (thirdPartyComments.length > 0) {
          j.addString("/*! Bundled license information:\n");
          for (const entry of thirdPartyComments) {
            j.addString("\n");
            for (const packagePath of entry.packagePaths) {
              j.addString(escapeClosingTag(packagePath, slashTag) + ":\n");
            }
            for (let comment of entry.comments) {
              comment = escapeClosingTag(comment, slashTag);
              if (comment.startsWith("//")) {
                j.addString("  (*" + comment.slice(2) + " *)\n");
              } else if (comment.startsWith("/*") && comment.endsWith("*/")) {
                j.addString("  (" + comment.slice(1, comment.length - 1).split("\n").join("\n  ") + ")\n");
              }
            }
          }
          j.addString("*/\n");
        }
        break;

      case LegalCommentsLinkedWithComment:
      case LegalCommentsExternalWithoutComment: {
        const jComments = new Joiner();

        for (const comment of uniqueFirstPartyComments) {
          jComments.addString(comment);
          jComments.addString("\n");
        }

        if (thirdPartyComments.length > 0) {
          if (uniqueFirstPartyComments.length > 0) {
            jComments.addString("\n");
          }
          jComments.addString("Bundled license information:\n");
          for (const entry of thirdPartyComments) {
            jComments.addString("\n");
            for (const packagePath of entry.packagePaths) {
              jComments.addString(packagePath + ":\n");
            }
            for (const comment of entry.comments) {
              jComments.addString("  " + comment.split("\n").join("\n  ") + "\n");
            }
          }
        }

        chunk.externalLegalComments = jComments.done();
        break;
      }
    }
  },

  breakJoinerIntoPieces(j) {
    const c = this;

    // Optimization: If there can be no substitutions, just reuse the initial
    // joiner that was used when generating the intermediate chunk output
    // instead of creating another one and copying the whole file into it.
    if (!j.contains(c.uniqueKeyPrefix)) {
      return new intermediateOutput(null, j);
    }

    // The unique key prefix is random per build and is never generated in a
    // transform, so it can only be here if the input happened to contain it.
    // Go would then substitute paths for things that look like unique keys;
    // the real esbuild picks a different random prefix, so just fall back.
    bail();
  },

  // Returns a sourcemap.SourceMapPieces
  generateSourceMapForChunk(results, chunkAbsDir, dataForSourceMaps, canHaveShifts) {
    const c = this;
    const j = new Joiner();
    j.addString('{\n  "version": 3');

    // Only write out the sources for a given source index once
    const sourceIndexToSourcesIndex = new Map();

    // Generate the "sources" and "sourcesContent" arrays
    const items = []; // {source, quotedContents}
    let nextSourcesIndex = 0;
    for (const result of results) {
      if (result.isNullEntry) {
        continue;
      }
      if (sourceIndexToSourcesIndex.has(result.sourceIndex)) {
        continue;
      }
      sourceIndexToSourcesIndex.set(result.sourceIndex, nextSourcesIndex);
      const file = c.graph.files[result.sourceIndex];

      // Simple case: no nested source map
      if (file.inputFile.inputSourceMap === null) {
        let quotedContents = null;
        if (!c.options.excludeSourcesContent) {
          quotedContents = dataForSourceMaps[result.sourceIndex].quotedContents[0];
        }
        const keyPath = file.inputFile.source.keyPath;
        let source = keyPath.text;
        if (keyPath.namespace === "file") {
          // Serialize the file path as a "file://" URL, since source maps encode
          // sources as URLs.
          bail(); // (transforms never create "file" namespace paths)
        } else {
          // If the path for this file isn't in the "file" namespace, then write
          // out something arbitrary instead. Source maps encode sources as URLs
          // but plugins are allowed to put almost anything in the "namespace"
          // and "path" fields, so we don't attempt to control whether this forms
          // a valid URL or not.
          //
          // The approach used here is to join the namespace with the path text
          // using a ":" character. It's important to include the namespace
          // because esbuild considers paths with different namespaces to have
          // separate identities. And using a ":" means that the path is more
          // likely to form a valid URL in the source map.
          const ns = keyPath.namespace;
          if (ns !== "") {
            source = ns + ":" + source;
          }
          source += keyPath.ignoredSuffix;
        }
        items.push({ source, quotedContents });
        nextSourcesIndex++;
        continue;
      }

      // Complex case: nested source map
      bail(); // (input source maps are never loaded: see bundler.parseFile)
    }

    // Write the sources
    j.addString(',\n  "sources": [');
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (i !== 0) {
        j.addString(", ");
      }

      // Modify the absolute path to the original file to be relative to the
      // directory that will contain the output file for this chunk. (Go's
      // url.Parse only yields a "file" scheme for text starting with "file:"
      // in any case; that path through the file system is not ported.)
      if (item.source.length >= 5 && item.source.slice(0, 5).toLowerCase() === "file:") {
        bail();
      }

      j.addBytes(quoteForJSON(item.source, c.options.asciiOnly));
    }
    j.addString("]");

    if (c.options.sourceRoot !== "") {
      j.addString(',\n  "sourceRoot": ');
      j.addBytes(quoteForJSON(c.options.sourceRoot, c.options.asciiOnly));
    }

    // Write the sourcesContent
    if (!c.options.excludeSourcesContent) {
      j.addString(',\n  "sourcesContent": [');
      for (let i = 0; i < items.length; i++) {
        if (i !== 0) {
          j.addString(", ");
        }
        j.addBytes(items[i].quotedContents);
      }
      j.addString("]");
    }

    j.addString(',\n  "mappings": "');

    // Write the mappings
    const mappingsStart = j.length;
    let prevEndState = new SourceMapState();
    let prevColumnOffset = 0;
    let totalQuotedNameLen = 0;
    for (const result of results) {
      const chunk = result.sourceMapChunk;
      const offset = result.generatedOffset;
      let sourcesIndex = sourceIndexToSourcesIndex.get(result.sourceIndex);
      if (sourcesIndex === undefined) {
        // If there's no sourcesIndex, then every mapping for this result's
        // sourceIndex were null mappings. We still need to emit the null
        // mapping, but its source index won't matter.
        sourcesIndex = 0;
        if (!result.isNullEntry) {
          throw new Error("Internal error");
        }
      }

      // This should have already been checked earlier
      if (chunk.shouldIgnore) {
        throw new Error("Internal error");
      }

      // Because each file for the bundle is converted to a source map once,
      // the source maps are shared between all entry points in the bundle.
      // The easiest way of getting this to work is to have all source maps
      // generate as if their source index is 0. We then adjust the source
      // index per entry point by modifying the first source mapping. This
      // is done by AppendSourceMapChunk() using the source index passed
      // here.
      const startState = new SourceMapState(offset.lines, offset.columns, sourcesIndex, 0, 0, totalQuotedNameLen);
      if (offset.lines === 0) {
        startState.generatedColumn += prevColumnOffset;
      }

      if (result.isNullEntry) {
        // Emit a "null" mapping (Go replaces the data of its copy of the chunk)
        appendSourceMapChunk(j, prevEndState, startState, new MappingsBuffer("A", chunk.buffer.firstNameOffset));

        // Only the generated position was advanced
        prevEndState.generatedLine = startState.generatedLine;
        prevEndState.generatedColumn = startState.generatedColumn;
      } else {
        // Append the precomputed source map chunk
        appendSourceMapChunk(j, prevEndState, startState, chunk.buffer);

        // Generate the relative offset to start from next time
        const prevOriginalName = prevEndState.originalName;
        prevEndState = chunk.endState.clone();
        prevEndState.sourceIndex += sourcesIndex;
        if (chunk.buffer.firstNameOffset >= 0) {
          prevEndState.originalName += totalQuotedNameLen;
        } else {
          // It's possible for a chunk to have mappings but for none of those
          // mappings to have an associated name. The name is optional and is
          // omitted when the mapping is for a non-name token or if the final
          // and original names are the same. In that case we need to restore
          // the previous original name end state since it wasn't modified after
          // all. If we don't do this, then files after this will adjust their
          // name offsets assuming that the previous generated mapping has this
          // file's offset, which is wrong.
          prevEndState.originalName = prevOriginalName;
        }
        prevColumnOffset = chunk.finalGeneratedColumn;
        totalQuotedNameLen += chunk.quotedNames === null ? 0 : chunk.quotedNames.length;
      }

      // If this was all one line, include the column offset from the start
      if (prevEndState.generatedLine === 0) {
        prevEndState.generatedColumn += startState.generatedColumn;
        prevColumnOffset += startState.generatedColumn;
      }
    }
    const mappingsEnd = j.length;

    // Write the names
    let isFirstName = true;
    j.addString('",\n  "names": [');
    for (const result of results) {
      const quotedNames = result.sourceMapChunk.quotedNames;
      if (quotedNames === null) {
        continue;
      }
      for (const quotedName of quotedNames) {
        if (isFirstName) {
          isFirstName = false;
        } else {
          j.addString(", ");
        }
        j.addBytes(quotedName);
      }
    }
    j.addString("]");

    // Finish the source map
    j.addString("\n}\n");
    const bytes = j.done();

    const pieces = new SourceMapPieces();
    if (!canHaveShifts) {
      // If there cannot be any shifts, then we can avoid doing extra work later
      // on by preserving the source map as a single memory allocation throughout
      // the pipeline. That way we won't need to reallocate it.
      pieces.prefix = bytes;
    } else {
      // Otherwise if there can be shifts, then we need to split this into several
      // slices so that the shifts in the mappings array can be processed. This is
      // more expensive because everything will need to be recombined into a new
      // memory allocation at the end.
      pieces.prefix = bytes.slice(0, mappingsStart);
      pieces.mappings = bytes.slice(mappingsStart, mappingsEnd);
      pieces.suffix = bytes.slice(mappingsEnd);
    }
    return pieces;
  },

  // Marking a symbol as unbound prevents it from being renamed or minified.
  // This is only used when a module is compiled independently. We use a very
  // different way of handling exports and renaming/minifying when bundling.
  preventExportsFromBeingRenamed(sourceIndex) {
    const c = this;
    const repr = c.graph.files[sourceIndex].inputFile.repr;
    if (!(repr instanceof JSRepr)) return;
    let hasImportOrExport = false;

    for (const part of repr.ast.parts) {
      for (const stmt of part.stmts) {
        const s = stmt.data;
        switch (s.k) {
          case S_IMPORT:
            // Ignore imports from internal (i.e. non-external) code. Since this
            // function is only called when we're not bundling, these imports are
            // all for files that were generated automatically and aren't part of
            // the original source code (e.g. the runtime or an injected file).
            // We shouldn't consider the file a module if the only ESM imports or
            // exports are automatically generated ones.
            if (repr.ast.importRecords[s.importRecordIndex].sourceIndex >= 0) {
              continue;
            }

            hasImportOrExport = true;
            break;

          case S_LOCAL:
            if (s.isExport) {
              forEachIdentifierBindingInDecls(s.decls, (loc, b) => {
                writableSymbol(c.graph.symbols, b.ref).flags |= MustNotBeRenamed;
              });
              hasImportOrExport = true;
            }
            break;

          case S_FUNCTION:
            if (s.isExport) {
              writableSymbol(c.graph.symbols, s.fn.name.ref).kind = SymbolUnbound;
              hasImportOrExport = true;
            }
            break;

          case S_CLASS:
            if (s.isExport) {
              writableSymbol(c.graph.symbols, s.class.name.ref).kind = SymbolUnbound;
              hasImportOrExport = true;
            }
            break;

          case S_EXPORT_CLAUSE:
          case S_EXPORT_DEFAULT:
          case S_EXPORT_STAR:
            hasImportOrExport = true;
            break;

          case S_EXPORT_FROM:
            hasImportOrExport = true;
            break;
        }
      }
    }

    // Heuristic: If this module has top-level import or export statements, we
    // consider this an ES6 module and only preserve the names of the exported
    // symbols. Everything else is minified since the names are private.
    //
    // Otherwise, we consider this potentially a script-type file instead of an
    // ES6 module. In that case, preserve the names of all top-level symbols
    // since they are all potentially exported (e.g. if this is used in a
    // <script> tag). All symbols in nested scopes are still minified.
    if (!hasImportOrExport) {
      for (const member of repr.ast.moduleScope.members.values()) {
        writableSymbol(c.graph.symbols, member.ref).flags |= MustNotBeRenamed;
      }
    }
  },
});
