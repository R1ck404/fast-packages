// Direct access to a fastbrotli wasm build (no JS glue): for tests/benchmarks.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const defaultWasm = join(here, "../fastbrotli.wasm");

export function loadRaw(path = defaultWasm) {
  const W = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(path)), {}).exports;
  const H = W.hdr() >> 2;
  function call(name, input, ...args) {
    const p = W.alloc(input.length);
    new Uint8Array(W.memory.buffer).set(input, p);
    const st = W[name](p, input.length, ...args);
    W.free(p, input.length);
    const h = new Uint32Array(W.memory.buffer);
    const out = new Uint8Array(W.memory.buffer, h[H], h[H + 1]).slice();
    W.release();
    if (st !== 0) throw new TextDecoder().decode(out);
    return out;
  }
  return {
    W,
    compress: (buf, q = 11) => call("compress", buf, q),
    decompress: (buf) => call("decompress", buf),
  };
}
