(module
 ;; scrypt's ROMix (RFC 7914) with SIMD salsa20/8 (build.mjs assembles it
 ;; with binaryen). A fresh instance per scrypt() call, whose memory the JS
 ;; side grows for B (p blocks), V (N blocks) and a temporary block, so a
 ;; large N leaves no large memory behind. At 0 (written by the JS side):
 ;; N, 128r (bytes per block), B, V, T, total.
 (memory (export "m") 1)
 ;; BlockMix of $in into $out (not overlapping): X = the last 64-byte block
 ;; of $in; for each block i: X = salsa20/8(X ^ in[i]), to out[i / 2] (even
 ;; i) or out[r + i / 2] (odd i). X is in a0..d0, the words of each block in
 ;; the diagonal order (word 5i mod 16 at position i; the JS side permutes
 ;; B in and out): each salsa half-round is four vector
 ;; quarter-rounds and three lane rotations (the row rounds are column
 ;; rounds with b and d swapped).
 (func $mix (param $in i32) (param $out i32)
  (local $i i32) (local $bs i32) (local $p i32) (local $k i32)
  (local $a v128) (local $b v128) (local $c v128) (local $d v128) (local $a0 v128) (local $b0 v128) (local $c0 v128) (local $d0 v128) (local $t v128)
  (local.set $a0 (v128.load (local.tee $p (i32.sub (i32.add (local.get $in) (local.tee $bs (i32.load (i32.const 4)))) (i32.const 64)))))
  (local.set $b0 (v128.load offset=16 (local.get $p)))
  (local.set $c0 (v128.load offset=32 (local.get $p)))
  (local.set $d0 (v128.load offset=48 (local.get $p)))
  (loop $l
   (local.set $a (local.tee $a0 (v128.xor (local.get $a0) (v128.load (local.tee $p (i32.add (local.get $in) (i32.shl (local.get $i) (i32.const 6))))))))
   (local.set $b (local.tee $b0 (v128.xor (local.get $b0) (v128.load offset=16 (local.get $p)))))
   (local.set $c (local.tee $c0 (v128.xor (local.get $c0) (v128.load offset=32 (local.get $p)))))
   (local.set $d (local.tee $d0 (v128.xor (local.get $d0) (v128.load offset=48 (local.get $p)))))
   (local.set $k (i32.const 8))
   (loop $r
    ;; half-rounds: columns, and with b and d swapped rows
   (local.set $b (v128.xor (local.get $b) (v128.or (i32x4.shl (local.tee $t (i32x4.add (local.get $a) (local.get $d))) (i32.const 7)) (i32x4.shr_u (local.get $t) (i32.const 25)))))
   (local.set $c (v128.xor (local.get $c) (v128.or (i32x4.shl (local.tee $t (i32x4.add (local.get $b) (local.get $a))) (i32.const 9)) (i32x4.shr_u (local.get $t) (i32.const 23)))))
   (local.set $d (v128.xor (local.get $d) (v128.or (i32x4.shl (local.tee $t (i32x4.add (local.get $c) (local.get $b))) (i32.const 13)) (i32x4.shr_u (local.get $t) (i32.const 19)))))
   (local.set $a (v128.xor (local.get $a) (v128.or (i32x4.shl (local.tee $t (i32x4.add (local.get $d) (local.get $c))) (i32.const 18)) (i32x4.shr_u (local.get $t) (i32.const 14)))))
   (local.set $b (i8x16.shuffle 12 13 14 15 0 1 2 3 4 5 6 7 8 9 10 11 (local.get $b) (local.get $b)))
   (local.set $c (i8x16.shuffle 8 9 10 11 12 13 14 15 0 1 2 3 4 5 6 7 (local.get $c) (local.get $c)))
   (local.set $d (i8x16.shuffle 4 5 6 7 8 9 10 11 12 13 14 15 0 1 2 3 (local.get $d) (local.get $d)))
    ;; b <-> d: the rows are then the same code
   (local.set $t (local.get $b))
   (local.set $b (local.get $d))
   (local.set $d (local.get $t))
    (br_if $r (local.tee $k (i32.sub (local.get $k) (i32.const 1)))))
   (v128.store (local.tee $p (i32.add (local.get $out) (i32.add (i32.shl (i32.shr_u (local.get $i) (i32.const 1)) (i32.const 6))
                                       (select (i32.shr_u (local.get $bs) (i32.const 1)) (i32.const 0) (i32.and (local.get $i) (i32.const 1))))))
    (local.tee $a0 (i32x4.add (local.get $a) (local.get $a0))))
   (v128.store offset=16 (local.get $p) (local.tee $b0 (i32x4.add (local.get $b) (local.get $b0))))
   (v128.store offset=32 (local.get $p) (local.tee $c0 (i32x4.add (local.get $c) (local.get $c0))))
   (v128.store offset=48 (local.get $p) (local.tee $d0 (i32x4.add (local.get $d) (local.get $d0))))
   (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.shr_u (local.get $bs) (i32.const 6))))))
 ;; s(pi, s, e): steps [s, e) of ROMix on block pi of B; steps 0 .. N-2 fill
 ;; V (step 0 first copies B[pi] to V[0]), step N-1 mixes V[N-1] into B[pi],
 ;; steps N .. 2N-1 are the second loop (one step = one BlockMix)
 (func (export "s") (param $pi i32) (param $s i32) (param $e i32)
  (local $b i32) (local $bs i32) (local $n i32) (local $v i32) (local $t i32) (local $k i32) (local $i i32)
  (local.set $bs (i32.load (i32.const 4)))
  (local.set $n (i32.sub (i32.load (i32.const 0)) (i32.const 1)))
  (local.set $v (i32.load (i32.const 12)))
  (local.set $t (i32.load (i32.const 16)))
  (local.set $b (i32.add (i32.load (i32.const 8)) (i32.mul (local.get $pi) (local.get $bs))))
  (block $done
   (loop $l
    (br_if $done (i32.ge_u (local.get $s) (local.get $e)))
    (local.set $k (i32.add (local.get $v) (i32.mul (local.get $s) (local.get $bs))))
    (if (i32.lt_u (local.get $s) (local.get $n))
     (then
      (if (i32.eqz (local.get $s)) (then (memory.copy (local.get $v) (local.get $b) (local.get $bs))))
      (call $mix (local.get $k) (i32.add (local.get $k) (local.get $bs))))
     (else
      (if (i32.eq (local.get $s) (local.get $n))
       (then (call $mix (local.get $k) (local.get $b)))
       (else
        ;; T = B ^ V[Integrify(B) mod N]
        (local.set $k (i32.add (local.get $v) (i32.mul (i32.and (i32.load (i32.sub (i32.add (local.get $b) (local.get $bs)) (i32.const 64))) (local.get $n)) (local.get $bs))))
        (local.set $i (i32.const 0))
        (loop $x
         (v128.store (i32.add (local.get $t) (local.get $i)) (v128.xor (v128.load (i32.add (local.get $b) (local.get $i))) (v128.load (i32.add (local.get $k) (local.get $i)))))
         (br_if $x (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 16))) (local.get $bs))))
        (call $mix (local.get $t) (local.get $b))))))
    (local.set $s (i32.add (local.get $s) (i32.const 1)))
    (br $l))))
 ;; w(): zeroes everything i() allocated
 (func (export "w")
  (memory.fill (i32.load (i32.const 8)) (i32.const 0) (i32.load (i32.const 20))))
)
