# fast-* drop-ins: faster pako, acorn, acorn-jsx, esbuild-wasm, es-module-lexer, brotli-wasm, @noble/hashes

[![CI](https://github.com/R1ck404/fast-packages/actions/workflows/ci.yml/badge.svg)](https://github.com/R1ck404/fast-packages/actions/workflows/ci.yml)

Faster drop-in replacements for the packages Nodepod uses, published as
`@r1ck404/fast-<name of the package it replaces>` with the **same version**
as the original. Each is verified to produce **identical results**
(byte-identical output, identical ASTs, errors and callbacks) against the
original on large real-world corpora. Nothing here is wired into Nodepod yet.

| package | npm | replaces | typical speedup | approach |
|---|---|---|---|---|
| [`@r1ck404/fast-pako`](packages/fast-pako) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-pako.svg)](https://www.npmjs.com/package/@r1ck404/fast-pako) | pako 2.1.0 | ungzip 5-6x, inflate 4x, deflate L1 3x | pako's zlib ported to Rust/wasm, same bytes |
| [`@r1ck404/fast-acorn`](packages/fast-acorn) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-acorn.svg)](https://www.npmjs.com/package/@r1ck404/fast-acorn) | acorn 8.18.0 | parse 2.5-3.1x, JSX and `parseFunctionBody` subclasses 2.2-2.6x | a parser mirroring acorn function by function |
| [`@r1ck404/fast-acorn-jsx`](packages/fast-acorn-jsx) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-acorn-jsx.svg)](https://www.npmjs.com/package/@r1ck404/fast-acorn-jsx) | acorn-jsx 5.3.2 | (enables the JSX fast path in minified bundles) | acorn-jsx + a registration hook |
| [`@r1ck404/fast-esbuild-wasm`](packages/fast-esbuild-wasm) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-esbuild-wasm.svg)](https://www.npmjs.com/package/@r1ck404/fast-esbuild-wasm) | esbuild-wasm 0.28.2 | transform 3-7.5x in the browser | JavaScript port of esbuild's transform pipeline in esbuild's own glue |
| [`@r1ck404/fast-es-module-lexer`](packages/fast-es-module-lexer) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-es-module-lexer.svg)](https://www.npmjs.com/package/@r1ck404/fast-es-module-lexer) | es-module-lexer 1.7.0 | 3-18x (Node), 2.3-7.4x (Chromium) | SIMD Rust/wasm port of lexer.c |
| [`@r1ck404/fast-brotli-wasm`](packages/fast-brotli-wasm) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-brotli-wasm.svg)](https://www.npmjs.com/package/@r1ck404/fast-brotli-wasm) | brotli-wasm 3.0.1 | compress q11 3-12.7x, decompress 2-3.6x | same Rust crates, rewritten encoder hot paths, new decoder |
| [`@r1ck404/fast-noble-hashes`](packages/fast-noble-hashes) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-noble-hashes.svg)](https://www.npmjs.com/package/@r1ck404/fast-noble-hashes) | @noble/hashes 1.8.0 | sha512 5x, md5 6.9x, sha1 2.4x, sha256 1.6x, pbkdf2 3.3-5.7x, scrypt 3.1x | noble's modules, with SHA-2/SHA-1/MD5, PBKDF2 and scrypt in Rust/wasm |

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
  "brotli-wasm": "npm:@r1ck404/fast-brotli-wasm@3.0.1",
  "@noble/hashes": "npm:@r1ck404/fast-noble-hashes@1.8.0"
}
```

(pnpm: the same specs under `pnpm.overrides` also redirect transitive
dependencies. A bundler alias, e.g. Vite `resolve.alias`, works as well.)
Alias `acorn-jsx` together with `acorn`: in a minified bundle the genuine
acorn-jsx is no longer recognisable, `@r1ck404/fast-acorn-jsx` is.
`@r1ck404/fast-noble-hashes` must be installed as `@noble/hashes` (its
`utils.js`, like noble's, imports `@noble/hashes/crypto` by name).

Entry points mirror the originals' (ESM and CommonJS, browser fields, types).
Differences are listed in each package's README; the notable ones: in Node,
`@r1ck404/fast-esbuild-wasm` is esbuild-wasm's own Node API (the fast path is the
browser build, or `@r1ck404/fast-esbuild-wasm/node.mjs` in-thread); pako's
`lib/*`/`dist/*` and es-module-lexer's `/js` subpaths are not provided.

## Results

How to read the tables: each row is one call on one input. The two time
columns are how long that call takes with the original package and with the
fast package (lower is better); **speedup** is original time ÷ fast time, so
`3.0x` means three times as fast.

Measured on a Ryzen 7 7800X3D with Node 24.16 and Chromium 149. The two
implementations alternate in fresh processes and each row keeps the best of 3
rounds. Raw data: `results/` (those files also list `prev`, an earlier
unpublished version of these packages, for comparison).

### fast-pako vs pako 2.1.0

| call | input | pako | fast-pako | speedup |
|---|---|---|---|---|
| `ungzip` | typescript 5.9.3 npm tarball (4.4 MB) | 100.7 ms | 17.5 ms | **5.8x** |
| `ungzip` | react-dom npm tarball (1.4 MB) | 33.4 ms | 5.7 ms | **5.8x** |
| `ungzip` | three npm tarball (4.6 MB) | 97.5 ms | 18.4 ms | **5.3x** |
| `ungzip` | 300 B | 9.7 µs | 2.3 µs | **4.3x** |
| `inflate` | 1 MB of JavaScript | 3.23 ms | 0.79 ms | **4.1x** |
| `inflate` | 9 MB of JavaScript | 28.8 ms | 6.8 ms | **4.2x** |
| `Inflate` stream, 16 KB pushes | typescript tarball | 101.1 ms | 27.4 ms | **3.7x** |
| `deflateRaw`, level 1 | 1 MB of JavaScript | 9.9 ms | 3.3 ms | **3.0x** |
| `deflate`, level 6 (default) | 1 KB of text | 71.6 µs | 11.7 µs | **6.1x** |
| `deflate`, level 6 (default) | 1 MB of JavaScript | 33.1 ms | 16.6 ms | **2.0x** |
| `deflate`, level 9 | 1 MB of JavaScript | 143.1 ms | 71.5 ms | **2.0x** |
| `gzip` | 300 B | 41.9 µs | 6.3 µs | **6.7x** |

### fast-acorn (+ fast-acorn-jsx) vs acorn 8.18 (+ acorn-jsx 5.3.2)

| call | input | acorn | fast-acorn | speedup |
|---|---|---|---|---|
| `parse` | 1.6 KB module | 41.3 µs | 14.3 µs | **2.9x** |
| `parse` | 51 KB module | 2.30 ms | 0.74 ms | **3.1x** |
| `parse` | react-dom (536 KB) | 17.1 ms | 5.9 ms | **2.9x** |
| `parse` | three.module (1.2 MB) | 18.0 ms | 6.1 ms | **3.0x** |
| `parse` | typescript.js (9 MB) | 342.6 ms | 138.5 ms | **2.5x** |
| `parse` with `locations` | 51 KB module | 2.86 ms | 1.06 ms | **2.7x** |
| `parse` with `locations` | three.module (1.2 MB) | 22.1 ms | 9.6 ms | **2.3x** |
| acorn-jsx `parse` with `locations` | 40 JSX files (95 KB) | 4.55 ms | 1.79 ms | **2.5x** |
| subclass overriding `parseFunctionBody` ¹ | rollup (948 KB) | 17.0 ms | 6.5 ms | **2.6x** |
| `parseExpressionAt` | 8 template expressions | 28.6 µs | 9.2 µs | **3.1x** |
| `tokenizer()` | 51 KB module | 964 µs | 608 µs | **1.6x** |
| any other `Parser.extend()` plugin | | | | 1.0x (runs acorn) |

¹ Nodepod's `topLevelParser`, which skips function bodies.

### fast-es-module-lexer vs es-module-lexer 1.7.0

| input | es-module-lexer | fast-es-module-lexer | speedup in Node | speedup in Chromium |
|---|---|---|---|---|
| 1.6 KB module | 4.7 µs | 0.7 µs | **6.5x** | **3.7x** |
| 51 KB module with non-ASCII text | 153.7 µs | 26.0 µs | **5.9x** | **4.4x** |
| react-dom (536 KB) | 2.13 ms | 0.12 ms | **18.4x** | **7.4x** |
| three.module (1.2 MB) | 2.15 ms | 0.19 ms | **11.2x** | **5.5x** |
| typescript.js (9 MB) | 35.2 ms | 4.7 ms | **7.4x** | |
| 644 lodash-es modules | 2.51 ms | 0.33 ms | **7.6x** | **4.2x** |
| 753 three/src modules | 15.5 ms | 2.2 ms | **7.0x** | **4.2x** |

(Times are Node's.)

### fast-brotli-wasm vs brotli-wasm 3.0.1

`compress()` without options uses quality 11, which is what Nodepod's zlib
polyfill calls.

| call | input | brotli-wasm | fast-brotli-wasm | speedup |
|---|---|---|---|---|
| `compress`, quality 11 (default) | 70 B | 2.30 ms | 0.18 ms | **12.7x** |
| `compress`, quality 11 (default) | 1.6 KB | 4.31 ms | 0.97 ms | **4.5x** |
| `compress`, quality 11 (default) | 8 KB of JSON | 11.5 ms | 3.3 ms | **3.4x** |
| `compress`, quality 11 (default) | 51 KB | 57.4 ms | 19.4 ms | **3.0x** |
| `compress`, quality 11 (default) | 536 KB | 698.6 ms | 241.5 ms | **2.9x** |
| `compress`, quality 5 | 1 MB | 31.3 ms | 13.0 ms | **2.4x** |
| `compress`, quality 1 | 1 MB | 16.5 ms | 5.8 ms | **2.8x** |
| `decompress` | 51 KB | 115.8 µs | 56.4 µs | **2.1x** |
| `decompress` | 1 MB | 2.25 ms | 0.97 ms | **2.3x** |
| `CompressStream`, quality 5 | 1 MB | 31.1 ms | 13.2 ms | **2.4x** |
| `DecompressStream` | 1 MB | 2.31 ms | 1.59 ms | **1.5x** |

### fast-noble-hashes vs @noble/hashes 1.8.0

Nodepod's crypto polyfill uses the one-shot hashers for lockfile integrity
and `pbkdf2Sync`, and `create()`/`update()`/`digest()` for `createHash`.
The Chromium column is the same call in headless Chromium.

| call | input | noble | fast-noble-hashes | speedup | speedup in Chromium |
|---|---|---|---|---|---|
| `sha512` | typescript 5.9.3 npm tarball (4.4 MB), lockfile integrity | 46.55 ms | 9.53 ms | **4.9x** | **5.8x** |
| `sha512` | react-dom npm tarball (1.4 MB) | 11.54 ms | 2.28 ms | **5.1x** | **5.6x** |
| `sha512` | 1 KB | 14.4 µs | 2.8 µs | **5.2x** | **5.0x** |
| `sha384` | 1 MB | 10.54 ms | 2.24 ms | **4.7x** | |
| `sha256` | 1 MB | 5.52 ms | 3.53 ms | **1.6x** | **2.3x** |
| `sha256` | 1 KB | 6.7 µs | 3.7 µs | **1.8x** | **2.3x** |
| `sha256` | 56-character string | 2.0 µs | 0.5 µs | **4.2x** | **4.2x** |
| `sha1` | 1 MB | 4.12 ms | 1.72 ms | **2.4x** | **4.1x** |
| `md5` | 1 MB | 9.98 ms | 1.45 ms | **6.9x** | **6.1x** |
| `md5` | 56-character string | 2.2 µs | 0.3 µs | **7.2x** | **5.6x** |
| `sha256.create().update(s).digest()` | 56-character string | 1.9 µs | 1.3 µs | **1.4x** | **2.3x** |
| `md5.create().update(s).digest()` | 56-character string | 2.2 µs | 1.1 µs | **2.1x** | **2.6x** |
| `sha256.create()`, 16 KB updates | 1 MB | 5.60 ms | 3.46 ms | **1.6x** | **2.2x** |
| `sha256.create()`, 100 B updates | 64 KB | 496.1 µs | 424.3 µs | **1.2-1.6x** ¹ | |
| `hmac(sha256, key, s)` | 56-character string | 5.2 µs | 3.7 µs | **1.4x** | **1.6x** |
| `pbkdf2(sha256)`, c=10000 | | 15.48 ms | 4.68 ms | **3.3x** | **4.2x** |
| `pbkdf2(sha512)`, c=10000 | | 39.28 ms | 6.92 ms | **5.7x** | **6.7x** |
| `scrypt`, N=2^14, r=8, p=1 | | 55.30 ms | 17.89 ms | **3.1x** | **2.9x** |

¹ Varies between runs (1.2x in this one, 1.6x-1.8x in others). The `create()`
path cannot beat noble's constructor, which costs ~270 ns in Node.

### fast-esbuild-wasm vs esbuild-wasm 0.28.2

In the browser (headless Chromium, the browser build in its default worker
mode, the way Nodepod runs it):

| `transform()` | input | esbuild-wasm | fast-esbuild-wasm | speedup |
|---|---|---|---|---|
| ESM → CommonJS | 1.6 KB | 1.5 ms | 0.2 ms | **7.5x** |
| ESM → CommonJS | 51 KB | 11.5 ms | 2.1 ms | **5.5x** |
| ESM → CommonJS | 17 files at once | 56.9 ms | 9.2 ms | **6.2x** |
| ESM → CommonJS | rollup (948 KB) | 129.9 ms | 34.4 ms | **3.8x** |
| ESM → CommonJS | three.module (1.2 MB) | 66.0 ms | 21.4 ms | **3.1x** |
| TypeScript → ESM | 25 KB | 4.1 ms | 1.0 ms | **4.1x** |
| TypeScript → ESM | 141 KB | 19.1 ms | 5.0 ms | **3.8x** |
| TSX + source map | 20 small components | 2.5 ms | 0.4 ms | **6.3x** |
| `initialize()` + first `transform()` | | 152.8 ms | 77.6 ms | **2.0x** |

In Node (`@r1ck404/fast-esbuild-wasm/node.mjs`, in-thread), with native
esbuild for reference:

| `transform()` | input | esbuild-wasm | fast-esbuild-wasm | speedup | native esbuild |
|---|---|---|---|---|---|
| ESM → CommonJS | 51 KB | 15.7 ms | 2.8 ms | **5.6x** | 3.8 ms |
| ESM → CommonJS | 17 files | 268.0 ms | 11.5 ms | **23x** | 21.2 ms |
| ESM → CommonJS | three.module (1.2 MB) | 77.0 ms | 25.7 ms | **3.0x** | 19.1 ms |
| TypeScript → ESM | 141 KB | 31.1 ms | 6.0 ms | **5.2x** | 5.5 ms |
| TS + source map + tsconfig (Vite-style) | 141 KB | 31.3 ms | 7.6 ms | **4.1x** | 7.0 ms |
| TSX | 20 small components | 15.6 ms | 0.43 ms | **36x** | 0.85 ms |

In Node, esbuild-wasm waits for the OS timer (15.6 ms on Windows) on every
call, which inflates the speedups for small inputs; the browser table is the
fairer comparison there. Against native esbuild called through its API, the
JavaScript engine is faster on small and medium files and about 1.3x slower
on 1 MB files.

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
* **fast-noble-hashes**: `test/diff.mjs` 108,052 each for ESM and CommonJS,
  107,838 with a second seed (digests and every instance field after every
  call against noble and node:crypto, errors, HMAC, HKDF, PBKDF2 and scrypt
  sync/async with progress callbacks, subclasses, tampered instances, UTF-8
  edges around the wasm buffer, wasm memory left clean), 108,052 again with
  WebAssembly disabled (the fallback is noble's code); `files.mjs` 236 (the
  shipped files are noble's plus `tools/patches.mjs`); `browser.mjs` 597 each
  in Chromium, Firefox and WebKit, main thread and module worker;
  `tools/mutate.mjs`: all 29 deliberate bugs are caught.

Independent checks (`verify/`, written separately from the package suites,
calling every package the way Nodepod does), 0 failures: pako 37,896
(Nodepod's content packing, random options, streaming with random flushes,
corrupt/truncated streams, tarballs); acorn 54,816 (Nodepod's exact
`topLevelParser` code, acorn-jsx and fast-acorn-jsx on a 3,243-file real-world
JSX corpus, tokenizer, parseExpressionAt, onComment, edits); es-module-lexer
40,041; brotli 7,906 (q11 and random qualities in random order, corrupt and
truncated streams, stream classes); noble-hashes 17,312 (lockfile SRI of npm
tarballs, one-shot and streamed digests and HMACs of 3,000 real files fed as
Buffers and strings, Nodepod's own pbkdf2 loop, scryptSync with Nodepod's
defaults, against noble and node:crypto); esbuild 8,114 through the public
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

The hand-written code is TypeScript: `X.mts` (`.ts`, `.cts`) next to the
`X.mjs` (`.js`, `.cjs`) the package ships, which `tools/ts-build.mjs`
generates by replacing the types with whitespace (ts-blank-space). The
JavaScript is the source minus its types, same code, comments, lines and
columns, so the TypeScript costs nothing at run time. Only erasable syntax is
allowed (`erasableSyntaxOnly`): no enums, namespaces or parameter
properties, and `declare` for class fields that are only assigned (a plain
`x: T;` field would create a property). The generated files are committed
and marked `linguist-generated`; `npm test` fails when one is stale.
Rust, tests, tools and benchmarks stay as they are (`.rs`, `.mjs`: CI runs
Node 20, which cannot run TypeScript). Type checking is loose for now
(`strict: false`): the glue modules have full annotations, the big ports
(fast-esbuild-wasm/src, fast-acorn/parser) type-check with `any` in places.

    npm run build:ts        # .mts/.ts/.cts -> .mjs/.js/.cjs (also runs in npm test as --check)
    npm run build:ts:watch  # the same on every save
    npm run typecheck       # tsc over every package

    npm install             # links the workspaces; builds @r1ck404/fast-esbuild-wasm (lib/, esm/)
    npm test                # generated files current, types, quick tests of every package
    npm run test:full       # all package suites (long)
    npm run verify          # independent checks + pack/install smoke test (long)
    npm run build:wasm      # rebuild the wasm of pako, es-module-lexer, brotli-wasm, noble-hashes
                            # (Rust with the wasm32-unknown-unknown target)

The larger corpora are optional: Nodepod's pnpm store (a `Nodepod` checkout
next to this repo), `corpus/*.tgz` for the pako bench, and the JSX corpus
(`node verify/make-jsx-corpus.mjs [max] [dir ...]`, from .tsx/.jsx files in
other projects; by default the ones next to this repo).

Benchmarks:

    node bench/interleave.mjs pako 3 pako fast
    node bench/interleave.mjs acorn 3 acorn fast
    node bench/interleave.mjs esbuild 3 wasm fast native          # Node, worker:false
    node bench/interleave.mjs esbuild-browser 2 wasm fast         # headless Chromium, worker mode
    node bench/interleave.mjs es-module-lexer 3 orig fast
    node bench/interleave.mjs es-module-lexer-browser 3 orig fast  # BROWSER=firefox|webkit
    node bench/interleave.mjs brotli 3 orig fast
    node bench/interleave.mjs noble-hashes 3 orig fast
    node bench/interleave.mjs noble-hashes-browser 3 orig fast     # headless Chromium

Where Nodepod itself spends CPU time on real projects (a Nodepod checkout next
to this repo; results in `results/nodepod-profile-*.md`):

    node bench/tools/nodepod-prof-build.mjs            # profiling build of Nodepod (modules tagged with file names)
    node bench/nodepod-profile.mjs "run-vite8$" --runs 2   # examples from Nodepod's perf-bench/examples-spec.json
    node bench/tools/nodepod-hotspots.mjs .scratch/nodepod-profiles/<run>   # inside Nodepod's runtime

`interleave.mjs` alternates implementations in fresh processes and keeps the
best run per case, which makes the comparison robust to CPU frequency changes
and background load. For comparing your own changes, each suite also accepts
`prev`, which loads an older copy of the packages from `.scratch/prev/` (not
part of the repository; copy the packages there before you start).

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
* noble-hashes: a precomputed W+K message schedule for SHA-256 (~30% slower
  than keeping the schedule in locals); `Maj` reusing the previous round's
  `a ^ b` (+5% SHA-256, nothing for SHA-512); `wasm-opt -O3` (no change,
  kept for size). SHA-256 stays ~1.5x: scalar SHA-256 in wasm vs a JIT that
  already does 32-bit rotates well. The `create()` path is floored by noble's
  constructor (~270 ns in Node, mostly the ArrayBuffer behind its buffer);
  pooling those buffers would be faster but let instances share memory.

## License

Each package is distributed under the license of the package it replaces
(MIT, MIT AND Zlib for fast-pako, Apache-2.0 for fast-brotli-wasm), included in
its directory. The rest of the repository is MIT; see [LICENSE](LICENSE).
