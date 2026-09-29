// Plugin API behaviour of build() / context() in @r1ck404/fast-esbuild-wasm
// (lib/browser.js, worker: false) against esbuild-wasm's browser build: each
// scenario runs with both and records everything a plugin or the caller can
// observe (callback calls with their arguments, results, errors, output
// files, metafile, the order of onStart/onEnd/onDispose, rebuild results).
// The records must be identical, and every callback must run exactly as
// often as with esbuild. (The package's initialize() validates "wasmModule"
// and ignores it: it is given an empty module.)
//
// Usage: node test/build-plugins.mjs [--filter re] [--verbose]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const FILTER = new RegExp(args.includes("--filter") ? args[args.indexOf("--filter") + 1] : ".");
const VERBOSE = args.includes("--verbose");
const STATS = Symbol.for("@r1ck404/fast-esbuild-wasm:stats");

globalThis.self ??= globalThis;
const fast = require("../lib/browser.js");
await fast.initialize({ wasmModule: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])), worker: false });
const ref = require("esbuild-wasm/lib/browser.js");
await ref.initialize({ wasmModule: new WebAssembly.Module(readFileSync(require.resolve("esbuild-wasm/esbuild.wasm"))), worker: false });

const tick = () => new Promise((r) => setTimeout(r, 0));

// A virtual file system for the scenarios
function vfsPlugin(files, log, extra = {}) {
  return {
    name: "vfs",
    setup(b) {
      b.onStart(() => {
        log.push(["start"]);
      });
      b.onEnd((result) => {
        log.push(["end", result.errors.length, result.warnings.length, (result.outputFiles || []).map((f) => f.path + ":" + f.text.length)]);
      });
      b.onDispose(() => {
        log.push(["dispose"]);
      });
      b.onResolve({ filter: /.*/ }, (a) => {
        log.push(["resolve", a.path, a.importer, a.namespace, a.resolveDir, a.kind, a.pluginData, JSON.stringify(a.with)]);
        if (extra.resolve) {
          const r = extra.resolve(a);
          if (r !== undefined) return r;
        }
        if (a.path.startsWith("ext:")) return { external: true };
        let p = a.path;
        if (p.startsWith("./") || p.startsWith("../")) {
          const dir = a.importer ? a.importer.slice(0, a.importer.lastIndexOf("/")) : "";
          const parts = (dir + "/" + p).split("/");
          const out = [];
          for (const x of parts) {
            if (x === "..") out.pop();
            else if (x !== "." && x !== "") out.push(x);
          }
          p = "/" + out.join("/");
        }
        for (const ext of ["", ".js", ".ts", ".json", ".txt"]) if (files[p + ext] !== undefined) return { path: p + ext, namespace: "v", pluginData: { from: a.path } };
        return undefined;
      });
      b.onLoad({ filter: /.*/, namespace: "v" }, (a) => {
        log.push(["load", a.path, a.namespace, a.suffix, JSON.stringify(a.pluginData), JSON.stringify(a.with)]);
        if (extra.load) {
          const r = extra.load(a);
          if (r !== undefined) return r;
        }
        const f = files[a.path];
        const loader = a.path.endsWith(".ts") ? "ts" : a.path.endsWith(".json") ? "json" : a.path.endsWith(".txt") ? "text" : "js";
        return { contents: f, loader, resolveDir: "/" };
      });
    },
  };
}

function outputs(result) {
  if (!result) return null;
  return {
    errors: result.errors,
    warnings: result.warnings,
    outputFiles: (result.outputFiles || []).map((f) => [f.path, f.hash, f.text]),
    metafile: result.metafile,
    mangleCache: result.mangleCache,
  };
}

function errorOf(e) {
  return { message: String(e && e.message), errors: e && e.errors, warnings: e && e.warnings };
}

const base = {
  "/index.js": 'import { a } from "./a"; import b from "./b.json"; import t from "./t.txt"; import ext from "ext:thing"; export default [a, b, t, ext];\n',
  "/a.js": "export const a = 1; export const unused = 2;\n",
  "/b.json": '{ "x": 1, "y": [2, 3] }\n',
  "/t.txt": "hello text\n",
};

const SCENARIOS = {
  async "build: callback order and args"(esbuild) {
    const log = [];
    const result = await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, format: "esm", plugins: [vfsPlugin(base, log)] });
    await tick();
    return { log, out: outputs(result) };
  },
  async "build: metafile + outdir + hashes"(esbuild) {
    const log = [];
    const result = await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, format: "esm", outdir: "/out", entryNames: "[name]-[hash]", metafile: true, plugins: [vfsPlugin(base, log)] });
    return { log, out: outputs(result) };
  },
  async "build: two plugins, first declines"(esbuild) {
    const log = [];
    const first = {
      name: "first",
      setup(b) {
        b.onResolve({ filter: /^\.\/a/ }, (a) => {
          log.push(["first-resolve", a.path]);
          return undefined;
        });
        b.onLoad({ filter: /a\.js$/, namespace: "v" }, (a) => {
          log.push(["first-load", a.path]);
          return { contents: "export const a = 'from first';", loader: "js" };
        });
      },
    };
    const result = await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, format: "cjs", plugins: [first, vfsPlugin(base, log)] });
    return { log, out: outputs(result) };
  },
  async "build: pluginData, suffix, sideEffects, custom namespace"(esbuild) {
    const log = [];
    const files = {
      "/index.js": 'import "./side?q=1"; import { f } from "./lib#frag"; console.log(f());\n',
      "/side.js": "globalThis.sideEffect = 1;\n",
      "/lib.js": "export function f() { return 1 }\n",
    };
    const plugin = vfsPlugin(files, log, {
      resolve(a) {
        const m = /^\.\/(\w+)([?#].*)$/.exec(a.path);
        if (m) return { path: "/" + m[1] + ".js", namespace: "v", suffix: m[2], sideEffects: m[1] !== "side", pluginData: { n: m[1] } };
      },
    });
    const result = await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, format: "esm", plugins: [plugin] });
    return { log, out: outputs(result) };
  },
  async "build: build.resolve() from a plugin"(esbuild) {
    const log = [];
    const outer = {
      name: "outer",
      setup(b) {
        b.onResolve({ filter: /^virtual:/ }, async (a) => {
          const r = await b.resolve("./a", { kind: "import-statement", importer: "/index.js", namespace: "v", resolveDir: "/", pluginData: 7 });
          log.push(["outer", a.path, r.path, r.namespace, r.external, r.sideEffects, r.suffix, JSON.stringify(r.pluginData), r.errors.length]);
          return { path: r.path, namespace: r.namespace };
        });
      },
    };
    const files = { ...base, "/index.js": 'import { a } from "virtual:a"; console.log(a);\n' };
    const result = await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, format: "esm", plugins: [outer, vfsPlugin(files, log)] });
    return { log, out: outputs(result) };
  },
  async "build: onLoad throws (reported, no callback twice)"(esbuild) {
    const log = [];
    const plugin = vfsPlugin(base, log, {
      load(a) {
        if (a.path === "/a.js") throw new Error("boom in onLoad");
      },
    });
    try {
      await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, plugins: [plugin] });
      return { log, ok: true };
    } catch (e) {
      return { log, error: errorOf(e) };
    }
  },
  async "build: onResolve returns warnings"(esbuild) {
    const log = [];
    const plugin = vfsPlugin(base, log, {
      resolve(a) {
        if (a.path === "./a") return { path: "/a.js", namespace: "v", warnings: [{ text: "careful" }] };
      },
    });
    const result = await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, plugins: [plugin] });
    return { log, out: outputs(result) };
  },
  async "build: unresolvable import"(esbuild) {
    const log = [];
    const files = { "/index.js": 'import x from "./missing"; console.log(x);\n' };
    try {
      await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, plugins: [vfsPlugin(files, log)] });
      return { log, ok: true };
    } catch (e) {
      return { log, error: errorOf(e) };
    }
  },
  async "build: loaders"(esbuild) {
    const log = [];
    const files = {
      "/index.js": 'import a from "./a.bin"; import b from "./b.b64"; import c from "./c.svg"; import d from "./d.empty"; import e from "./e.data"; console.log(a, b, c, d, e);\n',
      "/a.bin": new Uint8Array([0, 1, 2, 250, 255]),
      "/b.b64": "base64 me\n",
      "/c.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      "/d.empty": "ignored",
      "/e.data": "some data",
    };
    const plugin = {
      name: "l",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (a.kind === "entry-point" ? { path: a.path, namespace: "v" } : { path: a.path.slice(1), namespace: "v" }));
        b.onLoad({ filter: /.*/, namespace: "v" }, (a) => {
          log.push(["load", a.path]);
          const ext = a.path.slice(a.path.lastIndexOf("."));
          const loader = { ".js": "js", ".bin": "binary", ".b64": "base64", ".svg": "dataurl", ".empty": "empty", ".data": "text" }[ext];
          return { contents: files[a.path], loader };
        });
      },
    };
    const result = await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, format: "esm", plugins: [plugin] });
    return { log, out: outputs(result) };
  },
  async "build: file and copy loaders"(esbuild) {
    const log = [];
    const files = {
      "/index.js": 'import a from "./logo.png"; import "./style.txt"; console.log(a);\n',
      "/logo.png": new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
      "/style.txt": "copied file\n",
    };
    const plugin = {
      name: "l",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (a.kind === "entry-point" ? { path: a.path, namespace: "v" } : { path: a.path.slice(1), namespace: "v" }));
        b.onLoad({ filter: /.*/, namespace: "v" }, (a) => {
          log.push(["load", a.path]);
          const loader = a.path.endsWith(".png") ? "file" : a.path.endsWith(".txt") ? "copy" : "js";
          return { contents: files[a.path], loader };
        });
      },
    };
    const result = await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, outdir: "/out", assetNames: "assets/[name]-[hash]", metafile: true, format: "esm", plugins: [plugin] });
    return { log, out: outputs(result) };
  },
  async "build: CSS imported from JS (goes to Go)"(esbuild) {
    const log = [];
    const files = {
      "/index.js": 'import "./style.css"; import url from "./logo.svg"; console.log(url);\n',
      "/style.css": '@import "./base.css";\n.btn { color: red; background: url(./logo.svg) }\n',
      "/base.css": "body { margin: 0 }\n",
      "/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    };
    const plugin = {
      name: "l",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => {
          log.push(["resolve", a.path, a.kind]);
          return a.kind === "entry-point" ? { path: a.path, namespace: "v" } : { path: a.path.slice(1), namespace: "v" };
        });
        b.onLoad({ filter: /.*/, namespace: "v" }, (a) => {
          log.push(["load", a.path]);
          const loader = a.path.endsWith(".css") ? "css" : a.path.endsWith(".svg") ? "file" : "js";
          return { contents: files[a.path], loader };
        });
      },
    };
    const result = await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, outdir: "/out", metafile: true, sourcemap: true, plugins: [plugin] });
    return { log, out: outputs(result) };
  },
  async "build: CSS entry point (goes to Go)"(esbuild) {
    const log = [];
    const result = await esbuild.build({ stdin: { contents: ".a { color: rgb(255 0 0) }", loader: "css" }, bundle: true, write: false, minify: true, target: "chrome60", plugins: [vfsPlugin(base, log)] });
    return { log, out: outputs(result) };
  },
  async "build: stdin with plugins"(esbuild) {
    const log = [];
    const result = await esbuild.build({ stdin: { contents: 'import { a } from "./a"; console.log(a)', resolveDir: "/", sourcefile: "in.js" }, bundle: true, write: false, plugins: [vfsPlugin(base, log)] });
    return { log, out: outputs(result) };
  },
  async "build: splitting with dynamic import"(esbuild) {
    const log = [];
    const files = {
      "/a.js": 'import { shared } from "./shared"; export const a = () => import("./lazy").then((m) => m.lazy + shared);\n',
      "/b.js": 'import { shared } from "./shared"; export const b = shared * 2;\n',
      "/shared.js": "export const shared = 21;\n",
      "/lazy.js": 'import { shared } from "./shared"; export const lazy = shared;\n',
    };
    const result = await esbuild.build({ entryPoints: ["/a.js", "/b.js"], bundle: true, write: false, format: "esm", splitting: true, outdir: "/out", metafile: true, plugins: [vfsPlugin(files, log)] });
    return { log, out: outputs(result) };
  },
  async "build: entries sharing modules without splitting"(esbuild) {
    const log = [];
    const files = {
      "/a.js": 'import { shared, S } from "./shared"; import cjs from "./cjs"; export const a = shared + cjs.x + new S().v;\n',
      "/b.js": 'import * as ns from "./shared"; const cjs = require("./cjs"); export default () => [ns, cjs];\n',
      "/c.js": 'export { shared as default } from "./shared"; import("./lazy").then(console.log);\n',
      "/shared.js": "export const shared = 21; export class S { v = 1 }\n",
      "/cjs.js": "exports.x = 1; module.exports.y = 2;\n",
      "/lazy.js": 'export * from "./shared";\n',
    };
    const results = [];
    for (const format of ["esm", "cjs", "iife"]) {
      const result = await esbuild.build({ entryPoints: ["/a.js", "/b.js", "/c.js"], bundle: true, write: false, format, outdir: "/out", metafile: true, plugins: [vfsPlugin(files, log)] });
      results.push(outputs(result));
      await tick();
    }
    return { log, results };
  },
  async "context: rebuild twice, dispose"(esbuild) {
    const log = [];
    const files = { ...base };
    const ctx = await esbuild.context({ entryPoints: ["/index.js"], bundle: true, write: false, format: "esm", plugins: [vfsPlugin(files, log)] });
    log.push(["ctx created"]);
    const r1 = await ctx.rebuild();
    files["/a.js"] = "export const a = 'changed';\n";
    const r2 = await ctx.rebuild();
    await ctx.dispose();
    await tick();
    await tick();
    return { log, r1: outputs(r1), r2: outputs(r2) };
  },
  async "context: concurrent rebuilds"(esbuild) {
    const log = [];
    const ctx = await esbuild.context({ entryPoints: ["/index.js"], bundle: true, write: false, plugins: [vfsPlugin(base, log)] });
    const [r1, r2] = await Promise.all([ctx.rebuild(), ctx.rebuild()]);
    await ctx.dispose();
    await tick();
    return { log, r1: outputs(r1), r2: outputs(r2) };
  },
  async "context: cancel during a rebuild, then rebuild"(esbuild) {
    const log = [];
    let release = null;
    const gate = { load: (a) => (a.path === "/a.js" && release === null ? new Promise((r) => (release = () => r(undefined))).then(() => ({ contents: base["/a.js"], loader: "js" })) : undefined) };
    const ctx = await esbuild.context({ entryPoints: ["/index.js"], bundle: true, write: false, plugins: [vfsPlugin(base, log, gate)] });
    const first = ctx.rebuild().then(outputs, errorOf);
    while (release === null) await tick();
    const canceled = ctx.cancel();
    await tick();
    release();
    await canceled;
    const r1 = await first;
    log.push(["canceled"]);
    const r2 = await ctx.rebuild().then(outputs, errorOf);
    await ctx.dispose();
    await tick();
    return { log, r1, r2 };
  },
  async "context: rebuild then error then fixed"(esbuild) {
    const log = [];
    const files = { ...base };
    const ctx = await esbuild.context({ entryPoints: ["/index.js"], bundle: true, write: false, plugins: [vfsPlugin(files, log)] });
    const r1 = await ctx.rebuild();
    files["/a.js"] = "export const a = ;\n";
    let r2;
    try {
      r2 = await ctx.rebuild();
    } catch (e) {
      r2 = errorOf(e);
    }
    files["/a.js"] = "export const a = 3;\n";
    const r3 = await ctx.rebuild();
    await ctx.dispose();
    await tick();
    return { log, r1: outputs(r1), r2: r2.errors ? r2 : outputs(r2), r3: outputs(r3) };
  },
  async "context: resolve() before rebuild"(esbuild) {
    const log = [];
    let pluginBuild;
    const grab = {
      name: "grab",
      setup(b) {
        pluginBuild = b;
      },
    };
    const ctx = await esbuild.context({ entryPoints: ["/index.js"], bundle: true, write: false, plugins: [grab, vfsPlugin(base, log)] });
    const r = await pluginBuild.resolve("./a", { kind: "import-statement", importer: "/index.js", namespace: "v", resolveDir: "/" });
    log.push(["resolved", r.path, r.namespace, r.errors.length]);
    await ctx.dispose();
    await tick();
    return { log };
  },
  async "build: resolve() after the build ended"(esbuild) {
    const log = [];
    let pluginBuild;
    const grab = {
      name: "grab",
      setup(b) {
        pluginBuild = b;
      },
    };
    await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, plugins: [grab, vfsPlugin(base, log)] });
    // (onDispose callbacks run in a timeout)
    await tick();
    try {
      await pluginBuild.resolve("./a", { kind: "import-statement", importer: "/index.js", namespace: "v", resolveDir: "/" });
      log.push(["resolved"]);
    } catch (e) {
      log.push(["resolve failed", e.message]);
    }
    return { log };
  },
  async "build: inject + define + banner"(esbuild) {
    const log = [];
    const files = { ...base, "/inject.js": "export const injected = 5; export function helper() { return injected }\n", "/index.js": "console.log(helper(), DEFINED, process.env.NODE_ENV);\n" };
    const result = await esbuild.build({
      entryPoints: ["/index.js"],
      bundle: true,
      write: false,
      inject: ["/inject.js"],
      define: { DEFINED: '{"k":[1,2]}' },
      banner: { js: "/* banner */" },
      footer: { js: "/* footer */" },
      plugins: [vfsPlugin(files, log)],
    });
    return { log, out: outputs(result) };
  },
  async "build: mangleCache"(esbuild) {
    const log = [];
    const files = { "/index.js": "export const o = { foo_: 1, bar_: 2 }; console.log(o.foo_ + o.bar_);\n" };
    const result = await esbuild.build({ entryPoints: ["/index.js"], bundle: true, write: false, mangleProps: /_$/, mangleCache: { bar_: "x" }, plugins: [vfsPlugin(files, log)] });
    return { log, out: outputs(result) };
  },
};

let ok = 0;
let bad = 0;
for (const [name, run] of Object.entries(SCENARIOS)) {
  if (!FILTER.test(name)) continue;
  let a, b;
  try {
    a = await run(ref);
  } catch (e) {
    a = { thrown: errorOf(e) };
  }
  try {
    b = await run(fast);
  } catch (e) {
    b = { thrown: errorOf(e) };
  }
  // (onDispose callbacks run in a setTimeout after a build: let both sides'
  // run before the records are compared)
  for (let i = 0; i < 3; i++) await tick();
  const ja = JSON.stringify(a),
    jb = JSON.stringify(b);
  const how = "fast";
  if (ja === jb) {
    ok++;
    console.log(`ok   ${name} [${how}]`);
  } else {
    bad++;
    console.log(`DIFF ${name} [${how}]`);
    let i = 0;
    while (i < ja.length && ja[i] === jb[i]) i++;
    console.log("  ref:  " + ja.slice(Math.max(0, i - 200), i + 300));
    console.log("  fast: " + jb.slice(Math.max(0, i - 200), i + 300));
    if (VERBOSE) console.log(ja + "\n" + jb);
  }
}
console.log(`\nbuild-plugins: ${ok} same, ${bad} different`);
fast.stop();
ref.stop();
process.exit(bad > 0 ? 1 : 0);
