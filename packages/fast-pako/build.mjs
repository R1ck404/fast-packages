// Build the wasm core and embed it into fastzlib.wasm.mjs.
// usage: node packages/fast-pako/build.mjs [--no-opt]
//
// fastzlib.wasm (the core, rust/) is embedded deflate-compressed (by
// tools/deflate-opt.mjs) as text, and rust/boot, a ~2 KB decoder of that
// text and of raw deflate, as base64; index.mjs runs the decoder on first
// use (about half a millisecond). The compressed core is 40% of the module;
// gzip/brotli would not get the module that small (and cannot compress the
// compressed form further).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateOpt } from "./tools/deflate-opt.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const noOpt = process.argv.includes("--no-opt");
// what the module may use (not binaryen's Features.All: newer encodings such as
// compact imports are not supported by the engines)
const FEATURES = await import("binaryen").then(({ default: b }) => { const f = b.Features; return f.MVP | f.MutableGlobals | f.NontrappingFPToInt | f.SIMD128 | f.BulkMemory | f.BulkMemoryOpt | f.SignExt | f.ReferenceTypes | f.Multivalue; }, () => 0);

async function wasmOpt(bytes, level) {
  if (noOpt) return bytes;
  try {
    const { default: binaryen } = await import("binaryen");
    const mod = binaryen.readBinary(bytes);
    mod.setFeatures(FEATURES);
    // linker symbols nobody reads
    for (const name of ["__heap_base", "__data_end"]) if (mod.getExport(name)) mod.removeExport(name);
    binaryen.setOptimizeLevel(level);
    binaryen.setShrinkLevel(0);
    // keep big single-caller functions (the inflate fast loop) out of their
    // callers: V8 allocates registers better in the smaller function
    binaryen.setOneCallerInlineMaxSize(Number(process.env.WASMOPT_ONECALLER || 200));
    mod.optimize();
    return Buffer.from(mod.emitBinary());
  } catch (e) {
    console.log("binaryen not available, skipping wasm-opt:", e.message);
    return bytes;
  }
}

// Rust panic locations ({ file: &str, line, col } records and the file
// names) stay in the data section although the panic handler never reads
// them and wasm-opt has turned every panic into `unreachable`. Zero them
// (wasm-opt's memory-packing then drops the zeros), but only if no
// instruction or other data refers to any of those bytes.
async function dropPanicLocations(bytes) {
  const { default: binaryen } = await import("binaryen");
  const b = Buffer.from(bytes);
  let p = 8;
  const leb = () => {
    let r = 0, s = 0, x;
    do {
      x = b[p++];
      r |= (x & 0x7f) << s;
      s += 7;
    } while (x & 0x80);
    return r >>> 0;
  };
  const segs = []; // [memory address, file offset, size]
  while (p < b.length) {
    const id = b[p++], n = leb(), end = p + n;
    if (id === 11) {
      const count = leb();
      for (let i = 0; i < count; i++) {
        if (leb() !== 0 || b[p] !== 0x41) return bytes; // only active segments with i32.const offsets
        p++;
        const addr = leb();
        if (b[p++] !== 0x0b) return bytes;
        const size = leb();
        segs.push([addr, p, size]);
        p += size;
      }
    }
    p = end;
  }
  const byteAt = (a) => {
    for (const [s, f, n] of segs) if (a >= s && a < s + n) return f + a - s;
    return -1;
  };
  // (bytes outside the segments are zero: wasm-opt drops runs of zeros)
  const byte = (a) => (byteAt(a) < 0 ? 0 : b[byteAt(a)]);
  const u32 = (a) => (byte(a) | (byte(a + 1) << 8) | (byte(a + 2) << 16) | (byte(a + 3) << 24)) >>> 0;
  const ranges = []; // [start, end) memory addresses to zero
  const lo = Math.min(...segs.map(([s]) => s)), hi = Math.max(...segs.map(([s, , n]) => s + n));
  for (let a = lo & ~3; a < hi; a += 4) {
    const ptr = u32(a), len = u32(a + 4), line = u32(a + 8), col = u32(a + 12);
    if (len < 4 || len > 200 || line < 1 || line > 100000 || col < 1 || col > 1000 || byteAt(ptr) < 0 || byteAt(ptr + len - 1) < 0) continue;
    const name = b.subarray(byteAt(ptr), byteAt(ptr) + len).toString("latin1");
    if (!/^[\x20-\x7e]+\.rs$/.test(name)) continue;
    ranges.push([a, a + 16], [ptr, ptr + len]);
  }
  const warn = (m) => (console.log("core: panic locations kept (" + m + ")"), bytes);
  if (!ranges.length) return bytes;
  const inRange = (v) => ranges.some(([s, e]) => v >= s && v < e);
  // references from code: the address of a record or name (a constant or a
  // memory offset; constants inside a range are also folded table bases)
  const starts = new Set(ranges.map(([s]) => s));
  const mod = binaryen.readBinary(bytes);
  mod.setFeatures(FEATURES);
  const text = mod.emitText();
  mod.dispose();
  for (const m of text.matchAll(/(?:i32\.const|offset=)\s*(-?\d+)/g)) if (starts.has(Number(m[1]) >>> 0)) return warn("code refers to " + m[1]);
  // references from data outside the records
  for (const [s, , n] of segs)
    for (let a = s; a + 4 <= s + n; a += 1) if (!inRange(a) && inRange(u32(a))) return warn("data at " + a + " refers to " + u32(a));
  let zeroed = 0;
  for (const [s, e] of ranges)
    for (let a = s; a < e; a++) {
      const i = byteAt(a);
      if (i >= 0 && b[i] !== 0) {
        b[i] = 0;
        zeroed++;
      }
    }
  const out = binaryen.readBinary(b);
  out.setFeatures(FEATURES);
  out.runPasses(["memory-packing"]);
  const r = Buffer.from(out.emitBinary());
  out.dispose();
  console.log(`core: dropped ${ranges.length / 2} panic locations (${zeroed} bytes of data)`);
  return r;
}

function cargo(dir, file) {
  execSync("cargo build --release", { cwd: dir, stdio: "inherit" });
  return readFileSync(join(dir, "target/wasm32-unknown-unknown/release", file));
}

let core = cargo(join(here, "rust"), "fastzlib.wasm");
console.log("core: raw wasm", core.length, "bytes");
core = await wasmOpt(core, Number(process.env.WASMOPT_LEVEL || 3));
console.log("core: wasm-opt", core.length, "bytes");
if (!noOpt) core = await dropPanicLocations(core);
const boot = await wasmOpt(cargo(join(here, "rust/boot"), "fastzlib_boot.wasm"), 2);
console.log("boot:", boot.length, "bytes");

// optimal parsing (tools/deflate-opt.mjs), ~5% smaller than zlib -9; codes of
// at most 11 bits (all the boot decoder handles; no loss here)
const packed = Buffer.from(deflateOpt(core, { iterations: 30, maxBits: 11 }));

// The compressed core as text for a "..." string: 13 bits per two characters
// of printable ASCII without " < \ (92 characters), 6.5 bits per character
// where base64 has 6 (rust/boot text() decodes)
const ALPHABET = [];
for (let c = 32; c < 127; c++) if (c !== 0x22 && c !== 0x3c && c !== 0x5c) ALPHABET.push(String.fromCharCode(c));
function encodeText(bytes) {
  let s = "", acc = 0, n = 0;
  const put = (v) => (s += ALPHABET[v % 92] + ALPHABET[Math.floor(v / 92)]);
  for (const b of bytes) {
    acc |= b << n;
    n += 8;
    while (n >= 13) {
      put(acc & 8191);
      acc >>>= 13;
      n -= 13;
    }
  }
  if (n > 0) put(acc & 8191);
  return s;
}
const text = encodeText(packed);

// the embedded decoder must reproduce the core exactly (as index.mjs runs it)
{
  const e = new WebAssembly.Instance(new WebAssembly.Module(boot)).exports;
  const base = e.memory.grow(Math.ceil((text.length + 8 + core.length) / 65536)) * 65536;
  new TextEncoder().encodeInto(text, new Uint8Array(e.memory.buffer, base, text.length));
  const k = e.text(base, text.length);
  if (!Buffer.from(new Uint8Array(e.memory.buffer, base, packed.length)).equals(packed)) throw new Error("boot text() does not reproduce the compressed core");
  const n = e.inflate(base, k, base + text.length + 8, core.length);
  const out = new Uint8Array(e.memory.buffer, base + text.length + 8, core.length);
  if (n !== core.length || !Buffer.from(out).equals(core)) throw new Error("boot decoder does not reproduce the core");
}
console.log("core deflated:", packed.length, "bytes, as text", text.length);

writeFileSync(join(here, "fastzlib.wasm"), core);
writeFileSync(
  join(here, "fastzlib.wasm.mjs"),
  `// generated by build.mjs — do not edit\n` +
    `// raw-deflate decoder (rust/boot), base64\n` +
    `export const boot = ${JSON.stringify(boot.toString("base64"))};\n` +
    `// fastzlib.wasm (rust/), raw deflate as text (build.mjs encodeText); ${core.length} bytes decoded\n` +
    `export const size = ${core.length};\n` +
    `export const packed = "${text}";\n`,
);
console.log("wrote fastzlib.wasm.mjs");
