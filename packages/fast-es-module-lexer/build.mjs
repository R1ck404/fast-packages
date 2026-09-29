// Builds the wasm core (rust/) and the small string-copy module (wasm
// JS-string builtins, see index.mts) and embeds them: as base64 at the end
// of index.mts (then index.mjs via tools/ts-build.mjs), and as text (see
// encodeWasm), with their decoder (rust/decode.wat), in browser.mjs, which
// is index.mjs with BROWSER = true. The optimised modules are also written
// to rust/target/wasm/ (for inspection; not shipped).
// usage: node packages/fast-es-module-lexer/build.mjs [--no-opt] [--no-cargo]
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import binaryen from "binaryen";
import { transform } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const crate = join(here, "rust");
const out = join(crate, "target/wasm");
mkdirSync(out, { recursive: true });

// The text the modules are embedded as (denser than base64, and byte-aligned
// for gzip/brotli): which bytes are one character (64 hex digits, byte b is
// bit b & 3 of digit b >> 2), then every byte as one character (the 87 most
// frequent) or two. The alphabet is printable ASCII without " $ ' < \ `, so
// the text needs no escapes in any string literal.
const ALPHABET = [];
for (let c = 32; c < 127; c++) if (![34, 36, 39, 60, 92, 96].includes(c)) ALPHABET.push(String.fromCharCode(c));
function encodeWasm(bytes) {
  const count = new Array(256).fill(0);
  for (const b of bytes) count[b]++;
  const one = new Set([...count.keys()].sort((a, b) => count[b] - count[a] || a - b).slice(0, ALPHABET.length - 2));
  let text = "";
  for (let d = 0; d < 64; d++) {
    let v = 0;
    for (let j = 0; j < 4; j++) if (one.has(d * 4 + j)) v |= 1 << j;
    text += v.toString(16);
  }
  // one-character bytes in ascending order after the two pair prefixes,
  // then the pairs in ascending order
  const code = [];
  let n1 = 2, n2 = 0;
  for (let b = 0; b < 256; b++) {
    if (one.has(b)) code[b] = ALPHABET[n1++];
    else code[b] = ALPHABET[Math.floor(n2 / ALPHABET.length)] + ALPHABET[n2++ % ALPHABET.length];
  }
  for (const b of bytes) text += code[b];
  return text;
}

// only what rustc was asked for (plus its defaults): no newer encodings that
// some browsers cannot load
const F = binaryen.Features;
const LEXER_FEATURES =
  F.SIMD128 | F.BulkMemory | F.BulkMemoryOpt | F.SignExt | F.MutableGlobals | F.NontrappingFPToInt | F.Multivalue | F.ReferenceTypes;

function optimize(mod, features, level, shrink, noInline = []) {
  mod.setFeatures(features);
  binaryen.setOptimizeLevel(level);
  binaryen.setShrinkLevel(shrink);
  for (const name of noInline) {
    binaryen.setPassArgument("no-inline", name);
    mod.runPasses(["no-inline"]);
  }
  mod.optimize();
  // (custom sections and the linker's __data_end / __heap_base exports are
  // not used)
  mod.runPasses(["strip-debug", "strip-producers", "strip-target-features"]);
  for (const name of ["__data_end", "__heap_base"]) if (mod.getExport(name)) mod.removeExport(name);
  if (!mod.validate()) throw new Error("wasm-opt output does not validate");
  const bytes = Buffer.from(mod.emitBinary());
  mod.dispose();
  return bytes;
}

// ---- the lexer
// Paths that are cold on the typical first parse stay functions of their own
// (wasm-opt would inline each into its one caller, the main loop): V8
// compiles a function on its first call, so the first parse then compiles
// less code (~0.1 ms less in Node) and the steady state is the same. (cargo
// keeps the function names for this: its output is not stripped; wasm-opt
// strips them.)
const COLD = ["slash", "template_string", "regular_expression", "regex_character_class", "is_expression_keyword", "is_break_or_continue", "is_expression_terminator", "outside", "memeq_outside", "rpk1"];
const rawFile = join(out, "lexer.raw.wasm");
if (!process.argv.includes("--no-cargo")) {
  execSync("cargo build --release", { cwd: crate, stdio: "inherit", env: { ...process.env, CARGO_PROFILE_RELEASE_STRIP: "false" } });
  writeFileSync(rawFile, readFileSync(join(crate, "target/wasm32-unknown-unknown/release/fastlexer.wasm")));
}
let lexer = readFileSync(rawFile);
console.log("lexer: cargo", lexer.length, "bytes");
if (!process.argv.includes("--no-opt")) {
  const mod = binaryen.readBinary(lexer);
  const names = [];
  for (let i = 0; i < mod.getNumFunctions(); i++) names.push(binaryen.getFunctionInfo(mod.getFunctionByIndex(i)).name);
  const cold = COLD.map((c) => names.find((n) => n.includes(c)) ?? (() => { throw new Error(`no function ${c} in the cargo output`); })());
  lexer = optimize(mod, LEXER_FEATURES, 3, 0, cold);
  console.log("lexer: wasm-opt -O3", lexer.length, "bytes");
}
writeFileSync(join(out, "lexer.wasm"), lexer);

// ---- copy8(string, from, to, base, 255, cca): the string's UTF-16 code
// units from..to into memory at base + index, one byte each: Latin-1 as is and
// everything above as 0xff (the lexer only tells apart ASCII and U+00A0).
// 16 units per iteration: 4 packed per i64, 8 per v128, narrowed with SIMD.
// Two ways to read the string, both 1.5-4x faster than TextEncoder.encodeInto
// in Chromium once V8 has optimized them:
// * cca 1: the wasm:js-string charCodeAt builtin per unit (V8's optimized
//   code inlines it; the fastest). V8's baseline code (Liftoff, which a
//   function runs until it has been used for a while) calls it out of line,
//   ~10x slower than encodeInto.
// * cca 0: intoCharCodeArray (bulk) into a reused GC array, 64K units at a
//   time, then array.get: about as fast in baseline code as optimized.
// The JS side starts with 0 and switches to 1 once enough went through for
// V8 to have optimized the function (both paths are in one function, so
// either counts). (255 is a parameter so that the splat is not a constant,
// which V8 would rebuild in every iteration.)
const CHUNK = 65536;
const cca = (k) => `(i64.extend_i32_u (call $cca (local.get $s) (i32.add (local.get $i) (i32.const ${k}))))`;
const aget = (k) => `(i64.extend_i32_u (array.get_u $a16 (local.get $a) (i32.add (local.get $j) (i32.const ${k}))))`;
const pack4 = (f, o) =>
  `(i64.or (i64.or ${f(o)} (i64.shl ${f(o + 1)} (i64.const 16))) (i64.or (i64.shl ${f(o + 2)} (i64.const 32)) (i64.shl ${f(o + 3)} (i64.const 48))))`;
const narrow16 = (f) => `(i8x16.narrow_i16x8_u
          (i16x8.min_u (i64x2.replace_lane 1 (i64x2.splat ${pack4(f, 0)}) ${pack4(f, 4)}) (local.get $ff))
          (i16x8.min_u (i64x2.replace_lane 1 (i64x2.splat ${pack4(f, 8)}) ${pack4(f, 12)}) (local.get $ff)))`;
const clamp = (c) => `(select (local.get $ffp) ${c} (i32.gt_u ${c} (local.get $ffp)))`;
const copyWat = `(module
  (type $a16 (array (mut i16)))
  (import "wasm:js-string" "charCodeAt" (func $cca (param externref i32) (result i32)))
  (import "wasm:js-string" "substring" (func $sub (param externref i32 i32) (result (ref extern))))
  (import "wasm:js-string" "intoCharCodeArray" (func $into (param externref (ref null $a16) i32) (result i32)))
  (import "env" "memory" (memory 0))
  (global $buf (mut (ref null $a16)) (ref.null $a16))
  (func (export "copy8") (param $s externref) (param $i i32) (param $to i32) (param $base i32) (param $ffp i32) (param $usecca i32)
    (local $n16 i32) (local $ff v128) (local $c i32) (local $a (ref null $a16)) (local $j i32) (local $n i32) (local $d i32) (local $from i32)
    (local.set $ff (i16x8.splat (local.get $ffp)))
    (if (local.get $usecca) (then
      (local.set $from (local.get $i))
      (local.set $n16 (i32.add (local.get $i) (i32.and (i32.sub (local.get $to) (local.get $i)) (i32.const -16))))
      (block $done (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $n16)))
        (v128.store (i32.add (local.get $base) (local.get $i)) ${narrow16(cca)})
        (local.set $i (i32.add (local.get $i) (i32.const 16)))
        (br $l)))
      ;; the rest: one more block of 16 ending at to (rewrites some of the
      ;; last one with the same bytes) if there are 16, else one by one
      (if (i32.and (i32.lt_u (local.get $i) (local.get $to)) (i32.ge_u (i32.sub (local.get $to) (local.get $from)) (i32.const 16))) (then
        (local.set $i (i32.sub (local.get $to) (i32.const 16)))
        (v128.store (i32.add (local.get $base) (local.get $i)) ${narrow16(cca)})
        (return)))
      (block $done2 (loop $l2
        (br_if $done2 (i32.ge_u (local.get $i) (local.get $to)))
        (local.set $c (call $cca (local.get $s) (local.get $i)))
        (i32.store8 (i32.add (local.get $base) (local.get $i)) ${clamp("(local.get $c)")})
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l2)))
      (return)))
    (if (ref.is_null (global.get $buf)) (then (global.set $buf (array.new_default $a16 (i32.const ${CHUNK})))))
    (local.set $a (global.get $buf))
    (block $cdone (loop $chunks
      (br_if $cdone (i32.ge_u (local.get $i) (local.get $to)))
      (local.set $n (i32.sub (local.get $to) (local.get $i)))
      (if (i32.gt_u (local.get $n) (i32.const ${CHUNK})) (then (local.set $n (i32.const ${CHUNK}))))
      (drop (call $into (call $sub (local.get $s) (local.get $i) (i32.add (local.get $i) (local.get $n))) (local.get $a) (i32.const 0)))
      (local.set $d (i32.add (local.get $base) (local.get $i)))
      (local.set $j (i32.const 0))
      (local.set $n16 (i32.and (local.get $n) (i32.const -16)))
      (block $pd (loop $pl
        (br_if $pd (i32.ge_u (local.get $j) (local.get $n16)))
        (v128.store (i32.add (local.get $d) (local.get $j)) ${narrow16(aget)})
        (local.set $j (i32.add (local.get $j) (i32.const 16)))
        (br $pl)))
      (block $td (loop $tl
        (br_if $td (i32.ge_u (local.get $j) (local.get $n)))
        (local.set $c (array.get_u $a16 (local.get $a) (local.get $j)))
        (i32.store8 (i32.add (local.get $d) (local.get $j)) ${clamp("(local.get $c)")})
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $tl)))
      (local.set $i (i32.add (local.get $i) (local.get $n)))
      (br $chunks))))
)`;
const copy8 = optimize(binaryen.parseText(copyWat), F.ReferenceTypes | F.GC | F.MutableGlobals | F.SignExt | F.SIMD128, 3, 0);
console.log("copy8:", copy8.length, "bytes");
writeFileSync(join(out, "copy8.wasm"), copy8);

// ---- the decoder of the text
const decoderMod = binaryen.parseText(readFileSync(join(crate, "decode.wat"), "utf8"));
const decoder = optimize(decoderMod, F.MVP, 2, 2);
console.log("decoder:", decoder.length, "bytes");

// the generated end of index.mts (everything after MARK): the modules as
// base64 (Buffer decodes that in microseconds in Node; the decoder of the
// text costs ~0.25 ms)
const MARK = "// generated by build.mjs (everything below this line)\n";
const fn = (name, doc, value) => `/** ${doc} */\nfunction ${name}(): string {\n  return ${JSON.stringify(value)};\n}\n`;
const tsFile = join(here, "index.mts");
const ts = readFileSync(tsFile, "utf8");
if (!ts.includes(MARK)) throw new Error("index.mts: marker line not found");
writeFileSync(
  tsFile,
  ts.slice(0, ts.indexOf(MARK) + MARK.length) +
    fn("WASM", "the lexer (rust/), base64 (browser.mjs: as text, see build.mjs)", lexer.toString("base64")) +
    fn("COPY8", "the string-copy module (build.mjs), base64 (browser.mjs: as text)", copy8.toString("base64")) +
    fn("DECODER", "browser.mjs: the decoder of the text (rust/decode.wat), base64", ""),
);
execSync(`"${process.execPath}" ${JSON.stringify(join(here, "../../tools/ts-build.mjs"))}`, { stdio: "inherit" });

// browser.mjs: index.mjs with BROWSER = true (esbuild folds it and drops the
// Node.js paths) and the modules as text
const js = readFileSync(join(here, "index.mjs"), "utf8");
const flag = /const BROWSER\s*= false;/;
if (!flag.test(js) || !js.includes(MARK)) throw new Error("index.mjs: BROWSER flag or marker line not found");
const texts = { WASM: encodeWasm(lexer), COPY8: encodeWasm(copy8), DECODER: decoder.toString("base64") };
console.log("text:", Object.entries(texts).map(([k, t]) => `${k} ${t.length}`).join(", "), "characters");
let browser = js.slice(0, js.indexOf(MARK)).replace(flag, "const BROWSER = true;");
browser += Object.entries(texts).map(([n, t]) => `function ${n}() {\n  return ${JSON.stringify(t)};\n}\n`).join("");
browser = (await transform(browser, { format: "esm", minifySyntax: true, target: "es2022", legalComments: "none" })).code;
writeFileSync(join(here, "browser.mjs"), `// generated by build.mjs from index.mts (with BROWSER = true) — do not edit\n${browser}`);
console.log("wrote index.mts, index.mjs, browser.mjs");

// both modules decode their wasm to what was built, and parse
const { withHooks } = await import(pathToFileURL(join(here, "test/hooks.mjs")).href);
for (const file of ["index.mjs", "browser.mjs"]) {
  const L = await withHooks(file);
  for (const [name, bytes] of [["WASM", lexer], ["COPY8", copy8]])
    if (Buffer.compare(Buffer.from(file === "index.mjs" ? Buffer.from(L[name](), "base64") : L.decode(L[name]())), bytes) !== 0)
      throw new Error(`${file}: ${name}() does not decode to the module`);
  L.initSync();
  if (JSON.stringify(L.parse("import 'a'")[0].map((i) => i.n)) !== '["a"]') throw new Error(`${file} does not parse`);
}
