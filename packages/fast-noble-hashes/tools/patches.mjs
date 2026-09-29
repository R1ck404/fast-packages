// Every change made to @noble/hashes 1.8.0's files (ESM and the tsc
// CommonJS output). A patch is [find, replace], `find` occurring exactly
// once, or [[from, to], replace]: the text from `from` (exactly once)
// through the first `to` after it. tools/vendor.mjs applies them;
// test/files.mjs checks the shipped files are upstream + these patches and
// nothing else.
//
// The compression functions of SHA-256/224, the SHA-512 family, SHA-1 and
// MD5 (process(), with their round constants and message schedule arrays)
// and scrypt's ROMix (XorAndSalsa, BlockMix and its loops) are replaced by
// the wasm in _fast.js; everything else is noble's code.

const NOTE = "// fast-noble-hashes: ";
const esm = { f: (name) => name, call: (name) => name, pure: "/* @__PURE__ */ " };
const cjs = { f: (name) => `_fast_js_1.${name}`, call: (name) => `(0, _fast_js_1.${name})`, pure: "" };

const MD_UPDATE = (x, aexists, toBytes) => [
  [
    `        ${aexists}(this);
        data = ${toBytes}(data);`,
    `        ${aexists}(this);
        if (${x.call("fastMD")}(this, data))
            return this;
        data = ${toBytes}(data);`,
  ],
  [
    `        this.finished = true;
        // Padding`,
    `        this.finished = true;
        if (${x.call("fastMD")}(this, out, 1))
            return;
        // Padding`,
  ],
];

const PBKDF2_LOOP = (x, asyncLoop) => {
  const head = `    const u = new Uint8Array(PRF.outputLen);
    // DK = T1 + T2 + ⋯ + Tdklen/hlen
    for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
        // Ti = F(Password, Salt, c, i)
        const Ti = DK.subarray(pos, pos + PRF.outputLen);
        view.setInt32(0, ti, false);
        // F(Password, Salt, c, i) = U1 ^ U2 ^ ⋯ ^ Uc
        // U1 = PRF(Password, Salt + INT_32_BE(i))
        (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
        Ti.set(u.subarray(0, Ti.length));
`;
  const withFast = (call, next) =>
    head.replace(
      `    const u = new Uint8Array(PRF.outputLen);\n`,
      `    const u = new Uint8Array(PRF.outputLen);\n    const fk = ${x.call("fastPrf")}(PRF);\n`,
    ) +
    `        if (fk && c > 1) {
            ${call};
            continue;
        }
${next}`;
  return [
    [head + `        for (let ui = 1; ui < c; ui++) {`, withFast(`${x.call("fastPbkdf2")}(PRF, fk, u, Ti, c - 1)`, `        for (let ui = 1; ui < c; ui++) {`)],
    [
      head + `        await ${asyncLoop}(c - 1, asyncTick, () => {`,
      withFast(`await ${x.call("fastPbkdf2Async")}(PRF, fk, u, Ti, c - 1, asyncTick)`, `        await ${asyncLoop}(c - 1, asyncTick, () => {`),
    ],
  ];
};

// process() of a class: the wasm of its family; roundClean() has no
// scratch arrays left to clean
const PROCESS = (x, family, from, setLine, clean) => [
  [[`    process(view, offset) {\n${from}`, `        ${setLine}\n    }\n    roundClean() {\n        ${clean}\n    }`],
    `    process(view, offset) {
        ${x.call("fastProcess")}(this, view, offset, ${family});
    }
    roundClean() {
    }`],
];

const SHA2 = (x, clean, hasher, fastHasher) => [
  [[`/**\n * Round constants:\n * First 32 bits of fractional parts`, `const SHA256_W = /* @__PURE__ */ new Uint32Array(64);\n`], `${NOTE}SHA256_K and SHA256_W are in the wasm\n`],
  ...PROCESS(x, "FAST_SHA256", `        // Extend the first 16 words into the remaining 48 words`, "this.set(A, B, C, D, E, F, G, H);", `${clean}(SHA256_W);`),
  [[`// SHA2-512 is slower than sha256 in js because u64 operations are slow.`, `const SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);\n`], `${NOTE}K512 and the SHA512_W arrays are in the wasm\n`],
  ...PROCESS(
    x,
    "FAST_SHA512",
    `        // Extend the first 16 words into the remaining 64 words`,
    "this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);",
    `${clean}(SHA512_W_H, SHA512_W_L);`,
  ),
  ...[["SHA256", "SHA256"], ["SHA224", "SHA256"], ["SHA512", "SHA512"], ["SHA384", "SHA512"], ["SHA512_256", "SHA512"], ["SHA512_224", "SHA512"]].map(([c, f]) => [
    `${hasher}(() => new ${c}());`,
    `${fastHasher}(() => new ${c}(), FAST_${f});`,
  ]),
];

const LEGACY = (x, clean) => [
  [`// Reusable temporary buffer\nconst SHA1_W = /* @__PURE__ */ new Uint32Array(80);\n`, `${NOTE}SHA1_W is in the wasm\n`],
  ...PROCESS(x, "FAST_SHA1", `        for (let i = 0; i < 16; i++, offset += 4)\n            SHA1_W[i]`, "this.set(A, B, C, D, E);", `${clean}(SHA1_W);`),
  [`// Reusable temporary buffer\nconst MD5_W = /* @__PURE__ */ new Uint32Array(16);\n`, `${NOTE}MD5_W is in the wasm\n`],
  ...PROCESS(x, "FAST_MD5", `        for (let i = 0; i < 16; i++, offset += 4)\n            MD5_W[i]`, "this.set(A, B, C, D);", `${clean}(MD5_W);`),
];

const SCRYPT = (x, u32, clean) => [
  [[`// The main Scrypt loop: uses Salsa extensively.`, `out, tail); // tail[i] = Salsa(blockIn[2*i+1] ^ head[i])\n    }\n}\n`], `${NOTE}XorAndSalsa and BlockMix are in the wasm\n`],
  [`    const blockSize32 = blockSize / 4;\n`, ``],
  [[`    const B32 = ${u32}(B);`, `    return { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, asyncTick };`], `    return { N, r, p, dkLen, B, onProgress, asyncTick };`],
  [`function scryptOutput(password, dkLen, B, V, tmp) {`, `function scryptOutput(password, dkLen, B) {`],
  [`    ${clean}(B, V, tmp);`, `    ${clean}(B);`],
  [
    [`    const { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb } = scryptInit(password, salt, opts);`, `    return scryptOutput(password, dkLen, B, V, tmp);\n}`],
    `    const { N, r, p, dkLen, B, onProgress } = scryptInit(password, salt, opts);
    ${x.call("fastScrypt")}(FAST_SCRYPT, B, r, N, p, onProgress);
    return scryptOutput(password, dkLen, B);
}`,
  ],
  [
    [`    const { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, asyncTick } = scryptInit(password, salt, opts);`, `    return scryptOutput(password, dkLen, B, V, tmp);\n}`],
    `    const { N, r, p, dkLen, B, onProgress, asyncTick } = scryptInit(password, salt, opts);
    await ${x.call("fastScryptAsync")}(FAST_SCRYPT, B, r, N, p, onProgress, asyncTick);
    return scryptOutput(password, dkLen, B);
}`,
  ],
];

// the families (see wasmFamily in _fast.ts): a bundle keeps a family, and
// its wasm, only when a class or hasher that uses it is kept
const fam = (x, name, args) => `const FAST_${name} = ${x.pure}${x.call("wasmFamily")}(${x.f(`WASM_${name}`)}${args});`;
const SHA2_FAMILIES = (x) =>
  [fam(x, "SHA256", `, 64, 8, 8, ${x.pure}${x.call("K")}(64)`), fam(x, "SHA512", `, 128, 16, 8, ${x.pure}${x.call("K")}(80)`)].join("\n");
const LEGACY_FAMILIES = (x) => [fam(x, "SHA1", ", 64, 8, 5"), fam(x, "MD5", `, 64, 8, 4, () => K.map(BigInt), ${x.f("MD5_X")}`)].join("\n");

export const PATCHES = {
  "esm/_md.js": [
    [
      `import { Hash, abytes, aexists, aoutput, clean, createView, toBytes } from "./utils.js";`,
      `import { Hash, abytes, aexists, aoutput, clean, createView, toBytes } from "./utils.js";
${NOTE}the registered classes run in wasm (_fast.js)
import { fastMD } from "./_fast.js";`,
    ],
    ...MD_UPDATE(esm, "aexists", "toBytes"),
  ],
  "_md.js": [
    [
      `const utils_ts_1 = require("./utils.js");
/** Polyfill for Safari 14.`,
      `const utils_ts_1 = require("./utils.js");
${NOTE}the registered classes run in wasm (_fast.js)
const _fast_js_1 = require("./_fast.js");
/** Polyfill for Safari 14.`,
    ],
    ...MD_UPDATE(cjs, "(0, utils_ts_1.aexists)", "(0, utils_ts_1.toBytes)"),
  ],
  "esm/sha2.js": [
    [
      `import { Chi, HashMD, Maj, SHA224_IV, SHA256_IV, SHA384_IV, SHA512_IV } from "./_md.js";
import * as u64 from "./_u64.js";
import { clean, createHasher, rotr } from "./utils.js";`,
      `import { HashMD, SHA224_IV, SHA256_IV, SHA384_IV, SHA512_IV } from "./_md.js";
import { clean } from "./utils.js";
${NOTE}the compression functions and the one-shot hashers in wasm
import { fastHasher, fastProcess, wasmFamily, K, WASM_SHA256, WASM_SHA512 } from "./_fast.js";
${SHA2_FAMILIES(esm)}`,
    ],
    ...SHA2(esm, "clean", "/* @__PURE__ */ createHasher", "/* @__PURE__ */ fastHasher"),
  ],
  "sha2.js": [
    [
      `const _md_ts_1 = require("./_md.js");
const u64 = require("./_u64.js");
const utils_ts_1 = require("./utils.js");`,
      `const _md_ts_1 = require("./_md.js");
const utils_ts_1 = require("./utils.js");
${NOTE}the compression functions and the one-shot hashers in wasm
const _fast_js_1 = require("./_fast.js");
${SHA2_FAMILIES(cjs)}`,
    ],
    ...SHA2(cjs, "(0, utils_ts_1.clean)", "(0, utils_ts_1.createHasher)", "(0, _fast_js_1.fastHasher)"),
  ],
  "esm/legacy.js": [
    [
      `import { Chi, HashMD, Maj } from "./_md.js";
import { clean, createHasher, rotl } from "./utils.js";`,
      `import { HashMD } from "./_md.js";
import { clean, createHasher, rotl } from "./utils.js";
${NOTE}the compression functions and the one-shot hashers in wasm
import { fastHasher, fastProcess, wasmFamily, MD5_X, WASM_MD5, WASM_SHA1 } from "./_fast.js";
${LEGACY_FAMILIES(esm)}`,
    ],
    ...LEGACY(esm, "clean"),
    [`export const sha1 = /* @__PURE__ */ createHasher(() => new SHA1());`, `export const sha1 = /* @__PURE__ */ fastHasher(() => new SHA1(), FAST_SHA1);`],
    [`export const md5 = /* @__PURE__ */ createHasher(() => new MD5());`, `export const md5 = /* @__PURE__ */ fastHasher(() => new MD5(), FAST_MD5);`],
  ],
  "legacy.js": [
    [
      `const _md_ts_1 = require("./_md.js");
const utils_ts_1 = require("./utils.js");
/** Initial SHA1 state */`,
      `const _md_ts_1 = require("./_md.js");
const utils_ts_1 = require("./utils.js");
${NOTE}the compression functions and the one-shot hashers in wasm
const _fast_js_1 = require("./_fast.js");
${LEGACY_FAMILIES(cjs)}
/** Initial SHA1 state */`,
    ],
    ...LEGACY(cjs, "(0, utils_ts_1.clean)"),
    [`exports.sha1 = (0, utils_ts_1.createHasher)(() => new SHA1());`, `exports.sha1 = (0, _fast_js_1.fastHasher)(() => new SHA1(), FAST_SHA1);`],
    [`exports.md5 = (0, utils_ts_1.createHasher)(() => new MD5());`, `exports.md5 = (0, _fast_js_1.fastHasher)(() => new MD5(), FAST_MD5);`],
  ],
  "esm/pbkdf2.js": [
    [
      `import { ahash, anumber, asyncLoop, checkOpts, clean, createView, Hash, kdfInputToBytes } from "./utils.js";`,
      `import { ahash, anumber, asyncLoop, checkOpts, clean, createView, Hash, kdfInputToBytes } from "./utils.js";
${NOTE}iterations 2..c in wasm for the SHA-2, SHA-1 and MD5 PRFs
import { fastPbkdf2, fastPbkdf2Async, fastPrf } from "./_fast.js";`,
    ],
    ...PBKDF2_LOOP(esm, "asyncLoop"),
  ],
  "pbkdf2.js": [
    [
      `const utils_ts_1 = require("./utils.js");
// Common prologue`,
      `const utils_ts_1 = require("./utils.js");
${NOTE}iterations 2..c in wasm for the SHA-2, SHA-1 and MD5 PRFs
const _fast_js_1 = require("./_fast.js");
// Common prologue`,
    ],
    ...PBKDF2_LOOP(cjs, "(0, utils_ts_1.asyncLoop)"),
  ],
  "esm/scrypt.js": [
    [
      `import { anumber, asyncLoop, checkOpts, clean, rotl, swap32IfBE, u32 } from "./utils.js";`,
      `import { anumber, checkOpts, clean } from "./utils.js";
${NOTE}ROMix in wasm
import { fastScrypt, fastScryptAsync, wasmFamily, WASM_SCRYPT } from "./_fast.js";
const FAST_SCRYPT = /* @__PURE__ */ wasmFamily(WASM_SCRYPT);`,
    ],
    ...SCRYPT(esm, "u32", "clean"),
  ],
  "scrypt.js": [
    [
      `const utils_ts_1 = require("./utils.js");
// The main Scrypt loop`,
      `const utils_ts_1 = require("./utils.js");
${NOTE}ROMix in wasm
const _fast_js_1 = require("./_fast.js");
const FAST_SCRYPT = (0, _fast_js_1.wasmFamily)(_fast_js_1.WASM_SCRYPT);
// The main Scrypt loop`,
    ],
    ...SCRYPT(cjs, "(0, utils_ts_1.u32)", "(0, utils_ts_1.clean)"),
  ],
};

export function applyPatches(rel, text) {
  for (const [find, replace] of PATCHES[rel] || []) {
    const [from, to] = Array.isArray(find) ? find : [find, null];
    const i = text.indexOf(from);
    if (i < 0 || text.indexOf(from, i + 1) >= 0) throw new Error(`${rel}: patch target not found exactly once:\n${from}`);
    let end = i + from.length;
    if (to !== null) {
      const k = text.indexOf(to, end);
      if (k < 0) throw new Error(`${rel}: end of patch range not found:\n${to}`);
      end = k + to.length;
    }
    text = text.slice(0, i) + replace + text.slice(end);
  }
  return text;
}
