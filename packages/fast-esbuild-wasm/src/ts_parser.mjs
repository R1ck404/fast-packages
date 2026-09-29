// Port of internal/js_parser/ts_parser.go. This file contains code for parsing
// TypeScript syntax. The parser just skips over type expressions as if they are
// whitespace and doesn't bother generating an AST because nothing uses type
// information.
//
// All *parser methods live in `tsMethods` (mixed into Parser.prototype by
// js_parser.mjs). See CONVENTIONS.md.
import { goQuote } from "./gostd.mjs";
import { LEXER_PANIC } from "./gopanic.mjs";
import { jsFeatureHas, Arrow, LogicalAssignment } from "./compat.mjs";
import {
  Error as MsgKindError,
  LevelInfo,
  RANGE_ZERO,
  Msg,
  Range,
  rangeEnd,
} from "./logger.mjs";
import {
  InvalidRef,
  LocRef,
  refInner,
  SymbolConst,
  SymbolHoisted,
  SymbolOther,
  SymbolTSEnum,
  SymbolTSNamespace,
} from "./ast.mjs";
import {
  LLowest,
  LComma,
  LBitwiseOr,
  LBitwiseAnd,
  LPrefix,
  BinOpLogicalOr,
  BinOpLogicalOrAssign,
  OptionalChainNone,
  NormalCall,
  Expr,
  Stmt,
  Binding,
  Arg,
  Decl,
  Fn,
  FnBody,
  SBlock,
  BIdentifier,
  EArrow,
  EBinary,
  ECall,
  EDot,
  EFunction,
  EIdentifier,
  EInlinedEnum,
  EObject,
  EString,
  EnumValue,
  SEnum,
  SExpr,
  SLocal,
  SNamespace,
  SReturn,
  STypeScriptShared,
  S_CLASS,
  S_ENUM,
  S_EXPR,
  S_FUNCTION,
  S_LOCAL,
  S_NAMESPACE,
  LocalConst,
  LocalLet,
  LocalVar,
  ScopeEntry,
  ScopeFunctionArgs,
  TSNamespaceMember,
  TSNamespaceMemberNamespace,
  TSNamespaceMemberProperty,
  TSNamespaceScope,
  TS_NAMESPACE_MEMBER_NAMESPACE,
} from "./js_ast.mjs";
import { assign, joinAllWithComma, joinWithComma, forEachIdentifierBindingInDecls } from "./js_ast_helpers.mjs";
import { isIdentifierUTF16 } from "./js_ident.mjs";
import {
  TAmpersand,
  TAmpersandAmpersand,
  TAsterisk,
  TAsteriskAsterisk,
  TAt,
  TBar,
  TBarBar,
  TBigIntegerLiteral,
  TCaret,
  TClass,
  TCloseBrace,
  TCloseBracket,
  TCloseParen,
  TColon,
  TComma,
  TConst,
  TDelete,
  TDot,
  TDotDotDot,
  TEnum,
  TEquals,
  TEqualsEquals,
  TEqualsEqualsEquals,
  TEqualsGreaterThan,
  TExclamation,
  TExclamationEquals,
  TExclamationEqualsEquals,
  TExtends,
  TFalse,
  TFunction,
  TGreaterThan,
  TGreaterThanEquals,
  TGreaterThanGreaterThan,
  TGreaterThanGreaterThanEquals,
  TGreaterThanGreaterThanGreaterThan,
  TGreaterThanGreaterThanGreaterThanEquals,
  TIdentifier,
  TImport,
  TIn,
  TInstanceof,
  TLessThan,
  TLessThanEquals,
  TLessThanLessThan,
  TLessThanLessThanEquals,
  TMinus,
  TMinusMinus,
  TNew,
  TNoSubstitutionTemplateLiteral,
  TNull,
  TNumericLiteral,
  TOpenBrace,
  TOpenBracket,
  TOpenParen,
  TPercent,
  TPlus,
  TPlusPlus,
  TPrivateIdentifier,
  TQuestion,
  TQuestionQuestion,
  TSemicolon,
  TSlash,
  TSlashEquals,
  TStringLiteral,
  TSuper,
  TTemplateHead,
  TTemplateTail,
  TThis,
  TTilde,
  TTrue,
  TTypeof,
  TVoid,
} from "./js_lexer.mjs";
import {
  isReturnTypeFlag,
  isIndexSignatureFlag,
  allowTupleLabelsFlag,
  disallowConditionalTypesFlag,
  tsTypeIdentifierNormal,
  tsTypeIdentifierUnique,
  tsTypeIdentifierAbstract,
  tsTypeIdentifierAsserts,
  tsTypeIdentifierPrefix,
  tsTypeIdentifierPrimitive,
  tsTypeIdentifierInfer,
  tsTypeIdentifierMap,
  allowInOutVarianceAnnotations,
  allowConstModifier,
  allowEmptyTypeParameters,
  didNotSkipAnything,
  couldBeTypeCast,
  definitelyTypeParameters,
  skipTypeScriptTypeArgumentsOpts,
  fnOrArrowDataParse,
  parseStmtOpts,
  allowIdent,
} from "./js_parser_types.mjs";
import { newParser } from "./js_parser.mjs";

// skipTypeFlags.has(flag)
export function skipTypeFlagsHas(flags, flag) {
  return (flags & flag) !== 0;
}

// Backtracking: Go restores a copy of the lexer struct taken earlier. That
// copy's "AllComments" slice still has the old length, so comments appended by
// the discarded lookahead are dropped (they are appended again when they are
// scanned for real). lexer.clone() shares the array instead, so truncate it.
// ("AllComments" feeds the character frequency used by minifyIdentifiers.)
export function restoreLexer(p, oldLexer, allCommentsLen) {
  const allComments = oldLexer.allComments;
  if (allComments.length !== allCommentsLen) allComments.length = allCommentsLen;
  p.lexer = oldLexer;
}

// Shared "skipTypeScriptTypeArgumentsOpts{}" (read-only, never mutate it)
const SKIP_TYPE_ARGS_OPTS_DEFAULT = Object.freeze(new skipTypeScriptTypeArgumentsOpts());
// Shared "skipTypeScriptTypeArgumentsOpts{isParseTypeArgumentsInExpression: true}"
const SKIP_TYPE_ARGS_OPTS_IN_EXPRESSION = Object.freeze(new skipTypeScriptTypeArgumentsOpts(false, true));

// Stand-in for "logger.NewDeferLog(logger.DeferLogNoVerboseOrDebug, nil)" as
// used by the throw-away parser in
// "isTypeScriptArrowReturnTypeAfterQuestionAndBeforeColon". The messages of
// that log are never looked at, so it silently drops everything: in Go,
// errors logged by the temporary parser do not stop it and have no visible
// effect.
class discardedDeferLog {
                        
                          
  constructor() {
    this.level = LevelInfo;
    this.errors = false;
  }
  addError() {
    this.errors = true;
  }
  addErrorWithNotes() {
    this.errors = true;
  }
  addID(id, kind) {
    if (kind === MsgKindError) this.errors = true;
  }
  addIDWithNotes(id, kind) {
    if (kind === MsgKindError) this.errors = true;
  }
  addMsg(msg) {
    if (msg.kind === MsgKindError) this.errors = true;
  }
  addMsgID(id, msg) {
    if (msg.kind === MsgKindError) this.errors = true;
  }
  hasErrors() {
    return this.errors;
  }
}

export const tsMethods = {
  skipTypeScriptBinding() {
    const p = this;
    switch (p.lexer.token) {
      case TIdentifier:
      case TThis:
        p.lexer.next();
        break;

      case TOpenBracket:
        p.lexer.next();

        // "[, , a]"
        while (p.lexer.token === TComma) {
          p.lexer.next();
        }

        // "[a, b]"
        while (p.lexer.token !== TCloseBracket) {
          // "[...a]"
          if (p.lexer.token === TDotDotDot) {
            p.lexer.next();
          }

          p.skipTypeScriptBinding();
          if (p.lexer.token !== TComma) {
            break;
          }
          p.lexer.next();
        }

        p.lexer.expect(TCloseBracket);
        break;

      case TOpenBrace:
        p.lexer.next();

        while (p.lexer.token !== TCloseBrace) {
          let foundIdentifier = false;

          switch (p.lexer.token) {
            case TDotDotDot:
              p.lexer.next();

              if (p.lexer.token !== TIdentifier) {
                p.lexer.unexpected();
              }

              // "{...x}"
              foundIdentifier = true;
              p.lexer.next();
              break;

            case TIdentifier:
              // "{x}"
              // "{x: y}"
              foundIdentifier = true;
              p.lexer.next();
              break;

            // "{1: y}"
            // "{'x': y}"
            case TStringLiteral:
            case TNumericLiteral:
              p.lexer.next();
              break;

            default:
              if (p.lexer.isIdentifierOrKeyword()) {
                // "{if: x}"
                p.lexer.next();
              } else {
                p.lexer.unexpected();
              }
          }

          if (p.lexer.token === TColon || !foundIdentifier) {
            p.lexer.expect(TColon);
            p.skipTypeScriptBinding();
          }

          if (p.lexer.token !== TComma) {
            break;
          }
          p.lexer.next();
        }

        p.lexer.expect(TCloseBrace);
        break;

      default:
        p.lexer.unexpected();
    }
  },

  skipTypeScriptFnArgs() {
    const p = this;
    p.lexer.expect(TOpenParen);

    while (p.lexer.token !== TCloseParen) {
      // "(...a)"
      if (p.lexer.token === TDotDotDot) {
        p.lexer.next();
      }

      p.skipTypeScriptBinding();

      // "(a?)"
      if (p.lexer.token === TQuestion) {
        p.lexer.next();
      }

      // "(a: any)"
      if (p.lexer.token === TColon) {
        p.lexer.next();
        p.skipTypeScriptType(LLowest);
      }

      // "(a, b)"
      if (p.lexer.token !== TComma) {
        break;
      }
      p.lexer.next();
    }

    p.lexer.expect(TCloseParen);
  },

  // This is a spot where the TypeScript grammar is highly ambiguous. Here are
  // some cases that are valid:
  //
  //	let x = (y: any): (() => {}) => { };
  //	let x = (y: any): () => {} => { };
  //	let x = (y: any): (y) => {} => { };
  //	let x = (y: any): (y[]) => {};
  //	let x = (y: any): (a | b) => {};
  //
  // Here are some cases that aren't valid:
  //
  //	let x = (y: any): (y) => {};
  //	let x = (y: any): (y) => {return 0};
  //	let x = (y: any): asserts y is (y) => {};
  skipTypeScriptParenOrFnType() {
    const p = this;
    if (p.trySkipTypeScriptArrowArgsWithBacktracking()) {
      p.skipTypeScriptReturnType();
    } else {
      p.lexer.expect(TOpenParen);
      p.skipTypeScriptType(LLowest);
      p.lexer.expect(TCloseParen);
    }
  },

  skipTypeScriptReturnType() {
    const p = this;
    p.skipTypeScriptTypeWithFlags(LLowest, isReturnTypeFlag);
  },

  skipTypeScriptType(level) {
    const p = this;
    p.skipTypeScriptTypeWithFlags(level, 0);
  },

  skipTypeScriptTypeWithFlags(level, flags) {
    const p = this;
    loop: for (;;) {
      switch (p.lexer.token) {
        case TNumericLiteral:
        case TBigIntegerLiteral:
        case TStringLiteral:
        case TNoSubstitutionTemplateLiteral:
        case TTrue:
        case TFalse:
        case TNull:
        case TVoid:
          p.lexer.next();
          break;

        case TConst: {
          const r = p.lexer.range();
          p.lexer.next();

          // "[const: number]"
          if ((flags & allowTupleLabelsFlag) !== 0 && p.lexer.token === TColon) {
            p.log.addError(p.tracker, r, 'Unexpected "const"');
          }
          break;
        }

        case TThis:
          p.lexer.next();

          // "function check(): this is boolean"
          if (p.lexer.isContextualKeyword("is") && !p.lexer.hasNewlineBefore) {
            p.lexer.next();
            p.skipTypeScriptType(LLowest);
            return;
          }
          break;

        case TMinus:
          // "-123"
          // "-123n"
          p.lexer.next();
          if (p.lexer.token === TBigIntegerLiteral) {
            p.lexer.next();
          } else {
            p.lexer.expect(TNumericLiteral);
          }
          break;

        case TAmpersand:
          // (Go: empty case, no fallthrough)
          break;

        case TBar:
          // Support things like "type Foo = | A | B" and "type Foo = & A & B"
          p.lexer.next();
          continue loop;

        case TImport:
          // "import('fs')"
          p.lexer.next();

          // "[import: number]"
          // "[import?: number]"
          if ((flags & allowTupleLabelsFlag) !== 0 && (p.lexer.token === TColon || p.lexer.token === TQuestion)) {
            return;
          }

          p.lexer.expect(TOpenParen);
          p.lexer.expect(TStringLiteral);

          // "import('./foo.json', { assert: { type: 'json' } })"
          if (p.lexer.token === TComma) {
            p.lexer.next();
            p.skipTypeScriptObjectType();

            // "import('./foo.json', { assert: { type: 'json' } }, )"
            if (p.lexer.token === TComma) {
              p.lexer.next();
            }
          }

          p.lexer.expect(TCloseParen);
          break;

        case TNew:
          // "new () => Foo"
          // "new <T>() => Foo<T>"
          p.lexer.next();

          // "[new: number]"
          // "[new?: number]"
          if ((flags & allowTupleLabelsFlag) !== 0 && (p.lexer.token === TColon || p.lexer.token === TQuestion)) {
            return;
          }

          p.skipTypeScriptTypeParameters(allowConstModifier);
          p.skipTypeScriptParenOrFnType();
          break;

        case TLessThan:
          // "<T>() => Foo<T>"
          p.skipTypeScriptTypeParameters(allowConstModifier);
          p.skipTypeScriptParenOrFnType();
          break;

        case TOpenParen:
          // "(number | string)"
          p.skipTypeScriptParenOrFnType();
          break;

        case TIdentifier: {
          const kind = tsTypeIdentifierMap.get(p.lexer.identifier) ?? tsTypeIdentifierNormal;
          let checkTypeParameters = true;

          switch (kind) {
            case tsTypeIdentifierPrefix:
              p.lexer.next();

              // Valid:
              //   "[keyof: string]"
              //   "[keyof?: string]"
              //   "{[keyof: string]: number}"
              //   "{[keyof in string]: number}"
              //
              // Invalid:
              //   "A extends B ? keyof : string"
              //
              if (
                (p.lexer.token !== TColon && p.lexer.token !== TQuestion && p.lexer.token !== TIn) ||
                ((flags & isIndexSignatureFlag) === 0 && (flags & allowTupleLabelsFlag) === 0)
              ) {
                p.skipTypeScriptType(LPrefix);
              }
              break loop;

            case tsTypeIdentifierInfer:
              p.lexer.next();

              // "type Foo = Bar extends [infer T] ? T : null"
              // "type Foo = Bar extends [infer T extends string] ? T : null"
              // "type Foo = Bar extends [infer T extends string ? infer T : never] ? T : null"
              // "type Foo = { [infer in Bar]: number }"
              // "type Foo = [infer: number]"
              // "type Foo = [infer?: number]"
              if (
                (p.lexer.token !== TColon && p.lexer.token !== TQuestion && p.lexer.token !== TIn) ||
                ((flags & isIndexSignatureFlag) === 0 && (flags & allowTupleLabelsFlag) === 0)
              ) {
                p.lexer.expect(TIdentifier);
                if (p.lexer.token === TExtends) {
                  p.trySkipTypeScriptConstraintOfInferTypeWithBacktracking(flags);
                }
              }
              break loop;

            case tsTypeIdentifierUnique:
              p.lexer.next();

              // "let foo: unique symbol"
              if (p.lexer.isContextualKeyword("symbol")) {
                p.lexer.next();
                break loop;
              }
              break;

            case tsTypeIdentifierAbstract:
              p.lexer.next();

              // "let foo: abstract new () => {}" added in TypeScript 4.2
              if (p.lexer.token === TNew) {
                continue loop;
              }
              break;

            case tsTypeIdentifierAsserts:
              p.lexer.next();

              // "function assert(x: boolean): asserts x"
              // "function assert(x: boolean): asserts x is boolean"
              if (
                (flags & isReturnTypeFlag) !== 0 &&
                !p.lexer.hasNewlineBefore &&
                (p.lexer.token === TIdentifier || p.lexer.token === TThis)
              ) {
                p.lexer.next();
              }
              break;

            case tsTypeIdentifierPrimitive:
              p.lexer.next();
              checkTypeParameters = false;
              break;

            default:
              p.lexer.next();
          }

          // "function assert(x: any): x is boolean"
          if (p.lexer.isContextualKeyword("is") && !p.lexer.hasNewlineBefore) {
            p.lexer.next();
            p.skipTypeScriptType(LLowest);
            return;
          }

          // "let foo: any \n <number>foo" must not become a single type
          if (checkTypeParameters && !p.lexer.hasNewlineBefore) {
            p.skipTypeScriptTypeArguments(SKIP_TYPE_ARGS_OPTS_DEFAULT);
          }
          break;
        }

        case TTypeof:
          p.lexer.next();

          // "[typeof: number]"
          // "[typeof?: number]"
          if ((flags & allowTupleLabelsFlag) !== 0 && (p.lexer.token === TColon || p.lexer.token === TQuestion)) {
            return;
          }

          if (p.lexer.token === TImport) {
            // "typeof import('fs')"
            continue loop;
          } else {
            // "typeof x"
            if (!p.lexer.isIdentifierOrKeyword()) {
              p.lexer.expected(TIdentifier);
            }
            p.lexer.next();

            // "typeof x.y"
            // "typeof x.#y"
            while (p.lexer.token === TDot) {
              p.lexer.next();
              if (!p.lexer.isIdentifierOrKeyword() && p.lexer.token !== TPrivateIdentifier) {
                p.lexer.expected(TIdentifier);
              }
              p.lexer.next();
            }

            if (!p.lexer.hasNewlineBefore) {
              p.skipTypeScriptTypeArguments(SKIP_TYPE_ARGS_OPTS_DEFAULT);
            }
          }
          break;

        case TOpenBracket:
          // "[number, string]"
          // "[first: number, second: string]"
          p.lexer.next();
          while (p.lexer.token !== TCloseBracket) {
            if (p.lexer.token === TDotDotDot) {
              p.lexer.next();
            }
            p.skipTypeScriptTypeWithFlags(LLowest, allowTupleLabelsFlag);
            if (p.lexer.token === TQuestion) {
              p.lexer.next();
            }
            if (p.lexer.token === TColon) {
              p.lexer.next();
              p.skipTypeScriptType(LLowest);
            }
            if (p.lexer.token !== TComma) {
              break;
            }
            p.lexer.next();
          }
          p.lexer.expect(TCloseBracket);
          break;

        case TOpenBrace:
          p.skipTypeScriptObjectType();
          break;

        case TTemplateHead:
          // "`${'a' | 'b'}-${'c' | 'd'}`"
          for (;;) {
            p.lexer.next();
            p.skipTypeScriptType(LLowest);
            p.lexer.rescanCloseBraceAsTemplateToken();
            if (p.lexer.token === TTemplateTail) {
              p.lexer.next();
              break;
            }
          }
          break;

        default:
          // "[function: number]"
          // "[function?: number]"
          if ((flags & allowTupleLabelsFlag) !== 0 && p.lexer.isIdentifierOrKeyword()) {
            if (p.lexer.token !== TFunction) {
              p.log.addError(p.tracker, p.lexer.range(), "Unexpected " + goQuote(p.lexer.raw()));
            }
            p.lexer.next();
            if (p.lexer.token !== TColon && p.lexer.token !== TQuestion) {
              p.lexer.expect(TColon);
            }
            return;
          }

          p.lexer.unexpected();
      }
      break;
    }

    for (;;) {
      switch (p.lexer.token) {
        case TBar:
          if (level >= LBitwiseOr) {
            return;
          }
          p.lexer.next();
          p.skipTypeScriptTypeWithFlags(LBitwiseOr, flags);
          break;

        case TAmpersand:
          if (level >= LBitwiseAnd) {
            return;
          }
          p.lexer.next();
          p.skipTypeScriptTypeWithFlags(LBitwiseAnd, flags);
          break;

        case TExclamation:
          // A postfix "!" is allowed in JSDoc types in TypeScript, which are only
          // present in comments. While it's not valid in a non-comment position,
          // it's still parsed and turned into a soft error by the TypeScript
          // compiler. It turns out parsing this is important for correctness for
          // "as" casts because the "!" token must still be consumed.
          if (p.lexer.hasNewlineBefore) {
            return;
          }
          p.lexer.next();
          break;

        case TDot:
          p.lexer.next();
          if (!p.lexer.isIdentifierOrKeyword()) {
            p.lexer.expect(TIdentifier);
          }
          p.lexer.next();

          // "{ <A extends B>(): c.d \n <E extends F>(): g.h }" must not become a single type
          if (!p.lexer.hasNewlineBefore) {
            p.skipTypeScriptTypeArguments(SKIP_TYPE_ARGS_OPTS_DEFAULT);
          }
          break;

        case TOpenBracket:
          // "{ ['x']: string \n ['y']: string }" must not become a single type
          if (p.lexer.hasNewlineBefore) {
            return;
          }
          p.lexer.next();
          if (p.lexer.token !== TCloseBracket) {
            p.skipTypeScriptType(LLowest);
          }
          p.lexer.expect(TCloseBracket);
          break;

        case TExtends:
          // "{ x: number \n extends: boolean }" must not become a single type
          if (p.lexer.hasNewlineBefore || (flags & disallowConditionalTypesFlag) !== 0) {
            return;
          }
          p.lexer.next();

          // The type following "extends" is not permitted to be another conditional type
          p.skipTypeScriptTypeWithFlags(LLowest, disallowConditionalTypesFlag);
          p.lexer.expect(TQuestion);
          p.skipTypeScriptType(LLowest);
          p.lexer.expect(TColon);
          p.skipTypeScriptType(LLowest);
          break;

        default:
          return;
      }
    }
  },

  skipTypeScriptObjectType() {
    const p = this;
    p.lexer.expect(TOpenBrace);

    while (p.lexer.token !== TCloseBrace) {
      // "{ -readonly [K in keyof T]: T[K] }"
      // "{ +readonly [K in keyof T]: T[K] }"
      if (p.lexer.token === TPlus || p.lexer.token === TMinus) {
        p.lexer.next();
      }

      // Skip over modifiers and the property identifier
      let foundKey = false;
      while (p.lexer.isIdentifierOrKeyword() || p.lexer.token === TStringLiteral || p.lexer.token === TNumericLiteral) {
        p.lexer.next();
        foundKey = true;
      }

      if (p.lexer.token === TOpenBracket) {
        // Index signature or computed property
        p.lexer.next();
        p.skipTypeScriptTypeWithFlags(LLowest, isIndexSignatureFlag);

        // "{ [key: string]: number }"
        // "{ readonly [K in keyof T]: T[K] }"
        if (p.lexer.token === TColon) {
          p.lexer.next();
          p.skipTypeScriptType(LLowest);
        } else if (p.lexer.token === TIn) {
          p.lexer.next();
          p.skipTypeScriptType(LLowest);
          if (p.lexer.isContextualKeyword("as")) {
            // "{ [K in keyof T as `get-${K}`]: T[K] }"
            p.lexer.next();
            p.skipTypeScriptType(LLowest);
          }
        }

        p.lexer.expect(TCloseBracket);

        // "{ [K in keyof T]+?: T[K] }"
        // "{ [K in keyof T]-?: T[K] }"
        if (p.lexer.token === TPlus || p.lexer.token === TMinus) {
          p.lexer.next();
        }

        foundKey = true;
      }

      // "?" indicates an optional property
      // "!" indicates an initialization assertion
      if (foundKey && (p.lexer.token === TQuestion || p.lexer.token === TExclamation)) {
        p.lexer.next();
      }

      // Type parameters come right after the optional mark
      p.skipTypeScriptTypeParameters(allowConstModifier);

      switch (p.lexer.token) {
        case TColon:
          // Regular property
          if (!foundKey) {
            p.lexer.expect(TIdentifier);
          }
          p.lexer.next();
          p.skipTypeScriptType(LLowest);
          break;

        case TOpenParen:
          // Method signature
          p.skipTypeScriptFnArgs();
          if (p.lexer.token === TColon) {
            p.lexer.next();
            p.skipTypeScriptReturnType();
          }
          break;

        default:
          if (!foundKey) {
            p.lexer.unexpected();
          }
      }

      switch (p.lexer.token) {
        case TCloseBrace:
          break;

        case TComma:
        case TSemicolon:
          p.lexer.next();
          break;

        default:
          if (!p.lexer.hasNewlineBefore) {
            p.lexer.unexpected();
          }
      }
    }

    p.lexer.expect(TCloseBrace);
  },

  // This is the type parameter declarations that go with other symbol
  // declarations (class, function, type, etc.)
  skipTypeScriptTypeParameters(flags) {
    const p = this;
    if (p.lexer.token !== TLessThan) {
      return didNotSkipAnything;
    }

    p.lexer.next();
    let result = couldBeTypeCast;

    if ((flags & allowEmptyTypeParameters) !== 0 && p.lexer.token === TGreaterThan) {
      p.lexer.next();
      return definitelyTypeParameters;
    }

    for (;;) {
      let hasIn = false;
      let hasOut = false;
      let expectIdentifier = true;
      let invalidModifierRange = RANGE_ZERO;

      // Scan over a sequence of "in" and "out" modifiers (a.k.a. optional
      // variance annotations) as well as "const" modifiers
      for (;;) {
        if (p.lexer.token === TConst) {
          if (invalidModifierRange.len === 0 && (flags & allowConstModifier) === 0) {
            // Valid:
            //   "class Foo<const T> {}"
            // Invalid:
            //   "interface Foo<const T> {}"
            invalidModifierRange = p.lexer.range();
          }
          result = definitelyTypeParameters;
          p.lexer.next();
          expectIdentifier = true;
          continue;
        }

        if (p.lexer.token === TIn) {
          if (
            invalidModifierRange.len === 0 &&
            ((flags & allowInOutVarianceAnnotations) === 0 || hasIn || hasOut)
          ) {
            // Valid:
            //   "type Foo<in T> = T"
            // Invalid:
            //   "type Foo<in in T> = T"
            //   "type Foo<out in T> = T"
            invalidModifierRange = p.lexer.range();
          }
          p.lexer.next();
          hasIn = true;
          expectIdentifier = true;
          continue;
        }

        if (p.lexer.isContextualKeyword("out")) {
          const r = p.lexer.range();
          if (invalidModifierRange.len === 0 && (flags & allowInOutVarianceAnnotations) === 0) {
            invalidModifierRange = r;
          }
          p.lexer.next();
          if (
            invalidModifierRange.len === 0 &&
            hasOut &&
            (p.lexer.token === TIn || p.lexer.token === TIdentifier)
          ) {
            // Valid:
            //   "type Foo<out T> = T"
            //   "type Foo<out out> = T"
            //   "type Foo<out out, T> = T"
            //   "type Foo<out out = T> = T"
            //   "type Foo<out out extends T> = T"
            // Invalid:
            //   "type Foo<out out in T> = T"
            //   "type Foo<out out T> = T"
            invalidModifierRange = r;
          }
          hasOut = true;
          expectIdentifier = false;
          continue;
        }

        break;
      }

      // Only report an error for the first invalid modifier
      if (invalidModifierRange.len > 0) {
        p.log.addError(p.tracker, invalidModifierRange, "The modifier " + goQuote(p.source.textForRange(invalidModifierRange)) + " is not valid here:");
      }

      // expectIdentifier => Mandatory identifier (e.g. after "type Foo <in ___")
      // !expectIdentifier => Optional identifier (e.g. after "type Foo <out ___" since "out" may be the identifier)
      if (expectIdentifier || p.lexer.token === TIdentifier) {
        p.lexer.expect(TIdentifier);
      }

      // "class Foo<T extends number> {}"
      if (p.lexer.token === TExtends) {
        result = definitelyTypeParameters;
        p.lexer.next();
        p.skipTypeScriptType(LLowest);
      }

      // "class Foo<T = void> {}"
      if (p.lexer.token === TEquals) {
        result = definitelyTypeParameters;
        p.lexer.next();
        p.skipTypeScriptType(LLowest);
      }

      if (p.lexer.token !== TComma) {
        break;
      }
      p.lexer.next();
      if (p.lexer.token === TGreaterThan) {
        result = definitelyTypeParameters;
        break;
      }
    }

    p.lexer.expectGreaterThan(false /* isInsideJSXElement */);
    return result;
  },

  skipTypeScriptTypeArguments(opts) {
    const p = this;
    switch (p.lexer.token) {
      case TLessThan:
      case TLessThanEquals:
      case TLessThanLessThan:
      case TLessThanLessThanEquals:
        break;
      default:
        return false;
    }

    p.lexer.expectLessThan(false /* isInsideJSXElement */);

    for (;;) {
      p.skipTypeScriptType(LLowest);
      if (p.lexer.token !== TComma) {
        break;
      }
      p.lexer.next();
    }

    // This type argument list must end with a ">"
    if (!opts.isParseTypeArgumentsInExpression) {
      // Normally TypeScript allows any token starting with ">". For example,
      // "Array<Array<number>>()" is a type argument list even though there's a
      // ">>" token, because ">>" starts with ">".
      p.lexer.expectGreaterThan(opts.isInsideJSXElement);
    } else {
      // However, if we're emulating the TypeScript compiler's function called
      // "parseTypeArgumentsInExpression" function, then we must only allow the
      // ">" token itself. For example, "x < y >= z" is not a type argument list.
      //
      // This doesn't detect ">>" in "Array<Array<number>>()" because the inner
      // type argument list isn't a call to "parseTypeArgumentsInExpression"
      // because it's within a type context, not an expression context. So the
      // token that we see here is ">" in that case because the first ">" has
      // already been stripped off of the ">>" by the inner call.
      if (opts.isInsideJSXElement) {
        p.lexer.expectInsideJSXElement(TGreaterThan);
      } else {
        p.lexer.expect(TGreaterThan);
      }
    }
    return true;
  },

  // Backtracking (all "trySkip...WithBacktracking" functions below): Go copies
  // the lexer struct and restores the copy when a LexerPanic is recovered. The
  // copy is taken before "IsLogDisabled" is set, so restoring it also restores
  // the original "IsLogDisabled" value. A recovered panic makes the function
  // return the zero value of its result type.
  trySkipTypeArgumentsInExpressionWithBacktracking() {
    const p = this;
    const oldLexer = p.lexer.clone();
    const oldAllCommentsLen = oldLexer.allComments.length;
    p.lexer.isLogDisabled = true;

    // Implement backtracking by restoring the lexer's memory to its original state
    try {
      if (p.skipTypeScriptTypeArguments(SKIP_TYPE_ARGS_OPTS_IN_EXPRESSION)) {
        // Check the token after the type argument list and backtrack if it's invalid
        if (!p.tsCanFollowTypeArgumentsInExpression()) {
          p.lexer.unexpected();
        }
      }

      // Restore the log disabled flag. Note that we can't just set it back to false
      // because it may have been true to start with.
      p.lexer.isLogDisabled = oldLexer.isLogDisabled;
      return true;
    } catch (e) {
      if (e !== LEXER_PANIC) throw e;
      restoreLexer(p, oldLexer, oldAllCommentsLen);
      return false;
    }
  },

  trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking() {
    const p = this;
    const oldLexer = p.lexer.clone();
    const oldAllCommentsLen = oldLexer.allComments.length;
    p.lexer.isLogDisabled = true;

    // Implement backtracking by restoring the lexer's memory to its original state
    try {
      const result = p.skipTypeScriptTypeParameters(allowConstModifier);
      if (p.lexer.token !== TOpenParen) {
        p.lexer.unexpected();
      }

      // Restore the log disabled flag. Note that we can't just set it back to false
      // because it may have been true to start with.
      p.lexer.isLogDisabled = oldLexer.isLogDisabled;
      return result;
    } catch (e) {
      if (e !== LEXER_PANIC) throw e;
      restoreLexer(p, oldLexer, oldAllCommentsLen);
      return didNotSkipAnything;
    }
  },

  trySkipTypeScriptArrowReturnTypeWithBacktracking() {
    const p = this;
    const oldLexer = p.lexer.clone();
    const oldAllCommentsLen = oldLexer.allComments.length;
    p.lexer.isLogDisabled = true;

    // Implement backtracking by restoring the lexer's memory to its original state
    try {
      p.lexer.expect(TColon);
      p.skipTypeScriptReturnType();

      // Check the token after this and backtrack if it's the wrong one
      if (p.lexer.token !== TEqualsGreaterThan) {
        p.lexer.unexpected();
      }

      // Restore the log disabled flag. Note that we can't just set it back to false
      // because it may have been true to start with.
      p.lexer.isLogDisabled = oldLexer.isLogDisabled;
      return true;
    } catch (e) {
      if (e !== LEXER_PANIC) throw e;
      restoreLexer(p, oldLexer, oldAllCommentsLen);
      return false;
    }
  },

  // This is a very specific function that determines whether a colon token is a
  // TypeScript arrow function return type in the case where the arrow function
  // is the middle expression of a JavaScript ternary operator (i.e. is between
  // the "?" and ":" tokens). It's separate from the other function above called
  // "trySkipTypeScriptArrowReturnTypeWithBacktracking" because it's much more
  // expensive, and likely not as robust.
  //
  // THIS IS A GROSS HACK (see the Go source for the full explanation): the
  // TypeScript compiler parses the whole arrow function body and resets back to
  // the colon if the token following the body is not another colon:
  //
  //   x = a ? (b) : c => d;
  //   y = a ? (b) : c => d : e;
  //
  // esbuild parses the arrow function body using a rough copy of the parser and
  // then always throws the result away. As in Go, the copy is a brand new parser
  // (newParser) that shares nothing mutable with the original except what Go
  // shares too: it gets a *copy* of the lexer (lexer.clone()), the same source
  // and options, and a throw-away log. The original parser is never touched,
  // so nothing needs to be restored afterwards.
  isTypeScriptArrowReturnTypeAfterQuestionAndBeforeColon(await_) {
    const originalParser = this;

    // (JS-only: the lexer copy shares "allComments" with the original lexer, so
    // drop what the temporary parser appends; Go's copy appends to its own
    // slice header. See restoreLexer.)
    const allComments = originalParser.lexer.allComments;
    const allCommentsLen = allComments.length;

    // Implement "backtracking" by swallowing lexer errors on a temporary parser
    try {
      const p = newParser(new discardedDeferLog(), originalParser.source, originalParser.lexer.clone(), originalParser.options);

      // Clone all state that the parser needs to parse this arrow function body
      p.allowIn = originalParser.allowIn;
      p.lexer.isLogDisabled = true;
      p.pushScopeForParsePass(ScopeEntry, 0);
      p.pushScopeForParsePass(ScopeFunctionArgs, 1);

      // Parse the return type
      p.lexer.expect(TColon);
      p.skipTypeScriptReturnType();

      // Parse the body and throw it out (with the side effect of maybe throwing an error)
      const data = new fnOrArrowDataParse();
      data.await = await_;
      p.parseArrowBody([], data);

      // There must be a colon following the arrow function body to pair with the leading "?"
      p.lexer.expect(TColon);

      // Parsing was successful if we get here
      return true;
    } catch (e) {
      if (e !== LEXER_PANIC) throw e;
      return false; // Swallow this error
    } finally {
      if (allComments.length !== allCommentsLen) allComments.length = allCommentsLen;
    }
  },

  trySkipTypeScriptArrowArgsWithBacktracking() {
    const p = this;
    const oldLexer = p.lexer.clone();
    const oldAllCommentsLen = oldLexer.allComments.length;
    p.lexer.isLogDisabled = true;

    // Implement backtracking by restoring the lexer's memory to its original state
    try {
      p.skipTypeScriptFnArgs();
      p.lexer.expect(TEqualsGreaterThan);

      // Restore the log disabled flag. Note that we can't just set it back to false
      // because it may have been true to start with.
      p.lexer.isLogDisabled = oldLexer.isLogDisabled;
      return true;
    } catch (e) {
      if (e !== LEXER_PANIC) throw e;
      restoreLexer(p, oldLexer, oldAllCommentsLen);
      return false;
    }
  },

  trySkipTypeScriptConstraintOfInferTypeWithBacktracking(flags) {
    const p = this;
    const oldLexer = p.lexer.clone();
    const oldAllCommentsLen = oldLexer.allComments.length;
    p.lexer.isLogDisabled = true;

    // Implement backtracking by restoring the lexer's memory to its original state
    try {
      p.lexer.expect(TExtends);
      p.skipTypeScriptTypeWithFlags(LPrefix, disallowConditionalTypesFlag);
      if ((flags & disallowConditionalTypesFlag) === 0 && p.lexer.token === TQuestion) {
        p.lexer.unexpected();
      }

      // Restore the log disabled flag. Note that we can't just set it back to false
      // because it may have been true to start with.
      p.lexer.isLogDisabled = oldLexer.isLogDisabled;
      return true;
    } catch (e) {
      if (e !== LEXER_PANIC) throw e;
      restoreLexer(p, oldLexer, oldAllCommentsLen);
      return false;
    }
  },

  // Returns true if the current less-than token is considered to be an arrow
  // function under TypeScript's rules for files containing JSX syntax
  isTSArrowFnJSX() {
    const p = this;
    let isTSArrowFn = false;
    const oldLexer = p.lexer.clone();
    const oldAllCommentsLen = oldLexer.allComments.length;
    p.lexer.next();

    // Look ahead to see if this should be an arrow function instead
    if (p.lexer.token === TConst) {
      p.lexer.next();
    }
    if (p.lexer.token === TIdentifier) {
      p.lexer.next();
      if (p.lexer.token === TComma || p.lexer.token === TEquals) {
        isTSArrowFn = true;
      } else if (p.lexer.token === TExtends) {
        p.lexer.next();
        isTSArrowFn = p.lexer.token !== TEquals && p.lexer.token !== TGreaterThan && p.lexer.token !== TSlash;
      }
    }

    // Restore the lexer
    restoreLexer(p, oldLexer, oldAllCommentsLen);
    return isTSArrowFn;
  },

  // This function is taken from the official TypeScript compiler source code:
  // https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
  //
  // This function is pretty inefficient as written, and could be collapsed into
  // a single switch statement. But that would make it harder to keep this in
  // sync with the TypeScript compiler's source code, so we keep doing it the
  // slow way.
  tsCanFollowTypeArgumentsInExpression() {
    const p = this;
    switch (p.lexer.token) {
      // These tokens can follow a type argument list in a call expression.
      case TOpenParen: // foo<x>(
      case TNoSubstitutionTemplateLiteral: // foo<T> `...`
      case TTemplateHead: // foo<T> `...${100}...`
        return true;

      // A type argument list followed by `<` never makes sense, and a type argument list followed
      // by `>` is ambiguous with a (re-scanned) `>>` operator, so we disqualify both. Also, in
      // this context, `+` and `-` are unary operators, not binary operators.
      case TLessThan:
      case TGreaterThan:
      case TPlus:
      case TMinus:
      // TypeScript always sees "TGreaterThan" instead of these tokens since
      // their scanner works a little differently than our lexer. So since
      // "TGreaterThan" is forbidden above, we also forbid these too.
      case TGreaterThanEquals:
      case TGreaterThanGreaterThan:
      case TGreaterThanGreaterThanEquals:
      case TGreaterThanGreaterThanGreaterThan:
      case TGreaterThanGreaterThanGreaterThanEquals:
        return false;
    }

    // We favor the type argument list interpretation when it is immediately followed by
    // a line break, a binary operator, or something that can't start an expression.
    return p.lexer.hasNewlineBefore || p.tsIsBinaryOperator() || !p.tsIsStartOfExpression();
  },

  // This function is taken from the official TypeScript compiler source code:
  // https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
  tsIsBinaryOperator() {
    const p = this;
    switch (p.lexer.token) {
      case TIn:
        return p.allowIn;

      case TQuestionQuestion:
      case TBarBar:
      case TAmpersandAmpersand:
      case TBar:
      case TCaret:
      case TAmpersand:
      case TEqualsEquals:
      case TExclamationEquals:
      case TEqualsEqualsEquals:
      case TExclamationEqualsEquals:
      case TLessThan:
      case TGreaterThan:
      case TLessThanEquals:
      case TGreaterThanEquals:
      case TInstanceof:
      case TLessThanLessThan:
      case TGreaterThanGreaterThan:
      case TGreaterThanGreaterThanGreaterThan:
      case TPlus:
      case TMinus:
      case TAsterisk:
      case TSlash:
      case TPercent:
      case TAsteriskAsterisk:
        return true;

      case TIdentifier:
        if (p.lexer.isContextualKeyword("as") || p.lexer.isContextualKeyword("satisfies")) {
          return true;
        }
        break;
    }

    return false;
  },

  // This function is taken from the official TypeScript compiler source code:
  // https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
  tsIsStartOfExpression() {
    const p = this;
    if (p.tsIsStartOfLeftHandSideExpression()) {
      return true;
    }

    switch (p.lexer.token) {
      case TPlus:
      case TMinus:
      case TTilde:
      case TExclamation:
      case TDelete:
      case TTypeof:
      case TVoid:
      case TPlusPlus:
      case TMinusMinus:
      case TLessThan:
      case TPrivateIdentifier:
      case TAt:
        return true;

      default:
        if (p.lexer.token === TIdentifier && (p.lexer.identifier === "await" || p.lexer.identifier === "yield")) {
          // Yield/await always starts an expression.  Either it is an identifier (in which case
          // it is definitely an expression).  Or it's a keyword (either because we're in
          // a generator or async function, or in strict mode (or both)) and it started a yield or await expression.
          return true;
        }

        // Error tolerance.  If we see the start of some binary operator, we consider
        // that the start of an expression.  That way we'll parse out a missing identifier,
        // give a good message about an identifier being missing, and then consume the
        // rest of the binary expression.
        if (p.tsIsBinaryOperator()) {
          return true;
        }

        return p.tsIsIdentifier();
    }
  },

  // This function is taken from the official TypeScript compiler source code:
  // https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
  tsIsStartOfLeftHandSideExpression() {
    const p = this;
    switch (p.lexer.token) {
      case TThis:
      case TSuper:
      case TNull:
      case TTrue:
      case TFalse:
      case TNumericLiteral:
      case TBigIntegerLiteral:
      case TStringLiteral:
      case TNoSubstitutionTemplateLiteral:
      case TTemplateHead:
      case TOpenParen:
      case TOpenBracket:
      case TOpenBrace:
      case TFunction:
      case TClass:
      case TNew:
      case TSlash:
      case TSlashEquals:
      case TIdentifier:
        return true;

      case TImport:
        return p.tsLookAheadNextTokenIsOpenParenOrLessThanOrDot();

      default:
        return p.tsIsIdentifier();
    }
  },

  // This function is taken from the official TypeScript compiler source code:
  // https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
  tsLookAheadNextTokenIsOpenParenOrLessThanOrDot() {
    const p = this;
    const oldLexer = p.lexer.clone();
    const oldAllCommentsLen = oldLexer.allComments.length;
    p.lexer.next();

    const result = p.lexer.token === TOpenParen || p.lexer.token === TLessThan || p.lexer.token === TDot;

    // Restore the lexer
    restoreLexer(p, oldLexer, oldAllCommentsLen);
    return result;
  },

  // This function is taken from the official TypeScript compiler source code:
  // https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
  tsIsIdentifier() {
    const p = this;
    if (p.lexer.token === TIdentifier) {
      // If we have a 'yield' keyword, and we're in the [yield] context, then 'yield' is
      // considered a keyword and is not an identifier.
      if (p.fnOrArrowDataParse.yield !== allowIdent && p.lexer.identifier === "yield") {
        return false;
      }

      // If we have a 'await' keyword, and we're in the [Await] context, then 'await' is
      // considered a keyword and is not an identifier.
      if (p.fnOrArrowDataParse.await !== allowIdent && p.lexer.identifier === "await") {
        return false;
      }

      return true;
    }

    return false;
  },

  skipTypeScriptInterfaceStmt(opts) {
    const p = this;
    const name = p.lexer.identifier;
    p.lexer.expect(TIdentifier);

    if (opts.isModuleScope) {
      p.localTypeNames.set(name, true);
    }

    p.skipTypeScriptTypeParameters(allowInOutVarianceAnnotations | allowEmptyTypeParameters);

    if (p.lexer.token === TExtends) {
      p.lexer.next();
      for (;;) {
        p.skipTypeScriptType(LLowest);
        if (p.lexer.token !== TComma) {
          break;
        }
        p.lexer.next();
      }
    }

    if (p.lexer.isContextualKeyword("implements")) {
      p.lexer.next();
      for (;;) {
        p.skipTypeScriptType(LLowest);
        if (p.lexer.token !== TComma) {
          break;
        }
        p.lexer.next();
      }
    }

    p.skipTypeScriptObjectType();
  },

  skipTypeScriptTypeStmt(opts) {
    const p = this;
    if (opts.isExport) {
      switch (p.lexer.token) {
        case TOpenBrace:
          // "export type {foo}"
          // "export type {foo} from 'bar'"
          p.parseExportClause();
          if (p.lexer.isContextualKeyword("from")) {
            p.lexer.next();
            p.parsePath();
          }
          p.lexer.expectOrInsertSemicolon();
          return;

        // This is invalid TypeScript, and is rejected by the TypeScript compiler:
        //
        //   example.ts:1:1 - error TS1383: Only named exports may use 'export type'.
        //
        //   1 export type * from './types'
        //     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        //
        // However, people may not know this and then blame esbuild for it not
        // working. So we parse it anyway and then discard it (since we always
        // discard all types). People who do this should be running the TypeScript
        // type checker when using TypeScript, which will then report this error.
        case TAsterisk:
          // "export type * from 'path'"
          p.lexer.next();
          if (p.lexer.isContextualKeyword("as")) {
            // "export type * as ns from 'path'"
            p.lexer.next();
            p.parseClauseAlias("export");
            p.lexer.next();
          }
          p.lexer.expectContextualKeyword("from");
          p.parsePath();
          p.lexer.expectOrInsertSemicolon();
          return;
      }
    }

    const name = p.lexer.identifier;
    p.lexer.expect(TIdentifier);

    if (opts.isModuleScope) {
      p.localTypeNames.set(name, true);
    }

    p.skipTypeScriptTypeParameters(allowInOutVarianceAnnotations | allowEmptyTypeParameters);
    p.lexer.expect(TEquals);
    p.skipTypeScriptType(LLowest);
    p.lexer.expectOrInsertSemicolon();
  },

  parseTypeScriptEnumStmt(loc, opts) {
    const p = this;
    p.lexer.expect(TEnum);
    const nameLoc = p.lexer.loc();
    const nameText = p.lexer.identifier;
    p.lexer.expect(TIdentifier);
    let nameRef = InvalidRef; // Go: name := ast.LocRef{Loc: nameLoc, Ref: ast.InvalidRef}

    // Generate the namespace object
    const exportedMembers = p.getOrCreateExportedNamespaceMembers(nameText, opts.isExport);
    const tsNamespace = new TSNamespaceScope(exportedMembers, null, InvalidRef, true);
    const enumMemberData = new TSNamespaceMemberNamespace(exportedMembers);

    // Declare the enum and create the scope
    const scopeIndex = p.scopesInOrder.length;
    if (!opts.isTypeScriptDeclare) {
      nameRef = p.declareSymbol(SymbolTSEnum, nameLoc, nameText);
      p.pushScopeForParsePass(ScopeEntry, loc);
      p.currentScope.tsNamespace = tsNamespace;
      p.refToTSNamespaceMemberData.set(nameRef, enumMemberData);
    }

    p.lexer.expect(TOpenBrace);
    const values = [];

    const oldFnOrArrowData = p.fnOrArrowDataParse;
    const newFnOrArrowData = new fnOrArrowDataParse();
    newFnOrArrowData.isThisDisallowed = true;
    newFnOrArrowData.needsAsyncLoc = -1;
    p.fnOrArrowDataParse = newFnOrArrowData;

    // Parse the body
    while (p.lexer.token !== TCloseBrace) {
      const nameRange = p.lexer.range();
      const value = new EnumValue(null, "", InvalidRef, nameRange.loc);

      // Parse the name (Go shadows "nameText" here; renamed to "valueNameText")
      let valueNameText = "";
      if (p.lexer.token === TStringLiteral) {
        value.name = p.lexer.stringLiteral();
        valueNameText = value.name; // helpers.UTF16ToString
      } else if (p.lexer.isIdentifierOrKeyword()) {
        valueNameText = p.lexer.identifier;
        value.name = valueNameText; // helpers.StringToUTF16
      } else {
        p.lexer.expect(TIdentifier);
      }
      p.lexer.next();

      // Identifiers can be referenced by other values
      if (!opts.isTypeScriptDeclare && isIdentifierUTF16(value.name)) {
        value.ref = p.declareSymbol(SymbolOther, value.loc, value.name);
      }

      // Parse the initializer
      if (p.lexer.token === TEquals) {
        p.lexer.next();
        value.valueOrNil = p.parseExpr(LComma);
      }

      values.push(value);

      // Add this enum value as a member of the enum's namespace
      exportedMembers.set(valueNameText, new TSNamespaceMember(new TSNamespaceMemberProperty(), value.loc, true));

      if (p.lexer.token !== TComma && p.lexer.token !== TSemicolon) {
        if (p.lexer.isIdentifierOrKeyword() || p.lexer.token === TStringLiteral) {
          let errorLoc;
          let errorText;

          if (value.valueOrNil === null) {
            errorLoc = rangeEnd(nameRange);
            errorText = 'Expected "," after ' + goQuote(valueNameText) + " in enum";
          } else {
            let nextName;
            if (p.lexer.token === TStringLiteral) {
              nextName = p.lexer.stringLiteral();
            } else {
              nextName = p.lexer.identifier;
            }
            errorLoc = p.lexer.loc();
            errorText = 'Expected "," before ' + goQuote(nextName) + " in enum";
          }

          const data = p.tracker.msgData(new Range(errorLoc, 0), errorText);
          data.location.suggestion = ",";
          p.log.addMsg(new Msg(null, "", data, MsgKindError));
          throw LEXER_PANIC;
        }
        break;
      }
      p.lexer.next();
    }

    p.fnOrArrowDataParse = oldFnOrArrowData;

    if (!opts.isTypeScriptDeclare) {
      // Avoid a collision with the enum closure argument variable if the
      // enum exports a symbol with the same name as the enum itself:
      //
      //   enum foo {
      //     foo = 123,
      //     bar = foo,
      //   }
      //
      // TypeScript generates the following code in this case:
      //
      //   var foo;
      //   (function (foo) {
      //     foo[foo["foo"] = 123] = "foo";
      //     foo[foo["bar"] = 123] = "bar";
      //   })(foo || (foo = {}));
      //
      // Whereas in this case:
      //
      //   enum foo {
      //     bar = foo as any,
      //   }
      //
      // TypeScript generates the following code:
      //
      //   var foo;
      //   (function (foo) {
      //     foo[foo["bar"] = foo] = "bar";
      //   })(foo || (foo = {}));
      //
      if (p.currentScope.members.has(nameText)) {
        // Add a "_" to make tests easier to read, since non-bundler tests don't
        // run the renamer. For external-facing things the renamer will avoid
        // collisions automatically so this isn't important for correctness.
        tsNamespace.argRef = p.newSymbol(SymbolHoisted, "_" + nameText);
        p.currentScope.generated.push(tsNamespace.argRef);
      } else {
        tsNamespace.argRef = p.declareSymbol(SymbolHoisted, nameLoc, nameText);
      }
      p.refToTSNamespaceMemberData.set(tsNamespace.argRef, enumMemberData);

      p.popScope();
    }

    p.lexer.expect(TCloseBrace);

    if (opts.isTypeScriptDeclare) {
      if (opts.isNamespaceScope && opts.isExport) {
        p.hasNonLocalExportDeclareInsideNamespace = true;
      }

      return new Stmt(STypeScriptShared, loc);
    }

    // Save these for when we do out-of-order enum visiting
    if (p.scopesInOrderForEnum == null) {
      p.scopesInOrderForEnum = new Map();
    }

    // Make a copy of "scopesInOrder" instead of a slice since the original
    // array may be flattened in the future by "popAndFlattenScope"
    p.scopesInOrderForEnum.set(loc, p.scopesInOrder.slice(scopeIndex));

    return new Stmt(new SEnum(values, new LocRef(nameLoc, nameRef), tsNamespace.argRef, opts.isExport), loc);
  },

  // This assumes the caller has already parsed the "import" token
  parseTypeScriptImportEqualsStmt(loc, opts, defaultNameLoc, defaultName) {
    const p = this;
    p.lexer.expect(TEquals);

    const kind = p.selectLocalKind(LocalConst);
    const name = p.lexer.identifier;
    let value = new Expr(new EIdentifier(p.storeNameInRef(name)), p.lexer.loc());
    p.lexer.expect(TIdentifier);

    if (name === "require" && p.lexer.token === TOpenParen) {
      // "import ns = require('x')"
      p.lexer.next();
      const path = new Expr(new EString(p.lexer.stringLiteral()), p.lexer.loc());
      p.lexer.expect(TStringLiteral);
      p.lexer.expect(TCloseParen);
      value = new Expr(new ECall(value, [path]), value.loc);
    } else {
      // "import Foo = Bar"
      // "import Foo = Bar.Baz"
      while (p.lexer.token === TDot) {
        p.lexer.next();
        value = new Expr(new EDot(value, p.lexer.identifier, p.lexer.loc(), OptionalChainNone, true /* canBeRemovedIfUnused */), value.loc);
        p.lexer.expect(TIdentifier);
      }
    }

    p.lexer.expectOrInsertSemicolon();

    if (opts.isTypeScriptDeclare) {
      // "import type foo = require('bar');"
      // "import type foo = bar.baz;"
      return new Stmt(STypeScriptShared, loc);
    }

    const ref = p.declareSymbol(SymbolConst, defaultNameLoc, defaultName);
    const decls = [new Decl(new Binding(new BIdentifier(ref), defaultNameLoc), value)];

    return new Stmt(new SLocal(decls, kind, opts.isExport, true /* wasTSImportEquals */), loc);
  },

  // Generate a TypeScript namespace object for this namespace's scope. If this
  // namespace is another block that is to be merged with an existing namespace,
  // use that earlier namespace's object instead.
  getOrCreateExportedNamespaceMembers(name, isExport) {
    const p = this;
    // Merge with a sibling namespace from the same scope
    const existingMember = p.currentScope.members.get(name);
    if (existingMember !== undefined) {
      const memberData = p.refToTSNamespaceMemberData.get(existingMember.ref);
      if (memberData !== undefined && memberData !== null && memberData.k === TS_NAMESPACE_MEMBER_NAMESPACE) {
        return memberData.exportedMembers;
      }
    }

    // Merge with a sibling namespace from a different scope
    if (isExport) {
      const parentNamespace = p.currentScope.tsNamespace;
      if (parentNamespace !== null) {
        const existing = parentNamespace.exportedMembers.get(name);
        if (existing !== undefined && existing.data !== null && existing.data.k === TS_NAMESPACE_MEMBER_NAMESPACE) {
          return existing.data.exportedMembers;
        }
      }
    }

    // Otherwise, generate a new namespace object
    return new Map();
  },

  parseTypeScriptNamespaceStmt(loc, opts) {
    const p = this;
    // "namespace Foo {}"
    const nameLoc = p.lexer.loc();
    const nameText = p.lexer.identifier;
    p.lexer.next();

    // Generate the namespace object
    const exportedMembers = p.getOrCreateExportedNamespaceMembers(nameText, opts.isExport);
    const tsNamespace = new TSNamespaceScope(exportedMembers, null, InvalidRef, false);
    const nsMemberData = new TSNamespaceMemberNamespace(exportedMembers);

    // Declare the namespace and create the scope
    let nameRef = InvalidRef; // Go: name := ast.LocRef{Loc: nameLoc, Ref: ast.InvalidRef}
    const scopeIndex = p.pushScopeForParsePass(ScopeEntry, loc);
    p.currentScope.tsNamespace = tsNamespace;

    const oldHasNonLocalExportDeclareInsideNamespace = p.hasNonLocalExportDeclareInsideNamespace;
    const oldFnOrArrowData = p.fnOrArrowDataParse;
    p.hasNonLocalExportDeclareInsideNamespace = false;
    const newFnOrArrowData = new fnOrArrowDataParse();
    newFnOrArrowData.isThisDisallowed = true;
    newFnOrArrowData.isReturnDisallowed = true;
    newFnOrArrowData.needsAsyncLoc = -1;
    p.fnOrArrowDataParse = newFnOrArrowData;

    // Parse the statements inside the namespace
    let stmts = []; // Go: nil (never observable, see the "isTypeScriptDeclare" check below)
    if (p.lexer.token === TDot) {
      const dotLoc = p.lexer.loc();
      p.lexer.next();
      const nestedOpts = new parseStmtOpts();
      nestedOpts.isExport = true;
      nestedOpts.isNamespaceScope = true;
      nestedOpts.isTypeScriptDeclare = opts.isTypeScriptDeclare;
      stmts = [p.parseTypeScriptNamespaceStmt(dotLoc, nestedOpts)];
    } else if (opts.isTypeScriptDeclare && p.lexer.token !== TOpenBrace) {
      p.lexer.expectOrInsertSemicolon();
    } else {
      p.lexer.expect(TOpenBrace);
      const bodyOpts = new parseStmtOpts();
      bodyOpts.isNamespaceScope = true;
      bodyOpts.isTypeScriptDeclare = opts.isTypeScriptDeclare;
      stmts = p.parseStmtsUpTo(TCloseBrace, bodyOpts);
      p.lexer.next();
    }

    const hasNonLocalExportDeclareInsideNamespace = p.hasNonLocalExportDeclareInsideNamespace;
    p.hasNonLocalExportDeclareInsideNamespace = oldHasNonLocalExportDeclareInsideNamespace;
    p.fnOrArrowDataParse = oldFnOrArrowData;

    // Add any exported members from this namespace's body as members of the
    // associated namespace object.
    for (const stmt of stmts) {
      const s = stmt.data;
      switch (s.k) {
        case S_FUNCTION:
          if (s.isExport) {
            const name = p.symbols[refInner(s.fn.name.ref)].originalName;
            const member = new TSNamespaceMember(new TSNamespaceMemberProperty(), s.fn.name.loc);
            exportedMembers.set(name, member);
            p.refToTSNamespaceMemberData.set(s.fn.name.ref, member.data);
          }
          break;

        case S_CLASS:
          if (s.isExport) {
            const name = p.symbols[refInner(s.class.name.ref)].originalName;
            const member = new TSNamespaceMember(new TSNamespaceMemberProperty(), s.class.name.loc);
            exportedMembers.set(name, member);
            p.refToTSNamespaceMemberData.set(s.class.name.ref, member.data);
          }
          break;

        case S_NAMESPACE:
          if (s.isExport) {
            const memberData = p.refToTSNamespaceMemberData.get(s.name.ref);
            if (memberData !== undefined && memberData !== null && memberData.k === TS_NAMESPACE_MEMBER_NAMESPACE) {
              const member = new TSNamespaceMember(new TSNamespaceMemberNamespace(memberData.exportedMembers), s.name.loc);
              exportedMembers.set(p.symbols[refInner(s.name.ref)].originalName, member);
              p.refToTSNamespaceMemberData.set(s.name.ref, member.data);
            }
          }
          break;

        case S_ENUM:
          if (s.isExport) {
            const memberData = p.refToTSNamespaceMemberData.get(s.name.ref);
            if (memberData !== undefined && memberData !== null && memberData.k === TS_NAMESPACE_MEMBER_NAMESPACE) {
              const member = new TSNamespaceMember(new TSNamespaceMemberNamespace(memberData.exportedMembers), s.name.loc);
              exportedMembers.set(p.symbols[refInner(s.name.ref)].originalName, member);
              p.refToTSNamespaceMemberData.set(s.name.ref, member.data);
            }
          }
          break;

        case S_LOCAL:
          if (s.isExport) {
            forEachIdentifierBindingInDecls(s.decls, (loc, b) => {
              const name = p.symbols[refInner(b.ref)].originalName;
              const member = new TSNamespaceMember(new TSNamespaceMemberProperty(), loc);
              exportedMembers.set(name, member);
              p.refToTSNamespaceMemberData.set(b.ref, member.data);
            });
          }
          break;
      }
    }

    // Import assignments may be only used in type expressions, not value
    // expressions. If this is the case, the TypeScript compiler removes
    // them entirely from the output. That can cause the namespace itself
    // to be considered empty and thus be removed.
    let importEqualsCount = 0;
    for (const stmt of stmts) {
      const local = stmt.data;
      if (local.k === S_LOCAL && local.wasTSImportEquals && !local.isExport) {
        importEqualsCount++;
      }
    }

    // TypeScript omits namespaces without values. These namespaces
    // are only allowed to be used in type expressions. They are
    // allowed to be exported, but can also only be used in type
    // expressions when imported. So we shouldn't count them as a
    // real export either.
    //
    // TypeScript also strangely counts namespaces containing only
    // "export declare" statements as non-empty even though "declare"
    // statements are only type annotations. We cannot omit the namespace
    // in that case. See https://github.com/evanw/esbuild/issues/1158.
    if ((stmts.length === importEqualsCount && !hasNonLocalExportDeclareInsideNamespace) || opts.isTypeScriptDeclare) {
      p.popAndDiscardScope(scopeIndex);
      if (opts.isModuleScope) {
        p.localTypeNames.set(nameText, true);
      }
      return new Stmt(STypeScriptShared, loc);
    }

    if (!opts.isTypeScriptDeclare) {
      // Avoid a collision with the namespace closure argument variable if the
      // namespace exports a symbol with the same name as the namespace itself:
      //
      //   namespace foo {
      //     export let foo = 123
      //     console.log(foo)
      //   }
      //
      // TypeScript generates the following code in this case:
      //
      //   var foo;
      //   (function (foo_1) {
      //     foo_1.foo = 123;
      //     console.log(foo_1.foo);
      //   })(foo || (foo = {}));
      //
      if (p.currentScope.members.has(nameText)) {
        // Add a "_" to make tests easier to read, since non-bundler tests don't
        // run the renamer. For external-facing things the renamer will avoid
        // collisions automatically so this isn't important for correctness.
        tsNamespace.argRef = p.newSymbol(SymbolHoisted, "_" + nameText);
        p.currentScope.generated.push(tsNamespace.argRef);
      } else {
        tsNamespace.argRef = p.declareSymbol(SymbolHoisted, nameLoc, nameText);
      }
      p.refToTSNamespaceMemberData.set(tsNamespace.argRef, nsMemberData);
    }

    p.popScope();
    if (!opts.isTypeScriptDeclare) {
      nameRef = p.declareSymbol(SymbolTSNamespace, nameLoc, nameText);
      p.refToTSNamespaceMemberData.set(nameRef, nsMemberData);
    }
    return new Stmt(new SNamespace(stmts, new LocRef(nameLoc, nameRef), tsNamespace.argRef, opts.isExport), loc);
  },

  // Note: "stmts" is appended to in place (callers always use the result:
  // "stmts = p.generateClosure...(stmts, ...)").
  generateClosureForTypeScriptNamespaceOrEnum(stmts, stmtLoc, isExport, nameLoc, nameRef, argRef, stmtsInsideClosure) {
    const p = this;
    // Follow the link chain in case symbols were merged
    let symbol = p.symbols[refInner(nameRef)];
    while (symbol.link !== InvalidRef) {
      nameRef = symbol.link;
      symbol = p.symbols[refInner(nameRef)];
    }

    // Make sure to only emit a variable once for a given namespace, since there
    // can be multiple namespace blocks for the same namespace
    if ((symbol.kind === SymbolTSNamespace || symbol.kind === SymbolTSEnum) && !p.emittedNamespaceVars.get(nameRef)) {
      const decls = [new Decl(new Binding(new BIdentifier(nameRef), nameLoc))];
      p.emittedNamespaceVars.set(nameRef, true);
      if (p.currentScope === p.moduleScope) {
        // Top-level namespace: "var"
        stmts.push(new Stmt(new SLocal(decls, LocalVar, isExport), stmtLoc));
      } else {
        // Nested namespace: "let"
        stmts.push(new Stmt(new SLocal(decls, LocalLet), stmtLoc));
      }
    }

    let argExpr;
    if (p.options.minifySyntax && !jsFeatureHas(p.options.unsupportedJSFeatures, LogicalAssignment)) {
      // If the "||=" operator is supported, our minified output can be slightly smaller
      if (isExport && p.enclosingNamespaceArgRef !== null) {
        // "name = (enclosing.name ||= {})"
        argExpr = assign(
          new Expr(new EIdentifier(nameRef), nameLoc),
          new Expr(
            new EBinary(
              new Expr(
                p.dotOrMangledPropVisit(
                  new Expr(new EIdentifier(p.enclosingNamespaceArgRef), nameLoc),
                  p.symbols[refInner(nameRef)].originalName,
                  nameLoc,
                ),
                nameLoc,
              ),
              new Expr(new EObject(), nameLoc),
              BinOpLogicalOrAssign,
            ),
            nameLoc,
          ),
        );
        p.recordUsage(p.enclosingNamespaceArgRef);
        p.recordUsage(nameRef);
      } else {
        // "name ||= {}"
        argExpr = new Expr(
          new EBinary(new Expr(new EIdentifier(nameRef), nameLoc), new Expr(new EObject(), nameLoc), BinOpLogicalOrAssign),
          nameLoc,
        );
        p.recordUsage(nameRef);
      }
    } else {
      if (isExport && p.enclosingNamespaceArgRef !== null) {
        // "name = enclosing.name || (enclosing.name = {})"
        const name = p.symbols[refInner(nameRef)].originalName;
        argExpr = assign(
          new Expr(new EIdentifier(nameRef), nameLoc),
          new Expr(
            new EBinary(
              new Expr(p.dotOrMangledPropVisit(new Expr(new EIdentifier(p.enclosingNamespaceArgRef), nameLoc), name, nameLoc), nameLoc),
              assign(
                new Expr(p.dotOrMangledPropVisit(new Expr(new EIdentifier(p.enclosingNamespaceArgRef), nameLoc), name, nameLoc), nameLoc),
                new Expr(new EObject(), nameLoc),
              ),
              BinOpLogicalOr,
            ),
            nameLoc,
          ),
        );
        p.recordUsage(p.enclosingNamespaceArgRef);
        p.recordUsage(p.enclosingNamespaceArgRef);
        p.recordUsage(nameRef);
      } else {
        // "name || (name = {})"
        argExpr = new Expr(
          new EBinary(
            new Expr(new EIdentifier(nameRef), nameLoc),
            assign(new Expr(new EIdentifier(nameRef), nameLoc), new Expr(new EObject(), nameLoc)),
            BinOpLogicalOr,
          ),
          nameLoc,
        );
        p.recordUsage(nameRef);
        p.recordUsage(nameRef);
      }
    }

    // Try to use an arrow function if possible for compactness
    let targetExpr;
    const args = [new Arg(new Binding(new BIdentifier(argRef), nameLoc))];
    if (jsFeatureHas(p.options.unsupportedJSFeatures, Arrow)) {
      // (Go's js_ast.Fn{} zero value has ArgumentsRef == ast.Ref{} == 0)
      targetExpr = new Expr(new EFunction(new Fn(null, args, new FnBody(new SBlock(stmtsInsideClosure), stmtLoc), 0)), stmtLoc);
    } else {
      // "(() => { foo() })()" => "(() => foo())()"
      if (p.options.minifySyntax && stmtsInsideClosure.length === 1) {
        const expr = stmtsInsideClosure[0].data;
        if (expr.k === S_EXPR) {
          stmtsInsideClosure[0] = new Stmt(new SReturn(expr.value), stmtsInsideClosure[0].loc);
        }
      }
      targetExpr = new Expr(
        new EArrow(args, new FnBody(new SBlock(stmtsInsideClosure), stmtLoc), false, false, true /* preferExpr */),
        stmtLoc,
      );
    }

    // Call the closure with the name object
    stmts.push(new Stmt(new SExpr(new Expr(new ECall(targetExpr, [argExpr]), stmtLoc)), stmtLoc));

    return stmts;
  },

  // Note: "stmts" is appended to in place (callers always use the result).
  generateClosureForTypeScriptEnum(stmts, stmtLoc, isExport, nameLoc, nameRef, argRef, exprsInsideClosure, allValuesArePure) {
    const p = this;
    // Bail back to the namespace code for enums that aren't at the top level.
    // Doing this for nested enums is problematic for two reasons. First of all
    // enums inside of namespaces must be property accesses off the namespace
    // object instead of variable declarations. Also we'd need to use "let"
    // instead of "var" which doesn't allow sibling declarations to be merged.
    if (p.currentScope !== p.moduleScope) {
      const stmtsInsideClosure = [];
      if (exprsInsideClosure.length > 0) {
        if (p.options.minifySyntax) {
          // "a; b; c;" => "a, b, c;"
          const joined = joinAllWithComma(exprsInsideClosure);
          stmtsInsideClosure.push(new Stmt(new SExpr(joined), joined.loc));
        } else {
          for (const expr of exprsInsideClosure) {
            stmtsInsideClosure.push(new Stmt(new SExpr(expr), expr.loc));
          }
        }
      }
      return p.generateClosureForTypeScriptNamespaceOrEnum(stmts, stmtLoc, isExport, nameLoc, nameRef, argRef, stmtsInsideClosure);
    }

    // This uses an output format for enums that's different but equivalent to
    // what TypeScript uses. Here is TypeScript's output:
    //
    //   var x;
    //   (function (x) {
    //     x[x["y"] = 1] = "y";
    //   })(x || (x = {}));
    //
    // And here's our output:
    //
    //   var x = /* @__PURE__ */ ((x) => {
    //     x[x["y"] = 1] = "y";
    //     return x;
    //   })(x || {});
    //
    // One benefit is that the minified output is smaller:
    //
    //   // Old output minified
    //   var x;(function(n){n[n.y=1]="y"})(x||(x={}));
    //
    //   // New output minified
    //   var x=(r=>(r[r.y=1]="y",r))(x||{});
    //
    // Another benefit is that the @__PURE__ annotation means it automatically
    // works with tree-shaking, even with more advanced features such as sibling
    // enum declarations and enum/namespace merges. Ideally all uses of the enum
    // are just direct references to enum members (and are therefore inlined as
    // long as the enum value is a constant) and the enum definition itself is
    // unused and can be removed as dead code.

    // Follow the link chain in case symbols were merged
    let symbol = p.symbols[refInner(nameRef)];
    while (symbol.link !== InvalidRef) {
      nameRef = symbol.link;
      symbol = p.symbols[refInner(nameRef)];
    }

    // Generate the body of the closure, including a return statement at the end
    const stmtsInsideClosure = [];
    const argExpr = new Expr(new EIdentifier(argRef), nameLoc);
    if (p.options.minifySyntax) {
      // "a; b; return c;" => "return a, b, c;"
      let joined = joinAllWithComma(exprsInsideClosure);
      joined = joinWithComma(joined, argExpr);
      stmtsInsideClosure.push(new Stmt(new SReturn(joined), joined.loc));
    } else {
      for (const expr of exprsInsideClosure) {
        stmtsInsideClosure.push(new Stmt(new SExpr(expr), expr.loc));
      }
      stmtsInsideClosure.push(new Stmt(new SReturn(argExpr), argExpr.loc));
    }

    // Try to use an arrow function if possible for compactness
    let targetExpr;
    const args = [new Arg(new Binding(new BIdentifier(argRef), nameLoc))];
    if (jsFeatureHas(p.options.unsupportedJSFeatures, Arrow)) {
      // (Go's js_ast.Fn{} zero value has ArgumentsRef == ast.Ref{} == 0)
      targetExpr = new Expr(new EFunction(new Fn(null, args, new FnBody(new SBlock(stmtsInsideClosure), stmtLoc), 0)), stmtLoc);
    } else {
      targetExpr = new Expr(
        new EArrow(args, new FnBody(new SBlock(stmtsInsideClosure), stmtLoc), false, false, p.options.minifySyntax /* preferExpr */),
        stmtLoc,
      );
    }

    // Call the closure with the name object and store it to the variable
    const decls = [
      new Decl(
        new Binding(new BIdentifier(nameRef), nameLoc),
        new Expr(
          new ECall(
            targetExpr,
            [new Expr(new EBinary(new Expr(new EIdentifier(nameRef), nameLoc), new Expr(new EObject(), nameLoc), BinOpLogicalOr), nameLoc)],
            0, // closeParenLoc
            OptionalChainNone,
            NormalCall,
            false, // isMultiLine
            allValuesArePure, // canBeUnwrappedIfUnused
          ),
          stmtLoc,
        ),
      ),
    ];
    p.recordUsage(nameRef);

    // Use a "var" statement since this is a top-level enum, but only use "export" once
    stmts.push(new Stmt(new SLocal(decls, LocalVar, isExport && !p.emittedNamespaceVars.get(nameRef)), stmtLoc));
    p.emittedNamespaceVars.set(nameRef, true);

    return stmts;
  },

  wrapInlinedEnum(value, comment) {
    const p = this; // eslint-disable-line no-unused-vars
    if (comment.includes("*/")) {
      // Don't wrap with a comment
      return value;
    }

    // Wrap with a comment
    return new Expr(new EInlinedEnum(value, comment), value.loc);
  },
};
// generated from ts_parser.mts by tools/ts-build.mjs; edit that file
