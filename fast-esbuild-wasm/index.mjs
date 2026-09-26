// Node entry point for experiments/benchmarks: the same API as esbuild-wasm's
// browser build (lib/browser.js), defaulting to the in-thread Go instance
// (worker: false) and to the bundled esbuild.wasm when no wasmURL/wasmModule
// is given.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.self ??= globalThis;
const esbuild = require("./lib/browser.js");

export function initialize(options = {}) {
  options = { ...options };
  if (!options.wasmModule && !options.wasmURL) {
    options.wasmModule = new WebAssembly.Module(readFileSync(new URL("./esbuild.wasm", import.meta.url)));
  }
  if (options.worker === undefined) options.worker = false;
  return esbuild.initialize(options);
}

export const {
  analyzeMetafile,
  analyzeMetafileSync,
  build,
  buildSync,
  context,
  formatMessages,
  formatMessagesSync,
  stop,
  transform,
  transformSync,
  version,
  fastStats,
} = esbuild;

export default { ...esbuild, initialize };
