import { $, lanes, loadImpl, sizeOf, sampleText, race, fmtBytes, fmtInt, fmtTime, fmtX, onFile, whenIdle, errMessage, h, yieldToUi, tabs } from "../ui.mjs";

const now = () => performance.now();
// the repository's tables use decimal megabytes
const mb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${Math.round(n / 1e3)} KB`);
const clip = (text, max = 12000) => (text.length > max ? `${text.slice(0, max)}\n\n... ${fmtInt(text.length - max)} more characters not shown` : text);

// ---- loading both builds --------------------------------------------------

const [so, sf] = await Promise.all([sizeOf("esbuild", "orig", ["esbuild.wasm"]), sizeOf("esbuild", "fast")]);

let fast = null;
let orig = null;
const fastLoad = { ms: 0, first: 0 };
const origLoad = { ms: 0, first: 0 };
const onOrig = []; // called when esbuild-wasm has loaded

const meter = $("#loads");
function meterRow(cls, name, bytes) {
  const status = h("small", {}, "");
  const val = h("div", { class: "val" }, mb(bytes));
  const fill = h("div", { class: "fill", style: `width:${Math.max(3, (bytes / so.raw) * 100).toFixed(1)}%` });
  meter.append(h("div", { class: `meter-row ${cls}` }, h("div", {}, h("b", {}, name), status), h("div", { class: "track" }, fill), val));
  return status;
}
const origStatus = meterRow("orig", "esbuild-wasm", so.raw);
const fastStatus = meterRow("fast", "fast-esbuild-wasm", sf.raw);
origStatus.textContent = "JavaScript and esbuild.wasm, not loaded";
fastStatus.textContent = "one JavaScript file, loading";

const FIRST = "let a: number = 1";
const fastReady = (async () => {
  const t = now();
  fast = await loadImpl("esbuild", "fast");
  fastLoad.ms = now() - t;
  const t2 = now();
  await fast.transform(FIRST, { loader: "ts" });
  fastLoad.first = now() - t2;
  fastStatus.textContent = `ready in ${fmtTime(fastLoad.ms)}, first transform ${fmtTime(fastLoad.first)}`;
})();

const gates = [];
let origPromise = null;
const GATE_LABEL = `Also load esbuild-wasm for comparison, downloads ${Math.round(so.raw / 1e6)} MB`;
function makeGate(el) {
  const btn = h("button", { class: "btn quiet", type: "button" }, GATE_LABEL);
  const msg = h("span", { class: "note-line", "aria-live": "polite" }, "");
  el.append(btn, msg);
  gates.push({ btn, msg });
  btn.addEventListener("click", loadOrig);
}
function loadOrig() {
  if (origPromise) return origPromise;
  for (const g of gates) {
    g.btn.disabled = true;
    g.msg.textContent = "Downloading and compiling esbuild-wasm";
  }
  origStatus.textContent = "downloading and compiling";
  origPromise = (async () => {
    try {
      const t = now();
      const impl = await loadImpl("esbuild", "orig");
      origLoad.ms = now() - t;
      const t2 = now();
      await impl.transform(FIRST, { loader: "ts" });
      origLoad.first = now() - t2;
      orig = impl;
      const text = `ready in ${fmtTime(origLoad.ms)}, first transform ${fmtTime(origLoad.first)}`;
      origStatus.textContent = text;
      for (const g of gates) {
        g.btn.hidden = true;
        g.msg.textContent = `esbuild-wasm is loaded: ${text}. That download came from this site's server, so on a slower connection the wait is longer.`;
      }
      for (const f of onOrig) f();
    } catch (e) {
      for (const g of gates) g.msg.textContent = `Could not load esbuild-wasm: ${errMessage(e)}`;
      origStatus.textContent = "failed to load";
    }
  })();
  return origPromise;
}
for (const id of ["#gate-try", "#gate-build", "#gate-sweep"]) makeGate($(id));

// ---- shared helpers -------------------------------------------------------

/** time one implementation on its own, in short batches, keeping the best */
async function solo(fn) {
  let out = await fn();
  const s = now();
  out = await fn();
  const one = Math.max(now() - s, 1e-4);
  const n = Math.max(1, Math.ceil(12 / one));
  const rounds = Math.max(2, Math.min(5, Math.floor(1500 / (one * n))));
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t = now();
    for (let i = 0; i < n; i++) await fn();
    best = Math.min(best, (now() - t) / n);
    await yieldToUi();
  }
  return { ms: best, out, rounds };
}

/** show fast-esbuild-wasm's time alone, in the lanes drawn by ui.lanes */
function fastOnly(el, ms) {
  const [lo, lf] = [...el.querySelectorAll(".lane")];
  for (const l of [lo, lf]) l.classList.remove("busy");
  lo.classList.add("idle");
  lo.querySelector(".lane-time").textContent = "-";
  lo.querySelector(".lane-bar").style.width = "0%";
  lf.classList.remove("idle");
  lf.querySelector(".lane-time").textContent = fmtTime(ms);
  lf.querySelector(".lane-bar").style.width = "100%";
  el.querySelector(".verdict").innerHTML = '<span class="badge info">Load esbuild-wasm to race it and compare the outputs</span>';
}

const errorSig = (e) => `error\n${e.message}\n${JSON.stringify(e.errors ?? null)}\n${JSON.stringify(e.warnings ?? null)}`;
const catchToValue = (p) => p.then((r) => r, (e) => ({ __error: e }));

function warningsText(list) {
  if (!list || list.length === 0) return "";
  return list.map((w) => `warning: ${w.text}${w.location ? ` (${w.location.file}:${w.location.line}:${w.location.column})` : ""}`).join("\n");
}

function fillPane(pre, title, label, text, size, isError) {
  pre.classList.toggle("err", isError);
  pre.textContent = clip(text);
  title.textContent = size == null ? label : `${label}, ${size}`;
}

// ---- the transform playground ---------------------------------------------

const TSX = `import { useState } from "react";

interface CounterProps {
  label: string;
  start?: number;
  onChange?: (n: number) => void;
}

export function Counter({ label, start, onChange }: CounterProps) {
  const [n, setN] = useState<number>(start ?? 0);
  const bump = () => {
    setN((v) => v + 1);
    onChange?.(n + 1);
  };
  return (
    <button type="button" onClick={bump}>
      {label}: {n}
    </button>
  );
}
`;

const WARN = `export function isBrowser() {
  return typeof window === "objec";
}

export function isZero(x) {
  return x === -0;
}
`;

const BROKEN = `const answer: number = ;

function greet(name: string {
  return "hello " + name;
}
`;

const SAMPLES = [
  { id: "tsx", label: "TSX component (small, editable)", text: TSX, loader: "tsx" },
  { id: "warn", label: "Code that makes esbuild warn (small)", text: WARN, loader: "js" },
  { id: "broken", label: "A syntax error (small)", text: BROKEN, loader: "ts" },
  { id: "schemas", label: "TypeScript, zod schemas.ts (100 KB)", file: "schemas.ts", loader: "ts" },
  { id: "tsl", label: "JavaScript module, three.tsl (36 KB)", file: "three.tsl.js", loader: "js" },
  { id: "three", label: "JavaScript bundle, three.module (647 KB)", file: "three.module.js", loader: "js" },
  { id: "react", label: "JavaScript, react-dom client (1.1 MB)", file: "react-dom-client.js", loader: "js" },
];
const LOADER_BY_EXT = { ts: "ts", mts: "ts", cts: "ts", tsx: "tsx", jsx: "jsx", js: "js", mjs: "js", cjs: "js", css: "css", json: "json" };

const sampleSelect = $("#sample");
for (const s of SAMPLES) sampleSelect.append(h("option", { value: s.id }, s.label));
const srcBox = $("#src");
const PREVIEW = 3000;
let source = TSX;

function setSource(text) {
  source = text;
  if (text.length <= 24000) {
    srcBox.readOnly = false;
    srcBox.value = text;
    $("#src-note").textContent = "";
  } else {
    srcBox.readOnly = true;
    srcBox.value = `${text.slice(0, PREVIEW)}\n...`;
    $("#src-note").textContent = `Showing the first ${fmtInt(PREVIEW)} of ${fmtInt(text.length)} characters. The whole file is transformed. Pick a small input to edit.`;
  }
}
setSource(TSX);
$("#loader").value = "tsx";

const view = lanes($("#lanes"), { orig: "esbuild-wasm", fast: "fast-esbuild-wasm" });
view.subs(`${mb(so.raw)} with esbuild.wasm`, `${mb(sf.raw)}, no wasm`);

function options() {
  const loader = $("#loader").value;
  const o = { loader, target: $("#target").value, minify: $("#minify").checked, sourcemap: $("#sourcemap").checked };
  const format = $("#format").value;
  if (format && loader !== "css" && loader !== "json") o.format = format;
  return o;
}

function sigOf(res) {
  return res.__error ? errorSig(res.__error) : JSON.stringify(res);
}

function describe(res) {
  if (res.__error) return { text: res.__error.message, size: null, error: true };
  let text = res.code;
  if (res.map) text += `\n// source map, ${fmtInt(res.map.length)} characters\n${res.map.length > 700 ? `${res.map.slice(0, 700)} ...` : res.map}`;
  const w = warningsText(res.warnings);
  if (w) text += `\n\n${w}`;
  return { text, size: `${fmtInt(res.code.length)} characters`, error: false };
}

let running = false;
let queued = false;
async function run() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    do {
      queued = false;
      await runOnce();
    } while (queued);
  } finally {
    running = false;
  }
}

async function runOnce() {
  await fastReady;
  const btn = $("#run");
  btn.disabled = true;
  view.busy("Measuring");
  await yieldToUi();
  try {
    const src = source;
    const o = options();
    const call = (impl) => () => catchToValue(impl.transform(src, o));
    let resO = null;
    let resF;
    let note;
    if (orig) {
      const r = await race(call(orig), call(fast), { rounds: 5, budgetMs: 2600 });
      resO = r.outOrig;
      resF = r.outFast;
      const equal = sigOf(resO) === sigOf(resF);
      view.show({ orig: r.orig, fast: r.fast, equal, detail: resF.__error ? "the error and its messages" : "code, source map and warnings" });
      note = `Best of ${r.rounds} interleaved rounds.`;
    } else {
      const r = await solo(call(fast));
      resF = r.out;
      fastOnly($("#lanes"), r.ms);
      note = `Best of ${r.rounds} rounds. esbuild-wasm is not loaded, so there is nothing to race yet.`;
    }
    const f = describe(resF);
    fillPane($("#out-f"), $("#out-f-h"), "fast-esbuild-wasm output", f.text, f.size, f.error);
    if (resO) {
      const d = describe(resO);
      fillPane($("#out-o"), $("#out-o-h"), "esbuild-wasm output", d.text, d.size, d.error);
    } else {
      fillPane($("#out-o"), $("#out-o-h"), "esbuild-wasm output", "esbuild-wasm is not loaded. Load it above to see its output next to this one.", null, false);
    }
    $("#info").textContent = `${fmtBytes(src.length)} of ${o.loader} in${f.error ? ", a failed call" : `, ${fmtBytes(resF.code.length)} out`}. ${note}`;
  } catch (e) {
    view.error(errMessage(e));
  } finally {
    btn.disabled = false;
  }
}

let typing = 0;
srcBox.addEventListener("input", () => {
  if (srcBox.readOnly) return;
  source = srcBox.value;
  clearTimeout(typing);
  typing = setTimeout(run, 450);
});
$("#run").addEventListener("click", run);
for (const id of ["#loader", "#target", "#format", "#minify", "#sourcemap"]) $(id).addEventListener("change", run);
sampleSelect.addEventListener("change", async () => {
  const s = SAMPLES.find((x) => x.id === sampleSelect.value);
  if (!s) return;
  setSource(s.file ? await sampleText(s.file) : s.text);
  $("#loader").value = s.loader;
  run();
});
onFile($("#file"), (bytes, name) => {
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  let opt = [...sampleSelect.options].find((o) => o.value === "custom");
  if (!opt) {
    opt = h("option", { value: "custom" }, "");
    sampleSelect.append(opt);
  }
  opt.textContent = `${name} (${fmtBytes(bytes.length)})`;
  sampleSelect.value = "custom";
  setSource(new TextDecoder().decode(bytes));
  $("#loader").value = LOADER_BY_EXT[ext] ?? "js";
  run();
});

// ---- build() with a plugin file system ------------------------------------

const SMALL = {
  "src/index.tsx": `import { h, render } from "./jsx";
import { Counter } from "./Counter";
import config from "./config.json";
import { clamp } from "./math";

render(<Counter label={config.label} max={clamp(config.max, 0, 10)} />, "#app");
`,
  "src/Counter.tsx": `import { h, Fragment } from "./jsx";
import { clamp } from "./math";

interface CounterProps {
  label: string;
  max: number;
}

export function Counter({ label, max }: CounterProps) {
  let n = 0;
  const bump = () => {
    n = clamp(n + 1, 0, max);
  };
  return (
    <>
      <button onClick={bump}>{label}</button>
      <span>{n}</span>
    </>
  );
}
`,
  "src/jsx.ts": `export type Child = string | number | object;

export const Fragment = Symbol("Fragment");

export function h(tag: string | Function, props: Record<string, unknown> | null, ...children: Child[]) {
  return { tag, props: props ?? {}, children };
}

export function render(node: unknown, selector: string): void {
  console.log("render", selector, node);
}
`,
  "src/math.ts": `export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// nothing imports this, so the bundle leaves it out
export const unused = (n: number) => n * 2;
`,
  "src/config.json": `{ "label": "Clicks", "max": 5 }
`,
};

function generated(n) {
  const files = { "src/index.ts": `import { run0 } from "./m0";\nconsole.log(run0(1));\n` };
  for (let i = 0; i < n; i++) {
    const deps = [i + 1, i + 7].filter((d) => d < n);
    const imports = deps.map((d) => `import { run${d} } from "./m${d}";\n`).join("");
    const calls = deps.map((d) => ` + run${d}(x + 1)`).join("");
    files[`src/m${i}.ts`] = `${imports}export interface Node${i} {\n  id: number;\n  label: string;\n}\n\nexport function run${i}(x: number): number {\n  const node: Node${i} = { id: x, label: "m${i}" };\n  return node.id + node.label.length${calls};\n}\n`;
  }
  return files;
}

const projects = { small: { files: SMALL, entry: "src/index.tsx", editable: true } };
const projectFor = (key) => (projects[key] ??= { files: generated(Number(key.slice(3))), entry: "src/index.ts", editable: false });

const LOADERS = { ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", json: "json", css: "css" };
const dirname = (p) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
function joinPath(base, rel) {
  const out = base ? base.split("/") : [];
  for (const part of rel.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** A plugin that serves files from memory, counting its calls. */
function memoryFs(files, counts) {
  const tries = ["", ".ts", ".tsx", ".js", ".json", "/index.ts"];
  return {
    name: "memory-fs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        counts.resolve++;
        let p;
        if (args.kind === "entry-point") p = args.path;
        else if (args.path.startsWith(".")) p = joinPath(dirname(args.importer), args.path);
        else return undefined;
        for (const t of tries) if (Object.hasOwn(files, p + t)) return { path: p + t, namespace: "mem" };
        return undefined; // esbuild's own resolver reports it
      });
      build.onLoad({ filter: /.*/, namespace: "mem" }, (args) => {
        counts.load++;
        return { contents: files[args.path], loader: LOADERS[args.path.split(".").pop()] ?? "js" };
      });
    },
  };
}

const bView = lanes($("#b-lanes"), { orig: "esbuild-wasm", fast: "fast-esbuild-wasm" });
bView.subs("build() in its worker", "build() on this page");
let projKey = "small";
let current = "src/index.tsx";
const fileBox = $("#file-src");
const fileTabs = $("#files");

function showTabs() {
  const p = projectFor(projKey);
  $("#editor").hidden = !p.editable;
  if (p.editable) {
    const names = Object.keys(p.files);
    if (!names.includes(current)) current = names[0];
    const t = tabs(fileTabs, names.map((n) => ({ label: n, name: n })), (item) => {
      current = item.name;
      fileBox.value = p.files[current];
      $("#file-name").textContent = current;
    }, names.indexOf(current));
    t.select(names.indexOf(current));
  } else {
    const names = Object.keys(p.files);
    const total = names.reduce((n, k) => n + p.files[k].length, 0);
    $("#b-note").textContent = `${fmtInt(names.length)} generated files, ${fmtBytes(total)} of TypeScript. Each module imports two later ones.`;
  }
  if (p.editable) $("#b-note").textContent = "Edit any file, and both builds run again. Imports of files that are not in the project are left to esbuild's own resolver, which reports them.";
}

function buildSig(res, counts) {
  if (res.__error) return `${errorSig(res.__error)}\n${counts.resolve}/${counts.load}`;
  return `${JSON.stringify({
    files: res.outputFiles.map((f) => [f.path, f.text, f.hash]),
    metafile: res.metafile,
    warnings: res.warnings,
    errors: res.errors,
    mangleCache: res.mangleCache ?? null,
  })}\n${counts.resolve}/${counts.load}`;
}

function describeBuild(res) {
  if (res.__error) return { text: res.__error.message, size: null, error: true };
  const parts = res.outputFiles.map((f) => `// ${f.path}, ${fmtInt(f.text.length)} characters\n${f.text.length > 6000 ? `${f.text.slice(0, 6000)}\n...` : f.text}`);
  const total = res.outputFiles.reduce((n, f) => n + f.contents.length, 0);
  return { text: parts.join("\n"), size: `${fmtBytes(total)} in ${res.outputFiles.length} ${res.outputFiles.length === 1 ? "file" : "files"}`, error: false };
}

let bRunning = false;
let bQueued = false;
async function runBuild() {
  if (bRunning) {
    bQueued = true;
    return;
  }
  bRunning = true;
  try {
    do {
      bQueued = false;
      await runBuildOnce();
    } while (bQueued);
  } finally {
    bRunning = false;
  }
}

async function runBuildOnce() {
  await fastReady;
  const btn = $("#b-run");
  btn.disabled = true;
  bView.busy("Measuring");
  await yieldToUi();
  try {
    const p = projectFor(projKey);
    const files = { ...p.files };
    if ($("#b-broken").checked) files[p.entry] += '\nimport "./does-not-exist";\n';
    const base = {
      entryPoints: [p.entry],
      bundle: true,
      write: false,
      format: $("#b-format").value,
      minify: $("#b-minify").checked,
      sourcemap: $("#b-map").checked,
      outfile: "out.js",
      metafile: true,
      jsx: "transform",
      jsxFactory: "h",
      jsxFragment: "Fragment",
      logLevel: "silent",
    };
    const last = { orig: { resolve: 0, load: 0 }, fast: { resolve: 0, load: 0 } };
    const call = (which, impl) => () => {
      const counts = { resolve: 0, load: 0 };
      last[which] = counts;
      return catchToValue(impl.build({ ...base, plugins: [memoryFs(files, counts)] }));
    };
    let resO = null;
    let resF;
    let note;
    if (orig) {
      const r = await race(call("orig", orig), call("fast", fast), { rounds: 5, budgetMs: 2600 });
      resO = r.outOrig;
      resF = r.outFast;
      const equal = buildSig(resO, last.orig) === buildSig(resF, last.fast);
      bView.show({ orig: r.orig, fast: r.fast, equal, detail: resF.__error ? "the error, its messages and the plugin calls" : "output files, hashes, metafile and plugin calls" });
      note = `Best of ${r.rounds} interleaved rounds.`;
    } else {
      const r = await solo(call("fast", fast));
      resF = r.out;
      fastOnly($("#b-lanes"), r.ms);
      note = `Best of ${r.rounds} rounds. esbuild-wasm is not loaded, so there is nothing to race yet.`;
    }
    const f = describeBuild(resF);
    fillPane($("#b-out-f"), $("#b-f-h"), "fast-esbuild-wasm output", f.text, f.size, f.error);
    if (resO) {
      const d = describeBuild(resO);
      fillPane($("#b-out-o"), $("#b-o-h"), "esbuild-wasm output", d.text, d.size, d.error);
    } else {
      fillPane($("#b-out-o"), $("#b-o-h"), "esbuild-wasm output", "esbuild-wasm is not loaded. Load it above to see its output next to this one.", null, false);
    }
    const c = last.fast;
    const same = !orig || (last.orig.resolve === c.resolve && last.orig.load === c.load);
    $("#b-info").textContent = `${fmtInt(Object.keys(files).length)} files. Each build made ${fmtInt(c.resolve)} onResolve and ${fmtInt(c.load)} onLoad calls${orig ? (same ? ", the same on both sides" : ", and the two sides differ, which should not happen") : ""}. ${note}`;
  } catch (e) {
    bView.error(errMessage(e));
  } finally {
    btn.disabled = false;
  }
}

let bTyping = 0;
fileBox.addEventListener("input", () => {
  projectFor(projKey).files[current] = fileBox.value;
  clearTimeout(bTyping);
  bTyping = setTimeout(runBuild, 450);
});
$("#proj").addEventListener("change", () => {
  projKey = $("#proj").value;
  showTabs();
  runBuild();
});
$("#b-run").addEventListener("click", runBuild);
for (const id of ["#b-format", "#b-minify", "#b-map", "#b-broken"]) $(id).addEventListener("change", runBuild);
showTabs();

// ---- size and nesting sweeps ----------------------------------------------

function generatedTs(bytes) {
  const parts = [];
  let n = 0;
  for (let i = 0; n < bytes; i++) {
    const s = `export interface Row${i} {\n  id: number;\n  name: string;\n  tags?: string[];\n}\n\nexport function make${i}(id: number, name = "row-${i}"): Row${i} {\n  const tags: string[] = [];\n  for (let k = 0; k < id % 4; k++) tags.push(\`t\${k}\`);\n  return { id, name, tags };\n}\n\nexport class Store${i}<T extends Row${i}> {\n  private items: T[] = [];\n  add(item: T): this {\n    this.items.push(item);\n    return this;\n  }\n  find(id: number): T | undefined {\n    return this.items.find((x) => x.id === id);\n  }\n}\n\n`;
    parts.push(s);
    n += s.length;
  }
  return parts.join("");
}
const nested = (d) => `x = ${"[".repeat(d)}${"]".repeat(d)}`;

const sweepOut = $("#sweep-out");
const sweepButtons = [$("#size-run"), $("#depth-run")];
onOrig.push(() => {
  for (const b of sweepButtons) b.disabled = false;
  run();
  runBuild();
});

function drawSweep(title, rows, relative = false) {
  sweepOut.innerHTML = "";
  sweepOut.append(h("div", { class: "sweep-key", html: '<span><i></i>esbuild-wasm</span><span><i class="f"></i>fast-esbuild-wasm</span>' }));
  const els = rows.map((r) => {
    const bo = h("i", { style: "width:0" });
    const bf = h("i", { class: "f", style: "width:0" });
    const x = h("span", { class: "sweep-x" }, "");
    sweepOut.append(h("div", { class: "sweep-row" }, h("span", { class: "nm" }, r.label), h("div", { class: "sweep-bars" }, bo, bf), x));
    return { bo, bf, x };
  });
  const note = h("p", { class: "sweep-note" }, title);
  sweepOut.append(note);
  return {
    els,
    note,
    update(results) {
      let maxT = 0;
      for (const r of results) {
        if (!r) continue;
        maxT = Math.max(maxT, Number.isFinite(r.orig) ? r.orig : 0, r.fast);
      }
      results.forEach((r, i) => {
        if (!r) return;
        const e = els[i];
        e.bo.style.width = Number.isFinite(r.orig) ? `${relative ? 100 : (r.orig / maxT) * 100}%` : "0";
        e.bo.style.visibility = Number.isFinite(r.orig) ? "visible" : "hidden";
        e.bf.style.width = `${relative && Number.isFinite(r.orig) ? (r.fast / r.orig) * 100 : (r.fast / maxT) * 100}%`;
        e.bo.title = Number.isFinite(r.orig) ? `esbuild-wasm ${fmtTime(r.orig)}` : "";
        e.bf.title = `fast-esbuild-wasm ${fmtTime(r.fast)}`;
        e.x.classList.toggle("slower", Number.isFinite(r.orig) && r.orig < r.fast);
        e.x.textContent = r.text ?? `${fmtX(r.orig / r.fast)}x`;
        if (Number.isFinite(r.orig) && r.orig < r.fast) e.x.title = `${(r.fast / r.orig).toFixed(1)}x slower than esbuild-wasm`;
      });
    },
  };
}

async function sweep(kind) {
  for (const b of sweepButtons) b.disabled = true;
  try {
    const opts = { loader: kind === "size" ? "ts" : "js" };
    const items =
      kind === "size"
        ? [1, 4, 16, 64, 256, 1024].map((kb) => ({ label: kb === 1024 ? "1 MB" : `${kb} KB`, make: () => generatedTs(kb * 1024) }))
        : [
            ...[100, 700, 1500].map((d) => ({ label: fmtInt(d), depth: d, make: () => nested(d) })),
            ...[5000, 20000, 50000].map((d) => ({ label: fmtInt(d), depth: d, make: () => nested(d), fastOnly: true })),
          ];
    const rows = items;
    const sw = drawSweep(
      kind === "size" ? "Generated TypeScript, target esnext. Each bar pair is scaled to esbuild-wasm's time for that size. Inputs up to 64 KB can run in the page, larger ones go to the engine's worker." : "Arrays nested that many levels deep. The last three rows run only fast-esbuild-wasm: esbuild-wasm can fail on input nested this deeply, so it is not run here.",
      rows,
      kind === "size",
    );
    const results = new Array(rows.length).fill(null);
    for (let i = 0; i < rows.length; i++) {
      const input = rows[i].make();
      if (rows[i].fastOnly) {
        const r = await solo(() => fast.transform(input, opts));
        results[i] = { orig: NaN, fast: r.ms, text: "fast only" };
      } else {
        const r = await race(() => catchToValue(orig.transform(input, opts)), () => catchToValue(fast.transform(input, opts)), { rounds: 3, budgetMs: 900 });
        const a = r.outOrig.__error ? errorSig(r.outOrig.__error) : r.outOrig.code;
        const b = r.outFast.__error ? errorSig(r.outFast.__error) : r.outFast.code;
        results[i] = { orig: r.orig, fast: r.fast, text: a === b ? undefined : "differs" };
      }
      sw.update(results);
      await yieldToUi();
    }
    if (kind === "depth") {
      const perLevel = rows.map((row, i) => `${((results[i].fast / row.depth) * 1000).toFixed(2)} µs at ${row.label}`);
      sw.note.textContent += ` Time per nesting level in fast-esbuild-wasm: ${perLevel.join(", ")}.`;
    }
  } catch (e) {
    sweepOut.append(h("p", { class: "note-line err" }, errMessage(e)));
  } finally {
    for (const b of sweepButtons) b.disabled = false;
  }
}
$("#size-run").addEventListener("click", () => sweep("size"));
$("#depth-run").addEventListener("click", () => sweep("depth"));

whenIdle(async () => {
  await run();
  await runBuild();
});
