// Targeted cases for @r1ck404/fast-es-module-lexer vs es-module-lexer 1.7.0: string
// escapes in specifiers and export names, chars whose UTF-16 low byte is a
// token char, block/padding boundaries, memory growth between parses, errors,
// non-string arguments, async init. Every case runs in every copy mode.
// usage: node packages/fast-es-module-lexer/test/edge.mjs
import * as F from "../lexer.mjs"; // (with the test hooks)
import * as O from "es-module-lexer";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { historyDependent } from "./history.mjs";

O.initSync();
F.initSync();
// every source-copy mode this engine supports (the v8 modes need the wasm
// JS-string builtins, which older V8s such as Node 20's do not have)
const modes = ["node", "node-re", "v8", "v8-into", "encode"].filter((m) => {
  try {
    F.__mode(m);
    return true;
  } catch {
    console.log(`mode ${m}: not available in this engine, skipped`);
    return false;
  }
});

const ser = (x) => JSON.stringify(x, (k, v) => (v === undefined ? "\u0000undef" : v));
function run(P, src, name) {
  try {
    const r = name === undefined ? P.parse(src) : P.parse(src, name);
    return ser(r) + " keys=" + (r[0] || []).map((o) => Object.keys(o).join(",")).join("|") + "/" + (r[1] || []).map((o) => Object.keys(o).join(",")).join("|");
  } catch (e) {
    return "ERR " + e.constructor.name + " " + e.message + " idx=" + e.idx + " keys=" + Object.keys(e).join(",");
  }
}

let checks = 0, failures = 0, historyDep = 0;
function check(src, label = "", name) {
  const a = run(O, src, name);
  for (const m of modes) {
    F.__mode(m);
    checks++;
    const fb = F.__stats.fallback;
    const b = run(F, src, name);
    if (a !== b && F.__stats.fallback > fb && historyDependent(src)) {
      historyDep++;
      continue;
    }
    if (a !== b) {
      failures++;
      if (failures <= 20) {
        console.log(`FAIL [${m}] ${label} ${JSON.stringify(src.length > 200 ? src.slice(0, 200) + "..." : src)}`);
        console.log("  orig:", a.slice(0, 300));
        console.log("  fast:", b.slice(0, 300));
      }
    }
  }
}

// --- specifiers and names with escapes / quotes / odd chars
const bodies = ["x", "", "\\x41", "\\u0041\\u{1F600}", "a\\'b", 'a\\"b', "\\\\", "a\\\nb", "a\\\r\nb", " ", " ", "é", "😀", "\ud800", " ", "\\0", "\\08", "\\u{110000}", "\\x4", "'", '"', "a b"];
for (const body of bodies) {
  for (const q of ["'", '"']) {
    const lit = q + body + q;
    check(`import a from ${lit};`, "static");
    check(`import ${lit};`, "bare");
    check(`import(${lit});`, "dynamic");
    check(`import(${lit}, { with: { type: 'json' } });`, "dynamic+attrs");
    check(`export { a as ${lit} }; let a;`, "export as");
    check(`export { ${lit} as b } from 'm';`, "reexport");
    check(`export { ${lit} } from 'm';`, "reexport name");
    check(`export * as ${lit} from 'm';`, "export star as");
    check(`import { ${lit} as x } from ${lit};`, "import name");
    check(`import x from ${lit} with { type: ${lit} };`, "with");
    check(`import x from ${lit} assert { type: 'json' };`, "assert");
  }
}

// --- chars above 0xff whose low byte is a token char (and Latin-1)
const special = "(){}[]'\"`/\\*.;,=+-!\n\r\t \u0000$_eximcl";
const hi = [];
for (const c of special) for (const h of [0x01, 0x20, 0xd8, 0xdc, 0xff]) hi.push(String.fromCharCode((h << 8) | c.charCodeAt(0)));
for (let c = 0x80; c <= 0xff; c++) hi.push(String.fromCharCode(c));
const templates = [
  (x) => `import a from 'b'; ${x} export const c = 1;`,
  (x) => `${x}import('m')${x}`,
  (x) => `export${x}{ a }; let a;`,
  (x) => `a = b ${x}/ c /g; import 'd';`,
  (x) => `\`${x}\${import('x')}${x}\`; export default ${x}1`,
  (x) => `// ${x}\nimport x from 'y' /* ${x} */`,
  (x) => `'${x}'; export { a as '${x}' } from 'm'`,
  (x) => `class${x}A { static { import.meta } }`,
  (x) => `${x}export ${x}default ${x}function ${x}f() {}`,
  (x) => `im${x}port 'a'; ex${x}port const x = 1;`,
];
for (const x of hi) for (const t of templates) check(t(x), "hi " + x.charCodeAt(0).toString(16));

// --- lengths around SIMD block / padding boundaries, with stops at the ends
const unit = "import a from 'x';\nexport const b = (a) => { return `${a}` };\n";
for (let n = 0; n <= 300; n++) {
  const s = unit.repeat(Math.ceil((n + 1) / unit.length)).slice(0, n);
  check(s, "prefix " + n);
  check(" ".repeat(n) + "import('x')", "spaces " + n);
  check("x".repeat(n) + "(", "open " + n);
  check("'" + "a".repeat(n), "unterminated " + n);
  check("/*" + "é".repeat(n), "comment " + n);
}
check("", "empty");
check("\u0000", "nul");
check("import 'a'\u0000import 'b'", "nul inside");

// --- errors and the name argument
for (const s of ["import a from", "export {", ")", "}", "'abc", "`${", "a = /re", "import(", "{ `", "x = `${a}`}"])
  for (const name of [undefined, "file.js", "", "@"]) check(s, "error", name);

// --- memory growth between parses (views must be refreshed)
{
  const big = (unit + "/* padding é */".repeat(50)).repeat(4000);
  const seq = ["import 'a'", big, "export const q = 1", big + big, "import('ħ')", big.slice(0, 100000), "x"];
  for (let r = 0; r < 2; r++) for (const s of seq) check(s, "growth " + s.length);
}

// --- non-strings go to the original (same results / errors)
for (const v of [undefined, null, 1, {}, ["import 'a'"], new String("import 'a'")]) {
  for (const m of modes) {
    F.__mode(m);
    checks++;
    let a, b;
    try { a = ser(O.parse(v)); } catch (e) { a = "ERR " + e.constructor.name + " " + e.message; }
    try { b = ser(F.parse(v)); } catch (e) { b = "ERR " + e.constructor.name + " " + e.message; }
    if (a !== b) { failures++; console.log(`FAIL [${m}] non-string ${String(v)}\n  orig: ${a}\n  fast: ${b}`); }
  }
}

// --- init: parse before init resolves returns a promise; ImportType; exports list
// (static imports: both modules evaluate and parse() runs in the same task,
// before either wasm compile can have resolved)
{
  const code = `
    import * as F from ${JSON.stringify(new URL("../lexer.mjs", import.meta.url).href)};
    import * as O from "es-module-lexer";
    const pf = F.parse("import a from 'b'", "n"), po = O.parse("import a from 'b'", "n");
    const out = [pf instanceof Promise, po instanceof Promise, JSON.stringify(await pf) === JSON.stringify(await po),
      JSON.stringify(F.ImportType) === JSON.stringify(O.ImportType), Object.keys(F).filter((k) => !k.startsWith("__")).sort().join() === Object.keys(O).sort().join(),
      (await F.init) === (await O.init)];
    console.log(JSON.stringify(out));`;
  const r = execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", cwd: fileURLToPath(new URL("../..", import.meta.url)) }).trim();
  checks++;
  if (r !== "[true,true,true,true,true,true]") { failures++; console.log("FAIL init/exports:", r); }
}

console.log(`edge checks: ${checks}, failures: ${failures}, history-dependent (original reads stale memory): ${historyDep}, fallbacks: ${F.__stats.fallback}`);
process.exit(failures ? 1 : 0);
