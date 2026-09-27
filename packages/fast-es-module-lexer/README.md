# @r1ck404/fast-es-module-lexer

A faster drop-in replacement for [`es-module-lexer@1.7.0`](https://www.npmjs.com/package/es-module-lexer):
the same exports (`ImportType`, `init`, `initSync`, `parse`), identical
results (object shapes, key order, values) and identical errors.

```jsonc
// package.json
"dependencies": { "es-module-lexer": "npm:@r1ck404/fast-es-module-lexer@1.7.0" }
```

| input | times faster than es-module-lexer 1.7.0, in Node | in Chromium |
|---|---|---|
| small modules (70B-1.6KB) | 3-6.5x | 2.3-3.7x |
| 0.5-1.2MB bundles | 6-18x | 5-7.4x |
| batches of real package files | 5-7.6x | 3.5-4.5x |

Times and inputs: [benchmark results](https://github.com/R1ck404/fast-packages#results).

## How

* `rust/src/lib.rs`: lexer.c ported function by function; the main loop only
  stops at the few characters that matter (SIMD nibble-table classifier over
  64-char blocks), strings/comments/templates/import clauses are skipped with
  SIMD.
* Getting the source into wasm: Node's `Buffer.latin1Write`/`ucs2Write`, a wasm
  loop over the JS-string builtins in Chromium, `TextEncoder.encodeInto`
  elsewhere; always one byte per UTF-16 unit, which is all the lexer needs.
* Results come back as one int array; specifiers without escapes are sliced
  instead of `eval`'d.
* The original reads memory past its source for some malformed inputs (its
  answer then depends on what it parsed before). Those inputs are detected and
  handed to the vendored original (`vendor/lexer.js`).

`index.mjs` is the public entry; `lexer.mjs` is the implementation (its extra
exports are test hooks). The `es-module-lexer/js` (asm.js) subpath is not
provided.

## Development

    node build.mjs            # cargo build (wasm32, simd128) + wasm-opt -> lexer.wasm.mjs
    npm test                  # edge cases + quick corpus diff
    npm run test:full         # full corpus in every copy mode, browsers (Chromium, Firefox, WebKit)
