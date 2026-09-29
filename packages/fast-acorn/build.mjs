// Builds index.mjs, the module @r1ck404/fast-acorn ships, from the sources in
// src/ (TypeScript, turned into src/*.mjs by tools/ts-build.mjs): one file
// (rollup), minified (esbuild's minifier). One file because Node's module
// loader costs about 0.4 ms per module, and minified because V8 then parses
// less: together that makes importing it about as fast as importing acorn.
//
// Rollup, not esbuild's bundler: esbuild turns top-level `const` into `var`
// (and `const f = function` into function declarations) when it bundles,
// and the parser's functions are `const` bindings because V8 runs calls to
// them faster (about 10% on whole parses). esbuild's minifier on its own
// keeps them.
//
// Not included: generic.cjs (acorn's own parser code, for the plugins the
// fast parser does not recognise), which index.mjs loads on demand in Node
// and full.mjs installs up front.
//
// usage: node packages/fast-acorn/build.mjs [--check]
import { rollup } from "rollup";
import { transformSync } from "esbuild";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "index.mjs");

const bundle = await rollup({
  input: join(here, "src/index.mjs"),
  onwarn(w) {
    throw new Error("rollup: " + w.message);
  },
});
const { output } = await bundle.generate({ format: "es" });
await bundle.close();
if (output.length !== 1) throw new Error("expected one chunk");
let js = transformSync(output[0].code, {
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "none",
  charset: "ascii",
}).code;
// src/index.mjs finds generic.cjs one directory up; index.mjs next to it
const from = '"../generic.cjs"';
if (js.split(from).length !== 2) throw new Error("expected " + from + " exactly once in the bundle");
js = js.replace(from, '"./generic.cjs"');
js =
  "// @r1ck404/fast-acorn " +
  JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version +
  " (MIT; see LICENSE). Built from src/ by build.mjs: edit the sources there.\n" +
  js;

if (process.argv.includes("--check")) {
  const cur = existsSync(out) ? readFileSync(out, "utf8") : null;
  if (cur !== js) {
    console.log("packages/fast-acorn/index.mjs is out of date (run node packages/fast-acorn/build.mjs)");
    process.exit(1);
  }
  console.log("fast-acorn build: index.mjs up to date");
} else {
  writeFileSync(out, js);
  console.log(`wrote index.mjs (${js.length} bytes)`);
}
