// Targeted cases for @r1ck404/fast-es-module-lexer vs es-module-lexer 1.7.0: string
// escapes in specifiers and export names, chars whose UTF-16 low byte is a
// token char, block/padding boundaries, memory growth between parses, errors,
// non-string arguments, async init, the first parse of a fresh instance;
// malformed code on which the original reads outside its source (answered
// as a fresh original instance answers: fuzzed against one, and independent
// of what was parsed before), a trap of the original, the nesting limits of
// the original (the one difference, pinned). Every case runs in every copy
// mode.
// usage: node packages/fast-es-module-lexer/test/edge.mjs [--fuzz=N] [--file=browser.mjs]
import * as O from "es-module-lexer";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withHooks } from "./hooks.mjs";
import { freshParse } from "./history.mjs";

const file = process.argv.find((a) => a.startsWith("--file="))?.slice(7) || "index.mjs";
console.log("module:", file);
const P = await import(new URL("../" + file, import.meta.url).href); // (the public module: its exports)
const F = await withHooks(file);
O.initSync();
F.initSync();
P.initSync();
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
const fuzzArg = process.argv.find((a) => a.startsWith("--fuzz="));
const FUZZ = fuzzArg ? Number(fuzzArg.slice(7)) : 20000;

const ser = (x) => JSON.stringify(x, (k, v) => (v === undefined ? "\u0000undef" : v));
function res(r) {
  return ser(r) + " keys=" + (r[0] || []).map((o) => Object.keys(o).join(",")).join("|") + "/" + (r[1] || []).map((o) => Object.keys(o).join(",")).join("|");
}
function run(parse, src, name) {
  try {
    return res(name === undefined ? parse(src) : parse(src, name));
  } catch (e) {
    return "ERR " + e.constructor.name + " " + e.message + " idx=" + e.idx + " keys=" + Object.keys(e).join(",");
  }
}

let checks = 0, failures = 0, outside = 0, history = 0;
function fail(label, want, got) {
  failures++;
  if (failures <= 20) {
    console.log(`FAIL ${label}`);
    console.log("  want:", String(want).slice(0, 300));
    console.log("  fast:", String(got).slice(0, 300));
  }
}
// the original's answer, or a fresh original's when the lexer read outside
// the source (see history.mjs)
function check(src, label = "", name) {
  const a = run(O.parse, src, name);
  let fresh = null, out = false;
  for (const m of modes) {
    F.__mode(m);
    checks++;
    const o0 = F.__stats().outside;
    const b = run(F.parse, src, name);
    let want = a;
    if (F.__stats().outside > o0) {
      want = fresh ??= run(freshParse, src, name);
      out = true;
    }
    if (b !== want) fail(`[${m}] ${label} ${JSON.stringify(src.length > 200 ? src.slice(0, 200) + "..." : src)}`, want, b);
  }
  if (out) {
    outside++;
    if (fresh !== a) history++;
  }
}

// --- specifiers and names with escapes / quotes / odd chars
const bodies = ["x", "", "\\x41", "\\u0041\\u{1F600}", "a\\'b", 'a\\"b', "\\\\", "a\\\nb", "a\\\r\nb", " ", " ", "é", "😀", "\ud800", " ", "\\0", "\\08", "\\u{110000}", "\\x4", "'", '"', "a b"];
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
for (const s of ["import a from", "export {", ")", "}", "'abc", "`${", "a = /re", "import(", "{ `", "x = `${a}`}", "export d", "import { a", "export { a } from"])
  for (const name of [undefined, "file.js", "", "@"]) check(s, "error", name);

// --- memory growth between parses (views must be refreshed)
{
  const big = (unit + "/* padding é */".repeat(50)).repeat(4000);
  const seq = ["import 'a'", big, "export const q = 1", big + big, "import('ħ')", big.slice(0, 100000), "x"];
  for (let r = 0; r < 2; r++) for (const s of seq) check(s, "growth " + s.length);
}

// --- malformed code, fuzzed: token soups cut anywhere (many end inside a
// statement, where the original reads past its source), against a fresh
// original instance in every mode
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const pick = (a) => a[(rnd() * a.length) | 0];
  const TOK = ["import", "export", "default", "async", "function", "function*", "class", "from", "as", "with", "assert", "source", "defer", "meta", ".", "...", "*",
    "{", "}", "(", ")", "[", "]", ",", ";", ":", "=", "=>", "/", "/re/g", "'a'", '"b"', "'\\x41'", "`t`", "`${", "${", "`", "//c\n", "/*c*/", "\n", " ", "\t", " ",
    "x", "y", "const", "let", "var", "return", "typeof", "in", "if", "while", "for", "do", "else", "case", "void", "yield", "await", "new", "delete", "throw", "break", "continue",
    "catch", "finally", "debugger", "instanceof", "++", "--", "+", "-", "0.", "1", "import(", "import.meta", "export default", "export {", "export *", "import {", "é", " ", "\ud800", "\0"];
  let n = 0, out = 0;
  for (let t = 0; t < FUZZ; t++) {
    let s = "";
    const k = 1 + ((rnd() * 14) | 0);
    for (let i = 0; i < k; i++) {
      s += pick(TOK);
      if (rnd() < 0.5) s += " ";
    }
    if (rnd() < 0.5) s = s.slice(0, (rnd() * (s.length + 1)) | 0);
    const want = run(freshParse, s);
    let read = false;
    for (const m of modes) {
      F.__mode(m);
      checks++;
      n++;
      const o0 = F.__stats().outside;
      const b = run(F.parse, s);
      if (F.__stats().outside > o0) read = true;
      if (b !== want) fail(`[${m}] fuzz vs fresh original ${JSON.stringify(s)}`, want, b);
    }
    if (read) out++;
  }
  console.log(`fuzz: ${n} checks against a fresh original, ${out} of ${FUZZ} inputs read outside the source`);
}

// --- the answer to such inputs does not depend on what was parsed before
// (the original's does): after sources that leave strings, brackets and
// many records in memory, and after a trap, every copy mode answers like a
// fresh instance of this package and like a fresh original
{
  const inputs = ["export d", "import { Strin", "export { default } from '", "e/xport {};\n", ".export {};\n", "import x from 'y' with", "export default async", "import(", "export { default as add }/ from './add.js';", "import 'a'; export d", "export {a}; import {", "x = import.meta; export *"];
  const junk = [
    "import a from 'x';".repeat(3000) + "/*" + "z".repeat(50000),
    "export const b = `${'q'}`;".repeat(3000) + "'" + "é".repeat(50000),
    "((((((((((" + "{".repeat(1000) + "import('a')".repeat(500),
    "export{" + "a,".repeat(40000) + "}", // traps (see below)
    "f(".repeat(1000) + "x" + ")/ ".repeat(999),
  ];
  const G = await withHooks(file);
  G.initSync();
  const firstAnswers = inputs.map((s) => run(G.parse, s));
  for (const j of junk)
    for (const m of modes) {
      F.__mode(m);
      run(F.parse, j);
      for (let i = 0; i < inputs.length; i++) {
        checks++;
        const b = run(F.parse, inputs[i]);
        const want = run(freshParse, inputs[i]);
        if (b !== want || b !== firstAnswers[i]) fail(`[${m}] after ${j.length} chars of junk: ${JSON.stringify(inputs[i])}`, want + "\n  first parse: " + firstAnswers[i], b);
      }
    }
}

// --- the original traps (RuntimeError, memory access out of bounds) when its
// records do not fit in its memory: so does this lexer, and it keeps working
// afterwards (a trapped original instance does not: every later parse traps)
for (const n of [20000, 40000]) {
  check("export{" + "a,".repeat(n) + "}", "records overflow " + n);
  check("export{" + "a as b,".repeat(n >> 1) + "}", "records overflow as " + n);
  for (const m of modes) {
    F.__mode(m);
    checks++;
    const b = run(F.parse, "import 'a'");
    const want = run(freshParse, "import 'a'");
    if (b !== want) fail(`[${m}] a parse after a trap`, want, b);
  }
}

// --- nesting: the original has room for 1024 open brackets and 512 open
// import( calls; deeper, it overwrites its own copy of the source (from the
// start; past ~1365 brackets, code it has not read yet) or its bracket stack
// with its stacks, and its answers go wrong. This lexer has room for 16384
// and 4096: it answers as the original does within the original's limits
// (the same formulas), and deeper as well; past its own limits the answer
// is a parse error at the bracket that does not fit. (The one known
// difference, pinned here.)
{
  // a fresh original's memory for a source of len chars; its records
  // (imports 36 bytes, exports 20) must fit after the source, or it traps
  const fits = (len, bytes) => bytes <= Math.max(1, Math.ceil((14656 + 4 * (len + 1)) / 65536)) * 65536 - 14656 - 2 * (len + 1);
  const TRAP = "ERR RuntimeError memory access out of bounds idx=undefined keys=";
  const cases = [
    // [name, make(n), expected result(n), deepest n at which a fresh original still answers that]
    ["( )", (n) => "(".repeat(n) + ")".repeat(n) + "; import 'a'", (n) => [[{ n: "a", t: 1, s: 2 * n + 10, e: 2 * n + 11, ss: 2 * n + 2, se: 2 * n + 12, d: -1, a: -1 }], [], false, true], 1300],
    ["{ }", (n) => "{".repeat(n) + "}".repeat(n) + "; export const x = 1", (n) => [[], [{ s: 2 * n + 15, e: 2 * n + 16, ls: 2 * n + 15, le: 2 * n + 16, n: "x", ln: "x" }], false, true], 1300],
    ["`${ }`", (n) => "`${".repeat(n) + "}`".repeat(n) + "; import 'a'", (n) => [[{ n: "a", t: 1, s: 5 * n + 10, e: 5 * n + 11, ss: 5 * n + 2, se: 5 * n + 12, d: -1, a: -1 }], [], false, true], 512],
    [
      "import( )",
      (n) => "import(".repeat(n) + "'a'" + ")".repeat(n),
      (n) =>
        fits(8 * n + 3, 36 * n)
          ? [Array.from({ length: n }, (_, i) => (i === n - 1 ? { n: "a", t: 2, s: 7 * i + 7, e: 7 * n + 3, ss: 7 * i, se: 7 * n + 4, d: 7 * i + 6, a: -1 } : { n: undefined, t: 2, s: 7 * i + 7, e: 8 * n + 2 - i, ss: 7 * i, se: 8 * n + 3 - i, d: 7 * i + 6, a: -1 })), [], n === 1, false]
          : TRAP,
      512,
    ],
  ];
  for (const [name, make, expect, deepest] of cases) {
    const differ = [];
    for (const n of [1, 100, 500, 511, 512, 513, 600, 900, 1000, 1023, 1024, 1025, 1030, 1300, 1366, 1500, 3000]) {
      const src = make(n), e = expect(n), want = typeof e === "string" ? e : res(e);
      for (const m of modes) {
        F.__mode(m);
        checks++;
        const b = run(F.parse, src);
        if (b !== want) fail(`[${m}] nesting ${name} ${n}`, want, b);
      }
      // the formula is the original's up to its limit
      const o = run(freshParse, src);
      if (n <= deepest && o !== want) fail(`nesting ${name} ${n}: the formula is not the original's`, o, want);
      if (o !== want) differ.push(n);
    }
    console.log(`nesting ${name}: a fresh original answers differently at depths ${differ.join(", ") || "-"} (the pinned difference)`);
  }
  // past 16384 open brackets or 4096 open import( calls: a parse error at
  // the one that does not fit (import( levels padded with a comment, so
  // that their records fit in a fresh original's memory: no trap first)
  const lvl = "import(/*" + "-".repeat(16) + "*/";
  for (const [src, want] of [
    ["(".repeat(16384) + ")".repeat(16384), res([[], [], false, false])],
    ["(".repeat(16385), "ERR Error Parse error @:1:16385 idx=16384 keys=idx"],
    ["x = {" + "(".repeat(16383) + "{", "ERR Error Parse error @:1:16389 idx=16388 keys=idx"],
    ["`${".repeat(8192) + "{", "ERR Error Parse error @:1:24577 idx=24576 keys=idx"],
    // (4096 records, the first as a fresh original has it for 400 levels)
    [lvl.repeat(4096) + ")".repeat(4096), (b) => b.startsWith('[[{"n":"\\u0000undef","t":2,"s":27,"e":114687,"ss":0,"se":114688,"d":6,"a":-1},') && (b.match(/"t":2,/g) || []).length === 4096 && run(freshParse, lvl.repeat(400) + ")".repeat(400)).startsWith('[[{"n":"\\u0000undef","t":2,"s":27,"e":11199,"ss":0,"se":11200,"d":6,"a":-1},')],
    [lvl.repeat(4097), `ERR Error Parse error @:1:${27 * 4097 + 1} idx=${27 * 4097} keys=idx`],
  ]) {
    for (const m of modes) {
      F.__mode(m);
      checks++;
      const b = run(F.parse, src);
      if (typeof want === "string" ? b !== want : !want(b)) fail(`[${m}] nesting past the limits (${src.length} chars)`, want, b);
    }
  }
}

// --- non-strings: es-module-lexer's glue (length + 1 units filled by
// charCodeAt, lexed as length chars): the same results and errors
const nonStrings = [undefined, null, 1, true, {}, [], ["import 'a'"], new String("import 'a'"), new String("export {"), new String("export d"), { length: 0 }, { length: -1 },
  { length: "2" }, { length: 2.5, charCodeAt: () => 32 }, { length: NaN }, { length: 1, charCodeAt: () => 32 }];
for (const v of nonStrings) {
  const label = "non-string " + (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
  const a = run(O.parse, v);
  for (const m of modes) {
    F.__mode(m);
    checks++;
    const o0 = F.__stats().outside;
    const b = run(F.parse, v);
    const want = F.__stats().outside > o0 ? run(freshParse, v) : a;
    if (b !== want) fail(`[${m}] ${label}`, want, b);
  }
}
// (pinned difference: an object with charCodeAt but no string methods is
// lexed and answered as the string of its chars; the original calls its
// slice / lastIndexOf for names and error messages and throws a TypeError
// when they are missing)
{
  const v = { length: 2, charCodeAt: (i) => [0x69, 0x28][i] }; // "i("
  const w = { length: 10, charCodeAt: (i) => "import 'a'".charCodeAt(i) };
  const cases = [
    [v, run(P.parse, "i("), "ERR TypeError E.slice is not a function idx=undefined keys="],
    [w, run(P.parse, "import 'a'"), "ERR TypeError E.slice is not a function idx=undefined keys="],
  ];
  for (const [obj, want, orig] of cases) {
    for (const m of modes) {
      F.__mode(m);
      checks++;
      const b = run(F.parse, obj);
      if (b !== want) fail(`[${m}] string-like object`, want, b);
    }
    checks++;
    if (run(O.parse, obj) !== orig) fail("string-like object: the original", orig, run(O.parse, obj));
  }
}

// --- init: parse before init resolves returns a promise; ImportType; exports list
// (static imports: both modules evaluate and parse() runs in the same task,
// before either wasm compile can have resolved)
{
  const code = `
    import * as F from ${JSON.stringify(new URL("../" + file, import.meta.url).href)};
    import * as O from "es-module-lexer";
    const pf = F.parse("import a from 'b'", "n"), po = O.parse("import a from 'b'", "n");
    const out = [pf instanceof Promise, po instanceof Promise, JSON.stringify(await pf) === JSON.stringify(await po),
      JSON.stringify(F.ImportType) === JSON.stringify(O.ImportType), Object.keys(F).sort().join() === Object.keys(O).sort().join(),
      F.init instanceof Promise, (await F.init) === (await O.init), typeof F.initSync === "function" && F.initSync() === O.initSync()];
    console.log(JSON.stringify(out));`;
  const r = execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", cwd: fileURLToPath(new URL("../..", import.meta.url)) }).trim();
  checks++;
  if (r !== "[true,true,true,true,true,true,true,true]") fail("init/exports", "[true x 8]", r);
  // the module's exports are es-module-lexer's (in this process too)
  checks++;
  if (Object.keys(P).sort().join() !== Object.keys(O).sort().join()) fail("exports", Object.keys(O).sort().join(), Object.keys(P).sort().join());
}

// --- the first parse of a fresh instance (no source buffer yet), every mode
for (const m of modes)
  for (const s of ["", "\u0000", "import 'a'", "export d"]) {
    const code = `
      const { withHooks } = await import(${JSON.stringify(new URL("./hooks.mjs", import.meta.url).href)});
      const F = await withHooks(${JSON.stringify(file)});
      F.__mode(${JSON.stringify(m)});
      let r;
      try { r = JSON.stringify(F.parse(${JSON.stringify(s)})); } catch (e) { r = "ERR " + e.message; }
      console.log(r);`;
    const r = execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" }).trim();
    const o = JSON.stringify(freshParse(s));
    checks++;
    if (r !== o) fail(`[${m}] first parse ${JSON.stringify(s)}`, o, r);
  }

console.log(`edge checks: ${checks}, failures: ${failures}, inputs that read outside the source: ${outside} (checked against a fresh original; the long-lived original answered differently on ${history})`);
process.exit(failures ? 1 : 0);
