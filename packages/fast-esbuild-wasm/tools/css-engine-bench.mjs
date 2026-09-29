// Times the JS engine's CSS transform directly (no glue), for profiling.
// usage: node tools/css-engine-bench.mjs [--file path] [--opts css|min|vite|local-map] [--n N]
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { fastTransform, stats } = await import("../src/transform.mjs");

const args = process.argv.slice(2);
const get = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const optsName = get("--opts", "min");
const N = Number(get("--n", 0));
const base = ["--log-level=silent", "--log-limit=0"];
const flagsByName = {
  css: [...base, "--loader=css"],
  min: [...base, "--minify", "--loader=css"],
  vite: [...base, "--target=chrome107,edge107,firefox104,safari16", "--minify", "--loader=css"],
  "local-map": [...base, "--sourcemap=external", "--sourcefile=app.module.css", "--loader=local-css"],
};
let sandbox = here;
while (dirname(sandbox) !== sandbox && basename(sandbox) !== "nodepod-fast-packages") sandbox = dirname(sandbox);
sandbox = dirname(sandbox);
const files = get("--file", null)
  ? [[get("--file"), readFileSync(get("--file"), "utf8")]]
  : [
      ["report.css", join(here, "../../../node_modules/playwright-core/lib/vite/htmlReport/report.css")],
      ["bootstrap.min.css", join(sandbox, "better-web-rendering/.tmp-libav-h264-decoder/build/ffmpeg-9.0/doc/bootstrap.min.css")],
      ["pdf_viewer.css", join(sandbox, "debt-helper/node_modules/.pnpm/pdfjs-dist@6.3.289/node_modules/pdfjs-dist/web/pdf_viewer.css")],
      ["tailwind build", join(sandbox, "mouse/dist/assets/index-EmzhzJWi.css")],
    ]
      .filter(([, p]) => existsSync(p))
      .map(([n, p]) => [n, readFileSync(p, "utf8")]);
const flags = flagsByName[optsName];
for (const [name, code] of files) {
  const reps = N || (code.length < 10000 ? 2000 : code.length < 100000 ? 100 : 30);
  let r;
  for (let i = 0; i < Math.min(reps, 10); i++) r = fastTransform(flags, code);
  if (r === undefined) {
    console.log(`${name}: ERROR`, stats.lastError && String(stats.lastError.stack).split("\n").slice(0, 4).join(" | "));
    continue;
  }
  let best = Infinity;
  for (let round = 0; round < 3; round++) {
    const t = performance.now();
    for (let i = 0; i < reps; i++) fastTransform(flags, code);
    best = Math.min(best, (performance.now() - t) / reps);
  }
  console.log(`${name} (${(code.length / 1024).toFixed(0)}KB) ${optsName}: ${best.toFixed(3)} ms (${(code.length / 1e6 / (best / 1000)).toFixed(1)} MB/s)`);
}
