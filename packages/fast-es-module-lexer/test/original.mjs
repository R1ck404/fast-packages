// es-module-lexer 1.7.0's parse on a fresh instance of its wasm (Node and
// browsers): its JS glue (dist/lexer.js's parse and copy functions,
// verbatim, checked against the file) around a new WebAssembly.Instance per
// call. That is the original's first parse: what @r1ck404/fast-es-module-lexer
// answers where the original reads memory outside its source.
const GLUE = [
  'export function parse(E,g="@"){if(!C)return init.then((()=>parse(E)));const I=E.length+1,w=(C.__heap_base.value||C.__heap_base)+4*I-C.memory.buffer.byteLength;w>0&&C.memory.grow(Math.ceil(w/65536));const K=C.sa(I-1);if((A?B:Q)(E,new Uint16Array(C.memory.buffer,K,I)),!C.parse())throw Object.assign(new Error(`Parse error ${g}:${E.slice(0,C.e()).split("\\n").length}:${C.e()-E.lastIndexOf("\\n",C.e()-1)}`),{idx:C.e()});const o=[],D=[];for(;C.ri();){const A=C.is(),Q=C.ie(),B=C.it(),g=C.ai(),I=C.id(),w=C.ss(),K=C.se();let D;C.ip()&&(D=k(E.slice(-1===I?A-1:A,-1===I?Q+1:Q))),o.push({n:D,t:B,s:A,e:Q,ss:w,se:K,d:I,a:g})}for(;C.re();){const A=C.es(),Q=C.ee(),B=C.els(),g=C.ele(),I=E.slice(A,Q),w=I[0],K=B<0?void 0:E.slice(B,g),o=K?K[0]:"";D.push({s:A,e:Q,ls:B,le:g,n:\'"\'===w||"\'"===w?k(I):I,ln:\'"\'===o||"\'"===o?k(K):K})}function k(A){try{return(0,eval)(A)}catch(A){}}return[o,D,!!C.f(),!!C.ms()]}',
  "function Q(A,Q){const B=A.length;let C=0;for(;C<B;){const B=A.charCodeAt(C);Q[C++]=(255&B)<<8|B>>>8}}",
  "function B(A,Q){const B=A.length;let C=0;for(;C<B;)Q[C]=A.charCodeAt(C++)}",
];

/**
 * From the text of es-module-lexer 1.7.0's dist/lexer.js: its wasm module,
 * and parse(...args) on a fresh instance of it.
 */
export function original(distText) {
  for (const g of GLUE) if (!distText.includes(g)) throw new Error("this dist/lexer.js is not es-module-lexer 1.7.0's");
  const b64 = distText.match(/"(AGFzbQ[^"]+)"/)[1];
  const module = new WebAssembly.Module(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const glue = new Function(
    "C",
    "init",
    "const A=1===new Uint8Array(new Uint16Array([1]).buffer)[0];" + GLUE.join("\n").replace("export function", "function") + "\nreturn parse;",
  );
  return { module, freshParse: (...args) => glue(new WebAssembly.Instance(module).exports, null)(...args) };
}
