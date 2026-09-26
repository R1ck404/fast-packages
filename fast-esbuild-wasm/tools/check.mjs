// usage: node tools/check.mjs [--import] src/foo.mjs [...]
// Syntax-checks each module with `node --check` and rejects non-ASCII /
// control characters. With --import it also imports the module (which fails if
// any imported module or export does not exist yet).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const doImport = args.includes("--import");
let failed = false;
for (const file of args.filter((a) => a !== "--import")) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (let j = 0; j < line.length; j++) {
      const c = line.charCodeAt(j);
      if (c > 0x7e || (c < 0x20 && c !== 9 && c !== 13)) {
        console.log(`${file}:${i + 1}:${j + 1}: non-ASCII/control character U+${c.toString(16).padStart(4, "0")}`);
        failed = true;
        break;
      }
    }
  });
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status !== 0) {
    console.log(`${file}: SYNTAX ERROR\n${r.stderr}`);
    failed = true;
    continue;
  }
  if (doImport) {
    try {
      await import(pathToFileURL(resolve(file)).href);
    } catch (e) {
      console.log(`${file}: IMPORT ERROR ${e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n") : e}`);
      failed = true;
      continue;
    }
  }
  console.log(`${file}: ok`);
}
process.exit(failed ? 1 : 0);
