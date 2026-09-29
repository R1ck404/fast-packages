// Bundled (esbuild and Rollup, minified or not, ESM and the CommonJS files),
// the wasm must still be loaded: a bundler that drops the module's init
// (e.g. because it looks side-effect free) silently leaves noble's JS running.
// And a bundle must carry only the wasm modules of the families its imports
// use (each family's module is referenced from its hashers only).
import { build } from "esbuild";
import { rollup } from "rollup";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
// (inside the package, so the bundles' import of @noble/hashes/crypto resolves)
const tmp = mkdtempSync(join(here, ".bundle-"));
let checks = 0, fails = 0;
const ok = (c, what) => {
  checks++;
  if (!c) {
    fails++;
    console.log("FAIL", what);
  }
};

const FAMILIES = ["sha256", "sha512", "sha1", "md5", "scrypt"];
const fast = await import(pathToFileURL(join(here, "esm/_fast.js")).href);
const wasm = Object.fromEntries(FAMILIES.map((f) => [f, fast[`WASM_${f.toUpperCase()}`]]));
const hex = (b) => Buffer.from(b).toString("hex");
const probe = `import { wasmActive, wasmFamilies } from "./esm/_fast.js";`;
// (the digests first: the families load on first use)
const out = (digests) => `const d = ${digests}; export default [wasmActive(), wasmFamilies(), d];`;
const SCRYPT = `{ N: 16, r: 1, p: 1, dkLen: 16 }`;

// each entry: its code, the families it must (and only it may) carry, and
// the digests its default export must hold
const entries = {
  sha256: {
    code: `import { sha256 } from "./esm/sha256.js"; ${probe} ${out(`[sha256("abc")]`)}`,
    families: ["sha256"],
    digests: [createHash("sha256").update("abc").digest("hex")],
  },
  sha512: {
    code: `import { sha512, sha384 } from "./esm/sha512.js"; ${probe} ${out(`[sha512("abc"), sha384("abc")]`)}`,
    families: ["sha512"],
    digests: [createHash("sha512").update("abc").digest("hex"), createHash("sha384").update("abc").digest("hex")],
  },
  md5: {
    code: `import { md5 } from "./esm/legacy.js"; ${probe} ${out(`[md5("abc")]`)}`,
    families: ["md5"],
    digests: [createHash("md5").update("abc").digest("hex")],
  },
  legacy: {
    code: `import { md5, sha1 } from "./esm/legacy.js"; ${probe} ${out(`[md5("abc"), sha1.create().update("abc").digest()]`)}`,
    families: ["sha1", "md5"],
    digests: [createHash("md5").update("abc").digest("hex"), createHash("sha1").update("abc").digest("hex")],
  },
  hmac: {
    code: `import { sha256 } from "./esm/sha2.js"; import { hmac } from "./esm/hmac.js"; import { pbkdf2 } from "./esm/pbkdf2.js"; ${probe}
${out(`[hmac(sha256, "k", "abc"), pbkdf2(sha256, "pw", "salt", { c: 3, dkLen: 32 })]`)}`,
    families: ["sha256"],
    digests: [
      (await import("node:crypto")).createHmac("sha256", "k").update("abc").digest("hex"),
      (await import("node:crypto")).pbkdf2Sync("pw", "salt", 3, 32, "sha256").toString("hex"),
    ],
  },
  scrypt: {
    code: `import { scrypt } from "./esm/scrypt.js"; ${probe} ${out(`[scrypt("pw", "salt", ${SCRYPT})]`)}`,
    families: ["sha256", "scrypt"],
    digests: [(await import("node:crypto")).scryptSync("pw", "salt", 16, { N: 16, r: 1, p: 1 }).toString("hex")],
  },
  // Nodepod's imports: every family
  nodepod: {
    code: `import { scrypt } from "./esm/scrypt.js"; import { sha384, sha512 } from "./esm/sha512.js"; import { sha256 } from "./esm/sha256.js";
import { sha1 } from "./esm/sha1.js"; import { md5 } from "./esm/legacy.js"; import { hmac } from "./esm/hmac.js"; import { pbkdf2 } from "./esm/pbkdf2.js"; ${probe}
${out(`[scrypt("pw", "salt", ${SCRYPT}), sha384("abc"), sha512("abc"), sha256("abc"), sha1("abc"), md5("abc"), hmac(sha512, "k", "abc"), pbkdf2(sha1, "pw", "salt", { c: 2, dkLen: 20 })]`)}`,
    families: FAMILIES,
    digests: [
      (await import("node:crypto")).scryptSync("pw", "salt", 16, { N: 16, r: 1, p: 1 }).toString("hex"),
      ...["sha384", "sha512", "sha256", "sha1", "md5"].map((a) => createHash(a).update("abc").digest("hex")),
      (await import("node:crypto")).createHmac("sha512", "k").update("abc").digest("hex"),
      (await import("node:crypto")).pbkdf2Sync("pw", "salt", 2, 20, "sha1").toString("hex"),
    ],
  },
  // CommonJS is not tree-shaken: the bundle carries all of _fast.js, and
  // sha512.js requires sha2.js (both SHA-2 families)
  cjs: {
    code: `const { sha512 } = require("./sha512.js"); const { wasmActive, wasmFamilies } = require("./_fast.js"); const d = [sha512("abc")]; module.exports = [wasmActive(), wasmFamilies(), d];`,
    families: ["sha256", "sha512"],
    carries: FAMILIES,
    digests: [createHash("sha512").update("abc").digest("hex")],
  },
};

async function check(name, file, how) {
  const e = entries[name];
  const text = readFileSync(file, "utf8");
  for (const f of FAMILIES) {
    const want = (e.carries || e.families).includes(f);
    ok(text.includes(wasm[f]) === want, `${name} ${how}: the ${f} module is ${want ? "missing" : "included"}`);
  }
  // the common template: once, with any hash family
  ok(text.split(fast.COMMON).length === 2, `${name} ${how}: COMMON once`);
  const mod = await import(pathToFileURL(file).href + "?" + checks);
  const [active, families, digests] = mod.default;
  ok(active === true, `${name} ${how}: wasm not active in the bundle`);
  ok(families === e.families.length, `${name} ${how}: ${families} families, expected ${e.families.length}`);
  ok(JSON.stringify(digests.map(hex)) === JSON.stringify(e.digests), `${name} ${how}: digests`);
}

try {
  for (const [name, { code }] of Object.entries(entries)) {
    const ext = name === "cjs" ? "cjs" : "mjs";
    const entry = join(here, `.bundle-entry-${name}.${ext}`);
    writeFileSync(entry, code);
    try {
      for (const minify of [false, true]) {
        const out = join(tmp, `${name}-esbuild-${minify}.${ext}`);
        await build({ entryPoints: [entry], bundle: true, minify, format: ext === "cjs" ? "cjs" : "esm", platform: "neutral", outfile: out, logLevel: "silent", external: ["@noble/hashes/crypto", "node:*"] });
        await check(name, out, `esbuild${minify ? " --minify" : ""}`);
      }
      if (name === "cjs") continue; // (Rollup needs a plugin for CommonJS)
      const b = await rollup({ input: entry, external: ["@noble/hashes/crypto"], treeshake: true, onwarn() {} });
      const { output } = await b.generate({ format: "es" });
      const out = join(tmp, `${name}-rollup.mjs`);
      writeFileSync(out, output[0].code);
      await check(name, out, "rollup");
    } finally {
      rmSync(entry, { force: true });
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`bundle.mjs: ${checks} checks, ${fails} failures`);
if (fails) process.exit(1);
