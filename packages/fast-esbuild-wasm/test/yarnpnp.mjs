// Yarn Plug'n'Play vs the original packages.
//
// 1. The Yarn PnP specification's test expectations (yarnpnp-expectations.json,
//    esbuild's internal/resolver/testExpectations.json), run like esbuild's
//    TestYarnPnP does, against the port's resolveToUnqualified.
// 2. Projects on the real file system with a PnP manifest (.pnp.data.json,
//    and .pnp.cjs in Yarn's formats: a string in a variable with line
//    continuations, a string literal, an object literal, a JSON syntax
//    error inside the string) and packages inside ".zip" archives (stored
//    and deflated entries, directory entries, Yarn's "__virtual__" paths,
//    data descriptors, and broken archives: a bad CRC-32, an unsupported
//    compression method, truncated and corrupt deflate streams). Builds
//    with lib/main.js are compared with native esbuild 0.28.2 (output files,
//    metafiles, errors and warnings), and the CLI (bin/esbuild vs native
//    esbuild's binary) at the "debug" and "verbose" log levels (the
//    resolver's debug logs, which include the Yarn PnP notes).
//
// usage: node test/yarnpnp.mjs
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

let ok = 0;
let bad = 0;
function check(cond, what, detail) {
  if (cond) ok++;
  else {
    bad++;
    console.log("FAIL " + what + (detail !== undefined ? "\n  " + String(detail).slice(0, 3000) : ""));
  }
}

// ---------------------------------------------------------------------------
// 1. The specification's expectations

{
  const { Resolver, DebugMeta } = await import("../src/resolver.mjs");
  const { compileYarnPnPData, pnpSuccess, pnpSkipped } = await import("../src/yarnpnp.mjs");
  const { parseJSON, JSONOptions } = await import("../src/json_parser.mjs");
  const { Source, Path, PrettyPaths, newDeferLog, DeferLogAll } = await import("../src/logger.mjs");
  const { mockRel } = await import("../src/bundler.mjs");
  const { goPathJoin } = await import("../src/package_json.mjs");

  const expectations = JSON.parse(readFileSync(join(here, "yarnpnp-expectations.json"), "utf8"));
  let n = 0;
  for (let i = 0; i < expectations.length; i++) {
    const expectation = expectations[i];
    const path = `testExpectations[${i}].manifest`;
    const source = new Source(new PrettyPaths(path, path), "", JSON.stringify(expectation.manifest), new Path(path));
    const tempLog = newDeferLog(DeferLogAll, null);
    const [expr, parsed] = parseJSON(tempLog, source, new JSONOptions());
    check(parsed && tempLog.done().length === 0, "re-parse " + path);
    const manifest = compileYarnPnPData(path, "/path/to/project/", expr, source);

    for (const current of expectation.tests) {
      // (a resolverQuery on fs.MockFS(nil, fs.MockUnix, "/"))
      const r = Object.create(Resolver.prototype);
      r.fs = { rel: mockRel };
      r.debugLogs = null;
      r.debugMeta = new DebugMeta();
      const result = r.resolveToUnqualified(current.imported, current.importer, manifest);

      let observed;
      if (result.status === pnpSuccess) observed = goPathJoin(result.pkgDirPath, result.pkgSubpath);
      else if (result.status === pnpSkipped) observed = current.imported;
      else observed = "error!";

      let expected = current.expected;
      if (current.it === "shouldn't go through PnP when trying to resolve dependencies from packages covered by ignorePatternData") {
        expected = current.imported;
      } else if (observed !== "error!" && !observed.endsWith("/")) {
        observed += "/";
      }
      check(observed === expected, "expectation: " + current.it, "observed " + observed + ", expected " + expected);
      n++;
    }
  }
  console.log(`yarnpnp: ${n} specification tests`);
}

// ---------------------------------------------------------------------------
// 2. Projects on the real file system

// A ".zip" archive. Entries: { name, data, method (0 or 8), dir, crc (a wrong
// CRC-32), raw (the compressed bytes as is), descriptor (a data descriptor),
// creator/attrs }
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = e.data === undefined ? Buffer.alloc(0) : Buffer.from(e.data);
    const method = e.method === undefined ? 8 : e.method;
    const comp = e.raw !== undefined ? Buffer.from(e.raw) : method === 8 ? deflateRawSync(data) : data;
    const crc = e.crc !== undefined ? e.crc : crc32(data);
    const flags = 0x800 | (e.descriptor ? 0x8 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(e.descriptor ? 0 : crc, 14);
    local.writeUInt32LE(e.descriptor ? 0 : comp.length, 18);
    local.writeUInt32LE(e.descriptor ? 0 : data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const parts = [local, name, comp];
    if (e.descriptor) {
      const d = Buffer.alloc(16);
      d.writeUInt32LE(0x08074b50, 0);
      d.writeUInt32LE(e.descriptorCRC !== undefined ? e.descriptorCRC : crc, 4);
      d.writeUInt32LE(comp.length, 8);
      d.writeUInt32LE(data.length, 12);
      parts.push(d);
    }
    const localBuf = Buffer.concat(parts);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(((e.creator === undefined ? 3 : e.creator) << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.usize !== undefined ? e.usize : data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    const attrs = e.attrs !== undefined ? e.attrs : e.dir ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0;
    central.writeUInt32LE(attrs, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    locals.push(localBuf);
    offset += localBuf.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function write(root, rel, contents) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

// The manifest
const pkg = (location, deps) => ({ packageLocation: location, packageDependencies: deps, linkType: "HARD" });
const rootDeps = [
  ["left-pad", "npm:1.0.0"],
  ["withpeer", "virtual:abc#npm:1.0.0"],
  ["aliased", ["left-pad", "npm:1.0.0"]],
  ["tsconfig-pkg", "npm:1.0.0"],
  ["broken", "npm:1.0.0"],
  ["bzip", "npm:1.0.0"],
  ["trunc", "npm:1.0.0"],
  ["corrupt", "npm:1.0.0"],
  ["described", "npm:1.0.0"],
  ["exports-pkg", "npm:1.0.0"],
  ["msdos", "npm:1.0.0"],
];
const manifest = {
  __info: ["This file is generated by the test."],
  dependencyTreeRoots: [{ name: "root", reference: "workspace:." }],
  enableTopLevelFallback: true,
  ignorePatternData: "(^(?:\\.yarn\\/sdks(?:\\/(?!\\.{1,2}(?:\\/|$))(?:(?:(?!(?:^|\\/)\\.{1,2}(?:\\/|$)).)*?)|$))$)",
  fallbackExclusionList: [["excluded", ["npm:1.0.0"]]],
  fallbackPool: [["fallback-dep", "npm:1.0.0"]],
  packageRegistryData: [
    [null, [[null, { packageLocation: "./", packageDependencies: rootDeps, linkType: "SOFT" }]]],
    ["root", [["workspace:.", { packageLocation: "./", packageDependencies: rootDeps, linkType: "SOFT" }]]],
    ["left-pad", [["npm:1.0.0", pkg("./.yarn/cache/left-pad-npm-1.0.0.zip/node_modules/left-pad/", [["left-pad", "npm:1.0.0"]])]]],
    [
      "withpeer",
      [["virtual:abc#npm:1.0.0", pkg("./.yarn/__virtual__/withpeer-virtual-abc/0/cache/withpeer-npm-1.0.0.zip/node_modules/withpeer/", [["withpeer", "virtual:abc#npm:1.0.0"], ["react", null]])]],
    ],
    ["tsconfig-pkg", [["npm:1.0.0", pkg("./.yarn/cache/tsconfig-pkg-npm-1.0.0.zip/node_modules/tsconfig-pkg/", [])]]],
    ["fallback-dep", [["npm:1.0.0", pkg("./.yarn/cache/fallback-dep-npm-1.0.0.zip/node_modules/fallback-dep/", [])]]],
    ["excluded", [["npm:1.0.0", pkg("./.yarn/cache/excluded-npm-1.0.0.zip/node_modules/excluded/", [])]]],
    ["broken", [["npm:1.0.0", pkg("./.yarn/cache/broken-npm-1.0.0.zip/node_modules/broken/", [])]]],
    ["bzip", [["npm:1.0.0", pkg("./.yarn/cache/bzip-npm-1.0.0.zip/node_modules/bzip/", [])]]],
    ["trunc", [["npm:1.0.0", pkg("./.yarn/cache/trunc-npm-1.0.0.zip/node_modules/trunc/", [])]]],
    ["corrupt", [["npm:1.0.0", pkg("./.yarn/cache/corrupt-npm-1.0.0.zip/node_modules/corrupt/", [])]]],
    ["described", [["npm:1.0.0", pkg("./.yarn/cache/described-npm-1.0.0.zip/node_modules/described/", [])]]],
    ["exports-pkg", [["npm:1.0.0", pkg("./.yarn/cache/exports-pkg-npm-1.0.0.zip/node_modules/exports-pkg/", [])]]],
    ["msdos", [["npm:1.0.0", pkg("./.yarn/cache/msdos-npm-1.0.0.zip/node_modules/msdos/", [])]]],
  ],
};

// A big text (several deflate blocks, back references across 32 KiB)
let big = "";
for (let i = 0; i < 4000; i++) big += `export const v${i} = ${(i * 7919) % 1000} + "${"abcdefghij".slice(i % 10)}";\n`;

function writeProject(root, manifestKind) {
  write(root, "package.json", JSON.stringify({ name: "root" }));
  write(root, "tsconfig.json", JSON.stringify({ extends: "tsconfig-pkg/base.json" }));
  write(root, "src/index.js", 'import pad from "left-pad";\nimport { util } from "left-pad/lib/util.js";\nimport w from "withpeer";\nimport al from "aliased";\nimport ex from "exports-pkg/feature";\nimport d from "described";\nimport m from "msdos";\nconsole.log(pad, util, w, al, ex, d, m);\n');
  write(root, "src/missing.js", 'import "not-a-dependency";\n');
  write(root, "src/peer.js", 'import "withpeer/peer.js";\n');
  write(root, "src/excluded.js", 'import "excluded/index.js";\n');
  for (const name of ["broken", "bzip", "trunc", "corrupt"]) write(root, `src/${name}.js`, `import "${name}";\n`);
  write(root, "src/big.js", 'export * from "left-pad/big.js";\n');
  write(root, "src/tsx.tsx", "export const el = <div/>;\n");

  const cache = (name, entries) => write(root, `.yarn/cache/${name}-npm-1.0.0.zip`, makeZip(entries));
  cache("left-pad", [
    { name: "node_modules/", dir: true, method: 0 },
    { name: "node_modules/left-pad/", dir: true, method: 0 },
    { name: "node_modules/left-pad/package.json", data: JSON.stringify({ name: "left-pad", main: "index.js" }), method: 0 },
    { name: "node_modules/left-pad/index.js", data: 'import f from "fallback-dep";\nexport default function pad(s, n) { return String(s).padStart(n) + f }\n' },
    { name: "node_modules/left-pad/lib/util.js", data: "export const util = 'stored entry';\n", method: 0 },
    { name: "node_modules/left-pad/big.js", data: big },
  ]);
  cache("withpeer", [
    { name: "node_modules/withpeer/package.json", data: JSON.stringify({ name: "withpeer", version: "1.0.0" }) },
    { name: "node_modules/withpeer/index.js", data: "export default 'with a peer';\n" },
    { name: "node_modules/withpeer/peer.js", data: 'import "react";\n' },
  ]);
  cache("tsconfig-pkg", [{ name: "node_modules/tsconfig-pkg/base.json", data: JSON.stringify({ compilerOptions: { jsxFactory: "h", jsxFragmentFactory: "Frag" } }) }]);
  cache("fallback-dep", [{ name: "node_modules/fallback-dep/index.js", data: "export default 'from the fallback pool';\n" }]);
  cache("excluded", [{ name: "node_modules/excluded/index.js", data: 'import "fallback-dep";\n' }]);
  cache("broken", [{ name: "node_modules/broken/index.js", data: "export default 1;\n", crc: 12345 }]);
  cache("bzip", [{ name: "node_modules/bzip/index.js", data: "export default 1;\n", method: 12, raw: Buffer.from("BZh91AY&SY") }]);
  const deflated = deflateRawSync(Buffer.from("export default 'a longer text that is deflated and then cut off';\n".repeat(20)));
  cache("trunc", [{ name: "node_modules/trunc/index.js", data: "export default 'a longer text that is deflated and then cut off';\n".repeat(20), raw: deflated.subarray(0, deflated.length >> 1) }]);
  cache("corrupt", [{ name: "node_modules/corrupt/index.js", data: "export default 1;\n", raw: Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x01]) }]);
  cache("described", [{ name: "node_modules/described/index.js", data: "export default 'with a data descriptor';\n", descriptor: true }]);
  cache("exports-pkg", [
    { name: "node_modules/exports-pkg/package.json", data: JSON.stringify({ name: "exports-pkg", exports: { "./feature": { import: "./lib/feature.mjs", default: "./lib/feature.js" } } }) },
    { name: "node_modules/exports-pkg/lib/feature.mjs", data: "export default 'exports map';\n" },
    { name: "node_modules/exports-pkg/lib/feature.js", data: "module.exports = 'cjs';\n" },
  ]);
  cache("msdos", [
    { name: "node_modules/msdos", dir: true, creator: 0, attrs: 0x10, method: 0 },
    { name: "node_modules/msdos/index.js", data: "export default 'msdos attributes';\n", creator: 0, attrs: 0x20 },
  ]);

  const json = JSON.stringify(manifest, null, 2);
  switch (manifestKind) {
    case "data.json":
      write(root, ".pnp.data.json", json);
      write(root, ".pnp.cjs", "// (the loader: esbuild reads .pnp.data.json)\n");
      break;
    case "cjs-variable":
      // Yarn's current format: a string with line continuations in a variable
      write(root, ".pnp.cjs", `#!/usr/bin/env node\n/* eslint-disable */\n"use strict";\n\nconst RAW_RUNTIME_STATE =\n'${json.split("\n").join("\\\n")}';\n\nfunction $$SETUP_STATE(hydrateRuntimeState, basePath) {\n  return hydrateRuntimeState(JSON.parse(RAW_RUNTIME_STATE), {basePath: basePath || __dirname});\n}\n`);
      break;
    case "cjs-literal": {
      // (a string literal with escapes: "\\", "\x22" and """)
      let k = 0;
      const literal =
        "'" +
        JSON.stringify(manifest)
          .replace(/\\/g, "\\\\")
          .replace(/'/g, "\\'")
          .replace(/"/g, () => (k++ % 3 === 0 ? "\\x22" : k % 3 === 0 ? "\\u0022" : '"')) +
        "'";
      write(root, ".pnp.cjs", `"use strict";\nfunction $$SETUP_STATE(hydrateRuntimeState, basePath) {\n  return hydrateRuntimeState(JSON.parse(${literal}), {basePath: basePath || __dirname});\n}\n`);
      break;
    }
    case "js-object":
      write(root, ".pnp.js", `"use strict";\nfunction $$SETUP_STATE(hydrateRuntimeState, basePath) {\n  return hydrateRuntimeState(${json}, {basePath: basePath || __dirname});\n}\n`);
      break;
    case "cjs-syntax-error":
      write(root, ".pnp.cjs", `"use strict";\nconst RAW_RUNTIME_STATE =\n'{\\\n  "__info": [],\\\n  "packageRegistryData": [\\\n    [null, [[null, {"packageLocation": "./" "packageDependencies": []}]]]\\\n  ]\\\n}';\nfunction $$SETUP_STATE(hydrateRuntimeState, basePath) {\n  return hydrateRuntimeState(JSON.parse(RAW_RUNTIME_STATE), {basePath: basePath || __dirname});\n}\n`);
      break;
  }
}

const esbuild = require("esbuild");
const fast = require("../lib/main.js");

function messages(list) {
  return (list || []).map((m) => ({ id: m.id, text: m.text, location: m.location, notes: m.notes }));
}

async function run(impl, options) {
  try {
    const r = await impl.build(options);
    return {
      files: (r.outputFiles || []).map((f) => [f.path, Buffer.from(f.contents).toString("latin1")]),
      metafile: r.metafile,
      warnings: messages(r.warnings),
    };
  } catch (e) {
    return { errors: messages(e.errors), warnings: messages(e.warnings) };
  }
}

const nativeBin = require.resolve("@esbuild/win32-x64/esbuild.exe");
const fastBin = join(here, "..", "bin", "esbuild");
// (native esbuild on Windows reports the OS's error texts, esbuild-wasm the
// ones of Go's js/wasm port, which the package reproduces)
function normalize(text) {
  return text
    .replace(/Done in [0-9]+ms/g, "Done in <n>ms")
    .replace(/: The system cannot find the (file|path) specified\./g, ": No such file or directory");
}
function cli(bin, args, cwd) {
  const r = spawnSync(bin === fastBin ? process.execPath : bin, bin === fastBin ? [fastBin, ...args] : args, { cwd, encoding: "latin1", env: { ...process.env, WT_SESSION: "1" } });
  const files = {};
  const out = join(cwd, "out");
  if (existsSync(out)) {
    for (const name of readdirSync(out)) files[name] = readFileSync(join(out, name), "latin1");
    rmSync(out, { recursive: true, force: true });
  }
  return { status: r.status, stdout: r.stdout, stderr: normalize(r.stderr), files };
}

const ENTRIES = ["index.js", "missing.js", "peer.js", "excluded.js", "broken.js", "bzip.js", "trunc.js", "corrupt.js", "big.js", "tsx.tsx"];
const OPTIONS = [{}, { metafile: true, minify: true }, { platform: "node", format: "esm" }];
let builds = 0;
const roots = [];
for (const manifestKind of ["data.json", "cjs-variable", "cjs-literal", "js-object", "cjs-syntax-error"]) {
  const root = mkdtempSync(join(tmpdir(), "fast-esbuild-pnp-"));
  roots.push(root);
  {
    writeProject(root, manifestKind);
    for (const entry of ENTRIES) {
      for (const opts of OPTIONS) {
        const options = { entryPoints: [join(root, "src", entry)], bundle: true, write: false, outdir: join(root, "out"), absWorkingDir: root, logLevel: "silent", ...opts };
        const a = JSON.stringify(await run(esbuild, options));
        const b = JSON.stringify(await run(fast, options));
        builds++;
        if (a !== b) {
          let i = 0;
          while (i < a.length && a[i] === b[i]) i++;
          check(false, `build ${manifestKind} ${entry} ${JSON.stringify(opts)}`, "esbuild: " + a.slice(Math.max(0, i - 200), i + 300) + "\n  fast:    " + b.slice(Math.max(0, i - 200), i + 300));
        } else ok++;
      }
    }

    // The CLI, with the resolver's debug logs
    for (const [entry, level] of [
      ["index.js", "debug"],
      ["index.js", "verbose"],
      ["missing.js", "debug"],
      ["peer.js", "verbose"],
      ["excluded.js", "debug"],
      ["broken.js", "debug"],
    ]) {
      const args = [`src/${entry}`, "--bundle", "--outdir=out", `--log-level=${level}`, "--metafile=out/meta.json"];
      const a = JSON.stringify(cli(nativeBin, args, root));
      const b = JSON.stringify(cli(fastBin, args, root));
      builds++;
      if (a !== b) {
        let i = 0;
        while (i < a.length && a[i] === b[i]) i++;
        check(false, `cli ${manifestKind} ${entry} ${level}`, "esbuild: " + a.slice(Math.max(0, i - 300), i + 300) + "\n  fast:    " + b.slice(Math.max(0, i - 300), i + 300));
      } else ok++;
    }
  }
}
console.log(`yarnpnp: ${builds} builds compared`);

// Damaged archives (no PnP manifest is needed to read inside a ".zip"): the
// errors of Go's archive/zip and compress/flate (corrupt input offsets,
// unexpected EOFs, checksums, sizes)
{
  let seed = 12345;
  const rnd = (n) => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed % n;
  };
  const root = mkdtempSync(join(tmpdir(), "fast-esbuild-zip-"));
  roots.push(root);
  const N = 150;
  let imports = "";
  for (let i = 0; i < N; i++) {
    let text = "export const x" + i + " = [";
    const len = rnd(3) === 0 ? rnd(40) : rnd(20000);
    for (let k = 0; k < len; k++) text += rnd(4) === 0 ? String(rnd(1000)) + "," : "'" + "abcdefgh".slice(rnd(8)) + "',";
    text += "];\n";
    const data = Buffer.from(text);
    const method = rnd(4) === 0 ? 0 : 8;
    let raw = method === 8 ? deflateRawSync(data, { level: rnd(10), strategy: rnd(5) }) : Buffer.from(data);
    const entry = { name: "f.js", data, method };
    switch (rnd(8)) {
      case 0: // flip a byte
        if (raw.length > 0) {
          raw = Buffer.from(raw);
          raw[rnd(raw.length)] ^= 1 << rnd(8);
        }
        break;
      case 1: // truncate
        raw = raw.subarray(0, rnd(raw.length + 1));
        break;
      case 2: // trailing garbage
        raw = Buffer.concat([raw, Buffer.from([rnd(256), rnd(256), rnd(256)])]);
        break;
      case 3: // a wrong uncompressed size
        entry.usize = Math.max(0, data.length + rnd(5) - 2);
        break;
      case 4: // a data descriptor, maybe with a wrong CRC-32
        entry.descriptor = true;
        if (rnd(2) === 0) entry.descriptorCRC = 7;
        break;
      case 5: // random bytes
        raw = Buffer.from(Array.from({ length: rnd(30) }, () => rnd(256)));
        break;
    }
    entry.raw = raw;
    write(root, `c${i}.zip`, makeZip([entry]));
    imports += `import "./c${i}.zip/f.js";\n`;
  }
  write(root, "entry.js", imports);
  for (let i = 0; i < N; i++) write(root, `e${i}.js`, `export * from "./c${i}.zip/f.js";\n`);
  const kinds = new Map();
  for (let i = 0; i < N; i++) {
    const options = { entryPoints: [join(root, `e${i}.js`)], bundle: true, write: false, outdir: join(root, "out"), absWorkingDir: root, logLevel: "silent" };
    const a = JSON.stringify(await run(esbuild, options));
    const b = JSON.stringify(await run(fast, options));
    const errors = JSON.parse(a).errors;
    const kind = errors ? (errors.length > 0 ? errors[0].text.replace(/^.*": /, "").replace(/[0-9]+/g, "N") : "?") : "ok";
    kinds.set(kind, (kinds.get(kind) || 0) + 1);
    if (a !== b) {
      let k = 0;
      while (k < a.length && a[k] === b[k]) k++;
      check(false, `damaged archive c${i}.zip`, "esbuild: " + a.slice(Math.max(0, k - 200), k + 300) + "\n  fast:    " + b.slice(Math.max(0, k - 200), k + 300));
    } else ok++;
  }
  console.log(`yarnpnp: ${N} damaged archives compared:`, Object.fromEntries(kinds));
}

// (esbuild keeps the ".zip" archives it reads open until it stops)
esbuild.stop();
fast.stop();
await new Promise((resolve) => setTimeout(resolve, 500));
for (const root of roots) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
console.log(`yarnpnp: ${ok} ok, ${bad} failed`);
process.exit(bad > 0 ? 1 : 0);
