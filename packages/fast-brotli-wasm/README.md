# @r1ck404/fast-brotli-wasm

A faster drop-in replacement for [`brotli-wasm@3.0.1`](https://www.npmjs.com/package/brotli-wasm):
the same API (`compress`, `decompress`, `CompressStream`, `DecompressStream`,
`BrotliStreamResult`, `BrotliStreamResultCode`), **byte-identical compressed
output** at every quality, identical decompression results and errors.

```jsonc
// package.json
"dependencies": { "brotli-wasm": "npm:@r1ck404/fast-brotli-wasm@3.0.1" }
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
  reproduces wasm-bindgen's behaviour (copies, error types, option parsing
  through serde including its panics).

## Development

    node build.mjs            # cargo build (wasm32, simd128) + wasm-opt -> fastbrotli.wasm
    npm test                  # API parity, streams, quick decode equivalence
    npm run test:full         # compress at qualities 0-11 over a corpus, stress inputs, 285k decode checks

`test/compress-equiv.mjs --dir=<dir> --max=N` runs the compressor over any
directory (reference outputs from brotli-wasm are cached by content hash).
