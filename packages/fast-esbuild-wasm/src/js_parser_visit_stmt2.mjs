// Port of internal/js_parser/js_parser.go lines 10393-13276: visitAndAppendStmt
// (every statement kind), minifySwitchStmt, visitClass, visitArgs, define
// instantiation, equality/typeof warnings and maybeRewritePropertyAccess.
//
// Fast-path notes (CONVENTIONS.md section 5):
// - Branches guarded by minifySyntax / keepNames / mangleProps are dropped and
//   marked "(minify only)" / "(keepNames only)" / "(mangleProps only)".
// - Lowering branches guarded by p.options.unsupportedJSFeatures.Has(...) are
//   dropped and marked "(lowering only)". The object-rest lowering helpers
//   (lowerObjectRestInDecls / InForLoopInit / InCatchBinding) return
//   immediately when ObjectRestSpread is supported, so their calls are dropped.
// - Bundle-only branches (ModeBundle) are dropped where noted "(bundle only)".
import { bail } from "./bail.mjs";
import {
  mkRange,
  RANGE_ZERO,
  Warning,
  Debug,
  MsgID_JS_ImpossibleTypeof,
  MsgID_JS_EqualsNegativeZero,
  MsgID_JS_EqualsNaN,
  MsgID_JS_EqualsNewObject,
} from "./logger.mjs";
import { stringArraysEqual } from "./helpers.mjs";
import {
  InvalidRef,
  LocRef,
  refInner,
  SymbolUnbound,
  SymbolOther,
  SymbolLabel,
  SymbolConst,
  SymbolClassInComputedPropertyKey,
  PrivateSymbolMustBeLowered,
  RemoveOverwrittenFunctionDeclaration,
  symbolKindIsUnboundOrInjected,
} from "./ast.mjs";
import {
  Expr,
  Stmt,
  Binding,
  Arg,
  FnBody,
  Decl,
  Decorator,
  ClauseItem,
  Case,
  ScopeMember,
  TSNamespaceMember,
  TSNamespaceMemberEnumNumber,
  TSNamespaceMemberEnumString,
  TSEnumValue,
  BIdentifier,
  EArrow,
  EBigInt,
  EBinary,
  EBoolean,
  ECall,
  EDot,
  EIdentifier,
  EImportMeta,
  EIndex,
  ENumber,
  EPrivateIdentifier,
  EString,
  EUnary,
  ENullShared,
  EThisShared,
  EUndefinedShared,
  SBlock,
  SExportClause,
  SExpr,
  SIf,
  SLabel,
  SLocal,
  SReturn,
  AssignTargetNone,
  BinOpStrictEq,
  UnOpTypeof,
  UnOpVoid,
  OptionalChainNone,
  LocalVar,
  LocalUsing,
  LocalAwaitUsing,
  ScopeBlock,
  ScopeWith,
  ScopeLabel,
  ScopeClassName,
  ScopeClassBody,
  ScopeCatchBinding,
  ScopeEntry,
  ScopeFunctionArgs,
  ScopeFunctionBody,
  ScopeClassStaticInit,
  ImplicitStrictModeClass,
  PropertyClassStaticBlock,
  PropertyIsComputed,
  PropertyIsStatic,
  propertyKindIsMethodDefinition,
  scopeKindStopsHoisting,
  B_IDENTIFIER,
  E_ARRAY,
  E_ARROW,
  E_BIG_INT,
  E_BOOLEAN,
  E_CLASS,
  E_DOT,
  E_FUNCTION,
  E_IDENTIFIER,
  E_IF,
  E_IMPORT_META,
  E_INDEX,
  E_INLINED_ENUM,
  E_MISSING,
  E_NULL,
  E_NUMBER,
  E_OBJECT,
  E_PRIVATE_IDENTIFIER,
  E_REG_EXP,
  E_STRING,
  E_THIS,
  E_BINARY,
  E_UNARY,
  E_UNDEFINED,
  S_BLOCK,
  S_BREAK,
  S_CLASS,
  S_COMMENT,
  S_CONTINUE,
  S_DEBUGGER,
  S_DIRECTIVE,
  S_DO_WHILE,
  S_EMPTY,
  S_ENUM,
  S_EXPORT_CLAUSE,
  S_EXPORT_DEFAULT,
  S_EXPORT_EQUALS,
  S_EXPORT_FROM,
  S_EXPORT_STAR,
  S_EXPR,
  S_FOR,
  S_FOR_IN,
  S_FOR_OF,
  S_FUNCTION,
  S_IF,
  S_IMPORT,
  S_LABEL,
  S_LOCAL,
  S_NAMESPACE,
  S_RETURN,
  S_SWITCH,
  S_THROW,
  S_TRY,
  S_TYPESCRIPT,
  S_WHILE,
  S_WITH,
  TS_NAMESPACE_MEMBER_ENUM_NUMBER,
  TS_NAMESPACE_MEMBER_ENUM_STRING,
  TS_NAMESPACE_MEMBER_NAMESPACE,
} from "./js_ast.mjs";
import { ModeBundle, formatKeepESMImportExportSyntax } from "./config.mjs";
import {
  bindingOpts,
  visitFnOpts,
  visitClassResult,
  exprIn,
  identifierOpts,
  prependTempRefsOpts,
  fnOrArrowDataVisit,
  fnOnlyDataVisit,
  stmtsNormal,
  stmtsLoopBody,
  stmtsFnBody,
  relocateVarsNormal,
  relocateVarsForInOrForOf,
  valueDefinitelyNotMutated,
  tempRefNoDeclare,
  tempRefNeedsDeclare,
  onlyCheckOriginalOrder,
  checkBothOrders,
  alwaysDead,
  objRestReturnValueIsUnused,
  duplicatePropertiesInClass,
  withStatement,
  forInVarInit,
  reservedWord,
  legacyOctalEscape,
  labelFunctionStmt,
} from "./js_parser_types.mjs";
import {
  assign,
  assignStmt,
  convertBindingToExpr,
  joinWithComma,
  toBooleanWithSideEffects,
  knownPrimitiveType,
  PrimitiveString,
  isPrimitiveLiteral,
  checkEqualityIfNoSideEffects,
  StrictEquality,
  forEachIdentifierBindingInDecls,
  ReturnCanBeRemovedIfUnused,
} from "./js_ast_helpers.mjs";
import { isIdentifier } from "./js_ident.mjs";
import { rangeOfIdentifier, StrictModeReservedWords } from "./js_lexer.mjs";
import { analyzeSwitchCasesForLiveness, caseBodyCouldHaveFallThrough, stmtsToSingleStmt } from "./js_parser_visit_stmt.mjs";

// p.markSyntaxFeature(compat.TopLevelAwait, r) specialised for the fast path
// (UnsupportedJSFeatures == 0): the only possible effect is the error about
// top-level await with a non-ESM output format.
function markTopLevelAwaitSyntaxFeature(p, r) {
  if (!formatKeepESMImportExportSyntax(p.options.outputFormat)) {
    // "Top-level await is currently not supported with the %q output format"
    p.log.addError();
  }
  return false;
}

// Go: "member := exportedMembers[name]" copies the struct (zero value if the
// key is missing). Modifying the copy must not affect other holders.
function copyTSNamespaceMember(member) {
  if (member === undefined) return new TSNamespaceMember();
  return new TSNamespaceMember(member.data, member.loc, member.isEnumValue);
}

export const visitStmt2Methods = {
  visitAndAppendStmt(stmts, stmt) {
    const p = this;
    if (stmts === null) stmts = [];

    // By default any statement ends the const local prefix
    const wasAfterAfterConstLocalPrefix = p.currentScope.isAfterConstLocalPrefix;
    p.currentScope.isAfterConstLocalPrefix = true;

    const s = stmt.data;
    switch (s.k) {
      case S_EMPTY:
      case S_COMMENT:
        // Comments do not end the const local prefix
        p.currentScope.isAfterConstLocalPrefix = wasAfterAfterConstLocalPrefix;
        break;

      case S_DEBUGGER:
        // Debugger statements do not end the const local prefix
        p.currentScope.isAfterConstLocalPrefix = wasAfterAfterConstLocalPrefix;

        if (p.options.dropDebugger) {
          return stmts;
        }
        break;

      case S_TYPESCRIPT:
        // Type annotations do not end the const local prefix
        p.currentScope.isAfterConstLocalPrefix = wasAfterAfterConstLocalPrefix;

        // Erase TypeScript constructs from the output completely
        return stmts;

      case S_DIRECTIVE:
        // Directives do not end the const local prefix
        p.currentScope.isAfterConstLocalPrefix = wasAfterAfterConstLocalPrefix;

        if (p.isStrictMode() && s.legacyOctalLoc > 0) {
          p.markStrictModeFeature(legacyOctalEscape, p.source.rangeOfLegacyOctalEscape(s.legacyOctalLoc), "");
        }
        break;

      case S_IMPORT:
        p.recordDeclaredSymbol(s.namespaceRef);

        if (s.defaultName !== null) {
          p.recordDeclaredSymbol(s.defaultName.ref);
        }

        if (s.items !== null) {
          for (let $i58 = 0, $a58 = s.items; $i58 < $a58.length; $i58++) {
            const item = $a58[$i58];
            p.recordDeclaredSymbol(item.name.ref);
          }
        }
        break;

      case S_EXPORT_CLAUSE: {
        // "export {foo}"
        const items = s.items;
        let end = 0;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const name = p.loadNameFromRef(item.name.ref);
          const ref = p.findSymbol(item.aliasLoc, name).ref;

          if (p.symbols[refInner(ref)].kind === SymbolUnbound) {
            // Silently strip exports of non-local symbols in TypeScript, since
            // those likely correspond to type-only exports. But report exports of
            // non-local symbols as errors in JavaScript.
            if (!p.options.ts.parse) {
              // "%q is not declared in this file"
              p.log.addError();
            }
            continue;
          }

          item.name = new LocRef(item.name.loc, ref);
          items[end] = item;
          end++;
        }

        // Note: do not remove empty export statements since TypeScript uses them as module markers
        items.length = end;
        break;
      }

      case S_EXPORT_FROM: {
        // "export {foo} from 'path'"
        const name = p.loadNameFromRef(s.namespaceRef);
        s.namespaceRef = p.newSymbol(SymbolOther, name);
        p.currentScope.generated.push(s.namespaceRef);
        p.recordDeclaredSymbol(s.namespaceRef);

        // This is a re-export and the symbols created here are used to reference
        // names in another file. This means the symbols are really aliases.
        const items = s.items;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const itemName = p.loadNameFromRef(item.name.ref);
          const ref = p.newSymbol(SymbolOther, itemName);
          p.currentScope.generated.push(ref);
          p.recordDeclaredSymbol(ref);
          item.name = new LocRef(item.name.loc, ref);
        }
        break;
      }

      case S_EXPORT_STAR: {
        // "export * from 'path'"
        // "export * as ns from 'path'"
        const name = p.loadNameFromRef(s.namespaceRef);
        s.namespaceRef = p.newSymbol(SymbolOther, name);
        p.currentScope.generated.push(s.namespaceRef);
        p.recordDeclaredSymbol(s.namespaceRef);

        // "export * as ns from 'path'" -> "import * as ns" + "export {ns}"
        // (lowering only: compat.ExportStarAs is always supported)
        break;
      }

      case S_EXPORT_DEFAULT: {
        p.recordDeclaredSymbol(s.defaultName.ref);

        const s2 = s.value.data;
        switch (s2.k) {
          case S_EXPR: {
            // Propagate the name to keep from the export into the value
            p.nameToKeep = "default";
            p.nameToKeepIsFor = s2.value.data;

            s2.value = p.visitExpr(s2.value);

            // Discard type-only export default statements
            if (p.options.ts.parse) {
              const id = s2.value.data;
              if (id.k === E_IDENTIFIER) {
                const symbol = p.symbols[refInner(id.ref)];
                if (symbol.kind === SymbolUnbound && p.localTypeNames.has(symbol.originalName)) {
                  return stmts;
                }
              }
            }

            // If there are lowered "using" declarations, change this into a "var"
            if (p.currentScope.parent === null && p.willWrapModuleInTryCatchForUsing) {
              stmts.push(
                new Stmt(
                  new SLocal([new Decl(new Binding(new BIdentifier(s.defaultName.ref), s.defaultName.loc), s2.value)]),
                  stmt.loc,
                ),
                new Stmt(new SExportClause([new ClauseItem("default", "", s.defaultName.loc, s.defaultName)]), stmt.loc),
              );
              break;
            }

            stmts.push(stmt);
            break;
          }

          case S_FUNCTION:
            // (keepNames only) generate a name if there is none

            p.visitFn(s2.fn, s2.fn.openParenLoc, new visitFnOpts());
            stmts.push(stmt);

            // (keepNames only) optionally preserve the name
            break;

          case S_CLASS: {
            const result = p.visitClass(s.value.loc, s2.class, s.defaultName.ref, "default");

            // Lower class field syntax for browsers that don't support it
            const $d194 = p.lowerClass(stmt, null, result, "");
            const classStmts = $d194[0];

            // Remember if the class was side-effect free before lowering
            if (result.canBeRemovedIfUnused) {
              for (const classStmt of classStmts) {
                const s3 = classStmt.data;
                if (s3.k === S_EXPR) {
                  s3.isFromClassOrFnThatCanBeRemovedIfUnused = true;
                }
              }
            }

            for (const classStmt of classStmts) stmts.push(classStmt);
            break;
          }

          default:
            bail(); // panic("Internal error")
        }

        // Use a more friendly name than "default" now that "--keep-names" has
        // been applied and has made sure to enforce the name "default"
        const defaultSymbol = p.symbols[refInner(s.defaultName.ref)];
        if (defaultSymbol.originalName === "default") {
          defaultSymbol.originalName = p.source.identifierName + "_default";
        }

        return stmts;
      }

      case S_EXPORT_EQUALS:
        // "module.exports = value"
        stmts.push(
          assignStmt(
            new Expr(new EDot(new Expr(new EIdentifier(p.moduleRef), stmt.loc), "exports", stmt.loc), stmt.loc),
            p.visitExpr(s.value),
          ),
        );
        p.recordUsage(p.moduleRef);
        return stmts;

      case S_BREAK:
        if (s.label !== null) {
          const name = p.loadNameFromRef(s.label.ref);
          const $d195 = p.findLabelSymbol(s.label.loc, name);
          const ref = $d195[0];
          s.label = new LocRef(s.label.loc, ref);
        } else if (!p.fnOrArrowDataVisit.isInsideLoop && !p.fnOrArrowDataVisit.isInsideSwitch) {
          // "Cannot use \"break\" here:"
          p.log.addError();
        }
        break;

      case S_CONTINUE:
        if (s.label !== null) {
          const name = p.loadNameFromRef(s.label.ref);
          const $d196 = p.findLabelSymbol(s.label.loc, name);
          const ref = $d196[0], isLoop = $d196[1], ok = $d196[2];
          s.label = new LocRef(s.label.loc, ref);
          if (ok && !isLoop) {
            // "Cannot continue to label \"%s\""
            p.log.addError();
          }
        } else if (!p.fnOrArrowDataVisit.isInsideLoop) {
          // "Cannot use \"continue\" here:"
          p.log.addError();
        }
        break;

      case S_LABEL: {
        // Forbid functions inside labels in strict mode
        if (p.isStrictMode()) {
          if (s.stmt.data.k === S_FUNCTION) {
            p.markStrictModeFeature(labelFunctionStmt, rangeOfIdentifier(p.source, s.stmt.loc), "");
          }
        }

        p.pushScopeForVisitPass(ScopeLabel, stmt.loc);
        const name = p.loadNameFromRef(s.name.ref);
        if (StrictModeReservedWords.has(name)) {
          p.markStrictModeFeature(reservedWord, rangeOfIdentifier(p.source, s.name.loc), name);
        }
        const ref = p.newSymbol(SymbolLabel, name);
        s.name = new LocRef(s.name.loc, ref);

        // Duplicate labels are an error
        for (let scope = p.currentScope.parent; scope !== null; scope = scope.parent) {
          if (scope.label.ref !== InvalidRef && name === p.symbols[refInner(scope.label.ref)].originalName) {
            // "Duplicate label %q"
            p.log.addErrorWithNotes();
            break;
          }
          if (scope.kind === ScopeFunctionBody) {
            // Labels are only visible within the function they are defined in.
            break;
          }
        }

        p.currentScope.label = new LocRef(s.name.loc, ref);
        switch (s.stmt.data.k) {
          case S_FOR:
          case S_FOR_IN:
          case S_FOR_OF:
          case S_WHILE:
          case S_DO_WHILE:
            p.currentScope.labelStmtIsLoop = true;
            break;
        }

        // If we're dropping this statement, consider control flow to be dead
        const shouldDropLabel = p.dropLabelsMap !== null && p.dropLabelsMap.has(name);
        const old = p.isControlFlowDead;
        if (shouldDropLabel) {
          p.isControlFlowDead = true;
        }

        s.stmt = p.visitSingleStmt(s.stmt, stmtsNormal);
        p.popScope();

        // Drop this entire statement if requested
        if (shouldDropLabel) {
          p.isControlFlowDead = old;
          return stmts;
        }

        // (minify only) "x: break x" and unused label removal

        // Handle "for await" that has been lowered by moving this label inside the "try"
        const try_ = s.stmt.data;
        if (try_.k === S_TRY && try_.block.stmts.length === 1) {
          const loop = try_.block.stmts[0].data;
          if (loop.k === S_FOR && loop.isLoweredForAwait) {
            try_.block.stmts[0] = new Stmt(new SLabel(try_.block.stmts[0], s.name, s.isSingleLineStmt), stmt.loc);
            stmts.push(s.stmt);
            return stmts;
          }
        }
        break;
      }

      case S_LOCAL: {
        // Silently remove unsupported top-level "await" in dead code branches
        if (s.kind === LocalAwaitUsing && p.fnOrArrowDataVisit.isOutsideFnOrArrow) {
          // (compat.TopLevelAwait is always supported in the fast path)
          if (p.isControlFlowDead && !formatKeepESMImportExportSyntax(p.options.outputFormat)) {
            s.kind = LocalUsing;
          } else {
            p.liveTopLevelAwaitKeyword = mkRange(stmt.loc, 5);
            markTopLevelAwaitSyntaxFeature(p, mkRange(stmt.loc, 5));
          }
        }

        // Local statements do not end the const local prefix
        p.currentScope.isAfterConstLocalPrefix = wasAfterAfterConstLocalPrefix;

        const decls = s.decls;
        for (let i = 0; i < decls.length; i++) {
          const d = decls[i];
          p.visitBinding(d.binding, new bindingOpts());

          // Visit the initializer
          if (d.valueOrNil !== null) {
            // Fold numeric constants in the initializer
            const oldShouldFoldTypeScriptConstantExpressions = p.shouldFoldTypeScriptConstantExpressions;
            p.shouldFoldTypeScriptConstantExpressions = p.options.minifySyntax && !p.currentScope.isAfterConstLocalPrefix;

            // Propagate the name to keep from the binding into the initializer
            const id = d.binding.data;
            if (id.k === B_IDENTIFIER) {
              p.nameToKeep = p.symbols[refInner(id.ref)].originalName;
              p.nameToKeepIsFor = d.valueOrNil.data;
            }

            d.valueOrNil = p.visitExpr(d.valueOrNil);

            p.shouldFoldTypeScriptConstantExpressions = oldShouldFoldTypeScriptConstantExpressions;

            // (minify only) "let a = undefined;" => "let a;"

            // (Yarn PnP only) decodeHydrateRuntimeStateYarnPnP string locals
          }

          // (minify only) attempt to continue the const local prefix
        }

        // Handle being exported inside a namespace
        if (s.isExport && p.enclosingNamespaceArgRef !== null) {
          const wrapIdentifier = (loc, ref) => {
            p.recordUsage(p.enclosingNamespaceArgRef);
            return new Expr(
              p.dotOrMangledPropVisit(
                new Expr(new EIdentifier(p.enclosingNamespaceArgRef), loc),
                p.symbols[refInner(ref)].originalName,
                loc,
              ),
              loc,
            );
          };
          for (const decl of decls) {
            if (decl.valueOrNil !== null) {
              let target = convertBindingToExpr(decl.binding, wrapIdentifier);
              const $d197 = p.lowerAssign(target, decl.valueOrNil, objRestReturnValueIsUnused);
              const result = $d197[0], ok = $d197[1];
              if (ok) {
                target = result;
              } else {
                target = assign(target, decl.valueOrNil);
              }
              stmts.push(new Stmt(new SExpr(target), stmt.loc));
            }
          }
          return stmts;
        }

        // (lowering only) s.decls = p.lowerObjectRestInDecls(s.decls) is a no-op

        // (minify only) "using" initialized to null/undefined => "const"

        s.kind = p.selectLocalKind(s.kind);

        // Potentially relocate "var" declarations to the top level
        if (s.kind === LocalVar) {
          const $d198 = p.maybeRelocateVarsToTopLevel(s.decls, relocateVarsNormal);
          const assign_ = $d198[0], ok = $d198[1];
          if (ok) {
            if (assign_ !== null) {
              stmts.push(assign_);
            }
            return stmts;
          }
        }
        break;
      }

      case S_EXPR: {
        const shouldTrimUnsightlyPrimitives = !p.options.minifySyntax && !isUnsightlyPrimitive(s.value.data);
        p.stmtExprValue = s.value.data;
        s.value = p.visitExpr(s.value);

        // Expressions that have been simplified down to a single primitive don't
        // have any effect, and are automatically removed during minification.
        // However, some people are really bothered by seeing them. Remove them
        // so we don't bother these people.
        if (shouldTrimUnsightlyPrimitives && isUnsightlyPrimitive(s.value.data)) {
          return stmts;
        }
        break;
      }

      case S_THROW:
        s.value = p.visitExpr(s.value);
        break;

      case S_RETURN:
        // Forbid top-level return inside modules with ECMAScript syntax
        if (p.fnOrArrowDataVisit.isOutsideFnOrArrow) {
          if (p.isFileConsideredESM) {
            // "Top-level return cannot be used inside an ECMAScript module"
            p.log.addErrorWithNotes();
          } else {
            p.hasTopLevelReturn = true;
          }
        }

        if (s.valueOrNil !== null) {
          s.valueOrNil = p.visitExpr(s.valueOrNil);

          // (minify only) "return undefined" => "return"
        }
        break;

      case S_BLOCK:
        p.pushScopeForVisitPass(ScopeBlock, stmt.loc);

        // Pass the "is loop body" status on to the direct children of a block used
        // as a loop body. This is used to enable optimizations specific to the
        // topmost scope in a loop body block.
        if (p.loopBody === s) {
          s.stmts = p.visitStmts(s.stmts, stmtsLoopBody);
        } else {
          s.stmts = p.visitStmts(s.stmts, stmtsNormal);
        }

        p.popScope();

        // (minify only) unwrap single-statement blocks / trim empty blocks
        break;

      case S_WITH:
        p.markStrictModeFeature(withStatement, rangeOfIdentifier(p.source, stmt.loc), "");
        s.value = p.visitExpr(s.value);
        p.pushScopeForVisitPass(ScopeWith, s.bodyLoc);
        s.body = p.visitSingleStmt(s.body, stmtsNormal);
        p.popScope();
        break;

      case S_WHILE:
        s.test = p.visitExpr(s.test);
        s.body = p.visitLoopBody(s.body);

        // (minify only) "while (a) {}" => "for (;a;) {}"
        break;

      case S_DO_WHILE:
        s.body = p.visitLoopBody(s.body);
        s.test = p.visitExpr(s.test);

        // (minify only) simplify the test
        break;

      case S_IF: {
        s.test = p.visitExpr(s.test);

        // (minify only) simplify the test

        // Fold constants
        const $d199 = toBooleanWithSideEffects(s.test.data);
        const bool = $d199[0], ok = $d199[2];

        // Mark the control flow as dead if the branch is never taken
        if (ok && !bool) {
          const old = p.isControlFlowDead;
          p.isControlFlowDead = true;
          s.yes = p.visitSingleStmt(s.yes, stmtsNormal);
          p.isControlFlowDead = old;
        } else {
          s.yes = p.visitSingleStmt(s.yes, stmtsNormal);
        }

        // The "else" clause is optional
        if (s.noOrNil !== null) {
          // Mark the control flow as dead if the branch is never taken
          if (ok && bool) {
            const old = p.isControlFlowDead;
            p.isControlFlowDead = true;
            s.noOrNil = p.visitSingleStmt(s.noOrNil, stmtsNormal);
            p.isControlFlowDead = old;
          } else {
            s.noOrNil = p.visitSingleStmt(s.noOrNil, stmtsNormal);
          }

          // (minify only) trim unnecessary "else" clauses
        }

        // (minify only) return p.mangleIf(stmts, stmt.loc, s)
        break;
      }

      case S_FOR: {
        p.pushScopeForVisitPass(ScopeBlock, stmt.loc);
        if (s.initOrNil !== null) {
          p.visitForLoopInit(s.initOrNil, false);
        }

        if (s.testOrNil !== null) {
          s.testOrNil = p.visitExpr(s.testOrNil);

          // (minify only) simplify the test / drop an always-true test
        }

        if (s.updateOrNil !== null) {
          s.updateOrNil = p.visitExpr(s.updateOrNil);
        }
        s.body = p.visitLoopBody(s.body);

        // Potentially relocate "var" declarations to the top level. Note that this
        // must be done inside the scope of the for loop or they won't be relocated.
        if (s.initOrNil !== null) {
          const init = s.initOrNil.data;
          if (init.k === S_LOCAL && init.kind === LocalVar) {
            const $d200 = p.maybeRelocateVarsToTopLevel(init.decls, relocateVarsNormal);
            const assign_ = $d200[0], ok = $d200[1];
            if (ok) {
              if (assign_ !== null) {
                s.initOrNil = assign_;
              } else {
                s.initOrNil = null;
              }
            }
          }
        }

        p.popScope();

        // (minify only) mangleFor(s)
        break;
      }

      case S_FOR_IN: {
        p.pushScopeForVisitPass(ScopeBlock, stmt.loc);
        p.visitForLoopInit(s.init, true);
        s.value = p.visitExpr(s.value);
        s.body = p.visitLoopBody(s.body);

        // Check for a variable initializer
        const local = s.init.data;
        if (local.k === S_LOCAL && local.kind === LocalVar && local.decls.length === 1) {
          const decl = local.decls[0];
          const id = decl.binding.data;
          if (id.k === B_IDENTIFIER && decl.valueOrNil !== null) {
            p.markStrictModeFeature(forInVarInit, p.source.rangeOfOperatorBefore(decl.valueOrNil.loc, "="), "");

            // Lower for-in variable initializers in case the output is used in strict mode
            stmts.push(
              new Stmt(new SExpr(assign(new Expr(new EIdentifier(id.ref), decl.binding.loc), decl.valueOrNil)), stmt.loc),
            );
            decl.valueOrNil = null;
          }
        }

        // Potentially relocate "var" declarations to the top level. Note that this
        // must be done inside the scope of the for loop or they won't be relocated.
        const init = s.init.data;
        if (init.k === S_LOCAL && init.kind === LocalVar) {
          const $d201 = p.maybeRelocateVarsToTopLevel(init.decls, relocateVarsForInOrForOf);
          const replacement = $d201[0], ok = $d201[1];
          if (ok) {
            s.init = replacement;
          }
        }

        p.popScope();

        // (lowering only) p.lowerObjectRestInForLoopInit(s.init, &s.body) is a no-op
        break;
      }

      case S_FOR_OF: {
        // Silently remove unsupported top-level "await" in dead code branches
        if (s.await.len > 0 && p.fnOrArrowDataVisit.isOutsideFnOrArrow) {
          // (compat.TopLevelAwait is always supported in the fast path)
          if (p.isControlFlowDead && !formatKeepESMImportExportSyntax(p.options.outputFormat)) {
            s.await = RANGE_ZERO;
          } else {
            p.liveTopLevelAwaitKeyword = s.await;
            markTopLevelAwaitSyntaxFeature(p, s.await);
          }
        }

        p.pushScopeForVisitPass(ScopeBlock, stmt.loc);
        p.visitForLoopInit(s.init, true);
        s.value = p.visitExpr(s.value);
        s.body = p.visitLoopBody(s.body);

        // Potentially relocate "var" declarations to the top level. Note that this
        // must be done inside the scope of the for loop or they won't be relocated.
        const init = s.init.data;
        if (init.k === S_LOCAL && init.kind === LocalVar) {
          const $d202 = p.maybeRelocateVarsToTopLevel(init.decls, relocateVarsForInOrForOf);
          const replacement = $d202[0], ok = $d202[1];
          if (ok) {
            s.init = replacement;
          }
        }

        // Handle "for (using x of y)" and "for (await using x of y)"
        const local = s.init.data;
        if (local.k === S_LOCAL) {
          // (lowering only) "using" with compat.Using unsupported
          if (local.kind === LocalAwaitUsing) {
            if (p.fnOrArrowDataVisit.isOutsideFnOrArrow) {
              if (p.isControlFlowDead && !formatKeepESMImportExportSyntax(p.options.outputFormat)) {
                // Silently remove unsupported top-level "await" in dead code branches
                local.kind = LocalUsing;
              } else {
                p.liveTopLevelAwaitKeyword = mkRange(s.init.loc, 5);
                markTopLevelAwaitSyntaxFeature(p, p.liveTopLevelAwaitKeyword);
              }
              // (lowering only) p.lowerUsingDeclarationInForOf(...)
            }
            // (lowering only) Using / AsyncAwait / AsyncGenerator lowering
          }
        }

        p.popScope();

        // (lowering only) p.lowerObjectRestInForLoopInit(s.init, &s.body) is a no-op

        // (lowering only) "for await" lowering via p.lowerForAwaitLoop
        break;
      }

      case S_TRY:
        p.pushScopeForVisitPass(ScopeBlock, stmt.loc);
        if (p.fnOrArrowDataVisit.tryBodyCount === 0) {
          if (s.catch !== null) {
            p.fnOrArrowDataVisit.tryCatchLoc = s.catch.loc;
          } else {
            p.fnOrArrowDataVisit.tryCatchLoc = stmt.loc;
          }
        }
        p.fnOrArrowDataVisit.tryBodyCount++;
        s.block.stmts = p.visitStmts(s.block.stmts, stmtsNormal);
        p.fnOrArrowDataVisit.tryBodyCount--;
        p.popScope();

        if (s.catch !== null) {
          const old = p.isControlFlowDead;

          // If the try body is empty, then the catch body is dead
          if (s.block.stmts.length === 0) {
            p.isControlFlowDead = true;
          }

          p.pushScopeForVisitPass(ScopeCatchBinding, s.catch.loc);
          if (s.catch.bindingOrNil !== null) {
            p.visitBinding(s.catch.bindingOrNil, new bindingOpts());
          }

          p.pushScopeForVisitPass(ScopeBlock, s.catch.blockLoc);
          s.catch.block.stmts = p.visitStmts(s.catch.block.stmts, stmtsNormal);
          p.popScope();

          // (lowering only) p.lowerObjectRestInCatchBinding(s.catch) is a no-op
          p.popScope();

          p.isControlFlowDead = old;
        }

        if (s.finally !== null) {
          p.pushScopeForVisitPass(ScopeBlock, s.finally.loc);
          s.finally.block.stmts = p.visitStmts(s.finally.block.stmts, stmtsNormal);
          p.popScope();
        }

        // (minify only) drop/unwrap empty try, catch and finally blocks
        break;

      case S_SWITCH: {
        s.test = p.visitExpr(s.test);
        p.pushScopeForVisitPass(ScopeBlock, s.bodyLoc);
        const oldIsInsideSwitch = p.fnOrArrowDataVisit.isInsideSwitch;
        p.fnOrArrowDataVisit.isInsideSwitch = true;

        // Disable const inlining in switch cases. They all share the same scope
        // and can be evaluated in an unusual order.
        p.currentScope.isAfterConstLocalPrefix = true;

        // Visit case values first
        for (let i = 0; i < s.cases.length; i++) {
          const c = s.cases[i];
          if (c.valueOrNil !== null) {
            c.valueOrNil = p.visitExpr(c.valueOrNil);
            p.warnAboutEqualityCheck("case", c.valueOrNil, c.valueOrNil.loc);
            p.warnAboutTypeofAndString(s.test, c.valueOrNil, onlyCheckOriginalOrder);
          }
        }

        // Check for duplicate case values
        p.duplicateCaseChecker.reset();
        for (let $i59 = 0, $a59 = s.cases; $i59 < $a59.length; $i59++) {
          const c = $a59[$i59];
          if (c.valueOrNil !== null) {
            p.duplicateCaseChecker.check(p, c.valueOrNil);
          }
        }

        // Then analyze the cases to determine which ones are live and/or dead
        const cases = analyzeSwitchCasesForLiveness(s);

        // Then visit case bodies, and potentially filter out dead cases
        let end = 0;
        for (let i = 0; i < s.cases.length; i++) {
          const c = s.cases[i];
          const isAlwaysDead = cases[i].status === alwaysDead;

          // Potentially treat the case body as dead code
          const old = p.isControlFlowDead;
          if (isAlwaysDead) {
            p.isControlFlowDead = true;
          }
          c.body = p.visitStmts(c.body, stmtsNormal);
          p.isControlFlowDead = old;

          // (minify only) filter out this case if it's known to be dead and empty

          // Make sure the assignment to the body above is preserved
          s.cases[end] = c;
          end++;
        }
        s.cases.length = end;

        p.fnOrArrowDataVisit.isInsideSwitch = oldIsInsideSwitch;
        p.popScope();

        // (minify only) unwrap switch statements in dead code
        // (minify only) return p.minifySwitchStmt(stmt.loc, s, stmts)
        break;
      }

      case S_FUNCTION: {
        p.visitFn(s.fn, s.fn.openParenLoc, new visitFnOpts());

        // Strip this function declaration if it was overwritten
        if ((p.symbols[refInner(s.fn.name.ref)].flags & RemoveOverwrittenFunctionDeclaration) !== 0 && !s.isExport) {
          return stmts;
        }

        // (minify only) mark empty functions and identity functions

        // Handle exporting this function from a namespace
        if (s.isExport && p.enclosingNamespaceArgRef !== null) {
          s.isExport = false;
          stmts.push(
            stmt,
            assignStmt(
              new Expr(
                p.dotOrMangledPropVisit(
                  new Expr(new EIdentifier(p.enclosingNamespaceArgRef), stmt.loc),
                  p.symbols[refInner(s.fn.name.ref)].originalName,
                  s.fn.name.loc,
                ),
                stmt.loc,
              ),
              new Expr(new EIdentifier(s.fn.name.ref), s.fn.name.loc),
            ),
          );
        } else {
          stmts.push(stmt);
        }

        // (keepNames only) optionally preserve the name
        return stmts;
      }

      case S_CLASS: {
        const result = p.visitClass(stmt.loc, s.class, InvalidRef, "");

        // Remove the export flag inside a namespace
        let nameToExport = "";
        const wasExportInsideNamespace = s.isExport && p.enclosingNamespaceArgRef !== null;
        if (wasExportInsideNamespace) {
          nameToExport = p.symbols[refInner(s.class.name.ref)].originalName;
          s.isExport = false;
        }

        // Lower class field syntax for browsers that don't support it
        const $d203 = p.lowerClass(stmt, null, result, "");
        const classStmts = $d203[0];

        // Remember if the class was side-effect free before lowering
        if (result.canBeRemovedIfUnused) {
          for (const classStmt of classStmts) {
            const s2 = classStmt.data;
            if (s2.k === S_EXPR) {
              s2.isFromClassOrFnThatCanBeRemovedIfUnused = true;
            }
          }
        }

        for (const classStmt of classStmts) stmts.push(classStmt);

        // Handle exporting this class from a namespace
        if (wasExportInsideNamespace) {
          stmts.push(
            assignStmt(
              new Expr(
                p.dotOrMangledPropVisit(
                  new Expr(new EIdentifier(p.enclosingNamespaceArgRef), stmt.loc),
                  nameToExport,
                  s.class.name.loc,
                ),
                stmt.loc,
              ),
              new Expr(new EIdentifier(s.class.name.ref), s.class.name.loc),
            ),
          );
        }

        return stmts;
      }

      case S_ENUM: {
        // Do not end the const local prefix after TypeScript enums. We process
        // them first within their scope so that they are inlined into all code in
        // that scope. We don't want that to cause the const local prefix to end.
        p.currentScope.isAfterConstLocalPrefix = wasAfterAfterConstLocalPrefix;

        // Track cross-module enum constants during bundling
        let tsTopLevelEnumValues = null;
        if (p.currentScope === p.moduleScope && p.options.mode === ModeBundle) {
          tsTopLevelEnumValues = new Map();
        }

        p.recordDeclaredSymbol(s.name.ref);
        p.pushScopeForVisitPass(ScopeEntry, stmt.loc);
        p.recordDeclaredSymbol(s.arg);

        // Scan ahead for any variables inside this namespace. This must be done
        // ahead of time before visiting any statements inside the namespace
        // because we may end up visiting the uses before the declarations.
        // We need to convert the uses into property accesses on the namespace.
        for (const value of s.values) {
          if (value.ref !== InvalidRef) {
            p.isExportedInsideNamespace.set(value.ref, s.arg);
          }
        }

        // Values without initializers are initialized to one more than the
        // previous value if the previous value is numeric. Otherwise values
        // without initializers are initialized to undefined.
        let nextNumericValue = 0;
        let hasNumericValue = true;
        const valueExprs = [];
        let allValuesArePure = true;

        // Update the exported members of this enum as we constant fold each one
        const exportedMembers = p.currentScope.tsNamespace.exportedMembers;

        // We normally don't fold numeric constants because they might increase code
        // size, but it's important to fold numeric constants inside enums since
        // that's what the TypeScript compiler does.
        const oldShouldFoldTypeScriptConstantExpressions = p.shouldFoldTypeScriptConstantExpressions;
        p.shouldFoldTypeScriptConstantExpressions = true;

        // Create an assignment for each enum value
        for (const value of s.values) {
          const name = value.name;
          let assignTarget;
          let hasStringValue = false;

          // Go iterates over copies of the values ("for _, value := range"), so
          // the visited value is kept in a local instead of written back.
          let valueOrNil = value.valueOrNil;

          if (valueOrNil !== null) {
            valueOrNil = p.visitExpr(valueOrNil);
            hasNumericValue = false;

            // "See through" any wrapped comments
            let underlyingValue = valueOrNil;
            if (valueOrNil.data.k === E_INLINED_ENUM) {
              underlyingValue = valueOrNil.data.value;
            }

            const e = underlyingValue.data;
            switch (e.k) {
              case E_NUMBER: {
                if (tsTopLevelEnumValues !== null) {
                  tsTopLevelEnumValues.set(name, new TSEnumValue(null, e.value));
                }
                const member = copyTSNamespaceMember(exportedMembers.get(name));
                member.data = new TSNamespaceMemberEnumNumber(e.value);
                exportedMembers.set(name, member);
                p.refToTSNamespaceMemberData.set(value.ref, member.data);
                hasNumericValue = true;
                nextNumericValue = e.value + 1;
                break;
              }

              case E_STRING: {
                if (tsTopLevelEnumValues !== null) {
                  tsTopLevelEnumValues.set(name, new TSEnumValue(e.value, 0));
                }
                const member = copyTSNamespaceMember(exportedMembers.get(name));
                member.data = new TSNamespaceMemberEnumString(e.value);
                exportedMembers.set(name, member);
                p.refToTSNamespaceMemberData.set(value.ref, member.data);
                hasStringValue = true;
                break;
              }

              default:
                if (knownPrimitiveType(underlyingValue.data) === PrimitiveString) {
                  hasStringValue = true;
                }
                if (!p.astHelpers.exprCanBeRemovedIfUnused(underlyingValue)) {
                  allValuesArePure = false;
                }
            }
          } else if (hasNumericValue) {
            if (tsTopLevelEnumValues !== null) {
              tsTopLevelEnumValues.set(name, new TSEnumValue(null, nextNumericValue));
            }
            const member = copyTSNamespaceMember(exportedMembers.get(name));
            member.data = new TSNamespaceMemberEnumNumber(nextNumericValue);
            exportedMembers.set(name, member);
            p.refToTSNamespaceMemberData.set(value.ref, member.data);
            valueOrNil = new Expr(new ENumber(nextNumericValue), value.loc);
            nextNumericValue++;
          } else {
            valueOrNil = new Expr(EUndefinedShared, value.loc);
          }

          // (minify only) "Enum.Name = value" when the name is an identifier

          // "Enum['Name'] = value"
          assignTarget = assign(
            new Expr(new EIndex(new Expr(new EIdentifier(s.arg), value.loc), new Expr(new EString(value.name), value.loc)), value.loc),
            valueOrNil,
          );
          p.recordUsage(s.arg);

          // String-valued enums do not form a two-way map
          if (hasStringValue) {
            valueExprs.push(assignTarget);
          } else {
            // "Enum[assignTarget] = 'Name'"
            valueExprs.push(
              assign(
                new Expr(new EIndex(new Expr(new EIdentifier(s.arg), value.loc), assignTarget), value.loc),
                new Expr(new EString(value.name), value.loc),
              ),
            );
            p.recordUsage(s.arg);
          }
        }

        p.popScope();
        p.shouldFoldTypeScriptConstantExpressions = oldShouldFoldTypeScriptConstantExpressions;

        // Track all exported top-level enums for cross-module inlining
        if (tsTopLevelEnumValues !== null) {
          if (p.tsEnums === null) {
            p.tsEnums = new Map();
          }
          p.tsEnums.set(s.name.ref, tsTopLevelEnumValues);
        }

        // Wrap this enum definition in a closure
        stmts = p.generateClosureForTypeScriptEnum(
          stmts,
          stmt.loc,
          s.isExport,
          s.name.loc,
          s.name.ref,
          s.arg,
          valueExprs,
          allValuesArePure,
        );
        return stmts;
      }

      case S_NAMESPACE: {
        p.recordDeclaredSymbol(s.name.ref);

        // Scan ahead for any variables inside this namespace. This must be done
        // ahead of time before visiting any statements inside the namespace
        // because we may end up visiting the uses before the declarations.
        // We need to convert the uses into property accesses on the namespace.
        for (let $i60 = 0, $a60 = s.stmts; $i60 < $a60.length; $i60++) {
          const childStmt = $a60[$i60];
          const local = childStmt.data;
          if (local.k === S_LOCAL) {
            if (local.isExport) {
              forEachIdentifierBindingInDecls(local.decls, (loc, b) => {
                p.isExportedInsideNamespace.set(b.ref, s.arg);
              });
            }
          }
        }

        const oldEnclosingNamespaceArgRef = p.enclosingNamespaceArgRef;
        p.enclosingNamespaceArgRef = s.arg;
        p.pushScopeForVisitPass(ScopeEntry, stmt.loc);
        p.recordDeclaredSymbol(s.arg);
        const stmtsInsideNamespace = p.visitStmtsAndPrependTempRefs(s.stmts, new prependTempRefsOpts(null, stmtsFnBody));
        p.popScope();
        p.enclosingNamespaceArgRef = oldEnclosingNamespaceArgRef;

        // Generate a closure for this namespace
        stmts = p.generateClosureForTypeScriptNamespaceOrEnum(
          stmts,
          stmt.loc,
          s.isExport,
          s.name.loc,
          s.name.ref,
          s.arg,
          stmtsInsideNamespace,
        );
        return stmts;
      }

      default:
        bail(); // panic("Internal error")
    }

    stmts.push(stmt);
    return stmts;
  },

  // Only called when minifySyntax is enabled (never in the fast path), but
  // ported for completeness.
  minifySwitchStmt(loc, s, stmts) {
    const p = this;

    // Trim empty cases before a trailing default clause
    if (s.cases.length > 0) {
      let i = s.cases.length - 1;
      if (s.cases[i].valueOrNil === null) {
        // "switch (x) { case 0: default: y() }" => "switch (x) { default: y() }"
        while (i > 0 && s.cases[i - 1].body.length === 0 && isPrimitiveLiteral(s.cases[i - 1].valueOrNil.data)) {
          i--;
        }
        const last = s.cases[s.cases.length - 1];
        s.cases.length = i;
        s.cases.push(last);
      }
    }

    // Attempt to partially-evaluate statically-determined switch statements
    if (isPrimitiveLiteral(s.test.data)) {
      let allCasesArePrimitives = true;
      let defaultIndex = -1;

      // Pass 1: Check for primitives and find the "default" case
      for (let i = 0; i < s.cases.length; i++) {
        const c = s.cases[i];
        if (c.valueOrNil === null) {
          defaultIndex = i;
        } else if (!isPrimitiveLiteral(c.valueOrNil.data)) {
          allCasesArePrimitives = false;
        }
      }

      // To simplify analysis, only continue when all cases are primitives
      if (allCasesArePrimitives) {
        let takenIndex = -1;

        // Find the case that compares equal and will be taken
        for (let i = 0; i < s.cases.length; i++) {
          const c = s.cases[i];
          // (Go passes a nil "right" for the default case, which is never equal)
          if (c.valueOrNil === null) continue;
          const $d204 = checkEqualityIfNoSideEffects(s.test.data, c.valueOrNil.data, StrictEquality);
          const isEqualToTest = $d204[0], ok = $d204[1];
          if (ok && isEqualToTest) {
            takenIndex = i;
            break;
          }
        }
        if (takenIndex === -1) {
          takenIndex = defaultIndex;
        }

        // Partially evaluate the cases
        if (takenIndex !== -1) {
          let isFallThrough = false;
          let liveIndex = -1;
          let end = 0;
          const n = s.cases.length;
          for (let i = 0; i < n; i++) {
            const c = s.cases[i];
            const body = c.body; // Go: "c" is a copy taken before any appends
            const isTaken = i === takenIndex;
            if (isTaken) {
              liveIndex = end;
            }
            if (isFallThrough) {
              const live = s.cases[liveIndex];
              live.body = live.body.concat(body);
            } else if (isTaken || body.length > 0) {
              s.cases[end] = c;
              end++;
            }
            if (isTaken || isFallThrough) {
              isFallThrough = caseBodyCouldHaveFallThrough(body);
            }
          }
          s.cases.length = end;
        }
      }
    }

    // Handle empty switch statements
    if (s.cases.length === 0) {
      if (p.astHelpers.exprCanBeRemovedIfUnused(s.test)) {
        // Remove everything
        return stmts;
      } else {
        // Just keep the test expression
        stmts.push(new Stmt(new SExpr(s.test), s.test.loc));
        return stmts;
      }
    }

    // Handle a switch statement containing only a "default" clause
    if (s.cases.length === 1) {
      const c = s.cases[0];
      if (c.valueOrNil === null && p.astHelpers.exprCanBeRemovedIfUnused(s.test)) {
        const $d205 = tryToInlineCaseBody(s.bodyLoc, c.body, s.closeBraceLoc);
        const body = $d205[0], ok = $d205[1];
        if (ok) {
          for (const x of body) stmts.push(x);
          return stmts;
        }
      }
    }

    // Try to turn this into an if-else statement
    let yesCase = new Case();
    let noCase = new Case();
    if (s.cases.length === 1) {
      const yes = s.cases[0];
      if (yes.valueOrNil !== null) {
        yesCase = yes;
      }
    } else if (s.cases.length === 2) {
      // "switch (x) { case y: a(); break; default: b() }"
      {
        const yes = s.cases[0];
        if (yes.valueOrNil !== null && !caseBodyCouldHaveFallThrough(yes.body)) {
          const no = s.cases[1];
          if (no.valueOrNil === null) {
            yesCase = yes;
            noCase = no;
          }
        }
      }

      // "switch (x) { default: a(); break; case y: b() }"
      {
        const no = s.cases[0];
        if (no.valueOrNil === null && !caseBodyCouldHaveFallThrough(no.body)) {
          const yes = s.cases[1];
          if (yes.valueOrNil !== null) {
            yesCase = yes;
            noCase = no;
          }
        }
      }
    }
    if (yesCase.valueOrNil !== null) {
      const $d206 = tryToInlineCaseBody(s.bodyLoc, yesCase.body, s.closeBraceLoc);
      const yesBody = $d206[0], ok = $d206[1];
      if (ok) {
        const $d207 = tryToInlineCaseBody(s.bodyLoc, noCase.body, s.closeBraceLoc);
        const noBody = $d207[0], ok2 = $d207[1];
        if (ok2) {
          let testData;
          const $d208 = checkEqualityIfNoSideEffects(s.test.data, yesCase.valueOrNil.data, StrictEquality);
          const isEqualToTest = $d208[0], ok3 = $d208[1];
          if (ok3) {
            testData = new EBoolean(isEqualToTest);
          } else {
            testData = new EBinary(s.test, yesCase.valueOrNil, BinOpStrictEq);
          }
          const ifElse = new SIf(new Expr(testData, s.test.loc), stmtsToSingleStmt(yesCase.loc, yesBody, 0));
          if (noBody.length > 0) {
            ifElse.noOrNil = stmtsToSingleStmt(noCase.loc, noBody, 0);
          }
          return p.mangleIf(stmts, loc, ifElse);
        }
      }
    }

    stmts.push(new Stmt(s, loc));
    return stmts;
  },

  // If we are currently in a hoisted child of the module scope, relocate these
  // declarations to the top level and return an equivalent assignment statement.
  // Make sure to check that the declaration kind is "var" before calling this.
  // And make sure to check that the returned statement is not null.
  // Returns [stmt, ok].
  maybeRelocateVarsToTopLevel(decls, mode) {
    const p = this;

    // Only do this when bundling, and not when the scope is already top-level
    if (p.options.mode !== ModeBundle || (p.currentScope === p.moduleScope && p.singleStmtDepth === 0)) {
      return [null, false];
    }

    // Only do this if we're not inside a function
    let scope = p.currentScope;
    while (!scopeKindStopsHoisting(scope.kind)) {
      scope = scope.parent;
    }
    if (scope !== p.moduleScope) {
      return [null, false];
    }

    // Convert the declarations to assignments
    const wrapIdentifier = (loc, ref) => {
      p.relocatedTopLevelVars.push(new LocRef(loc, ref));
      p.recordUsage(ref);
      return new Expr(new EIdentifier(ref), loc);
    };
    let value = null;
    for (const decl of decls) {
      const binding = convertBindingToExpr(decl.binding, wrapIdentifier);
      if (decl.valueOrNil !== null) {
        value = joinWithComma(value, assign(binding, decl.valueOrNil));
      } else if (mode === relocateVarsForInOrForOf) {
        value = joinWithComma(value, binding);
      }
    }
    if (value === null) {
      // If none of the variables had any initializers, just remove the declarations
      return [null, true];
    }
    return [new Stmt(new SExpr(value), value.loc), true];
  },

  markExprAsParenthesized(value, openParenLoc, isAsync) {
    const p = this;

    // Don't lose comments due to parentheses. For example, we don't want to lose
    // the comment here:
    //
    //   ( /* comment */ (foo) );
    //
    if (!isAsync && p.exprComments !== null) {
      const comments = p.exprComments.get(openParenLoc);
      if (comments !== undefined) {
        p.exprComments.delete(openParenLoc);
        const existing = p.exprComments.get(value.loc);
        p.exprComments.set(value.loc, existing !== undefined ? comments.concat(existing) : comments);
      }
    }

    const e = value.data;
    switch (e.k) {
      case E_ARRAY:
      case E_OBJECT:
      case E_FUNCTION:
      case E_ARROW:
      case E_BINARY:
        e.isParenthesized = true;
        break;
    }
  },

  maybeTransposeIfExprChain(expr, visit) {
    const p = this;
    const e = expr.data;
    if (e.k === E_IF) {
      e.yes = p.maybeTransposeIfExprChain(e.yes, visit);
      e.no = p.maybeTransposeIfExprChain(e.no, visit);
      return expr;
    }
    return visit(expr);
  },

  // Returns [expr, ok]
  maybeInlineIIFE(loc, e) {
    const p = this;
    if (e.args.length !== 0) {
      return [null, false];
    }

    // Note: Do not inline async arrow functions as they are not IIFEs. In
    // particular, they are not necessarily invoked immediately, and any
    // exceptions involved in their evaluation will be swallowed without
    // bubbling up to the surrounding context.
    const arrow = e.target.data;
    if (arrow.k === E_ARROW && arrow.args.length === 0 && !arrow.isAsync) {
      const stmts = arrow.body.block.stmts;

      // "(() => {})()" => "void 0"
      if (stmts.length === 0) {
        return [new Expr(EUndefinedShared, loc), true];
      }

      if (stmts.length === 1) {
        let value = null;

        const s = stmts[0].data;
        switch (s.k) {
          // "(() => { return })()" => "void 0"
          // "(() => { return 123 })()" => "123"
          case S_RETURN:
            value = s.valueOrNil;
            if (value === null) {
              value = new Expr(EUndefinedShared, 0);
            }
            break;

          // "(() => { x })()" => "void x"
          case S_EXPR:
            value = new Expr(new EUnary(s.value, UnOpVoid), s.value.loc);
            break;
        }

        if (value !== null) {
          // Be careful about "/* @__PURE__ */" comments:
          //
          //   OK:  "(() => x)()"                 => "x"
          //   BAD: "/* @__PURE__ */ (() => x)()" => "x"
          //
          // The comment indicates that the function body is eligible for
          // dead code elimination. Since we don't have a direct AST node
          // for that, we can't currently unwrap that and preserve the
          // intent. So if it does have a pure comment, only remove it if
          // the value itself is already pure.
          if (!e.canBeUnwrappedIfUnused || p.astHelpers.exprCanBeRemovedIfUnused(value)) {
            return [value, true];
          }
        }
      }
    }

    return [null, false];
  },

  iifeCanBeRemovedIfUnused(args, body) {
    const p = this;
    for (const arg of args) {
      if (arg.defaultOrNil !== null && !p.astHelpers.exprCanBeRemovedIfUnused(arg.defaultOrNil)) {
        // The default value has a side effect
        return false;
      }

      if (arg.binding.data.k !== B_IDENTIFIER) {
        // Destructuring is a side effect (due to property access)
        return false;
      }
    }

    // Check whether any statements have side effects or not. Consider return
    // statements as not having side effects because if the IIFE can be removed
    // then we know the return value is unused, so we know that returning the
    // value has no side effects.
    return p.astHelpers.stmtsCanBeRemovedIfUnused(body.block.stmts, ReturnCanBeRemovedIfUnused);
  },

  // This is a helper function to use when you need to capture a value that may
  // have side effects so you can use it multiple times. It guarantees that the
  // side effects take place exactly once.
  //
  // Returns [valueFunc, wrapFunc]: valueFunc() generates reference expressions
  // and wrapFunc(expr) must be called on the final expression.
  //
  // This returns a function for generating references instead of a raw reference
  // because AST nodes are supposed to be unique in memory, not aliases of other
  // AST nodes. That way you can mutate one during lowering without having to
  // worry about messing up other nodes.
  captureValueWithPossibleSideEffects(loc, count, value, mode) {
    const p = this;
    const wrapFunc = (expr) => {
      // Make sure side effects still happen if no expression was generated
      if (expr === null) {
        return value;
      }
      return expr;
    };

    // Referencing certain expressions more than once has no side effects, so we
    // can just create them inline without capturing them in a temporary variable
    let valueFunc = null;
    const e = value.data;
    switch (e.k) {
      case E_NULL:
        valueFunc = () => new Expr(ENullShared, loc);
        break;
      case E_UNDEFINED:
        valueFunc = () => new Expr(EUndefinedShared, loc);
        break;
      case E_THIS:
        valueFunc = () => new Expr(EThisShared, loc);
        break;
      case E_BOOLEAN:
        valueFunc = () => new Expr(new EBoolean(e.value), loc);
        break;
      case E_NUMBER:
        valueFunc = () => new Expr(new ENumber(e.value), loc);
        break;
      case E_BIG_INT:
        valueFunc = () => new Expr(new EBigInt(e.value), loc);
        break;
      case E_STRING:
        valueFunc = () => new Expr(new EString(e.value), loc);
        break;
      case E_PRIVATE_IDENTIFIER:
        valueFunc = () => new Expr(new EPrivateIdentifier(e.ref), loc);
        break;
      case E_IDENTIFIER:
        if (mode === valueDefinitelyNotMutated) {
          valueFunc = () => {
            // Make sure we record this usage in the usage count so that duplicating
            // a single-use reference means it's no longer considered a single-use
            // reference. Otherwise the single-use reference inlining code may
            // incorrectly inline the initializer into the first reference, leaving
            // the second reference without a definition.
            p.recordUsage(e.ref);
            return new Expr(new EIdentifier(e.ref), loc);
          };
        }
        break;
    }
    if (valueFunc !== null) {
      return [valueFunc, wrapFunc];
    }

    // We don't need to worry about side effects if the value won't be used
    // multiple times. This special case lets us avoid generating a temporary
    // reference.
    if (count < 2) {
      return [() => value, wrapFunc];
    }

    // Otherwise, fall back to generating a temporary reference
    let tempRef = InvalidRef;

    // If we're in a function argument scope, then we won't be able to generate
    // symbols in this scope to store stuff, since there's nowhere to put the
    // variable declaration. We don't want to put the variable declaration
    // outside the function since some code in the argument list may cause the
    // function to be reentrant, and we can't put the variable declaration in
    // the function body since that's not accessible by the argument list.
    //
    // Instead, we use an immediately-invoked arrow function to create a new
    // symbol inline by introducing a new scope. Make sure to only use it for
    // symbol declaration and still initialize the variable inline to preserve
    // side effect order.
    if (p.currentScope.kind === ScopeFunctionArgs) {
      return [
        () => {
          if (tempRef === InvalidRef) {
            tempRef = p.generateTempRef(tempRefNoDeclare, "");

            // Assign inline so the order of side effects remains the same
            p.recordUsage(tempRef);
            return assign(new Expr(new EIdentifier(tempRef), loc), value);
          }
          p.recordUsage(tempRef);
          return new Expr(new EIdentifier(tempRef), loc);
        },
        (expr) => {
          // Make sure side effects still happen if no expression was generated
          if (expr === null) {
            return value;
          }

          // Generate a new variable using an arrow function to avoid messing with "this"
          return new Expr(
            new ECall(
              new Expr(
                new EArrow(
                  [new Arg(new Binding(new BIdentifier(tempRef), loc))],
                  new FnBody(new SBlock([new Stmt(new SReturn(expr), loc)]), loc),
                  false,
                  false,
                  true, // PreferExpr
                ),
                loc,
              ),
            ),
            loc,
          );
        },
      ];
    }

    return [
      () => {
        if (tempRef === InvalidRef) {
          tempRef = p.generateTempRef(tempRefNeedsDeclare, "");
          p.recordUsage(tempRef);
          return assign(new Expr(new EIdentifier(tempRef), loc), value);
        }
        p.recordUsage(tempRef);
        return new Expr(new EIdentifier(tempRef), loc);
      },
      wrapFunc,
    ];
  },

  visitDecorators(decorators, decoratorScope) {
    const p = this;
    if (decorators !== null) {
      // Decorators cause us to temporarily revert to the scope that encloses the
      // class declaration, since that's where the generated code for decorators
      // will be inserted. I believe this currently only matters for parameter
      // decorators, where the scope should not be within the argument list.
      const oldScope = p.currentScope;
      p.currentScope = decoratorScope;

      for (let i = 0; i < decorators.length; i++) {
        const decorator = decorators[i];
        // Go writes the new value into the slice element (a value struct)
        decorators[i] = new Decorator(p.visitExpr(decorator.value), decorator.atLoc, decorator.omitNewlineAfter);
      }

      // Avoid "popScope" because this decorator scope is not hierarchical
      p.currentScope = oldScope;
    }

    return decorators;
  },

  // "class_" is the js_ast.Class object (Go passes a pointer into the SClass /
  // EClass node). Returns a visitClassResult.
  visitClass(nameScopeLoc, class_, defaultNameRef, nameToKeep) {
    const p = this;
    const result = new visitClassResult();

    class_.decorators = p.visitDecorators(class_.decorators, p.currentScope);

    if (class_.name !== null) {
      p.recordDeclaredSymbol(class_.name.ref);
      // (keepNames only) nameToKeep = the class name
    }

    // Replace "this" with a reference to the class inside static field
    // initializers if static fields are being lowered, since that relocates the
    // field initializers outside of the class body and "this" will no longer
    // reference the same thing.
    let classLoweringInfo = p.computeClassLoweringInfo(class_);
    let recomputeClassLoweringInfo = false;

    // Sometimes we need to lower private members even though they are supported.
    // This flags them for lowering so that we lower references to them as we
    // traverse the class body.
    //
    // We don't need to worry about possible references to the class shadowing
    // symbol inside the class body changing our decision to lower private members
    // later on because that shouldn't be possible.
    if (classLoweringInfo.lowerAllStaticFields) {
      for (let $i61 = 0, $a61 = class_.properties; $i61 < $a61.length; $i61++) {
        const prop = $a61[$i61];
        // We need to lower all private members if fields of that type are lowered,
        // not just private fields (methods and accessors too).
        if (prop.key !== null && prop.key.data.k === E_PRIVATE_IDENTIFIER) {
          p.symbols[refInner(prop.key.data.ref)].flags |= PrivateSymbolMustBeLowered;
          recomputeClassLoweringInfo = true;
        }
      }
    }

    // Conservatively lower all private names that have been used in a private
    // brand check anywhere in the file. See the comment on this map for details.
    // (An empty map behaves exactly like Go's nil map here.)
    if (p.lowerAllOfThesePrivateNames !== null && p.lowerAllOfThesePrivateNames.size > 0) {
      for (let $i62 = 0, $a62 = class_.properties; $i62 < $a62.length; $i62++) {
        const prop = $a62[$i62];
        if (prop.key !== null && prop.key.data.k === E_PRIVATE_IDENTIFIER) {
          const symbol = p.symbols[refInner(prop.key.data.ref)];
          if (p.lowerAllOfThesePrivateNames.has(symbol.originalName)) {
            symbol.flags |= PrivateSymbolMustBeLowered;
            recomputeClassLoweringInfo = true;
          }
        }
      }
    }

    // If we changed private symbol lowering decisions, then recompute class
    // lowering info because that may have changed other decisions too
    if (recomputeClassLoweringInfo) {
      classLoweringInfo = p.computeClassLoweringInfo(class_);
    }

    p.pushScopeForVisitPass(ScopeClassName, nameScopeLoc);
    const oldEnclosingClassKeyword = p.enclosingClassKeyword;
    p.enclosingClassKeyword = class_.classKeyword;
    p.currentScope.recursiveSetStrictMode(ImplicitStrictModeClass);
    if (class_.name !== null) {
      p.validateDeclaredSymbolName(class_.name.loc, p.symbols[refInner(class_.name.ref)].originalName);
    }

    // Create the "__super" symbol if necessary. This will cause us to replace
    // all "super()" call expressions with a call to this symbol, which will
    // then be inserted into the "constructor" method.
    result.superCtorRef = InvalidRef;
    if (classLoweringInfo.shimSuperCtorCalls) {
      result.superCtorRef = p.newSymbol(SymbolOther, "__super");
      p.currentScope.generated.push(result.superCtorRef);
      p.recordDeclaredSymbol(result.superCtorRef);
    }
    const oldSuperCtorRef = p.superCtorRef;
    p.superCtorRef = result.superCtorRef;

    // Insert an immutable inner name that spans the whole class to match
    // JavaScript's semantics specifically the "CreateImmutableBinding" here:
    // https://262.ecma-international.org/6.0/#sec-runtime-semantics-classdefinitionevaluation
    // The class body (and extends clause) "captures" the original value of the
    // class name. This matters for class statements because the symbol can be
    // re-assigned to something else later. The captured values must be the
    // original value of the name, not the re-assigned value. Use "const" for
    // this symbol to match JavaScript run-time semantics. You are not allowed
    // to assign to this symbol (it throws a TypeError).
    if (class_.name !== null) {
      const name = p.symbols[refInner(class_.name.ref)].originalName;
      result.innerClassNameRef = p.newSymbol(SymbolConst, "_" + name);
      p.currentScope.members.set(name, new ScopeMember(result.innerClassNameRef, class_.name.loc));
    } else {
      let name = "_this";
      if (defaultNameRef !== InvalidRef) {
        name = "_" + p.source.identifierName + "_default";
      }
      result.innerClassNameRef = p.newSymbol(SymbolConst, name);
    }
    p.recordDeclaredSymbol(result.innerClassNameRef);

    if (class_.extendsOrNil !== null) {
      class_.extendsOrNil = p.visitExpr(class_.extendsOrNil);
    }

    // A scope is needed for private identifiers
    p.pushScopeForVisitPass(ScopeClassBody, class_.bodyLoc);
    result.bodyScope = p.currentScope;

    const properties = class_.properties;
    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];

      if (property.kind === PropertyClassStaticBlock) {
        const oldFnOrArrowData = p.fnOrArrowDataVisit;
        const oldFnOnlyDataVisit = p.fnOnlyDataVisit;

        p.fnOrArrowDataVisit = new fnOrArrowDataVisit();
        const fnOnly = new fnOnlyDataVisit();
        fnOnly.isThisNested = true;
        fnOnly.isNewTargetAllowed = true;
        fnOnly.isInStaticClassContext = true;
        fnOnly.innerClassNameRef = result.innerClassNameRef; // Go: &result.innerClassNameRef
        p.fnOnlyDataVisit = fnOnly;

        if (classLoweringInfo.lowerAllStaticFields) {
          // Need to lower "this" and "super" since they won't be valid outside the class body
          p.fnOnlyDataVisit.shouldReplaceThisWithInnerClassNameRef = true;
          p.fnOrArrowDataVisit.shouldLowerSuperPropertyAccess = true;
        }

        p.pushScopeForVisitPass(ScopeClassStaticInit, property.classStaticBlock.loc);

        // Make it an error to use "arguments" in a static class block
        p.currentScope.forbidArguments = true;

        property.classStaticBlock.block.stmts = p.visitStmts(property.classStaticBlock.block.stmts, stmtsFnBody);
        p.popScope();

        p.fnOrArrowDataVisit = oldFnOrArrowData;
        p.fnOnlyDataVisit = oldFnOnlyDataVisit;
        continue;
      }

      property.decorators = p.visitDecorators(property.decorators, result.bodyScope);

      // Visit the property key
      if (property.key.data.k === E_PRIVATE_IDENTIFIER) {
        // Special-case private identifiers here
        p.recordDeclaredSymbol(property.key.data.ref);
      } else {
        // It's forbidden to reference the class name in a computed key
        if ((property.flags & PropertyIsComputed) !== 0 && class_.name !== null) {
          p.symbols[refInner(result.innerClassNameRef)].kind = SymbolClassInComputedPropertyKey;
        }

        const $d209 = p.visitExprInOut(property.key, new exprIn(false, false, false, false, true));
        const key = $d209[0];
        property.key = key;

        // Re-allow using the class name after visiting a computed key
        if ((property.flags & PropertyIsComputed) !== 0 && class_.name !== null) {
          p.symbols[refInner(result.innerClassNameRef)].kind = SymbolConst;
        }

        // (minify only) inline enum keys / "class { [123] }" => "class { 123 }"
      }

      // Make it an error to use "arguments" in a class body
      p.currentScope.forbidArguments = true;

      // The value of "this" and "super" is shadowed inside property values
      const oldFnOnlyDataVisit = p.fnOnlyDataVisit;
      const oldShouldLowerSuperPropertyAccess = p.fnOrArrowDataVisit.shouldLowerSuperPropertyAccess;
      p.fnOrArrowDataVisit.shouldLowerSuperPropertyAccess = false;
      p.fnOnlyDataVisit = oldFnOnlyDataVisit.clone(); // Go saved a value copy before mutating
      p.fnOnlyDataVisit.shouldReplaceThisWithInnerClassNameRef = false;
      p.fnOnlyDataVisit.isThisNested = true;
      p.fnOnlyDataVisit.isNewTargetAllowed = true;
      p.fnOnlyDataVisit.isInStaticClassContext = (property.flags & PropertyIsStatic) !== 0;
      p.fnOnlyDataVisit.innerClassNameRef = result.innerClassNameRef; // Go: &result.innerClassNameRef

      // We need to explicitly assign the name to the property initializer if it
      // will be transformed such that it is no longer an inline initializer.
      // (Go shadows the "nameToKeep" parameter here.)
      let propNameToKeep = "";
      let isLoweredPrivateMethod = false;
      const keyData = property.key.data;
      if (keyData.k === E_PRIVATE_IDENTIFIER) {
        if (!propertyKindIsMethodDefinition(property.kind) || p.privateSymbolNeedsToBeLowered(keyData)) {
          propNameToKeep = p.symbols[refInner(keyData.ref)].originalName;
        }

        // Lowered private methods (both instance and static) are initialized
        // outside of the class body, so we must rewrite "super" property
        // accesses inside them. Lowered private instance fields are initialized
        // inside the constructor where "super" is valid, so those don't need to
        // be rewritten.
        if (propertyKindIsMethodDefinition(property.kind) && p.privateSymbolNeedsToBeLowered(keyData)) {
          isLoweredPrivateMethod = true;
        }
      } else if (!propertyKindIsMethodDefinition(property.kind) && (property.flags & PropertyIsComputed) === 0) {
        if (keyData.k === E_STRING) {
          propNameToKeep = keyData.value;
        }
      }

      // Handle methods
      if (property.valueOrNil !== null) {
        p.propMethodDecoratorScope = result.bodyScope;

        // Propagate the name to keep from the method into the initializer
        if (propNameToKeep !== "") {
          p.nameToKeep = propNameToKeep;
          p.nameToKeepIsFor = property.valueOrNil.data;
        }

        // Propagate whether we're in a derived class constructor
        if (class_.extendsOrNil !== null && (property.flags & PropertyIsComputed) === 0) {
          const str = property.key.data;
          if (str.k === E_STRING && str.value === "constructor") {
            p.propDerivedCtorValue = property.valueOrNil.data;
          }
        }

        const $d210 = p.visitExprInOut(property.valueOrNil, new exprIn(true, isLoweredPrivateMethod));
        const value = $d210[0];
        property.valueOrNil = value;
      }

      // Handle initialized fields
      if (property.initializerOrNil !== null) {
        if ((property.flags & PropertyIsStatic) !== 0 && classLoweringInfo.lowerAllStaticFields) {
          // Need to lower "this" and "super" since they won't be valid outside the class body
          p.fnOnlyDataVisit.shouldReplaceThisWithInnerClassNameRef = true;
          p.fnOrArrowDataVisit.shouldLowerSuperPropertyAccess = true;
        }

        // Propagate the name to keep from the field into the initializer
        if (propNameToKeep !== "") {
          p.nameToKeep = propNameToKeep;
          p.nameToKeepIsFor = property.initializerOrNil.data;
        }

        property.initializerOrNil = p.visitExpr(property.initializerOrNil);
      }

      // Restore "this" so it will take the inherited value in property keys
      p.fnOnlyDataVisit = oldFnOnlyDataVisit;
      p.fnOrArrowDataVisit.shouldLowerSuperPropertyAccess = oldShouldLowerSuperPropertyAccess;

      // Restore the ability to use "arguments" in decorators and computed properties
      p.currentScope.forbidArguments = false;
    }

    // Check for and warn about duplicate keys in class bodies
    if (!p.suppressWarningsAboutWeirdCode) {
      p.warnAboutDuplicateProperties(class_.properties, duplicatePropertiesInClass);
    }

    // Analyze side effects before adding the name keeping call
    result.canBeRemovedIfUnused = p.astHelpers.classCanBeRemovedIfUnused(class_);

    // (keepNames only) implement name keeping using a static block at the start
    // of the class body

    p.enclosingClassKeyword = oldEnclosingClassKeyword;
    p.superCtorRef = oldSuperCtorRef;
    p.popScope();

    if (p.symbols[refInner(result.innerClassNameRef)].useCountEstimate === 0) {
      // Don't generate a shadowing name if one isn't needed
      result.innerClassNameRef = InvalidRef;
    } else if (class_.name === null) {
      // If there was originally no class name but something inside needed one
      // (e.g. there was a static property initializer that referenced "this"),
      // populate the class name. If this is an "export default class" statement,
      // use the existing default name so that things will work as expected if
      // this is turned into a regular class statement later on.
      let classNameRef = defaultNameRef;
      if (classNameRef === InvalidRef) {
        classNameRef = p.newSymbol(SymbolOther, "_this");
        p.currentScope.generated.push(classNameRef);
        p.recordDeclaredSymbol(classNameRef);
      }
      class_.name = new LocRef(nameScopeLoc, classNameRef);
    }

    p.popScope();

    // Sanity check that the class lowering info hasn't changed before and after
    // visiting. The class transform relies on this because lowering assumes that
    // must be able to expect that visiting has done certain things.
    const check = p.computeClassLoweringInfo(class_);
    if (
      classLoweringInfo.lowerAllInstanceFields !== check.lowerAllInstanceFields ||
      classLoweringInfo.lowerAllStaticFields !== check.lowerAllStaticFields ||
      classLoweringInfo.shimSuperCtorCalls !== check.shimSuperCtorCalls
    ) {
      bail(); // panic("Internal error")
    }

    return result;
  },

  visitArgs(args, opts) {
    const p = this;
    let duplicateArgCheck = null;
    const $d211 = fnBodyContainsUseStrict(opts.body);
    const hasUseStrict = $d211[1];
    const hasSimpleArgs = isSimpleParameterList(args, opts.hasRestArg);

    // Section 15.2.1 Static Semantics: Early Errors: "It is a Syntax Error if
    // FunctionBodyContainsUseStrict of FunctionBody is true and
    // IsSimpleParameterList of FormalParameters is false."
    if (hasUseStrict && !hasSimpleArgs) {
      // "Cannot use a \"use strict\" directive in a function with a non-simple parameter list"
      p.log.addError();
    }

    // Section 15.1.1 Static Semantics: Early Errors: "Multiple occurrences of
    // the same BindingIdentifier in a FormalParameterList is only allowed for
    // functions which have simple parameter lists and which are not defined in
    // strict mode code."
    if (opts.isUniqueFormalParameters || hasUseStrict || !hasSimpleArgs || p.isStrictMode()) {
      duplicateArgCheck = new Map();
    }

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      arg.decorators = p.visitDecorators(arg.decorators, opts.decoratorScope);
      p.visitBinding(arg.binding, new bindingOpts(duplicateArgCheck));
      if (arg.defaultOrNil !== null) {
        arg.defaultOrNil = p.visitExpr(arg.defaultOrNil);
      }
    }
  },

  isDotOrIndexDefineMatch(expr, parts) {
    return isDotOrIndexDefineMatchN(this, expr, parts, parts.length);
  },

  // "expr" is a config.DefineExpr, "opts" an identifierOpts (Go passes both
  // by value, so "opts" is copied before it is modified).
  instantiateDefineExpr(loc, expr, opts) {
    const p = this;
    if (expr.constant !== null) {
      return new Expr(expr.constant, loc);
    }

    if (expr.injectedDefineIndex >= 0) {
      const ref = p.injectedDefineSymbols[expr.injectedDefineIndex];
      p.recordUsage(ref);
      return new Expr(new EIdentifier(ref), loc);
    }

    const parts = expr.parts;
    if (parts === null || parts.length === 0) {
      return null;
    }

    // Check both user-specified defines and known globals
    if (opts.matchAgainstDefines) {
      // Make sure define resolution is not recursive
      opts = new identifierOpts(
        opts.assignTarget,
        opts.isCallTarget,
        opts.isDeleteTarget,
        opts.preferQuotedKey,
        opts.wasOriginallyIdentifier,
        false,
      );

      // Substitute user-specified defines
      const defines = p.options.defines.dotDefines.get(parts[parts.length - 1]);
      if (defines !== undefined) {
        for (const define of defines) {
          if (define.defineExpr !== null && stringArraysEqual(define.keyParts, parts)) {
            return p.instantiateDefineExpr(loc, define.defineExpr, opts);
          }
        }
      }
    }

    // Check injected dot names
    if (p.injectedDotNames !== null) {
      const names = p.injectedDotNames.get(parts[parts.length - 1]);
      if (names !== undefined) {
        for (const name of names) {
          if (stringArraysEqual(name.parts, parts)) {
            return p.instantiateInjectDotName(loc, name, opts.assignTarget);
          }
        }
      }
    }

    // Generate an identifier for the first part
    let value;
    const firstPart = parts[0];
    let start = 1; // Go: "parts = parts[1:]"
    switch (firstPart) {
      case "NaN":
        value = new Expr(new ENumber(NaN), loc);
        break;

      case "Infinity":
        value = new Expr(new ENumber(Infinity), loc);
        break;

      case "null":
        value = new Expr(ENullShared, loc);
        break;

      case "undefined":
        value = new Expr(EUndefinedShared, loc);
        break;

      case "this": {
        const $d212 = p.valueForThis(loc, false /* shouldLog */, AssignTargetNone, false, false);
        const thisValue = $d212[0], ok = $d212[1];
        if (ok) {
          value = thisValue;
        } else {
          value = new Expr(EThisShared, loc);
        }
        break;
      }

      default: {
        if (firstPart === "import" && parts.length > start && parts[start] === "meta") {
          const $d213 = p.valueForImportMeta(loc);
          const importMeta = $d213[0], ok = $d213[1];
          if (ok) {
            value = importMeta;
          } else {
            value = new Expr(new EImportMeta(), loc);
          }
          start++;
          break;
        }

        const result = p.findSymbol(loc, firstPart);
        value = p.handleIdentifier(
          loc,
          new EIdentifier(
            result.ref,
            result.isInsideWithScope,
            // Enable tree shaking
            true,
          ),
          opts,
        );
      }
    }

    // Build up a chain of property access expressions for subsequent parts
    for (let i = start; i < parts.length; i++) {
      const part = parts[i];
      const $d214 = p.maybeRewritePropertyAccess(loc, AssignTargetNone, false, value, part, loc, false, false, false);
      const expr2 = $d214[0], ok = $d214[1];
      if (ok) {
        value = expr2;
      } else {
        // (mangleProps only) p.isMangledProp(part) is always false here
        value = new Expr(
          new EDot(
            value,
            part,
            loc,
            OptionalChainNone,
            // Enable tree shaking
            true,
          ),
          loc,
        );
      }
    }

    return value;
  },

  // "name" is an injectedDotName
  instantiateInjectDotName(loc, name, assignTarget) {
    const p = this;

    // Note: We don't need to "ignoreRef" on the underlying identifier
    // because we have only parsed it but not visited it yet
    const ref = p.injectedDefineSymbols[name.injectedDefineIndex];
    p.recordUsage(ref);

    if (assignTarget !== AssignTargetNone) {
      if (p.injectedSymbolSources !== null && p.injectedSymbolSources.has(ref)) {
        // "Cannot assign to %q because it's an import from an injected file"
        p.log.addErrorWithNotes();
      }
    }

    return new Expr(new EIdentifier(ref), loc);
  },

  checkForUnrepresentableIdentifier(loc, name) {
    // Go: "if p.options.asciiOnly && p.options.unsupportedJSFeatures.Has(compat.UnicodeEscapes) && ..."
    // compat.UnicodeEscapes is always supported in the fast path, so this
    // never does anything. (lowering only)
  },

  warnAboutTypeofAndString(a, b, order) {
    const p = this;
    if (order === checkBothOrders) {
      if (a.data.k === E_STRING) {
        const tmp = a;
        a = b;
        b = tmp;
      }
    }

    const typeof_ = a.data;
    if (typeof_.k === E_UNARY && typeof_.op === UnOpTypeof) {
      const str = b.data;
      if (str.k === E_STRING) {
        const value = str.value;
        switch (value) {
          case "undefined":
          case "object":
          case "boolean":
          case "number":
          case "bigint":
          case "string":
          case "symbol":
          case "function":
          case "unknown":
            break;
          default: {
            // Warn about typeof comparisons with values that will never be
            // returned. Here's an example of code with this problem:
            // https://github.com/olifolkerd/tabulator/issues/2962
            let kind = Warning;
            if (p.suppressWarningsAboutWeirdCode) {
              kind = Debug;
            }
            // "The \"typeof\" operator will never evaluate to %q"
            p.log.addIDWithNotes(MsgID_JS_ImpossibleTypeof, kind);
          }
        }
      }
    }
  },

  warnAboutEqualityCheck(op, value, afterOpLoc) {
    const p = this;
    const e = value.data;
    switch (e.k) {
      case E_NUMBER: {
        // "0 === -0" is true in JavaScript. Here's an example of code with this
        // problem: https://github.com/mrdoob/three.js/pull/11183
        if (e.value === 0 && Object.is(e.value, -0)) {
          let kind = Warning;
          if (p.suppressWarningsAboutWeirdCode) {
            kind = Debug;
          }
          // "Comparison with -0 using the %q operator will also match 0"
          p.log.addIDWithNotes(MsgID_JS_EqualsNegativeZero, kind);
          return true;
        }

        // "NaN === NaN" is false in JavaScript
        if (e.value !== e.value) {
          let kind = Warning;
          if (p.suppressWarningsAboutWeirdCode) {
            kind = Debug;
          }
          // "Comparison with NaN using the %q operator here is always %v"
          p.log.addIDWithNotes(MsgID_JS_EqualsNaN, kind);
          return true;
        }
        break;
      }

      case E_ARRAY:
      case E_ARROW:
      case E_CLASS:
      case E_FUNCTION:
      case E_OBJECT:
      case E_REG_EXP:
        // This warning only applies to strict equality because loose equality can
        // cause string conversions. For example, "x == []" is true if x is the
        // empty string. Here's an example of code with this problem:
        // https://github.com/aws/aws-sdk-js/issues/3325
        if (op.length > 2) {
          let kind = Warning;
          if (p.suppressWarningsAboutWeirdCode) {
            kind = Debug;
          }
          // "Comparison using the %q operator here is always %v"
          p.log.addIDWithNotes(MsgID_JS_EqualsNewObject, kind);
          return true;
        }
        break;
    }

    return false;
  },

  // EDot nodes represent a property access. This function may return an
  // expression to replace the property access with. It assumes that the
  // target of the EDot expression has already been visited.
  // Returns [expr, ok].
  maybeRewritePropertyAccess(loc, assignTarget, isDeleteTarget, target, name, nameLoc, isCallTarget, isTemplateTag, preferQuotedKey) {
    const p = this;

    // (bundle only) rewrite property accesses on explicit namespace imports as
    // an identifier, and "module.require()" to "require()"

    // (minify only) simplify statically-determined object literal property accesses

    // Handle references to namespaces or namespace members
    if (target.data === p.tsNamespaceTarget && assignTarget === AssignTargetNone && !isDeleteTarget) {
      const ns = p.tsNamespaceMemberData;
      if (ns !== null && ns.k === TS_NAMESPACE_MEMBER_NAMESPACE) {
        const member = ns.exportedMembers.get(name);
        if (member !== undefined && member.data !== null) {
          const m = member.data;
          switch (m.k) {
            case TS_NAMESPACE_MEMBER_ENUM_NUMBER:
              p.ignoreUsageOfIdentifierInDotChain(target);
              return [p.wrapInlinedEnum(new Expr(new ENumber(m.value), loc), name), true];

            case TS_NAMESPACE_MEMBER_ENUM_STRING:
              p.ignoreUsageOfIdentifierInDotChain(target);
              return [p.wrapInlinedEnum(new Expr(new EString(m.value), loc), name), true];

            case TS_NAMESPACE_MEMBER_NAMESPACE:
              // If this isn't a constant, return a clone of this property access
              // but with the namespace member data associated with it so that
              // more property accesses off of this property access are recognized.
              if (preferQuotedKey || !isIdentifier(name)) {
                p.tsNamespaceTarget = new EIndex(target, new Expr(new EString(name), nameLoc));
              } else {
                p.tsNamespaceTarget = p.dotOrMangledPropVisit(target, name, nameLoc);
              }
              p.tsNamespaceMemberData = member.data;
              return [new Expr(p.tsNamespaceTarget, loc), true];
          }
        }
      }
    }

    // (bundle only) symbol uses due to a property access off of an imported
    // symbol are tracked specially (cross-file TypeScript enum tree shaking)

    // (minify only) "foo".length

    return NOT_REWRITTEN; // [null, false] (callers only read it)
  },
};

const NOT_REWRITTEN = Object.freeze([null, false]);

// Go's "p.isDotOrIndexDefineMatch(e.Target, parts[:last])" recursion without
// allocating sub-slices: only the first "n" entries of "parts" are considered.
function isDotOrIndexDefineMatchN(p, expr, parts, n) {
  const e = expr.data;
  switch (e.k) {
    case E_DOT:
      if (n > 1) {
        // Intermediates must be dot expressions
        const last = n - 1;
        return parts[last] === e.name && isDotOrIndexDefineMatchN(p, e.target, parts, last);
      }
      break;

    case E_INDEX:
      if (n > 1) {
        const str = e.index.data;
        if (str.k === E_STRING) {
          // Intermediates must be dot expressions
          const last = n - 1;
          return parts[last] === str.value && isDotOrIndexDefineMatchN(p, e.target, parts, last);
        }
      }
      break;

    case E_THIS:
      // Allow matching on top-level "this"
      if (!p.fnOnlyDataVisit.isThisNested) {
        return n === 1 && parts[0] === "this";
      }
      break;

    case E_IMPORT_META:
      // Allow matching on "import.meta"
      return n === 2 && parts[0] === "import" && parts[1] === "meta";

    case E_IDENTIFIER:
      // The last expression must be an identifier
      if (n === 1) {
        // The name must match
        const name = p.loadNameFromRef(e.ref);
        if (name !== parts[0]) {
          return false;
        }

        const result = p.findSymbol(expr.loc, name);

        // The "findSymbol" function also marks this symbol as used. But that's
        // never what we want here because we're just peeking to see what kind of
        // symbol it is to see if it's a match. If it's not a match, it will be
        // re-resolved again later and marked as used there. So we don't want to
        // mark it as used twice.
        p.ignoreUsage(result.ref);

        // We must not be in a "with" statement scope
        if (result.isInsideWithScope) {
          return false;
        }

        // The last symbol must be unbound or injected
        return symbolKindIsUnboundOrInjected(p.symbols[refInner(result.ref)].kind);
      }
      break;
  }

  return false;
}

// Returns [stmts, ok]
export function tryToInlineCaseBody(openBraceLoc, stmts, closeBraceLoc) {
  if (stmts.length === 1) {
    const block = stmts[0].data;
    if (block.k === S_BLOCK) {
      return tryToInlineCaseBody(stmts[0].loc, block.stmts, block.closeBraceLoc);
    }
  }

  let caresAboutScope = false;

  loop: for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i].data;
    switch (s.k) {
      case S_EMPTY:
      case S_DIRECTIVE:
      case S_COMMENT:
      case S_EXPR:
      case S_DEBUGGER:
      case S_CONTINUE:
      case S_RETURN:
      case S_THROW:
        // These can all be inlined outside of the switch without problems
        continue;

      case S_LOCAL:
        if (s.kind !== LocalVar) {
          caresAboutScope = true;
        }
        break;

      case S_BREAK:
        if (s.label !== null) {
          // The break label could target this switch, but we don't know whether that's the case or not here
          return [null, false];
        }

        // An unlabeled "break" inside a switch breaks out of the case
        stmts = stmts.slice(0, i);
        break loop;

      default:
        // Assume anything else can't be inlined
        return [null, false];
    }
  }

  // If we still need a scope, wrap the result in a block
  if (caresAboutScope) {
    return [[new Stmt(new SBlock(stmts, closeBraceLoc), openBraceLoc)], true];
  }
  return [stmts, true];
}

export function isUnsightlyPrimitive(data) {
  switch (data.k) {
    case E_BOOLEAN:
    case E_NULL:
    case E_UNDEFINED:
    case E_NUMBER:
    case E_BIG_INT:
    case E_STRING:
      return true;
  }
  return false;
}

// If we encounter a variable initializer that could possibly trigger access to
// a constant declared later on, then we need to end the const local prefix.
// We want to avoid situations like this:
//
//	const x = y; // This is supposed to throw due to TDZ
//	const y = 1;
//
// or this:
//
//	const x = 1;
//	const y = foo(); // This is supposed to throw due to TDZ
//	const z = 2;
//	const foo = () => z;
//
// But a situation like this is ok:
//
//	const x = 1;
//	const y = [() => x + z];
//	const z = 2;
export function isSafeForConstLocalPrefix(expr) {
  const e = expr.data;
  switch (e.k) {
    case E_MISSING:
    case E_STRING:
    case E_REG_EXP:
    case E_BIG_INT:
    case E_FUNCTION:
    case E_ARROW:
      return true;

    case E_ARRAY:
      for (let $i63 = 0, $a63 = e.items; $i63 < $a63.length; $i63++) {
        const item = $a63[$i63];
        if (!isSafeForConstLocalPrefix(item)) {
          return false;
        }
      }
      return true;

    case E_OBJECT:
      // For now just allow "{}" and forbid everything else
      return e.properties.length === 0;
  }

  return false;
}

export function isSimpleParameterList(args, hasRestArg) {
  if (hasRestArg) {
    return false;
  }
  for (const arg of args) {
    if (arg.binding.data.k !== B_IDENTIFIER || arg.defaultOrNil !== null) {
      return false;
    }
  }
  return true;
}

// Returns [loc, ok]
export function fnBodyContainsUseStrict(body) {
  for (const stmt of body) {
    const s = stmt.data;
    switch (s.k) {
      case S_COMMENT:
        continue;
      case S_DIRECTIVE:
        if (s.value === "use strict") {
          return [stmt.loc, true];
        }
        break;
      default:
        return [0, false];
    }
  }
  return [0, false];
}
// generated from js_parser_visit_stmt2.mts by tools/ts-build.mjs; edit that file
