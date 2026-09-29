import { $, lanes, loadImpl, sizeOf, sample, race, bytesEqual, fmtBytes, fmtInt, fmtTime, fmtX, onFile, whenIdle, errMessage, h, yieldToUi } from "../ui.mjs";

const SAMPLES = [
  { id: "debounce.js", label: "6 KB module (lodash debounce)" },
  { id: "three.tsl.js", label: "37 KB module (three.tsl)" },
  { id: "schemas.ts", label: "100 KB TypeScript (schemas.ts)" },
  { id: "three.module.js", label: "660 KB bundle (three.module)" },
  { id: "react-dom-client.js", label: "1.2 MB bundle (react-dom)" },
];
const TYPED = "typed";
const TYPED_DEFAULT = '{"name":"@r1ck404/fast-brotli-wasm","type":"module","sideEffects":false}';
const enc = new TextEncoder();

const select = $("#input");
for (const s of SAMPLES) select.append(h("option", { value: s.id }, s.label));
select.append(h("option", { value: TYPED }, "Text you type"));
select.value = "three.tsl.js";
const slider = $("#q");
const textbox = $("#text");
textbox.value = TYPED_DEFAULT;
let custom = null; // { name, bytes }

const viewC = lanes($("#lanes-c"), { orig: "brotli-wasm 3.0.1", fast: "fast-brotli-wasm" });
const viewD = lanes($("#lanes-d"), { orig: "brotli-wasm 3.0.1", fast: "fast-brotli-wasm" });

const [orig, fast] = await Promise.all([loadImpl("brotli", "orig"), loadImpl("brotli", "fast")]);
const [so, sf] = await Promise.all([
  sizeOf("brotli", "orig", ["brotli_wasm_bg.wasm"]),
  sizeOf("brotli", "fast", ["fastbrotli.wasm"]),
]);
viewC.subs(`${fmtBytes(so.raw)} with wasm`, `${fmtBytes(sf.raw)} with wasm`);
viewD.subs(`${fmtBytes(so.raw)} with wasm`, `${fmtBytes(sf.raw)} with wasm`);
// first-use costs (each library's own set-up) belong to start-up, not to the race
for (const lib of [orig, fast]) lib.decompress(lib.compress(enc.encode("warm up"), { quality: 5 }));

// ---- helpers ---------------------------------------------------------------

/** the browser's own gzip, for scale; null where CompressionStream is missing */
async function gzipSize(bytes) {
  if (typeof CompressionStream !== "function") return null;
  try {
    const cs = new CompressionStream("gzip");
    const w = cs.writable.getWriter();
    w.write(bytes);
    w.close();
    return (await new Response(cs.readable).arrayBuffer()).byteLength;
  } catch {
    return null;
  }
}

/**
 * Like race(), but for calls that take long: one timed pair tells how slow the
 * job is, then either race() takes over (short jobs, many short batches) or the
 * two alternate one call at a time until the budget is spent. Every call counts.
 */
async function measure(runO, runF, budgetMs = 3000) {
  const t = () => performance.now();
  let s = t();
  const outOrig = runO();
  let bestO = t() - s;
  s = t();
  const outFast = runF();
  let bestF = t() - s;
  await yieldToUi();
  if (Math.max(bestO, bestF) < 50) return race(runO, runF, { rounds: 5, budgetMs });
  let rounds = 1;
  let spent = bestO + bestF;
  while (rounds < 5 && spent + (bestO + bestF) * 1.1 <= budgetMs) {
    const pair = rounds % 2 === 0 ? ["o", "f"] : ["f", "o"];
    for (const which of pair) {
      s = t();
      (which === "o" ? runO : runF)();
      const d = t() - s;
      spent += d;
      if (which === "o") bestO = Math.min(bestO, d);
      else bestF = Math.min(bestF, d);
    }
    rounds++;
    await yieldToUi();
  }
  return { orig: bestO, fast: bestF, speedup: bestO / bestF, rounds, outOrig, outFast };
}

const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---- the race --------------------------------------------------------------

async function input() {
  if (select.value === TYPED) return enc.encode(textbox.value);
  if (select.value === "custom" && custom) return custom.bytes;
  return sample(select.value);
}

const inputSize = async () => (await input()).length;
let running = false;
let again = false;

/** compress at q11 of a large input takes seconds in the original: ask first */
async function heavy() {
  return Number(slider.value) >= 10 && (await inputSize()) >= 700 * 1024;
}

async function autoRun() {
  if (await heavy()) {
    $("#info").textContent = "Quality 10 and 11 on an input this large take several seconds with brotli-wasm. Press Run to measure.";
    return;
  }
  run();
}

async function run() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  const btn = $("#run");
  btn.disabled = true;
  viewC.busy("Compressing");
  viewD.reset();
  $("#info").textContent = "";
  await yieldToUi();
  try {
    const raw = await input();
    const quality = Number(slider.value);
    const rc = await measure(() => orig.compress(raw, { quality }), () => fast.compress(raw, { quality }));
    const same = bytesEqual(rc.outOrig, rc.outFast);
    const out = rc.outFast;
    viewC.show({ orig: rc.orig, fast: rc.fast, equal: same, detail: `${fmtInt(out.length)} bytes` });

    viewD.busy("Decompressing");
    await yieldToUi();
    const rd = await race(() => orig.decompress(out), () => fast.decompress(out), { rounds: 5, budgetMs: 1800 });
    const roundTrip = bytesEqual(rd.outOrig, raw) && bytesEqual(rd.outFast, raw);
    viewD.show({ orig: rd.orig, fast: rd.fast, equal: roundTrip, detail: "both return the original input" });
    if (!roundTrip) $("#info").textContent = "A decoder did not return the original input.";

    const gz = await gzipSize(raw);
    $("#stats").hidden = false;
    $("#st-in").textContent = fmtBytes(raw.length);
    $("#st-out").textContent = `${fmtBytes(out.length)} at quality ${quality}${raw.length ? `, ${((out.length / raw.length) * 100).toFixed(1)}% of the input` : ""}`;
    $("#st-gz").textContent = gz == null ? "not available in this browser" : `${fmtBytes(gz)}${raw.length ? `, ${((gz / raw.length) * 100).toFixed(1)}%` : ""}`;
    $("#info").textContent = `Best of ${rc.rounds} interleaved round${rc.rounds === 1 ? "" : "s"} for compression, ${rd.rounds} for decompression.${!same ? " The two compressed outputs differ." : ""}`;
  } catch (e) {
    viewC.error(errMessage(e));
  } finally {
    btn.disabled = false;
    running = false;
    if (again) {
      again = false;
      autoRun();
    }
  }
}

function syncControls() {
  const q = Number(slider.value);
  $("#q-out").textContent = String(q);
  $("#q-def").hidden = q !== 11;
  $("#text-field").hidden = select.value !== TYPED;
}

$("#run").addEventListener("click", run);
slider.addEventListener("input", syncControls);
slider.addEventListener("change", autoRun);
select.addEventListener("change", () => {
  if (select.value !== "custom") custom = null;
  syncControls();
  autoRun();
});
let typing;
textbox.addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(autoRun, 350);
});
onFile($("#file"), (bytes, name) => {
  custom = { name, bytes };
  let opt = [...select.options].find((o) => o.value === "custom");
  if (!opt) {
    opt = h("option", { value: "custom" }, "");
    select.append(opt);
  }
  opt.textContent = `${name} (${fmtBytes(bytes.length)})`;
  select.value = "custom";
  syncControls();
  autoRun();
});
syncControls();
whenIdle(autoRun);

// ---- quality sweep ---------------------------------------------------------

$("#sweep-run").addEventListener("click", async () => {
  const btn = $("#sweep-run");
  const out = $("#sweep-out");
  const verdict = $("#sweep-verdict");
  const note = $("#sweep-note");
  btn.disabled = true;
  verdict.hidden = true;
  note.replaceChildren();
  out.innerHTML = "";
  const name = $("#sweep-input").value;
  const src = (await sample(name)).subarray(0, 200 * 1024);
  out.append(
    h("div", { class: "sweep-key", html: '<span><i></i>brotli-wasm</span><span><i class="f"></i>fast-brotli-wasm</span><span><i class="s"></i>compressed size, both</span>' }),
  );
  const rows = [];
  for (let q = 0; q <= 11; q++) {
    const bo = h("i", { style: "width:0" });
    const bf = h("i", { class: "f", style: "width:0" });
    const to = h("span", { class: "t" }, "");
    const tf = h("span", { class: "t f" }, "");
    const x = h("span", { class: "sweep-x" }, "");
    const bs = h("i", { class: "s", style: "width:0" });
    const sz = h("span", { class: "sz" }, "");
    out.append(
      h("div", { class: "qrow" },
        h("span", { class: "nm" }, `Quality ${q}`),
        h("div", { class: "sweep-bars" }, bo, bf),
        h("span", { class: "times" }, to, tf),
        x,
        h("div", { class: "sweep-bars sz-bar" }, bs),
        sz),
    );
    rows.push({ bo, bf, to, tf, x, bs, sz });
  }
  const results = [];
  let maxT = 0;
  let maxSize = 0;
  let allSame = true;
  try {
    for (let q = 0; q <= 11; q++) {
      const r = await race(() => orig.compress(src, { quality: q }), () => fast.compress(src, { quality: q }), { rounds: 3, budgetMs: 900 });
      const same = bytesEqual(r.outOrig, r.outFast);
      allSame &&= same;
      results.push({ ...r, size: r.outFast.length, same });
      maxT = Math.max(maxT, r.orig, r.fast);
      maxSize = Math.max(maxSize, r.outFast.length);
      results.forEach((res, i) => {
        const row = rows[i];
        row.bo.style.width = `${(res.orig / maxT) * 100}%`;
        row.bf.style.width = `${(res.fast / maxT) * 100}%`;
        row.to.textContent = fmtTime(res.orig);
        row.tf.textContent = fmtTime(res.fast);
        row.x.textContent = res.same ? `${fmtX(res.speedup)}x` : "differs";
        row.bs.style.width = `${(res.size / maxSize) * 100}%`;
        row.sz.textContent = `${fmtInt(res.size)} B, ${((res.size / src.length) * 100).toFixed(1)}%`;
      });
      await yieldToUi();
    }
    // what the numbers say
    const gz = await gzipSize(src);
    const at = (q) => results[q];
    const sumO = results.reduce((a, r) => a + r.orig, 0);
    const top = at(10).orig + at(11).orig;
    const xs = results.map((r) => r.speedup);
    const lines = [
      `Input: ${name === "schemas.ts" ? "schemas.ts" : `the first 200 KB of ${name}`}, ${fmtBytes(src.length)}.`,
      `Qualities 10 and 11 take ${Math.round((top / sumO) * 100)}% of brotli-wasm's total time across the twelve, and ${Math.round(((at(10).fast + at(11).fast) / results.reduce((a, r) => a + r.fast, 0)) * 100)}% of fast-brotli-wasm's.`,
      `Going from quality 9 to 11 makes the output ${(((at(9).size - at(11).size) / at(9).size) * 100).toFixed(1)}% smaller and takes fast-brotli-wasm ${fmtX(at(11).fast / at(9).fast)}x as long (${fmtTime(at(9).fast)} against ${fmtTime(at(11).fast)}).`,
      `The speedup runs from ${fmtX(Math.min(...xs))}x to ${fmtX(Math.max(...xs))}x across the qualities.`,
    ];
    if (gz != null) {
      const beat = results.findIndex((r) => r.size < gz);
      lines.push(
        `The browser's gzip makes this input ${fmtInt(gz)} bytes.${beat >= 0 ? ` Brotli is smaller than that from quality ${beat} up.` : " No brotli quality here is smaller."}`,
      );
    }
    note.replaceChildren(...lines.map((l) => h("p", {}, l)));
    verdict.hidden = false;
    verdict.innerHTML = allSame
      ? `<span class="badge ok">${CHECK}Output identical at all twelve qualities</span>`
      : '<span class="badge bad">Outputs differ at some quality</span>';
  } catch (e) {
    note.replaceChildren(h("p", {}, errMessage(e)));
    note.classList.add("err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Run again";
  }
});

// ---- odd calls -------------------------------------------------------------

const text = enc.encode(
  "export function debounce(func, wait, options) {\n  var lastArgs, lastThis, maxWait, result, timerId, lastCallTime;\n  // odd calls need a body that compresses a little\n}\n".repeat(12),
);
const z = (lib, o) => lib.compress(text, o);

const cases = [
  ["compress(data)", (p) => p.compress(text)],
  ["compress(data, { quality: 0 })", (p) => p.compress(text, { quality: 0 })],
  ["compress(data, { quality: 9 })", (p) => p.compress(text, { quality: 9 })],
  ["compress(data, { quality: 11 })", (p) => p.compress(text, { quality: 11 })],
  ["compress(data, { quality: 99 })", (p) => p.compress(text, { quality: 99 })],
  ["compress(data, { quality: -1 })", (p) => p.compress(text, { quality: -1 })],
  ["compress(data, {})", (p) => p.compress(text, {})],
  ["compress(data, { other: true })", (p) => p.compress(text, { other: true })],
  ["compress(new Uint8Array(0))", (p) => p.compress(new Uint8Array(0))],
  ["compress([104, 105])", (p) => p.compress([104, 105])],
  ["compress(data, \"fast\")", (p) => p.compress(text, "fast")],
  ["decompress(<empty>)", (p) => p.decompress(new Uint8Array(0))],
  ["decompress(<garbage>)", (p) => p.decompress(new Uint8Array([1, 2, 3, 4]))],
  ["decompress(<half a stream>)", (p) => p.decompress(z(p).subarray(0, Math.floor(z(p).length / 2)))],
  ["decompress(<a corrupted stream>)", (p) => {
    const c = z(p).slice();
    c[0] ^= 0xff;
    return p.decompress(c);
  }],
  ["decompress(<stream and trailing bytes>)", (p) => {
    const c = z(p);
    const t = new Uint8Array(c.length + 5);
    t.set(c);
    t.set([1, 2, 3, 4, 5], c.length);
    return p.decompress(t);
  }],
  ["decompress(compress(data))", (p) => p.decompress(z(p))],
  // these two panic; each library prints only the first two panics of an instance, so they go last
  ["compress(data, { quality: \"5\" })", (p) => p.compress(text, { quality: "5" })],
  ["compress(data, { quality: 5.5 })", (p) => p.compress(text, { quality: 5.5 })],
];

function hash(bytes) {
  let a = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) a = Math.imul(a ^ bytes[i], 0x01000193);
  return (a >>> 0).toString(16).padStart(8, "0");
}

/** what a call returns or throws, and what it prints with console.error (without the stack) */
function summarize(fn, lib) {
  const logged = [];
  const real = console.error;
  console.error = (...a) => logged.push(a.join(" ").split("\n\nStack:")[0]);
  let s;
  try {
    const r = fn(lib);
    s = r instanceof Uint8Array ? `${r.length} byte${r.length === 1 ? "" : "s"}, hash ${hash(r)}` : `returns ${JSON.stringify(r)}`;
  } catch (e) {
    s = typeof e === "string" ? `throws "${e}"` : `throws ${e?.constructor?.name}: ${e?.message}`;
  } finally {
    console.error = real;
  }
  return logged.length ? `${s}; console: ${logged.join(" | ")}` : s;
}

$("#odd-run").addEventListener("click", () => {
  const tbody = $("#odd-table tbody");
  tbody.innerHTML = "";
  let same = 0;
  for (const [label, fn] of cases) {
    const a = summarize(fn, orig);
    const b = summarize(fn, fast);
    const ok = a === b;
    if (ok) same++;
    tbody.append(
      h("tr", {},
        h("td", {}, h("code", {}, label)),
        h("td", {}, a),
        h("td", {}, b),
        h("td", { style: `font-weight:700;color:${ok ? "var(--ok)" : "var(--bad)"}` }, ok ? "Same" : "Differs")),
    );
  }
  $("#odd-verdict").innerHTML = `<span class="badge ${same === cases.length ? "ok" : "bad"}">${same} of ${cases.length} calls returned the same result, threw the same error and printed the same message</span>`;
});

// ---- download size ---------------------------------------------------------

{
  const out = $("#size-out");
  const scale = Math.max(so.raw, sf.raw);
  const groups = [
    ["Raw", "raw"],
    ["gzip", "gzip"],
    ["brotli", "brotli"],
  ];
  for (const [label, key] of groups) {
    out.append(h("div", { class: "meter-group" }, label));
    for (const [name, s, cls] of [["brotli-wasm 3.0.1", so, "orig"], ["fast-brotli-wasm", sf, "fast"]]) {
      const cut = cls === "fast" ? ` (${Math.round((1 - s[key] / so[key]) * 100)}% less)` : "";
      out.append(
        h("div", { class: `meter-row ${cls}` },
          h("span", {}, name),
          h("div", { class: "track" }, h("div", { class: "fill", style: `width:${(s[key] / scale) * 100}%` })),
          h("span", { class: "val" }, fmtBytes(s[key]) + cut)),
      );
    }
  }
}
