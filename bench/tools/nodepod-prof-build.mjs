// Builds a profiling copy of Nodepod (the checkout next to this repo, as it
// is, uncommitted changes included) into .scratch/nodepod-prof/dist. The
// differences from Nodepod's own build: it is not minified, and every module
// Nodepod evaluates gets `//# sourceURL=vfs://<path>`, so CPU profiles
// attribute the time to functions and files (bench/nodepod-profile.mjs).
// The Nodepod checkout is only read.
// usage: node bench/tools/nodepod-prof-build.mjs
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const nodepod = resolve(process.env.NODEPOD || join(root, "../Nodepod"));
const out = join(root, ".scratch/nodepod-prof");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ["src", "static", "package.json", "tsconfig.json", "tsconfig.build.json", "vite.lib.config.js"]) {
  cpSync(join(nodepod, f), join(out, f), { recursive: true });
}
symlinkSync(join(nodepod, "node_modules"), join(out, "node_modules"), "junction");

// the module-evaluation sites of script-engine.ts: (0, eval)(wrapper) with the
// module's path in `resolved` (require/import) or `filename` (entry scripts)
const file = join(out, "src/script-engine.ts");
const lines = readFileSync(file, "utf8").split("\n");
let patched = 0;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/\(0, eval\)\((wrapper|asyncWrapper)\)/);
  if (!m) continue;
  // the path variable in scope: the nearest preceding `resolved`/`filename` use
  let v = null;
  for (let j = i; j > i - 400 && j >= 0 && !v; j--) {
    if (/\bconst resolved\b|\bcache\[resolved\]|\bresolved\.endsWith/.test(lines[j])) v = "resolved";
    else if (/^\s+filename,?\s*$|\bfilename\.endsWith|\(filename[,)]/.test(lines[j])) v = "filename";
  }
  if (!v) throw new Error(`script-engine.ts:${i + 1}: no path variable found for ${m[0]}`);
  lines[i] = lines[i].replace(m[0], `(0, eval)(${m[1]} + "\\n//# sourceURL=vfs://" + ${v})`);
  patched++;
}
if (patched !== 5) throw new Error(`expected 5 eval sites in script-engine.ts, patched ${patched}`);
writeFileSync(file, lines.join("\n"));
// unminified (Nodepod's own switch), so profiles show its function names
execFileSync(process.execPath, [join(out, "node_modules/vite/bin/vite.js"), "build", "--config", "vite.lib.config.js"], {
  cwd: out,
  stdio: "inherit",
  env: { ...process.env, NODEPOD_UNMINIFIED: "1" },
});
for (const f of ["__sw__.js", "__nodepod_bridge__.html", "__nodepod_bridge__.js"]) copyFileSync(join(out, "static", f), join(out, "dist", f));
if (!existsSync(join(out, "dist/index.mjs"))) throw new Error("build failed");
console.log(`profiling build: ${join(out, "dist")} (${patched} eval sites tagged)`);
