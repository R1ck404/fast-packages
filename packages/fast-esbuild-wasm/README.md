# @r1ck404/fast-esbuild-wasm

Long ASCII string literals scan their tail with a native regular expression after a 128-character prefix. Escapes, non-ASCII text and template interpolation resume the existing scanner. This targets long literals; it is not a general transform speedup.

A faster drop-in replacement for [`esbuild-wasm@0.28.2`](https://www.npmjs.com/package/esbuild-wasm):
esbuild ported to JavaScript. Every API (`transform`, `build`, `context`
with watch mode, plugins, `formatMessages`, `analyzeMetafile`, the `*Sync`
calls, the command line) produces **byte-identical output** (code, source
maps, metafiles, hashes) with the same messages as esbuild-wasm, and there is
**no WebAssembly binary**: nothing runs Go, nothing is downloaded or
compiled. In the browser, transforms are 3-7.5x faster than esbuild-wasm
(5-7.5x on small and medium files, 3-4x on 1 MB files) and builds 3-9.5x.

Times and inputs: [benchmark results](https://github.com/R1ck404/fast-packages#results).

```jsonc
// package.json
"dependencies": { "esbuild-wasm": "npm:@r1ck404/fast-esbuild-wasm@0.28.5" }
```

Same files as esbuild-wasm minus the Go binary and its glue:
`lib/browser.js`, `lib/browser.min.js`, `esm/browser.js`,
`esm/browser.min.js`, `lib/main.js`, `bin/esbuild`, types, plus `node.mjs`.

* **Browser** (`browser` field, `lib/browser*.js`, `esm/browser*.js`):
  esbuild-wasm's API, running the port. `initialize()` validates `wasmURL`,
  `wasmModule` and `worker` exactly like esbuild-wasm (same errors) and then
  ignores the binary: it is never fetched or compiled, so any
  `WebAssembly.Module` and any URL are accepted. In worker mode (the default)
  transforms run in a worker of their own, so a transform does not block the
  page for long, and inputs up to 64 KB run in the page once its copy of the
  engine has warmed up in idle time (see [Where the engine
  runs](#where-the-engine-runs)). The file system is Go's view in
  esbuild-wasm: none (paths come from plugins), or `globalThis.fs` with
  `worker: false` when it is set.
* **Node** (`require("@r1ck404/fast-esbuild-wasm")`, `lib/main.js`):
  esbuild-wasm's Node API with the real file system. The service that
  esbuild's JavaScript code talks to runs in this process (in a worker
  thread with a large stack) instead of a Go child process; the `*Sync` calls
  are synchronous and start no process. `@r1ck404/fast-esbuild-wasm/node.mjs`
  is the browser build's API in this thread, with the real file system.
* **Command line** (`bin/esbuild`): esbuild's `cmd/esbuild`, ported, as
  esbuild-wasm's (the WebAssembly build's flags and messages: `--serve` is not
  supported, `--trace`/`--heap`/`--cpuprofile` report that).

## How it stays identical

* **Same glue.** The builds are esbuild-wasm's own with a few small,
  mechanical patches (see `build.mjs`): option validation, flag generation,
  error objects, result shaping and the plugin protocol are esbuild's code.
* **Same protocol.** What esbuild's JavaScript code writes to Go's stdin goes
  to the port of esbuild's service (`src/service.mjs`, cmd/esbuild/service.go),
  in the same packets; its answers come back the same way. A `transform`
  request is first offered to a shortcut (`src/transform.mjs`) that returns the
  exact response packet the service would send.
* **Faithful port.** `src/` is a function-by-function translation of esbuild
  0.28.2 (~100k lines): lexer, parser (parse, visit, TypeScript, lowering),
  printer, renamer, runtime, the CSS pipeline, bundler, linker, resolver
  (with Yarn Plug'n'Play, `.zip` archives included), Go's file system layer,
  the build API with plugins, watch mode, the service and the command line, and
  the parts of Go's standard library whose behaviour shows (number formatting
  and parsing, `math`, Unicode tables, `regexp`, `archive/zip`,
  `compress/flate`, URL parsing). Conventions and every deliberate deviation:
  `CONVENTIONS.md`.
* **Messages too.** Errors, warnings, the console output at every `logLevel`
  (both `logStyle`s, `color`), the resolver's debug logs at `debug`/`verbose`,
  the build summary at `info`, and Go's panics where esbuild recovers them.
* **Go on js/wasm**: where Go's behaviour depends on the platform (float to
  int conversions, `math` without assembly, the error texts of the file
  system, `GOOS=js` defaults), the port follows esbuild-wasm, not native
  esbuild.

## Differences from esbuild-wasm

* `initialize()` never loads a binary (see above): a `wasmURL` that cannot be
  downloaded or a `wasmModule` that is not esbuild's does not make it reject.
* Worker mode in the browser: esbuild-wasm runs Go (everything) in its worker;
  here transforms run in the engine's worker and builds run in the page (they
  are asynchronous, but their work is done on the page's thread).
* Nesting depth: the browser builds and `node.mjs` run in the calling
  thread, whose JavaScript stack is small and fixed. Input nested more deeply
  than it allows (a few hundred to a few thousand levels, depending on the
  construct) is parsed, printed or transformed again in "deep mode"
  (`src/deep.mts`): the build gives every recursive function of the engine a
  generator copy that runs on an explicit stack, so the depth is limited by
  memory instead. Every construct `test/depth.mjs` measures (arrays,
  objects, `if`/`else` chains, blocks, functions, arrows, calls, member and
  optional chains, parentheses, templates, classes, unary operators,
  assignment/binary/logical/comma/ternary chains, `new`, destructuring, JSX,
  TypeScript types, CSS nesting, blocks, `@media`, functions, `calc()`,
  `:is()`, JSON) goes at least twice as deep as esbuild-wasm in the calling
  thread (e.g. 16384+ nested arrays vs 6016, 20992+ member accesses vs
  10496), for `transform` and `build`; a few stop earlier at a limit that is
  not the stack's (nested blocks, functions, classes and CSS rules at about
  16000 or 8000 levels: the output, indented once per level, would not fit
  in a JavaScript string). Deep mode is 2 to 20 times slower than the normal
  code and only runs for the input that needs it. Beyond its limit (400000
  suspended calls, ~130000 nested arrays, ~500 MB) the result is esbuild's
  panic message (`runtime error: stack overflow (the input is nested too
  deeply for the JavaScript call stack)`), where esbuild-wasm fails with
  `Maximum call stack size exceeded` and its Go program exits. `lib/main.js`
  and `bin/esbuild` run the service in a worker thread with a 1 GB stack as
  well.
* A build input ending in a truncated UTF-8 sequence with a source map makes
  Go's `helpers.QuoteForJSON` loop forever (esbuild hangs); the port reports a
  panic instead.
* Panic messages show the JavaScript stack where Go shows its goroutine trace.
* Raw bytes of invalid UTF-8 are carried as the lone surrogates
  U+DC80..U+DCFF, so a genuine lone surrogate in that range in a string
  value is printed as that byte.
* `--timing` (a hidden debugging flag): the timings of chunks that Go
  generates in parallel are listed in chunk order.
* `buildSync()` where `worker_threads` is unavailable runs the package's own
  `bin/esbuild` as a child process (the build API is asynchronous), where
  esbuild-wasm runs its Go binary.

## Statistics

`esbuild[Symbol.for("@r1ck404/fast-esbuild-wasm:stats")]` (a non-enumerable
property of the module object; with `node.mjs`, of its default export):

| field | |
|---|---|
| `fast` | transforms the shortcut answered |
| `error` | transforms passed on to the service because the shortcut threw (a Go panic, which the service then reports like esbuild, or a bug; please report) |
| `lastError` | the exception behind the most recent `error` (from the worker: `{ message, stack }`) |
| `engineIn` | where transforms run: `"worker"`, `"thread"` or `null` before `initialize()` |
| `smallInThread` | worker mode: small inputs now run in the page |
| `fs` | the service's file system: `"none"`, `"globalThis.fs"` or `"node"` (browser builds) |

## Where the engine runs

* `worker: false`: in the calling thread.
* worker mode (the default): a worker for the engine,
  which compiles and warms it up (a few representative transforms, one per
  task). Transforms are posted to it; inputs up to 64 KB run in the page
  until the worker has started and run its first warm-up step, and again once
  the page's copy of the engine has warmed up (in idle time,
  `requestIdleCallback`, one step at a time, only while no transform is in
  flight): in Chromium a round trip to a worker costs ~50 us plus ~2 us per
  KB, 40% of a 1.6 KB transform and 7% of an 80 KB one. If the worker cannot
  be created (e.g. a Content-Security-Policy) or fails, everything runs in the
  page. The service (builds, `formatMessages`, ...) runs in the page.
* `initialize({ serviceInWorker: true })` (worker mode): the service runs in
  the engine's worker too, as esbuild-wasm's Go service does in its worker:
  `build()`, `context()`, `formatMessages()` and the plugin protocol are
  handled there, and the page only forwards packets. A bundle then does not
  occupy the page's thread (plugin callbacks still run in the page, like in
  esbuild-wasm). Off by default: a small build is quicker in the page, since
  the worker has to start its engine first.
* `initialize({ smallInput: n })` (worker mode): the size up to which a
  transform runs in the page instead of the worker (default 65536; `-1` sends
  every transform to the worker).
* `lib/main.js`: transforms in the calling thread; the service in a worker
  thread with a large stack (a transform nested too deeply for the calling
  thread goes there too).

`initialize()` resolves at once (under 1 ms): the engine, its service and
the engine's worker are created in a task right after it, or by the first
call if that comes first. The first transform is fast: the engine is
compiled while the script loads (a parenthesized function, which V8 compiles
eagerly; the engine in the builds that are not minified is compacted too,
keeping the names of its functions and classes), and esbuild's runtime
helpers are not parsed at run time (the build bakes in a snapshot of their
AST, `src/snapshot.mjs`, checked against a fresh parse by the tests; it is
for target `esnext` without `minifySyntax`/`minifyIdentifiers`, other options
parse the runtime on their first use).

## Development

    node build.mjs            # lib/, esm/, bin/ (+ copies of the unchanged esbuild-wasm files)
    npm test                  # smoke, browser-build API parity, nothing runs Go
    npm run test:full         # every suite below except resolve-diff and browser

Every suite compares with the original packages: esbuild-wasm 0.28.2 (its
browser build, its Node API, its command line) or native esbuild 0.28.2 where
the two agree (esbuild-wasm is slower, and crashes on deeply nested input).

* `test/no-go.mjs` — nothing runs Go: the published files (`npm pack`) have
  no Go binary or glue, the builds contain none of Go's support code, every
  API (browser builds, `lib/main.js` with its worker threads, `bin/esbuild`)
  instantiates no WebAssembly module importing Go's runtime and starts no
  child process, and no fallback path is left in `src/`.
* `test/api.mjs` — the browser builds through the patched glue vs
  esbuild-wasm's, in-thread (`node.mjs`, `lib/browser.min.js`) and in worker
  mode (`esm/browser.js` with a Web Worker over `worker_threads`,
  `test/webworker.mjs`): ~60 transform cases, concurrent transforms, builds,
  contexts, `formatMessages`, `analyzeMetafile`, `stop()`/`initialize()`,
  `initialize()`'s errors, a blocked or failing engine worker, the warm-up
  steps, the runtime snapshot's keys, and the export surface of every build.
* `test/node-api.mjs` — `lib/main.js` vs esbuild-wasm's: `transform(Sync)`,
  `build(Sync)` (`write: false` and `true`), plugins, `formatMessages(Sync)`,
  `analyzeMetafile(Sync)`, `context()` with rebuild, cancel, dispose and watch
  mode picking up a change, a build of 5001 files, deeply nested input (vs
  native esbuild), `initialize()`, and that a script exits on its own.
* `test/cli.mjs` — `bin/esbuild` vs esbuild-wasm's (50 command lines: stdin,
  bundles, outfile/outdir, metafile and `--analyze`, splitting, errors,
  warnings, log levels up to `debug`, `--color`, mangle cache, legal
  comments, `--serve`, the unsupported flags): exit code, stdout, stderr and
  every file written.
* `test/diff.mjs` — transforms vs esbuild 0.28.2 on every JS/TS file of a
  large node_modules corpus under ~100 option sets (formats, Vite's options,
  defines, `supported`, jsx/tsx, source maps, minify variants, targets).
* `test/css-diff.mjs`, `test/css-fuzz.mjs` — CSS transforms on every
  stylesheet of the corpus and esbuild's own CSS tests, and random
  stylesheets.
* `test/fuzz.mjs` — random programs aimed at the printer, the lexer, the
  minifier and the lowering passes.
* `test/messages.mjs` — errors, warnings and the console output of each kind
  of message under every log setting, esbuild's parser and bundler test
  inputs, mutated files, `formatMessages`, `analyzeMetafile`, and builds with
  invalid options and plugins returning invalid results.
* `test/build-diff.mjs [--fs real]`, `test/build-css.mjs`,
  `test/build-plugins.mjs` — `build()` on every package in node_modules under
  many option sets (plugin file system vs esbuild-wasm, or the real file
  system and the resolver vs native esbuild), CSS in builds, the plugin API.
* `test/yarnpnp.mjs` — Yarn Plug'n'Play: the specification's test
  expectations, projects with `.pnp.data.json`/`.pnp.cjs`/`.pnp.js`
  manifests and packages in `.zip` archives (builds, and the CLI's debug
  logs), and 150 damaged archives (Go's `archive/zip` and `compress/flate`
  errors).
* `test/invalid-utf8.mjs` — input with invalid UTF-8 (transforms, messages,
  builds).
* `test/input-sourcemaps.mjs`, `test/defines.mjs`, `test/goregexp.mjs`,
  `test/smoke.mjs` — input source maps, `define` values, Go's regular
  expressions (`mangleProps`), targeted snippets.
* `test/depth.mjs` — how deeply each construct can be nested (`transform`
  and `build`, the browser build in the calling thread) vs esbuild-wasm in
  the calling thread: fails if this package handles less, if the outputs
  differ at esbuild-wasm's limit, or if the error past the limit is not
  esbuild's panic. The transform suites run on the bundled engine with
  `FAST_ESBUILD_TEST_ENGINE=bundle`, and all in deep mode with
  `FAST_ESBUILD_FORCE_DEEP=1` as well.
* `test/resolve-diff.mjs` — the resolver alone vs esbuild's (~11 minutes
  cold, ~30 s with its reference results cached in
  `.scratch/ref-cache/resolve-diff/`; `--no-cache` runs the reference
  again).

`diff`, `css-diff`, `build-diff`, `messages` and `resolve-diff` run in
parallel processes (default: the number of CPU threads minus 4; `--jobs N`,
`--jobs 1` for a single process), with the same checks and results as a
serial run.
* `test/browser.mjs [chromium,firefox,webkit]` — the browser builds in a real
  browser next to esbuild-wasm, both modes; the wasm URL is never requested.
* `tools/` — generators (`gen_runtime.mjs`, `gen_js_ident.mjs`,
  `gen_compat.mjs`, `gen_compat_css.mjs`, `gen_unicode_tables.mjs`),
  `lexer_smoke.mjs`, profiling and A/B helpers.
