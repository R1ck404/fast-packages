// Times the JS engine directly (no glue) on corpus files, for profiling.
// usage: node tools/engine-bench.mjs [--opts cjs|js|esm|ts] [--filter regex] [--n N]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { fastTransform, stats } = await import("../src/transform.mjs");

const args = process.argv.slice(2);
const get = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const optsName = get("--opts", "cjs");
const filter = new RegExp(get("--filter", "."));
const N = Number(get("--n", 0));
const nm = join(here, "../../../node_modules");

const flagsByName = {
  js: ["--log-level=silent", "--log-limit=0", "--loader=js"],
  esm: ["--log-level=silent", "--log-limit=0", "--format=esm", "--loader=js"],
  cjs: [
    "--log-level=silent",
    "--log-limit=0",
    "--target=esnext",
    "--format=cjs",
    "--platform=neutral",
    "--define:import.meta.url=import_meta.url",
    "--define:import.meta.dirname=import_meta.dirname",
    "--define:import.meta.filename=import_meta.filename",
    "--define:import.meta=import_meta",
    "--loader=js",
  ],
  ts: ["--log-level=silent", "--log-limit=0", "--target=esnext", "--format=esm", "--loader=ts"],
};
// Source map variants: the same flags plus "--sourcemap=..." (glue order:
// after the common flags, before --sourcefile/--loader)
const withSourceMap = (flags, value, extra = []) => [...extra, ...flags.slice(0, -1), `--sourcemap=${value}`, flags[flags.length - 1]];
flagsByName["cjs-map"] = withSourceMap(flagsByName.cjs, "external");
flagsByName["cjs-map-inline"] = withSourceMap(flagsByName.cjs, "inline");
flagsByName["cjs-map-nocontent"] = withSourceMap(flagsByName.cjs, "external", ["--sources-content=false"]);
flagsByName["js-map"] = withSourceMap(flagsByName.js, "external");
flagsByName["ts-map"] = withSourceMap(flagsByName.ts, "external");
const files = [
  ["empty", ""],
  ["tiny", "export const x = 1; import y from 'z'"],
  ["zod-errors 1.6KB", readFileSync(join(nm, "zod/v4/classic/errors.js"), "utf8")],
  ["zod-schemas 51KB", readFileSync(join(nm, "zod/v4/classic/schemas.js"), "utf8")],
  ["rollup 948KB", readFileSync(join(nm, "rollup/dist/es/shared/node-entry.js"), "utf8")],
  ["three 1.2MB", readFileSync(join(nm, "three/build/three.module.js"), "utf8")],
].filter(([n]) => filter.test(n));
const flags = flagsByName[optsName];
for (const [name, code] of files) {
  const reps = N || (code.length < 10000 ? 2000 : code.length < 100000 ? 100 : 10);
  let r;
  for (let i = 0; i < Math.min(reps, 20); i++) r = fastTransform(flags, code);
  if (r === undefined) {
    console.log(`${name}: BAIL/ERROR`, stats.lastError && String(stats.lastError.stack).split("\n").slice(0, 4).join(" | "));
    continue;
  }
  let best = Infinity;
  for (let round = 0; round < 3; round++) {
    const t = performance.now();
    for (let i = 0; i < reps; i++) fastTransform(flags, code);
    best = Math.min(best, (performance.now() - t) / reps);
  }
  console.log(`${name.padEnd(18)} ${best.toFixed(3).padStart(9)} ms  (${(code.length / 1e6 / (best / 1000)).toFixed(1)} MB/s)`);
}
