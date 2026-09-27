// Function indices of a wasm module that block in memory.atomic.wait
// (futex / condvar / thread-pool parking). Chrome's CPU profiler counts a
// thread sleeping in such a wait as running that function, so profiles of
// multi-threaded wasm (rolldown, Tailwind's oxide, ...) show idle threads as
// busy; bench/tools/nodepod-buckets.mjs reports those samples as "(waiting)".
// Needs `wasm-tools` (cargo install wasm-tools); modules are fetched once
// into .scratch/wasm-cache/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cache = join(dirname(fileURLToPath(import.meta.url)), "../../.scratch/wasm-cache");

/** Set of function indices (the index space V8 reports as wasm-function[N]) */
export async function waitFunctions(url) {
  mkdirSync(cache, { recursive: true });
  const key = createHash("sha1").update(url).digest("hex").slice(0, 16);
  const done = join(cache, key + ".waits.json");
  if (existsSync(done)) return new Set(JSON.parse(readFileSync(done, "utf8")));
  const file = join(cache, key + ".wasm");
  if (!existsSync(file)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const wat = execFileSync("wasm-tools", ["print", file], { maxBuffer: 1 << 30, encoding: "utf8" });
  const waits = [];
  let cur = -1;
  for (const line of wat.split("\n")) {
    const m = line.match(/^ {2}\(func \(;(\d+);\)/);
    if (m) cur = Number(m[1]);
    else if (cur >= 0 && line.includes("memory.atomic.wait")) {
      if (waits[waits.length - 1] !== cur) waits.push(cur);
    }
  }
  writeFileSync(done, JSON.stringify(waits));
  return new Set(waits);
}
