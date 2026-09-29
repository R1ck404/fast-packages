// Shared pieces of every demo: loading the original and the fast build side by
// side, measuring them fairly, and drawing the two lanes.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const root = document.body.dataset.root ?? "";
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) el.append(kid);
  return el;
}

// ---- formatting -----------------------------------------------------------

export function fmtTime(ms) {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 0.001) return `${Math.round(ms * 1e6)} ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(ms < 0.01 ? 2 : ms < 0.1 ? 1 : 0)} µs`;
  if (ms < 10) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

export const fmtInt = (n) => n.toLocaleString("en-US");

export function fmtX(x) {
  if (!Number.isFinite(x)) return "-";
  return x >= 10 ? `${Math.round(x)}` : x.toFixed(1);
}

export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---- loading --------------------------------------------------------------

let manifestPromise;
export function manifest() {
  return (manifestPromise ??= fetch(`${root}assets/manifest.json`).then((r) => r.json()));
}

export async function sizeOf(slug, which, wasm = []) {
  const m = await manifest();
  const files = [`assets/impl/${slug}.${which}.js`, ...wasm.map((w) => `assets/impl/${w}`)];
  const out = { raw: 0, gzip: 0, brotli: 0 };
  for (const f of files) for (const k of Object.keys(out)) out[k] += m[f]?.[k] ?? 0;
  return out;
}

const cache = new Map();
export function loadImpl(slug, which, options = {}) {
  const key = `${slug}.${which}`;
  if (!cache.has(key)) {
    const url = new URL(`${root}assets/impl/${slug}.${which}.js`, location.href).href;
    cache.set(key, import(/* @vite-ignore */ url).then((m) => m.load({ wasmURL: new URL(`${root}assets/impl/esbuild.wasm`, location.href).href, ...options })));
  }
  return cache.get(key);
}

const samples = new Map();
export function sample(name) {
  if (!samples.has(name)) {
    samples.set(name, fetch(`${root}samples/${name}`).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)));
  }
  return samples.get(name);
}
export const sampleText = async (name) => new TextDecoder().decode(await sample(name));

// ---- measuring ------------------------------------------------------------

const now = () => performance.now();

/**
 * Time two implementations of the same job. They alternate in short batches,
 * each is warmed up first, and the best batch of each is kept: the same method
 * as the repository's benchmarks (interleaved, best of several rounds), so a
 * background task hits both alike. Returns milliseconds per call.
 *
 * The page's timer is coarse (about 0.1 ms), so a single call to a fast
 * function can read as zero. The cost of a call is therefore measured on a
 * growing batch until the batch is long enough to time, and the whole
 * measurement stops at `budgetMs`, so a tiny input can never freeze the tab.
 */
export async function race(runOrig, runFast, { rounds = 5, batchMs = 12, budgetMs = 2200 } = {}) {
  const started = now();
  const isAsync = (r) => r && typeof r.then === "function";
  const first = async (fn) => {
    const r = fn();
    return isAsync(r) ? [await r, true] : [r, false];
  };
  const [outO, asyncO] = await first(runOrig);
  const [outF, asyncF] = await first(runFast);

  // a batch of n calls, in ms per call
  const batch = async (fn, n, useAsync) => {
    const s = now();
    if (useAsync) for (let i = 0; i < n; i++) await fn();
    else for (let i = 0; i < n; i++) fn();
    return (now() - s) / n;
  };

  // grow the batch until it lasts long enough to time reliably (this also warms the code up)
  const calibrate = async (fn, useAsync) => {
    let n = 1;
    for (;;) {
      const s = now();
      await batch(fn, n, useAsync);
      const dt = now() - s;
      if (dt >= 3 || n >= 1 << 20 || now() - started > budgetMs / 2) return Math.max(dt / n, 1e-5);
      n *= dt < 0.3 ? 8 : 2;
    }
  };
  const oneO = await calibrate(runOrig, asyncO);
  const oneF = await calibrate(runFast, asyncF);
  const nO = Math.min(1 << 20, Math.max(1, Math.ceil(batchMs / oneO)));
  const nF = Math.min(1 << 20, Math.max(1, Math.ceil(batchMs / oneF)));

  let bestO = Infinity;
  let bestF = Infinity;
  let done = 0;
  // at least two rounds (one in each order), at most `rounds`, and never past the budget
  while (done < rounds && (done < 2 || now() - started < budgetMs)) {
    if (done % 2 === 0) {
      bestO = Math.min(bestO, await batch(runOrig, nO, asyncO));
      bestF = Math.min(bestF, await batch(runFast, nF, asyncF));
    } else {
      bestF = Math.min(bestF, await batch(runFast, nF, asyncF));
      bestO = Math.min(bestO, await batch(runOrig, nO, asyncO));
    }
    done++;
    await yieldToUi();
  }
  return { orig: bestO, fast: bestF, speedup: bestO / bestF, rounds: done, outOrig: outO, outFast: outF };
}

// ---- the two lanes --------------------------------------------------------

const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

/**
 * Two horizontal lanes (original, fast) with the measured time, the speedup and
 * whether the outputs matched. `names` are { orig, fast, origSub, fastSub }.
 */
export function lanes(el, names) {
  el.classList.add("lanes-root");
  el.innerHTML = `
    <div class="lanes" role="group" aria-label="Timing comparison">
      <div class="lane orig idle"><div class="lane-name"><b></b><small></small></div><div class="lane-track"><div class="lane-bar"></div></div><div class="lane-time" aria-live="polite">-</div></div>
      <div class="lane fast idle"><div class="lane-name"><b></b><small></small></div><div class="lane-track"><div class="lane-bar"></div></div><div class="lane-time" aria-live="polite">-</div></div>
    </div>
    <div class="verdict" aria-live="polite"></div>`;
  const [lo, lf] = $$(".lane", el);
  const verdict = $(".verdict", el);
  const set = (lane, title, sub) => {
    $("b", lane).textContent = title;
    $("small", lane).textContent = sub ?? "";
  };
  set(lo, names.orig, names.origSub);
  set(lf, names.fast, names.fastSub);

  return {
    subs(origSub, fastSub) {
      set(lo, names.orig, origSub);
      set(lf, names.fast, fastSub);
    },
    busy(message = "") {
      for (const l of [lo, lf]) {
        l.classList.remove("idle");
        l.classList.add("busy");
      }
      $(".lane-time", lo).textContent = "";
      $(".lane-time", lf).textContent = "";
      verdict.innerHTML = message ? `<span class="badge info">${message}</span>` : "";
    },
    /** timings in ms; `equal` is true/false/null (unknown); `detail` is what matched */
    /**
     * `noSpeed` replaces the speedup with that text, for results that are not a fair
     * speed comparison (both sides threw); `okText` replaces "Output identical".
     */
    show({ orig, fast, equal, detail, replay = 0, label = "faster", noSpeed = "", okText = "Output identical" }) {
      const slowest = Math.max(orig, fast);
      for (const [lane, ms] of [[lo, orig], [lf, fast]]) {
        lane.classList.remove("busy", "idle");
        $(".lane-time", lane).textContent = fmtTime(ms);
        const bar = $(".lane-bar", lane);
        bar.style.transition = replay ? "none" : "";
        bar.style.width = "0%";
        void bar.offsetWidth;
        if (replay) {
          // replay the measured times at a slower, common speed so the race is visible
          bar.style.transition = `width ${(ms * replay).toFixed(0)}ms linear`;
        }
        bar.style.width = `${Math.max(1.5, (ms / slowest) * 100)}%`;
      }
      const x = orig / fast;
      const slower = x < 1;
      const speed = noSpeed
        ? `<span class="speedup-none">${noSpeed}</span>`
        : slower
          ? `<span class="speedup slower">${(1 / x).toFixed(1)}x<small>slower</small></span>`
          : `<span class="speedup">${fmtX(x)}x<small>${label}</small></span>`;
      let badge = "";
      if (equal === true) badge = `<span class="badge ok">${CHECK}${okText}${detail ? `, ${detail}` : ""}</span>`;
      else if (equal === false) badge = `<span class="badge bad">${CROSS}Outputs differ${detail ? `: ${detail}` : ""}</span>`;
      verdict.innerHTML = speed + badge;
    },
    error(message) {
      for (const l of [lo, lf]) l.classList.remove("busy");
      verdict.innerHTML = `<span class="badge bad">${CROSS}${message}</span>`;
    },
    reset() {
      for (const l of [lo, lf]) {
        l.classList.remove("busy");
        l.classList.add("idle");
        $(".lane-bar", l).style.width = "0%";
        $(".lane-time", l).textContent = "-";
      }
      verdict.innerHTML = "";
    },
  };
}

// ---- inputs ---------------------------------------------------------------

/** wire a <input type=file> that hands back the chosen file's bytes */
export function onFile(input, cb) {
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    if (!f) return;
    cb(new Uint8Array(await f.arrayBuffer()), f.name);
    input.value = "";
  });
}

export function tabs(el, items, onSelect, initial = 0) {
  el.setAttribute("role", "tablist");
  el.innerHTML = "";
  const buttons = items.map((item, i) => {
    const b = h("button", { type: "button", role: "tab", "aria-selected": String(i === initial) }, item.label);
    b.addEventListener("click", () => select(i));
    const li = h("li", {}, b);
    el.append(li);
    return b;
  });
  function select(i) {
    buttons.forEach((b, j) => b.setAttribute("aria-selected", String(i === j)));
    onSelect(items[i], i);
  }
  return { select };
}

export const errMessage = (e) => (e && e.message ? e.message : String(e));

/** click "Run" once the page is idle, not while the fonts and scripts still load */
export function whenIdle(fn) {
  if ("requestIdleCallback" in window) requestIdleCallback(() => fn(), { timeout: 1500 });
  else setTimeout(fn, 300);
}

/**
 * Wrap an async job so that asking for it while it is running does not start a
 * second copy: the request is remembered and the job runs once more when the
 * current run ends (so the final control state always wins).
 */
export function serialized(job) {
  let running = false;
  let again = false;
  return async function run(...args) {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await job(...args);
    } finally {
      running = false;
      if (again) {
        again = false;
        run(...args);
      }
    }
  };
}
