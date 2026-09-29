// The command line: bin/esbuild vs esbuild-wasm's bin/esbuild (the original
// package; both on this Node). Each case runs in a fresh copy of a small
// project; the exit code, stdout, stderr (the build time normalized) and every
// file the command writes are compared.
//
// usage: node test/cli.mjs [--filter re] [--verbose]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const FILTER = new RegExp(args.includes("--filter") ? args[args.indexOf("--filter") + 1] : ".");
const VERBOSE = args.includes("--verbose");

const refBin = join(dirname(require.resolve("esbuild-wasm/package.json")), "bin", "esbuild");
const fastBin = join(here, "..", "bin", "esbuild");

const files = {
  "package.json": JSON.stringify({ name: "project", version: "1.0.0" }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { jsxFactory: "h", jsxFragmentFactory: "Fragment" } }),
  "src/index.ts": 'import { helper } from "./helper";\nimport data from "./data.json";\nimport "./style.css";\nexport const answer: number = helper(data.value);\nconsole.log(answer);\n',
  "src/helper.ts": "export function helper(x: number): number { return x * 2 }\nexport function unused() { return 1 }\n",
  "src/data.json": '{ "value": 21, "other": [1, 2, 3] }',
  "src/style.css": '@import "./base.css";\n.a { color: #ff0000; background: url(./img.png) }\n',
  "src/base.css": "body { margin: 0 }\n",
  "src/img.png": Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex"),
  "src/app.jsx": "export const App = () => <><div class='x'>hi</div></>;\n",
  "src/warn.js": "if (x === NaN) y();\nexport default typeof x == 'undefined';\n",
  "src/error.js": "let = 1;\n",
  "src/missing.js": 'import "./nope";\n',
  "src/lazy.js": 'export const load = () => import("./helper2.js");\n',
  "src/lazy2.js": 'export const load = () => import("./helper2.js");\n',
  "src/helper2.js": "export const h = 2;\n",
  "src/mangle.js": "x.foo_ = 1; x.bar_ = 2; console.log(x.foo_);\n",
  "src/node.js": 'import fs from "fs"; import path from "node:path"; console.log(fs, path);\n',
  "cache.json": JSON.stringify({ foo_: "F" }),
};

const cases = [
  ["version", ["--version"]],
  ["help", ["--help"]],
  ["no arguments", []],
  ["unknown flag", ["--bogus"]],
  ["bad value", ["--format=bogus", "src/index.ts"]],
  ["stdin", ["--loader=ts"], "let x: number = 1\nexport default x\n"],
  ["stdin minify", ["--minify", "--loader=jsx"], "export const a = <div>{1}</div>;"],
  ["stdin sourcemap inline", ["--sourcemap=inline", "--sourcefile=a.ts", "--loader=ts"], "let x: number = 1;\nconsole.log(x)\n"],
  ["stdin css", ["--loader=css", "--minify"], ".a { color: #ff0000 } .b { margin: 0 0 0 0 }"],
  ["stdin error", [], "let = ;"],
  ["stdin warning", [], "if (x === NaN) y()"],
  ["stdin format cjs", ["--format=cjs"], "export const a = 1; export default 2;"],
  ["bundle stdout", ["src/index.ts", "--bundle", "--loader:.png=dataurl"]],
  ["bundle outfile", ["src/index.ts", "--bundle", "--outfile=out/bundle.js", "--loader:.png=file"]],
  ["bundle outdir minify sourcemap", ["src/index.ts", "--bundle", "--outdir=out", "--minify", "--sourcemap", "--loader:.png=file"]],
  ["bundle metafile analyze", ["src/index.ts", "--bundle", "--outdir=out", "--metafile=out/meta.json", "--analyze", "--loader:.png=file"]],
  ["bundle analyze verbose", ["src/index.ts", "--bundle", "--outdir=out", "--analyze=verbose", "--loader:.png=base64"]],
  ["splitting", ["src/lazy.js", "src/lazy2.js", "--bundle", "--splitting", "--format=esm", "--outdir=out", "--chunk-names=chunks/[name]-[hash]"]],
  ["two entries", ["src/lazy.js", "src/lazy2.js", "--bundle", "--outdir=out"]],
  ["jsx tsconfig", ["src/app.jsx", "--bundle", "--outdir=out"]],
  ["tsconfig raw", ["src/app.jsx", "--outdir=out", '--tsconfig-raw={"compilerOptions":{"jsx":"react-jsx"}}']],
  ["warnings", ["src/warn.js", "--bundle", "--outdir=out"]],
  ["syntax error", ["src/error.js", "--bundle", "--outdir=out"]],
  ["missing import", ["src/missing.js", "--bundle", "--outdir=out"]],
  ["missing entry", ["src/nope.js", "--bundle", "--outdir=out"]],
  ["log level verbose", ["src/index.ts", "--bundle", "--outdir=out", "--log-level=verbose", "--loader:.png=file"]],
  ["log level debug", ["src/missing.js", "--bundle", "--outdir=out", "--log-level=debug"]],
  ["log limit", ["src/warn.js", "--outdir=out", "--log-limit=1"]],
  ["color", ["src/warn.js", "--outdir=out", "--color=true"]],
  ["log override", ["src/warn.js", "--outdir=out", "--log-override:equals-nan=error"]],
  ["define external", ["src/node.js", "--bundle", "--platform=node", "--define:process.env.NODE_ENV=\"production\"", "--outfile=out/n.js"]],
  ["platform browser node import", ["src/node.js", "--bundle", "--outdir=out"]],
  ["mangle cache", ["src/mangle.js", "--mangle-props=_$", "--mangle-cache=cache.json", "--outdir=out"]],
  ["legal comments external", ["src/index.ts", "--bundle", "--outdir=out", "--legal-comments=external", "--loader:.png=file"]],
  ["css entry", ["src/style.css", "--bundle", "--outdir=out", "--loader:.png=dataurl", "--minify"]],
  ["target lowering", ["src/index.ts", "--bundle", "--target=es5", "--outdir=out", "--loader:.png=file"]],
  ["overwrite input", ["src/helper2.js", "--outfile=src/helper2.js"]],
  ["allow overwrite", ["src/helper2.js", "--outfile=src/helper2.js", "--allow-overwrite"]],
  ["serve", ["src/index.ts", "--serve"]],
  ["watch and serve", ["src/index.ts", "--serve", "--watch"]],
  ["trace flag", ["--trace=trace.out", "src/helper2.js"]],
  ["heap flag", ["--heap=heap.out", "src/helper2.js"]],
  ["cpuprofile flag", ["--cpuprofile=cpu.out", "src/helper2.js"]],
  ["out extension", ["src/helper2.js", "--outdir=out", "--out-extension:.js=.mjs", "--entry-names=[dir]/[name]-x"]],
  ["banner footer", ["src/helper2.js", "--banner:js=//banner", "--footer:js=//footer", "--outfile=out/x.js"]],
  ["packages external", ["src/index.ts", "--bundle", "--packages=external", "--outdir=out", "--loader:.png=file"]],
  ["glob entry", ["src/lazy*.js", "--outdir=out"]],
  ["entry with name", ["main=src/helper2.js", "--outdir=out"]],
  ["outbase", ["src/helper2.js", "src/lazy.js", "--outbase=.", "--outdir=out"]],
  ["write false", ["src/helper2.js", "--outdir=out", "--write=false"]],
];

function listFiles(root, dir = root, out = {}) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(root, p, out);
    else out[relative(root, p).split("\\").join("/")] = readFileSync(p).toString("latin1");
  }
  return out;
}

function normalize(text) {
  return text.replace(/Done in [0-9]+ms/g, "Done in <n>ms").replace(/[0-9]+ms/g, "<n>ms");
}

function runCase(bin, argv, stdin) {
  // (the same directory for both, the paths show up in the debug logs)
  const root = join(tmpdir(), "fast-esbuild-cli-" + process.pid);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root);
  try {
    for (const [name, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), contents);
    }
    const before = listFiles(root);
    const r = spawnSync(process.execPath, [bin, ...argv], { cwd: root, input: stdin === undefined ? "" : stdin, encoding: "latin1", timeout: 60000, env: { ...process.env, NO_COLOR: "" } });
    const after = listFiles(root);
    const changed = {};
    for (const [name, contents] of Object.entries(after)) if (before[name] !== contents) changed[name] = contents;
    return { status: r.status, signal: r.signal, stdout: normalize(r.stdout), stderr: normalize(r.stderr), files: changed };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

let ok = 0;
let bad = 0;
for (const [name, argv, stdin] of cases) {
  if (!FILTER.test(name)) continue;
  const a = runCase(refBin, argv, stdin);
  const b = runCase(fastBin, argv, stdin);
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja === jb) {
    ok++;
    if (VERBOSE) console.log("ok   " + name);
  } else {
    bad++;
    let i = 0;
    while (i < ja.length && ja[i] === jb[i]) i++;
    console.log(`DIFF ${name}: ${argv.join(" ")}\n  esbuild-wasm: ${ja.slice(Math.max(0, i - 200), i + 300)}\n  fast:         ${jb.slice(Math.max(0, i - 200), i + 300)}`);
  }
}
console.log(`cli: ${ok} same, ${bad} different`);
process.exit(bad > 0 ? 1 : 0);
