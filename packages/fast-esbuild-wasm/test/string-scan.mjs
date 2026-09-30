import assert from 'node:assert/strict';
import esbuild from 'esbuild';
import { fastTransform } from '../src/transform.mjs';
import { setStderr } from '../src/logger.mjs';
import { classifyTransform } from './flags.mjs';
setStderr(() => {});
let checks = 0;
function reference(source, minify) {
  try { return [esbuild.transformSync(source, { loader:'js', format:'cjs', minify, logLevel:'silent' }), null]; }
  catch (e) { return [null, e]; }
}
function candidate(source, minify) {
  const out = fastTransform(['--loader=js','--format=cjs','--log-level=silent',...(minify?['--minify']:[])], source);
  return out;
}
// Compare the transform result including errors using the same helper as the
// differential suite; prefixes straddle the native tail scan's boundary.
for (const size of [0,127,128,129,255,1024,65536]) for (const quote of ['"',"'",'`'])
for (const tail of ['', '\\n', '\\u0061', '\\u{1f600}', '\\xGG', '\\\n', '\n', '\r\n', '\u2028', '\u2029', '\0', '\ud800', '😀', '$', '${1}', 'end'])
for (const minify of [false,true]) {
  const source = `export const value=${quote}${'a'.repeat(size)}${tail}${quote};`;
  const [ref,error] = reference(source,minify), b = candidate(source,minify);
  const [category,diff] = classifyTransform(ref,error,b);
  assert.ok(category === 'ok' || category === 'okError', `size=${size} quote=${quote} tail=${JSON.stringify(tail)}: ${category} ${diff}`);
  checks++;
}
console.log(`string scan: ${checks} checks`);
