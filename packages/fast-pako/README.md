# @r1ck404/fast-pako

A faster drop-in replacement for [`pako@2.1.0`](https://www.npmjs.com/package/pako):
pako's zlib (deflate/inflate state machines, trees, checksums) ported to
Rust/WebAssembly with **byte-identical output**, the same API, results,
errors and streaming callbacks.

```jsonc
// package.json
"dependencies": { "pako": "npm:@r1ck404/fast-pako@2.1.0" }
```

`deflate`, `deflateRaw`, `gzip`, `inflate`, `inflateRaw`, `ungzip`, `Deflate`,
`Inflate`, `constants` (default export and named exports). The wasm is
embedded (no fetch, synchronous init). Types: `@types/pako` works with the
alias above. pako's `pako/lib/*` and `pako/dist/*` subpaths are not provided.

| vs pako 2.1.0 | speedup |
|---|---|
| ungzip of npm tarballs | 5.0-5.9x |
| inflate 1-9MB | 3.9-4.2x |
| deflateRaw level 1 | 2.6-3.7x |
| streaming `Inflate` | 3.7x |
| inputs of a few hundred bytes | 4-7x |
| deflate level 6 / 9 | ~2x (bounded by zlib's match search, which must stay identical) |

## How

* `rust/src`: pako's zlib ported function by function (same match finder,
  lazy evaluation, block decisions and bit output, so the bytes are the same),
  with a libdeflate-style fast inflate loop, a table-free folding crc32, SIMD
  adler32 and precomputed codes for level-1 block emission.
* `index.mjs`: pako's JS layer (options, chunking, `onData`/`onEnd`, string
  output, errors) emulated around the wasm; streaming sessions are pooled.
* Exotic inputs (non-byte arrays, unusual option values) go to the vendored
  pako (`vendor/pako.esm.mjs`), so behaviour stays identical.

Known difference: `Inflate.push()` with something other than a byte array
*after* the first push (e.g. a plain array with values > 255, a DataView) can
differ from pako, which feeds such raw values into its JS inflate. (On the
first push the stream is handed to pako itself.)

## Development

    node build.mjs            # cargo build (wasm32, simd128) + wasm-opt -> fastzlib.wasm.mjs
    npm test                  # quick equivalence + fuzz
    npm run test:full         # all levels/strategies/streams, fuzz, real files and tarballs

Tests compare against pako 2.1.0 from node_modules: `test/equiv.mjs`,
`test/fuzz.mjs` (crafted streams for every decoder corner, random options and
flushes, every observable stream field), `test/corpus.mjs` (Nodepod-style
packing of real files, npm tarballs). Native Rust tests:
`cargo test --release --target x86_64-pc-windows-msvc -- --test-threads=1`
in `rust/` (use your host target).
