// fast-brotli-wasm for Node (CommonJS), like brotli-wasm's index.node.js:
// everything is available synchronously, plus a default export promise.
const { readFileSync } = require("fs");
const { join } = require("path");
const { bind } = require("./core.mjs");

const wasm = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(join(__dirname, "fastbrotli.wasm"))), {}).exports;
const api = bind(wasm);
for (const k of Object.keys(api)) module.exports[k] = api[k];
module.exports.__wasm = wasm;
module.exports.default = Promise.resolve(module.exports);
