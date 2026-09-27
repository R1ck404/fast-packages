import * as BrotliWasm from './types/brotli_wasm';

// Re-export the core API - although this will only work OOTB for node usage.
export * from './types/brotli_wasm';

declare const promisedValue: Promise<typeof BrotliWasm>;
export default promisedValue;

export type BrotliWasmType = typeof BrotliWasm;