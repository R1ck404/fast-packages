// Control-flow sentinels. BAIL means "this input/option combination is not
// handled by the JS port (or would produce an error/warning)": the caller falls
// back to the real esbuild. LEXER_PANIC mirrors js_lexer.LexerPanic, which the
// TypeScript backtracking code recovers from.

export const BAIL = { bail: true, toString: () => "@r1ck404/fast-esbuild-wasm: bail" };
export const LEXER_PANIC = { lexerPanic: true, toString: () => "@r1ck404/fast-esbuild-wasm: lexer panic" };
export class LexerPanic {}

// Debugging aid: when enabled, the stack of the most recent bail is recorded.
export const BAIL_TRACE = { enabled: false, stack: null };

export function bail() {
  if (BAIL_TRACE.enabled) BAIL_TRACE.stack = new Error("bail").stack;
  throw BAIL;
}
