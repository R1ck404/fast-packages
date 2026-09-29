// The parts of Go's standard library that esbuild's zipFS (fs_zip.go) uses
// to read Yarn PnP ".zip" archives: archive/zip's Reader (OpenReader,
// File.Open) and compress/flate's decompressor (inflate.go), plus
// hash/crc32 (IEEE). Go 1.26.5, which esbuild 0.28.2 is built with.
//
// Go's zip.Reader reads the archive lazily through an open *os.File. This
// port reads the whole archive once (the same bytes) and replays Go's
// ReaderAt/SectionReader/bufio semantics on them, so every error is Go's
// (the error texts reach esbuild's "Cannot read file" messages).
//
// Only what esbuild observes is kept: the names, the directory flag, the
// sizes/offsets/method/CRC-32 and the contents. (Timestamps, comments and
// the "NonUTF8" flag are never looked at.)
import { decodeGoString } from "./helpers.mjs";

// (errors.New and os.PathError: fs.mjs has the same classes, but fs.mjs
// imports this module)
class GoError {
  declare text: string;
  constructor(text: string) {
    this.text = text;
  }
  error(): string {
    return this.text;
  }
}
class PathError {
  declare op: string;
  declare path: string;
  declare err: GoError;
  constructor(op: string, path: string, err: GoError) {
    this.op = op;
    this.path = path;
    this.err = err;
  }
  error(): string {
    return this.op + " " + this.path + ": " + this.err.error();
  }
}

// io.EOF, io.ErrUnexpectedEOF and archive/zip's errors
export const EOF = new GoError("EOF");
export const ErrUnexpectedEOF = new GoError("unexpected EOF");
export const ErrFormat = new GoError("zip: not a valid zip file");
export const ErrAlgorithm = new GoError("zip: unsupported compression algorithm");
export const ErrChecksum = new GoError("zip: checksum error");

// ---------------------------------------------------------------------------
// hash/crc32 (IEEE)

let crcTable: Uint32Array | null = null;

function crc32IEEE(data: Uint8Array): number {
  let table = crcTable;
  if (table === null) {
    table = crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let crc = i;
      for (let j = 0; j < 8; j++) {
        if ((crc & 1) === 1) crc = (crc >>> 1) ^ 0xedb88320;
        else crc >>>= 1;
      }
      table[i] = crc >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// The archive's bytes as Go's *os.File (a ReaderAt)

class zipBytes {
  declare data: Uint8Array;
  declare name: string;
  constructor(data: Uint8Array, name: string) {
    this.data = data;
    this.name = name;
  }

  // os.File.ReadAt: [bytes, err] (the bytes that were read, io.EOF when
  // they are fewer than "n")
  readAt(n: number, off: number): [Uint8Array, any] {
    if (off < 0) {
      return [new Uint8Array(0), new PathError("readat", this.name, new GoError("negative offset"))];
    }
    const size = this.data.length;
    const start = off < size ? off : size;
    const end = off + n < size ? off + n : size;
    const got = this.data.subarray(start, end);
    return [got, got.length < n ? EOF : null];
  }
}

// A sequential stream over [off, limit) of the archive: an
// io.SectionReader read through Read (and through bufio, which only
// changes how many bytes each Read returns). Returns the bytes before the
// stream ends and the error that ends it (io.EOF at the limit or at the end
// of the file, or ReadAt's error).
function sectionStream(zr: zipBytes, off: number, n: number): [Uint8Array, any] {
  // io.NewSectionReader
  let limit: number;
  if (off <= Number.MAX_SAFE_INTEGER - n) limit = off + n;
  else limit = Number.MAX_SAFE_INTEGER;
  if (off >= limit) return [new Uint8Array(0), EOF];
  if (off < 0) return [new Uint8Array(0), new PathError("readat", zr.name, new GoError("negative offset"))];
  const r = zr.readAt(limit - off, off);
  return [r[0], EOF];
}

// A reader over a stream's bytes (io.ReadFull and friends)
class streamReader {
  declare bytes: Uint8Array;
  declare pos: number;
  declare endErr: any;
  constructor(stream: [Uint8Array, any]) {
    this.bytes = stream[0];
    this.pos = 0;
    this.endErr = stream[1];
  }

  // io.ReadFull: [bytes, err]
  readFull(n: number): [Uint8Array, any] {
    const avail = this.bytes.length - this.pos;
    if (avail >= n) {
      const out = this.bytes.subarray(this.pos, this.pos + n);
      this.pos += n;
      return [out, null];
    }
    const out = this.bytes.subarray(this.pos);
    this.pos = this.bytes.length;
    let err = this.endErr;
    if (out.length > 0 && err === EOF) err = ErrUnexpectedEOF;
    return [out, err];
  }
}

// readBuf
class readBuf {
  declare b: Uint8Array;
  declare i: number;
  constructor(b: Uint8Array) {
    this.b = b;
    this.i = 0;
  }
  get length(): number {
    return this.b.length - this.i;
  }
  uint8(): number {
    return this.b[this.i++];
  }
  uint16(): number {
    const v = this.b[this.i] | (this.b[this.i + 1] << 8);
    this.i += 2;
    return v;
  }
  uint32(): number {
    const b = this.b;
    const i = this.i;
    const v = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
    this.i += 4;
    return v;
  }
  // (a uint64 as a BigInt)
  uint64(): bigint {
    const lo = this.uint32();
    const hi = this.uint32();
    return (BigInt(hi) << 32n) | BigInt(lo);
  }
  skip(n: number) {
    this.i += n;
  }
  sub(n: number): readBuf {
    const b2 = new readBuf(this.b.subarray(this.i, this.i + n));
    this.i += n;
    return b2;
  }
}

// int64(x) of a uint64
function int64(x: bigint): number {
  return Number(BigInt.asIntN(64, x));
}

const fileHeaderSignature = 0x04034b50;
const directoryHeaderSignature = 0x02014b50;
const directory64LocSignature = 0x07064b50;
const directory64EndSignature = 0x06064b50;
const dataDescriptorSignature = 0x08074b50;
const fileHeaderLen = 30;
const directoryHeaderLen = 46;
const directoryEndLen = 22;
const dataDescriptorLen = 16;
const directory64LocLen = 20;
const directory64EndLen = 56;

const creatorFAT = 0;
const creatorUnix = 3;
const creatorNTFS = 11;
const creatorVFAT = 14;
const creatorMacOSX = 19;

const zip64ExtraID = 0x0001;

const Store = 0;
const Deflate = 8;

// ---------------------------------------------------------------------------
// archive/zip reader.go

export class ZipFile {
  declare name: string;
  declare creatorVersion: number;
  declare flags: number;
  declare method: number;
  declare crc32: number;
  declare compressedSize: number;
  declare uncompressedSize: number;
  declare compressedSize64: bigint;
  declare uncompressedSize64: bigint;
  declare externalAttrs: number;
  declare headerOffset: number; // int64 (includes the archive's baseOffset)
  declare zipr: zipBytes;
  constructor(zipr: zipBytes) {
    this.name = "";
    this.creatorVersion = 0;
    this.flags = 0;
    this.method = 0;
    this.crc32 = 0;
    this.compressedSize = 0;
    this.uncompressedSize = 0;
    this.compressedSize64 = 0n;
    this.uncompressedSize64 = 0n;
    this.externalAttrs = 0;
    this.headerOffset = 0;
    this.zipr = zipr;
  }

  // FileInfo().IsDir(): FileHeader.Mode() has fs.ModeDir
  isDir(): boolean {
    switch (this.creatorVersion >>> 8) {
      case creatorUnix:
      case creatorMacOSX:
        // unixModeToFileMode: s_IFDIR
        if (((this.externalAttrs >>> 16) & 0xf000) === 0x4000) return true;
        break;
      case creatorNTFS:
      case creatorVFAT:
      case creatorFAT:
        // msdosModeToFileMode: msdosDir
        if ((this.externalAttrs & 0x10) !== 0) return true;
        break;
    }
    return this.name.length > 0 && this.name.charCodeAt(this.name.length - 1) === 47;
  }

  hasDataDescriptor(): boolean {
    return (this.flags & 0x8) !== 0;
  }

  // findBodyOffset: [offset, err]
  findBodyOffset(): [number, any] {
    const r = this.zipr.readAt(fileHeaderLen, this.headerOffset);
    if (r[1] !== null) return [0, r[1]];
    const b = new readBuf(r[0]);
    if (b.uint32() !== fileHeaderSignature) return [0, ErrFormat];
    b.skip(22); // skip over most of the header
    const filenameLen = b.uint16();
    const extraLen = b.uint16();
    return [fileHeaderLen + filenameLen + extraLen, null];
  }

  // File.Open + ioutil.ReadAll: [contents, err] (esbuild ignores the
  // contents read before an error)
  readAll(): [Uint8Array | null, any] {
    const $b = this.findBodyOffset();
    if ($b[1] !== null) return [null, $b[1]];
    const bodyOffset = $b[0];
    if (this.name.endsWith("/")) {
      // (dirReader: esbuild never opens these, directories are not files)
      return [null, this.uncompressedSize64 !== 0n ? ErrFormat : null];
    }
    const size = int64(this.compressedSize64);
    const section = sectionStream(this.zipr, this.headerOffset + bodyOffset, size);

    // The decompressor's output and the error that ends it
    let out: Uint8Array;
    let err: any;
    if (this.method === Store) {
      out = section[0];
      err = section[1];
    } else if (this.method === Deflate) {
      const $i = inflate(section[0], section[1]);
      out = $i[0];
      err = $i[1];
    } else {
      return [null, ErrAlgorithm];
    }

    // checksumReader (the data comes before the error that ends it)
    if (BigInt(out.length) > this.uncompressedSize64) return [null, ErrFormat];
    if (err !== EOF) return [null, err];
    if (BigInt(out.length) !== this.uncompressedSize64) return [null, ErrUnexpectedEOF];
    if (this.hasDataDescriptor()) {
      const desr = new streamReader(sectionStream(this.zipr, this.headerOffset + bodyOffset + size, dataDescriptorLen));
      const err1 = readDataDescriptor(desr, this);
      if (err1 !== null) {
        return [null, err1 === EOF ? ErrUnexpectedEOF : err1];
      } else if (crc32IEEE(out) !== this.crc32) {
        return [null, ErrChecksum];
      }
    } else {
      // If there's not a data descriptor, we still compare
      // the CRC32 of what we've read against the file header
      // or TOC's CRC32, if it seems like it was set.
      if (this.crc32 !== 0 && crc32IEEE(out) !== this.crc32) {
        return [null, ErrChecksum];
      }
    }
    return [out, null];
  }
}

function readDataDescriptor(r: streamReader, f: ZipFile): any {
  const $1 = r.readFull(4);
  if ($1[1] !== null) return $1[1];
  const buf = new Uint8Array(12);
  buf.set($1[0]);
  let off = 0;
  if (new readBuf($1[0]).uint32() !== dataDescriptorSignature) {
    // No data descriptor signature. Keep these four bytes.
    off += 4;
  }
  const $2 = r.readFull(12 - off);
  if ($2[1] !== null) return $2[1];
  buf.set($2[0], off);
  if (new readBuf(buf).uint32() !== f.crc32) return ErrChecksum;
  return null;
}

// readDirectoryHeader
function readDirectoryHeader(f: ZipFile, r: streamReader): any {
  const $h = r.readFull(directoryHeaderLen);
  if ($h[1] !== null) return $h[1];
  const b = new readBuf($h[0]);
  if (b.uint32() !== directoryHeaderSignature) return ErrFormat;
  f.creatorVersion = b.uint16();
  b.uint16(); // ReaderVersion
  f.flags = b.uint16();
  f.method = b.uint16();
  b.uint16(); // ModifiedTime
  b.uint16(); // ModifiedDate
  f.crc32 = b.uint32();
  f.compressedSize = b.uint32();
  f.uncompressedSize = b.uint32();
  f.compressedSize64 = BigInt(f.compressedSize);
  f.uncompressedSize64 = BigInt(f.uncompressedSize);
  const filenameLen = b.uint16();
  const extraLen = b.uint16();
  const commentLen = b.uint16();
  b.skip(4); // skipped start disk number and internal attributes (2x uint16)
  f.externalAttrs = b.uint32();
  f.headerOffset = b.uint32();
  const $d = r.readFull(filenameLen + extraLen + commentLen);
  if ($d[1] !== null) return $d[1];
  const d = $d[0];
  f.name = decodeGoString(d.subarray(0, filenameLen));
  const extraBytes = d.subarray(filenameLen, filenameLen + extraLen);

  let needUSize = f.uncompressedSize === 0xffffffff;
  let needCSize = f.compressedSize === 0xffffffff;
  let needHeaderOffset = f.headerOffset === 0xffffffff;

  // Best effort to find what we need.
  // Other zip authors might not even follow the basic format,
  // and we'll just ignore the Extra content in that case.
  // (Only the zip64 field matters here: the others hold timestamps.)
  for (const extra = new readBuf(extraBytes); extra.length >= 4; ) {
    const fieldTag = extra.uint16();
    const fieldSize = extra.uint16();
    if (extra.length < fieldSize) {
      break;
    }
    const fieldBuf = extra.sub(fieldSize);

    if (fieldTag === zip64ExtraID) {
      // update directory values from the zip64 extra block.
      // They should only be consulted if the sizes read earlier
      // are maxed out.
      // See golang.org/issue/13367.
      if (needUSize) {
        needUSize = false;
        if (fieldBuf.length < 8) {
          return ErrFormat;
        }
        f.uncompressedSize64 = fieldBuf.uint64();
      }
      if (needCSize) {
        needCSize = false;
        if (fieldBuf.length < 8) {
          return ErrFormat;
        }
        f.compressedSize64 = fieldBuf.uint64();
      }
      if (needHeaderOffset) {
        needHeaderOffset = false;
        if (fieldBuf.length < 8) {
          return ErrFormat;
        }
        f.headerOffset = int64(fieldBuf.uint64());
      }
    }
  }

  if (needCSize || needHeaderOffset) {
    return ErrFormat;
  }
  return null;
}

class directoryEnd {
  declare directoryRecords: bigint;
  declare directorySize: bigint;
  declare directoryOffset: bigint;
  constructor(directoryRecords: bigint, directorySize: bigint, directoryOffset: bigint) {
    this.directoryRecords = directoryRecords;
    this.directorySize = directorySize;
    this.directoryOffset = directoryOffset;
  }
}

function findSignatureInBlock(b: Uint8Array): number {
  for (let i = b.length - directoryEndLen; i >= 0; i--) {
    // defined from directoryEndSignature in struct.go
    if (b[i] === 80 && b[i + 1] === 75 && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
      // n is length of comment
      const n = b[i + directoryEndLen - 2] | (b[i + directoryEndLen - 1] << 8);
      if (n + directoryEndLen + i > b.length) {
        // Truncated comment.
        return -1;
      }
      return i;
    }
  }
  return -1;
}

// readDirectoryEnd: [dir, baseOffset, err]
function readDirectoryEnd(r: zipBytes, size: number): [directoryEnd | null, number, any] {
  // look for directoryEndSignature in the last 1k, then in the last 65k
  let buf: Uint8Array = new Uint8Array(0);
  let directoryEndOffset = 0;
  const lens = [1024, 65 * 1024];
  for (let i = 0; i < lens.length; i++) {
    let bLen = lens[i];
    if (bLen > size) {
      bLen = size;
    }
    const $r = r.readAt(bLen, size - bLen);
    if ($r[1] !== null && $r[1] !== EOF) return [null, 0, $r[1]];
    buf = new Uint8Array(bLen);
    buf.set($r[0]);
    const p = findSignatureInBlock(buf);
    if (p >= 0) {
      buf = buf.subarray(p);
      directoryEndOffset = size - bLen + p;
      break;
    }
    if (i === 1 || bLen === size) {
      return [null, 0, ErrFormat];
    }
  }

  // read header into struct
  const b = new readBuf(buf.subarray(4)); // skip signature
  b.uint16(); // diskNbr
  b.uint16(); // dirDiskNbr
  b.uint16(); // dirRecordsThisDisk
  const d = new directoryEnd(BigInt(b.uint16()), BigInt(b.uint32()), BigInt(b.uint32()));
  const l = b.uint16(); // commentLen
  if (l > b.length) {
    return [null, 0, new GoError("zip: invalid comment length")];
  }

  // These values mean that the file can be a zip64 file
  if (d.directoryRecords === 0xffffn || d.directorySize === 0xffffn || d.directoryOffset === 0xffffffffn) {
    let $p = findDirectory64End(r, directoryEndOffset);
    let err = $p[1];
    if (err === null && $p[0] >= 0) {
      directoryEndOffset = $p[0];
      err = readDirectory64End(r, $p[0], d);
    }
    if (err !== null) {
      return [null, 0, err];
    }
  }

  const maxInt64 = (1n << 63n) - 1n;
  if (d.directorySize > maxInt64 || d.directoryOffset > maxInt64) {
    return [null, 0, ErrFormat];
  }

  let baseOffset = directoryEndOffset - Number(d.directorySize) - Number(d.directoryOffset);

  // Make sure directoryOffset points to somewhere in our file.
  const o = baseOffset + Number(d.directoryOffset);
  if (o < 0 || o >= size) {
    return [null, 0, ErrFormat];
  }

  // If the directory end data tells us to use a non-zero baseOffset,
  // but we would find a valid directory entry if we assume that the
  // baseOffset is 0, then just use a baseOffset of 0.
  // We've seen files in which the directory end data gives us
  // an incorrect baseOffset.
  if (baseOffset > 0) {
    const off = Number(d.directoryOffset);
    const rs = new streamReader(sectionStream(r, off, size - off));
    if (readDirectoryHeader(new ZipFile(r), rs) === null) {
      baseOffset = 0;
    }
  }

  return [d, baseOffset, null];
}

// findDirectory64End: [offset, err]
function findDirectory64End(r: zipBytes, directoryEndOffset: number): [number, any] {
  const locOffset = directoryEndOffset - directory64LocLen;
  if (locOffset < 0) {
    return [-1, null]; // no need to look for a header outside the file
  }
  const $r = r.readAt(directory64LocLen, locOffset);
  if ($r[1] !== null) return [-1, $r[1]];
  const b = new readBuf($r[0]);
  if (b.uint32() !== directory64LocSignature) {
    return [-1, null];
  }
  if (b.uint32() !== 0) {
    // number of the disk with the start of the zip64 end of central directory
    return [-1, null]; // the file is not a valid zip64-file
  }
  const p = b.uint64(); // relative offset of the zip64 end of central directory record
  if (b.uint32() !== 1) {
    // total number of disks
    return [-1, null]; // the file is not a valid zip64-file
  }
  return [int64(p), null];
}

function readDirectory64End(r: zipBytes, offset: number, d: directoryEnd): any {
  const $r = r.readAt(directory64EndLen, offset);
  if ($r[1] !== null) return $r[1];
  const b = new readBuf($r[0]);
  if (b.uint32() !== directory64EndSignature) {
    return ErrFormat;
  }
  b.skip(12); // skip dir size, version and version needed (uint64 + 2x uint16)
  b.uint32(); // number of this disk
  b.uint32(); // number of the disk with the start of the central directory
  b.uint64(); // total number of entries in the central directory on this disk
  d.directoryRecords = b.uint64(); // total number of entries in the central directory
  d.directorySize = b.uint64(); // size of the central directory
  d.directoryOffset = b.uint64(); // offset of start of central directory with respect to the starting disk number
  return null;
}

// zip.OpenReader (after os.Open and Stat, which the caller did by reading
// the file): [files, err]
export function openZipReader(data: Uint8Array, name: string): [ZipFile[] | null, any] {
  const rdr = new zipBytes(data, name);
  const size = data.length;
  const $e = readDirectoryEnd(rdr, size);
  if ($e[2] !== null) return [null, $e[2]];
  const end = $e[0] as directoryEnd;
  const baseOffset = $e[1];
  const files: ZipFile[] = [];
  const start = baseOffset + Number(end.directoryOffset);
  const buf = new streamReader(sectionStream(rdr, start, size - start));

  // The count of files inside a zip is truncated to fit in a uint16.
  // Gloss over this by reading headers until we encounter
  // a bad one, and then only report an ErrFormat or UnexpectedEOF if
  // the file count modulo 65536 is incorrect.
  let err: any;
  for (;;) {
    const f = new ZipFile(rdr);
    err = readDirectoryHeader(f, buf);
    if (err === ErrFormat || err === ErrUnexpectedEOF) {
      break;
    }
    if (err !== null) {
      return [null, err];
    }
    f.headerOffset += baseOffset;
    files.push(f);
  }
  if ((files.length & 0xffff) !== Number(end.directoryRecords & 0xffffn)) {
    // Return the readDirectoryHeader error if we read
    // the wrong number of directory entries.
    return [null, err];
  }
  return [files, null];
}

// ---------------------------------------------------------------------------
// compress/flate inflate.go

const maxCodeLen = 16; // max length of Huffman code
const maxNumLit = 286;
const maxNumDist = 30;
const numCodes = 19; // number of codes in Huffman meta-code
const endBlockMarker = 256;

const huffmanChunkBits = 9;
const huffmanNumChunks = 1 << huffmanChunkBits;
const huffmanCountMask = 15;
const huffmanValueShift = 4;

function corruptInputError(offset: number): GoError {
  return new GoError("flate: corrupt input before offset " + offset);
}

function reverse16(x: number): number {
  let r = 0;
  for (let i = 0; i < 16; i++) {
    r = (r << 1) | ((x >>> i) & 1);
  }
  return r;
}

function reverse8(x: number): number {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    r = (r << 1) | ((x >>> i) & 1);
  }
  return r;
}

class huffmanDecoder {
  declare min: number; // the minimum code length
  declare chunks: Uint32Array; // chunks as described above
  declare links: Uint32Array[]; // overflow links
  declare linkMask: number; // mask the width of the link table
  constructor() {
    this.min = 0;
    this.chunks = new Uint32Array(huffmanNumChunks);
    this.links = [];
    this.linkMask = 0;
  }

  // Initialize Huffman decoding tables from array of code lengths.
  init(lengths: Int32Array): boolean {
    if (this.min !== 0) {
      this.min = 0;
      this.chunks = new Uint32Array(huffmanNumChunks);
      this.links = [];
      this.linkMask = 0;
    }

    // Count number of codes of each length,
    // compute min and max length.
    const count = new Int32Array(maxCodeLen);
    let min = 0;
    let max = 0;
    for (let i = 0; i < lengths.length; i++) {
      const n = lengths[i];
      if (n === 0) {
        continue;
      }
      if (min === 0 || n < min) {
        min = n;
      }
      if (n > max) {
        max = n;
      }
      count[n]++;
    }

    // Empty tree. The decompressor.huffSym function will fail later if the tree
    // is used.
    if (max === 0) {
      return true;
    }

    let code = 0;
    const nextcode = new Int32Array(maxCodeLen);
    for (let i = min; i <= max; i++) {
      code <<= 1;
      nextcode[i] = code;
      code += count[i];
    }

    // Check that the coding is complete (i.e., that we've
    // assigned all 2-to-the-max possible bit sequences).
    // Exception: To be compatible with zlib, we also need to
    // accept degenerate single-code codings.
    if (code !== 1 << max && !(code === 1 && max === 1)) {
      return false;
    }

    this.min = min;
    if (max > huffmanChunkBits) {
      const numLinks = 1 << (max - huffmanChunkBits);
      this.linkMask = numLinks - 1;

      // create link tables
      const link = nextcode[huffmanChunkBits + 1] >> 1;
      this.links = new Array(huffmanNumChunks - link);
      for (let j = link; j < huffmanNumChunks; j++) {
        let reverse = reverse16(j);
        reverse >>= 16 - huffmanChunkBits;
        const off = j - link;
        this.chunks[reverse] = (off << huffmanValueShift) | (huffmanChunkBits + 1);
        this.links[off] = new Uint32Array(numLinks);
      }
    }

    for (let i = 0; i < lengths.length; i++) {
      const n = lengths[i];
      if (n === 0) {
        continue;
      }
      const code = nextcode[n];
      nextcode[n]++;
      const chunk = (i << huffmanValueShift) | n;
      let reverse = reverse16(code);
      reverse >>= 16 - n;
      if (n <= huffmanChunkBits) {
        for (let off = reverse; off < this.chunks.length; off += 1 << n) {
          this.chunks[off] = chunk;
        }
      } else {
        const j = reverse & (huffmanNumChunks - 1);
        const value = this.chunks[j] >>> huffmanValueShift;
        const linktab = this.links[value];
        reverse >>= huffmanChunkBits;
        for (let off = reverse; off < linktab.length; off += 1 << (n - huffmanChunkBits)) {
          linktab[off] = chunk;
        }
      }
    }

    return true;
  }
}

let fixedHuffmanDecoder: huffmanDecoder | null = null;

function fixedHuffmanDecoderInit(): huffmanDecoder {
  if (fixedHuffmanDecoder === null) {
    // These come from the RFC section 3.2.6.
    const bits = new Int32Array(288);
    for (let i = 0; i < 144; i++) bits[i] = 8;
    for (let i = 144; i < 256; i++) bits[i] = 9;
    for (let i = 256; i < 280; i++) bits[i] = 7;
    for (let i = 280; i < 288; i++) bits[i] = 8;
    fixedHuffmanDecoder = new huffmanDecoder();
    fixedHuffmanDecoder.init(bits);
  }
  return fixedHuffmanDecoder;
}

const codeOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// noEOF returns err, unless err == io.EOF, in which case it returns io.ErrUnexpectedEOF.
function noEOF(e: any): any {
  if (e === EOF) {
    return ErrUnexpectedEOF;
  }
  return e;
}

// The decompressor, run to the end: the whole output lives in "out" (Go's
// 32 KiB window only changes when the output is handed out, and a Read
// after an error flushes what's left)
class decompressor {
  declare input: Uint8Array;
  declare pos: number;
  declare endErr: any;
  declare roffset: number;
  declare b: number; // uint32
  declare nb: number;
  declare h1: huffmanDecoder;
  declare h2: huffmanDecoder;
  declare bits: Int32Array;
  declare codebits: Int32Array;
  declare out: Uint8Array;
  declare outLen: number;
  declare final: boolean;
  declare err: any;
  declare hl: huffmanDecoder | null;
  declare hd: huffmanDecoder | null;
  constructor(input: Uint8Array, endErr: any) {
    this.input = input;
    this.pos = 0;
    this.endErr = endErr;
    this.roffset = 0;
    this.b = 0;
    this.nb = 0;
    this.h1 = new huffmanDecoder();
    this.h2 = new huffmanDecoder();
    this.bits = new Int32Array(maxNumLit + maxNumDist);
    this.codebits = new Int32Array(numCodes);
    this.out = new Uint8Array(input.length * 4 + 64);
    this.outLen = 0;
    this.final = false;
    this.err = null;
    this.hl = null;
    this.hd = null;
  }

  grow(n: number) {
    if (this.outLen + n > this.out.length) {
      let size = this.out.length * 2;
      while (size < this.outLen + n) size *= 2;
      const out = new Uint8Array(size);
      out.set(this.out.subarray(0, this.outLen));
      this.out = out;
    }
  }

  // bufio.Reader.ReadByte: the byte, or -1 at the end of the input
  readByte(): number {
    if (this.pos < this.input.length) return this.input[this.pos++];
    return -1;
  }

  nextBlock() {
    while (this.nb < 1 + 2) {
      if ((this.err = this.moreBits()) !== null) {
        return;
      }
    }
    this.final = (this.b & 1) === 1;
    this.b >>>= 1;
    const typ = this.b & 3;
    this.b >>>= 2;
    this.nb -= 1 + 2;
    switch (typ) {
      case 0:
        this.dataBlock();
        break;
      case 1:
        // compressed, fixed Huffman tables
        this.hl = fixedHuffmanDecoderInit();
        this.hd = null;
        this.huffmanBlock();
        break;
      case 2:
        // compressed, dynamic Huffman tables
        if ((this.err = this.readHuffman()) !== null) {
          break;
        }
        this.hl = this.h1;
        this.hd = this.h2;
        this.huffmanBlock();
        break;
      default:
        // 3 is reserved.
        this.err = corruptInputError(this.roffset);
    }
  }

  readHuffman(): any {
    // HLIT[5], HDIST[5], HCLEN[4].
    while (this.nb < 5 + 5 + 4) {
      const err = this.moreBits();
      if (err !== null) {
        return err;
      }
    }
    const nlit = (this.b & 0x1f) + 257;
    if (nlit > maxNumLit) {
      return corruptInputError(this.roffset);
    }
    this.b >>>= 5;
    const ndist = (this.b & 0x1f) + 1;
    if (ndist > maxNumDist) {
      return corruptInputError(this.roffset);
    }
    this.b >>>= 5;
    const nclen = (this.b & 0xf) + 4;
    // numCodes is 19, so nclen is always valid.
    this.b >>>= 4;
    this.nb -= 5 + 5 + 4;

    // (HCLEN+4)*3 bits: code lengths in the magic codeOrder order.
    for (let i = 0; i < nclen; i++) {
      while (this.nb < 3) {
        const err = this.moreBits();
        if (err !== null) {
          return err;
        }
      }
      this.codebits[codeOrder[i]] = this.b & 0x7;
      this.b >>>= 3;
      this.nb -= 3;
    }
    for (let i = nclen; i < codeOrder.length; i++) {
      this.codebits[codeOrder[i]] = 0;
    }
    if (!this.h1.init(this.codebits)) {
      return corruptInputError(this.roffset);
    }

    // HLIT + 257 code lengths, HDIST + 1 code lengths,
    // using the code length Huffman code.
    for (let i = 0, n = nlit + ndist; i < n; ) {
      const $x = this.huffSym(this.h1);
      if ($x[1] !== null) {
        return $x[1];
      }
      const x = $x[0];
      if (x < 16) {
        // Actual length.
        this.bits[i] = x;
        i++;
        continue;
      }
      // Repeat previous length or zero.
      let rep: number;
      let nb: number;
      let b: number;
      switch (x) {
        case 16:
          rep = 3;
          nb = 2;
          if (i === 0) {
            return corruptInputError(this.roffset);
          }
          b = this.bits[i - 1];
          break;
        case 17:
          rep = 3;
          nb = 3;
          b = 0;
          break;
        case 18:
          rep = 11;
          nb = 7;
          b = 0;
          break;
        default:
          return new GoError("flate: internal error: unexpected length code");
      }
      while (this.nb < nb) {
        const err = this.moreBits();
        if (err !== null) {
          return err;
        }
      }
      rep += this.b & ((1 << nb) - 1);
      this.b >>>= nb;
      this.nb -= nb;
      if (i + rep > n) {
        return corruptInputError(this.roffset);
      }
      for (let j = 0; j < rep; j++) {
        this.bits[i] = b;
        i++;
      }
    }

    if (!this.h1.init(this.bits.subarray(0, nlit)) || !this.h2.init(this.bits.subarray(nlit, nlit + ndist))) {
      return corruptInputError(this.roffset);
    }

    // As an optimization, we can initialize the min bits to read at a time
    // for the HLIT tree to the length of the EOB marker since we know that
    // every block must terminate with one. This preserves the property that
    // we never read any extra bytes after the end of the DEFLATE stream.
    if (this.h1.min < this.bits[endBlockMarker]) {
      this.h1.min = this.bits[endBlockMarker];
    }

    return null;
  }

  // Decode a single Huffman block from f.
  huffmanBlock() {
    const hl = this.hl as huffmanDecoder;
    const hd = this.hd;
    for (;;) {
      // Read literal and/or (length, distance) according to RFC section 3.2.3.
      const $v = this.huffSym(hl);
      if ($v[1] !== null) {
        this.err = $v[1];
        return;
      }
      const v = $v[0];
      let n: number; // number of bits extra
      let length: number;
      if (v < 256) {
        this.grow(1);
        this.out[this.outLen++] = v;
        continue;
      } else if (v === 256) {
        this.finishBlock();
        return;
      } else if (v < 265) {
        // otherwise, reference to older data
        length = v - (257 - 3);
        n = 0;
      } else if (v < 269) {
        length = v * 2 - (265 * 2 - 11);
        n = 1;
      } else if (v < 273) {
        length = v * 4 - (269 * 4 - 19);
        n = 2;
      } else if (v < 277) {
        length = v * 8 - (273 * 8 - 35);
        n = 3;
      } else if (v < 281) {
        length = v * 16 - (277 * 16 - 67);
        n = 4;
      } else if (v < 285) {
        length = v * 32 - (281 * 32 - 131);
        n = 5;
      } else if (v < maxNumLit) {
        length = 258;
        n = 0;
      } else {
        this.err = corruptInputError(this.roffset);
        return;
      }
      if (n > 0) {
        while (this.nb < n) {
          const err = this.moreBits();
          if (err !== null) {
            this.err = err;
            return;
          }
        }
        length += this.b & ((1 << n) - 1);
        this.b >>>= n;
        this.nb -= n;
      }

      let dist: number;
      if (hd === null) {
        while (this.nb < 5) {
          const err = this.moreBits();
          if (err !== null) {
            this.err = err;
            return;
          }
        }
        dist = reverse8(((this.b & 0x1f) << 3) & 0xff);
        this.b >>>= 5;
        this.nb -= 5;
      } else {
        const $d = this.huffSym(hd);
        if ($d[1] !== null) {
          this.err = $d[1];
          return;
        }
        dist = $d[0];
      }

      if (dist < 4) {
        dist++;
      } else if (dist < maxNumDist) {
        const nb = (dist - 2) >>> 1;
        // have 1 bit in bottom of dist, need nb more.
        let extra = (dist & 1) << nb;
        while (this.nb < nb) {
          const err = this.moreBits();
          if (err !== null) {
            this.err = err;
            return;
          }
        }
        extra |= this.b & ((1 << nb) - 1);
        this.b >>>= nb;
        this.nb -= nb;
        dist = (1 << (nb + 1)) + 1 + extra;
      } else {
        this.err = corruptInputError(this.roffset);
        return;
      }

      // No check on length; encoding can be prescient.
      // (dictDecoder.histSize: the output so far, up to the 32 KiB window,
      // and "dist" is at most 32 KiB)
      if (dist > this.outLen) {
        this.err = corruptInputError(this.roffset);
        return;
      }

      // Perform a backwards copy according to RFC section 3.2.3.
      this.grow(length);
      const out = this.out;
      let src = this.outLen - dist;
      let dst = this.outLen;
      for (let k = 0; k < length; k++) out[dst++] = out[src++];
      this.outLen = dst;
    }
  }

  // Copy a single uncompressed data block from input to output.
  dataBlock() {
    // Uncompressed.
    // Discard current half-byte.
    this.nb = 0;
    this.b = 0;

    // Length then ones-complement of length.
    const avail = this.input.length - this.pos;
    const nr = avail < 4 ? avail : 4;
    const buf = this.input.subarray(this.pos, this.pos + nr);
    this.pos += nr;
    this.roffset += nr;
    if (nr < 4) {
      // (io.ReadFull: io.EOF when nothing was read, io.ErrUnexpectedEOF
      // for part of it, or the reader's error)
      this.err = noEOF(nr > 0 && this.endErr === EOF ? ErrUnexpectedEOF : this.endErr);
      return;
    }
    const n = buf[0] | (buf[1] << 8);
    const nn = buf[2] | (buf[3] << 8);
    if ((nn & 0xffff) !== (~n & 0xffff)) {
      this.err = corruptInputError(this.roffset);
      return;
    }

    if (n === 0) {
      this.finishBlock();
      return;
    }

    // copyData
    const avail2 = this.input.length - this.pos;
    const cnt = avail2 < n ? avail2 : n;
    this.grow(cnt);
    this.out.set(this.input.subarray(this.pos, this.pos + cnt), this.outLen);
    this.outLen += cnt;
    this.pos += cnt;
    this.roffset += cnt;
    if (cnt < n) {
      this.err = noEOF(cnt > 0 && this.endErr === EOF ? ErrUnexpectedEOF : this.endErr);
      return;
    }
    this.finishBlock();
  }

  finishBlock() {
    if (this.final) {
      this.err = EOF;
    }
  }

  moreBits(): any {
    const c = this.readByte();
    if (c < 0) {
      return noEOF(this.endErr);
    }
    this.roffset++;
    this.b = (this.b | (c << this.nb)) >>> 0;
    this.nb += 8;
    return null;
  }

  // Read the next Huffman-encoded symbol from f according to h.
  huffSym(h: huffmanDecoder): [number, any] {
    let n = h.min;
    let nb = this.nb;
    let b = this.b;
    for (;;) {
      while (nb < n) {
        const c = this.readByte();
        if (c < 0) {
          this.b = b;
          this.nb = nb;
          return [0, noEOF(this.endErr)];
        }
        this.roffset++;
        b = (b | (c << (nb & 31))) >>> 0;
        nb += 8;
      }
      let chunk = h.chunks[b & (huffmanNumChunks - 1)];
      n = chunk & huffmanCountMask;
      if (n > huffmanChunkBits) {
        chunk = h.links[chunk >>> huffmanValueShift][(b >>> huffmanChunkBits) & h.linkMask];
        n = chunk & huffmanCountMask;
      }
      if (n <= nb) {
        if (n === 0) {
          this.b = b;
          this.nb = nb;
          this.err = corruptInputError(this.roffset);
          return [0, this.err];
        }
        this.b = b >>> (n & 31);
        this.nb = nb - n;
        return [chunk >>> huffmanValueShift, null];
      }
    }
  }
}

// flate.NewReader read to the end: [output, the error that ends it] (io.EOF
// after the final block)
export function inflate(input: Uint8Array, endErr: any): [Uint8Array, any] {
  const f = new decompressor(input, endErr);
  while (f.err === null) {
    f.nextBlock();
  }
  return [f.out.subarray(0, f.outLen), f.err];
}
