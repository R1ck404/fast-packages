// Helper for test/resolve-diff.mjs: runs esbuild-wasm's *browser* build in
// this process without a worker. There is no globalThis.fs in node, so the
// browser build installs its stub file system where every call fails with
// ENOSYS, exactly like esbuild-wasm in a browser. Reads {cfg, reqs} as JSON
// on stdin and writes the build.resolve results as JSON on stdout.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve("esbuild-wasm/package.json"));
if (globalThis.fs !== undefined) throw new Error("globalThis.fs must not exist");
globalThis.self = globalThis; // (the browser build's non-worker mode reads globals through "self")
const esbuild = await import("file:///" + path.join(wasmDir, "esm", "browser.js").replaceAll("\\", "/"));
await esbuild.initialize({ wasmModule: new WebAssembly.Module(fs.readFileSync(path.join(wasmDir, "esbuild.wasm"))), worker: false });

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const { cfg, reqs } = input;
const results = new Array(reqs.length);
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
          for (let i = 0; i < reqs.length; i++) {
            const req = reqs[i];
            const r = await b.resolve(req.path, { kind: req.kind, resolveDir: req.resolveDir });
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
          return { path: "entry", namespace: "resolve-diff" };
        });
        b.onLoad({ filter: /.*/, namespace: "resolve-diff" }, () => ({ contents: "" }));
      },
    },
  ],
};
for (const key of ["platform", "mainFields", "conditions", "alias", "external", "packages", "resolveExtensions", "tsconfigRaw", "nodePaths", "format"]) {
  if (cfg[key] !== undefined) buildOptions[key] = cfg[key];
}
let buildError = null;
try {
  await esbuild.build(buildOptions);
} catch (e) {
  buildError = e;
}
for (let i = 0; i < reqs.length; i++) {
  if (results[i] === undefined) results[i] = { path: "", errors: ["build failed: " + (buildError ? String(buildError.message).split("\n")[0] : "?")], warnings: [] };
}
process.stdout.write(JSON.stringify(results));
process.exit(0);
