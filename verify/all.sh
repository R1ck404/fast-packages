#!/bin/sh
# Full independent verification of the fast packages (current working tree).
cd "$(dirname "$0")/.." || exit 1
mkdir -p verify/out
SEED=${SEED:-11} node verify/verify-pako.mjs 3000 > verify/out/pako.txt 2>&1; echo "pako exit $?"
SEED=${SEED:-11} node --stack-size=4000 verify/verify-acorn.mjs 2500 3243 > verify/out/acorn.txt 2>&1; echo "acorn exit $?"
SEED=${SEED:-11} node verify/verify-eml.mjs 20000 > verify/out/eml.txt 2>&1; echo "eml exit $?"
SEED=${SEED:-11} node verify/verify-brotli.mjs 1500 > verify/out/brotli.txt 2>&1; echo "brotli exit $?"
SEED=${SEED:-11} node verify/verify-esbuild.mjs 2000 1500 > verify/out/esbuild.txt 2>&1; echo "esbuild exit $?"
SEED=${SEED:-11} node verify/verify-browser.mjs 300 > verify/out/browser.txt 2>&1; echo "browser exit $?"
SEED=${SEED:-11} node verify/verify-toplevel-min.mjs 1500 > verify/out/toplevel-min.txt 2>&1; echo "toplevel-min exit $?"
grep -h "checks:" verify/out/*.txt
