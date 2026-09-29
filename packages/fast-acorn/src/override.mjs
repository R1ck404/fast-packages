// Fast path for Parser.extend() subclasses that only override
// parseFunctionBody -- e.g. Nodepod's topLevelParser(), which skips function
// bodies token by token.
//
// The subclass's own method is run for real, with `this` bound to a facade
// that presents the fast parser's state through acorn's API (this.type is the
// real TokenType object, startNode() makes a real Node, ...), and
// super.parseFunctionBody() reaching acorn's method on the facade runs the
// fast parser's function body. A class qualifies only when
//  * it directly extends @r1ck404/fast-acorn's Parser, its class body is exactly one
//    ordinary `parseFunctionBody` method (no constructor, fields, static
//    members or blocks), and the prototype's function is that method, and
//  * the method's source (whatever the minifier made of it) passes a
//    conservative whitelist check: plain control flow over locals; reads of
//    a fixed set of parser properties; calls only to next / startNode /
//    startNodeAt / finishNode / finishNodeAt / exitScope / eat / expect /
//    unexpected / raise / raiseRecoverable on the parser, and to
//    super.parseFunctionBody with its own four parameters; writes only to
//    locals and to properties of AST nodes it got from the parser;
//    arithmetic/relational operators only on numeric locals and literals.
//    So it cannot have effects outside the parse. (Reading properties of
//    objects it closes over, like `tt.braceL`, is assumed not to have side
//    effects.)
// Anything else keeps acorn's own behaviour.

import { fastParse } from "./parser.mjs";
import { getOptions } from "./shared.mjs";

const fnToString = Function.prototype.toString;
const hasOwn = Object.hasOwn;

// parser properties the method may read, methods it may call
const READABLE = new Set(["type", "value", "start", "end", "pos", "startLoc", "endLoc", "lastTokStart", "lastTokEnd", "lastTokStartLoc", "lastTokEndLoc"]);
const CALLABLE = new Set(["next", "startNode", "startNodeAt", "finishNode", "finishNodeAt", "exitScope", "eat", "expect", "unexpected", "raise", "raiseRecoverable"]);
const NODE_MAKERS = new Set(["startNode", "startNodeAt", "finishNode", "finishNodeAt"]);

function parseSrc(src) {
  // (the class wrapper keeps the method in strict mode)
  return fastParse(src, getOptions({ ecmaVersion: "latest", sourceType: "script" }));
}

// ---- whitelist analysis of the method
function analyseMethod(fn) {
  // params: plain identifiers; body: statements checked below
  const params = fn.params.map((p) => (p.type === "Identifier" ? p.name : null));
  if (params.includes(null) || new Set(params).size !== params.length) return false;
  if (fn.async || fn.generator) return false;
  // locals: name -> { kind, decl, assigns[] }
  const locals = new Map();
  const assigned = new Set(); // names written after declaration
  let ok = true;
  const fail = () => {
    ok = false;
  };
  // pass 1: declarations (unique names, no shadowing of params)
  (function collect(n) {
    if (!ok || !n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(collect);
    if (n.type === "VariableDeclaration") {
      for (const d of n.declarations) {
        if (d.id.type !== "Identifier" || locals.has(d.id.name) || params.includes(d.id.name)) return fail();
        locals.set(d.id.name, { kind: "var", init: d.init, decl: n.kind });
      }
    }
    if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression" || n.type === "FunctionDeclaration" || n.type === "ClassExpression" || n.type === "ClassDeclaration")
      return fail();
    for (const k in n) if (k !== "loc" && k !== "type") collect(n[k]);
  })(fn.body.body);
  if (!ok) return false;
  // kinds: PARSER (this or an alias), NODE (param 0, or a node from the
  // parser), NUM (numbers only), OTHER
  const kindOf = new Map();
  for (const name of params) kindOf.set(name, "OTHER");
  kindOf.set(params[0], "NODE");
  // pass 2: find all assignments to locals / params
  const writes = new Map(); // name -> [rhs expr | "update"]
  (function scan(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(scan);
    if (n.type === "AssignmentExpression" && n.left.type === "Identifier") {
      const w = writes.get(n.left.name) || [];
      w.push(n);
      writes.set(n.left.name, w);
    } else if (n.type === "UpdateExpression" && n.argument.type === "Identifier") {
      const w = writes.get(n.argument.name) || [];
      w.push(n);
      writes.set(n.argument.name, w);
    }
    for (const k in n) if (k !== "loc" && k !== "type") scan(n[k]);
  })(fn.body.body);
  for (const p of params) if (writes.has(p)) return false; // parameters are never reassigned
  const isNumLit = (e) => e && e.type === "Literal" && typeof e.value === "number";
  // fixpoint over local kinds
  for (const [name] of locals) kindOf.set(name, "OTHER");
  for (let iter = 0; iter < 5; iter++) {
    for (const [name, info] of locals) {
      const w = writes.get(name) || [];
      const init = info.init;
      if (w.length === 0 && init) {
        if (init.type === "ThisExpression" || (init.type === "Identifier" && kindOf.get(init.name) === "PARSER")) {
          kindOf.set(name, "PARSER");
          continue;
        }
        if (
          (init.type === "CallExpression" && init.callee.type === "MemberExpression" && !init.callee.computed && exprKind(init.callee.object) === "PARSER" && NODE_MAKERS.has(init.callee.property.name)) ||
          (init.type === "Identifier" && kindOf.get(init.name) === "NODE")
        ) {
          kindOf.set(name, "NODE");
          continue;
        }
      }
      // numeric: numeric init (or none) and only numeric updates
      let num = init ? isNumLit(init) : false;
      if (num)
        for (const x of w) {
          if (x.type === "UpdateExpression") continue;
          if ((x.operator === "=" || x.operator === "+=" || x.operator === "-=") && isNumLit(x.right)) continue;
          num = false;
        }
      if (num) kindOf.set(name, "NUM");
    }
  }
  function exprKind(e) {
    if (e.type === "ThisExpression") return "PARSER";
    if (e.type === "Identifier") return kindOf.get(e.name) || "FREE";
    if (isNumLit(e)) return "NUM";
    return "OTHER";
  }
  const isNum = (e) => isNumLit(e) || (e.type === "Identifier" && kindOf.get(e.name) === "NUM") || (e.type === "UnaryExpression" && e.operator === "-" && isNumLit(e.argument));

  function stmt(s) {
    if (!ok) return;
    switch (s.type) {
      case "BlockStatement":
        return s.body.forEach(stmt);
      case "EmptyStatement":
        return;
      case "ExpressionStatement":
        return expr(s.expression);
      case "VariableDeclaration":
        for (const d of s.declarations) {
          if (!d.init) continue;
          // (aliasing the parser into a local is the one other place it may go)
          if (kindOf.get(d.id.name) === "PARSER" && (d.init.type === "ThisExpression" || (d.init.type === "Identifier" && kindOf.get(d.init.name) === "PARSER"))) continue;
          expr(d.init);
        }
        return;
      case "IfStatement":
        expr(s.test);
        stmt(s.consequent);
        if (s.alternate) stmt(s.alternate);
        return;
      case "ReturnStatement":
        if (s.argument) expr(s.argument);
        return;
      case "DoWhileStatement":
      case "WhileStatement":
        expr(s.test);
        return stmt(s.body);
      case "ForStatement":
        if (s.init) s.init.type === "VariableDeclaration" ? stmt(s.init) : expr(s.init);
        if (s.test) expr(s.test);
        if (s.update) expr(s.update);
        return stmt(s.body);
      case "BreakStatement":
      case "ContinueStatement":
        if (s.label) fail();
        return;
      default:
        fail();
    }
  }
  function expr(e) {
    if (!ok) return;
    switch (e.type) {
      case "Literal":
        if (e.regex || typeof e.value === "bigint" || e.bigint) fail();
        return;
      case "Identifier":
        // (the parser -- the facade -- must not escape: it is only used as
        // the object of member accesses, handled below)
        if (e.name === "arguments" || e.name === "eval" || kindOf.get(e.name) === "PARSER") fail();
        return;
      case "ThisExpression":
        return fail();
      case "MemberExpression": {
        if (e.computed || e.optional || e.object.type === "Super") return fail();
        const k = exprKind(e.object);
        if (k === "PARSER") {
          if (!READABLE.has(e.property.name)) fail();
          return;
        }
        if (k === "NUM") return fail();
        return expr(e.object);
      }
      case "CallExpression": {
        if (e.optional || e.callee.type !== "MemberExpression" || e.callee.computed || e.callee.optional) return fail();
        for (const a of e.arguments) {
          if (a.type === "SpreadElement") return fail();
          expr(a);
        }
        const obj = e.callee.object, name = e.callee.property.name;
        if (obj.type === "Super") {
          // super.parseFunctionBody(p0, p1, p2, p3), the method's own parameters
          if (name !== "parseFunctionBody" || e.arguments.length !== 4 || params.length < 4) return fail();
          for (let i = 0; i < 4; i++) if (e.arguments[i].type !== "Identifier" || e.arguments[i].name !== params[i]) return fail();
          return;
        }
        if (exprKind(obj) !== "PARSER" || !CALLABLE.has(name)) fail();
        return;
      }
      case "AssignmentExpression": {
        const l = e.left;
        if (l.type === "Identifier") {
          if (!locals.has(l.name)) return fail(); // (params: rejected above; globals/closure vars: never)
          if (e.operator === "=") return expr(e.right);
          if ((e.operator === "+=" || e.operator === "-=") && kindOf.get(l.name) === "NUM" && isNum(e.right)) return;
          return fail();
        }
        if (l.type === "MemberExpression" && !l.computed && !l.optional && e.operator === "=") {
          // properties of AST nodes only (never __proto__)
          if (exprKind(l.object) !== "NODE" || l.property.name === "__proto__") return fail();
          return expr(e.right);
        }
        return fail();
      }
      case "UpdateExpression":
        if (e.argument.type !== "Identifier" || kindOf.get(e.argument.name) !== "NUM" || !locals.has(e.argument.name)) fail();
        return;
      case "UnaryExpression":
        if (e.operator === "!" || e.operator === "void" || e.operator === "typeof") return expr(e.argument);
        if ((e.operator === "-" || e.operator === "+") && isNum(e.argument)) return;
        return fail();
      case "BinaryExpression":
        if (e.operator === "===" || e.operator === "!==") {
          expr(e.left);
          return expr(e.right);
        }
        if ((e.operator === "==" || e.operator === "!=") && (isNullLit(e.left) || isNullLit(e.right))) {
          expr(e.left);
          return expr(e.right);
        }
        if (["<", ">", "<=", ">=", "+", "-", "*"].includes(e.operator) && isNum(e.left) && isNum(e.right)) return;
        return fail();
      case "LogicalExpression":
        expr(e.left);
        return expr(e.right);
      case "ConditionalExpression":
        expr(e.test);
        expr(e.consequent);
        return expr(e.alternate);
      case "SequenceExpression":
        return e.expressions.forEach(expr);
      case "ArrayExpression":
        for (const el of e.elements) {
          if (el === null) continue;
          if (el.type === "SpreadElement") return fail();
          expr(el);
        }
        return;
      default:
        fail();
    }
  }
  const isNullLit = (e) => e.type === "Literal" && e.value === null && !e.regex;
  fn.body.body.forEach(stmt);
  return ok;
}

// ---- class recognition
const analysed = new WeakMap(); // class -> { fn } | null

function recognise(C, Parser) {
  if (typeof C !== "function" || Object.getPrototypeOf(C) !== Parser) return null;
  const proto = C.prototype;
  if (!proto || Object.getPrototypeOf(proto) !== Parser.prototype || proto.constructor !== C) return null;
  const names = Object.getOwnPropertyNames(C);
  if (Object.getOwnPropertySymbols(C).length || names.length !== 3 || !names.includes("length") || !names.includes("name") || !names.includes("prototype")) return null;
  const pnames = Object.getOwnPropertyNames(proto);
  if (Object.getOwnPropertySymbols(proto).length || pnames.length !== 2 || !pnames.includes("constructor") || !pnames.includes("parseFunctionBody")) return null;
  const d = Object.getOwnPropertyDescriptor(proto, "parseFunctionBody");
  if (!d || typeof d.value !== "function") return null;
  const fn = d.value;
  let classSrc, fnSrc;
  try {
    classSrc = fnToString.call(C);
    fnSrc = fnToString.call(fn);
  } catch {
    return null;
  }
  if (!/^class\b/.test(classSrc)) return null;
  let classAst;
  try {
    classAst = parseSrc("(" + classSrc + ")").body[0].expression;
  } catch {
    return null;
  }
  if (classAst.type !== "ClassExpression" || !classAst.superClass || classAst.body.body.length !== 1) return null;
  const m = classAst.body.body[0];
  if (m.type !== "MethodDefinition" || m.kind !== "method" || m.static || m.computed || m.key.type !== "Identifier" || m.key.name !== "parseFunctionBody") return null;
  // the prototype's function is this very method
  if (classSrc.slice(m.start - 1, m.end - 1) !== fnSrc) return null;
  if (!analyseMethod(m.value)) return null;
  return { fn };
}

/** a subclass's parseFunctionBody, run by the fast parser on its facade */
;                                                                                                                           

// the method to run on the facade, or null
export function bodyOverrideOf(C          , Parser     )                      {
  let rec = analysed.get(C);
  if (rec === undefined) {
    try {
      rec = recognise(C, Parser);
    } catch {
      rec = null;
    }
    analysed.set(C, rec);
  }
  if (rec === null) return null;
  // (re-checked on every parse: the class could have been modified since)
  const proto = C.prototype;
  if (proto.parseFunctionBody !== rec.fn || Object.getOwnPropertyNames(proto).length !== 2 || Object.getOwnPropertyNames(C).length !== 3) return null;
  return rec.fn;
}
// generated from override.mts by tools/ts-build.mjs; edit that file
