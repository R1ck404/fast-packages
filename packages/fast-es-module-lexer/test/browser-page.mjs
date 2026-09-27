// In-browser half of browser.mjs: parse every source with es-module-lexer
// and @r1ck404/fast-es-module-lexer in the page, compare results/errors.
export async function run(fastUrl, origUrl, urls, extra) {
  const F = await import(fastUrl);
  const O = await import(origUrl);
  await F.init;
  await O.init;
  const ser = (x) => JSON.stringify(x, (k, v) => (v === undefined ? "\u0000undef" : v));
  const res = (P, s) => {
    try {
      const r = P.parse(s);
      return ser(r) + (r[0] || []).map((o) => Object.keys(o).join()).join("|") + "/" + (r[1] || []).map((o) => Object.keys(o).join()).join("|");
    } catch (e) {
      return "ERR " + e.message + " " + e.idx;
    }
  };
  const dec = new TextDecoder();
  const srcs = [...extra];
  for (const u of urls) srcs.push(dec.decode(new Uint8Array(await (await fetch(u)).arrayBuffer())));
  let checks = 0, fails = [], fbDiff = 0;
  for (const s of srcs) {
    for (const v of [s, "/*ħ😀*/" + s, s.slice(0, s.length >> 1)]) {
      checks++;
      const a = res(O, v), fb = F.__stats.fallback, b = res(F, v);
      // (a fallback runs the vendored original, whose stale memory differs:
      // only inputs on which the original reads stale memory fall back)
      if (a !== b && F.__stats.fallback > fb) fbDiff++;
      else if (a !== b) fails.push({ src: v.slice(0, 120), a: a.slice(0, 200), b: b.slice(0, 200) });
    }
  }
  return { checks, fails: fails.slice(0, 5), nfails: fails.length, fbDiff, fallbacks: F.__stats.fallback, mode: F.__stats.mode, ua: navigator.userAgent };
}
