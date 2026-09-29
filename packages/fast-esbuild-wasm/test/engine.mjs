// The engine the transform tests run: the source modules, or with
// FAST_ESBUILD_TEST_ENGINE=bundle the bundled engine of lib/main.js (which
// has deep mode's generator copies: FAST_ESBUILD_FORCE_DEEP=1 then runs
// everything in deep mode, see src/deep.mts)
import { createRequire } from "node:module";

export const bundled = process.env.FAST_ESBUILD_TEST_ENGINE === "bundle";

export async function loadEngine() {
  if (bundled) {
    const e = createRequire(import.meta.url)("../lib/main.js")[Symbol.for("@r1ck404/fast-esbuild-wasm:node")].engine();
    // (Go's stderr as text, like the source modules': lib/main.js set it to
    // the process's bytes)
    e.setStderrBytes(null);
    return { fastTransform: e.fastTransform, stats: e.stats, setStderr: e.setStderr };
  }
  const { fastTransform, stats } = await import("../src/transform.mjs");
  const { setStderr } = await import("../src/logger.mjs");
  return { fastTransform, stats, setStderr };
}
