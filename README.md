# Faster drop-in versions of pako, acorn, esbuild-wasm, es-module-lexer and brotli-wasm (experiments)

Standalone experiments — nothing here is wired into Nodepod. Each package is a
drop-in replacement for the version Nodepod uses and is verified to produce
**identical results** (byte-identical output / identical ASTs, errors and
callbacks) against the original on large real-world corpora.

| package | replaces | approach |
|---|---|---|
| `fast-pako/` | pako 2.1.0 | faithful Rust -> wasm port of pako's zlib (deflate + inflate state machines, trees, checksums) with identical output, plus a libdeflate-style fast inflate loop (32-byte match copies, one fast table builder whose slow path keeps zlib's exact byte reads), table-free folding crc32, SIMD adler32, precomputed per-block codes and a branchless bit writer for level-1 emission; emulates pako's JS-level push/chunk/string semantics; streaming sessions are pooled; vendored pako as fallback for exotic inputs |
| `fast-acorn/` | acorn 8.18 | a new parser mirroring acorn function-by-function (integer token types, flag tables, deferred node construction, exact key order, exact "Unexpected token" errors); other errors re-run real acorn. Native acorn-jsx mode for the genuine acorn-jsx 5.3.2 class (recognised by source + structure + probe parses) or `fast-acorn/acorn-jsx.mjs`; subclasses that only override `parseFunctionBody` (Nodepod's `topLevelParser`) run their own method against a facade over the fast parser after a whitelist analysis of its source; `tokenizer()` and unrecognised plugins run the vendored acorn with a faster tokenizer (`fasttok.mjs`) that reproduces its exact state |
| `fast-esbuild-wasm/` | esbuild-wasm 0.28.2 | a JavaScript port (~40k lines) of esbuild's transform pipeline running inside esbuild's own (minimally patched) JS glue; supports source maps and tsconfigRaw; printer writes UTF-8 bytes into one buffer; the shared runtime is printed/linked once and reused (verified in a checking mode that recomputes every cache hit); anything not provably identical (errors, warnings, unsupported options such as minify or non-esnext targets) falls back to the real Go wasm |
| `fast-es-module-lexer/` | es-module-lexer 1.7.0 | Rust -> wasm port of lexer.c function-by-function; the main loop only stops at the few chars that matter (SIMD nibble-table classifier over 64-char blocks with hoisted constants, stop masks walked directly, a separate tight loop for brackets/non-keywords), SIMD skipping of strings/comments/templates/import clauses; source enters wasm via Node's `Buffer.latin1Write`/`ucs2Write`, a wasm loop over the JS-string builtins in Chromium, or `TextEncoder.encodeInto` elsewhere (always one byte per UTF-16 unit); results come back as one int array and unescaped specifiers are sliced instead of `eval`'d; any input where the original reads outside its source buffer (stale memory) runs the vendored original |
| `fast-brotli-wasm/` | brotli-wasm 3.0.1 | same Rust crates (brotli 5.0.0 / brotli-decompressor 4.0.0, vendored) built at O3+SIMD with a C-ABI glue instead of wasm-bindgen; encoder hot paths rewritten with byte-identical output (Zopfli relaxation with per-insert-code length-cost tables, per-position distance-cache tables, dominated start positions skipped, sorted start queue, early-exit clustering over nonzero bins, SIMD match finding/block splitting, no zeroing of buffers that are written before read); a new one-shot decoder (straight into the output buffer, 64-bit bit reader, fused command/distance tables) with the reference decoder as fallback for errors |

## Results

Ryzen 7 7800X3D, Node 24.16 / Chromium 149. `node bench/interleave.mjs <suite>
3 <orig> prev fast`: implementations alternate in fresh processes, best of 3
rounds per case. **before** = the packages at the start of the second
optimisation round (`prev`), **now** = current; both as speedup over the
original. Full tables: `results/*_vs_prev_vs_fast*-interleaved-*.md`.

**fast-pako vs pako 2.1.0**

| case | pako | before | now |
|---|---|---|---|
| ungzip npm tarballs (9 packages, 150KB-4.6MB .tgz) | 4.2-101 ms | 3.0-3.5x | **5.0-5.9x** |
| inflate 1-9MB (js, json, wasm) | 2.5-29 ms | 2.9-3.7x | **3.9-4.2x** |
| inflateRaw of a 128KB level-1 group (Nodepod content packing) | 410 us | 3.6x | **4.4x** |
| deflateRaw level 1, 128KB group / 1-9MB | 1.4 / 6.7-91 ms | 2.3 / 2.6-3.2x | **2.6 / 3.0-3.7x** |
| `Inflate` stream, 16KB pushes (typescript.tgz) | 101 ms | 2.8x | **3.7x** |
| inflateRaw / ungzip of 300B | 11.8 / 9.7 us | 2.1 / 1.7x | **5.6 / 4.3x** |
| deflate level 6 / level 9 | | 1.9-2.3x / 1.7-2.0x | unchanged |

**fast-acorn vs acorn 8.18**

| case | acorn | before | now |
|---|---|---|---|
| parse 1.6KB .. 9MB | 41 us .. 343 ms | 2.4-3.1x | 2.5-3.1x |
| parse + locations | 52 us .. 50 ms | 1.8-2.5x | 1.9-2.7x |
| Nodepod `topLevelParser()` subclass (skips function bodies) | 23 us .. 17 ms | 0.93-0.98x | **2.2-2.6x** |
| acorn-jsx parse + locations (rollup `parseAst` for jsx/tsx) | 2.9-4.6 ms | 0.87-0.92x | **2.4-2.6x** |
| rollup `parseAst` fallback flow (acorn fails on JSX -> acorn-jsx) | 7.9 ms | 0.79x | **2.4x** |
| `tokenizer()` | 0.96-12.8 ms | 1.0x | **1.5-1.6x** |
| `parseExpressionAt` x8 (with locations) | 29 us | 1.7x | **3.1x** |
| any other `Parser.extend()` plugin | | 0.9x | 1.0x |

**fast-es-module-lexer vs es-module-lexer 1.7.0**

| case | Node: orig | before | now | Chromium: orig | before | now |
|---|---|---|---|---|---|---|
| tiny module 70B / 1.6KB | 0.5 / 4.7 us | 1.7 / 2.3x | **3.0 / 6.5x** | 0.5 / 4.9 us | 1.4 / 2.0x | **2.3 / 3.7x** |
| 51KB (non-ASCII) | 154 us | 1.7x | **5.9x** | 181 us | 1.7x | **4.4x** |
| 0.5-1.2MB bundles | 2.0-3.8 ms | 2.1-3.7x | **6.3-18.4x** | 2.3-4.2 ms | 2.0-3.6x | **4.9-7.4x** |
| typescript.js 9MB | 35 ms | 3.0x | **7.4x** | | | |
| batches of real package files (34-753 files) | 2.0-15.5 ms | 1.8-2.9x | **5.1-7.6x** | 2.1-16.2 ms | 1.7-2.8x | **3.5-4.5x** |

**fast-brotli-wasm vs brotli-wasm 3.0.1** (`compress()` defaults to quality
11, which is what Nodepod's zlib polyfill uses)

| case | brotli-wasm | before | now |
|---|---|---|---|
| compress q11 70B / 1.6KB / 8KB | 2.3 / 4.3 / 11.5 ms | 9.8 / 3.4 / 2.2x | **12.7 / 4.5 / 3.4x** |
| compress q11 51KB / 536KB | 57 / 699 ms | 1.9 / 1.8x | **3.0 / 2.9x** |
| compress q5 / q9 (51KB-1MB) | | 2.2-2.5x / 1.8-3.7x | 2.4-3.2x / 1.8-4.2x |
| compress q1 | | 2.8-3.4x | unchanged |
| decompress | 7 us .. 2.5 ms | 2.0-3.6x | unchanged |
| `CompressStream` q5 / `DecompressStream` 1MB | 31 / 2.3 ms | 2.2 / 1.2x | 2.4 / 1.5x |

**fast-esbuild-wasm vs esbuild-wasm 0.28.2**

| case | esbuild-wasm | before | now | (native esbuild) |
|---|---|---|---|---|
| Node: esm->cjs 1.6KB file | 15.5 ms | 108x | **157x** | 0.62 ms |
| Node: esm->cjs 51KB file | 15.7 ms | 5.1x | 5.6x | 3.83 ms |
| Node: batch of 17 zod files -> cjs | 268 ms | 18.5x | **23.3x** | 21.2 ms |
| Node: ts 9KB / 25KB / 141KB file | 15.6-31 ms | 26x / 11x / 4.0x | **34x / 14x / 5.2x** | 0.9 / 1.6 / 5.5 ms |
| Node: tsx / vite tsx + sourcemap, component x20 | 15.6 ms | 29x / 28x | **36x / 34x** | 0.85 / 0.96 ms |
| Node: vite-style ts + sourcemap + tsconfigRaw (141KB) | 31 ms | 3.2x | **4.1x** | 7.0 ms |
| Node: 0.5-1.2MB files | 63-137 ms | 2.1-2.4x | **2.5-3.0x** | 16-33 ms |
| Node: build() bundle with plugin (Go path, microtask delivery) | 1.16 s | 8.8x | 8.7x | 12.9 ms |
| Chromium: esm->cjs 1.6KB / 51KB | 1.5 / 11.5 ms | 5.0 / 4.6x | **7.5 / 5.5x** | |
| Chromium: batch of 17 zod files (sequential / concurrent) | 58 / 57 ms | 4.6 / 5.2x | **5.9 / 6.2x** | |
| Chromium: ts 9-141KB | 2.0-19.8 ms | 3.2-5.0x | 3.8-4.1x | |
| Chromium: vite ts/tsx + sourcemap | 2.5-25.6 ms | 3.3-5.0x | 3.2-6.3x | |
| Chromium: 1-1.2MB files | 66-130 ms | 2.5-3.3x | **3.1-3.8x** | |
| Chromium: initialize() + first transform | 153 ms | 2.0x | 2.0x | |

esbuild-wasm in Node pays the OS timer granularity (15.6 ms on Windows) per
request; the Chromium numbers are the fairer comparison for small inputs. For
small and medium files the JS engine is faster than calling native esbuild
through its child-process API; in steady state (warm JIT, no GC in the
window) it transforms three.module.js in ~20 ms, about native speed.

## Verification

Each package has its own differential suites; `sh verify/suites.sh` runs all
of them. Final run, all against the original packages:

* **pako**: `test/equiv.mjs` 7,864 checks (levels, strategies, memLevels,
  windowBits, chunk sizes, dictionaries, gzip headers, multi-member/truncated
  streams, string output chunking, 6,000 corruption-fuzz cases, streaming with
  flush modes); `test/fuzz.mjs` 14,368 + 14,363 (two seeds: crafted streams
  for every decoder corner, random Huffman headers, random options and push
  sizes, every observable stream field incl. `strm.data_type`, error shapes);
  `test/corpus.mjs` 2,292 (Nodepod-style packing of 4,795 real files and the
  npm tarballs): 0 failures.
* **acorn**: `test/diff.mjs --locs --comments --nodepod` - 14,666 files incl.
  Nodepod's pnpm store as script/module, with locations+ranges, onComment and
  Nodepod's option sets, ASTs/comments/prototypes/object sharing compared:
  93,817 parses identical, 0 false accepts; `expr-diff.mjs` 61,047;
  `jsx-diff.mjs` 124,645 (3,243 real JSX files, 3,000 JS files, generated
  and mutated JSX, all acorn-jsx option sets, both jsx modules);
  `override-diff.mjs` 17,899 (4 subclass variants that must be recognised, 10
  that must not); `error-diff.mjs` 274,385 error cases (223,763 produced by
  the fast parser itself); `acorn-diff.mjs` 40,912 (vendored acorn +
  fasttok vs npm acorn incl. onToken/tokenizer); `options.mjs` 2,428:
  0 mismatches.
* **esbuild-wasm**: `test/diff.mjs` - 3,336 JS/TS files under 18 option sets
  (preserve, Nodepod's esm->cjs options, esm, iife, ts, ts->cjs, Vite-style
  tsconfigRaw, decorators, JSONC tsconfig, source maps for all): 29,204
  outputs (code and map) byte-identical, 0 mismatches, 0 false accepts,
  0 crashes (runtime caches recomputed and compared on every hit); extra
  source trees (7,426 TS/TSX files) 63,180 identical; `test/fuzz.mjs` 12,949
  generated programs (escapes, surrogates, non-ASCII + source maps, JSX,
  names colliding with runtime helpers); `bailreasons.mjs`: 0 unnecessary
  fallbacks; `smoke.mjs` 516; `api.mjs` through the whole glue.
* **es-module-lexer**: `test/diff.mjs` - 26,228 files (local + Nodepod pnpm)
  plus UTF-16, truncated and randomly edited variants, each in all 4 copy
  modes: 157,350 x 4 checks, 0 mismatches; `edge.mjs` 24,661 (escapes,
  high chars whose low byte is a token char, every length 0-300, memory
  growth); `browser.mjs` in Chromium, Firefox and WebKit. Inputs on which the
  original reads memory past its source (only malformed code) are confirmed
  to be history-dependent in the original (different garbage, different
  answer); those use the vendored original.
* **brotli-wasm**: `test/compress-equiv.mjs` 4,916 + 18,116 on the pnpm store
  (all qualities 0-11 byte-identical); `compress-stress.mjs` 11,844 generated
  inputs; `decode-equiv.mjs` 285,127 decompress checks (native-brotli streams
  with random parameters, generated streams covering every format feature,
  189k fuzzed streams, errors included); `stream-equiv.mjs` 500 streaming
  call sequences; `api.mjs` 321: 0 failures.

**Independent checks** (`verify/`, written separately from the package
suites; `sh verify/all.sh`), each package called the way Nodepod calls it:
pako 63,170 checks over two seeds (Nodepod content packing, randomized
options, streaming with random flushes, corrupt/truncated streams, tarballs);
acorn 48,307 (Nodepod's exact `topLevelParser` code and acorn-jsx on real
JS and a 3,243-file JSX corpus built by `verify/make-jsx-corpus.mjs`,
tokenizer, parseExpressionAt, onComment, edits); es-module-lexer 80,082
(two seeds, random order, UTF-16/truncated/edited variants); brotli 7,906
(q11 and random qualities in random order, corrupt/truncated streams, stream
classes with random chunking); esbuild 8,114 through the public `transform()`
API vs esbuild-wasm (Nodepod and Vite options, fallback options, truncations);
every package's browser entry point in headless Chromium, 3,669 checks; the
minified `topLevelParser` as Nodepod ships it (`verify-toplevel-min.mjs`):
recognised and identical. All 0 failures.

## Using in Nodepod

* Alias `acorn` -> `fast-acorn/index.mjs` and `acorn-jsx` ->
  `fast-acorn/acorn-jsx.mjs`. The genuine acorn-jsx is recognised by its
  source text, which a minifier changes, so a minified bundle needs the alias
  to get the JSX speedup (without it, JSX parses at acorn speed, still
  identical). The `topLevelParser` subclass is recognised minified too.

## Known differences (all pre-existing, none reachable through Nodepod)

* acorn: patching `acorn.Parser.prototype` directly (instead of through
  `Parser.extend`) is ignored by the fast path; a per-parse guard would cost
  more than a small parse. On extremely deep nesting acorn can run out of
  stack where fast-acorn returns an AST.
* pako: `Inflate.push()` with something other than a byte array *after* the
  first push (plain arrays with values > 255, other typed arrays, DataView)
  can differ from pako, which feeds those raw values into its JS inflate.
  Such an input on the first push hands the stream to the original.
* es-module-lexer: on malformed inputs where the original reads stale memory
  past its source, the answer depends on what that instance parsed before;
  fast-es-module-lexer asks the vendored original, whose history differs.

## Benchmarks

    node bench/interleave.mjs pako 3 pako prev fast
    node bench/interleave.mjs acorn 3 acorn prev fast
    node bench/interleave.mjs esbuild 3 wasm prev fast native     # Node, worker:false
    node bench/interleave.mjs esbuild-browser 2 wasm prev fast    # headless Chromium, worker mode
    node bench/interleave.mjs es-module-lexer 3 orig prev fast
    node bench/interleave.mjs es-module-lexer-browser 3 orig prev fast   # BROWSER=firefox|webkit
    node bench/interleave.mjs brotli 3 orig prev fast

`prev` loads a snapshot from `.scratch/prev/<package>` (esbuild:
`.scratch/esbuild-prev/`); drop it from the list if there is none. The pako
bench needs npm tarballs in `corpus/` (`cd corpus && npm pack typescript@5.9.3
react-dom three ...`). `interleave.mjs` alternates implementations in fresh
processes and keeps the best run per case, which makes the comparison robust
to CPU frequency changes and background load.

## Dead ends (kept for the record)

* esbuild: GOGC tuning (1.3x on big inputs, but grows wasm memory that never
  shrinks), `wasm-opt -O2` on the Go binary (no gain), TinyGo/LLVM build (builds,
  but its js/wasm runtime cannot run esbuild's async stdin service loop);
  AST nodes as object literals (GC scavenges -35%, wall time unchanged or up
  to 9% slower); interning identifier strings (no gain).
* pako deflate at level 6-9 is bounded by zlib's match finder, which must visit
  the same candidates for identical output (~2x at L6, ~1.7-2x at L9,
  native-zlib speed). Inflate: fused length entries (10-17% slower), 4-5
  literals per refill, 9/10-bit distance / 10/12-bit literal tables, wasm-opt
  -O4 (all slower or no gain).
* brotli q10/q11 (Zopfli): a native x86 build of the same encoder is no faster
  than the wasm; what is left is the algorithm. Reordering relaxations across
  queue entries would be faster but can change tie-breaks (output); probing
  out of line, 16-byte queue entries, dictionary prefix tables, prefetching:
  no gain.
* es-module-lexer: a JS `charCodeAt` copy (~2.5 ns/char), `btoa` +
  `setFromBase64` (~1 ns/char), relaxed-SIMD swizzle (+3-12%, but would need a
  second module for engines without it). V8's baseline code for the builtins
  copy loop is slow, so the first ~1M chars use `intoCharCodeArray`.
* acorn: lazily created token start positions, interning identifiers, object
  literal AST nodes (4x slower node creation), per-method speedups of the
  vendored acorn for unrecognised plugins (no measurable gain). `locations`
  costs are dominated by GC of the Position/SourceLocation objects the AST
  must contain.
