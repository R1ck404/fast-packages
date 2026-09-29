import { $, lanes, loadImpl, sizeOf, sample, sampleText, race, bytesEqual, fmtBytes, fmtTime, fmtInt, tabs, whenIdle, errMessage, yieldToUi } from "../ui.mjs";

// Each task: which packages it loads, the input, the two calls and how to compare their output.
const tasks = [
  {
    label: "Unzip",
    slug: "pako",
    names: { orig: "pako 2.1.0", fast: "fast-pako" },
    async prepare(o, f) {
      const raw = await sample("react-dom-client.js");
      const gz = o.gzip(raw);
      return {
        runO: () => o.ungzip(gz),
        runF: () => f.ungzip(gz),
        equal: (a, b) => bytesEqual(a, b),
        info: `Unzipping ${fmtBytes(gz.length)} of gzip into ${fmtBytes(raw.length)} of JavaScript.`,
        detail: (out) => `${fmtInt(out.length)} bytes`,
      };
    },
  },
  {
    label: "Parse JavaScript",
    slug: "acorn",
    names: { orig: "acorn 8.18.0", fast: "fast-acorn" },
    async prepare(o, f) {
      const text = await sampleText("three.module.js");
      const opts = { ecmaVersion: "latest", sourceType: "module" };
      return {
        runO: () => o.parse(text, opts),
        runF: () => f.parse(text, opts),
        equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        info: `Parsing three.module.js (${fmtBytes(text.length)}) into a syntax tree.`,
        detail: (ast) => `${fmtInt(ast.body.length)} top-level statements`,
      };
    },
  },
  {
    label: "Find imports",
    slug: "es-module-lexer",
    names: { orig: "es-module-lexer 1.7.0", fast: "fast-es-module-lexer" },
    async prepare(o, f) {
      const text = await sampleText("three.module.js");
      return {
        runO: () => o.parse(text),
        runF: () => f.parse(text),
        equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        info: `Scanning three.module.js (${fmtBytes(text.length)}) for its imports and exports.`,
        detail: (r) => `${r[0].length} imports, ${r[1].length} exports`,
      };
    },
  },
  {
    label: "Checksum",
    slug: "noble-hashes",
    names: { orig: "@noble/hashes 1.8.0", fast: "fast-noble-hashes" },
    async prepare(o, f) {
      const raw = await sample("react-dom-client.js");
      return {
        runO: () => o.sha512(raw),
        runF: () => f.sha512(raw),
        equal: (a, b) => bytesEqual(a, b),
        info: `SHA-512 of ${fmtBytes(raw.length)}, the checksum npm lockfiles record for every tarball.`,
        detail: (d) => `${d.length * 8}-bit digest`,
      };
    },
  },
  {
    label: "Brotli, quality 11",
    slug: "brotli",
    names: { orig: "brotli-wasm 3.0.1", fast: "fast-brotli-wasm" },
    async prepare(o, f) {
      const raw = await sample("three.tsl.js");
      return {
        runO: () => o.compress(raw),
        runF: () => f.compress(raw),
        equal: (a, b) => bytesEqual(a, b),
        info: `Compressing ${fmtBytes(raw.length)} at quality 11, the default when you pass no options.`,
        detail: (out) => `${fmtInt(out.length)} bytes`,
      };
    },
  },
];

let current = 0;
let running = false;

async function run(i = current) {
  if (running) return;
  running = true;
  const task = tasks[i];
  const view = lanes($("#race-lanes"), task.names);
  const btn = $("#race-run");
  btn.disabled = true;
  $("#race-info").textContent = "";
  view.busy("Loading");
  try {
    const [o, f] = await Promise.all([loadImpl(task.slug, "orig"), loadImpl(task.slug, "fast")]);
    const wasm = task.slug === "brotli" ? { orig: ["brotli_wasm_bg.wasm"], fast: ["fastbrotli.wasm"] } : { orig: [], fast: [] };
    const [so, sf] = await Promise.all([sizeOf(task.slug, "orig", wasm.orig), sizeOf(task.slug, "fast", wasm.fast)]);
    view.subs(`${fmtBytes(so.raw)} to download`, `${fmtBytes(sf.raw)} to download`);
    const job = await task.prepare(o, f);
    view.busy("Measuring");
    await yieldToUi();
    const r = await race(job.runO, job.runF, { rounds: 5, budgetMs: 2500 });
    const equal = job.equal(r.outOrig, r.outFast);
    // replay the two measured times at a common, slower speed so the race can be seen
    const replay = 2400 / Math.max(r.orig, r.fast);
    view.show({ orig: r.orig, fast: r.fast, equal, detail: job.detail(r.outFast), replay });
    $("#race-info").innerHTML = `${job.info} Bars replay the measured times about ${fmtInt(Math.round(replay))} times slower.`;
  } catch (e) {
    view.error(errMessage(e));
  } finally {
    btn.disabled = false;
    running = false;
    if (current !== i) run(current); // a tab was picked while this one was running
  }
}

const tabView = tabs($("#race-tabs"), tasks, (_, i) => {
  current = i;
  run(i);
});
$("#race-run").addEventListener("click", () => run());
whenIdle(() => run(0));
void tabView;
