// Go's regexp (src/goregexp.mts: regexp/syntax's parser, the Unicode tables
// and MatchString) vs native esbuild 0.28.2: "--mangle-props" with curated
// and random RE2 patterns (valid and invalid: flags, named groups, Unicode
// classes, POSIX classes, case folding, repeats and their limits, escapes)
// over property names with ASCII, case-folding special cases, astral
// characters and lone surrogates. The mangle cache says which names matched;
// invalid patterns must give esbuild's error.
// usage: node test/goregexp.mjs [--n N] [--seed S]
import { createRequire } from "node:module";
import { fastTransform, stats } from "../src/transform.mjs";
import { classifyTransform } from "./flags.mjs";
const esbuild = createRequire(import.meta.url)("esbuild");
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const N = +arg("--n", 3000);
let seed = +arg("--seed", 1);
const rand = (n) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
const pick = (a) => a[rand(a.length)];

const names = [
  "a", "ab", "abc", "A", "AB", "aB", "Ab", "K", "k", "K", "s", "S", "ſ", "µ", "Μ", "μ", "Σ", "σ", "ς",
  "x1", "_x", "$x", "foo_bar", "ǅ", "Ǆ", "ǆ", "a\nb", "\n", "\r\n", " ", "Ω", "ω", "Ω", "é", "É",
  "日本", "𝒳", "\ud800", "a\udc00b", "􏿿", "{", ".", "a.b", "ab_", "0", "12", "a-b", "ℌ", "ẞ", "ß",
  "İ", "ı", "i", "I", "ᾈ", "ᾀ", "ͅ", "ι", "ι", "xyz", "__foo__", "_", "$", "؀", "၀0", "𐐀",
  "𐐨", "٠", " ", " ", "\t", "a b", "\u0000", "\u007f", "�", "\u{1e943}".length ? "𞥃" : "", "𞤡",
];
const input = names.map((n, i) => `x${i % 7}[${JSON.stringify(n)}];`).join("\n");

const curated = [
  "^_", "_$", ".", "^.$", "^..$", "(?i)k", "(?i)K", "(?i)s", "(?i)ſ", "(?i)K", "(?i)[k]", "(?i)[a-z]", "(?i)[^a-z]", "(?i)σ", "(?i)µ",
  "\\pL", "\\PL", "\\p{L}", "\\p{^L}", "\\P{^L}", "\\p{Greek}", "\\p{greek}", "\\p{Latin}", "\\p{Old_Italic}", "\\p{OldItalic}", "\\p{Lu}", "\\p{lu}",
  "\\p{Ll}", "(?i)\\p{Lu}", "(?i)\\p{Ll}", "(?i)\\P{Lu}", "\\p{Lt}", "(?i)\\p{Lt}", "\\p{LC}", "\\p{Lc}", "\\p{L&}", "\\p{Any}", "\\p{Assigned}",
  "\\P{Assigned}", "\\p{ASCII}", "\\p{ascii}", "(?i)\\p{ASCII}", "\\p{Letter}", "\\p{lowercase letter}", "\\p{Lowercase_Letter}", "\\p{lowercase-letter}",
  "\\p{Cased_Letter}", "\\p{N}", "\\pN", "\\p{Nd}", "\\p{Han}", "\\p{Common}", "(?i)\\p{Common}", "(?i)\\p{Greek}", "(?i)\\p{Inherited}", "\\p{Mn}",
  "(?i)\\p{Mn}", "\\p{Zs}", "\\p{Cc}", "\\p{Cs}", "\\p{Co}", "\\p{Cn}", "\\p{Foo}", "\\p", "\\p{", "\\p{Lu", "\\pZ", "\\pX",
  "[[:alpha:]]", "[[:^alpha:]]", "[[:word:]]", "[[:foo:]]", "[[:alpha:]", "(?i)[[:upper:]]", "(?i)[[:^upper:]]", "[[:space:][:digit:]]",
  "\\d", "\\D", "\\w", "\\W", "\\s", "\\S", "[\\d]", "[\\D]", "(?i)\\W", "(?i)[\\W]", "\\b", "\\B", "^\\b", "\\bx", "a\\b", "\\Bb",
  "^", "$", "\\A", "\\z", "\\Z", "(?m)^b", "(?m)a$", "(?m)^$", "(?m)^\\n", "a\\n(?m)^b", "(?s).", "(?s)^.$", "(?-s).", "(?m:^b)", "^b",
  "a*", "a+", "a?", "a*?", "a+?", "a??", "a**", "a++", "a?*", "a{2}", "a{2,}", "a{,2}", "a{1,3}", "a{3,1}", "a{1000}", "a{1001}", "a{0}", "a{0,0}",
  "(a{2}){2}", "(a{10}){100}", "(a{10}){101}", "((a{10}){10}){10}", "((a{10}){10}){11}", "(a{2}){1000}", "a{01}", "a{1", "a{", "{", "}", "a{1,2",
  "{2}", "*", "+a", "?", "(*)", "(|a)", "(a|)", "a|b|c", "ab|ac|ad", "abc|abd|aef|bcx|bcy", "a|a", "[ab]|[bc]", "(?:a)", "(?i:a)b", "(?i)a(?-i)b",
  "(?i-i:a)", "(?-)", "(?i-)", "(?)", "(?x)", "(?g)a", "(?u)a", "(?y)a", "(?ii)a", "(?i", "(?P<n>a)", "(?<n>a)", "(?P<n!>a)", "(?P<>a)", "(?P=n)",
  "(?'n'a)", "(?P<n>a", "(?#c)", "(?=a)", "(?!a)", "(?<=a)", "(?<!a)", "(", ")", "())", "(()", "a)", "\\", "a\\", "\\Q.*\\E", "\\Qa", "\\Q\\E",
  "\\x41", "\\x4", "\\x", "\\x{3a3}", "\\x{}", "\\x{110000}", "\\x{10ffff}", "\\x{1f600}", "\\101", "\\1", "\\8", "\\0", "\\07", "\\C", "\\q", "\\_",
  "\\-", "\\.", "\\a", "\\f", "\\v", "\\e", "\\cA", "\\u0041", "\\N", "[\\]]", "[]a]", "[a-]", "[-a]", "[z-a]", "[a-\\d]", "[\\d-z]", "[a-a]", "[^\\n]",
  "[^a]", "[^\\x00-\\x{10ffff}]", "[\\x00-\\x{10ffff}]", "[a", "[", "[]", "[^]", "[^]a]", "[\\p{Greek}\\d]", "[^\\p{Greek}]", "(?i)[^k]", "(?i)[K]",
  "(?i)\\x{212a}", "[é-ê]", "é|É", "(?i)é", "𝒳", "[𝒳]", ".𝒳", "(?i)ẞ", "(?i)ß", "(?i)İ",
  "(?i)ı", "(?i)i", "(?i)ᾈ", "(?i)ͅ", "(?i)ι", "�", "�{3}", "^�", "(?i)ǅ", "(?U)a*", "x*?y", "(?i)[a-z]+", "[[:ascii:]]+$",
  "\\p{Latin}+", "^[^_]", "^_[a-z]", "Foo|Bar", "^(foo|bar)$", "(?i)^(FOO|bar)$", "\\$", "^\\$", "\\{", "[{}]", "a|b*", "(a|b)*c", "(a*)*", "(a|a)*b",
];

const atoms = [
  "a", "b", "k", "K", "s", "_", "$", "σ", "K", "ſ", "é", "𝒳", ".", "\\d", "\\w", "\\s", "\\W", "\\b", "\\B", "^", "$", "\\A",
  "\\z", "[a-z]", "[^a-z]", "[k]", "[[:alpha:]]", "[[:^digit:]]", "\\pL", "\\p{Greek}", "\\PL", "\\p{^Lu}", "\\p{Lu}", "\\pN", "\\p{Latin}", "(?i)",
  "(?s)", "(?m)", "(?U)", "(?-i)", "(?i:", "(?:", "(?P<n>", "(?<m>", "(", ")", "|", "*", "+", "?", "*?", "{2}", "{1,3}", "{2,}", "{0}", "{1000}",
  "\\Q.*\\E", "\\x41", "\\x{3a3}", "\\101", "\\1", "\\q", "\\_", "\\.", "[\\]]", "[a-]", "\\n", "�",
];
function randomPattern() {
  let s = "";
  const n = 1 + rand(6);
  for (let i = 0; i < n; i++) s += pick(atoms);
  return s;
}

// A RegExp whose source is the Go pattern (the glue passes source and flags
// through jsRegExpToGoRegExp)
function goRe(pattern) {
  const r = /x/;
  Object.defineProperty(r, "source", { value: pattern });
  Object.defineProperty(r, "flags", { value: "" });
  return r;
}

const counts = {};
const seen = new Set();
let bad = 0;
const patterns = [...curated];
for (let i = 0; i < N; i++) patterns.push(randomPattern());
for (const pattern of patterns) {
  if (seen.has(pattern)) continue;
  seen.add(pattern);
  for (const which of ["mangle", "reserve"]) {
    const o = which === "mangle" ? { mangleProps: goRe(pattern), mangleQuoted: true, mangleCache: {} } : { mangleProps: /./, reserveProps: goRe(pattern), mangleQuoted: true, mangleCache: {} };
    let ref = null;
    let refError = null;
    try {
      ref = await esbuild.transform(input, o);
    } catch (e) {
      refError = e;
    }
    const flags = ["--log-level=silent", "--log-limit=0"];
    if (which === "mangle") flags.push("--mangle-props=" + pattern);
    else flags.push("--mangle-props=.", "--reserve-props=" + pattern);
    flags.push("--mangle-quoted=true");
    const errBefore = stats.error;
    const fast = fastTransform(flags, input, {});
    let [cat, diff] = stats.error !== errBefore ? ["BAD", String(stats.lastError && stats.lastError.stack)] : classifyTransform(ref, refError, fast);
    if (cat === "bail") diff = JSON.stringify(stats.lastBail);
    counts[cat] = (counts[cat] || 0) + 1;
    if (cat !== "ok" && cat !== "okError") {
      bad++;
      if (bad <= 30) console.log(cat, which, JSON.stringify(pattern), diff || "", "\n  ref:", String(JSON.stringify(ref ? ref.mangleCache : refError && refError.message)).slice(0, 400), "\n  fast:", String(JSON.stringify(fast ? fast.mangleCache || fast.errors : null)).slice(0, 400));
    }
  }
}
console.log("goregexp:", seen.size, "patterns", JSON.stringify(counts));
process.exit(bad === 0 ? 0 : 1);
