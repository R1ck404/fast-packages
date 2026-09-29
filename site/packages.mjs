// What the site knows about each package: how to bundle the original and the
// fast version behind the same adapter, and the words used on the landing page.

import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nm = (p) => path.join(root, "node_modules", p);
const pkg = (p) => path.join(root, "packages", p);

export const packages = [
  {
    slug: "pako",
    fast: "@r1ck404/fast-pako",
    original: "pako",
    version: "2.1.0",
    short: "gzip and deflate",
    line: "zlib ported to Rust and WebAssembly, producing the same bytes.",
    headline: "ungzip 5-6x, inflate 4x",
    resultsKey: "pako",
    variants: {
      orig: { alias: { impl: nm("pako/dist/pako.esm.mjs") } },
      fast: { alias: { impl: pkg("fast-pako/index.mjs") } },
    },
  },
  {
    slug: "acorn",
    fast: "@r1ck404/fast-acorn",
    original: "acorn",
    version: "8.18.0",
    short: "JavaScript parser",
    line: "A parser that mirrors acorn function by function, on faster machinery.",
    headline: "parse 2.5-3.2x",
    resultsKey: "acorn",
    variants: {
      orig: {
        alias: { impl: nm("acorn/dist/acorn.mjs"), acorn: nm("acorn/dist/acorn.mjs"), jsxplugin: nm("acorn-jsx/index.js") },
      },
      fast: {
        alias: { impl: pkg("fast-acorn/index.mjs"), acorn: pkg("fast-acorn/index.mjs"), jsxplugin: pkg("fast-acorn-jsx/index.js") },
      },
    },
  },
  {
    slug: "esbuild",
    fast: "@r1ck404/fast-esbuild-wasm",
    original: "esbuild-wasm",
    version: "0.28.2",
    short: "TypeScript, JSX and bundling",
    line: "All of esbuild ported to JavaScript. No Go binary and about a sixth of the download.",
    headline: "transform 3-5.5x, 14 MB down to 2 MB",
    resultsKey: "esbuild",
    variants: {
      orig: { alias: { impl: nm("esbuild-wasm/esm/browser.min.js") }, wasm: [nm("esbuild-wasm/esbuild.wasm")] },
      fast: { alias: { impl: pkg("fast-esbuild-wasm/esm/browser.min.js") }, minify: true },
      // the original is used as published (esm/browser.min.js); the fast one is
      // minified like an app bundle would, which is how its 2.17 MB is measured
      minify: false,
    },
  },
  {
    slug: "es-module-lexer",
    fast: "@r1ck404/fast-es-module-lexer",
    original: "es-module-lexer",
    version: "1.7.0",
    short: "import and export scanner",
    line: "A SIMD WebAssembly port of the lexer that finds every import and export.",
    headline: "3-18x in Node, 2-7x in Chromium",
    resultsKey: "lexer",
    variants: {
      orig: { alias: { impl: nm("es-module-lexer/dist/lexer.js") } },
      fast: { alias: { impl: pkg("fast-es-module-lexer/browser.mjs") } },
    },
  },
  {
    slug: "brotli",
    fast: "@r1ck404/fast-brotli-wasm",
    original: "brotli-wasm",
    version: "3.0.1",
    short: "Brotli compression",
    line: "The same Rust encoder with its hot paths rewritten, and a new decoder.",
    headline: "compress q11 3-13x",
    resultsKey: "brotli",
    variants: {
      orig: { alias: { impl: nm("brotli-wasm/index.web.js") }, wasm: [nm("brotli-wasm/pkg.web/brotli_wasm_bg.wasm")] },
      fast: { alias: { impl: pkg("fast-brotli-wasm/index.mjs") }, wasm: [pkg("fast-brotli-wasm/fastbrotli.wasm")] },
    },
  },
  {
    slug: "noble-hashes",
    fast: "@r1ck404/fast-noble-hashes",
    original: "@noble/hashes",
    version: "1.8.0",
    short: "SHA-2, MD5, PBKDF2, scrypt",
    line: "Noble's own modules, with the hot loops running in WebAssembly.",
    headline: "sha512 5x, md5 7x, pbkdf2 3-7x",
    resultsKey: "noble",
    variants: {
      orig: { alias: { "@noble/hashes": nm("@noble/hashes/esm") } },
      fast: { alias: { "@noble/hashes": pkg("fast-noble-hashes/esm") } },
    },
  },
];

// sample files copied into the site: name -> source
export const samples = {
  "debounce.js": nm("lodash-es/debounce.js"),
  "three.tsl.js": nm("three/build/three.tsl.js"),
  "three.module.js": nm("three/build/three.module.js"),
  "react-dom-client.js": nm("react-dom/cjs/react-dom-client.development.js"),
  "schemas.ts": nm("zod/src/v4/classic/schemas.ts"),
};

export { root };
