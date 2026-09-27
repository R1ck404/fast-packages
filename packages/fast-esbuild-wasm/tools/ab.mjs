// A/B timing of two engine source trees in alternating fresh processes.
// usage: node tools/ab.mjs <dirA> <dirB> [rounds] [--opts cjs|js|ts] [--filter re]
// Each dir must contain transform.mjs (e.g. a copy of src/). Reports the
// minimum time per input over all rounds and the B/A ratio.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const nm = join(here, "../../../node_modules");
const argv = process.argv.slice(2);
const get = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const optsName = get("--opts", "cjs");
const filter = new RegExp(get("--filter", "."));

const FLAGS = {
  cjs: ["--log-level=silent", "--log-limit=0", "--target=esnext", "--format=cjs", "--platform=neutral", "--define:import.meta.url=import_meta.url", "--define:import.meta=import_meta", "--loader=js"],
  js: ["--log-level=silent", "--log-limit=0", "--loader=js"],
  ts: ["--log-level=silent", "--log-limit=0", "--target=esnext", "--format=esm", "--loader=ts"],
};
const INPUTS = [
  ["tiny", () => "export const x = 1; import y from 'z'", 3000],
  ["zod-errors 1.6KB", () => readFileSync(join(nm, "zod/v4/classic/errors.js"), "utf8"), 1500],
  ["zod-schemas 51KB", () => readFileSync(join(nm, "zod/v4/classic/schemas.js"), "utf8"), 60],
  ["rollup 948KB", () => readFileSync(join(nm, "rollup/dist/es/shared/node-entry.js"), "utf8"), 6],
  ["three 1.2MB", () => readFileSync(join(nm, "three/build/three.module.js"), "utf8"), 8],
];

if (process.env.AB_CHILD) {
  const { fastTransform } = await import(process.env.AB_CHILD);
  const flags = FLAGS[process.env.AB_OPTS];
  const out = {};
  for (const [name, load, reps] of INPUTS) {
    if (!new RegExp(process.env.AB_FILTER).test(name)) continue;
    const code = load();
    for (let i = 0; i < Math.min(reps, 20); i++) fastTransform(flags, code);
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      const t = performance.now();
      for (let i = 0; i < reps; i++) fastTransform(flags, code);
      best = Math.min(best, (performance.now() - t) / reps);
    }
    out[name] = best;
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}

const [dirA, dirB, roundsArg] = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const rounds = Number(roundsArg || 3);
const res = { A: {}, B: {} };
for (let r = 0; r < rounds; r++) {
  for (const [k, dir] of [
    ["A", dirA],
    ["B", dirB],
  ]) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      encoding: "utf8",
      env: { ...process.env, AB_CHILD: pathToFileURL(join(resolve(dir), "transform.mjs")).href, AB_OPTS: optsName, AB_FILTER: filter.source },
    });
    if (child.status !== 0) {
      console.error(child.stdout, child.stderr);
      process.exit(1);
    }
    const j = JSON.parse(child.stdout.trim().split("\n").pop());
    for (const [n, ms] of Object.entries(j)) res[k][n] = Math.min(res[k][n] ?? Infinity, ms);
  }
}
let prod = 1,
  cnt = 0;
for (const n of Object.keys(res.A)) {
  const ratio = res.B[n] / res.A[n];
  prod *= ratio;
  cnt++;
  console.log(`${n.padEnd(18)} A ${res.A[n].toFixed(3).padStart(9)}  B ${res.B[n].toFixed(3).padStart(9)}  B/A ${ratio.toFixed(3)}`);
}
console.log(`geomean B/A ${Math.pow(prod, 1 / cnt).toFixed(3)}`);
