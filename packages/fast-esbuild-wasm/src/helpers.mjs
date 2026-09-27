// Port of the parts of internal/helpers (and a few Go stdlib behaviours) used
// by the transform pipeline. Go strings / []uint16 are both JS strings here
// (see CONVENTIONS.md section 3), so most UTF conversions are the identity.

// helpers.UTF16ToString / StringToUTF16: WTF-8 <-> UTF-16 round-trips exactly,
// and both representations are JS strings in the port.
export function utf16ToString(text) {
  return text;
}
export function stringToUTF16(text) {
  return text;
}
export function utf16EqualsString(text, str) {
  return text === str;
}
export function utf16EqualsUTF16(a, b) {
  return a === b;
}

// Returns [string, badCodeUnit, ok]
export function utf16ToStringWithValidation(text) {
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (i + 1 < n) {
        const c2 = text.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          i++;
          continue;
        }
      }
      return ["", c, false];
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return ["", c, false];
    }
  }
  return [text, 0, true];
}

export function containsNonBMPCodePoint(text) {
  const n = text.length;
  for (let i = 0; i + 1 < n; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = text.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) return true;
    }
  }
  return false;
}
export const containsNonBMPCodePointUTF16 = containsNonBMPCodePoint;

// Length in bytes of the WTF-8 encoding of a JS string (Go's len(string)).
export function utf8Len(text) {
  let n = 0;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < len) {
      const c2 = text.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

// Decode the code point at index i (like Go's DecodeWTF8Rune on the
// corresponding bytes). Returns the code point; width is 1 or 2 UTF-16 units.
export function codePointAt(text, i) {
  const c = text.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
    const c2 = text.charCodeAt(i + 1);
    if (c2 >= 0xdc00 && c2 <= 0xdfff) return ((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000;
  }
  return c;
}

const hexChars = "0123456789ABCDEF";
const firstASCII = 0x20;
const lastASCII = 0x7e;

function canPrintWithoutEscape(c, asciiOnly) {
  if (c <= lastASCII) return c >= firstASCII && c !== 92 && c !== 34;
  return !asciiOnly && c !== 0xfeff && (c < 0xd800 || c > 0xdfff);
}

function hex4(c) {
  return "\\u" + hexChars[c >> 12] + hexChars[(c >> 8) & 15] + hexChars[(c >> 4) & 15] + hexChars[c & 15];
}

function internalQuote(text, asciiOnly, quoteChar) {
  let out = quoteChar;
  const n = text.length;
  let i = 0;
  while (i < n) {
    let c = codePointAt(text, i);
    let width = c > 0xffff ? 2 : 1;
    if (canPrintWithoutEscape(c, asciiOnly)) {
      const start = i;
      i += width;
      while (i < n) {
        c = codePointAt(text, i);
        width = c > 0xffff ? 2 : 1;
        if (!canPrintWithoutEscape(c, asciiOnly)) break;
        i += width;
      }
      out += text.slice(start, i);
      continue;
    }
    switch (c) {
      case 8:
        out += "\\b";
        i++;
        break;
      case 12:
        out += "\\f";
        i++;
        break;
      case 10:
        out += "\\n";
        i++;
        break;
      case 13:
        out += "\\r";
        i++;
        break;
      case 9:
        out += "\\t";
        i++;
        break;
      case 92:
        out += "\\\\";
        i++;
        break;
      case 34:
        out += quoteChar === '"' ? '\\"' : '"';
        i++;
        break;
      case 39:
        out += quoteChar === "'" ? "\\'" : "'";
        i++;
        break;
      default:
        i += width;
        if (c <= 0xffff) out += hex4(c);
        else {
          c -= 0x10000;
          out += hex4(0xd800 + ((c >> 10) & 0x3ff)) + hex4(0xdc00 + (c & 0x3ff));
        }
    }
  }
  return out + quoteChar;
}

export function quoteSingle(text, asciiOnly) {
  return internalQuote(text, asciiOnly, "'");
}
export function quoteForJSON(text, asciiOnly) {
  return internalQuote(text, asciiOnly, '"');
}

export function escapeClosingTag(text, slashTag) {
  if (slashTag === "") return text;
  let i = text.indexOf("</");
  if (i < 0) return text;
  let b = "";
  for (;;) {
    b += text.slice(0, i + 1);
    text = text.slice(i + 1);
    if (text.length >= slashTag.length && text.slice(0, slashTag.length).toLowerCase() === slashTag.toLowerCase()) b += "\\";
    i = text.indexOf("</");
    if (i < 0) break;
  }
  return b + text;
}

export function stringArraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function stringArrayArraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!stringArraysEqual(a[i], b[i])) return false;
  return true;
}

export function isInsideNodeModules(path) {
  for (;;) {
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    if (slash === -1) return false;
    const dir = path.slice(0, slash);
    const base = path.slice(slash + 1);
    if (base === "node_modules") return true;
    path = dir;
  }
}

export function hashCombine(seed, hash) {
  return (seed ^ ((hash + 0x9e3779b9 + (seed << 6) + (seed >>> 2)) >>> 0)) >>> 0;
}

export function hashCombineString(seed, text) {
  // Go: uint32(len(text)) is the byte length, then each rune
  seed = hashCombine(seed, utf8Len(text));
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = codePointAt(text, i);
    if (c > 0xffff) i++;
    seed = hashCombine(seed, c >= 0xd800 && c <= 0xdfff ? 0xfffd : c);
  }
  return seed;
}

// helpers.Joiner: output concatenation that remembers the last character.
export class Joiner {
  ;                    
  ;                      
  ;                        
  constructor() {
    this.parts = [];
    this.length = 0;
    this.lastByte = 0;
  }
  addString(data) {
    if (data.length > 0) this.lastByte = data.charCodeAt(data.length - 1);
    this.parts.push(data);
    this.length += data.length;
  }
  addBytes(data) {
    this.addString(data);
  }
  ensureNewlineAtEnd() {
    if (this.length > 0 && this.lastByte !== 10) this.addString("\n");
  }
  done() {
    return this.parts.join("");
  }
  contains(s) {
    for (const p of this.parts) if (p.includes(s)) return true;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Go float formatting

// Returns [digits, decimalPointPosition] of the shortest round-trip decimal
// representation of a finite positive number (like strconv's "digs.d/digs.dp").
export function shortestDecimal(x) {
  const s = x.toExponential(); // shortest digits, e.g. "1.2345e+6"
  const e = s.indexOf("e");
  let mant = s.slice(0, e);
  const exp = +s.slice(e + 1);
  const dot = mant.indexOf(".");
  if (dot >= 0) mant = mant.slice(0, dot) + mant.slice(dot + 1);
  return [mant, exp + 1];
}

function expSuffix(exp, ch) {
  let sign = "+";
  if (exp < 0) {
    sign = "-";
    exp = -exp;
  }
  return ch + sign + (exp < 10 ? "0" + exp : "" + exp);
}

// strconv.FormatFloat(x, 'g', -1, 64)
export function formatFloatG(x) {
  if (x !== x) return "NaN";
  if (x === Infinity) return "+Inf";
  if (x === -Infinity) return "-Inf";
  let neg = x < 0 || Object.is(x, -0);
  if (neg) x = -x;
  let out;
  if (x === 0) out = "0";
  else {
    const $d233 = shortestDecimal(x);
    const d = $d233[0], dp = $d233[1];
    const exp = dp - 1;
    if (exp < -4 || exp >= 6) {
      out = d[0] + (d.length > 1 ? "." + d.slice(1) : "") + expSuffix(exp, "e");
    } else if (dp <= 0) {
      out = "0." + "0".repeat(-dp) + d;
    } else if (dp >= d.length) {
      out = d + "0".repeat(dp - d.length);
    } else {
      out = d.slice(0, dp) + "." + d.slice(dp);
    }
  }
  return neg ? "-" + out : out;
}

// strconv.FormatFloat(x, 'e', -1, 64)
export function formatFloatE(x) {
  if (x !== x) return "NaN";
  if (x === Infinity) return "+Inf";
  if (x === -Infinity) return "-Inf";
  const neg = x < 0 || Object.is(x, -0);
  if (neg) x = -x;
  let out;
  if (x === 0) out = "0e+00";
  else {
    const $d234 = shortestDecimal(x);
    const d = $d234[0], dp = $d234[1];
    out = d[0] + (d.length > 1 ? "." + d.slice(1) : "") + expSuffix(dp - 1, "e");
  }
  return neg ? "-" + out : out;
}

// fmt.Sprintf("%.0f", x) (round half to even on the exact binary value)
export function formatFloatF0(x) {
  if (x !== x) return "NaN";
  if (x === Infinity) return "+Inf";
  if (x === -Infinity) return "-Inf";
  if (Math.abs(x) < 1e21) {
    // toFixed(0) rounds half away from zero; Go rounds the exact value half to
    // even. Exact halves only exist below 2^53.
    let r = Math.round(x);
    if (Math.abs(x % 1) === 0.5 && r % 2 !== 0) r -= Math.sign(x);
    if (Object.is(r, -0) || (r === 0 && (x < 0 || Object.is(x, -0)))) return "-0";
    return BigInt(r).toString();
  }
  return BigInt(x).toString();
}

// strconv.ParseFloat for decimal literals (JS Number() is also correctly rounded)
export function parseFloat64(text) {
  return Number(text);
}
// generated from helpers.mts by tools/ts-build.mjs; edit that file
