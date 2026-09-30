// Check the optional native path, fallback paths, and 64 KiB boundary in
// fresh processes so cached native detection cannot hide a missing fallback.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as crypto from 'node:crypto';
const [mode, format] = process.argv.slice(2);
if (!mode) {
  for (const mode of ['native', 'unavailable', 'disabled', 'nowasm']) for (const format of ['esm', 'cjs']) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), mode, format], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    process.stdout.write(r.stdout);
  }
} else {
  const original = process.getBuiltinModule;
  const calls = [];
  if (mode === 'unavailable') process.getBuiltinModule = undefined;
  else process.getBuiltinModule = function(name) {
    const mod = name === 'node:crypto' ? crypto : original?.call(process, name);
    if (name !== 'node:crypto') return mod;
    return { ...mod, createHash(algorithm) {
      calls.push(algorithm);
      if (mode === 'disabled') throw new Error('native hashes disabled by host');
      return mod.createHash(algorithm);
    }};
  };
  const require = createRequire(import.meta.url);
  const F = format === 'esm'
    ? { ...await import('../esm/sha2.js'), ...await import('../esm/legacy.js') }
    : { ...require('../sha2.js'), ...require('../legacy.js') };
  const O = { ...await import('@noble/hashes/sha2'), ...await import('@noble/hashes/legacy') };
  if (mode === 'nowasm') {
    globalThis.WebAssembly = undefined;
    assert.throws(() => F.sha256(new Uint8Array(65536)), /needs WebAssembly/);
    assert.equal(calls.length, 0);
  } else {
    const backing = Uint8Array.from({ length: 131080 }, (_, i) => i * 73);
    const messages = [
      backing.subarray(3, 3 + 65535), backing.subarray(3, 3 + 65536),
      backing.subarray(3, 3 + 65537), Buffer.from(backing),
      'x'.repeat(65535), 'x'.repeat(65536),
      '😀漢字\ud800'.repeat(16384),
    ];
    for (const name of ['sha256', 'sha224', 'sha512', 'sha384', 'sha512_224', 'sha512_256', 'sha1', 'md5']) {
      for (const msg of messages) {
        const output = F[name](msg);
        assert.equal(Object.getPrototypeOf(output), Uint8Array.prototype);
        assert.deepEqual(output, O[name](msg));
        const sliced = output.slice();
        output[0] ^= 255;
        assert.deepEqual(sliced, O[name](msg));
        assert.deepEqual(F[name](msg), sliced);
      }
    }
    if (mode === 'native' || mode === 'disabled') assert.equal(new Set(calls).size, 8);
    else assert.equal(calls.length, 0);
    // Native update() uses the view's actual size, whereas wasm feed() uses
    // its JS length/subarray. Customized views must preserve the latter.
    const custom = new Uint8Array(backing);
    Object.defineProperty(custom, 'length', { value: 65536 });
    const before = calls.length;
    const normal = new Uint8Array(backing);
    assert.deepEqual(F.sha256(custom), F.sha256(normal.subarray(0, 65536)));
    // The reference call above is native; the customized call must not be.
    assert.equal(calls.length - before, mode === 'native' || mode === 'disabled' ? 1 : 0);
    const customSubarray = new Uint8Array(backing);
    customSubarray.subarray = (start, end) => new Uint8Array(end - start);
    assert.deepEqual(F.sha256(customSubarray), O.sha256(new Uint8Array(backing.length)));
  }
  console.log(`${mode}/${format}: native boundary, bytes, output ownership and fallback checks passed`);
}
