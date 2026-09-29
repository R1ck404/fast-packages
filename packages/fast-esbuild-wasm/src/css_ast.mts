// Port of internal/css_ast (css_ast.go and css_decl_table.go). See
// CONVENTIONS.md.
//
// CSS syntax comes in two layers: a minimal syntax that generally accepts
// anything that looks vaguely like CSS, and a large set of built-in rules
// (the things browsers actually interpret). That way CSS parsers can read
// unknown rules and skip over them without having to stop due to errors.
//
// This AST format is mostly just the minimal syntax. It parses unknown rules
// into a tree with enough information that it can write them back out again.
// There are some additional layers of syntax including selectors and @-rules
// which allow for better pretty-printing and minification.
//
// JS port notes:
// - Go value structs (Token, CompoundSelector, NamespacedName, NameToken,
//   NthIndex, SubclassSelector, ...) are mutable classes with clone().
//   Wherever Go copies one by value and then mutates either copy, clone.
// - Rule and MediaQuery ({Data, Loc}) are immutable pairs like js_ast.Expr:
//   never assign to .data/.loc, make a new one.
// - Go interfaces (R, MQ, SS) are classes with the interface's methods;
//   type switches use instanceof.
// - Methods that return (value, bool) return a [value, bool] array.
// - "(check *CrossFileEqualityCheck) RefsAreEquivalent" is called on a nil
//   check in Go: it is the function refsAreEquivalent(check, a, b) here.
import { followSymbols, makeRef, SymbolGlobalCSS, InvalidRef, LocRef } from "./ast.mjs";
import type { ImportRecord, Symbol, SymbolMap } from "./ast.mjs";
import { TURL, TSymbol, TComma, TNumber, TPercentage, TDimension, TDelimAmpersand, TEndOfFile } from "./css_lexer.mjs";
import { hashCombine, hashCombineString as hashCombineStringSlow } from "./helpers.mjs";
import { Range, Span } from "./logger.mjs";
import { strconvParseFloat, goToLower, goEqualFold } from "./gostd.mjs";

// Test hook: check memoized values against fresh computations
const VERIFY_MEMOS = typeof globalThis !== "undefined" && !!(globalThis as any).__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__;

// helpers.HashCombineString with an ASCII fast path (JS-only: the same
// result; the general version measures the UTF-8 length and decodes code
// points, which dominated minification profiles)
function hashCombineString(seed: number, text: string): number {
  const n = text.length;
  for (let i = 0; i < n; i++) {
    if (text.charCodeAt(i) >= 0x80) return hashCombineStringSlow(seed, text);
  }
  seed = (seed ^ ((n + 0x9e3779b9 + (seed << 6) + (seed >>> 2)) >>> 0)) >>> 0;
  for (let i = 0; i < n; i++) {
    seed = (seed ^ ((text.charCodeAt(i) + 0x9e3779b9 + (seed << 6) + (seed >>> 2)) >>> 0)) >>> 0;
  }
  return seed;
}

export class AST {
  declare symbols: Symbol[];
  declare charFreq: Int32Array | null;
  declare importRecords: ImportRecord[];
  declare rules: Rule[];
  declare sourceMapComment: Span;
  declare approximateLineCount: number;
  declare localSymbols: LocRef[];
  declare localScope: Map<string, LocRef>;
  declare globalScope: Map<string, LocRef>;
  declare composes: Map<number, Composes>;

  // These contain all layer names in the file. It can be used to replace the
  // layer-related side effects of importing this file. They are split into two
  // groups (those before and after "@import" rules) so that the linker can put
  // them in the right places.
  declare layersPreImport: string[][] | null;
  declare layersPostImport: string[][] | null;
  constructor(
    symbols: Symbol[] = [],
    charFreq: Int32Array | null = null,
    importRecords: ImportRecord[] = [],
    rules: Rule[] = [],
    sourceMapComment: Span = new Span(),
    approximateLineCount = 0,
    localSymbols: LocRef[] = [],
    localScope: Map<string, LocRef> = new Map(),
    globalScope: Map<string, LocRef> = new Map(),
    composes: Map<number, Composes> = new Map(),
    layersPreImport: string[][] | null = null,
    layersPostImport: string[][] | null = null,
  ) {
    this.symbols = symbols;
    this.charFreq = charFreq;
    this.importRecords = importRecords;
    this.rules = rules;
    this.sourceMapComment = sourceMapComment;
    this.approximateLineCount = approximateLineCount;
    this.localSymbols = localSymbols;
    this.localScope = localScope;
    this.globalScope = globalScope;
    this.composes = composes;
    this.layersPreImport = layersPreImport;
    this.layersPostImport = layersPostImport;
  }
}

export class Composes {
  // Note that each of these can be either local or global. Local examples:
  //
  //   .foo { composes: bar }
  //   .bar { color: red }
  //
  // Global examples:
  //
  //   .foo { composes: bar from global }
  //   .foo :global { composes: bar }
  //   .foo { :global { composes: bar } }
  //   :global .bar { color: red }
  //
  declare names: LocRef[];

  // Each of these is local in another file. For example:
  //
  //   .foo { composes: bar from "bar.css" }
  //   .foo { composes: bar from url(bar.css) }
  //
  declare importedNames: ImportedComposesName[];

  // This tracks what CSS properties each class uses so that we can warn when
  // "composes" is used incorrectly to compose two classes from separate files
  // that declare the same CSS properties.
  declare properties: Map<string, number> | null;
  constructor(names: LocRef[] = [], importedNames: ImportedComposesName[] = [], properties: Map<string, number> | null = null) {
    this.names = names;
    this.importedNames = importedNames;
    this.properties = properties;
  }
}

export class ImportedComposesName {
  declare alias: string;
  declare aliasLoc: number;
  declare importRecordIndex: number;
  constructor(alias = "", aliasLoc = 0, importRecordIndex = 0) {
    this.alias = alias;
    this.aliasLoc = aliasLoc;
    this.importRecordIndex = importRecordIndex;
  }
}

// WhitespaceFlags
export const WhitespaceBefore = 1 << 0;
export const WhitespaceAfter = 1 << 1;

// We create a lot of tokens, so make sure this layout is memory-efficient.
export class Token {
  // Contains the child tokens for component values that are simple blocks.
  // These are either "(", "{", "[", or function tokens. The closing token is
  // implicit and is not stored. (Go: *[]Token; null for nil)
  declare children: Token[] | null;

  // This is the raw contents of the token most of the time. However, it
  // contains the decoded string contents for "TString" tokens.
  declare text: string;

  // The source location at the start of the token
  declare loc: number;

  // URL tokens have an associated import record at the top-level of the AST.
  // This index points to that import record.
  //
  // Symbol tokens have an associated symbol. This index is the "InnerIndex"
  // of the "Ref" for this symbol. The "SourceIndex" for the "Ref" is just
  // the source index of the file for this AST.
  declare payloadIndex: number;

  // The division between the number and the unit for "TDimension" tokens.
  declare unitOffset: number;

  // This will never be "TWhitespace" because whitespace isn't stored as a
  // token directly. Instead it is stored in "HasWhitespaceAfter" on the
  // previous token. (With one exception in verbatim whitespace mode.)
  declare kind: number;

  // These flags indicate the presence of a "TWhitespace" token before or after
  // this token. There should be whitespace printed between two tokens if either
  // token indicates that there should be whitespace. Note that whitespace may
  // be altered by processing in certain situations (e.g. minification).
  declare whitespace: number;

  constructor(children: Token[] | null = null, text = "", loc = 0, payloadIndex = 0, unitOffset = 0, kind = TEndOfFile, whitespace = 0) {
    this.children = children;
    this.text = text;
    this.loc = loc;
    this.payloadIndex = payloadIndex;
    this.unitOffset = unitOffset;
    this.kind = kind;
    this.whitespace = whitespace;
  }

  // A copy (Go: "t2 := t"). The children array is shared, like Go's pointer.
  clone(): Token {
    return new Token(this.children, this.text, this.loc, this.payloadIndex, this.unitOffset, this.kind, this.whitespace);
  }

  equal(b: Token, check: CrossFileEqualityCheck | null): boolean {
    const a = this;
    if (a.kind === b.kind && a.text === b.text && a.whitespace === b.whitespace) {
      // URLs should be compared based on the text of the associated import record
      // (which is what will actually be printed) instead of the original text
      if (a.kind === TURL) {
        if (check === null) {
          // If both tokens are in the same file, just compare the index
          if (a.payloadIndex !== b.payloadIndex) {
            return false;
          }
        } else {
          // If the tokens come from separate files, compare the import records
          // themselves instead of comparing the indices.
          if (check.importRecordsA[a.payloadIndex].path.text !== check.importRecordsB[b.payloadIndex].path.text) {
            return false;
          }
        }
      }

      // Symbols should be compared based on the symbol reference instead of the
      // original text
      if (a.kind === TSymbol) {
        if (check === null) {
          // If both tokens are in the same file, just compare the index
          if (a.payloadIndex !== b.payloadIndex) {
            return false;
          }
        } else {
          // If the tokens come from separate files, compare the symbols themselves
          const refA = makeRef(check.sourceIndexA, a.payloadIndex);
          const refB = makeRef(check.sourceIndexB, b.payloadIndex);
          if (!refsAreEquivalent(check, refA, refB)) {
            return false;
          }
        }
      }

      if (a.children === null && b.children === null) {
        return true;
      }

      if (a.children !== null && b.children !== null && tokensEqual(a.children, b.children, check)) {
        return true;
      }
    }

    return false;
  }

  equalIgnoringWhitespace(b: Token): boolean {
    const a = this;
    if (a.kind === b.kind && a.text === b.text && a.payloadIndex === b.payloadIndex) {
      if (a.children === null && b.children === null) {
        return true;
      }

      if (a.children !== null && b.children !== null && tokensEqualIgnoringWhitespace(a.children, b.children)) {
        return true;
      }
    }

    return false;
  }

  // Returns [value, ok]
  numberOrFractionForPercentage(percentReferenceRange: number, flags: number): [number, boolean] {
    const t = this;
    switch (t.kind) {
      case TNumber: {
        const r = strconvParseFloat(t.text);
        if (r[1]) {
          return [r[0], true];
        }
        break;
      }

      case TPercentage: {
        const r = strconvParseFloat(t.percentageValue());
        if (r[1]) {
          const f = r[0];
          if ((flags & AllowPercentageBelow0) === 0 && f < 0) {
            return [0, true];
          }
          if ((flags & AllowPercentageAbove100) === 0 && f > 100) {
            return [percentReferenceRange, true];
          }
          return [(f / 100) * percentReferenceRange, true];
        }
        break;
      }
    }

    return [0, false];
  }

  // Returns [value, ok]
  clampedFractionForPercentage(): [number, boolean] {
    const t = this;
    if (t.kind === TPercentage) {
      const r = strconvParseFloat(t.percentageValue());
      if (r[1]) {
        const f = r[0];
        if (f < 0) {
          return [0, true];
        }
        if (f > 100) {
          return [1, true];
        }
        return [f / 100, true];
      }
    }

    return [0, false];
  }

  // https://drafts.csswg.org/css-values-3/#lengths
  // For zero lengths the unit identifier is optional
  // (i.e. can be syntactically represented as the <number> 0).
  turnLengthIntoNumberIfZero(): boolean {
    const t = this;
    if (t.kind === TDimension && t.dimensionValue() === "0") {
      t.kind = TNumber;
      t.text = "0";
      return true;
    }
    return false;
  }

  turnLengthOrPercentageIntoNumberIfZero(): boolean {
    const t = this;
    if (t.kind === TPercentage && t.percentageValue() === "0") {
      t.kind = TNumber;
      t.text = "0";
      return true;
    }
    return t.turnLengthIntoNumberIfZero();
  }

  percentageValue(): string {
    return this.text.slice(0, this.text.length - 1);
  }

  dimensionValue(): string {
    return this.text.slice(0, this.unitOffset);
  }

  dimensionUnit(): string {
    return this.text.slice(this.unitOffset);
  }

  dimensionUnitIsSafeLength(): boolean {
    switch (goToLower(this.dimensionUnit())) {
      // These units can be reasonably expected to be supported everywhere.
      // Information used: https://developer.mozilla.org/en-US/docs/Web/CSS/length
      case "cm":
      case "em":
      case "in":
      case "mm":
      case "pc":
      case "pt":
      case "px":
        return true;
    }
    return false;
  }

  isZero(): boolean {
    return this.kind === TNumber && this.text === "0";
  }

  isOne(): boolean {
    return this.kind === TNumber && this.text === "1";
  }

  isAngle(): boolean {
    if (this.kind === TDimension) {
      const unit = goToLower(this.dimensionUnit());
      return unit === "deg" || unit === "grad" || unit === "rad" || unit === "turn";
    }
    return false;
  }
}

// This is necessary when comparing tokens between two different files
export class CrossFileEqualityCheck {
  declare importRecordsA: ImportRecord[];
  declare importRecordsB: ImportRecord[];
  declare symbols: SymbolMap;
  declare sourceIndexA: number;
  declare sourceIndexB: number;
  constructor(importRecordsA: ImportRecord[], importRecordsB: ImportRecord[], symbols: SymbolMap, sourceIndexA: number, sourceIndexB: number) {
    this.importRecordsA = importRecordsA;
    this.importRecordsB = importRecordsB;
    this.symbols = symbols;
    this.sourceIndexA = sourceIndexA;
    this.sourceIndexB = sourceIndexB;
  }
}

// Go: func (check *CrossFileEqualityCheck) RefsAreEquivalent(a ast.Ref, b ast.Ref) bool
// ("check" may be null, like Go's nil receiver)
export function refsAreEquivalent(check: CrossFileEqualityCheck | null, a: number, b: number): boolean {
  if (a === b) {
    return true;
  }
  if (check === null || check.symbols.symbolsForSource === null) {
    return false;
  }
  a = followSymbols(check.symbols, a);
  b = followSymbols(check.symbols, b);
  if (a === b) {
    return true;
  }
  const symbolA = check.symbols.get(a);
  const symbolB = check.symbols.get(b);
  return symbolA.kind === SymbolGlobalCSS && symbolB.kind === SymbolGlobalCSS && symbolA.originalName === symbolB.originalName;
}

export function tokensEqual(a: Token[], b: Token[], check: CrossFileEqualityCheck | null): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!a[i].equal(b[i], check)) {
      return false;
    }
  }
  return true;
}

export function hashTokens(hash: number, tokens: Token[]): number {
  hash = hashCombine(hash, tokens.length);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    hash = hashCombine(hash, t.kind);
    if (t.kind !== TURL) {
      hash = hashCombineString(hash, t.text);
    }
    if (t.children !== null) {
      hash = hashTokens(hash, t.children);
    }
  }

  return hash;
}

export function tokensEqualIgnoringWhitespace(a: Token[], b: Token[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!a[i].equalIgnoringWhitespace(b[i])) {
      return false;
    }
  }
  return true;
}

export function tokensAreCommaSeparated(tokens: Token[]): boolean {
  const n = tokens.length;
  if ((n & 1) !== 0) {
    for (let i = 1; i < n; i += 2) {
      if (tokens[i].kind !== TComma) {
        return false;
      }
    }
    return true;
  }
  return false;
}

// PercentageFlags
export const AllowPercentageBelow0 = 1 << 0;
export const AllowPercentageAbove100 = 1 << 1;
export const AllowAnyPercentage = AllowPercentageBelow0 | AllowPercentageAbove100;

// Go returns nil for a nil input (tokensOut stays nil)
export function cloneTokensWithoutImportRecords(tokensIn: Token[] | null): Token[] | null {
  let tokensOut: Token[] | null = null;
  if (tokensIn === null) return tokensOut;
  for (let i = 0; i < tokensIn.length; i++) {
    const t = tokensIn[i].clone();
    if (t.children !== null) {
      t.children = cloneTokensWithoutImportRecords(t.children) || [];
    }
    if (tokensOut === null) tokensOut = [];
    tokensOut.push(t);
  }
  return tokensOut;
}

// Returns [tokensOut, importRecordsOut]. "importRecordsOut" is appended to
// in place (Go's append may or may not reuse the array; callers only use the
// returned slice).
export function cloneTokensWithImportRecords(
  tokensIn: Token[],
  importRecordsIn: ImportRecord[],
  tokensOut: Token[] | null,
  importRecordsOut: ImportRecord[],
): [Token[], ImportRecord[]] {
  // Preallocate the output array if we can
  if (tokensOut === null) {
    tokensOut = [];
  }

  for (let i = 0; i < tokensIn.length; i++) {
    const t = tokensIn[i].clone();

    // Clear the source mapping if this token is being used in another file
    t.loc = 0;

    // If this is a URL token, also clone the import record
    if (t.kind === TURL) {
      const importRecordIndex = importRecordsOut.length;
      importRecordsOut.push(importRecordsIn[t.payloadIndex]);
      t.payloadIndex = importRecordIndex;
    }

    // Also search for URL tokens in this token's children
    if (t.children !== null) {
      const r = cloneTokensWithImportRecords(t.children, importRecordsIn, null, importRecordsOut);
      importRecordsOut = r[1];
      t.children = r[0];
    }

    tokensOut.push(t);
  }

  return [tokensOut, importRecordsOut];
}

export function cloneMediaQueriesWithImportRecords(
  queriesIn: MediaQuery[],
  importRecordsIn: ImportRecord[],
  queriesOut: MediaQuery[] | null,
  importRecordsOut: ImportRecord[],
): [MediaQuery[], ImportRecord[]] {
  // Preallocate the output array if we can
  if (queriesOut === null) {
    queriesOut = [];
  }

  // Recursively clone each query
  for (let i = 0; i < queriesIn.length; i++) {
    const query = queriesIn[i];
    const r = query.data.cloneWithImportRecords(importRecordsIn, importRecordsOut);
    importRecordsOut = r[1];
    queriesOut.push(new MediaQuery(query.loc, r[0]));
  }

  return [queriesOut, importRecordsOut];
}

// Go: type Rule struct { Data R; Loc logger.Loc } (immutable here)
export class Rule {
  declare data: R;
  declare loc: number;
  constructor(data: R, loc: number) {
    this.data = data;
    this.loc = loc;
  }
}

// Go: type R interface { Equal(rule R, check *CrossFileEqualityCheck) bool; Hash() (uint32, bool) }
export type R = RAtCharset | RAtImport | RAtKeyframes | RKnownAt | RUnknownAt | RSelector | RQualified | RDeclaration | RBadDeclaration | RComment | RAtLayer | RAtMedia | RAtScope;

export function rulesEqual(a: Rule[], b: Rule[], check: CrossFileEqualityCheck | null): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!a[i].data.equal(b[i].data, check)) {
      return false;
    }
  }
  return true;
}

export function hashRules(hash: number, rules: Rule[]): number {
  hash = hashCombine(hash, rules.length);
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i].data.hash();
    if (r[1]) {
      hash = hashCombine(hash, r[0]);
    } else {
      hash = hashCombine(hash, 0);
    }
  }
  return hash;
}

export class RAtCharset {
  declare encoding: string;
  constructor(encoding = "") {
    this.encoding = encoding;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    return rule instanceof RAtCharset && this.encoding === rule.encoding;
  }
  hash(): [number, boolean] {
    let hash = 1;
    hash = hashCombineString(hash, this.encoding);
    return [hash, true];
  }
}

export class ImportConditions {
  // The syntax for "@import" has been extended with optional conditions that
  // behave as if the imported file was wrapped in a "@layer", "@supports",
  // and/or "@media" rule. The possible syntax combinations are as follows:
  //
  //   @import url(...);
  //   @import url(...) layer;
  //   @import url(...) layer(layer-name);
  //   @import url(...) layer(layer-name) supports(supports-condition);
  //   @import url(...) layer(layer-name) supports(supports-condition) list-of-media-queries;
  //   @import url(...) layer(layer-name) list-of-media-queries;
  //   @import url(...) supports(supports-condition);
  //   @import url(...) supports(supports-condition) list-of-media-queries;
  //   @import url(...) list-of-media-queries;
  //
  // From: https://developer.mozilla.org/en-US/docs/Web/CSS/@import#syntax
  declare queries: MediaQuery[];

  // These two fields will only ever have zero or one tokens. However, they are
  // implemented as arrays for convenience because most of esbuild's helper
  // functions that operate on tokens take arrays instead of individual tokens.
  declare layers: Token[];
  declare supports: Token[];
  constructor(queries: MediaQuery[] = [], layers: Token[] = [], supports: Token[] = []) {
    this.queries = queries;
    this.layers = layers;
    this.supports = supports;
  }

  clone(): ImportConditions {
    return new ImportConditions(this.queries, this.layers, this.supports);
  }

  // Returns [ImportConditions, importRecordsOut]
  cloneWithImportRecords(importRecordsIn: ImportRecord[], importRecordsOut: ImportRecord[]): [ImportConditions, ImportRecord[]] {
    const result = new ImportConditions();
    let r = cloneTokensWithImportRecords(this.layers, importRecordsIn, null, importRecordsOut);
    result.layers = r[0];
    importRecordsOut = r[1];
    r = cloneTokensWithImportRecords(this.supports, importRecordsIn, null, importRecordsOut);
    result.supports = r[0];
    importRecordsOut = r[1];
    const q = cloneMediaQueriesWithImportRecords(this.queries, importRecordsIn, null, importRecordsOut);
    result.queries = q[0];
    importRecordsOut = q[1];
    return [result, importRecordsOut];
  }
}

export class RAtImport {
  declare importConditions: ImportConditions | null;
  declare importRecordIndex: number;
  constructor(importConditions: ImportConditions | null = null, importRecordIndex = 0) {
    this.importConditions = importConditions;
    this.importRecordIndex = importRecordIndex;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    return false;
  }
  hash(): [number, boolean] {
    return [0, false];
  }
}

export class RAtKeyframes {
  declare atToken: string;
  declare name: LocRef;
  declare blocks: KeyframeBlock[];
  declare closeBraceLoc: number;
  constructor(atToken = "", name: LocRef = new LocRef(), blocks: KeyframeBlock[] = [], closeBraceLoc = 0) {
    this.atToken = atToken;
    this.name = name;
    this.blocks = blocks;
    this.closeBraceLoc = closeBraceLoc;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    const a = this;
    const b = rule;
    if (b instanceof RAtKeyframes && goEqualFold(a.atToken, b.atToken) && refsAreEquivalent(check, a.name.ref, b.name.ref) && a.blocks.length === b.blocks.length) {
      for (let i = 0; i < a.blocks.length; i++) {
        const ai = a.blocks[i];
        const bi = b.blocks[i];
        if (ai.selectors.length !== bi.selectors.length) {
          return false;
        }
        for (let j = 0; j < ai.selectors.length; j++) {
          if (ai.selectors[j] !== bi.selectors[j]) {
            return false;
          }
        }
        if (!rulesEqual(ai.rules, bi.rules, check)) {
          return false;
        }
      }
      return true;
    }
    return false;
  }
  hash(): [number, boolean] {
    let hash = 2;
    hash = hashCombineString(hash, this.atToken);
    hash = hashCombine(hash, this.blocks.length);
    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i];
      hash = hashCombine(hash, block.selectors.length);
      for (let j = 0; j < block.selectors.length; j++) {
        hash = hashCombineString(hash, block.selectors[j]);
      }
      hash = hashRules(hash, block.rules);
    }
    return [hash, true];
  }
}

export class KeyframeBlock {
  declare selectors: string[];
  declare rules: Rule[];
  declare loc: number;
  declare closeBraceLoc: number;
  constructor(selectors: string[] = [], rules: Rule[] = [], loc = 0, closeBraceLoc = 0) {
    this.selectors = selectors;
    this.rules = rules;
    this.loc = loc;
    this.closeBraceLoc = closeBraceLoc;
  }
}

export class RKnownAt {
  declare atToken: string;
  declare prelude: Token[];
  declare rules: Rule[] | null; // (nil for the statement form "@foo ...;")
  declare closeBraceLoc: number;
  constructor(atToken = "", prelude: Token[] = [], rules: Rule[] | null = null, closeBraceLoc = 0) {
    this.atToken = atToken;
    this.prelude = prelude;
    this.rules = rules;
    this.closeBraceLoc = closeBraceLoc;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    const b = rule;
    return b instanceof RKnownAt && goEqualFold(this.atToken, b.atToken) && tokensEqual(this.prelude, b.prelude, check) && rulesEqual(this.rules || [], b.rules || [], check);
  }
  hash(): [number, boolean] {
    let hash = 3;
    hash = hashCombineString(hash, this.atToken);
    hash = hashTokens(hash, this.prelude);
    hash = hashRules(hash, this.rules || []);
    return [hash, true];
  }
}

export class RUnknownAt {
  declare atToken: string;
  declare prelude: Token[];
  declare block: Token[] | null;
  constructor(atToken = "", prelude: Token[] = [], block: Token[] | null = null) {
    this.atToken = atToken;
    this.prelude = prelude;
    this.block = block;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    const b = rule;
    return b instanceof RUnknownAt && goEqualFold(this.atToken, b.atToken) && tokensEqual(this.prelude, b.prelude, check) && tokensEqual(this.block || [], b.block || [], check);
  }
  hash(): [number, boolean] {
    let hash = 4;
    hash = hashCombineString(hash, this.atToken);
    hash = hashTokens(hash, this.prelude);
    hash = hashTokens(hash, this.block || []);
    return [hash, true];
  }
}

export class RSelector {
  declare selectors: ComplexSelector[];
  declare rules: Rule[];
  declare closeBraceLoc: number;
  constructor(selectors: ComplexSelector[] = [], rules: Rule[] = [], closeBraceLoc = 0) {
    this.selectors = selectors;
    this.rules = rules;
    this.closeBraceLoc = closeBraceLoc;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    const b = rule;
    return b instanceof RSelector && complexSelectorsEqual(this.selectors, b.selectors, check) && rulesEqual(this.rules, b.rules, check);
  }
  hash(): [number, boolean] {
    let hash = 5;
    hash = hashCombine(hash, this.selectors.length);
    hash = hashComplexSelectors(hash, this.selectors);
    hash = hashRules(hash, this.rules);
    return [hash, true];
  }
}

export class RQualified {
  declare prelude: Token[];
  declare rules: Rule[];
  declare closeBraceLoc: number;
  constructor(prelude: Token[] = [], rules: Rule[] = [], closeBraceLoc = 0) {
    this.prelude = prelude;
    this.rules = rules;
    this.closeBraceLoc = closeBraceLoc;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    const b = rule;
    return b instanceof RQualified && tokensEqual(this.prelude, b.prelude, check) && rulesEqual(this.rules, b.rules, check);
  }
  hash(): [number, boolean] {
    let hash = 6;
    hash = hashTokens(hash, this.prelude);
    hash = hashRules(hash, this.rules);
    return [hash, true];
  }
}

export class RDeclaration {
  declare keyText: string;
  declare value: Token[];
  declare keyRange: Range;
  declare key: number; // D: Compare using this instead of "Key" for speed
  declare important: boolean;
  // JS-only: the memoized hash (-1: not computed yet). A declaration is
  // hashed by the dead rule remover of its block and again as part of every
  // enclosing rule; it is never modified after parsing (processDeclarations
  // runs before any hashing, and the rules only ever get cloned), so the
  // value is computed once. (Checked against a fresh hash under the test
  // hook __FAST_ESBUILD_VERIFY_RUNTIME_CACHE__.)
  declare hashMemo: number;
  constructor(keyText = "", value: Token[] = [], keyRange: Range = new Range(0, 0), key = DUnknown, important = false) {
    this.keyText = keyText;
    this.value = value;
    this.keyRange = keyRange;
    this.key = key;
    this.important = important;
    this.hashMemo = -1;
  }
  clone(): RDeclaration {
    return new RDeclaration(this.keyText, this.value, this.keyRange, this.key, this.important);
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    const b = rule;
    return b instanceof RDeclaration && this.keyText === b.keyText && tokensEqual(this.value, b.value, check) && this.important === b.important;
  }
  hash(): [number, boolean] {
    let memo = this.hashMemo;
    if (memo === -1) {
      memo = this.hashMemo = this.computeHash();
    } else if (VERIFY_MEMOS && memo !== this.computeHash()) {
      throw new Error("RDeclaration hash memo is stale");
    }
    return [memo, true];
  }
  computeHash(): number {
    let hash: number;
    if (this.key === DUnknown) {
      if (this.important) {
        hash = 7;
      } else {
        hash = 8;
      }
      hash = hashCombineString(hash, this.keyText);
    } else {
      if (this.important) {
        hash = 9;
      } else {
        hash = 10;
      }
      hash = hashCombine(hash, this.key);
    }
    hash = hashTokens(hash, this.value);
    return hash;
  }
}

export class RBadDeclaration {
  declare tokens: Token[];
  constructor(tokens: Token[] = []) {
    this.tokens = tokens;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    const b = rule;
    return b instanceof RBadDeclaration && tokensEqual(this.tokens, b.tokens, check);
  }
  hash(): [number, boolean] {
    let hash = 7;
    hash = hashTokens(hash, this.tokens);
    return [hash, true];
  }
}

export class RComment {
  declare text: string;
  constructor(text = "") {
    this.text = text;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    const b = rule;
    return b instanceof RComment && this.text === b.text;
  }
  hash(): [number, boolean] {
    let hash = 8;
    hash = hashCombineString(hash, this.text);
    return [hash, true];
  }
}

export class RAtLayer {
  declare names: string[][];
  declare rules: Rule[] | null; // (nil for the statement form "@layer a, b;")
  declare closeBraceLoc: number;
  constructor(names: string[][] = [], rules: Rule[] | null = null, closeBraceLoc = 0) {
    this.names = names;
    this.rules = rules;
    this.closeBraceLoc = closeBraceLoc;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    const a = this;
    const b = rule;
    const aRules = a.rules || [];
    if (b instanceof RAtLayer && a.names.length === b.names.length && aRules.length === (b.rules || []).length) {
      for (let i = 0; i < a.names.length; i++) {
        const ai = a.names[i];
        const bi = b.names[i];
        if (ai.length !== bi.length) {
          return false;
        }
        for (let j = 0; j < ai.length; j++) {
          if (ai[j] !== bi[j]) {
            return false;
          }
        }
      }
      if (!rulesEqual(aRules, b.rules || [], check)) {
        return false;
      }
    }
    // (Go returns false here even when everything matched)
    return false;
  }
  hash(): [number, boolean] {
    let hash = 9;
    hash = hashCombine(hash, this.names.length);
    for (let i = 0; i < this.names.length; i++) {
      const parts = this.names[i];
      hash = hashCombine(hash, parts.length);
      for (let j = 0; j < parts.length; j++) {
        hash = hashCombineString(hash, parts[j]);
      }
    }
    hash = hashRules(hash, this.rules || []);
    return [hash, true];
  }
}

export class RAtMedia {
  declare queries: MediaQuery[];
  declare rules: Rule[];
  declare closeBraceLoc: number;
  constructor(queries: MediaQuery[] = [], rules: Rule[] = [], closeBraceLoc = 0) {
    this.queries = queries;
    this.rules = rules;
    this.closeBraceLoc = closeBraceLoc;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    const b = rule;
    return b instanceof RAtMedia && mediaQueriesEqual(this.queries, b.queries, check) && rulesEqual(this.rules, b.rules, check);
  }
  hash(): [number, boolean] {
    let hash = 10;
    hash = hashMediaQueries(hash, this.queries);
    hash = hashRules(hash, this.rules);
    return [hash, true];
  }
}

// Go: type MediaQuery struct { Loc logger.Loc; Data MQ } (immutable here;
// "data" is null for Go's nil MQ)
export class MediaQuery {
  declare loc: number;
  declare data: MQ;
  constructor(loc: number, data: MQ) {
    this.loc = loc;
    this.data = data;
  }
}

// Go: type MQ interface { Equal; EqualIgnoringWhitespace; Hash; CloneWithImportRecords }
export type MQ = MQType | MQNot | MQBinary | MQArbitraryTokens | MQPlainOrBoolean | MQRange;

export function mediaQueriesEqual(a: MediaQuery[], b: MediaQuery[], check: CrossFileEqualityCheck | null): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!a[i].data.equal(b[i].data, check)) {
      return false;
    }
  }
  return true;
}

export function mediaQueriesEqualIgnoringWhitespace(a: MediaQuery[], b: MediaQuery[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!a[i].data.equalIgnoringWhitespace(b[i].data)) {
      return false;
    }
  }
  return true;
}

export function hashMediaQueries(hash: number, queries: MediaQuery[]): number {
  hash = hashCombine(hash, queries.length);
  for (let i = 0; i < queries.length; i++) {
    hash = hashCombine(hash, queries[i].data.hash());
  }
  return hash;
}

// MQTypeOp
export const MQTypeOpNone = 0;
export const MQTypeOpNot = 1;
export const MQTypeOpOnly = 2;

export class MQType {
  declare op: number;
  declare type: string;
  declare andOrNull: MediaQuery | null; // (Go: a MediaQuery whose Data may be nil)
  constructor(op = MQTypeOpNone, type = "", andOrNull: MediaQuery | null = null) {
    this.op = op;
    this.type = type;
    this.andOrNull = andOrNull;
  }
  equal(query: MQ, check: CrossFileEqualityCheck | null): boolean {
    const q = this;
    const p = query;
    if (p instanceof MQType && q.op === p.op && q.type === p.type) {
      const qd = q.andOrNull === null ? null : q.andOrNull.data;
      const pd = p.andOrNull === null ? null : p.andOrNull.data;
      return (qd === null && pd === null) || (qd !== null && pd !== null && qd.equal(pd, check));
    }
    return false;
  }
  equalIgnoringWhitespace(query: MQ): boolean {
    const q = this;
    const p = query;
    if (p instanceof MQType && q.op === p.op && q.type === p.type) {
      const qd = q.andOrNull === null ? null : q.andOrNull.data;
      const pd = p.andOrNull === null ? null : p.andOrNull.data;
      return (qd === null && pd === null) || (qd !== null && pd !== null && qd.equalIgnoringWhitespace(pd));
    }
    return false;
  }
  hash(): number {
    let hash = 0;
    hash = hashCombine(hash, this.op);
    hash = hashCombineString(hash, this.type);
    if (this.andOrNull !== null && this.andOrNull.data !== null) {
      hash = hashCombine(hash, this.andOrNull.data.hash());
    }
    return hash;
  }
  cloneWithImportRecords(importRecordsIn: ImportRecord[], importRecordsOut: ImportRecord[]): [MQ, ImportRecord[]] {
    let andOrNull: MQ | null = null;
    if (this.andOrNull !== null && this.andOrNull.data !== null) {
      const r = this.andOrNull.data.cloneWithImportRecords(importRecordsIn, importRecordsOut);
      andOrNull = r[0];
      importRecordsOut = r[1];
    }
    return [new MQType(this.op, this.type, andOrNull === null ? null : new MediaQuery(0, andOrNull)), importRecordsOut];
  }
}

export class MQNot {
  declare inner: MediaQuery;
  constructor(inner: MediaQuery) {
    this.inner = inner;
  }
  equal(query: MQ, check: CrossFileEqualityCheck | null): boolean {
    const p = query;
    return p instanceof MQNot && this.inner.data.equal(p.inner.data, check);
  }
  equalIgnoringWhitespace(query: MQ): boolean {
    const p = query;
    return p instanceof MQNot && this.inner.data.equalIgnoringWhitespace(p.inner.data);
  }
  hash(): number {
    let hash = 1;
    hash = hashCombine(hash, this.inner.data.hash());
    return hash;
  }
  cloneWithImportRecords(importRecordsIn: ImportRecord[], importRecordsOut: ImportRecord[]): [MQ, ImportRecord[]] {
    const r = this.inner.data.cloneWithImportRecords(importRecordsIn, importRecordsOut);
    return [new MQNot(new MediaQuery(0, r[0])), r[1]];
  }
}

// MQBinaryOp
export const MQBinaryOpAnd = 0;
export const MQBinaryOpOr = 1;

export class MQBinary {
  declare op: number;
  declare terms: MediaQuery[];
  constructor(op = MQBinaryOpAnd, terms: MediaQuery[] = []) {
    this.op = op;
    this.terms = terms;
  }
  equal(query: MQ, check: CrossFileEqualityCheck | null): boolean {
    const p = query;
    return p instanceof MQBinary && this.op === p.op && mediaQueriesEqual(this.terms, p.terms, check);
  }
  equalIgnoringWhitespace(query: MQ): boolean {
    const p = query;
    return p instanceof MQBinary && this.op === p.op && mediaQueriesEqualIgnoringWhitespace(this.terms, p.terms);
  }
  hash(): number {
    let hash = 2;
    hash = hashCombine(hash, this.op);
    hash = hashMediaQueries(hash, this.terms);
    return hash;
  }
  cloneWithImportRecords(importRecordsIn: ImportRecord[], importRecordsOut: ImportRecord[]): [MQ, ImportRecord[]] {
    const terms: MediaQuery[] = [];
    for (let i = 0; i < this.terms.length; i++) {
      const r = this.terms[i].data.cloneWithImportRecords(importRecordsIn, importRecordsOut);
      importRecordsOut = r[1];
      terms.push(new MediaQuery(0, r[0]));
    }
    return [new MQBinary(this.op, terms), importRecordsOut];
  }
}

export class MQArbitraryTokens {
  declare tokens: Token[];
  constructor(tokens: Token[] = []) {
    this.tokens = tokens;
  }
  equal(query: MQ, check: CrossFileEqualityCheck | null): boolean {
    const p = query;
    return p instanceof MQArbitraryTokens && tokensEqual(this.tokens, p.tokens, check);
  }
  equalIgnoringWhitespace(query: MQ): boolean {
    const p = query;
    return p instanceof MQArbitraryTokens && tokensEqualIgnoringWhitespace(this.tokens, p.tokens);
  }
  hash(): number {
    let hash = 3;
    hash = hashTokens(hash, this.tokens);
    return hash;
  }
  cloneWithImportRecords(importRecordsIn: ImportRecord[], importRecordsOut: ImportRecord[]): [MQ, ImportRecord[]] {
    const r = cloneTokensWithImportRecords(this.tokens, importRecordsIn, null, importRecordsOut);
    return [new MQArbitraryTokens(r[0]), r[1]];
  }
}

export class MQPlainOrBoolean {
  declare name: string;
  declare valueOrNil: Token[] | null;
  constructor(name = "", valueOrNil: Token[] | null = null) {
    this.name = name;
    this.valueOrNil = valueOrNil;
  }
  equal(query: MQ, check: CrossFileEqualityCheck | null): boolean {
    const p = query;
    return p instanceof MQPlainOrBoolean && this.name === p.name && tokensEqual(this.valueOrNil || [], p.valueOrNil || [], check);
  }
  equalIgnoringWhitespace(query: MQ): boolean {
    const p = query;
    return p instanceof MQPlainOrBoolean && this.name === p.name && tokensEqualIgnoringWhitespace(this.valueOrNil || [], p.valueOrNil || []);
  }
  hash(): number {
    let hash = 4;
    hash = hashCombineString(hash, this.name);
    hash = hashTokens(hash, this.valueOrNil || []);
    return hash;
  }
  cloneWithImportRecords(importRecordsIn: ImportRecord[], importRecordsOut: ImportRecord[]): [MQ, ImportRecord[]] {
    let valueOrNil: Token[] | null = null;
    if (this.valueOrNil !== null) {
      const r = cloneTokensWithImportRecords(this.valueOrNil, importRecordsIn, null, importRecordsOut);
      valueOrNil = r[0];
      importRecordsOut = r[1];
    }
    return [new MQPlainOrBoolean(this.name, valueOrNil), importRecordsOut];
  }
}

export class MQRange {
  declare before: Token[];
  declare name: string;
  declare after: Token[];
  declare nameLoc: number;
  declare beforeCmp: number;
  declare afterCmp: number;
  constructor(before: Token[] = [], name = "", after: Token[] = [], nameLoc = 0, beforeCmp = MQCmpNone, afterCmp = MQCmpNone) {
    this.before = before;
    this.name = name;
    this.after = after;
    this.nameLoc = nameLoc;
    this.beforeCmp = beforeCmp;
    this.afterCmp = afterCmp;
  }
  equal(query: MQ, check: CrossFileEqualityCheck | null): boolean {
    const q = this;
    const p = query;
    return (
      p instanceof MQRange &&
      q.beforeCmp === p.beforeCmp &&
      q.afterCmp === p.afterCmp &&
      q.name === p.name &&
      tokensEqual(q.before, p.before, check) &&
      tokensEqual(q.after, p.after, check)
    );
  }
  equalIgnoringWhitespace(query: MQ): boolean {
    const q = this;
    const p = query;
    return (
      p instanceof MQRange &&
      q.beforeCmp === p.beforeCmp &&
      q.afterCmp === p.afterCmp &&
      q.name === p.name &&
      tokensEqualIgnoringWhitespace(q.before, p.before) &&
      tokensEqualIgnoringWhitespace(q.after, p.after)
    );
  }
  hash(): number {
    let hash = 5;
    hash = hashTokens(hash, this.before);
    hash = hashCombine(hash, this.beforeCmp);
    hash = hashCombineString(hash, this.name);
    hash = hashCombine(hash, this.afterCmp);
    hash = hashTokens(hash, this.after);
    return hash;
  }
  cloneWithImportRecords(importRecordsIn: ImportRecord[], importRecordsOut: ImportRecord[]): [MQ, ImportRecord[]] {
    const b = cloneTokensWithImportRecords(this.before, importRecordsIn, null, importRecordsOut);
    const a = cloneTokensWithImportRecords(this.after, importRecordsIn, null, b[1]);
    return [new MQRange(b[0], this.name, a[0], 0, this.beforeCmp, this.afterCmp), a[1]];
  }
}

// MQCmp
export const MQCmpNone = 0;
export const MQCmpEq = 1;
export const MQCmpLt = 2;
export const MQCmpLe = 3;
export const MQCmpGt = 4;
export const MQCmpGe = 5;

// Go: func (cmp MQCmp) String() string
export function mqCmpString(cmp: number): string {
  switch (cmp) {
    case MQCmpLt:
      return "<";
    case MQCmpLe:
      return "<=";
    case MQCmpGt:
      return ">";
    case MQCmpGe:
      return ">=";
  }
  return "=";
}

// Go: func (cmp MQCmp) Dir() int
export function mqCmpDir(cmp: number): number {
  switch (cmp) {
    case MQCmpLt:
    case MQCmpLe:
      return -1;
    case MQCmpGt:
    case MQCmpGe:
      return 1;
  }
  return 0;
}

// Go: func (cmp MQCmp) Flip() MQCmp
export function mqCmpFlip(cmp: number): number {
  switch (cmp) {
    case MQCmpLt:
      return MQCmpGe;
    case MQCmpLe:
      return MQCmpGt;
    case MQCmpGt:
      return MQCmpLe;
    case MQCmpGe:
      return MQCmpLt;
  }
  return cmp;
}

// Go: func (cmp MQCmp) Reverse() MQCmp
export function mqCmpReverse(cmp: number): number {
  switch (cmp) {
    case MQCmpLt:
      return MQCmpGt;
    case MQCmpLe:
      return MQCmpGe;
    case MQCmpGt:
      return MQCmpLt;
    case MQCmpGe:
      return MQCmpLe;
  }
  return cmp;
}

export class RAtScope {
  declare start: ComplexSelector[];
  declare end: ComplexSelector[];
  declare rules: Rule[];
  declare closeBraceLoc: number;
  constructor(start: ComplexSelector[] = [], end: ComplexSelector[] = [], rules: Rule[] = [], closeBraceLoc = 0) {
    this.start = start;
    this.end = end;
    this.rules = rules;
    this.closeBraceLoc = closeBraceLoc;
  }
  equal(rule: R, check: CrossFileEqualityCheck | null): boolean {
    const b = rule;
    return b instanceof RAtScope && complexSelectorsEqual(this.start, b.start, check) && complexSelectorsEqual(this.end, b.end, check) && rulesEqual(this.rules, b.rules, check);
  }
  hash(): [number, boolean] {
    let hash = 11;
    hash = hashComplexSelectors(hash, this.start);
    hash = hashComplexSelectors(hash, this.end);
    hash = hashRules(hash, this.rules);
    return [hash, true];
  }
}

export class ComplexSelector {
  declare selectors: CompoundSelector[];
  constructor(selectors: CompoundSelector[] = []) {
    this.selectors = selectors;
  }

  // Go: func (s ComplexSelector) Clone() ComplexSelector (a deep copy)
  clone(): ComplexSelector {
    const selectors = new Array(this.selectors.length);
    for (let i = 0; i < this.selectors.length; i++) {
      selectors[i] = this.selectors[i].clone();
    }
    return new ComplexSelector(selectors);
  }

  containsNestingCombinator(): boolean {
    for (let i = 0; i < this.selectors.length; i++) {
      const inner = this.selectors[i];
      if (inner.nestingSelectorLocs.length > 0) {
        return true;
      }
      for (let j = 0; j < inner.subclassSelectors.length; j++) {
        const pseudo = inner.subclassSelectors[j].data;
        if (pseudo instanceof SSPseudoClassWithSelectorList) {
          for (let k = 0; k < pseudo.selectors.length; k++) {
            if (pseudo.selectors[k].containsNestingCombinator()) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  isRelative(): boolean {
    // https://www.w3.org/TR/css-nesting-1/#syntax
    // "If a selector in the <relative-selector-list> does not start with a
    // combinator but does contain the nesting selector, it is interpreted
    // as a non-relative selector."
    if (this.selectors[0].combinator.byte === 0 && this.containsNestingCombinator()) {
      return false;
    }
    return true;
  }

  usesPseudoElement(): boolean {
    for (let i = 0; i < this.selectors.length; i++) {
      const sel = this.selectors[i];
      for (let j = 0; j < sel.subclassSelectors.length; j++) {
        const class_ = sel.subclassSelectors[j].data;
        if (class_ instanceof SSPseudoClass) {
          if (class_.isElement) {
            return true;
          }

          // https://www.w3.org/TR/selectors-4/#single-colon-pseudos
          // The four Level 2 pseudo-elements (::before, ::after, ::first-line,
          // and ::first-letter) may, for legacy reasons, be represented using
          // the <pseudo-class-selector> grammar, with only a single ":"
          // character at their start.
          switch (class_.name) {
            case "before":
            case "after":
            case "first-line":
            case "first-letter":
              return true;
          }
        }
      }
    }
    return false;
  }

  equal(b: ComplexSelector, check: CrossFileEqualityCheck | null): boolean {
    const a = this;
    if (a.selectors.length !== b.selectors.length) {
      return false;
    }

    for (let i = 0; i < a.selectors.length; i++) {
      const ai = a.selectors[i];
      const bi = b.selectors[i];
      if (ai.nestingSelectorLocs.length !== bi.nestingSelectorLocs.length || ai.combinator.byte !== bi.combinator.byte) {
        return false;
      }

      const ats = ai.typeSelector;
      const bts = bi.typeSelector;
      if ((ats === null) !== (bts === null)) {
        return false;
      } else if (ats !== null && bts !== null && !ats.equal(bts)) {
        return false;
      }

      if (ai.subclassSelectors.length !== bi.subclassSelectors.length) {
        return false;
      }
      for (let j = 0; j < ai.subclassSelectors.length; j++) {
        if (!ai.subclassSelectors[j].data.equal(bi.subclassSelectors[j].data, check)) {
          return false;
        }
      }
    }

    return true;
  }
}

export function complexSelectorsEqual(a: ComplexSelector[], b: ComplexSelector[], check: CrossFileEqualityCheck | null): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!a[i].equal(b[i], check)) {
      return false;
    }
  }
  return true;
}

export function hashComplexSelectors(hash: number, selectors: ComplexSelector[]): number {
  for (let i = 0; i < selectors.length; i++) {
    const complex = selectors[i];
    hash = hashCombine(hash, complex.selectors.length);
    for (let j = 0; j < complex.selectors.length; j++) {
      const sel = complex.selectors[j];
      if (sel.typeSelector !== null) {
        hash = hashCombineString(hash, sel.typeSelector.name.text);
      } else {
        hash = hashCombine(hash, 0);
      }
      hash = hashCombine(hash, sel.subclassSelectors.length);
      for (let k = 0; k < sel.subclassSelectors.length; k++) {
        hash = hashCombine(hash, sel.subclassSelectors[k].data.hash());
      }
      hash = hashCombine(hash, sel.combinator.byte);
    }
  }
  return hash;
}

// Go: type Combinator struct { Loc logger.Loc; Byte uint8 } (immutable
// here: replace it, don't mutate it)
export class Combinator {
  declare loc: number;
  declare byte: number; // Optional, may be 0 for no combinator
  constructor(loc = 0, byte = 0) {
    this.loc = loc;
    this.byte = byte;
  }
}

export const COMBINATOR_NONE = Object.freeze(new Combinator(0, 0)) as Combinator;

export class CompoundSelector {
  declare typeSelector: NamespacedName | null;
  declare subclassSelectors: SubclassSelector[];
  declare nestingSelectorLocs: number[]; // "&" vs. "&&" is different specificity
  declare combinator: Combinator; // Optional, may be 0

  // If this is true, this is a "&" that was generated by a bare ":local" or ":global"
  declare wasEmptyFromLocalOrGlobal: boolean;

  constructor(
    typeSelector: NamespacedName | null = null,
    subclassSelectors: SubclassSelector[] = [],
    nestingSelectorLocs: number[] = [],
    combinator: Combinator = COMBINATOR_NONE,
    wasEmptyFromLocalOrGlobal = false,
  ) {
    this.typeSelector = typeSelector;
    this.subclassSelectors = subclassSelectors;
    this.nestingSelectorLocs = nestingSelectorLocs;
    this.combinator = combinator;
    this.wasEmptyFromLocalOrGlobal = wasEmptyFromLocalOrGlobal;
  }

  // A shallow copy (Go: "sel2 := sel"): the slices and pointers are shared
  copy(): CompoundSelector {
    return new CompoundSelector(this.typeSelector, this.subclassSelectors, this.nestingSelectorLocs, this.combinator, this.wasEmptyFromLocalOrGlobal);
  }

  isSingleAmpersand(): boolean {
    return this.nestingSelectorLocs.length === 1 && this.combinator.byte === 0 && this.typeSelector === null && this.subclassSelectors.length === 0;
  }

  isInvalidBecauseEmpty(): boolean {
    return this.nestingSelectorLocs.length === 0 && this.typeSelector === null && this.subclassSelectors.length === 0;
  }

  range(): Range {
    let r = new Range(0, 0);
    if (this.combinator.byte !== 0) {
      r = new Range(this.combinator.loc, 1);
    }
    if (this.typeSelector !== null) {
      r = rangeExpandBy(r, this.typeSelector.range());
    }
    for (let i = 0; i < this.nestingSelectorLocs.length; i++) {
      r = rangeExpandBy(r, new Range(this.nestingSelectorLocs[i], 1));
    }
    if (this.subclassSelectors.length > 0) {
      for (let i = 0; i < this.subclassSelectors.length; i++) {
        r = rangeExpandBy(r, this.subclassSelectors[i].range);
      }
    }
    return r;
  }

  // Go: func (sel CompoundSelector) Clone() CompoundSelector
  clone(): CompoundSelector {
    const clone = this.copy();

    if (this.typeSelector !== null) {
      clone.typeSelector = this.typeSelector.clone();
    }

    if (this.subclassSelectors.length > 0) {
      const selectors = new Array(this.subclassSelectors.length);
      for (let i = 0; i < this.subclassSelectors.length; i++) {
        const ss = this.subclassSelectors[i];
        selectors[i] = new SubclassSelector(ss.data.clone(), ss.range);
      }
      clone.subclassSelectors = selectors;
    }

    return clone;
  }
}

// logger.Range.ExpandBy (Go mutates the receiver; returns the new range)
function rangeExpandBy(a: Range, b: Range): Range {
  if (a.len === 0) {
    return b;
  } else {
    const end = a.loc + a.len;
    const n = b.loc + b.len;
    const loc = a.loc < b.loc ? a.loc : b.loc;
    return new Range(loc, (end > n ? end : n) - loc);
  }
}

export class NameToken {
  declare text: string;
  declare range: Range;
  declare kind: number;
  constructor(text = "", range: Range = new Range(0, 0), kind = TEndOfFile) {
    this.text = text;
    this.range = range;
    this.kind = kind;
  }
  clone(): NameToken {
    return new NameToken(this.text, this.range, this.kind);
  }
  equal(b: NameToken): boolean {
    return this.text === b.text && this.kind === b.kind;
  }
}

export class NamespacedName {
  // If present, this is an identifier or "*" and is followed by a "|" character
  declare namespacePrefix: NameToken | null;

  // This is an identifier or "*"
  declare name: NameToken;
  constructor(namespacePrefix: NameToken | null = null, name: NameToken = new NameToken()) {
    this.namespacePrefix = namespacePrefix;
    this.name = name;
  }

  range(): Range {
    if (this.namespacePrefix !== null) {
      const loc = this.namespacePrefix.range.loc;
      return new Range(loc, this.name.range.loc + this.name.range.len - loc);
    }
    return this.name.range;
  }

  // Go: func (n NamespacedName) Clone() NamespacedName
  clone(): NamespacedName {
    return new NamespacedName(this.namespacePrefix !== null ? this.namespacePrefix.clone() : null, this.name.clone());
  }

  equal(b: NamespacedName): boolean {
    const a = this;
    return (
      a.name.equal(b.name) &&
      (a.namespacePrefix === null) === (b.namespacePrefix === null) &&
      // (sic: Go compares a's prefix with b's name)
      (a.namespacePrefix === null || b.namespacePrefix === null || a.namespacePrefix.equal(b.name))
    );
  }
}

// Go: type SubclassSelector struct { Data SS; Range logger.Range }
export class SubclassSelector {
  declare data: SS;
  declare range: Range;
  constructor(data: SS, range: Range) {
    this.data = data;
    this.range = range;
  }
}

// Go: type SS interface { Equal; Hash; Clone }
export type SS = SSHash | SSClass | SSAttribute | SSPseudoClass | SSPseudoClassWithSelectorList;

export class SSHash {
  declare name: LocRef;
  constructor(name: LocRef = new LocRef()) {
    this.name = name;
  }
  equal(ss: SS, check: CrossFileEqualityCheck | null): boolean {
    return ss instanceof SSHash && refsAreEquivalent(check, this.name.ref, ss.name.ref);
  }
  hash(): number {
    const hash = 1;
    return hash;
  }
  clone(): SS {
    return new SSHash(this.name);
  }
}

export class SSClass {
  declare name: LocRef;
  constructor(name: LocRef = new LocRef()) {
    this.name = name;
  }
  equal(ss: SS, check: CrossFileEqualityCheck | null): boolean {
    return ss instanceof SSClass && refsAreEquivalent(check, this.name.ref, ss.name.ref);
  }
  hash(): number {
    const hash = 2;
    return hash;
  }
  clone(): SS {
    return new SSClass(this.name);
  }
}

export class SSAttribute {
  declare matcherOp: string; // Either "" or one of: "=" "~=" "|=" "^=" "$=" "*="
  declare matcherValue: string;
  declare namespacedName: NamespacedName;
  declare matcherModifier: number; // Either 0 or one of: 'i' 'I' 's' 'S'
  constructor(matcherOp = "", matcherValue = "", namespacedName: NamespacedName = new NamespacedName(), matcherModifier = 0) {
    this.matcherOp = matcherOp;
    this.matcherValue = matcherValue;
    this.namespacedName = namespacedName;
    this.matcherModifier = matcherModifier;
  }
  equal(ss: SS, check: CrossFileEqualityCheck | null): boolean {
    const b = ss;
    return (
      b instanceof SSAttribute &&
      this.namespacedName.equal(b.namespacedName) &&
      this.matcherOp === b.matcherOp &&
      this.matcherValue === b.matcherValue &&
      this.matcherModifier === b.matcherModifier
    );
  }
  hash(): number {
    let hash = 3;
    hash = hashCombineString(hash, this.namespacedName.name.text);
    hash = hashCombineString(hash, this.matcherOp);
    hash = hashCombineString(hash, this.matcherValue);
    return hash;
  }
  clone(): SS {
    return new SSAttribute(this.matcherOp, this.matcherValue, this.namespacedName.clone(), this.matcherModifier);
  }
}

export class SSPseudoClass {
  declare name: string;
  declare args: Token[] | null;
  declare isElement: boolean; // If true, this is prefixed by "::" instead of ":"
  constructor(name = "", args: Token[] | null = null, isElement = false) {
    this.name = name;
    this.args = args;
    this.isElement = isElement;
  }
  equal(ss: SS, check: CrossFileEqualityCheck | null): boolean {
    const b = ss;
    return b instanceof SSPseudoClass && this.name === b.name && tokensEqual(this.args || [], b.args || [], check) && this.isElement === b.isElement;
  }
  hash(): number {
    let hash = 4;
    hash = hashCombineString(hash, this.name);
    hash = hashTokens(hash, this.args || []);
    return hash;
  }
  clone(): SS {
    const clone = new SSPseudoClass(this.name, this.args, this.isElement);
    if (this.args !== null) {
      // (sic: Go replaces the original's arguments with the copy, and the
      // clone keeps the original arguments)
      this.args = cloneTokensWithoutImportRecords(this.args);
    }
    return clone;
  }
}

// PseudoClassKind
export const PseudoClassGlobal = 0;
export const PseudoClassHas = 1;
export const PseudoClassIs = 2;
export const PseudoClassLocal = 3;
export const PseudoClassNot = 4;
export const PseudoClassNthChild = 5;
export const PseudoClassNthLastChild = 6;
export const PseudoClassNthLastOfType = 7;
export const PseudoClassNthOfType = 8;
export const PseudoClassWhere = 9;

// Go: func (kind PseudoClassKind) HasNthIndex() bool
export function pseudoClassKindHasNthIndex(kind: number): boolean {
  return kind >= PseudoClassNthChild && kind <= PseudoClassNthOfType;
}

// Go: func (kind PseudoClassKind) String() string
export function pseudoClassKindString(kind: number): string {
  switch (kind) {
    case PseudoClassGlobal:
      return "global";
    case PseudoClassHas:
      return "has";
    case PseudoClassIs:
      return "is";
    case PseudoClassLocal:
      return "local";
    case PseudoClassNot:
      return "not";
    case PseudoClassNthChild:
      return "nth-child";
    case PseudoClassNthLastChild:
      return "nth-last-child";
    case PseudoClassNthLastOfType:
      return "nth-last-of-type";
    case PseudoClassNthOfType:
      return "nth-of-type";
    case PseudoClassWhere:
      return "where";
    default:
      throw new Error("Internal error");
  }
}

// This is the "An+B" syntax
export class NthIndex {
  declare a: string;
  declare b: string; // May be "even" or "odd"
  constructor(a = "", b = "") {
    this.a = a;
    this.b = b;
  }
  clone(): NthIndex {
    return new NthIndex(this.a, this.b);
  }
  equal(other: NthIndex): boolean {
    return this.a === other.a && this.b === other.b;
  }

  minify() {
    const index = this;
    // "even" => "2n"
    if (index.b === "even") {
      index.a = "2";
      index.b = "";
      return;
    }

    // "2n+1" => "odd"
    if (index.a === "2" && index.b === "1") {
      index.a = "";
      index.b = "odd";
      return;
    }

    // "0n+1" => "1"
    if (index.a === "0") {
      index.a = "";
      if (index.b === "") {
        // "0n" => "0"
        index.b = "0";
      }
      return;
    }

    // "1n+0" => "1n"
    if (index.b === "0" && index.a !== "") {
      index.b = "";
    }
  }
}

// See https://drafts.csswg.org/selectors/#grouping
export class SSPseudoClassWithSelectorList {
  declare selectors: ComplexSelector[];
  declare index: NthIndex;
  declare kind: number;
  constructor(selectors: ComplexSelector[] = [], index: NthIndex = new NthIndex(), kind = PseudoClassGlobal) {
    this.selectors = selectors;
    this.index = index;
    this.kind = kind;
  }
  equal(ss: SS, check: CrossFileEqualityCheck | null): boolean {
    const b = ss;
    return b instanceof SSPseudoClassWithSelectorList && this.kind === b.kind && this.index.equal(b.index) && complexSelectorsEqual(this.selectors, b.selectors, check);
  }
  hash(): number {
    let hash = 5;
    hash = hashCombine(hash, this.kind);
    hash = hashCombineString(hash, this.index.a);
    hash = hashCombineString(hash, this.index.b);
    hash = hashComplexSelectors(hash, this.selectors);
    return hash;
  }
  clone(): SS {
    const selectors = new Array(this.selectors.length);
    for (let i = 0; i < this.selectors.length; i++) {
      selectors[i] = this.selectors[i].clone();
    }
    return new SSPseudoClassWithSelectorList(selectors, this.index.clone(), this.kind);
  }
}

// Used by tokensContainAmpersandRecursive's callers in Go (unexported there)
export function tokensContainAmpersandRecursive(tokens: Token[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === TDelimAmpersand) {
      return true;
    }
    if (t.children !== null && tokensContainAmpersandRecursive(t.children)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// css_decl_table.go

// (helpers.TypoDetector, defined here)
export class TypoDetector {
  declare oneCharTypos: Map<string, string>;
  constructor(valid: string[]) {
    this.oneCharTypos = new Map();

    // Add all combinations of each valid word with one character missing
    for (const correct of valid) {
      if (correct.length > 3) {
        for (let i = 0; i < correct.length; i++) {
          this.oneCharTypos.set(correct.slice(0, i) + correct.slice(i + 1), correct);
        }
      }
    }
  }

  // Returns [corrected, ok]
  maybeCorrectTypo(typo: string): [string, boolean] {
    // Check for a single deleted character
    const corrected = this.oneCharTypos.get(typo);
    if (corrected !== undefined) {
      return [corrected, true];
    }

    // Check for a single misplaced character
    for (let i = 0; i < typo.length; i++) {
      const c = typo.codePointAt(i)!;
      const width = c > 0xffff ? 2 : 1;
      const corrected = this.oneCharTypos.get(typo.slice(0, i) + typo.slice(i + width));
      if (corrected !== undefined) {
        return [corrected, true];
      }
      i += width - 1;
    }

    return ["", false];
  }
}

let typoDetector: TypoDetector | null = null;

// JS-only: the answers for recently seen unknown property names (vendor
// prefixed properties repeat a lot); "ok" is a pure function of the name
const typoMemo = new Map<string, [string, boolean]>();

// Returns [corrected, ok]. (Several valid names can share a one-character
// typo; Go keeps whichever its random map order writes last, so only "ok"
// is reliable. It only matters for a warning message.)
export function maybeCorrectDeclarationTypo(text: string): [string, boolean] {
  // Ignore CSS variables, which should not be corrected to CSS properties
  if (text.startsWith("--")) {
    return ["", false];
  }

  // Lazily-initialize the typo detector for speed when it's not needed
  if (typoDetector === null) {
    typoDetector = new TypoDetector([...KnownDeclarations.keys()]);
  }

  // (JS-only: the result is remembered per name)
  const memo = typoMemo.get(text);
  if (memo !== undefined) return memo;
  const r = typoDetector.maybeCorrectTypo(text);
  if (typoMemo.size >= 4096) typoMemo.clear();
  typoMemo.set(text, r);
  return r;
}

// D (known declarations)
export const DUnknown = 0;
export const DAlignContent = 1;
export const DAlignItems = 2;
export const DAlignSelf = 3;
export const DAlignmentBaseline = 4;
export const DAll = 5;
export const DAnimation = 6;
export const DAnimationDelay = 7;
export const DAnimationDirection = 8;
export const DAnimationDuration = 9;
export const DAnimationFillMode = 10;
export const DAnimationIterationCount = 11;
export const DAnimationName = 12;
export const DAnimationPlayState = 13;
export const DAnimationTimingFunction = 14;
export const DAppearance = 15;
export const DBackdropFilter = 16;
export const DBackfaceVisibility = 17;
export const DBackground = 18;
export const DBackgroundAttachment = 19;
export const DBackgroundClip = 20;
export const DBackgroundColor = 21;
export const DBackgroundImage = 22;
export const DBackgroundOrigin = 23;
export const DBackgroundPosition = 24;
export const DBackgroundPositionX = 25;
export const DBackgroundPositionY = 26;
export const DBackgroundRepeat = 27;
export const DBackgroundSize = 28;
export const DBaselineShift = 29;
export const DBlockSize = 30;
export const DBorder = 31;
export const DBorderBlockEnd = 32;
export const DBorderBlockEndColor = 33;
export const DBorderBlockEndStyle = 34;
export const DBorderBlockEndWidth = 35;
export const DBorderBlockStart = 36;
export const DBorderBlockStartColor = 37;
export const DBorderBlockStartStyle = 38;
export const DBorderBlockStartWidth = 39;
export const DBorderBottom = 40;
export const DBorderBottomColor = 41;
export const DBorderBottomLeftRadius = 42;
export const DBorderBottomRightRadius = 43;
export const DBorderBottomStyle = 44;
export const DBorderBottomWidth = 45;
export const DBorderCollapse = 46;
export const DBorderColor = 47;
export const DBorderImage = 48;
export const DBorderImageOutset = 49;
export const DBorderImageRepeat = 50;
export const DBorderImageSlice = 51;
export const DBorderImageSource = 52;
export const DBorderImageWidth = 53;
export const DBorderInlineEnd = 54;
export const DBorderInlineEndColor = 55;
export const DBorderInlineEndStyle = 56;
export const DBorderInlineEndWidth = 57;
export const DBorderInlineStart = 58;
export const DBorderInlineStartColor = 59;
export const DBorderInlineStartStyle = 60;
export const DBorderInlineStartWidth = 61;
export const DBorderLeft = 62;
export const DBorderLeftColor = 63;
export const DBorderLeftStyle = 64;
export const DBorderLeftWidth = 65;
export const DBorderRadius = 66;
export const DBorderRight = 67;
export const DBorderRightColor = 68;
export const DBorderRightStyle = 69;
export const DBorderRightWidth = 70;
export const DBorderSpacing = 71;
export const DBorderStyle = 72;
export const DBorderTop = 73;
export const DBorderTopColor = 74;
export const DBorderTopLeftRadius = 75;
export const DBorderTopRightRadius = 76;
export const DBorderTopStyle = 77;
export const DBorderTopWidth = 78;
export const DBorderWidth = 79;
export const DBottom = 80;
export const DBoxDecorationBreak = 81;
export const DBoxShadow = 82;
export const DBoxSizing = 83;
export const DBreakAfter = 84;
export const DBreakBefore = 85;
export const DBreakInside = 86;
export const DCaptionSide = 87;
export const DCaretColor = 88;
export const DClear = 89;
export const DClip = 90;
export const DClipPath = 91;
export const DClipRule = 92;
export const DColor = 93;
export const DColorInterpolation = 94;
export const DColorInterpolationFilters = 95;
export const DColumnCount = 96;
export const DColumnFill = 97;
export const DColumnGap = 98;
export const DColumnRule = 99;
export const DColumnRuleColor = 100;
export const DColumnRuleStyle = 101;
export const DColumnRuleWidth = 102;
export const DColumnSpan = 103;
export const DColumnWidth = 104;
export const DColumns = 105;
export const DComposes = 106;
export const DContainer = 107;
export const DContainerName = 108;
export const DContainerType = 109;
export const DContent = 110;
export const DCounterIncrement = 111;
export const DCounterReset = 112;
export const DCssFloat = 113;
export const DCssText = 114;
export const DCursor = 115;
export const DDirection = 116;
export const DDisplay = 117;
export const DDominantBaseline = 118;
export const DEmptyCells = 119;
export const DFill = 120;
export const DFillOpacity = 121;
export const DFillRule = 122;
export const DFilter = 123;
export const DFlex = 124;
export const DFlexBasis = 125;
export const DFlexDirection = 126;
export const DFlexFlow = 127;
export const DFlexGrow = 128;
export const DFlexShrink = 129;
export const DFlexWrap = 130;
export const DFloat = 131;
export const DFloodColor = 132;
export const DFloodOpacity = 133;
export const DFont = 134;
export const DFontFamily = 135;
export const DFontFeatureSettings = 136;
export const DFontKerning = 137;
export const DFontSize = 138;
export const DFontSizeAdjust = 139;
export const DFontStretch = 140;
export const DFontStyle = 141;
export const DFontSynthesis = 142;
export const DFontVariant = 143;
export const DFontVariantCaps = 144;
export const DFontVariantEastAsian = 145;
export const DFontVariantLigatures = 146;
export const DFontVariantNumeric = 147;
export const DFontVariantPosition = 148;
export const DFontWeight = 149;
export const DGap = 150;
export const DGlyphOrientationVertical = 151;
export const DGrid = 152;
export const DGridArea = 153;
export const DGridAutoColumns = 154;
export const DGridAutoFlow = 155;
export const DGridAutoRows = 156;
export const DGridColumn = 157;
export const DGridColumnEnd = 158;
export const DGridColumnGap = 159;
export const DGridColumnStart = 160;
export const DGridGap = 161;
export const DGridRow = 162;
export const DGridRowEnd = 163;
export const DGridRowGap = 164;
export const DGridRowStart = 165;
export const DGridTemplate = 166;
export const DGridTemplateAreas = 167;
export const DGridTemplateColumns = 168;
export const DGridTemplateRows = 169;
export const DHeight = 170;
export const DHyphens = 171;
export const DImageOrientation = 172;
export const DImageRendering = 173;
export const DInitialLetter = 174;
export const DInlineSize = 175;
export const DInset = 176;
export const DJustifyContent = 177;
export const DJustifyItems = 178;
export const DJustifySelf = 179;
export const DLeft = 180;
export const DLetterSpacing = 181;
export const DLightingColor = 182;
export const DLineBreak = 183;
export const DLineHeight = 184;
export const DListStyle = 185;
export const DListStyleImage = 186;
export const DListStylePosition = 187;
export const DListStyleType = 188;
export const DMargin = 189;
export const DMarginBlockEnd = 190;
export const DMarginBlockStart = 191;
export const DMarginBottom = 192;
export const DMarginInlineEnd = 193;
export const DMarginInlineStart = 194;
export const DMarginLeft = 195;
export const DMarginRight = 196;
export const DMarginTop = 197;
export const DMarker = 198;
export const DMarkerEnd = 199;
export const DMarkerMid = 200;
export const DMarkerStart = 201;
export const DMask = 202;
export const DMaskComposite = 203;
export const DMaskImage = 204;
export const DMaskOrigin = 205;
export const DMaskPosition = 206;
export const DMaskRepeat = 207;
export const DMaskSize = 208;
export const DMaskType = 209;
export const DMaxBlockSize = 210;
export const DMaxHeight = 211;
export const DMaxInlineSize = 212;
export const DMaxWidth = 213;
export const DMinBlockSize = 214;
export const DMinHeight = 215;
export const DMinInlineSize = 216;
export const DMinWidth = 217;
export const DObjectFit = 218;
export const DObjectPosition = 219;
export const DOpacity = 220;
export const DOrder = 221;
export const DOrphans = 222;
export const DOutline = 223;
export const DOutlineColor = 224;
export const DOutlineOffset = 225;
export const DOutlineStyle = 226;
export const DOutlineWidth = 227;
export const DOverflow = 228;
export const DOverflowAnchor = 229;
export const DOverflowWrap = 230;
export const DOverflowX = 231;
export const DOverflowY = 232;
export const DOverscrollBehavior = 233;
export const DOverscrollBehaviorBlock = 234;
export const DOverscrollBehaviorInline = 235;
export const DOverscrollBehaviorX = 236;
export const DOverscrollBehaviorY = 237;
export const DPadding = 238;
export const DPaddingBlockEnd = 239;
export const DPaddingBlockStart = 240;
export const DPaddingBottom = 241;
export const DPaddingInlineEnd = 242;
export const DPaddingInlineStart = 243;
export const DPaddingLeft = 244;
export const DPaddingRight = 245;
export const DPaddingTop = 246;
export const DPageBreakAfter = 247;
export const DPageBreakBefore = 248;
export const DPageBreakInside = 249;
export const DPaintOrder = 250;
export const DPerspective = 251;
export const DPerspectiveOrigin = 252;
export const DPlaceContent = 253;
export const DPlaceItems = 254;
export const DPlaceSelf = 255;
export const DPointerEvents = 256;
export const DPosition = 257;
export const DPrintColorAdjust = 258;
export const DQuotes = 259;
export const DResize = 260;
export const DRight = 261;
export const DRotate = 262;
export const DRowGap = 263;
export const DRubyAlign = 264;
export const DRubyPosition = 265;
export const DScale = 266;
export const DScrollBehavior = 267;
export const DShapeRendering = 268;
export const DStopColor = 269;
export const DStopOpacity = 270;
export const DStroke = 271;
export const DStrokeDasharray = 272;
export const DStrokeDashoffset = 273;
export const DStrokeLinecap = 274;
export const DStrokeLinejoin = 275;
export const DStrokeMiterlimit = 276;
export const DStrokeOpacity = 277;
export const DStrokeWidth = 278;
export const DTabSize = 279;
export const DTableLayout = 280;
export const DTextAlign = 281;
export const DTextAlignLast = 282;
export const DTextAnchor = 283;
export const DTextCombineUpright = 284;
export const DTextDecoration = 285;
export const DTextDecorationColor = 286;
export const DTextDecorationLine = 287;
export const DTextDecorationSkip = 288;
export const DTextDecorationStyle = 289;
export const DTextEmphasis = 290;
export const DTextEmphasisColor = 291;
export const DTextEmphasisPosition = 292;
export const DTextEmphasisStyle = 293;
export const DTextIndent = 294;
export const DTextJustify = 295;
export const DTextOrientation = 296;
export const DTextOverflow = 297;
export const DTextRendering = 298;
export const DTextShadow = 299;
export const DTextSizeAdjust = 300;
export const DTextTransform = 301;
export const DTextUnderlinePosition = 302;
export const DTop = 303;
export const DTouchAction = 304;
export const DTransform = 305;
export const DTransformBox = 306;
export const DTransformOrigin = 307;
export const DTransformStyle = 308;
export const DTransition = 309;
export const DTransitionDelay = 310;
export const DTransitionDuration = 311;
export const DTransitionProperty = 312;
export const DTransitionTimingFunction = 313;
export const DTranslate = 314;
export const DUnicodeBidi = 315;
export const DUserSelect = 316;
export const DVerticalAlign = 317;
export const DVisibility = 318;
export const DWhiteSpace = 319;
export const DWidows = 320;
export const DWidth = 321;
export const DWillChange = 322;
export const DWordBreak = 323;
export const DWordSpacing = 324;
export const DWordWrap = 325;
export const DWritingMode = 326;
export const DZIndex = 327;
export const DZoom = 328;

export const KnownDeclarations: Map<string, number> = new Map([
  ["align-content", DAlignContent],
  ["align-items", DAlignItems],
  ["align-self", DAlignSelf],
  ["alignment-baseline", DAlignmentBaseline],
  ["all", DAll],
  ["animation", DAnimation],
  ["animation-delay", DAnimationDelay],
  ["animation-direction", DAnimationDirection],
  ["animation-duration", DAnimationDuration],
  ["animation-fill-mode", DAnimationFillMode],
  ["animation-iteration-count", DAnimationIterationCount],
  ["animation-name", DAnimationName],
  ["animation-play-state", DAnimationPlayState],
  ["animation-timing-function", DAnimationTimingFunction],
  ["appearance", DAppearance],
  ["backdrop-filter", DBackdropFilter],
  ["backface-visibility", DBackfaceVisibility],
  ["background", DBackground],
  ["background-attachment", DBackgroundAttachment],
  ["background-clip", DBackgroundClip],
  ["background-color", DBackgroundColor],
  ["background-image", DBackgroundImage],
  ["background-origin", DBackgroundOrigin],
  ["background-position", DBackgroundPosition],
  ["background-position-x", DBackgroundPositionX],
  ["background-position-y", DBackgroundPositionY],
  ["background-repeat", DBackgroundRepeat],
  ["background-size", DBackgroundSize],
  ["baseline-shift", DBaselineShift],
  ["block-size", DBlockSize],
  ["border", DBorder],
  ["border-block-end", DBorderBlockEnd],
  ["border-block-end-color", DBorderBlockEndColor],
  ["border-block-end-style", DBorderBlockEndStyle],
  ["border-block-end-width", DBorderBlockEndWidth],
  ["border-block-start", DBorderBlockStart],
  ["border-block-start-color", DBorderBlockStartColor],
  ["border-block-start-style", DBorderBlockStartStyle],
  ["border-block-start-width", DBorderBlockStartWidth],
  ["border-bottom", DBorderBottom],
  ["border-bottom-color", DBorderBottomColor],
  ["border-bottom-left-radius", DBorderBottomLeftRadius],
  ["border-bottom-right-radius", DBorderBottomRightRadius],
  ["border-bottom-style", DBorderBottomStyle],
  ["border-bottom-width", DBorderBottomWidth],
  ["border-collapse", DBorderCollapse],
  ["border-color", DBorderColor],
  ["border-image", DBorderImage],
  ["border-image-outset", DBorderImageOutset],
  ["border-image-repeat", DBorderImageRepeat],
  ["border-image-slice", DBorderImageSlice],
  ["border-image-source", DBorderImageSource],
  ["border-image-width", DBorderImageWidth],
  ["border-inline-end", DBorderInlineEnd],
  ["border-inline-end-color", DBorderInlineEndColor],
  ["border-inline-end-style", DBorderInlineEndStyle],
  ["border-inline-end-width", DBorderInlineEndWidth],
  ["border-inline-start", DBorderInlineStart],
  ["border-inline-start-color", DBorderInlineStartColor],
  ["border-inline-start-style", DBorderInlineStartStyle],
  ["border-inline-start-width", DBorderInlineStartWidth],
  ["border-left", DBorderLeft],
  ["border-left-color", DBorderLeftColor],
  ["border-left-style", DBorderLeftStyle],
  ["border-left-width", DBorderLeftWidth],
  ["border-radius", DBorderRadius],
  ["border-right", DBorderRight],
  ["border-right-color", DBorderRightColor],
  ["border-right-style", DBorderRightStyle],
  ["border-right-width", DBorderRightWidth],
  ["border-spacing", DBorderSpacing],
  ["border-style", DBorderStyle],
  ["border-top", DBorderTop],
  ["border-top-color", DBorderTopColor],
  ["border-top-left-radius", DBorderTopLeftRadius],
  ["border-top-right-radius", DBorderTopRightRadius],
  ["border-top-style", DBorderTopStyle],
  ["border-top-width", DBorderTopWidth],
  ["border-width", DBorderWidth],
  ["bottom", DBottom],
  ["box-decoration-break", DBoxDecorationBreak],
  ["box-shadow", DBoxShadow],
  ["box-sizing", DBoxSizing],
  ["break-after", DBreakAfter],
  ["break-before", DBreakBefore],
  ["break-inside", DBreakInside],
  ["caption-side", DCaptionSide],
  ["caret-color", DCaretColor],
  ["clear", DClear],
  ["clip", DClip],
  ["clip-path", DClipPath],
  ["clip-rule", DClipRule],
  ["color", DColor],
  ["color-interpolation", DColorInterpolation],
  ["color-interpolation-filters", DColorInterpolationFilters],
  ["column-count", DColumnCount],
  ["column-fill", DColumnFill],
  ["column-gap", DColumnGap],
  ["column-rule", DColumnRule],
  ["column-rule-color", DColumnRuleColor],
  ["column-rule-style", DColumnRuleStyle],
  ["column-rule-width", DColumnRuleWidth],
  ["column-span", DColumnSpan],
  ["column-width", DColumnWidth],
  ["columns", DColumns],
  ["composes", DComposes],
  ["container", DContainer],
  ["container-name", DContainerName],
  ["container-type", DContainerType],
  ["content", DContent],
  ["counter-increment", DCounterIncrement],
  ["counter-reset", DCounterReset],
  ["css-float", DCssFloat],
  ["css-text", DCssText],
  ["cursor", DCursor],
  ["direction", DDirection],
  ["display", DDisplay],
  ["dominant-baseline", DDominantBaseline],
  ["empty-cells", DEmptyCells],
  ["fill", DFill],
  ["fill-opacity", DFillOpacity],
  ["fill-rule", DFillRule],
  ["filter", DFilter],
  ["flex", DFlex],
  ["flex-basis", DFlexBasis],
  ["flex-direction", DFlexDirection],
  ["flex-flow", DFlexFlow],
  ["flex-grow", DFlexGrow],
  ["flex-shrink", DFlexShrink],
  ["flex-wrap", DFlexWrap],
  ["float", DFloat],
  ["flood-color", DFloodColor],
  ["flood-opacity", DFloodOpacity],
  ["font", DFont],
  ["font-family", DFontFamily],
  ["font-feature-settings", DFontFeatureSettings],
  ["font-kerning", DFontKerning],
  ["font-size", DFontSize],
  ["font-size-adjust", DFontSizeAdjust],
  ["font-stretch", DFontStretch],
  ["font-style", DFontStyle],
  ["font-synthesis", DFontSynthesis],
  ["font-variant", DFontVariant],
  ["font-variant-caps", DFontVariantCaps],
  ["font-variant-east-asian", DFontVariantEastAsian],
  ["font-variant-ligatures", DFontVariantLigatures],
  ["font-variant-numeric", DFontVariantNumeric],
  ["font-variant-position", DFontVariantPosition],
  ["font-weight", DFontWeight],
  ["gap", DGap],
  ["glyph-orientation-vertical", DGlyphOrientationVertical],
  ["grid", DGrid],
  ["grid-area", DGridArea],
  ["grid-auto-columns", DGridAutoColumns],
  ["grid-auto-flow", DGridAutoFlow],
  ["grid-auto-rows", DGridAutoRows],
  ["grid-column", DGridColumn],
  ["grid-column-end", DGridColumnEnd],
  ["grid-column-gap", DGridColumnGap],
  ["grid-column-start", DGridColumnStart],
  ["grid-gap", DGridGap],
  ["grid-row", DGridRow],
  ["grid-row-end", DGridRowEnd],
  ["grid-row-gap", DGridRowGap],
  ["grid-row-start", DGridRowStart],
  ["grid-template", DGridTemplate],
  ["grid-template-areas", DGridTemplateAreas],
  ["grid-template-columns", DGridTemplateColumns],
  ["grid-template-rows", DGridTemplateRows],
  ["height", DHeight],
  ["hyphens", DHyphens],
  ["image-orientation", DImageOrientation],
  ["image-rendering", DImageRendering],
  ["initial-letter", DInitialLetter],
  ["inline-size", DInlineSize],
  ["inset", DInset],
  ["justify-content", DJustifyContent],
  ["justify-items", DJustifyItems],
  ["justify-self", DJustifySelf],
  ["left", DLeft],
  ["letter-spacing", DLetterSpacing],
  ["lighting-color", DLightingColor],
  ["line-break", DLineBreak],
  ["line-height", DLineHeight],
  ["list-style", DListStyle],
  ["list-style-image", DListStyleImage],
  ["list-style-position", DListStylePosition],
  ["list-style-type", DListStyleType],
  ["margin", DMargin],
  ["margin-block-end", DMarginBlockEnd],
  ["margin-block-start", DMarginBlockStart],
  ["margin-bottom", DMarginBottom],
  ["margin-inline-end", DMarginInlineEnd],
  ["margin-inline-start", DMarginInlineStart],
  ["margin-left", DMarginLeft],
  ["margin-right", DMarginRight],
  ["margin-top", DMarginTop],
  ["marker", DMarker],
  ["marker-end", DMarkerEnd],
  ["marker-mid", DMarkerMid],
  ["marker-start", DMarkerStart],
  ["mask", DMask],
  ["mask-composite", DMaskComposite],
  ["mask-image", DMaskImage],
  ["mask-origin", DMaskOrigin],
  ["mask-position", DMaskPosition],
  ["mask-repeat", DMaskRepeat],
  ["mask-size", DMaskSize],
  ["mask-type", DMaskType],
  ["max-block-size", DMaxBlockSize],
  ["max-height", DMaxHeight],
  ["max-inline-size", DMaxInlineSize],
  ["max-width", DMaxWidth],
  ["min-block-size", DMinBlockSize],
  ["min-height", DMinHeight],
  ["min-inline-size", DMinInlineSize],
  ["min-width", DMinWidth],
  ["object-fit", DObjectFit],
  ["object-position", DObjectPosition],
  ["opacity", DOpacity],
  ["order", DOrder],
  ["orphans", DOrphans],
  ["outline", DOutline],
  ["outline-color", DOutlineColor],
  ["outline-offset", DOutlineOffset],
  ["outline-style", DOutlineStyle],
  ["outline-width", DOutlineWidth],
  ["overflow", DOverflow],
  ["overflow-anchor", DOverflowAnchor],
  ["overflow-wrap", DOverflowWrap],
  ["overflow-x", DOverflowX],
  ["overflow-y", DOverflowY],
  ["overscroll-behavior", DOverscrollBehavior],
  ["overscroll-behavior-block", DOverscrollBehaviorBlock],
  ["overscroll-behavior-inline", DOverscrollBehaviorInline],
  ["overscroll-behavior-x", DOverscrollBehaviorX],
  ["overscroll-behavior-y", DOverscrollBehaviorY],
  ["padding", DPadding],
  ["padding-block-end", DPaddingBlockEnd],
  ["padding-block-start", DPaddingBlockStart],
  ["padding-bottom", DPaddingBottom],
  ["padding-inline-end", DPaddingInlineEnd],
  ["padding-inline-start", DPaddingInlineStart],
  ["padding-left", DPaddingLeft],
  ["padding-right", DPaddingRight],
  ["padding-top", DPaddingTop],
  ["page-break-after", DPageBreakAfter],
  ["page-break-before", DPageBreakBefore],
  ["page-break-inside", DPageBreakInside],
  ["paint-order", DPaintOrder],
  ["perspective", DPerspective],
  ["perspective-origin", DPerspectiveOrigin],
  ["place-content", DPlaceContent],
  ["place-items", DPlaceItems],
  ["place-self", DPlaceSelf],
  ["pointer-events", DPointerEvents],
  ["position", DPosition],
  ["print-color-adjust", DPrintColorAdjust],
  ["quotes", DQuotes],
  ["resize", DResize],
  ["right", DRight],
  ["rotate", DRotate],
  ["row-gap", DRowGap],
  ["ruby-align", DRubyAlign],
  ["ruby-position", DRubyPosition],
  ["scale", DScale],
  ["scroll-behavior", DScrollBehavior],
  ["shape-rendering", DShapeRendering],
  ["stop-color", DStopColor],
  ["stop-opacity", DStopOpacity],
  ["stroke", DStroke],
  ["stroke-dasharray", DStrokeDasharray],
  ["stroke-dashoffset", DStrokeDashoffset],
  ["stroke-linecap", DStrokeLinecap],
  ["stroke-linejoin", DStrokeLinejoin],
  ["stroke-miterlimit", DStrokeMiterlimit],
  ["stroke-opacity", DStrokeOpacity],
  ["stroke-width", DStrokeWidth],
  ["tab-size", DTabSize],
  ["table-layout", DTableLayout],
  ["text-align", DTextAlign],
  ["text-align-last", DTextAlignLast],
  ["text-anchor", DTextAnchor],
  ["text-combine-upright", DTextCombineUpright],
  ["text-decoration", DTextDecoration],
  ["text-decoration-color", DTextDecorationColor],
  ["text-decoration-line", DTextDecorationLine],
  ["text-decoration-skip", DTextDecorationSkip],
  ["text-decoration-style", DTextDecorationStyle],
  ["text-emphasis", DTextEmphasis],
  ["text-emphasis-color", DTextEmphasisColor],
  ["text-emphasis-position", DTextEmphasisPosition],
  ["text-emphasis-style", DTextEmphasisStyle],
  ["text-indent", DTextIndent],
  ["text-justify", DTextJustify],
  ["text-orientation", DTextOrientation],
  ["text-overflow", DTextOverflow],
  ["text-rendering", DTextRendering],
  ["text-shadow", DTextShadow],
  ["text-size-adjust", DTextSizeAdjust],
  ["text-transform", DTextTransform],
  ["text-underline-position", DTextUnderlinePosition],
  ["top", DTop],
  ["touch-action", DTouchAction],
  ["transform", DTransform],
  ["transform-box", DTransformBox],
  ["transform-origin", DTransformOrigin],
  ["transform-style", DTransformStyle],
  ["transition", DTransition],
  ["transition-delay", DTransitionDelay],
  ["transition-duration", DTransitionDuration],
  ["transition-property", DTransitionProperty],
  ["transition-timing-function", DTransitionTimingFunction],
  ["translate", DTranslate],
  ["unicode-bidi", DUnicodeBidi],
  ["user-select", DUserSelect],
  ["vertical-align", DVerticalAlign],
  ["visibility", DVisibility],
  ["white-space", DWhiteSpace],
  ["widows", DWidows],
  ["width", DWidth],
  ["will-change", DWillChange],
  ["word-break", DWordBreak],
  ["word-spacing", DWordSpacing],
  ["word-wrap", DWordWrap],
  ["writing-mode", DWritingMode],
  ["z-index", DZIndex],
  ["zoom", DZoom],
]);
