// fast-brotli-wasm as an ES module, like brotli-wasm's pkg.web/brotli_wasm.js:
// the default export init(input?) loads fastbrotli.wasm (next to this file,
// or from `input`: URL/string/Request/Response/bytes/WebAssembly.Module) and
// resolves to the wasm exports; the named exports work once it has resolved.
import { bind, BrotliStreamResultCode as Codes } from "./core.mjs";

export let compress;
export let decompress;
export let BrotliStreamResult;
export let CompressStream;
export let DecompressStream;
export const BrotliStreamResultCode = Codes;

let wasm;

async function load(input) {
  if (typeof Response === "function" && input instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return (await WebAssembly.instantiateStreaming(input.clone(), {})).instance;
      } catch {}
    }
    return (await WebAssembly.instantiate(await input.arrayBuffer(), {})).instance;
  }
  if (input instanceof WebAssembly.Module) return await WebAssembly.instantiate(input, {});
  return (await WebAssembly.instantiate(input, {})).instance;
}

export default async function init(input) {
  if (typeof input === "undefined") {
    input = new URL("fastbrotli.wasm", import.meta.url);
    // Node has no fetch() for file: URLs
    if (input.protocol === "file:" && typeof process === "object" && process.versions && process.versions.node) {
      const { readFile } = await import("node:fs/promises");
      input = await readFile(input);
    }
  }
  if (typeof input === "string" || (typeof Request === "function" && input instanceof Request) || (typeof URL === "function" && input instanceof URL)) {
    input = fetch(input);
  }
  const instance = await load(await input);
  wasm = instance.exports;
  const api = bind(wasm);
  ({ compress, decompress, BrotliStreamResult, CompressStream, DecompressStream } = api);
  init.__wbindgen_wasm_module = undefined;
  return wasm;
}
