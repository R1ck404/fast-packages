// Recognises Parser.extend(acornJsx(options)) classes that the fast parser
// can parse exactly like acorn-jsx 5.3.2 does, and determines their options.
//
// A class qualifies when
//  * it was created by fast-acorn's own copy of acorn-jsx (./acorn-jsx.mjs,
//    registered by identity: works for bundled/minified builds), or
//  * it is the genuine acorn-jsx 5.3.2 class applied to fast-acorn's Parser:
//    direct subclass of Parser, the exact own properties, the class and
//    every method (and the static acornJsx getter, and the context hooks of
//    its token types) have exactly acorn-jsx 5.3.2's source text, its token
//    types / contexts have the expected shape, and a set of probe inputs
//    (namespaces, namespaced member names, the whole entity table, numeric
//    entities) parse to the same AST with the class itself and with the fast
//    parser. The probes also determine the plugin options
//    (allowNamespaces / allowNamespacedObjects), which live in a closure.
// Every parse re-checks that the prototype methods are still the recognised
// functions (a later monkey-patch disables the fast path).

import * as V from "./vendor/acorn.mjs";
import { JSX_CLASS_SRC, JSX_METHOD_SRC, JSX_GETTER_SRC, JSX_TAGSTART_UC_SRC, JSX_TAGEND_UC_SRC, XHTMLEntities } from "./jsx-data.mjs";
import { fastParse } from "./parser.mjs";

const fnToString = Function.prototype.toString;
const METHOD_NAMES = Object.keys(JSX_METHOD_SRC);
const recognised = new WeakMap(); // class -> record | null
const registry = new WeakMap(); // classes made by ./acorn-jsx.mjs -> record

function srcOf(f) {
  try {
    return fnToString.call(f);
  } catch {
    return null;
  }
}

function methodsOf(proto) {
  const out = [];
  for (const name of METHOD_NAMES) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || !("value" in d) || typeof d.value !== "function") return null;
    out.push(d.value);
  }
  return out;
}

function sameKeys(obj, expected) {
  const names = Object.getOwnPropertyNames(obj);
  if (Object.getOwnPropertySymbols(obj).length !== 0 || names.length !== expected.length) return false;
  for (const n of expected) if (!names.includes(n)) return false;
  return true;
}

function checkTokenType(t, label, beforeExpr, startsExpr, ucSrc) {
  return (
    t instanceof V.TokenType &&
    sameKeys(t, ["label", "keyword", "beforeExpr", "startsExpr", "isLoop", "isAssign", "prefix", "postfix", "binop", "updateContext"]) &&
    t.label === label &&
    t.keyword === undefined &&
    t.beforeExpr === beforeExpr &&
    t.startsExpr === startsExpr &&
    t.isLoop === false &&
    t.isAssign === false &&
    t.prefix === false &&
    t.postfix === false &&
    t.binop === null &&
    (ucSrc === null ? t.updateContext === null : typeof t.updateContext === "function" && srcOf(t.updateContext) === ucSrc)
  );
}

function checkContext(c, token, isExpr, preserveSpace) {
  return (
    c instanceof V.TokContext &&
    sameKeys(c, ["token", "isExpr", "preserveSpace", "override", "generator"]) &&
    c.token === token &&
    c.isExpr === isExpr &&
    c.preserveSpace === preserveSpace &&
    c.override === undefined &&
    c.generator === false
  );
}

// the static acornJsx getter's result: { tokContexts, tokTypes }
function checkJsxTokens(J) {
  if (J === null || typeof J !== "object" || !sameKeys(J, ["tokContexts", "tokTypes"])) return null;
  const tt = J.tokTypes, tc = J.tokContexts;
  if (!sameKeys(tt, ["jsxName", "jsxText", "jsxTagStart", "jsxTagEnd"]) || !sameKeys(tc, ["tc_oTag", "tc_cTag", "tc_expr"])) return null;
  if (
    !checkTokenType(tt.jsxName, "jsxName", false, false, null) ||
    !checkTokenType(tt.jsxText, "jsxText", true, false, null) ||
    !checkTokenType(tt.jsxTagStart, "jsxTagStart", false, true, JSX_TAGSTART_UC_SRC) ||
    !checkTokenType(tt.jsxTagEnd, "jsxTagEnd", false, false, JSX_TAGEND_UC_SRC)
  )
    return null;
  if (!checkContext(tc.tc_oTag, "<tag", false, false) || !checkContext(tc.tc_cTag, "</tag", false, false) || !checkContext(tc.tc_expr, "<tag>...</tag>", true, true))
    return null;
  return [tt.jsxTagStart.updateContext, tt.jsxTagEnd.updateContext];
}

// the acorn namespace object the plugin reads its helpers from
function acornIntact() {
  const a = V.Parser.acorn;
  return (
    a !== null &&
    typeof a === "object" &&
    a.Parser === V.Parser &&
    a.tokTypes === V.tokTypes &&
    a.tokContexts === V.tokContexts &&
    a.TokenType === V.TokenType &&
    a.TokContext === V.TokContext &&
    a.isNewLine === V.isNewLine &&
    a.isIdentifierStart === V.isIdentifierStart &&
    a.isIdentifierChar === V.isIdentifierChar
  );
}

// probe inputs: namespace options, member names, entities (the complete
// table, numeric forms, malformed ones, inherited object properties)
const ENTITY_PROBE = (() => {
  const names = Object.keys(XHTMLEntities).map((n) => "&" + n + ";");
  const extra = ["&#x41;", "&#65;", "&#x1F600;", "&#1114112;", "&#xZZ;", "&#;", "&#x;", "&abcdefghij;", "&nbsp", "&amp&lt;", "&toString;", "&__proto__;", "&valueOf;", "&;", "&#0;", "&#X41;"];
  const text = names.join(" ") + " " + extra.join(" x ");
  return `x = <a b="${text.replace(/"/g, "")}" c='&quot;&amp;'>${text}\r\n&amp;\r z</a>;`;
})();
const PROBES = [
  { src: "<a:b/>", nsOnly: false },
  { src: "<a:b.c d:e='1'/>", nsOnly: false },
  { src: "<a.b.c></a.b.c>", nsOnly: false },
  { src: ENTITY_PROBE, nsOnly: false },
];
const PROBE_OPTS = { ecmaVersion: "latest", sourceType: "module", locations: true };

const replacer = (k, v) => (typeof v === "bigint" ? "$bigint:" + v : typeof v === "function" ? "$fn:" + v.name : v);
function probeDiffers(C, jsxOpts) {
  for (const { src } of PROBES) {
    let a, aErr = false, b, bErr = false;
    try {
      a = JSON.stringify(new C(PROBE_OPTS, src).parse(), replacer);
    } catch {
      aErr = true;
    }
    try {
      b = JSON.stringify(fastParse(src, V._getOptions(PROBE_OPTS), jsxOpts), replacer);
    } catch {
      bErr = true;
    }
    if (aErr !== bErr || a !== b) return true;
  }
  return false;
}

function recognise(C) {
  if (typeof C !== "function" || Object.getPrototypeOf(C) !== V.Parser) return null;
  const proto = C.prototype;
  if (!proto || Object.getPrototypeOf(proto) !== V.Parser.prototype) return null;
  if (!sameKeys(C, ["length", "name", "prototype", "acornJsx"])) return null;
  if (!sameKeys(proto, ["constructor", ...METHOD_NAMES]) || proto.constructor !== C) return null;
  if (srcOf(C) !== JSX_CLASS_SRC) return null;
  const methods = methodsOf(proto);
  if (methods === null) return null;
  for (let i = 0; i < METHOD_NAMES.length; i++) if (srcOf(methods[i]) !== JSX_METHOD_SRC[METHOD_NAMES[i]]) return null;
  const gd = Object.getOwnPropertyDescriptor(C, "acornJsx");
  if (!gd || typeof gd.get !== "function" || gd.set !== undefined || srcOf(gd.get) !== JSX_GETTER_SRC) return null;
  if (!acornIntact()) return null;
  let J;
  try {
    J = C.acornJsx;
  } catch {
    return null;
  }
  const hooks = checkJsxTokens(J);
  if (hooks === null) return null;
  // options: the probes tell which of the (three possible) configurations
  // this class behaves like; all probes must then agree with the fast parser
  let options = null;
  for (const cand of [
    { allowNamespaces: true, allowNamespacedObjects: false },
    { allowNamespaces: true, allowNamespacedObjects: true },
    { allowNamespaces: false, allowNamespacedObjects: false },
  ]) {
    if (!probeDiffers(C, cand)) {
      options = cand;
      break;
    }
  }
  if (options === null) return null;
  return { options, methods, getter: gd.get, J, hooks };
}

function intact(C, rec) {
  const proto = C.prototype;
  for (let i = 0; i < METHOD_NAMES.length; i++) if (proto[METHOD_NAMES[i]] !== rec.methods[i]) return false;
  const gd = Object.getOwnPropertyDescriptor(C, "acornJsx");
  if (!gd || gd.get !== rec.getter) return false;
  const tt = rec.J.tokTypes;
  return tt.jsxTagStart.updateContext === rec.hooks[0] && tt.jsxTagEnd.updateContext === rec.hooks[1] && tt.jsxName.updateContext === null && tt.jsxText.updateContext === null;
}

// options for the fast parser's JSX mode, or null
export function jsxOptionsOf(C) {
  let rec = registry.get(C);
  if (rec === undefined) {
    rec = recognised.get(C);
    if (rec === undefined) {
      try {
        rec = recognise(C);
      } catch {
        rec = null;
      }
      recognised.set(C, rec);
    }
  }
  if (rec === null) return null;
  return intact(C, rec) ? rec.options : null;
}

// called by ./acorn-jsx.mjs for every class it creates on fast-acorn's Parser
export function registerJsxClass(C, options) {
  const methods = methodsOf(C.prototype);
  const gd = Object.getOwnPropertyDescriptor(C, "acornJsx");
  if (methods === null || !gd) return;
  const J = C.acornJsx;
  const hooks = [J.tokTypes.jsxTagStart.updateContext, J.tokTypes.jsxTagEnd.updateContext];
  registry.set(C, {
    options: { allowNamespaces: options.allowNamespaces === true, allowNamespacedObjects: options.allowNamespacedObjects === true },
    methods,
    getter: gd.get,
    J,
    hooks,
  });
}
