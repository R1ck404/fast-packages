// Port of internal/js_parser/js_parser.go lines 1145-4263 (esbuild 0.28.2):
// scope handling for the parse pass, symbol declaration/merging/hoisting,
// usage tracking, runtime/JSX import helpers, deferred error logging and the
// expression parser from parseStringLiteral() up to parseExprCommon().
//
// Notes on the port (see CONVENTIONS.md):
// - storeNameInRef()/loadNameFromRef() are the identity on name strings.
// - The fast path always has UnsupportedJSFeatures == 0, so every
//   markSyntaxFeature(compat.X, r) call in this range (none of them is
//   compat.TopLevelAwait) is a no-op returning false and has been dropped
//   (marked "(markSyntaxFeature ... no-op)").
// - Error/warning messages are not built: the Log throws BAIL.
import { bail, LEXER_PANIC } from "./bail.mjs";
import { Range, RANGE_ZERO, rangeEnd, Warning, Debug, MsgID_JS_AssignToDefine, MsgData } from "./logger.mjs";
import { quoteSingle } from "./helpers.mjs";
import {
  InvalidRef,
  LocRef,
  Symbol as AstSymbol,
  makeRef,
  refInner,
  refSource,
  SymbolUnbound,
  SymbolHoisted,
  SymbolHoistedFunction,
  SymbolCatchIdentifier,
  SymbolGeneratorOrAsyncFunction,
  SymbolArguments,
  SymbolClass,
  SymbolPrivateField,
  SymbolPrivateMethod,
  SymbolPrivateGet,
  SymbolPrivateSet,
  SymbolPrivateGetSetPair,
  SymbolPrivateStaticField,
  SymbolPrivateStaticMethod,
  SymbolPrivateStaticGet,
  SymbolPrivateStaticSet,
  SymbolPrivateStaticGetSetPair,
  SymbolTSEnum,
  SymbolTSNamespace,
  SymbolImport,
  SymbolOther,
  SymbolMangledProp,
  symbolKindIsHoisted,
  symbolKindIsHoistedOrFunction,
  symbolKindIsFunction,
  MustNotBeRenamed,
  RemoveOverwrittenFunctionDeclaration,
  EvaluationPhase,
  DeferPhase,
  SourcePhase,
} from "./ast.mjs";
import {
  LLowest,
  LComma,
  LYield,
  LAssign,
  LCompare,
  LPrefix,
  LCall,
  LMember,
  UnOpPos,
  UnOpNeg,
  UnOpCpl,
  UnOpNot,
  UnOpVoid,
  UnOpTypeof,
  UnOpDelete,
  UnOpPreDec,
  UnOpPreInc,
  BinOpAssign,
  AssignTargetNone,
  Expr,
  Stmt,
  Binding,
  Property,
  PropertyBinding,
  Arg,
  FnBody,
  ArrayBinding,
  ClassStaticBlock,
  PropertyField,
  PropertyMethod,
  PropertyGetter,
  PropertySetter,
  PropertyAutoAccessor,
  PropertySpread,
  PropertyDeclareOrAbstract,
  PropertyClassStaticBlock,
  PropertyIsComputed,
  PropertyIsStatic,
  PropertyWasShorthand,
  PropertyPreferQuotedKey,
  propertyKindIsMethodDefinition,
  BMissingShared,
  BIdentifier,
  BArray,
  BObject,
  E_MISSING,
  E_IDENTIFIER,
  E_ARRAY,
  E_OBJECT,
  E_DOT,
  E_INDEX,
  E_ARROW,
  E_FUNCTION,
  E_CALL,
  E_NEW,
  E_STRING,
  E_PRIVATE_IDENTIFIER,
  EArray,
  EUnary,
  EBinary,
  EBoolean,
  ESuperShared,
  ENullShared,
  EThisShared,
  EMissingShared,
  ENew,
  ENewTarget,
  EImportMeta,
  ECall,
  EDot,
  EIndex,
  EArrow,
  EFunction,
  EIdentifier,
  EPrivateIdentifier,
  ENameOfSymbol,
  ENumber,
  EBigInt,
  EObject,
  ESpread,
  EString,
  ETemplate,
  ERegExp,
  EAwait,
  EYield,
  EImportCall,
  SBlock,
  SReturn,
  LocalVar,
  LocalLet,
  LocalConst,
  ScopeBlock,
  ScopeWith,
  ScopeCatchBinding,
  ScopeEntry,
  ScopeFunctionArgs,
  ScopeFunctionBody,
  ScopeClassStaticInit,
  scopeKindStopsHoisting,
  ScopeMember,
  SloppyMode,
  Scope,
  SymbolUse,
} from "./js_ast.mjs";
import { assign, joinAllWithComma, isPropertyAccess, forEachIdentifierBinding } from "./js_ast_helpers.mjs";
import { ModeBundle, True, shouldCallRuntimeRequire } from "./config.mjs";
import {
  Keywords,
  rangeOfIdentifier,
  PureCommentBefore,
  KeyCommentBefore,
  NoSideEffectsCommentBefore,
  TAsterisk,
  TAsteriskAsterisk,
  TAt,
  TBigIntegerLiteral,
  TClass,
  TCloseBrace,
  TCloseBracket,
  TCloseParen,
  TColon,
  TComma,
  TDelete,
  TDot,
  TDotDotDot,
  TEquals,
  TEqualsGreaterThan,
  TExclamation,
  TFalse,
  TFunction,
  TIdentifier,
  TImport,
  TIn,
  TLessThan,
  TMinus,
  TMinusMinus,
  TNew,
  TNoSubstitutionTemplateLiteral,
  TNull,
  TNumericLiteral,
  TOpenBrace,
  TOpenBracket,
  TOpenParen,
  TPlus,
  TPlusPlus,
  TPrivateIdentifier,
  TQuestion,
  TSemicolon,
  TSlash,
  TSlashEquals,
  TStringLiteral,
  TSuper,
  TTemplateHead,
  TThis,
  TTilde,
  TTrue,
  TTypeof,
  TVoid,
} from "./js_lexer.mjs";
import {
  scopeOrder,
  fnOrArrowDataParse,
  deferredErrors,
  deferredArrowArgErrors,
  propertyOpts,
  parenExprOpts,
  invalidLog,
  syntaxFeature,
  parseStmtOpts,
  parseBindingOpts,
  identifierOpts,
  allowIdent,
  allowExpr,
  forbidAll,
  mergeForbidden,
  mergeReplaceWithNew,
  mergeOverwriteWithNew,
  mergeKeepExisting,
  mergeBecomePrivateGetSetPair,
  mergeBecomePrivateStaticGetSetPair,
  JSXImportJSX,
  JSXImportJSXS,
  JSXImportFragment,
  JSXImportCreateElement,
  wasOriginallyIndex,
  exprFlagDecorator,
  exprFlagForLoopInit,
  exprFlagForAwaitLoopInit,
  exprFlagAfterQuestionAndBeforeColon,
  exprFlagIsNewTarget,
  allowConstModifier,
  didNotSkipAnything,
  definitelyTypeParameters,
  fnExpr,
  decoratorBeforeClassExpr,
} from "./js_parser_types.mjs";

// runtime.SourceIndex (internal/runtime is not a dependency of this module)
const runtimeSourceIndex = 0;

// Read-only "parseStmtOpts{}" passed to declareBinding() (which only reads it)
const PARSE_STMT_OPTS_ZERO = new parseStmtOpts();

// scopeMemberArray.Less: sort by (InnerIndex, SourceIndex).
// FIXME(sort-stability): Go's sort.Sort is not stable, but equal keys would
// mean the same symbol appears twice in one scope, which does not happen.
function scopeMemberCompare(a, b) {
  const ai = refInner(a.ref);
  const bi = refInner(b.ref);
  if (ai !== bi) return ai - bi;
  return refSource(a.ref) - refSource(b.ref);
}

// Stable sort with scopeMemberCompare (same result as Array.prototype.sort).
// Members are usually already in order, and small lists use an insertion sort
// instead of the builtin (which allocates a scratch copy).
function sortScopeMembers(a) {
  const n = a.length;
  let i = 1;
  while (i < n && scopeMemberCompare(a[i - 1], a[i]) <= 0) i++;
  if (i >= n) return;
  if (n > 64) {
    a.sort(scopeMemberCompare);
    return;
  }
  for (; i < n; i++) {
    const x = a[i];
    let j = i - 1;
    while (j >= 0 && scopeMemberCompare(a[j], x) > 0) {
      a[j + 1] = a[j];
      j--;
    }
    a[j + 1] = x;
  }
}

export function defineValueCanBeUsedInAssignTarget(data) {
  switch (data.k) {
    case E_IDENTIFIER:
    case E_DOT:
      return true;
  }

  // Substituting a constant into an assignment target (e.g. "x = 1" becomes
  // "0 = 1") will cause a syntax error, so we avoid doing this. The caller
  // will log a warning instead.
  return false;
}

// Methods on deferredErrors (receiver "from")
Object.assign(deferredErrors.prototype, {
  mergeInto(to) {
    const from = this;
    if (from.invalidExprDefaultValue.len > 0) {
      to.invalidExprDefaultValue = from.invalidExprDefaultValue;
    }
    if (from.invalidExprAfterQuestion.len > 0) {
      to.invalidExprAfterQuestion = from.invalidExprAfterQuestion;
    }
    if (from.arraySpreadFeature.len > 0) {
      to.arraySpreadFeature = from.arraySpreadFeature;
    }
    if (from.invalidParens.length > 0) {
      if (to.invalidParens.length > 0) {
        // Go: append(to.invalidParens, from.invalidParens...). "from" is
        // always a discarded local, so appending in place is safe.
        const src = from.invalidParens;
        for (let i = 0; i < src.length; i++) to.invalidParens.push(src[i]);
      } else {
        to.invalidParens = from.invalidParens;
      }
    }
  },
});

export const parseMethods = {
  selectLocalKind(kind) {
    const p = this;

    // Use "var" instead of "let" and "const" if they aren't supported
    // (compat.ConstAndLet is always supported in the fast path)

    // Use "var" instead of "let" and "const" if the variable declaration may
    // need to be separated from the initializer. This allows us to safely move
    // this declaration into a nested scope.
    if (
      p.currentScope.parent === null &&
      (kind === LocalLet || kind === LocalConst) &&
      (p.options.mode === ModeBundle || p.willWrapModuleInTryCatchForUsing)
    ) {
      return LocalVar;
    }

    // Optimization: use "let" instead of "const" because it's shorter. This is
    // only done when bundling because assigning to "const" is only an error when
    // bundling.
    if (p.options.mode === ModeBundle && kind === LocalConst && p.options.minifySyntax) {
      return LocalLet;
    }

    return kind;
  },

  pushScopeForParsePass(kind, loc) {
    const p = this;
    const parent = p.currentScope;
    const scope = new Scope();
    scope.kind = kind;
    scope.parent = parent;
    // (Members is a fresh Map and Label is {Ref: InvalidRef} by default)
    if (parent !== null) {
      parent.children.push(scope);
      scope.strictMode = parent.strictMode;
      scope.useStrictLoc = parent.useStrictLoc;
    }
    p.currentScope = scope;

    // Enforce that scope locations are strictly increasing to help catch bugs
    // where the pushed scopes are mismatched between the first and second passes
    if (p.scopesInOrder.length > 0) {
      const prevStart = p.scopesInOrder[p.scopesInOrder.length - 1].loc;
      if (prevStart >= loc) {
        bail(); // Go: panic("Scope location %d must be greater than %d")
      }
    }

    // Copy down function arguments into the function body scope. That way we get
    // errors if a statement in the function body tries to re-declare any of the
    // arguments.
    if (kind === ScopeFunctionBody) {
      if (scope.parent.kind !== ScopeFunctionArgs) {
        bail(); // Go: panic("Internal error")
      }
      for (const [name, member] of scope.parent.members) {
        // Don't copy down the optional function expression name. Re-declaring
        // the name of a function expression is allowed.
        const memberKind = p.symbols[refInner(member.ref)].kind;
        if (memberKind !== SymbolHoistedFunction) {
          scope.members.set(name, member);
        }
      }
    }

    // Remember the length in case we call popAndDiscardScope() later
    const scopeIndex = p.scopesInOrder.length;
    p.scopesInOrder.push(new scopeOrder(scope, loc));
    return scopeIndex;
  },

  popScope() {
    const p = this;

    // We cannot rename anything inside a scope containing a direct eval() call
    if (p.currentScope.containsDirectEval) {
      for (const member of p.currentScope.members.values()) {
        // Using direct eval when bundling is not a good idea in general because
        // esbuild must assume that it can potentially reach anything in any of
        // the containing scopes. We make an exception for top-level symbols in
        // an ESM file when bundling is enabled (see the Go source for details).
        if (p.options.mode === ModeBundle && p.currentScope.parent === null && p.isFileConsideredESM) {
          continue;
        }

        p.symbols[refInner(member.ref)].flags |= MustNotBeRenamed;
      }
    }

    p.currentScope = p.currentScope.parent;
  },

  popAndDiscardScope(scopeIndex) {
    const p = this;

    // Unwind any newly-added scopes in reverse order
    for (let i = p.scopesInOrder.length - 1; i >= scopeIndex; i--) {
      const scope = p.scopesInOrder[i].scope;
      const parent = scope.parent;
      const last = parent.children.length - 1;
      if (parent.children[last] !== scope) {
        bail(); // Go: panic("Internal error")
      }
      parent.children.pop();
    }

    // Move up to the parent scope
    p.currentScope = p.currentScope.parent;

    // Truncate the scope order where we started to pretend we never saw this scope
    p.scopesInOrder.length = scopeIndex;
  },

  popAndFlattenScope(scopeIndex) {
    const p = this;

    // Move up to the parent scope
    const toFlatten = p.currentScope;
    const parent = toFlatten.parent;
    p.currentScope = parent;

    // Erase this scope from the order. This will shift over the indices of all
    // the scopes that were created after us. However, we shouldn't have to
    // worry about other code with outstanding scope indices for these scopes.
    // These scopes were all created in between this scope's push and pop
    // operations, so they should all be child scopes and should all be popped
    // by the time we get here.
    p.scopesInOrder.splice(scopeIndex, 1);

    // Remove the last child from the parent scope
    const last = parent.children.length - 1;
    if (parent.children[last] !== toFlatten) {
      bail(); // Go: panic("Internal error")
    }
    parent.children.pop();

    // Reparent our child scopes into our parent
    for (let $i43 = 0, $a43 = toFlatten.children; $i43 < $a43.length; $i43++) {
      const scope = $a43[$i43];
      scope.parent = parent;
      parent.children.push(scope);
    }
  },

  // Undo all scopes pushed and popped after this scope index. This assumes that
  // the scope stack is at the same level now as it was at the given scope index.
  discardScopesUpTo(scopeIndex) {
    const p = this;

    // Remove any direct children from their parent
    const children = p.currentScope.children;
    for (let j = scopeIndex; j < p.scopesInOrder.length; j++) {
      const child = p.scopesInOrder[j];
      if (child.scope.parent === p.currentScope) {
        for (let i = children.length - 1; i >= 0; i--) {
          if (children[i] === child.scope) {
            children.splice(i, 1);
            break;
          }
        }
      }
    }
    p.currentScope.children = children;

    // Truncate the scope order where we started to pretend we never saw this scope
    p.scopesInOrder.length = scopeIndex;
  },

  newSymbol(kind, name) {
    const p = this;
    const ref = makeRef(p.source.index, p.symbols.length);
    p.symbols.push(new AstSymbol(null, name, InvalidRef, 0, -1, -1, 0, kind));
    if (p.options.ts.parse) {
      p.tsUseCounts.push(0);
    }
    return ref;
  },

  // This is similar to "ast.MergeSymbols" but it works with this parser's
  // one-level symbol map instead of the linker's two-level symbol map. It also
  // doesn't handle cycles since they shouldn't come up due to the way this
  // function is used.
  mergeSymbols(old, new_) {
    const p = this;
    if (old === new_) {
      return new_;
    }

    const oldSymbol = p.symbols[refInner(old)];
    if (oldSymbol.link !== InvalidRef) {
      oldSymbol.link = p.mergeSymbols(oldSymbol.link, new_);
      return oldSymbol.link;
    }

    const newSymbol = p.symbols[refInner(new_)];
    if (newSymbol.link !== InvalidRef) {
      newSymbol.link = p.mergeSymbols(old, newSymbol.link);
      return newSymbol.link;
    }

    oldSymbol.link = new_;
    newSymbol.mergeContentsWith(oldSymbol);
    return new_;
  },

  canMergeSymbols(scope, existing, new_) {
    const p = this;
    if (existing === SymbolUnbound) {
      return mergeReplaceWithNew;
    }

    // In TypeScript, imports are allowed to silently collide with symbols within
    // the module. Presumably this is because the imports may be type-only:
    //
    //   import {Foo} from 'bar'
    //   class Foo {}
    //
    if (p.options.ts.parse && existing === SymbolImport) {
      return mergeReplaceWithNew;
    }

    // "enum Foo {} enum Foo {}"
    if (new_ === SymbolTSEnum && existing === SymbolTSEnum) {
      return mergeKeepExisting;
    }

    // "namespace Foo { ... } enum Foo {}"
    if (new_ === SymbolTSEnum && existing === SymbolTSNamespace) {
      return mergeReplaceWithNew;
    }

    // "namespace Foo { ... } namespace Foo { ... }"
    // "function Foo() {} namespace Foo { ... }"
    // "enum Foo {} namespace Foo { ... }"
    if (new_ === SymbolTSNamespace) {
      switch (existing) {
        case SymbolTSNamespace:
        case SymbolHoistedFunction:
        case SymbolGeneratorOrAsyncFunction:
        case SymbolTSEnum:
        case SymbolClass:
          return mergeKeepExisting;
      }
    }

    // "var foo; var foo;"
    // "var foo; function foo() {}"
    // "function foo() {} var foo;"
    // "function *foo() {} function *foo() {}" but not "{ function *foo() {} function *foo() {} }"
    if (
      symbolKindIsHoistedOrFunction(new_) &&
      symbolKindIsHoistedOrFunction(existing) &&
      (scope.kind === ScopeEntry ||
        scope.kind === ScopeFunctionBody ||
        scope.kind === ScopeFunctionArgs ||
        (new_ === existing && symbolKindIsHoisted(new_)))
    ) {
      return mergeReplaceWithNew;
    }

    // "get #foo() {} set #foo() {}"
    // "set #foo() {} get #foo() {}"
    if ((existing === SymbolPrivateGet && new_ === SymbolPrivateSet) || (existing === SymbolPrivateSet && new_ === SymbolPrivateGet)) {
      return mergeBecomePrivateGetSetPair;
    }
    if (
      (existing === SymbolPrivateStaticGet && new_ === SymbolPrivateStaticSet) ||
      (existing === SymbolPrivateStaticSet && new_ === SymbolPrivateStaticGet)
    ) {
      return mergeBecomePrivateStaticGetSetPair;
    }

    // "try {} catch (e) { var e }"
    if (existing === SymbolCatchIdentifier && new_ === SymbolHoisted) {
      return mergeReplaceWithNew;
    }

    // "function() { var arguments }"
    if (existing === SymbolArguments && new_ === SymbolHoisted) {
      return mergeKeepExisting;
    }

    // "function() { let arguments }"
    if (existing === SymbolArguments && new_ !== SymbolHoisted) {
      return mergeOverwriteWithNew;
    }

    return mergeForbidden;
  },

  addSymbolAlreadyDeclaredError(name, newLoc, oldLoc) {
    const p = this;
    // "The symbol %q has already been declared"
    p.log.addErrorWithNotes();
  },

  declareSymbol(kind, loc, name) {
    const p = this;
    p.checkForUnrepresentableIdentifier(loc, name);

    // Allocate a new symbol
    let ref = p.newSymbol(kind, name);

    // Check for a collision in the declaring scope
    const existing = p.currentScope.members.get(name);
    if (existing !== undefined) {
      const symbol = p.symbols[refInner(existing.ref)];

      switch (p.canMergeSymbols(p.currentScope, symbol.kind, kind)) {
        case mergeForbidden:
          p.addSymbolAlreadyDeclaredError(name, loc, existing.loc);
          return existing.ref;

        case mergeKeepExisting:
          ref = existing.ref;
          break;

        case mergeReplaceWithNew:
          symbol.link = ref;
          p.currentScope.replaced.push(existing);

          // If these are both functions, remove the overwritten declaration
          if (p.options.minifySyntax && symbolKindIsFunction(kind) && symbolKindIsFunction(symbol.kind)) {
            symbol.flags |= RemoveOverwrittenFunctionDeclaration;
          }
          break;

        case mergeBecomePrivateGetSetPair:
          ref = existing.ref;
          symbol.kind = SymbolPrivateGetSetPair;
          break;

        case mergeBecomePrivateStaticGetSetPair:
          ref = existing.ref;
          symbol.kind = SymbolPrivateStaticGetSetPair;
          break;

        case mergeOverwriteWithNew:
          break;
      }
    }

    // Overwrite this name in the declaring scope
    p.currentScope.members.set(name, new ScopeMember(ref, loc));
    return ref;
  },

  hoistSymbols(scope       ) {
    const p = this;

    // Duplicate function declarations are forbidden in nested blocks in strict
    // mode. Separately, they are also forbidden at the top-level of modules.
    // This check needs to be delayed until now instead of being done when the
    // functions are declared because we potentially need to scan the whole file
    // to know if the file is considered to be in strict mode (or is considered
    // to be a module). We might only encounter an "export {}" clause at the end
    // of the file.
    if ((scope.strictMode !== SloppyMode && scope.kind === ScopeBlock) || (scope.parent === null && p.isFileConsideredESM)) {
      for (let $i44 = 0, $a44 = scope.replaced; $i44 < $a44.length; $i44++) {
        const replaced = $a44[$i44];
        const symbol = p.symbols[refInner(replaced.ref)];
        if (symbolKindIsFunction(symbol.kind)) {
          const member = scope.members.get(symbol.originalName);
          if (member !== undefined && symbolKindIsFunction(p.symbols[refInner(member.ref)].kind)) {
            // The notes come from p.whyESModule() / p.whyStrictMode(scope),
            // which only build message text; the error bails anyway.
            // "The symbol %q has already been declared"
            p.log.addErrorWithNotes();
          }
        }
      }
    }

    if (!scopeKindStopsHoisting(scope.kind) && scope.members.size > 0) { // (JS-only: skip the empty case)
      // We create new symbols in the loop below, so the iteration order of the
      // loop must be deterministic to avoid generating different minified names
      const sortedMembers = Array.from(scope.members.values());
      sortScopeMembers(sortedMembers);

      nextMember: for (let member of sortedMembers) {
        let symbol = p.symbols[refInner(member.ref)];

        // Handle non-hoisted collisions between catch bindings and the catch body.
        // This implements "B.3.4 VariableStatements in Catch Blocks" from Annex B
        // of the ECMAScript standard version 6+ (except for the hoisted case, which
        // is handled later on below):
        //
        // * It is a Syntax Error if any element of the BoundNames of CatchParameter
        //   also occurs in the LexicallyDeclaredNames of Block.
        //
        // * It is a Syntax Error if any element of the BoundNames of CatchParameter
        //   also occurs in the VarDeclaredNames of Block unless CatchParameter is
        //   CatchParameter : BindingIdentifier .
        //
        if (scope.parent.kind === ScopeCatchBinding && symbol.kind !== SymbolHoisted) {
          const existingMember = scope.parent.members.get(symbol.originalName);
          if (existingMember !== undefined) {
            p.addSymbolAlreadyDeclaredError(symbol.originalName, member.loc, existingMember.loc);
            continue;
          }
        }

        if (!symbolKindIsHoisted(symbol.kind)) {
          continue;
        }

        // Implement "Block-Level Function Declarations Web Legacy Compatibility
        // Semantics" from Annex B of the ECMAScript standard version 6+
        let isSloppyModeBlockLevelFnStmt = false;
        const originalMemberRef = member.ref;
        if (symbol.kind === SymbolHoistedFunction) {
          // Block-level function declarations behave like "let" in strict mode
          if (scope.strictMode !== SloppyMode) {
            continue;
          }

          // In sloppy mode, block level functions behave like "let" except with
          // an assignment to "var", sort of. This code:
          //
          //   if (x) {
          //     f();
          //     function f() {}
          //   }
          //   f();
          //
          // behaves like this code:
          //
          //   if (x) {
          //     let f2 = function() {}
          //     var f = f2;
          //     f2();
          //   }
          //   f();
          //
          const hoistedRef = p.newSymbol(SymbolHoisted, symbol.originalName);
          scope.generated.push(hoistedRef);
          if (p.hoistedRefForSloppyModeBlockFn === null) {
            p.hoistedRefForSloppyModeBlockFn = new Map();
          }
          p.hoistedRefForSloppyModeBlockFn.set(member.ref, hoistedRef);
          symbol = p.symbols[refInner(hoistedRef)];
          // Go modifies its local copy of the member ("member.Ref = hoistedRef")
          member = new ScopeMember(hoistedRef, member.loc);
          isSloppyModeBlockLevelFnStmt = true;
        }

        // Check for collisions that would prevent to hoisting "var" symbols up to the enclosing function scope
        let s = scope.parent;
        for (;;) {
          // Variable declarations hoisted past a "with" statement may actually end
          // up overwriting a property on the target of the "with" statement instead
          // of initializing the variable. We must not rename them or we risk
          // causing a behavior change.
          //
          //   var obj = { foo: 1 }
          //   with (obj) { var foo = 2 }
          //   assert(foo === undefined)
          //   assert(obj.foo === 2)
          //
          if (s.kind === ScopeWith) {
            symbol.flags |= MustNotBeRenamed;
          }

          const existingMember = s.members.get(symbol.originalName);
          if (existingMember !== undefined) {
            const existingSymbol = p.symbols[refInner(existingMember.ref)];

            // We can hoist the symbol from the child scope into the symbol in
            // this scope if:
            //
            //   - The symbol is unbound (i.e. a global variable access)
            //   - The symbol is also another hoisted variable
            //   - The symbol is a function of any kind and we're in a function or module scope
            //
            // Is this unbound (i.e. a global access) or also hoisted?
            if (
              existingSymbol.kind === SymbolUnbound ||
              existingSymbol.kind === SymbolHoisted ||
              (symbolKindIsFunction(existingSymbol.kind) && (s.kind === ScopeEntry || s.kind === ScopeFunctionBody))
            ) {
              // Silently merge this symbol into the existing symbol
              symbol.link = existingMember.ref;
              s.members.set(symbol.originalName, existingMember);
              continue nextMember;
            }

            // Otherwise if this isn't a catch identifier or "arguments", it's a collision
            if (existingSymbol.kind !== SymbolCatchIdentifier && existingSymbol.kind !== SymbolArguments) {
              // An identifier binding from a catch statement and a function
              // declaration can both silently shadow another hoisted symbol
              if (symbol.kind !== SymbolCatchIdentifier && symbol.kind !== SymbolHoistedFunction) {
                if (!isSloppyModeBlockLevelFnStmt) {
                  p.addSymbolAlreadyDeclaredError(symbol.originalName, member.loc, existingMember.loc);
                } else if (s === scope.parent) {
                  // Never mind about this, turns out it's not needed after all
                  p.hoistedRefForSloppyModeBlockFn.delete(originalMemberRef);
                }
              }
              continue nextMember;
            }

            // If this is a catch identifier, silently merge the existing symbol
            // into this symbol but continue hoisting past this catch scope
            existingSymbol.link = member.ref;
            s.members.set(symbol.originalName, member);
          }

          if (scopeKindStopsHoisting(s.kind)) {
            // Declare the member in the scope that stopped the hoisting
            s.members.set(symbol.originalName, member);
            break;
          }
          s = s.parent;
        }
      }
    }

    for (let $i45 = 0, $a45 = scope.children; $i45 < $a45.length; $i45++) {
      const child = $a45[$i45];
      p.hoistSymbols(child);
    }
  },

  declareBinding(kind, binding, opts) {
    const p = this;
    forEachIdentifierBinding(binding, (loc, b) => {
      if (!opts.isTypeScriptDeclare || (opts.isNamespaceScope && opts.isExport)) {
        b.ref = p.declareSymbol(kind, loc, p.loadNameFromRef(b.ref));
      }
    });
  },

  recordUsage(ref) {
    const p = this;

    // The use count stored in the symbol is used for generating symbol names
    // during minification. These counts shouldn't include references inside dead
    // code regions since those will be culled.
    if (!p.isControlFlowDead) {
      const symbol = p.symbols[refInner(ref)];
      symbol.useCountEstimate = (symbol.useCountEstimate + 1) >>> 0; // uint32
      const part = p.currentPart;
      if (part !== null) {
        const use = part.symbolUses.get(ref);
        if (use === undefined) {
          part.symbolUses.set(ref, new SymbolUse(1));
        } else {
          use.countEstimate = (use.countEstimate + 1) >>> 0; // uint32
        }
      }
    }

    // The correctness of TypeScript-to-JavaScript conversion relies on accurate
    // symbol use counts for the whole file, including dead code regions. This is
    // tracked separately in a parser-only data structure.
    if (p.options.ts.parse) {
      p.tsUseCounts[refInner(ref)]++;
    }
  },

  ignoreUsage(ref) {
    const p = this;

    // Roll back the use count increment in recordUsage()
    if (!p.isControlFlowDead) {
      const symbol = p.symbols[refInner(ref)];
      symbol.useCountEstimate = (symbol.useCountEstimate - 1) >>> 0; // uint32

      // Only remove this usage if we're currently processing a part
      const part = p.currentPart;
      if (part !== null) {
        const use = part.symbolUses.get(ref);
        const count = ((use === undefined ? 0 : use.countEstimate) - 1) >>> 0; // uint32
        if (count === 0) {
          part.symbolUses.delete(ref);
        } else if (use === undefined) {
          part.symbolUses.set(ref, new SymbolUse(count));
        } else {
          use.countEstimate = count;
        }
      }
    }

    // Don't roll back the "tsUseCounts" increment. This must be counted even if
    // the value is ignored because that's what the TypeScript compiler does.
  },

  ignoreUsageOfIdentifierInDotChain(expr) {
    const p = this;
    for (;;) {
      const e = expr.data;
      switch (e.k) {
        case E_IDENTIFIER:
          p.ignoreUsage(e.ref);
          break;

        case E_DOT:
          expr = e.target;
          continue;

        case E_INDEX:
          if (e.index.data.k === E_STRING) {
            expr = e.target;
            continue;
          }
          break;
      }

      return;
    }
  },

  importFromRuntime(loc, name) {
    const p = this;
    let it = p.runtimeImports.get(name);
    if (it === undefined) {
      it = new LocRef(loc, p.newSymbol(SymbolOther, name));
      p.moduleScope.generated.push(it.ref);
      p.runtimeImports.set(name, it);
    }
    p.recordUsage(it.ref);
    return new Expr(new EIdentifier(it.ref), loc);
  },

  callRuntime(loc, name, args) {
    const p = this;
    return new Expr(new ECall(p.importFromRuntime(loc, name), args), loc);
  },

  importJSXSymbol(loc, jsx) {
    const p = this;
    let symbols = null;
    let name = "";

    switch (jsx) {
      case JSXImportJSX:
        symbols = p.jsxRuntimeImports;
        if (p.options.jsx.development) {
          name = "jsxDEV";
        } else {
          name = "jsx";
        }
        break;

      case JSXImportJSXS:
        symbols = p.jsxRuntimeImports;
        if (p.options.jsx.development) {
          name = "jsxDEV";
        } else {
          name = "jsxs";
        }
        break;

      case JSXImportFragment:
        symbols = p.jsxRuntimeImports;
        name = "Fragment";
        break;

      case JSXImportCreateElement:
        symbols = p.jsxLegacyImports;
        name = "createElement";
        break;
    }

    let it = symbols.get(name);
    if (it === undefined) {
      it = new LocRef(loc, p.newSymbol(SymbolOther, name));
      p.moduleScope.generated.push(it.ref);
      p.isImportItem.set(it.ref, true);
      symbols.set(name, it);
    }

    p.recordUsage(it.ref);
    return p.handleIdentifier(
      loc,
      new EIdentifier(it.ref),
      new identifierOpts(AssignTargetNone, false, false, false, true /* wasOriginallyIdentifier */),
    );
  },

  valueToSubstituteForRequire(loc) {
    const p = this;
    if (p.source.index !== runtimeSourceIndex && shouldCallRuntimeRequire(p.options.mode, p.options.outputFormat)) {
      return p.importFromRuntime(loc, "__require");
    }

    p.recordUsage(p.requireRef);
    return new Expr(new EIdentifier(p.requireRef), loc);
  },

  makePromiseRef() {
    const p = this;
    if (p.promiseRef === InvalidRef) {
      p.promiseRef = p.newSymbol(SymbolUnbound, "Promise");
    }
    return p.promiseRef;
  },

  makeRegExpRef() {
    const p = this;
    if (p.regExpRef === InvalidRef) {
      p.regExpRef = p.newSymbol(SymbolUnbound, "RegExp");
      p.moduleScope.generated.push(p.regExpRef);
    }
    return p.regExpRef;
  },

  makeBigIntRef() {
    const p = this;
    if (p.bigIntRef === InvalidRef) {
      p.bigIntRef = p.newSymbol(SymbolUnbound, "BigInt");
      p.moduleScope.generated.push(p.bigIntRef);
    }
    return p.bigIntRef;
  },

  // The name is temporarily stored in the ref until the scope traversal pass
  // happens, at which point a symbol will be generated and the ref will point
  // to the symbol instead. In this port the "ref" simply is the name string.
  storeNameInRef(name) {
    return name;
  },

  // This is the inverse of storeNameInRef() above
  loadNameFromRef(ref) {
    if (typeof ref !== "string") {
      bail(); // Go: panic("Internal error: invalid symbol reference")
    }
    return ref;
  },

  logExprErrors(errors) {
    const p = this;
    if (errors.invalidExprDefaultValue.len > 0) {
      // "Unexpected \"=\""
      p.log.addError();
    }

    if (errors.invalidExprAfterQuestion.len > 0) {
      // "Unexpected %q"
      p.log.addError();
    }

    if (errors.arraySpreadFeature.len > 0) {
      // (markSyntaxFeature(compat.ArraySpread) no-op)
    }
  },

  logDeferredArrowArgErrors(errors) {
    const p = this;
    for (let i = 0; i < errors.invalidParens.length; i++) {
      // "Invalid binding pattern"
      p.log.addError();
    }
  },

  logNullishCoalescingErrorPrecedenceError(op) {
    const p = this;
    // "Cannot use %q with %q without parentheses"
    p.log.addErrorWithNotes();
  },

  logAssignToDefine(r, name, expr) {
    const p = this;

    // If this is a compound expression, pretty-print it for the error message.
    // We don't use a literal slice of the source text in case it contains
    // problematic things (e.g. spans multiple lines, has embedded comments).
    if (expr !== null) {
      const parts = [];
      for (;;) {
        const d = expr.data;
        if (d instanceof EIdentifier) {
          parts.push(p.loadNameFromRef(d.ref));
          break;
        } else if (d instanceof EDot) {
          parts.push(d.name);
          parts.push(".");
          expr = d.target;
        } else if (d instanceof EIndex) {
          const str = d.index.data;
          if (str instanceof EString) {
            parts.push("]");
            parts.push(quoteSingle(str.value, false));
            parts.push("[");
            expr = d.target;
          } else {
            return;
          }
        } else {
          return;
        }
      }
      parts.reverse();
      name = parts.join("");
    }

    let kind = Warning;
    if (p.suppressWarningsAboutWeirdCode) {
      kind = Debug;
    }

    // "Suspicious assignment to defined constant %q"
    p.log.addIDWithNotes(MsgID_JS_AssignToDefine, kind, p.tracker, r);
  },

  logArrowArgErrors(errors) {
    const p = this;
    if (errors.invalidExprAwait.len > 0) {
      // "Cannot use an \"await\" expression here:"
      p.log.addError();
    }

    if (errors.invalidExprYield.len > 0) {
      // "Cannot use a \"yield\" expression here:"
      p.log.addError();
    }
  },

  // (only used to build error messages, which bail; not Go-%q-exact)
  keyNameForError(key) {
    const p = this;
    const k = key.data;
    switch (k.k) {
      case E_STRING:
        return JSON.stringify(k.value);
      case E_PRIVATE_IDENTIFIER:
        return JSON.stringify(p.loadNameFromRef(k.ref));
    }
    return "property";
  },

  checkForLegacyOctalLiteral(e) {
    const p = this;
    if (p.lexer.isLegacyOctalLiteral) {
      if (p.legacyOctalLiterals === null) {
        p.legacyOctalLiterals = new Map();
      }
      p.legacyOctalLiterals.set(e, p.lexer.range());
    }
  },

  // Only used as notes for messages about JSON import assertions (bundle
  // mode only, and errors/warnings bail), so the ranges are not computed.
  notesForAssertTypeJSON(record, alias) {
    return [new MsgData("The JSON import assertion is here:"), new MsgData("")];
  },

  // This assumes the caller has already checked for TStringLiteral or TNoSubstitutionTemplateLiteral
  parseStringLiteral() {
    const p = this;
    let legacyOctalLoc = 0;
    const loc = p.lexer.loc();
    const text = p.lexer.stringLiteral();

    // Enable using a "/* @__KEY__ */" comment to turn a string into a key
    const hasPropertyKeyComment = (p.lexer.hasCommentBefore & KeyCommentBefore) !== 0;
    if (hasPropertyKeyComment) {
      const name = text; // helpers.UTF16ToString
      if (p.isMangledProp(name)) {
        const value = new Expr(new ENameOfSymbol(p.storeNameInRef(name), true /* hasPropertyKeyComment */), loc);
        p.lexer.next();
        return value;
      }
    }

    if (p.lexer.legacyOctalLoc > loc) {
      legacyOctalLoc = p.lexer.legacyOctalLoc;
    }
    const value = new Expr(
      new EString(text, legacyOctalLoc, p.lexer.token === TNoSubstitutionTemplateLiteral /* preferTemplate */, hasPropertyKeyComment),
      loc,
    );
    p.lexer.next();
    return value;
  },

  parseBigIntOrStringIfUnsupported() {
    const p = this;
    // (compat.Bigint is always supported in the fast path)
    return new Expr(new EBigInt(p.lexer.identifier), p.lexer.loc());
  },

  // Returns [property, ok]. "opts" is a Go value: it is cloned before any
  // modification so the caller's object is never changed.
  parseProperty(startLoc, kind, opts, errors) {
    const p = this;
    let flags = 0;
    let key = null;
    let closeBracketLoc = 0;
    // (Go's "keyRange := p.lexer.Range()" is only used for error messages)

    switch (p.lexer.token) {
      case TNumericLiteral:
        key = new Expr(new ENumber(p.lexer.number), p.lexer.loc());
        p.checkForLegacyOctalLiteral(key.data);
        p.lexer.next();
        break;

      case TStringLiteral:
        key = p.parseStringLiteral();
        if (!p.options.minifySyntax) {
          flags |= PropertyPreferQuotedKey;
        }
        break;

      case TBigIntegerLiteral:
        key = p.parseBigIntOrStringIfUnsupported();
        p.lexer.next();
        break;

      case TPrivateIdentifier: {
        if (p.options.ts.parse && p.options.ts.config.experimentalDecorators === True && opts.decorators.length > 0) {
          // "TypeScript experimental decorators cannot be used on private identifiers"
          p.log.addError();
        } else if (!opts.isClass) {
          p.lexer.expected(TIdentifier);
        } else if (opts.tsDeclareRange.len !== 0) {
          // "\"declare\" cannot be used with a private identifier"
          p.log.addError();
        }
        const name = p.lexer.identifier;
        key = new Expr(new EPrivateIdentifier(p.storeNameInRef(name)), p.lexer.loc());
        p.reportPrivateNameUsage(name);
        p.lexer.next();
        break;
      }

      case TOpenBracket: {
        flags |= PropertyIsComputed;
        // (markSyntaxFeature(compat.ObjectExtensions) no-op)
        p.lexer.next();
        const wasIdentifier = p.lexer.token === TIdentifier;
        const expr = p.parseExpr(LComma);

        // Handle index signatures
        if (p.options.ts.parse && p.lexer.token === TColon && wasIdentifier && opts.isClass) {
          if (expr.data instanceof EIdentifier) {
            if (opts.tsDeclareRange.len !== 0) {
              // "\"declare\" cannot be used with an index signature"
              p.log.addError();
            }

            // "[key: string]: any;"
            p.lexer.next();
            p.skipTypeScriptType(LLowest);
            p.lexer.expect(TCloseBracket);
            p.lexer.expect(TColon);
            p.skipTypeScriptType(LLowest);
            p.lexer.expectOrInsertSemicolon();

            // Skip this property entirely
            return [new Property(), false];
          }
        }

        closeBracketLoc = p.saveExprCommentsHere();
        p.lexer.expect(TCloseBracket);
        key = expr;
        break;
      }

      case TAsterisk:
        if (kind !== PropertyField && (kind !== PropertyMethod || opts.isGenerator)) {
          p.lexer.unexpected();
        }
        opts = opts.clone();
        opts.isGenerator = true;
        opts.generatorRange = p.lexer.range();
        p.lexer.next();
        return p.parseProperty(startLoc, PropertyMethod, opts, errors);

      default: {
        const name = p.lexer.identifier;
        const raw = p.lexer.raw();
        const nameRange = p.lexer.range();
        if (!p.lexer.isIdentifierOrKeyword()) {
          p.lexer.expect(TIdentifier);
        }
        p.lexer.next();

        // Support contextual keywords
        if (kind === PropertyField) {
          // Does the following token look like a key?
          let couldBeModifierKeyword = p.lexer.isIdentifierOrKeyword();
          if (!couldBeModifierKeyword) {
            switch (p.lexer.token) {
              case TOpenBracket:
              case TNumericLiteral:
              case TStringLiteral:
              case TPrivateIdentifier:
                couldBeModifierKeyword = true;
                break;
              case TAsterisk:
                if (opts.isAsync || (raw !== "get" && raw !== "set")) {
                  couldBeModifierKeyword = true;
                }
                break;
            }
          }

          // If so, check for a modifier keyword
          if (couldBeModifierKeyword) {
            switch (raw) {
              case "get":
                if (!opts.isAsync) {
                  // (markSyntaxFeature(compat.ObjectAccessors) no-op)
                  return p.parseProperty(startLoc, PropertyGetter, opts, null);
                }
                break;

              case "set":
                if (!opts.isAsync) {
                  // (markSyntaxFeature(compat.ObjectAccessors) no-op)
                  return p.parseProperty(startLoc, PropertySetter, opts, null);
                }
                break;

              case "accessor":
                if (!p.lexer.hasNewlineBefore && !opts.isAsync && opts.isClass) {
                  return p.parseProperty(startLoc, PropertyAutoAccessor, opts, null);
                }
                break;

              case "async":
                if (!p.lexer.hasNewlineBefore && !opts.isAsync) {
                  opts = opts.clone();
                  opts.isAsync = true;
                  opts.asyncRange = nameRange;
                  return p.parseProperty(startLoc, PropertyMethod, opts, null);
                }
                break;

              case "static":
                if (!opts.isStatic && !opts.isAsync && opts.isClass) {
                  opts = opts.clone();
                  opts.isStatic = true;
                  return p.parseProperty(startLoc, kind, opts, null);
                }
                break;

              case "declare":
                if (!p.lexer.hasNewlineBefore && opts.isClass && p.options.ts.parse && opts.tsDeclareRange.len === 0) {
                  opts = opts.clone();
                  opts.tsDeclareRange = nameRange;
                  const scopeIndex = p.scopesInOrder.length;

                  const $d101 = p.parseProperty(startLoc, kind, opts, null);
                  const prop = $d101[0], ok = $d101[1];
                  if (
                    ok &&
                    prop.kind === PropertyField &&
                    prop.valueOrNil === null &&
                    p.options.ts.config.experimentalDecorators === True &&
                    opts.decorators.length > 0
                  ) {
                    // If this is a well-formed class field with the "declare" keyword,
                    // only keep the declaration to preserve its side-effects when
                    // there are TypeScript experimental decorators present:
                    //
                    //   class Foo {
                    //     // Remove this
                    //     declare [(console.log('side effect 1'), 'foo')]
                    //
                    //     // Keep this
                    //     @decorator(console.log('side effect 2')) declare bar
                    //   }
                    //
                    // This behavior is surprisingly somehow valid with TypeScript
                    // experimental decorators, which was possibly by accident.
                    // TypeScript does not allow this with JavaScript decorators.
                    //
                    // References:
                    //
                    //   https://github.com/evanw/esbuild/issues/1675
                    //   https://github.com/microsoft/TypeScript/issues/46345
                    //
                    prop.kind = PropertyDeclareOrAbstract;
                    return [prop, true];
                  }

                  p.discardScopesUpTo(scopeIndex);
                  return [new Property(), false];
                }
                break;

              case "abstract":
                if (!p.lexer.hasNewlineBefore && opts.isClass && p.options.ts.parse && !opts.isTSAbstract) {
                  opts = opts.clone();
                  opts.isTSAbstract = true;
                  const scopeIndex = p.scopesInOrder.length;

                  const $d102 = p.parseProperty(startLoc, kind, opts, null);
                  const prop = $d102[0], ok = $d102[1];
                  if (
                    ok &&
                    prop.kind === PropertyField &&
                    prop.valueOrNil === null &&
                    p.options.ts.config.experimentalDecorators === True &&
                    opts.decorators.length > 0
                  ) {
                    // If this is a well-formed class field with the "abstract" keyword,
                    // only keep the declaration to preserve its side-effects when
                    // there are TypeScript experimental decorators present:
                    //
                    //   abstract class Foo {
                    //     // Remove this
                    //     abstract [(console.log('side effect 1'), 'foo')]
                    //
                    //     // Keep this
                    //     @decorator(console.log('side effect 2')) abstract bar
                    //   }
                    //
                    // This behavior is valid with TypeScript experimental decorators.
                    // TypeScript does not allow this with JavaScript decorators.
                    //
                    // References:
                    //
                    //   https://github.com/evanw/esbuild/issues/3684
                    //
                    prop.kind = PropertyDeclareOrAbstract;
                    return [prop, true];
                  }

                  p.discardScopesUpTo(scopeIndex);
                  return [new Property(), false];
                }
                break;

              case "private":
              case "protected":
              case "public":
              case "readonly":
              case "override":
                // Skip over TypeScript keywords
                if (opts.isClass && p.options.ts.parse) {
                  return p.parseProperty(startLoc, kind, opts, null);
                }
                break;
            }
          } else if (p.lexer.token === TOpenBrace && name === "static" && opts.decorators.length === 0) {
            const loc = p.lexer.loc();
            p.lexer.next();

            const oldFnOrArrowDataParse = p.fnOrArrowDataParse;
            const data = new fnOrArrowDataParse();
            data.isReturnDisallowed = true;
            data.allowSuperProperty = true;
            data.await = forbidAll;
            p.fnOrArrowDataParse = data;

            p.pushScopeForParsePass(ScopeClassStaticInit, loc);
            const stmts = p.parseStmtsUpTo(TCloseBrace, new parseStmtOpts());
            p.popScope();

            p.fnOrArrowDataParse = oldFnOrArrowDataParse;

            const closeBraceLoc = p.lexer.loc();
            p.lexer.expect(TCloseBrace);
            return [
              new Property(
                new ClassStaticBlock(new SBlock(stmts, closeBraceLoc), loc),
                null,
                null,
                null,
                [],
                startLoc,
                0,
                PropertyClassStaticBlock,
                0,
              ),
              true,
            ];
          }
        }

        if (p.isMangledProp(name)) {
          key = new Expr(new ENameOfSymbol(p.storeNameInRef(name), true /* hasPropertyKeyComment */), nameRange.loc);
        } else {
          key = new Expr(new EString(name), nameRange.loc);
        }

        // Parse a shorthand property
        if (
          !opts.isClass &&
          kind === PropertyField &&
          p.lexer.token !== TColon &&
          p.lexer.token !== TOpenParen &&
          p.lexer.token !== TLessThan &&
          (Keywords.get(name) ?? 0) === 0
        ) {
          // Forbid invalid identifiers
          if ((p.fnOrArrowDataParse.await !== allowIdent && name === "await") || (p.fnOrArrowDataParse.yield !== allowIdent && name === "yield")) {
            // "Cannot use %q as an identifier here:"
            p.log.addError();
          }

          const ref = p.storeNameInRef(name);
          const value = new Expr(new EIdentifier(ref), key.loc);

          // Destructuring patterns have an optional default value
          let initializerOrNil = null;
          if (errors !== null && p.lexer.token === TEquals) {
            errors.invalidExprDefaultValue = p.lexer.range();
            p.lexer.next();
            initializerOrNil = p.parseExpr(LComma);
          }

          return [new Property(null, key, value, initializerOrNil, [], startLoc, 0, kind, PropertyWasShorthand), true];
        }
        break;
      }
    }

    let hasTypeParameters = false;
    let hasDefiniteAssignmentAssertionOperator = false;

    if (p.options.ts.parse) {
      if (opts.isClass) {
        if (p.lexer.token === TQuestion) {
          // "class X { foo?: number }"
          // "class X { foo?(): number }"
          p.lexer.next();
        } else if (
          p.lexer.token === TExclamation &&
          !p.lexer.hasNewlineBefore &&
          (kind === PropertyField || kind === PropertyAutoAccessor)
        ) {
          // "class X { foo!: number }"
          p.lexer.next();
          hasDefiniteAssignmentAssertionOperator = true;
        }
      }

      // "class X { foo?<T>(): T }"
      // "const x = { foo<T>(): T {} }"
      if (!hasDefiniteAssignmentAssertionOperator && kind !== PropertyAutoAccessor) {
        hasTypeParameters = p.skipTypeScriptTypeParameters(allowConstModifier) !== didNotSkipAnything;
      }
    }

    // Parse a class field with an optional initial value
    if (
      kind === PropertyAutoAccessor ||
      (opts.isClass &&
        kind === PropertyField &&
        !hasTypeParameters &&
        (p.lexer.token !== TOpenParen || hasDefiniteAssignmentAssertionOperator))
    ) {
      let initializerOrNil = null;

      // Forbid the names "constructor" and "prototype" in some cases
      if ((flags & PropertyIsComputed) === 0) {
        const str = key.data;
        if (str instanceof EString && (str.value === "constructor" || (opts.isStatic && str.value === "prototype"))) {
          // "Invalid field name %q"
          p.log.addError();
        }
      }

      // Skip over types
      if (p.options.ts.parse && p.lexer.token === TColon) {
        p.lexer.next();
        p.skipTypeScriptType(LLowest);
      }

      if (p.lexer.token === TEquals) {
        p.lexer.next();

        // "this" and "super" property access is allowed in field initializers
        const oldIsThisDisallowed = p.fnOrArrowDataParse.isThisDisallowed;
        const oldAllowSuperProperty = p.fnOrArrowDataParse.allowSuperProperty;
        p.fnOrArrowDataParse.isThisDisallowed = false;
        p.fnOrArrowDataParse.allowSuperProperty = true;

        initializerOrNil = p.parseExpr(LComma);

        p.fnOrArrowDataParse.isThisDisallowed = oldIsThisDisallowed;
        p.fnOrArrowDataParse.allowSuperProperty = oldAllowSuperProperty;
      }

      // Special-case private identifiers
      const private_ = key.data;
      if (private_ instanceof EPrivateIdentifier) {
        const name = p.loadNameFromRef(private_.ref);
        if (name === "#constructor") {
          // "Invalid field name %q"
          p.log.addError();
        }
        let declare;
        if (kind === PropertyAutoAccessor) {
          if (opts.isStatic) {
            declare = SymbolPrivateStaticGetSetPair;
          } else {
            declare = SymbolPrivateGetSetPair;
          }
          private_.ref = p.declareSymbol(declare, key.loc, name);
          p.privateGetters.set(private_.ref, p.newSymbol(SymbolOther, name.slice(1) + "_get"));
          p.privateSetters.set(private_.ref, p.newSymbol(SymbolOther, name.slice(1) + "_set"));
        } else {
          if (opts.isStatic) {
            declare = SymbolPrivateStaticField;
          } else {
            declare = SymbolPrivateField;
          }
          private_.ref = p.declareSymbol(declare, key.loc, name);
        }
      }

      p.lexer.expectOrInsertSemicolon();
      if (opts.isStatic) {
        flags |= PropertyIsStatic;
      }
      return [new Property(null, key, null, initializerOrNil, opts.decorators, startLoc, closeBracketLoc, kind, flags), true];
    }

    // Parse a method expression
    if (p.lexer.token === TOpenParen || propertyKindIsMethodDefinition(kind) || opts.isClass) {
      let hasError = false;

      if (!hasError && opts.tsDeclareRange.len !== 0) {
        // "\"declare\" cannot be used with a " + ("method" | "getter" | "setter")
        p.log.addError();
        hasError = true;
      }

      if (opts.isAsync && p.markAsyncFn(opts.asyncRange, opts.isGenerator)) {
        hasError = true;
      }

      // (markSyntaxFeature(compat.Generator) and markSyntaxFeature(compat.ObjectExtensions)
      // are no-ops returning false in the fast path, so "hasError" is unaffected)

      const loc = p.lexer.loc();
      const scopeIndex = p.pushScopeForParsePass(ScopeFunctionArgs, loc);
      let isConstructor = false;

      // Forbid the names "constructor" and "prototype" in some cases
      if (opts.isClass && (flags & PropertyIsComputed) === 0) {
        const str = key.data;
        if (str instanceof EString) {
          if (!opts.isStatic && str.value === "constructor") {
            if (kind === PropertyGetter) {
              // "Class constructor cannot be a getter"
              p.log.addError();
            } else if (kind === PropertySetter) {
              // "Class constructor cannot be a setter"
              p.log.addError();
            } else if (opts.isAsync) {
              // "Class constructor cannot be an async function"
              p.log.addError();
            } else if (opts.isGenerator) {
              // "Class constructor cannot be a generator"
              p.log.addError();
            } else {
              isConstructor = true;
            }
          } else if (opts.isStatic && str.value === "prototype") {
            // "Invalid static method name \"prototype\""
            p.log.addError();
          }
        }
      }

      let await_ = allowIdent;
      let yield_ = allowIdent;
      if (opts.isAsync) {
        await_ = allowExpr;
      }
      if (opts.isGenerator) {
        yield_ = allowExpr;
      }

      const data = new fnOrArrowDataParse();
      data.needsAsyncLoc = key.loc;
      data.asyncRange = opts.asyncRange;
      data.await = await_;
      data.yield = yield_;
      data.allowSuperCall = opts.classHasExtends && isConstructor;
      data.allowSuperProperty = true;
      data.decoratorScope = opts.decoratorScope;
      data.isConstructor = isConstructor;

      // Only allow omitting the body if we're parsing TypeScript class
      data.allowMissingBodyForTypeScript = p.options.ts.parse && opts.isClass;

      const $d103 = p.parseFn(null, opts.classKeyword, opts.decoratorContext, data);
      const fn = $d103[0], hadBody = $d103[1];

      // "class Foo { foo(): void; foo(): void {} }"
      if (!hadBody) {
        // Skip this property entirely
        p.popAndDiscardScope(scopeIndex);
        return [new Property(), false];
      }

      p.popScope();
      fn.isUniqueFormalParameters = true;
      const value = new Expr(new EFunction(fn), loc);

      // Enforce argument rules for accessors
      switch (kind) {
        case PropertyGetter:
          if (fn.args.length > 0) {
            // "Getter %s must have zero arguments"
            p.log.addError();
          }
          break;

        case PropertySetter:
          if (fn.args.length !== 1) {
            // "Setter %s must have exactly one argument"
            p.log.addError();
          }
          break;

        default:
          kind = PropertyMethod;
      }

      // Special-case private identifiers
      const private_ = key.data;
      if (private_ instanceof EPrivateIdentifier) {
        let declare;
        let suffix;
        switch (kind) {
          case PropertyGetter:
            if (opts.isStatic) {
              declare = SymbolPrivateStaticGet;
            } else {
              declare = SymbolPrivateGet;
            }
            suffix = "_get";
            break;
          case PropertySetter:
            if (opts.isStatic) {
              declare = SymbolPrivateStaticSet;
            } else {
              declare = SymbolPrivateSet;
            }
            suffix = "_set";
            break;
          default:
            if (opts.isStatic) {
              declare = SymbolPrivateStaticMethod;
            } else {
              declare = SymbolPrivateMethod;
            }
            suffix = "_fn";
        }
        const name = p.loadNameFromRef(private_.ref);
        if (name === "#constructor") {
          // "Invalid method name %q"
          p.log.addError();
        }
        private_.ref = p.declareSymbol(declare, key.loc, name);
        const methodRef = p.newSymbol(SymbolOther, name.slice(1) + suffix);
        if (kind === PropertySetter) {
          p.privateSetters.set(private_.ref, methodRef);
        } else {
          p.privateGetters.set(private_.ref, methodRef);
        }
      }

      if (opts.isStatic) {
        flags |= PropertyIsStatic;
      }
      return [new Property(null, key, value, null, opts.decorators, startLoc, closeBracketLoc, kind, flags), true];
    }

    // Parse an object key/value pair
    p.lexer.expect(TColon);
    const value = p.parseExprOrBindings(LComma, errors);
    return [new Property(null, key, value, null, [], startLoc, closeBracketLoc, kind, flags), true];
  },

  parsePropertyBinding() {
    const p = this;
    let key = null;
    let closeBracketLoc = 0;
    let isComputed = false;
    let preferQuotedKey = false;
    const loc = p.lexer.loc();

    switch (p.lexer.token) {
      case TDotDotDot: {
        p.lexer.next();
        const value = new Binding(new BIdentifier(p.storeNameInRef(p.lexer.identifier)), p.saveExprCommentsHere());
        p.lexer.expect(TIdentifier);
        return new PropertyBinding(null, value, null, loc, 0, false, true /* isSpread */, false);
      }

      case TNumericLiteral:
        key = new Expr(new ENumber(p.lexer.number), p.lexer.loc());
        p.checkForLegacyOctalLiteral(key.data);
        p.lexer.next();
        break;

      case TStringLiteral:
        key = p.parseStringLiteral();
        preferQuotedKey = !p.options.minifySyntax;
        break;

      case TBigIntegerLiteral:
        key = p.parseBigIntOrStringIfUnsupported();
        p.lexer.next();
        break;

      case TOpenBracket:
        isComputed = true;
        p.lexer.next();
        key = p.parseExpr(LComma);
        closeBracketLoc = p.saveExprCommentsHere();
        p.lexer.expect(TCloseBracket);
        break;

      default: {
        const name = p.lexer.identifier;
        const nameRange = p.lexer.range();
        if (!p.lexer.isIdentifierOrKeyword()) {
          p.lexer.expect(TIdentifier);
        }
        p.lexer.next();
        if (p.isMangledProp(name)) {
          key = new Expr(new ENameOfSymbol(p.storeNameInRef(name)), nameRange.loc);
        } else {
          key = new Expr(new EString(name), nameRange.loc);
        }

        if (p.lexer.token !== TColon && p.lexer.token !== TOpenParen) {
          // Forbid invalid identifiers
          if ((p.fnOrArrowDataParse.await !== allowIdent && name === "await") || (p.fnOrArrowDataParse.yield !== allowIdent && name === "yield")) {
            // "Cannot use %q as an identifier here:"
            p.log.addError();
          }

          const ref = p.storeNameInRef(name);
          const value = new Binding(new BIdentifier(ref), nameRange.loc);

          let defaultValueOrNil = null;
          if (p.lexer.token === TEquals) {
            p.lexer.next();
            defaultValueOrNil = p.parseExpr(LComma);
          }

          return new PropertyBinding(key, value, defaultValueOrNil, loc);
        }
        break;
      }
    }

    p.lexer.expect(TColon);
    const value = p.parseBinding(new parseBindingOpts());

    let defaultValueOrNil = null;
    if (p.lexer.token === TEquals) {
      p.lexer.next();
      defaultValueOrNil = p.parseExpr(LComma);
    }

    return new PropertyBinding(key, value, defaultValueOrNil, loc, closeBracketLoc, isComputed, false, preferQuotedKey);
  },

  isMangledProp(name) {
    const p = this;
    if (p.options.mangleProps == null) {
      return false;
    }
    // "--mangle-props" (a Go RE2 regexp) is not supported by the fast path
    bail();
    return false;
  },

  symbolForMangledProp(name) {
    const p = this;
    let mangledProps = p.mangledProps;
    if (mangledProps === null) {
      mangledProps = new Map();
      p.mangledProps = mangledProps;
    }
    let ref = mangledProps.get(name);
    if (ref === undefined) {
      ref = p.newSymbol(SymbolMangledProp, name);
      mangledProps.set(name, ref);
    }
    if (!p.isControlFlowDead) {
      const symbol = p.symbols[refInner(ref)];
      symbol.useCountEstimate = (symbol.useCountEstimate + 1) >>> 0; // uint32
    }
    return ref;
  },

  dotOrMangledPropParse(target, name, nameLoc, optionalChain, original) {
    const p = this;
    if ((original !== wasOriginallyIndex || p.options.mangleQuoted) && p.isMangledProp(name)) {
      return new EIndex(target, new Expr(new ENameOfSymbol(p.storeNameInRef(name)), nameLoc), 0, optionalChain);
    }

    return new EDot(target, name, nameLoc, optionalChain);
  },

  dotOrMangledPropVisit(target, name, nameLoc) {
    const p = this;
    if (p.isMangledProp(name)) {
      return new EIndex(target, new Expr(new ENameOfSymbol(p.symbolForMangledProp(name)), nameLoc));
    }

    return new EDot(target, name, nameLoc);
  },

  // "data" must be a fresh object owned by this call (all callers pass a new
  // fnOrArrowDataParse, like the Go composite literals); it is modified here.
  parseArrowBody(args, data) {
    const p = this;
    const arrowLoc = p.lexer.loc();

    // Newlines are not allowed before "=>"
    if (p.lexer.hasNewlineBefore) {
      // "Unexpected newline before \"=>\""
      p.log.addError();
      throw LEXER_PANIC;
    }

    p.lexer.expect(TEqualsGreaterThan);

    for (const arg of args) {
      p.declareBinding(SymbolHoisted, arg.binding, PARSE_STMT_OPTS_ZERO);
    }

    // The ability to use "this" and "super" is inherited by arrow functions
    data.isThisDisallowed = p.fnOrArrowDataParse.isThisDisallowed;
    data.allowSuperCall = p.fnOrArrowDataParse.allowSuperCall;
    data.allowSuperProperty = p.fnOrArrowDataParse.allowSuperProperty;

    if (p.lexer.token === TOpenBrace) {
      const body = p.parseFnBody(data);
      p.afterArrowBodyLoc = p.lexer.loc();
      return new EArrow(args, body);
    }

    p.pushScopeForParsePass(ScopeFunctionBody, arrowLoc);
    try {
      const oldFnOrArrowData = p.fnOrArrowDataParse;
      p.fnOrArrowDataParse = data;
      const expr = p.parseExpr(LComma);
      p.fnOrArrowDataParse = oldFnOrArrowData;
      return new EArrow(
        args,
        new FnBody(new SBlock([new Stmt(new SReturn(expr), expr.loc)]), arrowLoc),
        false,
        false,
        true /* preferExpr */,
      );
    } finally {
      p.popScope(); // Go: defer p.popScope()
    }
  },

  checkForArrowAfterTheCurrentToken() {
    const p = this;
    const oldLexer = p.lexer.clone();
    p.lexer.isLogDisabled = true;

    // Implement backtracking by restoring the lexer's memory to its original state
    try {
      p.lexer.next();
      const isArrowAfterThisToken = p.lexer.token === TEqualsGreaterThan;

      p.lexer = oldLexer;
      return isArrowAfterThisToken;
    } catch (e) {
      if (e !== LEXER_PANIC) throw e;
      p.lexer = oldLexer;
      return false;
    }
  },

  // This parses an expression. This assumes we've already parsed the "async"
  // keyword and are currently looking at the following token.
  parseAsyncPrefixExpr(asyncRange, level, flags) {
    const p = this;

    // "async function() {}"
    if (!p.lexer.hasNewlineBefore && p.lexer.token === TFunction) {
      return p.parseFnExpr(asyncRange.loc, true /* isAsync */, asyncRange);
    }

    // Check the precedence level to avoid parsing an arrow function in
    // "new async () => {}". This also avoids parsing "new async()" as
    // "new (async())()" instead.
    if (!p.lexer.hasNewlineBefore && level < LMember) {
      switch (p.lexer.token) {
        // "async => {}"
        case TEqualsGreaterThan:
          if (level <= LAssign) {
            const arg = new Arg(new Binding(new BIdentifier(p.storeNameInRef("async")), asyncRange.loc));

            p.pushScopeForParsePass(ScopeFunctionArgs, asyncRange.loc);
            try {
              const data = new fnOrArrowDataParse();
              data.needsAsyncLoc = asyncRange.loc;
              return new Expr(p.parseArrowBody([arg], data), asyncRange.loc);
            } finally {
              p.popScope(); // Go: defer p.popScope()
            }
          }
          break;

        // "async x => {}"
        case TIdentifier:
          if (level <= LAssign) {
            let isArrowFn = true;
            if ((flags & exprFlagForLoopInit) !== 0 && p.lexer.identifier === "of") {
              // See https://github.com/tc39/ecma262/issues/2034 for details

              // "for (async of" is only an arrow function if the next token is "=>"
              isArrowFn = p.checkForArrowAfterTheCurrentToken();

              // Do not allow "for (async of []) ;" but do allow "for await (async of []) ;"
              if (!isArrowFn && (flags & exprFlagForAwaitLoopInit) === 0 && p.lexer.raw() === "of") {
                // "For loop initializers cannot start with \"async of\""
                p.log.addError();
                throw LEXER_PANIC;
              }
            } else if (p.options.ts.parse && p.lexer.token === TIdentifier) {
              // Make sure we can parse the following TypeScript code:
              //
              //   export function open(async?: boolean): void {
              //     console.log(async as boolean)
              //   }
              //
              // TypeScript solves this by using a two-token lookahead to check for
              // "=>" after an identifier after the "async". This is done in
              // "isUnParenthesizedAsyncArrowFunctionWorker" which was introduced
              // here: https://github.com/microsoft/TypeScript/pull/8444
              isArrowFn = p.checkForArrowAfterTheCurrentToken();
            }

            if (isArrowFn) {
              p.markAsyncFn(asyncRange, false);
              const ref = p.storeNameInRef(p.lexer.identifier);
              const arg = new Arg(new Binding(new BIdentifier(ref), p.lexer.loc()));
              p.lexer.next();

              p.pushScopeForParsePass(ScopeFunctionArgs, asyncRange.loc);
              try {
                const data = new fnOrArrowDataParse();
                data.needsAsyncLoc = arg.binding.loc;
                data.await = allowExpr;
                const arrow = p.parseArrowBody([arg], data);
                arrow.isAsync = true;
                return new Expr(arrow, asyncRange.loc);
              } finally {
                p.popScope(); // Go: defer p.popScope()
              }
            }
          }
          break;

        // "async()"
        // "async () => {}"
        case TOpenParen:
          p.lexer.next();
          return p.parseParenExpr(asyncRange.loc, level, new parenExprOpts(asyncRange));

        // "async<T>()"
        // "async <T>() => {}"
        case TLessThan:
          if (p.options.ts.parse && (!p.options.jsx.parse || p.isTSArrowFnJSX())) {
            const result = p.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking();
            if (result !== didNotSkipAnything) {
              p.lexer.next();
              return p.parseParenExpr(asyncRange.loc, level, new parenExprOpts(asyncRange, result === definitelyTypeParameters));
            }
          }
          break;
      }
    }

    // "async"
    // "async + 1"
    return new Expr(new EIdentifier(p.storeNameInRef("async")), asyncRange.loc);
  },

  parseFnExpr(loc, isAsync, asyncRange) {
    const p = this;
    p.lexer.next();
    const isGenerator = p.lexer.token === TAsterisk;
    let hasError = false;
    if (isAsync) {
      hasError = p.markAsyncFn(asyncRange, isGenerator);
    }
    if (isGenerator) {
      if (!hasError) {
        // (markSyntaxFeature(compat.Generator) no-op)
      }
      p.lexer.next();
    }
    let name = null;

    p.pushScopeForParsePass(ScopeFunctionArgs, loc);
    try {
      // The name is optional
      if (p.lexer.token === TIdentifier) {
        // Don't declare the name "arguments" since it's shadowed and inaccessible
        const nameLoc = p.lexer.loc();
        const text = p.lexer.identifier;
        let nameRef;
        if (text !== "arguments") {
          nameRef = p.declareSymbol(SymbolHoistedFunction, nameLoc, text);
        } else {
          nameRef = p.newSymbol(SymbolHoistedFunction, text);
        }
        name = new LocRef(nameLoc, nameRef);
        p.lexer.next();
      }

      // Even anonymous functions can have TypeScript type parameters
      if (p.options.ts.parse) {
        p.skipTypeScriptTypeParameters(allowConstModifier);
      }

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
      const fn = p.parseFn(name, RANGE_ZERO, 0, data)[0];
      p.validateFunctionName(fn, fnExpr);
      return new Expr(new EFunction(fn), loc);
    } finally {
      p.popScope(); // Go: defer p.popScope()
    }
  },

  // This assumes that the open parenthesis has already been parsed by the caller
  parseParenExpr(loc, level, opts) {
    const p = this;
    const items = [];
    const errors = new deferredErrors();
    const arrowArgErrors = new deferredArrowArgErrors();
    let spreadRange = RANGE_ZERO;
    let typeColonRange = RANGE_ZERO;
    let commaAfterSpread = 0;
    const isAsync = opts.asyncRange.len > 0;

    // Push a scope assuming this is an arrow function. It may not be, in which
    // case we'll need to roll this change back. This has to be done ahead of
    // parsing the arguments instead of later on when we hit the "=>" token and
    // we know it's an arrow function because the arguments may have default
    // values that introduce new scopes and declare new symbols. If this is an
    // arrow function, then those new scopes will need to be parented under the
    // scope of the arrow function itself.
    const scopeIndex = p.pushScopeForParsePass(ScopeFunctionArgs, loc);

    // Allow "in" inside parentheses
    const oldAllowIn = p.allowIn;
    p.allowIn = true;

    // Forbid "await" and "yield", but only for arrow functions
    // (Go copies the struct by value and then modifies the copy in "p")
    const oldFnOrArrowData = p.fnOrArrowDataParse;
    p.fnOrArrowDataParse = oldFnOrArrowData.clone();
    p.fnOrArrowDataParse.arrowArgErrors = arrowArgErrors;

    // Scan over the comma-separated arguments or expressions
    while (p.lexer.token !== TCloseParen) {
      const itemLoc = p.lexer.loc();
      const isSpread = p.lexer.token === TDotDotDot;

      if (isSpread) {
        spreadRange = p.lexer.range();
        // (markSyntaxFeature(compat.RestArgument) no-op)
        p.lexer.next();
      }

      // We don't know yet whether these are arguments or expressions, so parse
      // a superset of the expression syntax. Errors about things that are valid
      // in one but not in the other are deferred.
      p.latestArrowArgLoc = p.lexer.loc();
      let item = p.parseExprOrBindings(LComma, errors);

      if (isSpread) {
        item = new Expr(new ESpread(item), itemLoc);
      }

      // Skip over types
      if (p.options.ts.parse && p.lexer.token === TColon) {
        typeColonRange = p.lexer.range();
        p.lexer.next();
        p.skipTypeScriptType(LLowest);
      }

      // There may be a "=" after the type (but not after an "as" cast)
      if (p.options.ts.parse && p.lexer.token === TEquals && p.lexer.loc() !== p.forbidSuffixAfterAsLoc) {
        p.lexer.next();
        item = assign(item, p.parseExpr(LComma));
      }

      items.push(item);
      if (p.lexer.token !== TComma) {
        break;
      }

      // Spread arguments must come last. If there's a spread argument followed
      // by a comma, throw an error if we use these expressions as bindings.
      if (isSpread) {
        commaAfterSpread = p.lexer.loc();
      }

      // Eat the comma token
      p.lexer.next();
    }

    // The parenthetical construct must end with a close parenthesis
    p.lexer.expect(TCloseParen);

    // Restore "in" operator status before we parse the arrow function body
    p.allowIn = oldAllowIn;

    // Also restore "await" and "yield" expression errors
    p.fnOrArrowDataParse = oldFnOrArrowData;

    // Are these arguments to an arrow function?
    let isArrowFn = p.lexer.token === TEqualsGreaterThan;
    if (isArrowFn || opts.forceArrowFn || (p.options.ts.parse && p.lexer.token === TColon)) {
      // Arrow functions are not allowed inside certain expressions
      if (level > LAssign) {
        p.lexer.unexpected();
      }

      let invLog = new invalidLog();
      const args = [];

      if (isAsync) {
        p.markAsyncFn(opts.asyncRange, false);
      }

      // First, try converting the expressions to bindings
      for (let item of items) {
        let isSpread = false;
        const spread = item.data;
        if (spread instanceof ESpread) {
          item = spread.value;
          isSpread = true;
        }
        const $d104 = p.convertExprToBindingAndInitializer(item, invLog, isSpread);
        const binding = $d104[0], initializerOrNil = $d104[1], log = $d104[2];
        invLog = log;
        args.push(new Arg(binding, initializerOrNil));
      }

      let await_ = allowIdent;
      if (isAsync) {
        await_ = allowExpr;
      }

      // Avoid parsing TypeScript code like "a ? (1 + 2) : (3 + 4)" as an arrow
      // function. The ":" after the ")" may be a return type annotation, so we
      // attempt to convert the expressions to bindings first before deciding
      // whether this is an arrow function, and only pick an arrow function if
      // there were no conversion errors.
      if (p.options.ts.parse && p.lexer.token === TColon && invLog.invalidTokens.length === 0) {
        if (opts.isAfterQuestionAndBeforeColon) {
          // Only do this very expensive check if we must
          isArrowFn = p.isTypeScriptArrowReturnTypeAfterQuestionAndBeforeColon(await_);
          if (isArrowFn) {
            // We know this will succeed because we've already done it once above
            p.lexer.next();
            p.skipTypeScriptReturnType();
          }
        } else {
          // Otherwise, do the less expensive check
          isArrowFn = p.trySkipTypeScriptArrowReturnTypeWithBacktracking();
        }
      }

      // Arrow function parsing may be forced if this parenthesized expression
      // was prefixed by a TypeScript type parameter list such as "<T,>()"
      if (isArrowFn || opts.forceArrowFn) {
        if (commaAfterSpread !== 0) {
          // "Unexpected \",\" after rest pattern"
          p.log.addError();
        }
        p.logArrowArgErrors(arrowArgErrors);
        p.logDeferredArrowArgErrors(errors);

        // Now that we've decided we're an arrow function, report binding pattern
        // conversion errors
        if (invLog.invalidTokens.length > 0) {
          for (let i = 0; i < invLog.invalidTokens.length; i++) {
            // "Invalid binding pattern"
            p.log.addError();
          }
          throw LEXER_PANIC;
        }

        // Also report syntax features used in bindings
        // (markSyntaxFeature(entry.feature, entry.token) for each entry of
        // invLog.syntaxFeatures: no-op in the fast path)

        const data = new fnOrArrowDataParse();
        data.needsAsyncLoc = loc;
        data.await = await_;
        const arrow = p.parseArrowBody(args, data);
        arrow.isAsync = isAsync;
        arrow.hasRestArg = spreadRange.len > 0;
        p.popScope();
        return new Expr(arrow, loc);
      }
    }

    // If we get here, it's not an arrow function so undo the pushing of the
    // scope we did earlier. This needs to flatten any child scopes into the
    // parent scope as if the scope was never pushed in the first place.
    p.popAndFlattenScope(scopeIndex);

    // If this isn't an arrow function, then types aren't allowed
    if (typeColonRange.len > 0) {
      // "Unexpected \":\""
      p.log.addError();
      throw LEXER_PANIC;
    }

    // Are these arguments for a call to a function named "async"?
    if (isAsync) {
      p.logExprErrors(errors);
      const async = new Expr(new EIdentifier(p.storeNameInRef("async")), loc);
      return new Expr(new ECall(async, items), loc);
    }

    // Is this a chain of expressions and comma operators?
    if (items.length > 0) {
      p.logExprErrors(errors);
      if (spreadRange.len > 0) {
        // "Unexpected \"...\""
        p.log.addError();
        throw LEXER_PANIC;
      }
      const value = joinAllWithComma(items);
      p.markExprAsParenthesized(value, loc, isAsync);
      return value;
    }

    // Indicate that we expected an arrow function
    p.lexer.expected(TEqualsGreaterThan);
    return null;
  },

  // Returns [binding, initializerOrNil, invalidLog]. The "invalidLog" object is
  // threaded through (Go passes it by value and always uses the returned one).
  convertExprToBindingAndInitializer(expr, invLog, isSpread) {
    const p = this;
    let initializerOrNil = null;
    const assign_ = expr.data;
    if (assign_ instanceof EBinary && assign_.op === BinOpAssign) {
      initializerOrNil = assign_.right;
      expr = assign_.left;
    }
    const r = p.convertExprToBinding(expr, invLog);
    const binding = r[0];
    invLog = r[1];
    if (initializerOrNil !== null) {
      const equalsRange = p.source.rangeOfOperatorBefore(initializerOrNil.loc, "=");
      if (isSpread) {
        // "A rest argument cannot have a default initializer"
        p.log.addError();
      } else {
        invLog.syntaxFeatures.push(new syntaxFeature(0 /* compat.DefaultArgument */, equalsRange));
      }
    }
    return [binding, initializerOrNil, invLog];
  },

  // Note: do not write to "p.log" in this function. Any errors due to conversion
  // from expression to binding should be written to "invalidLog" instead. That
  // way we can potentially keep this as an expression if it turns out it's not
  // needed as a binding after all.
  //
  // Returns [binding, invalidLog] (the passed-in "invalidLog" is modified and
  // returned; Go threads it through by value).
  convertExprToBinding(expr, invLog) {
    const p = this;
    const e = expr.data;
    switch (e.k) {
      case E_MISSING:
        return [new Binding(BMissingShared, expr.loc), invLog];

      case E_IDENTIFIER:
        return [new Binding(new BIdentifier(e.ref), expr.loc), invLog];

      case E_ARRAY: {
        if (e.commaAfterSpread !== 0) {
          invLog.invalidTokens.push(new Range(e.commaAfterSpread, 1));
        }
        invLog.syntaxFeatures.push(new syntaxFeature(0 /* compat.Destructuring */, p.source.rangeOfOperatorAfter(expr.loc, "[")));
        const items = [];
        let isSpread = false;
        for (let item of e.items) {
          const i = item.data;
          if (i instanceof ESpread) {
            isSpread = true;
            item = i.value;
            if (!(item.data instanceof EIdentifier)) {
              // (markSyntaxFeature(compat.NestedRestBinding) no-op)
            }
          }
          const $d105 = p.convertExprToBindingAndInitializer(item, invLog, isSpread);
          const binding = $d105[0], initializerOrNil = $d105[1], log = $d105[2];
          invLog = log;
          items.push(new ArrayBinding(binding, initializerOrNil, item.loc));
        }
        return [new Binding(new BArray(items, e.closeBracketLoc, isSpread, e.isSingleLine), expr.loc), invLog];
      }

      case E_OBJECT: {
        if (e.commaAfterSpread !== 0) {
          invLog.invalidTokens.push(new Range(e.commaAfterSpread, 1));
        }
        invLog.syntaxFeatures.push(new syntaxFeature(0 /* compat.Destructuring */, p.source.rangeOfOperatorAfter(expr.loc, "{")));
        const properties = [];
        for (let $i46 = 0, $a46 = e.properties; $i46 < $a46.length; $i46++) {
          const property = $a46[$i46];
          if (propertyKindIsMethodDefinition(property.kind)) {
            invLog.invalidTokens.push(rangeOfIdentifier(p.source, property.key.loc));
            continue;
          }
          const r = p.convertExprToBindingAndInitializer(property.valueOrNil, invLog, false);
          const binding = r[0];
          let initializerOrNil = r[1];
          invLog = r[2];
          if (initializerOrNil === null) {
            initializerOrNil = property.initializerOrNil;
          }
          properties.push(
            new PropertyBinding(
              property.key,
              binding,
              initializerOrNil,
              property.loc,
              0,
              (property.flags & PropertyIsComputed) !== 0 /* isComputed */,
              property.kind === PropertySpread /* isSpread */,
              false,
            ),
          );
        }
        return [new Binding(new BObject(properties, e.closeBraceLoc, e.isSingleLine), expr.loc), invLog];
      }

      default:
        invLog.invalidTokens.push(new Range(expr.loc, 0));
        return [null, invLog];
    }
  },

  saveExprCommentsHere() {
    const p = this;
    const loc = p.lexer.loc();
    if (p.exprComments !== null && p.lexer.commentsBeforeToken.length > 0) {
      const before = p.lexer.commentsBeforeToken;
      const comments = new Array(before.length);
      for (let i = 0; i < before.length; i++) {
        comments[i] = p.source.commentTextWithoutIndent(before[i]);
      }
      p.exprComments.set(loc, comments);
      // (Go: "p.lexer.CommentsBeforeToken = p.lexer.CommentsBeforeToken[0:]" is a no-op)
    }
    return loc;
  },

  parsePrefix(level, errors, flags) {
    const p = this;
    const loc = p.saveExprCommentsHere();

    switch (p.lexer.token) {
      case TSuper: {
        // (Go's "superRange" is only used for the error message)
        p.lexer.next();

        switch (p.lexer.token) {
          case TOpenParen:
            if (level < LCall && p.fnOrArrowDataParse.allowSuperCall) {
              return new Expr(ESuperShared, loc);
            }
            break;

          case TDot:
          case TOpenBracket:
            if (p.fnOrArrowDataParse.allowSuperProperty) {
              return new Expr(ESuperShared, loc);
            }
            break;
        }

        // "Unexpected \"super\""
        p.log.addError();
        return new Expr(ESuperShared, loc);
      }

      case TOpenParen: {
        if (errors !== null) {
          errors.invalidParens.push(p.lexer.range());
        }

        p.lexer.next();

        // Arrow functions aren't allowed in the middle of expressions
        if (level > LAssign) {
          // Allow "in" inside parentheses
          const oldAllowIn = p.allowIn;
          p.allowIn = true;

          const value = p.parseExpr(LLowest);

          // Don't consider the "@(...)" decorator syntax to be important parentheses to preserve
          if ((flags & exprFlagDecorator) === 0) {
            p.markExprAsParenthesized(value, loc, false);
          }

          p.lexer.expect(TCloseParen);

          p.allowIn = oldAllowIn;
          return value;
        }

        const value = p.parseParenExpr(
          loc,
          level,
          new parenExprOpts(RANGE_ZERO, false, (flags & exprFlagAfterQuestionAndBeforeColon) !== 0 /* isAfterQuestionAndBeforeColon */),
        );
        return value;
      }

      case TFalse:
        p.lexer.next();
        return new Expr(new EBoolean(false), loc);

      case TTrue:
        p.lexer.next();
        return new Expr(new EBoolean(true), loc);

      case TNull:
        p.lexer.next();
        return new Expr(ENullShared, loc);

      case TThis:
        if (p.fnOrArrowDataParse.isThisDisallowed) {
          // "Cannot use \"this\" here:"
          p.log.addError();
        }
        p.lexer.next();
        return new Expr(EThisShared, loc);

      case TPrivateIdentifier: {
        if (!p.allowIn || level >= LCompare) {
          p.lexer.unexpected();
        }

        const name = p.lexer.identifier;
        p.lexer.next();

        // Check for "#foo in bar"
        if (p.lexer.token !== TIn) {
          p.lexer.expected(TIn);
        }

        // Make sure to lower all matching private names
        // (compat.ClassPrivateBrandCheck is always supported in the fast path)

        return new Expr(new EPrivateIdentifier(p.storeNameInRef(name)), loc);
      }

      case TIdentifier: {
        const name = p.lexer.identifier;
        // Go computes "nameRange" and "raw" unconditionally, but they are only
        // used for "async", "await" and "yield" (pure lexer reads, so this lazy
        // form behaves identically and avoids allocations on the hot path)
        let nameRange = RANGE_ZERO;
        let raw = "";
        if (name === "async" || name === "await" || name === "yield") {
          nameRange = p.lexer.range();
          raw = p.lexer.raw();
        }
        p.lexer.next();

        // Handle async and await expressions
        switch (name) {
          case "async":
            if (raw === "async") {
              return p.parseAsyncPrefixExpr(nameRange, level, flags);
            }
            break;

          case "await":
            switch (p.fnOrArrowDataParse.await) {
              case forbidAll:
                // "The keyword \"await\" cannot be used here:"
                p.log.addError();
                break;

              case allowExpr:
                if (raw !== "await") {
                  // "The keyword \"await\" cannot be escaped"
                  p.log.addError();
                } else {
                  if (p.fnOrArrowDataParse.isTopLevel) {
                    p.topLevelAwaitKeyword = nameRange;
                  }
                  if (p.fnOrArrowDataParse.arrowArgErrors !== null) {
                    p.fnOrArrowDataParse.arrowArgErrors.invalidExprAwait = nameRange;
                  }
                  const value = p.parseExpr(LPrefix);
                  if (p.lexer.token === TAsteriskAsterisk) {
                    p.lexer.unexpected();
                  }
                  return new Expr(new EAwait(value), loc);
                }
                break;

              case allowIdent:
                p.lexer.prevTokenWasAwaitKeyword = true;
                p.lexer.awaitKeywordLoc = loc;
                p.lexer.fnOrArrowStartLoc = p.fnOrArrowDataParse.needsAsyncLoc;
                break;
            }
            break;

          case "yield":
            switch (p.fnOrArrowDataParse.yield) {
              case forbidAll:
                // "The keyword \"yield\" cannot be used here:"
                p.log.addError();
                break;

              case allowExpr:
                if (raw !== "yield") {
                  // "The keyword \"yield\" cannot be escaped"
                  p.log.addError();
                } else {
                  if (level > LAssign) {
                    // "Cannot use a \"yield\" expression here without parentheses:"
                    p.log.addError();
                  }
                  if (p.fnOrArrowDataParse.arrowArgErrors !== null) {
                    p.fnOrArrowDataParse.arrowArgErrors.invalidExprYield = nameRange;
                  }
                  return p.parseYieldExpr(loc);
                }
                break;

              case allowIdent:
                if (!p.lexer.hasNewlineBefore) {
                  // Try to gracefully recover if "yield" is used in the wrong place
                  switch (p.lexer.token) {
                    case TNull:
                    case TIdentifier:
                    case TFalse:
                    case TTrue:
                    case TNumericLiteral:
                    case TBigIntegerLiteral:
                    case TStringLiteral:
                      // "Cannot use \"yield\" outside a generator function"
                      p.log.addError();
                      return p.parseYieldExpr(loc);
                  }
                }
                break;
            }
            break;
        }

        // Handle the start of an arrow expression
        if (p.lexer.token === TEqualsGreaterThan && level <= LAssign) {
          const ref = p.storeNameInRef(name);
          const arg = new Arg(new Binding(new BIdentifier(ref), loc));

          p.pushScopeForParsePass(ScopeFunctionArgs, loc);
          try {
            const data = new fnOrArrowDataParse();
            data.needsAsyncLoc = loc;
            return new Expr(p.parseArrowBody([arg], data), loc);
          } finally {
            p.popScope(); // Go: defer p.popScope()
          }
        }

        const ref = p.storeNameInRef(name);
        return new Expr(new EIdentifier(ref), loc);
      }

      case TStringLiteral:
      case TNoSubstitutionTemplateLiteral:
        return p.parseStringLiteral();

      case TTemplateHead: {
        let legacyOctalLoc = 0;
        const headLoc = p.lexer.loc();
        const head = p.lexer.stringLiteral();
        if (p.lexer.legacyOctalLoc > loc) {
          legacyOctalLoc = p.lexer.legacyOctalLoc;
        }
        const $d106 = p.parseTemplateParts(false /* includeRaw */);
        const parts = $d106[0], tailLegacyOctalLoc = $d106[1];
        if (tailLegacyOctalLoc > 0) {
          legacyOctalLoc = tailLegacyOctalLoc;
        }
        return new Expr(new ETemplate(null, "", head, parts, headLoc, legacyOctalLoc), loc);
      }

      case TNumericLiteral: {
        const value = new Expr(new ENumber(p.lexer.number), loc);
        p.checkForLegacyOctalLiteral(value.data);
        p.lexer.next();
        return value;
      }

      case TBigIntegerLiteral: {
        const value = p.lexer.identifier;
        p.lexer.next();
        return new Expr(new EBigInt(value), loc);
      }

      case TSlash:
      case TSlashEquals: {
        p.lexer.scanRegExp();
        const value = p.lexer.raw();
        p.lexer.next();
        return new Expr(new ERegExp(value), loc);
      }

      case TVoid: {
        p.lexer.next();
        const value = p.parseExpr(LPrefix);
        if (p.lexer.token === TAsteriskAsterisk) {
          p.lexer.unexpected();
        }
        return new Expr(new EUnary(value, UnOpVoid), loc);
      }

      case TTypeof: {
        p.lexer.next();
        const value = p.parseExpr(LPrefix);
        if (p.lexer.token === TAsteriskAsterisk) {
          p.lexer.unexpected();
        }
        const valueIsIdentifier = value.data instanceof EIdentifier;
        return new Expr(new EUnary(value, UnOpTypeof, valueIsIdentifier /* wasOriginallyTypeofIdentifier */), loc);
      }

      case TDelete: {
        p.lexer.next();
        const value = p.parseExpr(LPrefix);
        if (p.lexer.token === TAsteriskAsterisk) {
          p.lexer.unexpected();
        }
        const index = value.data;
        if (index instanceof EIndex) {
          if (index.index.data instanceof EPrivateIdentifier) {
            // "Deleting the private name %q is forbidden"
            p.log.addError();
          }
        }
        const valueIsIdentifier = value.data instanceof EIdentifier;
        return new Expr(
          new EUnary(value, UnOpDelete, false, valueIsIdentifier || isPropertyAccess(value) /* wasOriginallyDeleteOfIdentifierOrPropertyAccess */),
          loc,
        );
      }

      case TPlus: {
        p.lexer.next();
        const value = p.parseExpr(LPrefix);
        if (p.lexer.token === TAsteriskAsterisk) {
          p.lexer.unexpected();
        }
        return new Expr(new EUnary(value, UnOpPos), loc);
      }

      case TMinus: {
        p.lexer.next();
        const value = p.parseExpr(LPrefix);
        if (p.lexer.token === TAsteriskAsterisk) {
          p.lexer.unexpected();
        }
        return new Expr(new EUnary(value, UnOpNeg), loc);
      }

      case TTilde: {
        p.lexer.next();
        const value = p.parseExpr(LPrefix);
        if (p.lexer.token === TAsteriskAsterisk) {
          p.lexer.unexpected();
        }
        return new Expr(new EUnary(value, UnOpCpl), loc);
      }

      case TExclamation: {
        p.lexer.next();
        const value = p.parseExpr(LPrefix);
        if (p.lexer.token === TAsteriskAsterisk) {
          p.lexer.unexpected();
        }
        return new Expr(new EUnary(value, UnOpNot), loc);
      }

      case TMinusMinus:
        p.lexer.next();
        return new Expr(new EUnary(p.parseExpr(LPrefix), UnOpPreDec), loc);

      case TPlusPlus:
        p.lexer.next();
        return new Expr(new EUnary(p.parseExpr(LPrefix), UnOpPreInc), loc);

      case TFunction:
        return p.parseFnExpr(loc, false /* isAsync */, RANGE_ZERO);

      case TClass:
        return p.parseClassExpr([]);

      case TAt: {
        // Parse decorators before class expressions
        const decorators = p.parseDecorators(p.currentScope, RANGE_ZERO, decoratorBeforeClassExpr);
        return p.parseClassExpr(decorators);
      }

      case TNew: {
        p.lexer.next();

        // Special-case the weird "new.target" expression here
        if (p.lexer.token === TDot) {
          p.lexer.next();
          if (p.lexer.token !== TIdentifier || p.lexer.raw() !== "target") {
            p.lexer.unexpected();
          }
          const r = new Range(loc, rangeEnd(p.lexer.range()) - loc);
          // (markSyntaxFeature(compat.NewTarget) no-op)
          p.lexer.next();
          return new Expr(new ENewTarget(r), loc);
        }

        const target = p.parseExprWithFlags(LMember, flags | exprFlagIsNewTarget);
        let args = [];
        let closeParenLoc = 0;
        let isMultiLine = false;

        if (p.lexer.token === TOpenParen) {
          [args, closeParenLoc, isMultiLine] = p.parseCallArgs();
        }

        return new Expr(new ENew(target, args, closeParenLoc, isMultiLine), loc);
      }

      case TOpenBracket: {
        p.lexer.next();
        let isSingleLine = !p.lexer.hasNewlineBefore;
        const items = [];
        const selfErrors = new deferredErrors();
        let commaAfterSpread = 0;

        // Allow "in" inside arrays
        const oldAllowIn = p.allowIn;
        p.allowIn = true;

        while (p.lexer.token !== TCloseBracket) {
          switch (p.lexer.token) {
            case TComma:
              items.push(new Expr(EMissingShared, p.lexer.loc()));
              break;

            case TDotDotDot: {
              if (errors !== null) {
                errors.arraySpreadFeature = p.lexer.range();
              } else {
                // (markSyntaxFeature(compat.ArraySpread) no-op)
              }
              const dotsLoc = p.saveExprCommentsHere();
              p.lexer.next();
              const item = p.parseExprOrBindings(LComma, selfErrors);
              items.push(new Expr(new ESpread(item), dotsLoc));

              // Commas are not allowed here when destructuring
              if (p.lexer.token === TComma) {
                commaAfterSpread = p.lexer.loc();
              }
              break;
            }

            default: {
              const item = p.parseExprOrBindings(LComma, selfErrors);
              items.push(item);
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

        if (p.lexer.hasNewlineBefore) {
          isSingleLine = false;
        }
        const closeBracketLoc = p.saveExprCommentsHere();
        p.lexer.expect(TCloseBracket);
        p.allowIn = oldAllowIn;

        if (p.willNeedBindingPattern()) {
          // Is this a binding pattern?
        } else if (errors === null) {
          // Is this an expression?
          p.logExprErrors(selfErrors);
        } else {
          // In this case, we can't distinguish between the two yet
          selfErrors.mergeInto(errors);
        }

        return new Expr(new EArray(items, commaAfterSpread, closeBracketLoc, isSingleLine), loc);
      }

      case TOpenBrace: {
        p.lexer.next();
        let isSingleLine = !p.lexer.hasNewlineBefore;
        const properties = [];
        const selfErrors = new deferredErrors();
        let commaAfterSpread = 0;

        // Allow "in" inside object literals
        const oldAllowIn = p.allowIn;
        p.allowIn = true;

        while (p.lexer.token !== TCloseBrace) {
          if (p.lexer.token === TDotDotDot) {
            const dotLoc = p.saveExprCommentsHere();
            p.lexer.next();
            const value = p.parseExprOrBindings(LComma, selfErrors);
            properties.push(new Property(null, null, value, null, [], dotLoc, 0, PropertySpread, 0));

            // Commas are not allowed here when destructuring
            if (p.lexer.token === TComma) {
              commaAfterSpread = p.lexer.loc();
            }
          } else {
            // This property may turn out to be a type in TypeScript, which should be ignored
            const $d107 = p.parseProperty(p.saveExprCommentsHere(), PropertyField, new propertyOpts(), selfErrors);
            const property = $d107[0], ok = $d107[1];
            if (ok) {
              properties.push(property);
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

        if (p.lexer.hasNewlineBefore) {
          isSingleLine = false;
        }
        const closeBraceLoc = p.saveExprCommentsHere();
        p.lexer.expect(TCloseBrace);
        p.allowIn = oldAllowIn;

        if (p.willNeedBindingPattern()) {
          // Is this a binding pattern?
        } else if (errors === null) {
          // Is this an expression?
          p.logExprErrors(selfErrors);
        } else {
          // In this case, we can't distinguish between the two yet
          selfErrors.mergeInto(errors);
        }

        return new Expr(new EObject(properties, commaAfterSpread, closeBraceLoc, isSingleLine), loc);
      }

      case TLessThan: {
        // This is a very complicated and highly ambiguous area of TypeScript
        // syntax. Many similar-looking things are overloaded.
        //
        // TS:
        //
        //   A type cast:
        //     <A>(x)
        //     <[]>(x)
        //     <A[]>(x)
        //     <const>(x)
        //
        //   An arrow function with type parameters:
        //     <A>(x) => {}
        //     <A, B>(x) => {}
        //     <A = B>(x) => {}
        //     <A extends B>(x) => {}
        //     <const A>(x) => {}
        //     <const A extends B>(x) => {}
        //
        //   A syntax error:
        //     <>() => {}
        //
        // TSX:
        //
        //   A JSX element:
        //     <>() => {}</>
        //     <A>(x) => {}</A>
        //     <A extends/>
        //     <A extends>(x) => {}</A>
        //     <A extends={false}>(x) => {}</A>
        //     <const A extends/>
        //     <const A extends>(x) => {}</const>
        //
        //   An arrow function with type parameters:
        //     <A,>(x) => {}
        //     <A, B>(x) => {}
        //     <A = B>(x) => {}
        //     <A extends B>(x) => {}
        //     <const>(x)</const>
        //     <const A extends B>(x) => {}
        //
        //   A syntax error:
        //     <[]>(x)
        //     <A[]>(x)
        //     <>() => {}
        //     <A>(x) => {}

        if (p.options.ts.parse && p.options.jsx.parse && p.isTSArrowFnJSX()) {
          p.skipTypeScriptTypeParameters(allowConstModifier);
          p.lexer.expect(TOpenParen);
          return p.parseParenExpr(loc, level, new parenExprOpts(RANGE_ZERO, true /* forceArrowFn */));
        }

        // Print a friendly error message when parsing JSX as JavaScript
        if (!p.options.jsx.parse && !p.options.ts.parse) {
          // "The JSX syntax extension is not currently enabled"
          p.log.addErrorWithNotes();
          p.options.jsx.parse = true;
        }

        if (p.options.jsx.parse) {
          // Use NextInsideJSXElement() instead of Next() so we parse "<<" as "<"
          p.lexer.nextInsideJSXElement();
          const element = p.parseJSXElement(loc);

          // The call to parseJSXElement() above doesn't consume the last
          // TGreaterThan because the caller knows what Next() function to call.
          // Use Next() instead of NextInsideJSXElement() here since the next
          // token is an expression.
          p.lexer.next();
          return element;
        }

        if (p.options.ts.parse) {
          // This is either an old-style type cast or a generic lambda function

          // TypeScript 4.5 introduced the ".mts" and ".cts" extensions that forbid
          // the use of an expression starting with "<" that would be ambiguous
          // when the file is in JSX mode.
          if (p.options.ts.noAmbiguousLessThan && !p.isTSArrowFnJSX()) {
            // "This syntax is not allowed in files with the \".mts\" or \".cts\" extension"
            p.log.addError();
          }

          // "<T>(x)"
          // "<T>(x) => {}"
          const result = p.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking();
          if (result !== didNotSkipAnything) {
            p.lexer.expect(TOpenParen);
            return p.parseParenExpr(loc, level, new parenExprOpts(RANGE_ZERO, result === definitelyTypeParameters /* forceArrowFn */));
          }

          // "<T>x"
          p.lexer.next();
          p.skipTypeScriptType(LLowest);
          p.lexer.expectGreaterThan(false /* isInsideJSXElement */);
          const value = p.parsePrefix(level, errors, flags);
          return value;
        }

        p.lexer.unexpected();
        return null;
      }

      case TImport:
        p.lexer.next();
        return p.parseImportExpr(loc, level);

      default:
        p.lexer.unexpected();
        return null;
    }
  },

  parseYieldExpr(loc) {
    const p = this;

    // Parse a yield-from expression, which yields from an iterator
    const isStar = p.lexer.token === TAsterisk;
    if (isStar && !p.lexer.hasNewlineBefore) {
      p.lexer.next();
    }

    let valueOrNil = null;

    // The yield expression only has a value in certain cases
    if (isStar) {
      valueOrNil = p.parseExpr(LYield);
    } else {
      switch (p.lexer.token) {
        case TCloseBrace:
        case TCloseBracket:
        case TCloseParen:
        case TColon:
        case TComma:
        case TSemicolon:
          break;

        default:
          if (!p.lexer.hasNewlineBefore) {
            valueOrNil = p.parseExpr(LYield);
          }
      }
    }

    return new Expr(new EYield(valueOrNil, isStar), loc);
  },

  willNeedBindingPattern() {
    const p = this;
    switch (p.lexer.token) {
      case TEquals:
        // "[a] = b;"
        return true;

      case TIn:
        // "for ([a] in b) {}"
        return !p.allowIn;

      case TIdentifier:
        // "for ([a] of b) {}"
        return !p.allowIn && p.lexer.isContextualKeyword("of");

      default:
        return false;
    }
  },

  // Note: The caller has already parsed the "import" keyword
  parseImportExpr(loc, level) {
    const p = this;

    // Parse an "import.meta" expression
    let phase = EvaluationPhase;
    if (p.lexer.token === TDot) {
      p.lexer.next();
      if (p.lexer.isContextualKeyword("meta")) {
        p.esmImportMeta = new Range(loc, rangeEnd(p.lexer.range()) - loc);
        p.lexer.next();
        return new Expr(new EImportMeta(p.esmImportMeta.len), loc);
      } else if (p.lexer.isContextualKeyword("defer")) {
        // (markSyntaxFeature(compat.ImportDefer) no-op)
        phase = DeferPhase;
        p.lexer.next();
      } else if (p.lexer.isContextualKeyword("source")) {
        // (markSyntaxFeature(compat.ImportSource) no-op)
        phase = SourcePhase;
        p.lexer.next();
      } else {
        p.lexer.unexpected();
      }
    }

    if (level > LCall) {
      // "Cannot use an \"import\" expression here without parentheses:"
      p.log.addError();
    }

    // Allow "in" inside call arguments
    const oldAllowIn = p.allowIn;
    p.allowIn = true;

    p.lexer.expect(TOpenParen);

    const value = p.parseExpr(LComma);
    let optionsOrNil = null;

    if (p.lexer.token === TComma) {
      // "import('./foo.json', )"
      p.lexer.next();

      if (p.lexer.token !== TCloseParen) {
        // "import('./foo.json', { assert: { type: 'json' } })"
        optionsOrNil = p.parseExpr(LComma);

        if (p.lexer.token === TComma) {
          // "import('./foo.json', { assert: { type: 'json' } }, )"
          p.lexer.next();
        }
      }
    }

    const closeParenLoc = p.saveExprCommentsHere();
    p.lexer.expect(TCloseParen);

    p.allowIn = oldAllowIn;
    return new Expr(new EImportCall(value, optionsOrNil, closeParenLoc, phase), loc);
  },

  parseExprOrBindings(level, errors) {
    return this.parseExprCommon(level, errors, 0);
  },

  parseExpr(level) {
    return this.parseExprCommon(level, null, 0);
  },

  parseExprWithFlags(level, flags) {
    return this.parseExprCommon(level, null, flags);
  },

  parseExprCommon(level, errors, flags) {
    const p = this;
    const lexerCommentFlags = p.lexer.hasCommentBefore;
    let expr = p.parsePrefix(level, errors, flags);

    if ((lexerCommentFlags & (PureCommentBefore | NoSideEffectsCommentBefore)) !== 0 && !p.options.ignoreDCEAnnotations) {
      if ((lexerCommentFlags & NoSideEffectsCommentBefore) !== 0) {
        const e = expr.data;
        switch (e.k) {
          case E_ARROW:
            e.hasNoSideEffectsComment = true;
            break;
          case E_FUNCTION:
            e.fn.hasNoSideEffectsComment = true;
            break;
        }
      }

      // There is no formal spec for "__PURE__" comments but from reverse-
      // engineering, it looks like they apply to the next CallExpression or
      // NewExpression. So in "/* @__PURE__ */ a().b() + c()" the comment applies
      // to the expression "a().b()".
      if ((lexerCommentFlags & PureCommentBefore) !== 0 && level < LCall) {
        expr = p.parseSuffix(expr, LCall - 1, errors, flags);
        const e = expr.data;
        switch (e.k) {
          case E_CALL:
            e.canBeUnwrappedIfUnused = true;
            break;
          case E_NEW:
            e.canBeUnwrappedIfUnused = true;
            break;
        }
      }
    }

    return p.parseSuffix(expr, level, errors, flags);
  },
};
// generated from js_parser_parse.mts by tools/ts-build.mjs; edit that file
