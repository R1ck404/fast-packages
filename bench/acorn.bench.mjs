// acorn benchmark. Usage: node bench/acorn.bench.mjs <impl>
//   impl: acorn (8.18) | meriyah (reference only: different AST) | fast (@r1ck404/fast-acorn)
//         | prev (snapshot in .scratch/prev/fast-acorn, for A/B runs)
import { runSuite } from "./harness.mjs";
import { loadJs, root } from "./corpus.mjs";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const impl = process.argv[2] || "acorn";
const require = createRequire(import.meta.url);

async function loadImpl(name) {
  if (name === "acorn") return await import("acorn");
  if (name === "fast") return await import("@r1ck404/fast-acorn");
  if (name === "prev") return await import("../.scratch/prev/fast-acorn/index.mjs");
  if (name === "meriyah") {
    const m = await import("meriyah");
    return {
      parse: (code, o) => m.parse(code, { module: o.sourceType === "module", next: true, loc: !!o.locations, ranges: true, globalReturn: !!o.allowReturnOutsideFunction }),
      tokenizer: null,
    };
  }
  throw new Error("unknown impl " + name);
}

const acorn = await loadImpl(impl);
const files = loadJs();
const cases = [];
for (const f of files) {
  const sourceType = f.module ? "module" : "script";
  const bytes = f.code.length;
  cases.push({ name: `parse ${f.name}`, bytes, fn: () => acorn.parse(f.code, { ecmaVersion: "latest", sourceType }) });
}
for (const f of files.filter((f) => !f.name.includes("9MB"))) {
  const sourceType = f.module ? "module" : "script";
  cases.push({
    name: `parse+locations ${f.name}`,
    bytes: f.code.length,
    fn: () => acorn.parse(f.code, { ecmaVersion: "latest", sourceType, locations: true }),
  });
}
if (acorn.tokenizer) {
  for (const f of files.filter((f) => /51KB|1MB cjs/.test(f.name))) {
    cases.push({
      name: `tokenize ${f.name}`,
      bytes: f.code.length,
      fn: () => {
        let n = 0;
        for (const t of acorn.tokenizer(f.code, { ecmaVersion: "latest", sourceType: f.module ? "module" : "script" })) n++;
        return n;
      },
    });
  }
  for (const f of files.filter((f) => /51KB/.test(f.name))) {
    cases.push({
      name: `tokenize+locations+ranges ${f.name}`,
      bytes: f.code.length,
      fn: () => {
        let n = 0;
        for (const t of acorn.tokenizer(f.code, { ecmaVersion: "latest", sourceType: "module", locations: true, ranges: true })) n++;
        return n;
      },
    });
  }
}
// Svelte-style usage: many small template expressions via parseExpressionAt,
// and module parsing with onComment + locations
if (acorn.parseExpressionAt) {
  const exprs = [
    "count + 1",
    "items.map((item) => item.name)",
    "user?.profile?.name ?? 'anonymous'",
    "{ a: 1, b: [2, 3], ...rest }",
    "cond ? a : b",
    "fn(a, b, () => c)",
    "`hello ${name}!`",
    "x => x * 2",
  ];
  const tpl = exprs.map((e) => `<p>{${e}}</p>`).join("\n");
  const starts = [];
  for (let i = tpl.indexOf("{"); i >= 0; i = tpl.indexOf("{", i + 1)) if (tpl[i - 1] === ">") starts.push(i + 1);
  cases.push({
    name: `parseExpressionAt x${starts.length} template expressions (locations)`,
    bytes: tpl.length,
    fn: () => {
      for (const s of starts) acorn.parseExpressionAt(tpl, s, { ecmaVersion: "latest", sourceType: "module", locations: true });
    },
  });
  const f = files.find((f) => f.name.includes("zod-schemas"));
  cases.push({
    name: "parse+onComment+locations zod-schemas.js (51KB esm)",
    bytes: f.code.length,
    fn: () => {
      const comments = [];
      return acorn.parse(f.code, { ecmaVersion: "latest", sourceType: "module", locations: true, onComment: comments });
    },
  });
}
{
  const f = files.find((f) => f.name.includes("react-dom-client.prod"));
  cases.push({
    name: "parse script+allowAwaitOutsideFunction react-dom.prod",
    bytes: f.code.length,
    fn: () => acorn.parse(f.code, { ecmaVersion: "latest", sourceType: "script", allowAwaitOutsideFunction: true }),
  });
}

// ---- Nodepod usages
// rollup parseAst polyfill options (src/polyfills/rollup.ts)
const rollupOpts = { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: false, locations: true };
{
  // small-module batch: per-call overhead (Nodepod parses many small files)
  const small = files.find((f) => f.name.includes("zod-errors"));
  cases.push({
    name: "parse+locations x20 zod-errors.js (1.6KB esm) [rollup opts]",
    bytes: small.code.length * 20,
    fn: () => {
      for (let i = 0; i < 20; i++) acorn.parse(small.code, rollupOpts);
    },
  });
}
// syntax-transforms.ts topLevelParser(): skips function bodies token by token
{
  const tt = acorn.tokTypes;
  const TopLevel = acorn.Parser.extend(
    (Base) =>
      class extends Base {
        parseFunctionBody(node, isArrowFunction, isMethod, forInit) {
          const self = this;
          if (self.type !== tt.braceL) {
            super.parseFunctionBody(node, isArrowFunction, isMethod, forInit);
            return;
          }
          const body = self.startNode();
          let depth = 0;
          do {
            if (self.type === tt.braceL || self.type === tt.dollarBraceL) depth++;
            else if (self.type === tt.braceR) depth--;
            else if (self.type === tt.eof) self.unexpected();
            self.next();
          } while (depth > 0);
          body.body = [];
          node.body = self.finishNode(body, "BlockStatement");
          node.expression = false;
          self.exitScope();
        }
      },
  );
  for (const f of files.filter((f) => f.module)) {
    cases.push({
      name: `topLevelParser ${f.name}`,
      bytes: f.code.length,
      fn: () => TopLevel.parse(f.code, { ecmaVersion: "latest", sourceType: "module" }),
    });
  }
}
// rollup.ts: acorn.Parser.extend(acornJsx()) with the parseAst options
const jsxDir = join(root, ".scratch/verify/jsx-corpus");
if (existsSync(jsxDir)) {
  const acornJsx = require("acorn-jsx");
  const JsxParser = acorn.Parser.extend(acornJsx());
  const jsxFiles = readdirSync(jsxDir)
    .map((f) => ({ f, size: statSync(join(jsxDir, f)).size }))
    .sort((a, b) => b.size - a.size || (a.f < b.f ? -1 : 1));
  const read = (f) => readFileSync(join(jsxDir, f), "utf8");
  const big = read(jsxFiles[0].f);
  cases.push({
    name: `jsx parse+locations largest .jsx (${(big.length / 1024) | 0}KB)`,
    bytes: big.length,
    fn: () => JsxParser.parse(big, rollupOpts),
  });
  // 40 files around the median size
  const mid = jsxFiles.length >> 1;
  const batch = jsxFiles.slice(mid - 20, mid + 20).map((x) => read(x.f));
  const batchBytes = batch.reduce((a, s) => a + s.length, 0);
  cases.push({
    name: `jsx parse+locations x${batch.length} median .jsx files (${(batchBytes / 1024) | 0}KB)`,
    bytes: batchBytes,
    fn: () => {
      for (const s of batch) JsxParser.parse(s, rollupOpts);
    },
  });
  // what a bundled (minified) build would use: @r1ck404/fast-acorn-jsx (the genuine
  // plugin's source text no longer matches after minification); acorn /
  // prev: the genuine plugin
  const ownJsx = impl === "fast" ? require("@r1ck404/fast-acorn-jsx") : acornJsx;
  const OwnJsxParser = acorn.Parser.extend(ownJsx());
  cases.push({
    name: `jsx via @r1ck404/fast-acorn-jsx x${batch.length} median .jsx`,
    bytes: batchBytes,
    fn: () => {
      for (const s of batch) OwnJsxParser.parse(s, rollupOpts);
    },
  });
  // a further subclass of the acorn-jsx class is not recognised: acorn-jsx
  // runs on the vendored acorn (its readToken override also disables the
  // fast nextToken)
  const Unrecognised = JsxParser.extend((B) => class extends B {});
  cases.push({
    name: `jsx unrecognised subclass x${batch.length} median .jsx`,
    bytes: batchBytes,
    fn: () => {
      for (const s of batch) Unrecognised.parse(s, rollupOpts);
    },
  });
  // parseAst without a lang hint: plain acorn first, acorn-jsx on failure
  cases.push({
    name: `parseAst fallback flow (acorn fails -> jsx) x${batch.length} median .jsx`,
    bytes: batchBytes,
    fn: () => {
      for (const s of batch) {
        try {
          acorn.parse(s, rollupOpts);
        } catch {
          JsxParser.parse(s, rollupOpts);
        }
      }
    },
  });
}

await runSuite(impl, cases, { maxTimeMs: Number(process.env.BENCH_TIME || 1500) });
