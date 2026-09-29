// Size of each package against the original: what an app ships (the browser
// bundle of the imports Nodepod uses, minified, plus the wasm files it
// fetches) and what npm downloads and installs (tarball, unpacked).
//
//   node bench/size.mjs              # bundle sizes
//   node bench/size.mjs --pack       # also npm pack both sides (slow)
//   node bench/size.mjs --json out.json
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgs = path.join(root, "packages");
const nm = path.join(root, "node_modules");

// original name -> fast package directory
const FAST = {
  pako: "fast-pako",
  acorn: "fast-acorn",
  "acorn-jsx": "fast-acorn-jsx",
  "esbuild-wasm": "fast-esbuild-wasm",
  "es-module-lexer": "fast-es-module-lexer",
  "brotli-wasm": "fast-brotli-wasm",
  "@noble/hashes": "fast-noble-hashes",
};

// files fetched at run time next to the bundle (new URL(..., import.meta.url) / wasmURL)
const ASSETS = {
  "esbuild-wasm": { orig: "esbuild-wasm/esbuild.wasm", fast: null }, // (no Go binary)
  "brotli-wasm": { orig: "brotli-wasm/pkg.web/brotli_wasm_bg.wasm", fast: "fast-brotli-wasm/fastbrotli.wasm" },
};

const CASES = [
  { pkg: "pako", name: "pako (default import)", code: `import pako from "pako"; globalThis.x = pako;` },
  { pkg: "pako", name: "pako { ungzip }", code: `import { ungzip } from "pako"; globalThis.x = ungzip;` },
  { pkg: "pako", name: "pako { inflate, deflate }", code: `import { inflate, deflate } from "pako"; globalThis.x = [inflate, deflate];` },
  { pkg: "acorn", name: "acorn (namespace)", code: `import * as acorn from "acorn"; globalThis.x = acorn;` },
  { pkg: "acorn", name: "acorn { parse }", code: `import { parse } from "acorn"; globalThis.x = parse;` },
  { pkg: "acorn-jsx", name: "acorn + acorn-jsx", code: `import * as acorn from "acorn"; import jsx from "acorn-jsx"; globalThis.x = acorn.Parser.extend(jsx());` },
  { pkg: "es-module-lexer", name: "es-module-lexer { initSync, parse }", code: `import { initSync, parse } from "es-module-lexer"; globalThis.x = [initSync, parse];` },
  { pkg: "es-module-lexer", name: "es-module-lexer { init, parse }", code: `import { init, parse } from "es-module-lexer"; globalThis.x = [init, parse];` },
  { pkg: "brotli-wasm", name: "brotli-wasm (default import)", code: `import b from "brotli-wasm"; globalThis.x = b;` },
  { pkg: "@noble/hashes", name: "@noble/hashes/sha256", code: `import { sha256 } from "@noble/hashes/sha256"; globalThis.x = sha256;` },
  { pkg: "@noble/hashes", name: "@noble/hashes/sha512", code: `import { sha512 } from "@noble/hashes/sha512"; globalThis.x = sha512;` },
  { pkg: "@noble/hashes", name: "@noble/hashes/legacy { md5 }", code: `import { md5 } from "@noble/hashes/legacy"; globalThis.x = md5;` },
  { pkg: "@noble/hashes", name: "@noble/hashes/sha3 { sha3_256 }", code: `import { sha3_256 } from "@noble/hashes/sha3"; globalThis.x = sha3_256;` },
  { pkg: "@noble/hashes", name: "@noble/hashes/blake3", code: `import { blake3 } from "@noble/hashes/blake3"; globalThis.x = blake3;` },
  {
    pkg: "@noble/hashes",
    name: "@noble/hashes, Nodepod's imports",
    code: `import { scrypt } from "@noble/hashes/scrypt"; import { sha384, sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256"; import { sha1 } from "@noble/hashes/sha1";
import { md5 } from "@noble/hashes/legacy"; import { hmac } from "@noble/hashes/hmac"; import { pbkdf2 } from "@noble/hashes/pbkdf2";
globalThis.x = [scrypt, sha384, sha512, sha256, sha1, md5, hmac, pbkdf2];`,
  },
  { pkg: "esbuild-wasm", name: "esbuild-wasm (namespace)", code: `import * as esbuild from "esbuild-wasm"; globalThis.x = esbuild;` },
];

// every bare import of a replaced package (also those inside the packages,
// e.g. fast-acorn-jsx's require("acorn")) resolves from `from`, a directory whose
// node_modules holds either the originals or the fast packages
function redirect(from) {
  return {
    name: "redirect",
    setup(b) {
      b.onResolve({ filter: /^(pako|acorn|acorn-jsx|esbuild-wasm|es-module-lexer|brotli-wasm|@noble\/hashes)(\/.*)?$/ }, (args) => {
        if (args.pluginData === "redirected") return;
        return b.resolve(args.path, { kind: args.kind, resolveDir: from, pluginData: "redirected" });
      });
    },
  };
}

async function bundle(c, side) {
  const tmp = fs.mkdtempSync(path.join(root, ".scratch", "size-"));
  if (side === "fast") {
    // a node_modules where every replaced name is the fast package
    const shadow = path.join(tmp, "node_modules");
    fs.mkdirSync(path.join(shadow, "@noble"), { recursive: true });
    for (const [orig, dir] of Object.entries(FAST)) fs.symlinkSync(path.join(pkgs, dir), path.join(shadow, orig), "junction");
  }
  const entry = path.join(tmp, "entry.mjs");
  fs.writeFileSync(entry, c.code);
  const outdir = path.join(tmp, "out");
  try {
    const r = await build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      outdir,
      write: true,
      metafile: true,
      logLevel: "silent",
      loader: { ".wasm": "file" },
      plugins: [redirect(side === "fast" ? tmp : root)],
      absWorkingDir: side === "fast" ? tmp : root,
      external: ["node:*"],
    });
    const files = Object.keys(r.metafile.outputs).map((f) => path.resolve(side === "fast" ? tmp : root, f));
    const asset = ASSETS[c.pkg]?.[side];
    if (asset) files.push(path.join(side === "fast" ? pkgs : nm, asset));
    let raw = 0, gz = 0, br = 0;
    for (const f of files) {
      const buf = fs.readFileSync(f);
      raw += buf.length;
      gz += zlib.gzipSync(buf, { level: 9 }).length;
      br += zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length;
    }
    return { raw, gz, br };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function pack(dir) {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: dir, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "ignore"] });
  const j = JSON.parse(out.slice(out.indexOf("[")))[0];
  return { tgz: j.size, unpacked: j.unpackedSize, files: j.entryCount };
}

const kb = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + " MB" : (n / 1e3).toFixed(1) + " KB");
const pct = (a, b) => ((b / a - 1) * 100).toFixed(0).replace(/^(?!-)/, "+") + "%";

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith("--") && !a.endsWith(".json"));
const results = [];
console.log("| bundle | original (min / gzip / brotli) | fast (min / gzip / brotli) | gzip change |");
console.log("|---|---|---|---|");
for (const c of CASES) {
  if (only && !c.name.includes(only)) continue;
  const o = await bundle(c, "orig");
  const f = await bundle(c, "fast");
  results.push({ case: c.name, orig: o, fast: f });
  const flag = f.gz > o.gz ? " **larger**" : "";
  console.log(`| ${c.name} | ${kb(o.raw)} / ${kb(o.gz)} / ${kb(o.br)} | ${kb(f.raw)} / ${kb(f.gz)} / ${kb(f.br)} | ${pct(o.gz, f.gz)}${flag} |`);
}

if (args.includes("--pack")) {
  console.log("\n| package | original tarball / unpacked | fast tarball / unpacked |");
  console.log("|---|---|---|");
  for (const [orig, dir] of Object.entries(FAST)) {
    const tmp = fs.mkdtempSync(path.join(root, ".scratch", "pack-"));
    try {
      execFileSync("npm", ["pack", `${orig}@${JSON.parse(fs.readFileSync(path.join(nm, orig, "package.json"))).version}`, "--silent"], { cwd: tmp, shell: true, stdio: "ignore" });
      const tgz = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
      const x = path.join(tmp, "x");
      fs.mkdirSync(x);
      execFileSync("tar", ["xzf", tgz, "-C", "x"], { cwd: tmp });
      let unpacked = 0;
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : (unpacked += fs.statSync(path.join(d, e.name)).size); };
      walk(x);
      const o = { tgz: fs.statSync(path.join(tmp, tgz)).size, unpacked };
      const f = pack(path.join(pkgs, dir));
      results.push({ package: orig, orig: o, fast: f });
      const flag = f.tgz > o.tgz || f.unpacked > o.unpacked ? " **larger**" : "";
      console.log(`| ${orig} | ${kb(o.tgz)} / ${kb(o.unpacked)} | ${kb(f.tgz)} / ${kb(f.unpacked)}${flag} |`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

const jsonOut = args.find((a) => a.endsWith(".json"));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));
