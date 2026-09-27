// Globals the packages feature-detect that are not in the TypeScript libs
// this repository targets.

interface Uint8ArrayConstructor {
  /** ES2026 (Chrome 140+, Firefox 133+, Safari 18.2+) */
  fromBase64?(base64: string): Uint8Array<ArrayBuffer>;
}

/** fast-pako: a wasm build with function names, for profiling */
declare var __FASTZLIB_BYTES: Uint8Array<ArrayBuffer> | undefined;

/** ES2024 (Node 20+, all current browsers); used by fast-esbuild-wasm */
interface String {
  isWellFormed(): boolean;
  toWellFormed(): string;
}
