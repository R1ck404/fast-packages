// End-to-end check through the patched glue (Node, worker:false): fast path,
// fallback path, error path and result shape vs esbuild-wasm.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
globalThis.self ??= globalThis;
const fast = await import("../node.mjs");
await fast.initialize({});
const ref = require("esbuild-wasm/lib/browser.js");
await ref.initialize({ wasmModule: new WebAssembly.Module(readFileSync(require.resolve("esbuild-wasm/esbuild.wasm"))), worker: false });

const lone = String.fromCharCode(0xd800);
const cases = [
  // lone surrogates in flag values reach Go as U+FFFD (UTF-8 encoded flags)
  ["a", { banner: "/* " + lone + " */" }],
  ["x", { define: { x: JSON.stringify("s" + lone) } }],
  ["a", { footer: "//" + lone }],
  ["export const a = 1", { loader: "js", format: "cjs" }],
  ["let x: number = 1; export default x", { loader: "ts" }],
  ["const a = <div/>", { loader: "jsx", jsx: "automatic" }],
  ["module.exports = 1", { format: "esm" }], // warning -> fallback to Go
  ["let = ", {}], // syntax error -> fallback -> error
  ["x", { minify: true }], // unsupported option -> fallback
  ["/*! legal */ a()", { legalComments: "eof" }],
  ["a", { banner: "/* b */", footer: "/* f */" }],
  ["﻿let a = 1", {}],
  [new TextEncoder().encode("export let b = 'café'"), { format: "cjs", charset: "utf8" }],
  // source maps: external (result.map) and inline + external (data URL comment)
  ["export const a = 1;\nfunction f(x) {\n  return x * 2;\n}\nconsole.log(f(a));\n", { loader: "js", format: "cjs", sourcemap: true, sourcefile: "a.js" }],
  ["let x: number = 1;\r\nexport default `\n${x}` // \u{1F600}\n", { loader: "ts", sourcemap: "both", sourcesContent: false, sourceRoot: "/src/" }],
  // tsconfigRaw: object form (JSON.stringify'd by the glue), JSONC string form,
  // and an invalid value (warning -> fallback to Go)
  ["class A { constructor(private x: number) {} y = 1; declare z: string }\n@dec class B { @m m(@p a) {} }", { loader: "ts", tsconfigRaw: { compilerOptions: { useDefineForClassFields: false, experimentalDecorators: true, alwaysStrict: true } } }],
  ["import { T } from 't'; export const a = <div>{1}</div>", { loader: "tsx", tsconfigRaw: '{ /* c */ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "preact", "verbatimModuleSyntax": true, }, }' }],
  ["x()", { loader: "ts", tsconfigRaw: { compilerOptions: { target: "es2099" } } }],
];
let ok = 0;
for (const [input, opts] of cases) {
  const run = async (lib) => {
    try {
      return { res: await lib.transform(input, opts) };
    } catch (e) {
      return { err: e.message };
    }
  };
  const a = await run(ref);
  const b = await run(fast);
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (same) ok++;
  else console.log("DIFF", JSON.stringify(input).slice(0, 40), opts, "\n  ref:", JSON.stringify(a).slice(0, 300), "\n  fast:", JSON.stringify(b).slice(0, 300));
}
const stats = fast.default[Symbol.for("@r1ck404/fast-esbuild-wasm:stats")];
console.log(`${ok}/${cases.length} identical`, { fast: stats.fast, bail: stats.bail, error: stats.error });

// the public surface is esbuild-wasm's: same export names in every build
const keys = (m) => Object.keys(m).sort().join(",");
const surfaces = [
  ["lib/browser.js", keys(require("../lib/browser.js")), keys(ref)],
  ["lib/browser.min.js", keys(require("../lib/browser.min.js")), keys(require("esbuild-wasm/lib/browser.min.js"))],
  ["esm/browser.js", keys(await import("../esm/browser.js")), keys(await import("esbuild-wasm/esm/browser.js"))],
  ["esm/browser.min.js", keys(await import("../esm/browser.min.js")), keys(await import("esbuild-wasm/esm/browser.min.js"))],
];
let surfaceBad = 0;
for (const [name, a, b] of surfaces) if (a !== b) (surfaceBad++, console.log("EXPORTS DIFFER", name, a, "vs", b));
console.log(`export surface: ${surfaces.length - surfaceBad}/${surfaces.length} identical`);
if (surfaceBad) process.exitCode = 1;
process.exit(0);
