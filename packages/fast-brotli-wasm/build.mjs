// Build fastbrotli.wasm (cargo + wasm-opt -O3).
// usage: node packages/fast-brotli-wasm/build.mjs [--no-opt] [--no-fastdec]
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const crate = join(here, "rust");
// (run from the crate dir so .cargo/config.toml applies: wasm32 + simd128)
const noFastdec = process.argv.includes("--no-fastdec");
execSync(`cargo build --release${noFastdec ? " --no-default-features" : ""}`, { cwd: crate, stdio: "inherit" });
let bytes = readFileSync(join(crate, "target/wasm32-unknown-unknown/release/fastbrotli.wasm"));
console.log("raw wasm:", bytes.length, "bytes");

if (!process.argv.includes("--no-opt")) {
  const { default: binaryen } = await import("binaryen");
  const mod = binaryen.readBinary(bytes);
  mod.setFeatures(binaryen.Features.All);
  binaryen.setOptimizeLevel(3);
  binaryen.setShrinkLevel(0);
  // functions with one caller are only inlined when small: fully inlined, the
  // encoder became one 100 KB function that V8 compiles as a whole at the
  // first compress() (about 6 ms more for the first call)
  binaryen.setOneCallerInlineMaxSize(3000);
  mod.optimize();
  bytes = Buffer.from(mod.emitBinary());
  console.log("wasm-opt -O3:", bytes.length, "bytes");
}
writeFileSync(join(here, "fastbrotli.wasm"), bytes);
console.log("wrote fastbrotli.wasm");
