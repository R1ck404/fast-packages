// Transforms whose input has a "sourceMappingURL" comment (input source maps:
// esbuild's source map parser and the remapping through the nested map) vs
// native esbuild 0.28.2: data URLs (base64 and percent-encoded) with maps
// esbuild made itself (JS, TS, CSS, with and without sourcesContent, names,
// several sources), malformed maps (invalid JSON, bad mappings, bad VLQ,
// wrong version, sections), unsupported comments (https, relative, file://,
// hosts, bad URLs), each with and without sourcesContent, ASCII-only output,
// minification, and at every log level (debug messages too).
// usage: node test/input-sourcemaps.mjs
import { createRequire } from "node:module";
import { fastTransform, stats } from "../src/transform.mjs";
import { classifyTransform, flagsFor } from "./flags.mjs";
import { setStderr } from "../src/logger.mjs";
setStderr((text) => process.stderr.write(text));
const esbuild = createRequire(import.meta.url)("esbuild");
globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__ = true;

const b64 = (s) => Buffer.from(s).toString("base64");
const dataURL = (json, enc = "base64") =>
  enc === "base64" ? "data:application/json;base64," + b64(json) : enc === "charset" ? "data:application/json;charset=utf-8;base64," + b64(json) : "data:application/json," + encodeURIComponent(json);

// Inputs esbuild produced with inline maps
const sources = [
  ["a.ts", "ts", "interface A { x: number }\nexport const f = (a: A): number => a.x * 2;\nlet été = 'café 😀';\nconsole.log(f({ x: 1 }), été)\n"],
  ["b.jsx", "jsx", "export function App({ name }) {\n  return <div className=\"x\">Hello {name}</div>;\n}\n"],
  ["c.js", "js", "class Foo {\n  #x = 1;\n  get x() { return this.#x }\n}\nasync function* g() { for await (const x of y) yield x }\nexport { Foo, g }\n"],
];
const generated = [];
for (const [file, loader, code] of sources) {
  for (const extra of [{}, { minify: true }, { sourcesContent: false }, { target: "es2015" }]) {
    const r = esbuild.transformSync(code, { loader, sourcefile: file, sourcemap: "external", ...extra });
    generated.push([file + JSON.stringify(extra), r.code, r.map]);
  }
}
const cssSources = [".a { color: red }\n.b { .c & { margin: 0 1px 0 1px } }\n@media (min-width: 10px) { .d { color: #ff0000 } }\n"];
const cssGenerated = [];
for (const code of cssSources) {
  for (const extra of [{}, { minify: true }, { sourcesContent: false }]) {
    const r = esbuild.transformSync(code, { loader: "css", sourcefile: "s.css", sourcemap: "external", ...extra });
    cssGenerated.push([JSON.stringify(extra), r.code, r.map]);
  }
}

const malformed = [
  "{", "[]", "null", "{}", '{"version":2,"sources":[],"mappings":""}', '{"version":3}', '{"version":3,"sources":["a.js"],"mappings":"AAAA"}',
  '{"version":3,"sources":["a.js"],"mappings":"!!!"}', '{"version":3,"sources":["a.js"],"mappings":"AAAAA"}', '{"version":3,"sources":["a.js"],"mappings":"AA"}',
  '{"version":3,"sources":["a.js"],"mappings":"AAAA,;;CACA"}', '{"version":3,"sources":["a.js"],"names":["x"],"mappings":"AAAAA,CAACC"}',
  '{"version":3,"sources":["a.js","b.js"],"sourcesContent":["x",null],"mappings":"AAAA;ACAA"}', '{"version":3,"sections":[]}',
  '{"version":3,"sources":[null],"mappings":"AAAA"}', '{"version":3,"sources":["file:///x/a.js"],"mappings":"AAAA"}',
  '{"version":3,"sources":["a.js"],"sourceRoot":"http://x/","mappings":"AAAA"}', '{"version":3,"sources":["a.js"],"mappings":"gggggggA"}',
  '{"version":3,"sources":["a.js"],"mappings":"AAAA;;;;;;;;;;;;;;;;;;;;;;;;;;;;;AAAA"}', '{"version":3,"sources":["aé.js"],"sourcesContent":["é😀"],"mappings":"AAAA"}',
  '{"version":3,"sources":["a.js"],"mappings":"AAAA","x_google_ignoreList":[0]}', '{"version":3,"sources":["a.js"],"mappings":"AAAA","ignoreList":[0]}',
  '{"version":3,"sources":["a.js"],"mappings":"A"}', '{"version":3,"sources":["a.js"],"mappings":",,,"}', '{"version": 3, "sources": ["a.js"], "mappings": "AAAA" ,}',
];
const comments = [
  "https://example.com/x.js.map", "x.js.map", "./x.js.map", "/abs/x.js.map", "file:///abs/x.js.map", "file://host/x.js.map", "file://localhost/x.js.map",
  "http://[::1", "%zz", "data:application/json;base64,!!!", "data:text/plain,{}", "data:application/json,%7B", "data:", "data:;base64,e30=",
  "a b.map", "//x", "javascript:alert(1)",
  // authorities: users, IP literals, ports, zones, colons
  "http://user:pass@host/x.map", "http://us%20er@host/x.map", "http://u@s@host/x", "http://u<s@host/x", "http://%zz@host/", "file://user@/x.map", "file://u:p@localhost/x.map",
  "http://[::1]/x.map", "http://[::1]:80/x.map", "http://[::1]:8x/x", "http://[fe80::1%25en0]/x", "http://[fe80::1%25]/x", "http://[fe80::1%25%41]/x", "http://[fe80::1%25%00]/x",
  "http://[1.2.3.4]/x", "http://[::ffff:1.2.3.4]/x", "http://[::1.2.3]/x", "http://[1:2:3:4:5:6:7:8:9]/x", "http://[12345::]/x", "http://[::1::2]/x", "http://[:1]/x",
  "http://[1::]/x", "http://[::]/x", "http://[g::]/x", "http://[1:2:3:4:5:6:7::]/x", "http://[1:2:3:4:5:6:1.2.3.4]/x", "http://[1:2:3:4:5:1.2.3.4]/x",
  "http://[::01.2.3.4]/x", "http://[::256.2.3.4]/x", "http://[%]/x", "http://[a]/x", "http://x[::1]/y", "http://[::1/x", "http://a:b:c/x", "http://a:1:2/x",
  "foo://a:b:c/x", "http://a%41/x", "http://a%C3%A9/x", "http://a%zz/x", "http://h:/x", "http://h:99999/x", "file://[::1]/x.map", "file:///a%20b/x.map?q#f",
];

const cases = [];
for (const [name, code, map] of generated) {
  for (const enc of ["base64", "percent", "charset"]) cases.push([name + " " + enc, "js", code.replace(/\n$/, "") + "\n//# sourceMappingURL=" + dataURL(map, enc) + "\n"]);
  cases.push([name + " @", "js", code + "//@ sourceMappingURL=" + dataURL(map) + "\n"]);
  cases.push([name + " block", "js", code + "/*# sourceMappingURL=" + dataURL(map) + " */\n"]);
}
for (const [name, code, map] of cssGenerated) cases.push(["css " + name, "css", code + "/*# sourceMappingURL=" + dataURL(map) + " */\n"]);
for (const m of malformed) {
  cases.push(["bad " + m, "js", "let x = 1;\nconsole.log(x)\n//# sourceMappingURL=" + dataURL(m) + "\n"]);
  cases.push(["bad css " + m, "css", ".x { color: red }\n/*# sourceMappingURL=" + dataURL(m) + " */\n"]);
}
for (const c of comments) {
  cases.push(["comment " + c, "js", "let x = 1;\n//# sourceMappingURL=" + c + "\n"]);
  cases.push(["css comment " + c, "css", ".y{}\n/*# sourceMappingURL=" + c + " */\n"]);
}

const optionSets = [
  { sourcemap: "external", sourcefile: "out.js" },
  { sourcemap: "inline", sourcefile: "dir/out.js" },
  { sourcemap: "both", sourcefile: "out.js", sourcesContent: false },
  { sourcemap: "external", sourcefile: "out.js", charset: "ascii", minify: true },
  { sourcemap: "external", sourcefile: "file:///x/out.js", sourceRoot: "/r/" },
  { sourcemap: "external", sourcefile: "out.js", logLevel: "debug" },
  { sourcemap: "external", sourcefile: "out.js", logLevel: "warning", logOverride: { "unsupported-source-map-comment": "error" } },
  {},
];

const counts = {};
let bad = 0;
for (const [name, loader, input] of cases) {
  for (const base of optionSets) {
    const o = { ...base, loader };
    let ref = null;
    let refError = null;
    try {
      ref = esbuild.transformSync(input, o);
    } catch (e) {
      refError = e;
    }
    const errBefore = stats.error;
    const fast = fastTransform(flagsFor(o), input, undefined);
    let [cat, diff] = stats.error !== errBefore ? ["CRASH", String(stats.lastError && stats.lastError.stack)] : classifyTransform(ref, refError, fast);
    if (cat === "bail" || cat === "bothFail") diff = JSON.stringify(stats.lastBail);
    counts[cat] = (counts[cat] || 0) + 1;
    if (cat !== "ok" && cat !== "okError") {
      bad++;
      if (bad <= 20) {
        console.log(cat, name.slice(0, 80), JSON.stringify(base), diff || "");
        if (cat === "MISMATCH") console.log("  ref: ", JSON.stringify(ref.map).slice(0, 300), "\n  fast:", JSON.stringify(fast.map).slice(0, 300));
      }
    }
  }
}
console.log("input-sourcemaps:", cases.length * optionSets.length, "transforms", JSON.stringify(counts));
process.exit(bad === 0 ? 0 : 1);
