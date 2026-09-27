// Nodepod's topLevelParser() (src/syntax-transforms.ts) as it ships: extracted
// from the Nodepod source, minified by esbuild, bundled once against acorn and
// once against @r1ck404/fast-acorn. Checks that it recognises the minified
// subclass (speed) and parses identically.
// usage: node verify/verify-toplevel-min.mjs [nFiles]
import { buildSync } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { allFiles, sample, root, here, Tally } from "./corpus.mjs";

const N = Number(process.argv[2] || 1500);
const T = new Tally("topLevelParser (minified)");
const nodepodSrc = join(root, "../Nodepod/src/syntax-transforms.ts");
if (!existsSync(nodepodSrc)) {
  console.log("Nodepod source not found:", nodepodSrc);
  process.exit(1);
}
const src = readFileSync(nodepodSrc, "utf8");
const a = src.indexOf("let _topLevelParser");
const m = src.indexOf("_topLevelParser = acorn.Parser.extend", a);
const b = src.indexOf("}", src.indexOf("return _topLevelParser;", m)) + 1;
if (a < 0 || m < 0 || b <= 0) throw new Error("topLevelParser not found in Nodepod source");
const dir = join(here, "out/min");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "tl.ts"), 'import * as acorn from "acorn";\n' + src.slice(a, b) + "\n");
const fastPath = pathToFileURL(join(root, "packages/fast-acorn/index.mjs")).href;
for (const [name, alias] of [["fast", fastPath], ["orig", "acorn"]]) {
  const r = buildSync({ entryPoints: [join(dir, "tl.ts")], bundle: true, format: "esm", minify: true, write: false, external: ["acorn", fastPath], alias: { acorn: alias }, platform: "node" });
  writeFileSync(join(dir, `tl-${name}.mjs`), r.outputFiles[0].text);
}
const PF = (await import(pathToFileURL(join(dir, "tl-fast.mjs")).href)).topLevelParser();
const PO = (await import(pathToFileURL(join(dir, "tl-orig.mjs")).href)).topLevelParser();
const opts = { ecmaVersion: "latest", sourceType: "module" };
const S = (f) => {
  try {
    return JSON.stringify(f(), (k, v) => (typeof v === "bigint" ? v + "n" : v instanceof RegExp ? String(v) : v));
  } catch (e) {
    return "ERR " + e.message + " " + e.pos;
  }
};
for (const f of sample(allFiles((n) => n.endsWith(".mjs") || n.endsWith(".js")), N, 3 << 20)) {
  const code = readFileSync(f, "utf8");
  T.ok(S(() => PO.parse(code, opts)) === S(() => PF.parse(code, opts)), f);
}
const big = readFileSync(join(root, "node_modules/three/build/three.module.js"), "utf8");
const best = (P) => {
  let t = 1e9;
  for (let i = 0; i < 15; i++) {
    const s = performance.now();
    P.parse(big, opts);
    t = Math.min(t, performance.now() - s);
  }
  return t;
};
best(PO), best(PF);
const to = best(PO), tf = best(PF);
console.log(`three.module topLevel parse: acorn ${to.toFixed(2)} ms, fast ${tf.toFixed(2)} ms (x${(to / tf).toFixed(2)})`);
T.ok(to / tf > 1.5, "minified subclass not recognised (no speedup)");
process.exit(T.report() ? 1 : 0);
