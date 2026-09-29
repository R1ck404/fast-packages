import { $, serialized, lanes, loadImpl, sizeOf, sample, race, bytesEqual, fmtBytes, fmtInt, fmtTime, fmtX, onFile, whenIdle, errMessage, h, yieldToUi } from "../ui.mjs";

const SAMPLES = [
  { id: "debounce.js", label: "6 KB module (lodash debounce)" },
  { id: "three.tsl.js", label: "37 KB module (three.tsl)" },
  { id: "three.module.js", label: "660 KB bundle (three.module)" },
  { id: "react-dom-client.js", label: "1.2 MB bundle (react-dom)" },
];

const select = $("#input");
for (const s of SAMPLES) select.append(h("option", { value: s.id }, s.label));
select.value = "three.module.js";
let custom = null; // { name, bytes }

const view = lanes($("#lanes"), { orig: "pako 2.1.0", fast: "fast-pako" });
const enc = new TextEncoder();

const [orig, fast] = await Promise.all([loadImpl("pako", "orig"), loadImpl("pako", "fast")]);
const [so, sf] = await Promise.all([sizeOf("pako", "orig"), sizeOf("pako", "fast")]);
view.subs(`${fmtBytes(so.raw)} bundle`, `${fmtBytes(sf.raw)} bundle`);

async function input() {
  if (custom) return custom.bytes;
  return sample(select.value);
}

const run = serialized(async function measure() {
  const btn = $("#run");
  btn.disabled = true;
  view.busy("Measuring");
  await yieldToUi();
  try {
    const op = $("#op").value;
    const raw = await input();
    let data = raw;
    let call;
    let describe;
    if (op === "ungzip") {
      data = orig.gzip(raw);
      call = (p) => () => p.ungzip(data);
      describe = `${fmtBytes(data.length)} of gzip into ${fmtBytes(raw.length)}`;
    } else if (op === "inflate") {
      data = orig.deflate(raw);
      call = (p) => () => p.inflate(data);
      describe = `${fmtBytes(data.length)} of zlib data into ${fmtBytes(raw.length)}`;
    } else if (op === "gzip") {
      call = (p) => () => p.gzip(raw);
      describe = `${fmtBytes(raw.length)} into gzip`;
    } else {
      const level = Number(op.slice(-1));
      call = (p) => () => p.deflate(raw, { level });
      describe = `${fmtBytes(raw.length)} at level ${level}`;
    }
    const r = await race(call(orig), call(fast), { rounds: 5, budgetMs: 2600 });
    let equal = bytesEqual(r.outOrig, r.outFast);
    if (equal && (op === "ungzip" || op === "inflate")) equal = bytesEqual(r.outFast, raw);
    view.show({ orig: r.orig, fast: r.fast, equal, detail: `${fmtInt(r.outFast.length)} bytes` });
    $("#info").textContent = `${describe}. Best of ${r.rounds} interleaved rounds.`;
  } catch (e) {
    view.error(errMessage(e));
  } finally {
    btn.disabled = false;
  }
});

$("#run").addEventListener("click", run);
$("#op").addEventListener("change", run);
select.addEventListener("change", () => {
  custom = null;
  run();
});
onFile($("#file"), (bytes, name) => {
  custom = { name, bytes };
  if (![...select.options].some((o) => o.value === "custom")) select.append(h("option", { value: "custom" }, ""));
  const opt = [...select.options].find((o) => o.value === "custom");
  opt.textContent = `${name} (${fmtBytes(bytes.length)})`;
  select.value = "custom";
  run();
});
whenIdle(run);

// ---- level sweep ---------------------------------------------------------

$("#sweep-run").addEventListener("click", async () => {
  const btn = $("#sweep-run");
  const out = $("#sweep-out");
  btn.disabled = true;
  out.innerHTML = "";
  const src = (await sample("three.module.js")).subarray(0, 300 * 1024);
  const rows = [];
  out.append(h("div", { class: "sweep-key", html: '<span><i></i>pako</span><span><i class="f"></i>fast-pako</span>' }));
  for (let level = 1; level <= 9; level++) {
    const bo = h("i", { style: "width:0" });
    const bf = h("i", { class: "f", style: "width:0" });
    const x = h("span", { class: "sweep-x" }, "");
    const row = h("div", { class: "sweep-row" }, h("span", { class: "nm" }, `Level ${level}`), h("div", { class: "sweep-bars" }, bo, bf), x);
    out.append(row);
    rows.push({ bo, bf, x });
  }
  let maxT = 0;
  const results = [];
  for (let level = 1; level <= 9; level++) {
    const r = await race(() => orig.deflate(src, { level }), () => fast.deflate(src, { level }), { rounds: 3, budgetMs: 900 });
    results.push(r);
    maxT = Math.max(maxT, r.orig, r.fast);
    results.forEach((res, i) => {
      rows[i].bo.style.width = `${(res.orig / maxT) * 100}%`;
      rows[i].bf.style.width = `${(res.fast / maxT) * 100}%`;
      rows[i].x.textContent = `${fmtX(res.speedup)}x`;
      rows[i].bo.title = `pako ${fmtTime(res.orig)}`;
      rows[i].bf.title = `fast-pako ${fmtTime(res.fast)}`;
    });
    if (!bytesEqual(r.outOrig, r.outFast)) rows[level - 1].x.textContent = "differs";
  }
  btn.disabled = false;
  btn.textContent = "Run again";
});

// ---- odd calls -----------------------------------------------------------

const text = enc.encode(
  "export function debounce(func, wait, options) {\n  var lastArgs, lastThis, maxWait, result, timerId, lastCallTime;\n  // odd calls need a body that compresses a little\n}\n".repeat(20),
);

const cases = [
  ["deflate(data, { level: \"5\" })", (p) => p.deflate(text, { level: "5" })],
  ["deflate(data, { windowBits: 8 })", (p) => p.deflate(text, { windowBits: 8 })],
  ["deflate(data, { memLevel: \"4\" })", (p) => p.deflate(text, { memLevel: "4" })],
  ["deflateRaw(data, { level: 0 })", (p) => p.deflateRaw(text, { level: 0 })],
  ["deflate(data, { dictionary })", (p) => p.deflate(text, { dictionary: enc.encode("function debounce") })],
  ["deflate(\"héllo wörld ✓\")", (p) => p.deflate("héllo wörld ✓")],
  ["gzip(data, { header: { name, comment, time } })", (p) => p.gzip(text, { header: { name: "notes.txt", comment: "hi", time: 1700000000, os: 3 } })],
  ["inflate(deflate(data), { to: \"string\" })", (p) => p.inflate(p.deflate(text), { to: "string" }).length],
  ["inflate(<garbage>)", (p) => p.inflate(new Uint8Array([1, 2, 3, 4]))],
  ["ungzip(<half a gzip file>)", (p) => p.ungzip(p.gzip(text).subarray(0, 40))],
  ["inflate(<a corrupted stream>)", (p) => {
    const z = p.deflate(text).slice();
    z[Math.floor(z.length / 2)] ^= 0xff;
    return p.inflate(z);
  }],
];

function hash(bytes) {
  let a = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) a = Math.imul(a ^ bytes[i], 0x01000193);
  return (a >>> 0).toString(16).padStart(8, "0");
}

function summarize(fn, p) {
  try {
    const r = fn(p);
    if (r instanceof Uint8Array) return `${r.length} bytes, hash ${hash(r)}`;
    return `returns ${JSON.stringify(r)}`;
  } catch (e) {
    return typeof e === "string" ? `throws "${e}"` : `throws ${e?.constructor?.name}: ${e?.message}`;
  }
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
  $("#odd-verdict").innerHTML = `<span class="badge ${same === cases.length ? "ok" : "bad"}">${same} of ${cases.length} calls returned the same result or threw the same error</span>`;
});
