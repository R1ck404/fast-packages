// Tables fastbrotli.wasm builds at run time instead of storing them (see
// tools/pack-tables.mjs, rust/vendor/brotli/src/enc/fast_tables.rs): they must
// not be in the module, and after the first encoder use (compress() or a
// CompressStream) each must be brotli-wasm 3.0.1's table bit for bit, i.e.
// appear verbatim in brotli-wasm's memory image.
// usage: node packages/fast-brotli-wasm/test/tables.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { memoryImage, findTable, TABLES } from "../tools/pack-tables.mjs";
import { bind } from "../core.mjs";

const require = createRequire(import.meta.url);
const orig = memoryImage(readFileSync(join(dirname(require.resolve("brotli-wasm")), "pkg.web", "brotli_wasm_bg.wasm")));
const fast = readFileSync(new URL("../fastbrotli.wasm", import.meta.url));

let checks = 0, failures = 0;
function check(ok, what) {
  checks++;
  if (!ok) {
    failures++;
    console.log("FAIL:", what);
  }
}
for (const name of Object.keys(TABLES)) {
  check(findTable(orig, name), `${name} not found in brotli-wasm`);
  check(!findTable(memoryImage(fast), name), `${name} is stored in fastbrotli.wasm`);
}
for (const use of ["compress q0", "compress q5", "compress q11", "CompressStream"]) {
  const W = new WebAssembly.Instance(new WebAssembly.Module(fast), {}).exports;
  const api = bind(W);
  for (const name of Object.keys(TABLES)) check(!findTable(Buffer.from(W.memory.buffer), name), `${name} built before the first encoder use`);
  if (use === "CompressStream") new api.CompressStream(9).free();
  else api.compress(new Uint8Array([1, 2, 3]), { quality: +use.slice(10) });
  const mem = Buffer.from(W.memory.buffer);
  for (const name of Object.keys(TABLES)) {
    const t = findTable(mem, name);
    check(t, `no ${name} after ${use}`);
    if (t) check(orig.indexOf(t) >= 0, `${name} after ${use} differs from brotli-wasm's`);
  }
}
console.log(`checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
