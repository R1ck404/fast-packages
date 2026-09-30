// Builds @r1ck404/fast-acorn-jsx from acorn-jsx 5.3.2 (node_modules):
//
//   index.js    = acorn-jsx's index.js with registration and entity scanning:
//                 entity names use one slice instead of per-character concatenation.
//                 The plugin hands every
//                 class it creates to the Parser's registration hook, if the
//                 Parser has one (@r1ck404/fast-acorn's does; see its index.mjs), so
//                 @r1ck404/fast-acorn parses with its native JSX mode. On any other
//                 Parser (e.g. the real acorn) the API and results stay the same.
//   xhtml.js, index.d.ts, LICENSE = copied unchanged
//
// Registration is by identity, so it keeps working after bundling and
// minification (the genuine acorn-jsx is recognised by source text instead).
// usage: node packages/fast-acorn-jsx/build.mjs
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../package.json"));
const upstream = dirname(require.resolve("acorn-jsx/package.json"));
const { version } = JSON.parse(readFileSync(join(upstream, "package.json"), "utf8"));
if (version !== "5.3.2") throw new Error("expected acorn-jsx 5.3.2, found " + version);

function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error("pattern not found exactly once:\n" + from);
  return text.replace(from, () => to);
}

let src = readFileSync(join(upstream, "index.js"), "utf8");
src = replaceOnce(
  src,
  `module.exports = function(options) {
  options = options || {};
  return function(Parser) {
    return plugin({
      allowNamespaces: options.allowNamespaces !== false,
      allowNamespacedObjects: !!options.allowNamespacedObjects
    }, Parser);
  };
};`,
  // (kept short: the package stays smaller than acorn-jsx's)
  `module.exports = function(options) {
  options = options || {};
  return function(Parser) {
    // @r1ck404/fast-acorn-jsx: the class is registered with fast-acorn
    const o = {
      allowNamespaces: options.allowNamespaces !== false,
      allowNamespacedObjects: !!options.allowNamespacedObjects
    }, c = plugin(o, Parser), r = Parser[Symbol.for("@r1ck404/fast-acorn:registerJsxClass")];
    if (typeof r === "function") r(Parser, c, o);
    return c;
  };
};`,
);
// Build an entity name with one slice instead of a string concatenation per
// character. Keep the original path for non-string method stand-ins.
src = replaceOnce(src,
  "        if (ch === ';') {\n          if (str[0] === '#') {",
  "        if (ch === ';') {\n          if (typeof this.input === 'string') str = this.input.slice(startPos, this.pos - 1);\n          if (str[0] === '#') {");
src = replaceOnce(src, "        str += ch;", "        if (typeof this.input !== 'string') str += ch;");
writeFileSync(join(here, "index.js"), src);
for (const f of ["xhtml.js", "index.d.ts", "LICENSE"]) copyFileSync(join(upstream, f), join(here, f));
console.log("wrote index.js (+ xhtml.js, index.d.ts, LICENSE) from acorn-jsx " + version);
