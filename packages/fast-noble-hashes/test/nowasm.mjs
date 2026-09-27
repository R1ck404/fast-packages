// The same differential test with WebAssembly unavailable (e.g. a CSP
// without 'wasm-unsafe-eval'): everything must fall back to noble's code.
globalThis.WebAssembly = undefined;
process.argv.push("--nowasm");
await import("./diff.mjs");
