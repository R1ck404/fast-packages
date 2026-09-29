// Mutation check for the test suite: applies one deliberate bug at a time to
// the glue (esm/_fast.ts, rebuilt to esm/_fast.js), the patched esm/_md.js or
// the wasm (wasm/*, rebuilt with build.mjs) and expects `test/diff.mjs
// --quick` to fail. The file is restored (and rebuilt) afterwards.
// usage: node tools/mutate.mjs
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT = "esm/_fast.ts";
// sources are rebuilt into the JavaScript the tests load: TypeScript by
// tools/ts-build.mjs, the wasm by build.mjs
const rebuild = (rel) =>
  rel.startsWith("wasm/")
    ? spawnSync(process.execPath, [join(here, "build.mjs")], { encoding: "utf8" })
    : rel.endsWith(".ts")
      ? spawnSync(process.execPath, [join(here, "../../tools/ts-build.mjs")], { encoding: "utf8" })
      : null;

const MUTATIONS = [
  // messages through io (chunks, strings, buffered bytes)
  ["    c = Math.min(CAP - pos, n - i);", "    c = Math.min(CAP, n - i);"],
  ["    if (data.length * 3 <= CAP) {", "    if (data.length * 2 <= CAP) {"],
  ["    if (pos + x.length < h.blockLen) {", "    if (pos + x.length <= h.blockLen) {"],
  ["      h.roundClean();\n", ""],
  ["(buffer[pos + i] = m[IO + i]), (m[IO + i] = 0);", "buffer[pos + i] = m[IO + i];"],
  ["    h.pos = feed(f, pos, n);\n    h.length += n;", "    h.pos = feed(f, pos, n);\n    h.length += n + (n > 100 ? 1 : 0);"],
  ["      h.pos += n;\n      h.length += n;\n      return true;", "      h.pos += n;\n      h.length += n + 1;\n      return true;"],
  ["  keep || buffer.set(f.v);\n", ""],
  ["const keep = !digest && !pos && !(n % f.b);", "const keep = !digest && !(n % f.b);"],
  ["m.subarray(O, O + k.outputLen)", "m.subarray(O, O + k.outputLen - 1)"],
  // which instances take the fast path
  ["h.outputLen === k.outputLen && ", ""],
  ["KERNELS.get(h.constructor);", "KERNELS.get(h.constructor) || KERNELS.get(Object.getPrototypeOf(h.constructor));"],
  ["h.padOffset === k.padOffset && h.isLE === k.isLE", "true"],
  ["  KERNELS.set(t.constructor, t);", "  KERNELS.set(t.constructor, t);\n  t.constructor.prototype.k = t;"],
  ["h.set(i[0], i[1], i[2]", "h.set(i[1], i[0], i[2]"],
  // process()
  ["for (let j = 0; j < f.b; j += 4, offset += 4)", "for (let j = 0; j < f.b; j += 4)"],
  ["    f.e.u(0, f.b);", "    f.e.u(0, f.b - 1);"],
  // the one-shot hashers
  ["    F.i.set(iv);", "    F.i.set(iv.map((x) => x ^ 1));"],
  ["    F.e.d(feed(F, 0, n), n);", "    F.e.d(feed(F, 0, n), n + (n > 5000 ? 1 : 0));"],
  // expand()
  ["      else if (v < 16) o[n++] = 3 + ((v - (j % r) + r) % r);", "      else if (v < 16) o[n++] = 3 + ((v + (j % r)) % r);"],
  ["      else if (v < 32) o[n++] = 3 + r + ((v - 16 + j) & 15);", "      else if (v < 32) o[n++] = 3 + r + ((v - 16 - j) & 15);"],
  ["        if (v < 43) for (let i = 0; i < k; i++) ex(t, a, a + L, i);", "        if (v < 43) for (let i = 1; i < k; i++) ex(t, a, a + L, i);"],
  ["        else if (j >= s && j < k) ex(t, a, a + L, j);", "        else if (j >= s) ex(t, a, a + L, j);"],
  // the text of the wasm
  ["ix(i++) + 85 : k - 8) & 255", "ix(i++) + 84 : k - 8) & 255"],
  // round constants
  ["let x = BigInt(Math.floor(Math.cbrt(p) * 2 ** 40) + 2) << 24n;", "let x = BigInt(Math.floor(Math.cbrt(p) * 2 ** 40) - 2) << 24n;"],
  ["[7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]", "[7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 21, 15]"],
  // PBKDF2
  ["  f.i.set(PRF.oHash.get(), 16);", "  f.i.set(PRF.iHash.get(), 16);"],
  ["  for (; iters > 0; iters -= 2 ** 30) pbkdf2Run(PRF, k, u, acc, Math.min(iters, 2 ** 30));\n  Ti.set(acc.subarray(0, Ti.length));", "  for (; iters > 0; iters -= 2 ** 30) pbkdf2Run(PRF, k, u, acc, Math.min(iters, 2 ** 30));\n  Ti.set(u.subarray(0, Ti.length));"],
  ["    await nextTick();\n    ts += diff;\n  }\n  Ti.set(acc.subarray(0, Ti.length));", "    await nextTick();\n    ts += diff;\n  }\n  Ti.set(acc.subarray(1, Ti.length + 1));"],
  // scrypt
  ["    const j = (i & ~15) | ((i * 5) & 15);", "    const j = (i & ~15) | ((i * 3) & 15);"],
  ["      if (onProgress && (!(e % per) || e === total)) onProgress(e / total);", "      if (onProgress && !(e % per)) onProgress(e / total);"],
  ["      if (r) w.s(pi, cnt - pi * steps, e - pi * steps);", "      w.s(pi, cnt - pi * steps, e - pi * steps);"],
  ["(Math.floor(cnt / per) + 1) * per, (pi + 1) * steps)", "(Math.floor(cnt / per) + 1) * per, (pi + 2) * steps)"],
  ["const per = Math.max(Math.floor(total / 10000), 1);\n  try {", "const per = Math.max(Math.floor(total / 1000), 1);\n  try {"],
  ["  new Int32Array(w.m.buffer).set([N, bs, 65536, 65536 + bs * p,", "  new Int32Array(w.m.buffer).set([N, bs, 65536, 65536 + bs * p + 64,"],
  // the patched HashMD
  ["esm/_md.js", "if (fastMD(this, out, 1))", "if (fastMD(this, out))"],
  // the wasm
  ["wasm/kernels.mjs", 'get(a), i32(2), I32("rotr"), get(a), i32(13), I32("rotr"), I32("xor"), get(a), i32(22)', 'get(a), i32(2), I32("rotr"), get(a), i32(13), I32("rotr"), I32("xor"), get(a), i32(21)'],
  ["wasm/kernels.mjs", "    i32(IO), i32(0), get($n), A.memfill,\n", ""],
  ["wasm/kernels.mjs", "    get($ol), i32(0x80), A.st32(P2),\n", ""],
  ["wasm/kernels.mjs", "range(40, 60, i32(0x8f1bbcdc | 0), I32(\"add\"), MAJ1)", "range(40, 60, i32(0x8f1bbcdc | 0), I32(\"add\"), PAR1)"],
  ["wasm/scrypt.wat", "(i32.const 13)) (i32x4.shr_u (local.get $t) (i32.const 19))", "(i32.const 12)) (i32x4.shr_u (local.get $t) (i32.const 20))"],
];

// an interrupted run leaves the mutated file and this backup behind
const backup = join(here, ".mutate-backup.json");
if (existsSync(backup)) {
  const { rel, text } = JSON.parse(readFileSync(backup, "utf8"));
  writeFileSync(join(here, rel), text);
  unlinkSync(backup);
  rebuild(rel);
  console.log("restored", rel, "from an interrupted run");
}

let caught = 0;
let file = null, orig = null, current = null;
try {
  for (const mu of MUTATIONS) {
    const [rel, a, b] = mu.length === 3 ? mu : [DEFAULT, ...mu];
    file = join(here, rel);
    current = rel;
    orig = readFileSync(file, "utf8");
    if (!orig.includes(a)) {
      console.log("NOT FOUND:", JSON.stringify(a));
      file = null;
      continue;
    }
    writeFileSync(backup, JSON.stringify({ rel, text: orig }));
    writeFileSync(file, orig.replace(a, b));
    // (build.mjs checks the wasm too, but writes it first: the test suite
    // must catch the bug on its own)
    const built = rebuild(rel);
    const r = spawnSync(process.execPath, [join(here, "test/diff.mjs"), "--quick"], { encoding: "utf8", timeout: 120000 });
    // (a hang counts as caught: the suite did not pass)
    const last = (built && built.status !== 0 ? "(build check failed too) " : "") + (r.error ? "timeout" : (r.stdout + r.stderr).trim().split("\n").pop());
    writeFileSync(file, orig);
    rebuild(rel);
    unlinkSync(backup);
    file = null;
    const ok = r.status !== 0;
    if (ok) caught++;
    console.log(ok ? "caught " : "MISSED ", JSON.stringify(b.slice(0, 70)), "->", last.slice(0, 80));
  }
} finally {
  if (file) {
    writeFileSync(file, orig);
    rebuild(current);
    if (existsSync(backup)) unlinkSync(backup);
  }
}
console.log(`${caught}/${MUTATIONS.length} mutations caught`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
