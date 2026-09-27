import { readFileSync } from "node:fs";
import { parse, Options, optionsFromConfig } from "../src/js_parser.mjs";
import { Log, Source, Path, PrettyPaths } from "../src/logger.mjs";
import { processDefines, ModeConvertFormat, FormatCommonJS, PlatformNeutral } from "../src/config.mjs";
import { newLexer, TEndOfFile } from "../src/js_lexer.mjs";
const { fastTransform } = await import("../src/transform.mjs");
const file = process.argv[2] || new URL("../../../node_modules/three/build/three.module.js", import.meta.url);
const code = readFileSync(file, "utf8");
const src = new Source(new PrettyPaths("<stdin>", "<stdin>"), "stdin", code, new Path("<stdin>"), 1);
const o = new Options();
o.defines = processDefines([]);
o.mode = ModeConvertFormat;
o.outputFormat = FormatCommonJS;
o.platform = PlatformNeutral;
function time(label, fn, n = 8) {
  for (let i = 0; i < 3; i++) fn();
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  console.log(label.padEnd(24), best.toFixed(1), "ms");
  return best;
}
const tp = time("parse+visit (js_parser)", () => parse(new Log(), src, o));
const flags = ["--log-level=silent", "--log-limit=0", "--target=esnext", "--format=cjs", "--platform=neutral", "--loader=js"];
const tt = time("full transform", () => fastTransform(flags, code));
console.log("link+print ~", (tt - tp).toFixed(1), "ms");
