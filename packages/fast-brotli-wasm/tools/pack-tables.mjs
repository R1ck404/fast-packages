// Writes rust/vendor/brotli/src/enc/fast_tables/*.bin: packed forms of the
// encoder's four big lookup tables, which fast_tables.rs rebuilds in memory at
// the first encoder use instead of storing them in fastbrotli.wasm (they were
// 518 KB of its data, ~330 KB of it after gzip):
//
//   log64k.bin        util::log64k, [f32; 65536] = log2(0..65535) (FastLog2u16):
//                     the bit patterns of entries 0..511, then for i >= 512 the
//                     second differences bits(i) - 2 bits(i-1) + bits(i-2),
//                     signed 4-bit, two per byte (low nibble first).
//   dict_words.bin    static_dict_lut::kStaticDictionaryWords, [DictWord; 31705]
//                     ({ l: u8, t: u8, i: u16 }): the l bytes, the low bytes of
//                     i, then (i >> 8) << 4 | t.
//   dict_buckets.bin  static_dict_lut::kStaticDictionaryBuckets, [u16; 32768]:
//                     a bitmap of the nonzero slots. The buckets are consecutive
//                     runs of words, each ending with the word whose l has bit 7
//                     set, so slot k's value is where the k-th nonzero slot's run
//                     starts (the first at 1).
//   dict_hash.bin     dictionary_hash::kStaticDictionaryHash, [u16; 32768]: a
//                     bitmap of the nonzero slots, then their values' low bytes,
//                     then their high bytes.
//
// The tables are taken from brotli-wasm 3.0.1's own wasm (the same brotli 5.0.0
// sources compiled by rustc), found by their first entries; test/tables.mjs
// checks that the rebuilt tables in fastbrotli.wasm's memory appear verbatim
// in brotli-wasm's memory image.
// usage: node packages/fast-brotli-wasm/tools/pack-tables.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** the linear memory image of a wasm file's active data segments */
export function memoryImage(bytes) {
  let p = 8;
  const leb = () => {
    let r = 0, s = 0, x;
    do {
      x = bytes[p++];
      r += (x & 0x7f) * 2 ** s;
      s += 7;
    } while (x & 0x80);
    return r;
  };
  const parts = [];
  let size = 0;
  while (p < bytes.length) {
    const id = bytes[p++];
    const n = leb();
    const end = p + n;
    if (id === 11) {
      for (let i = leb(); i > 0; i--) {
        if (leb() !== 0 || bytes[p++] !== 0x41) throw new Error("unexpected data segment");
        const offset = leb(); // i32.const offset (positive and small enough here)
        if (bytes[p++] !== 0x0b) throw new Error("unexpected data segment offset");
        const len = leb();
        parts.push([offset, bytes.subarray(p, p + len)]);
        size = Math.max(size, offset + len);
        p += len;
      }
    }
    p = end;
  }
  const mem = Buffer.alloc(size);
  for (const [offset, data] of parts) mem.set(data, offset);
  return mem;
}

const u16 = (a) => Buffer.from(new Uint16Array(a).buffer);
const f32 = (a) => Buffer.from(new Float32Array(a.map(Math.fround)).buffer);
const word = (l, t, i) => [l, t, i & 255, i >> 8];
/** how each table starts, and its size in bytes */
export const TABLES = {
  log64k: { size: 65536 * 4, start: f32([0, 0, 1, Math.log2(3), 2, Math.log2(5), Math.log2(6), Math.log2(7), 3]) },
  words: { size: 31705 * 4, start: Buffer.from([word(0, 0, 0), word(8, 0, 1002), word(136, 0, 1015), word(4, 0, 683), word(4, 10, 325), word(138, 10, 125)].flat()) },
  buckets: { size: 32768 * 2, start: u16([1, 0, 0, 0, 0, 0, 0, 0, 0, 3, 6, 0, 0, 0, 0, 0, 20, 0, 0, 0, 21, 0, 22]) },
  hash: { size: 32768 * 2, start: u16([32072, 0, 0, 0, 0, 0, 0, 0, 0, 21860, 0, 0, 0, 0, 0, 0, 0, 40486, 0, 0, 0, 0, 0, 45798]) },
};
/** the table `name` in a memory image, or undefined (the first match that has the table's structure) */
export function findTable(mem, name) {
  const { size, start } = TABLES[name];
  for (let at = mem.indexOf(start); at >= 0; at = mem.indexOf(start, at + 1)) {
    const t = mem.subarray(at, at + size);
    if (t.length === size && check[name](t)) return t;
  }
}
const check = {
  // (kLog2Table, 256 entries, starts the same way)
  log64k: (t) => t.readFloatLE(4 * 256) === 8 && t.readFloatLE(4 * 65535) > 15.9999,
  words: (t) => t[4 * 31704] & 0x80 && t.readUInt16LE(4 * 31704 + 2) < 2048,
  buckets: () => true,
  hash: () => true,
};

function packLog64k(t) {
  const HEAD = 512;
  const bits = new Uint32Array(65536);
  for (let i = 0; i < 65536; i++) bits[i] = t.readUInt32LE(4 * i);
  const out = Buffer.alloc(HEAD * 4 + (65536 - HEAD) / 2);
  t.copy(out, 0, 0, HEAD * 4);
  for (let i = HEAD; i < 65536; i++) {
    const d = (bits[i] - 2 * bits[i - 1] + bits[i - 2]) | 0;
    if (d < -8 || d > 7) throw new Error(`log64k: second difference ${d} at ${i} does not fit in 4 bits`);
    out[HEAD * 4 + ((i - HEAD) >> 1)] |= (d & 15) << (((i - HEAD) & 1) * 4);
  }
  return out;
}
function packWords(t) {
  const n = t.length / 4, out = Buffer.alloc(3 * n);
  for (let k = 0; k < n; k++) {
    const [l, tr, i] = [t[4 * k], t[4 * k + 1], t.readUInt16LE(4 * k + 2)];
    if (tr > 15 || i >> 8 > 15) throw new Error("words: field out of range");
    out[k] = l;
    out[n + k] = i & 255;
    out[2 * n + k] = ((i >> 8) << 4) | tr;
  }
  return out;
}
const bitmap = (t) => {
  const out = Buffer.alloc(4096);
  for (let h = 0; h < 32768; h++) if (t.readUInt16LE(2 * h)) out[h >> 3] |= 1 << (h & 7);
  return out;
};
function packHash(t) {
  const lo = [], hi = [];
  for (let h = 0; h < 32768; h++) {
    const v = t.readUInt16LE(2 * h);
    if (v) lo.push(v & 255), hi.push(v >> 8);
  }
  return Buffer.concat([bitmap(t), Buffer.from(lo), Buffer.from(hi)]);
}

// the decoders of fast_tables.rs, to check the round trip
export function unpack(name, p, words) {
  if (name === "log64k") {
    const out = Buffer.alloc(65536 * 4);
    p.copy(out, 0, 0, 2048);
    let u = out.readUInt32LE(4 * 511), d = (u - out.readUInt32LE(4 * 510)) | 0;
    for (let i = 512; i < 65536; i++) {
      const x = p[2048 + ((i - 512) >> 1)] >> (((i - 512) & 1) * 4);
      d = (d + (((x & 15) << 28) >> 28)) | 0;
      u = (u + d) >>> 0;
      out.writeUInt32LE(u, 4 * i);
    }
    return out;
  }
  if (name === "words") {
    const n = p.length / 3, out = Buffer.alloc(4 * n);
    for (let k = 0; k < n; k++) {
      out[4 * k] = p[k];
      out[4 * k + 1] = p[2 * n + k] & 15;
      out.writeUInt16LE(p[n + k] | ((p[2 * n + k] >> 4) << 8), 4 * k + 2);
    }
    return out;
  }
  const out = Buffer.alloc(65536);
  let k = 0, pos = 1;
  for (let h = 0; h < 32768; h++) {
    if (!((p[h >> 3] >> (h & 7)) & 1)) continue;
    if (name === "hash") {
      const n = (p.length - 4096) / 2;
      out.writeUInt16LE(p[4096 + k] | (p[4096 + n + k] << 8), 2 * h);
      k++;
    } else {
      out.writeUInt16LE(pos, 2 * h);
      while (!(words[4 * pos] & 0x80)) pos++;
      pos++;
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const mem = memoryImage(readFileSync(join(dirname(require.resolve("brotli-wasm")), "pkg.web", "brotli_wasm_bg.wasm")));
  const t = {};
  for (const name of Object.keys(TABLES)) if (!(t[name] = findTable(mem, name))) throw new Error(`${name} not found in brotli-wasm`);
  const packed = { log64k: packLog64k(t.log64k), words: packWords(t.words), buckets: bitmap(t.buckets), hash: packHash(t.hash) };
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../rust/vendor/brotli/src/enc/fast_tables");
  const file = { log64k: "log64k.bin", words: "dict_words.bin", buckets: "dict_buckets.bin", hash: "dict_hash.bin" };
  for (const name of Object.keys(TABLES)) {
    if (!unpack(name, packed[name], t.words).equals(t[name])) throw new Error(`${name}: round trip failed`);
    writeFileSync(join(dir, file[name]), packed[name]);
    console.log(`${file[name]}: ${t[name].length} -> ${packed[name].length} bytes`);
  }
}
