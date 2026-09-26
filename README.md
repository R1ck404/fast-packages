# Faster drop-in versions of pako, acorn and esbuild-wasm (experiments)

Standalone experiments — nothing here is wired into Nodepod. Each package is a
drop-in replacement for the version Nodepod uses and is verified to produce
**identical results** (byte-identical output / identical ASTs) against the
original on large real-world corpora.

| package | replaces | approach |
|---|---|---|
| `fast-pako/` | pako 2.1.0 | faithful Rust -> wasm port of pako's zlib (deflate + inflate state machines, trees, checksums) with identical output, plus a libdeflate-style fast inflate loop, SIMD adler32 and 3-lane crc32; emulates pako's JS-level push/chunk/string semantics; vendored pako as fallback for exotic inputs |
| `fast-acorn/` | acorn 8.18 | a new parser mirroring acorn function-by-function (integer token types, flag tables, deferred node construction, exact key order); any error -> re-run real acorn so errors/messages are identical |
| `fast-esbuild-wasm/` | esbuild-wasm 0.28.2 | a JavaScript port (~40k lines) of esbuild's transform pipeline running inside esbuild's own (minimally patched) JS glue; supports source maps and tsconfigRaw; anything not provably identical (errors, warnings, unsupported options such as minify or non-esnext targets) falls back to the real Go wasm |

## Results (final interleaved runs, best of 2 alternating rounds, i7-10750H on AC)

Full tables: `results/*-interleaved-*.md`.

**fast-esbuild-wasm vs esbuild-wasm 0.28.2**

| case | esbuild-wasm | fast | speedup | (native esbuild) |
|---|---|---|---|---|
| Node: esm->cjs 1.6KB file | 12.1 ms | 0.49 ms | **24.6x** | 1.49 ms |
| Node: esm->cjs 51KB file | 44.7 ms | 10.2 ms | 4.4x | 8.5 ms |
| Node: batch of 17 zod files -> cjs | 337 ms | 53 ms | **6.4x** | 46 ms |
| Node: ts 9KB / 25KB file | 15.5 / 23.5 ms | 1.7 / 4.2 ms | 5.7-9.2x | |
| Node: tsx component x20 | 15.6 ms | 1.5 ms | **10.1x** | 1.7 ms |
| Node: vite-style ts + sourcemap + tsconfigRaw (141KB) | 78 ms | 26 ms | 3.1x | 17 ms |
| Node: vite-style tsx + sourcemap | 15.8 ms | 1.9 ms | **8.3x** | 2.0 ms |
| Node: 0.5-1.2MB files | 175-380 ms | 75-145 ms | 2.1-2.6x | 38-82 ms |
| Node: build() bundle with plugin (Go path, microtask delivery) | 1.29 s | 352 ms | 3.7x | 39 ms |
| Chromium: transform latency (empty) | 1.6 ms | 0.2 ms | **8x** | |
| Chromium: esm->cjs 1.6KB / 51KB | 3.9 / 33.9 ms | 0.8 / 7.0 ms | 4.8-4.9x | |
| Chromium: batch of 17 zod files (concurrent) | 164 ms | 30 ms | **5.5x** | |
| Chromium: ts 9-141KB | 5.1-61 ms | 1.2-16.6 ms | 3.7-4.3x | |
| Chromium: vite tsx + sourcemap | 7.2 ms | 1.2 ms | **6x** | |
| Chromium: 1-1.2MB files | 188-373 ms | 68-105 ms | 2.8-3.5x | |
| Chromium: initialize() + first transform | 458 ms | 221 ms | 2.1x | |

For small and medium files (the bulk of an npm install) the JS engine is even
faster than calling native esbuild through its child-process API.

**fast-acorn vs acorn 8.18**: parse 2.8-3.5x (1.6KB .. 9MB), with locations
2.1-2.7x, with onComment 3.0x, parseExpressionAt 1.9x; tokenizer() unchanged.

**fast-pako vs pako 2.1.0**: inflate/ungzip 2.2-4x on real data (ungzip of npm
tarballs 2.9-3.5x), tiny inputs 10-20x; deflate L1 3-3.6x, L6 2-2.5x,
L9 1.7-1.8x; streaming Inflate 2.5x, Deflate 2x.

## Verification

* **pako**: `node fast-pako/test/equiv.mjs` — 7864 checks (all levels,
  strategies, memLevels, windowBits, chunk sizes, string/ArrayBuffer inputs,
  dictionaries, gzip headers, multi-member/truncated streams, UTF-8/BOM
  string output chunking, 6000 corruption-fuzz cases, random streaming
  Deflate/Inflate with flush modes): 0 failures.
* **acorn**: `node fast-acorn/test/diff.mjs --locs --comments --nodepod` - every JS
  file of a large node_modules corpus (14,567 files) parsed as script/module,
  with locations+ranges, with onComment (array and function form) and with the
  option combinations Nodepod passes; ASTs and comments compared as JSON (plus
  prototype checks): 57,664 + 12,797 parses identical, 0 mismatches,
  0 false accepts. `test/expr-diff.mjs`: 60,848 parseExpressionAt calls at
  sampled positions identical.
* **esbuild-wasm**: `node fast-esbuild-wasm/test/diff.mjs` - every JS/TS file
  of the corpus (3,658 files) under 18 option sets (preserve, Nodepod's
  esm->cjs options, esm, iife, strict, ts, ts->cjs, Vite-style tsconfigRaw,
  experimental decorators, es2019 tsconfig target, JSONC tsconfig, and source
  maps for all of them): 32,133 outputs (code and map) byte-identical,
  0 mismatches, 0 false accepts, 0 crashes. The remaining fallbacks are inputs
  for which esbuild itself emits a warning or error (`test/bailreasons.mjs`
  confirms there are no unnecessary fallbacks). Additional runs: esbuild's own
  Go parser test expectations (2,396/2,413 identical, rest bail on warnings),
  11,212 cases extracted from esbuild's Go parser/bundler tests with
  tsconfig variants, 5,172 real TS/TSX files from other projects, 516 targeted
  smoke cases, and `test/api.mjs` through the whole glue (fast path, fallback,
  errors) against esbuild-wasm.

## Benchmarks

    node bench/compare.mjs pako pako fast
    node bench/compare.mjs acorn acorn fast
    node bench/interleave.mjs esbuild 2 wasm fast native     # Node, worker:false
    node bench/interleave.mjs esbuild-browser 2 wasm fast    # headless Chromium, worker mode

`interleave.mjs` alternates implementations in fresh processes and keeps the
best run per case, which makes the comparison robust to CPU frequency changes
(the laptop these were measured on throttles heavily on battery).

## Dead ends (kept for the record)

* esbuild: GOGC tuning (1.3x on big inputs, but grows wasm memory that never
  shrinks), `wasm-opt -O2` on the Go binary (no gain), TinyGo/LLVM build (builds,
  but its js/wasm runtime cannot run esbuild's async stdin service loop).
* pako deflate at level 6-9 is bounded by zlib's match finder, which must be kept
  for identical output (~2x at L6, ~1.4x at L9, native-zlib speed).
* acorn `tokenizer()` and `Parser.extend()` plugin subclasses still delegate to
  real acorn (identical, but not faster).
