// Serializer for differential tests that also captures object identity
// (shared nodes, shared Position / SourceLocation objects, acorn's shared
// empty arrays within one result), prototypes (Node / Position /
// SourceLocation / Token of acorn or of @r1ck404/fast-acorn: the sources in src/ or
// the shipped index.mjs) and key order.
// TokenType objects are written by label (the two libraries have different
// TokenType objects).
import * as ref from "acorn";
import * as V from "../src/shared.mjs";
import * as D from "../index.mjs";

const is = (proto, name) => proto === ref[name].prototype || proto === V[name].prototype || proto === D[name].prototype;

export function idSer(root) {
  const ids = new Map();
  let next = 0;
  const out = [];
  (function walk(x) {
    if (x === null || typeof x !== "object") {
      if (typeof x === "bigint") out.push("B" + x);
      else if (typeof x === "function") out.push("F" + x.name);
      else out.push(x === undefined ? "U" : JSON.stringify(x));
      return;
    }
    if (x instanceof ref.TokenType || x instanceof V.TokenType || x instanceof D.TokenType) return out.push("TT:" + x.label);
    if (x instanceof RegExp) return out.push("RE:" + String(x));
    const seen = ids.get(x);
    if (seen !== undefined) return out.push("@" + seen);
    ids.set(x, next++);
    const proto = Object.getPrototypeOf(x);
    const pname =
      is(proto, "Node") ? "Node" :
      is(proto, "Position") ? "Pos" :
      is(proto, "SourceLocation") ? "SL" :
      is(proto, "Token") ? "Tok" :
      proto === Array.prototype ? "A" : proto === Object.prototype ? "O" : proto === null ? "N" : "?";
    out.push(pname + "{");
    for (const k of Object.keys(x)) {
      out.push(k + ":");
      walk(x[k]);
    }
    out.push("}");
  })(root);
  return out.join(" ");
}
