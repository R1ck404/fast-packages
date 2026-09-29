// The CSS half of a transform: ports of the parts of internal/bundler
// (ScanBundle + Bundle.Compile for a CSS stdin file) and internal/linker
// (findImportedFilesInCSSOrder, mangleLocalCSS, generateChunkCSS,
// wrapRulesWithConditions and the CSS side of generateChunksInParallel) that
// api.Transform reaches with the "css", "local-css" or "global-css" loader.
// See CONVENTIONS.md.
//
// JS-only: a CSS transform skips the JavaScript runtime file and the
// JavaScript half of the linker. In Go they run, but they can never
// contribute to the output of a CSS entry point: the runtime is only
// reachable from JavaScript files, so it is not live, no JavaScript chunk is
// created, and mangleProps finds no JavaScript file to mangle properties in
// (the mangle cache comes back unchanged). The "<define:...>" files of
// object/array defines are not parsed either (nothing imports them), but
// they still take their source indices.
//
// A transform never resolves import records, so every "@import" and "url()"
// is external, "composes: ... from" never reaches another file (the
// cross-file checks of scanImportsAndExports and
// validateComposesFromProperties cannot fire) and the chunk is exactly the
// stdin file with its external imports hoisted in front.
import { goQuote } from "./gostd.mjs";
import { GoPanic } from "./gopanic.mjs";
                                         
import { isStackOverflow, recoverLinkerPanic } from "./recover.mjs";
import { canRetryDeep, runDeep } from "./deep.mjs";
import { Path } from "./logger.mjs";
import { ImportAt, ImportComposesFrom, ImportRecord, SymbolGlobalCSS, WasLoadedWithEmptyLoader, followSymbols, makeRef, refSource, newSymbolMap, newCharFreq, charFreqInclude, NameMinifier } from "./ast.mjs";
import { Joiner, escapeClosingTag, stringArrayArraysEqual, quoteForJSON } from "./helpers.mjs";
import {
  SourceMapNone,
  SourceMapLinkedWithComment,
  SourceMapInline,
  SourceMapInlineAndExternal,
  SourceMapExternalWithoutComment,
  LegalCommentsLinkedWithComment,
  ModeBundle,
  metafileFormatMaybeRemoveWhitespace,
  templateToString,
} from "./config.mjs";
import { CSSRepr, OutputFile } from "./graph.mjs";
import { LineColumnOffset, Chunk as SourceMapChunk, generateLineOffsetTables, quoteForJSONLong } from "./sourcemap.mjs";
import { linkerContext, legalCommentEntry, compileResultForSourceMap, base64StdEncodeUTF8, loaderCanHaveSourceMap, chunkNameForTimer } from "./linker.mjs";
import { parseFile, makePrettyPaths, cloneConfigOptions, applyOptionDefaults, DataForSourceMap, nestedQuotedContents, generateUniqueKeyPrefix } from "./bundler.mjs";
import { applyTSConfigOverride } from "./tsconfig.mjs";
import { sortStableSymbolCountArray, StableSymbolCount } from "./renamer.mjs";
import {
  AST,
  Rule,
  RAtCharset,
  RAtImport,
  RAtLayer,
  RAtMedia,
  RKnownAt,
  ImportConditions,
  tokensEqualIgnoringWhitespace,
  mediaQueriesEqualIgnoringWhitespace,
  cloneTokensWithImportRecords,
  cloneMediaQueriesWithImportRecords,
} from "./css_ast.mjs";
                                           
import { TOpenParen } from "./css_lexer.mjs";
import { makeDeadRuleMangler } from "./css_parser.mjs";
import { print as printCSS, Options as CSSPrinterOptions } from "./css_printer.mjs";
import { cssFeatureHas, InlineStyle } from "./compat_css.mjs";

// ast.DefaultNameMinifierCSS
const DefaultNameMinifierCSS = new NameMinifier(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_",
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_",
);

// ---------------------------------------------------------------------------
// The linker graph for a CSS transform: only the stdin file

class cssLinkerFile {
                         
  constructor(inputFile) {
    this.inputFile = inputFile;
  }
}

// ---------------------------------------------------------------------------
// transformBundle for a CSS stdin file

// Returns { code, map, legalComments } like bundler.transformBundle
export function transformBundleCSS(configOptions, log, mangleCache, timer              ) {
  timer?.begin("Scan phase");
  const scanned = scanStdinCSS(configOptions, log, timer);
  timer?.end("Scan phase");
  if (scanned === null) return { code: "", map: "", legalComments: null };
  timer?.begin("Compile phase");
  try {
    return compileStdinCSS(scanned[0], log, scanned[1], scanned[2], timer);
  } finally {
    timer?.end("Compile phase");
  }
}

// ScanBundle for a CSS stdin file: [options, the stdin file's source index,
// its InputFile], or null when there were errors
function scanStdinCSS(configOptions, log, timer              )                            {
  const options = cloneConfigOptions(configOptions);
  applyOptionDefaults(options);
  timer?.begin("On-start callbacks");
  timer?.end("On-start callbacks");

  // (resolver.NewResolver parses "tsconfigRaw" for every transform, and may
  // log errors and warnings about it)
  applyTSConfigOverride(log, options);

  // preprocessInjectedFiles: the "<define:NAME>" files come first (see above)
  timer?.begin("Preprocess injected files");
  timer?.end("Preprocess injected files");
  timer?.begin("Add entry points");
  const stdin = options.stdin;
  let stdinPath = new Path("<stdin>");
  if (stdin.sourceFile !== "") {
    if (stdin.absResolveDir === "") {
      stdinPath = new Path(stdin.sourceFile);
    } else {
      throw new GoPanic("Internal error"); // (a transform's stdin has no resolve directory)
    }
  }
  // (the stdin file does not have the path of an injected define file: see
  // bundler.transformBundle)
  const sourceIndex = 1 + options.injectedDefines.length;
  const result = parseFile(log, stdinPath, makePrettyPaths(stdinPath), sourceIndex, options, null);
  const inputFile = result.file.inputFile;
  timer?.end("Add entry points");
  timer?.begin("Scan all dependencies");
  timer?.end("Scan all dependencies");
  timer?.begin("Process scanned files");
  timer?.end("Process scanned files");

  // Stop now if there were errors (api.transformImpl: no Compile)
  if (log.hasErrors()) return null;
  if (!(inputFile.repr instanceof CSSRepr)) throw new GoPanic("Internal error");
  return [options, sourceIndex, inputFile];
}

// Compile and Link for a CSS stdin file
function compileStdinCSS(options, log, sourceIndex        , inputFile, timer              ) {

  // Compile: findReachableFiles is [runtime, stdin]; the stable source index
  // of the stdin file is 1

  // computeDataForSourceMapsInParallel
  timer?.begin("Spawn source map tasks");
  timer?.end("Spawn source map tasks");
  let dataForSourceMaps                            = null;
  if (options.sourceMap !== SourceMapNone) {
    dataForSourceMaps = new Array(sourceIndex + 1);
    for (let i = 0; i <= sourceIndex; i++) dataForSourceMaps[i] = new DataForSourceMap();
    if (loaderCanHaveSourceMap(inputFile.loader)) {
      const data = dataForSourceMaps[sourceIndex];
      data.lineOffsetTables = generateLineOffsetTables(inputFile.source.contents, inputFile.repr.ast.approximateLineCount);
      if (!options.excludeSourcesContent) {
        if (inputFile.inputSourceMap === null) {
          data.quotedContents = [quoteForJSONLong(inputFile.source.contents, options.asciiOnly)];
        } else {
          data.quotedContents = nestedQuotedContents(inputFile.inputSourceMap, options.asciiOnly);
        }
      }
    }
  }

  // Link (CloneLinkerGraph: the symbols move into the symbol map)
  timer?.begin("Link");
  try {
    return linkStdinCSS(options, log, sourceIndex, inputFile, dataForSourceMaps, timer);
  } finally {
    timer?.end("Link");
  }
}

function linkStdinCSS(options, log, sourceIndex        , inputFile, dataForSourceMaps                           , timer              ) {
  timer?.begin("Clone linker graph");
  const c = new linkerContext(options, log, generateUniqueKeyPrefix());
  const files = new Array(sourceIndex + 1).fill(null);
  files[sourceIndex] = new cssLinkerFile(inputFile);
  const symbols = newSymbolMap(sourceIndex + 1);
  symbols.symbolsForSource[sourceIndex] = inputFile.repr.ast.symbols;
  c.graph = { files, symbols, reachableFiles: [sourceIndex], stableSourceIndices: null };
  c.dataForSourceMaps = () => dataForSourceMaps;
  timer?.end("Clone linker graph");

  // (scanImportsAndExports: nothing to do for a CSS file whose import
  // records are all external, see the top of this file)
  timer?.begin("Scan imports and exports");
  for (let step = 1; step <= 6; step++) {
    timer?.begin("Step " + step);
    timer?.end("Step " + step);
  }
  timer?.end("Scan imports and exports");
  for (const record of inputFile.repr.ast.importRecords) {
    if (record.sourceIndex >= 0 || record.copySourceIndex >= 0) throw new GoPanic("Internal error"); // (transforms resolve nothing)
  }
  timer?.begin("Tree shaking");
  timer?.end("Tree shaking");
  timer?.begin("Code splitting");
  timer?.end("Code splitting");

  // computeChunks: the entry point's CSS chunk
  timer?.begin("Compute chunks");
  const order = findImportedFilesInCSSOrder(c, [sourceIndex]);
  timer?.end("Compute chunks");
  timer?.begin("Compute cross-chunk dependencies");
  timer?.end("Compute cross-chunk dependencies");

  // mangleProps (no JavaScript files) and mangleLocalCSS with a fresh
  // "cssUsedLocalNames" (Go makes one per Compile call)
  timer?.begin("Waiting for mangle cache");
  timer?.end("Waiting for mangle cache");
  timer?.begin("Mangle props");
  c.mangledProps = new Map();
  timer?.end("Mangle props");
  timer?.begin("Mangle local CSS");
  mangleLocalCSS(c, new Map(), sourceIndex);
  timer?.end("Mangle local CSS");

  // generateChunksInParallel
  timer?.begin("Generate chunks");
  const chunk = { chunkRepr: { importsInChunkInOrder: order }, isEntryPoint: true, sourceIndex, finalTemplate: null, finalRelPath: "", externalLegalComments: "", outputSourceMap: null       , intermediateOutput: null       , jsonMetadataChunkCallback: null };
  // (Go: "defer c.recoverInternalError(...)": the transform then fails with
  // the error, and its output is not looked at)
  try {
    const forked = timer === null ? null : timer.fork();
    const timeName = forked === null ? "" : "Generate chunk " + goQuote(chunkNameForTimer(c, chunk));
    forked?.begin(timeName);
    try {
      generateChunkCSS(c, chunk, forked);
    } finally {
      forked?.end(timeName);
      timer?.join(forked);
    }
  } catch (e) {
    recoverLinkerPanic(e, log, null);
    timer?.end("Generate chunks");
    return { code: "", map: "", legalComments: null };
  }
  timer?.begin("Generate final output files");
  timer?.end("Generate final output files");
  timer?.end("Generate chunks");

  // (The final path of the chunk is "<stdin>-out" or "<sourcefile>-out";
  // like linker.generateChunksInParallel, only the relative lengths of the
  // output paths matter)
  const finalRelPath = "<chunk0>";
  const commentPrefix = "/*";
  const commentSuffix = " */";

  // (substituteFinalPaths: a transform never has pieces, see
  // linker.breakJoinerIntoPieces)
  const outputContentsJoiner = chunk.intermediateOutput.joiner;
  let legalComments                = null;
  let sourceMap = "";

  // Generate the optional legal comments file for this chunk
  if (chunk.externalLegalComments.length > 0) {
    // Link the file to the legal comments
    if (options.legalComments === LegalCommentsLinkedWithComment) throw new GoPanic("Internal error"); // (transforms reject linked legal comments)

    // Write the external legal comments file
    legalComments = chunk.externalLegalComments;
  }

  // Generate the optional source map for this chunk
  if (options.sourceMap !== SourceMapNone && chunk.outputSourceMap.hasContent()) {
    const outputSourceMap = chunk.outputSourceMap.finalize([]);

    // Potentially write a trailing source map comment
    switch (options.sourceMap) {
      case SourceMapLinkedWithComment:
        throw new GoPanic("Internal error"); // (transforms reject linked source maps)

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
    switch (options.sourceMap) {
      case SourceMapInlineAndExternal:
      case SourceMapExternalWithoutComment:
        sourceMap = outputSourceMap;
        break;
    }
  }

  // (api.transformImpl: the chunk is the shortest output path, then "X.map"
  // and "X.LEGAL.txt")
  void finalRelPath;
  void OutputFile;
  return { code: outputContentsJoiner.done(), map: sourceMap, legalComments };
}

// ---------------------------------------------------------------------------
// linker.go: CSS import order

// cssImportKind
const cssImportNone = 0;
export const cssImportSourceIndex = 1;
export const cssImportExternalPath = 2;
export const cssImportLayers = 3;
void cssImportNone;

export class cssImportOrder {
                                                
                                                        
                                     // kind == cssImportAtLayer
                              // kind == cssImportExternal
                               // kind == cssImportSourceIndex
                       
  constructor(
    conditions                            = null,
    conditionImportRecords                        = null,
    layers                    = null,
    externalPath       = new Path(),
    sourceIndex = 0,
    kind = cssImportNone,
  ) {
    this.conditions = conditions;
    this.conditionImportRecords = conditionImportRecords;
    this.layers = layers;
    this.externalPath = externalPath;
    this.sourceIndex = sourceIndex;
    this.kind = kind;
  }
  clone()                 {
    return new cssImportOrder(this.conditions, this.conditionImportRecords, this.layers, this.externalPath, this.sourceIndex, this.kind);
  }
}

// logger.Path is comparable in Go (a map key): text, namespace, ignored
// suffix, import attributes and flags
function pathKey(p      )         {
  return p.text + "\0" + p.namespace + "\0" + p.ignoredSuffix + "\0" + (p.importAttributes === null ? "" : String(p.importAttributes)) + "\0" + p.flags;
}

// CSS files are traversed in depth-first postorder just like JavaScript. But
// unlike JavaScript import statements, CSS "@import" rules are evaluated every
// time instead of just the first time. (See the Go source for the details.)
export function findImportedFilesInCSSOrder(c, entryPoints          )                   {
  let order                   = [];
  let hasExternalImport = false;

  // Include this file and all files it imports
  const visit = (sourceIndex        , visited          , wrappingConditions                           , wrappingImportRecords                       ) => {
    // The CSS specification strangely does not describe what to do when there
    // is a cycle. So we are left with reverse-engineering the behavior from a
    // real browser: bail out of a cycle (see WebKit's
    // "StyleRuleImport::requestStyleSheet()").
    for (let i = 0; i < visited.length; i++) {
      if (visited[i] === sourceIndex) {
        return;
      }
    }
    visited = visited.concat([sourceIndex]);

    const repr = c.graph.files[sourceIndex].inputFile.repr;
    const topLevelRules = repr.ast.rules;

    // Any pre-import layers come first
    if (repr.ast.layersPreImport !== null && repr.ast.layersPreImport.length > 0) {
      order.push(new cssImportOrder(wrappingConditions, wrappingImportRecords, repr.ast.layersPreImport, new Path(), 0, cssImportLayers));
    }

    // Iterate over the top-level "@import" rules
    for (let i = 0; i < topLevelRules.length; i++) {
      const atImport = topLevelRules[i].data;
      if (atImport instanceof RAtImport) {
        const record = repr.ast.importRecords[atImport.importRecordIndex];

        // Follow internal dependencies
        if (record.sourceIndex >= 0) {
          let nestedConditions = wrappingConditions;
          let nestedImportRecords = wrappingImportRecords;

          // If this import has conditions, fork our state so that the entire
          // imported stylesheet subtree is wrapped in all of the conditions
          if (atImport.importConditions !== null) {
            // Fork our state
            nestedConditions = nestedConditions === null ? [] : nestedConditions.slice();
            nestedImportRecords = nestedImportRecords === null ? [] : nestedImportRecords.slice();

            // Clone these import conditions and append them to the state
            const r = atImport.importConditions.cloneWithImportRecords(repr.ast.importRecords, nestedImportRecords);
            nestedImportRecords = r[1];
            nestedConditions.push(r[0]);
          }

          visit(record.sourceIndex, visited, nestedConditions, nestedImportRecords);
          continue;
        }

        // Record external dependencies
        if ((record.flags & WasLoadedWithEmptyLoader) === 0) {
          let allConditions = wrappingConditions;
          let allImportRecords = wrappingImportRecords;

          // If this import has conditions, append it to the list of overall
          // conditions for this external import. Note that an external import
          // may actually have multiple sets of conditions that can't be
          // merged. When this happens we need to generate a nested imported
          // CSS file using a data URL.
          if (atImport.importConditions !== null) {
            allConditions = allConditions === null ? [] : allConditions.slice();
            allImportRecords = allImportRecords === null ? [] : allImportRecords.slice();
            const r = atImport.importConditions.cloneWithImportRecords(repr.ast.importRecords, allImportRecords);
            allImportRecords = r[1];
            allConditions.push(r[0]);
          }

          order.push(new cssImportOrder(allConditions, allImportRecords, null, record.path, 0, cssImportExternalPath));
          hasExternalImport = true;
        }
      }
    }

    // Iterate over the "composes" directives. Note that the order doesn't
    // matter for these because the output order is explicitly undefined
    // in the specification.
    for (const record of repr.ast.importRecords) {
      if (record.kind === ImportComposesFrom && record.sourceIndex >= 0) {
        visit(record.sourceIndex, visited, wrappingConditions, wrappingImportRecords);
      }
    }

    // Accumulate imports in depth-first postorder
    order.push(new cssImportOrder(wrappingConditions, wrappingImportRecords, null, new Path(), sourceIndex, cssImportSourceIndex));
  };

  // Include all files reachable from any entry point
  for (const sourceIndex of entryPoints) {
    visit(sourceIndex, [], null, null);
  }

  // Create a temporary array that we can use for filtering
  let wipOrder                   = [];

  // CSS syntax unfortunately only allows "@import" rules at the top of the
  // file. This means we must hoist all external "@import" rules to the top of
  // the file when bundling, even though doing so will change the order of CSS
  // evaluation.
  if (hasExternalImport) {
    // Pass 1: Pull out leading "@layer" and external "@import" rules
    let isAtLayerPrefix = true;
    for (const entry of order) {
      if ((entry.kind === cssImportLayers && isAtLayerPrefix) || entry.kind === cssImportExternalPath) {
        wipOrder.push(entry.clone());
      }
      if (entry.kind !== cssImportLayers) {
        isAtLayerPrefix = false;
      }
    }

    // Pass 2: Append everything that we didn't pull out in pass 1
    isAtLayerPrefix = true;
    for (const entry of order) {
      if ((entry.kind !== cssImportLayers || !isAtLayerPrefix) && entry.kind !== cssImportExternalPath) {
        wipOrder.push(entry.clone());
      }
      if (entry.kind !== cssImportLayers) {
        isAtLayerPrefix = false;
      }
    }

    order = wipOrder;
    wipOrder = [];
  }

  // Next, optimize import order. If there are duplicate copies of an imported
  // file, replace all but the last copy with just the layers that are in that
  // file. This works because in CSS, the last instance of a declaration
  // overrides all previous instances of that declaration.
  {
    const sourceIndexDuplicates = new Map                  ();
    const externalPathDuplicates = new Map                  ();

    nextBackward: for (let i = order.length - 1; i >= 0; i--) {
      const entry = order[i];
      switch (entry.kind) {
        case cssImportSourceIndex: {
          const duplicates = sourceIndexDuplicates.get(entry.sourceIndex) || [];
          for (const j of duplicates) {
            if (isConditionalImportRedundant(entry.conditions, order[j].conditions)) {
              order[i].kind = cssImportLayers;
              order[i].layers = c.graph.files[entry.sourceIndex].inputFile.repr.ast.layersPostImport;
              continue nextBackward;
            }
          }
          sourceIndexDuplicates.set(entry.sourceIndex, duplicates.concat([i]));
          break;
        }

        case cssImportExternalPath: {
          const key = pathKey(entry.externalPath);
          const duplicates = externalPathDuplicates.get(key) || [];
          for (const j of duplicates) {
            if (isConditionalImportRedundant(entry.conditions, order[j].conditions)) {
              // Don't remove duplicates entirely. The import conditions may
              // still introduce layers to the layer order. Represent this as a
              // file with an empty layer list.
              order[i].kind = cssImportLayers;
              continue nextBackward;
            }
          }
          externalPathDuplicates.set(key, duplicates.concat([i]));
          break;
        }
      }
    }
  }

  // Then optimize "@layer" rules by removing redundant ones. This loop goes
  // forward instead of backward because "@layer" takes effect at the first
  // copy instead of the last copy like other things in CSS.
  {
    const layerDuplicates                                                     = [];

    nextForward: for (let i = 0; i < order.length; i++) {
      const entry = order[i].clone();

      // Simplify the conditions since we know they only wrap "@layer"
      if (entry.kind === cssImportLayers) {
        // Truncate the conditions at the first anonymous layer
        const conditions0 = entry.conditions === null ? [] : entry.conditions;
        for (let k = 0; k < conditions0.length; k++) {
          const conditions = conditions0[k];
          // The layer is anonymous if it's a "layer" token without any
          // children instead of a "layer(...)" token with children
          if (conditions.layers !== null && conditions.layers.length === 1 && conditions.layers[0].children === null) {
            entry.conditions = conditions0.slice(0, k);
            entry.layers = null;
            break;
          }
        }

        // If there are no layer names for this file, trim all conditions
        // without layers because we know they have no effect.
        if (entry.layers === null || entry.layers.length === 0) {
          const conds = entry.conditions === null ? [] : entry.conditions;
          let n = conds.length;
          for (let k = conds.length - 1; k >= 0; k--) {
            if (conds[k].layers.length > 0) {
              break;
            }
            n = k;
          }
          if (n !== conds.length) entry.conditions = conds.slice(0, n);
        }

        // Remove unnecessary entries entirely
        if ((entry.conditions === null || entry.conditions.length === 0) && (entry.layers === null || entry.layers.length === 0)) {
          continue;
        }
      }

      // Omit redundant "@layer" rules with the same set of layer names. Note
      // that this tests all import order entries (not just layer ones) because
      // sometimes non-layer ones can make following layer ones redundant.
      let layersKey = entry.layers;
      if (entry.kind === cssImportSourceIndex) {
        layersKey = c.graph.files[entry.sourceIndex].inputFile.repr.ast.layersPostImport;
      }
      let index = 0;
      while (index < layerDuplicates.length) {
        if (stringArrayArraysEqual(layersKey || [], layerDuplicates[index].layers || [])) {
          break;
        }
        index++;
      }
      if (index === layerDuplicates.length) {
        // This is the first time we've seen this combination of layer names.
        // Allocate a new set of duplicate indices to track this combination.
        layerDuplicates.push({ layers: layersKey, indices: [] });
      }
      let duplicates = layerDuplicates[index].indices;
      for (let j = duplicates.length - 1; j >= 0; j--) {
        const index2 = duplicates[j];
        if (isConditionalImportRedundant(entry.conditions, wipOrder[index2].conditions)) {
          if (entry.kind !== cssImportLayers) {
            // If an empty layer is followed immediately by a full layer and
            // everything else is identical, then we don't need to emit the
            // empty layer. But we can only do this if there's nothing in
            // between these two rules.
            if (j === duplicates.length - 1 && index2 === wipOrder.length - 1) {
              const other = wipOrder[index2];
              if (other.kind === cssImportLayers && importConditionsAreEqual(entry.conditions, other.conditions)) {
                // Remove the previous entry and then overwrite it below
                duplicates = duplicates.slice(0, j);
                wipOrder = wipOrder.slice(0, index2);
                break;
              }
            }

            // Non-layer entries still need to be present because they have
            // other side effects beside inserting things in the layer order
            wipOrder.push(entry);
          }

          // Don't add this to the duplicate list below because it's redundant
          continue nextForward;
        }
      }
      layerDuplicates[index].indices = duplicates.concat([wipOrder.length]);
      wipOrder.push(entry);
    }

    order = wipOrder;
    wipOrder = [];
  }

  // Finally, merge adjacent "@layer" rules with identical conditions together.
  {
    let didClone = -1;
    for (const entry of order) {
      if (entry.kind === cssImportLayers && wipOrder.length > 0) {
        const prevIndex = wipOrder.length - 1;
        const prev = wipOrder[prevIndex];
        if (prev.kind === cssImportLayers && importConditionsAreEqual(prev.conditions, entry.conditions)) {
          if (didClone !== prevIndex) {
            didClone = prevIndex;
            prev.layers = prev.layers === null ? [] : prev.layers.slice();
          }
          prev.layers = (prev.layers || []).concat(entry.layers || []);
          continue;
        }
      }
      wipOrder.push(entry);
    }
    order = wipOrder;
  }

  return order;
}

function importConditionsAreEqual(a                           , b                           )          {
  const an = a === null ? 0 : a.length;
  const bn = b === null ? 0 : b.length;
  if (an !== bn) {
    return false;
  }
  for (let i = 0; i < an; i++) {
    const ai = a [i];
    const bi = b [i];
    if (
      !tokensEqualIgnoringWhitespace(ai.layers, bi.layers) ||
      !tokensEqualIgnoringWhitespace(ai.supports, bi.supports) ||
      !mediaQueriesEqualIgnoringWhitespace(ai.queries, bi.queries)
    ) {
      return false;
    }
  }
  return true;
}

// Given two "@import" rules for the same source index (an earlier one and a
// later one), the earlier one is masked by the later one if the later one's
// condition list is a prefix of the earlier one's condition list.
function isConditionalImportRedundant(earlier                           , later                           )          {
  const earlierLen = earlier === null ? 0 : earlier.length;
  const laterLen = later === null ? 0 : later.length;
  if (laterLen > earlierLen) {
    return false;
  }

  for (let i = 0; i < laterLen; i++) {
    const a = earlier [i];
    const b = later [i];

    // Only compare "@supports" and "@media" if "@layers" is equal
    if (tokensEqualIgnoringWhitespace(a.layers, b.layers)) {
      const sameSupports = tokensEqualIgnoringWhitespace(a.supports, b.supports);
      const sameMedia = mediaQueriesEqualIgnoringWhitespace(a.queries, b.queries);

      // If the import conditions are exactly equal, then only keep
      // the later one. The earlier one is redundant.
      if (sameSupports && sameMedia) {
        continue;
      }

      // If the media conditions are exactly equal and the later one
      // doesn't have any supports conditions, then the later one will
      // apply in all cases where the earlier one applies.
      if (sameMedia && b.supports.length === 0) {
        continue;
      }

      // If the supports conditions are exactly equal and the later one
      // doesn't have any media conditions, then the later one will
      // apply in all cases where the earlier one applies.
      if (sameSupports && b.queries.length === 0) {
        continue;
      }
    }

    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// linker.go: mangleLocalCSS

// (usedLocalNames is shared by every Link of one Compile. "stableSourceIndex"
// is used when the graph has no stable source indices: a CSS transform,
// where every reachable CSS file is the stdin file.)
export function mangleLocalCSS(c, usedLocalNames                      , stableSourceIndex        ) {
  // (JS-only: without CSS files there is nothing to rename)
  let hasCSS = false;
  for (const sourceIndex of c.graph.reachableFiles) {
    if (c.graph.files[sourceIndex].inputFile.repr instanceof CSSRepr) {
      hasCSS = true;
      break;
    }
  }
  if (!hasCSS) return;

  const mangledProps = c.mangledProps;
  const globalNames = new Set        ();
  const localNames = new Set        ();

  // Collect all local and global CSS names
  const freq = newCharFreq();
  for (const sourceIndex of c.graph.reachableFiles) {
    const repr = c.graph.files[sourceIndex].inputFile.repr;
    if (repr instanceof CSSRepr) {
      const fileSymbols = c.graph.symbols.symbolsForSource[sourceIndex];
      for (let innerIndex = 0; innerIndex < fileSymbols.length; innerIndex++) {
        const symbol = fileSymbols[innerIndex];
        if (symbol.kind === SymbolGlobalCSS) {
          globalNames.add(symbol.originalName);
        } else {
          let ref = makeRef(sourceIndex, innerIndex);
          ref = followSymbols(c.graph.symbols, ref);
          localNames.add(ref);
        }
      }

      // Include this file's frequency histogram, which affects the mangled names
      if (repr.ast.charFreq !== null) {
        charFreqInclude(freq, repr.ast.charFreq);
      }
    }
  }

  // Sort by use count (note: does not currently account for live vs. dead code)
  const sorted                      = [];
  for (const ref of localNames) {
    const stable = c.graph.stableSourceIndices === null ? stableSourceIndex : c.graph.stableSourceIndices[refSource(ref)];
    sorted.push(new StableSymbolCount(stable, ref, c.graph.symbols.get(ref).useCountEstimate));
  }
  sortStableSymbolCountArray(sorted);

  // (JS-only: without local names nothing below changes anything)
  if (sorted.length === 0) return;

  // Rename all local names to avoid collisions
  if (c.options.minifyIdentifiers) {
    const minifier = DefaultNameMinifierCSS.shuffleByCharFreq(freq);
    let nextName = 0;

    for (const symbolCount of sorted) {
      let name = minifier.numberToMinifiedName(nextName);
      while (globalNames.has(name) || usedLocalNames.has(name)) {
        nextName++;
        name = minifier.numberToMinifiedName(nextName);
      }

      // Turn this local name into a global one
      mangledProps.set(symbolCount.ref, name);
      usedLocalNames.set(name, true);
    }
  } else {
    const nameCounts = new Map                ();

    for (const symbolCount of sorted) {
      const symbol = c.graph.symbols.get(symbolCount.ref);
      let name = c.graph.files[refSource(symbolCount.ref)].inputFile.source.identifierName + "_" + symbol.originalName;

      // If the name is already in use, generate a new name by appending a number
      if (globalNames.has(name) || usedLocalNames.has(name)) {
        // To avoid O(n^2) behavior, the number must start off being the number
        // that we used last time there was a collision with this name.
        let tries = nameCounts.get(name);
        if (tries === undefined) {
          tries = 1;
        }
        const prefix = name;

        // Keep incrementing the number until the name is unused
        for (;;) {
          tries++;
          name = prefix + String(tries);

          // Make sure this new name is unused
          if (!globalNames.has(name) && !usedLocalNames.has(name)) {
            // Store the count so we can start here next time instead of starting
            // from 1. This means we avoid O(n^2) behavior.
            nameCounts.set(prefix, tries);
            break;
          }
        }
      }

      // Turn this local name into a global one
      mangledProps.set(symbolCount.ref, name);
      usedLocalNames.set(name, true);
    }
  }
}

// ---------------------------------------------------------------------------
// linker.go: generateChunkCSS

class compileResultCSS {
  // css_printer.PrintResult (embedded)
  ;                   
  ;                                               
  ;                                     
  ;                           

  // This is the line and column offset since the previous CSS string
  // or the start of the file if this is the first CSS string.
  ;                                         

  // The source index can be invalid for short snippets that aren't necessarily
  // tied to any one file and/or that don't really need source mappings.
  ;                           
  ;                           
  constructor() {
    this.css = "";
    this.extractedLegalComments = null;
    this.jsonMetadataImports = [];
    this.sourceMapChunk = null;
    this.generatedOffset = new LineColumnOffset();
    this.sourceIndex = -1;
    this.hasCharset = false;
  }
}

// linker.go generateChunkCSS: sets chunk.intermediateOutput,
// externalLegalComments, outputSourceMap and jsonMetadataChunkCallback. (A
// transform passes a stand-in chunk: no file system, no metafile.)
export function generateChunkCSS(c, chunk, timer              ) {
  const options = c.options;
  const chunkRepr = chunk.chunkRepr;
  const importsInChunkInOrder                   = chunkRepr.importsInChunkInOrder;
  const compileResults                     = new Array(importsInChunkInOrder.length);
  for (let i = 0; i < compileResults.length; i++) compileResults[i] = new compileResultCSS();
  const dataForSourceMaps = options.sourceMap !== SourceMapNone && c.dataForSourceMaps !== null ? c.dataForSourceMaps() : null;
  const ws = (fmt        ) => metafileFormatMaybeRemoveWhitespace(options.metafileFormat, fmt);

  // Note: This contains placeholders instead of what the placeholders are
  // substituted with. That should be fine though because this should only
  // ever be used for figuring out how many "../" to add to a relative path
  // from a chunk whose final path hasn't been calculated yet to a chunk
  // whose final path has already been calculated. That and placeholders are
  // never substituted with something containing a "/" so substitution should
  // never change the "../" count.
  const chunkAbsDir = c.fs === null ? "" : c.fs.dir(c.fs.join(options.absOutputDir, templateToString(chunk.finalTemplate)));

  // Remove duplicate rules across files. This must be done in serial, not
  // in parallel, and must be done from the last rule to the first rule.
  timer?.begin("Prepare CSS ASTs");
  const asts        = new Array(importsInChunkInOrder.length);
  let remover      = null;
  if (options.minifySyntax) {
    remover = makeDeadRuleMangler(c.graph.symbols);
  }
  for (let i = importsInChunkInOrder.length - 1; i >= 0; i--) {
    const entry = importsInChunkInOrder[i].clone();
    switch (entry.kind) {
      case cssImportLayers: {
        let rules                = null;
        if (entry.layers !== null && entry.layers.length > 0) {
          rules = [new Rule(new RAtLayer(entry.layers, null, 0), 0)];
        }
        const r = wrapRulesWithConditions(rules, null, entry.conditions, entry.conditionImportRecords);
        const ast = new AST();
        ast.rules = r[0] || [];
        ast.importRecords = r[1] || [];
        asts[i] = ast;
        break;
      }

      case cssImportExternalPath: {
        let conditions                          = null;
        const entryConditions = entry.conditions === null ? [] : entry.conditions;
        const conditionImportRecords = entry.conditionImportRecords === null ? [] : entry.conditionImportRecords;
        if (entryConditions.length > 0) {
          conditions = entryConditions[0];

          // Handling a chain of nested conditions is complicated. We can't
          // necessarily join them together because a) there may be multiple
          // layer names and b) layer names are only supposed to be inserted
          // into the layer order if the parent conditions are applied.
          //
          // Instead we handle them by preserving the "@import" nesting using
          // imports of data URL stylesheets. This may seem strange but I think
          // this is the only way to do this in CSS.
          for (let k = entryConditions.length - 1; k > 0; k--) {
            const astImport = new AST();
            astImport.rules = [new Rule(new RAtImport(entryConditions[k], conditionImportRecords.length), 0)];
            astImport.importRecords = conditionImportRecords.concat([importRecordAt(entry.externalPath)]);
            const printerOptions = new CSSPrinterOptions();
            printerOptions.minifyWhitespace = options.minifyWhitespace;
            printerOptions.asciiOnly = options.asciiOnly;
            const astResult = printCSS(astImport, c.graph.symbols, printerOptions);
            entry.externalPath = new Path(encodeStringAsShortestDataURL("text/css", trimSpaceASCII(astResult.css)));
          }
        }
        const ast = new AST();
        ast.importRecords = conditionImportRecords.concat([importRecordAt(entry.externalPath)]);
        ast.rules = [new Rule(new RAtImport(conditions, conditionImportRecords.length), 0)];
        asts[i] = ast;
        break;
      }

      case cssImportSourceIndex: {
        const file = c.graph.files[entry.sourceIndex];
        const fileAST = file.inputFile.repr.ast;
        // (Go copies the AST struct)
        const ast = new AST(
          fileAST.symbols,
          fileAST.charFreq,
          fileAST.importRecords,
          fileAST.rules,
          fileAST.sourceMapComment,
          fileAST.approximateLineCount,
          fileAST.localSymbols,
          fileAST.localScope,
          fileAST.globalScope,
          fileAST.composes,
          fileAST.layersPreImport,
          fileAST.layersPostImport,
        );

        // Filter out "@charset", "@import", and leading "@layer" rules
        let rules         = [];
        let didFindAtImport = false;
        let didFindAtLayer = false;
        for (const rule of ast.rules) {
          const data = rule.data;
          if (data instanceof RAtCharset) {
            compileResults[i].hasCharset = true;
            continue;
          } else if (data instanceof RAtLayer) {
            didFindAtLayer = true;
          } else if (data instanceof RAtImport) {
            if (!didFindAtImport) {
              didFindAtImport = true;
              if (didFindAtLayer) {
                // Filter out the pre-import layers once we see the first
                // "@import". These layers are special-cased by the linker
                // and already appear as a separate entry in import order.
                const kept         = [];
                for (const rule2 of rules) {
                  if (!(rule2.data instanceof RAtLayer)) {
                    kept.push(rule2);
                  }
                }
                rules = kept;
              }
            }
            continue;
          }
          rules.push(rule);
        }

        // (Go appends to the AST copy's import records; copy them so that
        // the file's own array is never extended)
        const r = wrapRulesWithConditions(rules, entry.conditions === null || entry.conditions.length === 0 ? ast.importRecords : ast.importRecords.slice(), entry.conditions, entry.conditionImportRecords);
        rules = r[0] || [];
        ast.importRecords = r[1] || [];

        // Remove top-level duplicate rules across files
        if (options.minifySyntax) {
          rules = remover.removeDeadRulesInPlace(entry.sourceIndex, rules, ast.importRecords);
        }

        ast.rules = rules;
        asts[i] = ast;
        break;
      }
    }
  }
  timer?.end("Prepare CSS ASTs");

  // Generate CSS for each file
  timer?.begin("Print CSS files");
  for (let i = 0; i < importsInChunkInOrder.length; i++) {
    const entry = importsInChunkInOrder[i];
    const compileResult = compileResults[i];
    const cssOptions = new CSSPrinterOptions();
    cssOptions.minifyWhitespace = options.minifyWhitespace;
    cssOptions.lineLimit = options.lineLimit;
    cssOptions.asciiOnly = options.asciiOnly;
    cssOptions.legalComments = options.legalComments;
    cssOptions.sourceMap = options.sourceMap;
    cssOptions.unsupportedFeatures = options.unsupportedCSSFeatures;
    cssOptions.needsMetafile = options.needsMetafile;
    cssOptions.metafileFormat = options.metafileFormat;
    cssOptions.localNames = c.mangledProps;

    // (Go: "defer c.recoverInternalError(...)" for the files)
    try {
    if (entry.kind === cssImportSourceIndex) {
      const file = c.graph.files[entry.sourceIndex];

      // Only generate a source map if needed
      if (loaderCanHaveSourceMap(file.inputFile.loader) && options.sourceMap !== SourceMapNone) {
        cssOptions.addSourceMappings = true;
        cssOptions.inputSourceMap = file.inputFile.inputSourceMap;
        cssOptions.lineOffsetTables = dataForSourceMaps[entry.sourceIndex].lineOffsetTables;
      }

      cssOptions.inputSourceIndex = entry.sourceIndex;
      compileResult.sourceIndex = entry.sourceIndex;
    }

    let printResult;
    // (JS-only: nested too deeply for the call stack: printed again in deep
    // mode, see deep.mts)
    if (canRetryDeep()) {
      try {
        printResult = printCSS(asts[i], c.graph.symbols, cssOptions);
      } catch (e) {
        if (!isStackOverflow(e)) throw e;
        printResult = runDeep(() => printCSS(asts[i], c.graph.symbols, cssOptions));
      }
    } else {
      printResult = printCSS(asts[i], c.graph.symbols, cssOptions);
    }
    compileResult.css = printResult.css;
    compileResult.extractedLegalComments = printResult.extractedLegalComments || null;
    compileResult.jsonMetadataImports = printResult.jsonMetadataImports;
    compileResult.sourceMapChunk = printResult.sourceMapChunk || null;
    } catch (e) {
      if (entry.kind !== cssImportSourceIndex) throw e;
      recoverLinkerPanic(e, c.log, entry.sourceIndex === 0 ? null : c.graph.files[entry.sourceIndex].inputFile.source.prettyPaths.select(options.logPathStyle));
    }
  }

  timer?.end("Print CSS files");
  timer?.begin("Join CSS files");
  const j = new Joiner();
  let prevOffset = new LineColumnOffset();
  let newlineBeforeComment = false;

  if (options.cssBanner.length > 0) {
    prevOffset.advanceString(options.cssBanner);
    j.addString(options.cssBanner);
    prevOffset.advanceString("\n");
    j.addString("\n");
  }

  // Generate any prefix rules now
  let jsonMetadataImports           = [];
  {
    const tree = new AST();

    // "@charset" is the only thing that comes before "@import"
    for (const compileResult of compileResults) {
      if (compileResult.hasCharset) {
        tree.rules.push(new Rule(new RAtCharset("UTF-8"), 0));
        break;
      }
    }

    if (tree.rules.length > 0) {
      const printerOptions = new CSSPrinterOptions();
      printerOptions.minifyWhitespace = options.minifyWhitespace;
      printerOptions.lineLimit = options.lineLimit;
      printerOptions.asciiOnly = options.asciiOnly;
      printerOptions.needsMetafile = options.needsMetafile;
      printerOptions.metafileFormat = options.metafileFormat;
      const result = printCSS(tree, c.graph.symbols, printerOptions);
      jsonMetadataImports = result.jsonMetadataImports;
      if (result.css.length > 0) {
        prevOffset.advanceBytes(result.css);
        j.addBytes(result.css);
        newlineBeforeComment = true;
      }
    }
  }

  // Start the metadata
  const jMeta = new Joiner();
  if (options.needsMetafile) {
    let isFirstMeta = true;
    jMeta.addString(ws('{\n      "imports": ['));
    for (const json of jsonMetadataImports) {
      if (isFirstMeta) {
        isFirstMeta = false;
      } else {
        jMeta.addString(",");
      }
      jMeta.addString(json);
    }
    for (const compileResult of compileResults) {
      for (const json of compileResult.jsonMetadataImports) {
        if (isFirstMeta) {
          isFirstMeta = false;
        } else {
          jMeta.addString(",");
        }
        jMeta.addString(json);
      }
    }
    if (!isFirstMeta) {
      jMeta.addString(ws("\n      "));
    }
    if (chunk.isEntryPoint) {
      const file = c.graph.files[chunk.sourceIndex];

      // Do not generate "entryPoint" for CSS files that are the result of
      // importing CSS into JavaScript. We want this to be a 1:1 relationship
      // and there is already an output file for the JavaScript entry point.
      if (file.inputFile.repr instanceof CSSRepr) {
        jMeta.addString(ws('],\n      "entryPoint": ') + quoteForJSON(file.inputFile.source.prettyPaths.select(options.metafilePathStyle), options.asciiOnly) + ws(',\n      "inputs": {'));
      } else {
        jMeta.addString(ws('],\n      "inputs": {'));
      }
    } else {
      jMeta.addString(ws('],\n      "inputs": {'));
    }
  }

  // Concatenate the generated CSS chunks together
  const compileResultsForSourceMap                              = [];
  const legalCommentList                      = [];
  for (const compileResult of compileResults) {
    if (compileResult.extractedLegalComments !== null && compileResult.extractedLegalComments.length > 0 && compileResult.sourceIndex >= 0) {
      legalCommentList.push(new legalCommentEntry(compileResult.sourceIndex, compileResult.extractedLegalComments));
    }

    if (options.mode === ModeBundle && !options.minifyWhitespace && compileResult.sourceIndex >= 0) {
      let newline = "";
      if (newlineBeforeComment) {
        newline = "\n";
      }
      const comment = newline + "/* " + c.graph.files[compileResult.sourceIndex].inputFile.source.prettyPaths.select(options.codePathStyle) + " */\n";
      prevOffset.advanceString(comment);
      j.addString(comment);
    }
    if (compileResult.css.length > 0) {
      newlineBeforeComment = true;
    }

    // Save the offset to the start of the stored JavaScript
    compileResult.generatedOffset = prevOffset.clone();
    j.addBytes(compileResult.css);

    // Ignore empty source map chunks (a null chunk is Go's zero value)
    if (compileResult.sourceMapChunk !== null && compileResult.sourceMapChunk.shouldIgnore) {
      prevOffset.advanceBytes(compileResult.css);

      // Include a null entry in the source map
      if (compileResult.css.length > 0 && options.sourceMap !== SourceMapNone && compileResult.sourceIndex >= 0) {
        const n = compileResultsForSourceMap.length;
        if (n > 0 && !compileResultsForSourceMap[n - 1].isNullEntry) {
          compileResultsForSourceMap.push(new compileResultForSourceMap(new SourceMapChunk(), new LineColumnOffset(), compileResult.sourceIndex, true));
        }
      }
    } else {
      prevOffset = new LineColumnOffset();

      // Include this file in the source map
      if (options.sourceMap !== SourceMapNone && compileResult.sourceIndex >= 0) {
        compileResultsForSourceMap.push(new compileResultForSourceMap(compileResult.sourceMapChunk, compileResult.generatedOffset, compileResult.sourceIndex, false));
      }
    }
  }

  // Make sure the file ends with a newline
  j.ensureNewlineAtEnd();
  let slashTag = "/style";
  if (cssFeatureHas(options.unsupportedCSSFeatures, InlineStyle)) {
    slashTag = "";
  }
  c.maybeAppendLegalComments(options.legalComments, legalCommentList, chunk, j, slashTag);

  if (options.cssFooter.length > 0) {
    j.addString(options.cssFooter);
    j.addString("\n");
  }

  // The CSS contents are done now that the source map comment is in
  chunk.intermediateOutput = c.breakJoinerIntoPieces(j);
  timer?.end("Join CSS files");

  if (options.sourceMap !== SourceMapNone) {
    timer?.begin("Generate source map");
    const canHaveShifts = chunk.intermediateOutput.pieces !== null;
    chunk.outputSourceMap = c.generateSourceMapForChunk(compileResultsForSourceMap, chunkAbsDir, dataForSourceMaps, canHaveShifts);
    timer?.end("Generate source map");
  }

  // End the metadata lazily. The final output size is not known until the
  // final import paths are substituted into the output pieces generated below.
  if (options.needsMetafile) {
    const pieces = new Array(compileResults.length);
    for (let i = 0; i < compileResults.length; i++) {
      pieces[i] = c.breakOutputIntoPieces(compileResults[i].css);
    }
    chunk.jsonMetadataChunkCallback = (finalOutputSize        ) => {
      const finalRelDir = c.fs.dir(chunk.finalRelPath);
      let isFirst = true;
      for (let i = 0; i < compileResults.length; i++) {
        const compileResult = compileResults[i];
        if (compileResult.sourceIndex < 0) {
          continue;
        }
        if (isFirst) {
          isFirst = false;
        } else {
          jMeta.addString(",");
        }
        jMeta.addString(
          ws("\n        ") +
            quoteForJSON(c.graph.files[compileResult.sourceIndex].inputFile.source.prettyPaths.select(options.metafilePathStyle), options.asciiOnly) +
            ws(': {\n          "bytesInOutput": ') +
            c.accurateFinalByteCount(pieces[i], finalRelDir) +
            ws("\n        }"),
        );
      }
      if (compileResults.length > 0) {
        jMeta.addString(ws("\n      "));
      }
      jMeta.addString(ws('},\n      "bytes": ') + finalOutputSize + ws("\n    }"));
      return jMeta;
    };
  }

  // (the isolated hash is computed when it is needed, see linker.mts)
}

// ast.ImportRecord{Kind: ast.ImportAt, Path: path}
function importRecordAt(path      )               {
  const record = new ImportRecord();
  record.kind = ImportAt;
  record.path = path;
  return record;
}

// bytes.TrimSpace of printed CSS (which never starts or ends with non-ASCII
// whitespace: it starts with "@import" and ends with ";" or a newline)
function trimSpaceASCII(text        )         {
  let start = 0;
  let end = text.length;
  while (start < end && isASCIISpace(text.charCodeAt(start))) start++;
  while (end > start && isASCIISpace(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}
function isASCIISpace(c        )          {
  return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13;
}

function wrapRulesWithConditions(
  rules               ,
  importRecords                       ,
  conditions                           ,
  conditionImportRecords                       ,
)                                         {
  if (conditions === null) return [rules, importRecords];
  for (let i = conditions.length - 1; i >= 0; i--) {
    const item = conditions[i];

    // Generate "@layer" wrappers. Note that empty "@layer" rules still have
    // a side effect (they set the layer order) so they cannot be removed.
    for (const t of item.layers) {
      if (rules === null || rules.length === 0) {
        if (t.children === null) {
          // Omit an empty "@layer {}" entirely
          continue;
        } else {
          // Generate "@layer foo;" instead of "@layer foo {}"
          rules = null;
        }
      }
      let prelude          = [];
      if (t.children !== null) {
        prelude = t.children;
      }
      const r = cloneTokensWithImportRecords(prelude, conditionImportRecords || [], null, importRecords === null ? [] : importRecords);
      prelude = r[0];
      importRecords = r[1];
      rules = [new Rule(new RKnownAt("layer", prelude, rules, 0), 0)];
    }

    // Generate "@supports" wrappers. This is not done if the rule block is
    // empty because empty "@supports" rules have no effect.
    if (rules !== null && rules.length > 0) {
      for (const t0 of item.supports) {
        const t = t0.clone();
        t.kind = TOpenParen;
        t.text = "(";
        const r = cloneTokensWithImportRecords([t], conditionImportRecords || [], null, importRecords === null ? [] : importRecords);
        importRecords = r[1];
        rules = [new Rule(new RKnownAt("supports", r[0], rules, 0), 0)];
      }
    }

    // Generate "@media" wrappers. This is not done if the rule block is
    // empty because empty "@media" rules have no effect.
    if (rules !== null && rules.length > 0 && item.queries.length > 0) {
      const r = cloneMediaQueriesWithImportRecords(item.queries, conditionImportRecords || [], null, importRecords === null ? [] : importRecords);
      importRecords = r[1];
      rules = [new Rule(new RAtMedia(r[0], rules, 0), 0)];
    }
  }

  return [rules, importRecords];
}

// helpers.EncodeStringAsShortestDataURL
function encodeStringAsShortestDataURL(mimeType        , text        )         {
  const url = "data:" + mimeType + ";base64," + base64StdEncodeUTF8(text);
  const percentURL = encodeStringAsPercentEscapedDataURL(mimeType, text);
  if (percentURL !== null && utf8Length(percentURL) < url.length) {
    return percentURL;
  }
  return url;
}

function utf8Length(text        )         {
  let n = text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x80) {
      if (c < 0x800) n += 1;
      else if (c >= 0xd800 && c <= 0xdbff) {
        n += 2;
        i++;
      } else n += 2;
    }
  }
  return n;
}

// helpers.EncodeStringAsPercentEscapedDataURL (the text is valid Unicode;
// every character that may be escaped is ASCII, so UTF-16 indices work)
function encodeStringAsPercentEscapedDataURL(mimeType        , text        )                {
  const hex = "0123456789ABCDEF";
  let sb = "data:" + mimeType + ",";
  const n = text.length;
  let i = 0;
  let runStart = 0;

  // Scan for trailing characters that need to be escaped
  let trailingStart = n;
  while (trailingStart > 0) {
    const c = text.charCodeAt(trailingStart - 1);
    if (c > 0x20 || c === 9 || c === 10 || c === 13) {
      break;
    }
    trailingStart--;
  }

  while (i < n) {
    const c = text.charCodeAt(i);

    // Escape this character if needed
    if (c === 9 || c === 10 || c === 13 || c === 35 || i >= trailingStart || (c === 37 && i + 2 < n && isHex(text.charCodeAt(i + 1)) && isHex(text.charCodeAt(i + 2)))) {
      if (runStart < i) {
        sb += text.slice(runStart, i);
      }
      sb += "%" + hex[c >> 4] + hex[c & 15];
      runStart = i + 1;
    }

    i++;
  }

  if (runStart < n) {
    sb += text.slice(runStart);
  }

  return sb;
}

function isHex(c        )          {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

void escapeClosingTag;
// generated from linker_css.mts by tools/ts-build.mjs; edit that file
