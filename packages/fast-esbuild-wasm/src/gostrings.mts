// Go's "strings" functions that iterate over the runes of a string, for JS
// strings that hold Go strings: a surrogate pair is one rune; a lone
// surrogate in U+DC80..U+DCFF stands for a raw byte of invalid UTF-8 (see
// helpers.decodeGoString), which Go decodes as one U+FFFD; any other lone
// surrogate stands for its 3-byte WTF-8 encoding, 3 x U+FFFD for Go.

import { unicodeToLower, unicodeToUpper, simpleFold } from "./goregexp.mjs";

const RuneError = 0xfffd;

// The runes Go's "for range" gives for "s"
export function goRunes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      if (c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          out.push(0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00));
          i++;
          continue;
        }
      }
      if (c >= 0xdc80 && c <= 0xdcff) out.push(RuneError);
      else out.push(RuneError, RuneError, RuneError);
      continue;
    }
    out.push(c);
  }
  return out;
}

function isASCII(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 0x80) return false;
  return true;
}

// strings.Map(f, s): invalid bytes become U+FFFD
function goStringsMap(s: string, f: (r: number) => number): string {
  let out = "";
  for (const r of goRunes(s)) out += String.fromCodePoint(f(r));
  return out;
}

// strings.ToLower
export function goStringsToLower(s: string): string {
  if (isASCII(s)) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 65 && c <= 90) return s.toLowerCase();
    }
    return s;
  }
  return goStringsMap(s, unicodeToLower);
}

// strings.ToUpper
export function goStringsToUpper(s: string): string {
  if (isASCII(s)) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 97 && c <= 122) return s.toUpperCase();
    }
    return s;
  }
  return goStringsMap(s, unicodeToUpper);
}

// strings.EqualFold
export function goStringsEqualFold(s: string, t: string): boolean {
  // ASCII fast path
  if (isASCII(s) && isASCII(t)) {
    if (s.length !== t.length) return false;
    for (let i = 0; i < s.length; i++) {
      let sr = s.charCodeAt(i);
      let tr = t.charCodeAt(i);
      if (tr === sr) continue;
      if (tr < sr) {
        const x = tr;
        tr = sr;
        sr = x;
      }
      if (65 <= sr && sr <= 90 && tr === sr + 32) continue;
      return false;
    }
    return true;
  }
  const sRunes = goRunes(s);
  const tRunes = goRunes(t);
  let j = 0;
  for (let sr of sRunes) {
    if (j >= tRunes.length) return false;
    let tr = tRunes[j++];
    if (tr === sr) continue;
    if (tr < sr) {
      const x = tr;
      tr = sr;
      sr = x;
    }
    if (tr < 0x80) {
      if (65 <= sr && sr <= 90 && tr === sr + 32) continue;
      return false;
    }
    let r = simpleFold(sr);
    while (r !== sr && r < tr) r = simpleFold(r);
    if (r === tr) continue;
    return false;
  }
  return j === tRunes.length;
}
