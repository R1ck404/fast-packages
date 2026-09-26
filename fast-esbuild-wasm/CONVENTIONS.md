# fast-esbuild-wasm: porting conventions (Go → JavaScript)

We are porting esbuild 0.28.2's *transform* pipeline (lexer, parser, printer,
renamer, part of the linker) from Go to plain JavaScript ES modules (`.mjs`).
The Go source lives at `/tmp/esbuild-src` (Windows path
`C:\Users\Eigenaar\AppData\Local\Temp\esbuild-src`). The goal is **byte-identical
output** to esbuild for the supported option subset, and much higher speed than
esbuild-wasm. Anything we do not support must **bail** (see below) so the
caller can fall back to the real esbuild-wasm.

The port is a faithful, function-by-function translation. Do not "improve" or
simplify esbuild's logic, do not reorder conditions, do not merge functions.
Keep Go comments that explain *why* (they help reviewers compare), drop
the rest. Keep the same function order as the Go file where practical.

All ported modules live in `fast-esbuild-wasm/src/`. Shared foundations that
already exist (read them before starting):

- `bail.mjs`       — `BAIL`, `LexerPanic`, `bail()`
- `logger.mjs`     — Loc/Range/Span/Source helpers + `Log` (throws BAIL on errors/warnings)
- `helpers.mjs`    — ports of `internal/helpers` used across packages
- `ast.mjs`        — port of `internal/ast` (Ref, Symbol, ImportRecord, …)
- `js_ast.mjs`     — port of `internal/js_ast/js_ast.go` (all AST node classes)

## 1. Naming (mechanical — other people port the callers/callees in parallel!)

Names must be derivable mechanically so independently ported files agree:

- Struct fields and methods: Go `UpperCamel`/`lowerCamel` → JS lowerCamel with
  the leading *acronym run* lowered: `ValueOrNil`→`valueOrNil`,
  `TSNamespace`→`tsNamespace`, `JSXFactory`→`jsxFactory`, `URLForCSS`→`urlForCSS`,
  `ASCIIOnly`→`asciiOnly`, `ID`→`id`, `IsTypeScriptCtorField`→`isTypeScriptCtorField`,
  `ESMExportKeyword`→`esmExportKeyword`, `IIFE`→`iife`. Already-lowercase names
  stay as they are (`parseStmt`, `currentScope`).
- Package-level functions: same rule (`js_ast.IsPrimitiveLiteral` →
  `isPrimitiveLiteral`, exported from the module that ports that Go file).
- Methods become class methods (`lexer.Next()` → `lexer.next()`,
  `p.parseStmt(opts)` → `p.parseStmt(opts)`).
- Methods on enum/flag types become functions named `<typeLowerCamel><Method>`:
  `op.IsPrefix()` → `opCodeIsPrefix(op)`, `kind.IsHoisted()` →
  `symbolKindIsHoisted(kind)`. Look them up in the foundation modules first.
- **Constants and enum values keep their exact Go name**: `js_lexer.TIdentifier`
  → `TIdentifier`, `js_ast.BinOpAdd` → `BinOpAdd`, `ast.SymbolHoisted` →
  `SymbolHoisted`, `config.ModeBundle` → `ModeBundle`, `js_ast.LLowest` →
  `LLowest`. Flags too: `ast.MustNotBeRenamed`, `js_ast.PropertyIsComputed`.
- Struct types become JS classes with the same name (`js_ast.Property` →
  `class Property`). Unexported Go types keep their name (`fnOrArrowDataParse`).
- Property names never get renamed, even if they are JS reserved words
  (s.class, s.catch, s.finally, s.await are valid JS). Only *local
  variables/parameters* that would be reserved words get a _ suffix
  (new -> new_, default -> default_, class -> class_).

## 2. Values

| Go                                   | JS |
|--------------------------------------|----|
| `int`, `int32`, `uint32`, `uint16`…  | number. Add `\| 0` / `>>> 0` **only** where wrap-around matters (hashes, bit tricks). |
| `float64`                            | number |
| `bool`                               | boolean |
| `string`                             | JS string (see §3) |
| `[]uint16`                           | JS string (UTF-16 code units map 1:1) |
| `[]byte` being built (output)        | JS string concatenation (or an array joined at the end) |
| `logger.Loc`                         | number = UTF-16 offset into the source (`Loc{}` → `0`) |
| `logger.Range`                       | immutable `{loc, len}` object — use `mkRange(loc, len)` / `RANGE_ZERO` from logger.mjs; never mutate |
| `logger.Span`                        | `{text, range}` |
| `ast.Ref`                            | number — see ast.mjs: `makeRef(source, inner)`, `refSource(ref)`, `refInner(ref)`, `InvalidRef === -1`. Compare with `===`. Ordering with `<` matches Go's (SourceIndex, InnerIndex) order. |
| `ast.LocRef`                         | `new LocRef(loc, ref)` (immutable by convention) |
| `ast.Index32`                        | number, `-1` = invalid. `MakeIndex32(i)` → `i`; `x.IsValid()` → `x >= 0`; `x.GetIndex()` → `x` |
| nil pointer / nil interface / nil map| `null` |
| slices `[]T`                         | JS arrays. A nil slice is `null` **only** when the Go code distinguishes nil from empty (`x == nil`, `x != nil`). Otherwise use `[]`. When in doubt check how the field is used. |
| `map[K]V`                            | `Map` (or `Set` for `map[K]bool` / `map[K]struct{}` when values are never false). Missing keys → Go zero value: write `m.get(k) ?? 0` etc. |
| map with struct key                  | compose a string or number key |
| structs                              | class instances (value semantics, see §4) |
| multiple return values               | return an array `[a, b]` and destructure (`const [a, b] = f()`). For very hot paths you may use a documented side channel instead. |
| `panic`/`recover`                    | `throw` / `try…catch` (see §6) |
| `defer f()`                          | `try { … } finally { f() }` |
| `fmt.Sprintf`                        | template literals (match Go formatting exactly: `%q` is Go quoting!) |
| `sort.Slice`/`sort.Sort`             | `Array.prototype.sort` — Go's sort is *not stable*. If equal keys can occur and the order matters for output, flag it with a `// FIXME(sort-stability)` comment. `sort.SliceStable`/`sort.Stable` → `.sort()` (stable). |
| `strconv` / `math`                   | port exactly (helpers.mjs has float formatting helpers) |

## 3. Strings, UTF-8 vs UTF-16

Go esbuild works on UTF-8 bytes; we work on JS strings (UTF-16). Consequences:

- The source is a JS string. The lexer's `current`/`start`/`end` and every
  `Loc` are UTF-16 offsets. `lexer.codePoint` is a full code point (decode
  surrogate pairs with `codePointAt`; advance by 2 for code points > 0xFFFF).
- Byte loops like `for i := 0; i < len(s); i++ { c := s[i] ... }` become
  `charCodeAt` loops. For ASCII tests the result is identical. Where Go's result
  depends on *byte lengths* of non-ASCII text (length limits, column numbers,
  byte offsets written to output), think about it and replicate the byte-based
  result (e.g. compute UTF-8 length with `utf8Len()` from helpers.mjs).
- `for i, c := range s` (rune iteration) → iterate code points.
- esbuild strings can be WTF-8 (lone surrogates survive `helpers.UTF16ToString`
  and are decoded back by `helpers.DecodeWTF8Rune`). A JS string with lone
  surrogates is the exact analogue, so `helpers.UTF16ToString(x)` → `x`,
  `helpers.StringToUTF16(x)` → `x`. **But** plain Go `for range`/`utf8.DecodeRune`
  over a WTF-8 string yields U+FFFD per byte for surrogates; if such code is
  reachable with lone surrogates, replicate that or `bail()`.
- The input source never contains lone surrogates (the API sanitises it like
  `TextEncoder` would).

## 4. Structs and value semantics

Go copies structs on assignment; JS objects are references.

- `Expr`, `Stmt`, `Binding` (in js_ast.mjs) are **immutable** `{data, loc}`
  pairs. Never assign to `.data`/`.loc` of an existing one. Where Go writes
  `expr.Data = x` on a local copy, write `expr = new Expr(x, expr.loc)`.
  Where Go writes `stmts[i].Data = x`, write `stmts[i] = new Stmt(x, stmts[i].loc)`.
  `js_ast.Expr{}` (nil expression) is `null`: `x.Data == nil` → `x === null`,
  `x.Data != nil` → `x !== null`. Same for `Stmt{}` and `Binding{}`.
- The `E*`, `S*`, `B*` data classes are mutable (Go uses pointers to them).
  Type switches: `switch e := expr.Data.(type)` → `switch (expr.data.k)` with the
  `E_*` / `S_*` / `B_*` kind constants from js_ast.mjs, or `instanceof` for a
  single check. Shared singletons (`js_ast.ENullShared`, …) are exported too.
- Other structs (Property, Arg, Fn, Class, Decl, ClauseItem, Symbol, Part,
  ImportRecord, …) are mutable class instances. When Go copies one by value and
  then mutates the copy (or mutates the original and expects the copy to stay
  the same), clone explicitly (each class in js_ast.mjs/ast.mjs has `clone()`).
  Taking `&slice[i]` and mutating through it just becomes `const x = slice[i]`.
- `append(s, x)` → `s.push(x)` *mutates the shared array*. If another holder of
  the same Go slice must not observe the change, copy first (`s = s.slice()`).
  `s[a:b]` → `s.slice(a, b)` (a copy — if Go writes through a sub-slice to
  update the parent, handle that explicitly). `s[:0]` reuse idiom → `[]`.
- Constructors take **all fields in Go declaration order as optional
  positional parameters** defaulting to the Go zero value
  (`new EDot(target, name, nameLoc)`, remaining fields default). You may also
  construct with defaults and assign fields afterwards. Check js_ast.mjs for the
  exact order before calling a constructor.

## 5. Options: what the fast path supports

The API layer only calls the port when all of these hold, so code guarded by
the opposite may be **dropped** (keep a short `// (minify only)` style note):

- `MinifySyntax`, `MinifyWhitespace`, `MinifyIdentifiers` are false.
- `MangleProps`/`ReserveProps` nil, `MangleQuoted` false, no mangle cache.
- `KeepNames`, `DropDebugger` false; `DropLabels` empty; no `Pure` list.
- `UnsupportedJSFeatures` is empty (target `esnext`) → every
  `p.options.unsupportedJSFeatures.Has(compat.X)` is false and lowering
  branches guarded by it can be dropped. (Keep code that runs regardless.)
- `LineLimit` 0; `ProfilerNames` false. `SourceMap` may be anything but
  linked (source maps are ported: `sourcemap.mjs`), but there is never an
  input source map (`InputFile.InputSourceMap` is nil).
- Mode is `ModePassThrough` or `ModeConvertFormat` (never `ModeBundle`) —
  bundle-only branches can be dropped.
- No injected files, no plugins, no Yarn PnP, no CSS, not JSON loader.
- `IgnoreDCEAnnotations` may be either; `TreeShaking` may be either;
  `ASCIIOnly` may be either; `Platform` any; `OutputFormat` preserve/esm/cjs/iife.
- JSX options, defines, TS options: supported, port faithfully.

When unsure whether a branch is reachable, port it.

## 6. Errors, warnings, bailing

- `import { BAIL, bail, LexerPanic, LEXER_PANIC } from "./bail.mjs"`.
- Any log message of kind Error or Warning (`log.AddError`, `AddID` with
  `logger.Warning`/`logger.Error`, `AddIDWithNotes`, …) → call the matching
  method on the `Log` object from logger.mjs; it throws `BAIL`. Messages of
  kind Debug/Verbose/Info are ignored (they never reach transform results),
  but still port the surrounding logic. Do not bother building message text
  for Error/Warning (the method throws anyway) — just call `log.addError()` /
  `log.addID(id, kind)` etc. with whatever arguments are handy.
- The lexer's `panic(LexerPanic{})` → `throw LEXER_PANIC`. Code that
  `recover()`s a `LexerPanic` (TypeScript backtracking) → `catch (e) { if (e !==
  LEXER_PANIC) throw e; … }`.
- Anything unsupported / unported / "should be impossible" → `bail()`.
  Never guess: if a code path is not ported, `bail()` there so we fall back.

## 6b. Writing files — IMPORTANT

The file-writing tool may turn `\uXXXX` escape sequences you type into the
literal characters. A literal U+2028/U+2029 inside a `//` comment or regex
breaks the file, and literal BOMs/NBSPs are invisible. So **never write
`\u` escapes in source text**: use numeric code points instead
(`c === 0x2028`, `String.fromCharCode(0xfeff)`, `"\\u"` built at runtime is
fine). After writing a file, run `node tools/check.mjs src/file.mjs` from the
`fast-esbuild-wasm` directory: it syntax-checks the module (`node --check`)
and rejects non-ASCII characters. The port must be pure ASCII. Add
`--import` to also resolve imports (only works once the modules you import
exist).

## 7. Performance notes

- Prefer classes with all fields initialised in the constructor (stable shapes).
- Avoid closures in hot loops where Go didn't use them; avoid `arguments`,
  spread and `for…in`.
- Use `charCodeAt` on the source rather than creating substrings per char.
- Don't use `Array.prototype.at`, optional-catch-binding is fine, target is
  modern V8/SpiderMonkey/JSC.

## 8. Module layout: which Go code lives in which JS module

Imports are resolved mechanically from where the Go symbol is *defined*
(grep the Go source to find the defining file):

| Go definition site                                   | JS module (src/)          |
|------------------------------------------------------|---------------------------|
| internal/logger                                      | logger.mjs                |
| internal/helpers                                     | helpers.mjs               |
| internal/ast                                         | ast.mjs                   |
| internal/js_ast/js_ast.go                            | js_ast.mjs                |
| internal/js_ast/js_ast_helpers.go                    | js_ast_helpers.mjs        |
| internal/js_ast/js_ident.go, unicode.go              | js_ident.mjs              |
| internal/config                                      | config.mjs                |
| internal/compat                                      | (none: see below)         |
| internal/js_lexer (js_lexer.go, tables.go)           | js_lexer.mjs              |
| internal/js_printer                                  | js_printer.mjs            |
| internal/renamer                                     | renamer.mjs               |
| internal/runtime                                     | runtime.mjs               |
| internal/js_parser: all type/const/var declarations  | js_parser_types.mjs (exists already) |
| js_parser.go lines 1-765 and 17251-end               | js_parser.mjs (Parser class, Parse, scanForImportsAndExports, ...) |
| js_parser.go lines 766-1144 and 8657-10392           | js_parser_visit_stmt.mjs  |
| js_parser.go lines 10393-13276                       | js_parser_visit_stmt2.mjs |
| js_parser.go lines 1145-4263                         | js_parser_parse.mjs       |
| js_parser.go lines 4264-8656                         | js_parser_parse2.mjs      |
| js_parser.go lines 13277-17250                       | js_parser_visit_expr.mjs  |
| ts_parser.go                                         | ts_parser.mjs             |
| js_parser_lower.go, js_parser_lower_class.go         | js_parser_lower.mjs       |
| internal/linker, internal/bundler (transform subset) | linker.mjs / transform.mjs |

**compat**: the fast path always runs with `UnsupportedJSFeatures == 0`
(target esnext), so `x.Has(compat.Anything)` is `false`; do not port compat.
Where a compat value is merely passed along, pass `0`.

### Parser methods (all js_parser/*.go files)

`*parser` methods are spread over several files but live on one class,
`Parser` (defined in js_parser.mjs). Each part file exports a plain object of
methods that js_parser.mjs mixes into `Parser.prototype`:

```js
// js_parser_parse.mjs
export const parseMethods = {
  parseStmt(opts) {
    const p = this;
    ...      // body keeps Go's "p." prefix
  },
  ...
};
export function isEvalOrArguments(name) { ... }   // package-level funcs: normal exports
```

Method object names: `parseMethods` (js_parser_parse.mjs), `parse2Methods`
(js_parser_parse2.mjs), `tsMethods` (ts_parser.mjs), `visitStmtMethods`
(js_parser_visit_stmt.mjs), `visitStmt2Methods` (js_parser_visit_stmt2.mjs),
`visitExprMethods` (js_parser_visit_expr.mjs), `lowerMethods`
(js_parser_lower.mjs), `coreMethods` (js_parser.mjs). Call other parser methods as `p.foo()`; you do
not need to know which file owns them. Package-level functions (no receiver)
are imported from the owning file per the table above (circular imports
between parser files are fine because they are only used at call time).

Methods on other receiver types stay methods of their class
(`lowerClassContext`, `binaryExprVisitor`, `duplicateCaseChecker`,
`lowerUsingDeclarationContext`): add them in the file that ports them with
`Object.assign(Cls.prototype, {...})`.

Parser fields are exactly the Go `parser` struct fields (js_parser.go lines
36-389) with the naming rule applied (`p.fnOrArrowDataParse`,
`p.currentScope`, `p.lexer`, `p.importRecords`, ...). Map-typed fields are
`Map`s (`map[string]bool` fields are `Map<string, boolean>`), `*ast.Ref`
fields are a Ref number or `null`, `logger.Range` fields are Range objects.
Struct-valued fields (`p.fnOrArrowDataParse`, `p.fnOnlyDataVisit`,
`p.fnOrArrowDataVisit`, `p.thenCatchChain`, `p.options`) are objects: when Go
saves one by value (`old := p.fnOrArrowDataVisit`), mutates the field, and
restores it, save a `.clone()` if the current object is mutated in between.
Parser options: `p.options` has the Go `js_parser.Options` fields (including
the embedded `optionsThatSupportStructuralEquality` fields, flattened):
`p.options.ts.parse`, `p.options.jsx`, `p.options.mode`, `p.options.defines`,
`p.options.outputFormat`, `p.options.platform`, `p.options.treeShaking`, ...

### Lexer

- `js_lexer.MaybeSubstring` is represented as a **plain JS string**:
  `js_lexer.MaybeSubstring{String: x}` -> `x`, `name.String` -> `name`,
  `p.lexer.Identifier` -> `p.lexer.identifier` (a string).
- `p.storeNameInRef(name)` simply returns the name string and
  `p.loadNameFromRef(ref)` returns it back (so Ref-typed fields hold a string
  during the parse pass, exactly where Go stores its encoded fake ref).
- Backtracking: Go copies the lexer struct (`oldLexer := p.lexer` ...
  `p.lexer = oldLexer`). In JS: `const oldLexer = p.lexer.clone();` ...
  `p.lexer = oldLexer;`. `clone()` copies every field (arrays by reference).
- Lexer token constants keep Go names: `TIdentifier`, `TOpenParen`, ...
- `lexer.Loc()` returns a number, `lexer.Range()` a Range.

### Ownership

Each porter writes only their own module(s). Do not edit foundation files or
other porters' files; if something is missing in a foundation module, define
it locally (non-exported) and list it in your final report.
