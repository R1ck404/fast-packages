// Port of the parts of internal/helpers (and a few Go stdlib behaviours) used
// by the transform pipeline. Go strings / []uint16 are both JS strings here
// (see CONVENTIONS.md section 3), so most UTF conversions are the identity.

import { goStringsEqualFold } from "./gostrings.mjs";
import { GoPanic } from "./gopanic.mjs";

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
// The code point at i (a lone surrogate is its own code point, as in Go's
// WTF-8 strings)
export function codePointWTF8At(s: string, i: number): number {
  const c = s.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
    const d = s.charCodeAt(i + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
  }
  return c;
}

// What a JavaScript TextDecoder makes of the WTF-8 encoding of s (Go's
// bytes for a JS string with lone surrogates): each lone surrogate is three
// invalid bytes, three U+FFFD
export function decodedWTF8(s: string): string {
  if (s.isWellFormed()) return s;
  let t = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        t += s[i] + s[i + 1];
        i++;
        continue;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) t += String.fromCharCode(0xfffd, 0xfffd, 0xfffd);
    else t += s[i];
  }
  return t;
}

// Go's byte-wise comparison of the WTF-8 encodings of a and b, which differ
// first at UTF-16 index i (their code points compare the same way)
export function compareWTF8At(a: string, b: string, i: number): number {
  if (i > 0) {
    const h = a.charCodeAt(i - 1);
    if (h >= 0xd800 && h <= 0xdbff) {
      // (the same high surrogate: a pair in one string only, or two pairs)
      const x = codePointWTF8At(a, i - 1);
      const y = codePointWTF8At(b, i - 1);
      if (x !== y) return x < y ? -1 : 1;
    }
  }
  const x = codePointWTF8At(a, i);
  const y = codePointWTF8At(b, i);
  return x < y ? -1 : x > y ? 1 : 0;
}

// len(text) in bytes: a lone surrogate is its 3 WTF-8 bytes, a raw byte of
// invalid UTF-8 one byte (see decodeGoString)
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
    } else if (c >= 0xdc80 && c <= 0xdcff) n += 1;
    else n += 3;
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
  // (raw bytes of invalid UTF-8: Go works on bytes)
  if (hasRawBytes(text)) return internalQuoteRaw(text, asciiOnly, quoteChar);
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

// Go: len(text) >= len(tag) && strings.EqualFold(text[:len(tag)], tag) for
// an ASCII "tag": the prefix is cut after len(tag) UTF-8 bytes (a character
// that the cut splits is invalid UTF-8, which matches no ASCII character)
function hasPrefixEqualFoldInBytes(text: string, tag: string): boolean {
  let bytes = 0;
  let i = 0;
  while (bytes < tag.length && i < text.length) {
    const c = text.codePointAt(i)!;
    const w = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? (c >= 0xdc80 && c <= 0xdcff ? 1 : 3) : 4;
    if (bytes + w > tag.length) return false;
    bytes += w;
    i += c > 0xffff ? 2 : 1;
  }
  if (bytes < tag.length) return false;
  return goStringsEqualFold(text.slice(0, i), tag);
}

export function escapeClosingTag(text, slashTag) {
  if (slashTag === "") return text;
  let i = text.indexOf("</");
  if (i < 0) return text;
  let b = "";
  for (;;) {
    b += text.slice(0, i + 1);
    text = text.slice(i + 1);
    if (hasPrefixEqualFoldInBytes(text, slashTag)) b += "\\";
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

// helpers/glob.go

// GlobWildcard
export const GlobNone = 0;
export const GlobAllExceptSlash = 1;
export const GlobAllIncludingSlash = 2;

// A struct compared by value in Go ("a != b"): compare both fields
export class GlobPart {
  declare prefix: string;
  declare wildcard: number;
  constructor(prefix = "", wildcard = GlobNone) {
    this.prefix = prefix;
    this.wildcard = wildcard;
  }
}

// The returned array will always be at least one element. If there are no
// wildcards then it will be exactly one element, and if there are wildcards
// then it will be more than one element.
export function parseGlobPattern(text: string): GlobPart[] {
  const pattern: GlobPart[] = [];
  for (;;) {
    const star = text.indexOf("*");
    if (star < 0) {
      pattern.push(new GlobPart(text));
      break;
    }
    let count = 1;
    while (star + count < text.length && text.charCodeAt(star + count) === 0x2a /* '*' */) {
      count++;
    }
    let wildcard = GlobAllExceptSlash;

    // Allow both "/" and "\" as slashes
    if (
      count > 1 &&
      (star === 0 || text.charCodeAt(star - 1) === 0x2f || text.charCodeAt(star - 1) === 0x5c) &&
      (star + count === text.length || text.charCodeAt(star + count) === 0x2f || text.charCodeAt(star + count) === 0x5c)
    ) {
      wildcard = GlobAllIncludingSlash; // A "globstar" path segment
    }

    pattern.push(new GlobPart(text.slice(0, star), wildcard));
    text = text.slice(star + count);
  }
  return pattern;
}

export function globPatternToString(pattern: GlobPart[]): string {
  let sb = "";
  for (let i = 0; i < pattern.length; i++) {
    const part = pattern[i];
    sb += part.prefix;
    switch (part.wildcard) {
      case GlobAllExceptSlash:
        sb += "*";
        break;
      case GlobAllIncludingSlash:
        sb += "**";
        break;
    }
  }
  return sb;
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
  declare parts: any[];
  declare length: number;
  declare lastByte: number;
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

// ---------------------------------------------------------------------------
// Go strings with invalid UTF-8 (JS-only)
//
// Go strings are bytes; the port's strings are JS strings. Text that Go
// reads from bytes (source files, the input of a transform, the stdin of a
// build, plugin contents) can be invalid UTF-8, and Go keeps those bytes: a
// comment or a regular expression literal is printed with them, a message
// shows them in its line of source text. The port decodes such text with
// decodeGoString: each byte that does not start a valid UTF-8 sequence (the
// bytes Go's utf8.DecodeRune decodes as (RuneError, 1)) becomes the lone
// surrogate U+DC00 + byte (U+DC80..U+DCFF, which valid UTF-8 never
// produces), one UTF-16 unit for one byte like Go's one column. The lexers
// read it as U+FFFD, like Go; goStringBytes turns it back into the byte.
// (A lone surrogate from an escape sequence in a string, e.g. U+DC80, is
// its 3-byte WTF-8 encoding in Go: outside of this range the port writes it
// that way.)

let fatalDecoder: TextDecoder | null = null;

// string(bytes) for bytes that may be invalid UTF-8
export function decodeGoString(bytes: Uint8Array): string {
  if (fatalDecoder === null) fatalDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    return fatalDecoder.decode(bytes);
  } catch {}
  let out = "";
  let start = 0;
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    const w = validUTF8SequenceLength(bytes, i);
    if (w > 0) {
      i += w;
      continue;
    }
    // An invalid byte: the valid text before it, then the byte
    if (start < i) out += fatalDecoder.decode(bytes.subarray(start, i));
    out += String.fromCharCode(0xdc00 + b);
    i++;
    start = i;
  }
  if (start < n) out += fatalDecoder.decode(bytes.subarray(start, n));
  return out;
}

// The length of the valid UTF-8 sequence at bytes[i] (a non-ASCII lead
// byte), or 0 (utf8.DecodeRune's rules: no overlong forms, no surrogates,
// nothing above U+10FFFF)
function validUTF8SequenceLength(bytes: Uint8Array, i: number): number {
  const n = bytes.length;
  const b0 = bytes[i];
  const cont = (j: number) => j < n && (bytes[j] & 0xc0) === 0x80;
  if (b0 >= 0xc2 && b0 <= 0xdf) return cont(i + 1) ? 2 : 0;
  if (b0 >= 0xe0 && b0 <= 0xef) {
    if (i + 1 >= n) return 0;
    const b1 = bytes[i + 1];
    const lo = b0 === 0xe0 ? 0xa0 : 0x80;
    const hi = b0 === 0xed ? 0x9f : 0xbf;
    if (b1 < lo || b1 > hi) return 0;
    return cont(i + 2) ? 3 : 0;
  }
  if (b0 >= 0xf0 && b0 <= 0xf4) {
    if (i + 1 >= n) return 0;
    const b1 = bytes[i + 1];
    const lo = b0 === 0xf0 ? 0x90 : 0x80;
    const hi = b0 === 0xf4 ? 0x8f : 0xbf;
    if (b1 < lo || b1 > hi) return 0;
    return cont(i + 2) && cont(i + 3) ? 4 : 0;
  }
  return 0;
}

// Whether the UTF-16 unit is a raw byte of invalid UTF-8 (see above)
export function isRawByteUnit(c: number): boolean {
  return c >= 0xdc80 && c <= 0xdcff;
}

// []byte(s) for a Go string held in a JS string (see above)
let goStringEncoder: TextEncoder | null = null;
export function goStringBytes(s: string): Uint8Array {
  if (s.isWellFormed()) {
    if (goStringEncoder === null) goStringEncoder = new TextEncoder();
    return goStringEncoder.encode(s);
  }
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      if (c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
          out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
          continue;
        }
      }
      if (c >= 0xdc80 && c <= 0xdcff) {
        out.push(c - 0xdc00);
        continue;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

// len(s) in bytes for a Go string held in a JS string (see above)
export function goStringByteLength(s: string): number {
  let n = 0;
  const len = s.length;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < len) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else if (c >= 0xdc80 && c <= 0xdcff) n += 1;
    else n += 3;
  }
  return n;
}

// Whether a string holds a raw byte of invalid UTF-8 (see decodeGoString)
export function hasRawBytes(text: string): boolean {
  if (text.isWellFormed()) return false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xdc80 && c <= 0xdcff && !(i > 0 && (text.charCodeAt(i - 1) & 0xfc00) === 0xd800)) return true;
  }
  return false;
}

// helpers.DecodeWTF8Rune on bytes: [rune, width] (width 0 for a truncated
// sequence at the end, like Go)
function decodeWTF8RuneBytes(s: Uint8Array, i: number): [number, number] {
  const n = s.length - i;
  if (n < 1) return [0xfffd, 0];
  const s0 = s[i];
  if (s0 < 0x80) return [s0, 1];
  let sz: number;
  if ((s0 & 0xe0) === 0xc0) sz = 2;
  else if ((s0 & 0xf0) === 0xe0) sz = 3;
  else if ((s0 & 0xf8) === 0xf0) sz = 4;
  else return [0xfffd, 1];
  if (n < sz) return [0xfffd, 0];
  const s1 = s[i + 1];
  if ((s1 & 0xc0) !== 0x80) return [0xfffd, 1];
  if (sz === 2) {
    const cp = ((s0 & 0x1f) << 6) | (s1 & 0x3f);
    if (cp < 0x80) return [0xfffd, 1];
    return [cp, 2];
  }
  const s2 = s[i + 2];
  if ((s2 & 0xc0) !== 0x80) return [0xfffd, 1];
  if (sz === 3) {
    const cp = ((s0 & 0x0f) << 12) | ((s1 & 0x3f) << 6) | (s2 & 0x3f);
    if (cp < 0x0800) return [0xfffd, 1];
    return [cp, 3];
  }
  const s3 = s[i + 3];
  if ((s3 & 0xc0) !== 0x80) return [0xfffd, 1];
  const cp = ((s0 & 0x07) << 18) | ((s1 & 0x3f) << 12) | ((s2 & 0x3f) << 6) | (s3 & 0x3f);
  if (cp < 0x010000 || cp > 0x10ffff) return [0xfffd, 1];
  return [cp, 4];
}

// helpers.internalQuote on the bytes of a Go string that holds raw bytes of
// invalid UTF-8 (the result keeps them: see decodeGoString)
export function internalQuoteRaw(text: string, asciiOnly: boolean, quoteChar: string): string {
  const bytes = goStringBytes(text);
  const out: number[] = [quoteChar.charCodeAt(0)];
  const n = bytes.length;
  let i = 0;
  const pushASCII = (s: string) => {
    for (let k = 0; k < s.length; k++) out.push(s.charCodeAt(k));
  };
  while (i < n) {
    let [c, width] = decodeWTF8RuneBytes(bytes, i);

    // Fast path: a run of characters that don't need escaping
    if (canPrintWithoutEscape(c, asciiOnly)) {
      const start = i;
      i += width;
      while (i < n) {
        [c, width] = decodeWTF8RuneBytes(bytes, i);
        if (!canPrintWithoutEscape(c, asciiOnly)) {
          break;
        }
        if (width === 0) {
          // (Go loops forever here: the text ends in an incomplete UTF-8
          // sequence, which DecodeWTF8Rune says is 0 bytes long)
          throw new GoPanic("helpers.QuoteForJSON never finishes for text that ends in an incomplete UTF-8 sequence");
        }
        i += width;
      }
      for (let k = start; k < i; k++) out.push(bytes[k]);
      if (width === 0 && i === start) {
        throw new GoPanic("helpers.QuoteForJSON never finishes for text that ends in an incomplete UTF-8 sequence");
      }
      continue;
    }

    switch (c) {
      case 8:
        pushASCII("\\b");
        i++;
        break;
      case 12:
        pushASCII("\\f");
        i++;
        break;
      case 10:
        pushASCII("\\n");
        i++;
        break;
      case 13:
        pushASCII("\\r");
        i++;
        break;
      case 9:
        pushASCII("\\t");
        i++;
        break;
      case 92:
        pushASCII("\\\\");
        i++;
        break;
      case 34:
        pushASCII(quoteChar === '"' ? '\\"' : '"');
        i++;
        break;
      case 39:
        pushASCII(quoteChar === "'" ? "\\'" : "'");
        i++;
        break;
      default:
        if (width === 0) {
          // (Go appends escapes forever here: see above)
          throw new GoPanic("helpers.QuoteForJSON never finishes for text that ends in an incomplete UTF-8 sequence");
        }
        i += width;
        if (c <= 0xffff) pushASCII(hex4(c));
        else {
          c -= 0x10000;
          pushASCII(hex4(0xd800 + ((c >> 10) & 0x3ff)) + hex4(0xdc00 + (c & 0x3ff)));
        }
    }
  }
  out.push(quoteChar.charCodeAt(0));
  return decodeGoString(new Uint8Array(out));
}
