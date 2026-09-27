// usage: node tools/numcheck.mjs [--native] [path/to/esbuild-src]
//
// Builds tools/numcheck_go.go inside the esbuild module (using "go build
// -overlay", so the esbuild tree is not modified) for GOOS=js GOARCH=wasm,
// which is how esbuild-wasm runs (pure-Go math, saturating float->int
// conversions), runs it with node and compares every result with the JS port
// in src/js_ast_helpers.mjs. With --native the Go program is built for the
// host platform instead (to see where native esbuild differs from the wasm
// build; mismatches are expected there for Log/Exp/Pow on amd64).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  foldBinaryOperator,
  shouldFoldBinaryOperatorWhenMinifying,
  toInt32,
  toUint32,
  tryToStringOnNumberSafely,
  stringToEquivalentNumberValue,
  goMathLog,
  goMathLog10,
  goMathExp,
  goMathFrexp,
  goMathModf,
  goMathLdexp,
} from "../src/js_ast_helpers.mjs";
import { Expr, EBinary, ENumber, E_NUMBER, E_BOOLEAN } from "../src/js_ast.mjs";
import { BAIL } from "../src/bail.mjs";

const args = process.argv.slice(2);
const native = args.includes("--native");
const esbuildSrc = resolve(args.find((a) => !a.startsWith("--")) || join(tmpdir(), "esbuild-src"));
const toolsDir = dirname(fileURLToPath(import.meta.url));

function run(cmd, cmdArgs, opts) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) {
    console.log(`${cmd} ${cmdArgs.join(" ")} failed:\n${r.stderr}\n${r.stdout.slice(0, 2000)}`);
    process.exit(1);
  }
  return r.stdout;
}

const goEnv = { ...process.env, GOTOOLCHAIN: "local" };
const goroot = run("go", ["env", "GOROOT"], { env: goEnv }).trim();
const work = mkdtempSync(join(tmpdir(), "fastesb-numcheck-"));
let output;
try {
  const fakeMain = join(esbuildSrc, "cmd", "fastesb_numcheck", "main.go");
  const overlay = join(work, "overlay.json");
  writeFileSync(overlay, JSON.stringify({ Replace: { [fakeMain]: join(toolsDir, "numcheck_go.go") } }));
  const exe = join(work, native ? "numcheck.exe" : "numcheck.wasm");
  // esbuild 0.28.2 is built with Go 1.26, where the wasm "satconv" feature
  // (saturating float->int conversions, e.g. int(NaN) == 0) is always on.
  // Older toolchains need GOWASM=satconv to behave the same.
  const env = native ? goEnv : { ...goEnv, GOOS: "js", GOARCH: "wasm", GOWASM: "satconv,signext" };
  run("go", ["build", "-overlay", overlay, "-o", exe, fakeMain], { cwd: esbuildSrc, env });
  if (native) {
    output = run(exe, []);
  } else {
    output = run(process.execPath, [join(goroot, "misc", "wasm", "wasm_exec_node.js"), exe], { env: goEnv });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const dv = new DataView(new ArrayBuffer(8));
function fromHex(h) {
  dv.setBigUint64(0, BigInt("0x" + h));
  return dv.getFloat64(0);
}
function toHex(f) {
  dv.setFloat64(0, f);
  return dv.getBigUint64(0).toString(16);
}
function sameFloat(a, b) {
  if (a !== a && b !== b) return true; // NaN payloads don't matter
  return toHex(a) === toHex(b);
}

let checked = 0;
const failures = new Map(); // kind -> count
const examples = [];
function fail(kind, line, got) {
  failures.set(kind, (failures.get(kind) || 0) + 1);
  if (examples.length < 40) examples.push(`${line}   <-- JS: ${got}`);
}

for (const line of output.split("\n")) {
  if (line === "") continue;
  checked++;
  if (line.startsWith("strnum ")) {
    const m = /^strnum (".*") (\S+) (\S+)$/.exec(line);
    let s = JSON.parse(m[1]);
    if (s === "<empty>") s = "";
    const [v, ok] = stringToEquivalentNumberValue(s);
    if (!sameFloat(v, fromHex(m[2])) || String(ok) !== m[3]) fail("strnum", line, `${toHex(v)} ${ok}`);
    continue;
  }
  const t = line.split(" ");
  switch (t[0]) {
    case "invln10": {
      const want = fromHex(t[1]);
      if (!sameFloat(want, 0.4342944819032518)) fail("invln10", line, toHex(0.4342944819032518));
      break;
    }
    case "toint32": {
      const got = toInt32(fromHex(t[1]));
      if (String(got) !== t[2]) fail("toint32", line, got);
      break;
    }
    case "touint32": {
      const got = toUint32(fromHex(t[1]));
      if (String(got) !== t[2]) fail("touint32", line, got);
      break;
    }
    case "tostr": {
      let [s, ok] = tryToStringOnNumberSafely(fromHex(t[1]), +t[2]);
      if (s === "") s = "-";
      if (s !== t[3] || String(ok) !== t[4]) fail("tostr", line, `${s} ${ok}`);
      break;
    }
    case "log": {
      const got = goMathLog(fromHex(t[1]));
      if (!sameFloat(got, fromHex(t[2]))) fail("log", line, toHex(got));
      break;
    }
    case "log10": {
      const got = goMathLog10(fromHex(t[1]));
      if (!sameFloat(got, fromHex(t[2]))) fail("log10", line, toHex(got));
      break;
    }
    case "exp": {
      const got = goMathExp(fromHex(t[1]));
      if (!sameFloat(got, fromHex(t[2]))) fail("exp", line, toHex(got));
      break;
    }
    case "frexp": {
      const [fr, ex] = goMathFrexp(fromHex(t[1]));
      if (!sameFloat(fr, fromHex(t[2])) || String(ex) !== t[3]) fail("frexp", line, `${toHex(fr)} ${ex}`);
      break;
    }
    case "modf": {
      const [ip, fp] = goMathModf(fromHex(t[1]));
      if (!sameFloat(ip, fromHex(t[2])) || !sameFloat(fp, fromHex(t[3]))) fail("modf", line, `${toHex(ip)} ${toHex(fp)}`);
      break;
    }
    case "ldexp": {
      const got = goMathLdexp(fromHex(t[1]), +t[2]);
      if (!sameFloat(got, fromHex(t[3]))) fail("ldexp", line, toHex(got));
      break;
    }
    case "fold": {
      const op = +t[1];
      const e = new EBinary(new Expr(new ENumber(fromHex(t[2]))), new Expr(new ENumber(fromHex(t[3]))), op);
      const result = foldBinaryOperator(0, e);
      const kind = "fold" + op;
      if (t[4] === "n") {
        if (result === null || result.data.k !== E_NUMBER || !sameFloat(result.data.value, fromHex(t[5]))) {
          fail(kind, line, result === null ? "none" : result.data.k === E_NUMBER ? toHex(result.data.value) : result.data.value);
        }
      } else if (t[4] === "b") {
        if (result === null || result.data.k !== E_BOOLEAN || String(result.data.value) !== t[5]) {
          fail(kind, line, result === null ? "none" : result.data.value);
        }
      } else if (result !== null) {
        fail(kind, line, "not none");
      }
      break;
    }
    case "should": {
      const op = +t[1];
      const e = new EBinary(new Expr(new ENumber(fromHex(t[2]))), new Expr(new ENumber(fromHex(t[3]))), op);
      let got;
      try {
        got = String(shouldFoldBinaryOperatorWhenMinifying(e));
      } catch (err) {
        if (err !== BAIL) throw err;
        got = "bail";
      }
      if (got !== t[4]) fail("should" + op, line, got);
      break;
    }
    default:
      throw new Error("unknown line: " + line);
  }
}

console.log(`${native ? "native" : "wasm"} Go vs JS: ${checked} checks`);
if (failures.size === 0) {
  console.log("all identical");
} else {
  for (const [kind, count] of failures) console.log(`  ${kind}: ${count} mismatches`);
  for (const ex of examples) console.log("  " + ex);
  process.exit(1);
}
