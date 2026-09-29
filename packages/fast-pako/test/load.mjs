// How the package loads: no copy of pako anywhere (package files, minified
// browser bundle), nothing done with WebAssembly at import (decoding and
// compiling happen on first use), and without WebAssembly a clear Error on
// first use.
//   node packages/fast-pako/test/load.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0, fails = 0;
const ok = (c, what) => {
  checks++;
  if (!c) {
    fails++;
    console.log("FAIL", what);
  }
};

// identifiers and strings of pako's own code (its zlib port and its build);
// none of them occurs in fast-pako's JavaScript
const PAKO_MARKS = ["Nodeca", "pending_buf", "sym_buf", "bi_valid", "window_size", "hash_shift", "lit_bufsize", "strstart", "lookahead", "lencode", "distcode", "deflateInfo", "inflateInfo", "match_available", "good_match"];

// ---- the package's files
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
ok(!existsSync(join(here, "vendor")), "no vendor/ directory");
ok(!pkg.files.some((f) => /vendor|pako\.(esm|min)/.test(f)), "package files list no vendored pako: " + pkg.files);
for (const f of pkg.files.filter((f) => /\.m?js$/.test(f))) {
  const t = readFileSync(join(here, f), "utf8");
  for (const m of PAKO_MARKS) ok(!t.includes(m), `${f} contains "${m}"`);
}

// ---- the minified browser bundle
{
  const r = await build({
    stdin: { contents: `import pako from "./index.mjs"; globalThis.x = pako;`, resolveDir: here, loader: "js" },
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  const out = r.outputFiles[0].text;
  for (const m of PAKO_MARKS) ok(!out.includes(m), `bundle contains "${m}"`);
  ok(!/from\s*["']pako/.test(out) && !out.includes("node_modules/pako"), "bundle imports no pako");
  console.log(`bundle: ${out.length} bytes minified`);
}

// ---- import does no wasm work; the first call does
const child = (code) => execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", cwd: here });
{
  const url = pathToFileURL(join(here, "index.mjs")).href;
  const out = child(`
    const calls = [];
    for (const k of ["Module", "Instance", "compile", "instantiate", "validate", "compileStreaming", "instantiateStreaming"]) {
      const orig = WebAssembly[k];
      const wrapped = function (...a) { calls.push(k); return new.target ? Reflect.construct(orig, a, new.target) : orig.apply(this, a); };
      wrapped.prototype = orig.prototype;
      WebAssembly[k] = wrapped;
    }
    const atobCalls = [];
    const B = Buffer.from; Buffer.from = function (...a) { if (a[1] === "base64") atobCalls.push(1); return B.apply(this, a); };
    const m = await import(${JSON.stringify(url)});
    const atImport = calls.length + atobCalls.length;
    // option errors need no wasm either
    let e1; try { m.deflate("x", { level: 42 }); } catch (e) { e1 = e.message; }
    const afterBadOptions = calls.length;
    const r = m.inflate(m.deflate("hello"), { to: "string" });
    console.log(JSON.stringify({ atImport, afterBadOptions, e1, after: calls.length, r }));
  `);
  const j = JSON.parse(out);
  ok(j.atImport === 0, "no WebAssembly / base64 work at import (" + j.atImport + ")");
  ok(j.e1 === "stream error" && j.afterBadOptions === 0, "invalid options throw without loading wasm");
  ok(j.after > 0 && j.r === "hello", "first call loads the wasm and works");
}

// ---- without WebAssembly: a clear Error on first use (import still works)
{
  const url = pathToFileURL(join(here, "index.mjs")).href;
  const out = child(`
    globalThis.WebAssembly = undefined;
    const m = await import(${JSON.stringify(url)});
    const r = [];
    for (const f of [() => m.inflate(new Uint8Array([120, 156, 3, 0, 0, 0, 0, 1])), () => m.deflate("x"), () => new m.Inflate(), () => new m.Deflate({ gzip: true })]) {
      try { f(); r.push("no error"); } catch (e) { r.push(e.constructor.name + ": " + e.message); }
    }
    console.log(JSON.stringify(r));
  `);
  const r = JSON.parse(out);
  for (const m of r) ok(/^Error: fast-pako needs WebAssembly/.test(m), "without WebAssembly: " + m);
}

console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
