// In-browser half of browser.mjs: parse every source with es-module-lexer
// and @r1ck404/fast-es-module-lexer in the page, compare results/errors.
// Where the lexer read outside the source, the answer must be a fresh
// original instance's (see history.mjs). The package is loaded twice: as
// published (its exports must be es-module-lexer's) and with its test hooks
// exported (hooks.mjs: the same code plus one export line).
import { original } from "./original.mjs";

export async function run(fastUrl, origUrl, urls, extra, hooksExport, fuzz) {
  const P = await import(fastUrl);
  const code = await (await fetch(fastUrl)).text();
  const F = await import(URL.createObjectURL(new Blob([code + "\n" + hooksExport + "\n"], { type: "text/javascript" })));
  const O = await import(origUrl);
  const { freshParse } = original(await (await fetch(origUrl)).text());
  await P.init;
  await F.init;
  await O.init;
  const ser = (x) => JSON.stringify(x, (k, v) => (v === undefined ? "\u0000undef" : v));
  const res = (parse, s) => {
    try {
      const r = parse(s);
      return ser(r) + (r[0] || []).map((o) => Object.keys(o).join()).join("|") + "/" + (r[1] || []).map((o) => Object.keys(o).join()).join("|");
    } catch (e) {
      // (JavaScriptCore names the JS expression that called into the trapping
      // wasm in the message: different code, the same trap)
      return "ERR " + e.constructor.name + " " + e.message.replace(/ \(evaluating '[^']*'\)$/, "") + " " + e.idx;
    }
  };
  const dec = new TextDecoder();
  const srcs = [...extra];
  for (const u of urls) srcs.push(dec.decode(new Uint8Array(await (await fetch(u)).arrayBuffer())));
  // token soups cut anywhere
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const TOK = ["import", "export", "default", "async", "function", "class", "from", "as", "with", "{", "}", "(", ")", ",", ";", "=", "/", "'a'", "`${", "}`", "//c\n", "/*c*/", " ", "\n", "x", "return", "import(", "import.meta", "export {", "é", "\ud800"];
  const soups = [];
  for (let t = 0; t < fuzz; t++) {
    let s = "";
    for (let i = 0, k = 1 + ((rnd() * 12) | 0); i < k; i++) s += TOK[(rnd() * TOK.length) | 0] + (rnd() < 0.5 ? " " : "");
    soups.push(rnd() < 0.5 ? s.slice(0, (rnd() * (s.length + 1)) | 0) : s);
  }
  let checks = 0, fails = [], outside = 0;
  const variants = [...srcs.flatMap((s) => [s, "/*ħ😀*/" + s, s.slice(0, s.length >> 1)]), ...soups];
  for (const v of variants) {
    checks++;
    const o0 = F.__stats().outside;
    const b = res(F.parse, v);
    let want;
    if (F.__stats().outside > o0) {
      outside++;
      want = res(freshParse, v);
    } else want = res(O.parse, v);
    if (b !== want) fails.push({ src: v.slice(0, 120), want: want.slice(0, 200), fast: b.slice(0, 200) });
  }
  // the original traps on this one (its records do not fit in its memory),
  // on a fresh instance too; a trapped instance of the original traps on
  // every later parse, this lexer keeps working
  for (const v of ["export{" + "a,".repeat(40000) + "}", "import 'a'"]) {
    checks++;
    const b = res(F.parse, v), want = res(freshParse, v);
    if (b !== want) fails.push({ src: v.slice(0, 120), want: want.slice(0, 200), fast: b.slice(0, 200) });
  }
  const exportsSame = Object.keys(P).sort().join() === Object.keys(O).sort().join();
  if (!exportsSame) fails.push({ exports: Object.keys(P).sort().join(), want: Object.keys(O).sort().join() });
  return { checks, fails: fails.slice(0, 5), nfails: fails.length, outside, mode: F.__stats().mode, ua: navigator.userAgent };
}
