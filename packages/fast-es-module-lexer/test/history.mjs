// The original's answer on a fresh instance, and its history dependence.
//
// For some malformed inputs es-module-lexer 1.7.0 reads memory outside its
// source (its bracket stack below it, its records and stale data past the
// NUL terminator, a NULL pointer): its answer then depends on what earlier
// parses left in its memory. @r1ck404/fast-es-module-lexer answers as a
// fresh instance of the original does (its first parse).
//
// freshParse(source, name): es-module-lexer's own parse (the JS glue of
//   dist/lexer.js, verbatim) on a new instance of its wasm.
// historyDependent(source): the original's answer differs when its memory
//   (the stack region below the source and everything past it) is filled
//   with different patterns before the parse (then it depends on history).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nm } from "../../../bench/corpus.mjs";
import { original } from "./original.mjs";

const orig = original(readFileSync(join(nm, "es-module-lexer/dist/lexer.js"), "utf8"));
const origModule = orig.module;
/** es-module-lexer's parse(...args) on a fresh instance of its wasm */
export const freshParse = orig.freshParse;

// the original wasm (fresh instance, the glue's memory growth and copy) with
// the stack region and the memory past the source filled with `fill`
function origWithGarbage(source, fill) {
  const C = new WebAssembly.Instance(origModule).exports;
  const I = source.length + 1;
  const w = C.__heap_base.value + 4 * I - C.memory.buffer.byteLength;
  if (w > 0) C.memory.grow(Math.ceil(w / 65536));
  const u16 = new Uint16Array(C.memory.buffer);
  const hb = C.__heap_base.value >> 1;
  u16.fill(fill, 1024, hb); // stack (openTokenStack etc. live here)
  u16.fill(fill, hb + I); // past the NUL terminator
  const K = C.sa(I - 1);
  const buf = new Uint16Array(C.memory.buffer, K, I);
  for (let i = 0; i < source.length; i++) buf[i] = source.charCodeAt(i);
  try {
    if (!C.parse()) return "ERR " + C.e();
    const out = [];
    while (C.ri()) out.push([C.is(), C.ie(), C.it(), C.ai(), C.id(), C.ss(), C.se(), C.ip()]);
    while (C.re()) out.push([C.es(), C.ee(), C.els(), C.ele()]);
    return JSON.stringify([out, C.f(), C.ms()]);
  } catch (e) {
    return "TRAP " + e.message;
  }
}
const fills = [0, 32, 0x7b, 0x29, 0x61, 0x2f, 0x27, 0x7d, 0x2e, 0x0a];
export function historyDependent(src) {
  const seen = new Set();
  for (const f of fills) seen.add(origWithGarbage(src, f));
  return seen.size > 1;
}
