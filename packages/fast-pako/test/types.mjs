// index.d.mts: generated from @types/pako 2.0.4 (current), and a consumer
// type-checks against @r1ck404/fast-pako installed as "pako" exactly as it does
// against pako + @types/pako, in every module mode (including a deliberate
// type error that both must report).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(here, "package.json"));
const tsc = require.resolve("typescript/bin/tsc");
let checks = 0, fails = 0;
const ok = (c, what) => {
  checks++;
  if (!c) {
    fails++;
    console.log("FAIL", what);
  }
};

// generated file is current
const before = readFileSync(join(here, "index.d.mts"), "utf8");
execFileSync(process.execPath, [join(here, "tools/gen-types.mjs")], { stdio: "ignore" });
ok(readFileSync(join(here, "index.d.mts"), "utf8") === before, "index.d.mts is generated from @types/pako (run node tools/gen-types.mjs)");

const USE = `import pako from "pako";
import { ungzip, inflate, inflateRaw, deflateRaw, Deflate, Inflate, constants } from "pako";
import type { DeflateOptions, InflateOptions, Data } from "pako";
const a: Uint8Array = ungzip(new Uint8Array(1));
const s: string = inflate(new Uint8Array(1), { to: "string" });
const r: Uint8Array = inflateRaw(deflateRaw("x"));
const d = new Deflate({ level: 6, gzip: true, header: { name: "n" } });
d.push(new Uint8Array(1), true);
const i = new Inflate({ windowBits: 15 } as InflateOptions);
i.push(d.result, constants.Z_FINISH);
const o: pako.DeflateOptions = { level: 9, strategy: constants.Z_RLE };
const o2: DeflateOptions = o;
const x: Data = new ArrayBuffer(1);
const g: Uint8Array = pako.gzip("x", { level: 1 });
const n: number = pako.constants.Z_FINISH;
const c: pako.Deflate = new pako.Deflate();
export { a, s, r, o2, x, g, n, c };
`;
const BAD = `import pako from "pako";\npako.deflate("x", { level: 10 });\n`;
const MODES = [["nodenext", "nodenext"], ["esnext", "bundler"], ["node16", "node16"], ["commonjs", "node10"]];

const tmp = mkdtempSync(join(here, ".types-"));
try {
  const sides = {
    fast: (nm) => symlinkSync(here, join(nm, "pako"), "junction"),
    orig: (nm) => {
      cpSync(dirname(require.resolve("pako/package.json")), join(nm, "pako"), { recursive: true });
      mkdirSync(join(nm, "@types"));
      cpSync(dirname(require.resolve("@types/pako/package.json")), join(nm, "@types/pako"), { recursive: true });
    },
  };
  for (const [side, install] of Object.entries(sides)) {
    const dir = join(tmp, side);
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    install(join(dir, "node_modules"));
    writeFileSync(join(dir, "use.mts"), USE);
    writeFileSync(join(dir, "bad.mts"), BAD);
    for (const [module, moduleResolution] of MODES) {
      for (const file of ["use.mts", "bad.mts"]) {
        const compilerOptions = { noEmit: true, strict: true, esModuleInterop: true, types: [], lib: ["es2022"], target: "es2022", module, moduleResolution };
        writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions, files: [file] }));
        let out = "", code = 0;
        try {
          execFileSync(process.execPath, [tsc, "-p", join(dir, "tsconfig.json")], { encoding: "utf8", stdio: "pipe" });
        } catch (e) {
          code = e.status;
          out = e.stdout;
        }
        if (file === "use.mts") ok(code === 0, `${side} ${module}/${moduleResolution}: ${out.split("\n")[0]}`);
        else ok(code !== 0 && /bad\.mts\(2,/.test(out), `${side} ${module}/${moduleResolution}: level 10 must be a type error`);
      }
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`types.mjs: ${checks} checks, ${fails} failures`);
if (fails) process.exit(1);
