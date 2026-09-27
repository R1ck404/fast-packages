// Independent verification corpus: real files from this repo's node_modules and
// Nodepod's pnpm store, sampled deterministically across sizes.
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, "..");
export const dirs = [join(root, "node_modules"), join(root, "../Nodepod/node_modules/.pnpm")].filter(existsSync);

export function walk(dir, filter, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out);
    else if (e.isFile() && filter(e.name)) out.push(p);
  }
  return out;
}

let seed = Number(process.env.SEED || 7);
export const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
export const rint = (n) => Math.floor(rnd() * n);
export const pick = (a) => a[rint(a.length)];

export function allFiles(filter = () => true) {
  const out = [];
  for (const d of dirs) walk(d, filter, out);
  return [...new Set(out)].sort();
}

// deterministic sample of `n` files, stratified by log2(size), max bytes each
export function sample(files, n, maxBytes = 4 << 20) {
  const buckets = new Map();
  for (const f of files) {
    let size;
    try {
      size = statSync(f).size;
    } catch {
      continue;
    }
    if (size > maxBytes) continue;
    const b = size === 0 ? 0 : Math.ceil(Math.log2(size));
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(f);
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const out = [];
  let i = 0;
  while (out.length < n && keys.some((k) => buckets.get(k).length)) {
    const k = keys[i++ % keys.length];
    const arr = buckets.get(k);
    if (!arr.length) continue;
    out.push(arr.splice(rint(arr.length), 1)[0]);
  }
  return out;
}

export const readBytes = (f) => new Uint8Array(readFileSync(f));
export const readText = (f) => readFileSync(f, "utf8");

export function eqBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  return Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
}

// run fn, capture result or error in comparable form
export function capture(fn) {
  try {
    return { ok: true, v: fn() };
  } catch (e) {
    return { ok: false, e: describeErr(e) };
  }
}
export function describeErr(e) {
  if (e === null || typeof e !== "object") return `throw(${typeof e}) ${String(e)}`;
  const keys = Object.keys(e).sort().map((k) => `${k}=${JSON.stringify(e[k])}`);
  return `${e.constructor?.name} ${e.message} {${keys.join(",")}}`;
}

export class Tally {
  constructor(name) {
    this.name = name;
    this.checks = 0;
    this.fails = 0;
    this.first = [];
  }
  ok(cond, what) {
    this.checks++;
    if (!cond) {
      this.fails++;
      if (this.first.length < 15) this.first.push(what);
    }
    return cond;
  }
  report() {
    console.log(`[${this.name}] checks: ${this.checks}  failures: ${this.fails}`);
    for (const f of this.first) console.log("  FAIL:", f);
    return this.fails;
  }
}
