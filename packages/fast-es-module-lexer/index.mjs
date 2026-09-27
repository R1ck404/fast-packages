// @r1ck404/fast-es-module-lexer: drop-in replacement for es-module-lexer 1.7.0.
// The public entry exports exactly what es-module-lexer exports; the
// implementation (and the hooks its tests use) is in lexer.mjs.
export { ImportType, init, initSync, parse } from "./lexer.mjs";
// generated from index.mts by tools/ts-build.mjs; edit that file
