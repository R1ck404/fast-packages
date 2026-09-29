// Differential check in real browsers (Playwright): Chromium takes the V8
// JS-string-builtins copy path, Firefox and WebKit the encodeInto path.
// usage: node packages/fast-es-module-lexer/test/browser.mjs [chromium,firefox,webkit]
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import * as pw from "playwright-core";
import { root, listFiles, nm } from "../../../bench/corpus.mjs";
import { EXPORTS } from "./hooks.mjs";

const names = (process.argv[2] || "chromium,firefox,webkit").split(",");
const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".cjs": "text/javascript", ".html": "text/html" };
const server = createServer((req, res) => {
  const file = join(root, normalize(decodeURIComponent(req.url.split("?")[0])));
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404), res.end();
  res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const toUrl = (f) => "/" + f.slice(root.length + 1).split(String.fromCharCode(92)).join("/");
const urls = [
  ...listFiles(join(nm, "zod"), [".js", ".cjs"]),
  ...listFiles(join(nm, "lodash-es"), [".js"]).slice(0, 200),
  ...listFiles(join(nm, "@vue"), [".js", ".mjs"]),
  join(nm, "react-dom/cjs/react-dom-client.production.js"),
  join(nm, "rollup/dist/es/shared/node-entry.js"),
].map(toUrl);
const extra = [
  "", "import a from 'b'", "import('\\u0041')", "export { a as '\\x41' }; let a", " import x from'y'",
  "x = 'ħ'; import 'a'", "`${import('a')}`", "export {", "import a from", "'abc", "a = /re", "import.meta.url",
  // the original reads outside its source on these
  "export d", "import { Strin", "import 'x';export cons", "export { default } from '", "e/xport {};\n",
];
let failed = false;
for (const name of names) {
  let browser;
  try {
    browser = await pw[name].launch();
  } catch (e) {
    console.log(name, "not available:", e.message.split("\n")[0]);
    continue;
  }
  const page = await browser.newPage();
  await page.goto(base + "/bench/browser/blank.html");
  // index.mjs (what Node and direct imports load) and browser.mjs (what
  // bundlers take for browsers)
  for (const file of ["index.mjs", "browser.mjs"]) {
    const r = await page.evaluate(
      async ({ file, urls, extra, hooks }) =>
        (await import("/packages/fast-es-module-lexer/test/browser-page.mjs")).run("/packages/fast-es-module-lexer/" + file, "/node_modules/es-module-lexer/dist/lexer.js", urls, extra, hooks, 3000),
      { file, urls, extra, hooks: EXPORTS },
    );
    console.log(`${name} ${file} [${r.mode}]: checks ${r.checks}, mismatches ${r.nfails}, read outside the source ${r.outside} (checked against a fresh original)  (${r.ua.match(/(Chrome|Firefox|Version)\/[\d.]+/)?.[0]})`);
    for (const f of r.fails) console.log("  ", JSON.stringify(f));
    if (r.nfails) failed = true;
  }
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
