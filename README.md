# fast-* drop-ins: faster pako, acorn, acorn-jsx, esbuild-wasm, es-module-lexer, brotli-wasm, @noble/hashes

[![CI](https://github.com/R1ck404/fast-packages/actions/workflows/ci.yml/badge.svg)](https://github.com/R1ck404/fast-packages/actions/workflows/ci.yml)

Faster drop-in replacements for the packages Nodepod uses, published as
`@r1ck404/fast-<name of the package it replaces>` with the **same version**
as the original. Each is verified to produce **identical results**
(byte-identical output, identical ASTs, errors and callbacks) against the
original on large real-world corpora, and none ships a copy of the original
as a fallback (see [Size](#size)). Nothing here is wired into Nodepod yet.

| package | npm | replaces | typical speedup | approach |
|---|---|---|---|---|
| [`@r1ck404/fast-pako`](packages/fast-pako) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-pako.svg)](https://www.npmjs.com/package/@r1ck404/fast-pako) | pako 2.1.0 | ungzip 5-6x, inflate 4x, deflate L1 3x | pako's zlib ported to Rust/wasm, same bytes; pako's JS behaviour emulated around it |
| [`@r1ck404/fast-acorn`](packages/fast-acorn) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-acorn.svg)](https://www.npmjs.com/package/@r1ck404/fast-acorn) | acorn 8.18.0 | parse 2.5-3.1x, JSX and `parseFunctionBody` subclasses 2.2-2.6x | a parser mirroring acorn function by function, for all of acorn (acorn's own code only for unrecognised plugins, loaded on demand) |
| [`@r1ck404/fast-acorn-jsx`](packages/fast-acorn-jsx) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-acorn-jsx.svg)](https://www.npmjs.com/package/@r1ck404/fast-acorn-jsx) | acorn-jsx 5.3.2 | (enables the JSX fast path in minified bundles) | acorn-jsx + a registration hook |
| [`@r1ck404/fast-esbuild-wasm`](packages/fast-esbuild-wasm) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-esbuild-wasm.svg)](https://www.npmjs.com/package/@r1ck404/fast-esbuild-wasm) | esbuild-wasm 0.28.2 | transform 3-5.5x, minify and target lowering 2.2-6.7x, build 2.4-3.2x in the browser | all of esbuild ported to JavaScript (transform, CSS, build, resolver, plugins, messages, CLI, Node API): no Go binary, 86% smaller than esbuild-wasm |
| [`@r1ck404/fast-es-module-lexer`](packages/fast-es-module-lexer) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-es-module-lexer.svg)](https://www.npmjs.com/package/@r1ck404/fast-es-module-lexer) | es-module-lexer 1.7.0 | 3-18x (Node), 2.3-7.4x (Chromium) | SIMD Rust/wasm port of lexer.c |
| [`@r1ck404/fast-brotli-wasm`](packages/fast-brotli-wasm) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-brotli-wasm.svg)](https://www.npmjs.com/package/@r1ck404/fast-brotli-wasm) | brotli-wasm 3.0.1 | compress q11 3-12.7x, decompress 2-3.6x | same Rust crates, rewritten encoder hot paths, new decoder |
| [`@r1ck404/fast-noble-hashes`](packages/fast-noble-hashes) | [![npm](https://img.shields.io/npm/v/@r1ck404/fast-noble-hashes.svg)](https://www.npmjs.com/package/@r1ck404/fast-noble-hashes) | @noble/hashes 1.8.0 | sha512 5x, md5 6.9x, sha1 2.4x, sha256 1.6x, pbkdf2 3.3-5.7x, scrypt 3.1x | noble's modules, with SHA-2/SHA-1/MD5, PBKDF2 and scrypt in wasm (built from templates on first use) |

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

Entry points mirror the originals' (ESM and CommonJS, browser fields, types;
`@r1ck404/fast-pako` also ships types, pako has none).
Differences are listed in each package's README; the notable ones:
`@r1ck404/fast-pako` and `@r1ck404/fast-noble-hashes` need WebAssembly (they
throw a clear error without it; noble's non-accelerated hashes still work);
outside Node, acorn plugins other than acorn-jsx need
`import "@r1ck404/fast-acorn/full"` once (in Node acorn's code loads on
demand); in Node,
`@r1ck404/fast-esbuild-wasm` has no Go binary: `initialize()` still validates
`wasmURL`/`wasmModule` like esbuild-wasm but ignores them, and in the browser's
worker mode `build()` runs on the page's thread; pako's
`lib/*`/`dist/*` and es-module-lexer's `/js` subpaths are not provided.

## Results

How to read the tables: each row is one call on one input. The two time
columns are how long that call takes with the original package and with the
fast package (lower is better); **speedup** is original time ÷ fast time, so
`3.0x` means three times as fast.

Measured on a Ryzen 7 7800X3D with Node 24.16 and Chromium 149. The
implementations alternate in fresh processes and each row keeps the best of 3
rounds. Raw data: `results/` (those files also list `prev`, the previous
version of these packages, for comparison).

### fast-pako vs pako 2.1.0

| call | input | pako | fast-pako | speedup |
|---|---|---|---|---|
| `ungzip` | typescript 5.9.3 npm tarball (4.4 MB) | 99.8 ms | 17.3 ms | **5.8x** |
| `ungzip` | react-dom npm tarball (1.4 MB) | 33.0 ms | 5.6 ms | **5.9x** |
| `ungzip` | three npm tarball (4.6 MB) | 95.9 ms | 18.4 ms | **5.2x** |
| `ungzip` | 300 B | 9.2 µs | 2.2 µs | **4.2x** |
| `inflate` | 1 MB of JavaScript | 3.18 ms | 0.76 ms | **4.2x** |
| `inflate` | 9 MB of JavaScript | 28.1 ms | 6.7 ms | **4.2x** |
| `Inflate` stream, 16 KB pushes | typescript tarball | 98.3 ms | 23.5 ms | **4.2x** |
| `deflateRaw`, level 1 | 1 MB of JavaScript | 9.9 ms | 3.2 ms | **3.0x** |
| `deflate`, level 6 (default) | 75 B | 80.6 µs | 4.0 µs | **20x** |
| `deflate`, level 6 (default) | 1 KB of text | 68.5 µs | 11.8 µs | **5.8x** |
| `deflate`, level 6 (default) | 1 MB of JavaScript | 32.8 ms | 15.7 ms | **2.1x** |
| `deflate`, level 9 | 1 MB of JavaScript | 140.2 ms | 64.3 ms | **2.2x** |
| `gzip` | 300 B | 39.9 µs | 6.1 µs | **6.5x** |

### fast-acorn (+ fast-acorn-jsx) vs acorn 8.18 (+ acorn-jsx 5.3.2)

| call | input | acorn | fast-acorn | speedup |
|---|---|---|---|---|
| `parse` | 1.6 KB module | 41.3 µs | 14.4 µs | **2.9x** |
| `parse` | 51 KB module | 2.28 ms | 0.72 ms | **3.2x** |
| `parse` | react-dom (536 KB) | 16.2 ms | 5.7 ms | **2.8x** |
| `parse` | three.module (1.2 MB) | 17.0 ms | 6.0 ms | **2.8x** |
| `parse` | typescript.js (9 MB) | 318.1 ms | 127.8 ms | **2.5x** |
| `parse` with `locations` | 51 KB module | 2.75 ms | 0.99 ms | **2.8x** |
| `parse` with `locations` | three.module (1.2 MB) | 20.2 ms | 8.7 ms | **2.3x** |
| acorn-jsx `parse` with `locations` | 40 JSX files (95 KB) | 4.33 ms | 1.72 ms | **2.5x** |
| subclass overriding `parseFunctionBody` ¹ | rollup (948 KB) | 16.4 ms | 6.4 ms | **2.6x** |
| `parseExpressionAt` | 8 template expressions | 28.3 µs | 8.9 µs | **3.2x** |
| `tokenizer()` | 51 KB module | 961 µs | 371 µs | **2.6x** |
| `tokenizer()` | react-dom dev (1 MB) | 12.6 ms | 5.8 ms | **2.2x** |
| any other `Parser.extend()` plugin ² | 40 JSX files (95 KB) | 4.30 ms | 1.73 ms | **2.5x** |

¹ Nodepod's `topLevelParser`, which skips function bodies.
² A subclass the fast parser does not recognise runs acorn's own code (loaded
on first use), on top of the faster tokenizer.

### fast-es-module-lexer vs es-module-lexer 1.7.0

| input | es-module-lexer | fast-es-module-lexer | speedup in Node | speedup in Chromium |
|---|---|---|---|---|
| 1.6 KB module | 4.6 µs | 0.7 µs | **6.6x** | **3.9x** |
| 51 KB module with non-ASCII text | 153.6 µs | 25.5 µs | **6.0x** | **4.4x** |
| react-dom (536 KB) | 2.11 ms | 0.12 ms | **18.1x** | **7.1x** |
| three.module (1.2 MB) | 2.15 ms | 0.19 ms | **11.4x** | **5.4x** |
| typescript.js (9 MB) | 34.6 ms | 4.7 ms | **7.4x** | |
| 644 lodash-es modules | 2.51 ms | 0.32 ms | **7.9x** | **4.2x** |
| 753 three/src modules | 15.6 ms | 2.2 ms | **7.2x** | **4.2x** |

(Times are Node's.)

### fast-brotli-wasm vs brotli-wasm 3.0.1

`compress()` without options uses quality 11, which is what Nodepod's zlib
polyfill calls.

| call | input | brotli-wasm | fast-brotli-wasm | speedup |
|---|---|---|---|---|
| `compress`, quality 11 (default) | 70 B | 2.31 ms | 0.18 ms | **13.2x** |
| `compress`, quality 11 (default) | 1.6 KB | 4.30 ms | 0.94 ms | **4.6x** |
| `compress`, quality 11 (default) | 8 KB of JSON | 11.4 ms | 3.3 ms | **3.4x** |
| `compress`, quality 11 (default) | 51 KB | 56.9 ms | 19.0 ms | **3.0x** |
| `compress`, quality 11 (default) | 536 KB | 686.0 ms | 236.8 ms | **2.9x** |
| `compress`, quality 5 | 1 MB | 30.8 ms | 12.7 ms | **2.4x** |
| `compress`, quality 1 | 1 MB | 16.0 ms | 5.9 ms | **2.7x** |
| `decompress` | 51 KB | 113.8 µs | 56.3 µs | **2.0x** |
| `decompress` | 1 MB | 2.21 ms | 0.96 ms | **2.3x** |
| `CompressStream`, quality 5 | 1 MB | 30.8 ms | 12.8 ms | **2.4x** |
| `DecompressStream` | 1 MB | 2.27 ms | 1.55 ms | **1.5x** |

### fast-noble-hashes vs @noble/hashes 1.8.0

Nodepod's crypto polyfill uses the one-shot hashers for lockfile integrity
and `pbkdf2Sync`, and `create()`/`update()`/`digest()` for `createHash`.
The Chromium column is the same call in headless Chromium.

| call | input | noble | fast-noble-hashes | speedup | speedup in Chromium |
|---|---|---|---|---|---|
| `sha512` | typescript 5.9.3 npm tarball (4.4 MB), lockfile integrity | 30.47 ms | 5.68 ms | **5.4x** | **6.0x** |
| `sha512` | react-dom npm tarball (1.4 MB) | 9.82 ms | 1.83 ms | **5.4x** | **6.0x** |
| `sha512` | 1 KB | 8.7 µs | 1.8 µs | **4.7x** | **4.7x** |
| `sha384` | 1 MB | 7.30 ms | 1.36 ms | **5.4x** | |
| `sha256` | 1 MB | 3.65 ms | 2.12 ms | **1.7x** | **2.3x** |
| `sha256` | 1 KB | 4.4 µs | 2.3 µs | **1.9x** | **2.3x** |
| `sha256` | 56-character string | 1.2 µs | 0.3 µs | **4.0x** | **4.2x** |
| `sha1` | 1 MB | 2.64 ms | 1.01 ms | **2.6x** | **4.3x** |
| `md5` | 1 MB | 8.95 ms | 1.15 ms | **7.8x** | **5.7x** |
| `md5` | 56-character string | 1.5 µs | 0.2 µs | **7.0x** | **5.7x** |
| `sha256.create().update(s).digest()` | 56-character string | 1.2 µs | 0.7 µs | **1.7x** | **2.4x** |
| `md5.create().update(s).digest()` | 56-character string | 1.5 µs | 0.7 µs | **2.3x** | **2.8x** |
| `sha256.create()`, 16 KB updates | 1 MB | 3.67 ms | 2.14 ms | **1.7x** | **2.4x** |
| `sha256.create()`, 100 B updates | 64 KB | 320.1 µs | 266.9 µs | **1.2x** | |
| `hmac(sha256, key, s)` | 56-character string | 3.2 µs | 2.4 µs | **1.3x** | **1.7x** |
| `pbkdf2(sha256)`, c=10000 | | 9.09 ms | 2.65 ms | **3.4x** | **3.9x** |
| `pbkdf2(sha512)`, c=10000 | | 24.17 ms | 3.36 ms | **7.2x** | **8.2x** |
| `scrypt`, N=2^14, r=8, p=1 | | 36.32 ms | 16.06 ms | **2.3x** | **2.3x** |

### fast-esbuild-wasm vs esbuild-wasm 0.28.2

In the browser (headless Chromium, the browser build in its default worker
mode, the way Nodepod runs it; the page timer resolves 0.1 ms):

| call | input | esbuild-wasm | fast-esbuild-wasm | speedup |
|---|---|---|---|---|
| ESM → CommonJS | 1.6 KB | 1.4 ms | 0.3 ms | **4.7x** |
| ESM → CommonJS | 51 KB | 11.4 ms | 2.1 ms | **5.4x** |
| ESM → CommonJS | 17 files one after another | 56.5 ms | 10.0 ms | **5.7x** |
| ESM → CommonJS | rollup (948 KB) | 127.4 ms | 36.5 ms | **3.5x** |
| ESM → CommonJS | three.module (1.2 MB) | 65.1 ms | 20.5 ms | **3.2x** |
| TypeScript → ESM | 31 KB | 4.5 ms | 1.0 ms | **4.5x** |
| TypeScript → ESM | 157 KB | 19.7 ms | 5.8 ms | **3.4x** |
| TS + source map (Vite-style) | 157 KB | 27.0 ms | 7.6 ms | **3.6x** |
| TSX + source map | 20 small components | 2.5 ms | 0.5 ms | **5.0x** |
| `build()`, plugin file system | zod | 121.1 ms | 37.5 ms | **3.2x** |
| `build()`, minify + source map | zod | 159.0 ms | 51.2 ms | **3.1x** |
| `build()` | lodash-es (640 files) | 400.8 ms | 126.3 ms | **3.2x** |
| `build()` | three (1.2 MB) | 227.3 ms | 86.8 ms | **2.6x** |
| `build()` | react-dom client (1 MB CommonJS) | 94.7 ms | 39.0 ms | **2.4x** |
| `initialize()` (script load included) | | 37.0 ms | 35.0 ms | **1.06x** |
| `initialize()` + first `transform()` | | 152.4 ms | 55.9 ms | **2.7x** |

Vite's own calls, Chromium, worker mode (these used to need esbuild's Go code,
because of `supported`, object defines, minify and build targets):

| Vite call | input | esbuild-wasm | fast-esbuild-wasm | speedup |
|---|---|---|---|---|
| `renderChunk` (Vite 7 build targets, minify) | 1.2 MB | 110.7 ms | 29.9 ms | **3.7x** |
| `renderChunk` | 51 KB | 15.7 ms | 3.86 ms | **4.1x** |
| `renderChunk` | 1.6 KB | 1.35 ms | 0.13 ms | **10x** |
| `vite:esbuild` `.ts` (`supported`, source map) | 157 KB | 28.6 ms | 9.8 ms | **2.9x** |
| `vite:esbuild` `.ts` | 9 KB | 2.80 ms | 0.48 ms | **5.8x** |
| `vite:esbuild` `.tsx` | 20 components | 2.74 ms | 0.47 ms | **5.8x** |
| `vite:define` (`process.env: "{}"`) | 51 KB | 14.0 ms | 2.97 ms | **4.7x** |

In Node (`@r1ck404/fast-esbuild-wasm/node.mjs`, in-thread), with native
esbuild for reference:

| Vite call | input | esbuild-wasm | fast-esbuild-wasm | speedup | native esbuild |
|---|---|---|---|---|---|
| `renderChunk` | 1.2 MB | 119 ms | 38.7 ms | **3.1x** | 27.3 ms |
| `renderChunk` | 51 KB | 25 ms | 4.5 ms | **5.6x** | 3.6 ms |
| `vite:esbuild` `.ts` | 157 KB | 33 ms | 8.5 ms | **3.9x** | 7.8 ms |
| `vite:esbuild` `.tsx` | 20 components | 15.4 ms | 0.65 ms | **24x** | 1.3 ms |
| `vite:define` | 51 KB | 19 ms | 3.6 ms | **5.3x** | 4.0 ms |

In Node, esbuild-wasm waits for the OS timer (15.6 ms on Windows) on every
call, which inflates the speedups for small inputs; the browser tables are
the fairer comparison there.

### Startup

Fresh processes, medians (Node; esbuild in Chromium):

| | original | fast |
|---|---|---|
| `import "acorn"` | 5.4 ms | 5.1 ms |
| `import "acorn"` + first parse | 9.4 ms | 9.5 ms |
| `import "pako"` | 4.0 ms | 2.3 ms |
| `import "pako"` + first `ungzip` of a 1.4 MB tarball | 49.7 ms | 12.2 ms |
| `import "es-module-lexer"` | 1.6 ms | 1.5 ms |
| `import` + `await init` + first parse | 2.6 ms | 2.4 ms |
| `import` + `initSync()` + first parse | 2.2 ms | 2.3 ms |
| `import "@noble/hashes/sha256"` | 7.1 ms | 7.4 ms |
| first `sha256()` call | 0.3 ms | 1.2 ms ¹ |
| `require("brotli-wasm")` + first `compress()` | 22.8 ms | 12.7 ms |
| esbuild `initialize()` + first `transform()` (Chromium) | 152 ms | 56 ms |

¹ Each hash family builds and compiles its wasm on first use (~1 ms); it is
paid back after a few KB of input.

## Size

What an app ships: the browser bundle of the imports Nodepod uses (esbuild,
minified; min / gzip / brotli), plus the wasm files fetched at run time for
brotli-wasm and esbuild-wasm; and what npm downloads and installs.
`node bench/size.mjs [--pack]` measures it. None of the packages ships a copy
of the original any more.

| bundle | original | fast |
|---|---|---|
| `pako` (default import) | 47.3 / 15.1 / 13.6 KB | **45.6** / 30.6 / 29.2 KB |
| `pako` `{ ungzip }` | 47.2 / 15.0 / 13.6 KB | **44.0** / 30.0 / 28.7 KB |
| `acorn` (namespace) | 121.6 / 34.5 / 28.9 KB | **118.7** / 41.3 / 36.3 KB |
| `acorn` + `acorn-jsx` | 255.0 / 72.6 / 40.1 KB | **132.1 / 46.6 / 40.0** KB |
| `es-module-lexer` `{ initSync, parse }` | 14.1 / 6.5 / 5.8 KB | 21.6 / 9.3 / 8.5 KB |
| `brotli-wasm` (JS + wasm) | 1.06 MB / 576.5 / 395.8 KB | **713.7 / 309.4 / 235.8 KB** |
| `@noble/hashes`, Nodepod's imports | 17.3 / 7.5 / 6.2 KB | **16.9 / 7.0 / 6.2** KB |
| `@noble/hashes/sha256` alone | 4.7 / 2.4 / 2.0 KB | 7.6 / 3.6 / 3.3 KB |
| `@noble/hashes/sha512` alone | 7.5 / 3.6 / 3.1 KB | 8.0 / 3.8 / 3.4 KB |
| `esbuild-wasm` (JS + wasm) | 14.05 / 3.77 / 2.72 MB | **2.17 / 0.51 / 0.40 MB** (no wasm) |

| package | original tarball / unpacked | fast tarball / unpacked |
|---|---|---|
| pako | 412.5 KB / 1.64 MB | **43.5 KB / 93.3 KB** |
| acorn | 133.5 KB / 565.3 KB | **85.7 KB / 320.6 KB** |
| acorn-jsx | 7.6 KB / 24.4 KB | **7.5 KB / 24.3 KB** |
| es-module-lexer | 31.2 KB / 93.4 KB | **29.7 KB / 76.4 KB** |
| brotli-wasm | 1.74 MB / 3.25 MB | **318.6 KB / 746.9 KB** |
| @noble/hashes | 155.3 KB / 1.15 MB | **74.9 KB / 469.8 KB** |
| esbuild-wasm | 3.86 MB / 14.53 MB | **2.73 MB / 12.36 MB** |

Where the fast package is still larger, it is the fast engine itself:
compiled wasm compresses worse than the original's JavaScript (pako's zlib,
the SIMD lexer), the per-family glue outweighs noble's tiny SHA-256
function. Shrinking these
further cost more speed than the rules allow (every call faster than the
original, none more than 10% slower than the previous version); the numbers
are in the package READMEs.

## Verification

`npm run test:full` (`verify/suites.sh`) runs every package's differential
suites; `npm run verify` (`verify/all.sh`) runs the independent checks. All
compare against the original packages in `node_modules`.

Package suites (last full run, 0 failures / mismatches / false accepts):

* **fast-pako**: `test/equiv.mjs` 7,864 checks (levels, strategies,
  memLevels, windowBits, chunk sizes, dictionaries, gzip headers,
  multi-member/truncated streams, string output, corruption fuzz, streaming
  with flush modes); `test/fuzz.mjs` 14,368 + 14,363 (two seeds: crafted
  streams for every decoder corner, random Huffman headers, random options and
  pushes, every observable stream field, error shapes); `test/exotic.mjs`
  7,744 + 7,713 (the unusual options and inputs the vendored pako used to
  cover, against pako, documented differences pinned); `test/corpus.mjs`
  2,356 (Nodepod-style packing of real files, npm tarballs); `test/types.mjs`
  17; `test/load.mjs` 55 (no pako in the bundle, nothing at import).
* **fast-acorn / fast-acorn-jsx**: `test/diff.mjs --locs --comments --nodepod`
  over 14,670 files incl. Nodepod's pnpm store: 93,841 parses identical +
  8,849 identical errors; `versions.mjs` 309,982 (every ecmaVersion and
  option against npm acorn); `error-diff.mjs` 274,791 errors, every one
  produced by the fast parser; `jsx-diff.mjs` 124,645; `override-diff.mjs`
  18,305; `acorn-diff.mjs` 41,840 (acorn's generic code for plugins vs npm
  acorn); `plugins.mjs` 1,412 (unrecognised plugins, lazy loading,
  prototype patches); `bundle.mjs` 542 (browser bundles with and without
  `/full`); `options.mjs` 2,428.
* **fast-esbuild-wasm** (no Go binary; every comparison is against
  esbuild-wasm or native esbuild 0.28.2): `test/diff.mjs` 126,258 JS/TS
  outputs (code, map, warnings, errors) byte-identical over 3,944 files and
  57 option sets (Nodepod's, Vite's dev/build/renderChunk calls, minify,
  targets, supported, defines, source maps); `css-diff.mjs` 94,144 CSS
  outputs; `messages.mjs` (723 snippets x 12 log settings, 8,920 inputs from
  esbuild's own tests, 3,000 mutated files, builds and contexts, console
  output); `build-diff.mjs` 852 + 1,155 builds (plugin and real file
  systems); `resolve-diff.mjs` 73,724 resolves; `build-plugins.mjs` 23,
  `build-css.mjs` 46, `depth.mjs` (37 constructs at least as deep as
  esbuild-wasm), `node-api.mjs` 53 and `cli.mjs` 50 (vs esbuild-wasm's Node
  API and CLI), `yarnpnp.mjs` 349, `goregexp.mjs` 2,072 patterns,
  `input-sourcemaps.mjs` 1,864, `fuzz.mjs` and `css-fuzz.mjs` 3,000 each,
  `smoke.mjs` 581, `api.mjs` and `browser.mjs` (Chromium, Firefox, WebKit),
  `no-go.mjs` 121 (no Go file shipped or loaded, no child process).
* **fast-es-module-lexer**: `test/diff.mjs` 158,904 inputs x 4 source-copy
  modes (26k files plus UTF-16, truncated and edited variants; inputs on which
  the original reads outside its source are compared with a fresh original);
  `edge.mjs` 125,504 (incl. 100,000 fuzzed); `browser.mjs` 4,424 each in
  Chromium, Firefox and WebKit; `bundle.mjs` 32.
* **fast-brotli-wasm**: `test/compress-equiv.mjs` 4,892 + 18,116 on the
  pnpm store (qualities 0-11 byte-identical); `compress-stress.mjs` 8,244;
  `decode-equiv.mjs` 290,446 (native-brotli streams with random parameters,
  generated streams covering every format feature, fuzzed streams, errors
  included); `options.mjs` 25,655 (options parsing and its errors vs
  brotli-wasm); `tables.mjs` 56; `stream-equiv.mjs` 500; `api.mjs` 321.
* **fast-noble-hashes**: `test/diff.mjs` 113,334 each for ESM and CommonJS,
  113,120 with a second seed (digests and every instance field after every
  call against noble and node:crypto, errors, HMAC, HKDF, PBKDF2 and scrypt
  sync/async with progress callbacks, subclasses, tampered instances, the
  public surface); `nowasm.mjs` 344; `bundle.mjs` 207 (esbuild and Rollup
  bundles use the wasm and carry only the families they need); `files.mjs`
  247; `browser.mjs` 597 each in Chromium, Firefox and WebKit, main thread
  and module worker; `tools/mutate.mjs`: all 41 deliberate bugs are caught.

Independent checks (`verify/`, written separately from the package suites,
calling every package the way Nodepod does), 0 failures: pako 37,913
(Nodepod's content packing, random options, streaming with random flushes,
corrupt/truncated streams, tarballs); acorn 54,816 (Nodepod's exact
`topLevelParser` code, acorn-jsx and fast-acorn-jsx on a 3,243-file real-world
JSX corpus, tokenizer, parseExpressionAt, onComment, edits); es-module-lexer
40,041; brotli 7,906 (q11 and random qualities in random order, corrupt and
truncated streams, stream classes); noble-hashes 17,308 (lockfile SRI of npm
tarballs, one-shot and streamed digests and HMACs of 3,000 real files fed as
Buffers and strings, Nodepod's own pbkdf2 loop, scryptSync with Nodepod's
defaults, against noble and node:crypto); esbuild 8,075 through the public
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
(fast-esbuild-wasm/src, fast-acorn/src/parser) type-check with `any` in places.
fast-acorn ships one file: `packages/fast-acorn/build.mjs` bundles `src/`
into `index.mjs` (import time), `--check` fails when it is stale.

    npm run build:ts        # .mts/.ts/.cts -> .mjs/.js/.cjs (also runs in npm test as --check)
    npm run build:ts:watch  # the same on every save
    npm run typecheck       # tsc over every package

    npm install             # links the workspaces; builds @r1ck404/fast-esbuild-wasm (lib/, esm/)
    npm test                # generated files current, types, quick tests of every package
    npm run test:full       # all package suites (long)
    npm run verify          # independent checks + pack/install smoke test (long)
    npm run build:wasm      # rebuild the wasm of pako, es-module-lexer, brotli-wasm, noble-hashes
                            # (Rust with the wasm32-unknown-unknown target; noble's kernels are
                            # wasm templates in packages/fast-noble-hashes/wasm)
    node bench/size.mjs [--pack]   # bundle / tarball / unpacked sizes vs the originals

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

* esbuild (from when it still shipped esbuild's Go binary): GOGC tuning (1.3x on big inputs, but grows wasm memory that never
  shrinks), `wasm-opt -O2` on the Go binary (no speed gain; it was used for
  size: 3.4% smaller raw, also smaller gzipped and brotli'd; -Oz/-Os are
  smaller raw but compress worse), TinyGo/LLVM build (builds,
  but its js/wasm runtime cannot run esbuild's async stdin service loop);
  AST nodes as object literals (GC scavenges -35%, wall time unchanged or up
  to 9% slower); interning identifier strings (no gain).
* pako deflate at level 6-9 is bounded by zlib's match finder, which must visit
  the same candidates for identical output (~2x at L6, ~1.7-2x at L9,
  native-zlib speed). Inflate: fused length entries (10-17% slower), 4-5
  literals per refill, 9/10-bit distance / 10/12-bit literal tables, wasm-opt
  -O4 (all slower or no gain). Size: opt-level s/z for the core (1.7 KB
  smaller compressed, deflate 13-43% slower), inflating the embedded module
  with pako's JS (4.6-6 ms cold); the compressed wasm alone (21 KB) is
  larger than pako's gzipped JS, so the bundle stays ~2x pako's gzip size.
* brotli q10/q11 (Zopfli): a native x86 build of the same encoder is no faster
  than the wasm; what is left is the algorithm. Reordering relaxations across
  queue entries would be faster but can change tie-breaks (output); probing
  out of line, 16-byte queue entries, dictionary prefix tables, prefetching:
  no gain.
* es-module-lexer: a JS `charCodeAt` copy (~2.5 ns/char), `btoa` +
  `setFromBase64` (~1 ns/char), relaxed-SIMD swizzle (+3-12%, but would need a
  second module for engines without it). V8's baseline code for the builtins
  copy loop is slow, so the first ~1M chars use `intoCharCodeArray`.
  Size: opt-level z (0.2 KB smaller gzipped, up to 13% slower), dropping the
  Chromium copy module (0.5 KB, 37-135% slower in Chromium); a wasm small
  enough for the original's 6.5 KB bundle would mean giving up SIMD.
* acorn: lazily created token start positions, interning identifiers, object
  literal AST nodes (4x slower node creation), per-method speedups of the
  vendored acorn for unrecognised plugins (no measurable gain). Shipping
  several files (import 7.5-8.9 ms) or an unminified bundle (~6.0 ms) instead
  of one minified file; esbuild's bundler (its `var` conversion costs 5-10%
  on large parses, so rollup bundles); reusing the parse state (4-16% slower).
  gzip/brotli stay ~20% above acorn's: the fast machinery compresses less well
  than acorn's code, although the minified size is below it. `locations`
  costs are dominated by GC of the Position/SourceLocation objects the AST
  must contain.
* noble-hashes: a precomputed W+K message schedule for SHA-256 (~30% slower
  than keeping the schedule in locals); `Maj` reusing the previous round's
  `a ^ b` (+5% SHA-256, nothing for SHA-512); `wasm-opt -O3` (no change,
  kept for size). SHA-256 stays ~1.5x: scalar SHA-256 in wasm vs a JIT that
  already does 32-bit rotates well. The `create()` path is floored by noble's
  constructor (~270 ns in Node, mostly the ArrayBuffer behind its buffer);
  pooling those buffers would be faster but let instances share memory.
  Size: rolled SHA-2 rounds (0.79-0.97x speed) and call-based rounds; the
  kernels ship as templates that are expanded to unrolled code on first use
  instead. A lone `sha256` import stays above noble's (noble's JS SHA-256 is
  ~0.6 KB brotli'd, the glue alone ~1.9 KB).
* Bundlers drop calls annotated `/* @__PURE__ */` whose result is unused:
  fast-noble-hashes' wasm init was such a call, so every bundled build ran
  noble's JS (fixed). noble, es-module-lexer and acorn now have bundle tests
  (`test/bundle.mjs`), pako `test/load.mjs`.

## License

Each package is distributed under the license of the package it replaces
(MIT, MIT AND Zlib for fast-pako, Apache-2.0 for fast-brotli-wasm), included in
its directory. The rest of the repository is MIT; see [LICENSE](LICENSE).
