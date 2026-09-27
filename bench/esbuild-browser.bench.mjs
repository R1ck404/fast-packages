// esbuild in a real browser (headless Chromium via playwright-core), the way
// Nodepod runs it: browser build, default worker mode, wasm streamed from URL.
// Usage: node bench/esbuild-browser.bench.mjs <impl>
//   impl: wasm (esbuild-wasm 0.28.2 browser build) | fast (fast-esbuild-wasm)
//       | prev (snapshot in .scratch/esbuild-prev/fast-esbuild-wasm, for A/B runs)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { chromium } from "playwright-core";
import { root } from "./corpus.mjs";

const impl = process.argv[2] || "wasm";
// (Nodepod's src: the repo used to live inside the Nodepod checkout; now it
// sits next to it)
const repoSrc = [join(root, "../../src"), join(root, "../Nodepod/src")].find((d) => existsSync(join(d, "script-engine.ts"))) ?? join(root, "../../src");
const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".ts": "text/plain", ".json": "application/json" };

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file;
  if (url.startsWith("/nodepod-src/")) file = join(repoSrc, url.slice(13));
  else file = join(root, normalize(url));
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const libs = {
  wasm: { script: "/node_modules/esbuild-wasm/lib/browser.js", wasm: "/node_modules/esbuild-wasm/esbuild.wasm" },
  fast: { script: "/fast-esbuild-wasm/lib/browser.js", wasm: "/fast-esbuild-wasm/esbuild.wasm" },
  prev: { script: "/.scratch/esbuild-prev/fast-esbuild-wasm/lib/browser.js", wasm: "/.scratch/esbuild-prev/fast-esbuild-wasm/esbuild.wasm" },
}[impl];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error" || process.env.BENCH_VERBOSE) process.stderr.write("[page] " + m.text() + "\n");
});
await page.goto(base + "/bench/browser/blank.html");

// cold start: fresh page each time (fetch + compile + instantiate + start)
const initTimes = [];
for (let i = 0; i < 5; i++) {
  const p = await browser.newPage();
  await p.goto(base + "/bench/browser/blank.html");
  const t = await p.evaluate(async ({ script, wasm }) => {
    const t0 = performance.now();
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = script;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
    await self.esbuild.initialize({ wasmURL: wasm });
    const t1 = performance.now();
    await self.esbuild.transform("let a = 1", { loader: "js" });
    return [t1 - t0, performance.now() - t0];
  }, libs);
  initTimes.push(t);
  await p.close();
}
const med = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const out = (name, ms, bytes) =>
  process.stdout.write("RESULT " + JSON.stringify({ impl, name, ms, min: ms, samples: 1, batch: 1, mbps: bytes ? bytes / 1e6 / (ms / 1000) : undefined }) + "\n");
out("cold start: initialize()", med(initTimes.map((t) => t[0])));
out("cold start: initialize() + first transform", med(initTimes.map((t) => t[1])));

// load the library in the long-lived page
await page.evaluate(async ({ script, wasm }) => {
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = script;
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  await self.esbuild.initialize({ wasmURL: wasm });
}, libs);

const files = {
  "zod-errors.js (1.6KB esm)": "/node_modules/zod/v4/classic/errors.js",
  "zod-schemas.js (51KB esm)": "/node_modules/zod/v4/classic/schemas.js",
  "rollup node-entry (948KB esm)": "/node_modules/rollup/dist/es/shared/node-entry.js",
  "three.module (1.2MB esm)": "/node_modules/three/build/three.module.js",
};
const zodCore = ["api", "checks", "core", "doc", "errors", "json-schema", "parse", "regexes", "registries", "schemas", "to-json-schema", "util", "versions", "index", "config", "json-schema-generator", "json-schema-processors", "standard-schema"]
  .map((n) => `/node_modules/zod/v4/core/${n}.js`);
const tsFiles = ["script-engine.ts", "memory-volume.ts", "syntax-transforms.ts", "module-transformer.ts"].map((f) => "/nodepod-src/" + f);

const results = await page.evaluate(
  async ({ files, zodCore, tsFiles, timeBudget }) => {
    const esbuild = self.esbuild;
    const fetchText = async (u) => {
      const r = await fetch(u);
      return r.ok ? r.text() : null;
    };
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
    measure.n = 0;
    async function measure(fn, label) {
      console.log("measuring " + (label || ++measure.n));
      for (let i = 0; i < 2; i++) await fn();
      const samples = [];
      const t0 = performance.now();
      while (samples.length < 5 || (performance.now() - t0 < timeBudget && samples.length < 200)) {
        const s = performance.now();
        await fn();
        samples.push(performance.now() - s);
      }
      samples.sort((a, b) => a - b);
      return samples[samples.length >> 1];
    }
    const res = [];
    res.push({ name: "transform latency: empty input", ms: await measure(() => esbuild.transform("", { loader: "js" }), "empty") });
    res.push({ name: "transform latency: tiny TS", ms: await measure(() => esbuild.transform("export const a: number = 1", { loader: "ts" })) });
    for (const [name, url] of Object.entries(files)) {
      const code = await fetchText(url);
      res.push({ name: `esm->cjs ${name}`, bytes: code.length, ms: await measure(() => esbuild.transform(code, cjsOpts("js"))) });
    }
    const small = (await Promise.all(zodCore.map(fetchText))).filter(Boolean);
    const smallBytes = small.reduce((s, c) => s + c.length, 0);
    res.push({
      name: `esm->cjs batch ${small.length} zod/v4/core files (sequential)`,
      bytes: smallBytes,
      ms: await measure(async () => {
        for (const c of small) await esbuild.transform(c, cjsOpts("js"));
      }),
    });
    res.push({
      name: `esm->cjs batch ${small.length} zod/v4/core files (concurrent)`,
      bytes: smallBytes,
      ms: await measure(() => Promise.all(small.map((c) => esbuild.transform(c, cjsOpts("js"))))),
    });
    for (const url of tsFiles) {
      const code = await fetchText(url);
      if (!code) continue;
      const n = url.split("/").pop();
      res.push({ name: `ts->esm ${n} (${(code.length / 1024) | 0}KB)`, bytes: code.length, ms: await measure(() => esbuild.transform(code, { loader: "ts", format: "esm", target: "esnext" })) });
    }
    // Vite dev-server style transforms (source maps + tsconfigRaw)
    const viteOpts = (loader, sourcefile) => ({
      loader,
      target: "esnext",
      sourcemap: true,
      sourcefile,
      jsx: "automatic",
      tsconfigRaw: { compilerOptions: { useDefineForClassFields: true, verbatimModuleSyntax: false, jsx: "react-jsx" } },
    });
    for (const url of tsFiles.slice(0, 2)) {
      const code = await fetchText(url);
      if (!code) continue;
      const n = url.split("/").pop();
      res.push({ name: `vite ts+sourcemap ${n}`, bytes: code.length, ms: await measure(() => esbuild.transform(code, viteOpts("ts", "/src/" + n))) });
    }
    const tsx = Array.from(
      { length: 20 },
      (_, k) =>
        `export function App${k}({ items }: { items: string[] }) {\n  const [n, setN] = React.useState<number>(${k});\n  return <div className="app" onClick={() => setN(n + 1)}>{items.map((x, i) => <span key={i}>{x}</span>)} {n}</div>;\n}\n`,
    ).join("");
    res.push({ name: "vite tsx+sourcemap component x20", bytes: tsx.length, ms: await measure(() => esbuild.transform(tsx, viteOpts("tsx", "/src/App.tsx"))) });

    // build zod through a plugin (plugin callbacks run on the page, esbuild in its worker)
    const vfs = new Map();
    const join = (dir, p) => {
      const parts = dir.split("/").filter(Boolean);
      for (const seg of p.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== "." && seg) parts.push(seg);
      }
      return "/" + parts.join("/");
    };
    const dirname = (p) => p.slice(0, p.lastIndexOf("/")) || "/";
    const load = async (p) => {
      if (!vfs.has(p)) vfs.set(p, await fetchText("/node_modules/zod" + p));
      return vfs.get(p);
    };
    const build = () =>
      esbuild.build({
        entryPoints: ["/v4/classic/index.js"],
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        plugins: [
          {
            name: "memfs",
            setup(b) {
              b.onResolve({ filter: /.*/ }, (a) => {
                if (a.kind === "entry-point") return { path: a.path, namespace: "m" };
                if (!a.path.startsWith(".")) return { external: true };
                return { path: join(dirname(a.importer), a.path), namespace: "m" };
              });
              b.onLoad({ filter: /.*/, namespace: "m" }, async (a) => ({ contents: await load(a.path), loader: "js", resolveDir: dirname(a.path) }));
            },
          },
        ],
      });
    await build();
    res.push({ name: "build bundle zod (plugin fs)", ms: await measure(build) });
    return res;
  },
  { files, zodCore, tsFiles, timeBudget: Number(process.env.BENCH_TIME || 1500) },
);
for (const r of results) out(r.name, r.ms, r.bytes);
await browser.close();
server.close();
process.exit(0);
