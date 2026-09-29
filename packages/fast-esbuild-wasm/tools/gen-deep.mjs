// Adds the generator copies of deep mode (src/deep.mts) to the bundled
// engine (the text of esbuild's iife): build.mjs runs genDeep() on it.
//
// 1. The call graph of the engine's functions: a call "f(...)" goes to the
//    function f resolves to; "x.m(...)" to every method or function-valued
//    property named m (any receiver); a function passed as an argument is
//    called by the caller. The functions in a cycle of it (a recursion) are
//    the ones that need a copy.
// 2. The copied functions ("D"): those of them that are function
//    declarations, methods, or local functions only ever called by name
//    (not async, not generators, no "arguments"/"super"), plus every method
//    with the name of a copied method (so that "x.m$deep" belongs to the same
//    object as "x.m"), plus the functions that contain a copied local
//    function (its copy lives in theirs).
// 3. For each copied function f a generator "f$deep" (a method "m$deep"
//    next to the method) with the same body, in which a call to a copied
//    function is "(yield f$deep(...))" ("x.m$deep" when the receiver has
//    one that belongs to its "x.m", see __deepOwn, else the normal call);
//    local copied functions are generators in the copy. deepRun
//    (src/deep.mts) runs these generators.
// 4. Code that has no copy (other functions, callbacks, the top level)
//    calls a copied function with a check: in deep mode it runs the copy
//    ("__deepMode ? __deepRun(f$deep(...)) : f(...)"). The normal copied
//    functions call each other directly: they only run in deep mode when
//    called from somewhere else, which checks. A copied function that is
//    used as a value (and so may be called by anything) checks on entry.
import ts from "typescript";

const K = ts.SyntaxKind;
// (names that are called implicitly: never copied)
const SPECIAL = new Set(["constructor", "toString", "valueOf", "toJSON", "then", "toLocaleString"]);
// the methods of the built-in prototypes (Array, Map, Set, String,
// iterators, promises, functions, typed arrays, regular expressions)
const BUILTIN_METHODS = new Set(
  [Array.prototype, Map.prototype, Set.prototype, String.prototype, Promise.prototype, Function.prototype, Uint8Array.prototype, Object.getPrototypeOf(Uint8Array.prototype), RegExp.prototype, Object.getPrototypeOf(function* () {}).prototype, Object.getPrototypeOf(Object.getPrototypeOf((function* () {})())), DataView.prototype, WeakMap.prototype, Number.prototype]
    .flatMap((p) => Object.getOwnPropertyNames(p))
    .filter((k) => k !== "constructor"),
);

export function genDeep(text, { log = () => {} } = {}) {
  for (const name of ["__deepMode", "__deepRun", "__deepM", "__deepOwn", "__deepCompiled"]) {
    if (!new RegExp("\\b" + name + "\\b").test(text)) throw new Error("gen-deep: " + name + " is not in the engine");
    if (new RegExp("\\b" + name + "\\d").test(text)) throw new Error("gen-deep: " + name + " was renamed");
  }
  if (!/\bvar __deepCompiled = false;/.test(text)) throw new Error("gen-deep: no __deepCompiled declaration");
  if (/\$deep\b/.test(text.replace(/\b__deep\w*/g, ""))) throw new Error("gen-deep: the engine already has $deep names");

  const host = ts.createCompilerHost({ allowJs: true, noResolve: true, noLib: true });
  host.getSourceFile = (name) => (name === "/engine.js" ? ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS) : undefined);
  host.fileExists = (n) => n === "/engine.js";
  host.readFile = (n) => (n === "/engine.js" ? text : undefined);
  const program = ts.createProgram(["/engine.js"], { allowJs: true, noResolve: true, noLib: true, checkJs: false }, host);
  const sf = program.getSourceFile("/engine.js");
  const checker = program.getTypeChecker();

  const isFn = (n) =>
    n.kind === K.FunctionDeclaration || n.kind === K.FunctionExpression || n.kind === K.ArrowFunction || n.kind === K.MethodDeclaration || n.kind === K.GetAccessor || n.kind === K.SetAccessor || n.kind === K.Constructor;
  const hasMod = (n, k) => !!(n.modifiers && n.modifiers.some((m) => m.kind === k));
  const nameText = (n) => (n && (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) ? n.text : n && (ts.isStringLiteral(n) || ts.isNumericLiteral(n)) ? n.text : null);

  // ---- units (functions) ----
  const units = [];
  const unitOf = new Map();
  const byKey = new Map(); // member name -> units
  const addKey = (k, u) => {
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(u);
  };
  let root = null;
  (function collect(n, parent) {
    let u = parent;
    if (isFn(n)) {
      u = { node: n, id: units.length, parent, calls: new Set(), key: null, container: "value", name: null, escapes: false, async: hasMod(n, K.AsyncKeyword), gen: !!n.asteriskToken };
      units.push(u);
      unitOf.set(n, u);
      if (parent === null && root === null) root = u;
      const p = n.parent;
      if (n.kind === K.MethodDeclaration) {
        u.name = nameText(n.name);
        u.container = ts.isClassLike(p) ? "class" : "object";
        if (u.name !== null && !ts.isComputedPropertyName(n.name)) addKey(u.name, u);
      } else if (n.kind === K.GetAccessor || n.kind === K.SetAccessor) {
        u.container = "accessor";
        u.name = nameText(n.name);
        if (u.name !== null) addKey((n.kind === K.GetAccessor ? "get " : "set ") + u.name, u);
      } else if (n.kind === K.Constructor) {
        u.container = "constructor";
      } else if (n.kind === K.FunctionDeclaration) {
        u.name = n.name ? n.name.text : null;
        u.container = parent === root ? "top" : "local";
      } else if (ts.isVariableDeclaration(p) && p.initializer === n && ts.isIdentifier(p.name)) {
        u.name = p.name.text;
        u.container = parent === root ? "topvar" : "localvar";
      } else if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && p.initializer === n) {
        u.name = nameText(p.name);
        u.container = "property";
        if (u.name !== null) addKey(u.name, u);
      } else if (ts.isBinaryExpression(p) && p.right === n && ts.isPropertyAccessExpression(p.left)) {
        u.name = p.left.name.text;
        u.container = "property";
        addKey(u.name, u);
      }
    }
    ts.forEachChild(n, (c) => collect(c, u));
  })(sf, null);
  if (root === null || root.node.kind !== K.ArrowFunction) throw new Error("gen-deep: the engine is not an iife");

  // the unit a declaration of a symbol is (function declaration, or a
  // variable initialized with a function)
  const declUnit = (decl) => {
    if (!decl) return null;
    if (isFn(decl)) return unitOf.get(decl) || null;
    if (ts.isVariableDeclaration(decl) && decl.initializer && (decl.initializer.kind === K.ArrowFunction || decl.initializer.kind === K.FunctionExpression)) return unitOf.get(decl.initializer);
    return null;
  };
  const symCache = new Map();
  const resolve = (id) => {
    if (symCache.has(id)) return symCache.get(id);
    let sym = checker.getSymbolAtLocation(id);
    let r = null;
    if (sym && sym.declarations && sym.declarations.length === 1) r = declUnit(sym.declarations[0]);
    symCache.set(id, r);
    return r;
  };

  // ---- call graph ----
  // a call's target: { fn: unit } | { fnCall: unit } (f.call) | { key } | null
  const targetOf = (call) => {
    const c = call.expression;
    if (ts.isIdentifier(c)) {
      const u = resolve(c);
      return u ? { fn: u } : null;
    }
    if (ts.isPropertyAccessExpression(c)) {
      if (c.name.text === "call" && ts.isIdentifier(c.expression)) {
        const u = resolve(c.expression);
        if (u) return { fnCall: u };
      }
      return { key: c.name.text, recv: c.expression };
    }
    return null;
  };
  // (for the call graph only: a method call that is most likely a built-in
  // one, on a global object like "JSON" or with the name of a method of the
  // built-in prototypes, is not taken for a call of the engine's methods of
  // that name. Leaving out a call here can only make deep mode reach less
  // deeply, never change what the code does.)
  const isBuiltinCall = (t) => {
    if (BUILTIN_METHODS.has(t.key)) return true;
    if (ts.isIdentifier(t.recv)) {
      const sym = checker.getSymbolAtLocation(t.recv);
      if (!sym || !sym.declarations || sym.declarations.length === 0) return true;
    }
    return false;
  };
  const refs = new Map(); // unit -> non-call references (identifiers)
  (function visit(n, u) {
    if (isFn(n) && unitOf.get(n) !== u) {
      const cu = unitOf.get(n);
      if (ts.isCallExpression(n.parent) && n.parent.arguments.includes(n) && u) u.calls.add(cu);
      if (cu.container === "value") cu.escapes = true;
      ts.forEachChild(n, (c) => visit(c, cu));
      return;
    }
    if (ts.isCallExpression(n) && u) {
      const t = targetOf(n);
      if (t && t.fn) u.calls.add(t.fn);
      else if (t && t.fnCall) u.calls.add(t.fnCall);
      else if (t && t.key !== undefined && !isBuiltinCall(t)) for (const m of byKey.get(t.key) || []) u.calls.add(m);
    }
    if (ts.isPropertyAccessExpression(n) && u && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) {
      for (const m of byKey.get("get " + n.name.text) || []) u.calls.add(m);
      for (const m of byKey.get("set " + n.name.text) || []) u.calls.add(m);
    }
    if (ts.isNewExpression(n) && u && ts.isIdentifier(n.expression)) {
      const sym = checker.getSymbolAtLocation(n.expression);
      const d = sym && sym.declarations && sym.declarations[0];
      const cls = d && (ts.isClassDeclaration(d) ? d : ts.isVariableDeclaration(d) && d.initializer && ts.isClassExpression(d.initializer) ? d.initializer : null);
      if (cls) {
        for (const m of cls.members) {
          if (m.kind === K.Constructor) u.calls.add(unitOf.get(m));
          if (ts.isPropertyDeclaration(m) && m.initializer) {
            // (field initializers run in the constructor)
            (function scan(x) {
              if (isFn(x)) return;
              if (ts.isCallExpression(x)) {
                const t = targetOf(x);
                if (t && t.fn) u.calls.add(t.fn);
                else if (t && t.key !== undefined) for (const mm of byKey.get(t.key) || []) u.calls.add(mm);
              }
              ts.forEachChild(x, scan);
            })(m.initializer);
          }
        }
      }
    }
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isCallee = ts.isCallExpression(p) && p.expression === n;
      const isDotCall = ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === "call" && ts.isCallExpression(p.parent) && p.parent.expression === p;
      const isDeclName = (ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p) || ts.isFunctionExpression(p) || ts.isMethodDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isParameter(p) || ts.isClassDeclaration(p)) && p.name === n;
      const isProp = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n);
      if (!isCallee && !isDotCall && !isDeclName && !isProp) {
        let target = null;
        if (ts.isShorthandPropertyAssignment(p)) {
          const sym = checker.getShorthandAssignmentValueSymbol(p);
          if (sym && sym.declarations && sym.declarations.length === 1) target = declUnit(sym.declarations[0]);
        } else target = resolve(n);
        if (target) {
          target.escapes = true;
          if (!refs.has(target)) refs.set(target, []);
          refs.get(target).push(n);
          if (u && ts.isCallExpression(p) && p.arguments.includes(n)) u.calls.add(target);
        }
      }
    }
    ts.forEachChild(n, (c) => visit(c, u));
  })(sf, null);

  // ---- recursive units (Tarjan) ----
  const recursive = new Set();
  {
    const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
    let idx = 0;
    for (const r of units) {
      if (index.has(r)) continue;
      const work = [[r, [...r.calls], 0]];
      index.set(r, idx); low.set(r, idx); idx++; stack.push(r); onStack.add(r);
      while (work.length) {
        const fr = work[work.length - 1];
        const v = fr[0];
        if (fr[2] < fr[1].length) {
          const w = fr[1][fr[2]++];
          if (!index.has(w)) {
            index.set(w, idx); low.set(w, idx); idx++; stack.push(w); onStack.add(w);
            work.push([w, [...w.calls], 0]);
          } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        } else {
          work.pop();
          if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))); }
          if (low.get(v) === index.get(v)) {
            const comp = [];
            let w;
            do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
            if (comp.length > 1 || v.calls.has(v)) for (const x of comp) recursive.add(x);
          }
        }
      }
    }
  }

  // ---- the copied units ----
  const usesOwn = (fnNode, test) => {
    let found = false;
    (function w(x) {
      if (found) return;
      if (test(x)) { found = true; return; }
      if (x !== fnNode && isFn(x) && x.kind !== K.ArrowFunction) return;
      ts.forEachChild(x, w);
    })(fnNode);
    return found;
  };
  const usesThis = (fnNode) => usesOwn(fnNode, (x) => x.kind === K.ThisKeyword);
  const convertible = (u) => {
    if (u.async || u.gen || u.name === null || SPECIAL.has(u.name)) return false;
    const n = u.node;
    if (u.container === "class" || u.container === "object") {
      if (ts.isComputedPropertyName(n.name) || ts.isStringLiteral(n.name) || ts.isNumericLiteral(n.name)) return false;
    } else if (u.container === "top") {
      // (only at the top of the iife: its copy is next to it)
      if (n.parent !== root.node.body) return false;
    } else if (u.container === "local" || u.container === "localvar") {
      // only ever called by name
      if (refs.has(u)) return false;
      if (u.container === "localvar") {
        const decl = n.parent;
        if (!(decl.parent.flags & ts.NodeFlags.Const)) return false;
      }
    } else return false;
    if (usesOwn(n, (x) => (ts.isIdentifier(x) && x.text === "arguments") || x.kind === K.SuperKeyword)) return false;
    return true;
  };
  const D = new Set();
  for (const u of recursive) if (convertible(u)) D.add(u);
  for (;;) {
    let changed = false;
    // every method with the name of a copied method
    const keys = new Set([...D].filter((u) => u.container === "class" || u.container === "object").map((u) => u.name));
    for (const k of keys) for (const m of byKey.get(k) || []) if (!D.has(m) && convertible(m)) { D.add(m); changed = true; }
    // a copied local function's copy is in the copy of its function
    for (const u of [...D]) {
      if (u.container !== "local" && u.container !== "localvar") continue;
      const p = u.parent;
      if (D.has(p)) continue;
      if (convertible(p)) { D.add(p); changed = true; }
      else { D.delete(u); changed = true; }
    }
    if (!changed) break;
  }
  const dKeys = new Set([...D].filter((u) => u.container === "class" || u.container === "object").map((u) => u.name));
  // (a method named like a copied one that has no copy would find a
  // superclass's copy: not allowed)
  for (const k of dKeys) {
    for (const m of byKey.get(k) || []) {
      if (D.has(m)) continue;
      const cls = m.node.parent && (ts.isClassLike(m.node.parent) ? m.node.parent : m.node.parent.parent && ts.isClassLike(m.node.parent.parent) ? m.node.parent.parent : null);
      if (cls && (cls.heritageClauses || isExtended(cls))) throw new Error("gen-deep: method " + k + " of a class hierarchy has no copy");
    }
  }
  function isExtended(cls) {
    if (!cls.name) return false;
    return new RegExp("\\bextends " + cls.name.text + "\\b").test(text);
  }
  // An own property assigned with a copied method's name would hide the
  // method but not its copy ("x.m$deep" would not be "x.m"): for "this" in
  // a class, the class and its superclasses must not have such a method.
  const classHasMethod = (cls, k) => {
    for (let c = cls, guard = 0; c && guard < 50; guard++) {
      if (c.members.some((m) => (ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m)) && nameText(m.name) === k)) return true;
      const h = c.heritageClauses && c.heritageClauses.find((x) => x.token === K.ExtendsKeyword);
      if (!h) return false;
      const e = h.types[0].expression;
      if (!ts.isIdentifier(e)) return true;
      const sym = checker.getSymbolAtLocation(e);
      const d = sym && sym.declarations && sym.declarations[0];
      c = d && (ts.isClassLike(d) ? d : ts.isVariableDeclaration(d) && d.initializer && ts.isClassExpression(d.initializer) ? d.initializer : null);
      if (!c) return true;
    }
    return true;
  };
  (function checkAssign(n) {
    // (a value that is not a function cannot be called as a method anyway)
    const notFunction = (v) =>
      ts.isLiteralExpression(v) || v.kind === K.TrueKeyword || v.kind === K.FalseKeyword || v.kind === K.NullKeyword || ts.isObjectLiteralExpression(v) || ts.isArrayLiteralExpression(v) || ts.isNewExpression(v) || ts.isTemplateExpression(v) || ts.isPrefixUnaryExpression(v) || (ts.isIdentifier(v) && v.text === "undefined") || (ts.isBinaryExpression(v) && v.operatorToken.kind !== K.EqualsToken && v.operatorToken.kind !== K.BarBarToken && v.operatorToken.kind !== K.AmpersandAmpersandToken && v.operatorToken.kind !== K.QuestionQuestionToken && v.operatorToken.kind !== K.CommaToken);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === K.EqualsToken && ts.isPropertyAccessExpression(n.left) && dKeys.has(n.left.name.text) && !notFunction(n.right)) {
      const recv = n.left.expression;
      if (recv.kind === K.ThisKeyword) {
        let cls = n.parent;
        while (cls && !ts.isClassLike(cls)) cls = cls.parent;
        if (!cls || classHasMethod(cls, n.left.name.text)) throw new Error("gen-deep: this." + n.left.name.text + " is assigned but may be a copied method");
      }
      // (on other objects the call checks at run time that the method is
      // not an own property without its copy: __deepOwn)
    }
    ts.forEachChild(n, checkAssign);
  })(sf);

  // methods used as values (e.g. "x.m.bind(x)"): they check on entry (not
  // for a name that is also a data property's: "x.m" is taken for that;
  // as above, this can only make deep mode reach less deeply)
  const dataKeys = new Set();
  (function scanData(n) {
    const isFnValue = (v) => v && (v.kind === K.ArrowFunction || v.kind === K.FunctionExpression);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === K.EqualsToken && ts.isPropertyAccessExpression(n.left) && !isFnValue(n.right)) dataKeys.add(n.left.name.text);
    if (ts.isPropertyAssignment(n) && !isFnValue(n.initializer)) { const k = nameText(n.name); if (k !== null) dataKeys.add(k); }
    if (ts.isShorthandPropertyAssignment(n)) dataKeys.add(n.name.text);
    if (ts.isPropertyDeclaration(n) && !isFnValue(n.initializer)) { const k = nameText(n.name); if (k !== null) dataKeys.add(k); }
    ts.forEachChild(n, scanData);
  })(sf);
  const methodValue = new Set();
  (function scan(n) {
    if (ts.isPropertyAccessExpression(n) && dKeys.has(n.name.text) && !dataKeys.has(n.name.text) && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) methodValue.add(n.name.text);
    ts.forEachChild(n, scan);
  })(sf);

  // ---- emission ----
  const stats = { recursive: recursive.size, copied: D.size, genCalls: 0, checkedCalls: 0, optionalSkipped: 0, prologues: 0, noPrologue: [], sites: [] };
  let tempId = 0;
  const trivia = (n) => text.slice(n.pos, n.getStart(sf));
  const strip = (n, s) => s.slice(n.getStart(sf) - n.pos);

  // ctx: { mode: "plain" | "check" | "gen", copy: bool, temps: string[] | null }
  function emit(n, ctx) {
    if (isFn(n)) return emitFn(n, ctx);
    if (ts.isCallExpression(n)) {
      const r = emitCall(n, ctx);
      if (r !== null) return r;
    }
    return emitChildren(n, n.pos, n.end, ctx);
  }
  function emitChildren(n, start, end, ctx) {
    let out = "";
    let pos = start;
    ts.forEachChild(n, (c) => {
      if (c.pos < start || c.end > end) return;
      out += text.slice(pos, c.pos) + emit(c, ctx);
      pos = c.end;
    });
    return out + text.slice(pos, end);
  }
  // "(a, b)": the argument list of a call
  function emitArgs(call, ctx) {
    return emitChildren(call, call.expression.end, call.end, ctx);
  }
  function argsInner(call, ctx) {
    const s = emitArgs(call, ctx);
    return s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
  }

  function emitCall(call, ctx) {
    const t = targetOf(call);
    if (t === null) return null;
    // (in a copy, a copied local function is a generator: called from
    // anything but a generator, it runs with deepRun)
    if (ctx.mode === "plain" && !(ctx.copy && (t.fn || t.fnCall) && D.has(t.fn || t.fnCall) && ((t.fn || t.fnCall).container === "local" || (t.fn || t.fnCall).container === "localvar"))) return null;
    const lead = trivia(call);
    const optional = !!(call.flags & ts.NodeFlags.OptionalChain);
    if (t.fn || t.fnCall) {
      const u = t.fn || t.fnCall;
      if (!D.has(u)) return null;
      const local = u.container === "local" || u.container === "localvar";
      if (local && !ctx.copy) return null;
      if (optional) { stats.optionalSkipped++; return null; }
      const name = call.expression.getText(sf);
      const fnText = t.fnCall ? call.expression.expression.getText(sf) : name;
      const deepName = local ? fnText : fnText + "$deep";
      const callTail = t.fnCall ? ".call" : "";
      const args = emitArgs(call, ctx);
      if (ctx.mode === "gen") {
        stats.genCalls++;
        return lead + "(yield " + deepName + callTail + args + ")";
      }
      stats.checkedCalls++;
      stats.sites.push([ctx.owner ? ctx.owner.name : null, u.name]);
      if (local) return lead + "__deepRun(" + deepName + callTail + args + ")";
      return lead + "(__deepMode ? __deepRun(" + deepName + callTail + args + ") : " + fnText + callTail + emitArgs(call, ctx) + ")";
    }
    // a method call
    if (!dKeys.has(t.key)) return null;
    if (optional) { stats.optionalSkipped++; return null; }
    const pa = call.expression;
    const recvText = strip(pa.expression, emit(pa.expression, ctx));
    const isPrivate = ts.isPrivateIdentifier(pa.name);
    const k = t.key;
    if (ctx.mode === "gen") {
      stats.genCalls++;
      if (isPrivate) return lead + "(yield " + recvText + "." + k + "$deep" + emitArgs(call, ctx) + ")";
      let r = recvText;
      let first = r;
      if (!(pa.expression.kind === K.ThisKeyword || ts.isIdentifier(pa.expression))) {
        r = "__dt" + ++tempId;
        ctx.temps.push(r);
        first = "(" + r + " = " + recvText + ")";
      }
      return lead + "(" + first + "." + k + "$deep !== undefined && __deepOwn(" + r + ', "' + k + '", "' + k + '$deep") ? (yield ' + r + "." + k + "$deep" + emitArgs(call, ctx) + ") : " + r + "." + k + emitArgs(call, ctx) + ")";
    }
    stats.checkedCalls++;
    stats.sites.push([ctx.owner ? ctx.owner.name : null, "." + k]);
    if (isPrivate) return lead + "(__deepMode ? __deepRun(" + recvText + "." + k + "$deep" + emitArgs(call, ctx) + ") : " + recvText + "." + k + emitArgs(call, ctx) + ")";
    const inner = argsInner(call, ctx);
    return lead + "(__deepMode ? __deepM(" + recvText + ', "' + k + '$deep", "' + k + '"' + (inner.trim() === "" ? "" : ", " + inner) + ") : " + recvText + "." + k + emitArgs(call, ctx) + ")";
  }

  // the body of a function in a mode, as "{ ... }"
  function emitBody(fn, ctx) {
    const b = fn.body;
    if (b.kind !== K.Block) {
      const e = strip(b, emit(b, ctx));
      return "{ return " + e + "; }";
    }
    const s = strip(b, emit(b, ctx));
    return s;
  }
  function withTemps(bodyText, temps) {
    if (temps.length === 0) return bodyText;
    return "{ let " + temps.join(", ") + ";" + bodyText.slice(1);
  }
  function emitParams(fn, ctx) {
    const ps = fn.parameters;
    return "(" + emitChildren(fn, ps.pos, ps.end, ctx) + ")";
  }

  // the generator copy of a copied function
  function genCopy(u) {
    const fn = u.node;
    const temps = [];
    const params = emitParams(fn, { mode: "check", copy: true, temps: null });
    const body = withTemps(emitBody(fn, { mode: "gen", copy: true, temps }), temps);
    return { params, body };
  }

  function emitFn(fn, ctx) {
    const u = unitOf.get(fn);
    const lead = trivia(fn);
    // a copied local function in a copy: its generator
    if (ctx.copy && D.has(u) && (u.container === "local" || u.container === "localvar")) {
      const { params, body } = genCopy(u);
      if (u.container === "local") return lead + "function* " + u.name + params + " " + body;
      const bind = fn.kind === K.ArrowFunction && usesThis(fn) ? ".bind(this)" : "";
      const fname = fn.kind === K.FunctionExpression && fn.name ? " " + fn.name.text : "";
      return lead + "function*" + fname + " " + params + " " + body + bind;
    }
    // the function itself
    const inner = D.has(u) ? { mode: "plain", copy: ctx.copy, temps: null, owner: u } : { mode: "check", copy: ctx.copy, temps: null, owner: u };
    const head = emitChildren(fn, fn.pos, fn.body.pos, inner);
    let bodyText = emit(fn.body, inner);
    if (!D.has(u) || (u.container !== "top" && u.container !== "class" && u.container !== "object")) return head + bodyText;
    // (used as a value: check on entry)
    const isMethod = u.container !== "top";
    if ((!isMethod && u.escapes) || (isMethod && methodValue.has(u.name))) {
      const names = [];
      let ok = true;
      for (const p of fn.parameters) {
        if (!ts.isIdentifier(p.name)) ok = false;
        else names.push((p.dotDotDotToken ? "..." : "") + p.name.text);
      }
      if (ok) {
        stats.prologues++;
        (stats.prologueNames ||= []).push(u.name);
        const target = isMethod ? "this." + u.name + "$deep(" + names.join(", ") + ")" : u.name + "$deep.call(this" + names.map((x) => ", " + x).join("") + ")";
        const brace = bodyText.indexOf("{");
        bodyText = bodyText.slice(0, brace + 1) + " if (__deepMode) return __deepRun(" + target + ");" + bodyText.slice(brace + 1);
      } else stats.noPrologue.push(u.name);
    }
    const own = head + bodyText;
    // the copy next to it
    const { params, body } = genCopy(u);
    const isStatic = hasMod(fn, K.StaticKeyword) ? "static " : "";
    if (u.container === "top") return own + "\n  function* " + u.name + "$deep" + params + " " + body;
    if (u.container === "class") return own + "\n  " + isStatic + "*" + fn.name.getText(sf) + "$deep" + params + " " + body;
    return own + ",\n  *" + fn.name.getText(sf) + "$deep" + params + " " + body;
  }

  const out = emit(sf, { mode: "check", copy: false, temps: null }).replace(/\bvar __deepCompiled = false;/, "var __deepCompiled = true;");
  log(`gen-deep: ${stats.recursive} recursive functions, ${stats.copied} copied, ${stats.genCalls} calls in copies, ${stats.checkedCalls} checked calls, ${stats.prologues} entry checks, ${stats.optionalSkipped} optional calls skipped` + (stats.noPrologue.length ? ", no entry check: " + stats.noPrologue.join(" ") : ""));
  return { code: out, stats, D, units };
}
