// One-off check for the switch to TypeScript: every generated JavaScript
// file must be the same program as the hand-written file it replaces (same
// AST, positions aside; comments may differ). The originals were snapshotted
// to .scratch/pre-ts/ (file list in .scratch/pre-ts-list.txt).
// usage: node tools/ts-migrate-check.mjs
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "acorn";
import { root } from "./ts-build.mjs";

const list = readFileSync(join(root, ".scratch/pre-ts-list.txt"), "utf8").split("\n").filter(Boolean);
function ast(text, file) {
  const opts = { ecmaVersion: "latest", sourceType: file.endsWith(".cjs") ? "script" : "module", allowHashBang: true };
  return JSON.stringify(parse(text, opts), (k, v) =>
    k === "start" || k === "end"
      ? undefined
      : typeof v === "bigint"
        ? `${v}n`
        : // a stray `;` left where a type declaration was erased does nothing
          Array.isArray(v)
          ? v.filter((n) => n?.type !== "EmptyStatement")
          : v,
  );
}
let same = 0, differ = 0, notYet = 0;
for (const f of list) {
  const src = f.replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts").replace(/\.js$/, ".ts");
  if (!existsSync(join(root, src))) {
    notYet++;
    continue;
  }
  const a = ast(readFileSync(join(root, ".scratch/pre-ts", f), "utf8"), f);
  const b = ast(readFileSync(join(root, f), "utf8"), f);
  if (a === b) same++;
  else {
    differ++;
    let i = 0;
    while (a[i] === b[i]) i++;
    console.log(`DIFFERENT PROGRAM: ${f}\n  before: ...${a.slice(Math.max(0, i - 80), i + 80)}\n  after:  ...${b.slice(Math.max(0, i - 80), i + 80)}`);
  }
}
console.log(`ts-migrate-check: ${same} identical, ${differ} different, ${notYet} not converted yet`);
process.exit(differ ? 1 : 0);
