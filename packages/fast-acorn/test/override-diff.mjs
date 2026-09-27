// Differential test for Parser.extend() subclasses that override
// parseFunctionBody (override.mjs): for each variant, the class built on
// acorn 8.18 (node_modules) vs the class built on @r1ck404/fast-acorn's Parser, over
// the corpus and mutations of it: identical result or error (message, pos,
// loc, raisedAt), compared with a serializer that also covers object
// identity (shared nodes / Positions), prototypes and key order. Variants
// that must be recognised are checked to take the fast path; variants that
// must not be recognised are checked to be rejected.
//
// node packages/fast-acorn/test/override-diff.mjs [--limit N] [--nodepod] [--mutations N]
import * as ref from "acorn";
import * as fast from "../index.mjs";
import * as V from "../vendor/acorn.mjs";
import { bodyOverrideOf } from "../override.mjs";
import { fastParse, BAIL } from "../parser.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const argVal = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const limit = Number(argVal("--limit", Infinity));
const mutations = Number(argVal("--mutations", 2));
const here = fileURLToPath(new URL(".", import.meta.url));
const dirs = [join(here, "../../../node_modules"), ...(args.includes("--nodepod") ? [join(here, "../../../../Nodepod/node_modules/.pnpm")] : [])];

// ---- variants: (lib) => class
let sideEffects = 0;
const ACCEPT = {
  // Nodepod's topLevelParser (src/syntax-transforms.ts)
  topLevel: (lib) => {
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
  },
  // the same as esbuild minifies it
  topLevelMinified: (lib) => {
    const s = lib.tokTypes;
    // prettier-ignore
    return lib.Parser.extend((e) => class extends e{parseFunctionBody(e,t,n,r){const i=this;if(i.type!==s.braceL){super.parseFunctionBody(e,t,n,r);return}const o=i.startNode();let a=0;do i.type===s.braceL||i.type===s.dollarBraceL?a++:i.type===s.braceR?a--:i.type===s.eof&&i.unexpected(),i.next();while(a>0);o.body=[],e.body=i.finishNode(o,"BlockStatement"),e.expression=!1,i.exitScope()}});
  },
  // pass-through that records what it sees into the AST
  recorder: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseFunctionBody(node, a, b, c) {
            node.seen = [a, b, c, this.type, this.value, this.start, this.end, this.pos, this.lastTokStart, this.lastTokEnd];
            node.locs = [this.startLoc, this.endLoc, this.lastTokStartLoc, this.lastTokEndLoc];
            super.parseFunctionBody(node, a, b, c);
            node.after = [this.type, this.start, this.lastTokEnd, this.lastTokEndLoc];
          }
        },
    ),
  // skips bodies with eat/expect, marks nodes, custom node positions
  skipper2: (lib) => {
    const tt = lib.tokTypes;
    return lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseFunctionBody(node, isArrowFunction, isMethod, forInit) {
            const p = this;
            if (p.type !== tt.braceL || isMethod) {
              super.parseFunctionBody(node, isArrowFunction, isMethod, forInit);
              node.kept = true;
              return;
            }
            const startPos = p.start, startLoc = p.startLoc;
            let n = 0;
            for (;;) {
              if (p.eat(tt.braceL) || p.eat(tt.dollarBraceL)) n += 1;
              else if (p.type === tt.braceR) {
                n -= 1;
                p.expect(tt.braceR);
                if (n === 0) break;
              } else if (p.type === tt.eof) p.raise(p.start, "eof");
              else p.next();
            }
            const body = p.startNodeAt(startPos, startLoc);
            body.body = [];
            body.skipped = n === 0 ? "yes" : null;
            node.body = p.finishNodeAt(body, "BlockStatement", p.lastTokEnd, p.lastTokEndLoc);
            node.expression = !1;
            p.exitScope();
            return node;
          }
        },
    );
  },
};
const REJECT = {
  closureCounter: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseFunctionBody(node, a, b, c) {
            sideEffects++;
            super.parseFunctionBody(node, a, b, c);
          }
        },
    ),
  leaksThis: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseFunctionBody(node, a, b, c) {
            node.parser = this;
            super.parseFunctionBody(node, a, b, c);
          }
        },
    ),
  otherMethod: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseFunctionBody(node, a, b, c) {
            if (this.type === lib.tokTypes.braceL) node.test = this.parseExpression();
            super.parseFunctionBody(node, a, b, c);
          }
        },
    ),
  withConstructor: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          constructor(o, i, s) {
            super(o, i, s);
            this.extra = 1;
          }
          parseFunctionBody(node, a, b, c) {
            super.parseFunctionBody(node, a, b, c);
          }
        },
    ),
  withField: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          extra = 1;
          parseFunctionBody(node, a, b, c) {
            super.parseFunctionBody(node, a, b, c);
          }
        },
    ),
  twoMethods: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseFunctionBody(node, a, b, c) {
            super.parseFunctionBody(node, a, b, c);
          }
          parseIdent(liberal) {
            return super.parseIdent(liberal);
          }
        },
    ),
  superOtherArgs: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseFunctionBody(node, a, b, c) {
            super.parseFunctionBody(node, a, true, c);
          }
        },
    ),
  tryCatch: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseFunctionBody(node, a, b, c) {
            try {
              super.parseFunctionBody(node, a, b, c);
            } catch (e) {
              node.failed = true;
            }
          }
        },
    ),
  writesParser: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseFunctionBody(node, a, b, c) {
            this.strict = false;
            super.parseFunctionBody(node, a, b, c);
          }
        },
    ),
  relationalOnOpaque: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseFunctionBody(node, a, b, c) {
            if (this.value > 1) node.big = true;
            super.parseFunctionBody(node, a, b, c);
          }
        },
    ),
};

const classes = {};
for (const [name, mk] of Object.entries(ACCEPT)) {
  classes[name] = { R: mk(ref), F: mk(fast), accept: true };
  if (!bodyOverrideOf(classes[name].F)) throw new Error("not recognised: " + name);
}
for (const [name, mk] of Object.entries(REJECT)) {
  classes[name] = { R: mk(ref), F: mk(fast), accept: false };
  if (bodyOverrideOf(classes[name].F)) throw new Error("wrongly recognised: " + name);
}

// ---- serializer with identity, prototypes and key order
function idSer(root) {
  const ids = new Map();
  let next = 0;
  const out = [];
  (function walk(x) {
    if (x === null || typeof x !== "object") {
      if (typeof x === "bigint") out.push("B" + x);
      else if (typeof x === "function") out.push("F");
      else out.push(JSON.stringify(x === undefined ? "$undef" : x));
      return;
    }
    if (x instanceof ref.TokenType || x instanceof V.TokenType) return out.push("TT:" + x.label);
    if (x instanceof RegExp) return out.push("RE:" + String(x));
    const seen = ids.get(x);
    if (seen !== undefined) return out.push("@" + seen);
    ids.set(x, next++);
    const proto = Object.getPrototypeOf(x);
    const pname =
      proto === ref.Node.prototype || proto === V.Node.prototype ? "Node" :
      proto === ref.Position.prototype || proto === V.Position.prototype ? "Pos" :
      proto === ref.SourceLocation.prototype || proto === V.SourceLocation.prototype ? "SL" :
      proto === Array.prototype ? "A" : proto === Object.prototype ? "O" : "?";
    out.push(pname + "{");
    for (const k of Object.keys(x)) {
      out.push(k + ":");
      walk(x[k]);
    }
    out.push("}");
  })(root);
  return out.join(" ");
}
const errSer = (e) => (e instanceof Error ? `${e.constructor.name}: ${e.message} pos=${e.pos} loc=${e.loc && e.loc.line + ":" + e.loc.column} raisedAt=${e.raisedAt}` : "THROW " + String(e));
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `@${i}: ref …${a.slice(Math.max(0, i - 150), i + 100)}…\n   fast …${b.slice(Math.max(0, i - 150), i + 100)}…`;
}

let checks = 0, fastOk = 0, bails = 0, bothErr = 0, mismatch = 0, falseAccept = 0, shown = 0;
function check(name, file, code, opts, cls) {
  checks++;
  let a, ea = null, b, eb = null;
  try {
    a = idSer(cls.R.parse(code, opts));
  } catch (e) {
    ea = errSer(e);
  }
  try {
    b = idSer(cls.F.parse(code, opts));
  } catch (e) {
    eb = errSer(e);
  }
  if (ea !== null || eb !== null) {
    if (ea !== eb) {
      mismatch++;
      if (shown++ < 20) console.log(`MISMATCH(error) ${name} ${file} ${JSON.stringify(opts)}\n  ref: ${ea}\n  fast: ${eb}`);
      return;
    }
  } else if (a !== b) {
    mismatch++;
    if (shown++ < 20) console.log(`MISMATCH ${name} ${file} ${JSON.stringify(opts)}\n  ${firstDiff(a, b)}`);
    return;
  }
  if (!cls.accept) return;
  // the fast path itself
  let c = null, bailed = false;
  try {
    c = idSer(fastParse(code, V._getOptions(opts), null, bodyOverrideOf(cls.F)));
  } catch (e) {
    if (e !== BAIL && !(e instanceof RangeError)) {
      mismatch++;
      if (shown++ < 20) console.log(`CRASH ${name} ${file}: ${e.stack}`);
      return;
    }
    bailed = true;
  }
  if (ea !== null) {
    if (!bailed) {
      falseAccept++;
      if (shown++ < 20) console.log(`FALSE-ACCEPT ${name} ${file}: ${ea}`);
    } else bothErr++;
  } else if (bailed) bails++;
  else if (c !== a) {
    mismatch++;
    if (shown++ < 20) console.log(`MISMATCH(direct) ${name} ${file}\n  ${firstDiff(a, c)}`);
  } else fastOk++;
}

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
      if (e.name !== ".git") collect(p, out, seen);
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
let seed = 4242;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const SNIPPETS = ["{", "}", "${", "`", "(", ")", "/", "function", "=>", "async ", "*", "\n", "'", "class A{m(){}}", "x=>{", "}}", "return", "yield", "await"];
function mutate(code) {
  const r = rnd(), pos = Math.floor(rnd() * (code.length + 1));
  if (r < 0.35) return code.slice(0, pos);
  if (r < 0.75) return code.slice(0, pos) + SNIPPETS[Math.floor(rnd() * SNIPPETS.length)] + code.slice(pos);
  return code.slice(0, pos) + code.slice(pos + 1 + Math.floor(rnd() * 10));
}

const files = [];
collect(dirs[0], files, new Set());
if (dirs[1]) collect(dirs[1], files, new Set(files.map((f) => statSync(f).size + ":" + f.split(/[\\/]/).pop())));
console.log(`${files.length} files`);
const t0 = performance.now();
const names = Object.keys(classes);
let fi = 0;
for (const file of files) {
  let code;
  try {
    code = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  fi++;
  const isModule = /\.mjs$/.test(file) || /^\s*(import|export)\b/m.test(code);
  // Nodepod's usage, for every file; the other variants rotate
  check("topLevel", file, code, { ecmaVersion: "latest", sourceType: "module" }, classes.topLevel);
  const name = names[fi % names.length];
  check(name, file, code, { ecmaVersion: "latest", sourceType: isModule ? "module" : "script", locations: (fi & 1) === 1, ranges: (fi & 2) === 2 }, classes[name]);
  {
    // parseExpressionAt through the classes
    const pos = Math.floor(rnd() * (code.length + 1));
    const cls = classes[names[(fi + 3) % names.length]];
    checks++;
    let ra, rb;
    try {
      ra = idSer(cls.R.parseExpressionAt(code, pos, { ecmaVersion: "latest", sourceType: "module" }));
    } catch (e) {
      ra = "ERR " + errSer(e);
    }
    try {
      rb = idSer(cls.F.parseExpressionAt(code, pos, { ecmaVersion: "latest", sourceType: "module" }));
    } catch (e) {
      rb = "ERR " + errSer(e);
    }
    if (ra !== rb) {
      mismatch++;
      if (shown++ < 20) console.log(`MISMATCH(parseExpressionAt) ${file} @${pos}
  ${firstDiff(ra, rb)}`);
    }
  }
  for (let m = 0; m < mutations; m++) {
    const mc = mutate(code);
    check("topLevel(mutated)", file, mc, { ecmaVersion: "latest", sourceType: "module", locations: m === 1 }, classes.topLevel);
    const n2 = names[(fi + m + 1) % names.length];
    check(n2 + "(mutated)", file, mc, { ecmaVersion: "latest", sourceType: isModule ? "module" : "script" }, classes[n2]);
  }
}
console.log(`checks ${checks}, fast-path ${fastOk}, bail ${bails}, both-error ${bothErr}, FALSE-ACCEPT ${falseAccept}, MISMATCH ${mismatch}  (${((performance.now() - t0) / 1000).toFixed(1)}s; closure side effects seen ${sideEffects})`);
process.exit(falseAccept || mismatch ? 1 : 0);
