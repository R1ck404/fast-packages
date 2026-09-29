// CSS inputs for the CSS tests: the CSS source strings of esbuild's own
// parser, printer, lexer and bundler tests (internal/css_*/..._test.go and
// internal/bundler_tests/bundler_css_test.go of an esbuild checkout), which
// exercise every corner of the CSS pipeline. Returns [name, text] pairs.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { VITE_TARGETS, VITE5_TARGETS } from "./flags.mjs";

const BS = 92; // backslash

// Parses a Go string literal at s[i] ("..." or `...`); returns [value, end]
// or null
function parseGoString(s, i) {
  const q = s.charCodeAt(i);
  if (q === 96) {
    const end = s.indexOf("`", i + 1);
    if (end < 0) return null;
    return [s.slice(i + 1, end).split(String.fromCharCode(13)).join(""), end + 1];
  }
  if (q !== 34) return null;
  let out = "";
  let j = i + 1;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (c === 34) return [out, j + 1];
    if (c === 10) return null;
    if (c !== BS) {
      out += s[j++];
      continue;
    }
    const e = s[j + 1];
    j += 2;
    switch (e) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += String.fromCharCode(13);
        break;
      case "a":
        out += String.fromCharCode(7);
        break;
      case "b":
        out += String.fromCharCode(8);
        break;
      case "f":
        out += String.fromCharCode(12);
        break;
      case "v":
        out += String.fromCharCode(11);
        break;
      case '"':
      case "'":
        out += e;
        break;
      case "x": {
        // A byte: collect a run of \x escapes and decode them as UTF-8
        const bytes = [parseInt(s.slice(j, j + 2), 16)];
        j += 2;
        while (s.charCodeAt(j) === BS && s[j + 1] === "x") {
          bytes.push(parseInt(s.slice(j + 2, j + 4), 16));
          j += 4;
        }
        out += Buffer.from(bytes).toString("utf8");
        break;
      }
      case "u":
        out += String.fromCodePoint(parseInt(s.slice(j, j + 4), 16));
        j += 4;
        break;
      case "U":
        out += String.fromCodePoint(parseInt(s.slice(j, j + 8), 16));
        j += 8;
        break;
      default:
        if (e >= "0" && e <= "7") {
          out += String.fromCharCode(parseInt(s.slice(j - 1, j + 2), 8));
          j += 2;
        } else if (e === String.fromCharCode(BS)) {
          out += e;
        } else {
          return null;
        }
    }
  }
  return null;
}

// A Go string expression: literals joined with "+" (anything else: null)
export function parseGoStringExpr(s, i) {
  let value = "";
  for (;;) {
    while (/\s/.test(s[i])) i++;
    const r = parseGoString(s, i);
    if (r === null) return null;
    value += r[0];
    i = r[1];
    let k = i;
    while (/\s/.test(s[k])) k++;
    if (s[k] !== "+") return [value, i];
    i = k + 1;
  }
}

export function extractGoTestInputs(esbuildSrc) {
  const out = [];
  const files = [
    "internal/css_parser/css_parser_test.go",
    "internal/css_printer/css_printer_test.go",
    "internal/css_lexer/css_lexer_test.go",
    "internal/bundler_tests/bundler_css_test.go",
  ];
  for (const rel of files) {
    const path = join(esbuildSrc, rel);
    if (!existsSync(path)) continue;
    const go = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    // expect...(t, [non-string argument,] "input", ...)
    const re = /\bexpect\w*\(t, /g;
    let m;
    let n = 0;
    while ((m = re.exec(go)) !== null) {
      let i = m.index + m[0].length;
      if (go[i] !== '"' && go[i] !== "`") {
        // (expectPrintedLowerUnsupported's feature set, test names, ...)
        const comma = go.indexOf(", ", i);
        if (comma < 0) continue;
        i = comma + 2;
      }
      const r = parseGoStringExpr(go, i);
      if (r !== null) out.push([`${rel}#${++n}`, r[0]]);
    }
    // bundler tests: "/name.css": `...` file contents
    const re2 = /"([^"\n]+\.css)":\s+/g;
    while ((m = re2.exec(go)) !== null) {
      const r = parseGoStringExpr(go, m.index + m[0].length);
      if (r !== null) out.push([`${rel}#${m[1]}`, r[0]]);
    }
  }
  return out;
}

// What Vite sends to minify CSS (vite:css-post minifyCSS with the default
// build.cssMinify = esbuild): loader css, target = build.cssTarget (default:
// build.target), minify (or the three minify flags when the esbuild config
// sets one), charset (Vite 5: "utf8" by default), legalComments from the
// esbuild config
const vite7css = { loader: "css", target: VITE_TARGETS, minify: true };
const vite5css = { loader: "css", target: VITE5_TARGETS, charset: "utf8", minify: true };

// The option sets of the CSS tests
export const CSS_OPTION_SETS = [
  ["css", { loader: "css" }],
  ["css-min", { loader: "css", minify: true }],
  ["css-min-ws", { loader: "css", minifyWhitespace: true }],
  ["css-min-syntax", { loader: "css", minifySyntax: true }],
  ["css-min-ids", { loader: "css", minifyIdentifiers: true }],
  ["css-utf8", { loader: "css", charset: "utf8" }],
  ["css-min-utf8-limit", { loader: "css", minify: true, charset: "utf8", lineLimit: 80 }],
  ["css-limit", { loader: "css", lineLimit: 40 }],
  ["global-css", { loader: "global-css" }],
  ["local-css", { loader: "local-css", sourcefile: "/src/app.module.css" }],
  ["local-css-min", { loader: "local-css", minify: true }],
  ["local-css-min-ids", { loader: "local-css", minifyIdentifiers: true }],
  // targets (CSS lowering: nesting, colors, media ranges, prefixes, ...)
  ["chrome58", { loader: "css", target: "chrome58" }],
  ["safari12-min", { loader: "css", target: "safari12", minify: true }],
  ["firefox60", { loader: "css", target: ["firefox60", "edge18"] }],
  ["ie11-min", { loader: "css", target: "ie11", minifySyntax: true }],
  ["es2020", { loader: "css", target: "es2020" }],
  ["chrome120-min", { loader: "css", target: ["chrome120", "safari17"], minify: true }],
  // "supported" overrides
  ["supported", { loader: "css", supported: { nesting: false, "hex-rgba": false, "inset-property": false, "is-pseudo-class": false, "rebecca-purple": false } }],
  ["supported-min", { loader: "css", minify: true, target: "chrome100", supported: { "color-functions": true, "modern-rgb-hsl": false, "media-range": false, "gradient-double-position": false } }],
  // source maps, legal comments, banner/footer, platform
  ["css-map", { loader: "css", sourcemap: true, sourcefile: "styles/app.css" }],
  ["css-map-inline-min", { loader: "css", sourcemap: "inline", minify: true }],
  ["css-map-both", { loader: "css", sourcemap: "both", sourcesContent: false, sourceRoot: "/src/", sourcefile: "x.css", charset: "utf8" }],
  ["css-legal-eof", { loader: "css", minify: true, legalComments: "eof" }],
  ["css-legal-none", { loader: "css", legalComments: "none" }],
  ["css-banner", { loader: "css", banner: "/* banner */", footer: "/* footer */", platform: "node" }],
  ["css-misc-options", { loader: "css", format: "esm", platform: "neutral", define: { "process.env": "{}", X: "1" }, pure: ["foo"], drop: ["console"], jsx: "automatic", keepNames: true, treeShaking: true, mangleProps: /_$/, tsconfigRaw: { compilerOptions: { jsx: "preserve" } } }],
  ["css-iife-mangle-cache", { loader: "css", format: "iife", globalName: "x", minify: true, mangleCache: { a_: "b", c_: false } }],
  // what Vite sends
  ["vite7-css", vite7css],
  ["vite5-css", vite5css],
  ["vite7-css-legal", { ...vite7css, legalComments: "eof" }],
  ["vite-css-min-flags", { loader: "css", target: VITE_TARGETS, minifyIdentifiers: true, minifySyntax: true, minifyWhitespace: false }],
];
