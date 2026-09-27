// Writes this package's copy of @noble/hashes 1.8.0 (the devDependency):
// every CommonJS and ESM module with its .d.ts, without the source-map
// comments (maps and TypeScript sources are not shipped), with the patches
// from tools/patches.mjs applied. test/files.mjs checks the result.
// usage: node tools/vendor.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { applyPatches } from "./patches.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
export const upstream = dirname(createRequire(import.meta.url).resolve("@noble/hashes"));

/** upstream text as shipped here, before patches */
export function strip(text) {
  return text.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");
}

/** relative paths of every vendored file */
export function vendoredFiles() {
  const out = [];
  for (const sub of ["", "esm"]) {
    for (const f of readdirSync(join(upstream, sub))) {
      if (f.endsWith(".js") || f.endsWith(".d.ts")) out.push(sub ? `${sub}/${f}` : f);
    }
  }
  return out;
}

/** the expected content of a vendored file */
export function expected(rel) {
  return applyPatches(rel, strip(readFileSync(join(upstream, rel), "utf8")));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(join(upstream, "package.json"), "utf8"));
  if (version !== "1.8.0") throw new Error("expected @noble/hashes 1.8.0, found " + version);
  mkdirSync(join(here, "esm"), { recursive: true });
  const files = vendoredFiles();
  for (const rel of files) writeFileSync(join(here, rel), expected(rel));
  copyFileSync(join(upstream, "esm/package.json"), join(here, "esm/package.json"));
  console.log(`vendored ${files.length} files from ${upstream}`);
}
