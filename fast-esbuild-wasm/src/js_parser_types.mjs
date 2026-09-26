// All non-parser types/constants of internal/js_parser (js_parser.go,
// ts_parser.go, js_parser_lower.go, js_parser_lower_class.go), shared by the
// parse/visit/lower modules. Field order = Go declaration order.
import { InvalidRef } from "./ast.mjs";
import { RANGE_ZERO } from "./logger.mjs";
import { AssignTargetNone } from "./js_ast.mjs";

export class globPatternImport {
  constructor(assertOrWith = null, parts = [], name = "", approximateRange = RANGE_ZERO, ref = InvalidRef, kind = 0, phase = 0) {
    this.assertOrWith = assertOrWith;
    this.parts = parts;
    this.name = name;
    this.approximateRange = approximateRange;
    this.ref = ref;
    this.kind = kind;
    this.phase = phase;
  }
}

export class namespaceImportItems {
  constructor(entries = new Map(), importRecordIndex = 0) {
    this.entries = entries; // Map<string, LocRef>
    this.importRecordIndex = importRecordIndex;
  }
}

export class injectedSymbolSource {
  constructor(source = null, loc = 0) {
    this.source = source;
    this.loc = loc;
  }
}

export class injectedDotName {
  constructor(parts = [], injectedDefineIndex = 0) {
    this.parts = parts;
    this.injectedDefineIndex = injectedDefineIndex;
  }
}

// importNamespaceCallKind
export const exprKindCall = 0;
export const exprKindNew = 1;
export const exprKindJSXTag = 2;

// importNamespaceCall {ref, kind} is used as a map key: encode as a number.
export function importNamespaceCallKey(ref, kind) {
  return ref * 4 + kind;
}

export class thenCatchChain {
  constructor(nextTarget = null, catchLoc = 0, hasMultipleArgs = false, hasCatch = false) {
    this.nextTarget = nextTarget; // js_ast.E
    this.catchLoc = catchLoc;
    this.hasMultipleArgs = hasMultipleArgs;
    this.hasCatch = hasCatch;
  }
  clone() {
    return new thenCatchChain(this.nextTarget, this.catchLoc, this.hasMultipleArgs, this.hasCatch);
  }
}

export class tempRef {
  constructor(valueOrNil = null, ref = InvalidRef) {
    this.valueOrNil = valueOrNil;
    this.ref = ref;
  }
}

export const locModuleScope = -1;

export class scopeOrder {
  constructor(scope = null, loc = 0) {
    this.scope = scope;
    this.loc = loc;
  }
}

// awaitOrYield
export const allowIdent = 0;
export const allowExpr = 1;
export const forbidAll = 2;

export class fnOrArrowDataParse {
  constructor(
    arrowArgErrors = null,
    decoratorScope = null,
    asyncRange = RANGE_ZERO,
    needsAsyncLoc = 0,
    await_ = allowIdent,
    yield_ = allowIdent,
    allowSuperCall = false,
    allowSuperProperty = false,
    isTopLevel = false,
    isConstructor = false,
    isTypeScriptDeclare = false,
    isThisDisallowed = false,
    isReturnDisallowed = false,
    allowMissingBodyForTypeScript = false,
  ) {
    this.arrowArgErrors = arrowArgErrors; // *deferredArrowArgErrors
    this.decoratorScope = decoratorScope;
    this.asyncRange = asyncRange;
    this.needsAsyncLoc = needsAsyncLoc;
    this.await = await_;
    this.yield = yield_;
    this.allowSuperCall = allowSuperCall;
    this.allowSuperProperty = allowSuperProperty;
    this.isTopLevel = isTopLevel;
    this.isConstructor = isConstructor;
    this.isTypeScriptDeclare = isTypeScriptDeclare;
    this.isThisDisallowed = isThisDisallowed;
    this.isReturnDisallowed = isReturnDisallowed;
    this.allowMissingBodyForTypeScript = allowMissingBodyForTypeScript;
  }
  clone() {
    return new fnOrArrowDataParse(
      this.arrowArgErrors,
      this.decoratorScope,
      this.asyncRange,
      this.needsAsyncLoc,
      this.await,
      this.yield,
      this.allowSuperCall,
      this.allowSuperProperty,
      this.isTopLevel,
      this.isConstructor,
      this.isTypeScriptDeclare,
      this.isThisDisallowed,
      this.isReturnDisallowed,
      this.allowMissingBodyForTypeScript,
    );
  }
}

export class fnOrArrowDataVisit {
  constructor(
    tryBodyCount = 0,
    tryCatchLoc = 0,
    isArrow = false,
    isAsync = false,
    isGenerator = false,
    isInsideLoop = false,
    isInsideSwitch = false,
    isDerivedClassCtor = false,
    isOutsideFnOrArrow = false,
    shouldLowerSuperPropertyAccess = false,
  ) {
    this.tryBodyCount = tryBodyCount;
    this.tryCatchLoc = tryCatchLoc;
    this.isArrow = isArrow;
    this.isAsync = isAsync;
    this.isGenerator = isGenerator;
    this.isInsideLoop = isInsideLoop;
    this.isInsideSwitch = isInsideSwitch;
    this.isDerivedClassCtor = isDerivedClassCtor;
    this.isOutsideFnOrArrow = isOutsideFnOrArrow;
    this.shouldLowerSuperPropertyAccess = shouldLowerSuperPropertyAccess;
  }
  clone() {
    return new fnOrArrowDataVisit(
      this.tryBodyCount,
      this.tryCatchLoc,
      this.isArrow,
      this.isAsync,
      this.isGenerator,
      this.isInsideLoop,
      this.isInsideSwitch,
      this.isDerivedClassCtor,
      this.isOutsideFnOrArrow,
      this.shouldLowerSuperPropertyAccess,
    );
  }
}

// Pointer fields (*ast.Ref) are represented as a Ref number or null.
export class fnOnlyDataVisit {
  constructor(
    argumentsRef = null,
    thisCaptureRef = null,
    argumentsCaptureRef = null,
    shouldReplaceThisWithInnerClassNameRef = false,
    isInStaticClassContext = false,
    innerClassNameRef = null,
    isInsideAsyncArrowFn = false,
    isNewTargetAllowed = false,
    isThisNested = false,
    hasThisUsage = false,
    silenceMessageAboutThisBeingUndefined = false,
  ) {
    this.argumentsRef = argumentsRef;
    this.thisCaptureRef = thisCaptureRef;
    this.argumentsCaptureRef = argumentsCaptureRef;
    this.shouldReplaceThisWithInnerClassNameRef = shouldReplaceThisWithInnerClassNameRef;
    this.isInStaticClassContext = isInStaticClassContext;
    this.innerClassNameRef = innerClassNameRef;
    this.isInsideAsyncArrowFn = isInsideAsyncArrowFn;
    this.isNewTargetAllowed = isNewTargetAllowed;
    this.isThisNested = isThisNested;
    this.hasThisUsage = hasThisUsage;
    this.silenceMessageAboutThisBeingUndefined = silenceMessageAboutThisBeingUndefined;
  }
  clone() {
    return new fnOnlyDataVisit(
      this.argumentsRef,
      this.thisCaptureRef,
      this.argumentsCaptureRef,
      this.shouldReplaceThisWithInnerClassNameRef,
      this.isInStaticClassContext,
      this.innerClassNameRef,
      this.isInsideAsyncArrowFn,
      this.isNewTargetAllowed,
      this.isThisNested,
      this.hasThisUsage,
      this.silenceMessageAboutThisBeingUndefined,
    );
  }
}

// livenessStatus
export const alwaysDead = -1;
export const livenessUnknown = 0;
export const alwaysLive = 1;

export class switchCaseLiveness {
  constructor(status = livenessUnknown, canFallThrough = false) {
    this.status = status;
    this.canFallThrough = canFallThrough;
  }
}

export class duplicateCaseValue {
  constructor(value = null, hash = 0) {
    this.value = value;
    this.hash = hash;
  }
}

// duplicatePropertiesIn
export const duplicatePropertiesInObject = 0;
export const duplicatePropertiesInClass = 1;

// mergeResult
export const mergeForbidden = 0;
export const mergeReplaceWithNew = 1;
export const mergeOverwriteWithNew = 2;
export const mergeKeepExisting = 3;
export const mergeBecomePrivateGetSetPair = 4;
export const mergeBecomePrivateStaticGetSetPair = 5;

// JSXImport
export const JSXImportJSX = 0;
export const JSXImportJSXS = 1;
export const JSXImportFragment = 2;
export const JSXImportCreateElement = 3;

export class deferredErrors {
  constructor(invalidExprDefaultValue = RANGE_ZERO, invalidExprAfterQuestion = RANGE_ZERO, arraySpreadFeature = RANGE_ZERO, invalidParens = []) {
    this.invalidExprDefaultValue = invalidExprDefaultValue;
    this.invalidExprAfterQuestion = invalidExprAfterQuestion;
    this.arraySpreadFeature = arraySpreadFeature;
    this.invalidParens = invalidParens;
  }
}

export class deferredArrowArgErrors {
  constructor(invalidExprAwait = RANGE_ZERO, invalidExprYield = RANGE_ZERO) {
    this.invalidExprAwait = invalidExprAwait;
    this.invalidExprYield = invalidExprYield;
  }
}

export class propertyOpts {
  constructor(
    decorators = [],
    decoratorScope = null,
    decoratorContext = 0,
    asyncRange = RANGE_ZERO,
    generatorRange = RANGE_ZERO,
    tsDeclareRange = RANGE_ZERO,
    classKeyword = RANGE_ZERO,
    isAsync = false,
    isGenerator = false,
    isStatic = false,
    isTSAbstract = false,
    isClass = false,
    classHasExtends = false,
  ) {
    this.decorators = decorators;
    this.decoratorScope = decoratorScope;
    this.decoratorContext = decoratorContext;
    this.asyncRange = asyncRange;
    this.generatorRange = generatorRange;
    this.tsDeclareRange = tsDeclareRange;
    this.classKeyword = classKeyword;
    this.isAsync = isAsync;
    this.isGenerator = isGenerator;
    this.isStatic = isStatic;
    this.isTSAbstract = isTSAbstract;
    this.isClass = isClass;
    this.classHasExtends = classHasExtends;
  }
  clone() {
    return new propertyOpts(
      this.decorators,
      this.decoratorScope,
      this.decoratorContext,
      this.asyncRange,
      this.generatorRange,
      this.tsDeclareRange,
      this.classKeyword,
      this.isAsync,
      this.isGenerator,
      this.isStatic,
      this.isTSAbstract,
      this.isClass,
      this.classHasExtends,
    );
  }
}

export const permanentReservedProps = new Set(["__proto__", "constructor", "prototype"]);

// wasOriginallyDotOrIndex
export const wasOriginallyDot = 0;
export const wasOriginallyIndex = 1;

export class parenExprOpts {
  constructor(asyncRange = RANGE_ZERO, forceArrowFn = false, isAfterQuestionAndBeforeColon = false) {
    this.asyncRange = asyncRange;
    this.forceArrowFn = forceArrowFn;
    this.isAfterQuestionAndBeforeColon = isAfterQuestionAndBeforeColon;
  }
}

export class invalidLog {
  constructor(invalidTokens = [], syntaxFeatures = []) {
    this.invalidTokens = invalidTokens;
    this.syntaxFeatures = syntaxFeatures;
  }
}

export class syntaxFeature {
  constructor(feature = 0, token = RANGE_ZERO) {
    this.feature = feature;
    this.token = token;
  }
}

// exprFlag
export const exprFlagDecorator = 1 << 0;
export const exprFlagForLoopInit = 1 << 1;
export const exprFlagForAwaitLoopInit = 1 << 2;
export const exprFlagAfterQuestionAndBeforeColon = 1 << 3;
export const exprFlagIsNewTarget = 1 << 4;

export class parseBindingOpts {
  constructor(isUsingStmt = false) {
    this.isUsingStmt = isUsingStmt;
  }
}

// fnKind
export const fnStmt = 0;
export const fnExpr = 1;

export class parseClassOpts {
  constructor(decorators = [], decoratorContext = 0, isTypeScriptDeclare = false) {
    this.decorators = decorators;
    this.decoratorContext = decoratorContext;
    this.isTypeScriptDeclare = isTypeScriptDeclare;
  }
}

export class deferredDecorators {
  constructor(decorators = []) {
    this.decorators = decorators;
  }
}

// decoratorContextFlags
export const decoratorBeforeClassExpr = 1 << 0;
export const decoratorInClassExpr = 1 << 1;
export const decoratorInFnArgs = 1 << 2;

// lexicalDecl
export const lexicalDeclForbid = 0;
export const lexicalDeclAllowAll = 1;
export const lexicalDeclAllowFnInsideIf = 2;
export const lexicalDeclAllowFnInsideLabel = 3;

export class parseStmtOpts {
  constructor(
    deferredDecorators = null,
    lexicalDecl = lexicalDeclForbid,
    isModuleScope = false,
    isNamespaceScope = false,
    isExport = false,
    isExportDefault = false,
    isNameOptional = false,
    isTypeScriptDeclare = false,
    isForLoopInit = false,
    isForAwaitLoopInit = false,
    allowDirectivePrologue = false,
    hasNoSideEffectsComment = false,
    isUsingStmt = false,
    isCaseBody = false,
  ) {
    this.deferredDecorators = deferredDecorators;
    this.lexicalDecl = lexicalDecl;
    this.isModuleScope = isModuleScope;
    this.isNamespaceScope = isNamespaceScope;
    this.isExport = isExport;
    this.isExportDefault = isExportDefault;
    this.isNameOptional = isNameOptional;
    this.isTypeScriptDeclare = isTypeScriptDeclare;
    this.isForLoopInit = isForLoopInit;
    this.isForAwaitLoopInit = isForAwaitLoopInit;
    this.allowDirectivePrologue = allowDirectivePrologue;
    this.hasNoSideEffectsComment = hasNoSideEffectsComment;
    this.isUsingStmt = isUsingStmt;
    this.isCaseBody = isCaseBody;
  }
  clone() {
    return new parseStmtOpts(
      this.deferredDecorators,
      this.lexicalDecl,
      this.isModuleScope,
      this.isNamespaceScope,
      this.isExport,
      this.isExportDefault,
      this.isNameOptional,
      this.isTypeScriptDeclare,
      this.isForLoopInit,
      this.isForAwaitLoopInit,
      this.allowDirectivePrologue,
      this.hasNoSideEffectsComment,
      this.isUsingStmt,
      this.isCaseBody,
    );
  }
}

// generateTempRefArg
export const tempRefNeedsDeclare = 0;
export const tempRefNoDeclare = 1;
export const tempRefNeedsDeclareMayBeCapturedInsideLoop = 2;

export class findSymbolResult {
  constructor(ref = InvalidRef, declareLoc = 0, isInsideWithScope = false) {
    this.ref = ref;
    this.declareLoc = declareLoc;
    this.isInsideWithScope = isInsideWithScope;
  }
}

// stmtsKind
export const stmtsNormal = 0;
export const stmtsLoopBody = 1;
export const stmtsFnBody = 2;

export class prependTempRefsOpts {
  constructor(fnBodyLoc = null, kind = stmtsNormal) {
    this.fnBodyLoc = fnBodyLoc; // *logger.Loc -> number or null
    this.kind = kind;
  }
}

// substituteStatus
export const substituteContinue = 0;
export const substituteSuccess = 1;
export const substituteFailure = 2;

export class bindingOpts {
  constructor(duplicateArgCheck = null) {
    this.duplicateArgCheck = duplicateArgCheck; // Map<string, Range> or null
  }
}

// relocateVarsMode
export const relocateVarsNormal = 0;
export const relocateVarsForInOrForOf = 1;

// captureValueMode
export const valueDefinitelyNotMutated = 0;
export const valueCouldBeMutated = 1;

export class visitClassResult {
  constructor(bodyScope = null, innerClassNameRef = InvalidRef, superCtorRef = InvalidRef, canBeRemovedIfUnused = false) {
    this.bodyScope = bodyScope;
    this.innerClassNameRef = innerClassNameRef;
    this.superCtorRef = superCtorRef;
    this.canBeRemovedIfUnused = canBeRemovedIfUnused;
  }
}

export class visitArgsOpts {
  constructor(body = [], decoratorScope = null, hasRestArg = false, isUniqueFormalParameters = false) {
    this.body = body;
    this.decoratorScope = decoratorScope;
    this.hasRestArg = hasRestArg;
    this.isUniqueFormalParameters = isUniqueFormalParameters;
  }
}

// typeofStringOrder
export const onlyCheckOriginalOrder = 0;
export const checkBothOrders = 1;

export class exprIn {
  constructor(
    isMethod = false,
    isLoweredPrivateMethod = false,
    hasChainParent = false,
    storeThisArgForParentOptionalChain = false,
    shouldMangleStringsAsProps = false,
    assignTarget = AssignTargetNone,
  ) {
    this.isMethod = isMethod;
    this.isLoweredPrivateMethod = isLoweredPrivateMethod;
    this.hasChainParent = hasChainParent;
    this.storeThisArgForParentOptionalChain = storeThisArgForParentOptionalChain;
    this.shouldMangleStringsAsProps = shouldMangleStringsAsProps;
    this.assignTarget = assignTarget;
  }
  clone() {
    return new exprIn(
      this.isMethod,
      this.isLoweredPrivateMethod,
      this.hasChainParent,
      this.storeThisArgForParentOptionalChain,
      this.shouldMangleStringsAsProps,
      this.assignTarget,
    );
  }
}
// Shared default "exprIn{}" (never mutate it)
export const EXPR_IN_DEFAULT = Object.freeze(new exprIn());

export class exprOut {
  constructor(
    thisArgFunc = null,
    thisArgWrapFunc = null,
    childContainsOptionalChain = false,
    callMustBeReplacedWithUndefined = false,
    methodCallMustBeReplacedWithUndefined = false,
  ) {
    this.thisArgFunc = thisArgFunc; // func() Expr or null
    this.thisArgWrapFunc = thisArgWrapFunc; // func(Expr) Expr or null
    this.childContainsOptionalChain = childContainsOptionalChain;
    this.callMustBeReplacedWithUndefined = callMustBeReplacedWithUndefined;
    this.methodCallMustBeReplacedWithUndefined = methodCallMustBeReplacedWithUndefined;
  }
}
// Shared default "exprOut{}" (never mutate it)
export const EXPR_OUT_DEFAULT = Object.freeze(new exprOut());

export class binaryExprVisitor {
  constructor(e = null, loc = 0, in_ = EXPR_IN_DEFAULT, leftIn = EXPR_IN_DEFAULT, isStmtExpr = false, oldSilenceWarningAboutThisBeingUndefined = false) {
    this.e = e; // *EBinary
    this.loc = loc;
    this.in = in_;
    this.leftIn = leftIn;
    this.isStmtExpr = isStmtExpr;
    this.oldSilenceWarningAboutThisBeingUndefined = oldSilenceWarningAboutThisBeingUndefined;
  }
}

export class globPart {
  constructor(text = "", isWildcard = false) {
    this.text = text;
    this.isWildcard = isWildcard;
  }
}

export class identifierOpts {
  constructor(
    assignTarget = AssignTargetNone,
    isCallTarget = false,
    isDeleteTarget = false,
    preferQuotedKey = false,
    wasOriginallyIdentifier = false,
    matchAgainstDefines = false,
  ) {
    this.assignTarget = assignTarget;
    this.isCallTarget = isCallTarget;
    this.isDeleteTarget = isDeleteTarget;
    this.preferQuotedKey = preferQuotedKey;
    this.wasOriginallyIdentifier = wasOriginallyIdentifier;
    this.matchAgainstDefines = matchAgainstDefines;
  }
}

export class visitFnOpts {
  constructor(isMethod = false, isDerivedClassCtor = false, isLoweredPrivateMethod = false) {
    this.isMethod = isMethod;
    this.isDerivedClassCtor = isDerivedClassCtor;
    this.isLoweredPrivateMethod = isLoweredPrivateMethod;
  }
}

export class importsExportsScanResult {
  constructor(stmts = [], keptImportEquals = false, removedImportEquals = false) {
    this.stmts = stmts;
    this.keptImportEquals = keptImportEquals;
    this.removedImportEquals = removedImportEquals;
  }
}

export class HelperCall {
  constructor(global = [], runtime = "") {
    this.global = global;
    this.runtime = runtime;
  }
}

// whyESM
export const whyESMUnknown = 0;
export const whyESMExportKeyword = 1;
export const whyESMImportMeta = 2;
export const whyESMTopLevelAwait = 3;
export const whyESMFileMJS = 4;
export const whyESMFileMTS = 5;
export const whyESMTypeModulePackageJSON = 6;
export const whyESMImportStatement = 7;

// ---------------------------------------------------------------------------
// ts_parser.go

// skipTypeFlags
export const isReturnTypeFlag = 1 << 0;
export const isIndexSignatureFlag = 1 << 1;
export const allowTupleLabelsFlag = 1 << 2;
export const disallowConditionalTypesFlag = 1 << 3;

// tsTypeIdentifierKind
export const tsTypeIdentifierNormal = 0;
export const tsTypeIdentifierUnique = 1;
export const tsTypeIdentifierAbstract = 2;
export const tsTypeIdentifierAsserts = 3;
export const tsTypeIdentifierPrefix = 4;
export const tsTypeIdentifierPrimitive = 5;
export const tsTypeIdentifierInfer = 6;

export const tsTypeIdentifierMap = new Map([
  ["unique", tsTypeIdentifierUnique],
  ["abstract", tsTypeIdentifierAbstract],
  ["asserts", tsTypeIdentifierAsserts],
  ["keyof", tsTypeIdentifierPrefix],
  ["readonly", tsTypeIdentifierPrefix],
  ["any", tsTypeIdentifierPrimitive],
  ["never", tsTypeIdentifierPrimitive],
  ["unknown", tsTypeIdentifierPrimitive],
  ["undefined", tsTypeIdentifierPrimitive],
  ["object", tsTypeIdentifierPrimitive],
  ["number", tsTypeIdentifierPrimitive],
  ["string", tsTypeIdentifierPrimitive],
  ["boolean", tsTypeIdentifierPrimitive],
  ["bigint", tsTypeIdentifierPrimitive],
  ["symbol", tsTypeIdentifierPrimitive],
  ["infer", tsTypeIdentifierInfer],
]);

// typeParameterFlags
export const allowInOutVarianceAnnotations = 1 << 0;
export const allowConstModifier = 1 << 1;
export const allowEmptyTypeParameters = 1 << 2;

// skipTypeScriptTypeParametersResult
export const didNotSkipAnything = 0;
export const couldBeTypeCast = 1;
export const definitelyTypeParameters = 2;

export class skipTypeScriptTypeArgumentsOpts {
  constructor(isInsideJSXElement = false, isParseTypeArgumentsInExpression = false) {
    this.isInsideJSXElement = isInsideJSXElement;
    this.isParseTypeArgumentsInExpression = isParseTypeArgumentsInExpression;
  }
}

// ---------------------------------------------------------------------------
// js_parser_lower.go

// strictModeFeature
export const withStatement = 0;
export const deleteBareName = 1;
export const forInVarInit = 2;
export const evalOrArguments = 3;
export const reservedWord = 4;
export const legacyOctalLiteral = 5;
export const legacyOctalEscape = 6;
export const ifElseFunctionStmt = 7;
export const labelFunctionStmt = 8;
export const duplicateLexicallyDeclaredNames = 9;

// objRestMode
export const objRestReturnValueIsUnused = 0;
export const objRestMustReturnInitExpr = 1;

export class lowerUsingDeclarationContext {
  constructor(firstUsingLoc = 0, stackRef = InvalidRef, hasAwaitUsing = false) {
    this.firstUsingLoc = firstUsingLoc;
    this.stackRef = stackRef;
    this.hasAwaitUsing = hasAwaitUsing;
  }
}

// ---------------------------------------------------------------------------
// js_parser_lower_class.go

export class classLoweringInfo {
  constructor(lowerAllInstanceFields = false, lowerAllStaticFields = false, shimSuperCtorCalls = false) {
    this.lowerAllInstanceFields = lowerAllInstanceFields;
    this.lowerAllStaticFields = lowerAllStaticFields;
    this.shimSuperCtorCalls = shimSuperCtorCalls;
  }
}

// classKind
export const classKindExpr = 0;
export const classKindStmt = 1;
export const classKindExportStmt = 2;
export const classKindExportDefaultStmt = 3;

export class lowerClassContext {
  constructor() {
    this.nameToKeep = "";
    this.kind = classKindExpr;
    this.class = null; // *js_ast.Class
    this.classLoc = 0;
    this.classExpr = null; // Expr
    this.defaultName = null; // ast.LocRef

    this.ctor = null; // *js_ast.EFunction
    this.extendsRef = InvalidRef;
    this.parameterFieldProps = [];
    this.parameterFields = [];
    this.instanceMembers = [];
    this.instancePrivateMethods = [];
    this.autoAccessorCount = 0;

    this.computedPropertyChain = null;
    this.privateMembers = [];
    this.staticMembers = [];
    this.staticPrivateMethods = [];

    this.instanceExperimentalDecorators = [];
    this.staticExperimentalDecorators = [];

    this.decoratorContextRef = InvalidRef;
    this.decoratorClassDecorators = null;
    this.decoratorPropertyToInitializerMap = null; // Map<number, number>
    this.decoratorCallInstanceMethodExtraInitializers = false;
    this.decoratorCallStaticMethodExtraInitializers = false;
    this.decoratorStaticNonFieldElements = [];
    this.decoratorInstanceNonFieldElements = [];
    this.decoratorStaticFieldElements = [];
    this.decoratorInstanceFieldElements = [];

    this.privateInstanceMethodRef = InvalidRef;
    this.privateStaticMethodRef = InvalidRef;

    this.nameFunc = null; // func() Expr
    this.wrapFunc = null; // func(Expr) Expr
    this.didCaptureClassExpr = false;
  }
}

export class propertyAnalysis {
  constructor() {
    this.private = null; // *js_ast.EPrivateIdentifier
    this.propExperimentalDecorators = [];
    this.propDecorators = [];
    this.mustLowerField = false;
    this.needsValueOfKey = false;
    this.rewriteAutoAccessorToGetSet = false;
    this.shouldOmitFieldInitializer = false;
    this.staticFieldToBlockAssign = false;
    this.isComputedPropertyCopiedOrMoved = false;
  }
}
