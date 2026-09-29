// @r1ck404/fast-acorn/full: the same module as the main entry, with acorn's
// generic parser (generic.cjs: what runs Parser.extend() plugins the fast
// parser does not recognise, `new Parser(...)` and a modified
// Parser.prototype) installed up front. Node loads it on demand; in browsers
// and bundles, import this once where such plugins are used:
//
//   import "@r1ck404/fast-acorn/full";   // or "acorn/full" when installed as acorn
import { Parser } from "./index.mjs";
import installGenericParser from "./generic.cjs";

(Parser       )[Symbol.for("@r1ck404/fast-acorn:installGeneric")](installGenericParser);

export * from "./index.mjs";
// generated from full.mts by tools/ts-build.mjs; edit that file
