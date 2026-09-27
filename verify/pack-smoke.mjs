// Packs every package (npm pack), installs the tarballs into a scratch
// project under the ORIGINAL names (the way they are meant to be used:
// "pako": "npm:@r1ck404/fast-pako@..."), then checks from there, against the
// originals in this repo's node_modules:
//   * Node ESM and CommonJS entry points, results identical
//   * a browser bundle (esbuild, platform=browser) of all six resolves and
//     builds (browser fields / export conditions, no Node builtins)
// With --registry the published versions are installed from npm instead.
// usage: node verify/pack-smoke.mjs [--registry]
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { root } from "./corpus.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// (npm is a .cmd on Windows: needs a shell; node does not)
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", shell: cmd === npm && process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
const work = join(tmpdir(), "fast-pack-smoke");
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "tgz"), { recursive: true });

const pkgs = ["pako", "acorn", "acorn-jsx", "esbuild-wasm", "es-module-lexer", "brotli-wasm"];
// packages/fast-<name> -> r1ck404-fast-<name>-<version>.tgz (or the published
// @r1ck404/fast-<name>@<version>), installed as <name>
const fromRegistry = process.argv.includes("--registry");
const deps = {};
for (const p of pkgs) {
  const dir = join(root, "packages", "fast-" + p);
  const { version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (fromRegistry) {
    deps[p] = `npm:@r1ck404/fast-${p}@${version}`;
    continue;
  }
  run(npm, ["pack", "--silent", "--pack-destination", join(work, "tgz")], dir);
  deps[p] = `file:./tgz/r1ck404-fast-${p}-${version}.tgz`;
}
console.log(fromRegistry ? "from npm: " + Object.values(deps).join(" ") : "packed: " + readdirSync(join(work, "tgz")).join(" "));
writeFileSync(join(work, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module", dependencies: deps }, null, 2));
run(npm, ["install", "--silent", "--no-audit", "--no-fund"], work);

const orig = (p) => pathToFileURL(join(root, "node_modules", p)).href;
writeFileSync(
  join(work, "check.mjs"),
  `
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let checks = 0, fails = 0;
const ok = (c, what) => { checks++; if (!c) { fails++; console.log("FAIL", what); } };
const eq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const data = new TextEncoder().encode("hello hello hello world ".repeat(2000));

// pako
import pako from "pako";
const P = (await import(${JSON.stringify(orig("pako/dist/pako.esm.mjs"))})).default;
ok(eq(pako.gzip(data), P.gzip(data)), "pako gzip");
ok(eq(pako.deflateRaw(data, { level: 1 }), P.deflateRaw(data, { level: 1 })), "pako deflateRaw");
ok(eq(pako.ungzip(P.gzip(data)), data), "pako ungzip");
ok(eq(require("pako").inflate(P.deflate(data)), data), "pako require()");

// acorn + acorn-jsx
import * as acorn from "acorn";
import jsx from "acorn-jsx";
const A = await import(${JSON.stringify(orig("acorn/dist/acorn.mjs"))});
const J = require(${JSON.stringify(join(root, "node_modules/acorn-jsx/index.js"))});
const src = "import x from 'y'; export const f = (a) => <div className={a}>hi &amp; bye</div>;";
const o = { ecmaVersion: "latest", sourceType: "module", locations: true };
ok(JSON.stringify(acorn.Parser.extend(jsx()).parse(src, o)) === JSON.stringify(A.Parser.extend(J()).parse(src, o)), "acorn-jsx parse");
ok(JSON.stringify(acorn.parse("let a = b?.c ?? 1", o)) === JSON.stringify(A.parse("let a = b?.c ?? 1", o)), "acorn parse");
ok(require("acorn").version === "8.18.0" && typeof require("acorn-jsx") === "function", "acorn/acorn-jsx require()");
let e1, e2;
try { acorn.parse("let let = 1", o); } catch (e) { e1 = e.message + e.pos; }
try { A.parse("let let = 1", o); } catch (e) { e2 = e.message + e.pos; }
ok(e1 && e1 === e2, "acorn error");

// es-module-lexer
import { init, parse } from "es-module-lexer";
const L = await import(${JSON.stringify(orig("es-module-lexer/dist/lexer.js"))});
await init; await L.init;
const m = "import a from 'b'; export { a as c }; import('d'); import.meta.url";
ok(JSON.stringify(parse(m)) === JSON.stringify(L.parse(m)), "es-module-lexer parse");
ok(Object.keys(await import("es-module-lexer")).sort().join() === "ImportType,init,initSync,parse", "es-module-lexer exports");

// brotli-wasm
const B = require("brotli-wasm");
const Borig = require(${JSON.stringify(join(root, "node_modules/brotli-wasm/index.node.js"))});
ok(eq(B.compress(data), Borig.compress(data)), "brotli compress (require)");
const Bm = await (await import("brotli-wasm")).default;
ok(eq(Bm.decompress(Borig.compress(data, { quality: 5 })), data), "brotli decompress (import)");

// esbuild-wasm: Node API unchanged; node.mjs = fast in-thread API
const E = require("esbuild-wasm");
const r1 = E.transformSync("export const a: number = 1", { loader: "ts", format: "cjs" });
const Ef = await import("esbuild-wasm/node.mjs");
await Ef.initialize();
const r2 = await Ef.transform("export const a: number = 1", { loader: "ts", format: "cjs" });
ok(r1.code === r2.code, "esbuild transform (Node API vs node.mjs)");
ok(Ef.default[Symbol.for("@r1ck404/fast-esbuild-wasm:stats")].fast === 1, "esbuild fast path used");
await Ef.stop?.();

console.log(\`[pack-smoke] checks: \${checks}  failures: \${fails}\`);
process.exit(fails ? 1 : 0);
`,
);
const out = run(process.execPath, ["check.mjs"], work);
process.stdout.write(out);

// browser bundle of all six
writeFileSync(
  join(work, "browser.mjs"),
  `import pako from "pako";
import * as acorn from "acorn";
import jsx from "acorn-jsx";
import { init, parse } from "es-module-lexer";
import brotli from "brotli-wasm";
import * as esbuild from "esbuild-wasm";
export { pako, acorn, jsx, init, parse, brotli, esbuild };
`,
);
const { buildSync } = await import(pathToFileURL(join(root, "node_modules/esbuild/lib/main.js")).href);
const b = buildSync({ entryPoints: [join(work, "browser.mjs")], bundle: true, platform: "browser", format: "esm", write: false, logLevel: "silent", metafile: true, absWorkingDir: work });
const inputs = Object.keys(b.metafile.inputs);
const used = (name) => inputs.some((i) => i.includes(`node_modules/${name}/`));
const expect = { "pako/index.mjs": true, "acorn/index.mjs": true, "acorn-jsx/index.js": true, "es-module-lexer/index.mjs": true, "brotli-wasm/index.mjs": true, "esbuild-wasm/lib/browser.js": true };
let bad = 0;
for (const f of Object.keys(expect)) if (!inputs.some((i) => i.endsWith("node_modules/" + f))) (bad++, console.log("browser bundle: missing", f));
const nodeOnly = inputs.filter((i) => /lib\/main\.js|index\.node\.|node:/.test(i));
if (nodeOnly.length) (bad++, console.log("browser bundle pulled in Node entries:", nodeOnly));
console.log(`[browser bundle] ${(b.outputFiles[0].text.length / 1024) | 0} KB, ${inputs.length} inputs, errors ${b.errors.length}, problems ${bad}`);
rmSync(work, { recursive: true, force: true });
process.exit(bad || b.errors.length ? 1 : 0);
