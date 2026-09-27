# fast-esbuild-wasm (experiment)

A drop-in replacement for `esbuild-wasm@0.28.2` whose `transform()` runs a
JavaScript port of esbuild's transform pipeline instead of the Go wasm binary,
falling back to the real esbuild-wasm for everything the port does not cover.

## How it stays identical

* **Same glue.** `lib/browser.js` is esbuild-wasm's own `lib/browser.js` with
  three small, mechanical patches (see `build.mjs`). Option validation, flag
  generation, error objects and result shaping are therefore esbuild's code.
* **Same protocol.** For a `transform` request the glue first asks the JS engine
  (`src/transform.mjs`). The engine consumes exactly the flag list esbuild's
  glue would send to the Go service and returns exactly the response packet the
  Go service would send back; that packet then flows through the unmodified
  response-handling code. If the engine declines (returns `undefined`), the
  request goes to the Go wasm as before.
* **Faithful port.** `src/` is a function-by-function translation of esbuild
  0.28.2's lexer, parser (parse + visit + TypeScript + lowering), printer,
  renamer, runtime, and the transform subset of bundler/linker/graph
  (~40k lines). Conventions: `CONVENTIONS.md`.
* **Bail on anything not proven identical.** Every esbuild error or warning,
  every unsupported option (minify, input source maps, non-esnext targets,
  mangling, ...) and every unexpected state makes the engine bail,
  so the real esbuild produces the exact result, including messages.
* **Everything else is untouched**: `build`, `context`, `formatMessages`,
  `analyzeMetafile`, and all bailed transforms run in the official
  `esbuild.wasm` (copied byte-for-byte).

Supported fast-path options: `loader` js/jsx/ts/tsx, `format`
(preserve/esm/cjs/iife), `target` unset or `esnext`, `platform`, `define`,
`jsx*`, `charset`, `treeShaking`, `ignoreAnnotations`, `legalComments`
none/inline/eof, `globalName`, `banner`/`footer`, `sourcefile`, log options,
`sourcemap` true/external/inline/both with `sourcesContent` and `sourceRoot`
(inputs whose `//# sourceMappingURL=` comment could load an input source map,
e.g. a data URL, bail), `tsconfigRaw` (string or object; JSONC parsed like
esbuild, all `compilerOptions` esbuild reads for a transform; any tsconfig
warning or error bails).

## Verification

* `node test/diff.mjs` — differential test vs esbuild 0.28.2 on every JS/TS
  file of a large node_modules corpus under several option sets
  (preserve, Nodepod's esm->cjs options, esm, iife, ts, ts->cjs, jsx, tsx).
  `--dir <path> --no-nm` runs it on other source trees (e.g. TS/TSX
  projects) without their node_modules.
* `node test/fuzz.mjs [--n N --seed S]` — randomized programs aimed at the
  printer and lexer edge cases (string/template escapes, surrogates, U+2028,
  "</script", charset ascii/utf8, source maps over non-ASCII text, JSX text)
  plus user code whose names collide with the runtime helpers, vs esbuild.
* `node test/bailreasons.mjs` — reports inputs where esbuild succeeds without
  warnings but the engine still bails (should be none).
* `node test/smoke.mjs` — targeted feature snippets with full output diffs.
* `node test/api.mjs` — end-to-end through the patched glue vs esbuild-wasm,
  including fallback, error and warning paths.
* The ports were additionally checked against esbuild's own Go parser test
  expectations (2,396 of 2,413 byte-identical; the rest bail on warnings) and
  the numeric folding helpers against esbuild's Go code compiled to wasm
  (1.46M checks).

## Build

    node build.mjs            # lib/browser.js + esbuild.wasm
    node build.mjs --minify   # smaller engine for the browser

`index.mjs` is a Node entry point (in-thread Go instance, bundled wasm) used by
the benchmarks.
