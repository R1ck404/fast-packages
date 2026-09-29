#!/bin/sh
# Every package's own test suite on the final tree, one after another.
cd "$(dirname "$0")/.." || exit 1
out=verify/out/suites
mkdir -p $out
run() { name=$1; shift; start=$(date +%s); "$@" > $out/$name.txt 2>&1; code=$?; echo "$name exit=$code $(( $(date +%s) - start ))s | $(tail -n 3 $out/$name.txt | tr '\n' ' ' | cut -c1-220)"; }
PNPM=../Nodepod/node_modules/.pnpm
run pako-types node packages/fast-pako/test/types.mjs
run pako-load node packages/fast-pako/test/load.mjs
run pako-equiv node packages/fast-pako/test/equiv.mjs
run pako-fuzz node packages/fast-pako/test/fuzz.mjs
run pako-fuzz-s2 node packages/fast-pako/test/fuzz.mjs --seed=77
run pako-exotic node packages/fast-pako/test/exotic.mjs
run pako-exotic-s2 node packages/fast-pako/test/exotic.mjs --seed=77
run pako-corpus node packages/fast-pako/test/corpus.mjs
run acorn-bundle node packages/fast-acorn/test/bundle.mjs
run acorn-differences node packages/fast-acorn/test/differences.mjs
run acorn-diff node --stack-size=4000 packages/fast-acorn/test/diff.mjs --locs --comments --nodepod
run acorn-expr node packages/fast-acorn/test/expr-diff.mjs
run acorn-comments node packages/fast-acorn/test/comments.mjs
run acorn-options node packages/fast-acorn/test/options.mjs
run acorn-jsx node --stack-size=4000 packages/fast-acorn/test/jsx-diff.mjs
run acorn-override node --stack-size=4000 packages/fast-acorn/test/override-diff.mjs
run acorn-error node --stack-size=4000 packages/fast-acorn/test/error-diff.mjs
run acorn-generic node --stack-size=4000 packages/fast-acorn/test/acorn-diff.mjs
run acorn-versions node --stack-size=4000 packages/fast-acorn/test/versions.mjs
run acorn-plugins node --stack-size=4000 packages/fast-acorn/test/plugins.mjs
run eml-diff node packages/fast-es-module-lexer/test/diff.mjs
run eml-diff-browser node packages/fast-es-module-lexer/test/diff.mjs --file=browser.mjs --quick
run eml-edge node packages/fast-es-module-lexer/test/edge.mjs
run eml-edge-browser node packages/fast-es-module-lexer/test/edge.mjs --file=browser.mjs
run eml-bundle node packages/fast-es-module-lexer/test/bundle.mjs
run eml-browser node packages/fast-es-module-lexer/test/browser.mjs
run br-api node packages/fast-brotli-wasm/test/api.mjs
run br-options node packages/fast-brotli-wasm/test/options.mjs
run br-tables node packages/fast-brotli-wasm/test/tables.mjs
run br-compress node packages/fast-brotli-wasm/test/compress-equiv.mjs
run br-compress-pnpm node packages/fast-brotli-wasm/test/compress-equiv.mjs --dir=$PNPM --max=1500
run br-stress node packages/fast-brotli-wasm/test/compress-stress.mjs --n=600 --seed=9
run br-decode node packages/fast-brotli-wasm/test/decode-equiv.mjs
run br-stream node packages/fast-brotli-wasm/test/stream-equiv.mjs
run esb-wasm-diff node packages/fast-esbuild-wasm/test/wasm-diff.mjs --limit 3000
run esb-diff node packages/fast-esbuild-wasm/test/diff.mjs
run esb-css-diff node packages/fast-esbuild-wasm/test/css-diff.mjs
run esb-defines node packages/fast-esbuild-wasm/test/defines.mjs
run esb-messages node packages/fast-esbuild-wasm/test/messages.mjs
run esb-bail node packages/fast-esbuild-wasm/test/bailreasons.mjs
run esb-smoke node packages/fast-esbuild-wasm/test/smoke.mjs
run esb-api node packages/fast-esbuild-wasm/test/api.mjs
run esb-fuzz sh -c "cd packages/fast-esbuild-wasm && node test/fuzz.mjs --n 3000 --seed 999"
run esb-css-fuzz sh -c "cd packages/fast-esbuild-wasm && node test/css-fuzz.mjs --n 3000 --seed 999"
run esb-browser node packages/fast-esbuild-wasm/test/browser.mjs
run esb-build-plugins node packages/fast-esbuild-wasm/test/build-plugins.mjs
run esb-build-diff node packages/fast-esbuild-wasm/test/build-diff.mjs
run esb-build-diff-fs node packages/fast-esbuild-wasm/test/build-diff.mjs --fs real
run esb-resolve-diff node packages/fast-esbuild-wasm/test/resolve-diff.mjs
run nh-files node packages/fast-noble-hashes/test/files.mjs
run nh-bundle node packages/fast-noble-hashes/test/bundle.mjs
run nh-diff node packages/fast-noble-hashes/test/diff.mjs
run nh-diff-cjs node packages/fast-noble-hashes/test/diff.mjs --cjs
run nh-diff-s2 node packages/fast-noble-hashes/test/diff.mjs --seed 777
run nh-nowasm node packages/fast-noble-hashes/test/nowasm.mjs
run nh-browser node packages/fast-noble-hashes/test/browser.mjs
run nh-mutate node packages/fast-noble-hashes/tools/mutate.mjs
