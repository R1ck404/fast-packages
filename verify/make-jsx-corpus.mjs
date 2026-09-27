// Build a JSX corpus: .tsx/.jsx files found in the given directories (default:
// the directory containing this repo, i.e. other projects checked out next to
// it), TypeScript stripped by native esbuild with jsx: "preserve" (JSX kept as
// written). Output: verify/jsx-corpus/<hash>.jsx (deduplicated by content).
// usage: node verify/make-jsx-corpus.mjs [max files] [dir ...]
import { transformSync } from "esbuild";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { walk, here, rnd } from "./corpus.mjs";

const sourceDirs = process.argv.length > 3 ? process.argv.slice(3) : [join(here, "../..")];
const out = join(here, "jsx-corpus");
mkdirSync(out, { recursive: true });
const max = Number(process.argv[2] || 6000);
const files = sourceDirs.flatMap((d) => walk(d, (n) => n.endsWith(".tsx") || n.endsWith(".jsx"))).filter((f) => !f.includes(".git"));
console.log("candidates:", files.length);
// shuffle deterministically
for (let i = files.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [files[i], files[j]] = [files[j], files[i]];
}
const seen = new Set();
let n = 0, failed = 0;
for (const f of files) {
  if (n >= max) break;
  let src;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  if (src.length > 400000) continue;
  const h = createHash("sha1").update(src).digest("hex").slice(0, 16);
  if (seen.has(h)) continue;
  seen.add(h);
  let code;
  try {
    code = f.endsWith(".jsx") ? src : transformSync(src, { loader: "tsx", jsx: "preserve", target: "esnext", format: "esm" }).code;
  } catch {
    failed++;
    continue;
  }
  if (!code.includes("<")) continue;
  writeFileSync(join(out, h + ".jsx"), code);
  n++;
}
console.log("written:", n, "failed:", failed);
