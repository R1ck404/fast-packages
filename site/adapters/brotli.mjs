// `impl` is brotli-wasm or @r1ck404/fast-brotli-wasm; both resolve to the module once their wasm is loaded.
import brotliPromise from "impl";

export async function load() {
  const brotli = await brotliPromise;
  return {
    compress: (data, options) => brotli.compress(data, options),
    decompress: (data) => brotli.decompress(data),
  };
}
