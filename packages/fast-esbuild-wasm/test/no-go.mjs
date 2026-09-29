// Nothing runs Go: the package ships no Go binary or glue, the builds contain
// none of Go's JavaScript support code, and using every API (the browser
// builds, lib/main.js, bin/esbuild) instantiates no WebAssembly module that
// imports Go's runtime ("gojs") and starts no child process. Also: the engine
// has no fallback path left ("bail"), and the package directory holds no Go
// source.
//
// usage: node test/no-go.mjs
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import childProcess from "node:child_process";
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "..");

let ok = 0;
let bad = 0;
function check(cond, what, detail) {
  if (cond) ok++;
  else {
    bad++;
    console.log("FAIL " + what + (detail !== undefined ? "\n  " + String(JSON.stringify(detail)).slice(0, 800) : ""));
  }
}

// 1. The published files
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
for (const f of pkg.files) {
  check(!/\.wasm$|wasm_exec/.test(f), `package.json "files" has no Go binary or glue: ${f}`);
  check(existsSync(join(pkgDir, f)), `the published file exists: ${f}`);
}
for (const f of ["esbuild.wasm", "wasm_exec.js", "wasm_exec_node.js", "esbuild.wasm.stamp"]) {
  check(!existsSync(join(pkgDir, f)), `no ${f} in the package directory`);
}
{
  const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: pkgDir, encoding: "utf8", shell: process.platform === "win32" ? true : undefined });
  let packed = null;
  try {
    packed = JSON.parse(r.stdout)[0].files.map((f) => f.path);
  } catch {}
  check(packed !== null, "npm pack --dry-run", r.stderr);
  if (packed !== null) check(packed.every((p) => !/\.wasm$|wasm_exec|\.go$/.test(p)), "the tarball has no Go binary, glue or source", packed);
}

// 2. The builds contain none of Go's JavaScript support code (wasm_exec.js)
const GO_MARKERS = ["wasm_exec", "gojs", "runtime.wasmExit", "syscall/js.valueGet", "globalThis.Go", "_pendingEvent", "go.importObject", "_makeFuncWrapper"];
for (const f of ["lib/main.js", "lib/browser.js", "lib/browser.min.js", "esm/browser.js", "esm/browser.min.js", "bin/esbuild", "node.mjs"]) {
  const text = readFileSync(join(pkgDir, f), "utf8");
  const found = GO_MARKERS.filter((m) => text.includes(m));
  check(found.length === 0, `${f} has none of Go's support code`, found);
}

// 3. Using the APIs instantiates no Go module and starts no child process
const instantiated = [];
const record = (mod) => {
  try {
    instantiated.push(WebAssembly.Module.imports(mod).map((i) => i.module));
  } catch {}
};
const OrigInstance = WebAssembly.Instance;
WebAssembly.Instance = function (mod, imports) {
  record(mod);
  return new OrigInstance(mod, imports);
};
WebAssembly.Instance.prototype = OrigInstance.prototype;
const origInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = function (src, imports) {
  if (src instanceof WebAssembly.Module) record(src);
  return origInstantiate.call(this, src, imports).then((r) => (r instanceof OrigInstance ? r : (record(r.module), r)));
};
const spawned = [];
for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "fork", "exec", "execSync"]) {
  const orig = childProcess[name];
  childProcess[name] = function (...args) {
    spawned.push([name, String(args[0]), args[1]]);
    return orig.apply(this, args);
  };
}
{
  const main = require("../lib/main.js");
  const r1 = await main.transform("let x: number = 1", { loader: "ts" });
  const r2 = main.transformSync("let y = 2");
  const r3 = await main.build({ stdin: { contents: "import('./x')", loader: "js" }, write: false, bundle: false });
  const r4 = main.buildSync({ stdin: { contents: "x()" }, write: false });
  const r5 = await main.formatMessages([{ text: "t" }], { kind: "error" });
  const r6 = main.analyzeMetafileSync({ inputs: {}, outputs: {} });
  const ctx = await main.context({ stdin: { contents: "y()" }, write: false });
  const r7 = await ctx.rebuild();
  await ctx.dispose();
  check(r1.code === "let x = 1;\n" && r2.code === "let y = 2;\n" && r3.outputFiles.length === 1 && r4.outputFiles.length === 1 && r5.length === 1 && typeof r6 === "string" && r7.outputFiles.length === 1, "lib/main.js APIs work");
  main.stop();
}
{
  const node = (await import("../node.mjs")).default;
  await node.initialize({});
  const r = await node.build({ stdin: { contents: "a()" }, write: false });
  check(r.outputFiles.length === 1, "node.mjs build works");
  await node.stop();
}
{
  globalThis.self ??= globalThis;
  const browser = require("../lib/browser.js");
  await browser.initialize({ wasmModule: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])), worker: false });
  const r = await browser.transform("a?.b", { target: "es2019" });
  check(r.code.includes("a == null"), "lib/browser.js transform works");
  await browser.stop();
}
check(instantiated.every((imports) => !imports.includes("gojs") && !imports.includes("go")), "no WebAssembly module importing Go's runtime was instantiated", instantiated);
check(spawned.length === 0, "no child process was started", spawned);

// lib/main.js with the spy in every thread (its *Sync calls use worker threads)
{
  const main = JSON.stringify(join(pkgDir, "lib", "main.js"));
  const script = `const e = require(${main});
e.buildSync({ stdin: { contents: "x()" }, write: false });
e.transformSync("let a = 1");
e.formatMessagesSync([{ text: "t" }], { kind: "error" });
e.build({ stdin: { contents: "y()" }, write: false }).then(() => console.log("done"));`;
  const r = spawnSync(process.execPath, ["--require", join(here, "no-go-spy.cjs"), "-e", script], { encoding: "utf8" });
  check(r.status === 0 && r.stdout === "done\n", "lib/main.js in a process of its own", { status: r.status, stdout: r.stdout, stderr: r.stderr });
  check(!/SPAWNED|GOJS/.test(r.stderr), "lib/main.js (every thread) starts no child process and instantiates no Go module", r.stderr);
}

// bin/esbuild: one process (the CLI runs in a worker thread of it)
{
  const r = spawnSync(process.execPath, ["--require", join(here, "no-go-spy.cjs"), join(pkgDir, "bin", "esbuild"), "--loader=ts", "--minify"], { input: "let x: number = 1; export { x }", encoding: "utf8" });
  check(r.status === 0 && r.stdout === "let e=1;export{e as x};\n", "bin/esbuild works", { status: r.status, stdout: r.stdout, stderr: r.stderr });
  check(!/SPAWNED|GOJS/.test(r.stderr), "bin/esbuild starts no child process and instantiates no Go module", r.stderr);
}

// 4. No fallback path is left in the engine, and no Go source in the package
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const all = walk(pkgDir);
check(all.every((p) => !p.endsWith(".go")), "no Go source in the package directory", all.filter((p) => p.endsWith(".go")));
for (const p of all.filter((p) => /[\\/]src[\\/][^\\/]+\.mts$/.test(p))) {
  const text = readFileSync(p, "utf8");
  const hits = text.split("\n").filter((line) => /\bbail(With)?\(|\bBAIL\b|BAIL_INFO|bail\.mjs/.test(line));
  check(hits.length === 0, `${p.slice(pkgDir.length + 1)} has no bail path`, hits);
}

console.log(`no-go: ${ok} ok, ${bad} failed`);
process.exit(bad > 0 ? 1 : 0);
