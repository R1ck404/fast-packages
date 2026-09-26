// Builds fast-esbuild-wasm from the official esbuild-wasm 0.28.2 package:
//
//   lib/browser.js  = esbuild-wasm/lib/browser.js with three small patches
//                     + the JS transform engine (src/) bundled in
//   esbuild.wasm    = the official esbuild.wasm, byte-identical
//
// Patches to the glue (everything else is untouched, so option validation,
// flag generation, result shaping and every other API behave identically):
//   1. transform(): before sending a "transform" request to the Go service,
//      ask the JS engine; if it handles the request it returns the exact
//      response packet Go would have sent, which then flows through the same
//      response-handling code. Otherwise the request goes to Go as usual.
//   2. worker:false mode: deliver messages to the in-thread Go instance with
//      queueMicrotask instead of setTimeout (setTimeout is clamped to ~4ms in
//      browsers and to the OS timer granularity, e.g. 15.6ms on Windows, in
//      Node). Safe because the Go instance only runs after the JS stack
//      unwinds either way.
//   3. go.env: optional GOGC for the Go runtime (set via FAST_ESBUILD_GOGC
//      at build time or globalThis.__FAST_ESBUILD_GOENV__ at run time).
//
// usage: node build.mjs [--minify]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuildWasmDir = dirname(require.resolve("esbuild-wasm/package.json"));
const minify = process.argv.includes("--minify");

function patch(text, from, to, what) {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + 1) >= 0) throw new Error(`patch "${what}" did not match exactly once`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

export function patchGlue(glue) {
  // 1. The transform fast path
  glue = patch(
    glue,
    `        let request = {
          command: "transform",
          flags,
          inputFS: inputPath !== null,
          input: inputPath !== null ? encodeUTF8(inputPath) : typeof input === "string" ? encodeUTF8(input) : input
        };
        if (mangleCache) request.mangleCache = mangleCache;
        sendRequest(refs, request, (error, response) => {`,
    `        let fastResponse = inputPath === null ? __fastTransform(flags, input, mangleCache) : void 0;
        let request = fastResponse !== void 0 ? null : {
          command: "transform",
          flags,
          inputFS: inputPath !== null,
          input: inputPath !== null ? encodeUTF8(inputPath) : typeof input === "string" ? encodeUTF8(input) : input
        };
        if (request !== null && mangleCache) request.mangleCache = mangleCache;
        (fastResponse !== void 0 ? (cb) => queueMicrotask(() => cb(null, fastResponse)) : (cb) => sendRequest(refs, request, cb))((error, response) => {`,
    "transform fast path",
  );

  // 2. worker:false message delivery
  glue = patch(glue, `      postMessage: (data) => setTimeout(() => {`, `      postMessage: (data) => queueMicrotask(() => {`, "microtask delivery");

  // 3. Go runtime environment (both the worker and the in-thread copy)
  glue = glue.split('go.argv = ["", `--service=${"0.28.2"}`];').join(
    'go.argv = ["", `--service=${"0.28.2"}`]; go.env = (typeof globalThis !== "undefined" && globalThis.__FAST_ESBUILD_GOENV__) || (typeof __FAST_GOENV__ !== "undefined" ? __FAST_GOENV__ : {});',
  );
  return glue;
}

async function main() {
  const esbuild = require("esbuild");
  const glue = readFileSync(join(esbuildWasmDir, "lib/browser.js"), "utf8");
  const goenv = process.env.FAST_ESBUILD_GOGC ? { GOGC: process.env.FAST_ESBUILD_GOGC } : {};

  // Bundle the engine into a function expression
  const engine = await esbuild.build({
    entryPoints: [join(here, "src/transform.mjs")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__fastEngine",
    target: "es2022",
    minify,
    legalComments: "none",
  });
  const engineCode = engine.outputFiles[0].text;

  let patched = patchGlue(glue);
  // Insert the engine at the top of the UMD wrapper's body so that
  // __fastTransform is a local binding.
  const marker = `(module=>{\n"use strict";\n`;
  if (!patched.startsWith(marker)) throw new Error("unexpected glue prologue");
  patched = patch(
    patched,
    marker,
    marker +
      `var __FAST_GOENV__ = ${JSON.stringify(goenv)};\n` +
      // The engine is only evaluated on the first transform() so loading the
      // script and initialize() cost the same as the official package.
      `var __fastEngineNS = null;\n` +
      `var __fastEngineInit = () => {\n${engineCode}\nreturn __fastEngine;\n};\n` +
      `var __fastTransform = (flags, input, mangleCache) => (__fastEngineNS || (__fastEngineNS = __fastEngineInit())).fastTransform(flags, input, mangleCache);\n` +
      `var __fastStats = { get fast() { return __fastEngineNS ? __fastEngineNS.stats.fast : 0; }, get bail() { return __fastEngineNS ? __fastEngineNS.stats.bail : 0; }, get error() { return __fastEngineNS ? __fastEngineNS.stats.error : 0; }, get lastError() { return __fastEngineNS ? __fastEngineNS.stats.lastError : null; } };\n`,
    "engine injection",
  );
  // Expose the fast-path statistics for tests/benchmarks
  patched = patch(patched, `var version = "0.28.2";`, `var version = "0.28.2";\nvar fastStats = __fastStats;`, "stats export");
  patched = patch(patched, `  version: () => version`, `  fastStats: () => fastStats,\n  version: () => version`, "stats export 2");

  mkdirSync(join(here, "lib"), { recursive: true });
  writeFileSync(join(here, "lib/browser.js"), patched);
  copyFileSync(join(esbuildWasmDir, "esbuild.wasm"), join(here, "esbuild.wasm"));
  console.log(`lib/browser.js: ${(patched.length / 1024).toFixed(0)} KB (engine ${(engineCode.length / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
