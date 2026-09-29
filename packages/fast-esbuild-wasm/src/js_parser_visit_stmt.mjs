// Port of internal/js_parser/js_parser.go lines 766-1144 and 8657-10392:
// switch-case liveness, duplicate case/property checks, the statement-list
// visitor (visitStmts and friends), statement mangling helpers and binding
// visiting. See CONVENTIONS.md.
//
// Package-level functions are named exports; *parser methods live in
// `visitStmtMethods` (mixed into Parser.prototype by js_parser.mjs).
import { goQuote } from "./gostd.mjs";
import { GoPanic, goIndexOutOfRange } from "./gopanic.mjs";
import { jsFeatureHas, ConstAndLet, OptionalCatchBinding } from "./compat.mjs";
import { Warning, Debug, MsgID_JS_DuplicateCase, MsgID_JS_DuplicateObjectKey, MsgID_JS_DuplicateClassMember } from "./logger.mjs";
import { hashCombine, hashCombineString } from "./helpers.mjs";
import {
  refInner,
  InvalidRef,
  NamespaceAlias,
  SymbolOther,
  SymbolUnbound,
  SymbolHoistedFunction,
  MustNotBeRenamed,
  DidKeepName,
  symbolKindIsHoisted,
} from "./ast.mjs";
import {
  Expr,
  Stmt,
  Binding,
  Decl,
  DeclaredSymbol,
  ScopeMember,
  SLocal,
  SBlock,
  SExpr,
  SReturn,
  SThrow,
  SIf,
  SEmptyShared,
  EThisShared,
  EUndefinedShared,
  EIdentifier,
  EFunction,
  EString,
  EBinary,
  ENumber,
  EIf,
  BIdentifier,
  B_MISSING,
  B_IDENTIFIER,
  B_ARRAY,
  B_OBJECT,
  E_ARRAY,
  E_UNARY,
  E_BINARY,
  E_BOOLEAN,
  E_NULL,
  E_UNDEFINED,
  E_CALL,
  E_DOT,
  E_INDEX,
  E_IDENTIFIER,
  E_NUMBER,
  E_BIG_INT,
  E_OBJECT,
  E_SPREAD,
  E_STRING,
  E_TEMPLATE,
  E_INLINED_ENUM,
  E_AWAIT,
  E_YIELD,
  E_IF,
  E_IMPORT_CALL,
  S_BLOCK,
  S_COMMENT,
  S_DEBUGGER,
  S_DIRECTIVE,
  S_EMPTY,
  S_TYPESCRIPT,
  S_EXPORT_EQUALS,
  S_EXPR,
  S_ENUM,
  S_FUNCTION,
  S_CLASS,
  S_LABEL,
  S_IF,
  S_FOR,
  S_FOR_IN,
  S_FOR_OF,
  S_DO_WHILE,
  S_WHILE,
  S_WITH,
  S_TRY,
  S_SWITCH,
  S_RETURN,
  S_THROW,
  S_LOCAL,
  S_BREAK,
  S_CONTINUE,
  LocalVar,
  LocalLet,
  LocalConst,
  ScopeBlock,
  ScopeWith,
  ScopeLabel,
  scopeKindStopsHoisting,
  UnOpNot,
  UnOpVoid,
  UnOpPreDec,
  UnOpPreInc,
  UnOpPostDec,
  UnOpPostInc,
  UnOpDelete,
  BinOpLogicalAnd,
  BinOpLogicalOr,
  BinOpComma,
  AssignTargetNone,
  AssignTargetReplace,
  AssignTargetUpdate,
  opCodeBinaryAssignTarget,
  OptionalChainNone,
  PropertySpread,
  PropertyGetter,
  PropertySetter,
  PropertyIsStatic,
  PropertyIsComputed,
} from "./js_ast.mjs";
import {
  checkEqualityIfNoSideEffects,
  checkEqualityBigInt,
  StrictEquality,
  valuesLookTheSame,
  joinWithComma,
  joinWithLeftAssociativeOp,
  not,
  toBooleanWithSideEffects,
  CouldHaveSideEffects,
  NoSideEffects,
  isPrimitiveLiteral,
  inlinePrimitivesIntoTemplate,
} from "./js_ast_helpers.mjs";
import { rangeOfIdentifier } from "./js_lexer.mjs";
import {
  switchCaseLiveness,
  alwaysDead,
  livenessUnknown,
  alwaysLive,
  duplicateCaseValue,
  duplicatePropertiesInObject,
  duplicatePropertiesInClass,
  findSymbolResult,
  tempRef,
  stmtsLoopBody,
  stmtsFnBody,
  substituteContinue,
  substituteSuccess,
  substituteFailure,
  bindingOpts,
  exprIn,
  ifElseFunctionStmt,
  relocateVarsNormal,
} from "./js_parser_types.mjs";

// ---------------------------------------------------------------------------
// js_parser.go lines 766-1144

export function analyzeSwitchCasesForLiveness(s) {
  const cases = [];
  let defaultIndex = -1;

  // Determine the status of the individual cases independently
  let maxStatus = alwaysDead;
  const sCases = s.cases;
  for (let i = 0; i < sCases.length; i++) {
    const c = sCases[i];
    if (c.valueOrNil === null) {
      defaultIndex = i;
    }

    // Check the value for strict equality
    let status;
    if (maxStatus === alwaysLive) {
      status = alwaysDead; // Everything after an always-live case is always dead
    } else if (c.valueOrNil === null) {
      status = alwaysDead; // This is the default case, and will be filled in later
    } else {
      const $d159 = checkEqualityIfNoSideEffects(s.test.data, c.valueOrNil.data, StrictEquality);
      const isEqualToTest = $d159[0], ok = $d159[1];
      if (ok) {
        if (isEqualToTest) {
          status = alwaysLive; // This branch will always be matched, and will be taken unless an earlier branch was taken
        } else {
          status = alwaysDead; // This branch will never be matched, and will not be taken unless there was fall-through
        }
      } else {
        status = livenessUnknown; // This branch depends on run-time values and may or may not be matched
      }
    }
    if (maxStatus < status) {
      maxStatus = status;
    }

    cases.push(new switchCaseLiveness(status, caseBodyCouldHaveFallThrough(c.body)));
  }

  // Set the liveness for the default case last based on the other cases
  if (defaultIndex !== -1) {
    // The negation here transposes "always live" with "always dead"
    // ("0 - x" instead of "-x" so that livenessUnknown stays +0)
    const status = 0 - maxStatus;
    if (maxStatus < status) {
      maxStatus = status;
    }
    cases[defaultIndex].status = status;
  }

  // Then propagate fall-through information in linear fall-through order
  for (let i = 0; i < cases.length; i++) {
    // Propagate state forward if this isn't dead. Note that the "can fall
    // through" flag does not imply "must fall through". The body may have
    // an embedded "break" inside an if statement, for example.
    if (cases[i].status !== alwaysDead) {
      for (let j = i + 1; j < cases.length && cases[j - 1].canFallThrough; j++) {
        cases[j].status = livenessUnknown;
      }
    } else if (maxStatus > alwaysDead && stmtsCareAboutScope(sCases[i].body)) {
      // Since adjacent cases share a scope, dead cases can potentially still
      // affect other cases that are live. Consider the following:
      //
      //   globalThis.foo = true
      //   switch (1) {
      //     case 0:
      //       let foo
      //     case 1:
      //       return foo
      //   }
      //
      // This code is supposed to throw a ReferenceError. But if we treat the
      // first case as dead code, then "let foo" will end up being removed and
      // the code will incorrectly return true instead.
      cases[i].status = livenessUnknown;
    }
  }
  return cases;
}

// Check for potential fall-through by checking for a jump at the end of the body
export function caseBodyCouldHaveFallThrough(stmts) {
  while (stmts.length > 0) {
    const s = stmts[stmts.length - 1].data;
    switch (s.k) {
      case S_BLOCK:
        stmts = s.stmts; // If this ends with a block, check the block's body next
        continue;
      case S_BREAK:
      case S_CONTINUE:
      case S_RETURN:
      case S_THROW:
        return false;
    }
    break;
  }
  return true;
}

export const bloomFilterSize = 251;

export class duplicateCaseChecker {
                       
                           
  constructor() {
    this.cases = []; // []duplicateCaseValue
    this.bloomFilter = new Uint8Array((bloomFilterSize + 7) >> 3);
  }

  reset() {
    // Preserve capacity
    this.cases.length = 0;

    // Note: Go does "bytes := dc.bloomFilter" (a copy of the array value) and
    // zeroes the copy, so the real bloom filter is never cleared. Stale bits
    // only cause an extra scan of "cases", so we match Go and leave it alone.
  }

  check(p, expr) {
    const $d160 = duplicateCaseHash(expr);
    const hash = $d160[0], ok = $d160[1];
    if (ok) {
      const bucket = hash % bloomFilterSize;
      const index = bucket >>> 3;
      const mask = 1 << (bucket & 7);

      // Check for collisions
      if ((this.bloomFilter[index] & mask) !== 0) {
        for (let $i54 = 0, $a54 = this.cases; $i54 < $a54.length; $i54++) {
          const c = $a54[$i54];
          if (c.hash === hash) {
            const $d161 = duplicateCaseEquals(c.value, expr);
            const equals = $d161[0], couldBeIncorrect = $d161[1];
            if (equals) {
              let laterRange;
              let earlierRange;
              if (expr.data instanceof EString) {
                laterRange = p.source.rangeOfString(expr.loc);
              } else {
                laterRange = p.source.rangeOfOperatorBefore(expr.loc, "case");
              }
              if (c.value.data instanceof EString) {
                earlierRange = p.source.rangeOfString(c.value.loc);
              } else {
                earlierRange = p.source.rangeOfOperatorBefore(c.value.loc, "case");
              }
              let text = "This case clause will never be evaluated because it duplicates an earlier case clause";
              if (couldBeIncorrect) {
                text = "This case clause may never be evaluated because it likely duplicates an earlier case clause";
              }
              let kind = Warning;
              if (p.suppressWarningsAboutWeirdCode) {
                kind = Debug;
              }
              p.log.addIDWithNotes(MsgID_JS_DuplicateCase, kind, p.tracker, laterRange, text, [p.tracker.msgData(earlierRange, "The earlier case clause is here:")]);
            }
            return;
          }
        }
      }

      this.bloomFilter[index] |= mask;
      this.cases.push(new duplicateCaseValue(expr, hash));
    }
  }
}

// Scratch space for math.Float64bits
const float64Bits = new DataView(new ArrayBuffer(8));

// Returns [hash (uint32), ok]
export function duplicateCaseHash(expr) {
  const e = expr.data;
  switch (e.k) {
    case E_INLINED_ENUM:
      return duplicateCaseHash(e.value);

    case E_NULL:
      return [0, true];

    case E_UNDEFINED:
      return [1, true];

    case E_BOOLEAN:
      if (e.value) {
        return [hashCombine(2, 1), true];
      }
      return [hashCombine(2, 0), true];

    case E_NUMBER: {
      float64Bits.setFloat64(0, e.value, true);
      const lo = float64Bits.getUint32(0, true);
      const hi = float64Bits.getUint32(4, true);
      return [hashCombine(hashCombine(3, lo), hi), true];
    }

    case E_STRING: {
      // Iterates UTF-16 code units ([]uint16)
      let hash = 4;
      const value = e.value;
      for (let i = 0; i < value.length; i++) {
        hash = hashCombine(hash, value.charCodeAt(i));
      }
      return [hash, true];
    }

    case E_BIG_INT: {
      // Go iterates runes; BigInt literal text is always ASCII
      let hash = 5;
      const value = e.value;
      for (let i = 0; i < value.length; i++) {
        hash = hashCombine(hash, value.charCodeAt(i));
      }
      return [hash, true];
    }

    case E_IDENTIFIER:
      return [hashCombine(6, refInner(e.ref)), true];

    case E_DOT: {
      const $d162 = duplicateCaseHash(e.target);
      const target = $d162[0], ok = $d162[1];
      if (ok) {
        return [hashCombineString(hashCombine(7, target), e.name), true];
      }
      break;
    }

    case E_INDEX: {
      const $d163 = duplicateCaseHash(e.target);
      const target = $d163[0], ok = $d163[1];
      if (ok) {
        const $d164 = duplicateCaseHash(e.index);
        const index = $d164[0], ok2 = $d164[1];
        if (ok2) {
          return [hashCombine(hashCombine(8, target), index), true];
        }
      }
      break;
    }
  }

  return [0, false];
}

// Returns [equals, couldBeIncorrect]
export function duplicateCaseEquals(left, right) {
  if (right.data.k === E_INLINED_ENUM) {
    return duplicateCaseEquals(left, right.data.value);
  }

  const a = left.data;
  const b = right.data;
  switch (a.k) {
    case E_INLINED_ENUM:
      return duplicateCaseEquals(a.value, right);

    case E_NULL:
      return [b.k === E_NULL, false];

    case E_UNDEFINED:
      return [b.k === E_UNDEFINED, false];

    case E_BOOLEAN:
      return [b.k === E_BOOLEAN && a.value === b.value, false];

    case E_NUMBER:
      return [b.k === E_NUMBER && a.value === b.value, false];

    case E_STRING:
      return [b.k === E_STRING && a.value === b.value, false];

    case E_BIG_INT:
      if (b.k === E_BIG_INT) {
        const $d165 = checkEqualityBigInt(a.value, b.value);
        const equal = $d165[0], ok = $d165[1];
        return [ok && equal, false];
      }
      break;

    case E_IDENTIFIER:
      return [b.k === E_IDENTIFIER && a.ref === b.ref, false];

    case E_DOT:
      if (b.k === E_DOT && a.optionalChain === b.optionalChain && a.name === b.name) {
        const $d166 = duplicateCaseEquals(a.target, b.target);
        const equals = $d166[0];
        return [equals, true];
      }
      break;

    case E_INDEX:
      if (b.k === E_INDEX && a.optionalChain === b.optionalChain) {
        const $d167 = duplicateCaseEquals(a.index, b.index);
        const indexEquals = $d167[0];
        if (indexEquals) {
          const $d168 = duplicateCaseEquals(a.target, b.target);
          const equals = $d168[0];
          return [equals, true];
        }
      }
      break;
  }

  return [false, false];
}

export function isJumpStatement(data) {
  switch (data.k) {
    case S_BREAK:
    case S_CONTINUE:
    case S_RETURN:
    case S_THROW:
      return true;
  }

  return false;
}

export function jumpStmtsLookTheSame(left, right) {
  const a = left;
  const b = right;
  switch (a.k) {
    case S_BREAK:
      return b.k === S_BREAK && (a.label === null) === (b.label === null) && (a.label === null || a.label.ref === b.label.ref);

    case S_CONTINUE:
      return b.k === S_CONTINUE && (a.label === null) === (b.label === null) && (a.label === null || a.label.ref === b.label.ref);

    case S_RETURN:
      return (
        b.k === S_RETURN &&
        (a.valueOrNil === null) === (b.valueOrNil === null) &&
        (a.valueOrNil === null || valuesLookTheSame(a.valueOrNil.data, b.valueOrNil.data))
      );

    case S_THROW:
      return b.k === S_THROW && valuesLookTheSame(a.value.data, b.value.data);
  }

  return false;
}

// ---------------------------------------------------------------------------
// js_parser.go lines 8657-10392: package-level functions

// During the visit pass Go consumes "p.scopesInOrder" from the front with
// "p.scopesInOrder = p.scopesInOrder[1:]" on every pushScopeForVisitPass.
// Copying a JS array for each scope would be O(n^2), so pushScopeForVisitPass
// stores an immutable (array, start) view instead. It supports the Go slice
// operations used on "p.scopesInOrder" during the visit pass: "len(x)" via
// ".length" and "x[n:]" via ".slice(n)". The underlying arrays (including the
// ones stored in "p.scopesInOrderForEnum") are never mutated.
export class scopeOrderSlice {
  ;                  
  ;                  
  constructor(array, start) {
    this.array = array; // []scopeOrder
    this.start = start;
  }
  get length() {
    return this.array.length - this.start;
  }
  slice(start, end) {
    if (end !== undefined) {
      return this.array.slice(this.start + start, this.start + end);
    }
    if (start < 0 || this.start + start > this.array.length) throw new GoPanic("runtime error: slice bounds out of range [" + (this.start + start) + ":" + this.array.length + "]");
    return new scopeOrderSlice(this.array, this.start + start);
  }
}

export function findIdentifiers(binding, identifiers) {
  const b = binding.data;
  switch (b.k) {
    case B_IDENTIFIER:
      identifiers.push(new Decl(binding, null));
      break;

    case B_ARRAY:
      for (let $i55 = 0, $a55 = b.items; $i55 < $a55.length; $i55++) {
        const item = $a55[$i55];
        identifiers = findIdentifiers(item.binding, identifiers);
      }
      break;

    case B_OBJECT:
      for (let $i56 = 0, $a56 = b.properties; $i56 < $a56.length; $i56++) {
        const property = $a56[$i56];
        identifiers = findIdentifiers(property.value, identifiers);
      }
      break;
  }

  return identifiers;
}

export function shouldKeepStmtsInDeadControlFlow(stmts) {
  for (const child of stmts) {
    if (shouldKeepStmtInDeadControlFlow(child)) {
      return true;
    }
  }
  return false;
}

// If this is in a dead branch, then we want to trim as much dead code as we
// can. Everything can be trimmed except for hoisted declarations ("var" and
// "function"), which affect the parent scope. For example:
//
//	function foo() {
//	  if (false) { var x; }
//	  x = 1;
//	}
//
// We can't trim the entire branch as dead or calling foo() will incorrectly
// assign to a global variable instead.
export function shouldKeepStmtInDeadControlFlow(stmt) {
  const s = stmt.data;
  switch (s.k) {
    case S_EMPTY:
    case S_EXPR:
    case S_THROW:
    case S_RETURN:
    case S_BREAK:
    case S_CONTINUE:
    case S_CLASS:
    case S_DEBUGGER:
      // Omit these statements entirely
      return false;

    case S_LOCAL: {
      if (s.kind !== LocalVar) {
        // Omit these statements entirely
        return false;
      }

      // Omit everything except the identifiers
      let identifiers = [];
      for (let $i57 = 0, $a57 = s.decls; $i57 < $a57.length; $i57++) {
        const decl = $a57[$i57];
        identifiers = findIdentifiers(decl.binding, identifiers);
      }
      if (identifiers.length === 0) {
        return false;
      }
      s.decls = identifiers;
      return true;
    }

    case S_BLOCK:
      return shouldKeepStmtsInDeadControlFlow(s.stmts);

    case S_TRY:
      return (
        shouldKeepStmtsInDeadControlFlow(s.block.stmts) ||
        (s.catch !== null && shouldKeepStmtsInDeadControlFlow(s.catch.block.stmts)) ||
        (s.finally !== null && shouldKeepStmtsInDeadControlFlow(s.finally.block.stmts))
      );

    case S_IF:
      return shouldKeepStmtInDeadControlFlow(s.yes) || (s.noOrNil !== null && shouldKeepStmtInDeadControlFlow(s.noOrNil));

    case S_WHILE:
      return shouldKeepStmtInDeadControlFlow(s.body);

    case S_DO_WHILE:
      return shouldKeepStmtInDeadControlFlow(s.body);

    case S_FOR:
      return (s.initOrNil !== null && shouldKeepStmtInDeadControlFlow(s.initOrNil)) || shouldKeepStmtInDeadControlFlow(s.body);

    case S_FOR_IN:
      return shouldKeepStmtInDeadControlFlow(s.init) || shouldKeepStmtInDeadControlFlow(s.body);

    case S_FOR_OF:
      return shouldKeepStmtInDeadControlFlow(s.init) || shouldKeepStmtInDeadControlFlow(s.body);

    case S_LABEL:
      return shouldKeepStmtInDeadControlFlow(s.stmt);

    default:
      // Everything else must be kept
      return true;
  }
}

// One statement could potentially expand to several statements
export function stmtsToSingleStmt(loc, stmts, closeBraceLoc) {
  if (stmts.length === 0) {
    return new Stmt(SEmptyShared, loc);
  }
  if (stmts.length === 1 && !stmtCaresAboutScope(stmts[0])) {
    return stmts[0];
  }
  return new Stmt(new SBlock(stmts, closeBraceLoc), loc);
}

export function stmtCaresAboutScope(stmt) {
  const s = stmt.data;
  switch (s.k) {
    case S_BLOCK:
    case S_EMPTY:
    case S_DEBUGGER:
    case S_EXPR:
    case S_IF:
    case S_FOR:
    case S_FOR_IN:
    case S_FOR_OF:
    case S_DO_WHILE:
    case S_WHILE:
    case S_WITH:
    case S_TRY:
    case S_SWITCH:
    case S_RETURN:
    case S_THROW:
    case S_BREAK:
    case S_CONTINUE:
    case S_DIRECTIVE:
    case S_LABEL:
      return false;

    case S_LOCAL:
      return s.kind !== LocalVar;

    default:
      return true;
  }
}

export function stmtsCareAboutScope(stmts) {
  for (const stmt of stmts) {
    if (stmtCaresAboutScope(stmt)) {
      return true;
    }
  }
  return false;
}

export function dropFirstStatement(body, replaceOrNil) {
  const block = body.data;
  if (block.k === S_BLOCK && block.stmts.length > 0) {
    if (replaceOrNil !== null) {
      block.stmts[0] = replaceOrNil;
    } else if (block.stmts.length === 2 && !stmtCaresAboutScope(block.stmts[1])) {
      return block.stmts[1];
    } else {
      block.stmts = block.stmts.slice(1);
    }
    return body;
  }
  if (replaceOrNil !== null) {
    return replaceOrNil;
  }
  return new Stmt(SEmptyShared, body.loc);
}

// (Only reachable with MinifySyntax)
export function mangleFor(s) {
  // Get the first statement in the loop
  let first = s.body;
  if (first.data.k === S_BLOCK && first.data.stmts.length > 0) {
    first = first.data.stmts[0];
  }

  if (first.data.k === S_IF) {
    const ifS = first.data;

    // "for (;;) if (x) break;" => "for (; !x;) ;"
    // "for (; a;) if (x) break;" => "for (; a && !x;) ;"
    // "for (;;) if (x) break; else y();" => "for (; !x;) y();"
    // "for (; a;) if (x) break; else y();" => "for (; a && !x;) y();"
    if (ifS.yes.data.k === S_BREAK && ifS.yes.data.label === null) {
      let not_;
      if (ifS.test.data.k === E_UNARY && ifS.test.data.op === UnOpNot) {
        not_ = ifS.test.data.value;
      } else {
        not_ = not(ifS.test);
      }
      if (s.testOrNil !== null) {
        s.testOrNil = new Expr(new EBinary(s.testOrNil, not_, BinOpLogicalAnd), s.testOrNil.loc);
      } else {
        s.testOrNil = not_;
      }
      s.body = dropFirstStatement(s.body, ifS.noOrNil);
      return;
    }

    // "for (;;) if (x) y(); else break;" => "for (; x;) y();"
    // "for (; a;) if (x) y(); else break;" => "for (; a && x;) y();"
    if (ifS.noOrNil !== null) {
      if (ifS.noOrNil.data.k === S_BREAK && ifS.noOrNil.data.label === null) {
        if (s.testOrNil !== null) {
          s.testOrNil = new Expr(new EBinary(s.testOrNil, ifS.test, BinOpLogicalAnd), s.testOrNil.loc);
        } else {
          s.testOrNil = ifS.test;
        }
        s.body = dropFirstStatement(s.body, ifS.yes);
        return;
      }
    }
  }
}

// Appends to "stmts" (like Go's append) and returns it
export function appendIfOrLabelBodyPreservingScope(stmts, body) {
  const block = body.data;
  if (block.k === S_BLOCK && !stmtsCareAboutScope(block.stmts)) {
    for (const stmt of block.stmts) stmts.push(stmt);
    return stmts;
  }
  if (stmtCaresAboutScope(body)) {
    stmts.push(new Stmt(new SBlock([body]), body.loc));
    return stmts;
  }
  stmts.push(body);
  return stmts;
}

// Shared "bindingOpts{}" (visitBinding never mutates opts itself)
const bindingOptsDefault = Object.freeze(new bindingOpts());

// Shared exprIn values (visitExprInOut never mutates its exprIn argument)
const exprInAssignTargetNone = Object.freeze(new exprIn(false, false, false, false, false, AssignTargetNone));
const exprInAssignTargetReplace = Object.freeze(new exprIn(false, false, false, false, false, AssignTargetReplace));
const exprInShouldMangleStringsAsProps = Object.freeze(new exprIn(false, false, false, false, true));

// keyKind (local type of warnAboutDuplicateProperties)
const keyMissing = 0;
const keyNormal = 1;
const keyGet = 2;
const keySet = 3;
const keyGetAndSet = 4;

// ---------------------------------------------------------------------------
// *parser methods

export const visitStmtMethods = {
  // js_parser.go line 1043
  warnAboutDuplicateProperties(properties, in_) {
    const p = this;
    if (properties.length < 2) {
      return;
    }

    // Go stores an "existingKey{loc, kind}"; the loc only feeds the message
    // text (never materialised, see logger.mjs), so only the kind is kept.
    const instanceKeys = new Map();
    const staticKeys = new Map();

    for (const property of properties) {
      if (property.kind !== PropertySpread) {
        if (property.key !== null && property.key.data.k === E_STRING) {
          const str = property.key.data;
          let keys;
          if ((property.flags & PropertyIsStatic) !== 0) {
            keys = staticKeys;
          } else {
            keys = instanceKeys;
          }
          const key = str.value;
          // (JS-only: Go's existingKey {kind, loc} packed into one number)
          const prevKey = keys.get(key) ?? keyMissing;
          const prevKind = prevKey % 8;
          let nextKind = keyNormal;

          if (property.kind === PropertyGetter) {
            nextKind = keyGet;
          } else if (property.kind === PropertySetter) {
            nextKind = keySet;
          }

          if (
            prevKind !== keyMissing &&
            (in_ !== duplicatePropertiesInObject || key !== "__proto__") &&
            (in_ !== duplicatePropertiesInClass || key !== "constructor")
          ) {
            if ((prevKind === keyGet && nextKind === keySet) || (prevKind === keySet && nextKind === keyGet)) {
              nextKind = keyGetAndSet;
            } else {
              let id = 0;
              let what = "";
              let where = "";
              switch (in_) {
                case duplicatePropertiesInObject:
                  id = MsgID_JS_DuplicateObjectKey;
                  what = "key";
                  where = "object literal";
                  break;
                case duplicatePropertiesInClass:
                  id = MsgID_JS_DuplicateClassMember;
                  what = "member";
                  where = "class body";
                  break;
              }
              const r = rangeOfIdentifier(p.source, property.key.loc);
              p.log.addIDWithNotes(id, Warning, p.tracker, r, "Duplicate " + what + " " + goQuote(key) + " in " + where, [
                p.tracker.msgData(rangeOfIdentifier(p.source, Math.floor(prevKey / 8)), "The original " + what + " " + goQuote(key) + " is here:"),
              ]);
            }
          }

          keys.set(key, nextKind + property.key.loc * 8);
        }
      }
    }
  },

  pushScopeForVisitPass(kind, loc) {
    const p = this;

    // See "scopeOrderSlice" above: "p.scopesInOrder" is either a plain array
    // (from the parse pass or "p.scopesInOrderForEnum") or a scopeOrderSlice.
    let array = p.scopesInOrder;
    let start = 0;
    if (array instanceof scopeOrderSlice) {
      start = array.start;
      array = array.array;
    }
    if (array === null || array === undefined || start >= array.length) {
      goIndexOutOfRange(0, 0);
    }
    const order = array[start];

    // Sanity-check that the scopes generated by the first and second passes match
    if (order.loc !== loc || order.scope.kind !== kind) {
      throw new GoPanic("Expected scope (" + kind + ", " + loc + ") in " + goQuote(p.source.prettyPaths.select(p.options.logPathStyle)) + ", found scope (" + order.scope.kind + ", " + order.loc + ")");
    }

    p.scopesInOrder = new scopeOrderSlice(array, start + 1);
    p.currentScope = order.scope;

    const part = p.currentPart;
    if (part !== null) {
      part.scopes.push(order.scope);
    }
  },

  findSymbol(loc, name) {
    const p = this;
    let ref = 0; // Go zero value of ast.Ref
    let declareLoc = 0;
    let isInsideWithScope = false;
    let didForbidArguments = false;
    let s = p.currentScope;

    for (;;) {
      // Track if we're inside a "with" statement body
      if (s.kind === ScopeWith) {
        isInsideWithScope = true;
      }

      // Forbid referencing "arguments" inside class bodies
      if (s.forbidArguments && name === "arguments" && !didForbidArguments) {
        const r = rangeOfIdentifier(p.source, loc);
        p.log.addError(p.tracker, r, "Cannot access " + goQuote(name) + " here:");
        didForbidArguments = true;
      }

      // Is the symbol a member of this scope?
      const member = s.members.get(name);
      if (member !== undefined) {
        ref = member.ref;
        declareLoc = member.loc;
        break;
      }

      // Is the symbol a member of this scope's TypeScript namespace?
      const tsNamespace = s.tsNamespace;
      if (tsNamespace !== null) {
        const nsMember = tsNamespace.exportedMembers.get(name);
        if (nsMember !== undefined && tsNamespace.isEnumScope === nsMember.isEnumValue) {
          // If this is an identifier from a sibling TypeScript namespace, then we're
          // going to have to generate a property access instead of a simple reference.
          // Lazily-generate an identifier that represents this property access.
          let cache = tsNamespace.lazilyGeneratedProperyAccesses;
          if (cache === null) {
            cache = new Map();
            tsNamespace.lazilyGeneratedProperyAccesses = cache;
          }
          const cached = cache.get(name);
          if (cached !== undefined) {
            ref = cached;
          } else {
            ref = p.newSymbol(SymbolOther, name);
            p.symbols[refInner(ref)].namespaceAlias = new NamespaceAlias(name, tsNamespace.argRef);
            cache.set(name, ref);
          }
          declareLoc = nsMember.loc;
          break;
        }
      }

      s = s.parent;
      if (s === null) {
        // Allocate an "unbound" symbol
        p.checkForUnrepresentableIdentifier(loc, name);
        ref = p.newSymbol(SymbolUnbound, name);
        declareLoc = loc;
        p.moduleScope.members.set(name, new ScopeMember(ref, -1));
        break;
      }
    }

    // If we had to pass through a "with" statement body to get to the symbol
    // declaration, then this reference could potentially also refer to a
    // property on the target object of the "with" statement. We must not rename
    // it or we risk changing the behavior of the code.
    if (isInsideWithScope) {
      p.symbols[refInner(ref)].flags |= MustNotBeRenamed;
    }

    // Track how many times we've referenced this symbol
    p.recordUsage(ref);
    // (JS-only: the result object is reused; callers read it right away)
    let result = p.findSymbolScratch;
    if (result === null) result = p.findSymbolScratch = new findSymbolResult();
    result.ref = ref;
    result.declareLoc = declareLoc;
    result.isInsideWithScope = isInsideWithScope;
    return result;
  },

  // Returns [ref, isLoop, ok]
  findLabelSymbol(loc, name) {
    const p = this;
    for (let s = p.currentScope; s !== null && !scopeKindStopsHoisting(s.kind); s = s.parent) {
      if (s.kind === ScopeLabel && name === p.symbols[refInner(s.label.ref)].originalName) {
        // Track how many times we've referenced this symbol
        p.recordUsage(s.label.ref);
        return [s.label.ref, s.labelStmtIsLoop, true];
      }
    }

    const r = rangeOfIdentifier(p.source, loc);
    p.log.addError(p.tracker, r, "There is no containing label named " + goQuote(name));

    // Allocate an "unbound" symbol
    const ref = p.newSymbol(SymbolUnbound, name);

    // Track how many times we've referenced this symbol
    p.recordUsage(ref);
    return [ref, false, false];
  },

  visitStmtsAndPrependTempRefs(stmts, opts) {
    const p = this;
    const oldTempRefs = p.tempRefsToDeclare;
    const oldTempRefCount = p.tempRefCount;
    p.tempRefsToDeclare = [];
    p.tempRefCount = 0;

    stmts = p.visitStmts(stmts, opts.kind);

    // Prepend values for "this" and "arguments"
    if (opts.fnBodyLoc !== null) {
      // Capture "this"
      const thisRef = p.fnOnlyDataVisit.thisCaptureRef;
      if (thisRef !== null) {
        p.tempRefsToDeclare.push(new tempRef(new Expr(EThisShared, opts.fnBodyLoc), thisRef));
        p.currentScope.generated.push(thisRef);
      }

      // Capture "arguments"
      const argumentsRef = p.fnOnlyDataVisit.argumentsCaptureRef;
      if (argumentsRef !== null) {
        p.tempRefsToDeclare.push(new tempRef(new Expr(new EIdentifier(p.fnOnlyDataVisit.argumentsRef), opts.fnBodyLoc), argumentsRef));
        p.currentScope.generated.push(argumentsRef);
      }
    }

    // There may also be special top-level-only temporaries to declare
    // (Go: "!= nil"; appending an empty slice is a no-op so a length check is equivalent)
    if (p.currentScope === p.moduleScope && p.topLevelTempRefsToDeclare !== null && p.topLevelTempRefsToDeclare.length > 0) {
      for (const temp of p.topLevelTempRefsToDeclare) {
        p.tempRefsToDeclare.push(temp);
      }
      p.topLevelTempRefsToDeclare = [];
    }

    // Prepend the generated temporary variables to the beginning of the statement list
    const decls = [];
    for (const temp of p.tempRefsToDeclare) {
      if (p.symbols[refInner(temp.ref)].useCountEstimate > 0) {
        decls.push(new Decl(new Binding(new BIdentifier(temp.ref), 0), temp.valueOrNil));
        p.recordDeclaredSymbol(temp.ref);
      }
    }
    if (decls.length > 0) {
      // Skip past leading directives and comments
      let split = 0;
      while (split < stmts.length) {
        const k = stmts[split].data.k;
        if (k === S_COMMENT || k === S_DIRECTIVE) {
          split++;
          continue;
        }
        break;
      }
      const result = stmts.slice(0, split);
      result.push(new Stmt(new SLocal(decls, LocalVar), 0));
      for (let i = split; i < stmts.length; i++) {
        result.push(stmts[i]);
      }
      stmts = result;
    }

    p.tempRefsToDeclare = oldTempRefs;
    p.tempRefCount = oldTempRefCount;
    return stmts;
  },

  visitStmts(stmts, kind) {
    const p = this;

    // Save the current control-flow liveness. This represents if we are
    // currently inside an "if (false) { ... }" block.
    const oldIsControlFlowDead = p.isControlFlowDead;

    const oldTempLetsToDeclare = p.tempLetsToDeclare;
    p.tempLetsToDeclare = [];

    // Visit all statements first
    const n = stmts.length;
    let visited = [];
    let before = [];
    let after = [];
    let preprocessedEnums = null; // Map<number, Stmt[]>
    // (Go: "!= nil". The map is only ever created right before an insertion
    // and entries are never deleted, so "size > 0" is equivalent.)
    const scopesInOrderForEnum = p.scopesInOrderForEnum;
    if (scopesInOrderForEnum !== null && scopesInOrderForEnum.size > 0) {
      // Preprocess TypeScript enums to improve code generation. Otherwise
      // uses of an enum before that enum has been declared won't be inlined:
      //
      //   console.log(Foo.FOO) // We want "FOO" to be inlined here
      //   const enum Foo { FOO = 0 }
      //
      // The TypeScript compiler itself contains code with this pattern, so
      // it's important to implement this optimization.
      for (let i = 0; i < n; i++) {
        const stmt = stmts[i];
        if (stmt.data.k === S_ENUM) {
          if (preprocessedEnums === null) {
            preprocessedEnums = new Map();
          }
          const oldScopesInOrder = p.scopesInOrder;
          p.scopesInOrder = scopesInOrderForEnum.get(stmt.loc) ?? null;
          preprocessedEnums.set(i, p.visitAndAppendStmt([], stmt));
          p.scopesInOrder = oldScopesInOrder;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const stmt = stmts[i];
      const s = stmt.data;
      switch (s.k) {
        case S_EXPORT_EQUALS:
          // TypeScript "export = value;" becomes "module.exports = value;". This
          // must happen at the end after everything is parsed because TypeScript
          // moves this statement to the end when it generates code.
          after = p.visitAndAppendStmt(after, stmt);
          continue;

        case S_FUNCTION:
          // Manually hoist block-level function declarations to preserve semantics.
          // This is only done for function declarations that are not generators
          // or async functions, since this is a backwards-compatibility hack from
          // Annex B of the JavaScript standard.
          if (!scopeKindStopsHoisting(p.currentScope.kind) && p.symbols[refInner(s.fn.name.ref)].kind === SymbolHoistedFunction) {
            before = p.visitAndAppendStmt(before, stmt);
            continue;
          }
          break;

        case S_ENUM: {
          const pre = preprocessedEnums !== null ? preprocessedEnums.get(i) : undefined;
          if (pre !== undefined) {
            for (const x of pre) {
              visited.push(x);
            }
          }
          const enumScopes = scopesInOrderForEnum !== null ? scopesInOrderForEnum.get(stmt.loc) : undefined;
          p.scopesInOrder = p.scopesInOrder.slice(enumScopes !== undefined ? enumScopes.length : 0);
          continue;
        }
      }
      visited = p.visitAndAppendStmt(visited, stmt);
    }

    // This is used for temporary variables that could be captured in a closure,
    // and therefore need to be generated inside the nearest enclosing block in
    // case they are generated inside a loop.
    if (p.tempLetsToDeclare.length > 0) {
      const decls = [];
      for (const ref of p.tempLetsToDeclare) {
        decls.push(new Decl(new Binding(new BIdentifier(ref), 0), null));
      }
      before.push(new Stmt(new SLocal(decls, LocalLet), 0));
    }
    p.tempLetsToDeclare = oldTempLetsToDeclare;

    // Transform block-level function declarations into variable declarations
    if (before.length > 0) {
      const letDecls = [];
      const varDecls = [];
      const nonFnStmts = [];
      const fnStmts = new Map(); // map[ast.Ref]int
      const hoistedRefForSloppyModeBlockFn = p.hoistedRefForSloppyModeBlockFn;
      for (const stmt of before) {
        if (stmt.data.k !== S_FUNCTION) {
          // We may get non-function statements here in certain scenarios such as when "KeepNames" is enabled
          nonFnStmts.push(stmt);
          continue;
        }
        const s = stmt.data;

        // This transformation of function declarations in nested scopes is
        // intended to preserve the hoisting semantics of the original code. In
        // JavaScript, function hoisting works differently in strict mode vs.
        // sloppy mode code. We want the code we generate to use the semantics of
        // the original environment, not the generated environment. However, if
        // direct "eval" is present then it's not possible to preserve the
        // semantics because we need two identifiers to do that and direct "eval"
        // means neither identifier can be renamed to something else. So in that
        // case we give up and do not preserve the semantics of the original code.
        if (p.currentScope.containsDirectEval) {
          const hoistedRef = hoistedRefForSloppyModeBlockFn !== null ? hoistedRefForSloppyModeBlockFn.get(s.fn.name.ref) : undefined;
          if (hoistedRef !== undefined) {
            // Merge the two identifiers back into a single one
            p.symbols[refInner(hoistedRef)].link = s.fn.name.ref;
          }
          nonFnStmts.push(stmt);
          continue;
        }

        let index = fnStmts.get(s.fn.name.ref);
        if (index === undefined) {
          index = letDecls.length;
          fnStmts.set(s.fn.name.ref, index);
          letDecls.push(new Decl(new Binding(new BIdentifier(s.fn.name.ref), s.fn.name.loc), null));

          // Also write the function to the hoisted sibling symbol if applicable
          const hoistedRef = hoistedRefForSloppyModeBlockFn !== null ? hoistedRefForSloppyModeBlockFn.get(s.fn.name.ref) : undefined;
          if (hoistedRef !== undefined) {
            p.recordDeclaredSymbol(hoistedRef);
            p.recordUsage(s.fn.name.ref);
            varDecls.push(
              new Decl(new Binding(new BIdentifier(hoistedRef), s.fn.name.loc), new Expr(new EIdentifier(s.fn.name.ref), s.fn.name.loc)),
            );
          }
        }

        // The last function statement for a given symbol wins
        s.fn.name = null;
        letDecls[index].valueOrNil = new Expr(new EFunction(s.fn.clone()), stmt.loc); // Go copies the Fn struct
      }

      // Reuse memory from "before"
      before = [];
      let localKind = LocalLet;
      if (jsFeatureHas(p.options.unsupportedJSFeatures, ConstAndLet)) {
        localKind = LocalVar;
      }
      if (letDecls.length > 0) {
        before.push(new Stmt(new SLocal(letDecls, localKind), letDecls[0].valueOrNil.loc));
      }
      if (varDecls.length > 0) {
        // Potentially relocate "var" declarations to the top level
        const $r = p.maybeRelocateVarsToTopLevel(varDecls, relocateVarsNormal);
        if ($r[1]) {
          if ($r[0] !== null) {
            before.push($r[0]);
          }
        } else {
          before.push(new Stmt(new SLocal(varDecls, LocalVar), varDecls[0].valueOrNil.loc));
        }
      }
      for (const stmt of nonFnStmts) {
        before.push(stmt);
      }
      for (const stmt of visited) {
        before.push(stmt);
      }
      visited = before;
    }

    // Move TypeScript "export =" statements to the end
    for (const stmt of after) {
      visited.push(stmt);
    }

    // Restore the current control-flow liveness if it was changed inside the
    // loop above. This is important because the caller will not restore it.
    p.isControlFlowDead = oldIsControlFlowDead;

    // Lower using declarations
    if (p.shouldLowerUsingDeclarations(visited)) {
      const ctx = p.lowerUsingDeclarationContext();
      ctx.scanStmts(p, visited);
      visited = ctx.finalize(p, visited, p.currentScope.parent === null);
    }

    // Stop now if we're not mangling
    if (!p.options.minifySyntax) {
      return visited;
    }

    // (Everything below is only reachable with MinifySyntax)

    // If this is in a dead branch, trim as much dead code as we can
    if (p.isControlFlowDead) {
      let end = 0;
      for (let i = 0; i < visited.length; i++) {
        const stmt = visited[i];
        if (!shouldKeepStmtInDeadControlFlow(stmt)) {
          continue;
        }

        // Merge adjacent var statements
        const s = stmt.data;
        if (s.k === S_LOCAL && s.kind === LocalVar && end > 0) {
          const prevS = visited[end - 1].data;
          if (prevS.k === S_LOCAL && prevS.kind === LocalVar && s.isExport === prevS.isExport) {
            prevS.decls = prevS.decls.concat(s.decls);
            continue;
          }
        }

        visited[end] = stmt;
        end++;
      }
      visited.length = end;
      return visited;
    }

    return p.mangleStmts(visited, kind);
  },

  // (Only reachable with MinifySyntax: visitStmts returns before calling this
  // and the only other caller is guarded by "p.options.minifySyntax" too.)
  mangleStmts(stmts, kind) {
    const p = this;

    // Remove inlined constants now that we know whether any of these statements
    // contained a direct eval() or not. This can't be done earlier when we
    // encounter the constant because we haven't encountered the eval() yet.
    // Inlined constants are not removed if they are in a top-level scope or
    // if they are exported (which could be in a nested TypeScript namespace).
    if (p.currentScope.parent !== null && !p.currentScope.containsDirectEval) {
      for (let i = 0; i < stmts.length; i++) {
        const s = stmts[i].data;
        switch (s.k) {
          case S_EMPTY:
          case S_COMMENT:
          case S_DIRECTIVE:
          case S_DEBUGGER:
          case S_TYPESCRIPT:
            continue;

          case S_LOCAL:
            if (!s.isExport) {
              let end = 0;
              const decls = s.decls;
              for (let j = 0; j < decls.length; j++) {
                const d = decls[j];
                if (d.binding.data.k === B_IDENTIFIER) {
                  const id = d.binding.data;
                  if (p.constValues !== null && p.constValues.has(id.ref) && p.symbols[refInner(id.ref)].useCountEstimate === 0) {
                    continue;
                  }
                }
                decls[end] = d;
                end++;
              }
              if (end === 0) {
                stmts[i] = new Stmt(SEmptyShared, stmts[i].loc);
              } else {
                s.decls = decls.slice(0, end);
              }
            }
            continue;
        }
        break;
      }
    }

    // Merge adjacent statements during mangling
    let result = [];
    let isControlFlowDead = false;
    for (let i = 0; i < stmts.length; i++) {
      let stmt = stmts[i];
      if (isControlFlowDead && !shouldKeepStmtInDeadControlFlow(stmt)) {
        // Strip unnecessary statements if the control flow is dead here
        continue;
      }

      // Inline single-use variable declarations where possible:
      //
      //   // Before
      //   let x = fn();
      //   return x.y();
      //
      //   // After
      //   return fn().y();
      //
      // The declaration must not be exported. We can't just check for the
      // "export" keyword because something might do "export {id};" later on.
      // Instead we just ignore all top-level declarations for now. That means
      // this optimization currently only applies in nested scopes.
      //
      // Ignore declarations if the scope is shadowed by a direct "eval" call.
      // The eval'd code may indirectly reference this symbol and the actual
      // use count may be greater than 1.
      if (p.currentScope !== p.moduleScope && !p.currentScope.containsDirectEval) {
        // Keep inlining variables until a failure or until there are none left.
        // That handles cases like this:
        //
        //   // Before
        //   let x = fn();
        //   let y = x.prop;
        //   return y;
        //
        //   // After
        //   return fn().prop;
        //
        while (result.length > 0) {
          // Ignore "var" declarations since those have function-level scope and
          // we may not have visited all of their uses yet by this point. We
          // should have visited all the uses of "let" and "const" declarations
          // by now since they are scoped to this block which we just finished
          // visiting.
          const prevS = result[result.length - 1].data;
          if (prevS.k === S_LOCAL && (prevS.kind === LocalLet || prevS.kind === LocalConst)) {
            const last = prevS.decls[prevS.decls.length - 1];

            // The binding must be an identifier that is only used once.
            // Ignore destructuring bindings since that's not the simple case.
            // Destructuring bindings could potentially execute side-effecting
            // code which would invalidate reordering.
            if (last.binding.data.k === B_IDENTIFIER) {
              const id = last.binding.data;

              // Don't do this if "__name" was called on this symbol. In that
              // case there is actually more than one use even though it says
              // there is only one. The "__name" use isn't counted so that
              // tree shaking still works when names are kept.
              const symbol = p.symbols[refInner(id.ref)];
              if (symbol.useCountEstimate === 1 && (symbol.flags & DidKeepName) === 0) {
                let replacement = last.valueOrNil;

                // The variable must be initialized, since we will be substituting
                // the value into the usage.
                if (replacement === null) {
                  replacement = new Expr(EUndefinedShared, last.binding.loc);
                }

                // Try to substitute the identifier with the initializer. This will
                // fail if something with side effects is in between the declaration
                // and the usage.
                if (p.substituteSingleUseSymbolInStmt(stmt, id.ref, replacement)) {
                  // Remove the previous declaration, since the substitution was
                  // successful.
                  if (prevS.decls.length === 1) {
                    result.pop();
                  } else {
                    prevS.decls = prevS.decls.slice(0, prevS.decls.length - 1);
                  }

                  // Loop back to try again
                  continue;
                }
              }
            }
          }

          // Substitution failed so stop trying
          break;
        }
      }

      const s = stmt.data;
      switch (s.k) {
        case S_EMPTY:
          // Strip empty statements
          continue;

        case S_LOCAL:
          // Merge adjacent local statements
          if (result.length > 0) {
            const prevS = result[result.length - 1].data;
            if (prevS.k === S_LOCAL && s.kind === prevS.kind && s.isExport === prevS.isExport) {
              prevS.decls = prevS.decls.concat(s.decls);
              continue;
            }
          }
          break;

        case S_EXPR:
          // Trim expressions without side effects
          s.value = p.astHelpers.simplifyUnusedExpr(s.value, p.options.unsupportedJSFeatures);
          if (s.value === null) {
            continue;
          }

          // Merge adjacent expression statements
          if (result.length > 0) {
            const prevS = result[result.length - 1].data;
            if (prevS.k === S_EXPR) {
              if (!s.isFromClassOrFnThatCanBeRemovedIfUnused) {
                prevS.isFromClassOrFnThatCanBeRemovedIfUnused = false;
              }
              prevS.value = joinWithComma(prevS.value, s.value);
              continue;
            }
          }
          break;

        case S_SWITCH:
          // Absorb a previous expression statement
          if (result.length > 0) {
            const prevS = result[result.length - 1].data;
            if (prevS.k === S_EXPR) {
              s.test = joinWithComma(prevS.value, s.test);
              result.pop();
            }
          }
          break;

        case S_IF: {
          let ifS = s;

          // Absorb a previous expression statement
          if (result.length > 0) {
            const prevS = result[result.length - 1].data;
            if (prevS.k === S_EXPR) {
              ifS.test = joinWithComma(prevS.value, ifS.test);
              result.pop();
            }
          }

          if (isJumpStatement(ifS.yes.data)) {
            let optimizeImplicitJump = false;

            // Absorb a previous if statement
            if (result.length > 0) {
              const prevS = result[result.length - 1].data;
              if (prevS.k === S_IF && prevS.noOrNil === null && jumpStmtsLookTheSame(prevS.yes.data, ifS.yes.data)) {
                // "if (a) break c; if (b) break c;" => "if (a || b) break c;"
                // "if (a) continue c; if (b) continue c;" => "if (a || b) continue c;"
                // "if (a) return c; if (b) return c;" => "if (a || b) return c;"
                // "if (a) throw c; if (b) throw c;" => "if (a || b) throw c;"
                ifS.test = joinWithLeftAssociativeOp(BinOpLogicalOr, prevS.test, ifS.test);
                result.pop();
              }
            }

            // "while (x) { if (y) continue; z(); }" => "while (x) { if (!y) z(); }"
            // "while (x) { if (y) continue; else z(); w(); }" => "while (x) { if (!y) { z(); w(); } }" => "for (; x;) !y && (z(), w());"
            if (kind === stmtsLoopBody) {
              if (ifS.yes.data.k === S_CONTINUE && ifS.yes.data.label === null) {
                optimizeImplicitJump = true;
              }
            }

            // "let x = () => { if (y) return; z(); };" => "let x = () => { if (!y) z(); };"
            // "let x = () => { if (y) return; else z(); w(); };" => "let x = () => { if (!y) { z(); w(); } };" => "let x = () => { !y && (z(), w()); };"
            if (kind === stmtsFnBody) {
              if (ifS.yes.data.k === S_RETURN && ifS.yes.data.valueOrNil === null) {
                optimizeImplicitJump = true;
              }
            }

            if (optimizeImplicitJump) {
              let body = [];
              if (ifS.noOrNil !== null) {
                body.push(ifS.noOrNil);
              }
              for (let j = i + 1; j < stmts.length; j++) {
                body.push(stmts[j]);
              }

              // Don't do this transformation if the branch condition could
              // potentially access symbols declared later on this scope below.
              // If so, inverting the branch condition and nesting statements after
              // this in a block would break that access which is a behavior change.
              //
              //   // This transformation is incorrect
              //   if (a()) return; function a() {}
              //   if (!a()) { function a() {} }
              //
              //   // This transformation is incorrect
              //   if (a(() => b)) return; let b;
              //   if (a(() => b)) { let b; }
              //
              if (!stmtsCareAboutScope(body)) {
                body = p.mangleStmts(body, kind);
                let bodyLoc = ifS.yes.loc;
                if (body.length > 0) {
                  bodyLoc = body[0].loc;
                }
                return p.mangleIf(result, stmt.loc, new SIf(p.astHelpers.simplifyBooleanExpr(not(ifS.test)), stmtsToSingleStmt(bodyLoc, body, 0)));
              }
            }

            if (ifS.noOrNil !== null) {
              // "if (a) return b; else if (c) return d; else return e;" => "if (a) return b; if (c) return d; return e;"
              for (;;) {
                result.push(stmt);
                stmt = ifS.noOrNil;
                ifS.noOrNil = null;
                ifS = stmt.data.k === S_IF ? stmt.data : null;
                if (ifS === null || !isJumpStatement(ifS.yes.data) || ifS.noOrNil === null) {
                  break;
                }
              }
              result = appendIfOrLabelBodyPreservingScope(result, stmt);
              if (isJumpStatement(stmt.data)) {
                isControlFlowDead = true;
              }
              continue;
            }
          }
          break;
        }

        case S_RETURN:
          // Merge return statements with the previous expression statement
          if (result.length > 0 && s.valueOrNil !== null) {
            const prevStmt = result[result.length - 1];
            const prevS = prevStmt.data;
            if (prevS.k === S_EXPR) {
              result[result.length - 1] = new Stmt(new SReturn(joinWithComma(prevS.value, s.valueOrNil)), prevStmt.loc);
              continue;
            }
          }

          isControlFlowDead = true;
          break;

        case S_THROW:
          // Merge throw statements with the previous expression statement
          if (result.length > 0) {
            const prevStmt = result[result.length - 1];
            const prevS = prevStmt.data;
            if (prevS.k === S_EXPR) {
              result[result.length - 1] = new Stmt(new SThrow(joinWithComma(prevS.value, s.value)), prevStmt.loc);
              continue;
            }
          }

          isControlFlowDead = true;
          break;

        case S_BREAK:
        case S_CONTINUE:
          isControlFlowDead = true;
          break;

        case S_FOR:
          if (result.length > 0) {
            const prevStmt = result[result.length - 1];
            const prevS = prevStmt.data;
            if (prevS.k === S_EXPR) {
              // Insert the previous expression into the for loop initializer
              if (s.initOrNil === null) {
                result[result.length - 1] = stmt;
                s.initOrNil = new Stmt(new SExpr(prevS.value), prevStmt.loc);
                continue;
              } else if (s.initOrNil.data.k === S_EXPR) {
                const s2 = s.initOrNil.data;
                result[result.length - 1] = stmt;
                s.initOrNil = new Stmt(new SExpr(joinWithComma(prevS.value, s2.value)), prevStmt.loc);
                continue;
              }
            } else {
              // Insert the previous variable declaration into the for loop
              // initializer if it's a "var" declaration, since the scope
              // doesn't matter due to scope hoisting
              if (s.initOrNil === null) {
                if (prevS.k === S_LOCAL && prevS.kind === LocalVar && !prevS.isExport) {
                  result[result.length - 1] = stmt;
                  s.initOrNil = prevStmt;
                  continue;
                }
              } else {
                if (prevS.k === S_LOCAL && prevS.kind === LocalVar && !prevS.isExport) {
                  const s3 = s.initOrNil.data;
                  if (s3.k === S_LOCAL && s3.kind === LocalVar) {
                    result[result.length - 1] = stmt;
                    s.initOrNil = new Stmt(new SLocal(prevS.decls.concat(s3.decls), LocalVar), s.initOrNil.loc);
                    continue;
                  }
                }
              }
            }
          }
          break;

        case S_TRY:
          // Drop an unused identifier binding if the optional catch binding feature is supported
          if (!jsFeatureHas(p.options.unsupportedJSFeatures, OptionalCatchBinding) && s.catch !== null) {
            if (s.catch.bindingOrNil !== null && s.catch.bindingOrNil.data.k === B_IDENTIFIER) {
              const id = s.catch.bindingOrNil.data;
              const symbol = p.symbols[refInner(id.ref)];
              if (symbol.useCountEstimate === 0) {
                if (symbol.link !== InvalidRef) {
                  // We cannot transform "try { x() } catch (y) { var y = 1 }" into
                  // "try { x() } catch { var y = 1 }" even though "y" is never used
                  // because the hoisted variable "y" would have different values
                  // after the statement ends due to a strange JavaScript quirk:
                  //
                  //   try { x() } catch (y) { var y = 1 }
                  //   console.log(y) // undefined
                  //
                  //   try { x() } catch { var y = 1 }
                  //   console.log(y) // 1
                  //
                } else if (p.currentScope.containsDirectEval) {
                  // We cannot transform "try { x() } catch (y) { eval('z = y') }"
                  // into "try { x() } catch { eval('z = y') }" because the variable
                  // "y" is actually still used.
                } else {
                  // "try { x() } catch (y) {}" => "try { x() } catch {}"
                  s.catch.bindingOrNil = null;
                }
              }
            }
          }
          break;
      }

      result.push(stmt);
    }

    // Drop a trailing unconditional jump statement if applicable
    if (result.length > 0) {
      switch (kind) {
        case stmtsLoopBody: {
          // "while (x) { y(); continue; }" => "while (x) { y(); }"
          const continueS = result[result.length - 1].data;
          if (continueS.k === S_CONTINUE && continueS.label === null) {
            result.pop();
          }
          break;
        }

        case stmtsFnBody: {
          const lastStmt = result[result.length - 1];
          const returnS = lastStmt.data;
          if (returnS.k === S_RETURN) {
            if (returnS.valueOrNil === null) {
              // "function f() { x(); return; }" => "function f() { x(); }"
              result.pop();
            } else if (returnS.valueOrNil.data.k === E_UNARY && returnS.valueOrNil.data.op === UnOpVoid) {
              // "function f() { return void x(); }" => "function f() { x(); }"
              result[result.length - 1] = new Stmt(new SExpr(returnS.valueOrNil.data.value), lastStmt.loc);
            }
          }
          break;
        }
      }
    }

    // Merge certain statements in reverse order
    if (result.length >= 2) {
      let lastStmt = result[result.length - 1];

      if (lastStmt.data.k === S_RETURN) {
        let lastReturn = lastStmt.data;

        // "if (a) return b; if (c) return d; return e;" => "return a ? b : c ? d : e;"
        returnLoop: while (result.length >= 2) {
          const prevIndex = result.length - 2;
          const prevStmt = result[prevIndex];
          const prevS = prevStmt.data;

          switch (prevS.k) {
            case S_EXPR:
              // This return statement must have a value
              if (lastReturn.valueOrNil === null) {
                break returnLoop;
              }

              // "a(); return b;" => "return a(), b;"
              lastReturn = new SReturn(joinWithComma(prevS.value, lastReturn.valueOrNil));

              // Merge the last two statements
              lastStmt = new Stmt(lastReturn, prevStmt.loc);
              result[prevIndex] = lastStmt;
              result.pop();
              break;

            case S_IF: {
              // The previous statement must be an if statement with no else clause
              if (prevS.noOrNil !== null) {
                break returnLoop;
              }

              // The then clause must be a return
              if (prevS.yes.data.k !== S_RETURN) {
                break returnLoop;
              }
              const prevReturn = prevS.yes.data;

              // Handle some or all of the values being undefined
              let left = prevReturn.valueOrNil;
              let right = lastReturn.valueOrNil;
              if (left === null) {
                // "if (a) return; return b;" => "return a ? void 0 : b;"
                left = new Expr(EUndefinedShared, prevS.yes.loc);
              }
              if (right === null) {
                // "if (a) return a; return;" => "return a ? b : void 0;"
                right = new Expr(EUndefinedShared, lastStmt.loc);
              }

              // "if (!a) return b; return c;" => "return a ? c : b;"
              if (prevS.test.data.k === E_UNARY && prevS.test.data.op === UnOpNot) {
                prevS.test = prevS.test.data.value;
                const tmp = left;
                left = right;
                right = tmp;
              }

              if (prevS.test.data.k === E_BINARY && prevS.test.data.op === BinOpComma) {
                // "if (a, b) return c; return d;" => "return a, b ? c : d;"
                const comma = prevS.test.data;
                lastReturn = new SReturn(
                  joinWithComma(comma.left, p.astHelpers.mangleIfExpr(comma.right.loc, new EIf(comma.right, left, right), p.options.unsupportedJSFeatures)),
                );
              } else {
                // "if (a) return b; return c;" => "return a ? b : c;"
                lastReturn = new SReturn(p.astHelpers.mangleIfExpr(prevS.test.loc, new EIf(prevS.test, left, right), p.options.unsupportedJSFeatures));
              }

              // Merge the last two statements
              lastStmt = new Stmt(lastReturn, prevStmt.loc);
              result[prevIndex] = lastStmt;
              result.pop();
              break;
            }

            default:
              break returnLoop;
          }
        }
      } else if (lastStmt.data.k === S_THROW) {
        let lastThrow = lastStmt.data;

        // "if (a) throw b; if (c) throw d; throw e;" => "throw a ? b : c ? d : e;"
        throwLoop: while (result.length >= 2) {
          const prevIndex = result.length - 2;
          const prevStmt = result[prevIndex];
          const prevS = prevStmt.data;

          switch (prevS.k) {
            case S_EXPR:
              // "a(); throw b;" => "throw a(), b;"
              lastThrow = new SThrow(joinWithComma(prevS.value, lastThrow.value));

              // Merge the last two statements
              lastStmt = new Stmt(lastThrow, prevStmt.loc);
              result[prevIndex] = lastStmt;
              result.pop();
              break;

            case S_IF: {
              // The previous statement must be an if statement with no else clause
              if (prevS.noOrNil !== null) {
                break throwLoop;
              }

              // The then clause must be a throw
              if (prevS.yes.data.k !== S_THROW) {
                break throwLoop;
              }
              const prevThrow = prevS.yes.data;

              let left = prevThrow.value;
              let right = lastThrow.value;

              // "if (!a) throw b; throw c;" => "throw a ? c : b;"
              if (prevS.test.data.k === E_UNARY && prevS.test.data.op === UnOpNot) {
                prevS.test = prevS.test.data.value;
                const tmp = left;
                left = right;
                right = tmp;
              }

              // Merge the last two statements
              if (prevS.test.data.k === E_BINARY && prevS.test.data.op === BinOpComma) {
                // "if (a, b) return c; return d;" => "return a, b ? c : d;"
                const comma = prevS.test.data;
                lastThrow = new SThrow(
                  joinWithComma(comma.left, p.astHelpers.mangleIfExpr(comma.right.loc, new EIf(comma.right, left, right), p.options.unsupportedJSFeatures)),
                );
              } else {
                // "if (a) return b; return c;" => "return a ? b : c;"
                lastThrow = new SThrow(p.astHelpers.mangleIfExpr(prevS.test.loc, new EIf(prevS.test, left, right), p.options.unsupportedJSFeatures));
              }
              lastStmt = new Stmt(lastThrow, prevStmt.loc);
              result[prevIndex] = lastStmt;
              result.pop();
              break;
            }

            default:
              break throwLoop;
          }
        }
      }
    }

    return result;
  },

  // (Only reachable with MinifySyntax)
  substituteSingleUseSymbolInStmt(stmt, ref, replacement) {
    const p = this;

    // Go takes a pointer to the expression field; here it is (holder, field)
    let holder = null;
    let field = "";

    const s = stmt.data;
    switch (s.k) {
      case S_EXPR:
        holder = s;
        field = "value";
        break;
      case S_THROW:
        holder = s;
        field = "value";
        break;
      case S_RETURN:
        holder = s;
        field = "valueOrNil";
        break;
      case S_IF:
        holder = s;
        field = "test";
        break;
      case S_SWITCH:
        holder = s;
        field = "test";
        break;
      case S_LOCAL: {
        // Only try substituting into the initializer for the first declaration
        if (s.decls.length === 0) {
          goIndexOutOfRange(0, 0);
        }
        const first = s.decls[0];
        if (first.valueOrNil !== null) {
          // Make sure there isn't destructuring, which could evaluate code
          if (first.binding.data.k === B_IDENTIFIER) {
            holder = first;
            field = "valueOrNil";
          }
        }
        break;
      }
    }

    if (holder !== null) {
      // Only continue trying to insert this replacement into sub-expressions
      // after the first one if the replacement has no side effects:
      //
      //   // Substitution is ok
      //   let replacement = 123;
      //   return x + replacement;
      //
      //   // Substitution is not ok because "fn()" may change "x"
      //   let replacement = fn();
      //   return x + replacement;
      //
      //   // Substitution is not ok because "x == x" may change "x" due to "valueOf()" evaluation
      //   let replacement = [x];
      //   return (x == x) + replacement;
      //
      const replacementCanBeRemoved = p.astHelpers.exprCanBeRemovedIfUnused(replacement);

      const $d169 = p.substituteSingleUseSymbolInExpr(holder[field], ref, replacement, replacementCanBeRemoved);
      const new_ = $d169[0], status = $d169[1];
      if (status === substituteSuccess) {
        holder[field] = new_;
        return true;
      }
    }

    return false;
  },

  // (Only reachable with MinifySyntax.) Returns [expr, substituteStatus]
  substituteSingleUseSymbolInExpr(expr, ref, replacement, replacementCanBeRemoved) {
    const p = this;

    // Go: a nil expression (e.g. from "return;") matches no case below, and
    // both ExprCanBeRemovedIfUnused and IsPrimitiveLiteral return false for it
    if (expr === null) {
      if (isPrimitiveLiteral(replacement.data)) {
        return [expr, substituteContinue];
      }
      return [expr, substituteFailure];
    }

    const e = expr.data;
    switch (e.k) {
      case E_IDENTIFIER:
        if (e.ref === ref) {
          p.ignoreUsage(ref);
          return [replacement, substituteSuccess];
        }
        break;

      case E_SPREAD: {
        const $d170 = p.substituteSingleUseSymbolInExpr(e.value, ref, replacement, replacementCanBeRemoved);
        const value = $d170[0], status = $d170[1];
        if (status !== substituteContinue) {
          e.value = value;
          return [expr, status];
        }
        break;
      }

      case E_AWAIT: {
        const $d171 = p.substituteSingleUseSymbolInExpr(e.value, ref, replacement, replacementCanBeRemoved);
        const value = $d171[0], status = $d171[1];
        if (status !== substituteContinue) {
          e.value = value;
          return [expr, status];
        }
        break;
      }

      case E_YIELD:
        if (e.valueOrNil !== null) {
          const $d172 = p.substituteSingleUseSymbolInExpr(e.valueOrNil, ref, replacement, replacementCanBeRemoved);
          const value = $d172[0], status = $d172[1];
          if (status !== substituteContinue) {
            e.valueOrNil = value;
            return [expr, status];
          }
        }
        break;

      case E_IMPORT_CALL: {
        const $d173 = p.substituteSingleUseSymbolInExpr(e.expr, ref, replacement, replacementCanBeRemoved);
        const value = $d173[0], status = $d173[1];
        if (status !== substituteContinue) {
          e.expr = value;
          return [expr, status];
        }

        // The "import()" expression has side effects but the side effects are
        // always asynchronous so there is no way for the side effects to modify
        // the replacement value. So it's ok to reorder the replacement value
        // past the "import()" expression assuming everything else checks out.
        if (replacementCanBeRemoved && p.astHelpers.exprCanBeRemovedIfUnused(e.expr)) {
          return [expr, substituteContinue];
        }
        break;
      }

      case E_UNARY:
        switch (e.op) {
          case UnOpPreInc:
          case UnOpPostInc:
          case UnOpPreDec:
          case UnOpPostDec:
          case UnOpDelete:
            // Do not substitute into an assignment position
            break;

          default: {
            const $d174 = p.substituteSingleUseSymbolInExpr(e.value, ref, replacement, replacementCanBeRemoved);
            const value = $d174[0], status = $d174[1];
            if (status !== substituteContinue) {
              e.value = value;
              return [expr, status];
            }
          }
        }
        break;

      case E_DOT: {
        const $d175 = p.substituteSingleUseSymbolInExpr(e.target, ref, replacement, replacementCanBeRemoved);
        const value = $d175[0], status = $d175[1];
        if (status !== substituteContinue) {
          e.target = value;
          return [expr, status];
        }
        break;
      }

      case E_BINARY: {
        // Do not substitute into an assignment position
        if (opCodeBinaryAssignTarget(e.op) === AssignTargetNone) {
          const $d176 = p.substituteSingleUseSymbolInExpr(e.left, ref, replacement, replacementCanBeRemoved);
          const value = $d176[0], status = $d176[1];
          if (status !== substituteContinue) {
            e.left = value;
            return [expr, status];
          }
        } else if (!p.astHelpers.exprCanBeRemovedIfUnused(e.left)) {
          // Do not reorder past a side effect in an assignment target, as that may
          // change the replacement value. For example, "fn()" may change "a" here:
          //
          //   let a = 1;
          //   foo[fn()] = a;
          //
          return [expr, substituteFailure];
        } else if (opCodeBinaryAssignTarget(e.op) === AssignTargetUpdate && !replacementCanBeRemoved) {
          // If this is a read-modify-write assignment and the replacement has side
          // effects, don't reorder it past the assignment target. The assignment
          // target is being read so it may be changed by the side effect. For
          // example, "fn()" may change "foo" here:
          //
          //   let a = fn();
          //   foo += a;
          //
          return [expr, substituteFailure];
        }

        // If we get here then it should be safe to attempt to substitute the
        // replacement past the left operand into the right operand.
        const $d177 = p.substituteSingleUseSymbolInExpr(e.right, ref, replacement, replacementCanBeRemoved);
        const value = $d177[0], status = $d177[1];
        if (status !== substituteContinue) {
          e.right = value;
          return [expr, status];
        }
        break;
      }

      case E_IF: {
        const $d178 = p.substituteSingleUseSymbolInExpr(e.test, ref, replacement, replacementCanBeRemoved);
        const value = $d178[0], status = $d178[1];
        if (status !== substituteContinue) {
          e.test = value;
          return [expr, status];
        }

        // Do not substitute our unconditionally-executed value into a branch
        // unless the value itself has no side effects
        if (replacementCanBeRemoved) {
          // Unlike other branches in this function such as "a && b" or "a?.[b]",
          // the "a ? b : c" form has potential code evaluation along both control
          // flow paths. Handle this by allowing substitution into either branch.
          // Side effects in one branch should not prevent the substitution into
          // the other branch.

          const $d179 = p.substituteSingleUseSymbolInExpr(e.yes, ref, replacement, replacementCanBeRemoved);
          const yesValue = $d179[0], yesStatus = $d179[1];
          if (yesStatus === substituteSuccess) {
            e.yes = yesValue;
            return [expr, yesStatus];
          }

          const $d180 = p.substituteSingleUseSymbolInExpr(e.no, ref, replacement, replacementCanBeRemoved);
          const noValue = $d180[0], noStatus = $d180[1];
          if (noStatus === substituteSuccess) {
            e.no = noValue;
            return [expr, noStatus];
          }

          // Side effects in either branch should stop us from continuing to try to
          // substitute the replacement after the control flow branches merge again.
          if (yesStatus !== substituteContinue || noStatus !== substituteContinue) {
            return [expr, substituteFailure];
          }
        }
        break;
      }

      case E_INDEX: {
        const $d181 = p.substituteSingleUseSymbolInExpr(e.target, ref, replacement, replacementCanBeRemoved);
        const value = $d181[0], status = $d181[1];
        if (status !== substituteContinue) {
          e.target = value;
          return [expr, status];
        }

        // Do not substitute our unconditionally-executed value into a branch
        // unless the value itself has no side effects
        if (replacementCanBeRemoved || e.optionalChain === OptionalChainNone) {
          const $d182 = p.substituteSingleUseSymbolInExpr(e.index, ref, replacement, replacementCanBeRemoved);
          const value2 = $d182[0], status2 = $d182[1];
          if (status2 !== substituteContinue) {
            e.index = value2;
            return [expr, status2];
          }
        }
        break;
      }

      case E_CALL: {
        // Don't substitute something into a call target that could change "this"
        const replacementKind = replacement.data.k;
        if (replacementKind === E_DOT || replacementKind === E_INDEX) {
          if (e.target.data.k === E_IDENTIFIER && e.target.data.ref === ref) {
            break;
          }
        }

        const $d183 = p.substituteSingleUseSymbolInExpr(e.target, ref, replacement, replacementCanBeRemoved);
        const value = $d183[0], status = $d183[1];
        if (status !== substituteContinue) {
          e.target = value;
          if (status === substituteSuccess) {
            // "const y = () => x; y()" => "(() => x)()" => "x"
            const $d184 = p.maybeInlineIIFE(expr.loc, e);
            const inlined = $d184[0], ok = $d184[1];
            if (ok) {
              return [inlined, substituteSuccess];
            }
          }
          return [expr, status];
        }

        // Do not substitute our unconditionally-executed value into a branch
        // unless the value itself has no side effects
        if (replacementCanBeRemoved || e.optionalChain === OptionalChainNone) {
          const args = e.args;
          for (let i = 0; i < args.length; i++) {
            const $d185 = p.substituteSingleUseSymbolInExpr(args[i], ref, replacement, replacementCanBeRemoved);
            const argValue = $d185[0], argStatus = $d185[1];
            if (argStatus !== substituteContinue) {
              args[i] = argValue;
              return [expr, argStatus];
            }
          }
        }
        break;
      }

      case E_ARRAY: {
        const items = e.items;
        for (let i = 0; i < items.length; i++) {
          const $d186 = p.substituteSingleUseSymbolInExpr(items[i], ref, replacement, replacementCanBeRemoved);
          const value = $d186[0], status = $d186[1];
          if (status !== substituteContinue) {
            items[i] = value;
            return [expr, status];
          }
        }
        break;
      }

      case E_OBJECT: {
        const properties = e.properties;
        for (let i = 0; i < properties.length; i++) {
          const property = properties[i];

          // Check the key
          if ((property.flags & PropertyIsComputed) !== 0) {
            const $d187 = p.substituteSingleUseSymbolInExpr(property.key, ref, replacement, replacementCanBeRemoved);
            const value = $d187[0], status = $d187[1];
            if (status !== substituteContinue) {
              properties[i].key = value;
              return [expr, status];
            }

            // Stop now because both computed keys and property spread have side effects
            return [expr, substituteFailure];
          }

          // Check the value
          if (property.valueOrNil !== null) {
            const $d188 = p.substituteSingleUseSymbolInExpr(property.valueOrNil, ref, replacement, replacementCanBeRemoved);
            const value = $d188[0], status = $d188[1];
            if (status !== substituteContinue) {
              properties[i].valueOrNil = value;
              return [expr, status];
            }
          }
        }
        break;
      }

      case E_TEMPLATE: {
        if (e.tagOrNil !== null) {
          const $d189 = p.substituteSingleUseSymbolInExpr(e.tagOrNil, ref, replacement, replacementCanBeRemoved);
          const value = $d189[0], status = $d189[1];
          if (status !== substituteContinue) {
            e.tagOrNil = value;
            return [expr, status];
          }
        }

        const parts = e.parts;
        for (let i = 0; i < parts.length; i++) {
          const $d190 = p.substituteSingleUseSymbolInExpr(parts[i].value, ref, replacement, replacementCanBeRemoved);
          const value = $d190[0], status = $d190[1];
          if (status !== substituteContinue) {
            parts[i].value = value;

            // If we substituted a primitive, merge it into the template
            if (isPrimitiveLiteral(value.data)) {
              expr = inlinePrimitivesIntoTemplate(expr.loc, e);
            }
            return [expr, status];
          }
        }
        break;
      }
    }

    // If both the replacement and this expression have no observable side
    // effects, then we can reorder the replacement past this expression
    if (replacementCanBeRemoved && p.astHelpers.exprCanBeRemovedIfUnused(expr)) {
      return [expr, substituteContinue];
    }

    // We can always reorder past primitive values
    if (isPrimitiveLiteral(expr.data) || isPrimitiveLiteral(replacement.data)) {
      return [expr, substituteContinue];
    }

    // Otherwise we should stop trying to substitute past this point
    return [expr, substituteFailure];
  },

  visitLoopBody(stmt) {
    const p = this;
    const oldIsInsideLoop = p.fnOrArrowDataVisit.isInsideLoop;
    p.fnOrArrowDataVisit.isInsideLoop = true;
    p.loopBody = stmt.data;
    stmt = p.visitSingleStmt(stmt, stmtsLoopBody);
    p.fnOrArrowDataVisit.isInsideLoop = oldIsInsideLoop;
    return stmt;
  },

  visitSingleStmt(stmt, kind) {
    const p = this;

    // To reduce stack depth, special-case blocks and process their children directly
    if (stmt.data.k === S_BLOCK) {
      const block = stmt.data;
      p.pushScopeForVisitPass(ScopeBlock, stmt.loc);
      block.stmts = p.visitStmts(block.stmts, kind);
      p.popScope();
      if (p.options.minifySyntax) {
        stmt = stmtsToSingleStmt(stmt.loc, block.stmts, block.closeBraceLoc);
      }
      return stmt;
    }

    // Introduce a fake block scope for function declarations inside if statements
    const hasIfScope = stmt.data.k === S_FUNCTION && stmt.data.fn.hasIfScope;
    if (hasIfScope) {
      p.pushScopeForVisitPass(ScopeBlock, stmt.loc);
      if (p.isStrictMode()) {
        p.markStrictModeFeature(ifElseFunctionStmt, rangeOfIdentifier(p.source, stmt.loc), "");
      }
    }

    p.singleStmtDepth++;
    const stmts = p.visitStmts([stmt], kind);
    p.singleStmtDepth--;

    // Balance the fake block scope introduced above
    if (hasIfScope) {
      p.popScope();
    }

    return stmtsToSingleStmt(stmt.loc, stmts, 0);
  },

  visitForLoopInit(stmt, isInOrOf) {
    const p = this;
    const s = stmt.data;
    switch (s.k) {
      case S_EXPR: {
        let assignTarget = AssignTargetNone;
        if (isInOrOf) {
          assignTarget = AssignTargetReplace;
        }
        p.stmtExprValue = s.value.data;
        const $d191 = p.visitExprInOut(s.value, assignTarget === AssignTargetReplace ? exprInAssignTargetReplace : exprInAssignTargetNone);
        const value = $d191[0];
        s.value = value;
        break;
      }

      case S_LOCAL: {
        const decls = s.decls;
        for (let i = 0; i < decls.length; i++) {
          const d = decls[i];
          p.visitBinding(d.binding, bindingOptsDefault);
          if (d.valueOrNil !== null) {
            d.valueOrNil = p.visitExpr(d.valueOrNil);
          }
        }
        s.decls = p.lowerObjectRestInDecls(s.decls);
        s.kind = p.selectLocalKind(s.kind);
        break;
      }

      default:
        throw new GoPanic("Internal error");
    }

    return stmt;
  },

  recordDeclaredSymbol(ref) {
    const p = this;
    let isTopLevel = p.currentScope === p.moduleScope;

    // Check whether this symbol was hoisted out of a nested scope into the module scope
    if (!isTopLevel) {
      const symbol = p.symbols[refInner(ref)];
      if (symbolKindIsHoisted(symbol.kind)) {
        // (a missing map entry reads as the zero ScopeMember, whose Ref is {0, 0})
        const member = p.moduleScope.members.get(symbol.originalName);
        if ((member !== undefined ? member.ref : 0) === ref) {
          isTopLevel = true;
        }
      }
    }

    p.currentPart.declaredSymbols.push(new DeclaredSymbol(ref, isTopLevel));
  },

  visitBinding(binding, opts) {
    const p = this;
    const b = binding.data;
    switch (b.k) {
      case B_MISSING:
        break;

      case B_IDENTIFIER: {
        p.recordDeclaredSymbol(b.ref);
        const name = p.symbols[refInner(b.ref)].originalName;
        p.validateDeclaredSymbolName(binding.loc, name);
        const duplicateArgCheck = opts.duplicateArgCheck;
        if (duplicateArgCheck !== null) {
          const r = rangeOfIdentifier(p.source, binding.loc);
          const firstRange = duplicateArgCheck.get(name);
          if (firstRange !== undefined && firstRange.len > 0) {
            p.log.addErrorWithNotes(p.tracker, r, goQuote(name) + " cannot be bound multiple times in the same parameter list", [
              p.tracker.msgData(firstRange, "The name " + goQuote(name) + " was originally bound here:"),
            ]);
          } else {
            duplicateArgCheck.set(name, r);
          }
        }
        break;
      }

      case B_ARRAY: {
        const items = b.items;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          p.visitBinding(item.binding, opts);
          if (item.defaultValueOrNil !== null) {
            // Propagate the name to keep from the binding into the initializer
            if (item.binding.data.k === B_IDENTIFIER) {
              p.nameToKeep = p.symbols[refInner(item.binding.data.ref)].originalName;
              p.nameToKeepIsFor = item.defaultValueOrNil.data;
            }

            item.defaultValueOrNil = p.visitExpr(item.defaultValueOrNil);
          }
        }
        break;
      }

      case B_OBJECT: {
        const properties = b.properties;
        for (let i = 0; i < properties.length; i++) {
          // Go copies the PropertyBinding struct, updates the copy and writes it back
          const property = properties[i].clone();
          if (!property.isSpread) {
            const $d192 = p.visitExprInOut(property.key, exprInShouldMangleStringsAsProps);
            const key = $d192[0];
            property.key = key;
          }
          p.visitBinding(property.value, opts);
          if (property.defaultValueOrNil !== null) {
            // Propagate the name to keep from the binding into the initializer
            if (property.value.data.k === B_IDENTIFIER) {
              p.nameToKeep = p.symbols[refInner(property.value.data.ref)].originalName;
              p.nameToKeepIsFor = property.defaultValueOrNil.data;
            }

            property.defaultValueOrNil = p.visitExpr(property.defaultValueOrNil);
          }
          properties[i] = property;
        }
        break;
      }

      default:
        throw new GoPanic("Internal error");
    }
  },

  // (Only reachable with MinifySyntax.) Appends to "stmts" and returns it.
  mangleIf(stmts, loc, s) {
    const p = this;

    // Constant folding using the test expression
    const $d193 = toBooleanWithSideEffects(s.test.data);
    const boolean = $d193[0], sideEffects = $d193[1], ok = $d193[2];
    if (ok) {
      if (boolean) {
        // The test is truthy
        if (s.noOrNil === null || !shouldKeepStmtInDeadControlFlow(s.noOrNil)) {
          // We can drop the "no" branch
          if (sideEffects === CouldHaveSideEffects) {
            // Keep the condition if it could have side effects (but is still known to be truthy)
            const test = p.astHelpers.simplifyUnusedExpr(s.test, p.options.unsupportedJSFeatures);
            if (test !== null) {
              stmts.push(new Stmt(new SExpr(test), s.test.loc));
            }
          }
          return appendIfOrLabelBodyPreservingScope(stmts, s.yes);
        } else {
          // We have to keep the "no" branch
        }
      } else {
        // The test is falsy
        if (!shouldKeepStmtInDeadControlFlow(s.yes)) {
          // We can drop the "yes" branch
          if (sideEffects === CouldHaveSideEffects) {
            // Keep the condition if it could have side effects (but is still known to be falsy)
            const test = p.astHelpers.simplifyUnusedExpr(s.test, p.options.unsupportedJSFeatures);
            if (test !== null) {
              stmts.push(new Stmt(new SExpr(test), s.test.loc));
            }
          }
          if (s.noOrNil === null) {
            return stmts;
          }
          return appendIfOrLabelBodyPreservingScope(stmts, s.noOrNil);
        } else {
          // We have to keep the "yes" branch
        }
      }

      // Use "1" and "0" instead of "true" and "false" to be shorter
      if (sideEffects === NoSideEffects) {
        if (boolean) {
          s.test = new Expr(new ENumber(1), s.test.loc);
        } else {
          s.test = new Expr(new ENumber(0), s.test.loc);
        }
      }
    }

    let expr = null;

    const yes = s.yes.data;
    if (yes.k === S_EXPR) {
      // "yes" is an expression
      if (s.noOrNil === null) {
        if (s.test.data.k === E_UNARY && s.test.data.op === UnOpNot) {
          // "if (!a) b();" => "a || b();"
          expr = joinWithLeftAssociativeOp(BinOpLogicalOr, s.test.data.value, yes.value);
        } else {
          // "if (a) b();" => "a && b();"
          expr = joinWithLeftAssociativeOp(BinOpLogicalAnd, s.test, yes.value);
        }
      } else if (s.noOrNil.data.k === S_EXPR) {
        // "if (a) b(); else c();" => "a ? b() : c();"
        expr = p.astHelpers.mangleIfExpr(loc, new EIf(s.test, yes.value, s.noOrNil.data.value), p.options.unsupportedJSFeatures);
      }
    } else if (yes.k === S_EMPTY) {
      // "yes" is missing
      if (s.noOrNil === null) {
        // "yes" and "no" are both missing
        if (p.astHelpers.exprCanBeRemovedIfUnused(s.test)) {
          // "if (1) {}" => ""
          return stmts;
        } else {
          // "if (a) {}" => "a;"
          expr = s.test;
        }
      } else if (s.noOrNil.data.k === S_EXPR) {
        const no = s.noOrNil.data;
        if (s.test.data.k === E_UNARY && s.test.data.op === UnOpNot) {
          // "if (!a) {} else b();" => "a && b();"
          expr = joinWithLeftAssociativeOp(BinOpLogicalAnd, s.test.data.value, no.value);
        } else {
          // "if (a) {} else b();" => "a || b();"
          expr = joinWithLeftAssociativeOp(BinOpLogicalOr, s.test, no.value);
        }
      } else {
        // "yes" is missing and "no" is not missing (and is not an expression)
        if (s.test.data.k === E_UNARY && s.test.data.op === UnOpNot) {
          // "if (!a) {} else throw b;" => "if (a) throw b;"
          s.test = s.test.data.value;
          s.yes = s.noOrNil;
          s.noOrNil = null;
        } else {
          // "if (a) {} else throw b;" => "if (!a) throw b;"
          s.test = not(s.test);
          s.yes = s.noOrNil;
          s.noOrNil = null;
        }
      }
    } else {
      // "yes" is not missing (and is not an expression)
      if (s.noOrNil !== null) {
        // "yes" is not missing (and is not an expression) and "no" is not missing
        if (s.test.data.k === E_UNARY && s.test.data.op === UnOpNot) {
          // "if (!a) return b; else return c;" => "if (a) return c; else return b;"
          s.test = s.test.data.value;
          const tmp = s.yes;
          s.yes = s.noOrNil;
          s.noOrNil = tmp;
        }
      } else {
        // "no" is missing
        if (s.yes.data.k === S_IF && s.yes.data.noOrNil === null) {
          // "if (a) if (b) return c;" => "if (a && b) return c;"
          const s2 = s.yes.data;
          s.test = joinWithLeftAssociativeOp(BinOpLogicalAnd, s.test, s2.test);
          s.yes = s2.yes;
        }
      }
    }

    // Return an expression if we replaced the if statement with an expression above
    if (expr !== null) {
      expr = p.astHelpers.simplifyUnusedExpr(expr, p.options.unsupportedJSFeatures);
      stmts.push(new Stmt(new SExpr(expr), loc));
      return stmts;
    }

    stmts.push(new Stmt(s, loc));
    return stmts;
  },

  // (Only reachable with KeepNames)
  keepExprSymbolName(value, name) {
    const p = this;
    value = p.callRuntime(value.loc, "__name", [value, new Expr(new EString(name), value.loc)]);

    // Make sure tree shaking removes this if the function is never used
    value.data.canBeUnwrappedIfUnused = true;
    return value;
  },

  // (Only reachable with KeepNames)
  keepClassOrFnSymbolName(loc, expr, name) {
    const p = this;
    return new Stmt(new SExpr(p.callRuntime(loc, "__name", [expr, new Expr(new EString(name), loc)]), true), loc);
  },
};
// generated from js_parser_visit_stmt.mts by tools/ts-build.mjs; edit that file
