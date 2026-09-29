// cmd/esbuild/stdio_protocol.go: the packets of esbuild's JS <-> service
// protocol, as the service (Go) encodes and decodes them. The glue talks to
// the engine's service (service.mts) through exactly these bytes, like it
// talks to Go.
//
// Go values as JavaScript values:
//   nil                     null
//   bool                    boolean
//   int                     number (decoded from a uint32: -1 arrives as
//                           4294967295; encoded as uint32(value))
//   string                  string (Go's bytes are UTF-8, WTF-8 for lone
//                           surrogates; a ByteString holds raw bytes)
//   []byte                  Uint8Array
//   []interface{}           array
//   map[string]interface{}  plain object (encoded with sorted keys)

import { compareStringsUTF8 } from "./js_parser.mjs";
import { goStringBytes } from "./helpers.mjs";

// A Go string whose bytes are not a JavaScript string's WTF-8 encoding (e.g.
// the text of a message with invalid UTF-8): encoded as a string, raw
export class ByteString {
  declare bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
}

export class Packet {
  declare value: any;
  declare id: number;
  declare isRequest: boolean;
  constructor(value: any, id: number, isRequest: boolean) {
    this.value = value;
    this.id = id;
    this.isRequest = isRequest;
  }
}

let decoder: TextDecoder | null = null;

// The bytes of the Go string a JavaScript string holds (WTF-8: a lone
// surrogate is 3 bytes, like Go's strings from helpers.UTF16ToString; and
// the raw bytes of invalid UTF-8, see helpers.decodeGoString)
export function encodeWTF8(s: string): Uint8Array {
  return goStringBytes(s);
}

// Go's string(bytes) as a JavaScript string. The glue only ever sends UTF-8
// that TextEncoder made, so decoding is exact.
export function decodeUTF8Exact(bytes: Uint8Array): string {
  if (decoder === null) decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  return decoder.decode(bytes);
}

class ByteBuffer {
  declare buf: Uint8Array;
  declare len: number;
  constructor() {
    this.buf = new Uint8Array(1024);
    this.len = 0;
  }
  grow(delta: number) {
    if (this.len + delta > this.buf.length) {
      const clone = new Uint8Array((this.len + delta) * 2);
      clone.set(this.buf.subarray(0, this.len));
      this.buf = clone;
    }
  }
  write8(value: number) {
    this.grow(1);
    this.buf[this.len++] = value;
  }
  write32(value: number) {
    this.grow(4);
    const b = this.buf;
    const i = this.len;
    b[i] = value;
    b[i + 1] = value >>> 8;
    b[i + 2] = value >>> 16;
    b[i + 3] = value >>> 24;
    this.len += 4;
  }
  writeBytes(bytes: Uint8Array) {
    this.write32(bytes.length);
    this.grow(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }
}

// Go's sort.Strings on map keys: byte order of the (WTF-8) strings
function sortedKeys(value: any): string[] {
  const keys = Object.keys(value);
  keys.sort(compareStringsUTF8);
  return keys;
}

export function encodePacket(p: Packet): Uint8Array {
  const bb = new ByteBuffer();
  const visit = (value: any) => {
    if (value === null || value === undefined) {
      bb.write8(0);
    } else if (typeof value === "boolean") {
      bb.write8(1);
      bb.write8(value ? 1 : 0);
    } else if (typeof value === "number") {
      bb.write8(2);
      bb.write32(value >>> 0);
    } else if (typeof value === "string") {
      bb.write8(3);
      bb.writeBytes(encodeWTF8(value));
    } else if (value instanceof ByteString) {
      bb.write8(3);
      bb.writeBytes(value.bytes);
    } else if (value instanceof Uint8Array) {
      bb.write8(4);
      bb.writeBytes(value);
    } else if (Array.isArray(value)) {
      bb.write8(5);
      bb.write32(value.length);
      for (const item of value) {
        visit(item);
      }
    } else {
      const keys = sortedKeys(value);
      bb.write8(6);
      bb.write32(keys.length);
      for (const k of keys) {
        bb.writeBytes(encodeWTF8(k));
        visit(value[k]);
      }
    }
  };
  bb.write32(0); // Reserve space for the length
  if (p.isRequest) {
    bb.write32((p.id << 1) >>> 0);
  } else {
    bb.write32(((p.id << 1) | 1) >>> 0);
  }
  visit(p.value);
  // Patch the length in
  const n = bb.len - 4;
  bb.buf[0] = n;
  bb.buf[1] = n >>> 8;
  bb.buf[2] = n >>> 16;
  bb.buf[3] = n >>> 24;
  return bb.buf.slice(0, bb.len);
}

// The packet in "bytes" (without the length prefix), or null
export function decodePacket(bytes: Uint8Array): Packet | null {
  let ptr = 0;
  const read32 = (): number => {
    if (ptr + 4 > bytes.length) throw INVALID;
    const v = (bytes[ptr] | (bytes[ptr + 1] << 8) | (bytes[ptr + 2] << 16) | (bytes[ptr + 3] << 24)) >>> 0;
    ptr += 4;
    return v;
  };
  const readSlice = (): Uint8Array => {
    const length = read32();
    if (ptr + length > bytes.length) throw INVALID;
    const slice = bytes.subarray(ptr, ptr + length);
    ptr += length;
    return slice;
  };
  const visit = (): any => {
    if (ptr >= bytes.length) throw INVALID;
    const kind = bytes[ptr++];
    switch (kind) {
      case 0: // nil
        return null;
      case 1: {
        // bool
        if (ptr >= bytes.length) throw INVALID;
        return bytes[ptr++] !== 0;
      }
      case 2: // int
        return read32();
      case 3: // string
        return decodeUTF8Exact(readSlice());
      case 4: // []byte
        return readSlice().slice();
      case 5: {
        // []interface{}
        const count = read32();
        const value = new Array(count);
        for (let i = 0; i < count; i++) {
          value[i] = visit();
        }
        return value;
      }
      case 6: {
        // map[string]interface{}
        const count = read32();
        const value: any = {};
        for (let i = 0; i < count; i++) {
          const key = decodeUTF8Exact(readSlice());
          const item = visit();
          // (a Go map key "__proto__" is an ordinary key)
          if (key === "__proto__") Object.defineProperty(value, key, { value: item, enumerable: true, writable: true, configurable: true });
          else value[key] = item;
        }
        return value;
      }
      default:
        throw new Error("Invalid packet");
    }
  };
  try {
    let id = read32();
    const isRequest = (id & 1) === 0;
    id >>>= 1;
    const value = visit();
    if (ptr !== bytes.length) {
      return null;
    }
    return new Packet(value, id, isRequest);
  } catch (e) {
    if (e === INVALID) return null;
    throw e;
  }
}

const INVALID = {};
