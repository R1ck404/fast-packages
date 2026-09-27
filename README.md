# fast-* drop-ins: faster pako, acorn, acorn-jsx, esbuild-wasm, es-module-lexer, brotli-wasm

Faster drop-in replacements for the packages Nodepod uses, published as
`@r1ck404/fast-<name of the package it replaces>` with the **same version**
as the original. Each is verified to produce **identical results**
(byte-identical output, identical ASTs, errors and callbacks) against the
original on large real-world corpora. Nothing here is wired into Nodepod yet.

| package | replaces | typical speedup | approach |
|---|---|---|---|
| [`@r1ck404/fast-pako`](packages/fast-pako) | pako 2.1.0 | ungzip 5-6x, inflate 4x, deflate L1 3x | pako's zlib ported to Rust/wasm, same bytes |
| [`@r1ck404/fast-acorn`](packages/fast-acorn) | acorn 8.18.0 | parse 2.5-3.1x, JSX and `parseFunctionBody` subclasses 2.2-2.6x | a parser mirroring acorn function by function |
| [`@r1ck404/fast-acorn-jsx`](packages/fast-acorn-jsx) | acorn-jsx 5.3.2 | (enables the JSX fast path in minified bundles) | acorn-jsx + a registration hook |
| [`@r1ck404/fast-esbuild-wasm`](packages/fast-esbuild-wasm) | esbuild-wasm 0.28.2 | transform 5-35x small/medium, 3-4x on 1MB | JavaScript port of esbuild's transform pipeline in esbuild's own glue |
| [`@r1ck404/fast-es-module-lexer`](packages/fast-es-module-lexer) | es-module-lexer 1.7.0 | 3-18x (Node), 2.3-7.4x (Chromium) | SIMD Rust/wasm port of lexer.c |
| [`@r1ck404/fast-brotli-wasm`](packages/fast-brotli-wasm) | brotli-wasm 3.0.1 | compress q11 3-12.7x, decompress 2-3.6x | same Rust crates, rewritten encoder hot paths, new decoder |

## Naming and versions

* **Name**: `@r1ck404/fast-<original name>`. `@r1ck404` is a personal npm
  scope, so nobody else can publish into it; `fast-` marks the packages as
  faster re-implementations (not forks or official builds) and keeps the
  family together; the rest is the exact name of the package it replaces.
* **Version**: the version of the original it mirrors (`@r1ck404/fast-acorn@8.18.0`
  is acorn 8.18.0). Major and minor always equal the original's, so peer
  dependency ranges keep working (acorn-jsx's `acorn ^8`); the patch number
  is ours and moves on for our own fixes. The exact mirrored release is in
  each `package.json`'s `upstream` field.

## Using them

Install under the original name, so every import (including those inside
other dependencies) gets the fast version:

```jsonc
// package.json
"dependencies": {
  "pako": "npm:@r1ck404/fast-pako@2.1.0",
  "acorn": "npm:@r1ck404/fast-acorn@8.18.0",
  "acorn-jsx": "npm:@r1ck404/fast-acorn-jsx@5.3.2",
  "esbuild-wasm": "npm:@r1ck404/fast-esbuild-wasm@0.28.2",
  "es-module-lexer": "npm:@r1ck404/fast-es-module-lexer@1.7.0",
  "brotli-wasm": "npm:@r1ck404/fast-brotli-wasm@3.0.1"
}
```

(pnpm: the same specs under `pnpm.overrides` also redirect transitive
dependencies. A bundler alias, e.g. Vite `resolve.alias`, works as well.)
Alias `acorn-jsx` together with `acorn`: in a minified bundle the genuine
acorn-jsx is no longer recognisable, `@r1ck404/fast-acorn-jsx` is.

Entry points mirror the originals' (ESM and CommonJS, browser fields, types).
Differences are listed in each package's README; the notable ones: in Node,
`@r1ck404/fast-esbuild-wasm` is esbuild-wasm's own Node API (the fast path is the
browser build, or `@r1ck404/fast-esbuild-wasm/node.mjs` in-thread); pako's
`lib/*`/`dist/*` and es-module-lexer's `/js` subpaths are not provided.

## Results

Ryzen 7 7800X3D, Node 24.16 / Chromium 149. `node bench/interleave.mjs <suite>
3 <orig> prev fast`: implementations alternate in fresh processes, best of 3
rounds per case. **before** = the packages at the start of the second
optimisation round (`prev`), **now** = current; both as speedup over the
original. Full tables: `results/*_vs_prev_vs_fast*-interleaved-*.md`.

**@r1ck404/fast-pako vs pako 2.1.0**

| case | pako | before | now |
|---|---|---|---|
| ungzip npm tarballs (9 packages, 150KB-4.6MB .tgz) | 4.2-101 ms | 3.0-3.5x | **5.0-5.9x** |
| inflate 1-9MB (js, json, wasm) | 2.5-29 ms | 2.9-3.7x | **3.9-4.2x** |
| inflateRaw of a 128KB level-1 group (Nodepod content packing) | 410 us | 3.6x | **4.4x** |
| deflateRaw level 1, 128KB group / 1-9MB | 1.4 / 6.7-91 ms | 2.3 / 2.6-3.2x | **2.6 / 3.0-3.7x** |
| `Inflate` stream, 16KB pushes (typescript.tgz) | 101 ms | 2.8x | **3.7x** |
| inflateRaw / ungzip of 300B | 11.8 / 9.7 us | 2.1 / 1.7x | **5.6 / 4.3x** |
| deflate level 6 / level 9 | | 1.9-2.3x / 1.7-2.0x | unchanged |

**@r1ck404/fast-acorn (+ @r1ck404/fast-acorn-jsx) vs acorn 8.18 (+ acorn-jsx 5.3.2)**

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

**@r1ck404/fast-es-module-lexer vs es-module-lexer 1.7.0**

| case | Node: orig | before | now | Chromium: orig | before | now |
|---|---|---|---|---|---|---|
| tiny module 70B / 1.6KB | 0.5 / 4.7 us | 1.7 / 2.3x | **3.0 / 6.5x** | 0.5 / 4.9 us | 1.4 / 2.0x | **2.3 / 3.7x** |
| 51KB (non-ASCII) | 154 us | 1.7x | **5.9x** | 181 us | 1.7x | **4.4x** |
| 0.5-1.2MB bundles | 2.0-3.8 ms | 2.1-3.7x | **6.3-18.4x** | 2.3-4.2 ms | 2.0-3.6x | **4.9-7.4x** |
| typescript.js 9MB | 35 ms | 3.0x | **7.4x** | | | |
| batches of real package files (34-753 files) | 2.0-15.5 ms | 1.8-2.9x | **5.1-7.6x** | 2.1-16.2 ms | 1.7-2.8x | **3.5-4.5x** |

**@r1ck404/fast-brotli-wasm vs brotli-wasm 3.0.1** (`compress()` defaults to
quality 11, which is what Nodepod's zlib polyfill uses)

| case | brotli-wasm | before | now |
|---|---|---|---|
| compress q11 70B / 1.6KB / 8KB | 2.3 / 4.3 / 11.5 ms | 9.8 / 3.4 / 2.2x | **12.7 / 4.5 / 3.4x** |
| compress q11 51KB / 536KB | 57 / 699 ms | 1.9 / 1.8x | **3.0 / 2.9x** |
| compress q5 / q9 (51KB-1MB) | | 2.2-2.5x / 1.8-3.7x | 2.4-3.2x / 1.8-4.2x |
| compress q1 | | 2.8-3.4x | unchanged |
| decompress | 7 us .. 2.5 ms | 2.0-3.6x | unchanged |
| `CompressStream` q5 / `DecompressStream` 1MB | 31 / 2.3 ms | 2.2 / 1.2x | 2.4 / 1.5x |

**@r1ck404/fast-esbuild-wasm vs esbuild-wasm 0.28.2**

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

The Node rows use `@r1ck404/fast-esbuild-wasm/node.mjs` (in-thread, `worker:
false`); esbuild-wasm there pays the OS timer granularity (15.6 ms on
Windows) per request, so the Chromium numbers are the fairer comparison for
small inputs. For small and medium files the JS engine is faster than calling
native esbuild through its child-process API; in steady state (warm JIT, no GC
in the window) it transforms three.module.js in ~20 ms, about native speed.

## Verification

`npm run test:full` (`verify/suites.sh`) runs every package's differential
suites; `npm run verify` (`verify/all.sh`) runs the independent checks. All
compare against the original packages in `node_modules`.

Package suites (last full run, 0 failures / mismatches / false accepts):

* **fast-pako**: `test/equiv.mjs` 7,864 checks (levels, strategies,
  memLevels, windowBits, chunk sizes, dictionaries, gzip headers,
  multi-member/truncated streams, string output, 6,000 corruption-fuzz cases,
  streaming with flush modes); `test/fuzz.mjs` 14,368 + 14,363 (two seeds:
  crafted streams for every decoder corner, random Huffman headers, random
  options and pushes, every observable stream field, error shapes);
  `test/corpus.mjs` 2,292 (Nodepod-style packing of 4,795 real files, npm
  tarballs).
* **fast-acorn / fast-acorn-jsx**: `test/diff.mjs --locs --comments --nodepod`
  over 14,666 files incl. Nodepod's pnpm store (script/module, locations,
  ranges, onComment, Nodepod's option sets; ASTs, comments, prototypes and
  object sharing compared): 93,817 parses identical; `expr-diff.mjs` 61,047;
  `jsx-diff.mjs` 124,645 (real, generated and mutated JSX, every acorn-jsx
  option set, genuine acorn-jsx and fast-acorn-jsx); `override-diff.mjs`
  17,899 (subclasses that must and must not be recognised); `error-diff.mjs`
  274,385 errors (223,763 produced by the fast parser itself);
  `acorn-diff.mjs` 40,912 (the vendored acorn with the faster tokenizer vs npm
  acorn, incl. tokenizer/onToken); `options.mjs` 2,428.
* **fast-esbuild-wasm**: `test/diff.mjs` over 3,677 JS/TS files (node_modules
  + Nodepod's own source) under 18 option sets (Nodepod's esm->cjs options,
  esm, iife, ts, Vite-style tsconfigRaw, decorators, JSX, source maps for all):
  32,271 outputs (code and map) byte-identical, 0 crashes;
  `bailreasons.mjs`: no unnecessary fallbacks; `fuzz.mjs` 12,949 generated
  programs; `smoke.mjs` 516; `api.mjs` through the whole glue vs esbuild-wasm
  plus the export surface of all four browser builds.
* **fast-es-module-lexer**: `test/diff.mjs` over 26,228 files plus UTF-16,
  truncated and edited variants, each in all 4 source-copy modes: 157,350 x 4;
  `edge.mjs` 24,661; `browser.mjs` in Chromium, Firefox and WebKit. Inputs on
  which the original reads memory past its source (malformed code only) are
  confirmed history-dependent in the original and use the vendored original.
* **fast-brotli-wasm**: `test/compress-equiv.mjs` 4,916 + 18,116 on the pnpm
  store (qualities 0-11 byte-identical); `compress-stress.mjs` 11,844;
  `decode-equiv.mjs` 285,127 (native-brotli streams with random parameters,
  generated streams covering every format feature, 189k fuzzed streams, errors
  included); `stream-equiv.mjs` 500; `api.mjs` 321.

Independent checks (`verify/`, written separately from the package suites,
calling every package the way Nodepod does), 0 failures: pako 37,896
(Nodepod's content packing, random options, streaming with random flushes,
corrupt/truncated streams, tarballs); acorn 54,816 (Nodepod's exact
`topLevelParser` code, acorn-jsx and fast-acorn-jsx on a 3,243-file real-world
JSX corpus, tokenizer, parseExpressionAt, onComment, edits); es-module-lexer
40,041; brotli 7,906 (q11 and random qualities in random order, corrupt and
truncated streams, stream classes); esbuild 8,114 through the public
`transform()` API vs esbuild-wasm; every browser build in headless Chromium
3,669; Nodepod's `topLevelParser` minified the way it ships: recognised (2.2x)
and identical on 1,501 files; `verify/pack-smoke.mjs`: the packed tarballs
installed under the original names work from Node (ESM and CommonJS) and
bundle for the browser.

## Repository layout

    packages/fast-<name>/   one npm package each (@r1ck404/fast-<name>): sources, build, tests, tools
    bench/                  benchmark suites + harness (interleave.mjs, compare.mjs, corpus.mjs)
    verify/                 independent verification, pack/install smoke test, full-suite runner
    results/                benchmark tables
    corpus/                 npm tarballs for the pako bench (gitignored; `npm pack` into it)

## Development

    npm install             # links the workspaces; builds @r1ck404/fast-esbuild-wasm (lib/, esm/)
    npm test                # quick tests of every package
    npm run test:full       # all package suites (long)
    npm run verify          # independent checks + pack/install smoke test (long)
    npm run build:wasm      # rebuild the wasm of pako, es-module-lexer, brotli-wasm
                            # (Rust with the wasm32-unknown-unknown target)

The larger corpora are optional: Nodepod's pnpm store (a `Nodepod` checkout
next to this repo), `corpus/*.tgz` for the pako bench, and the JSX corpus
(`node verify/make-jsx-corpus.mjs`, from .tsx/.jsx files near this repo).

Benchmarks:

    node bench/interleave.mjs pako 3 pako fast
    node bench/interleave.mjs acorn 3 acorn fast
    node bench/interleave.mjs esbuild 3 wasm fast native          # Node, worker:false
    node bench/interleave.mjs esbuild-browser 2 wasm fast         # headless Chromium, worker mode
    node bench/interleave.mjs es-module-lexer 3 orig fast
    node bench/interleave.mjs es-module-lexer-browser 3 orig fast  # BROWSER=firefox|webkit
    node bench/interleave.mjs brotli 3 orig fast

`interleave.mjs` alternates implementations in fresh processes and keeps the
best run per case, which makes the comparison robust to CPU frequency changes
and background load. The `prev` implementation in each suite loads a snapshot
from `.scratch/prev/` (not in git) for before/after comparisons.

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
  vendored acorn for unrecognised plugins (no measurable gain), a guard against
  direct `Parser.prototype` patches (costs more than a small parse). `locations`
  costs are dominated by GC of the Position/SourceLocation objects the AST
  must contain.
