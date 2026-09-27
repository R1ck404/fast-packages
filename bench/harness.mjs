// Tiny benchmark harness. Each case runs in-process; the driver (compare.mjs)
// runs every implementation in its own node process so JIT/GC state from one
// implementation never leaks into another's numbers.

import { performance } from "node:perf_hooks";

const now = () => performance.now();

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Measure `fn`. Returns ms per call (median of samples). Calls are batched so a
 * sample lasts at least ~sampleMs even for microsecond-scale functions.
 */
export async function measure(fn, { warmupMs = 300, sampleMs = 25, minSamples = 10, maxTimeMs = 2500, bytes = 0 } = {}) {
  // warmup + estimate cost per call
  let calls = 0;
  const w0 = now();
  let r;
  while (now() - w0 < warmupMs || calls < 3) {
    r = fn();
    if (r && typeof r.then === "function") await r;
    calls++;
  }
  const perCall = (now() - w0) / calls;
  const batch = Math.max(1, Math.ceil(sampleMs / Math.max(perCall, 1e-6)));
  const samples = [];
  const t0 = now();
  while (samples.length < minSamples || (now() - t0 < maxTimeMs && samples.length < 1000)) {
    const s0 = now();
    for (let i = 0; i < batch; i++) {
      r = fn();
      if (r && typeof r.then === "function") await r;
    }
    samples.push((now() - s0) / batch);
    if (now() - t0 > maxTimeMs * 4) break;
  }
  const med = median(samples);
  return {
    ms: med,
    min: Math.min(...samples),
    samples: samples.length,
    batch,
    mbps: bytes ? bytes / 1e6 / (med / 1000) : undefined,
  };
}

/** Run a suite: cases = [{ name, bytes?, setup?, fn }]. Prints JSON lines. */
export async function runSuite(impl, cases, opts = {}) {
  const filter = process.env.BENCH_FILTER ? new RegExp(process.env.BENCH_FILTER) : null;
  const results = [];
  for (const c of cases) {
    if (filter && !filter.test(c.name)) continue;
    let fn = c.fn;
    if (c.setup) fn = await c.setup();
    if (!fn) continue;
    if (global.gc) global.gc();
    const res = await measure(fn, { bytes: c.bytes, ...opts, ...(c.opts || {}) });
    const out = { impl, name: c.name, ...res };
    results.push(out);
    process.stdout.write("RESULT " + JSON.stringify(out) + "\n");
  }
  return results;
}

export function fmtMs(ms) {
  if (ms < 0.001) return (ms * 1e6).toFixed(0) + " ns";
  if (ms < 1) return (ms * 1000).toFixed(1) + " µs";
  if (ms < 1000) return ms.toFixed(2) + " ms";
  return (ms / 1000).toFixed(2) + " s";
}
