import assert from 'node:assert/strict';
import * as F from '../index.mjs';
import * as O from 'es-module-lexer';
await Promise.all([F.init,O.init]);
const source='import x from "\\u0061"; export { x as "named" };\n// '+ 'padding '.repeat(1000);
const want=O.parse(source);
const first=F.parse(source);
assert.deepEqual(first,want);
first[0][0].n='mutated';first[0][0].extra=true;first[1].length=0;first[2]=!first[2];
const next=F.parse(source);
assert.deepEqual(next,want);
assert.notEqual(first,next);assert.notEqual(first[0],next[0]);
assert.deepEqual(F.parse(source+'x'),O.parse(source+'x'));
assert.deepEqual(F.parse(source),want);
for(const name of ['first-name','second-name']){
 assert.throws(()=>F.parse('import {',name),e=>e.message.includes(name));
 assert.deepEqual(F.parse(source),want);
}
const realEval=globalThis.eval;let calls=0;
try{
 globalThis.eval=s=>{calls++;return realEval(s);};
 F.parse(source);const n=calls;F.parse(source);assert.equal(calls,2*n);assert.ok(n>0);
 globalThis.eval=()=> 'replacement';
 assert.deepEqual(F.parse(source),O.parse(source));
}finally{globalThis.eval=realEval;}
assert.deepEqual(F.parse(source),want);
console.log('Repeated parsing: fresh ownership, input changes, error names and eval behaviour passed');
