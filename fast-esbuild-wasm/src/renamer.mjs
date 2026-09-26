// Port of internal/renamer/renamer.go. See CONVENTIONS.md.
//
// - ast.SymbolMap is the SymbolMap class from ast.mjs (symbols.get(ref),
//   symbols.symbolsForSource).
// - Go maps: reservedNames is a Map<string, number>, scope.members is a
//   Map<string, ScopeMember>, nestedScopes is a Map<number, Scope[]>.
// - ast.SlotCounts is a 4-element array; Go passes it by value, so it is
//   copied explicitly where Go copies it.
// - Go runs AssignNamesByScope / AccumulateSymbolUseCounts in parallel; here
//   everything is sequential. The results do not depend on the order (see the
//   comments below).
import { bail } from "./bail.mjs";
import {
  followSymbols,
  makeRef,
  refSource,
  refInner,
  InvalidRef,
  SymbolUnbound,
  MustNotBeRenamed,
  MustStartWithCapitalLetterForJSX,
  SlotDefault,
  SlotLabel,
  SlotPrivateName,
  SlotMustNotBeRenamed,
  newSlotCounts,
  slotCountsUnionMax,
} from "./ast.mjs";
import { Keywords, StrictModeReservedWords } from "./js_lexer.mjs";
import { isIdentifier, forceValidIdentifier } from "./js_ident.mjs";

// Returns a Map<string, number>. Note: js_lexer's Keywords and
// StrictModeReservedWords may be a Map or a Set; only their keys are used.
export function computeReservedNames(moduleScopes, symbols) {
  const names = new Map();

  // All keywords and strict mode reserved words are reserved names
  for (const k of Keywords.keys()) {
    names.set(k, 1);
  }
  for (const k of StrictModeReservedWords.keys()) {
    names.set(k, 1);
  }

  // All unbound symbols must be reserved names
  for (const scope of moduleScopes) {
    computeReservedNamesForScope(scope, symbols, names);
  }

  return names;
}

function computeReservedNamesForScope(scope, symbols, names) {
  for (const member of scope.members.values()) {
    const symbol = symbols.get(member.ref);
    if (symbol.kind === SymbolUnbound || (symbol.flags & MustNotBeRenamed) !== 0) {
      names.set(symbol.originalName, 1);
    }
  }
  for (const ref of scope.generated) {
    const symbol = symbols.get(ref);
    if (symbol.kind === SymbolUnbound || (symbol.flags & MustNotBeRenamed) !== 0) {
      names.set(symbol.originalName, 1);
    }
  }

  // If there's a direct "eval" somewhere inside the current scope, continue
  // traversing down the scope tree until we find it to get all reserved names
  if (scope.containsDirectEval) {
    for (const child of scope.children) {
      if (child.containsDirectEval) {
        computeReservedNamesForScope(child, symbols, names);
      }
    }
  }
}

// Renamer interface: every renamer has a "nameForSymbol(ref)" method.

////////////////////////////////////////////////////////////////////////////////
// noOpRenamer

export class noOpRenamer {
  constructor(symbols = null) {
    this.symbols = symbols;
  }

  nameForSymbol(ref) {
    ref = followSymbols(this.symbols, ref);
    return this.symbols.get(ref).originalName;
  }
}

export function newNoOpRenamer(symbols) {
  return new noOpRenamer(symbols);
}

////////////////////////////////////////////////////////////////////////////////
// MinifyRenamer (only used when minifying identifiers)

export class symbolSlot {
  constructor(name = "", count = 0, needsCapitalForJSX = 0) {
    this.name = name;
    this.count = count; // uint32
    this.needsCapitalForJSX = needsCapitalForJSX; // This is really a bool but needs to be atomic
  }
}

function makeSymbolSlots(n) {
  const slots = new Array(n);
  for (let i = 0; i < n; i++) slots[i] = new symbolSlot();
  return slots;
}

export class MinifyRenamer {
  constructor(reservedNames = null, slots = [[], [], [], []], topLevelSymbolToSlot = new Map(), symbols = null) {
    this.reservedNames = reservedNames; // Map<string, number>
    this.slots = slots; // [4][]symbolSlot
    this.topLevelSymbolToSlot = topLevelSymbolToSlot; // Map<Ref, number>
    this.symbols = symbols;
  }

  nameForSymbol(ref) {
    // Follow links to get to the underlying symbol
    ref = followSymbols(this.symbols, ref);
    const symbol = this.symbols.get(ref);

    // Skip this symbol if the name is pinned
    const ns = symbol.slotNamespace();
    if (ns === SlotMustNotBeRenamed) {
      return symbol.originalName;
    }

    // Check if it's a nested scope symbol
    let i = symbol.nestedScopeSlot;

    // If it's not (i.e. it's in a top-level scope), look up the slot
    if (!(i >= 0)) {
      const index = this.topLevelSymbolToSlot.get(ref);
      if (index === undefined) {
        // If we get here, then we're printing a symbol that never had any
        // recorded uses. This is odd but can happen in certain scenarios.
        // For example, code in a branch with dead control flow won't mark
        // any uses but may still be printed. In that case it doesn't matter
        // what name we use since it's dead code.
        return symbol.originalName;
      }
      i = index;
    }

    return this.slots[ns][i].name;
  }

  accumulateSymbolUseCounts(topLevelSymbols, symbolUses, stableSourceIndices) {
    // "topLevelSymbols" is the StableSymbolCountArray (a JS array) to append to.
    // "symbolUses" is a Map<Ref, SymbolUse>. Go iterates this map in random
    // order; the linker sorts the result afterwards with a total order.
    for (const [ref, use] of symbolUses) {
      this.accumulateSymbolCount(topLevelSymbols, ref, use.countEstimate, stableSourceIndices);
    }
  }

  accumulateSymbolCount(topLevelSymbols, ref, count, stableSourceIndices) {
    // Follow links to get to the underlying symbol
    ref = followSymbols(this.symbols, ref);
    let symbol = this.symbols.get(ref);
    while (symbol.namespaceAlias !== null) {
      ref = followSymbols(this.symbols, symbol.namespaceAlias.namespaceRef);
      symbol = this.symbols.get(ref);
    }

    // Skip this symbol if the name is pinned
    const ns = symbol.slotNamespace();
    if (ns === SlotMustNotBeRenamed) {
      return;
    }

    // Check if it's a nested scope symbol
    const i = symbol.nestedScopeSlot;
    if (i >= 0) {
      // If it is, accumulate the count (Go uses an atomic uint32 add)
      const slot = this.slots[ns][i];
      slot.count = (slot.count + count) >>> 0;
      if ((symbol.flags & MustStartWithCapitalLetterForJSX) !== 0) {
        slot.needsCapitalForJSX = 1;
      }
      return;
    }

    // If it's a top-level symbol, defer it to later since we have
    // to allocate slots for these in serial instead of in parallel
    topLevelSymbols.push(new StableSymbolCount(stableSourceIndices[refSource(ref)], ref, count));
  }

  // The parallel part of the symbol count accumulation algorithm above processes
  // nested symbols and generates an array of top-level symbols to process later.
  // After the parallel part has finished, that array of top-level symbols is passed
  // to this function which processes them in serial.
  allocateTopLevelSymbolSlots(topLevelSymbols) {
    for (const stable of topLevelSymbols) {
      const symbol = this.symbols.get(stable.ref);
      const slots = this.slots[symbol.slotNamespace()];
      const i = this.topLevelSymbolToSlot.get(stable.ref);
      if (i !== undefined) {
        const slot = slots[i];
        slot.count = (slot.count + stable.count) >>> 0;
        if ((symbol.flags & MustStartWithCapitalLetterForJSX) !== 0) {
          slot.needsCapitalForJSX = 1;
        }
      } else {
        let needsCapitalForJSX = 0;
        if ((symbol.flags & MustStartWithCapitalLetterForJSX) !== 0) {
          needsCapitalForJSX = 1;
        }
        const index = slots.length;
        slots.push(new symbolSlot("", stable.count, needsCapitalForJSX));
        this.topLevelSymbolToSlot.set(stable.ref, index);
      }
    }
  }

  // "minifier" is an ast.NameMinifier with a numberToMinifiedName(i) method.
  // (ast.NameMinifier is not ported since identifier minification is not
  // supported by the fast path.)
  assignNamesByFrequency(minifier) {
    for (let ns = 0; ns < this.slots.length; ns++) {
      const slots = this.slots[ns];

      // Sort symbols by count
      const sorted = new Array(slots.length);
      for (let i = 0; i < slots.length; i++) {
        sorted[i] = new slotAndCount(i, slots[i].count);
      }
      // Keys are unique ("slot" differs), so sort stability does not matter
      sorted.sort(compareSlotAndCount);

      // Assign names to symbols
      let nextName = 0;
      for (const data of sorted) {
        const slot = slots[data.slot];
        let name = minifier.numberToMinifiedName(nextName);
        nextName++;

        // Make sure we never generate a reserved name. We only have to worry
        // about collisions with reserved identifiers for normal symbols, and we
        // only have to worry about collisions with keywords for labels. We do
        // not have to worry about either for private names because they start
        // with a "#" character.
        switch (ns) {
          case SlotDefault:
            while ((this.reservedNames.get(name) ?? 0) !== 0) {
              name = minifier.numberToMinifiedName(nextName);
              nextName++;
            }

            // Make sure names of symbols used in JSX elements start with a capital letter
            if (slot.needsCapitalForJSX !== 0) {
              while (name.charCodeAt(0) >= 97 /* 'a' */ && name.charCodeAt(0) <= 122 /* 'z' */) {
                name = minifier.numberToMinifiedName(nextName);
                nextName++;
              }
            }
            break;

          case SlotLabel:
            while (Keywords.has(name)) {
              name = minifier.numberToMinifiedName(nextName);
              nextName++;
            }
            break;
        }

        // Private names must be prefixed with "#"
        if (ns === SlotPrivateName) {
          name = "#" + name;
        }

        slot.name = name;
      }
    }
  }
}

// "firstTopLevelSlots" is an ast.SlotCounts (4-element array)
export function newMinifyRenamer(symbols, firstTopLevelSlots, reservedNames) {
  return new MinifyRenamer(
    reservedNames,
    [
      makeSymbolSlots(firstTopLevelSlots[0]),
      makeSymbolSlots(firstTopLevelSlots[1]),
      makeSymbolSlots(firstTopLevelSlots[2]),
      makeSymbolSlots(firstTopLevelSlots[3]),
    ],
    new Map(),
    symbols,
  );
}

// The InnerIndex should be stable because the parser for a single file is
// single-threaded and deterministically assigns out InnerIndex values
// sequentially. But the SourceIndex should be unstable because the main thread
// assigns out source index values sequentially to newly-discovered dependencies
// in a multi-threaded producer/consumer relationship. So instead we use the
// index of the source in the DFS order over all entry points for stability.
export class StableSymbolCount {
  constructor(stableSourceIndex = 0, ref = InvalidRef, count = 0) {
    this.stableSourceIndex = stableSourceIndex;
    this.ref = ref;
    this.count = count;
  }
}

// StableSymbolCountArray is a plain JS array of StableSymbolCount. These are
// the methods of Go's sort.Interface implementation.
export function stableSymbolCountArrayLen(a) {
  return a.length;
}

export function stableSymbolCountArraySwap(a, i, j) {
  const tmp = a[i];
  a[i] = a[j];
  a[j] = tmp;
}

export function stableSymbolCountArrayLess(a, i, j) {
  return stableSymbolCountLess(a[i], a[j]);
}

function stableSymbolCountLess(ai, aj) {
  if (ai.count > aj.count) {
    return true;
  }
  if (ai.count < aj.count) {
    return false;
  }
  if (ai.stableSourceIndex < aj.stableSourceIndex) {
    return true;
  }
  if (ai.stableSourceIndex > aj.stableSourceIndex) {
    return false;
  }
  return refInner(ai.ref) < refInner(aj.ref);
}

// Go: sort.Sort(StableSymbolCountArray(a)). Elements with equal keys have the
// same count, stable source index and inner index, i.e. they are identical
// (a stable source index identifies a single source), so the instability of
// Go's sort cannot affect the result.
export function sortStableSymbolCountArray(a) {
  a.sort((x, y) => (stableSymbolCountLess(x, y) ? -1 : stableSymbolCountLess(y, x) ? 1 : 0));
  return a;
}

// Returns the number of nested slots (an ast.SlotCounts). "symbols" is the
// []ast.Symbol array of the file being parsed.
export function assignNestedScopeSlots(moduleScope, symbols) {
  const slotCounts = newSlotCounts();

  // Temporarily set the nested scope slots of top-level symbols to valid so
  // they aren't renamed in nested scopes. This prevents us from accidentally
  // assigning nested scope slots to variables declared using "var" in a nested
  // scope that are actually hoisted up to the module scope to become a top-
  // level symbol.
  const validSlot = 1;
  for (const member of moduleScope.members.values()) {
    symbols[refInner(member.ref)].nestedScopeSlot = validSlot;
  }
  for (const ref of moduleScope.generated) {
    symbols[refInner(ref)].nestedScopeSlot = validSlot;
  }

  // Assign nested scope slots independently for each nested scope
  for (const child of moduleScope.children) {
    slotCountsUnionMax(slotCounts, assignNestedScopeSlotsHelper(child, symbols, newSlotCounts()));
  }

  // Then set the nested scope slots of top-level symbols back to zero. Top-
  // level symbols are not supposed to have nested scope slots.
  for (const member of moduleScope.members.values()) {
    symbols[refInner(member.ref)].nestedScopeSlot = -1;
  }
  for (const ref of moduleScope.generated) {
    symbols[refInner(ref)].nestedScopeSlot = -1;
  }
  return slotCounts;
}

function compareNumbers(a, b) {
  return a - b;
}

function assignNestedScopeSlotsHelper(scope, symbols, slot) {
  // Go passes "slot" (an ast.SlotCounts array) by value
  slot = slot.slice();

  // Sort member map keys for determinism
  const sortedMembers = [];
  for (const member of scope.members.values()) {
    sortedMembers.push(refInner(member.ref));
  }
  sortedMembers.sort(compareNumbers);

  // Assign slots for this scope's symbols. Only do this if the slot is
  // not already assigned. Nested scopes have copies of symbols from parent
  // scopes and we want to use the slot from the parent scope, not child scopes.
  for (const innerIndex of sortedMembers) {
    const symbol = symbols[innerIndex];
    const ns = symbol.slotNamespace();
    if (ns !== SlotMustNotBeRenamed && !(symbol.nestedScopeSlot >= 0)) {
      symbol.nestedScopeSlot = slot[ns];
      slot[ns]++;
    }
  }
  for (const ref of scope.generated) {
    const symbol = symbols[refInner(ref)];
    const ns = symbol.slotNamespace();
    if (ns !== SlotMustNotBeRenamed && !(symbol.nestedScopeSlot >= 0)) {
      symbol.nestedScopeSlot = slot[ns];
      slot[ns]++;
    }
  }

  // Labels are always declared in a nested scope, so we don't need to check.
  if (scope.label.ref !== InvalidRef) {
    const symbol = symbols[refInner(scope.label.ref)];
    symbol.nestedScopeSlot = slot[SlotLabel];
    slot[SlotLabel]++;
  }

  // Assign slots for the symbols of child scopes
  const slotCounts = slot.slice();
  for (const child of scope.children) {
    slotCountsUnionMax(slotCounts, assignNestedScopeSlotsHelper(child, symbols, slot));
  }
  return slotCounts;
}

class slotAndCount {
  constructor(slot = 0, count = 0) {
    this.slot = slot;
    this.count = count;
  }
}

function compareSlotAndCount(ai, aj) {
  // Go's Less: ai.count > aj.count || (ai.count == aj.count && ai.slot < aj.slot)
  if (ai.count !== aj.count) return ai.count > aj.count ? -1 : 1;
  return ai.slot - aj.slot;
}

////////////////////////////////////////////////////////////////////////////////
// NumberRenamer

export class NumberRenamer {
  constructor(symbols = null, root = new numberScope(), names = []) {
    this.symbols = symbols;
    this.root = root; // numberScope (value)
    this.names = names; // [][]string: an array of (array of string, or null)
  }

  nameForSymbol(ref) {
    ref = followSymbols(this.symbols, ref);
    const inner = this.names[refSource(ref)];
    if (inner !== null) {
      const name = inner[refInner(ref)];
      if (name !== "") {
        return name;
      }
    }
    return this.symbols.get(ref).originalName;
  }

  addTopLevelSymbol(ref) {
    this.assignName(this.root, ref);
  }

  assignName(scope, ref) {
    ref = followSymbols(this.symbols, ref);

    // Don't rename the same symbol more than once
    let inner = this.names[refSource(ref)];
    if (inner !== null && inner[refInner(ref)] !== "") {
      return;
    }

    // Don't rename unbound symbols, symbols marked as reserved names, labels, or private names
    const symbol = this.symbols.get(ref);
    const ns = symbol.slotNamespace();
    if (ns !== SlotDefault && ns !== SlotPrivateName) {
      return;
    }

    // Make sure names of symbols used in JSX elements start with a capital letter
    let originalName = symbol.originalName;
    if ((symbol.flags & MustStartWithCapitalLetterForJSX) !== 0) {
      if (originalName.length === 0) {
        bail(); // Go: index out of range panic
      }
      const first = originalName.charCodeAt(0);
      if (first >= 97 /* 'a' */ && first <= 122 /* 'z' */) {
        originalName = String.fromCharCode(first + (65 - 97)) + originalName.slice(1);
      }
    }

    // Compute a new name
    const name = scope.findUnusedName(originalName, ns);

    // Store the new name
    if (inner === null) {
      // Go allocates these lazily to save memory with many chunks.
      inner = new Array(this.symbols.symbolsForSource[refSource(ref)].length).fill("");
      this.names[refSource(ref)] = inner;
    }
    inner[refInner(ref)] = name;
  }

  // "sorted" is a scratch array shared between calls (Go: *[]int)
  assignNamesInScope(scope, sourceIndex, parent, sorted) {
    const s = new numberScope(parent, new Map());

    if (scope.members.size > 0) {
      // Sort member map keys for determinism, reusing a shared memory buffer
      sorted.length = 0;
      for (const member of scope.members.values()) {
        sorted.push(refInner(member.ref));
      }
      sorted.sort(compareNumbers);

      // Rename all user-defined symbols in this scope
      for (const innerIndex of sorted) {
        this.assignName(s, makeRef(sourceIndex, innerIndex));
      }
    }

    // Also rename all generated symbols in this scope
    for (const ref of scope.generated) {
      this.assignName(s, ref);
    }

    return s;
  }

  assignNamesRecursive(scope, sourceIndex, parent, sorted) {
    // For performance in extreme cases (e.g. 10,000 nested scopes), traversing
    // through singly-nested scopes uses iteration instead of recursion
    for (;;) {
      if (scope.members.size > 0 || scope.generated.length > 0) {
        // For performance in extreme cases (e.g. 10,000 nested scopes), only
        // allocate a scope when it's necessary.
        parent = this.assignNamesInScope(scope, sourceIndex, parent, sorted);
      }
      const children = scope.children;
      if (children.length === 1) {
        scope = children[0];
      } else {
        break;
      }
    }

    // Symbols in child scopes may also have to be renamed to avoid conflicts
    for (const child of scope.children) {
      this.assignNamesRecursive(child, sourceIndex, parent, sorted);
    }
  }

  // "nestedScopes" is a Map<number (source index), Scope[]>. Go renames the
  // files in parallel; each file only reads the shared root scope and writes
  // to its own nested scopes, so the order does not matter.
  assignNamesByScope(nestedScopes) {
    for (const [sourceIndex, scopes] of nestedScopes) {
      const sorted = [];
      for (const scope of scopes) {
        this.assignNamesRecursive(scope, sourceIndex, this.root, sorted);
      }
    }
  }
}

// "reservedNames" (Map<string, number>) becomes the root scope's name counts
// and is mutated by top-level renaming, exactly like in Go.
export function newNumberRenamer(symbols, reservedNames) {
  return new NumberRenamer(symbols, new numberScope(null, reservedNames), new Array(symbols.symbolsForSource.length).fill(null));
}

export class numberScope {
  constructor(parent = null, nameCounts = null) {
    this.parent = parent;

    // This is used as a set of used names in this scope. This also maps the name
    // to the number of times the name has experienced a collision. When a name
    // collides with an already-used name, we need to rename it. This is done by
    // incrementing a number at the end until the name is unused. We save the
    // count here so that subsequent collisions can start counting from where the
    // previous collision ended instead of having to start counting from 1.
    this.nameCounts = nameCounts; // Map<string, number>
  }

  findNameUse(name) {
    const original = this;
    let s = this;
    for (;;) {
      if (s.nameCounts.has(name)) {
        if (s === original) {
          return nameUsedInSameScope;
        }
        return nameUsed;
      }
      s = s.parent;
      if (s === null) {
        return nameUnused;
      }
    }
  }

  findUnusedName(name, ns) {
    // We may not have a valid identifier if this is an internally-constructed name
    if (ns === SlotPrivateName) {
      const id = name.slice(1);
      if (!isIdentifier(id)) {
        name = forceValidIdentifier("#", id);
      }
    } else {
      if (!isIdentifier(name)) {
        name = forceValidIdentifier("", name);
      }
    }

    const use = this.findNameUse(name);
    if (use !== nameUnused) {
      // If the name is already in use, generate a new name by appending a number
      let tries = 1;
      if (use === nameUsedInSameScope) {
        // To avoid O(n^2) behavior, the number must start off being the number
        // that we used last time there was a collision with this name. Otherwise
        // if there are many collisions with the same name, each name collision
        // would have to increment the counter past all previous name collisions
        // which is a O(n^2) time algorithm. Only do this if this symbol comes
        // from the same scope as the previous one since sibling scopes can reuse
        // the same name without problems.
        tries = this.nameCounts.get(name) ?? 0;
      }
      const prefix = name;

      // Keep incrementing the number until the name is unused
      for (;;) {
        tries = (tries + 1) >>> 0; // uint32
        name = prefix + String(tries);

        // Make sure this new name is unused
        if (this.findNameUse(name) === nameUnused) {
          // Store the count so we can start here next time instead of starting
          // from 1. This means we avoid O(n^2) behavior.
          if (use === nameUsedInSameScope) {
            this.nameCounts.set(prefix, tries);
          }
          break;
        }
      }
    }

    // Each name starts off with a count of 1 so that the first collision with
    // "name" is called "name2"
    this.nameCounts.set(name, 1);
    return name;
  }
}

// nameUse
export const nameUnused = 0;
export const nameUsed = 1;
export const nameUsedInSameScope = 2;

////////////////////////////////////////////////////////////////////////////////
// ExportRenamer

export class ExportRenamer {
  constructor(used = null, count = 0) {
    this.used = used; // Map<string, number> or null
    this.count = count;
  }

  nextRenamedName(name) {
    if (this.used === null) {
      this.used = new Map();
    }
    const found = this.used.get(name);
    if (found !== undefined) {
      let tries = found;
      const prefix = name;
      for (;;) {
        tries = (tries + 1) >>> 0; // uint32
        name = prefix + String(tries);
        if (!this.used.has(name)) {
          break;
        }
      }
      this.used.set(name, tries);
    } else {
      this.used.set(name, 1);
    }
    return name;
  }

  nextMinifiedName() {
    // Go: ast.DefaultNameMinifierJS.NumberToMinifiedName(r.count). The name
    // minifier is not ported (minify only).
    bail();
  }
}
