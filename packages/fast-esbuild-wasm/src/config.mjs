// Port of the parts of internal/config (config.go, globals.go) used by the
// transform pipeline.
import { EUndefinedShared, ENumber } from "./js_ast.mjs";
import { stringArraysEqual } from "./helpers.mjs";
import { KNOWN_GLOBALS } from "./config_globals.mjs";

export class DefineExpr {
                        
                     
                                      
  constructor(constant = null, parts = null, injectedDefineIndex = -1) {
    this.constant = constant; // js_ast.E or null
    this.parts = parts; // []string or null
    this.injectedDefineIndex = injectedDefineIndex; // Index32
  }
}

export class JSXOptions {
  ;                           
  ;                            
  ;                      
  ;                         
  ;                                 
  ;                            
  ;                            
  ;                            
  constructor(
    factory = new DefineExpr(),
    fragment = new DefineExpr(),
    parse = false,
    preserve = false,
    automaticRuntime = false,
    importSource = "",
    development = false,
    sideEffects = false,
  ) {
    this.factory = factory;
    this.fragment = fragment;
    this.parse = parse;
    this.preserve = preserve;
    this.automaticRuntime = automaticRuntime;
    this.importSource = importSource;
    this.development = development;
    this.sideEffects = sideEffects;
  }
  clone() {
    return new JSXOptions(
      this.factory,
      this.fragment,
      this.parse,
      this.preserve,
      this.automaticRuntime,
      this.importSource,
      this.development,
      this.sideEffects,
    );
  }
}

// TSJSX
export const TSJSXNone = 0;
export const TSJSXPreserve = 1;
export const TSJSXReactNative = 2;
export const TSJSXReact = 3;
export const TSJSXReactJSX = 4;
export const TSJSXReactJSXDev = 5;

// MaybeBool
export const Unspecified = 0;
export const True = 1;
export const False = 2;

// TSImportsNotUsedAsValues
export const TSImportsNotUsedAsValues_None = 0;
export const TSImportsNotUsedAsValues_Remove = 1;
export const TSImportsNotUsedAsValues_Preserve = 2;
export const TSImportsNotUsedAsValues_Error = 3;

// TSUnusedImportFlags
export const TSUnusedImport_KeepStmt = 1;
export const TSUnusedImport_KeepValues = 2;

// TSTarget
export const TSTargetUnspecified = 0;
export const TSTargetBelowES2022 = 1;
export const TSTargetAtOrAboveES2022 = 2;

export class TSConfig {
                                         
                                         
                                       
                         
                                          
                                       
  constructor(
    experimentalDecorators = Unspecified,
    importsNotUsedAsValues = TSImportsNotUsedAsValues_None,
    preserveValueImports = Unspecified,
    target = TSTargetUnspecified,
    useDefineForClassFields = Unspecified,
    verbatimModuleSyntax = Unspecified,
  ) {
    this.experimentalDecorators = experimentalDecorators;
    this.importsNotUsedAsValues = importsNotUsedAsValues;
    this.preserveValueImports = preserveValueImports;
    this.target = target;
    this.useDefineForClassFields = useDefineForClassFields;
    this.verbatimModuleSyntax = verbatimModuleSyntax;
  }
  unusedImportFlags() {
    let flags = 0;
    if (this.verbatimModuleSyntax === True) return TSUnusedImport_KeepStmt | TSUnusedImport_KeepValues;
    if (this.preserveValueImports === True) flags |= TSUnusedImport_KeepValues;
    if (
      this.importsNotUsedAsValues === TSImportsNotUsedAsValues_Preserve ||
      this.importsNotUsedAsValues === TSImportsNotUsedAsValues_Error
    ) {
      flags |= TSUnusedImport_KeepStmt;
    }
    return flags;
  }
}

export class TSOptions {
  ;                        
  ;                      
  ;                                    
  constructor(config = new TSConfig(), parse = false, noAmbiguousLessThan = false) {
    this.config = config;
    this.parse = parse;
    this.noAmbiguousLessThan = noAmbiguousLessThan;
  }
}

export class TSAlwaysStrict {
  ;                    
  ;                   
  ;                  
  ;                      
  constructor(name = "", source = null, range = null, value = false) {
    this.name = name;
    this.source = source;
    this.range = range;
    this.value = value;
  }
}

// Platform
export const PlatformBrowser = 0;
export const PlatformNode = 1;
export const PlatformNeutral = 2;

// SourceMap
export const SourceMapNone = 0;
export const SourceMapInline = 1;
export const SourceMapLinkedWithComment = 2;
export const SourceMapExternalWithoutComment = 3;
export const SourceMapInlineAndExternal = 4;

// LegalComments
export const LegalCommentsInline = 0;
export const LegalCommentsNone = 1;
export const LegalCommentsEndOfFile = 2;
export const LegalCommentsLinkedWithComment = 3;
export const LegalCommentsExternalWithoutComment = 4;

export function legalCommentsHasExternalFile(lc) {
  return lc === LegalCommentsLinkedWithComment || lc === LegalCommentsExternalWithoutComment;
}

// Loader
export const LoaderNone = 0;
export const LoaderBase64 = 1;
export const LoaderBinary = 2;
export const LoaderCopy = 3;
export const LoaderCSS = 4;
export const LoaderDataURL = 5;
export const LoaderDefault = 6;
export const LoaderEmpty = 7;
export const LoaderFile = 8;
export const LoaderGlobalCSS = 9;
export const LoaderJS = 10;
export const LoaderJSON = 11;
export const LoaderWithTypeJSON = 12;
export const LoaderJSX = 13;
export const LoaderLocalCSS = 14;
export const LoaderText = 15;
export const LoaderTS = 16;
export const LoaderTSNoAmbiguousLessThan = 17;
export const LoaderTSX = 18;

export const LoaderToString = [
  "none",
  "base64",
  "binary",
  "copy",
  "css",
  "dataurl",
  "default",
  "empty",
  "file",
  "global-css",
  "js",
  "json",
  "json",
  "jsx",
  "local-css",
  "text",
  "ts",
  "ts",
  "tsx",
];

export function loaderIsTypeScript(loader) {
  return loader === LoaderTS || loader === LoaderTSNoAmbiguousLessThan || loader === LoaderTSX;
}
export function loaderIsCSS(loader) {
  return loader === LoaderCSS || loader === LoaderGlobalCSS || loader === LoaderLocalCSS;
}

// Format
export const FormatPreserve = 0;
export const FormatIIFE = 1;
export const FormatCommonJS = 2;
export const FormatESModule = 3;

export function formatKeepESMImportExportSyntax(f) {
  return f === FormatPreserve || f === FormatESModule;
}
export function formatString(f) {
  switch (f) {
    case FormatIIFE:
      return "iife";
    case FormatCommonJS:
      return "cjs";
    case FormatESModule:
      return "esm";
  }
  return "";
}

export class StdinInfo {
  ;                        
  ;                          
  ;                             
  ;                      
  constructor(contents = "", sourceFile = "", absResolveDir = "", loader = LoaderNone) {
    this.contents = contents;
    this.sourceFile = sourceFile;
    this.absResolveDir = absResolveDir;
    this.loader = loader;
  }
}

// APICall
export const BuildCall = 0;
export const TransformCall = 1;

// Mode
export const ModePassThrough = 0;
export const ModeConvertFormat = 1;
export const ModeBundle = 2;

export function shouldCallRuntimeRequire(mode, outputFormat) {
  return mode === ModeBundle && outputFormat !== FormatCommonJS;
}

// The subset of config.Options that the transform pipeline reads.
export class Options {
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
  constructor() {
    this.moduleTypeData = null; // js_ast.ModuleTypeData
    this.defines = null; // ProcessedDefines
    this.tsAlwaysStrict = null;
    this.mangleProps = null;
    this.reserveProps = null;
    this.originalTargetEnv = "";
    this.dropLabels = [];
    this.absOutputFile = "";
    this.globalName = [];
    this.tsConfigRaw = "";
    this.injectedDefines = [];
    this.injectedFiles = [];
    this.jsBanner = "";
    this.jsFooter = "";
    this.sourceRoot = "";
    this.stdin = null; // StdinInfo
    this.jsx = new JSXOptions();
    this.lineLimit = 0;
    this.unsupportedJSFeatures = 0; // always 0 in the fast path (target esnext)
    this.unsupportedJSFeatureOverrides = 0;
    this.unsupportedJSFeatureOverridesMask = 0;
    this.ts = new TSOptions();
    this.mode = ModePassThrough;
    this.minifyWhitespace = false;
    this.minifyIdentifiers = false;
    this.minifySyntax = false;
    this.profilerNames = false;
    this.codeSplitting = false;
    this.legalComments = LegalCommentsInline;
    this.asciiOnly = false;
    this.keepNames = false;
    this.ignoreDCEAnnotations = false;
    this.treeShaking = false;
    this.dropDebugger = false;
    this.mangleQuoted = false;
    this.platform = PlatformBrowser;
    this.outputFormat = FormatPreserve;
    this.sourceMap = SourceMapNone;
    this.excludeSourcesContent = false;
    this.omitRuntimeForTests = false;
    this.omitJSXRuntimeForTests = false;
  }
}

export class InjectedDefine {
  ;                 
  ;                    
  ;                   
  constructor(data = null, name = "", source = null) {
    this.data = data;
    this.name = name;
    this.source = source;
  }
}

export class InjectedFile {
  ;                      
  ;                          
  ;                   
  ;                             
  constructor(exports_ = [], defineName = "", source = null, isCopyLoader = false) {
    this.exports = exports_;
    this.defineName = defineName;
    this.source = source;
    this.isCopyLoader = isCopyLoader;
  }
}

// ---------------------------------------------------------------------------
// globals.go

export class DefineData {
  ;                     
  ;                       
  ;                     
  constructor(keyParts = null, defineExpr = null, flags = 0) {
    this.keyParts = keyParts; // []string
    this.defineExpr = defineExpr; // *DefineExpr
    this.flags = flags;
  }
}

// DefineFlags
export const CanBeRemovedIfUnused = 1 << 0;
export const CallCanBeUnwrappedIfUnused = 1 << 1;
export const MethodCallsMustBeReplacedWithUndefined = 1 << 2;
export const IsSymbolInstance = 1 << 3;

function mergeDefineData(old, new_) {
  return new DefineData(new_.keyParts, new_.defineExpr, new_.flags | old.flags);
}

export class ProcessedDefines {
  ;                                        
  ;                                 
  constructor(identifierDefines = new Map(), dotDefines = new Map()) {
    this.identifierDefines = identifierDefines; // Map<string, DefineData>
    this.dotDefines = dotDefines; // Map<string, DefineData[]>
  }
}

let processedGlobals = null;

export function processDefines(userDefines) {
  // Optimization: reuse known globals if there are no user-specified defines
  const hasUserDefines = userDefines.length !== 0;
  if (!hasUserDefines && processedGlobals !== null) return processedGlobals;

  const result = new ProcessedDefines();

  // Mark these property accesses as free of side effects.
  for (const parts of KNOWN_GLOBALS) {
    const tail = parts[parts.length - 1];
    if (parts.length === 1) {
      result.identifierDefines.set(tail, new DefineData(null, null, CanBeRemovedIfUnused));
    } else {
      let flags = CanBeRemovedIfUnused;
      // All properties on the "Symbol" global are currently symbol instances
      if (parts[0] === "Symbol") flags |= IsSymbolInstance;
      let list = result.dotDefines.get(tail);
      if (list === undefined) result.dotDefines.set(tail, (list = []));
      list.push(new DefineData(parts, null, flags));
    }
  }

  // Swap in certain literal values because those can be constant folded
  result.identifierDefines.set("undefined", new DefineData(null, new DefineExpr(EUndefinedShared)));
  result.identifierDefines.set("NaN", new DefineData(null, new DefineExpr(new ENumber(NaN))));
  result.identifierDefines.set("Infinity", new DefineData(null, new DefineExpr(new ENumber(Infinity))));

  // Then copy the user-specified defines in afterwards, which will overwrite
  // any known globals above.
  for (const data of userDefines) {
    // Identifier defines are special-cased
    if (data.keyParts.length === 1) {
      const name = data.keyParts[0];
      result.identifierDefines.set(name, mergeDefineData(result.identifierDefines.get(name) ?? new DefineData(), data));
      continue;
    }

    const tail = data.keyParts[data.keyParts.length - 1];
    let dotDefines = result.dotDefines.get(tail);
    dotDefines = dotDefines === undefined ? [] : dotDefines.slice();
    let found = false;

    // Try to merge with existing dot defines first
    for (let i = 0; i < dotDefines.length; i++) {
      if (stringArraysEqual(data.keyParts, dotDefines[i].keyParts)) {
        dotDefines[i] = mergeDefineData(dotDefines[i], data);
        found = true;
        break;
      }
    }

    if (!found) dotDefines.push(data);
    result.dotDefines.set(tail, dotDefines);
  }

  // Potentially cache the result for next time
  if (!hasUserDefines && processedGlobals === null) processedGlobals = result;
  return result;
}
// generated from config.mts by tools/ts-build.mjs; edit that file
