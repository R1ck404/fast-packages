/**
 * RFC 7914 Scrypt KDF. Can be used to create a key from password and salt.
 * @module
 */
import { pbkdf2 } from "./pbkdf2.js";
import { sha256 } from "./sha2.js";
// prettier-ignore
import { anumber, checkOpts, clean } from "./utils.js";
// fast-noble-hashes: ROMix in wasm
import { fastScrypt, fastScryptAsync, wasmFamily, WASM_SCRYPT } from "./_fast.js";
const FAST_SCRYPT = /* @__PURE__ */ wasmFamily(WASM_SCRYPT);
// fast-noble-hashes: XorAndSalsa and BlockMix are in the wasm
// Common prologue and epilogue for sync/async functions
function scryptInit(password, salt, _opts) {
    // Maxmem - 1GB+1KB by default
    const opts = checkOpts({
        dkLen: 32,
        asyncTick: 10,
        maxmem: 1024 ** 3 + 1024,
    }, _opts);
    const { N, r, p, dkLen, asyncTick, maxmem, onProgress } = opts;
    anumber(N);
    anumber(r);
    anumber(p);
    anumber(dkLen);
    anumber(asyncTick);
    anumber(maxmem);
    if (onProgress !== undefined && typeof onProgress !== 'function')
        throw new Error('progressCb should be function');
    const blockSize = 128 * r;
    // Max N is 2^32 (Integrify is 32-bit). Real limit is 2^22: JS engines Uint8Array limit is 4GB in 2024.
    // Spec check `N >= 2^(blockSize / 8)` is not done for compat with popular libs,
    // which used incorrect r: 1, p: 8. Also, the check seems to be a spec error:
    // https://www.rfc-editor.org/errata_search.php?rfc=7914
    const pow32 = Math.pow(2, 32);
    if (N <= 1 || (N & (N - 1)) !== 0 || N > pow32) {
        throw new Error('Scrypt: N must be larger than 1, a power of 2, and less than 2^32');
    }
    if (p < 0 || p > ((pow32 - 1) * 32) / blockSize) {
        throw new Error('Scrypt: p must be a positive integer less than or equal to ((2^32 - 1) * 32) / (128 * r)');
    }
    if (dkLen < 0 || dkLen > (pow32 - 1) * 32) {
        throw new Error('Scrypt: dkLen should be positive integer less than or equal to (2^32 - 1) * 32');
    }
    const memUsed = blockSize * (N + p);
    if (memUsed > maxmem) {
        throw new Error('Scrypt: memused is bigger than maxMem. Expected 128 * r * (N + p) > maxmem of ' + maxmem);
    }
    // [B0...Bp−1] ← PBKDF2HMAC-SHA256(Passphrase, Salt, 1, blockSize*ParallelizationFactor)
    // Since it has only one iteration there is no reason to use async variant
    const B = pbkdf2(sha256, password, salt, { c: 1, dkLen: blockSize * p });
    return { N, r, p, dkLen, B, onProgress, asyncTick };
}
function scryptOutput(password, dkLen, B) {
    const res = pbkdf2(sha256, password, B, { c: 1, dkLen });
    clean(B);
    return res;
}
/**
 * Scrypt KDF from RFC 7914.
 * @param password - pass
 * @param salt - salt
 * @param opts - parameters
 * - `N` is cpu/mem work factor (power of 2 e.g. 2**18)
 * - `r` is block size (8 is common), fine-tunes sequential memory read size and performance
 * - `p` is parallelization factor (1 is common)
 * - `dkLen` is output key length in bytes e.g. 32.
 * - `asyncTick` - (default: 10) max time in ms for which async function can block execution
 * - `maxmem` - (default: `1024 ** 3 + 1024` aka 1GB+1KB). A limit that the app could use for scrypt
 * - `onProgress` - callback function that would be executed for progress report
 * @returns Derived key
 * @example
 * scrypt('password', 'salt', { N: 2**18, r: 8, p: 1, dkLen: 32 });
 */
export function scrypt(password, salt, opts) {
    const { N, r, p, dkLen, B, onProgress } = scryptInit(password, salt, opts);
    fastScrypt(FAST_SCRYPT, B, r, N, p, onProgress);
    return scryptOutput(password, dkLen, B);
}
/**
 * Scrypt KDF from RFC 7914. Async version.
 * @example
 * await scryptAsync('password', 'salt', { N: 2**18, r: 8, p: 1, dkLen: 32 });
 */
export async function scryptAsync(password, salt, opts) {
    const { N, r, p, dkLen, B, onProgress, asyncTick } = scryptInit(password, salt, opts);
    await fastScryptAsync(FAST_SCRYPT, B, r, N, p, onProgress, asyncTick);
    return scryptOutput(password, dkLen, B);
}
