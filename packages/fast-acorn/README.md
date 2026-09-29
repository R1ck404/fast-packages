# @r1ck404/fast-acorn

A faster drop-in replacement for [`acorn@8.18.0`](https://www.npmjs.com/package/acorn):
the same exports, **identical ASTs** (keys, key order, values, `Node` /
`SourceLocation` / `Position` objects and their sharing), identical errors
(class, message, `pos`, `loc`, `raisedAt`) and callbacks, for every
`ecmaVersion` (3 .. latest) and every option.

```jsonc
// package.json
"dependencies": {
  "acorn": "npm:@r1ck404/fast-acorn@8.18.0",
  "acorn-jsx": "npm:@r1ck404/fast-acorn-jsx@5.3.2"   // optional, see below
}
```

| operation | times faster than acorn 8.18 |
|---|---|
| `parse` 1.6KB .. 9MB | 2.5-3.2x |
| `parse` with `locations` | 2.2-2.9x |
| `Parser.extend(acornJsx())` | 2.3-2.5x |
| subclasses that only override `parseFunctionBody` | 2.0-2.6x |
| `parseExpressionAt` | 3.2x |
| `tokenizer()` | 2.2-2.6x |
| other plugins (acorn's own parser code) | 1.5x (after a one-time ~5 ms load in Node) |

Times and inputs: [benchmark results](https://github.com/R1ck404/fast-packages#results).

## How

* `src/parser.mts`: a parser that mirrors acorn function by function (same
  checks in the same order, same token-context rules, the same errors at
  the same points) on different machinery: integer token types with flag
  tables, an ASCII fast path in the tokenizer, one constructor per node type
  (monomorphic shapes, acorn's key order), set-backed scopes, lazily created
  token end positions. It handles everything acorn does: all
  `ecmaVersion`s, `sourceType` script / module / commonjs, every option
  (`onToken`, `onComment`, `onInsertedSemicolon`, `onTrailingComma`,
  `program`, `startLocation`, `preserveParens`, ...), `parseExpressionAt`,
  `tokenizer()` and every error. acorn's regular expression validator is
  included (`src/regexp.mjs`, generated from acorn).
* `Parser.extend()`:
  * **acorn-jsx** runs on a native JSX mode when the class is the genuine
    acorn-jsx 5.3.2 plugin (recognised by its source text, structure and
    probe calls, which also give its options) or was made by
    [`@r1ck404/fast-acorn-jsx`](../fast-acorn-jsx) (registered by identity,
    so this also works in minified bundles, where the genuine plugin's
    source text no longer matches).
  * **Subclasses that only override `parseFunctionBody`** (e.g. Nodepod's
    `topLevelParser`, which skips function bodies) pass a whitelist analysis
    of their method's source and then run that method against a facade over
    the fast parser (`src/override.mts`). This works after minification too.
  * Empty subclasses of those behave like their parent.
  * **Anything else** (other plugins, subclasses with their own methods,
    `new Parser(...)`, a patched `Parser.prototype`) runs acorn's own parser
    code, `generic.cjs` (generated from acorn), with the same `tokTypes`,
    `TokenType`, `tokContexts`, `Node`, `Position`, ... objects as the rest
    of the package. It is not part of the main module: `Parser.prototype`
    inherits acorn's methods from a prototype that receives them on first
    use. In Node that happens on demand, synchronously (a `require` that
    bundlers do not follow). In browsers and bundles, import it once:

    ```js
    import "@r1ck404/fast-acorn/full";   // or "acorn/full" when installed as acorn
    ```

    Without it, such a parse throws an `Error` that says so.
* `index.mjs` is `src/` bundled into one minified module (`build.mjs`):
  importing it costs about what importing acorn does (one module; the node
  constructors and other tables are made by the first parse).

## Differences from acorn

Each is pinned by a test (`test/differences.mjs` unless noted):

* Unrecognised plugins, subclasses with methods of their own, `new
  Parser(...)`, a patched `Parser.prototype`, a `parseExpressionAt` position
  that is not a number, and the genuine acorn-jsx after minification need
  `@r1ck404/fast-acorn/full` outside Node (see above; `test/bundle.mjs`).
* `Parser.prototype` has no own methods (they are inherited, see above), and
  `Parser` has two symbol-keyed hooks, for `@r1ck404/fast-acorn-jsx` and
  `/full`.
* A method put on `Parser.prototype` with `Object.defineProperty` before
  anything has read a method from `Parser.prototype` is not noticed; the fast
  parser keeps running. (Assignments, and `defineProperty` after such a
  read, switch to acorn's code exactly like acorn: `test/plugins.mjs`.)
* The token types' and contexts' behaviour is built in: replacing
  `tokTypes.x.updateContext` or a `TokContext`'s `override` affects only
  parses that run acorn's code.
* `tokenizer()` returns an object with acorn's token API and state (`getToken`,
  iteration, `next`, `nextToken`, `type`, `value`, `start`, `end`, `pos`,
  `curLine`, `lineStart`, `exprAllowed`, `context`, ...; writable where
  acorn-loose writes them), an `instanceof Parser`, but not a whole parser:
  no scope stack, labels or parse methods.
* Nesting too deep for the stack throws acorn's "Not enough stack space to
  parse input" in both, at a different depth.
* Error stack traces show this package's functions.

## Development

    npm run build             # index.mjs from src/ (after node tools/ts-build.mjs)
    npm test                  # quick: build check, API, options, corpus sample, versions, plugins
    npm run test:full         # everything (incl. Nodepod's pnpm store), see package.json
    npm run gen               # regenerate src/ident-data.mts, src/regexp.mjs,
                              # src/jsx-data.mts and generic.cjs from acorn / acorn-jsx

The JSX tests use `verify/jsx-corpus` (generate it with
`node verify/make-jsx-corpus.mjs`).
