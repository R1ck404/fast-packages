// Port of internal/css_parser/css_reduce_calc.go. See CONVENTIONS.md.
//
// JS port notes:
// - calcTermWithOp is a Go value struct: every copy in Go is a new object
//   here, and Go's in-place writes to a term (terms[i].data = x) replace the
//   array element instead of mutating a possibly shared object.
// - The calc term classes (calcSum, ...) are pointers in Go, so they are
//   shared and mutated in place exactly like Go does (numeric.number += ...).
// - convertToToken returns [token, ok]; the token is null when !ok (Go
//   returns a zero token that no caller reads).
import { GoPanic } from "./gopanic.mjs";
import { Token, WhitespaceBefore, WhitespaceAfter } from "./css_ast.mjs";
import { TOpenParen, TFunction, TDelimMinus, TDelimPlus, TDelimSlash, TDelimAsterisk, TNumber, TPercentage, TDimension, TIdent } from "./css_lexer.mjs";
import { strconvParseFloat, formatFloatFixed, goEqualFold } from "./gostd.mjs";

export const calcMethods = {
  tryToReduceCalcExpression(token: Token): Token {
    const p = this;
    if (token.children === null) throw new GoPanic("runtime error: invalid memory address or nil pointer dereference");
    const term0 = tryToParseCalcTerm(token.children);
    if (term0 !== null) {
      let whitespace = WhitespaceBefore | WhitespaceAfter;
      if (p.options.minifyWhitespace) {
        whitespace = 0;
      }
      const term = term0.partiallySimplify();
      const r = term.convertToToken(whitespace);
      if (r[1]) {
        const result = r[0];
        if (result.kind === TOpenParen) {
          result.kind = TFunction;
          result.text = "calc";
        }
        result.loc = token.loc;
        result.whitespace = WhitespaceBefore | WhitespaceAfter;
        return result;
      }
    }
    return token;
  },
};

export class calcTermWithOp {
  declare data: calcTerm;
  declare opLoc: number;
  constructor(data: calcTerm = null, opLoc = 0) {
    this.data = data;
    this.opLoc = opLoc;
  }
}

// See: https://www.w3.org/TR/css-values-4/#calc-internal
export type calcTerm = calcSum | calcProduct | calcNegate | calcInvert | calcNumeric | calcValue;

const CALC_FAIL: [Token, boolean] = Object.freeze([null, false]) as any;

export function floatToStringForCalc(a: number): [string, boolean] {
  // Handle non-finite cases
  if (a !== a || a === Infinity || a === -Infinity) {
    return ["", false];
  }

  // Print the number as a string
  let text = formatFloatFixed(a, 5);
  while (text.charCodeAt(text.length - 1) === 48 /* 0 */) {
    text = text.slice(0, text.length - 1);
  }
  if (text.charCodeAt(text.length - 1) === 46 /* . */) {
    text = text.slice(0, text.length - 1);
  }
  if (text.startsWith("0.")) {
    text = text.slice(1);
  } else if (text.startsWith("-0.")) {
    text = "-" + text.slice(2);
  }

  // Bail if the number is not exactly represented
  const r = strconvParseFloat(text);
  if (!r[1] || r[0] !== a) {
    return ["", false];
  }

  return [text, true];
}

function minusToken(loc: number): Token {
  return new Token(null, "-", loc, 0, 0, TDelimMinus, WhitespaceBefore | WhitespaceAfter);
}

function pushAll(to: Token[], from: Token[]) {
  for (let i = 0; i < from.length; i++) to.push(from[i]);
}

export class calcSum {
  declare terms: calcTermWithOp[];
  constructor(terms: calcTermWithOp[] = []) {
    this.terms = terms;
  }

  convertToToken(whitespace: number): [Token, boolean] {
    const c = this;
    // Specification: https://www.w3.org/TR/css-values-4/#calc-serialize
    const tokens: Token[] = [];

    // ALGORITHM DEVIATION: Avoid parenthesizing product nodes inside sum nodes
    const first = c.terms[0].data;
    if (first instanceof calcProduct) {
      const r = first.convertToToken(whitespace);
      if (!r[1]) {
        return CALC_FAIL;
      }
      pushAll(tokens, r[0].children);
    } else {
      const r = first.convertToToken(whitespace);
      if (!r[1]) {
        return CALC_FAIL;
      }
      tokens.push(r[0]);
    }

    for (let i = 1; i < c.terms.length; i++) {
      const term = c.terms[i];
      const data = term.data;

      // If child is a Negate node, append " - " to s, then serialize the Negate's child and append the result to s.
      if (data instanceof calcNegate) {
        const r = data.term.data.convertToToken(whitespace);
        if (!r[1]) {
          return CALC_FAIL;
        }
        tokens.push(minusToken(term.opLoc), r[0]);
        continue;
      }

      // If child is a negative numeric value, append " - " to s, then serialize the negation of child as normal and append the result to s.
      if (data instanceof calcNumeric && data.number < 0) {
        const clone = new calcNumeric(data.unit, -data.number, data.loc);
        const r = clone.convertToToken(whitespace);
        if (!r[1]) {
          return CALC_FAIL;
        }
        tokens.push(minusToken(term.opLoc), r[0]);
        continue;
      }

      // Otherwise, append " + " to s, then serialize child and append the result to s.
      tokens.push(new Token(null, "+", term.opLoc, 0, 0, TDelimPlus, WhitespaceBefore | WhitespaceAfter));

      // ALGORITHM DEVIATION: Avoid parenthesizing product nodes inside sum nodes
      if (data instanceof calcProduct) {
        const r = data.convertToToken(whitespace);
        if (!r[1]) {
          return CALC_FAIL;
        }
        pushAll(tokens, r[0].children);
      } else {
        const r = data.convertToToken(whitespace);
        if (!r[1]) {
          return CALC_FAIL;
        }
        tokens.push(r[0]);
      }
    }

    return [new Token(tokens, "(", tokens[0].loc, 0, 0, TOpenParen, 0), true];
  }

  partiallySimplify(): calcTerm {
    const c = this;
    // Specification: https://www.w3.org/TR/css-values-4/#calc-simplification

    // For each of root's children that are Sum nodes, replace them with their children.
    let terms: calcTermWithOp[] = [];
    for (let k = 0; k < c.terms.length; k++) {
      const old = c.terms[k];
      const term = new calcTermWithOp(old.data.partiallySimplify(), old.opLoc);
      const sum = term.data;
      if (sum instanceof calcSum) {
        for (let j = 0; j < sum.terms.length; j++) {
          const t = sum.terms[j];
          terms.push(new calcTermWithOp(t.data, t.opLoc));
        }
      } else {
        terms.push(term);
      }
    }

    // For each set of root's children that are numeric values with identical units, remove
    // those children and replace them with a single numeric value containing the sum of the
    // removed nodes, and with the same unit. (E.g. combine numbers, combine percentages,
    // combine px values, etc.)
    for (let i = 0; i < terms.length; i++) {
      const numeric = terms[i].data;
      if (numeric instanceof calcNumeric) {
        let end = i + 1;
        for (let j = end; j < terms.length; j++) {
          const term2 = terms[j];
          const numeric2 = term2.data;
          if (numeric2 instanceof calcNumeric && goEqualFold(numeric2.unit, numeric.unit)) {
            numeric.number += numeric2.number;
          } else {
            terms[end] = term2;
            end++;
          }
        }
        terms.length = end;
      }
    }

    // If root has only a single child at this point, return the child.
    if (terms.length === 1) {
      return terms[0].data;
    }

    // Otherwise, return root.
    c.terms = terms;
    return c;
  }
}

export class calcProduct {
  declare terms: calcTermWithOp[];
  constructor(terms: calcTermWithOp[] = []) {
    this.terms = terms;
  }

  convertToToken(whitespace: number): [Token, boolean] {
    const c = this;
    // Specification: https://www.w3.org/TR/css-values-4/#calc-serialize
    const tokens: Token[] = [];
    const r0 = c.terms[0].data.convertToToken(whitespace);
    if (!r0[1]) {
      return CALC_FAIL;
    }
    tokens.push(r0[0]);

    for (let i = 1; i < c.terms.length; i++) {
      const term = c.terms[i];
      const data = term.data;

      // If child is an Invert node, append " / " to s, then serialize the Invert's child and append the result to s.
      if (data instanceof calcInvert) {
        const r = data.term.data.convertToToken(whitespace);
        if (!r[1]) {
          return CALC_FAIL;
        }
        tokens.push(new Token(null, "/", term.opLoc, 0, 0, TDelimSlash, whitespace), r[0]);
        continue;
      }

      // Otherwise, append " * " to s, then serialize child and append the result to s.
      const r = data.convertToToken(whitespace);
      if (!r[1]) {
        return CALC_FAIL;
      }
      tokens.push(new Token(null, "*", term.opLoc, 0, 0, TDelimAsterisk, whitespace), r[0]);
    }

    return [new Token(tokens, "(", tokens[0].loc, 0, 0, TOpenParen, 0), true];
  }

  partiallySimplify(): calcTerm {
    const c = this;
    // Specification: https://www.w3.org/TR/css-values-4/#calc-simplification

    // For each of root's children that are Product nodes, replace them with their children.
    const terms: calcTermWithOp[] = [];
    for (let k = 0; k < c.terms.length; k++) {
      const old = c.terms[k];
      const term = new calcTermWithOp(old.data.partiallySimplify(), old.opLoc);
      const product = term.data;
      if (product instanceof calcProduct) {
        for (let j = 0; j < product.terms.length; j++) {
          const t = product.terms[j];
          terms.push(new calcTermWithOp(t.data, t.opLoc));
        }
      } else {
        terms.push(term);
      }
    }

    // If root has multiple children that are numbers (not percentages or dimensions), remove
    // them and replace them with a single number containing the product of the removed nodes.
    for (let i = 0; i < terms.length; i++) {
      const numeric = terms[i].data;
      if (numeric instanceof calcNumeric && numeric.unit === "") {
        let end = i + 1;
        for (let j = end; j < terms.length; j++) {
          const term2 = terms[j];
          const numeric2 = term2.data;
          if (numeric2 instanceof calcNumeric && numeric2.unit === "") {
            numeric.number *= numeric2.number;
          } else {
            terms[end] = term2;
            end++;
          }
        }
        terms.length = end;
        break;
      }
    }

    // If root contains only numeric values and/or Invert nodes containing numeric values,
    // and multiplying the types of all the children (noting that the type of an Invert
    // node is the inverse of its child's type) results in a type that matches any of the
    // types that a math function can resolve to, return the result of multiplying all the
    // values of the children (noting that the value of an Invert node is the reciprocal
    // of its child's value), expressed in the result's canonical unit.
    if (terms.length === 2) {
      // Right now, only handle the case of two numbers, one of which has no unit
      const first = terms[0].data;
      if (first instanceof calcNumeric) {
        const second = terms[1].data;
        if (second instanceof calcNumeric) {
          if (first.unit === "") {
            second.number *= first.number;
            return second;
          }
          if (second.unit === "") {
            first.number *= second.number;
            return first;
          }
        }
      }
    }

    // ALGORITHM DEVIATION: Divide instead of multiply if the reciprocal is shorter
    for (let i = 1; i < terms.length; i++) {
      const numeric = terms[i].data;
      if (numeric instanceof calcNumeric) {
        const reciprocal = 1 / numeric.number;
        const multiply = floatToStringForCalc(numeric.number);
        if (multiply[1]) {
          const divide = floatToStringForCalc(reciprocal);
          if (divide[1] && divide[0].length < multiply[0].length) {
            numeric.number = reciprocal;
            const opLoc = terms[i].opLoc;
            terms[i] = new calcTermWithOp(new calcInvert(new calcTermWithOp(numeric, opLoc)), opLoc);
          }
        }
      }
    }

    // If root has only a single child at this point, return the child.
    if (terms.length === 1) {
      return terms[0].data;
    }

    // Otherwise, return root.
    c.terms = terms;
    return c;
  }
}

export class calcNegate {
  declare term: calcTermWithOp;
  constructor(term: calcTermWithOp = new calcTermWithOp()) {
    this.term = term;
  }

  convertToToken(whitespace: number): [Token, boolean] {
    const c = this;
    // Specification: https://www.w3.org/TR/css-values-4/#calc-serialize
    const r = c.term.data.convertToToken(whitespace);
    if (!r[1]) {
      return CALC_FAIL;
    }
    return [
      new Token(
        [
          new Token(null, "-1", c.term.opLoc, 0, 0, TNumber, 0),
          // (sic: Go uses the "/" token kind with the text "*")
          new Token(null, "*", c.term.opLoc, 0, 0, TDelimSlash, WhitespaceBefore | WhitespaceAfter),
          r[0],
        ],
        "(",
        0,
        0,
        0,
        TOpenParen,
        0,
      ),
      true,
    ];
  }

  partiallySimplify(): calcTerm {
    const c = this;
    // Specification: https://www.w3.org/TR/css-values-4/#calc-simplification

    c.term = new calcTermWithOp(c.term.data.partiallySimplify(), c.term.opLoc);

    // If root's child is a numeric value, return an equivalent numeric value, but with the value negated (0 - value).
    const numeric = c.term.data;
    if (numeric instanceof calcNumeric) {
      numeric.number = -numeric.number;
      return numeric;
    }

    // If root's child is a Negate node, return the child's child.
    const negate = c.term.data;
    if (negate instanceof calcNegate) {
      return negate.term.data;
    }

    return c;
  }
}

export class calcInvert {
  declare term: calcTermWithOp;
  constructor(term: calcTermWithOp = new calcTermWithOp()) {
    this.term = term;
  }

  convertToToken(whitespace: number): [Token, boolean] {
    const c = this;
    // Specification: https://www.w3.org/TR/css-values-4/#calc-serialize
    const r = c.term.data.convertToToken(whitespace);
    if (!r[1]) {
      return CALC_FAIL;
    }
    return [
      new Token(
        [
          new Token(null, "1", c.term.opLoc, 0, 0, TNumber, 0),
          new Token(null, "/", c.term.opLoc, 0, 0, TDelimSlash, WhitespaceBefore | WhitespaceAfter),
          r[0],
        ],
        "(",
        0,
        0,
        0,
        TOpenParen,
        0,
      ),
      true,
    ];
  }

  partiallySimplify(): calcTerm {
    const c = this;
    // Specification: https://www.w3.org/TR/css-values-4/#calc-simplification

    c.term = new calcTermWithOp(c.term.data.partiallySimplify(), c.term.opLoc);

    // If root's child is a number (not a percentage or dimension) return the reciprocal of the child's value.
    const numeric = c.term.data;
    if (numeric instanceof calcNumeric && numeric.unit === "") {
      numeric.number = 1 / numeric.number;
      return numeric;
    }

    // If root's child is an Invert node, return the child's child.
    const invert = c.term.data;
    if (invert instanceof calcInvert) {
      return invert.term.data;
    }

    return c;
  }
}

export class calcNumeric {
  declare unit: string;
  declare number: number;
  declare loc: number;
  constructor(unit = "", number = 0, loc = 0) {
    this.unit = unit;
    this.number = number;
    this.loc = loc;
  }

  convertToToken(whitespace: number): [Token, boolean] {
    const c = this;
    const r = floatToStringForCalc(c.number);
    if (!r[1]) {
      return CALC_FAIL;
    }
    const text = r[0];
    if (c.unit === "") {
      return [new Token(null, text, c.loc, 0, 0, TNumber, 0), true];
    }
    if (c.unit === "%") {
      return [new Token(null, text + "%", c.loc, 0, 0, TPercentage, 0), true];
    }
    // (the text is ASCII, so its length is Go's byte length)
    return [new Token(null, text + c.unit, c.loc, 0, text.length, TDimension, 0), true];
  }

  partiallySimplify(): calcTerm {
    return this;
  }
}

export class calcValue {
  declare token: Token;
  declare isInvalidPlusOrMinus: boolean;
  constructor(token: Token = new Token(), isInvalidPlusOrMinus = false) {
    this.token = token;
    this.isInvalidPlusOrMinus = isInvalidPlusOrMinus;
  }

  convertToToken(whitespace: number): [Token, boolean] {
    const t = this.token.clone();
    t.whitespace = 0;
    return [t, true];
  }

  partiallySimplify(): calcTerm {
    return this;
  }
}

function isMulOrDiv(term: calcTerm): boolean {
  return term instanceof calcValue && (term.token.kind === TDelimAsterisk || term.token.kind === TDelimSlash);
}

function isValidPlusOrMinus(term: calcTerm): boolean {
  return term instanceof calcValue && !term.isInvalidPlusOrMinus && (term.token.kind === TDelimPlus || term.token.kind === TDelimMinus);
}

export function tryToParseCalcTerm(tokens: Token[]): calcTerm | null {
  // Specification: https://www.w3.org/TR/css-values-4/#calc-internal
  const terms: calcTermWithOp[] = new Array(tokens.length);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    let term: calcTerm;
    if (token.kind === TFunction && goEqualFold(token.text, "var")) {
      // Using "var()" should bail because it can expand to any number of tokens
      return null;
    } else if (token.kind === TOpenParen || (token.kind === TFunction && goEqualFold(token.text, "calc"))) {
      if (token.children === null) throw new GoPanic("runtime error: invalid memory address or nil pointer dereference");
      term = tryToParseCalcTerm(token.children);
      if (term === null) {
        return null;
      }
    } else if (token.kind === TNumber) {
      const r = strconvParseFloat(token.text);
      if (r[1]) {
        term = new calcNumeric("", r[0], token.loc);
      } else {
        term = new calcValue(token, false);
      }
    } else if (token.kind === TPercentage) {
      const r = strconvParseFloat(token.percentageValue());
      if (r[1]) {
        term = new calcNumeric("%", r[0], token.loc);
      } else {
        term = new calcValue(token, false);
      }
    } else if (token.kind === TDimension) {
      const r = strconvParseFloat(token.dimensionValue());
      if (r[1]) {
        term = new calcNumeric(token.dimensionUnit(), r[0], token.loc);
      } else {
        term = new calcValue(token, false);
      }
    } else if (token.kind === TIdent && goEqualFold(token.text, "Infinity")) {
      term = new calcNumeric("", Infinity, token.loc);
    } else if (token.kind === TIdent && goEqualFold(token.text, "-Infinity")) {
      term = new calcNumeric("", -Infinity, token.loc);
    } else if (token.kind === TIdent && goEqualFold(token.text, "NaN")) {
      term = new calcNumeric("", NaN, token.loc);
    } else {
      term = new calcValue(
        token,

        // From the specification: "In addition, whitespace is required on both sides of the
        // + and - operators. (The * and / operators can be used without white space around them.)"
        i > 0 &&
          i + 1 < tokens.length &&
          (token.kind === TDelimPlus || token.kind === TDelimMinus) &&
          (((token.whitespace & WhitespaceBefore) === 0 && (tokens[i - 1].whitespace & WhitespaceAfter) === 0) ||
            ((token.whitespace & WhitespaceAfter) === 0 && (tokens[i + 1].whitespace & WhitespaceBefore) === 0)),
      );
    }
    terms[i] = new calcTermWithOp(term, 0);
  }

  // Collect children into Product and Invert nodes
  let first = 1;
  while (first + 1 < terms.length) {
    // If this is a "*" or "/" operator
    if (isMulOrDiv(terms[first].data)) {
      // Scan over the run
      let last = first;
      while (last + 3 < terms.length) {
        if (isMulOrDiv(terms[last + 2].data)) {
          last += 2;
        } else {
          break;
        }
      }

      // Generate a node for the run
      const n = (last - first) / 2 + 2;
      const productTerms: calcTermWithOp[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const src = terms[first + i * 2 - 1];
        const term = new calcTermWithOp(src.data, src.opLoc);
        if (i > 0) {
          const op = (terms[first + i * 2 - 2].data as calcValue).token;
          term.opLoc = op.loc;
          if (op.kind === TDelimSlash) {
            term.data = new calcInvert(new calcTermWithOp(term.data, term.opLoc));
          }
        }
        productTerms[i] = term;
      }

      // Replace the run with a single node
      terms[first - 1] = new calcTermWithOp(new calcProduct(productTerms), terms[first - 1].opLoc);
      terms.splice(first, last + 2 - first);
      continue;
    }

    first++;
  }

  // Collect children into Sum and Negate nodes
  first = 1;
  while (first + 1 < terms.length) {
    // If this is a "+" or "-" operator
    if (isValidPlusOrMinus(terms[first].data)) {
      // Scan over the run
      let last = first;
      while (last + 3 < terms.length) {
        if (isValidPlusOrMinus(terms[last + 2].data)) {
          last += 2;
        } else {
          break;
        }
      }

      // Generate a node for the run
      const n = (last - first) / 2 + 2;
      const sumTerms: calcTermWithOp[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const src = terms[first + i * 2 - 1];
        const term = new calcTermWithOp(src.data, src.opLoc);
        if (i > 0) {
          const op = (terms[first + i * 2 - 2].data as calcValue).token;
          term.opLoc = op.loc;
          if (op.kind === TDelimMinus) {
            term.data = new calcNegate(new calcTermWithOp(term.data, term.opLoc));
          }
        }
        sumTerms[i] = term;
      }

      // Replace the run with a single node
      terms[first - 1] = new calcTermWithOp(new calcSum(sumTerms), terms[first - 1].opLoc);
      terms.splice(first, last + 2 - first);
      continue;
    }

    first++;
  }

  // This only succeeds if everything reduces to a single term
  if (terms.length === 1) {
    return terms[0].data;
  }
  return null;
}
