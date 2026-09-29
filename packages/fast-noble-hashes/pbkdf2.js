"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pbkdf2 = pbkdf2;
exports.pbkdf2Async = pbkdf2Async;
/**
 * PBKDF (RFC 2898). Can be used to create a key from password and salt.
 * @module
 */
const hmac_ts_1 = require("./hmac.js");
// prettier-ignore
const utils_ts_1 = require("./utils.js");
// fast-noble-hashes: iterations 2..c in wasm for the SHA-2, SHA-1 and MD5 PRFs
const _fast_js_1 = require("./_fast.js");
// Common prologue and epilogue for sync/async functions
function pbkdf2Init(hash, _password, _salt, _opts) {
    (0, utils_ts_1.ahash)(hash);
    const opts = (0, utils_ts_1.checkOpts)({ dkLen: 32, asyncTick: 10 }, _opts);
    const { c, dkLen, asyncTick } = opts;
    (0, utils_ts_1.anumber)(c);
    (0, utils_ts_1.anumber)(dkLen);
    (0, utils_ts_1.anumber)(asyncTick);
    if (c < 1)
        throw new Error('iterations (c) should be >= 1');
    const password = (0, utils_ts_1.kdfInputToBytes)(_password);
    const salt = (0, utils_ts_1.kdfInputToBytes)(_salt);
    // DK = PBKDF2(PRF, Password, Salt, c, dkLen);
    const DK = new Uint8Array(dkLen);
    // U1 = PRF(Password, Salt + INT_32_BE(i))
    const PRF = hmac_ts_1.hmac.create(hash, password);
    const PRFSalt = PRF._cloneInto().update(salt);
    return { c, dkLen, asyncTick, DK, PRF, PRFSalt };
}
function pbkdf2Output(PRF, PRFSalt, DK, prfW, u) {
    PRF.destroy();
    PRFSalt.destroy();
    if (prfW)
        prfW.destroy();
    (0, utils_ts_1.clean)(u);
    return DK;
}
/**
 * PBKDF2-HMAC: RFC 2898 key derivation function
 * @param hash - hash function that would be used e.g. sha256
 * @param password - password from which a derived key is generated
 * @param salt - cryptographic salt
 * @param opts - {c, dkLen} where c is work factor and dkLen is output message size
 * @example
 * const key = pbkdf2(sha256, 'password', 'salt', { dkLen: 32, c: Math.pow(2, 18) });
 */
function pbkdf2(hash, password, salt, opts) {
    const { c, dkLen, DK, PRF, PRFSalt } = pbkdf2Init(hash, password, salt, opts);
    let prfW; // Working copy
    const arr = new Uint8Array(4);
    const view = (0, utils_ts_1.createView)(arr);
    const u = new Uint8Array(PRF.outputLen);
    const fk = (0, _fast_js_1.fastPrf)(PRF);
    // DK = T1 + T2 + ⋯ + Tdklen/hlen
    for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
        // Ti = F(Password, Salt, c, i)
        const Ti = DK.subarray(pos, pos + PRF.outputLen);
        view.setInt32(0, ti, false);
        // F(Password, Salt, c, i) = U1 ^ U2 ^ ⋯ ^ Uc
        // U1 = PRF(Password, Salt + INT_32_BE(i))
        (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
        Ti.set(u.subarray(0, Ti.length));
        if (fk && c > 1) {
            (0, _fast_js_1.fastPbkdf2)(PRF, fk, u, Ti, c - 1);
            continue;
        }
        for (let ui = 1; ui < c; ui++) {
            // Uc = PRF(Password, Uc−1)
            PRF._cloneInto(prfW).update(u).digestInto(u);
            for (let i = 0; i < Ti.length; i++)
                Ti[i] ^= u[i];
        }
    }
    return pbkdf2Output(PRF, PRFSalt, DK, prfW, u);
}
/**
 * PBKDF2-HMAC: RFC 2898 key derivation function. Async version.
 * @example
 * await pbkdf2Async(sha256, 'password', 'salt', { dkLen: 32, c: 500_000 });
 */
async function pbkdf2Async(hash, password, salt, opts) {
    const { c, dkLen, asyncTick, DK, PRF, PRFSalt } = pbkdf2Init(hash, password, salt, opts);
    let prfW; // Working copy
    const arr = new Uint8Array(4);
    const view = (0, utils_ts_1.createView)(arr);
    const u = new Uint8Array(PRF.outputLen);
    const fk = (0, _fast_js_1.fastPrf)(PRF);
    // DK = T1 + T2 + ⋯ + Tdklen/hlen
    for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
        // Ti = F(Password, Salt, c, i)
        const Ti = DK.subarray(pos, pos + PRF.outputLen);
        view.setInt32(0, ti, false);
        // F(Password, Salt, c, i) = U1 ^ U2 ^ ⋯ ^ Uc
        // U1 = PRF(Password, Salt + INT_32_BE(i))
        (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
        Ti.set(u.subarray(0, Ti.length));
        if (fk && c > 1) {
            await (0, _fast_js_1.fastPbkdf2Async)(PRF, fk, u, Ti, c - 1, asyncTick);
            continue;
        }
        await (0, utils_ts_1.asyncLoop)(c - 1, asyncTick, () => {
            // Uc = PRF(Password, Uc−1)
            PRF._cloneInto(prfW).update(u).digestInto(u);
            for (let i = 0; i < Ti.length; i++)
                Ti[i] ^= u[i];
        });
    }
    return pbkdf2Output(PRF, PRFSalt, DK, prfW, u);
}
