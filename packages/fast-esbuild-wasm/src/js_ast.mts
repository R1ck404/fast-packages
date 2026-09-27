// Port of internal/js_ast/js_ast.go. See CONVENTIONS.md.
//
// Expr / Stmt / Binding are immutable {data, loc} pairs; a missing one is null.
// Data classes (E*, S*, B*) are mutable and carry a kind tag `k` on their
// prototype (E_* / S_* / B_* constants). Constructors take every field in Go
// declaration order, all optional with Go zero-value defaults.
import { InvalidRef, LocRef } from "./ast.mjs";
import { RANGE_ZERO, platformIndependentPathDirBaseExt } from "./logger.mjs";
import type { Range } from "./logger.mjs";
import { formatFloatG } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// L (operator precedence levels)
export const LLowest = 0;
export const LComma = 1;
export const LSpread = 2;
export const LYield = 3;
export const LAssign = 4;
export const LConditional = 5;
export const LNullishCoalescing = 6;
export const LLogicalOr = 7;
export const LLogicalAnd = 8;
export const LBitwiseOr = 9;
export const LBitwiseXor = 10;
export const LBitwiseAnd = 11;
export const LEquals = 12;
export const LCompare = 13;
export const LShift = 14;
export const LAdd = 15;
export const LMultiply = 16;
export const LExponentiation = 17;
export const LPrefix = 18;
export const LPostfix = 19;
export const LNew = 20;
export const LCall = 21;
export const LMember = 22;

// OpCode
export const UnOpPos = 0;
export const UnOpNeg = 1;
export const UnOpCpl = 2;
export const UnOpNot = 3;
export const UnOpVoid = 4;
export const UnOpTypeof = 5;
export const UnOpDelete = 6;
export const UnOpPreDec = 7;
export const UnOpPreInc = 8;
export const UnOpPostDec = 9;
export const UnOpPostInc = 10;
export const BinOpAdd = 11;
export const BinOpSub = 12;
export const BinOpMul = 13;
export const BinOpDiv = 14;
export const BinOpRem = 15;
export const BinOpPow = 16;
export const BinOpLt = 17;
export const BinOpLe = 18;
export const BinOpGt = 19;
export const BinOpGe = 20;
export const BinOpIn = 21;
export const BinOpInstanceof = 22;
export const BinOpShl = 23;
export const BinOpShr = 24;
export const BinOpUShr = 25;
export const BinOpLooseEq = 26;
export const BinOpLooseNe = 27;
export const BinOpStrictEq = 28;
export const BinOpStrictNe = 29;
export const BinOpNullishCoalescing = 30;
export const BinOpLogicalOr = 31;
export const BinOpLogicalAnd = 32;
export const BinOpBitwiseOr = 33;
export const BinOpBitwiseAnd = 34;
export const BinOpBitwiseXor = 35;
export const BinOpComma = 36;
export const BinOpAssign = 37;
export const BinOpAddAssign = 38;
export const BinOpSubAssign = 39;
export const BinOpMulAssign = 40;
export const BinOpDivAssign = 41;
export const BinOpRemAssign = 42;
export const BinOpPowAssign = 43;
export const BinOpShlAssign = 44;
export const BinOpShrAssign = 45;
export const BinOpUShrAssign = 46;
export const BinOpBitwiseOrAssign = 47;
export const BinOpBitwiseAndAssign = 48;
export const BinOpBitwiseXorAssign = 49;
export const BinOpNullishCoalescingAssign = 50;
export const BinOpLogicalOrAssign = 51;
export const BinOpLogicalAndAssign = 52;

// AssignTarget
export const AssignTargetNone = 0;
export const AssignTargetReplace = 1;
export const AssignTargetUpdate = 2;

export function opCodeIsPrefix(op) {
  return op < UnOpPostDec;
}
export function opCodeUnaryAssignTarget(op) {
  if (op >= UnOpPreDec && op <= UnOpPostInc) return AssignTargetUpdate;
  return AssignTargetNone;
}
export function opCodeIsLeftAssociative(op) {
  return op >= BinOpAdd && op < BinOpComma && op !== BinOpPow;
}
export function opCodeIsRightAssociative(op) {
  return op >= BinOpAssign || op === BinOpPow;
}
export function opCodeBinaryAssignTarget(op) {
  if (op === BinOpAssign) return AssignTargetReplace;
  if (op > BinOpAssign) return AssignTargetUpdate;
  return AssignTargetNone;
}
export function opCodeIsShortCircuit(op) {
  switch (op) {
    case BinOpLogicalOr:
    case BinOpLogicalOrAssign:
    case BinOpLogicalAnd:
    case BinOpLogicalAndAssign:
    case BinOpNullishCoalescing:
    case BinOpNullishCoalescingAssign:
      return true;
  }
  return false;
}

export class OpTableEntry {
  declare text: any;
  declare level: any;
  declare isKeyword: any;
  constructor(text, level, isKeyword) {
    this.text = text;
    this.level = level;
    this.isKeyword = isKeyword;
  }
}

export const OpTable = [
  // Prefix
  new OpTableEntry("+", LPrefix, false),
  new OpTableEntry("-", LPrefix, false),
  new OpTableEntry("~", LPrefix, false),
  new OpTableEntry("!", LPrefix, false),
  new OpTableEntry("void", LPrefix, true),
  new OpTableEntry("typeof", LPrefix, true),
  new OpTableEntry("delete", LPrefix, true),
  // Prefix update
  new OpTableEntry("--", LPrefix, false),
  new OpTableEntry("++", LPrefix, false),
  // Postfix update
  new OpTableEntry("--", LPostfix, false),
  new OpTableEntry("++", LPostfix, false),
  // Left-associative
  new OpTableEntry("+", LAdd, false),
  new OpTableEntry("-", LAdd, false),
  new OpTableEntry("*", LMultiply, false),
  new OpTableEntry("/", LMultiply, false),
  new OpTableEntry("%", LMultiply, false),
  new OpTableEntry("**", LExponentiation, false), // Right-associative
  new OpTableEntry("<", LCompare, false),
  new OpTableEntry("<=", LCompare, false),
  new OpTableEntry(">", LCompare, false),
  new OpTableEntry(">=", LCompare, false),
  new OpTableEntry("in", LCompare, true),
  new OpTableEntry("instanceof", LCompare, true),
  new OpTableEntry("<<", LShift, false),
  new OpTableEntry(">>", LShift, false),
  new OpTableEntry(">>>", LShift, false),
  new OpTableEntry("==", LEquals, false),
  new OpTableEntry("!=", LEquals, false),
  new OpTableEntry("===", LEquals, false),
  new OpTableEntry("!==", LEquals, false),
  new OpTableEntry("??", LNullishCoalescing, false),
  new OpTableEntry("||", LLogicalOr, false),
  new OpTableEntry("&&", LLogicalAnd, false),
  new OpTableEntry("|", LBitwiseOr, false),
  new OpTableEntry("&", LBitwiseAnd, false),
  new OpTableEntry("^", LBitwiseXor, false),
  // Non-associative
  new OpTableEntry(",", LComma, false),
  // Right-associative
  new OpTableEntry("=", LAssign, false),
  new OpTableEntry("+=", LAssign, false),
  new OpTableEntry("-=", LAssign, false),
  new OpTableEntry("*=", LAssign, false),
  new OpTableEntry("/=", LAssign, false),
  new OpTableEntry("%=", LAssign, false),
  new OpTableEntry("**=", LAssign, false),
  new OpTableEntry("<<=", LAssign, false),
  new OpTableEntry(">>=", LAssign, false),
  new OpTableEntry(">>>=", LAssign, false),
  new OpTableEntry("|=", LAssign, false),
  new OpTableEntry("&=", LAssign, false),
  new OpTableEntry("^=", LAssign, false),
  new OpTableEntry("??=", LAssign, false),
  new OpTableEntry("||=", LAssign, false),
  new OpTableEntry("&&=", LAssign, false),
];

// ---------------------------------------------------------------------------
// Wrappers

export class Expr {
  declare data: any;
  declare loc: number;
  constructor(data, loc = 0) {
    this.data = data;
    this.loc = loc;
  }
}
export class Stmt {
  declare data: any;
  declare loc: number;
  constructor(data, loc = 0) {
    this.data = data;
    this.loc = loc;
  }
}
export class Binding {
  declare data: any;
  declare loc: number;
  constructor(data, loc = 0) {
    this.data = data;
    this.loc = loc;
  }
}

// ---------------------------------------------------------------------------
// Value structs

export class Decorator {
  declare value: any;
  declare atLoc: number;
  declare omitNewlineAfter: boolean;
  constructor(value = null, atLoc = 0, omitNewlineAfter = false) {
    this.value = value; // Expr
    this.atLoc = atLoc;
    this.omitNewlineAfter = omitNewlineAfter;
  }
  clone() {
    return new Decorator(this.value, this.atLoc, this.omitNewlineAfter);
  }
}

// PropertyKind
export const PropertyField = 0;
export const PropertyMethod = 1;
export const PropertyGetter = 2;
export const PropertySetter = 3;
export const PropertyAutoAccessor = 4;
export const PropertySpread = 5;
export const PropertyDeclareOrAbstract = 6;
export const PropertyClassStaticBlock = 7;

export function propertyKindIsMethodDefinition(kind) {
  return kind === PropertyMethod || kind === PropertyGetter || kind === PropertySetter;
}

export class ClassStaticBlock {
  declare block: SBlock;
  declare loc: number;
  constructor(block = new SBlock(), loc = 0) {
    this.block = block; // SBlock (value)
    this.loc = loc;
  }
}

// PropertyFlags
export const PropertyIsComputed = 1 << 0;
export const PropertyIsStatic = 1 << 1;
export const PropertyWasShorthand = 1 << 2;
export const PropertyPreferQuotedKey = 1 << 3;

export class Property {
  declare classStaticBlock: any;
  declare key: any;
  declare valueOrNil: any;
  declare initializerOrNil: any;
  declare decorators: any[];
  declare loc: number;
  declare closeBracketLoc: number;
  declare kind: number;
  declare flags: number;
  constructor(
    classStaticBlock = null,
    key = null,
    valueOrNil = null,
    initializerOrNil = null,
    decorators = [],
    loc = 0,
    closeBracketLoc = 0,
    kind = PropertyField,
    flags = 0,
  ) {
    this.classStaticBlock = classStaticBlock;
    this.key = key;
    this.valueOrNil = valueOrNil;
    this.initializerOrNil = initializerOrNil;
    this.decorators = decorators;
    this.loc = loc;
    this.closeBracketLoc = closeBracketLoc;
    this.kind = kind;
    this.flags = flags;
  }
  clone() {
    return new Property(
      this.classStaticBlock,
      this.key,
      this.valueOrNil,
      this.initializerOrNil,
      this.decorators,
      this.loc,
      this.closeBracketLoc,
      this.kind,
      this.flags,
    );
  }
}

export class PropertyBinding {
  declare key: any;
  declare value: any;
  declare defaultValueOrNil: any;
  declare loc: number;
  declare closeBracketLoc: number;
  declare isComputed: boolean;
  declare isSpread: boolean;
  declare preferQuotedKey: boolean;
  constructor(
    key = null,
    value = null,
    defaultValueOrNil = null,
    loc = 0,
    closeBracketLoc = 0,
    isComputed = false,
    isSpread = false,
    preferQuotedKey = false,
  ) {
    this.key = key; // Expr
    this.value = value; // Binding
    this.defaultValueOrNil = defaultValueOrNil; // Expr
    this.loc = loc;
    this.closeBracketLoc = closeBracketLoc;
    this.isComputed = isComputed;
    this.isSpread = isSpread;
    this.preferQuotedKey = preferQuotedKey;
  }
  clone() {
    return new PropertyBinding(
      this.key,
      this.value,
      this.defaultValueOrNil,
      this.loc,
      this.closeBracketLoc,
      this.isComputed,
      this.isSpread,
      this.preferQuotedKey,
    );
  }
}

export class Arg {
  declare binding: any;
  declare defaultOrNil: any;
  declare decorators: any[];
  declare isTypeScriptCtorField: boolean;
  constructor(binding = null, defaultOrNil = null, decorators = [], isTypeScriptCtorField = false) {
    this.binding = binding; // Binding
    this.defaultOrNil = defaultOrNil; // Expr
    this.decorators = decorators;
    this.isTypeScriptCtorField = isTypeScriptCtorField;
  }
  clone() {
    return new Arg(this.binding, this.defaultOrNil, this.decorators, this.isTypeScriptCtorField);
  }
}

export class FnBody {
  declare block: SBlock;
  declare loc: number;
  constructor(block = new SBlock(), loc = 0) {
    this.block = block; // SBlock (value)
    this.loc = loc;
  }
  clone() {
    return new FnBody(this.block.clone(), this.loc);
  }
}

export class Fn {
  declare name: any;
  declare args: any[];
  declare body: FnBody;
  declare argumentsRef: number;
  declare openParenLoc: number;
  declare isAsync: boolean;
  declare isGenerator: boolean;
  declare hasRestArg: boolean;
  declare hasIfScope: boolean;
  declare hasNoSideEffectsComment: boolean;
  declare isUniqueFormalParameters: boolean;
  constructor(
    name = null, // *LocRef
    args = [],
    body = new FnBody(),
    argumentsRef = InvalidRef,
    openParenLoc = 0,
    isAsync = false,
    isGenerator = false,
    hasRestArg = false,
    hasIfScope = false,
    hasNoSideEffectsComment = false,
    isUniqueFormalParameters = false,
  ) {
    this.name = name;
    this.args = args;
    this.body = body;
    this.argumentsRef = argumentsRef;
    this.openParenLoc = openParenLoc;
    this.isAsync = isAsync;
    this.isGenerator = isGenerator;
    this.hasRestArg = hasRestArg;
    this.hasIfScope = hasIfScope;
    this.hasNoSideEffectsComment = hasNoSideEffectsComment;
    this.isUniqueFormalParameters = isUniqueFormalParameters;
  }
  // Shallow copy like a Go struct assignment (slices/pointers are shared,
  // embedded value structs are copied).
  clone() {
    return new Fn(
      this.name,
      this.args,
      this.body.clone(),
      this.argumentsRef,
      this.openParenLoc,
      this.isAsync,
      this.isGenerator,
      this.hasRestArg,
      this.hasIfScope,
      this.hasNoSideEffectsComment,
      this.isUniqueFormalParameters,
    );
  }
}

export class Class {
  declare decorators: any[];
  declare name: any;
  declare extendsOrNil: any;
  declare properties: any[];
  declare classKeyword: Range;
  declare bodyLoc: number;
  declare closeBraceLoc: number;
  declare shouldLowerStandardDecorators: boolean;
  declare useDefineForClassFields: boolean;
  constructor(
    decorators = [],
    name = null, // *LocRef
    extendsOrNil = null,
    properties = [],
    classKeyword = RANGE_ZERO,
    bodyLoc = 0,
    closeBraceLoc = 0,
    shouldLowerStandardDecorators = false,
    useDefineForClassFields = false,
  ) {
    this.decorators = decorators;
    this.name = name;
    this.extendsOrNil = extendsOrNil;
    this.properties = properties;
    this.classKeyword = classKeyword;
    this.bodyLoc = bodyLoc;
    this.closeBraceLoc = closeBraceLoc;
    this.shouldLowerStandardDecorators = shouldLowerStandardDecorators;
    this.useDefineForClassFields = useDefineForClassFields;
  }
  clone() {
    return new Class(
      this.decorators,
      this.name,
      this.extendsOrNil,
      this.properties,
      this.classKeyword,
      this.bodyLoc,
      this.closeBraceLoc,
      this.shouldLowerStandardDecorators,
      this.useDefineForClassFields,
    );
  }
}

export class ArrayBinding {
  declare binding: any;
  declare defaultValueOrNil: any;
  declare loc: number;
  constructor(binding = null, defaultValueOrNil = null, loc = 0) {
    this.binding = binding;
    this.defaultValueOrNil = defaultValueOrNil;
    this.loc = loc;
  }
  clone() {
    return new ArrayBinding(this.binding, this.defaultValueOrNil, this.loc);
  }
}

// ---------------------------------------------------------------------------
// Bindings

export const B_MISSING = 1;
export const B_IDENTIFIER = 2;
export const B_ARRAY = 3;
export const B_OBJECT = 4;

export class BMissing {
  declare k: any;}
BMissing.prototype.k = B_MISSING;

export class BIdentifier {
  declare ref: number;
  declare k: any;
  constructor(ref = InvalidRef) {
    this.ref = ref;
  }
}
BIdentifier.prototype.k = B_IDENTIFIER;

export class BArray {
  declare items: any[];
  declare closeBracketLoc: number;
  declare hasSpread: boolean;
  declare isSingleLine: boolean;
  declare k: any;
  constructor(items = [], closeBracketLoc = 0, hasSpread = false, isSingleLine = false) {
    this.items = items; // []ArrayBinding
    this.closeBracketLoc = closeBracketLoc;
    this.hasSpread = hasSpread;
    this.isSingleLine = isSingleLine;
  }
}
BArray.prototype.k = B_ARRAY;

export class BObject {
  declare properties: any[];
  declare closeBraceLoc: number;
  declare isSingleLine: boolean;
  declare k: any;
  constructor(properties = [], closeBraceLoc = 0, isSingleLine = false) {
    this.properties = properties; // []PropertyBinding
    this.closeBraceLoc = closeBraceLoc;
    this.isSingleLine = isSingleLine;
  }
}
BObject.prototype.k = B_OBJECT;

// ---------------------------------------------------------------------------
// Expressions

export const E_ARRAY = 1;
export const E_UNARY = 2;
export const E_BINARY = 3;
export const E_BOOLEAN = 4;
export const E_SUPER = 5;
export const E_NULL = 6;
export const E_UNDEFINED = 7;
export const E_THIS = 8;
export const E_NEW = 9;
export const E_NEW_TARGET = 10;
export const E_IMPORT_META = 11;
export const E_CALL = 12;
export const E_DOT = 13;
export const E_INDEX = 14;
export const E_ARROW = 15;
export const E_FUNCTION = 16;
export const E_CLASS = 17;
export const E_IDENTIFIER = 18;
export const E_IMPORT_IDENTIFIER = 19;
export const E_PRIVATE_IDENTIFIER = 20;
export const E_NAME_OF_SYMBOL = 21;
export const E_JSX_ELEMENT = 22;
export const E_JSX_TEXT = 23;
export const E_MISSING = 24;
export const E_NUMBER = 25;
export const E_BIG_INT = 26;
export const E_OBJECT = 27;
export const E_SPREAD = 28;
export const E_STRING = 29;
export const E_TEMPLATE = 30;
export const E_REG_EXP = 31;
export const E_INLINED_ENUM = 32;
export const E_ANNOTATION = 33;
export const E_AWAIT = 34;
export const E_YIELD = 35;
export const E_IF = 36;
export const E_REQUIRE_STRING = 37;
export const E_REQUIRE_RESOLVE_STRING = 38;
export const E_IMPORT_STRING = 39;
export const E_IMPORT_CALL = 40;

export class EArray {
  declare items: any[];
  declare commaAfterSpread: number;
  declare closeBracketLoc: number;
  declare isSingleLine: boolean;
  declare isParenthesized: boolean;
  declare k: any;
  constructor(items = [], commaAfterSpread = 0, closeBracketLoc = 0, isSingleLine = false, isParenthesized = false) {
    this.items = items; // []Expr
    this.commaAfterSpread = commaAfterSpread;
    this.closeBracketLoc = closeBracketLoc;
    this.isSingleLine = isSingleLine;
    this.isParenthesized = isParenthesized;
  }
}
EArray.prototype.k = E_ARRAY;

export class EUnary {
  declare value: any;
  declare op: number;
  declare wasOriginallyTypeofIdentifier: boolean;
  declare wasOriginallyDeleteOfIdentifierOrPropertyAccess: boolean;
  declare k: any;
  constructor(value = null, op = UnOpPos, wasOriginallyTypeofIdentifier = false, wasOriginallyDeleteOfIdentifierOrPropertyAccess = false) {
    this.value = value;
    this.op = op;
    this.wasOriginallyTypeofIdentifier = wasOriginallyTypeofIdentifier;
    this.wasOriginallyDeleteOfIdentifierOrPropertyAccess = wasOriginallyDeleteOfIdentifierOrPropertyAccess;
  }
}
EUnary.prototype.k = E_UNARY;

export class EBinary {
  declare left: any;
  declare right: any;
  declare op: number;
  declare isParenthesized: boolean;
  declare k: any;
  constructor(left = null, right = null, op = UnOpPos, isParenthesized = false) {
    this.left = left;
    this.right = right;
    this.op = op;
    this.isParenthesized = isParenthesized;
  }
}
EBinary.prototype.k = E_BINARY;

export class EBoolean {
  declare value: boolean;
  declare k: any;
  constructor(value = false) {
    this.value = value;
  }
}
EBoolean.prototype.k = E_BOOLEAN;

export class EMissing {
  declare k: any;}
EMissing.prototype.k = E_MISSING;

export class ESuper {
  declare k: any;}
ESuper.prototype.k = E_SUPER;

export class ENull {
  declare k: any;}
ENull.prototype.k = E_NULL;

export class EUndefined {
  declare k: any;}
EUndefined.prototype.k = E_UNDEFINED;

export class EThis {
  declare k: any;}
EThis.prototype.k = E_THIS;

export class ENewTarget {
  declare range: Range;
  declare k: any;
  constructor(range = RANGE_ZERO) {
    this.range = range;
  }
}
ENewTarget.prototype.k = E_NEW_TARGET;

export class EImportMeta {
  declare rangeLen: number;
  declare k: any;
  constructor(rangeLen = 0) {
    this.rangeLen = rangeLen;
  }
}
EImportMeta.prototype.k = E_IMPORT_META;

// These help reduce unnecessary memory allocations
export const BMissingShared = new BMissing();
export const EMissingShared = new EMissing();
export const ENullShared = new ENull();
export const ESuperShared = new ESuper();
export const EThisShared = new EThis();
export const EUndefinedShared = new EUndefined();

export class ENew {
  declare target: any;
  declare args: any[];
  declare closeParenLoc: number;
  declare isMultiLine: boolean;
  declare canBeUnwrappedIfUnused: boolean;
  declare k: any;
  constructor(target = null, args = [], closeParenLoc = 0, isMultiLine = false, canBeUnwrappedIfUnused = false) {
    this.target = target;
    this.args = args;
    this.closeParenLoc = closeParenLoc;
    this.isMultiLine = isMultiLine;
    this.canBeUnwrappedIfUnused = canBeUnwrappedIfUnused;
  }
}
ENew.prototype.k = E_NEW;

// CallKind
export const NormalCall = 0;
export const DirectEval = 1;
export const TargetWasOriginallyPropertyAccess = 2;

// OptionalChain
export const OptionalChainNone = 0;
export const OptionalChainStart = 1;
export const OptionalChainContinue = 2;

export class ECall {
  declare target: any;
  declare args: any[];
  declare closeParenLoc: number;
  declare optionalChain: number;
  declare kind: number;
  declare isMultiLine: boolean;
  declare canBeUnwrappedIfUnused: boolean;
  declare k: any;
  constructor(
    target = null,
    args = [],
    closeParenLoc = 0,
    optionalChain = OptionalChainNone,
    kind = NormalCall,
    isMultiLine = false,
    canBeUnwrappedIfUnused = false,
  ) {
    this.target = target;
    this.args = args;
    this.closeParenLoc = closeParenLoc;
    this.optionalChain = optionalChain;
    this.kind = kind;
    this.isMultiLine = isMultiLine;
    this.canBeUnwrappedIfUnused = canBeUnwrappedIfUnused;
  }
  hasSameFlagsAs(b) {
    return this.optionalChain === b.optionalChain && this.kind === b.kind && this.canBeUnwrappedIfUnused === b.canBeUnwrappedIfUnused;
  }
}
ECall.prototype.k = E_CALL;

export class EDot {
  declare target: any;
  declare name: string;
  declare nameLoc: number;
  declare optionalChain: number;
  declare canBeRemovedIfUnused: boolean;
  declare callCanBeUnwrappedIfUnused: boolean;
  declare isSymbolInstance: boolean;
  declare k: any;
  constructor(
    target = null,
    name = "",
    nameLoc = 0,
    optionalChain = OptionalChainNone,
    canBeRemovedIfUnused = false,
    callCanBeUnwrappedIfUnused = false,
    isSymbolInstance = false,
  ) {
    this.target = target;
    this.name = name;
    this.nameLoc = nameLoc;
    this.optionalChain = optionalChain;
    this.canBeRemovedIfUnused = canBeRemovedIfUnused;
    this.callCanBeUnwrappedIfUnused = callCanBeUnwrappedIfUnused;
    this.isSymbolInstance = isSymbolInstance;
  }
  hasSameFlagsAs(b) {
    return (
      this.optionalChain === b.optionalChain &&
      this.canBeRemovedIfUnused === b.canBeRemovedIfUnused &&
      this.callCanBeUnwrappedIfUnused === b.callCanBeUnwrappedIfUnused &&
      this.isSymbolInstance === b.isSymbolInstance
    );
  }
}
EDot.prototype.k = E_DOT;

export class EIndex {
  declare target: any;
  declare index: any;
  declare closeBracketLoc: number;
  declare optionalChain: number;
  declare canBeRemovedIfUnused: boolean;
  declare callCanBeUnwrappedIfUnused: boolean;
  declare isSymbolInstance: boolean;
  declare k: any;
  constructor(
    target = null,
    index = null,
    closeBracketLoc = 0,
    optionalChain = OptionalChainNone,
    canBeRemovedIfUnused = false,
    callCanBeUnwrappedIfUnused = false,
    isSymbolInstance = false,
  ) {
    this.target = target;
    this.index = index;
    this.closeBracketLoc = closeBracketLoc;
    this.optionalChain = optionalChain;
    this.canBeRemovedIfUnused = canBeRemovedIfUnused;
    this.callCanBeUnwrappedIfUnused = callCanBeUnwrappedIfUnused;
    this.isSymbolInstance = isSymbolInstance;
  }
  hasSameFlagsAs(b) {
    return (
      this.optionalChain === b.optionalChain &&
      this.canBeRemovedIfUnused === b.canBeRemovedIfUnused &&
      this.callCanBeUnwrappedIfUnused === b.callCanBeUnwrappedIfUnused &&
      this.isSymbolInstance === b.isSymbolInstance
    );
  }
}
EIndex.prototype.k = E_INDEX;

export class EArrow {
  declare args: any[];
  declare body: FnBody;
  declare isAsync: boolean;
  declare hasRestArg: boolean;
  declare preferExpr: boolean;
  declare isParenthesized: boolean;
  declare hasNoSideEffectsComment: boolean;
  declare k: any;
  constructor(
    args = [],
    body = new FnBody(),
    isAsync = false,
    hasRestArg = false,
    preferExpr = false,
    isParenthesized = false,
    hasNoSideEffectsComment = false,
  ) {
    this.args = args;
    this.body = body; // FnBody (value)
    this.isAsync = isAsync;
    this.hasRestArg = hasRestArg;
    this.preferExpr = preferExpr;
    this.isParenthesized = isParenthesized;
    this.hasNoSideEffectsComment = hasNoSideEffectsComment;
  }
}
EArrow.prototype.k = E_ARROW;

export class EFunction {
  declare fn: Fn;
  declare isParenthesized: boolean;
  declare k: any;
  constructor(fn = new Fn(), isParenthesized = false) {
    this.fn = fn; // Fn (value)
    this.isParenthesized = isParenthesized;
  }
}
EFunction.prototype.k = E_FUNCTION;

export class EClass {
  declare class: Class;
  declare k: any;
  constructor(class_ = new Class()) {
    this.class = class_; // Class (value)
  }
}
EClass.prototype.k = E_CLASS;

export class EIdentifier {
  declare ref: number;
  declare mustKeepDueToWithStmt: boolean;
  declare canBeRemovedIfUnused: boolean;
  declare callCanBeUnwrappedIfUnused: boolean;
  declare k: any;
  constructor(ref = InvalidRef, mustKeepDueToWithStmt = false, canBeRemovedIfUnused = false, callCanBeUnwrappedIfUnused = false) {
    this.ref = ref;
    this.mustKeepDueToWithStmt = mustKeepDueToWithStmt;
    this.canBeRemovedIfUnused = canBeRemovedIfUnused;
    this.callCanBeUnwrappedIfUnused = callCanBeUnwrappedIfUnused;
  }
}
EIdentifier.prototype.k = E_IDENTIFIER;

export class EImportIdentifier {
  declare ref: number;
  declare preferQuotedKey: boolean;
  declare wasOriginallyIdentifier: boolean;
  declare k: any;
  constructor(ref = InvalidRef, preferQuotedKey = false, wasOriginallyIdentifier = false) {
    this.ref = ref;
    this.preferQuotedKey = preferQuotedKey;
    this.wasOriginallyIdentifier = wasOriginallyIdentifier;
  }
}
EImportIdentifier.prototype.k = E_IMPORT_IDENTIFIER;

export class EPrivateIdentifier {
  declare ref: number;
  declare k: any;
  constructor(ref = InvalidRef) {
    this.ref = ref;
  }
}
EPrivateIdentifier.prototype.k = E_PRIVATE_IDENTIFIER;

export class ENameOfSymbol {
  declare ref: number;
  declare hasPropertyKeyComment: boolean;
  declare k: any;
  constructor(ref = InvalidRef, hasPropertyKeyComment = false) {
    this.ref = ref;
    this.hasPropertyKeyComment = hasPropertyKeyComment;
  }
}
ENameOfSymbol.prototype.k = E_NAME_OF_SYMBOL;

export class EJSXElement {
  declare tagOrNil: any;
  declare properties: any[];
  declare nullableChildren: any[];
  declare closeLoc: number;
  declare isTagSingleLine: boolean;
  declare k: any;
  constructor(tagOrNil = null, properties = [], nullableChildren = [], closeLoc = 0, isTagSingleLine = false) {
    this.tagOrNil = tagOrNil;
    this.properties = properties;
    this.nullableChildren = nullableChildren; // []Expr, entries may be null
    this.closeLoc = closeLoc;
    this.isTagSingleLine = isTagSingleLine;
  }
}
EJSXElement.prototype.k = E_JSX_ELEMENT;

export class EJSXText {
  declare raw: string;
  declare k: any;
  constructor(raw = "") {
    this.raw = raw;
  }
}
EJSXText.prototype.k = E_JSX_TEXT;

export class ENumber {
  declare value: number;
  declare k: any;
  constructor(value = 0) {
    this.value = value;
  }
}
ENumber.prototype.k = E_NUMBER;

export class EBigInt {
  declare value: string;
  declare k: any;
  constructor(value = "") {
    this.value = value;
  }
}
EBigInt.prototype.k = E_BIG_INT;

export class EObject {
  declare properties: any[];
  declare commaAfterSpread: number;
  declare closeBraceLoc: number;
  declare isSingleLine: boolean;
  declare isParenthesized: boolean;
  declare k: any;
  constructor(properties = [], commaAfterSpread = 0, closeBraceLoc = 0, isSingleLine = false, isParenthesized = false) {
    this.properties = properties;
    this.commaAfterSpread = commaAfterSpread;
    this.closeBraceLoc = closeBraceLoc;
    this.isSingleLine = isSingleLine;
    this.isParenthesized = isParenthesized;
  }
}
EObject.prototype.k = E_OBJECT;

export class ESpread {
  declare value: any;
  declare k: any;
  constructor(value = null) {
    this.value = value;
  }
}
ESpread.prototype.k = E_SPREAD;

export class EString {
  declare value: string;
  declare legacyOctalLoc: number;
  declare preferTemplate: boolean;
  declare hasPropertyKeyComment: boolean;
  declare containsUniqueKey: boolean;
  declare k: any;
  constructor(value = "", legacyOctalLoc = 0, preferTemplate = false, hasPropertyKeyComment = false, containsUniqueKey = false) {
    this.value = value; // []uint16 as a JS string
    this.legacyOctalLoc = legacyOctalLoc;
    this.preferTemplate = preferTemplate;
    this.hasPropertyKeyComment = hasPropertyKeyComment;
    this.containsUniqueKey = containsUniqueKey;
  }
}
EString.prototype.k = E_STRING;

export class TemplatePart {
  declare value: any;
  declare tailRaw: string;
  declare tailCooked: string;
  declare tailLoc: number;
  constructor(value = null, tailRaw = "", tailCooked = "", tailLoc = 0) {
    this.value = value;
    this.tailRaw = tailRaw; // Only use when "TagOrNil" is not nil
    this.tailCooked = tailCooked; // []uint16; only use when "TagOrNil" is nil
    this.tailLoc = tailLoc;
  }
  clone() {
    return new TemplatePart(this.value, this.tailRaw, this.tailCooked, this.tailLoc);
  }
}

export class ETemplate {
  declare tagOrNil: any;
  declare headRaw: string;
  declare headCooked: string;
  declare parts: any[];
  declare headLoc: number;
  declare legacyOctalLoc: number;
  declare canBeUnwrappedIfUnused: boolean;
  declare tagWasOriginallyPropertyAccess: boolean;
  declare k: any;
  constructor(
    tagOrNil = null,
    headRaw = "",
    headCooked = "",
    parts = [],
    headLoc = 0,
    legacyOctalLoc = 0,
    canBeUnwrappedIfUnused = false,
    tagWasOriginallyPropertyAccess = false,
  ) {
    this.tagOrNil = tagOrNil;
    this.headRaw = headRaw;
    this.headCooked = headCooked; // []uint16
    this.parts = parts;
    this.headLoc = headLoc;
    this.legacyOctalLoc = legacyOctalLoc;
    this.canBeUnwrappedIfUnused = canBeUnwrappedIfUnused;
    this.tagWasOriginallyPropertyAccess = tagWasOriginallyPropertyAccess;
  }
}
ETemplate.prototype.k = E_TEMPLATE;

export class ERegExp {
  declare value: string;
  declare k: any;
  constructor(value = "") {
    this.value = value;
  }
}
ERegExp.prototype.k = E_REG_EXP;

export class EInlinedEnum {
  declare value: any;
  declare comment: string;
  declare k: any;
  constructor(value = null, comment = "") {
    this.value = value;
    this.comment = comment;
  }
}
EInlinedEnum.prototype.k = E_INLINED_ENUM;

// AnnotationFlags
export const CanBeRemovedIfUnusedFlag = 1;

export class EAnnotation {
  declare value: any;
  declare flags: number;
  declare k: any;
  constructor(value = null, flags = 0) {
    this.value = value;
    this.flags = flags;
  }
}
EAnnotation.prototype.k = E_ANNOTATION;

export class EAwait {
  declare value: any;
  declare k: any;
  constructor(value = null) {
    this.value = value;
  }
}
EAwait.prototype.k = E_AWAIT;

export class EYield {
  declare valueOrNil: any;
  declare isStar: boolean;
  declare k: any;
  constructor(valueOrNil = null, isStar = false) {
    this.valueOrNil = valueOrNil;
    this.isStar = isStar;
  }
}
EYield.prototype.k = E_YIELD;

export class EIf {
  declare test: any;
  declare yes: any;
  declare no: any;
  declare k: any;
  constructor(test = null, yes = null, no = null) {
    this.test = test;
    this.yes = yes;
    this.no = no;
  }
}
EIf.prototype.k = E_IF;

export class ERequireString {
  declare importRecordIndex: number;
  declare closeParenLoc: number;
  declare k: any;
  constructor(importRecordIndex = 0, closeParenLoc = 0) {
    this.importRecordIndex = importRecordIndex;
    this.closeParenLoc = closeParenLoc;
  }
}
ERequireString.prototype.k = E_REQUIRE_STRING;

export class ERequireResolveString {
  declare importRecordIndex: number;
  declare closeParenLoc: number;
  declare k: any;
  constructor(importRecordIndex = 0, closeParenLoc = 0) {
    this.importRecordIndex = importRecordIndex;
    this.closeParenLoc = closeParenLoc;
  }
}
ERequireResolveString.prototype.k = E_REQUIRE_RESOLVE_STRING;

export class EImportString {
  declare importRecordIndex: number;
  declare closeParenLoc: number;
  declare k: any;
  constructor(importRecordIndex = 0, closeParenLoc = 0) {
    this.importRecordIndex = importRecordIndex;
    this.closeParenLoc = closeParenLoc;
  }
}
EImportString.prototype.k = E_IMPORT_STRING;

export class EImportCall {
  declare expr: any;
  declare optionsOrNil: any;
  declare closeParenLoc: number;
  declare phase: number;
  declare k: any;
  constructor(expr = null, optionsOrNil = null, closeParenLoc = 0, phase = 0) {
    this.expr = expr;
    this.optionsOrNil = optionsOrNil;
    this.closeParenLoc = closeParenLoc;
    this.phase = phase; // ast.ImportPhase
  }
}
EImportCall.prototype.k = E_IMPORT_CALL;

// ---------------------------------------------------------------------------
// Statements

export const S_BLOCK = 1;
export const S_COMMENT = 2;
export const S_DEBUGGER = 3;
export const S_DIRECTIVE = 4;
export const S_EMPTY = 5;
export const S_TYPESCRIPT = 6;
export const S_EXPORT_CLAUSE = 7;
export const S_EXPORT_FROM = 8;
export const S_EXPORT_DEFAULT = 9;
export const S_EXPORT_STAR = 10;
export const S_EXPORT_EQUALS = 11;
export const S_LAZY_EXPORT = 12;
export const S_EXPR = 13;
export const S_ENUM = 14;
export const S_NAMESPACE = 15;
export const S_FUNCTION = 16;
export const S_CLASS = 17;
export const S_LABEL = 18;
export const S_IF = 19;
export const S_FOR = 20;
export const S_FOR_IN = 21;
export const S_FOR_OF = 22;
export const S_DO_WHILE = 23;
export const S_WHILE = 24;
export const S_WITH = 25;
export const S_TRY = 26;
export const S_SWITCH = 27;
export const S_IMPORT = 28;
export const S_RETURN = 29;
export const S_THROW = 30;
export const S_LOCAL = 31;
export const S_BREAK = 32;
export const S_CONTINUE = 33;

export class SBlock {
  declare stmts: any[];
  declare closeBraceLoc: number;
  declare k: any;
  constructor(stmts = [], closeBraceLoc = 0) {
    this.stmts = stmts;
    this.closeBraceLoc = closeBraceLoc;
  }
  clone() {
    return new SBlock(this.stmts, this.closeBraceLoc);
  }
}
SBlock.prototype.k = S_BLOCK;

export class SEmpty {
  declare k: any;}
SEmpty.prototype.k = S_EMPTY;

export class STypeScript {
  declare wasDeclareClass: boolean;
  declare k: any;
  constructor(wasDeclareClass = false) {
    this.wasDeclareClass = wasDeclareClass;
  }
}
STypeScript.prototype.k = S_TYPESCRIPT;

export class SComment {
  declare text: string;
  declare isLegalComment: boolean;
  declare k: any;
  constructor(text = "", isLegalComment = false) {
    this.text = text;
    this.isLegalComment = isLegalComment;
  }
}
SComment.prototype.k = S_COMMENT;

export class SDebugger {
  declare k: any;}
SDebugger.prototype.k = S_DEBUGGER;

export class SDirective {
  declare value: string;
  declare legacyOctalLoc: number;
  declare k: any;
  constructor(value = "", legacyOctalLoc = 0) {
    this.value = value; // []uint16
    this.legacyOctalLoc = legacyOctalLoc;
  }
}
SDirective.prototype.k = S_DIRECTIVE;

export const SDebuggerShared = new SDebugger();
export const SEmptyShared = new SEmpty();
export const STypeScriptShared = new STypeScript(false);
export const STypeScriptSharedWasDeclareClass = new STypeScript(true);

export class SExportClause {
  declare items: any[];
  declare isSingleLine: boolean;
  declare k: any;
  constructor(items = [], isSingleLine = false) {
    this.items = items; // []ClauseItem
    this.isSingleLine = isSingleLine;
  }
}
SExportClause.prototype.k = S_EXPORT_CLAUSE;

export class SExportFrom {
  declare items: any[];
  declare namespaceRef: number;
  declare importRecordIndex: number;
  declare isSingleLine: boolean;
  declare k: any;
  constructor(items = [], namespaceRef = InvalidRef, importRecordIndex = 0, isSingleLine = false) {
    this.items = items;
    this.namespaceRef = namespaceRef;
    this.importRecordIndex = importRecordIndex;
    this.isSingleLine = isSingleLine;
  }
}
SExportFrom.prototype.k = S_EXPORT_FROM;

export class SExportDefault {
  declare value: any;
  declare defaultName: LocRef;
  declare k: any;
  constructor(value = null, defaultName = new LocRef()) {
    this.value = value; // Stmt (SExpr, SFunction or SClass)
    this.defaultName = defaultName; // ast.LocRef (value)
  }
}
SExportDefault.prototype.k = S_EXPORT_DEFAULT;

export class ExportStarAlias {
  declare originalName: string;
  declare loc: number;
  constructor(originalName = "", loc = 0) {
    this.originalName = originalName;
    this.loc = loc;
  }
}

export class SExportStar {
  declare alias: any;
  declare namespaceRef: number;
  declare importRecordIndex: number;
  declare k: any;
  constructor(alias = null, namespaceRef = InvalidRef, importRecordIndex = 0) {
    this.alias = alias; // *ExportStarAlias
    this.namespaceRef = namespaceRef;
    this.importRecordIndex = importRecordIndex;
  }
}
SExportStar.prototype.k = S_EXPORT_STAR;

export class SExportEquals {
  declare value: any;
  declare k: any;
  constructor(value = null) {
    this.value = value;
  }
}
SExportEquals.prototype.k = S_EXPORT_EQUALS;

export class SLazyExport {
  declare value: any;
  declare k: any;
  constructor(value = null) {
    this.value = value;
  }
}
SLazyExport.prototype.k = S_LAZY_EXPORT;

export class SExpr {
  declare value: any;
  declare isFromClassOrFnThatCanBeRemovedIfUnused: boolean;
  declare k: any;
  constructor(value = null, isFromClassOrFnThatCanBeRemovedIfUnused = false) {
    this.value = value;
    this.isFromClassOrFnThatCanBeRemovedIfUnused = isFromClassOrFnThatCanBeRemovedIfUnused;
  }
}
SExpr.prototype.k = S_EXPR;

export class EnumValue {
  declare valueOrNil: any;
  declare name: string;
  declare ref: number;
  declare loc: number;
  constructor(valueOrNil = null, name = "", ref = InvalidRef, loc = 0) {
    this.valueOrNil = valueOrNil;
    this.name = name; // []uint16
    this.ref = ref;
    this.loc = loc;
  }
  clone() {
    return new EnumValue(this.valueOrNil, this.name, this.ref, this.loc);
  }
}

export class SEnum {
  declare values: any[];
  declare name: LocRef;
  declare arg: number;
  declare isExport: boolean;
  declare k: any;
  constructor(values = [], name = new LocRef(), arg = InvalidRef, isExport = false) {
    this.values = values;
    this.name = name;
    this.arg = arg;
    this.isExport = isExport;
  }
}
SEnum.prototype.k = S_ENUM;

export class SNamespace {
  declare stmts: any[];
  declare name: LocRef;
  declare arg: number;
  declare isExport: boolean;
  declare k: any;
  constructor(stmts = [], name = new LocRef(), arg = InvalidRef, isExport = false) {
    this.stmts = stmts;
    this.name = name;
    this.arg = arg;
    this.isExport = isExport;
  }
}
SNamespace.prototype.k = S_NAMESPACE;

export class SFunction {
  declare fn: Fn;
  declare isExport: boolean;
  declare k: any;
  constructor(fn = new Fn(), isExport = false) {
    this.fn = fn; // Fn (value)
    this.isExport = isExport;
  }
}
SFunction.prototype.k = S_FUNCTION;

export class SClass {
  declare class: Class;
  declare isExport: boolean;
  declare k: any;
  constructor(class_ = new Class(), isExport = false) {
    this.class = class_; // Class (value)
    this.isExport = isExport;
  }
}
SClass.prototype.k = S_CLASS;

export class SLabel {
  declare stmt: any;
  declare name: LocRef;
  declare isSingleLineStmt: boolean;
  declare k: any;
  constructor(stmt = null, name = new LocRef(), isSingleLineStmt = false) {
    this.stmt = stmt;
    this.name = name;
    this.isSingleLineStmt = isSingleLineStmt;
  }
}
SLabel.prototype.k = S_LABEL;

export class SIf {
  declare test: any;
  declare yes: any;
  declare noOrNil: any;
  declare isSingleLineYes: boolean;
  declare isSingleLineNo: boolean;
  declare k: any;
  constructor(test = null, yes = null, noOrNil = null, isSingleLineYes = false, isSingleLineNo = false) {
    this.test = test;
    this.yes = yes;
    this.noOrNil = noOrNil;
    this.isSingleLineYes = isSingleLineYes;
    this.isSingleLineNo = isSingleLineNo;
  }
}
SIf.prototype.k = S_IF;

export class SFor {
  declare initOrNil: any;
  declare testOrNil: any;
  declare updateOrNil: any;
  declare body: any;
  declare isSingleLineBody: boolean;
  declare isLoweredForAwait: boolean;
  declare k: any;
  constructor(initOrNil = null, testOrNil = null, updateOrNil = null, body = null, isSingleLineBody = false, isLoweredForAwait = false) {
    this.initOrNil = initOrNil; // Stmt
    this.testOrNil = testOrNil; // Expr
    this.updateOrNil = updateOrNil; // Expr
    this.body = body; // Stmt
    this.isSingleLineBody = isSingleLineBody;
    this.isLoweredForAwait = isLoweredForAwait;
  }
}
SFor.prototype.k = S_FOR;

export class SForIn {
  declare init: any;
  declare value: any;
  declare body: any;
  declare isSingleLineBody: boolean;
  declare k: any;
  constructor(init = null, value = null, body = null, isSingleLineBody = false) {
    this.init = init;
    this.value = value;
    this.body = body;
    this.isSingleLineBody = isSingleLineBody;
  }
}
SForIn.prototype.k = S_FOR_IN;

export class SForOf {
  declare init: any;
  declare value: any;
  declare body: any;
  declare await: Range;
  declare isSingleLineBody: boolean;
  declare k: any;
  constructor(init = null, value = null, body = null, await_ = RANGE_ZERO, isSingleLineBody = false) {
    this.init = init;
    this.value = value;
    this.body = body;
    this.await = await_; // logger.Range
    this.isSingleLineBody = isSingleLineBody;
  }
}
SForOf.prototype.k = S_FOR_OF;

export class SDoWhile {
  declare body: any;
  declare test: any;
  declare k: any;
  constructor(body = null, test = null) {
    this.body = body;
    this.test = test;
  }
}
SDoWhile.prototype.k = S_DO_WHILE;

export class SWhile {
  declare test: any;
  declare body: any;
  declare isSingleLineBody: boolean;
  declare k: any;
  constructor(test = null, body = null, isSingleLineBody = false) {
    this.test = test;
    this.body = body;
    this.isSingleLineBody = isSingleLineBody;
  }
}
SWhile.prototype.k = S_WHILE;

export class SWith {
  declare value: any;
  declare body: any;
  declare bodyLoc: number;
  declare isSingleLineBody: boolean;
  declare k: any;
  constructor(value = null, body = null, bodyLoc = 0, isSingleLineBody = false) {
    this.value = value;
    this.body = body;
    this.bodyLoc = bodyLoc;
    this.isSingleLineBody = isSingleLineBody;
  }
}
SWith.prototype.k = S_WITH;

export class Catch {
  declare bindingOrNil: any;
  declare block: SBlock;
  declare loc: number;
  declare blockLoc: number;
  constructor(bindingOrNil = null, block = new SBlock(), loc = 0, blockLoc = 0) {
    this.bindingOrNil = bindingOrNil; // Binding
    this.block = block; // SBlock (value)
    this.loc = loc;
    this.blockLoc = blockLoc;
  }
}

export class Finally {
  declare block: SBlock;
  declare loc: number;
  constructor(block = new SBlock(), loc = 0) {
    this.block = block; // SBlock (value)
    this.loc = loc;
  }
}

export class STry {
  declare catch: any;
  declare finally: any;
  declare block: SBlock;
  declare blockLoc: number;
  declare k: any;
  constructor(catch_ = null, finally_ = null, block = new SBlock(), blockLoc = 0) {
    this.catch = catch_; // *Catch
    this.finally = finally_; // *Finally
    this.block = block; // SBlock (value)
    this.blockLoc = blockLoc;
  }
}
STry.prototype.k = S_TRY;

export class Case {
  declare valueOrNil: any;
  declare body: any[];
  declare loc: number;
  constructor(valueOrNil = null, body = [], loc = 0) {
    this.valueOrNil = valueOrNil; // Expr; null means "default"
    this.body = body; // []Stmt
    this.loc = loc;
  }
  clone() {
    return new Case(this.valueOrNil, this.body, this.loc);
  }
}

export class SSwitch {
  declare test: any;
  declare cases: any[];
  declare bodyLoc: number;
  declare closeBraceLoc: number;
  declare k: any;
  constructor(test = null, cases = [], bodyLoc = 0, closeBraceLoc = 0) {
    this.test = test;
    this.cases = cases;
    this.bodyLoc = bodyLoc;
    this.closeBraceLoc = closeBraceLoc;
  }
}
SSwitch.prototype.k = S_SWITCH;

export class SImport {
  declare defaultName: any;
  declare items: any;
  declare starNameLoc: any;
  declare namespaceRef: number;
  declare importRecordIndex: number;
  declare isSingleLine: boolean;
  declare k: any;
  constructor(defaultName = null, items = null, starNameLoc = null, namespaceRef = InvalidRef, importRecordIndex = 0, isSingleLine = false) {
    this.defaultName = defaultName; // *ast.LocRef
    this.items = items; // *[]ClauseItem -> array or null
    this.starNameLoc = starNameLoc; // *logger.Loc -> number or null
    this.namespaceRef = namespaceRef;
    this.importRecordIndex = importRecordIndex;
    this.isSingleLine = isSingleLine;
  }
}
SImport.prototype.k = S_IMPORT;

export class SReturn {
  declare valueOrNil: any;
  declare k: any;
  constructor(valueOrNil = null) {
    this.valueOrNil = valueOrNil;
  }
}
SReturn.prototype.k = S_RETURN;

export class SThrow {
  declare value: any;
  declare k: any;
  constructor(value = null) {
    this.value = value;
  }
}
SThrow.prototype.k = S_THROW;

// LocalKind
export const LocalVar = 0;
export const LocalLet = 1;
export const LocalConst = 2;
export const LocalUsing = 3;
export const LocalAwaitUsing = 4;

export function localKindIsUsing(kind) {
  return kind >= LocalUsing;
}

export class SLocal {
  declare decls: any[];
  declare kind: number;
  declare isExport: boolean;
  declare wasTSImportEquals: boolean;
  declare k: any;
  constructor(decls = [], kind = LocalVar, isExport = false, wasTSImportEquals = false) {
    this.decls = decls; // []Decl
    this.kind = kind;
    this.isExport = isExport;
    this.wasTSImportEquals = wasTSImportEquals;
  }
}
SLocal.prototype.k = S_LOCAL;

export class SBreak {
  declare label: any;
  declare k: any;
  constructor(label = null) {
    this.label = label; // *ast.LocRef
  }
}
SBreak.prototype.k = S_BREAK;

export class SContinue {
  declare label: any;
  declare k: any;
  constructor(label = null) {
    this.label = label; // *ast.LocRef
  }
}
SContinue.prototype.k = S_CONTINUE;

export class ClauseItem {
  declare alias: string;
  declare originalName: string;
  declare aliasLoc: number;
  declare name: LocRef;
  constructor(alias = "", originalName = "", aliasLoc = 0, name = new LocRef()) {
    this.alias = alias;
    this.originalName = originalName;
    this.aliasLoc = aliasLoc;
    this.name = name; // ast.LocRef (value)
  }
  clone() {
    return new ClauseItem(this.alias, this.originalName, this.aliasLoc, this.name);
  }
}

export class Decl {
  declare binding: any;
  declare valueOrNil: any;
  constructor(binding = null, valueOrNil = null) {
    this.binding = binding; // Binding
    this.valueOrNil = valueOrNil; // Expr
  }
  clone() {
    return new Decl(this.binding, this.valueOrNil);
  }
}

// ---------------------------------------------------------------------------
// Scopes

// ScopeKind
export const ScopeBlock = 0;
export const ScopeWith = 1;
export const ScopeLabel = 2;
export const ScopeClassName = 3;
export const ScopeClassBody = 4;
export const ScopeCatchBinding = 5;
// The scopes below stop hoisted variables from extending into parent scopes
export const ScopeEntry = 6;
export const ScopeFunctionArgs = 7;
export const ScopeFunctionBody = 8;
export const ScopeClassStaticInit = 9;

export function scopeKindStopsHoisting(kind) {
  return kind >= ScopeEntry;
}

export class ScopeMember {
  declare ref: number;
  declare loc: number;
  constructor(ref = InvalidRef, loc = 0) {
    this.ref = ref;
    this.loc = loc;
  }
}

// StrictModeKind
export const SloppyMode = 0;
export const ExplicitStrictMode = 1;
export const ImplicitStrictModeClass = 2;
export const ImplicitStrictModeESM = 3;
export const ImplicitStrictModeTSAlwaysStrict = 4;
export const ImplicitStrictModeJSXAutomaticRuntime = 5;

export class Scope {
  declare tsNamespace: any;
  declare parent: any;
  declare children: any[];
  declare members: Map<any, any>;
  declare replaced: any[];
  declare generated: any[];
  declare useStrictLoc: number;
  declare label: LocRef;
  declare labelStmtIsLoop: boolean;
  declare containsDirectEval: boolean;
  declare forbidArguments: boolean;
  declare isAfterConstLocalPrefix: boolean;
  declare strictMode: number;
  declare kind: number;
  declare renamerStamp: number;
  constructor(
    tsNamespace = null,
    parent = null,
    children = [],
    members = new Map(), // map[string]ScopeMember
    replaced = [], // []ScopeMember
    generated = [], // []ast.Ref
    useStrictLoc = 0,
    label = new LocRef(),
    labelStmtIsLoop = false,
    containsDirectEval = false,
    forbidArguments = false,
    isAfterConstLocalPrefix = false,
    strictMode = SloppyMode,
    kind = ScopeBlock,
  ) {
    this.tsNamespace = tsNamespace;
    this.parent = parent;
    this.children = children;
    this.members = members;
    this.replaced = replaced;
    this.generated = generated;
    this.useStrictLoc = useStrictLoc;
    this.label = label;
    this.labelStmtIsLoop = labelStmtIsLoop;
    this.containsDirectEval = containsDirectEval;
    this.forbidArguments = forbidArguments;
    this.isAfterConstLocalPrefix = isAfterConstLocalPrefix;
    this.strictMode = strictMode;
    this.kind = kind;
    // JS-only: see NumberRenamer.assignNamesByScope
    this.renamerStamp = 0;
  }
  recursiveSetStrictMode(kind) {
    if (this.strictMode === SloppyMode) {
      this.strictMode = kind;
      const children = this.children;
      for (let i = 0; i < children.length; i++) children[i].recursiveSetStrictMode(kind);
    }
  }
}

export class TSNamespaceScope {
  declare exportedMembers: Map<any, any>;
  declare lazilyGeneratedProperyAccesses: any;
  declare argRef: number;
  declare isEnumScope: boolean;
  constructor(exportedMembers = new Map(), lazilyGeneratedProperyAccesses = null, argRef = InvalidRef, isEnumScope = false) {
    this.exportedMembers = exportedMembers; // TSNamespaceMembers = Map<string, TSNamespaceMember>
    this.lazilyGeneratedProperyAccesses = lazilyGeneratedProperyAccesses; // Map<string, Ref> | null
    this.argRef = argRef;
    this.isEnumScope = isEnumScope;
  }
}

export class TSNamespaceMember {
  declare data: any;
  declare loc: number;
  declare isEnumValue: boolean;
  constructor(data = null, loc = 0, isEnumValue = false) {
    this.data = data; // TSNamespaceMemberData
    this.loc = loc;
    this.isEnumValue = isEnumValue;
  }
}

// TSNamespaceMemberData kinds
export const TS_NAMESPACE_MEMBER_PROPERTY = 1;
export const TS_NAMESPACE_MEMBER_NAMESPACE = 2;
export const TS_NAMESPACE_MEMBER_ENUM_NUMBER = 3;
export const TS_NAMESPACE_MEMBER_ENUM_STRING = 4;

export class TSNamespaceMemberProperty {
  declare k: any;}
TSNamespaceMemberProperty.prototype.k = TS_NAMESPACE_MEMBER_PROPERTY;

export class TSNamespaceMemberNamespace {
  declare exportedMembers: Map<any, any>;
  declare k: any;
  constructor(exportedMembers = new Map()) {
    this.exportedMembers = exportedMembers;
  }
}
TSNamespaceMemberNamespace.prototype.k = TS_NAMESPACE_MEMBER_NAMESPACE;

export class TSNamespaceMemberEnumNumber {
  declare value: number;
  declare k: any;
  constructor(value = 0) {
    this.value = value;
  }
}
TSNamespaceMemberEnumNumber.prototype.k = TS_NAMESPACE_MEMBER_ENUM_NUMBER;

export class TSNamespaceMemberEnumString {
  declare value: string;
  declare k: any;
  constructor(value = "") {
    this.value = value; // []uint16
  }
}
TSNamespaceMemberEnumString.prototype.k = TS_NAMESPACE_MEMBER_ENUM_STRING;

// ExportsKind
export const ExportsNone = 0;
export const ExportsCommonJS = 1;
export const ExportsESM = 2;
export const ExportsESMWithDynamicFallback = 3;

export function exportsKindIsDynamic(kind) {
  return kind === ExportsCommonJS || kind === ExportsESMWithDynamicFallback;
}

// ModuleType
export const ModuleUnknown = 0;
export const ModuleCommonJS_CJS = 1;
export const ModuleCommonJS_CTS = 2;
export const ModuleCommonJS_PackageJSON = 3;
export const ModuleESM_MJS = 4;
export const ModuleESM_MTS = 5;
export const ModuleESM_PackageJSON = 6;

export function moduleTypeIsCommonJS(mt) {
  return mt >= ModuleCommonJS_CJS && mt <= ModuleCommonJS_PackageJSON;
}
export function moduleTypeIsESM(mt) {
  return mt >= ModuleESM_MJS && mt <= ModuleESM_PackageJSON;
}

export class ModuleTypeData {
  declare source: any;
  declare range: Range;
  declare type: number;
  constructor(source = null, range = RANGE_ZERO, type = ModuleUnknown) {
    this.source = source;
    this.range = range;
    this.type = type;
  }
}

export const NSExportPartIndex = 0;

export class AST {
  declare moduleTypeData: ModuleTypeData;
  declare parts: any[];
  declare symbols: any[];
  declare exprComments: any;
  declare moduleScope: any;
  declare charFreq: any;
  declare manifestForYarnPnP: any;
  declare hashbang: string;
  declare directives: any[];
  declare urlForCSS: string;
  declare topLevelSymbolToPartsFromParser: any;
  declare tsEnums: any;
  declare constValues: any;
  declare mangledProps: any;
  declare reservedProps: any;
  declare importRecords: any[];
  declare namedImports: any;
  declare namedExports: any;
  declare exportStarImportRecords: any[];
  declare sourceMapComment: any;
  declare exportKeyword: Range;
  declare topLevelAwaitKeyword: Range;
  declare liveTopLevelAwaitKeyword: Range;
  declare exportsRef: number;
  declare moduleRef: number;
  declare wrapperRef: number;
  declare approximateLineCount: number;
  declare nestedScopeSlotCounts: any;
  declare hasLazyExport: boolean;
  declare usesExportsRef: boolean;
  declare usesModuleRef: boolean;
  declare exportsKind: number;
  constructor() {
    this.moduleTypeData = new ModuleTypeData();
    this.parts = []; // []Part
    this.symbols = []; // []ast.Symbol
    this.exprComments = null; // Map<Loc, string[]>
    this.moduleScope = null;
    this.charFreq = null;
    this.manifestForYarnPnP = null;
    this.hashbang = "";
    this.directives = []; // []string
    this.urlForCSS = "";
    this.topLevelSymbolToPartsFromParser = null; // Map<Ref, number[]>
    this.tsEnums = null; // Map<Ref, Map<string, TSEnumValue>>
    this.constValues = null; // Map<Ref, ConstValue>
    this.mangledProps = null;
    this.reservedProps = null;
    this.importRecords = []; // []ast.ImportRecord
    this.namedImports = null; // Map<Ref, NamedImport>
    this.namedExports = null; // Map<string, NamedExport>
    this.exportStarImportRecords = []; // []uint32
    this.sourceMapComment = null; // logger.Span
    this.exportKeyword = RANGE_ZERO;
    this.topLevelAwaitKeyword = RANGE_ZERO;
    this.liveTopLevelAwaitKeyword = RANGE_ZERO;
    this.exportsRef = InvalidRef;
    this.moduleRef = InvalidRef;
    this.wrapperRef = InvalidRef;
    this.approximateLineCount = 0;
    this.nestedScopeSlotCounts = [0, 0, 0, 0];
    this.hasLazyExport = false;
    this.usesExportsRef = false;
    this.usesModuleRef = false;
    this.exportsKind = ExportsNone;
  }
}

export class TSEnumValue {
  declare string: any;
  declare number: number;
  constructor(string = null, number = 0) {
    this.string = string; // []uint16 or null ("Use this if it's not nil")
    this.number = number;
  }
}

// ConstValueKind
export const ConstValueNone = 0;
export const ConstValueNull = 1;
export const ConstValueUndefined = 2;
export const ConstValueTrue = 3;
export const ConstValueFalse = 4;
export const ConstValueNumber = 5;
export const ConstValueString = 6;

export class ConstValue {
  declare number: number;
  declare string: string;
  declare kind: number;
  constructor(number = 0, string = "", kind = ConstValueNone) {
    this.number = number;
    this.string = string; // []uint16
    this.kind = kind;
  }
}

export function exprToConstValue(expr) {
  const v = expr.data;
  switch (v.k) {
    case E_NULL:
      return new ConstValue(0, "", ConstValueNull);
    case E_UNDEFINED:
      return new ConstValue(0, "", ConstValueUndefined);
    case E_BOOLEAN:
      return new ConstValue(0, "", v.value ? ConstValueTrue : ConstValueFalse);
    case E_NUMBER: {
      // Inline integers and other small numbers. Don't inline large
      // real numbers because people may not want them to be inlined
      // as it will increase the minified code size by too much.
      // Go: int64(v) conversion; values outside int64 range give an
      // implementation-specific result that is never equal to v.
      const x = v.value;
      const asInt = Math.abs(x) < 9223372036854775808 ? Math.trunc(x) : NaN;
      if (x === asInt || formatFloatG(x).length <= 8) {
        return new ConstValue(x, "", ConstValueNumber);
      }
      break;
    }
    case E_STRING:
      // Deliberately only inline small strings.
      if (v.value.length <= 3) return new ConstValue(0, v.value, ConstValueString);
      break;
  }
  return new ConstValue();
}

export function constValueToExpr(loc, value) {
  switch (value.kind) {
    case ConstValueNull:
      return new Expr(ENullShared, loc);
    case ConstValueUndefined:
      return new Expr(EUndefinedShared, loc);
    case ConstValueTrue:
      return new Expr(new EBoolean(true), loc);
    case ConstValueFalse:
      return new Expr(new EBoolean(false), loc);
    case ConstValueNumber:
      return new Expr(new ENumber(value.number), loc);
    case ConstValueString:
      return new Expr(new EString(value.string), loc);
  }
  throw new globalThis.Error("Internal error: invalid constant value");
}

export class NamedImport {
  declare alias: string;
  declare localPartsWithUses: any[];
  declare aliasLoc: number;
  declare namespaceRef: number;
  declare importRecordIndex: number;
  declare aliasIsStar: boolean;
  declare isExported: boolean;
  constructor(
    alias = "",
    localPartsWithUses = [],
    aliasLoc = 0,
    namespaceRef = InvalidRef,
    importRecordIndex = 0,
    aliasIsStar = false,
    isExported = false,
  ) {
    this.alias = alias;
    this.localPartsWithUses = localPartsWithUses; // []uint32
    this.aliasLoc = aliasLoc;
    this.namespaceRef = namespaceRef;
    this.importRecordIndex = importRecordIndex;
    this.aliasIsStar = aliasIsStar;
    this.isExported = isExported;
  }
  clone() {
    return new NamedImport(
      this.alias,
      this.localPartsWithUses,
      this.aliasLoc,
      this.namespaceRef,
      this.importRecordIndex,
      this.aliasIsStar,
      this.isExported,
    );
  }
}

export class NamedExport {
  declare ref: number;
  declare aliasLoc: number;
  constructor(ref = InvalidRef, aliasLoc = 0) {
    this.ref = ref;
    this.aliasLoc = aliasLoc;
  }
}

export class Part {
  declare stmts: any[];
  declare scopes: any[];
  declare importRecordIndices: any[];
  declare declaredSymbols: any[];
  declare symbolUses: Map<any, any>;
  declare symbolCallUses: Map<any, any>;
  declare importSymbolPropertyUses: Map<any, any>;
  declare dependencies: any[];
  declare canBeRemovedIfUnused: boolean;
  declare forceTreeShaking: boolean;
  declare isLive: boolean;
  constructor() {
    this.stmts = []; // []Stmt
    this.scopes = []; // []*Scope
    this.importRecordIndices = []; // []uint32
    this.declaredSymbols = []; // []DeclaredSymbol
    this.symbolUses = new Map(); // Map<Ref, SymbolUse>
    this.symbolCallUses = new Map(); // Map<Ref, SymbolCallUse>
    this.importSymbolPropertyUses = new Map(); // Map<Ref, Map<string, SymbolUse>>
    this.dependencies = []; // []Dependency
    this.canBeRemovedIfUnused = false;
    this.forceTreeShaking = false;
    this.isLive = false;
  }
  // Shallow copy like a Go struct assignment
  clone() {
    const p = new Part();
    p.stmts = this.stmts;
    p.scopes = this.scopes;
    p.importRecordIndices = this.importRecordIndices;
    p.declaredSymbols = this.declaredSymbols;
    p.symbolUses = this.symbolUses;
    p.symbolCallUses = this.symbolCallUses;
    p.importSymbolPropertyUses = this.importSymbolPropertyUses;
    p.dependencies = this.dependencies;
    p.canBeRemovedIfUnused = this.canBeRemovedIfUnused;
    p.forceTreeShaking = this.forceTreeShaking;
    p.isLive = this.isLive;
    return p;
  }
}

export class Dependency {
  declare sourceIndex: number;
  declare partIndex: number;
  constructor(sourceIndex = 0, partIndex = 0) {
    this.sourceIndex = sourceIndex;
    this.partIndex = partIndex;
  }
}

export class DeclaredSymbol {
  declare ref: number;
  declare isTopLevel: boolean;
  constructor(ref = InvalidRef, isTopLevel = false) {
    this.ref = ref;
    this.isTopLevel = isTopLevel;
  }
}

export class SymbolUse {
  declare countEstimate: number;
  constructor(countEstimate = 0) {
    this.countEstimate = countEstimate;
  }
}

export class SymbolCallUse {
  declare callCountEstimate: number;
  declare singleArgNonSpreadCallCountEstimate: number;
  constructor(callCountEstimate = 0, singleArgNonSpreadCallCountEstimate = 0) {
    this.callCountEstimate = callCountEstimate;
    this.singleArgNonSpreadCallCountEstimate = singleArgNonSpreadCallCountEstimate;
  }
}

// For readability, the names of certain automatically-generated symbols are
// derived from the file name (e.g. "require_react").
export function generateNonUniqueNameFromPath(path) {
  // Get the file name without the extension
  const $d235 = platformIndependentPathDirBaseExt(path);
  let dir = $d235[0], base = $d235[1];

  // If the name is "index", use the directory name instead.
  if (base === "index") {
    const $d236 = platformIndependentPathDirBaseExt(dir);
    const dirBase = $d236[1];
    if (dirBase !== "") base = dirBase;
  }

  return ensureValidIdentifier(base);
}

export function ensureValidIdentifier(base) {
  // Convert it to an ASCII identifier. Go iterates runes; a non-ASCII rune
  // just marks a gap, exactly like any other invalid character.
  let bytes = "";
  let needsGap = false;
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (bytes.length > 0 && c >= 48 && c <= 57)) {
      if (needsGap) {
        bytes += "_";
        needsGap = false;
      }
      bytes += base[i];
    } else if (bytes.length > 0) {
      needsGap = true;
    }
  }

  // Make sure the name isn't empty
  if (bytes.length === 0) return "_";
  return bytes;
}
