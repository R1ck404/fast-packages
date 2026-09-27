// @r1ck404/fast-esbuild-wasm/node.mjs: the fast engine in Node, in-thread. The same
// API as esbuild-wasm's browser build (lib/browser.js): async transform() /
// build() / context() etc., the *Sync APIs throw like in the browser. By
// default it runs the Go wasm in this thread (worker: false) and uses the
// bundled esbuild.wasm when no wasmURL/wasmModule is given.
// (`require("@r1ck404/fast-esbuild-wasm")` is esbuild-wasm's own Node API instead:
// a Go child process, *Sync APIs included, no JS fast path.)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.self ??= globalThis;
const esbuild = require("./lib/browser.js");
const STATS = Symbol.for("@r1ck404/fast-esbuild-wasm:stats");

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
} = esbuild;

export default Object.defineProperty({ ...esbuild, initialize }, STATS, { value: esbuild[STATS] });
