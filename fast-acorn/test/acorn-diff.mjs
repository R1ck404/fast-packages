// Differential test for the vendored acorn as fast-acorn ships it (with the
// fast nextToken of fasttok.mjs installed) against pristine acorn 8.18 from
// node_modules: Parser.parse with many option sets (errors included:
// message, pos, loc, raisedAt), onToken / onComment output, tokenizer()
// token streams, a Parser.extend() subclass (Nodepod's topLevelParser), and
// the same on mutated inputs (truncations, random edits) so error paths are
// exercised too.
//
// node fast-acorn/test/acorn-diff.mjs [--limit N] [--dir path] [--nodepod] [--mutations N] [--quick]
import * as ref from "acorn";
import * as V from "../vendor/acorn.mjs";
// everything fast-acorn installs on the vendored acorn (fasttok's nextToken,
// the parseFunctionBody hook); parses below use the instance parse() so
// they run acorn itself, not the fast parser behind Parser.parse
import "../index.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const argVal = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const limit = Number(argVal("--limit", Infinity));
const mutations = Number(argVal("--mutations", 3));
const quick = args.includes("--quick");
const here = fileURLToPath(new URL(".", import.meta.url));
const dirs = args.includes("--dir")
  ? [argVal("--dir")]
  : [join(here, "../../node_modules"), ...(args.includes("--nodepod") ? [join(here, "../../../Nodepod/node_modules/.pnpm")] : [])];

function collect(dir, out, seen) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === ".git") continue;
      collect(p, out, seen);
    } else if (/\.(m|c)?js$/.test(e.name)) {
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.size > 3_000_000 || st.size === 0) continue;
      const key = st.size + ":" + e.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
}

// ---- serialization (TokenType objects compared by label/keyword)
const replacer = (k, v) => {
  if (typeof v === "bigint") return { $bigint: v.toString() };
  if (v instanceof RegExp) return { $re: String(v) };
  if (v instanceof ref.TokenType || v instanceof V.TokenType) return { $tt: v.label, kw: v.keyword };
  if (typeof v === "function") return { $fn: v.name };
  return v;
};
const ser = (x) => JSON.stringify(x, replacer);
function errSer(e) {
  if (!(e instanceof Error)) return "THROW " + String(e);
  return `${e.constructor.name}: ${e.message} pos=${e.pos} loc=${e.loc && e.loc.line + ":" + e.loc.column} raisedAt=${e.raisedAt}`;
}
function protoSer(ast, NodeCls, PosCls, SLCls) {
  // prototype checks on a sample of nodes
  let bad = 0, n = 0;
  (function walk(x) {
    if (!x || typeof x !== "object" || n > 2000) return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x.type === "string") {
      n++;
      if (Object.getPrototypeOf(x) !== NodeCls.prototype) bad++;
      if (x.loc && (Object.getPrototypeOf(x.loc) !== SLCls.prototype || Object.getPrototypeOf(x.loc.start) !== PosCls.prototype)) bad++;
    }
    for (const k in x) if (k !== "loc" && k !== "range") walk(x[k]);
  })(ast);
  return bad;
}

// Nodepod's topLevelParser (src/syntax-transforms.ts), for either acorn
function topLevel(lib) {
  const tt = lib.tokTypes;
  return lib.Parser.extend(
    (Base) =>
      class extends Base {
        parseFunctionBody(node, isArrowFunction, isMethod, forInit) {
          const self = this;
          if (self.type !== tt.braceL) {
            super.parseFunctionBody(node, isArrowFunction, isMethod, forInit);
            return;
          }
          const body = self.startNode();
          let depth = 0;
          do {
            if (self.type === tt.braceL || self.type === tt.dollarBraceL) depth++;
            else if (self.type === tt.braceR) depth--;
            else if (self.type === tt.eof) self.unexpected();
            self.next();
          } while (depth > 0);
          body.body = [];
          node.body = self.finishNode(body, "BlockStatement");
          node.expression = false;
          self.exitScope();
        }
      },
  );
}
const TopRef = topLevel(ref), TopV = topLevel(V);

let checks = 0, fails = 0, errsBoth = 0, shown = 0;
function report(what, file, detail) {
  fails++;
  if (shown++ < 20) console.log(`MISMATCH ${what} ${file}\n  ${detail}`);
}
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `@${i}: ref …${a.slice(Math.max(0, i - 100), i + 100)}…\n   fast …${b.slice(Math.max(0, i - 100), i + 100)}…`;
}

function run(fn) {
  try {
    return { ok: true, v: fn() };
  } catch (e) {
    return { ok: false, e };
  }
}

// parse with options; callbacks recorded per side
function checkParse(what, file, code, opts, RefP = ref.Parser, VP = V.Parser) {
  const mk = () => {
    const log = [];
    const o = { ...opts };
    if (opts.onComment === "fn") o.onComment = (...a) => log.push(["c", ...a]);
    else if (opts.onComment === "array") o.onComment = log;
    if (opts.onToken === "fn") o.onToken = (t) => log.push(["t", t]);
    else if (opts.onToken === "array") o.onToken = log;
    if (opts.onInsertedSemicolon) o.onInsertedSemicolon = (...a) => log.push(["s", ...a]);
    if (opts.onTrailingComma) o.onTrailingComma = (...a) => log.push(["tc", ...a]);
    return { o, log };
  };
  const a = mk(), b = mk();
  const ra = run(() => RefP.parse(code, a.o));
  const rb = run(() => new VP(b.o, code).parse());
  checks++;
  if (!ra.ok || !rb.ok) {
    const sa = ra.ok ? "OK" : errSer(ra.e), sb = rb.ok ? "OK" : errSer(rb.e);
    if (sa !== sb) return report(what, file, `ref: ${sa}\n  fast: ${sb}`);
    const la = ser(a.log), lb = ser(b.log);
    if (la !== lb) return report(what + " (callbacks before error)", file, firstDiff(la, lb));
    errsBoth++;
    return;
  }
  const sa = ser(ra.v) + "\u0000" + ser(a.log), sb = ser(rb.v) + "\u0000" + ser(b.log);
  if (sa !== sb) return report(what, file, firstDiff(sa, sb));
  if (protoSer(rb.v, V.Node, V.Position, V.SourceLocation)) report(what + " (prototypes)", file, "");
}

function tokens(lib, code, opts) {
  const out = [];
  try {
    const t = lib.tokenizer(code, opts);
    for (let i = 0; ; i++) {
      const tok = t.getToken();
      out.push(tok);
      if (tok.type === lib.tokTypes.eof || i > 5e6) break;
    }
  } catch (e) {
    out.push("ERR " + errSer(e));
  }
  return out;
}
function checkTokens(what, file, code, opts) {
  checks++;
  const a = ser(tokens(ref, code, opts)), b = ser(tokens(V, code, opts));
  if (a !== b) report(what, file, firstDiff(a, b));
}

// deterministic PRNG
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const SNIPPETS = ["/", "`", "${", "}", "{", "(", ")", "'", '"', "\\", "\\u0061", "/*", "*/", "//", "\n", "\r\n", " ", "#", "@", "0x", "1_0", "08", "1n", ".5e", "<!--", "-->", "=>", "?.", "??=", "**", "a", " ", "yield", "await", "async", "of", "let", "é", "😀", "class", "function", "if", "\t", " ", "﻿"];
function mutate(code) {
  const r = rnd();
  const pos = Math.floor(rnd() * code.length);
  if (r < 0.3) return code.slice(0, pos);
  if (r < 0.6) return code.slice(0, pos) + SNIPPETS[Math.floor(rnd() * SNIPPETS.length)] + code.slice(pos);
  if (r < 0.8) return code.slice(0, pos) + code.slice(pos + 1 + Math.floor(rnd() * 20));
  // window around pos
  return code.slice(Math.max(0, pos - 2000), pos + 2000);
}

const files = [];
const seen = new Set();
for (const d of dirs) collect(d, files, seen);
console.log(`${files.length} files`);
const t0 = performance.now();
for (const file of files) {
  let code;
  try {
    code = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const isModule = /\.mjs$/.test(file) || /^\s*(import|export)\b/m.test(code);
  const sourceType = isModule ? "module" : "script";
  const base = { ecmaVersion: "latest", sourceType };
  checkParse("parse", file, code, base);
  checkParse("parse+locs+ranges+onComment(array)", file, code, { ...base, locations: true, ranges: true, onComment: "array" });
  checkTokens("tokenizer", file, code, base);
  if (!quick) {
    checkParse("parse+onToken(fn)+onComment(fn)+locs", file, code, { ...base, locations: true, onToken: "fn", onComment: "fn", onInsertedSemicolon: true, onTrailingComma: true });
    checkParse("parse other sourceType", file, code, { ecmaVersion: "latest", sourceType: isModule ? "script" : "module", allowHashBang: true });
    checkParse("parse ecma2020", file, code, { ecmaVersion: 2020, sourceType, locations: true });
    checkTokens("tokenizer+locs+ranges", file, code, { ...base, locations: true, ranges: true });
  }
  checkParse("topLevelParser", file, code, { ecmaVersion: "latest", sourceType: "module" }, TopRef, TopV);
  if (!quick) checkParse("topLevelParser+locs", file, code, { ecmaVersion: "latest", sourceType: "module", locations: true, ranges: true }, TopRef, TopV);
  for (let m = 0; m < mutations; m++) {
    const mc = mutate(code);
    checkParse("mutated parse", file, mc, { ...base, locations: (m & 1) === 0 });
    checkTokens("mutated tokenizer", file, mc, base);
    if (m === 0) checkParse("mutated topLevelParser", file, mc, { ecmaVersion: "latest", sourceType: "module" }, TopRef, TopV);
  }
}
console.log(`checks ${checks}, both-error ${errsBoth}, MISMATCH ${fails}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
