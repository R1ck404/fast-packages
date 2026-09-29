(module
 ;; Decoder of the text the lexer's wasm is embedded as (see build.mjs and
 ;; decode in index.mts; build.mjs assembles this with binaryen). Its memory
 ;; holds the tables and the text.
 (memory (export "m") 1)
 ;; Decodes the text (n ASCII bytes at 1024) in place and returns the length
 ;; of the bytes. Tables: 0 byte (or 256 + pair base) of each character
 ;; (i32), 512 alphabet index of each character, 640 the alphabet, 768 the
 ;; bytes coded as pairs.
 (func (export "d") (param $n i32) (result i32)
  (local $c i32) (local $k i32) (local $b i32) (local $v i32) (local $i i32) (local $o i32)
  ;; the alphabet: printable ASCII without " $ ' < \ `
  (local.set $c (i32.const 32))
  (loop $a
   (if (i32.eqz (i32.or (i32.or (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 36)))
                                (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const 60))))
                        (i32.or (i32.eq (local.get $c) (i32.const 92)) (i32.eq (local.get $c) (i32.const 96)))))
    (then
     (i32.store8 offset=512 (local.get $c) (local.get $k))
     (i32.store8 offset=640 (local.get $k) (local.get $c))
     (local.set $k (i32.add (local.get $k) (i32.const 1)))))
   (br_if $a (i32.lt_u (local.tee $c (i32.add (local.get $c) (i32.const 1))) (i32.const 127))))
  ;; its first two characters start a pair: 256 + the pair base
  (i32.store (i32.shl (i32.load8_u offset=640 (i32.const 0)) (i32.const 2)) (i32.const 256))
  (i32.store (i32.shl (i32.load8_u offset=641 (i32.const 0)) (i32.const 2)) (i32.const 345))
  ;; the header: byte b is one character if bit b & 3 of hex digit b >> 2 is set
  (local.set $k (i32.const 2))
  (loop $h
   (local.set $v (i32.load8_u offset=1024 (i32.shr_u (local.get $b) (i32.const 2))))
   (local.set $v (select (i32.sub (local.get $v) (i32.const 87)) (i32.sub (local.get $v) (i32.const 48)) (i32.gt_u (local.get $v) (i32.const 57))))
   (if (i32.and (i32.shr_u (local.get $v) (i32.and (local.get $b) (i32.const 3))) (i32.const 1))
    (then
     (i32.store (i32.shl (i32.load8_u offset=640 (local.get $k)) (i32.const 2)) (local.get $b))
     (local.set $k (i32.add (local.get $k) (i32.const 1))))
    (else
     (i32.store8 offset=768 (local.get $i) (local.get $b))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))))
   (br_if $h (i32.lt_u (local.tee $b (i32.add (local.get $b) (i32.const 1))) (i32.const 256))))
  ;; the bytes
  (local.set $i (i32.const 1088))
  (local.set $o (i32.const 1024))
  (local.set $n (i32.add (local.get $n) (i32.const 1024)))
  (block $done
   (loop $l
    (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
    (local.set $v (i32.load (i32.shl (i32.load8_u (local.get $i)) (i32.const 2))))
    (if (i32.gt_u (local.get $v) (i32.const 255))
     (then
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      ;; two[v - 256 + index of the next character]
      (local.set $v (i32.load8_u offset=512 (i32.add (local.get $v) (i32.load8_u offset=512 (i32.load8_u (local.get $i))))))))
    (i32.store8 (local.get $o) (local.get $v))
    (local.set $o (i32.add (local.get $o) (i32.const 1)))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br $l)))
  (i32.sub (local.get $o) (i32.const 1024))))
