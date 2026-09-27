// Port of internal/js_parser/js_parser_lower.go and
// internal/js_parser/js_parser_lower_class.go.
//
// The fast path always runs with UnsupportedJSFeatures == 0 (target esnext),
// so every "p.options.unsupportedJSFeatures.Has(compat.X)" is false. Branches
// that only run when such a check is true are dropped (with a short note) or
// replaced by bail() when the whole function is only reachable that way.
// Everything that runs regardless of the target (class lowering for
// TypeScript semantics, decorators, private members that must be lowered for
// other reasons, super property lowering, ...) is ported faithfully.
import { bail } from "./bail.mjs";
import { mkRange, MsgData, LineColumnTracker } from "./logger.mjs";
import {
  InvalidRef,
  LocRef,
  refInner,
  SymbolHoisted,
  SymbolOther,
  SymbolUnbound,
  SymbolPrivateField,
  SymbolPrivateStaticField,
  SymbolPrivateMethod,
  SymbolPrivateStaticMethod,
  SymbolPrivateGet,
  SymbolPrivateStaticGet,
  SymbolPrivateSet,
  SymbolPrivateStaticSet,
  SymbolPrivateGetSetPair,
  SymbolPrivateStaticGetSetPair,
  PrivateSymbolMustBeLowered,
  MustNotBeRenamed,
} from "./ast.mjs";
import {
  Expr,
  Stmt,
  Binding,
  Property,
  Arg,
  Fn,
  FnBody,
  SBlock,
  ClassStaticBlock,
  Decorator,
  Decl,
  ClauseItem,
  DeclaredSymbol,
  Scope,
  Catch,
  Finally,
  BIdentifier,
  EArray,
  EUnary,
  EBinary,
  EBoolean,
  ECall,
  EDot,
  EIndex,
  EArrow,
  EFunction,
  EClass,
  EIdentifier,
  EPrivateIdentifier,
  ENameOfSymbol,
  ENumber,
  ESpread,
  EString,
  EAwait,
  ENew,
  EIf,
  EThisShared,
  ENullShared,
  ESuperShared,
  EUndefinedShared,
  SExpr,
  SLocal,
  SClass,
  SExportDefault,
  SExportClause,
  SReturn,
  STry,
  B_ARRAY,
  B_OBJECT,
  B_IDENTIFIER,
  E_ARRAY,
  E_UNARY,
  E_BINARY,
  E_BOOLEAN,
  E_SUPER,
  E_NULL,
  E_UNDEFINED,
  E_CALL,
  E_DOT,
  E_INDEX,
  E_ARROW,
  E_FUNCTION,
  E_IDENTIFIER,
  E_PRIVATE_IDENTIFIER,
  E_NAME_OF_SYMBOL,
  E_NUMBER,
  E_BIG_INT,
  E_OBJECT,
  E_SPREAD,
  E_STRING,
  S_EMPTY,
  S_EXPR,
  S_LOCAL,
  S_CLASS,
  S_FUNCTION,
  S_DIRECTIVE,
  S_IMPORT,
  S_EXPORT_FROM,
  S_EXPORT_STAR,
  S_EXPORT_CLAUSE,
  S_EXPORT_DEFAULT,
  S_RETURN,
  S_THROW,
  S_IF,
  S_SWITCH,
  S_FOR,
  BinOpAdd,
  BinOpAssign,
  BinOpComma,
  BinOpLooseEq,
  BinOpLooseNe,
  BinOpLogicalOr,
  BinOpLogicalAnd,
  BinOpNullishCoalescing,
  UnOpDelete,
  OptionalChainNone,
  OptionalChainStart,
  NormalCall,
  TargetWasOriginallyPropertyAccess,
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
  PropertyPreferQuotedKey,
  propertyKindIsMethodDefinition,
  LocalVar,
  LocalLet,
  LocalConst,
  LocalAwaitUsing,
  localKindIsUsing,
  ScopeFunctionBody,
  scopeKindStopsHoisting,
  SloppyMode,
  ExplicitStrictMode,
  ImplicitStrictModeClass,
  ImplicitStrictModeESM,
  ImplicitStrictModeTSAlwaysStrict,
  ImplicitStrictModeJSXAutomaticRuntime,
} from "./js_ast.mjs";
import {
  assign,
  assignStmt,
  joinWithComma,
  joinAllWithComma,
  forEachIdentifierBindingInDecls,
} from "./js_ast_helpers.mjs";
import { True, FormatESModule, ModeBundle, formatKeepESMImportExportSyntax } from "./config.mjs";
import {
  forInVarInit,
  objRestReturnValueIsUnused,
  lowerUsingDeclarationContext,
  classLoweringInfo,
  classKindExpr,
  classKindStmt,
  classKindExportStmt,
  classKindExportDefaultStmt,
  lowerClassContext,
  propertyAnalysis,
  tempRefNeedsDeclare,
  tempRefNoDeclare,
  valueDefinitelyNotMutated,
  exprOut,
  EXPR_OUT_DEFAULT,
  invalidLog,
} from "./js_parser_types.mjs";

// ---------------------------------------------------------------------------
// Local helpers

// Go map lookup "m[k]" for map[...]ast.Ref: a missing key yields the zero
// value ast.Ref{} (which is 0 in our number representation).
function mapGetRef(m, k) {
  if (m === null) return 0;
  const v = m.get(k);
  return v === undefined ? 0 : v;
}

// ast.DefaultNameMinifierJS.NumberToMinifiedName (ast.mjs does not port the
// name minifier because it is otherwise minify-only)
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

// The private identifier used as a property key, if any
function keyPrivate(key) {
  if (key !== null && key.data.k === E_PRIVATE_IDENTIFIER) return key.data;
  return null;
}

// Shared results for the common "nothing to do" cases (never mutate these)
const NOT_LOWERED = Object.freeze([null, false]);
const NO_PRIVATE_INDEX = Object.freeze([null, 0, null]);
const NO_SUPER_CALL = Object.freeze([null, 0, null, null]);

// ---------------------------------------------------------------------------
// js_parser_lower.go

export const lowerMethods = {
  // Note on "feature": compat is not ported (see CONVENTIONS.md). Callers may
  // pass the Go feature name as a string (e.g. "TopLevelAwait") or 0. The only
  // feature that matters when every feature is supported is TopLevelAwait. To
  // be robust against callers passing 0, a call is also recognized as the
  // top-level await check when "r" is exactly "p.liveTopLevelAwaitKeyword"
  // (all four TopLevelAwait call sites in Go set that field to "r" right
  // before calling this, and no other call site does).
  markSyntaxFeature(feature, r) {
    const p = this;
    // (!p.options.unsupportedJSFeatures.Has(feature) is always true here)
    const live = p.liveTopLevelAwaitKeyword;
    const isTopLevelAwait =
      feature === "TopLevelAwait" || (r !== null && r !== undefined && live.len > 0 && live.loc === r.loc && live.len === r.len);
    if (isTopLevelAwait && !formatKeepESMImportExportSyntax(p.options.outputFormat)) {
      // "Top-level await is currently not supported with the %q output format"
      p.log.addError(p.tracker, r);
      return true;
    }
    return false;
  },

  isStrictMode() {
    const p = this;
    return p.currentScope.strictMode !== SloppyMode;
  },

  isStrictModeOutputFormat() {
    const p = this;
    return p.options.outputFormat === FormatESModule;
  },

  markStrictModeFeature(feature, r, detail) {
    const p = this;
    let canBeTransformed = false;

    // (the message text is not built: errors bail anyway)
    if (feature === forInVarInit) {
      canBeTransformed = true;
    }

    if (p.isStrictMode()) {
      // Go: "where, notes := p.whyStrictMode(p.currentScope)" only builds the
      // message, and the error aborts the fast path anyway.
      p.log.addErrorWithNotes(p.tracker, r);
    } else if (!canBeTransformed && p.isStrictModeOutputFormat()) {
      p.log.addError(p.tracker, r);
    }
  },

  // Returns [where, notes]
  whyStrictMode(scope) {
    const p = this;
    let where = "in strict mode";
    let notes = null;

    switch (scope.strictMode) {
      case ImplicitStrictModeClass:
        notes = [p.tracker.msgData(p.enclosingClassKeyword, "All code inside a class is implicitly in strict mode")];
        break;

      case ImplicitStrictModeTSAlwaysStrict: {
        const tsAlwaysStrict = p.options.tsAlwaysStrict;
        const t = new LineColumnTracker(tsAlwaysStrict.source);
        notes = [t.msgData(tsAlwaysStrict.range, `TypeScript's "${tsAlwaysStrict.name}" setting was enabled here:`)];
        break;
      }

      case ImplicitStrictModeJSXAutomaticRuntime:
        notes = [
          p.tracker.msgData(mkRange(p.firstJSXElementLoc, 1), "This file is implicitly in strict mode due to the JSX element here:"),
          new MsgData(
            "When React's \"automatic\" JSX transform is enabled, using a JSX element automatically inserts " +
              "an \"import\" statement at the top of the file for the corresponding the JSX helper function. " +
              "This means the file is considered an ECMAScript module, and all ECMAScript modules use strict mode.",
          ),
        ];
        break;

      case ExplicitStrictMode:
        notes = [p.tracker.msgData(p.source.rangeOfString(scope.useStrictLoc), 'Strict mode is triggered by the "use strict" directive here:')];
        break;

      case ImplicitStrictModeESM:
        notes = p.whyESModule()[1];
        where = "in an ECMAScript module";
        break;
    }

    return [where, notes];
  },

  markAsyncFn(asyncRange, isGenerator) {
    // Lowered async functions are implemented in terms of generators. So if
    // generators aren't supported, async functions aren't supported either.
    // But if generators are supported, then async functions are unconditionally
    // supported because we can use generators to implement them.
    // (compat.Generator is always supported in the fast path)
    return false;
  },

  captureThis() {
    const p = this;
    if (p.fnOnlyDataVisit.thisCaptureRef === null) {
      const ref = p.newSymbol(SymbolHoisted, "_this");
      p.fnOnlyDataVisit.thisCaptureRef = ref;
    }

    const ref = p.fnOnlyDataVisit.thisCaptureRef;
    p.recordUsage(ref);
    return ref;
  },

  captureArguments() {
    const p = this;
    if (p.fnOnlyDataVisit.argumentsCaptureRef === null) {
      const ref = p.newSymbol(SymbolHoisted, "_arguments");
      p.fnOnlyDataVisit.argumentsCaptureRef = ref;
    }

    const ref = p.fnOnlyDataVisit.argumentsCaptureRef;
    p.recordUsage(ref);
    return ref;
  },

  // Go signature: (isAsync *bool, isGenerator *bool, args *[]Arg, bodyLoc,
  // bodyBlock *SBlock, preferExpr *bool, hasRestArg *bool, isArrow bool).
  // Both transforms in here are guarded by compat checks that are always false
  // in the fast path (compat.ObjectRestSpread for object rest arguments,
  // compat.AsyncAwait / compat.AsyncGenerator for async functions), so this
  // is a no-op that never touches its arguments.
  lowerFunction(isAsync, isGenerator, args, bodyLoc, bodyBlock, preferExpr, hasRestArg, isArrow) {},

  // Returns [Expr, exprOut]
  lowerOptionalChain(expr, in_, childOut) {
    const p = this;
    let valueWhenUndefined = new Expr(EUndefinedShared, expr.loc);
    let endsWithPropertyAccess = false;
    let containsPrivateName = false;
    let startsWithCall = false;
    const originalExpr = expr;
    const chain = [];
    const loc = expr.loc;

    // Step 1: Get an array of all expressions in the chain. We're traversing the
    // chain from the outside in, so the array will be filled in "backwards".
    flatten: for (;;) {
      chain.push(expr);

      const e = expr.data;
      switch (e.k) {
        case E_DOT:
          expr = e.target;
          if (chain.length === 1) {
            endsWithPropertyAccess = true;
          }
          if (e.optionalChain === OptionalChainStart) {
            break flatten;
          }
          break;

        case E_INDEX:
          expr = e.target;
          if (chain.length === 1) {
            endsWithPropertyAccess = true;
          }

          // If this is a private name that needs to be lowered, the entire chain
          // itself will have to be lowered even if the language target supports
          // optional chaining. This is because there's no way to use our shim
          // function for private names with optional chaining syntax.
          if (e.index.data.k === E_PRIVATE_IDENTIFIER && p.privateSymbolNeedsToBeLowered(e.index.data)) {
            containsPrivateName = true;
          }

          if (e.optionalChain === OptionalChainStart) {
            break flatten;
          }
          break;

        case E_CALL:
          expr = e.target;
          if (e.optionalChain === OptionalChainStart) {
            startsWithCall = true;
            break flatten;
          }
          break;

        case E_UNARY: // UnOpDelete
          valueWhenUndefined = new Expr(new EBoolean(true), loc);
          expr = e.value;
          break;

        default:
          bail(); // panic("Internal error")
      }
    }

    // Stop now if we can strip the whole chain as dead code. Since the chain is
    // lazily evaluated, it's safe to just drop the code entirely.
    if (p.options.minifySyntax) {
      bail(); // (minify only)
    } else {
      const k = expr.data.k;
      if (k === E_NULL || k === E_UNDEFINED) {
        return [valueWhenUndefined, EXPR_OUT_DEFAULT];
      }
    }

    // We need to lower this if this is an optional call off of a private name
    // such as "foo.#bar?.()" because the value of "this" must be captured.
    if (p.extractPrivateIndex(expr)[2] !== null) {
      containsPrivateName = true;
    }

    // Don't lower this if we don't need to. This check must be done here instead
    // of earlier so we can do the dead code elimination above when the target is
    // null or undefined. (compat.OptionalChain is always supported here)
    if (!containsPrivateName) {
      return [originalExpr, EXPR_OUT_DEFAULT];
    }

    // Step 2: Figure out if we need to capture the value for "this" for the
    // initial ECall. This will be passed to ".call(this, ...args)" later.
    let thisArg = null;
    let targetWrapFunc = null;
    if (startsWithCall) {
      if (childOut.thisArgFunc !== null) {
        // The initial value is a nested optional chain that ended in a property
        // access. The nested chain was processed first and has saved the
        // appropriate value for "this". The callback here will return a
        // reference to that saved location.
        thisArg = childOut.thisArgFunc();
      } else {
        // The initial value is a normal expression. If it's a property access,
        // strip the property off and save the target of the property access to
        // be used as the value for "this".
        const e = expr.data;
        switch (e.k) {
          case E_DOT:
            if (e.target.data.k === E_SUPER) {
              // Lower "super.prop" if necessary
              if (p.shouldLowerSuperPropertyAccess(e.target)) {
                const key = new Expr(new EString(e.name), e.nameLoc);
                expr = p.lowerSuperPropertyGet(expr.loc, key);
              }

              // Special-case "super.foo?.()" to avoid a syntax error. Without this,
              // we would generate:
              //
              //   (_b = (_a = super).foo) == null ? void 0 : _b.call(_a)
              //
              // which is a syntax error. Now we generate this instead:
              //
              //   (_a = super.foo) == null ? void 0 : _a.call(this)
              //
              thisArg = new Expr(EThisShared, loc);
            } else {
              const $d69 = p.captureValueWithPossibleSideEffects(loc, 2, e.target, valueDefinitelyNotMutated);
              const targetFunc = $d69[0], wrapFunc = $d69[1];
              expr = new Expr(new EDot(targetFunc(), e.name, e.nameLoc), loc);
              thisArg = targetFunc();
              targetWrapFunc = wrapFunc;
            }
            break;

          case E_INDEX:
            if (e.target.data.k === E_SUPER) {
              // Lower "super[prop]" if necessary
              if (p.shouldLowerSuperPropertyAccess(e.target)) {
                expr = p.lowerSuperPropertyGet(expr.loc, e.index);
              }

              // See the comment above about a similar special case for EDot
              thisArg = new Expr(EThisShared, loc);
            } else {
              const $d70 = p.captureValueWithPossibleSideEffects(loc, 2, e.target, valueDefinitelyNotMutated);
              const targetFunc = $d70[0], wrapFunc = $d70[1];
              targetWrapFunc = wrapFunc;

              // Capture the value of "this" if the target of the starting call
              // expression is a private property access
              if (e.index.data.k === E_PRIVATE_IDENTIFIER && p.privateSymbolNeedsToBeLowered(e.index.data)) {
                // "foo().#bar?.()" must capture "foo()" for "this"
                expr = p.lowerPrivateGet(targetFunc(), e.index.loc, e.index.data);
                thisArg = targetFunc();
                break;
              }

              expr = new Expr(new EIndex(targetFunc(), e.index), loc);
              thisArg = targetFunc();
            }
            break;
        }
      }
    }

    // Step 3: Figure out if we need to capture the starting value. We don't need
    // to capture it if it doesn't have any side effects (e.g. it's just a bare
    // identifier). Skipping the capture reduces code size and matches the output
    // of the TypeScript compiler.
    const $d71 = p.captureValueWithPossibleSideEffects(loc, 2, expr, valueDefinitelyNotMutated);
    const exprFunc = $d71[0], exprWrapFunc = $d71[1];
    expr = exprFunc();
    let result = exprFunc();

    // Step 4: Wrap the starting value by each expression in the chain. We
    // traverse the chain in reverse because we want to go from the inside out
    // and the chain was built from the outside in.
    let parentThisArgFunc = null;
    let parentThisArgWrapFunc = null;
    let privateThisFunc = null;
    let privateThisWrapFunc = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      // Save a reference to the value of "this" for our parent ECall
      if (i === 0 && in_.storeThisArgForParentOptionalChain && endsWithPropertyAccess) {
        const captured = p.captureValueWithPossibleSideEffects(result.loc, 2, result, valueDefinitelyNotMutated);
        parentThisArgFunc = captured[0];
        parentThisArgWrapFunc = captured[1];
        result = parentThisArgFunc();
      }

      const e = chain[i].data;
      switch (e.k) {
        case E_DOT:
          result = new Expr(new EDot(result, e.name, e.nameLoc), loc);
          break;

        case E_INDEX:
          if (e.index.data.k === E_PRIVATE_IDENTIFIER && p.privateSymbolNeedsToBeLowered(e.index.data)) {
            const private_ = e.index.data;

            // If this is private name property access inside a call expression and
            // the call expression is part of this chain, then the call expression
            // is going to need a copy of the property access target as the value
            // for "this" for the call. Example for this case: "foo.#bar?.()"
            if (i > 0) {
              if (chain[i - 1].data.k === E_CALL) {
                const captured = p.captureValueWithPossibleSideEffects(loc, 2, result, valueDefinitelyNotMutated);
                privateThisFunc = captured[0];
                privateThisWrapFunc = captured[1];
                result = privateThisFunc();
              }
            }

            result = p.lowerPrivateGet(result, e.index.loc, private_);
            continue;
          }

          result = new Expr(new EIndex(result, e.index), loc);
          break;

        case E_CALL:
          // If this is the initial ECall in the chain and it's being called off of
          // a property access, invoke the function using ".call(this, ...args)" to
          // explicitly provide the value for "this".
          if (i === chain.length - 1 && thisArg !== null) {
            result = new Expr(
              new ECall(
                new Expr(new EDot(result, "call", loc), loc),
                [thisArg, ...e.args],
                0,
                OptionalChainNone,
                TargetWasOriginallyPropertyAccess,
                e.isMultiLine,
                e.canBeUnwrappedIfUnused,
              ),
              loc,
            );
            break;
          }

          // If the target of this call expression is a private name property
          // access that's also part of this chain, then we must use the copy of
          // the property access target that was stashed away earlier as the value
          // for "this" for the call. Example for this case: "foo.#bar?.()"
          if (privateThisFunc !== null) {
            result = privateThisWrapFunc(
              new Expr(
                new ECall(
                  new Expr(new EDot(result, "call", loc), loc),
                  [privateThisFunc(), ...e.args],
                  0,
                  OptionalChainNone,
                  TargetWasOriginallyPropertyAccess,
                  e.isMultiLine,
                  e.canBeUnwrappedIfUnused,
                ),
                loc,
              ),
            );
            privateThisFunc = null;
            break;
          }

          result = new Expr(new ECall(result, e.args, 0, OptionalChainNone, e.kind, e.isMultiLine, e.canBeUnwrappedIfUnused), loc);
          break;

        case E_UNARY:
          result = new Expr(
            new EUnary(
              result,
              UnOpDelete,
              false,

              // If a delete of an optional chain takes place, it behaves as if the
              // optional chain isn't there with regard to the "delete" semantics.
              e.wasOriginallyDeleteOfIdentifierOrPropertyAccess,
            ),
            loc,
          );
          break;

        default:
          bail(); // panic("Internal error")
      }
    }

    // Step 5: Wrap it all in a conditional that returns the chain or the default
    // value if the initial value is null/undefined. The default value is usually
    // "undefined" but is "true" if the chain ends in a "delete" operator.
    // "x?.y" => "x == null ? void 0 : x.y"
    // "x()?.y()" => "(_a = x()) == null ? void 0 : _a.y()"
    result = new Expr(new EIf(new Expr(new EBinary(expr, new Expr(ENullShared, loc), BinOpLooseEq), loc), valueWhenUndefined, result), loc);
    if (exprWrapFunc !== null) {
      result = exprWrapFunc(result);
    }
    if (targetWrapFunc !== null) {
      result = targetWrapFunc(result);
    }
    if (childOut.thisArgWrapFunc !== null) {
      result = childOut.thisArgWrapFunc(result);
    }
    return [result, new exprOut(parentThisArgFunc, parentThisArgWrapFunc)];
  },

  lowerParenthesizedOptionalChain(loc, e, childOut) {
    return childOut.thisArgWrapFunc(
      new Expr(
        new ECall(
          new Expr(new EDot(e.target, "call", loc), loc),
          [childOut.thisArgFunc(), ...e.args],
          0,
          OptionalChainNone,
          TargetWasOriginallyPropertyAccess,
          e.isMultiLine,
        ),
        loc,
      ),
    );
  },

  lowerAssignmentOperator(value, callback) {
    const p = this;
    const left = value.data;
    switch (left.k) {
      case E_DOT:
        if (left.optionalChain === OptionalChainNone) {
          const $d72 = p.captureValueWithPossibleSideEffects(value.loc, 2, left.target, valueDefinitelyNotMutated);
          const referenceFunc = $d72[0], wrapFunc = $d72[1];
          return wrapFunc(
            callback(
              new Expr(new EDot(referenceFunc(), left.name, left.nameLoc), value.loc),
              new Expr(new EDot(referenceFunc(), left.name, left.nameLoc), value.loc),
            ),
          );
        }
        break;

      case E_INDEX:
        if (left.optionalChain === OptionalChainNone) {
          const $d73 = p.captureValueWithPossibleSideEffects(value.loc, 2, left.target, valueDefinitelyNotMutated);
          const targetFunc = $d73[0], targetWrapFunc = $d73[1];
          const $d74 = p.captureValueWithPossibleSideEffects(value.loc, 2, left.index, valueDefinitelyNotMutated);
          const indexFunc = $d74[0], indexWrapFunc = $d74[1];
          return targetWrapFunc(
            indexWrapFunc(
              callback(new Expr(new EIndex(targetFunc(), indexFunc()), value.loc), new Expr(new EIndex(targetFunc(), indexFunc()), value.loc)),
            ),
          );
        }
        break;

      case E_IDENTIFIER:
        // Make sure we record this usage in the usage count so that duplicating
        // a single-use reference means it's no longer considered a single-use
        // reference. Otherwise the single-use reference inlining code may
        // incorrectly inline the initializer into the first reference, leaving
        // the second reference without a definition.
        p.recordUsage(left.ref);
        return callback(new Expr(new EIdentifier(left.ref), value.loc), value);
    }

    // We shouldn't get here with valid syntax? Just let this through for now
    // since there's currently no assignment target validation. Garbage in,
    // garbage out.
    return value;
  },

  lowerExponentiationAssignmentOperator(loc, e) {
    const p = this;
    const $d75 = p.extractPrivateIndex(e.left);
    const target = $d75[0], privateLoc = $d75[1], private_ = $d75[2];
    if (private_ !== null) {
      // "a.#b **= c" => "__privateSet(a, #b, __pow(__privateGet(a, #b), c))"
      const $d76 = p.captureValueWithPossibleSideEffects(loc, 2, target, valueDefinitelyNotMutated);
      const targetFunc = $d76[0], targetWrapFunc = $d76[1];
      return targetWrapFunc(
        p.lowerPrivateSet(targetFunc(), privateLoc, private_, p.callRuntime(loc, "__pow", [p.lowerPrivateGet(targetFunc(), privateLoc, private_), e.right])),
      );
    }

    return p.lowerAssignmentOperator(e.left, (a, b) => {
      // "a **= b" => "a = __pow(a, b)"
      return assign(a, p.callRuntime(loc, "__pow", [b, e.right]));
    });
  },

  // Returns [Expr, bool]
  lowerNullishCoalescingAssignmentOperator(loc, e) {
    const p = this;
    const $d77 = p.extractPrivateIndex(e.left);
    const target = $d77[0], privateLoc = $d77[1], private_ = $d77[2];
    if (private_ !== null) {
      // (compat.NullishCoalescing is always supported in the fast path, so the
      // "(_a = __privateGet(a, #b)) != null ? _a : __privateSet(a, #b, c)" form
      // is never generated)

      // "a.#b ??= c" => "__privateGet(a, #b) ?? __privateSet(a, #b, c)"
      const $d78 = p.captureValueWithPossibleSideEffects(loc, 2, target, valueDefinitelyNotMutated);
      const targetFunc = $d78[0], targetWrapFunc = $d78[1];
      return [
        targetWrapFunc(
          new Expr(
            new EBinary(p.lowerPrivateGet(targetFunc(), privateLoc, private_), p.lowerPrivateSet(targetFunc(), privateLoc, private_, e.right), BinOpNullishCoalescing),
            loc,
          ),
        ),
        true,
      ];
    }

    // (compat.LogicalAssignment is always supported in the fast path)
    return NOT_LOWERED;
  },

  // Returns [Expr, bool]
  lowerLogicalAssignmentOperator(loc, e, op) {
    const p = this;
    const $d79 = p.extractPrivateIndex(e.left);
    const target = $d79[0], privateLoc = $d79[1], private_ = $d79[2];
    if (private_ !== null) {
      // "a.#b &&= c" => "__privateGet(a, #b) && __privateSet(a, #b, c)"
      // "a.#b ||= c" => "__privateGet(a, #b) || __privateSet(a, #b, c)"
      const $d80 = p.captureValueWithPossibleSideEffects(loc, 2, target, valueDefinitelyNotMutated);
      const targetFunc = $d80[0], targetWrapFunc = $d80[1];
      return [
        targetWrapFunc(
          new Expr(new EBinary(p.lowerPrivateGet(targetFunc(), privateLoc, private_), p.lowerPrivateSet(targetFunc(), privateLoc, private_, e.right), op), loc),
        ),
        true,
      ];
    }

    // (compat.LogicalAssignment is always supported in the fast path)
    return NOT_LOWERED;
  },

  lowerNullishCoalescing(loc, left, right) {
    const p = this;
    // "x ?? y" => "x != null ? x : y"
    // "x() ?? y()" => "_a = x(), _a != null ? _a : y"
    const $d81 = p.captureValueWithPossibleSideEffects(loc, 2, left, valueDefinitelyNotMutated);
    const leftFunc = $d81[0], wrapFunc = $d81[1];
    return wrapFunc(new Expr(new EIf(new Expr(new EBinary(leftFunc(), new Expr(ENullShared, loc), BinOpLooseNe), loc), leftFunc(), right), loc));
  },

  // Lower object spread for environments that don't support them. Non-spread
  // properties are grouped into object literals and then passed to the
  // "__spreadValues" and "__spreadProps" functions.
  //
  // (compat.ObjectRestSpread is always supported in the fast path, so
  // "needsLowering" is always false and the object is returned unchanged.)
  lowerObjectSpread(loc, e) {
    return new Expr(e, loc);
  },

  maybeLowerAwait(loc, e) {
    // "await x" turns into "yield __await(x)" when lowering async generator
    // functions, and into "yield x" when lowering async functions. Neither
    // happens in the fast path (compat.AsyncAwait and compat.AsyncGenerator
    // are always supported).
    return new Expr(e, loc);
  },

  // Only called when compat.ForAwait is unsupported (or compat.AsyncGenerator
  // inside a generator), which never happens in the fast path.
  lowerForAwaitLoop(loc, loop, stmts) {
    bail();
  },

  lowerObjectRestInDecls(decls) {
    // (compat.ObjectRestSpread is always supported in the fast path)
    return decls;
  },

  // Go signature: (init Stmt, body *Stmt). No-op in the fast path because
  // compat.ObjectRestSpread is always supported.
  lowerObjectRestInForLoopInit(init, body) {},

  // No-op in the fast path because compat.ObjectRestSpread is always supported.
  lowerObjectRestInCatchBinding(catch_) {},

  // Returns [Expr, bool]
  lowerAssign(rootExpr, rootInit, mode) {
    const p = this;
    const lowered = p.lowerSuperPropertyOrPrivateInAssign(rootExpr);
    rootExpr = lowered[0];
    const didLower = lowered[1];

    let expr = null;
    const assignFn = (left, right) => {
      expr = joinWithComma(expr, assign(left, right));
    };

    const $d82 = p.lowerObjectRestHelper(rootExpr, rootInit, assignFn, tempRefNeedsDeclare, mode);
    const initWrapFunc = $d82[0], ok = $d82[1];
    if (ok) {
      if (initWrapFunc !== null) {
        expr = initWrapFunc(expr);
      }
      return [expr, true];
    }

    if (didLower) {
      return [assign(rootExpr, rootInit), true];
    }

    return NOT_LOWERED;
  },

  // Returns [[]Decl, bool]
  lowerObjectRestToDecls(rootExpr, rootInit, decls) {
    const p = this;
    const assignFn = (left, right) => {
      const $d83 = p.convertExprToBinding(left, new invalidLog());
      const binding = $d83[0], log = $d83[1];
      if (log.invalidTokens.length > 0) {
        bail(); // panic("Internal error")
      }
      decls.push(new Decl(binding, right));
    };

    if (p.lowerObjectRestHelper(rootExpr, rootInit, assignFn, tempRefNoDeclare, objRestReturnValueIsUnused)[1]) {
      return [decls, true];
    }

    return [null, false];
  },

  // Returns [wrapFunc, ok]. The transform is only done when
  // compat.ObjectRestSpread is unsupported, which never happens in the fast
  // path, so this always returns [null, false].
  lowerObjectRestHelper(rootExpr, rootInit, assignFn, declare, mode) {
    return NOT_LOWERED;
  },

  // Save a copy of the key for the call to "__objRest" later on. Certain
  // expressions can be converted to keys more efficiently than others.
  // Returns [finalKey, capturedKey]. (Only used by object rest lowering.)
  captureKeyForObjectRest(originalKey) {
    const p = this;
    const loc = originalKey.loc;
    let finalKey = originalKey;
    let capturedKey;

    const k = originalKey.data;
    switch (k.k) {
      case E_STRING:
        capturedKey = () => new Expr(new EString(k.value), loc);
        break;

      case E_NUMBER:
        // Emit it as the number plus a string (i.e. call toString() on it).
        // It's important to do it this way instead of trying to print the
        // float as a string because Go's floating-point printer doesn't
        // behave exactly the same as JavaScript and if they are different,
        // the generated code will be wrong.
        capturedKey = () => new Expr(new EBinary(new Expr(new ENumber(k.value), loc), new Expr(new EString(), loc), BinOpAdd), loc);
        break;

      case E_IDENTIFIER:
        capturedKey = () => {
          p.recordUsage(k.ref);
          return p.callRuntime(loc, "__restKey", [new Expr(new EIdentifier(k.ref), loc)]);
        };
        break;

      default: {
        // If it's an arbitrary expression, it probably has a side effect.
        // Stash it in a temporary reference so we don't evaluate it twice.
        const tempRef = p.generateTempRef(tempRefNeedsDeclare, "");
        finalKey = assign(new Expr(new EIdentifier(tempRef), loc), originalKey);
        capturedKey = () => {
          p.recordUsage(tempRef);
          return p.callRuntime(loc, "__restKey", [new Expr(new EIdentifier(tempRef), loc)]);
        };
      }
    }

    return [finalKey, capturedKey];
  },

  // Note: a Go nil "HeadCooked"/"TailCooked" (a tagged template with an
  // invalid escape sequence) is represented as null.
  lowerTemplateLiteral(loc, e, tagThisFunc, tagWrapFunc) {
    const p = this;

    // If there is no tag, turn this into normal string concatenation
    if (e.tagOrNil === null) {
      let value;

      // Handle the head
      value = new Expr(new EString(e.headCooked, e.legacyOctalLoc), loc);

      // Handle the tail. Each one is handled with a separate call to ".concat()"
      // to handle various corner cases in the specification including:
      //
      //   * For objects, "toString" must be called instead of "valueOf"
      //   * Side effects must happen inline instead of at the end
      //   * Passing a "Symbol" instance should throw
      //
      for (let $i29 = 0, $a29 = e.parts; $i29 < $a29.length; $i29++) {
        const part = $a29[$i29];
        let args;
        if (part.tailCooked !== null && part.tailCooked.length > 0) {
          args = [part.value, new Expr(new EString(part.tailCooked), part.tailLoc)];
        } else {
          args = [part.value];
        }
        value = new Expr(new ECall(new Expr(new EDot(value, "concat", part.value.loc), loc), args, 0, OptionalChainNone, TargetWasOriginallyPropertyAccess), loc);
      }

      return value;
    }

    // Otherwise, call the tag with the template object
    let needsRaw = false;
    const cooked = [];
    const raw = [];
    const args = [null];

    // Handle the head
    if (e.headCooked === null) {
      cooked.push(new Expr(EUndefinedShared, e.headLoc));
      needsRaw = true;
    } else {
      cooked.push(new Expr(new EString(e.headCooked), e.headLoc));
      if (e.headCooked !== e.headRaw) {
        needsRaw = true;
      }
    }
    raw.push(new Expr(new EString(e.headRaw), e.headLoc));

    // Handle the tail
    for (let $i30 = 0, $a30 = e.parts; $i30 < $a30.length; $i30++) {
      const part = $a30[$i30];
      args.push(part.value);
      if (part.tailCooked === null) {
        cooked.push(new Expr(EUndefinedShared, part.tailLoc));
        needsRaw = true;
      } else {
        cooked.push(new Expr(new EString(part.tailCooked), part.tailLoc));
        if (part.tailCooked !== part.tailRaw) {
          needsRaw = true;
        }
      }
      raw.push(new Expr(new EString(part.tailRaw), part.tailLoc));
    }

    // Construct the template object
    const cookedArray = new Expr(new EArray(cooked, 0, 0, true), e.headLoc);
    let arrays;
    if (needsRaw) {
      arrays = [cookedArray, new Expr(new EArray(raw, 0, 0, true), e.headLoc)];
    } else {
      arrays = [cookedArray];
    }
    const templateObj = p.callRuntime(e.headLoc, "__template", arrays);

    // Cache it in a temporary object (required by the specification)
    const tempRef = p.generateTopLevelTempRef();
    p.recordUsage(tempRef);
    p.recordUsage(tempRef);
    args[0] = new Expr(
      new EBinary(new Expr(new EIdentifier(tempRef), loc), new Expr(new EBinary(new Expr(new EIdentifier(tempRef), loc), templateObj, BinOpAssign), loc), BinOpLogicalOr),
      loc,
    );

    // If this optional chain was used as a template tag, then also forward the value for "this"
    if (tagThisFunc !== null && tagThisFunc !== undefined) {
      return tagWrapFunc(
        new Expr(new ECall(new Expr(new EDot(e.tagOrNil, "call", e.headLoc), loc), [tagThisFunc(), ...args], 0, OptionalChainNone, TargetWasOriginallyPropertyAccess), loc),
      );
    }

    // Call the tag function
    let kind = NormalCall;
    if (e.tagWasOriginallyPropertyAccess) {
      kind = TargetWasOriginallyPropertyAccess;
    }
    return new Expr(new ECall(e.tagOrNil, args, 0, OptionalChainNone, kind), loc);
  },

  maybeLowerSetBinOp(left, op, right) {
    const p = this;
    const $d84 = p.extractPrivateIndex(left);
    const target = $d84[0], loc = $d84[1], private_ = $d84[2];
    if (private_ !== null) {
      return p.lowerPrivateSetBinOp(target, loc, private_, op, right);
    }
    const property = p.extractSuperProperty(left);
    if (property !== null) {
      return p.lowerSuperPropertySetBinOp(left.loc, property, op, right);
    }
    return null;
  },

  shouldLowerUsingDeclarations(stmts) {
    // A "using" declaration is only lowered when compat.Using is unsupported,
    // and an "await using" declaration only when compat.Using,
    // compat.AsyncAwait, or compat.AsyncGenerator (inside a generator) is
    // unsupported. None of these happen in the fast path.
    return false;
  },

  lowerUsingDeclarationContext() {
    const p = this;
    return new lowerUsingDeclarationContext(0, p.newSymbol(SymbolOther, "_stack"), false);
  },

  // Go signature: (loc, init *SLocal, body *Stmt). Every call site is guarded
  // by a compat check (compat.Using, compat.AsyncAwait, compat.AsyncGenerator)
  // that is always false in the fast path.
  lowerUsingDeclarationInForOf(loc, init, body) {
    bail();
  },

  // -------------------------------------------------------------------------
  // js_parser_lower_class.go

  privateSymbolNeedsToBeLowered(private_) {
    const p = this;
    const symbol = p.symbols[refInner(private_.ref)];
    // (compat.SymbolFeature(symbol.Kind) is always supported in the fast path)
    return (symbol.flags & PrivateSymbolMustBeLowered) !== 0;
  },

  lowerPrivateBrandCheck(target, loc, private_) {
    const p = this;
    // "#field in this" => "__privateIn(#field, this)"
    return p.callRuntime(loc, "__privateIn", [new Expr(new EIdentifier(private_.ref), loc), target]);
  },

  lowerPrivateGet(target, loc, private_) {
    const p = this;
    switch (p.symbols[refInner(private_.ref)].kind) {
      case SymbolPrivateMethod:
      case SymbolPrivateStaticMethod: {
        // "this.#method" => "__privateMethod(this, #method, method_fn)"
        const fnRef = mapGetRef(p.privateGetters, private_.ref);
        p.recordUsage(fnRef);
        return p.callRuntime(target.loc, "__privateMethod", [target, new Expr(new EIdentifier(private_.ref), loc), new Expr(new EIdentifier(fnRef), loc)]);
      }

      case SymbolPrivateGet:
      case SymbolPrivateStaticGet:
      case SymbolPrivateGetSetPair:
      case SymbolPrivateStaticGetSetPair: {
        // "this.#getter" => "__privateGet(this, #getter, getter_get)"
        const fnRef = mapGetRef(p.privateGetters, private_.ref);
        p.recordUsage(fnRef);
        return p.callRuntime(target.loc, "__privateGet", [target, new Expr(new EIdentifier(private_.ref), loc), new Expr(new EIdentifier(fnRef), loc)]);
      }

      default:
        // "this.#field" => "__privateGet(this, #field)"
        return p.callRuntime(target.loc, "__privateGet", [target, new Expr(new EIdentifier(private_.ref), loc)]);
    }
  },

  lowerPrivateSet(target, loc, private_, value) {
    const p = this;
    switch (p.symbols[refInner(private_.ref)].kind) {
      case SymbolPrivateSet:
      case SymbolPrivateStaticSet:
      case SymbolPrivateGetSetPair:
      case SymbolPrivateStaticGetSetPair: {
        // "this.#setter = 123" => "__privateSet(this, #setter, 123, setter_set)"
        const fnRef = mapGetRef(p.privateSetters, private_.ref);
        p.recordUsage(fnRef);
        return p.callRuntime(target.loc, "__privateSet", [target, new Expr(new EIdentifier(private_.ref), loc), value, new Expr(new EIdentifier(fnRef), loc)]);
      }

      default:
        // "this.#field = 123" => "__privateSet(this, #field, 123)"
        return p.callRuntime(target.loc, "__privateSet", [target, new Expr(new EIdentifier(private_.ref), loc), value]);
    }
  },

  lowerPrivateSetUnOp(target, loc, private_, op) {
    const p = this;
    const kind = p.symbols[refInner(private_.ref)].kind;

    // Determine the setter, if any
    let setter = null;
    switch (kind) {
      case SymbolPrivateSet:
      case SymbolPrivateStaticSet:
      case SymbolPrivateGetSetPair:
      case SymbolPrivateStaticGetSetPair: {
        const ref = mapGetRef(p.privateSetters, private_.ref);
        p.recordUsage(ref);
        setter = new Expr(new EIdentifier(ref), loc);
        break;
      }
    }

    // Determine the getter, if any
    let getter = null;
    switch (kind) {
      case SymbolPrivateGet:
      case SymbolPrivateStaticGet:
      case SymbolPrivateGetSetPair:
      case SymbolPrivateStaticGetSetPair: {
        const ref = mapGetRef(p.privateGetters, private_.ref);
        p.recordUsage(ref);
        getter = new Expr(new EIdentifier(ref), loc);
        break;
      }
    }

    // Only include necessary arguments
    const args = [target, new Expr(new EIdentifier(private_.ref), loc)];
    if (setter !== null) {
      args.push(setter);
    }
    if (getter !== null) {
      if (setter === null) {
        args.push(new Expr(ENullShared, loc));
      }
      args.push(getter);
    }

    // "target.#private++" => "__privateWrapper(target, #private, private_set, private_get)._++"
    return new Expr(new EUnary(new Expr(new EDot(p.callRuntime(target.loc, "__privateWrapper", args), "_", target.loc), target.loc), op), loc);
  },

  lowerPrivateSetBinOp(target, loc, private_, op, value) {
    const p = this;
    // "target.#private += 123" => "__privateSet(target, #private, __privateGet(target, #private) + 123)"
    const $d85 = p.captureValueWithPossibleSideEffects(target.loc, 2, target, valueDefinitelyNotMutated);
    const targetFunc = $d85[0], targetWrapFunc = $d85[1];
    return targetWrapFunc(
      p.lowerPrivateSet(targetFunc(), loc, private_, new Expr(new EBinary(p.lowerPrivateGet(targetFunc(), loc, private_), value, op), value.loc)),
    );
  },

  // Returns valid data if target is an expression of the form "foo.#bar" and if
  // the language target is such that private members must be lowered.
  // Returns [target Expr, loc, *EPrivateIdentifier] (the last one is null if
  // there is nothing to lower). The returned array must not be mutated.
  extractPrivateIndex(target) {
    const p = this;
    if (target.data.k === E_INDEX) {
      const index = target.data;
      if (index.index.data.k === E_PRIVATE_IDENTIFIER && p.privateSymbolNeedsToBeLowered(index.index.data)) {
        return [index.target, index.index.loc, index.index.data];
      }
    }
    return NO_PRIVATE_INDEX;
  },

  // Returns a valid property if target is an expression of the form "super.bar"
  // or "super[bar]" and if the situation is such that it must be lowered.
  // Returns null otherwise.
  extractSuperProperty(target) {
    const p = this;
    const e = target.data;
    switch (e.k) {
      case E_DOT:
        if (p.shouldLowerSuperPropertyAccess(e.target)) {
          return new Expr(new EString(e.name), e.nameLoc);
        }
        break;
      case E_INDEX:
        if (p.shouldLowerSuperPropertyAccess(e.target)) {
          return e.index;
        }
        break;
    }
    return null;
  },

  // Returns [Expr, didLower]
  lowerSuperPropertyOrPrivateInAssign(expr) {
    const p = this;
    let didLower = false;

    const e = expr.data;
    switch (e.k) {
      case E_SPREAD: {
        const $d86 = p.lowerSuperPropertyOrPrivateInAssign(e.value);
        const value = $d86[0], ok = $d86[1];
        if (ok) {
          e.value = value;
          didLower = true;
        }
        break;
      }

      case E_DOT:
        // "[super.foo] = [bar]" => "[__superWrapper(this, 'foo')._] = [bar]"
        if (p.shouldLowerSuperPropertyAccess(e.target)) {
          const key = new Expr(new EString(e.name), e.nameLoc);
          expr = p.callSuperPropertyWrapper(expr.loc, key);
          didLower = true;
        }
        break;

      case E_INDEX: {
        // "[super[foo]] = [bar]" => "[__superWrapper(this, foo)._] = [bar]"
        if (p.shouldLowerSuperPropertyAccess(e.target)) {
          expr = p.callSuperPropertyWrapper(expr.loc, e.index);
          didLower = true;
          break;
        }

        // "[a.#b] = [c]" => "[__privateWrapper(a, #b)._] = [c]"
        if (e.index.data.k === E_PRIVATE_IDENTIFIER && p.privateSymbolNeedsToBeLowered(e.index.data)) {
          const private_ = e.index.data;
          let target;

          switch (p.symbols[refInner(private_.ref)].kind) {
            case SymbolPrivateSet:
            case SymbolPrivateStaticSet:
            case SymbolPrivateGetSetPair:
            case SymbolPrivateStaticGetSetPair: {
              // "this.#setter" => "__privateWrapper(this, #setter, setter_set)"
              const fnRef = mapGetRef(p.privateSetters, private_.ref);
              p.recordUsage(fnRef);
              target = p.callRuntime(expr.loc, "__privateWrapper", [
                e.target,
                new Expr(new EIdentifier(private_.ref), expr.loc),
                new Expr(new EIdentifier(fnRef), expr.loc),
              ]);
              break;
            }

            default:
              // "this.#field" => "__privateWrapper(this, #field)"
              target = p.callRuntime(expr.loc, "__privateWrapper", [e.target, new Expr(new EIdentifier(private_.ref), expr.loc)]);
          }

          // "__privateWrapper(this, #field)" => "__privateWrapper(this, #field)._"
          expr = new Expr(new EDot(target, "_", expr.loc), expr.loc);
          didLower = true;
        }
        break;
      }

      case E_ARRAY: {
        const items = e.items;
        for (let i = 0; i < items.length; i++) {
          const $d87 = p.lowerSuperPropertyOrPrivateInAssign(items[i]);
          const item = $d87[0], ok = $d87[1];
          if (ok) {
            e.items[i] = item;
            didLower = true;
          }
        }
        break;
      }

      case E_OBJECT: {
        const properties = e.properties;
        for (let i = 0; i < properties.length; i++) {
          const property = properties[i];
          if (property.valueOrNil !== null) {
            const $d88 = p.lowerSuperPropertyOrPrivateInAssign(property.valueOrNil);
            const value = $d88[0], ok = $d88[1];
            if (ok) {
              e.properties[i].valueOrNil = value;
              didLower = true;
            }
          }
        }
        break;
      }
    }

    return [expr, didLower];
  },

  shouldLowerSuperPropertyAccess(expr) {
    const p = this;
    if (p.fnOrArrowDataVisit.shouldLowerSuperPropertyAccess) {
      return expr.data.k === E_SUPER;
    }
    return false;
  },

  callSuperPropertyWrapper(loc, key) {
    const p = this;
    const ref = p.fnOnlyDataVisit.innerClassNameRef;
    p.recordUsage(ref);
    let class_ = new Expr(new EIdentifier(ref), loc);
    let this_ = new Expr(EThisShared, loc);

    // Handle "this" in lowered static class field initializers
    if (p.fnOnlyDataVisit.shouldReplaceThisWithInnerClassNameRef) {
      p.recordUsage(ref);
      this_ = new Expr(new EIdentifier(ref), loc);
    }

    if (!p.fnOnlyDataVisit.isInStaticClassContext) {
      // "super.foo" => "__superWrapper(Class.prototype, this, 'foo')._"
      // "super[foo]" => "__superWrapper(Class.prototype, this, foo)._"
      class_ = new Expr(new EDot(class_, "prototype", loc), class_.loc);
    }

    return new Expr(new EDot(p.callRuntime(loc, "__superWrapper", [class_, this_, key]), "_", loc), loc);
  },

  lowerSuperPropertyGet(loc, key) {
    const p = this;
    const ref = p.fnOnlyDataVisit.innerClassNameRef;
    p.recordUsage(ref);
    let class_ = new Expr(new EIdentifier(ref), loc);
    let this_ = new Expr(EThisShared, loc);

    // Handle "this" in lowered static class field initializers
    if (p.fnOnlyDataVisit.shouldReplaceThisWithInnerClassNameRef) {
      p.recordUsage(ref);
      this_ = new Expr(new EIdentifier(ref), loc);
    }

    if (!p.fnOnlyDataVisit.isInStaticClassContext) {
      // "super.foo" => "__superGet(Class.prototype, this, 'foo')"
      // "super[foo]" => "__superGet(Class.prototype, this, foo)"
      class_ = new Expr(new EDot(class_, "prototype", loc), class_.loc);
    }

    return p.callRuntime(loc, "__superGet", [class_, this_, key]);
  },

  lowerSuperPropertySet(loc, key, value) {
    const p = this;
    // "super.foo = bar" => "__superSet(Class, this, 'foo', bar)"
    // "super[foo] = bar" => "__superSet(Class, this, foo, bar)"
    const ref = p.fnOnlyDataVisit.innerClassNameRef;
    p.recordUsage(ref);
    let class_ = new Expr(new EIdentifier(ref), loc);
    let this_ = new Expr(EThisShared, loc);

    // Handle "this" in lowered static class field initializers
    if (p.fnOnlyDataVisit.shouldReplaceThisWithInnerClassNameRef) {
      p.recordUsage(ref);
      this_ = new Expr(new EIdentifier(ref), loc);
    }

    if (!p.fnOnlyDataVisit.isInStaticClassContext) {
      // "super.foo = bar" => "__superSet(Class.prototype, this, 'foo', bar)"
      // "super[foo] = bar" => "__superSet(Class.prototype, this, foo, bar)"
      class_ = new Expr(new EDot(class_, "prototype", loc), class_.loc);
    }

    return p.callRuntime(loc, "__superSet", [class_, this_, key, value]);
  },

  lowerSuperPropertySetBinOp(loc, property, op, value) {
    const p = this;
    // "super.foo += bar" => "__superSet(Class, this, 'foo', __superGet(Class, this, 'foo') + bar)"
    // "super[foo] += bar" => "__superSet(Class, this, foo, __superGet(Class, this, foo) + bar)"
    // "super[foo()] += bar" => "__superSet(Class, this, _a = foo(), __superGet(Class, this, _a) + bar)"
    const $d89 = p.captureValueWithPossibleSideEffects(property.loc, 2, property, valueDefinitelyNotMutated);
    const targetFunc = $d89[0], targetWrapFunc = $d89[1];
    return targetWrapFunc(p.lowerSuperPropertySet(loc, targetFunc(), new Expr(new EBinary(p.lowerSuperPropertyGet(loc, targetFunc()), value, op), value.loc)));
  },

  // "call" is the *ECall data object (mutated in place)
  maybeLowerSuperPropertyGetInsideCall(call) {
    const p = this;
    let key;

    const e = call.target.data;
    switch (e.k) {
      case E_DOT:
        // Lower "super.prop" if necessary
        if (!p.shouldLowerSuperPropertyAccess(e.target)) {
          return;
        }
        key = new Expr(new EString(e.name), e.nameLoc);
        break;

      case E_INDEX:
        // Lower "super[prop]" if necessary
        if (!p.shouldLowerSuperPropertyAccess(e.target)) {
          return;
        }
        key = e.index;
        break;

      default:
        return;
    }

    // "super.foo(a, b)" => "__superGet(Class, this, 'foo').call(this, a, b)"
    call.target = new Expr(new EDot(p.lowerSuperPropertyGet(call.target.loc, key), "call", key.loc), call.target.loc);
    const thisExpr = new Expr(EThisShared, call.target.loc);
    call.args = [thisExpr, ...call.args];
  },

  computeClassLoweringInfo(class_) {
    const p = this;
    const result = new classLoweringInfo();

    // Name keeping for classes is implemented with a static block. So we need to
    // lower all static fields if static blocks are unsupported so that the name
    // keeping comes first before other static initializers.
    // (compat.ClassStaticBlocks is always supported in the fast path)

    // TypeScript's "experimentalDecorators" feature replaces all references of
    // the class name with the decorated class after class decorators have run.
    // This cannot be done by only reassigning to the class symbol in JavaScript
    // because it's shadowed by the class name within the class body. Instead,
    // we need to hoist all code in static contexts out of the class body so
    // that it's no longer shadowed:
    //
    //   const decorate = x => ({ x })
    //   @decorate
    //   class Foo {
    //     static oldFoo = Foo
    //     static newFoo = () => Foo
    //   }
    //   console.log('This must be false:', Foo.x.oldFoo === Foo.x.newFoo())
    //
    if (p.options.ts.parse && p.options.ts.config.experimentalDecorators === True && class_.decorators.length > 0) {
      result.lowerAllStaticFields = true;
    }

    // If something has decorators, just lower everything for now. It's possible
    // that we could avoid lowering in certain cases, but doing so is very tricky
    // due to the complexity of the decorator specification. The specification is
    // also still evolving so trying to optimize it now is also potentially
    // premature.
    if (class_.shouldLowerStandardDecorators) {
      for (let $i31 = 0, $a31 = class_.properties; $i31 < $a31.length; $i31++) {
        const prop = $a31[$i31];
        if (prop.decorators.length > 0) {
          for (let $i32 = 0, $a32 = class_.properties; $i32 < $a32.length; $i32++) {
            const prop2 = $a32[$i32];
            const private_ = keyPrivate(prop2.key);
            if (private_ !== null) {
              p.symbols[refInner(private_.ref)].flags |= PrivateSymbolMustBeLowered;
            }
          }
          result.lowerAllStaticFields = true;
          result.lowerAllInstanceFields = true;
          break;
        }
      }
    }

    // Conservatively lower fields of a given type (instance or static) when any
    // member of that type needs to be lowered. This must be done to preserve
    // evaluation order. For example:
    //
    //   class Foo {
    //     #foo = 123
    //     bar = this.#foo
    //   }
    //
    // It would be bad if we transformed that into something like this:
    //
    //   var _foo;
    //   class Foo {
    //     constructor() {
    //       _foo.set(this, 123);
    //     }
    //     bar = __privateGet(this, _foo);
    //   }
    //   _foo = new WeakMap();
    //
    // That evaluates "bar" then "foo" instead of "foo" then "bar" like the
    // original code. We need to do this instead:
    //
    //   var _foo;
    //   class Foo {
    //     constructor() {
    //       _foo.set(this, 123);
    //       __publicField(this, "bar", __privateGet(this, _foo));
    //     }
    //   }
    //   _foo = new WeakMap();
    //
    for (let $i33 = 0, $a33 = class_.properties; $i33 < $a33.length; $i33++) {
      const prop = $a33[$i33];
      if (prop.kind === PropertyClassStaticBlock) {
        // (compat.ClassStaticBlocks is always supported in the fast path)
        continue;
      }

      const private_ = keyPrivate(prop.key);
      if (private_ !== null) {
        if ((prop.flags & PropertyIsStatic) !== 0) {
          if (p.privateSymbolNeedsToBeLowered(private_)) {
            result.lowerAllStaticFields = true;
          }
        } else {
          if (p.privateSymbolNeedsToBeLowered(private_)) {
            result.lowerAllInstanceFields = true;

            // We can't transform this:
            //
            //   class Foo {
            //     #foo = 123
            //     static bar = new Foo().#foo
            //   }
            //
            // into this:
            //
            //   var _foo;
            //   const _Foo = class {
            //     constructor() {
            //       _foo.set(this, 123);
            //     }
            //     static bar = __privateGet(new _Foo(), _foo);
            //   };
            //   let Foo = _Foo;
            //   _foo = new WeakMap();
            //
            // because "_Foo" won't be initialized in the initializer for "bar".
            // So we currently lower all static fields in this case too. This
            // isn't great and it would be good to find a way to avoid this.
            // The inner class name symbol substitution mechanism should probably
            // be rethought.
            result.lowerAllStaticFields = true;
          }
        }
        continue;
      }

      if (prop.kind === PropertyAutoAccessor) {
        // (compat.ClassPrivateStaticField and compat.ClassPrivateField are
        // always supported in the fast path)
        continue;
      }

      // This doesn't come before the private member check above because
      // unsupported private methods must also trigger field lowering:
      //
      //   class Foo {
      //     bar = this.#foo()
      //     #foo() {}
      //   }
      //
      // It would be bad if we transformed that to something like this:
      //
      //   var _foo, foo_fn;
      //   class Foo {
      //     constructor() {
      //       _foo.add(this);
      //     }
      //     bar = __privateMethod(this, _foo, foo_fn).call(this);
      //   }
      //   _foo = new WeakSet();
      //   foo_fn = function() {
      //   };
      //
      // In that case the initializer of "bar" would fail to call "#foo" because
      // it's only added to the instance in the body of the constructor.
      if (propertyKindIsMethodDefinition(prop.kind)) {
        // We need to shim "super()" inside the constructor if this is a derived
        // class and the constructor has any parameter properties, since those
        // use "this" and we can only access "this" after "super()" is called
        if (class_.extendsOrNil !== null) {
          if (prop.key !== null && prop.key.data.k === E_STRING && prop.key.data.value === "constructor") {
            if (prop.valueOrNil !== null && prop.valueOrNil.data.k === E_FUNCTION) {
              for (let $i34 = 0, $a34 = prop.valueOrNil.data.fn.args; $i34 < $a34.length; $i34++) {
                const arg = $a34[$i34];
                if (arg.isTypeScriptCtorField) {
                  result.shimSuperCtorCalls = true;
                  break;
                }
              }
            }
          }
        }
        continue;
      }

      if ((prop.flags & PropertyIsStatic) !== 0) {
        // Static fields must be lowered if the target doesn't support them
        // (compat.ClassStaticField is always supported in the fast path)

        // Convert static fields to assignment statements if the TypeScript
        // setting for this is enabled. If class static blocks are supported,
        // then we can do this inline without needing to move the initializers
        // outside of the class body. (compat.ClassStaticBlocks is always
        // supported in the fast path, so nothing needs to be done here.)
      } else {
        if (p.options.ts.parse && !class_.useDefineForClassFields) {
          // Convert instance fields to assignment statements if the TypeScript
          // setting for this is enabled. I don't think this matters for private
          // fields because there's no way for this to call a setter in the base
          // class, so this isn't done for private fields.
          if (prop.initializerOrNil !== null) {
            // We can skip lowering all instance fields if all instance fields
            // disappear completely when lowered. This happens when
            // "useDefineForClassFields" is false and there is no initializer.
            result.lowerAllInstanceFields = true;
          }
        }
        // (else: compat.ClassField is always supported in the fast path)
      }
    }

    // We need to shim "super()" inside the constructor if this is a derived
    // class and there are any instance fields that need to be lowered, since
    // those use "this" and we can only access "this" after "super()" is called
    if (result.lowerAllInstanceFields && class_.extendsOrNil !== null) {
      result.shimSuperCtorCalls = true;
    }

    return result;
  },

  // Apply all relevant transforms to a class object (either a statement or an
  // expression) including:
  //
  //   - Transforming class fields for older environments
  //   - Transforming static blocks for older environments
  //   - Transforming TypeScript experimental decorators into JavaScript
  //   - Transforming TypeScript class fields into assignments for "useDefineForClassFields"
  //
  // Note that this doesn't transform any nested AST subtrees inside the class
  // body (e.g. the contents of initializers, methods, and static blocks). Those
  // have already been transformed by "visitClass" by this point. It's done that
  // way for performance so that we don't need to do another AST pass.
  //
  // "stmt" is null for class expressions and "expr" is null for class
  // statements. Returns [[]Stmt, Expr].
  lowerClass(stmt, expr, result, nameToKeep) {
    const p = this;
    const ctx = new lowerClassContext();
    ctx.nameToKeep = nameToKeep;
    ctx.extendsRef = InvalidRef;
    ctx.decoratorContextRef = InvalidRef;
    ctx.privateInstanceMethodRef = InvalidRef;
    ctx.privateStaticMethodRef = InvalidRef;

    // Unpack the class from the statement or expression
    if (stmt === null) {
      const e = expr.data;
      ctx.class = e.class;
      ctx.classExpr = expr;
      ctx.kind = classKindExpr;
      if (ctx.class.name !== null) {
        const symbol = p.symbols[refInner(ctx.class.name.ref)];
        ctx.nameToKeep = symbol.originalName;

        // The inner class name inside the class expression should be the same as
        // the class expression name itself
        if (result.innerClassNameRef !== InvalidRef) {
          p.mergeSymbols(result.innerClassNameRef, ctx.class.name.ref);
        }

        // Remove unused class names when minifying. Check this after we merge in
        // the inner class name above since that will adjust the use count.
        if (p.options.minifySyntax && symbol.useCountEstimate === 0) {
          ctx.class.name = null;
        }
      }
    } else if (stmt.data.k === S_CLASS) {
      const s = stmt.data;
      ctx.class = s.class;
      if (ctx.class.name !== null) {
        ctx.nameToKeep = p.symbols[refInner(ctx.class.name.ref)].originalName;
      }
      if (s.isExport) {
        ctx.kind = classKindExportStmt;
      } else {
        ctx.kind = classKindStmt;
      }
    } else {
      const s = stmt.data; // SExportDefault
      const s2 = s.value.data; // SClass
      ctx.class = s2.class;
      if (ctx.class.name !== null) {
        ctx.nameToKeep = p.symbols[refInner(ctx.class.name.ref)].originalName;
      }
      ctx.defaultName = s.defaultName;
      ctx.kind = classKindExportDefaultStmt;
    }
    if (stmt === null) {
      ctx.classLoc = expr.loc;
    } else {
      ctx.classLoc = stmt.loc;
    }

    const loweringInfo = p.computeClassLoweringInfo(ctx.class);
    ctx.enableNameCapture(p, result);
    ctx.processProperties(p, loweringInfo, result);
    ctx.insertInitializersIntoConstructor(p, loweringInfo, result);
    return ctx.finishAndGenerateCode(p, result);
  },

  propertyNameHint(key) {
    const p = this;
    if (key === null) return "";
    const k = key.data;
    switch (k.k) {
      case E_STRING:
        return k.value;
      case E_IDENTIFIER:
        return p.symbols[refInner(k.ref)].originalName;
      case E_PRIVATE_IDENTIFIER:
        return p.symbols[refInner(k.ref)].originalName.slice(1);
      default:
        return "";
    }
  },

  // Replace "super()" calls with our shim so that we can guarantee
  // that instance field initialization doesn't happen before "super()"
  // is called, since at that point "this" isn't available.
  //
  // "body" is the *FnBody (mutated in place).
  insertStmtsAfterSuperCall(body, stmtsToInsert, superCtorRef) {
    const p = this;

    // If this class has no base class, then there's no "super()" call to handle
    if (superCtorRef === InvalidRef || p.symbols[refInner(superCtorRef)].useCountEstimate === 0) {
      body.block.stmts = stmtsToInsert.concat(body.block.stmts);
      return;
    }

    // It's likely that there's only one "super()" call, and that it's a
    // top-level expression in the constructor function body. If so, we
    // can generate tighter code for this common case.
    if (p.symbols[refInner(superCtorRef)].useCountEstimate === 1) {
      const bodyStmts = body.block.stmts;
      for (let i = 0; i < bodyStmts.length; i++) {
        const stmt = bodyStmts[i];
        let before = null;
        let callLoc = 0;
        let callData = null;
        let after = null;

        const s = stmt.data;
        switch (s.k) {
          case S_EXPR: {
            const $d90 = findFirstTopLevelSuperCall(s.value, superCtorRef);
            const b = $d90[0], loc = $d90[1], c = $d90[2], a = $d90[3];
            if (c !== null) {
              before = b;
              callLoc = loc;
              callData = c;
              if (a !== null) {
                s.value = a;
                after = new Stmt(s, a.loc);
              }
            }
            break;
          }

          case S_RETURN:
            if (s.valueOrNil !== null) {
              const $d91 = findFirstTopLevelSuperCall(s.valueOrNil, superCtorRef);
              const b = $d91[0], loc = $d91[1], c = $d91[2], a = $d91[3];
              if (c !== null && a !== null) {
                before = b;
                callLoc = loc;
                callData = c;
                s.valueOrNil = a;
                after = new Stmt(s, a.loc);
              }
            }
            break;

          case S_THROW: {
            const $d92 = findFirstTopLevelSuperCall(s.value, superCtorRef);
            const b = $d92[0], loc = $d92[1], c = $d92[2], a = $d92[3];
            if (c !== null && a !== null) {
              before = b;
              callLoc = loc;
              callData = c;
              s.value = a;
              after = new Stmt(s, a.loc);
            }
            break;
          }

          case S_IF: {
            const $d93 = findFirstTopLevelSuperCall(s.test, superCtorRef);
            const b = $d93[0], loc = $d93[1], c = $d93[2], a = $d93[3];
            if (c !== null && a !== null) {
              before = b;
              callLoc = loc;
              callData = c;
              s.test = a;
              after = new Stmt(s, a.loc);
            }
            break;
          }

          case S_SWITCH: {
            const $d94 = findFirstTopLevelSuperCall(s.test, superCtorRef);
            const b = $d94[0], loc = $d94[1], c = $d94[2], a = $d94[3];
            if (c !== null && a !== null) {
              before = b;
              callLoc = loc;
              callData = c;
              s.test = a;
              after = new Stmt(s, a.loc);
            }
            break;
          }

          case S_FOR:
            if (s.initOrNil !== null && s.initOrNil.data.k === S_EXPR) {
              const expr = s.initOrNil.data;
              const $d95 = findFirstTopLevelSuperCall(expr.value, superCtorRef);
              const b = $d95[0], loc = $d95[1], c = $d95[2], a = $d95[3];
              if (c !== null) {
                before = b;
                callLoc = loc;
                callData = c;
                if (a !== null) {
                  expr.value = a;
                } else {
                  s.initOrNil = null;
                }
                after = new Stmt(s, a !== null ? a.loc : 0);
              }
            }
            break;
        }

        if (callData !== null) {
          // Revert "__super()" back to "super()"
          callData.target = new Expr(ESuperShared, callData.target.loc);
          p.ignoreUsage(superCtorRef);

          // Inject "stmtsToInsert" after "super()"
          const stmts = bodyStmts.slice(0, i);
          if (before !== null) {
            stmts.push(new Stmt(new SExpr(before), before.loc));
          }
          stmts.push(new Stmt(new SExpr(new Expr(callData, callLoc)), callLoc));
          for (const x of stmtsToInsert) stmts.push(x);
          if (after !== null) {
            stmts.push(after);
          }
          for (let j = i + 1; j < bodyStmts.length; j++) stmts.push(bodyStmts[j]);
          body.block.stmts = stmts;
          return;
        }
      }
    }

    // Otherwise, inject a generated "__super" helper function at the top of the
    // constructor that looks like this:
    //
    //   var __super = (...args) => {
    //     super(...args);
    //     ...stmtsToInsert...
    //     return this;
    //   };
    //
    const argsRef = p.newSymbol(SymbolOther, "args");
    p.currentScope.generated.push(argsRef);
    p.recordUsage(argsRef);
    const superCall = new Expr(new ECall(new Expr(ESuperShared, body.loc), [new Expr(new ESpread(new Expr(new EIdentifier(argsRef), body.loc)), body.loc)]), body.loc);
    stmtsToInsert = [new Stmt(new SExpr(superCall), body.loc), ...stmtsToInsert, new Stmt(new SReturn(new Expr(EThisShared, body.loc)), body.loc)];
    if (p.options.minifySyntax) {
      bail(); // (minify only: p.mangleStmts(stmtsToInsert, stmtsFnBody))
    }
    body.block.stmts = [
      new Stmt(
        new SLocal([
          new Decl(
            new Binding(new BIdentifier(superCtorRef), body.loc),
            new Expr(
              new EArrow(
                [new Arg(new Binding(new BIdentifier(argsRef), body.loc))],
                new FnBody(new SBlock(stmtsToInsert), body.loc),
                false, // isAsync
                true, // hasRestArg
                true, // preferExpr
              ),
              body.loc,
            ),
          ),
        ]),
        body.loc,
      ),
      ...body.block.stmts,
    ];
  },
};

// ---------------------------------------------------------------------------
// Package-level functions (js_parser_lower.go)

export function bindingHasObjectRest(binding) {
  const b = binding.data;
  switch (b.k) {
    case B_ARRAY:
      for (let $i35 = 0, $a35 = b.items; $i35 < $a35.length; $i35++) {
        const item = $a35[$i35];
        if (bindingHasObjectRest(item.binding)) {
          return true;
        }
      }
      break;
    case B_OBJECT:
      for (let $i36 = 0, $a36 = b.properties; $i36 < $a36.length; $i36++) {
        const property = $a36[$i36];
        if (property.isSpread || bindingHasObjectRest(property.value)) {
          return true;
        }
      }
      break;
  }
  return false;
}

export function exprHasObjectRest(expr) {
  if (expr === null) return false;
  const e = expr.data;
  switch (e.k) {
    case E_BINARY:
      if (e.op === BinOpAssign && exprHasObjectRest(e.left)) {
        return true;
      }
      break;
    case E_ARRAY:
      for (let $i37 = 0, $a37 = e.items; $i37 < $a37.length; $i37++) {
        const item = $a37[$i37];
        if (exprHasObjectRest(item)) {
          return true;
        }
      }
      break;
    case E_OBJECT:
      for (let $i38 = 0, $a38 = e.properties; $i38 < $a38.length; $i38++) {
        const property = $a38[$i38];
        if (property.kind === PropertySpread || exprHasObjectRest(property.valueOrNil)) {
          return true;
        }
      }
      break;
  }
  return false;
}

export function couldPotentiallyThrow(data) {
  switch (data.k) {
    case E_NULL:
    case E_UNDEFINED:
    case E_BOOLEAN:
    case E_NUMBER:
    case E_BIG_INT:
    case E_STRING:
    case E_FUNCTION:
    case E_ARROW:
      return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// lowerUsingDeclarationContext methods (js_parser_lower.go)

Object.assign(lowerUsingDeclarationContext.prototype, {
  scanStmts(p, stmts) {
    const ctx = this;
    for (const stmt of stmts) {
      if (stmt.data.k === S_LOCAL && localKindIsUsing(stmt.data.kind)) {
        const local = stmt.data;

        // Wrap each "using" initializer in a call to the "__using" helper function
        if (ctx.firstUsingLoc === 0) {
          ctx.firstUsingLoc = stmt.loc;
        }
        if (local.kind === LocalAwaitUsing) {
          ctx.hasAwaitUsing = true;
        }
        for (let i = 0; i < local.decls.length; i++) {
          const decl = local.decls[i];
          if (decl.valueOrNil !== null) {
            const valueLoc = decl.valueOrNil.loc;
            p.recordUsage(ctx.stackRef);
            const args = [new Expr(new EIdentifier(ctx.stackRef), valueLoc), decl.valueOrNil];
            if (local.kind === LocalAwaitUsing) {
              args.push(new Expr(new EBoolean(true), valueLoc));
            }
            local.decls[i].valueOrNil = p.callRuntime(valueLoc, "__using", args);
          }
        }
        if (p.willWrapModuleInTryCatchForUsing && p.currentScope.parent === null) {
          local.kind = LocalVar;
        } else {
          local.kind = p.selectLocalKind(LocalConst);
        }
      }
    }
  },

  finalize(p, stmts, shouldHoistFunctions) {
    const ctx = this;
    const result = [];
    const exports = [];
    let end = 0;

    // Filter out statements that can't go in a try/catch block
    for (const stmt of stmts) {
      const s = stmt.data;
      switch (s.k) {
        // Note: We don't need to handle class declarations here because they
        // should have been already converted into local "var" declarations
        // before this point. It's done in "lowerClass" instead of here because
        // "lowerClass" already does this sometimes for other reasons, and it's
        // more straightforward to do it in one place because it's complicated.

        case S_DIRECTIVE:
        case S_IMPORT:
        case S_EXPORT_FROM:
        case S_EXPORT_STAR:
          // These can't go in a try/catch block
          result.push(stmt);
          continue;

        case S_EXPORT_CLAUSE:
          // Merge export clauses together
          for (const item of s.items) exports.push(item);
          continue;

        case S_FUNCTION:
          if (shouldHoistFunctions) {
            // Hoist function declarations for cross-file ESM references
            result.push(stmt);
            continue;
          }
          break;

        case S_EXPORT_DEFAULT:
          if (s.value.data.k === S_FUNCTION && shouldHoistFunctions) {
            // Hoist function declarations for cross-file ESM references
            result.push(stmt);
            continue;
          }
          break;

        case S_LOCAL:
          // If any of these are exported, turn it into a "var" and add export clauses
          if (s.isExport) {
            forEachIdentifierBindingInDecls(s.decls, (loc, b) => {
              exports.push(new ClauseItem(p.symbols[refInner(b.ref)].originalName, "", loc, new LocRef(loc, b.ref)));
              s.kind = LocalVar;
            });
            s.isExport = false;
          }
          break;
      }

      stmts[end] = stmt;
      end++;
    }
    stmts = stmts.slice(0, end);

    // Generate the variables we'll need
    const caughtRef = p.newSymbol(SymbolOther, "_");
    const errorRef = p.newSymbol(SymbolOther, "_error");
    const hasErrorRef = p.newSymbol(SymbolOther, "_hasError");

    // Generated variables are declared with "var", so hoist them up
    let scope = p.currentScope;
    while (!scopeKindStopsHoisting(scope.kind)) {
      scope = scope.parent;
    }
    const isTopLevel = scope === p.moduleScope;
    scope.generated.push(ctx.stackRef, caughtRef, errorRef, hasErrorRef);
    p.currentPart.declaredSymbols.push(
      new DeclaredSymbol(ctx.stackRef, isTopLevel),
      new DeclaredSymbol(caughtRef, isTopLevel),
      new DeclaredSymbol(errorRef, isTopLevel),
      new DeclaredSymbol(hasErrorRef, isTopLevel),
    );

    // Call the "__callDispose" helper function at the end of the scope
    const loc = ctx.firstUsingLoc;
    p.recordUsage(ctx.stackRef);
    p.recordUsage(errorRef);
    p.recordUsage(hasErrorRef);
    const callDispose = p.callRuntime(loc, "__callDispose", [
      new Expr(new EIdentifier(ctx.stackRef), loc),
      new Expr(new EIdentifier(errorRef), loc),
      new Expr(new EIdentifier(hasErrorRef), loc),
    ]);

    // If there was an "await using", optionally await the returned promise
    let finallyStmts;
    if (ctx.hasAwaitUsing) {
      const promiseRef = p.generateTempRef(tempRefNoDeclare, "_promise");
      scope.generated.push(promiseRef);
      p.currentPart.declaredSymbols.push(new DeclaredSymbol(promiseRef, isTopLevel));

      // "await" expressions turn into "yield" expressions when lowering
      p.recordUsage(promiseRef);
      const awaitExpr = p.maybeLowerAwait(loc, new EAwait(new Expr(new EIdentifier(promiseRef), loc)));

      p.recordUsage(promiseRef);
      finallyStmts = [
        new Stmt(new SLocal([new Decl(new Binding(new BIdentifier(promiseRef), loc), callDispose)]), loc),

        // The "await" must not happen if an error was thrown before the
        // "await using", so we conditionally await here:
        //
        //   var promise = __callDispose(stack, error, hasError);
        //   promise && await promise;
        //
        new Stmt(new SExpr(new Expr(new EBinary(new Expr(new EIdentifier(promiseRef), loc), awaitExpr, BinOpLogicalAnd), loc)), loc),
      ];
    } else {
      finallyStmts = [new Stmt(new SExpr(callDispose), loc)];
    }

    // Wrap everything in a try/catch/finally block
    p.recordUsage(caughtRef);
    result.push(
      new Stmt(new SLocal([new Decl(new Binding(new BIdentifier(ctx.stackRef), loc), new Expr(new EArray(), loc))]), loc),
      new Stmt(
        new STry(
          new Catch(
            new Binding(new BIdentifier(caughtRef), loc),
            new SBlock([
              new Stmt(
                new SLocal([
                  new Decl(new Binding(new BIdentifier(errorRef), loc), new Expr(new EIdentifier(caughtRef), loc)),
                  new Decl(new Binding(new BIdentifier(hasErrorRef), loc), new Expr(new EBoolean(true), loc)),
                ]),
                loc,
              ),
            ]),
            loc,
            loc,
          ),
          new Finally(new SBlock(finallyStmts), loc),
          new SBlock(stmts),
          loc,
        ),
        loc,
      ),
    );
    if (exports.length > 0) {
      result.push(new Stmt(new SExportClause(exports), loc));
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// Package-level functions (js_parser_lower_class.go)

// This corresponds to the initialization order in the specification:
//
//  27. For each element e of staticElements, do
//     a. If e is a ClassElementDefinition Record and e.[[Kind]] is not field, then
//
//  28. For each element e of instanceElements, do
//     a. If e.[[Kind]] is not field, then
//
//  29. For each element e of staticElements, do
//     a. If e.[[Kind]] is field, then
//
//  30. For each element e of instanceElements, do
//     a. If e.[[Kind]] is field, then
//
// Returns [int, bool]
export function fieldOrAccessorOrder(kind: number, flags: number): [number, boolean] {
  if (kind === PropertyAutoAccessor) {
    if ((flags & PropertyIsStatic) !== 0) {
      return [0, true];
    } else {
      return [1, true];
    }
  } else if (kind === PropertyField) {
    if ((flags & PropertyIsStatic) !== 0) {
      return [2, true];
    } else {
      return [3, true];
    }
  }
  return [0, false];
}

export function cloneKeyForLowerClass(key) {
  const k = key.data;
  switch (k.k) {
    case E_NUMBER:
      return new Expr(new ENumber(k.value), key.loc);
    case E_STRING:
      return new Expr(new EString(k.value, k.legacyOctalLoc, k.preferTemplate, k.hasPropertyKeyComment, k.containsUniqueKey), key.loc);
    case E_IDENTIFIER:
      return new Expr(new EIdentifier(k.ref, k.mustKeepDueToWithStmt, k.canBeRemovedIfUnused, k.callCanBeUnwrappedIfUnused), key.loc);
    case E_NAME_OF_SYMBOL:
      return new Expr(new ENameOfSymbol(k.ref, k.hasPropertyKeyComment), key.loc);
    case E_PRIVATE_IDENTIFIER:
      return new Expr(new EPrivateIdentifier(k.ref), key.loc);
    default:
      bail(); // panic("Internal error")
  }
}

// Returns [before Expr, loc, *ECall, after Expr]. Note: like Go, this mutates
// the matching call's target to "super" even if the caller ends up not using
// the result.
export function findFirstTopLevelSuperCall(expr, superCtorRef) {
  const e = expr.data;
  if (e.k === E_CALL) {
    const target = e.target.data;
    if (target.k === E_IDENTIFIER && target.ref === superCtorRef) {
      e.target = new Expr(ESuperShared, e.target.loc);
      return [null, expr.loc, e, null];
    }
  }

  // Also search down comma operator chains for a super call
  if (e.k === E_BINARY && e.op === BinOpComma) {
    {
      const $d96 = findFirstTopLevelSuperCall(e.left, superCtorRef);
      const before = $d96[0], loc = $d96[1], call = $d96[2], after = $d96[3];
      if (call !== null) {
        return [before, loc, call, joinWithComma(after, e.right)];
      }
    }

    {
      const $d97 = findFirstTopLevelSuperCall(e.right, superCtorRef);
      const before = $d97[0], loc = $d97[1], call = $d97[2], after = $d97[3];
      if (call !== null) {
        return [joinWithComma(e.left, before), loc, call, after];
      }
    }
  }

  return NO_SUPER_CALL;
}

function pushAll(dst, src) {
  for (let i = 0; i < src.length; i++) dst.push(src[i]);
}

// ---------------------------------------------------------------------------
// lowerClassContext methods (js_parser_lower_class.go)

Object.assign(lowerClassContext.prototype, {
  enableNameCapture(p, result) {
    const ctx = this;

    // Class statements can be missing a name if they are in an
    // "export default" statement:
    //
    //   export default class {
    //     static foo = 123
    //   }
    //
    ctx.nameFunc = () => {
      if (ctx.kind === classKindExpr) {
        // If this is a class expression, capture and store it. We have to
        // do this even if it has a name since the name isn't exposed
        // outside the class body.
        const classExpr = new EClass(ctx.class.clone());
        ctx.class = classExpr.class;
        const captured = p.captureValueWithPossibleSideEffects(ctx.classLoc, 2, new Expr(classExpr, ctx.classLoc), valueDefinitelyNotMutated);
        ctx.nameFunc = captured[0];
        ctx.wrapFunc = captured[1];
        ctx.classExpr = ctx.nameFunc();
        ctx.didCaptureClassExpr = true;
        const name = ctx.nameFunc();

        // If we're storing the class expression in a variable, remove the class
        // name and rewrite all references to the class name with references to
        // the temporary variable holding the class expression. This ensures that
        // references to the class expression by name in any expressions that end
        // up being pulled outside of the class body still work. For example:
        //
        //   let Bar = class Foo {
        //     static foo = 123
        //     static bar = Foo.foo
        //   }
        //
        // This might be converted into the following:
        //
        //   var _a;
        //   let Bar = (_a = class {
        //   }, _a.foo = 123, _a.bar = _a.foo, _a);
        //
        if (ctx.class.name !== null) {
          p.mergeSymbols(ctx.class.name.ref, name.data.ref);
          ctx.class.name = null;
        }

        return name;
      } else {
        // If anything referenced the inner class name, then we should use that
        // name for any automatically-generated initialization code, since it
        // will come before the outer class name is initialized.
        if (result.innerClassNameRef !== InvalidRef) {
          p.recordUsage(result.innerClassNameRef);
          return new Expr(new EIdentifier(result.innerClassNameRef), ctx.class.name.loc);
        }

        // Otherwise we should just use the outer class name
        if (ctx.class.name === null) {
          if (ctx.kind === classKindExportDefaultStmt) {
            ctx.class.name = ctx.defaultName;
          } else {
            ctx.class.name = new LocRef(ctx.classLoc, p.generateTempRef(tempRefNoDeclare, ""));
          }
        }
        p.recordUsage(ctx.class.name.ref);
        return new Expr(new EIdentifier(ctx.class.name.ref), ctx.class.name.loc);
      }
    };
  },

  // Handle lowering of instance and static fields. Move their initializers
  // from the class body to either the constructor (instance fields) or after
  // the class (static fields).
  //
  // If this returns true, the return property should be added to the class
  // body. Otherwise the property should be omitted from the class body.
  //
  // Returns [Property, ast.Ref, bool]. "prop" is never mutated.
  lowerField(p, prop, private_, shouldOmitFieldInitializer, staticFieldToBlockAssign, initializerIndex) {
    const ctx = this;
    const mustLowerPrivate = private_ !== null && p.privateSymbolNeedsToBeLowered(private_);
    let ref = InvalidRef;

    // The TypeScript compiler doesn't follow the JavaScript spec for
    // uninitialized fields. They are supposed to be set to undefined but the
    // TypeScript compiler just omits them entirely.
    if (!shouldOmitFieldInitializer) {
      const loc = prop.loc;
      const isStatic = (prop.flags & PropertyIsStatic) !== 0;

      // Determine where to store the field
      let target;
      if (isStatic && !staticFieldToBlockAssign) {
        target = ctx.nameFunc();
      } else {
        target = new Expr(EThisShared, loc);
      }

      // Generate the assignment initializer
      let init;
      if (prop.initializerOrNil !== null) {
        init = prop.initializerOrNil;
      } else {
        init = new Expr(EUndefinedShared, loc);
      }

      // Optionally call registered decorator initializers
      if (initializerIndex !== -1) {
        let value;
        if (isStatic) {
          value = ctx.nameFunc();
        } else {
          value = new Expr(EThisShared, loc);
        }
        const args = [new Expr(new EIdentifier(ctx.decoratorContextRef), loc), new Expr(new ENumber((4 + 2 * initializerIndex) << 1), loc), value];
        if (init.data.k !== E_UNDEFINED) {
          args.push(init);
        }
        init = p.callRuntime(init.loc, "__runInitializers", args);
        p.recordUsage(ctx.decoratorContextRef);
      }

      // Generate the assignment target
      let memberExpr;
      if (mustLowerPrivate) {
        // Generate a new symbol for this private field
        ref = p.generateTempRef(tempRefNeedsDeclare, "_" + p.symbols[refInner(private_.ref)].originalName.slice(1));
        p.symbols[refInner(private_.ref)].link = ref;

        // Initialize the private field to a new WeakMap
        if (p.weakMapRef === InvalidRef) {
          p.weakMapRef = p.newSymbol(SymbolUnbound, "WeakMap");
          p.moduleScope.generated.push(p.weakMapRef);
        }
        ctx.privateMembers.push(
          assign(new Expr(new EIdentifier(ref), prop.key.loc), new Expr(new ENew(new Expr(new EIdentifier(p.weakMapRef), prop.key.loc)), prop.key.loc)),
        );
        p.recordUsage(ref);

        // Add every newly-constructed instance into this map
        const key = new Expr(new EIdentifier(ref), prop.key.loc);
        const args = [target, key];
        if (init.data.k !== E_UNDEFINED) {
          args.push(init);
        }
        memberExpr = p.callRuntime(loc, "__privateAdd", args);
        p.recordUsage(ref);
      } else if (private_ === null && ctx.class.useDefineForClassFields) {
        if (p.shouldAddKeyComment) {
          if (prop.key.data.k === E_STRING) {
            prop.key.data.hasPropertyKeyComment = true;
          }
        }
        const args = [target, prop.key];
        if (init.data.k !== E_UNDEFINED) {
          args.push(init);
        }
        memberExpr = new Expr(new ECall(p.importFromRuntime(loc, "__publicField"), args), loc);
      } else {
        if (prop.key.data.k === E_STRING && (prop.flags & PropertyIsComputed) === 0 && (prop.flags & PropertyPreferQuotedKey) === 0) {
          target = new Expr(new EDot(target, prop.key.data.value, prop.key.loc), loc);
        } else {
          target = new Expr(new EIndex(target, prop.key), loc);
        }

        memberExpr = assign(target, init);
      }

      // Run extra initializers
      if (initializerIndex !== -1) {
        let value;
        if (isStatic) {
          value = ctx.nameFunc();
        } else {
          value = new Expr(EThisShared, loc);
        }
        memberExpr = joinWithComma(
          memberExpr,
          p.callRuntime(loc, "__runInitializers", [
            new Expr(new EIdentifier(ctx.decoratorContextRef), loc),
            new Expr(new ENumber(((5 + 2 * initializerIndex) << 1) | 1), loc),
            value,
          ]),
        );
        p.recordUsage(ctx.decoratorContextRef);
      }

      if (isStatic) {
        // Move this property to an assignment after the class ends
        if (staticFieldToBlockAssign) {
          // Use inline assignment in a static block instead of lowering
          return [
            new Property(
              new ClassStaticBlock(new SBlock([new Stmt(new SExpr(memberExpr), loc)]), loc),
              null,
              null,
              null,
              [],
              loc,
              0,
              PropertyClassStaticBlock,
              0,
            ),
            ref,
            true,
          ];
        } else {
          // Move this property to an assignment after the class ends
          ctx.staticMembers.push(memberExpr);
        }
      } else {
        // Move this property to an assignment inside the class constructor
        ctx.instanceMembers.push(new Stmt(new SExpr(memberExpr), loc));
      }
    }

    if (private_ === null || mustLowerPrivate) {
      // Remove the field from the class body
      return [null, ref, false];
    }

    // Keep the private field but remove the initializer
    prop = prop.clone();
    prop.initializerOrNil = null;
    return [prop, ref, true];
  },

  lowerPrivateMethod(p, prop, private_) {
    const ctx = this;

    // All private methods can share the same WeakSet
    const isStatic = (prop.flags & PropertyIsStatic) !== 0;
    let ref = isStatic ? ctx.privateStaticMethodRef : ctx.privateInstanceMethodRef;
    if (ref === InvalidRef) {
      // Generate a new symbol to store the WeakSet
      let name;
      if (isStatic) {
        name = "_static";
      } else {
        name = "_instances";
      }
      if (ctx.nameToKeep !== "") {
        name = `_${ctx.nameToKeep}${name}`;
      }
      ref = p.generateTempRef(tempRefNeedsDeclare, name);
      if (isStatic) {
        ctx.privateStaticMethodRef = ref;
      } else {
        ctx.privateInstanceMethodRef = ref;
      }

      // Generate the initializer
      if (p.weakSetRef === InvalidRef) {
        p.weakSetRef = p.newSymbol(SymbolUnbound, "WeakSet");
        p.moduleScope.generated.push(p.weakSetRef);
      }
      ctx.privateMembers.push(
        assign(new Expr(new EIdentifier(ref), ctx.classLoc), new Expr(new ENew(new Expr(new EIdentifier(p.weakSetRef), ctx.classLoc)), ctx.classLoc)),
      );
      p.recordUsage(ref);
      p.recordUsage(p.weakSetRef);

      // Determine what to store in the WeakSet
      let target;
      if (isStatic) {
        target = ctx.nameFunc();
      } else {
        target = new Expr(EThisShared, ctx.classLoc);
      }

      // Add every newly-constructed instance into this set
      const methodExpr = p.callRuntime(ctx.classLoc, "__privateAdd", [target, new Expr(new EIdentifier(ref), ctx.classLoc)]);
      p.recordUsage(ref);

      // Make sure that adding to the map happens before any field
      // initializers to handle cases like this:
      //
      //   class A {
      //     pub = this.#priv;
      //     #priv() {}
      //   }
      //
      if (isStatic) {
        // Move this property to an assignment after the class ends
        ctx.staticPrivateMethods.push(methodExpr);
      } else {
        // Move this property to an assignment inside the class constructor
        ctx.instancePrivateMethods.push(new Stmt(new SExpr(methodExpr), ctx.classLoc));
      }
    }
    p.symbols[refInner(private_.ref)].link = ref;
  },

  // If this returns true, the method property should be dropped as it has
  // already been accounted for elsewhere (e.g. a lowered private method).
  lowerMethod(p, prop, private_) {
    const ctx = this;
    if (private_ !== null && p.privateSymbolNeedsToBeLowered(private_)) {
      ctx.lowerPrivateMethod(p, prop, private_);

      // Move the method definition outside the class body
      const methodRef = p.generateTempRef(tempRefNeedsDeclare, "_");
      if (prop.kind === PropertySetter) {
        p.symbols[refInner(methodRef)].link = mapGetRef(p.privateSetters, private_.ref);
      } else {
        p.symbols[refInner(methodRef)].link = mapGetRef(p.privateGetters, private_.ref);
      }
      p.recordUsage(methodRef);
      ctx.privateMembers.push(assign(new Expr(new EIdentifier(methodRef), prop.key.loc), prop.valueOrNil));
      return true;
    }

    if (prop.key.data.k === E_STRING && prop.key.data.value === "constructor") {
      if (prop.valueOrNil !== null && prop.valueOrNil.data.k === E_FUNCTION) {
        const fn = prop.valueOrNil.data;

        // Remember where the constructor is for later
        ctx.ctor = fn;

        // Initialize TypeScript constructor parameter fields
        if (p.options.ts.parse) {
          for (let $i39 = 0, $a39 = ctx.ctor.fn.args; $i39 < $a39.length; $i39++) {
            const arg = $a39[$i39];
            if (arg.isTypeScriptCtorField) {
              if (arg.binding.data.k === B_IDENTIFIER) {
                const id = arg.binding.data;
                const loc = arg.binding.loc;
                const name = p.symbols[refInner(id.ref)].originalName;
                const target = new Expr(EThisShared, loc);
                const init = new Expr(new EIdentifier(id.ref), loc);

                // See: https://github.com/evanw/esbuild/issues/4421
                // (the condition "!UseDefineForClassFields || !Has(compat.ClassField)"
                // is always true in the fast path)
                ctx.parameterFields.push(assignStmt(new Expr(p.dotOrMangledPropVisit(target, name, loc), loc), init));
                if (ctx.class.useDefineForClassFields) {
                  const key = new Expr(new EString(name), loc);
                  // (compat.ClassField is always supported in the fast path)
                  ctx.parameterFieldProps.push(new Property(null, key, null, null, [], loc, 0, PropertyField, 0));
                }
              }
            }
          }
        }
      }
    }

    return false;
  },

  analyzeProperty(p, prop, loweringInfo) {
    const ctx = this;
    const analysis = new propertyAnalysis();

    // The TypeScript class field transform requires removing fields without
    // initializers. If the field is removed, then we only need the key for
    // its side effects and we don't need a temporary reference for the key.
    // However, the TypeScript compiler doesn't remove the field when doing
    // strict class field initialization, so we shouldn't either.
    analysis.private = keyPrivate(prop.key);
    const mustLowerPrivate = analysis.private !== null && p.privateSymbolNeedsToBeLowered(analysis.private);
    analysis.shouldOmitFieldInitializer =
      p.options.ts.parse &&
      !propertyKindIsMethodDefinition(prop.kind) &&
      prop.initializerOrNil === null &&
      !ctx.class.useDefineForClassFields &&
      !mustLowerPrivate &&
      !ctx.class.shouldLowerStandardDecorators;

    // Class fields must be lowered if the environment doesn't support them
    if (!propertyKindIsMethodDefinition(prop.kind)) {
      if ((prop.flags & PropertyIsStatic) !== 0) {
        analysis.mustLowerField = loweringInfo.lowerAllStaticFields;
      } else if (prop.kind === PropertyField && p.options.ts.parse && !ctx.class.useDefineForClassFields && analysis.private === null) {
        // Lower non-private instance fields (not accessors) if TypeScript's
        // "useDefineForClassFields" setting is disabled. When all such fields
        // have no initializers, we avoid setting the "lowerAllInstanceFields"
        // flag as an optimization because we can just remove all class field
        // declarations in that case without messing with the constructor. But
        // we must set the "mustLowerField" flag here to cause this class field
        // declaration to still be removed.
        analysis.mustLowerField = true;
      } else {
        analysis.mustLowerField = loweringInfo.lowerAllInstanceFields;
      }
    }

    // If the field uses the TypeScript "declare" or "abstract" keyword, just
    // omit it entirely. However, we must still keep any side-effects in the
    // computed value and/or in the decorators.
    if (prop.kind === PropertyDeclareOrAbstract && prop.valueOrNil === null) {
      analysis.mustLowerField = true;
      analysis.shouldOmitFieldInitializer = true;
    }

    // For convenience, split decorators off into separate fields based on how
    // they will end up being lowered (if they are even being lowered at all)
    if (p.options.ts.parse && p.options.ts.config.experimentalDecorators === True) {
      analysis.propExperimentalDecorators = prop.decorators;
    } else if (ctx.class.shouldLowerStandardDecorators) {
      analysis.propDecorators = prop.decorators;
    }

    // Note: Auto-accessors use a different transform when they are decorated.
    // This transform trades off worse run-time performance for better code size.
    // (compat.Decorators is always supported in the fast path)
    analysis.rewriteAutoAccessorToGetSet = analysis.propDecorators.length === 0 && prop.kind === PropertyAutoAccessor && analysis.mustLowerField;

    // Transform non-lowered static fields that use assign semantics into an
    // assignment in an inline static block instead of lowering them. This lets
    // us avoid having to unnecessarily lower static private fields when
    // "useDefineForClassFields" is disabled.
    analysis.staticFieldToBlockAssign =
      prop.kind === PropertyField &&
      !analysis.mustLowerField &&
      !ctx.class.useDefineForClassFields &&
      (prop.flags & PropertyIsStatic) !== 0 &&
      analysis.private === null;

    // Computed properties can't be copied or moved because they have side effects
    // and we don't want to evaluate their side effects twice or change their
    // evaluation order. We'll need to store them in temporary variables to keep
    // their side effects in place when we reference them elsewhere.
    analysis.needsValueOfKey = true;
    if (
      (prop.flags & PropertyIsComputed) !== 0 &&
      (analysis.propExperimentalDecorators.length > 0 ||
        analysis.propDecorators.length > 0 ||
        analysis.mustLowerField ||
        analysis.staticFieldToBlockAssign ||
        analysis.rewriteAutoAccessorToGetSet)
    ) {
      analysis.isComputedPropertyCopiedOrMoved = true;

      // Determine if we don't actually need the value of the key (only the side
      // effects). In that case we don't need a temporary variable.
      if (
        analysis.propExperimentalDecorators.length === 0 &&
        analysis.propDecorators.length === 0 &&
        !analysis.rewriteAutoAccessorToGetSet &&
        analysis.shouldOmitFieldInitializer
      ) {
        analysis.needsValueOfKey = false;
      }
    }
    return analysis;
  },

  // Returns [propertyKeyTempRefs Map<number, Ref> | null, decoratorTempRefs Map<number, Ref> | null]
  hoistComputedProperties(p, loweringInfo) {
    const ctx = this;
    let propertyKeyTempRefs = null;
    let decoratorTempRefs = null;

    // Go keeps a pointer to the "Key" field of a property. We keep the
    // property itself and read/write its "key" field instead.
    let nextComputedPropertyKey = null;

    // Computed property keys must be evaluated in a specific order for their
    // side effects. This order must be preserved even when we have to move a
    // class element around. For example, this can happen when using class fields
    // with computed property keys and targeting environments without class field
    // support. For example:
    //
    //   class Foo {
    //     [a()]() {}
    //     static [b()] = null;
    //     [c()]() {}
    //   }
    //
    // If we need to lower the static field because static fields aren't supported,
    // we still need to ensure that "b()" is called before "a()" and after "c()".
    // That looks something like this:
    //
    //   var _a;
    //   class Foo {
    //     [a()]() {}
    //     [(_a = b(), c())]() {}
    //   }
    //   __publicField(Foo, _a, null);
    //
    // Iterate in reverse so that any initializers are "pushed up" before the
    // class body if there's nowhere else to put them. They can't be "pushed
    // down" into a static block in the class body (the logical place to put
    // them that's next in the evaluation order) because these expressions
    // may contain "await" and static blocks do not allow "await".
    for (let propIndex = ctx.class.properties.length - 1; propIndex >= 0; propIndex--) {
      const prop = ctx.class.properties[propIndex];
      const analysis = ctx.analyzeProperty(p, prop, loweringInfo);

      // Evaluate the decorator expressions inline before computed property keys
      let decorators = null;
      if (analysis.propDecorators.length > 0) {
        let name = p.propertyNameHint(prop.key);
        if (name !== "") {
          name = "_" + name;
        }
        name += "_dec";
        const ref = p.generateTempRef(tempRefNeedsDeclare, name);
        const values = new Array(analysis.propDecorators.length);
        for (let i = 0; i < analysis.propDecorators.length; i++) {
          values[i] = analysis.propDecorators[i].value;
        }
        const atLoc = analysis.propDecorators[0].atLoc;
        decorators = assign(new Expr(new EIdentifier(ref), atLoc), new Expr(new EArray(values, 0, 0, true), atLoc));
        p.recordUsage(ref);
        if (decoratorTempRefs === null) {
          decoratorTempRefs = new Map();
        }
        decoratorTempRefs.set(propIndex, ref);
      }

      // Skip property keys that we know are side-effect free
      const keyKind = prop.key === null ? 0 : prop.key.data.k;
      if (keyKind === E_STRING || keyKind === E_NAME_OF_SYMBOL || keyKind === E_NUMBER || keyKind === E_PRIVATE_IDENTIFIER) {
        // Figure out where to stick the decorator side effects to preserve their order
        if (nextComputedPropertyKey !== null) {
          // Insert it before everything that comes after it
          nextComputedPropertyKey.key = joinWithComma(decorators, nextComputedPropertyKey.key);
        } else {
          // Insert it after the first thing that comes before it
          ctx.computedPropertyChain = joinWithComma(decorators, ctx.computedPropertyChain);
        }
        continue;
      } else {
        // Otherwise, evaluate the decorators right before the property key
        if (decorators !== null) {
          prop.key = joinWithComma(decorators, prop.key);
          prop.flags |= PropertyIsComputed;
        }
      }

      // If this key is referenced elsewhere, make sure to still preserve
      // its side effects in the property's original location
      if (analysis.isComputedPropertyCopiedOrMoved) {
        // If this property is being duplicated instead of moved or removed, then
        // we still need the assignment to the temporary so that we can reference
        // it in multiple places, but we don't have to hoist the assignment to an
        // earlier property (since this property is still there). In that case
        // we can reduce generated code size by avoiding the hoist. One example
        // of this case is a decorator on a class element with a computed
        // property key:
        //
        //   class Foo {
        //     @dec [a()]() {}
        //   }
        //
        // We want to do this:
        //
        //   var _a;
        //   class Foo {
        //     [_a = a()]() {}
        //   }
        //   __decorateClass([dec], Foo.prototype, _a, 1);
        //
        // instead of this:
        //
        //   var _a;
        //   _a = a();
        //   class Foo {
        //     [_a]() {}
        //   }
        //   __decorateClass([dec], Foo.prototype, _a, 1);
        //
        // So only do the hoist if this property is being moved or removed.
        if (!analysis.rewriteAutoAccessorToGetSet && (analysis.mustLowerField || analysis.staticFieldToBlockAssign)) {
          let inlineKey = prop.key;

          if (!analysis.needsValueOfKey) {
            // In certain cases, we only need to evaluate a property key for its
            // side effects but we don't actually need the value of the key itself.
            // For example, a TypeScript class field without an initializer is
            // omitted when TypeScript's "useDefineForClassFields" setting is false.
          } else {
            // Store the key in a temporary so we can refer to it later
            const ref = p.generateTempRef(tempRefNeedsDeclare, "");
            inlineKey = assign(new Expr(new EIdentifier(ref), prop.key.loc), prop.key);
            p.recordUsage(ref);

            // Replace this property key with a reference to the temporary. We
            // don't need to store the temporary in the "propertyKeyTempRefs"
            // map because all references will refer to the temporary, not just
            // some of them.
            prop.key = new Expr(new EIdentifier(ref), prop.key.loc);
            p.recordUsage(ref);
          }

          // Figure out where to stick this property's side effect to preserve its order
          if (nextComputedPropertyKey !== null) {
            // Insert it before everything that comes after it
            nextComputedPropertyKey.key = joinWithComma(inlineKey, nextComputedPropertyKey.key);
          } else {
            // Insert it after the first thing that comes before it
            ctx.computedPropertyChain = joinWithComma(inlineKey, ctx.computedPropertyChain);
          }
          continue;
        }

        // Otherwise, we keep the side effects in place (as described above) but
        // just store the key in a temporary so we can refer to it later.
        const ref = p.generateTempRef(tempRefNeedsDeclare, "");
        prop.key = assign(new Expr(new EIdentifier(ref), prop.key.loc), prop.key);
        p.recordUsage(ref);

        // Use this temporary when creating duplicate references to this key
        if (propertyKeyTempRefs === null) {
          propertyKeyTempRefs = new Map();
        }
        propertyKeyTempRefs.set(propIndex, ref);

        // Deliberately continue to fall through to the "computed" case below:
      }

      // Otherwise, this computed property could be a good location to evaluate
      // something that comes before it. Remember this location for later.
      if ((prop.flags & PropertyIsComputed) !== 0) {
        // If any side effects after this were hoisted here, then inline them now.
        // We don't want to reorder any side effects.
        if (ctx.computedPropertyChain !== null) {
          let ref = propertyKeyTempRefs !== null ? propertyKeyTempRefs.get(propIndex) : undefined;
          if (ref === undefined) {
            ref = p.generateTempRef(tempRefNeedsDeclare, "");
            prop.key = assign(new Expr(new EIdentifier(ref), prop.key.loc), prop.key);
            p.recordUsage(ref);
          }
          prop.key = joinWithComma(joinWithComma(prop.key, ctx.computedPropertyChain), new Expr(new EIdentifier(ref), prop.key.loc));
          p.recordUsage(ref);
          ctx.computedPropertyChain = null;
        }

        // Remember this location for later
        nextComputedPropertyKey = prop;
      }
    }

    // If any side effects in the class body were hoisted up to the "extends"
    // clause, then inline them before the "extends" clause is evaluated. We
    // don't want to reorder any side effects. For example:
    //
    //   class Foo extends a() {
    //     static [b()]
    //   }
    //
    // We want to do this:
    //
    //   var _a, _b;
    //   class Foo extends (_b = a(), _a = b(), _b) {
    //   }
    //   __publicField(Foo, _a);
    //
    // instead of this:
    //
    //   var _a;
    //   _a = b();
    //   class Foo extends a() {
    //   }
    //   __publicField(Foo, _a);
    //
    if (ctx.computedPropertyChain !== null && ctx.class.extendsOrNil !== null) {
      ctx.extendsRef = p.generateTempRef(tempRefNeedsDeclare, "");
      const extendsLoc = ctx.class.extendsOrNil.loc;
      ctx.class.extendsOrNil = joinWithComma(
        joinWithComma(assign(new Expr(new EIdentifier(ctx.extendsRef), extendsLoc), ctx.class.extendsOrNil), ctx.computedPropertyChain),
        new Expr(new EIdentifier(ctx.extendsRef), extendsLoc),
      );
      p.recordUsage(ctx.extendsRef);
      p.recordUsage(ctx.extendsRef);
      ctx.computedPropertyChain = null;
    }
    return [propertyKeyTempRefs, decoratorTempRefs];
  },

  processProperties(p, loweringInfo, result) {
    const ctx = this;
    let properties = [];
    const $d98 = ctx.hoistComputedProperties(p, loweringInfo);
    const propertyKeyTempRefs = $d98[0], decoratorTempRefs = $d98[1];

    // Save the initializer index for each field and accessor element
    if (ctx.class.shouldLowerStandardDecorators) {
      const counts = [0, 0, 0, 0];

      // Count how many initializers there are in each section
      for (let $i40 = 0, $a40 = ctx.class.properties; $i40 < $a40.length; $i40++) {
        const prop = $a40[$i40];
        if (prop.decorators.length > 0) {
          const $d99 = fieldOrAccessorOrder(prop.kind, prop.flags);
          const i = $d99[0], ok = $d99[1];
          if (ok) {
            counts[i]++;
          } else if ((prop.flags & PropertyIsStatic) !== 0) {
            ctx.decoratorCallStaticMethodExtraInitializers = true;
          } else {
            ctx.decoratorCallInstanceMethodExtraInitializers = true;
          }
        }
      }

      // Give each on an index for the order it will be initialized in
      if (counts[0] > 0 || counts[1] > 0 || counts[2] > 0 || counts[3] > 0) {
        const indices = [0, counts[0], counts[0] + counts[1], counts[0] + counts[1] + counts[2]];
        ctx.decoratorPropertyToInitializerMap = new Map();

        const props = ctx.class.properties;
        for (let propIndex = 0; propIndex < props.length; propIndex++) {
          const prop = props[propIndex];
          if (prop.decorators.length > 0) {
            const $d100 = fieldOrAccessorOrder(prop.kind, prop.flags);
            const i = $d100[0], ok = $d100[1];
            if (ok) {
              ctx.decoratorPropertyToInitializerMap.set(propIndex, indices[i]);
              indices[i]++;
            }
          }
        }
      }
    }

    // Evaluate the decorator expressions inline
    if (ctx.class.shouldLowerStandardDecorators && ctx.class.decorators.length > 0) {
      let name = ctx.nameToKeep;
      if (name === "") {
        name = "class";
      }
      const decoratorsRef = p.generateTempRef(tempRefNeedsDeclare, `_${name}_decorators`);
      const classDecorators = ctx.class.decorators;
      const values = new Array(classDecorators.length);
      for (let i = 0; i < classDecorators.length; i++) {
        values[i] = classDecorators[i].value;
      }
      const atLoc = classDecorators[0].atLoc;
      ctx.computedPropertyChain = joinWithComma(
        assign(new Expr(new EIdentifier(decoratorsRef), atLoc), new Expr(new EArray(values, 0, 0, true), atLoc)),
        ctx.computedPropertyChain,
      );
      p.recordUsage(decoratorsRef);
      ctx.decoratorClassDecorators = new Expr(new EIdentifier(decoratorsRef), atLoc);
      p.recordUsage(decoratorsRef);
      ctx.class.decorators = [];
    }

    // Go ranges over a copy of the slice header and each "prop" is a copy
    const classProperties = ctx.class.properties;
    for (let propIndex = 0; propIndex < classProperties.length; propIndex++) {
      let prop = classProperties[propIndex].clone();

      if (prop.kind === PropertyClassStaticBlock) {
        // Drop empty class blocks when minifying
        if (p.options.minifySyntax && prop.classStaticBlock.block.stmts.length === 0) {
          continue;
        }

        // Lower this block if needed
        if (loweringInfo.lowerAllStaticFields) {
          ctx.lowerStaticBlock(p, prop.loc, prop.classStaticBlock);
          continue;
        }

        // Otherwise, keep this property
        properties.push(prop);
        continue;
      }

      // Merge parameter decorators with method decorators
      if (p.options.ts.parse && propertyKindIsMethodDefinition(prop.kind)) {
        if (prop.valueOrNil !== null && prop.valueOrNil.data.k === E_FUNCTION) {
          const fn = prop.valueOrNil.data;
          let isConstructor = false;
          if (prop.key.data.k === E_STRING) {
            isConstructor = prop.key.data.value === "constructor";
          }
          const args = fn.fn.args;
          for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            for (let $i41 = 0, $a41 = arg.decorators; $i41 < $a41.length; $i41++) {
              const decorator = $a41[$i41];
              // Generate a call to "__decorateParam()" for this parameter decorator
              const newDecorator = new Decorator(
                p.callRuntime(decorator.value.loc, "__decorateParam", [new Expr(new ENumber(i), decorator.value.loc), decorator.value]),
                decorator.atLoc,
              );
              // (Go appends to a slice that may share its backing array, so
              // copy instead of pushing onto a possibly-shared array)
              if (isConstructor) {
                ctx.class.decorators = ctx.class.decorators.concat([newDecorator]);
              } else {
                prop.decorators = prop.decorators.concat([newDecorator]);
              }
              args[i].decorators = [];
            }
          }
        }
      }

      const analysis = ctx.analyzeProperty(p, prop, loweringInfo);

      // When the property key needs to be referenced multiple times, subsequent
      // references may need to reference a temporary variable instead of copying
      // the whole property key expression (since we only want to evaluate side
      // effects once).
      let keyExprNoSideEffects = prop.key;
      if (propertyKeyTempRefs !== null && propertyKeyTempRefs.has(propIndex)) {
        keyExprNoSideEffects = new Expr(new EIdentifier(propertyKeyTempRefs.get(propIndex)), keyExprNoSideEffects.loc);
      }

      // Handle TypeScript experimental decorators
      if (analysis.propExperimentalDecorators.length > 0) {
        prop.decorators = [];

        // Generate a single call to "__decorateClass()" for this property
        const loc = prop.key.loc;

        // This code tells "__decorateClass()" if the descriptor should be undefined
        let descriptorKind = 1;
        if (prop.kind === PropertyField || prop.kind === PropertyDeclareOrAbstract) {
          descriptorKind = 2;
        }

        // Instance properties use the prototype, static properties use the class
        let target;
        if ((prop.flags & PropertyIsStatic) !== 0) {
          target = ctx.nameFunc();
        } else {
          target = new Expr(new EDot(ctx.nameFunc(), "prototype", loc), loc);
        }

        const values = new Array(analysis.propExperimentalDecorators.length);
        for (let i = 0; i < analysis.propExperimentalDecorators.length; i++) {
          values[i] = analysis.propExperimentalDecorators[i].value;
        }
        const decorator = p.callRuntime(loc, "__decorateClass", [
          new Expr(new EArray(values), loc),
          target,
          cloneKeyForLowerClass(keyExprNoSideEffects),
          new Expr(new ENumber(descriptorKind), loc),
        ]);

        // Static decorators are grouped after instance decorators
        if ((prop.flags & PropertyIsStatic) !== 0) {
          ctx.staticExperimentalDecorators.push(decorator);
        } else {
          ctx.instanceExperimentalDecorators.push(decorator);
        }
      }

      // Handle JavaScript decorators
      let initializerIndex = -1;
      if (analysis.propDecorators.length > 0) {
        prop.decorators = [];
        const loc = prop.loc;
        const keyLoc = prop.key.loc;
        const atLoc = analysis.propDecorators[0].atLoc;

        // Encode information about this property using bit flags
        let flags = 0;
        switch (prop.kind) {
          case PropertyMethod:
            flags = 1;
            break;
          case PropertyGetter:
            flags = 2;
            break;
          case PropertySetter:
            flags = 3;
            break;
          case PropertyAutoAccessor:
            flags = 4;
            break;
          case PropertyField:
            flags = 5;
            break;
        }
        if (flags >= 4) {
          initializerIndex = mapGetRef(ctx.decoratorPropertyToInitializerMap, propIndex);
        }
        if ((prop.flags & PropertyIsStatic) !== 0) {
          flags |= 8;
        }
        if (analysis.private !== null) {
          flags |= 16;
        }

        // Start the arguments for the call to "__decorateElement"
        let key;
        const decoratorsRef = mapGetRef(decoratorTempRefs, propIndex);
        if (ctx.decoratorContextRef === InvalidRef) {
          ctx.decoratorContextRef = p.generateTempRef(tempRefNeedsDeclare, "_init");
        }
        if (analysis.private !== null) {
          key = new Expr(new EString(p.symbols[refInner(analysis.private.ref)].originalName), loc);
        } else {
          key = cloneKeyForLowerClass(keyExprNoSideEffects);
        }
        const args = [
          new Expr(new EIdentifier(ctx.decoratorContextRef), loc),
          new Expr(new ENumber(flags), loc),
          key,
          new Expr(new EIdentifier(decoratorsRef), atLoc),
        ];
        p.recordUsage(ctx.decoratorContextRef);
        p.recordUsage(decoratorsRef);

        // Append any optional additional arguments
        let privateFnRef = InvalidRef;
        if (analysis.private !== null) {
          // Add the "target" argument (the weak set)
          args.push(new Expr(new EIdentifier(analysis.private.ref), keyLoc));
          p.recordUsage(analysis.private.ref);

          // Add the "extra" argument (the function)
          switch (prop.kind) {
            case PropertyMethod:
              privateFnRef = mapGetRef(p.privateGetters, analysis.private.ref);
              break;
            case PropertyGetter:
              privateFnRef = mapGetRef(p.privateGetters, analysis.private.ref);
              break;
            case PropertySetter:
              privateFnRef = mapGetRef(p.privateSetters, analysis.private.ref);
              break;
          }
          if (privateFnRef !== InvalidRef) {
            args.push(new Expr(new EIdentifier(privateFnRef), keyLoc));
            p.recordUsage(privateFnRef);
          }
        } else {
          // Add the "target" argument (the class object)
          args.push(ctx.nameFunc());
        }

        // Auto-accessors will generate a private field for storage. Lower this
        // field, which will generate a WeakMap instance, and then pass the
        // WeakMap instance into the decorator helper so the lowered getter and
        // setter can use it.
        if (prop.kind === PropertyAutoAccessor) {
          let kind;
          if ((prop.flags & PropertyIsStatic) !== 0) {
            kind = SymbolPrivateStaticField;
          } else {
            kind = SymbolPrivateField;
          }
          const ref = p.newSymbol(kind, "#" + p.propertyNameHint(prop.key));
          p.symbols[refInner(ref)].flags |= PrivateSymbolMustBeLowered;
          const autoAccessorWeakMapRef = ctx.lowerField(p, prop, new EPrivateIdentifier(ref), false, false, initializerIndex)[1];
          args.push(new Expr(new EIdentifier(autoAccessorWeakMapRef), keyLoc));
          p.recordUsage(autoAccessorWeakMapRef);
        }

        // Assign the result
        let element = p.callRuntime(loc, "__decorateElement", args);
        if (privateFnRef !== InvalidRef) {
          element = assign(new Expr(new EIdentifier(privateFnRef), keyLoc), element);
          p.recordUsage(privateFnRef);
        } else if (prop.kind === PropertyAutoAccessor && analysis.private !== null) {
          const ref = p.generateTempRef(tempRefNeedsDeclare, "");
          const privateGetFnRef = p.generateTempRef(tempRefNeedsDeclare, "_");
          const privateSetFnRef = p.generateTempRef(tempRefNeedsDeclare, "_");
          p.symbols[refInner(privateGetFnRef)].link = mapGetRef(p.privateGetters, analysis.private.ref);
          p.symbols[refInner(privateSetFnRef)].link = mapGetRef(p.privateSetters, analysis.private.ref);

          // Unpack the "get" and "set" properties from the returned property descriptor
          element = joinWithComma(
            joinWithComma(
              assign(new Expr(new EIdentifier(ref), loc), element),
              assign(new Expr(new EIdentifier(privateGetFnRef), keyLoc), new Expr(new EDot(new Expr(new EIdentifier(ref), loc), "get", loc), loc)),
            ),
            assign(new Expr(new EIdentifier(privateSetFnRef), keyLoc), new Expr(new EDot(new Expr(new EIdentifier(ref), loc), "set", loc), loc)),
          );
          p.recordUsage(ref);
          p.recordUsage(privateGetFnRef);
          p.recordUsage(ref);
          p.recordUsage(privateSetFnRef);
          p.recordUsage(ref);
        }

        // Put the call to the decorators in the right place
        if (prop.kind === PropertyField) {
          // Field
          if ((prop.flags & PropertyIsStatic) !== 0) {
            ctx.decoratorStaticFieldElements.push(element);
          } else {
            ctx.decoratorInstanceFieldElements.push(element);
          }
        } else {
          // Non-field
          if ((prop.flags & PropertyIsStatic) !== 0) {
            ctx.decoratorStaticNonFieldElements.push(element);
          } else {
            ctx.decoratorInstanceNonFieldElements.push(element);
          }
        }

        // Omit decorated auto-accessors as they will be now generated at run-time instead
        if (prop.kind === PropertyAutoAccessor) {
          if (analysis.private !== null) {
            ctx.lowerPrivateMethod(p, prop, analysis.private);
          }
          continue;
        }
      }

      // Generate get/set methods for auto-accessors
      if (analysis.rewriteAutoAccessorToGetSet) {
        properties = ctx.rewriteAutoAccessorToGetSet(p, prop, properties, keyExprNoSideEffects, analysis.mustLowerField, analysis.private, result);
        continue;
      }

      // Lower fields
      if ((!propertyKindIsMethodDefinition(prop.kind) && analysis.mustLowerField) || analysis.staticFieldToBlockAssign) {
        const lowered = ctx.lowerField(
          p,
          prop,
          analysis.private,
          analysis.shouldOmitFieldInitializer,
          analysis.staticFieldToBlockAssign,
          initializerIndex,
        );
        prop = lowered[0];
        if (!lowered[2]) {
          continue;
        }
      }

      // Lower methods
      if (propertyKindIsMethodDefinition(prop.kind) && ctx.lowerMethod(p, prop, analysis.private)) {
        continue;
      }

      // Keep this property
      properties.push(prop);
    }

    // Finish the filtering operation
    ctx.class.properties = properties;
  },

  // "block" is the *ClassStaticBlock (Go passes a copy; it is not mutated)
  lowerStaticBlock(p, loc, block) {
    const ctx = this;
    let isAllExprs = [];

    // Are all statements in the block expression statements?
    loop: for (let $i42 = 0, $a42 = block.block.stmts; $i42 < $a42.length; $i42++) {
      const stmt = $a42[$i42];
      const s = stmt.data;
      switch (s.k) {
        case S_EMPTY:
          // Omit stray semicolons completely
          break;
        case S_EXPR:
          isAllExprs.push(s.value);
          break;
        default:
          isAllExprs = null;
          break loop;
      }
    }

    if (isAllExprs !== null) {
      // I think it should be safe to inline the static block IIFE here
      // since all uses of "this" should have already been replaced by now.
      pushAll(ctx.staticMembers, isAllExprs);
    } else {
      // But if there is a non-expression statement, fall back to using an
      // IIFE since we may be in an expression context and can't use a block.
      ctx.staticMembers.push(
        new Expr(
          new ECall(
            new Expr(new EArrow([], new FnBody(block.block.clone(), block.loc)), loc),
            [],
            0,
            OptionalChainNone,
            NormalCall,
            false,
            p.astHelpers.stmtsCanBeRemovedIfUnused(block.block.stmts, 0),
          ),
          loc,
        ),
      );
    }
  },

  // Returns the updated "properties" array
  rewriteAutoAccessorToGetSet(p, prop, properties, keyExprNoSideEffects, mustLowerField, private_, result) {
    const ctx = this;
    let storageKind;
    if ((prop.flags & PropertyIsStatic) !== 0) {
      storageKind = SymbolPrivateStaticField;
    } else {
      storageKind = SymbolPrivateField;
    }

    // Generate the name of the private field to use for storage
    let storageName;
    const k = keyExprNoSideEffects.data;
    switch (k.k) {
      case E_STRING:
        storageName = "#" + k.value;
        break;
      case E_PRIVATE_IDENTIFIER:
        storageName = "#_" + p.symbols[refInner(k.ref)].originalName.slice(1);
        break;
      default:
        storageName = "#" + numberToMinifiedNameJS(ctx.autoAccessorCount);
        ctx.autoAccessorCount++;
    }

    // Generate the symbols we need
    const storageRef = p.newSymbol(storageKind, storageName);
    const argRef = p.newSymbol(SymbolOther, "_");
    result.bodyScope.generated.push(storageRef);
    const argScope = new Scope();
    argScope.kind = ScopeFunctionBody;
    argScope.generated = [argRef];
    result.bodyScope.children.push(argScope);

    // Replace this accessor with other properties
    const loc = keyExprNoSideEffects.loc;
    const storagePrivate = new EPrivateIdentifier(storageRef);
    if (mustLowerField) {
      // Forward the accessor's lowering status on to the storage field. If we
      // don't do this, then we risk having the underlying private symbol
      // behaving differently than if it were authored manually (e.g. being
      // placed outside of the class body, which is a syntax error).
      p.symbols[refInner(storageRef)].flags |= PrivateSymbolMustBeLowered;
    }
    const storageNeedsToBeLowered = p.privateSymbolNeedsToBeLowered(storagePrivate);
    const storageProp = new Property(
      null,
      new Expr(storagePrivate, loc), // key
      null,
      prop.initializerOrNil,
      [],
      prop.loc,
      0,
      PropertyField,
      prop.flags & PropertyIsStatic,
    );
    if (!mustLowerField) {
      properties.push(storageProp);
    } else {
      const lowered = ctx.lowerField(p, storageProp, storagePrivate, false, false, -1);
      if (lowered[2]) {
        properties.push(lowered[0]);
      }
    }

    // Getter
    let getExpr;
    if (storageNeedsToBeLowered) {
      getExpr = p.lowerPrivateGet(new Expr(EThisShared, loc), loc, storagePrivate);
    } else {
      p.recordUsage(storageRef);
      getExpr = new Expr(new EIndex(new Expr(EThisShared, loc), new Expr(new EPrivateIdentifier(storageRef), loc)), loc);
    }
    const getterProp = new Property(
      null,
      prop.key,
      new Expr(new EFunction(new Fn(null, [], new FnBody(new SBlock([new Stmt(new SReturn(getExpr), loc)]), loc))), loc),
      null,
      [],
      prop.loc,
      0,
      PropertyGetter,
      prop.flags,
    );
    if (!ctx.lowerMethod(p, getterProp, private_)) {
      properties.push(getterProp);
    }

    // Setter
    let setExpr;
    if (storageNeedsToBeLowered) {
      setExpr = p.lowerPrivateSet(new Expr(EThisShared, loc), loc, storagePrivate, new Expr(new EIdentifier(argRef), loc));
    } else {
      p.recordUsage(storageRef);
      p.recordUsage(argRef);
      setExpr = assign(
        new Expr(new EIndex(new Expr(EThisShared, loc), new Expr(new EPrivateIdentifier(storageRef), loc)), loc),
        new Expr(new EIdentifier(argRef), loc),
      );
    }
    const setterProp = new Property(
      null,
      cloneKeyForLowerClass(keyExprNoSideEffects),
      new Expr(
        new EFunction(
          new Fn(null, [new Arg(new Binding(new BIdentifier(argRef), loc))], new FnBody(new SBlock([new Stmt(new SExpr(setExpr), loc)]), loc)),
        ),
        loc,
      ),
      null,
      [],
      prop.loc,
      0,
      PropertySetter,
      prop.flags,
    );
    if (!ctx.lowerMethod(p, setterProp, private_)) {
      properties.push(setterProp);
    }
    return properties;
  },

  insertInitializersIntoConstructor(p, loweringInfo, result) {
    const ctx = this;
    if (ctx.parameterFieldProps.length > 0) {
      ctx.class.properties = ctx.parameterFieldProps.concat(ctx.class.properties);
    }

    if (
      ctx.parameterFields.length === 0 &&
      !ctx.decoratorCallInstanceMethodExtraInitializers &&
      ctx.instancePrivateMethods.length === 0 &&
      ctx.instanceMembers.length === 0 &&
      (ctx.ctor === null || result.superCtorRef === InvalidRef)
    ) {
      // No need to generate a constructor
      return;
    }

    // Create a constructor if one doesn't already exist
    if (ctx.ctor === null) {
      ctx.ctor = new EFunction(new Fn(null, [], new FnBody(new SBlock(), ctx.classLoc)));

      // Append it to the list to reuse existing allocation space
      ctx.class.properties.push(
        new Property(
          null,
          new Expr(new EString("constructor"), ctx.classLoc), // key
          new Expr(ctx.ctor, ctx.classLoc), // valueOrNil
          null,
          [],
          ctx.classLoc,
          0,
          PropertyMethod,
          0,
        ),
      );

      // Make sure the constructor has a super() call if needed
      if (ctx.class.extendsOrNil !== null) {
        let target = new Expr(ESuperShared, ctx.classLoc);
        if (loweringInfo.shimSuperCtorCalls) {
          p.recordUsage(result.superCtorRef);
          target = new Expr(new EIdentifier(result.superCtorRef), ctx.classLoc);
        }
        const argumentsRef = p.newSymbol(SymbolUnbound, "arguments");
        p.currentScope.generated.push(argumentsRef);
        ctx.ctor.fn.body.block.stmts.push(
          new Stmt(
            new SExpr(new Expr(new ECall(target, [new Expr(new ESpread(new Expr(new EIdentifier(argumentsRef), ctx.classLoc)), ctx.classLoc)]), ctx.classLoc)),
            ctx.classLoc,
          ),
        );
      }
    }

    // Run instanceMethodExtraInitializers if needed
    let decoratorInstanceMethodExtraInitializers = null;
    if (ctx.decoratorCallInstanceMethodExtraInitializers) {
      decoratorInstanceMethodExtraInitializers = p.callRuntime(ctx.classLoc, "__runInitializers", [
        new Expr(new EIdentifier(ctx.decoratorContextRef), ctx.classLoc),
        new Expr(new ENumber((2 << 1) | 1), ctx.classLoc),
        new Expr(EThisShared, ctx.classLoc),
      ]);
      p.recordUsage(ctx.decoratorContextRef);
    }

    // Make sure the instance field initializers come after "super()" since
    // they need "this" to ba available
    const generatedStmts = [];
    pushAll(generatedStmts, ctx.parameterFields);
    if (decoratorInstanceMethodExtraInitializers !== null) {
      generatedStmts.push(new Stmt(new SExpr(decoratorInstanceMethodExtraInitializers), decoratorInstanceMethodExtraInitializers.loc));
    }
    pushAll(generatedStmts, ctx.instancePrivateMethods);
    pushAll(generatedStmts, ctx.instanceMembers);
    p.insertStmtsAfterSuperCall(ctx.ctor.fn.body, generatedStmts, result.superCtorRef);

    // Sort the constructor first to match the TypeScript compiler's output
    const props = ctx.class.properties;
    for (let i = 0; i < props.length; i++) {
      if (props[i].valueOrNil !== null && props[i].valueOrNil.data === ctx.ctor) {
        const ctorProp = props[i];
        for (let j = i; j > 0; j--) {
          props[j] = props[j - 1];
        }
        props[0] = ctorProp;
        break;
      }
    }
  },

  // Returns [[]Stmt, Expr]
  finishAndGenerateCode(p, result) {
    const ctx = this;

    // When bundling is enabled, we convert top-level class statements to
    // expressions (see the long comment in the Go source). This is also done
    // when the module is wrapped in a try/catch for lowered "using"
    // declarations.
    const mustConvertStmtToExpr =
      ctx.kind !== classKindExpr && p.currentScope.parent === null && (p.options.mode === ModeBundle || p.willWrapModuleInTryCatchForUsing);

    // Check to see if we have lowered decorators on the class itself
    let classDecorators = null;
    let classExperimentalDecorators = [];
    if (p.options.ts.parse && p.options.ts.config.experimentalDecorators === True) {
      classExperimentalDecorators = ctx.class.decorators;
      ctx.class.decorators = [];
    } else if (ctx.class.shouldLowerStandardDecorators) {
      classDecorators = ctx.decoratorClassDecorators;
    }

    let decorateClassExpr = null;
    if (classDecorators !== null) {
      // Handle JavaScript decorators on the class itself
      if (ctx.decoratorContextRef === InvalidRef) {
        ctx.decoratorContextRef = p.generateTempRef(tempRefNeedsDeclare, "_init");
      }
      decorateClassExpr = p.callRuntime(ctx.classLoc, "__decorateElement", [
        new Expr(new EIdentifier(ctx.decoratorContextRef), ctx.classLoc),
        new Expr(new ENumber(0), ctx.classLoc),
        new Expr(new EString(ctx.nameToKeep), ctx.classLoc),
        classDecorators,
        ctx.nameFunc(),
      ]);
      p.recordUsage(ctx.decoratorContextRef);
      decorateClassExpr = assign(ctx.nameFunc(), decorateClassExpr);
    } else if (ctx.decoratorContextRef !== InvalidRef) {
      // Decorator metadata is present if there are any decorators on the class at all
      decorateClassExpr = p.callRuntime(ctx.classLoc, "__decoratorMetadata", [new Expr(new EIdentifier(ctx.decoratorContextRef), ctx.classLoc), ctx.nameFunc()]);
    }

    // If this is true, we have removed some code from the class body that could
    // potentially contain an expression that captures the inner class name.
    // In this case we must explicitly store the class to a separate inner class
    // name binding to avoid incorrect behavior if the class is later re-assigned,
    // since the removed code will no longer be in the class body scope.
    const hasPotentialInnerClassNameEscape =
      result.innerClassNameRef !== InvalidRef &&
      (ctx.computedPropertyChain !== null ||
        ctx.privateMembers.length > 0 ||
        ctx.staticPrivateMethods.length > 0 ||
        ctx.staticMembers.length > 0 ||
        // TypeScript experimental decorators
        ctx.instanceExperimentalDecorators.length > 0 ||
        ctx.staticExperimentalDecorators.length > 0 ||
        classExperimentalDecorators.length > 0 ||
        // JavaScript decorators
        ctx.decoratorContextRef !== InvalidRef);

    // If we need to represent the class as an expression (even if it's a
    // statement), then generate another symbol to use as the class name
    let nameForClassDecorators = new LocRef(0, InvalidRef);
    if (classExperimentalDecorators.length > 0 || hasPotentialInnerClassNameEscape || mustConvertStmtToExpr) {
      if (ctx.kind === classKindExpr) {
        // For expressions, the inner and outer class names are the same
        const name = ctx.nameFunc();
        nameForClassDecorators = new LocRef(name.loc, name.data.ref);
      } else {
        // For statements we need to use the outer class name, not the inner one
        if (ctx.class.name !== null) {
          nameForClassDecorators = new LocRef(ctx.class.name.loc, ctx.class.name.ref);
        } else if (ctx.kind === classKindExportDefaultStmt) {
          nameForClassDecorators = new LocRef(ctx.defaultName.loc, ctx.defaultName.ref);
        } else {
          nameForClassDecorators = new LocRef(ctx.classLoc, p.generateTempRef(tempRefNoDeclare, ""));
        }
        p.recordUsage(nameForClassDecorators.ref);
      }
    }

    const prefixExprs = [];
    const suffixExprs = [];

    // If there are JavaScript decorators, start by allocating a context object
    if (ctx.decoratorContextRef !== InvalidRef) {
      let base = new Expr(ENullShared, ctx.classLoc);
      if (ctx.class.extendsOrNil !== null) {
        if (ctx.extendsRef === InvalidRef) {
          ctx.extendsRef = p.generateTempRef(tempRefNeedsDeclare, "");
          ctx.class.extendsOrNil = assign(new Expr(new EIdentifier(ctx.extendsRef), ctx.class.extendsOrNil.loc), ctx.class.extendsOrNil);
          p.recordUsage(ctx.extendsRef);
        }
        base = new Expr(new EIdentifier(ctx.extendsRef), base.loc);
      }
      suffixExprs.push(assign(new Expr(new EIdentifier(ctx.decoratorContextRef), ctx.classLoc), p.callRuntime(ctx.classLoc, "__decoratorStart", [base])));
      p.recordUsage(ctx.decoratorContextRef);
    }

    // Any of the computed property chain that we hoisted out of the class
    // body needs to come before the class expression.
    if (ctx.computedPropertyChain !== null) {
      prefixExprs.push(ctx.computedPropertyChain);
    }

    // WeakSets and WeakMaps
    pushAll(suffixExprs, ctx.privateMembers);

    // Evaluate JavaScript decorators here
    pushAll(suffixExprs, ctx.decoratorStaticNonFieldElements);
    pushAll(suffixExprs, ctx.decoratorInstanceNonFieldElements);
    pushAll(suffixExprs, ctx.decoratorStaticFieldElements);
    pushAll(suffixExprs, ctx.decoratorInstanceFieldElements);

    // Lowered initializers for static methods (including getters and setters)
    pushAll(suffixExprs, ctx.staticPrivateMethods);

    // Run JavaScript class decorators at the end of class initialization
    if (decorateClassExpr !== null) {
      suffixExprs.push(decorateClassExpr);
    }

    // For each element initializer of staticMethodExtraInitializers
    if (ctx.decoratorCallStaticMethodExtraInitializers) {
      suffixExprs.push(
        p.callRuntime(ctx.classLoc, "__runInitializers", [
          new Expr(new EIdentifier(ctx.decoratorContextRef), ctx.classLoc),
          new Expr(new ENumber((1 << 1) | 1), ctx.classLoc),
          ctx.nameFunc(),
        ]),
      );
      p.recordUsage(ctx.decoratorContextRef);
    }

    // Lowered initializers for static fields, static accessors, and static blocks
    pushAll(suffixExprs, ctx.staticMembers);

    // The official TypeScript compiler adds generated code after the class body
    // in this exact order. Matching this order is important for correctness.
    pushAll(suffixExprs, ctx.instanceExperimentalDecorators);
    pushAll(suffixExprs, ctx.staticExperimentalDecorators);

    // For each element initializer of classExtraInitializers
    if (classDecorators !== null) {
      suffixExprs.push(
        p.callRuntime(ctx.classLoc, "__runInitializers", [
          new Expr(new EIdentifier(ctx.decoratorContextRef), ctx.classLoc),
          new Expr(new ENumber((0 << 1) | 1), ctx.classLoc),
          ctx.nameFunc(),
        ]),
      );
      p.recordUsage(ctx.decoratorContextRef);
    }

    // Run TypeScript experimental class decorators at the end of class initialization
    if (classExperimentalDecorators.length > 0) {
      const values = new Array(classExperimentalDecorators.length);
      for (let i = 0; i < classExperimentalDecorators.length; i++) {
        values[i] = classExperimentalDecorators[i].value;
      }
      suffixExprs.push(
        assign(
          new Expr(new EIdentifier(nameForClassDecorators.ref), nameForClassDecorators.loc),
          p.callRuntime(ctx.classLoc, "__decorateClass", [
            new Expr(new EArray(values), ctx.classLoc),
            new Expr(new EIdentifier(nameForClassDecorators.ref), nameForClassDecorators.loc),
          ]),
        ),
      );
      p.recordUsage(nameForClassDecorators.ref);
      p.recordUsage(nameForClassDecorators.ref);
    }

    // Our caller expects us to return the same form that was originally given to
    // us. If the class was originally an expression, then return an expression.
    if (ctx.kind === classKindExpr) {
      // Calling "nameFunc" will replace "classExpr", so make sure to do that first
      // before joining "classExpr" with any other expressions
      let nameToJoin = null;
      if (ctx.didCaptureClassExpr || suffixExprs.length > 0) {
        nameToJoin = ctx.nameFunc();
      }

      // Insert expressions on either side of the class as appropriate
      ctx.classExpr = joinWithComma(joinAllWithComma(prefixExprs), ctx.classExpr);
      ctx.classExpr = joinWithComma(ctx.classExpr, joinAllWithComma(suffixExprs));

      // Finally join "classExpr" with the variable that holds the class object
      ctx.classExpr = joinWithComma(ctx.classExpr, nameToJoin);
      if (ctx.wrapFunc !== null) {
        ctx.classExpr = ctx.wrapFunc(ctx.classExpr);
      }
      return [[], ctx.classExpr];
    }

    // Otherwise, the class was originally a statement. Return an array of
    // statements instead.
    const stmts = [];
    let outerClassNameDecl = null;

    // Insert expressions before the class as appropriate
    for (const expr of prefixExprs) {
      stmts.push(new Stmt(new SExpr(expr), expr.loc));
    }

    // Handle converting a class statement to a class expression
    if (nameForClassDecorators.ref !== InvalidRef) {
      const classExpr = new EClass(ctx.class.clone());
      ctx.class = classExpr.class;
      const init = new Expr(classExpr, ctx.classLoc);

      // If the inner class name was referenced, then set the name of the class
      // that we will end up printing to the inner class name. Otherwise if the
      // inner class name was unused, we can just leave it blank.
      if (result.innerClassNameRef !== InvalidRef) {
        // "class Foo { x = Foo }" => "const Foo = class _Foo { x = _Foo }"
        // (Go writes through the *LocRef; we replace it with a new LocRef so
        // that LocRef objects stay immutable)
        ctx.class.name = new LocRef(ctx.class.name.loc, result.innerClassNameRef);
      } else {
        // "class Foo {}" => "const Foo = class {}"
        ctx.class.name = null;
      }

      // Generate the class initialization statement
      if (classExperimentalDecorators.length > 0) {
        // If there are class decorators, then we actually need to mutate the
        // immutable "const" binding that shadows everything in the class body.
        // The official TypeScript compiler does this by rewriting all class name
        // references in the class body to another temporary variable. This is
        // basically what we're doing here.
        p.recordUsage(nameForClassDecorators.ref);
        stmts.push(
          new Stmt(
            new SLocal(
              [new Decl(new Binding(new BIdentifier(nameForClassDecorators.ref), nameForClassDecorators.loc), init)],
              p.selectLocalKind(LocalLet),
              ctx.kind === classKindExportStmt,
            ),
            ctx.classLoc,
          ),
        );
        if (ctx.class.name !== null) {
          p.mergeSymbols(ctx.class.name.ref, nameForClassDecorators.ref);
          ctx.class.name = null;
        }
      } else if (hasPotentialInnerClassNameEscape) {
        // If the inner class name was used, then we explicitly generate a binding
        // for it. That means the mutable outer class name is separate, and is
        // initialized after all static member initializers have finished.
        const captureRef = p.newSymbol(SymbolOther, p.symbols[refInner(result.innerClassNameRef)].originalName);
        p.currentScope.generated.push(captureRef);
        p.recordDeclaredSymbol(captureRef);
        p.mergeSymbols(result.innerClassNameRef, captureRef);
        let kind = LocalConst;
        if (classDecorators !== null) {
          // Class decorators need to be able to potentially mutate this binding
          kind = LocalLet;
        }
        stmts.push(
          new Stmt(new SLocal([new Decl(new Binding(new BIdentifier(captureRef), nameForClassDecorators.loc), init)], p.selectLocalKind(kind)), ctx.classLoc),
        );
        p.recordUsage(nameForClassDecorators.ref);
        p.recordUsage(captureRef);
        outerClassNameDecl = new Stmt(
          new SLocal(
            [new Decl(new Binding(new BIdentifier(nameForClassDecorators.ref), nameForClassDecorators.loc), new Expr(new EIdentifier(captureRef), ctx.classLoc))],
            p.selectLocalKind(LocalLet),
            ctx.kind === classKindExportStmt,
          ),
          ctx.classLoc,
        );
      } else {
        // Otherwise, the inner class name isn't needed and we can just
        // use a single variable declaration for the outer class name.
        p.recordUsage(nameForClassDecorators.ref);
        stmts.push(
          new Stmt(
            new SLocal(
              [new Decl(new Binding(new BIdentifier(nameForClassDecorators.ref), nameForClassDecorators.loc), init)],
              p.selectLocalKind(LocalLet),
              ctx.kind === classKindExportStmt,
            ),
            ctx.classLoc,
          ),
        );
      }
    } else {
      // Generate the specific kind of class statement that was passed in to us
      switch (ctx.kind) {
        case classKindStmt:
          stmts.push(new Stmt(new SClass(ctx.class.clone()), ctx.classLoc));
          break;
        case classKindExportStmt:
          stmts.push(new Stmt(new SClass(ctx.class.clone(), true), ctx.classLoc));
          break;
        case classKindExportDefaultStmt:
          stmts.push(new Stmt(new SExportDefault(new Stmt(new SClass(ctx.class.clone()), ctx.classLoc), ctx.defaultName), ctx.classLoc));
          break;
      }

      // The inner class name inside the class statement should be the same as
      // the class statement name itself
      if (ctx.class.name !== null && result.innerClassNameRef !== InvalidRef) {
        // If the class body contains a direct eval call, then the inner class
        // name will be marked as "MustNotBeRenamed" (because we have already
        // popped the class body scope) but the outer class name won't be marked
        // as "MustNotBeRenamed" yet (because we haven't yet popped the containing
        // scope). Propagate this flag now before we merge these symbols so we
        // don't end up accidentally renaming the outer class name to the inner
        // class name.
        if (p.currentScope.containsDirectEval) {
          p.symbols[refInner(ctx.class.name.ref)].flags |= p.symbols[refInner(result.innerClassNameRef)].flags & MustNotBeRenamed;
        }
        p.mergeSymbols(result.innerClassNameRef, ctx.class.name.ref);
      }
    }

    // Insert expressions after the class as appropriate
    for (const expr of suffixExprs) {
      stmts.push(new Stmt(new SExpr(expr), expr.loc));
    }

    // This must come after the class body initializers have finished
    if (outerClassNameDecl !== null) {
      stmts.push(outerClassNameDecl);
    }

    if (nameForClassDecorators.ref !== InvalidRef && ctx.kind === classKindExportDefaultStmt) {
      // "export default class x {}" => "class x {} export {x as default}"
      stmts.push(new Stmt(new SExportClause([new ClauseItem("default", "", 0, ctx.defaultName)]), ctx.classLoc));
    }
    return [stmts, null];
  },
});
