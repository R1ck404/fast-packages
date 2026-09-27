// @r1ck404/fast-brotli-wasm as an ES module, like brotli-wasm's pkg.web/brotli_wasm.js:
// the default export init(input?) loads fastbrotli.wasm (fetched from next to
// this file, or from `input`: URL/string/Request/Response/bytes/
// WebAssembly.Module) and resolves to the wasm exports; the named exports
// work once it has resolved. (Node: see index.node.mjs / index.node.cjs.)
import { bind, BrotliStreamResultCode as Codes } from "./core.mjs";
import type { FastBrotliExports } from "./core.mjs";

type Api = ReturnType<typeof bind>;
/** what init() accepts, as in wasm-bindgen's web target */
export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export let compress: Api["compress"];
export let decompress: Api["decompress"];
export let BrotliStreamResult: Api["BrotliStreamResult"];
export let CompressStream: Api["CompressStream"];
export let DecompressStream: Api["DecompressStream"];
export const BrotliStreamResultCode = Codes;

let wasm: FastBrotliExports;

async function load(input: Response | BufferSource | WebAssembly.Module): Promise<WebAssembly.Instance> {
  if (typeof Response === "function" && input instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return (await WebAssembly.instantiateStreaming(input.clone(), {})).instance;
      } catch {}
    }
    return (await WebAssembly.instantiate(await input.arrayBuffer(), {})).instance;
  }
  if (input instanceof WebAssembly.Module) return await WebAssembly.instantiate(input, {});
  return (await WebAssembly.instantiate(input as BufferSource, {})).instance;
}

export default async function init(input?: InitInput | Promise<InitInput>): Promise<FastBrotliExports> {
  if (typeof input === "undefined") input = new URL("./fastbrotli.wasm", import.meta.url);
  if (typeof input === "string" || (typeof Request === "function" && input instanceof Request) || (typeof URL === "function" && input instanceof URL)) {
    input = fetch(input);
  }
  const instance = await load((await input) as Response | BufferSource | WebAssembly.Module);
  wasm = instance.exports as unknown as FastBrotliExports;
  const api = bind(wasm);
  ({ compress, decompress, BrotliStreamResult, CompressStream, DecompressStream } = api);
  (init as any).__wbindgen_wasm_module = undefined;
  return wasm;
}
