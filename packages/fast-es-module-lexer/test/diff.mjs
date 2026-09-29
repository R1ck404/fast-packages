// Differential test: @r1ck404/fast-es-module-lexer vs es-module-lexer 1.7.0 on every
// JS/TS file under node_modules, plus variants of each file:
//   - forced UTF-16 path (non-ASCII comment prepended)
//   - truncated prefixes (error paths)
//   - random single-char edits (fuzz)
// Every check runs @r1ck404/fast-es-module-lexer once per way of getting the source
// into wasm memory (Node Buffer copy, V8 JS-string builtins: charCodeAt or
// intoCharCodeArray, encodeInto / JS copy as in other browsers).
// Results must equal the original's (one instance for the whole run). When
// the lexer read outside the source (malformed code, where the original
// reads memory outside it and its answer depends on history, see
// history.mjs), the result must instead equal the original's on a fresh
// instance, whatever the long-lived instance says.
// usage: node packages/fast-es-module-lexer/test/diff.mjs [--quick] [--seed=N] [--variants=N] [--modes=node,v8,v8-into,encode] [--file=browser.mjs]
import * as O from "es-module-lexer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, nm } from "../../../bench/corpus.mjs";
import { withHooks } from "./hooks.mjs";
import { freshParse } from "./history.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => a.startsWith("--file="))?.slice(7) || "index.mjs";
const F = await withHooks(file);
F.initSync();
O.initSync();
console.log("module:", file);
const quick = args.includes("--quick");
const seedArg = args.find((a) => a.startsWith("--seed="));
const variantsArg = args.find((a) => a.startsWith("--variants="));
let seed = seedArg ? Number(seedArg.slice(7)) : 1;
const variants = variantsArg ? Number(variantsArg.slice(11)) : 4;
const modesArg = args.find((a) => a.startsWith("--modes="));
// explicitly requested modes must exist; by default every mode this engine
// supports (the v8 modes need the wasm JS-string builtins, which older V8s
// such as Node 20's do not have)
const modes = modesArg
  ? modesArg.slice(8).split(",")
  : ["node", "v8", "v8-into", "encode"].filter((m) => {
      try {
        F.__mode(m);
        return true;
      } catch {
        console.log(`mode ${m}: not available in this engine, skipped`);
        return false;
      }
    });
for (const m of modes) F.__mode(m); // throws if a requested mode is unavailable
const perMode = Object.fromEntries(modes.map((m) => [m, 0]));
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

const ser = (x) => JSON.stringify(x, (k, v) => (v === undefined ? "\u0000undef" : v));
function run(parse, src) {
  try {
    return ser(parse(src));
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
const dirs = dirArgs.length ? dirArgs : [nm, join(here, "../../../../Nodepod/node_modules/.pnpm")].filter((d) => existsSync(d));
let files = [];
for (const d of dirs) listFiles(d, exts, files);
files = [...new Set(files)];
if (quick) files = files.filter((_, i) => i % 10 === 0);
console.log("files:", files.length);

const EDITS = ["/", "'", '"', "`", "{", "}", "(", ")", "${", "*/", "/*", "//", "\n", "import", "export ", "import(", "import.meta", "\\", " ", "é", " ", " ", "\ud800", "[", "]", ".", "...", "=>", "class ", "\r\n", "\0",
  // chars above 0xff whose low byte is a token char (U+0127 has 0x27 = ', ...)
  "ħ", "Ĩ", "ĩ", "į", "Š", "Ż", "Ž", "Ŝ", "Ģ", "ť", "ũ", "（", " ", "ÿ", "\u0080"];
const tricky = ["é", " ", " ", "😀", "\ud800", "￿", "ſ", "ħ", "Ż", "ÿ"];

// outside: inputs on which the lexer read outside the source (checked
// against a fresh original); history: those on which the long-lived
// original answered differently (its answer depended on its history)
let total = 0, mismatches = 0, bytes = 0, outside = 0, history = 0;
const t0 = Date.now();
function check(src, label) {
  total++;
  const a = run(O.parse, src);
  let fresh = null, out = false;
  for (const m of modes) {
    F.__mode(m);
    perMode[m]++;
    const o0 = F.__stats().outside;
    const b = run(F.parse, src);
    const read = F.__stats().outside > o0;
    let want = a;
    if (read) {
      fresh ??= run(freshParse, src);
      want = fresh;
      out = true;
    }
    if (b !== want) {
      mismatches++;
      if (mismatches <= 15) {
        console.log(`MISMATCH [${m}] ${label} (len ${src.length})${read ? " (read outside the source)" : ""}: ${JSON.stringify(src.length < 300 ? src : src.slice(0, 200) + "...")}`);
        console.log(`  ${read ? "fresh original" : "original"}:`, want.slice(0, 400));
        console.log("  fast:", b.slice(0, 400));
      }
    }
  }
  if (out) {
    outside++;
    if (fresh !== a) history++;
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
console.log(`checks: ${total} (x ${modes.length} modes: ${Object.entries(perMode).map(([m, n]) => m + " " + n).join(", ")}), mismatches: ${mismatches}, read outside the source: ${outside} (all checked against a fresh original; the long-lived original answered differently on ${history}), source MB: ${(bytes / 1e6).toFixed(1)}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(mismatches ? 1 : 0);
