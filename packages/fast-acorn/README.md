# @r1ck404/fast-acorn

A faster drop-in replacement for [`acorn@8.18.0`](https://www.npmjs.com/package/acorn):
the same exports, **identical ASTs** (keys, key order, values, `Node` /
`SourceLocation` / `Position` objects and their sharing), identical errors
(message, `pos`, `loc`, `raisedAt`) and callbacks.

```jsonc
// package.json
"dependencies": {
  "acorn": "npm:@r1ck404/fast-acorn@8.18.0",
  "acorn-jsx": "npm:@r1ck404/fast-acorn-jsx@5.3.2"   // optional, see below
}
```

| vs acorn 8.18 | speedup |
|---|---|
| `parse` 1.6KB .. 9MB | 2.5-3.1x |
| `parse` with `locations` | 1.9-2.7x |
| `Parser.extend(acornJsx())` | 2.4-2.6x |
| subclasses that only override `parseFunctionBody` | 2.2-2.6x |
| `parseExpressionAt` | 3.1x |
| `tokenizer()` | 1.5-1.6x |

## How

* `parser.mjs`: a parser mirroring acorn function by function (integer token
  types, flag tables, per-node-type constructors, exact key order) for
  `ecmaVersion >= 16` without `onToken`/`program`/`startLocation`-style
  options. Errors it can produce exactly ("Unexpected token") it throws
  itself; for anything else it bails and acorn (`vendor/acorn.mjs`) re-parses,
  so every error comes from acorn's own code.
* `Parser.extend()`:
  * **acorn-jsx** runs on a native JSX mode when the class is the genuine
    acorn-jsx 5.3.2 plugin (recognised by source text, structure and probe
    parses, which also give its options) or was made by
    [`@r1ck404/fast-acorn-jsx`](../fast-acorn-jsx) (registered by identity, so this also
    works in minified bundles, where the genuine plugin's source text no
    longer matches).
  * **Subclasses that only override `parseFunctionBody`** (e.g. Nodepod's
    `topLevelParser`, which skips function bodies) pass a whitelist analysis of
    their method's source and then run that method against a facade over the
    fast parser (`override.mjs`). This works after minification too.
  * Anything else runs acorn itself.
* `fasttok.mjs`: a faster `nextToken` for everything that still runs acorn
  (`tokenizer()`, unrecognised plugins, error re-parses), reproducing acorn's
  tokenizer state exactly; it steps aside when a plugin overrides tokenizer
  methods.

Known differences: patching `acorn.Parser.prototype` directly (instead of via
`Parser.extend`) is ignored by the fast path; on extremely deep nesting acorn
can run out of stack where this parser returns an AST.
`Symbol.for("@r1ck404/fast-acorn:registerJsxClass")` on `Parser` is the (internal)
hook `@r1ck404/fast-acorn-jsx` uses.

## Development

    npm test                  # quick corpus diff, options, comments
    npm run test:full         # full corpus (incl. Nodepod's pnpm store), JSX, overrides, errors, tokenizer
    node tools/gen-jsx-data.mjs   # regenerate jsx-data.mjs from acorn-jsx 5.3.2

The JSX tests use `verify/jsx-corpus` (generate it with
`node verify/make-jsx-corpus.mjs`).
