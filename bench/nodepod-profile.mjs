// Where does Nodepod spend its CPU time on real projects? Runs examples from
// Nodepod's perf-bench/examples-spec.json (a Nodepod checkout next to this
// repo) in Chromium with a browser-wide trace (every thread: page, workers,
// service worker), converts it with Nodepod's perf-bench/trace2prof.mjs and
// prints the busy time per npm package / CDN module / Nodepod file
// (bench/tools/nodepod-buckets.mjs).
//
// For per-package attribution Nodepod has to tag the modules it evaluates
// with a sourceURL, which only a profiling build does: build one with
//   node bench/tools/nodepod-prof-build.mjs      (-> .scratch/nodepod-prof/dist)
//
// usage: node bench/nodepod-profile.mjs <example name regex> [--runs N] [--dist DIR] [--headed]
//   run 1 starts from an empty browser profile (downloads, cold caches);
//   later runs reuse the profile (tarball / wasm caches filled)
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as pw from "playwright-core";
import { report } from "./tools/nodepod-buckets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const pattern = new RegExp(args[0] || "^basic$");
const runs = Number(opt("--runs", 1));
const nodepod = resolve(process.env.NODEPOD || join(root, "../Nodepod"));
const dist = resolve(opt("--dist", join(root, ".scratch/nodepod-prof/dist")));
if (!existsSync(join(dist, "index.mjs"))) throw new Error(`no Nodepod build at ${dist} (node bench/tools/nodepod-prof-build.mjs)`);
const specs = JSON.parse(readFileSync(join(nodepod, "perf-bench/examples-spec.json"), "utf8")).filter((s) => pattern.test(s.name) && !s.skip);
if (!specs.length) throw new Error("no example matches " + pattern);
const outRoot = join(root, ".scratch/nodepod-profiles");
const port = Number(process.env.PORT || 3431);
const server = spawn(process.execPath, [join(nodepod, "perf-bench/serve-examples.mjs")], {
  cwd: nodepod,
  env: { ...process.env, PORT: String(port), DIST_DIR: dist },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 600));
const browser = await pw.chromium.launch({ headless: !args.includes("--headed") });
const CATEGORIES = ["disabled-by-default-v8.cpu_profiler", "v8.execute", "toplevel"];

async function check(page, cond) {
  if (!cond) return false;
  const c = typeof cond === "string" ? JSON.parse(cond) : cond;
  if (c.js) return page.evaluate((expr) => { try { return !!(0, eval)(expr); } catch { return false; } }, c.js);
  if (c.text) {
    const text = await page.evaluate((sel) => document.querySelector(sel)?.innerText || "", c.text.selector || "body");
    return new RegExp(c.text.regex, c.text.flags || "m").test(text);
  }
  return false;
}
// (the step kinds of Nodepod's perf-bench/run-examples.mjs)
async function runStep(page, step, deadline) {
  const left = () => Math.max(1000, deadline - Date.now());
  if (step.click) await page.click(step.click, { timeout: Math.min(left(), step.timeoutMs || 60000) });
  else if (step.type) await page.fill(step.type.selector, step.type.text, { timeout: left() });
  else if (step.press) await page.press(step.press.selector, step.press.key, { timeout: left() });
  else if (step.reload) await page.reload();
  else if (step.eval) {
    if (/location\.reload/.test(step.eval)) await page.reload();
    else await page.evaluate((code) => (0, eval)(code), step.eval);
  } else if (step.waitFor) {
    const timeout = Math.min(left(), step.timeoutMs || 60000);
    if (step.waitFor.startsWith("js:")) {
      await page.waitForFunction((expr) => { try { return !!(0, eval)(expr); } catch { return false; } }, step.waitFor.slice(3), { timeout, polling: 250 });
    } else await page.waitForSelector(step.waitFor, { timeout });
  } else if (step.sleep) await page.waitForTimeout(step.sleep);
}

const summary = [];
for (const spec of specs) {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  for (let run = 1; run <= runs; run++) {
    const tag = `${spec.name.replace(/[^\w.-]+/g, "_")}--run${run}`;
    const dir = join(outRoot, tag);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 200)));
    await browser.startTracing(undefined, { categories: CATEGORIES });
    const started = Date.now();
    const deadline = started + (spec.timeoutMs || 120000);
    let status = "TIMEOUT";
    try {
      await page.goto(`http://localhost:${port}${spec.url}`, { timeout: 60000 });
      for (const step of spec.steps || []) await runStep(page, step, deadline);
      while (Date.now() < deadline) {
        if (await check(page, spec.success)) {
          status = "PASS";
          break;
        }
        if (spec.failure && (await check(page, spec.failure))) {
          status = "FAIL";
          break;
        }
        await page.waitForTimeout(250);
      }
    } catch (e) {
      status = "ERROR " + String(e.message || e).split("\n")[0].slice(0, 160);
    }
    const wall = Date.now() - started;
    if (status !== "PASS") {
      const tail = await page.evaluate(() => (document.querySelector("#output") || document.body)?.innerText?.slice(-3000) || "").catch(() => "(page gone)");
      writeFileSync(join(dir, "page-output.txt"), tail);
    }
    try {
      writeFileSync(join(dir, "run.trace.json"), await browser.stopTracing());
    } catch (e) {
      console.log(`== ${spec.name} run ${run}: ${status}, no trace (${String(e.message).split("\n")[0]})\n`);
      summary.push(`== ${spec.name} run ${run}: ${status}, no trace`);
      await page.close().catch(() => {});
      continue;
    }
    await page.close().catch(() => {});
    spawnSync(process.execPath, [join(nodepod, "perf-bench/trace2prof.mjs"), dir], { stdio: "inherit" });
    rmSync(join(dir, "run.trace.json"));
    const profiles = readdirSync(dir).filter((f) => f.endsWith(".cpuprofile")).map((f) => join(dir, f));
    const text = `== ${spec.name} run ${run}${run === 1 ? " (cold)" : " (warm)"}: ${status}, ${(wall / 1000).toFixed(1)} s wall\n` + (await report(profiles, { top: 22 }));
    console.log(text + (errors.length ? `\n  page errors: ${errors.slice(0, 3).join(" | ")}` : "") + "\n");
    writeFileSync(join(dir, "summary.txt"), text + "\n");
    summary.push(text);
  }
  await context.close();
}
await browser.close();
server.kill();
writeFileSync(join(outRoot, `summary-${Date.now()}.txt`), summary.join("\n\n") + "\n");
