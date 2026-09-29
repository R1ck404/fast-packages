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
// All branches are ported.
// ---------------------------------------------------------------------------

import { SourceIndex as RuntimeSourceIndex } from "./runtime.mjs";
import { goQuote } from "./gostd.mjs";
import { GoPanic, goTypeName } from "./gopanic.mjs";
import { parseJSON, JSONOptions, isValidJSON } from "./json_parser.mjs";
import { Source, generateStringInJSTable, remapStringInJSLoc, newStringInJSLog, type StringInJSTable } from "./logger.mjs";

// ParseJSON's result, Go's zero Expr (a nil Data) when it failed
function parseJSONOrZero(log, source) {
  const r = parseJSON(log, source, new JSONOptions());
  return r[0] !== null ? r[0] : new Expr(null, 0);
}
import {
  jsFeatureHas,
  Arrow,
  AsyncAwait,
  AsyncGenerator,
  Bigint,
  Destructuring,
  DynamicImport,
  ExponentOperator,
  ImportAssertions,
  ImportAttributes,
  ImportMeta,
  InlineScript,
  NullishCoalescing,
  OptionalChain,
  RegexpDotAllFlag,
  RegexpLookbehindAssertions,
  RegexpMatchIndices,
  RegexpNamedCaptureGroups,
  RegexpSetNotation,
  RegexpStickyAndUnicodeFlags,
  RegexpUnicodePropertyEscapes,
  TemplateLiteral,
  TopLevelAwait,
} from "./compat.mjs";
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
  MsgID_JS_UnsupportedDynamicImport,
  MsgID_JS_IndirectRequire,
  MsgID_JS_DirectEval,
  MsgData,
  Msg,
  MsgID_JS_UnsupportedRegExp,
  LineColumnTracker,
  ByteRange,
  Error as LogError,
  MsgID_JS_ThisIsUndefinedInESM,
} from "./logger.mjs";
import {
  codePointAt,
  GlobPart,
  GlobNone,
  GlobAllExceptSlash,
  GlobAllIncludingSlash,
  utf8Len,
} from "./helpers.mjs";
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
  Stmt,
  Fn,
  FnBody,
  SBlock,
  SReturn,
  Property,
  PropertyField,
  PropertyMethod,
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
  E_INLINED_ENUM,
  EArray,
  EUnary,
  EBinary,
  EBoolean,
  ECall,
  EDot,
  EFunction,
  ENameOfSymbol,
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
  constValueToExpr,
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
  PrimitiveBigInt,
  NoSideEffects,
  CouldHaveSideEffects,
  toNullOrUndefinedWithSideEffects,
  checkEqualityIfNoSideEffects,
  LooseEquality,
  StrictEquality,
  isPrimitiveLiteral,
  foldBinaryOperator,
  foldStringAddition,
  StringAdditionNormal,
  StringAdditionWithNestedLeft,
  shouldFoldBinaryOperatorWhenMinifying,
  maybeSimplifyEqualityComparison,
  maybeSimplifyNot,
  not,
  assign,
  canChangeStrictToLoose,
  joinWithComma,
  joinWithLeftAssociativeOp,
  isBinaryNullAndUndefined,
  stringToEquivalentNumberValue,
  inlineSpreadsOfArrayLiterals,
  mangleObjectSpread,
  tryToStringOnNumberSafely,
} from "./js_ast_helpers.mjs";
import {
  isIdentifierUTF16,
  isIdentifierContinue,
  isIdentifier,
} from "./js_ident.mjs";
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
  prettyPrintTargetEnvironment,
  formatString,
} from "./config.mjs";
import {
  exprIn,
  exprOut,
  EXPR_IN_DEFAULT,
  EXPR_OUT_DEFAULT,
  binaryExprVisitor,
  identifierOpts,
  visitFnOpts,
  globPart,
  globPatternImport,
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
  wasOriginallyIndex,
  tempRefNeedsDeclareMayBeCapturedInsideLoop,
  whyESMTypeModulePackageJSON,
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

// "p.options.unsupportedJSFeatures.Has(compat.InlineScript)"
function unsupportedJSFeaturesHasInlineScript(p) {
  return jsFeatureHas(p.options.unsupportedJSFeatures, InlineScript);
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

// (only used by the Yarn PnP manifest hack)
export function remapExprLocsInJSON(expr, table: StringInJSTable) {
  expr.loc = remapStringInJSLoc(table, expr.loc);

  const e = expr.data;
  if (e instanceof EArray) {
    e.closeBracketLoc = remapStringInJSLoc(table, e.closeBracketLoc);
    for (let i = 0; i < e.items.length; i++) {
      remapExprLocsInJSON(e.items[i], table);
    }
  } else if (e instanceof EObject) {
    e.closeBraceLoc = remapStringInJSLoc(table, e.closeBraceLoc);
    for (let i = 0; i < e.properties.length; i++) {
      remapExprLocsInJSON(e.properties[i].key, table);
      remapExprLocsInJSON(e.properties[i].valueOrNil, table);
    }
  }
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
        const kind = Debug;
        const data = p.tracker.msgData(rangeOfIdentifier(p.source, loc), 'Top-level "this" will be replaced with undefined since this file is an ECMAScript module');
        data.location.suggestion = "undefined";
        const notes = p.whyESModule()[1];
        p.log.addMsgID(MsgID_JS_ThisIsUndefinedInESM, new Msg(notes, "", data, kind));
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
  if (
    jsFeatureHas(p.options.unsupportedJSFeatures, ImportMeta) ||
    (p.options.mode !== ModePassThrough && !formatKeepESMImportExportSyntax(p.options.outputFormat))
  ) {
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
// ranges are UTF-16 ones, which the tracker converts to bytes).
function isUnsupportedRegularExpressionImpl(p, loc, value) {
  let isUnsupported = false;
  let what = "";
  let r = RANGE_ZERO;
  const unsupported = p.options.unsupportedJSFeatures;

  const end = value.lastIndexOf("/");
  const pattern = value.slice(1, end);
  const flags = value.slice(end + 1);
  const isUnicode = flags.indexOf("u") >= 0;
  let parenDepth = 0;
  let i = 0;

  // Do a simple scan for unsupported features assuming the regular expression
  // is valid. This doesn't do a full validation of the regular expression
  // because regular expression grammar is complicated. If it contains a syntax
  // error that we don't catch, then we will just generate output code with a
  // syntax error. Garbage in, garbage out.
  patternLoop: while (i < pattern.length) {
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
        // "tail := pattern[i:]"
        if (pattern.startsWith("?<=", i) || pattern.startsWith("?<!", i)) {
          if (jsFeatureHas(unsupported, RegexpLookbehindAssertions)) {
            what = "Lookbehind assertions in regular expressions are not available";
            r = mkRange(loc + i + 1, 3);
            isUnsupported = true;
            break patternLoop;
          }
        } else if (pattern.startsWith("?<", i)) {
          if (jsFeatureHas(unsupported, RegexpNamedCaptureGroups)) {
            const end = pattern.indexOf(">", i);
            if (end >= 0) {
              what = "Named capture groups in regular expressions are not available";
              r = mkRange(loc + i + 1, end - i + 1);
              isUnsupported = true;
              break patternLoop;
            }
          }
        }

        parenDepth++;
        break;

      case 41 /* ) */:
        if (parenDepth === 0) {
          const r = mkRange(loc + i, 1);
          p.log.addError(p.tracker, r, 'Unexpected ")" in regular expression');
          return [pattern, flags, isUnsupported];
        }
        parenDepth--;
        break;

      case 92 /* \ */:
        if (isUnicode && (pattern.startsWith("p{", i) || pattern.startsWith("P{", i))) {
          if (jsFeatureHas(unsupported, RegexpUnicodePropertyEscapes)) {
            const end = pattern.indexOf("}", i);
            if (end >= 0) {
              what = "Unicode property escapes in regular expressions are not available";
              r = mkRange(loc + i, end - i + 2);
              isUnsupported = true;
              break patternLoop;
            }
          }
        }

        i++; // Skip the escaped character
        break;
    }
  }

  if (!isUnsupported) {
    // (Regular expression flags are ASCII letters: see the lexer)
    for (let j = 0; j < flags.length; j++) {
      const c = flags.charCodeAt(j);
      switch (c) {
        case 103 /* g */:
        case 105 /* i */:
        case 109 /* m */:
          continue; // These are part of ES5 and are always supported

        case 115 /* s */:
          if (!jsFeatureHas(unsupported, RegexpDotAllFlag)) {
            continue; // This is part of ES2018
          }
          break;

        case 121 /* y */:
        case 117 /* u */:
          if (!jsFeatureHas(unsupported, RegexpStickyAndUnicodeFlags)) {
            continue; // These are part of ES2018
          }
          break;

        case 100 /* d */:
          if (!jsFeatureHas(unsupported, RegexpMatchIndices)) {
            continue; // This is part of ES2022
          }
          break;

        case 118 /* v */:
          if (!jsFeatureHas(unsupported, RegexpSetNotation)) {
            continue; // This is from a proposal: https://github.com/tc39/proposal-regexp-v-flag
          }
          break;

        default:
        // Unknown flags are never supported
      }

      r = mkRange(loc + end + 1 + j, 1);
      what = 'The regular expression flag "' + String.fromCharCode(c) + '" is not available';
      isUnsupported = true;
      break;
    }
  }

  if (isUnsupported) {
    const where = prettyPrintTargetEnvironment(p.options.originalTargetEnv, p.options.unsupportedJSFeatureOverridesMask);
    p.log.addIDWithNotes(MsgID_JS_UnsupportedRegExp, Debug, p.tracker, r, what + " in " + where, [
      new MsgData(
        null,
        null,
        'This regular expression literal has been converted to a "new RegExp()" constructor ' +
          "to avoid generating code with a syntax error. However, you will need to include a " +
          'polyfill for "RegExp" for your code to have the correct behavior at run-time.',
      ),
    ]);
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
    p.log.addError(p.tracker, mkRange(expr.loc, 0), "Invalid assignment target");
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
      if (jsFeatureHas(p.options.unsupportedJSFeatures, Bigint)) {
        // For ease of implementation, the actual reference of the "BigInt"
        // symbol is deferred to print time. That means we don't have to
        // special-case the "BigInt" constructor in side-effect computations
        // and future big integer constant folding (of which there isn't any
        // at the moment).
        p.markSyntaxFeature(Bigint, p.source.rangeOfNumber(expr.loc));
        p.recordUsage(p.makeBigIntRef());
      }
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
        p.log.addError(p.tracker, e.range, 'Cannot use "new.target" here:');
      }
      break;

    case E_STRING:
      if (e.legacyOctalLoc > 0) {
        if (e.preferTemplate) {
          p.log.addError(p.tracker, p.source.rangeOfLegacyOctalEscape(e.legacyOctalLoc), "Legacy octal escape sequences cannot be used in template literals");
        } else if (p.isStrictMode()) {
          p.markStrictModeFeature(legacyOctalEscape, p.source.rangeOfLegacyOctalEscape(e.legacyOctalLoc), "");
        }
      }

      if (in_.shouldMangleStringsAsProps && p.options.mangleQuoted && !e.preferTemplate) {
        const name = e.value;
        if (p.isMangledProp(name)) {
          lastOut = EXPR_OUT_DEFAULT;
          return new Expr(new ENameOfSymbol(p.symbolForMangledProp(name), e.hasPropertyKeyComment), expr.loc);
        }
      }
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

      // Capture "this" inside arrow functions that will be lowered into normal
      // function expressions for older language environments
      if (p.fnOrArrowDataVisit.isArrow && jsFeatureHas(p.options.unsupportedJSFeatures, Arrow) && p.fnOnlyDataVisit.isThisNested) {
        lastOut = EXPR_OUT_DEFAULT;
        return new Expr(new EIdentifier(p.captureThis()), expr.loc);
      }
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
      expr = visitEIf(p, expr, e, in_);
      break;

    case E_AWAIT:
      return visitEAwait(p, expr, e, in_);

    case E_YIELD:
      if (e.valueOrNil !== null) {
        e.valueOrNil = visitExprImpl(p, e.valueOrNil);
      }

      // "yield* x" turns into "yield* __yieldStar(x)" when lowering async generator functions
      if (e.isStar && jsFeatureHas(p.options.unsupportedJSFeatures, AsyncGenerator) && p.fnOrArrowDataVisit.isGenerator) {
        e.valueOrNil = p.callRuntime(expr.loc, "__yieldStar", [e.valueOrNil]);
      }
      break;

    case E_ARRAY:
      visitEArray(p, expr, e, in_);
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
      let hasSpread = false;

      e.target = visitExprImpl(p, e.target);
      p.warnAboutImportNamespaceCall(e.target, exprKindNew);

      const args = e.args;
      for (let i = 0; i < args.length; i++) {
        const arg = visitExprImpl(p, args[i]);
        if (arg.data.k === E_SPREAD) {
          hasSpread = true;
        }
        args[i] = arg;
      }

      // "new foo(1, ...[2, 3], 4)" => "new foo(1, 2, 3, 4)"
      if (p.options.minifySyntax && hasSpread) {
        e.args = inlineSpreadsOfArrayLiterals(e.args);
      }

      p.maybeMarkKnownGlobalConstructorAsPure(e);
      break;
    }

    case E_ARROW:
      expr = visitEArrow(p, expr, e);
      break;

    case E_FUNCTION: {
      // Check for a propagated name to keep from the parent context
      let nameToKeep = "";
      if (p.nameToKeepIsFor === e) {
        nameToKeep = p.nameToKeep;
      }

      p.visitFn(e.fn, expr.loc, new visitFnOpts(in_.isMethod, e === p.propDerivedCtorValue, in_.isLoweredPrivateMethod));
      const name = e.fn.name;

      // Remove unused function names when minifying
      if (
        p.options.minifySyntax &&
        !p.currentScope.containsDirectEval &&
        name !== null &&
        p.symbols[refInner(name.ref)].useCountEstimate === 0
      ) {
        e.fn.name = null;
      }

      // Optionally preserve the name for functions, but not for methods
      if (p.options.keepNames && (!in_.isMethod || in_.isLoweredPrivateMethod)) {
        if (name !== null) {
          expr = p.keepExprSymbolName(expr, p.symbols[refInner(name.ref)].originalName);
        } else if (nameToKeep !== "") {
          expr = p.keepExprSymbolName(expr, nameToKeep);
        }
      }
      break;
    }

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
      throw new GoPanic("Unexpected expression of type " + goTypeName("js_ast", expr.data));
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
  if (jsFeatureHas(p.options.unsupportedJSFeatures, ImportMeta)) {
    const r = mkRange(expr.loc, e.rangeLen);
    p.markSyntaxFeature(ImportMeta, r);
  } else if (p.options.mode !== ModePassThrough && !formatKeepESMImportExportSyntax(p.options.outputFormat)) {
    const r = mkRange(expr.loc, e.rangeLen);
    let kind = Warning;
    if (p.suppressWarningsAboutWeirdCode || p.fnOrArrowDataVisit.tryBodyCount > 0) {
      kind = Debug;
    }
    p.log.addIDWithNotes(
      MsgID_JS_EmptyImportMeta,
      kind,
      p.tracker,
      r,
      '"import.meta" is not available with the ' + goQuote(formatString(p.options.outputFormat)) + " output format and will be empty",
      [new MsgData(null, null, 'You need to set the output format to "esm" for "import.meta" to work correctly.')],
    );
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
  const resultDeclareLoc = found.declareLoc;
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
    p.log.addID(MsgID_JS_ClassNameWillThrow, Warning, p.tracker, rangeOfIdentifier(p.source, expr.loc), "Accessing class " + goQuote(name) + " before initialization will throw");
    const value = p.callRuntime(expr.loc, "__earlyAccess", [new Expr(new EString(name), expr.loc)]);
    lastOut = EXPR_OUT_DEFAULT;
    return value;
  }

  // Handle assigning to a constant
  if (in_.assignTarget !== AssignTargetNone) {
    switch (p.symbols[refInner(resultRef)].kind) {
      case SymbolConst: {
        const r = rangeOfIdentifier(p.source, expr.loc);
        const notes = [p.tracker.msgData(rangeOfIdentifier(p.source, resultDeclareLoc), "The symbol " + goQuote(name) + " was declared a constant here:")];

        // Make this an error when bundling because we may need to convert this
        // "const" into a "var" during bundling. Also make this an error when
        // the constant is inlined because we will otherwise generate code with
        // a syntax error.
        if (
          (p.constValues != null && p.constValues.has(resultRef)) ||
          p.options.mode === ModeBundle ||
          (p.currentScope.parent === null && p.willWrapModuleInTryCatchForUsing)
        ) {
          p.log.addErrorWithNotes(p.tracker, r, "Cannot assign to " + goQuote(name) + " because it is a constant", notes);
        } else {
          p.log.addIDWithNotes(MsgID_JS_AssignToConstant, Warning, p.tracker, r, "This assignment will throw because " + goQuote(name) + " is a constant", notes);
        }
        break;
      }

      case SymbolInjected: {
        const where = p.injectedSymbolSources != null ? p.injectedSymbolSources.get(resultRef) : undefined;
        if (where !== undefined) {
          const r = rangeOfIdentifier(p.source, expr.loc);
          const tracker = new LineColumnTracker(where.source);
          p.log.addErrorWithNotes(p.tracker, r, "Cannot assign to " + goQuote(name) + " because it's an import from an injected file", [
            tracker.msgData(
              rangeOfIdentifier(where.source, where.loc),
              "The symbol " + goQuote(name) + " was exported from " + goQuote(where.source.prettyPaths.select(p.options.logPathStyle)) + " here:",
            ),
          ]);
        }
        break;
      }
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
  let hasSpread = false;
  for (let $i47 = 0, $a47 = e.properties; $i47 < $a47.length; $i47++) {
    const property = $a47[$i47];
    if (property.kind === PropertySpread) {
      hasSpread = true;
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

  // "{a, ...{b, c}, d}" => "{a, b, c, d}"
  if (p.options.minifySyntax && hasSpread) {
    e.properties = mangleObjectSpread(e.properties);
  }

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
              const r = rangeOfIdentifier(p.source, property.loc);
              const msg = new Msg(
                [new MsgData(null, null, 'Using "key" as a shorthand for "key={true}" is not allowed when using React' + "'" + 's "automatic" JSX transform.')],
                "",
                p.tracker.msgData(r, 'Please provide an explicit value for "key":'),
                LogError,
              );
              msg.data.location.suggestion = "key={true}";
              p.log.addMsg(msg);
            } else {
              keyProperty = property.valueOrNil;
              hasKey = true;
            }
            continue;
          }

          case "__source":
          case "__self":
            const r = rangeOfIdentifier(p.source, property.loc);
            p.log.addErrorWithNotes(p.tracker, r, 'Duplicate "' + propName + '" prop found:', [
              new MsgData(
                null,
                null,
                'Both "__source" and "__self" are set automatically by esbuild when using React' + "'" + 's "automatic" JSX transform. ' +
                  "This duplicate prop may have come from a plugin.",
              ),
            ]);
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
    p.log.addError(p.tracker, p.source.rangeOfLegacyOctalEscape(e.legacyOctalLoc), "Legacy octal escape sequences cannot be used in template literals");
  }

  let tagThisFunc = null;
  let tagWrapFunc = null;

  if (e.tagOrNil !== null) {
    // Capture the value for "this" if the tag is a lowered optional chain.
    // We'll need to manually apply this value later to preserve semantics.
    let tagIsLoweredOptionalChain = false;
    if (jsFeatureHas(p.options.unsupportedJSFeatures, OptionalChain)) {
      const target = e.tagOrNil.data;
      switch (target.k) {
        case E_DOT:
          tagIsLoweredOptionalChain = target.optionalChain !== OptionalChainNone;
          break;
        case E_INDEX:
          tagIsLoweredOptionalChain = target.optionalChain !== OptionalChainNone;
          break;
      }
    }

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
  if (p.shouldFoldTypeScriptConstantExpressions || p.options.minifySyntax) {
    expr = inlinePrimitivesIntoTemplate(expr.loc, e);
  }

  let shouldLowerTemplateLiteral = jsFeatureHas(p.options.unsupportedJSFeatures, TemplateLiteral);

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
    } else if (jsFeatureHas(p.options.unsupportedJSFeatures, Arrow)) {
      e.target = new Expr(new EFunction(), e.target.loc);
    } else {
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

  // "a['b']" => "a.b"
  if (p.options.minifySyntax) {
    const str = e.index.data;
    if (str.k === E_STRING && isIdentifierUTF16(str.value)) {
      const dot = p.dotOrMangledPropParse(e.target, str.value, e.index.loc, e.optionalChain, wasOriginallyIndex);
      if (isCallTarget) {
        p.callTarget = dot;
      }
      if (isTemplateTag) {
        p.templateTag = dot;
      }
      if (isDeleteTarget) {
        p.deleteTarget = dot;
      }
      return visitExprInOutImpl(p, new Expr(dot, expr.loc), in_);
    }
  }

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
      const r = new ByteRange(e.index.loc, utf8Len(name));
      p.log.addError(p.tracker, r, "Private name " + goQuote(name) + " must be declared in an enclosing class");
    } else {
      let r = RANGE_ZERO;
      let text = "";
      if (in_.assignTarget !== AssignTargetNone && (kind === SymbolPrivateMethod || kind === SymbolPrivateStaticMethod)) {
        r = new ByteRange(e.index.loc, utf8Len(name));
        text = "Writing to read-only method " + goQuote(name) + " will throw";
      } else if (in_.assignTarget !== AssignTargetNone && (kind === SymbolPrivateGet || kind === SymbolPrivateStaticGet)) {
        r = new ByteRange(e.index.loc, utf8Len(name));
        text = "Writing to getter-only property " + goQuote(name) + " will throw";
      } else if (in_.assignTarget !== AssignTargetReplace && (kind === SymbolPrivateSet || kind === SymbolPrivateStaticSet)) {
        r = new ByteRange(e.index.loc, utf8Len(name));
        text = "Reading from setter-only property " + goQuote(name) + " will throw";
      }
      if (text !== "") {
        let kind2 = Warning;
        if (p.suppressWarningsAboutWeirdCode) {
          kind2 = Debug;
        }
        p.log.addID(MsgID_JS_PrivateNameWillThrow, kind2, p.tracker, r, text);
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
      const preferQuotedKey = !p.options.minifySyntax;
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

  // Create an error for assigning to an import namespace when bundling. Even
  // though this is a run-time error, we make it a compile-time error when
  // bundling because scope hoisting means these will no longer be run-time
  // errors.
  if (p.options.mode === ModeBundle && (in_.assignTarget !== AssignTargetNone || isDeleteTarget)) {
    const id = e.target.data;
    if (id.k === E_IDENTIFIER && p.symbols[refInner(id.ref)].kind === SymbolImport) {
      const r = rangeOfIdentifier(p.source, e.target.loc);
      p.log.addErrorWithNotes(p.tracker, r, "Cannot assign to property on import " + goQuote(p.symbols[refInner(id.ref)].originalName), [
        new MsgData(
          null,
          null,
          "Imports are immutable in JavaScript. " +
            "To modify the value of this import, you must export a setter function in the " +
            "imported file and then import and call that function here instead.",
        ),
      ]);
    }
  }

  if (p.options.minifySyntax) {
    const index = e.index.data;
    switch (index.k) {
      case E_STRING:
        // "a['x' + 'y']" => "a.xy" (this is done late to allow for constant folding)
        if (isIdentifierUTF16(index.value)) {
          lastOut = newOut;
          return new Expr(
            new EDot(e.target, index.value, e.index.loc, e.optionalChain, e.canBeRemovedIfUnused, e.callCanBeUnwrappedIfUnused),
            expr.loc,
          );
        }

        // "a['123']" => "a[123]" (this is done late to allow "'123'" to be mangled)
        {
          const $d = stringToEquivalentNumberValue(index.value);
          if ($d[1]) {
            e.index = new Expr(new ENumber($d[0]), e.index.loc);
          }
        }
        break;

      case E_NUMBER: {
        // "'abc'[1]" => "'b'"
        const target = e.target.data;
        if (target.k === E_STRING) {
          const intValue = Math.floor(index.value);
          if (index.value === intValue && intValue >= 0 && intValue < target.value.length) {
            lastOut = newOut;
            return new Expr(new EString(target.value[intValue]), expr.loc);
          }
        }
        break;
      }
    }
  }

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
        const r = rangeOfIdentifier(p.source, superPropLoc);
        const text = 'Attempting to delete a property of "super" will throw a ReferenceError';
        p.log.addID(MsgID_JS_DeleteSuperProperty, kind, p.tracker, r, text);
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
          if (p.options.minifySyntax) {
            e.value = p.astHelpers.simplifyBooleanExpr(e.value);
          }

          const $d135 = toBooleanWithSideEffects(e.value.data);
          const boolean = $d135[0], sideEffects = $d135[1], ok = $d135[2];
          if (ok && sideEffects === NoSideEffects) {
            lastOut = EXPR_OUT_DEFAULT;
            return new Expr(new EBoolean(!boolean), expr.loc);
          }

          if (p.options.minifySyntax) {
            const $d = maybeSimplifyNot(e.value);
            if ($d[1]) {
              lastOut = EXPR_OUT_DEFAULT;
              return $d[0];
            }
          }
          break;
        }

        case UnOpVoid: {
          let shouldRemove;
          if (p.options.minifySyntax) {
            shouldRemove = p.astHelpers.exprCanBeRemovedIfUnused(e.value);
          } else {
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
            shouldRemove = isUnsightlyPrimitive(e.value.data);
          }
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
          if (p.shouldFoldTypeScriptConstantExpressions || p.options.minifySyntax) {
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

  // "-(a, b)" => "a, -b"
  if (p.options.minifySyntax && e.op !== UnOpDelete && e.op !== UnOpTypeof) {
    const comma = e.value.data;
    if (comma.k === E_BINARY && comma.op === BinOpComma) {
      lastOut = EXPR_OUT_DEFAULT;
      return joinWithComma(comma.left, new Expr(new EUnary(comma.right, e.op), comma.right.loc));
    }
  }

  lastOut = EXPR_OUT_DEFAULT;
  return expr;
}

function visitEIf(p, expr, e, in_) {
  e.test = visitExprImpl(p, e.test);

  if (p.options.minifySyntax) {
    e.test = p.astHelpers.simplifyBooleanExpr(e.test);
  }

  // Propagate these flags into the branches
  const childIn = inForMangleStrings(in_.shouldMangleStringsAsProps);

  // Fold constants
  const $d140 = toBooleanWithSideEffects(e.test.data);
  const boolean = $d140[0], sideEffects = $d140[1], ok = $d140[2];
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

      if (p.options.minifySyntax) {
        // "(a, true) ? b : c" => "a, b"
        if (sideEffects === CouldHaveSideEffects) {
          return joinWithComma(p.astHelpers.simplifyUnusedExpr(e.test, p.options.unsupportedJSFeatures), e.yes);
        }

        return e.yes;
      }
    } else {
      // "false ? dead : live"
      const old = p.isControlFlowDead;
      p.isControlFlowDead = true;
      e.yes = visitExprInOutImpl(p, e.yes, childIn);
      p.isControlFlowDead = old;
      e.no = visitExprInOutImpl(p, e.no, childIn);

      if (p.options.minifySyntax) {
        // "(a, false) ? b : c" => "a, c"
        if (sideEffects === CouldHaveSideEffects) {
          return joinWithComma(p.astHelpers.simplifyUnusedExpr(e.test, p.options.unsupportedJSFeatures), e.no);
        }

        return e.no;
      }
    }
  }

  if (p.options.minifySyntax) {
    return p.astHelpers.mangleIfExpr(expr.loc, e, p.options.unsupportedJSFeatures);
  }

  return expr;
}

// Sets lastOut
function visitEAwait(p, expr, e, in_) {
  // Silently remove unsupported top-level "await" in dead code branches
  if (p.fnOrArrowDataVisit.isOutsideFnOrArrow) {
    if (
      p.isControlFlowDead &&
      (jsFeatureHas(p.options.unsupportedJSFeatures, TopLevelAwait) || !formatKeepESMImportExportSyntax(p.options.outputFormat))
    ) {
      return visitExprInOutImpl(p, e.value, in_);
    } else {
      const r = mkRange(expr.loc, 5);
      p.liveTopLevelAwaitKeyword = r;
      p.markSyntaxFeature(TopLevelAwait, r);
    }
  }

  p.awaitTarget = e.value.data;
  e.value = visitExprImpl(p, e.value);

  // "await" expressions turn into "yield" expressions when lowering
  const value = p.maybeLowerAwait(expr.loc, e);
  lastOut = EXPR_OUT_DEFAULT;
  return value;
}

function visitEArray(p, expr, e, in_) {
  if (in_.assignTarget !== AssignTargetNone) {
    if (e.commaAfterSpread !== 0) {
      p.log.addError(p.tracker, mkRange(e.commaAfterSpread, 1), 'Unexpected "," after rest pattern');
    }
    p.markSyntaxFeature(Destructuring, mkRange(expr.loc, 1));
  }
  let hasSpread = false;
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
        hasSpread = true;
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

  // "[1, ...[2, 3], 4]" => "[1, 2, 3, 4]"
  if (p.options.minifySyntax && hasSpread && in_.assignTarget === AssignTargetNone) {
    e.items = inlineSpreadsOfArrayLiterals(e.items);
  }
}

function visitEObject(p, expr, e, in_) {
  if (in_.assignTarget !== AssignTargetNone) {
    if (e.commaAfterSpread !== 0) {
      p.log.addError(p.tracker, mkRange(e.commaAfterSpread, 1), 'Unexpected "," after rest pattern');
    }
    p.markSyntaxFeature(Destructuring, mkRange(expr.loc, 1));
  }

  let hasSpread = false;
  let protoRange = RANGE_ZERO;
  let innerClassNameRef = InvalidRef;
  const minifySyntax = p.options.minifySyntax;

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
            p.log.addErrorWithNotes(p.tracker, r, 'Cannot specify the "__proto__" property more than once per object', [
              p.tracker.msgData(protoRange, 'The earlier "__proto__" property is here:'),
            ]);
          } else {
            protoRange = r;
          }
        }
      }

      // "{['x']: y}" => "{x: y}"
      if (minifySyntax && (property.flags & PropertyIsComputed) !== 0) {
        const inlined = key.data;
        if (inlined.k === E_INLINED_ENUM) {
          switch (inlined.value.data.k) {
            case E_STRING:
            case E_NUMBER:
              // ("key" and "property.Key" have the same loc here)
              key = new Expr(inlined.value.data, key.loc);
              property.key = key;
              break;
          }
        }
        const k = key.data;
        switch (k.k) {
          case E_NUMBER:
          case E_NAME_OF_SYMBOL:
            property.flags &= ~PropertyIsComputed;
            break;
          case E_STRING:
            if (k.value !== "__proto__") {
              property.flags &= ~PropertyIsComputed;
            }
            break;
        }
      }
    } else {
      hasSpread = true;
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

      // If this is an async method and async methods are unsupported,
      // generate a temporary variable in case this async method contains a
      // "super" property reference. If that happens, the "super" expression
      // must be lowered which will need a reference to this object literal.
      if (property.kind === PropertyMethod && jsFeatureHas(p.options.unsupportedJSFeatures, AsyncAwait)) {
        const fn = property.valueOrNil.data;
        if (fn.k === E_FUNCTION && fn.fn.isAsync) {
          if (innerClassNameRef === InvalidRef) {
            innerClassNameRef = p.generateTempRef(tempRefNeedsDeclareMayBeCapturedInsideLoop, "");
          }
          p.fnOnlyDataVisit.isInStaticClassContext = true;
          // (Go stores "&innerClassNameRef"; the local is not changed afterwards)
          p.fnOnlyDataVisit.innerClassNameRef = innerClassNameRef;
        }
      }

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

    // "{ '123': 4 }" => "{ 123: 4 }" (this is done late to allow "'123'" to be mangled)
    if (minifySyntax) {
      const str = property.key !== null ? property.key.data : null;
      if (str !== null && str.k === E_STRING) {
        const $d = stringToEquivalentNumberValue(str.value);
        if ($d[1] && $d[0] >= 0) {
          property.key = new Expr(new ENumber($d[0]), property.key.loc);
        }
      }
    }
  }

  // Check for and warn about duplicate keys in object literals
  if (!p.suppressWarningsAboutWeirdCode) {
    p.warnAboutDuplicateProperties(e.properties, duplicatePropertiesInObject);
  }

  if (in_.assignTarget === AssignTargetNone) {
    // "{a, ...{b, c}, d}" => "{a, b, c, d}"
    if (minifySyntax && hasSpread) {
      e.properties = mangleObjectSpread(e.properties);
    }

    // Object expressions represent both object literals and binding patterns.
    // Only lower object spread if we're an object literal, not a binding pattern.
    let value = p.lowerObjectSpread(expr.loc, e);

    // If we generated and used the temporary variable for a lowered "super"
    // property reference inside a lowered "async" method, then initialize
    // the temporary with this object literal.
    if (innerClassNameRef !== InvalidRef && p.symbols[refInner(innerClassNameRef)].useCountEstimate > 0) {
      p.recordUsage(innerClassNameRef);
      value = assign(new Expr(new EIdentifier(innerClassNameRef), expr.loc), value);
    }

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
    let why = "the second argument was not an object literal";
    let whyLoc = e.optionsOrNil.loc;

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
                      why = "the value for the property " + goQuote(key.value) + " was not a string literal";
                      whyLoc = p2.valueOrNil.loc;
                    }
                  } else {
                    why = "this property was not a string literal";
                    whyLoc = p2.key.loc;
                  }
                } else {
                  why = "this property was invalid";
                  whyLoc = p2.key.loc;
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
              whyLoc = prop.valueOrNil.loc;
            }
          } else {
            why = 'this property was not called "assert" or "with"';
            whyLoc = prop.key.loc;
          }
        } else {
          why = "this property was invalid";
          whyLoc = prop.key.loc;
        }
      } else {
        why = 'the second argument was not an object literal with a single property called "assert" or "with"';
        whyLoc = e.optionsOrNil.loc;
      }
    }

    // Handle the case that isn't just an import assertion or attribute clause
    if (why !== "") {
      // Only warn when bundling
      if (p.options.mode === ModeBundle) {
        const text = 'This "import()" was not recognized because ' + why;
        let kind = Warning;
        if (p.suppressWarningsAboutWeirdCode) {
          kind = Debug;
        }
        p.log.addID(MsgID_JS_UnsupportedDynamicImport, kind, p.tracker, mkRange(whyLoc, 0), text);
      }

      // If import assertions and/attributes are both not supported in the
      // target platform, then "import()" cannot accept a second argument
      // and keeping them would be a syntax error, so we need to get rid of
      // them. We can't just not print them because they may have important
      // side effects. Attempt to discard them without changing side effects
      // and generate an error if that isn't possible.
      if (
        jsFeatureHas(p.options.unsupportedJSFeatures, ImportAssertions) &&
        jsFeatureHas(p.options.unsupportedJSFeatures, ImportAttributes)
      ) {
        if (p.astHelpers.exprCanBeRemovedIfUnused(e.optionsOrNil)) {
          e.optionsOrNil = null;
        } else {
          p.markSyntaxFeature(ImportAttributes, mkRange(e.optionsOrNil.loc, 0));
        }
      }

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

    // Handle glob patterns
    if (p.options.mode === ModeBundle) {
      const value = p.handleGlobPattern(arg, ImportDynamic, e.phase, "globImport", assertOrWith);
      if (value !== null) {
        return value;
      }
    }

    // Use a debug log so people can see this if they want to
    {
      const r = rangeOfIdentifier(p.source, expr.loc);
      p.log.addID(MsgID_JS_UnsupportedDynamicImport, Debug, p.tracker, r, 'This "import" expression will not be bundled because the argument is not a string literal');
    }

    // We need to convert this into a call to "require()" if ES6 syntax is
    // not supported in the current output format. The full conversion:
    //
    //   Before:
    //     import(foo)
    //
    //   After:
    //     Promise.resolve().then(() => __toESM(require(foo)))
    //
    // This is normally done by the printer since we don't know during the
    // parsing stage whether this module is external or not. However, it's
    // guaranteed to be external if the argument isn't a string. We handle
    // this case here instead of in the printer because both the printer
    // and the linker currently need an import record to handle this case
    // correctly, and you need a string literal to get an import record.
    if (jsFeatureHas(p.options.unsupportedJSFeatures, DynamicImport)) {
      let then;
      const value = p.callRuntime(arg.loc, "__toESM", [
        new Expr(new ECall(p.valueToSubstituteForRequire(expr.loc), [arg], e.closeParenLoc), expr.loc),
      ]);
      const body = new FnBody(new SBlock([new Stmt(new SReturn(value), expr.loc)]), expr.loc);
      if (jsFeatureHas(p.options.unsupportedJSFeatures, Arrow)) {
        then = new Expr(new EFunction(new Fn(null, [], body)), expr.loc);
      } else {
        then = new Expr(new EArrow([], body, false, false, true /* preferExpr */), expr.loc);
      }
      return new Expr(
        new ECall(
          new Expr(
            new EDot(
              new Expr(
                new ECall(
                  new Expr(new EDot(new Expr(new EIdentifier(p.makePromiseRef()), expr.loc), "resolve", expr.loc), expr.loc),
                  [],
                  0,
                  OptionalChainNone,
                  TargetWasOriginallyPropertyAccess,
                ),
                expr.loc,
              ),
              "then",
              expr.loc,
            ),
            expr.loc,
          ),
          [then],
          0,
          OptionalChainNone,
          TargetWasOriginallyPropertyAccess,
        ),
        expr.loc,
      );
    }

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

  // Our hack for reading Yarn PnP files is implemented here:
  if (p.options.decodeHydrateRuntimeStateYarnPnP) {
    const id = e.target.data;
    if (id.k === E_IDENTIFIER && p.symbols[refInner(id.ref)].originalName === "hydrateRuntimeState" && e.args.length >= 1) {
      const arg = e.args[0].data;
      switch (arg.k) {
        case E_OBJECT:
          // "hydrateRuntimeState(<object literal>)"
          if (isValidJSON(e.args[0])) {
            p.manifestForYarnPnP = e.args[0];
          }
          break;

        case E_CALL:
          // "hydrateRuntimeState(JSON.parse(<something>))"
          if (arg.args.length === 1) {
            const dot = arg.target.data;
            if (dot.k === E_DOT && dot.name === "parse") {
              const id2 = dot.target.data;
              if (id2.k === E_IDENTIFIER) {
                const symbol = p.symbols[refInner(id2.ref)];
                if (symbol.kind === SymbolUnbound && symbol.originalName === "JSON") {
                  const arg2 = arg.args[0];
                  const a = arg2.data;
                  switch (a.k) {
                    case E_STRING: {
                      // "hydrateRuntimeState(JSON.parse(<string literal>))"
                      const source = new Source(undefined, "", a.value, p.source.keyPath);
                      const stringInJSTable = generateStringInJSTable(p.source.contents, arg2.loc, source.contents);
                      const log = newStringInJSLog(p.log, p.tracker, stringInJSTable);
                      p.manifestForYarnPnP = parseJSONOrZero(log, source);
                      remapExprLocsInJSON(p.manifestForYarnPnP, stringInJSTable);
                      break;
                    }

                    case E_IDENTIFIER: {
                      // "hydrateRuntimeState(JSON.parse(<identifier>))"
                      const data = p.stringLocalsForYarnPnP.get(a.ref);
                      if (data !== undefined) {
                        const source = new Source(undefined, "", data.value, p.source.keyPath);
                        const stringInJSTable = generateStringInJSTable(p.source.contents, data.loc, source.contents);
                        const log = newStringInJSLog(p.log, p.tracker, stringInJSTable);
                        p.manifestForYarnPnP = parseJSONOrZero(log, source);
                        remapExprLocsInJSON(p.manifestForYarnPnP, stringInJSTable);
                      }
                      break;
                    }
                  }
                }
              }
            }
          }
          break;
      }
    }
  }

  // Stop now if this call must be removed
  if (callMustBeReplacedWithUndefined) {
    p.isControlFlowDead = oldIsControlFlowDead;
    lastOut = EXPR_OUT_DEFAULT;
    return new Expr(EUndefinedShared, expr.loc);
  }

  if (p.options.minifySyntax) {
    // "foo(1, ...[2, 3], 4)" => "foo(1, 2, 3, 4)"
    if (hasSpread) {
      e.args = inlineSpreadsOfArrayLiterals(e.args);
    }

    // "(() => x)()" => "x"
    const $d = p.maybeInlineIIFE(expr.loc, e);
    if ($d[1]) {
      lastOut = EXPR_OUT_DEFAULT;
      return $d[0];
    }
  }

  {
    const t = target.data;
    switch (t.k) {
      case E_IMPORT_IDENTIFIER:
        // If this function is inlined, allow it to be tree-shaken
        if (p.options.minifySyntax && !p.isControlFlowDead) {
          p.convertSymbolUseToCall(t.ref, e.args.length === 1 && !hasSpread);
        }
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

            // Pessimistically assume that if this looks like a CommonJS module
            // (e.g. no "export" keywords), a direct call to "eval" means that
            // code could potentially access "module" or "exports".
            if (p.options.mode === ModeBundle && !p.isFileConsideredToHaveESMExports) {
              p.recordUsage(p.moduleRef);
              p.recordUsage(p.exportsRef);
            }

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
            {
              const text = "Using direct eval with a bundler is not recommended and may cause problems";
              let kind = Debug;
              if (p.options.mode === ModeBundle && p.isFileConsideredESM && !p.suppressWarningsAboutWeirdCode) {
                kind = Warning;
              }
              p.log.addIDWithNotes(MsgID_JS_DirectEval, kind, p.tracker, rangeOfIdentifier(p.source, e.target.loc), text, [
                new MsgData(null, null, "You can read more about direct eval and bundling here: https://esbuild.github.io/link/direct-eval"),
              ]);
            }
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

            // Optimize references to global constructors
            if (p.options.minifySyntax && t.canBeRemovedIfUnused) {
              // Note: We construct expressions by assigning to "expr.Data" so
              // that the source map position for the constructor is preserved
              switch (symbol.originalName) {
                case "Boolean":
                  if (e.args.length === 0) {
                    lastOut = EXPR_OUT_DEFAULT;
                    return new Expr(new EBoolean(false), expr.loc);
                  } else {
                    expr = new Expr(new EUnary(p.astHelpers.simplifyBooleanExpr(e.args[0]), UnOpNot), expr.loc);
                    lastOut = EXPR_OUT_DEFAULT;
                    return not(expr);
                  }

                case "Number":
                  if (e.args.length === 0) {
                    lastOut = EXPR_OUT_DEFAULT;
                    return new Expr(new ENumber(0), expr.loc);
                  } else {
                    const arg = e.args[0];

                    switch (knownPrimitiveType(arg.data)) {
                      case PrimitiveNumber:
                        lastOut = EXPR_OUT_DEFAULT;
                        return arg;

                      case PrimitiveUndefined: // NaN
                      case PrimitiveNull: // 0
                      case PrimitiveBoolean: // 0 or 1
                      case PrimitiveString: {
                        // StringToNumber
                        const $d = toNumberWithoutSideEffects(arg.data);
                        if ($d[1]) {
                          expr = new Expr(new ENumber($d[0]), expr.loc);
                        } else {
                          expr = new Expr(new EUnary(arg, UnOpPos), expr.loc);
                        }
                        lastOut = EXPR_OUT_DEFAULT;
                        return expr;
                      }
                    }
                  }
                  break;

                case "String":
                  if (e.args.length === 0) {
                    lastOut = EXPR_OUT_DEFAULT;
                    return new Expr(new EString(""), expr.loc);
                  } else {
                    const arg = e.args[0];

                    switch (knownPrimitiveType(arg.data)) {
                      case PrimitiveString:
                        lastOut = EXPR_OUT_DEFAULT;
                        return arg;
                    }
                  }
                  break;

                case "BigInt":
                  if (e.args.length === 1) {
                    const arg = e.args[0];

                    switch (knownPrimitiveType(arg.data)) {
                      case PrimitiveBigInt:
                        lastOut = EXPR_OUT_DEFAULT;
                        return arg;
                    }
                  }
                  break;
              }
            }
          }
        }

        // Copy the call side effect flag over if this is a known target
        if (t.callCanBeUnwrappedIfUnused) {
          e.canBeUnwrappedIfUnused = true;
        }

        // If this function is inlined, allow it to be tree-shaken
        if (p.options.minifySyntax && !p.isControlFlowDead) {
          p.convertSymbolUseToCall(t.ref, e.args.length === 1 && !hasSpread);
        }
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

        if (p.options.minifySyntax) {
          const value = foldKnownMethodCall(p, expr, e, t);
          if (value !== null) {
            lastOut = EXPR_OUT_DEFAULT;
            return value;
          }
        }

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
                const r = rangeOfIdentifier(p.source, e.target.loc);
                p.log.addID(MsgID_JS_UnsupportedRequireCall, Warning, p.tracker, r, 'Converting "require" to "esm" is currently not supported');
              }

              // Create a new expression to represent the operation
              return new Expr(new ERequireString(importRecordIndex, e.closeParenLoc), expr.loc);
            }

            // Handle glob patterns
            if (p.options.mode === ModeBundle) {
              const value = p.handleGlobPattern(arg, ImportRequire, EvaluationPhase, "globRequire", null);
              if (value !== null) {
                return value;
              }
            }

            // Use a debug log so people can see this if they want to
            {
              const r = rangeOfIdentifier(p.source, e.target.loc);
              p.log.addID(MsgID_JS_UnsupportedRequireCall, Debug, p.tracker, r, 'This call to "require" will not be bundled because the argument is not a string literal');
            }

            // Otherwise just return a clone of the "require()" call
            return new Expr(new ECall(p.valueToSubstituteForRequire(e.target.loc), [arg], e.closeParenLoc), expr.loc);
          });
          lastOut = EXPR_OUT_DEFAULT;
          return value;
        } else {
          // Use a debug log so people can see this if they want to
          const r = rangeOfIdentifier(p.source, e.target.loc);
          p.log.addIDWithNotes(
            MsgID_JS_UnsupportedRequireCall,
            Debug,
            p.tracker,
            r,
            'This call to "require" will not be bundled because it has ' + e.args.length + " arguments",
            [new MsgData(null, null, 'To be bundled by esbuild, a "require" call must have exactly 1 argument.')],
          );
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

// The "if p.options.minifySyntax { switch t.Name { ... } }" block of the
// ECall case for an EDot target "t". Returns the folded Expr or null.
function foldKnownMethodCall(p, expr, e, t) {
  switch (t.name) {
    case "charCodeAt": {
      // Recognize "'string'.charCodeAt()" calls
      const str = t.target.data;
      if (str.k === E_STRING && e.args.length <= 1) {
        let index = 0;
        let hasIndex = false;
        if (e.args.length === 0) {
          hasIndex = true;
        } else {
          const num = e.args[0].data;
          if (num.k === E_NUMBER && num.value === Math.trunc(num.value) && Math.abs(num.value) <= 0x7fffffff) {
            index = num.value | 0;
            hasIndex = true;
          }
        }
        if (hasIndex) {
          if (index >= 0 && index < str.value.length) {
            return new Expr(new ENumber(str.value.charCodeAt(index)), expr.loc);
          } else {
            return new Expr(new ENumber(NaN), expr.loc);
          }
        }
      }
      break;
    }

    case "fromCharCode": {
      // Recognize "String.fromCharCode()" calls
      const id = t.target.data;
      if (id.k === E_IDENTIFIER) {
        const symbol = p.symbols[refInner(id.ref)];
        if (symbol.kind === SymbolUnbound && symbol.originalName === "String") {
          const args = e.args;
          let charCodes = "";
          let i = 0;
          for (; i < args.length; i++) {
            const $d = toNumberWithoutSideEffects(args[i].data);
            if (!$d[1]) {
              break;
            }
            charCodes += String.fromCharCode(toInt32($d[0]) & 0xffff);
          }
          if (i === args.length) {
            return new Expr(new EString(charCodes), expr.loc);
          }
        }
      }
      break;
    }

    case "toString": {
      const target = t.target.data;
      switch (target.k) {
        case E_NUMBER: {
          let radix = 0;
          if (e.args.length === 0) {
            radix = 10;
          } else if (e.args.length === 1) {
            const num = e.args[0].data;
            if (num.k === E_NUMBER && num.value === Math.trunc(num.value) && num.value >= 2 && num.value <= 36) {
              radix = num.value;
            }
          }
          if (radix !== 0) {
            const $d = tryToStringOnNumberSafely(target.value, radix);
            if ($d[1]) {
              return new Expr(new EString($d[0]), expr.loc);
            }
          }
          break;
        }

        case E_REG_EXP:
          if (e.args.length === 0) {
            return new Expr(new EString(target.value), expr.loc);
          }
          break;

        case E_BOOLEAN:
          if (e.args.length === 0) {
            if (target.value) {
              return new Expr(new EString("true"), expr.loc);
            } else {
              return new Expr(new EString("false"), expr.loc);
            }
          }
          break;

        case E_STRING:
          if (e.args.length === 0) {
            return t.target;
          }
          break;
      }
      break;
    }
  }
  return null;
}

function visitEArrow(p, expr, e) {
  // Check for a propagated name to keep from the parent context
  let nameToKeep = "";
  if (p.nameToKeepIsFor === e) {
    nameToKeep = p.nameToKeep;
  }

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

  const asyncArrowNeedsToBeLowered = e.isAsync && jsFeatureHas(p.options.unsupportedJSFeatures, AsyncAwait);
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
    oldFnOrArrowData.shouldLowerSuperPropertyAccess || asyncArrowNeedsToBeLowered, // shouldLowerSuperPropertyAccess
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
  // Go: p.lowerFunction(&e.IsAsync, nil, &e.Args, e.Body.Loc, &e.Body.Block, &e.PreferExpr, &e.HasRestArg, true)
  p.lowerFunction(e, e.body.loc, e.body.block, true /* isArrow */);
  p.popScope();

  if (p.options.minifySyntax && e.body.block.stmts.length === 1) {
    const s = e.body.block.stmts[0].data;
    if (s.k === S_RETURN && s.valueOrNil !== null) {
      // "() => { return x }" => "() => x"
      e.preferExpr = true;
    }
  }

  p.fnOnlyDataVisit.isInsideAsyncArrowFn = oldInsideAsyncArrowFn;
  p.fnOrArrowDataVisit = oldFnOrArrowData;

  // Convert arrow functions to function expressions when lowering
  if (jsFeatureHas(p.options.unsupportedJSFeatures, Arrow)) {
    expr = new Expr(
      new EFunction(new Fn(null, e.args, e.body, InvalidRef, 0, e.isAsync, false, e.hasRestArg)),
      expr.loc,
    );
  }

  // Optionally preserve the name
  if (p.options.keepNames && nameToKeep !== "") {
    expr = p.keepExprSymbolName(expr, nameToKeep);
  }

  return expr;
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
        const r = new ByteRange(e.left.loc, utf8Len(name));
        p.log.addError(p.tracker, r, "Private name " + goQuote(name) + " must be declared in an enclosing class");
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

    const minifySyntax = p.options.minifySyntax;

    // Always put constants consistently on the same side for equality
    // comparisons to help improve compression. In theory, dictionary-based
    // compression methods may already have a dictionary entry for code that
    // is similar to previous code. Note that we can only reorder expressions
    // that do not have any side effects.
    //
    // Constants are currently ordered on the right instead of the left because
    // it results in slightly smalller gzip size on our primary benchmark
    // (although slightly larger uncompressed size). The size difference is
    // less than 0.1% so it really isn't that important an optimization.
    if (minifySyntax) {
      switch (e.op) {
        case BinOpLooseEq:
        case BinOpLooseNe:
        case BinOpStrictEq:
        case BinOpStrictNe:
          // "1 === x" => "x === 1"
          if (isPrimitiveLiteral(e.left.data) && !isPrimitiveLiteral(e.right.data)) {
            const tmp = e.left;
            e.left = e.right;
            e.right = tmp;
          }
          break;
      }
    }

    if (p.shouldFoldTypeScriptConstantExpressions || (minifySyntax && shouldFoldBinaryOperatorWhenMinifying(e))) {
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
        if (minifySyntax) {
          e.left = p.astHelpers.simplifyUnusedExpr(e.left, p.options.unsupportedJSFeatures);
          if (e.left === null) {
            return e.right;
          }
        }
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

        if (minifySyntax) {
          // "x == void 0" => "x == null"
          if (e.left.data.k === E_UNDEFINED) {
            e.left = new Expr(ENullShared, e.left.loc);
          } else if (e.right.data.k === E_UNDEFINED) {
            e.right = new Expr(ENullShared, e.right.loc);
          }

          const $d = maybeSimplifyEqualityComparison(v.loc, e, p.options.unsupportedJSFeatures);
          if ($d[1]) {
            return $d[0];
          }
        }
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

        if (minifySyntax) {
          // "typeof x === 'undefined'" => "typeof x == 'undefined'"
          if (canChangeStrictToLoose(e.left, e.right)) {
            e.op = BinOpLooseEq;
          }

          const $d = maybeSimplifyEqualityComparison(v.loc, e, p.options.unsupportedJSFeatures);
          if ($d[1]) {
            return $d[0];
          }
        }
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

        if (minifySyntax) {
          // "x != void 0" => "x != null"
          if (e.left.data.k === E_UNDEFINED) {
            e.left = new Expr(ENullShared, e.left.loc);
          } else if (e.right.data.k === E_UNDEFINED) {
            e.right = new Expr(ENullShared, e.right.loc);
          }

          const $d = maybeSimplifyEqualityComparison(v.loc, e, p.options.unsupportedJSFeatures);
          if ($d[1]) {
            return $d[0];
          }
        }
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

        if (minifySyntax) {
          // "typeof x !== 'undefined'" => "typeof x != 'undefined'"
          if (canChangeStrictToLoose(e.left, e.right)) {
            e.op = BinOpLooseNe;
          }

          const $d = maybeSimplifyEqualityComparison(v.loc, e, p.options.unsupportedJSFeatures);
          if ($d[1]) {
            return $d[0];
          }
        }
        break;
      }

      case BinOpNullishCoalescing: {
        const $d151 = toNullOrUndefinedWithSideEffects(e.left.data);
        const isNullOrUndefined = $d151[0], sideEffects = $d151[1], ok = $d151[2];
        if (ok) {
          // Warn about potential bugs
          if (!isPrimitiveLiteral(e.left.data)) {
            // "return props.flag === flag ?? true" is "return (props.flag === flag) ?? true" not "return props.flag === (flag ?? true)"
            let which;
            let leftIsNullOrUndefined;
            let leftIsReturned;
            if (!isNullOrUndefined) {
              which = "left";
              leftIsNullOrUndefined = "never";
              leftIsReturned = "always";
            } else {
              which = "right";
              leftIsNullOrUndefined = "always";
              leftIsReturned = "never";
            }
            let kind = Warning;
            if (p.suppressWarningsAboutWeirdCode) {
              kind = Debug;
            }
            const rOp = p.source.rangeOfOperatorBefore(e.right.loc, "??");
            const rLeft = mkRange(e.left.loc, p.source.locBeforeWhitespace(rOp.loc) - e.left.loc);
            p.log.addIDWithNotes(MsgID_JS_SuspiciousNullishCoalescing, kind, p.tracker, rOp, 'The "??" operator here will always return the ' + which + " operand", [
              p.tracker.msgData(
                rLeft,
                'The left operand of the "??" operator here will ' +
                  leftIsNullOrUndefined +
                  " be null or undefined, so it will " +
                  leftIsReturned +
                  " be returned. This usually indicates a bug in your code:",
              ),
            ]);
          }

          if (!isNullOrUndefined) {
            return e.left;
          } else if (sideEffects === NoSideEffects) {
            return e.right;
          }
        }

        if (minifySyntax) {
          // "a ?? (b ?? c)" => "a ?? b ?? c"
          const right = e.right.data;
          if (right.k === E_BINARY && right.op === BinOpNullishCoalescing) {
            e.left = joinWithLeftAssociativeOp(BinOpNullishCoalescing, e.left, right.left);
            e.right = right.right;
          }
        }

        if (jsFeatureHas(p.options.unsupportedJSFeatures, NullishCoalescing)) {
          return p.lowerNullishCoalescing(v.loc, e.left, e.right);
        }
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
              let which;
              if (boolean) {
                which = "left";
              } else {
                which = "right";
              }
              let kind = Warning;
              if (p.suppressWarningsAboutWeirdCode) {
                kind = Debug;
              }
              const note = p.tracker.msgData(arrowLoc, "The \"=>\" symbol creates an arrow function expression in JavaScript. Did you mean to use the greater-than-or-equal-to operator \">=\" here instead?");
              note.location.suggestion = ">=";
              const rOp = p.source.rangeOfOperatorBefore(e.right.loc, "||");
              p.log.addIDWithNotes(MsgID_JS_SuspiciousLogicalOperator, kind, p.tracker, rOp, 'The "||" operator here will always return the ' + which + " operand", [note]);
            }
          }

          if (boolean) {
            return e.left;
          } else if (sideEffects === NoSideEffects) {
            return e.right;
          }
        }

        if (minifySyntax) {
          // "a || (b || c)" => "a || b || c"
          const right = e.right.data;
          if (right.k === E_BINARY && right.op === BinOpLogicalOr) {
            e.left = joinWithLeftAssociativeOp(BinOpLogicalOr, e.left, right.left);
            e.right = right.right;
          }

          // "a === null || a === undefined" => "a == null"
          const $d = isBinaryNullAndUndefined(e.left, e.right, BinOpStrictEq);
          if ($d[2]) {
            e.op = BinOpLooseEq;
            e.left = $d[0];
            e.right = $d[1];
          }
        }
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
              let which;
              if (!boolean) {
                which = "left";
              } else {
                which = "right";
              }
              let kind = Warning;
              if (p.suppressWarningsAboutWeirdCode) {
                kind = Debug;
              }
              const note = p.tracker.msgData(arrowLoc, "The \"=>\" symbol creates an arrow function expression in JavaScript. Did you mean to use the greater-than-or-equal-to operator \">=\" here instead?");
              note.location.suggestion = ">=";
              const rOp = p.source.rangeOfOperatorBefore(e.right.loc, "&&");
              p.log.addIDWithNotes(MsgID_JS_SuspiciousLogicalOperator, kind, p.tracker, rOp, 'The "&&" operator here will always return the ' + which + " operand", [note]);
            }
          }

          if (!boolean) {
            return e.left;
          } else if (sideEffects === NoSideEffects) {
            return e.right;
          }
        }

        if (minifySyntax) {
          // "a && (b && c)" => "a && b && c"
          const right = e.right.data;
          if (right.k === E_BINARY && right.op === BinOpLogicalAnd) {
            e.left = joinWithLeftAssociativeOp(BinOpLogicalAnd, e.left, right.left);
            e.right = right.right;
          }

          // "a !== null && a !== undefined" => "a != null"
          const $d = isBinaryNullAndUndefined(e.left, e.right, BinOpStrictNe);
          if ($d[2]) {
            e.op = BinOpLooseNe;
            e.left = $d[0];
            e.right = $d[1];
          }
        }
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
        // Lower the exponentiation operator for browsers that don't support it
        if (jsFeatureHas(p.options.unsupportedJSFeatures, ExponentOperator)) {
          return p.callRuntime(v.loc, "__pow", [e.left, e.right]);
        }
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
              let loc = 0;

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
                    loc = dot.target.loc;
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
                        loc = target2.target.loc;
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
                const $w = p.whyESModule();
                const why = $w[0];
                let notes = $w[1];
                if (why === whyESMTypeModulePackageJSON) {
                  let text = 'Node' + "'" + 's package format requires that CommonJS files in a "type": "module" package use the ".cjs" file extension.';
                  if (p.options.ts.parse) {
                    text += ' If you are using TypeScript, you can use the ".cts" file extension with esbuild instead.';
                  }
                  notes = notes === null ? [new MsgData(null, null, text)] : [...notes, new MsgData(null, null, text)];
                }
                p.log.addIDWithNotes(
                  MsgID_JS_CommonJSVariableInESM,
                  kind,
                  p.tracker,
                  rangeOfIdentifier(p.source, loc),
                  "The CommonJS " + goQuote(name) + " variable is treated as a global variable in an ECMAScript module and may not work as expected",
                  notes,
                );
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
        // Lower the exponentiation operator for browsers that don't support it
        if (jsFeatureHas(p.options.unsupportedJSFeatures, ExponentOperator)) {
          return p.lowerExponentiationAssignmentOperator(v.loc, e);
        }

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

    // "(a, b) + c" => "a, b + c"
    if (minifySyntax && e.op !== BinOpComma) {
      const comma = e.left.data;
      if (comma.k === E_BINARY && comma.op === BinOpComma) {
        return joinWithComma(comma.left, new Expr(new EBinary(comma.right, e.right, e.op), comma.right.loc));
      }
    }

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

  // Returns an Expr or null (Go: js_ast.Expr{})
  handleGlobPattern(expr, kind, phase, prefix, assertOrWith) {
    const p = this;
    const $g = p.globPatternFromExpr(expr);
    const pattern = $g[0], approximateRange = $g[1];
    if (pattern === null) {
      return null;
    }

    let last = new GlobPart();
    const parts = [];

    for (let i = 0; i < pattern.length; i++) {
      const part = pattern[i];
      if (part.isWildcard) {
        if (last.wildcard === GlobNone) {
          if (!last.prefix.endsWith("/")) {
            // "`a${b}c`" => "a*c"
            last.wildcard = GlobAllExceptSlash;
          } else {
            // "`a/${b}c`" => "a/**/*c"
            last.wildcard = GlobAllIncludingSlash;
            parts.push(last);
            last = new GlobPart("/", GlobAllExceptSlash);
          }
        }
      } else if (part.text !== "") {
        if (last.wildcard !== GlobNone) {
          parts.push(last);
          last = new GlobPart();
        }
        last.prefix += part.text;
      }
    }

    parts.push(last);

    // Don't handle this if it's a string constant
    if (parts.length === 1 && parts[0].wildcard === GlobNone) {
      return null;
    }

    // We currently only support relative globs
    {
      const prefix = parts[0].prefix;
      if (!prefix.startsWith("./") && !prefix.startsWith("../")) {
        return null;
      }
    }

    let ref = InvalidRef;

    // Don't generate duplicate glob imports
    outer: for (let j = 0; j < p.globPatternImports.length; j++) {
      const globPattern = p.globPatternImports[j];

      // Check the kind and phase
      if (globPattern.kind !== kind || globPattern.phase !== phase) {
        continue;
      }

      // Check the parts
      if (globPattern.parts.length !== parts.length) {
        continue;
      }
      for (let i = 0; i < parts.length; i++) {
        if (globPattern.parts[i].prefix !== parts[i].prefix || globPattern.parts[i].wildcard !== parts[i].wildcard) {
          continue outer;
        }
      }

      // Check the import assertions/attributes
      if (assertOrWith === null) {
        if (globPattern.assertOrWith !== null) {
          continue;
        }
      } else {
        if (globPattern.assertOrWith === null) {
          continue;
        }
        if (assertOrWith.keyword !== globPattern.assertOrWith.keyword) {
          continue;
        }
        const a = assertOrWith.entries;
        const b = globPattern.assertOrWith.entries;
        if (a.length !== b.length) {
          continue;
        }
        for (let i = 0; i < a.length; i++) {
          const ai = a[i];
          const bi = b[i];
          if (ai.key !== bi.key || ai.value !== bi.value) {
            continue outer;
          }
        }
      }

      // If we get here, then these are the same glob pattern
      ref = globPattern.ref;
      break;
    }

    // If there's no duplicate glob import, then generate a new glob import
    if (ref === InvalidRef && prefix !== "") {
      let sb = prefix;

      for (let j = 0; j < parts.length; j++) {
        const text = parts[j].prefix;
        let gap = true;
        for (let i = 0; i < text.length; ) {
          const c = codePointAt(text, i);
          i += c > 0xffff ? 2 : 1;
          if (!isIdentifierContinue(c)) {
            gap = true;
          } else {
            if (gap) {
              sb += "_";
              gap = false;
            }
            sb += String.fromCodePoint(c);
          }
        }
      }

      const name = sb;
      ref = p.newSymbol(SymbolOther, name);
      p.moduleScope.generated.push(ref);

      p.globPatternImports.push(new globPatternImport(assertOrWith, parts, name, approximateRange, ref, kind, phase));
    }

    p.recordUsage(ref);
    return new Expr(new ECall(new Expr(new EIdentifier(ref), expr.loc), [expr]), expr.loc);
  },

  // Returns [[]globPart | null, Range]
  globPatternFromExpr(expr) {
    const p = this;
    const e = expr.data;
    switch (e.k) {
      case E_STRING:
        return [[new globPart(e.value)], p.source.rangeOfString(expr.loc)];

      case E_TEMPLATE: {
        if (e.tagOrNil !== null) {
          break;
        }

        const pattern = [];
        pattern.push(new globPart(e.headCooked));

        for (let i = 0; i < e.parts.length; i++) {
          const part = e.parts[i];
          const partPattern = p.globPatternFromExpr(part.value)[0];
          if (partPattern !== null) {
            for (let j = 0; j < partPattern.length; j++) pattern.push(partPattern[j]);
          } else {
            pattern.push(new globPart("", true));
          }
          pattern.push(new globPart(part.tailCooked));
        }

        if (e.parts.length === 0) {
          return [pattern, p.source.rangeOfString(expr.loc)];
        }

        const text = p.source.contents;
        let templateRange = mkRange(e.headLoc, 0);

        for (let i = e.parts[e.parts.length - 1].tailLoc; i < text.length; i++) {
          const c = text.charCodeAt(i);
          if (c === 0x60 /* '`' */) {
            templateRange = mkRange(templateRange.loc, i + 1 - templateRange.loc);
            break;
          } else if (c === 0x5c /* '\\' */) {
            i += 1;
          }
        }

        return [pattern, templateRange];
      }

      case E_BINARY: {
        if (e.op !== BinOpAdd) {
          break;
        }

        const $l = p.globPatternFromExpr(e.left);
        const pattern = $l[0];
        let leftRange = $l[1];
        if (pattern === null) {
          break;
        }

        const $r = p.globPatternFromExpr(e.right);
        const rightPattern = $r[0], rightRange = $r[1];
        if (rightPattern !== null) {
          for (let j = 0; j < rightPattern.length; j++) pattern.push(rightPattern[j]);
          leftRange = mkRange(leftRange.loc, rangeEnd(rightRange) - leftRange.loc);
          return [pattern, leftRange];
        }

        pattern.push(new globPart("", true));

        // Try to extend the left range by the right operand in some common cases
        const right = e.right.data;
        switch (right.k) {
          case E_IDENTIFIER:
            leftRange = mkRange(leftRange.loc, rangeEnd(rangeOfIdentifier(p.source, e.right.loc)) - leftRange.loc);
            break;

          case E_CALL:
            if (right.closeParenLoc > 0) {
              leftRange = mkRange(leftRange.loc, right.closeParenLoc + 1 - leftRange.loc);
            }
            break;
        }

        return [pattern, leftRange];
      }
    }

    return GLOB_PATTERN_NONE;
  },

  convertSymbolUseToCall(ref, isSingleNonSpreadArgCall) {
    const p = this;

    // Remove the normal symbol use
    // (JS-only: the map values are updated in place like recordUsage does;
    // no other holder shares them while parsing)
    const symbolUses = p.currentPart.symbolUses;
    const use = symbolUses.get(ref);
    const countEstimate = ((use === undefined ? 0 : use.countEstimate) - 1) >>> 0; // uint32
    if (countEstimate === 0) {
      symbolUses.delete(ref);
    } else if (use === undefined) {
      symbolUses.set(ref, new SymbolUse(countEstimate));
    } else {
      use.countEstimate = countEstimate;
    }

    // Add a special symbol use instead
    let symbolCallUses = p.currentPart.symbolCallUses;
    if (symbolCallUses == null) {
      symbolCallUses = new Map();
      p.currentPart.symbolCallUses = symbolCallUses;
    }
    const callUse = symbolCallUses.get(ref);
    if (callUse === undefined) {
      symbolCallUses.set(ref, new SymbolCallUse(1, isSingleNonSpreadArgCall ? 1 : 0));
    } else {
      callUse.callCountEstimate = (callUse.callCountEstimate + 1) >>> 0; // uint32
      if (isSingleNonSpreadArgCall) {
        callUse.singleArgNonSpreadCallCountEstimate = (callUse.singleArgNonSpreadCallCountEstimate + 1) >>> 0; // uint32
      }
    }
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
          const r = rangeOfIdentifier(p.source, target.loc);

          const notes = [];
          const name = p.symbols[refInner(id.ref)].originalName;
          const member = p.moduleScope.members.get(name);
          if (member !== undefined && member.ref === id.ref) {
            const star = p.source.rangeOfOperatorBefore(member.loc, "*");
            if (star.len > 0) {
              const as = p.source.rangeOfOperatorBefore(member.loc, "as");
              if (as.len > 0 && as.loc > star.loc) {
                const note = p.tracker.msgData(
                  mkRange(star.loc, rangeEnd(rangeOfIdentifier(p.source, member.loc)) - star.loc),
                  "Consider changing " + goQuote(name) + " to a default import instead:",
                );
                note.location.suggestion = name;
                notes.push(note);
              }
            }
          }

          if (p.options.ts.parse) {
            notes.push(
              new MsgData(
                null,
                null,
                'Make sure to enable TypeScript' + "'" + 's "esModuleInterop" setting so that TypeScript' + "'" + "s type checker generates an error when you try to do this. " +
                  "You can read more about this setting here: https://www.typescriptlang.org/tsconfig#esModuleInterop",
              ),
            );
          }

          let verb = "";
          let where = "";
          let noun = "";

          switch (kind) {
            case exprKindCall:
              verb = "Calling";
              noun = "function";
              break;

            case exprKindNew:
              verb = "Constructing";
              noun = "constructor";
              break;

            case exprKindJSXTag:
              verb = "Using";
              where = " in a JSX expression";
              noun = "component";
              break;
          }

          p.log.addIDWithNotes(
            MsgID_JS_CallImportNamespace,
            Warning,
            p.tracker,
            r,
            verb + " " + goQuote(p.symbols[refInner(id.ref)].originalName) + where + " will crash at run-time because it" + "'" + "s an import namespace object, not a " + noun,
            notes.length > 0 ? notes : null,
          );
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

    // Substitute inlined constants
    if (p.options.minifySyntax && !p.currentScope.containsDirectEval && p.constValues !== null && p.constValues.size !== 0) {
      const value = p.constValues.get(ref);
      if (value !== undefined) {
        p.ignoreUsage(ref);
        return constValueToExpr(loc, value);
      }
    }

    // Capture the "arguments" variable if necessary
    // (Go stores "&fn.ArgumentsRef" in argumentsRef; here it is the Ref itself)
    if (p.fnOnlyDataVisit.argumentsRef !== null && ref === p.fnOnlyDataVisit.argumentsRef) {
      const isInsideUnsupportedArrow = p.fnOrArrowDataVisit.isArrow && jsFeatureHas(p.options.unsupportedJSFeatures, Arrow);
      const isInsideUnsupportedAsyncArrow =
        p.fnOnlyDataVisit.isInsideAsyncArrowFn && jsFeatureHas(p.options.unsupportedJSFeatures, AsyncAwait);
      if (isInsideUnsupportedArrow || isInsideUnsupportedAsyncArrow) {
        return new Expr(new EIdentifier(p.captureArguments()), loc);
      }
    }

    // Create an error for assigning to an import namespace
    if (
      (opts.assignTarget !== AssignTargetNone ||
        (opts.isDeleteTarget && p.symbols[refInner(ref)].importItemStatus === ImportItemGenerated)) &&
      p.symbols[refInner(ref)].kind === SymbolImport
    ) {
      const r = rangeOfIdentifier(p.source, loc);

      // Try to come up with a setter name to try to make this message more understandable
      let setterHint = "";
      const originalName = p.symbols[refInner(ref)].originalName;
      if (isIdentifier(originalName) && originalName !== "_") {
        if (originalName.length === 1 || originalName.charCodeAt(0) < 0x80) {
          setterHint = ' (e.g. "set' + originalName.slice(0, 1).toUpperCase() + originalName.slice(1) + '")';
        } else {
          setterHint = ' (e.g. "set_' + originalName + '")';
        }
      }

      const notes = [
        new MsgData(
          null,
          null,
          "Imports are immutable in JavaScript. " +
            "To modify the value of this import, you must export a setter function in the " +
            "imported file" +
            setterHint +
            " and then import and call that function here instead.",
        ),
      ];

      if (p.options.mode === ModeBundle) {
        p.log.addErrorWithNotes(p.tracker, r, "Cannot assign to import " + goQuote(originalName), notes);
      } else {
        let kind = Warning;
        if (p.suppressWarningsAboutWeirdCode) {
          kind = Debug;
        }
        p.log.addIDWithNotes(MsgID_JS_AssignToImport, kind, p.tracker, r, "This assignment will throw because " + goQuote(originalName) + " is an import", notes);
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
      if (p.options.mode === ModeBundle && p.source.index !== RuntimeSourceIndex && e !== p.dotOrIndexTarget) {
        p.log.addID(MsgID_JS_IndirectRequire, Debug, p.tracker, rangeOfIdentifier(p.source, loc), 'Indirect calls to "require" will not be bundled');
      }

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
      (fn.isAsync && jsFeatureHas(p.options.unsupportedJSFeatures, AsyncAwait)) || opts.isLoweredPrivateMethod, // shouldLowerSuperPropertyAccess
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
    // Go: p.lowerFunction(&fn.IsAsync, &fn.IsGenerator, &fn.Args, fn.Body.Loc, &fn.Body.Block, nil, &fn.HasRestArg, false)
    p.lowerFunction(fn, fn.body.loc, fn.body.block, false /* isArrow */);
    p.popScope();

    p.fnOrArrowDataVisit = oldFnOrArrowData;
    p.fnOnlyDataVisit = oldFnOnlyData;
  },
};

// globPatternFromExpr's "nil, logger.Range{}" result
const GLOB_PATTERN_NONE = Object.freeze([null, RANGE_ZERO]);
