// acorn benchmark. Usage: node bench/acorn.bench.mjs <impl>
//   impl: acorn (8.18) | meriyah (reference only: different AST) | fast
import { runSuite } from "./harness.mjs";
import { loadJs } from "./corpus.mjs";

const impl = process.argv[2] || "acorn";

async function loadImpl(name) {
  if (name === "acorn") return await import("acorn");
  if (name === "fast") return await import("../fast-acorn/index.mjs");
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

await runSuite(impl, cases, { maxTimeMs: Number(process.env.BENCH_TIME || 1500) });
