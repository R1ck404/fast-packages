// native A/B helper: node nb.mjs  -> min ms of N runs (single chunk)
import { execSync } from "node:child_process";
let best = Infinity;
for (let i = 0; i < 3; i++) {
  const out = execSync("cargo test --release --target x86_64-pc-windows-msvc -- --ignored --nocapture native_inflate_speed", { env: { ...process.env, CS: "67108864" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const m = out.match(/native tgz: ([0-9.]+) ms/);
  best = Math.min(best, Number(m[1]));
}
console.log("best", best, "ms");
