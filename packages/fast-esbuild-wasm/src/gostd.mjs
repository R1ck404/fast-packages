// Go standard library behaviour the CSS port depends on, where the obvious
// JavaScript equivalent differs: strconv float parsing and fixed-precision
// formatting, strings.ToLower / strings.EqualFold for non-ASCII text, and
// the "math" functions used by helpers.F64 (ported from Go's pure-Go
// implementations, which is what esbuild-wasm runs: JavaScript's Math.sin,
// Math.pow, ... may differ from them in the last bit).
//
// helpers.F64 itself needs no wrapper: it only prevents fused multiply-add,
// which JavaScript never does, so F64 arithmetic is plain number arithmetic.

import { goStringsToLower, goStringsEqualFold } from "./gostrings.mjs";
import { unicodeIsPrint } from "./goregexp.mjs";

// ---------------------------------------------------------------------------
// Conversions of float64 to integer types. esbuild-wasm's Go (GOARCH=wasm)
// compiles every one of them to a saturating i64.trunc_sat_f64_s (or _u for
// unsigned types): NaN becomes 0, values beyond the int64 range saturate,
// and narrower types keep the low bits of that int64.

// int(x) / int64(x), as a number (whole; MaxInt64 is held as 2^63 like
// float64(MaxInt64))
export function goIntFromFloat(x        )         {
  if (x !== x) return 0;
  if (x >= 9223372036854775807) return 9223372036854775808;
  if (x <= -9223372036854775808) return -9223372036854775808;
  return Math.trunc(x);
}

// The low 32 bits of the int64 conversion, as an unsigned number
function low32OfInt64(x        )         {
  if (x !== x) return 0;
  if (x >= 9223372036854775807) return 0xffffffff; // (MaxInt64)
  if (x <= -9223372036854775808) return 0; // (MinInt64)
  const t = Math.trunc(x);
  // (whole numbers: the remainder is exact)
  let r = t % 4294967296;
  if (r < 0) r += 4294967296;
  return r;
}

// int32(x)
export function goInt32FromFloat(x        )         {
  return low32OfInt64(x) | 0;
}

// uint32(x): the low 32 bits of the saturating uint64 conversion
export function goUint32FromFloat(x        )         {
  if (x !== x || x <= 0) return 0;
  if (x >= 18446744073709551615) return 0xffffffff; // (MaxUint64)
  const t = Math.trunc(x);
  return t % 4294967296;
}

// ---------------------------------------------------------------------------
// strconv

const decimalFloatRegex = /^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

// strconv.ParseFloat(text, 64). Returns [value, ok] where ok is Go's
// "err == nil" (a syntax error gives [0, false]; a value out of range gives
// [+-Inf, false]).
export function strconvParseFloat(text        )                    {
  if (decimalFloatRegex.test(text)) {
    const f = Number(text);
    // Go reports a range error for values that round to infinity
    if (f === Infinity || f === -Infinity) return [f, false];
    return [f, true];
  }

  // special(): "inf", "infinity" (with an optional sign) and "nan"
  {
    let s = text;
    let sign = 1;
    if (s.length > 0 && (s[0] === "+" || s[0] === "-")) {
      if (s[0] === "-") sign = -1;
      s = s.slice(1);
      const lower = s.toLowerCase();
      if (lower === "inf" || lower === "infinity") return [sign * Infinity, true];
    } else {
      const lower = s.toLowerCase();
      if (lower === "inf" || lower === "infinity") return [Infinity, true];
      if (lower === "nan") return [NaN, true];
    }
  }

  // readFloat: hexadecimal mantissas ("0x1.8p3") and underscores between
  // digits ("1_000")
  const r = readFloat(text);
  if (r === null || r.n !== text.length) return [0, false];
  if (r.hex) return atofHex(r.mantissa, r.exp, r.neg, r.trunc);
  // (a decimal number with underscores: the same number without them)
  const f = Number(text.slice(0, r.n).replaceAll("_", ""));
  if (f === Infinity || f === -Infinity) return [f, false];
  return [f, true];
}

function lowerByte(c        )         {
  return c >= "A" && c <= "Z" ? String.fromCharCode(c.charCodeAt(0) + 32) : c;
}

// strconv's underscoreOK
function underscoreOK(s        )          {
  // saw tracks the last character (class) we saw:
  // ^ for beginning of number,
  // 0 for a digit or base prefix,
  // _ for an underscore,
  // ! for none of the above.
  let saw = "^";
  let i = 0;

  // Optional sign.
  if (s.length >= 1 && (s[0] === "-" || s[0] === "+")) {
    s = s.slice(1);
  }

  // Optional base prefix.
  let hex = false;
  if (s.length >= 2 && s[0] === "0" && (lowerByte(s[1]) === "b" || lowerByte(s[1]) === "o" || lowerByte(s[1]) === "x")) {
    i = 2;
    saw = "0"; // base prefix counts as a digit for "underscore as digit separator"
    hex = lowerByte(s[1]) === "x";
  }

  // Number proper.
  for (; i < s.length; i++) {
    // Digits are always okay.
    if (("0" <= s[i] && s[i] <= "9") || (hex && "a" <= lowerByte(s[i]) && lowerByte(s[i]) <= "f")) {
      saw = "0";
      continue;
    }
    // Underscore must follow digit.
    if (s[i] === "_") {
      if (saw !== "0") {
        return false;
      }
      saw = "_";
      continue;
    }
    // Underscore must also be followed by digit.
    if (saw === "_") {
      return false;
    }
    // Saw non-digit, non-underscore.
    saw = "!";
  }
  return saw !== "_";
}

// strconv's readFloat (the mantissa as a BigInt: Go's uint64): null when
// Go's "ok" is false
function readFloat(s        )                                                                                                  {
  let underscores = false;
  let i = 0;
  let neg = false;
  let trunc = false;
  let hex = false;
  let mantissa = BigInt(0);

  // optional sign
  if (i >= s.length) {
    return null;
  }
  switch (s[i]) {
    case "+":
      i++;
      break;
    case "-":
      i++;
      neg = true;
      break;
  }

  // digits
  let base = 10;
  let maxMantDigits = 19; // 10^19 fits in uint64
  let expChar = "e";
  if (i + 2 < s.length && s[i] === "0" && lowerByte(s[i + 1]) === "x") {
    base = 16;
    maxMantDigits = 16; // 16^16 fits in uint64
    i += 2;
    expChar = "p";
    hex = true;
  }
  const bigBase = BigInt(base);
  let sawdot = false;
  let sawdigits = false;
  let nd = 0;
  let ndMant = 0;
  let dp = 0;
  loop: for (; i < s.length; i++) {
    const c = s[i];
    if (c === "_") {
      underscores = true;
      continue;
    } else if (c === ".") {
      if (sawdot) {
        break loop;
      }
      sawdot = true;
      dp = nd;
      continue;
    } else if ("0" <= c && c <= "9") {
      sawdigits = true;
      if (c === "0" && nd === 0) {
        // ignore leading zeros
        dp--;
        continue;
      }
      nd++;
      if (ndMant < maxMantDigits) {
        mantissa = mantissa * bigBase + BigInt(c.charCodeAt(0) - 48);
        ndMant++;
      } else if (c !== "0") {
        trunc = true;
      }
      continue;
    } else if (base === 16 && "a" <= lowerByte(c) && lowerByte(c) <= "f") {
      sawdigits = true;
      nd++;
      if (ndMant < maxMantDigits) {
        mantissa = mantissa * BigInt(16) + BigInt(lowerByte(c).charCodeAt(0) - 97 + 10);
        ndMant++;
      } else {
        trunc = true;
      }
      continue;
    }
    break;
  }
  if (!sawdigits) {
    return null;
  }
  if (!sawdot) {
    dp = nd;
  }

  if (base === 16) {
    dp *= 4;
    ndMant *= 4;
  }

  // optional exponent moves decimal point.
  if (i < s.length && lowerByte(s[i]) === expChar) {
    i++;
    if (i >= s.length) {
      return null;
    }
    let esign = 1;
    switch (s[i]) {
      case "+":
        i++;
        break;
      case "-":
        i++;
        esign = -1;
        break;
    }
    if (i >= s.length || s[i] < "0" || s[i] > "9") {
      return null;
    }
    let e = 0;
    for (; i < s.length && (("0" <= s[i] && s[i] <= "9") || s[i] === "_"); i++) {
      if (s[i] === "_") {
        underscores = true;
        continue;
      }
      if (e < 10000) {
        e = e * 10 + s.charCodeAt(i) - 48;
      }
    }
    dp += e * esign;
  } else if (base === 16) {
    // Must have exponent.
    return null;
  }

  let exp = 0;
  if (mantissa !== BigInt(0)) {
    exp = dp - ndMant;
  }

  if (underscores && !underscoreOK(s.slice(0, i))) {
    return null;
  }

  return { mantissa, exp, neg, trunc, hex, n: i };
}

// strconv's atofHex for float64 (mantbits 52, expbits 11, bias -1023)
function atofHex(mantissa        , exp        , neg         , trunc         )                    {
  const mantbits = BigInt(52);
  const bias = -1023;
  const maxExp = (1 << 11) + bias - 2;
  const minExp = bias + 1;
  const one = BigInt(1);
  const zero = BigInt(0);
  exp += 52; // mantissa now implicitly divided by 2^mantbits.

  // Shift mantissa and exponent to bring representation into float range.
  // Eventually we want a mantissa with a leading 1-bit followed by mantbits other bits.
  // For rounding, we need two more, where the bottom bit represents
  // whether that bit or any later bit was non-zero.
  // (If the mantissa has already lost non-zero bits, trunc is true,
  // and we OR in a 1 below after shifting left appropriately.)
  while (mantissa !== zero && mantissa >> (mantbits + BigInt(2)) === zero) {
    mantissa <<= one;
    exp--;
  }
  if (trunc) {
    mantissa |= one;
  }
  while (mantissa >> (one + mantbits + BigInt(2)) !== zero) {
    mantissa = (mantissa >> one) | (mantissa & one);
    exp++;
  }

  // If exponent is too negative,
  // denormalize in hopes of making it representable.
  // (The -2 is for the rounding bits.)
  while (mantissa > one && exp < minExp - 2) {
    mantissa = (mantissa >> one) | (mantissa & one);
    exp++;
  }

  // Round using two bottom bits.
  let round = mantissa & BigInt(3);
  mantissa >>= BigInt(2);
  round |= mantissa & one; // round to even (round up if mantissa is odd)
  exp += 2;
  if (round === BigInt(3)) {
    mantissa++;
    if (mantissa === one << (one + mantbits)) {
      mantissa >>= one;
      exp++;
    }
  }

  if (mantissa >> mantbits === zero) {
    // Denormal or zero.
    exp = bias;
  }
  let ok = true;
  if (exp > maxExp) {
    // infinity and range error
    mantissa = one << mantbits;
    exp = maxExp + 1;
    ok = false;
  }

  let bits = mantissa & ((one << mantbits) - one);
  bits |= BigInt((exp - bias) & ((1 << 11) - 1)) << mantbits;
  if (neg) {
    bits |= one << BigInt(63);
  }
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, bits);
  return [view.getFloat64(0), ok];
}

// strconv.FormatFloat(x, 'f', prec, 64) and fmt.Sprintf("%.<prec>f", x):
// the exact binary value rounded half to even. (Number.prototype.toFixed
// rounds exact ties up and drops the sign of -0.)
export function formatFloatFixed(x        , prec        )         {
  if (x !== x) return "NaN";
  if (x === Infinity) return "+Inf";
  if (x === -Infinity) return "-Inf";
  const neg = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  let digits        ;
  if (ax >= 1e21) {
    // Integers: the exact value
    digits = BigInt(ax).toString() + (prec > 0 ? "." + "0".repeat(prec) : "");
  } else {
    // ax = m * 2^e exactly
    const [m, e] = float64MantissaExponent(ax);
    let q        ;
    if (e >= 0) {
      q = (m << BigInt(e)) * 10n ** BigInt(prec);
    } else {
      const scaled = m * 10n ** BigInt(prec);
      const shift = BigInt(-e);
      q = scaled >> shift;
      const r = scaled - (q << shift);
      const half = 1n << (shift - 1n);
      if (r > half || (r === half && (q & 1n) === 1n)) q++;
    }
    let s = q.toString();
    if (prec > 0) {
      if (s.length <= prec) s = "0".repeat(prec - s.length + 1) + s;
      s = s.slice(0, s.length - prec) + "." + s.slice(s.length - prec);
    }
    digits = s;
  }
  return neg ? "-" + digits : digits;
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const LO = littleEndian ? 0 : 1;
const HI = littleEndian ? 1 : 0;

// Returns [m, e] with x = m * 2^e for a finite x >= 0
function float64MantissaExponent(x        )                   {
  f64[0] = x;
  const hi = u32[HI];
  const lo = u32[LO];
  const exp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp === 0) return [m, -1074];
  m |= 1n << 52n;
  return [m, exp - 1075];
}

// ---------------------------------------------------------------------------
// strings

function isASCII(s        )          {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 0x80) return false;
  return true;
}

// strings.ToLower and strings.EqualFold (gostrings.mts)
export function goToLower(s        )         {
  return goStringsToLower(s);
}
export function goEqualFold(s        , t        )          {
  return goStringsEqualFold(s, t);
}

// ---------------------------------------------------------------------------
// math (Go's pure-Go implementations)

const Pi = Math.PI;
const Sqrt2 = Math.SQRT2;
const Ln2 = Math.LN2;
const MaxFloat64 = Number.MAX_VALUE;

function isInf(f        , sign        )          {
  return (sign >= 0 && f > MaxFloat64) || (sign <= 0 && f < -MaxFloat64);
}

export function goSignbit(x        )          {
  return x < 0 || Object.is(x, -0);
}

export function goCopysign(f        , sign        )         {
  const a = Math.abs(f);
  return goSignbit(sign) ? -a : a;
}

// math.Round: half away from zero
export function goRound(x        )         {
  if (x !== x || x === Infinity || x === -Infinity) return x;
  const t = Math.trunc(x);
  if (Math.abs(x - t) >= 0.5) return t + (x < 0 ? -1 : 1);
  return t;
}

function normalize(x        )                   {
  const SmallestNormal = 2.2250738585072014e-308; // 2**-1022
  if (Math.abs(x) < SmallestNormal) {
    return [x * 4503599627370496 /* 1 << 52 */, -52];
  }
  return [x, 0];
}

export function goFrexp(f        )                   {
  // special cases
  if (f === 0) return [f, 0]; // correctly return -0
  if (isInf(f, 0) || f !== f) return [f, 0];
  const n = normalize(f);
  f = n[0];
  let exp = n[1];
  f64[0] = f;
  const hi = u32[HI];
  exp += ((hi >>> 20) & 0x7ff) - 1023 + 1;
  u32[HI] = (hi & ~(0x7ff << 20)) | ((-1 + 1023) << 20);
  return [f64[0], exp];
}

export function goLdexp(frac        , exp        )         {
  // special cases
  if (frac === 0) return frac; // correctly return -0
  if (isInf(frac, 0) || frac !== frac) return frac;
  const n = normalize(frac);
  frac = n[0];
  exp += n[1];
  f64[0] = frac;
  const hi = u32[HI];
  exp += ((hi >>> 20) & 0x7ff) - 1023;
  if (exp < -1075) {
    return goCopysign(0, frac); // underflow
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
  f64[0] = frac;
  u32[HI] = (u32[HI] & ~(0x7ff << 20)) | ((exp + 1023) << 20);
  return m * f64[0];
}

export function goModf(f        )                   {
  if (f < 1) {
    if (f < 0) {
      const r = goModf(-f);
      return [-r[0], -r[1]];
    }
    if (f === 0) return [f, f]; // Return -0, -0 when f == -0
    return [0, f];
  }
  // (Keep the integer part: Math.trunc is exact)
  const int = Math.trunc(f);
  return [int, f - int];
}

export function goExp(x        )         {
  const Ln2Hi = 6.9314718036912381649e-1;
  const Ln2Lo = 1.90821492927058770002e-10;
  const Log2e = 1.442695040888963387;
  const Overflow = 7.09782712893383973096e2;
  const Underflow = -7.4513321910194110842e2;
  const NearZero = 1.0 / (1 << 28); // 2**-28

  // special cases
  if (x !== x || isInf(x, 1)) return x;
  if (isInf(x, -1)) return 0;
  if (x > Overflow) return Infinity;
  if (x < Underflow) return 0;
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

function expmulti(hi        , lo        , k        )         {
  const P1 = 1.66666666666666657415e-1;
  const P2 = -2.77777777770155933842e-3;
  const P3 = 6.61375632143793436117e-5;
  const P4 = -1.6533902205465251539e-6;
  const P5 = 4.13813679705723846039e-8;

  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  return goLdexp(y, k);
}

export function goLog(x        )         {
  const Ln2Hi = 6.9314718036912381649e-1;
  const Ln2Lo = 1.90821492927058770002e-10;
  const L1 = 6.66666666666673513e-1;
  const L2 = 3.999999999940941908e-1;
  const L3 = 2.857142874366239149e-1;
  const L4 = 2.222219843214978396e-1;
  const L5 = 1.818357216161805012e-1;
  const L6 = 1.531383769920937332e-1;
  const L7 = 1.479819860511658591e-1;

  // special cases
  if (x !== x || isInf(x, 1)) return x;
  if (x < 0) return NaN;
  if (x === 0) return -Infinity;

  // reduce
  const fr = goFrexp(x);
  let f1 = fr[0];
  let ki = fr[1];
  if (f1 < Sqrt2 / 2) {
    f1 *= 2;
    ki--;
  }
  const f = f1 - 1;
  const k = ki;

  // compute
  const s = f / (2 + f);
  const s2 = s * s;
  const s4 = s2 * s2;
  const t1 = s2 * (L1 + s4 * (L3 + s4 * (L5 + s4 * L7)));
  const t2 = s4 * (L2 + s4 * (L4 + s4 * L6));
  const R = t1 + t2;
  const hfsq = 0.5 * f * f;
  return k * Ln2Hi - (hfsq - (s * (hfsq + R) + k * Ln2Lo) - f);
}

export function goLog2(x        )         {
  const fr = goFrexp(x);
  const frac = fr[0];
  const exp = fr[1];
  // Make sure exact powers of two give an exact answer.
  // Don't depend on Log(0.5)*(1/Ln2)+exp being exactly exp-1.
  if (frac === 0.5) {
    return exp - 1;
  }
  return goLog(frac) * (1 / Ln2) + exp;
}

function isOddInt(x        )          {
  if (Math.abs(x) >= 9007199254740992 /* 1 << 53 */) {
    return false;
  }
  const m = goModf(x);
  return m[1] === 0 && Math.abs(m[0] % 2) === 1;
}

export function goPow(x        , y        )         {
  if (y === 0 || x === 1) return 1;
  if (y === 1) return x;
  if (x !== x || y !== y) return NaN;
  if (x === 0) {
    if (y < 0) {
      if (goSignbit(x) && isOddInt(y)) return -Infinity;
      return Infinity;
    } else if (y > 0) {
      if (goSignbit(x) && isOddInt(y)) return x;
      return 0;
    }
  }
  if (isInf(y, 0)) {
    if (x === -1) return 1;
    if ((Math.abs(x) < 1) === isInf(y, 1)) return 0;
    return Infinity;
  }
  if (isInf(x, 0)) {
    if (isInf(x, -1)) return goPow(1 / x, -y); // Pow(-0, -y)
    if (y < 0) return 0;
    if (y > 0) return Infinity;
  }
  if (y === 0.5) return Math.sqrt(x);
  if (y === -0.5) return 1 / Math.sqrt(x);

  const m = goModf(Math.abs(y));
  let yi = m[0];
  let yf = m[1];
  if (yf !== 0 && x < 0) return NaN;
  if (yi >= 9223372036854775808 /* 1 << 63 */) {
    // yi is a large even int that will lead to overflow (or underflow to 0)
    // for all x except -1 (x == 1 was handled earlier)
    if (x === -1) return 1;
    if ((Math.abs(x) < 1) === y > 0) return 0;
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
    a1 = goExp(yf * goLog(x));
  }

  // ans *= x**yi
  // by multiplying in successive squarings
  // of x according to bits of yi.
  // accumulate powers of two into exp.
  const fr = goFrexp(x);
  let x1 = fr[0];
  let xe = fr[1];
  // (int64(yi): exact below 2^63; BigInt keeps the bit operations exact)
  for (let i = BigInt(yi); i !== 0n; i >>= 1n) {
    if (xe < -(1 << 12) || 1 << 12 < xe) {
      // catch xe before it overflows the left shift below
      ae += xe;
      break;
    }
    if ((i & 1n) === 1n) {
      a1 *= x1;
      ae += xe;
    }
    x1 *= x1;
    xe <<= 1;
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
  return goLdexp(a1, ae);
}

export function goCbrt(x        )         {
  const B1 = 715094163n; // (682-0.03306235651)*2**20
  const B2 = 696219795n; // (664-0.03306235651)*2**20
  const C = 5.42857142857142815906e-1; // 19/35     = 0x3FE15F15F15F15F1
  const D = -7.0530612244897961105e-1; // -864/1225 = 0xBFE691DE2532C834
  const E = 1.41428571428571436819; // 99/70     = 0x3FF6A0EA0EA0EA0F
  const F = 1.6071428571428572063; // 45/28     = 0x3FF9B6DB6DB6DB6E
  const G = 3.57142857142857150787e-1; // 5/14      = 0x3FD6DB6DB6DB6DB7
  const SmallestNormal = 2.22507385850720138309e-308; // 2**-1022  = 0x0010000000000000

  // special cases
  if (x === 0 || x !== x || isInf(x, 0)) return x;

  let sign = false;
  if (x < 0) {
    x = -x;
    sign = true;
  }

  // rough cbrt to 5 bits
  let t = float64frombits(float64bits(x) / 3n + (B1 << 32n));
  if (x < SmallestNormal) {
    // subnormal number
    t = 18014398509481984; // 1 << 54
    t *= x;
    t = float64frombits(float64bits(t) / 3n + (B2 << 32n));
  }

  // new cbrt to 23 bits
  let r = (t * t) / x;
  let s = C + r * t;
  t *= G + F / (s + E + D / s);

  // chop to 22 bits, make larger than cbrt(x)
  t = float64frombits((float64bits(t) & (0xffffffffcn << 28n)) + (1n << 30n));

  // one step newton iteration to 53 bits with error less than 0.667ulps
  s = t * t; // t*t is exact
  r = x / s;
  const w = t + t;
  r = (r - t) / (w + r); // r-s is exact
  t = t + t * r;

  // restore the sign bit
  if (sign) {
    t = -t;
  }
  return t;
}

const f64b = new Float64Array(1);
const u64b = new BigUint64Array(f64b.buffer);
function float64bits(x        )         {
  f64b[0] = x;
  return u64b[0];
}
function float64frombits(b        )         {
  u64b[0] = BigInt.asUintN(64, b);
  return f64b[0];
}

function xatan(x        )         {
  const P0 = -8.750608600031904122785e-1;
  const P1 = -1.615753718733365076637e1;
  const P2 = -7.50085579231470466734e1;
  const P3 = -1.22886668449013617341e2;
  const P4 = -6.485021904942025371773e1;
  const Q0 = +2.485846490142306297962e1;
  const Q1 = +1.650270098316988542046e2;
  const Q2 = +4.328810604912902668951e2;
  const Q3 = +4.853903996359136964868e2;
  const Q4 = +1.945506571482613964425e2;
  let z = x * x;
  z = (z * ((((P0 * z + P1) * z + P2) * z + P3) * z + P4)) / (((((z + Q0) * z + Q1) * z + Q2) * z + Q3) * z + Q4);
  z = x * z + x;
  return z;
}

function satan(x        )         {
  const Morebits = 6.12323399573676588613e-17; // pi/2 = PIO2 + Morebits
  const Tan3pio8 = 2.4142135623730950488; // tan(3*pi/8)
  if (x <= 0.66) {
    return xatan(x);
  }
  if (x > Tan3pio8) {
    return Pi / 2 - xatan(1 / x) + Morebits;
  }
  return Pi / 4 + xatan((x - 1) / (x + 1)) + 0.5 * Morebits;
}

function goAtan(x        )         {
  if (x === 0) {
    return x;
  }
  if (x > 0) {
    return satan(x);
  }
  return -satan(-x);
}

export function goAtan2(y        , x        )         {
  // special cases
  if (y !== y || x !== x) return NaN;
  if (y === 0) {
    if (x >= 0 && !goSignbit(x)) return goCopysign(0, y);
    return goCopysign(Pi, y);
  }
  if (x === 0) return goCopysign(Pi / 2, y);
  if (isInf(x, 0)) {
    if (isInf(x, 1)) {
      if (isInf(y, 0)) return goCopysign(Pi / 4, y);
      return goCopysign(0, y);
    }
    if (isInf(y, 0)) return goCopysign((3 * Pi) / 4, y); // (the constant 3*Pi/4 rounds like this)
    return goCopysign(Pi, y);
  }
  if (isInf(y, 0)) return goCopysign(Pi / 2, y);

  // Call atan and determine the quadrant.
  const q = goAtan(y / x);
  if (x < 0) {
    if (q <= 0) {
      return q + Pi;
    }
    return q - Pi;
  }
  return q;
}

const _sin = [
  1.5896230157654656806e-10, // 0x3de5d8fd1fd19ccd
  -2.50507477628578072866e-8, // 0xbe5ae5e5a9291f5d
  2.75573136213857245213e-6, // 0x3ec71de3567d48a1
  -1.98412698295895385996e-4, // 0xbf2a01a019bfdf03
  8.33333333332211858878e-3, // 0x3f8111111110f7d0
  -1.66666666666666307295e-1, // 0xbfc5555555555548
];

const _cos = [
  -1.135853652138768173e-11, // 0xbda8fa49a0861a9b
  2.08757008419747316778e-9, // 0x3e21ee9d7b4e3f05
  -2.75573141792967388112e-7, // 0xbe927e4f7eac4bc6
  2.48015872888517045348e-5, // 0x3efa01a019c844f5
  -1.38888888888730564116e-3, // 0xbf56c16c16c14f91
  4.16666666666665929218e-2, // 0x3fa555555555554b
];

const PI4A = 7.85398125648498535156e-1; // 0x3fe921fb40000000, Pi/4 split into three parts
const PI4B = 3.77489470793079817668e-8; // 0x3e64442d00000000,
const PI4C = 2.69515142907905952645e-15; // 0x3ce8469898cc5170,
const reduceThreshold = 1 << 29;

// math/trig_reduce.go trigReduce: Payne-Hanek range reduction by Pi/4 for
// x > 0 (64-bit integer arithmetic with BigInt). Returns [j, z]: the integer
// part mod 8 and the fractional part of x / (Pi/4).
const mPi4 = [
  "0000000000000001", "45f306dc9c882a53", "f84eafa3ea69bb81", "b6c52b3278872083", "fca2c757bd778ac3",
  "6e48dc74849ba5c0", "0c925dd413a32439", "fc3bd63962534e7d", "d1046bea5d768909", "d338e04d68befc82",
  "7323ac7306a673e9", "3908bf177bf25076", "3ff12fffbc0b301f", "de5e2316b414da3e", "da6cfd9e4f96136e",
  "9e8c7ecd3cbfd45a", "ea4f758fd7cbe2f6", "7a0e73ef14a525d4", "d7f6bf623f1aba10", "ac06608df8f6d757",
].map((h) => BigInt("0x" + h));
function trigReduce(x        )                   {
  const PI4 = Pi / 4;
  if (x < PI4) {
    return [0, x];
  }
  const M64 = (BigInt(1) << BigInt(64)) - BigInt(1);
  const view = new DataView(new ArrayBuffer(8));
  // Extract out the integer and exponent such that,
  // x = ix * 2 ** exp.
  view.setFloat64(0, x);
  let ix = view.getBigUint64(0);
  const exp = Number((ix >> BigInt(52)) & BigInt(0x7ff)) - 1023 - 52;
  ix &= ~(BigInt(0x7ff) << BigInt(52)) & M64;
  ix |= BigInt(1) << BigInt(52);
  // Use the exponent to extract the 3 appropriate uint64 digits from mPi4,
  // B ~ (z0, z1, z2), such that the product leading digit has the exponent -61.
  // Note, exp >= -53 since x >= PI4 and exp < 971 for maximum float64.
  const digit = Math.floor((exp + 61) / 64);
  const bitshift = BigInt((exp + 61) % 64);
  // (Go's shift of a uint64 by 64 or more gives 0)
  const shr = (v        , n        ) => (n >= BigInt(64) ? BigInt(0) : v >> n);
  const z0 = ((mPi4[digit] << bitshift) & M64) | shr(mPi4[digit + 1], BigInt(64) - bitshift);
  const z1 = ((mPi4[digit + 1] << bitshift) & M64) | shr(mPi4[digit + 2], BigInt(64) - bitshift);
  const z2 = ((mPi4[digit + 2] << bitshift) & M64) | shr(mPi4[digit + 3], BigInt(64) - bitshift);
  // Multiply mantissa by the digits and extract the upper two digits (hi, lo).
  const z2hi = (z2 * ix) >> BigInt(64);
  const z1prod = z1 * ix;
  const z1hi = z1prod >> BigInt(64);
  const z1lo = z1prod & M64;
  const z0lo = (z0 * ix) & M64;
  const loSum = z1lo + z2hi;
  const lo = loSum & M64;
  const c = loSum >> BigInt(64);
  let hi = (z0lo + z1hi + c) & M64;
  // The top 3 bits are j.
  let j = Number(hi >> BigInt(61));
  // Extract the fraction and find its magnitude.
  hi = ((hi << BigInt(3)) & M64) | (lo >> BigInt(61));
  let lz = 0;
  while (lz < 64 && ((hi >> BigInt(63 - lz)) & BigInt(1)) === BigInt(0)) lz++;
  const e = BigInt.asUintN(64, BigInt(1023 - (lz + 1)));
  // Clear implicit mantissa bit and shift into place.
  // (a shift count of 64 or more gives 0, like the negative count 64 - 65 does
  // as a uint in Go)
  hi = ((hi << BigInt(lz + 1)) & M64) | (lz + 1 > 64 ? BigInt(0) : shr(lo, BigInt(64 - (lz + 1))));
  hi >>= BigInt(64 - 52);
  // Include the exponent and convert to a float.
  hi = (hi | (e << BigInt(52))) & M64;
  view.setBigUint64(0, hi);
  let z = view.getFloat64(0);
  // Map zeros to origin.
  if ((j & 1) === 1) {
    j++;
    j &= 7;
    z--;
  }
  // Multiply the fractional part by pi/4.
  return [j, z * PI4];
}

export function goCos(x        )         {
  // special cases
  if (x !== x || isInf(x, 0)) return NaN;

  // make argument positive
  let sign = false;
  x = Math.abs(x);

  let j        ;
  let y        ;
  let z        ;
  if (x >= reduceThreshold) {
    [j, z] = trigReduce(x);
  } else {
    j = Math.trunc(x * (4 / Pi)); // integer part of x/(Pi/4), as integer for tests on the phase angle
    y = j; // integer part of x/(Pi/4), as float

    // map zeros to origin
    if ((j & 1) === 1) {
      j++;
      y++;
    }
    j &= 7; // octant modulo 2Pi radians (360 degrees)
    z = x - y * PI4A - y * PI4B - y * PI4C; // Extended precision modular arithmetic
  }

  if (j > 3) {
    j -= 4;
    sign = !sign;
  }
  if (j > 1) {
    sign = !sign;
  }

  const zz = z * z;
  if (j === 1 || j === 2) {
    y = z + z * zz * (((((_sin[0] * zz + _sin[1]) * zz + _sin[2]) * zz + _sin[3]) * zz + _sin[4]) * zz + _sin[5]);
  } else {
    y = 1.0 - 0.5 * zz + zz * zz * (((((_cos[0] * zz + _cos[1]) * zz + _cos[2]) * zz + _cos[3]) * zz + _cos[4]) * zz + _cos[5]);
  }
  if (sign) {
    y = -y;
  }
  return y;
}

export function goSin(x        )         {
  // special cases
  if (x === 0 || x !== x) return x; // return +-0 || NaN()
  if (isInf(x, 0)) return NaN;

  // make argument positive but save the sign
  let sign = false;
  if (x < 0) {
    x = -x;
    sign = true;
  }

  let j        ;
  let y        ;
  let z        ;
  if (x >= reduceThreshold) {
    [j, z] = trigReduce(x);
  } else {
    j = Math.trunc(x * (4 / Pi)); // integer part of x/(Pi/4), as integer for tests on the phase angle
    y = j; // integer part of x/(Pi/4), as float

    // map zeros to origin
    if ((j & 1) === 1) {
      j++;
      y++;
    }
    j &= 7; // octant modulo 2Pi radians (360 degrees)
    z = x - y * PI4A - y * PI4B - y * PI4C; // Extended precision modular arithmetic
  }

  // reflect in x axis
  if (j > 3) {
    sign = !sign;
    j -= 4;
  }

  const zz = z * z;
  if (j === 1 || j === 2) {
    y = 1.0 - 0.5 * zz + zz * zz * (((((_cos[0] * zz + _cos[1]) * zz + _cos[2]) * zz + _cos[3]) * zz + _cos[4]) * zz + _cos[5]);
  } else {
    y = z + z * zz * (((((_sin[0] * zz + _sin[1]) * zz + _sin[2]) * zz + _sin[3]) * zz + _sin[4]) * zz + _sin[5]);
  }
  if (sign) {
    y = -y;
  }
  return y;
}

// ---------------------------------------------------------------------------
// strconv.Quote / fmt's "%q" for a string, on the string's WTF-8 bytes: a lone
// surrogate is 3 invalid bytes, each written as "\x..". unicode.IsPrint is
// letters, marks, numbers, punctuation, symbols and the ASCII space.
function hexDigits(n        , width        )         {
  return n.toString(16).padStart(width, "0");
}
export function goQuoteRune(c        , quote        )         {
  if (c === quote || c === 92) return "\\" + String.fromCharCode(c);
  if (goIsPrint(c)) return String.fromCodePoint(c);
  const bs = "\\";
  switch (c) {
    case 7:
      return bs + "a";
    case 8:
      return bs + "b";
    case 12:
      return bs + "f";
    case 10:
      return bs + "n";
    case 13:
      return bs + "r";
    case 9:
      return bs + "t";
    case 11:
      return bs + "v";
  }
  if (c < 32 || c === 0x7f) return bs + "x" + hexDigits(c, 2);
  if (c < 0x10000) return bs + "u" + hexDigits(c, 4);
  return bs + "U" + hexDigits(c, 8);
}
// (Go's tables: Unicode 15.0.0)
export function goIsPrint(c        )          {
  return unicodeIsPrint(c);
}
export function goQuote(s        )         {
  let out = '"';
  const n = s.length;
  for (let i = 0; i < n; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      const c2 = i + 1 < n ? s.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        i++;
      } else if (c >= 0xdc80 && c <= 0xdcff) {
        // (a raw byte of invalid UTF-8, see helpers.decodeGoString)
        out += "\\x" + hexDigits(c - 0xdc00, 2);
        continue;
      } else {
        // (the 3 bytes of the WTF-8 encoding)
        const x = "\\x";
        out += x + hexDigits(0xe0 | (c >> 12), 2) + x + hexDigits(0x80 | ((c >> 6) & 0x3f), 2) + x + hexDigits(0x80 | (c & 0x3f), 2);
        continue;
      }
    }
    out += goQuoteRune(c, 34);
  }
  return out + '"';
}

// strconv.Quote of a byte string (bytes that are not valid UTF-8 become
// "\x" escapes)
export function goQuoteBytes(b            )         {
  let out = '"';
  let i = 0;
  while (i < b.length) {
    const [c, width] = goDecodeRune(b, i);
    if (c === 0xfffd && width === 1) {
      out += "\\x" + hexDigits(b[i], 2);
    } else {
      out += goQuoteRune(c, 34);
    }
    i += width;
  }
  return out + '"';
}

// utf8.DecodeRune: [rune, width], [0xFFFD, 1] for an invalid sequence
export function goDecodeRune(b            , i        )                   {
  const n = b.length - i;
  const c0 = b[i];
  if (c0 < 0x80) return [c0, 1];
  const cont = (k        ) => k < n && (b[i + k] & 0xc0) === 0x80;
  if (c0 >= 0xc2 && c0 <= 0xdf) {
    if (cont(1)) return [((c0 & 0x1f) << 6) | (b[i + 1] & 0x3f), 2];
  } else if (c0 >= 0xe0 && c0 <= 0xef) {
    if (cont(1) && cont(2)) {
      const c = ((c0 & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f);
      if (c >= 0x800 && (c < 0xd800 || c > 0xdfff)) return [c, 3];
    }
  } else if (c0 >= 0xf0 && c0 <= 0xf4) {
    if (cont(1) && cont(2) && cont(3)) {
      const c = ((c0 & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
      if (c >= 0x10000 && c <= 0x10ffff) return [c, 4];
    }
  }
  return [0xfffd, 1];
}

// ---------------------------------------------------------------------------
// sort.Stable (sort/zsortinterface.go): the exact sequence of swaps Go makes,
// which matters when "less" is not a strict ordering (e.g. "<=")

export function goSortStable   (data     , less                         ) {
  const n = data.length;
  const lessAt = (i        , j        ) => less(data[i], data[j]);
  const swap = (i        , j        ) => {
    const t = data[i];
    data[i] = data[j];
    data[j] = t;
  };
  const insertionSort = (a        , b        ) => {
    for (let i = a + 1; i < b; i++) {
      for (let j = i; j > a && lessAt(j, j - 1); j--) {
        swap(j, j - 1);
      }
    }
  };
  const swapRange = (a        , b        , n        ) => {
    for (let i = 0; i < n; i++) {
      swap(a + i, b + i);
    }
  };
  const rotate = (a        , m        , b        ) => {
    let i = m - a;
    let j = b - m;
    while (i !== j) {
      if (i > j) {
        swapRange(m - i, m, j);
        i -= j;
      } else {
        swapRange(m - i, m + j - i, i);
        j -= i;
      }
    }
    // i == j
    swapRange(m - i, m, i);
  };
  const symMerge = (a        , m        , b        ) => {
    // Avoid unnecessary recursions of symMerge
    // by direct insertion of data[a] into data[m:b]
    // if data[a:m] only contains one element.
    if (m - a === 1) {
      // Use binary search to find the lowest index i
      // such that data[i] >= data[a] for m <= i < b.
      // Exit the search loop with i == b in case no such index exists.
      let i = m;
      let j = b;
      while (i < j) {
        const h = (i + j) >>> 1;
        if (lessAt(h, a)) {
          i = h + 1;
        } else {
          j = h;
        }
      }
      // Swap values until data[a] reaches the position before i.
      for (let k = a; k < i - 1; k++) {
        swap(k, k + 1);
      }
      return;
    }

    // Avoid unnecessary recursions of symMerge
    // by direct insertion of data[m] into data[a:m]
    // if data[m:b] only contains one element.
    if (b - m === 1) {
      // Use binary search to find the lowest index i
      // such that data[i] > data[m] for a <= i < m.
      // Exit the search loop with i == m in case no such index exists.
      let i = a;
      let j = m;
      while (i < j) {
        const h = (i + j) >>> 1;
        if (!lessAt(m, h)) {
          i = h + 1;
        } else {
          j = h;
        }
      }
      // Swap values until data[m] reaches the position i.
      for (let k = m; k > i; k--) {
        swap(k, k - 1);
      }
      return;
    }

    const mid = (a + b) >>> 1;
    const n = mid + m;
    let start        ;
    let r        ;
    if (m > mid) {
      start = n - b;
      r = mid;
    } else {
      start = a;
      r = m;
    }
    const p = n - 1;

    while (start < r) {
      const c = (start + r) >>> 1;
      if (!lessAt(p - c, c)) {
        start = c + 1;
      } else {
        r = c;
      }
    }

    const end = n - start;
    if (start < m && m < end) {
      rotate(start, m, end);
    }
    if (a < start && start < mid) {
      symMerge(a, start, mid);
    }
    if (mid < end && end < b) {
      symMerge(mid, end, b);
    }
  };

  let blockSize = 20; // must be > 0
  let a = 0;
  let b = blockSize;
  while (b <= n) {
    insertionSort(a, b);
    a = b;
    b += blockSize;
  }
  insertionSort(a, n);

  while (blockSize < n) {
    a = 0;
    b = 2 * blockSize;
    while (b <= n) {
      symMerge(a, a + blockSize, b);
      a = b;
      b += 2 * blockSize;
    }
    const m = a + blockSize;
    if (m < n) {
      symMerge(a, m, n);
    }
    blockSize *= 2;
  }
}
// generated from gostd.mts by tools/ts-build.mjs; edit that file
