// shared.mjs getOptions() vs acorn 8.18's own getOptions (its code from
// node_modules, bound to the same defaultOptions object): result keys
// (order), values, the onToken / onComment array wrappers' behaviour, thrown
// errors, and the exact sequence of operations on the given options object
// (via a Proxy).
import { getOptions as fastGetOptions, defaultOptions, SourceLocation, Position } from "../src/shared.mjs";
import { acornGetOptions as makeAcornGetOptions } from "./acorn-ref.mjs";

const acornGetOptions = makeAcornGetOptions(defaultOptions, SourceLocation);
let checks = 0, fails = 0;

function describe(o) {
  if (o === null || typeof o !== "object") return String(o);
  const out = [];
  for (const k of Object.keys(o)) {
    const v = o[k];
    out.push(k + "=" + (typeof v === "function" ? "fn" : JSON.stringify(v)));
  }
  return out.join(",");
}
function traced(target) {
  const log = [];
  const p = new Proxy(target, {
    get(t, k, r) {
      log.push("get:" + String(k));
      return Reflect.get(t, k, r);
    },
    getOwnPropertyDescriptor(t, k) {
      log.push("gopd:" + String(k));
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
    has(t, k) {
      log.push("has:" + String(k));
      return Reflect.has(t, k);
    },
    ownKeys(t) {
      log.push("ownKeys");
      return Reflect.ownKeys(t);
    },
  });
  return { p, log };
}
function run(fn, opts) {
  try {
    const o = fn(opts);
    let extra = "";
    // exercise the array wrappers
    if (typeof o.onToken === "function" && Array.isArray(opts && opts.onToken)) {
      o.onToken({ tok: 1 });
      extra += " tokens=" + JSON.stringify(opts.onToken);
      opts.onToken.length = 0;
    }
    if (typeof o.onComment === "function" && Array.isArray(opts && opts.onComment)) {
      o.onComment.call(o, true, "c", 1, 5, new Position(1, 1), new Position(1, 5));
      o.onComment.call(o, false, "d", 6, 9, new Position(2, 0), new Position(2, 3));
      extra += " comments=" + JSON.stringify(opts.onComment) + " protos=" + opts.onComment.map((c) => c.loc && Object.getPrototypeOf(c.loc) === SourceLocation.prototype).join();
      opts.onComment.length = 0;
    }
    return "OK " + describe(o) + extra;
  } catch (e) {
    return "THROW " + e.constructor.name + ": " + e.message;
  }
}
function check(name, make) {
  checks++;
  const a = run(acornGetOptions, make());
  const b = run(fastGetOptions, make());
  if (a !== b) {
    fails++;
    console.log("MISMATCH", name, "\n  acorn:", a, "\n  fast: ", b);
  }
  // operation order on a proxy
  if (make() && typeof make() === "object") {
    const ta = traced(make()), tb = traced(make());
    checks++;
    run(acornGetOptions, ta.p);
    run(fastGetOptions, tb.p);
    if (ta.log.join() !== tb.log.join()) {
      fails++;
      console.log("TRAP ORDER", name, "\n  acorn:", ta.log.join(), "\n  fast: ", tb.log.join());
    }
  }
}

const ECMA = ["latest", 2015, 2020, 2026, 6, 11, 16, 17, 1e8, "2022", 3, 5];
const SOURCE = ["script", "module", "commonjs", "weird", undefined];
const RESERVED = [undefined, null, true, false, "never"];
const HASHBANG = [undefined, null, true, false];
let n = 0;
for (const ecmaVersion of ECMA)
  for (const sourceType of SOURCE)
    for (const allowReserved of RESERVED)
      for (const allowHashBang of HASHBANG) {
        const i = n++;
        check(`combo ${i}`, () => {
          const o = { ecmaVersion };
          if (sourceType !== undefined) o.sourceType = sourceType;
          if (allowReserved !== undefined || i % 3 === 0) o.allowReserved = allowReserved;
          if (allowHashBang !== undefined || i % 5 === 0) o.allowHashBang = allowHashBang;
          if (i % 7 === 0) o.locations = true;
          if (i % 11 === 0) o.ranges = true;
          if (i % 13 === 0) o.allowAwaitOutsideFunction = true;
          if (i % 4 === 0) o.onComment = [];
          if (i % 6 === 0) o.onToken = [];
          if (i % 9 === 0) o.onComment = () => {};
          if (i % 10 === 0) o.sourceFile = "f.js";
          if (i % 17 === 0) o.unknownOption = 1;
          if (i % 19 === 0) o.startLocation = { line: 3, column: 4 };
          return o;
        });
      }
check("inherited options", () => Object.create({ ecmaVersion: "latest", locations: true }));
check("inherited allowHashBang", () => Object.assign(Object.create({ allowHashBang: true }), { ecmaVersion: "latest" }));
check("getter", () => ({ ecmaVersion: "latest", get locations() { return true; } }));
check("non-enumerable own", () => Object.defineProperty({ ecmaVersion: "latest" }, "ranges", { value: true, enumerable: false }));
check("string opts", () => "abc");
check("number opts", () => 42);
check("array opts", () => Object.assign([], { ecmaVersion: 2020 }));
check("null ecmaVersion", () => ({ ecmaVersion: null, sourceType: "module" }));
check("commonjs+await", () => ({ ecmaVersion: "latest", sourceType: "commonjs", allowAwaitOutsideFunction: true }));
// modified defaultOptions
const saved = { ...defaultOptions };
defaultOptions.locations = true;
check("defaultOptions value changed", () => ({ ecmaVersion: "latest" }));
defaultOptions.extraKey = 5;
check("defaultOptions key added", () => ({ ecmaVersion: "latest" }));
delete defaultOptions.extraKey;
delete defaultOptions.strict;
check("defaultOptions key deleted", () => ({ ecmaVersion: "latest" }));
defaultOptions.strict = saved.strict; // re-added: now last in iteration order
check("defaultOptions key re-added (order changed)", () => ({ ecmaVersion: "latest", strict: true }));
// restore the original order
for (const k of Object.keys(defaultOptions)) delete defaultOptions[k];
Object.assign(defaultOptions, saved);
Object.prototype.polluted = 1;
check("Object.prototype polluted", () => ({ ecmaVersion: "latest" }));
delete Object.prototype.polluted;
check("restored", () => ({ ecmaVersion: "latest" }));
console.log(`options: ${checks} checks, ${fails} mismatches`);
process.exit(fails ? 1 : 0);
