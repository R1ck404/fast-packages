// esbuild-wasm benchmark. Usage: node bench/esbuild.bench.mjs <impl>
//   impl: wasm (esbuild-wasm browser build, worker:false — Nodepod's engine)
//       | native (reference ceiling) | fast (@r1ck404/fast-esbuild-wasm/node.mjs)
//       | prev (snapshot in .scratch/esbuild-prev/fast-esbuild-wasm, for A/B runs)
import { runSuite } from "./harness.mjs";
import { loadJs, readText, nm, root } from "./corpus.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const impl = process.argv[2] || "wasm";

async function loadImpl(name) {
  if (name === "wasm") {
    globalThis.self ??= globalThis;
    const esbuild = require("esbuild-wasm/lib/browser.js");
    const t0 = performance.now();
    const wasmModule = await WebAssembly.compile(readFileSync(join(nm, "esbuild-wasm/esbuild.wasm")));
    await esbuild.initialize({ wasmModule, worker: false });
    process.stdout.write("INIT " + (performance.now() - t0).toFixed(1) + "\n");
    return esbuild;
  }
  if (name === "native") return await import("esbuild");
  if (name === "fast" || name === "prev") {
    // prev: a snapshot of the package before the current round of changes
    const t0 = performance.now();
    const esbuild = await import(name === "fast" ? "@r1ck404/fast-esbuild-wasm/node.mjs" : "../.scratch/esbuild-prev/fast-esbuild-wasm/index.mjs");
    await esbuild.initialize({});
    process.stdout.write("INIT " + (performance.now() - t0).toFixed(1) + "\n");
    return esbuild;
  }
  throw new Error("unknown impl " + name);
}

const esbuild = await loadImpl(impl);

// Nodepod's install-time ESM -> CJS transform options
const cjsOpts = (loader) => ({
  loader,
  format: "cjs",
  target: "esnext",
  platform: "neutral",
  define: {
    "import.meta.url": "import_meta.url",
    "import.meta.dirname": "import_meta.dirname",
    "import.meta.filename": "import_meta.filename",
    "import.meta": "import_meta",
  },
});

const js = loadJs(true);
const cases = [];
for (const f of js.filter((f) => f.module)) {
  cases.push({ name: `esm->cjs ${f.name}`, bytes: f.code.length, fn: () => esbuild.transform(f.code, cjsOpts("js")) });
}
for (const f of js.filter((f) => !f.module && f.code.length < 600000)) {
  cases.push({ name: `cjs passthrough ${f.name}`, bytes: f.code.length, fn: () => esbuild.transform(f.code, cjsOpts("js")) });
}

// batch of small ESM files (like a package install): zod/v4 files
const zodDir = join(nm, "zod/v4/core");
const small = readdirSync(zodDir).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(zodDir, f), "utf8"));
const smallBytes = small.reduce((s, c) => s + c.length, 0);
cases.push({
  name: `esm->cjs batch ${small.length} zod/v4/core files`,
  bytes: smallBytes,
  fn: async () => {
    for (const code of small) await esbuild.transform(code, cjsOpts("js"));
  },
});

// TypeScript: Nodepod's own sources
// (Nodepod's src: the repo used to live inside the Nodepod checkout; now it
// sits next to it)
import { existsSync } from "node:fs";
const srcDir = [join(root, "../../src"), join(root, "../Nodepod/src")].find((d) => existsSync(join(d, "script-engine.ts"))) ?? join(root, "../../src");
const tsFiles = ["script-engine.ts", "memory-volume.ts", "syntax-transforms.ts", "module-transformer.ts"]
  .map((f) => {
    try {
      return [f, readFileSync(join(srcDir, f), "utf8")];
    } catch {
      return null;
    }
  })
  .filter(Boolean);
for (const [f, code] of tsFiles) {
  cases.push({ name: `ts->esm ${f} (${(code.length / 1024) | 0}KB)`, bytes: code.length, fn: () => esbuild.transform(code, { loader: "ts", format: "esm", target: "esnext" }) });
  cases.push({ name: `ts->cjs ${f}`, bytes: code.length, fn: () => esbuild.transform(code, cjsOpts("ts")) });
}
// TSX
const tsx =
  'import React from "react";\n' +
  Array.from(
    { length: 20 },
    (_, k) =>
      `export function App${k}({ items }: { items: string[] }) {\n  const [n, setN] = React.useState<number>(${k});\n  return <div className="app" onClick={() => setN(n + 1)}>{items.map((x, i) => <span key={i}>{x}</span>)} {n}</div>;\n}\n`,
  ).join("");
cases.push({ name: "tsx->js small component x20", bytes: tsx.length, fn: () => esbuild.transform(tsx, { loader: "tsx", format: "esm", target: "esnext", jsx: "automatic" }) });

// Vite dev-server style transforms (source maps + tsconfigRaw), as forwarded by
// Nodepod's esbuild polyfill
const viteOpts = (loader, sourcefile) => ({
  loader,
  target: "esnext",
  sourcemap: true,
  sourcefile,
  jsx: "automatic",
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: true, verbatimModuleSyntax: false, jsx: "react-jsx" } },
});
for (const [f, code] of tsFiles.slice(0, 2)) {
  cases.push({ name: `vite ts+sourcemap ${f}`, bytes: code.length, fn: () => esbuild.transform(code, viteOpts("ts", "/src/" + f)) });
}
cases.push({ name: "vite tsx+sourcemap component x20", bytes: tsx.length, fn: () => esbuild.transform(tsx, viteOpts("tsx", "/src/App.tsx")) });

// build: bundle zod through a plugin serving files (virtual POSIX paths, like
// Nodepod's MemoryVolume-backed esbuild polyfill)
import { posix } from "node:path";
const vfs = new Map();
const readV = (vp) => {
  let c = vfs.get(vp);
  if (c === undefined) vfs.set(vp, (c = readFileSync(join(nm, vp), "utf8")));
  return c;
};
for (const [name, entry, options] of [
  ["build bundle zod (plugin fs)", "/zod/v4/classic/index.js", {}],
  ["build bundle zod minified + source map (plugin fs)", "/zod/v4/classic/index.js", { minify: true, sourcemap: "external", outdir: "/out" }],
  ["build bundle lodash-es, 640 files (plugin fs)", "/lodash-es/lodash.js", {}],
  ["build bundle three, 1.2MB (plugin fs)", "/three/build/three.module.js", {}],
  ["build bundle react-dom client, 1MB cjs (plugin fs)", "/react-dom/cjs/react-dom-client.development.js", { format: "cjs" }],
])
cases.push({
  name,
  bytes: 0,
  opts: { maxTimeMs: 3000 },
  fn: () =>
    esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      ...options,
      plugins: [
        {
          name: "memfs",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (a) => {
              if (a.kind === "entry-point") return { path: a.path, namespace: "m" };
              if (!a.path.startsWith(".")) return { external: true };
              return { path: posix.join(posix.dirname(a.importer), a.path), namespace: "m" };
            });
            b.onLoad({ filter: /.*/, namespace: "m" }, (a) => ({ contents: readV(a.path), loader: "js", resolveDir: posix.dirname(a.path) }));
          },
        },
      ],
    }),
});

await runSuite(impl, cases, { maxTimeMs: Number(process.env.BENCH_TIME || 1500) });
process.exit(0);
