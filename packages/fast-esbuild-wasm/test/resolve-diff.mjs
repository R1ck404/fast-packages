// Differential test of the resolver port (src/resolver.mjs on src/fs.mjs with
// host = node's fs) against esbuild 0.28.2's resolver, driven through the
// plugin API ("build.resolve").
//
// The reference is native esbuild by default and esbuild-wasm (Go on
// js/wasm over node's fs, which is exactly what the port emulates) for the
// fixture suites; "--ref wasm" / "--ref native" / "--ref both" override that.
//
// Outcomes per resolve:
//   ok       same path/external/namespace/suffix/sideEffects (and the same
//            "different case" warning)
//   okError  esbuild reports an error and the port returns null
//   okWarn   esbuild reports warnings and the port reports the same
//   MISMATCH anything else
//
// usage: node test/resolve-diff.mjs [--suite sweep|fixtures|tsconfig|browser]
//        [--ref native|wasm|both] [--verbose] [--limit N] [--config a,b]
//        [--group-timeout seconds] [--jobs N] [--no-cache]
//
// The reference is slow (a build.resolve() costs ~30 ms with native esbuild
// and ~300 ms with esbuild-wasm, whose Go code runs in its own process while
// this one waits): serially the suites take about an hour. So each group's
// requests are split over reference processes, each with its own build (the
// results are joined in request order; --jobs of them run at a time, default:
// the number of CPU threads minus 4, and a suite's groups run at the same
// time), and the reference results are cached in
// .scratch/ref-cache/resolve-diff/ (keyed by the reference package and its
// version, the options, the requests and a fingerprint of the files they
// resolve in: the fixture tree, or the repository's package-lock.json for
// node_modules); --no-cache runs the reference again. A group whose
// reference builds do not finish within --group-timeout (default 900 s)
// fails loudly (REFERENCE TIMEOUT) instead of blocking the run.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, "..");
const repoRoot = path.join(pkgRoot, "..", "..");

const { realFS, RealFSOptions } = await import("../src/fs.mjs");
const { CacheSet } = await import("../src/cache.mjs");
const { newResolver } = await import("../src/resolver.mjs");
const { validateExternals, validateAlias, validatePath, validateResolveExtensions } = await import("../src/build_options.mjs");
const config = await import("../src/config.mjs");
const { Log, newDeferLog, DeferLogNoVerboseOrDebug, Warning } = await import("../src/logger.mjs");
const ast = await import("../src/ast.mjs");
const { isInsideNodeModules } = await import("../src/helpers.mjs");
const { validateFeatures } = await import("../src/transform.mjs");
const { parseTargets } = await import("../src/cli.mjs");
const { targetEdition, engineList } = await import("../src/api_validate.mjs");

const args = process.argv.slice(2);
const argValue = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const onlySuite = argValue("--suite", null);
const refArg = argValue("--ref", null);
const verbose = args.includes("--verbose");
const limit = Number(argValue("--limit", "0")) || 0;
const onlyConfigs = argValue("--config", null)?.split(",") ?? null;
const groupTimeoutMs = Number(argValue("--group-timeout", "900")) * 1000;
const jobs = Math.max(1, Number(argValue("--jobs", String(Math.max(1, os.availableParallelism() - 4)))) || 1);
const useCache = !args.includes("--no-cache");
const cacheDir = path.join(repoRoot, ".scratch", "ref-cache", "resolve-diff");

const S = path.sep;

// ---------------------------------------------------------------------------
// Our side

const PLATFORMS = { browser: config.PlatformBrowser, node: config.PlatformNode, neutral: config.PlatformNeutral };
const FORMATS = { iife: config.FormatIIFE, cjs: config.FormatCommonJS, esm: config.FormatESModule };
const KINDS = {
  "entry-point": ast.ImportEntryPoint,
  "import-statement": ast.ImportStmt,
  "require-call": ast.ImportRequire,
  "dynamic-import": ast.ImportDynamic,
  "require-resolve": ast.ImportRequireResolve,
  "import-rule": ast.ImportAt,
  "composes-from": ast.ImportComposesFrom,
  "url-token": ast.ImportURL,
};
const LOADERS = {
  js: config.LoaderJS,
  jsx: config.LoaderJSX,
  ts: config.LoaderTS,
  tsx: config.LoaderTSX,
  css: config.LoaderCSS,
  "local-css": config.LoaderLocalCSS,
  json: config.LoaderJSON,
  text: config.LoaderText,
  file: config.LoaderFile,
  empty: config.LoaderEmpty,
};

function defaultExtensionToLoaderMap() {
  return new Map([
    ["", config.LoaderJS],
    [".js", config.LoaderJS],
    [".mjs", config.LoaderJS],
    [".cjs", config.LoaderJS],
    [".jsx", config.LoaderJSX],
    [".ts", config.LoaderTS],
    [".cts", config.LoaderTSNoAmbiguousLessThan],
    [".mts", config.LoaderTSNoAmbiguousLessThan],
    [".tsx", config.LoaderTSX],
    [".css", config.LoaderCSS],
    [".module.css", config.LoaderLocalCSS],
    [".json", config.LoaderJSON],
    [".txt", config.LoaderText],
  ]);
}

// Mirrors pkg/api validateBuildOptions for the resolver's options
function makeOurResolver(cfg, host) {
  const log = new Log();
  const [fsys, err] = realFS(new RealFSOptions(cfg.absWorkingDir), host);
  if (err !== null) throw new Error(err);
  const o = new config.Options();
  o.mode = config.ModeBundle;
  o.platform = PLATFORMS[cfg.platform ?? "browser"];
  o.extensionToLoader = defaultExtensionToLoaderMap();
  for (const [ext, loader] of Object.entries(cfg.loader ?? {})) o.extensionToLoader.set(ext, LOADERS[loader]);
  o.extensionOrder = validateResolveExtensions(log, cfg.resolveExtensions ?? null);
  o.externalSettings = validateExternals(log, fsys, cfg.external ?? []);
  o.externalPackages = cfg.packages === "external";
  o.packageAliases = validateAlias(log, fsys, new Map(Object.entries(cfg.alias ?? {})));
  o.tsConfigPath = validatePath(log, fsys, cfg.tsconfig ?? "", "tsconfig path");
  o.tsConfigRaw = cfg.tsconfigRaw === undefined ? "" : typeof cfg.tsconfigRaw === "string" ? cfg.tsconfigRaw : JSON.stringify(cfg.tsconfigRaw);
  o.mainFields = cfg.mainFields ? cfg.mainFields.slice() : null;
  o.conditions = cfg.conditions ? cfg.conditions.slice() : null;
  o.absNodePaths = (cfg.nodePaths ?? []).map((p) => validatePath(log, fsys, p, "node path"));
  o.preserveSymlinks = !!cfg.preserveSymlinks;
  o.outputFormat = cfg.format ? FORMATS[cfg.format] : [config.FormatIIFE, config.FormatCommonJS, config.FormatESModule][o.platform];
  if (cfg.target) {
    const [target, engines] = parseTargets(cfg.target.split(","), "--target=" + cfg.target);
    o.unsupportedJSFeatures = validateFeatures(log, targetEdition(target), engineList(engines))[0];
  }
  if (o.conditions === null && o.platform !== config.PlatformNeutral) o.conditions = ["module"];
  return { fsys, options: o, caches: new CacheSet() };
}

// A copy of the options (newResolver may change its own)
function cloneOptions(options) {
  const o = new config.Options();
  for (const key in options) o[key] = options[key];
  return o;
}

function ourResolve(state, req) {
  try {
    if (state.error) throw state.error;
    // (like build.resolve(): a new resolver with its own log for every
    // request, sharing the build's caches)
    const log = newDeferLog(DeferLogNoVerboseOrDebug, null);
    const res = newResolver(config.BuildCall, state.fsys, log, state.caches, cloneOptions(state.options));
    const absResolveDir = validatePath(log, state.fsys, req.resolveDir ?? "", "resolve directory");
    const [r] = res.resolve(absResolveDir, req.path, KINDS[req.kind]);
    const warnings = log
      .done()
      .filter((m) => m.kind === Warning)
      .map((m) => m.data.text);
    if (r === null) return { kind: "null", warnings };
    return {
      warnings,
      kind: "ok",
      path: r.pathPair.primary.text,
      external: r.pathPair.isExternal,
      namespace: r.pathPair.primary.namespace,
      suffix: r.pathPair.primary.ignoredSuffix,
      sideEffects: r.primarySideEffectsData === null,
      diffCaseWarning: r.differentCase !== null && !isInsideNodeModules(absResolveDir),
      result: r,
    };
  } catch (e) {
    return { kind: "crash", why: String(e && e.stack ? e.stack : e) };
  }
}

// ---------------------------------------------------------------------------
// esbuild's side

async function esbuildResolveAll(esbuild, cfg, reqs) {
  const results = new Array(reqs.length);
  let buildError = null;
  const buildOptions = {
    entryPoints: ["entry"],
    bundle: true,
    write: false,
    logLevel: "silent",
    absWorkingDir: cfg.absWorkingDir,
    plugins: [
      {
        name: "resolve-diff",
        setup(b) {
          b.onResolve({ filter: /^entry$/ }, async () => {
            let next = 0;
            const worker = async () => {
              while (next < reqs.length) {
                const i = next++;
                const req = reqs[i];
                const r = await b.resolve(req.path, { kind: req.kind, resolveDir: req.resolveDir, importer: req.importer ?? "" });
                results[i] = {
                  path: r.path,
                  external: r.external,
                  namespace: r.namespace,
                  suffix: r.suffix,
                  sideEffects: r.sideEffects,
                  errors: r.errors.map((m) => m.text),
                  warnings: r.warnings.map((m) => m.text),
                };
              }
            };
            await Promise.all(Array.from({ length: 16 }, worker));
            return { path: "entry", namespace: "resolve-diff" };
          });
          b.onLoad({ filter: /.*/, namespace: "resolve-diff" }, () => ({ contents: "" }));
        },
      },
    ],
  };
  for (const key of ["platform", "mainFields", "conditions", "alias", "external", "packages", "resolveExtensions", "tsconfig", "tsconfigRaw", "preserveSymlinks", "nodePaths", "loader", "format", "target"]) {
    if (cfg[key] !== undefined) buildOptions[key] = cfg[key];
  }
  // (a reference build that never finishes must not block the run)
  let timer = null;
  let timedOut = false;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, groupTimeoutMs);
  });
  try {
    await Promise.race([esbuild.build(buildOptions), timeout]);
  } catch (e) {
    buildError = e;
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) {
    // (stops esbuild's service process; the next call starts a new one)
    esbuild.stop();
    return { results: null, timedOut: true };
  }
  for (let i = 0; i < reqs.length; i++) {
    if (results[i] === undefined) {
      results[i] = { path: "", errors: ["build failed: " + (buildError ? String(buildError.message).split("\n")[0] : "?")], warnings: [] };
    }
  }
  return { results, timedOut: false };
}

// ---------------------------------------------------------------------------
// Comparison

let ourTime = 0;
let refTime = 0;
let ourCount = 0;
const totals = { ok: 0, okError: 0, okWarn: 0, mismatch: 0, crash: 0 };
const failures = [];

function isDiffCaseWarning(text) {
  return text.includes("to avoid issues with case-sensitive file systems");
}

function compare(suite, cfgName, req, ref, ours) {
  const label = `[${suite}/${cfgName}] ${req.kind} ${JSON.stringify(req.path)} from ${req.resolveDir}`;
  if (ours.kind === "crash") {
    totals.crash++;
    failures.push(`CRASH ${label}\n    ${ours.why.split("\n").slice(0, 6).join("\n    ")}`);
    return;
  }
  const refError = ref.errors.length > 0 || ref.path === "";
  if (refError) {
    if (ours.kind === "null") {
      totals.okError++;
    } else {
      totals.mismatch++;
      failures.push(`MISMATCH ${label}\n    esbuild: error ${JSON.stringify(ref.errors[0])}\n    ours:    ${JSON.stringify(ours.path)} external=${ours.external}`);
    }
    return;
  }
  const otherWarnings = ref.warnings.filter((w) => !isDiffCaseWarning(w));
  if (JSON.stringify(otherWarnings) !== JSON.stringify(ours.warnings)) {
    totals.mismatch++;
    failures.push(`MISMATCH ${label}\n    esbuild: warnings ${JSON.stringify(otherWarnings)}\n    ours:    ${JSON.stringify(ours.warnings)}`);
    return;
  }
  if (ours.kind === "null") {
    totals.mismatch++;
    failures.push(`MISMATCH ${label}\n    esbuild: ${JSON.stringify(ref.path)}\n    ours:    null`);
    return;
  }
  const refDiffCase = ref.warnings.some(isDiffCaseWarning);
  const diffs = [];
  for (const key of ["path", "external", "namespace", "suffix", "sideEffects"]) {
    if (ref[key] !== ours[key]) diffs.push(`${key}: esbuild ${JSON.stringify(ref[key])} ours ${JSON.stringify(ours[key])}`);
  }
  if (refDiffCase !== ours.diffCaseWarning) diffs.push(`different-case warning: esbuild ${refDiffCase} ours ${ours.diffCaseWarning}`);
  if (diffs.length === 0) {
    if (otherWarnings.length > 0) totals.okWarn++;
    else totals.ok++;
  } else {
    totals.mismatch++;
    failures.push(`MISMATCH ${label}\n    ${diffs.join("\n    ")}`);
  }
}

// Runs one group of requests against the reference(s) and the port
async function runGroup(suite, cfgName, cfg, reqs, refs) {
  if (onlyConfigs !== null && !onlyConfigs.includes(cfgName)) return;
  if (limit && reqs.length > limit) reqs = reqs.slice(0, limit);
  // A crash abandons the build, so the resolver (and its caches) are thrown
  // away after one: the next request gets a fresh one, like a new build
  const fresh = () => {
    try {
      return makeOurResolver(cfg, fs);
    } catch (e) {
      return { error: e };
    }
  };
  const tOurs = performance.now();
  let state = fresh();
  const ours = [];
  for (const req of reqs) {
    const o = ourResolve(state, req);
    ours.push(o);
    if (o.kind === "crash") state = fresh();
  }
  ourTime += performance.now() - tOurs;
  const tRef = performance.now();
  for (const refName of refs) {
    const { results: ref, timedOut } = await (prefetched.get(suite + "/" + cfgName + "/" + refName) ?? referenceResults(refName, cfg, reqs, suite));
    if (timedOut) {
      totals.crash++;
      failures.push(`REFERENCE TIMEOUT [${suite}/${cfgName}] ${refName}: ${reqs.length} resolves did not finish in ${groupTimeoutMs / 1000} s`);
      console.log(`REFERENCE TIMEOUT [${suite}/${cfgName}] ${refName}`);
      continue;
    }
    for (let i = 0; i < reqs.length; i++) compare(suite + (refs.length > 1 ? "@" + refName : ""), cfgName, reqs[i], ref[i], ours[i]);
  }
  refTime += performance.now() - tRef;
  ourCount += reqs.length;
  return { state, ours };
}

// ---------------------------------------------------------------------------
// The reference in parallel processes, and its cache

// (the files a suite's requests resolve in)
const fingerprints = new Map();
function fingerprint(suite) {
  if (fingerprints.has(suite)) return fingerprints.get(suite);
  const h = createHash("sha256");
  if (suite === "fixtures") {
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        const p = path.join(dir, e.name);
        const r = rel + "/" + e.name;
        if (e.isSymbolicLink()) h.update("L" + r + "->" + fs.readlinkSync(p) + "|");
        else if (e.isDirectory()) {
          h.update("D" + r + "|");
          walk(p, r);
        } else h.update("F" + r + "|").update(fs.readFileSync(p)).update("|");
      }
    };
    walk(fixturesRootForFingerprint, "");
  } else {
    h.update(fs.readFileSync(path.join(repoRoot, "package-lock.json")));
  }
  const d = h.digest("hex");
  fingerprints.set(suite, d);
  return d;
}
let fixturesRootForFingerprint = null;

// Starts the reference of every group of a suite at once (the processes run
// --jobs at a time); runGroup then waits for its group's
const prefetched = new Map();
function prefetchGroups(suite, groups, refs) {
  for (const { cfgName, cfg, reqs } of groups) {
    if (onlyConfigs !== null && !onlyConfigs.includes(cfgName)) continue;
    const limited = limit && reqs.length > limit ? reqs.slice(0, limit) : reqs;
    for (const refName of refs) prefetched.set(suite + "/" + cfgName + "/" + refName, referenceResults(refName, cfg, limited, suite));
  }
}
let running = 0;
const waiting = [];
async function withProcessSlot(f) {
  if (running >= jobs) await new Promise((resolve) => waiting.push(resolve));
  running++;
  try {
    return await f();
  } finally {
    running--;
    if (waiting.length > 0) waiting.shift()();
  }
}

// One reference process: {refName, cfg, reqs} in, {results, timedOut} out
function runReferenceProcess(refName, cfg, reqs) {
  return withProcessSlot(() => new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--ref-worker", "--group-timeout", String(groupTimeoutMs / 1000)], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    // (a process that hangs beyond its own timeout guard counts as timed out)
    const guard = setTimeout(() => child.kill(), groupTimeoutMs + 60000);
    child.on("close", () => {
      clearTimeout(guard);
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({ results: null, timedOut: true });
      }
    });
    child.stdin.end(JSON.stringify({ refName, cfg, reqs }));
  }));
}

// The reference's results for a group, in request order
async function referenceResults(refName, cfg, reqs, suite) {
  const pkg = refName === "wasm" ? "esbuild-wasm" : "esbuild";
  const key = createHash("sha256")
    .update(JSON.stringify({ pkg, version: require(pkg + "/package.json").version, files: fingerprint(suite), cfg, reqs }))
    .digest("hex")
    .slice(0, 40);
  const file = path.join(cacheDir, key + ".json");
  if (useCache && fs.existsSync(file)) return { results: JSON.parse(fs.readFileSync(file, "utf8")), timedOut: false };
  // (at least 100 requests per process: each starts its own esbuild)
  const n = Math.max(1, Math.min(jobs, Math.ceil(reqs.length / 100)));
  const chunks = [];
  for (let i = 0; i < n; i++) chunks.push(reqs.slice(Math.floor((i * reqs.length) / n), Math.floor(((i + 1) * reqs.length) / n)));
  const parts = await Promise.all(chunks.map((chunk) => runReferenceProcess(refName, cfg, chunk)));
  if (parts.some((p) => p.timedOut)) return { results: null, timedOut: true };
  const results = parts.flatMap((p) => p.results);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(results));
  return { results, timedOut: false };
}

function refsFor(defaultRef) {
  const r = refArg ?? defaultRef;
  return r === "both" ? ["native", "wasm"] : [r];
}

// ---------------------------------------------------------------------------
// Suite 1: every package in node_modules

function listFiles(dir, depth, out, dirs, rel = "") {
  let names;
  try {
    names = fs.readdirSync(path.join(dir, rel)).sort();
  } catch {
    return;
  }
  for (const name of names) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const r = rel ? rel + "/" + name : name;
    let st;
    try {
      st = fs.statSync(path.join(dir, r));
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      dirs.push(r);
      if (depth > 0) listFiles(dir, depth - 1, out, dirs, r);
    } else {
      out.push(r);
    }
  }
}

function spread(list, n) {
  if (list.length <= n) return list;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.floor((i * list.length) / n)]);
  return out;
}

function stripExt(p) {
  const m = p.match(/^(.*[^/])\.[^./]+$/);
  return m ? m[1] : p;
}

function packageDirs(nodeModules) {
  const out = [];
  for (const name of fs.readdirSync(nodeModules).sort()) {
    if (name.startsWith(".")) continue;
    const p = path.join(nodeModules, name);
    if (name.startsWith("@")) {
      for (const sub of fs.readdirSync(p).sort()) out.push([name + "/" + sub, path.join(p, sub)]);
    } else {
      out.push([name, p]);
    }
  }
  // A few nested node_modules
  const nested = [];
  for (const [, dir] of out) {
    const nm = path.join(dir, "node_modules");
    if (fs.existsSync(nm)) {
      for (const [name, sub] of packageDirs(nm)) nested.push([name, sub]);
    }
  }
  return out.concat(nested.slice(0, 20));
}

function sweepRequests(root) {
  const reqs = [];
  const add = (p, resolveDir) => reqs.push({ path: p, resolveDir });
  for (const [name, dir] of packageDirs(path.join(root, "node_modules"))) {
    let pj = null;
    try {
      pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {}
    const isTopLevel = path.dirname(dir) === path.join(root, "node_modules") || path.dirname(path.dirname(dir)) === path.join(root, "node_modules");
    const bareDir = isTopLevel ? root : path.dirname(dir.slice(0, dir.lastIndexOf(S + "node_modules" + S)) + S + "x");
    add(name, bareDir);
    add(name + "/", bareDir);
    add(name + "/package.json", bareDir);
    add(name + "/does-not-exist", bareDir);
    if (pj) {
      const ex = pj.exports;
      if (ex && typeof ex === "object" && !Array.isArray(ex)) {
        const keys = Object.keys(ex).filter((k) => k.startsWith("."));
        for (const k of spread(keys, 12)) {
          if (k.includes("*")) {
            add(name + k.slice(1).replace("*", "index"), bareDir);
            add(name + k.slice(1).replace("*", "foo/bar"), bareDir);
          } else {
            add(name + k.slice(1), bareDir);
          }
        }
      }
      for (const field of ["main", "module", "browser", "jsnext:main", "types"]) {
        if (typeof pj[field] === "string") add(name + "/" + pj[field].replace(/^\.\//, ""), bareDir);
      }
      if (pj.browser && typeof pj.browser === "object") {
        for (const k of spread(Object.keys(pj.browser), 6)) add(k, dir);
      }
      if (pj.imports && typeof pj.imports === "object") {
        for (const k of spread(Object.keys(pj.imports), 6)) add(k.replace("*", "index"), dir);
      }
      for (const dep of spread(Object.keys({ ...(pj.dependencies ?? {}), ...(pj.peerDependencies ?? {}) }), 5)) add(dep, dir);
    }
    const files = [];
    const dirs = [];
    listFiles(dir, 2, files, dirs);
    for (const f of spread(files, 10)) {
      add(name + "/" + f, bareDir);
      add(name + "/" + stripExt(f), bareDir);
      add("./" + f, dir);
      add("./" + stripExt(f), dir);
    }
    for (const d of spread(dirs, 4)) {
      add(name + "/" + d, bareDir);
      add("./" + d, dir);
      add("./" + d + "/", dir);
    }
    add(".", dir);
    add("..", dir);
    add("./", dir);
    add(name, dir); // self reference
  }
  return reqs;
}

async function suiteSweep() {
  const root = repoRoot;
  const base = sweepRequests(root);
  console.log(`sweep: ${base.length} import paths`);
  const configs = [
    ["browser", { platform: "browser" }, ["import-statement", "require-call", "dynamic-import"]],
    ["node", { platform: "node" }, ["import-statement", "require-call", "require-resolve"]],
    ["neutral", { platform: "neutral" }, ["import-statement", "require-call"]],
    ["browser-dev", { platform: "browser", conditions: ["development", "worker"] }, ["import-statement", "require-call"]],
    ["node-module-main", { platform: "node", mainFields: ["module", "main"], conditions: [] }, ["import-statement", "require-call"]],
    ["neutral-fields", { platform: "neutral", mainFields: ["main"], conditions: ["import", "production"] }, ["import-statement"]],
    ["packages-external", { platform: "browser", packages: "external" }, ["import-statement"]],
    [
      "externals",
      { platform: "node", external: ["react", "@babel/*", "*.css", "./src/*", "vue/dist/*", "three"], format: "esm" },
      ["import-statement", "require-call"],
    ],
    ["alias", { platform: "browser", alias: { lodash: "lodash-es", "fake-react": "react", "@my/zod": "zod", util: "./packages" } }, ["import-statement"]],
    ["exts", { platform: "browser", resolveExtensions: [".mjs", ".js", ".json", ".ts"] }, ["import-statement", "require-call"]],
  ];
  const groups = [];
  for (const [cfgName, cfg, kinds] of configs) {
    cfg.absWorkingDir = root;
    const reqs = [];
    for (const kind of kinds) for (const r of base) reqs.push({ ...r, kind });
    if (cfgName === "alias") {
      for (const kind of kinds) for (const p of ["lodash", "lodash/add", "fake-react", "fake-react/", "@my/zod", "util", "util/"]) reqs.push({ path: p, resolveDir: root, kind });
    }
    groups.push({ cfgName, cfg, reqs });
  }
  prefetchGroups("sweep", groups, refsFor("native"));
  for (const { cfgName, cfg, reqs } of groups) {
    await runGroup("sweep", cfgName, cfg, reqs, refsFor("native"));
    report(`sweep/${cfgName}`);
  }
}

// ---------------------------------------------------------------------------
// Suite 2: synthetic fixtures

function writeTree(root, tree) {
  for (const [rel, contents] of Object.entries(tree)) {
    const p = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (contents === null) fs.mkdirSync(p, { recursive: true });
    else fs.writeFileSync(p, typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  }
}

function junction(target, link) {
  try {
    fs.rmSync(link, { recursive: false, force: true });
  } catch {}
  try {
    fs.unlinkSync(link);
  } catch {}
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

function makeFixtures() {
  const root = path.join(os.tmpdir(), "esb-resolve-fixtures");
  fs.rmSync(root, { recursive: true, force: true });
  const f = "export default 1\n";
  writeTree(root, {
    "package.json": {
      name: "fx-root",
      type: "module",
      sideEffects: ["./src/side/*.js", "*.css", "./src/effect.js", "src/g?ob-*.js", "**/deep/**/x.js"],
      imports: {
        "#internal/*": "./src/internal/*.js",
        "#dep": { node: "dep-node", default: "./src/dep-browser.js" },
        "#cond": { import: "./src/c.mjs", require: "./src/c.cjs" },
        "#builtin": "fs",
        "#pkg": "pkg-main",
        "#dir/": "./src/dir/",
        "#bad": "../outside.js",
        "#null": null,
      },
      browser: {
        "./src/node-only.js": "./src/browser-impl.js",
        "./src/disabled.js": false,
        fs: false,
        path: "pkg-main",
        "./src/noext": "./src/noext-browser.js",
        "pkg-exports": "./src/pkg-exports-shim.js",
        "./src/dir/index.js": "./src/dir-browser.js",
      },
    },
    "tsconfig.json": {
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@app/*": ["src/app/*"],
          exact: ["src/exact.ts"],
          "multi/*": ["missing/*", "src/multi/*"],
          "*": ["src/star/*"],
          "types-only": ["src/types.d.ts"],
          "@app/special/*": ["src/special/*"],
          "${configDir}/x": ["src/exact.ts"],
        },
        jsx: "react-jsx",
        jsxImportSource: "preact",
      },
    },
    "src/index.ts": f,
    "src/app/a.ts": f,
    "src/app/b.tsx": f,
    "src/special/s.js": f,
    "src/exact.ts": f,
    "src/multi/m.js": f,
    "src/star/s.js": f,
    "src/star/pkg-main.js": f,
    "src/types.d.ts": f,
    "src/internal/x.js": f,
    "src/dep-browser.js": f,
    "src/c.mjs": f,
    "src/c.cjs": f,
    "src/node-only.js": f,
    "src/browser-impl.js": f,
    "src/disabled.js": f,
    "src/noext.js": f,
    "src/noext-browser.js": f,
    "src/pkg-exports-shim.js": f,
    "src/side/one.js": f,
    "src/effect.js": f,
    "src/glob-1.js": f,
    "src/pure.js": f,
    "src/styles.css": "a{}",
    "src/deep/a/b/x.js": f,
    "src/dir/index.js": f,
    "src/dir-browser.js": f,
    "src/dir2/index.ts": f,
    "src/file.js": f,
    "src/file/index.js": f,
    "src/Case.js": f,
    "src/CaseDir/index.js": f,
    "src/rew.ts": f,
    "src/rew2.tsx": f,
    "src/rew3.mts": f,
    "src/rew4.cts": f,
    "src/q.js": f,
    "src/data.json": "{}",
    "src/x.module.css": "a{}",
    "src/both.js": f,
    "src/both.ts": f,
    "src/both.css": "a{}",
    "src/only.css": "a{}",
    "src/weird name.js": f,
    "src/percent%20.js": f,
    "src/dot.dir/index.js": f,
    "src/empty-dir": null,
    "src/sub/tsconfig.json": { extends: "../../tsconfig.base.json", compilerOptions: { jsxFactory: "h", jsxFragmentFactory: "Fragment" } },
    "src/sub/file.tsx": f,
    "src/sub/deeper/tsconfig.json": { extends: ["../../../tsconfig.base.json", "./local"], compilerOptions: { strict: true } },
    "src/sub/deeper/local.json": { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, baseUrl: "./base", paths: { "~/*": ["./lib/*"] } } },
    "src/sub/deeper/base/modx.js": f,
    "src/sub/deeper/lib/l.js": f,
    "src/sub/deeper/file.tsx": f,
    "tsconfig.base.json": { compilerOptions: { jsx: "react", target: "es2020", verbatimModuleSyntax: true, alwaysStrict: false } },
    "proj-pkg-extends/tsconfig.json": { extends: "pkg-tsconfig", compilerOptions: {} },
    "proj-pkg-extends/a.ts": f,
    "proj-pkg-exports/tsconfig.json": { extends: "pkg-tsconfig-exports/strict" },
    "proj-pkg-exports/a.ts": f,
    "proj-pkg-plain/tsconfig.json": { extends: "pkg-tsconfig-plain/tsconfig.custom.json" },
    "proj-pkg-plain/a.ts": f,
    "proj-pkg-dir/tsconfig.json": { extends: "pkg-tsconfig-plain" },
    "proj-pkg-dir/a.ts": f,
    "proj-dot/tsconfig.json": { extends: "..", compilerOptions: { jsxImportSource: "solid-js" } },
    "proj-dot/a.ts": f,
    "proj-noext/tsconfig.json": { extends: "./base" },
    "proj-noext/base.json": { compilerOptions: { jsx: "react-jsxdev", paths: { "p/*": ["./pp/*"] } } },
    "proj-noext/pp/y.js": f,
    "proj-noext/a.ts": f,
    "proj-cfgdir/tsconfig.json": { extends: "./cfg/base.json" },
    "proj-cfgdir/cfg/base.json": { compilerOptions: { baseUrl: "${configDir}/src2", paths: { "cd/*": ["${configDir}/src2/cd/*"] } } },
    "proj-cfgdir/src2/cd/k.js": f,
    "proj-cfgdir/src2/bu.js": f,
    "proj-cfgdir/a.ts": f,
    "proj-jsconfig/jsconfig.json": { compilerOptions: { baseUrl: "src", jsx: "preserve" } },
    "proj-jsconfig/src/j.js": f,
    "proj-jsconfig/a.js": f,
    "proj-nobase/tsconfig.json": { compilerOptions: { paths: { "nb/*": ["./nb/*"], "abs/*": ["/definitely/not/here/*", "./nb/*"] } } },
    "proj-nobase/nb/z.js": f,
    "proj-nobase/a.ts": f,
    "proj-bad-paths/tsconfig.json": { compilerOptions: { paths: { "bad/*": ["nb/*"] } } },
    "proj-bad-paths/a.ts": f,
    "proj-cycle/tsconfig.json": { extends: "./other.json" },
    "proj-cycle/other.json": { extends: "./tsconfig.json" },
    "proj-cycle/a.ts": f,
    "proj-missing-base/tsconfig.json": { extends: "./nope.json" },
    "proj-missing-base/a.ts": f,
    "proj-override/a.ts": f,
    "proj-override/tsconfig.json": { compilerOptions: { baseUrl: "." } },
    "proj-override/special.json": { compilerOptions: { paths: { "ov/*": ["./ovdir/*"] }, jsx: "react-jsx" } },
    "proj-override/ovdir/o.js": f,
    "proj-override/app.ts": f,
    "proj-selfpkg/package.json": { name: "proj-selfpkg", exports: { ".": "./main.js", "./feature": { import: "./feat.mjs", require: "./feat.cjs" } } },
    "proj-selfpkg/main.js": f,
    "proj-selfpkg/feat.mjs": f,
    "proj-selfpkg/feat.cjs": f,
    "proj-selfpkg/sub/inner.js": f,
    "node_modules/pkg-exports/package.json": {
      name: "pkg-exports",
      exports: {
        ".": { import: "./esm/index.js", require: "./cjs/index.js" },
        "./feature": { browser: { import: "./esm/feature-browser.js", default: "./cjs/feature-browser.js" }, node: "./cjs/feature-node.js", default: "./esm/feature.js" },
        "./utils/*": "./esm/utils/*.js",
        "./utils/*.js": "./esm/utils/*.js",
        "./dir/": "./esm/dir/",
        "./private/*": null,
        "./package.json": "./package.json",
        "./arr": ["invalid:x", "./esm/arr.js"],
        "./missing": "./nope.js",
        "./star/*": "./esm/star/*",
        "./dev": { development: "./esm/dev.js", production: "./esm/prod.js", default: "./esm/def.js" },
        "./ts": "./esm/ts.js",
        "./dirtarget": "./esm/dir",
        "./encoded": "./esm/a%2fb.js",
        "./pct": "./esm/p%41.js",
        "./onlyimport": { import: "./esm/index.js" },
        "./nested": { node: { import: "./esm/n-node.mjs", require: "./cjs/n-node.cjs" }, default: { worker: "./esm/n-worker.js", default: "./esm/n-default.js" } },
        "./types": { types: "./index.d.ts" },
      },
    },
    "node_modules/pkg-exports/esm/index.js": f,
    "node_modules/pkg-exports/cjs/index.js": f,
    "node_modules/pkg-exports/esm/feature-browser.js": f,
    "node_modules/pkg-exports/cjs/feature-browser.js": f,
    "node_modules/pkg-exports/cjs/feature-node.js": f,
    "node_modules/pkg-exports/esm/feature.js": f,
    "node_modules/pkg-exports/esm/utils/u.js": f,
    "node_modules/pkg-exports/esm/utils/sub/v.js": f,
    "node_modules/pkg-exports/esm/dir/d.js": f,
    "node_modules/pkg-exports/esm/dir/index.js": f,
    "node_modules/pkg-exports/esm/arr.js": f,
    "node_modules/pkg-exports/esm/star/s.js": f,
    "node_modules/pkg-exports/esm/dev.js": f,
    "node_modules/pkg-exports/esm/prod.js": f,
    "node_modules/pkg-exports/esm/def.js": f,
    "node_modules/pkg-exports/esm/ts.ts": f,
    "node_modules/pkg-exports/esm/pA.js": f,
    "node_modules/pkg-exports/esm/n-node.mjs": f,
    "node_modules/pkg-exports/cjs/n-node.cjs": f,
    "node_modules/pkg-exports/esm/n-worker.js": f,
    "node_modules/pkg-exports/esm/n-default.js": f,
    "node_modules/pkg-main/package.json": { name: "pkg-main", main: "./lib/main", module: "./lib/module.js", browser: "./lib/browser.js" },
    "node_modules/pkg-main/lib/main.js": f,
    "node_modules/pkg-main/lib/module.js": f,
    "node_modules/pkg-main/lib/browser.js": f,
    "node_modules/pkg-browsermap/package.json": {
      name: "pkg-browsermap",
      main: "main.js",
      browser: { "./main.js": "./browser.js", "./lib/node.js": false, util: "./shim/util.js", "./noext": "./noext-b.js", "other-pkg": "pkg-main", "./lib": "./lib-browser/index.js" },
    },
    "node_modules/pkg-browsermap/main.js": f,
    "node_modules/pkg-browsermap/browser.js": f,
    "node_modules/pkg-browsermap/lib/node.js": f,
    "node_modules/pkg-browsermap/lib/index.js": f,
    "node_modules/pkg-browsermap/lib-browser/index.js": f,
    "node_modules/pkg-browsermap/shim/util.js": f,
    "node_modules/pkg-browsermap/noext.js": f,
    "node_modules/pkg-browsermap/noext-b.js": f,
    "node_modules/pkg-browsermap/inner/x.js": f,
    "node_modules/pkg-module-only/package.json": { name: "pkg-module-only", module: "index.mjs" },
    "node_modules/pkg-module-only/index.mjs": f,
    "node_modules/pkg-module-only/index.js": f,
    "node_modules/pkg-type-module/package.json": { name: "pkg-type-module", type: "module", main: "index.js" },
    "node_modules/pkg-type-module/index.js": f,
    "node_modules/pkg-type-cjs/package.json": { name: "pkg-type-cjs", type: "commonjs" },
    "node_modules/pkg-type-cjs/index.js": f,
    "node_modules/pkg-type-dts/package.json": { name: "pkg-type-dts", type: "./index.d.ts" },
    "node_modules/pkg-type-dts/index.js": f,
    "node_modules/pkg-se-false/package.json": { name: "pkg-se-false", sideEffects: false },
    "node_modules/pkg-se-false/index.js": f,
    "node_modules/pkg-se-arr/package.json": { name: "pkg-se-arr", sideEffects: ["./lib/effect.js", "**/*.css", "lib/glob-*.js", "lib/q?.js"] },
    "node_modules/pkg-se-arr/index.js": f,
    "node_modules/pkg-se-arr/lib/effect.js": f,
    "node_modules/pkg-se-arr/lib/pure.js": f,
    "node_modules/pkg-se-arr/lib/glob-a.js": f,
    "node_modules/pkg-se-arr/lib/q1.js": f,
    "node_modules/pkg-se-arr/lib/s.css": "a{}",
    "node_modules/pkg-imports/package.json": { name: "pkg-imports", imports: { "#a": "./a.js", "#b/*": "./b/*.js", "#ext": "ext-pkg", "#ext/*": "ext-pkg/*" } },
    "node_modules/pkg-imports/a.js": f,
    "node_modules/pkg-imports/b/c.js": f,
    "node_modules/pkg-imports/index.js": f,
    "node_modules/ext-pkg/index.js": f,
    "node_modules/ext-pkg/sub.js": f,
    "node_modules/dep-node/index.js": f,
    "node_modules/@scope/pkg/package.json": { name: "@scope/pkg", main: "dist/index.js" },
    "node_modules/@scope/pkg/dist/index.js": f,
    "node_modules/@scope/pkg/dist/other.js": f,
    "node_modules/pkg-tsconfig/package.json": { name: "pkg-tsconfig", tsconfig: "./configs/base.json" },
    "node_modules/pkg-tsconfig/configs/base.json": { compilerOptions: { jsx: "react-jsx", jsxImportSource: "@emotion/react", useDefineForClassFields: true } },
    "node_modules/pkg-tsconfig-exports/package.json": { name: "pkg-tsconfig-exports", exports: { "./strict": "./strict.json" } },
    "node_modules/pkg-tsconfig-exports/strict.json": { compilerOptions: { strict: true, jsxFactory: "React.h" } },
    "node_modules/pkg-tsconfig-plain/tsconfig.custom.json": { compilerOptions: { jsxFragmentFactory: "Frag", experimentalDecorators: true } },
    "node_modules/pkg-tsconfig-plain/tsconfig.json": { compilerOptions: { target: "esnext" } },
    "node_modules/pkg-dir-main/package.json": { name: "pkg-dir-main", main: "lib" },
    "node_modules/pkg-dir-main/lib/index.js": f,
    "node_modules/pkg-ts-src/package.json": { name: "pkg-ts-src" },
    "node_modules/pkg-ts-src/index.ts": f,
    "node_modules/pkg-ts-src/index.js": f,
    "node_modules/pkg-ts-src/tsconfig.json": { compilerOptions: { baseUrl: ".", paths: { "*": ["nope/*"] } } },
    "node_modules/pkg-ts-src/util.ts": f,
    "node_modules/pkg-ts-src/util.css": "a{}",
    "node_modules/pkg-dead-cond/package.json": { name: "pkg-dead-cond", exports: { default: "./a.js", import: "./b.js" } },
    "node_modules/pkg-dead-cond/a.js": f,
    "node_modules/pkg-main-dts/package.json": { name: "pkg-main-dts", main: "index.d.ts" },
    "node_modules/pkg-main-dts/index.js": f,
    "node_modules/pkg-cjs-main/package.json": { name: "pkg-cjs-main", main: "./index.cjs", module: "./index.mjs" },
    "node_modules/pkg-cjs-main/index.cjs": f,
    "node_modules/pkg-cjs-main/index.mjs": f,
    "node_modules/pkg-browser-false/package.json": { name: "pkg-browser-false", browser: { "./index.js": false } },
    "node_modules/pkg-browser-false/index.js": f,
    "node_modules/pkg-browser-str-dir/package.json": { name: "pkg-browser-str-dir", browser: "./browser" },
    "node_modules/pkg-browser-str-dir/browser/index.js": f,
    "node_modules/pkg-browser-str-dir/index.js": f,
    "node_modules/nested-parent/package.json": { name: "nested-parent", main: "index.js" },
    "node_modules/nested-parent/index.js": f,
    "node_modules/nested-parent/node_modules/nested-child/index.js": f,
    "node_modules/nested-parent/node_modules/pkg-main/package.json": { name: "pkg-main", main: "own.js" },
    "node_modules/nested-parent/node_modules/pkg-main/own.js": f,
    "linked-target/package.json": { name: "linked", main: "index.js", sideEffects: false },
    "linked-target/index.js": f,
    "linked-target/sub/s.js": f,
    "linked-target/node_modules/linked-dep/index.js": f,
    "node-path-dir/np-pkg/index.js": f,
    "node-path-dir/np-file.js": f,
    "node-path-dir2/np-pkg2/package.json": { main: "m.js" },
    "node-path-dir2/np-pkg2/m.js": f,
    "a-file-not-dir": "x",
  });
  junction(path.join(root, "linked-target"), path.join(root, "node_modules", "linked"));
  junction(path.join(root, "src"), path.join(root, "src-link"));
  junction(path.join(root, "node_modules", "pkg-main"), path.join(root, "node_modules", "pkg-main-link"));
  return root;
}

function fixtureRequests(root) {
  const src = path.join(root, "src");
  const reqs = [];
  const add = (p, resolveDir = src) => reqs.push({ path: p, resolveDir });
  // Relative paths, files vs directories, extensions, case
  for (const p of [
    "./index",
    "./index.ts",
    "./app/a",
    "./app/b",
    "./dir",
    "./dir/",
    "./dir2",
    "./file",
    "./file/",
    "./file.js",
    "./case.js",
    "./CASE",
    "./casedir",
    "./CaseDir/INDEX.js",
    "./rew.js",
    "./rew2.jsx",
    "./rew3.mjs",
    "./rew4.cjs",
    "./rew2.js",
    "./q.js?x=1",
    "./q.js#hash",
    "./q?raw",
    "./nope?x",
    "./data.json",
    "./data",
    "./x.module.css",
    "./both",
    "./only",
    "./weird name.js",
    "./percent%20.js",
    "./dot.dir",
    "./empty-dir",
    "./nope",
    ".",
    "..",
    "../src",
    "../src/",
    "./../src/index.ts",
    ".//index.ts",
    "./sub/file",
    "./node-only.js",
    "./disabled.js",
    "./noext",
    "./noext.js",
    "./side/one.js",
    "./effect.js",
    "./glob-1.js",
    "./pure.js",
    "./styles.css",
    "./deep/a/b/x.js",
    "../a-file-not-dir/x.js",
    "../a-file-not-dir",
    "src/index.ts",
    "/src/index.ts",
    "./index.ts/",
    "./*.js",
  ])
    add(p);
  // Absolute paths
  add(path.join(src, "index.ts"));
  add(path.join(src, "index"));
  add(path.join(src, "INDEX.TS"));
  add(path.join(src, "dir"));
  add(path.join(root, "nope", "x.js"));
  add(src.replaceAll(S, "/") + "/app/a");
  add("/" + src.replaceAll(S, "/").slice(3) + "/app/a");
  // tsconfig paths / baseUrl
  for (const p of ["@app/a", "@app/b", "@app/special/s", "@app/nope", "exact", "multi/m", "pkg-main", "s", "types-only", "src/exact", "${configDir}/x"]) add(p);
  // package.json imports
  for (const p of ["#internal/x", "#internal/nope", "#dep", "#cond", "#builtin", "#pkg", "#dir/index.js", "#dir/", "#bad", "#null", "#", "#missing"]) add(p);
  // Packages
  for (const p of [
    "pkg-exports",
    "pkg-exports/feature",
    "pkg-exports/utils/u",
    "pkg-exports/utils/u.js",
    "pkg-exports/utils/sub/v",
    "pkg-exports/dir/d.js",
    "pkg-exports/dir/",
    "pkg-exports/private/x",
    "pkg-exports/package.json",
    "pkg-exports/arr",
    "pkg-exports/missing",
    "pkg-exports/star/s.js",
    "pkg-exports/star/s",
    "pkg-exports/dev",
    "pkg-exports/ts",
    "pkg-exports/dirtarget",
    "pkg-exports/encoded",
    "pkg-exports/pct",
    "pkg-exports/onlyimport",
    "pkg-exports/nested",
    "pkg-exports/types",
    "pkg-exports/not-exported",
    "pkg-exports/esm/index.js",
    "pkg-main",
    "pkg-main/lib/main",
    "pkg-main/",
    "pkg-browsermap",
    "pkg-browsermap/lib/node.js",
    "pkg-browsermap/lib/node",
    "pkg-browsermap/noext",
    "pkg-browsermap/lib",
    "pkg-module-only",
    "pkg-type-module",
    "pkg-type-cjs",
    "pkg-type-dts",
    "pkg-se-false",
    "pkg-se-arr",
    "pkg-se-arr/lib/effect.js",
    "pkg-se-arr/lib/pure.js",
    "pkg-se-arr/lib/glob-a.js",
    "pkg-se-arr/lib/q1.js",
    "pkg-se-arr/lib/s.css",
    "pkg-imports",
    "ext-pkg",
    "ext-pkg/sub",
    "@scope/pkg",
    "@scope/pkg/dist/other",
    "@scope",
    "@scope/",
    "pkg-dir-main",
    "pkg-ts-src",
    "pkg-ts-src/util",
    "pkg-dead-cond",
    "pkg-main-dts",
    "pkg-cjs-main",
    "pkg-browser-false",
    "pkg-browser-str-dir",
    "nested-parent",
    "linked",
    "linked/sub/s",
    "linked/sub/s.js",
    "pkg-main-link",
    "np-pkg",
    "np-file",
    "np-pkg2",
    "fs",
    "node:fs",
    "node:nope",
    "fs/promises",
    "path",
    "util",
    "http://example.com/x.js",
    "https://example.com/x.js",
    "//example.com/x.js",
    "data:text/javascript,export default 1",
    "data:application/json;base64,e30=",
    "data:image/png;base64,iVBORw0KGgo=",
    "data:nocomma",
    ".pkg",
    "not-a-package-anywhere",
    "PKG-MAIN",
  ])
    add(p);
  // From inside packages
  const nm = path.join(root, "node_modules");
  for (const [p, dir] of [
    ["./main.js", path.join(nm, "pkg-browsermap")],
    ["./lib/node.js", path.join(nm, "pkg-browsermap")],
    ["./lib/node", path.join(nm, "pkg-browsermap")],
    ["./noext", path.join(nm, "pkg-browsermap")],
    ["util", path.join(nm, "pkg-browsermap")],
    ["util", path.join(nm, "pkg-browsermap", "inner")],
    ["other-pkg", path.join(nm, "pkg-browsermap")],
    ["./lib", path.join(nm, "pkg-browsermap")],
    ["../main.js", path.join(nm, "pkg-browsermap", "inner")],
    ["#a", path.join(nm, "pkg-imports")],
    ["#b/c", path.join(nm, "pkg-imports")],
    ["#ext", path.join(nm, "pkg-imports")],
    ["#ext/sub", path.join(nm, "pkg-imports")],
    ["#nope", path.join(nm, "pkg-imports")],
    ["./util", path.join(nm, "pkg-ts-src")],
    ["./index", path.join(nm, "pkg-ts-src")],
    ["nested-child", path.join(nm, "nested-parent")],
    ["pkg-main", path.join(nm, "nested-parent")],
    ["pkg-main", path.join(nm, "nested-parent", "node_modules", "nested-child")],
    ["linked-dep", path.join(root, "linked-target")],
    ["linked-dep", path.join(nm, "linked")],
    ["./s.js", path.join(nm, "linked", "sub")],
    ["../index.js", path.join(nm, "linked", "sub")],
    ["./index.ts", path.join(root, "src-link")],
    ["./side/one.js", path.join(root, "src-link")],
    ["proj-selfpkg", path.join(root, "proj-selfpkg", "sub")],
    ["proj-selfpkg/feature", path.join(root, "proj-selfpkg", "sub")],
    ["proj-selfpkg/nope", path.join(root, "proj-selfpkg", "sub")],
  ])
    add(p, dir);
  // tsconfig projects
  for (const proj of ["proj-pkg-extends", "proj-pkg-exports", "proj-pkg-plain", "proj-pkg-dir", "proj-dot", "proj-noext", "proj-cfgdir", "proj-jsconfig", "proj-nobase", "proj-bad-paths", "proj-cycle", "proj-missing-base"]) {
    const dir = path.join(root, proj);
    for (const p of ["./a", "./a.ts", "p/y", "cd/k", "bu", "j", "nb/z", "abs/z", "bad/x", "pkg-main"]) add(p, dir);
  }
  for (const p of ["./file", "~/l", "modx", "@app/a"]) add(p, path.join(src, "sub", "deeper"));
  return reqs;
}

async function suiteFixtures() {
  const root = makeFixtures();
  fixturesRootForFingerprint = root;
  const reqsBase = fixtureRequests(root);
  const configs = [
    ["browser", { platform: "browser" }, ["import-statement", "require-call", "dynamic-import"]],
    ["node", { platform: "node" }, ["import-statement", "require-call", "require-resolve"]],
    ["neutral", { platform: "neutral" }, ["import-statement", "require-call"]],
    ["browser-dev", { platform: "browser", conditions: ["development", "worker"] }, ["import-statement", "require-call"]],
    ["node-fields", { platform: "node", mainFields: ["module", "main"], conditions: ["production"] }, ["import-statement", "require-call"]],
    ["preserve", { platform: "browser", preserveSymlinks: true }, ["import-statement", "require-call"]],
    ["nodepaths", { platform: "node", nodePaths: [path.join(root, "node-path-dir"), "node-path-dir2", path.join(root, "a-file-not-dir")] }, ["import-statement"]],
    ["packages-external", { platform: "node", packages: "external" }, ["import-statement", "require-call"]],
    [
      "externals",
      { platform: "browser", external: ["pkg-main", "@scope/*", "*.css", "./src/app/*", "./nope", "linked", "#dep", "*/sub"] },
      ["import-statement", "require-call"],
    ],
    ["alias", { platform: "browser", alias: { "aliased-main": "pkg-main", "pkg-exports": "pkg-main", "@alias/x": "ext-pkg", "fs": "ext-pkg" } }, ["import-statement", "require-call"]],
    ["exts", { platform: "browser", resolveExtensions: [".css", ".js", ".ts"], loader: { ".js": "jsx" } }, ["import-statement", "import-rule", "url-token", "composes-from"]],
    ["css", { platform: "browser" }, ["import-rule", "url-token", "composes-from"]],
    ["node12", { platform: "node", target: "node12", format: "esm" }, ["import-statement", "require-call"]],
    ["node12-cjs", { platform: "node", target: "node14.0", format: "cjs" }, ["import-statement", "require-call"]],
    ["tsconfig-path", { platform: "browser", tsconfig: path.join(root, "proj-override", "special.json") }, ["import-statement"]],
    ["tsconfig-raw", { platform: "browser", tsconfigRaw: { compilerOptions: { baseUrl: path.join(root, "src"), paths: { "raw/*": ["./app/*"] } } } }, ["import-statement"]],
    ["tsconfig-raw-ext", { platform: "browser", tsconfigRaw: { extends: path.join(root, "tsconfig.base.json") } }, ["import-statement"]],
    ["entry", { platform: "browser" }, ["entry-point"]],
  ];
  const groups = [];
  for (const [cfgName, cfg, kinds] of configs) {
    cfg.absWorkingDir = root;
    let base = reqsBase;
    if (cfgName.startsWith("tsconfig")) base = base.concat([{ path: "ov/o", resolveDir: path.join(root, "proj-override") }, { path: "raw/a", resolveDir: root }]);
    if (cfgName === "alias") base = base.concat(["aliased-main", "aliased-main/lib/main", "@alias/x/sub", "fs/", "@alias/x"].map((p) => ({ path: p, resolveDir: path.join(root, "src") })));
    const reqs = [];
    for (const kind of kinds) for (const r of base) reqs.push({ ...r, kind });
    groups.push({ cfgName, cfg, reqs });
  }
  prefetchGroups("fixtures", groups, refsFor("wasm"));
  for (const { cfgName, cfg, reqs } of groups) {
    await runGroup("fixtures", cfgName, cfg, reqs, refsFor("wasm"));
    report(`fixtures/${cfgName}`);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Suite 3: tsconfig-derived settings (TSConfigJSX, TSConfig, TSAlwaysStrict)
// compared by building a TSX file with esbuild and transforming the same file
// with the settings the port resolved

const TSX = `import T from "./types";
export type U = T;
export class C { y = 1; declare z: number }
export const el = <div a="1">{T as any}</div>;
export const fr = <>x</>;
`;

async function suiteTSConfig(root) {
  const esbuild = require("esbuild");
  const dirs = ["src", "src/sub", "src/sub/deeper", "proj-pkg-extends", "proj-pkg-exports", "proj-pkg-plain", "proj-pkg-dir", "proj-dot", "proj-noext", "proj-cfgdir", "proj-jsconfig", "proj-nobase"];
  let ok = 0;
  let bad = 0;
  for (const d of dirs) {
    const dir = path.join(root, ...d.split("/"));
    const file = path.join(dir, "tsx-check.tsx");
    fs.writeFileSync(file, TSX);
    const cfg = { platform: "browser", absWorkingDir: root };
    const state = makeOurResolver(cfg, fs);
    const ours = ourResolve(state, { path: "./tsx-check.tsx", resolveDir: dir, kind: "entry-point" });
    let expected;
    try {
      const r = await esbuild.build({ entryPoints: [file], bundle: false, write: false, logLevel: "silent", format: "esm", absWorkingDir: root });
      expected = r.outputFiles[0].text;
    } catch (e) {
      expected = "error: " + String(e.message).split("\n")[0];
    }
    if (ours.kind !== "ok") {
      bad++;
      failures.push(`TSCONFIG ${d}: ours ${ours.kind} ${ours.why ?? ""}`);
      continue;
    }
    const r = ours.result;
    const jsx = r.tsConfigJSX;
    // (the build's jsxDev "fileName" is the pretty path relative to the cwd)
    const opts = { loader: "tsx", format: "esm", sourcefile: path.relative(root, file).split(path.sep).join("/"), tsconfigRaw: { compilerOptions: {} } };
    // config.TSConfigJSX.ApplyTo on the default JSX options
    if (jsx.jsx === config.TSJSXReact) opts.jsx = "transform";
    if (jsx.jsx === config.TSJSXReactJSX) opts.jsx = "automatic";
    if (jsx.jsx === config.TSJSXReactJSXDev) {
      opts.jsx = "automatic";
      opts.jsxDev = true;
    }
    if (jsx.jsxFactory !== null && jsx.jsxFactory.length > 0) opts.jsxFactory = jsx.jsxFactory.join(".");
    if (jsx.jsxFragmentFactory !== null && jsx.jsxFragmentFactory.length > 0) opts.jsxFragment = jsx.jsxFragmentFactory.join(".");
    if (jsx.jsxImportSource !== null) opts.jsxImportSource = jsx.jsxImportSource;
    const co = opts.tsconfigRaw.compilerOptions;
    const ts = r.tsConfig;
    if (ts !== null) {
      if (ts.experimentalDecorators !== config.Unspecified) co.experimentalDecorators = ts.experimentalDecorators === config.True;
      if (ts.useDefineForClassFields !== config.Unspecified) co.useDefineForClassFields = ts.useDefineForClassFields === config.True;
      if (ts.verbatimModuleSyntax !== config.Unspecified) co.verbatimModuleSyntax = ts.verbatimModuleSyntax === config.True;
      if (ts.preserveValueImports !== config.Unspecified) co.preserveValueImports = ts.preserveValueImports === config.True;
      if (ts.target === config.TSTargetBelowES2022) co.target = "es2020";
      if (ts.target === config.TSTargetAtOrAboveES2022) co.target = "esnext";
    }
    if (r.tsAlwaysStrict !== null) co[r.tsAlwaysStrict.name] = r.tsAlwaysStrict.value;
    let actual;
    try {
      actual = (await esbuild.transform(TSX, opts)).code;
    } catch (e) {
      actual = "error: " + String(e.message).split("\n")[0];
    }
    if (actual === expected) ok++;
    else {
      bad++;
      failures.push(`TSCONFIG ${d}:\n--- esbuild build:\n${expected}\n--- from the port's settings (${JSON.stringify(opts)}):\n${actual}`);
    }
  }
  console.log(`tsconfig settings: ok ${ok}, bad ${bad}`);
  totals.ok += ok;
  totals.mismatch += bad;
}

// ---------------------------------------------------------------------------
// Suite 4: host === null (esbuild-wasm in a browser: every fs call fails with
// ENOSYS). The reference is esbuild-wasm's browser build run without a worker
// in a child process (globalThis.fs is then the ENOSYS stub).

const BROWSER_REQS = [
  ["./x.js", "/"],
  ["./x.js", "/src"],
  ["../x.js", "/src"],
  ["/abs/x.js", "/"],
  ["pkg", "/"],
  ["pkg/sub", "/src"],
  ["@scope/pkg", "/"],
  ["ext", "/"],
  ["ext/sub", "/"],
  ["ext-star-foo", "/"],
  ["./ext-rel", "/"],
  ["http://x.com/a.js", "/"],
  ["//x.com/a.js", "/"],
  ["data:text/javascript,1", "/"],
  ["data:image/png,xx", "/"],
  ["fs", "/"],
  ["node:fs", "/"],
  ["aliased", "/"],
  ["aliased/x", "/"],
  ["aliased-ext", "/src"],
  ["x*y", "/"],
  [".", "/"],
];

async function suiteBrowser() {
  const cfgs = [
    ["browser", { platform: "browser", external: ["ext", "ext-star-*", "./ext-rel"], alias: { aliased: "pkg", "aliased-ext": "ext" } }],
    ["node", { platform: "node", external: ["ext"], alias: { "aliased-ext": "ext" } }],
    ["pkgs-external", { platform: "neutral", packages: "external" }],
  ];
  for (const kind of ["import-statement", "require-call"]) {
    for (const [cfgName, cfg] of cfgs) {
      cfg.absWorkingDir = "/";
      const reqs = BROWSER_REQS.map(([p, dir]) => ({ path: p, resolveDir: dir, kind }));
      const child = spawnSync(process.execPath, [path.join(here, "resolve-diff-browser-ref.mjs")], {
        input: JSON.stringify({ cfg, reqs }),
        encoding: "utf8",
        maxBuffer: 1 << 26,
      });
      if (child.status !== 0) {
        failures.push(`BROWSER reference failed: ${child.stderr}`);
        totals.crash++;
        continue;
      }
      const ref = JSON.parse(child.stdout);
      let state;
      try {
        state = makeOurResolver(cfg, null);
      } catch (e) {
        state = { error: e };
      }
      for (let i = 0; i < reqs.length; i++) {
        compare("browser", cfgName, reqs[i], ref[i], ourResolve(state, reqs[i]));
      }
    }
  }
  report("browser (host null)");
}

// ---------------------------------------------------------------------------

let lastTotals = { ...totals };
function report(what) {
  const d = {};
  for (const k of Object.keys(totals)) d[k] = totals[k] - lastTotals[k];
  lastTotals = { ...totals };
  console.log(`${what}: ok ${d.ok}, okError ${d.okError}, okWarn ${d.okWarn}, mismatch ${d.mismatch}, crash ${d.crash}`);
}

// A reference process (see runReferenceProcess)
if (args[0] === "--ref-worker") {
  const { refName, cfg, reqs } = JSON.parse(fs.readFileSync(0, "utf8"));
  const esbuild = refName === "wasm" ? require("esbuild-wasm") : require("esbuild");
  const r = await esbuildResolveAll(esbuild, cfg, reqs);
  process.stdout.write(JSON.stringify(r), () => process.exit(0));
  await new Promise(() => {});
}

const t0 = Date.now();
let fixturesRoot = null;
if (!onlySuite || onlySuite === "fixtures" || onlySuite === "tsconfig") fixturesRoot = onlySuite === "tsconfig" ? makeFixtures() : await suiteFixtures();
if (!onlySuite || onlySuite === "tsconfig") await suiteTSConfig(fixturesRoot);
if (!onlySuite || onlySuite === "browser") await suiteBrowser();
if (!onlySuite || onlySuite === "sweep") await suiteSweep();

const shown = verbose ? failures : failures.slice(0, 40);
for (const f of shown) console.log(f);
if (failures.length > shown.length) console.log(`... and ${failures.length - shown.length} more (--verbose)`);
console.log(
  `port: ${ourCount} resolves in ${ourTime.toFixed(0)}ms; reference: ${(refTime / 1000).toFixed(1)}s
` +
  `TOTAL: ok ${totals.ok}, okError ${totals.okError}, okWarn ${totals.okWarn}, mismatch ${totals.mismatch}, crash ${totals.crash} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
);
process.exit(totals.mismatch + totals.crash === 0 ? 0 : 1);
