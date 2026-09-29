// Writes rust/options/src/debug_escapes.bin, the table rust/options uses: the
// code points that brotli-wasm 3.0.1 prints as \u{...} when Rust
// Debug-formats a string (char::escape_debug with the Unicode tables of the
// Rust version it was built with: not printable, or grapheme-extending).
// Measured on brotli-wasm itself: string options values end up
// Debug-formatted in its panic messages.
// usage: node packages/fast-brotli-wasm/tools/debug-escapes.mjs
//
// Format: the range boundaries [start0, end0, start1, end1, ...] as deltas,
// each an unsigned LEB128 number.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dir = join(dirname(require.resolve("brotli-wasm")), "pkg.node");
const src = readFileSync(join(dir, "brotli_wasm.js"), "utf8").replace("new WebAssembly.Module(bytes)", "__MOD");
const mod = new WebAssembly.Module(readFileSync(join(dir, "brotli_wasm_bg.wasm")));
const factory = new Function("module", "exports", "require", "__dirname", "__MOD", src);
function fresh() {
  const module = { exports: {} };
  factory(module, module.exports, (m) => (m === "fs" ? { readFileSync: () => null } : require(m)), dir, mod);
  return module.exports;
}

// the Debug-escaped form of `s` in brotli-wasm's panic for { quality: s }
function debugOf(s) {
  const O = fresh(); // a fresh instance: only the first panics of one reach console.error
  const logged = [];
  const orig = console.error;
  console.error = (m) => logged.push(m);
  try {
    O.compress(new Uint8Array(1), { quality: s });
  } catch {}
  console.error = orig;
  const line = logged[0];
  const pre = 'string \\"', suf = '\\", expected i32"';
  const outer = line.slice(line.indexOf(pre) + pre.length, line.lastIndexOf(suf));
  // the message is Debug-formatted twice; undo the outer one (only \\ and \" occur)
  return outer.replace(/\\(.)/g, "$1");
}

const escaped = new Uint8Array(0x110000);
const CHUNK = 0x8000;
for (let base = 0; base < 0x110000; base += CHUNK) {
  const cps = [];
  for (let c = base; c < base + CHUNK; c++) if (c < 0xd800 || c > 0xdfff) cps.push(c);
  if (!cps.length) continue;
  const d = debugOf(String.fromCodePoint(...cps));
  let k = 0;
  for (const c of cps) {
    if (d[k] === "\\") {
      escaped[c] = 1;
      if (d[k + 1] === "u") {
        const e = d.indexOf("}", k);
        if (parseInt(d.slice(k + 3, e), 16) !== c) throw new Error(`unexpected escape at U+${c.toString(16)}`);
        k = e + 1;
      } else k += 2; // \0 \t \n \r \" \\
    } else {
      if (d.codePointAt(k) !== c) throw new Error(`unexpected output at U+${c.toString(16)}`);
      k += c > 0xffff ? 2 : 1;
    }
  }
  if (k !== d.length) throw new Error("unexpected output length");
}
// surrogates never reach the formatting (serde_json rejects lone ones): let them join a range
for (let c = 0xd800; c < 0xe000; c++) escaped[c] = escaped[0xd7ff] && escaped[0xe000] ? 1 : 0;

const bounds = [];
for (let c = 0; c <= 0x110000; c++) if ((escaped[c] || 0) !== (escaped[c - 1] || 0)) bounds.push(c);
const out = [];
let prev = 0;
for (const b of bounds) {
  let n = b - prev;
  prev = b;
  for (; n >= 0x80; n >>>= 7) out.push((n & 0x7f) | 0x80);
  out.push(n);
}
const file = join(dirname(fileURLToPath(import.meta.url)), "../rust/options/src/debug_escapes.bin");
writeFileSync(file, Buffer.from(out));
console.log(`wrote ${file}: ${bounds.length / 2} ranges, ${out.length} bytes`);
