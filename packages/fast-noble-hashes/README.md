# @r1ck404/fast-noble-hashes

A faster drop-in replacement for [`@noble/hashes@1.8.0`](https://www.npmjs.com/package/@noble/hashes):
noble's own modules, with SHA-256/224, SHA-512/384/512_224/512_256, SHA-1 and
MD5, PBKDF2's iteration loop and scrypt's ROMix running in Rust/WebAssembly.
Identical digests, errors, callbacks and even instance state (every field of
a hash object, buffer bytes included, is what noble's code would leave there).

```jsonc
// package.json
"dependencies": { "@noble/hashes": "npm:@r1ck404/fast-noble-hashes@1.8.0" }
```

Install it under the original name: like noble, `utils.js` imports
`@noble/hashes/crypto` by package name. Every entry point, both module formats,
the types and the `browser`/`exports` maps are noble's.

| operation | times faster than @noble/hashes 1.8.0, in Node | in Chromium |
|---|---|---|
| `sha512` / `sha384` (e.g. npm lockfile integrity of tarballs) | 4.7-5.2x | 5.0-5.8x |
| `md5` | 6.7-6.9x | 5.4-6.1x |
| `sha1` | 2.4-2.9x | 3.7-4.1x |
| `sha256` / `sha224` | 1.6-1.8x | 2.3x |
| any of them on a short string | 4.2-7.2x | 4.2-5.6x |
| `.create().update(short string).digest()` | 1.4-2.1x | 2.3-2.8x |
| `hmac` | 1.4x | 1.6x |
| `pbkdf2` (SHA-256 / SHA-512) | 3.3x / 5.7x | 4.2x / 6.7x |
| `scrypt` | 3.1x | 2.9x |

Times and inputs: [benchmark results](https://github.com/R1ck404/fast-packages#results).
SHA-3, BLAKE, RIPEMD-160, Argon2 and the rest run noble's code unchanged
(1.0x); HMAC and HKDF are faster through their hash.

## How

* `rust/src`: the block functions of SHA-256, SHA-512 (native i64), SHA-1 and
  MD5, fully unrolled; padding and finalisation; the PBKDF2-HMAC iteration
  loop; scrypt's ROMix with SIMD salsa20/8. 36 KB of wasm, embedded
  (base64) and compiled synchronously on load.
* `esm/_fast.ts` (TypeScript; `esm/_fast.js` and the CommonJS `_fast.js` are generated from it): `HashMD.update` and
  `digestInto` move the state words between noble's instance fields and wasm
  memory around each call and write noble's buffer exactly as its JS would;
  strings are UTF-8 encoded straight into wasm memory. The one-shot hashers
  (`sha256(msg)`) never create an instance. scrypt gets a wasm instance of its
  own per call, so a large N leaves no large memory behind. Wasm memory holds
  no message bytes or state between calls.
* The patched modules (`_md.js`, `sha2.js`, `legacy.js`, `pbkdf2.js`,
  `scrypt.js`, ESM and CommonJS) are noble's files plus the find/replace pairs
  in `tools/patches.mjs`; every other file is noble's, byte for byte (minus
  source-map comments). `test/files.mjs` checks both.
* Subclasses of noble's classes (which may override `process()`), instances
  whose `blockLen`/`outputLen`/`padOffset`/`isLE` were changed, and
  environments without WebAssembly (e.g. a CSP without `wasm-unsafe-eval`)
  run noble's code.

Differences: the prototypes of the accelerated classes carry one extra
(symbol-keyed, non-enumerable) property; the source maps and `src/*.ts` are
not shipped; noble's module-level scratch arrays (`SHA256_W` and so on) are not
zeroed after wasm calls because wasm never uses them.

## Development

    node build.mjs            # cargo build (wasm32, simd128) + wasm-opt -> _fastwasm.js, esm/_fastwasm.js, _fast.js
    node tools/vendor.mjs     # re-create noble's files (+ patches) from node_modules/@noble/hashes
    npm test                  # files + quick differential test (ESM and CommonJS)
    npm run test:full         # full differential tests, a second seed, no-wasm fallback, browsers
    npm run mutate            # the tests must catch deliberate bugs in _fast.ts / _md.js

`test/diff.mjs` compares against @noble/hashes 1.8.0 from node_modules and
node:crypto: digests and every instance field after every call (streaming
with random chunks and strings, clones, `_cloneInto`, `digestInto` into
subarrays), errors, the hasher objects, HMAC, HKDF, PBKDF2 and scrypt (sync
and async, progress callbacks, bad options), subclasses, tampered instances,
string lengths around the wasm buffer, and that no bytes are left in wasm
memory. `test/browser.mjs` runs a differential check in Chromium, Firefox and
WebKit, on the main thread and in a module worker.
