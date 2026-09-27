// pako benchmark. Usage: node bench/pako.bench.mjs <impl>
//   impl: pako (2.1.0, what Nodepod ships) | pako3 | fflate (reference) | fast | prev (snapshot)
import { runSuite } from "./harness.mjs";
import { loadJs, tarballs, randomBytes, jsonText, utf8, read } from "./corpus.mjs";

const impl = process.argv[2] || "pako";

async function loadImpl(name) {
  if (name === "pako") return (await import("pako")).default;
  if (name === "pako3") {
    const p = await import("pako3");
    const opt = (o) => (o && o.to === "string" ? { ...o, toText: true, legacyHash: true } : { ...(o || {}), legacyHash: true });
    return {
      deflate: (d, o) => p.deflate(d, opt(o)),
      deflateRaw: (d, o) => p.deflateRaw(d, opt(o)),
      gzip: (d, o) => p.gzip(d, opt(o)),
      inflate: (d, o) => p.inflate(d, opt(o)),
      inflateRaw: (d, o) => p.inflateRaw(d, opt(o)),
      ungzip: (d, o) => p.ungzip(d, opt(o)),
      Deflate: class extends p.Deflate { constructor(o) { super(opt(o)); } },
      Inflate: class extends p.Inflate { constructor(o) { super(opt(o)); } },
    };
  }
  if (name === "fflate") {
    const f = await import("fflate");
    const td = new TextDecoder();
    return {
      deflate: (d, o) => f.zlibSync(d, { level: o?.level ?? 6 }),
      deflateRaw: (d, o) => f.deflateSync(d, { level: o?.level ?? 6 }),
      gzip: (d, o) => f.gzipSync(d, { level: o?.level ?? 6 }),
      inflate: (d, o) => (o?.to === "string" ? td.decode(f.unzlibSync(d)) : f.unzlibSync(d)),
      inflateRaw: (d) => f.inflateSync(d),
      ungzip: (d) => f.gunzipSync(d),
    };
  }
  if (name === "fast") return (await import("@r1ck404/fast-pako")).default;
  if (name === "prev") return (await import("../.scratch/prev/fast-pako/index.mjs")).default;
  if (name.startsWith("fast:")) return (await import(`../packages/fast-pako/${name.slice(5)}`)).default;
  throw new Error("unknown impl " + name);
}

const pako = await loadImpl(impl);
const ref = (await import("pako")).default; // inputs are always produced by real pako

const js = loadJs();
const reactDev = utf8(js.find((f) => f.name.includes("react-dom-client.dev")).code);
const ts = utf8(js.find((f) => f.name.includes("typescript")).code);
const zod = utf8(js.find((f) => f.name.includes("zod-schemas")).code);
const json1m = utf8(jsonText(1 << 20));
const rnd1m = randomBytes(1 << 20);
const wasm2m = read("esbuild-wasm/esbuild.wasm").subarray(0, 2 << 20);
const tiny = utf8('{"name":"left-pad","version":"1.3.0","main":"index.js","license":"WTFPL"}\n'.repeat(1)); // ~75B
const text1k = zod.subarray(0, 1024);
const text16k = zod.subarray(0, 16384);
const text64k = reactDev.subarray(0, 65536);

const inputs = [
  ["tiny 75B", tiny],
  ["text 1KB", text1k],
  ["text 16KB", text16k],
  ["js 51KB", zod],
  ["js 1MB", reactDev],
  ["json 1MB", json1m],
  ["wasm 2MB", wasm2m],
  ["random 1MB", rnd1m],
  ["js 9MB", ts],
];

const cases = [];

// ---- deflate, default level 6
for (const [n, d] of inputs) cases.push({ name: `deflate L6 ${n}`, bytes: d.length, fn: () => pako.deflate(d) });
// ---- levels (Nodepod's memory-volume uses deflateRaw level 1)
for (const [n, d] of [["text 64KB", text64k], ["js 1MB", reactDev], ["json 1MB", json1m], ["js 9MB", ts]])
  cases.push({ name: `deflateRaw L1 ${n}`, bytes: d.length, fn: () => pako.deflateRaw(d, { level: 1 }) });
for (const [n, d] of [["js 1MB", reactDev], ["wasm 2MB", wasm2m]])
  cases.push({ name: `deflate L9 ${n}`, bytes: d.length, fn: () => pako.deflate(d, { level: 9 }) });
for (const [n, d] of [["js 1MB", reactDev]]) {
  cases.push({ name: `deflate L3 ${n}`, bytes: d.length, fn: () => pako.deflate(d, { level: 3 }) });
  cases.push({ name: `deflate L0 ${n}`, bytes: d.length, fn: () => pako.deflate(d, { level: 0 }) });
  cases.push({ name: `gzip L6 ${n}`, bytes: d.length, fn: () => pako.gzip(d) });
}

// ---- inflate of real-pako-compressed data
for (const [n, d] of inputs) {
  const c = ref.deflate(d);
  cases.push({ name: `inflate ${n}`, bytes: d.length, fn: () => pako.inflate(c) });
}
for (const [n, d] of [["text 64KB", text64k], ["js 1MB", reactDev], ["js 9MB", ts]]) {
  const c = ref.deflateRaw(d, { level: 1 });
  cases.push({ name: `inflateRaw(L1) ${n}`, bytes: d.length, fn: () => pako.inflateRaw(c) });
}
{
  const c = ref.deflate(reactDev, { level: 9 });
  cases.push({ name: `inflate(L9) js 1MB`, bytes: reactDev.length, fn: () => pako.inflate(c) });
  const s = ref.deflate(zod);
  cases.push({ name: `inflate to:string js 51KB`, bytes: zod.length, fn: () => pako.inflate(s, { to: "string" }) });
}

// ---- ungzip npm tarballs (Nodepod's install hot path)
for (const t of tarballs()) {
  const size = ref.ungzip(t.bytes).length;
  cases.push({ name: `ungzip ${t.name}`, bytes: size, fn: () => pako.ungzip(t.bytes) });
}

// ---- streaming classes
if (pako.Inflate) {
  const tgz = tarballs().find((t) => t.name.startsWith("typescript")).bytes;
  const size = ref.ungzip(tgz).length;
  cases.push({
    name: "Inflate stream 16KB pushes (ts tgz)",
    bytes: size,
    fn: () => {
      const inf = new pako.Inflate();
      let total = 0;
      inf.onData = (c) => { total += c.length; };
      inf.onEnd = () => {};
      for (let i = 0; i < tgz.length; i += 16384) inf.push(tgz.subarray(i, i + 16384), i + 16384 >= tgz.length);
      return total;
    },
  });
  cases.push({
    name: "Deflate stream 64KB pushes js 1MB",
    bytes: reactDev.length,
    fn: () => {
      const def = new pako.Deflate({ level: 6 });
      for (let i = 0; i < reactDev.length; i += 65536) def.push(reactDev.subarray(i, i + 65536), i + 65536 >= reactDev.length);
      return def.result;
    },
  });
}

// ---- Nodepod memory-volume packing / reading patterns and small one-shots
{
  // ~128KB group of small files joined (PACK_CHUNK_BYTES), deflateRaw level 1
  const group = utf8(js.filter((f) => !f.name.includes("9MB")).map((f) => f.code.slice(0, 20000)).join("\n")).subarray(0, 128 * 1024);
  cases.push({ name: "deflateRaw L1 group 128KB", bytes: group.length, fn: () => pako.deflateRaw(group, { level: 1 }) });
  const g1 = ref.deflateRaw(group, { level: 1 });
  cases.push({ name: "inflateRaw(L1) group 128KB", bytes: group.length, fn: () => pako.inflateRaw(g1) });
  const g6 = ref.deflateRaw(group);
  cases.push({ name: "inflateRaw(L6) group 128KB", bytes: group.length, fn: () => pako.inflateRaw(g6) });
  // solo file: Deflate({ level: 1, raw: true }) pushed in 256KB pieces
  cases.push({
    name: "Deflate L1 raw 256KB pushes js 1MB",
    bytes: reactDev.length,
    fn: () => {
      const d = new pako.Deflate({ level: 1, raw: true });
      const PIECE = 256 * 1024;
      for (let o = 0; o < reactDev.length; o += PIECE) {
        const e = Math.min(reactDev.length, o + PIECE);
        d.push(reactDev.subarray(o, e), e === reactDev.length);
      }
      return d.result;
    },
  });
  const small = text1k.subarray(0, 300);
  cases.push({ name: "deflateRaw L1 300B", bytes: small.length, fn: () => pako.deflateRaw(small, { level: 1 }) });
  const smallZ = ref.deflateRaw(small, { level: 1 });
  cases.push({ name: "inflateRaw 300B", bytes: small.length, fn: () => pako.inflateRaw(smallZ) });
  const smallG = ref.gzip(small);
  cases.push({ name: "ungzip 300B", bytes: small.length, fn: () => pako.ungzip(smallG) });
  cases.push({ name: "gzip 300B", bytes: small.length, fn: () => pako.gzip(small) });
}

await runSuite(impl, cases, { maxTimeMs: Number(process.env.BENCH_TIME || 1500) });
