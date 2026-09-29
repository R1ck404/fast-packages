# @r1ck404/fast-esbuild-wasm: porting conventions (Go → JavaScript)

This package is esbuild 0.28.2 ported from Go to plain JavaScript ES modules
(`.mjs`): the whole pipeline (lexer, parser, printer, renamer, CSS, bundler,
linker, resolver, file system layer, Yarn PnP with ".zip" archives), the
service that esbuild's JavaScript API talks to (cmd/esbuild/service.go), the
command line (cmd/esbuild/main.go) and the parts of Go's standard library
whose behaviour shows (strconv, math, unicode, regexp, archive/zip,
compress/flate, ...). Nothing runs Go: there is no fallback. The Go source is
a checkout of esbuild v0.28.2; the tools look for it in
`<os tmpdir>/esbuild-src` (`git clone --depth 1 --branch v0.28.2
https://github.com/evanw/esbuild "$TMPDIR/esbuild-src"`) or take its path as an
argument. The goal is **byte-identical output**, messages and behaviour to
esbuild-wasm (Go on js/wasm), and much higher speed.

The port is a faithful, function-by-function translation. Do not "improve" or
simplify esbuild's logic, do not reorder conditions, do not merge functions.
Keep Go comments that explain *why* (they help reviewers compare), drop
the rest. Keep the same function order as the Go file where practical.

The modules are now TypeScript: each `src/X.mjs` named in this document is
generated from `src/X.mts` by the repository's `tools/ts-build.mjs`
(types replaced by whitespace; imports keep the `.mjs` names). Edit the
`.mts`, then run `npm run build:ts` at the root. Type annotations only:
`declare` for class fields (a plain `x: T;` field would add a property),
no enums/namespaces/parameter properties, `import type` for types.

All ported modules live in `src/`. Shared foundations that
already exist (read them before starting):

- `gopanic.mjs`    — `LEXER_PANIC`, `GoPanic` (Go's panics), `goIndexOutOfRange`, ...
- `logger.mjs`     — Loc/Range/Span/Source helpers, `Log` (the stderr and deferred logs), message formatting
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
  over a WTF-8 string yields U+FFFD per byte for surrogates; replicate that
  where such code is reachable with lone surrogates.
- Raw bytes of invalid UTF-8 (Go keeps them in its strings) are carried as the
  lone surrogates U+DC80..U+DCFF (`helpers.decodeGoString` decodes bytes
  like Go's string(bytes), `goStringBytes` encodes them back): lexers read
  them as U+FFFD with a width of one byte, printers write the byte, quoting
  prints `\xNN`. (So a genuine lone surrogate U+DC80..U+DCFF in a string
  value is taken for a raw byte.)

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

Every option and every mode is supported (there is no fallback), so every
branch must be ported:

- `MinifySyntax`, `MinifyWhitespace`, `MinifyIdentifiers`, `KeepNames`,
  `DropDebugger`, `DropLabels`, `Pure` (defines with
  `CallCanBeUnwrappedIfUnused`), drop console (a `console` define with
  `MethodCallsMustBeReplacedWithUndefined`), `LineLimit`, `MangleProps`,
  `ReserveProps`, `MangleQuoted` and a mangle cache: all supported, port
  faithfully. (`MangleProps`/`ReserveProps` are objects with Go's
  `matchString(name)`; the flag parser only accepts regular expressions whose
  RE2 semantics it can reproduce.)
- `UnsupportedJSFeatures` may be any target's feature set with any
  `--supported:` overrides applied (see compat below), so every lowering
  branch must be ported.
- `ProfilerNames` is `!MinifyIdentifiers`. Source maps of every kind, input
  source maps included.
- `transform()` runs `ModePassThrough` or `ModeConvertFormat`; `build()`
  (api_build.mjs, bundler_scan.mjs) every mode with plugins, the resolver,
  inject, every loader (CSS too), code splitting, output paths and hashes,
  the metafile, `write: true` and watch mode. `serve()` answers like
  esbuild-wasm (`The "serve" API is not supported when using WebAssembly`).
- `IgnoreDCEAnnotations` may be either; `TreeShaking` may be either;
  `ASCIIOnly` may be either; `Platform` any; `OutputFormat` preserve/esm/cjs/iife.
- JSX options, defines, TS options: supported, port faithfully.

When unsure whether a branch is reachable, port it.

## 6. Errors, warnings, panics

- `import { LEXER_PANIC, GoPanic } from "./gopanic.mjs"`.
- Every log message (`log.AddError`, `AddID`, `AddIDWithNotes`, `AddMsg`,
  `AddMsgID`, …, of every kind) → the matching method on the `Log` object
  from logger.mjs, with the exact text (`fmt.Sprintf`'s `%q` is
  `goQuote` from gostd.mjs), tracker, range (UTF-16 offsets: the tracker
  converts to UTF-8 columns; a Go range whose length is `len(someString)`
  is a `ByteRange`), notes, suggestion and ID. Messages are text built
  where Go builds them, in the same order (the stderr log prints as messages
  arrive, like Go). The resolver's debug logs (`r.debugLogs`) are built
  like Go builds them, at the log levels `debug` and `verbose`.
- Go's parse caches parse into a temporary deferred log whose sorted
  messages are then added (`parseWithTempLog`); keep that where Go has it.
- The lexer's `panic(LexerPanic{})` → `throw LEXER_PANIC`. Code that
  `recover()`s a `LexerPanic` (TypeScript backtracking) → `catch (e) { if (e !==
  LEXER_PANIC) throw e; … }`.
- Go's `panic(...)` and Go runtime errors (index out of range, ...) →
  `throw new GoPanic(value)` with Go's text. Where Go `recover()`s
  (bundler.parseFile, the linker's recoverInternalError) the port catches
  it (recover.mjs) and logs Go's message; anywhere else it ends the service,
  like a crash of esbuild's process.
- Stack overflow (JS-only, `deep.mts`): Go's stacks grow, a JavaScript
  thread's does not. The build (`tools/gen-deep.mjs`) gives every function of
  the bundled engine that is part of a recursion a generator copy
  (`name$deep`) that runs on an explicit stack. A step that overflows the
  call stack runs again in deep mode: a file's parse (`parseWithTempLog`,
  with a fresh temporary log), the printing of a file by the linker, and a
  transform as a whole (`deepRetry`). So a step that may run again must be
  safe to run again (no messages logged or shared state changed before it
  can fail); add new retry points only where that holds. Keep recursive
  code plain enough for gen-deep: function declarations and methods, local
  functions only called by name, no `arguments`/`super` in them, no
  recursion through getters, constructors or callbacks passed to built-ins
  (these still recurse on the call stack). `node test/depth.mjs` measures
  the nesting each construct reaches. The source modules run without the
  copies (`__deepCompiled` is false: nothing runs again).

## 6b. Writing files — IMPORTANT

The file-writing tool may turn `\uXXXX` escape sequences you type into the
literal characters. A literal U+2028/U+2029 inside a `//` comment or regex
breaks the file, and literal BOMs/NBSPs are invisible. So **never write
`\u` escapes in source text**: use numeric code points instead
(`c === 0x2028`, `String.fromCharCode(0xfeff)`, `"\\u"` built at runtime is
fine). After writing a file, run `node tools/check.mjs src/file.mjs` from the
package directory: it syntax-checks the module (`node --check`)
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
| internal/compat (JavaScript part)                    | compat.mjs (generated by tools/gen_compat.mjs) |
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
| internal/linker                                      | linker.mjs                |
| internal/bundler (the transform API's subset)        | bundler.mjs (+ transform.mjs: the transform API) |
| internal/css_lexer                                   | css_lexer.mjs             |
| internal/css_ast (css_ast.go, css_decl_table.go)     | css_ast.mjs               |
| css_parser.go, css_parser_media.go                   | css_parser.mjs (class `parser`, mixes in the method objects below) |
| css_parser_selector.go                               | css_parser_selector.mjs (`selectorMethods`) |
| css_nesting.go                                       | css_nesting.mjs (`nestingMethods`) |
| css_decls.go, css_decls_{animation,border_radius,box,box_shadow,composes,container,font,font_family,font_weight,list_style,transform}.go | css_decls.mjs (`declsMethods`) |
| css_decls_color.go, css_color_spaces.go, css_decls_gradient.go | css_decls_color.mjs (`colorMethods`) |
| css_reduce_calc.go                                   | css_reduce_calc.mjs (`calcMethods`) |
| internal/css_printer                                 | css_printer.mjs           |
| internal/compat/css_table.go                         | compat_css.mjs (generated by tools/gen_compat_css.mjs) |
| CSS parts of internal/bundler and internal/linker    | linker_css.mjs            |
| Go standard library behaviour (strconv, strings, math) | gostd.mjs               |
| internal/bundler/bundler.go (scan phase, Compile)    | bundler_scan.mjs          |
| pkg/api (build, context, plugins, watch, serve)      | api_build.mjs, build.mjs, api_validate.mjs (+ build_deps.mjs: the fs/resolver/cache imports) |
| pkg/cli (flag parsing)                               | cli.mjs                   |
| cmd/esbuild/service.go, stdio_protocol.go            | service.mjs, service_protocol.mjs |
| cmd/esbuild/main.go (+ main_wasm.go)                 | cli_main.mjs              |
| internal/fs/watcher (pkg/api/watcher.go)             | watcher.mjs               |
| internal/helpers/timer.go                            | timer.mjs                 |
| internal/resolver (resolver.go, package_json.go, tsconfig_json.go, dataurl.go, yarnpnp.go) | resolver.mjs, package_json.mjs, tsconfig.mjs, dataurl.mjs, yarnpnp.mjs |
| internal/fs (fs_real.go, fs_zip.go, filepath.go)     | fs.mjs                    |
| archive/zip, compress/flate, hash/crc32 (Go stdlib)  | zip.mjs                   |
| internal/cache (CacheSet, SourceIndexCache, FSCache, JSONCache, JSCache) | cache.mjs |
| Go's panics and recover()                            | gopanic.mjs, recover.mjs  |
| the hosts (not Go code)                              | glue.mjs (browser builds), node_host.mjs (lib/main.js, bin/esbuild), engine.mjs |
| pkg/api validators (validatePath, externals, alias)  | build_options.mjs         |
| internal/xxhash                                      | xxhash.mjs (XXH64 in JS and a 549-byte wasm kernel, tools/gen_xxhash_wasm.mjs) |
| net/url, net/http.DetectContentType (Go stdlib)      | gourl.mjs, sniff.mjs      |
| internal/sourcemap (ParseSourceMap)                  | sourcemap_parser.mjs      |

**The service** (`src/service.mjs`): the port of service.go reads the
same packets esbuild's JavaScript API writes to Go's stdin and writes the
same packets back (goroutines are microtasks; the requests a synchronous
call needs are answered synchronously). The file system is what Go's
js/wasm `os` package sees: Node's `fs` for lib/main.js and node.mjs,
`globalThis.fs` for the browser builds with `worker: false` when it is
set, else nothing (every call fails with ENOSYS, like wasm_exec.js's stub).

**compat**: `compat.JSFeature` is a uint64 bit set in Go, which JS numbers
cannot hold. `compat.mjs` represents a set as an immutable `JSFeature` object
with two 32-bit halves; the feature constants keep their Go names and are
single-bit sets. `features.Has(compat.X)` -> `jsFeatureHas(features, X)`,
`a | b` -> `jsFeatureOr(a, b)`, Go's `0` -> `JSFeatureNone`,
`compat.SymbolFeature(kind)` -> `symbolFeature(kind)`. The version tables and
`UnsupportedJSFeatures(constraints)` are generated from js_table.go; the
target flag parsing (`parseTargets`, `validateFeatures`) is in transform.mjs.
`compat.CSSFeature` fits a number: `cssFeatureHas(features, X)`, `|` as usual
(compat_css.mjs).

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

## 9. JS-only performance deviations (keep in mind when comparing with Go)

These change how results are computed, never what they are. Each one is
marked "JS-only" in the source and relies on the invariant stated here.

- **Output buffer is UTF-8** (`js_printer.mjs`): like Go's `p.js`, a growable
  `Uint8Array`, decoded once per printed part with `TextDecoder("utf-8")`.
  Saved positions are byte lengths (as in Go); `lastChar()` is the last
  byte and `lastCodePoint()` is `utf8.DecodeLastRune`. The source map
  `ChunkBuilder` decodes the bytes to count UTF-16 columns like Go.
- **String escaping writes straight into the output buffer**
  (`printUnquotedUTF16`); only characters that may need an escape
  (`ESCAPE_CANDIDATE`) go through Go's per-character logic.
- **Expression comments**: a bitset of the locations in `exprComments`
  (cached per map) filters the per-expression lookups.
- **Runtime print cache** (`linker.printRuntimeCached`): the printed code of
  the runtime helpers is reused when the live runtime parts, the printer
  options (including the minify options, the line limit and the target's
  features) and every (ref, name) pair the renamer returned are the same.
- **Runtime linker memo** (`linker.sharedStep5Memos`): step 5 of
  scanImportsAndExports (namespace export part, symbol uses and dependencies
  of every part) is a pure function of the cached runtime AST.
- **Reserved names memo** (`renamer.computeReservedNamesForScope`): the names
  contributed by the shared runtime module scope, reused while no shared
  runtime symbol has been copied for writing (`SymbolMap.sharedWritten`).
- **Renamer**: a part's scope list contains nested scopes that are also
  reached through their parents; renaming a scope twice is a no-op, so such
  scopes are skipped (`Scope.renamerStamp`). `numberScope.nameCounts` is
  allocated on the first name.
- **Reused objects**: `findSymbol` returns a reused result object (callers
  copy the fields right away); `binaryExprVisitor`s are pooled (parser and
  printer); `handleIdentifier` / the binary visitor return the original
  `Expr` instead of an equal new one (Exprs are immutable values);
  never-mutated "not found" tuples are shared frozen arrays
  (`NOT_REWRITTEN`, `BOOLEAN_UNKNOWN`, ...); `parseStmt` clones its options
  on the first mutation instead of up front; identifierOpts for
  `handleIdentifier` come from a table.
- **Multiple return values** are read by index (`const r = f(); r[0]`), not
  by array destructuring (which goes through the iterator protocol), and
  loops over known arrays use indices instead of `for...of`.
- **Runtime AST snapshot** (`snapshot.mjs`): the built engine decodes the
  runtime's AST from a snapshot made with this parser at build time instead
  of parsing `runtime.mjs` on the first transform (bundler.runtimeCache). The
  decoded objects are constructed like the parsed ones (same classes, field
  order, identity of shared objects and of the module singletons).
- **Minification and lowering** (each marked "JS-only" at the site):
  - Character frequency (`js_parser.computeCharacterFrequency`): the source
    and the comments are counted with a histogram per string instead of one
    `Scan` per character; symbols with a use count of 0 are skipped (their
    delta is 0).
  - `simplifyUnusedExpr` (js_ast_helpers) returns the comma expression
    itself when `JoinWithComma` would rebuild an identical one, and the
    printer remembers comma expressions that simplification left unchanged:
    Go re-simplifies long comma chains at every level (quadratic).
  - The printer's late constant folding (`lateConstantFoldUnaryOrBinaryOrIfExpr`)
    is skipped when the file has no inlined constants or enum values, and
    the unused-call inlining check when no symbol is flagged
    `IsEmptyFunction`/`IsIdentityFunction` (neither can change anything
    then). The printer caches its `!UnsupportedFeatures.Has(compat.X)`
    checks in booleans.
  - `convertSymbolUseToCall` updates the use counters in place (like
    `recordUsage`); `lowerAssign` returns early for identifier targets and
    only allocates its callback when object rest can apply.
  - `renamer.assignNestedScopeSlots` passes Go's by-value `slot` array as
    four numbers.
  - The lexer's `allComments` is shared by `lexer.clone()`; every TS
    backtracking site truncates it back (`ts_parser.restoreLexer`) to get
    Go's slice semantics.
- **Go on wasm, not amd64**: Go's float to int conversion of NaN is
  platform-defined (0 on wasm, MinInt64 on amd64). The port follows
  esbuild-wasm (`js_ast_helpers.approximatePrintedIntCharCount`), so
  "1 >>> NaN" folds under minifySyntax like esbuild-wasm does (native esbuild
  keeps it). The tests re-check such differences against esbuild-wasm
  ("okWasm"). Float to int conversions saturate like on wasm
  (`gostd.goIntFromFloat` and friends).
- **build()**:
  - `ast.Ref` is one number: `(sourceIndex << 18) | innerIndex` (a small
    integer) for up to 4096 files and 262143 symbols per file, beyond that
    `2^30 + sourceIndex * 2^26 + innerIndex` (see ast.mjs).
  - The scanner's goroutines are async functions on one thread; the result
    channel is a queue of promises (`scanner.send`/`receive`). Plugin
    callbacks are awaited in Go's order per file.
  - Go links each entry point of a multi-entry build without code splitting
    on a copy of the graph; the port deep-clones the ASTs
    (`cloneLinkerGraph(..., deepClone)`) for all but the last link.
  - Contents of binary loaders are byte strings (latin1: one char per byte),
    text loaders decode like Go's string(bytes) (section 3).
  - xxhash (output hashes): XXH64 on 32-bit halves in JS for short inputs,
    a small wasm kernel for inputs of 256 bytes and more (same results).
- **Test hook**: with `globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__` set
  (test/diff.mjs, test/fuzz.mjs, test/api.mjs) every cache/memo hit above,
  and the runtime snapshot, is checked against a fresh computation and a
  mismatch throws (reported as CRASH).

## 10. CSS

`transform()` with loader `css`, `local-css` or `global-css` runs the port of
the CSS pipeline: css_lexer, css_parser (with nesting lowering, the
declaration minifiers, colors, gradients and calc()), css_printer, and the CSS
half of the bundler and linker for a transform (linker_css.mjs: import order
with external `@import` hoisting and condition merging, `mangleLocalCSS` for
local names, `generateChunkCSS`, banners, legal comments, source maps).
Warnings and errors are reported exactly like in JavaScript: every
`log.Add...` is ported with its text and condition.

Value semantics (the most common source of bugs in this port):

- `css_ast.Token` is a mutable class with `clone()`. Go copies it on every
  assignment: wherever Go copies a token (or a slice of tokens, or a
  `[4]Token` array) and either copy is mutated afterwards, the port clones.
  `*token.Children = x` replaces the slice for every copy that shares the
  pointer (css_decls replaces the array's contents in place for that).
- `CompoundSelector` has `copy()` (Go's `a := b`) and `clone()` (Go's
  `Clone()`); `NamespacedName`, `NameToken`, `NthIndex` are mutable with
  `clone()`; `Combinator`, `Rule` and `MediaQuery` are immutable pairs.
- nil vs empty matters to the printer: `RKnownAt.rules`, `RAtLayer.rules`,
  `RUnknownAt.block`, `SSPseudoClass.args`, `MQPlainOrBoolean.valueOrNil`,
  `MQType.andOrNull` are `null` for Go's nil.
- `(check *CrossFileEqualityCheck) RefsAreEquivalent` is called on a nil
  receiver in Go: `refsAreEquivalent(check, a, b)`.
- Methods returning `(value, bool)` return `[value, bool]`; pointer out
  parameters such as `wouldClipColor *bool` are `{ value: boolean }` objects.

Go standard library (gostd.mjs): `strconv.ParseFloat` -> `strconvParseFloat`
(range errors included, never `Number()`), `strconv.FormatFloat(x, 'f', n)` /
`%.Nf` -> `formatFloatFixed` (exact, half to even), `strings.ToLower` /
`strings.EqualFold` -> `goToLower` / `goEqualFold` (Unicode simple case
mapping), and the `math` functions behind `helpers.F64` (`goSin`, `goCos`,
`goCbrt`, `goPow`, `goAtan2`, `goLog2`, `goExp`, `goLog`, `goRound`, ...),
ported from Go's pure-Go implementations, which is what esbuild-wasm runs.
Native esbuild on amd64 uses assembly for `math.Exp` and `math.Log`, so a few
colors computed through `Pow` differ from native esbuild in the last bit and
can print differently; the tests re-check those against esbuild-wasm
("okWasm"). `helpers.F64` needs no wrapper: it only prevents fused
multiply-add, which JavaScript never does. Go constant expressions that
JavaScript would round differently (e.g. `0.3457 / 0.3585`) are written as
their correctly rounded values. Float to int conversions that are
platform-defined in Go (huge values) follow wasm.

JS-only deviations (none changes the output):

- **No JavaScript runtime or JavaScript linking for CSS**
  (`linker_css.transformBundleCSS`): Go parses the runtime and runs the whole
  linker, but for a CSS entry point the runtime is never live, no JavaScript
  chunk exists and `mangleProps` has no JavaScript file to work on (the mangle
  cache comes back unchanged). The `<define:...>` files keep their source
  indices but are not parsed (nothing can import them).
- **Lexer**: the token being built lives in lexer fields and one Token object
  is created per token; comment bodies are skipped with `charCodeAt` up to the
  next `*` (the newline count is kept exact).
- **Parser**: `convertTokensHelperAt(tokens, start, end, ...)` takes a range of
  `p.tokens` instead of a copied sub-slice; the method objects are mixed into
  the `parser` class on the first `parse()` (module load order).
- **Hashing** (`css_ast.mjs`): `hashCombineString` has an ASCII fast path; the
  hash of an `RDeclaration` is memoized (`hashMemo`: declarations are hashed
  by the dead rule remover of their block and again by every enclosing rule,
  and are never modified after `processDeclarations`); the typo check for
  unknown properties (`maybeCorrectDeclarationTypo`, only its "ok" is used)
  remembers its answer per name.
- **Printer** (`css_printer.mjs`): the output is a growable UTF-8
  `Uint8Array` like js_printer's (source maps and `--line-limit` count bytes
  like Go), with one spare buffer reused by the next `print()`;
  `printTokensOpts` is passed as three arguments; ASCII fast paths in
  `printIdent` and `printQuotedWithQuote`.
- **Test hook**: `__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__` (set by
  test/css-diff.mjs and test/css-fuzz.mjs) checks every memoized declaration
  hash against a fresh one.
