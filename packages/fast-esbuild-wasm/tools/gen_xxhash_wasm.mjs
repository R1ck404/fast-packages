// Generates the WebAssembly XXH64 kernel used by src/xxhash.mts (one-shot
// XXH64 with seed 0 over memory[8, 8 + n), the 64-bit result stored at
// memory[0, 8) little-endian) and prints it as base64.
// usage: node tools/gen_xxhash_wasm.mjs
import binaryen from "binaryen";

const P1 = "0x9E3779B185EBCA87";
const P2 = "0xC2B2AE3D27D4EB4F";
const P3 = "0x165667B19E3779F9";
const P4 = "0x85EBCA77C2B2AE63";
const P5 = "0x27D4EB2F165667C5";

const wat = `
(module
  (memory (export "memory") 1)
  (func $round (param $acc i64) (param $input i64) (result i64)
    (i64.mul
      (i64.rotl (i64.add (local.get $acc) (i64.mul (local.get $input) (i64.const ${P2}))) (i64.const 31))
      (i64.const ${P1})))
  (func $merge (param $acc i64) (param $val i64) (result i64)
    (i64.add
      (i64.mul (i64.xor (local.get $acc) (call $round (i64.const 0) (local.get $val))) (i64.const ${P1}))
      (i64.const ${P4})))
  (func (export "xxh64") (param $n i32)
    (local $p i32) (local $end i32) (local $limit i32)
    (local $v1 i64) (local $v2 i64) (local $v3 i64) (local $v4 i64) (local $h i64)
    (local.set $p (i32.const 8))
    (local.set $end (i32.add (local.get $p) (local.get $n)))
    (if (i32.ge_u (local.get $n) (i32.const 32))
      (then
        (local.set $limit (i32.sub (local.get $end) (i32.const 32)))
        (local.set $v1 (i64.add (i64.const ${P1}) (i64.const ${P2})))
        (local.set $v2 (i64.const ${P2}))
        (local.set $v3 (i64.const 0))
        (local.set $v4 (i64.sub (i64.const 0) (i64.const ${P1})))
        (loop $blocks
          (local.set $v1 (call $round (local.get $v1) (i64.load (local.get $p))))
          (local.set $v2 (call $round (local.get $v2) (i64.load offset=8 (local.get $p))))
          (local.set $v3 (call $round (local.get $v3) (i64.load offset=16 (local.get $p))))
          (local.set $v4 (call $round (local.get $v4) (i64.load offset=24 (local.get $p))))
          (local.set $p (i32.add (local.get $p) (i32.const 32)))
          (br_if $blocks (i32.le_u (local.get $p) (local.get $limit))))
        (local.set $h
          (i64.add
            (i64.add (i64.rotl (local.get $v1) (i64.const 1)) (i64.rotl (local.get $v2) (i64.const 7)))
            (i64.add (i64.rotl (local.get $v3) (i64.const 12)) (i64.rotl (local.get $v4) (i64.const 18)))))
        (local.set $h (call $merge (local.get $h) (local.get $v1)))
        (local.set $h (call $merge (local.get $h) (local.get $v2)))
        (local.set $h (call $merge (local.get $h) (local.get $v3)))
        (local.set $h (call $merge (local.get $h) (local.get $v4))))
      (else
        (local.set $h (i64.const ${P5}))))
    (local.set $h (i64.add (local.get $h) (i64.extend_i32_u (local.get $n))))
    (block $done8
      (loop $words
        (br_if $done8 (i32.gt_u (i32.add (local.get $p) (i32.const 8)) (local.get $end)))
        (local.set $h (i64.xor (local.get $h) (call $round (i64.const 0) (i64.load (local.get $p)))))
        (local.set $h (i64.add (i64.mul (i64.rotl (local.get $h) (i64.const 27)) (i64.const ${P1})) (i64.const ${P4})))
        (local.set $p (i32.add (local.get $p) (i32.const 8)))
        (br $words)))
    (if (i32.le_u (i32.add (local.get $p) (i32.const 4)) (local.get $end))
      (then
        (local.set $h (i64.xor (local.get $h) (i64.mul (i64.load32_u (local.get $p)) (i64.const ${P1}))))
        (local.set $h (i64.add (i64.mul (i64.rotl (local.get $h) (i64.const 23)) (i64.const ${P2})) (i64.const ${P3})))
        (local.set $p (i32.add (local.get $p) (i32.const 4)))))
    (block $done1
      (loop $bytes
        (br_if $done1 (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $h (i64.xor (local.get $h) (i64.mul (i64.load8_u (local.get $p)) (i64.const ${P5}))))
        (local.set $h (i64.mul (i64.rotl (local.get $h) (i64.const 11)) (i64.const ${P1})))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $bytes)))
    (local.set $h (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 33))))
    (local.set $h (i64.mul (local.get $h) (i64.const ${P2})))
    (local.set $h (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 29))))
    (local.set $h (i64.mul (local.get $h) (i64.const ${P3})))
    (local.set $h (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 32))))
    (i64.store (i32.const 0) (local.get $h)))
)`;

const mod = binaryen.parseText(wat);
if (!mod.validate()) throw new Error("invalid module");
binaryen.setOptimizeLevel(3);
mod.optimize();
const bytes = mod.emitBinary();
console.log(Buffer.from(bytes).toString("base64"));
console.error(bytes.length + " bytes");
