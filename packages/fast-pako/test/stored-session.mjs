import assert from 'node:assert/strict';
import pako from 'pako';
import fast from '../index.mjs';
let checks=0;
// Reuse the same pooled sessions while changing modes, sizes and hash tables.
// This detects stale hash entries becoming observable after a stored session.
for(let round=0;round<3;round++)for(const memLevel of [1,8,9])
for(const level of [6,0,9,'0',1,0])for(const strategy of [0,2,3,4])
for(const size of [0,1,32,256,4096,70000])for(const method of ['deflate','deflateRaw','gzip']) {
 const data=new Uint8Array(size);
 for(let i=0;i<size;i++)data[i]=(i*17+(i>>8))&255;
 const options={level,memLevel,strategy};
 assert.deepEqual(fast[method](data,{...options}),pako[method](data,{...options}));
 checks++;
}
for(const level of [6,0,9,0])for(const strategy of [0,2,3,4]) {
 const a=new pako.Deflate({level,strategy}),b=new fast.Deflate({level,strategy});
 for(const flush of [0,2,3,true]) {
  const input=new TextEncoder().encode('repeated history '.repeat(500));
  assert.equal(b.push(input,flush),a.push(input,flush));
 }
 assert.deepEqual(b.result,a.result);
 checks++;
}
console.log(`Stored/compressed session transitions: ${checks} checks passed`);
