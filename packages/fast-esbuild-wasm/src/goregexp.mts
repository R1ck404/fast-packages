// Go's regexp package as esbuild uses it: regexp.Compile (RE2 syntax, Perl
// flags) and (*Regexp).MatchString. Used for "--mangle-props",
// "--reserve-props", plugin filters and Yarn PnP's ignore patterns.
//
// The parser is a function-by-function port of go1.26.5's
// regexp/syntax/parse.go (the Go version esbuild 0.28.2 is built with), so
// exactly the same patterns are accepted (errors, size and nesting limits)
// and the parse tree is Go's. MatchString only reports whether a match
// exists, which does not depend on the matching engine: the tree is
// translated to an equivalent JavaScript RegExp (with the "u" flag, every
// class spelled out as code point ranges, Go's case folding expanded, Go's
// empty-width assertions written as JavaScript's ASCII-based ones or as
// lookarounds). If the JavaScript engine cannot compile that (lookbehind is
// missing in old engines), a small Thompson NFA over the same tree is used.
//
// Go matches the UTF-8 bytes of the string: the 3-byte WTF-8 encoding of a
// lone surrogate is three invalid bytes, each decoded as U+FFFD.
//
// The Unicode tables are Go's (Unicode 15.0.0, src/unicode_tables.mts).

import { CATEGORIES, SCRIPTS, FOLD_CATEGORY, FOLD_SCRIPT, CATEGORY_ALIASES, CASE_RANGES, ASCII_FOLD, CASE_ORBIT } from "./unicode_tables.mjs";

// ---------------------------------------------------------------------------
// unicode (letter.go, tables.go)

const MaxRune = 0x10ffff;
const UpperLower = MaxRune + 1;
const UpperCase = 0;
const LowerCase = 1;

// A range table: [lo, hi, stride, lo, hi, stride, ...] (R16 then R32)
type RangeTable = number[];

const tableCache = new Map<string, RangeTable>();
function decodeTable(enc: string): RangeTable {
  let t = tableCache.get(enc);
  if (t !== undefined) return t;
  t = [];
  let prev = 0;
  if (enc !== "") {
    for (const item of enc.split(",")) {
      let stride = 1;
      let rest = item;
      const slash = rest.indexOf("/");
      if (slash >= 0) {
        stride = parseInt(rest.slice(slash + 1), 36);
        rest = rest.slice(0, slash);
      }
      const colon = rest.indexOf(":");
      const lo = prev + parseInt(colon >= 0 ? rest.slice(0, colon) : rest, 36);
      const hi = lo + (colon >= 0 ? parseInt(rest.slice(colon + 1), 36) : 0);
      t.push(lo, hi, stride);
      prev = hi;
    }
  }
  tableCache.set(enc, t);
  return t;
}

let caseRanges: number[] | null = null; // [lo, hi, upper, lower, title, ...]
function getCaseRanges(): number[] {
  if (caseRanges === null) {
    caseRanges = [];
    for (const item of CASE_RANGES.split(";")) {
      const f = item.split(",").map((x) => (x === "u" ? UpperLower : parseInt(x, 36)));
      caseRanges.push(f[0], f[0] + f[1], f[2], f[3], f[4]);
    }
  }
  return caseRanges;
}

// lookupCaseRange: the index of the range (in units of 5), or -1
function lookupCaseRange(r: number): number {
  const cr = getCaseRanges();
  let lo = 0;
  let hi = cr.length / 5;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (cr[m * 5] <= r && r <= cr[m * 5 + 1]) return m;
    if (r < cr[m * 5]) hi = m;
    else lo = m + 1;
  }
  return -1;
}

function convertCase(_case: number, r: number, m: number): number {
  const cr = getCaseRanges();
  const delta = cr[m * 5 + 2 + _case];
  if (delta > MaxRune) {
    // In an Upper-Lower sequence, which always starts with an UpperCase
    // letter, the characters at even offsets from the beginning of the
    // sequence are upper case; the ones at odd offsets are lower.
    const lo = cr[m * 5];
    return lo + (((r - lo) & ~1) | (_case & 1));
  }
  return r + delta;
}

export function simpleFold(r: number): number {
  if (r < 0 || r > MaxRune) {
    return r;
  }

  if (r < ASCII_FOLD.length) {
    return ASCII_FOLD[r];
  }

  // Consult caseOrbit table for special cases.
  let lo = 0;
  let hi = CASE_ORBIT.length / 2;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (CASE_ORBIT[m * 2] < r) {
      lo = m + 1;
    } else {
      hi = m;
    }
  }
  if (lo < CASE_ORBIT.length / 2 && CASE_ORBIT[lo * 2] === r) {
    return CASE_ORBIT[lo * 2 + 1];
  }

  // No folding specified. This is a one- or two-element equivalence class
  // containing rune and ToLower(rune) and ToUpper(rune) if they are
  // different from rune.
  const cr = lookupCaseRange(r);
  if (cr >= 0) {
    const l = convertCase(LowerCase, r, cr);
    if (l !== r) {
      return l;
    }
    return convertCase(UpperCase, r, cr);
  }
  return r;
}

// ---------------------------------------------------------------------------
// regexp/syntax: regexp.go (the tree)

export const OpNoMatch = 1;
export const OpEmptyMatch = 2;
export const OpLiteral = 3;
export const OpCharClass = 4;
export const OpAnyCharNotNL = 5;
export const OpAnyChar = 6;
export const OpBeginLine = 7;
export const OpEndLine = 8;
export const OpBeginText = 9;
export const OpEndText = 10;
export const OpWordBoundary = 11;
export const OpNoWordBoundary = 12;
export const OpCapture = 13;
export const OpStar = 14;
export const OpPlus = 15;
export const OpQuest = 16;
export const OpRepeat = 17;
export const OpConcat = 18;
export const OpAlternate = 19;

const opPseudo = 128; // where pseudo-ops start
const opLeftParen = opPseudo;
const opVerticalBar = opPseudo + 1;

// Flags
const FoldCase = 1 << 0;
const Literal = 1 << 1;
const ClassNL = 1 << 2;
const DotNL = 1 << 3;
const OneLine = 1 << 4;
const NonGreedy = 1 << 5;
const PerlX = 1 << 6;
const UnicodeGroups = 1 << 7;
const WasDollar = 1 << 8;
const FLAGS_MASK = 0xffff; // (Flags is a uint16)

export const Perl = ClassNL | OneLine | PerlX | UnicodeGroups;

export class Regexp {
  declare op: number;
  declare flags: number;
  declare sub: Regexp[];
  declare rune: number[];
  declare min: number;
  declare max: number;
  declare cap: number;
  declare name: string;
  // (the parser's free list: Go links through Sub0[0])
  declare freeNext: Regexp | null;
  constructor(op: number) {
    this.op = op;
    this.flags = 0;
    this.sub = [];
    this.rune = [];
    this.min = 0;
    this.max = 0;
    this.cap = 0;
    this.name = "";
    this.freeNext = null;
  }
}

function runesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Equal reports whether x and y have identical structure.
function regexpEqual(x: Regexp | null, y: Regexp | null): boolean {
  if (x === null || y === null) {
    return x === y;
  }
  if (x.op !== y.op) {
    return false;
  }
  switch (x.op) {
    case OpEndText:
      // The parse flags remember whether this is \z or \Z.
      if ((x.flags & WasDollar) !== (y.flags & WasDollar)) {
        return false;
      }
      break;

    case OpLiteral:
    case OpCharClass:
      return (x.flags & FoldCase) === (y.flags & FoldCase) && runesEqual(x.rune, y.rune);

    case OpAlternate:
    case OpConcat:
      if (x.sub.length !== y.sub.length) return false;
      for (let i = 0; i < x.sub.length; i++) if (!regexpEqual(x.sub[i], y.sub[i])) return false;
      return true;

    case OpStar:
    case OpPlus:
    case OpQuest:
      if ((x.flags & NonGreedy) !== (y.flags & NonGreedy) || !regexpEqual(x.sub[0], y.sub[0])) {
        return false;
      }
      break;

    case OpRepeat:
      if ((x.flags & NonGreedy) !== (y.flags & NonGreedy) || x.min !== y.min || x.max !== y.max || !regexpEqual(x.sub[0], y.sub[0])) {
        return false;
      }
      break;

    case OpCapture:
      if (x.cap !== y.cap || x.name !== y.name || !regexpEqual(x.sub[0], y.sub[0])) {
        return false;
      }
      break;
  }
  return true;
}

// ---------------------------------------------------------------------------
// regexp/syntax: parse.go

export const ErrInvalidCharClass = "invalid character class";
export const ErrInvalidCharRange = "invalid character class range";
export const ErrInvalidEscape = "invalid escape sequence";
export const ErrInvalidNamedCapture = "invalid named capture";
export const ErrInvalidPerlOp = "invalid or unsupported Perl syntax";
export const ErrInvalidRepeatOp = "invalid nested repetition operator";
export const ErrInvalidRepeatSize = "invalid repeat count";
export const ErrInvalidUTF8 = "invalid UTF-8";
export const ErrMissingBracket = "missing closing ]";
export const ErrMissingParen = "missing closing )";
export const ErrMissingRepeatArgument = "missing argument to repetition operator";
export const ErrTrailingBackslash = "trailing backslash at end of expression";
export const ErrUnexpectedParen = "unexpected )";
export const ErrNestingDepth = "expression nests too deeply";
export const ErrLarge = "expression too large";

// An Error describes a failure to parse a regular expression and gives the
// offending expression.
export class RegexpError {
  declare code: string;
  declare expr: string;
  constructor(code: string, expr: string) {
    this.code = code;
    this.expr = expr;
  }
  toString(): string {
    return "error parsing regexp: " + this.code + ": `" + this.expr + "`";
  }
}

// (panic(ErrLarge) / panic(ErrNestingDepth), recovered by parse)
class LimitPanic {
  declare code: string;
  constructor(code: string) {
    this.code = code;
  }
}

// maxHeight is the maximum height of a regexp parse tree.
const maxHeight = 1000;

// maxSize is the maximum size of a compiled regexp in Insts.
const instSize = 5 * 8; // byte, 2 uint32, slice is 5 64-bit words
const maxSize = Math.floor((128 << 20) / instSize);

// maxRunes is the maximum number of runes allowed in a regexp tree counting
// the runes in all the nodes.
const runeSize = 4; // rune is int32
const maxRunes = (128 << 20) / runeSize;

class parser {
  declare flags: number; // parse mode flags
  declare stack: Regexp[]; // stack of parsed expressions
  declare free: Regexp | null;
  declare numCap: number; // number of capturing groups seen
  declare wholeRegexp: string;
  declare tmpClass: number[]; // temporary char class work space
  declare numRegexp: number; // number of regexps allocated
  declare numRunes: number; // number of runes in char classes
  declare repeats: number; // product of all repetitions seen
  declare height: Map<Regexp, number> | null; // regexp height, for height limit check
  declare size: Map<Regexp, number> | null; // regexp compiled size, for size limit check
  constructor() {
    this.flags = 0;
    this.stack = [];
    this.free = null;
    this.numCap = 0;
    this.wholeRegexp = "";
    this.tmpClass = [];
    this.numRegexp = 0;
    this.numRunes = 0;
    this.repeats = 0;
    this.height = null;
    this.size = null;
  }

  newRegexp(op: number): Regexp {
    let re = this.free;
    if (re !== null) {
      this.free = re.freeNext;
      re.op = 0;
      re.flags = 0;
      re.sub = [];
      re.rune = [];
      re.min = 0;
      re.max = 0;
      re.cap = 0;
      re.name = "";
      re.freeNext = null;
    } else {
      re = new Regexp(0);
      this.numRegexp++;
    }
    re.op = op;
    return re;
  }

  reuse(re: Regexp) {
    if (this.height !== null) {
      this.height.delete(re);
    }
    re.freeNext = this.free;
    this.free = re;
  }

  checkLimits(re: Regexp) {
    if (this.numRunes > maxRunes) {
      throw new LimitPanic(ErrLarge);
    }
    this.checkSize(re);
    this.checkHeight(re);
  }

  checkSize(re: Regexp) {
    if (this.size === null) {
      // We haven't started tracking size yet. Do a relatively cheap check to
      // see if we need to start. Maintain the product of all the repeats
      // we've seen and don't track if the total number of regexp nodes we've
      // seen times the repeat product is in budget.
      if (this.repeats === 0) {
        this.repeats = 1;
      }
      if (re.op === OpRepeat) {
        let n = re.max;
        if (n === -1) {
          n = re.min;
        }
        if (n <= 0) {
          n = 1;
        }
        if (n > Math.floor(maxSize / this.repeats)) {
          this.repeats = maxSize;
        } else {
          this.repeats *= n;
        }
      }
      if (this.numRegexp < Math.floor(maxSize / this.repeats)) {
        return;
      }

      // We need to start tracking size. Make the map and belatedly populate
      // it with info about everything we've constructed so far.
      this.size = new Map();
      for (const re of this.stack) {
        this.checkSize(re);
      }
    }

    if (this.calcSize(re, true) > maxSize) {
      throw new LimitPanic(ErrLarge);
    }
  }

  calcSize(re: Regexp, force: boolean): number {
    if (!force) {
      const size = this.size!.get(re);
      if (size !== undefined) {
        return size;
      }
    }

    let size = 0;
    switch (re.op) {
      case OpLiteral:
        size = re.rune.length;
        break;
      case OpCapture:
      case OpStar:
        // star can be 1+ or 2+; assume 2 pessimistically
        size = 2 + this.calcSize(re.sub[0], false);
        break;
      case OpPlus:
      case OpQuest:
        size = 1 + this.calcSize(re.sub[0], false);
        break;
      case OpConcat:
        for (const sub of re.sub) {
          size += this.calcSize(sub, false);
        }
        break;
      case OpAlternate:
        for (const sub of re.sub) {
          size += this.calcSize(sub, false);
        }
        if (re.sub.length > 1) {
          size += re.sub.length - 1;
        }
        break;
      case OpRepeat: {
        const sub = this.calcSize(re.sub[0], false);
        if (re.max === -1) {
          if (re.min === 0) {
            size = 2 + sub; // x*
          } else {
            size = 1 + re.min * sub; // xxx+
          }
          break;
        }
        // x{2,5} = xx(x(x(x)?)?)?
        size = re.max * sub + (re.max - re.min);
        break;
      }
    }

    size = Math.max(1, size);
    this.size!.set(re, size);
    return size;
  }

  checkHeight(re: Regexp) {
    if (this.numRegexp < maxHeight) {
      return;
    }
    if (this.height === null) {
      this.height = new Map();
      for (const re of this.stack) {
        this.checkHeight(re);
      }
    }
    if (this.calcHeight(re, true) > maxHeight) {
      throw new LimitPanic(ErrNestingDepth);
    }
  }

  calcHeight(re: Regexp, force: boolean): number {
    if (!force) {
      const h = this.height!.get(re);
      if (h !== undefined) {
        return h;
      }
    }
    let h = 1;
    for (const sub of re.sub) {
      const hsub = this.calcHeight(sub, false);
      if (h < 1 + hsub) {
        h = 1 + hsub;
      }
    }
    this.height!.set(re, h);
    return h;
  }

  // Parse stack manipulation.

  // push pushes the regexp re onto the parse stack and returns the regexp.
  push(re: Regexp): Regexp | null {
    this.numRunes += re.rune.length;
    if (re.op === OpCharClass && re.rune.length === 2 && re.rune[0] === re.rune[1]) {
      // Single rune.
      if (this.maybeConcat(re.rune[0], this.flags & ~FoldCase)) {
        return null;
      }
      re.op = OpLiteral;
      re.rune = re.rune.slice(0, 1);
      re.flags = this.flags & ~FoldCase;
    } else if (
      (re.op === OpCharClass &&
        re.rune.length === 4 &&
        re.rune[0] === re.rune[1] &&
        re.rune[2] === re.rune[3] &&
        simpleFold(re.rune[0]) === re.rune[2] &&
        simpleFold(re.rune[2]) === re.rune[0]) ||
      (re.op === OpCharClass && re.rune.length === 2 && re.rune[0] + 1 === re.rune[1] && simpleFold(re.rune[0]) === re.rune[1] && simpleFold(re.rune[1]) === re.rune[0])
    ) {
      // Case-insensitive rune like [Aa] or [Greek delta].
      if (this.maybeConcat(re.rune[0], this.flags | FoldCase)) {
        return null;
      }

      // Rewrite as (case-insensitive) literal.
      re.op = OpLiteral;
      re.rune = re.rune.slice(0, 1);
      re.flags = this.flags | FoldCase;
    } else {
      // Incremental concatenation.
      this.maybeConcat(-1, 0);
    }

    this.stack.push(re);
    this.checkLimits(re);
    return re;
  }

  // maybeConcat implements incremental concatenation of literal runes into
  // string nodes. The parser calls this before each push, so only the top
  // fragment of the stack might need processing. Since this is called before
  // a push, the topmost literal is no longer subject to operators like *
  // (Otherwise ab* would turn into (ab)*.) If r >= 0 and there's a node left
  // over, maybeConcat uses it to push r with the given flags. maybeConcat
  // reports whether r was pushed.
  maybeConcat(r: number, flags: number): boolean {
    const n = this.stack.length;
    if (n < 2) {
      return false;
    }

    const re1 = this.stack[n - 1];
    const re2 = this.stack[n - 2];
    if (re1.op !== OpLiteral || re2.op !== OpLiteral || (re1.flags & FoldCase) !== (re2.flags & FoldCase)) {
      return false;
    }

    // Push re1 into re2.
    for (const x of re1.rune) re2.rune.push(x);

    // Reuse re1 if possible.
    if (r >= 0) {
      re1.rune = [r];
      re1.flags = flags;
      return true;
    }

    this.stack.length = n - 1;
    this.reuse(re1);
    return false; // did not push r
  }

  // literal pushes a literal regexp for the rune r on the stack.
  literal(r: number) {
    const re = this.newRegexp(OpLiteral);
    re.flags = this.flags;
    if ((this.flags & FoldCase) !== 0) {
      r = minFoldRune(r);
    }
    re.rune = [r];
    this.push(re);
  }

  // op pushes a regexp with the given op onto the stack and returns that
  // regexp.
  op(op: number): Regexp | null {
    const re = this.newRegexp(op);
    re.flags = this.flags;
    return this.push(re);
  }

  // repeat replaces the top stack element with itself repeated according to
  // op, min, max. before is the regexp suffix starting at the repetition
  // operator. after is the regexp suffix following after the repetition
  // operator. repeat returns an updated 'after' and an error, if any.
  // (Strings are offsets into the pattern here; the suffixes end at its end.)
  repeat(op: number, min: number, max: number, before: number, after: number, lastRepeat: number): number | RegexpError {
    const s = this.wholeRegexp;
    let flags = this.flags;
    if ((this.flags & PerlX) !== 0) {
      if (after < s.length && s.charCodeAt(after) === 0x3f /* ? */) {
        after++;
        flags ^= NonGreedy;
      }
      if (lastRepeat >= 0) {
        // In Perl it is not allowed to stack repetition operators: a** is a
        // syntax error, not a doubled star, and a++ means something else
        // entirely, which we don't support!
        return new RegexpError(ErrInvalidRepeatOp, s.slice(lastRepeat, after));
      }
    }
    const n = this.stack.length;
    if (n === 0) {
      return new RegexpError(ErrMissingRepeatArgument, s.slice(before, after));
    }
    const sub = this.stack[n - 1];
    if (sub.op >= opPseudo) {
      return new RegexpError(ErrMissingRepeatArgument, s.slice(before, after));
    }

    const re = this.newRegexp(op);
    re.min = min;
    re.max = max;
    re.flags = flags;
    re.sub = [sub];
    this.stack[n - 1] = re;
    this.checkLimits(re);

    if (op === OpRepeat && (min >= 2 || max >= 2) && !repeatIsValid(re, 1000)) {
      return new RegexpError(ErrInvalidRepeatSize, s.slice(before, after));
    }

    return after;
  }

  // concat replaces the top of the stack (above the topmost '|' or '(') with
  // its concatenation.
  concat(): Regexp | null {
    this.maybeConcat(-1, 0);

    // Scan down to find pseudo-operator | or (.
    let i = this.stack.length;
    while (i > 0 && this.stack[i - 1].op < opPseudo) {
      i--;
    }
    const subs = this.stack.slice(i);
    this.stack.length = i;

    // Empty concatenation is special case.
    if (subs.length === 0) {
      return this.push(this.newRegexp(OpEmptyMatch));
    }

    return this.push(this.collapse(subs, OpConcat));
  }

  // alternate replaces the top of the stack (above the topmost '(') with its
  // alternation.
  alternate(): Regexp | null {
    // Scan down to find pseudo-operator (. There are no | above (.
    let i = this.stack.length;
    while (i > 0 && this.stack[i - 1].op < opPseudo) {
      i--;
    }
    const subs = this.stack.slice(i);
    this.stack.length = i;

    // Make sure top class is clean. All the others already are (see
    // swapVerticalBar).
    if (subs.length > 0) {
      cleanAlt(subs[subs.length - 1]);
    }

    // Empty alternate is special case (shouldn't happen but easy to handle).
    if (subs.length === 0) {
      return this.push(this.newRegexp(OpNoMatch));
    }

    return this.push(this.collapse(subs, OpAlternate));
  }

  // collapse returns the result of applying op to sub. If sub contains op
  // nodes, they all get hoisted up so that there is never a concat of a
  // concat or an alternate of an alternate.
  collapse(subs: Regexp[], op: number): Regexp {
    if (subs.length === 1) {
      return subs[0];
    }
    let re = this.newRegexp(op);
    re.sub = [];
    for (const sub of subs) {
      if (sub.op === op) {
        for (const x of sub.sub) re.sub.push(x);
        this.reuse(sub);
      } else {
        re.sub.push(sub);
      }
    }
    if (op === OpAlternate) {
      re.sub = this.factor(re.sub);
      if (re.sub.length === 1) {
        const old = re;
        re = re.sub[0];
        this.reuse(old);
      }
    }
    return re;
  }

  // factor factors common prefixes from the alternation list sub. It returns
  // a replacement list that reuses the same storage and frees (passes to
  // p.reuse) any removed *Regexps.
  //
  // For example, ABC|ABD|AEF|BCX|BCY simplifies by literal prefix
  // extraction to A(B(C|D)|EF)|BC(X|Y) which simplifies by character class
  // introduction to A(B[CD]|EF)|BC[XY]
  factor(sub: Regexp[]): Regexp[] {
    if (sub.length < 2) {
      return sub;
    }

    // Round 1: Factor out common literal prefixes.
    let str: number[] = [];
    let strflags = 0;
    let start = 0;
    let out: Regexp[] = [];
    for (let i = 0; i <= sub.length; i++) {
      // Invariant: sub[start:i] consists of regexps that all begin with str
      // as modified by strflags.
      let istr: number[] = [];
      let iflags = 0;
      if (i < sub.length) {
        const l = this.leadingString(sub[i]);
        istr = l[0];
        iflags = l[1];
        if (iflags === strflags) {
          let same = 0;
          while (same < str.length && same < istr.length && str[same] === istr[same]) {
            same++;
          }
          if (same > 0) {
            // Matches at least one rune in current range. Keep going around.
            str = str.slice(0, same);
            continue;
          }
        }
      }

      // Found end of a run with common leading literal string: sub[start:i]
      // all begin with str[:len(str)], but sub[i] does not even begin with
      // str[0].
      //
      // Factor out common string and append factored expression to out.
      if (i === start) {
        // Nothing to do - run of length 0.
      } else if (i === start + 1) {
        // Just one: don't bother factoring.
        out.push(sub[start]);
      } else {
        // Construct factored form: prefix(suffix1|suffix2|...)
        const prefix = this.newRegexp(OpLiteral);
        prefix.flags = strflags;
        prefix.rune = str.slice();

        for (let j = start; j < i; j++) {
          sub[j] = this.removeLeadingString(sub[j], str.length);
          this.checkLimits(sub[j]);
        }
        const suffix = this.collapse(sub.slice(start, i), OpAlternate); // recurse

        const re = this.newRegexp(OpConcat);
        re.sub = [prefix, suffix];
        out.push(re);
      }

      // Prepare for next iteration.
      start = i;
      str = istr;
      strflags = iflags;
    }
    sub = out;

    // Round 2: Factor out common simple prefixes, just the first piece of
    // each concatenation. This will be good enough a lot of the time.
    //
    // Complex subexpressions (e.g. involving quantifiers) are not safe to
    // factor because that collapses their distinct paths through the
    // automaton, which affects correctness in some cases.
    start = 0;
    out = [];
    let first: Regexp | null = null;
    for (let i = 0; i <= sub.length; i++) {
      // Invariant: sub[start:i] consists of regexps that all begin with
      // ifirst.
      let ifirst: Regexp | null = null;
      if (i < sub.length) {
        ifirst = this.leadingRegexp(sub[i]);
        if (
          first !== null &&
          regexpEqual(first, ifirst) &&
          // first must be a character class OR a fixed repeat of a character class.
          (isCharClass(first) || (first.op === OpRepeat && first.min === first.max && isCharClass(first.sub[0])))
        ) {
          continue;
        }
      }

      // Found end of a run with common leading regexp: sub[start:i] all
      // begin with first but sub[i] does not.
      //
      // Factor out common regexp and append factored expression to out.
      if (i === start) {
        // Nothing to do - run of length 0.
      } else if (i === start + 1) {
        // Just one: don't bother factoring.
        out.push(sub[start]);
      } else {
        // Construct factored form: prefix(suffix1|suffix2|...)
        const prefix = first!;
        for (let j = start; j < i; j++) {
          const reuse = j !== start; // prefix came from sub[start]
          sub[j] = this.removeLeadingRegexp(sub[j], reuse);
          this.checkLimits(sub[j]);
        }
        const suffix = this.collapse(sub.slice(start, i), OpAlternate); // recurse

        const re = this.newRegexp(OpConcat);
        re.sub = [prefix, suffix];
        out.push(re);
      }

      // Prepare for next iteration.
      start = i;
      first = ifirst;
    }
    sub = out;

    // Round 3: Collapse runs of single literals into character classes.
    start = 0;
    out = [];
    for (let i = 0; i <= sub.length; i++) {
      // Invariant: sub[start:i] consists of regexps that are either literal
      // runes or character classes.
      if (i < sub.length && isCharClass(sub[i])) {
        continue;
      }

      // sub[i] is not a char or char class; emit char class for sub[start:i]...
      if (i === start) {
        // Nothing to do - run of length 0.
      } else if (i === start + 1) {
        out.push(sub[start]);
      } else {
        // Make new char class. Start with most complex regexp in sub[start].
        let max = start;
        for (let j = start + 1; j < i; j++) {
          if (sub[max].op < sub[j].op || (sub[max].op === sub[j].op && sub[max].rune.length < sub[j].rune.length)) {
            max = j;
          }
        }
        const tmp = sub[start];
        sub[start] = sub[max];
        sub[max] = tmp;

        for (let j = start + 1; j < i; j++) {
          mergeCharClass(sub[start], sub[j]);
          this.reuse(sub[j]);
        }
        cleanAlt(sub[start]);
        out.push(sub[start]);
      }

      // ... and then emit sub[i].
      if (i < sub.length) {
        out.push(sub[i]);
      }
      start = i + 1;
    }
    sub = out;

    // Round 4: Collapse runs of empty matches into a single empty match.
    out = [];
    for (let i = 0; i < sub.length; i++) {
      if (i + 1 < sub.length && sub[i].op === OpEmptyMatch && sub[i + 1].op === OpEmptyMatch) {
        continue;
      }
      out.push(sub[i]);
    }
    sub = out;

    return sub;
  }

  // leadingString returns the leading literal string that re begins with.
  leadingString(re: Regexp): [number[], number] {
    if (re.op === OpConcat && re.sub.length > 0) {
      re = re.sub[0];
    }
    if (re.op !== OpLiteral) {
      return [[], 0];
    }
    return [re.rune, re.flags & FoldCase];
  }

  // removeLeadingString removes the first n leading runes from the beginning
  // of re. It returns the replacement for re.
  removeLeadingString(re: Regexp, n: number): Regexp {
    if (re.op === OpConcat && re.sub.length > 0) {
      // Removing a leading string in a concatenation might simplify the
      // concatenation.
      let sub = re.sub[0];
      sub = this.removeLeadingString(sub, n);
      re.sub[0] = sub;
      if (sub.op === OpEmptyMatch) {
        this.reuse(sub);
        switch (re.sub.length) {
          case 0:
          case 1:
            // Impossible but handle.
            re.op = OpEmptyMatch;
            re.sub = [];
            break;
          case 2: {
            const old = re;
            re = re.sub[1];
            this.reuse(old);
            break;
          }
          default:
            re.sub = re.sub.slice(1);
        }
      }
      return re;
    }

    if (re.op === OpLiteral) {
      re.rune = re.rune.slice(n);
      if (re.rune.length === 0) {
        re.op = OpEmptyMatch;
      }
    }
    return re;
  }

  // leadingRegexp returns the leading regexp that re begins with.
  leadingRegexp(re: Regexp): Regexp | null {
    if (re.op === OpEmptyMatch) {
      return null;
    }
    if (re.op === OpConcat && re.sub.length > 0) {
      const sub = re.sub[0];
      if (sub.op === OpEmptyMatch) {
        return null;
      }
      return sub;
    }
    return re;
  }

  // removeLeadingRegexp removes the leading regexp in re. It returns the
  // replacement for re. If reuse is true, it passes the removed regexp (if
  // no longer needed) to p.reuse.
  removeLeadingRegexp(re: Regexp, reuse: boolean): Regexp {
    if (re.op === OpConcat && re.sub.length > 0) {
      if (reuse) {
        this.reuse(re.sub[0]);
      }
      re.sub = re.sub.slice(1);
      switch (re.sub.length) {
        case 0:
          re.op = OpEmptyMatch;
          re.sub = [];
          break;
        case 1: {
          const old = re;
          re = re.sub[0];
          this.reuse(old);
          break;
        }
      }
      return re;
    }
    if (reuse) {
      this.reuse(re);
    }
    return this.newRegexp(OpEmptyMatch);
  }

  // parseRepeat parses {min} (max=min) or {min,} (max=-1) or {min,max}. If s
  // is not of that form, it returns ok == false. If s has the right form but
  // the values are too big, it returns min == -1, ok == true.
  // Returns [min, max, rest, ok] (rest is an offset).
  parseRepeat(i: number): [number, number, number, boolean] {
    const s = this.wholeRegexp;
    const n = s.length;
    let min = 0;
    let max = 0;
    if (i >= n || s.charCodeAt(i) !== 0x7b /* { */) {
      return [min, max, 0, false];
    }
    i++;
    let r = this.parseInt(i);
    if (!r[2]) {
      return [min, max, 0, false];
    }
    min = r[0];
    i = r[1];
    if (i >= n) {
      return [min, max, 0, false];
    }
    if (s.charCodeAt(i) !== 0x2c /* , */) {
      max = min;
    } else {
      i++;
      if (i >= n) {
        return [min, max, 0, false];
      }
      if (s.charCodeAt(i) === 0x7d /* } */) {
        max = -1;
      } else {
        r = this.parseInt(i);
        if (!r[2]) {
          return [min, max, 0, false];
        }
        max = r[0];
        i = r[1];
        if (max < 0) {
          // parseInt found too big a number
          min = -1;
        }
      }
    }
    if (i >= n || s.charCodeAt(i) !== 0x7d /* } */) {
      return [min, max, 0, false];
    }
    return [min, max, i + 1, true];
  }

  // parsePerlFlags parses a Perl flag setting or non-capturing group or both,
  // like (?i) or (?: or (?i:. It removes the prefix from s and updates the
  // parse state. The caller must have ensured that s begins with "(?".
  parsePerlFlags(start: number): number | RegexpError {
    const s = this.wholeRegexp;
    const n = s.length;
    let t = start;

    // Check for named captures, first introduced in Python's regexp library:
    //   (?P<name>expr)   the original, introduced by Python
    //   (?<name>expr)    the .NET alteration, adopted by Perl 5.10
    //   (?'name'expr)    another .NET alteration, adopted by Perl 5.10
    // (?P<expr>name) and (?<expr>name) are supported.
    const startsWithP = n - t > 4 && s.charCodeAt(t + 2) === 0x50 /* P */ && s.charCodeAt(t + 3) === 0x3c; /* < */
    const startsWithName = n - t > 3 && s.charCodeAt(t + 2) === 0x3c; /* < */

    if (startsWithP || startsWithName) {
      // position of expr start
      let exprStartPos = 4;
      if (startsWithName) {
        exprStartPos = 3;
      }

      // Pull out name.
      const endAbs = s.indexOf(">", t);
      if (endAbs < 0) {
        return new RegexpError(ErrInvalidNamedCapture, s.slice(start));
      }

      const capture = s.slice(t, endAbs + 1); // "(?P<name>" or "(?<name>"
      const name = s.slice(t + exprStartPos, endAbs); // "name"
      if (!isValidCaptureName(name)) {
        return new RegexpError(ErrInvalidNamedCapture, capture);
      }

      // Like ordinary capture, but named.
      this.numCap++;
      const re = this.op(opLeftParen)!;
      re.cap = this.numCap;
      re.name = name;
      return endAbs + 1;
    }

    // Non-capturing group. Might also twiddle Perl flags.
    t += 2; // skip (?
    let flags = this.flags;
    let sign = +1;
    let sawFlag = false;
    Loop: while (t < n) {
      const c = s.codePointAt(t)!;
      t += c > 0xffff ? 2 : 1;
      switch (c) {
        default:
          break Loop;

        // Flags.
        case 0x69 /* i */:
          flags |= FoldCase;
          sawFlag = true;
          break;
        case 0x6d /* m */:
          flags &= ~OneLine;
          sawFlag = true;
          break;
        case 0x73 /* s */:
          flags |= DotNL;
          sawFlag = true;
          break;
        case 0x55 /* U */:
          flags |= NonGreedy;
          sawFlag = true;
          break;

        // Switch to negation.
        case 0x2d /* - */:
          if (sign < 0) {
            break Loop;
          }
          sign = -1;
          // Invert flags so that | above turn into &^ and vice versa. We'll
          // invert flags again before using it below.
          flags = ~flags & FLAGS_MASK;
          sawFlag = false;
          break;

        // End of flags, starting group or not.
        case 0x3a /* : */:
        case 0x29 /* ) */:
          if (sign < 0) {
            if (!sawFlag) {
              break Loop;
            }
            flags = ~flags & FLAGS_MASK;
          }
          if (c === 0x3a) {
            // Open new group
            this.op(opLeftParen);
          }
          this.flags = flags;
          return t;
      }
    }

    return new RegexpError(ErrInvalidPerlOp, s.slice(start, t));
  }

  // parseInt parses a decimal integer. Returns [n, rest, ok].
  parseInt(i: number): [number, number, boolean] {
    const s = this.wholeRegexp;
    const len = s.length;
    const isDigit = (k: number) => k < len && s.charCodeAt(k) >= 0x30 && s.charCodeAt(k) <= 0x39;
    if (!isDigit(i)) {
      return [0, i, false];
    }
    // Disallow leading zeros.
    if (len - i >= 2 && s.charCodeAt(i) === 0x30 && isDigit(i + 1)) {
      return [0, i, false];
    }
    const t = i;
    while (isDigit(i)) {
      i++;
    }
    // Have digits, compute value.
    let n = 0;
    for (let k = t; k < i; k++) {
      // Avoid overflow.
      if (n >= 1e8) {
        n = -1;
        break;
      }
      n = n * 10 + s.charCodeAt(k) - 0x30;
    }
    return [n, i, true];
  }

  // parseVerticalBar handles a | in the input.
  parseVerticalBar() {
    this.concat();

    // The concatenation we just parsed is on top of the stack. If it sits
    // above an opVerticalBar, swap it below (things below an opVerticalBar
    // become an alternation). Otherwise, push a new vertical bar.
    if (!this.swapVerticalBar()) {
      this.op(opVerticalBar);
    }
  }

  // If the top of the stack is an element followed by an opVerticalBar
  // swapVerticalBar swaps the two and returns true. Otherwise it returns
  // false.
  swapVerticalBar(): boolean {
    // If above and below vertical bar are literal or char class, can merge
    // into a single char class.
    const n = this.stack.length;
    if (n >= 3 && this.stack[n - 2].op === opVerticalBar && isCharClass(this.stack[n - 1]) && isCharClass(this.stack[n - 3])) {
      let re1 = this.stack[n - 1];
      let re3 = this.stack[n - 3];
      // Make re3 the more complex of the two.
      if (re1.op > re3.op) {
        const tmp = re1;
        re1 = re3;
        re3 = tmp;
        this.stack[n - 3] = re3;
      }
      mergeCharClass(re3, re1);
      this.reuse(re1);
      this.stack.length = n - 1;
      return true;
    }

    if (n >= 2) {
      const re1 = this.stack[n - 1];
      const re2 = this.stack[n - 2];
      if (re2.op === opVerticalBar) {
        if (n >= 3) {
          // Now out of reach. Clean opportunistically.
          cleanAlt(this.stack[n - 3]);
        }
        this.stack[n - 2] = re1;
        this.stack[n - 1] = re2;
        return true;
      }
    }
    return false;
  }

  // parseRightParen handles a ) in the input.
  parseRightParen(): RegexpError | null {
    this.concat();
    if (this.swapVerticalBar()) {
      // pop vertical bar
      this.stack.length--;
    }
    this.alternate();

    const n = this.stack.length;
    if (n < 2) {
      return new RegexpError(ErrUnexpectedParen, this.wholeRegexp);
    }
    const re1 = this.stack[n - 1];
    const re2 = this.stack[n - 2];
    this.stack.length = n - 2;
    if (re2.op !== opLeftParen) {
      return new RegexpError(ErrUnexpectedParen, this.wholeRegexp);
    }
    // Restore flags at time of paren.
    this.flags = re2.flags;
    if (re2.cap === 0) {
      // Just for grouping.
      this.push(re1);
    } else {
      re2.op = OpCapture;
      re2.sub = [re1];
      this.push(re2);
    }
    return null;
  }

  // parseEscape parses an escape sequence at the beginning of s and returns
  // the rune: [r, rest] or an error.
  parseEscape(start: number): [number, number] | RegexpError {
    const s = this.wholeRegexp;
    const n = s.length;
    let t = start + 1;
    if (t >= n) {
      return new RegexpError(ErrTrailingBackslash, "");
    }
    let c = s.codePointAt(t)!;
    t += c > 0xffff ? 2 : 1;
    let r = 0;

    Switch: switch (c) {
      default:
        if (c < 0x80 && !isalnum(c)) {
          // Escaped non-word characters are always themselves. PCRE is not
          // quite so rigorous: it accepts things like \q, but we don't. We
          // once rejected \_, but too many programs and people insist on
          // using it, so allow \_.
          return [c, t];
        }
        break;

      // Octal escapes.
      case 0x31:
      case 0x32:
      case 0x33:
      case 0x34:
      case 0x35:
      case 0x36:
      case 0x37:
        // Single non-zero digit is a backreference; not supported
        if (t >= n || s.charCodeAt(t) < 0x30 || s.charCodeAt(t) > 0x37) {
          break;
        }
      // fallthrough
      case 0x30: {
        // Consume up to three octal digits; already have one.
        r = c - 0x30;
        for (let i = 1; i < 3; i++) {
          if (t >= n || s.charCodeAt(t) < 0x30 || s.charCodeAt(t) > 0x37) {
            break;
          }
          r = r * 8 + s.charCodeAt(t) - 0x30;
          t++;
        }
        return [r, t];
      }

      // Hexadecimal escapes.
      case 0x78 /* x */: {
        if (t >= n) {
          break;
        }
        c = s.codePointAt(t)!;
        t += c > 0xffff ? 2 : 1;
        if (c === 0x7b /* { */) {
          // Any number of digits in braces. Perl accepts any text at all; it
          // ignores all text after the first non-hex digit. We require only
          // hex digits, and at least one.
          let nhex = 0;
          r = 0;
          for (;;) {
            if (t >= n) {
              break Switch;
            }
            c = s.codePointAt(t)!;
            t += c > 0xffff ? 2 : 1;
            if (c === 0x7d /* } */) {
              break;
            }
            const v = unhex(c);
            if (v < 0) {
              break Switch;
            }
            r = r * 16 + v;
            if (r > MaxRune) {
              break Switch;
            }
            nhex++;
          }
          if (nhex === 0) {
            break Switch;
          }
          return [r, t];
        }

        // Easy case: two hex digits.
        const x = unhex(c);
        if (t >= n) {
          // (Go: nextRune("") decodes RuneError with size 0, no error)
          c = 0xfffd;
        } else {
          c = s.codePointAt(t)!;
          t += c > 0xffff ? 2 : 1;
        }
        const y = unhex(c);
        if (x < 0 || y < 0) {
          break;
        }
        return [x * 16 + y, t];
      }

      // C escapes. There is no case 'b', to avoid misparsing the Perl
      // word-boundary \b as the C backspace \b when in POSIX mode.
      case 0x61 /* a */:
        return [7, t];
      case 0x66 /* f */:
        return [12, t];
      case 0x6e /* n */:
        return [10, t];
      case 0x72 /* r */:
        return [13, t];
      case 0x74 /* t */:
        return [9, t];
      case 0x76 /* v */:
        return [11, t];
    }
    return new RegexpError(ErrInvalidEscape, s.slice(start, t));
  }

  // parseClassChar parses a character class character at the beginning of s
  // and returns it.
  parseClassChar(i: number, wholeClass: number): [number, number] | RegexpError {
    const s = this.wholeRegexp;
    if (i >= s.length) {
      return new RegexpError(ErrMissingBracket, s.slice(wholeClass));
    }

    // Allow regular escape sequences even though many need not be escaped in
    // this context.
    if (s.charCodeAt(i) === 0x5c /* \ */) {
      return this.parseEscape(i);
    }

    const c = s.codePointAt(i)!;
    return [c, i + (c > 0xffff ? 2 : 1)];
  }

  // parsePerlClassEscape parses a leading Perl character class escape like \d
  // from the beginning of s. If one is present, it appends the characters to
  // r and returns the new slice r and the remainder of the string.
  parsePerlClassEscape(i: number, r: number[]): [number[], number] | null {
    const s = this.wholeRegexp;
    if ((this.flags & PerlX) === 0 || s.length - i < 2 || s.charCodeAt(i) !== 0x5c /* \ */) {
      return null;
    }
    const g = perlGroup.get(s.slice(i, i + 2));
    if (g === undefined) {
      return null;
    }
    return [this.appendGroup(r, g), i + 2];
  }

  // parseNamedClass parses a leading POSIX named character class like
  // [:alnum:] from the beginning of s. If one is present, it appends the
  // characters to r and returns the new slice r and the remainder of the
  // string.
  parseNamedClass(i: number, r: number[]): [number[], number] | null | RegexpError {
    const s = this.wholeRegexp;
    if (s.length - i < 2 || s.charCodeAt(i) !== 0x5b /* [ */ || s.charCodeAt(i + 1) !== 0x3a /* : */) {
      return null;
    }

    let j = s.indexOf(":]", i + 2);
    if (j < 0) {
      return null;
    }
    j += 2;
    const name = s.slice(i, j);
    const g = posixGroup.get(name);
    if (g === undefined) {
      return new RegexpError(ErrInvalidCharRange, name);
    }
    return [this.appendGroup(r, g), j];
  }

  appendGroup(r: number[], g: charGroup): number[] {
    if ((this.flags & FoldCase) === 0) {
      if (g.sign < 0) {
        r = appendNegatedClass(r, g.class_);
      } else {
        r = appendClass(r, g.class_);
      }
    } else {
      let tmp: number[] = [];
      tmp = appendFoldedClass(tmp, g.class_);
      this.tmpClass = tmp;
      tmp = cleanClass(this.tmpClass);
      if (g.sign < 0) {
        r = appendNegatedClass(r, tmp);
      } else {
        r = appendClass(r, tmp);
      }
    }
    return r;
  }

  // parseUnicodeClass parses a leading Unicode character class like \p{Han}
  // from the beginning of s. If one is present, it appends the characters to
  // r and returns the new slice r and the remainder of the string.
  parseUnicodeClass(i: number, r: number[]): [number[], number] | null | RegexpError {
    const s = this.wholeRegexp;
    if ((this.flags & UnicodeGroups) === 0 || s.length - i < 2 || s.charCodeAt(i) !== 0x5c /* \ */ || (s.charCodeAt(i + 1) !== 0x70 /* p */ && s.charCodeAt(i + 1) !== 0x50) /* P */) {
      return null;
    }

    // Committed to parse or return error.
    let sign = +1;
    if (s.charCodeAt(i + 1) === 0x50 /* P */) {
      sign = -1;
    }
    let t = i + 2;
    // (Go: nextRune("") is utf8.RuneError with size 0, not an error)
    const c = t < s.length ? s.codePointAt(t)! : 0xfffd;
    if (t < s.length) t += c > 0xffff ? 2 : 1;
    let seq: string;
    let name: string;
    if (c !== 0x7b /* { */) {
      // Single-letter name.
      seq = s.slice(i, t);
      name = seq.slice(2);
    } else {
      // Name is in braces.
      const end = s.indexOf("}", i);
      if (end < 0) {
        return new RegexpError(ErrInvalidCharRange, s.slice(i));
      }
      seq = s.slice(i, end + 1);
      t = end + 1;
      name = s.slice(i + 3, end);
    }

    // Group can have leading negation too. \p{^Han} == \P{Han}, \P{^Han} == \p{Han}.
    if (name !== "" && name.charCodeAt(0) === 0x5e /* ^ */) {
      sign = -sign;
      name = name.slice(1);
    }

    const [tab, fold, tsign] = unicodeTable(name);
    if (tab === null) {
      return new RegexpError(ErrInvalidCharRange, seq);
    }
    if (tsign < 0) {
      sign = -sign;
    }

    if ((this.flags & FoldCase) === 0 || fold === null) {
      if (sign > 0) {
        r = appendTable(r, tab);
      } else {
        r = appendNegatedTable(r, tab);
      }
    } else {
      // Merge and clean tab and fold in a temporary buffer. This is
      // necessary for the negative case and just tidy for the positive case.
      let tmp: number[] = [];
      tmp = appendTable(tmp, tab);
      tmp = appendTable(tmp, fold);
      this.tmpClass = tmp;
      tmp = cleanClass(this.tmpClass);
      if (sign > 0) {
        r = appendClass(r, tmp);
      } else {
        r = appendNegatedClass(r, tmp);
      }
    }
    return [r, t];
  }

  // parseClass parses a character class at the beginning of s and pushes it
  // onto the parse stack.
  parseClass(start: number): number | RegexpError {
    const s = this.wholeRegexp;
    const n = s.length;
    let t = start + 1; // chop [
    const re = this.newRegexp(OpCharClass);
    re.flags = this.flags;
    re.rune = [];

    let sign = +1;
    if (t < n && s.charCodeAt(t) === 0x5e /* ^ */) {
      sign = -1;
      t++;

      // If character class does not match \n, add it here, so that negation
      // later will do the right thing.
      if ((this.flags & ClassNL) === 0) {
        re.rune.push(10, 10);
      }
    }

    let class_ = re.rune;
    let first = true; // ] and - are okay as first char in class
    while (t >= n || s.charCodeAt(t) !== 0x5d /* ] */ || first) {
      // POSIX: - is only okay unescaped as first or last in class.
      // Perl: - is okay anywhere.
      if (t < n && s.charCodeAt(t) === 0x2d /* - */ && (this.flags & PerlX) === 0 && !first && (n - t === 1 || s.charCodeAt(t + 1) !== 0x5d) /* ] */) {
        const c = s.codePointAt(t + 1);
        return new RegexpError(ErrInvalidCharRange, s.slice(t, t + 1 + (c === undefined ? 0 : c > 0xffff ? 2 : 1)));
      }
      first = false;

      // Look for POSIX [:alnum:] etc.
      if (n - t > 2 && s.charCodeAt(t) === 0x5b /* [ */ && s.charCodeAt(t + 1) === 0x3a /* : */) {
        const nc = this.parseNamedClass(t, class_);
        if (nc instanceof RegexpError) {
          return nc;
        }
        if (nc !== null) {
          class_ = nc[0];
          t = nc[1];
          continue;
        }
      }

      // Look for Unicode character group like \p{Han}.
      const uc = this.parseUnicodeClass(t, class_);
      if (uc instanceof RegexpError) {
        return uc;
      }
      if (uc !== null) {
        class_ = uc[0];
        t = uc[1];
        continue;
      }

      // Look for Perl character class symbols (extension).
      const pc = this.parsePerlClassEscape(t, class_);
      if (pc !== null) {
        class_ = pc[0];
        t = pc[1];
        continue;
      }

      // Single character or simple range.
      const rng = t;
      let r = this.parseClassChar(t, start);
      if (r instanceof RegexpError) {
        return r;
      }
      const lo = r[0];
      t = r[1];
      let hi = lo;
      // [a-] means (a|-) so check for final ].
      if (n - t >= 2 && s.charCodeAt(t) === 0x2d /* - */ && s.charCodeAt(t + 1) !== 0x5d /* ] */) {
        t++;
        r = this.parseClassChar(t, start);
        if (r instanceof RegexpError) {
          return r;
        }
        hi = r[0];
        t = r[1];
        if (hi < lo) {
          return new RegexpError(ErrInvalidCharRange, s.slice(rng, t));
        }
      }
      if ((this.flags & FoldCase) === 0) {
        class_ = appendRange(class_, lo, hi);
      } else {
        class_ = appendFoldedRange(class_, lo, hi);
      }
    }
    t++; // chop ]

    re.rune = class_;
    class_ = cleanClass(re.rune);
    if (sign < 0) {
      class_ = negateClass(class_);
    }
    re.rune = class_;
    this.push(re);
    return t;
  }
}

// minFoldRune returns the minimum rune fold-equivalent to r.
function minFoldRune(r: number): number {
  if (r < minFold || r > maxFold) {
    return r;
  }
  let m = r;
  const r0 = r;
  for (r = simpleFold(r); r !== r0; r = simpleFold(r)) {
    m = Math.min(m, r);
  }
  return m;
}

// repeatIsValid reports whether the repetition re is valid. Valid means that
// the combination of the top-level repetition and any inner repetitions does
// not exceed n copies of the innermost thing.
function repeatIsValid(re: Regexp, n: number): boolean {
  if (re.op === OpRepeat) {
    let m = re.max;
    if (m === 0) {
      return true;
    }
    if (m < 0) {
      m = re.min;
    }
    if (m > n) {
      return false;
    }
    if (m > 0) {
      n = Math.trunc(n / m);
    }
  }
  for (const sub of re.sub) {
    if (!repeatIsValid(sub, n)) {
      return false;
    }
  }
  return true;
}

// cleanAlt cleans re for eventual inclusion in an alternation.
function cleanAlt(re: Regexp) {
  switch (re.op) {
    case OpCharClass:
      re.rune = cleanClass(re.rune);
      if (re.rune.length === 2 && re.rune[0] === 0 && re.rune[1] === MaxRune) {
        re.rune = [];
        re.op = OpAnyChar;
        return;
      }
      if (re.rune.length === 4 && re.rune[0] === 0 && re.rune[1] === 10 - 1 && re.rune[2] === 10 + 1 && re.rune[3] === MaxRune) {
        re.rune = [];
        re.op = OpAnyCharNotNL;
        return;
      }
  }
}

// can this be represented as a character class? single-rune literal string,
// char class, ., and .|\n.
function isCharClass(re: Regexp): boolean {
  return (re.op === OpLiteral && re.rune.length === 1) || re.op === OpCharClass || re.op === OpAnyCharNotNL || re.op === OpAnyChar;
}

// does re match r?
function matchRune(re: Regexp, r: number): boolean {
  switch (re.op) {
    case OpLiteral:
      return re.rune.length === 1 && re.rune[0] === r;
    case OpCharClass:
      for (let i = 0; i < re.rune.length; i += 2) {
        if (re.rune[i] <= r && r <= re.rune[i + 1]) {
          return true;
        }
      }
      return false;
    case OpAnyCharNotNL:
      return r !== 10;
    case OpAnyChar:
      return true;
  }
  return false;
}

// mergeCharClass makes dst = dst|src. The caller must ensure that dst.Op >=
// src.Op, to reduce the amount of copying.
function mergeCharClass(dst: Regexp, src: Regexp) {
  switch (dst.op) {
    case OpAnyChar:
      // src doesn't add anything.
      break;
    case OpAnyCharNotNL:
      // src might add \n
      if (matchRune(src, 10)) {
        dst.op = OpAnyChar;
      }
      break;
    case OpCharClass:
      // src is simpler, so either literal or char class
      if (src.op === OpLiteral) {
        dst.rune = appendLiteral(dst.rune, src.rune[0], src.flags);
      } else {
        dst.rune = appendClass(dst.rune, src.rune);
      }
      break;
    case OpLiteral: {
      // both literal
      if (src.rune[0] === dst.rune[0] && src.flags === dst.flags) {
        break;
      }
      dst.op = OpCharClass;
      const d0 = dst.rune[0];
      dst.rune = appendLiteral([], d0, dst.flags);
      dst.rune = appendLiteral(dst.rune, src.rune[0], src.flags);
      break;
    }
  }
}

class charGroup {
  declare sign: number;
  declare class_: number[];
  constructor(sign: number, class_: number[]) {
    this.sign = sign;
    this.class_ = class_;
  }
}

// perl_groups.go
const code1 = [0x30, 0x39]; /* \d */
const code2 = [0x9, 0xa, 0xc, 0xd, 0x20, 0x20]; /* \s */
const code3 = [0x30, 0x39, 0x41, 0x5a, 0x5f, 0x5f, 0x61, 0x7a]; /* \w */
const perlGroup = new Map<string, charGroup>([
  ["\\d", new charGroup(+1, code1)],
  ["\\D", new charGroup(-1, code1)],
  ["\\s", new charGroup(+1, code2)],
  ["\\S", new charGroup(-1, code2)],
  ["\\w", new charGroup(+1, code3)],
  ["\\W", new charGroup(-1, code3)],
]);
const posixClasses: [string, number[]][] = [
  ["alnum", [0x30, 0x39, 0x41, 0x5a, 0x61, 0x7a]],
  ["alpha", [0x41, 0x5a, 0x61, 0x7a]],
  ["ascii", [0x0, 0x7f]],
  ["blank", [0x9, 0x9, 0x20, 0x20]],
  ["cntrl", [0x0, 0x1f, 0x7f, 0x7f]],
  ["digit", [0x30, 0x39]],
  ["graph", [0x21, 0x7e]],
  ["lower", [0x61, 0x7a]],
  ["print", [0x20, 0x7e]],
  ["punct", [0x21, 0x2f, 0x3a, 0x40, 0x5b, 0x60, 0x7b, 0x7e]],
  ["space", [0x9, 0xd, 0x20, 0x20]],
  ["upper", [0x41, 0x5a]],
  ["word", [0x30, 0x39, 0x41, 0x5a, 0x5f, 0x5f, 0x61, 0x7a]],
  ["xdigit", [0x30, 0x39, 0x41, 0x46, 0x61, 0x66]],
];
const posixGroup = new Map<string, charGroup>();
for (const [name, code] of posixClasses) {
  posixGroup.set("[:" + name + ":]", new charGroup(+1, code));
  posixGroup.set("[:^" + name + ":]", new charGroup(-1, code));
}

const anyTable: RangeTable = [0, 0xffff, 1, 0x10000, MaxRune, 1];
const asciiTable: RangeTable = [0, 0x7f, 1];
const asciiFoldTable: RangeTable = [
  0,
  0x7f,
  1,
  0x017f,
  0x017f,
  1, // Old English long s (U+017F), folds to S/s.
  0x212a,
  0x212a,
  1, // Kelvin K, folds to K/k.
];

// categoryAliases is a lazily constructed copy of unicode.CategoryAliases but
// with the keys passed through canonicalName, to support inexact matches.
let categoryAliases: Map<string, string> | null = null;
function initCategoryAliases() {
  categoryAliases = new Map();
  for (const name in CATEGORY_ALIASES) {
    categoryAliases.set(canonicalName(name), CATEGORY_ALIASES[name]);
  }
}

// canonicalName returns the canonical lookup string for name. The canonical
// name has a leading uppercase letter and then lowercase letters, and it
// omits all underscores, spaces, and hyphens. (Bytes: only ASCII changes.)
function canonicalName(name: string): string {
  let b = "";
  let first = true;
  for (let i = 0; i < name.length; i++) {
    let c = name.charCodeAt(i);
    if (c === 0x5f || c === 0x2d || c === 0x20) {
      continue;
    } else if (first) {
      if (0x61 <= c && c <= 0x7a) {
        c -= 0x20;
      }
      first = false;
    } else if (0x41 <= c && c <= 0x5a) {
      c += 0x20;
    }
    b += String.fromCharCode(c);
  }
  return b;
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// unicodeTable returns the unicode.RangeTable identified by name and the
// table of additional fold-equivalent code points. If sign < 0, the result
// should be inverted.
function unicodeTable(name: string): [RangeTable | null, RangeTable | null, number] {
  name = canonicalName(name);

  // Special cases: Any, Assigned, and ASCII. Also LC is the only
  // non-canonical Categories key, so handle it here.
  switch (name) {
    case "Any":
      return [anyTable, anyTable, +1];
    case "Assigned": {
      const cn = decodeTable(CATEGORIES["Cn"]);
      return [cn, cn, -1]; // invert Cn (unassigned)
    }
    case "Ascii":
      return [asciiTable, asciiFoldTable, +1];
    case "Lc":
      return [decodeTable(CATEGORIES["LC"]), hasOwn(FOLD_CATEGORY, "LC") ? decodeTable(FOLD_CATEGORY["LC"]) : null, +1];
  }
  if (hasOwn(CATEGORIES, name)) {
    return [decodeTable(CATEGORIES[name]), hasOwn(FOLD_CATEGORY, name) ? decodeTable(FOLD_CATEGORY[name]) : null, +1];
  }
  if (hasOwn(SCRIPTS, name)) {
    return [decodeTable(SCRIPTS[name]), hasOwn(FOLD_SCRIPT, name) ? decodeTable(FOLD_SCRIPT[name]) : null, +1];
  }

  // unicode.CategoryAliases makes liberal use of underscores in its names
  // (they are defined that way by Unicode), but we want to match ignoring
  // the underscores, so make our own map with canonical names.
  if (categoryAliases === null) initCategoryAliases();
  const actual = categoryAliases!.get(name);
  if (actual !== undefined && actual !== "") {
    return [decodeTable(CATEGORIES[actual]), hasOwn(FOLD_CATEGORY, actual) ? decodeTable(FOLD_CATEGORY[actual]) : null, +1];
  }
  return [null, null, 0];
}

// cleanClass sorts the ranges (pairs of elements of r), merges them, and
// eliminates duplicates. (Sorts r in place; returns the cleaned prefix.)
function cleanClass(r: number[]): number[] {
  // Sort by lo increasing, hi decreasing to break ties.
  const n = r.length / 2;
  if (n > 1) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) pairs.push([r[2 * i], r[2 * i + 1]]);
    pairs.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : b[1] - a[1]));
    for (let i = 0; i < n; i++) {
      r[2 * i] = pairs[i][0];
      r[2 * i + 1] = pairs[i][1];
    }
  }

  if (r.length < 2) {
    return r;
  }

  // Merge abutting, overlapping.
  let w = 2; // write index
  for (let i = 2; i < r.length; i += 2) {
    const lo = r[i];
    const hi = r[i + 1];
    if (lo <= r[w - 1] + 1) {
      // merge with previous range
      if (hi > r[w - 1]) {
        r[w - 1] = hi;
      }
      continue;
    }
    // new disjoint range
    r[w] = lo;
    r[w + 1] = hi;
    w += 2;
  }

  r.length = w;
  return r;
}

// appendLiteral returns the result of appending the literal x to the class r.
function appendLiteral(r: number[], x: number, flags: number): number[] {
  if ((flags & FoldCase) !== 0) {
    return appendFoldedRange(r, x, x);
  }
  return appendRange(r, x, x);
}

// appendRange returns the result of appending the range lo-hi to the class r.
function appendRange(r: number[], lo: number, hi: number): number[] {
  // Expand last range or next to last range if it overlaps or abuts.
  // Checking two ranges helps when appending case-folded alphabets, so that
  // one range can be expanding A-Z and the other expanding a-z.
  const n = r.length;
  for (let i = 2; i <= 4; i += 2) {
    // twice, using i=2, i=4
    if (n >= i) {
      const rlo = r[n - i];
      const rhi = r[n - i + 1];
      if (lo <= rhi + 1 && rlo <= hi + 1) {
        if (lo < rlo) {
          r[n - i] = lo;
        }
        if (hi > rhi) {
          r[n - i + 1] = hi;
        }
        return r;
      }
    }
  }

  r.push(lo, hi);
  return r;
}

// minimum and maximum runes involved in folding.
const minFold = 0x0041;
const maxFold = 0x1e943;

// appendFoldedRange returns the result of appending the range lo-hi and its
// case folding-equivalent runes to the class r.
function appendFoldedRange(r: number[], lo: number, hi: number): number[] {
  // Optimizations.
  if (lo <= minFold && hi >= maxFold) {
    // Range is full: folding can't add more.
    return appendRange(r, lo, hi);
  }
  if (hi < minFold || lo > maxFold) {
    // Range is outside folding possibilities.
    return appendRange(r, lo, hi);
  }
  if (lo < minFold) {
    // [lo, minFold-1] needs no folding.
    r = appendRange(r, lo, minFold - 1);
    lo = minFold;
  }
  if (hi > maxFold) {
    // [maxFold+1, hi] needs no folding.
    r = appendRange(r, maxFold + 1, hi);
    hi = maxFold;
  }

  // Brute force. Depend on appendRange to coalesce ranges on the fly.
  for (let c = lo; c <= hi; c++) {
    r = appendRange(r, c, c);
    let f = simpleFold(c);
    while (f !== c) {
      r = appendRange(r, f, f);
      f = simpleFold(f);
    }
  }
  return r;
}

// appendClass returns the result of appending the class x to the class r. It
// assume x is clean.
function appendClass(r: number[], x: number[]): number[] {
  for (let i = 0; i < x.length; i += 2) {
    r = appendRange(r, x[i], x[i + 1]);
  }
  return r;
}

// appendFoldedClass returns the result of appending the case folding of the
// class x to the class r.
function appendFoldedClass(r: number[], x: number[]): number[] {
  for (let i = 0; i < x.length; i += 2) {
    r = appendFoldedRange(r, x[i], x[i + 1]);
  }
  return r;
}

// appendNegatedClass returns the result of appending the negation of the
// class x to the class r. It assumes x is clean.
function appendNegatedClass(r: number[], x: number[]): number[] {
  let nextLo = 0;
  for (let i = 0; i < x.length; i += 2) {
    const lo = x[i];
    const hi = x[i + 1];
    if (nextLo <= lo - 1) {
      r = appendRange(r, nextLo, lo - 1);
    }
    nextLo = hi + 1;
  }
  if (nextLo <= MaxRune) {
    r = appendRange(r, nextLo, MaxRune);
  }
  return r;
}

// appendTable returns the result of appending x to the class r.
function appendTable(r: number[], x: RangeTable): number[] {
  for (let i = 0; i < x.length; i += 3) {
    const lo = x[i];
    const hi = x[i + 1];
    const stride = x[i + 2];
    if (stride === 1) {
      r = appendRange(r, lo, hi);
      continue;
    }
    for (let c = lo; c <= hi; c += stride) {
      r = appendRange(r, c, c);
    }
  }
  return r;
}

// appendNegatedTable returns the result of appending the negation of x to
// the class r.
function appendNegatedTable(r: number[], x: RangeTable): number[] {
  let nextLo = 0; // lo end of next class to add
  for (let i = 0; i < x.length; i += 3) {
    const lo = x[i];
    const hi = x[i + 1];
    const stride = x[i + 2];
    if (stride === 1) {
      if (nextLo <= lo - 1) {
        r = appendRange(r, nextLo, lo - 1);
      }
      nextLo = hi + 1;
      continue;
    }
    for (let c = lo; c <= hi; c += stride) {
      if (nextLo <= c - 1) {
        r = appendRange(r, nextLo, c - 1);
      }
      nextLo = c + 1;
    }
  }
  if (nextLo <= MaxRune) {
    r = appendRange(r, nextLo, MaxRune);
  }
  return r;
}

// negateClass overwrites r and returns r's negation. It assumes the class r
// is already clean.
function negateClass(r: number[]): number[] {
  let nextLo = 0; // lo end of next class to add
  let w = 0; // write index
  for (let i = 0; i < r.length; i += 2) {
    const lo = r[i];
    const hi = r[i + 1];
    if (nextLo <= lo - 1) {
      r[w] = nextLo;
      r[w + 1] = lo - 1;
      w += 2;
    }
    nextLo = hi + 1;
  }
  r.length = w;
  if (nextLo <= MaxRune) {
    // It's possible for the negation to have one more range - this one -
    // than the original class, so use append.
    r.push(nextLo, MaxRune);
  }
  return r;
}

// isValidCaptureName reports whether name is a valid capture name:
// [A-Za-z0-9_]+.
function isValidCaptureName(name: string): boolean {
  if (name === "") {
    return false;
  }
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (c !== 0x5f && !isalnum(c)) {
      return false;
    }
  }
  return true;
}

function isalnum(c: number): boolean {
  return (0x30 <= c && c <= 0x39) || (0x41 <= c && c <= 0x5a) || (0x61 <= c && c <= 0x7a);
}

function unhex(c: number): number {
  if (0x30 <= c && c <= 0x39) {
    return c - 0x30;
  }
  if (0x61 <= c && c <= 0x66) {
    return c - 0x61 + 10;
  }
  if (0x41 <= c && c <= 0x46) {
    return c - 0x41 + 10;
  }
  return -1;
}

// Parse parses a regular expression string s, controlled by the specified
// Flags, and returns a regular expression parse tree. (The pattern is a
// well-formed JavaScript string: Go's pattern is the UTF-8 encoding of it,
// so ErrInvalidUTF8 cannot happen. Literal mode is not used by esbuild.)
export function parse(s: string, flags: number): Regexp | RegexpError {
  try {
    return parseImpl(s, flags);
  } catch (e) {
    if (e instanceof LimitPanic) return new RegexpError(e.code, s);
    throw e;
  }
}

function parseImpl(s: string, flags: number): Regexp | RegexpError {
  const p = new parser();
  let lastRepeat = -1; // (Go: lastRepeat string; -1 is "")
  p.flags = flags;
  p.wholeRegexp = s;
  const n = s.length;
  let t = 0;
  while (t < n) {
    let repeat = -1;
    BigSwitch: switch (s.charCodeAt(t)) {
      default: {
        const c = s.codePointAt(t)!;
        t += c > 0xffff ? 2 : 1;
        p.literal(c);
        break;
      }

      case 0x28 /* ( */:
        if ((p.flags & PerlX) !== 0 && n - t >= 2 && s.charCodeAt(t + 1) === 0x3f /* ? */) {
          // Flag changes and non-capturing groups.
          const r = p.parsePerlFlags(t);
          if (r instanceof RegexpError) {
            return r;
          }
          t = r;
          break;
        }
        p.numCap++;
        p.op(opLeftParen)!.cap = p.numCap;
        t++;
        break;
      case 0x7c /* | */:
        p.parseVerticalBar();
        t++;
        break;
      case 0x29 /* ) */: {
        const err = p.parseRightParen();
        if (err !== null) {
          return err;
        }
        t++;
        break;
      }
      case 0x5e /* ^ */:
        if ((p.flags & OneLine) !== 0) {
          p.op(OpBeginText);
        } else {
          p.op(OpBeginLine);
        }
        t++;
        break;
      case 0x24 /* $ */:
        if ((p.flags & OneLine) !== 0) {
          // (p.op returns nil only for single-rune classes)
          p.op(OpEndText)!.flags |= WasDollar;
        } else {
          p.op(OpEndLine);
        }
        t++;
        break;
      case 0x2e /* . */:
        if ((p.flags & DotNL) !== 0) {
          p.op(OpAnyChar);
        } else {
          p.op(OpAnyCharNotNL);
        }
        t++;
        break;
      case 0x5b /* [ */: {
        const r = p.parseClass(t);
        if (r instanceof RegexpError) {
          return r;
        }
        t = r;
        break;
      }
      case 0x2a /* * */:
      case 0x2b /* + */:
      case 0x3f /* ? */: {
        const before = t;
        let op = 0;
        switch (s.charCodeAt(t)) {
          case 0x2a:
            op = OpStar;
            break;
          case 0x2b:
            op = OpPlus;
            break;
          case 0x3f:
            op = OpQuest;
            break;
        }
        const r = p.repeat(op, 0, 0, before, t + 1, lastRepeat);
        if (r instanceof RegexpError) {
          return r;
        }
        repeat = before;
        t = r;
        break;
      }
      case 0x7b /* { */: {
        const op = OpRepeat;
        const before = t;
        const [min, max, after, ok] = p.parseRepeat(t);
        if (!ok) {
          // If the repeat cannot be parsed, { is a literal.
          p.literal(0x7b);
          t++;
          break;
        }
        if (min < 0 || min > 1000 || max > 1000 || (max >= 0 && min > max)) {
          // Numbers were too big, or max is present and min > max.
          return new RegexpError(ErrInvalidRepeatSize, s.slice(before, after));
        }
        const r = p.repeat(op, min, max, before, after, lastRepeat);
        if (r instanceof RegexpError) {
          return r;
        }
        repeat = before;
        t = r;
        break;
      }
      case 0x5c /* \ */: {
        if ((p.flags & PerlX) !== 0 && n - t >= 2) {
          switch (s.charCodeAt(t + 1)) {
            case 0x41 /* A */:
              p.op(OpBeginText);
              t += 2;
              break BigSwitch;
            case 0x62 /* b */:
              p.op(OpWordBoundary);
              t += 2;
              break BigSwitch;
            case 0x42 /* B */:
              p.op(OpNoWordBoundary);
              t += 2;
              break BigSwitch;
            case 0x43 /* C */:
              // any byte; not supported
              return new RegexpError(ErrInvalidEscape, s.slice(t, t + 2));
            case 0x51 /* Q */: {
              // \Q ... \E: the ... is always literals
              let lit: string;
              const end = s.indexOf("\\E", t + 2);
              if (end < 0) {
                lit = s.slice(t + 2);
                t = n;
              } else {
                lit = s.slice(t + 2, end);
                t = end + 2;
              }
              for (let i = 0; i < lit.length; ) {
                const c = lit.codePointAt(i)!;
                i += c > 0xffff ? 2 : 1;
                p.literal(c);
              }
              break BigSwitch;
            }
            case 0x7a /* z */:
              p.op(OpEndText);
              t += 2;
              break BigSwitch;
          }
        }

        const re = p.newRegexp(OpCharClass);
        re.flags = p.flags;

        // Look for Unicode character group like \p{Han}
        if (n - t >= 2 && (s.charCodeAt(t + 1) === 0x70 /* p */ || s.charCodeAt(t + 1) === 0x50) /* P */) {
          const r = p.parseUnicodeClass(t, []);
          if (r instanceof RegexpError) {
            return r;
          }
          if (r !== null) {
            re.rune = r[0];
            t = r[1];
            p.push(re);
            break BigSwitch;
          }
        }

        // Perl character class escape.
        const pc = p.parsePerlClassEscape(t, []);
        if (pc !== null) {
          re.rune = pc[0];
          t = pc[1];
          p.push(re);
          break BigSwitch;
        }
        p.reuse(re);

        // Ordinary single-character escape.
        const e = p.parseEscape(t);
        if (e instanceof RegexpError) {
          return e;
        }
        t = e[1];
        p.literal(e[0]);
        break;
      }
    }
    lastRepeat = repeat;
  }

  p.concat();
  if (p.swapVerticalBar()) {
    // pop vertical bar
    p.stack.length--;
  }
  p.alternate();

  if (p.stack.length !== 1) {
    return new RegexpError(ErrMissingParen, s);
  }
  return p.stack[0];
}

// ---------------------------------------------------------------------------
// regexp.Compile and (*Regexp).MatchString

// Go's string is the UTF-8 (WTF-8 for lone surrogates) encoding of a
// JavaScript string: each lone surrogate is three bytes that each decode to
// U+FFFD
function goRunes(s: string): string {
  if (s.isWellFormed()) return s;
  let t = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        t += s[i] + s[i + 1];
        i++;
        continue;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) t += String.fromCharCode(0xfffd, 0xfffd, 0xfffd);
    else t += s[i];
  }
  return t;
}

export class GoRegexp {
  declare expr: string;
  declare tree: Regexp;
  declare re: RegExp | null;
  declare nfa: NFA | null;
  constructor(expr: string, tree: Regexp) {
    this.expr = expr;
    this.tree = tree;
    this.re = null;
    this.nfa = null;
    try {
      this.re = new RegExp(toJS(tree));
    } catch {
      this.nfa = compileNFA(tree);
    }
  }
  matchString(s: string): boolean {
    s = goRunes(s);
    if (this.re !== null) return this.re.test(s);
    return this.nfa!.match(s);
  }
}

// regexp.Compile: the compiled regexp, or the parse error
export function compile(expr: string): GoRegexp | RegexpError {
  // (the pattern reaches Go through the UTF-8 encoder: lone surrogates
  // become U+FFFD)
  expr = expr.toWellFormed();
  const tree = parse(expr, Perl);
  if (tree instanceof RegexpError) return tree;
  return new GoRegexp(expr, tree);
}

// ---------------------------------------------------------------------------
// The JavaScript translation (exact for "is there a match": both are
// regular languages over code points). Without the "u" flag, so that every
// JavaScript engine matches the same way: astral code points are written as
// surrogate pairs, and a match may not start between the two halves of a
// pair (the string has no lone surrogates: goRunes replaced them), which is
// the only kind of position that has no code point equivalent. Go never
// sees surrogate code points (U+D800-U+DFFF), so classes leave them out.

function hex4(c: number): string {
  return "\\u" + (c + 0x10000).toString(16).slice(1);
}

// The UTF-16 alternatives for the code point ranges r ([lo, hi, ...],
// sorted, disjoint)
function classToJS(r: number[]): string {
  let bmp = "";
  const pairs: string[] = [];
  for (let i = 0; i < r.length; i += 2) {
    let lo = r[i];
    const hi = r[i + 1];
    // (the BMP without the surrogates)
    for (const [a, b] of [
      [0, 0xd7ff],
      [0xe000, 0xffff],
    ]) {
      const x = Math.max(lo, a);
      const y = Math.min(hi, b);
      if (x <= y) bmp += x === y ? hex4(x) : hex4(x) + "-" + hex4(y);
    }
    // (astral: by lead surrogate)
    lo = Math.max(lo, 0x10000);
    while (lo <= hi) {
      const lead = 0xd800 + ((lo - 0x10000) >> 10);
      const leadEnd = 0x10000 + ((lead - 0xd800 + 1) << 10) - 1; // (the last code point with this lead)
      if ((lo & 0x3ff) === 0 && hi >= leadEnd) {
        // whole leads: [lead-lead2][DC00-DFFF]
        const last = Math.min(hi, 0x10ffff);
        const lead2 = 0xd800 + ((last + 1 - 0x10000) >> 10) - 1;
        pairs.push((lead2 === lead ? hex4(lead) : "[" + hex4(lead) + "-" + hex4(lead2) + "]") + "[" + hex4(0xdc00) + "-" + hex4(0xdfff) + "]");
        lo = 0x10000 + ((lead2 - 0xd800 + 1) << 10);
        continue;
      }
      const end = Math.min(hi, leadEnd);
      const t1 = 0xdc00 + ((lo - 0x10000) & 0x3ff);
      const t2 = 0xdc00 + ((end - 0x10000) & 0x3ff);
      pairs.push(hex4(lead) + (t1 === t2 ? hex4(t1) : "[" + hex4(t1) + "-" + hex4(t2) + "]"));
      lo = end + 1;
    }
  }
  if (pairs.length === 0) return "[" + bmp + "]"; // ("[]" never matches)
  if (bmp !== "") pairs.unshift("[" + bmp + "]");
  return "(?:" + pairs.join("|") + ")";
}

// A literal rune: with FoldCase, every rune of its folding orbit
// (compile.go's rune(): FoldCase only matters when the orbit is not trivial)
function runeToJS(r: number, flags: number): string {
  let cls = [r, r];
  if ((flags & FoldCase) !== 0 && simpleFold(r) !== r) {
    const orbit = [r];
    for (let f = simpleFold(r); f !== r; f = simpleFold(f)) orbit.push(f);
    orbit.sort((a, b) => a - b);
    cls = [];
    for (const c of orbit) cls.push(c, c);
  }
  return classToJS(cls);
}

const ANY_CHAR = classToJS([0, 0x10ffff]);
const ANY_CHAR_NOT_NL = classToJS([0, 9, 11, 0x10ffff]);

function toJSImpl(re: Regexp): string {
  switch (re.op) {
    case OpNoMatch:
      return "[]";
    case OpEmptyMatch:
      return "(?:)";
    case OpLiteral: {
      let out = "(?:";
      for (const r of re.rune) out += runeToJS(r, re.flags);
      return out + ")";
    }
    case OpCharClass:
      return classToJS(re.rune);
    case OpAnyCharNotNL:
      return ANY_CHAR_NOT_NL;
    case OpAnyChar:
      return ANY_CHAR;
    case OpBeginLine:
      return "(?:^|(?<=\\n))";
    case OpEndLine:
      return "(?=\\n|$)";
    case OpBeginText:
      return "^";
    case OpEndText:
      return "$";
    case OpWordBoundary:
      // (ASCII word characters in JavaScript without the "i" flag, like Go)
      return "\\b";
    case OpNoWordBoundary:
      return "\\B";
    case OpCapture:
      return "(?:" + toJSImpl(re.sub[0]) + ")";
    case OpStar:
      return "(?:" + toJSImpl(re.sub[0]) + ")*" + ((re.flags & NonGreedy) !== 0 ? "?" : "");
    case OpPlus:
      return "(?:" + toJSImpl(re.sub[0]) + ")+" + ((re.flags & NonGreedy) !== 0 ? "?" : "");
    case OpQuest:
      return "(?:" + toJSImpl(re.sub[0]) + ")?" + ((re.flags & NonGreedy) !== 0 ? "?" : "");
    case OpRepeat:
      return "(?:" + toJSImpl(re.sub[0]) + "){" + re.min + (re.max === re.min ? "" : re.max === -1 ? "," : "," + re.max) + "}" + ((re.flags & NonGreedy) !== 0 ? "?" : "");
    case OpConcat: {
      let out = "(?:";
      for (const sub of re.sub) out += toJSImpl(sub);
      return out + ")";
    }
    case OpAlternate: {
      let out = "(?:";
      for (let i = 0; i < re.sub.length; i++) out += (i > 0 ? "|" : "") + toJSImpl(re.sub[i]);
      return out + ")";
    }
  }
  throw new Error("regexp: unhandled case in toJS");
}

// The JavaScript source of a RegExp (no flags) that matches a string without
// lone surrogates iff Go's regexp matches it
export function toJS(re: Regexp): string {
  // (no match starts between the halves of a surrogate pair)
  return "(?![" + hex4(0xdc00) + "-" + hex4(0xdfff) + "])" + toJSImpl(re);
}

// ---------------------------------------------------------------------------
// The fallback: a Thompson NFA over the same tree, simulated on code points

const NRune = 0; // arg: class ranges, or a literal (with its fold orbit)
const NSplit = 1;
const NEmpty = 2; // an empty-width assertion (the Op)
const NMatch = 3;
const NJump = 4;

interface NFA {
  match(s: string): boolean;
}

export function compileNFAForTest(tree: Regexp): NFA {
  return compileNFA(tree);
}
function compileNFA(tree: Regexp): NFA {
  const kind: number[] = [];
  const out1: number[] = [];
  const out2: number[] = [];
  const arg: any[] = [];
  const add = (k: number, a: any) => {
    kind.push(k);
    out1.push(-1);
    out2.push(-1);
    arg.push(a);
    return kind.length - 1;
  };
  // Compiles re so that it continues at "next"; returns its start
  const comp = (re: Regexp, next: number): number => {
    switch (re.op) {
      case OpNoMatch:
        return add(NRune, []);
      case OpEmptyMatch:
        return next;
      case OpLiteral: {
        let start = next;
        for (let i = re.rune.length - 1; i >= 0; i--) {
          const r = re.rune[i];
          let cls: number[] = [r, r];
          if ((re.flags & FoldCase) !== 0) {
            cls = [];
            for (let f = simpleFold(r); ; f = simpleFold(f)) {
              cls.push(f, f);
              if (f === r) break;
            }
          }
          const pc = add(NRune, cls);
          out1[pc] = start;
          start = pc;
        }
        return start;
      }
      case OpCharClass: {
        const pc = add(NRune, re.rune);
        out1[pc] = next;
        return pc;
      }
      case OpAnyCharNotNL: {
        const pc = add(NRune, [0, 9, 11, MaxRune]);
        out1[pc] = next;
        return pc;
      }
      case OpAnyChar: {
        const pc = add(NRune, [0, MaxRune]);
        out1[pc] = next;
        return pc;
      }
      case OpBeginLine:
      case OpEndLine:
      case OpBeginText:
      case OpEndText:
      case OpWordBoundary:
      case OpNoWordBoundary: {
        const pc = add(NEmpty, re.op);
        out1[pc] = next;
        return pc;
      }
      case OpCapture:
        return comp(re.sub[0], next);
      case OpStar: {
        const split = add(NSplit, null);
        out1[split] = comp(re.sub[0], split);
        out2[split] = next;
        return split;
      }
      case OpPlus: {
        const split = add(NSplit, null);
        const start = comp(re.sub[0], split);
        out1[split] = start;
        out2[split] = next;
        return start;
      }
      case OpQuest: {
        const split = add(NSplit, null);
        out1[split] = comp(re.sub[0], next);
        out2[split] = next;
        return split;
      }
      case OpRepeat: {
        // x{min,max}: min copies, then max-min optional ones (or a star)
        let start = next;
        if (re.max === -1) {
          const split = add(NSplit, null);
          out1[split] = comp(re.sub[0], split);
          out2[split] = next;
          start = split;
        } else {
          for (let i = re.min; i < re.max; i++) {
            const split = add(NSplit, null);
            out1[split] = comp(re.sub[0], start);
            out2[split] = next;
            start = split;
          }
        }
        for (let i = 0; i < re.min; i++) start = comp(re.sub[0], start);
        return start;
      }
      case OpConcat: {
        let start = next;
        for (let i = re.sub.length - 1; i >= 0; i--) start = comp(re.sub[i], start);
        return start;
      }
      case OpAlternate: {
        const jump = add(NJump, null);
        out1[jump] = next;
        let start = comp(re.sub[re.sub.length - 1], jump);
        for (let i = re.sub.length - 2; i >= 0; i--) {
          const split = add(NSplit, null);
          out1[split] = comp(re.sub[i], jump);
          out2[split] = start;
          start = split;
        }
        return start;
      }
    }
    throw new Error("regexp: unhandled case in compileNFA");
  };
  const matchPC = add(NMatch, null);
  const startPC = comp(tree, matchPC);
  const isWord = (r: number) => (0x61 <= r && r <= 0x7a) || (0x41 <= r && r <= 0x5a) || (0x30 <= r && r <= 0x39) || r === 0x5f;
  const emptyOK = (op: number, r1: number, r2: number): boolean => {
    switch (op) {
      case OpBeginLine:
        return r1 < 0 || r1 === 10;
      case OpEndLine:
        return r2 < 0 || r2 === 10;
      case OpBeginText:
        return r1 < 0;
      case OpEndText:
        return r2 < 0;
      case OpWordBoundary:
        return isWord(r1) !== isWord(r2);
      case OpNoWordBoundary:
        return isWord(r1) === isWord(r2);
    }
    return false;
  };
  const inClass = (cls: number[], r: number) => {
    for (let i = 0; i < cls.length; i += 2) if (cls[i] <= r && r <= cls[i + 1]) return true;
    return false;
  };
  return {
    match(s: string): boolean {
      const runes: number[] = [];
      for (const ch of s) runes.push(ch.codePointAt(0)!);
      let mark = new Int32Array(kind.length).fill(-1);
      let clist: number[] = [];
      // Adds pc and everything reachable without consuming a rune; true on
      // reaching the match state
      const addState = (list: number[], pc: number, pos: number): boolean => {
        const stack = [pc];
        while (stack.length > 0) {
          const x = stack.pop()!;
          if (x < 0 || mark[x] === pos) continue;
          mark[x] = pos;
          switch (kind[x]) {
            case NMatch:
              return true;
            case NJump:
              stack.push(out1[x]);
              break;
            case NSplit:
              stack.push(out2[x], out1[x]);
              break;
            case NEmpty:
              if (emptyOK(arg[x], pos > 0 ? runes[pos - 1] : -1, pos < runes.length ? runes[pos] : -1)) stack.push(out1[x]);
              break;
            case NRune:
              list.push(x);
              break;
          }
        }
        return false;
      };
      for (let pos = 0; ; pos++) {
        // (unanchored: a thread starts at every position)
        if (addState(clist, startPC, pos)) return true;
        if (pos === runes.length) return false;
        const nlist: number[] = [];
        const r = runes[pos];
        for (const x of clist) {
          if (inClass(arg[x], r) && addState(nlist, out1[x], pos + 1)) return true;
        }
        clist = nlist;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// unicode.To, unicode.ToLower, unicode.ToUpper (Go's tables: Unicode 15.0.0)

export function unicodeTo(_case: number, r: number): number {
  const m = lookupCaseRange(r);
  if (m >= 0) {
    return convertCase(_case, r, m);
  }
  return r;
}

export function unicodeToLower(r: number): number {
  if (r <= 0x7f) {
    if (65 <= r && r <= 90) {
      r += 32;
    }
    return r;
  }
  return unicodeTo(LowerCase, r);
}

export function unicodeToUpper(r: number): number {
  if (r <= 0x7f) {
    if (97 <= r && r <= 122) {
      r -= 32;
    }
    return r;
  }
  return unicodeTo(UpperCase, r);
}

// unicode.Is(table, r) for a decoded range table
function inTable(t: RangeTable, r: number): boolean {
  let lo = 0;
  let hi = t.length / 3;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    const rlo = t[m * 3];
    const rhi = t[m * 3 + 1];
    if (rlo <= r && r <= rhi) {
      const stride = t[m * 3 + 2];
      return stride === 1 || (r - rlo) % stride === 0;
    }
    if (r < rlo) hi = m;
    else lo = m + 1;
  }
  return false;
}

// unicode.IsPrint (strconv.IsPrint is the same): letters, marks, numbers,
// punctuation, symbols and the ASCII space
let printTables: RangeTable[] | null = null;
export function unicodeIsPrint(r: number): boolean {
  if (r < 0x80) return r >= 0x20 && r < 0x7f;
  if (printTables === null) printTables = ["L", "M", "N", "P", "S"].map((name) => decodeTable(CATEGORIES[name]));
  for (const t of printTables) if (inTable(t, r)) return true;
  return false;
}
