# @r1ck404/fast-noble-hashes

A faster drop-in replacement for [`@noble/hashes@1.8.0`](https://www.npmjs.com/package/@noble/hashes):
noble's own modules, with SHA-256/224, SHA-512/384/512_224/512_256, SHA-1 and
MD5, PBKDF2's iteration loop and scrypt's ROMix running in WebAssembly.
Identical digests, errors, callbacks and even instance state (every field of
a hash object, buffer bytes included, is what noble's code would leave there).

```jsonc
// package.json
"dependencies": { "@noble/hashes": "npm:@r1ck404/fast-noble-hashes@1.8.0" }
```

Install it under the original name: like noble, `utils.js` imports
`@noble/hashes/crypto` by package name. Every entry point, both module formats,
the types and the `browser`/`exports` maps are noble's.

It needs WebAssembly with SIMD (Node 16.4+, Chrome/Edge 91+, Firefox 89+,
Safari 16.4+): without WebAssembly the accelerated functions throw on first
use (see [Differences](#differences-from-noblehashes)).

| operation | times faster than @noble/hashes 1.8.0, in Node | in Chromium |
|---|---|---|
| `sha512` / `sha384` (e.g. npm lockfile integrity of tarballs) | 4.6-5.3x | 5.0-6.0x |
| `md5` | 7.8-7.9x | 5.3-5.7x |
| `sha1` | 2.6-3.0x | 4.1-4.3x |
| `sha256` / `sha224` | 1.7-1.9x | 2.3x |
| any of them on a short string | 3.9-7.0x | 4.6-6.5x |
| `.create().update(short string).digest()` | 1.7-2.3x | 2.6-3.1x |
| `hmac` (SHA-256) | 1.3-1.4x | 1.7x |
| `pbkdf2` (SHA-256 / SHA-512) | 3.4x / 7.1x | 4.0x / 8.2x |
| `scrypt` | 2.3x | 2.3x |

Times and inputs: [benchmark results](https://github.com/R1ck404/fast-packages#results).
SHA-3, BLAKE, RIPEMD-160, Argon2 and the rest run noble's code unchanged
(1.0x); HMAC and HKDF are faster through their hash.

Bundle size (esbuild, minified; `bench/size.mjs`), bytes:

| import | @noble/hashes (min / gzip / brotli) | fast (min / gzip / brotli) |
|---|---|---|
| `sha256` | 4,705 / 2,363 / 2,010 | 7,574 / 3,629 / 3,275 |
| `sha512` | 7,535 / 3,646 / 3,094 | 7,994 / 3,803 / 3,438 |
| `md5` | 3,767 / 1,795 / 1,617 | 7,196 / 3,448 / 3,135 |
| Nodepod's imports (scrypt, sha384/512, sha256, sha1, md5, hmac, pbkdf2) | 17,311 / 7,459 / 6,237 | 16,859 / 7,036 / 6,197 |

A single SHA-2 or MD5 import is larger than noble's: for `sha256` the
glue, the common template and SHA-256's add about 1.9 KB brotli where
noble's compression function (with its constants) is about 0.6 KB. Together they are smaller than noble's code
for the same imports. npm: 74 KB tarball / 469 KB unpacked (noble: 155 KB
/ 1.15 MB).

## How

* **Kernels as templates.** `wasm/kernels.mjs` writes the compression
  functions of SHA-256, SHA-512 (native i64), SHA-1 and MD5, noble's buffer
  update, padding and finalisation, and the PBKDF2-HMAC iteration loop, with
  a small build-time assembler (`wasm/asm.mjs`). What ships is not the
  unrolled wasm but templates: a common one (module header and the update /
  digest / PBKDF2 / wipe functions, 541 bytes) and one per family (its
  rounds, 244-421 bytes), whose commands `expand()` in `_fast.js` resolves
  when the family is first used: `repeat` (the 64/80 rounds), `when` (the
  message schedule from round 16, SHA-1's round functions), the rotating
  state and message locals of round j, memory offsets and the family's
  constants. The result is fully unrolled code (SHA-256 8.8 KB, SHA-512
  11.3 KB, SHA-1 5.2 KB, MD5 3.1 KB), compiled synchronously. SHA-2's round
  constants are computed at that point (exact integer cube roots with
  BigInt); MD5's come from noble's own table.
* **scrypt**: `wasm/scrypt.wat` (694 bytes, assembled with binaryen): ROMix
  with salsa20/8 on SIMD vectors kept in registers. Each `scrypt()` call gets
  a fresh instance whose memory is grown to its N, r and p, so a large N
  leaves no large memory behind.
* **Embedding**: each template or module is a string export of `_fast.js`
  that only the module defining its hashers references (`sha2.js`,
  `legacy.js`, `scrypt.js`), so a bundle carries only the families its
  imports reach (`sha256` alone: the common template and SHA-256's). The
  text is printable ASCII without `"` and backslash: bytes 0x00-0x54 and
  0xfa-0xff (the frequent opcodes and immediates) are one character, the
  others two. It compresses almost like the binary (base64 is about 30%
  larger after compression; a table of the most frequent bytes was larger,
  table included).
* **Glue** (`esm/_fast.ts`, TypeScript; `esm/_fast.js` and the CommonJS
  `_fast.js` are generated from it): `HashMD.update` and `digestInto` move
  the state words between noble's instance fields and wasm memory around
  each call and write noble's buffer exactly as its JS would; strings are
  UTF-8 encoded straight into wasm memory. The one-shot hashers
  (`sha256(msg)`) never create an instance. Wasm memory holds no message
  bytes or state between calls.
* **Patches**: the patched modules (`_md.js`, `sha2.js`, `legacy.js`,
  `pbkdf2.js`, `scrypt.js`, ESM and CommonJS) are noble's files plus the
  find/replace pairs in `tools/patches.mjs`, which replace the compression
  functions (`process()` calls the wasm), their constant tables and scratch
  arrays, and scrypt's salsa20/BlockMix code. Every other file is noble's,
  byte for byte (minus source-map comments). `test/files.mjs` checks both.
* Subclasses of noble's classes (which may override `process()`) and
  instances whose `blockLen`/`outputLen`/`padOffset`/`isLE` were changed run
  noble's `update`/`digestInto` code, which calls `process()` per block (for
  noble's classes: the wasm, one block at a time). So does a class kept in a
  bundle without its hasher (`new SHA256()` without `sha256`): same results,
  slower.

## Differences from @noble/hashes

* **WebAssembly (with SIMD) is required.** Where `WebAssembly` is missing,
  the SHA-2, SHA-1 and MD5 hashers (one-shot and `.create()`), their classes
  as soon as a block is compressed (an update that fills the buffer,
  `digest`, `process`), HMAC / HKDF / PBKDF2 over them and `scrypt` /
  `scryptAsync` throw `Error("fast-noble-hashes needs WebAssembly")`; noble's
  input errors still come first, and creating instances and updates that
  stay in the buffer work (same fields as noble's). SHA-3, BLAKE,
  RIPEMD-160, Argon2 and the rest are noble's code and work. Where
  WebAssembly exists but cannot compile the module (a CSP without
  `wasm-unsafe-eval`, no SIMD), the engine's `CompileError` is thrown
  instead. Pinned by `test/nowasm.mjs` (ESM and CommonJS).
* **scrypt's memory is wasm memory**: `128 * r * (N + p + 1)` bytes plus 64
  KiB must fit into 4 GiB (only reachable with a raised `maxmem`; the
  default limit is 1 GiB). Beyond that, and whenever the memory cannot be
  allocated, scrypt throws the `RangeError` of `WebAssembly.Memory.grow()`,
  where noble tries to allocate its arrays (and throws a `RangeError` of its
  own when that fails). Pinned by `test/diff.mjs` ("scrypt unallocatable",
  "scryptAsync unallocatable": a `RangeError` in both).
* noble's module-private constant tables and scratch arrays (`SHA256_K`,
  `SHA256_W`, the SHA-512 `K`/`W` arrays, `SHA1_W`, `MD5_W`) and scrypt's
  salsa20/BlockMix functions are gone, and `roundClean()` of these classes
  has nothing left to wipe. None of them was exported: the exports of every
  module and the prototypes of the classes are noble's (`test/diff.mjs`
  "surface").
* `pbkdf2Async` / `scryptAsync` yield to the event loop every `asyncTick` ms
  as noble's do, but slice the work in between differently, so the number
  of event-loop turns differs; the `onProgress` values and their order are
  noble's (`test/diff.mjs`, the progress checks).
* Each hash family, once used, keeps its wasm instance (64 KiB of memory,
  wiped after every call) for the lifetime of the module.
* The source maps and `src/*.ts` are not shipped (the `sourceMappingURL`
  comments are removed).

## Development

    node build.mjs            # templates (wasm/kernels.mjs) + scrypt (wasm/scrypt.wat, binaryen) -> the end of esm/_fast.ts, esm/_fast.js, _fast.js; checks every module
    node tools/vendor.mjs     # re-create noble's files (+ patches) from node_modules/@noble/hashes
    npm test                  # files + bundles + quick differential test (ESM and CommonJS)
    npm run test:full         # full differential tests, a second seed, no-WebAssembly behaviour, browsers
    npm run mutate            # the tests must catch deliberate bugs in _fast.ts, _md.js and the wasm
    node tools/rawbench.mjs   # the wasm modules alone (wasm/target/, written by build.mjs) vs noble

`test/diff.mjs` compares against @noble/hashes 1.8.0 from node_modules and
node:crypto: the exports and prototypes, digests and every instance field
after every call (streaming with random chunks and strings, clones,
`_cloneInto`, `digestInto` into subarrays), errors, the hasher objects,
HMAC, HKDF, PBKDF2 and scrypt (sync and async, progress callbacks, bad
options), subclasses, tampered instances, direct `process()` calls, string
and byte lengths around the wasm input buffer, and that no bytes are left
in wasm memory. `test/nowasm.mjs` pins the behaviour without WebAssembly.
`test/browser.mjs` runs a differential check in Chromium, Firefox and
WebKit, on the main thread and in a module worker. `test/bundle.mjs`
bundles imports with esbuild (minified or not) and Rollup and checks that
each bundle runs the wasm and carries exactly the wasm of the families it
uses.
