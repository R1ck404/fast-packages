// Port of internal/graph/{graph.go,input.go,meta.go} (the parts the transform
// linker needs). CSS reprs only exist as inert classes; anything CSS-specific
// bails. See CONVENTIONS.md.
//
// JS-only addition: InputFile.astIsShared. Go's CloneLinkerGraph always clones
// what the linker mutates because the input ASTs may be cached and shared
// between builds. In the port only the runtime AST is cached (bundler.mjs), so
// files with astIsShared === false are handed to the linker without a deep
// clone (their AST was produced for this one link and is never read again),
// and shared ASTs are cloned partly copy-on-write (see "Shared (cached) ASTs"
// below).
import { bail } from "./bail.mjs";
import { LineColumnTracker } from "./logger.mjs";
import { InvalidRef, Symbol, newSymbolMap, makeRef, refSource, refInner, followAllSymbols, ImportDynamic } from "./ast.mjs";
import { Part, Scope, AST, SymbolUse, Dependency } from "./js_ast.mjs";
import { registerSharedModuleScopeMembers } from "./renamer.mjs";

const RUNTIME_SOURCE_INDEX = 0; // runtime.SourceIndex

// Frozen so that an accidental push into a "nil slice" stand-in throws
// (typed as a plain array: it stands in for any empty slice)
export const EMPTY_ARRAY = Object.freeze([]) as any[];

// Byte-wise (UTF-8) string comparison like Go's sort.Strings
export function compareStringsUTF8(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) {
      // Surrogates (U+D800-DFFF) encode code points above U+FFFF, which sort
      // after U+E000-U+FFFF in UTF-8 but before them in UTF-16.
      const sa = ca >= 0xd800 && ca <= 0xdfff;
      const sb = cb >= 0xd800 && cb <= 0xdfff;
      if (sa !== sb) {
        if (sa && cb >= 0xe000) return 1;
        if (sb && ca >= 0xe000) return -1;
      }
      return ca < cb ? -1 : 1;
    }
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

// Go sort.Strings. UTF-16 code unit order equals UTF-8 byte order unless a
// surrogate is compared with a code unit in U+E000-U+FFFF, so the native sort
// is used when no string contains a code unit >= U+D800.
export function sortStringsUTF8(strings) {
  for (const s of strings) {
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) >= 0xd800) {
        strings.sort(compareStringsUTF8);
        return;
      }
    }
  }
  strings.sort();
}

// ---------------------------------------------------------------------------
// Shared (cached) ASTs, i.e. the runtime file. Go's CloneLinkerGraph copies
// everything the linker may mutate. Doing that eagerly for the runtime file
// (344 symbols, 65 parts with a SymbolUses map each) dominated the per-call
// cost of a transform, while a transform link only mutates a few of them.
// So for shared ASTs the port copies on write instead:
//
// - part.symbolUses: every write goes through writableSymbolUses()
// - symbols: every write goes through writableSymbol()/writableSymbolChain()
// - resolvedExports: shared when the file has no export stars (only export
//   stars add to it; the linker never writes to it otherwise)
//
// Everything else that the linker mutates (the parts themselves, their
// "dependencies", import records, the module scope's "generated" list) is
// still copied by cloneLinkerGraph.

const sharedSymbolUsesMaps = new WeakSet();

// The sorted keys of the (immutable) "namedExports" map of each shared AST
const sharedSortedExportAliases = new WeakMap();

// namedExports -> { sourceIndex, resolvedExports } for shared ASTs without
// export stars
const sharedResolvedExports = new WeakMap();

// Called once for each AST that is cached and reused across links (before it
// is used). Symbols are copy-on-write too: the linker only writes to a few of
// them (see writableSymbol), so each link starts with a shallow copy of the
// shared symbol array and clones a symbol right before writing to it. The
// shared symbols are frozen so that a write that bypasses writableSymbol()
// throws (and the caller falls back to esbuild) instead of corrupting the
// cache. Their links are path-compressed first (like ast.FollowAllSymbols,
// which does not change what ast.FollowSymbols returns) so that
// ast.followSymbols() never needs to write to a shared symbol later: the
// linker never changes the link of a symbol in a shared AST.
export function markASTShared(ast, sourceIndex) {
  const symbolMap = newSymbolMap(sourceIndex + 1);
  symbolMap.symbolsForSource[sourceIndex] = ast.symbols;
  followAllSymbols(symbolMap);
  for (const symbol of ast.symbols) Object.freeze(symbol);
  registerSharedModuleScopeMembers(ast.moduleScope.members, sourceIndex);

  for (const part of ast.parts) sharedSymbolUsesMaps.add(part.symbolUses);
  if (ast.namedExports !== null) {
    const aliases = [...ast.namedExports.keys()];
    sortStringsUTF8(aliases);
    sharedSortedExportAliases.set(ast.namedExports, Object.freeze(aliases));

    if (ast.exportStarImportRecords.length === 0) {
      sharedResolvedExports.set(ast.namedExports, { sourceIndex, resolvedExports: resolvedExportsFromNamedExports(ast.namedExports, sourceIndex) });
    }
  }
}

function resolvedExportsFromNamedExports(namedExports, sourceIndex) {
  const resolvedExports = new Map();
  for (const [alias, name] of namedExports) {
    resolvedExports.set(alias, new ExportData(EMPTY_ARRAY, name.ref, name.aliasLoc, sourceIndex));
  }
  return resolvedExports;
}

// Returns the keys of "repr.meta.resolvedExports" sorted like Go's
// sort.Strings. The result must not be mutated.
export function sortedResolvedExportAliases(repr) {
  const resolvedExports = repr.meta.resolvedExports;
  const namedExports = repr.ast.namedExports;

  // "resolvedExports" starts out with the keys of "namedExports" and only
  // ever grows, so equal sizes mean equal key sets
  if (namedExports !== null && resolvedExports.size === namedExports.size) {
    const cached = sharedSortedExportAliases.get(namedExports);
    if (cached !== undefined) return cached;
  }

  const aliases = [...resolvedExports.keys()];
  sortStringsUTF8(aliases);
  return aliases;
}

// Returns the symbol for "ref" for writing, first replacing it with a private
// copy if it is still shared with a cached AST
export function writableSymbol(symbols, ref) {
  const array = symbols.symbolsForSource[refSource(ref)];
  const inner = refInner(ref);
  let symbol = array[inner];
  if (Object.isFrozen(symbol)) {
    symbol = symbol.clone();
    array[inner] = symbol;
    if (symbols.sharedWritten === null) symbols.sharedWritten = [];
    symbols.sharedWritten[refSource(ref)] = true;
  }
  return symbol;
}

// Makes every symbol on the link chain starting at "ref" writable (this is
// what ast.MergeSymbols writes to)
export function writableSymbolChain(symbols, ref) {
  for (;;) {
    const symbol = writableSymbol(symbols, ref);
    if (symbol.link === InvalidRef) return;
    ref = symbol.link;
  }
}

// Marks a symbol uses map as shared between links (writableSymbolUses copies
// it before writing to it)
export function markSymbolUsesShared(symbolUses) {
  sharedSymbolUsesMaps.add(symbolUses);
}

// Returns "part.symbolUses", first replacing it with a private copy if it is
// still shared with a cached AST
export function writableSymbolUses(part) {
  let symbolUses = part.symbolUses;
  if (sharedSymbolUsesMaps.has(symbolUses)) {
    symbolUses = new Map(symbolUses);
    part.symbolUses = symbolUses;
  }
  return symbolUses;
}

// Go struct copy of a js_ast.Part for the linker. js_ast.Part.clone() runs
// the Part constructor, which allocates three Maps and four arrays that are
// immediately overwritten; this builds the copy without them.
function clonePartForLinker(part) {
  const p = Object.create(Part.prototype);
  p.stmts = part.stmts;
  p.scopes = part.scopes;
  p.importRecordIndices = part.importRecordIndices;
  p.declaredSymbols = part.declaredSymbols;
  p.symbolUses = part.symbolUses; // copy-on-write, see writableSymbolUses()
  p.symbolCallUses = part.symbolCallUses;
  p.importSymbolPropertyUses = part.importSymbolPropertyUses;
  // The linker appends to "Dependencies" of the copy (Go appends to a nil
  // slice from the parser, which never aliases the cached AST)
  p.dependencies = part.dependencies.length === 0 ? [] : part.dependencies.slice();
  p.canBeRemovedIfUnused = part.canBeRemovedIfUnused;
  p.forceTreeShaking = part.forceTreeShaking;
  p.isLive = part.isLive;
  return p;
}

// ---------------------------------------------------------------------------
// helpers.BitSet (not in helpers.mjs; defined here for graph.mjs/linker.mjs)

export class BitSet {
  declare entries: any;
  constructor(entries) {
    this.entries = entries; // Uint8Array
  }
  hasBit(bit) {
    return (this.entries[bit >>> 3] & (1 << (bit & 7))) !== 0;
  }
  setBit(bit) {
    this.entries[bit >>> 3] |= 1 << (bit & 7);
  }
  equals(other) {
    const a = this.entries;
    const b = other.entries;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  // Go: string(bs.entries). Each byte becomes one char code (0-255) so JS
  // string comparison matches Go's byte-wise string comparison.
  string() {
    let s = "";
    const a = this.entries;
    for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return s;
  }
}

export function newBitSet(bitCount) {
  return new BitSet(new Uint8Array((bitCount + 7) >>> 3));
}

// ---------------------------------------------------------------------------
// input.go

export class InputFile {
  declare repr: any;
  declare inputSourceMap: any;
  declare additionalFiles: any[];
  declare uniqueKeyForAdditionalFile: string;
  declare sideEffects: SideEffects;
  declare source: any;
  declare loader: number;
  declare omitFromSourceMapsAndMetafile: boolean;
  declare astIsShared: boolean;
  constructor(
    repr = null,
    inputSourceMap = null,
    additionalFiles = [],
    uniqueKeyForAdditionalFile = "",
    sideEffects = new SideEffects(),
    source = null,
    loader = 0,
    omitFromSourceMapsAndMetafile = false,
  ) {
    this.repr = repr;
    this.inputSourceMap = inputSourceMap;
    this.additionalFiles = additionalFiles;
    this.uniqueKeyForAdditionalFile = uniqueKeyForAdditionalFile;
    this.sideEffects = sideEffects;
    this.source = source;
    this.loader = loader;
    this.omitFromSourceMapsAndMetafile = omitFromSourceMapsAndMetafile;
    this.astIsShared = false; // JS-only, see the comment at the top
  }
  // Go struct copy
  clone() {
    const f = new InputFile(
      this.repr,
      this.inputSourceMap,
      this.additionalFiles,
      this.uniqueKeyForAdditionalFile,
      this.sideEffects,
      this.source,
      this.loader,
      this.omitFromSourceMapsAndMetafile,
    );
    f.astIsShared = this.astIsShared;
    return f;
  }
}

export class OutputFile {
  declare jsonMetadataChunk: string;
  declare absPath: string;
  declare contents: string;
  declare isExecutable: boolean;
  constructor(jsonMetadataChunk = "", absPath = "", contents = "", isExecutable = false) {
    this.jsonMetadataChunk = jsonMetadataChunk;
    this.absPath = absPath;
    this.contents = contents; // JS string (Go: []byte)
    this.isExecutable = isExecutable;
  }
}

export class SideEffects {
  declare data: any;
  declare kind: number;
  constructor(data = null, kind = HasSideEffects) {
    this.data = data;
    this.kind = kind;
  }
}

// SideEffectsKind
export const HasSideEffects = 0;
export const NoSideEffects_PackageJSON = 1;
export const NoSideEffects_EmptyAST = 2;
export const NoSideEffects_PureData = 3;
export const NoSideEffects_PureData_FromPlugin = 4;

export class JSRepr {
  declare meta: JSReprMeta;
  declare ast: AST;
  declare cssSourceIndex: number;
  constructor(meta = new JSReprMeta(), ast = new AST(), cssSourceIndex = -1) {
    this.meta = meta;
    this.ast = ast;
    this.cssSourceIndex = cssSourceIndex; // Index32
  }
  // Go returns a pointer to the slice; callers that replace the slice write
  // repr.ast.importRecords directly.
  importRecords() {
    return this.ast.importRecords;
  }
  topLevelSymbolToParts(ref) {
    // Overlay the mutable map from the linker
    const overlay = this.meta.topLevelSymbolToPartsOverlay;
    if (overlay !== null) {
      const parts = overlay.get(ref);
      if (parts !== undefined) return parts;
    }

    // Fall back to the immutable map from the parser
    const fromParser = this.ast.topLevelSymbolToPartsFromParser;
    if (fromParser !== null) {
      const parts = fromParser.get(ref);
      if (parts !== undefined) return parts;
    }
    return EMPTY_ARRAY;
  }
}

export class CSSRepr {
  declare ast: any;
  declare jsSourceIndex: number;
  constructor(ast = null, jsSourceIndex = -1) {
    this.ast = ast;
    this.jsSourceIndex = jsSourceIndex;
  }
  importRecords() {
    bail();
  }
}

export class CopyRepr {
  declare urlForCode: string;
  constructor(urlForCode = "") {
    this.urlForCode = urlForCode;
  }
  importRecords() {
    return null;
  }
}

// ---------------------------------------------------------------------------
// meta.go

// WrapKind
export const WrapNone = 0;
export const WrapCJS = 1;
export const WrapESM = 2;

export class JSReprMeta {
  declare isProbablyTypeScriptType: any;
  declare importsToBind: any;
  declare resolvedExports: any;
  declare resolvedExportStar: any;
  declare resolvedExportTypos: any;
  declare sortedAndFilteredExportAliases: any[];
  declare topLevelSymbolToPartsOverlay: any;
  declare cjsExportCopies: any[];
  declare wrapperPartIndex: number;
  declare entryPointPartIndex: number;
  declare isAsyncOrHasAsyncDependency: boolean;
  declare wrap: number;
  declare needsExportsVariable: boolean;
  declare forceIncludeExportsForEntryPoint: boolean;
  declare needsExportSymbolFromRuntime: boolean;
  declare didWrapDependencies: boolean;
  constructor() {
    this.isProbablyTypeScriptType = null; // Map<Ref, boolean>
    this.importsToBind = null; // Map<Ref, ImportData>
    this.resolvedExports = null; // Map<string, ExportData>
    this.resolvedExportStar = null; // ExportData | null
    this.resolvedExportTypos = null;
    this.sortedAndFilteredExportAliases = []; // []string
    this.topLevelSymbolToPartsOverlay = null; // Map<Ref, number[]>
    this.cjsExportCopies = []; // []Ref
    this.wrapperPartIndex = -1; // Index32
    this.entryPointPartIndex = -1; // Index32
    this.isAsyncOrHasAsyncDependency = false;
    this.wrap = WrapNone;
    this.needsExportsVariable = false;
    this.forceIncludeExportsForEntryPoint = false;
    this.needsExportSymbolFromRuntime = false;
    this.didWrapDependencies = false;
  }
  // Go struct copy (maps and slices are shared, like Go)
  clone() {
    const m = new JSReprMeta();
    m.isProbablyTypeScriptType = this.isProbablyTypeScriptType;
    m.importsToBind = this.importsToBind;
    m.resolvedExports = this.resolvedExports;
    m.resolvedExportStar = this.resolvedExportStar;
    m.resolvedExportTypos = this.resolvedExportTypos;
    m.sortedAndFilteredExportAliases = this.sortedAndFilteredExportAliases;
    m.topLevelSymbolToPartsOverlay = this.topLevelSymbolToPartsOverlay;
    m.cjsExportCopies = this.cjsExportCopies;
    m.wrapperPartIndex = this.wrapperPartIndex;
    m.entryPointPartIndex = this.entryPointPartIndex;
    m.isAsyncOrHasAsyncDependency = this.isAsyncOrHasAsyncDependency;
    m.wrap = this.wrap;
    m.needsExportsVariable = this.needsExportsVariable;
    m.forceIncludeExportsForEntryPoint = this.forceIncludeExportsForEntryPoint;
    m.needsExportSymbolFromRuntime = this.needsExportSymbolFromRuntime;
    m.didWrapDependencies = this.didWrapDependencies;
    return m;
  }
}

// Treated as immutable once stored in a map (Go stores these by value)
export class ImportData {
  declare reExports: any[];
  declare nameLoc: number;
  declare ref: number;
  declare sourceIndex: number;
  constructor(reExports = EMPTY_ARRAY, nameLoc = 0, ref = InvalidRef, sourceIndex = 0) {
    this.reExports = reExports; // []Dependency
    this.nameLoc = nameLoc;
    this.ref = ref;
    this.sourceIndex = sourceIndex;
  }
}

// Treated as immutable once stored in a map (Go stores these by value)
export class ExportData {
  declare potentiallyAmbiguousExportStarRefs: any[];
  declare ref: number;
  declare nameLoc: number;
  declare sourceIndex: number;
  constructor(potentiallyAmbiguousExportStarRefs = EMPTY_ARRAY, ref = InvalidRef, nameLoc = 0, sourceIndex = 0) {
    this.potentiallyAmbiguousExportStarRefs = potentiallyAmbiguousExportStarRefs; // []ImportData
    this.ref = ref;
    this.nameLoc = nameLoc;
    this.sourceIndex = sourceIndex;
  }
}

// ---------------------------------------------------------------------------
// graph.go

// entryPointKind
const entryPointNone = 0;
const entryPointUserSpecified = 1;
const entryPointDynamicImport = 2;

export class LinkerFile {
  declare entryBits: any;
  declare lazyLineColumnTracker: any;
  declare inputFile: any;
  declare distanceFromEntryPoint: number;
  declare entryPointChunkIndex: number;
  declare entryPointKind: number;
  declare isLive: boolean;
  constructor() {
    this.entryBits = null; // BitSet
    this.lazyLineColumnTracker = null;
    this.inputFile = null; // InputFile
    this.distanceFromEntryPoint = 0;
    this.entryPointChunkIndex = 0;
    this.entryPointKind = entryPointNone;
    this.isLive = false;
  }
  isEntryPoint() {
    return this.entryPointKind !== entryPointNone;
  }
  isUserSpecifiedEntryPoint() {
    return this.entryPointKind === entryPointUserSpecified;
  }
  lineColumnTracker() {
    if (this.lazyLineColumnTracker === null) {
      this.lazyLineColumnTracker = new LineColumnTracker(this.inputFile.source);
    }
    return this.lazyLineColumnTracker;
  }
}

export class EntryPoint {
  declare outputPath: string;
  declare sourceIndex: number;
  declare outputPathWasAutoGenerated: boolean;
  constructor(outputPath = "", sourceIndex = 0, outputPathWasAutoGenerated = false) {
    this.outputPath = outputPath;
    this.sourceIndex = sourceIndex;
    this.outputPathWasAutoGenerated = outputPathWasAutoGenerated;
  }
  clone() {
    return new EntryPoint(this.outputPath, this.sourceIndex, this.outputPathWasAutoGenerated);
  }
}

// Shallow copy of a js_ast.AST (a Go struct assignment)
export function cloneAST(ast) {
  const a = new AST();
  a.moduleTypeData = ast.moduleTypeData;
  a.parts = ast.parts;
  a.symbols = ast.symbols;
  a.exprComments = ast.exprComments;
  a.moduleScope = ast.moduleScope;
  a.charFreq = ast.charFreq;
  a.manifestForYarnPnP = ast.manifestForYarnPnP;
  a.hashbang = ast.hashbang;
  a.directives = ast.directives;
  a.urlForCSS = ast.urlForCSS;
  a.topLevelSymbolToPartsFromParser = ast.topLevelSymbolToPartsFromParser;
  a.tsEnums = ast.tsEnums;
  a.constValues = ast.constValues;
  a.mangledProps = ast.mangledProps;
  a.reservedProps = ast.reservedProps;
  a.importRecords = ast.importRecords;
  a.namedImports = ast.namedImports;
  a.namedExports = ast.namedExports;
  a.exportStarImportRecords = ast.exportStarImportRecords;
  a.sourceMapComment = ast.sourceMapComment;
  a.exportKeyword = ast.exportKeyword;
  a.topLevelAwaitKeyword = ast.topLevelAwaitKeyword;
  a.liveTopLevelAwaitKeyword = ast.liveTopLevelAwaitKeyword;
  a.exportsRef = ast.exportsRef;
  a.moduleRef = ast.moduleRef;
  a.wrapperRef = ast.wrapperRef;
  a.approximateLineCount = ast.approximateLineCount;
  a.nestedScopeSlotCounts = ast.nestedScopeSlotCounts;
  a.hasLazyExport = ast.hasLazyExport;
  a.usesExportsRef = ast.usesExportsRef;
  a.usesModuleRef = ast.usesModuleRef;
  a.exportsKind = ast.exportsKind;
  return a;
}

// Shallow copy of a js_ast.Scope (a Go struct assignment)
function cloneScope(s) {
  return new Scope(
    s.tsNamespace,
    s.parent,
    s.children,
    s.members,
    s.replaced,
    s.generated,
    s.useStrictLoc,
    s.label,
    s.labelStmtIsLoop,
    s.containsDirectEval,
    s.forbidArguments,
    s.isAfterConstLocalPrefix,
    s.strictMode,
    s.kind,
  );
}

export class LinkerGraph {
  declare files: any;
  declare _entryPoints: any;
  declare symbols: any;
  declare tsEnums: any;
  declare constValues: any;
  declare reachableFiles: any;
  declare stableSourceIndices: any;
  constructor(files, entryPoints, symbols, tsEnums, constValues, reachableFiles, stableSourceIndices) {
    this.files = files; // []LinkerFile
    this._entryPoints = entryPoints; // Go: unexported field "entryPoints" (renamed: the method has the same name)
    this.symbols = symbols; // ast.SymbolMap
    this.tsEnums = tsEnums; // Map<Ref, Map<string, TSEnumValue>>
    this.constValues = constValues; // Map<Ref, ConstValue>
    this.reachableFiles = reachableFiles; // []number
    this.stableSourceIndices = stableSourceIndices; // []number
  }

  // Prevent packages that depend on us from adding or removing entry points
  entryPoints() {
    return this._entryPoints;
  }

  addPartToFile(sourceIndex, part) {
    // Invariant: this map is never null
    if (part.symbolUses === null) part.symbolUses = new Map();

    const repr = this.files[sourceIndex].inputFile.repr;
    const partIndex = repr.ast.parts.length;
    repr.ast.parts.push(part);

    // Invariant: the parts for all top-level symbols can be found in the file-level map
    for (let $i1 = 0, $a1 = part.declaredSymbols; $i1 < $a1.length; $i1++) {
      const declaredSymbol = $a1[$i1];
      if (declaredSymbol.isTopLevel) {
        // Check for an existing overlay
        let overlay = repr.meta.topLevelSymbolToPartsOverlay;
        let partIndices = overlay === null ? undefined : overlay.get(declaredSymbol.ref);

        // If missing, initialize using the original values from the parser
        if (partIndices === undefined) {
          const fromParser = repr.ast.topLevelSymbolToPartsFromParser;
          const original = fromParser === null ? undefined : fromParser.get(declaredSymbol.ref);
          partIndices = original === undefined ? [] : original.slice();
        }

        // Add this part to the overlay
        partIndices.push(partIndex);
        if (overlay === null) {
          overlay = new Map();
          repr.meta.topLevelSymbolToPartsOverlay = overlay;
        }
        overlay.set(declaredSymbol.ref, partIndices);
      }
    }

    return partIndex;
  }

  generateNewSymbol(sourceIndex, kind, originalName) {
    const sourceSymbols = this.symbols.symbolsForSource[sourceIndex];

    const ref = makeRef(sourceIndex, sourceSymbols.length);

    sourceSymbols.push(new Symbol(null, originalName, InvalidRef, 0, -1, -1, 0, kind));

    this.files[sourceIndex].inputFile.repr.ast.moduleScope.generated.push(ref);
    return ref;
  }

  generateSymbolImportAndUse(sourceIndex, partIndex, ref, useCount, sourceIndexToImportFrom) {
    if (useCount === 0) return;

    const repr = this.files[sourceIndex].inputFile.repr;
    const part = repr.ast.parts[partIndex];

    // Mark this symbol as used by this part
    const symbolUses = writableSymbolUses(part);
    const use = symbolUses.get(ref);
    symbolUses.set(ref, new SymbolUse((use === undefined ? 0 : use.countEstimate) + useCount));

    // Uphold invariants about the CommonJS "exports" and "module" symbols
    if (ref === repr.ast.exportsRef) repr.ast.usesExportsRef = true;
    if (ref === repr.ast.moduleRef) repr.ast.usesModuleRef = true;

    // Track that this specific symbol was imported
    if (sourceIndexToImportFrom !== sourceIndex) {
      repr.meta.importsToBind.set(ref, new ImportData(EMPTY_ARRAY, 0, ref, sourceIndexToImportFrom));
    }

    // Pull in all parts that declare this symbol
    const targetRepr = this.files[sourceIndexToImportFrom].inputFile.repr;
    for (const partIndex of targetRepr.topLevelSymbolToParts(ref)) {
      part.dependencies.push(new Dependency(sourceIndexToImportFrom, partIndex));
    }
  }

  generateRuntimeSymbolImportAndUse(sourceIndex, partIndex, name, useCount) {
    if (useCount === 0) return;

    const runtimeRepr = this.files[RUNTIME_SOURCE_INDEX].inputFile.repr;
    const ref = runtimeRepr.ast.namedExports.get(name).ref;
    this.generateSymbolImportAndUse(sourceIndex, partIndex, ref, useCount, RUNTIME_SOURCE_INDEX);
  }
}

export function cloneLinkerGraph(inputFiles, reachableFiles, originalEntryPoints, codeSplitting) {
  const entryPoints = originalEntryPoints.map((ep) => ep.clone());
  const symbols = newSymbolMap(inputFiles.length);
  const files = new Array(inputFiles.length);
  for (let i = 0; i < files.length; i++) files[i] = new LinkerFile();

  // Mark all entry points so we don't add them again for import() expressions
  for (const entryPoint of entryPoints) {
    files[entryPoint.sourceIndex].entryPointKind = entryPointUserSpecified;
  }

  // Clone various things since we may mutate them later
  const dynamicImportEntryPoints = [];
  const stableSourceIndices = new Array(inputFiles.length).fill(0);
  for (let stableIndex = 0; stableIndex < reachableFiles.length; stableIndex++) {
    const sourceIndex = reachableFiles[stableIndex];

    // Create a way to convert source indices to a stable ordering
    stableSourceIndices[sourceIndex] = stableIndex;

    const file = files[sourceIndex];
    file.inputFile = inputFiles[sourceIndex].clone();

    let repr = file.inputFile.repr;
    if (repr instanceof JSRepr) {
      const shared = file.inputFile.astIsShared;

      // Clone the representation
      {
        const clone = new JSRepr(repr.meta.clone(), cloneAST(repr.ast), repr.cssSourceIndex);
        repr = clone;
        file.inputFile.repr = repr;
      }
      const ast = repr.ast;

      // Clone the symbol map (the shared symbols themselves are frozen and
      // copied on write, see markASTShared)
      if (shared) {
        symbols.symbolsForSource[sourceIndex] = ast.symbols.slice();
      } else {
        symbols.symbolsForSource[sourceIndex] = ast.symbols;
      }
      ast.symbols = null;

      // Clone the parts
      {
        const original = ast.parts;
        const parts = new Array(original.length);
        for (let i = 0; i < original.length; i++) {
          const part = original[i];
          parts[i] = shared ? clonePartForLinker(part) : part;
        }
        ast.parts = parts;
      }

      // Clone the import records
      {
        const original = ast.importRecords;
        if (shared) {
          const records = new Array(original.length);
          for (let i = 0; i < original.length; i++) records[i] = original[i].clone();
          ast.importRecords = records;
        } else {
          ast.importRecords = original.slice();
        }
      }

      // Add dynamic imports as additional entry points if code splitting is active
      if (codeSplitting) {
        for (let $i2 = 0, $a2 = ast.importRecords; $i2 < $a2.length; $i2++) {
          const record = $a2[$i2];
          if (record.sourceIndex >= 0 && record.kind === ImportDynamic) {
            bail(); // (code splitting only)
          }
        }
      }

      // Clone the import map. The linker appends to "localPartsWithUses", so
      // each value gets its own array (Go copies the struct; appends to a nil
      // slice from the parser never alias).
      const namedImports = new Map();
      if (ast.namedImports !== null) {
        for (const [k, v] of ast.namedImports) {
          const clone = v.clone();
          clone.localPartsWithUses = v.localPartsWithUses.slice();
          namedImports.set(k, clone);
        }
      }
      ast.namedImports = namedImports;

      // Clone the export map (shared for shared ASTs without export stars, see
      // the top of this file)
      let resolvedExports = null;
      if (shared && ast.exportStarImportRecords.length === 0 && ast.namedExports !== null) {
        const entry = sharedResolvedExports.get(ast.namedExports);
        if (entry !== undefined && entry.sourceIndex === sourceIndex) resolvedExports = entry.resolvedExports;
      }
      if (resolvedExports === null) {
        resolvedExports = ast.namedExports !== null ? resolvedExportsFromNamedExports(ast.namedExports, sourceIndex) : new Map();
      }

      // Clone the top-level scope so we can generate more variables
      if (shared) {
        const clone = cloneScope(ast.moduleScope);
        clone.generated = ast.moduleScope.generated.slice();
        ast.moduleScope = clone;
      }

      // Also associate some default metadata with the file
      repr.meta.resolvedExports = resolvedExports;
      repr.meta.isProbablyTypeScriptType = new Map();
      repr.meta.importsToBind = new Map();
    } else if (repr instanceof CSSRepr) {
      bail(); // (CSS only)
    }

    // All files start off as far as possible from an entry point
    file.distanceFromEntryPoint = 0xffffffff;
  }

  // Process dynamic entry points after merging control flow again
  const stableEntryPoints = [];
  for (const sourceIndex of dynamicImportEntryPoints) {
    const otherFile = files[sourceIndex];
    if (otherFile.entryPointKind === entryPointNone) {
      stableEntryPoints.push(stableSourceIndices[sourceIndex]);
      otherFile.entryPointKind = entryPointDynamicImport;
    }
  }

  // Make sure to add dynamic entry points in a deterministic order
  stableEntryPoints.sort((a, b) => a - b);
  for (const stableIndex of stableEntryPoints) {
    entryPoints.push(new EntryPoint("", reachableFiles[stableIndex]));
  }

  // Do a final quick pass over all files
  const tsEnums = new Map();
  const constValues = new Map();
  const bitCount = entryPoints.length;
  for (const sourceIndex of reachableFiles) {
    const file = files[sourceIndex];

    // Allocate the entry bit set now that the number of entry points is known
    file.entryBits = newBitSet(bitCount);

    // Merge TypeScript enums together into one big map. (Go leaves the merged
    // map nil when no file has one; an empty Map behaves identically.)
    const repr = file.inputFile.repr;
    if (repr instanceof JSRepr && repr.ast.tsEnums !== null) {
      for (const [ref, enum_] of repr.ast.tsEnums) tsEnums.set(ref, enum_);
    }

    // Also merge const values into one big map as well
    if (repr instanceof JSRepr && repr.ast.constValues !== null) {
      for (const [ref, value] of repr.ast.constValues) constValues.set(ref, value);
    }
  }

  return new LinkerGraph(files, entryPoints, symbols, tsEnums, constValues, reachableFiles, stableSourceIndices);
}

