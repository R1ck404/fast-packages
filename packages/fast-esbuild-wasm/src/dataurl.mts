// Port of internal/resolver/dataurl.go, internal/helpers/dataurl.go and
// internal/helpers/mime.go, plus the parts of Go's net/url
// (PathUnescape) and encoding/base64 (StdEncoding.DecodeString) they use.
//
// Go works on byte strings. Here a data URL is a JS string and decoded data
// is returned as bytes (Uint8Array), exactly the bytes Go would produce.
import { goQuoteBytes } from "./gostd.mjs";
import { goStringBytes } from "./helpers.mjs";
import { goStringsToLower } from "./fs.mjs";

// ---------------------------------------------------------------------------
// resolver/dataurl.go

export class DataURL {
  declare mimeType: string;
  declare data: string;
  declare isBase64: boolean;
  constructor(mimeType = "", data = "", isBase64 = false) {
    this.mimeType = mimeType;
    this.data = data;
    this.isBase64 = isBase64;
  }

  decodeMIMEType(): number {
    // Remove things like ";charset=utf-8"
    let mimeType = this.mimeType;
    const semicolon = mimeType.indexOf(";");
    if (semicolon !== -1) mimeType = mimeType.slice(0, semicolon);

    // Hard-code a few supported types
    switch (mimeType) {
      case "text/css":
        return MIMETypeTextCSS;
      case "text/javascript":
        return MIMETypeTextJavaScript;
      case "application/json":
        return MIMETypeApplicationJSON;
      default:
        return MIMETypeUnsupported;
    }
  }

  // Returns [bytes, errorText]. The bytes are what Go's string would hold.
  decodeData(): [Uint8Array, string | null] {
    // Try to read base64 data
    if (this.isBase64) {
      const $b = base64StdDecode(this.data);
      if ($b[0] === null) return [EMPTY, "could not decode base64 data: " + $b[1]];
      return [$b[0], null];
    }

    // Try to read percent-escaped data
    const $c = urlPathUnescapeBytes(this.data);
    if ($c[0] === null) return [EMPTY, "could not decode percent-escaped data: " + $c[1]];
    return [$c[0], null];
  }
}

const EMPTY = new Uint8Array(0);

// Returns [parsed, ok]
export function parseDataURL(url: string): [DataURL, boolean] {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma !== -1) {
      const parsed = new DataURL(url.slice(5, comma), url.slice(comma + 1), false);
      if (parsed.mimeType.endsWith(";base64")) {
        parsed.mimeType = parsed.mimeType.slice(0, parsed.mimeType.length - 7);
        parsed.isBase64 = true;
      }
      return [parsed, true];
    }
  }
  return [NOT_A_DATA_URL, false];
}

const NOT_A_DATA_URL = Object.freeze(new DataURL()) as DataURL;

// MIMEType
export const MIMETypeUnsupported = 0;
export const MIMETypeTextCSS = 1;
export const MIMETypeTextJavaScript = 2;
export const MIMETypeApplicationJSON = 3;

// ---------------------------------------------------------------------------
// encoding/base64: StdEncoding.DecodeString (padding required, "\r" and "\n"
// ignored, non-zero trailing bits allowed). Returns [bytes, null], or [null,
// the text of the CorruptInputError].

const BASE64_DECODE = new Int16Array(256).fill(-1);
{
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) BASE64_DECODE[alphabet.charCodeAt(i)] = i;
}

function base64StdDecode(s: string): [Uint8Array | null, string] {
  // (Encoding.Decode: its fast paths fall back to decodeQuantum at the same
  // position, so decoding quantum by quantum finds the same error. Offsets
  // are byte offsets: everything before an error is ASCII, and a non-ASCII
  // character is itself an illegal byte.)
  const len = s.length;
  const out: number[] = [];
  let si = 0;
  while (si < len) {
    // decodeQuantum
    const dbuf = [0, 0, 0, 0];
    let dlen = 4;
    let err = -1;
    for (let j = 0; j < 4; j++) {
      if (len === si) {
        if (j === 0) return [new Uint8Array(out), ""];
        // (j == 1, or StdEncoding's padding is missing)
        return [null, corruptInputError(si - j)];
      }
      const inChar = s.charCodeAt(si);
      si++;
      const v = inChar < 0x80 ? BASE64_DECODE[inChar] : -1;
      if (v >= 0) {
        dbuf[j] = v;
        continue;
      }
      if (inChar === 10 || inChar === 13) {
        j--;
        continue;
      }
      if (inChar !== 61) {
        return [null, corruptInputError(si - 1)];
      }
      // We've reached the end and there's padding
      switch (j) {
        case 0:
        case 1:
          // incorrect padding
          return [null, corruptInputError(si - 1)];
        case 2:
          // "==" is expected, the first "=" is already consumed.
          // skip over newlines
          while (si < len && (s.charCodeAt(si) === 10 || s.charCodeAt(si) === 13)) si++;
          if (si === len) {
            // not enough padding
            return [null, corruptInputError(len)];
          }
          if (s.charCodeAt(si) !== 61) {
            // incorrect padding
            return [null, corruptInputError(si - 1)];
          }
          si++;
      }
      // skip over newlines
      while (si < len && (s.charCodeAt(si) === 10 || s.charCodeAt(si) === 13)) si++;
      if (si < len) {
        // trailing garbage
        err = si;
      }
      dlen = j;
      break;
    }
    // Convert 4x 6bit source bytes into 3 bytes
    const val = (dbuf[0] << 18) | (dbuf[1] << 12) | (dbuf[2] << 6) | dbuf[3];
    if (dlen === 4) out.push((val >> 16) & 255, (val >> 8) & 255, val & 255);
    else if (dlen === 3) out.push((val >> 16) & 255, (val >> 8) & 255);
    else if (dlen === 2) out.push((val >> 16) & 255);
    if (err >= 0) return [null, corruptInputError(err)];
  }
  return [new Uint8Array(out), ""];
}

// base64.CorruptInputError.Error
function corruptInputError(offset: number): string {
  return "illegal base64 data at input byte " + offset;
}

// ---------------------------------------------------------------------------
// net/url: PathUnescape, returning the bytes (null on an invalid escape)

function isHexCode(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

function unhex(c: number): number {
  if (c <= 57) return c - 48;
  if (c >= 97) return c - 87;
  return c - 55;
}


// Returns [bytes, ""], or [null, the text of the EscapeError]
export function urlPathUnescapeBytes(s: string): [Uint8Array | null, string] {
  // (Go's string is UTF-8; percent escapes and "%" are ASCII, so the check
  // can run on the JS string)
  let percents = 0;
  for (let i = 0; i < s.length; ) {
    if (s.charCodeAt(i) === 37) {
      percents++;
      if (i + 2 >= s.length || !isHexCode(s.charCodeAt(i + 1)) || !isHexCode(s.charCodeAt(i + 2))) {
        // EscapeError: the first 3 bytes from the "%" (possibly part of a
        // UTF-8 sequence), quoted with strconv.Quote
        const rest = goStringBytes(s.slice(i));
        return [null, "invalid URL escape " + goQuoteBytes(rest.subarray(0, 3))];
      }
      i += 3;
    } else {
      i++;
    }
  }
  const bytes = goStringBytes(s);
  if (percents === 0) return [bytes, ""];
  const out = new Uint8Array(bytes.length - 2 * percents);
  let j = 0;
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i];
    if (c === 37) {
      out[j++] = (unhex(bytes[i + 1]) << 4) | unhex(bytes[i + 2]);
      i += 3;
    } else {
      out[j++] = c;
      i++;
    }
  }
  return [out, ""];
}

// ---------------------------------------------------------------------------
// helpers/mime.go

const builtinTypesLower = new Map<string, string>([
  // Text
  [".css", "text/css; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".markdown", "text/markdown; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".xhtml", "application/xhtml+xml; charset=utf-8"],
  [".xml", "text/xml; charset=utf-8"],

  // Images
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],

  // Audio
  [".mp3", "audio/mpeg"],

  // Fonts
  [".eot", "application/vnd.ms-fontobject"],
  [".otf", "font/otf"],
  [".sfnt", "font/sfnt"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],

  // Other
  [".pdf", "application/pdf"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json"],
]);

// This is used instead of Go's built-in "mime.TypeByExtension" function because
// that function is broken on Windows: https://github.com/golang/go/issues/32350.
export function mimeTypeByExtension(ext: string): string {
  let contentType = builtinTypesLower.get(ext);
  if (contentType === undefined) contentType = builtinTypesLower.get(goStringsToLower(ext));
  return contentType === undefined ? "" : contentType;
}

// ---------------------------------------------------------------------------
// helpers/dataurl.go. Go passes the file contents as a byte string; these take
// the bytes.

const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Go's string(bytes) for output that is only ASCII or valid UTF-8
function bytesToString(bytes: Uint8Array): string {
  return UTF8_FATAL.decode(bytes);
}

// Returns the shorter of either a base64-encoded or percent-escaped data URL
export function encodeStringAsShortestDataURL(mimeType: string, contents: Uint8Array): string {
  const encoded = base64StdEncode(contents);
  const url = `data:${mimeType};base64,${encoded}`;
  const percentURL = encodeStringAsPercentEscapedDataURL(mimeType, contents);
  // (Go compares byte lengths; "url" is ASCII apart from "mimeType", which
  // both share)
  if (percentURL !== null && percentURL[1] < utf8Length(url)) return percentURL[0];
  return url;
}

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// encoding/base64: StdEncoding.EncodeToString
export function base64StdEncode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64_ALPHABET[v >> 18] + BASE64_ALPHABET[(v >> 12) & 63] + BASE64_ALPHABET[(v >> 6) & 63] + BASE64_ALPHABET[v & 63];
  }
  if (i + 1 === bytes.length) {
    const v = bytes[i] << 16;
    out += BASE64_ALPHABET[v >> 18] + BASE64_ALPHABET[(v >> 12) & 63] + "==";
  } else if (i + 2 === bytes.length) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64_ALPHABET[v >> 18] + BASE64_ALPHABET[(v >> 12) & 63] + BASE64_ALPHABET[(v >> 6) & 63] + "=";
  }
  return out;
}

const HEX = "0123456789ABCDEF";

// See "scripts/dataurl-escapes.html" for how this was derived. Returns
// [url, byte length of url] or null where Go returns ok == false (invalid
// UTF-8).
export function encodeStringAsPercentEscapedDataURL(mimeType: string, text: Uint8Array): [string, number] | null {
  // We can't encode invalid UTF-8 data (Go's utf8.DecodeRuneInString returns
  // RuneError with width 1 for every invalid sequence, including encoded
  // surrogates, exactly the sequences the fatal decoder rejects)

  try {
    UTF8_FATAL.decode(text);
  } catch {
    return null;
  }

  const n = text.length;
  const out: number[] = [];
  const prefix = goStringBytes("data:" + mimeType + ",");
  for (let k = 0; k < prefix.length; k++) out.push(prefix[k]);
  let i = 0;
  let runStart = 0;

  // Scan for trailing characters that need to be escaped
  let trailingStart = n;
  while (trailingStart > 0) {
    const c = text[trailingStart - 1];
    if (c > 0x20 || c === 9 || c === 10 || c === 13) break;
    trailingStart--;
  }

  while (i < n) {
    const c = text[i];
    // (the rune's width; non-ASCII runes are never escaped)
    const width = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4;

    // Escape this character if needed
    if (
      c === 9 ||
      c === 10 ||
      c === 13 ||
      c === 35 ||
      i >= trailingStart ||
      (c === 37 && i + 2 < n && isHexCode(text[i + 1]) && isHexCode(text[i + 2]))
    ) {
      for (let k = runStart; k < i; k++) out.push(text[k]);
      out.push(37, HEX.charCodeAt(c >> 4), HEX.charCodeAt(c & 15));
      runStart = i + width;
    }

    i += width;
  }

  for (let k = runStart; k < n; k++) out.push(text[k]);
  const bytes = new Uint8Array(out);
  return [bytesToString(bytes), bytes.length];
}

