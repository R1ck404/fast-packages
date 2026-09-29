import { $, lanes, loadImpl, sampleText, race, fmtBytes, fmtInt, fmtTime, onFile, whenIdle, errMessage, h, yieldToUi, root } from "../ui.mjs";

const SLUG = "es-module-lexer";
const KIND = [null, "static import", "dynamic import", "import.meta", "static source import", "dynamic source import", "static defer import", "dynamic defer import"];

// ---- calling both libraries the same way -----------------------------------

// undefined is written out, so a missing key and a key holding undefined differ
const stringify = (v) => JSON.stringify(v, (_k, x) => (x === undefined ? "<undefined>" : x));

/** parse(src) as { res } or { err }, with a text that is equal exactly when the answers are */
function answer(p, src) {
  try {
    const res = p.parse(src);
    return { res, text: stringify(res) };
  } catch (e) {
    const idx = e && typeof e === "object" && "idx" in e ? ` (idx ${e.idx})` : "";
    return { err: e, text: `throws ${e?.constructor?.name}: ${e?.message}${idx}` };
  }
}

/** a short description of a result: what was found, and optionally where */
function describe(a, positions = false) {
  if (a.err) return a.text;
  const [imports, exports, facade, moduleSyntax] = a.res;
  const parts = [];
  for (const i of imports) {
    const where = positions ? ` at ${i.s}-${i.e}` : "";
    if (i.t === 3) parts.push(`import.meta${where}`);
    else parts.push(`${KIND[i.t] ?? `import of type ${i.t}`} ${i.n === undefined ? "(expression)" : JSON.stringify(i.n)}${where}`);
  }
  for (const e of exports) parts.push(`export ${JSON.stringify(e.n)}${positions ? ` at ${e.s}-${e.e}` : ""}`);
  if (!parts.length) parts.push("no imports or exports");
  return `${parts.join("; ")}; facade ${facade}, module syntax ${moduleSyntax}`;
}

const rate = (chars, ms) => {
  const perSecond = chars / ms / 1000; // million characters a second
  return perSecond >= 1000 ? `${(perSecond / 1000).toFixed(1)} billion characters a second` : `${Math.round(perSecond)} million characters a second`;
};

async function bestOf(fn, { rounds = 4, batchMs = 10 } = {}) {
  fn();
  const t0 = performance.now();
  fn();
  const one = Math.max(performance.now() - t0, 1e-4);
  const n = Math.max(1, Math.ceil(batchMs / one));
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const s = performance.now();
    for (let i = 0; i < n; i++) fn();
    best = Math.min(best, (performance.now() - s) / n);
    await yieldToUi();
  }
  return best;
}

// ---- loading ---------------------------------------------------------------

const view = lanes($("#lanes"), { orig: "es-module-lexer 1.7.0", fast: "fast-es-module-lexer", origSub: "C, compiled to wasm", fastSub: "Rust, wasm with SIMD" });

let orig = null;
let fast = null;
try {
  [orig, fast] = await Promise.all([loadImpl(SLUG, "orig"), loadImpl(SLUG, "fast")]);
} catch (e) {
  view.error(`Could not load the libraries: ${errMessage(e)}. The fast build needs WebAssembly with SIMD.`);
  for (const b of document.querySelectorAll("button.btn, .file-btn input, #s-input, #input")) b.disabled = true;
}

if (orig && fast) start();

function start() {
  // ---- a batch of modules, like a dev server sees ---------------------------

  const IMPORTS = [
    (i) => `import def${i} from "./mod${i}.js";`,
    (i) => `import * as ns${i} from '../util/helpers${i}.mjs';`,
    (i) => `import { alpha${i}, beta${i} as b${i}, gamma${i} } from "pkg-${i}";`,
    (i) => `import "./side-effect-${i}.js";`,
    (i) => `import main${i}, { extra${i} } from 'lib-${i}/index.js';`,
    (i) => `import json${i} from "./data${i}.json" with { type: "json" };`,
  ];
  const EXPORTS = [
    (i) => `export const value${i} = ${i};`,
    (i) => `export { helper${i}, other${i} as default };`,
    (i) => `export * from "./re-export-${i}.js";`,
    (i) => `export { thing${i} as renamed${i} } from './thing${i}.js';`,
    (i) => `export * as tools${i} from "./tools${i}.js";`,
    (i) => `export function run${i}(a, b) { return a / b; }`,
  ];
  const EXTRAS = [
    (i) => `const lazy${i} = () => import("./lazy-${i}.js");`,
    (i) => `const url${i} = new URL("./asset-${i}.png", import.meta.url);`,
    (i) => `const dyn${i} = (name) => import(\`./locale/\${name}-${i}.js\`);`,
  ];

  function rng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** modules of 0.4-2.3 KB: generated imports and exports around a piece of real code */
  function makeBatch(text, count = 300) {
    // pieces cut where a top-level declaration starts after a blank line
    const bodies = text.split(/\n\n(?=[^\s}\])])/).filter((p) => p.length >= 250 && p.length <= 2200);
    const rand = rng(20240607);
    const some = (list, n) => {
      const pool = list.slice();
      const out = [];
      while (n-- > 0 && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      return out;
    };
    const mods = [];
    for (let i = 0; mods.length < count && i < count * 4; i++) {
      const head = some(IMPORTS, 1 + Math.floor(rand() * 4)).map((f) => f(i));
      const tail = some(EXPORTS, 1 + Math.floor(rand() * 3)).map((f) => f(i));
      if (rand() < 0.4) tail.push(some(EXTRAS, 1)[0](i));
      const body = bodies[Math.floor(rand() * bodies.length)];
      const src = `${head.join("\n")}\n\n${body}\n\n${tail.join("\n")}\n`;
      try {
        orig.parse(src); // keep the pieces that cut cleanly
        mods.push(src);
      } catch {}
    }
    return mods;
  }

  let batch = null;
  const getBatch = async () => (batch ??= makeBatch(await sampleText("three.module.js")));

  // ---- the race ---------------------------------------------------------------

  const SAMPLES = [
    { id: "batch", label: "Batch of 300 modules (0.4-2.3 KB each)" },
    { id: "debounce.js", label: "6 KB module (lodash debounce)" },
    { id: "three.tsl.js", label: "37 KB module (three.tsl)" },
    { id: "three.module.js", label: "660 KB bundle (three.module)" },
    { id: "react-dom-client.js", label: "1.2 MB bundle (react-dom)" },
    { id: "schemas.ts", label: "100 KB TypeScript (zod schemas)" },
  ];
  const select = $("#input");
  for (const s of SAMPLES) select.append(h("option", { value: s.id }, s.label));
  select.value = "three.module.js";
  let custom = null; // { name, text }

  async function source() {
    if (custom) return { mods: [custom.text], what: `${custom.name}, ${fmtBytes(custom.text.length)}` };
    if (select.value === "batch") {
      const mods = await getBatch();
      const total = mods.reduce((n, m) => n + m.length, 0);
      return { mods, what: `${mods.length} modules, ${fmtBytes(total)} in all` };
    }
    const text = await sampleText(select.value);
    return { mods: [text], what: `${fmtBytes(text.length)} of source` };
  }

  async function run() {
    const btn = $("#run");
    btn.disabled = true;
    view.busy("Measuring");
    await yieldToUi();
    try {
      const { mods, what } = await source();
      const lexAll = (p) => () => {
        for (let i = 0; i < mods.length; i++) {
          try {
            p.parse(mods[i]);
          } catch {}
        }
      };
      const r = await race(lexAll(orig), lexAll(fast), { rounds: 5, budgetMs: 2600 });

      // the same answers? whole results, positions included, or the same error
      let equal = true;
      let imports = 0;
      let exports = 0;
      let errors = 0;
      let chars = 0;
      for (const m of mods) {
        chars += m.length;
        const a = answer(orig, m);
        const b = answer(fast, m);
        if (a.text !== b.text) equal = false;
        if (b.res) {
          imports += b.res[0].length;
          exports += b.res[1].length;
        } else errors++;
      }
      const detail =
        errors === mods.length
          ? `both throw ${mods.length === 1 ? "the same parse error" : "the same parse errors"}`
          : `${fmtInt(imports)} imports, ${fmtInt(exports)} exports${errors ? `, ${errors} parse ${errors === 1 ? "error" : "errors"}` : ""}`;
      view.show({ orig: r.orig, fast: r.fast, equal, detail });

      // how much of the original's time is its copy loop
      const maxLen = mods.reduce((n, m) => Math.max(n, m.length), 0);
      const units = new Uint16Array(maxLen + 1);
      const copyMs = await bestOf(() => {
        for (const s of mods) {
          const n = s.length;
          let i = 0;
          while (i < n) units[i] = s.charCodeAt(i++);
        }
      });
      const copyNote = copyMs < r.orig ? ` Copying the text into wasm memory with a copy of the original's <code>charCodeAt</code> loop takes about ${fmtTime(copyMs)} of its ${fmtTime(r.orig)}.` : "";
      $("#info").innerHTML = `${what}. Best of ${r.rounds} interleaved rounds. ${rate(chars, r.orig)} for es-module-lexer, ${rate(chars, r.fast)} for fast-es-module-lexer.${copyNote}`;
    } catch (e) {
      view.error(errMessage(e));
    } finally {
      btn.disabled = false;
    }
  }

  $("#run").addEventListener("click", run);
  select.addEventListener("change", () => {
    custom = null;
    run();
  });
  onFile($("#file"), (bytes, name) => {
    custom = { name, text: new TextDecoder().decode(bytes) };
    if (![...select.options].some((o) => o.value === "custom")) select.append(h("option", { value: "custom" }, ""));
    const opt = [...select.options].find((o) => o.value === "custom");
    opt.textContent = `${name} (${fmtBytes(bytes.length)})`;
    select.value = "custom";
    run();
  });
  whenIdle(run);

  // ---- where the scanner stops -------------------------------------------------

  // The tables of the main loop's classifier, from rust/src/lib.rs (LO1, HI1, LO2, HI2).
  // class(byte) = LO[low nibble] & HI[high nibble]; the character is a stop point when
  // class1(char) & class2(next char) is not zero. Bits 6 and 7 of class1 mark whitespace
  // and are never in class2, so whitespace is not a stop point.
  const LO1 = [0x84, 0, 0x01, 0x20, 0, 0x08, 0, 0x01, 0x01, 0x51, 0x40, 0x42, 0x40, 0x42, 0, 0x01];
  const HI1 = [0x40, 0, 0x81, 0, 0, 0, 0x3c, 0x02, 0, 0, 0, 0, 0, 0, 0, 0];
  const LO2 = [0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x0f, 0x07, 0x07, 0x07, 0x27, 0x17, 0x07, 0x07];
  const HI2 = [0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x37, 0x0f, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07];
  const C1 = new Uint8Array(256);
  const C2 = new Uint8Array(256);
  for (let b = 0; b < 256; b++) {
    C1[b] = LO1[b & 15] & HI1[b >> 4];
    C2[b] = LO2[b & 15] & HI2[b >> 4];
  }

  const KINDS = ["quotes and backticks", "parentheses", "braces", "slashes", "starts of ex, im or cl"];
  const kindOf = (c) => (c === 34 || c === 39 || c === 96 ? 0 : c === 40 || c === 41 ? 1 : c === 123 || c === 125 ? 2 : c === 47 ? 3 : 4);

  /**
   * Run the classifier over text (one byte per UTF-16 unit, units above 0xff as 0xff, the
   * chars past the end as NUL, as in the lexer). onFlag(i, kind) is called for i < limit.
   */
  function scan(text, limit = 0, onFlag = null) {
    const n = text.length;
    const counts = [0, 0, 0, 0, 0];
    let flagged = 0;
    let emptyBlocks = 0;
    let inBlock = 0;
    for (let i = 0; i < n; i++) {
      let c = text.charCodeAt(i);
      if (c > 255) c = 255;
      if (C1[c] & 0x3f) {
        let d = i + 1 < n ? text.charCodeAt(i + 1) : 0;
        if (d > 255) d = 255;
        if (C1[c] & C2[d]) {
          const k = kindOf(c);
          counts[k]++;
          flagged++;
          inBlock++;
          if (onFlag && i < limit) onFlag(i, k);
        }
      }
      if ((i & 63) === 63 || i === n - 1) {
        if (inBlock === 0) emptyBlocks++;
        inBlock = 0;
      }
    }
    return { n, counts, flagged, blocks: Math.ceil(n / 64), emptyBlocks };
  }

  const EXAMPLE = `import def, { named as alias } from "./mod.js";
import * as ns from './ns.js' // not an import: import 'nope'

/* export const gone = 1; */
export const answer = 6 * 7;
export { alias as renamed };

const text = \`template \${def("import 'nope'")} end\`;
const share = total / count / 2;
const lazy = () => import("./lazy.js");
console.log(import.meta.url, /import 'x'/g.test(text));

export default class Thing {
  method() { return { a: [1, 2] }; }
}
`;

  const sSelect = $("#s-input");
  const sText = $("#s-text");
  const SS = [
    { id: "example", label: "A short example" },
    { id: "debounce.js", label: "debounce.js (6 KB)" },
    { id: "three.tsl.js", label: "three.tsl.js (37 KB)" },
    { id: "three.module.js", label: "three.module.js (660 KB)" },
    { id: "react-dom-client.js", label: "react-dom-client.js (1.2 MB)" },
    { id: "schemas.ts", label: "schemas.ts (100 KB TypeScript)" },
  ];
  for (const s of SS) sSelect.append(h("option", { value: s.id }, s.label));
  sText.value = EXAMPLE;

  const SHOW = 4000;
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(a / b >= 0.1 || a === 0 ? 1 : 2)}%` : "0%");

  function meterRow(label, fraction, value, cls) {
    return h("div", { class: `meter-row ${cls}` },
      h("span", {}, label),
      h("div", { class: "track" }, h("div", { class: "fill", style: `width:${Math.max(0.5, fraction * 100).toFixed(2)}%` })),
      h("span", { class: "val" }, value));
  }

  function renderStops(text) {
    const list = [];
    const s = scan(text, SHOW, (i, k) => list.push([i, k]));
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const [i, k] of list) {
      if (i > last) frag.append(text.slice(last, i));
      const ch = text[i];
      const title = k === 4 ? `"${ch}" followed by "${text[i + 1]}"` : `"${ch}"`;
      frag.append(h("mark", { class: k === 4 ? "cand" : "", title }, ch));
      last = i + 1;
    }
    frag.append(text.slice(last, Math.min(text.length, SHOW)));
    const pre = $("#s-view");
    pre.replaceChildren(text ? frag : document.createTextNode("Type or paste code above."));
    $("#s-note").textContent = text.length > SHOW ? `Showing the first ${fmtInt(SHOW)} of ${fmtInt(text.length)} characters. The numbers below cover all of it.` : "";

    const meter = $("#s-meter");
    meter.replaceChildren();
    if (s.n) {
      meter.append(
        meterRow("Stop points", s.flagged / s.n, pct(s.flagged, s.n), "fast"),
        meterRow("Every other character", 1 - s.flagged / s.n, pct(s.n - s.flagged, s.n), ""),
        meterRow("Blocks with no stop point", s.emptyBlocks / s.blocks, pct(s.emptyBlocks, s.blocks), "fast"),
      );
    }
    const kinds = s.counts.map((c, i) => `${fmtInt(c)} ${KINDS[i]}`).join(", ");
    $("#s-counts").textContent = s.n
      ? `${fmtInt(s.n)} characters in ${fmtInt(s.blocks)} blocks of 64. ${fmtInt(s.flagged)} are flagged as stop points: ${kinds}. The remaining ${fmtInt(s.n - s.flagged)} are never a stop.${s.emptyBlocks ? ` The ${fmtInt(s.emptyBlocks)} blocks with no flag are crossed in one pass of the classifier.` : ""}`
      : "";
  }

  const clip = (t, n) => {
    const one = t.replace(/\s+/g, " ").trim();
    return one.length > n ? `${one.slice(0, n)}...` : one;
  };

  function renderFound(text) {
    const a = answer(orig, text);
    const b = answer(fast, text);
    const tbody = $("#s-found tbody");
    tbody.replaceChildren();
    const same = a.text === b.text;
    const verdict = $("#s-verdict");
    if (!same) {
      verdict.innerHTML = '<span class="badge bad">The two libraries answered differently</span>';
      $("#s-found-note").textContent = `es-module-lexer: ${clip(a.text, 200)}. fast-es-module-lexer: ${clip(b.text, 200)}. For broken code the original's answer can depend on what it lexed earlier; see the panel on broken input further down.`;
      return;
    }
    if (b.err) {
      verdict.innerHTML = '<span class="badge ok">Both throw the same error</span>';
      $("#s-found-note").textContent = `${b.err.message}${"idx" in b.err ? ` (idx ${b.err.idx})` : ""}. The lexer stops with a parse error on code it cannot balance or terminate.`;
      return;
    }
    const [imports, exports, facade, moduleSyntax] = b.res;
    verdict.innerHTML = `<span class="badge ok">es-module-lexer returns the identical result: ${fmtInt(imports.length)} imports, ${fmtInt(exports.length)} exports, every position equal</span>`;
    const CAP = 40;
    for (const i of imports.slice(0, CAP)) {
      const isMeta = i.t === 3;
      const stmt = i.se >= i.ss && i.ss >= 0 ? clip(text.slice(i.ss, i.se), 90) : "";
      tbody.append(
        h("tr", {},
          h("td", {}, KIND[i.t] ?? `type ${i.t}`),
          h("td", {}, isMeta ? "-" : i.n === undefined ? "(not a string literal)" : h("code", {}, i.n)),
          h("td", { class: "num" }, `${i.s}-${i.e}`),
          h("td", { class: "stmt" }, h("code", {}, stmt))),
      );
    }
    for (const e of exports.slice(0, CAP)) {
      tbody.append(
        h("tr", {},
          h("td", {}, "export"),
          h("td", {}, h("code", {}, e.n), e.ln !== undefined && e.ln !== e.n ? ` (local name ${e.ln})` : ""),
          h("td", { class: "num" }, `${e.s}-${e.e}`),
          h("td", {}, "")),
      );
    }
    const more = [];
    if (imports.length > CAP) more.push(`the first ${CAP} of ${fmtInt(imports.length)} imports`);
    if (exports.length > CAP) more.push(`the first ${CAP} of ${fmtInt(exports.length)} exports`);
    $("#s-found-note").textContent = `${more.length ? `Showing ${more.join(" and ")}. ` : ""}Also returned: facade ${facade}, hasModuleSyntax ${moduleSyntax}.${imports.length + exports.length ? "" : " No imports or exports found."}`;
  }

  function analyze() {
    const text = sText.value;
    renderStops(text);
    renderFound(text);
  }

  let timer = 0;
  sText.addEventListener("input", () => {
    if (![...sSelect.options].some((o) => o.value === "custom")) sSelect.append(h("option", { value: "custom" }, "Your text"));
    sSelect.value = "custom";
    clearTimeout(timer);
    timer = setTimeout(analyze, 150);
  });
  sSelect.addEventListener("change", async () => {
    const id = sSelect.value;
    if (id === "custom") return;
    sText.value = id === "example" ? EXAMPLE : await sampleText(id);
    analyze();
  });
  onFile($("#s-file"), (bytes, name) => {
    sText.value = new TextDecoder().decode(bytes);
    if (![...sSelect.options].some((o) => o.value === "custom")) sSelect.append(h("option", { value: "custom" }, ""));
    const opt = [...sSelect.options].find((o) => o.value === "custom");
    opt.textContent = `${name} (${fmtBytes(bytes.length)})`;
    sSelect.value = "custom";
    analyze();
  });
  analyze();

  (async () => {
    const tbody = $("#s-files tbody");
    for (const s of SS.slice(1)) {
      const text = await sampleText(s.id);
      const r = scan(text);
      tbody.append(
        h("tr", {},
          h("td", {}, h("code", {}, s.id)),
          h("td", { class: "num" }, fmtInt(r.n)),
          h("td", { class: "num" }, fmtInt(r.flagged)),
          h("td", { class: "num" }, pct(r.flagged, r.n)),
          h("td", { class: "num" }, `${pct(r.emptyBlocks, r.blocks)} of ${fmtInt(r.blocks)}`)),
      );
      await yieldToUi();
    }
  })();

  // ---- odd inputs -----------------------------------------------------------------

  const deep = "(".repeat(1500) + ")".repeat(1500) + "; import 'a'";
  const cases = [
    { label: "Static imports", src: "import a from './a.js';\nimport { b as c, d } from \"./b.js\";\nimport * as e from './e.js';\nimport './side.js';" },
    { label: "Dynamic imports and import.meta", src: "const a = await import('./a.js');\nconst b = import(name);\nconst c = import(`./x-${n}.js`, { with: { type: 'json' } });\nconsole.log(import.meta.url);" },
    { label: "Import-like text in comments and strings", src: "// import x from 'nope'\n/* export const y = 1 */\nconst s = \"import z from 'nope'\";\nimport real from './real.js';" },
    { label: "Template literals with nested code", src: "const t = `a ${ `b ${ import('./x.js') } c` } d`;\nexport { t };" },
    { label: "Division or regular expression", src: "const r = a / b / c;\nconst re = /import 'nope'/g;\nlet x = y++ / 2;\nimport 'yes';" },
    { label: "String names in exports and imports", src: "export { a as \"b c\", d as 'e' };\nimport { \"f g\" as h } from './m.js';" },
    { label: "Escapes in specifiers", src: "import x from 'mod\\u1011';\nimport y from \"a\\x62c\";" },
    { label: "Every export form", src: "export * from './a.js';\nexport * as ns from './b.js';\nexport { c } from './c.js';\nexport default function () {}\nexport const d = 1, e = 2;\nexport class F {}" },
    { label: "Import attributes and phases", src: "import json from './data.json' with { type: 'json' };\nimport source wasm from './mod.wasm';\nimport defer * as lazy from './lazy.js';\nimport.source('./mod.wasm');" },
    { label: "Non-ASCII text before the imports", src: "const s = \"héllo wörld 😀 日本語\";\nimport x from './é.js';\nexport const 日本 = 1;" },
    { label: "A CommonJS file", src: "const fs = require('fs');\nmodule.exports = { fs };" },
    { label: "Unterminated string", src: "import a from './a.js';\nconst s = 'oops;\n" },
    { label: "Unclosed braces", src: "function f() {\n  if (x) {\n    import('./a.js');\n}" },
    { label: "Closing bracket with no opening one", src: "import 'a';\n})" },
    { label: "Not a string", show: "parse(undefined)", src: undefined },
    { label: "1,500 nested parentheses, then an import", show: "\"(\".repeat(1500) + \")\".repeat(1500) + \"; import 'a'\"", src: deep, known: true },
  ];

  $("#odd-run").addEventListener("click", () => {
    const tbody = $("#odd-table tbody");
    tbody.replaceChildren();
    let same = 0;
    let known = 0;
    let unexpected = 0;
    for (const c of cases) {
      const a = answer(orig, c.src);
      const b = answer(fast, c.src);
      const ok = a.text === b.text;
      if (ok) same++;
      else if (c.known) known++;
      else unexpected++;
      tbody.append(
        h("tr", {},
          h("td", { class: "stmt" }, h("b", {}, c.label), h("br"), h("code", { class: "src" }, c.show ?? clip(c.src, 400).slice(0, 160))),
          h("td", { class: "wrap" }, clip(describe(a), 300)),
          h("td", { class: "wrap" }, clip(describe(b), 300)),
          h("td", { class: ok ? "same" : c.known ? "differs" : "bad" }, ok ? "Same" : c.known ? "Differs" : "Differs")),
      );
    }
    const good = unexpected === 0;
    $("#odd-verdict").innerHTML = `<span class="badge ${good ? "ok" : "bad"}">${same} of ${cases.length} inputs returned the same result or threw the same error${known ? `; the other ${known === 1 ? "one is" : `${known} are`} the documented nesting difference` : ""}${unexpected ? `; ${unexpected} unexpected` : ""}</span>`;
  });

  // ---- the same broken input, asked again ---------------------------------------------

  const freshUrl = (which) => new URL(`${root}assets/impl/${SLUG}.${which}.js?fresh=${Date.now()}-${Math.random().toString(36).slice(2)}`, location.href).href;
  const freshImpl = async (which) => (await import(/* @vite-ignore */ freshUrl(which))).load();

  $("#history-run").addEventListener("click", async () => {
    const btn = $("#history-run");
    btn.disabled = true;
    const tbody = $("#history-table tbody");
    tbody.replaceChildren();
    $("#history-verdict").innerHTML = '<span class="badge info">Running</span>';
    try {
      const debounce = await sampleText("debounce.js");
      const inputs = ["export {", "export let ["];
      const seen = inputs.map(() => ({ o: [], f: [] }));
      const rows = [];
      let o;
      let f;
      const ask = (i, label) => {
        const a = answer(o, inputs[i]);
        const b = answer(f, inputs[i]);
        seen[i].o.push(a.text);
        seen[i].f.push(b.text);
        rows.push([i, label, describe(a, true), describe(b, true)]);
      };
      for (let i = 0; i < inputs.length; i++) {
        // each input gets a new instance of each library
        [o, f] = await Promise.all([freshImpl("orig"), freshImpl("fast")]);
        ask(i, "First call");
        ask(i, "Second call");
        answer(o, debounce);
        answer(f, debounce);
        ask(i, "After lexing an ordinary module");
      }
      for (const [i, label, a, b] of rows) {
        tbody.append(
          h("tr", {},
            h("td", {}, h("code", {}, inputs[i])),
            h("td", {}, label),
            h("td", { class: "wrap" }, a),
            h("td", { class: "wrap" }, b)),
        );
      }
      const varied = seen.filter((s) => new Set(s.o).size > 1).length;
      const steady = seen.every((s) => new Set(s.f).size === 1);
      const first = seen.every((s) => s.f[0] === s.o[0]);
      $("#history-verdict").innerHTML = `<span class="badge ${steady ? "ok" : "bad"}">es-module-lexer gave more than one answer to ${varied} of ${inputs.length} inputs. fast-es-module-lexer ${steady ? "gave the same answer every time" : "did not always give the same answer"}${steady && first ? ", the one a new original gives on its first call" : ""}.</span>`;
    } catch (e) {
      $("#history-verdict").innerHTML = `<span class="badge bad">${errMessage(e)}</span>`;
    } finally {
      btn.disabled = false;
    }
  });
}
