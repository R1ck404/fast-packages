// The package bundled the way an app ships it: `es-module-lexer` resolved to
// this package, bundled and minified by esbuild for the browser (the
// "browser" condition: browser.mjs) and for Node (index.mjs). Each bundle
// must contain no copy of es-module-lexer's lexer (its wasm or its JS glue),
// must contain this package's lexer (fast path: its wasm is compiled and
// used), and must answer like es-module-lexer.
// usage: node packages/fast-es-module-lexer/test/bundle.mjs
import { build } from "esbuild";
import * as O from "es-module-lexer";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { nm, root } from "../../../bench/corpus.mjs";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const orig = readFileSync(join(nm, "es-module-lexer/dist/lexer.js"), "utf8");
// fingerprints of the original: a stretch of its wasm (base64) and its glue
const origWasm = orig.match(/"(AGFzbQ[^"]+)"/)[1];
const fingerprints = [origWasm.slice(0, 80), origWasm.slice(4000, 4080), "__heap_base", ".sa(", "C.ri()"];

O.initSync();
const ser = (x) => JSON.stringify(x, (k, v) => (v === undefined ? "\u0000undef" : v));
const run = (parse, s) => {
  try {
    return ser(parse(s));
  } catch (e) {
    return "ERR " + e.constructor.name + " " + e.message;
  }
};
const inputs = [
  "import a from 'b'; export const c = 1;",
  "import('\\u0041'); export { x as '\\x41' }; let x",
  "`${import('a')}`; import.meta.url; export default class {}",
  "export {", "'abc", "x = /re",
  readFileSync(join(nm, "react-dom/cjs/react-dom-client.production.js"), "utf8"),
  readFileSync(join(nm, "zod/v4/classic/schemas.js"), "utf8"),
];

let checks = 0, failures = 0;
const fail = (msg) => (failures++, console.log("FAIL", msg));
// (.scratch is gitignored: it does not exist in a fresh checkout)
mkdirSync(join(root, ".scratch"), { recursive: true });
const tmp = mkdtempSync(join(root, ".scratch", "eml-bundle-"));
try {
  // a node_modules in which es-module-lexer is this package
  mkdirSync(join(tmp, "node_modules"));
  symlinkSync(pkg, join(tmp, "node_modules", "es-module-lexer"), "junction");
  writeFileSync(join(tmp, "entry.mjs"), `export { ImportType, init, initSync, parse } from "es-module-lexer";\n`);
  for (const platform of ["browser", "node"]) {
    const r = await build({
      entryPoints: [join(tmp, "entry.mjs")],
      absWorkingDir: tmp,
      bundle: true,
      minify: true,
      format: "esm",
      platform,
      target: "es2022",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const code = r.outputFiles[0].text;
    const inputsUsed = Object.keys(r.metafile.inputs).map((f) => f.split(/[\\/]/).pop());
    const file = join(tmp, `bundle-${platform}.mjs`);
    writeFileSync(file, code);
    console.log(`${platform}: bundled ${inputsUsed.join(", ")}: ${code.length} bytes, gzip ${zlib.gzipSync(code, { level: 9 }).length}`);

    // the module esbuild took for this platform, and nothing of the original
    checks++;
    const want = platform === "browser" ? "browser.mjs" : "index.mjs";
    if (!inputsUsed.includes(want) || inputsUsed.some((f) => f !== want && f !== "entry.mjs")) fail(`${platform}: bundled ${inputsUsed.join(", ")}, want ${want}`);
    for (const f of fingerprints) {
      checks++;
      if (code.includes(f)) fail(`${platform}: the bundle contains the original's ${JSON.stringify(f.slice(0, 30))}`);
    }

    // the bundle works: es-module-lexer's answers, from this package's wasm
    // (WebAssembly.Module is watched: the lexer module has the exports of
    // rust/src/lib.rs)
    const compiled = [];
    const Module = WebAssembly.Module;
    WebAssembly.Module = new Proxy(Module, { construct: (T, args) => { const m = new T(...args); compiled.push(Module.exports(m).map((e) => e.name).join()); return m; } });
    let B;
    try {
      B = await import(pathToFileURL(file).href);
      B.initSync();
    } finally {
      WebAssembly.Module = Module;
    }
    checks++;
    if (!compiled.some((e) => e.includes("parse8") && e.includes("HDR"))) fail(`${platform}: this package's lexer was not compiled (${compiled.join(" / ")})`);
    for (const s of inputs) {
      checks++;
      const a = run(O.parse, s), b = run(B.parse, s);
      if (a !== b) fail(`${platform}: ${JSON.stringify(s.slice(0, 60))}\n  orig: ${a.slice(0, 200)}\n  bundle: ${b.slice(0, 200)}`);
    }
    // and it is the fast lexer: a 536 KB bundle at least 3x as fast as the
    // original (it is ~7-18x)
    const big = inputs[6];
    const time = (parse) => {
      let best = Infinity;
      for (let i = 0; i < 15; i++) {
        const t0 = performance.now();
        parse(big);
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    time(B.parse), time(O.parse);
    const tb = time(B.parse), to = time(O.parse);
    checks++;
    console.log(`${platform}: react-dom-client.production.js ${to.toFixed(2)} ms original, ${tb.toFixed(2)} ms bundle (${(to / tb).toFixed(1)}x)`);
    if (tb * 3 > to) fail(`${platform}: the bundle is not the fast lexer (${tb.toFixed(2)} ms vs the original's ${to.toFixed(2)} ms)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`bundle checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
