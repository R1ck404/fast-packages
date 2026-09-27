// Port of internal/js_parser/js_parser.go lines 4264-8656 (parseSuffix ...
// generateTopLevelTempRef). See CONVENTIONS.md.
//
// Notes:
// - markSyntaxFeature()/markAsyncFn() calls are omitted: with target esnext
//   (UnsupportedJSFeatures == 0) they are no-ops for every feature used in
//   this range (none of them is TopLevelAwait).
// - Nil JSX children are represented as `new Expr(null, loc)` (not `null`)
//   because the printer needs their location for comments.
import { bail, LEXER_PANIC } from "./bail.mjs";
import {
  Error as LogError,
  Warning as LogWarning,
  Debug as LogDebug,
  MsgID_JS_ConfusingTypeScriptCast,
  MsgID_JS_DuplicateObjectKey,
  MsgID_JS_SemicolonAfterReturn,
  MsgID_JS_SuspiciousBooleanNot,
  Path,
  RANGE_ZERO,
  mkRange,
  rangeEnd,
} from "./logger.mjs";
import { utf16ToStringWithValidation } from "./helpers.mjs";
import {
  AssertKeyword,
  AssertOrWithEntry,
  AssertTypeJSON,
  CallCanBeUnwrappedIfUnused,
  DeferPhase,
  EvaluationPhase,
  ImportAssertOrWith,
  ImportRecord,
  ImportStmt,
  InvalidRef,
  LocRef,
  MustNotBeRenamed,
  SourcePhase,
  SymbolArguments,
  SymbolCatchIdentifier,
  SymbolClass,
  SymbolConst,
  SymbolGeneratorOrAsyncFunction,
  SymbolHoisted,
  SymbolHoistedFunction,
  SymbolImport,
  SymbolOther,
  WasOriginallyBareImport,
  WithKeyword,
  refInner,
} from "./ast.mjs";
import {
  Arg,
  ArrayBinding,
  BArray,
  BIdentifier,
  BMissingShared,
  BObject,
  B_IDENTIFIER,
  BinOpAdd,
  BinOpAddAssign,
  BinOpBitwiseAnd,
  BinOpBitwiseAndAssign,
  BinOpBitwiseOr,
  BinOpBitwiseOrAssign,
  BinOpBitwiseXor,
  BinOpBitwiseXorAssign,
  BinOpComma,
  BinOpDiv,
  BinOpDivAssign,
  BinOpGe,
  BinOpGt,
  BinOpIn,
  BinOpInstanceof,
  BinOpLe,
  BinOpLogicalAnd,
  BinOpLogicalAndAssign,
  BinOpLogicalOr,
  BinOpLogicalOrAssign,
  BinOpLooseEq,
  BinOpLooseNe,
  BinOpLt,
  BinOpMul,
  BinOpMulAssign,
  BinOpNullishCoalescing,
  BinOpNullishCoalescingAssign,
  BinOpPow,
  BinOpPowAssign,
  BinOpRem,
  BinOpRemAssign,
  BinOpShl,
  BinOpShlAssign,
  BinOpShr,
  BinOpShrAssign,
  BinOpStrictEq,
  BinOpStrictNe,
  BinOpSub,
  BinOpSubAssign,
  BinOpUShr,
  BinOpUShrAssign,
  Binding,
  Case,
  Catch,
  Class,
  ClauseItem,
  Decl,
  Decorator,
  EAwait,
  EBinary,
  EBoolean,
  ECall,
  EClass,
  EDot,
  EIdentifier,
  EIf,
  EIndex,
  EJSXElement,
  EJSXText,
  ENameOfSymbol,
  ENullShared,
  EPrivateIdentifier,
  ESpread,
  EString,
  ETemplate,
  EUnary,
  E_ARROW,
  E_BINARY,
  E_FUNCTION,
  E_IDENTIFIER,
  E_STRING,
  E_SUPER,
  E_UNARY,
  ExplicitStrictMode,
  ExportStarAlias,
  Expr,
  Finally,
  Fn,
  FnBody,
  LAdd,
  LAssign,
  LBitwiseAnd,
  LBitwiseOr,
  LBitwiseXor,
  LCall,
  LComma,
  LCompare,
  LConditional,
  LEquals,
  LExponentiation,
  LLogicalAnd,
  LLogicalOr,
  LLowest,
  LMultiply,
  LNew,
  LNullishCoalescing,
  LPostfix,
  LPrefix,
  LShift,
  LocalAwaitUsing,
  LocalConst,
  LocalLet,
  LocalUsing,
  LocalVar,
  NormalCall,
  OpTable,
  OptionalChainContinue,
  OptionalChainNone,
  OptionalChainStart,
  Property,
  PropertyField,
  PropertyIsComputed,
  PropertyIsStatic,
  PropertySpread,
  PropertyWasShorthand,
  SBlock,
  SBreak,
  SClass,
  SComment,
  SContinue,
  SDebuggerShared,
  SDirective,
  SDoWhile,
  SEmpty,
  SEmptyShared,
  SExportClause,
  SExportDefault,
  SExportEquals,
  SExportFrom,
  SExportStar,
  SExpr,
  SFor,
  SForIn,
  SForOf,
  SFunction,
  SIf,
  SImport,
  SLabel,
  SLocal,
  SReturn,
  SSwitch,
  SThrow,
  STry,
  STypeScriptShared,
  STypeScriptSharedWasDeclareClass,
  SWhile,
  SWith,
  S_CLASS,
  S_EMPTY,
  S_EXPORT_DEFAULT,
  S_EXPR,
  S_FUNCTION,
  S_LOCAL,
  S_RETURN,
  S_TYPESCRIPT,
  ScopeBlock,
  ScopeCatchBinding,
  ScopeClassBody,
  ScopeClassName,
  ScopeFunctionArgs,
  ScopeFunctionBody,
  ScopeLabel,
  ScopeWith,
  SloppyMode,
  Stmt,
  TargetWasOriginallyPropertyAccess,
  TemplatePart,
  UnOpNot,
  UnOpPostDec,
  UnOpPostInc,
  generateNonUniqueNameFromPath,
  opCodeIsRightAssociative,
  propertyKindIsMethodDefinition,
  scopeKindStopsHoisting,
} from "./js_ast.mjs";
import { TSTargetBelowES2022, TSUnusedImport_KeepValues, True, Unspecified } from "./config.mjs";
import {
  allowConstModifier,
  allowExpr,
  allowIdent,
  allowInOutVarianceAnnotations,
  decoratorBeforeClassExpr,
  decoratorInClassExpr,
  decoratorInFnArgs,
  deferredDecorators,
  evalOrArguments,
  exprFlagAfterQuestionAndBeforeColon,
  exprFlagDecorator,
  exprFlagForAwaitLoopInit,
  exprFlagForLoopInit,
  exprFlagIsNewTarget,
  fnExpr,
  fnOrArrowDataParse,
  fnStmt,
  forbidAll,
  lexicalDeclAllowAll,
  lexicalDeclAllowFnInsideIf,
  lexicalDeclAllowFnInsideLabel,
  lexicalDeclForbid,
  namespaceImportItems,
  parseBindingOpts,
  parseClassOpts,
  parseStmtOpts,
  propertyOpts,
  reservedWord,
  skipTypeScriptTypeArgumentsOpts,
  tempRef,
  tempRefNeedsDeclareMayBeCapturedInsideLoop,
  tempRefNoDeclare,
  wasOriginallyDot,
} from "./js_parser_types.mjs";
import { assign, forEachIdentifierBindingInDecls, isPropertyAccess } from "./js_ast_helpers.mjs";
import { isEvalOrArguments } from "./js_parser_visit_expr.mjs";
import {
  NoSideEffectsCommentBefore,
  StrictModeReservedWords,
  rangeOfIdentifier,
  tIsAssign,
  TAmpersand,
  TAmpersandAmpersand,
  TAmpersandAmpersandEquals,
  TAmpersandEquals,
  TAsterisk,
  TAsteriskAsterisk,
  TAsteriskAsteriskEquals,
  TAsteriskEquals,
  TAt,
  TBar,
  TBarBar,
  TBarBarEquals,
  TBarEquals,
  TBreak,
  TCaret,
  TCaretEquals,
  TCase,
  TCatch,
  TClass,
  TCloseBrace,
  TCloseBracket,
  TCloseParen,
  TColon,
  TComma,
  TConst,
  TContinue,
  TDebugger,
  TDefault,
  TDo,
  TDot,
  TDotDotDot,
  TElse,
  TEndOfFile,
  TEnum,
  TEquals,
  TEqualsEquals,
  TEqualsEqualsEquals,
  TExclamation,
  TExclamationEquals,
  TExclamationEqualsEquals,
  TExport,
  TExtends,
  TFinally,
  TFor,
  TFunction,
  TGreaterThan,
  TGreaterThanEquals,
  TGreaterThanGreaterThan,
  TGreaterThanGreaterThanEquals,
  TGreaterThanGreaterThanGreaterThan,
  TGreaterThanGreaterThanGreaterThanEquals,
  TIdentifier,
  TIf,
  TImport,
  TIn,
  TInstanceof,
  TLessThan,
  TLessThanEquals,
  TLessThanLessThan,
  TLessThanLessThanEquals,
  TMinus,
  TMinusEquals,
  TMinusMinus,
  TNoSubstitutionTemplateLiteral,
  TOpenBrace,
  TOpenBracket,
  TOpenParen,
  TPercent,
  TPercentEquals,
  TPlus,
  TPlusEquals,
  TPlusPlus,
  TPrivateIdentifier,
  TQuestion,
  TQuestionDot,
  TQuestionQuestion,
  TQuestionQuestionEquals,
  TReturn,
  TSemicolon,
  TSlash,
  TSlashEquals,
  TStringLiteral,
  TSwitch,
  TSyntaxError,
  TTemplateHead,
  TTemplateTail,
  TThis,
  TThrow,
  TTry,
  TVar,
  TWhile,
  TWith,
} from "./js_lexer.mjs";

// ast.DefaultNameMinifierJS.NumberToMinifiedName (not in ast.mjs)
const minifierHeadJS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
const minifierTailJS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$";
function numberToMinifiedNameJS(i) {
  const nHead = minifierHeadJS.length;
  const nTail = minifierTailJS.length;
  let j = i % nHead;
  let name = minifierHeadJS[j];
  i = Math.floor(i / nHead);
  while (i > 0) {
    i--;
    j = i % nTail;
    name += minifierTailJS[j];
    i = Math.floor(i / nTail);
  }
  return name;
}

export function tagOrFragmentHelpText(tag) {
  if (tag === "") {
    return "fragment tag";
  }
  return JSON.stringify(tag) + " tag";
}

export function textForParenthesesSuggestion(text) {
  // utf8.RuneCountInString
  let runes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const c2 = text.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) i++;
    }
    runes++;
  }
  let count = runes - 2;
  if (count < 1) {
    count = 1;
  }
  return "(" + " ".repeat(count) + ")";
}

export const parse2Methods = {
  parseSuffix(left, level, errors, flags) {
    const p = this;
    let optionalChain = OptionalChainNone;
    let afterAsLoc = -1;

    for (;;) {
      if (p.lexer.loc() === p.afterArrowBodyLoc) {
        for (;;) {
          switch (p.lexer.token) {
            case TComma:
              if (level >= LComma) {
                return left;
              }
              p.lexer.next();
              left = new Expr(new EBinary(left, p.parseExpr(LComma), BinOpComma), left.loc);
              break;

            default:
              return left;
          }
        }
      }

      // Stop now if this token is forbidden to follow a TypeScript "as" cast
      const operatorLoc = p.lexer.loc();
      if (operatorLoc === p.forbidSuffixAfterAsLoc) {
        return left;
      }
      const isAfterAs = operatorLoc === afterAsLoc;

      // Reset the optional chain flag by default. That way we won't accidentally
      // treat "c.d" as OptionalChainContinue in "a?.b + c.d".
      const oldOptionalChain = optionalChain;
      optionalChain = OptionalChainNone;

      switch (p.lexer.token) {
        case TDot: {
          p.lexer.next();

          if (p.lexer.token === TPrivateIdentifier) {
            // "a.#b"
            // "a?.b.#c"
            if (left.data.k === E_SUPER) {
              p.lexer.expected(TIdentifier);
            }
            const name = p.lexer.identifier;
            const nameLoc = p.lexer.loc();
            p.reportPrivateNameUsage(name);
            p.lexer.next();
            const ref = p.storeNameInRef(name);
            left = new Expr(new EIndex(left, new Expr(new EPrivateIdentifier(ref), nameLoc), 0, oldOptionalChain), left.loc);
          } else {
            // "a.b"
            // "a?.b.c"
            if (!p.lexer.isIdentifierOrKeyword()) {
              p.lexer.expect(TIdentifier);
            }
            const name = p.lexer.identifier;
            const nameLoc = p.lexer.loc();
            p.lexer.next();
            left = new Expr(p.dotOrMangledPropParse(left, name, nameLoc, oldOptionalChain, wasOriginallyDot), left.loc);
          }

          optionalChain = oldOptionalChain;
          break;
        }

        case TQuestionDot: {
          if ((flags & exprFlagIsNewTarget) !== 0) {
            p.log.addError(); // Cannot use an unparenthesized optional chain inside the target of "new"
            flags &= ~exprFlagIsNewTarget; // Don't report this error more than once in this spot
          }

          p.lexer.next();
          const optionalStart = OptionalChainStart;

          // Remove unnecessary optional chains (minify only)

          switch (p.lexer.token) {
            case TOpenBracket: {
              // "a?.[b]"
              p.lexer.next();

              // Allow "in" inside the brackets
              const oldAllowIn = p.allowIn;
              p.allowIn = true;

              const index = p.parseExpr(LLowest);

              p.allowIn = oldAllowIn;

              const closeBracketLoc = p.saveExprCommentsHere();
              p.lexer.expect(TCloseBracket);
              left = new Expr(new EIndex(left, index, closeBracketLoc, optionalStart), left.loc);
              break;
            }

            case TOpenParen: {
              // "a?.()"
              if (level >= LCall) {
                return left;
              }
              let kind = NormalCall;
              if (isPropertyAccess(left)) {
                kind = TargetWasOriginallyPropertyAccess;
              }
              const $d108 = p.parseCallArgs();
              const args = $d108[0], closeParenLoc = $d108[1], isMultiLine = $d108[2];
              left = new Expr(new ECall(left, args, closeParenLoc, optionalStart, kind, isMultiLine), left.loc);
              break;
            }

            case TLessThan:
            case TLessThanLessThan: {
              // "a?.<T>()"
              // "a?.<<T>() => T>()"
              if (!p.options.ts.parse) {
                p.lexer.expected(TIdentifier);
              }
              p.skipTypeScriptTypeArguments(new skipTypeScriptTypeArgumentsOpts());
              if (p.lexer.token !== TOpenParen) {
                p.lexer.expected(TOpenParen);
              }
              if (level >= LCall) {
                return left;
              }
              let kind = NormalCall;
              if (isPropertyAccess(left)) {
                kind = TargetWasOriginallyPropertyAccess;
              }
              const $d109 = p.parseCallArgs();
              const args = $d109[0], closeParenLoc = $d109[1], isMultiLine = $d109[2];
              left = new Expr(new ECall(left, args, closeParenLoc, optionalStart, kind, isMultiLine), left.loc);
              break;
            }

            default:
              if (p.lexer.token === TPrivateIdentifier) {
                // "a?.#b"
                const name = p.lexer.identifier;
                const nameLoc = p.lexer.loc();
                p.reportPrivateNameUsage(name);
                p.lexer.next();
                const ref = p.storeNameInRef(name);
                left = new Expr(new EIndex(left, new Expr(new EPrivateIdentifier(ref), nameLoc), 0, optionalStart), left.loc);
              } else {
                // "a?.b"
                if (!p.lexer.isIdentifierOrKeyword()) {
                  p.lexer.expect(TIdentifier);
                }
                const name = p.lexer.identifier;
                const nameLoc = p.lexer.loc();
                p.lexer.next();
                left = new Expr(p.dotOrMangledPropParse(left, name, nameLoc, optionalStart, wasOriginallyDot), left.loc);
              }
          }

          // Only continue if we have started
          if (optionalStart === OptionalChainStart) {
            optionalChain = OptionalChainContinue;
          }
          break;
        }

        case TNoSubstitutionTemplateLiteral: {
          if (oldOptionalChain !== OptionalChainNone) {
            p.log.addError(); // Template literals cannot have an optional chain as a tag
          }
          const headLoc = p.lexer.loc();
          const $d110 = p.lexer.cookedAndRawTemplateContents();
          const headCooked = $d110[0], headRaw = $d110[1];
          p.lexer.next();
          left = new Expr(new ETemplate(left, headRaw, headCooked, [], headLoc, 0, false, isPropertyAccess(left)), left.loc);
          break;
        }

        case TTemplateHead: {
          if (oldOptionalChain !== OptionalChainNone) {
            p.log.addError(); // Template literals cannot have an optional chain as a tag
          }
          const headLoc = p.lexer.loc();
          const $d111 = p.lexer.cookedAndRawTemplateContents();
          const headCooked = $d111[0], headRaw = $d111[1];
          const $d112 = p.parseTemplateParts(true /* includeRaw */);
          const parts = $d112[0];
          left = new Expr(new ETemplate(left, headRaw, headCooked, parts, headLoc, 0, false, isPropertyAccess(left)), left.loc);
          break;
        }

        case TOpenBracket: {
          // When parsing a decorator, ignore EIndex expressions since they may be
          // part of a computed property:
          //
          //   class Foo {
          //     @foo ['computed']() {}
          //   }
          //
          // This matches the behavior of the TypeScript compiler.
          if ((flags & exprFlagDecorator) !== 0) {
            return left;
          }

          p.lexer.next();

          // Allow "in" inside the brackets
          const oldAllowIn = p.allowIn;
          p.allowIn = true;

          const index = p.parseExpr(LLowest);

          p.allowIn = oldAllowIn;

          const closeBracketLoc = p.saveExprCommentsHere();
          p.lexer.expect(TCloseBracket);
          left = new Expr(new EIndex(left, index, closeBracketLoc, oldOptionalChain), left.loc);
          optionalChain = oldOptionalChain;
          break;
        }

        case TOpenParen: {
          if (level >= LCall) {
            return left;
          }
          let kind = NormalCall;
          if (isPropertyAccess(left)) {
            kind = TargetWasOriginallyPropertyAccess;
          }
          const $d113 = p.parseCallArgs();
          const args = $d113[0], closeParenLoc = $d113[1], isMultiLine = $d113[2];
          left = new Expr(new ECall(left, args, closeParenLoc, oldOptionalChain, kind, isMultiLine), left.loc);
          optionalChain = oldOptionalChain;
          break;
        }

        case TQuestion: {
          if (level >= LConditional) {
            return left;
          }
          p.lexer.next();

          // Stop now if we're parsing one of these:
          // "(a?) => {}"
          // "(a?: b) => {}"
          // "(a?, b?) => {}"
          if (
            p.options.ts.parse &&
            left.loc === p.latestArrowArgLoc &&
            (p.lexer.token === TColon || p.lexer.token === TCloseParen || p.lexer.token === TComma)
          ) {
            if (errors === null || errors === undefined) {
              p.lexer.unexpected();
            }
            errors.invalidExprAfterQuestion = p.lexer.range();
            return left;
          }

          // Allow "in" in between "?" and ":"
          const oldAllowIn = p.allowIn;
          p.allowIn = true;

          const yes = p.parseExprWithFlags(LComma, exprFlagAfterQuestionAndBeforeColon);

          p.allowIn = oldAllowIn;

          p.lexer.expect(TColon);
          const no = p.parseExprWithFlags(LComma, flags & exprFlagAfterQuestionAndBeforeColon);
          left = new Expr(new EIf(left, yes, no), left.loc);
          break;
        }

        case TExclamation:
          // Skip over TypeScript non-null assertions
          if (p.lexer.hasNewlineBefore) {
            return left;
          }
          if (!p.options.ts.parse) {
            p.lexer.unexpected();
          }
          p.lexer.next();
          optionalChain = oldOptionalChain;
          break;

        case TMinusMinus:
          if (p.lexer.hasNewlineBefore || level >= LPostfix) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EUnary(left, UnOpPostDec), left.loc);
          break;

        case TPlusPlus:
          if (p.lexer.hasNewlineBefore || level >= LPostfix) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EUnary(left, UnOpPostInc), left.loc);
          break;

        case TComma:
          if (level >= LComma) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LComma), BinOpComma), left.loc);
          break;

        case TPlus:
          if (level >= LAdd) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAdd), BinOpAdd), left.loc);
          break;

        case TPlusEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpAddAssign), left.loc);
          break;

        case TMinus:
          if (level >= LAdd) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAdd), BinOpSub), left.loc);
          break;

        case TMinusEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpSubAssign), left.loc);
          break;

        case TAsterisk:
          if (level >= LMultiply) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LMultiply), BinOpMul), left.loc);
          break;

        case TAsteriskAsterisk:
          if (level >= LExponentiation) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LExponentiation - 1), BinOpPow), left.loc);
          break;

        case TAsteriskAsteriskEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpPowAssign), left.loc);
          break;

        case TAsteriskEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpMulAssign), left.loc);
          break;

        case TPercent:
          if (level >= LMultiply) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LMultiply), BinOpRem), left.loc);
          break;

        case TPercentEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpRemAssign), left.loc);
          break;

        case TSlash:
          if (level >= LMultiply) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LMultiply), BinOpDiv), left.loc);
          break;

        case TSlashEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpDivAssign), left.loc);
          break;

        case TEqualsEquals:
          if (level >= LEquals) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LEquals), BinOpLooseEq), left.loc);
          break;

        case TExclamationEquals:
          if (level >= LEquals) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LEquals), BinOpLooseNe), left.loc);
          break;

        case TEqualsEqualsEquals:
          if (level >= LEquals) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LEquals), BinOpStrictEq), left.loc);
          break;

        case TExclamationEqualsEquals:
          if (level >= LEquals) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LEquals), BinOpStrictNe), left.loc);
          break;

        case TLessThan:
          // TypeScript allows type arguments to be specified with angle brackets
          // inside an expression. Unlike in other languages, this unfortunately
          // appears to require backtracking to parse.
          if (p.options.ts.parse && p.trySkipTypeArgumentsInExpressionWithBacktracking()) {
            optionalChain = oldOptionalChain;
            continue;
          }

          if (level >= LCompare) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LCompare), BinOpLt), left.loc);
          break;

        case TLessThanEquals:
          if (level >= LCompare) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LCompare), BinOpLe), left.loc);
          break;

        case TGreaterThan:
          if (level >= LCompare) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LCompare), BinOpGt), left.loc);
          break;

        case TGreaterThanEquals:
          if (level >= LCompare) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LCompare), BinOpGe), left.loc);
          break;

        case TLessThanLessThan:
          // TypeScript allows type arguments to be specified with angle brackets
          // inside an expression. Unlike in other languages, this unfortunately
          // appears to require backtracking to parse.
          if (p.options.ts.parse && p.trySkipTypeArgumentsInExpressionWithBacktracking()) {
            optionalChain = oldOptionalChain;
            continue;
          }

          if (level >= LShift) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LShift), BinOpShl), left.loc);
          break;

        case TLessThanLessThanEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpShlAssign), left.loc);
          break;

        case TGreaterThanGreaterThan:
          if (level >= LShift) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LShift), BinOpShr), left.loc);
          break;

        case TGreaterThanGreaterThanEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpShrAssign), left.loc);
          break;

        case TGreaterThanGreaterThanGreaterThan:
          if (level >= LShift) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LShift), BinOpUShr), left.loc);
          break;

        case TGreaterThanGreaterThanGreaterThanEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpUShrAssign), left.loc);
          break;

        case TQuestionQuestion:
          if (level >= LNullishCoalescing) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LNullishCoalescing), BinOpNullishCoalescing), left.loc);
          break;

        case TQuestionQuestionEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpNullishCoalescingAssign), left.loc);
          break;

        case TBarBar: {
          if (level >= LLogicalOr) {
            return left;
          }

          // Prevent "||" inside "??" from the right
          if (level === LNullishCoalescing) {
            p.logNullishCoalescingErrorPrecedenceError("||");
          }

          p.lexer.next();
          const right = p.parseExpr(LLogicalOr);
          left = new Expr(new EBinary(left, right, BinOpLogicalOr), left.loc);

          // Prevent "||" inside "??" from the left
          if (level < LNullishCoalescing) {
            left = p.parseSuffix(left, LNullishCoalescing + 1, null, flags);
            if (p.lexer.token === TQuestionQuestion) {
              p.logNullishCoalescingErrorPrecedenceError("||");
            }
          }
          break;
        }

        case TBarBarEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpLogicalOrAssign), left.loc);
          break;

        case TAmpersandAmpersand:
          if (level >= LLogicalAnd) {
            return left;
          }

          // Prevent "&&" inside "??" from the right
          if (level === LNullishCoalescing) {
            p.logNullishCoalescingErrorPrecedenceError("&&");
          }

          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LLogicalAnd), BinOpLogicalAnd), left.loc);

          // Prevent "&&" inside "??" from the left
          if (level < LNullishCoalescing) {
            left = p.parseSuffix(left, LNullishCoalescing + 1, null, flags);
            if (p.lexer.token === TQuestionQuestion) {
              p.logNullishCoalescingErrorPrecedenceError("&&");
            }
          }
          break;

        case TAmpersandAmpersandEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpLogicalAndAssign), left.loc);
          break;

        case TBar:
          if (level >= LBitwiseOr) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LBitwiseOr), BinOpBitwiseOr), left.loc);
          break;

        case TBarEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpBitwiseOrAssign), left.loc);
          break;

        case TAmpersand:
          if (level >= LBitwiseAnd) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LBitwiseAnd), BinOpBitwiseAnd), left.loc);
          break;

        case TAmpersandEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpBitwiseAndAssign), left.loc);
          break;

        case TCaret:
          if (level >= LBitwiseXor) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LBitwiseXor), BinOpBitwiseXor), left.loc);
          break;

        case TCaretEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LAssign - 1), BinOpBitwiseXorAssign), left.loc);
          break;

        case TEquals:
          if (level >= LAssign) {
            return left;
          }
          p.lexer.next();
          left = assign(left, p.parseExpr(LAssign - 1));
          break;

        case TIn: {
          if (level >= LCompare || !p.allowIn) {
            return left;
          }

          // Warn about "!a in b" instead of "!(a in b)"
          let kind = LogWarning;
          if (p.suppressWarningsAboutWeirdCode) {
            kind = LogDebug;
          }
          if (left.data.k === E_UNARY && left.data.op === UnOpNot) {
            p.log.addMsgID(MsgID_JS_SuspiciousBooleanNot, { kind });
          }

          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LCompare), BinOpIn), left.loc);
          break;
        }

        case TInstanceof: {
          if (level >= LCompare) {
            return left;
          }

          // Warn about "!a instanceof b" instead of "!(a instanceof b)". Here's an
          // example of code with this problem: https://github.com/mrdoob/three.js/pull/11182.
          let kind = LogWarning;
          if (p.suppressWarningsAboutWeirdCode) {
            kind = LogDebug;
          }
          if (left.data.k === E_UNARY && left.data.op === UnOpNot) {
            p.log.addMsgID(MsgID_JS_SuspiciousBooleanNot, { kind });
          }

          p.lexer.next();
          left = new Expr(new EBinary(left, p.parseExpr(LCompare), BinOpInstanceof), left.loc);
          break;
        }

        default:
          // Handle the TypeScript "as"/"satisfies" operator
          if (
            p.options.ts.parse &&
            level < LCompare &&
            !p.lexer.hasNewlineBefore &&
            (p.lexer.isContextualKeyword("as") || p.lexer.isContextualKeyword("satisfies"))
          ) {
            p.lexer.next();
            p.skipTypeScriptType(LLowest);

            // These tokens are not allowed to follow a cast expression. This isn't
            // an outright error because it may be on a new line, in which case it's
            // the start of a new expression when it's after a cast:
            //
            //   x = y as z
            //   (something);
            //
            switch (p.lexer.token) {
              case TPlusPlus:
              case TMinusMinus:
              case TNoSubstitutionTemplateLiteral:
              case TTemplateHead:
              case TOpenParen:
              case TOpenBracket:
              case TQuestionDot:
                p.forbidSuffixAfterAsLoc = p.lexer.loc();
                return left;
            }
            if (tIsAssign(p.lexer.token)) {
              p.forbidSuffixAfterAsLoc = p.lexer.loc();
              return left;
            }
            afterAsLoc = p.lexer.loc();
            continue;
          }

          return left;
      }

      // See: https://github.com/microsoft/TypeScript/issues/63527
      if (isAfterAs) {
        if (left.data.k === E_BINARY) {
          const binary = left.data;
          if (binary.left.data.k === E_BINARY && !binary.left.data.isParenthesized) {
            const binaryLeft = binary.left.data;
            let rightLevel = OpTable[binary.op].level;
            if (opCodeIsRightAssociative(binary.op)) {
              rightLevel++;
            }
            if (rightLevel > OpTable[binaryLeft.op].level) {
              p.log.addIDWithNotes(MsgID_JS_ConfusingTypeScriptCast, LogWarning);
            }
          }
        }
      }
    }
  },

  // Returns [expr, stmt, decls]
  parseExprOrLetOrUsingStmt(opts) {
    const p = this;
    let couldBeLet = false;
    let couldBeUsing = false;
    let couldBeAwaitUsing = false;

    if (p.lexer.token === TIdentifier) {
      const raw = p.lexer.raw();
      couldBeLet = raw === "let";
      couldBeUsing = raw === "using";
      couldBeAwaitUsing = raw === "await" && p.fnOrArrowDataParse.await === allowExpr;
    }

    if (!couldBeLet && !couldBeUsing && !couldBeAwaitUsing) {
      let flags = 0;
      if (opts.isForLoopInit) {
        flags |= exprFlagForLoopInit;
      }
      if (opts.isForAwaitLoopInit) {
        flags |= exprFlagForAwaitLoopInit;
      }
      return [p.parseExprCommon(LLowest, null, flags), null, []];
    }

    // (Go computes this before the early return above; the lexer is unchanged)
    const tokenRange = p.lexer.range();
    const name = p.lexer.identifier;
    p.lexer.next();

    if (couldBeLet) {
      let isLet = opts.isExport;
      switch (p.lexer.token) {
        case TIdentifier:
        case TOpenBracket:
        case TOpenBrace:
          if (opts.lexicalDecl === lexicalDeclAllowAll || !p.lexer.hasNewlineBefore || p.lexer.token === TOpenBracket) {
            isLet = true;
          }
      }
      if (isLet) {
        // Handle a "let" declaration
        if (opts.lexicalDecl !== lexicalDeclAllowAll) {
          p.forbidLexicalDecl(tokenRange.loc);
        }
        // p.markSyntaxFeature(compat.ConstAndLet, tokenRange): no-op (esnext)
        const decls = p.parseAndDeclareDecls(SymbolOther, opts);
        return [null, new Stmt(new SLocal(decls, LocalLet, opts.isExport), tokenRange.loc), decls];
      }
    } else if (
      couldBeUsing &&
      p.lexer.token === TIdentifier &&
      !p.lexer.hasNewlineBefore &&
      (!opts.isForLoopInit || p.lexer.raw() !== "of")
    ) {
      // Handle a "using" declaration
      if (opts.isCaseBody) {
        p.forbidUsingInSwitch(tokenRange.loc);
      } else if (opts.lexicalDecl !== lexicalDeclAllowAll) {
        p.forbidLexicalDecl(tokenRange.loc);
      }
      opts = opts.clone(); // Go passes "opts" by value
      opts.isUsingStmt = true;
      const decls = p.parseAndDeclareDecls(SymbolConst, opts);
      if (!opts.isForLoopInit) {
        p.requireInitializers(LocalUsing, decls);
      }
      return [null, new Stmt(new SLocal(decls, LocalUsing, opts.isExport), tokenRange.loc), decls];
    } else if (couldBeAwaitUsing) {
      // Handle an "await using" declaration
      if (p.fnOrArrowDataParse.isTopLevel) {
        p.topLevelAwaitKeyword = tokenRange;
      }
      let value = null;
      if (p.lexer.isContextualKeyword("using")) { // (Go: TIdentifier && p.lexer.Raw() == "using")
        const usingLoc = p.saveExprCommentsHere();
        const usingRange = p.lexer.range();
        p.lexer.next();
        if (p.lexer.token === TIdentifier && !p.lexer.hasNewlineBefore) {
          // It's an "await using" declaration if we get here
          if (opts.isCaseBody) {
            p.forbidUsingInSwitch(usingRange.loc);
          } else if (opts.lexicalDecl !== lexicalDeclAllowAll) {
            p.forbidLexicalDecl(usingRange.loc);
          }
          opts = opts.clone(); // Go passes "opts" by value
          opts.isUsingStmt = true;
          const decls = p.parseAndDeclareDecls(SymbolConst, opts);
          if (!opts.isForLoopInit) {
            p.requireInitializers(LocalAwaitUsing, decls);
          }
          return [null, new Stmt(new SLocal(decls, LocalAwaitUsing, opts.isExport), tokenRange.loc), decls];
        }
        value = new Expr(new EIdentifier(p.storeNameInRef("using")), usingLoc);
      } else {
        value = p.parseExpr(LPrefix);
      }
      if (p.lexer.token === TAsteriskAsterisk) {
        p.lexer.unexpected();
      }
      value = p.parseSuffix(value, LPrefix, null, 0);
      const expr = new Expr(new EAwait(value), tokenRange.loc);
      return [p.parseSuffix(expr, LLowest, null, 0), null, []];
    }

    // Parse the remainder of this expression that starts with an identifier
    const expr = new Expr(new EIdentifier(p.storeNameInRef(name)), tokenRange.loc);
    return [p.parseSuffix(expr, LLowest, null, 0), null, []];
  },

  // Returns [args, closeParenLoc, isMultiLine]
  parseCallArgs() {
    const p = this;
    const args = [];
    let isMultiLine = false;

    // Allow "in" inside call arguments
    const oldAllowIn = p.allowIn;
    p.allowIn = true;

    p.lexer.expect(TOpenParen);

    while (p.lexer.token !== TCloseParen) {
      if (p.lexer.hasNewlineBefore) {
        isMultiLine = true;
      }
      const loc = p.lexer.loc();
      const isSpread = p.lexer.token === TDotDotDot;
      if (isSpread) {
        // p.markSyntaxFeature(compat.RestArgument, ...): no-op (esnext)
        p.lexer.next();
      }
      let arg = p.parseExpr(LComma);
      if (isSpread) {
        arg = new Expr(new ESpread(arg), loc);
      }
      args.push(arg);
      if (p.lexer.token !== TComma) {
        break;
      }
      if (p.lexer.hasNewlineBefore) {
        isMultiLine = true;
      }
      p.lexer.next();
    }

    if (p.lexer.hasNewlineBefore) {
      isMultiLine = true;
    }
    const closeParenLoc = p.saveExprCommentsHere();
    p.lexer.expect(TCloseParen);
    p.allowIn = oldAllowIn;
    return [args, closeParenLoc, isMultiLine];
  },

  // Returns [nameRange, name]
  parseJSXNamespacedName() {
    const p = this;
    let nameRange = p.lexer.range();
    const name = p.lexer.identifier;
    p.lexer.expectInsideJSXElement(TIdentifier);

    // Parse JSX namespaces. These are not supported by React or TypeScript
    // but someone using JSX syntax in more obscure ways may find a use for
    // them. A namespaced name is just always turned into a string so you
    // can't use this feature to reference JavaScript identifiers.
    if (p.lexer.token === TColon) {
      // Parse the colon
      nameRange = mkRange(nameRange.loc, rangeEnd(p.lexer.range()) - nameRange.loc);
      let ns = name + ":";
      p.lexer.nextInsideJSXElement();

      // Parse the second identifier
      if (p.lexer.token === TIdentifier) {
        nameRange = mkRange(nameRange.loc, rangeEnd(p.lexer.range()) - nameRange.loc);
        ns += p.lexer.identifier;
        p.lexer.nextInsideJSXElement();
      } else {
        p.log.addError(); // Expected identifier after "ns:" in namespaced JSX name
        throw LEXER_PANIC;
      }
      return [nameRange, ns];
    }

    return [nameRange, name];
  },

  // Returns [range, text, tagOrNil]
  parseJSXTag() {
    const p = this;
    const loc = p.lexer.loc();

    // A missing tag is a fragment
    if (p.lexer.token === TGreaterThan) {
      return [mkRange(loc, 0), "", null];
    }

    // The tag is an identifier
    const $d114 = p.parseJSXNamespacedName();
    let tagRange = $d114[0], tagName = $d114[1];

    // Certain identifiers are strings
    const c0 = tagName.charCodeAt(0);
    if (tagName.includes("-") || tagName.includes(":") || (p.lexer.token !== TDot && c0 >= 0x61 && c0 <= 0x7a)) {
      return [tagRange, tagName, new Expr(new EString(tagName), loc)];
    }

    // Otherwise, this is an identifier
    let tag = new Expr(new EIdentifier(p.storeNameInRef(tagName)), loc);

    // Parse a member expression chain
    let chain = tagName;
    while (p.lexer.token === TDot) {
      p.lexer.nextInsideJSXElement();
      const memberRange = p.lexer.range();
      const member = p.lexer.identifier;
      p.lexer.expectInsideJSXElement(TIdentifier);

      // Dashes are not allowed in member expression chains
      const index = member.indexOf("-");
      if (index >= 0) {
        p.log.addError(); // Unexpected "-"
        throw LEXER_PANIC;
      }

      chain += "." + member;
      tag = new Expr(p.dotOrMangledPropParse(tag, member, memberRange.loc, OptionalChainNone, wasOriginallyDot), loc);
      tagRange = mkRange(tagRange.loc, memberRange.loc + memberRange.len - tagRange.loc);
    }

    return [tagRange, chain, tag];
  },

  parseJSXElement(loc) {
    const p = this;

    // Keep track of the location of the first JSX element for error messages
    if (p.firstJSXElementLoc === -1) {
      p.firstJSXElementLoc = loc;
    }

    // Parse the tag
    const $d115 = p.parseJSXTag();
    const startRange = $d115[0], startText = $d115[1], startTagOrNil = $d115[2];

    // The tag may have TypeScript type arguments: "<Foo<T>/>"
    if (p.options.ts.parse) {
      // Pass a flag to the type argument skipper because we need to call
      // js_lexer.NextInsideJSXElement() after we hit the closing ">". The next
      // token after the ">" might be an attribute name with a dash in it
      // like this: "<Foo<T> data-disabled/>"
      p.skipTypeScriptTypeArguments(new skipTypeScriptTypeArgumentsOpts(true, false));
    }

    // Parse attributes
    let previousStringWithBackslashLoc = 0;
    const properties = [];
    let isSingleLine = true;
    if (startTagOrNil !== null) {
      parseAttributes: for (;;) {
        if (p.lexer.hasNewlineBefore) {
          isSingleLine = false;
        }

        switch (p.lexer.token) {
          case TIdentifier: {
            // Parse the key
            const $d116 = p.parseJSXNamespacedName();
            const keyRange = $d116[0], keyName = $d116[1];
            let key;
            if (p.isMangledProp(keyName) && !keyName.includes(":")) {
              key = new Expr(new ENameOfSymbol(p.storeNameInRef(keyName)), keyRange.loc);
            } else {
              key = new Expr(new EString(keyName), keyRange.loc);
            }

            // Parse the value
            let value = null;
            let flags = 0;
            if (p.lexer.token !== TEquals) {
              // Implicitly true value
              flags |= PropertyWasShorthand;
              value = new Expr(new EBoolean(true), keyRange.loc + keyRange.len);
            } else {
              // Use NextInsideJSXElement() not Next() so we can parse a JSX-style string literal
              p.lexer.nextInsideJSXElement();
              if (p.lexer.token === TStringLiteral) {
                const stringLoc = p.lexer.loc();
                if (p.lexer.previousBackslashQuoteInJSX.loc > stringLoc) {
                  previousStringWithBackslashLoc = stringLoc;
                }
                if (p.options.jsx.preserve) {
                  value = new Expr(new EJSXText(p.lexer.raw()), stringLoc);
                } else {
                  value = new Expr(new EString(p.lexer.stringLiteral()), stringLoc);
                }
                p.lexer.nextInsideJSXElement();
              } else if (p.lexer.token === TLessThan) {
                // This may be removed in the future: https://github.com/facebook/jsx/issues/53
                const loc2 = p.lexer.loc();
                p.lexer.nextInsideJSXElement();
                flags |= PropertyWasShorthand;
                value = p.parseJSXElement(loc2);

                // The call to parseJSXElement() above doesn't consume the last
                // TGreaterThan because the caller knows what Next() function to call.
                // Use NextJSXElementChild() here since the next token is inside a JSX
                // element.
                p.lexer.nextInsideJSXElement();
              } else {
                // Use Expect() not ExpectInsideJSXElement() so we can parse expression tokens
                p.lexer.expect(TOpenBrace);
                value = p.parseExpr(LLowest);
                p.lexer.expectInsideJSXElement(TCloseBrace);
              }
            }

            // Add a property
            properties.push(new Property(null, key, value, null, [], keyRange.loc, 0, PropertyField, flags));
            break;
          }

          case TOpenBrace: {
            // Use Next() not ExpectInsideJSXElement() so we can parse "..."
            p.lexer.next();
            const dotLoc = p.saveExprCommentsHere();
            p.lexer.expect(TDotDotDot);
            const value = p.parseExpr(LComma);
            properties.push(new Property(null, null, value, null, [], dotLoc, 0, PropertySpread, 0));

            // Use NextInsideJSXElement() not Next() so we can parse ">>" as ">"
            p.lexer.nextInsideJSXElement();
            break;
          }

          default:
            break parseAttributes;
        }
      }

      // Check for and warn about duplicate attributes
      if (properties.length > 1 && !p.suppressWarningsAboutWeirdCode) {
        const keys = new Map();
        for (const property of properties) {
          if (property.kind !== PropertySpread) {
            if (property.key.data.k === E_STRING) {
              const key = property.key.data.value;
              if (keys.has(key)) {
                p.log.addIDWithNotes(MsgID_JS_DuplicateObjectKey, LogWarning); // Duplicate attribute in JSX element
              }
              keys.set(key, property.key.loc);
            }
          }
        }
      }
    }

    // People sometimes try to use the output of "JSON.stringify()" as a JSX
    // attribute when automatically-generating JSX code. Doing so is incorrect
    // because JSX strings work like XML instead of like JS (since JSX is XML-in-
    // JS). Specifically, using a backslash before a quote does not cause it to
    // be escaped. This code special-cases this error to provide a less obscure
    // error message.
    if (p.lexer.token === TSyntaxError && p.lexer.raw() === "\\" && previousStringWithBackslashLoc > 0) {
      p.log.addMsg({ kind: LogError }); // Unexpected backslash in JSX element
      throw LEXER_PANIC;
    }

    // A slash here is a self-closing element
    if (p.lexer.token === TSlash) {
      // Use NextInsideJSXElement() not Next() so we can parse ">>" as ">"
      const closeLoc = p.lexer.loc();
      p.lexer.nextInsideJSXElement();
      if (p.lexer.token !== TGreaterThan) {
        p.lexer.expected(TGreaterThan);
      }
      return new Expr(new EJSXElement(startTagOrNil, properties, [], closeLoc, isSingleLine), loc);
    }

    // Attempt to provide a better error message for people incorrectly trying to
    // use arrow functions in TSX (which doesn't work because they are JSX elements)
    let didSetBadArrow = false;
    let badArrowInTSXRange = null;
    let badArrowInTSXSuggestion = "";
    if (
      p.options.ts.parse &&
      properties.length === 0 &&
      startText !== "" &&
      p.lexer.token === TGreaterThan &&
      p.source.contents.startsWith(">(", p.lexer.loc())
    ) {
      badArrowInTSXRange = p.lexer.badArrowInTSXRange;
      badArrowInTSXSuggestion = p.lexer.badArrowInTSXSuggestion;

      p.lexer.couldBeBadArrowInTSX++;
      p.lexer.badArrowInTSXRange = mkRange(loc, rangeEnd(p.lexer.range()) - loc);
      p.lexer.badArrowInTSXSuggestion = "<" + startText + ",>";

      // Go: "defer func() { ... }()" (restored in the "finally" below)
      didSetBadArrow = true;
    }

    try {
      // Use ExpectJSXElementChild() so we parse child strings
      p.lexer.expectJSXElementChild(TGreaterThan);

      // Parse the children of this element
      const nullableChildren = [];
      for (;;) {
        switch (p.lexer.token) {
          case TStringLiteral: {
            if (p.options.jsx.preserve) {
              nullableChildren.push(new Expr(new EJSXText(p.lexer.raw()), p.lexer.loc()));
            } else {
              const str = p.lexer.stringLiteral();
              if (str.length > 0) {
                nullableChildren.push(new Expr(new EString(str), p.lexer.loc()));
              } else {
                // Skip this token if it turned out to be empty after trimming
              }
            }
            p.lexer.nextJSXElementChild();
            break;
          }

          case TOpenBrace: {
            // Use Next() instead of NextJSXElementChild() here since the next token is an expression
            p.lexer.next();

            // The expression is optional, and may be absent
            if (p.lexer.token === TCloseBrace) {
              // Save comments even for absent expressions
              nullableChildren.push(new Expr(null, p.saveExprCommentsHere()));
            } else {
              if (p.lexer.token === TDotDotDot) {
                // TypeScript preserves "..." before JSX child expressions here.
                // Babel gives the error "Spread children are not supported in React"
                // instead, so it should be safe to support this TypeScript-specific
                // behavior. Note that TypeScript's behavior changed in TypeScript 4.5.
                // Before that, the "..." was omitted instead of being preserved.
                const itemLoc = p.lexer.loc();
                // p.markSyntaxFeature(compat.RestArgument, ...): no-op (esnext)
                p.lexer.next();
                nullableChildren.push(new Expr(new ESpread(p.parseExpr(LLowest)), itemLoc));
              } else {
                nullableChildren.push(p.parseExpr(LLowest));
              }
            }

            // Use ExpectJSXElementChild() so we parse child strings
            p.lexer.expectJSXElementChild(TCloseBrace);
            break;
          }

          case TLessThan: {
            const lessThanLoc = p.lexer.loc();
            p.lexer.nextInsideJSXElement();

            if (p.lexer.token !== TSlash) {
              // This is a child element
              nullableChildren.push(p.parseJSXElement(lessThanLoc));

              // The call to parseJSXElement() above doesn't consume the last
              // TGreaterThan because the caller knows what Next() function to call.
              // Use NextJSXElementChild() here since the next token is an element
              // child.
              p.lexer.nextJSXElementChild();
              continue;
            }

            // This is the closing element
            p.lexer.nextInsideJSXElement();
            const endText = p.parseJSXTag()[1];
            if (startText !== endText) {
              p.log.addMsg({ kind: LogError }); // Unexpected closing tag does not match opening tag
            }
            if (p.lexer.token !== TGreaterThan) {
              p.lexer.expected(TGreaterThan);
            }

            return new Expr(new EJSXElement(startTagOrNil, properties, nullableChildren, lessThanLoc, isSingleLine), loc);
          }

          case TEndOfFile:
            p.log.addMsg({ kind: LogError }); // Unexpected end of file before a closing tag
            throw LEXER_PANIC;

          default:
            p.lexer.unexpected();
        }
      }
    } finally {
      if (didSetBadArrow) {
        p.lexer.couldBeBadArrowInTSX--;
        p.lexer.badArrowInTSXRange = badArrowInTSXRange;
        p.lexer.badArrowInTSXSuggestion = badArrowInTSXSuggestion;
      }
    }
  },

  // Returns [parts, legacyOctalLoc]
  parseTemplateParts(includeRaw) {
    const p = this;
    const parts = [];
    let legacyOctalLoc = 0;

    // Allow "in" inside template literals
    const oldAllowIn = p.allowIn;
    p.allowIn = true;

    for (;;) {
      p.lexer.next();
      const value = p.parseExpr(LLowest);
      const tailLoc = p.lexer.loc();
      p.lexer.rescanCloseBraceAsTemplateToken();
      if (includeRaw) {
        const $d117 = p.lexer.cookedAndRawTemplateContents();
        const tailCooked = $d117[0], tailRaw = $d117[1];
        parts.push(new TemplatePart(value, tailRaw, tailCooked, tailLoc));
      } else {
        parts.push(new TemplatePart(value, "", p.lexer.stringLiteral(), tailLoc));
        if (p.lexer.legacyOctalLoc > tailLoc) {
          legacyOctalLoc = p.lexer.legacyOctalLoc;
        }
      }
      if (p.lexer.token === TTemplateTail) {
        p.lexer.next();
        break;
      }
    }

    p.allowIn = oldAllowIn;

    return [parts, legacyOctalLoc];
  },

  parseAndDeclareDecls(kind, opts) {
    const p = this;
    const decls = [];

    for (;;) {
      // Forbid "let let" and "const let" but not "var let"
      if ((kind === SymbolOther || kind === SymbolConst) && p.lexer.isContextualKeyword("let")) {
        p.log.addError(); // Cannot use "let" as an identifier here:
      }

      let valueOrNil = null;
      const local = p.parseBinding(new parseBindingOpts(opts.isUsingStmt));
      p.declareBinding(kind, local, opts);

      // Skip over types
      if (p.options.ts.parse) {
        // "let foo!"
        const isDefiniteAssignmentAssertion = p.lexer.token === TExclamation && !p.lexer.hasNewlineBefore;
        if (isDefiniteAssignmentAssertion) {
          p.lexer.next();
        }

        // "let foo: number"
        if (isDefiniteAssignmentAssertion || p.lexer.token === TColon) {
          p.lexer.expect(TColon);
          p.skipTypeScriptType(LLowest);
        }
      }

      if (p.lexer.token === TEquals) {
        p.lexer.next();
        valueOrNil = p.parseExpr(LComma);

        // Rollup (the tool that invented the "@__NO_SIDE_EFFECTS__" comment) only
        // applies this to the first declaration, and only when it's a "const".
        // For more info see: https://github.com/rollup/rollup/pull/5024/files
        if (!p.options.ignoreDCEAnnotations && kind === SymbolConst) {
          const e = valueOrNil.data;
          switch (e.k) {
            case E_ARROW:
              if (opts.hasNoSideEffectsComment) {
                e.hasNoSideEffectsComment = true;
              }
              if (e.hasNoSideEffectsComment && !opts.isTypeScriptDeclare) {
                if (local.data.k === B_IDENTIFIER) {
                  p.symbols[refInner(local.data.ref)].flags |= CallCanBeUnwrappedIfUnused;
                }
              }
              break;

            case E_FUNCTION:
              if (opts.hasNoSideEffectsComment) {
                e.fn.hasNoSideEffectsComment = true;
              }
              if (e.fn.hasNoSideEffectsComment && !opts.isTypeScriptDeclare) {
                if (local.data.k === B_IDENTIFIER) {
                  p.symbols[refInner(local.data.ref)].flags |= CallCanBeUnwrappedIfUnused;
                }
              }
              break;
          }

          // Only apply this to the first declaration
          if (opts.hasNoSideEffectsComment) {
            opts = opts.clone(); // Go passes "opts" by value
            opts.hasNoSideEffectsComment = false;
          }
        }
      }

      decls.push(new Decl(local, valueOrNil));

      if (p.lexer.token !== TComma) {
        break;
      }
      p.lexer.next();
    }

    return decls;
  },

  requireInitializers(kind, decls) {
    const p = this;
    for (const d of decls) {
      if (d.valueOrNil === null) {
        // "The constant/declaration %q must be initialized" or
        // "This constant/declaration must be initialized"
        p.log.addError();
      }
    }
  },

  forbidInitializers(decls, loopType, isVar) {
    const p = this;
    if (decls.length > 1) {
      p.log.addError(); // for-%s loops must have a single declaration
    } else if (decls.length === 1 && decls[0].valueOrNil !== null) {
      if (isVar) {
        if (decls[0].binding.data.k === B_IDENTIFIER) {
          // This is a weird special case. Initializers are allowed in "var"
          // statements with identifier bindings.
          return;
        }
      }
      p.log.addError(); // for-%s loop variables cannot have an initializer
    }
  },

  parseClauseAlias(kind) {
    const p = this;
    const loc = p.lexer.loc();

    // The alias may now be a string (see https://github.com/tc39/ecma262/pull/2154)
    if (p.lexer.token === TStringLiteral) {
      const $d118 = utf16ToStringWithValidation(p.lexer.stringLiteral());
      const alias = $d118[0], ok = $d118[2];
      if (!ok) {
        p.log.addError(); // This alias is invalid because it contains the unpaired Unicode surrogate
      }
      return alias;
    }

    // The alias may be a keyword
    if (!p.lexer.isIdentifierOrKeyword()) {
      p.lexer.expect(TIdentifier);
    }

    const alias = p.lexer.identifier;
    p.checkForUnrepresentableIdentifier(loc, alias);
    return alias;
  },

  // Returns [items, isSingleLine]
  parseImportClause() {
    const p = this;
    const items = [];
    p.lexer.expect(TOpenBrace);
    let isSingleLine = !p.lexer.hasNewlineBefore;

    while (p.lexer.token !== TCloseBrace) {
      const isIdentifier = p.lexer.token === TIdentifier;
      const aliasLoc = p.lexer.loc();
      const alias = p.parseClauseAlias("import");
      let name = new LocRef(aliasLoc, p.storeNameInRef(alias));
      let originalName = alias;
      p.lexer.next();

      // "import { type xx } from 'mod'"
      // "import { type xx as yy } from 'mod'"
      // "import { type 'xx' as yy } from 'mod'"
      // "import { type as } from 'mod'"
      // "import { type as as } from 'mod'"
      // "import { type as as as } from 'mod'"
      if (p.options.ts.parse && alias === "type" && p.lexer.token !== TComma && p.lexer.token !== TCloseBrace) {
        if (p.lexer.isContextualKeyword("as")) {
          p.lexer.next();
          if (p.lexer.isContextualKeyword("as")) {
            originalName = p.lexer.identifier;
            name = new LocRef(p.lexer.loc(), p.storeNameInRef(originalName));
            p.lexer.next();

            if (p.lexer.token === TIdentifier) {
              // "import { type as as as } from 'mod'"
              // "import { type as as foo } from 'mod'"
              p.lexer.next();
            } else {
              // "import { type as as } from 'mod'"
              items.push(new ClauseItem(alias, originalName, aliasLoc, name));
            }
          } else if (p.lexer.token === TIdentifier) {
            // "import { type as xxx } from 'mod'"
            originalName = p.lexer.identifier;
            name = new LocRef(p.lexer.loc(), p.storeNameInRef(originalName));
            p.lexer.expect(TIdentifier);

            // Reject forbidden names
            if (isEvalOrArguments(originalName)) {
              p.log.addError(); // Cannot use %q as an identifier here:
            }

            items.push(new ClauseItem(alias, originalName, aliasLoc, name));
          }
        } else {
          const isIdentifier = p.lexer.token === TIdentifier;

          // "import { type xx } from 'mod'"
          // "import { type xx as yy } from 'mod'"
          // "import { type if as yy } from 'mod'"
          // "import { type 'xx' as yy } from 'mod'"
          p.parseClauseAlias("import");
          p.lexer.next();

          if (p.lexer.isContextualKeyword("as")) {
            p.lexer.next();
            p.lexer.expect(TIdentifier);
          } else if (!isIdentifier) {
            // An import where the name is a keyword must have an alias
            p.lexer.expectedString('"as"');
          }
        }
      } else {
        if (p.lexer.isContextualKeyword("as")) {
          p.lexer.next();
          originalName = p.lexer.identifier;
          name = new LocRef(p.lexer.loc(), p.storeNameInRef(originalName));
          p.lexer.expect(TIdentifier);
        } else if (!isIdentifier) {
          // An import where the name is a keyword must have an alias
          p.lexer.expectedString('"as"');
        }

        // Reject forbidden names
        if (isEvalOrArguments(originalName)) {
          p.log.addError(); // Cannot use %q as an identifier here:
        }

        items.push(new ClauseItem(alias, originalName, aliasLoc, name));
      }

      if (p.lexer.token !== TComma) {
        break;
      }
      if (p.lexer.hasNewlineBefore) {
        isSingleLine = false;
      }
      p.lexer.next();
      if (p.lexer.hasNewlineBefore) {
        isSingleLine = false;
      }
    }

    if (p.lexer.hasNewlineBefore) {
      isSingleLine = false;
    }
    p.lexer.expect(TCloseBrace);
    return [items, isSingleLine];
  },

  // Returns [items, isSingleLine]
  parseExportClause() {
    const p = this;
    const items = [];
    let firstNonIdentifierLoc = 0;
    p.lexer.expect(TOpenBrace);
    let isSingleLine = !p.lexer.hasNewlineBefore;

    while (p.lexer.token !== TCloseBrace) {
      let alias = p.parseClauseAlias("export");
      let aliasLoc = p.lexer.loc();
      const name = new LocRef(aliasLoc, p.storeNameInRef(alias));
      const originalName = alias;

      // The name can actually be a keyword if we're really an "export from"
      // statement. However, we won't know until later. Allow keywords as
      // identifiers for now and throw an error later if there's no "from".
      //
      //   // This is fine
      //   export { default } from 'path'
      //
      //   // This is a syntax error
      //   export { default }
      //
      if (p.lexer.token !== TIdentifier && firstNonIdentifierLoc === 0) {
        firstNonIdentifierLoc = p.lexer.loc();
      }
      p.lexer.next();

      if (p.options.ts.parse && alias === "type" && p.lexer.token !== TComma && p.lexer.token !== TCloseBrace) {
        if (p.lexer.isContextualKeyword("as")) {
          p.lexer.next();
          if (p.lexer.isContextualKeyword("as")) {
            alias = p.parseClauseAlias("export");
            aliasLoc = p.lexer.loc();
            p.lexer.next();

            if (p.lexer.token !== TComma && p.lexer.token !== TCloseBrace) {
              // "export { type as as as }"
              // "export { type as as foo }"
              // "export { type as as 'foo' }"
              p.parseClauseAlias("export");
              p.lexer.next();
            } else {
              // "export { type as as }"
              items.push(new ClauseItem(alias, originalName, aliasLoc, name));
            }
          } else if (p.lexer.token !== TComma && p.lexer.token !== TCloseBrace) {
            // "export { type as xxx }"
            // "export { type as 'xxx' }"
            alias = p.parseClauseAlias("export");
            aliasLoc = p.lexer.loc();
            p.lexer.next();

            items.push(new ClauseItem(alias, originalName, aliasLoc, name));
          }
        } else {
          // The name can actually be a keyword if we're really an "export from"
          // statement. However, we won't know until later. Allow keywords as
          // identifiers for now and throw an error later if there's no "from".
          //
          //   // This is fine
          //   export { type default } from 'path'
          //
          //   // This is a syntax error
          //   export { type default }
          //
          if (p.lexer.token !== TIdentifier && firstNonIdentifierLoc === 0) {
            firstNonIdentifierLoc = p.lexer.loc();
          }

          // "export { type xx }"
          // "export { type xx as yy }"
          // "export { type xx as if }"
          // "export { type default } from 'path'"
          // "export { type default as if } from 'path'"
          // "export { type xx as 'yy' }"
          // "export { type 'xx' } from 'mod'"
          p.parseClauseAlias("export");
          p.lexer.next();

          if (p.lexer.isContextualKeyword("as")) {
            p.lexer.next();
            p.parseClauseAlias("export");
            p.lexer.next();
          }
        }
      } else {
        if (p.lexer.isContextualKeyword("as")) {
          p.lexer.next();
          alias = p.parseClauseAlias("export");
          aliasLoc = p.lexer.loc();
          p.lexer.next();
        }

        items.push(new ClauseItem(alias, originalName, aliasLoc, name));
      }

      if (p.lexer.token !== TComma) {
        break;
      }
      if (p.lexer.hasNewlineBefore) {
        isSingleLine = false;
      }
      p.lexer.next();
      if (p.lexer.hasNewlineBefore) {
        isSingleLine = false;
      }
    }

    if (p.lexer.hasNewlineBefore) {
      isSingleLine = false;
    }
    p.lexer.expect(TCloseBrace);

    // Throw an error here if we found a keyword earlier and this isn't an
    // "export from" statement after all
    if (firstNonIdentifierLoc !== 0 && !p.lexer.isContextualKeyword("from")) {
      p.log.addError(); // Expected identifier but found %q
      throw LEXER_PANIC;
    }

    return [items, isSingleLine];
  },

  parseBinding(opts) {
    const p = this;
    const loc = p.lexer.loc();

    switch (p.lexer.token) {
      case TIdentifier: {
        const name = p.lexer.identifier;

        // Forbid invalid identifiers
        if (
          (p.fnOrArrowDataParse.await !== allowIdent && name === "await") ||
          (p.fnOrArrowDataParse.yield !== allowIdent && name === "yield")
        ) {
          p.log.addError(); // Cannot use %q as an identifier here:
        }

        const ref = p.storeNameInRef(name);
        p.lexer.next();
        return new Binding(new BIdentifier(ref), loc);
      }

      case TOpenBracket: {
        if (opts.isUsingStmt) {
          break;
        }
        // p.markSyntaxFeature(compat.Destructuring, ...): no-op (esnext)
        p.lexer.next();
        let isSingleLine = !p.lexer.hasNewlineBefore;
        const items = [];
        let hasSpread = false;

        // "in" expressions are allowed
        const oldAllowIn = p.allowIn;
        p.allowIn = true;

        while (p.lexer.token !== TCloseBracket) {
          const itemLoc = p.saveExprCommentsHere();

          if (p.lexer.token === TComma) {
            const binding = new Binding(BMissingShared, itemLoc);
            items.push(new ArrayBinding(binding, null, itemLoc));
          } else {
            if (p.lexer.token === TDotDotDot) {
              p.lexer.next();
              hasSpread = true;

              // This was a bug in the ES2015 spec that was fixed in ES2016
              // (p.markSyntaxFeature(compat.NestedRestBinding, ...): no-op (esnext))
            }

            p.saveExprCommentsHere();
            const binding = p.parseBinding(new parseBindingOpts());

            let defaultValueOrNil = null;
            if (!hasSpread && p.lexer.token === TEquals) {
              p.lexer.next();
              defaultValueOrNil = p.parseExpr(LComma);
            }

            items.push(new ArrayBinding(binding, defaultValueOrNil, itemLoc));

            // Commas after spread elements are not allowed
            if (hasSpread && p.lexer.token === TComma) {
              p.log.addError(); // Unexpected "," after rest pattern
              throw LEXER_PANIC;
            }
          }

          if (p.lexer.token !== TComma) {
            break;
          }
          if (p.lexer.hasNewlineBefore) {
            isSingleLine = false;
          }
          p.lexer.next();
          if (p.lexer.hasNewlineBefore) {
            isSingleLine = false;
          }
        }

        p.allowIn = oldAllowIn;

        if (p.lexer.hasNewlineBefore) {
          isSingleLine = false;
        }
        const closeBracketLoc = p.saveExprCommentsHere();
        p.lexer.expect(TCloseBracket);
        return new Binding(new BArray(items, closeBracketLoc, hasSpread, isSingleLine), loc);
      }

      case TOpenBrace: {
        if (opts.isUsingStmt) {
          break;
        }
        // p.markSyntaxFeature(compat.Destructuring, ...): no-op (esnext)
        p.lexer.next();
        let isSingleLine = !p.lexer.hasNewlineBefore;
        const properties = [];

        // "in" expressions are allowed
        const oldAllowIn = p.allowIn;
        p.allowIn = true;

        while (p.lexer.token !== TCloseBrace) {
          p.saveExprCommentsHere();
          const property = p.parsePropertyBinding();
          properties.push(property);

          // Commas after spread elements are not allowed
          if (property.isSpread && p.lexer.token === TComma) {
            p.log.addError(); // Unexpected "," after rest pattern
            throw LEXER_PANIC;
          }

          if (p.lexer.token !== TComma) {
            break;
          }
          if (p.lexer.hasNewlineBefore) {
            isSingleLine = false;
          }
          p.lexer.next();
          if (p.lexer.hasNewlineBefore) {
            isSingleLine = false;
          }
        }

        p.allowIn = oldAllowIn;

        if (p.lexer.hasNewlineBefore) {
          isSingleLine = false;
        }
        const closeBraceLoc = p.saveExprCommentsHere();
        p.lexer.expect(TCloseBrace);
        return new Binding(new BObject(properties, closeBraceLoc, isSingleLine), loc);
      }
    }

    p.lexer.expect(TIdentifier);
    return null;
  },

  // Returns [fn, hadBody]
  parseFn(name, classKeyword, decoratorContext, data) {
    const p = this;
    const fn = new Fn();
    fn.name = name;
    fn.hasRestArg = false;
    fn.isAsync = data.await === allowExpr;
    fn.isGenerator = data.yield === allowExpr;
    fn.argumentsRef = InvalidRef;
    fn.openParenLoc = p.lexer.loc();
    p.lexer.expect(TOpenParen);

    // Await and yield are not allowed in function arguments
    // (Go copies the struct: mutate a clone and restore the original later)
    const oldFnOrArrowData = p.fnOrArrowDataParse;
    p.fnOrArrowDataParse = oldFnOrArrowData.clone();
    if (data.await === allowExpr) {
      p.fnOrArrowDataParse.await = forbidAll;
    } else {
      p.fnOrArrowDataParse.await = allowIdent;
    }
    if (data.yield === allowExpr) {
      p.fnOrArrowDataParse.yield = forbidAll;
    } else {
      p.fnOrArrowDataParse.yield = allowIdent;
    }

    // Don't suggest inserting "async" before anything if "await" is found
    p.fnOrArrowDataParse.needsAsyncLoc = -1;

    // If "super" is allowed in the body, it's allowed in the arguments
    p.fnOrArrowDataParse.allowSuperCall = data.allowSuperCall;
    p.fnOrArrowDataParse.allowSuperProperty = data.allowSuperProperty;

    while (p.lexer.token !== TCloseParen) {
      // Skip over "this" type annotations
      if (p.options.ts.parse && p.lexer.token === TThis) {
        p.lexer.next();
        if (p.lexer.token === TColon) {
          p.lexer.next();
          p.skipTypeScriptType(LLowest);
        }
        if (p.lexer.token !== TComma) {
          break;
        }
        p.lexer.next();
        continue;
      }

      let decorators = [];
      if (data.decoratorScope !== null) {
        const oldAwait = p.fnOrArrowDataParse.await;
        const oldNeedsAsyncLoc = p.fnOrArrowDataParse.needsAsyncLoc;

        // While TypeScript parameter decorators are expressions, they are not
        // evaluated where they exist in the code. They are moved to after the
        // class declaration and evaluated there instead. One consequence of
        // this is that whether "await" is allowed or not depends on whether the
        // class declaration itself is inside an "async" function or not.
        if (oldFnOrArrowData.await === allowExpr) {
          p.fnOrArrowDataParse.await = allowExpr;
        } else {
          p.fnOrArrowDataParse.needsAsyncLoc = oldFnOrArrowData.needsAsyncLoc;
        }

        decorators = p.parseDecorators(data.decoratorScope, classKeyword, decoratorContext | decoratorInFnArgs);

        p.fnOrArrowDataParse.await = oldAwait;
        p.fnOrArrowDataParse.needsAsyncLoc = oldNeedsAsyncLoc;
      }

      if (!fn.hasRestArg && p.lexer.token === TDotDotDot) {
        // p.markSyntaxFeature(compat.RestArgument, ...): no-op (esnext)
        p.lexer.next();
        fn.hasRestArg = true;
      }

      let isTypeScriptCtorField = false;
      const isIdentifier = p.lexer.token === TIdentifier;
      let text = p.lexer.identifier;
      let arg = p.parseBinding(new parseBindingOpts());

      if (p.options.ts.parse) {
        // Skip over TypeScript accessibility modifiers, which turn this argument
        // into a class field when used inside a class constructor. This is known
        // as a "parameter property" in TypeScript.
        if (isIdentifier && data.isConstructor) {
          while (p.lexer.token === TIdentifier || p.lexer.token === TOpenBrace || p.lexer.token === TOpenBracket) {
            if (text !== "public" && text !== "private" && text !== "protected" && text !== "readonly" && text !== "override") {
              break;
            }
            isTypeScriptCtorField = true;

            // TypeScript requires an identifier binding
            if (p.lexer.token !== TIdentifier) {
              p.lexer.expect(TIdentifier);
            }
            text = p.lexer.identifier;

            // Re-parse the binding (the current binding is the TypeScript keyword)
            arg = p.parseBinding(new parseBindingOpts());
          }
        }

        // "function foo(a?) {}"
        if (p.lexer.token === TQuestion) {
          p.lexer.next();
        }

        // "function foo(a: any) {}"
        if (p.lexer.token === TColon) {
          p.lexer.next();
          p.skipTypeScriptType(LLowest);
        }
      }

      p.declareBinding(SymbolHoisted, arg, new parseStmtOpts());

      let defaultValueOrNil = null;
      if (!fn.hasRestArg && p.lexer.token === TEquals) {
        // p.markSyntaxFeature(compat.DefaultArgument, ...): no-op (esnext)
        p.lexer.next();
        defaultValueOrNil = p.parseExpr(LComma);
      }

      fn.args.push(
        new Arg(
          arg,
          defaultValueOrNil,
          decorators,

          // We need to track this because it affects code generation
          isTypeScriptCtorField,
        ),
      );

      if (p.lexer.token !== TComma) {
        break;
      }
      if (fn.hasRestArg) {
        // JavaScript does not allow a comma after a rest argument
        if (data.isTypeScriptDeclare) {
          // TypeScript does allow a comma after a rest argument in a "declare" context
          p.lexer.next();
        } else {
          p.lexer.expect(TCloseParen);
        }
        break;
      }
      p.lexer.next();
    }

    // Reserve the special name "arguments" in this scope. This ensures that it
    // shadows any variable called "arguments" in any parent scopes. But only do
    // this if it wasn't already declared above because arguments are allowed to
    // be called "arguments", in which case the real "arguments" is inaccessible.
    if (!p.currentScope.members.has("arguments")) {
      fn.argumentsRef = p.declareSymbol(SymbolArguments, fn.openParenLoc, "arguments");
      p.symbols[refInner(fn.argumentsRef)].flags |= MustNotBeRenamed;
    }

    p.lexer.expect(TCloseParen);
    p.fnOrArrowDataParse = oldFnOrArrowData;

    // "function foo(): any {}"
    if (p.options.ts.parse && p.lexer.token === TColon) {
      p.lexer.next();
      p.skipTypeScriptReturnType();
    }

    // "function foo(): any;"
    if (data.allowMissingBodyForTypeScript && p.lexer.token !== TOpenBrace) {
      p.lexer.expectOrInsertSemicolon();
      return [fn, false];
    }

    fn.body = p.parseFnBody(data);
    return [fn, true];
  },

  validateFunctionName(fn, kind) {
    const p = this;
    // Prevent the function name from being the same as a function-specific keyword
    if (fn.name !== null) {
      if (fn.isAsync && p.symbols[refInner(fn.name.ref)].originalName === "await") {
        p.log.addError(); // An async function cannot be named "await"
      } else if (fn.isGenerator && p.symbols[refInner(fn.name.ref)].originalName === "yield" && kind === fnExpr) {
        p.log.addError(); // A generator function expression cannot be named "yield"
      }
    }
  },

  validateDeclaredSymbolName(loc, name) {
    const p = this;
    if (StrictModeReservedWords.has(name)) {
      p.markStrictModeFeature(reservedWord, rangeOfIdentifier(p.source, loc), name);
    } else if (isEvalOrArguments(name)) {
      p.markStrictModeFeature(evalOrArguments, rangeOfIdentifier(p.source, loc), name);
    }
  },

  parseClassStmt(loc, opts) {
    const p = this;
    let name = null;
    const classKeyword = p.lexer.range();
    if (p.lexer.token === TClass) {
      // p.markSyntaxFeature(compat.Class, classKeyword): no-op (esnext)
      p.lexer.next();
    } else {
      p.lexer.expected(TClass);
    }

    if (!opts.isNameOptional || (p.lexer.token === TIdentifier && (!p.options.ts.parse || p.lexer.identifier !== "implements"))) {
      const nameLoc = p.lexer.loc();
      const nameText = p.lexer.identifier;
      p.lexer.expect(TIdentifier);
      if (p.fnOrArrowDataParse.await !== allowIdent && nameText === "await") {
        p.log.addError(); // Cannot use "await" as an identifier here:
      }
      let nameRef = InvalidRef;
      if (!opts.isTypeScriptDeclare) {
        nameRef = p.declareSymbol(SymbolClass, nameLoc, nameText);
      }
      name = new LocRef(nameLoc, nameRef);
    }

    // Even anonymous classes can have TypeScript type parameters
    if (p.options.ts.parse) {
      p.skipTypeScriptTypeParameters(allowInOutVarianceAnnotations | allowConstModifier);
    }

    const classOpts = new parseClassOpts([], 0, opts.isTypeScriptDeclare);
    if (opts.deferredDecorators !== null) {
      classOpts.decorators = opts.deferredDecorators.decorators;
    }
    const scopeIndex = p.pushScopeForParsePass(ScopeClassName, loc);
    const class_ = p.parseClass(classKeyword, name, classOpts);

    if (opts.isTypeScriptDeclare) {
      p.popAndDiscardScope(scopeIndex);

      if (opts.isNamespaceScope && opts.isExport) {
        p.hasNonLocalExportDeclareInsideNamespace = true;
      }

      // Remember that this was a "declare class" so we can allow decorators on it
      return new Stmt(STypeScriptSharedWasDeclareClass, loc);
    }

    p.popScope();
    return new Stmt(new SClass(class_, opts.isExport), loc);
  },

  parseClassExpr(decorators) {
    const p = this;
    if (decorators === null || decorators === undefined) {
      decorators = []; // Go: nil slice
    }
    const classKeyword = p.lexer.range();
    // p.markSyntaxFeature(compat.Class, classKeyword): no-op (esnext)
    p.lexer.expect(TClass);
    let name = null;

    const opts = new parseClassOpts(decorators, decoratorInClassExpr, false);
    p.pushScopeForParsePass(ScopeClassName, classKeyword.loc);

    // Parse an optional class name
    if (p.lexer.token === TIdentifier) {
      const nameText = p.lexer.identifier;
      if (!p.options.ts.parse || nameText !== "implements") {
        if (p.fnOrArrowDataParse.await !== allowIdent && nameText === "await") {
          p.log.addError(); // Cannot use "await" as an identifier here:
        }
        name = new LocRef(p.lexer.loc(), p.newSymbol(SymbolOther, nameText));
        p.lexer.next();
      }
    }

    // Even anonymous classes can have TypeScript type parameters
    if (p.options.ts.parse) {
      p.skipTypeScriptTypeParameters(allowInOutVarianceAnnotations | allowConstModifier);
    }

    const class_ = p.parseClass(classKeyword, name, opts);

    p.popScope();
    return new Expr(new EClass(class_), classKeyword.loc);
  },

  // By the time we call this, the identifier and type parameters have already
  // been parsed. We need to start parsing from the "extends" clause.
  parseClass(classKeyword, name, classOpts) {
    const p = this;
    let extendsOrNil = null;

    if (p.lexer.token === TExtends) {
      p.lexer.next();
      extendsOrNil = p.parseExpr(LNew);

      // TypeScript's type argument parser inside expressions backtracks if the
      // first token after the end of the type parameter list is "{", so the
      // parsed expression above will have backtracked if there are any type
      // arguments. This means we have to re-parse for any type arguments here.
      // This seems kind of wasteful to me but it's what the official compiler
      // does and it probably doesn't have that high of a performance overhead
      // because "extends" clauses aren't that frequent, so it should be ok.
      if (p.options.ts.parse) {
        p.skipTypeScriptTypeArguments(new skipTypeScriptTypeArgumentsOpts());
      }
    }

    if (p.options.ts.parse && p.lexer.isContextualKeyword("implements")) {
      p.lexer.next();
      for (;;) {
        p.skipTypeScriptType(LLowest);
        if (p.lexer.token !== TComma) {
          break;
        }
        p.lexer.next();
      }
    }

    const bodyLoc = p.lexer.loc();
    p.lexer.expect(TOpenBrace);
    const properties = [];
    let hasPropertyDecorator = false;

    // Allow "in" and private fields inside class bodies
    const oldAllowIn = p.allowIn;
    p.allowIn = true;

    // A scope is needed for private identifiers
    const scopeIndex = p.pushScopeForParsePass(ScopeClassBody, bodyLoc);

    const opts = new propertyOpts();
    opts.isClass = true;
    opts.decoratorScope = p.currentScope;
    opts.decoratorContext = classOpts.decoratorContext;
    opts.classHasExtends = extendsOrNil !== null;
    opts.classKeyword = classKeyword;
    let hasConstructor = false;

    while (p.lexer.token !== TCloseBrace) {
      if (p.lexer.token === TSemicolon) {
        p.lexer.next();
        continue;
      }

      // Parse decorators for this property
      const firstDecoratorLoc = p.lexer.loc();
      const scopeIndex = p.scopesInOrder.length;
      opts.decorators = p.parseDecorators(p.currentScope, classKeyword, opts.decoratorContext);
      if (opts.decorators.length > 0) {
        hasPropertyDecorator = true;
      }

      // This property may turn out to be a type in TypeScript, which should be ignored
      // (Go passes "opts" by value)
      const $d119 = p.parseProperty(p.saveExprCommentsHere(), PropertyField, opts.clone(), null);
      const property = $d119[0], ok = $d119[1];
      if (ok) {
        properties.push(property);

        // Forbid decorators on class constructors
        const key = property.key;
        if (key !== null && key.data.k === E_STRING && key.data.value === "constructor") {
          if (opts.decorators.length > 0) {
            p.log.addError(); // Decorators are not allowed on class constructors
          }
          if (
            propertyKindIsMethodDefinition(property.kind) &&
            (property.flags & PropertyIsStatic) === 0 &&
            (property.flags & PropertyIsComputed) === 0
          ) {
            if (hasConstructor) {
              p.log.addError(); // Classes cannot contain more than one constructor
            }
            hasConstructor = true;
          }
        }
      } else if (!classOpts.isTypeScriptDeclare && opts.decorators.length > 0) {
        p.log.addError(); // Decorators are not valid here
        p.discardScopesUpTo(scopeIndex);
      }
    }

    // Discard the private identifier scope inside a TypeScript "declare class"
    if (classOpts.isTypeScriptDeclare) {
      p.popAndDiscardScope(scopeIndex);
    } else {
      p.popScope();
    }

    p.allowIn = oldAllowIn;

    const closeBraceLoc = p.saveExprCommentsHere();
    p.lexer.expect(TCloseBrace);

    // TypeScript has legacy behavior that uses assignment semantics instead of
    // define semantics for class fields when "useDefineForClassFields" is enabled
    // (in which case TypeScript behaves differently than JavaScript, which is
    // arguably "wrong").
    //
    // We default "useDefineForClassFields" to true (i.e. to "correct") instead.
    // This is partially because our target defaults to "esnext", and partially
    // because this is a legacy behavior that no one should be using anymore.
    // Users that want the wrong behavior can either set "useDefineForClassFields"
    // to false in "tsconfig.json" explicitly, or set TypeScript's "target" to
    // "ES2021" or earlier in their in "tsconfig.json" file.
    const useDefineForClassFields =
      !p.options.ts.parse ||
      p.options.ts.config.useDefineForClassFields === True ||
      (p.options.ts.config.useDefineForClassFields === Unspecified && p.options.ts.config.target !== TSTargetBelowES2022);

    return new Class(
      classOpts.decorators,
      name,
      extendsOrNil,
      properties,
      classKeyword,
      bodyLoc,
      closeBraceLoc,

      // Always lower standard decorators if they are present and TypeScript's
      // "useDefineForClassFields" setting is false even if the configured target
      // environment supports decorators. This setting changes the behavior of
      // class fields, and so we must lower decorators so they behave correctly.
      // (unsupportedJSFeatures.Has(compat.Decorators) is always false here)
      (classOpts.decorators.length > 0 || hasPropertyDecorator) &&
        p.options.ts.parse &&
        p.options.ts.config.experimentalDecorators !== True &&
        !useDefineForClassFields,

      useDefineForClassFields,
    );
  },

  parseLabelName() {
    const p = this;
    if (p.lexer.token !== TIdentifier || p.lexer.hasNewlineBefore) {
      return null;
    }

    const name = new LocRef(p.lexer.loc(), p.storeNameInRef(p.lexer.identifier));
    p.lexer.next();
    return name;
  },

  // Returns [pathRange, pathText, assertOrWith, flags]
  parsePath() {
    const p = this;
    let flags = 0;
    const pathRange = p.lexer.range();
    const pathText = p.lexer.stringLiteral();
    if (p.lexer.token === TNoSubstitutionTemplateLiteral) {
      p.lexer.next();
    } else {
      p.lexer.expect(TStringLiteral);
    }

    // See https://github.com/tc39/proposal-import-attributes for more info
    let assertOrWith = null;
    if (p.lexer.token === TWith || (!p.lexer.hasNewlineBefore && p.lexer.isContextualKeyword("assert"))) {
      // "import './foo.json' assert { type: 'json' }"
      // "import './foo.json' with { type: 'json' }"
      const entries = [];
      const duplicates = new Map();
      let keyword = WithKeyword;
      if (p.lexer.token !== TWith) {
        keyword = AssertKeyword;
      }
      const keywordLoc = p.saveExprCommentsHere();
      p.lexer.next();
      const openBraceLoc = p.saveExprCommentsHere();
      p.lexer.expect(TOpenBrace);

      while (p.lexer.token !== TCloseBrace) {
        // Parse the key
        const keyLoc = p.saveExprCommentsHere();
        let preferQuotedKey = false;
        let key = "";
        let keyText = "";
        if (p.lexer.isIdentifierOrKeyword()) {
          keyText = p.lexer.identifier;
          key = keyText;
        } else if (p.lexer.token === TStringLiteral) {
          key = p.lexer.stringLiteral();
          keyText = key;
          preferQuotedKey = !p.options.minifySyntax;
        } else {
          p.lexer.expect(TIdentifier);
        }
        if (duplicates.has(keyText)) {
          p.log.addErrorWithNotes(); // Duplicate import attribute/assertion %q
        }
        duplicates.set(keyText, p.lexer.range());
        p.lexer.next();
        p.lexer.expect(TColon);

        // Parse the value
        const valueLoc = p.saveExprCommentsHere();
        const value = p.lexer.stringLiteral();
        p.lexer.expect(TStringLiteral);

        entries.push(new AssertOrWithEntry(key, value, keyLoc, valueLoc, preferQuotedKey));

        // Using "assert: { type: 'json' }" triggers special behavior
        if (keyword === AssertKeyword && key === "type" && value === "json") {
          flags |= AssertTypeJSON;
        }

        if (p.lexer.token !== TComma) {
          break;
        }
        p.lexer.next();
      }

      const closeBraceLoc = p.saveExprCommentsHere();
      p.lexer.expect(TCloseBrace);
      if (keyword === AssertKeyword) {
        p.maybeWarnAboutAssertKeyword(keywordLoc);
      }
      assertOrWith = new ImportAssertOrWith(entries, keywordLoc, openBraceLoc, closeBraceLoc, 0, 0, keyword);
    }

    return [pathRange, pathText, assertOrWith, flags];
  },

  // Let people know if they probably should be using "with" instead of "assert"
  maybeWarnAboutAssertKeyword(loc) {
    // Go: only warns if "unsupportedJSFeatures.Has(compat.ImportAssertions) &&
    // !unsupportedJSFeatures.Has(compat.ImportAttributes)", which is always
    // false in the fast path (target esnext), so this is a no-op.
  },

  // This assumes the "function" token has already been parsed
  parseFnStmt(loc, opts, isAsync, asyncRange) {
    const p = this;
    const isGenerator = p.lexer.token === TAsterisk;
    // hasError = p.markAsyncFn(asyncRange, isGenerator): always false (esnext)
    if (isGenerator) {
      // p.markSyntaxFeature(compat.Generator, ...): no-op (esnext)
      p.lexer.next();
    }

    switch (opts.lexicalDecl) {
      case lexicalDeclForbid:
        p.forbidLexicalDecl(loc);
        break;

      // Allow certain function statements in certain single-statement contexts
      case lexicalDeclAllowFnInsideIf:
      case lexicalDeclAllowFnInsideLabel:
        if (opts.isTypeScriptDeclare || isGenerator || isAsync) {
          p.forbidLexicalDecl(loc);
        }
        break;
    }

    let name = null;
    let nameText = "";

    // The name is optional for "export default function() {}" pseudo-statements
    if (!opts.isNameOptional || p.lexer.token === TIdentifier) {
      const nameLoc = p.lexer.loc();
      nameText = p.lexer.identifier;
      if (!isAsync && p.fnOrArrowDataParse.await !== allowIdent && nameText === "await") {
        p.log.addError(); // Cannot use "await" as an identifier here:
      }
      p.lexer.expect(TIdentifier);
      name = new LocRef(nameLoc, InvalidRef);
    }

    // Even anonymous functions can have TypeScript type parameters
    if (p.options.ts.parse) {
      p.skipTypeScriptTypeParameters(allowConstModifier);
    }

    // Introduce a fake block scope for function declarations inside if statements
    let ifStmtScopeIndex = 0;
    const hasIfScope = opts.lexicalDecl === lexicalDeclAllowFnInsideIf;
    if (hasIfScope) {
      ifStmtScopeIndex = p.pushScopeForParsePass(ScopeBlock, loc);
    }

    const scopeIndex = p.pushScopeForParsePass(ScopeFunctionArgs, p.lexer.loc());

    let await_ = allowIdent;
    let yield_ = allowIdent;
    if (isAsync) {
      await_ = allowExpr;
    }
    if (isGenerator) {
      yield_ = allowExpr;
    }

    const data = new fnOrArrowDataParse();
    data.needsAsyncLoc = loc;
    data.asyncRange = asyncRange;
    data.await = await_;
    data.yield = yield_;
    data.isTypeScriptDeclare = opts.isTypeScriptDeclare;

    // Only allow omitting the body if we're parsing TypeScript
    data.allowMissingBodyForTypeScript = p.options.ts.parse;

    const $d120 = p.parseFn(name, RANGE_ZERO, 0, data);
    const fn = $d120[0], hadBody = $d120[1];

    // Don't output anything if it's just a forward declaration of a function
    if (opts.isTypeScriptDeclare || !hadBody) {
      p.popAndDiscardScope(scopeIndex);

      // Balance the fake block scope introduced above
      if (hasIfScope) {
        p.popAndDiscardScope(ifStmtScopeIndex);
      }

      if (opts.isTypeScriptDeclare && opts.isNamespaceScope && opts.isExport) {
        p.hasNonLocalExportDeclareInsideNamespace = true;
      }

      return new Stmt(STypeScriptShared, loc);
    }

    p.popScope();

    // Only declare the function after we know if it had a body or not. Otherwise
    // TypeScript code such as this will double-declare the symbol:
    //
    //     function foo(): void;
    //     function foo(): void {}
    //
    if (name !== null) {
      let kind = SymbolHoistedFunction;
      if (isGenerator || isAsync) {
        kind = SymbolGeneratorOrAsyncFunction;
      }
      // Go mutates "name.Ref" through the pointer stored in "fn.Name"
      name = new LocRef(name.loc, p.declareSymbol(kind, name.loc, nameText));
      fn.name = name;
    }

    // Balance the fake block scope introduced above
    if (hasIfScope) {
      p.popScope();
    }

    fn.hasIfScope = hasIfScope;
    p.validateFunctionName(fn, fnStmt);
    if (opts.hasNoSideEffectsComment && !p.options.ignoreDCEAnnotations) {
      fn.hasNoSideEffectsComment = true;
      if (name !== null && !opts.isTypeScriptDeclare) {
        p.symbols[refInner(name.ref)].flags |= CallCanBeUnwrappedIfUnused;
      }
    }
    return new Stmt(new SFunction(fn, opts.isExport), loc);
  },

  parseDecorators(decoratorScope, classKeyword, context) {
    const p = this;
    const decorators = [];

    if (p.lexer.token === TAt) {
      if (p.options.ts.parse) {
        if (p.options.ts.config.experimentalDecorators === True) {
          if ((context & decoratorInClassExpr) !== 0) {
            p.lexer.addRangeErrorWithNotes(p.lexer.range(), "TypeScript experimental decorators can only be used with class declarations", []);
          } else if ((context & decoratorBeforeClassExpr) !== 0) {
            p.log.addError(); // TypeScript experimental decorators cannot be used in expression position
          }
        } else {
          if ((context & decoratorInFnArgs) !== 0 && p.options.ts.config.experimentalDecorators !== True) {
            p.log.addErrorWithNotes(); // Parameter decorators only work when experimental decorators are enabled
          }
        }
      } else {
        if ((context & decoratorInFnArgs) !== 0) {
          p.log.addError(); // Parameter decorators are not allowed in JavaScript
        }
      }
    }

    // TypeScript decorators cause us to temporarily revert to the scope that
    // encloses the class declaration, since that's where the generated code
    // for TypeScript decorators will be inserted.
    const oldScope = p.currentScope;
    p.currentScope = decoratorScope;

    while (p.lexer.token === TAt) {
      const atLoc = p.lexer.loc();
      p.lexer.next();

      let value;
      if (p.options.ts.parse && p.options.ts.config.experimentalDecorators === True) {
        // TypeScript's experimental decorator syntax is more permissive than
        // JavaScript. Parse a new/call expression with "exprFlagDecorator" so
        // we ignore EIndex expressions, since they may be part of a computed
        // property:
        //
        //   class Foo {
        //     @foo ['computed']() {}
        //   }
        //
        // This matches the behavior of the TypeScript compiler.
        p.parseExperimentalDecoratorNesting++;
        value = p.parseExprWithFlags(LNew, exprFlagDecorator);
        p.parseExperimentalDecoratorNesting--;
      } else {
        // JavaScript's decorator syntax is more restrictive. Parse it using a
        // special parser that doesn't allow normal expressions (e.g. "?.").
        value = p.parseDecorator();
      }
      decorators.push(new Decorator(value, atLoc, !p.lexer.hasNewlineBefore));
    }

    // Avoid "popScope" because this decorator scope is not hierarchical
    p.currentScope = oldScope;
    return decorators;
  },

  parseDecorator() {
    const p = this;
    if (p.lexer.token === TOpenParen) {
      p.lexer.next();
      const value = p.parseExpr(LLowest);
      p.lexer.expect(TCloseParen);
      return value;
    }

    const name = p.lexer.identifier;
    const nameRange = p.lexer.range();
    p.lexer.expect(TIdentifier);

    // Forbid invalid identifiers
    if (
      (p.fnOrArrowDataParse.await !== allowIdent && name === "await") ||
      (p.fnOrArrowDataParse.yield !== allowIdent && name === "yield")
    ) {
      p.log.addError(); // Cannot use %q as an identifier here:
    }

    let memberExpr = new Expr(new EIdentifier(p.storeNameInRef(name)), nameRange.loc);

    // Custom error reporting for error recovery (the message itself is never
    // materialized since errors bail)
    let hasSyntaxError = false;

    loop: for (;;) {
      switch (p.lexer.token) {
        case TExclamation:
          // Skip over TypeScript non-null assertions
          if (p.lexer.hasNewlineBefore) {
            break loop;
          }
          if (!p.options.ts.parse) {
            p.lexer.unexpected();
          }
          p.lexer.next();
          break;

        case TDot:
        case TQuestionDot:
          // The grammar for "DecoratorMemberExpression" currently forbids "?."
          if (p.lexer.token === TQuestionDot && !hasSyntaxError) {
            hasSyntaxError = true; // JavaScript decorator syntax does not allow "?." here
          }

          p.lexer.next();

          if (p.lexer.token === TPrivateIdentifier) {
            const name = p.lexer.identifier;
            memberExpr = new Expr(
              new EIndex(memberExpr, new Expr(new EPrivateIdentifier(p.storeNameInRef(name)), p.lexer.loc())),
              memberExpr.loc,
            );
            p.reportPrivateNameUsage(name);
            p.lexer.next();
          } else {
            memberExpr = new Expr(new EDot(memberExpr, p.lexer.identifier, p.lexer.loc()), memberExpr.loc);
            p.lexer.expect(TIdentifier);
          }
          break;

        case TOpenParen: {
          const $d121 = p.parseCallArgs();
          const args = $d121[0], closeParenLoc = $d121[1], isMultiLine = $d121[2];
          memberExpr = new Expr(
            new ECall(memberExpr, args, closeParenLoc, OptionalChainNone, TargetWasOriginallyPropertyAccess, isMultiLine),
            memberExpr.loc,
          );

          // The grammar for "DecoratorCallExpression" currently forbids anything after it
          if (p.lexer.token === TDot) {
            if (!hasSyntaxError) {
              hasSyntaxError = true; // JavaScript decorator syntax does not allow "." after a call expression
            }
            continue loop;
          }
          break loop;
        }

        default:
          // "@x<y>"
          // "@x.y<z>"
          if (!p.skipTypeScriptTypeArguments(new skipTypeScriptTypeArgumentsOpts())) {
            break loop;
          }
      }
    }

    // Suggest that non-decorator expressions be wrapped in parentheses
    if (hasSyntaxError) {
      p.log.addMsg({ kind: LogError });
    }

    return memberExpr;
  },

  parseStmt(opts) {
    const p = this;
    // Go passes "opts" by value and mutates it below. (JS-only: it is cloned on
    // the first mutation instead of up front, as most statements never mutate it)
    let ownsOpts = false;
    const loc = p.lexer.loc();

    if ((p.lexer.hasCommentBefore & NoSideEffectsCommentBefore) !== 0) {
      if (!ownsOpts) {
        opts = opts.clone();
        ownsOpts = true;
      }
      opts.hasNoSideEffectsComment = true;
    }

    // Do not attach any leading comments to the next expression
    // (Go: "p.lexer.CommentsBeforeToken = p.lexer.CommentsBeforeToken[:0]")
    const commentsBeforeToken = p.lexer.commentsBeforeToken;
    if (commentsBeforeToken !== null && commentsBeforeToken.length !== 0) {
      p.lexer.commentsBeforeToken = [];
    }

    switch (p.lexer.token) {
      case TSemicolon:
        p.lexer.next();
        return new Stmt(SEmptyShared, loc);

      case TExport: {
        const previousExportKeyword = p.esmExportKeyword;
        if (opts.isModuleScope) {
          p.esmExportKeyword = p.lexer.range();
        } else if (!opts.isNamespaceScope) {
          p.lexer.unexpected();
        }
        p.lexer.next();

        switch (p.lexer.token) {
          case TClass:
          case TConst:
          case TFunction:
          case TVar:
          case TAt:
            if (!ownsOpts) {
              opts = opts.clone();
              ownsOpts = true;
            }
            opts.isExport = true;
            return p.parseStmt(opts);

          case TImport:
            // "export import foo = bar"
            if (p.options.ts.parse && (opts.isModuleScope || opts.isNamespaceScope)) {
              if (!ownsOpts) {
                opts = opts.clone();
                ownsOpts = true;
              }
              opts.isExport = true;
              return p.parseStmt(opts);
            }

            p.lexer.unexpected();
            return null;

          case TEnum:
            if (!p.options.ts.parse) {
              p.lexer.unexpected();
            }
            if (!ownsOpts) {
              opts = opts.clone();
              ownsOpts = true;
            }
            opts.isExport = true;
            return p.parseStmt(opts);

          case TIdentifier: {
            if (p.lexer.isContextualKeyword("let")) {
              if (!ownsOpts) {
                opts = opts.clone();
                ownsOpts = true;
              }
              opts.isExport = true;
              return p.parseStmt(opts);
            }

            if (p.lexer.isContextualKeyword("as")) {
              // "export as namespace ns;"
              p.lexer.next();
              p.lexer.expectContextualKeyword("namespace");
              p.lexer.expect(TIdentifier);
              p.lexer.expectOrInsertSemicolon();
              return new Stmt(STypeScriptShared, loc);
            }

            if (p.lexer.isContextualKeyword("async")) {
              // "export async function foo() {}"
              const asyncRange = p.lexer.range();
              p.lexer.next();
              if (p.lexer.hasNewlineBefore) {
                p.log.addError(); // Unexpected newline after "async"
                throw LEXER_PANIC;
              }
              p.lexer.expect(TFunction);
              if (!ownsOpts) {
                opts = opts.clone();
                ownsOpts = true;
              }
              opts.isExport = true;
              return p.parseFnStmt(loc, opts, true /* isAsync */, asyncRange);
            }

            if (p.options.ts.parse) {
              switch (p.lexer.identifier) {
                case "type": {
                  // "export type foo = ..."
                  p.lexer.next();
                  if (p.lexer.hasNewlineBefore && p.lexer.token !== TOpenBrace && p.lexer.token !== TAsterisk) {
                    p.log.addError(); // Unexpected newline after "type"
                    throw LEXER_PANIC;
                  }
                  const typeOpts = new parseStmtOpts();
                  typeOpts.isModuleScope = opts.isModuleScope;
                  typeOpts.isExport = true;
                  p.skipTypeScriptTypeStmt(typeOpts);
                  return new Stmt(STypeScriptShared, loc);
                }

                case "namespace":
                case "abstract":
                case "module":
                case "interface":
                  // "export namespace Foo {}"
                  // "export abstract class Foo {}"
                  // "export module Foo {}"
                  // "export interface Foo {}"
                  if (!ownsOpts) {
                    opts = opts.clone();
                    ownsOpts = true;
                  }
                  opts.isExport = true;
                  return p.parseStmt(opts);

                case "declare":
                  // "export declare class Foo {}"
                  if (!ownsOpts) {
                    opts = opts.clone();
                    ownsOpts = true;
                  }
                  opts.isExport = true;
                  if (!ownsOpts) {
                    opts = opts.clone();
                    ownsOpts = true;
                  }
                  opts.lexicalDecl = lexicalDeclAllowAll;
                  if (!ownsOpts) {
                    opts = opts.clone();
                    ownsOpts = true;
                  }
                  opts.isTypeScriptDeclare = true;
                  return p.parseStmt(opts);
              }
            }

            p.lexer.unexpected();
            return null;
          }

          case TDefault: {
            if (!opts.isModuleScope && (!opts.isNamespaceScope || !opts.isTypeScriptDeclare)) {
              p.lexer.unexpected();
            }

            const defaultLoc = p.lexer.loc();
            p.lexer.next();

            // Also pick up comments after the "default" keyword
            if ((p.lexer.hasCommentBefore & NoSideEffectsCommentBefore) !== 0) {
              if (!ownsOpts) {
                opts = opts.clone();
                ownsOpts = true;
              }
              opts.hasNoSideEffectsComment = true;
            }

            // The default name is lazily generated only if no other name is present
            const createDefaultName = () => {
              // This must be named "default" for when "--keep-names" is active
              const defaultName = new LocRef(defaultLoc, p.newSymbol(SymbolOther, "default"));
              p.currentScope.generated.push(defaultName.ref);
              return defaultName;
            };

            // "export default async function() {}"
            // "export default async function foo() {}"
            if (p.lexer.isContextualKeyword("async")) {
              const asyncRange = p.lexer.range();
              p.lexer.next();

              if (p.lexer.token === TFunction && !p.lexer.hasNewlineBefore) {
                p.lexer.next();
                const fnOpts = new parseStmtOpts();
                fnOpts.isNameOptional = true;
                fnOpts.lexicalDecl = lexicalDeclAllowAll;
                fnOpts.hasNoSideEffectsComment = opts.hasNoSideEffectsComment;
                const stmt = p.parseFnStmt(loc, fnOpts, true /* isAsync */, asyncRange);
                if (stmt.data.k === S_TYPESCRIPT) {
                  return stmt; // This was just a type annotation
                }

                // Use the statement name if present, since it's a better name
                let defaultName;
                if (stmt.data.k === S_FUNCTION && stmt.data.fn.name !== null) {
                  defaultName = new LocRef(defaultLoc, stmt.data.fn.name.ref);
                } else {
                  defaultName = createDefaultName();
                }

                return new Stmt(new SExportDefault(stmt, defaultName), loc);
              }

              const defaultName = createDefaultName();
              const expr = p.parseSuffix(p.parseAsyncPrefixExpr(asyncRange, LComma, 0), LComma, null, 0);
              p.lexer.expectOrInsertSemicolon();
              return new Stmt(new SExportDefault(new Stmt(new SExpr(expr), loc), defaultName), loc);
            }

            // "export default class {}"
            // "export default class Foo {}"
            // "export default @x class {}"
            // "export default @x class Foo {}"
            // "export default function() {}"
            // "export default function foo() {}"
            // "export default interface Foo {}"
            // "export default interface + 1"
            if (
              p.lexer.token === TFunction ||
              p.lexer.token === TClass ||
              p.lexer.token === TAt ||
              (p.options.ts.parse && p.lexer.isContextualKeyword("interface"))
            ) {
              const defOpts = new parseStmtOpts();
              defOpts.deferredDecorators = opts.deferredDecorators;
              defOpts.isNameOptional = true;
              defOpts.isExportDefault = true;
              defOpts.lexicalDecl = lexicalDeclAllowAll;
              defOpts.hasNoSideEffectsComment = opts.hasNoSideEffectsComment;
              const stmt = p.parseStmt(defOpts);

              // Use the statement name if present, since it's a better name
              let defaultName;
              const s = stmt.data;
              switch (s.k) {
                case S_TYPESCRIPT:
                case S_EXPR:
                  return stmt; // Handle the "interface" case above
                case S_FUNCTION:
                  if (s.fn.name !== null) {
                    defaultName = new LocRef(defaultLoc, s.fn.name.ref);
                  } else {
                    defaultName = createDefaultName();
                  }
                  break;
                case S_CLASS:
                  if (s.class.name !== null) {
                    defaultName = new LocRef(defaultLoc, s.class.name.ref);
                  } else {
                    defaultName = createDefaultName();
                  }
                  break;
                default:
                  bail(); // Go: panic("Internal error")
              }
              return new Stmt(new SExportDefault(stmt, defaultName), loc);
            }

            const isIdentifier = p.lexer.token === TIdentifier;
            const name = p.lexer.identifier;
            const expr = p.parseExpr(LComma);

            // "export default abstract class {}"
            // "export default abstract class Foo {}"
            if (p.options.ts.parse && isIdentifier && name === "abstract" && !p.lexer.hasNewlineBefore) {
              if (expr.data.k === E_IDENTIFIER && p.lexer.token === TClass) {
                const classOpts = new parseStmtOpts();
                classOpts.deferredDecorators = opts.deferredDecorators;
                classOpts.isNameOptional = true;
                const stmt = p.parseClassStmt(loc, classOpts);

                // Use the statement name if present, since it's a better name
                let defaultName;
                if (stmt.data.k === S_CLASS && stmt.data.class.name !== null) {
                  defaultName = new LocRef(defaultLoc, stmt.data.class.name.ref);
                } else {
                  defaultName = createDefaultName();
                }

                return new Stmt(new SExportDefault(stmt, defaultName), loc);
              }
            }

            p.lexer.expectOrInsertSemicolon();
            const defaultName = createDefaultName();
            return new Stmt(new SExportDefault(new Stmt(new SExpr(expr), loc), defaultName), loc);
          }

          case TAsterisk: {
            if (!opts.isModuleScope && (!opts.isNamespaceScope || !opts.isTypeScriptDeclare)) {
              p.lexer.unexpected();
            }

            p.lexer.next();
            let namespaceRef;
            let alias = null;
            let pathRange;
            let pathText;
            let assertOrWith;
            let flags;

            if (p.lexer.isContextualKeyword("as")) {
              // "export * as ns from 'path'"
              p.lexer.next();
              const name = p.parseClauseAlias("export");
              namespaceRef = p.storeNameInRef(name);
              alias = new ExportStarAlias(name, p.lexer.loc());
              p.lexer.next();
              p.lexer.expectContextualKeyword("from");
              [pathRange, pathText, assertOrWith, flags] = p.parsePath();
            } else {
              // "export * from 'path'"
              p.lexer.expectContextualKeyword("from");
              [pathRange, pathText, assertOrWith, flags] = p.parsePath();
              const name = generateNonUniqueNameFromPath(pathText) + "_star";
              namespaceRef = p.storeNameInRef(name);
            }
            const importRecordIndex = p.addImportRecord(ImportStmt, EvaluationPhase, pathRange, pathText, assertOrWith, flags);

            // Export-star statements anywhere in the file disable top-level const
            // local prefix because import cycles can be used to trigger TDZ
            p.currentScope.isAfterConstLocalPrefix = true;

            p.lexer.expectOrInsertSemicolon();
            return new Stmt(new SExportStar(alias, namespaceRef, importRecordIndex), loc);
          }

          case TOpenBrace: {
            if (!opts.isModuleScope && (!opts.isNamespaceScope || !opts.isTypeScriptDeclare)) {
              p.lexer.unexpected();
            }

            const $d122 = p.parseExportClause();
            const items = $d122[0], isSingleLine = $d122[1];
            if (p.lexer.isContextualKeyword("from")) {
              // "export {} from 'path'"
              p.lexer.next();
              const $d123 = p.parsePath();
              const pathLoc = $d123[0], pathText = $d123[1], assertOrWith = $d123[2], flags = $d123[3];
              const importRecordIndex = p.addImportRecord(ImportStmt, EvaluationPhase, pathLoc, pathText, assertOrWith, flags);
              const name = "import_" + generateNonUniqueNameFromPath(pathText);
              const namespaceRef = p.storeNameInRef(name);

              // Export clause statements anywhere in the file disable top-level const
              // local prefix because import cycles can be used to trigger TDZ
              p.currentScope.isAfterConstLocalPrefix = true;

              p.lexer.expectOrInsertSemicolon();
              return new Stmt(new SExportFrom(items, namespaceRef, importRecordIndex, isSingleLine), loc);
            }

            p.lexer.expectOrInsertSemicolon();
            return new Stmt(new SExportClause(items, isSingleLine), loc);
          }

          case TEquals:
            // "export = value;"
            p.esmExportKeyword = previousExportKeyword; // This wasn't an ESM export statement after all
            if (p.options.ts.parse) {
              p.lexer.next();
              const value = p.parseExpr(LLowest);
              p.lexer.expectOrInsertSemicolon();
              return new Stmt(new SExportEquals(value), loc);
            }
            p.lexer.unexpected();
            return null;

          default:
            p.lexer.unexpected();
            return null;
        }
      }

      case TFunction:
        p.lexer.next();
        return p.parseFnStmt(loc, opts, false /* isAsync */, RANGE_ZERO);

      case TEnum:
        if (!p.options.ts.parse) {
          p.lexer.unexpected();
        }
        return p.parseTypeScriptEnumStmt(loc, opts);

      case TAt: {
        // Parse decorators before class statements, which are potentially exported
        const scopeIndex = p.scopesInOrder.length;
        const decorators = p.parseDecorators(p.currentScope, RANGE_ZERO, 0);

        // "@x export @y class Foo {}"
        if (opts.deferredDecorators !== null) {
          p.log.addError(); // Decorators are not valid here
          p.discardScopesUpTo(scopeIndex);
          return p.parseStmt(opts);
        }

        // If this turns out to be a "declare class" statement, we need to undo the
        // scopes that were potentially pushed while parsing the decorator arguments.
        // That can look like any one of the following:
        //
        //   "@decorator declare class Foo {}"
        //   "@decorator declare abstract class Foo {}"
        //   "@decorator export declare class Foo {}"
        //   "@decorator export declare abstract class Foo {}"
        //
        if (!ownsOpts) {
          opts = opts.clone();
          ownsOpts = true;
        }
        opts.deferredDecorators = new deferredDecorators(decorators);

        let stmt = p.parseStmt(opts);

        // Check for valid decorator targets
        const s = stmt.data;
        switch (s.k) {
          case S_CLASS:
            return stmt;

          case S_EXPORT_DEFAULT:
            if (s.value.data.k === S_CLASS) {
              return stmt;
            }
            break;

          case S_TYPESCRIPT:
            if (s.wasDeclareClass) {
              // If this is a type declaration, discard any scopes that were pushed
              // while parsing decorators. Unlike with the class statements above,
              // these scopes won't end up being visited during the upcoming visit
              // pass because type declarations aren't visited at all.
              p.discardScopesUpTo(scopeIndex);
              return stmt;
            }
            break;
        }

        // Forbid decorators on anything other than a class statement
        p.log.addError(); // Decorators are not valid here
        stmt = new Stmt(STypeScriptShared, stmt.loc);
        p.discardScopesUpTo(scopeIndex);
        return stmt;
      }

      case TClass:
        if (opts.lexicalDecl !== lexicalDeclAllowAll) {
          p.forbidLexicalDecl(loc);
        }
        return p.parseClassStmt(loc, opts);

      case TVar: {
        p.lexer.next();
        const decls = p.parseAndDeclareDecls(SymbolHoisted, opts);
        p.lexer.expectOrInsertSemicolon();
        return new Stmt(new SLocal(decls, LocalVar, opts.isExport), loc);
      }

      case TConst: {
        if (opts.lexicalDecl !== lexicalDeclAllowAll) {
          p.forbidLexicalDecl(loc);
        }
        // p.markSyntaxFeature(compat.ConstAndLet, ...): no-op (esnext)
        p.lexer.next();

        if (p.options.ts.parse && p.lexer.token === TEnum) {
          return p.parseTypeScriptEnumStmt(loc, opts);
        }

        const decls = p.parseAndDeclareDecls(SymbolConst, opts);
        p.lexer.expectOrInsertSemicolon();
        if (!opts.isTypeScriptDeclare) {
          p.requireInitializers(LocalConst, decls);
        }
        return new Stmt(new SLocal(decls, LocalConst, opts.isExport), loc);
      }

      case TIf: {
        p.lexer.next();
        p.lexer.expect(TOpenParen);
        const test = p.parseExpr(LLowest);
        p.lexer.expect(TCloseParen);
        const isSingleLineYes = !p.lexer.hasNewlineBefore && p.lexer.token !== TOpenBrace;
        const yes = p.parseStmt(new parseStmtOpts(null, lexicalDeclAllowFnInsideIf));
        let noOrNil = null;
        let isSingleLineNo = false;
        if (p.lexer.token === TElse) {
          p.lexer.next();
          isSingleLineNo = !p.lexer.hasNewlineBefore && p.lexer.token !== TOpenBrace;
          noOrNil = p.parseStmt(new parseStmtOpts(null, lexicalDeclAllowFnInsideIf));
        }
        return new Stmt(new SIf(test, yes, noOrNil, isSingleLineYes, isSingleLineNo), loc);
      }

      case TDo: {
        p.lexer.next();
        const body = p.parseStmt(new parseStmtOpts());
        p.lexer.expect(TWhile);
        p.lexer.expect(TOpenParen);
        const test = p.parseExpr(LLowest);
        p.lexer.expect(TCloseParen);

        // This is a weird corner case where automatic semicolon insertion applies
        // even without a newline present
        if (p.lexer.token === TSemicolon) {
          p.lexer.next();
        }
        return new Stmt(new SDoWhile(body, test), loc);
      }

      case TWhile: {
        p.lexer.next();
        p.lexer.expect(TOpenParen);
        const test = p.parseExpr(LLowest);
        p.lexer.expect(TCloseParen);
        const isSingleLineBody = !p.lexer.hasNewlineBefore && p.lexer.token !== TOpenBrace;
        const body = p.parseStmt(new parseStmtOpts());
        return new Stmt(new SWhile(test, body, isSingleLineBody), loc);
      }

      case TWith: {
        p.lexer.next();
        p.lexer.expect(TOpenParen);
        const test = p.parseExpr(LLowest);
        const bodyLoc = p.lexer.loc();
        p.lexer.expect(TCloseParen);

        // Push a scope so we make sure to prevent any bare identifiers referenced
        // within the body from being renamed. Renaming them might change the
        // semantics of the code.
        p.pushScopeForParsePass(ScopeWith, bodyLoc);
        const isSingleLineBody = !p.lexer.hasNewlineBefore && p.lexer.token !== TOpenBrace;
        const body = p.parseStmt(new parseStmtOpts());
        p.popScope();

        return new Stmt(new SWith(test, body, bodyLoc, isSingleLineBody), loc);
      }

      case TSwitch: {
        p.lexer.next();
        p.lexer.expect(TOpenParen);
        const test = p.parseExpr(LLowest);
        p.lexer.expect(TCloseParen);

        const bodyLoc = p.lexer.loc();
        p.pushScopeForParsePass(ScopeBlock, bodyLoc);
        try {
          p.lexer.expect(TOpenBrace);
          const cases = [];
          let foundDefault = false;
          const switchScopeStart = p.scopesInOrder.length;
          let caseScopeMap = null;

          while (p.lexer.token !== TCloseBrace) {
            let value = null;
            const body = [];
            const caseLoc = p.saveExprCommentsHere();
            let caseScopeStart = p.scopesInOrder.length;

            if (p.lexer.token === TDefault) {
              if (foundDefault) {
                p.log.addError(); // Multiple default clauses are not allowed
                throw LEXER_PANIC;
              }
              foundDefault = true;
              p.lexer.next();
              p.lexer.expect(TColon);
            } else {
              p.lexer.expect(TCase);
              value = p.parseExpr(LLowest);
              p.lexer.expect(TColon);
            }

            // Keep track of any scopes created by case values. This can happen if
            // code uses anonymous functions inside a case value. For example:
            //
            //   switch (x) {
            //     case y.map(z => -z).join(':'):
            //       return y
            //   }
            //
            if (caseScopeStart < p.scopesInOrder.length) {
              if (caseScopeMap === null) {
                caseScopeMap = new Set();
              }
              for (;;) {
                caseScopeMap.add(p.scopesInOrder[caseScopeStart].scope);
                caseScopeStart++;
                if (caseScopeStart === p.scopesInOrder.length) {
                  break;
                }
              }
            }

            // caseBody:
            while (p.lexer.token !== TCloseBrace && p.lexer.token !== TCase && p.lexer.token !== TDefault) {
              const bodyOpts = new parseStmtOpts(null, lexicalDeclAllowAll);
              bodyOpts.isCaseBody = true;
              body.push(p.parseStmt(bodyOpts));
            }

            cases.push(new Case(value, body, caseLoc));
          }

          // If any case contains values that create a scope, reorder those scopes to
          // come first before any scopes created by case bodies. This reflects the
          // order in which we will visit the AST in our second parsing pass. The
          // second parsing pass visits things in a different order because it uses
          // case values to determine liveness, and then uses the liveness information
          // when visiting the case bodies (e.g. avoid "require()" calls in dead code).
          // For example:
          //
          //   switch (1) {
          //     case y(() => 1):
          //       z = () => 2;
          //       break;
          //
          //     case y(() => 3):
          //       z = () => 4;
          //       break;
          //   }
          //
          // This is parsed in the order 1,2,3,4 but visited in the order 1,3,2,4.
          if (caseScopeMap !== null && caseScopeMap.size > 0) {
            const caseScopes = [];
            const bodyScopes = [];
            for (let i = switchScopeStart; i < p.scopesInOrder.length; i++) {
              const it = p.scopesInOrder[i];
              if (caseScopeMap.has(it.scope)) {
                caseScopes.push(it);
              } else {
                bodyScopes.push(it);
              }
            }
            // copy(p.scopesInOrder[switchScopeStart:switchScopeStart+len(caseScopeMap)], caseScopes)
            const n = caseScopeMap.size;
            const scopesInOrder = p.scopesInOrder;
            const n1 = Math.min(n, caseScopes.length);
            for (let i = 0; i < n1; i++) {
              scopesInOrder[switchScopeStart + i] = caseScopes[i];
            }
            // copy(p.scopesInOrder[switchScopeStart+len(caseScopeMap):], bodyScopes)
            const n2 = Math.min(scopesInOrder.length - (switchScopeStart + n), bodyScopes.length);
            for (let i = 0; i < n2; i++) {
              scopesInOrder[switchScopeStart + n + i] = bodyScopes[i];
            }
          }

          const closeBraceLoc = p.lexer.loc();
          p.lexer.expect(TCloseBrace);
          return new Stmt(new SSwitch(test, cases, bodyLoc, closeBraceLoc), loc);
        } finally {
          p.popScope(); // Go: "defer p.popScope()"
        }
      }

      case TTry: {
        p.lexer.next();
        const blockLoc = p.lexer.loc();
        p.lexer.expect(TOpenBrace);
        p.pushScopeForParsePass(ScopeBlock, loc);
        const body = p.parseStmtsUpTo(TCloseBrace, new parseStmtOpts());
        p.popScope();
        const closeBraceLoc = p.lexer.loc();
        p.lexer.next();

        let catch_ = null;
        let finally_ = null;

        if (p.lexer.token === TCatch) {
          const catchLoc = p.lexer.loc();
          p.pushScopeForParsePass(ScopeCatchBinding, catchLoc);
          p.lexer.next();
          let bindingOrNil = null;

          // The catch binding is optional, and can be omitted
          if (p.lexer.token === TOpenBrace) {
            // (Generating a catch binding for older browsers only happens when
            // compat.OptionalCatchBinding is unsupported, never with esnext)
          } else {
            p.lexer.expect(TOpenParen);
            bindingOrNil = p.parseBinding(new parseBindingOpts());

            // Skip over types
            if (p.options.ts.parse && p.lexer.token === TColon) {
              p.lexer.expect(TColon);
              p.skipTypeScriptType(LLowest);
            }

            p.lexer.expect(TCloseParen);

            // Bare identifiers are a special case
            let kind = SymbolOther;
            if (bindingOrNil.data.k === B_IDENTIFIER) {
              kind = SymbolCatchIdentifier;
            }
            p.declareBinding(kind, bindingOrNil, new parseStmtOpts());
          }

          const blockLoc = p.lexer.loc();
          p.lexer.expect(TOpenBrace);

          p.pushScopeForParsePass(ScopeBlock, blockLoc);
          const stmts = p.parseStmtsUpTo(TCloseBrace, new parseStmtOpts());
          p.popScope();

          const closeBraceLoc = p.lexer.loc();
          p.lexer.next();
          catch_ = new Catch(bindingOrNil, new SBlock(stmts, closeBraceLoc), catchLoc, blockLoc);
          p.popScope();
        }

        if (p.lexer.token === TFinally || catch_ === null) {
          const finallyLoc = p.lexer.loc();
          p.pushScopeForParsePass(ScopeBlock, finallyLoc);
          p.lexer.expect(TFinally);
          p.lexer.expect(TOpenBrace);
          const stmts = p.parseStmtsUpTo(TCloseBrace, new parseStmtOpts());
          const closeBraceLoc = p.lexer.loc();
          p.lexer.next();
          finally_ = new Finally(new SBlock(stmts, closeBraceLoc), finallyLoc);
          p.popScope();
        }

        return new Stmt(new STry(catch_, finally_, new SBlock(body, closeBraceLoc), blockLoc), loc);
      }

      case TFor: {
        p.pushScopeForParsePass(ScopeBlock, loc);
        try {
          p.lexer.next();

          // "for await (let x of y) {}"
          let awaitRange = RANGE_ZERO;
          if (p.lexer.isContextualKeyword("await")) {
            awaitRange = p.lexer.range();
            if (p.fnOrArrowDataParse.await !== allowExpr) {
              p.log.addError(); // Cannot use "await" outside an async function
              awaitRange = RANGE_ZERO;
            } else {
              if (p.fnOrArrowDataParse.isTopLevel) {
                p.topLevelAwaitKeyword = awaitRange;
              }
              // (for-await lowering only matters when async/await and generators
              // are unsupported, never with esnext)
            }
            p.lexer.next();
          }

          p.lexer.expect(TOpenParen);

          let initOrNil = null;
          let testOrNil = null;
          let updateOrNil = null;

          // "in" expressions aren't allowed here
          p.allowIn = false;

          let badLetRange = RANGE_ZERO;
          if (p.lexer.isContextualKeyword("let")) {
            badLetRange = p.lexer.range();
          }
          let decls = [];
          const initLoc = p.lexer.loc();
          let isVar = false;
          switch (p.lexer.token) {
            case TVar:
              isVar = true;
              p.lexer.next();
              decls = p.parseAndDeclareDecls(SymbolHoisted, new parseStmtOpts());
              initOrNil = new Stmt(new SLocal(decls, LocalVar), initLoc);
              break;

            case TConst:
              // p.markSyntaxFeature(compat.ConstAndLet, ...): no-op (esnext)
              p.lexer.next();
              decls = p.parseAndDeclareDecls(SymbolConst, new parseStmtOpts());
              initOrNil = new Stmt(new SLocal(decls, LocalConst), initLoc);
              break;

            case TSemicolon:
              break;

            default: {
              const initOpts = new parseStmtOpts(null, lexicalDeclAllowAll);
              initOpts.isForLoopInit = true;
              initOpts.isForAwaitLoopInit = awaitRange.len > 0;
              const $d124 = p.parseExprOrLetOrUsingStmt(initOpts);
              const expr = $d124[0], stmt = $d124[1], decls2 = $d124[2];
              decls = decls2;
              if (stmt !== null) {
                badLetRange = RANGE_ZERO;
                initOrNil = stmt;
              } else {
                initOrNil = new Stmt(new SExpr(expr), expr.loc);
              }
            }
          }

          // "in" expressions are allowed again
          p.allowIn = true;

          // Detect for-of loops
          if (p.lexer.isContextualKeyword("of") || awaitRange.len > 0) {
            if (badLetRange.len > 0) {
              p.log.addError(); // "let" must be wrapped in parentheses to be used as an expression here:
            }
            if (awaitRange.len > 0 && !p.lexer.isContextualKeyword("of")) {
              if (initOrNil !== null) {
                p.lexer.expectedString('"of"');
              } else {
                p.lexer.unexpected();
              }
            }
            p.forbidInitializers(decls, "of", false);
            // p.markSyntaxFeature(compat.ForOf, ...): no-op (esnext)
            p.lexer.next();
            const value = p.parseExpr(LComma);
            p.lexer.expect(TCloseParen);
            const isSingleLineBody = !p.lexer.hasNewlineBefore && p.lexer.token !== TOpenBrace;
            const body = p.parseStmt(new parseStmtOpts());
            return new Stmt(new SForOf(initOrNil, value, body, awaitRange, isSingleLineBody), loc);
          }

          // Detect for-in loops
          if (p.lexer.token === TIn) {
            p.forbidInitializers(decls, "in", isVar);
            if (decls.length === 1) {
              if (initOrNil !== null && initOrNil.data.k === S_LOCAL) {
                const local = initOrNil.data;
                if (local.kind === LocalUsing) {
                  p.log.addError(); // "using" declarations are not allowed here
                } else if (local.kind === LocalAwaitUsing) {
                  p.log.addError(); // "await using" declarations are not allowed here
                }
              }
            }
            p.lexer.next();
            const value = p.parseExpr(LLowest);
            p.lexer.expect(TCloseParen);
            const isSingleLineBody = !p.lexer.hasNewlineBefore && p.lexer.token !== TOpenBrace;
            const body = p.parseStmt(new parseStmtOpts());
            return new Stmt(new SForIn(initOrNil, value, body, isSingleLineBody), loc);
          }

          p.lexer.expect(TSemicolon);

          // "await using" declarations are only allowed in for-of loops
          if (initOrNil !== null && initOrNil.data.k === S_LOCAL && initOrNil.data.kind === LocalAwaitUsing) {
            p.log.addError(); // "await using" declarations are not allowed here
          }

          // Only require "const" statement initializers when we know we're a normal for loop
          if (initOrNil !== null && initOrNil.data.k === S_LOCAL) {
            const local = initOrNil.data;
            if (local.kind === LocalConst || local.kind === LocalUsing) {
              p.requireInitializers(local.kind, decls);
            }
          }

          if (p.lexer.token !== TSemicolon) {
            testOrNil = p.parseExpr(LLowest);
          }

          p.lexer.expect(TSemicolon);

          if (p.lexer.token !== TCloseParen) {
            updateOrNil = p.parseExpr(LLowest);
          }

          p.lexer.expect(TCloseParen);
          const isSingleLineBody = !p.lexer.hasNewlineBefore && p.lexer.token !== TOpenBrace;
          const body = p.parseStmt(new parseStmtOpts());
          return new Stmt(new SFor(initOrNil, testOrNil, updateOrNil, body, isSingleLineBody), loc);
        } finally {
          p.popScope(); // Go: "defer p.popScope()"
        }
      }

      case TImport: {
        const previousImportStatementKeyword = p.esmImportStatementKeyword;
        p.esmImportStatementKeyword = p.lexer.range();
        p.lexer.next();
        const stmt = new SImport();
        let phase = EvaluationPhase;
        let wasOriginallyBareImport = false;

        // "export import foo = bar"
        // "import foo = bar" in a namespace
        if ((opts.isExport || (opts.isNamespaceScope && !opts.isTypeScriptDeclare)) && p.lexer.token !== TIdentifier) {
          p.lexer.expected(TIdentifier);
        }

        syntaxBeforePath: switch (p.lexer.token) {
          case TOpenParen:
          case TDot: {
            // "import('path')"
            // "import.meta"
            p.esmImportStatementKeyword = previousImportStatementKeyword; // This wasn't an ESM import statement after all
            const expr = p.parseSuffix(p.parseImportExpr(loc, LLowest), LLowest, null, 0);
            p.lexer.expectOrInsertSemicolon();
            return new Stmt(new SExpr(expr), loc);
          }

          case TStringLiteral:
          case TNoSubstitutionTemplateLiteral:
            // "import 'path'"
            if (!opts.isModuleScope && (!opts.isNamespaceScope || !opts.isTypeScriptDeclare)) {
              p.lexer.unexpected();
              return null;
            }

            wasOriginallyBareImport = true;
            break;

          case TAsterisk: {
            // "import * as ns from 'path'"
            if (!opts.isModuleScope && (!opts.isNamespaceScope || !opts.isTypeScriptDeclare)) {
              p.lexer.unexpected();
              return null;
            }

            p.lexer.next();
            p.lexer.expectContextualKeyword("as");
            stmt.namespaceRef = p.storeNameInRef(p.lexer.identifier);
            const starLoc = p.lexer.loc();
            stmt.starNameLoc = starLoc;
            p.lexer.expect(TIdentifier);
            p.lexer.expectContextualKeyword("from");
            break;
          }

          case TOpenBrace: {
            // "import {item1, item2} from 'path'"
            if (!opts.isModuleScope && (!opts.isNamespaceScope || !opts.isTypeScriptDeclare)) {
              p.lexer.unexpected();
              return null;
            }

            const $d125 = p.parseImportClause();
            const items = $d125[0], isSingleLine = $d125[1];
            stmt.items = items;
            stmt.isSingleLine = isSingleLine;
            p.lexer.expectContextualKeyword("from");
            break;
          }

          case TIdentifier: {
            // "import defaultItem from 'path'"
            // "import foo = bar"
            if (!opts.isModuleScope && !opts.isNamespaceScope) {
              p.lexer.unexpected();
              return null;
            }

            const defaultName = p.lexer.identifier;
            const defaultLoc = p.lexer.loc();
            const isDeferName = p.lexer.raw() === "defer";
            const isSourceName = p.lexer.raw() === "source";
            p.lexer.next();

            if (isDeferName && p.lexer.token === TAsterisk) {
              // "import defer * as foo from 'bar';"
              // p.markSyntaxFeature(compat.ImportDefer, ...): no-op (esnext)
              phase = DeferPhase;
              p.lexer.next();
              p.lexer.expectContextualKeyword("as");
              stmt.namespaceRef = p.storeNameInRef(p.lexer.identifier);
              const starLoc = p.lexer.loc();
              stmt.starNameLoc = starLoc;
              p.lexer.expect(TIdentifier);
              p.lexer.expectContextualKeyword("from");
              break;
            }

            if (isSourceName && p.lexer.token === TIdentifier) {
              if (p.lexer.raw() === "from") {
                const nameSubstring = p.lexer.identifier;
                const nameLoc = p.lexer.loc();
                p.lexer.next();
                if (p.lexer.isContextualKeyword("from")) {
                  // "import source from from 'foo';"
                  // p.markSyntaxFeature(compat.ImportSource, ...): no-op (esnext)
                  phase = SourcePhase;
                  stmt.defaultName = new LocRef(nameLoc, p.storeNameInRef(nameSubstring));
                  p.lexer.next();
                } else {
                  // "import source from 'foo';"
                  stmt.defaultName = new LocRef(defaultLoc, p.storeNameInRef(defaultName));
                }
                break;
              }

              // "import source foo from 'bar';"
              // p.markSyntaxFeature(compat.ImportSource, ...): no-op (esnext)
              phase = SourcePhase;
              stmt.defaultName = new LocRef(p.lexer.loc(), p.storeNameInRef(p.lexer.identifier));
              p.lexer.next();
              p.lexer.expectContextualKeyword("from");
              break;
            }

            stmt.defaultName = new LocRef(defaultLoc, p.storeNameInRef(defaultName));

            if (p.options.ts.parse) {
              // Skip over type-only imports
              if (defaultName === "type") {
                switch (p.lexer.token) {
                  case TIdentifier: {
                    const nameSubstring = p.lexer.identifier;
                    const nameLoc = p.lexer.loc();
                    p.lexer.next();
                    if (p.lexer.token === TEquals) {
                      // "import type foo = require('bar');"
                      // "import type foo = bar.baz;"
                      if (!ownsOpts) {
                        opts = opts.clone();
                        ownsOpts = true;
                      }
                      opts.isTypeScriptDeclare = true;
                      return p.parseTypeScriptImportEqualsStmt(loc, opts, nameLoc, nameSubstring);
                    } else if (p.lexer.token === TStringLiteral && nameSubstring === "from") {
                      // "import type from 'bar';"
                      break syntaxBeforePath;
                    } else {
                      // "import type foo from 'bar';"
                      p.lexer.expectContextualKeyword("from");
                      p.parsePath();
                      p.lexer.expectOrInsertSemicolon();
                      return new Stmt(STypeScriptShared, loc);
                    }
                  }

                  case TAsterisk:
                    // "import type * as foo from 'bar';"
                    p.lexer.next();
                    p.lexer.expectContextualKeyword("as");
                    p.lexer.expect(TIdentifier);
                    p.lexer.expectContextualKeyword("from");
                    p.parsePath();
                    p.lexer.expectOrInsertSemicolon();
                    return new Stmt(STypeScriptShared, loc);

                  case TOpenBrace:
                    // "import type {foo} from 'bar';"
                    p.parseImportClause();
                    p.lexer.expectContextualKeyword("from");
                    p.parsePath();
                    p.lexer.expectOrInsertSemicolon();
                    return new Stmt(STypeScriptShared, loc);
                }
              }

              // Parse TypeScript import assignment statements
              if (p.lexer.token === TEquals || opts.isExport || (opts.isNamespaceScope && !opts.isTypeScriptDeclare)) {
                p.esmImportStatementKeyword = previousImportStatementKeyword; // This wasn't an ESM import statement after all
                return p.parseTypeScriptImportEqualsStmt(loc, opts, stmt.defaultName.loc, defaultName);
              }
            }

            if (p.lexer.token === TComma) {
              p.lexer.next();
              switch (p.lexer.token) {
                case TAsterisk: {
                  // "import defaultItem, * as ns from 'path'"
                  p.lexer.next();
                  p.lexer.expectContextualKeyword("as");
                  stmt.namespaceRef = p.storeNameInRef(p.lexer.identifier);
                  const starLoc = p.lexer.loc();
                  stmt.starNameLoc = starLoc;
                  p.lexer.expect(TIdentifier);
                  break;
                }

                case TOpenBrace: {
                  // "import defaultItem, {item1, item2} from 'path'"
                  const $d126 = p.parseImportClause();
                  const items = $d126[0], isSingleLine = $d126[1];
                  stmt.items = items;
                  stmt.isSingleLine = isSingleLine;
                  break;
                }

                default:
                  p.lexer.unexpected();
              }
            }

            p.lexer.expectContextualKeyword("from");
            break;
          }

          default:
            p.lexer.unexpected();
            return null;
        }

        const $d127 = p.parsePath();
        let pathLoc = $d127[0], pathText = $d127[1], assertOrWith = $d127[2], flags = $d127[3];
        p.lexer.expectOrInsertSemicolon();

        // If TypeScript's "preserveValueImports": true setting is active, TypeScript's
        // "importsNotUsedAsValues": "preserve" setting is NOT active, and the import
        // clause is present and empty (or is non-empty but filled with type-only
        // items), then the import statement should still be removed entirely to match
        // the behavior of the TypeScript compiler:
        //
        //   // Keep these
        //   import 'x'
        //   import { y } from 'x'
        //   import { y, type z } from 'x'
        //
        //   // Remove these
        //   import {} from 'x'
        //   import { type y } from 'x'
        //
        //   // Remove the items from these
        //   import d, {} from 'x'
        //   import d, { type y } from 'x'
        //
        if (
          p.options.ts.parse &&
          p.options.ts.config.unusedImportFlags() === TSUnusedImport_KeepValues &&
          stmt.items !== null &&
          stmt.items.length === 0
        ) {
          if (stmt.defaultName === null) {
            return new Stmt(STypeScriptShared, loc);
          }
          stmt.items = null;
        }

        if (wasOriginallyBareImport) {
          flags |= WasOriginallyBareImport;
        }
        stmt.importRecordIndex = p.addImportRecord(ImportStmt, phase, pathLoc, pathText, assertOrWith, flags);

        if (stmt.starNameLoc !== null) {
          const name = p.loadNameFromRef(stmt.namespaceRef);
          stmt.namespaceRef = p.declareSymbol(SymbolImport, stmt.starNameLoc, name);
        } else {
          // Generate a symbol for the namespace
          const name = "import_" + generateNonUniqueNameFromPath(pathText);
          stmt.namespaceRef = p.newSymbol(SymbolOther, name);
          p.currentScope.generated.push(stmt.namespaceRef);
        }
        const itemRefs = new Map();

        // Link the default item to the namespace
        if (stmt.defaultName !== null) {
          const name = p.loadNameFromRef(stmt.defaultName.ref);
          const ref = p.declareSymbol(SymbolImport, stmt.defaultName.loc, name);
          p.isImportItem.set(ref, true);
          stmt.defaultName = new LocRef(stmt.defaultName.loc, ref);
        }

        // Link each import item to the namespace
        if (stmt.items !== null) {
          const items = stmt.items;
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const name = p.loadNameFromRef(item.name.ref);
            const ref = p.declareSymbol(SymbolImport, item.name.loc, name);
            p.checkForUnrepresentableIdentifier(item.aliasLoc, item.alias);
            p.isImportItem.set(ref, true);
            item.name = new LocRef(item.name.loc, ref);
            itemRefs.set(item.alias, new LocRef(item.name.loc, ref));
          }
        }

        // Track the items for this namespace
        p.importItemsForNamespace.set(stmt.namespaceRef, new namespaceImportItems(itemRefs, stmt.importRecordIndex));

        // Import statements anywhere in the file disable top-level const
        // local prefix because import cycles can be used to trigger TDZ
        p.currentScope.isAfterConstLocalPrefix = true;
        return new Stmt(stmt, loc);
      }

      case TBreak: {
        p.lexer.next();
        const name = p.parseLabelName();
        p.lexer.expectOrInsertSemicolon();
        return new Stmt(new SBreak(name), loc);
      }

      case TContinue: {
        p.lexer.next();
        const name = p.parseLabelName();
        p.lexer.expectOrInsertSemicolon();
        return new Stmt(new SContinue(name), loc);
      }

      case TReturn: {
        if (p.fnOrArrowDataParse.isReturnDisallowed) {
          p.log.addError(); // A return statement cannot be used here:
        }
        p.lexer.next();
        let value = null;
        if (
          p.lexer.token !== TSemicolon &&
          !p.lexer.hasNewlineBefore &&
          p.lexer.token !== TCloseBrace &&
          p.lexer.token !== TEndOfFile
        ) {
          value = p.parseExpr(LLowest);
        }
        p.latestReturnHadSemicolon = p.lexer.token === TSemicolon;
        p.lexer.expectOrInsertSemicolon();
        return new Stmt(new SReturn(value), loc);
      }

      case TThrow: {
        p.lexer.next();
        if (p.lexer.hasNewlineBefore) {
          const endLoc = loc + 5;
          p.log.addError(); // Unexpected newline after "throw"
          return new Stmt(new SThrow(new Expr(ENullShared, endLoc)), loc);
        }
        const expr = p.parseExpr(LLowest);
        p.lexer.expectOrInsertSemicolon();
        return new Stmt(new SThrow(expr), loc);
      }

      case TDebugger:
        p.lexer.next();
        p.lexer.expectOrInsertSemicolon();
        return new Stmt(SDebuggerShared, loc);

      case TOpenBrace: {
        p.pushScopeForParsePass(ScopeBlock, loc);
        try {
          p.lexer.next();
          const stmts = p.parseStmtsUpTo(TCloseBrace, new parseStmtOpts());
          const closeBraceLoc = p.lexer.loc();
          p.lexer.next();
          return new Stmt(new SBlock(stmts, closeBraceLoc), loc);
        } finally {
          p.popScope(); // Go: "defer p.popScope()"
        }
      }

      default: {
        const isIdentifier = p.lexer.token === TIdentifier;
        const nameRange = p.lexer.range();
        const name = p.lexer.identifier;

        // Parse either an async function, an async expression, or a normal expression
        let expr;
        if (isIdentifier && p.lexer.isContextualKeyword("async")) { // (Go: p.lexer.Raw() == "async")
          p.lexer.next();
          if (p.lexer.token === TFunction && !p.lexer.hasNewlineBefore) {
            p.lexer.next();
            return p.parseFnStmt(nameRange.loc, opts, true /* isAsync */, nameRange);
          }
          expr = p.parseSuffix(p.parseAsyncPrefixExpr(nameRange, LLowest, 0), LLowest, null, 0);
        } else {
          const result = p.parseExprOrLetOrUsingStmt(opts);
          expr = result[0];
          const stmt = result[1];
          if (stmt !== null) {
            p.lexer.expectOrInsertSemicolon();
            return stmt;
          }
        }

        if (isIdentifier) {
          if (expr.data.k === E_IDENTIFIER) {
            const ident = expr.data;
            if (p.lexer.token === TColon && opts.deferredDecorators === null) {
              p.pushScopeForParsePass(ScopeLabel, loc);
              try {
                // Parse a labeled statement
                p.lexer.next();
                const name = new LocRef(expr.loc, ident.ref);
                const nestedOpts = new parseStmtOpts();
                if (opts.lexicalDecl === lexicalDeclAllowAll || opts.lexicalDecl === lexicalDeclAllowFnInsideLabel) {
                  nestedOpts.lexicalDecl = lexicalDeclAllowFnInsideLabel;
                }
                const isSingleLineStmt = !p.lexer.hasNewlineBefore && p.lexer.token !== TOpenBrace;
                const stmt = p.parseStmt(nestedOpts);
                return new Stmt(new SLabel(stmt, name, isSingleLineStmt), loc);
              } finally {
                p.popScope(); // Go: "defer p.popScope()"
              }
            }

            if (p.options.ts.parse) {
              switch (name) {
                case "type":
                  if (!p.lexer.hasNewlineBefore && p.lexer.token === TIdentifier) {
                    // "type Foo = any"
                    const typeOpts = new parseStmtOpts();
                    typeOpts.isModuleScope = opts.isModuleScope;
                    p.skipTypeScriptTypeStmt(typeOpts);
                    return new Stmt(STypeScriptShared, loc);
                  }
                  break;

                case "namespace":
                case "module":
                  // "namespace Foo {}"
                  // "module Foo {}"
                  // "declare module 'fs' {}"
                  // "declare module 'fs';"
                  if (
                    !p.lexer.hasNewlineBefore &&
                    (opts.isModuleScope || opts.isNamespaceScope) &&
                    (p.lexer.token === TIdentifier || (p.lexer.token === TStringLiteral && opts.isTypeScriptDeclare))
                  ) {
                    return p.parseTypeScriptNamespaceStmt(loc, opts);
                  }
                  break;

                case "interface":
                  // "interface Foo {}"
                  // "export default interface Foo {}"
                  // "export default interface \n Foo {}"
                  if (!p.lexer.hasNewlineBefore || opts.isExportDefault) {
                    const ifaceOpts = new parseStmtOpts();
                    ifaceOpts.isModuleScope = opts.isModuleScope;
                    p.skipTypeScriptInterfaceStmt(ifaceOpts);
                    return new Stmt(STypeScriptShared, loc);
                  }

                  // "interface \n Foo {}"
                  // "export interface \n Foo {}"
                  if (opts.isExport) {
                    p.log.addError(); // Unexpected "interface"
                    throw LEXER_PANIC;
                  }
                  break;

                case "abstract":
                  if (!p.lexer.hasNewlineBefore && p.lexer.token === TClass) {
                    return p.parseClassStmt(loc, opts);
                  }
                  break;

                case "global":
                  // "declare module 'fs' { global { namespace NodeJS {} } }"
                  if (opts.isNamespaceScope && opts.isTypeScriptDeclare && p.lexer.token === TOpenBrace) {
                    p.lexer.next();
                    p.parseStmtsUpTo(TCloseBrace, opts);
                    p.lexer.next();
                    return new Stmt(STypeScriptShared, loc);
                  }
                  break;

                case "declare":
                  if (!p.lexer.hasNewlineBefore) {
                    if (!ownsOpts) {
                      opts = opts.clone();
                      ownsOpts = true;
                    }
                    opts.lexicalDecl = lexicalDeclAllowAll;
                    if (!ownsOpts) {
                      opts = opts.clone();
                      ownsOpts = true;
                    }
                    opts.isTypeScriptDeclare = true;

                    // "declare global { ... }"
                    if (p.lexer.isContextualKeyword("global")) {
                      p.lexer.next();
                      p.lexer.expect(TOpenBrace);
                      p.parseStmtsUpTo(TCloseBrace, opts);
                      p.lexer.next();
                      return new Stmt(STypeScriptShared, loc);
                    }

                    // "declare const x: any"
                    const scopeIndex = p.scopesInOrder.length;
                    const oldLexer = p.lexer.clone();
                    const stmt = p.parseStmt(opts);
                    let typeDeclarationData = STypeScriptShared;
                    const s = stmt.data;
                    switch (s.k) {
                      case S_EMPTY:
                        return new Stmt(new SExpr(expr), loc);

                      case S_TYPESCRIPT:
                        // Type declarations are expected. Propagate the "declare class"
                        // status in case our caller is a decorator that needs to know
                        // this was a "declare class" statement.
                        typeDeclarationData = s;
                        break;

                      case S_LOCAL:
                        // This is also a type declaration (but doesn't use "STypeScript"
                        // because we need to be able to handle namespace exports below)
                        break;

                      default:
                        // Anything that we don't expect is a syntax error. For example,
                        // we consider this a syntax error:
                        //
                        //   declare let declare: any, foo: any
                        //   declare foo
                        //
                        // Strangely TypeScript allows this code starting with version
                        // 4.4, but I assume this is a bug. This bug was reported here:
                        // https://github.com/microsoft/TypeScript/issues/54602
                        p.lexer = oldLexer;
                        p.lexer.unexpected();
                    }
                    p.discardScopesUpTo(scopeIndex);

                    // Unlike almost all uses of "declare", statements that use
                    // "export declare" with "var/let/const" inside a namespace affect
                    // code generation. They cause any declared bindings to be
                    // considered exports of the namespace. Identifier references to
                    // those names must be converted into property accesses off the
                    // namespace object:
                    //
                    //   namespace ns {
                    //     export declare const x
                    //     export function y() { return x }
                    //   }
                    //
                    //   (ns as any).x = 1
                    //   console.log(ns.y())
                    //
                    // In this example, "return x" must be replaced with "return ns.x".
                    // This is handled by replacing each "export declare" statement
                    // inside a namespace with an "export var" statement containing all
                    // of the declared bindings. That "export var" statement will later
                    // cause identifiers to be transformed into property accesses.
                    if (opts.isNamespaceScope && opts.isExport) {
                      const decls = [];
                      if (s.k === S_LOCAL) {
                        forEachIdentifierBindingInDecls(s.decls, (loc, b) => {
                          decls.push(new Decl(new Binding(b, loc), null));
                        });
                      }
                      if (decls.length > 0) {
                        return new Stmt(new SLocal(decls, LocalVar, true), loc);
                      }
                    }

                    return new Stmt(typeDeclarationData, loc);
                  }
                  break;
              }
            }
          }
        }

        p.lexer.expectOrInsertSemicolon();
        return new Stmt(new SExpr(expr), loc);
      }
    }
  },

  addImportRecord(kind, phase, pathRange, text, assertOrWith, flags) {
    const p = this;
    const index = p.importRecords.length;
    p.importRecords.push(new ImportRecord(assertOrWith, null, new Path(text), pathRange, 0, -1, -1, flags, phase, kind));
    return index;
  },

  parseFnBody(data) {
    const p = this;
    const oldFnOrArrowData = p.fnOrArrowDataParse;
    const oldAllowIn = p.allowIn;
    p.fnOrArrowDataParse = data.clone(); // Go passes "data" by value
    p.allowIn = true;

    const loc = p.lexer.loc();
    p.pushScopeForParsePass(ScopeFunctionBody, loc);
    try {
      p.lexer.expect(TOpenBrace);
      const bodyOpts = new parseStmtOpts();
      bodyOpts.allowDirectivePrologue = true;
      const stmts = p.parseStmtsUpTo(TCloseBrace, bodyOpts);
      const closeBraceLoc = p.lexer.loc();
      p.lexer.next();

      p.allowIn = oldAllowIn;
      p.fnOrArrowDataParse = oldFnOrArrowData;
      return new FnBody(new SBlock(stmts, closeBraceLoc), loc);
    } finally {
      p.popScope(); // Go: "defer p.popScope()"
    }
  },

  forbidLexicalDecl(loc) {
    const p = this;
    p.log.addErrorWithNotes(); // Cannot use a declaration in a single-statement context
  },

  forbidUsingInSwitch(loc) {
    const p = this;
    p.log.addErrorWithNotes(); // Cannot use a "using" declaration directly inside a switch case
  },

  parseStmtsUpTo(end, opts) {
    const p = this;
    const stmts = [];
    let returnWithoutSemicolonStart = -1;
    opts = opts.clone(); // Go passes "opts" by value
    opts.lexicalDecl = lexicalDeclAllowAll;
    let isDirectivePrologue = opts.allowDirectivePrologue;

    for (;;) {
      // Preserve some statement-level comments
      const comments = p.lexer.legalCommentsBeforeToken;
      if (comments !== null && comments.length > 0) {
        for (const comment of comments) {
          stmts.push(new Stmt(new SComment(p.source.commentTextWithoutIndent(comment), true), comment.loc));
        }
      }

      if (p.lexer.token === end) {
        break;
      }

      let stmt = p.parseStmt(opts);

      // Skip TypeScript types entirely
      if (p.options.ts.parse) {
        if (stmt.data.k === S_TYPESCRIPT) {
          continue;
        }
      }

      // Parse one or more directives at the beginning
      if (isDirectivePrologue) {
        isDirectivePrologue = false;
        if (stmt.data.k === S_EXPR) {
          const expr = stmt.data;
          if (expr.value.data.k === E_STRING && !expr.value.data.preferTemplate) {
            const str = expr.value.data;
            stmt = new Stmt(new SDirective(str.value, str.legacyOctalLoc), stmt.loc);
            isDirectivePrologue = true;

            if (str.value === "use strict") {
              // Track "use strict" directives
              p.currentScope.strictMode = ExplicitStrictMode;
              p.currentScope.useStrictLoc = expr.value.loc;

              // Inside a function, strict mode actually propagates from the child
              // scope to the parent scope:
              //
              //   // This is a syntax error
              //   function fn(arguments) {
              //     "use strict";
              //   }
              //
              if (
                p.currentScope.kind === ScopeFunctionBody &&
                p.currentScope.parent.kind === ScopeFunctionArgs &&
                p.currentScope.parent.strictMode === SloppyMode
              ) {
                p.currentScope.parent.strictMode = ExplicitStrictMode;
                p.currentScope.parent.useStrictLoc = expr.value.loc;
              }
            } else if (str.value === "use asm") {
              // Deliberately remove "use asm" directives. The asm.js subset of
              // JavaScript has complicated validation rules that are triggered
              // by this directive. This parser is not designed with asm.js in
              // mind and round-tripping asm.js code through esbuild will very
              // likely cause it to no longer validate as asm.js. When this
              // happens, V8 prints a warning and people don't like seeing the
              // warning.
              //
              // We deliberately do not attempt to preserve the validity of
              // asm.js code because it's a complicated legacy format and it's
              // obsolete now that WebAssembly exists. By removing this directive
              // it will just become normal JavaScript, which will work fine and
              // won't generate a warning (but will run slower). We don't generate
              // a warning ourselves in this case because there isn't necessarily
              // anything easy and actionable that the user can do to fix this.
              stmt = new Stmt(new SEmpty(), stmt.loc);
            }
          }
        }
      }

      stmts.push(stmt);

      // Warn about ASI and return statements. Here's an example of code with
      // this problem: https://github.com/rollup/rollup/issues/3729
      if (!p.suppressWarningsAboutWeirdCode) {
        const s = stmt.data;
        if (s.k === S_RETURN && s.valueOrNil === null && !p.latestReturnHadSemicolon) {
          returnWithoutSemicolonStart = stmt.loc;
        } else {
          if (returnWithoutSemicolonStart !== -1) {
            if (s.k === S_EXPR) {
              // The following expression is not returned because of an automatically-inserted semicolon
              p.log.addID(MsgID_JS_SemicolonAfterReturn, LogWarning);
            }
          }
          returnWithoutSemicolonStart = -1;
        }
      }
    }

    return stmts;
  },

  generateTempRef(declare, optionalName) {
    const p = this;
    let scope = p.currentScope;

    if (declare !== tempRefNeedsDeclareMayBeCapturedInsideLoop) {
      while (!scopeKindStopsHoisting(scope.kind)) {
        scope = scope.parent;
      }
    }

    if (optionalName === "" || optionalName === undefined) {
      optionalName = "_" + numberToMinifiedNameJS(p.tempRefCount);
      p.tempRefCount++;
    }
    const ref = p.newSymbol(SymbolOther, optionalName);

    if (declare === tempRefNeedsDeclareMayBeCapturedInsideLoop && !scopeKindStopsHoisting(scope.kind)) {
      if (p.tempLetsToDeclare === null) {
        p.tempLetsToDeclare = [ref];
      } else {
        p.tempLetsToDeclare.push(ref);
      }
    } else if (declare !== tempRefNoDeclare) {
      if (p.tempRefsToDeclare === null) {
        p.tempRefsToDeclare = [new tempRef(null, ref)];
      } else {
        p.tempRefsToDeclare.push(new tempRef(null, ref));
      }
    }

    scope.generated.push(ref);
    return ref;
  },

  generateTopLevelTempRef() {
    const p = this;
    const ref = p.newSymbol(SymbolOther, "_" + numberToMinifiedNameJS(p.topLevelTempRefCount));
    if (p.topLevelTempRefsToDeclare === null) {
      p.topLevelTempRefsToDeclare = [new tempRef(null, ref)];
    } else {
      p.topLevelTempRefsToDeclare.push(new tempRef(null, ref));
    }
    p.moduleScope.generated.push(ref);
    p.topLevelTempRefCount++;
    return ref;
  },
};
// generated from js_parser_parse2.mts by tools/ts-build.mjs; edit that file
