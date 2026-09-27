#!/bin/sh
# Every package's own test suite on the final tree, one after another.
cd "$(dirname "$0")/.." || exit 1
out=verify/out/suites
mkdir -p $out
run() { name=$1; shift; start=$(date +%s); "$@" > $out/$name.txt 2>&1; code=$?; echo "$name exit=$code $(( $(date +%s) - start ))s | $(tail -n 3 $out/$name.txt | tr '\n' ' ' | cut -c1-220)"; }
PNPM=../Nodepod/node_modules/.pnpm
run pako-equiv node fast-pako/test/equiv.mjs
run pako-fuzz node fast-pako/test/fuzz.mjs
run pako-fuzz-s2 node fast-pako/test/fuzz.mjs --seed=77
run pako-corpus node fast-pako/test/corpus.mjs
run acorn-diff node --stack-size=4000 fast-acorn/test/diff.mjs --locs --comments --nodepod
run acorn-expr node fast-acorn/test/expr-diff.mjs
run acorn-comments node fast-acorn/test/comments.mjs
run acorn-options node fast-acorn/test/options.mjs
run acorn-jsx node --stack-size=4000 fast-acorn/test/jsx-diff.mjs
run acorn-override node --stack-size=4000 fast-acorn/test/override-diff.mjs
run acorn-error node --stack-size=4000 fast-acorn/test/error-diff.mjs
run acorn-vendor node --stack-size=4000 fast-acorn/test/acorn-diff.mjs
run eml-diff node fast-es-module-lexer/test/diff.mjs
run eml-edge node fast-es-module-lexer/test/edge.mjs
run eml-browser node fast-es-module-lexer/test/browser.mjs
run br-api node fast-brotli-wasm/test/api.mjs
run br-compress node fast-brotli-wasm/test/compress-equiv.mjs
run br-compress-pnpm node fast-brotli-wasm/test/compress-equiv.mjs --dir=$PNPM --max=1500
run br-stress node fast-brotli-wasm/test/compress-stress.mjs --n=600 --seed=9
run br-decode node fast-brotli-wasm/test/decode-equiv.mjs
run br-stream node fast-brotli-wasm/test/stream-equiv.mjs
run esb-diff node fast-esbuild-wasm/test/diff.mjs
run esb-bail node fast-esbuild-wasm/test/bailreasons.mjs
run esb-smoke node fast-esbuild-wasm/test/smoke.mjs
run esb-api node fast-esbuild-wasm/test/api.mjs
run esb-fuzz sh -c "cd fast-esbuild-wasm && node test/fuzz.mjs --n 3000 --seed 999"
