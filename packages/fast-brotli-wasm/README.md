# @r1ck404/fast-brotli-wasm

A faster drop-in replacement for [`brotli-wasm@3.0.1`](https://www.npmjs.com/package/brotli-wasm):
the same API (`compress`, `decompress`, `CompressStream`, `DecompressStream`,
`BrotliStreamResult`, `BrotliStreamResultCode`), **byte-identical compressed
output** at every quality, identical decompression results and errors.

```jsonc
// package.json
"dependencies": { "brotli-wasm": "npm:@r1ck404/fast-brotli-wasm@3.0.3" }
```

Entry points like brotli-wasm's: `require()` in Node is synchronous (plus a
`default` promise), `import` gives a default export that is a promise for
the module (browser: fetches `fastbrotli.wasm` next to `pkg.web.mjs`; Node:
reads it). Node >= 20.19.

| operation | times faster than brotli-wasm 3.0.1 |
|---|---|
| `compress()` (quality 11, the default) 70B / 1.6KB / 8KB | 12.7 / 4.5 / 3.4x |
| `compress()` quality 11, 51KB-1MB | 2.9-3x |
| quality 1 / 5 / 9 | 2.8-3.4 / 2.4-3.2 / 1.8-4.2x |
| `decompress` | 2.0-3.6x |

Times and inputs: [benchmark results](https://github.com/R1ck404/fast-packages#results).

## How

One-shot decompression of inputs at least 256
KiB long now supplies the bit reader's eight zero padding bytes in the JS
input allocation. This removes the decoder's second allocation and input
copy. Older WASM binaries and the existing unpadded WASM exports keep their
original path; streams and the reference fallback still use the same decoder.
This targets large compressed inputs; smaller-input performance is generally unchanged.

* The same Rust crates (brotli 5.0.0, brotli-decompressor 4.0.0), vendored in
  `rust/vendor` with the encoder's hot paths rewritten so that every decision,
  including floating-point costs and tie-breaks, is unchanged: Zopfli
  relaxation with per-insert-code length-cost tables, per-position
  distance-cache tables, dominated start positions skipped, cheaper
  clustering, SIMD match finding and block splitting, no zeroing of buffers
  that are written before they are read.
* A new one-shot decoder (`rust/src/fastdec`: straight into the output buffer,
  64-bit bit reader, fused tables); the reference decoder handles streams and
  errors.
* A plain C ABI (`rust/src/lib.rs`) and a small JS glue (`core.mts`, shipped as `core.mjs`) that
  reproduces wasm-bindgen's behaviour (copies, error types, and the options:
  `rust/options` is serde_json's parsing for brotli-wasm's options
  struct without serde, with the same accepted inputs and the same panic
  messages).
* A smaller wasm than brotli-wasm's (709 KB vs 1057 KB; -46% gzip, -41% brotli): no serde or
  `core::fmt` float code, no metablock logging (brotli-wasm only ever sets the
  quality), and the encoder's four big lookup tables (518 KB) are stored
  packed and rebuilt at the first encoder use (`rust/vendor/brotli/src/enc/fast_tables.rs`,
  written by `tools/pack-tables.mjs` from brotli-wasm's own tables).

## Development

    node build.mjs            # cargo build (wasm32, simd128) + wasm-opt -> fastbrotli.wasm
    npm test                  # API parity, options, tables, streams, quick decode equivalence
    npm run test:full         # + options fuzz, compress at qualities 0-11 over a corpus, stress inputs, 285k decode checks

`test/options.mjs` compares `compress()` options handling with brotli-wasm on
fresh instances (hand-picked and random values: quality used, thrown value,
console output); `test/tables.mjs` checks the rebuilt tables against
brotli-wasm's. `tools/debug-escapes.mjs` and `tools/pack-tables.mjs`
regenerate the data files they check.

`test/compress-equiv.mjs --dir=<dir> --max=N` runs the compressor over any
directory (reference outputs from brotli-wasm are cached by content hash).
