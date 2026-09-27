// Port of internal/sourcemap/sourcemap.go (the parts used by the transform
// path: VLQ encoding, the printer's ChunkBuilder, line offset tables, chunk
// joining and SourceMapPieces). See CONVENTIONS.md.
//
// Differences from Go that don't change the output:
// - Go stores byte offsets in every Loc and uses line offset tables to turn
//   them into UTF-16 columns. Locs are UTF-16 offsets here, so a column is
//   simply "loc - start of line", and a line offset table is just the UTF-16
//   offset of the start of each line (an Int32Array). This matches Go for
//   every Loc at a character boundary (Go maps a byte offset inside a
//   multi-byte character to the column after that character).
// - "output []byte" arguments are the printer's UTF-16 buffer plus its
//   length (see js_printer.mjs). Go counts UTF-16 code units for generated
//   columns, which is one per code unit here.
// - Mapping buffers ([]byte) are JS strings. Offsets into them (e.g.
//   FirstNameOffset) are string indices, which equal Go's byte offsets since
//   mappings are ASCII.
import { quoteForJSON } from "./helpers.mjs";

export class Mapping {
  constructor(generatedLine = 0, generatedColumn = 0, sourceIndex = 0, originalLine = 0, originalColumn = 0, originalName = -1) {
    this.generatedLine = generatedLine; // 0-based
    this.generatedColumn = generatedColumn; // 0-based count of UTF-16 code units

    this.sourceIndex = sourceIndex; // 0-based
    this.originalLine = originalLine; // 0-based
    this.originalColumn = originalColumn; // 0-based count of UTF-16 code units
    this.originalName = originalName; // ast.Index32: 0-based, optional (-1)
  }
}

export class SourceMap {
  constructor(sources = [], sourcesContent = [], mappings = [], names = []) {
    this.sources = sources; // []string
    this.sourcesContent = sourcesContent; // []SourceContent
    this.mappings = mappings; // []Mapping
    this.names = names; // []string
  }

  find(line, column) {
    const mappings = this.mappings;

    // Binary search
    let count = mappings.length;
    let index = 0;
    while (count > 0) {
      const step = Math.floor(count / 2);
      const i = index + step;
      const mapping = mappings[i];
      if (mapping.generatedLine < line || (mapping.generatedLine === line && mapping.generatedColumn <= column)) {
        index = i + 1;
        count -= step + 1;
      } else {
        count = step;
      }
    }

    // Handle search failure
    if (index > 0) {
      const mapping = mappings[index - 1];

      // Match the behavior of the popular "source-map" library from Mozilla
      if (mapping.generatedLine === line) {
        return mapping;
      }
    }
    return null;
  }
}

export class SourceContent {
  constructor(quoted = "", value = null) {
    // This stores both the unquoted and the quoted values. We try to use the
    // already-quoted value if possible so we don't need to re-quote it
    // unnecessarily for maximum performance.
    this.quoted = quoted;

    // But sometimes we need to re-quote the value, such as when it contains
    // non-ASCII characters and we are in ASCII-only mode. In that case we quote
    // this parsed UTF-16 value.
    this.value = value; // JS string or null
  }
}

const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// base64 digit -> index (-1 for other characters), for DecodeVLQ
const base64Index = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) base64Index[base64.charCodeAt(i)] = i;

// Single-digit VLQ encodings for -15..15 (the common case), indexed by value + 15
const smallVLQ = [];
for (let value = -15; value <= 15; value++) {
  smallVLQ.push(base64[value < 0 ? (-value << 1) | 1 : value << 1]);
}

// A single base 64 digit can contain 6 bits of data. For the base 64 variable
// length quantities we use in the source map spec, the first bit is the sign,
// the next four bits are the actual value, and the 6th bit is the continuation
// bit. The continuation bit tells us whether there are more digits in this
// value following this digit.
//
//	Continuation
//	|    Sign
//	|    |
//	V    V
//	101011
//
// Go appends to "encoded" and returns it; here the result is the JS string
// "encoded" followed by the digits.
export function encodeVLQ(encoded, value) {
  // Handle the common case
  if (value >= -15 && value <= 15) {
    return encoded + smallVLQ[value + 15];
  }

  let vlq;
  if (value < 0) {
    vlq = (-value * 2) | 1;
  } else {
    vlq = value * 2;
  }

  for (;;) {
    let digit = vlq & 31;
    vlq >>>= 5;

    // If there are still more digits in this value, we must make sure the
    // continuation bit is marked
    if (vlq !== 0) {
      digit |= 32;
    }

    encoded += base64[digit];

    if (vlq === 0) {
      break;
    }
  }

  return encoded;
}

// Returns [value, next]
export function decodeVLQ(encoded, start) {
  let shift = 0;
  let vlq = 0;

  // Scan over the input
  for (;;) {
    const c = encoded.charCodeAt(start);
    if (c !== c) throw new RangeError("index out of range"); // (Go panics)
    const index = c < 128 ? base64Index[c] : -1;
    if (index < 0) {
      break;
    }

    // Decode a single byte
    vlq |= (index & 31) << shift;
    start++;
    shift += 5;

    // Stop if there's no continuation bit
    if ((index & 32) === 0) {
      break;
    }
  }

  // Recover the value
  let value = vlq >> 1;
  if ((vlq & 1) !== 0) {
    value = -value;
  }
  return [value, start];
}

export class LineColumnOffset {
  constructor(lines = 0, columns = 0) {
    this.lines = lines;
    this.columns = columns;
  }

  clone() {
    return new LineColumnOffset(this.lines, this.columns);
  }

  comesBefore(b) {
    return this.lines < b.lines || (this.lines === b.lines && this.columns < b.columns);
  }

  add(b) {
    if (b.lines === 0) {
      this.columns += b.columns;
    } else {
      this.lines += b.lines;
      this.columns = b.columns;
    }
  }

  // Go's AdvanceBytes decodes UTF-8 and AdvanceString ranges over runes; both
  // count UTF-16 code units per character, which is one per code unit here
  advanceBytes(text) {
    this.advanceString(text);
  }

  advanceString(text) {
    let columns = this.columns;
    for (let i = 0, n = text.length; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c === 13 || c === 10 || c === 0x2028 || c === 0x2029) {
        // Handle Windows-specific "\r\n" newlines
        if (c === 13 && i + 1 < n && text.charCodeAt(i + 1) === 10) {
          columns++;
          continue;
        }

        this.lines++;
        columns = 0;
      } else {
        // Mozilla's "source-map" library counts columns using UTF-16 code units
        columns++;
      }
    }
    this.columns = columns;
  }
}

export class SourceMapPieces {
  constructor(prefix = "", mappings = "", suffix = "") {
    this.prefix = prefix;
    this.mappings = mappings;
    this.suffix = suffix;
  }

  hasContent() {
    return this.prefix.length + this.mappings.length + this.suffix.length > 0;
  }

  finalize(shifts) {
    const pieces = this;

    // An optimized path for when there are no shifts
    if (shifts.length === 1) {
      return pieces.prefix + pieces.mappings + pieces.suffix;
    }

    let startOfRun = 0;
    let current = 0;
    const generated = new LineColumnOffset();
    let prevShiftColumnDelta = 0;
    let j = "";

    // Start the source map
    j += pieces.prefix;

    // This assumes that a) all mappings are valid and b) all mappings are ordered
    // by increasing generated position. This should be the case for all mappings
    // generated by esbuild, which should be the only mappings we process here.
    const mappings = pieces.mappings;
    let s = 0; // index of shifts[0]
    while (current < mappings.length) {
      // Handle a line break
      if (mappings.charCodeAt(current) === 59 /* ';' */) {
        generated.lines++;
        generated.columns = 0;
        prevShiftColumnDelta = 0;
        current++;
        continue;
      }

      const potentialEndOfRun = current;

      // Read the generated column
      const $d230 = decodeVLQ(mappings, current);
      const generatedColumnDelta = $d230[0], next = $d230[1];
      generated.columns += generatedColumnDelta;
      current = next;

      const potentialStartOfRun = current;

      // Skip over the original position information if present
      if (current < mappings.length) {
        current = decodeVLQ(mappings, current)[1]; // The original source
        current = decodeVLQ(mappings, current)[1]; // The original line
        current = decodeVLQ(mappings, current)[1]; // The original column

        // Skip over the original name if present
        if (current < mappings.length) {
          current = decodeVLQ(mappings, current)[1];
        }
      }

      // Skip a trailing comma
      if (current < mappings.length && mappings.charCodeAt(current) === 44 /* ',' */) {
        current++;
      }

      // Detect crossing shift boundaries
      let didCrossBoundary = false;
      while (shifts.length - s > 1 && shifts[s + 1].before.comesBefore(generated)) {
        s++;
        didCrossBoundary = true;
      }
      if (!didCrossBoundary) {
        continue;
      }

      // This shift isn't relevant if the next mapping after this shift is on a
      // following line. In that case, don't split and keep scanning instead.
      const shift = shifts[s];
      if (shift.after.lines !== generated.lines) {
        continue;
      }

      // Add all previous mappings in a single run for efficiency. Since source
      // mappings are relative, no data needs to be modified inside this run.
      j += mappings.slice(startOfRun, potentialEndOfRun);

      // Then modify the first mapping across the shift boundary with the updated
      // generated column value. It's simplest to only support column shifts. This
      // is reasonable because import paths should not contain newlines.
      if (shift.before.lines !== shift.after.lines) {
        throw new Error("Unexpected line change when shifting source maps");
      }
      const shiftColumnDelta = shift.after.columns - shift.before.columns;
      j += encodeVLQ("", generatedColumnDelta + shiftColumnDelta - prevShiftColumnDelta);
      prevShiftColumnDelta = shiftColumnDelta;

      // Finally, start the next run after the end of this generated column offset
      startOfRun = potentialStartOfRun;
    }

    // Finish the source map
    j += mappings.slice(startOfRun);
    j += pieces.suffix;
    return j;
  }
}

export class SourceMapShift {
  constructor(before = new LineColumnOffset(), after = new LineColumnOffset()) {
    this.before = before;
    this.after = after;
  }
}

// Coordinates in source maps are stored using relative offsets for size
// reasons. When joining together chunks of a source map that were emitted
// in parallel for different parts of a file, we need to fix up the first
// segment of each chunk to be relative to the end of the previous chunk.
export class SourceMapState {
  constructor(
    generatedLine = 0,
    generatedColumn = 0,
    sourceIndex = 0,
    originalLine = 0,
    originalColumn = 0,
    originalName = 0,
    hasOriginalName = false,
  ) {
    // This isn't stored in the source map. It's only used by the bundler to join
    // source map chunks together correctly.
    this.generatedLine = generatedLine;

    // These are stored in the source map in VLQ format.
    this.generatedColumn = generatedColumn;
    this.sourceIndex = sourceIndex;
    this.originalLine = originalLine;
    this.originalColumn = originalColumn;
    this.originalName = originalName;
    this.hasOriginalName = hasOriginalName;
  }

  clone() {
    return new SourceMapState(
      this.generatedLine,
      this.generatedColumn,
      this.sourceIndex,
      this.originalLine,
      this.originalColumn,
      this.originalName,
      this.hasOriginalName,
    );
  }
}

// Source map chunks are computed in parallel for speed. Each chunk is relative
// to the zero state instead of being relative to the end state of the previous
// chunk, since it's impossible to know the end state of the previous chunk in
// a parallel computation.
//
// After all chunks are computed, they are joined together in a second pass.
// This rewrites the first mapping in each chunk to be relative to the end
// state of the previous chunk.
//
// "j" is a helpers.Joiner. The states are passed by value in Go, so they are
// copied here before being modified.
export function appendSourceMapChunk(j, prevEndState, startState, buffer) {
  prevEndState = prevEndState.clone();
  startState = startState.clone();
  const data = buffer.data;

  // Handle line breaks in between this mapping and the previous one
  if (startState.generatedLine !== 0) {
    j.addBytes(";".repeat(startState.generatedLine));
    prevEndState.generatedColumn = 0;
  }

  // Skip past any leading semicolons, which indicate line breaks
  let semicolons = 0;
  while (data.charCodeAt(semicolons) === 59 /* ';' */) {
    semicolons++;
  }
  if (semicolons > 0) {
    j.addBytes(data.slice(0, semicolons));
    prevEndState.generatedColumn = 0;
    startState.generatedColumn = 0;
  }

  // Strip off the first mapping from the buffer. The first mapping should be
  // for the start of the original file (the printer always generates one for
  // the start of the file).
  //
  // Note that we do not want to strip off the original name, even though it
  // could be a part of the first mapping. This will be handled using a special
  // case below instead. Original names are optional and are often omitted, so
  // we handle it uniformly by saving an index to the first original name,
  // which may or may not be a part of the first mapping.
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let omitSource = false;
  const $d231 = decodeVLQ(data, semicolons);
  let generatedColumn = $d231[0], i = $d231[1];
  if (i === data.length || data.charCodeAt(i) === 44 /* ',' */ || data.charCodeAt(i) === 59 /* ';' */) {
    omitSource = true;
  } else {
    [sourceIndex, i] = decodeVLQ(data, i);
    [originalLine, i] = decodeVLQ(data, i);
    [originalColumn, i] = decodeVLQ(data, i);
  }

  // Rewrite the first mapping to be relative to the end state of the previous
  // chunk. We now know what the end state is because we're in the second pass
  // where all chunks have already been generated.
  startState.generatedColumn += generatedColumn;
  startState.sourceIndex += sourceIndex;
  startState.originalLine += originalLine;
  startState.originalColumn += originalColumn;
  prevEndState.hasOriginalName = false; // This is handled separately below
  const rewritten = appendMappingToBuffer("", j.lastByte, prevEndState, startState, omitSource);
  j.addBytes(rewritten);

  // Next, if there's an original name, we need to rewrite that as well to be
  // relative to that of the previous chunk.
  if (buffer.firstNameOffset >= 0) {
    const before = buffer.firstNameOffset;
    const $d232 = decodeVLQ(data, before);
    let originalName = $d232[0], after = $d232[1];
    originalName += startState.originalName - prevEndState.originalName;
    j.addBytes(data.slice(i, before));
    j.addBytes(encodeVLQ("", originalName));
    j.addBytes(data.slice(after));
    return;
  }

  // Otherwise, just append everything after that without modification
  j.addBytes(data.slice(i));
}

// Side channel for appendMappingToBuffer's second result (the name offset,
// an ast.Index32: -1 if there is no name). Avoids allocating a pair per mapping.
let appendedNameOffset = -1;

// Go returns (buffer, nameOffset); this returns the new buffer string and
// stores the name offset in "appendedNameOffset".
function appendMappingToBuffer(buffer, lastByte, prevState, currentState, omitSource) {
  // Put commas in between mappings
  if (lastByte !== 0 && lastByte !== 59 /* ';' */ && lastByte !== 34 /* '"' */) {
    buffer += ",";
  }

  // Record the mapping (note that the generated line is recorded using ';' elsewhere)
  buffer = encodeVLQ(buffer, currentState.generatedColumn - prevState.generatedColumn);
  if (!omitSource) {
    buffer = encodeVLQ(buffer, currentState.sourceIndex - prevState.sourceIndex);
    buffer = encodeVLQ(buffer, currentState.originalLine - prevState.originalLine);
    buffer = encodeVLQ(buffer, currentState.originalColumn - prevState.originalColumn);
  }

  // Record the optional original name
  let nameOffset = -1;
  if (currentState.hasOriginalName) {
    nameOffset = buffer.length;
    buffer = encodeVLQ(buffer, currentState.originalName - prevState.originalName);
  }

  appendedNameOffset = nameOffset;
  return buffer;
}

// The same as encodeVLQ, but writes the digits into the byte buffer "buf" at
// "pos" (which must have room for 7 more bytes) and returns the new position
const base64Bytes = new Uint8Array(64);
for (let i = 0; i < 64; i++) base64Bytes[i] = base64.charCodeAt(i);
function writeVLQ(buf, pos, value) {
  let vlq;
  if (value < 0) {
    vlq = (-value * 2) | 1;
  } else {
    vlq = value * 2;
  }

  // Handle the common case
  if (vlq >>> 5 === 0) {
    buf[pos] = base64Bytes[vlq];
    return pos + 1;
  }

  for (;;) {
    let digit = vlq & 31;
    vlq >>>= 5;

    // If there are still more digits in this value, we must make sure the
    // continuation bit is marked
    if (vlq !== 0) {
      digit |= 32;
    }

    buf[pos++] = base64Bytes[digit];

    if (vlq === 0) {
      break;
    }
  }
  return pos;
}

let asciiDecoder = null;

// The length in bytes of the rune starting at output[i] (utf8.DecodeRune:
// an invalid sequence is a single byte)
function utf8RuneSize(p, i, n) {
  const b0 = p[i];
  if (b0 < 0x80) return 1;
  if (b0 >= 0xc2 && b0 <= 0xdf) {
    return i + 1 < n && (p[i + 1] & 0xc0) === 0x80 ? 2 : 1;
  }
  if (b0 >= 0xe0 && b0 <= 0xef) {
    if (i + 2 >= n) return 1;
    const b1 = p[i + 1];
    const lo = b0 === 0xe0 ? 0xa0 : 0x80;
    const hi = b0 === 0xed ? 0x9f : 0xbf;
    return b1 >= lo && b1 <= hi && (p[i + 2] & 0xc0) === 0x80 ? 3 : 1;
  }
  if (b0 >= 0xf0 && b0 <= 0xf4) {
    if (i + 3 >= n) return 1;
    const b1 = p[i + 1];
    const lo = b0 === 0xf0 ? 0x90 : 0x80;
    const hi = b0 === 0xf4 ? 0x8f : 0xbf;
    return b1 >= lo && b1 <= hi && (p[i + 2] & 0xc0) === 0x80 && (p[i + 3] & 0xc0) === 0x80 ? 4 : 1;
  }
  return 1;
}

// Line terminators other than "\n"
const otherLineTerminators = new RegExp("[\\r" + String.fromCharCode(0x2028, 0x2029) + "]");

// Go: GenerateLineOffsetTables(contents, approximateLineCount) []LineOffsetTable.
// Returns the UTF-16 offset of the start of each line (see the comment at the
// top). Lines end at "\n", "\r" (except in "\r\n"), U+2028 and U+2029.
export function generateLineOffsetTables(contents, approximateLineCount) {
  const n = contents.length;
  let starts = new Int32Array(approximateLineCount > 0 ? approximateLineCount + 1 : 16);
  let count = 1; // starts[0] = 0

  // Fast path: "\n" is the only line terminator
  if (!otherLineTerminators.test(contents)) {
    for (let i = contents.indexOf("\n"); i !== -1; i = contents.indexOf("\n", i + 1)) {
      if (count === starts.length) {
        const grown = new Int32Array(starts.length * 2);
        grown.set(starts);
        starts = grown;
      }
      starts[count++] = i + 1;
    }
    return starts.subarray(0, count);
  }

  for (let i = 0; i < n; i++) {
    const c = contents.charCodeAt(i);
    if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) {
      // Handle Windows-specific "\r\n" newlines
      if (c === 13 && i + 1 < n && contents.charCodeAt(i + 1) === 10) {
        continue;
      }

      if (count === starts.length) {
        const grown = new Int32Array(starts.length * 2);
        grown.set(starts);
        starts = grown;
      }
      starts[count++] = i + 1;
    }
  }

  return starts.subarray(0, count);
}

// helpers.QuoteForJSON(text, asciiOnly) for long texts (the source contents):
// the same escapes as helpers.quoteForJSON (Go's internalQuote with '"'), but
// written as UTF-8 bytes into a reused buffer and decoded once, which is much
// faster than building a string for large (in particular two-byte) texts.
let quoteBuffer = null;
const utf8Decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const hexDigitCodes = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 65, 66, 67, 68, 69, 70]; // "0123456789ABCDEF"
export function quoteForJSONLong(text, asciiOnly) {
  const n = text.length;
  let buf = quoteBuffer;
  // (Grown below when needed: an escape is at most 12 bytes per code unit pair)
  if (buf === null || buf.length < n + 64) buf = new Uint8Array(Math.max(1 << 16, n + (n >> 3) + 64));
  let cap = buf.length - 16;
  let len = 0;
  buf[len++] = 34; // '"'
  for (let i = 0; i < n; i++) {
    if (len > cap) {
      const grown = new Uint8Array(buf.length * 2);
      grown.set(buf.subarray(0, len));
      buf = grown;
      cap = buf.length - 16;
    }
    const c = text.charCodeAt(i);

    // canPrintWithoutEscape: printable ASCII other than '\\' and '"'
    if (c >= 0x20 && c <= 0x7e) {
      if (c === 92 || c === 34) {
        buf[len++] = 92;
      }
      buf[len++] = c;
      continue;
    }

    // canPrintWithoutEscape: non-ASCII other than U+FEFF and surrogates (a
    // surrogate pair is a code point above 0xFFFF, which is printed too)
    if (c >= 0x7f && !asciiOnly && c !== 0xfeff) {
      if (c < 0x80) {
        buf[len++] = c;
        continue;
      }
      if (c < 0x800) {
        buf[len++] = 0xc0 | (c >> 6);
        buf[len++] = 0x80 | (c & 63);
        continue;
      }
      if (c < 0xd800 || c > 0xdfff) {
        buf[len++] = 0xe0 | (c >> 12);
        buf[len++] = 0x80 | ((c >> 6) & 63);
        buf[len++] = 0x80 | (c & 63);
        continue;
      }
      if (c <= 0xdbff && i + 1 < n) {
        const c2 = text.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          const r = ((c - 0xd800) << 10) + (c2 - 0xdc00) + 0x10000;
          buf[len++] = 0xf0 | (r >> 18);
          buf[len++] = 0x80 | ((r >> 12) & 63);
          buf[len++] = 0x80 | ((r >> 6) & 63);
          buf[len++] = 0x80 | (r & 63);
          i++;
          continue;
        }
      }
      // (a lone surrogate is escaped below)
    }

    switch (c) {
      case 8:
        buf[len++] = 92;
        buf[len++] = 98; // "\\b"
        continue;
      case 12:
        buf[len++] = 92;
        buf[len++] = 102; // "\\f"
        continue;
      case 10:
        buf[len++] = 92;
        buf[len++] = 110; // "\\n"
        continue;
      case 13:
        buf[len++] = 92;
        buf[len++] = 114; // "\\r"
        continue;
      case 9:
        buf[len++] = 92;
        buf[len++] = 116; // "\\t"
        continue;
    }

    // "\\uXXXX" (a surrogate pair with asciiOnly becomes two of these, like
    // Go's UTF-16 encoding of code points above 0xFFFF)
    buf[len++] = 92;
    buf[len++] = 117;
    buf[len++] = hexDigitCodes[c >> 12];
    buf[len++] = hexDigitCodes[(c >> 8) & 15];
    buf[len++] = hexDigitCodes[(c >> 4) & 15];
    buf[len++] = hexDigitCodes[c & 15];
  }
  buf[len++] = 34; // '"'
  const quoted = utf8Decoder.decode(buf.subarray(0, len));
  // (Keep a moderately sized buffer for the next call)
  quoteBuffer = buf.length <= 1 << 20 ? buf : null;
  return quoted;
}

export class MappingsBuffer {
  constructor(data = "", firstNameOffset = -1) {
    this.data = data; // string (Go: []byte)
    this.firstNameOffset = firstNameOffset; // ast.Index32 (-1 = invalid)
  }
}

export class Chunk {
  constructor(buffer = new MappingsBuffer(), quotedNames = null, endState = new SourceMapState(), finalGeneratedColumn = 0, shouldIgnore = false) {
    this.buffer = buffer;
    this.quotedNames = quotedNames; // []string (Go: [][]byte), may be null

    // This end state will be used to rewrite the start of the following source
    // map chunk so that the delta-encoded VLQ numbers are preserved.
    this.endState = endState;

    // There probably isn't a source mapping at the end of the file (nor should
    // there be) but if we're appending another source map chunk after this one,
    // we'll need to know how many characters were in the last line we generated.
    this.finalGeneratedColumn = finalGeneratedColumn;

    this.shouldIgnore = shouldIgnore;
  }
}

export class ChunkBuilder {
  // Go: MakeChunkBuilder(inputSourceMap, lineOffsetTables, asciiOnly)
  constructor(inputSourceMap, lineOffsetTables, asciiOnly) {
    this.inputSourceMap = inputSourceMap;
    this.sourceMap = new Uint8Array(1024); // Go: []byte (the bytes before sourceMapLen)
    this.sourceMapLen = 0;
    this.quotedNames = null; // [][]byte (nil until the first name)
    this.namesMap = new Map();
    this.lineOffsetTables = lineOffsetTables; // Int32Array of line starts
    this.prevOriginalName = "";
    this.prevState = new SourceMapState();
    // JS-only: the line found by the previous lookup (see addSourceMapping)
    // and a reusable state for the mapping being appended
    this.prevOriginalLine = 0;
    this.scratchState = new SourceMapState();
    this.lastGeneratedUpdate = 0;
    this.generatedColumn = 0;
    this.prevGeneratedLen = 0;
    this.prevOriginalLoc = -1;
    this.firstNameOffset = -1;
    this.hasPrevState = false;
    this.asciiOnly = asciiOnly;

    // This is a workaround for a bug in the popular "source-map" library:
    // https://github.com/mozilla/source-map/issues/261. The library will
    // sometimes return null when querying a source map unless every line
    // starts with a mapping at column zero.
    //
    // The workaround is to replicate the previous mapping if a line ends
    // up not starting with a mapping. This is done lazily because we want
    // to avoid replicating the previous mapping if we don't need to.
    this.lineStartsWithMapping = false;

    // We automatically repeat the previous source mapping if we ever generate
    // a line that doesn't start with a mapping. This helps give files more
    // complete mapping coverage without gaps.
    //
    // However, we probably shouldn't do this if the input file has a nested
    // source map that we will be remapping through. We have no idea what state
    // that source map is in and it could be pretty scrambled.
    //
    // I've seen cases where blindly repeating the last mapping for subsequent
    // lines gives very strange and unhelpful results with source maps from
    // other tools.
    this.coverLinesWithoutMappings = inputSourceMap === null;
  }

  // "output"/"outputLen": the printer's UTF-16 buffer and its used length
  addSourceMapping(originalLoc, originalName, output, outputLen) {
    const b = this;

    // Avoid generating duplicate mappings
    if (originalLoc === b.prevOriginalLoc && (b.prevGeneratedLen === outputLen || b.prevOriginalName === originalName)) {
      return;
    }

    b.prevOriginalLoc = originalLoc;
    b.prevGeneratedLen = outputLen;
    b.prevOriginalName = originalName;

    // Binary search to find the line (the last line starting at or before
    // "originalLoc"). JS-only shortcut: the line starts are strictly
    // increasing, so if the previous result still satisfies that condition it
    // is the answer (mappings mostly move forward through the file).
    const lineOffsetTables = b.lineOffsetTables;
    let originalLine = b.prevOriginalLine;
    if (
      !(
        lineOffsetTables[originalLine] <= originalLoc &&
        (originalLine + 1 === lineOffsetTables.length || lineOffsetTables[originalLine + 1] > originalLoc)
      )
    ) {
      let count = lineOffsetTables.length;
      originalLine = 0;
      while (count > 0) {
        const step = count >>> 1;
        const i = originalLine + step;
        if (lineOffsetTables[i] <= originalLoc) {
          originalLine = i + 1;
          count = count - step - 1;
        } else {
          count = step;
        }
      }
      originalLine--;
      b.prevOriginalLine = originalLine < 0 ? 0 : originalLine;
    }

    // Use the line to compute the column
    const originalColumn = originalLoc - lineOffsetTables[originalLine];

    b.updateGeneratedLineAndColumn(output, outputLen);

    // If this line doesn't start with a mapping and we're about to add a mapping
    // that's not at the start, insert a mapping first so the line starts with one.
    if (b.coverLinesWithoutMappings && !b.lineStartsWithMapping && b.generatedColumn > 0 && b.hasPrevState) {
      b.appendMappingWithoutRemapping(
        b.scratch(b.prevState.generatedLine, 0, b.prevState.sourceIndex, b.prevState.originalLine, b.prevState.originalColumn),
      );
    }

    b.appendMapping(originalName, b.scratch(b.prevState.generatedLine, b.generatedColumn, 0, originalLine, originalColumn));

    // This line now has a mapping on it, so don't insert another one
    b.lineStartsWithMapping = true;
  }

  // Go's "SourceMapState{...}" literal for a mapping that is about to be
  // appended (its fields are copied into b.prevState, so one object is reused)
  scratch(generatedLine, generatedColumn, sourceIndex, originalLine, originalColumn) {
    const s = this.scratchState;
    s.generatedLine = generatedLine;
    s.generatedColumn = generatedColumn;
    s.sourceIndex = sourceIndex;
    s.originalLine = originalLine;
    s.originalColumn = originalColumn;
    s.originalName = 0;
    s.hasOriginalName = false;
    return s;
  }

  generateChunk(output, outputLen) {
    const b = this;
    b.updateGeneratedLineAndColumn(output, outputLen);
    let shouldIgnore = true;
    const sourceMap = b.sourceMap;
    for (let i = 0, n = b.sourceMapLen; i < n; i++) {
      if (sourceMap[i] !== 59 /* ';' */) {
        shouldIgnore = false;
        break;
      }
    }
    // (The mappings are ASCII, so decoding them as UTF-8 is exact)
    if (asciiDecoder === null) asciiDecoder = new TextDecoder();
    const data = asciiDecoder.decode(sourceMap.subarray(0, b.sourceMapLen));
    return new Chunk(new MappingsBuffer(data, b.firstNameOffset), b.quotedNames, b.prevState, b.generatedColumn, shouldIgnore);
  }

  // Makes room for "n" more bytes in b.sourceMap and returns it
  reserveSourceMap(n) {
    const b = this;
    let buf = b.sourceMap;
    if (b.sourceMapLen + n > buf.length) {
      let size = buf.length * 2;
      while (size < b.sourceMapLen + n) size *= 2;
      const grown = new Uint8Array(size);
      grown.set(buf.subarray(0, b.sourceMapLen));
      b.sourceMap = buf = grown;
    }
    return buf;
  }

  // Scan over the printed text since the last source mapping and update the
  // generated line and column numbers. "output" holds UTF-8 bytes (Go ranges
  // over the runes of string(output[...]); an invalid byte is one U+FFFD).
  updateGeneratedLineAndColumn(output, outputLen) {
    const b = this;
    let generatedColumn = b.generatedColumn;
    for (let i = b.lastGeneratedUpdate; i < outputLen; i++) {
      let c = output[i];
      if (c >= 0x80) {
        // Decode the rune (only U+2028/U+2029 and the UTF-16 length matter)
        const size = utf8RuneSize(output, i, outputLen);
        if (size === 3 && c === 0xe2 && output[i + 1] === 0x80 && (output[i + 2] === 0xa8 || output[i + 2] === 0xa9)) {
          c = output[i + 2] === 0xa8 ? 0x2028 : 0x2029;
        } else {
          // Mozilla's "source-map" library counts columns using UTF-16 code units
          generatedColumn += size === 4 ? 2 : 1;
        }
        i += size - 1;
        if (c < 0x2028) continue;
      }
      if (c === 13 || c === 10 || c === 0x2028 || c === 0x2029) {
        // Handle Windows-specific "\r\n" newlines
        if (c === 13) {
          const newlineCheck = i + 1;
          if (newlineCheck < outputLen && output[newlineCheck] === 10) {
            continue;
          }
        }

        // If we're about to move to the next line and the previous line didn't have
        // any mappings, add a mapping at the start of the previous line.
        if (b.coverLinesWithoutMappings && !b.lineStartsWithMapping && b.hasPrevState) {
          b.appendMappingWithoutRemapping(
            b.scratch(b.prevState.generatedLine, 0, b.prevState.sourceIndex, b.prevState.originalLine, b.prevState.originalColumn),
          );
        }

        b.prevState.generatedLine++;
        b.prevState.generatedColumn = 0;
        generatedColumn = 0;
        b.reserveSourceMap(1)[b.sourceMapLen++] = 59; // ';'

        // This new line doesn't have a mapping yet
        b.lineStartsWithMapping = false;
      } else {
        // Mozilla's "source-map" library counts columns using UTF-16 code units
        generatedColumn++;
      }
    }
    b.generatedColumn = generatedColumn;

    b.lastGeneratedUpdate = outputLen;
  }

  appendMapping(originalName, currentState) {
    const b = this;

    // If the input file had a source map, map all the way back to the original
    if (b.inputSourceMap !== null) {
      const mapping = b.inputSourceMap.find(currentState.originalLine, currentState.originalColumn);

      // Some locations won't have a mapping
      if (mapping === null) {
        return;
      }

      currentState.sourceIndex = mapping.sourceIndex;
      currentState.originalLine = mapping.originalLine;
      currentState.originalColumn = mapping.originalColumn;

      // Map all the way back to the original name if present. Otherwise, keep
      // the original name from esbuild, which corresponds to the name in the
      // intermediate source code. This is important for tools that only emit
      // a name mapping when the name is different than the original name.
      if (mapping.originalName >= 0) {
        originalName = b.inputSourceMap.names[mapping.originalName];
      }
    }

    // Optionally reference the original name
    if (originalName !== "") {
      let i = b.namesMap.get(originalName);
      if (i === undefined) {
        if (b.quotedNames === null) b.quotedNames = [];
        i = b.quotedNames.length;
        b.quotedNames.push(quoteForJSON(originalName, b.asciiOnly));
        b.namesMap.set(originalName, i);
      }
      currentState.originalName = i;
      currentState.hasOriginalName = true;
    }

    b.appendMappingWithoutRemapping(currentState);
  }

  appendMappingWithoutRemapping(currentState) {
    const b = this;
    // (a comma and at most 5 VLQs of at most 7 digits each)
    const buf = b.reserveSourceMap(36);
    let pos = b.sourceMapLen;
    let lastByte = 0;
    if (pos !== 0) {
      lastByte = buf[pos - 1];
    }

    // appendMappingToBuffer(b.sourceMap, lastByte, b.prevState, currentState, false),
    // writing into the byte buffer:
    const prevState = b.prevState;

    // Put commas in between mappings
    if (lastByte !== 0 && lastByte !== 59 /* ';' */ && lastByte !== 34 /* '"' */) {
      buf[pos++] = 44; // ','
    }

    // Record the mapping (note that the generated line is recorded using ';' elsewhere)
    pos = writeVLQ(buf, pos, currentState.generatedColumn - prevState.generatedColumn);
    pos = writeVLQ(buf, pos, currentState.sourceIndex - prevState.sourceIndex);
    pos = writeVLQ(buf, pos, currentState.originalLine - prevState.originalLine);
    pos = writeVLQ(buf, pos, currentState.originalColumn - prevState.originalColumn);

    // Record the optional original name
    let nameOffset = -1;
    if (currentState.hasOriginalName) {
      nameOffset = pos;
      pos = writeVLQ(buf, pos, currentState.originalName - prevState.originalName);
    }
    b.sourceMapLen = pos;

    // Go: b.prevState = currentState (a struct copy: "currentState" is the
    // reused scratch state, so its fields are copied)
    const prevOriginalName = prevState.originalName;
    prevState.generatedLine = currentState.generatedLine;
    prevState.generatedColumn = currentState.generatedColumn;
    prevState.sourceIndex = currentState.sourceIndex;
    prevState.originalLine = currentState.originalLine;
    prevState.originalColumn = currentState.originalColumn;
    prevState.originalName = currentState.originalName;
    prevState.hasOriginalName = currentState.hasOriginalName;
    if (!currentState.hasOriginalName) {
      // Revert the original name change if it's invalid
      prevState.originalName = prevOriginalName;
    } else if (b.firstNameOffset < 0) {
      // Keep track of the first name offset so we can jump right to it later
      b.firstNameOffset = nameOffset;
    }
    b.hasPrevState = true;
  }
}
