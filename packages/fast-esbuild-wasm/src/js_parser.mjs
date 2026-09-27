// Port of internal/js_parser/js_parser.go lines 1-765 and 17251-end: the
// Parser class (fields + mixins), Options, Parse(), toAST() and the
// import/export scanning. The other parser methods live in the part files
// listed in CONVENTIONS.md section 8 and are mixed into Parser.prototype here.
import { bail, BAIL, LEXER_PANIC } from "./bail.mjs";
import { RANGE_ZERO, mkRange, LineColumnTracker, MsgID_JS_UnsupportedJSXComment, Warning } from "./logger.mjs";
                                          
import { isInsideNodeModules } from "./helpers.mjs";
import {
  InvalidRef,
  LocRef,
  NamespaceAlias,
  SymbolUnbound,
  SymbolHoisted,
  SymbolOther,
  SymbolInjected,
  ImportStmt,
  EvaluationPhase,
  AssertTypeJSON,
  IsUnused,
  ContainsImportStar,
  ContainsDefaultAlias,
  ContainsESModuleAlias,
  refInner,
} from "./ast.mjs";
import {
  Expr,
  Stmt,
  Binding,
  Part,
  AST,
  NamedImport,
  NamedExport,
  DeclaredSymbol,
  SymbolUse,
  ClauseItem,
  Decl,
  SLocal,
  SImport,
  BIdentifier,
  EObject,
  ScopeEntry,
  ScopeMember,
  ImplicitStrictModeTSAlwaysStrict,
  ImplicitStrictModeESM,
  ImplicitStrictModeJSXAutomaticRuntime,
  SloppyMode,
  LocalConst,
  ModuleTypeData,
  ModuleESM_MJS,
  ModuleESM_MTS,
  ModuleESM_PackageJSON,
  moduleTypeIsESM,
  moduleTypeIsCommonJS,
  ExportsNone,
  ExportsESM,
  ExportsCommonJS,
  NSExportPartIndex,
  generateNonUniqueNameFromPath,
  E_DOT,
  E_IDENTIFIER,
  E_IMPORT_IDENTIFIER,
  E_NULL,
  E_BOOLEAN,
  E_STRING,
  E_NUMBER,
  E_BIG_INT,
  ENullShared,
  EBoolean,
  EString,
  ENumber,
  EBigInt,
  S_COMMENT,
  S_DIRECTIVE,
  S_IMPORT,
  S_FUNCTION,
  S_CLASS,
  S_LOCAL,
  S_EXPORT_DEFAULT,
  S_EXPORT_CLAUSE,
  S_EXPORT_STAR,
  S_EXPORT_FROM,
  S_EXPORT_EQUALS,
  S_ENUM,
} from "./js_ast.mjs";
import {
  DefineExpr,
  JSXOptions,
  TSOptions,
  processDefines,
  ModePassThrough,
  ModeBundle,
  PlatformBrowser,
  FormatPreserve,
  TSUnusedImport_KeepValues,
  TSUnusedImport_KeepStmt,
} from "./config.mjs";
import {
  locModuleScope,
  allowExpr,
  fnOrArrowDataParse,
  fnOrArrowDataVisit,
  fnOnlyDataVisit,
  thenCatchChain,
  importsExportsScanResult,
  prependTempRefsOpts,
  parseStmtOpts,
  whyESMUnknown,
  whyESMExportKeyword,
  whyESMImportMeta,
  whyESMTopLevelAwait,
  whyESMFileMJS,
  whyESMFileMTS,
  whyESMTypeModulePackageJSON,
  whyESMImportStatement,
  legacyOctalEscape,
} from "./js_parser_types.mjs";
import { newLexer, TEndOfFile, THashbang, TNull, TThis, TImport, Keywords } from "./js_lexer.mjs";
import { isIdentifier } from "./js_ident.mjs";
import { makeHelperContext, forEachIdentifierBindingInDecls, KeepExportClauses } from "./js_ast_helpers.mjs";
import { parseMethods } from "./js_parser_parse.mjs";
import { parse2Methods } from "./js_parser_parse2.mjs";
import { tsMethods } from "./ts_parser.mjs";
import { visitStmtMethods, duplicateCaseChecker } from "./js_parser_visit_stmt.mjs";
import { visitStmt2Methods } from "./js_parser_visit_stmt2.mjs";
import { visitExprMethods } from "./js_parser_visit_expr.mjs";
import { lowerMethods } from "./js_parser_lower.mjs";

// The parser methods (mixed into Parser.prototype at the end of this file)
                                         
                        
                    
                           
                            
                           
                       
                     
                                               

const RUNTIME_SOURCE_INDEX = 0; // runtime.SourceIndex

// ---------------------------------------------------------------------------
// Options (js_parser.Options with the embedded
// optionsThatSupportStructuralEquality fields flattened)

export class Options {
                               
                          
                              
                           
                            
                            
                       
                                    
                                         
                                        
                                                
                                                    
                        
                       
                           
                               
                               
                                
                             
                             
                                
                                     
                                    
                                       
                                          
                                        
                               
                                
                                
                                                    
  constructor() {
    this.injectedFiles = [];
    this.jsx = new JSXOptions();
    this.tsAlwaysStrict = null;
    this.mangleProps = null;
    this.reserveProps = null;
    this.dropLabels = [];
    this.defines = null; // *config.ProcessedDefines

    this.originalTargetEnv = "";
    this.moduleTypeData = new ModuleTypeData();
    this.unsupportedJSFeatures = 0;
    this.unsupportedJSFeatureOverrides = 0;
    this.unsupportedJSFeatureOverridesMask = 0;

    this.ts = new TSOptions();
    this.mode = ModePassThrough;
    this.platform = PlatformBrowser;
    this.outputFormat = FormatPreserve;
    this.logPathStyle = 0;
    this.codePathStyle = 0;
    this.asciiOnly = false;
    this.keepNames = false;
    this.minifySyntax = false;
    this.minifyIdentifiers = false;
    this.minifyWhitespace = false;
    this.omitRuntimeForTests = false;
    this.omitJSXRuntimeForTests = false;
    this.ignoreDCEAnnotations = false;
    this.treeShaking = false;
    this.dropDebugger = false;
    this.mangleQuoted = false;
    this.decodeHydrateRuntimeStateYarnPnP = false;
  }
  // Go struct copy (Parse() takes Options by value and mutates options.jsx)
  clone() {
    const o = new Options();
    Object.assign(o, this);
    o.jsx = this.jsx.clone();
    return o;
  }
}

export function optionsFromConfig(options) {
  const o = new Options();
  o.injectedFiles = options.injectedFiles;
  o.jsx = options.jsx;
  o.defines = options.defines;
  o.tsAlwaysStrict = options.tsAlwaysStrict;
  o.mangleProps = options.mangleProps;
  o.reserveProps = options.reserveProps;
  o.dropLabels = options.dropLabels;
  o.unsupportedJSFeatures = options.unsupportedJSFeatures;
  o.unsupportedJSFeatureOverrides = options.unsupportedJSFeatureOverrides;
  o.unsupportedJSFeatureOverridesMask = options.unsupportedJSFeatureOverridesMask;
  o.originalTargetEnv = options.originalTargetEnv;
  o.ts = options.ts;
  o.mode = options.mode;
  o.platform = options.platform;
  o.outputFormat = options.outputFormat;
  o.moduleTypeData = options.moduleTypeData || new ModuleTypeData();
  o.asciiOnly = options.asciiOnly;
  o.keepNames = options.keepNames;
  o.minifySyntax = options.minifySyntax;
  o.minifyIdentifiers = options.minifyIdentifiers;
  o.minifyWhitespace = options.minifyWhitespace;
  o.omitRuntimeForTests = options.omitRuntimeForTests;
  o.omitJSXRuntimeForTests = options.omitJSXRuntimeForTests;
  o.ignoreDCEAnnotations = options.ignoreDCEAnnotations;
  o.treeShaking = options.treeShaking;
  o.dropDebugger = options.dropDebugger;
  o.mangleQuoted = options.mangleQuoted;
  o.logPathStyle = options.logPathStyle || 0;
  o.codePathStyle = options.codePathStyle || 0;
  return o;
}

// ---------------------------------------------------------------------------
// The parser. Field order and names follow the Go struct (js_parser.go 36-389).
// Go maps that start out nil are initialised to empty Maps here: every Go read
// of a nil map behaves like an empty Map, and "if m == nil { m = make() }"
// guards simply become no-ops.

export class Parser {
  ;                    
  ;                
  ;                   
  ;                                  
  ;                                              
  ;                                        
  ;                             
  ;                         
  ;                        
  ;                      
  ;                       
  ;                          
  ;                                    
  ;                                            
  ;                                       
  ;                                    
  ;                         
  ;                                   
  ;                                    
  ;                                 
  ;                                     
  ;                                                  
  ;                                                 
  ;                                          
  ;                                           
  ;                              
  ;                                    
  ;                                                     
  ;                                     
  ;                                     
  ;                                                 
  ;                              
  ;                                  
  ;                                           
  ;                                                
  ;                                     
  ;                              
  ;                                  
  ;                                 
  ;                                     
  ;                                     
  ;                            
  ;                                      
  ;                                              
  ;                                   
  ;                                   
  ;                                   
  ;                                            
  ;                                           
  ;                            
  ;                          
  ;                            
  ;                          
  ;                       
  ;                             
  ;                        
  ;                         
  ;                     
  ;                                                 
  ;                        
  ;                               
  ;                                             
  ;                        
  ;                                      
  ;                                    
  ;                                                  
  ;                                
  ;                                
  ;                                        
  ;                  
  ;                              
  ;                                                 
  ;                            
  ;                                    
  ;                            
  ;                             
  ;                               
  ;                          
  ;                          
  ;                         
  ;                             
  ;                          
  ;                         
  ;                         
  ;                            
  ;                                        
  ;                                       
  ;                          
  ;                          
  ;                                        
  ;                            
  ;                               
  ;                                    
  ;                                   
  ;                                       
  ;                                 
  ;                                      
  ;                                  
  ;                                              
  ;                               
  ;                                 
  ;                                               
  ;                                                 
  ;                                    
  ;                                                        
  ;                                                        
  ;                        
  ;                                  
  ;                                         
  ;                                            
  ;                                  
  ;                                    
  ;                                                 
  constructor(log, source, lexer, options) {
    this.options = options;
    this.log = log;
    this.source = source;
    this.tracker = new LineColumnTracker(source);
    this.fnOrArrowDataParse = new fnOrArrowDataParse();
    this.fnOnlyDataVisit = new fnOnlyDataVisit();
    this.allocatedNames = [];
    this.currentScope = null;
    this.currentPart = null;
    this.symbols = [];
    this.astHelpers = null;
    this.tsUseCounts = [];
    this.injectedDefineSymbols = [];
    this.injectedSymbolSources = new Map();
    this.injectedDotNames = new Map();
    this.dropLabelsMap = new Map();
    this.exprComments = null;
    this.mangledProps = new Map();
    this.reservedProps = new Map();
    this.globPatternImports = [];
    this.runtimeImports = new Map(); // map[string]ast.LocRef
    this.duplicateCaseChecker = new duplicateCaseChecker();
    this.unrepresentableIdentifiers = new Map();
    this.legacyOctalLiterals = new Map(); // map[js_ast.E]logger.Range
    this.scopesInOrderForEnum = new Map(); // map[logger.Loc][]scopeOrder
    this.binaryExprStack = [];
    this.binaryExprVisitorPool = []; // JS-only: see acquireBinaryExprVisitor

    this.hoistedRefForSloppyModeBlockFn = new Map();

    this.privateGetters = new Map();
    this.privateSetters = new Map();

    this.refToTSNamespaceMemberData = new Map();
    this.tsNamespaceTarget = null;
    this.tsNamespaceMemberData = null;
    this.emittedNamespaceVars = new Map();
    this.isExportedInsideNamespace = new Map();
    this.localTypeNames = new Map();
    this.tsEnums = new Map(); // map[ast.Ref]map[string]js_ast.TSEnumValue
    this.constValues = new Map(); // map[ast.Ref]js_ast.ConstValue
    this.propDerivedCtorValue = null;
    this.propMethodDecoratorScope = null;

    this.enclosingNamespaceArgRef = null; // *ast.Ref

    this.importRecords = [];
    this.exportStarImportRecords = [];

    this.importItemsForNamespace = new Map(); // map[ast.Ref]namespaceImportItems
    this.isImportItem = new Map();
    this.namedImports = new Map(); // map[ast.Ref]js_ast.NamedImport
    this.namedExports = new Map(); // map[string]js_ast.NamedExport
    this.topLevelSymbolToParts = new Map();
    this.importNamespaceCCMap = new Map();

    this.scopesInOrder = [];

    this.nameToKeep = "";
    this.nameToKeepIsFor = null;

    this.stmtExprValue = null;
    this.callTarget = null;
    this.dotOrIndexTarget = null;
    this.templateTag = null;
    this.deleteTarget = null;
    this.loopBody = null;
    this.suspiciousLogicalOperatorInsideArrow = null;
    this.moduleScope = null;

    this.manifestForYarnPnP = null;
    this.stringLocalsForYarnPnP = new Map();

    this.awaitTarget = null;

    this.thenCatchChain = new thenCatchChain();

    this.relocatedTopLevelVars = [];

    this.lowerAllOfThesePrivateNames = new Map();

    this.tempLetsToDeclare = [];
    this.tempRefsToDeclare = [];
    this.topLevelTempRefsToDeclare = [];

    this.lexer = lexer;

    // JS-only: the object returned by findSymbol() (reused)
    this.findSymbolScratch = null;

    this.parseExperimentalDecoratorNesting = 0;

    this.tempRefCount = 0;
    this.topLevelTempRefCount = 0;

    this.jsxSourceLoc = 0;
    this.jsxSourceLine = 0;
    this.jsxSourceColumn = 0;

    // Go zero value of ast.Ref is {0, 0}; these are always assigned in
    // prepareForVisitPass before being read.
    this.exportsRef = 0;
    this.requireRef = 0;
    this.moduleRef = 0;
    this.importMetaRef = InvalidRef;
    this.promiseRef = InvalidRef;
    this.regExpRef = InvalidRef;
    this.bigIntRef = InvalidRef;
    this.superCtorRef = InvalidRef;

    this.jsxRuntimeImports = new Map();
    this.jsxLegacyImports = new Map();

    this.weakMapRef = InvalidRef;
    this.weakSetRef = InvalidRef;

    this.esmImportStatementKeyword = RANGE_ZERO;
    this.esmImportMeta = RANGE_ZERO;
    this.esmExportKeyword = RANGE_ZERO;
    this.enclosingClassKeyword = RANGE_ZERO;
    this.topLevelAwaitKeyword = RANGE_ZERO;
    this.liveTopLevelAwaitKeyword = RANGE_ZERO;

    this.latestArrowArgLoc = 0;
    this.forbidSuffixAfterAsLoc = 0;
    this.firstJSXElementLoc = -1;

    this.fnOrArrowDataVisit = new fnOrArrowDataVisit();
    this.singleStmtDepth = 0;

    this.afterArrowBodyLoc = -1;

    this.suppressWarningsAboutWeirdCode = false;

    this.isFileConsideredToHaveESMExports = false;
    this.isFileConsideredESM = false;

    this.hasNonLocalExportDeclareInsideNamespace = false;

    this.shouldFoldTypeScriptConstantExpressions = false;

    this.allowIn = true;
    this.hasTopLevelReturn = false;
    this.latestReturnHadSemicolon = false;
    this.messageAboutThisIsUndefined = false;
    this.isControlFlowDead = false;
    this.shouldAddKeyComment = false;

    this.willWrapModuleInTryCatchForUsing = false;
  }
}

export function newParser(log, source, lexer, options) {
  if (options.defines === null) options.defines = processDefines([]);

  const p = new Parser(log, source, lexer, options);

  // Add "/* @__KEY__ */" comments when mangling properties
  p.shouldAddKeyComment = options.mangleProps !== null || options.reserveProps !== null;
  p.suppressWarningsAboutWeirdCode = isInsideNodeModules(source.keyPath.text);

  if (options.dropLabels.length > 0) {
    for (const name of options.dropLabels) p.dropLabelsMap.set(name, true);
  }

  if (!options.minifyWhitespace) p.exprComments = new Map();

  p.astHelpers = makeHelperContext((ref) => p.symbols[refInner(ref)].kind === SymbolUnbound);

  p.pushScopeForParsePass(ScopeEntry, locModuleScope);

  return p;
}

const defaultJSXFactory = ["React", "createElement"];
const defaultJSXFragment = ["React", "Fragment"];
const defaultJSXImportSource = "react";

// Parse returns [ast, ok]. Any error/warning throws BAIL (see logger.mjs).
export function parse(log, source, options)                 {
  options = options.clone();
  try {
    // Default options for JSX elements
    if (options.jsx.factory.parts === null || options.jsx.factory.parts.length === 0) {
      options.jsx.factory = new DefineExpr(null, defaultJSXFactory);
    }
    if ((options.jsx.fragment.parts === null || options.jsx.fragment.parts.length === 0) && options.jsx.fragment.constant === null) {
      options.jsx.fragment = new DefineExpr(null, defaultJSXFragment);
    }
    if (options.jsx.importSource.length === 0) options.jsx.importSource = defaultJSXImportSource;

    const p = newParser(log, source, newLexer(log, source, options.ts), options);

    // Consume a leading hashbang comment
    let hashbang = "";
    if (p.lexer.token === THashbang) {
      hashbang = p.lexer.identifier;
      p.lexer.next();
    }

    // Allow top-level await
    p.fnOrArrowDataParse.await = allowExpr;
    p.fnOrArrowDataParse.isTopLevel = true;

    // Parse the file in the first pass, but do not bind symbols
    const topOpts = new parseStmtOpts();
    topOpts.isModuleScope = true;
    topOpts.allowDirectivePrologue = true;
    let stmts = p.parseStmtsUpTo(TEndOfFile, topOpts);
    p.prepareForVisitPass();

    // Insert a "use strict" directive if "alwaysStrict" is active
    const directives = [];
    const tsAlwaysStrict = p.options.tsAlwaysStrict;
    if (tsAlwaysStrict !== null && tsAlwaysStrict.value) directives.push("use strict");

    // Strip off all leading directives
    {
      let totalCount = 0;
      let keptCount = 0;
      for (const stmt of stmts) {
        const s = stmt.data;
        if (s.k === S_COMMENT) {
          stmts[keptCount] = stmt;
          keptCount++;
          totalCount++;
          continue;
        }
        if (s.k === S_DIRECTIVE) {
          if (p.isStrictMode() && s.legacyOctalLoc > 0) {
            p.markStrictModeFeature(legacyOctalEscape, p.source.rangeOfLegacyOctalEscape(s.legacyOctalLoc), "");
          }
          const directive = s.value;
          // Remove duplicate directives
          if (!directives.includes(directive)) directives.push(directive);
          // Remove this directive from the statement list
          totalCount++;
          continue;
        }
        // Stop when the directive prologue ends
        break;
      }
      if (keptCount < totalCount) {
        stmts = stmts.slice(0, keptCount).concat(stmts.slice(totalCount));
      }
    }

    // Add an empty part for the namespace export that we can fill in later
    const nsExportPart = new Part();
    nsExportPart.canBeRemovedIfUnused = true;

    let before = [nsExportPart];
    let parts = [];
    let after = [];

    // Insert any injected import statements now that symbols have been declared
    if (p.options.injectedFiles.length > 0) bail();

    p.willWrapModuleInTryCatchForUsing = p.shouldLowerUsingDeclarations(stmts);

    // Bind symbols in a second pass over the AST.
    if (!p.options.treeShaking || p.willWrapModuleInTryCatchForUsing) {
      // When tree shaking is disabled, everything comes in a single part
      parts = p.appendPart(parts, stmts);
    } else {
      let preprocessedEnums = null;
      if (p.scopesInOrderForEnum.size > 0) {
        // Preprocess TypeScript enums to improve code generation.
        for (let i = 0; i < stmts.length; i++) {
          const stmt = stmts[i];
          if (stmt.data.k === S_ENUM) {
            if (preprocessedEnums === null) preprocessedEnums = new Map();
            const oldScopesInOrder = p.scopesInOrder;
            p.scopesInOrder = p.scopesInOrderForEnum.get(stmt.loc) ?? [];
            preprocessedEnums.set(i, p.appendPart([], [stmt]));
            p.scopesInOrder = oldScopesInOrder;
          }
        }
      }

      // When tree shaking is enabled, each top-level statement is potentially a separate part
      for (let i = 0; i < stmts.length; i++) {
        const stmt = stmts[i];
        const s = stmt.data;
        switch (s.k) {
          case S_LOCAL:
            // Split up top-level multi-declaration variable statements
            for (let $i23 = 0, $a23 = s.decls; $i23 < $a23.length; $i23++) {
              const decl = $a23[$i23];
              const clone = new SLocal([decl], s.kind, s.isExport, s.wasTSImportEquals);
              parts = p.appendPart(parts, [new Stmt(clone, stmt.loc)]);
            }
            break;

          case S_IMPORT:
          case S_EXPORT_FROM:
          case S_EXPORT_STAR:
            if (p.options.mode !== ModePassThrough) {
              // Move imports (and import-like exports) to the top of the file
              before = p.appendPart(before, [stmt]);
            } else {
              parts = p.appendPart(parts, [stmt]);
            }
            break;

          case S_EXPORT_EQUALS:
            // TypeScript "export = value;" becomes "module.exports = value;"
            after = p.appendPart(after, [stmt]);
            break;

          case S_ENUM: {
            const pre = preprocessedEnums === null ? undefined : preprocessedEnums.get(i);
            if (pre !== undefined) for (const x of pre) parts.push(x);
            const n = (p.scopesInOrderForEnum.get(stmt.loc) ?? []).length;
            p.scopesInOrder = p.scopesInOrder.slice(n);
            break;
          }

          default:
            parts = p.appendPart(parts, [stmt]);
        }
      }
    }

    // Insert a variable for "import.meta" at the top of the file if it was used.
    if (p.importMetaRef !== InvalidRef) {
      const importMetaStmt = new Stmt(
        new SLocal([new Decl(new Binding(new BIdentifier(p.importMetaRef), 0), new Expr(new EObject(), 0))], p.selectLocalKind(LocalConst)),
        0,
      );
      const part = new Part();
      part.stmts = [importMetaStmt];
      part.declaredSymbols = [new DeclaredSymbol(p.importMetaRef, true)];
      part.canBeRemovedIfUnused = true;
      before.push(part);
    }

    // Pop the module scope to apply the "ContainsDirectEval" rules
    p.popScope();

    const result = p.toAST(before, parts, after, hashbang, directives);
    result.sourceMapComment = p.lexer.sourceMappingURL;
    return [result, true];
  } catch (e) {
    if (e === LEXER_PANIC) return [null, false];
    throw e;
  }
}

// LazyExportAST / GlobResolveAST are only used for non-JS loaders and glob
// imports, which the fast path never handles.
export function lazyExportAST() {
  bail();
}
export function globResolveAST() {
  bail();
}

// ParseDefineExpr(text) -> [DefineExpr, E|null]
export function parseDefineExpr(text        )                    {
  if (text === "") return [new DefineExpr(), null];

  // Try a property chain
  let parts = text.split(".");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!isIdentifier(part)) {
      parts = null;
      break;
    }

    // Don't allow most keywords as the identifier
    if (i === 0) {
      const token = Keywords.get(part);
      if (token !== undefined && token !== TNull && token !== TThis && (token !== TImport || parts.length < 2 || parts[1] !== "meta")) {
        parts = null;
        break;
      }
    }
  }
  if (parts !== null) return [new DefineExpr(null, parts), null];

  // Try parsing a value
  const data = parseJSONForDefine(text);
  if (data === null) return [new DefineExpr(), null];

  // Only primitive literals are inlined directly
  switch (data.k) {
    case E_NULL:
    case E_BOOLEAN:
    case E_STRING:
    case E_NUMBER:
    case E_BIG_INT:
      return [new DefineExpr(data), null];
  }

  // If it's not a primitive, return the whole compound JSON value to be injected out-of-line
  return [new DefineExpr(), data];
}

// A minimal stand-in for ParseJSON(..., {IsForDefine: true}) that only handles
// the primitive literals the fast path supports; anything else bails.
function parseJSONForDefine(text) {
  const t = text.trim();
  if (t === "null") return ENullShared;
  if (t === "true") return new EBoolean(true);
  if (t === "false") return new EBoolean(false);
  if (/^"(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"$/.test(t)) return new EString(JSON.parse(t));
  if (/^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(t)) return new ENumber(Number(t));
  bail();
}

// Sort the keys for determinism (Go's sort.Strings sorts by bytes = UTF-8,
// which for strings without surrogates matches UTF-16 order except for
// characters above U+FFFF vs U+E000-U+FFFF; runtime/JSX import names are ASCII)
function sortedKeysOfMapStringLocRef(m) {
  const keys = [...m.keys()];
  keys.sort(compareStringsUTF8);
  return keys;
}

// Byte-wise (UTF-8) string comparison like Go's "<" on strings
export function compareStringsUTF8(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let ca = a.charCodeAt(i);
    let cb = b.charCodeAt(i);
    if (ca !== cb) {
      // Surrogates (U+D800-DFFF) encode code points above U+FFFF, which sort
      // after U+E000-U+FFFF in UTF-8 but before them in UTF-16.
      const sa = ca >= 0xd800 && ca <= 0xdfff;
      const sb = cb >= 0xd800 && cb <= 0xdfff;
      if (sa !== sb) {
        if (sa && cb >= 0xe000) return 1;
        if (sb && ca >= 0xe000) return -1;
      }
      return ca < cb ? -1 : 1;
    }
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Core parser methods

export const coreMethods = {
  recordExport(loc, alias, ref) {
    const p = this;
    if (p.namedExports.has(alias)) {
      // Duplicate exports are an error
      p.log.addErrorWithNotes();
    } else {
      p.namedExports.set(alias, new NamedExport(ref, loc));
    }
  },

  // Returns true if this is an unused TypeScript import-equals statement
  checkForUnusedTSImportEquals(s, result) {
    const p = this;
    if (s.wasTSImportEquals && !s.isExport) {
      const decl = s.decls[0];

      // Skip to the underlying reference
      let value = s.decls[0].valueOrNil;
      while (value.data.k === E_DOT) value = value.data.target;

      // Is this an identifier reference and not a require() call?
      let valueRef = InvalidRef;
      if (value.data.k === E_IDENTIFIER || value.data.k === E_IMPORT_IDENTIFIER) valueRef = value.data.ref;
      if (valueRef !== InvalidRef) {
        // Is this import statement unused?
        const ref = decl.binding.data.ref;
        if (p.symbols[refInner(ref)].useCountEstimate === 0) {
          // Also don't count the referenced identifier
          p.ignoreUsage(valueRef);

          // Continue iterating until a fixed point has been reached.
          result.removedImportEquals = true;
          return true;
        } else {
          result.keptImportEquals = true;
        }
      }
    }
    return false;
  },

  scanForUnusedTSImportEquals(stmts) {
    const p = this;
    const result = new importsExportsScanResult();
    let stmtsEnd = 0;
    for (const stmt of stmts) {
      if (stmt.data.k === S_LOCAL && p.checkForUnusedTSImportEquals(stmt.data, result)) {
        // Remove unused import-equals statements
        continue;
      }
      stmts[stmtsEnd] = stmt;
      stmtsEnd++;
    }
    stmts.length = stmtsEnd;
    result.stmts = stmts;
    return result;
  },

  scanForImportsAndExports(stmts) {
    const p = this;
    const result = new importsExportsScanResult();
    const unusedImportFlags = p.options.ts.config.unusedImportFlags();
    let stmtsEnd = 0;

    outer: for (const stmt of stmts) {
      const s = stmt.data;
      switch (s.k) {
        case S_IMPORT: {
          const record = p.importRecords[s.importRecordIndex];

          // We implement TypeScript's "preserveValueImports" tsconfig.json setting
          const keepUnusedImports =
            p.options.ts.parse && (unusedImportFlags & TSUnusedImport_KeepValues) !== 0 && p.options.mode !== ModeBundle && !p.options.minifyIdentifiers;

          // Forbid non-default imports for JSON import assertions (bundle only)
          if ((record.flags & AssertTypeJSON) !== 0 && p.options.mode === ModeBundle && s.items !== null) bail();

          // TypeScript always trims unused imports.
          if ((p.options.minifySyntax || p.options.ts.parse) && !keepUnusedImports) {
            let foundImports = false;
            let isUnusedInTypeScript = true;

            // Remove the default name if it's unused
            if (s.defaultName !== null) {
              foundImports = true;
              const symbol = p.symbols[refInner(s.defaultName.ref)];

              // TypeScript has a separate definition of unused
              if (
                p.options.ts.parse &&
                (p.tsUseCounts[refInner(s.defaultName.ref)] !== 0 || (p.options.ts.config.unusedImportFlags() & TSUnusedImport_KeepValues) !== 0)
              ) {
                isUnusedInTypeScript = false;
              }

              // Remove the symbol if it's never used outside a dead code region
              if (symbol.useCountEstimate === 0 && (p.options.ts.parse || !p.moduleScope.containsDirectEval)) {
                s.defaultName = null;
              }
            }

            // Remove the star import if it's unused
            if (s.starNameLoc !== null) {
              foundImports = true;
              const symbol = p.symbols[refInner(s.namespaceRef)];

              // TypeScript has a separate definition of unused
              if (
                p.options.ts.parse &&
                (p.tsUseCounts[refInner(s.namespaceRef)] !== 0 || (p.options.ts.config.unusedImportFlags() & TSUnusedImport_KeepValues) !== 0)
              ) {
                isUnusedInTypeScript = false;
              }

              // Remove the symbol if it's never used outside a dead code region
              if (symbol.useCountEstimate === 0 && (p.options.ts.parse || !p.moduleScope.containsDirectEval)) {
                // Make sure we don't remove this if it was used for a property
                // access while bundling
                const importItems = p.importItemsForNamespace.get(s.namespaceRef);
                if (importItems !== undefined && importItems.entries.size === 0) {
                  s.starNameLoc = null;
                }
              }
            }

            // Remove items if they are unused
            if (s.items !== null) {
              foundImports = true;
              let itemsEnd = 0;
              const items = s.items;

              for (const item of items) {
                const symbol = p.symbols[refInner(item.name.ref)];

                // TypeScript has a separate definition of unused
                if (
                  p.options.ts.parse &&
                  (p.tsUseCounts[refInner(item.name.ref)] !== 0 || (p.options.ts.config.unusedImportFlags() & TSUnusedImport_KeepValues) !== 0)
                ) {
                  isUnusedInTypeScript = false;
                }

                // Remove the symbol if it's never used outside a dead code region
                if (symbol.useCountEstimate !== 0 || (!p.options.ts.parse && p.moduleScope.containsDirectEval)) {
                  items[itemsEnd] = item;
                  itemsEnd++;
                }
              }

              // Filter the array by taking a slice
              if (itemsEnd === 0) {
                s.items = null;
              } else {
                items.length = itemsEnd;
              }
            }

            // Omit this statement if we're parsing TypeScript and all imports are unused.
            if (p.options.ts.parse && foundImports && isUnusedInTypeScript && (unusedImportFlags & TSUnusedImport_KeepStmt) === 0) {
              // Ignore import records with a pre-filled source index.
              if (!(record.sourceIndex >= 0) && !(record.copySourceIndex >= 0)) {
                record.flags |= IsUnused;
                continue outer;
              }
            }
          }

          if (p.options.mode !== ModePassThrough) {
            if (s.starNameLoc !== null) {
              // "importItemsForNamespace" has property accesses off the namespace
              const importItems = p.importItemsForNamespace.get(s.namespaceRef);
              if (importItems !== undefined && importItems.entries.size > 0) {
                // Sort keys for determinism
                const sorted = [...importItems.entries.keys()];
                sorted.sort(compareStringsUTF8);

                // Create named imports for these property accesses.
                for (const alias of sorted) {
                  const name = importItems.entries.get(alias);
                  p.namedImports.set(name.ref, new NamedImport(alias, [], name.loc, s.namespaceRef, s.importRecordIndex));

                  // Make sure the printer prints this as a property access
                  p.symbols[refInner(name.ref)].namespaceAlias = new NamespaceAlias(alias, s.namespaceRef);

                  // Also record these automatically-generated top-level namespace alias symbols
                  p.currentPart.declaredSymbols.push(new DeclaredSymbol(name.ref, true));
                }
              }
            }

            if (s.defaultName !== null) {
              p.namedImports.set(s.defaultName.ref, new NamedImport("default", [], s.defaultName.loc, s.namespaceRef, s.importRecordIndex));
            }

            if (s.starNameLoc !== null) {
              p.namedImports.set(s.namespaceRef, new NamedImport("", [], s.starNameLoc, InvalidRef, s.importRecordIndex, true));
            }

            if (s.items !== null) {
              for (let $i24 = 0, $a24 = s.items; $i24 < $a24.length; $i24++) {
                const item = $a24[$i24];
                p.namedImports.set(item.name.ref, new NamedImport(item.alias, [], item.aliasLoc, s.namespaceRef, s.importRecordIndex));
              }
            }
          }

          p.currentPart.importRecordIndices.push(s.importRecordIndex);

          if (s.starNameLoc !== null) record.flags |= ContainsImportStar;

          if (s.defaultName !== null) {
            record.flags |= ContainsDefaultAlias;
          } else if (s.items !== null) {
            for (let $i25 = 0, $a25 = s.items; $i25 < $a25.length; $i25++) {
              const item = $a25[$i25];
              if (item.alias === "default") record.flags |= ContainsDefaultAlias;
              else if (item.alias === "__esModule") record.flags |= ContainsESModuleAlias;
            }
          }
          break;
        }

        case S_FUNCTION:
          if (s.isExport) p.recordExport(s.fn.name.loc, p.symbols[refInner(s.fn.name.ref)].originalName, s.fn.name.ref);
          break;

        case S_CLASS:
          if (s.isExport) p.recordExport(s.class.name.loc, p.symbols[refInner(s.class.name.ref)].originalName, s.class.name.ref);
          break;

        case S_LOCAL:
          if (s.isExport) {
            forEachIdentifierBindingInDecls(s.decls, (loc, b) => {
              p.recordExport(loc, p.symbols[refInner(b.ref)].originalName, b.ref);
            });
          }

          // Remove unused import-equals statements
          if (p.checkForUnusedTSImportEquals(s, result)) continue outer;
          break;

        case S_EXPORT_DEFAULT:
          p.recordExport(s.defaultName.loc, "default", s.defaultName.ref);
          break;

        case S_EXPORT_CLAUSE:
          for (const item of s.items) p.recordExport(item.aliasLoc, item.alias, item.name.ref);
          break;

        case S_EXPORT_STAR: {
          const record = p.importRecords[s.importRecordIndex];
          p.currentPart.importRecordIndices.push(s.importRecordIndex);

          if (s.alias !== null) {
            // "export * as ns from 'path'"
            p.namedImports.set(s.namespaceRef, new NamedImport("", [], s.alias.loc, InvalidRef, s.importRecordIndex, true, true));
            p.recordExport(s.alias.loc, s.alias.originalName, s.namespaceRef);
            record.flags |= ContainsImportStar;
          } else {
            // "export * from 'path'"
            p.exportStarImportRecords.push(s.importRecordIndex);
          }
          break;
        }

        case S_EXPORT_FROM: {
          const record = p.importRecords[s.importRecordIndex];
          p.currentPart.importRecordIndices.push(s.importRecordIndex);

          for (let $i26 = 0, $a26 = s.items; $i26 < $a26.length; $i26++) {
            const item = $a26[$i26];
            // Note that the imported alias is not item.Alias, which is the
            // exported alias.
            p.namedImports.set(item.name.ref, new NamedImport(item.originalName, [], item.name.loc, s.namespaceRef, s.importRecordIndex, false, true));
            p.recordExport(item.name.loc, item.alias, item.name.ref);

            if (item.originalName === "default") record.flags |= ContainsDefaultAlias;
            else if (item.originalName === "__esModule") record.flags |= ContainsESModuleAlias;
          }

          // Forbid non-default imports for JSON import assertions (bundle only)
          if ((record.flags & AssertTypeJSON) !== 0 && p.options.mode === ModeBundle) bail();

          // TypeScript always trims unused re-exports.
          if (p.options.ts.parse && s.items.length === 0 && (unusedImportFlags & TSUnusedImport_KeepStmt) === 0) continue outer;
          break;
        }
      }

      // Filter out statements we skipped over
      stmts[stmtsEnd] = stmt;
      stmtsEnd++;
    }

    stmts.length = stmtsEnd;
    result.stmts = stmts;
    return result;
  },

  appendPart(parts, stmts) {
    const p = this;
    const part = new Part();
    p.currentPart = part;
    part.stmts = p.visitStmtsAndPrependTempRefs(stmts, new prependTempRefsOpts());

    // Sanity check
    if (p.currentScope !== p.moduleScope) throw new Error("Internal error: Scope stack imbalance");

    // Insert any relocated variable statements now
    if (p.relocatedTopLevelVars.length > 0) {
      const alreadyDeclared = new Set();
      for (const local0 of p.relocatedTopLevelVars) {
        // Follow links because "var" declarations may be merged due to hoisting
        let ref = local0.ref;
        for (;;) {
          const link = p.symbols[refInner(ref)].link;
          if (link === InvalidRef) break;
          ref = link;
        }

        // Only declare a given relocated variable once
        if (!alreadyDeclared.has(ref)) {
          alreadyDeclared.add(ref);
          part.stmts.push(new Stmt(new SLocal([new Decl(new Binding(new BIdentifier(ref), local0.loc), null)]), local0.loc));
        }
      }
      p.relocatedTopLevelVars = [];
    }

    if (part.stmts.length > 0) {
      let flags = 0;
      if (p.options.mode === ModePassThrough) {
        // Keep export clauses if we're not doing any format conversion
        flags |= KeepExportClauses;
      }
      part.canBeRemovedIfUnused = p.astHelpers.stmtsCanBeRemovedIfUnused(part.stmts, flags);
      parts.push(part);
    }

    // Reset the state for this part so we don't accidentally mutate it
    p.currentPart = null;
    return parts;
  },

  // Returns [whyESM, notes]
  whyESModule() {
    const p = this;
    if (p.esmExportKeyword.len > 0) return [whyESMExportKeyword, null];
    if (p.esmImportMeta.len > 0) return [whyESMImportMeta, null];
    if (p.topLevelAwaitKeyword.len > 0) return [whyESMTopLevelAwait, null];
    if (p.options.moduleTypeData.type === ModuleESM_MJS) return [whyESMFileMJS, null];
    if (p.options.moduleTypeData.type === ModuleESM_MTS) return [whyESMFileMTS, null];
    if (p.options.moduleTypeData.type === ModuleESM_PackageJSON) return [whyESMTypeModulePackageJSON, null];
    if (p.esmImportStatementKeyword.len > 0) return [whyESMImportStatement, null];
    return [whyESMUnknown, null];
  },

  prepareForVisitPass() {
    const p = this;
    p.pushScopeForVisitPass(ScopeEntry, locModuleScope);
    p.fnOrArrowDataVisit.isOutsideFnOrArrow = true;
    p.moduleScope = p.currentScope;

    // Force-enable strict mode if that's the way TypeScript is configured
    const tsAlwaysStrict = p.options.tsAlwaysStrict;
    if (tsAlwaysStrict !== null && tsAlwaysStrict.value) p.currentScope.strictMode = ImplicitStrictModeTSAlwaysStrict;

    // Determine whether or not this file is ESM
    p.isFileConsideredToHaveESMExports =
      p.esmExportKeyword.len > 0 || p.esmImportMeta.len > 0 || p.topLevelAwaitKeyword.len > 0 || moduleTypeIsESM(p.options.moduleTypeData.type);
    p.isFileConsideredESM = p.isFileConsideredToHaveESMExports || p.esmImportStatementKeyword.len > 0;

    // Legacy HTML comments are not allowed in ESM files
    if (p.isFileConsideredESM && p.lexer.legacyHTMLCommentRange.len > 0) p.log.addErrorWithNotes();

    // ECMAScript modules are always interpreted as strict mode. This has to be
    // done before "hoistSymbols" because strict mode can alter hoisting (!).
    if (p.isFileConsideredESM) p.moduleScope.recursiveSetStrictMode(ImplicitStrictModeESM);

    p.hoistSymbols(p.moduleScope);

    if (p.options.mode !== ModePassThrough) {
      p.requireRef = p.declareCommonJSSymbol(SymbolUnbound, "require");
    } else {
      p.requireRef = p.newSymbol(SymbolUnbound, "require");
    }

    // CommonJS-style exports are only enabled if this isn't using ECMAScript-
    // style exports.
    if (p.options.mode !== ModePassThrough && !p.isFileConsideredToHaveESMExports) {
      // CommonJS-style exports
      p.exportsRef = p.declareCommonJSSymbol(SymbolHoisted, "exports");
      p.moduleRef = p.declareCommonJSSymbol(SymbolHoisted, "module");
    } else {
      // ESM-style exports
      p.exportsRef = p.newSymbol(SymbolHoisted, "exports");
      p.moduleRef = p.newSymbol(SymbolHoisted, "module");
    }

    // Handle "@jsx" and "@jsxFrag" pragmas now that lexing is done
    if (p.options.jsx.parse) {
      const jsxRuntime = p.lexer.jsxRuntimePragmaComment;
      if (jsxRuntime.text !== "") {
        if (jsxRuntime.text === "automatic") {
          p.options.jsx.automaticRuntime = true;
        } else if (jsxRuntime.text === "classic") {
          p.options.jsx.automaticRuntime = false;
        } else {
          p.log.addIDWithNotes(MsgID_JS_UnsupportedJSXComment, Warning);
        }
      }

      const jsxFactory = p.lexer.jsxFactoryPragmaComment;
      if (jsxFactory.text !== "") {
        if (p.options.jsx.automaticRuntime) {
          p.log.addID(MsgID_JS_UnsupportedJSXComment, Warning);
        } else {
          const $d67 = parseDefineExpr(jsxFactory.text);
          const expr = $d67[0];
          if (expr.parts !== null && expr.parts.length > 0) p.options.jsx.factory = expr;
          else p.log.addID(MsgID_JS_UnsupportedJSXComment, Warning);
        }
      }

      const jsxFragment = p.lexer.jsxFragmentPragmaComment;
      if (jsxFragment.text !== "") {
        if (p.options.jsx.automaticRuntime) {
          p.log.addID(MsgID_JS_UnsupportedJSXComment, Warning);
        } else {
          const $d68 = parseDefineExpr(jsxFragment.text);
          const expr = $d68[0];
          if ((expr.parts !== null && expr.parts.length > 0) || expr.constant !== null) p.options.jsx.fragment = expr;
          else p.log.addID(MsgID_JS_UnsupportedJSXComment, Warning);
        }
      }

      const jsxImportSource = p.lexer.jsxImportSourcePragmaComment;
      if (jsxImportSource.text !== "") {
        if (!p.options.jsx.automaticRuntime) {
          p.log.addIDWithNotes(MsgID_JS_UnsupportedJSXComment, Warning);
        } else {
          p.options.jsx.importSource = jsxImportSource.text;
        }
      }
    }

    // Force-enable strict mode if the JSX "automatic" runtime is enabled and
    // there is at least one JSX element.
    if (p.currentScope.strictMode === SloppyMode && p.options.jsx.automaticRuntime && p.firstJSXElementLoc !== -1) {
      p.currentScope.strictMode = ImplicitStrictModeJSXAutomaticRuntime;
    }
  },

  declareCommonJSSymbol(kind, name) {
    const p = this;
    const member = p.moduleScope.members.get(name);

    // If the code declared this symbol using "var name", then this is actually
    // not a collision.
    if (member !== undefined && p.symbols[refInner(member.ref)].kind === SymbolHoisted && kind === SymbolHoisted && !p.isFileConsideredToHaveESMExports) {
      return member.ref;
    }

    // Create a new symbol if we didn't merge with an existing one above
    const ref = p.newSymbol(kind, name);

    // If the variable wasn't declared, declare it now.
    if (member === undefined) {
      p.moduleScope.members.set(name, new ScopeMember(ref, -1));
      return ref;
    }

    // If the variable was declared, then it shadows this symbol.
    p.moduleScope.generated.push(ref);
    return ref;
  },

  // Minify-only
  computeCharacterFrequency() {
    return null;
  },

  // Returns [parts, importRecordIndex]
  generateImportStmt(path, pathRange, imports, parts, symbols, sourceIndex, copySourceIndex) {
    const p = this;
    if (pathRange.len === 0) {
      let isFirst = true;
      let loc = pathRange.loc;
      for (const it of symbols.values()) {
        if (isFirst || it.loc < loc) loc = it.loc;
        isFirst = false;
      }
      pathRange = mkRange(loc, pathRange.len);
    }

    const namespaceRef = p.newSymbol(SymbolOther, "import_" + generateNonUniqueNameFromPath(path));
    p.moduleScope.generated.push(namespaceRef);
    const declaredSymbols = new Array(1 + imports.length);
    const clauseItems = new Array(imports.length);
    const importRecordIndex = p.addImportRecord(ImportStmt, EvaluationPhase, pathRange, path, null, 0);
    if (sourceIndex !== null) p.importRecords[importRecordIndex].sourceIndex = sourceIndex;
    if (copySourceIndex !== null) p.importRecords[importRecordIndex].copySourceIndex = copySourceIndex;
    declaredSymbols[0] = new DeclaredSymbol(namespaceRef, true);

    // Create per-import information
    for (let i = 0; i < imports.length; i++) {
      const alias = imports[i];
      const it = symbols.get(alias) ?? new LocRef(0, 0);
      declaredSymbols[i + 1] = new DeclaredSymbol(it.ref, true);
      clauseItems[i] = new ClauseItem(alias, "", it.loc, new LocRef(it.loc, it.ref));
      p.isImportItem.set(it.ref, true);
      p.namedImports.set(it.ref, new NamedImport(alias, [], it.loc, namespaceRef, importRecordIndex));
    }

    // Append a single import to the end of the file
    const part = new Part();
    part.declaredSymbols = declaredSymbols;
    part.importRecordIndices = [importRecordIndex];
    part.stmts = [new Stmt(new SImport(null, clauseItems, null, namespaceRef, importRecordIndex, true), pathRange.loc)];
    parts.push(part);
    return [parts, importRecordIndex];
  },

  toAST(before, parts, after, hashbang, directives) {
    const p = this;

    // Insert an import statement for any runtime imports we generated
    if (p.runtimeImports.size > 0 && !p.options.omitRuntimeForTests) {
      const keys = sortedKeysOfMapStringLocRef(p.runtimeImports);
      [before] = p.generateImportStmt("<runtime>", RANGE_ZERO, keys, before, p.runtimeImports, RUNTIME_SOURCE_INDEX, null);
    }

    // Insert an import statement for any jsx runtime imports we generated
    if (p.jsxRuntimeImports.size > 0 && !p.options.omitJSXRuntimeForTests) {
      const keys = sortedKeysOfMapStringLocRef(p.jsxRuntimeImports);

      // Determine the runtime source and whether it's prod or dev
      let path = p.options.jsx.importSource;
      if (p.options.jsx.development) path = path + "/jsx-dev-runtime";
      else path = path + "/jsx-runtime";

      [before] = p.generateImportStmt(path, RANGE_ZERO, keys, before, p.jsxRuntimeImports, null, null);
    }

    // Insert an import statement for any legacy jsx imports we generated (i.e., createElement)
    if (p.jsxLegacyImports.size > 0 && !p.options.omitJSXRuntimeForTests) {
      const keys = sortedKeysOfMapStringLocRef(p.jsxLegacyImports);
      const path = p.options.jsx.importSource;
      [before] = p.generateImportStmt(path, RANGE_ZERO, keys, before, p.jsxLegacyImports, null, null);
    }

    // Insert imports for each glob pattern (bundling only)
    if (p.globPatternImports.length > 0) bail();

    // Generated imports are inserted before other code
    if (before.length > 0) parts = before.concat(parts);
    for (const x of after) parts.push(x);

    // Handle import paths after the whole file has been visited
    let keptImportEquals = false;
    let removedImportEquals = false;
    let partsEnd = 0;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex];
      p.currentPart = part;
      const result = p.scanForImportsAndExports(part.stmts);
      p.currentPart = null;
      part.stmts = result.stmts;
      keptImportEquals = keptImportEquals || result.keptImportEquals;
      removedImportEquals = removedImportEquals || result.removedImportEquals;

      if (part.stmts.length > 0 || partIndex === NSExportPartIndex) {
        if (p.moduleScope.containsDirectEval && part.declaredSymbols.length > 0) {
          // If this file contains a direct call to "eval()", all parts that
          // declare top-level symbols must be kept.
          part.canBeRemovedIfUnused = false;
        }
        parts[partsEnd] = part;
        partsEnd++;
      }
    }
    parts.length = partsEnd;

    // We need to iterate multiple times if an import-equals statement was
    // removed and there are more import-equals statements that may be removed.
    while (keptImportEquals && removedImportEquals) {
      keptImportEquals = false;
      removedImportEquals = false;
      let partsEnd = 0;
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex];
        const result = p.scanForUnusedTSImportEquals(part.stmts);
        part.stmts = result.stmts;
        keptImportEquals = keptImportEquals || result.keptImportEquals;
        removedImportEquals = removedImportEquals || result.removedImportEquals;
        if (part.stmts.length > 0 || partIndex === NSExportPartIndex) {
          parts[partsEnd] = part;
          partsEnd++;
        }
      }
      parts.length = partsEnd;
    }

    // Do a second pass for exported items now that imported items are filled out
    for (const part of parts) {
      for (let $i27 = 0, $a27 = part.stmts; $i27 < $a27.length; $i27++) {
        const stmt = $a27[$i27];
        if (stmt.data.k === S_EXPORT_CLAUSE) {
          for (let $i28 = 0, $a28 = stmt.data.items; $i28 < $a28.length; $i28++) {
            const item = $a28[$i28];
            // Mark re-exported imports as such
            const namedImport = p.namedImports.get(item.name.ref);
            if (namedImport !== undefined) {
              const clone = namedImport.clone();
              clone.isExported = true;
              p.namedImports.set(item.name.ref, clone);
            }
          }
        }
      }
    }

    // Analyze cross-part dependencies for tree shaking and code splitting
    {
      // Map locals to parts
      p.topLevelSymbolToParts = new Map();
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        for (const declared of parts[partIndex].declaredSymbols) {
          if (declared.isTopLevel) {
            // If this symbol was merged, use the symbol at the end of the
            // linked list in the map.
            let ref = declared.ref;
            while (p.symbols[refInner(ref)].link !== InvalidRef) ref = p.symbols[refInner(ref)].link;
            let list = p.topLevelSymbolToParts.get(ref);
            if (list === undefined) p.topLevelSymbolToParts.set(ref, (list = []));
            list.push(partIndex);
          }
        }
      }

      // Pulling in the exports of this module always pulls in the export part
      let list = p.topLevelSymbolToParts.get(p.exportsRef);
      if (list === undefined) p.topLevelSymbolToParts.set(p.exportsRef, (list = []));
      list.push(NSExportPartIndex);
    }

    // Make a wrapper symbol in case we need to be wrapped in a closure
    const wrapperRef = p.newSymbol(SymbolOther, "require_" + p.source.identifierName);

    // Nested scope slots are only assigned when minifying identifiers
    const nestedScopeSlotCounts = [0, 0, 0, 0];

    let exportsKind = ExportsNone;
    const usesExportsRef = p.symbols[refInner(p.exportsRef)].useCountEstimate > 0;
    const usesModuleRef = p.symbols[refInner(p.moduleRef)].useCountEstimate > 0;

    if (p.esmExportKeyword.len > 0 || p.esmImportMeta.len > 0 || p.topLevelAwaitKeyword.len > 0) {
      exportsKind = ExportsESM;
    } else if (usesExportsRef || usesModuleRef || p.hasTopLevelReturn) {
      exportsKind = ExportsCommonJS;
    } else if (moduleTypeIsCommonJS(p.options.moduleTypeData.type)) {
      exportsKind = ExportsCommonJS;
    } else if (moduleTypeIsESM(p.options.moduleTypeData.type)) {
      exportsKind = ExportsESM;
    } else if (p.esmImportStatementKeyword.len > 0) {
      // Treat unknown modules containing an import statement as ESM.
      exportsKind = ExportsESM;
    }

    const ast = new AST();
    ast.parts = parts;
    ast.moduleTypeData = p.options.moduleTypeData;
    ast.moduleScope = p.moduleScope;
    ast.charFreq = p.computeCharacterFrequency();
    ast.symbols = p.symbols;
    ast.exportsRef = p.exportsRef;
    ast.moduleRef = p.moduleRef;
    ast.wrapperRef = wrapperRef;
    ast.hashbang = hashbang;
    ast.directives = directives;
    ast.namedImports = p.namedImports;
    ast.namedExports = p.namedExports;
    ast.tsEnums = p.tsEnums;
    ast.constValues = p.constValues;
    ast.exprComments = p.exprComments;
    ast.nestedScopeSlotCounts = nestedScopeSlotCounts;
    ast.topLevelSymbolToPartsFromParser = p.topLevelSymbolToParts;
    ast.exportStarImportRecords = p.exportStarImportRecords;
    ast.importRecords = p.importRecords;
    ast.approximateLineCount = p.lexer.approximateNewlineCount + 1;
    ast.mangledProps = p.mangledProps;
    ast.reservedProps = p.reservedProps;
    ast.manifestForYarnPnP = p.manifestForYarnPnP;

    // CommonJS features
    ast.usesExportsRef = usesExportsRef;
    ast.usesModuleRef = usesModuleRef;
    ast.exportsKind = exportsKind;

    // ES6 features
    ast.exportKeyword = p.esmExportKeyword;
    ast.topLevelAwaitKeyword = p.topLevelAwaitKeyword;
    ast.liveTopLevelAwaitKeyword = p.liveTopLevelAwaitKeyword;
    return ast;
  },
};

Object.assign(
  Parser.prototype,
  parseMethods,
  parse2Methods,
  tsMethods,
  visitStmtMethods,
  visitStmt2Methods,
  visitExprMethods,
  lowerMethods,
  coreMethods,
);

export { BAIL };
// generated from js_parser.mts by tools/ts-build.mjs; edit that file
