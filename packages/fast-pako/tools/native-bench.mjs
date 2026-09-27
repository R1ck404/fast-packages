// Native (x86) timing of the inflate loop via the ignored Rust test
// native_inflate_speed: node packages/fast-pako/tools/native-bench.mjs -> min ms of 3 runs
import { execSync } from "node:child_process";
let best = Infinity;
for (let i = 0; i < 3; i++) {
  const out = execSync("cargo test --release --target x86_64-pc-windows-msvc -- --ignored --nocapture native_inflate_speed", { cwd: new URL("../rust/", import.meta.url), env: { ...process.env, CS: "67108864" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const m = out.match(/native tgz: ([0-9.]+) ms/);
  best = Math.min(best, Number(m[1]));
}
console.log("best", best, "ms");
