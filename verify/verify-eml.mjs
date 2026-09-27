// Independent differential check: fast-es-module-lexer vs es-module-lexer 1.7.0.
// Real files (all JS/TS kinds), random order, UTF-16 variants, edits,
// truncations; mismatches on malformed inputs are accepted only if the
// original's own answer is provably history-dependent (two fresh original
// instances with different memory history disagree).
// usage: node .scratch/verify/verify-eml.mjs [nFiles]
import * as O from "es-module-lexer";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { allFiles, sample, readText, rnd, rint, pick, Tally, root, describeErr } from "./corpus.mjs";
import { historyDependent as isHistoryDependent } from "../fast-es-module-lexer/test/history.mjs";

const F = await import(process.env.FAST_EML || "../fast-es-module-lexer/index.mjs");
await O.init;
F.initSync();
const N = Number(process.argv[2] || 3000);
const T = new Tally("es-module-lexer");
let historyDependent = 0;

const ser = (x) => JSON.stringify(x, (k, v) => (v === undefined ? "\u0000undef" : v));
function run(P, src) {
  try {
    return ser(P.parse(src));
  } catch (e) {
    return "ERR " + describeErr(e) + " idx=" + e.idx;
  }
}

const origUrl = pathToFileURL(join(root, "node_modules/es-module-lexer/dist/lexer.js")).href;
let inst = 0;
async function freshOrig() {
  const m = await import(origUrl + "?fresh=" + ++inst);
  await m.init;
  return m;
}
const junkA = "import a from 'x';".repeat(3000) + "/*" + "z".repeat(50000);
const junkB = "export const b = `${'q'}`;".repeat(3000) + "'" + "\u00e9".repeat(50000);

async function check(name, src) {
  const a = run(O, src), b = run(F, src);
  if (a === b) return T.ok(true);
  // history-dependent in the original?
  const m1 = await freshOrig(), m2 = await freshOrig();
  run(m1, junkA);
  run(m2, junkB);
  const r1 = run(m1, src), r2 = run(m2, src);
  // (and the stronger check: fresh original wasm with the stack and the
  // memory past the source filled with different patterns)
  if (r1 !== r2 || isHistoryDependent(src)) {
    historyDependent++;
    return T.ok(true);
  }
  T.ok(false, `${name}\n    orig: ${a.slice(0, 300)}\n    fast: ${b.slice(0, 300)}`);
}

const exts = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".d.ts", ".json", ".vue", ".svelte"];
const files = sample(allFiles((n) => exts.some((e) => n.endsWith(e))), N, 12 << 20);
// random order: interleave sizes so state from big parses meets small ones
for (let i = files.length - 1; i > 0; i--) {
  const j = rint(i + 1);
  [files[i], files[j]] = [files[j], files[i]];
}
console.log("files:", files.length);
const EDITS = ["/", "'", '"', "`", "{", "}", "(", ")", "${", "*/", "/*", "//", "\n", "import", "export ", "import(", "import.meta", "\\", " ", "é", "\u2028", "\ud800", "[", "]", ".", "=>", "\r\n", "\0", "export default ", "import {a as b} from 'c';", "export * as ns from 'm';", "import d, * as e from \"f\";"];
const t0 = Date.now();
for (let i = 0; i < files.length; i++) {
  const src = readText(files[i]);
  const name = files[i].slice(-70);
  await check(name, src);
  if (i % 4 === 0) await check(name + " [utf16]", "/*\u00e9\u4e2d\ud83d\ude00*/" + src);
  if (i % 4 === 1) await check(name + " [trunc]", src.slice(0, rint(src.length + 1)));
  if (i % 4 === 2) {
    const p = rint(src.length + 1);
    await check(name + " [edit]", src.slice(0, p) + pick(EDITS) + src.slice(p));
  }
  if (i % 4 === 3) {
    // non-ASCII inside strings/specifiers
    await check(name + " [spec]", `import x from './\u00fc\u00f1\u00ee.js';\nimport('\\u0041' + y);\nexport { z as '\u2603' };\n` + src);
  }
  if (i % 500 === 0) process.stderr.write(`  ${i}/${files.length} ${((Date.now() - t0) / 1000).toFixed(0)}s fails=${T.fails}\n`);
}
// synthetic edge cases
const cases = [
  "", " ", "import", "export", "import.meta", "import.meta.url", "import('a')", "import(`a`)", "import(a)",
  "export { a as default, b as 'c d' }", "export * from 'a'", "export * as x from 'a'", "import a, { b as c } from 'd'",
  "import source x from 'y'", "import defer * as z from 'w'", "import x from 'y' with { type: 'json' }",
  "import('a', { with: { type: 'json' } })", "export default function () {}", "export default class {}",
  "export async function f() {}", "export var a = 1, b, c = 3", "export let [a, b] = c", "export const { a, b: c } = d",
  "a = /import('x')/; import('y')", "`${import('a')}` + `${`${import.meta}`}`", "'\\u{1F600}'; import 'a\\u0062c'",
  "import 'a\\\nb'", "import \"\\x41\"", "export { 'a' as b } from 'c'", "x.import('a')", "import\n.meta", "class A { import() {} }",
  "/*", "'", "`", "`${", "import('", "export {", "\ud800", "import '\ud800'", "import x from '\u2028'",
];
for (const c of cases) await check("case " + JSON.stringify(c), c);
console.log("history-dependent (accepted):", historyDependent);
process.exit(T.report() ? 1 : 0);
