// Parser.extend() plugins and subclasses @r1ck404/fast-acorn does not recognise
// (they run acorn's generic parser, loaded on demand in Node), direct
// `new Parser()`, ES5-style subclassing, monkey-patching Parser.prototype,
// empty subclasses of recognised classes, and re-entrant use (parses and
// tokenizers started from callbacks, interleaved tokenizers): each against
// the same code on acorn 8.18 (node_modules), results and errors compared.
//
// node packages/fast-acorn/test/plugins.mjs [--limit N]
import * as acorn from "acorn";
import * as fast from "../src/index.mjs";
import { idSer } from "./idser.mjs";
import { jsxOptionsOf } from "../src/jsx-detect.mjs";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const acornJsx = require("acorn-jsx");
const args = process.argv.slice(2);
const limit = Number(args.includes("--limit") ? args[args.indexOf("--limit") + 1] : 400);
const here = fileURLToPath(new URL(".", import.meta.url));

// the generic parser must not be loaded by importing the package
const genericLoaded = () => typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(fast.Parser.prototype), "parseStatement") !== "undefined";
let fails = 0, checks = 0, shown = 0;
function fail(msg) {
  fails++;
  if (shown++ < 25) console.log("FAIL " + msg);
}
function ok(cond, msg) {
  checks++;
  if (!cond) fail(msg);
}
if (genericLoaded()) fail("generic parser loaded at import");
fast.parse("let a = 1", { ecmaVersion: "latest" });
fast.parseExpressionAt("a + b", 0, { ecmaVersion: "latest" });
[...fast.tokenizer("a + b", { ecmaVersion: "latest" })];
fast.Parser.extend(acornJsx()).parse("<a/>", { ecmaVersion: "latest" });
ok(!genericLoaded(), "generic parser loaded by the fast paths");

const errSer = (e) => (e instanceof Error ? `ERR ${e.constructor.name}|${e.message}|${e.pos}|${e.loc ? e.loc.line + ":" + e.loc.column : e.loc}|${e.raisedAt}` : "THROW " + String(e));
const run = (f) => {
  try {
    return idSer(f());
  } catch (e) {
    return errSer(e);
  }
};
function same(what, fa, fb) {
  checks++;
  const a = run(fa), b = run(fb);
  if (a !== b) {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    fail(`${what}\n  acorn: …${a.slice(Math.max(0, i - 150), i + 150)}\n  fast:  …${b.slice(Math.max(0, i - 150), i + 150)}`);
  }
}

// ---- plugins, each (lib) => class
const PLUGINS = {
  // a new token: `@name` decorators on statements (tokenizer override: readToken)
  decorators: (lib) => {
    const tt = lib.tokTypes;
    const at = new lib.TokenType("@", { startsExpr: true });
    return lib.Parser.extend(
      (Base) =>
        class extends Base {
          readToken(code) {
            if (code === 64) {
              ++this.pos;
              return this.finishToken(at);
            }
            return super.readToken(code);
          }
          parseStatement(context, topLevel, exports) {
            if (this.type === at) {
              const node = this.startNode();
              this.next();
              node.name = this.parseIdent();
              node.statement = this.parseStatement(context, topLevel, exports);
              return this.finishNode(node, "Decorated");
            }
            return super.parseStatement(context, topLevel, exports);
          }
        },
    );
  },
  // getTokenFromCode override: `#` comments to end of line
  hashComments: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          getTokenFromCode(code) {
            if (code === 35 && this.input.charCodeAt(this.pos + 1) === 32) {
              this.skipLineComment(1);
              this.skipSpace();
              return this.nextToken();
            }
            return super.getTokenFromCode(code);
          }
        },
    ),
  // acorn-walk-free AST annotation plugin (parseLiteral / finishNode)
  annotate: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          finishNode(node, type) {
            const n = super.finishNode(node, type);
            if (type === "Identifier") n.annotated = n.name.length;
            return n;
          }
          parseLiteral(v) {
            const n = super.parseLiteral(v);
            n.kind = typeof v;
            return n;
          }
        },
    ),
  // import-phase style plugin (like webpack's): `import source x from "y"`
  importPhase: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseImport(node) {
            if (this.isContextual("source") || this.value === "source") {
              const save = this.pos;
              void save;
            }
            if (this.type === lib.tokTypes._import) {
              // (acorn calls parseImport after consuming `import` in parseStatement)
            }
            return super.parseImport(node);
          }
          parseImportSpecifiers() {
            if (this.isContextual("source")) {
              this.next();
              const node = this.startNode();
              node.local = this.parseIdent();
              return [this.finishNode(node, "ImportSourceSpecifier")];
            }
            return super.parseImportSpecifiers();
          }
        },
    ),
  // context-tracking plugin: a new token type with updateContext (like acorn-jsx)
  contexts: (lib) => {
    const tc = new lib.TokContext("<<", false);
    const open = new lib.TokenType("<<<", { beforeExpr: true, startsExpr: true });
    open.updateContext = function () {
      this.context.push(tc);
      this.exprAllowed = true;
    };
    return lib.Parser.extend(
      (Base) =>
        class extends Base {
          readToken(code) {
            if (code === 60 && this.input.charCodeAt(this.pos + 1) === 60 && this.input.charCodeAt(this.pos + 2) === 60) {
              this.pos += 3;
              return this.finishToken(open);
            }
            return super.readToken(code);
          }
          parseExprAtom(r, f, n) {
            if (this.type === open) {
              const node = this.startNode();
              this.next();
              this.context.pop();
              node.expression = this.parseExpression();
              return this.finishNode(node, "Triple");
            }
            return super.parseExprAtom(r, f, n);
          }
        },
    );
  },
  // further subclass of acorn-jsx with an override (not recognised)
  jsxPlus: (lib) =>
    lib.Parser.extend(acornJsx(), (Base) =>
      class extends Base {
        jsx_parseText() {
          const n = super.jsx_parseText();
          n.trimmed = n.value.trim();
          return n;
        }
      },
    ),
  // ES5-style subclass (Parser.call, Object.create)
  es5: (lib) => {
    function Sub(options, input, startPos) {
      lib.Parser.call(this, options, input, startPos);
      this.es5 = true;
    }
    Sub.prototype = Object.create(lib.Parser.prototype);
    Sub.prototype.constructor = Sub;
    Sub.parse = lib.Parser.parse;
    Sub.parseExpressionAt = lib.Parser.parseExpressionAt;
    Sub.prototype.parseIdent = function (liberal) {
      const n = lib.Parser.prototype.parseIdent.call(this, liberal);
      n.es5 = this.es5;
      return n;
    };
    return Sub;
  },
  // feature detection on Parser.prototype at definition time
  detecting: (lib) => {
    const has = typeof lib.Parser.prototype.parseImportMeta === "function" && typeof lib.Parser.prototype.readToken === "function";
    return lib.Parser.extend(
      (Base) =>
        class extends Base {
          parseImportMeta(node) {
            node.detected = has;
            return super.parseImportMeta(node);
          }
        },
    );
  },
  // an override with a constructor and fields
  stateful: (lib) =>
    lib.Parser.extend(
      (Base) =>
        class extends Base {
          count = 0;
          constructor(o, i, s) {
            super(o, i, s);
            this.startedAt = this.pos;
          }
          next(ignore) {
            this.count++;
            return super.next(ignore);
          }
          parseTopLevel(node) {
            const n = super.parseTopLevel(node);
            n.tokens = this.count;
            n.startedAt = this.startedAt;
            return n;
          }
        },
    ),
};

const FEATURE_INPUTS = [
  "@dec function f() {}\n@a @b class C {}",
  "x = 1 # a comment\ny = 2",
  "import source wasm from './x.wasm'; import a from 'b'",
  "a = <<< 1 + 2",
  "const x = <div> hello </div>",
  "function f(a, b) { return a + b } new.target",
  "import.meta.url",
  "let a = 'x' + 1; function g() { return /re/g }",
];

// corpus files
const files = [];
(function walk(d) {
  let es;
  try {
    es = readdirSync(d, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of es) {
    if (files.length >= limit) return;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(m|c)?js$/.test(e.name) && statSync(p).size < 200_000) files.push(p);
  }
})(join(here, "../../../node_modules"));

const optsFor = (i) => [{ ecmaVersion: "latest", sourceType: "module" }, { ecmaVersion: 2020, sourceType: "script", locations: true }, { ecmaVersion: "latest", sourceType: "module", ranges: true, onComment: [] }][i % 3];
for (const [name, mk] of Object.entries(PLUGINS)) {
  const A = mk(acorn), F = mk(fast);
  ok(jsxOptionsOf(F, fast.Parser) === null, name + " recognised as acorn-jsx");
  for (const [i, code] of FEATURE_INPUTS.entries()) {
    same(`${name} feature#${i}`, () => A.parse(code, { ...optsFor(i) }), () => F.parse(code, { ...optsFor(i) }));
    same(`${name} feature#${i} (expr)`, () => A.parseExpressionAt(code, 0, { ecmaVersion: "latest" }), () => F.parseExpressionAt(code, 0, { ecmaVersion: "latest" }));
  }
  for (const [i, f] of files.entries()) {
    if (i % 3 !== Object.keys(PLUGINS).indexOf(name) % 3) continue;
    const code = readFileSync(f, "utf8");
    const o = { ...optsFor(i), onComment: undefined };
    same(`${name} ${f}`, () => A.parse(code, o), () => F.parse(code, o));
  }
}
ok(genericLoaded(), "generic parser was not loaded for the plugins");

// ---- empty subclasses of recognised classes: fast path, same result
{
  const JA = acorn.Parser.extend(acornJsx()), JF = fast.Parser.extend(acornJsx());
  const EA = JA.extend((B) => class extends B {}), EF = JF.extend((B) => class extends B {});
  const code = "const x = <A b='1'>{c}</A>;";
  same("empty subclass of acorn-jsx", () => EA.parse(code, { ecmaVersion: "latest" }), () => EF.parse(code, { ecmaVersion: "latest" }));
  class Named extends fast.Parser {}
  same("empty subclass of Parser", () => acorn.parse("a + b", { ecmaVersion: "latest" }), () => Named.parse("a + b", { ecmaVersion: "latest" }));
}

// ---- new Parser() / instance API on the base class
same("new Parser().parse()", () => new acorn.Parser({ ecmaVersion: "latest" }, "let {a} = b").parse(), () => new fast.Parser({ ecmaVersion: "latest" }, "let {a} = b").parse());
same("new Parser + nextToken + parseExpression", () => {
  const p = new acorn.Parser({ ecmaVersion: "latest" }, "a ? b : c", 0);
  p.nextToken();
  return p.parseExpression();
}, () => {
  const p = new fast.Parser({ ecmaVersion: "latest" }, "a ? b : c", 0);
  p.nextToken();
  return p.parseExpression();
});
ok(new fast.Parser({ ecmaVersion: "latest" }, "") instanceof fast.Parser, "instanceof Parser");
// (not -Infinity, nor Infinity in modules: acorn loops forever there, and so
// does fast-acorn)
for (const pos of ["4", "0", true, [4], 4, 0, null, undefined, NaN, -1, -3, 0.5, 8.5, 9, 100, Infinity])
  for (const sourceType of pos === Infinity ? ["script"] : ["script", "module"])
    same("parseExpressionAt at " + String(pos) + " " + sourceType, () => acorn.parseExpressionAt("a + b; c", pos, { ecmaVersion: "latest", sourceType }), () => fast.parseExpressionAt("a + b; c", pos, { ecmaVersion: "latest", sourceType }));
ok(fast.tokenizer("a", { ecmaVersion: "latest" }) instanceof fast.Parser, "tokenizer instanceof Parser");
ok(fast.Parser.acorn.Parser === fast.Parser && fast.Parser.acorn.tokTypes === fast.tokTypes, "Parser.acorn");

// ---- monkey-patching Parser.prototype
{
  const patch = (lib) => {
    const orig = lib.Parser.prototype.parseLiteral;
    lib.Parser.prototype.parseLiteral = function (v) {
      const n = orig.call(this, v);
      n.patched = true;
      return n;
    };
    return () => {
      lib.Parser.prototype.parseLiteral = orig;
    };
  };
  const ua = patch(acorn), uf = patch(fast);
  for (const code of ["x = 1 + 'a'", "f(1n, /r/)"]) {
    same("patched parse " + code, () => acorn.parse(code, { ecmaVersion: "latest" }), () => fast.parse(code, { ecmaVersion: "latest" }));
    same("patched parseExpressionAt " + code, () => acorn.parseExpressionAt(code, 0, { ecmaVersion: "latest" }), () => fast.parseExpressionAt(code, 0, { ecmaVersion: "latest" }));
    same("patched jsx " + code, () => acorn.Parser.extend(acornJsx()).parse(code, { ecmaVersion: "latest" }), () => fast.Parser.extend(acornJsx()).parse(code, { ecmaVersion: "latest" }));
  }
  ua();
  delete fast.Parser.prototype.parseLiteral;
  same("unpatched again", () => acorn.parse("x = 1", { ecmaVersion: "latest" }), () => fast.parse("x = 1", { ecmaVersion: "latest" }));
  // a patched tokenizer method
  const origA = acorn.Parser.prototype.readToken, origF = fast.Parser.prototype.readToken;
  acorn.Parser.prototype.readToken = function (code) {
    if (code === 64) {
      ++this.pos;
      return this.finishToken(acorn.tokTypes.semi);
    }
    return origA.call(this, code);
  };
  fast.Parser.prototype.readToken = function (code) {
    if (code === 64) {
      ++this.pos;
      return this.finishToken(fast.tokTypes.semi);
    }
    return origF.call(this, code);
  };
  same("patched readToken", () => acorn.parse("a @ b", { ecmaVersion: "latest" }), () => fast.parse("a @ b", { ecmaVersion: "latest" }));
  same("patched readToken, tokenizer", () => [...acorn.tokenizer("a @ b", { ecmaVersion: "latest" })], () => [...fast.tokenizer("a @ b", { ecmaVersion: "latest" })]);
  acorn.Parser.prototype.readToken = origA;
  delete fast.Parser.prototype.readToken;
  same("unpatched readToken", () => acorn.parse("a + b", { ecmaVersion: "latest" }), () => fast.parse("a + b", { ecmaVersion: "latest" }));
  // a non-enumerable patch (Object.defineProperty) of a method read first
  const saveA = Object.getOwnPropertyDescriptor(acorn.Parser.prototype, "parseIdent");
  for (const lib of [acorn, fast]) {
    const orig = lib.Parser.prototype.parseIdent;
    Object.defineProperty(lib.Parser.prototype, "parseIdent", {
      value(liberal) {
        const n = orig.call(this, liberal);
        n.defined = true;
        return n;
      },
      configurable: true,
      writable: true,
    });
  }
  same("defineProperty patch", () => acorn.parse("let a = b", { ecmaVersion: "latest" }), () => fast.parse("let a = b", { ecmaVersion: "latest" }));
  Object.defineProperty(acorn.Parser.prototype, "parseIdent", saveA);
  delete fast.Parser.prototype.parseIdent;
  same("defineProperty patch removed", () => acorn.parse("let a = b", { ecmaVersion: "latest" }), () => fast.parse("let a = b", { ecmaVersion: "latest" }));
  // a patch set back to the original method is no patch (the fast parser runs again)
  const origLit = fast.Parser.prototype.parseLiteral;
  fast.Parser.prototype.parseLiteral = origLit;
  same("patch set back", () => acorn.parse("x = 'a'", { ecmaVersion: "latest" }), () => fast.parse("x = 'a'", { ecmaVersion: "latest" }));
  const whoRaised = () => {
    try {
      fast.parse("x = ", { ecmaVersion: "latest" });
    } catch (e) {
      return /generic\.cjs/.test(e.stack) ? "generic" : /parser\.mjs/.test(e.stack) ? "fast" : "?";
    }
  };
  ok(whoRaised() === "fast", "a patch set back to acorn's method still counts as a patch");
  delete fast.Parser.prototype.parseLiteral;
  ok(whoRaised() === "fast", "fast parser not used after unpatching");
}

// ---- re-entrancy
{
  const nested = (lib) => {
    const seen = [];
    const ast = lib.parse("/* a */ x = 1; // b\n let y = `t${z}`", {
      ecmaVersion: "latest",
      locations: true,
      onComment(block, text) {
        // a parse and a tokenizer run from a callback of another parse
        seen.push(lib.parse(text + " + 1", { ecmaVersion: 5, ranges: true }));
        seen.push([...lib.tokenizer("q = " + text, { ecmaVersion: "latest" })].map((t) => t.value));
      },
      onToken(t) {
        if (t.value === "y") seen.push(lib.parseExpressionAt("(a, b) => a", 0, { ecmaVersion: 2017 }));
      },
    });
    return [ast, seen];
  };
  same("parses from callbacks", () => nested(acorn), () => nested(fast));
  const interleaved = (lib) => {
    const a = lib.tokenizer("a = 1; b = 2", { ecmaVersion: "latest", locations: true });
    const b = lib.tokenizer("`x${y}` / 2", { ecmaVersion: "latest" });
    const out = [];
    for (let i = 0; i < 8; i++) {
      out.push(a.getToken(), b.getToken(), lib.parse("c", { ecmaVersion: 3 }), a.pos, b.type.label);
    }
    return out;
  };
  same("interleaved tokenizers", () => interleaved(acorn), () => interleaved(fast));
  const errorInside = (lib) => {
    const out = [];
    try {
      lib.parse("a; /* x */ b;", {
        ecmaVersion: "latest",
        onComment() {
          try {
            lib.parse("let let", { ecmaVersion: "latest" });
          } catch (e) {
            out.push(e.message, e.pos);
          }
        },
      });
    } catch (e) {
      out.push("outer " + e.message);
    }
    return out;
  };
  same("error in a nested parse", () => errorInside(acorn), () => errorInside(fast));
  // acorn-loose style use of a tokenizer: writes to pos / exprAllowed / curLine / lineStart
  const loose = (lib) => {
    const t = lib.tokenizer("a = / b /\nc = 1", { ecmaVersion: "latest", locations: true });
    const out = [];
    out.push(t.getToken(), t.getToken());
    try {
      t.getToken();
    } catch (e) {
      out.push(e.message);
      t.pos = 10;
      t.exprAllowed = true;
      t.curLine = 2;
      t.lineStart = 10;
      t.containsEsc = false;
    }
    for (let i = 0; i < 4; i++) out.push(t.getToken(), t.curPosition());
    return out;
  };
  same("acorn-loose style tokenizer", () => loose(acorn), () => loose(fast));
}

console.log(`plugins: ${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
