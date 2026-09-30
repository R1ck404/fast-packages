import assert from 'node:assert/strict';
import * as fast from '../index.mjs';
import original from 'pako';
let checks=0;
const inputs=[4095,4096,4097,65536].map(n=>'a'.repeat(n));
inputs.push('a'.repeat(4096)+'\ud800','a'.repeat(4096)+'é漢😀','a'.repeat(4096)+'\0','😀'.repeat(4096),'<&>"\\'.repeat(1000));
for(const input of inputs)for(const level of[0,1,6,9])for(const operation of['deflate','gzip','deflateRaw']){
 const options={level};const want=original[operation](input,{...options});const got=fast[operation](input,{...options});
 assert.deepEqual(got,want,`${operation}/${level}/${input.length}`);checks++;
 got.fill(0);assert.deepEqual(fast[operation](input,{...options}),want);checks++;
}
console.log(`String input encoding, byte identity and output ownership: ${checks} checks passed`);
