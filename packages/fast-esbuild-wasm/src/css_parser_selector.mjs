// Port of internal/css_parser/css_parser_selector.go. See CONVENTIONS.md.
//
// JS port notes:
// - Functions that return (value, ok) in Go return [value, ok] arrays. On
//   failure the value is whatever Go's named result held (callers ignore it).
// - CompoundSelector/ComplexSelector are Go value structs: where Go mutates a
//   copy, the copy is made explicitly (copy()); where Go mutates a struct
//   element of a slice in place, the element is replaced by a new object.
import {
  Range,
  MsgID_CSS_CSSSyntaxError,
  Warning,
  Msg,
  MsgData,
} from "./logger.mjs";
import {
  ComplexSelector,
  CompoundSelector,
  Combinator,
  COMBINATOR_NONE,
  NamespacedName,
  NameToken,
  SubclassSelector,
  SSHash,
  SSClass,
  SSAttribute,
  SSPseudoClass,
  SSPseudoClassWithSelectorList,
  NthIndex,
  PseudoClassGlobal,
  PseudoClassHas,
  PseudoClassIs,
  PseudoClassLocal,
  PseudoClassNot,
  PseudoClassNthChild,
  PseudoClassNthLastChild,
  PseudoClassNthOfType,
  PseudoClassNthLastOfType,
  PseudoClassWhere,
  pseudoClassKindHasNthIndex,
  pseudoClassKindString,
} from "./css_ast.mjs";
                                        
import {
  TCloseParen,
  TCloseBracket,
  TCloseBrace,
  TComma,
  TWhitespace,
  TEndOfFile,
  TOpenBrace,
  TOpenBracket,
  TOpenParen,
  TFunction,
  TSemicolon,
  TDelimExclamation,
  TDelimAmpersand,
  TDelimBar,
  TDelimAsterisk,
  TDelimDot,
  TDelimEquals,
  TDelimTilde,
  TDelimCaret,
  TDelimDollar,
  TDelimGreaterThan,
  TDelimPlus,
  TDelimMinus,
  TIdent,
  THash,
  TColon,
  TString,
  TNumber,
  TDimension,
  IsID,
} from "./css_lexer.mjs";
                                                           
import {
  goEqualFold,
  goQuote,
} from "./gostd.mjs";
import { symbolModeDisabled } from "./css_parser.mjs";

export class parseSelectorOpts {
                                // *composesContext (null for nil)
                                  
                                        
                                    
                                          
                                           
                                       
  constructor(
    composesContext      = null,
    pseudoClassKind = PseudoClassGlobal,
    isDeclarationContext = false,
    stopOnCloseParen = false,
    onlyOneComplexSelector = false,
    isForgivingSelectorList = false,
    noLeadingCombinator = false,
  ) {
    this.composesContext = composesContext;
    this.pseudoClassKind = pseudoClassKind;
    this.isDeclarationContext = isDeclarationContext;
    this.stopOnCloseParen = stopOnCloseParen;
    this.onlyOneComplexSelector = onlyOneComplexSelector;
    this.isForgivingSelectorList = isForgivingSelectorList;
    this.noLeadingCombinator = noLeadingCombinator;
  }
}

// Go embeds parseSelectorOpts; here it is the field "parseSelectorOpts"
export class parseComplexSelectorOpts {
  ;                                            
  ;                        
  constructor(parseSelectorOpts_                    = new parseSelectorOpts(), isFirst = false) {
    this.parseSelectorOpts = parseSelectorOpts_;
    this.isFirst = isFirst;
  }
}

// leadingAmpersand
export const cannotRemoveLeadingAmpersand = 0;
export const canAlwaysRemoveLeadingAmpersand = 1;
export const canRemoveLeadingAmpersandIfNotFirst = 2;

export const selectorMethods = {
  parseSelectorList(opts                   )                               {
    const p = this;
    let list                    = [];

    // Potentially parse an empty list for ":is()" and ":where()"
    if (opts.isForgivingSelectorList && opts.stopOnCloseParen && p.peek(TCloseParen)) {
      return [list, true];
    }

    // Parse the first selector
    const first = p.parseComplexSelector(new parseComplexSelectorOpts(opts, true));
    if (!first[1]) {
      return [list, false];
    }
    list = p.flattenLocalAndGlobalSelectors(list, first[0]);

    // Parse the remaining selectors
    if (opts.onlyOneComplexSelector) {
      const t = p.current();
      if (t.kind === TComma) {
        p.prevError = t.range.loc;
        const kind = ":" + pseudoClassKindString(opts.pseudoClassKind) + "(...)";
        p.log.addIDWithNotes(MsgID_CSS_CSSSyntaxError, Warning, p.tracker, t.range, 'Unexpected "," inside ' + goQuote(kind), [
          new MsgData(
            null,
            null,
            "Different CSS tools behave differently in this case, so esbuild doesn't allow it. " +
              "Either remove this comma or split this selector up into multiple comma-separated " +
              goQuote(kind) +
              " selectors instead.",
          ),
        ]);
        return [list, false];
      }
    } else {
      skip: for (;;) {
        p.eat(TWhitespace);
        if (!p.eat(TComma)) {
          break;
        }
        p.eat(TWhitespace);
        const r = p.parseComplexSelector(new parseComplexSelectorOpts(opts, false));
        if (!r[1]) {
          return [list, false];
        }
        const sel                  = r[0];

        // Omit duplicate selectors
        if (p.options.minifySyntax) {
          for (let i = 0; i < list.length; i++) {
            if (sel.equal(list[i], null)) {
              continue skip;
            }
          }
        }

        list = p.flattenLocalAndGlobalSelectors(list, sel);
      }
    }

    // Remove the leading ampersand when minifying and it can be implied:
    //
    //   "a { & b {} }" => "a { b {} }"
    //
    // It can't be implied if it's not at the beginning, if there are multiple of
    // them, or if the selector list is inside of a pseudo-class selector:
    //
    //   "a { b & {} }"
    //   "a { & b & {} }"
    //   "a { :has(& b) {} }"
    //
    if (p.options.minifySyntax && !opts.stopOnCloseParen) {
      for (let i = 1; i < list.length; i++) {
        if (analyzeLeadingAmpersand(list[i], opts.isDeclarationContext) !== cannotRemoveLeadingAmpersand) {
          list[i] = new ComplexSelector(list[i].selectors.slice(1));
        }
      }

      switch (analyzeLeadingAmpersand(list[0], opts.isDeclarationContext)) {
        case canAlwaysRemoveLeadingAmpersand:
          list[0] = new ComplexSelector(list[0].selectors.slice(1));
          break;

        case canRemoveLeadingAmpersandIfNotFirst:
          for (let i = 1; i < list.length; i++) {
            const sel = list[i].selectors[0];
            if (sel.nestingSelectorLocs.length === 0 && (sel.combinator.byte !== 0 || sel.typeSelector === null)) {
              list[0] = new ComplexSelector(list[0].selectors.slice(1));
              const tmp = list[0];
              list[0] = list[i];
              list[i] = tmp;
              break;
            }
          }
          break;
      }
    }

    return [list, true];
  },

  // This handles the ":local()" and ":global()" annotations from CSS modules
  flattenLocalAndGlobalSelectors(list                   , sel                 )                    {
    const p = this;

    // Only do the work to flatten the whole list if there's a ":local" or a ":global"
    if (p.options.symbolMode !== symbolModeDisabled && containsLocalOrGlobalSelector(sel)) {
      const selectors                     = [];

      for (let k = 0; k < sel.selectors.length; k++) {
        // (Go: "s" is a copy of the compound selector)
        let s = sel.selectors[k].copy();
        const oldSubclassSelectors = s.subclassSelectors;
        s.subclassSelectors = [];

        for (let j = 0; j < oldSubclassSelectors.length; j++) {
          const ss = oldSubclassSelectors[j];
          const pseudo = ss.data;
          if (pseudo instanceof SSPseudoClass) {
            if (pseudo.name === "global" || pseudo.name === "local") {
              // Remove bare ":global" and ":local" pseudo-classes
              continue;
            }
          } else if (pseudo instanceof SSPseudoClassWithSelectorList) {
            if (pseudo.kind === PseudoClassGlobal || pseudo.kind === PseudoClassLocal) {
              let inner = pseudo.selectors[0].selectors;

              // Replace this pseudo-class with all inner compound selectors.
              // The first inner compound selector is merged with the compound
              // selector before it and the last inner compound selector is
              // merged with the compound selector after it:
              //
              // "div:local(.a .b):hover" => "div.a b:hover"
              //
              // This behavior is really strange since this is not how anything
              // involving pseudo-classes in real CSS works at all. However, all
              // other implementations (Lightning CSS, PostCSS, and Webpack) are
              // consistent with this strange behavior, so we do it too.
              if (inner[0].combinator.byte === 0) {
                mergeCompoundSelectors(s, inner[0]);
                inner = inner.slice(1);
              } else {
                // "div:local(+ .foo):hover" => "div + .foo:hover"
              }
              const n = inner.length;
              if (n > 0) {
                if (!s.isInvalidBecauseEmpty()) {
                  // Don't add this selector if it consisted only of a bare ":global" or ":local"
                  selectors.push(s);
                }
                for (let m = 0; m < n - 1; m++) {
                  selectors.push(inner[m]);
                }
                // (a copy whose subclass selector list we may append to)
                s = inner[n - 1].copy();
                s.subclassSelectors = s.subclassSelectors.slice();
              }
              continue;
            }
          }

          s.subclassSelectors.push(ss);
        }

        if (!s.isInvalidBecauseEmpty()) {
          // Don't add this selector if it consisted only of a bare ":global" or ":local"
          selectors.push(s);
        }
      }

      if (selectors.length === 0) {
        // Treat a bare ":global" or ":local" as a bare "&" nesting selector
        selectors.push(new CompoundSelector(null, [], [sel.selectors[0].range().loc], COMBINATOR_NONE, true));

        // Make sure we report that nesting is present so that it can be lowered
        p.nestingIsPresent = true;
      }

      sel = new ComplexSelector(selectors);
    }

    list.push(sel);
    return list;
  },

  parseComplexSelector(opts                          )                             {
    const p = this;
    const result = new ComplexSelector([]);

    // This is an extension: https://drafts.csswg.org/css-nesting-1/
    let combinator = COMBINATOR_NONE;
    if (!opts.parseSelectorOpts.noLeadingCombinator) {
      combinator = p.parseCombinator();
      if (combinator.byte !== 0) {
        p.nestingIsPresent = true;
        p.eat(TWhitespace);
      }
    }

    // Parent
    const r = p.parseCompoundSelector(new parseComplexSelectorOpts(opts.parseSelectorOpts, opts.isFirst));
    if (!r[1]) {
      return [result, false];
    }
    const sel                   = r[0];
    sel.combinator = combinator;
    result.selectors.push(sel);

    let stop = TOpenBrace;
    if (opts.parseSelectorOpts.stopOnCloseParen) {
      stop = TCloseParen;
    }
    let childOpts                                  = null;
    for (;;) {
      p.eat(TWhitespace);
      if (p.peek(TEndOfFile) || p.peek(TComma) || p.peek(stop)) {
        break;
      }

      // Optional combinator
      const combinator = p.parseCombinator();
      if (combinator.byte !== 0) {
        p.eat(TWhitespace);
      }

      // Child
      if (childOpts === null) {
        childOpts = new parseComplexSelectorOpts(opts.parseSelectorOpts, false);
      }
      const r = p.parseCompoundSelector(childOpts);
      if (!r[1]) {
        return [result, false];
      }
      const sel                   = r[0];
      sel.combinator = combinator;
      result.selectors.push(sel);
    }

    return [result, true];
  },

  nameToken()            {
    const p = this;
    const t = p.current();
    return new NameToken(p.decoded(), t.range, t.kind);
  },

  parseCompoundSelector(opts                          )                              {
    const p = this;
    const sel = new CompoundSelector(null, [], [], COMBINATOR_NONE, false);
    const startLoc = p.current().range.loc;

    // This is an extension: https://drafts.csswg.org/css-nesting-1/
    const hasLeadingNestingSelector = p.peek(TDelimAmpersand);
    if (hasLeadingNestingSelector) {
      p.nestingIsPresent = true;
      sel.nestingSelectorLocs.push(startLoc);
      p.advance();
    }

    // Parse the type selector
    const typeSelectorLoc = p.current().range.loc;
    switch (p.current().kind) {
      case TDelimBar:
      case TIdent:
      case TDelimAsterisk: {
        const nsName = new NamespacedName(null, new NameToken());
        if (!p.peek(TDelimBar)) {
          nsName.name = p.nameToken();
          p.advance();
        } else {
          // Hack: Create an empty "identifier" to represent this
          nsName.name.kind = TIdent;
        }
        if (p.eat(TDelimBar)) {
          if (!p.peek(TIdent) && !p.peek(TDelimAsterisk)) {
            p.expect(TIdent);
            return [sel, false];
          }
          const prefix = nsName.name;
          nsName.namespacePrefix = prefix;
          nsName.name = p.nameToken();
          p.advance();
        }
        sel.typeSelector = nsName;
        break;
      }
    }

    // Parse the subclass selectors
    subclassSelectors: for (;;) {
      const subclassToken             = p.current();

      switch (subclassToken.kind) {
        case THash: {
          if ((subclassToken.flags & IsID) === 0) {
            break subclassSelectors;
          }
          const nameLoc = subclassToken.range.loc + 1;
          const name = p.decoded();
          sel.subclassSelectors.push(new SubclassSelector(new SSHash(p.symbolForName(nameLoc, name)), subclassToken.range));
          p.advance();
          break;
        }

        case TDelimDot: {
          p.advance();
          const nameRange = p.current().range;
          const name = p.decoded();
          sel.subclassSelectors.push(
            new SubclassSelector(
              new SSClass(p.symbolForName(nameRange.loc, name)),
              new Range(subclassToken.range.loc, nameRange.loc + nameRange.len - subclassToken.range.loc),
            ),
          );
          if (!p.expect(TIdent)) {
            return [sel, false];
          }
          break;
        }

        case TOpenBracket: {
          const r = p.parseAttributeSelector();
          const attr              = r[0];
          const range        = r[1];
          if (range.len === 0) {
            return [sel, false];
          }
          sel.subclassSelectors.push(new SubclassSelector(attr, range));
          break;
        }

        case TColon: {
          if (p.next().kind === TColon) {
            // Special-case the start of the pseudo-element selector section
            while (p.peek(TColon)) {
              const firstColonLoc = p.current().range.loc;
              const isElement = p.next().kind === TColon;
              if (isElement) {
                p.advance();
              }
              const r = p.parsePseudoClassSelector(firstColonLoc, isElement);
              const pseudo     = r[0];

              // https://www.w3.org/TR/selectors-4/#single-colon-pseudos
              // The four Level 2 pseudo-elements (::before, ::after, ::first-line,
              // and ::first-letter) may, for legacy reasons, be represented using
              // the <pseudo-class-selector> grammar, with only a single ":"
              // character at their start.
              if (p.options.minifySyntax && isElement) {
                if (pseudo instanceof SSPseudoClass && (pseudo.args === null || pseudo.args.length === 0)) {
                  switch (pseudo.name) {
                    case "before":
                    case "after":
                    case "first-line":
                    case "first-letter":
                      pseudo.isElement = false;
                      break;
                  }
                }
              }

              sel.subclassSelectors.push(new SubclassSelector(pseudo, r[1]));
            }
            break subclassSelectors;
          }

          const r = p.parsePseudoClassSelector(subclassToken.range.loc, false);
          sel.subclassSelectors.push(new SubclassSelector(r[0], r[1]));
          break;
        }

        case TDelimAmpersand:
          // This is an extension: https://drafts.csswg.org/css-nesting-1/
          p.nestingIsPresent = true;
          sel.nestingSelectorLocs.push(subclassToken.range.loc);
          p.advance();
          break;

        default:
          break subclassSelectors;
      }
    }

    // The compound selector must be non-empty
    if (sel.isInvalidBecauseEmpty()) {
      p.unexpected();
      return [sel, false];
    }

    // Note: "&div {}" was originally valid, but is now an invalid selector:
    // https://github.com/w3c/csswg-drafts/issues/8662#issuecomment-1514977935.
    // This is because SASS already uses that syntax to mean something very
    // different, so that syntax has been removed to avoid mistakes.
    if (hasLeadingNestingSelector && sel.typeSelector !== null) {
      const prev = p.at(p.index - 1).range;
      let r = new Range(typeSelectorLoc, prev.loc + prev.len - typeSelectorLoc);
      let text = sel.typeSelector.name.text;
      if (sel.typeSelector.namespacePrefix !== null) {
        text = sel.typeSelector.namespacePrefix.text + "|" + text;
      }
      let howToFix;
      let suggestion = p.source.textForRange(r);
      if (opts.isFirst) {
        suggestion = ":is(" + suggestion + ")";
        howToFix = 'You can wrap this selector in ":is(...)" as a workaround. ';
      } else {
        r = new Range(startLoc, r.loc + r.len - startLoc);
        suggestion += "&";
        howToFix = 'You can move the "&" to the end of this selector as a workaround. ';
      }
      const msg = new Msg(
        [
          new MsgData(
            null,
            null,
            'CSS nesting syntax does not allow the "&" selector to come before a type selector. ' +
              howToFix +
              "This restriction exists to avoid problems with SASS nesting, where the same syntax means something very different " +
              "that has no equivalent in real CSS (appending a suffix to the parent selector).",
          ),
        ],
        "",
        p.tracker.msgData(r, "Cannot use type selector " + goQuote(text) + ' directly after nesting selector "&"'),
        Warning,
      );
      msg.data.location.suggestion = suggestion;
      p.log.addMsgID(MsgID_CSS_CSSSyntaxError, msg);
      return [sel, false];
    }

    // The type selector must always come first
    switch (p.current().kind) {
      case TDelimBar:
      case TIdent:
      case TDelimAsterisk:
        p.unexpected();
        return [sel, false];
    }

    return [sel, true];
  },

  parseAttributeSelector()                       {
    const p = this;
    const attr = new SSAttribute("", "", new NamespacedName(null, new NameToken()), 0);
    const fail = new Range(0, 0);
    const matchingLoc = p.current().range.loc;
    p.advance();

    // Parse the namespaced name
    switch (p.current().kind) {
      case TDelimBar:
      case TDelimAsterisk:
        // "[|x]"
        // "[*|x]"
        if (p.peek(TDelimAsterisk)) {
          const prefix = p.nameToken();
          p.advance();
          attr.namespacedName.namespacePrefix = prefix;
        } else {
          // "[|attr]" is equivalent to "[attr]". From the specification:
          // "In keeping with the Namespaces in the XML recommendation, default
          // namespaces do not apply to attributes, therefore attribute selectors
          // without a namespace component apply only to attributes that have no
          // namespace (equivalent to |attr)."
        }
        if (!p.expect(TDelimBar)) {
          return [attr, fail];
        }
        attr.namespacedName.name = p.nameToken();
        if (!p.expect(TIdent)) {
          return [attr, fail];
        }
        break;

      default:
        // "[x]"
        // "[x|y]"
        attr.namespacedName.name = p.nameToken();
        if (!p.expect(TIdent)) {
          return [attr, fail];
        }
        if (p.next().kind !== TDelimEquals && p.eat(TDelimBar)) {
          const prefix = attr.namespacedName.name;
          attr.namespacedName.namespacePrefix = prefix;
          attr.namespacedName.name = p.nameToken();
          if (!p.expect(TIdent)) {
            return [attr, fail];
          }
        }
        break;
    }

    // Parse the optional matcher operator
    p.eat(TWhitespace);
    if (p.eat(TDelimEquals)) {
      attr.matcherOp = "=";
    } else {
      switch (p.current().kind) {
        case TDelimTilde:
          attr.matcherOp = "~=";
          break;
        case TDelimBar:
          attr.matcherOp = "|=";
          break;
        case TDelimCaret:
          attr.matcherOp = "^=";
          break;
        case TDelimDollar:
          attr.matcherOp = "$=";
          break;
        case TDelimAsterisk:
          attr.matcherOp = "*=";
          break;
      }
      if (attr.matcherOp !== "") {
        p.advance();
        if (!p.expect(TDelimEquals)) {
          return [attr, fail];
        }
      }
    }

    // Parse the optional matcher value
    if (attr.matcherOp !== "") {
      p.eat(TWhitespace);
      if (!p.peek(TString) && !p.peek(TIdent)) {
        p.unexpected();
      }
      attr.matcherValue = p.decoded();
      p.advance();
      p.eat(TWhitespace);
      if (p.peek(TIdent)) {
        // (Go checks for a single byte; a single non-ASCII UTF-16 unit never
        // matches the letters below either)
        const modifier = p.decoded();
        if (modifier.length === 1) {
          const c = modifier.charCodeAt(0);
          if (c === 105 /* i */ || c === 73 /* I */ || c === 115 /* s */ || c === 83 /* S */) {
            attr.matcherModifier = c;
            p.advance();
          }
        }
      }
    }

    let closeRange        = p.current().range;
    if (!p.expectWithMatchingLoc(TCloseBracket, matchingLoc)) {
      closeRange = new Range(closeRange.loc, 0);
    }
    return [attr, new Range(matchingLoc, closeRange.loc + closeRange.len - matchingLoc)];
  },

  parsePseudoClassSelector(loc        , isElement         )              {
    const p = this;
    p.advance();

    if (p.peek(TFunction)) {
      const text = p.decoded();
      const fnRange        = p.current().range;
      const matchingLoc = fnRange.loc + fnRange.len - 1;
      p.advance();

      // Potentially parse a pseudo-class with a selector list
      if (!isElement) {
        let kind = PseudoClassGlobal;
        let local = p.makeLocalSymbols;
        let ok = true;
        switch (text) {
          case "global":
            kind = PseudoClassGlobal;
            if (p.options.symbolMode !== symbolModeDisabled) {
              local = false;
            }
            break;
          case "has":
            kind = PseudoClassHas;
            break;
          case "is":
            kind = PseudoClassIs;
            break;
          case "local":
            kind = PseudoClassLocal;
            if (p.options.symbolMode !== symbolModeDisabled) {
              local = true;
            }
            break;
          case "not":
            kind = PseudoClassNot;
            break;
          case "nth-child":
            kind = PseudoClassNthChild;
            break;
          case "nth-last-child":
            kind = PseudoClassNthLastChild;
            break;
          case "nth-of-type":
            kind = PseudoClassNthOfType;
            break;
          case "nth-last-of-type":
            kind = PseudoClassNthLastOfType;
            break;
          case "where":
            kind = PseudoClassWhere;
            break;
          default:
            ok = false;
        }
        if (ok) {
          const old = p.index;
          if (pseudoClassKindHasNthIndex(kind)) {
            p.eat(TWhitespace);

            // Parse the "An+B" syntax
            const nth = p.parseNthIndex();
            if (nth[1]) {
              const index           = nth[0];
              let selectors                    = [];
              // (Go: this "ok" shadows the outer one)
              let ok = true;

              // Parse the optional "of" clause
              if ((kind === PseudoClassNthChild || kind === PseudoClassNthLastChild) && p.peek(TIdent) && goEqualFold(p.decoded(), "of")) {
                p.advance();
                p.eat(TWhitespace);

                // Contain the effects of ":local" and ":global"
                const oldLocal = p.makeLocalSymbols;
                const r = p.parseSelectorList(new parseSelectorOpts(null, PseudoClassGlobal, false, true, false, false, true));
                selectors = r[0];
                ok = r[1];
                p.makeLocalSymbols = oldLocal;
              }

              // "2n+0" => "2n"
              if (p.options.minifySyntax) {
                index.minify();
              }

              // Match the closing ")"
              if (ok) {
                let closeRange        = p.current().range;
                if (!p.expectWithMatchingLoc(TCloseParen, matchingLoc)) {
                  closeRange = new Range(closeRange.loc, 0);
                }
                return [new SSPseudoClassWithSelectorList(selectors, index, kind), new Range(loc, closeRange.loc + closeRange.len - loc)];
              }
            }
          } else {
            p.eat(TWhitespace);

            // ":local" forces local names and ":global" forces global names
            const oldLocal = p.makeLocalSymbols;
            p.makeLocalSymbols = local;
            const r = p.parseSelectorList(
              new parseSelectorOpts(
                null,
                kind,
                false,
                true,
                kind === PseudoClassGlobal || kind === PseudoClassLocal,
                kind === PseudoClassIs || kind === PseudoClassWhere,
                false,
              ),
            );
            p.makeLocalSymbols = oldLocal;

            // Match the closing ")"
            if (r[1]) {
              let closeRange        = p.current().range;
              if (!p.expectWithMatchingLoc(TCloseParen, matchingLoc)) {
                closeRange = new Range(closeRange.loc, 0);
              }
              return [new SSPseudoClassWithSelectorList(r[0], new NthIndex(), kind), new Range(loc, closeRange.loc + closeRange.len - loc)];
            }
          }
          p.index = old;
        }
      }

      const args = p.convertTokens(p.parseAnyValue());
      let closeRange        = p.current().range;
      if (!p.expectWithMatchingLoc(TCloseParen, matchingLoc)) {
        closeRange = new Range(closeRange.loc, 0);
      }
      return [new SSPseudoClass(text, args, isElement), new Range(loc, closeRange.loc + closeRange.len - loc)];
    }

    let nameRange        = p.current().range;
    const name = p.decoded();
    const sel = new SSPseudoClass("", null, isElement);
    if (p.expect(TIdent)) {
      sel.name = name;

      // ":local .local_name :global .global_name {}"
      // ":local { .local_name { :global { .global_name {} } }"
      if (p.options.symbolMode !== symbolModeDisabled) {
        switch (name) {
          case "local":
            p.makeLocalSymbols = true;
            break;
          case "global":
            p.makeLocalSymbols = false;
            break;
        }
      }
    } else {
      nameRange = new Range(nameRange.loc, 0);
    }
    return [sel, new Range(loc, nameRange.loc + nameRange.len - loc)];
  },

  parseAnyValue()               {
    const p = this;
    // Reference: https://drafts.csswg.org/css-syntax-3/#typedef-declaration-value

    p.stack = []; // (Go reuses the allocated memory)
    const stack           = p.stack;
    const start = p.index;

    loop: for (;;) {
      switch (p.current().kind) {
        case TCloseParen:
        case TCloseBracket:
        case TCloseBrace: {
          const last = stack.length - 1;
          if (last < 0 || !p.peek(stack[last])) {
            break loop;
          }
          stack.pop();
          break;
        }

        case TSemicolon:
        case TDelimExclamation:
          if (stack.length === 0) {
            break loop;
          }
          break;

        case TOpenParen:
        case TFunction:
          stack.push(TCloseParen);
          break;

        case TOpenBracket:
          stack.push(TCloseBracket);
          break;

        case TOpenBrace:
          stack.push(TCloseBrace);
          break;

        case TEndOfFile:
          break loop;
      }

      p.advance();
    }

    const tokens               = p.tokens.slice(start, p.index);
    if (tokens.length === 0) {
      p.unexpected();
    }
    return tokens;
  },

  parseCombinator()             {
    const p = this;
    const t             = p.current();

    switch (t.kind) {
      case TDelimGreaterThan:
        p.advance();
        return new Combinator(t.range.loc, 62 /* > */);

      case TDelimPlus:
        p.advance();
        return new Combinator(t.range.loc, 43 /* + */);

      case TDelimTilde:
        p.advance();
        return new Combinator(t.range.loc, 126 /* ~ */);

      default:
        return COMBINATOR_NONE;
    }
  },

  parseNthIndex()                      {
    const p = this;
    // sign
    const none = 0;
    const negative = 1;
    const positive = 2;

    // Reference: https://drafts.csswg.org/css-syntax-3/#anb-microsyntax
    let t0             = p.current();
    let text0         = p.decoded();

    // Handle "even" and "odd"
    if (t0.kind === TIdent && (text0 === "even" || text0 === "odd")) {
      p.advance();
      p.eat(TWhitespace);
      return [new NthIndex("", text0), true];
    }

    // Handle a single number
    if (t0.kind === TNumber) {
      let bNeg = false;
      if (text0.startsWith("-")) {
        bNeg = true;
        text0 = text0.slice(1);
      } else if (text0.startsWith("+")) {
        text0 = text0.slice(1);
      }
      const r = parseInteger(text0);
      if (r[1]) {
        let b = r[0];
        if (bNeg) {
          b = "-" + b;
        }
        p.advance();
        p.eat(TWhitespace);
        return [new NthIndex("", b), true];
      }
      p.unexpected();
      return [new NthIndex(), false];
    }

    let aSign = none;
    if (p.eat(TDelimPlus)) {
      aSign = positive;
      t0 = p.current();
      text0 = p.decoded();
    }

    // Everything from here must be able to contain an "n"
    if (t0.kind !== TIdent && t0.kind !== TDimension) {
      p.unexpected();
      return [new NthIndex(), false];
    }

    // Check for a leading sign
    if (aSign === none) {
      if (text0.startsWith("-")) {
        aSign = negative;
        text0 = text0.slice(1);
      } else if (text0.startsWith("+")) {
        text0 = text0.slice(1);
      }
    }

    // The string must contain an "n"
    const n = text0.indexOf("n");
    if (n < 0) {
      p.unexpected();
      return [new NthIndex(), false];
    }

    // Parse the number before the "n"
    let a        ;
    if (n === 0) {
      if (aSign === negative) {
        a = "-1";
      } else {
        a = "1";
      }
    } else {
      const r = parseInteger(text0.slice(0, n));
      if (r[1]) {
        let aInt = r[0];
        if (aSign === negative) {
          aInt = "-" + aInt;
        }
        a = aInt;
      } else {
        p.unexpected();
        return [new NthIndex(), false];
      }
    }
    text0 = text0.slice(n + 1);

    // Parse the stuff after the "n"
    let bSign = none;
    if (text0.startsWith("-")) {
      text0 = text0.slice(1);
      const r = parseInteger(text0);
      if (r[1]) {
        p.advance();
        p.eat(TWhitespace);
        return [new NthIndex(a, "-" + r[0]), true];
      }
      bSign = negative;
    }
    if (text0 !== "") {
      p.unexpected();
      return [new NthIndex(), false];
    }
    p.advance();
    p.eat(TWhitespace);

    // Parse an optional sign delimiter
    if (bSign === none) {
      if (p.eat(TDelimMinus)) {
        bSign = negative;
        p.eat(TWhitespace);
      } else if (p.eat(TDelimPlus)) {
        bSign = positive;
        p.eat(TWhitespace);
      }
    }

    // Parse an optional trailing number
    const t1             = p.current();
    let text1         = p.decoded();
    if (t1.kind === TNumber) {
      if (bSign === none) {
        if (text1.startsWith("-")) {
          bSign = negative;
          text1 = text1.slice(1);
        } else if (text1.startsWith("+")) {
          text1 = text1.slice(1);
        }
      }
      const r = parseInteger(text1);
      if (r[1]) {
        let b = r[0];
        if (bSign === negative) {
          b = "-" + b;
        }
        p.advance();
        p.eat(TWhitespace);
        return [new NthIndex(a, b), true];
      }
    }

    // If there is a trailing sign, then there must also be a trailing number
    if (bSign !== none) {
      p.expect(TNumber);
      return [new NthIndex(), false];
    }

    return [new NthIndex(a, ""), true];
  },
};

// Go: func mergeCompoundSelectors(target *css_ast.CompoundSelector, source css_ast.CompoundSelector)
// ("target" is mutated; its subclass selector list is replaced, never
// appended to in place, since it may be shared with another selector)
export function mergeCompoundSelectors(target                  , source                  ) {
  // ".foo:local(&)" => "&.foo"
  if (source.nestingSelectorLocs.length > 0 && target.nestingSelectorLocs.length === 0) {
    target.nestingSelectorLocs = source.nestingSelectorLocs;
  }

  if (source.typeSelector !== null) {
    if (target.typeSelector === null) {
      // ".foo:local(div)" => "div.foo"
      target.typeSelector = source.typeSelector;
    } else {
      // "div:local(span)" => "div:is(span)"
      //
      // Note: All other implementations of this (Lightning CSS, PostCSS, and
      // Webpack) do something really weird here. They do this instead:
      //
      // "div:local(span)" => "divspan"
      //
      // But that just seems so obviously wrong that I'm not going to do that.
      target.subclassSelectors = target.subclassSelectors.concat([
        new SubclassSelector(
          new SSPseudoClassWithSelectorList([new ComplexSelector([new CompoundSelector(source.typeSelector)])], new NthIndex(), PseudoClassIs),
          source.typeSelector.range(),
        ),
      ]);
    }
  }

  // ".foo:local(.bar)" => ".foo.bar"
  target.subclassSelectors = target.subclassSelectors.concat(source.subclassSelectors);
}

export function containsLocalOrGlobalSelector(sel                 )          {
  for (let i = 0; i < sel.selectors.length; i++) {
    const s = sel.selectors[i];
    for (let j = 0; j < s.subclassSelectors.length; j++) {
      const pseudo = s.subclassSelectors[j].data;
      if (pseudo instanceof SSPseudoClass) {
        if (pseudo.name === "global" || pseudo.name === "local") {
          return true;
        }
      } else if (pseudo instanceof SSPseudoClassWithSelectorList) {
        if (pseudo.kind === PseudoClassGlobal || pseudo.kind === PseudoClassLocal) {
          return true;
        }
      }
    }
  }
  return false;
}

export function analyzeLeadingAmpersand(sel                 , isDeclarationContext         )         {
  if (sel.selectors.length > 1) {
    const first = sel.selectors[0];
    if (first.isSingleAmpersand()) {
      const second = sel.selectors[1];
      const rest = new ComplexSelector(sel.selectors.slice(1));
      if (second.combinator.byte === 0 && rest.containsNestingCombinator()) {
        // ".foo { & &.bar {} }" => ".foo { & &.bar {} }"
        // ".foo { & .bar:not(& .baz) {} }" => ".foo { & .bar:not(& .baz) {} }"
        // The specification says: "If a selector in the <relative-selector-list>
        // does not start with a combinator but does contain the nesting selector,
        // it is interpreted as a non-relative selector." So we don't want to
        // remove the leading "&" here as that would change the meaning to a
        // non-relative selector. See: https://www.w3.org/TR/css-nesting-1/
      } else if (second.combinator.byte !== 0 || second.typeSelector === null || !isDeclarationContext) {
        // "& + div {}" => "+ div {}"
        // "& div {}" => "div {}"
        // ".foo { & + div {} }" => ".foo { + div {} }"
        // ".foo { & + &.bar {} }" => ".foo { + &.bar {} }"
        // ".foo { & :hover {} }" => ".foo { :hover {} }"
        return canAlwaysRemoveLeadingAmpersand;
      } else {
        // ".foo { & div {} }"
        // ".foo { .bar, & div {} }" => ".foo { .bar, div {} }"

        // The first iteration of CSS nesting didn't support an implicit "&" if
        // the selector started with an identifier. This was done to avoid
        // confusion with declarations in the parser, as the parser would
        // otherwise need unbounded lookahead to distinguish between the two.
        //
        // However, this edge case is commonly encountered and it's confusing
        // that it doesn't work. So the CSS working group later added unbounded
        // lookahead to fix it: https://github.com/w3c/csswg-drafts/issues/7961.
        //
        // We deliberately don't take advantage of that newest syntax addition
        // here so that our output still works in browsers before that newest
        // syntax addition. We still keep a leading "&" before identifiers.
        return canRemoveLeadingAmpersandIfNotFirst;
      }
    }
  } else {
    // "& {}" => "& {}"
  }
  return cannotRemoveLeadingAmpersand;
}

// Returns [text, ok]
export function parseInteger(text        )                    {
  const n = text.length;
  if (n === 0) {
    return ["", false];
  }

  // Trim leading zeros
  let start = 0;
  while (start < n && text.charCodeAt(start) === 48 /* 0 */) {
    start++;
  }

  // Make sure remaining characters are digits
  if (start === n) {
    return ["0", true];
  }
  for (let i = start; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c < 48 || c > 57) {
      return ["", false];
    }
  }
  return [text.slice(start), true];
}
// generated from css_parser_selector.mts by tools/ts-build.mjs; edit that file
