// How deeply nested an input can be before the call stack runs out, per
// construct, for this package in the calling thread vs esbuild-wasm in the
// calling thread (both browser builds with worker: false, in Node, whose
// main-thread stack is V8's default like a browser's), for transform() and
// for build(). Every probe runs in a fresh process; the maximum depth is found
// by bisection. Fails if this package handles less depth than esbuild-wasm
// for any construct. Beyond its limit this package must report esbuild's
// panic message ("runtime error: stack overflow"), and its results below the
// limit must equal esbuild-wasm's.
//
// usage: node test/depth.mjs [--filter re] [--api transform|build] [--ref-cache file] [--max N]
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// [name, loader, generator]
export const CONSTRUCTS = [
  ["array", "js", (d) => "x = " + "[".repeat(d) + "]".repeat(d) + ";\n"],
  ["object", "js", (d) => "x = " + "{a:".repeat(d) + "1" + "}".repeat(d) + ";\n"],
  ["if-nested", "js", (d) => "if (a) ".repeat(d) + "x();\n"],
  ["else-if-chain", "js", (d) => "if (a) x();" + " else if (a) x();".repeat(d) + "\n"],
  ["block", "js", (d) => "{".repeat(d) + "x();" + "}".repeat(d) + "\n"],
  ["function", "js", (d) => "x = " + "(function () { return ".repeat(d) + "1" + " })()".repeat(d) + ";\n"],
  ["arrow", "js", (d) => "x = " + "() => ".repeat(d) + "1;\n"],
  ["call", "js", (d) => "x = " + "f(".repeat(d) + "1" + ")".repeat(d) + ";\n"],
  ["member-chain", "js", (d) => "x = a" + ".b".repeat(d) + ";\n"],
  ["call-chain", "js", (d) => "x = a" + ".b()".repeat(d) + ";\n"],
  ["index-chain", "js", (d) => "x = a" + "[0]".repeat(d) + ";\n"],
  ["paren", "js", (d) => "x = " + "(".repeat(d) + "1" + ")".repeat(d) + ";\n"],
  ["template", "js", (d) => "x = " + "`${".repeat(d) + "1" + "}`".repeat(d) + ";\n"],
  ["class", "js", (d) => "x = " + "class { m() { return ".repeat(d) + "1" + " } }".repeat(d) + ";\n"],
  ["unary", "js", (d) => "x = " + "!".repeat(d) + "a;\n"],
  ["assign-chain", "js", (d) => "a = ".repeat(d) + "1;\n"],
  ["plus-strings", "js", (d) => "x = " + '"a" + '.repeat(d) + '"a";\n'],
  ["plus-idents", "js", (d) => "x = " + "a + ".repeat(d) + "a;\n"],
  ["logical-or", "js", (d) => "x = " + "a || ".repeat(d) + "a;\n"],
  ["comma", "js", (d) => "x = (" + "a, ".repeat(d) + "a);\n"],
  ["ternary-chain", "js", (d) => "x = " + "a ? b : ".repeat(d) + "c;\n"],
  ["ternary-nested", "js", (d) => "x = " + "a ? ".repeat(d) + "1" + " : 2".repeat(d) + ";\n"],
  ["jsx", "jsx", (d) => "x = " + "<a>".repeat(d) + "</a>".repeat(d) + ";\n"],
  ["ts-generic", "ts", (d) => "let x: " + "Array<".repeat(d) + "number" + ">".repeat(d) + ";\n"],
  ["ts-object-type", "ts", (d) => "let x: " + "{ a: ".repeat(d) + "number" + " }".repeat(d) + ";\n"],
  ["ts-union", "ts", (d) => "let x: " + "A | ".repeat(d) + "B;\n"],
  ["css-nesting", "css", (d) => "a { ".repeat(d) + "color: red" + " }".repeat(d) + "\n"],
  ["css-parens", "css", (d) => "a { b: " + "(".repeat(d) + ")".repeat(d) + " }\n"],
  ["css-functions", "css", (d) => "a { b: " + "f(".repeat(d) + "1" + ")".repeat(d) + " }\n"],
  ["css-calc", "css", (d) => "a { width: " + "calc(1px + ".repeat(d) + "1px" + ")".repeat(d) + " }\n"],
  ["css-is", "css", (d) => ":is(".repeat(d) + "a" + ")".repeat(d) + " { color: red }\n"],
  ["css-media", "css", (d) => "@media screen { ".repeat(d) + "a { color: red }" + " }".repeat(d) + "\n"],
  ["optional-chain", "js", (d) => "x = a" + "?.b".repeat(d) + ";\n"],
  ["new-chain", "js", (d) => "x = " + "new ".repeat(d) + "a;\n"],
  ["destructuring", "js", (d) => "let " + "[".repeat(d) + "x" + "]".repeat(d) + " = y;\n"],
  ["ts-fn-type", "ts", (d) => "let x: " + "() => ".repeat(d) + "number;\n"],
  ["json", "json", (d) => '{"a":'.repeat(d) + "1" + "}".repeat(d) + "\n"],
];

const args = process.argv.slice(2);
const argValue = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);

// A probe (in its own process): prints OK, FAIL:<message>
if (args[0] === "--probe") {
  const [, which, api, name, depthText, minify] = args;
  globalThis.self ??= globalThis;
  const [, loader, gen] = CONSTRUCTS.find((c) => c[0] === name);
  const input = gen(Number(depthText));
  let esbuild;
  if (which === "fast") {
    esbuild = require("../lib/browser.js");
    await esbuild.initialize({ wasmModule: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])), worker: false });
  } else {
    esbuild = require("esbuild-wasm/lib/browser.js");
    await esbuild.initialize({ wasmModule: new WebAssembly.Module(readFileSync(require.resolve("esbuild-wasm/esbuild.wasm"))), worker: false });
  }
  const opts = { loader, logLevel: "silent", minify: minify === "1" };
  try {
    let out;
    if (api === "transform") out = (await esbuild.transform(input, opts)).code;
    else out = (await esbuild.build({ stdin: { contents: input, loader }, write: false, logLevel: "silent", minify: minify === "1" })).outputFiles[0].text;
    process.stdout.write("OK " + out.length + " " + (await import("node:crypto")).createHash("sha1").update(out).digest("hex") + "\n");
  } catch (e) {
    process.stdout.write("FAIL " + JSON.stringify(String(e && e.message).split("\n").slice(0, 3).join(" ")).slice(0, 300) + "\n");
  }
  if (process.env.DEPTH_RSS) process.stdout.write("maxRSS " + Math.round(process.resourceUsage().maxRSS / 1024) + " MB\n");
  process.exit(0);
}

function probe(which, api, name, depth, minify) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--probe", which, api, name, String(depth), minify ? "1" : "0"], { encoding: "utf8", timeout: 300000 });
  const line = (r.stdout || "").trim().split("\n").pop() || "";
  return { ok: line.startsWith("OK"), line };
}

// The largest depth that works (bisection between lo, which works, and hi),
// and what the first depth found not to work reported (null: max works)
function maxDepth(which, api, name, minify, max) {
  let lo = 0;
  let hi = 256;
  let failed = null;
  for (;;) {
    if (hi >= max) break;
    const p = probe(which, api, name, hi, minify);
    if (!p.ok) {
      failed = p.line;
      break;
    }
    lo = hi;
    hi *= 2;
  }
  if (failed === null) {
    const p = probe(which, api, name, max, minify);
    if (p.ok) return { depth: max, failed: null };
    failed = p.line;
    hi = max;
  }
  while (hi - lo > Math.max(8, lo >> 5)) {
    const mid = (lo + hi) >> 1;
    const p = probe(which, api, name, mid, minify);
    if (p.ok) lo = mid;
    else {
      hi = mid;
      failed = p.line;
    }
  }
  return { depth: lo, failed };
}

const filter = new RegExp(argValue("--filter", "."));
const apis = argValue("--api", "transform,build").split(",");
const max = Number(argValue("--max", 200000));
const refCacheFile = argValue("--ref-cache", null);
const refCache = refCacheFile && existsSync(refCacheFile) ? JSON.parse(readFileSync(refCacheFile, "utf8")) : {};
let bad = 0;
console.log("construct".padEnd(22) + "api".padEnd(11) + "fast".padStart(9) + "esbuild-wasm".padStart(14));
for (const api of apis) {
  for (const [name] of CONSTRUCTS) {
    if (!filter.test(name)) continue;
    const key = api + " " + name;
    const ref = refCache[key] ?? maxDepth("ref", api, name, false, max).depth;
    refCache[key] = ref;
    if (refCacheFile) writeFileSync(refCacheFile, JSON.stringify(refCache, null, 2));
    // (searched up to twice esbuild-wasm's depth, at least 16384: deep
    // mode is slow, and some constructs take quadratic time in esbuild)
    const cap = Math.min(max, Math.max(16384, 2 * ref));
    const found = maxDepth("fast", api, name, false, cap);
    const fast = found.depth;
    // the outputs agree at esbuild-wasm's limit, and past ours the message is esbuild's
    let same = true;
    if (ref > 0 && fast >= ref) {
      const depth = Math.min(ref, 20000);
      const a = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--probe", "ref", api, name, String(depth), "0"], { encoding: "utf8" }).stdout;
      const b = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--probe", "fast", api, name, String(depth), "0"], { encoding: "utf8" }).stdout;
      same = a === b;
    }
    // Past the limit: esbuild's panic for a stack overflow, or (a limit of
    // JavaScript, not of the stack) an output too long for a string
    let message = "";
    let note = fast >= cap ? "  (not searched further)" : "";
    if (found.failed !== null && fast < cap) {
      if (/Cannot create a string longer than|Invalid string length/.test(found.failed)) note = "  (limit: the output is too long for a JavaScript string)";
      else if (!found.failed.includes("runtime error: stack overflow")) message = " (past the limit: " + found.failed.slice(0, 160) + ")";
    }
    const ok = fast >= ref && same && message === "";
    if (!ok) bad++;
    console.log(name.padEnd(22) + api.padEnd(11) + String(fast).padStart(9) + String(ref).padStart(14) + (ok ? note : "  FAIL" + (same ? "" : " (output differs)") + message));
  }
}
// Past deep mode's own limit (src/deep.mts: DEEP_LIMIT suspended calls,
// 3 per nested array literal) the result is esbuild's panic
if (filter.test("array")) {
  for (const api of apis) {
    const p = probe("fast", api, "array", 150000, false);
    const ok = p.line.includes("runtime error: stack overflow");
    if (!ok) bad++;
    console.log("array".padEnd(22) + api.padEnd(11) + "   150000" + "".padStart(14) + (ok ? "  (past deep mode's limit: esbuild's panic)" : "  FAIL (past deep mode's limit: " + p.line.slice(0, 160) + ")"));
  }
}
console.log(bad === 0 ? "depth: ok" : `depth: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
