# Where Nodepod spends CPU time on real projects (2026-09-27)

Method: `bench/nodepod-profile.mjs` runs examples from Nodepod's
`perf-bench/examples-spec.json` (Nodepod working tree of 2026-09-27, 1.11.1 +
uncommitted changes) in headless Chromium 149 with a browser-wide trace of
every thread; `bench/tools/nodepod-buckets.mjs` attributes each sample to the
npm package / CDN module / Nodepod file that spent it. Nodepod evaluates
module code without file names, so the profiling build
(`bench/tools/nodepod-prof-build.mjs`) adds a `sourceURL` to each evaluated
module. Run 1 starts from an empty browser profile, run 2 reuses it (tarball
and wasm caches filled). Ryzen 7 7800X3D.

Threads blocked in `memory.atomic.wait` inside wasm (rolldown's and
Tailwind oxide's thread pools, parked while waiting for work) show up in
Chrome's CPU profiles as *running*; those samples are reported separately
(`bench/tools/wasm-waits.mjs` finds the wait functions) and not counted as
busy time. Without that correction, rolldown looked like 56-73% of the Vite 8
dev start and oxide like 56% of the Tailwind dev start; almost all of that was
parked threads (rolldown's hottest "function" is a condition-variable wait).

## Busy CPU by owner, warm runs (all threads)

| scenario | wall | busy CPU | blocked in wasm waits (not counted) | biggest owners of the busy time |
|---|---|---|---|---|
| Vite 8 + React, `npm run dev` | 2.5 s | 1.28 s | 3.3 s | Nodepod runtime 46%, V8 compile/(program) 22%, emnapi 8%, Nodepod main thread 8%, vite 4%, **rolldown 3% (36 ms)** |
| Vite 8 + Tailwind 4, `vite build` | 4.8 s | 3.11 s | 7.3 s | Nodepod runtime 38%, (program) 30%, **rolldown 9% (272 ms)**, napi-wasm 5%, **oxide ~0** |
| Vite 7 + Tailwind 4 (oxide, lightningcss), dev | 2.7 s | 1.47 s | 1.9 s | Nodepod runtime 54%, (program) 20%, Nodepod main 9%, vite 3%, **oxide ~0, lightningcss ~0** |
| Vite 7 + React, `npm run dev` | 2.4 s | 0.72 s | 0 | Nodepod runtime 41%, (program) 29%, vite 8%, esbuild-wasm 3% |
| Vite 7 + React, `vite build` | 1.9 s | 1.65 s | 0 | **@rollup/browser 30% (496 ms)**, **esbuild-wasm 27% (448 ms)**, (program) 16%, Nodepod runtime 13%, vite 8% |

Cold runs (empty browser profile) add package download/extraction and wasm
compilation: e.g. Vite 7 dev 4.5 s wall / 1.74 s busy, of which esbuild-wasm
(stock, loaded from the CDN, mostly its initialisation) 315 ms and Nodepod's
installer (manifest parsing, tar extraction) ~200 ms.

## Inside Nodepod's own worker runtime (unminified profiling build)

| | Vite 7 dev, warm (286 ms) | Tailwind 4 dev, warm (782 ms) | Vite 7 dev, cold (695 ms) |
|---|---|---|---|
| acorn 8.17 (bundled; module transforms) | 4% | **20%** | **22%** |
| script-engine.ts (loadModule, module resolution) | 28% | 14% | 14% |
| lazy-fs-client.ts + sync-channel.ts (sync fs calls across threads) | 23% | **30%** | 6% |
| wasm-module-cache.ts (hashing wasm binaries) | | 8% | |
| digest.ts + @noble/hashes | 11% | 4% | 2% |
| registry-client.ts (npm manifests), installer, extraction | | | **~28%** |
| es-module-lexer | | | 3% |

## Conclusions

* rolldown, Tailwind's oxide and lightningcss do little computing in these
  projects; their threads mostly wait. A faster build of them would not help.
  If anything, the waiting points at how their threads get work and file
  access from Nodepod (the sync fs channel is 30% of Nodepod's time in the
  Tailwind dev start).
* rollup (`@rollup/browser`) is 0.5 s of each `vite build` on Vite <= 7 (30% of
  its CPU), and only on builds.
* Stock esbuild-wasm is 0.45 s of a Vite 7 build and 0.3-0.5 s of a cold dev
  start; stock acorn is up to 20% of Nodepod's runtime. Both already have
  faster drop-ins here (fast-esbuild-wasm 3-7.5x, fast-acorn 2.5-3x), as do
  es-module-lexer and noble-hashes. Wiring those into Nodepod is the cheapest
  win.
* The largest single owner is Nodepod's own runtime (38-54% of busy time in
  dev starts): module loading, the cross-thread fs calls, and V8 compiling
  evaluated modules ("(program)", 16-30%).

Side finding: with Nodepod's `NODEPOD_UNMINIFIED=1` build, Vite 8 dev hangs:
a WASI thread worker throws `ReferenceError: ExitStatus is not defined`. The
worker source is generated from `ExitStatus.toString()` / `WASI.toString()`
plus guessed bundler names (src/polyfills/wasi.ts), and the guess misses when
esbuild renames the class in an unminified bundle.
