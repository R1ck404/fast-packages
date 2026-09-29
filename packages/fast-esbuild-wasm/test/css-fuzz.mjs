// CSS fuzzer: random stylesheets (a grammar covering selectors, nesting,
// at-rules, colors, calc(), gradients, shorthands, fonts, transforms, CSS
// modules, escapes, comments, ...) and mutations of real stylesheets,
// transformed with the fast path and with native esbuild 0.28.2 under random
// option sets. Categories as in test/diff.mjs, plus bailMessage: the fast
// path bailed because esbuild warns or fails (then native esbuild is not run).
//
// usage: node test/css-fuzz.mjs [--n N] [--seed S] [--show N] [--stop] [--mutate-only] [--gen-only]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { flagsFor, makeRefTransform, makeWasmTransform, ESBUILD_CRASHED, messagesJSON, classifyTransform } from "./flags.mjs";
import { CSS_OPTION_SETS } from "./css-inputs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const refTransform = makeRefTransform(require);
const wasmTransform = makeWasmTransform(require);
// Check memoized values against fresh computations (see CONVENTIONS.md)
globalThis.__FAST_ESBUILD_VERIFY_RUNTIME_CACHE__ = true;
const { fastTransform, stats } = await (await import("./engine.mjs")).loadEngine();

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const N = Number(getArg("--n", 3000));
let seed = Number(getArg("--seed", Date.now() % 1e9));
const showN = Number(getArg("--show", 5));
const stopOnFail = args.includes("--stop");
const mutateOnly = args.includes("--mutate-only");
const genOnly = args.includes("--gen-only");
const tally = args.includes("--tally"); // count esbuild warnings and errors by text
const tallies = {};
const why = getArg("--why", null); // print inputs whose esbuild warning contains this text
let whyShown = 0;
console.log(`seed ${seed}`);

// mulberry32
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (n) => Math.floor(rand() * n);
const pick = (a) => a[ri(a.length)];
const chance = (p) => rand() < p;
const rep = (min, max, f, sep = "") => {
  const n = min + ri(max - min + 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(f(i));
  return out.join(sep);
};

const BS = String.fromCharCode(92);
const WS = () => pick(["", " ", " ", "  ", "\n", "\t", " /* c */ ", "\n  "]);
const ws = () => (chance(0.8) ? " " : WS());

// Identifiers, including escapes and non-ASCII
const IDENTS = ["a", "b", "foo", "bar", "Foo", "x-y", "_z", "--custom", "-webkit-x", "élève", "中", "item-1", "a" + BS + "31 b", BS + "30 x", "c" + BS + ":d", "e" + BS + "é", "red", "inherit", "initial", "none", "auto", "from", "to", "global", "local"];
const ident = () => pick(IDENTS);

const TAGS = ["div", "span", "a", "p", "html", "body", "button", "input", "li", "ul", "svg", "DIV", "*", "ns|a", "*|b", "|c"];
const PSEUDO = ["hover", "focus", "active", "visited", "first-child", "last-child", "empty", "root", "checked", "disabled", "before", "after", "first-line", "first-letter", "focus-within", "focus-visible", "placeholder-shown", "HOVER"];
const PSEUDO_EL = ["before", "after", "placeholder", "selection", "marker", "-webkit-scrollbar", "backdrop", "part(x)", "slotted(span)"];
function nth() {
  return pick(["odd", "even", "2n+1", "2n + 1", "-n+3", "n", "0n+1", "3", "-2n-1", "+5", "1n+0", "0n", "2n+1 of .x", "even of a, b"]);
}
function compound(depth) {
  let s = "";
  if (chance(0.5)) s += pick(TAGS);
  if (chance(0.2)) s += "&";
  const n = ri(3) + (s === "" ? 1 : 0);
  for (let i = 0; i < n; i++) {
    switch (ri(9)) {
      case 0:
      case 1:
        s += "." + ident();
        break;
      case 2:
        s += "#" + ident();
        break;
      case 3:
        s += "[" + pick(["href", "data-x", "ns|attr", "*|a", "class"]) + (chance(0.7) ? pick(["=", "~=", "|=", "^=", "$=", "*="]) + pick(['"v"', "v", "'a b'", '"' + BS + '"q"', '"1"', "x" + BS + "20y"]) + (chance(0.3) ? pick([" i", " s", " I"]) : "") : "") + "]";
        break;
      case 4:
        s += ":" + pick(PSEUDO);
        break;
      case 5:
        s += "::" + pick(PSEUDO_EL);
        break;
      case 6:
        if (depth < 2) s += ":" + pick(["is", "where", "not", "has", "IS", "matches", "-webkit-any"]) + "(" + selectorList(depth + 1) + ")";
        else s += ".d";
        break;
      case 7:
        s += ":" + pick(["nth-child", "nth-last-child", "nth-of-type", "nth-last-of-type"]) + "(" + nth() + ")";
        break;
      case 8:
        if (depth < 2) s += ":" + pick(["global", "local"]) + (chance(0.5) ? "(" + complex(depth + 1) + ")" : "");
        else s += ":hover";
        break;
    }
  }
  return s;
}
function complex(depth) {
  let s = chance(0.1) ? pick([">", "+", "~"]) + ws() : "";
  s += compound(depth);
  const n = ri(3);
  for (let i = 0; i < n; i++) s += pick([" ", " > ", ">", " + ", "~", " ~ ", "  "]) + compound(depth);
  return s;
}
function selectorList(depth = 0) {
  return rep(1, 3, () => complex(depth), pick([",", ", ", " ,\n"]));
}

// Values
const NUMS = ["0", "1", "-1", "0.5", ".5", "+.25", "10", "100", "1e3", "1.5E-2", "0.0", "-0", "00.10", "12345.678", "1e-7", "3.14159265", "255", "256", "-.0", "007"];
const UNITS = ["px", "em", "rem", "%", "vh", "vw", "deg", "rad", "turn", "grad", "s", "ms", "PX", "Em", "fr", "ch", "ex", "in", "cm", "mm", "pt", "pc", "q", "dpi", ""];
const num = () => pick(NUMS);
const dim = () => num() + pick(UNITS);
const hexDigits = "0123456789abcdefABCDEF";
const hex = () => "#" + rep(pick([3, 4, 6, 8]), 0, () => "", "").replace(/^/, "") + rep(1, 1, () => {
  const n = pick([3, 4, 6, 8, 5, 2]);
  let h = "";
  for (let i = 0; i < n; i++) h += hexDigits[ri(hexDigits.length)];
  return h;
});
function color() {
  switch (ri(16)) {
    case 0:
      return hex();
    case 1:
      return pick(["red", "RED", "transparent", "currentColor", "rebeccapurple", "white", "black", "aliceblue", "lightgoldenrodyellow", "hotpink", "navy", "fuchsia", "magenta", "cyan", "aqua", "gray", "grey", "darkslategrey"]);
    case 2:
      return `rgb(${pick(["255, 0, 0", "255 0 0", "100% 0% 50%", "1,2,3", "255 0 0 / 50%", "255 0 0 / .5", "0 0 0 / 0", "300, -1, 128", "1e2 2e1 3", "10.5, 20.25, 30"])})`;
    case 3:
      return `rgba(${pick(["255, 0, 0, 0.5", "255, 0, 0, 50%", "0,0,0,1", "0 0 0 / 1", "1, 2, 3, 0.999", "1, 2, 3, 0.004", "1,2,3,.1234"])})`;
    case 4:
      return `hsl(${pick(["120, 100%, 50%", "120deg 100% 50%", "0.5turn 50% 50% / 0.5", "-30 10% 20%", "400grad, 1%, 2%", "3.14rad 50% 50%", "120 100 50"])})`;
    case 5:
      return `hsla(${pick(["120, 100%, 50%, .3", "1, 2%, 3%, 50%"])})`;
    case 6:
      return `hwb(${pick(["120 10% 20%", "0 0% 0%", "90deg 50% 50% / 0.5", "240 100% 100%", "0 60% 60%"])})`;
    case 7:
      return `lab(${pick(["50% 40 59.5", "29.2345% 39.3825 20.0664", "0 0 0", "100 -125 125 / 0.5", "52.2345% 40.1645 59.9971 / .5"])})`;
    case 8:
      return `lch(${pick(["52.2345% 72.2 56.2", "29.69% 44.888% 327.1", "50 100 400", "90 0 0"])})`;
    case 9:
      return `oklab(${pick(["40.101% 0.1147 0.0453", "59.686% 0.1009 0.1192 / 0.5", "0.5 0 0", "1 -0.4 0.4"])})`;
    case 10:
      return `oklch(${pick(["40.101% 0.12332 21.555", "0.6 0.15 180", "0.9 0.37 30 / 50%", "0.7 0 none"])})`;
    case 11:
      return `color(${pick(["srgb 1 0 0", "display-p3 1 0 0", "rec2020 0.5 0.5 0.5", "a98-rgb 0 1 0", "prophoto-rgb 0 0 1", "xyz 0.2 0.3 0.4", "xyz-d50 0.5 0.5 0.5", "srgb-linear 0.5 0 1 / 0.5", "display-p3 1.2 -0.1 0"])})`;
    case 12:
      return `var(--c${ri(3)}${chance(0.5) ? ", " + color() : ""})`;
    case 13:
      return pick(["#FFF", "#ffffff", "#FFFFFFFF", "#00000000", "#FF0000", "#f00f", "#abcdef80", "#aabbcc"]);
    case 14:
      return `color-mix(in srgb, red ${num()}%, blue)`;
    default:
      return `rgb(${ri(300)}, ${ri(300)}, ${ri(300)}${chance(0.5) ? ", " + (ri(101) / 100) : ""})`;
  }
}
function calc(depth = 0) {
  const term = () => (depth < 2 && chance(0.3) ? "(" + calc(depth + 1) + ")" : chance(0.2) ? `var(--x)` : chance(0.5) ? dim() : num());
  let s = term();
  const n = ri(4);
  for (let i = 0; i < n; i++) s += (chance(0.95) ? pick([" + ", " - ", " * ", " / ", "*", "/"]) : pick([" +", "- "])) + term();
  return s;
}
function gradient() {
  const kind = pick(["linear-gradient", "radial-gradient", "conic-gradient", "repeating-linear-gradient", "-webkit-linear-gradient"]);
  const pre = pick(["", "to right, ", "45deg, ", "in oklab, ", "in hsl longer hue, ", "circle at center, ", "from 90deg, ", "to top left in srgb, ", "0.25turn, "]);
  const stops = rep(2, 5, () => color() + (chance(0.5) ? " " + pick(["0%", "50%", "100%", "10px", "25% 75%", "calc(10% + 5px)"]) : "") + (chance(0.15) ? ", " + pick(["30%", "40px"]) : ""), ", ");
  return `${kind}(${pre}${stops})`;
}
function value(prop) {
  switch (prop) {
    case "color":
    case "background-color":
    case "border-color":
    case "outline-color":
    case "caret-color":
    case "fill":
    case "stroke":
    case "text-decoration-color":
      return color();
    case "margin":
    case "padding":
    case "inset":
    case "border-width":
    case "scroll-margin":
      return rep(1, 5, () => (chance(0.8) ? dim() : pick(["auto", "calc(" + calc() + ")", "0", "inherit"])), " ");
    case "margin-top":
    case "margin-left":
    case "padding-right":
    case "padding-bottom":
    case "top":
    case "left":
    case "right":
    case "bottom":
    case "width":
    case "height":
    case "max-width":
    case "min-height":
      return chance(0.7) ? dim() : pick(["auto", "calc(" + calc() + ")", "min(10px, 5vw)", "clamp(1rem, 2vw, 3rem)", "fit-content", "-webkit-fill-available"]);
    case "border-radius":
      return rep(1, 4, dim, " ") + (chance(0.3) ? " / " + rep(1, 4, dim, " ") : "");
    case "border-top-left-radius":
    case "border-bottom-right-radius":
      return rep(1, 2, dim, " ");
    case "border":
    case "border-top":
    case "outline":
      return [dim(), pick(["solid", "dashed", "none"]), color()].filter(() => chance(0.8)).join(" ");
    case "box-shadow":
    case "text-shadow":
      return rep(1, 3, () => [chance(0.2) ? "inset" : "", dim(), dim(), chance(0.5) ? dim() : "", chance(0.5) ? dim() : "", chance(0.8) ? color() : ""].filter(Boolean).join(" "), ", ");
    case "font":
      return [chance(0.3) ? pick(["italic", "normal", "oblique"]) : "", chance(0.3) ? pick(["bold", "400", "700", "normal", "bolder"]) : "", pick(["12px", "1.2em", "small", "x-large", "100%"]) + (chance(0.4) ? "/" + pick(["1.5", "normal", "20px"]) : ""), fontFamily()].filter(Boolean).join(" ");
    case "font-family":
      return fontFamily();
    case "font-weight":
      return pick(["normal", "bold", "400", "700", "bolder", "lighter", "100", "900", "550"]);
    case "transform":
      return rep(1, 3, () => pick([`translate(${dim()}, ${dim()})`, `translateX(${dim()})`, `translate3d(${dim()}, ${dim()}, ${dim()})`, `scale(${num()})`, `scale(${num()}, ${num()})`, `scaleX(${num()})`, `scale3d(${num()}, ${num()}, 1)`, `rotate(${dim()})`, `rotateZ(${num()}deg)`, `rotate3d(0, 0, 1, 45deg)`, `skew(${num()}deg, 0)`, `skewX(0)`, `matrix(1, 0, 0, 1, 0, 0)`, `matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)`, `perspective(${dim()})`, `translateZ(0)`]), " ");
    case "animation":
      return rep(1, 2, () => [pick(["1s", "200ms", ".5s"]), pick(["ease", "linear", "ease-in-out", "cubic-bezier(0.1, 0.7, 1.0, 0.1)", "steps(4, end)"]), chance(0.5) ? pick(["infinite", "2"]) : "", ident()].filter(Boolean).join(" "), ", ");
    case "animation-name":
      return rep(1, 2, ident, ", ");
    case "list-style":
      return [pick(["disc", "square", "none", "decimal", "foo", "lower-roman"]), chance(0.5) ? pick(["inside", "outside"]) : "", chance(0.3) ? "url(a.png)" : ""].filter(Boolean).join(" ");
    case "container":
      return ident() + (chance(0.5) ? " / " + pick(["inline-size", "size", "normal"]) : "");
    case "container-name":
      return rep(1, 2, ident, " ");
    case "background":
    case "background-image":
      return rep(1, 2, () => (chance(0.5) ? gradient() : pick(["url(img.png)", "url('a b.png')", 'url("x.svg#frag")', "none", color()])), ", ");
    case "grid-template-areas":
      return pick(['"a b" "c d"', "'x'", "none"]);
    case "content":
      return pick(['""', '"a"', "'\\''", '"é"', '"' + BS + '201C"', "counter(item)", "attr(data-x)", "none", "\"</style>\"", "\"</STYLE \"", '"' + BS + 'a"']);
    case "composes":
      return rep(1, 2, ident, " ") + (chance(0.3) ? pick([" from global", ' from "./a.css"']) : "");
    case "z-index":
    case "opacity":
    case "flex-grow":
    case "order":
      return num();
    case "transition":
      return pick(["all .3s", "opacity 200ms ease-in, transform 0.3s", "none", "color 1s cubic-bezier(.17,.67,.83,.67) 0s"]);
    case "unicode-range":
      return pick(["U+0025-00FF", "u+4??", "U+0000-00FF, U+0131"]);
    default:
      if (prop.startsWith("--")) return pick(["", " ", "{ a: b }", "10px", "red", "[x]", "  spaced  value  ", "calc(1px+2px)", "!", "1 2 3"]);
      return rep(1, 3, () => pick([ident(), dim(), color(), '"str"', "calc(" + calc() + ")", "var(--x)", "url(x.png)", "attr(x)", "env(safe-area-inset-top)"]), pick([" ", ", ", " / "]));
  }
}
function fontFamily() {
  return rep(1, 3, () => pick(["Arial", "'Helvetica Neue'", '"Times New Roman"', "serif", "sans-serif", "system-ui", "monospace", "'serif'", "Segoe UI", "a b c", '"Font 2"', "inherit", "-apple-system", "宋体", '"x' + BS + '"y"']), ", ");
}
const PROPS = ["color", "background-color", "border-color", "margin", "padding", "inset", "margin-top", "padding-right", "top", "left", "width", "height", "max-width", "border-radius", "border-top-left-radius", "border", "border-top", "outline", "box-shadow", "text-shadow", "font", "font-family", "font-weight", "transform", "animation", "animation-name", "list-style", "container", "container-name", "background", "background-image", "grid-template-areas", "content", "z-index", "opacity", "transition", "display", "position", "--custom-prop", "--x", "-webkit-appearance", "appearance", "user-select", "backdrop-filter", "mask-image", "clip-path", "text-decoration", "hyphens", "tab-size", "text-size-adjust", "print-color-adjust", "fill", "stroke", "caret-color", "unicode-range", "COLOR", "Margin", "font-size", "line-height", "flex", "grid-template-columns", "cursor", "border-width", "scroll-margin", "min-height", "right", "bottom", "text-decoration-color", "outline-color", "flex-grow", "order", "border-bottom-right-radius", "composes"];
function declaration() {
  const prop = chance(0.01) ? pick(["colr", "widht"]) : pick(PROPS);
  let v = value(prop);
  if (chance(0.08)) v += pick([" !important", "!important", " ! important", " !IMPORTANT"]);
  return prop + pick([":", ": ", " : ", ":\n  "]) + v;
}
function block(depth) {
  const items = rep(0, 5, () => {
    if (depth < 3 && chance(0.25)) return rule(depth + 1);
    if (chance(0.05)) return pick(["/*! legal */", "/*! </style> */", "/* comment */", "/* @preserve p */"]);
    return declaration() + (chance(0.97) ? ";" : "");
  }, pick(["\n", " ", "", "\n  "]));
  return "{" + WS() + items + WS() + "}";
}
function mediaQuery() {
  return rep(1, 2, () => pick(["screen", "print", "all", "not screen", "only screen and (color)", "(min-width: 100px)", "(max-width:600px)", "(width >= 100px)", "(100px <= width < 600px)", "(400px > height)", "(orientation: landscape)", "screen and (min-width: 1px) and (max-width: 2px)", "(prefers-color-scheme: dark)", "not (hover)", "(min-resolution: 2dppx)", "(a) or (b)", "((a) and (b)) or (c)", "(width = 100px)", "(-webkit-min-device-pixel-ratio: 2)"]), ", ");
}
function atRule(depth) {
  switch (ri(16)) {
    case 0:
      return `@media ${mediaQuery()} ${block(depth + 1)}`;
    case 1:
      return `@supports ${pick(["(display: grid)", "not (display: grid)", "(a: b) and (c: d)", "selector(:is(a))", "(--x: y)"])} ${block(depth + 1)}`;
    case 2:
      return `@container ${pick(["sidebar (orientation: portrait) ", "(min-width: 400px) ", "card (width > 30em) "])}${block(depth + 1)}`;
    case 3:
      return `@layer ${pick(["a", "a.b", "base, components", ""])}${chance(0.5) ? ";" : " " + block(depth + 1)}`;
    case 4:
      return `@font-face { font-family: ${fontFamily().split(",")[0]}; src: url(font.woff2) format("woff2"), local('X'); font-weight: ${pick(["100 900", "bold", "400"])}; unicode-range: U+0000-00FF; }`;
    case 5:
      return `@keyframes ${ident()} { ${rep(1, 3, () => pick(["from", "to", "0%", "50%", "100%", "FROM", "0%, 100%", "25.5%"]) + " { " + declaration() + " }", " ")} }`;
    case 6:
      return `@-webkit-keyframes ${ident()} { from { opacity: 0 } to { opacity: 1 } }`;
    case 7:
      return `@page ${pick(["", ":first ", ":left "])}{ margin: ${dim()}; }`;
    case 8:
      return `@scope ${pick(["(.a)", "(.a) to (.b)", ""])} ${block(depth + 1)}`;
    case 9:
      return `@starting-style ${block(depth + 1)}`;
    case 10:
      return `@unknown-rule ${pick(["foo", "a b c", ""])}${chance(0.5) ? ";" : " { x: y }"}`;
    case 11:
      return `@document url(http://x) ${block(depth + 1)}`;
    case 12:
      return `@-moz-document url-prefix() ${block(depth + 1)}`;
    case 13:
      return `@counter-style x { system: cyclic; symbols: "*"; }`;
    case 14:
      return `@property --p { syntax: "<length>"; inherits: false; initial-value: 0px; }`;
    default:
      return `@media ${mediaQuery()} { @supports (display: flex) ${block(depth + 2)} }`;
  }
}
function rule(depth = 0) {
  if (chance(0.25)) return atRule(depth);
  return selectorList() + ws() + block(depth);
}
function stylesheet() {
  let s = "";
  if (chance(0.05)) s += '@charset "UTF-8";\n';
  if (chance(0.15)) s += rep(1, 3, () => `@import ${pick(['"a.css"', "url(b.css)", "'c.css' screen", '"d.css" layer(x)', '"e.css" layer', 'url("f.css") supports(display: grid) print', '"a.css" layer(y) (min-width: 100px)'])};`, "\n") + "\n";
  if (chance(0.01)) s += "@namespace svg url(http://www.w3.org/2000/svg);\n";
  if (chance(0.1)) s += "/*! License: MIT */\n";
  s += rep(1, 8, () => rule(0), pick(["\n", "\n\n", "", " "]));
  return s;
}

// Mutations of real stylesheets
function loadCorpus() {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 12) walk(p, depth + 1);
      else if (e.name.endsWith(".css")) {
        try {
          if (statSync(p).size < 200000) out.push(readFileSync(p, "utf8"));
        } catch {}
      }
    }
  };
  walk(join(here, "../../../node_modules"), 0);
  return out;
}
const corpus = genOnly ? [] : loadCorpus();
const CRLF = String.fromCharCode(13, 10);
const ODD = [0xa0, 0xfeff, 0x2028, 0x2029, 0, 0x7f, 0x85, 0x1f600, 0x10ffff, 0xe9, 0x4e2d, 13, 12, 11]
  .map((c) => String.fromCodePoint(c))
  .concat([CRLF, BS, BS + "0", BS + "d800", BS + "110000", BS + "fffd ", BS + CRLF, "/*", "*/", "<!--", "-->", "@", "#", "url(", "u+"]);
function mutate(text) {
  let s = text;
  const n = 1 + ri(4);
  for (let i = 0; i < n; i++) {
    const at = ri(s.length + 1);
    switch (ri(7)) {
      case 0: // delete a span
        s = s.slice(0, at) + s.slice(at + ri(20));
        break;
      case 1: // insert a generated snippet
        s = s.slice(0, at) + pick([declaration() + ";", rule(1), "}", "{", ";", ":", "&", "/*", "*/", '"', "(", ")", ",", "@media", "!important", BS, " "]) + s.slice(at);
        break;
      case 2: {
        // duplicate a span
        const len = ri(80);
        s = s.slice(0, at) + s.slice(at, at + len) + s.slice(at);
        break;
      }
      case 3: {
        // take a window
        const len = 200 + ri(2000);
        s = s.slice(at, at + len);
        break;
      }
      case 4: // wrap in nesting
        s = ".wrap { " + s + " }";
        break;
      case 5: // odd characters and escapes
        s = s.slice(0, at) + pick(ODD) + s.slice(at);
        break;
      default: // swap case
        s = s.slice(0, at) + s.slice(at, at + 10).toUpperCase() + s.slice(at + 10);
    }
  }
  return s;
}

// An estimate of the number of selectors that lowering the nesting of a
// stylesheet generates without ":is()": a nested rule gets one selector per
// combination of its parent's selectors for each "&" (an implicit "&" when
// it has none). esbuild generates all of them before it checks its limit
// ("CSS nesting is causing too much expansion", beyond 0xff00 selectors), so
// far beyond it both esbuild and this package take minutes and gigabytes
// before reporting that error. Inputs estimated beyond it (the estimate is
// generous) are skipped (counted as slowNesting, like the inputs that report
// the error), which keeps the suite deterministic.
const NESTING_ESTIMATE_LIMIT = 0xff00;
// (only option sets that lower nesting without ":is()" expand it: asked
// once per option set, with a stylesheet that shows which)
const expands = new Map();
function expandsNesting(optName, opts) {
  if (!expands.has(optName)) {
    const r = fastTransform(flagsFor({ ...opts, minify: false, sourcemap: false, mangleCache: undefined }), ".a, .b { .c & .d { color: red } }", undefined);
    const code = r === undefined ? "" : r.code;
    expands.set(optName, r !== undefined && !code.includes(":is(") && !code.includes(":-webkit-any(") && !/\{[^}]*\{/.test(code));
  }
  return expands.get(optName);
}
function nestingExplodes(code) {
  const stack = []; // selectors of the enclosing rules (at-rules: their parent's)
  let prelude = "";
  let depth = 0; // parentheses
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end < 0 ? code.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== String.fromCharCode(10)) j += code[j] === BS ? 2 : 1;
      prelude += code.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (c === "{") {
      const text = prelude.trim();
      const parent = stack.length > 0 ? stack[stack.length - 1] : null;
      // (count: selectors; size: characters per selector, as each "&"
      // copies a parent selector into it)
      let frame;
      if (text.startsWith("@")) frame = parent;
      else {
        // (top-level commas split the list)
        const list = [];
        let d = 0, start = 0;
        for (let j = 0; j < text.length; j++) {
          if (text[j] === "(") d++;
          else if (text[j] === ")") d = Math.max(0, d - 1);
          else if (text[j] === "," && d === 0) { list.push(text.slice(start, j)); start = j + 1; }
        }
        list.push(text.slice(start));
        const own = text.length / list.length;
        if (parent === null) frame = { count: list.length, size: own };
        else {
          const amps = Math.max(1, ...list.map((x) => x.split("&").length - 1));
          frame = { count: Math.min(list.length * Math.pow(parent.count, amps), 1e12), size: Math.min(own + amps * parent.size, 1e12) };
        }
      }
      if (frame !== null && (frame.count > NESTING_ESTIMATE_LIMIT || frame.count * frame.size > NESTING_ESTIMATE_LIMIT * 64)) return true;
      stack.push(frame);
      prelude = "";
      depth = 0;
    } else if (c === "}") {
      stack.pop();
      prelude = "";
    } else if (c === ";" && depth === 0) {
      prelude = "";
    } else prelude += c;
  }
  return false;
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - 60), i + 60));
  return `  first difference at char ${i}\n    esbuild: ${ctx(a)}\n    fast:    ${ctx(b)}`;
}

const counts = { ok: 0, okWasm: 0, okError: 0, slowNesting: 0, bail: 0, bothFail: 0, "FALSE-ACCEPT": 0, "FALSE-ERROR": 0, "MSG-MISMATCH": 0, MISMATCH: 0, CRASH: 0, esbuildCrash: 0 };
const shown = {};
const bailSites = {};
for (let iter = 0; iter < N; iter++) {
  const code = corpus.length > 0 && (mutateOnly || chance(0.3)) ? mutate(pick(corpus)) : stylesheet();
  const [optName, opts] = pick(CSS_OPTION_SETS);
  if (process.env.CSS_FUZZ_TRACE) process.stderr.write(`#${iter} ${optName} ${code.length}\n`);
  if (process.env.CSS_FUZZ_DUMP) writeFileSync(process.env.CSS_FUZZ_DUMP, JSON.stringify({ optName, code }));
  if (expandsNesting(optName, opts) && nestingExplodes(code)) {
    counts.slowNesting++;
    continue;
  }
  // The fast path first: when it reports that nesting exploded, native
  // esbuild is not asked (it can take minutes before the same error)
  const errBefore = stats.error;
  const fast = fastTransform(flagsFor(opts), code, opts.mangleCache);
  if (!tally && fast !== undefined && fast.errors.some((m) => m.text === "CSS nesting is causing too much expansion")) {
    counts.slowNesting++;
    continue;
  }
  let ref = null;
  let refError = null;
  try {
    ref = refTransform(code, opts);
  } catch (e) {
    refError = e;
  }
  if (ref === ESBUILD_CRASHED) {
    counts.esbuildCrash++;
    continue;
  }
  if (tally) {
    const msg = ref === null ? "(error)" : ref.warnings.length > 0 ? ref.warnings[0].text.slice(0, 70) : null;
    if (msg !== null) tallies[msg] = (tallies[msg] || 0) + 1;
    if (why !== null && msg !== null && msg.includes(why) && whyShown++ < 3) console.log("WHY", JSON.stringify(ref === null ? code : code.slice(Math.max(0, ref.warnings[0].location ? ref.warnings[0].location.column - 60 : 0), (ref.warnings[0].location ? ref.warnings[0].location.column : 0) + 60)), ref && ref.warnings[0].location && ref.warnings[0].location.lineText.slice(0, 200));
  }
  let cat;
  let msgDiff = null;
  if (stats.error !== errBefore) cat = "CRASH";
  else [cat, msgDiff] = classifyTransform(ref, refError, fast);
  if (cat === "MISMATCH") {
    const w = wasmTransform(code, opts);
    if (w !== null && messagesJSON(w.warnings) === messagesJSON(fast.warnings) && w.code === fast.code && w.map === fast.map) cat = "okWasm";
  }
  if (cat === "bail" && ref !== null && ref.warnings.length === 0) {
    const key = `${stats.lastBail.reason}: ${stats.lastBail.detail}`;
    bailSites[key] = (bailSites[key] || 0) + 1;
  }
  counts[cat]++;
  if (cat !== "ok" && cat !== "bail" && cat !== "bothFail" && cat !== "okWasm" && cat !== "okError") {
    shown[cat] = (shown[cat] || 0) + 1;
    if (shown[cat] <= showN) {
      console.log(`${cat} [${optName}] #${iter}`);
      console.log("  input: " + JSON.stringify(code.length > 600 ? code.slice(0, 600) + "..." : code));
      if (cat === "MISMATCH") console.log(fast.code !== ref.code ? firstDiff(ref.code, fast.code) : fast.map !== ref.map ? "  (map)\n" + firstDiff(ref.map, fast.map) : "  (legal comments)");
      if (cat === "CRASH") console.log("  " + String(stats.lastError && stats.lastError.stack).split("\n").slice(0, 8).join("\n  "));
      if (msgDiff !== null) console.log(msgDiff);
    }
    if (stopOnFail) break;
  }
}
console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "));
if (tally) for (const [k, v] of Object.entries(tallies).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${v}  ${k}`);
const sites = Object.entries(bailSites).sort((a, b) => b[1] - a[1]);
if (sites.length > 0) {
  console.log("bails where esbuild succeeds without warnings:");
  for (const [k, v] of sites.slice(0, 20)) console.log(`  ${v}  ${k}`);
}

// (failure: any category other than an identical result, a bail or a
// case esbuild itself crashes on)
process.exitCode = ["FALSE-ACCEPT", "FALSE-ERROR", "MSG-MISMATCH", "MISMATCH", "CRASH"].some((k) => counts[k] > 0) ? 1 : 0;
