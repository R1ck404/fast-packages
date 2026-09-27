// @r1ck404/fast-brotli-wasm for Node's ESM loader. Like the web entry, the default
// export is a promise for the initialized module (brotli-wasm's own "import"
// entry is its web build, which cannot fetch its wasm in Node).
import api from "./index.node.cjs";
export default api.default;
