# @r1ck404/fast-esbuild-wasm

A faster drop-in replacement for [`esbuild-wasm@0.28.2`](https://www.npmjs.com/package/esbuild-wasm).
`transform()` in the browser build runs a JavaScript port of esbuild's
transform pipeline with **byte-identical output** (code and source maps),
and falls back to the official Go wasm for everything the port does not
cover. In the browser, transforms are 3-7.5x faster than esbuild-wasm (5-7.5x
on small and medium files, 3-4x on 1 MB files); small and medium files are
often faster than native esbuild through its child-process API.

Times and inputs: [benchmark results](https://github.com/R1ck404/fast-packages#results).

```jsonc
// package.json
"dependencies": { "esbuild-wasm": "npm:@r1ck404/fast-esbuild-wasm@0.28.2" }
```

Same files as esbuild-wasm: `lib/browser.js`, `lib/browser.min.js`,
`esm/browser.js`, `esm/browser.min.js` (all with the fast path),
`esbuild.wasm`, `lib/main.js`, `bin/esbuild`, types.

* **Browser** (`browser` field, `lib/browser*.js`, `esm/browser*.js`): the
  fast path. Worker mode works as before (Go runs in its worker; transforms the
  JS engine handles run in the calling thread).
* **Node** (`require("@r1ck404/fast-esbuild-wasm")`): esbuild-wasm's own Node API,
  unchanged (Go child process, `*Sync` APIs). For the fast path in Node use
  `@r1ck404/fast-esbuild-wasm/node.mjs`: the browser build's API in-thread (async
  only), with the bundled `esbuild.wasm` and `worker: false` by default.

## How it stays identical

* **Same glue.** The browser builds are esbuild-wasm's own with three small,
  mechanical patches (see `build.mjs`). Option validation, flag generation,
  error objects and result shaping are therefore esbuild's code.
* **Same protocol.** For a `transform` request the glue first asks the JS engine
  (`src/transform.mjs`). The engine consumes exactly the flag list esbuild's
  glue would send to the Go service and returns exactly the response packet the
  Go service would send back; that packet then flows through the unmodified
  response-handling code. If the engine declines, the request goes to the Go
  wasm as before.
* **Faithful port.** `src/` is a function-by-function translation of esbuild
  0.28.2's lexer, parser (parse + visit + TypeScript + lowering), printer,
  renamer, runtime, and the transform subset of bundler/linker/graph
  (~40k lines). Conventions and every deliberate deviation: `CONVENTIONS.md`.
* **Bail on anything not proven identical.** Every esbuild error or warning,
  every unsupported option (minify, input source maps, non-esnext targets,
  mangling, ...) and every unexpected state makes the engine bail, so the real
  esbuild produces the exact result, including messages.
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

Fast-path counters (tests/benchmarks):
`esbuild[Symbol.for("@r1ck404/fast-esbuild-wasm:stats")]` -> `{ fast, bail, error }`.

## Development

    node build.mjs            # lib/, esm/ (+ copies of the unchanged esbuild-wasm files)
    npm test                  # smoke + API parity (quick)
    npm run test:full         # corpus diff vs native esbuild, bail reasons, fuzz

* `test/diff.mjs` — differential test vs esbuild 0.28.2 on every JS/TS
  file of a large node_modules corpus under 18 option sets (preserve,
  Nodepod's esm->cjs options, esm, iife, ts, ts->cjs, Vite-style tsconfigRaw,
  jsx, tsx, source maps). `--dir <path> --no-nm` runs it on other source trees.
* `test/fuzz.mjs [--n N --seed S]` — randomized programs aimed at printer and
  lexer edge cases plus user code whose names collide with runtime helpers.
* `test/bailreasons.mjs` — inputs where esbuild succeeds without warnings but
  the engine still bails (should be none).
* `test/smoke.mjs` — targeted feature snippets with full output diffs.
* `test/api.mjs` — end-to-end through the patched glue vs esbuild-wasm
  (fast path, fallback, errors, warnings) and the export surface of all four
  browser builds.
* `tools/` — generators (`gen_runtime.mjs`, `gen_js_ident.mjs`), Go
  cross-checks (`numcheck`, `runtimecheck`), profiling and A/B helpers.
