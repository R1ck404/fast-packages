// Port of internal/js_ast/js_ast_helpers.go. See CONVENTIONS.md.
//
// Notes on representation:
// - Functions that take a Go "E" take the data object (expr.data); a nil E is
//   null. Functions that take a Go "Expr" take the Expr wrapper; Expr{} is null.
//   Go's type switches silently fall through for nil data, so every function
//   here tolerates null in the same way.
// - Multiple return values are arrays: [value, ok], [a, b, ok], ...
// - Go compares Expr structs with "==" (same Loc and same Data pointer). This
//   is replicated by exprIdentical() below.
// - Numeric folding must match esbuild-wasm bit for bit. On wasm, Go's
//   math.Pow/Exp/Log/Frexp/Ldexp/Mod are the pure-Go versions (no assembly),
//   and float->int conversions are saturating. Those functions are ported
//   below ("Go math" section; they were checked against Go compiled for
//   js/wasm while porting).
import { GoPanic } from "./gopanic.mjs";
import { goIntFromFloat } from "./gostd.mjs";
import { jsFeatureHas, TypeofExoticObjectIsObject, OptionalChain, NullishCoalescing } from "./compat.mjs";
import { utf16EqualsString, utf16EqualsUTF16 } from "./helpers.mjs";
import {
  Expr,
  Stmt,
  EArray,
  EUnary,
  EBinary,
  EBoolean,
  EMissing,
  ECall,
  EArrow,
  EIdentifier,
  ENumber,
  EObject,
  ESpread,
  EString,
  ETemplate,
  TemplatePart,
  EIf,
  EUndefinedShared,
  FnBody,
  SBlock,
  SExpr,
  SReturn,
  Property,
  B_MISSING,
  B_IDENTIFIER,
  B_ARRAY,
  B_OBJECT,
  E_ARRAY,
  E_UNARY,
  E_BINARY,
  E_BOOLEAN,
  E_NULL,
  E_UNDEFINED,
  E_THIS,
  E_NEW,
  E_IMPORT_META,
  E_CALL,
  E_DOT,
  E_INDEX,
  E_ARROW,
  E_FUNCTION,
  E_CLASS,
  E_IDENTIFIER,
  E_IMPORT_IDENTIFIER,
  E_MISSING,
  E_NUMBER,
  E_BIG_INT,
  E_OBJECT,
  E_SPREAD,
  E_STRING,
  E_TEMPLATE,
  E_REG_EXP,
  E_INLINED_ENUM,
  E_ANNOTATION,
  E_IF,
  S_EMPTY,
  S_EXPORT_CLAUSE,
  S_EXPORT_FROM,
  S_EXPORT_DEFAULT,
  S_EXPR,
  S_FUNCTION,
  S_CLASS,
  S_TRY,
  S_IMPORT,
  S_RETURN,
  S_LOCAL,
  UnOpPos,
  UnOpNeg,
  UnOpCpl,
  UnOpNot,
  UnOpVoid,
  UnOpTypeof,
  UnOpDelete,
  UnOpPreDec,
  UnOpPreInc,
  UnOpPostDec,
  UnOpPostInc,
  BinOpAdd,
  BinOpSub,
  BinOpMul,
  BinOpDiv,
  BinOpRem,
  BinOpPow,
  BinOpLt,
  BinOpLe,
  BinOpGt,
  BinOpGe,
  BinOpIn,
  BinOpInstanceof,
  BinOpShl,
  BinOpShr,
  BinOpUShr,
  BinOpLooseEq,
  BinOpLooseNe,
  BinOpStrictEq,
  BinOpStrictNe,
  BinOpNullishCoalescing,
  BinOpLogicalOr,
  BinOpLogicalAnd,
  BinOpBitwiseOr,
  BinOpBitwiseAnd,
  BinOpBitwiseXor,
  BinOpComma,
  BinOpAssign,
  BinOpAddAssign,
  BinOpSubAssign,
  BinOpMulAssign,
  BinOpDivAssign,
  BinOpRemAssign,
  BinOpPowAssign,
  BinOpShlAssign,
  BinOpShrAssign,
  BinOpUShrAssign,
  BinOpBitwiseOrAssign,
  BinOpBitwiseAndAssign,
  BinOpBitwiseXorAssign,
  OptionalChainNone,
  OptionalChainStart,
  OptionalChainContinue,
  PropertyField,
  PropertyGetter,
  PropertySetter,
  PropertySpread,
  PropertyClassStaticBlock,
  PropertyIsComputed,
  PropertyIsStatic,
  CanBeRemovedIfUnusedFlag,
  LocalAwaitUsing,
  localKindIsUsing,
  propertyKindIsMethodDefinition,
} from "./js_ast.mjs";

// ---------------------------------------------------------------------------
// Go math (pure-Go implementations, as used by esbuild-wasm)

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
const HI = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 1 : 0; // index of the high word

const SmallestNormal = 2.2250738585072014e-308; // 2**-1022

// math.Signbit
function signbit(x) {
  return x < 0 || (x === 0 && 1 / x < 0);
}

// math.Copysign
function copysign(f, sign) {
  const a = Math.abs(f);
  return signbit(sign) ? -a : a;
}

// math.Frexp. Returns [frac, exp].
export function goMathFrexp(f) {
  if (f === 0) return [f, 0]; // correctly return -0
  if (f !== f || f === Infinity || f === -Infinity) return [f, 0];
  let exp = 0;
  // normalize
  if (Math.abs(f) < SmallestNormal) {
    f = f * 4503599627370496; // 1 << 52
    exp = -52;
  }
  F64[0] = f;
  const hi = U32[HI];
  exp += ((hi >>> 20) & 0x7ff) - 1023 + 1;
  U32[HI] = (hi & 0x800fffff) | ((-1 + 1023) << 20);
  return [F64[0], exp];
}

// math.Ldexp
export function goMathLdexp(frac, exp) {
  if (frac === 0) return frac; // correctly return -0
  if (frac !== frac || frac === Infinity || frac === -Infinity) return frac;
  // normalize
  if (Math.abs(frac) < SmallestNormal) {
    frac = frac * 4503599627370496; // 1 << 52
    exp += -52;
  }
  F64[0] = frac;
  const hi = U32[HI];
  exp += ((hi >>> 20) & 0x7ff) - 1023;
  if (exp < -1075) {
    return copysign(0, frac); // underflow
  }
  if (exp > 1023) {
    // overflow
    if (frac < 0) return -Infinity;
    return Infinity;
  }
  let m = 1;
  if (exp < -1022) {
    // denormal
    exp += 53;
    m = 1.0 / 9007199254740992; // 2**-53
  }
  U32[HI] = (hi & 0x800fffff) | ((exp + 1023) << 20);
  return m * F64[0];
}

// math.Modf (Go 1.26 formulation: Trunc + Copysign). Returns [int, frac].
export function goMathModf(f) {
  const integer = Math.trunc(f);
  return [integer, copysign(f - integer, f)];
}

function isOddInt(x) {
  if (Math.abs(x) >= 9007199254740992) {
    // 1 << 53 is the largest exact integer in the float64 format.
    return false;
  }
  const $d0 = goMathModf(x);
  const xi = $d0[0], xf = $d0[1];
  return xf === 0 && Math.abs(xi) % 2 === 1;
}

// math.Mod
export function goMathMod(x, y) {
  if (y === 0 || x === Infinity || x === -Infinity || x !== x || y !== y) {
    return NaN;
  }
  y = Math.abs(y);

  const $d1 = goMathFrexp(y);
  const yfr = $d1[0], yexp = $d1[1];
  let r = x;
  if (x < 0) {
    r = -x;
  }

  while (r >= y) {
    const $d2 = goMathFrexp(r);
    let rfr = $d2[0], rexp = $d2[1];
    if (rfr < yfr) {
      rexp = rexp - 1;
    }
    r = r - goMathLdexp(y, rexp - yexp);
  }
  if (x < 0) {
    r = -r;
  }
  return r;
}

// math.Log (pure Go version; amd64 uses assembly, wasm does not)
export function goMathLog(x) {
  const Ln2Hi = 6.93147180369123816490e-1; /* 3fe62e42 fee00000 */
  const Ln2Lo = 1.90821492927058770002e-10; /* 3dea39ef 35793c76 */
  const L1 = 6.666666666666735130e-1; /* 3FE55555 55555593 */
  const L2 = 3.999999999940941908e-1; /* 3FD99999 9997FA04 */
  const L3 = 2.857142874366239149e-1; /* 3FD24924 94229359 */
  const L4 = 2.222219843214978396e-1; /* 3FCC71C5 1D8E78AF */
  const L5 = 1.818357216161805012e-1; /* 3FC74664 96CB03DE */
  const L6 = 1.531383769920937332e-1; /* 3FC39A09 D078C69F */
  const L7 = 1.479819860511658591e-1; /* 3FC2F112 DF3E5244 */

  if (x !== x || x === Infinity) return x;
  if (x < 0) return NaN;
  if (x === 0) return -Infinity;

  const $d3 = goMathFrexp(x);
  let f1 = $d3[0], ki = $d3[1];
  if (f1 < Math.SQRT2 / 2) {
    f1 *= 2;
    ki--;
  }
  const f = f1 - 1;
  const k = ki;

  const s = f / (2 + f);
  const s2 = s * s;
  const s4 = s2 * s2;
  const t1 = s2 * (L1 + s4 * (L3 + s4 * (L5 + s4 * L7)));
  const t2 = s4 * (L2 + s4 * (L4 + s4 * L6));
  const R = t1 + t2;
  const hfsq = 0.5 * f * f;
  return k * Ln2Hi - (hfsq - (s * (hfsq + R) + k * Ln2Lo) - f);
}

// The float64 value of Go's untyped constant expression "1 / math.Ln10"
// (verified against Go while porting).
const INV_LN10 = 0.4342944819032518;

// math.Log10
export function goMathLog10(x) {
  return goMathLog(x) * INV_LN10;
}

function expmulti(hi, lo, k) {
  const P1 = 1.66666666666666657415e-1; /* 0x3FC55555; 0x55555555 */
  const P2 = -2.77777777770155933842e-3; /* 0xBF66C16C; 0x16BEBD93 */
  const P3 = 6.61375632143793436117e-5; /* 0x3F11566A; 0xAF25DE2C */
  const P4 = -1.6533902205465251539e-6; /* 0xBEBBBD41; 0xC5D26BF1 */
  const P5 = 4.13813679705723846039e-8; /* 0x3E663769; 0x72BEA4D0 */

  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  return goMathLdexp(y, k);
}

// math.Exp (pure Go version; amd64/arm64 use assembly, wasm does not)
export function goMathExp(x) {
  const Ln2Hi = 6.93147180369123816490e-1;
  const Ln2Lo = 1.90821492927058770002e-10;
  const Log2e = 1.44269504088896338700e0;

  const Overflow = 7.09782712893383973096e2;
  const Underflow = -7.45133219101941108420e2;
  const NearZero = 1.0 / (1 << 28); // 2**-28

  if (x !== x) return x;
  if (x > Overflow) return Infinity; // handles case where x is +Inf
  if (x < Underflow) return 0; // handles case where x is -Inf
  if (-NearZero < x && x < NearZero) return 1 + x;

  // reduce; computed as r = hi - lo for extra precision.
  let k = 0;
  if (x < 0) {
    k = Math.trunc(Log2e * x - 0.5);
  } else if (x > 0) {
    k = Math.trunc(Log2e * x + 0.5);
  }
  const hi = x - k * Ln2Hi;
  const lo = k * Ln2Lo;

  // compute
  return expmulti(hi, lo, k);
}

// math.Pow (pure Go version, which is what every Go target except s390x uses)
export function goMathPow(x, y) {
  if (y === 0 || x === 1) return 1;
  if (y === 1) return x;
  if (x !== x || y !== y) return NaN;
  if (x === 0) {
    if (y < 0) {
      if (signbit(x) && isOddInt(y)) return -Infinity;
      return Infinity;
    }
    if (y > 0) {
      if (signbit(x) && isOddInt(y)) return x;
      return 0;
    }
  } else if (y === Infinity || y === -Infinity) {
    if (x === -1) return 1;
    if ((Math.abs(x) < 1) === (y === Infinity)) return 0;
    return Infinity;
  } else if (x === Infinity || x === -Infinity) {
    if (x === -Infinity) {
      return goMathPow(1 / x, -y); // Pow(-0, -y)
    }
    if (y < 0) return 0;
    if (y > 0) return Infinity;
  } else if (y === 0.5) {
    return Math.sqrt(x);
  } else if (y === -0.5) {
    return 1 / Math.sqrt(x);
  }

  const $d4 = goMathModf(Math.abs(y));
  let yi = $d4[0], yf = $d4[1];
  if (yf !== 0 && x < 0) {
    return NaN;
  }
  if (yi >= 9223372036854775808) {
    // yi is a large even int that will lead to overflow (or underflow to 0)
    // for all x except -1 (x == 1 was handled earlier)
    if (x === -1) return 1;
    if ((Math.abs(x) < 1) === (y > 0)) return 0;
    return Infinity;
  }

  // ans = a1 * 2**ae (= 1 for now).
  let a1 = 1.0;
  let ae = 0;

  // ans *= x**yf
  if (yf !== 0) {
    if (yf > 0.5) {
      yf--;
      yi++;
    }
    a1 = goMathExp(yf * goMathLog(x));
  }

  // ans *= x**yi
  // by multiplying in successive squarings
  // of x according to bits of yi.
  // accumulate powers of two into exp.
  // Note: "i" is Go's int64(yi); yi < 2**63 is integral so halving with floor
  // is exact, and "i&1" is "i % 2" (values above 2**53 are always even).
  const $d5 = goMathFrexp(x);
  let x1 = $d5[0], xe = $d5[1];
  for (let i = yi; i !== 0; i = Math.floor(i / 2)) {
    if (xe < -(1 << 12) || 1 << 12 < xe) {
      // catch xe before it overflows the left shift below
      ae += xe;
      break;
    }
    if (i % 2 === 1) {
      a1 *= x1;
      ae += xe;
    }
    x1 *= x1;
    xe *= 2;
    if (x1 < 0.5) {
      x1 += x1;
      xe--;
    }
  }

  // ans = a1*2**ae
  // if y < 0 { ans = 1 / ans }
  // but in the opposite order
  if (y < 0) {
    a1 = 1 / a1;
    ae = -ae;
  }
  return goMathLdexp(a1, ae);
}

// ---------------------------------------------------------------------------

// Go's "a == b" for two Expr values: same Loc and same Data pointer.
function exprIdentical(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.data === b.data && a.loc === b.loc;
}

export class HelperContext {
  ;                      
  constructor(isUnbound = null) {
    this.isUnbound = isUnbound; // func(ast.Ref) bool
  }
}

export function makeHelperContext(isUnbound) {
  return new HelperContext(isUnbound);
}

// If this returns true, then calling this expression captures the target of
// the property access as "this" when calling the function in the property.
export function isPropertyAccess(expr) {
  if (expr === null) return false;
  const k = expr.data.k;
  return k === E_DOT || k === E_INDEX;
}

export function isOptionalChain(value) {
  if (value === null) return false;
  const e = value.data;
  switch (e.k) {
    case E_DOT:
      return e.optionalChain !== OptionalChainNone;
    case E_INDEX:
      return e.optionalChain !== OptionalChainNone;
    case E_CALL:
      return e.optionalChain !== OptionalChainNone;
  }
  return false;
}

export function assign(a, b) {
  return new Expr(new EBinary(a, b, BinOpAssign), a.loc);
}

export function assignStmt(a, b) {
  return new Stmt(new SExpr(assign(a, b)), a.loc);
}

// Wraps the provided expression in the "!" prefix operator. The expression
// will potentially be simplified to avoid generating unnecessary extra "!"
// operators. For example, calling this with "!!x" will return "!x" instead
// of returning "!!!x".
export function not(expr) {
  const $d6 = maybeSimplifyNot(expr);
  const result = $d6[0], ok = $d6[1];
  if (ok) {
    return result;
  }
  return new Expr(new EUnary(expr, UnOpNot), expr.loc);
}

// The given "expr" argument should be the operand of a "!" prefix operator
// (i.e. the "x" in "!x"). This returns a simplified expression for the
// whole operator (i.e. the "!x") if it can be simplified, or false if not.
// It's separate from "Not()" above to avoid allocation on failure in case
// that is undesired.
//
// This function intentionally avoids mutating the input AST so it can be
// called after the AST has been frozen (i.e. after parsing ends).
export function maybeSimplifyNot(expr) {
  if (expr === null) return [null, false];
  const e = expr.data;
  switch (e.k) {
    case E_ANNOTATION:
      return maybeSimplifyNot(e.value);

    case E_INLINED_ENUM: {
      const result = maybeSimplifyNot(e.value);
      if (result[1]) {
        return result;
      }
      break;
    }

    case E_NULL:
    case E_UNDEFINED:
      return [new Expr(new EBoolean(true), expr.loc), true];

    case E_BOOLEAN:
      return [new Expr(new EBoolean(!e.value), expr.loc), true];

    case E_NUMBER:
      return [new Expr(new EBoolean(e.value === 0 || e.value !== e.value), expr.loc), true];

    case E_BIG_INT: {
      const $d7 = checkEqualityBigInt(e.value, "0");
      const equal = $d7[0], ok = $d7[1];
      if (ok) {
        return [new Expr(new EBoolean(equal), expr.loc), true];
      }
      break;
    }

    case E_STRING:
      return [new Expr(new EBoolean(e.value.length === 0), expr.loc), true];

    case E_FUNCTION:
    case E_ARROW:
    case E_REG_EXP:
      return [new Expr(new EBoolean(false), expr.loc), true];

    case E_UNARY:
      // "!!!a" => "!a"
      if (e.op === UnOpNot && knownPrimitiveType(e.value.data) === PrimitiveBoolean) {
        return [e.value, true];
      }
      break;

    case E_BINARY:
      // Make sure that these transformations are all safe for special values.
      // For example, "!(a < b)" is not the same as "a >= b" if a and/or b are
      // NaN (or undefined, or null, or possibly other problem cases too).
      switch (e.op) {
        case BinOpLooseEq:
          // "!(a == b)" => "a != b"
          return [new Expr(new EBinary(e.left, e.right, BinOpLooseNe), expr.loc), true];

        case BinOpLooseNe:
          // "!(a != b)" => "a == b"
          return [new Expr(new EBinary(e.left, e.right, BinOpLooseEq), expr.loc), true];

        case BinOpStrictEq:
          // "!(a === b)" => "a !== b"
          return [new Expr(new EBinary(e.left, e.right, BinOpStrictNe), expr.loc), true];

        case BinOpStrictNe:
          // "!(a !== b)" => "a === b"
          return [new Expr(new EBinary(e.left, e.right, BinOpStrictEq), expr.loc), true];

        case BinOpComma:
          // "!(a, b)" => "a, !b"
          return [new Expr(new EBinary(e.left, not(e.right), BinOpComma), expr.loc), true];
      }
      break;
  }

  return [null, false];
}

// This function intentionally avoids mutating the input AST so it can be
// called after the AST has been frozen (i.e. after parsing ends).
export function maybeSimplifyEqualityComparison(loc, e, unsupportedFeatures) {
  let value = e.left;
  let primitive = e.right;

  // Detect when the primitive comes first and flip the order of our checks
  if (isPrimitiveLiteral(value.data)) {
    const tmp = value;
    value = primitive;
    primitive = tmp;
  }

  // "!x === true" => "!x"
  // "!x === false" => "!!x"
  // "!x !== true" => "!!x"
  // "!x !== false" => "!x"
  const boolean = primitive.data;
  if (boolean.k === E_BOOLEAN && knownPrimitiveType(value.data) === PrimitiveBoolean) {
    if (boolean.value === (e.op === BinOpLooseNe || e.op === BinOpStrictNe)) {
      return [not(value), true];
    } else {
      return [value, true];
    }
  }

  // "typeof x != 'undefined'" => "typeof x < 'u'"
  // "typeof x == 'undefined'" => "typeof x > 'u'"
  if (!jsFeatureHas(unsupportedFeatures, TypeofExoticObjectIsObject)) {
    // Only do this optimization if we know that the "typeof" operator won't
    // return something random. The only case of this happening was Internet
    // Explorer returning "unknown" for some objects, which messes with this
    // optimization. So we don't do this when targeting Internet Explorer.
    const typeof_ = value.data;
    if (typeof_.k === E_UNARY && typeof_.op === UnOpTypeof) {
      const str = primitive.data;
      if (str.k === E_STRING && utf16EqualsString(str.value, "undefined")) {
        const flip = exprIdentical(value, e.right);
        let op = BinOpLt;
        if ((e.op === BinOpLooseEq || e.op === BinOpStrictEq) !== flip) {
          op = BinOpGt;
        }
        primitive = new Expr(new EString("u"), primitive.loc);
        if (flip) {
          const tmp = value;
          value = primitive;
          primitive = tmp;
        }
        return [new Expr(new EBinary(value, primitive, op), loc), true];
      }
    }
  }

  return [null, false];
}

export function isSymbolInstance(data) {
  if (data === null) return false;
  switch (data.k) {
    case E_DOT:
      return data.isSymbolInstance;

    case E_INDEX:
      return data.isSymbolInstance;
  }
  return false;
}

export function isPrimitiveLiteral(data) {
  if (data === null) return false;
  switch (data.k) {
    case E_ANNOTATION:
      return isPrimitiveLiteral(data.value.data);

    case E_INLINED_ENUM:
      return isPrimitiveLiteral(data.value.data);

    case E_NULL:
    case E_UNDEFINED:
    case E_STRING:
    case E_BOOLEAN:
    case E_NUMBER:
    case E_BIG_INT:
      return true;
  }
  return false;
}

// PrimitiveType
export const PrimitiveUnknown = 0;
export const PrimitiveMixed = 1;
export const PrimitiveNull = 2;
export const PrimitiveUndefined = 3;
export const PrimitiveBoolean = 4;
export const PrimitiveNumber = 5;
export const PrimitiveString = 6;
export const PrimitiveBigInt = 7;

// This can be used when the returned type is either one or the other
export function mergedKnownPrimitiveTypes(a, b) {
  const x = knownPrimitiveType(a.data);
  if (x === PrimitiveUnknown) {
    return PrimitiveUnknown;
  }

  const y = knownPrimitiveType(b.data);
  if (y === PrimitiveUnknown) {
    return PrimitiveUnknown;
  }

  if (x === y) {
    return x;
  }
  return PrimitiveMixed; // Definitely some kind of primitive
}

// Note: This function does not say whether the expression is side-effect free
// or not. For example, the expression "++x" always returns a primitive.
export function knownPrimitiveType(expr) {
  if (expr === null) return PrimitiveUnknown;
  const e = expr;
  switch (e.k) {
    case E_ANNOTATION:
      return knownPrimitiveType(e.value.data);

    case E_INLINED_ENUM:
      return knownPrimitiveType(e.value.data);

    case E_NULL:
      return PrimitiveNull;

    case E_UNDEFINED:
      return PrimitiveUndefined;

    case E_BOOLEAN:
      return PrimitiveBoolean;

    case E_NUMBER:
      return PrimitiveNumber;

    case E_STRING:
      return PrimitiveString;

    case E_BIG_INT:
      return PrimitiveBigInt;

    case E_TEMPLATE:
      if (e.tagOrNil === null) {
        return PrimitiveString;
      }
      break;

    case E_IF:
      return mergedKnownPrimitiveTypes(e.yes, e.no);

    case E_UNARY:
      switch (e.op) {
        case UnOpVoid:
          return PrimitiveUndefined;

        case UnOpTypeof:
          return PrimitiveString;

        case UnOpNot:
        case UnOpDelete:
          return PrimitiveBoolean;

        case UnOpPos:
          return PrimitiveNumber; // Cannot be bigint because that throws an exception

        case UnOpNeg:
        case UnOpCpl: {
          const value = knownPrimitiveType(e.value.data);
          if (value === PrimitiveBigInt) {
            return PrimitiveBigInt;
          }
          if (value !== PrimitiveUnknown && value !== PrimitiveMixed) {
            return PrimitiveNumber;
          }
          return PrimitiveMixed; // Can be number or bigint
        }

        case UnOpPreDec:
        case UnOpPreInc:
        case UnOpPostDec:
        case UnOpPostInc:
          return PrimitiveMixed; // Can be number or bigint
      }
      break;

    case E_BINARY:
      switch (e.op) {
        case BinOpStrictEq:
        case BinOpStrictNe:
        case BinOpLooseEq:
        case BinOpLooseNe:
        case BinOpLt:
        case BinOpGt:
        case BinOpLe:
        case BinOpGe:
        case BinOpInstanceof:
        case BinOpIn:
          return PrimitiveBoolean;

        case BinOpLogicalOr:
        case BinOpLogicalAnd:
          return mergedKnownPrimitiveTypes(e.left, e.right);

        case BinOpNullishCoalescing: {
          const left = knownPrimitiveType(e.left.data);
          const right = knownPrimitiveType(e.right.data);
          if (left === PrimitiveNull || left === PrimitiveUndefined) {
            return right;
          }
          if (left !== PrimitiveUnknown) {
            if (left !== PrimitiveMixed) {
              return left; // Definitely not null or undefined
            }
            if (right !== PrimitiveUnknown) {
              return PrimitiveMixed; // Definitely some kind of primitive
            }
          }
          break;
        }

        case BinOpAdd: {
          const left = knownPrimitiveType(e.left.data);
          const right = knownPrimitiveType(e.right.data);
          if (left === PrimitiveString || right === PrimitiveString) {
            return PrimitiveString;
          }
          if (left === PrimitiveBigInt && right === PrimitiveBigInt) {
            return PrimitiveBigInt;
          }
          if (
            left !== PrimitiveUnknown &&
            left !== PrimitiveMixed &&
            left !== PrimitiveBigInt &&
            right !== PrimitiveUnknown &&
            right !== PrimitiveMixed &&
            right !== PrimitiveBigInt
          ) {
            return PrimitiveNumber;
          }
          return PrimitiveMixed; // Can be number or bigint or string (or an exception)
        }

        case BinOpAddAssign: {
          const right = knownPrimitiveType(e.right.data);
          if (right === PrimitiveString) {
            return PrimitiveString;
          }
          return PrimitiveMixed; // Can be number or bigint or string (or an exception)
        }

        case BinOpSub:
        case BinOpSubAssign:
        case BinOpMul:
        case BinOpMulAssign:
        case BinOpDiv:
        case BinOpDivAssign:
        case BinOpRem:
        case BinOpRemAssign:
        case BinOpPow:
        case BinOpPowAssign:
        case BinOpBitwiseAnd:
        case BinOpBitwiseAndAssign:
        case BinOpBitwiseOr:
        case BinOpBitwiseOrAssign:
        case BinOpBitwiseXor:
        case BinOpBitwiseXorAssign:
        case BinOpShl:
        case BinOpShlAssign:
        case BinOpShr:
        case BinOpShrAssign:
        case BinOpUShr:
        case BinOpUShrAssign:
          return PrimitiveMixed; // Can be number or bigint (or an exception)

        case BinOpAssign:
        case BinOpComma:
          return knownPrimitiveType(e.right.data);
      }
      break;
  }

  return PrimitiveUnknown;
}

export function canChangeStrictToLoose(a, b) {
  const x = knownPrimitiveType(a.data);
  const y = knownPrimitiveType(b.data);
  return x === y && x !== PrimitiveUnknown && x !== PrimitiveMixed;
}

// Returns true if the result of the "typeof" operator on this expression is
// statically determined and this expression has no side effects (i.e. can be
// removed without consequence).
export function typeofWithoutSideEffects(data)                    {
  if (data === null) return ["", false];
  switch (data.k) {
    case E_ANNOTATION:
      if ((data.flags & CanBeRemovedIfUnusedFlag) !== 0) {
        return typeofWithoutSideEffects(data.value.data);
      }
      break;

    case E_INLINED_ENUM:
      return typeofWithoutSideEffects(data.value.data);

    case E_NULL:
      return ["object", true];

    case E_UNDEFINED:
      return ["undefined", true];

    case E_BOOLEAN:
      return ["boolean", true];

    case E_NUMBER:
      return ["number", true];

    case E_BIG_INT:
      return ["bigint", true];

    case E_STRING:
      return ["string", true];

    case E_FUNCTION:
    case E_ARROW:
      return ["function", true];
  }

  return ["", false];
}

// The goal of this function is to "rotate" the AST if it's possible to use the
// left-associative property of the operator to avoid unnecessary parentheses.
//
// When using this, make absolutely sure that the operator is actually
// associative. For example, the "+" operator is not associative for
// floating-point numbers.
//
// This function intentionally avoids mutating the input AST so it can be
// called after the AST has been frozen (i.e. after parsing ends).
export function joinWithLeftAssociativeOp(op, a, b) {
  // "(a, b) op c" => "a, b op c"
  const comma = a.data;
  if (comma.k === E_BINARY && comma.op === BinOpComma) {
    // Don't mutate the original AST
    const clone = new EBinary(comma.left, comma.right, comma.op, comma.isParenthesized);
    clone.right = joinWithLeftAssociativeOp(op, clone.right, b);
    return new Expr(clone, a.loc);
  }

  // "a op (b op c)" => "(a op b) op c"
  // "a op (b op (c op d))" => "((a op b) op c) op d"
  for (;;) {
    const binary = b.data;
    if (binary.k === E_BINARY && binary.op === op) {
      a = joinWithLeftAssociativeOp(op, a, binary.left);
      b = binary.right;
    } else {
      break;
    }
  }

  // "a op b" => "a op b"
  // "(a op b) op c" => "(a op b) op c"
  return new Expr(new EBinary(a, b, op), a.loc);
}

export function joinWithComma(a, b) {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return new Expr(new EBinary(a, b, BinOpComma), a.loc);
}

export function joinAllWithComma(all) {
  let result = null;
  for (const value of all) {
    result = joinWithComma(result, value);
  }
  return result;
}

// "wrapIdentifier" is a function (loc, ref) => Expr, or null
export function convertBindingToExpr(binding, wrapIdentifier) {
  const loc = binding.loc;
  const b = binding.data;

  switch (b.k) {
    case B_MISSING:
      return new Expr(new EMissing(), loc);

    case B_IDENTIFIER:
      if (wrapIdentifier !== null && wrapIdentifier !== undefined) {
        return wrapIdentifier(loc, b.ref);
      }
      return new Expr(new EIdentifier(b.ref), loc);

    case B_ARRAY: {
      const exprs = new Array(b.items.length);
      for (let i = 0; i < b.items.length; i++) {
        const item = b.items[i];
        let expr = convertBindingToExpr(item.binding, wrapIdentifier);
        if (b.hasSpread && i + 1 === b.items.length) {
          expr = new Expr(new ESpread(expr), expr.loc);
        } else if (item.defaultValueOrNil !== null) {
          expr = assign(expr, item.defaultValueOrNil);
        }
        exprs[i] = expr;
      }
      return new Expr(new EArray(exprs, 0, 0, b.isSingleLine), loc);
    }

    case B_OBJECT: {
      const properties = new Array(b.properties.length);
      for (let i = 0; i < b.properties.length; i++) {
        const property = b.properties[i];
        const value = convertBindingToExpr(property.value, wrapIdentifier);
        let kind = PropertyField;
        if (property.isSpread) {
          kind = PropertySpread;
        }
        let flags = 0;
        if (property.isComputed) {
          flags |= PropertyIsComputed;
        }
        properties[i] = new Property(null, property.key, value, property.defaultValueOrNil, [], 0, 0, kind, flags);
      }
      return new Expr(new EObject(properties, 0, 0, b.isSingleLine), loc);
    }

    default:
      throw new GoPanic("Internal error");
  }
}

Object.assign(HelperContext.prototype, {
  // This will return a nil expression if the expression can be totally removed.
  //
  // This function intentionally avoids mutating the input AST so it can be
  // called after the AST has been frozen (i.e. after parsing ends).
  simplifyUnusedExpr(expr, unsupportedFeatures) {
    const ctx = this;
    if (expr === null) return null;
    const e = expr.data;
    switch (e.k) {
      case E_ANNOTATION:
        if ((e.flags & CanBeRemovedIfUnusedFlag) !== 0) {
          return null;
        }
        break;

      case E_INLINED_ENUM:
        return ctx.simplifyUnusedExpr(e.value, unsupportedFeatures);

      case E_NULL:
      case E_UNDEFINED:
      case E_MISSING:
      case E_BOOLEAN:
      case E_NUMBER:
      case E_BIG_INT:
      case E_STRING:
      case E_THIS:
      case E_REG_EXP:
      case E_FUNCTION:
      case E_ARROW:
      case E_IMPORT_META:
        return null;

      case E_DOT:
        if (e.canBeRemovedIfUnused) {
          return null;
        }
        break;

      case E_IDENTIFIER:
        if (e.mustKeepDueToWithStmt) {
          break;
        }
        if (e.canBeRemovedIfUnused || !ctx.isUnbound(e.ref)) {
          return null;
        }
        break;

      case E_TEMPLATE:
        if (e.tagOrNil === null) {
          let comma = null;
          let templateLoc = 0;
          let template = null;
          for (let $i3 = 0, $a3 = e.parts; $i3 < $a3.length; $i3++) {
            const part = $a3[$i3];
            // If we know this value is some kind of primitive, then we know that
            // "ToString" has no side effects and can be avoided.
            if (knownPrimitiveType(part.value.data) !== PrimitiveUnknown) {
              if (template !== null) {
                comma = joinWithComma(comma, new Expr(template, templateLoc));
                template = null;
              }
              comma = joinWithComma(comma, ctx.simplifyUnusedExpr(part.value, unsupportedFeatures));
              continue;
            }

            // Make sure "ToString" is still evaluated on the value. We can't use
            // string addition here because that may evaluate "ValueOf" instead.
            if (template === null) {
              template = new ETemplate();
              templateLoc = part.value.loc;
            }
            template.parts.push(new TemplatePart(part.value));
          }
          if (template !== null) {
            comma = joinWithComma(comma, new Expr(template, templateLoc));
          }
          return comma;
        } else if (e.canBeUnwrappedIfUnused) {
          // If the function call was annotated as being able to be removed if the
          // result is unused, then we can remove it and just keep the arguments.
          // Note that there are no implicit "ToString" operations for tagged
          // template literals.
          let comma = null;
          for (let $i4 = 0, $a4 = e.parts; $i4 < $a4.length; $i4++) {
            const part = $a4[$i4];
            comma = joinWithComma(comma, ctx.simplifyUnusedExpr(part.value, unsupportedFeatures));
          }
          return comma;
        }
        break;

      case E_ARRAY: {
        // Arrays with "..." spread expressions can't be unwrapped because the
        // "..." triggers code evaluation via iterators. In that case, just trim
        // the other items instead and leave the array expression there.
        for (let $i5 = 0, $a5 = e.items; $i5 < $a5.length; $i5++) {
          const spread = $a5[$i5];
          if (spread.data.k === E_SPREAD) {
            const items = [];
            for (let item of e.items) {
              item = ctx.simplifyUnusedExpr(item, unsupportedFeatures);
              if (item !== null) {
                items.push(item);
              }
            }

            // Don't mutate the original AST
            const clone = new EArray(items, e.commaAfterSpread, e.closeBracketLoc, e.isSingleLine, e.isParenthesized);
            return new Expr(clone, expr.loc);
          }
        }

        // Otherwise, the array can be completely removed. We only need to keep any
        // array items with side effects. Apply this simplification recursively.
        let result = null;
        for (let $i6 = 0, $a6 = e.items; $i6 < $a6.length; $i6++) {
          const item = $a6[$i6];
          result = joinWithComma(result, ctx.simplifyUnusedExpr(item, unsupportedFeatures));
        }
        return result;
      }

      case E_OBJECT: {
        // Objects with "..." spread expressions can't be unwrapped because the
        // "..." triggers code evaluation via getters. In that case, just trim
        // the other items instead and leave the object expression there.
        for (let $i7 = 0, $a7 = e.properties; $i7 < $a7.length; $i7++) {
          const spread = $a7[$i7];
          if (spread.kind === PropertySpread) {
            const properties = [];
            for (let $i8 = 0, $a8 = e.properties; $i8 < $a8.length; $i8++) {
              const original = $a8[$i8];
              const property = original.clone(); // Go copies the struct
              // Spread properties must always be evaluated
              if (property.kind !== PropertySpread) {
                const value = ctx.simplifyUnusedExpr(property.valueOrNil, unsupportedFeatures);
                if (value !== null) {
                  // Keep the value
                  property.valueOrNil = value;
                } else if ((property.flags & PropertyIsComputed) === 0) {
                  // Skip this property if the key doesn't need to be computed
                  continue;
                } else {
                  // Replace values without side effects with "0" because it's short
                  property.valueOrNil = new Expr(new ENumber(0), property.valueOrNil !== null ? property.valueOrNil.loc : 0);
                }
              }
              properties.push(property);
            }

            // Don't mutate the original AST
            const clone = new EObject(properties, e.commaAfterSpread, e.closeBraceLoc, e.isSingleLine, e.isParenthesized);
            return new Expr(clone, expr.loc);
          }
        }

        // Otherwise, the object can be completely removed. We only need to keep any
        // object properties with side effects. Apply this simplification recursively.
        let result = null;
        for (let $i9 = 0, $a9 = e.properties; $i9 < $a9.length; $i9++) {
          const property = $a9[$i9];
          if ((property.flags & PropertyIsComputed) !== 0) {
            // Make sure "ToString" is still evaluated on the key
            result = joinWithComma(
              result,
              new Expr(new EBinary(property.key, new Expr(new EString(), property.key.loc), BinOpAdd), property.key.loc),
            );
          }
          result = joinWithComma(result, ctx.simplifyUnusedExpr(property.valueOrNil, unsupportedFeatures));
        }
        return result;
      }

      case E_IF: {
        const yes = ctx.simplifyUnusedExpr(e.yes, unsupportedFeatures);
        const no = ctx.simplifyUnusedExpr(e.no, unsupportedFeatures);

        // "foo() ? 1 : 2" => "foo()"
        if (yes === null && no === null) {
          return ctx.simplifyUnusedExpr(e.test, unsupportedFeatures);
        }

        // "foo() ? 1 : bar()" => "foo() || bar()"
        if (yes === null) {
          return joinWithLeftAssociativeOp(BinOpLogicalOr, e.test, no);
        }

        // "foo() ? bar() : 2" => "foo() && bar()"
        if (no === null) {
          return joinWithLeftAssociativeOp(BinOpLogicalAnd, e.test, yes);
        }

        if (!exprIdentical(yes, e.yes) || !exprIdentical(no, e.no)) {
          return new Expr(new EIf(e.test, yes, no), expr.loc);
        }
        break;
      }

      case E_UNARY:
        switch (e.op) {
          // These operators must not have any type conversions that can execute code
          // such as "toString" or "valueOf". They must also never throw any exceptions.
          case UnOpVoid:
          case UnOpNot:
            return ctx.simplifyUnusedExpr(e.value, unsupportedFeatures);

          case UnOpNeg:
            if (e.value.data.k === E_BIG_INT) {
              // Consider negated bigints to have no side effects
              return null;
            }
            break;

          case UnOpTypeof:
            if (e.value.data.k === E_IDENTIFIER && e.wasOriginallyTypeofIdentifier) {
              // "typeof x" must not be transformed into if "x" since doing so could
              // cause an exception to be thrown. Instead we can just remove it since
              // "typeof x" is special-cased in the standard to never throw.
              return null;
            }
            return ctx.simplifyUnusedExpr(e.value, unsupportedFeatures);
        }
        break;

      case E_BINARY: {
        let left = e.left;
        let right = e.right;

        switch (e.op) {
          // These operators must not have any type conversions that can execute code
          // such as "toString" or "valueOf". They must also never throw any exceptions.
          case BinOpStrictEq:
          case BinOpStrictNe:
          case BinOpComma: {
            const l = ctx.simplifyUnusedExpr(left, unsupportedFeatures);
            const r = ctx.simplifyUnusedExpr(right, unsupportedFeatures);
            // JS-only: when "JoinWithComma" would rebuild this very comma
            // expression (same operands, same loc), return it instead of an
            // equal new node. Re-simplifying the already simplified left
            // operand of every comma in a long chain (see "visitRightAndFinish")
            // then allocates nothing. The only observable difference is object
            // identity, which callers only use to decide whether to rebuild an
            // equal node (EBinary.isParenthesized is only read while parsing).
            if (e.op === BinOpComma && l === left && r === right && expr.loc === left.loc && !e.isParenthesized) {
              return expr;
            }
            return joinWithComma(l, r);
          }

          // We can simplify "==" and "!=" even though they can call "toString" and/or
          // "valueOf" if we can statically determine that the types of both sides are
          // primitives. In that case there won't be any chance for user-defined
          // "toString" and/or "valueOf" to be called.
          case BinOpLooseEq:
          case BinOpLooseNe:
            if (mergedKnownPrimitiveTypes(left, right) !== PrimitiveUnknown) {
              return joinWithComma(ctx.simplifyUnusedExpr(left, unsupportedFeatures), ctx.simplifyUnusedExpr(right, unsupportedFeatures));
            }
            break;

          case BinOpLogicalAnd:
          case BinOpLogicalOr:
          case BinOpNullishCoalescing: {
            // If this is a boolean logical operation and the result is unused, then
            // we know the left operand will only be used for its boolean value and
            // can be simplified under that assumption
            if (e.op !== BinOpNullishCoalescing) {
              left = ctx.simplifyBooleanExpr(left);
            }

            // Preserve short-circuit behavior: the left expression is only unused if
            // the right expression can be completely removed. Otherwise, the left
            // expression is important for the branch.
            right = ctx.simplifyUnusedExpr(right, unsupportedFeatures);
            if (right === null) {
              return ctx.simplifyUnusedExpr(left, unsupportedFeatures);
            }

            // Try to take advantage of the optional chain operator to shorten code
            if (!jsFeatureHas(unsupportedFeatures, OptionalChain)) {
              const binary = left.data;
              if (binary.k === E_BINARY) {
                // "a != null && a.b()" => "a?.b()"
                // "a == null || a.b()" => "a?.b()"
                if ((binary.op === BinOpLooseNe && e.op === BinOpLogicalAnd) || (binary.op === BinOpLooseEq && e.op === BinOpLogicalOr)) {
                  let test = null;
                  if (binary.right.data.k === E_NULL) {
                    test = binary.left;
                  } else if (binary.left.data.k === E_NULL) {
                    test = binary.right;
                  }

                  // Note: Technically unbound identifiers can refer to a getter on
                  // the global object and that getter can have side effects that can
                  // be observed if we run that getter once instead of twice. But this
                  // seems like terrible coding practice and very unlikely to come up
                  // in real software, so we deliberately ignore this possibility and
                  // optimize for size instead of for this obscure edge case.
                  //
                  // If this is ever changed, then we must also pessimize the lowering
                  // of "foo?.bar" to save the value of "foo" to ensure that it's only
                  // evaluated once. Specifically "foo?.bar" would have to expand to:
                  //
                  //   var _a;
                  //   (_a = foo) == null ? void 0 : _a.bar;
                  //
                  // instead of:
                  //
                  //   foo == null ? void 0 : foo.bar;
                  //
                  // Babel does the first one while TypeScript does the second one.
                  // Since TypeScript doesn't handle this extreme edge case and
                  // TypeScript is very widely used, I think it's fine for us to not
                  // handle this edge case either.
                  if (test !== null && test.data.k === E_IDENTIFIER && !test.data.mustKeepDueToWithStmt && tryToInsertOptionalChain(test, right)) {
                    return right;
                  }
                }
              }
            }
            break;
          }

          case BinOpAdd: {
            const $d8 = simplifyUnusedStringAdditionChain(expr);
            const result = $d8[0], isStringAddition = $d8[1];
            if (isStringAddition) {
              return result;
            }
            break;
          }
        }

        if (!exprIdentical(left, e.left) || !exprIdentical(right, e.right)) {
          return new Expr(new EBinary(left, right, e.op), expr.loc);
        }
        break;
      }

      case E_CALL:
        // A call that has been marked "__PURE__" can be removed if all arguments
        // can be removed. The annotation causes us to ignore the target.
        if (e.canBeUnwrappedIfUnused) {
          let result = null;
          for (let arg of e.args) {
            if (arg.data.k === E_SPREAD) {
              arg = new Expr(new EArray([arg], 0, 0, true), arg.loc);
            }
            result = joinWithComma(result, ctx.simplifyUnusedExpr(arg, unsupportedFeatures));
          }
          return result;
        }

        // Attempt to shorten IIFEs
        if (e.args.length === 0) {
          const target = e.target.data;
          switch (target.k) {
            case E_FUNCTION:
              if (target.fn.args.length !== 0) {
                break;
              }

              // Just delete "(function() {})()" completely
              if (target.fn.body.block.stmts.length === 0) {
                return null;
              }
              break;

            case E_ARROW:
              if (target.args.length !== 0) {
                break;
              }

              // Just delete "(() => {})()" completely
              if (target.body.block.stmts.length === 0) {
                return null;
              }

              if (target.body.block.stmts.length === 1) {
                const s = target.body.block.stmts[0].data;
                switch (s.k) {
                  case S_EXPR:
                    if (!target.isAsync) {
                      // Replace "(() => { foo() })()" with "foo()"
                      return s.value;
                    } else {
                      // Replace "(async () => { foo() })()" with "(async () => foo())()"
                      // Note: Go's "clone := *target" shares the statement slice with
                      // the original arrow, so the write to "Stmts[0]" below is also
                      // visible through the original. This is replicated here.
                      const stmts = target.body.block.stmts;
                      const clone = new EArrow(
                        target.args,
                        new FnBody(new SBlock(stmts, target.body.block.closeBraceLoc), target.body.loc),
                        target.isAsync,
                        target.hasRestArg,
                        target.preferExpr,
                        target.isParenthesized,
                        target.hasNoSideEffectsComment,
                      );
                      stmts[0] = new Stmt(new SReturn(s.value), stmts[0].loc);
                      clone.preferExpr = true;
                      return new Expr(new ECall(new Expr(clone, e.target.loc)), expr.loc);
                    }

                  case S_RETURN:
                    if (!target.isAsync) {
                      // Replace "(() => foo())()" with "foo()"
                      return s.valueOrNil;
                    }
                    break;
                }
              }
              break;
          }
        }
        break;

      case E_NEW:
        // A constructor call that has been marked "__PURE__" can be removed if all
        // arguments can be removed. The annotation causes us to ignore the target.
        if (e.canBeUnwrappedIfUnused) {
          let result = null;
          for (let arg of e.args) {
            if (arg.data.k === E_SPREAD) {
              arg = new Expr(new EArray([arg], 0, 0, true), arg.loc);
            }
            result = joinWithComma(result, ctx.simplifyUnusedExpr(arg, unsupportedFeatures));
          }
          return result;
        }
        break;
    }

    return expr;
  },
});

// This function intentionally avoids mutating the input AST so it can be
// called after the AST has been frozen (i.e. after parsing ends).
// Returns [Expr, isStringAddition].
function simplifyUnusedStringAdditionChain(expr) {
  const e = expr.data;
  switch (e.k) {
    case E_STRING:
      // "'x' + y" => "'' + y"
      return [new Expr(new EString(), expr.loc), true];

    case E_BINARY:
      if (e.op === BinOpAdd) {
        const $d9 = simplifyUnusedStringAdditionChain(e.left);
        const left = $d9[0], leftIsStringAddition = $d9[1];

        const right = e.right.data;
        if (right.k === E_STRING) {
          // "('' + x) + 'y'" => "'' + x"
          if (leftIsStringAddition) {
            return [left, true];
          }

          // "x + 'y'" => "x + ''"
          if (!leftIsStringAddition && right.value.length > 0) {
            return [new Expr(new EBinary(left, new Expr(new EString(), e.right.loc), BinOpAdd), expr.loc), true];
          }
        }

        // Don't mutate the original AST
        if (!exprIdentical(left, e.left)) {
          expr = new Expr(new EBinary(left, e.right, BinOpAdd), expr.loc);
        }

        return [expr, leftIsStringAddition];
      }
      break;
  }

  return [expr, false];
}

// Go:
//
//   i := int32(f)
//   if float64(i) == f { return i }
//   if math.IsNaN(f) || math.IsInf(f, 0) { return 0 }
//   i = int32(uint32(math.Mod(math.Abs(f), 4294967296)))
//   if math.Signbit(f) { return -i }
//   return i
//
// The first step only succeeds when "f" is exactly an int32 value, whatever the
// platform's out-of-range conversion does. "math.Mod" is exact, so the rest is
// "sign(f) * (trunc(|f|) mod 2^32)" wrapped to int32, which is exactly the
// ECMAScript ToInt32 operation, i.e. "f | 0".
export function toInt32(f) {
  return f | 0;
}

// Go: uint32(ToInt32(f))
export function toUint32(f) {
  return f >>> 0;
}

// If this returns true, we know the result can't be NaN
function isInt32OrUint32(data) {
  if (data === null) return false;
  switch (data.k) {
    case E_BINARY:
      switch (data.op) {
        case BinOpUShr: // This is the only bitwise operator that can't return a bigint (because it throws instead)
          return true;

        case BinOpLogicalOr:
        case BinOpLogicalAnd:
          return isInt32OrUint32(data.left.data) && isInt32OrUint32(data.right.data);
      }
      break;

    case E_IF:
      return isInt32OrUint32(data.yes.data) && isInt32OrUint32(data.no.data);
  }
  return false;
}

// Returns [number, ok]
export function toNumberWithoutSideEffects(data) {
  if (data === null) return [0, false];
  const e = data;
  switch (e.k) {
    case E_ANNOTATION:
      return toNumberWithoutSideEffects(e.value.data);

    case E_INLINED_ENUM:
      return toNumberWithoutSideEffects(e.value.data);

    case E_NULL:
      return [0, true];

    case E_UNDEFINED:
    case E_REG_EXP:
      return [NaN, true];

    case E_ARRAY:
      if (e.items.length === 0) {
        // "+[]" => "0"
        return [0, true];
      }
      break;

    case E_OBJECT:
      if (e.properties.length === 0) {
        // "+{}" => "NaN"
        return [NaN, true];
      }
      break;

    case E_BOOLEAN:
      if (e.value) {
        return [1, true];
      } else {
        return [0, true];
      }

    case E_NUMBER:
      return [e.value, true];

    case E_STRING: {
      // "+''" => "0"
      if (e.value.length === 0) {
        return [0, true];
      }

      // "+'1'" => "1"
      const $d10 = stringToEquivalentNumberValue(e.value);
      const num = $d10[0], ok = $d10[1];
      if (ok) {
        return [num, true];
      }
      break;
    }
  }

  return [0, false];
}

// Returns [string, ok]
export function toStringWithoutSideEffects(data) {
  if (data === null) return ["", false];
  const e = data;
  switch (e.k) {
    case E_NULL:
      return ["null", true];

    case E_UNDEFINED:
      return ["undefined", true];

    case E_BOOLEAN:
      if (e.value) {
        return ["true", true];
      } else {
        return ["false", true];
      }

    case E_BIG_INT:
      // Only do this if there is no radix
      if (e.value.length < 2 || e.value.charCodeAt(0) !== 48 /* '0' */) {
        return [e.value, true];
      }
      break;

    case E_NUMBER: {
      const result = tryToStringOnNumberSafely(e.value, 10);
      if (result[1]) {
        return result;
      }
      break;
    }

    case E_REG_EXP:
      return [e.value, true];

    case E_DOT:
      // This is dumb but some JavaScript obfuscators use this to generate string literals
      if (e.name === "constructor") {
        switch (e.target.data.k) {
          case E_STRING:
            return ["function String() { [native code] }", true];

          case E_REG_EXP:
            return ["function RegExp() { [native code] }", true];
        }
      }
      break;
  }

  return ["", false];
}

// Returns [number, ok]
export function extractNumericValue(data) {
  if (data === null) return [0, false];
  switch (data.k) {
    case E_ANNOTATION:
      return extractNumericValue(data.value.data);

    case E_INLINED_ENUM:
      return extractNumericValue(data.value.data);

    case E_NUMBER:
      return [data.value, true];
  }

  return [0, false];
}

// Returns [a, b, ok]
export function extractNumericValues(left, right) {
  const $d11 = extractNumericValue(left.data);
  const a = $d11[0], okA = $d11[1];
  if (okA) {
    const $d12 = extractNumericValue(right.data);
    const b = $d12[0], okB = $d12[1];
    if (okB) {
      return [a, b, true];
    }
  }
  return [0, 0, false];
}

// Returns [[]uint16 (a string), ok]
export function extractStringValue(data) {
  if (data === null) return [null, false];
  switch (data.k) {
    case E_ANNOTATION:
      return extractStringValue(data.value.data);

    case E_INLINED_ENUM:
      return extractStringValue(data.value.data);

    case E_STRING:
      return [data.value, true];
  }

  return [null, false];
}

// Returns [a, b, ok]
export function extractStringValues(left, right) {
  const $d13 = extractStringValue(left.data);
  const a = $d13[0], okA = $d13[1];
  if (okA) {
    const $d14 = extractStringValue(right.data);
    const b = $d14[0], okB = $d14[1];
    if (okB) {
      return [a, b, true];
    }
  }
  return [null, null, false];
}

export function stringCompareUCS2(a, b) {
  let n;
  if (a.length < b.length) {
    n = a.length;
  } else {
    n = b.length;
  }
  for (let i = 0; i < n; i++) {
    const delta = a.charCodeAt(i) - b.charCodeAt(i);
    if (delta !== 0) {
      return delta;
    }
  }
  return a.length - b.length;
}

// Go: 1 + int(math.Max(0, math.Floor(math.Log10(math.Abs(intValue))))), plus
// one for negative values. Only reachable when minifying.
export function approximatePrintedIntCharCount(intValue) {
  // (Go's int(float64) on wasm saturates: NaN is 0, +Inf is MaxInt64, and
  // "1 + MaxInt64" wraps around to MinInt64)
  const f = goIntFromFloat(Math.max(0, Math.floor(goMathLog10(Math.abs(intValue)))));
  let count = f >= 9223372036854775807 ? -9223372036854775808 : 1 + f;
  if (intValue < 0) {
    count++;
  }
  return count;
}

export function shouldFoldBinaryOperatorWhenMinifying(binary) {
  switch (binary.op) {
    // Equality tests should always result in smaller code when folded
    case BinOpLooseEq:
    case BinOpLooseNe:
    case BinOpStrictEq:
    case BinOpStrictNe:

    // Minification always folds right signed shift operations since they are
    // unlikely to result in larger output. Note: ">>>" could result in
    // bigger output such as "-1 >>> 0" becoming "4294967295".
    // falls through
    case BinOpShr:

    // Minification always folds the following bitwise operations since they
    // are unlikely to result in larger output.
    // falls through
    case BinOpBitwiseAnd:
    case BinOpBitwiseOr:
    case BinOpBitwiseXor:
    case BinOpLt:
    case BinOpGt:
    case BinOpLe:
    case BinOpGe:
      return true;

    case BinOpAdd: {
      // Addition of small-ish integers can definitely be folded without issues
      // "1 + 2" => "3"
      const $d15 = extractNumericValues(binary.left, binary.right);
      const left = $d15[0], right = $d15[1], ok = $d15[2];
      if (ok && left === Math.trunc(left) && Math.abs(left) <= 0xffffffff && right === Math.trunc(right) && Math.abs(right) <= 0xffffffff) {
        return true;
      }

      // String addition should pretty much always be more compact when folded
      if (extractStringValues(binary.left, binary.right)[2]) {
        return true;
      }
      break;
    }

    case BinOpSub: {
      // Subtraction of small-ish integers can definitely be folded without issues
      // "3 - 1" => "2"
      const $d16 = extractNumericValues(binary.left, binary.right);
      const left = $d16[0], right = $d16[1], ok = $d16[2];
      if (ok && left === Math.trunc(left) && Math.abs(left) <= 0xffffffff && right === Math.trunc(right) && Math.abs(right) <= 0xffffffff) {
        return true;
      }
      break;
    }

    case BinOpMul: {
      // Allow multiplication of small-ish integers to be folded
      // "1 * 2" => "3"
      const $d17 = extractNumericValues(binary.left, binary.right);
      const left = $d17[0], right = $d17[1], ok = $d17[2];
      if (ok && left === Math.trunc(left) && Math.abs(left) <= 0xff && right === Math.trunc(right) && Math.abs(right) <= 0xff) {
        return true;
      }
      break;
    }

    case BinOpDiv: {
      // "0/0" => "NaN"
      // "1/0" => "Infinity"
      // "1/-0" => "-Infinity"
      const $d18 = extractNumericValues(binary.left, binary.right);
      const right = $d18[1], ok = $d18[2];
      if (ok && right === 0) {
        return true;
      }
      break;
    }

    case BinOpShl: {
      // "1 << 3" => "8"
      // "1 << 24" => "1 << 24" (since "1<<24" is shorter than "16777216")
      const $d19 = extractNumericValues(binary.left, binary.right);
      const left = $d19[0], right = $d19[1], ok = $d19[2];
      if (ok) {
        const leftLen = approximatePrintedIntCharCount(left);
        const rightLen = approximatePrintedIntCharCount(right);
        const resultLen = approximatePrintedIntCharCount(toInt32(left) << (toUint32(right) & 31));
        return resultLen <= leftLen + 2 + rightLen;
      }
      break;
    }

    case BinOpUShr: {
      // "10 >>> 1" => "5"
      // "-1 >>> 0" => "-1 >>> 0" (since "-1>>>0" is shorter than "4294967295")
      const $d20 = extractNumericValues(binary.left, binary.right);
      const left = $d20[0], right = $d20[1], ok = $d20[2];
      if (ok) {
        const leftLen = approximatePrintedIntCharCount(left);
        const rightLen = approximatePrintedIntCharCount(right);
        const resultLen = approximatePrintedIntCharCount(toUint32(left) >>> (toUint32(right) & 31));
        return resultLen <= leftLen + 3 + rightLen;
      }
      break;
    }

    case BinOpLogicalAnd:
    case BinOpLogicalOr:
    case BinOpNullishCoalescing:
      if (isPrimitiveLiteral(binary.left.data)) {
        return true;
      }
      break;
  }
  return false;
}

// This function intentionally avoids mutating the input AST so it can be
// called after the AST has been frozen (i.e. after parsing ends).
export function foldBinaryOperator(loc, e) {
  switch (e.op) {
    case BinOpAdd: {
      const $d21 = extractNumericValues(e.left, e.right);
      const left = $d21[0], right = $d21[1], ok = $d21[2];
      if (ok) {
        return new Expr(new ENumber(left + right), loc);
      }
      const $d22 = extractStringValues(e.left, e.right);
      const ls = $d22[0], rs = $d22[1], ok2 = $d22[2];
      if (ok2) {
        return new Expr(new EString(joinStrings(ls, rs)), loc);
      }
      break;
    }

    case BinOpSub: {
      const $d23 = extractNumericValues(e.left, e.right);
      const left = $d23[0], right = $d23[1], ok = $d23[2];
      if (ok) {
        return new Expr(new ENumber(left - right), loc);
      }
      break;
    }

    case BinOpMul: {
      const $d24 = extractNumericValues(e.left, e.right);
      const left = $d24[0], right = $d24[1], ok = $d24[2];
      if (ok) {
        return new Expr(new ENumber(left * right), loc);
      }
      break;
    }

    case BinOpDiv: {
      const $d25 = extractNumericValues(e.left, e.right);
      const left = $d25[0], right = $d25[1], ok = $d25[2];
      if (ok) {
        return new Expr(new ENumber(left / right), loc);
      }
      break;
    }

    case BinOpRem: {
      const $d26 = extractNumericValues(e.left, e.right);
      const left = $d26[0], right = $d26[1], ok = $d26[2];
      if (ok) {
        return new Expr(new ENumber(goMathMod(left, right)), loc);
      }
      break;
    }

    case BinOpPow: {
      const $d27 = extractNumericValues(e.left, e.right);
      const left = $d27[0], right = $d27[1], ok = $d27[2];
      if (ok) {
        return new Expr(new ENumber(goMathPow(left, right)), loc);
      }
      break;
    }

    case BinOpShl: {
      const $d28 = extractNumericValues(e.left, e.right);
      const left = $d28[0], right = $d28[1], ok = $d28[2];
      if (ok) {
        return new Expr(new ENumber(toInt32(left) << (toUint32(right) & 31)), loc);
      }
      break;
    }

    case BinOpShr: {
      const $d29 = extractNumericValues(e.left, e.right);
      const left = $d29[0], right = $d29[1], ok = $d29[2];
      if (ok) {
        return new Expr(new ENumber(toInt32(left) >> (toUint32(right) & 31)), loc);
      }
      break;
    }

    case BinOpUShr: {
      const $d30 = extractNumericValues(e.left, e.right);
      const left = $d30[0], right = $d30[1], ok = $d30[2];
      if (ok) {
        return new Expr(new ENumber(toUint32(left) >>> (toUint32(right) & 31)), loc);
      }
      break;
    }

    case BinOpBitwiseAnd: {
      const $d31 = extractNumericValues(e.left, e.right);
      const left = $d31[0], right = $d31[1], ok = $d31[2];
      if (ok) {
        return new Expr(new ENumber(toInt32(left) & toInt32(right)), loc);
      }
      break;
    }

    case BinOpBitwiseOr: {
      const $d32 = extractNumericValues(e.left, e.right);
      const left = $d32[0], right = $d32[1], ok = $d32[2];
      if (ok) {
        return new Expr(new ENumber(toInt32(left) | toInt32(right)), loc);
      }
      break;
    }

    case BinOpBitwiseXor: {
      const $d33 = extractNumericValues(e.left, e.right);
      const left = $d33[0], right = $d33[1], ok = $d33[2];
      if (ok) {
        return new Expr(new ENumber(toInt32(left) ^ toInt32(right)), loc);
      }
      break;
    }

    case BinOpLt: {
      const $d34 = extractNumericValues(e.left, e.right);
      const left = $d34[0], right = $d34[1], ok = $d34[2];
      if (ok) {
        return new Expr(new EBoolean(left < right), loc);
      }
      const $d35 = extractStringValues(e.left, e.right);
      const ls = $d35[0], rs = $d35[1], ok2 = $d35[2];
      if (ok2) {
        return new Expr(new EBoolean(stringCompareUCS2(ls, rs) < 0), loc);
      }
      break;
    }

    case BinOpGt: {
      const $d36 = extractNumericValues(e.left, e.right);
      const left = $d36[0], right = $d36[1], ok = $d36[2];
      if (ok) {
        return new Expr(new EBoolean(left > right), loc);
      }
      const $d37 = extractStringValues(e.left, e.right);
      const ls = $d37[0], rs = $d37[1], ok2 = $d37[2];
      if (ok2) {
        return new Expr(new EBoolean(stringCompareUCS2(ls, rs) > 0), loc);
      }
      break;
    }

    case BinOpLe: {
      const $d38 = extractNumericValues(e.left, e.right);
      const left = $d38[0], right = $d38[1], ok = $d38[2];
      if (ok) {
        return new Expr(new EBoolean(left <= right), loc);
      }
      const $d39 = extractStringValues(e.left, e.right);
      const ls = $d39[0], rs = $d39[1], ok2 = $d39[2];
      if (ok2) {
        return new Expr(new EBoolean(stringCompareUCS2(ls, rs) <= 0), loc);
      }
      break;
    }

    case BinOpGe: {
      const $d40 = extractNumericValues(e.left, e.right);
      const left = $d40[0], right = $d40[1], ok = $d40[2];
      if (ok) {
        return new Expr(new EBoolean(left >= right), loc);
      }
      const $d41 = extractStringValues(e.left, e.right);
      const ls = $d41[0], rs = $d41[1], ok2 = $d41[2];
      if (ok2) {
        return new Expr(new EBoolean(stringCompareUCS2(ls, rs) >= 0), loc);
      }
      break;
    }

    case BinOpLooseEq:
    case BinOpStrictEq: {
      const $d42 = extractNumericValues(e.left, e.right);
      const left = $d42[0], right = $d42[1], ok = $d42[2];
      if (ok) {
        return new Expr(new EBoolean(left === right), loc);
      }
      const $d43 = extractStringValues(e.left, e.right);
      const ls = $d43[0], rs = $d43[1], ok2 = $d43[2];
      if (ok2) {
        return new Expr(new EBoolean(stringCompareUCS2(ls, rs) === 0), loc);
      }
      break;
    }

    case BinOpLooseNe:
    case BinOpStrictNe: {
      const $d44 = extractNumericValues(e.left, e.right);
      const left = $d44[0], right = $d44[1], ok = $d44[2];
      if (ok) {
        return new Expr(new EBoolean(left !== right), loc);
      }
      const $d45 = extractStringValues(e.left, e.right);
      const ls = $d45[0], rs = $d45[1], ok2 = $d45[2];
      if (ok2) {
        return new Expr(new EBoolean(stringCompareUCS2(ls, rs) !== 0), loc);
      }
      break;
    }

    case BinOpLogicalAnd: {
      const $d46 = toBooleanWithSideEffects(e.left.data);
      const boolean = $d46[0], sideEffects = $d46[1], ok = $d46[2];
      if (ok) {
        if (!boolean) {
          return e.left;
        } else if (sideEffects === NoSideEffects) {
          return e.right;
        }
      }
      break;
    }

    case BinOpLogicalOr: {
      const $d47 = toBooleanWithSideEffects(e.left.data);
      const boolean = $d47[0], sideEffects = $d47[1], ok = $d47[2];
      if (ok) {
        if (boolean) {
          return e.left;
        } else if (sideEffects === NoSideEffects) {
          return e.right;
        }
      }
      break;
    }

    case BinOpNullishCoalescing: {
      const $d48 = toNullOrUndefinedWithSideEffects(e.left.data);
      const isNullOrUndefined = $d48[0], sideEffects = $d48[1], ok = $d48[2];
      if (ok) {
        if (!isNullOrUndefined) {
          return e.left;
        } else if (sideEffects === NoSideEffects) {
          return e.right;
        }
      }
      break;
    }
  }

  return null;
}

// Returns [Expr, Expr, ok]
export function isBinaryNullAndUndefined(left, right, op) {
  const a = left.data;
  if (a.k === E_BINARY && a.op === op) {
    const b = right.data;
    if (b.k === E_BINARY && b.op === op) {
      let idA = a.left;
      let eqA = a.right;
      let idB = b.left;
      let eqB = b.right;

      // Detect when the identifier comes second and flip the order of our checks
      if (eqA.data.k === E_IDENTIFIER) {
        const tmp = idA;
        idA = eqA;
        eqA = tmp;
      }
      if (eqB.data.k === E_IDENTIFIER) {
        const tmp = idB;
        idB = eqB;
        eqB = tmp;
      }

      if (idA.data.k === E_IDENTIFIER) {
        if (idB.data.k === E_IDENTIFIER && idA.data.ref === idB.data.ref) {
          // "a === null || a === void 0"
          if (eqA.data.k === E_NULL) {
            if (eqB.data.k === E_UNDEFINED) {
              return [a.left, a.right, true];
            }
          }

          // "a === void 0 || a === null"
          if (eqA.data.k === E_UNDEFINED) {
            if (eqB.data.k === E_NULL) {
              return [b.left, b.right, true];
            }
          }
        }
      }
    }
  }

  return [null, null, false];
}

// Returns [equal, ok]
export function checkEqualityBigInt(a, b) {
  // Equal literals are always equal
  if (a === b) {
    return [true, true];
  }

  // Unequal literals are unequal if neither has a radix. Leading zeros are
  // disallowed in bigint literals without a radix, so in this case we know
  // each value is in canonical form.
  if ((a.length < 2 || a.charCodeAt(0) !== 48) && (b.length < 2 || b.charCodeAt(0) !== 48)) {
    return [false, true];
  }

  return [false, false];
}

// EqualityKind
export const LooseEquality = 0;
export const StrictEquality = 1;

// Returns "equal, ok". If "ok" is false, then nothing is known about the two
// values. If "ok" is true, the equality or inequality of the two values is
// stored in "equal".
export function checkEqualityIfNoSideEffects(left, right, kind) {
  if (right !== null && right.k === E_INLINED_ENUM) {
    return checkEqualityIfNoSideEffects(left, right.value.data, kind);
  }
  if (left === null) return [false, false];
  const rk = right !== null ? right.k : 0;

  const l = left;
  switch (l.k) {
    case E_INLINED_ENUM:
      return checkEqualityIfNoSideEffects(l.value.data, right, kind);

    case E_NULL:
      switch (rk) {
        case E_NULL:
          // "null === null" is true
          return [true, true];

        case E_UNDEFINED:
          // "null == undefined" is true
          // "null === undefined" is false
          return [kind === LooseEquality, true];

        default:
          if (isPrimitiveLiteral(right)) {
            // "null == (not null or undefined)" is false
            return [false, true];
          }
      }
      break;

    case E_UNDEFINED:
      switch (rk) {
        case E_UNDEFINED:
          // "undefined === undefined" is true
          return [true, true];

        case E_NULL:
          // "undefined == null" is true
          // "undefined === null" is false
          return [kind === LooseEquality, true];

        default:
          if (isPrimitiveLiteral(right)) {
            // "undefined == (not null or undefined)" is false
            return [false, true];
          }
      }
      break;

    case E_BOOLEAN:
      switch (rk) {
        case E_BOOLEAN:
          // "false === false" is true
          // "false === true" is false
          return [l.value === right.value, true];

        case E_NUMBER:
          if (kind === LooseEquality) {
            if (l.value) {
              // "true == 1" is true
              return [right.value === 1, true];
            } else {
              // "false == 0" is true
              return [right.value === 0, true];
            }
          } else {
            // "true === 1" is false
            // "false === 0" is false
            return [false, true];
          }

        case E_NULL:
        case E_UNDEFINED:
          // "(not null or undefined) == undefined" is false
          return [false, true];

        default:
          if (kind === StrictEquality && isPrimitiveLiteral(right)) {
            // "boolean === (not boolean)" is false
            return [false, true];
          }
      }
      break;

    case E_NUMBER:
      switch (rk) {
        case E_NUMBER:
          // "0 === 0" is true
          // "0 === 1" is false
          return [l.value === right.value, true];

        case E_BOOLEAN:
          if (kind === LooseEquality) {
            if (right.value) {
              // "1 == true" is true
              return [l.value === 1, true];
            } else {
              // "0 == false" is true
              return [l.value === 0, true];
            }
          } else {
            // "1 === true" is false
            // "0 === false" is false
            return [false, true];
          }

        case E_NULL:
        case E_UNDEFINED:
          // "(not null or undefined) == undefined" is false
          return [false, true];

        default:
          if (kind === StrictEquality && isPrimitiveLiteral(right)) {
            // "number === (not number)" is false
            return [false, true];
          }
      }
      break;

    case E_BIG_INT:
      switch (rk) {
        case E_BIG_INT:
          // "0n === 0n" is true
          // "0n === 1n" is false
          return checkEqualityBigInt(l.value, right.value);

        case E_NULL:
        case E_UNDEFINED:
          // "(not null or undefined) == undefined" is false
          return [false, true];

        default:
          if (kind === StrictEquality && isPrimitiveLiteral(right)) {
            // "bigint === (not bigint)" is false
            return [false, true];
          }
      }
      break;

    case E_STRING:
      switch (rk) {
        case E_STRING:
          // "'a' === 'a'" is true
          // "'a' === 'b'" is false
          return [utf16EqualsUTF16(l.value, right.value), true];

        case E_NULL:
        case E_UNDEFINED:
          // "(not null or undefined) == undefined" is false
          return [false, true];

        default:
          if (kind === StrictEquality && isPrimitiveLiteral(right)) {
            // "string === (not string)" is false
            return [false, true];
          }
      }
      break;
  }

  return [false, false];
}

export function valuesLookTheSame(left, right) {
  if (right !== null && right.k === E_INLINED_ENUM) {
    return valuesLookTheSame(left, right.value.data);
  }
  if (left === null) return false;
  const rk = right !== null ? right.k : 0;

  const a = left;
  switch (a.k) {
    case E_INLINED_ENUM:
      return valuesLookTheSame(a.value.data, right);

    case E_IDENTIFIER:
      if (rk === E_IDENTIFIER && a.ref === right.ref) {
        return true;
      }
      break;

    case E_DOT:
      if (rk === E_DOT && a.hasSameFlagsAs(right) && a.name === right.name && valuesLookTheSame(a.target.data, right.target.data)) {
        return true;
      }
      break;

    case E_INDEX:
      if (
        rk === E_INDEX &&
        a.hasSameFlagsAs(right) &&
        valuesLookTheSame(a.target.data, right.target.data) &&
        valuesLookTheSame(a.index.data, right.index.data)
      ) {
        return true;
      }
      break;

    case E_IF:
      if (
        rk === E_IF &&
        valuesLookTheSame(a.test.data, right.test.data) &&
        valuesLookTheSame(a.yes.data, right.yes.data) &&
        valuesLookTheSame(a.no.data, right.no.data)
      ) {
        return true;
      }
      break;

    case E_UNARY:
      if (rk === E_UNARY && a.op === right.op && valuesLookTheSame(a.value.data, right.value.data)) {
        return true;
      }
      break;

    case E_BINARY:
      if (rk === E_BINARY && a.op === right.op && valuesLookTheSame(a.left.data, right.left.data) && valuesLookTheSame(a.right.data, right.right.data)) {
        return true;
      }
      break;

    case E_CALL:
      if (rk === E_CALL && a.hasSameFlagsAs(right) && a.args.length === right.args.length && valuesLookTheSame(a.target.data, right.target.data)) {
        for (let i = 0; i < a.args.length; i++) {
          if (!valuesLookTheSame(a.args[i].data, right.args[i].data)) {
            return false;
          }
        }
        return true;
      }
      break;

    // Special-case to distinguish between negative an non-negative zero when mangling
    // "a ? -0 : 0" => "a ? -0 : 0"
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness
    case E_NUMBER:
      if (rk === E_NUMBER && a.value === 0 && right.value === 0 && signbit(a.value) !== signbit(right.value)) {
        return false;
      }
      break;
  }

  const $d49 = checkEqualityIfNoSideEffects(left, right, StrictEquality);
  const equal = $d49[0], ok = $d49[1];
  return ok && equal;
}

export function tryToInsertOptionalChain(test, expr) {
  if (expr === null) return false;
  const e = expr.data;
  switch (e.k) {
    case E_DOT:
      if (valuesLookTheSame(test.data, e.target.data)) {
        e.optionalChain = OptionalChainStart;
        return true;
      }
      if (tryToInsertOptionalChain(test, e.target)) {
        if (e.optionalChain === OptionalChainNone) {
          e.optionalChain = OptionalChainContinue;
        }
        return true;
      }
      break;

    case E_INDEX:
      if (valuesLookTheSame(test.data, e.target.data)) {
        e.optionalChain = OptionalChainStart;
        return true;
      }
      if (tryToInsertOptionalChain(test, e.target)) {
        if (e.optionalChain === OptionalChainNone) {
          e.optionalChain = OptionalChainContinue;
        }
        return true;
      }
      break;

    case E_CALL:
      if (valuesLookTheSame(test.data, e.target.data)) {
        e.optionalChain = OptionalChainStart;
        return true;
      }
      if (tryToInsertOptionalChain(test, e.target)) {
        if (e.optionalChain === OptionalChainNone) {
          e.optionalChain = OptionalChainContinue;
        }
        return true;
      }
      break;
  }

  return false;
}

function joinStrings(a, b) {
  return a + b;
}

// String concatenation with numbers is required by the TypeScript compiler for
// "constant expression" handling in enums. However, we don't want to introduce
// correctness bugs by accidentally stringifying a number differently than how
// a real JavaScript VM would do it. So we are conservative and we only do this
// when we know it'll be the same result.
//
// Returns [string, ok]. Go: "if i := int32(n); float64(i) == n" holds exactly
// when n is an int32 value (including -0), i.e. when "(n | 0) === n".
// strconv.FormatInt uses lowercase digits like Number.prototype.toString.
export function tryToStringOnNumberSafely(n, radix)                    {
  const i = n | 0;
  if (i === n) {
    if (radix < 2 || radix > 36) throw new GoPanic("strconv: illegal AppendInt/FormatInt base");
    return [i.toString(radix), true];
  }
  if (n !== n) {
    return ["NaN", true];
  }
  if (n === Infinity) {
    return ["Infinity", true];
  }
  if (n === -Infinity) {
    return ["-Infinity", true];
  }
  return ["", false];
}

// Note: We don't know if this is string addition yet at this point
function foldAdditionPreProcess(expr) {
  const e = expr.data;
  switch (e.k) {
    case E_INLINED_ENUM:
      // "See through" inline enum constants
      expr = e.value;
      break;

    case E_ARRAY: {
      // "[] + x" => "'' + x"
      // "[1,2] + x" => "'1,2' + x"
      const items = [];
      for (let $i10 = 0, $a10 = e.items; $i10 < $a10.length; $i10++) {
        const item = $a10[$i10];
        let itemData = item.data;
        const ik = itemData.k;
        if (ik === E_UNDEFINED || ik === E_NULL) {
          items.push("");
          continue;
        }
        const $d50 = toStringWithoutSideEffects(itemData);
        const str = $d50[0], ok = $d50[1];
        if (ok) {
          itemData = new EString(str);
        }
        if (itemData.k !== E_STRING) {
          break;
        }
        items.push(itemData.value);
      }
      if (items.length === e.items.length) {
        expr = new Expr(new EString(items.join(",")), expr.loc);
      }
      break;
    }

    case E_OBJECT:
      // "{} + x" => "'[object Object]' + x"
      if (e.properties.length === 0) {
        expr = new Expr(new EString("[object Object]"), expr.loc);
      }
      break;
  }
  return expr;
}

// StringAdditionKind
export const StringAdditionNormal = 0;
export const StringAdditionWithNestedLeft = 1;

// This function intentionally avoids mutating the input AST so it can be
// called after the AST has been frozen (i.e. after parsing ends).
export function foldStringAddition(left, right, kind) {
  left = foldAdditionPreProcess(left);
  right = foldAdditionPreProcess(right);

  // Transforming the left operand into a string is not safe if it comes from
  // a nested AST node. The following transforms are invalid:
  //
  //   "0 + 1 + 'x'" => "0 + '1x'"
  //   "0 + 1 + `${x}`" => "0 + `1${x}`"
  //
  if (kind !== StringAdditionWithNestedLeft) {
    const rk = right.data.k;
    if (rk === E_STRING || rk === E_TEMPLATE) {
      const $d51 = toStringWithoutSideEffects(left.data);
      const str = $d51[0], ok = $d51[1];
      if (ok) {
        left = new Expr(new EString(str), left.loc);
      }
    }
  }

  const l = left.data;
  switch (l.k) {
    case E_STRING: {
      // "'x' + 0" => "'x' + '0'"
      const $d52 = toStringWithoutSideEffects(right.data);
      const str = $d52[0], ok = $d52[1];
      if (ok) {
        right = new Expr(new EString(str), right.loc);
      }

      const r = right.data;
      switch (r.k) {
        case E_STRING:
          // "'x' + 'y'" => "'xy'"
          return new Expr(new EString(joinStrings(l.value, r.value), 0, l.preferTemplate || r.preferTemplate), left.loc);

        case E_TEMPLATE:
          if (r.tagOrNil === null) {
            // "'x' + `y${z}`" => "`xy${z}`"
            return new Expr(new ETemplate(null, "", joinStrings(l.value, r.headCooked), r.parts, left.loc), left.loc);
          }
          break;
      }

      // "'' + typeof x" => "typeof x"
      if (l.value.length === 0 && knownPrimitiveType(right.data) === PrimitiveString) {
        return right;
      }
      break;
    }

    case E_TEMPLATE:
      if (l.tagOrNil === null) {
        // "`${x}` + 0" => "`${x}` + '0'"
        const $d53 = toStringWithoutSideEffects(right.data);
        const str = $d53[0], ok = $d53[1];
        if (ok) {
          right = new Expr(new EString(str), right.loc);
        }

        const r = right.data;
        switch (r.k) {
          case E_STRING: {
            // "`${x}y` + 'z'" => "`${x}yz`"
            const n = l.parts.length;
            let head = l.headCooked;
            const parts = new Array(n);
            if (n === 0) {
              head = joinStrings(head, r.value);
            } else {
              for (let i = 0; i < n; i++) parts[i] = l.parts[i].clone();
              parts[n - 1].tailCooked = joinStrings(parts[n - 1].tailCooked, r.value);
            }
            return new Expr(new ETemplate(null, "", head, parts, l.headLoc), left.loc);
          }

          case E_TEMPLATE:
            if (r.tagOrNil === null) {
              // "`${a}b` + `x${y}`" => "`${a}bx${y}`"
              const n = l.parts.length;
              let head = l.headCooked;
              const parts = new Array(n + r.parts.length);
              for (let i = 0; i < r.parts.length; i++) parts[n + i] = r.parts[i].clone();
              if (n === 0) {
                head = joinStrings(head, r.headCooked);
              } else {
                for (let i = 0; i < n; i++) parts[i] = l.parts[i].clone();
                parts[n - 1].tailCooked = joinStrings(parts[n - 1].tailCooked, r.headCooked);
              }
              return new Expr(new ETemplate(null, "", head, parts, l.headLoc), left.loc);
            }
            break;
        }
      }
      break;
  }

  // "typeof x + ''" => "typeof x"
  const r = right.data;
  if (r.k === E_STRING && r.value.length === 0 && knownPrimitiveType(left.data) === PrimitiveString) {
    return left;
  }

  return null;
}

// "`a${'b'}c`" => "`abc`"
//
// This function intentionally avoids mutating the input AST so it can be
// called after the AST has been frozen (i.e. after parsing ends).
export function inlinePrimitivesIntoTemplate(loc, e) {
  // Can't inline strings if there's a custom template tag
  if (e.tagOrNil !== null) {
    return new Expr(e, loc);
  }

  let headCooked = e.headCooked;
  const parts = [];

  for (let $i11 = 0, $a11 = e.parts; $i11 < $a11.length; $i11++) {
    const original = $a11[$i11];
    const part = original.clone(); // Go copies the struct
    const value = part.value.data;
    if (value.k === E_INLINED_ENUM) {
      part.value = value.value;
    }
    const $d54 = toStringWithoutSideEffects(part.value.data);
    const str = $d54[0], ok = $d54[1];
    if (ok) {
      part.value = new Expr(new EString(str), part.value.loc);
    }
    const s = part.value.data;
    if (s.k === E_STRING) {
      if (parts.length === 0) {
        headCooked = headCooked + s.value + part.tailCooked;
      } else {
        const prevPart = parts[parts.length - 1];
        prevPart.tailCooked = prevPart.tailCooked + s.value + part.tailCooked;
      }
    } else {
      parts.push(part);
    }
  }

  // Become a plain string if there are no substitutions
  if (parts.length === 0) {
    return new Expr(new EString(headCooked, 0, true), loc);
  }

  return new Expr(new ETemplate(null, "", headCooked, parts, e.headLoc), loc);
}

// SideEffects
export const CouldHaveSideEffects = 0;
export const NoSideEffects = 1;

// Returns [isNullOrUndefined, sideEffects, ok]
export function toNullOrUndefinedWithSideEffects(data) {
  if (data === null) return [false, NoSideEffects, false];
  const e = data;
  switch (e.k) {
    case E_ANNOTATION: {
      let result = toNullOrUndefinedWithSideEffects(e.value.data);
      if ((e.flags & CanBeRemovedIfUnusedFlag) !== 0) {
        result = [result[0], NoSideEffects, result[2]]; // (results may be shared)
      }
      return result;
    }

    case E_INLINED_ENUM:
      return toNullOrUndefinedWithSideEffects(e.value.data);

    // Never null or undefined
    case E_BOOLEAN:
    case E_NUMBER:
    case E_STRING:
    case E_REG_EXP:
    case E_FUNCTION:
    case E_ARROW:
    case E_BIG_INT:
      return [false, NoSideEffects, true];

    // Never null or undefined
    case E_OBJECT:
    case E_ARRAY:
    case E_CLASS:
      return [false, CouldHaveSideEffects, true];

    // Always null or undefined
    case E_NULL:
    case E_UNDEFINED:
      return [true, NoSideEffects, true];

    case E_UNARY:
      switch (e.op) {
        // Always number or bigint
        case UnOpPos:
        case UnOpNeg:
        case UnOpCpl:
        case UnOpPreDec:
        case UnOpPreInc:
        case UnOpPostDec:
        case UnOpPostInc:
        // Always boolean
        // falls through
        case UnOpNot:
        case UnOpDelete:
          return [false, CouldHaveSideEffects, true];

        // Always boolean
        case UnOpTypeof:
          if (e.wasOriginallyTypeofIdentifier) {
            // Expressions such as "typeof x" never have any side effects
            return [false, NoSideEffects, true];
          }
          return [false, CouldHaveSideEffects, true];

        // Always undefined
        case UnOpVoid:
          return [true, CouldHaveSideEffects, true];
      }
      break;

    case E_BINARY:
      switch (e.op) {
        // Always string or number or bigint
        case BinOpAdd:
        case BinOpAddAssign:
        // Always number or bigint
        // falls through
        case BinOpSub:
        case BinOpMul:
        case BinOpDiv:
        case BinOpRem:
        case BinOpPow:
        case BinOpSubAssign:
        case BinOpMulAssign:
        case BinOpDivAssign:
        case BinOpRemAssign:
        case BinOpPowAssign:
        case BinOpShl:
        case BinOpShr:
        case BinOpUShr:
        case BinOpShlAssign:
        case BinOpShrAssign:
        case BinOpUShrAssign:
        case BinOpBitwiseOr:
        case BinOpBitwiseAnd:
        case BinOpBitwiseXor:
        case BinOpBitwiseOrAssign:
        case BinOpBitwiseAndAssign:
        case BinOpBitwiseXorAssign:
        // Always boolean
        // falls through
        case BinOpLt:
        case BinOpLe:
        case BinOpGt:
        case BinOpGe:
        case BinOpIn:
        case BinOpInstanceof:
        case BinOpLooseEq:
        case BinOpLooseNe:
        case BinOpStrictEq:
        case BinOpStrictNe:
          return [false, CouldHaveSideEffects, true];

        case BinOpComma: {
          const $d55 = toNullOrUndefinedWithSideEffects(e.right.data);
          const isNullOrUndefined = $d55[0], ok = $d55[2];
          if (ok) {
            return [isNullOrUndefined, CouldHaveSideEffects, true];
          }
          break;
        }
      }
      break;
  }

  return NULL_OR_UNDEFINED_UNKNOWN; // [false, NoSideEffects, false]
}

// (Shared: callers only read the results)
const NULL_OR_UNDEFINED_UNKNOWN = Object.freeze([false, NoSideEffects, false]);

// Returns [boolean, sideEffects, ok]
export function toBooleanWithSideEffects(data) {
  if (data === null) return [false, CouldHaveSideEffects, false];
  const e = data;
  switch (e.k) {
    case E_ANNOTATION: {
      let result = toBooleanWithSideEffects(e.value.data);
      if ((e.flags & CanBeRemovedIfUnusedFlag) !== 0) {
        result = [result[0], NoSideEffects, result[2]]; // (results may be shared)
      }
      return result;
    }

    case E_INLINED_ENUM:
      return toBooleanWithSideEffects(e.value.data);

    case E_NULL:
    case E_UNDEFINED:
      return [false, NoSideEffects, true];

    case E_BOOLEAN:
      return [e.value, NoSideEffects, true];

    case E_NUMBER:
      return [e.value !== 0 && e.value === e.value, NoSideEffects, true];

    case E_BIG_INT: {
      const $d56 = checkEqualityBigInt(e.value, "0");
      const equal = $d56[0], ok = $d56[1];
      return [!equal, NoSideEffects, ok];
    }

    case E_STRING:
      return [e.value.length > 0, NoSideEffects, true];

    case E_FUNCTION:
    case E_ARROW:
    case E_REG_EXP:
      return [true, NoSideEffects, true];

    case E_OBJECT:
    case E_ARRAY:
    case E_CLASS:
      return [true, CouldHaveSideEffects, true];

    case E_UNARY:
      switch (e.op) {
        case UnOpVoid:
          return [false, CouldHaveSideEffects, true];

        case UnOpTypeof:
          // Never an empty string
          if (e.wasOriginallyTypeofIdentifier) {
            // Expressions such as "typeof x" never have any side effects
            return [true, NoSideEffects, true];
          }
          return [true, CouldHaveSideEffects, true];

        case UnOpNot: {
          const $d57 = toBooleanWithSideEffects(e.value.data);
          const boolean = $d57[0], sideEffects = $d57[1], ok = $d57[2];
          if (ok) {
            return [!boolean, sideEffects, true];
          }
          break;
        }
      }
      break;

    case E_BINARY:
      switch (e.op) {
        case BinOpLogicalOr: {
          // "anything || truthy" is truthy
          const $d58 = toBooleanWithSideEffects(e.right.data);
          const boolean = $d58[0], ok = $d58[2];
          if (ok && boolean) {
            return [true, CouldHaveSideEffects, true];
          }
          break;
        }

        case BinOpLogicalAnd: {
          // "anything && falsy" is falsy
          const $d59 = toBooleanWithSideEffects(e.right.data);
          const boolean = $d59[0], ok = $d59[2];
          if (ok && !boolean) {
            return [false, CouldHaveSideEffects, true];
          }
          break;
        }

        case BinOpComma: {
          // "anything, truthy/falsy" is truthy/falsy
          const $d60 = toBooleanWithSideEffects(e.right.data);
          const boolean = $d60[0], ok = $d60[2];
          if (ok) {
            return [boolean, CouldHaveSideEffects, true];
          }
          break;
        }
      }
      break;
  }

  return BOOLEAN_UNKNOWN; // [false, CouldHaveSideEffects, false]
}

// (Shared: callers only read the results)
const BOOLEAN_UNKNOWN = Object.freeze([false, CouldHaveSideEffects, false]);

Object.assign(HelperContext.prototype, {
  // Simplify syntax when we know it's used inside a boolean context
  //
  // This function intentionally avoids mutating the input AST so it can be
  // called after the AST has been frozen (i.e. after parsing ends).
  simplifyBooleanExpr(expr) {
    const ctx = this;
    if (expr === null) return null;
    const e = expr.data;
    switch (e.k) {
      case E_UNARY:
        if (e.op === UnOpNot) {
          // "!!a" => "a"
          const e2 = e.value.data;
          if (e2.k === E_UNARY && e2.op === UnOpNot) {
            return ctx.simplifyBooleanExpr(e2.value);
          }

          // "!!!a" => "!a"
          return new Expr(new EUnary(ctx.simplifyBooleanExpr(e.value), UnOpNot), expr.loc);
        }
        break;

      case E_BINARY: {
        let left = e.left;
        let right = e.right;

        switch (e.op) {
          case BinOpStrictEq:
          case BinOpStrictNe:
          case BinOpLooseEq:
          case BinOpLooseNe: {
            const $d61 = extractNumericValue(right.data);
            const r = $d61[0], ok = $d61[1];
            if (ok && r === 0 && isInt32OrUint32(left.data)) {
              // If the left is guaranteed to be an integer (e.g. not NaN,
              // Infinity, or a non-numeric value) then a test against zero
              // in a boolean context is unnecessary because the value is
              // only truthy if it's not zero.
              if (e.op === BinOpStrictNe || e.op === BinOpLooseNe) {
                // "if ((a >>> b) !== 0)" => "if (a >>> b)"
                return left;
              } else {
                // "if ((a >>> b) === 0)" => "if (!(a >>> b))"
                return not(left);
              }
            }
            break;
          }

          case BinOpLogicalAnd: {
            // "if (!!a && !!b)" => "if (a && b)"
            left = ctx.simplifyBooleanExpr(left);
            right = ctx.simplifyBooleanExpr(right);

            const $d62 = toBooleanWithSideEffects(right.data);
            const boolean = $d62[0], sideEffects = $d62[1], ok = $d62[2];
            if (ok && boolean && sideEffects === NoSideEffects) {
              // "if (anything && truthyNoSideEffects)" => "if (anything)"
              return left;
            }
            break;
          }

          case BinOpLogicalOr: {
            // "if (!!a || !!b)" => "if (a || b)"
            left = ctx.simplifyBooleanExpr(left);
            right = ctx.simplifyBooleanExpr(right);

            const $d63 = toBooleanWithSideEffects(right.data);
            const boolean = $d63[0], sideEffects = $d63[1], ok = $d63[2];
            if (ok && !boolean && sideEffects === NoSideEffects) {
              // "if (anything || falsyNoSideEffects)" => "if (anything)"
              return left;
            }
            break;
          }
        }

        if (!exprIdentical(left, e.left) || !exprIdentical(right, e.right)) {
          return new Expr(new EBinary(left, right, e.op), expr.loc);
        }
        break;
      }

      case E_IF: {
        // "if (a ? !!b : !!c)" => "if (a ? b : c)"
        const yes = ctx.simplifyBooleanExpr(e.yes);
        const no = ctx.simplifyBooleanExpr(e.no);

        {
          const $d64 = toBooleanWithSideEffects(yes.data);
          const boolean = $d64[0], sideEffects = $d64[1], ok = $d64[2];
          if (ok && sideEffects === NoSideEffects) {
            if (boolean) {
              // "if (anything1 ? truthyNoSideEffects : anything2)" => "if (anything1 || anything2)"
              return joinWithLeftAssociativeOp(BinOpLogicalOr, e.test, no);
            } else {
              // "if (anything1 ? falsyNoSideEffects : anything2)" => "if (!anything1 || anything2)"
              return joinWithLeftAssociativeOp(BinOpLogicalAnd, not(e.test), no);
            }
          }
        }

        {
          const $d65 = toBooleanWithSideEffects(no.data);
          const boolean = $d65[0], sideEffects = $d65[1], ok = $d65[2];
          if (ok && sideEffects === NoSideEffects) {
            if (boolean) {
              // "if (anything1 ? anything2 : truthyNoSideEffects)" => "if (!anything1 || anything2)"
              return joinWithLeftAssociativeOp(BinOpLogicalOr, not(e.test), yes);
            } else {
              // "if (anything1 ? anything2 : falsyNoSideEffects)" => "if (anything1 && anything2)"
              return joinWithLeftAssociativeOp(BinOpLogicalAnd, e.test, yes);
            }
          }
        }

        if (!exprIdentical(yes, e.yes) || !exprIdentical(no, e.no)) {
          return new Expr(new EIf(e.test, yes, no), expr.loc);
        }
        break;
      }

      default: {
        // "!![]" => "true"
        const $d66 = toBooleanWithSideEffects(expr.data);
        const boolean = $d66[0], sideEffects = $d66[1], ok = $d66[2];
        if (ok && (sideEffects === NoSideEffects || ctx.exprCanBeRemovedIfUnused(expr))) {
          return new Expr(new EBoolean(boolean), expr.loc);
        }
        break;
      }
    }

    return expr;
  },
});

// StmtsCanBeRemovedIfUnusedFlags
export const KeepExportClauses = 1 << 0;
export const ReturnCanBeRemovedIfUnused = 1 << 1;

Object.assign(HelperContext.prototype, {
  stmtsCanBeRemovedIfUnused(stmts, flags) {
    const ctx = this;
    for (const stmt of stmts) {
      const s = stmt.data;
      switch (s.k) {
        case S_FUNCTION:
        case S_EMPTY:
          // These never have side effects
          break;

        case S_IMPORT:
          // Let these be removed if they are unused. Note that we also need to
          // check if the imported file is marked as "sideEffects: false" before we
          // can remove a SImport statement. Otherwise the import must be kept for
          // its side effects.
          break;

        case S_CLASS:
          if (!ctx.classCanBeRemovedIfUnused(s.class)) {
            return false;
          }
          break;

        case S_RETURN:
          if ((flags & ReturnCanBeRemovedIfUnused) === 0 || (s.valueOrNil !== null && !ctx.exprCanBeRemovedIfUnused(s.valueOrNil))) {
            return false;
          }
          break;

        case S_EXPR:
          if (!ctx.exprCanBeRemovedIfUnused(s.value)) {
            if (s.isFromClassOrFnThatCanBeRemovedIfUnused) {
              // This statement was automatically generated when lowering a class
              // or function that we were able to analyze as having no side effects
              // before lowering. So we consider it to be removable. The assumption
              // here is that we are seeing at least all of the statements from the
              // class lowering operation all at once (although we may possibly be
              // seeing even more statements than that). Since we're making a binary
              // all-or-nothing decision about the side effects of these statements,
              // we can safely consider these to be side-effect free because we
              // aren't in danger of partially dropping some of the class setup code.
            } else {
              return false;
            }
          }
          break;

        case S_LOCAL:
          // "await" is a side effect because it affects code timing
          if (s.kind === LocalAwaitUsing) {
            return false;
          }

          for (let $i12 = 0, $a12 = s.decls; $i12 < $a12.length; $i12++) {
            const decl = $a12[$i12];
            // Check that the bindings are side-effect free
            const binding = decl.binding.data;
            switch (binding.k) {
              case B_IDENTIFIER:
                // An identifier binding has no side effects
                break;

              case B_ARRAY:
                // Destructuring the initializer has no side effects if the
                // initializer is an array, since we assume the iterator is then
                // the built-in side-effect free array iterator.
                if (decl.valueOrNil !== null && decl.valueOrNil.data.k === E_ARRAY) {
                  for (let $i13 = 0, $a13 = binding.items; $i13 < $a13.length; $i13++) {
                    const item = $a13[$i13];
                    if (item.defaultValueOrNil !== null && !ctx.exprCanBeRemovedIfUnused(item.defaultValueOrNil)) {
                      return false;
                    }

                    switch (item.binding.data.k) {
                      case B_IDENTIFIER:
                      case B_MISSING:
                        // Right now we only handle an array pattern with identifier
                        // bindings or with empty holes (i.e. "missing" elements)
                        break;
                      default:
                        return false;
                    }
                  }
                  break;
                }
                return false;

              default:
                // Consider anything else to potentially have side effects
                return false;
            }

            // Check that the initializer is side-effect free
            if (decl.valueOrNil !== null) {
              if (!ctx.exprCanBeRemovedIfUnused(decl.valueOrNil)) {
                return false;
              }

              // "using" declarations are only side-effect free if they are initialized to null or undefined
              if (localKindIsUsing(s.kind)) {
                const t = knownPrimitiveType(decl.valueOrNil.data);
                if (t !== PrimitiveNull && t !== PrimitiveUndefined) {
                  return false;
                }
              }
            }
          }
          break;

        case S_TRY:
          if (!ctx.stmtsCanBeRemovedIfUnused(s.block.stmts, 0) || (s.finally !== null && !ctx.stmtsCanBeRemovedIfUnused(s.finally.block.stmts, 0))) {
            return false;
          }
          break;

        case S_EXPORT_FROM:
          // Exports are tracked separately, so this isn't necessary
          break;

        case S_EXPORT_CLAUSE:
          if ((flags & KeepExportClauses) !== 0) {
            return false;
          }
          break;

        case S_EXPORT_DEFAULT: {
          const s2 = s.value.data;
          switch (s2.k) {
            case S_EXPR:
              if (!ctx.exprCanBeRemovedIfUnused(s2.value)) {
                return false;
              }
              break;

            case S_FUNCTION:
              // These never have side effects
              break;

            case S_CLASS:
              if (!ctx.classCanBeRemovedIfUnused(s2.class)) {
                return false;
              }
              break;

            default:
              throw new GoPanic("Internal error");
          }
          break;
        }

        default:
          // Assume that all statements not explicitly special-cased here have side
          // effects, and cannot be removed even if unused
          return false;
      }
    }

    return true;
  },

  classCanBeRemovedIfUnused(class_) {
    const ctx = this;
    if (class_.decorators.length > 0) {
      return false;
    }

    // Note: This check is incorrect. Extending a non-constructible object can
    // throw an error, which is a side effect:
    //
    //   async function x() {}
    //   class y extends x {}
    //
    // But refusing to tree-shake every class with a base class is not a useful
    // thing for a bundler to do. So we pretend that this edge case doesn't
    // exist. At the time of writing, both Rollup and Terser don't consider this
    // to be a side effect either.
    if (class_.extendsOrNil !== null && !ctx.exprCanBeRemovedIfUnused(class_.extendsOrNil)) {
      return false;
    }

    for (let $i14 = 0, $a14 = class_.properties; $i14 < $a14.length; $i14++) {
      const property = $a14[$i14];
      if (property.kind === PropertyClassStaticBlock) {
        if (!ctx.stmtsCanBeRemovedIfUnused(property.classStaticBlock.block.stmts, 0)) {
          return false;
        }
        continue;
      }

      if (property.decorators.length > 0) {
        return false;
      }

      if ((property.flags & PropertyIsComputed) !== 0 && !isPrimitiveLiteral(property.key.data) && !isSymbolInstance(property.key.data)) {
        return false;
      }

      if (propertyKindIsMethodDefinition(property.kind)) {
        if (property.valueOrNil !== null) {
          const fn = property.valueOrNil.data;
          if (fn.k === E_FUNCTION) {
            for (let $i15 = 0, $a15 = fn.fn.args; $i15 < $a15.length; $i15++) {
              const arg = $a15[$i15];
              if (arg.decorators.length > 0) {
                return false;
              }
            }
          }
        }
      }

      if ((property.flags & PropertyIsStatic) !== 0) {
        if (property.valueOrNil !== null && !ctx.exprCanBeRemovedIfUnused(property.valueOrNil)) {
          return false;
        }

        if (property.initializerOrNil !== null && !ctx.exprCanBeRemovedIfUnused(property.initializerOrNil)) {
          return false;
        }

        // Legacy TypeScript static class fields are considered to have side
        // effects because they use assign semantics, not define semantics, and
        // that can trigger getters. For example:
        //
        //   class Foo {
        //     static set foo(x) { importantSideEffect(x) }
        //   }
        //   class Bar extends Foo {
        //     foo = 1
        //   }
        //
        // This happens in TypeScript when "useDefineForClassFields" is disabled
        // because TypeScript (and esbuild) transforms the above class into this:
        //
        //   class Foo {
        //     static set foo(x) { importantSideEffect(x); }
        //   }
        //   class Bar extends Foo {
        //   }
        //   Bar.foo = 1;
        //
        // Note that it's not possible to analyze the base class to determine that
        // these assignments are side-effect free. For example:
        //
        //   // Some code that already ran before your code
        //   Object.defineProperty(Object.prototype, 'foo', {
        //     set(x) { imporantSideEffect(x) }
        //   })
        //
        //   // Your code
        //   class Foo {
        //     static foo = 1
        //   }
        //
        if (property.kind === PropertyField && !class_.useDefineForClassFields) {
          return false;
        }
      }
    }

    return true;
  },

  exprCanBeRemovedIfUnused(expr) {
    const ctx = this;
    if (expr === null) return false;
    const e = expr.data;
    switch (e.k) {
      case E_ANNOTATION:
        return (e.flags & CanBeRemovedIfUnusedFlag) !== 0;

      case E_INLINED_ENUM:
        return ctx.exprCanBeRemovedIfUnused(e.value);

      case E_NULL:
      case E_UNDEFINED:
      case E_MISSING:
      case E_BOOLEAN:
      case E_NUMBER:
      case E_BIG_INT:
      case E_STRING:
      case E_THIS:
      case E_REG_EXP:
      case E_FUNCTION:
      case E_ARROW:
      case E_IMPORT_META:
        return true;

      case E_DOT:
        return e.canBeRemovedIfUnused;

      case E_CLASS:
        return ctx.classCanBeRemovedIfUnused(e.class);

      case E_IDENTIFIER:
        if (e.mustKeepDueToWithStmt) {
          return false;
        }

        // Unbound identifiers cannot be removed because they can have side effects.
        // One possible side effect is throwing a ReferenceError if they don't exist.
        // Another one is a getter with side effects on the global object:
        //
        //   Object.defineProperty(globalThis, 'x', {
        //     get() {
        //       sideEffect();
        //     },
        //   });
        //
        // Be very careful about this possibility. It's tempting to treat all
        // identifier expressions as not having side effects but that's wrong. We
        // must make sure they have been declared by the code we are currently
        // compiling before we can tell that they have no side effects.
        //
        // Note that we currently ignore ReferenceErrors due to TDZ access. This is
        // incorrect but proper TDZ analysis is very complicated and would have to
        // be very conservative, which would inhibit a lot of optimizations of code
        // inside closures. This may need to be revisited if it proves problematic.
        if (e.canBeRemovedIfUnused || !ctx.isUnbound(e.ref)) {
          return true;
        }
        break;

      case E_IMPORT_IDENTIFIER:
        // References to an ES6 import item are always side-effect free in an
        // ECMAScript environment.
        //
        // They could technically have side effects if the imported module is a
        // CommonJS module and the import item was translated to a property access
        // (which esbuild's bundler does) and the property has a getter with side
        // effects.
        //
        // But this is very unlikely and respecting this edge case would mean
        // disabling tree shaking of all code that references an export from a
        // CommonJS module. It would also likely violate the expectations of some
        // developers because the code *looks* like it should be able to be tree
        // shaken.
        //
        // So we deliberately ignore this edge case and always treat import item
        // references as being side-effect free.
        return true;

      case E_IF:
        return (
          ctx.exprCanBeRemovedIfUnused(e.test) &&
          (ctx.isSideEffectFreeUnboundIdentifierRef(e.yes, e.test, true) || ctx.exprCanBeRemovedIfUnused(e.yes)) &&
          (ctx.isSideEffectFreeUnboundIdentifierRef(e.no, e.test, false) || ctx.exprCanBeRemovedIfUnused(e.no))
        );

      case E_ARRAY:
        for (let item of e.items) {
          const spread = item.data;
          if (spread.k === E_SPREAD) {
            if (spread.value.data.k === E_ARRAY) {
              // Spread of an inline array such as "[...[x]]" is side-effect free
              item = spread.value;
            }
          }

          if (!ctx.exprCanBeRemovedIfUnused(item)) {
            return false;
          }
        }
        return true;

      case E_OBJECT:
        for (let $i16 = 0, $a16 = e.properties; $i16 < $a16.length; $i16++) {
          const property = $a16[$i16];
          // The key must still be evaluated if it's computed or a spread
          if (property.kind === PropertySpread) {
            return false;
          }
          if ((property.flags & PropertyIsComputed) !== 0 && !isPrimitiveLiteral(property.key.data) && !isSymbolInstance(property.key.data)) {
            return false;
          }
          if (property.valueOrNil !== null && !ctx.exprCanBeRemovedIfUnused(property.valueOrNil)) {
            return false;
          }
        }
        return true;

      case E_CALL: {
        const canCallBeRemoved = e.canBeUnwrappedIfUnused;

        // A call that has been marked "__PURE__" can be removed if all arguments
        // can be removed. The annotation causes us to ignore the target.
        if (canCallBeRemoved) {
          for (let $i17 = 0, $a17 = e.args; $i17 < $a17.length; $i17++) {
            const arg = $a17[$i17];
            if (!ctx.exprCanBeRemovedIfUnused(arg)) {
              return false;
            }
          }
          return true;
        }
        break;
      }

      case E_NEW:
        // A constructor call that has been marked "__PURE__" can be removed if all
        // arguments can be removed. The annotation causes us to ignore the target.
        if (e.canBeUnwrappedIfUnused) {
          for (let $i18 = 0, $a18 = e.args; $i18 < $a18.length; $i18++) {
            const arg = $a18[$i18];
            if (!ctx.exprCanBeRemovedIfUnused(arg)) {
              return false;
            }
          }
          return true;
        }
        break;

      case E_UNARY:
        switch (e.op) {
          // These operators must not have any type conversions that can execute code
          // such as "toString" or "valueOf". They must also never throw any exceptions.
          case UnOpVoid:
          case UnOpNot:
            return ctx.exprCanBeRemovedIfUnused(e.value);

          case UnOpNeg:
            if (e.value.data.k === E_BIG_INT) {
              // Consider negated bigints to have no side effects
              return true;
            }
            break;

          // The "typeof" operator doesn't do any type conversions so it can be removed
          // if the result is unused and the operand has no side effects. However, it
          // has a special case where if the operand is an identifier expression such
          // as "typeof x" and "x" doesn't exist, no reference error is thrown so the
          // operation has no side effects.
          case UnOpTypeof:
            if (e.value.data.k === E_IDENTIFIER && e.wasOriginallyTypeofIdentifier) {
              // Expressions such as "typeof x" never have any side effects
              return true;
            }
            return ctx.exprCanBeRemovedIfUnused(e.value);
        }
        break;

      case E_BINARY:
        switch (e.op) {
          // These operators must not have any type conversions that can execute code
          // such as "toString" or "valueOf". They must also never throw any exceptions.
          case BinOpStrictEq:
          case BinOpStrictNe:
          case BinOpComma:
          case BinOpNullishCoalescing:
            return ctx.exprCanBeRemovedIfUnused(e.left) && ctx.exprCanBeRemovedIfUnused(e.right);

          // Special-case "||" to make sure "typeof x === 'undefined' || x" can be removed
          case BinOpLogicalOr:
            return (
              ctx.exprCanBeRemovedIfUnused(e.left) &&
              (ctx.isSideEffectFreeUnboundIdentifierRef(e.right, e.left, false) || ctx.exprCanBeRemovedIfUnused(e.right))
            );

          // Special-case "&&" to make sure "typeof x !== 'undefined' && x" can be removed
          case BinOpLogicalAnd:
            return (
              ctx.exprCanBeRemovedIfUnused(e.left) &&
              (ctx.isSideEffectFreeUnboundIdentifierRef(e.right, e.left, true) || ctx.exprCanBeRemovedIfUnused(e.right))
            );

          // For "==" and "!=", pretend the operator was actually "===" or "!==". If
          // we know that we can convert it to "==" or "!=", then we can consider the
          // operator itself to have no side effects. This matters because our mangle
          // logic will convert "typeof x === 'object'" into "typeof x == 'object'"
          // and since "typeof x === 'object'" is considered to be side-effect free,
          // we must also consider "typeof x == 'object'" to be side-effect free.
          case BinOpLooseEq:
          case BinOpLooseNe:
            return canChangeStrictToLoose(e.left, e.right) && ctx.exprCanBeRemovedIfUnused(e.left) && ctx.exprCanBeRemovedIfUnused(e.right);

          // Special-case "<" and ">" with string, number, or bigint arguments
          case BinOpLt:
          case BinOpGt:
          case BinOpLe:
          case BinOpGe: {
            const left = knownPrimitiveType(e.left.data);
            switch (left) {
              case PrimitiveString:
              case PrimitiveNumber:
              case PrimitiveBigInt:
                return knownPrimitiveType(e.right.data) === left && ctx.exprCanBeRemovedIfUnused(e.left) && ctx.exprCanBeRemovedIfUnused(e.right);
            }
            break;
          }
        }
        break;

      case E_TEMPLATE:
        // A template can be removed if it has no tag and every value has no side
        // effects and results in some kind of primitive, since all primitives
        // have a "ToString" operation with no side effects.
        if (e.tagOrNil === null || e.canBeUnwrappedIfUnused) {
          for (let $i19 = 0, $a19 = e.parts; $i19 < $a19.length; $i19++) {
            const part = $a19[$i19];
            if (!ctx.exprCanBeRemovedIfUnused(part.value) || knownPrimitiveType(part.value.data) === PrimitiveUnknown) {
              return false;
            }
          }
          return true;
        }
        break;
    }

    // Assume all other expression types have side effects and cannot be removed
    return false;
  },

  isSideEffectFreeUnboundIdentifierRef(value, guardCondition, isYesBranch) {
    const ctx = this;
    if (value === null || guardCondition === null) return false;
    const id = value.data;
    if (id.k === E_IDENTIFIER && ctx.isUnbound(id.ref)) {
      const binary = guardCondition.data;
      if (binary.k === E_BINARY) {
        switch (binary.op) {
          case BinOpStrictEq:
          case BinOpStrictNe:
          case BinOpLooseEq:
          case BinOpLooseNe: {
            // Pattern match for "typeof x !== <string>"
            let typeof_ = binary.left;
            let string = binary.right;
            if (typeof_.data.k === E_STRING) {
              const tmp = typeof_;
              typeof_ = string;
              string = tmp;
            }
            const t = typeof_.data;
            if (t.k === E_UNARY && t.op === UnOpTypeof && t.wasOriginallyTypeofIdentifier) {
              const text = string.data;
              if (text.k === E_STRING) {
                // In "typeof x !== 'undefined' ? x : null", the reference to "x" is side-effect free
                // In "typeof x === 'object' ? x : null", the reference to "x" is side-effect free
                if ((utf16EqualsString(text.value, "undefined") === isYesBranch) === (binary.op === BinOpStrictNe || binary.op === BinOpLooseNe)) {
                  const id2 = t.value.data;
                  if (id2.k === E_IDENTIFIER && id2.ref === id.ref) {
                    return true;
                  }
                }
              }
            }
            break;
          }

          case BinOpLt:
          case BinOpGt:
          case BinOpLe:
          case BinOpGe: {
            // Pattern match for "typeof x < <string>"
            let typeof_ = binary.left;
            let string = binary.right;
            if (typeof_.data.k === E_STRING) {
              const tmp = typeof_;
              typeof_ = string;
              string = tmp;
              isYesBranch = !isYesBranch;
            }
            const t = typeof_.data;
            if (t.k === E_UNARY && t.op === UnOpTypeof && t.wasOriginallyTypeofIdentifier) {
              const text = string.data;
              if (text.k === E_STRING && utf16EqualsString(text.value, "u")) {
                // In "typeof x < 'u' ? x : null", the reference to "x" is side-effect free
                // In "typeof x > 'u' ? x : null", the reference to "x" is side-effect free
                if (isYesBranch === (binary.op === BinOpLt || binary.op === BinOpLe)) {
                  const id2 = t.value.data;
                  if (id2.k === E_IDENTIFIER && id2.ref === id.ref) {
                    return true;
                  }
                }
              }
            }
            break;
          }
        }
      }
    }
    return false;
  },
});

// Returns [number, ok]
export function stringToEquivalentNumberValue(value)                    {
  if (value.length > 0) {
    let intValue = 0; // int32 (wrapping arithmetic)
    let isNegative = false;
    let start = 0;

    if (value.charCodeAt(0) === 45 /* '-' */ && value.length > 1) {
      isNegative = true;
      start++;
    }

    for (let i = start; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c < 48 /* '0' */ || c > 57 /* '9' */) {
        return [0, false];
      }
      intValue = (Math.imul(intValue, 10) + c - 48) | 0;
    }

    if (isNegative) {
      intValue = -intValue | 0;
    }

    if (utf16EqualsString(value, String(intValue))) {
      return [intValue, true];
    }
  }

  return [0, false];
}

// This function intentionally avoids mutating the input AST so it can be
// called after the AST has been frozen (i.e. after parsing ends).
export function inlineSpreadsOfArrayLiterals(values) {
  const results = [];
  for (const value of values) {
    const spread = value.data;
    if (spread.k === E_SPREAD) {
      const array = spread.value.data;
      if (array.k === E_ARRAY) {
        for (let $i20 = 0, $a20 = array.items; $i20 < $a20.length; $i20++) {
          const item = $a20[$i20];
          if (item.data.k === E_MISSING) {
            results.push(new Expr(EUndefinedShared, item.loc));
          } else {
            results.push(item);
          }
        }
        continue;
      }
    }
    results.push(value);
  }
  return results;
}

// This function intentionally avoids mutating the input AST so it can be
// called after the AST has been frozen (i.e. after parsing ends).
export function mangleObjectSpread(properties) {
  const result = [];
  for (const property of properties) {
    if (property.kind === PropertySpread) {
      const v = property.valueOrNil.data;
      switch (v.k) {
        case E_BOOLEAN:
        case E_NULL:
        case E_UNDEFINED:
        case E_NUMBER:
        case E_BIG_INT:
        case E_REG_EXP:
        case E_FUNCTION:
        case E_ARROW:
          // This value is ignored because it doesn't have any of its own properties
          continue;

        case E_OBJECT: {
          for (let i = 0; i < v.properties.length; i++) {
            const p = v.properties[i];
            // Getters are evaluated at iteration time. The property
            // descriptor is not inlined into the caller. Since we are not
            // evaluating code at compile time, just bail if we hit one
            // and preserve the spread with the remaining properties.
            if (p.kind === PropertyGetter || p.kind === PropertySetter) {
              // Don't mutate the original AST
              const clone = new EObject(v.properties.slice(i), v.commaAfterSpread, v.closeBraceLoc, v.isSingleLine, v.isParenthesized);
              const copy = property.clone();
              copy.valueOrNil = new Expr(clone, property.valueOrNil.loc);
              result.push(copy);
              break;
            }

            // Also bail if we hit a verbatim "__proto__" key. This will
            // actually set the prototype of the object being spread so
            // inlining it is not correct.
            if (p.kind === PropertyField && (p.flags & PropertyIsComputed) === 0) {
              const str = p.key.data;
              if (str.k === E_STRING && utf16EqualsString(str.value, "__proto__")) {
                // Don't mutate the original AST
                const clone = new EObject(v.properties.slice(i), v.commaAfterSpread, v.closeBraceLoc, v.isSingleLine, v.isParenthesized);
                const copy = property.clone();
                copy.valueOrNil = new Expr(clone, property.valueOrNil.loc);
                result.push(copy);
                break;
              }
            }

            result.push(p.clone());
          }
          continue;
        }
      }
    }
    result.push(property.clone());
  }
  return result;
}

Object.assign(HelperContext.prototype, {
  // This function intentionally avoids mutating the input AST so it can be
  // called after the AST has been frozen (i.e. after parsing ends).
  mangleIfExpr(loc, e, unsupportedFeatures) {
    const ctx = this;
    let test = e.test;
    let yes = e.yes;
    let no = e.no;

    // "(a, b) ? c : d" => "a, b ? c : d"
    {
      const comma = test.data;
      if (comma.k === E_BINARY && comma.op === BinOpComma) {
        return joinWithComma(comma.left, ctx.mangleIfExpr(comma.right.loc, new EIf(comma.right, yes, no), unsupportedFeatures));
      }
    }

    // "!a ? b : c" => "a ? c : b"
    {
      const not_ = test.data;
      if (not_.k === E_UNARY && not_.op === UnOpNot) {
        test = not_.value;
        const tmp = yes;
        yes = no;
        no = tmp;
      }
    }

    if (valuesLookTheSame(yes.data, no.data)) {
      // "/* @__PURE__ */ a() ? b : b" => "b"
      if (ctx.exprCanBeRemovedIfUnused(test)) {
        return yes;
      }

      // "a ? b : b" => "a, b"
      return joinWithComma(test, yes);
    }

    // "a ? true : false" => "!!a"
    // "a ? false : true" => "!a"
    {
      const y = yes.data;
      if (y.k === E_BOOLEAN) {
        const n = no.data;
        if (n.k === E_BOOLEAN) {
          if (y.value && !n.value) {
            return not(not(test));
          }
          if (!y.value && n.value) {
            return not(test);
          }
        }
      }
    }

    {
      const id = test.data;
      if (id.k === E_IDENTIFIER) {
        // "a ? a : b" => "a || b"
        const id2 = yes.data;
        if (id2.k === E_IDENTIFIER && id.ref === id2.ref) {
          return joinWithLeftAssociativeOp(BinOpLogicalOr, test, no);
        }

        // "a ? b : a" => "a && b"
        const id3 = no.data;
        if (id3.k === E_IDENTIFIER && id.ref === id3.ref) {
          return joinWithLeftAssociativeOp(BinOpLogicalAnd, test, yes);
        }
      }
    }

    // "a ? b ? c : d : d" => "a && b ? c : d"
    {
      const yesIf = yes.data;
      if (yesIf.k === E_IF && valuesLookTheSame(yesIf.no.data, no.data)) {
        return new Expr(new EIf(joinWithLeftAssociativeOp(BinOpLogicalAnd, test, yesIf.test), yesIf.yes, no), loc);
      }
    }

    // "a ? b : c ? b : d" => "a || c ? b : d"
    {
      const noIf = no.data;
      if (noIf.k === E_IF && valuesLookTheSame(yes.data, noIf.yes.data)) {
        return new Expr(new EIf(joinWithLeftAssociativeOp(BinOpLogicalOr, test, noIf.test), yes, noIf.no), loc);
      }
    }

    // "a ? c : (b, c)" => "(a || b), c"
    {
      const comma = no.data;
      if (comma.k === E_BINARY && comma.op === BinOpComma && valuesLookTheSame(yes.data, comma.right.data)) {
        return joinWithComma(joinWithLeftAssociativeOp(BinOpLogicalOr, test, comma.left), comma.right);
      }
    }

    // "a ? (b, c) : c" => "(a && b), c"
    {
      const comma = yes.data;
      if (comma.k === E_BINARY && comma.op === BinOpComma && valuesLookTheSame(comma.right.data, no.data)) {
        return joinWithComma(joinWithLeftAssociativeOp(BinOpLogicalAnd, test, comma.left), comma.right);
      }
    }

    // "a ? b || c : c" => "(a && b) || c"
    {
      const binary = yes.data;
      if (binary.k === E_BINARY && binary.op === BinOpLogicalOr && valuesLookTheSame(binary.right.data, no.data)) {
        return new Expr(new EBinary(joinWithLeftAssociativeOp(BinOpLogicalAnd, test, binary.left), binary.right, BinOpLogicalOr), loc);
      }
    }

    // "a ? c : b && c" => "(a || b) && c"
    {
      const binary = no.data;
      if (binary.k === E_BINARY && binary.op === BinOpLogicalAnd && valuesLookTheSame(yes.data, binary.right.data)) {
        return new Expr(new EBinary(joinWithLeftAssociativeOp(BinOpLogicalOr, test, binary.left), binary.right, BinOpLogicalAnd), loc);
      }
    }

    // "a ? b(c, d) : b(e, d)" => "b(a ? c : e, d)"
    {
      const y = yes.data;
      if (y.k === E_CALL && y.args.length > 0) {
        const n = no.data;
        if (n.k === E_CALL && n.args.length === y.args.length && y.hasSameFlagsAs(n) && valuesLookTheSame(y.target.data, n.target.data)) {
          // Only do this if the condition can be reordered past the call target
          // without side effects. For example, if the test or the call target is
          // an unbound identifier, reordering could potentially mean evaluating
          // the code could throw a different ReferenceError.
          if (ctx.exprCanBeRemovedIfUnused(test) && ctx.exprCanBeRemovedIfUnused(y.target)) {
            let sameTailArgs = true;
            for (let i = 1, count = y.args.length; i < count; i++) {
              if (!valuesLookTheSame(y.args[i].data, n.args[i].data)) {
                sameTailArgs = false;
                break;
              }
            }
            if (sameTailArgs) {
              const yesSpread = y.args[0].data;
              const noSpread = n.args[0].data;
              const yesIsSpread = yesSpread.k === E_SPREAD;
              const noIsSpread = noSpread.k === E_SPREAD;

              // "a ? b(...c) : b(...e)" => "b(...a ? c : e)"
              if (yesIsSpread && noIsSpread) {
                // Don't mutate the original AST
                const temp = new EIf(test, yesSpread.value, noSpread.value);
                const clone = new ECall(y.target, y.args.slice(), y.closeParenLoc, y.optionalChain, y.kind, y.isMultiLine, y.canBeUnwrappedIfUnused);
                clone.args[0] = new Expr(new ESpread(ctx.mangleIfExpr(loc, temp, unsupportedFeatures)), loc);
                return new Expr(clone, loc);
              }

              // "a ? b(c) : b(e)" => "b(a ? c : e)"
              if (!yesIsSpread && !noIsSpread) {
                // Don't mutate the original AST
                const temp = new EIf(test, y.args[0], n.args[0]);
                const clone = new ECall(y.target, y.args.slice(), y.closeParenLoc, y.optionalChain, y.kind, y.isMultiLine, y.canBeUnwrappedIfUnused);
                clone.args[0] = ctx.mangleIfExpr(loc, temp, unsupportedFeatures);
                return new Expr(clone, loc);
              }
            }
          }
        }
      }
    }

    // Try using the "??" or "?." operators
    {
      const binary = test.data;
      if (binary.k === E_BINARY) {
        let check = null;
        let whenNull = null;
        let whenNonNull = null;

        switch (binary.op) {
          case BinOpLooseEq:
            if (binary.right.data.k === E_NULL) {
              // "a == null ? _ : _"
              check = binary.left;
              whenNull = yes;
              whenNonNull = no;
            } else if (binary.left.data.k === E_NULL) {
              // "null == a ? _ : _"
              check = binary.right;
              whenNull = yes;
              whenNonNull = no;
            }
            break;

          case BinOpLooseNe:
            if (binary.right.data.k === E_NULL) {
              // "a != null ? _ : _"
              check = binary.left;
              whenNonNull = yes;
              whenNull = no;
            } else if (binary.left.data.k === E_NULL) {
              // "null != a ? _ : _"
              check = binary.right;
              whenNonNull = yes;
              whenNull = no;
            }
            break;
        }

        if (ctx.exprCanBeRemovedIfUnused(check)) {
          // "a != null ? a : b" => "a ?? b"
          if (!jsFeatureHas(unsupportedFeatures, NullishCoalescing) && valuesLookTheSame(check.data, whenNonNull.data)) {
            return joinWithLeftAssociativeOp(BinOpNullishCoalescing, check, whenNull);
          }

          // "a != null ? a.b.c[d](e) : undefined" => "a?.b.c[d](e)"
          if (!jsFeatureHas(unsupportedFeatures, OptionalChain)) {
            if (whenNull.data.k === E_UNDEFINED && tryToInsertOptionalChain(check, whenNonNull)) {
              return whenNonNull;
            }
          }
        }
      }
    }

    // Don't mutate the original AST
    if (!exprIdentical(test, e.test) || !exprIdentical(yes, e.yes) || !exprIdentical(no, e.no)) {
      return new Expr(new EIf(test, yes, no), loc);
    }

    return new Expr(e, loc);
  },
});

// "callback" is a function (loc, b: BIdentifier) => void
export function forEachIdentifierBindingInDecls(decls, callback) {
  for (const decl of decls) {
    forEachIdentifierBinding(decl.binding, callback);
  }
}

export function forEachIdentifierBinding(binding, callback) {
  const b = binding.data;
  switch (b.k) {
    case B_MISSING:
      break;

    case B_IDENTIFIER:
      callback(binding.loc, b);
      break;

    case B_ARRAY:
      for (let $i21 = 0, $a21 = b.items; $i21 < $a21.length; $i21++) {
        const item = $a21[$i21];
        forEachIdentifierBinding(item.binding, callback);
      }
      break;

    case B_OBJECT:
      for (let $i22 = 0, $a22 = b.properties; $i22 < $a22.length; $i22++) {
        const property = $a22[$i22];
        forEachIdentifierBinding(property.value, callback);
      }
      break;

    default:
      throw new GoPanic("Internal error");
  }
}
// generated from js_ast_helpers.mts by tools/ts-build.mjs; edit that file
