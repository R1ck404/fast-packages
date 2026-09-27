// Like brotli-wasm's index.web.js: the default export is a promise for the
// module once it is initialized.
import init, * as fastBrotli from "./pkg.web.mjs";
export default init().then(() => fastBrotli);
