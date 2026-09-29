import { $, lanes, loadImpl, sizeOf, sample, bytesEqual, fmtBytes, fmtInt, fmtTime, fmtX, onFile, whenIdle, errMessage, h, yieldToUi } from "../ui.mjs";

const enc = new TextEncoder();
const now = () => performance.now();
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

const [orig, fast] = await Promise.all([loadImpl("noble-hashes", "orig"), loadImpl("noble-hashes", "fast")]);
const [so, sf] = await Promise.all([sizeOf("noble-hashes", "orig"), sizeOf("noble-hashes", "fast")]);

// ---- timing ---------------------------------------------------------------
// Every call in this page is synchronous, and the shortest take well under a
// microsecond, so the two implementations are timed in plain loops (the
// shared race() awaits each call, which would cost more than the hash).

/** how many calls make a batch of about `target` ms */
function calibrate(fn, target) {
  let n = 1;
  for (;;) {
    const s = now();
    for (let i = 0; i < n; i++) fn();
    const d = now() - s;
    if (d >= 2) return Math.max(1, Math.ceil((n * target) / d));
    n *= d < 0.2 ? 8 : 2;
  }
}

/**
 * Times two synchronous functions that do the same job: alternating batches,
 * each warmed up first, the best batch of each kept. Milliseconds per call.
 */
async function raceSync(runO, runF, { rounds = 7, batchMs = 12, budgetMs = 2400 } = {}) {
  const outO = runO();
  const outF = runF();
  const nO = calibrate(runO, batchMs);
  const nF = calibrate(runF, batchMs);
  const batch = (fn, n) => {
    const s = now();
    for (let i = 0; i < n; i++) fn();
    return (now() - s) / n;
  };
  let bestO = Infinity;
  let bestF = Infinity;
  const t0 = now();
  let r = 0;
  for (; r < rounds; r++) {
    if (r >= 3 && now() - t0 > budgetMs) break;
    if (r % 2 === 0) {
      bestO = Math.min(bestO, batch(runO, nO));
      bestF = Math.min(bestF, batch(runF, nF));
    } else {
      bestF = Math.min(bestF, batch(runF, nF));
      bestO = Math.min(bestO, batch(runO, nO));
    }
    await yieldToUi();
  }
  return { orig: bestO, fast: bestF, speedup: bestO / bestF, rounds: r, outOrig: outO, outFast: outF };
}

// ---- the race -------------------------------------------------------------

const KEY = "nodepod-key";
const SALT = "nodepod-salt";
const ALGS = {
  sha256: { call: (I, d) => I.sha256(d), subtle: "SHA-256", title: "sha256", what: "Digest" },
  sha384: { call: (I, d) => I.sha384(d), subtle: "SHA-384", title: "sha384", what: "Digest" },
  sha512: { call: (I, d) => I.sha512(d), subtle: "SHA-512", title: "sha512", what: "Digest" },
  sha1: { call: (I, d) => I.sha1(d), subtle: "SHA-1", title: "sha1", what: "Digest" },
  md5: { call: (I, d) => I.md5(d), title: "md5", what: "Digest", none: "md5" },
  "hmac-sha256": { call: (I, d) => I.hmac(I.sha256, KEY, d), hmac: "SHA-256", title: `hmac(sha256, "${KEY}", message)`, what: "Digest" },
  "pbkdf2-sha256": { call: (I, d, p) => I.pbkdf2(I.sha256, d, SALT, { c: p, dkLen: 32 }), pbkdf2: "SHA-256", kdf: "pbkdf2", title: "pbkdf2 with sha256", what: "Derived key" },
  "pbkdf2-sha512": { call: (I, d, p) => I.pbkdf2(I.sha512, d, SALT, { c: p, dkLen: 32 }), pbkdf2: "SHA-512", kdf: "pbkdf2", title: "pbkdf2 with sha512", what: "Derived key" },
  scrypt: { call: (I, d, p) => I.scrypt(d, SALT, { N: p, r: 8, p: 1, dkLen: 32 }), kdf: "scrypt", title: "scrypt", what: "Derived key", none: "scrypt" },
};
const PARAMS = {
  pbkdf2: { label: "Iterations", options: [[1000, "1,000"], [10000, "10,000"], [100000, "100,000"]], def: 10000 },
  scrypt: { label: "Cost N (r = 8, p = 1)", options: [[4096, "2^12 (4,096)"], [16384, "2^14 (16,384)"], [32768, "2^15 (32,768)"]], def: 16384 },
};
const SAMPLES = [
  { id: "debounce.js", label: "6 KB module (lodash debounce)" },
  { id: "three.tsl.js", label: "37 KB module (three.tsl)" },
  { id: "three.module.js", label: "660 KB bundle (three.module)" },
  { id: "react-dom-client.js", label: "1.2 MB bundle (react-dom)" },
];

const algSel = $("#alg");
const paramSel = $("#param");
const select = $("#input");
select.append(h("option", { value: "text" }, "Typed text (box below)"));
for (const s of SAMPLES) select.append(h("option", { value: s.id }, s.label));
algSel.value = "sha512";
select.value = "three.module.js";
let custom = null; // { name, bytes }

const view = lanes($("#lanes"), { orig: "@noble/hashes 1.8.0", fast: "fast-noble-hashes" });
view.subs(`${fmtBytes(so.raw)} demo bundle`, `${fmtBytes(sf.raw)} demo bundle`);

function syncControls() {
  const alg = ALGS[algSel.value];
  const p = PARAMS[alg.kdf];
  $("#param-field").hidden = !p;
  if (p && paramSel.dataset.kind !== alg.kdf) {
    paramSel.dataset.kind = alg.kdf;
    paramSel.innerHTML = "";
    for (const [v, label] of p.options) paramSel.append(h("option", { value: String(v) }, label));
    paramSel.value = String(p.def);
    $("#param-label").textContent = p.label;
  }
  // a key derivation takes a password: typed text, unless a file was chosen
  if (alg.kdf && select.value !== "text" && select.value !== "custom") select.value = "text";
  $("#text-row").hidden = select.value !== "text";
}

async function input() {
  if (select.value === "text") return $("#text").value;
  if (select.value === "custom") return custom.bytes;
  return sample(select.value);
}

/** the same result from the browser's own WebCrypto, where it has the function */
async function webCrypto(alg, data, param) {
  if (alg.none) return { status: "none" };
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return { status: "unavailable" };
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  try {
    let out;
    if (alg.subtle) out = await subtle.digest(alg.subtle, bytes);
    else if (alg.hmac) {
      const key = await subtle.importKey("raw", enc.encode(KEY), { name: "HMAC", hash: alg.hmac }, false, ["sign"]);
      out = await subtle.sign("HMAC", key, bytes);
    } else {
      const key = await subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveBits"]);
      out = await subtle.deriveBits({ name: "PBKDF2", hash: alg.pbkdf2, salt: enc.encode(SALT), iterations: param }, key, 256);
    }
    return { status: "ok", hex: orig.bytesToHex(new Uint8Array(out)) };
  } catch {
    return { status: "error" };
  }
}

const badge = (cls, text, icon = "") => h("span", { class: `badge ${cls}`, html: `${icon}${text}` });

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
    syncControls();
    const alg = ALGS[algSel.value];
    const param = alg.kdf ? Number(paramSel.value) : 0;
    const data = await input();
    const r = await raceSync(() => alg.call(orig, data, param), () => alg.call(fast, data, param));
    const hex = orig.bytesToHex(r.outFast);
    const equal = bytesEqual(r.outOrig, r.outFast);
    view.show({ orig: r.orig, fast: r.fast, equal, detail: `${hex.length} hex characters` });
    $("#digest-label").textContent = `${alg.what}, hex`;
    $("#digest").textContent = hex;

    // an independent check: the browser's own implementation
    const verdict = $(".verdict", $("#lanes"));
    const w = await webCrypto(alg, data, param);
    if (w.status === "ok" && w.hex === hex) verdict.append(badge("ok", "Also identical to the browser's WebCrypto", CHECK));
    else if (w.status === "ok") verdict.append(badge("bad", "WebCrypto returns different bytes", CROSS));
    else if (w.status === "none") verdict.append(badge("info", `WebCrypto has no ${alg.none}, so there is nothing to check this against`));
    else if (w.status === "error") verdict.append(badge("info", "WebCrypto could not check this input"));
    else verdict.append(badge("info", "WebCrypto is not available in this context"));

    let describe;
    if (select.value === "text") describe = `${fmtInt(enc.encode(data).length)} bytes of typed text, passed as a string`;
    else if (select.value === "custom") describe = `${custom.name}, ${fmtBytes(data.length)}, passed as bytes`;
    else describe = `${select.value}, ${fmtBytes(data.length)}, passed as bytes`;
    let what = alg.title;
    if (alg.kdf === "pbkdf2") what += `, ${fmtInt(param)} iterations, 32-byte key, input as the password`;
    else if (alg.kdf === "scrypt") what += `, N = ${fmtInt(param)}, r = 8, p = 1, 32-byte key, input as the password`;
    $("#info").textContent = `${what}: ${describe}. Best of ${r.rounds} interleaved rounds.`;
  } catch (e) {
    view.error(errMessage(e));
  } finally {
    btn.disabled = false;
    running = false;
    if (again) {
      again = false;
      run();
    }
  }
}

algSel.addEventListener("change", () => {
  syncControls();
  run();
});
paramSel.addEventListener("change", run);
select.addEventListener("change", () => {
  if (select.value !== "custom") custom = null;
  syncControls();
  run();
});
let typing;
$("#text").addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(run, 450);
});
$("#run").addEventListener("click", run);
onFile($("#file"), (bytes, name) => {
  custom = { name, bytes };
  if (!select.querySelector('option[value="custom"]')) select.append(h("option", { value: "custom" }, ""));
  select.querySelector('option[value="custom"]').textContent = `${name} (${fmtBytes(bytes.length)})`;
  select.value = "custom";
  syncControls();
  run();
});
syncControls();
whenIdle(run);

// ---- message length against speedup ---------------------------------------

const SIZES = [16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576];
const sizeLabel = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${n / 1024} KB` : `${n / 1048576} MB`);
function noise(n) {
  const a = new Uint8Array(n);
  let x = 0x9e3779b9;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    a[i] = x & 255;
  }
  return a;
}

$("#sweep-run").addEventListener("click", async () => {
  const btn = $("#sweep-run");
  const out = $("#sweep-out");
  const name = $("#sweep-alg").value;
  btn.disabled = true;
  $("#sweep-alg").disabled = true;
  out.innerHTML = "";
  out.append(h("div", { class: "sweep-key", html: "<span><i></i>@noble/hashes, the full width of a row</span><span><i class=\"f\"></i>fast-noble-hashes</span>" }));
  const rows = SIZES.map((n) => {
    const bo = h("i", { style: "width:100%" });
    const bf = h("i", { class: "f", style: "width:0" });
    const t = h("small", { class: "sweep-t" }, "");
    const x = h("span", { class: "sweep-x" }, "");
    out.append(h("div", { class: "sweep-row" }, h("span", { class: "nm" }, sizeLabel(n)), h("div", { class: "sweep-bars" }, bo, bf, t), x));
    return { bo, bf, t, x };
  });
  for (let i = 0; i < SIZES.length; i++) {
    const msg = noise(SIZES[i]);
    const r = await raceSync(() => orig[name](msg), () => fast[name](msg), { rounds: 5, budgetMs: 700 });
    const row = rows[i];
    row.bf.style.width = `${Math.max(0.8, Math.min(100, (r.fast / r.orig) * 100))}%`;
    row.t.textContent = `noble ${fmtTime(r.orig)}, fast ${fmtTime(r.fast)}`;
    if (!bytesEqual(r.outOrig, r.outFast)) row.x.textContent = "differs";
    else if (r.speedup < 1) {
      row.x.textContent = `${(1 / r.speedup).toFixed(1)}x slower`;
      row.x.classList.add("slower");
    } else row.x.textContent = `${fmtX(r.speedup)}x`;
  }
  btn.disabled = false;
  $("#sweep-alg").disabled = false;
  btn.textContent = "Run again";
});

// ---- as you type ----------------------------------------------------------

const LIVE = [
  ["sha256", "sha256", "SHA-256"],
  ["sha512", "sha512", "SHA-512"],
  ["md5", "md5", null],
];
const liveRows = LIVE.map(([id, label, subtle]) => {
  const a = h("dd", {}, "");
  const b = h("dd", {}, "");
  const status = h("div", { class: "live-status" });
  $("#live").append(
    h("div", { class: "live-row" },
      h("div", { class: "live-name" }, label),
      h("dl", { class: "live-digests" },
        h("div", { class: "o" }, h("dt", {}, "@noble/hashes"), a),
        h("div", { class: "f" }, h("dt", {}, "fast-noble-hashes"), b)),
      status),
  );
  return { id, subtle, a, b, status };
});
let liveSeq = 0;
function updateLive() {
  const s = $("#live-in").value;
  const seq = ++liveSeq;
  $("#live-bytes").textContent = `${fmtInt(enc.encode(s).length)} bytes as UTF-8`;
  for (const row of liveRows) {
    const a = orig.bytesToHex(orig[row.id](s));
    const b = fast.bytesToHex(fast[row.id](s));
    row.a.textContent = a;
    row.b.textContent = b;
    row.status.innerHTML = "";
    row.status.append(a === b ? badge("ok", "Same digest", CHECK) : badge("bad", "Digests differ", CROSS));
    if (!row.subtle) row.status.append(badge("info", "WebCrypto has no md5"));
    else if (globalThis.crypto?.subtle) {
      const w = badge("info", "Asking WebCrypto");
      row.status.append(w);
      crypto.subtle.digest(row.subtle, enc.encode(s)).then(
        (buf) => {
          if (seq !== liveSeq) return;
          const same = orig.bytesToHex(new Uint8Array(buf)) === b;
          w.className = `badge ${same ? "ok" : "bad"}`;
          w.innerHTML = same ? `${CHECK}WebCrypto agrees` : `${CROSS}WebCrypto differs`;
        },
        () => {
          if (seq === liveSeq) w.textContent = "WebCrypto could not check this";
        },
      );
    }
  }
}
$("#live-in").addEventListener("input", updateLive);
updateLive();

// ---- templates and the wasm they expand to --------------------------------
// The page runs the package's own _fast.js (from the repository, not the
// bundled copy of the demo above), so the sizes and the expansion are the
// real ones.

const FAMS = [
  { id: "SHA256", label: "SHA-256", tpl: "WASM_SHA256", args: [64, 8, 8], k: 64 },
  { id: "SHA512", label: "SHA-512", tpl: "WASM_SHA512", args: [128, 16, 8], k: 80 },
  { id: "SHA1", label: "SHA-1", tpl: "WASM_SHA1", args: [64, 8, 5] },
  { id: "MD5", label: "MD5", tpl: "WASM_MD5", args: [64, 8, 4], x: "MD5_X" },
];
// memory offset of the round constants in every family module (KB in _fast.ts)
const KB = 64896;

const family = (M, f) => M.wasmFamily(M[f.tpl], ...f.args, f.k ? M.K(f.k) : undefined, f.x ? M[f.x] : undefined);
/** the module with a custom section no other compile has seen, so the engine cannot reuse an earlier compile */
function salted(bytes) {
  const name = [...enc.encode("salt")];
  const payload = [...crypto.getRandomValues(new Uint8Array(8))];
  const body = [name.length, ...name, ...payload];
  const out = new Uint8Array(bytes.length + 2 + body.length);
  out.set(bytes);
  out.set([0, body.length, ...body], bytes.length);
  return out;
}
/** the steps of the first use of a family (inst() in _fast.ts), each timed */
function firstUse(M, f) {
  const fam = family(M, f);
  const t0 = now();
  const bytes = M.expand(fam);
  const t1 = now();
  const mod = new WebAssembly.Module(salted(bytes));
  const t2 = now();
  const inst = new WebAssembly.Instance(mod);
  const t3 = now();
  if (fam.k) new BigUint64Array(inst.exports.m.buffer, KB).set(fam.k());
  const t4 = now();
  return { expand: t1 - t0, compile: t2 - t1, instantiate: t3 - t2, constants: t4 - t3, total: t4 - t0 };
}

let internals;
const tplRows = new Map();
async function initTemplates() {
  const M = await import("../../../packages/fast-noble-hashes/esm/_fast.js");
  internals = M;
  const bar = $("#tpl-bars");
  bar.innerHTML = "";
  const max = 11252;
  const add = (name, bytes, kind, title, gap) => {
    const fill = h("div", { class: "fill", style: `width:${Math.max(1, (bytes / max) * 100)}%` });
    const row = h("div", { class: `meter-row ${kind}${gap ? " gap" : ""}`, title }, h("span", {}, name), h("div", { class: "track" }, fill), h("span", { class: "val" }, `${fmtInt(bytes)} bytes`));
    bar.append(row);
  };
  const common = M.bytes(M.COMMON).length;
  add("Common template", common, "fast", `${fmtInt(M.COMMON.length)} characters of text in the JavaScript. Shared by every family.`);
  const sizes = {};
  for (const f of FAMS) {
    const t = M.bytes(M[f.tpl]).length;
    const e = M.expand(family(M, f)).length;
    sizes[f.id] = { t, e, chars: M[f.tpl].length };
    add(`${f.label} template`, t, "fast", `${fmtInt(M[f.tpl].length)} characters of text in the JavaScript`, true);
    add(`${f.label} expanded`, e, "", `What the engine compiles the first time ${f.label} is used`);
  }
  const scrypt = M.bytes(M.WASM_SCRYPT).length;
  add("scrypt module", scrypt, "fast", `${fmtInt(M.WASM_SCRYPT.length)} characters of text. Shipped as the module itself, not as a template.`, true);
  const s = sizes.SHA256;
  $("#tpl-sum").textContent = `A bundle that imports only sha256 carries the common template and SHA-256's: ${fmtInt(common)} + ${fmtInt(s.t)} = ${fmtInt(common + s.t)} bytes, ${fmtInt(M.COMMON.length + s.chars)} characters as text. It expands to ${fmtInt(s.e)} bytes of WebAssembly, ${(s.e / (common + s.t)).toFixed(1)} times as much.`;
  $("#tpl-run").disabled = false;
}

let tplRuns = 0;
$("#tpl-run").addEventListener("click", async () => {
  const btn = $("#tpl-run");
  btn.disabled = true;
  const body = $("#tpl-table tbody");
  body.innerHTML = "";
  const WARM = 25;
  let allValid = true;
  const mean = (list, k) => list.reduce((a, r) => a + r[k], 0) / list.length;
  for (const f of FAMS) {
    await yieldToUi();
    const first = firstUse(internals, f);
    const runs = [];
    for (let i = 0; i < WARM; i++) runs.push(firstUse(internals, f));
    allValid = allValid && WebAssembly.validate(internals.expand(family(internals, f)));
    body.append(
      h("tr", {},
        h("th", { scope: "row" }, f.label),
        h("td", { class: "num" }, fmtTime(mean(runs, "expand"))),
        h("td", { class: "num" }, fmtTime(mean(runs, "compile"))),
        h("td", { class: "num" }, fmtTime(mean(runs, "instantiate"))),
        h("td", { class: "num" }, f.k ? fmtTime(mean(runs, "constants")) : "from noble's table"),
        h("td", { class: "num" }, h("strong", {}, fmtTime(first.total)))),
    );
  }
  tplRuns++;
  $("#tpl-note").textContent = `${allValid ? "All four expanded modules validate as WebAssembly. " : "A module failed to validate. "}The four step columns are means of ${WARM} runs; the last column is one run, measured once, ${tplRuns === 1 ? "before anything on this page had warmed the expander up" : "after earlier runs had warmed it up"}, and browsers round their timers, so it is only good to about 0.1 ms. Compiles use a fresh custom section each time so the engine cannot reuse an earlier one.`;
  btn.disabled = false;
  btn.textContent = "Run again";
});

$("#tpl-run").disabled = true;
whenIdle(() => initTemplates().catch((e) => ($("#tpl-sum").textContent = `Could not load the templates: ${errMessage(e)}`)));
