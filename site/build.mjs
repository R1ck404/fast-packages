// Builds the GitHub Pages site into site/dist.
//
//   node site/build.mjs           build once
//   node site/build.mjs --serve   build, then serve dist on http://localhost:4173
//   node site/build.mjs --serve-only [--port=N]   serve dist without building
//   SITE_OUT=dir node site/build.mjs ...          use another output directory
//   node site/build.mjs --pages   rebuild pages, styles, scripts and samples only (keeps dist/assets/impl)
//
// Every demo runs the original package and the fast package in the visitor's
// browser, through the same adapter file, so both sides make identical calls:
// each adapter in site/adapters is bundled twice, once with `impl` pointing at
// the original and once at the fast package.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { packages, samples, root } from "./packages.mjs";
import { loadResults, sectionHtml, speedupRange, rangeChartHtml } from "./results.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => path.join(here, ...p);
// SITE_OUT redirects the output (parallel work each gets its own copy of dist)
const dist = process.env.SITE_OUT ? path.resolve(process.env.SITE_OUT) : src("dist");

const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true });
const mkdir = (p) => fs.mkdirSync(p, { recursive: true });
const copy = (from, to) => (mkdir(path.dirname(to)), fs.copyFileSync(from, to));

const results = loadResults();
const manifest = {}; // file (relative to dist) -> { raw, gzip, brotli }

function measureFile(rel) {
  const buf = fs.readFileSync(path.join(dist, rel));
  manifest[rel] = {
    raw: buf.length,
    gzip: zlib.gzipSync(buf, { level: 9 }).length,
    // quality 11 takes a minute on a 14 MB wasm; 9 is within a few percent
    brotli: zlib.brotliCompressSync(buf, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: buf.length > 2e6 ? 9 : 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
    }).length,
  };
}

async function buildAdapters() {
  const out = path.join(dist, "assets", "impl");
  for (const p of packages) {
    const adapter = src("adapters", `${p.slug}.mjs`);
    if (!fs.existsSync(adapter)) continue;
    for (const [which, v] of Object.entries(p.variants)) {
      if (which === "minify") continue;
      await build({
        entryPoints: [adapter],
        outfile: path.join(out, `${p.slug}.${which}.js`),
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        minify: v.minify ?? p.variants.minify !== false,
        legalComments: "none",
        alias: v.alias,
        logLevel: "warning",
        define: { "process.env.NODE_ENV": '"production"' },
        // brotli's wasm loaders find their binary with new URL(name, import.meta.url)
        mainFields: ["module", "browser", "main"],
      });
      const rel = `assets/impl/${p.slug}.${which}.js`;
      measureFile(rel);
      for (const w of v.wasm ?? []) {
        const name = path.basename(w);
        copy(w, path.join(out, name));
        measureFile(`assets/impl/${name}`);
      }
    }
  }
}

async function buildPageScripts() {
  const dir = src("js", "pages");
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs"));
  await build({
    entryPoints: Object.fromEntries(entries.map((f) => [f.replace(/\.mjs$/, ""), path.join(dir, f)])),
    outdir: path.join(dist, "assets", "js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    logLevel: "warning",
  });
}

function copyStatic() {
  copy(src("css", "site.css"), path.join(dist, "assets", "site.css"));
  for (const f of fs.readdirSync(src("css", "pages"))) copy(src("css", "pages", f), path.join(dist, "assets", "pages", f));
  for (const f of fs.readdirSync(src("fonts"))) copy(src("fonts", f), path.join(dist, "assets", "fonts", f));
  for (const [name, from] of Object.entries(samples)) copy(from, path.join(dist, "samples", name));
  for (const f of fs.readdirSync(src("static"))) copy(src("static", f), path.join(dist, f));
  fs.writeFileSync(path.join(dist, ".nojekyll"), "");
}

// ---- pages ----------------------------------------------------------------

const layout = fs.readFileSync(src("layout.html"), "utf8");

function navHtml(root, current) {
  const links = packages
    .map((p) => `<a href="${root}${p.slug}/"${p.slug === current ? ' aria-current="page"' : ""}>${p.fast.replace("@r1ck404/", "")}</a>`)
    .join("");
  return `${links}<a href="${root}method/"${current === "method" ? ' aria-current="page"' : ""}>How we check</a>`;
}

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 1 : 2) + " MB";
  return (n / 1024).toFixed(n >= 100 * 1024 ? 0 : 1) + " KB";
}

function fills(html, ctx) {
  return html.replace(/\{\{([\w-]+)(?::([\w./-]+))?\}\}/g, (all, name, arg) => {
    switch (name) {
      case "root": return ctx.root;
      case "results": return sectionHtml(results[arg]);
      case "size": {
        const m = manifest[arg];
        if (!m) throw new Error(`no size for ${arg}`);
        return `${fmtBytes(m.raw)} (${fmtBytes(m.brotli)} brotli)`;
      }
      case "bytes": {
        const m = manifest[arg];
        if (!m) throw new Error(`no size for ${arg}`);
        return String(m.raw);
      }
      case "range": {
        const r = speedupRange(results[arg]);
        if (!r) throw new Error(`no range for ${arg}`);
        const f = (v) => (v >= 10 ? Math.round(v) : v.toFixed(1));
        return `${f(r.lo)}-${f(r.hi)}x`;
      }
      case "top": {
        const r = speedupRange(results[arg]);
        return r.hi >= 10 ? String(Math.round(r.hi)) : r.hi.toFixed(1);
      }
      case "pkgcards": return ctx.pkgcards;
      case "rangechart":
        return rangeChartHtml(
          results,
          packages.map((p) => ({ label: p.fast.replace("@r1ck404/", ""), href: `${ctx.root}${p.slug}/`, key: p.resultsKey })),
        );
      case "version": return ctx.version ?? "";
      case "fastversion": {
        // the version of the fast package itself (its patch number is its own)
        const name = packages.find((p) => p.slug === arg)?.fast ?? `@r1ck404/fast-${arg}`;
        const dir = name.replace("@r1ck404/", "");
        return JSON.parse(fs.readFileSync(path.join(root, "packages", dir, "package.json"), "utf8")).version;
      }
      default: throw new Error(`unknown placeholder {{${name}}} in ${ctx.file}`);
    }
  });
}

function cardsHtml(root) {
  return packages
    .map((p) => {
      return `<a class="pkg-card" href="${root}${p.slug}/">
  <span class="pkg-card-name">${p.fast.replace("@r1ck404/", "")}</span>
  <span class="pkg-card-for">replaces ${p.original} ${p.version}</span>
  <span class="pkg-card-line">${p.line}</span>
  <span class="pkg-card-x">${p.headline}</span>
</a>`;
    })
    .join("\n");
}

function renderPage(file) {
  const slug = path.basename(file, ".html");
  const raw = fs.readFileSync(file, "utf8");
  const meta = JSON.parse(/^<!--(\{[\s\S]*?\})-->/.exec(raw)?.[1] ?? "{}");
  const body = raw.replace(/^<!--\{[\s\S]*?\}-->\s*/, "");
  const home = slug === "index";
  const rootPath = home ? "" : "../";
  const script = fs.existsSync(src("js", "pages", `${slug}.mjs`))
    ? `<script type="module" src="${rootPath}assets/js/${slug}.js"></script>`
    : "";
  const pageCss = fs.existsSync(src("css", "pages", `${slug}.css`))
    ? `<link rel="stylesheet" href="${rootPath}assets/pages/${slug}.css">`
    : "";
  const pkgMeta = packages.find((p) => p.slug === slug);
  const ctx = { root: rootPath, file, pkgcards: cardsHtml(rootPath), version: pkgMeta?.version };
  const page = {
    "{{content}}": fills(body, ctx),
    "{{nav}}": navHtml(rootPath, slug),
    "{{title}}": meta.title ?? "fast-packages",
    "{{description}}": meta.description ?? "",
    "{{script}}": script,
    "{{pagecss}}": pageCss,
    "{{bodyclass}}": home ? "home" : "doc",
    "{{root}}": rootPath,
  };
  const html = layout.replace(/\{\{(?:content|nav|title|description|script|pagecss|bodyclass|root)\}\}/g, (t) => page[t]);
  const outFile = home ? path.join(dist, "index.html") : path.join(dist, slug, "index.html");
  mkdir(path.dirname(outFile));
  fs.writeFileSync(outFile, html);
}

function renderPages() {
  for (const f of fs.readdirSync(src("pages"))) if (f.endsWith(".html")) renderPage(src("pages", f));
}

// ---- main -----------------------------------------------------------------

async function main() {
  const pagesOnly = process.argv.includes("--pages") && fs.existsSync(path.join(dist, "assets", "manifest.json"));
  if (pagesOnly) {
    Object.assign(manifest, JSON.parse(fs.readFileSync(path.join(dist, "assets", "manifest.json"), "utf8")));
    rmrf(path.join(dist, "assets", "js"));
    for (const f of fs.readdirSync(dist)) if (f !== "assets") rmrf(path.join(dist, f));
  } else {
    rmrf(dist);
  }
  mkdir(dist);
  copyStatic();
  if (!pagesOnly) await buildAdapters();
  await buildPageScripts();
  fs.writeFileSync(path.join(dist, "assets", "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dist, "assets", "results.json"), JSON.stringify(results));
  renderPages();
  const files = fs.readdirSync(dist, { recursive: true }).filter((f) => fs.statSync(path.join(dist, f)).isFile());
  const total = files.reduce((n, f) => n + fs.statSync(path.join(dist, f)).size, 0);
  console.log(`site/dist: ${files.length} files, ${fmtBytes(total)}`);
}

function serve(port = Number(process.argv.find((a) => a.startsWith("--port="))?.slice(7)) || 4173) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  http
    .createServer((req, res) => {
      let p;
      try {
        p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      } catch {
        res.writeHead(400).end("bad request");
        return;
      }
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(dist, p);
      if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(port, () => console.log(`http://localhost:${port}/`));
}

if (!process.argv.includes("--serve-only")) await main();
if (process.argv.includes("--serve") || process.argv.includes("--serve-only")) serve();
