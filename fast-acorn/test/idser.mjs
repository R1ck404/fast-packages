// Serializer for differential tests that also captures object identity
// (shared nodes, shared Position / SourceLocation objects, acorn's shared
// empty arrays within one result), prototypes (Node / Position /
// SourceLocation of either acorn copy) and key order. TokenType objects are
// written by label (the two acorn copies have different TokenType objects).
import * as ref from "acorn";
import * as V from "../vendor/acorn.mjs";

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
