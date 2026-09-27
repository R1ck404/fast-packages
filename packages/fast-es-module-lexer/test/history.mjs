// The original reads memory past the source's NUL terminator for some
// malformed inputs (stale data from earlier parses): its result then depends on
// what was parsed before. @r1ck404/fast-es-module-lexer detects those reads and asks the
// (vendored) original, whose memory history differs from the reference
// instance's. Such a mismatch is accepted only if the input really is
// history-dependent.
// Direct check: run the original wasm (fresh instance, same JS glue as
// es-module-lexer's parse) with the stack region and the memory past the
// source filled with different patterns. A different answer for different
// garbage proves the original's result for `src` depends on stale memory.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nm } from "../../../bench/corpus.mjs";

const origB64 = readFileSync(join(nm, "es-module-lexer/dist/lexer.js"), "utf8").match(/"(AGFzbQ[^"]+)"/)[1];
const origModule = new WebAssembly.Module(Buffer.from(origB64, "base64"));
function origWithGarbage(source, fill) {
  const C = new WebAssembly.Instance(origModule).exports;
  const I = source.length + 1;
  const w = C.__heap_base.value + 4 * I - C.memory.buffer.byteLength;
  if (w > 0) C.memory.grow(Math.ceil(w / 65536));
  const u16 = new Uint16Array(C.memory.buffer);
  const hb = C.__heap_base.value >> 1;
  u16.fill(fill, 1024, hb); // stack (openTokenStack etc. live here)
  u16.fill(fill, hb + I);   // past the NUL terminator
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
