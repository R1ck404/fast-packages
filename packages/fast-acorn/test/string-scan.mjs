import assert from 'node:assert/strict';
import * as fast from '../index.mjs';
import * as original from 'acorn';
let checks=0;
function run(p,s,ecmaVersion){
 const onToken=[],onComment=[];
 try{return {ast:p.parse(s,{ecmaVersion,locations:true,ranges:true,onToken,onComment}),onToken,onComment};}
 catch(e){return {error:{message:e.message,pos:e.pos,raisedAt:e.raisedAt,loc:e.loc},onToken,onComment};}
}
for(const prefix of[0,31,32,33,127,128,129,255,1024,65536])for(const quote of['"',"'"])for(const tail of['plain','\\n','\\u0061','\\u{1f600}','\\xzz','\\\n','\n','\r\n','\u2028','\u2029','\0','\ud800','😀'])for(const version of[5,9,10,'latest']){
 const source=`var data=${quote}${'a'.repeat(prefix)}${tail}${quote};`;
 assert.equal(JSON.stringify(run(fast,source,version)),JSON.stringify(run(original,source,version)),`${prefix}/${quote}/${JSON.stringify(tail)}/${version}`);checks++;
}
for(const prefix of[128,129,65536])for(const quote of['"',"'"])for(const tail of['','\\']){
 const source=`var data=${quote}${'a'.repeat(prefix)}${tail}`;
 assert.equal(JSON.stringify(run(fast,source,'latest')),JSON.stringify(run(original,source,'latest')));checks++;
}
console.log(`String scanner boundaries and error/callback parity: ${checks} checks passed`);
