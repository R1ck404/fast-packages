// brotli-wasm benchmark. Usage: node bench/brotli.bench.mjs <impl>
//   impl: orig (brotli-wasm 3.0.1) | fast (@r1ck404/fast-brotli-wasm) | prev (snapshot in .scratch/prev)
import { createRequire } from "node:module";
import { runSuite } from "./harness.mjs";
import { read, jsonText, utf8 } from "./corpus.mjs";

const impl = process.argv[2] || "orig";
const require = createRequire(import.meta.url);
const B =
  impl === "fast"
    ? require("@r1ck404/fast-brotli-wasm")
    : impl === "prev"
      ? require("../.scratch/prev/fast-brotli-wasm/index.node.cjs")
      : impl === "orig"
        ? require("brotli-wasm")
        : null;
if (!B) throw new Error("unknown impl " + impl);

const files = [
  ["tiny module (70B)", utf8("import a from './a.js';\nexport const b = a + 1;\nexport default b;\n")],
  ["zod-errors.js (1.6KB)", new Uint8Array(read("zod/v4/classic/errors.js"))],
  ["json API response (8KB)", utf8(jsonText(8000))],
  ["zod-schemas.js (51KB)", new Uint8Array(read("zod/v4/classic/schemas.js"))],
  ["react-dom-client.prod (536KB)", new Uint8Array(read("react-dom/cjs/react-dom-client.production.js"))],
];
const big = ["react-dom-client.dev (1MB)", new Uint8Array(read("react-dom/cjs/react-dom-client.development.js"))];

const cases = [];
// compress() without options = quality 11, which is what Nodepod's zlib polyfill uses
for (const [name, data] of files) {
  cases.push({ name: `compress q11 ${name}`, bytes: data.length, fn: () => B.compress(data), opts: { minSamples: 3, maxTimeMs: 4000 } });
}
for (const q of [1, 5, 9]) {
  for (const [name, data] of [files[3], files[4], big]) {
    cases.push({ name: `compress q${q} ${name}`, bytes: data.length, fn: () => B.compress(data, { quality: q }) });
  }
}
for (const [name, data] of [...files, big]) {
  for (const q of [11, 5]) {
    const packed = B.compress(data, { quality: q });
    cases.push({ name: `decompress (q${q}) ${name}`, bytes: data.length, fn: () => B.decompress(packed) });
  }
}
// streaming API: 64KB chunks in, 64KB buffers out
{
  const data = big[1];
  cases.push({
    name: `CompressStream q5 ${big[0]}`,
    bytes: data.length,
    fn: () => {
      const s = new B.CompressStream(5);
      for (let off = 0; off < data.length; ) {
        const r = s.compress(data.subarray(off, off + 65536), 65536);
        off += r.input_offset;
        r.free();
      }
      for (;;) {
        const r = s.compress(undefined, 65536);
        const done = r.code === B.BrotliStreamResultCode.ResultSuccess;
        r.free();
        if (done) break;
      }
      s.free();
    },
  });
  const packed = B.compress(data, { quality: 5 });
  cases.push({
    name: `DecompressStream (q5) ${big[0]}`,
    bytes: data.length,
    fn: () => {
      const s = new B.DecompressStream();
      let off = 0;
      for (;;) {
        const r = s.decompress(packed.subarray(off, off + 65536), 65536);
        off += r.input_offset;
        const code = r.code;
        r.free();
        if (code === B.BrotliStreamResultCode.ResultSuccess) break;
      }
      s.free();
    },
  });
}
await runSuite(impl, cases);
