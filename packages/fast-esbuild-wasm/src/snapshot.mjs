// JS-only: a serialized copy of the parsed runtime AST, so the first
// transform does not have to parse esbuild's runtime helpers (~17 KB of code,
// ~20 ms while the engine is still cold). build.mjs parses the runtime with
// this port at build time, encodes the AST (before graph.markASTShared) with
// encodeSnapshot and bakes the text into the engine; bundler.runtimeCache
// decodes it instead of parsing (see the test hook there).
//
// The encoding is a generic object graph: class instances (constructed with
// "new C()" and then assigned field by field in the order of the original, so
// they get the same hidden classes), arrays, Maps and Sets, with object
// identity preserved, and the module-level singletons (ENullShared, ...)
// referenced by index. Primitives: numbers, strings, booleans, null and
// undefined. Anything else makes encodeSnapshot throw, which fails the build.
//
// Format: JSON {version, classes: [[name, fields, kinds]], strings,
// numbers, data}, where "data" is a stream of variable-length integers in
// printable ASCII (see DIGITS below): an op code followed by its operands.
// Fields that hold the same kind of primitive in every instance skip the op
// code: "u" non-negative integers, "b" booleans, "l" locations (non-negative
// integers in fields named "loc" or "...Loc", written as the difference to the
// previous location, which is small); "v" is any value.
import {
  AST,
  Arg,
  ArrayBinding,
  BArray,
  BIdentifier,
  BObject,
  Binding,
  Case,
  Catch,
  Class,
  ClassStaticBlock,
  ClauseItem,
  Decl,
  DeclaredSymbol,
  EArray,
  EArrow,
  EAwait,
  EBigInt,
  EBinary,
  EBoolean,
  ECall,
  EClass,
  EDot,
  EFunction,
  EIdentifier,
  EIf,
  EImportIdentifier,
  EImportMeta,
  EIndex,
  ENew,
  ENewTarget,
  ENumber,
  EObject,
  EPrivateIdentifier,
  ERegExp,
  ERequireString,
  ESpread,
  EString,
  ETemplate,
  EUnary,
  EYield,
  Expr,
  Fn,
  FnBody,
  ModuleTypeData,
  NamedExport,
  Part,
  Property,
  PropertyBinding,
  SBlock,
  SBreak,
  SClass,
  SComment,
  SContinue,
  SDirective,
  SDoWhile,
  SExportClause,
  SExportDefault,
  SExportFrom,
  SExportStar,
  SExpr,
  SFor,
  SForIn,
  SForOf,
  SFunction,
  SIf,
  SImport,
  SLabel,
  SLocal,
  SReturn,
  SSwitch,
  SThrow,
  STry,
  SWhile,
  Scope,
  ScopeMember,
  Stmt,
  SymbolUse,
  TemplatePart,
  EThisShared,
  EUndefinedShared,
  ENullShared,
  EMissingShared,
  ESuperShared,
  BMissingShared,
  SEmptyShared,
  SDebuggerShared,
  STypeScriptShared,
} from "./js_ast.mjs";
import { LocRef, Symbol } from "./ast.mjs";
import { Range, Span, RANGE_ZERO } from "./logger.mjs";

// The classes a snapshot may contain (by name; an explicit list, so that the
// engine bundle keeps only what it uses: the runtime's AST needs a subset,
// and encodeSnapshot fails the build if it meets a class missing here)
const CLASSES = {
  AST, Arg, ArrayBinding, BArray, BIdentifier, BObject, Binding, Case, Catch, Class, ClassStaticBlock, ClauseItem,
  Decl, DeclaredSymbol, EArray, EArrow, EAwait, EBigInt, EBinary, EBoolean, ECall, EClass, EDot, EFunction,
  EIdentifier, EIf, EImportIdentifier, EImportMeta, EIndex, ENew, ENewTarget, ENumber, EObject, EPrivateIdentifier,
  ERegExp, ERequireString, ESpread, EString, ETemplate, EUnary, EYield, Expr, Fn, FnBody, ModuleTypeData,
  NamedExport, Part, Property, PropertyBinding, SBlock, SBreak, SClass, SComment, SContinue, SDirective, SDoWhile,
  SExportClause, SExportDefault, SExportFrom, SExportStar, SExpr, SFor, SForIn, SForOf, SFunction, SIf, SImport,
  SLabel, SLocal, SReturn, SSwitch, SThrow, STry, SWhile, Scope, ScopeMember, Stmt, SymbolUse, TemplatePart,
  LocRef, Symbol, Range, Span,
};

// Objects that are shared by every parse (compared by identity)
const SINGLETONS = [
  RANGE_ZERO,
  EThisShared,
  EUndefinedShared,
  ENullShared,
  EMissingShared,
  ESuperShared,
  BMissingShared,
  SEmptyShared,
  SDebuggerShared,
  STypeScriptShared,
];

const VERSION = 3;

// Op codes
const OP_UNDEFINED = 0;
const OP_NULL = 1;
const OP_FALSE = 2;
const OP_TRUE = 3;
const OP_INT = 4; // + n (a non-negative integer)
const OP_NEG_INT = 5; // + n (the integer -n, n > 0)
const OP_NUMBER = 6; // + index into "numbers" (anything else, as a string)
const OP_STRING = 7; // + index into "strings"
const OP_REF = 8; // + id of an object decoded before
const OP_SINGLETON = 9; // + index into SINGLETONS
const OP_ARRAY = 10; // + length, items
const OP_MAP = 11; // + size, keys and values
const OP_SET = 12; // + size, items
const OP_OBJECT = 13; // + class index, field values

// Integers are little-endian base 45: every digit but the last is written
// with the second half of the 90-character alphabet (printable ASCII without
// the characters that would need escaping in a string literal: " ' \ `)
const BASE = 45;
const DIGITS = (() => {
  let s = "";
  for (let c = 33; c <= 126; c++) if (c !== 34 && c !== 39 && c !== 92 && c !== 96) s += String.fromCharCode(c);
  return s;
})();

// The kind of every field of every class in the graph (see the format above)
function fieldKinds(root     )                                {
  const kinds = new Map();
  const seen = new Set();
  const stack = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== "object" || seen.has(v) || SINGLETONS.includes(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
    } else if (v instanceof Map) {
      for (const [k, x] of v) stack.push(k, x);
    } else if (v instanceof Set) {
      for (const x of v) stack.push(x);
    } else {
      let fields = kinds.get(v.constructor);
      if (fields === undefined) kinds.set(v.constructor, (fields = new Map()));
      for (const k of Object.keys(v)) {
        const x = v[k];
        const kind = typeof x === "boolean" ? "b" : Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0) ? (k === "loc" || k.endsWith("Loc") ? "l" : "u") : "v";
        const old = fields.get(k);
        fields.set(k, old === undefined || old === kind ? kind : "v");
        stack.push(x);
      }
    }
  }
  return kinds;
}

const zigzag = (n        ) => (n >= 0 ? 2 * n : -2 * n - 1);
const unzigzag = (n        ) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

export function encodeSnapshot(root     )         {
  // (by identity: bundlers may rename the classes themselves, e.g. "_Part")
  const classNames = new Map();
  for (const name in CLASSES) classNames.set(CLASSES[name], name);
  const kindsByClass = fieldKinds(root);
  const ids = new Map();
  const classes                               = [];
  const classIndex = new Map();
  const strings           = [];
  const stringIndex = new Map();
  const numbers           = [];
  let data = "";
  let lastLoc = 0;

  const int = (n        ) => {
    while (n >= BASE) {
      data += DIGITS[BASE + (n % BASE)];
      n = Math.floor(n / BASE);
    }
    data += DIGITS[n];
  };

  const value = (v     ) => {
    if (v === undefined) return int(OP_UNDEFINED);
    if (v === null) return int(OP_NULL);
    if (v === false) return int(OP_FALSE);
    if (v === true) return int(OP_TRUE);
    if (typeof v === "number") {
      if (Number.isSafeInteger(v) && !Object.is(v, -0)) {
        if (v >= 0) {
          int(OP_INT);
          int(v);
        } else {
          int(OP_NEG_INT);
          int(-v);
        }
      } else {
        int(OP_NUMBER);
        int(numbers.length);
        numbers.push(Object.is(v, -0) ? "-0" : String(v));
      }
      return;
    }
    if (typeof v === "string") {
      let i = stringIndex.get(v);
      if (i === undefined) {
        i = strings.length;
        strings.push(v);
        stringIndex.set(v, i);
      }
      int(OP_STRING);
      int(i);
      return;
    }
    if (typeof v !== "object") throw new Error("snapshot: cannot encode a " + typeof v);
    const singleton = SINGLETONS.indexOf(v);
    if (singleton >= 0) {
      int(OP_SINGLETON);
      int(singleton);
      return;
    }
    const id = ids.get(v);
    if (id !== undefined) {
      int(OP_REF);
      int(id);
      return;
    }
    if (Object.isFrozen(v)) throw new Error("snapshot: unknown shared object " + (v.constructor && v.constructor.name));
    ids.set(v, ids.size);
    if (Array.isArray(v)) {
      int(OP_ARRAY);
      int(v.length);
      for (let i = 0; i < v.length; i++) {
        if (!(i in v)) throw new Error("snapshot: sparse array");
        value(v[i]);
      }
      return;
    }
    if (v instanceof Map) {
      int(OP_MAP);
      int(v.size);
      for (const [k, x] of v) {
        value(k);
        value(x);
      }
      return;
    }
    if (v instanceof Set) {
      int(OP_SET);
      int(v.size);
      for (const x of v) value(x);
      return;
    }
    const ctor = v.constructor;
    let ci = classIndex.get(ctor);
    if (ci === undefined) {
      const name = classNames.get(ctor);
      if (name === undefined) throw new Error("snapshot: class missing from CLASSES: " + (ctor && ctor.name));
      // Decoding does "new C()" and then assigns the fields in this order,
      // which must extend the constructor's own order (same hidden class)
      const fields = Object.keys(v);
      const initial = Object.keys(new ctor());
      if (initial.join() !== fields.slice(0, initial.length).join()) throw new Error("snapshot: field order of " + ctor.name + " differs from its constructor's");
      ci = classes.length;
      classIndex.set(ctor, ci);
      const kinds = kindsByClass.get(ctor);
      classes.push([name, fields, fields.map((f) => kinds.get(f)).join("")]);
    }
    const fields = classes[ci][1];
    const kinds = classes[ci][2];
    if (Object.keys(v).join() !== fields.join()) throw new Error("snapshot: instances of " + ctor.name + " have different fields");
    int(OP_OBJECT);
    int(ci);
    for (let i = 0; i < fields.length; i++) {
      const x = v[fields[i]];
      switch (kinds.charCodeAt(i)) {
        case 117: // u
          int(x);
          break;
        case 98: // b
          int(x ? 1 : 0);
          break;
        case 108: // l
          int(zigzag(x - lastLoc));
          lastLoc = x;
          break;
        default:
          value(x);
      }
    }
  };

  value(root);
  return JSON.stringify({ version: VERSION, classes, strings, numbers, data });
}

let digitValues                   = null;

// (build.mjs bakes the snapshot in as an object literal, tests pass the text)
export function decodeSnapshot(snapshotOrText     )      {
  const snapshot = typeof snapshotOrText === "string" ? JSON.parse(snapshotOrText) : snapshotOrText;
  if (snapshot.version !== VERSION) throw new Error("snapshot: unknown version");
  const classes = snapshot.classes;
  // (The strings are internalized like those of the object literal build.mjs
  // bakes in, also when a test passes the text: names are compared and used
  // as keys a lot)
  const strings = snapshot.strings.slice();
  for (let i = 0; i < strings.length; i++) strings[i] = Object.keys({ [strings[i]]: 0 })[0];
  const numbers = snapshot.numbers;
  const data         = snapshot.data;
  const ctors = new Array(classes.length);
  for (let i = 0; i < classes.length; i++) {
    const ctor = CLASSES[classes[i][0]];
    if (typeof ctor !== "function") throw new Error("snapshot: unknown class " + classes[i][0]);
    ctors[i] = ctor;
  }
  if (digitValues === null) {
    digitValues = new Int8Array(128).fill(-1);
    for (let i = 0; i < DIGITS.length; i++) digitValues[DIGITS.charCodeAt(i)] = i;
  }
  const digits = digitValues;
  const objects = [];
  let pos = 0;
  let lastLoc = 0;

  const int = ()         => {
    let n = 0;
    let scale = 1;
    for (;;) {
      const d = digits[data.charCodeAt(pos++)];
      if (d < BASE) return n + d * scale;
      n += (d - BASE) * scale;
      scale *= BASE;
    }
  };

  const value = ()      => {
    switch (int()) {
      case OP_UNDEFINED:
        return undefined;
      case OP_NULL:
        return null;
      case OP_FALSE:
        return false;
      case OP_TRUE:
        return true;
      case OP_INT:
        return int();
      case OP_NEG_INT:
        return -int();
      case OP_NUMBER:
        return Number(numbers[int()]);
      case OP_STRING:
        return strings[int()];
      case OP_REF:
        return objects[int()];
      case OP_SINGLETON:
        return SINGLETONS[int()];
      case OP_ARRAY: {
        const n = int();
        const a = [];
        objects.push(a);
        for (let i = 0; i < n; i++) a.push(value());
        return a;
      }
      case OP_MAP: {
        const n = int();
        const m = new Map();
        objects.push(m);
        for (let i = 0; i < n; i++) {
          const k = value();
          m.set(k, value());
        }
        return m;
      }
      case OP_SET: {
        const n = int();
        const s = new Set();
        objects.push(s);
        for (let i = 0; i < n; i++) s.add(value());
        return s;
      }
      case OP_OBJECT: {
        const ci = int();
        const o = new ctors[ci]();
        objects.push(o);
        const fields = classes[ci][1];
        const kinds         = classes[ci][2];
        for (let i = 0; i < fields.length; i++) {
          switch (kinds.charCodeAt(i)) {
            case 117: // u
              o[fields[i]] = int();
              break;
            case 98: // b
              o[fields[i]] = int() === 1;
              break;
            case 108: // l
              o[fields[i]] = lastLoc += unzigzag(int());
              break;
            default:
              o[fields[i]] = value();
          }
        }
        return o;
      }
    }
    throw new Error("snapshot: corrupt data");
  };

  const root = value();
  if (pos !== data.length) throw new Error("snapshot: trailing data");
  return root;
}
// generated from snapshot.mts by tools/ts-build.mjs; edit that file
