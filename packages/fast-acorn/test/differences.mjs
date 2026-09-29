// Pins the behaviour differences from acorn 8.18 that README.md lists
// ("Differences"), on the shipped index.mjs: each check asserts what
// @r1ck404/fast-acorn does and what acorn does, so a change on either side
// fails here (and the README needs updating).
// (Browsers / bundles without "@r1ck404/fast-acorn/full": test/bundle.mjs.)
//
// node packages/fast-acorn/test/differences.mjs
import * as acorn from "acorn";
import * as fast from "../index.mjs";

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    fails++;
    console.log("FAIL " + msg);
  }
}
const outcome = (f) => {
  try {
    f();
    return "ok";
  } catch (e) {
    return "ERR " + e.message;
  }
};
const O = { ecmaVersion: "latest" };

// 1. A method patched onto Parser.prototype with Object.defineProperty, before
//    anything has read a method from Parser.prototype (or the generic parser
//    is loaded), is not noticed: the fast parser runs. (After such a read, or
//    with an assignment, the patch is used, as in acorn: test/plugins.mjs.)
{
  const def = (lib) =>
    Object.defineProperty(lib.Parser.prototype, "parseLiteral", {
      value() {
        throw new Error("patched");
      },
      configurable: true,
      writable: true,
    });
  const save = Object.getOwnPropertyDescriptor(acorn.Parser.prototype, "parseLiteral");
  def(acorn);
  def(fast);
  ok(outcome(() => acorn.parse("x = 1", O)) === "ERR patched", "acorn runs a defineProperty patch");
  ok(outcome(() => fast.parse("x = 1", O)) === "ok", "fast-acorn notices a defineProperty patch made first");
  Object.defineProperty(acorn.Parser.prototype, "parseLiteral", save);
  delete fast.Parser.prototype.parseLiteral;
  ok(outcome(() => acorn.parse("x = 1", O)) === "ok" && outcome(() => fast.parse("x = 1", O)) === "ok", "unpatched again");
}

// 2. The token types' and contexts' behaviour is built into the fast parser:
//    replacing tokTypes.x.updateContext (or a context's override) changes
//    nothing there; acorn calls it.
{
  const count = (lib) => {
    const t = lib.tokTypes.parenL, orig = t.updateContext;
    let calls = 0;
    t.updateContext = function (prev) {
      calls++;
      return orig.call(this, prev);
    };
    try {
      lib.parse("f(a)", O);
    } finally {
      t.updateContext = orig;
    }
    return calls;
  };
  ok(count(acorn) === 1, "acorn calls a replaced updateContext");
  ok(count(fast) === 0, "fast-acorn calls a replaced updateContext");
}

// 3. Parser.prototype: acorn's methods are inherited (from a prototype that
//    receives them when the generic parser is loaded), not own properties;
//    Parser has two symbol-keyed hooks (for @r1ck404/fast-acorn-jsx and /full).
{
  ok(Object.hasOwn(acorn.Parser.prototype, "parseStatement") && !Object.hasOwn(fast.Parser.prototype, "parseStatement"), "own methods of Parser.prototype");
  ok(Object.getOwnPropertySymbols(acorn.Parser).length === 0 && Object.getOwnPropertySymbols(fast.Parser).length === 2, "symbol-keyed properties of Parser");
}

// 4. tokenizer() returns an object with acorn's token API and token state
//    (getToken, iteration, next, nextToken, curPosition, curContext, raise,
//    type, value, start, end, startLoc, endLoc, lastTok*, pos, curLine,
//    lineStart, exprAllowed, containsEsc, strict, inModule, context, options,
//    input), an instance of Parser, but not a parser: no parser state
//    (scopeStack, labels, ...), and its parse methods are not supported.
{
  const a = acorn.tokenizer("a", O), f = fast.tokenizer("a", O);
  ok(f instanceof fast.Parser && typeof f.getToken === "function" && typeof f[Symbol.iterator] === "function", "tokenizer API");
  ok(Object.hasOwn(a, "scopeStack") && !Object.hasOwn(f, "scopeStack") && Object.hasOwn(a, "labels") && !Object.hasOwn(f, "labels"), "tokenizer parser state");
}

// 5. Nesting too deep for the stack: both throw acorn's SyntaxError "Not enough
//    stack space to parse input", but the depth at which that happens (and so
//    the position in the message) differs; an input between the two limits
//    parses with one and fails with the other.
{
  const deep = "(".repeat(200000) + "a" + ")".repeat(200000);
  const msg = (lib) => {
    try {
      lib.parse(deep, O);
      return "ok";
    } catch (e) {
      return e instanceof SyntaxError ? e.message.replace(/ \(\d+:\d+\)$/, "") : "other " + e;
    }
  };
  ok(msg(acorn) === "Not enough stack space to parse input", "acorn on deep nesting: " + msg(acorn));
  ok(msg(fast) === "Not enough stack space to parse input", "fast-acorn on deep nesting: " + msg(fast));
}

console.log(`differences: ${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
