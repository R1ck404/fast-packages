// Go's panics. LEXER_PANIC mirrors js_lexer.LexerPanic, which the
// TypeScript backtracking code (and ParseJSON, ...) recovers from; GoPanic
// is every other panic.

export const LEXER_PANIC = { lexerPanic: true, toString: () => "@r1ck404/fast-esbuild-wasm: lexer panic" };
export class LexerPanic {}

// A Go panic (esbuild's "panic(...)", a runtime error such as an index out
// of range, or a panic in Go's standard library). Where Go recovers it
// (bundler.parseFile, the linker's recoverInternalError, ...) it becomes an
// error message ("panic: " + value + ...); anywhere else it stops the
// service, like a crash of esbuild's process. "value" is the text of Go's
// "%v" of the panic value.
export class GoPanic extends Error {
  ;                     
  constructor(value        ) {
    super("panic: " + value);
    this.name = "GoPanic";
    this.value = value;
  }
}

// The text of Go's "%v" of a recovered panic: a GoPanic's value, or (for an
// exception of the port itself) its message
export function panicValue(e     )         {
  if (e instanceof GoPanic) return e.value;
  if (e !== null && typeof e === "object" && "message" in e) return String(e.message);
  return String(e);
}

// panic("Internal error") and friends
export function goPanic(value        )        {
  throw new GoPanic(value);
}

// Go's "%T" of an AST node ("*js_ast.EArray", ...): the package and the name
// of the node's class
export function goTypeName(pkg        , x     )         {
  if (x === null || x === undefined) return "<nil>";
  return "*" + pkg + "." + (x.constructor && x.constructor.name ? x.constructor.name : "?");
}

// Go's runtime error for an index out of range
export function goIndexOutOfRange(i        , length        )        {
  throw new GoPanic("runtime error: index out of range [" + i + "] with length " + length);
}
// generated from gopanic.mts by tools/ts-build.mjs; edit that file
