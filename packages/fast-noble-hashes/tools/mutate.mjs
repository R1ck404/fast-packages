// Mutation check for the test suite: applies one deliberate bug at a time to
// esm/_fast.ts (rebuilt to esm/_fast.js) and expects `test/diff.mjs --quick` to fail. The file is
// restored afterwards.
// usage: node tools/mutate.mjs
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT = "esm/_fast.ts";
// TypeScript sources are rebuilt into the JavaScript the tests load
const tsBuild = () => spawnSync(process.execPath, [join(here, "../../tools/ts-build.mjs")], { encoding: "utf8" });

const MUTATIONS = [
  ["buffer.set(data.subarray(end), 0);", "buffer.set(data.subarray(end + 1), 0);"],
  ["  h.length += len;\n  k.load", "  h.length += len + 1;\n  k.load"],
  ["    h.pos = bpos + len;", "    h.pos = bpos + len + (len > 40 ? 1 : 0);"],
  ["const end = len - ((len - dpos) % bl);", "const end = len - ((len - dpos) % bl) - (len > 5000 ? bl : 0);"],
  ["    buffer.set(data.subarray(0, take), bpos);", "    buffer.set(data.subarray(1, take + 1), bpos);"],
  ["  buffer.set(finView(k.bl));", ""],
  ["  out.set(outView(k.ol));", "  out.set(outView(k.ol - 1));"],
  ["W.finish(k.alg, h.pos, bitsLo(length), bitsHi(length));", "W.finish(k.alg, h.pos, bitsLo(length + 1), bitsHi(length));"],
  ["hashBytes(alg, blockLen, data);", "hashBytes(alg, blockLen, data.length > 70000 ? data.subarray(1) : data);"],
  ["if (msg.length * 3 <= CAP) {", "if (msg.length * 3 <= CAP + 300) {"],
  ["m32.set(iv, ST32);\n          W.finish", "m32.set(iv.map((x) => x ^ 1), ST32);\n          W.finish"],
  ["  m8.set(acc, T);", "  m8.set(acc, T);\n  m8[T] ^= 1;"],
  ["  Ti.set(acc.subarray(0, Ti.length));\n  acc.fill(0);\n}\n\n/**", "  Ti.set(acc.subarray(0, Ti.length - 1));\n  acc.fill(0);\n}\n\n/**"],
  ["    const next = Math.min((Math.floor(cnt / per) + 1) * per, total);", "    const next = Math.min((Math.floor(cnt / per) + 2) * per, total);"],
  ["      if (onProgress && (!(cnt % per) || cnt === total)) onProgress(cnt / total);", "      if (onProgress && !(cnt % per)) onProgress(cnt / total);"],
  ["    m[i + 12] = h.Gl; m[i + 13] = h.Gh;", "    m[i + 12] = h.Gh; m[i + 13] = h.Gl;"],
  ["iHash.constructor !== k.ctor || oHash.constructor !== k.ctor", "false"],
  ["esm/_md.js", "if (k !== undefined && this.constructor === k.ctor && fastUpdate(this, data, k))", "if (k !== undefined && fastUpdate(this, data, k))"],
  ["esm/_md.js", "if (k !== undefined && this.constructor === k.ctor && fastDigestInto(this, out, k))", "if (k !== undefined && fastDigestInto(this, out, k))"],
  ["  if (bpos > 0) buffer.set(ioBlock(bl));\n  for", "  if (bpos > 1) buffer.set(ioBlock(bl));\n  for"],
  ["    if (bpos > 0) buffer.set(ioBlock(bl));", "    if (bpos > 1) buffer.set(ioBlock(bl));"],
  ["    m8.set(data, IO + bpos);", "    m8.set(data.subarray(0, len - 1), IO + bpos);"],
  ["    m8.fill(0, IO + end, IO + total);\n    W.blocks", "    W.blocks"],
  ["  for (let i = end; i < total; i++) buffer[i - end] = m8[IO + i];", "  for (let i = end + 1; i < total; i++) buffer[i - end] = m8[IO + i];"],
  ["    for (let i = bpos; i < total; i++) buffer[i] = m8[IO + i];", "    for (let i = bpos + 1; i < total; i++) buffer[i] = m8[IO + i];"],
  ["  for (let i = 0; i < bpos; i++) m8[IO + i] = buffer[i];", "  for (let i = 1; i < bpos; i++) m8[IO + i] = buffer[i];"],
  ["    if (data.length * 3 <= CAP - k.bl) return updateString(h, data, k);", "    if (data.length * 3 <= CAP) return updateString(h, data, k);"],
  ["  return h.blockLen === k.bl && h.outputLen === k.ol && h.padOffset === k.po && h.isLE === k.le;", "  return true;"],
  ["  } else abytes(data);\n  const len", "  }\n  const len"],
];

// an interrupted run leaves the mutated file and this backup behind
const backup = join(here, ".mutate-backup.json");
if (existsSync(backup)) {
  const { rel, text } = JSON.parse(readFileSync(backup, "utf8"));
  writeFileSync(join(here, rel), text);
  unlinkSync(backup);
  tsBuild();
  console.log("restored", rel, "from an interrupted run");
}

let caught = 0;
let file = null, orig = null;
try {
  for (const mu of MUTATIONS) {
    const [rel, a, b] = mu.length === 3 ? mu : [DEFAULT, ...mu];
    file = join(here, rel);
    orig = readFileSync(file, "utf8");
    if (!orig.includes(a)) {
      console.log("NOT FOUND:", JSON.stringify(a));
      continue;
    }
    writeFileSync(backup, JSON.stringify({ rel, text: orig }));
    writeFileSync(file, orig.replace(a, b));
    tsBuild();
    // (a hang counts as caught: the suite did not pass)
    const r = spawnSync(process.execPath, [join(here, "test/diff.mjs"), "--quick"], { encoding: "utf8", timeout: 60000 });
    const last = r.error ? "timeout" : (r.stdout + r.stderr).trim().split("\n").pop();
    writeFileSync(file, orig);
    tsBuild();
    unlinkSync(backup);
    file = null;
    const ok = r.status !== 0;
    if (ok) caught++;
    console.log(ok ? "caught " : "MISSED ", JSON.stringify(b.slice(0, 70)), "->", last.slice(0, 80));
  }
} finally {
  if (file) {
    writeFileSync(file, orig);
    tsBuild();
    if (existsSync(backup)) unlinkSync(backup);
  }
}
console.log(`${caught}/${MUTATIONS.length} mutations caught`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
