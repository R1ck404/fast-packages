import { $, $$, root, lanes, loadImpl, sampleText, race, fmtBytes, fmtInt, fmtTime, fmtX, onFile, whenIdle, h, tabs, yieldToUi } from "../ui.mjs";

// The race and the playground each get their own copies of both libraries.
// V8 tunes acorn's methods to the classes it has seen; once several plugin
// subclasses have parsed in the same copy, plain parse() runs slower than it
// does in a fresh process, which is not what the recorded results measure.
// A copy loaded under another URL is compiled and tuned on its own.
const fresh = (which, tag) => {
  const url = new URL(`${root}assets/impl/acorn.${which}.js`, location.href);
  url.searchParams.set("copy", tag);
  return import(/* @vite-ignore */ url.href).then((m) => m.load({}));
};
const pair = (tag) => Promise.all([fresh("orig", tag), fresh("fast", tag)]);

const [orig, fast] = await Promise.all([loadImpl("acorn", "orig"), loadImpl("acorn", "fast")]);
let jsxPair = null; // for JSX in the race: parse() there never sees a subclass
let pgPair = null; // for the playground, which is not timed

// ---- comparing what comes back ------------------------------------------------

/**
 * Where two syntax trees first differ, or null when they are the same.
 * Stricter than comparing JSON: key order, prototypes' class names, bigints,
 * regular expressions and `undefined` values all count.
 */
function firstDifference(a, b, path = "ast", classes = { ab: new Map(), ba: new Map() }) {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return `${path}: ${String(a)} against ${String(b)}`;
  if (a instanceof RegExp || b instanceof RegExp) {
    return a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags ? null : `${path}: regular expressions differ`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array against object`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${path}: length ${a.length} against ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`, classes);
      if (d) return d;
    }
    return null;
  }
  // Both builds are minified, so class names cannot be compared. What must hold
  // is that the classes pair up one to one: every acorn Node is met by the same
  // fast-acorn class, every Position by another, and so on.
  const pa = Object.getPrototypeOf(a);
  const pb = Object.getPrototypeOf(b);
  if ((pa === Object.prototype) !== (pb === Object.prototype)) return `${path}: plain object against class instance`;
  if (pa !== Object.prototype) {
    const seenA = classes.ab.get(pa);
    const seenB = classes.ba.get(pb);
    if (seenA === undefined && seenB === undefined) {
      classes.ab.set(pa, pb);
      classes.ba.set(pb, pa);
    } else if (seenA !== pb || seenB !== pa) return `${path}: objects of different classes`;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return `${path}: keys [${ka}] against [${kb}]`;
  for (const k of ka) {
    const d = firstDifference(a[k], b[k], `${path}.${k}`, classes);
    if (d) return d;
  }
  return null;
}

function countNodes(root) {
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== "object" || v instanceof RegExp) continue;
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
      continue;
    }
    if (typeof v.type === "string" && typeof v.start === "number") n++;
    for (const k of Object.keys(v)) if (k !== "loc") stack.push(v[k]);
  }
  return n;
}

function errFields(e) {
  const isObj = e !== null && typeof e === "object";
  return {
    class: isObj ? e.constructor?.name : typeof e,
    message: isObj ? e.message : String(e),
    pos: isObj ? e.pos : undefined,
    loc: isObj && e.loc ? `${e.loc.line}:${e.loc.column}` : undefined,
    raisedAt: isObj ? e.raisedAt : undefined,
  };
}

/** run a call, keeping either its output or what it threw */
function attempt(fn) {
  try {
    return { value: fn() };
  } catch (e) {
    return { error: e };
  }
}

/** { same, what } for two attempts: trees and errors compare by every field acorn sets */
function compareOutcomes(a, b) {
  const aBad = "error" in a;
  const bBad = "error" in b;
  if (aBad !== bBad) return { same: false, what: aBad ? "acorn threw, fast-acorn did not" : "fast-acorn threw, acorn did not" };
  if (aBad) {
    const fa = errFields(a.error);
    const fb = errFields(b.error);
    const bad = Object.keys(fa).find((k) => fa[k] !== fb[k]);
    return bad ? { same: false, what: `error ${bad} differs` } : { same: true, what: `both threw ${fa.class}: ${fa.message}` };
  }
  const d = firstDifference(a.value, b.value);
  return d ? { same: false, what: d } : { same: true, what: "" };
}

const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

const rate = (bytes, ms) => `${((bytes / 1048576) / (ms / 1000)).toFixed(0)} MB/s`;

// ---- inputs --------------------------------------------------------------------

/** a file of JSX components to parse; each has its own names so it is one valid module */
function jsxSource(count) {
  const parts = ['import React from "react";\n'];
  for (let i = 0; i < count; i++) {
    parts.push(
      [
        `export function Card${i}({ title, items = [], onSelect, ...rest }) {`,
        "  const [open, setOpen] = React.useState(false);",
        "  const total = items.reduce((sum, item) => sum + (item.price ?? 0) * item.qty, 0);",
        '  if (!items.length) return <p className="empty">Nothing in {title} yet.</p>;',
        "  return (",
        `    <section className={open ? "card open" : "card"} data-index="${i}" {...rest}>`,
        "      <h2 onClick={() => setOpen(!open)}>{title} <small>({items.length})</small></h2>",
        "      {open && (",
        "        <ul>",
        "          {items.map((item) => (",
        "            <li key={item.id} onClick={() => onSelect?.(item)}>",
        "              <b>{item.name}</b>: {item.qty} &times; {item.price.toFixed(2)}",
        "            </li>",
        "          ))}",
        "        </ul>",
        "      )}",
        "      <Footer total={total}>Total: {total}</Footer>",
        "    </section>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
  }
  return parts.join("\n");
}
const JSX_SAMPLE = jsxSource(50);

const SAMPLES = [
  { id: "debounce.js", label: "6 KB module (lodash debounce)", text: () => sampleText("debounce.js") },
  { id: "three.tsl.js", label: "37 KB module (three.tsl)", text: () => sampleText("three.tsl.js") },
  { id: "three.module.js", label: "660 KB module (three.module)", text: () => sampleText("three.module.js") },
  { id: "react-dom-client.js", label: "1.2 MB CommonJS bundle (react-dom)", text: () => sampleText("react-dom-client.js"), sourceType: "script" },
  { id: "jsx", label: `50 JSX components, generated (${fmtBytes(JSX_SAMPLE.length)})`, text: async () => JSX_SAMPLE, jsx: true },
  { id: "schemas.ts", label: "TypeScript file (neither parser accepts it)", text: () => sampleText("schemas.ts") },
];

function optionsFrom(prefix) {
  const v = $(`#${prefix}-ecma`).value;
  return {
    ecmaVersion: v === "latest" ? "latest" : Number(v),
    sourceType: $(`#${prefix}-source`).value,
    locations: $(`#${prefix}-locs`).checked,
    ranges: $(`#${prefix}-ranges`)?.checked ?? false,
  };
}

// ---- main race -------------------------------------------------------------------

const select = $("#input");
for (const s of SAMPLES) select.append(h("option", { value: s.id }, s.label));
select.value = "three.module.js";
let custom = null; // { name, text }

const view = lanes($("#lanes"), { orig: "acorn", fast: "fast-acorn" });
view.subs(`version ${orig.version}`, `version ${fast.version}`);

let running = false;
let again = false;

async function run() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  const btn = $("#run");
  btn.disabled = true;
  view.busy("Measuring");
  await yieldToUi();
  try {
    let name;
    let text;
    if (select.value === "custom") {
      ({ text, name } = custom);
    } else {
      const s = SAMPLES.find((x) => x.id === select.value);
      text = await s.text();
      name = s.label;
    }
    const jsx = $("#jsx").checked;
    const options = optionsFrom("opt");
    const [po, pf] = jsx ? await (jsxPair ??= pair("race-jsx")) : [orig, fast];
    const call = (p) => () => attempt(() => (jsx ? p.parseJsx(text, options) : p.parse(text, options)));
    const r = await race(call(po), call(pf), { rounds: 5, budgetMs: 2600 });
    const verdict = compareOutcomes(r.outOrig, r.outFast);
    const bytes = new TextEncoder().encode(text).length;
    if ("error" in r.outFast && verdict.same) {
      const message = verdict.what.replace(/^both threw /, "");
      view.show({
        orig: r.orig,
        fast: r.fast,
        equal: true,
        okText: "Both throw the same error",
        detail: message,
        noSpeed: "Not a speed comparison",
      });
      // nothing was parsed: the times are only how long each takes to build the error
      const hint = /sourceType: module/.test(message)
        ? " This file uses import and export, so set sourceType to module to time a real parse."
        : "";
      $("#info").textContent = `Neither parser accepts this input, so both stopped at the first error and the times only show how long it took to raise it.${hint}`;
    } else {
      const nodes = "value" in r.outFast ? countNodes(r.outFast.value) : 0;
      view.show({ orig: r.orig, fast: r.fast, equal: verdict.same, detail: verdict.same ? `${fmtInt(nodes)} nodes` : verdict.what });
      $("#info").textContent = `${jsx ? "acorn-jsx" : "parse"} on ${fmtBytes(bytes)} of source, ${fmtInt(nodes)} nodes. acorn ${rate(bytes, r.orig)}, fast-acorn ${rate(bytes, r.fast)}. Best of ${r.rounds} interleaved rounds.`;
    }
  } catch (e) {
    view.error(e?.message ?? String(e));
  } finally {
    btn.disabled = false;
    running = false;
    if (again) {
      again = false;
      run();
    }
  }
}

$("#run").addEventListener("click", run);
for (const id of ["opt-ecma", "opt-source", "opt-locs", "opt-ranges", "jsx"]) $(`#${id}`).addEventListener("change", run);
select.addEventListener("change", () => {
  const s = SAMPLES.find((x) => x.id === select.value);
  if (s) {
    $("#jsx").checked = !!s.jsx;
    $("#opt-source").value = s.sourceType ?? "module";
  }
  run();
});
onFile($("#file"), (bytes, name) => {
  custom = { name, text: new TextDecoder().decode(bytes) };
  let opt = [...select.options].find((o) => o.value === "custom");
  if (!opt) select.append((opt = h("option", { value: "custom" }, "")));
  opt.textContent = `${name} (${fmtBytes(bytes.length)})`;
  select.value = "custom";
  $("#jsx").checked = /\.(jsx|tsx)$/i.test(name);
  run();
});
whenIdle(run);

// ---- playground: trees, tokens, errors -----------------------------------------------

const PRESETS = [
  {
    label: "Class with private fields",
    code: 'import { readFile } from "node:fs/promises";\n\nexport class Cache extends Map {\n  static #hits = 0;\n  #limit;\n  constructor(limit = 100) {\n    super();\n    this.#limit = limit;\n  }\n  async load(path) {\n    const text = (await readFile(path, "utf8"))?.trim() ?? "";\n    return text.split(/\\r?\\n/u).map((line, i) => `${i}: ${line}`);\n  }\n}\n',
  },
  { label: "JSX", jsx: true, code: 'const view = (\n  <ul className="list">\n    {items.map((item) => <li key={item.id}>{item.name} &times; {item.qty}</li>)}\n  </ul>\n);\n' },
  { label: "Missing closing brace", code: "function add(a, b) {\n  return a + b;\n\nconsole.log(add(1, 2));\n" },
  { label: "Duplicate group name in a regexp", code: "const date = /(?<part>\\d{4})-(?<part>\\d{2})/;\n" },
  { label: "Reserved word in strict mode", code: '"use strict";\nvar interface = 1;\n' },
  { label: "Unterminated template", code: "const message = `total: ${count + ;\n" },
];

const pg = {
  code: $("#pg-code"),
  presets: $("#pg-preset"),
  out: $("#pg-out"),
  compare: $("#pg-compare"),
  verdict: $("#pg-verdict"),
};
PRESETS.forEach((p, i) => pg.presets.append(h("option", { value: i }, p.label)));
pg.code.value = PRESETS[0].code;
let pgMode = "tree";

const pgTabs = tabs(
  $("#pg-tabs"),
  [
    { label: "Syntax tree", mode: "tree" },
    { label: "Tokens", mode: "tokens" },
  ],
  (item) => {
    pgMode = item.mode;
    $("#pg-jsx").disabled = pgMode === "tokens";
    pgUpdate();
  },
);

const replacer = (k, v) => (typeof v === "bigint" ? `${v}n` : v instanceof RegExp ? String(v) : v === undefined ? "[undefined]" : v);

function clip(text, lines = 400) {
  const all = text.split("\n");
  return all.length <= lines ? text : `${all.slice(0, lines).join("\n")}\n... ${fmtInt(all.length - lines)} more lines`;
}

const tokenRows = (list) => list.map((t) => ({ type: t.type.label, value: t.value === undefined ? "" : String(t.value), start: t.start, end: t.end, loc: t.loc ? `${t.loc.start.line}:${t.loc.start.column}-${t.loc.end.line}:${t.loc.end.column}` : undefined }));

async function pgUpdate() {
  const [pgOrig, pgFast] = await (pgPair ??= pair("playground"));
  const code = pg.code.value;
  const options = optionsFrom("pg");
  const jsx = $("#pg-jsx").checked && pgMode === "tree";
  const call = (p) => () => (pgMode === "tokens" ? p.tokenize(code, options) : jsx ? p.parseJsx(code, options) : p.parse(code, options));
  const a = attempt(call(pgOrig));
  const b = attempt(call(pgFast));
  let same;
  let what;
  if (pgMode === "tokens" && "value" in a && "value" in b) {
    const ra = tokenRows(a.value);
    const rb = tokenRows(b.value);
    same = JSON.stringify(ra) === JSON.stringify(rb);
    what = same ? "" : "token lists differ";
  } else {
    ({ same, what } = compareOutcomes(a, b));
  }

  // the output pane shows what fast-acorn returned
  pg.compare.innerHTML = "";
  if ("error" in b) {
    const f = errFields(b.error);
    pg.out.textContent = `${f.class}: ${f.message}`;
    pg.out.classList.add("wrap");
    const rows = [["class", "class"], ["message", "message"], ["pos", "pos"], ["loc", "loc"], ["raisedAt", "raisedAt"]];
    const fa = "error" in a ? errFields(a.error) : null;
    const body = rows.map(([label, key]) => {
      const va = fa ? String(fa[key]) : "no error";
      const vb = String(f[key]);
      const ok = va === vb;
      return h("tr", {}, h("td", {}, label), h("td", {}, va), h("td", {}, vb), h("td", { class: ok ? "ok" : "bad" }, ok ? "Same" : "Differs"));
    });
    pg.compare.append(h("div", { class: "pg-scroll" }, h("table", { class: "compare pg-table" }, h("thead", {}, h("tr", {}, ["Field", "acorn", "fast-acorn", ""].map((t) => h("th", { scope: "col" }, t)))), h("tbody", {}, body))));
  } else if (pgMode === "tokens") {
    const rows = tokenRows(b.value);
    const shown = rows.slice(0, 60);
    const withLoc = rows.some((r) => r.loc);
    pg.out.textContent = "";
    pg.compare.append(
      h("div", { class: "pg-tokens" },
        h("table", { class: "compare pg-table" },
          h("thead", {}, h("tr", {}, ["Type", "Value", "Start", "End", ...(withLoc ? ["Location"] : [])].map((t) => h("th", { scope: "col" }, t)))),
          h("tbody", {}, shown.map((r) => h("tr", {}, h("td", {}, r.type), h("td", {}, h("code", {}, r.value)), h("td", {}, String(r.start)), h("td", {}, String(r.end)), ...(withLoc ? [h("td", {}, r.loc ?? "")] : []))))),
        rows.length > shown.length ? h("p", { class: "note-line" }, `Showing 60 of ${fmtInt(rows.length)} tokens.`) : null,
      ),
    );
  } else {
    pg.out.classList.remove("wrap");
    pg.out.textContent = clip(JSON.stringify(b.value, replacer, 2));
  }
  pg.out.hidden = pgMode === "tokens" && !("error" in b);
  pg.compare.hidden = !pg.compare.childElementCount;

  let badge;
  if (same) {
    const n = "error" in b ? "" : pgMode === "tokens" ? `, ${fmtInt(b.value.length)} tokens` : `, ${fmtInt(countNodes(b.value))} nodes`;
    const text = "error" in b ? "Same error from both parsers" : pgMode === "tokens" ? `Identical${n}` : `Identical${n}, same keys in the same order`;
    badge = `<span class="badge ok">${CHECK}${text}</span>`;
  } else {
    badge = `<span class="badge bad">${CROSS}Different: ${what.replace(/[<&]/g, "")}</span>`;
  }
  pg.verdict.innerHTML = badge;
}

pg.presets.addEventListener("change", () => {
  const p = PRESETS[Number(pg.presets.value)];
  pg.code.value = p.code;
  $("#pg-jsx").checked = !!p.jsx;
  pgUpdate();
});
let pgTimer = 0;
pg.code.addEventListener("input", () => {
  clearTimeout(pgTimer);
  pgTimer = setTimeout(pgUpdate, 150);
});
for (const id of ["pg-ecma", "pg-source", "pg-locs", "pg-jsx"]) $(`#${id}`).addEventListener("change", pgUpdate);
pgUpdate();

// ---- which parser runs ------------------------------------------------------------------

const EXPRESSIONS = ["a.b(c)", "x ? y : z", "`n = ${n + 1}`", "items.map((i) => i.id)", "{ a, b: [1, 2], ...c }", "!!(a && b || c)", "new Date(t * 1000)", "await fetch(url)"];
const moduleOpts = { ecmaVersion: "latest", sourceType: "module" };

const CASES = [
  {
    name: "parse()",
    note: "acorn's own API, the main path",
    input: () => sampleText("three.module.js"),
    call: (p, t) => p.parse(t, moduleOpts),
  },
  {
    name: "Parser.extend(acornJsx())",
    note: "acorn-jsx; fast-acorn-jsx is registered with the fast parser by identity",
    input: async () => JSX_SAMPLE,
    call: (p, t) => p.parseJsx(t, { ...moduleOpts, locations: true }),
  },
  {
    name: "Nodepod's topLevelParser",
    note: "a subclass whose only method is parseFunctionBody, minified like this page's bundle",
    input: () => sampleText("three.module.js"),
    call: (p, t) => p.parseTopLevel(t, moduleOpts),
  },
  {
    name: "parseExpressionAt()",
    note: "eight small expressions per call",
    input: async () => EXPRESSIONS,
    call: (p, list) => list.map((e) => p.parseExpressionAt(e, 0, { ecmaVersion: "latest" })),
  },
  {
    name: "tokenizer()",
    note: "every token of a 37 KB module",
    input: () => sampleText("three.tsl.js"),
    call: (p, t) => p.tokenize(t, moduleOpts),
    // token types carry functions that differ between copies, so compare their labels and positions
    norm: (list) => list.map((t) => [t.type.label, t.value, t.start, t.end]),
  },
  {
    name: "A plugin with a method of its own",
    note: "one that fast-acorn does not recognise",
    input: () => sampleText("three.tsl.js"),
    call: (p, t) => p.parsePlugin(t, moduleOpts),
  },
];

const caseBody = $("#which-table tbody");
CASES.forEach((c, i) => {
  caseBody.append(
    h("tr", { id: `case-${i}` },
      h("td", {}, h("code", {}, c.name), h("div", { class: "note-line", style: "margin:2px 0 0" }, c.note)),
      h("td", { class: "num" }, "-"),
      h("td", { class: "num" }, "-"),
      h("td", { class: "num" }, "-"),
      h("td", {}, "")),
  );
});

let runCount = 0;
$("#which-run").addEventListener("click", async () => {
  const btn = $("#which-run");
  btn.disabled = true;
  const verdict = $("#which-verdict");
  verdict.innerHTML = '<span class="badge info">Measuring</span>';
  const runId = ++runCount;
  let same = 0;
  let needFull = 0;
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    const cells = $$("td", $(`#case-${i}`));
    cells[1].textContent = cells[2].textContent = cells[3].textContent = "...";
    cells[4].textContent = "";
    await yieldToUi();
    const data = await c.input();
    const [orig, fast] = await pair(`case-${runId}-${i}`);
    const a = attempt(() => c.call(orig, data));
    const b = attempt(() => c.call(fast, data));
    if ("error" in b && !("error" in a)) {
      // fast-acorn refuses: outside Node an unrecognised plugin needs the /full import
      const r = await race(() => attempt(() => c.call(orig, data)), () => 0, { rounds: 3, budgetMs: 300 });
      cells[1].textContent = fmtTime(r.orig);
      cells[2].textContent = "throws";
      cells[3].textContent = "-";
      const msg = errFields(b.error).message;
      cells[4].replaceChildren(h("span", { class: "case-warn" }, "Needs the /full import here"), h("div", { class: "note-line", style: "margin:2px 0 0" }, msg));
      needFull++;
      continue;
    }
    const r = await race(() => attempt(() => c.call(orig, data)), () => attempt(() => c.call(fast, data)), { rounds: 7, budgetMs: 2000 });
    const norm = (o) => (c.norm && "value" in o ? { value: c.norm(o.value) } : o);
    const v = compareOutcomes(norm(r.outOrig), norm(r.outFast));
    cells[1].textContent = fmtTime(r.orig);
    cells[2].textContent = fmtTime(r.fast);
    cells[3].replaceChildren(h("span", { class: r.speedup < 1 ? "case-slow" : "xval" }, `${fmtX(r.speedup < 1 ? 1 / r.speedup : r.speedup)}x${r.speedup < 1 ? " slower" : ""}`));
    cells[4].replaceChildren(h("span", { class: v.same ? "case-ok" : "case-bad" }, v.same ? "Identical" : `Differs: ${v.what}`));
    if (v.same) same++;
  }
  const ran = CASES.length - needFull;
  verdict.innerHTML = `<span class="badge ${same === ran ? "ok" : "bad"}">${same === ran ? CHECK : CROSS}${same} of ${ran} comparable cases returned identical output</span>`;
  btn.disabled = false;
  btn.textContent = "Run again";
});
