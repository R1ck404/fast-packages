// usage: node tools/runtimecheck.mjs [path/to/esbuild-src]
// Builds tools/runtimecheck_go.go inside the esbuild module (via "go build
// -overlay", without modifying the esbuild tree), runs it, and compares
// runtime.Source() for all relevant feature combinations with src/runtime.mjs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { source, SourceIndex } from "../src/runtime.mjs";

const esbuildSrc = resolve(process.argv[2] || join(tmpdir(), "esbuild-src"));
const toolsDir = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env, GOTOOLCHAIN: "local" };

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) {
    console.log(`${cmd} ${args.join(" ")} failed:\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
}

const work = mkdtempSync(join(tmpdir(), "fastesb-runtimecheck-"));
let results;
try {
  const fakeMain = join(esbuildSrc, "cmd", "fastesb_runtimecheck", "main.go");
  const overlay = join(work, "overlay.json");
  writeFileSync(overlay, JSON.stringify({ Replace: { [fakeMain]: join(toolsDir, "runtimecheck_go.go") } }));
  const exe = join(work, "runtimecheck.exe");
  run("go", ["build", "-overlay", overlay, "-o", exe, fakeMain], { cwd: esbuildSrc, env });
  results = JSON.parse(run(exe, []));
} finally {
  rmSync(work, { recursive: true, force: true });
}

let failed = false;
for (const r of results) {
  for (const features of [BigInt(r.Features), Number(r.Features)]) {
    const s = source(features);
    const checks = [
      ["index", s.index, r.Index],
      ["SourceIndex", SourceIndex, r.Index],
      ["keyPath.text", s.keyPath.text, r.KeyPathText],
      ["keyPath.namespace", s.keyPath.namespace, r.KeyPathNS],
      ["prettyPaths.abs", s.prettyPaths.abs, r.PrettyAbs],
      ["prettyPaths.rel", s.prettyPaths.rel, r.PrettyRel],
      ["identifierName", s.identifierName, r.IdentifierName],
      ["contents", s.contents, r.Contents],
    ];
    for (const [name, got, want] of checks) {
      if (got !== want) {
        failed = true;
        console.log(`features=${r.Features} (${typeof features}): ${name} differs`);
      }
    }
  }
}
const distinct = new Set(results.map((r) => r.Contents)).size;
console.log(failed ? "MISMATCH" : `runtime.Source identical for ${results.length} feature sets (${distinct} distinct texts)`);
process.exit(failed ? 1 : 0);
