// Port of internal/ast/ast.go. See CONVENTIONS.md for representations.
import { Path, RANGE_ZERO } from "./logger.mjs";
import { utf16EqualsString } from "./helpers.mjs";

// ImportKind
export const ImportEntryPoint = 0;
export const ImportStmt = 1;
export const ImportRequire = 2;
export const ImportDynamic = 3;
export const ImportRequireResolve = 4;
export const ImportAt = 5;
export const ImportComposesFrom = 6;
export const ImportURL = 7;

export function importKindStringForMetafile(kind) {
  switch (kind) {
    case ImportStmt:
      return "import-statement";
    case ImportRequire:
      return "require-call";
    case ImportDynamic:
      return "dynamic-import";
    case ImportRequireResolve:
      return "require-resolve";
    case ImportAt:
      return "import-rule";
    case ImportComposesFrom:
      return "composes-from";
    case ImportURL:
      return "url-token";
    case ImportEntryPoint:
      return "entry-point";
  }
  throw new globalThis.Error("Internal error");
}
export function importKindIsFromCSS(kind) {
  return kind === ImportAt || kind === ImportComposesFrom || kind === ImportURL;
}
export function importKindMustResolveToCSS(kind) {
  return kind === ImportAt || kind === ImportComposesFrom;
}

// ImportPhase
export const EvaluationPhase = 0;
export const DeferPhase = 1;
export const SourcePhase = 2;

// ImportRecordFlags
export const IsUnused = 1 << 0;
export const ContainsImportStar = 1 << 1;
export const ContainsDefaultAlias = 1 << 2;
export const ContainsESModuleAlias = 1 << 3;
export const CallsRunTimeReExportFn = 1 << 4;
export const WrapWithToESM = 1 << 5;
export const WrapWithToCJS = 1 << 6;
export const CallRuntimeRequire = 1 << 7;
export const HandlesImportErrors = 1 << 8;
export const WasOriginallyBareImport = 1 << 9;
export const IsExternalWithoutSideEffects = 1 << 10;
export const AssertTypeJSON = 1 << 11;
export const ShouldNotBeExternalInMetafile = 1 << 12;
export const WasLoadedWithEmptyLoader = 1 << 13;
export const ContainsUniqueKey = 1 << 14;

export class ImportRecord {
  constructor(
    assertOrWith = null,
    globPattern = null,
    path = new Path(),
    range = RANGE_ZERO,
    errorHandlerLoc = 0,
    sourceIndex = -1, // Index32
    copySourceIndex = -1, // Index32
    flags = 0,
    phase = EvaluationPhase,
    kind = ImportEntryPoint,
  ) {
    this.assertOrWith = assertOrWith;
    this.globPattern = globPattern;
    this.path = path;
    this.range = range;
    this.errorHandlerLoc = errorHandlerLoc;
    this.sourceIndex = sourceIndex;
    this.copySourceIndex = copySourceIndex;
    this.flags = flags;
    this.phase = phase;
    this.kind = kind;
  }
  clone() {
    return new ImportRecord(
      this.assertOrWith,
      this.globPattern,
      this.path,
      this.range,
      this.errorHandlerLoc,
      this.sourceIndex,
      this.copySourceIndex,
      this.flags,
      this.phase,
      this.kind,
    );
  }
}

// AssertOrWithKeyword
export const AssertKeyword = 0;
export const WithKeyword = 1;
export function assertOrWithKeywordString(kw) {
  return kw === AssertKeyword ? "assert" : "with";
}

export class ImportAssertOrWith {
  constructor(
    entries = [],
    keywordLoc = 0,
    innerOpenBraceLoc = 0,
    innerCloseBraceLoc = 0,
    outerOpenBraceLoc = 0,
    outerCloseBraceLoc = 0,
    keyword = AssertKeyword,
  ) {
    this.entries = entries;
    this.keywordLoc = keywordLoc;
    this.innerOpenBraceLoc = innerOpenBraceLoc;
    this.innerCloseBraceLoc = innerCloseBraceLoc;
    this.outerOpenBraceLoc = outerOpenBraceLoc;
    this.outerCloseBraceLoc = outerCloseBraceLoc;
    this.keyword = keyword;
  }
}

export class AssertOrWithEntry {
  constructor(key = "", value = "", keyLoc = 0, valueLoc = 0, preferQuotedKey = false) {
    this.key = key; // []uint16
    this.value = value; // []uint16
    this.keyLoc = keyLoc;
    this.valueLoc = valueLoc;
    this.preferQuotedKey = preferQuotedKey;
  }
}

export function findAssertOrWithEntry(assertions, name) {
  for (const assertion of assertions) {
    if (utf16EqualsString(assertion.key, name)) return assertion;
  }
  return null;
}

// Index32: a number, -1 means invalid.
export function makeIndex32(index) {
  return index;
}

// SymbolKind
export const SymbolUnbound = 0;
export const SymbolHoisted = 1;
export const SymbolHoistedFunction = 2;
export const SymbolCatchIdentifier = 3;
export const SymbolGeneratorOrAsyncFunction = 4;
export const SymbolArguments = 5;
export const SymbolClass = 6;
export const SymbolClassInComputedPropertyKey = 7;
export const SymbolPrivateField = 8;
export const SymbolPrivateMethod = 9;
export const SymbolPrivateGet = 10;
export const SymbolPrivateSet = 11;
export const SymbolPrivateGetSetPair = 12;
export const SymbolPrivateStaticField = 13;
export const SymbolPrivateStaticMethod = 14;
export const SymbolPrivateStaticGet = 15;
export const SymbolPrivateStaticSet = 16;
export const SymbolPrivateStaticGetSetPair = 17;
export const SymbolLabel = 18;
export const SymbolTSEnum = 19;
export const SymbolTSNamespace = 20;
export const SymbolImport = 21;
export const SymbolConst = 22;
export const SymbolInjected = 23;
export const SymbolMangledProp = 24;
export const SymbolGlobalCSS = 25;
export const SymbolLocalCSS = 26;
export const SymbolOther = 27;

export function symbolKindIsPrivate(kind) {
  return kind >= SymbolPrivateField && kind <= SymbolPrivateStaticGetSetPair;
}
export function symbolKindIsHoisted(kind) {
  return kind === SymbolHoisted || kind === SymbolHoistedFunction;
}
export function symbolKindIsHoistedOrFunction(kind) {
  return kind === SymbolHoisted || kind === SymbolHoistedFunction || kind === SymbolGeneratorOrAsyncFunction;
}
export function symbolKindIsFunction(kind) {
  return kind === SymbolHoistedFunction || kind === SymbolGeneratorOrAsyncFunction;
}
export function symbolKindIsUnboundOrInjected(kind) {
  return kind === SymbolUnbound || kind === SymbolInjected;
}

// Ref: (sourceIndex << 24) | innerIndex, InvalidRef = -1
export const InvalidRef = -1;
export const REF_INNER_BITS = 24;
export const REF_INNER_MASK = 0xffffff;
export function makeRef(sourceIndex, innerIndex) {
  if (innerIndex > REF_INNER_MASK) throw new globalThis.Error("fast-esbuild: too many symbols");
  return (sourceIndex << REF_INNER_BITS) | innerIndex;
}
export function refSource(ref) {
  return ref >>> REF_INNER_BITS;
}
export function refInner(ref) {
  return ref & REF_INNER_MASK;
}

export class LocRef {
  constructor(loc = 0, ref = InvalidRef) {
    this.loc = loc;
    this.ref = ref;
  }
}

// ImportItemStatus
export const ImportItemNone = 0;
export const ImportItemGenerated = 1;
export const ImportItemMissing = 2;

// SymbolFlags
export const MustNotBeRenamed = 1 << 0;
export const MustStartWithCapitalLetterForJSX = 1 << 1;
export const DidKeepName = 1 << 2;
export const PrivateSymbolMustBeLowered = 1 << 3;
export const RemoveOverwrittenFunctionDeclaration = 1 << 4;
export const DidWarnAboutCommonJSInESM = 1 << 5;
export const CouldPotentiallyBeMutated = 1 << 6;
export const WasExported = 1 << 7;
export const IsEmptyFunction = 1 << 8;
export const IsIdentityFunction = 1 << 9;
export const CallCanBeUnwrappedIfUnused = 1 << 10;

// SlotNamespace
export const SlotDefault = 0;
export const SlotLabel = 1;
export const SlotPrivateName = 2;
export const SlotMangledProp = 3;
export const SlotMustNotBeRenamed = 4;

export class Symbol {
  constructor(
    namespaceAlias = null,
    originalName = "",
    link = InvalidRef,
    useCountEstimate = 0,
    chunkIndex = -1,
    nestedScopeSlot = -1,
    flags = 0,
    kind = SymbolUnbound,
    importItemStatus = ImportItemNone,
  ) {
    this.namespaceAlias = namespaceAlias;
    this.originalName = originalName;
    this.link = link;
    this.useCountEstimate = useCountEstimate;
    this.chunkIndex = chunkIndex;
    this.nestedScopeSlot = nestedScopeSlot;
    this.flags = flags;
    this.kind = kind;
    this.importItemStatus = importItemStatus;
  }
  clone() {
    return new Symbol(
      this.namespaceAlias,
      this.originalName,
      this.link,
      this.useCountEstimate,
      this.chunkIndex,
      this.nestedScopeSlot,
      this.flags,
      this.kind,
      this.importItemStatus,
    );
  }
  mergeContentsWith(oldSymbol) {
    this.useCountEstimate += oldSymbol.useCountEstimate;
    if ((oldSymbol.flags & MustNotBeRenamed) !== 0 && (this.flags & MustNotBeRenamed) === 0) {
      this.originalName = oldSymbol.originalName;
      this.flags |= MustNotBeRenamed;
    }
    if ((oldSymbol.flags & MustStartWithCapitalLetterForJSX) !== 0) {
      this.flags |= MustStartWithCapitalLetterForJSX;
    }
  }
  slotNamespace() {
    if (this.kind === SymbolUnbound || (this.flags & MustNotBeRenamed) !== 0) return SlotMustNotBeRenamed;
    if (symbolKindIsPrivate(this.kind)) return SlotPrivateName;
    if (this.kind === SymbolLabel) return SlotLabel;
    if (this.kind === SymbolMangledProp) return SlotMangledProp;
    return SlotDefault;
  }
}

// SlotCounts: a 4-element array of numbers
export function newSlotCounts() {
  return [0, 0, 0, 0];
}
export function slotCountsUnionMax(a, b) {
  for (let i = 0; i < 4; i++) if (a[i] < b[i]) a[i] = b[i];
}

export class NamespaceAlias {
  constructor(alias = "", namespaceRef = InvalidRef) {
    this.alias = alias;
    this.namespaceRef = namespaceRef;
  }
}

export class SymbolMap {
  constructor(sourceCount = 0) {
    this.symbolsForSource = new Array(sourceCount).fill(null);
    // JS-only: source index -> true once a shared (frozen) symbol of that
    // source has been copied for writing (see graph.writableSymbol)
    this.sharedWritten = null;
  }
  get(ref) {
    return this.symbolsForSource[ref >>> REF_INNER_BITS][ref & REF_INNER_MASK];
  }
}
export function newSymbolMap(sourceCount) {
  return new SymbolMap(sourceCount);
}

export function followSymbols(symbols, ref) {
  const symbol = symbols.get(ref);
  if (symbol.link === InvalidRef) return ref;
  const link = followSymbols(symbols, symbol.link);
  if (symbol.link !== link) symbol.link = link;
  return link;
}

export function followAllSymbols(symbols) {
  const all = symbols.symbolsForSource;
  for (let sourceIndex = 0; sourceIndex < all.length; sourceIndex++) {
    const inner = all[sourceIndex];
    if (inner === null) continue;
    for (let symbolIndex = 0; symbolIndex < inner.length; symbolIndex++) {
      followSymbols(symbols, makeRef(sourceIndex, symbolIndex));
    }
  }
}

export function mergeSymbols(symbols, old, new_) {
  if (old === new_) return new_;
  const oldSymbol = symbols.get(old);
  if (oldSymbol.link !== InvalidRef) {
    oldSymbol.link = mergeSymbols(symbols, oldSymbol.link, new_);
    return oldSymbol.link;
  }
  const newSymbol = symbols.get(new_);
  if (newSymbol.link !== InvalidRef) {
    newSymbol.link = mergeSymbols(symbols, old, newSymbol.link);
    return newSymbol.link;
  }
  oldSymbol.link = new_;
  newSymbol.mergeContentsWith(oldSymbol);
  return new_;
}

// CharFreq / NameMinifier are minify-only and intentionally not ported.
