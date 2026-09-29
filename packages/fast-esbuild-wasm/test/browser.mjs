// The browser builds in a real browser (Playwright; Chromium by default), in
// worker mode and with worker: false, next to esbuild-wasm's in the same page.
// Every result is compared with esbuild-wasm's: transforms (esm->cjs of real
// files, TS, TSX with a source map, CSS, errors, concurrent calls), builds
// with plugins (zod, minified and split; CSS), formatMessages() and
// analyzeMetafile(). The fast build never requests its wasm URL (the network
// requests are counted): nothing runs Go. A wasm URL that does not exist is
// accepted too (initialize() validates it and ignores the binary).
// usage: node packages/fast-esbuild-wasm/test/browser.mjs [chromium,firefox,webkit]
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import * as pw from "playwright-core";
import { createRequire } from "node:module";
import { root } from "../../../bench/corpus.mjs";

const names = (process.argv[2] || "chromium").split(",");
const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/blank.html") return res.writeHead(200, { "content-type": "text/html" }), res.end('<!doctype html><meta charset="utf-8"><title>esbuild</title>');
  const file = join(root, normalize(url));
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404), res.end();
  res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const FAST_WASM = "/packages/fast-esbuild-wasm/esbuild.wasm"; // (does not exist)
// native esbuild's results for the deeply nested inputs
const native = createRequire(import.meta.url)("esbuild");
const expected = {
  arrays: native.transformSync("x = " + "[".repeat(40000) + "]".repeat(40000) + ";\n", {}).code,
  rules: native.transformSync("a { ".repeat(6000) + "color: red" + " }".repeat(6000) + "\n", { loader: "css", minify: true, target: "chrome100" }).code,
};

// runs in the page
async function scenario({ build, fastWasm, worker, refWasm, expected }) {
  const load = async (path) => {
    if (path.includes("/esm/")) return (await import(path)).default;
    // (the UMD build defines self.esbuild)
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = path;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
    const m = self.esbuild;
    delete self.esbuild;
    return m;
  };
  const fast = await load(build);
  const ref = await import("/node_modules/esbuild-wasm/esm/browser.js");
  await ref.initialize({ wasmURL: refWasm, worker });
  const stats = fast[Symbol.for("@r1ck404/fast-esbuild-wasm:stats")];
  const log = [];
  const settle = async (p) => {
    try {
      const r = await p;
      return { res: r && r.outputFiles ? r.outputFiles.map((f) => [f.path, f.text]) : r };
    } catch (e) {
      return { err: e.message };
    }
  };
  const compare = async (what, call) => {
    const [a, b] = await Promise.all([settle(call(ref)), settle(call(fast))]);
    log.push({ what, same: JSON.stringify(a) === JSON.stringify(b), ref: JSON.stringify(a).slice(0, 200), fast: JSON.stringify(b).slice(0, 200) });
  };
  const text = async (u) => (await fetch(u)).text();
  const cjs = { loader: "js", format: "cjs", target: "esnext", platform: "neutral", define: { "import.meta.url": "import_meta.url", "import.meta": "import_meta" } };
  const vite = (loader, sourcefile) => ({ loader, target: "esnext", sourcemap: true, sourcefile, jsx: "automatic", tsconfigRaw: { compilerOptions: { useDefineForClassFields: true, jsx: "react-jsx" } } });

  const init = await settle(fast.initialize({ wasmURL: fastWasm, worker }));
  log.push({ what: "initialize()", same: init.err === undefined, fast: JSON.stringify(init) });
  for (const u of ["/node_modules/zod/v4/classic/errors.js", "/node_modules/zod/v4/classic/schemas.js", "/node_modules/rollup/dist/es/shared/node-entry.js"]) {
    const code = await text(u);
    await compare(`esm->cjs ${u}`, (m) => m.transform(code, cjs));
  }
  await compare("ts", (m) => m.transform("export const a: number = 1; enum E { A }", { loader: "ts" }));
  const tsx = "export function App({ items }: { items: string[] }) { return <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul>; }\n";
  await compare("tsx + source map", (m) => m.transform(tsx, vite("tsx", "/src/App.tsx")));
  await compare("css", (m) => m.transform(".a { color: #ff0000; & .b { margin: 0 0 0 0 } }", { loader: "css", minify: true, target: "chrome90" }));
  await compare("legal comments external", (m) => m.transform("/*! legal */ x", { legalComments: "external" }));
  await compare("warning", (m) => m.transform("if (x === NaN) y()", {}));
  await compare("syntax error", (m) => m.transform("let = ", {}));
  await compare("concurrent", (m) => Promise.all(["a", "b", "c", "d"].map((x) => m.transform(`export const ${x} = 1`, cjs))));
  await compare("invalid input", (m) => m.transform(123, {}));
  const zodPlugin = {
    name: "zod",
    setup(b) {
      const dir = (p) => p.slice(0, p.lastIndexOf("/"));
      b.onResolve({ filter: /.*/ }, (a) => (a.kind === "entry-point" ? { path: a.path, namespace: "z" } : { path: new URL(a.path, "http://x" + a.importer).pathname, namespace: "z" }));
      b.onLoad({ filter: /.*/, namespace: "z" }, async (a) => ({ contents: await text("/node_modules" + a.path), loader: "js", resolveDir: dir(a.path) }));
    },
  };
  await compare("build() zod with plugins, minified, split", (m) =>
    m.build({ entryPoints: ["/zod/v4/classic/index.js"], bundle: true, write: false, format: "esm", splitting: true, minify: true, outdir: "/out", metafile: true, plugins: [zodPlugin] }).then((r) => [r.outputFiles.map((f) => [f.path, f.hash, f.text]), r.metafile]),
  );
  const plugin = {
    name: "vfs",
    setup(b) {
      b.onResolve({ filter: /^\.\/(y|s\.css)$/ }, (a) => ({ path: a.path === "./y" ? "/y.js" : "/s.css", namespace: "vfs" }));
      b.onLoad({ filter: /\.js$/, namespace: "vfs" }, () => ({ contents: "export default 42", loader: "js" }));
      b.onLoad({ filter: /\.css$/, namespace: "vfs" }, () => ({ contents: ".a { color: red }", loader: "css" }));
    },
  };
  await compare("builds with CSS, concurrent with transforms", (m) =>
    Promise.all([
      m.build({ stdin: { contents: 'import x from "./y"; import "./s.css"; console.log(x)', resolveDir: "/" }, bundle: true, write: false, outdir: "/o", plugins: [plugin] }).then((r) => r.outputFiles.map((f) => [f.path, f.text])),
      m.transform("let b: string = 'x'", { loader: "ts" }),
      m.build({ stdin: { contents: ".a { color: red }", loader: "css" }, write: false }).then((r) => r.outputFiles.map((f) => f.text)),
    ]),
  );
  await compare("formatMessages", (m) => m.formatMessages([{ text: "x", location: { file: "a.js", line: 1, column: 0, lineText: "x" } }], { kind: "warning" }));
  await compare("analyzeMetafile", (m) => m.analyzeMetafile({ inputs: { "a.js": { bytes: 1, imports: [] } }, outputs: { "o.js": { bytes: 10, inputs: { "a.js": { bytesInOutput: 5 } }, imports: [], exports: [] } } }));
  await compare("context", async (m) => {
    const ctx = await m.context({ stdin: { contents: "export let z = 1 + 2" }, write: false, minify: true });
    const r = await ctx.rebuild();
    await ctx.dispose();
    return r;
  });
  // Deeply nested input: at a depth both handle, identical; far deeper than
  // esbuild-wasm handles in the calling thread, this package's deep mode
  // (compared with native esbuild's result)
  const arrays = (d) => "x = " + "[".repeat(d) + "]".repeat(d) + ";\n";
  const rules = (d) => "a { ".repeat(d) + "color: red" + " }".repeat(d) + "\n";
  await compare("nested arrays (2000)", (m) => m.transform(arrays(2000), {}));
  await compare("nested CSS rules (1000)", (m) => m.transform(rules(1000), { loader: "css" }));
  const deep = async (what, call, check) => {
    const r = await settle(call());
    log.push({ what, same: r.err === undefined && check(r.res), ref: "(not compared)", fast: JSON.stringify(r).slice(0, 200) });
  };
  await deep("nested arrays (40000), transform", () => fast.transform(arrays(40000), {}), (r) => r.code === expected.arrays);
  await deep("nested arrays (40000), build", () => fast.build({ stdin: { contents: arrays(40000) }, write: false }), (r) => r[0][1] === expected.arrays);
  await deep("nested CSS rules (6000), transform", () => fast.transform(rules(6000), { loader: "css", minify: true, target: "chrome100" }), (r) => r.code === expected.rules);
  return { log, fast: stats.fast, error: stats.error };
}

let failures = 0;
for (const name of names) {
  let browser;
  try {
    browser = await pw[name].launch();
  } catch (e) {
    console.log(name, "not available:", e.message.split("\n")[0]);
    continue;
  }
  // initialize() must not wait for the engine (it is created in the
  // background, or by the first call): in a fresh page, the median of 3
  // initialize() calls must stay under 5 ms (it takes about 1 ms; with
  // the engine created in it, 5 to 10 ms and more, esbuild-wasm's ~35 ms)
  for (const worker of [true, false]) {
    const times = [];
    for (let i = 0; i < 3; i++) {
      const page = await browser.newPage();
      await page.goto(base + "/blank.html");
      times.push(
        await page.evaluate(async ({ script, wasm, worker }) => {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = script;
            s.onload = res;
            s.onerror = rej;
            document.head.appendChild(s);
          });
          const t0 = performance.now();
          await self.esbuild.initialize({ wasmURL: wasm, worker });
          const t = performance.now() - t0;
          await self.esbuild.transform("let a = 1", {});
          return t;
        }, { script: "/packages/fast-esbuild-wasm/lib/browser.js", wasm: FAST_WASM, worker }),
      );
      await page.close();
    }
    const median = times.sort((a, b) => a - b)[1];
    const ok = median < 5;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} initialize() ${worker ? "worker mode" : "worker: false"}: ${median.toFixed(1)} ms (limit 5 ms)`);
  }
  // Cold start (loading lib/browser.js + initialize(), worker mode, what
  // bench/esbuild-browser.bench.mjs measures) vs esbuild-wasm's in Chromium:
  // not more than 15% slower (medians of 5 fresh pages, alternating)
  if (name === "chromium") {
    const cold = { fast: [], wasm: [] };
    for (let i = 0; i < 10; i++) {
      const which = i % 2 === 0 ? "fast" : "wasm";
      const page = await browser.newPage();
      await page.goto(base + "/blank.html");
      cold[which].push(
        await page.evaluate(async ({ script, wasm }) => {
          const t0 = performance.now();
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = script;
            s.onload = res;
            s.onerror = rej;
            document.head.appendChild(s);
          });
          await self.esbuild.initialize({ wasmURL: wasm });
          return performance.now() - t0;
        }, which === "fast" ? { script: "/packages/fast-esbuild-wasm/lib/browser.js", wasm: FAST_WASM } : { script: "/node_modules/esbuild-wasm/lib/browser.js", wasm: "/node_modules/esbuild-wasm/esbuild.wasm" }),
      );
      await page.close();
    }
    const med = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
    const ok = med(cold.fast) <= med(cold.wasm) * 1.15;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} cold start (load + initialize()): ${med(cold.fast).toFixed(1)} ms, esbuild-wasm ${med(cold.wasm).toFixed(1)} ms (limit +15%)`);
  }
  for (const build of ["/packages/fast-esbuild-wasm/lib/browser.js", "/packages/fast-esbuild-wasm/esm/browser.min.js"]) {
    for (const worker of [true, false]) {
      const page = await browser.newPage();
      page.on("pageerror", (e) => {
        failures++;
        console.log("FAIL page error", e.message);
      });
      const requests = [];
      page.on("request", (q) => requests.push(new URL(q.url()).pathname));
      await page.goto(base + "/blank.html");
      const r = await page.evaluate(`(${scenario.toString()})(${JSON.stringify({ build, fastWasm: FAST_WASM, worker, refWasm: "/node_modules/esbuild-wasm/esbuild.wasm", expected })})`);
      const label = `${name} ${build.split("/").slice(-2).join("/")} ${worker ? "worker mode" : "worker: false"}`;
      const bad = r.log.filter((x) => !x.same);
      for (const x of bad) console.log("FAIL", label, x.what, "\n  ref:  " + x.ref + "\n  fast: " + x.fast);
      failures += bad.length;
      const wasmRequests = requests.filter((p) => p.startsWith("/packages/fast-esbuild-wasm/") && p.endsWith(".wasm")).length;
      const ok = wasmRequests === 0 && r.error === 0;
      if (!ok) failures++;
      console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${r.log.length - bad.length}/${r.log.length} identical; ${r.fast} transforms answered by the shortcut, engine errors ${r.error}, wasm requests ${wasmRequests}`);
      await page.close();
    }
  }
  await browser.close();
}
server.close();
console.log(failures === 0 ? "browser: all checks passed" : `browser: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
