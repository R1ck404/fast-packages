// Port of internal/js_parser/js_parser.go lines 10393-13276: visitAndAppendStmt
// (every statement kind), minifySwitchStmt, visitClass, visitArgs, define
// instantiation, equality/typeof warnings and maybeRewritePropertyAccess.
import { goQuote } from "./gostd.mjs";
import { GoPanic } from "./gopanic.mjs";
import {
  jsFeatureHas,
  AsyncAwait,
  AsyncGenerator,
  ExportStarAs,
  ForAwait,
  TopLevelAwait,
  UnicodeEscapes,
  Using,
} from "./compat.mjs";
import {
  mkRange,
  RANGE_ZERO,
  Warning,
  Debug,
  MsgID_JS_ImpossibleTypeof,
  MsgID_JS_EqualsNegativeZero,
  MsgID_JS_EqualsNaN,
  MsgID_JS_EqualsNewObject,
  MsgID_JS_AssertTypeJSON,
  MsgData,
  LineColumnTracker,
} from "./logger.mjs";
import { stringArraysEqual, containsNonBMPCodePoint } from "./helpers.mjs";
import {
  InvalidRef,
  LocRef,
  refInner,
  SymbolImport,
  NamespaceAlias,
  ImportItemGenerated,
  AssertTypeJSON,
  SymbolUnbound,
  SymbolOther,
  SymbolLabel,
  SymbolConst,
  SymbolClassInComputedPropertyKey,
  PrivateSymbolMustBeLowered,
  RemoveOverwrittenFunctionDeclaration,
  DidKeepName,
  IsEmptyFunction,
  IsIdentityFunction,
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
  Property,
  ClassStaticBlock,
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
  ENameOfSymbol,
  ENumber,
  EPrivateIdentifier,
  EString,
  EUnary,
  ENullShared,
  EThisShared,
  EUndefinedShared,
  SBlock,
  SEmptyShared,
  SExportClause,
  SExpr,
  SFor,
  SIf,
  SImport,
  SLabel,
  SLocal,
  SReturn,
  ConstValueNone,
  SymbolUse,
  exprToConstValue,
  AssignTargetNone,
  BinOpStrictEq,
  UnOpTypeof,
  UnOpVoid,
  OptionalChainNone,
  LocalVar,
  LocalLet,
  LocalConst,
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
  PropertySpread,
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
  E_IMPORT_IDENTIFIER,
  E_IF,
  E_IMPORT_META,
  E_INDEX,
  E_INLINED_ENUM,
  E_MISSING,
  E_NAME_OF_SYMBOL,
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
import {
  ModeBundle,
  ModePassThrough,
  formatKeepESMImportExportSyntax,
  prettyPrintTargetEnvironment,
} from "./config.mjs";
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
  PrimitiveUnknown,
  PrimitiveNull,
  PrimitiveUndefined,
  PrimitiveString,
  NoSideEffects,
  stringToEquivalentNumberValue,
  isPrimitiveLiteral,
  checkEqualityIfNoSideEffects,
  StrictEquality,
  forEachIdentifierBindingInDecls,
  ReturnCanBeRemovedIfUnused,
} from "./js_ast_helpers.mjs";
import { isIdentifier } from "./js_ident.mjs";
import { rangeOfIdentifier, StrictModeReservedWords } from "./js_lexer.mjs";
import {
  analyzeSwitchCasesForLiveness,
  caseBodyCouldHaveFallThrough,
  stmtsToSingleStmt,
  stmtCaresAboutScope,
  stmtsCareAboutScope,
  shouldKeepStmtInDeadControlFlow,
  mangleFor,
  appendIfOrLabelBodyPreservingScope,
} from "./js_parser_visit_stmt.mjs";

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
              const r = rangeOfIdentifier(p.source, item.name.loc);
              p.log.addError(p.tracker, r, goQuote(name) + " is not declared in this file");
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

        // "export * as ns from 'path'"
        if (s.alias !== null) {
          // "import * as ns from 'path'"
          // "export {ns}"
          if (jsFeatureHas(p.options.unsupportedJSFeatures, ExportStarAs)) {
            p.recordUsage(s.namespaceRef);
            stmts.push(
              new Stmt(new SImport(null, null, s.alias.loc, s.namespaceRef, s.importRecordIndex), stmt.loc),
              new Stmt(
                new SExportClause(
                  [new ClauseItem(s.alias.originalName, s.alias.originalName, s.alias.loc, new LocRef(s.alias.loc, s.namespaceRef))],
                  true,
                ),
                stmt.loc,
              ),
            );
            return stmts;
          }
        }
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

          case S_FUNCTION: {
            // If we need to preserve the name but there is no name, generate a name
            let name = "";
            if (p.options.keepNames) {
              if (s2.fn.name === null) {
                const clone = new LocRef(s.defaultName.loc, s.defaultName.ref);
                s2.fn.name = clone;
                name = "default";
              } else {
                name = p.symbols[refInner(s2.fn.name.ref)].originalName;
              }
            }

            p.visitFn(s2.fn, s2.fn.openParenLoc, new visitFnOpts());
            stmts.push(stmt);

            // Optionally preserve the name
            if (p.options.keepNames) {
              p.symbols[refInner(s2.fn.name.ref)].flags |= DidKeepName;
              const fn = new Expr(new EIdentifier(s2.fn.name.ref), s2.fn.name.loc);
              stmts.push(p.keepClassOrFnSymbolName(s2.fn.name.loc, fn, name));
            }
            break;
          }

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
            throw new GoPanic("Internal error");
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
          const r = rangeOfIdentifier(p.source, stmt.loc);
          p.log.addError(p.tracker, r, 'Cannot use "break" here:');
        }
        break;

      case S_CONTINUE:
        if (s.label !== null) {
          const name = p.loadNameFromRef(s.label.ref);
          const $d196 = p.findLabelSymbol(s.label.loc, name);
          const ref = $d196[0], isLoop = $d196[1], ok = $d196[2];
          s.label = new LocRef(s.label.loc, ref);
          if (ok && !isLoop) {
            const r = rangeOfIdentifier(p.source, s.label.loc);
            p.log.addError(p.tracker, r, 'Cannot continue to label "' + name + '"');
          }
        } else if (!p.fnOrArrowDataVisit.isInsideLoop) {
          const r = rangeOfIdentifier(p.source, stmt.loc);
          p.log.addError(p.tracker, r, 'Cannot use "continue" here:');
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
            p.log.addErrorWithNotes(p.tracker, rangeOfIdentifier(p.source, s.name.loc), "Duplicate label " + goQuote(name), [
              p.tracker.msgData(rangeOfIdentifier(p.source, scope.label.loc), "The original label " + goQuote(name) + " is here:"),
            ]);
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

        if (p.options.minifySyntax) {
          // Optimize "x: break x" which some people apparently write by hand
          const child = s.stmt.data;
          if (child.k === S_BREAK && child.label !== null && child.label.ref === s.name.ref) {
            return stmts;
          }

          // Remove the label if it's not necessary
          if (p.symbols[refInner(ref)].useCountEstimate === 0) {
            return appendIfOrLabelBodyPreservingScope(stmts, s.stmt);
          }
        }

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
          if (
            p.isControlFlowDead &&
            (jsFeatureHas(p.options.unsupportedJSFeatures, TopLevelAwait) || !formatKeepESMImportExportSyntax(p.options.outputFormat))
          ) {
            s.kind = LocalUsing;
          } else {
            p.liveTopLevelAwaitKeyword = mkRange(stmt.loc, 5);
            p.markSyntaxFeature(TopLevelAwait, mkRange(stmt.loc, 5));
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

            // Initializing to undefined is implicit, but be careful to not
            // accidentally cause a syntax error or behavior change by removing
            // the value
            //
            // Good:
            //   "let a = undefined;" => "let a;"
            //
            // Bad (a syntax error):
            //   "let {} = undefined;" => "let {};"
            //
            // Bad (a behavior change):
            //   "a = 123; var a = undefined;" => "a = 123; var a;"
            //
            if (p.options.minifySyntax && s.kind === LocalLet) {
              if (d.binding.data.k === B_IDENTIFIER) {
                if (d.valueOrNil.data.k === E_UNDEFINED) {
                  d.valueOrNil = null;
                }
              }
            }

            // Yarn's PnP data may be stored in a variable: https://github.com/yarnpkg/berry/pull/4320
            if (p.options.decodeHydrateRuntimeStateYarnPnP) {
              const str = d.valueOrNil !== null ? d.valueOrNil.data : null;
              if (str !== null && str.k === E_STRING) {
                const id = d.binding.data;
                if (id.k === B_IDENTIFIER) {
                  p.stringLocalsForYarnPnP.set(id.ref, { value: str.value, loc: d.valueOrNil.loc });
                }
              }
            }
          }

          // Attempt to continue the const local prefix
          if (p.options.minifySyntax && !p.currentScope.isAfterConstLocalPrefix) {
            const id = d.binding.data;
            if (id.k === B_IDENTIFIER) {
              if (s.kind === LocalConst && d.valueOrNil !== null) {
                const value = exprToConstValue(d.valueOrNil);
                if (value.kind !== ConstValueNone) {
                  if (p.constValues === null) {
                    p.constValues = new Map();
                  }
                  p.constValues.set(id.ref, value);
                  continue;
                }
              }

              if (d.valueOrNil !== null && !isSafeForConstLocalPrefix(d.valueOrNil)) {
                p.currentScope.isAfterConstLocalPrefix = true;
              }
            } else {
              // A non-identifier binding ends the const local prefix
              p.currentScope.isAfterConstLocalPrefix = true;
            }
          }
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

        s.decls = p.lowerObjectRestInDecls(s.decls);

        // Optimization: Avoid unnecessary "using" machinery by changing ones
        // initialized to "null" or "undefined" into a normal variable. Note that
        // "await using" still needs the "await", so we can't do it for those.
        if (p.options.minifySyntax && s.kind === LocalUsing) {
          s.kind = LocalConst;
          for (let i = 0, a = s.decls; i < a.length; i++) {
            const decl = a[i];
            const t = decl.valueOrNil === null ? PrimitiveUnknown : knownPrimitiveType(decl.valueOrNil.data);
            if (t !== PrimitiveNull && t !== PrimitiveUndefined) {
              s.kind = LocalUsing;
              break;
            }
          }
        }

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
            const notes = p.whyESModule()[1];
            p.log.addErrorWithNotes(p.tracker, rangeOfIdentifier(p.source, stmt.loc), "Top-level return cannot be used inside an ECMAScript module", notes);
          } else {
            p.hasTopLevelReturn = true;
          }
        }

        if (s.valueOrNil !== null) {
          s.valueOrNil = p.visitExpr(s.valueOrNil);

          // Returning undefined is implicit except when inside an async generator
          // function, where "return undefined" behaves like "return await undefined"
          // but just "return" has no "await".
          if (p.options.minifySyntax && (!p.fnOrArrowDataVisit.isAsync || !p.fnOrArrowDataVisit.isGenerator)) {
            if (s.valueOrNil.data.k === E_UNDEFINED) {
              s.valueOrNil = null;
            }
          }
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

        if (p.options.minifySyntax) {
          if (s.stmts.length === 1 && !stmtCaresAboutScope(s.stmts[0])) {
            // Unwrap blocks containing a single statement
            stmt = s.stmts[0];
          } else if (s.stmts.length === 0) {
            // Trim empty blocks
            stmt = new Stmt(SEmptyShared, stmt.loc);
          }
        }
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

        if (p.options.minifySyntax) {
          s.test = p.astHelpers.simplifyBooleanExpr(s.test);

          // A true value is implied
          let testOrNil = s.test;
          const $b = toBooleanWithSideEffects(s.test.data);
          if ($b[2] && $b[0] && $b[1] === NoSideEffects) {
            testOrNil = null;
          }

          // "while (a) {}" => "for (;a;) {}"
          const forS = new SFor(null, testOrNil, null, s.body, s.isSingleLineBody);
          mangleFor(forS);
          stmt = new Stmt(forS, stmt.loc);
        }
        break;

      case S_DO_WHILE:
        s.body = p.visitLoopBody(s.body);
        s.test = p.visitExpr(s.test);

        if (p.options.minifySyntax) {
          s.test = p.astHelpers.simplifyBooleanExpr(s.test);
        }
        break;

      case S_IF: {
        s.test = p.visitExpr(s.test);

        if (p.options.minifySyntax) {
          s.test = p.astHelpers.simplifyBooleanExpr(s.test);
        }

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

          // Trim unnecessary "else" clauses
          if (p.options.minifySyntax) {
            if (s.noOrNil.data.k === S_EMPTY) {
              s.noOrNil = null;
            }
          }
        }

        if (p.options.minifySyntax) {
          return p.mangleIf(stmts, stmt.loc, s);
        }
        break;
      }

      case S_FOR: {
        p.pushScopeForVisitPass(ScopeBlock, stmt.loc);
        if (s.initOrNil !== null) {
          p.visitForLoopInit(s.initOrNil, false);
        }

        if (s.testOrNil !== null) {
          s.testOrNil = p.visitExpr(s.testOrNil);

          if (p.options.minifySyntax) {
            s.testOrNil = p.astHelpers.simplifyBooleanExpr(s.testOrNil);

            // A true value is implied
            const $b = toBooleanWithSideEffects(s.testOrNil.data);
            if ($b[2] && $b[0] && $b[1] === NoSideEffects) {
              s.testOrNil = null;
            }
          }
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

        if (p.options.minifySyntax) {
          mangleFor(s);
        }
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

        p.lowerObjectRestInForLoopInit(s.init, s);
        break;
      }

      case S_FOR_OF: {
        // Silently remove unsupported top-level "await" in dead code branches
        if (s.await.len > 0 && p.fnOrArrowDataVisit.isOutsideFnOrArrow) {
          if (
            p.isControlFlowDead &&
            (jsFeatureHas(p.options.unsupportedJSFeatures, TopLevelAwait) || !formatKeepESMImportExportSyntax(p.options.outputFormat))
          ) {
            s.await = RANGE_ZERO;
          } else {
            p.liveTopLevelAwaitKeyword = s.await;
            p.markSyntaxFeature(TopLevelAwait, s.await);
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
          const unsupported = p.options.unsupportedJSFeatures;
          if (local.kind === LocalUsing && jsFeatureHas(unsupported, Using)) {
            p.lowerUsingDeclarationInForOf(s.init.loc, local, s);
          } else if (local.kind === LocalAwaitUsing) {
            if (p.fnOrArrowDataVisit.isOutsideFnOrArrow) {
              if (p.isControlFlowDead && (jsFeatureHas(unsupported, TopLevelAwait) || !formatKeepESMImportExportSyntax(p.options.outputFormat))) {
                // Silently remove unsupported top-level "await" in dead code branches
                local.kind = LocalUsing;
              } else {
                p.liveTopLevelAwaitKeyword = mkRange(s.init.loc, 5);
                p.markSyntaxFeature(TopLevelAwait, p.liveTopLevelAwaitKeyword);
              }
              if (jsFeatureHas(unsupported, Using)) {
                p.lowerUsingDeclarationInForOf(s.init.loc, local, s);
              }
            } else if (
              jsFeatureHas(unsupported, Using) ||
              jsFeatureHas(unsupported, AsyncAwait) ||
              (jsFeatureHas(unsupported, AsyncGenerator) && p.fnOrArrowDataVisit.isGenerator)
            ) {
              p.lowerUsingDeclarationInForOf(s.init.loc, local, s);
            }
          }
        }

        p.popScope();

        p.lowerObjectRestInForLoopInit(s.init, s);

        // Lower "for await" if it's unsupported if it's in a lowered async generator
        if (
          s.await.len > 0 &&
          (jsFeatureHas(p.options.unsupportedJSFeatures, ForAwait) ||
            (jsFeatureHas(p.options.unsupportedJSFeatures, AsyncGenerator) && p.fnOrArrowDataVisit.isGenerator))
        ) {
          return p.lowerForAwaitLoop(stmt.loc, s, stmts);
        }
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

          p.lowerObjectRestInCatchBinding(s.catch);
          p.popScope();

          p.isControlFlowDead = old;
        }

        if (s.finally !== null) {
          p.pushScopeForVisitPass(ScopeBlock, s.finally.loc);
          s.finally.block.stmts = p.visitStmts(s.finally.block.stmts, stmtsNormal);
          p.popScope();
        }

        if (p.options.minifySyntax) {
          if (s.block.stmts.length === 0) {
            // Try to drop the whole thing if the try body is empty
            let keepCatch = false;

            // Certain "catch" blocks need to be preserved:
            //
            //   try {} catch { let foo } // Can be removed
            //   try {} catch { var foo } // Must be kept
            //
            if (s.catch !== null) {
              for (let i = 0, a = s.catch.block.stmts; i < a.length; i++) {
                if (shouldKeepStmtInDeadControlFlow(a[i])) {
                  keepCatch = true;
                  break;
                }
              }
            }

            // Make sure to preserve the "finally" block if present
            if (!keepCatch) {
              if (s.finally === null) {
                return stmts;
              }
              if (!stmtsCareAboutScope(s.finally.block.stmts)) {
                for (let i = 0, a = s.finally.block.stmts; i < a.length; i++) stmts.push(a[i]);
                return stmts;
              }
              const block = s.finally.block.clone(); // Go copies the SBlock struct
              stmt = new Stmt(block, s.finally.loc);
            }
          } else if (s.finally !== null && s.finally.block.stmts.length === 0) {
            if (s.catch !== null) {
              // Just remove the "finally" block if there's a "catch"
              s.finally = null;
            } else {
              // Otherwise, try to unwrap the whole "try" statement
              if (!stmtsCareAboutScope(s.block.stmts)) {
                for (let i = 0, a = s.block.stmts; i < a.length; i++) stmts.push(a[i]);
                return stmts;
              }
              const block = s.block.clone(); // Go copies the SBlock struct
              stmt = new Stmt(block, s.finally.loc);
            }
          }
        }
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

          // Filter out this case when minifying if it's known to be dead. Visiting
          // the body above should already have removed any statements that can be
          // removed safely, so if the body isn't empty then that means it contains
          // some statements that can't be removed safely (e.g. a hoisted "var").
          // So don't remove this case if the body isn't empty.
          if (p.options.minifySyntax && isAlwaysDead && c.body.length === 0) {
            continue;
          }

          // Make sure the assignment to the body above is preserved
          s.cases[end] = c;
          end++;
        }
        s.cases.length = end;

        p.fnOrArrowDataVisit.isInsideSwitch = oldIsInsideSwitch;
        p.popScope();

        // Unwrap switch statements in dead code
        if (p.options.minifySyntax && p.isControlFlowDead) {
          for (let i = 0, a = s.cases; i < a.length; i++) {
            for (let j = 0, b = a[i].body; j < b.length; j++) stmts.push(b[j]);
          }
          return stmts;
        }

        if (p.options.minifySyntax) {
          return p.minifySwitchStmt(stmt.loc, s, stmts);
        }
        break;
      }

      case S_FUNCTION: {
        p.visitFn(s.fn, s.fn.openParenLoc, new visitFnOpts());

        // Strip this function declaration if it was overwritten
        if ((p.symbols[refInner(s.fn.name.ref)].flags & RemoveOverwrittenFunctionDeclaration) !== 0 && !s.isExport) {
          return stmts;
        }

        if (p.options.minifySyntax && !s.fn.isGenerator && !s.fn.isAsync && !s.fn.hasRestArg && s.fn.name !== null) {
          if (s.fn.body.block.stmts.length === 0) {
            // Mark if this function is an empty function
            let hasSideEffectFreeArguments = true;
            for (let i = 0, a = s.fn.args; i < a.length; i++) {
              if (a[i].binding.data.k !== B_IDENTIFIER) {
                hasSideEffectFreeArguments = false;
                break;
              }
            }
            if (hasSideEffectFreeArguments) {
              p.symbols[refInner(s.fn.name.ref)].flags |= IsEmptyFunction;
            }
          } else if (s.fn.args.length === 1 && s.fn.body.block.stmts.length === 1) {
            // Mark if this function is an identity function
            const arg = s.fn.args[0];
            if (arg.defaultOrNil === null) {
              const id = arg.binding.data;
              if (id.k === B_IDENTIFIER) {
                const ret = s.fn.body.block.stmts[0].data;
                if (ret.k === S_RETURN) {
                  if (ret.valueOrNil !== null && ret.valueOrNil.data.k === E_IDENTIFIER && id.ref === ret.valueOrNil.data.ref) {
                    p.symbols[refInner(s.fn.name.ref)].flags |= IsIdentityFunction;
                  }
                }
              }
            }
          }
        }

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

        // Optionally preserve the name
        if (p.options.keepNames) {
          const symbol = p.symbols[refInner(s.fn.name.ref)];
          symbol.flags |= DidKeepName;
          const fn = new Expr(new EIdentifier(s.fn.name.ref), s.fn.name.loc);
          stmts.push(p.keepClassOrFnSymbolName(s.fn.name.loc, fn, symbol.originalName));
        }
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

          if (p.options.minifySyntax && isIdentifier(name)) {
            // "Enum.Name = value"
            assignTarget = assign(new Expr(new EDot(new Expr(new EIdentifier(s.arg), value.loc), name, value.loc), value.loc), valueOrNil);
          } else {
            // "Enum['Name'] = value"
            assignTarget = assign(
              new Expr(new EIndex(new Expr(new EIdentifier(s.arg), value.loc), new Expr(new EString(value.name), value.loc)), value.loc),
              valueOrNil,
            );
          }
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
        throw new GoPanic("Internal error");
    }

    stmts.push(stmt);
    return stmts;
  },

  // Only called when minifySyntax is enabled
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
      if (p.options.keepNames) {
        nameToKeep = p.symbols[refInner(class_.name.ref)].originalName;
      }
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
        let key = $d209[0];
        property.key = key;

        // Re-allow using the class name after visiting a computed key
        if ((property.flags & PropertyIsComputed) !== 0 && class_.name !== null) {
          p.symbols[refInner(result.innerClassNameRef)].kind = SymbolConst;
        }

        if (p.options.minifySyntax) {
          const inlined = key.data;
          if (inlined.k === E_INLINED_ENUM) {
            switch (inlined.value.data.k) {
              case E_STRING:
              case E_NUMBER:
                key = new Expr(inlined.value.data, key.loc);
                property.key = new Expr(key.data, property.key.loc);
                break;
            }
          }
          const k = key.data;
          switch (k.k) {
            case E_NUMBER:
            case E_NAME_OF_SYMBOL:
              // "class { [123] }" => "class { 123 }"
              property.flags &= ~PropertyIsComputed;
              break;
            case E_STRING: {
              const $n = stringToEquivalentNumberValue(k.value);
              const numberValue = $n[0];
              if ($n[1] && numberValue >= 0) {
                // "class { '123' }" => "class { 123 }"
                property.key = new Expr(new ENumber(numberValue), property.key.loc);
                property.flags &= ~PropertyIsComputed;
              } else if ((property.flags & PropertyIsComputed) !== 0) {
                // "class {['x'] = y}" => "class {'x' = y}"
                let isInvalidConstructor = false;
                if (k.value === "constructor") {
                  if (!propertyKindIsMethodDefinition(property.kind)) {
                    // "constructor" is an invalid name for both instance and static fields
                    isInvalidConstructor = true;
                  } else if ((property.flags & PropertyIsStatic) === 0) {
                    // Calling an instance method "constructor" is problematic so avoid that too
                    isInvalidConstructor = true;
                  }
                }

                // A static property must not be called "prototype"
                const isInvalidPrototype = (property.flags & PropertyIsStatic) !== 0 && k.value === "prototype";

                if (!isInvalidConstructor && !isInvalidPrototype) {
                  property.flags &= ~PropertyIsComputed;
                }
              }
              break;
            }
          }
        }
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

    // Implement name keeping using a static block at the start of the class body
    if (p.options.keepNames && nameToKeep !== "") {
      let propertyPreventsKeepNames = false;
      for (let i = 0, a = class_.properties; i < a.length; i++) {
        const prop = a[i];
        // A static property called "name" shadows the automatically-generated name
        if ((prop.flags & PropertyIsStatic) !== 0) {
          if (prop.key !== null && prop.key.data.k === E_STRING && prop.key.data.value === "name") {
            propertyPreventsKeepNames = true;
            break;
          }
        }
      }
      if (!propertyPreventsKeepNames) {
        let this_;
        if (classLoweringInfo.lowerAllStaticFields) {
          p.recordUsage(result.innerClassNameRef);
          this_ = new Expr(new EIdentifier(result.innerClassNameRef), class_.bodyLoc);
        } else {
          this_ = new Expr(EThisShared, class_.bodyLoc);
        }
        const staticBlock = new Property();
        staticBlock.kind = PropertyClassStaticBlock;
        staticBlock.classStaticBlock = new ClassStaticBlock(
          new SBlock([p.keepClassOrFnSymbolName(class_.bodyLoc, this_, nameToKeep)]),
          class_.bodyLoc,
        );
        const properties = [staticBlock];
        for (let i = 0, a = class_.properties; i < a.length; i++) properties.push(a[i]);
        class_.properties = properties;
      }
    }

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
      throw new GoPanic("Internal error");
    }

    return result;
  },

  visitArgs(args, opts) {
    const p = this;
    let duplicateArgCheck = null;
    const $d211 = fnBodyContainsUseStrict(opts.body);
    const useStrictLoc = $d211[0], hasUseStrict = $d211[1];
    const hasSimpleArgs = isSimpleParameterList(args, opts.hasRestArg);

    // Section 15.2.1 Static Semantics: Early Errors: "It is a Syntax Error if
    // FunctionBodyContainsUseStrict of FunctionBody is true and
    // IsSimpleParameterList of FormalParameters is false."
    if (hasUseStrict && !hasSimpleArgs) {
      p.log.addError(p.tracker, p.source.rangeOfString(useStrictLoc), 'Cannot use a "use strict" directive in a function with a non-simple parameter list');
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
      } else if (p.isMangledProp(part)) {
        value = new Expr(new EIndex(value, new Expr(new ENameOfSymbol(p.symbolForMangledProp(part)), loc)), loc);
      } else {
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
      const where = p.injectedSymbolSources !== null ? p.injectedSymbolSources.get(ref) : undefined;
      if (where !== undefined) {
        const r = rangeOfIdentifier(p.source, loc);
        const tracker = new LineColumnTracker(where.source);
        const joined = name.parts.join(".");
        p.log.addErrorWithNotes(p.tracker, r, "Cannot assign to " + goQuote(joined) + " because it's an import from an injected file", [
          tracker.msgData(
            rangeOfIdentifier(where.source, where.loc),
            "The symbol " + goQuote(joined) + " was exported from " + goQuote(where.source.prettyPaths.select(p.options.logPathStyle)) + " here:",
          ),
        ]);
      }
    }

    return new Expr(new EIdentifier(ref), loc);
  },

  checkForUnrepresentableIdentifier(loc, name) {
    const p = this;
    if (p.options.asciiOnly && jsFeatureHas(p.options.unsupportedJSFeatures, UnicodeEscapes) && containsNonBMPCodePoint(name)) {
      if (p.unrepresentableIdentifiers === null) {
        p.unrepresentableIdentifiers = new Map();
      }
      if (!p.unrepresentableIdentifiers.get(name)) {
        p.unrepresentableIdentifiers.set(name, true);
        const where = prettyPrintTargetEnvironment(p.options.originalTargetEnv, p.options.unsupportedJSFeatureOverridesMask);
        const r = rangeOfIdentifier(p.source, loc);
        p.log.addError(p.tracker, r, goQuote(name) + " cannot be escaped in " + where + ' but you can set the charset to "utf8" to allow unescaped Unicode characters');
      }
    }
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
            const r = p.source.rangeOfString(b.loc);
            const text = 'The "typeof" operator will never evaluate to ' + goQuote(value);
            let notes = null;
            if (value === "null") {
              notes = [
                new MsgData(
                  null,
                  null,
                  'The expression "typeof x" actually evaluates to "object" in JavaScript, not "null". ' + 'You need to use "x === null" to test for null.',
                ),
              ];
            }
            p.log.addIDWithNotes(MsgID_JS_ImpossibleTypeof, kind, p.tracker, r, text, notes);
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
          const r = mkRange(value.loc, 0);
          if (r.loc < p.source.contents.length && p.source.contents.charCodeAt(r.loc) === 45) {
            const zeroRange = p.source.rangeOfNumber(r.loc + 1);
            r.len = zeroRange.len + 1;
          }
          let text = "Comparison with -0 using the " + goQuote(op) + " operator will also match 0";
          if (op === "case") {
            text = "Comparison with -0 using a case clause will also match 0";
          }
          let kind = Warning;
          if (p.suppressWarningsAboutWeirdCode) {
            kind = Debug;
          }
          p.log.addIDWithNotes(MsgID_JS_EqualsNegativeZero, kind, p.tracker, r, text, [
            new MsgData(
              null,
              null,
              'Floating-point equality is defined such that 0 and -0 are equal, so "x === -0" returns true for both 0 and -0. ' +
                'You need to use "Object.is(x, -0)" instead to test for -0.',
            ),
          ]);
          return true;
        }

        // "NaN === NaN" is false in JavaScript
        if (e.value !== e.value) {
          let text = "Comparison with NaN using the " + goQuote(op) + " operator here is always " + (op.charCodeAt(0) === 33);
          if (op === "case") {
            text = "This case clause will never be evaluated because equality with NaN is always false";
          }
          const r = p.source.rangeOfOperatorBefore(afterOpLoc, op);
          let kind = Warning;
          if (p.suppressWarningsAboutWeirdCode) {
            kind = Debug;
          }
          p.log.addIDWithNotes(MsgID_JS_EqualsNaN, kind, p.tracker, r, text, [
            new MsgData(
              null,
              null,
              'Floating-point equality is defined such that NaN is never equal to anything, so "x === NaN" always returns false. ' +
                'You need to use "Number.isNaN(x)" instead to test for NaN.',
            ),
          ]);
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
          let text = "Comparison using the " + goQuote(op) + " operator here is always " + (op.charCodeAt(0) === 33);
          if (op === "case") {
            text = "This case clause will never be evaluated because the comparison is always false";
          }
          const r = p.source.rangeOfOperatorBefore(afterOpLoc, op);
          let kind = Warning;
          if (p.suppressWarningsAboutWeirdCode) {
            kind = Debug;
          }
          p.log.addIDWithNotes(MsgID_JS_EqualsNewObject, kind, p.tracker, r, text, [
            new MsgData(
              null,
              null,
              "Equality with a new object is always false in JavaScript because the equality operator tests object identity. " +
                "You need to write code to compare the contents of the object instead. " +
                'For example, use "Array.isArray(x) && x.length === 0" instead of "x === []" to test for an empty array.',
            ),
          ]);
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

    if (target.data.k === E_IDENTIFIER) {
      const id = target.data;
      // Rewrite property accesses on explicit namespace imports as an identifier.
      // This lets us replace them easily in the printer to rebind them to
      // something else without paying the cost of a whole-tree traversal during
      // module linking just to rewrite these EDot expressions.
      if (p.options.mode === ModeBundle) {
        const importItems = p.importItemsForNamespace.get(id.ref);
        if (importItems !== undefined) {
          // Cache translation so each property access resolves to the same import
          let item = importItems.entries.get(name);
          if (item === undefined) {
            // Replace non-default imports with "undefined" for JSON import assertions
            const record = p.importRecords[importItems.importRecordIndex];
            if ((record.flags & AssertTypeJSON) !== 0 && name !== "default") {
              let kind = Warning;
              if (p.suppressWarningsAboutWeirdCode) {
                kind = Debug;
              }
              p.log.addIDWithNotes(
                MsgID_JS_AssertTypeJSON,
                kind,
                p.tracker,
                rangeOfIdentifier(p.source, nameLoc),
                "Non-default import " + goQuote(name) + " is undefined with a JSON import assertion",
                p.notesForAssertTypeJSON(record, name),
              );
              p.ignoreUsage(id.ref);
              return [new Expr(EUndefinedShared, loc), true];
            }

            // Generate a new import item symbol in the module scope
            item = new LocRef(nameLoc, p.newSymbol(SymbolImport, name));
            p.moduleScope.generated.push(item.ref);

            // Link the namespace import and the import item together
            importItems.entries.set(name, item);
            p.isImportItem.set(item.ref, true);

            const symbol = p.symbols[refInner(item.ref)];
            if (p.options.mode === ModePassThrough) {
              // Make sure the printer prints this as a property access
              symbol.namespaceAlias = new NamespaceAlias(name, id.ref);
            } else {
              // Mark this as generated in case it's missing. We don't want to
              // generate errors for missing import items that are automatically
              // generated.
              symbol.importItemStatus = ImportItemGenerated;
            }
          }

          // Undo the usage count for the namespace itself. This is used later
          // to detect whether the namespace symbol has ever been "captured"
          // or whether it has just been used to read properties off of.
          //
          // The benefit of doing this is that if both this module and the
          // imported module end up in the same module group and the namespace
          // symbol has never been captured, then we don't need to generate
          // any code for the namespace at all.
          p.ignoreUsage(id.ref);

          // Track how many times we've referenced this symbol
          p.recordUsage(item.ref);
          return [
            p.handleIdentifier(
              nameLoc,
              new EIdentifier(item.ref),
              new identifierOpts(
                assignTarget,
                isCallTarget,
                isDeleteTarget,
                preferQuotedKey,

                // If this expression is used as the target of a call expression, make
                // sure the value of "this" is preserved.
                false, // wasOriginallyIdentifier
              ),
            ),
            true,
          ];
        }

        // Rewrite "module.require()" to "require()" for Webpack compatibility.
        // See https://github.com/webpack/webpack/pull/7750 for more info.
        if (isCallTarget && id.ref === p.moduleRef && name === "require") {
          p.ignoreUsage(p.moduleRef);

          // This uses "require" instead of a reference to our "__require"
          // function so that the code coming up that detects calls to
          // "require" will recognize it.
          p.recordUsage(p.requireRef);
          return [new Expr(new EIdentifier(p.requireRef), nameLoc), true];
        }
      }
    }

    // Attempt to simplify statically-determined object literal property accesses
    if (!isCallTarget && !isTemplateTag && p.options.minifySyntax && assignTarget === AssignTargetNone) {
      const object = target.data;
      if (object.k === E_OBJECT) {
        let replace = null;
        let hasProtoNull = false;
        let isUnsafe = false;

        // Check that doing this is safe
        for (let i = 0, a = object.properties; i < a.length; i++) {
          const prop = a[i];

          // "{ ...a }.a" must be preserved
          // "new ({ a() {} }.a)" must throw
          // "{ get a() {} }.a" must be preserved
          // "{ set a(b) {} }.a = 1" must be preserved
          // "{ a: 1, [String.fromCharCode(97)]: 2 }.a" must be 2
          if (prop.kind === PropertySpread || (prop.flags & PropertyIsComputed) !== 0 || propertyKindIsMethodDefinition(prop.kind)) {
            isUnsafe = true;
            break;
          }

          // Do not attempt to compare against numeric keys
          const key = prop.key.data;
          if (key.k !== E_STRING) {
            isUnsafe = true;
            break;
          }

          // The "__proto__" key has special behavior
          if (key.value === "__proto__") {
            if (prop.valueOrNil !== null && prop.valueOrNil.data.k === E_NULL) {
              // Replacing "{__proto__: null}.a" with undefined should be safe
              hasProtoNull = true;
            }
          }

          // This entire object literal must have no side effects
          if (!p.astHelpers.exprCanBeRemovedIfUnused(prop.valueOrNil)) {
            isUnsafe = true;
            break;
          }

          // Note that we need to take the last value if there are duplicate keys
          if (key.value === name) {
            replace = prop.valueOrNil;
          }
        }

        if (!isUnsafe) {
          // If the key was found, return the value for that key. Note
          // that "{__proto__: null}.__proto__" is undefined, not null.
          if (replace !== null && name !== "__proto__") {
            return [replace, true];
          }

          // We can only return "undefined" when a key is missing if the prototype is null
          if (hasProtoNull) {
            return [new Expr(EUndefinedShared, target.loc), true];
          }
        }
      }
    }

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

    // Symbol uses due to a property access off of an imported symbol are tracked
    // specially. This lets us do tree shaking for cross-file TypeScript enums.
    if (p.options.mode === ModeBundle && !p.isControlFlowDead) {
      const id = target.data;
      if (id.k === E_IMPORT_IDENTIFIER) {
        // Remove the normal symbol use
        // (JS-only: the map values are updated in place like recordUsage does)
        const symbolUses = p.currentPart.symbolUses;
        const use = symbolUses.get(id.ref);
        const countEstimate = ((use === undefined ? 0 : use.countEstimate) - 1) >>> 0; // uint32
        if (countEstimate === 0) {
          symbolUses.delete(id.ref);
        } else if (use === undefined) {
          symbolUses.set(id.ref, new SymbolUse(countEstimate));
        } else {
          use.countEstimate = countEstimate;
        }

        // Add a special symbol use instead
        let importSymbolPropertyUses = p.currentPart.importSymbolPropertyUses;
        if (importSymbolPropertyUses === null) {
          importSymbolPropertyUses = new Map();
          p.currentPart.importSymbolPropertyUses = importSymbolPropertyUses;
        }
        let properties = importSymbolPropertyUses.get(id.ref);
        if (properties === undefined) {
          properties = new Map();
          importSymbolPropertyUses.set(id.ref, properties);
        }
        const propUse = properties.get(name);
        if (propUse === undefined) {
          properties.set(name, new SymbolUse(1));
        } else {
          propUse.countEstimate = (propUse.countEstimate + 1) >>> 0; // uint32
        }
      }
    }

    // Minify "foo".length
    if (p.options.minifySyntax && assignTarget === AssignTargetNone) {
      const t = target.data;
      switch (t.k) {
        case E_STRING:
          if (name === "length") {
            return [new Expr(new ENumber(t.value.length), loc), true];
          }
          break;
        case E_INLINED_ENUM: {
          const s = t.value.data;
          if (s.k === E_STRING && name === "length") {
            return [new Expr(new ENumber(s.value.length), loc), true];
          }
          break;
        }
      }
    }

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
