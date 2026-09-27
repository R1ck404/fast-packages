// Build the wasm core and embed it (base64) into lexer.wasm.mjs, together
// with the small string-copy module (wasm JS-string builtins, see index.mjs).
// usage: node fast-es-module-lexer/build.mjs [--no-opt]
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const crate = join(here, "rust");
execSync("cargo build --release", { cwd: crate, stdio: "inherit" });
let bytes = readFileSync(join(crate, "target/wasm32-unknown-unknown/release/fastlexer.wasm"));
console.log("raw wasm:", bytes.length, "bytes");

const { default: binaryen } = await import("binaryen");
// only what rustc was asked for (plus its defaults): no newer encodings that
// some browsers cannot load
const F = binaryen.Features;
const features =
  F.SIMD128 | F.BulkMemory | F.BulkMemoryOpt | F.SignExt | F.MutableGlobals | F.NontrappingFPToInt | F.Multivalue | F.ReferenceTypes;

if (!process.argv.includes("--no-opt")) {
  const mod = binaryen.readBinary(bytes);
  mod.setFeatures(features);
  binaryen.setOptimizeLevel(3);
  binaryen.setShrinkLevel(0);
  mod.optimize();
  if (!mod.validate()) throw new Error("wasm-opt output does not validate");
  const out = mod.emitBinary();
  console.log("wasm-opt -O3:", out.length, "bytes");
  bytes = Buffer.from(out);
}

// copy8(string, from, to, base, 255, cca): the string's UTF-16 code units
// from..to into memory at base + index, one byte each: Latin-1 as is and
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
const cm = binaryen.parseText(copyWat);
cm.setFeatures(F.ReferenceTypes | F.GC | F.MutableGlobals | F.SignExt | F.SIMD128);
if (!cm.validate()) throw new Error("copy module does not validate");
binaryen.setOptimizeLevel(3);
cm.optimize();
const copyBytes = Buffer.from(cm.emitBinary());
console.log("copy8 module:", copyBytes.length, "bytes");

writeFileSync(
  join(here, "lexer.wasm.mjs"),
  `// generated by build.mjs — do not edit\nexport default ${JSON.stringify(bytes.toString("base64"))};\n` +
    `export const copy8 = ${JSON.stringify(copyBytes.toString("base64"))};\n`,
);
console.log("wrote lexer.wasm.mjs");
