// The Node API: lib/main.js vs esbuild-wasm's lib/main.js (the original
// package), both on the real file system: transform/transformSync,
// build/buildSync (write: false and write: true, plugins, errors),
// formatMessages(Sync), analyzeMetafile(Sync), context() (rebuild, cancel,
// dispose, watch mode picking up a change), a build of more than 4096 files,
// inputs nested too deeply for a small stack (async and sync), version,
// initialize(), and that the process exits on its own afterwards.
//
// usage: node test/node-api.mjs [--verbose]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const VERBOSE = process.argv.includes("--verbose");

const fast = require("../lib/main.js");
const ref = require("esbuild-wasm/lib/main.js");

let ok = 0;
let bad = 0;
function compare(what, a, b) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja === jb) {
    ok++;
    if (VERBOSE) console.log("ok   " + what);
    return;
  }
  bad++;
  let i = 0;
  while (i < ja.length && ja[i] === jb[i]) i++;
  console.log(`DIFF ${what}\n  esbuild-wasm: ${ja.slice(Math.max(0, i - 200), i + 300)}\n  fast:         ${jb.slice(Math.max(0, i - 200), i + 300)}`);
}
function check(cond, what, detail) {
  if (cond) ok++;
  else {
    bad++;
    console.log("FAIL " + what + (detail !== undefined ? "\n  " + JSON.stringify(detail).slice(0, 500) : ""));
  }
}

const settle = async (f) => {
  try {
    return { res: await f() };
  } catch (e) {
    return { err: e.message, errors: e.errors, warnings: e.warnings };
  }
};
const settleSync = (f) => {
  try {
    return { res: f() };
  } catch (e) {
    return { err: e.message, errors: e.errors, warnings: e.warnings };
  }
};
const outputs = (r) =>
  r.res && r.res.outputFiles ? { ...r.res, outputFiles: r.res.outputFiles.map((f) => [f.path, f.hash, Buffer.from(f.contents).toString("latin1")]) } : r;

// A project
const root = join(tmpdir(), "fast-esbuild-node-api-" + process.pid);
rmSync(root, { recursive: true, force: true });
function write(rel, contents) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), contents);
}
write("package.json", JSON.stringify({ name: "p" }));
write("src/index.ts", 'import { h } from "./h";\nimport "./s.css";\nexport const v: number = h(2);\n');
write("src/h.ts", "export const h = (x: number) => x * 21;\n");
write("src/s.css", ".a { color: #ff0000 }\n");
write("src/bad.js", 'import "./nope";\nlet = 1;\n');
write("src/warn.js", "if (x === NaN) y();\n");

// transform / transformSync
for (const [input, opts] of [
  ["let x: number = 1", { loader: "ts" }],
  ["let = ", {}],
  ["if (x === NaN) y()", { sourcemap: true }],
  [".a { color: #ff0000 }", { loader: "css", minify: true }],
  ["x", { target: "bogus" }],
  [new Uint8Array([0x61, 0xff]), {}],
]) {
  compare(`transform ${JSON.stringify(input)} ${JSON.stringify(opts)}`, await settle(() => ref.transform(input, opts)), await settle(() => fast.transform(input, opts)));
  compare(`transformSync ${JSON.stringify(input)} ${JSON.stringify(opts)}`, settleSync(() => ref.transformSync(input, opts)), settleSync(() => fast.transformSync(input, opts)));
}

// build / buildSync
const buildCases = [
  ["bundle", { entryPoints: ["src/index.ts"], bundle: true, outdir: "out", write: false, metafile: true }],
  ["errors", { entryPoints: ["src/bad.js"], bundle: true, outdir: "out", write: false, logLevel: "silent" }],
  ["warnings", { entryPoints: ["src/warn.js"], outdir: "out", write: false, logLevel: "silent" }],
  ["minify sourcemap", { entryPoints: ["src/index.ts"], bundle: true, outdir: "out", write: false, minify: true, sourcemap: true }],
  ["missing entry", { entryPoints: ["src/nope.ts"], write: false, logLevel: "silent" }],
  ["invalid option", { entryPoints: ["src/index.ts"], write: false, format: "bogus" }],
];
for (const [name, opts] of buildCases) {
  const o = { absWorkingDir: root, ...opts };
  compare(`build ${name}`, outputs(await settle(() => ref.build(o))), outputs(await settle(() => fast.build(o))));
  compare(`buildSync ${name}`, outputs(settleSync(() => ref.buildSync(o))), outputs(settleSync(() => fast.buildSync(o))));
}

// write: true (the files on disk)
function listFiles(dir, out = {}) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(p, out);
    else out[relative(root, p).split("\\").join("/")] = readFileSync(p).toString("latin1");
  }
  return out;
}
for (const [name, sync] of [
  ["build write", false],
  ["buildSync write", true],
]) {
  const o = { absWorkingDir: root, entryPoints: ["src/index.ts"], bundle: true, outdir: "out-w", sourcemap: true, metafile: true };
  const results = [];
  for (const lib of [ref, fast]) {
    rmSync(join(root, "out-w"), { recursive: true, force: true });
    const r = sync ? settleSync(() => lib.buildSync(o)) : await settle(() => lib.build(o));
    results.push({ r, files: listFiles(join(root, "out-w")) });
  }
  compare(name, results[0], results[1]);
}

// plugins (async only: the sync APIs reject them)
{
  const plugin = (log) => ({
    name: "p",
    setup(b) {
      b.onStart(() => {
        log.push("start");
      });
      b.onResolve({ filter: /^virtual:/ }, (args) => ({ path: args.path, namespace: "v" }));
      b.onLoad({ filter: /.*/, namespace: "v" }, async (args) => {
        const r = await b.resolve("./h", { resolveDir: join(root, "src"), kind: "import-statement" });
        return { contents: `export default ${JSON.stringify(args.path)}; export { h } from ${JSON.stringify(r.path)}`, resolveDir: root };
      });
      b.onEnd((r) => {
        log.push("end " + r.errors.length);
      });
      b.onDispose(() => log.push("dispose"));
    },
  });
  const run = async (lib) => {
    const log = [];
    const r = await settle(() =>
      lib.build({ absWorkingDir: root, stdin: { contents: 'import x, { h } from "virtual:a"; console.log(x, h)', resolveDir: root }, bundle: true, write: false, plugins: [plugin(log)] }),
    );
    // (onDispose callbacks run in a setTimeout after the build settles)
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { r: outputs(r), log };
  };
  compare("plugins", await run(ref), await run(fast));
  compare("plugins in buildSync", settleSync(() => ref.buildSync({ absWorkingDir: root, entryPoints: ["src/index.ts"], write: false, plugins: [plugin([])] })), settleSync(() => fast.buildSync({ absWorkingDir: root, entryPoints: ["src/index.ts"], write: false, plugins: [plugin([])] })));
}

// formatMessages / analyzeMetafile
{
  const msgs = [{ text: "hi", location: { file: "f.js", line: 1, column: 0, lineText: "hi there", suggestion: "x" }, notes: [{ text: "note" }] }];
  for (const opts of [{ kind: "error" }, { kind: "warning", color: true, terminalWidth: 20 }, { kind: "bogus" }]) {
    compare(`formatMessages ${JSON.stringify(opts)}`, await settle(() => ref.formatMessages(msgs, opts)), await settle(() => fast.formatMessages(msgs, opts)));
    compare(`formatMessagesSync ${JSON.stringify(opts)}`, settleSync(() => ref.formatMessagesSync(msgs, opts)), settleSync(() => fast.formatMessagesSync(msgs, opts)));
  }
  const meta = (await ref.build({ absWorkingDir: root, entryPoints: ["src/index.ts"], bundle: true, outdir: "out", write: false, metafile: true })).metafile;
  for (const opts of [{}, { verbose: true, color: true }]) {
    compare(`analyzeMetafile ${JSON.stringify(opts)}`, await settle(() => ref.analyzeMetafile(meta, opts)), await settle(() => fast.analyzeMetafile(meta, opts)));
    compare(`analyzeMetafileSync ${JSON.stringify(opts)}`, settleSync(() => ref.analyzeMetafileSync(JSON.stringify(meta), opts)), settleSync(() => fast.analyzeMetafileSync(JSON.stringify(meta), opts)));
  }
}

// context(): rebuild, cancel, dispose
{
  const run = async (lib) => {
    const ctx = await lib.context({ absWorkingDir: root, entryPoints: ["src/index.ts"], bundle: true, write: false, outdir: "out" });
    const a = outputs(await settle(() => ctx.rebuild()));
    const b = outputs(await settle(() => ctx.rebuild()));
    await ctx.cancel();
    await ctx.dispose();
    const c = await settle(() => ctx.rebuild());
    return { a, b, c };
  };
  compare("context rebuild/dispose", await run(ref), await run(fast));
}

// watch mode: a change to a file triggers a rebuild
{
  const run = async (lib, tag) => {
    const file = join(root, `src/watched-${tag}.js`);
    writeFileSync(file, "export const w = 1;\n");
    const results = [];
    let resolveNext;
    const next = () => new Promise((r) => (resolveNext = r));
    const ctx = await lib.context({
      absWorkingDir: root,
      entryPoints: [file],
      write: false,
      logLevel: "silent",
      plugins: [{ name: "w", setup: (b) => b.onEnd((r) => (results.push(r.outputFiles.map((f) => f.text)), resolveNext && resolveNext())) }],
    });
    let p = next();
    await ctx.watch();
    await p;
    p = next();
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(file, "export const w = 2;\n");
    const timeout = new Promise((r) => setTimeout(() => r("timeout"), 15000));
    const got = await Promise.race([p, timeout]);
    await ctx.dispose();
    return { got: got === "timeout" ? "timeout" : "rebuilt", results };
  };
  compare("watch", await run(ref, "ref"), await run(fast, "fast"));
}

// more than 4096 files
{
  const n = 5000;
  let entry = "";
  for (let i = 0; i < n; i++) {
    write(`many/m${i}.js`, `export const v${i} = ${i};\n`);
    entry += `export { v${i} } from "./m${i}.js";\n`;
  }
  write("many/entry.js", entry);
  const o = { absWorkingDir: root, entryPoints: ["many/entry.js"], bundle: true, write: false, minify: true, metafile: true, format: "esm" };
  const a = outputs(await settle(() => ref.build(o)));
  const b = outputs(await settle(() => fast.build(o)));
  compare(`build of ${n + 1} files`, a, b);
}

// nesting too deep for a small stack (vs native esbuild: esbuild-wasm itself
// runs out of JavaScript stack in its Go code and crashes)
{
  const ref = require("esbuild");
  const depth = 20000;
  const input = "x = " + "[".repeat(depth) + "]".repeat(depth) + ";\n";
  const css = ".a { b: " + "(".repeat(depth) + ")".repeat(depth) + " }\n";
  write("deep/deep.js", input);
  compare("deep transform", await settle(() => ref.transform(input, { minify: true })), await settle(() => fast.transform(input, { minify: true })));
  compare("deep transformSync", settleSync(() => ref.transformSync(input, { minify: true })), settleSync(() => fast.transformSync(input, { minify: true })));
  compare("deep css transform", await settle(() => ref.transform(css, { loader: "css" })), await settle(() => fast.transform(css, { loader: "css" })));
  const o = { absWorkingDir: root, entryPoints: ["deep/deep.js"], write: false, minify: true };
  compare("deep build", outputs(await settle(() => ref.build(o))), outputs(await settle(() => fast.build(o))));
  compare("deep buildSync", outputs(settleSync(() => ref.buildSync(o))), outputs(settleSync(() => fast.buildSync(o))));
}

// version, initialize()
compare("version", ref.version, fast.version);
for (const opts of [{}, { worker: false }, { wasmURL: "x" }, { wasmModule: 1 }, { nope: 1 }]) {
  compare(`initialize(${JSON.stringify(opts)})`, await settle(() => ref.initialize(opts)), await settle(() => fast.initialize(opts)));
}

ref.stop();
require("esbuild").stop();
fast.stop();
rmSync(root, { recursive: true, force: true });

// the process exits by itself after a build (no handle keeps it alive)
{
  const script = `const e = require(${JSON.stringify(join(here, "..", "lib", "main.js"))}); e.build({ stdin: { contents: "x" }, write: false }).then((r) => console.log(r.outputFiles[0].text.trim())); console.log(e.transformSync("let a = 1").code.trim());`;
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 30000 });
  check(r.status === 0 && r.stdout === "let a = 1;\nx;\n", "a script exits on its own", { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr.slice(0, 300) });
}

console.log(`node-api: ${ok} same, ${bad} different`);
process.exit(bad > 0 ? 1 : 0);
