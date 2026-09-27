// Independent browser check (headless Chromium): every package's browser
// entry point, original vs fast, on the same inputs. Results are hashed in the
// page and compared here.
// usage: node verify/verify-browser.mjs [nFiles] [prefix]
//   prefix: prepended to packages/<name>/ in the URLs (default "")
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { chromium } from "playwright-core";
import { root, allFiles, sample, Tally } from "./corpus.mjs";

const N = Number(process.argv[2] || 150);
const prefix = process.argv[3] || "";
const T = new Tally("browser");
const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".cjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
const server = createServer((req, res) => {
  const file = join(root, normalize(decodeURIComponent(req.url.split("?")[0])));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404), res.end();
  res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const nm = join(root, "node_modules");
const toUrl = (f) => "/" + f.slice(root.length + 1).split("\\").join("/");
const jsFiles = sample(allFiles((n) => /\.(m|c)?js$/.test(n)).filter((f) => f.startsWith(nm)), N, 2 << 20).map(toUrl);
const anyFiles = sample(allFiles().filter((f) => f.startsWith(nm)), N, 2 << 20).map(toUrl);
const tgz = existsSync(join(root, "corpus")) ? readdirSync(join(root, "corpus")).filter((f) => f.endsWith(".tgz")).map((f) => "/corpus/" + f) : [];

const browser = await chromium.launch();
async function inPage(fn, arg) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => process.stderr.write("[page] " + e.message + "\n"));
  await page.goto(base + "/bench/browser/blank.html");
  await page.evaluate(() => {
    self.H = async (s) => {
      const b = typeof s === "string" ? new TextEncoder().encode(s) : s;
      const d = new Uint8Array(await crypto.subtle.digest("SHA-256", b));
      return Array.from(d.slice(0, 12), (x) => x.toString(16).padStart(2, "0")).join("");
    };
    self.E = (e) => (e && typeof e === "object" ? `${e.constructor?.name}:${e.message}:${e.pos ?? ""}:${e.idx ?? ""}` : "throw:" + String(e));
  });
  const r = await page.evaluate(fn, arg);
  await page.close();
  return r;
}
function compare(what, a, b, labels) {
  if (a.length !== b.length) return T.ok(false, `${what}: length ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) T.ok(a[i] === b[i], `${what}: ${labels[i]} orig=${a[i]} fast=${b[i]}`);
}

// ---- pako
const pakoFn = async ({ lib, files, tgz }) => {
  const m = await import(lib);
  const pako = m.default || m;
  const out = [];
  const run = async (f) => {
    try {
      const v = f();
      return typeof v === "string" ? "s" + (await H(v)) : "b" + (await H(v));
    } catch (e) {
      return E(e);
    }
  };
  for (const u of files) {
    const data = new Uint8Array(await (await fetch(u)).arrayBuffer());
    out.push(await run(() => pako.deflateRaw(data, { level: 1 })));
    const g = pako.gzip(data);
    out.push(await run(() => g));
    out.push(await run(() => pako.ungzip(g)));
    out.push(await run(() => pako.inflate(pako.deflate(data, { level: 9 }), { to: "string" })));
    const d = new pako.Deflate({ level: 1, raw: true });
    for (let i = 0; i < data.length; i += 7000) d.push(data.subarray(i, i + 7000), i + 7000 >= data.length);
    if (!data.length) d.push(data, true);
    out.push(await run(() => d.result));
  }
  for (const u of tgz) {
    const data = new Uint8Array(await (await fetch(u)).arrayBuffer());
    out.push(await run(() => pako.ungzip(data)));
  }
  return out;
};
{
  const labels = anyFiles.flatMap((f) => [1, 2, 3, 4, 5].map((k) => f + "#" + k)).concat(tgz);
  const a = await inPage(pakoFn, { lib: "/node_modules/pako/dist/pako.esm.mjs", files: anyFiles, tgz });
  const b = await inPage(pakoFn, { lib: `/${prefix}packages/fast-pako/index.mjs`, files: anyFiles, tgz });
  compare("pako", a, b, labels);
}

// ---- acorn
const acornFn = async ({ lib, files }) => {
  const acorn = await import(lib);
  const out = [];
  for (const u of files) {
    const src = await (await fetch(u)).text();
    for (const o of [{ sourceType: "module" }, { sourceType: "script", locations: true }, { sourceType: "module", locations: true, ranges: true }]) {
      try {
        out.push(await H(JSON.stringify(acorn.parse(src, { ecmaVersion: "latest", ...o }), (k, v) => (typeof v === "bigint" ? v + "n" : v instanceof RegExp ? String(v) : v))));
      } catch (e) {
        out.push(E(e));
      }
    }
  }
  return out;
};
{
  const labels = jsFiles.flatMap((f) => [f + "#module", f + "#script+loc", f + "#module+loc+ranges"]);
  const a = await inPage(acornFn, { lib: "/node_modules/acorn/dist/acorn.mjs", files: jsFiles });
  const b = await inPage(acornFn, { lib: `/${prefix}packages/fast-acorn/index.mjs`, files: jsFiles });
  compare("acorn", a, b, labels);
}

// ---- es-module-lexer
const emlFn = async ({ lib, files }) => {
  const m = await import(lib);
  await m.init;
  const out = [];
  for (const u of files) {
    const src = await (await fetch(u)).text();
    for (const s of [src, "/*\u00e9*/" + src, src.slice(0, src.length >> 1)]) {
      try {
        out.push(await H(JSON.stringify(m.parse(s), (k, v) => (v === undefined ? "\0u" : v))));
      } catch (e) {
        out.push(E(e));
      }
    }
  }
  return out;
};
{
  const labels = jsFiles.flatMap((f) => [f, f + "#utf16", f + "#half"]);
  const a = await inPage(emlFn, { lib: "/node_modules/es-module-lexer/dist/lexer.js", files: jsFiles });
  const b = await inPage(emlFn, { lib: `/${prefix}packages/fast-es-module-lexer/index.mjs`, files: jsFiles });
  compare("es-module-lexer", a, b, labels);
}

// ---- brotli-wasm
const brFn = async ({ lib, files }) => {
  const B = await (await import(lib)).default;
  const out = [];
  for (const u of files) {
    const data = new Uint8Array(await (await fetch(u)).arrayBuffer());
    try {
      const c = data.length < 100000 ? B.compress(data) : B.compress(data, { quality: 5 });
      out.push(await H(c));
      out.push(await H(B.decompress(c)));
    } catch (e) {
      out.push(E(e), "-");
    }
  }
  return out;
};
{
  const files = anyFiles.slice(0, 80);
  const labels = files.flatMap((f) => [f + "#c", f + "#d"]);
  const a = await inPage(brFn, { lib: "/node_modules/brotli-wasm/index.web.js", files });
  const b = await inPage(brFn, { lib: `/${prefix}packages/fast-brotli-wasm/index.mjs`, files });
  compare("brotli", a, b, labels);
}

// ---- esbuild-wasm (browser build, worker mode, like Nodepod)
const esFn = async ({ script, wasm, files }) => {
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = script;
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  await self.esbuild.initialize({ wasmURL: wasm });
  const define = { "import.meta.url": "import_meta.url", "import.meta.dirname": "import_meta.dirname", "import.meta.filename": "import_meta.filename", "import.meta": "import_meta" };
  const out = [];
  const jobs = files.map(async (u, i) => {
    const src = await (await fetch(u)).text();
    const r = [];
    for (const o of [{ loader: "js", format: "cjs", target: "esnext", platform: "neutral", define }, { loader: "js", format: "esm", sourcemap: true, sourcefile: u }]) {
      try {
        const res = await self.esbuild.transform(src, o);
        r.push(await H(JSON.stringify(res)));
      } catch (e) {
        r.push("ERR:" + e.message);
      }
    }
    out[i] = r;
  });
  await Promise.all(jobs);
  return out.flat();
};
{
  const files = jsFiles.slice(0, 100);
  const labels = files.flatMap((f) => [f + "#cjs", f + "#esm+map"]);
  const a = await inPage(esFn, { script: "/node_modules/esbuild-wasm/lib/browser.js", wasm: "/node_modules/esbuild-wasm/esbuild.wasm", files });
  const b = await inPage(esFn, { script: `/${prefix}packages/fast-esbuild-wasm/lib/browser.js`, wasm: `/${prefix}packages/fast-esbuild-wasm/esbuild.wasm`, files });
  compare("esbuild", a, b, labels);
}

await browser.close();
server.close();
process.exit(T.report() ? 1 : 0);
