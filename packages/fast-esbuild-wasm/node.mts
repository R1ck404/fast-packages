// @r1ck404/fast-esbuild-wasm/node.mjs: esbuild-wasm's browser API
// (lib/browser.js) in Node, with the engine in this thread: async
// transform() / build() / context() etc.; the *Sync APIs throw like in the
// browser. It differs from the browser build in two defaults: it uses the
// real file system (Node's fs module), with the process's working directory
// as the default "absWorkingDir", and initialize() needs no "wasmURL" or
// "wasmModule" (there is no Go binary; given ones are validated and ignored,
// like in the browser build). "worker" defaults to false.
// (`require("@r1ck404/fast-esbuild-wasm")` is esbuild-wasm's own Node API,
// *Sync APIs included.)
import * as fs from "node:fs";
import { createRequire } from "node:module";
import type * as esbuildTypes from "esbuild-wasm";

const require = createRequire(import.meta.url);
(globalThis as any).self ??= globalThis;
// (lib/browser.js has the same API as esbuild-wasm)
const esbuild: typeof esbuildTypes = require("./lib/browser.js");
const STATS = Symbol.for("@r1ck404/fast-esbuild-wasm:stats");
const NODE = Symbol.for("@r1ck404/fast-esbuild-wasm:node");
const glue: { warmup(steps: number): void; setNodeHost(host: { fs: any; cwd: string } | null): void; initialized(): boolean } = (esbuild as any)[NODE];

export function initialize(options: esbuildTypes.InitializeOptions = {}): Promise<void> {
  options = { ...options };
  if (options.worker === undefined) options.worker = false;
  // (esbuild's glue requires one of the two: this one names no file)
  if (!options.wasmModule && !options.wasmURL) options.wasmURL = "esbuild.wasm";
  glue.setNodeHost({ fs, cwd: process.cwd() });
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

export default Object.defineProperty({ ...esbuild, initialize }, STATS, { value: (esbuild as any)[STATS] });
