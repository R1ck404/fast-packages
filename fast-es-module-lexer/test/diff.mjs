// Differential test: fast-es-module-lexer vs es-module-lexer 1.7.0 on every
// JS/TS file under node_modules, plus variants of each file:
//   - forced UTF-16 path (non-ASCII comment prepended)
//   - truncated prefixes (error paths)
//   - random single-char edits (fuzz)
// Every check runs fast-es-module-lexer once per way of getting the source
// into wasm memory (Node Buffer copy, V8 JS-string builtins: charCodeAt or
// intoCharCodeArray, encodeInto / JS copy as in other browsers).
// usage: node fast-es-module-lexer/test/diff.mjs [--quick] [--seed=N] [--variants=N] [--modes=node,v8,v8-into,encode]
import * as F from "../index.mjs";
import * as O from "es-module-lexer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, nm } from "../../bench/corpus.mjs";

F.initSync();
O.initSync();

const args = process.argv.slice(2);
const quick = args.includes("--quick");
const seedArg = args.find((a) => a.startsWith("--seed="));
const variantsArg = args.find((a) => a.startsWith("--variants="));
let seed = seedArg ? Number(seedArg.slice(7)) : 1;
const variants = variantsArg ? Number(variantsArg.slice(11)) : 4;
const modesArg = args.find((a) => a.startsWith("--modes="));
const modes = modesArg ? modesArg.slice(8).split(",") : ["node", "v8", "v8-into", "encode"];
for (const m of modes) F.__mode(m); // throws if a mode is unavailable
const perMode = Object.fromEntries(modes.map((m) => [m, 0]));
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

const ser = (x) => JSON.stringify(x, (k, v) => (v === undefined ? "\u0000undef" : v));
function run(P, src) {
  try {
    return ser(P.parse(src));
  } catch (e) {
    return "ERR " + e.constructor.name + " " + e.message + " idx=" + e.idx + " keys=" + Object.keys(e).join(",");
  }
}

const exts = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"];
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const dirArgs = args.filter((a) => a.startsWith("--dir=")).map((a) => a.slice(6));
const dirs = dirArgs.length ? dirArgs : [nm, join(here, "../../../Nodepod/node_modules/.pnpm")].filter((d) => existsSync(d));
let files = [];
for (const d of dirs) listFiles(d, exts, files);
files = [...new Set(files)];
if (quick) files = files.filter((_, i) => i % 10 === 0);
console.log("files:", files.length);

const EDITS = ["/", "'", '"', "`", "{", "}", "(", ")", "${", "*/", "/*", "//", "\n", "import", "export ", "import(", "import.meta", "\\", " ", "é", "\u00a0", "\u2028", "\ud800", "[", "]", ".", "...", "=>", "class ", "\r\n", "\0",
  // chars above 0xff whose low byte is a token char (U+0127 has 0x27 = ', ...)
  "\u0127", "\u0128", "\u0129", "\u012f", "\u0160", "\u017b", "\u017d", "\u015c", "\u0122", "\u0165", "\u0169", "\uff08", "\u2029", "\u00ff", "\u0080"];
const tricky = ["é", "\u00a0", "\u2028", "\ud83d\ude00", "\ud800", "\uffff", "ſ", "\u0127", "\u017b", "\u00ff"];

// history-dependent inputs (the original reads stale memory): see history.mjs
import { historyDependent } from "./history.mjs";

let total = 0, mismatches = 0, bytes = 0, historyDep = 0;
const t0 = Date.now();
let histKnown = null;
function check(src, label) {
  total++;
  const a = run(O, src);
  histKnown = null;
  for (const m of modes) {
    F.__mode(m);
    perMode[m]++;
    const fb = F.__stats.fallback;
    const b = run(F, src);
    if (a !== b && F.__stats.fallback > fb && (histKnown ??= historyDependent(src))) {
      historyDep++;
      continue;
    }
    if (a !== b) {
      mismatches++;
      if (mismatches <= 15) {
        console.log(`MISMATCH [${m}] ${label} (len ${src.length}): ${JSON.stringify(src.length < 300 ? src : src.slice(0, 200) + "...")}`);
        console.log("  orig:", a.slice(0, 400));
        console.log("  fast:", b.slice(0, 400));
      }
    }
  }
}

for (const f of files) {
  let src;
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  if (src.length > 12e6) continue;
  bytes += src.length;
  const rel = f;
  check(src, rel);
  check("/*" + tricky[(rnd() * tricky.length) | 0] + "*/" + src, rel + " [utf16]");
  for (let v = 0; v < variants; v++) {
    const r = rnd();
    let s;
    if (v === 0) s = src.slice(0, (rnd() * src.length) | 0);
    else {
      const at = (rnd() * (src.length + 1)) | 0;
      const ed = EDITS[(rnd() * EDITS.length) | 0];
      s = r < 0.5 ? src.slice(0, at) + ed + src.slice(at) : src.slice(0, at) + ed + src.slice(at + 1 + ((rnd() * 3) | 0));
    }
    check(s, rel + ` [variant ${v}]`);
  }
}
console.log(`checks: ${total} (x ${modes.length} modes: ${Object.entries(perMode).map(([m, n]) => m + " " + n).join(", ")}), mismatches: ${mismatches}, history-dependent (original reads stale memory): ${historyDep}, fallbacks: ${F.__stats.fallback}, source MB: ${(bytes / 1e6).toFixed(1)}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(mismatches ? 1 : 0);
