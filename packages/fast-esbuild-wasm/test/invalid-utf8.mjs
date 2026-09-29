// Invalid UTF-8 input vs native esbuild 0.28.2. Go keeps the bytes of text
// it reads: comments, regular expressions and template literals are printed
// with them, string values get U+FFFD, messages show them in their lines of
// source text. The engine carries such bytes as lone surrogates
// (helpers.decodeGoString). This test injects invalid byte sequences into
// JavaScript and CSS snippets at random places and compares:
//   - transforms of Uint8Array input (the fast path's response, as the glue
//     decodes it), with several option sets (minify, charset, source maps,
//     legal comments, JSX, TypeScript, CSS);
//   - builds that read such files from the real file system (node.mjs), whose
//     output files are compared byte for byte, with metafiles and messages.
//
// usage: node test/invalid-utf8.mjs [--n 400] [--seed 1] [--show 5]
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flagsFor, makeRefTransform, ESBUILD_CRASHED, messagesJSON } from "./flags.mjs";
const require = createRequire(import.meta.url);
const refTransform = makeRefTransform(require);
const { fastTransform, stats } = await (await import("./engine.mjs")).loadEngine();

const args = process.argv.slice(2);
const getArg = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const N = Number(getArg("--n", 400));
let seed = Number(getArg("--seed", 1)) >>> 0 || 1;
const showN = Number(getArg("--show", 5));

function rnd(n) {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed % n;
}
const pick = (a) => a[rnd(a.length)];

// Invalid (and some valid) byte sequences
const INJECT = [
  [0x80], [0xbf], [0xff], [0xfe], [0xc0], [0xc1], [0xc3], [0xe2], [0xe2, 0x82], [0xf0, 0x9f], [0xf0, 0x9f, 0x98],
  [0xed, 0xa0, 0x80], [0xed, 0xbf, 0xbf], [0xc0, 0x80], [0xe0, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf8, 0x88, 0x80, 0x80, 0x80],
  [0xe9], [0xa9, 0x20], [0xc3, 0xa9], [0xef, 0xbb, 0xbf], [0x80, 0x80, 0x80], [0xe2, 0x80, 0xa8], [0xc2],
];

const JS = [
  "/*! (c) license */\nexport const a = 1;\n",
  "// comment\nlet x = 'str';\nconsole.log(x);\n",
  "let s = \"a string\"; let t = `tmpl ${s} end`; let r = /re[gex]/g;\n",
  "let t = String.raw`raw text ${1}`; x(t);\n",
  "/* block */ function f(a, b) { return a + b } /** @license keep */ export default f;\n",
  "const obj = { 'key': 1, \"k2\": 'v' }; export { obj };\n",
  "if (a) { b() } else { c() } // trailing\n",
  "export let jsx = <div title=\"attr\">text {x} more</div>;\n",
  "label: for (;;) { break label } /*#__PURE__*/ f();\n",
  "#!/usr/bin/env node\nconsole.log('x')\n",
  "let n = 1_000; let big = 123n; let u = '\\u00e9';\n",
];
const CSS = [
  "/*! license */\na { color: red; }\n",
  "a::after { content: \"text\"; }\n.b { background: url(img.png) }\n",
  "@font-face { font-family: 'Name'; src: url(\"f.woff\") }\n",
  ".cls-name > #id-name { margin: 0 }\n/* comment */\n",
  "@media screen { .x { font: 12px/1.5 Arial } }\n",
  ":root { --custom: value; }\n",
];

function inject(text) {
  const bytes = [...Buffer.from(text, "utf8")];
  const count = 1 + rnd(3);
  for (let k = 0; k < count; k++) {
    // (never near the end: Go's helpers.QuoteForJSON never finishes for
    // text whose last 3 bytes hold the lead byte of a truncated UTF-8
    // sequence, which esbuild does for source map contents)
    const at = rnd(Math.max(1, bytes.length - 5));
    bytes.splice(at, 0, ...pick(INJECT));
  }
  return new Uint8Array(bytes);
}

const JS_OPTIONS = [
  {},
  { minify: true },
  { charset: "utf8" },
  { minify: true, charset: "utf8" },
  { sourcemap: "external", sourcefile: "in.js" },
  { sourcemap: "inline", sourcefile: "in.js", charset: "utf8" },
  { legalComments: "eof" },
  { legalComments: "external" },
  { loader: "jsx" },
  { loader: "tsx", jsx: "preserve" },
  { loader: "ts" },
  { format: "cjs" },
  { loader: "text" },
  { loader: "json" },
];
const CSS_OPTIONS = [
  { loader: "css" },
  { loader: "css", minify: true },
  { loader: "css", charset: "utf8" },
  { loader: "css", sourcemap: "external", sourcefile: "in.css" },
  { loader: "css", legalComments: "eof" },
  { loader: "local-css" },
];

let ok = 0;
let bad = 0;
let crashed = 0;
let shown = 0;
const shape = (r) => ({ code: r.code, map: r.map, legalComments: r.legalComments, warnings: messagesJSON(r.warnings) });

for (let n = 0; n < N; n++) {
  const isCSS = rnd(3) === 0;
  const bytes = inject(pick(isCSS ? CSS : JS));
  const opts = pick(isCSS ? CSS_OPTIONS : JS_OPTIONS);
  let a;
  let ref;
  try {
    ref = refTransform(bytes, { ...opts, logLevel: "silent" });
  } catch (e) {
    ref = { errors: e.errors || [] };
  }
  if (ref === ESBUILD_CRASHED) {
    crashed++;
    continue;
  }
  a = ref.errors ? { errors: messagesJSON(ref.errors) } : shape(ref);
  let b;
  const before = stats.error;
  const r = fastTransform(flagsFor({ ...opts, logLevel: "silent" }), bytes, undefined);
  if (r === undefined || stats.error !== before) b = { threw: String(stats.lastError && stats.lastError.stack) };
  else if (r.error) b = { error: r.error };
  else if (r.errors.length > 0) b = { errors: messagesJSON(r.errors) };
  else b = shape({ ...r, legalComments: r.legalComments });
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja === jb) ok++;
  else {
    bad++;
    if (shown++ < showN) {
      console.log("DIFF " + JSON.stringify(opts) + " input " + JSON.stringify(Buffer.from(bytes).toString("latin1")));
      let i = 0;
      while (i < ja.length && ja[i] === jb[i]) i++;
      console.log("  esbuild: " + ja.slice(Math.max(0, i - 150), i + 250));
      console.log("  fast:    " + jb.slice(Math.max(0, i - 150), i + 250));
    }
  }
}

// Errors: the messages (with the line of source text) of invalid input
function errorsOf(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return messagesJSON(e.errors || []);
  }
}
for (let n = 0; n < Math.floor(N / 4); n++) {
  const text = pick(["let \xff = 1;\n", "let x = 1 \x80 2;\n", "a { color: \x80red }\n", "let s = 'unterminated \xe9\n", "x = 1 +;\n// \xc3\n"]);
  const bytes = inject(text);
  const opts = text.startsWith("a {") ? { loader: "css" } : {};
  const ra = errorsOf(() => refTransform(bytes, { ...opts, logLevel: "silent" }));
  const r = fastTransform(flagsFor({ ...opts, logLevel: "silent" }), bytes, undefined);
  const rb = r === undefined ? "threw" : r.errors.length > 0 ? messagesJSON(r.errors) : null;
  if (JSON.stringify(ra) === JSON.stringify(rb)) ok++;
  else {
    bad++;
    if (shown++ < showN) console.log("ERROR DIFF " + JSON.stringify(Buffer.from(bytes).toString("latin1")) + "\n  esbuild: " + JSON.stringify(ra) + "\n  fast:    " + JSON.stringify(rb));
  }
}

// Builds of files with invalid UTF-8 (the real file system)
const fast = (await import("../node.mjs")).default;
await fast.initialize({});
const esbuild = require("esbuild");
const dir = mkdtempSync(join(tmpdir(), "fast-esbuild-utf8-"));
try {
  for (let n = 0; n < Math.floor(N / 8); n++) {
    const a = inject(pick(JS));
    const b = inject(pick(JS));
    const c = inject(pick(CSS));
    writeFileSync(join(dir, "a.js"), Buffer.concat([Buffer.from("import './b.js';\nimport './c.css';\n"), a]));
    writeFileSync(join(dir, "b.js"), b);
    writeFileSync(join(dir, "c.css"), c);
    for (const opts of [{}, { minify: true }, { sourcemap: true }, { charset: "utf8", legalComments: "eof" }, { metafile: true, loader: { ".js": "jsx" } }]) {
      const options = { entryPoints: [join(dir, "a.js")], bundle: true, write: false, outdir: join(dir, "out"), absWorkingDir: dir, logLevel: "silent", ...opts };
      const run = async (e) => {
        try {
          // (a crash of the service must fail the test, not hang it)
          let timer;
          const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("build timed out")), 30000)));
          const r = await Promise.race([e.build(options), timeout]).finally(() => clearTimeout(timer));
          return { files: r.outputFiles.map((f) => [f.path, Buffer.from(f.contents).toString("latin1")]), metafile: r.metafile, warnings: messagesJSON(r.warnings) };
        } catch (err) {
          return err.errors ? { errors: messagesJSON(err.errors) } : { threw: String(err && err.message) };
        }
      };
      const ja = JSON.stringify(await run(esbuild));
      const jb = JSON.stringify(await run(fast));
      if (ja === jb) ok++;
      else {
        bad++;
        if (shown++ < showN) {
          let i = 0;
          while (i < ja.length && ja[i] === jb[i]) i++;
          console.log("BUILD DIFF " + JSON.stringify(opts) + "\n  esbuild: " + ja.slice(Math.max(0, i - 150), i + 250) + "\n  fast:    " + jb.slice(Math.max(0, i - 150), i + 250));
        }
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  fast.stop();
  esbuild.stop();
}

console.log(`invalid-utf8: ${ok} same, ${bad} different, ${crashed} esbuild crashed`);
process.exit(bad > 0 ? 1 : 0);
