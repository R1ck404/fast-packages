// es-module-lexer benchmark. Usage: node bench/es-module-lexer.bench.mjs <impl>
//   impl: orig (es-module-lexer 1.7.0) | fast | prev (snapshot in .scratch/prev)
import { runSuite } from "./harness.mjs";
import { loadJs, listFiles, nm } from "./corpus.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const impl = process.argv[2] || "orig";
const L =
  impl === "fast" ? await import("../fast-es-module-lexer/index.mjs")
  : impl === "prev" ? await import("../.scratch/prev/fast-es-module-lexer/index.mjs")
  : await import("es-module-lexer");
L.initSync();

const nonAscii = (s) => /[^\x00-\x7f]/.test(s);
const cases = [];
cases.push({ name: "tiny module (70B)", fn: () => L.parse("import a from './a.js';\nexport const b = a + 1;\nexport default b;\n") });
for (const f of loadJs()) {
  cases.push({ name: `${f.name}${nonAscii(f.code) ? " [utf16]" : ""}`, bytes: f.code.length, fn: () => L.parse(f.code) });
}
// whole packages' worth of modules, as a module loader sees them
function batch(label, dir, exts, filter = () => true) {
  const srcs = listFiles(join(nm, dir), exts).map((f) => readFileSync(f, "utf8")).filter(filter);
  const bytes = srcs.reduce((a, s) => a + s.length, 0);
  const na = srcs.filter(nonAscii).length;
  cases.push({
    name: `batch: ${srcs.length} ${label} (${(bytes / 1024) | 0}KB${na ? `, ${na} non-ASCII` : ""})`,
    bytes,
    fn: () => { for (const s of srcs) L.parse(s); },
  });
}
batch("zod/v4 modules", "zod/v4", [".js"]);
batch("@vue files", "@vue", [".js", ".mjs"], (s) => s.length < 200000);
batch("lodash-es modules", "lodash-es", [".js"]);
batch("three/src modules", "three/src", [".js"]);
batch("zod files", "zod", [".js", ".cjs"]);
await runSuite(impl, cases);
