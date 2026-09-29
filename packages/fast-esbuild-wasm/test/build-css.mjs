// CSS in build(): CSS entry points, "@import" chains with media/supports/layer
// conditions and duplicates, "@layer" ordering, url() assets through every
// loader (file, dataurl, copy, empty, text, base64, binary, external), JS
// files importing CSS (the JS stub, a CSS chunk per JS entry point, local CSS
// modules with "composes" across files and "global" names, code splitting),
// source maps, the metafile, minification, lowering, legal comments, banners,
// output paths and hashes, and the errors CSS imports can cause. The real file
// system, @r1ck404/fast-esbuild-wasm (node.mjs) vs native esbuild 0.28.2, file
// by file; the engine must never fall back.
// usage: node test/build-css.mjs [--filter re] [--verbose]
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, relative, dirname, sep } from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const FILTER = new RegExp(args.includes("--filter") ? args[args.indexOf("--filter") + 1] : ".");
const VERBOSE = args.includes("--verbose");

globalThis.fs = require("node:fs");
const STATS = Symbol.for("@r1ck404/fast-esbuild-wasm:stats");
const fast = (await import("../node.mjs")).default;
await fast.initialize({});
const ref = require("esbuild");

const root = join(tmpdir(), "fast-esbuild-build-css-" + process.pid);
rmSync(root, { recursive: true, force: true });
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea70d3b6a0000000049454e44ae426082", "hex");
const files = {
  // CSS entry points and imports
  "css/entry.css": `@charset "UTF-8";
/*! entry license */
@import "./a.css";
@import url("./b.css") screen and (min-width: 100px);
@import "./c.css" supports(display: grid) layer(base);
@import "https://example.com/remote.css";
@import "./a.css" print;
@layer base, theme;
.entry { background: url(./img.png) no-repeat; color: red }
.font { src: url(./font.woff2?#iefix) format("woff2"), url("./font.woff2#x") }
.ext { background: url(https://example.com/x.png), url(//cdn/y.png), url(data:image/png;base64,AA==) }
.nest { .inner & { color: blue } &:hover { color: green } }
`,
  "css/a.css": `@import "./d.css";\n.a { color: #ff0000; margin: 0 1px 0 1px }\n/* not legal */\n`,
  "css/b.css": `@layer theme { .b { color: rgba(0, 0, 255, 0.5) } }\n.b2 { inset: 0 }\n`,
  "css/c.css": `@import "./d.css" layer(inner);\n.c { display: grid }\n`,
  "css/d.css": `/*! d license */\n.d { color: hsl(120deg 100% 50%) }\n`,
  "css/img.png": png,
  "css/font.woff2": "wOF2fakefontdata",
  "css/cycle1.css": `@import "./cycle2.css";\n.cycle1 { color: red }\n`,
  "css/cycle2.css": `@import "./cycle1.css";\n.cycle2 { color: blue }\n`,
  "css/layers.css": `@layer a;\n@import "./la.css" layer(x);\n@import "./la.css" layer(x);\n@import "./lb.css";\n@layer a { .z { color: red } }\n`,
  "css/la.css": `@layer y { .la { color: red } }\n`,
  "css/lb.css": `@layer b, c;\n.lb { color: blue }\n`,
  "css/assets.css": `.t { background: url(./asset.txt) } .j { background: url(./asset.json) } .e { background: url(./asset.empty) } .cp { background: url(./asset.copy) }\n`,
  "css/style-tag.css": `a::after { content: "</style>" } b { background: url("x</style") }
`,
  "js/style-tag.js": `import "../css/style-tag.css";
export const s = "</script>";
`,
  "css/asset.txt": "hello text",
  "css/asset.json": '{"a":1}',
  "css/asset.empty": "ignored",
  "css/asset.copy": "copied file",
  "css/map-input.css": `.m{color:red}\n/*# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify({ version: 3, sources: ["orig.scss"], sourcesContent: [".m { color: red }"], names: [], mappings: "AAAA,GAAG,OAAO" })).toString("base64")} */\n`,
  // JS importing CSS, CSS modules
  "js/entry.js": `import "./style.css";\nimport styles from "./card.module.css";\nimport { title } from "./title.module.css";\nexport function render() { return styles.card + " " + title + " " + styles.big }\nimport("./lazy.js").then((m) => m.x);\n`,
  "js/entry2.js": `import "./style.css";\nimport "./other.css";\nexport const y = 2;\n`,
  "js/lazy.js": `import "./lazy.css";\nexport const x = 1;\n`,
  "js/style.css": `@import "./base.css";\n.style { color: red }\n`,
  "js/base.css": `.base { margin: 0 }\n`,
  "js/other.css": `.other { padding: 0 }\n`,
  "js/lazy.css": `.lazy { color: blue }\n`,
  "js/card.module.css": `.card { composes: shared from "./shared.module.css"; composes: local2; color: red }\n.local2 { margin: 0 }\n.big { composes: card; font-size: 2em }\n:global(.g) { color: green }\n.card:hover { color: blue }\n@keyframes spin { to { rotate: 1turn } }\n.spin { animation: spin 1s }\n`,
  "js/shared.module.css": `.shared { padding: 1px; color: blue }\n`,
  "js/title.module.css": `.title { font-weight: bold }\n.title-2 { composes: title }\n`,
  "js/req.js": `require("./style.css");\nconst m = require("./card.module.css");\nmodule.exports = m;\n`,
  // errors
  "err/composes-js.module.css": `.a { composes: b from "./x.js" }\n`,
  "err/import-js.css": `@import "./x.js";\n`,
  "err/url-css.css": `.a { background: url(./y.css) }\n`,
  "err/url-js.css": `.a { background: url(./x.js) }\n`,
  "err/x.js": `export const b = 1;\n`,
  "err/y.css": `.y {}\n`,
  "err/global-composes.module.css": `.a { composes: g from "./g.css" }\n.b { composes: nope from "./g2.module.css" }\n`,
  "err/g.css": `.g { color: red }\n`,
  "err/g2.module.css": `.other {}\n`,
  "err/undefined-composes.module.css": `.a { composes: p1 from "./p1.module.css"; composes: p2 from "./p2.module.css" }\n`,
  "err/p1.module.css": `.p1 { color: red }\n`,
  "err/p2.module.css": `.p2 { color: blue }\n`,
  "err/missing.css": `@import "./does-not-exist.css";\n.a { background: url(./nope.png) }\n`,
  "err/stdout.js": `import "./y.css";\n`,
};
for (const [name, contents] of Object.entries(files)) {
  const p = join(root, ...name.split("/"));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, contents);
}

const loaders = { ".png": "file", ".woff2": "dataurl", ".txt": "text", ".json": "json", ".empty": "empty", ".copy": "copy" };
const scenarios = [
  ["css entry", { entryPoints: ["css/entry.css"], bundle: true, outdir: "out", loader: loaders }],
  ["css entry min", { entryPoints: ["css/entry.css"], bundle: true, outdir: "out", loader: loaders, minify: true }],
  ["css entry map", { entryPoints: ["css/entry.css"], bundle: true, outdir: "out", loader: loaders, sourcemap: true }],
  ["css entry map inline", { entryPoints: ["css/entry.css"], bundle: true, outfile: "out/x.css", loader: loaders, sourcemap: "inline", sourcesContent: false }],
  ["css entry meta hash", { entryPoints: ["css/entry.css"], bundle: true, outdir: "out", loader: loaders, metafile: true, entryNames: "[dir]/[name]-[hash]", assetNames: "assets/[name]-[hash]" }],
  ["css entry legal external", { entryPoints: ["css/entry.css"], bundle: true, outdir: "out", loader: loaders, legalComments: "external" }],
  ["css entry legal linked", { entryPoints: ["css/entry.css"], bundle: true, outdir: "out", loader: loaders, legalComments: "linked" }],
  ["css entry legal inline", { entryPoints: ["css/entry.css"], bundle: true, outdir: "out", loader: loaders, legalComments: "inline" }],
  ["css entry chrome58", { entryPoints: ["css/entry.css"], bundle: true, outdir: "out", loader: loaders, target: "chrome58" }],
  ["css entry banner utf8", { entryPoints: ["css/entry.css"], bundle: true, outdir: "out", loader: loaders, banner: { css: "/* banner */" }, footer: { css: "/* footer */" }, charset: "utf8" }],
  ["css entry platform node", { entryPoints: ["css/style-tag.css"], bundle: true, outdir: "out", platform: "node" }],
  ["css entry platform neutral min", { entryPoints: ["css/style-tag.css"], bundle: true, outdir: "out", platform: "neutral", minify: true }],
  ["css entry platform node inline-style", { entryPoints: ["css/style-tag.css"], bundle: true, outdir: "out", platform: "node", supported: { "inline-style": true } }],
  ["js css platform node", { entryPoints: ["js/style-tag.js"], bundle: true, outdir: "out", platform: "node" }],
  ["css entry public path", { entryPoints: ["css/entry.css"], bundle: true, outdir: "out", loader: loaders, publicPath: "https://cdn.example.com/" }],
  ["css no bundle", { entryPoints: ["css/entry.css", "css/a.css"], outdir: "out", loader: loaders }],
  ["css cycle", { entryPoints: ["css/cycle1.css"], bundle: true, outdir: "out" }],
  ["css layers", { entryPoints: ["css/layers.css"], bundle: true, outdir: "out" }],
  ["css layers min", { entryPoints: ["css/layers.css"], bundle: true, outdir: "out", minify: true }],
  ["css assets", { entryPoints: ["css/assets.css"], bundle: true, outdir: "out", loader: loaders, metafile: true }],
  ["css input map", { entryPoints: ["css/map-input.css"], bundle: true, outdir: "out", sourcemap: true }],
  ["css external", { entryPoints: ["css/entry.css"], bundle: true, outdir: "out", loader: loaders, external: ["*.png", "./a.css"] }],
  ["css two entries", { entryPoints: ["css/entry.css", "css/layers.css"], bundle: true, outdir: "out", loader: loaders, metafile: true }],
  ["js imports css", { entryPoints: ["js/entry.js"], bundle: true, outdir: "out", format: "esm" }],
  ["js imports css min", { entryPoints: ["js/entry.js"], bundle: true, outdir: "out", format: "esm", minify: true }],
  ["js imports css meta map", { entryPoints: ["js/entry.js"], bundle: true, outdir: "out", format: "esm", metafile: true, sourcemap: true }],
  ["js imports css splitting", { entryPoints: ["js/entry.js", "js/entry2.js"], bundle: true, outdir: "out", format: "esm", splitting: true, metafile: true }],
  ["js imports css splitting hash", { entryPoints: ["js/entry.js", "js/entry2.js"], bundle: true, outdir: "out", format: "esm", splitting: true, entryNames: "[name]-[hash]", chunkNames: "chunks/[name]-[hash]" }],
  ["js imports css two entries", { entryPoints: ["js/entry.js", "js/entry2.js"], bundle: true, outdir: "out", metafile: true }],
  ["js imports css outfile", { entryPoints: ["js/entry2.js"], bundle: true, outfile: "out/bundle.js" }],
  ["js imports css outfile ext", { entryPoints: ["js/entry2.js"], bundle: true, outfile: "out/bundle.mjs", outExtension: { ".css": ".min.css" } }],
  ["js require css", { entryPoints: ["js/req.js"], bundle: true, outdir: "out", format: "cjs" }],
  ["css modules global-css loader", { entryPoints: ["js/entry.js"], bundle: true, outdir: "out", format: "esm", loader: { ".css": "global-css" } }],
  ["css modules local-css loader", { entryPoints: ["js/entry2.js"], bundle: true, outdir: "out", format: "esm", loader: { ".css": "local-css" } }],
  ["css empty loader", { entryPoints: ["js/entry.js"], bundle: true, outdir: "out", format: "esm", loader: { ".css": "empty" } }],
  ["css text loader from js", { entryPoints: ["js/entry2.js"], bundle: true, outdir: "out", format: "esm", loader: { ".css": "text" } }],
  ["err composes js", { entryPoints: ["err/composes-js.module.css"], bundle: true, outdir: "out" }],
  ["err import js", { entryPoints: ["err/import-js.css"], bundle: true, outdir: "out" }],
  ["err url css", { entryPoints: ["err/url-css.css"], bundle: true, outdir: "out" }],
  ["err url js", { entryPoints: ["err/url-js.css"], bundle: true, outdir: "out" }],
  ["err global composes", { entryPoints: ["err/global-composes.module.css"], bundle: true, outdir: "out" }],
  ["warn undefined composes", { entryPoints: ["err/undefined-composes.module.css"], bundle: true, outdir: "out" }],
  ["err missing", { entryPoints: ["err/missing.css"], bundle: true, outdir: "out" }],
  ["err stdout", { entryPoints: ["err/stdout.js"], bundle: true }],
  ["stdin css", { stdin: { contents: '@import "./a.css";\n.s { color: red }', loader: "css", resolveDir: join(root, "css"), sourcefile: "stdin.css" }, bundle: true, outdir: "out" }],
  ["local-css min ids", { entryPoints: ["js/entry.js"], bundle: true, outdir: "out", format: "esm", minifyIdentifiers: true }],
];

const clean = (o) => ({ ...o, absWorkingDir: root, write: false, logLevel: "silent" });
const rel = (p) => relative(root, p).split(sep).join("/");
const describe = (r) => {
  if (r.error) return { error: r.error.message, errors: r.error.errors, warnings: r.error.warnings };
  return {
    files: r.outputFiles.map((f) => ({ path: rel(f.path), hash: f.hash, text: f.text })),
    errors: r.errors,
    warnings: r.warnings,
    metafile: r.metafile,
  };
};
let same = 0;
let different = 0;
for (const [name, options] of scenarios) {
  if (!FILTER.test(name)) continue;
  const run = async (esbuild) => {
    try {
      return await esbuild.build(clean(options));
    } catch (error) {
      return { error };
    }
  };
  const a = describe(await run(ref));
  const b = describe(await run(fast));
  const fell = false; // (there is no fallback)
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja === jb && !fell) {
    same++;
    if (VERBOSE) console.log("ok  ", name);
  } else {
    different++;
    console.log("DIFF", name);
    if (!fell) {
      for (let i = 0; i < Math.max(ja.length, jb.length); i++) {
        if (ja[i] !== jb[i]) {
          console.log("  native:", ja.slice(Math.max(0, i - 200), i + 300));
          console.log("  fast:  ", jb.slice(Math.max(0, i - 200), i + 300));
          break;
        }
      }
    }
  }
}
rmSync(root, { recursive: true, force: true });
console.log(`build-css: ${same} same, ${different} different`);
process.exit(different === 0 ? 0 : 1);
