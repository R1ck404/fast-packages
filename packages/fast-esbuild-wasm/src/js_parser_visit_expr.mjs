// Port of internal/js_parser/js_parser.go lines 13277-17250: expression
// visiting (visitExpr, visitExprInOut, binaryExprVisitor, handleIdentifier,
// visitFn, ...). See CONVENTIONS.md.
//
// ---------------------------------------------------------------------------
// Calling convention for visitExprInOut
//
// Go: func (p *parser) visitExprInOut(expr Expr, in exprIn) (Expr, exprOut)
//
// * p.visitExprInOut(expr, in_) (the Go-shaped method used by other modules)
//   returns an array [expr, out]. `in_` is an exprIn (the frozen
//   EXPR_IN_DEFAULT is fine) and is never mutated. The returned `out` may be
//   the frozen EXPR_OUT_DEFAULT: never mutate it.
// * p.visitExpr(expr) returns just the Expr.
// * Inside this module the hot path uses visitExprInOutImpl(p, expr, in_),
//   which returns the Expr and stores the exprOut in the module-level side
//   channel `lastOut` (JS is single-threaded and parsing is synchronous).
//   Rule: every return path of visitExprInOutImpl (and of the per-kind helpers
//   it tail-calls) assigns `lastOut` *after* all nested visits, right before
//   returning. Callers that need the exprOut read `lastOut` immediately after
//   the call, before any other visit.
// * The exprIn objects created here may be shared frozen instances (Go passes
//   exprIn by value and no Go code mutates a received exprIn).
//
// Options that are always off in the fast path (CONVENTIONS section 5) have
// their branches dropped with a short note: minifySyntax, keepNames,
// mangleProps/mangleQuoted, lowering (UnsupportedJSFeatures == 0), ModeBundle,
// Yarn PnP. Messages of kind Error/Warning throw BAIL through the Log.
// ---------------------------------------------------------------------------

import { bail } from "./bail.mjs";
import {
  Warning,
  Debug,
  mkRange,
  rangeEnd,
  RANGE_ZERO,
  MsgID_JS_AssignToConstant,
  MsgID_JS_AssignToImport,
  MsgID_JS_CallImportNamespace,
  MsgID_JS_ClassNameWillThrow,
  MsgID_JS_CommonJSVariableInESM,
  MsgID_JS_DeleteSuperProperty,
  MsgID_JS_EmptyImportMeta,
  MsgID_JS_PrivateNameWillThrow,
  MsgID_JS_SuspiciousLogicalOperator,
  MsgID_JS_SuspiciousNullishCoalescing,
  MsgID_JS_UnsupportedRequireCall,
} from "./logger.mjs";
import { codePointAt } from "./helpers.mjs";
import {
  InvalidRef,
  refInner,
  ImportDynamic,
  ImportRequire,
  ImportRequireResolve,
  EvaluationPhase,
  HandlesImportErrors,
  AssertTypeJSON,
  AssertKeyword,
  WithKeyword,
  ImportAssertOrWith,
  AssertOrWithEntry,
  SymbolUnbound,
  SymbolClassInComputedPropertyKey,
  SymbolConst,
  SymbolInjected,
  SymbolImport,
  SymbolOther,
  SymbolPrivateMethod,
  SymbolPrivateStaticMethod,
  SymbolPrivateGet,
  SymbolPrivateStaticGet,
  SymbolPrivateSet,
  SymbolPrivateStaticSet,
  symbolKindIsPrivate,
  symbolKindIsUnboundOrInjected,
  ImportItemGenerated,
  MustStartWithCapitalLetterForJSX,
  CallCanBeUnwrappedIfUnused as SymbolFlagCallCanBeUnwrappedIfUnused,
  DidWarnAboutCommonJSInESM,
  CouldPotentiallyBeMutated,
} from "./ast.mjs";
import {
  Expr,
  Property,
  PropertyField,
  PropertySpread,
  PropertyIsComputed,
  PropertyWasShorthand,
  PropertyPreferQuotedKey,
  propertyKindIsMethodDefinition,
  AssignTargetNone,
  AssignTargetReplace,
  AssignTargetUpdate,
  opCodeUnaryAssignTarget,
  opCodeBinaryAssignTarget,
  OptionalChainNone,
  OptionalChainStart,
  OptionalChainContinue,
  NormalCall,
  DirectEval,
  TargetWasOriginallyPropertyAccess,
  CanBeRemovedIfUnusedFlag,
  UnOpPos,
  UnOpNeg,
  UnOpCpl,
  UnOpNot,
  UnOpVoid,
  UnOpTypeof,
  UnOpDelete,
  UnOpPreDec,
  UnOpPreInc,
  UnOpPostDec,
  UnOpPostInc,
  BinOpAdd,
  BinOpSub,
  BinOpMul,
  BinOpDiv,
  BinOpRem,
  BinOpPow,
  BinOpIn,
  BinOpShl,
  BinOpShr,
  BinOpUShr,
  BinOpLooseEq,
  BinOpLooseNe,
  BinOpStrictEq,
  BinOpStrictNe,
  BinOpNullishCoalescing,
  BinOpLogicalOr,
  BinOpLogicalAnd,
  BinOpBitwiseOr,
  BinOpBitwiseAnd,
  BinOpBitwiseXor,
  BinOpComma,
  BinOpAssign,
  BinOpAddAssign,
  BinOpSubAssign,
  BinOpMulAssign,
  BinOpDivAssign,
  BinOpRemAssign,
  BinOpPowAssign,
  BinOpShlAssign,
  BinOpShrAssign,
  BinOpUShrAssign,
  BinOpBitwiseOrAssign,
  BinOpBitwiseAndAssign,
  BinOpBitwiseXorAssign,
  BinOpNullishCoalescingAssign,
  BinOpLogicalOrAssign,
  BinOpLogicalAndAssign,
  B_IDENTIFIER,
  S_RETURN,
  E_ARRAY,
  E_UNARY,
  E_BINARY,
  E_BOOLEAN,
  E_SUPER,
  E_NULL,
  E_UNDEFINED,
  E_THIS,
  E_NEW,
  E_NEW_TARGET,
  E_IMPORT_META,
  E_CALL,
  E_DOT,
  E_INDEX,
  E_ARROW,
  E_FUNCTION,
  E_CLASS,
  E_IDENTIFIER,
  E_IMPORT_IDENTIFIER,
  E_PRIVATE_IDENTIFIER,
  E_NAME_OF_SYMBOL,
  E_JSX_ELEMENT,
  E_JSX_TEXT,
  E_MISSING,
  E_NUMBER,
  E_BIG_INT,
  E_OBJECT,
  E_SPREAD,
  E_STRING,
  E_TEMPLATE,
  E_REG_EXP,
  E_AWAIT,
  E_YIELD,
  E_IF,
  E_IMPORT_CALL,
  EArray,
  EBinary,
  EBoolean,
  ECall,
  EDot,
  EIdentifier,
  EImportIdentifier,
  ENumber,
  EObject,
  EString,
  ENew,
  EArrow,
  EAnnotation,
  EImportCall,
  EImportString,
  ERequireString,
  ERequireResolveString,
  ENullShared,
  EThisShared,
  EUndefinedShared,
  ScopeFunctionArgs,
  ScopeFunctionBody,
  SymbolUse,
  SymbolCallUse,
  TS_NAMESPACE_MEMBER_NAMESPACE,
  TS_NAMESPACE_MEMBER_ENUM_NUMBER,
  TS_NAMESPACE_MEMBER_ENUM_STRING,
} from "./js_ast.mjs";
import {
  isPropertyAccess,
  inlinePrimitivesIntoTemplate,
  typeofWithoutSideEffects,
  toBooleanWithSideEffects,
  toNumberWithoutSideEffects,
  toInt32,
  knownPrimitiveType,
  PrimitiveUnknown,
  PrimitiveNull,
  PrimitiveUndefined,
  PrimitiveBoolean,
  PrimitiveNumber,
  PrimitiveString,
  NoSideEffects,
  toNullOrUndefinedWithSideEffects,
  checkEqualityIfNoSideEffects,
  LooseEquality,
  StrictEquality,
  isPrimitiveLiteral,
  foldBinaryOperator,
  foldStringAddition,
  StringAdditionNormal,
  StringAdditionWithNestedLeft,
} from "./js_ast_helpers.mjs";
import { rangeOfIdentifier, StrictModeReservedWords } from "./js_lexer.mjs";
import {
  ModePassThrough,
  ModeBundle,
  FormatPreserve,
  FormatESModule,
  formatKeepESMImportExportSyntax,
  CanBeRemovedIfUnused as DefineFlagCanBeRemovedIfUnused,
  CallCanBeUnwrappedIfUnused as DefineFlagCallCanBeUnwrappedIfUnused,
  MethodCallsMustBeReplacedWithUndefined,
  IsSymbolInstance,
} from "./config.mjs";
import {
  exprIn,
  exprOut,
  EXPR_IN_DEFAULT,
  EXPR_OUT_DEFAULT,
  binaryExprVisitor,
  identifierOpts,
  visitFnOpts,
  visitArgsOpts,
  prependTempRefsOpts,
  stmtsFnBody,
  thenCatchChain,
  fnOrArrowDataVisit,
  fnOnlyDataVisit,
  exprKindCall,
  exprKindNew,
  exprKindJSXTag,
  importNamespaceCallKey,
  JSXImportJSX,
  JSXImportJSXS,
  JSXImportFragment,
  JSXImportCreateElement,
  legacyOctalEscape,
  legacyOctalLiteral,
  reservedWord,
  deleteBareName,
  duplicatePropertiesInObject,
  checkBothOrders,
  objRestMustReturnInitExpr,
  objRestReturnValueIsUnused,
  valueCouldBeMutated,
} from "./js_parser_types.mjs";
import { defineValueCanBeUsedInAssignTarget } from "./js_parser_parse.mjs";
import { isUnsightlyPrimitive } from "./js_parser_visit_stmt2.mjs";

// ---------------------------------------------------------------------------
// Local helpers

// Side channel for the exprOut of visitExprInOutImpl (see the header).
let lastOut = EXPR_OUT_DEFAULT;

// Shared, frozen exprIn values (never mutated; see the header)
const IN_CHAIN_PARENT = Object.freeze(new exprIn(false, false, true));
const IN_STORE_THIS = Object.freeze(new exprIn(false, false, false, true));
const IN_CHAIN_PARENT_STORE_THIS = Object.freeze(new exprIn(false, false, true, true));
const IN_MANGLE_STRINGS = Object.freeze(new exprIn(false, false, false, false, true));
const IN_ASSIGN_REPLACE = Object.freeze(new exprIn(false, false, false, false, false, AssignTargetReplace));
const IN_ASSIGN_UPDATE = Object.freeze(new exprIn(false, false, false, false, false, AssignTargetUpdate));

// exprIn{assignTarget: t}
function inForAssignTarget(t) {
  if (t === AssignTargetNone) return EXPR_IN_DEFAULT;
  if (t === AssignTargetReplace) return IN_ASSIGN_REPLACE;
  return IN_ASSIGN_UPDATE;
}

// exprIn{hasChainParent: a, storeThisArgForParentOptionalChain: b}
function inForChain(hasChainParent, storeThisArgForParentOptionalChain) {
  if (hasChainParent) return storeThisArgForParentOptionalChain ? IN_CHAIN_PARENT_STORE_THIS : IN_CHAIN_PARENT;
  return storeThisArgForParentOptionalChain ? IN_STORE_THIS : EXPR_IN_DEFAULT;
}

// exprIn{shouldMangleStringsAsProps: b}
function inForMangleStrings(shouldMangleStringsAsProps) {
  return shouldMangleStringsAsProps ? IN_MANGLE_STRINGS : EXPR_IN_DEFAULT;
}

// exprOut{...}; returns the shared default when every field is the zero value
function mkOut(
  thisArgFunc,
  thisArgWrapFunc,
  childContainsOptionalChain,
  callMustBeReplacedWithUndefined,
  methodCallMustBeReplacedWithUndefined,
) {
  if (
    thisArgFunc === null &&
    thisArgWrapFunc === null &&
    !childContainsOptionalChain &&
    !callMustBeReplacedWithUndefined &&
    !methodCallMustBeReplacedWithUndefined
  ) {
    return EXPR_OUT_DEFAULT;
  }
  return new exprOut(
    thisArgFunc,
    thisArgWrapFunc,
    childContainsOptionalChain,
    callMustBeReplacedWithUndefined,
    methodCallMustBeReplacedWithUndefined,
  );
}

const OUT_METHOD_CALL_MUST_BE_REPLACED_WITH_UNDEFINED = Object.freeze(new exprOut(null, null, false, false, true));

// "p.options.unsupportedJSFeatures.Has(compat.InlineScript)". compat is not
// ported; compat.InlineScript is bit 36 of compat.JSFeature (a uint64).
// NOTE: esbuild's bundler.applyOptionDefaults sets this bit whenever the
// platform is not "browser" (unless overridden); the API layer is expected to
// pass a matching unsupportedJSFeatures value (0 means "supported").
function unsupportedJSFeaturesHasInlineScript(p) {
  const f = p.options.unsupportedJSFeatures;
  if (typeof f === "bigint") return ((f >> 36n) & 1n) === 1n;
  if (!f) return false;
  return Math.floor(f / 68719476736) % 2 === 1;
}

function visitExprImpl(p, expr) {
  return visitExprInOutImpl(p, expr, EXPR_IN_DEFAULT);
}

// ---------------------------------------------------------------------------
// Package-level functions

export function locAfterOp(e) {
  if (e.left.loc < e.right.loc) {
    return e.right.loc;
  } else {
    // Handle the case when we have transposed the operands
    return e.left.loc;
  }
}

// This function exists to tie all of these checks together in one place
export function isEvalOrArguments(name) {
  return name === "eval" || name === "arguments";
}

// Go: strings.EqualFold(text[:6], "script") after each "</". Six bytes can
// only fold-match "script" if they are all ASCII, so an ASCII comparison on
// UTF-16 code units is equivalent.
export function containsClosingScriptTag(text) {
  let start = 0;
  for (;;) {
    const i = text.indexOf("</", start);
    if (i < 0) {
      break;
    }
    start = i + 2;
    if (text.length - start >= 6 && equalFoldASCII6(text, start, "script")) {
      return true;
    }
  }
  return false;
}

function equalFoldASCII6(text, start, lower) {
  for (let j = 0; j < 6; j++) {
    let c = text.charCodeAt(start + j);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== lower.charCodeAt(j)) return false;
  }
  return true;
}

// Go: func remapExprLocsInJSON(expr *js_ast.Expr, table []logger.StringInJSTableEntry)
// This is only used by the Yarn PnP manifest hack (never in the fast path).
export function remapExprLocsInJSON(expr, table) {
  bail();
}

// ---------------------------------------------------------------------------
// valueForThis / valueForImportMeta

// Returns the substituted value, or undefined for Go's "ok == false". (A
// define may in theory instantiate to a nil Expr, which is returned as null
// with ok == true.)
function valueForThisImpl(p, loc, shouldLog, assignTarget, isCallTarget, isDeleteTarget) {
  // Substitute "this" if we're inside a static class context
  if (p.fnOnlyDataVisit.shouldReplaceThisWithInnerClassNameRef) {
    p.recordUsage(p.fnOnlyDataVisit.innerClassNameRef);
    return new Expr(new EIdentifier(p.fnOnlyDataVisit.innerClassNameRef), loc);
  }

  // Is this a top-level use of "this"?
  if (!p.fnOnlyDataVisit.isThisNested) {
    // Substitute user-specified defines
    const data = p.options.defines.identifierDefines.get("this");
    if (data !== undefined) {
      if (data.defineExpr !== null) {
        return p.instantiateDefineExpr(loc, data.defineExpr, new identifierOpts(assignTarget, isCallTarget, isDeleteTarget));
      }
    }

    // Otherwise, replace top-level "this" with either "undefined" or "exports"
    if (p.isFileConsideredToHaveESMExports) {
      // Warn about "this" becoming undefined, but only once per file
      if (shouldLog && !p.messageAboutThisIsUndefined && !p.fnOnlyDataVisit.silenceMessageAboutThisBeingUndefined) {
        p.messageAboutThisIsUndefined = true;
        // (The message itself has kind logger.Debug and is dropped)
      }

      // In an ES6 module, "this" is supposed to be undefined. Instead of
      // doing this at runtime using "fn.call(undefined)", we do it at
      // compile time using expression substitution here.
      return new Expr(EUndefinedShared, loc);
    } else if (p.options.mode !== ModePassThrough) {
      // In a CommonJS module, "this" is supposed to be the same as "exports".
      // Instead of doing this at runtime using "fn.call(module.exports)", we
      // do it at compile time using expression substitution here.
      p.recordUsage(p.exportsRef);
      return new Expr(new EIdentifier(p.exportsRef), loc);
    }
  }

  return undefined;
}

// Returns the substituted value or null (Go's "ok == false")
function valueForImportMetaImpl(p, loc) {
  // (compat.ImportMeta is always supported in the fast path)
  if (p.options.mode !== ModePassThrough && !formatKeepESMImportExportSyntax(p.options.outputFormat)) {
    // Generate the variable if it doesn't exist yet
    if (p.importMetaRef === InvalidRef) {
      p.importMetaRef = p.newSymbol(SymbolOther, "import_meta");
      p.moduleScope.generated.push(p.importMetaRef);
    }

    // Replace "import.meta" with a reference to the symbol
    p.recordUsage(p.importMetaRef);
    return new Expr(new EIdentifier(p.importMetaRef), loc);
  }

  return null;
}

// ---------------------------------------------------------------------------
// isUnsupportedRegularExpression

// Returns [pattern, flags, isUnsupported]. The scan is ASCII-driven, so
// scanning UTF-16 code units gives the same result as Go's byte scan (the
// computed ranges are only used for log messages).
function isUnsupportedRegularExpressionImpl(p, loc, value) {
  let isUnsupported = false;

  const end = value.lastIndexOf("/");
  const pattern = value.slice(1, end);
  const flags = value.slice(end + 1);
  // (isUnicode is only needed for the compat.RegexpUnicodePropertyEscapes check)
  let parenDepth = 0;
  let i = 0;

  // Do a simple scan for unsupported features assuming the regular expression
  // is valid. This doesn't do a full validation of the regular expression
  // because regular expression grammar is complicated. If it contains a syntax
  // error that we don't catch, then we will just generate output code with a
  // syntax error. Garbage in, garbage out.
  while (i < pattern.length) {
    const c = pattern.charCodeAt(i);
    i++;

    switch (c) {
      case 91 /* [ */:
        classLoop: while (i < pattern.length) {
          const c2 = pattern.charCodeAt(i);
          i++;

          switch (c2) {
            case 93 /* ] */:
              break classLoop;

            case 92 /* \ */:
              i++; // Skip the escaped character
              break;
          }
        }
        break;

      case 40 /* ( */:
        // (Lookbehind assertions and named capture groups: compat.RegexpLookbehindAssertions
        // and compat.RegexpNamedCaptureGroups are always supported in the fast path)
        parenDepth++;
        break;

      case 41 /* ) */:
        if (parenDepth === 0) {
          p.log.addError(); // Unexpected ")" in regular expression
          return [pattern, flags, isUnsupported];
        }
        parenDepth--;
        break;

      case 92 /* \ */:
        // (Unicode property escapes: compat.RegexpUnicodePropertyEscapes is
        // always supported in the fast path)
        i++; // Skip the escaped character
        break;
    }
  }

  if (!isUnsupported) {
    for (let j = 0; j < flags.length; j++) {
      const c = flags.charCodeAt(j);
      switch (c) {
        case 103 /* g */:
        case 105 /* i */:
        case 109 /* m */:
          continue; // These are part of ES5 and are always supported

        case 115 /* s */:
          continue; // This is part of ES2018 (compat.RegexpDotAllFlag is supported)

        case 121 /* y */:
        case 117 /* u */:
          continue; // These are part of ES2018 (compat.RegexpStickyAndUnicodeFlags is supported)

        case 100 /* d */:
          continue; // This is part of ES2022 (compat.RegexpMatchIndices is supported)

        case 118 /* v */:
          continue; // compat.RegexpSetNotation is supported

        default:
        // Unknown flags are never supported
      }

      isUnsupported = true;
      break;
    }
  }

  if (isUnsupported) {
    // (The message has kind logger.Debug and is dropped)
  }

  return [pattern, flags, isUnsupported];
}

// ---------------------------------------------------------------------------
// visitExprInOut

// This function takes "exprIn" as input from the caller and produces "exprOut"
// for the caller to pass along extra data. This is mostly for optional chaining.
// Returns the Expr; the exprOut is stored in "lastOut".
function visitExprInOutImpl(p, expr, in_) {
  if (in_.assignTarget !== AssignTargetNone && !p.isValidAssignmentTarget(expr)) {
    p.log.addError(); // Invalid assignment target
  }

  // Note: Anything added before or after this switch statement will be bypassed
  // when visiting nested "EBinary" nodes due to stack overflow mitigations for
  // deeply-nested ASTs. If anything like that is added, care must be taken that
  // it doesn't affect these mitigations by ensuring that the mitigations are not
  // applied in those cases (e.g. by adding an additional conditional check).
  const e = expr.data;
  switch (e.k) {
    case E_NULL:
    case E_SUPER:
    case E_BOOLEAN:
    case E_UNDEFINED:
    case E_JSX_TEXT:
      break;

    case E_BIG_INT:
      // (compat.Bigint is always supported in the fast path)
      break;

    case E_NAME_OF_SYMBOL:
      e.ref = p.symbolForMangledProp(p.loadNameFromRef(e.ref));
      break;

    case E_REG_EXP: {
      // "/pattern/flags" => "new RegExp('pattern', 'flags')"
      const $d128 = isUnsupportedRegularExpressionImpl(p, expr.loc, e.value);
      const pattern = $d128[0], flags = $d128[1], ok = $d128[2];
      if (ok) {
        const args = [new Expr(new EString(pattern), expr.loc + 1)];
        if (flags !== "") {
          args.push(new Expr(new EString(flags), expr.loc + pattern.length + 2));
        }
        const regExpRef = p.makeRegExpRef();
        p.recordUsage(regExpRef);
        const result = new Expr(
          new ENew(new Expr(new EIdentifier(regExpRef), expr.loc), args, expr.loc + e.value.length),
          expr.loc,
        );
        lastOut = EXPR_OUT_DEFAULT;
        return result;
      }
      break;
    }

    case E_NEW_TARGET:
      if (!p.fnOnlyDataVisit.isNewTargetAllowed) {
        p.log.addError(); // Cannot use "new.target" here:
      }
      break;

    case E_STRING:
      if (e.legacyOctalLoc > 0) {
        if (e.preferTemplate) {
          p.log.addError(); // Legacy octal escape sequences cannot be used in template literals
        } else if (p.isStrictMode()) {
          p.markStrictModeFeature(legacyOctalEscape, p.source.rangeOfLegacyOctalEscape(e.legacyOctalLoc), "");
        }
      }

      // (mangleQuoted only: strings as mangled property names)
      break;

    case E_NUMBER:
      if (p.legacyOctalLiterals != null && p.isStrictMode()) {
        const r = p.legacyOctalLiterals.get(expr.data);
        if (r !== undefined) {
          p.markStrictModeFeature(legacyOctalLiteral, r, "");
        }
      }
      break;

    case E_THIS: {
      const isDeleteTarget = e === p.deleteTarget;
      const isCallTarget = e === p.callTarget;

      p.fnOnlyDataVisit.hasThisUsage = true;

      // Note: the Go code passes these two flags in swapped positions
      const value = valueForThisImpl(p, expr.loc, true /* shouldLog */, in_.assignTarget, isDeleteTarget, isCallTarget);
      if (value !== undefined) {
        lastOut = EXPR_OUT_DEFAULT;
        return value;
      }

      // (compat.Arrow is always supported: "this" is never captured here)
      break;
    }

    case E_IMPORT_META:
      expr = visitEImportMeta(p, expr, e, in_);
      break;

    case E_SPREAD:
      e.value = visitExprImpl(p, e.value);
      break;

    case E_IDENTIFIER:
      return visitEIdentifier(p, expr, e, in_);

    case E_JSX_ELEMENT:
      expr = visitEJSXElement(p, expr, e);
      break;

    case E_TEMPLATE:
      expr = visitETemplate(p, expr, e);
      break;

    case E_BINARY:
      expr = visitEBinary(p, expr, e, in_);
      break;

    case E_DOT:
      return visitEDot(p, expr, e, in_);

    case E_INDEX:
      return visitEIndex(p, expr, e, in_);

    case E_UNARY:
      return visitEUnary(p, expr, e, in_);

    case E_IF:
      visitEIf(p, e, in_);
      break;

    case E_AWAIT:
      return visitEAwait(p, expr, e, in_);

    case E_YIELD:
      if (e.valueOrNil !== null) {
        e.valueOrNil = visitExprImpl(p, e.valueOrNil);
      }

      // (compat.AsyncGenerator is always supported: no "__yieldStar")
      break;

    case E_ARRAY:
      visitEArray(p, e, in_);
      break;

    case E_OBJECT:
      expr = visitEObject(p, expr, e, in_);
      break;

    case E_IMPORT_CALL:
      expr = visitEImportCall(p, expr, e);
      break;

    case E_CALL:
      return visitECall(p, expr, e, in_);

    case E_NEW: {
      e.target = visitExprImpl(p, e.target);
      p.warnAboutImportNamespaceCall(e.target, exprKindNew);

      const args = e.args;
      for (let i = 0; i < args.length; i++) {
        args[i] = visitExprImpl(p, args[i]);
      }

      // (minifySyntax only: "new foo(1, ...[2, 3], 4)" => "new foo(1, 2, 3, 4)")

      p.maybeMarkKnownGlobalConstructorAsPure(e);
      break;
    }

    case E_ARROW:
      visitEArrow(p, expr, e);
      break;

    case E_FUNCTION:
      // (The propagated name to keep is only used by keepNames)
      p.visitFn(e.fn, expr.loc, new visitFnOpts(in_.isMethod, e === p.propDerivedCtorValue, in_.isLoweredPrivateMethod));

      // (minifySyntax only: remove unused function names)
      // (keepNames only: preserve the name)
      break;

    case E_CLASS: {
      // Check for a propagated name to keep from the parent context
      let nameToKeep = "";
      if (p.nameToKeepIsFor === e) {
        nameToKeep = p.nameToKeep;
      }

      const result = p.visitClass(expr.loc, e.class, InvalidRef, nameToKeep);

      // Lower class field syntax for browsers that don't support it
      expr = p.lowerClass(null, expr, result, nameToKeep)[1];

      // We may be able to determine that a class is side-effect before lowering
      // but not after lowering (e.g. due to "--keep-names" mutating the object).
      // If that's the case, add a special annotation so this doesn't prevent
      // tree-shaking from happening.
      if (result.canBeRemovedIfUnused) {
        expr = new Expr(new EAnnotation(expr, CanBeRemovedIfUnusedFlag), expr.loc);
      }
      break;
    }

    default:
      // Note: EPrivateIdentifier should have already been handled
      // (Go panics: "Unexpected expression of type %T")
      bail();
  }

  lastOut = EXPR_OUT_DEFAULT;
  return expr;
}

// ---------------------------------------------------------------------------
// Per-kind helpers for visitExprInOutImpl. Helpers that are tail-called
// ("return visitX(...)") set lastOut themselves; the others return the
// resulting Expr and the caller sets lastOut to the default.

function visitEImportMeta(p, expr, e, in_) {
  const isDeleteTarget = e === p.deleteTarget;
  const isCallTarget = e === p.callTarget;

  // Check both user-specified defines and known globals
  const defines = p.options.defines.dotDefines.get("meta");
  if (defines !== undefined) {
    for (const define of defines) {
      if (p.isDotOrIndexDefineMatch(expr, define.keyParts)) {
        // Substitute user-specified defines
        if (define.defineExpr !== null) {
          return p.instantiateDefineExpr(expr.loc, define.defineExpr, new identifierOpts(in_.assignTarget, isCallTarget, isDeleteTarget));
        }
      }
    }
  }

  // Check injected dot names
  if (p.injectedDotNames != null) {
    const names = p.injectedDotNames.get("meta");
    if (names !== undefined) {
      for (const name of names) {
        if (p.isDotOrIndexDefineMatch(expr, name.parts)) {
          // Note: We don't need to "ignoreRef" on the underlying identifier
          // because we have only parsed it but not visited it yet
          return p.instantiateInjectDotName(expr.loc, name, in_.assignTarget);
        }
      }
    }
  }

  // Warn about "import.meta" if it's not replaced by a define
  // (compat.ImportMeta is always supported in the fast path)
  if (p.options.mode !== ModePassThrough && !formatKeepESMImportExportSyntax(p.options.outputFormat)) {
    let kind = Warning;
    if (p.suppressWarningsAboutWeirdCode || p.fnOrArrowDataVisit.tryBodyCount > 0) {
      kind = Debug;
    }
    p.log.addIDWithNotes(MsgID_JS_EmptyImportMeta, kind);
  }

  // Convert "import.meta" to a variable if it's not supported in the output format
  const importMeta = valueForImportMetaImpl(p, expr.loc);
  if (importMeta !== null) {
    return importMeta;
  }

  return expr;
}

// Sets lastOut
function visitEIdentifier(p, expr, e, in_) {
  const isCallTarget = e === p.callTarget;
  const isDeleteTarget = e === p.deleteTarget;
  const name = p.loadNameFromRef(e.ref);
  if (p.isStrictMode() && StrictModeReservedWords.has(name)) {
    p.markStrictModeFeature(reservedWord, rangeOfIdentifier(p.source, expr.loc), name);
  }
  const found = p.findSymbol(expr.loc, name);
  // (findSymbol reuses its result object: copy the fields)
  const resultRef = found.ref;
  const resultIsInsideWithScope = found.isInsideWithScope;
  e.mustKeepDueToWithStmt = resultIsInsideWithScope;
  e.ref = resultRef;

  // Handle referencing a class name within that class's computed property
  // key. This is not allowed, and must fail at run-time:
  //
  //   class Foo {
  //     static foo = 'bar'
  //     static [Foo.foo] = 'foo'
  //   }
  //
  if (p.symbols[refInner(resultRef)].kind === SymbolClassInComputedPropertyKey) {
    p.log.addID(MsgID_JS_ClassNameWillThrow, Warning);
    const value = p.callRuntime(expr.loc, "__earlyAccess", [new Expr(new EString(name), expr.loc)]);
    lastOut = EXPR_OUT_DEFAULT;
    return value;
  }

  // Handle assigning to a constant
  if (in_.assignTarget !== AssignTargetNone) {
    switch (p.symbols[refInner(resultRef)].kind) {
      case SymbolConst:
        // Make this an error when bundling because we may need to convert this
        // "const" into a "var" during bundling. Also make this an error when
        // the constant is inlined because we will otherwise generate code with
        // a syntax error.
        if (
          (p.constValues != null && p.constValues.has(resultRef)) ||
          p.options.mode === ModeBundle ||
          (p.currentScope.parent === null && p.willWrapModuleInTryCatchForUsing)
        ) {
          p.log.addErrorWithNotes(); // Cannot assign to %q because it is a constant
        } else {
          p.log.addIDWithNotes(MsgID_JS_AssignToConstant, Warning);
        }
        break;

      case SymbolInjected:
        if (p.injectedSymbolSources != null && p.injectedSymbolSources.has(resultRef)) {
          p.log.addErrorWithNotes(); // Cannot assign to %q because it's an import from an injected file
        }
        break;
    }
  }

  // Substitute user-specified defines for unbound or injected symbols
  let methodCallMustBeReplacedWithUndefined = false;
  if (symbolKindIsUnboundOrInjected(p.symbols[refInner(e.ref)].kind) && !resultIsInsideWithScope && e !== p.deleteTarget) {
    const data = p.options.defines.identifierDefines.get(name);
    if (data !== undefined) {
      if (data.defineExpr !== null) {
        const new_ = p.instantiateDefineExpr(expr.loc, data.defineExpr, new identifierOpts(in_.assignTarget, isCallTarget, isDeleteTarget));
        if (in_.assignTarget === AssignTargetNone || (new_ !== null && defineValueCanBeUsedInAssignTarget(new_.data))) {
          p.ignoreUsage(e.ref);
          lastOut = EXPR_OUT_DEFAULT;
          return new_;
        } else {
          p.logAssignToDefine(rangeOfIdentifier(p.source, expr.loc), name, null);
        }
      }

      // Copy the side effect flags over in case this expression is unused
      if ((data.flags & DefineFlagCanBeRemovedIfUnused) !== 0) {
        e.canBeRemovedIfUnused = true;
      }
      if ((data.flags & DefineFlagCallCanBeUnwrappedIfUnused) !== 0 && !p.options.ignoreDCEAnnotations) {
        e.callCanBeUnwrappedIfUnused = true;
      }
      if ((data.flags & MethodCallsMustBeReplacedWithUndefined) !== 0) {
        methodCallMustBeReplacedWithUndefined = true;
      }
    }
  }

  const value = p.handleIdentifier(
    expr.loc,
    e,
    handleIdentifierOptsFor(in_.assignTarget, isCallTarget, isDeleteTarget),
    expr,
  );
  lastOut = methodCallMustBeReplacedWithUndefined ? OUT_METHOD_CALL_MUST_BE_REPLACED_WITH_UNDEFINED : EXPR_OUT_DEFAULT;
  return value;
}

// identifierOpts{AssignTarget, IsCallTarget, IsDeleteTarget,
// WasOriginallyIdentifier: true} for visitEIdentifier. handleIdentifier only
// reads its options, so one instance per combination is shared.
// (Built on first use: the parser modules import each other.)
let HANDLE_IDENTIFIER_OPTS = null;
function handleIdentifierOptsFor(assignTarget, isCallTarget, isDeleteTarget) {
  if (HANDLE_IDENTIFIER_OPTS === null) {
    HANDLE_IDENTIFIER_OPTS = [];
    for (let a = 0; a < 3; a++) {
      for (let c = 0; c < 2; c++) {
        for (let d = 0; d < 2; d++) {
          HANDLE_IDENTIFIER_OPTS.push(new identifierOpts(a, c === 1, d === 1, false, true /* wasOriginallyIdentifier */));
        }
      }
    }
  }
  return HANDLE_IDENTIFIER_OPTS[assignTarget * 4 + (isCallTarget ? 2 : 0) + (isDeleteTarget ? 1 : 0)];
}

function visitEJSXElement(p, expr, e) {
  let propsLoc = expr.loc;

  // Resolving the location index to a specific line and column in
  // development mode is not too expensive because we seek from the
  // previous JSX element. It amounts to at most a single additional
  // scan over the source code. Note that this has to happen before
  // we visit anything about this JSX element to make sure that we
  // only ever need to scan forward, not backward.
  let jsxSourceLine = 0;
  let jsxSourceColumn = 0;
  if (p.options.jsx.development && p.options.jsx.automaticRuntime) {
    const contents = p.source.contents;
    while (p.jsxSourceLoc < propsLoc) {
      const r = codePointAt(contents, p.jsxSourceLoc);
      p.jsxSourceLoc += r > 0xffff ? 2 : 1;
      if (r === 10 || r === 13 || r === 0x2028 || r === 0x2029) {
        if (r === 13 && p.jsxSourceLoc < contents.length && contents.charCodeAt(p.jsxSourceLoc) === 10) {
          p.jsxSourceLoc++; // Handle Windows-style CRLF newlines
        }
        p.jsxSourceLine++;
        p.jsxSourceColumn = 0;
      } else {
        // Babel and TypeScript count columns in UTF-16 code units
        if (r < 0xffff) {
          p.jsxSourceColumn++;
        } else {
          p.jsxSourceColumn += 2;
        }
      }
    }
    jsxSourceLine = p.jsxSourceLine;
    jsxSourceColumn = p.jsxSourceColumn;
  }

  if (e.tagOrNil !== null) {
    propsLoc = e.tagOrNil.loc;
    e.tagOrNil = visitExprImpl(p, e.tagOrNil);
    p.warnAboutImportNamespaceCall(e.tagOrNil, exprKindJSXTag);
  }

  // Visit properties
  for (let $i47 = 0, $a47 = e.properties; $i47 < $a47.length; $i47++) {
    const property = $a47[$i47];
    if (property.kind === PropertySpread) {
      // (hasSpread is only used when minifying)
    } else {
      const mangled = property.key.data;
      if (mangled.k === E_NAME_OF_SYMBOL) {
        mangled.ref = p.symbolForMangledProp(p.loadNameFromRef(mangled.ref));
      } else {
        property.key = visitExprImpl(p, property.key);
      }
    }
    if (property.valueOrNil !== null) {
      property.valueOrNil = visitExprImpl(p, property.valueOrNil);
    }
    if (property.initializerOrNil !== null) {
      property.initializerOrNil = visitExprImpl(p, property.initializerOrNil);
    }
  }

  // (minifySyntax only: "{a, ...{b, c}, d}" => "{a, b, c, d}")

  // Visit children
  const nullableChildren = e.nullableChildren === null ? [] : e.nullableChildren;
  if (nullableChildren.length > 0) {
    for (let i = 0; i < nullableChildren.length; i++) {
      const childOrNil = nullableChildren[i];
      if (childOrNil !== null && childOrNil.data !== null) {
        nullableChildren[i] = visitExprImpl(p, childOrNil);
      }
    }
  }

  if (p.options.jsx.preserve) {
    // If the tag is an identifier, mark it as needing to be upper-case
    if (e.tagOrNil !== null) {
      const tag = e.tagOrNil.data;
      switch (tag.k) {
        case E_IDENTIFIER:
          p.symbols[refInner(tag.ref)].flags |= MustStartWithCapitalLetterForJSX;
          break;

        case E_IMPORT_IDENTIFIER:
          p.symbols[refInner(tag.ref)].flags |= MustStartWithCapitalLetterForJSX;
          break;
      }
    }
    return expr;
  }

  // Remove any nil children in the array (in place) before iterating over it
  let children = nullableChildren;
  {
    let end = 0;
    for (let i = 0; i < children.length; i++) {
      const childOrNil = children[i];
      if (childOrNil !== null && childOrNil.data !== null) {
        children[end] = childOrNil;
        end++;
      }
    }
    if (end !== children.length) {
      children = children.slice(0, end);
    }
  }

  // A missing tag is a fragment
  if (e.tagOrNil === null) {
    if (p.options.jsx.automaticRuntime) {
      e.tagOrNil = p.importJSXSymbol(expr.loc, JSXImportFragment);
    } else {
      e.tagOrNil = p.instantiateDefineExpr(
        expr.loc,
        p.options.jsx.fragment,
        new identifierOpts(AssignTargetNone, false, false, false, true /* wasOriginallyIdentifier */, true /* matchAgainstDefines */),
      );
    }
  }

  let shouldUseCreateElement = !p.options.jsx.automaticRuntime;
  if (!shouldUseCreateElement) {
    // Even for runtime="automatic", <div {...props} key={key} /> is special cased to createElement
    // See https://github.com/babel/babel/blob/e482c763466ba3f44cb9e3467583b78b7f030b4a/packages/babel-plugin-transform-react-jsx/src/create-plugin.ts#L352
    let seenPropsSpread = false;
    for (let $i48 = 0, $a48 = e.properties; $i48 < $a48.length; $i48++) {
      const property = $a48[$i48];
      if (seenPropsSpread && property.kind === PropertyField) {
        const str = property.key !== null ? property.key.data : null;
        if (str !== null && str.k === E_STRING && str.value === "key") {
          shouldUseCreateElement = true;
          break;
        }
      } else if (property.kind === PropertySpread) {
        seenPropsSpread = true;
      }
    }
  }

  if (shouldUseCreateElement) {
    // Arguments to createElement()
    const args = [e.tagOrNil];
    if (e.properties.length > 0) {
      args.push(p.lowerObjectSpread(propsLoc, new EObject(e.properties, 0, 0, e.isTagSingleLine)));
    } else {
      args.push(new Expr(ENullShared, propsLoc));
    }
    if (children.length > 0) {
      for (let i = 0; i < children.length; i++) {
        args.push(children[i]);
      }
    }

    // Call createElement()
    let target;
    let kind = NormalCall;
    if (p.options.jsx.automaticRuntime) {
      target = p.importJSXSymbol(expr.loc, JSXImportCreateElement);
    } else {
      target = p.instantiateDefineExpr(
        expr.loc,
        p.options.jsx.factory,
        new identifierOpts(AssignTargetNone, false, false, false, true /* wasOriginallyIdentifier */, true /* matchAgainstDefines */),
      );
      if (target !== null && isPropertyAccess(target)) {
        kind = TargetWasOriginallyPropertyAccess;
      }
      p.warnAboutImportNamespaceCall(target, exprKindCall);
    }
    return new Expr(
      new ECall(
        target,
        args,
        e.closeLoc,
        OptionalChainNone,
        kind,
        !e.isTagSingleLine,

        // Enable tree shaking
        !p.options.ignoreDCEAnnotations && !p.options.jsx.sideEffects,
      ),
      expr.loc,
    );
  } else {
    // Arguments to jsx()
    const args = [e.tagOrNil];

    // Props argument
    const properties = [];

    // For jsx(), "key" is passed in as a separate argument, so filter it out
    // from the props here. Also, check for __source and __self, which might have
    // been added by some upstream plugin. Their presence here would represent a
    // configuration error.
    let hasKey = false;
    let keyProperty = new Expr(EUndefinedShared, expr.loc);
    for (let $i49 = 0, $a49 = e.properties; $i49 < $a49.length; $i49++) {
      const property = $a49[$i49];
      const str = property.key !== null ? property.key.data : null;
      if (str !== null && str.k === E_STRING) {
        const propName = str.value;
        switch (propName) {
          case "key": {
            const boolean = property.valueOrNil !== null ? property.valueOrNil.data : null;
            if (boolean !== null && boolean.k === E_BOOLEAN && boolean.value && (property.flags & PropertyWasShorthand) !== 0) {
              p.log.addError(); // Please provide an explicit value for "key":
            } else {
              keyProperty = property.valueOrNil;
              hasKey = true;
            }
            continue;
          }

          case "__source":
          case "__self":
            p.log.addErrorWithNotes(); // Duplicate "%s" prop found:
            continue;
        }
      }
      properties.push(property);
    }

    let isStaticChildren = children.length > 1;

    // Children are passed in as an explicit prop
    if (children.length > 0) {
      let childrenValue = children[0];

      if (children.length > 1) {
        childrenValue = new Expr(new EArray(children), childrenValue.loc);
      } else if (childrenValue.data.k === E_SPREAD) {
        // TypeScript considers spread children to be static, but Babel considers
        // it to be an error ("Spread children are not supported in React.").
        // We'll follow TypeScript's behavior here because spread children may be
        // valid with non-React source runtimes.
        childrenValue = new Expr(new EArray([childrenValue]), childrenValue.loc);
        isStaticChildren = true;
      }

      properties.push(
        new Property(
          null,
          new Expr(new EString("children"), childrenValue.loc),
          childrenValue,
          null,
          [],
          childrenValue.loc,
          0,
          PropertyField,
          0,
        ),
      );
    }

    args.push(p.lowerObjectSpread(propsLoc, new EObject(properties, 0, 0, e.isTagSingleLine)));

    // "key"
    if (hasKey || p.options.jsx.development) {
      args.push(keyProperty);
    }

    if (p.options.jsx.development) {
      // "isStaticChildren"
      args.push(new Expr(new EBoolean(isStaticChildren), expr.loc));

      // "__source"
      args.push(
        new Expr(
          new EObject([
            new Property(
              null,
              new Expr(new EString("fileName"), expr.loc),
              new Expr(new EString(p.source.prettyPaths.select(p.options.codePathStyle)), expr.loc),
              null,
              [],
              0,
              0,
              PropertyField,
              0,
            ),
            new Property(
              null,
              new Expr(new EString("lineNumber"), expr.loc),
              new Expr(new ENumber(jsxSourceLine + 1), expr.loc), // 1-based lines
              null,
              [],
              0,
              0,
              PropertyField,
              0,
            ),
            new Property(
              null,
              new Expr(new EString("columnNumber"), expr.loc),
              new Expr(new ENumber(jsxSourceColumn + 1), expr.loc), // 1-based columns
              null,
              [],
              0,
              0,
              PropertyField,
              0,
            ),
          ]),
          expr.loc,
        ),
      );

      // "__self"
      let __self = new Expr(EThisShared, expr.loc);
      {
        if (p.fnOnlyDataVisit.shouldReplaceThisWithInnerClassNameRef) {
          // Substitute "this" if we're inside a static class context
          p.recordUsage(p.fnOnlyDataVisit.innerClassNameRef);
          __self = new Expr(new EIdentifier(p.fnOnlyDataVisit.innerClassNameRef), expr.loc);
        } else if (!p.fnOnlyDataVisit.isThisNested && p.options.mode !== ModePassThrough) {
          // Replace top-level "this" with "undefined" if there's an output format
          __self = new Expr(EUndefinedShared, expr.loc);
        } else if (p.fnOrArrowDataVisit.isDerivedClassCtor) {
          // We can't use "this" here in case it comes before "super()"
          __self = new Expr(EUndefinedShared, expr.loc);
        }
      }
      if (__self.data.k !== E_UNDEFINED) {
        // Omit "__self" entirely if it's undefined
        args.push(__self);
      }
    }

    let jsx = JSXImportJSX;
    if (isStaticChildren) {
      jsx = JSXImportJSXS;
    }

    return new Expr(
      new ECall(
        p.importJSXSymbol(expr.loc, jsx),
        args,
        e.closeLoc,
        OptionalChainNone,
        NormalCall,
        !e.isTagSingleLine,

        // Enable tree shaking
        !p.options.ignoreDCEAnnotations && !p.options.jsx.sideEffects,
      ),
      expr.loc,
    );
  }
}

function visitETemplate(p, expr, e) {
  if (e.legacyOctalLoc > 0) {
    p.log.addError(); // Legacy octal escape sequences cannot be used in template literals
  }

  let tagThisFunc = null;
  let tagWrapFunc = null;

  if (e.tagOrNil !== null) {
    // Capture the value for "this" if the tag is a lowered optional chain.
    // We'll need to manually apply this value later to preserve semantics.
    // (compat.OptionalChain is always supported in the fast path)
    const tagIsLoweredOptionalChain = false;

    p.templateTag = e.tagOrNil.data;
    const tag = visitExprInOutImpl(p, e.tagOrNil, inForChain(false, tagIsLoweredOptionalChain));
    const tagOut = lastOut;
    e.tagOrNil = tag;
    tagThisFunc = tagOut.thisArgFunc;
    tagWrapFunc = tagOut.thisArgWrapFunc;

    // Copy the call side effect flag over if this is a known target
    if (
      tag !== null &&
      tag.data.k === E_IDENTIFIER &&
      (p.symbols[refInner(tag.data.ref)].flags & SymbolFlagCallCanBeUnwrappedIfUnused) !== 0
    ) {
      e.canBeUnwrappedIfUnused = true;
    }

    // The value of "this" must be manually preserved for private member
    // accesses inside template tag expressions such as "this.#foo``".
    // The private member "this.#foo" must see the value of "this".
    const $d129 = p.extractPrivateIndex(e.tagOrNil);
    const target = $d129[0], loc = $d129[1], private_ = $d129[2];
    if (private_ != null) {
      // "foo.#bar`123`" => "__privateGet(_a = foo, #bar).bind(_a)`123`"
      const $d130 = p.captureValueWithPossibleSideEffects(target.loc, 2, target, valueCouldBeMutated);
      const targetFunc = $d130[0], targetWrapFunc = $d130[1];
      e.tagOrNil = targetWrapFunc(
        new Expr(
          new ECall(
            new Expr(new EDot(p.lowerPrivateGet(targetFunc(), loc, private_), "bind", target.loc), target.loc),
            [targetFunc()],
            0,
            OptionalChainNone,
            TargetWasOriginallyPropertyAccess,
          ),
          target.loc,
        ),
      );
    }
  }

  const parts = e.parts;
  for (let i = 0; i < parts.length; i++) {
    parts[i].value = visitExprImpl(p, parts[i].value);
  }

  // When mangling, inline string values into the template literal. Note that
  // it may no longer be a template literal after this point (it may turn into
  // a plain string literal instead).
  if (p.shouldFoldTypeScriptConstantExpressions /* || minifySyntax */) {
    expr = inlinePrimitivesIntoTemplate(expr.loc, e);
  }

  // (compat.TemplateLiteral is always supported in the fast path)
  let shouldLowerTemplateLiteral = false;

  // If the tag was originally an optional chaining property access, then
  // we'll need to lower this template literal as well to preserve the value
  // for "this".
  if (tagThisFunc !== null) {
    shouldLowerTemplateLiteral = true;
  }

  // Lower tagged template literals that include "</script"
  // since we won't be able to escape it without lowering it
  if (!shouldLowerTemplateLiteral && !unsupportedJSFeaturesHasInlineScript(p) && e.tagOrNil !== null) {
    if (containsClosingScriptTag(e.headRaw)) {
      shouldLowerTemplateLiteral = true;
    } else {
      for (let $i50 = 0, $a50 = e.parts; $i50 < $a50.length; $i50++) {
        const part = $a50[$i50];
        if (containsClosingScriptTag(part.tailRaw)) {
          shouldLowerTemplateLiteral = true;
          break;
        }
      }
    }
  }

  // Convert template literals to older syntax if this is still a template literal
  if (shouldLowerTemplateLiteral) {
    const e2 = expr.data;
    if (e2.k === E_TEMPLATE) {
      return p.lowerTemplateLiteral(expr.loc, e2, tagThisFunc, tagWrapFunc);
    }
  }

  return expr;
}

function visitEBinary(p, expr, e, in_) {
  // The handling of binary expressions is convoluted because we're using
  // iteration on the heap instead of recursion on the call stack to avoid
  // stack overflow for deeply-nested ASTs. See the comment before the
  // definition of "binaryExprVisitor" for details.
  let v = acquireBinaryExprVisitor(p, e, expr.loc, in_, expr);

  // Everything uses a single stack to reduce allocation overhead. This stack
  // should almost always be very small, and almost all visits should reuse
  // existing memory without allocating anything.
  if (p.binaryExprStack == null) {
    p.binaryExprStack = [];
  }
  const stack = p.binaryExprStack;
  const stackBottom = stack.length;

  // Iterate down into the AST along the left node of the binary operation.
  // Continue iterating until we encounter something that's not a binary node.
  for (;;) {
    // Check whether this node is a special case. If it is, a result will be
    // provided which ends our iteration. Otherwise, the visitor object will
    // be prepared for visiting.
    const result = v.checkAndPrepare(p);
    if (result !== null) {
      expr = result;
      break;
    }

    // Grab the arguments to our nested "visitExprInOut" call for the left
    // node. We only care about deeply-nested left nodes because most binary
    // operators in JavaScript are left-associative and the problematic edge
    // cases we're trying to avoid crashing on have lots of left-associative
    // binary operators chained together without parentheses (e.g. "1+2+...").
    const left = v.e.left;
    const leftIn = v.leftIn;
    const leftBinary = left.data;

    // Stop iterating if iteration doesn't apply to the left node. This checks
    // the assignment target because "visitExprInOut" has additional behavior
    // in that case that we don't want to miss (before the top-level "switch"
    // statement).
    if (leftBinary.k !== E_BINARY || leftIn.assignTarget !== AssignTargetNone) {
      v.e.left = visitExprInOutImpl(p, left, leftIn);
      expr = v.visitRightAndFinish(p);
      break;
    }

    // Note that we only append to the stack (and therefore allocate memory
    // on the heap) when there are nested binary expressions. A single binary
    // expression doesn't add anything to the stack.
    stack.push(v);
    v = acquireBinaryExprVisitor(p, leftBinary, left.loc, leftIn, left);
  }
  p.binaryExprVisitorPool.push(v); // (done with it)

  // Process all binary operations from the deepest-visited node back toward
  // our original top-level binary operation.
  for (;;) {
    const n = stack.length - 1;
    if (n < stackBottom) {
      break;
    }
    const v2 = stack.pop();
    v2.e.left = expr;
    expr = v2.visitRightAndFinish(p);
    p.binaryExprVisitorPool.push(v2); // (done with it)
  }

  return expr;
}

// JS-only: binaryExprVisitor objects are reused (Go keeps them on the stack).
// A visitor is only used by the visitEBinary call that acquired it (from its
// start until its visitRightAndFinish has returned), so it can go back to the
// pool then.
function acquireBinaryExprVisitor(p, e, loc, in_, expr) {
  const pool = p.binaryExprVisitorPool;
  if (pool.length === 0) return new binaryExprVisitor(e, loc, in_, EXPR_IN_DEFAULT, false, false, expr);
  const v = pool.pop();
  v.e = e;
  v.loc = loc;
  v.in = in_;
  v.leftIn = EXPR_IN_DEFAULT;
  v.isStmtExpr = false;
  v.oldSilenceWarningAboutThisBeingUndefined = false;
  v.expr = expr;
  return v;
}

// Sets lastOut
function visitEDot(p, expr, e, in_) {
  const isDeleteTarget = e === p.deleteTarget;
  const isCallTarget = e === p.callTarget;
  const isTemplateTag = e === p.templateTag;

  // Check both user-specified defines and known globals
  const defines = p.options.defines.dotDefines.get(e.name);
  if (defines !== undefined) {
    for (const define of defines) {
      if (p.isDotOrIndexDefineMatch(expr, define.keyParts)) {
        // Substitute user-specified defines
        if (define.defineExpr !== null) {
          const new_ = p.instantiateDefineExpr(expr.loc, define.defineExpr, new identifierOpts(in_.assignTarget, isCallTarget, isDeleteTarget));
          if (in_.assignTarget === AssignTargetNone || (new_ !== null && defineValueCanBeUsedInAssignTarget(new_.data))) {
            // Note: We don't need to "ignoreRef" on the underlying identifier
            // because we have only parsed it but not visited it yet
            lastOut = EXPR_OUT_DEFAULT;
            return new_;
          } else {
            const r = mkRange(expr.loc, rangeEnd(rangeOfIdentifier(p.source, e.nameLoc)) - expr.loc);
            p.logAssignToDefine(r, "", expr);
          }
        }

        // Copy the side effect flags over in case this expression is unused
        if ((define.flags & DefineFlagCanBeRemovedIfUnused) !== 0) {
          e.canBeRemovedIfUnused = true;
        }
        if ((define.flags & DefineFlagCallCanBeUnwrappedIfUnused) !== 0 && !p.options.ignoreDCEAnnotations) {
          e.callCanBeUnwrappedIfUnused = true;
        }
        if ((define.flags & IsSymbolInstance) !== 0) {
          e.isSymbolInstance = true;
        }
        break;
      }
    }
  }

  // Check injected dot names
  if (p.injectedDotNames != null) {
    const names = p.injectedDotNames.get(e.name);
    if (names !== undefined) {
      for (const name of names) {
        if (p.isDotOrIndexDefineMatch(expr, name.parts)) {
          // Note: We don't need to "ignoreRef" on the underlying identifier
          // because we have only parsed it but not visited it yet
          const value = p.instantiateInjectDotName(expr.loc, name, in_.assignTarget);
          lastOut = EXPR_OUT_DEFAULT;
          return value;
        }
      }
    }
  }

  // Track ".then().catch()" chains
  if (isCallTarget && p.thenCatchChain.nextTarget === e) {
    if (e.name === "catch") {
      p.thenCatchChain = new thenCatchChain(e.target.data, e.nameLoc, false, true);
    } else if (e.name === "then") {
      const old = p.thenCatchChain;
      p.thenCatchChain = new thenCatchChain(e.target.data, old.catchLoc, false, old.hasCatch || old.hasMultipleArgs);
    }
  }

  p.dotOrIndexTarget = e.target.data;
  const target = visitExprInOutImpl(p, e.target, inForChain(e.optionalChain === OptionalChainContinue, false));
  const out = lastOut;
  e.target = target;

  // Lower "super.prop" if necessary
  if (
    e.optionalChain === OptionalChainNone &&
    in_.assignTarget === AssignTargetNone &&
    !isCallTarget &&
    p.shouldLowerSuperPropertyAccess(e.target)
  ) {
    // "super.foo" => "__superGet('foo')"
    const key = new Expr(new EString(e.name), e.nameLoc);
    let value = p.lowerSuperPropertyGet(expr.loc, key);
    if (isTemplateTag) {
      value = new Expr(
        new ECall(
          new Expr(new EDot(value, "bind", value.loc), value.loc),
          [new Expr(EThisShared, value.loc)],
          0,
          OptionalChainNone,
          TargetWasOriginallyPropertyAccess,
        ),
        value.loc,
      );
    }
    lastOut = EXPR_OUT_DEFAULT;
    return value;
  }

  // Lower optional chaining if we're the top of the chain
  const containsOptionalChain =
    e.optionalChain === OptionalChainStart || (e.optionalChain === OptionalChainContinue && out.childContainsOptionalChain);
  if (containsOptionalChain && !in_.hasChainParent) {
    const $d131 = p.lowerOptionalChain(expr, in_, out);
    const value = $d131[0], valueOut = $d131[1];
    lastOut = valueOut;
    return value;
  }

  // Also erase "console.log.call(console, 123)" and "console.log.bind(console)"
  let methodCallMustBeReplacedWithUndefined = out.methodCallMustBeReplacedWithUndefined;
  if (out.callMustBeReplacedWithUndefined) {
    if (e.name === "call" || e.name === "apply") {
      methodCallMustBeReplacedWithUndefined = true;
    } else {
      // (compat.Arrow is always supported in the fast path)
      e.target = new Expr(new EArrow(), e.target.loc);
    }
  }

  // Potentially rewrite this property access
  const newOut = mkOut(
    in_.hasChainParent ? out.thisArgFunc : null,
    in_.hasChainParent ? out.thisArgWrapFunc : null,
    containsOptionalChain,
    methodCallMustBeReplacedWithUndefined,
    false,
  );
  if (e.optionalChain === OptionalChainNone) {
    const rewritten = p.maybeRewritePropertyAccess(
      expr.loc,
      in_.assignTarget,
      isDeleteTarget,
      e.target,
      e.name,
      e.nameLoc,
      isCallTarget,
      isTemplateTag,
      false,
    );
    if (rewritten[1]) {
      lastOut = newOut;
      return rewritten[0];
    }
  }
  lastOut = newOut;
  return expr;
}

// Sets lastOut
function visitEIndex(p, expr, e, in_) {
  const isCallTarget = e === p.callTarget;
  const isTemplateTag = e === p.templateTag;
  const isDeleteTarget = e === p.deleteTarget;

  // Check both user-specified defines and known globals
  {
    const str = e.index.data;
    if (str.k === E_STRING) {
      const defines = p.options.defines.dotDefines.get(str.value);
      if (defines !== undefined) {
        for (const define of defines) {
          if (p.isDotOrIndexDefineMatch(expr, define.keyParts)) {
            // Substitute user-specified defines
            if (define.defineExpr !== null) {
              const new_ = p.instantiateDefineExpr(expr.loc, define.defineExpr, new identifierOpts(in_.assignTarget, isCallTarget, isDeleteTarget));
              if (in_.assignTarget === AssignTargetNone || (new_ !== null && defineValueCanBeUsedInAssignTarget(new_.data))) {
                // Note: We don't need to "ignoreRef" on the underlying identifier
                // because we have only parsed it but not visited it yet
                lastOut = EXPR_OUT_DEFAULT;
                return new_;
              } else {
                let r = mkRange(expr.loc, 0);
                const afterIndex = rangeEnd(p.source.rangeOfString(e.index.loc));
                const closeBracket = p.source.rangeOfOperatorAfter(afterIndex, "]");
                if (closeBracket.len > 0) {
                  r = mkRange(r.loc, rangeEnd(closeBracket) - r.loc);
                }
                p.logAssignToDefine(r, "", expr);
              }
            }

            // Copy the side effect flags over in case this expression is unused
            if ((define.flags & DefineFlagCanBeRemovedIfUnused) !== 0) {
              e.canBeRemovedIfUnused = true;
            }
            if ((define.flags & DefineFlagCallCanBeUnwrappedIfUnused) !== 0 && !p.options.ignoreDCEAnnotations) {
              e.callCanBeUnwrappedIfUnused = true;
            }
            if ((define.flags & IsSymbolInstance) !== 0) {
              e.isSymbolInstance = true;
            }
            break;
          }
        }
      }
    }
  }

  // (minifySyntax only: "a['b']" => "a.b")

  p.dotOrIndexTarget = e.target.data;
  const target = visitExprInOutImpl(p, e.target, inForChain(e.optionalChain === OptionalChainContinue, false));
  const out = lastOut;
  e.target = target;

  // Special-case private identifiers
  const private_ = e.index.data;
  if (private_.k === E_PRIVATE_IDENTIFIER) {
    const name = p.loadNameFromRef(private_.ref);
    const result = p.findSymbol(e.index.loc, name);
    private_.ref = result.ref;

    // Unlike regular identifiers, there are no unbound private identifiers
    const kind = p.symbols[refInner(result.ref)].kind;
    if (!symbolKindIsPrivate(kind)) {
      p.log.addError(); // Private name %q must be declared in an enclosing class
    } else {
      let text = "";
      if (in_.assignTarget !== AssignTargetNone && (kind === SymbolPrivateMethod || kind === SymbolPrivateStaticMethod)) {
        text = "Writing to read-only method will throw";
      } else if (in_.assignTarget !== AssignTargetNone && (kind === SymbolPrivateGet || kind === SymbolPrivateStaticGet)) {
        text = "Writing to getter-only property will throw";
      } else if (in_.assignTarget !== AssignTargetReplace && (kind === SymbolPrivateSet || kind === SymbolPrivateStaticSet)) {
        text = "Reading from setter-only property will throw";
      }
      if (text !== "") {
        let kind2 = Warning;
        if (p.suppressWarningsAboutWeirdCode) {
          kind2 = Debug;
        }
        p.log.addID(MsgID_JS_PrivateNameWillThrow, kind2);
      }
    }

    // Lower private member access only if we're sure the target isn't needed
    // for the value of "this" for a call expression. All other cases will be
    // taken care of by the enclosing call expression.
    if (
      p.privateSymbolNeedsToBeLowered(private_) &&
      e.optionalChain === OptionalChainNone &&
      in_.assignTarget === AssignTargetNone &&
      !isCallTarget &&
      !isTemplateTag
    ) {
      // "foo.#bar" => "__privateGet(foo, #bar)"
      const value = p.lowerPrivateGet(e.target, e.index.loc, private_);
      lastOut = EXPR_OUT_DEFAULT;
      return value;
    }
  } else {
    e.index = visitExprInOutImpl(p, e.index, IN_MANGLE_STRINGS);
  }

  // Lower "super[prop]" if necessary
  if (
    e.optionalChain === OptionalChainNone &&
    in_.assignTarget === AssignTargetNone &&
    !isCallTarget &&
    p.shouldLowerSuperPropertyAccess(e.target)
  ) {
    // "super[foo]" => "__superGet(foo)"
    let value = p.lowerSuperPropertyGet(expr.loc, e.index);
    if (isTemplateTag) {
      value = new Expr(
        new ECall(
          new Expr(new EDot(value, "bind", value.loc), value.loc),
          [new Expr(EThisShared, value.loc)],
          0,
          OptionalChainNone,
          TargetWasOriginallyPropertyAccess,
        ),
        value.loc,
      );
    }
    lastOut = EXPR_OUT_DEFAULT;
    return value;
  }

  // Lower optional chaining if we're the top of the chain
  const containsOptionalChain =
    e.optionalChain === OptionalChainStart || (e.optionalChain === OptionalChainContinue && out.childContainsOptionalChain);
  if (containsOptionalChain && !in_.hasChainParent) {
    const $d132 = p.lowerOptionalChain(expr, in_, out);
    const value = $d132[0], valueOut = $d132[1];
    lastOut = valueOut;
    return value;
  }

  // Potentially rewrite this property access
  const newOut = mkOut(
    in_.hasChainParent ? out.thisArgFunc : null,
    in_.hasChainParent ? out.thisArgWrapFunc : null,
    containsOptionalChain,
    out.methodCallMustBeReplacedWithUndefined,
    false,
  );
  {
    const str = e.index.data;
    if (str.k === E_STRING && e.optionalChain === OptionalChainNone) {
      const preferQuotedKey = true; // !p.options.minifySyntax
      const rewritten = p.maybeRewritePropertyAccess(
        expr.loc,
        in_.assignTarget,
        isDeleteTarget,
        e.target,
        str.value,
        e.index.loc,
        isCallTarget,
        isTemplateTag,
        preferQuotedKey,
      );
      if (rewritten[1]) {
        lastOut = newOut;
        return rewritten[0];
      }
    }
  }

  // (ModeBundle only: error for assigning to a property of an import namespace)
  // (minifySyntax only: "a['x' + 'y']" => "a.xy", "a['123']" => "a[123]", "'abc'[1]" => "'b'")

  lastOut = newOut;
  return expr;
}

// Sets lastOut
function visitEUnary(p, expr, e, in_) {
  switch (e.op) {
    case UnOpTypeof: {
      e.value = visitExprInOutImpl(p, e.value, inForAssignTarget(opCodeUnaryAssignTarget(e.op)));

      // Compile-time "typeof" evaluation
      const $d133 = typeofWithoutSideEffects(e.value.data);
      const typeof_ = $d133[0], ok = $d133[1];
      if (ok) {
        lastOut = EXPR_OUT_DEFAULT;
        return new Expr(new EString(typeof_), expr.loc);
      }
      break;
    }

    case UnOpDelete: {
      // Warn about code that tries to do "delete super.foo"
      let superPropLoc = 0;
      const e2 = e.value.data;
      switch (e2.k) {
        case E_DOT:
          if (e2.target.data.k === E_SUPER) {
            superPropLoc = e2.target.loc;
          }
          break;
        case E_INDEX:
          if (e2.target.data.k === E_SUPER) {
            superPropLoc = e2.target.loc;
          }
          break;
        case E_IDENTIFIER:
          p.markStrictModeFeature(deleteBareName, rangeOfIdentifier(p.source, e.value.loc), "");
          break;
      }
      if (superPropLoc !== 0) {
        let kind = Warning;
        if (p.suppressWarningsAboutWeirdCode) {
          kind = Debug;
        }
        p.log.addID(MsgID_JS_DeleteSuperProperty, kind);
      }

      p.deleteTarget = e.value.data;
      const value = visitExprInOutImpl(p, e.value, IN_CHAIN_PARENT);
      const out = lastOut;
      e.value = value;

      // Lower optional chaining if present since we're guaranteed to be the
      // end of the chain
      if (out.childContainsOptionalChain) {
        const $d134 = p.lowerOptionalChain(expr, in_, out);
        const result = $d134[0], resultOut = $d134[1];
        lastOut = resultOut;
        return result;
      }
      break;
    }

    default: {
      e.value = visitExprInOutImpl(p, e.value, inForAssignTarget(opCodeUnaryAssignTarget(e.op)));

      // Post-process the unary expression
      switch (e.op) {
        case UnOpNot: {
          // (minifySyntax only: SimplifyBooleanExpr)

          const $d135 = toBooleanWithSideEffects(e.value.data);
          const boolean = $d135[0], sideEffects = $d135[1], ok = $d135[2];
          if (ok && sideEffects === NoSideEffects) {
            lastOut = EXPR_OUT_DEFAULT;
            return new Expr(new EBoolean(!boolean), expr.loc);
          }

          // (minifySyntax only: MaybeSimplifyNot)
          break;
        }

        case UnOpVoid: {
          // (minifySyntax uses ExprCanBeRemovedIfUnused instead)
          //
          // This special case was added for a very obscure reason. There's a
          // custom dialect of JavaScript called Svelte that uses JavaScript
          // syntax with different semantics. Specifically variable accesses
          // have side effects (!). And someone wants to use "void x" instead
          // of just "x" to trigger the side effect for some reason.
          //
          // Arguably this should not be supported, because you shouldn't be
          // running esbuild on weird kinda-JavaScript-but-not languages and
          // expecting it to work correctly. But this one special case seems
          // harmless enough. This is definitely not fully supported though.
          //
          // More info: https://github.com/evanw/esbuild/issues/4041
          const shouldRemove = isUnsightlyPrimitive(e.value.data);
          if (shouldRemove) {
            lastOut = EXPR_OUT_DEFAULT;
            return new Expr(EUndefinedShared, expr.loc);
          }
          break;
        }

        case UnOpPos: {
          const $d136 = toNumberWithoutSideEffects(e.value.data);
          const number = $d136[0], ok = $d136[1];
          if (ok) {
            lastOut = EXPR_OUT_DEFAULT;
            return new Expr(new ENumber(number), expr.loc);
          }
          break;
        }

        case UnOpNeg: {
          const $d137 = toNumberWithoutSideEffects(e.value.data);
          const number = $d137[0], ok = $d137[1];
          if (ok) {
            lastOut = EXPR_OUT_DEFAULT;
            return new Expr(new ENumber(-number), expr.loc);
          }
          break;
        }

        case UnOpCpl:
          if (p.shouldFoldTypeScriptConstantExpressions /* || minifySyntax */) {
            // Minification folds complement operations since they are unlikely to result in larger output
            const $d138 = toNumberWithoutSideEffects(e.value.data);
            const number = $d138[0], ok = $d138[1];
            if (ok) {
              lastOut = EXPR_OUT_DEFAULT;
              return new Expr(new ENumber(~toInt32(number)), expr.loc);
            }
          }
          break;

        ////////////////////////////////////////////////////////////////////////////////
        // All assignment operators below here

        case UnOpPreDec:
        case UnOpPreInc:
        case UnOpPostDec:
        case UnOpPostInc: {
          const $d139 = p.extractPrivateIndex(e.value);
          const target = $d139[0], loc = $d139[1], private_ = $d139[2];
          if (private_ != null) {
            const value = p.lowerPrivateSetUnOp(target, loc, private_, e.op);
            lastOut = EXPR_OUT_DEFAULT;
            return value;
          }
          const property = p.extractSuperProperty(e.value);
          if (property != null) {
            e.value = p.callSuperPropertyWrapper(expr.loc, property);
          }
          break;
        }
      }
      break;
    }
  }

  // (minifySyntax only: "-(a, b)" => "a, -b")

  lastOut = EXPR_OUT_DEFAULT;
  return expr;
}

function visitEIf(p, e, in_) {
  e.test = visitExprImpl(p, e.test);

  // (minifySyntax only: SimplifyBooleanExpr)

  // Propagate these flags into the branches
  const childIn = inForMangleStrings(in_.shouldMangleStringsAsProps);

  // Fold constants
  const $d140 = toBooleanWithSideEffects(e.test.data);
  const boolean = $d140[0], ok = $d140[2];
  if (!ok) {
    e.yes = visitExprInOutImpl(p, e.yes, childIn);
    e.no = visitExprInOutImpl(p, e.no, childIn);
  } else {
    // Mark the control flow as dead if the branch is never taken
    if (boolean) {
      // "true ? live : dead"
      e.yes = visitExprInOutImpl(p, e.yes, childIn);
      const old = p.isControlFlowDead;
      p.isControlFlowDead = true;
      e.no = visitExprInOutImpl(p, e.no, childIn);
      p.isControlFlowDead = old;

      // (minifySyntax only: "(a, true) ? b : c" => "a, b")
    } else {
      // "false ? dead : live"
      const old = p.isControlFlowDead;
      p.isControlFlowDead = true;
      e.yes = visitExprInOutImpl(p, e.yes, childIn);
      p.isControlFlowDead = old;
      e.no = visitExprInOutImpl(p, e.no, childIn);

      // (minifySyntax only: "(a, false) ? b : c" => "a, c")
    }
  }

  // (minifySyntax only: MangleIfExpr)
}

// Sets lastOut
function visitEAwait(p, expr, e, in_) {
  // Silently remove unsupported top-level "await" in dead code branches
  if (p.fnOrArrowDataVisit.isOutsideFnOrArrow) {
    // (compat.TopLevelAwait is always supported in the fast path)
    if (p.isControlFlowDead && !formatKeepESMImportExportSyntax(p.options.outputFormat)) {
      return visitExprInOutImpl(p, e.value, in_);
    } else {
      const r = mkRange(expr.loc, 5);
      p.liveTopLevelAwaitKeyword = r;
      // compat is not ported: js_parser_lower.mjs accepts the Go feature name
      p.markSyntaxFeature("TopLevelAwait", r);
    }
  }

  p.awaitTarget = e.value.data;
  e.value = visitExprImpl(p, e.value);

  // "await" expressions turn into "yield" expressions when lowering
  const value = p.maybeLowerAwait(expr.loc, e);
  lastOut = EXPR_OUT_DEFAULT;
  return value;
}

function visitEArray(p, e, in_) {
  if (in_.assignTarget !== AssignTargetNone) {
    if (e.commaAfterSpread !== 0) {
      p.log.addError(); // Unexpected "," after rest pattern
    }
    // (p.markSyntaxFeature(compat.Destructuring): no-op in the fast path)
  }
  const itemIn = inForAssignTarget(in_.assignTarget);
  const items = e.items;
  for (let i = 0; i < items.length; i++) {
    let item = items[i];
    const e2 = item.data;
    switch (e2.k) {
      case E_MISSING:
        break;
      case E_SPREAD:
        e2.value = visitExprInOutImpl(p, e2.value, itemIn);
        // (hasSpread is only used when minifying)
        break;
      case E_BINARY:
        if (in_.assignTarget !== AssignTargetNone && e2.op === BinOpAssign) {
          e2.left = visitExprInOutImpl(p, e2.left, IN_ASSIGN_REPLACE);

          // Propagate the name to keep from the binding into the initializer
          const id = e2.left.data;
          if (id.k === E_IDENTIFIER) {
            p.nameToKeep = p.symbols[refInner(id.ref)].originalName;
            p.nameToKeepIsFor = e2.right.data;
          }

          e2.right = visitExprImpl(p, e2.right);
        } else {
          item = visitExprInOutImpl(p, item, itemIn);
        }
        break;
      default:
        item = visitExprInOutImpl(p, item, itemIn);
    }
    items[i] = item;
  }

  // (minifySyntax only: "[1, ...[2, 3], 4]" => "[1, 2, 3, 4]")
}

function visitEObject(p, expr, e, in_) {
  if (in_.assignTarget !== AssignTargetNone) {
    if (e.commaAfterSpread !== 0) {
      p.log.addError(); // Unexpected "," after rest pattern
    }
    // (p.markSyntaxFeature(compat.Destructuring): no-op in the fast path)
  }

  let protoRange = RANGE_ZERO;
  // (innerClassNameRef is only generated when lowering async methods, which
  // never happens in the fast path, so it always stays ast.InvalidRef)

  for (let $i51 = 0, $a51 = e.properties; $i51 < $a51.length; $i51++) {
    const property = $a51[$i51];
    if (property.kind !== PropertySpread) {
      let key = property.key;
      const mangled = key.data;
      if (mangled.k === E_NAME_OF_SYMBOL) {
        mangled.ref = p.symbolForMangledProp(p.loadNameFromRef(mangled.ref));
      } else {
        key = visitExprInOutImpl(p, property.key, IN_MANGLE_STRINGS);
        property.key = key;
      }

      // Forbid duplicate "__proto__" properties according to the specification
      if (
        (property.flags & PropertyIsComputed) === 0 &&
        (property.flags & PropertyWasShorthand) === 0 &&
        property.kind === PropertyField &&
        in_.assignTarget === AssignTargetNone
      ) {
        const str = key.data;
        if (str.k === E_STRING && str.value === "__proto__") {
          const r = rangeOfIdentifier(p.source, key.loc);
          if (protoRange.len > 0) {
            p.log.addErrorWithNotes(); // Cannot specify the "__proto__" property more than once per object
          } else {
            protoRange = r;
          }
        }
      }

      // (minifySyntax only: "{['x']: y}" => "{x: y}")
    } else {
      // (hasSpread is only used when minifying)
    }

    // Extract the initializer for expressions like "({ a: b = c } = d)"
    if (in_.assignTarget !== AssignTargetNone && property.initializerOrNil === null && property.valueOrNil !== null) {
      const binary = property.valueOrNil.data;
      if (binary.k === E_BINARY && binary.op === BinOpAssign) {
        property.initializerOrNil = binary.right;
        property.valueOrNil = binary.left;
      }
    }

    if (property.valueOrNil !== null) {
      const oldIsInStaticClassContext = p.fnOnlyDataVisit.isInStaticClassContext;
      const oldInnerClassNameRef = p.fnOnlyDataVisit.innerClassNameRef;

      // (compat.AsyncAwait is always supported: async methods are not lowered,
      // so no temporary for a lowered "super" reference is needed)

      // Propagate the name to keep from the property into the value
      if (property.key !== null) {
        const str = property.key.data;
        if (str.k === E_STRING) {
          p.nameToKeep = str.value;
          p.nameToKeepIsFor = property.valueOrNil.data;
        }
      }

      property.valueOrNil = visitExprInOutImpl(
        p,
        property.valueOrNil,
        propertyKindIsMethodDefinition(property.kind)
          ? new exprIn(true, false, false, false, false, in_.assignTarget)
          : inForAssignTarget(in_.assignTarget),
      );

      p.fnOnlyDataVisit.innerClassNameRef = oldInnerClassNameRef;
      p.fnOnlyDataVisit.isInStaticClassContext = oldIsInStaticClassContext;
    }

    if (property.initializerOrNil !== null) {
      // Propagate the name to keep from the binding into the initializer
      if (property.valueOrNil !== null) {
        const id = property.valueOrNil.data;
        if (id.k === E_IDENTIFIER) {
          p.nameToKeep = p.symbols[refInner(id.ref)].originalName;
          p.nameToKeepIsFor = property.initializerOrNil.data;
        }
      }

      property.initializerOrNil = visitExprImpl(p, property.initializerOrNil);
    }

    // (minifySyntax only: "{ '123': 4 }" => "{ 123: 4 }")
  }

  // Check for and warn about duplicate keys in object literals
  if (!p.suppressWarningsAboutWeirdCode) {
    p.warnAboutDuplicateProperties(e.properties, duplicatePropertiesInObject);
  }

  if (in_.assignTarget === AssignTargetNone) {
    // (minifySyntax only: "{a, ...{b, c}, d}" => "{a, b, c, d}")

    // Object expressions represent both object literals and binding patterns.
    // Only lower object spread if we're an object literal, not a binding pattern.
    const value = p.lowerObjectSpread(expr.loc, e);

    // (A lowered "super" reference inside a lowered "async" method would
    // initialize the temporary here; never happens in the fast path)

    return value;
  }

  return expr;
}

function visitEImportCall(p, expr, e) {
  const isAwaitTarget = e === p.awaitTarget;
  const isThenCatchTarget = e === p.thenCatchChain.nextTarget && p.thenCatchChain.hasCatch;
  e.expr = visitExprImpl(p, e.expr);

  let assertOrWith = null;
  let flags = 0;
  if (e.optionsOrNil !== null) {
    e.optionsOrNil = visitExprImpl(p, e.optionsOrNil);

    // If there's an additional argument, this can't be split because the
    // additional argument requires evaluation and our AST nodes can't be
    // reused in different places in the AST (e.g. function scopes must be
    // unique). Also the additional argument may have side effects and we
    // don't currently account for that.
    // ("whyLoc" is only used by the ModeBundle-only warning and is omitted)
    let why = "the second argument was not an object literal";

    // However, make a special case for an additional argument that contains
    // only an "assert" or a "with" clause. In that case we can split this
    // AST node.
    const object = e.optionsOrNil.data;
    if (object.k === E_OBJECT) {
      if (object.properties.length === 1) {
        const prop = object.properties[0];
        if (prop.kind === PropertyField && (prop.flags & PropertyIsComputed) === 0) {
          const str = prop.key.data;
          if (str.k === E_STRING && (str.value === "assert" || str.value === "with")) {
            let keyword = WithKeyword;
            if (str.value === "assert") {
              keyword = AssertKeyword;
            }
            const value = prop.valueOrNil !== null ? prop.valueOrNil.data : null;
            if (value !== null && value.k === E_OBJECT) {
              let entries = [];
              for (let $i52 = 0, $a52 = value.properties; $i52 < $a52.length; $i52++) {
                const p2 = $a52[$i52];
                if (p2.kind === PropertyField && (p2.flags & PropertyIsComputed) === 0) {
                  const key = p2.key.data;
                  if (key.k === E_STRING) {
                    const value2 = p2.valueOrNil !== null ? p2.valueOrNil.data : null;
                    if (value2 !== null && value2.k === E_STRING) {
                      entries.push(
                        new AssertOrWithEntry(key.value, value2.value, p2.key.loc, p2.valueOrNil.loc, (p2.flags & PropertyPreferQuotedKey) !== 0),
                      );
                      if (keyword === AssertKeyword && key.value === "type" && value2.value === "json") {
                        flags |= AssertTypeJSON;
                      }
                      continue;
                    } else {
                      why = "the value for the property was not a string literal";
                    }
                  } else {
                    why = "this property was not a string literal";
                  }
                } else {
                  why = "this property was invalid";
                }
                entries = null;
                break;
              }
              if (entries !== null) {
                if (keyword === AssertKeyword) {
                  p.maybeWarnAboutAssertKeyword(prop.key.loc);
                }
                assertOrWith = new ImportAssertOrWith(
                  entries,
                  prop.key.loc, // keywordLoc
                  prop.valueOrNil.loc, // innerOpenBraceLoc
                  value.closeBraceLoc, // innerCloseBraceLoc
                  e.optionsOrNil.loc, // outerOpenBraceLoc
                  object.closeBraceLoc, // outerCloseBraceLoc
                  keyword,
                );
                why = "";
              }
            } else {
              why = 'the value for "assert" was not an object literal';
            }
          } else {
            why = 'this property was not called "assert" or "with"';
          }
        } else {
          why = "this property was invalid";
        }
      } else {
        why = 'the second argument was not an object literal with a single property called "assert" or "with"';
      }
    }

    // Handle the case that isn't just an import assertion or attribute clause
    if (why !== "") {
      // (Only warn when bundling: ModeBundle only)

      // (compat.ImportAssertions and compat.ImportAttributes are always
      // supported in the fast path, so the second argument is kept)

      // Stop now so we don't try to split "?:" expressions below and
      // potentially end up with an AST node reused multiple times
      return expr;
    }
  }

  return p.maybeTransposeIfExprChain(e.expr, (arg) => {
    // The argument must be a string
    const str = arg.data;
    if (str.k === E_STRING) {
      // Ignore calls to import() if the control flow is provably dead here.
      // We don't want to spend time scanning the required files if they will
      // never be used.
      if (p.isControlFlowDead) {
        return new Expr(ENullShared, arg.loc);
      }

      const importRecordIndex = p.addImportRecord(ImportDynamic, e.phase, p.source.rangeOfString(arg.loc), str.value, assertOrWith, flags);
      if (isAwaitTarget && p.fnOrArrowDataVisit.tryBodyCount !== 0) {
        const record = p.importRecords[importRecordIndex];
        record.flags |= HandlesImportErrors;
        record.errorHandlerLoc = p.fnOrArrowDataVisit.tryCatchLoc;
      } else if (isThenCatchTarget) {
        const record = p.importRecords[importRecordIndex];
        record.flags |= HandlesImportErrors;
        record.errorHandlerLoc = p.thenCatchChain.catchLoc;
      }
      p.currentPart.importRecordIndices.push(importRecordIndex);
      return new Expr(new EImportString(importRecordIndex, e.closeParenLoc), expr.loc);
    }

    // (Handle glob patterns: ModeBundle only)

    // (Use a debug log so people can see this if they want to: kind
    // logger.Debug, dropped)

    // (compat.DynamicImport is always supported: no "require()" conversion)

    // Note: Go does not copy "Phase" here
    return new Expr(new EImportCall(arg, e.optionsOrNil, e.closeParenLoc), expr.loc);
  });
}

// Sets lastOut
function visitECall(p, expr, e, in_) {
  p.callTarget = e.target.data;

  // Track ".then().catch()" chains
  {
    const old = p.thenCatchChain;
    const hasMultipleArgs = e.args.length >= 2;
    p.thenCatchChain = new thenCatchChain(
      e.target.data, // nextTarget
      hasMultipleArgs ? e.args[1].loc : old.catchLoc, // catchLoc
      hasMultipleArgs,
      old.nextTarget === e && old.hasCatch, // hasCatch
    );
  }

  let wasIdentifierBeforeVisit = false;
  let isParenthesizedOptionalChain = false;
  {
    const e2 = e.target.data;
    switch (e2.k) {
      case E_IDENTIFIER:
        wasIdentifierBeforeVisit = true;
        break;
      case E_DOT:
        isParenthesizedOptionalChain = e.optionalChain === OptionalChainNone && e2.optionalChain !== OptionalChainNone;
        break;
      case E_INDEX:
        isParenthesizedOptionalChain = e.optionalChain === OptionalChainNone && e2.optionalChain !== OptionalChainNone;
        break;
    }
  }
  const target = visitExprInOutImpl(
    p,
    e.target,
    inForChain(
      e.optionalChain === OptionalChainContinue,

      // Signal to our child if this is an ECall at the start of an optional
      // chain. If so, the child will need to stash the "this" context for us
      // that we need for the ".call(this, ...args)".
      e.optionalChain === OptionalChainStart || isParenthesizedOptionalChain,
    ),
  );
  const out = lastOut;
  e.target = target;
  p.warnAboutImportNamespaceCall(target, exprKindCall);

  // Automatically mark immediately-invoked function expressions for eager compilation
  if (target.data.k === E_FUNCTION) {
    target.data.isParenthesized = true;
  }

  let hasSpread = false;
  const oldIsControlFlowDead = p.isControlFlowDead;

  // If we're removing this call, don't count any arguments as symbol uses
  let callMustBeReplacedWithUndefined = out.callMustBeReplacedWithUndefined;
  if (callMustBeReplacedWithUndefined) {
    if (isPropertyAccess(e.target)) {
      p.isControlFlowDead = true;
    } else {
      callMustBeReplacedWithUndefined = false;
    }
  }

  // Visit the arguments
  const args = e.args;
  for (let i = 0; i < args.length; i++) {
    const arg = visitExprImpl(p, args[i]);
    if (arg.data.k === E_SPREAD) {
      hasSpread = true;
    }
    args[i] = arg;
  }

  // Mark side-effect free IIFEs with "/* @__PURE__ */"
  if (!e.canBeUnwrappedIfUnused) {
    const t = e.target.data;
    switch (t.k) {
      case E_ARROW:
        if (!t.isAsync && p.iifeCanBeRemovedIfUnused(t.args, t.body)) {
          e.canBeUnwrappedIfUnused = true;
        }
        break;
      case E_FUNCTION:
        if (!t.fn.isAsync && !t.fn.isGenerator && p.iifeCanBeRemovedIfUnused(t.fn.args, t.fn.body)) {
          e.canBeUnwrappedIfUnused = true;
        }
        break;
    }
  }

  // (Yarn PnP only: the "hydrateRuntimeState" hack)

  // Stop now if this call must be removed
  if (callMustBeReplacedWithUndefined) {
    p.isControlFlowDead = oldIsControlFlowDead;
    lastOut = EXPR_OUT_DEFAULT;
    return new Expr(EUndefinedShared, expr.loc);
  }

  // (minifySyntax only: inline spreads of array literals, inline IIFEs)

  {
    const t = target.data;
    switch (t.k) {
      case E_IMPORT_IDENTIFIER:
        // (minifySyntax only: convertSymbolUseToCall)
        break;

      case E_IDENTIFIER: {
        // Detect if this is a direct eval. Note that "(1 ? eval : 0)(x)" will
        // become "eval(x)" after we visit the target due to dead code elimination,
        // but that doesn't mean it should become a direct eval.
        //
        // Note that "eval?.(x)" is considered an indirect eval. There was debate
        // about this after everyone implemented it as a direct eval, but the
        // language committee said it was indirect and everyone had to change it:
        // https://github.com/tc39/ecma262/issues/2062.
        if (e.optionalChain === OptionalChainNone) {
          const symbol = p.symbols[refInner(t.ref)];
          if (wasIdentifierBeforeVisit && symbol.originalName === "eval") {
            e.kind = DirectEval;

            // (ModeBundle only: record uses of "module" and "exports")

            // Mark this scope and all parent scopes as containing a direct eval.
            // This will prevent us from renaming any symbols.
            for (let s = p.currentScope; s !== null; s = s.parent) {
              s.containsDirectEval = true;
            }

            // Warn when direct eval is used in an ESM file. There is no way we
            // can guarantee that this will work correctly for top-level imported
            // and exported symbols due to scope hoisting. Except don't warn when
            // this code is in a 3rd-party library because there's nothing people
            // will be able to do about the warning.
            // (The message is logger.Debug unless bundling: dropped)
          } else if ((symbol.flags & SymbolFlagCallCanBeUnwrappedIfUnused) !== 0) {
            // Automatically add a "/* @__PURE__ */" comment to file-local calls
            // of functions declared with a "/* @__NO_SIDE_EFFECTS__ */" comment
            t.callCanBeUnwrappedIfUnused = true;
          }
        }

        // Handle certain special cases
        if (e.args.length <= 1 && !hasSpread) {
          const symbol = p.symbols[refInner(t.ref)];
          if (symbol.kind === SymbolUnbound) {
            switch (symbol.originalName) {
              case "Symbol":
                // Calling the "Symbol()" constructor with a primitive will never throw
                if (e.args.length === 0 || knownPrimitiveType(e.args[0].data) !== PrimitiveUnknown) {
                  e.canBeUnwrappedIfUnused = true;
                }
                break;
            }

            // (minifySyntax only: optimize references to global constructors)
          }
        }

        // Copy the call side effect flag over if this is a known target
        if (t.callCanBeUnwrappedIfUnused) {
          e.canBeUnwrappedIfUnused = true;
        }

        // (minifySyntax only: convertSymbolUseToCall)
        break;
      }

      case E_DOT: {
        if (e.args.length === 1) {
          switch (t.name) {
            case "resolve":
              // Recognize "require.resolve()" calls
              if (t.optionalChain === OptionalChainNone && p.options.mode !== ModePassThrough) {
                const id = t.target.data;
                if (id.k === E_IDENTIFIER && id.ref === p.requireRef) {
                  p.ignoreUsage(p.requireRef);
                  const value = p.maybeTransposeIfExprChain(e.args[0], (arg) => {
                    // Note: Go checks "e.Args[0]" here, not "arg"
                    const str = e.args[0].data;
                    if (str.k === E_STRING) {
                      // Ignore calls to require.resolve() if the control flow is provably
                      // dead here. We don't want to spend time scanning the required files
                      // if they will never be used.
                      if (p.isControlFlowDead) {
                        return new Expr(ENullShared, expr.loc);
                      }

                      const importRecordIndex = p.addImportRecord(
                        ImportRequireResolve,
                        EvaluationPhase,
                        p.source.rangeOfString(e.args[0].loc),
                        str.value,
                        null,
                        0,
                      );
                      if (p.fnOrArrowDataVisit.tryBodyCount !== 0) {
                        const record = p.importRecords[importRecordIndex];
                        record.flags |= HandlesImportErrors;
                        record.errorHandlerLoc = p.fnOrArrowDataVisit.tryCatchLoc;
                      }
                      p.currentPart.importRecordIndices.push(importRecordIndex);

                      // Create a new expression to represent the operation
                      return new Expr(new ERequireResolveString(importRecordIndex, e.closeParenLoc), expr.loc);
                    }

                    // Otherwise just return a clone of the "require.resolve()" call
                    return new Expr(
                      new ECall(
                        new Expr(new EDot(p.valueToSubstituteForRequire(t.target.loc), t.name, t.nameLoc), e.target.loc),
                        [arg],
                        e.closeParenLoc,
                        OptionalChainNone,
                        e.kind,
                      ),
                      expr.loc,
                    );
                  });
                  lastOut = EXPR_OUT_DEFAULT;
                  return value;
                }
              }
              break;

            case "for": {
              // Calling "Symbol.for()" with a primitive will never throw
              const id = t.target.data;
              if (id.k === E_IDENTIFIER) {
                const symbol = p.symbols[refInner(id.ref)];
                if (symbol.kind === SymbolUnbound && symbol.originalName === "Symbol") {
                  if (knownPrimitiveType(e.args[0].data) !== PrimitiveUnknown) {
                    e.canBeUnwrappedIfUnused = true;
                  }
                }
              }
              break;
            }

            case "create": {
              // Recognize "Object.create()" calls
              const id = t.target.data;
              if (id.k === E_IDENTIFIER) {
                const symbol = p.symbols[refInner(id.ref)];
                if (symbol.kind === SymbolUnbound && symbol.originalName === "Object") {
                  switch (e.args[0].data.k) {
                    case E_NULL:
                    case E_OBJECT:
                      // Mark "Object.create(null)" and "Object.create({})" as pure
                      e.canBeUnwrappedIfUnused = true;
                      break;
                  }
                }
              }
              break;
            }

            case "escape": {
              // Recognize "RegExp.escape()" calls
              const id = t.target.data;
              if (id.k === E_IDENTIFIER) {
                const symbol = p.symbols[refInner(id.ref)];
                if (symbol.kind === SymbolUnbound && symbol.originalName === "RegExp") {
                  if (knownPrimitiveType(e.args[0].data) === PrimitiveString) {
                    // Mark "RegExp.escape" with a string literal as pure
                    e.canBeUnwrappedIfUnused = true;
                  }
                }
              }
              break;
            }
          }
        }

        // (minifySyntax only: "charCodeAt", "fromCharCode", "toString" folding)

        // Copy the call side effect flag over if this is a known target
        if (t.callCanBeUnwrappedIfUnused) {
          e.canBeUnwrappedIfUnused = true;
        }
        break;
      }

      case E_INDEX:
        // Copy the call side effect flag over if this is a known target
        if (t.callCanBeUnwrappedIfUnused) {
          e.canBeUnwrappedIfUnused = true;
        }
        break;

      case E_SUPER:
        // If we're shimming "super()" calls, replace this call with "__super()"
        if (p.superCtorRef !== InvalidRef) {
          p.recordUsage(p.superCtorRef);
          e.target = new Expr(new EIdentifier(p.superCtorRef), e.target.loc);
        }
        break;
    }
  }

  // Handle parenthesized optional chains
  if (isParenthesizedOptionalChain && out.thisArgFunc !== null && out.thisArgWrapFunc !== null) {
    const value = p.lowerParenthesizedOptionalChain(expr.loc, e, out);
    lastOut = EXPR_OUT_DEFAULT;
    return value;
  }

  // Lower optional chaining if we're the top of the chain
  const containsOptionalChain =
    e.optionalChain === OptionalChainStart || (e.optionalChain === OptionalChainContinue && out.childContainsOptionalChain);
  if (containsOptionalChain && !in_.hasChainParent) {
    const $d141 = p.lowerOptionalChain(expr, in_, out);
    const value = $d141[0], valueOut = $d141[1];
    lastOut = valueOut;
    return value;
  }

  // If this is a plain call expression (instead of an optional chain), lower
  // private member access in the call target now if there is one
  if (!containsOptionalChain) {
    const $d142 = p.extractPrivateIndex(e.target);
    const target2 = $d142[0], loc = $d142[1], private_ = $d142[2];
    if (private_ != null) {
      // "foo.#bar(123)" => "__privateGet(_a = foo, #bar).call(_a, 123)"
      const $d143 = p.captureValueWithPossibleSideEffects(target2.loc, 2, target2, valueCouldBeMutated);
      const targetFunc = $d143[0], targetWrapFunc = $d143[1];
      const value = targetWrapFunc(
        new Expr(
          new ECall(
            new Expr(new EDot(p.lowerPrivateGet(targetFunc(), loc, private_), "call", target2.loc), target2.loc),
            [targetFunc()].concat(e.args),
            0,
            OptionalChainNone,
            TargetWasOriginallyPropertyAccess,
            false,
            e.canBeUnwrappedIfUnused,
          ),
          target2.loc,
        ),
      );
      lastOut = EXPR_OUT_DEFAULT;
      return value;
    }
    p.maybeLowerSuperPropertyGetInsideCall(e);
  }

  // Track calls to require() so we can use them while bundling
  if (p.options.mode !== ModePassThrough && e.optionalChain === OptionalChainNone) {
    const id = e.target.data;
    if (id.k === E_IDENTIFIER && id.ref === p.requireRef) {
      // Heuristic: omit warnings inside try/catch blocks because presumably
      // the try/catch statement is there to handle the potential run-time
      // error from the unbundled require() call failing.
      const omitWarnings = p.fnOrArrowDataVisit.tryBodyCount !== 0;

      if (p.options.mode !== ModePassThrough) {
        // There must be one argument
        if (e.args.length === 1) {
          p.ignoreUsage(p.requireRef);
          const value = p.maybeTransposeIfExprChain(e.args[0], (arg) => {
            // The argument must be a string
            const str = arg.data;
            if (str.k === E_STRING) {
              // Ignore calls to require() if the control flow is provably dead here.
              // We don't want to spend time scanning the required files if they will
              // never be used.
              if (p.isControlFlowDead) {
                return new Expr(ENullShared, expr.loc);
              }

              const importRecordIndex = p.addImportRecord(ImportRequire, EvaluationPhase, p.source.rangeOfString(arg.loc), str.value, null, 0);
              if (p.fnOrArrowDataVisit.tryBodyCount !== 0) {
                const record = p.importRecords[importRecordIndex];
                record.flags |= HandlesImportErrors;
                record.errorHandlerLoc = p.fnOrArrowDataVisit.tryCatchLoc;
              }
              p.currentPart.importRecordIndices.push(importRecordIndex);

              // Currently "require" is not converted into "import" for ESM
              if (p.options.mode !== ModeBundle && p.options.outputFormat === FormatESModule && !omitWarnings) {
                p.log.addID(MsgID_JS_UnsupportedRequireCall, Warning); // Converting "require" to "esm" is currently not supported
              }

              // Create a new expression to represent the operation
              return new Expr(new ERequireString(importRecordIndex, e.closeParenLoc), expr.loc);
            }

            // (Handle glob patterns: ModeBundle only)

            // (Use a debug log so people can see this if they want to: kind
            // logger.Debug, dropped)

            // Otherwise just return a clone of the "require()" call
            return new Expr(new ECall(p.valueToSubstituteForRequire(e.target.loc), [arg], e.closeParenLoc), expr.loc);
          });
          lastOut = EXPR_OUT_DEFAULT;
          return value;
        } else {
          // (Use a debug log so people can see this if they want to: kind
          // logger.Debug, dropped)
        }

        const value = new Expr(new ECall(p.valueToSubstituteForRequire(e.target.loc), e.args, e.closeParenLoc), expr.loc);
        lastOut = EXPR_OUT_DEFAULT;
        return value;
      }
    }
  }

  lastOut = mkOut(
    in_.hasChainParent ? out.thisArgFunc : null,
    in_.hasChainParent ? out.thisArgWrapFunc : null,
    containsOptionalChain,
    false,
    false,
  );
  return expr;
}

function visitEArrow(p, expr, e) {
  // (The propagated name to keep is only used by keepNames)

  // Prepare for suspicious logical operator checking
  if (e.preferExpr && e.args.length === 1 && e.args[0].defaultOrNil === null && e.body.block.stmts.length === 1) {
    if (e.args[0].binding.data.k === B_IDENTIFIER) {
      const stmt = e.body.block.stmts[0].data;
      if (stmt.k === S_RETURN) {
        const binary = stmt.valueOrNil !== null ? stmt.valueOrNil.data : null;
        if (binary !== null && binary.k === E_BINARY && (binary.op === BinOpLogicalAnd || binary.op === BinOpLogicalOr)) {
          p.suspiciousLogicalOperatorInsideArrow = binary;
        }
      }
    }
  }

  // (compat.AsyncAwait is always supported: asyncArrowNeedsToBeLowered is false)
  const oldFnOrArrowData = p.fnOrArrowDataVisit;
  p.fnOrArrowDataVisit = new fnOrArrowDataVisit(
    0, // tryBodyCount
    0, // tryCatchLoc
    true, // isArrow
    e.isAsync, // isAsync
    false, // isGenerator
    false, // isInsideLoop
    false, // isInsideSwitch
    false, // isDerivedClassCtor
    false, // isOutsideFnOrArrow
    oldFnOrArrowData.shouldLowerSuperPropertyAccess, // shouldLowerSuperPropertyAccess
  );

  // Mark if we're inside an async arrow function. This value should be true
  // even if we're inside multiple arrow functions and the closest inclosing
  // arrow function isn't async, as long as at least one enclosing arrow
  // function within the current enclosing function is async.
  const oldInsideAsyncArrowFn = p.fnOnlyDataVisit.isInsideAsyncArrowFn;
  if (e.isAsync) {
    p.fnOnlyDataVisit.isInsideAsyncArrowFn = true;
  }

  p.pushScopeForVisitPass(ScopeFunctionArgs, expr.loc);
  p.visitArgs(e.args, new visitArgsOpts(e.body.block.stmts, null, e.hasRestArg, true /* isUniqueFormalParameters */));
  p.pushScopeForVisitPass(ScopeFunctionBody, e.body.loc);
  e.body.block.stmts = p.visitStmtsAndPrependTempRefs(e.body.block.stmts, new prependTempRefsOpts(null, stmtsFnBody));
  p.popScope();
  // (p.lowerFunction(...): its body only runs when lowering, never in the fast path)
  p.popScope();

  // (minifySyntax only: "() => { return x }" => "() => x")

  p.fnOnlyDataVisit.isInsideAsyncArrowFn = oldInsideAsyncArrowFn;
  p.fnOrArrowDataVisit = oldFnOrArrowData;

  // (compat.Arrow is always supported: arrows are not converted to functions)
  // (keepNames only: preserve the name)
}

// ---------------------------------------------------------------------------
// binaryExprVisitor
//
// This exists to handle very deeply-nested ASTs. For example, the "grapheme-splitter"
// package contains this monstrosity:
//
//	if (
//	  (0x0300 <= code && code <= 0x036F) ||
//	  (0x0483 <= code && code <= 0x0487) ||
//	  (0x0488 <= code && code <= 0x0489) ||
//	  (0x0591 <= code && code <= 0x05BD) ||
//	  ... many hundreds of lines later ...
//	) {
//	  return;
//	}
//
// If "checkAndPrepare" returns non-null, then the return value is the final
// expression. Otherwise, the final expression can be obtained by manually
// visiting the left child and then calling "visitRightAndFinish":
//
//	if result := v.checkAndPrepare(p); result.Data != nil {
//	  return result
//	}
//	v.e.Left, _ = p.visitExprInOut(v.e.Left, v.leftIn)
//	return v.visitRightAndFinish(p)
//
// This code is convoluted this way so that we can use our own stack on the
// heap instead of the call stack when there are additional levels of nesting.

Object.assign(binaryExprVisitor.prototype, {
  // Returns an Expr, or null (Go's "js_ast.Expr{}")
  checkAndPrepare(p) {
    const v = this;
    const e = v.e;

    // Special-case EPrivateIdentifier to allow it here
    const private_ = e.left.data;
    if (private_.k === E_PRIVATE_IDENTIFIER && e.op === BinOpIn) {
      const name = p.loadNameFromRef(private_.ref);
      const result = p.findSymbol(e.left.loc, name);
      private_.ref = result.ref;

      // Unlike regular identifiers, there are no unbound private identifiers
      const symbol = p.symbols[refInner(result.ref)];
      if (!symbolKindIsPrivate(symbol.kind)) {
        p.log.addError(); // Private name %q must be declared in an enclosing class
      }

      e.right = visitExprImpl(p, e.right);

      if (p.privateSymbolNeedsToBeLowered(private_)) {
        return p.lowerPrivateBrandCheck(e.right, v.loc, private_);
      }
      return new Expr(e, v.loc);
    }

    v.isStmtExpr = e === p.stmtExprValue;
    v.oldSilenceWarningAboutThisBeingUndefined = p.fnOnlyDataVisit.silenceMessageAboutThisBeingUndefined;

    if (e.left.data.k === E_THIS && e.op === BinOpLogicalAnd) {
      p.fnOnlyDataVisit.silenceMessageAboutThisBeingUndefined = true;
    }
    // exprIn{assignTarget: e.Op.BinaryAssignTarget(), shouldMangleStringsAsProps: e.Op == js_ast.BinOpIn}
    v.leftIn = e.op === BinOpIn ? IN_MANGLE_STRINGS : inForAssignTarget(opCodeBinaryAssignTarget(e.op));
    return null;
  },

  visitRightAndFinish(p) {
    const v = this;
    const e = v.e;

    // Mark the control flow as dead if the branch is never taken
    switch (e.op) {
      case BinOpLogicalOr: {
        const $d144 = toBooleanWithSideEffects(e.left.data);
        const boolean = $d144[0], ok = $d144[2];
        if (ok && boolean) {
          // "true || dead"
          const old = p.isControlFlowDead;
          p.isControlFlowDead = true;
          e.right = visitExprImpl(p, e.right);
          p.isControlFlowDead = old;
        } else {
          e.right = visitExprImpl(p, e.right);
        }
        break;
      }

      case BinOpLogicalAnd: {
        const $d145 = toBooleanWithSideEffects(e.left.data);
        const boolean = $d145[0], ok = $d145[2];
        if (ok && !boolean) {
          // "false && dead"
          const old = p.isControlFlowDead;
          p.isControlFlowDead = true;
          e.right = visitExprImpl(p, e.right);
          p.isControlFlowDead = old;
        } else {
          e.right = visitExprImpl(p, e.right);
        }
        break;
      }

      case BinOpNullishCoalescing: {
        const $d146 = toNullOrUndefinedWithSideEffects(e.left.data);
        const isNullOrUndefined = $d146[0], ok = $d146[2];
        if (ok && !isNullOrUndefined) {
          // "notNullOrUndefined ?? dead"
          const old = p.isControlFlowDead;
          p.isControlFlowDead = true;
          e.right = visitExprImpl(p, e.right);
          p.isControlFlowDead = old;
        } else {
          e.right = visitExprImpl(p, e.right);
        }
        break;
      }

      case BinOpComma:
        e.right = visitExprInOutImpl(p, e.right, inForMangleStrings(v.in.shouldMangleStringsAsProps));
        break;

      case BinOpAssign:
      case BinOpLogicalOrAssign:
      case BinOpLogicalAndAssign:
      case BinOpNullishCoalescingAssign: {
        // Check for a propagated name to keep from the parent context
        const id = e.left.data;
        if (id.k === E_IDENTIFIER) {
          p.nameToKeep = p.symbols[refInner(id.ref)].originalName;
          p.nameToKeepIsFor = e.right.data;
        }

        e.right = visitExprImpl(p, e.right);
        break;
      }

      default:
        e.right = visitExprImpl(p, e.right);
    }
    p.fnOnlyDataVisit.silenceMessageAboutThisBeingUndefined = v.oldSilenceWarningAboutThisBeingUndefined;

    // (minifySyntax only: "1 === x" => "x === 1")

    if (p.shouldFoldTypeScriptConstantExpressions /* || (minifySyntax && ShouldFoldBinaryOperatorWhenMinifying(e)) */) {
      const result = foldBinaryOperator(v.loc, e);
      if (result != null) {
        return result;
      }
    }

    // Post-process the binary expression
    switch (e.op) {
      case BinOpComma:
        // "(1, 2)" => "2"
        // "(sideEffects(), 2)" => "(sideEffects(), 2)"
        // (minifySyntax only)
        break;

      case BinOpLooseEq: {
        const $d147 = checkEqualityIfNoSideEffects(e.left.data, e.right.data, LooseEquality);
        const result = $d147[0], ok = $d147[1];
        if (ok) {
          return new Expr(new EBoolean(result), v.loc);
        }
        const afterOpLoc = locAfterOp(e);
        if (!p.warnAboutEqualityCheck("==", e.left, afterOpLoc)) {
          p.warnAboutEqualityCheck("==", e.right, afterOpLoc);
        }
        p.warnAboutTypeofAndString(e.left, e.right, checkBothOrders);

        // (minifySyntax only: "x == void 0" => "x == null", MaybeSimplifyEqualityComparison)
        break;
      }

      case BinOpStrictEq: {
        const $d148 = checkEqualityIfNoSideEffects(e.left.data, e.right.data, StrictEquality);
        const result = $d148[0], ok = $d148[1];
        if (ok) {
          return new Expr(new EBoolean(result), v.loc);
        }
        const afterOpLoc = locAfterOp(e);
        if (!p.warnAboutEqualityCheck("===", e.left, afterOpLoc)) {
          p.warnAboutEqualityCheck("===", e.right, afterOpLoc);
        }
        p.warnAboutTypeofAndString(e.left, e.right, checkBothOrders);

        // (minifySyntax only: CanChangeStrictToLoose, MaybeSimplifyEqualityComparison)
        break;
      }

      case BinOpLooseNe: {
        const $d149 = checkEqualityIfNoSideEffects(e.left.data, e.right.data, LooseEquality);
        const result = $d149[0], ok = $d149[1];
        if (ok) {
          return new Expr(new EBoolean(!result), v.loc);
        }
        const afterOpLoc = locAfterOp(e);
        if (!p.warnAboutEqualityCheck("!=", e.left, afterOpLoc)) {
          p.warnAboutEqualityCheck("!=", e.right, afterOpLoc);
        }
        p.warnAboutTypeofAndString(e.left, e.right, checkBothOrders);

        // (minifySyntax only: "x != void 0" => "x != null", MaybeSimplifyEqualityComparison)
        break;
      }

      case BinOpStrictNe: {
        const $d150 = checkEqualityIfNoSideEffects(e.left.data, e.right.data, StrictEquality);
        const result = $d150[0], ok = $d150[1];
        if (ok) {
          return new Expr(new EBoolean(!result), v.loc);
        }
        const afterOpLoc = locAfterOp(e);
        if (!p.warnAboutEqualityCheck("!==", e.left, afterOpLoc)) {
          p.warnAboutEqualityCheck("!==", e.right, afterOpLoc);
        }
        p.warnAboutTypeofAndString(e.left, e.right, checkBothOrders);

        // (minifySyntax only: CanChangeStrictToLoose, MaybeSimplifyEqualityComparison)
        break;
      }

      case BinOpNullishCoalescing: {
        const $d151 = toNullOrUndefinedWithSideEffects(e.left.data);
        const isNullOrUndefined = $d151[0], sideEffects = $d151[1], ok = $d151[2];
        if (ok) {
          // Warn about potential bugs
          if (!isPrimitiveLiteral(e.left.data)) {
            // "return props.flag === flag ?? true" is "return (props.flag === flag) ?? true" not "return props.flag === (flag ?? true)"
            let kind = Warning;
            if (p.suppressWarningsAboutWeirdCode) {
              kind = Debug;
            }
            p.log.addIDWithNotes(MsgID_JS_SuspiciousNullishCoalescing, kind);
          }

          if (!isNullOrUndefined) {
            return e.left;
          } else if (sideEffects === NoSideEffects) {
            return e.right;
          }
        }

        // (minifySyntax only: "a ?? (b ?? c)" => "a ?? b ?? c")
        // (compat.NullishCoalescing is always supported: no lowering)
        break;
      }

      case BinOpLogicalOr: {
        const $d152 = toBooleanWithSideEffects(e.left.data);
        const boolean = $d152[0], sideEffects = $d152[1], ok = $d152[2];
        if (ok) {
          // Warn about potential bugs
          if (e === p.suspiciousLogicalOperatorInsideArrow) {
            const arrowLoc = p.source.rangeOfOperatorBefore(v.loc, "=>");
            if (arrowLoc.loc + 2 === p.source.locBeforeWhitespace(v.loc)) {
              // "return foo => 1 || foo <= 0"
              let kind = Warning;
              if (p.suppressWarningsAboutWeirdCode) {
                kind = Debug;
              }
              p.log.addIDWithNotes(MsgID_JS_SuspiciousLogicalOperator, kind);
            }
          }

          if (boolean) {
            return e.left;
          } else if (sideEffects === NoSideEffects) {
            return e.right;
          }
        }

        // (minifySyntax only: "a || (b || c)" => "a || b || c", "a === null || a === undefined" => "a == null")
        break;
      }

      case BinOpLogicalAnd: {
        const $d153 = toBooleanWithSideEffects(e.left.data);
        const boolean = $d153[0], sideEffects = $d153[1], ok = $d153[2];
        if (ok) {
          // Warn about potential bugs
          if (e === p.suspiciousLogicalOperatorInsideArrow) {
            const arrowLoc = p.source.rangeOfOperatorBefore(v.loc, "=>");
            if (arrowLoc.loc + 2 === p.source.locBeforeWhitespace(v.loc)) {
              // "return foo => 0 && foo <= 1"
              let kind = Warning;
              if (p.suppressWarningsAboutWeirdCode) {
                kind = Debug;
              }
              p.log.addIDWithNotes(MsgID_JS_SuspiciousLogicalOperator, kind);
            }
          }

          if (!boolean) {
            return e.left;
          } else if (sideEffects === NoSideEffects) {
            return e.right;
          }
        }

        // (minifySyntax only: "a && (b && c)" => "a && b && c", "a !== null && a !== undefined" => "a != null")
        break;
      }

      case BinOpAdd: {
        // "'abc' + 'xyz'" => "'abcxyz'"
        const result = foldStringAddition(e.left, e.right, StringAdditionNormal);
        if (result != null) {
          return result;
        }

        const left = e.left.data;
        if (left.k === E_BINARY && left.op === BinOpAdd) {
          // "x + 'abc' + 'xyz'" => "x + 'abcxyz'"
          const result2 = foldStringAddition(left.right, e.right, StringAdditionWithNestedLeft);
          if (result2 != null) {
            return new Expr(new EBinary(left.left, result2, left.op), v.loc);
          }
        }
        break;
      }

      case BinOpPow:
        // (compat.ExponentOperator is always supported: no "__pow" lowering)
        break;

      ////////////////////////////////////////////////////////////////////////////////
      // All assignment operators below here

      case BinOpAssign: {
        const $d154 = p.extractPrivateIndex(e.left);
        const target = $d154[0], loc = $d154[1], private_ = $d154[2];
        if (private_ != null) {
          return p.lowerPrivateSet(target, loc, private_, e.right);
        }

        const property = p.extractSuperProperty(e.left);
        if (property != null) {
          return p.lowerSuperPropertySet(e.left.loc, property, e.right);
        }

        // Lower assignment destructuring patterns for browsers that don't
        // support them. Note that assignment expressions are used to represent
        // initializers in binding patterns, so only do this if we're not
        // ourselves the target of an assignment. Example: "[a = b] = c"
        if (v.in.assignTarget === AssignTargetNone) {
          let mode = objRestMustReturnInitExpr;
          if (v.isStmtExpr) {
            mode = objRestReturnValueIsUnused;
          }
          const $d155 = p.lowerAssign(e.left, e.right, mode);
          const result = $d155[0], ok = $d155[1];
          if (ok) {
            return result;
          }

          // If CommonJS-style exports are disabled, then references to them are
          // treated as global variable references. This is consistent with how
          // they work in node and the browser, so it's the correct interpretation.
          //
          // However, people sometimes try to use both types of exports within the
          // same module and expect it to work. We warn about this when module
          // format conversion is enabled.
          //
          // Only warn about this for uses in assignment position since there are
          // some legitimate other uses. For example, some people do "typeof module"
          // to check for a CommonJS environment, and we shouldn't warn on that.
          if (p.options.mode !== ModePassThrough && p.isFileConsideredToHaveESMExports && !p.isControlFlowDead) {
            const dot = e.left.data;
            if (dot.k === E_DOT) {
              let name = "";

              const target2 = dot.target.data;
              switch (target2.k) {
                case E_IDENTIFIER: {
                  const symbol = p.symbols[refInner(target2.ref)];
                  if (
                    symbol.kind === SymbolUnbound &&
                    ((symbol.originalName === "module" && dot.name === "exports") || symbol.originalName === "exports") &&
                    (symbol.flags & DidWarnAboutCommonJSInESM) === 0
                  ) {
                    // "module.exports = ..."
                    // "exports.something = ..."
                    name = symbol.originalName;
                    symbol.flags |= DidWarnAboutCommonJSInESM;
                  }
                  break;
                }

                case E_DOT:
                  if (target2.name === "exports") {
                    const id = target2.target.data;
                    if (id.k === E_IDENTIFIER) {
                      const symbol = p.symbols[refInner(id.ref)];
                      if (symbol.kind === SymbolUnbound && symbol.originalName === "module" && (symbol.flags & DidWarnAboutCommonJSInESM) === 0) {
                        // "module.exports.foo = ..."
                        name = symbol.originalName;
                        symbol.flags |= DidWarnAboutCommonJSInESM;
                      }
                    }
                  }
                  break;
              }

              if (name !== "") {
                let kind = Warning;
                if (p.suppressWarningsAboutWeirdCode) {
                  kind = Debug;
                }
                // (whyESModule() and the notes only affect the message text)
                p.log.addIDWithNotes(MsgID_JS_CommonJSVariableInESM, kind);
              }
            }
          }
        }
        break;
      }

      case BinOpAddAssign: {
        const result = p.maybeLowerSetBinOp(e.left, BinOpAdd, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpSubAssign: {
        const result = p.maybeLowerSetBinOp(e.left, BinOpSub, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpMulAssign: {
        const result = p.maybeLowerSetBinOp(e.left, BinOpMul, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpDivAssign: {
        const result = p.maybeLowerSetBinOp(e.left, BinOpDiv, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpRemAssign: {
        const result = p.maybeLowerSetBinOp(e.left, BinOpRem, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpPowAssign: {
        // (compat.ExponentOperator is always supported: no lowering)

        const result = p.maybeLowerSetBinOp(e.left, BinOpPow, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpShlAssign: {
        const result = p.maybeLowerSetBinOp(e.left, BinOpShl, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpShrAssign: {
        const result = p.maybeLowerSetBinOp(e.left, BinOpShr, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpUShrAssign: {
        const result = p.maybeLowerSetBinOp(e.left, BinOpUShr, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpBitwiseOrAssign: {
        const result = p.maybeLowerSetBinOp(e.left, BinOpBitwiseOr, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpBitwiseAndAssign: {
        const result = p.maybeLowerSetBinOp(e.left, BinOpBitwiseAnd, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpBitwiseXorAssign: {
        const result = p.maybeLowerSetBinOp(e.left, BinOpBitwiseXor, e.right);
        if (result != null) {
          return result;
        }
        break;
      }

      case BinOpNullishCoalescingAssign: {
        const $d156 = p.lowerNullishCoalescingAssignmentOperator(v.loc, e);
        const value = $d156[0], ok = $d156[1];
        if (ok) {
          return value;
        }
        break;
      }

      case BinOpLogicalAndAssign: {
        const $d157 = p.lowerLogicalAssignmentOperator(v.loc, e, BinOpLogicalAnd);
        const value = $d157[0], ok = $d157[1];
        if (ok) {
          return value;
        }
        break;
      }

      case BinOpLogicalOrAssign: {
        const $d158 = p.lowerLogicalAssignmentOperator(v.loc, e, BinOpLogicalOr);
        const value = $d158[0], ok = $d158[1];
        if (ok) {
          return value;
        }
        break;
      }
    }

    // (minifySyntax only: "(a, b) + c" => "a, b + c")

    return v.expr !== null && v.expr.data === e && v.expr.loc === v.loc ? v.expr : new Expr(e, v.loc);
  },
});

// ---------------------------------------------------------------------------
// Parser methods (mixed into Parser.prototype by js_parser.mjs)

export const visitExprMethods = {
  visitExpr(expr) {
    const p = this;
    return visitExprInOutImpl(p, expr, EXPR_IN_DEFAULT);
  },

  // Returns [Expr, ok]
  valueForThis(loc, shouldLog, assignTarget, isCallTarget, isDeleteTarget) {
    const p = this;
    const value = valueForThisImpl(p, loc, shouldLog, assignTarget, isCallTarget, isDeleteTarget);
    if (value === undefined) {
      return [null, false];
    }
    return [value, true];
  },

  // Returns [Expr, ok]
  valueForImportMeta(loc) {
    const p = this;
    const value = valueForImportMetaImpl(p, loc);
    return [value, value !== null];
  },

  reportPrivateNameUsage(name) {
    const p = this;
    if (p.parseExperimentalDecoratorNesting > 0) {
      if (p.lowerAllOfThesePrivateNames == null) {
        p.lowerAllOfThesePrivateNames = new Map();
      }
      p.lowerAllOfThesePrivateNames.set(name, true);
    }
  },

  isValidAssignmentTarget(expr) {
    const p = this;
    const e = expr.data;
    switch (e.k) {
      case E_IDENTIFIER:
        if (p.isStrictMode()) {
          const name = p.loadNameFromRef(e.ref);
          if (isEvalOrArguments(name)) {
            return false;
          }
        }
        return true;
      case E_DOT:
        return e.optionalChain === OptionalChainNone;
      case E_INDEX:
        return e.optionalChain === OptionalChainNone;

      // Don't worry about recursive checking for objects and arrays. This will
      // already be handled naturally by passing down the assign target flag.
      case E_OBJECT:
        return !e.isParenthesized;
      case E_ARRAY:
        return !e.isParenthesized;
    }
    return false;
  },

  // Returns [pattern, flags, isUnsupported]
  isUnsupportedRegularExpression(loc, value) {
    const p = this;
    return isUnsupportedRegularExpressionImpl(p, loc, value);
  },

  // Returns [Expr, exprOut] (see the calling convention at the top of this file)
  visitExprInOut(expr, in_) {
    const p = this;
    const result = visitExprInOutImpl(p, expr, in_);
    return [result, lastOut];
  },

  // Glob-style imports are only generated when bundling (both call sites are
  // guarded by "p.options.mode == config.ModeBundle"), so these never run in
  // the fast path.
  handleGlobPattern(expr, kind, phase, prefix, assertOrWith) {
    bail();
  },

  globPatternFromExpr(expr) {
    bail();
  },

  convertSymbolUseToCall(ref, isSingleNonSpreadArgCall) {
    const p = this;

    // Remove the normal symbol use
    const symbolUses = p.currentPart.symbolUses;
    const use = symbolUses.get(ref);
    const countEstimate = ((use === undefined ? 0 : use.countEstimate) - 1) >>> 0; // uint32
    if (countEstimate === 0) {
      symbolUses.delete(ref);
    } else {
      symbolUses.set(ref, new SymbolUse(countEstimate));
    }

    // Add a special symbol use instead
    let symbolCallUses = p.currentPart.symbolCallUses;
    if (symbolCallUses == null) {
      symbolCallUses = new Map();
      p.currentPart.symbolCallUses = symbolCallUses;
    }
    const callUse = symbolCallUses.get(ref);
    let callCountEstimate = callUse === undefined ? 0 : callUse.callCountEstimate;
    let singleArgNonSpreadCallCountEstimate = callUse === undefined ? 0 : callUse.singleArgNonSpreadCallCountEstimate;
    callCountEstimate++;
    if (isSingleNonSpreadArgCall) {
      singleArgNonSpreadCallCountEstimate++;
    }
    symbolCallUses.set(ref, new SymbolCallUse(callCountEstimate, singleArgNonSpreadCallCountEstimate));
  },

  warnAboutImportNamespaceCall(target, kind) {
    const p = this;
    if (p.options.outputFormat !== FormatPreserve) {
      if (target === null) {
        return;
      }
      const id = target.data;
      if (id.k === E_IDENTIFIER) {
        const importItems = p.importItemsForNamespace.get(id.ref);
        if (importItems !== undefined && importItems.entries != null) {
          const key = importNamespaceCallKey(id.ref, kind);
          if (p.importNamespaceCCMap == null) {
            p.importNamespaceCCMap = new Map();
          }

          // Don't log a warning for the same identifier more than once
          if (p.importNamespaceCCMap.has(key)) {
            return;
          }

          p.importNamespaceCCMap.set(key, true);

          // (The notes, verb, noun, etc. only affect the message text)
          p.log.addIDWithNotes(MsgID_JS_CallImportNamespace, Warning);
        }
      }
    }
  },

  maybeMarkKnownGlobalConstructorAsPure(e) {
    const p = this;
    const id = e.target.data;
    if (id.k === E_IDENTIFIER) {
      const symbol = p.symbols[refInner(id.ref)];
      if (symbol.kind === SymbolUnbound) {
        switch (symbol.originalName) {
          case "WeakSet":
          case "WeakMap": {
            const n = e.args.length;

            if (n === 0) {
              // "new WeakSet()" is pure
              e.canBeUnwrappedIfUnused = true;
              break;
            }

            if (n === 1) {
              const arg = e.args[0].data;
              switch (arg.k) {
                case E_NULL:
                case E_UNDEFINED:
                  // "new WeakSet(null)" is pure
                  // "new WeakSet(void 0)" is pure
                  e.canBeUnwrappedIfUnused = true;
                  break;

                case E_ARRAY:
                  if (arg.items.length === 0) {
                    // "new WeakSet([])" is pure
                    e.canBeUnwrappedIfUnused = true;
                  } else {
                    // "new WeakSet([x])" is impure because an exception is thrown if "x" is not an object
                  }
                  break;

                default:
                // "new WeakSet(x)" is impure because the iterator for "x" could have side effects
              }
            }
            break;
          }

          case "Date": {
            const n = e.args.length;

            if (n === 0) {
              // "new Date()" is pure
              e.canBeUnwrappedIfUnused = true;
              break;
            }

            if (n === 1) {
              switch (knownPrimitiveType(e.args[0].data)) {
                case PrimitiveNull:
                case PrimitiveUndefined:
                case PrimitiveBoolean:
                case PrimitiveNumber:
                case PrimitiveString:
                  // "new Date('')" is pure
                  // "new Date(0)" is pure
                  // "new Date(null)" is pure
                  // "new Date(true)" is pure
                  // "new Date(false)" is pure
                  // "new Date(undefined)" is pure
                  e.canBeUnwrappedIfUnused = true;
                  break;

                default:
                // "new Date(x)" is impure because converting "x" to a string could have side effects
              }
            }
            break;
          }

          case "Set": {
            const n = e.args.length;

            if (n === 0) {
              // "new Set()" is pure
              e.canBeUnwrappedIfUnused = true;
              break;
            }

            if (n === 1) {
              switch (e.args[0].data.k) {
                case E_ARRAY:
                case E_NULL:
                case E_UNDEFINED:
                  // "new Set([a, b, c])" is pure
                  // "new Set(null)" is pure
                  // "new Set(void 0)" is pure
                  e.canBeUnwrappedIfUnused = true;
                  break;

                default:
                // "new Set(x)" is impure because the iterator for "x" could have side effects
              }
            }
            break;
          }

          case "Map": {
            const n = e.args.length;

            if (n === 0) {
              // "new Map()" is pure
              e.canBeUnwrappedIfUnused = true;
              break;
            }

            if (n === 1) {
              const arg = e.args[0].data;
              switch (arg.k) {
                case E_NULL:
                case E_UNDEFINED:
                  // "new Map(null)" is pure
                  // "new Map(void 0)" is pure
                  e.canBeUnwrappedIfUnused = true;
                  break;

                case E_ARRAY: {
                  let allEntriesAreArrays = true;
                  for (let $i53 = 0, $a53 = arg.items; $i53 < $a53.length; $i53++) {
                    const item = $a53[$i53];
                    if (item.data.k !== E_ARRAY) {
                      // "new Map([x])" is impure because "x[0]" could have side effects
                      allEntriesAreArrays = false;
                      break;
                    }
                  }

                  // "new Map([[a, b], [c, d]])" is pure
                  if (allEntriesAreArrays) {
                    e.canBeUnwrappedIfUnused = true;
                  }
                  break;
                }

                default:
                // "new Map(x)" is impure because the iterator for "x" could have side effects
              }
            }
            break;
          }
        }
      }
    }
  },

  // (JS-only: "origExpr", if given, is an Expr with this loc and data "e". It
  // is returned instead of an equal new Expr: Exprs are immutable values.)
  handleIdentifier(loc, e, opts, origExpr = null) {
    const p = this;
    const ref = e.ref;

    // (minifySyntax only: substitute inlined constants)

    // (Capturing "arguments" only happens when lowering arrow functions or
    // async arrow functions, never in the fast path)

    // Create an error for assigning to an import namespace
    if (
      (opts.assignTarget !== AssignTargetNone ||
        (opts.isDeleteTarget && p.symbols[refInner(ref)].importItemStatus === ImportItemGenerated)) &&
      p.symbols[refInner(ref)].kind === SymbolImport
    ) {
      // (The setter hint and notes only affect the message text)
      if (p.options.mode === ModeBundle) {
        p.log.addErrorWithNotes(); // Cannot assign to import %q
      } else {
        let kind = Warning;
        if (p.suppressWarningsAboutWeirdCode) {
          kind = Debug;
        }
        p.log.addIDWithNotes(MsgID_JS_AssignToImport, kind);
      }
    }

    // Substitute an EImportIdentifier now if this has a namespace alias
    if (opts.assignTarget === AssignTargetNone && !opts.isDeleteTarget) {
      const symbol = p.symbols[refInner(ref)];
      const nsAlias = symbol.namespaceAlias;
      if (nsAlias !== null) {
        const data = p.dotOrMangledPropVisit(new Expr(new EIdentifier(nsAlias.namespaceRef), loc), symbol.originalName, loc);

        // Handle references to namespaces or namespace members
        const tsMemberData = p.refToTSNamespaceMemberData.get(nsAlias.namespaceRef);
        if (tsMemberData !== undefined) {
          if (tsMemberData.k === TS_NAMESPACE_MEMBER_NAMESPACE) {
            const member = tsMemberData.exportedMembers.get(nsAlias.alias);
            if (member !== undefined) {
              const m = member.data;
              switch (m.k) {
                case TS_NAMESPACE_MEMBER_ENUM_NUMBER:
                  return p.wrapInlinedEnum(new Expr(new ENumber(m.value), loc), nsAlias.alias);

                case TS_NAMESPACE_MEMBER_ENUM_STRING:
                  return p.wrapInlinedEnum(new Expr(new EString(m.value), loc), nsAlias.alias);

                case TS_NAMESPACE_MEMBER_NAMESPACE:
                  p.tsNamespaceTarget = data;
                  p.tsNamespaceMemberData = member.data;
                  break;
              }
            }
          }
        }

        return new Expr(data, loc);
      }
    }

    // Substitute an EImportIdentifier now if this is an import item
    // (all values stored in "isImportItem" are true)
    if (p.isImportItem.has(ref)) {
      return new Expr(new EImportIdentifier(ref, opts.preferQuotedKey, opts.wasOriginallyIdentifier), loc);
    }

    // Handle references to namespaces or namespace members
    const tsMemberData = p.refToTSNamespaceMemberData.get(ref);
    if (tsMemberData !== undefined) {
      switch (tsMemberData.k) {
        case TS_NAMESPACE_MEMBER_ENUM_NUMBER:
          return p.wrapInlinedEnum(new Expr(new ENumber(tsMemberData.value), loc), p.symbols[refInner(ref)].originalName);

        case TS_NAMESPACE_MEMBER_ENUM_STRING:
          return p.wrapInlinedEnum(new Expr(new EString(tsMemberData.value), loc), p.symbols[refInner(ref)].originalName);

        case TS_NAMESPACE_MEMBER_NAMESPACE:
          p.tsNamespaceTarget = e;
          p.tsNamespaceMemberData = tsMemberData;
          break;
      }
    }

    // Substitute a namespace export reference now if appropriate
    if (p.options.ts.parse) {
      const nsRef = p.isExportedInsideNamespace.get(ref);
      if (nsRef !== undefined) {
        const name = p.symbols[refInner(ref)].originalName;

        // Otherwise, create a property access on the namespace
        p.recordUsage(nsRef);
        const propertyAccess = p.dotOrMangledPropVisit(new Expr(new EIdentifier(nsRef), loc), name, loc);
        if (p.tsNamespaceTarget === e) {
          p.tsNamespaceTarget = propertyAccess;
        }
        return new Expr(propertyAccess, loc);
      }
    }

    // Swap references to the global "require" function with our "__require" stub
    if (ref === p.requireRef && !opts.isCallTarget) {
      // (ModeBundle only: debug log about indirect calls to "require")

      return p.valueToSubstituteForRequire(loc);
    }

    // Mark any mutated symbols as mutable
    if (opts.assignTarget !== AssignTargetNone) {
      p.symbols[refInner(e.ref)].flags |= CouldPotentiallyBeMutated;
    }

    if (origExpr !== null && origExpr.data === e && origExpr.loc === loc) {
      return origExpr;
    }
    return new Expr(e, loc);
  },

  // Go: func (p *parser) visitFn(fn *js_ast.Fn, scopeLoc logger.Loc, opts visitFnOpts)
  visitFn(fn, scopeLoc, opts) {
    const p = this;
    let decoratorScope = null;
    const oldFnOrArrowData = p.fnOrArrowDataVisit;
    const oldFnOnlyData = p.fnOnlyDataVisit;
    p.fnOrArrowDataVisit = new fnOrArrowDataVisit(
      0, // tryBodyCount
      0, // tryCatchLoc
      false, // isArrow
      fn.isAsync, // isAsync
      fn.isGenerator, // isGenerator
      false, // isInsideLoop
      false, // isInsideSwitch
      opts.isDerivedClassCtor, // isDerivedClassCtor
      false, // isOutsideFnOrArrow
      // (fn.IsAsync && compat.AsyncAwait unsupported) is always false here
      opts.isLoweredPrivateMethod, // shouldLowerSuperPropertyAccess
    );
    p.fnOnlyDataVisit = new fnOnlyDataVisit(
      fn.argumentsRef, // argumentsRef (Go: &fn.ArgumentsRef, only ever read)
      null, // thisCaptureRef
      null, // argumentsCaptureRef
      false, // shouldReplaceThisWithInnerClassNameRef
      false, // isInStaticClassContext
      null, // innerClassNameRef
      false, // isInsideAsyncArrowFn
      true, // isNewTargetAllowed
      true, // isThisNested
    );

    if (opts.isMethod) {
      decoratorScope = p.propMethodDecoratorScope;
      p.fnOnlyDataVisit.innerClassNameRef = oldFnOnlyData.innerClassNameRef;
      p.fnOnlyDataVisit.isInStaticClassContext = oldFnOnlyData.isInStaticClassContext;
    }

    if (fn.name !== null) {
      p.recordDeclaredSymbol(fn.name.ref);
    }

    p.pushScopeForVisitPass(ScopeFunctionArgs, scopeLoc);
    p.visitArgs(fn.args, new visitArgsOpts(fn.body.block.stmts, decoratorScope, fn.hasRestArg, fn.isUniqueFormalParameters));
    p.pushScopeForVisitPass(ScopeFunctionBody, fn.body.loc);
    if (fn.name !== null) {
      p.validateDeclaredSymbolName(fn.name.loc, p.symbols[refInner(fn.name.ref)].originalName);
    }
    fn.body.block.stmts = p.visitStmtsAndPrependTempRefs(fn.body.block.stmts, new prependTempRefsOpts(fn.body.loc, stmtsFnBody));
    p.popScope();
    // (p.lowerFunction(...): its body only runs when lowering, never in the fast path)
    p.popScope();

    p.fnOrArrowDataVisit = oldFnOrArrowData;
    p.fnOnlyDataVisit = oldFnOnlyData;
  },
};
// generated from js_parser_visit_expr.mts by tools/ts-build.mjs; edit that file
