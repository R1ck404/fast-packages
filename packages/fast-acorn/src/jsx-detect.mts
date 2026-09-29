// Recognises Parser.extend(acornJsx(options)) classes that the fast parser
// can parse exactly like acorn-jsx 5.3.2 does, and determines their options.
//
// A class qualifies when
//  * it was created by @r1ck404/fast-acorn-jsx directly on this Parser (registered
//    by identity through the hook in index.mjs: works for bundled/minified
//    builds), or
//  * it is the genuine acorn-jsx 5.3.2 class applied to @r1ck404/fast-acorn's Parser:
//    direct subclass of Parser, the exact own properties, the class's
//    source text is acorn-jsx 5.3.2's (same length and 53-bit hash), every
//    prototype method (and the static acornJsx getter) is the function
//    defined there (its source, which starts with its name, is part of the
//    class source), the
//    context hooks of its token types have acorn-jsx's source (hash), and
//    its token types / contexts have the expected shape. The plugin options
//    (allowNamespaces / allowNamespacedObjects), which live in a closure, are
//    read by running two of its methods (known exactly, see above) on a stub.
// Every parse re-checks that the prototype methods are still the recognised
// functions (a later monkey-patch disables the fast path).

import { TokenType, TokContext, tokTypes, tokContexts, isNewLine, isIdentifierStart, isIdentifierChar } from "./shared.mjs";
import { JSX_CLASS, JSX_METHODS, JSX_UPDATE_CONTEXT } from "./jsx-data.mjs";

const fnToString = Function.prototype.toString;
const METHOD_NAMES = JSX_METHODS.split(" ");
const READ_ENTITY = METHOD_NAMES.indexOf("jsx_readEntity");
const recognised = new WeakMap(); // class -> record | null
const registry = new WeakMap(); // classes made by @r1ck404/fast-acorn-jsx -> record

// 53-bit string hash (cyrb53; tools/gen-jsx-data.mjs has the same)
function hash(str: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

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

// (no narrowing: TokenType / TokContext are plain constructor functions)
const isInst = (x: any, C: any): boolean => x instanceof C;

function sameKeys(obj, expected) {
  const names = Object.getOwnPropertyNames(obj);
  if (Object.getOwnPropertySymbols(obj).length !== 0 || names.length !== expected.length) return false;
  for (const n of expected) if (!names.includes(n)) return false;
  return true;
}

function checkTokenType(t, label, beforeExpr, startsExpr, ucHash) {
  if (
    !(
      isInst(t, TokenType) &&
      sameKeys(t, ["label", "keyword", "beforeExpr", "startsExpr", "isLoop", "isAssign", "prefix", "postfix", "binop", "updateContext"]) &&
      t.label === label &&
      t.keyword === undefined &&
      t.beforeExpr === beforeExpr &&
      t.startsExpr === startsExpr &&
      t.isLoop === false &&
      t.isAssign === false &&
      t.prefix === false &&
      t.postfix === false &&
      t.binop === null
    )
  )
    return false;
  if (ucHash === null) return t.updateContext === null;
  const s = typeof t.updateContext === "function" ? srcOf(t.updateContext) : null;
  return s !== null && hash(s) === ucHash;
}

function checkContext(c, token, isExpr, preserveSpace) {
  return (
    isInst(c, TokContext) &&
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
    !checkTokenType(tt.jsxTagStart, "jsxTagStart", false, true, JSX_UPDATE_CONTEXT[0]) ||
    !checkTokenType(tt.jsxTagEnd, "jsxTagEnd", false, false, JSX_UPDATE_CONTEXT[1])
  )
    return null;
  if (!checkContext(tc.tc_oTag, "<tag", false, false) || !checkContext(tc.tc_cTag, "</tag", false, false) || !checkContext(tc.tc_expr, "<tag>...</tag>", true, true))
    return null;
  return [tt.jsxTagStart.updateContext, tt.jsxTagEnd.updateContext];
}

// the acorn namespace object the plugin reads its helpers from
function acornIntact(Parser) {
  const a = Parser.acorn;
  return (
    a !== null &&
    typeof a === "object" &&
    a.Parser === Parser &&
    a.tokTypes === tokTypes &&
    a.tokContexts === tokContexts &&
    a.TokenType === TokenType &&
    a.TokContext === TokContext &&
    a.isNewLine === isNewLine &&
    a.isIdentifierStart === isIdentifierStart &&
    a.isIdentifierChar === isIdentifierChar
  );
}

// The plugin's options, from its own jsx_parseNamespacedName (calls this.eat
// only when allowNamespaces) and jsx_parseElementName (calls this.unexpected
// for a namespaced name followed by a dot unless allowNamespacedObjects).
function optionsOf(proto) {
  let ate = false;
  proto.jsx_parseNamespacedName.call({
    start: 0,
    startLoc: null,
    jsx_parseIdentifier: () => ({}),
    eat: () => ((ate = true), false),
  });
  const REJECT = {};
  let objects = true;
  try {
    proto.jsx_parseElementName.call({
      type: tokTypes.dot,
      start: 0,
      startLoc: null,
      jsx_parseNamespacedName: () => ({ type: "JSXNamespacedName" }),
      unexpected: () => {
        throw REJECT;
      },
      eat: () => false,
    });
  } catch (e) {
    if (e !== REJECT) throw e;
    objects = false;
  }
  return { allowNamespaces: ate, allowNamespacedObjects: objects };
}

function recognise(C, Parser) {
  if (typeof C !== "function" || Object.getPrototypeOf(C) !== Parser) return null;
  const proto = C.prototype;
  if (!proto || Object.getPrototypeOf(proto) !== Parser.prototype) return null;
  if (!sameKeys(C, ["length", "name", "prototype", "acornJsx"])) return null;
  if (!sameKeys(proto, ["constructor", ...METHOD_NAMES]) || proto.constructor !== C) return null;
  const classSrc = srcOf(C);
  if (classSrc === null || classSrc.length !== JSX_CLASS[1] || hash(classSrc) !== JSX_CLASS[0]) return null;
  const methods = methodsOf(proto);
  if (methods === null) return null;
  // (every method's source occurs once in the class source: it is that
  // method's definition if it starts with the method's name)
  const inClass = (f, head) => {
    const s = srcOf(f);
    return s !== null && s.startsWith(head + "(") && classSrc.includes(s);
  };
  for (let i = 0; i < METHOD_NAMES.length; i++) if (!inClass(methods[i], METHOD_NAMES[i])) return null;
  const gd = Object.getOwnPropertyDescriptor(C, "acornJsx");
  if (!gd || typeof gd.get !== "function" || gd.set !== undefined || !inClass(gd.get, "get acornJsx")) return null;
  if (!acornIntact(Parser)) return null;
  let J;
  try {
    J = C.acornJsx;
  } catch {
    return null;
  }
  const hooks = checkJsxTokens(J);
  if (hooks === null) return null;
  const o = optionsOf(proto);
  return { options: { ...o, tokTypes: J.tokTypes, readEntity: methods[READ_ENTITY] }, methods, getter: gd.get, J, hooks };
}

function intact(C, rec) {
  const proto = C.prototype;
  for (let i = 0; i < METHOD_NAMES.length; i++) if (proto[METHOD_NAMES[i]] !== rec.methods[i]) return false;
  const gd = Object.getOwnPropertyDescriptor(C, "acornJsx");
  if (!gd || gd.get !== rec.getter) return false;
  const tt = rec.J.tokTypes;
  return tt.jsxTagStart.updateContext === rec.hooks[0] && tt.jsxTagEnd.updateContext === rec.hooks[1] && tt.jsxName.updateContext === null && tt.jsxText.updateContext === null;
}

/** acorn-jsx options as the fast parser's JSX mode takes them */
export interface JsxOptions {
  allowNamespaces: boolean;
  allowNamespacedObjects: boolean;
  // the plugin's own token types (acornJsx.tokTypes)
  tokTypes: any;
  // the plugin's jsx_readEntity (the fast parser calls it on a stand-in for
  // the parser, so entities come from the plugin's own table)
  readEntity: Function;
}

// options for the fast parser's JSX mode, or null
export function jsxOptionsOf(C: Function, Parser: any): JsxOptions | null {
  let rec = registry.get(C);
  if (rec === undefined) {
    rec = recognised.get(C);
    if (rec === undefined) {
      try {
        rec = recognise(C, Parser);
      } catch {
        rec = null;
      }
      recognised.set(C, rec);
    }
  }
  if (rec === null) return null;
  return intact(C, rec) ? rec.options : null;
}

// called (through index.mjs's hook) for every class @r1ck404/fast-acorn-jsx creates
// on this package's Parser
export function registerJsxClass(C: any, options: any): void {
  const methods = methodsOf(C.prototype);
  const gd = Object.getOwnPropertyDescriptor(C, "acornJsx");
  if (methods === null || !gd) return;
  const J = C.acornJsx;
  const hooks = [J.tokTypes.jsxTagStart.updateContext, J.tokTypes.jsxTagEnd.updateContext];
  registry.set(C, {
    options: {
      allowNamespaces: options.allowNamespaces === true,
      allowNamespacedObjects: options.allowNamespacedObjects === true,
      tokTypes: J.tokTypes,
      readEntity: methods[READ_ENTITY],
    },
    methods,
    getter: gd.get,
    J,
    hooks,
  });
}
