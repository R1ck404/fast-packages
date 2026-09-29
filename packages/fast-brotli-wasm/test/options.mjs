// compress() options parity: @r1ck404/fast-brotli-wasm vs brotli-wasm 3.0.1.
// brotli-wasm reads the options as serde_json::from_str(JSON.stringify(options))
// into `struct Options { #[serde(default = "default_quality")] quality: i32 }`
// and unwraps: every value JSON.stringify can produce is either a quality or a
// panic whose message (serde_json's error, Debug-formatted twice) reaches
// console.error. This compares the quality used (the compressed bytes), what is
// thrown and the console output for hand-picked and random options: numbers
// of every magnitude and form, strings with every kind of character, escapes
// and lone surrogates, nesting, arrays, toJSON, boxed values.
// Both sides run on fresh instances after every panic (brotli-wasm prints only
// the first two panics of an instance; api.mjs checks that part).
// usage: node packages/fast-brotli-wasm/test/options.mjs [--n=20000] [--seed=1] [--quick]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bind } from "../core.mjs";

const require = createRequire(import.meta.url);
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const N = +(args.n ?? (args.quick !== undefined ? 3000 : 20000));
let seed = +(args.seed ?? 1);

// ---------------------------------------------------------------- instances
const origDir = join(dirname(require.resolve("brotli-wasm")), "pkg.node");
const origSrc = readFileSync(join(origDir, "brotli_wasm.js"), "utf8").replace("new WebAssembly.Module(bytes)", "__MOD");
if (!origSrc.includes("__MOD")) throw new Error("unexpected brotli-wasm glue");
const origMod = new WebAssembly.Module(readFileSync(join(origDir, "brotli_wasm_bg.wasm")));
const origFactory = new Function("module", "exports", "require", "__dirname", "__MOD", origSrc);
function freshOrig() {
  const module = { exports: {} };
  origFactory(module, module.exports, (m) => (m === "fs" ? { readFileSync: () => null } : require(m)), origDir, origMod);
  return module.exports;
}
const fastMod = new WebAssembly.Module(readFileSync(new URL("../fastbrotli.wasm", import.meta.url)));
const freshFast = () => bind(new WebAssembly.Instance(fastMod, {}).exports);

let O = freshOrig(), F = freshFast();
const input = new TextEncoder().encode("options options options test");

function run(M, opt) {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(" ").split("\n\nStack:")[0]);
  let r;
  try {
    r = { ok: Buffer.from(M.compress(input, opt)).toString("base64") };
  } catch (e) {
    r = { threw: typeof e === "string" ? "string:" + e : `${e?.constructor?.name}:${e?.message}` };
  } finally {
    console.error = orig;
  }
  if (logged.length) r.console = logged;
  return r;
}

let checks = 0, failures = 0;
const kinds = {};
function check(opt, label) {
  checks++;
  const a = run(O, opt), b = run(F, opt);
  if (a.threw || b.threw) {
    O = freshOrig();
    F = freshFast();
  }
  const kind = a.ok ? "ok" : a.console ? a.console[0].replace(/.*value: Error\("([a-z ]+).*/s, "$1") : a.threw.split(":")[0];
  kinds[kind] = (kinds[kind] || 0) + 1;
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) {
    failures++;
    if (failures <= 20) {
      let shown;
      try { shown = JSON.stringify(opt); } catch { shown = String(opt); }
      let d = 0;
      while (sa[d] === sb[d]) d++;
      const from = Math.max(0, d - 150);
      console.log("MISMATCH", label ?? "", String(shown).slice(0, 120), "\n  orig:", sa.slice(from, d + 150), "\n  fast:", sb.slice(from, d + 150));
    }
  }
}

// ---------------------------------------------------------------- random values
function rnd() {
  // xorshift32
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
}
const ri = (n) => Math.floor(rnd() * n);
const pick = (a) => a[ri(a.length)];
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);

function randomNumber(kind = ri(18)) {
  switch (kind) {
    // binary fractions with 16-17 digit decimal forms: ties between the two nearest shortest candidates
    case 16: return ((ri(2 ** 26) * 2 ** 26 + ri(2 ** 26)) / 2 ** ri(14)) * pick([1, -1]);
    case 17: return (2 ** 53 + ri(2 ** 30) * 2) * 2 ** ri(30) * pick([1, -1, 2 ** -60, 2 ** -200]);
    case 0: return ri(12);
    case 1: return ri(40) - 20;
    case 2: return pick([2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32, 2 ** 53, 2 ** 53 + 2, 2 ** 63, 2 ** 64, -(2 ** 63), -(2 ** 64), 1e19, 1e20, 1e21, 1e22, -1e21, 18446744073709552000, 9223372036854776000, -9223372036854776000]);
    case 3: { u32[0] = (rnd() * 2 ** 32) >>> 0; u32[1] = (rnd() * 2 ** 32) >>> 0; return f64[0]; } // any double (NaN/Infinity -> null)
    case 4: return (rnd() - 0.5) * 10 ** (ri(40) - 20);
    case 5: return Math.round((rnd() - 0.5) * 10 ** ri(25));
    case 6: return pick([0.1, 0.5, 1.5, -1.5, 5e-324, -5e-324, 2.2250738585072014e-308, 1.7976931348623157e308, -1.7976931348623157e308, 1e308, 1e-308, 1e-7, 1e-6, 123e-20, 0.30000000000000004, 1.0000000000000002, 4.35, 9007199254740993, -0, NaN, Infinity]);
    case 7: return Number((rnd() * 10 ** ri(22)).toPrecision(1 + ri(17)));
    case 8: return 10 ** (ri(640) - 330);
    case 9: return Number(`${ri(10)}.${String(ri(1e9))}e${ri(700) - 350}`);
    case 10: return Number((rnd() * 20).toFixed(ri(5)));
    case 11: return -ri(2 ** 31);
    case 12: { u32[0] = (rnd() * 2 ** 32) >>> 0; u32[1] = ri(2 ** 20) | (pick([0x3ff, 0x400, 0x43e, 0x43f, 0x440, 0x7fe, 0x000, 0x001]) << 20) | (ri(2) << 31); return f64[0]; }
    case 13: return (2 ** ri(80)) * pick([1, -1, 3, 0.5]) + pick([0, 1, -1]);
    case 14: return Number(String(ri(2 ** 30)) + String(ri(2 ** 30)) + String(ri(1000)));
    default: return ri(2 ** 31) * pick([1, -1]);
  }
}
const SPECIAL = ["\"", "\\", "/", "\b", "\f", "\n", "\r", "\t", "\0", "\u0001", "\u001f", "\u007f", "\u0080", "\u0085", " ", "­", "̀", "͏", "؜", "​", "‍", " ", " ", "‮", "⁠", "　", "﻿", "￹", "�", "￿", "퟿", "", "", "'", "`", "{", "}", "[", "]", ":", ",", " at line 1 column 2", "é", "€", "😀", "\u{1f3fb}", "\u{e0001}", "\u{e0100}", "\u{10ffff}", "\u{1d173}", "\u{1f1e6}", "\u{2fa1f}", "\u{30000}", "\u{e01ef}", "\u{f0000}"];
function randomChar() {
  switch (ri(10)) {
    case 0: return String.fromCharCode(0xd800 + ri(0x800)); // lone surrogate
    case 1: return String.fromCharCode(ri(0x80));
    case 2: return String.fromCodePoint(ri(0x800));
    case 3: return String.fromCharCode(ri(0xd800));
    case 4: { const c = ri(0x110000); return c >= 0xd800 && c < 0xe000 ? "x" : String.fromCodePoint(c); }
    case 5: return String.fromCodePoint(0x10000 + ri(0x30000));
    default: return pick(SPECIAL);
  }
}
function randomString() {
  const n = pick([0, 1, 1, 2, 3, 5, 8, 20]);
  let s = "";
  for (let i = 0; i < n; i++) s += rnd() < 0.5 ? String.fromCharCode(97 + ri(26)) : randomChar();
  return s;
}
const KEYS = ["quality", "quality", "quality", "Quality", "qualit", "qualityx", "q", "", "lgwin", "mode", "quality\u0000", "quality ", "quality", "qualíty", "\ud800", "\udc00", "😀", "\ud83dx"];
function randomValue(depth) {
  switch (ri(depth > 3 ? 6 : 9)) {
    case 0: case 1: return randomNumber();
    case 2: return randomString();
    case 3: return pick([true, false, null, undefined, () => 1, Symbol("s")]);
    case 4: return pick([NaN, Infinity, -Infinity, -0, 0]);
    case 5: return ri(12);
    case 6: return randomObject(depth + 1);
    case 7: return Array.from({ length: ri(4) }, () => randomValue(depth + 1));
    default: return pick([new Date(ri(2 ** 40)), new Number(ri(20)), new String(randomString()), new Boolean(ri(2)), withToJSON(randomValue(depth + 1))]);
  }
}
// (the value is made once: both sides must stringify the same thing)
const withToJSON = (v) => ({ toJSON: () => v });
function randomObject(depth) {
  const o = {};
  const n = pick([0, 1, 1, 1, 2, 3, 5]);
  for (let i = 0; i < n; i++) o[rnd() < 0.3 ? randomString() : pick(KEYS)] = randomValue(depth);
  return o;
}
function randomOptions() {
  switch (ri(12)) {
    case 0: return randomObject(0);
    case 1: return [randomValue(1), ...(ri(3) ? [] : [randomValue(1)])];
    case 2: return withToJSON(randomValue(0));
    case 3: return { quality: randomString() };
    case 4: return [randomNumber()];
    case 5: return { quality: randomValue(2) };
    case 6: return { [randomString()]: randomValue(1), quality: randomNumber() };
    default: return { quality: randomNumber() };
  }
}

// ---------------------------------------------------------------- hand-picked
const nest = (d, open) => { let v = 1; for (let i = 0; i < d; i++) v = open === "[" ? [v] : { a: v }; return v; };
const handpicked = [
  undefined, null, {}, [], [[]], [{}], [null], [5], [5, 6], [5, []], [[5]], [{ quality: 3 }], ["5"], [1.5], [true], [-1],
  { quality: 0 }, { quality: 11 }, { quality: -1 }, { quality: 12 }, { quality: 2 ** 31 - 1 }, { quality: 2 ** 31 }, { quality: -(2 ** 31) }, { quality: -(2 ** 31) - 1 },
  { quality: 1e21 }, { quality: 1e-7 }, { quality: 5e-324 }, { quality: 1.7976931348623157e308 }, { quality: -1.7976931348623157e308 }, { quality: 2 ** 64 }, { quality: 2 ** 63 }, { quality: -(2 ** 63) },
  { quality: 18446744073709551615 }, { quality: 1e19 }, { quality: 1e20 }, { quality: 123456789012345680000 }, { quality: -0 }, { quality: NaN }, { quality: Infinity },
  { quality: "5" }, { quality: "" }, { quality: "\ud800" }, { quality: "\udc00" }, { quality: "\ud800\ud800" }, { quality: "\ud800x" }, { quality: "\ud800\n" }, { quality: "a\ud800" }, { quality: "😀" },
  { quality: null }, { quality: true }, { quality: false }, { quality: [] }, { quality: {} }, { quality: [1] }, { quality: undefined }, { quality: () => 1 }, { quality: Symbol("x") },
  { quality: new Number(4) }, { quality: new String("4") }, { quality: new Date(0) }, { quality: { toJSON: () => 7 } },
  { a: 1 }, { a: 1, quality: 3 }, { quality: 3, a: 1 }, { "\ud800": 1, quality: 3 }, { quality: 3, "\ud800": 1 }, { a: "\ud800", quality: 3 }, { "": 1 }, { a: nest(200, "[") }, { a: nest(200, "{") }, { quality: nest(3, "[") },
  { toJSON: () => 5 }, { toJSON: () => -5 }, { toJSON: () => 1.5 }, { toJSON: () => "x" }, { toJSON: () => "\ud800" }, { toJSON: () => true }, { toJSON: () => null }, { toJSON: () => [] }, { toJSON: () => [3] },
  { toJSON: () => undefined }, { toJSON: () => () => 1 }, { toJSON: () => 2 ** 64 }, { toJSON: () => 1e300 }, { toJSON: () => -1e-300 },
  new Date(0), new Number(3), new String("abc"), new Boolean(false), Object(Symbol("s")), [undefined], [() => 1], [NaN], nest(150, "["), [nest(150, "[")],
  { quality: 5, toJSON() { return { quality: 6 }; } }, Object.create({ quality: 4 }), Object.assign(Object.create(null), { quality: 2 }),
  { get quality() { return 7; } }, new Proxy({ quality: 3 }, {}), new Map([["quality", 3]]), new Set([1]), new Uint8Array([1, 2]), /re/, new Error("e"),
  { quality: "\u0000\u0001\u001f\u007f\u0085­̀​ ﻿￿\u{e0001}\u{10ffff}\"\\'`" },
  { quality: "x at line 5 column 7" }, { toJSON: () => "x at line 5 column 7" },
];

for (const opt of handpicked) check(opt, "handpicked");
// every code point in a string value (validates the escaping table), in chunks
for (let base = 0; base < 0x110000; base += 0x800) {
  let s = "";
  for (let c = base; c < base + 0x800; c++) if (c < 0xd800 || c > 0xdfff) s += String.fromCodePoint(c);
  check({ quality: s }, "code points " + base.toString(16));
  if (args.quick !== undefined) base += 0x800 * 7;
}
// numbers (serde_json float parsing, Rust Display of floats), tie-prone ones twice as often
for (let i = 0; i < N / 4; i++) check([randomNumber(ri(3) ? ri(18) : 16 + ri(2))], "number #" + i);
for (let i = 0; i < N; i++) check(randomOptions(), "random #" + i);
// a thrown JSON.stringify error (BigInt, cycle) propagates unchanged
const cyc = {};
cyc.self = cyc;
for (const opt of [{ quality: 1n }, cyc, [1n]]) check(opt, "stringify throws");

console.log(`checks: ${checks}, failures: ${failures}`);
console.log("kinds:", JSON.stringify(kinds));
process.exit(failures ? 1 : 0);
