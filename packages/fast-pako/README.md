# @r1ck404/fast-pako

Level-0 stored compression skips clearing its unused hash table during session initialization. Other compression modes still clear the table before searching it. This targets small level-0 operations and applies in browsers as well as Node; it does not change compressed bytes or chunk behavior.

A faster drop-in replacement for [`pako@2.1.0`](https://www.npmjs.com/package/pako):
pako's zlib (deflate/inflate state machines, trees, checksums) ported to
Rust/WebAssembly with **byte-identical output**, the same API, results,
errors and streaming callbacks. It contains no copy of pako: everything pako
does with unusual values (options of odd types, inputs that are not
`Uint8Array`s, gzip header fields, dictionaries) is reproduced by the port
and its JavaScript layer.

```jsonc
// package.json
"dependencies": { "pako": "npm:@r1ck404/fast-pako@2.1.2" }
```

`deflate`, `deflateRaw`, `gzip`, `inflate`, `inflateRaw`, `ungzip`, `Deflate`,
`Inflate`, `constants` (default export and named exports). The wasm is
embedded (no fetch) and loaded synchronously on first use: importing the
package does no work. Types: included (pako has none): the declarations of
`@types/pako` 2.0.4 as an ES module (`index.d.mts`, `tools/gen-types.mjs`),
so code written against pako + `@types/pako` type-checks unchanged, with or
without `@types/pako` installed. pako's `pako/lib/*` and `pako/dist/*`
subpaths are not provided. Needs WebAssembly: without it (or if the module
cannot be compiled) the first call throws `Error("fast-pako needs
WebAssembly (...)")`.

| operation | times faster than pako 2.1.0 |
|---|---|
| ungzip of npm tarballs | 5.1-6.2x |
| inflate 1-9MB | 4.0-4.4x |
| deflateRaw level 1 | 2.6-4.8x |
| streaming `Inflate` | 4.1x |
| inputs of a few hundred bytes | 4-8x |
| deflate level 6 / 9 | ~2x (bounded by zlib's match search, which must stay identical) |

Times and inputs: [benchmark results](https://github.com/R1ck404/fast-packages#results).

## How

* `rust/src`: pako's zlib ported function by function (same match finder,
  lazy evaluation, block decisions and bit output, so the bytes are the same),
  with a libdeflate-style fast inflate loop, a table-free folding crc32, SIMD
  adler32 and precomputed codes for level-1 block emission.
* `index.mts` (shipped as `index.mjs`): pako's JS layer (options, chunking,
  `onData`/`onEnd`, string output, errors) around the wasm; streaming
  sessions are pooled. It runs pako's option handling as pako does, with
  JavaScript's comparisons and coercions: a `level` of `"5"` indexes pako's
  configuration table but is not `=== 5`, a `windowBits` of `9.5` or `"12"`,
  a `memLevel` of `"1"` (pako computes `"1" + 7 = "17"`) all give pako's
  parameters, and the wasm gets the result. Exceptions that pako's own code
  throws (a `TypeError` for `strm.input.subarray is not a function`, `Cannot
  read properties of undefined (reading 'max_lazy')`, `RangeError`s...) are
  produced by the same expressions, so they carry the same messages
  (unminified; a minifier renames variables in both).
* Inputs that are not byte arrays: other typed arrays are read the way
  pako's `subarray()` + `set()` reads them (deflate), or, for inflate,
  element by element through a callback with pako's semantics: its bit
  buffer is a JavaScript number, so `hold += input[next] << bits` with an
  element of 300, -1, 1.5 or `"7"` adds that int32 value, carries into the
  next bits and loses what goes past 32 bits. The wasm reproduces pako's
  loading schedule for this (including the two-byte loads of its
  `inflate_fast`), the raw sums pako stores as header fields, `|=` in the
  check state, and the `String.fromCharCode` of name and comment
  characters. Plain arrays, strings, DataViews and array-likes throw where
  pako calls `subarray()` on them (stored blocks, gzip extra fields).
* Size: the wasm is `no_std` (a small first-fit allocator in
  `rust/src/heap.rs` instead of dlmalloc, no panic formatting), builds its
  larger tables (crc32, static trees) at first use, and is compiled without
  loop auto-vectorization or partial loop unrolling (the hot loops use
  explicit SIMD). It is embedded deflate-compressed (by
  `tools/deflate-opt.mjs`, an optimal-parsing encoder) as text (13 bits per
  two printable characters, 7% shorter than base64) and unpacked on first
  use by `rust/boot`, a 2 KB wasm decoder (about half a millisecond).

## Differences

Where pako never returns or corrupts its own data, fast-pako throws an
`Error` whose message starts with `fast-pako:` instead (each case is pinned
by `test/exotic.mjs`, section "documented differences"):

* `chunkSize` that is not a whole number >= 1 of type number: pako loops
  forever (0, `null`), counts with strings (`next_out += "64"`) or
  fractions, or allocates an array for an object. A negative value throws
  pako's own `RangeError`, as in pako.
* `Deflate.push()` that pako never returns from: a flush mode outside 0..5
  with input, a falsy input (`0`, `false`, `NaN`), `Z_SYNC_FLUSH` /
  `Z_FULL_FLUSH` with `chunkSize` <= 6, `Z_PARTIAL_FLUSH` with `chunkSize`
  1 (an empty block per chunk, forever).
* A zlib dictionary without a whole-number `length` (a `DataView`, a
  number): pako's `adler32` loops forever (deflate: in the constructor;
  inflate: when the stream asks for the dictionary).
* `windowBits` values that give pako a window smaller than 512 bytes (8.5,
  `"8"`, `NaN`, `undefined` for deflate: pako only turns the number 8 into
  9): pako's 256-byte (or 1-byte) window writes corrupt data or throws.
* `memLevel` values for which pako's buffers get smaller than zlib's
  minimum or huge (`"9"`, `"3"`, `NaN`, `undefined`: 1 to 16 symbols, pako
  writes past its pending buffer; `"2"`: over 500 MB). String values that
  give zlib-sized buffers (`"1"`, `"4"`, `"7"`, `"8"`) work like pako.
* Inflate input (array-likes) whose `length` is fractional or negative:
  pako then reads at fractional or negative positions. Inputs without a
  numeric length (`DataView`, numbers, objects) work like pako (it counts
  down from `NaN`).
* A gzip extra field longer than 16 MB, only possible with input elements
  that are not bytes (pako allocates it).

Other differences:

* `strm.output` is the last chunk passed to `onData` (pako: its working
  buffer, also while being filled); `strm.state` is an empty object while
  the stream is open, `null` afterwards (pako: its internal state object).
* A gzip header option whose fields make every `push()` throw (e.g. a
  BigInt `time`): pako also moves the header bytes it had written into
  `strm.output` at each attempt, so its `strm` counters grow; fast-pako's
  stay. The exceptions, and everything once the header succeeds, are the
  same.
* Getters and `valueOf` of option values and input elements can run a
  different number of times than in pako (the results are the same).

## Development

    node build.mjs            # cargo build (rust/, rust/boot; wasm32) + wasm-opt + deflate -> fastzlib.wasm.mjs
    npm test                  # types, loading, quick equivalence, fuzz and exotic-value fuzz
    node tools/gen-types.mjs  # index.d.mts from @types/pako 2.0.4 (devDependency)
    npm run test:full         # all levels/strategies/streams, fuzz, exotic values, real files and tarballs

Tests compare against pako 2.1.0 from node_modules: `test/types.mjs` (a
consumer type-checks the same against this package and against pako +
`@types/pako`, in four module modes), `test/load.mjs` (no pako in the
package or its minified bundle, no WebAssembly work at import, the error
without WebAssembly), `test/equiv.mjs`, `test/fuzz.mjs` (crafted streams for
every decoder corner, random options and flushes, every observable stream
field), `test/exotic.mjs` (options, inputs, header fields and dictionaries
of every type and value, as one-shot calls and streams with pushes of such
values: results, exceptions, chunks and every stream field, also as
`onData` sees them), `test/corpus.mjs` (Nodepod-style packing of real files,
npm tarballs). Native Rust tests:
`cargo test --release --target x86_64-pc-windows-msvc -- --test-threads=1`
in `rust/` (use your host target).
