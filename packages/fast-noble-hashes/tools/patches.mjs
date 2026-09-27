// Every change made to @noble/hashes 1.8.0's files, as exact find/replace
// pairs on the upstream text (ESM and the tsc CommonJS output). Each `find`
// must occur exactly once. tools/vendor.mjs applies them; test/files.mjs
// checks the shipped files are upstream + these patches and nothing else.

const MD_UPDATE = (fast, aexists, toBytes) => [
  [
    `        ${aexists}(this);
        data = ${toBytes}(data);`,
    `        ${aexists}(this);
        const k = this[${fast("FAST")}];
        if (k !== undefined && this.constructor === k.ctor && ${fast("fastUpdate")}(this, data, k))
            return this;
        data = ${toBytes}(data);`,
  ],
  [
    `        this.finished = true;
        // Padding`,
    `        this.finished = true;
        const k = this[${fast("FAST")}];
        if (k !== undefined && this.constructor === k.ctor && ${fast("fastDigestInto")}(this, out, k))
            return;
        // Padding`,
  ],
];

const SHA2_REGISTER = (fast) => [
  `/**
 * SHA2-256 hash function from RFC 4634.`,
  `${fast("defineFast")}(SHA256, 'sha256');
${fast("defineFast")}(SHA224, 'sha256');
${fast("defineFast")}(SHA512, 'sha512');
${fast("defineFast")}(SHA384, 'sha512');
${fast("defineFast")}(SHA512_224, 'sha512');
${fast("defineFast")}(SHA512_256, 'sha512');
/**
 * SHA2-256 hash function from RFC 4634.`,
];

const PBKDF2_LOOP = (fast, asyncLoop) => {
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
      `    const u = new Uint8Array(PRF.outputLen);\n    const fk = ${fast("fastPrf")}(PRF);\n`,
    ) +
    `        if (fk !== undefined && c > 1 && ${fast("fastPrf")}(PRF) === fk) {
            ${call};
            continue;
        }
${next}`;
  return [
    [head + `        for (let ui = 1; ui < c; ui++) {`, withFast(`${fast("fastPbkdf2")}(PRF, fk, u, Ti, c - 1)`, `        for (let ui = 1; ui < c; ui++) {`)],
    [
      head + `        await ${asyncLoop}(c - 1, asyncTick, () => {`,
      withFast(`await ${fast("fastPbkdf2Async")}(PRF, fk, u, Ti, c - 1, asyncTick)`, `        await ${asyncLoop}(c - 1, asyncTick, () => {`),
    ],
  ];
};

const SCRYPT = (fast, u32, swap32IfBE) => [
  [
    `    const B32 = ${u32}(B);
    // Re-used between parallel iterations. Array(iterations) of B
    const V = ${u32}(new Uint8Array(blockSize * N));
    const tmp = ${u32}(new Uint8Array(blockSize));`,
    `    const B32 = ${u32}(B);
    const F = r >= 1 && p >= 1 ? ${fast("fastScrypt")}(r, N, p) : null;
    // Re-used between parallel iterations. Array(iterations) of B
    const V = F ? EMPTY : ${u32}(new Uint8Array(blockSize * N));
    const tmp = F ? EMPTY : ${u32}(new Uint8Array(blockSize));`,
  ],
  [
    `    return { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, asyncTick };`,
    `    return { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, asyncTick, F, onProgress };`,
  ],
  [
    `    const { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb } = scryptInit(password, salt, opts);
    ${swap32IfBE}(B32);`,
    `    const { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, F, onProgress } = scryptInit(password, salt, opts);
    if (F) {
        ${fast("fastScryptRun")}(F, B, N, p, onProgress);
        return scryptOutput(password, dkLen, B, V, tmp);
    }
    ${swap32IfBE}(B32);`,
  ],
  [
    `    const { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, asyncTick } = scryptInit(password, salt, opts);
    ${swap32IfBE}(B32);`,
    `    const { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, asyncTick, F, onProgress } = scryptInit(password, salt, opts);
    if (F) {
        await ${fast("fastScryptRunAsync")}(F, B, N, p, onProgress, asyncTick);
        return scryptOutput(password, dkLen, B, V, tmp);
    }
    ${swap32IfBE}(B32);`,
  ],
];

const esm = (name) => name;
const cjs = (name) => (/^[A-Z]+$/.test(name) ? `_fast_js_1.${name}` : `(0, _fast_js_1.${name})`);
const NOTE = "// fast-noble-hashes: ";

export const PATCHES = {
  "esm/_md.js": [
    [
      `import { Hash, abytes, aexists, aoutput, clean, createView, toBytes } from "./utils.js";`,
      `import { Hash, abytes, aexists, aoutput, clean, createView, toBytes } from "./utils.js";
${NOTE}registered classes run their blocks in wasm (_fast.js)
import { FAST, fastDigestInto, fastUpdate } from "./_fast.js";`,
    ],
    ...MD_UPDATE(esm, "aexists", "toBytes"),
  ],
  "_md.js": [
    [
      `const utils_ts_1 = require("./utils.js");
/** Polyfill for Safari 14.`,
      `const utils_ts_1 = require("./utils.js");
${NOTE}registered classes run their blocks in wasm (_fast.js)
const _fast_js_1 = require("./_fast.js");
/** Polyfill for Safari 14.`,
    ],
    ...MD_UPDATE(cjs, "(0, utils_ts_1.aexists)", "(0, utils_ts_1.toBytes)"),
  ],
  "esm/sha2.js": [
    [
      `import { clean, createHasher, rotr } from "./utils.js";`,
      `import { clean, createHasher, rotr } from "./utils.js";
${NOTE}wasm block functions and one-shot hashers
import { defineFast, fastHasher } from "./_fast.js";`,
    ],
    SHA2_REGISTER(esm),
    ...["SHA256", "SHA224", "SHA512", "SHA384", "SHA512_256", "SHA512_224"].map((c) => [
      `/* @__PURE__ */ createHasher(() => new ${c}());`,
      `/* @__PURE__ */ fastHasher(() => new ${c}());`,
    ]),
  ],
  "sha2.js": [
    [
      `const utils_ts_1 = require("./utils.js");
/**
 * Round constants:`,
      `const utils_ts_1 = require("./utils.js");
${NOTE}wasm block functions and one-shot hashers
const _fast_js_1 = require("./_fast.js");
/**
 * Round constants:`,
    ],
    SHA2_REGISTER(cjs),
    ...["SHA256", "SHA224", "SHA512", "SHA384", "SHA512_256", "SHA512_224"].map((c) => [
      `(0, utils_ts_1.createHasher)(() => new ${c}());`,
      `(0, _fast_js_1.fastHasher)(() => new ${c}());`,
    ]),
  ],
  "esm/legacy.js": [
    [
      `import { clean, createHasher, rotl } from "./utils.js";`,
      `import { clean, createHasher, rotl } from "./utils.js";
${NOTE}wasm block functions and one-shot hashers
import { defineFast, fastHasher } from "./_fast.js";`,
    ],
    [`export const sha1 = /* @__PURE__ */ createHasher(() => new SHA1());`, `defineFast(SHA1, 'sha1');\nexport const sha1 = /* @__PURE__ */ fastHasher(() => new SHA1());`],
    [`export const md5 = /* @__PURE__ */ createHasher(() => new MD5());`, `defineFast(MD5, 'md5');\nexport const md5 = /* @__PURE__ */ fastHasher(() => new MD5());`],
  ],
  "legacy.js": [
    [
      `const utils_ts_1 = require("./utils.js");
/** Initial SHA1 state */`,
      `const utils_ts_1 = require("./utils.js");
${NOTE}wasm block functions and one-shot hashers
const _fast_js_1 = require("./_fast.js");
/** Initial SHA1 state */`,
    ],
    [`exports.sha1 = (0, utils_ts_1.createHasher)(() => new SHA1());`, `(0, _fast_js_1.defineFast)(SHA1, 'sha1');\nexports.sha1 = (0, _fast_js_1.fastHasher)(() => new SHA1());`],
    [`exports.md5 = (0, utils_ts_1.createHasher)(() => new MD5());`, `(0, _fast_js_1.defineFast)(MD5, 'md5');\nexports.md5 = (0, _fast_js_1.fastHasher)(() => new MD5());`],
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
      `import { anumber, asyncLoop, checkOpts, clean, rotl, swap32IfBE, u32 } from "./utils.js";
${NOTE}ROMix in a wasm instance of its own
import { fastScrypt, fastScryptRun, fastScryptRunAsync } from "./_fast.js";
const EMPTY = /* @__PURE__ */ new Uint32Array(0);`,
    ],
    ...SCRYPT(esm, "u32", "swap32IfBE"),
  ],
  "scrypt.js": [
    [
      `const utils_ts_1 = require("./utils.js");
// The main Scrypt loop`,
      `const utils_ts_1 = require("./utils.js");
${NOTE}ROMix in a wasm instance of its own
const _fast_js_1 = require("./_fast.js");
const EMPTY = /* @__PURE__ */ new Uint32Array(0);
// The main Scrypt loop`,
    ],
    ...SCRYPT(cjs, "(0, utils_ts_1.u32)", "(0, utils_ts_1.swap32IfBE)"),
  ],
};

export function applyPatches(rel, text) {
  for (const [find, replace] of PATCHES[rel] || []) {
    const i = text.indexOf(find);
    if (i < 0 || text.indexOf(find, i + 1) >= 0) throw new Error(`${rel}: patch target not found exactly once:\n${find}`);
    text = text.slice(0, i) + replace + text.slice(i + find.length);
  }
  return text;
}
