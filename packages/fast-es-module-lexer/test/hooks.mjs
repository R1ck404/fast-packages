// The package's modules with their test hooks exported. index.mjs and
// browser.mjs export what es-module-lexer exports and nothing else; their
// hooks (__mode, __stats, the embedded modules) are internal. This loads a
// module's code with one export line added, as a data: URL module: a
// separate instance per call (fresh state, fresh wasm instance).
//   __mode(m): force how sources are copied ("node" | "node-re" | "v8" | "v8-into" | "encode")
//   __stats(): { mode, outside } (outside: reads the lexer made outside a source so far)
//   decode(text), WASM(), COPY8(): the embedded modules
import { readFileSync } from "node:fs";

let n = 0;
export const EXPORTS = "export { __mode, __stats, decode, WASM, COPY8 };";
/** file: "index.mjs" (default) or "browser.mjs" */
export async function withHooks(file = "index.mjs") {
  const code = readFileSync(new URL("../" + file, import.meta.url), "utf8") + `\n${EXPORTS}\n// ${n++}\n`;
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}
