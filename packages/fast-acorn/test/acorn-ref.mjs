// Reference pieces of acorn 8.18 that it does not export, taken verbatim from
// node_modules/acorn/dist/acorn.mjs: getOptions (with pushComment), bound to
// a given defaultOptions object and SourceLocation class.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const src = readFileSync(join(dirname(require.resolve("acorn/package.json")), "dist/acorn.mjs"), "utf8");
function grab(name) {
  const re = new RegExp("\\nfunction " + name + "\\(");
  const m = re.exec(src);
  if (!m) throw new Error("not found: " + name);
  let depth = 0, i = src.indexOf("{", m.index);
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(m.index + 1, j + 1);
  }
  throw new Error("unterminated: " + name);
}

export function acornGetOptions(defaultOptions, SourceLocation) {
  const body =
    "var warnedAboutEcmaVersion = false;\n" +
    "var hasOwn = Object.hasOwn || (function (obj, propName) { return Object.prototype.hasOwnProperty.call(obj, propName) });\n" +
    "var isArray = Array.isArray;\n" +
    grab("getOptions") +
    "\n" +
    grab("pushComment") +
    "\nreturn getOptions;";
  return new Function("defaultOptions", "SourceLocation", body)(defaultOptions, SourceLocation);
}
