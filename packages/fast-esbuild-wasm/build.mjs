// Builds @r1ck404/fast-esbuild-wasm from the official esbuild-wasm 0.28.2 package
// (node_modules), with the same file layout:
//
//   lib/browser.js, lib/browser.min.js, esm/browser.js, esm/browser.min.js
//       = esbuild-wasm's browser builds with three small patches + the JS
//         transform engine (src/) bundled in (the .min files are the patched
//         builds minified)
//   lib/main.js, bin/esbuild, wasm_exec.js, wasm_exec_node.js, esbuild.wasm,
//   *.d.ts, LICENSE.md
//       = copied unchanged: in Node, `require("@r1ck404/fast-esbuild-wasm")` is
//         exactly esbuild-wasm (child process, *Sync APIs); node.mjs is the
//         fast in-thread alternative
//
// Patches to the browser glue (everything else is untouched, so option
// validation, flag generation, result shaping and every other API behave
// identically):
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
// Fast-path statistics (for tests and benchmarks) are a non-enumerable
// property of the module object: esbuild[Symbol.for("@r1ck404/fast-esbuild-wasm:stats")].
//
// usage: node packages/fast-esbuild-wasm/build.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuildWasmDir = dirname(require.resolve("esbuild-wasm/package.json"));
const STATS = `Symbol.for("@r1ck404/fast-esbuild-wasm:stats")`;

function patch(text, from, to, what) {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + 1) >= 0) throw new Error(`patch "${what}" did not match exactly once`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

function patchGlue(glue) {
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
  const argv = 'go.argv = ["", `--service=${"0.28.2"}`];';
  if (glue.split(argv).length !== 3) throw new Error(`patch "go.env" did not match exactly twice`);
  glue = glue.split(argv).join(
    argv + ' go.env = (typeof globalThis !== "undefined" && globalThis.__FAST_ESBUILD_GOENV__) || (typeof __FAST_GOENV__ !== "undefined" ? __FAST_GOENV__ : {});',
  );
  return glue;
}

// The engine, evaluated only on the first transform() so that loading the
// script and initialize() cost the same as the official package.
function engineDecls(engineCode, goenv) {
  return (
    `var __FAST_GOENV__ = ${JSON.stringify(goenv)};\n` +
    `var __fastEngineNS = null;\n` +
    `var __fastEngineInit = () => {\n${engineCode}\nreturn __fastEngine;\n};\n` +
    `var __fastTransform = (flags, input, mangleCache) => (__fastEngineNS || (__fastEngineNS = __fastEngineInit())).fastTransform(flags, input, mangleCache);\n` +
    `var __fastStats = { get fast() { return __fastEngineNS ? __fastEngineNS.stats.fast : 0; }, get bail() { return __fastEngineNS ? __fastEngineNS.stats.bail : 0; }, get error() { return __fastEngineNS ? __fastEngineNS.stats.error : 0; }, get lastError() { return __fastEngineNS ? __fastEngineNS.stats.lastError : null; } };\n`
  );
}

// lib/browser.js: a UMD wrapper; the engine goes at the top of its body
function buildLib(glue, decls) {
  let out = patchGlue(glue);
  const marker = `(module=>{\n"use strict";\n`;
  if (!out.startsWith(marker)) throw new Error("unexpected lib/browser.js prologue");
  out = patch(out, marker, marker + decls, "engine injection (lib)");
  return patch(
    out,
    `module.exports = __toCommonJS(browser_exports);`,
    `module.exports = __defProp(__toCommonJS(browser_exports), ${STATS}, { value: __fastStats });`,
    "stats (lib)",
  );
}

// esm/browser.js: an ES module; the engine goes at the top
function buildEsm(glue, decls) {
  let out = decls + patchGlue(glue);
  return patch(
    out,
    `var browser_default = browser_exports;`,
    `__defProp(browser_exports, ${STATS}, { value: __fastStats });\nvar browser_default = browser_exports;`,
    "stats (esm)",
  );
}

async function main() {
  const esbuild = require("esbuild");
  const { version } = JSON.parse(readFileSync(join(esbuildWasmDir, "package.json"), "utf8"));
  if (version !== "0.28.2") throw new Error("expected esbuild-wasm 0.28.2, found " + version);
  const goenv = process.env.FAST_ESBUILD_GOGC ? { GOGC: process.env.FAST_ESBUILD_GOGC } : {};

  // the engine as a function expression (iife assigning __fastEngine)
  const engine = await esbuild.build({
    entryPoints: [join(here, "src/transform.mjs")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__fastEngine",
    target: "es2022",
    legalComments: "none",
  });
  const decls = engineDecls(engine.outputFiles[0].text, goenv);

  mkdirSync(join(here, "lib"), { recursive: true });
  mkdirSync(join(here, "esm"), { recursive: true });
  mkdirSync(join(here, "bin"), { recursive: true });
  const outputs = {
    "lib/browser.js": buildLib(readFileSync(join(esbuildWasmDir, "lib/browser.js"), "utf8"), decls),
    "esm/browser.js": buildEsm(readFileSync(join(esbuildWasmDir, "esm/browser.js"), "utf8"), decls),
  };
  // minified like the official .min.js files (same syntax target)
  outputs["lib/browser.min.js"] = esbuild.transformSync(outputs["lib/browser.js"], { minify: true, target: "es2022", legalComments: "none" }).code;
  outputs["esm/browser.min.js"] = esbuild.transformSync(outputs["esm/browser.js"], { minify: true, format: "esm", target: "es2022", legalComments: "none" }).code;
  for (const [file, code] of Object.entries(outputs)) {
    writeFileSync(join(here, file), code);
    console.log(`${file}: ${(code.length / 1024).toFixed(0)} KB`);
  }
  // unchanged upstream files
  for (const file of ["esbuild.wasm", "lib/main.js", "lib/main.d.ts", "lib/browser.d.ts", "esm/browser.d.ts", "bin/esbuild", "wasm_exec.js", "wasm_exec_node.js", "LICENSE.md"])
    copyFileSync(join(esbuildWasmDir, file), join(here, file));
  console.log("copied esbuild.wasm, lib/main.js, bin/esbuild, wasm_exec*.js, *.d.ts, LICENSE.md from esbuild-wasm " + version);
}

await main();
