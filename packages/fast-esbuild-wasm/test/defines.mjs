// "define" values (valid and malformed JSON, JS-like syntax, objects and arrays
// that become injected "<define:...>" files) on a few inputs and option sets
// vs native esbuild 0.28.2. usage: node test/defines.mjs
import { createRequire } from "node:module";
const esbuild = createRequire(import.meta.url)("esbuild");
import { fastTransform, stats } from "../src/transform.mjs";
import { classifyTransform } from "./flags.mjs";
globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__ = true;
const values = [
  "{}", "[]", "[1,]", "{\"a\":1,}", "{'a':1}", "{a:1}", "{\"a\":}", "[,]", "[1,,2]", "0x10", "1e999", "-0", "-1", "- 1", "1n", "-1n",
  "\"\\u00e9\"", "\"\\ud800\"", "'s'", "\"\\x41\"", "\"a\\\nb\"", "{\"__proto__\":{}}", "{\"default\":1,\"a b\":[{}]}", "{\"a\":{\"a\":{\"a\":[[[[1]]]]}}}",
  "{\n  \"x\": 1,\n  /* c */ \"y\": // d\n [true, false, null]\n}", "[1, 2, 3", "{\"a\": 1} x", "null", "true", "undefined", "NaN", "Infinity",
  "{\"a\": .5, \"b\": 5., \"c\": 1_000}", "{\"a\": 0o7, \"b\": 0b1, \"c\": 07}", "[\"</script>\"]", "{\"\\u2028\": \"\\u2029\"}", "{\"x\":\"\\t\\n\"}",
  "[1e-7, 123456789012345678901234567890, 0.1]", "{\"a\":1,\"a\":2}", "{\"a\" : [ ] }", "[ {} , [ ] ]", "{\"b\":1}\n", " [1] ", "\t{}\t",
];
const inputs = ["console.log(X, X.a, X.b?.c)", "export default X; export const y = X.default", "X = 1; X.a = 2; delete X.b", "let X = 1; console.log(X)", "console.log(typeof X)"];
const optsList = [{}, { format: "cjs" }, { format: "esm", sourcemap: true }, { format: "iife", treeShaking: true }, { platform: "node", charset: "utf8" }];
function flagsFor(o) {
  const f = ["--log-level=silent", "--log-limit=0"];
  if (o.format) f.push(`--format=${o.format}`);
  if (o.platform) f.push(`--platform=${o.platform}`);
  if (o.charset) f.push(`--charset=${o.charset}`);
  if (o.treeShaking !== undefined) f.push(`--tree-shaking=${o.treeShaking}`);
  for (const k in o.define) f.push(`--define:${k}=${o.define[k]}`);
  if (o.sourcemap) f.push("--sourcemap=external");
  return f;
}
const counts = { ok: 0, okError: 0, bail: 0, bothFail: 0, BAD: 0 };
for (const v of values) for (const input of inputs) for (const base of optsList) {
  const o = { ...base, define: { X: v, "a.b": "[1]" } };
  let ref = null;
  let refError = null;
  try {
    ref = await esbuild.transform(input, o);
  } catch (e) {
    refError = e;
  }
  const errBefore = stats.error;
  const fast = fastTransform(flagsFor(o), input, undefined);
  // (errors and warnings must be esbuild's too)
  let [cat, diff] = stats.error !== errBefore ? ["BAD", null] : classifyTransform(ref, refError, fast);
  if (cat !== "ok" && cat !== "okError" && cat !== "bail" && cat !== "bothFail") cat = "BAD";
  counts[cat]++;
  if (cat === "BAD") console.log("BAD", JSON.stringify(v), JSON.stringify(input), JSON.stringify(base), "\n  ref:", JSON.stringify(ref && ref.code), ref && ref.warnings.map((w) => w.text), "\n  fast:", JSON.stringify(fast && fast.code), stats.lastError && stats.lastError.message, diff || "");
}
console.log(`defines: ok ${counts.ok}, okError ${counts.okError}, bail ${counts.bail}, bothFail ${counts.bothFail}, BAD ${counts.BAD}`);
process.exit(counts.BAD === 0 ? 0 : 1);
