// Port of internal/css_parser/css_parser.go and css_parser_media.go
// (esbuild 0.28.2). See CONVENTIONS.md.
//
// This is mostly a normal CSS parser with one exception: the addition of
// support for parsing https://drafts.csswg.org/css-nesting-1/.
//
// All "func (p *parser) X" methods of the css_parser package live on the one
// class "parser" defined here. The methods of the other files are mixed in
// from css_parser_selector.mjs (selectorMethods), css_nesting.mjs
// (nestingMethods), css_decls.mjs (declsMethods), css_decls_color.mjs
// (colorMethods) and css_reduce_calc.mjs (calcMethods).
//
// JS port notes:
// - Go sub-slices of p.tokens ("p.tokens[a:b]") are passed as index ranges
//   to convertTokensHelperAt (JS-only: avoids copying token arrays and the
//   quadratic "tokens = tokens[1:]" of the recursive helper).
// - Multiple return values are arrays read by index.
import {
  Range,
  Path,
  LineColumnTracker,
  Warning,
  Msg,
  MsgData,
} from "./logger.mjs";
                                                
import {
  MsgID_CSS_CSSSyntaxError,
  MsgID_CSS_InvalidAtCharset,
  MsgID_CSS_InvalidAtImport,
  MsgID_CSS_InvalidAtLayer,
  MsgID_CSS_InvalidCalc,
  MsgID_CSS_UnsupportedAtCharset,
  MsgID_CSS_UnsupportedAtNamespace,
  MsgID_CSS_UnsupportedCSSProperty,
} from "./logger.mjs";
import {
  ImportRecord,
  ImportAt,
  ImportURL,
  IsUnused,
  InvalidRef,
  LocRef,
  Symbol as AstSymbol,
  SymbolMap,
  SymbolLocalCSS,
  SymbolGlobalCSS,
  makeRef,
  refInner,
  newCharFreq,
  charFreqScan,
} from "./ast.mjs";
import { LoaderGlobalCSS, LoaderLocalCSS } from "./config.mjs";
import {
  tokenize,
  Options as LexerOptions,
  DidWarnAboutSingleLineComment,
  tIsNumeric,
  TEndOfFile,
  TAtKeyword,
  TCDC,
  TCDO,
  TCloseBrace,
  TCloseBracket,
  TCloseParen,
  TColon,
  TComma,
  TDelimDot,
  TDelimEquals,
  TDelimExclamation,
  TDelimGreaterThan,
  TDelimLessThan,
  TDelimMinus,
  TDelimPlus,
  TDelimSlash,
  TDimension,
  TFunction,
  TIdent,
  TNumber,
  TOpenBrace,
  TOpenBracket,
  TOpenParen,
  TPercentage,
  TSemicolon,
  TString,
  TSymbol,
  TURL,
  TWhitespace,
  tString,
  TBadURL,
  TUnterminatedString,
} from "./css_lexer.mjs";
                                                                                    
import { Token as LexerTokenClass } from "./css_lexer.mjs";
import {
  AST,
  Token,
  Rule,
  MediaQuery,
  CrossFileEqualityCheck,
  ImportConditions,
  KeyframeBlock,
  RAtCharset,
  RAtImport,
  RAtKeyframes,
  RKnownAt,
  RUnknownAt,
  RSelector,
  RQualified,
  RDeclaration,
  RBadDeclaration,
  RComment,
  RAtLayer,
  RAtMedia,
  RAtScope,
  MQType,
  MQNot,
  MQBinary,
  MQArbitraryTokens,
  MQPlainOrBoolean,
  MQRange,
  MQTypeOpNone,
  MQTypeOpNot,
  MQTypeOpOnly,
  MQBinaryOpAnd,
  MQBinaryOpOr,
  MQCmpNone,
  MQCmpEq,
  MQCmpLt,
  MQCmpLe,
  MQCmpGt,
  MQCmpGe,
  mqCmpDir,
  mqCmpFlip,
  mqCmpReverse,
  SSClass,
  SSAttribute,
  SSPseudoClass,
  SSPseudoClassWithSelectorList,
  PseudoClassIs,
  PseudoClassWhere,
  WhitespaceBefore,
  WhitespaceAfter,
  KnownDeclarations,
  DUnknown,
  maybeCorrectDeclarationTypo,
  rulesEqual,
  mediaQueriesEqual,
} from "./css_ast.mjs";
                                                                                    
import { cssFeatureHas, Nesting, MediaRange } from "./compat_css.mjs";
import { goToLower, goEqualFold, goQuote } from "./gostd.mjs";
import { selectorMethods, parseSelectorOpts } from "./css_parser_selector.mjs";
import { nestingMethods } from "./css_nesting.mjs";
import { declsMethods, composesContext, isInvalidAnimationName } from "./css_decls.mjs";
import { colorMethods } from "./css_decls_color.mjs";
import { calcMethods } from "./css_reduce_calc.mjs";

// The parser methods of the other css_parser files (mixed into
// parser.prototype, see applyMixins below)
                                                                                                                                    
                                               

// ---------------------------------------------------------------------------
// Options

// symbolMode
export const symbolModeDisabled = 0;
export const symbolModeGlobal = 1;
export const symbolModeLocal = 2;

// Go: Options with the embedded optionsThatSupportStructuralEquality fields
// flattened
export class Options {
                                                    
                                    
                                         
                                
                                    
                                     
                             
  constructor(
    cssPrefixData                             = null,
    originalTargetEnv = "",
    unsupportedCSSFeatures = 0,
    minifySyntax = false,
    minifyWhitespace = false,
    minifyIdentifiers = false,
    symbolMode = symbolModeDisabled,
  ) {
    this.cssPrefixData = cssPrefixData;
    this.originalTargetEnv = originalTargetEnv;
    this.unsupportedCSSFeatures = unsupportedCSSFeatures;
    this.minifySyntax = minifySyntax;
    this.minifyWhitespace = minifyWhitespace;
    this.minifyIdentifiers = minifyIdentifiers;
    this.symbolMode = symbolMode;
  }

  equal(b         )          {
    const a = this;

    // Compare "optionsThatSupportStructuralEquality"
    if (
      a.originalTargetEnv !== b.originalTargetEnv ||
      a.unsupportedCSSFeatures !== b.unsupportedCSSFeatures ||
      a.minifySyntax !== b.minifySyntax ||
      a.minifyWhitespace !== b.minifyWhitespace ||
      a.minifyIdentifiers !== b.minifyIdentifiers ||
      a.symbolMode !== b.symbolMode
    ) {
      return false;
    }

    // Compare "cssPrefixData"
    const aSize = a.cssPrefixData === null ? 0 : a.cssPrefixData.size;
    const bSize = b.cssPrefixData === null ? 0 : b.cssPrefixData.size;
    if (aSize !== bSize) {
      return false;
    }
    if (a.cssPrefixData !== null) {
      for (const [k, va] of a.cssPrefixData) {
        const vb = b.cssPrefixData === null ? undefined : b.cssPrefixData.get(k);
        if (vb === undefined || va !== vb) {
          return false;
        }
      }
    }
    // (Go's second loop checks b's keys against b itself, which always passes)

    return true;
  }
}

export function optionsFromConfig(loader        , options     )          {
  let symbolMode = symbolModeDisabled;
  switch (loader) {
    case LoaderGlobalCSS:
      symbolMode = symbolModeGlobal;
      break;
    case LoaderLocalCSS:
      symbolMode = symbolModeLocal;
      break;
  }

  return new Options(
    options.cssPrefixData === undefined ? null : options.cssPrefixData,
    options.originalTargetEnv,
    options.unsupportedCSSFeatures,
    options.minifySyntax,
    options.minifyWhitespace,
    options.minifyIdentifiers,
    symbolMode,
  );
}

// ---------------------------------------------------------------------------
// parser

export class parser {
  ;                
  ;                      
  ;                            
  ;                            
  ;                                     
  ;                       
  ;                                     
  ;                            
  ;                                       
  ;                              
  ;                                       
  ;                                        
  ;                                            // (Go: nil map until the first warning)
  ;                                  
  ;                                        
  ;                                          
  ;                                           
  ;                                
  ;                              
  ;                     
  ;                                 
  ;                                 
  ;                         
  ;                        
  ;                                 
  ;                                 
  ;                                

  // JS-only: the synthetic end-of-file token returned by at() past the end
  ;                            

  constructor(log     , source        , options         , tokens              , allComments         , legalComments                ) {
    this.log = log;
    this.source = source;
    this.tokens = tokens;
    this.allComments = allComments;
    this.legalComments = legalComments;
    this.stack = [];
    this.importRecords = [];
    this.symbols = [];
    this.composes = new Map();
    this.localSymbols = [];
    this.localScope = new Map();
    this.globalScope = new Map();
    this.nestingWarnings = null;
    this.tracker = new LineColumnTracker(source);
    this.enclosingAtMedia = [];
    this.layersPreImport = null;
    this.layersPostImport = null;
    this.enclosingLayer = [];
    this.anonLayerCount = 0;
    this.index = 0;
    this.legalCommentIndex = 0;
    this.inSelectorSubtree = 0;
    this.prevError = -1;
    this.options = options;
    this.nestingIsPresent = false;
    this.makeLocalSymbols = options.symbolMode === symbolModeLocal;
    this.hasSeenAtImport = false;
    this.eofToken = new LexerTokenClass(source.contents.length, 0, 0, TEndOfFile, 0);
  }

  // Compute a character frequency histogram for everything that's not a bound
  // symbol. This is used to modify how minified names are generated for slightly
  // better gzip compression. Even though it's a very small win, we still do it
  // because it's simple to do and very cheap to compute.
  computeCharacterFrequency()                    {
    const p = this;
    if (!p.options.minifyIdentifiers) {
      return null;
    }

    // Add everything in the file to the histogram
    const charFreq = newCharFreq();
    charFreqScan(charFreq, p.source.contents, 1);

    // Subtract out all comments
    for (let i = 0; i < p.allComments.length; i++) {
      charFreqScan(charFreq, p.source.textForRange(p.allComments[i]), -1);
    }

    // Subtract out all import paths
    for (let i = 0; i < p.importRecords.length; i++) {
      const record = p.importRecords[i];
      if (record.sourceIndex < 0) {
        charFreqScan(charFreq, record.path.text, -1);
      }
    }

    // Subtract out all symbols that will be minified
    for (let i = 0; i < p.symbols.length; i++) {
      const symbol = p.symbols[i];
      if (symbol.kind === SymbolLocalCSS) {
        charFreqScan(charFreq, symbol.originalName, -symbol.useCountEstimate);
      }
    }

    return charFreq;
  }

  advance() {
    if (this.index < this.tokens.length) {
      this.index++;
    }
  }

  at(index        )             {
    if (index < this.tokens.length) {
      return this.tokens[index];
    }
    return this.eofToken;
  }

  current()             {
    return this.at(this.index);
  }

  next()             {
    return this.at(this.index + 1);
  }

  raw()         {
    const t = this.current();
    return this.source.contents.slice(t.range.loc, t.range.loc + t.range.len);
  }

  decoded()         {
    return this.current().decodedText(this.source.contents);
  }

  peek(kind        )          {
    return kind === this.current().kind;
  }

  eat(kind        )          {
    if (this.peek(kind)) {
      this.advance();
      return true;
    }
    return false;
  }

  expect(kind        )          {
    return this.expectWithMatchingLoc(kind, -1);
  }

  expectWithMatchingLoc(kind        , matchingLoc        )          {
    const p = this;
    if (p.eat(kind)) {
      return true;
    }
    let t = p.current();
    if ((t.flags & DidWarnAboutSingleLineComment) !== 0) {
      return false;
    }

    let text        ;
    let suggestion = "";
    let notes                   = null;
    // (Go's "t" is a copy whose range may be changed: "tRange")
    let tRange = t.range;

    const expected = tString(kind);
    if (expected.startsWith('"') && expected.endsWith('"')) {
      suggestion = expected.slice(1, expected.length - 1);
    }

    if ((kind === TSemicolon || kind === TColon) && p.index > 0 && p.at(p.index - 1).kind === TWhitespace) {
      // Have a nice error message for forgetting a trailing semicolon or colon
      text = "Expected " + expected;
      t = p.at(p.index - 1);
      tRange = t.range;
    } else if ((kind === TCloseBrace || kind === TCloseBracket || kind === TCloseParen) && matchingLoc !== -1 && matchingLoc + 1 <= p.source.contents.length) {
      // Have a nice error message for forgetting a closing brace/bracket/parenthesis
      const c = p.source.contents.slice(matchingLoc, matchingLoc + 1);
      text = "Expected " + expected + " to go with " + goQuote(c);
      notes = [p.tracker.msgData(new Range(matchingLoc, 1), "The unbalanced " + goQuote(c) + " is here:")];
    } else {
      switch (t.kind) {
        case TEndOfFile:
        case TWhitespace:
          text = "Expected " + expected + " but found " + tString(t.kind);
          tRange = new Range(tRange.loc, 0);
          break;
        case TBadURL:
        case TUnterminatedString:
          text = "Expected " + expected + " but found " + tString(t.kind);
          break;
        default:
          text = "Expected " + expected + " but found " + goQuote(p.raw());
      }
    }

    if (tRange.loc > p.prevError) {
      const data = p.tracker.msgData(tRange, text);
      data.location.suggestion = suggestion;
      p.log.addMsgID(MsgID_CSS_CSSSyntaxError, new Msg(notes, "", data, Warning));
      p.prevError = tRange.loc;
    }
    return false;
  }

  unexpected() {
    const p = this;
    const t = p.current();
    if (t.range.loc > p.prevError && (t.flags & DidWarnAboutSingleLineComment) === 0) {
      let text        ;
      let tRange = t.range;
      switch (t.kind) {
        case TEndOfFile:
        case TWhitespace:
          text = "Unexpected " + tString(t.kind);
          tRange = new Range(tRange.loc, 0);
          break;
        case TBadURL:
        case TUnterminatedString:
          text = "Unexpected " + tString(t.kind);
          break;
        default:
          text = "Unexpected " + goQuote(p.raw());
      }
      p.log.addID(MsgID_CSS_CSSSyntaxError, Warning, p.tracker, tRange, text);
      p.prevError = t.range.loc;
    }
  }

  symbolForName(loc        , name        )         {
    const p = this;
    let kind        ;
    let scope                     ;

    if (p.makeLocalSymbols) {
      kind = SymbolLocalCSS;
      scope = p.localScope;
    } else {
      kind = SymbolGlobalCSS;
      scope = p.globalScope;
    }

    let entry = scope.get(name);
    if (entry === undefined) {
      entry = new LocRef(loc, makeRef(p.source.index, p.symbols.length));
      p.symbols.push(new AstSymbol(null, name, InvalidRef, 0, -1, -1, 0, kind));
      scope.set(name, entry);
      if (kind === SymbolLocalCSS) {
        p.localSymbols.push(entry);
      }
    }

    p.symbols[refInner(entry.ref)].useCountEstimate++;
    return entry;
  }

  recordAtLayerRule(layers            ) {
    const p = this;
    if (p.anonLayerCount > 0) {
      return;
    }

    for (let i = 0; i < layers.length; i++) {
      let layer = layers[i];
      if (p.enclosingLayer.length > 0) {
        layer = p.enclosingLayer.concat(layer);
      }
      if (p.layersPostImport === null) {
        p.layersPostImport = [];
      }
      p.layersPostImport.push(layer);
    }
  }

  parseListOfRules(context             )         {
    const p = this;
    const atRuleContext_ = new atRuleContext();
    if (context.isTopLevel) {
      atRuleContext_.charsetValidity = atRuleValid;
      atRuleContext_.importValidity = atRuleValid;
      atRuleContext_.isTopLevel = true;
    }
    let rules         = [];
    let didFindAtImport = false;

    loop: for (;;) {
      if (context.isTopLevel) {
        p.nestingIsPresent = false;
      }

      // If there are any legal comments immediately before the current token,
      // turn them all into comment rules and append them to the current rule list
      while (p.legalCommentIndex < p.legalComments.length) {
        const comment = p.legalComments[p.legalCommentIndex];
        if (comment.tokenIndexAfter > p.index) {
          break;
        }
        if (comment.tokenIndexAfter === p.index) {
          rules.push(new Rule(new RComment(comment.text), comment.loc));
        }
        p.legalCommentIndex++;
      }

      const kind = p.current().kind;
      if (kind === TEndOfFile) {
        break loop;
      } else if (kind === TCloseBrace) {
        if (!context.isTopLevel) {
          break loop;
        }
      } else if (kind === TWhitespace) {
        p.advance();
        continue;
      } else if (kind === TAtKeyword) {
        const rule = p.parseAtRule(atRuleContext_);

        // Disallow "@charset" and "@import" after other rules
        if (context.isTopLevel) {
          const r = rule.data;
          if (r instanceof RAtCharset) {
            // This doesn't invalidate anything because it always comes first
          } else if (r instanceof RAtImport) {
            didFindAtImport = true;
            if (atRuleContext_.charsetValidity === atRuleValid) {
              atRuleContext_.afterLoc = rule.loc;
              atRuleContext_.charsetValidity = atRuleInvalidAfter;
            }
          } else if (r instanceof RAtLayer) {
            if (atRuleContext_.charsetValidity === atRuleValid) {
              atRuleContext_.afterLoc = rule.loc;
              atRuleContext_.charsetValidity = atRuleInvalidAfter;
            }

            // From the specification: "Note: No @layer rules are allowed between
            // @import and @namespace rules. Any @layer rule that comes after an
            // @import or @namespace rule will cause any subsequent @import or
            // @namespace rules to be ignored."
            if (atRuleContext_.importValidity === atRuleValid && (r.rules !== null || didFindAtImport)) {
              atRuleContext_.afterLoc = rule.loc;
              atRuleContext_.charsetValidity = atRuleInvalidAfter;
              atRuleContext_.importValidity = atRuleInvalidAfter;
            }
          } else {
            if (atRuleContext_.importValidity === atRuleValid) {
              atRuleContext_.afterLoc = rule.loc;
              atRuleContext_.charsetValidity = atRuleInvalidAfter;
              atRuleContext_.importValidity = atRuleInvalidAfter;
            }
          }
        }

        // Lower CSS nesting if it's not supported (but only at the top level)
        if (p.nestingIsPresent && cssFeatureHas(p.options.unsupportedCSSFeatures, Nesting) && context.isTopLevel) {
          rules = p.lowerNestingInRule(rule, rules);
        } else {
          rules.push(rule);
        }
        continue;
      } else if (kind === TCDO || kind === TCDC) {
        if (context.isTopLevel) {
          p.advance();
          continue;
        }
      }

      if (atRuleContext_.importValidity === atRuleValid) {
        atRuleContext_.afterLoc = p.current().range.loc;
        atRuleContext_.charsetValidity = atRuleInvalidAfter;
        atRuleContext_.importValidity = atRuleInvalidAfter;
      }

      // Note: CSS recently changed to parse and discard declarations
      // here instead of treating them as the start of a qualified rule.
      // See also: https://github.com/w3c/csswg-drafts/issues/8834
      if (!context.isTopLevel) {
        const scan = p.scanForEndOfRule();
        if (scan[0] === endOfRuleSemicolon) {
          const index = scan[1];
          const tokens = p.convertTokensAt(p.index, index);
          rules.push(new Rule(new RBadDeclaration(tokens), p.current().range.loc));
          p.index = index + 1;
          continue;
        }
      }

      let rule      ;
      if (context.parseSelectors) {
        rule = p.parseSelectorRule(context.isTopLevel, new parseSelectorOpts());
      } else {
        rule = p.parseQualifiedRule(new parseQualifiedRuleOpts(false, context.isTopLevel, false));
      }

      // Lower CSS nesting if it's not supported (but only at the top level)
      if (p.nestingIsPresent && cssFeatureHas(p.options.unsupportedCSSFeatures, Nesting) && context.isTopLevel) {
        rules = p.lowerNestingInRule(rule, rules);
      } else {
        rules.push(rule);
      }
    }

    if (p.options.minifySyntax) {
      rules = p.mangleRules(rules, context.isTopLevel);
    }
    return rules;
  }

  parseListOfDeclarations(opts                        )         {
    const p = this;
    let list         = [];
    let foundNesting = false;

    for (;;) {
      switch (p.current().kind) {
        case TWhitespace:
        case TSemicolon:
          p.advance();
          break;

        case TEndOfFile:
        case TCloseBrace:
          list = p.processDeclarations(list, opts.composesContext);
          if (p.options.minifySyntax) {
            list = p.mangleRules(list, false /* isTopLevel */);

            // Pull out all unnecessarily-nested declarations and stick them at the end
            if (opts.canInlineNoOpNesting) {
              // "a { & { x: y } }" => "a { x: y }"
              // "a { & { b: c } d: e }" => "a { d: e; b: c }"
              if (foundNesting) {
                let inlineDecls         = [];
                let n = 0;
                for (let i = 0; i < list.length; i++) {
                  const rule = list[i];
                  const r = rule.data;
                  if (r instanceof RSelector && r.selectors.length === 1) {
                    const sel = r.selectors[0];
                    if (sel.selectors.length === 1 && sel.selectors[0].isSingleAmpersand()) {
                      for (let j = 0; j < r.rules.length; j++) {
                        inlineDecls.push(r.rules[j]);
                      }
                      continue;
                    }
                  }
                  list[n] = rule;
                  n++;
                }
                list.length = n;
                for (let j = 0; j < inlineDecls.length; j++) {
                  list.push(inlineDecls[j]);
                }
              }
            } else {
              // "a, b::before { & { x: y } }" => "a, b::before { & { x: y } }"
            }
          }
          return list;

        case TAtKeyword:
          if (p.inSelectorSubtree > 0) {
            p.nestingIsPresent = true;
          }
          list.push(p.parseAtRule(new atRuleContext(0, atRuleInvalid, atRuleInvalid, opts.canInlineNoOpNesting, true, false)));
          break;

        // Reference: https://drafts.csswg.org/css-nesting-1/
        default: {
          const scan = p.scanForEndOfRule();
          if (scan[0] === endOfRuleOpenBrace) {
            p.nestingIsPresent = true;
            foundNesting = true;
            const selOpts = new parseSelectorOpts();
            selOpts.isDeclarationContext = true;
            selOpts.composesContext = opts.composesContext;
            const rule = p.parseSelectorRule(false, selOpts);

            // If this rule was a single ":global" or ":local", inline it here. This
            // is handled differently than a bare "&" with normal CSS nesting because
            // that would be inlined at the end of the parent rule's body instead,
            // which is probably unexpected (e.g. it would trip people up when trying
            // to write rules in a specific order).
            const sel = rule.data;
            if (sel instanceof RSelector && sel.selectors.length === 1) {
              const first = sel.selectors[0];
              if (first.selectors.length === 1) {
                const first2 = first.selectors[0];
                if (first2.wasEmptyFromLocalOrGlobal && first2.isSingleAmpersand()) {
                  for (let j = 0; j < sel.rules.length; j++) {
                    list.push(sel.rules[j]);
                  }
                  continue;
                }
              }
            }

            list.push(rule);
          } else {
            list.push(p.parseDeclaration());
          }
        }
      }
    }
  }

  mangleRules(rules        , isTopLevel         )         {
    const p = this;

    // Remove empty rules
    let mangledRules         = [];
    let prevNonComment           = null;
    next: for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      let nextNonComment           = rule.data;

      const r = rule.data;
      if (r instanceof RAtKeyframes) {
        // Do not remove empty "@keyframe foo {}" rules. Even empty rules still
        // dispatch JavaScript animation events, so removing them changes
        // behavior: https://bugzilla.mozilla.org/show_bug.cgi?id=1004377.
      } else if (r instanceof RAtLayer) {
        if ((r.rules === null || r.rules.length === 0) && r.names.length > 0) {
          // Do not remove empty "@layer foo {}" rules. The specification says:
          // "Cascade layers are sorted by the order in which they first are
          // declared, with nested layers grouped within their parent layers
          // before any unlayered rules." So removing empty rules could change
          // the order in which they are first declared, and is therefore invalid.
          //
          // We can turn "@layer foo {}" into "@layer foo;" to be shorter. But
          // don't collapse anonymous "@layer {}" into "@layer;" because that is
          // a syntax error.
          r.rules = null;
        } else if (r.rules !== null && r.rules.length === 1 && r.names.length === 1) {
          // Only collapse layers if each layer has exactly one name
          const r2 = r.rules[0].data;
          if (r2 instanceof RAtLayer && r2.names.length === 1) {
            // "@layer a { @layer b {} }" => "@layer a.b;"
            // "@layer a { @layer b { c {} } }" => "@layer a.b { c {} }"
            // (Go appends to r.Names[0]; other holders of that slice, like
            // p.layersPostImport, never see the new elements)
            r.names[0] = r.names[0].concat(r2.names[0]);
            r.rules = r2.rules;
          }
        }
      } else if (r instanceof RKnownAt) {
        if ((r.rules === null || r.rules.length === 0) && atKnownRuleCanBeRemovedIfEmpty.has(r.atToken)) {
          continue;
        }
      } else if (r instanceof RAtMedia) {
        if (r.rules.length === 0) {
          continue;
        }

        // Unwrap "@media" rules that duplicate conditions from a parent "@media"
        // rule. This is unlikely to be authored manually but can be automatically
        // generated when using a CSS framework such as Tailwind.
        //
        //   @media (min-width: 1024px) {
        //     .md\:class {
        //       color: red;
        //     }
        //     @media (min-width: 1024px) {
        //       .md\:class {
        //         color: red;
        //       }
        //     }
        //   }
        //
        // This converts that code into the following:
        //
        //   @media (min-width: 1024px) {
        //     .md\:class {
        //       color: red;
        //     }
        //     .md\:class {
        //       color: red;
        //     }
        //   }
        //
        // Which can then be mangled further.
        for (let j = 0; j < p.enclosingAtMedia.length; j++) {
          if (mediaQueriesEqual(r.queries, p.enclosingAtMedia[j], null)) {
            for (let k = 0; k < r.rules.length; k++) {
              mangledRules.push(r.rules[k]);
            }
            continue next;
          }
        }
      } else if (r instanceof RSelector) {
        if (r.rules.length === 0) {
          continue;
        }

        // Merge adjacent selectors with the same content
        // "a { color: red; } b { color: red; }" => "a, b { color: red; }"
        if (prevNonComment !== null) {
          const prev = prevNonComment;
          if (prev instanceof RSelector && rulesEqual(r.rules, prev.rules, null) && isSafeSelectors(r.selectors) && isSafeSelectors(prev.selectors)) {
            // (Go appends to prev.Selectors; copy so that no other holder of
            // the array observes the new elements)
            let prevSelectors = prev.selectors;
            let copied = false;
            nextSelector: for (let j = 0; j < r.selectors.length; j++) {
              const sel = r.selectors[j];
              for (let k = 0; k < prevSelectors.length; k++) {
                if (sel.equal(prevSelectors[k], null)) {
                  // Don't add duplicate selectors more than once
                  continue nextSelector;
                }
              }
              if (!copied) {
                prevSelectors = prevSelectors.slice();
                copied = true;
              }
              prevSelectors.push(sel);
            }
            prev.selectors = prevSelectors;
            continue;
          }
        }
      } else if (r instanceof RComment) {
        nextNonComment = null;
      }

      if (nextNonComment !== null) {
        prevNonComment = nextNonComment;
      }

      mangledRules.push(rule);
    }

    // Mangle non-top-level rules using a back-to-front pass. Top-level rules
    // will be mangled by the linker instead for cross-file rule mangling.
    if (!isTopLevel) {
      const remover = makeDeadRuleMangler(zeroSymbolMap());
      mangledRules = remover.removeDeadRulesInPlace(p.source.index, mangledRules, p.importRecords);
    }

    return mangledRules;
  }

  // Returns [text, range, ok]
  parseURLOrString()                           {
    const p = this;
    const t = p.current();
    switch (t.kind) {
      case TString: {
        const text = p.decoded();
        p.advance();
        return [text, t.range, true];
      }

      case TURL: {
        const text = p.decoded();
        p.advance();
        return [text, t.range, true];
      }

      case TFunction:
        if (goEqualFold(p.decoded(), "url")) {
          const matchingLoc = p.current().range.loc + p.current().range.len - 1;
          let i = p.index + 1;

          // Skip over whitespace
          while (p.at(i).kind === TWhitespace) {
            i++;
          }

          // Consume a string
          if (p.at(i).kind === TString) {
            const stringIndex = i;
            i++;

            // Skip over whitespace
            while (p.at(i).kind === TWhitespace) {
              i++;
            }

            // Consume a closing parenthesis
            const close = p.at(i).kind;
            if (close === TCloseParen || close === TEndOfFile) {
              const t = p.at(stringIndex);
              const text = t.decodedText(p.source.contents);
              p.index = i;
              p.expectWithMatchingLoc(TCloseParen, matchingLoc);
              return [text, t.range, true];
            }
          }
        }
        break;
    }

    return ["", new Range(0, 0), false];
  }

  // Returns [url, range, ok]
  expectURLOrString()                           {
    const r = this.parseURLOrString();
    if (!r[2]) {
      this.expect(TURL);
    }
    return r;
  }

  parseAtRule(context               )       {
    const p = this;

    // Parse the name
    const atToken = p.decoded();
    const atRange = p.current().range;
    const lowerAtToken = goToLower(atToken);
    let kind = specialAtRules.get(lowerAtToken);
    if (kind === undefined) {
      kind = atRuleUnknown;
    }
    p.advance();

    // Parse the prelude
    const preludeStart = p.index;
    abortRuleParser: switch (lowerAtToken) {
      case "charset":
        switch (context.charsetValidity) {
          case atRuleInvalid:
            p.log.addID(MsgID_CSS_InvalidAtCharset, Warning, p.tracker, atRange, '"@charset" must be the first rule in the file');
            break;

          case atRuleInvalidAfter:
            p.log.addIDWithNotes(MsgID_CSS_InvalidAtCharset, Warning, p.tracker, atRange, '"@charset" must be the first rule in the file', [
              p.tracker.msgData(new Range(context.afterLoc, 0), 'This rule cannot come before a "@charset" rule'),
            ]);
            break;

          case atRuleValid:
            kind = atRuleEmpty;
            p.expect(TWhitespace);
            if (p.peek(TString)) {
              const encoding = p.decoded();
              if (!goEqualFold(encoding, "UTF-8")) {
                p.log.addID(MsgID_CSS_UnsupportedAtCharset, Warning, p.tracker, p.current().range, '"UTF-8" will be used instead of unsupported charset ' + goQuote(encoding));
              }
              p.advance();
              p.expect(TSemicolon);
              return new Rule(new RAtCharset(encoding), atRange.loc);
            }
            p.expect(TString);
            break;
        }
        break;

      case "import":
        switch (context.importValidity) {
          case atRuleInvalid:
            p.log.addID(MsgID_CSS_InvalidAtImport, Warning, p.tracker, atRange, '"@import" is only valid at the top level');
            break;

          case atRuleInvalidAfter:
            p.log.addIDWithNotes(MsgID_CSS_InvalidAtImport, Warning, p.tracker, atRange, 'All "@import" rules must come first', [
              p.tracker.msgData(new Range(context.afterLoc, 0), 'This rule cannot come before an "@import" rule'),
            ]);
            break;

          case atRuleValid: {
            kind = atRuleEmpty;
            p.eat(TWhitespace);
            const u = p.expectURLOrString();
            if (u[2]) {
              const path = u[0];
              const r = u[1];
              const conditions = new ImportConditions();
              let importConditionsStart = p.index;

              // Parse the optional "layer()"
              p.eat(TWhitespace);
              if ((p.peek(TIdent) || p.peek(TFunction)) && goEqualFold(p.decoded(), "layer")) {
                p.parseComponentValue();
                conditions.layers = p.convertTokensAt(importConditionsStart, p.index);
                importConditionsStart = p.index;

                // Remove leading and trailing whitespace
                if (conditions.layers.length > 0) {
                  conditions.layers[0].whitespace &= ~(WhitespaceBefore | WhitespaceAfter);
                }
              }

              // Parse the optional "supports()"
              p.eat(TWhitespace);
              if (p.peek(TFunction) && goEqualFold(p.decoded(), "supports")) {
                p.parseComponentValue();
                conditions.supports = p.convertTokensAt(importConditionsStart, p.index);
                importConditionsStart = p.index;

                // Remove leading and trailing whitespace
                if (conditions.supports.length > 0) {
                  conditions.supports[0].whitespace &= ~(WhitespaceBefore | WhitespaceAfter);
                }
              }

              // Parse the optional media query list
              conditions.queries = p.parseMediaQueryListUntil(stopAtImportConditionsEnd);
              if (p.peek(TOpenBrace)) {
                break abortRuleParser; // Avoid parsing an invalid "@import" rule
              }

              // Check whether any import conditions are present
              let importConditions                          = null;
              if (conditions.layers.length > 0 || conditions.supports.length > 0 || conditions.queries.length > 0) {
                importConditions = conditions;
              }

              p.expect(TSemicolon);
              const importRecordIndex = p.importRecords.length;
              const record = new ImportRecord();
              record.kind = ImportAt;
              record.path = new Path(path);
              record.range = r;
              p.importRecords.push(record);

              // Fill in the pre-import layers once we see the first "@import"
              if (!p.hasSeenAtImport) {
                p.hasSeenAtImport = true;
                p.layersPreImport = p.layersPostImport;
                p.layersPostImport = null;
              }

              return new Rule(new RAtImport(importConditions, importRecordIndex), atRange.loc);
            }
            break;
          }
        }
        break;

      case "keyframes":
      case "-webkit-keyframes":
      case "-moz-keyframes":
      case "-ms-keyframes":
      case "-o-keyframes": {
        p.eat(TWhitespace);
        const nameLoc = p.current().range.loc;
        let name = "";

        if (p.peek(TIdent)) {
          name = p.decoded();
          if (isInvalidAnimationName(name)) {
            const msg = new Msg(
              [new MsgData(null, null, "You can put " + goQuote(name) + " in quotes to prevent it from becoming a CSS keyword.")],
              "",
              p.tracker.msgData(p.current().range, "Cannot use " + goQuote(name) + ' as a name for "@keyframes" without quotes'),
              Warning,
              MsgID_CSS_CSSSyntaxError,
            );
            msg.data.location.suggestion = goQuote(name);
            p.log.addMsg(msg);
            break abortRuleParser;
          }
          p.advance();
        } else if (p.peek(TString)) {
          // Note: Strings as names is allowed in the CSS specification and works in
          // Firefox and Safari but Chrome has strangely decided to deliberately not
          // support this. We always turn all string names into identifiers to avoid
          // them silently breaking in Chrome.
          name = p.decoded();
          p.advance();
          if (!p.makeLocalSymbols && isInvalidAnimationName(name)) {
            break abortRuleParser;
          }
        } else if (!p.expect(TIdent)) {
          break abortRuleParser;
        }

        p.eat(TWhitespace);
        const blockStart = p.index;

        const matchingLoc = p.current().range.loc;
        if (p.expect(TOpenBrace)) {
          const blocks                  = [];

          badSyntax: for (;;) {
            switch (p.current().kind) {
              case TWhitespace:
                p.advance();
                continue;

              case TCloseBrace: {
                const closeBraceLoc = p.current().range.loc;
                p.advance();
                return new Rule(new RAtKeyframes(atToken, p.symbolForName(nameLoc, name), blocks, closeBraceLoc), atRange.loc);
              }

              case TEndOfFile:
                break badSyntax;

              case TOpenBrace:
                p.expect(TPercentage);
                break badSyntax;

              default: {
                const selectors           = [];
                let firstSelectorLoc = 0;

                selectors: for (;;) {
                  const t = p.current();
                  switch (t.kind) {
                    case TWhitespace:
                      p.advance();
                      continue;

                    case TOpenBrace: {
                      const blockMatchingLoc = p.current().range.loc;
                      p.advance();
                      const rules = p.parseListOfDeclarations(new listOfDeclarationsOpts());
                      let closeBraceLoc = p.current().range.loc;
                      if (!p.expectWithMatchingLoc(TCloseBrace, blockMatchingLoc)) {
                        closeBraceLoc = 0;
                      }

                      // "@keyframes { from {} to { color: red } }" => "@keyframes { to { color: red } }"
                      if (!p.options.minifySyntax || rules.length > 0) {
                        blocks.push(new KeyframeBlock(selectors, rules, firstSelectorLoc, closeBraceLoc));
                      }
                      break selectors;
                    }

                    case TCloseBrace:
                    case TEndOfFile:
                      p.expect(TOpenBrace);
                      break badSyntax;

                    case TIdent:
                    case TPercentage: {
                      if (firstSelectorLoc === 0) {
                        firstSelectorLoc = p.current().range.loc;
                      }
                      let text = p.decoded();
                      if (t.kind === TIdent) {
                        if (goEqualFold(text, "from")) {
                          if (p.options.minifySyntax) {
                            text = "0%"; // "0%" is equivalent to but shorter than "from"
                          }
                        } else if (!goEqualFold(text, "to")) {
                          p.expect(TPercentage);
                        }
                      } else if (p.options.minifySyntax && text === "100%") {
                        text = "to"; // "to" is equivalent to but shorter than "100%"
                      }
                      selectors.push(text);
                      p.advance();

                      // Keyframe selectors are comma-separated
                      p.eat(TWhitespace);
                      if (p.eat(TComma)) {
                        p.eat(TWhitespace);
                        const k = p.current().kind;
                        if (k !== TIdent && k !== TPercentage) {
                          p.expect(TPercentage);
                          break badSyntax;
                        }
                      } else {
                        const k = p.current().kind;
                        if (k !== TOpenBrace && k !== TCloseBrace && k !== TEndOfFile) {
                          p.expect(TComma);
                          break badSyntax;
                        }
                      }
                      break;
                    }

                    default:
                      p.expect(TPercentage);
                      break badSyntax;
                  }
                }
              }
            }
          }

          // Otherwise, finish parsing the body and return an unknown rule
          while (!p.peek(TCloseBrace) && !p.peek(TEndOfFile)) {
            p.parseComponentValue();
          }
          p.expectWithMatchingLoc(TCloseBrace, matchingLoc);
          const prelude = p.convertTokensAt(preludeStart, blockStart);
          const block = p.convertTokensHelperAt(p.tokens, blockStart, p.index, TEndOfFile, ALLOW_IMPORTS_OPTS)[0];
          return new Rule(new RUnknownAt(atToken, prelude, block), atRange.loc);
        }
        break;
      }

      case "layer": {
        // Reference: https://developer.mozilla.org/en-US/docs/Web/CSS/@layer

        // Read the layer name list
        const names             = [];
        p.eat(TWhitespace);
        if (p.peek(TIdent)) {
          for (;;) {
            let r = p.expectValidLayerNameIdent();
            if (!r[1]) {
              break abortRuleParser;
            }
            const name = [r[0]];
            for (;;) {
              p.eat(TWhitespace);
              if (!p.eat(TDelimDot)) {
                break;
              }
              p.eat(TWhitespace);
              r = p.expectValidLayerNameIdent();
              if (!r[1]) {
                break abortRuleParser;
              }
              name.push(r[0]);
            }
            names.push(name);
            p.eat(TWhitespace);
            if (!p.eat(TComma)) {
              break;
            }
            p.eat(TWhitespace);
          }
        }

        // Read the optional block
        const matchingLoc = p.current().range.loc;
        if (names.length <= 1 && p.eat(TOpenBrace)) {
          p.recordAtLayerRule(names);
          const oldEnclosingLayer = p.enclosingLayer;
          if (names.length === 1) {
            p.enclosingLayer = p.enclosingLayer.concat(names[0]);
          } else {
            p.anonLayerCount++;
          }

          // Parse the block for this rule
          let rules        ;
          if (context.isDeclarationList) {
            rules = p.parseListOfDeclarations(new listOfDeclarationsOpts(null, context.canInlineNoOpNesting));
          } else {
            rules = p.parseListOfRules(new ruleContext(false, true));
          }

          if (names.length !== 1) {
            p.anonLayerCount--;
          }
          p.enclosingLayer = oldEnclosingLayer;
          let closeBraceLoc = p.current().range.loc;
          if (!p.expectWithMatchingLoc(TCloseBrace, matchingLoc)) {
            closeBraceLoc = 0;
          }
          return new Rule(new RAtLayer(names, rules, closeBraceLoc), atRange.loc);
        }

        // Handle lack of a block
        if (names.length >= 1 && p.eat(TSemicolon)) {
          p.recordAtLayerRule(names);
          return new Rule(new RAtLayer(names, null, 0), atRange.loc);
        }

        // Otherwise there's some kind of syntax error
        switch (p.current().kind) {
          case TEndOfFile:
            p.expect(TSemicolon);
            p.recordAtLayerRule(names);
            return new Rule(new RAtLayer(names, null, 0), atRange.loc);

          case TCloseBrace:
            p.expect(TSemicolon);
            if (!context.isTopLevel) {
              p.recordAtLayerRule(names);
              return new Rule(new RAtLayer(names, null, 0), atRange.loc);
            }
            break;

          case TOpenBrace:
            p.expect(TSemicolon);
            break;

          default:
            p.unexpected();
            break;
        }
        break;
      }

      case "media": {
        const queries = p.parseMediaQueryListUntil(stopAtOpenBrace);

        // Expect a block after the query
        const matchingLoc = p.current().range.loc;
        if (!p.expect(TOpenBrace)) {
          break abortRuleParser;
        }

        // Push the "@media" conditions
        p.enclosingAtMedia.push(queries);

        // Parse the block for this rule
        let rules        ;
        if (context.isDeclarationList) {
          rules = p.parseListOfDeclarations(new listOfDeclarationsOpts(null, context.canInlineNoOpNesting));
        } else {
          rules = p.parseListOfRules(new ruleContext(false, true));
        }

        // Pop the "@media" conditions
        p.enclosingAtMedia.pop();

        let closeBraceLoc = p.current().range.loc;
        if (!p.expectWithMatchingLoc(TCloseBrace, matchingLoc)) {
          closeBraceLoc = 0;
        }

        return new Rule(new RAtMedia(queries, rules, closeBraceLoc), atRange.loc);
      }

      case "scope": {
        // Parse the start limit
        let start                    = [];
        p.eat(TWhitespace);
        if (p.eat(TOpenParen)) {
          const r = p.parseSelectorList(new parseSelectorOpts(null, 0, false, true));
          start = r[0];
          if (!r[1] || !p.expect(TCloseParen)) {
            break abortRuleParser;
          }
          p.eat(TWhitespace);
        }

        // Parse the end limit
        let end                    = [];
        if (goEqualFold(p.decoded(), "to") && p.eat(TIdent)) {
          p.eat(TWhitespace);
          if (!p.expect(TOpenParen)) {
            break abortRuleParser;
          }
          const r = p.parseSelectorList(new parseSelectorOpts(null, 0, false, true));
          end = r[0];
          if (!r[1] || !p.expect(TCloseParen)) {
            break abortRuleParser;
          }
        }
        p.eat(TWhitespace);

        // Expect a block after the query
        const matchingLoc = p.current().range.loc;
        if (!p.expect(TOpenBrace)) {
          break abortRuleParser;
        }

        // Parse the block for this rule
        let rules        ;
        if (context.isDeclarationList) {
          rules = p.parseListOfDeclarations(new listOfDeclarationsOpts(null, context.canInlineNoOpNesting));
        } else {
          rules = p.parseListOfRules(new ruleContext(false, true));
        }

        let closeBraceLoc = p.current().range.loc;
        if (!p.expectWithMatchingLoc(TCloseBrace, matchingLoc)) {
          closeBraceLoc = 0;
        }

        return new Rule(new RAtScope(start || [], end || [], rules, closeBraceLoc), atRange.loc);
      }

      default:
        if (kind === atRuleUnknown && lowerAtToken === "namespace") {
          // CSS namespaces are a weird feature that appears to only really be
          // useful for styling XML. And the world has moved on from XHTML to
          // HTML5 so pretty much no one uses CSS namespaces anymore. They are
          // also complicated to support in a bundler because CSS namespaces are
          // file-scoped, which means:
          //
          // * Default namespaces can be different in different files, in which
          //   case some default namespaces would have to be converted to prefixed
          //   namespaces to avoid collisions.
          //
          // * Prefixed namespaces from different files can use the same name, in
          //   which case some prefixed namespaces would need to be renamed to
          //   avoid collisions.
          //
          // Instead of implementing all of that for an extremely obscure feature,
          // CSS namespaces are just explicitly not supported.
          p.log.addID(MsgID_CSS_UnsupportedAtNamespace, Warning, p.tracker, atRange, '"@namespace" rules are not supported');
        }
        break;
    }

    // Parse an unknown prelude
    p.index = preludeStart;
    prelude: for (;;) {
      switch (p.current().kind) {
        case TOpenBrace:
        case TEndOfFile:
          break prelude;

        case TSemicolon:
        case TCloseBrace: {
          const prelude = p.convertTokensAt(preludeStart, p.index);

          switch (kind) {
            case atRuleQualifiedOrEmpty:
              // Parse a known at rule below
              break prelude;

            case atRuleEmpty:
            case atRuleUnknown:
              // Parse an unknown at rule
              p.expect(TSemicolon);
              return new Rule(new RUnknownAt(atToken, prelude, null), atRange.loc);

            default:
              // Report an error for rules that should have blocks
              p.expect(TOpenBrace);
              p.eat(TSemicolon);
              return new Rule(new RUnknownAt(atToken, prelude, null), atRange.loc);
          }
        }

        default:
          p.parseComponentValue();
          break;
      }
    }
    const prelude = p.convertTokensAt(preludeStart, p.index);
    const blockStart = p.index;

    switch (kind) {
      case atRuleEmpty: {
        // Report an error for rules that shouldn't have blocks
        p.expect(TSemicolon);
        p.parseBlock(TOpenBrace, TCloseBrace);
        const block = p.convertTokensAt(blockStart, p.index);
        return new Rule(new RUnknownAt(atToken, prelude, block), atRange.loc);
      }

      case atRuleDeclarations: {
        // Parse known rules whose blocks always consist of declarations
        const matchingLoc = p.current().range.loc;
        p.expect(TOpenBrace);
        const rules = p.parseListOfDeclarations(new listOfDeclarationsOpts());
        let closeBraceLoc = p.current().range.loc;
        if (!p.expectWithMatchingLoc(TCloseBrace, matchingLoc)) {
          closeBraceLoc = 0;
        }

        // Handle local names for "@counter-style"
        if (prelude.length === 1 && lowerAtToken === "counter-style") {
          const t = prelude[0];
          if (t.kind === TIdent) {
            t.kind = TSymbol;
            t.payloadIndex = refInner(p.symbolForName(t.loc, t.text).ref);
          }
        }

        return new Rule(new RKnownAt(atToken, prelude, rules, closeBraceLoc), atRange.loc);
      }

      case atRuleInheritContext: {
        // Parse known rules whose blocks consist of whatever the current context is
        const matchingLoc = p.current().range.loc;
        p.expect(TOpenBrace);

        // Parse the block for this rule
        let rules        ;
        if (context.isDeclarationList) {
          rules = p.parseListOfDeclarations(new listOfDeclarationsOpts(null, context.canInlineNoOpNesting));
        } else {
          rules = p.parseListOfRules(new ruleContext(false, true));
        }

        let closeBraceLoc = p.current().range.loc;
        if (!p.expectWithMatchingLoc(TCloseBrace, matchingLoc)) {
          closeBraceLoc = 0;
        }

        // Handle local names for "@container"
        if (prelude.length >= 1 && lowerAtToken === "container") {
          const t = prelude[0];
          if (t.kind === TIdent && !goEqualFold(t.text, "not")) {
            t.kind = TSymbol;
            t.payloadIndex = refInner(p.symbolForName(t.loc, t.text).ref);
          }
        }

        return new Rule(new RKnownAt(atToken, prelude, rules, closeBraceLoc), atRange.loc);
      }

      case atRuleQualifiedOrEmpty: {
        const matchingLoc = p.current().range.loc;
        if (p.eat(TOpenBrace)) {
          const rules = p.parseListOfRules(new ruleContext(false, true));
          let closeBraceLoc = p.current().range.loc;
          if (!p.expectWithMatchingLoc(TCloseBrace, matchingLoc)) {
            closeBraceLoc = 0;
          }
          return new Rule(new RKnownAt(atToken, prelude, rules, closeBraceLoc), atRange.loc);
        }
        p.expect(TSemicolon);
        return new Rule(new RKnownAt(atToken, prelude, null, 0), atRange.loc);
      }

      default: {
        // Otherwise, parse an unknown rule
        p.parseBlock(TOpenBrace, TCloseBrace);
        const block = p.convertTokensHelperAt(p.tokens, blockStart, p.index, TEndOfFile, ALLOW_IMPORTS_OPTS)[0];
        return new Rule(new RUnknownAt(atToken, prelude, block), atRange.loc);
      }
    }
  }

  // Returns [text, ok]
  expectValidLayerNameIdent()                    {
    const p = this;
    const r = p.current().range;
    const text = p.decoded();
    if (!p.expect(TIdent)) {
      return ["", false];
    }
    switch (text) {
      case "initial":
      case "inherit":
      case "unset":
        p.log.addID(MsgID_CSS_InvalidAtLayer, Warning, p.tracker, r, goQuote(text) + " cannot be used as a layer name");
        p.prevError = r.loc;
        return ["", false];
    }
    return [text, true];
  }

  convertTokens(tokens              )          {
    return this.convertTokensHelperAt(tokens, 0, tokens.length, TEndOfFile, DEFAULT_CONVERT_OPTS)[0];
  }

  // JS-only: Go's "p.convertTokens(p.tokens[start:end])"
  convertTokensAt(start        , end        )          {
    return this.convertTokensHelperAt(this.tokens, start, end, TEndOfFile, DEFAULT_CONVERT_OPTS)[0];
  }

  // Go's signature (returns [result, remaining tokens])
  convertTokensHelper(tokens              , close        , opts                   )                          {
    const r = this.convertTokensHelperAt(tokens, 0, tokens.length, close, opts);
    return [r[0], tokens.slice(r[1])];
  }

  // Go: convertTokensHelper(tokens[i:end], close, opts). Returns [result,
  // index of the first remaining token]. "opts" is never mutated (Go passes
  // it by value).
  convertTokensHelperAt(tokens              , i        , end        , close        , opts                   )                    {
    const p = this;
    const contents = p.source.contents;
    const result          = [];
    let nextWhitespace = 0;

    // Enable verbatim whitespace mode when the first two non-whitespace tokens
    // are a CSS variable name followed by a colon. This is because it could be
    // a form of CSS variable usage, and removing whitespace could potentially
    // break this usage. For example, the following CSS is ignored by Chrome if
    // the whitespace isn't preserved:
    //
    //   @supports (--foo: ) {
    //     html { background: green; }
    //   }
    //
    // Strangely whitespace removal doesn't cause the declaration to be ignored
    // in Firefox or Safari, so there's definitely a browser bug somewhere.
    if (!opts.verbatimWhitespace) {
      for (let j = i; j < end; j++) {
        const t = tokens[j];
        if (t.kind === TWhitespace) {
          continue;
        }
        if (t.kind === TIdent && t.decodedText(contents).startsWith("--")) {
          for (let k = j + 1; k < end; k++) {
            const t2 = tokens[k];
            if (t2.kind === TWhitespace) {
              continue;
            }
            if (t2.kind === TColon) {
              opts = new convertTokensOpts(opts.allowImports, true, opts.isInsideCalcFunction);
            }
            break;
          }
        }
        break;
      }
    }

    while (i < end) {
      const t = tokens[i];
      i++;
      if (t.kind === close) {
        break;
      }
      let token = new Token(null, t.decodedText(contents), t.range.loc, 0, 0, t.kind, nextWhitespace);
      nextWhitespace = 0;

      // Warn about invalid "+" and "-" operators that break the containing "calc()"
      if (
        opts.isInsideCalcFunction &&
        tIsNumeric(t.kind) &&
        result.length > 0 &&
        tIsNumeric(result[result.length - 1].kind) &&
        (token.text.startsWith("+") || token.text.startsWith("-"))
      ) {
        // "calc(1+2)" and "calc(1-2)" are invalid
        p.log.addID(MsgID_CSS_InvalidCalc, Warning, p.tracker, new Range(t.range.loc, 1), "The " + goQuote(token.text.slice(0, 1)) + " operator only works if there is whitespace on both sides");
      }

      switch (t.kind) {
        case TWhitespace: {
          const last = result.length - 1;
          if (last >= 0) {
            result[last].whitespace |= WhitespaceAfter;
          }
          nextWhitespace = WhitespaceBefore;
          continue;
        }

        case TDelimPlus:
        case TDelimMinus:
          // Warn about invalid "+" and "-" operators that break the containing "calc()"
          if (opts.isInsideCalcFunction && i < end) {
            if (result.length === 0 || result[result.length - 1].kind === TComma) {
              // "calc(-(1 + 2))" is invalid
              p.log.addID(MsgID_CSS_InvalidCalc, Warning, p.tracker, t.range, goQuote(token.text) + " can only be used as an infix operator, not a prefix operator");
            } else if (token.whitespace !== WhitespaceBefore || tokens[i].kind !== TWhitespace) {
              // "calc(1- 2)" and "calc(1 -(2))" are invalid
              p.log.addID(MsgID_CSS_InvalidCalc, Warning, p.tracker, t.range, "The " + goQuote(token.text) + " operator only works if there is whitespace on both sides");
            }
          }
          break;

        case TNumber:
          if (p.options.minifySyntax) {
            const m = mangleNumber(token.text);
            if (m[1]) {
              token.text = m[0];
            }
          }
          break;

        case TPercentage:
          if (p.options.minifySyntax) {
            const m = mangleNumber(token.percentageValue());
            if (m[1]) {
              token.text = m[0] + "%";
            }
          }
          break;

        case TDimension:
          token.unitOffset = t.unitOffset;

          if (p.options.minifySyntax) {
            const m = mangleNumber(token.dimensionValue());
            if (m[1]) {
              token.text = m[0] + token.dimensionUnit();
              token.unitOffset = m[0].length;
            }

            const d = mangleDimension(token.dimensionValue(), token.dimensionUnit());
            if (d[2]) {
              token.text = d[0] + d[1];
              token.unitOffset = d[0].length;
            }
          }
          break;

        case TURL: {
          token.payloadIndex = p.importRecords.length;
          let flags = 0;
          if (!opts.allowImports) {
            flags |= IsUnused;
          }
          const record = new ImportRecord();
          record.kind = ImportURL;
          record.path = new Path(token.text);
          record.range = t.range;
          record.flags = flags;
          p.importRecords.push(record);
          token.text = "";
          break;
        }

        case TFunction: {
          const original = i;
          let nestedOpts = opts;
          if (goEqualFold(token.text, "var")) {
            // CSS variables require verbatim whitespace for correctness
            nestedOpts = new convertTokensOpts(nestedOpts.allowImports, true, nestedOpts.isInsideCalcFunction);
          }
          if (goEqualFold(token.text, "calc")) {
            nestedOpts = new convertTokensOpts(nestedOpts.allowImports, nestedOpts.verbatimWhitespace, true);
          }
          const r = p.convertTokensHelperAt(tokens, i, end, TCloseParen, nestedOpts);
          const nested = r[0];
          i = r[1];
          token.children = nested;

          // Apply "calc" simplification rules when minifying
          if (p.options.minifySyntax && goEqualFold(token.text, "calc")) {
            token = p.tryToReduceCalcExpression(token);
          }

          // Treat a URL function call with a string just like a URL token
          if (goEqualFold(token.text, "url") && nested.length === 1 && nested[0].kind === TString) {
            token.kind = TURL;
            token.text = "";
            token.children = null;
            token.payloadIndex = p.importRecords.length;
            let flags = 0;
            if (!opts.allowImports) {
              flags |= IsUnused;
            }
            const record = new ImportRecord();
            record.kind = ImportURL;
            record.path = new Path(nested[0].text);
            record.range = tokens[original].range;
            record.flags = flags;
            p.importRecords.push(record);
          }
          break;
        }

        case TOpenParen: {
          const r = p.convertTokensHelperAt(tokens, i, end, TCloseParen, opts);
          i = r[1];
          token.children = r[0];
          break;
        }

        case TOpenBrace: {
          const r = p.convertTokensHelperAt(tokens, i, end, TCloseBrace, opts);
          const nested = r[0];
          i = r[1];

          // Pretty-printing: insert leading and trailing whitespace when not minifying
          if (!opts.verbatimWhitespace && !p.options.minifyWhitespace && nested.length > 0) {
            nested[0].whitespace |= WhitespaceBefore;
            nested[nested.length - 1].whitespace |= WhitespaceAfter;
          }

          token.children = nested;
          break;
        }

        case TOpenBracket: {
          const r = p.convertTokensHelperAt(tokens, i, end, TCloseBracket, opts);
          i = r[1];
          token.children = r[0];
          break;
        }
      }

      result.push(token);
    }

    if (!opts.verbatimWhitespace) {
      for (let j = 0; j < result.length; j++) {
        const token = result[j];

        // Always remove leading and trailing whitespace
        if (j === 0) {
          token.whitespace &= ~WhitespaceBefore;
        }
        if (j + 1 === result.length) {
          token.whitespace &= ~WhitespaceAfter;
        }

        switch (token.kind) {
          case TComma:
            // Assume that whitespace can always be removed before a comma
            token.whitespace &= ~WhitespaceBefore;
            if (j > 0) {
              result[j - 1].whitespace &= ~WhitespaceAfter;
            }

            // Assume whitespace can always be added after a comma
            if (p.options.minifyWhitespace) {
              token.whitespace &= ~WhitespaceAfter;
              if (j + 1 < result.length) {
                result[j + 1].whitespace &= ~WhitespaceBefore;
              }
            } else {
              token.whitespace |= WhitespaceAfter;
              if (j + 1 < result.length) {
                result[j + 1].whitespace |= WhitespaceBefore;
              }
            }
            break;
        }
      }
    }

    // Insert an explicit whitespace token if we're in verbatim mode and all
    // tokens were whitespace. In this case there is no token to attach the
    // whitespace before/after flags so this is the only way to represent this.
    // This is the only case where this function generates an explicit whitespace
    // token. It represents whitespace as flags in all other cases.
    if (opts.verbatimWhitespace && result.length === 0 && nextWhitespace === WhitespaceBefore) {
      result.push(new Token(null, "", 0, 0, 0, TWhitespace, 0));
    }

    return [result, i];
  }

  parseSelectorRule(isTopLevel         , opts                   )       {
    const p = this;

    // Save and restore the local symbol state in case there are any bare
    // ":global" or ":local" annotations. The effect of these should be scoped
    // to within the selector rule.
    const local = p.makeLocalSymbols;
    const preludeStart = p.index;

    // Try parsing the prelude as a selector list
    const parsed = p.parseSelectorList(opts);
    if (parsed[1]) {
      const list                    = parsed[0];
      let canInlineNoOpNesting = true;
      for (let i = 0; i < list.length; i++) {
        // We cannot transform the CSS "a, b::before { & { color: red } }" into
        // "a, b::before { color: red }" because it's basically equivalent to
        // ":is(a, b::before) { color: red }" which only applies to "a", not to
        // "b::before" because pseudo-elements are not valid within :is():
        // https://www.w3.org/TR/selectors-4/#matches-pseudo. This restriction
        // may be relaxed in the future, but this restriction hash shipped so
        // we're stuck with it: https://github.com/w3c/csswg-drafts/issues/7433.
        if (list[i].usesPseudoElement()) {
          canInlineNoOpNesting = false;
          break;
        }
      }
      const selector = new RSelector(list, [], 0);
      const matchingLoc = p.current().range.loc;
      if (p.expect(TOpenBrace)) {
        p.inSelectorSubtree++;
        const declOpts = new listOfDeclarationsOpts(null, canInlineNoOpNesting);

        // Prepare for "composes" declarations
        if (opts.composesContext !== null && list.length === 1 && list[0].selectors.length === 1 && list[0].selectors[0].isSingleAmpersand()) {
          // Support code like this:
          //
          //   .foo {
          //     :local { composes: bar }
          //     :global { composes: baz }
          //   }
          //
          declOpts.composesContext = opts.composesContext;
        } else {
          const composesContext_ = new composesContext([], list[0].selectors[0].range(), new Range(0, 0));
          if (opts.composesContext !== null) {
            composesContext_.problemRange = opts.composesContext.parentRange;
          }
          for (let i = 0; i < list.length; i++) {
            const sel = list[i];
            const first                   = sel.selectors[0];
            if (first.combinator.byte !== 0) {
              composesContext_.problemRange = new Range(first.combinator.loc, 1);
            } else if (first.typeSelector !== null) {
              composesContext_.problemRange = first.typeSelector.range();
            } else if (first.nestingSelectorLocs.length > 0) {
              composesContext_.problemRange = new Range(first.nestingSelectorLocs[0], 1);
            } else {
              for (let j = 0; j < first.subclassSelectors.length; j++) {
                const ss = first.subclassSelectors[j];
                const class_ = ss.data;
                if (j > 0 || !(class_ instanceof SSClass)) {
                  composesContext_.problemRange = ss.range;
                } else {
                  composesContext_.parentRefs.push(class_.name.ref);
                }
              }
            }
            if (composesContext_.problemRange.len > 0) {
              break;
            }
            if (sel.selectors.length > 1) {
              composesContext_.problemRange = sel.selectors[1].range();
              break;
            }
          }
          declOpts.composesContext = composesContext_;
        }

        selector.rules = p.parseListOfDeclarations(declOpts);
        p.inSelectorSubtree--;
        const closeBraceLoc = p.current().range.loc;
        if (p.expectWithMatchingLoc(TCloseBrace, matchingLoc)) {
          selector.closeBraceLoc = closeBraceLoc;
        }
        p.makeLocalSymbols = local;
        return new Rule(selector, p.tokens[preludeStart].range.loc);
      }
    }

    p.makeLocalSymbols = local;
    p.index = preludeStart;

    // Otherwise, parse a generic qualified rule
    return p.parseQualifiedRule(new parseQualifiedRuleOpts(true, isTopLevel, opts.isDeclarationContext));
  }

  parseQualifiedRule(opts                        )       {
    const p = this;
    const preludeStart = p.index;
    const preludeLoc = p.current().range.loc;

    loop: for (;;) {
      switch (p.current().kind) {
        case TOpenBrace:
        case TEndOfFile:
          break loop;

        case TCloseBrace:
          if (!opts.isTopLevel) {
            break loop;
          }
          break;

        case TSemicolon:
          if (opts.isDeclarationContext) {
            return new Rule(new RBadDeclaration(p.convertTokensAt(preludeStart, p.index)), preludeLoc);
          }
          break;
      }

      p.parseComponentValue();
    }

    const qualified = new RQualified(p.convertTokensAt(preludeStart, p.index), [], 0);

    const matchingLoc = p.current().range.loc;
    if (p.eat(TOpenBrace)) {
      qualified.rules = p.parseListOfDeclarations(new listOfDeclarationsOpts());
      const closeBraceLoc = p.current().range.loc;
      if (p.expectWithMatchingLoc(TCloseBrace, matchingLoc)) {
        qualified.closeBraceLoc = closeBraceLoc;
      }
    } else if (!opts.isAlreadyInvalid) {
      p.expect(TOpenBrace);
    }

    return new Rule(qualified, preludeLoc);
  }

  // Note: This was a late change to the CSS nesting syntax.
  // See also: https://github.com/w3c/csswg-drafts/issues/7961
  //
  // Returns [endOfRuleScan, index]
  scanForEndOfRule()                   {
    const p = this;
    const stack           = [];
    const tokens = p.tokens;
    const contents = p.source.contents;

    // Small state machine to recognize "--foo:"
    let customProp = customPropIdent;

    for (let i = p.index; i < tokens.length; i++) {
      const t = tokens[i];

      // People sometimes use CSS custom properties to store JSON. This is
      // problematic because the "{...}" braces look like a CSS block unless
      // this edge case is special-cased. See the (quite long) discussion on
      // https://github.com/w3c/csswg-drafts/issues/7961 for more information.
      //
      // I couldn't find any actual specification for how this is supposed to
      // work. Just a lot of discussion on GitHub. I did find this text, from
      // https://drafts.csswg.org/css-syntax/#consume-a-declaration:
      //
      //   Otherwise, if decl's value contains a top-level simple block with
      //   an associated token of <{-token>, and also contains any other non-
      //   <whitespace-token> value, return nothing. (That is, a top-level {}-
      //   block is only allowed as the entire value of a non-custom property.)
      //
      // However, current browsers appear to accept custom properties with a
      // {}-block contained anywhere inside them, not just as the entire value.
      // So that's what I'm attempting to do here.
      if (customProp < customPropAccept) {
        switch (customProp) {
          case customPropIdent:
            if (t.kind === TIdent && contents.startsWith("--", t.range.loc)) {
              customProp = customPropColon;
            } else if (t.kind !== TWhitespace) {
              customProp = customPropReject;
            }
            break;
          case customPropColon:
            if (t.kind === TColon) {
              customProp = customPropAccept;
            } else if (t.kind !== TWhitespace) {
              customProp = customPropReject;
            }
            break;
        }
      }

      switch (t.kind) {
        case TSemicolon:
          if (stack.length === 0) {
            return [endOfRuleSemicolon, i];
          }
          break;

        case TFunction:
        case TOpenParen:
          stack.push(TCloseParen);
          break;

        case TOpenBracket:
          stack.push(TCloseBracket);
          break;

        case TOpenBrace:
          if (stack.length === 0 && customProp !== customPropAccept) {
            return [endOfRuleOpenBrace, i];
          }
          stack.push(TCloseBrace);
          break;

        case TCloseParen:
        case TCloseBracket: {
          const n = stack.length;
          if (n > 0 && t.kind === stack[n - 1]) {
            stack.pop();
          }
          break;
        }

        case TCloseBrace: {
          const n = stack.length;
          if (n > 0 && t.kind === stack[n - 1]) {
            stack.pop();
          } else {
            return [endOfRuleUnknown, -1];
          }
          break;
        }
      }
    }

    return [endOfRuleUnknown, -1];
  }

  parseDeclaration()       {
    const p = this;

    // Parse the key
    const keyStart = p.index;
    const keyRange = p.tokens[keyStart].range;
    const keyIsIdent = p.expect(TIdent);
    let ok = false;
    if (keyIsIdent) {
      p.eat(TWhitespace);
      ok = p.eat(TColon);
    }

    // Parse the value
    const valueStart = p.index;
    stop: for (;;) {
      switch (p.current().kind) {
        case TEndOfFile:
        case TSemicolon:
        case TCloseBrace:
          break stop;

        default:
          p.parseComponentValue();
          break;
      }
    }

    // Stop now if this is not a valid declaration
    if (!ok) {
      if (keyIsIdent) {
        const end = keyRange.loc + keyRange.len;
        if (end > p.prevError) {
          p.prevError = end;
          const data = p.tracker.msgData(new Range(end, 0), 'Expected ":"');
          data.location.suggestion = ":";
          p.log.addMsgID(MsgID_CSS_CSSSyntaxError, new Msg(null, "", data, Warning));
        }
      }

      return new Rule(new RBadDeclaration(p.convertTokensAt(keyStart, p.index)), keyRange.loc);
    }

    const keyToken = p.tokens[keyStart];
    const keyText = keyToken.decodedText(p.source.contents);
    let valueEnd = p.index; // (Go: value := p.tokens[valueStart:p.index])
    const verbatimWhitespace = keyText.startsWith("--");

    // Remove trailing "!important"
    let important = false;
    const tokens = p.tokens;
    let i = valueEnd - 1;
    if (i >= valueStart && tokens[i].kind === TWhitespace) {
      i--;
    }
    if (i >= valueStart && tokens[i].kind === TIdent && goEqualFold(tokens[i].decodedText(p.source.contents), "important")) {
      i--;
      if (i >= valueStart && tokens[i].kind === TWhitespace) {
        i--;
      }
      if (i >= valueStart && tokens[i].kind === TDelimExclamation) {
        valueEnd = i;
        important = true;
      }
    }

    const result = p.convertTokensHelperAt(
      tokens,
      valueStart,
      valueEnd,
      TEndOfFile,
      // CSS variables require verbatim whitespace for correctness
      verbatimWhitespace ? ALLOW_IMPORTS_VERBATIM_OPTS : ALLOW_IMPORTS_OPTS,
    )[0];

    // Insert or remove whitespace before the first token
    if (!verbatimWhitespace && result.length > 0) {
      if (p.options.minifyWhitespace) {
        result[0].whitespace &= ~WhitespaceBefore;
      } else {
        result[0].whitespace |= WhitespaceBefore;
      }
    }

    const lowerKeyText = goToLower(keyText);
    let key = KnownDeclarations.get(lowerKeyText);
    if (key === undefined) {
      key = DUnknown;
    }

    // Attempt to point out trivial typos
    if (key === DUnknown) {
      const $c = maybeCorrectDeclarationTypo(lowerKeyText);
      if ($c[1]) {
        const corrected = $c[0];
        const data = p.tracker.msgData(keyToken.range, goQuote(keyText) + " is not a known CSS property");
        data.location.suggestion = corrected;
        p.log.addMsgID(MsgID_CSS_UnsupportedCSSProperty, new Msg([new MsgData(null, null, "Did you mean " + goQuote(corrected) + " instead?")], "", data, Warning));
      }
    }

    return new Rule(new RDeclaration(keyText, result, keyToken.range, key, important), keyRange.loc);
  }

  parseComponentValue() {
    const p = this;
    switch (p.current().kind) {
      case TFunction:
        p.parseBlock(TFunction, TCloseParen);
        break;

      case TOpenParen:
        p.parseBlock(TOpenParen, TCloseParen);
        break;

      case TOpenBrace:
        p.parseBlock(TOpenBrace, TCloseBrace);
        break;

      case TOpenBracket:
        p.parseBlock(TOpenBracket, TCloseBracket);
        break;

      case TEndOfFile:
        p.unexpected();
        break;

      default:
        p.advance();
        break;
    }
  }

  parseBlock(open        , close        ) {
    const p = this;
    const current = p.current();
    const matchingStart = current.range.loc + current.range.len - 1;
    if (p.expect(open)) {
      while (!p.eat(close)) {
        if (p.peek(TEndOfFile)) {
          p.expectWithMatchingLoc(close, matchingStart);
          return;
        }

        p.parseComponentValue();
      }
    }
  }

  // -------------------------------------------------------------------------
  // css_parser_media.go

  // Reference: https://drafts.csswg.org/mediaqueries-4/
  parseMediaQueryListUntil(stop                           )               {
    const p = this;
    const queries               = [];
    p.eat(TWhitespace);
    while (!p.peek(TEndOfFile) && !stop(p.current().kind)) {
      const start = p.index;
      const r = p.parseMediaQuery();
      let query = r[0];
      if (!r[1]) {
        // If parsing failed, parse an arbitrary sequence of tokens instead
        p.index = start;
        const loc = p.current().range.loc;
        while (!p.peek(TEndOfFile) && !stop(p.current().kind) && !p.peek(TComma)) {
          p.parseComponentValue();
        }
        const tokens = p.convertTokensAt(start, p.index);
        query = new MediaQuery(loc, new MQArbitraryTokens(tokens));
      }
      queries.push(query);
      p.eat(TWhitespace);
      if (!p.eat(TComma)) {
        break;
      }
      p.eat(TWhitespace);
    }
    return queries;
  }

  // Returns [query, ok] (query is null when not ok)
  parseMediaQuery()                               {
    const p = this;
    const loc = p.current().range.loc;

    // Check for a media condition first
    if (p.looksLikeMediaCondition()) {
      return p.parseMediaCondition(mediaWithOr);
    }

    // Parse the media type and potentially the leading "not" or "only" keyword
    let mediaType = p.decoded();
    if (!p.peek(TIdent)) {
      p.expect(TIdent);
      return [null, false];
    }
    let op = MQTypeOpNone;
    if (goEqualFold(mediaType, "not")) {
      op = MQTypeOpNot;
    } else if (goEqualFold(mediaType, "only")) {
      op = MQTypeOpOnly;
    }
    if (op !== MQTypeOpNone) {
      p.advance();
      p.eat(TWhitespace);
      mediaType = p.decoded();
      if (!p.peek(TIdent)) {
        p.expect(TIdent);
        return [null, false];
      }
    }

    // The <media-type> production does not include the keywords "only", "not", "and", "or", and "layer".
    if (goEqualFold(mediaType, "only") || goEqualFold(mediaType, "not") || goEqualFold(mediaType, "and") || goEqualFold(mediaType, "or") || goEqualFold(mediaType, "layer")) {
      p.unexpected();
      return [null, false];
    }
    p.advance();
    p.eat(TWhitespace);

    // Potentially parse a chain of "and" operators
    let andOrNull                    = null;
    if (p.peek(TIdent) && goEqualFold(p.decoded(), "and")) {
      p.advance();
      p.eat(TWhitespace);
      const r = p.parseMediaCondition(mediaWithoutOr);
      andOrNull = r[0];
      if (!r[1]) {
        return [null, false];
      }
    }

    return [new MediaQuery(loc, new MQType(op, mediaType, andOrNull)), true];
  }

  looksLikeMediaCondition()          {
    const p = this;
    const kind = p.current().kind;
    return (
      kind === TOpenParen ||
      kind === TFunction ||
      (kind === TIdent && goEqualFold(p.decoded(), "not") && p.next().kind === TWhitespace && p.at(p.index + 2).kind === TOpenParen)
    );
  }

  // Returns [query, ok]
  parseMediaCondition(or        )                               {
    const p = this;
    const loc = p.current().range.loc;

    // Handle a leading "not"
    if (p.peek(TIdent) && goEqualFold(p.decoded(), "not")) {
      p.advance();
      p.eat(TWhitespace);
      const r = p.parseMediaInParens();
      if (!r[1]) {
        return [null, false];
      } else {
        return [p.maybeSimplifyMediaNot(loc, r[0]), true];
      }
    }

    // Parse the first term
    const r = p.parseMediaInParens();
    if (!r[1]) {
      return [null, false];
    }
    const first = r[0];
    p.eat(TWhitespace);

    // Potentially parse a chain of "and" or "or" operators
    if (p.peek(TIdent)) {
      const keyword = p.decoded();
      if (goEqualFold(keyword, "and") || (or === mediaWithOr && goEqualFold(keyword, "or"))) {
        let op = MQBinaryOpAnd;
        if (keyword.length === 2) {
          op = MQBinaryOpOr;
        }
        let inner = p.appendMediaTerm([], first, op);
        for (;;) {
          p.advance();
          p.eat(TWhitespace);
          const r2 = p.parseMediaInParens();
          if (!r2[1]) {
            return [null, false];
          }
          inner = p.appendMediaTerm(inner, r2[0], op);
          p.eat(TWhitespace);
          if (!p.peek(TIdent) || !goEqualFold(p.decoded(), keyword)) {
            break;
          }
        }
        return [new MediaQuery(loc, new MQBinary(op, inner)), true];
      }
    }

    return [first, true];
  }

  appendMediaTerm(inner              , term            , op        )               {
    // "(a and b) and c" => "a and b and c"
    // "(a or b) or c" => "a or b or c"
    const binary = term.data;
    if (binary instanceof MQBinary && binary.op === op && this.options.minifySyntax) {
      for (let i = 0; i < binary.terms.length; i++) {
        inner.push(binary.terms[i]);
      }
      return inner;
    } else {
      inner.push(term);
      return inner;
    }
  }

  // Returns [query, ok]
  parseMediaInParens()                               {
    const p = this;
    p.eat(TWhitespace);
    const start = p.index;

    // Consume the opening token
    const isFunction = p.eat(TFunction);
    if (!isFunction && !p.expect(TOpenParen)) {
      return [null, false];
    }
    p.eat(TWhitespace);

    // Handle a media condition
    if (!isFunction && p.looksLikeMediaCondition()) {
      const r = p.parseMediaCondition(mediaWithOr);
      if (!r[1]) {
        return [null, false];
      } else {
        p.eat(TWhitespace);
        if (!p.expect(TCloseParen)) {
          return [null, false];
        }
        return r;
      }
    }

    // Scan over the remaining tokens
    while (!p.peek(TCloseParen) && !p.peek(TEndOfFile)) {
      p.parseComponentValue();
    }
    const end = p.index;
    if (!p.expect(TCloseParen)) {
      return [null, false];
    }
    const tokens = p.convertTokensAt(start, end);
    const loc = tokens[0].loc;

    // Potentially pattern-match the tokens inside the parentheses
    if (!isFunction && tokens.length === 1) {
      const children = tokens[0].children;
      if (children !== null) {
        const r = parsePlainOrBooleanMediaFeature(children);
        if (r[1]) {
          return [new MediaQuery(loc, r[0]), true];
        }
        const r2 = parseRangeMediaFeature(children);
        if (r2[1]) {
          const term = r2[0];
          if (cssFeatureHas(p.options.unsupportedCSSFeatures, MediaRange)) {
            const terms               = [];
            if (term.beforeCmp !== MQCmpNone) {
              terms.push(lowerMediaRange(term.nameLoc, term.name, mqCmpReverse(term.beforeCmp), term.before));
            }
            if (term.afterCmp !== MQCmpNone) {
              terms.push(lowerMediaRange(term.nameLoc, term.name, term.afterCmp, term.after));
            }
            if (terms.length === 1) {
              return [terms[0], true];
            } else {
              return [new MediaQuery(loc, new MQBinary(MQBinaryOpAnd, terms)), true];
            }
          }
          return [new MediaQuery(loc, term), true];
        }
      }
    }
    return [new MediaQuery(loc, new MQArbitraryTokens(tokens)), true];
  }

  maybeSimplifyMediaNot(loc        , inner            )             {
    const p = this;
    if (p.options.minifySyntax) {
      const data = inner.data;
      if (data instanceof MQNot) {
        // "not (not a)" => "a"
        // "not (not (not a))" => "not a"
        return data.inner;
      } else if (data instanceof MQBinary) {
        // "not ((not a) and (not b))" => "a or b"
        // "not ((not a) or (not b))" => "a and b"
        const terms               = [];
        for (let i = 0; i < data.terms.length; i++) {
          const not = data.terms[i].data;
          if (not instanceof MQNot) {
            terms.push(not.inner);
          } else {
            break;
          }
        }
        if (terms.length === data.terms.length) {
          data.op ^= 1;
          data.terms = terms;
          return inner;
        }
      } else if (data instanceof MQRange) {
        if ((data.beforeCmp === MQCmpNone && data.afterCmp !== MQCmpEq) || (data.afterCmp === MQCmpNone && data.beforeCmp !== MQCmpEq)) {
          data.beforeCmp = mqCmpFlip(data.beforeCmp);
          data.afterCmp = mqCmpFlip(data.afterCmp);
          return inner;
        }
      }
    }
    return new MediaQuery(loc, new MQNot(inner));
  }
}

// JS-only: the other parser files' methods are mixed in on the first parse
// (not at module evaluation) so that the import cycles between the parser
// files cannot observe an uninitialized method object.
let mixinsApplied = false;
function applyMixins() {
  Object.assign(parser.prototype, selectorMethods, nestingMethods, declsMethods, colorMethods, calcMethods);
  mixinsApplied = true;
}

export function parse(log     , source        , options         )      {
  if (!mixinsApplied) {
    applyMixins();
  }
  const result = tokenize(log, source, new LexerOptions(options.minifyIdentifiers));
  const p = new parser(log, source, options, result.tokens, result.allComments, result.legalComments);
  const rules = p.parseListOfRules(new ruleContext(true, true));
  p.expect(TEndOfFile);
  const charFreq = p.computeCharacterFrequency();
  return new AST(
    p.symbols,
    charFreq,
    p.importRecords,
    rules,
    result.sourceMapComment,
    result.approximateLineCount,
    p.localSymbols,
    p.localScope,
    p.globalScope,
    p.composes,
    p.layersPreImport,
    p.layersPostImport,
  );
}

// ---------------------------------------------------------------------------
// Option/context structs

export class ruleContext {
  ;                           
  ;                               
  constructor(isTopLevel = false, parseSelectors = false) {
    this.isTopLevel = isTopLevel;
    this.parseSelectors = parseSelectors;
  }
}

export class listOfDeclarationsOpts {
  ;                                               
  ;                                     
  constructor(composesContext_                         = null, canInlineNoOpNesting = false) {
    this.composesContext = composesContext_;
    this.canInlineNoOpNesting = canInlineNoOpNesting;
  }
}

// atRuleKind
export const atRuleUnknown = 0;
export const atRuleDeclarations = 1;
export const atRuleInheritContext = 2;
export const atRuleQualifiedOrEmpty = 3;
export const atRuleEmpty = 4;

export const specialAtRules                      = new Map([
  ["media", atRuleInheritContext],
  ["supports", atRuleInheritContext],

  ["font-face", atRuleDeclarations],
  ["page", atRuleDeclarations],

  // These go inside "@page": https://www.w3.org/TR/css-page-3/#syntax-page-selector
  ["bottom-center", atRuleDeclarations],
  ["bottom-left-corner", atRuleDeclarations],
  ["bottom-left", atRuleDeclarations],
  ["bottom-right-corner", atRuleDeclarations],
  ["bottom-right", atRuleDeclarations],
  ["left-bottom", atRuleDeclarations],
  ["left-middle", atRuleDeclarations],
  ["left-top", atRuleDeclarations],
  ["right-bottom", atRuleDeclarations],
  ["right-middle", atRuleDeclarations],
  ["right-top", atRuleDeclarations],
  ["top-center", atRuleDeclarations],
  ["top-left-corner", atRuleDeclarations],
  ["top-left", atRuleDeclarations],
  ["top-right-corner", atRuleDeclarations],
  ["top-right", atRuleDeclarations],

  // These properties are very deprecated and appear to only be useful for
  // mobile versions of internet explorer (which may no longer exist?), but
  // they are used by the https://ant.design/ design system so we recognize
  // them to avoid the warning.
  //
  //   Documentation: https://developer.mozilla.org/en-US/docs/Web/CSS/@viewport
  //   Discussion: https://github.com/w3c/csswg-drafts/issues/4766
  //
  ["viewport", atRuleDeclarations],
  ["-ms-viewport", atRuleDeclarations],

  // This feature has been removed from the web because it's actively harmful.
  // However, there is one exception where "@-moz-document url-prefix() {" is
  // accepted by Firefox to basically be an "if Firefox" conditional rule.
  //
  //   Documentation: https://developer.mozilla.org/en-US/docs/Web/CSS/@document
  //   Discussion: https://bugzilla.mozilla.org/show_bug.cgi?id=1035091
  //
  ["document", atRuleInheritContext],
  ["-moz-document", atRuleInheritContext],

  // This is a new feature that changes how the CSS rule cascade works. It can
  // end in either a "{}" block or a ";" rule terminator so we need this special
  // case to support both.
  //
  //   Documentation: https://developer.mozilla.org/en-US/docs/Web/CSS/@layer
  //   Motivation: https://developer.chrome.com/blog/cascade-layers/
  //
  ["layer", atRuleQualifiedOrEmpty],

  // Reference: https://drafts.csswg.org/css-cascade-6/#scoped-styles
  ["scope", atRuleInheritContext],

  // Reference: https://drafts.csswg.org/css-fonts-4/#font-palette-values
  ["font-palette-values", atRuleDeclarations],

  // Documentation: https://developer.mozilla.org/en-US/docs/Web/CSS/@counter-style
  // Reference: https://drafts.csswg.org/css-counter-styles/#the-counter-style-rule
  ["counter-style", atRuleDeclarations],

  // Documentation: https://developer.mozilla.org/en-US/docs/Web/CSS/@font-feature-values
  // Reference: https://drafts.csswg.org/css-fonts/#font-feature-values
  ["font-feature-values", atRuleDeclarations],
  ["annotation", atRuleDeclarations],
  ["character-variant", atRuleDeclarations],
  ["historical-forms", atRuleDeclarations],
  ["ornaments", atRuleDeclarations],
  ["styleset", atRuleDeclarations],
  ["stylistic", atRuleDeclarations],
  ["swash", atRuleDeclarations],

  // Container Queries
  // Reference: https://drafts.csswg.org/css-contain-3/#container-rule
  ["container", atRuleInheritContext],

  // Defining before-change style: the @starting-style rule
  // Reference: https://drafts.csswg.org/css-transitions-2/#defining-before-change-style-the-starting-style-rule
  ["starting-style", atRuleInheritContext],

  // Anchor Positioning
  // Reference: https://drafts.csswg.org/css-anchor-position-1/#at-ruledef-position-try
  ["position-try", atRuleDeclarations],

  // @view-transition
  // Reference: https://drafts.csswg.org/css-view-transitions-2/#view-transition-rule
  ["view-transition", atRuleDeclarations],
]);

export const atKnownRuleCanBeRemovedIfEmpty              = new Set([
  "media",
  "supports",
  "font-face",
  "page",

  // https://www.w3.org/TR/css-page-3/#syntax-page-selector
  "bottom-center",
  "bottom-left-corner",
  "bottom-left",
  "bottom-right-corner",
  "bottom-right",
  "left-bottom",
  "left-middle",
  "left-top",
  "right-bottom",
  "right-middle",
  "right-top",
  "top-center",
  "top-left-corner",
  "top-left",
  "top-right-corner",
  "top-right",

  // https://drafts.csswg.org/css-cascade-6/#scoped-styles
  "scope",

  // https://drafts.csswg.org/css-fonts-4/#font-palette-values
  "font-palette-values",

  // https://drafts.csswg.org/css-contain-3/#container-rule
  "container",
]);

// atRuleValidity
export const atRuleInvalid = 0;
export const atRuleValid = 1;
export const atRuleInvalidAfter = 2;

export class atRuleContext {
                           
                                  
                                 
                                        
                                     
                              
  constructor(afterLoc = 0, charsetValidity = atRuleInvalid, importValidity = atRuleInvalid, canInlineNoOpNesting = false, isDeclarationList = false, isTopLevel = false) {
    this.afterLoc = afterLoc;
    this.charsetValidity = charsetValidity;
    this.importValidity = importValidity;
    this.canInlineNoOpNesting = canInlineNoOpNesting;
    this.isDeclarationList = isDeclarationList;
    this.isTopLevel = isTopLevel;
  }
}

export class convertTokensOpts {
  ;                             
  ;                                   
  ;                                     
  constructor(allowImports = false, verbatimWhitespace = false, isInsideCalcFunction = false) {
    this.allowImports = allowImports;
    this.verbatimWhitespace = verbatimWhitespace;
    this.isInsideCalcFunction = isInsideCalcFunction;
  }
}

// Shared, never mutated option values
const DEFAULT_CONVERT_OPTS = new convertTokensOpts(false, false, false);
const ALLOW_IMPORTS_OPTS = new convertTokensOpts(true, false, false);
const ALLOW_IMPORTS_VERBATIM_OPTS = new convertTokensOpts(true, true, false);

export class parseQualifiedRuleOpts {
                                    
                              
                                        
  constructor(isAlreadyInvalid = false, isTopLevel = false, isDeclarationContext = false) {
    this.isAlreadyInvalid = isAlreadyInvalid;
    this.isTopLevel = isTopLevel;
    this.isDeclarationContext = isDeclarationContext;
  }
}

// endOfRuleScan
export const endOfRuleUnknown = 0;
export const endOfRuleSemicolon = 1;
export const endOfRuleOpenBrace = 2;

// scanForEndOfRule's "--foo:" state machine
const customPropIdent = 0;
const customPropColon = 1;
const customPropAccept = 2;
const customPropReject = 3;

// mediaOr
export const mediaWithOr = 0;
export const mediaWithoutOr = 1;

// The "stop" callbacks of parseMediaQueryListUntil
function stopAtImportConditionsEnd(kind        )          {
  return kind === TSemicolon || kind === TOpenBrace || kind === TCloseBrace || kind === TEndOfFile;
}

function stopAtOpenBrace(kind        )          {
  return kind === TOpenBrace;
}

// ---------------------------------------------------------------------------
// DeadRuleRemover

class ruleEntry {
  ;               
  ;                           
  constructor(data   , callCounter        ) {
    this.data = data;
    this.callCounter = callCounter;
  }
}

class callEntry {
  ;                                     
  ;                           
  constructor(importRecords                , sourceIndex        ) {
    this.importRecords = importRecords;
    this.sourceIndex = sourceIndex;
  }
}

// ast.SymbolMap{} (the Go zero value: "SymbolsForSource" is nil)
function zeroSymbolMap()            {
  const symbols = new SymbolMap(0);
  symbols.symbolsForSource = null;
  return symbols;
}

export class DeadRuleRemover {
  ;                                          // (Go: map[uint32]hashEntry)
  ;                          
  ;                                     
  constructor(entries                          , calls             , check                        ) {
    this.entries = entries;
    this.calls = calls;
    this.check = check;
  }

  removeDeadRulesInPlace(sourceIndex        , rules        , importRecords                )         {
    const remover = this;

    // The caller may call this function multiple times, each with a different
    // set of import records. Remember each set of import records for equality
    // checks later.
    const callCounter = remover.calls.length;
    remover.calls.push(new callEntry(importRecords, sourceIndex));

    // Remove duplicate rules, scanning from the back so we keep the last
    // duplicate. Note that the linker calls this, so we do not want to do
    // anything that modifies the rules themselves. One reason is that ASTs
    // are immutable at the linking stage. Another reason is that merging
    // CSS ASTs from separate files will mess up source maps because a single
    // AST cannot simultaneously represent offsets from multiple files.
    const n = rules.length;
    let start = n;
    skipRule: for (let i = n - 1; i >= 0; i--) {
      const rule = rules[i];

      // Remove rules with selectors that don't apply to anything (e.g. ":is()")
      const r = rule.data;
      if (r instanceof RSelector && allSelectorsAreDead(r.selectors)) {
        continue skipRule;
      }

      // For duplicate rules, omit all but the last copy
      const h = rule.data.hash();
      if (h[1]) {
        const hash = h[0];
        let entry = remover.entries.get(hash);
        if (entry !== undefined) {
          for (let j = 0; j < entry.length; j++) {
            const current = entry[j];
            let check                                = null;

            // If this rule was from another file, then pass along both arrays
            // of import records so that the equality check for "url()" tokens
            // can use them to check for equality.
            if (current.callCounter !== callCounter) {
              // Reuse the same memory allocation
              check = remover.check;
              const call = remover.calls[current.callCounter];
              check.importRecordsA = importRecords;
              check.importRecordsB = call.importRecords;
              check.sourceIndexA = sourceIndex;
              check.sourceIndexB = call.sourceIndex;
            }

            if (rule.data.equal(current.data, check)) {
              continue skipRule;
            }
          }
        } else {
          entry = [];
          remover.entries.set(hash, entry);
        }
        entry.push(new ruleEntry(rule.data, callCounter));
      }

      start--;
      rules[start] = rule;
    }

    return rules.slice(start);
  }
}

export function makeDeadRuleMangler(symbols           )                  {
  return new DeadRuleRemover(new Map(), [], new CrossFileEqualityCheck([], [], symbols, 0, 0));
}

export function containsDeadSelectors(selectors                    )          {
  for (let i = 0; i < selectors.length; i++) {
    const sel = selectors[i];
    for (let j = 0; j < sel.subclassSelectors.length; j++) {
      const pseudo = sel.subclassSelectors[j].data;
      if (pseudo instanceof SSPseudoClassWithSelectorList && pseudo.selectors.length === 0 && (pseudo.kind === PseudoClassIs || pseudo.kind === PseudoClassWhere)) {
        // ":is()" and ":where()" never match anything when empty
        return true;
      }
    }
  }
  return false;
}

export function allSelectorsAreDead(selectors                   )          {
  for (let i = 0; i < selectors.length; i++) {
    if (!containsDeadSelectors(selectors[i].selectors)) {
      return false;
    }
  }
  return true;
}

// Reference: https://developer.mozilla.org/en-US/docs/Web/HTML/Element
export const nonDeprecatedElementsSupportedByIE7              = new Set([
  "a",
  "abbr",
  "address",
  "area",
  "b",
  "base",
  "blockquote",
  "body",
  "br",
  "button",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "embed",
  "fieldset",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "hr",
  "html",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "link",
  "map",
  "menu",
  "meta",
  "noscript",
  "object",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "pre",
  "q",
  "ruby",
  "s",
  "samp",
  "script",
  "select",
  "small",
  "span",
  "strong",
  "style",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "u",
  "ul",
  "var",
]);

// This only returns true if all of these selectors are considered "safe" which
// means that they are very likely to work in any browser a user might reasonably
// be using. We do NOT want to merge adjacent qualified rules with the same body
// if any of the selectors are unsafe, since then browsers which don't support
// that particular feature would ignore the entire merged qualified rule:
//
//	Input:
//	  a { color: red }
//	  b { color: red }
//	  input::-moz-placeholder { color: red }
//
//	Valid output:
//	  a, b { color: red }
//	  input::-moz-placeholder { color: red }
//
//	Invalid output:
//	  a, b, input::-moz-placeholder { color: red }
//
// This considers IE 7 and above to be a browser that a user could possibly use.
// Versions of IE less than 6 are not considered.
export function isSafeSelectors(complexSelectors                   )          {
  for (let i = 0; i < complexSelectors.length; i++) {
    const complex = complexSelectors[i];
    for (let j = 0; j < complex.selectors.length; j++) {
      const compound = complex.selectors[j];
      if (compound.nestingSelectorLocs.length > 0) {
        // Bail because this is an extension: https://drafts.csswg.org/css-nesting-1/
        return false;
      }

      if (compound.combinator.byte !== 0) {
        // "Before Internet Explorer 10, the combinator only works in standards mode"
        // Reference: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors
        return false;
      }

      if (compound.typeSelector !== null) {
        if (compound.typeSelector.namespacePrefix !== null) {
          // Bail if we hit a namespace, which doesn't work in IE before version 9
          // Reference: https://developer.mozilla.org/en-US/docs/Web/CSS/Type_selectors
          return false;
        }

        if (compound.typeSelector.name.kind === TIdent && !nonDeprecatedElementsSupportedByIE7.has(compound.typeSelector.name.text)) {
          // Bail if this element is either deprecated or not supported in IE 7
          return false;
        }
      }

      for (let k = 0; k < compound.subclassSelectors.length; k++) {
        const s = compound.subclassSelectors[k].data;
        if (s instanceof SSAttribute) {
          if (s.matcherModifier !== 0) {
            // Bail if we hit a case modifier, which doesn't work in IE at all
            // Reference: https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors
            return false;
          }
        } else if (s instanceof SSPseudoClass) {
          // Bail if this pseudo class doesn't match a hard-coded list that's
          // known to work everywhere. For example, ":focus" doesn't work in IE 7.
          // Reference: https://developer.mozilla.org/en-US/docs/Web/CSS/Pseudo-classes
          if (s.args === null && !s.isElement) {
            switch (s.name) {
              case "active":
              case "first-child":
              case "hover":
              case "link":
              case "visited":
                continue;
            }
          }
          return false;
        } else if (s instanceof SSPseudoClassWithSelectorList) {
          // These definitely don't work in IE 7
          return false;
        }
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Number mangling

// Returns [text, ok]
export function shiftDot(text        , dotOffset        )                    {
  // This doesn't handle numbers with exponents
  if (text.indexOf("e") !== -1 || text.indexOf("E") !== -1) {
    return ["", false];
  }

  // Handle a leading sign
  let sign = "";
  if (text.length > 0 && (text.charCodeAt(0) === 45 /* - */ || text.charCodeAt(0) === 43) /* + */) {
    sign = text.slice(0, 1);
    text = text.slice(1);
  }

  // Remove the dot
  let dot = text.indexOf(".");
  if (dot === -1) {
    dot = text.length;
  } else {
    text = text.slice(0, dot) + text.slice(dot + 1);
  }

  // Move the dot
  dot += dotOffset;

  // Remove any leading zeros before the dot
  while (text.length > 0 && dot > 0 && text.charCodeAt(0) === 48 /* 0 */) {
    text = text.slice(1);
    dot--;
  }

  // Remove any trailing zeros after the dot
  while (text.length > 0 && text.length > dot && text.charCodeAt(text.length - 1) === 48 /* 0 */) {
    text = text.slice(0, text.length - 1);
  }

  // Does this number have no fractional component?
  if (dot >= text.length) {
    const trailingZeros = "0".repeat(dot - text.length);
    return [sign + text + trailingZeros, true];
  }

  // Potentially add leading zeros
  if (dot < 0) {
    text = "0".repeat(-dot) + text;
    dot = 0;
  }

  // Insert the dot again
  return [sign + text.slice(0, dot) + "." + text.slice(dot), true];
}

// Returns [value, unit, ok]
export function mangleDimension(value        , unit        )                            {
  const msLen = 2;
  const sLen = 1;

  // Mangle times: https://developer.mozilla.org/en-US/docs/Web/CSS/time
  if (goEqualFold(unit, "ms")) {
    const r = shiftDot(value, -3);
    if (r[1] && r[0].length + sLen < value.length + msLen) {
      // Convert "ms" to "s" if shorter
      return [r[0], "s", true];
    }
  }
  if (goEqualFold(unit, "s")) {
    const r = shiftDot(value, 3);
    if (r[1] && r[0].length + msLen < value.length + sLen) {
      // Convert "s" to "ms" if shorter
      return [r[0], "ms", true];
    }
  }

  return ["", "", false];
}

// Returns [text, changed]
export function mangleNumber(t        )                    {
  const original = t;

  const dot = t.indexOf(".");
  if (dot !== -1) {
    // Remove trailing zeros
    while (t.length > 0 && t.charCodeAt(t.length - 1) === 48 /* 0 */) {
      t = t.slice(0, t.length - 1);
    }

    // Remove the decimal point if it's unnecessary
    if (dot + 1 === t.length) {
      t = t.slice(0, dot);
      if (t === "" || t === "+" || t === "-") {
        t += "0";
      }
    } else {
      // Remove a leading zero
      if (t.length >= 3 && t.charCodeAt(0) === 48 && t.charCodeAt(1) === 46 && t.charCodeAt(2) >= 48 && t.charCodeAt(2) <= 57) {
        t = t.slice(1);
      } else if (
        t.length >= 4 &&
        (t.charCodeAt(0) === 43 || t.charCodeAt(0) === 45) &&
        t.charCodeAt(1) === 48 &&
        t.charCodeAt(2) === 46 &&
        t.charCodeAt(3) >= 48 &&
        t.charCodeAt(3) <= 57
      ) {
        t = t.slice(0, 1) + t.slice(2);
      }
    }
  }

  return [t, t !== original];
}

// ---------------------------------------------------------------------------
// css_parser_media.go (package-level functions)

export function lowerMediaRange(loc        , name        , cmp        , value         )             {
  switch (cmp) {
    case MQCmpLe:
      // "foo <= 123" => "max-foo: 123"
      return new MediaQuery(loc, new MQPlainOrBoolean("max-" + name, value));

    case MQCmpGe:
      // "foo >= 123" => "min-foo: 123"
      return new MediaQuery(loc, new MQPlainOrBoolean("min-" + name, value));

    case MQCmpLt:
      // "foo < 123" => "not (min-foo: 123)"
      return new MediaQuery(loc, new MQNot(new MediaQuery(loc, new MQPlainOrBoolean("min-" + name, value))));

    case MQCmpGt:
      // "foo > 123" => "not (max-foo: 123)"
      return new MediaQuery(loc, new MQNot(new MediaQuery(loc, new MQPlainOrBoolean("max-" + name, value))));

    default:
      // "foo = 123" => "foo: 123"
      return new MediaQuery(loc, new MQPlainOrBoolean(name, value));
  }
}

// Returns [term, ok]
export function parsePlainOrBooleanMediaFeature(tokens         )                                     {
  if (tokens.length === 1 && tokens[0].kind === TIdent) {
    return [new MQPlainOrBoolean(tokens[0].text, null), true];
  }
  if (tokens.length >= 3 && tokens[0].kind === TIdent && tokens[1].kind === TColon) {
    const r = scanMediaValue(tokens.slice(2));
    if (r[1].length === 0) {
      return [new MQPlainOrBoolean(tokens[0].text, r[0]), true];
    }
  }
  return [null, false];
}

// Returns [term, ok]
export function parseRangeMediaFeature(tokens         )                            {
  const a = scanMediaValue(tokens);
  const first = a[0];
  if (first.length > 0) {
    const b = scanMediaComparison(a[1]);
    const firstCmp = b[0];
    if (firstCmp !== MQCmpNone) {
      const c = scanMediaValue(b[1]);
      const second = c[0];
      const tokens3 = c[1];
      if (second.length > 0) {
        if (tokens3.length === 0) {
          const s1 = isSingleIdent(first);
          if (s1[2]) {
            return [new MQRange([], s1[0], second, s1[1], MQCmpNone, firstCmp), true];
          }
          const s2 = isSingleIdent(second);
          if (s2[2]) {
            return [new MQRange(first, s2[0], [], s2[1], firstCmp, MQCmpNone), true];
          }
        } else {
          const s2 = isSingleIdent(second);
          if (s2[2]) {
            const d = scanMediaComparison(tokens3);
            const secondCmp = d[0];
            if (secondCmp !== MQCmpNone) {
              const f = mqCmpDir(firstCmp);
              const s = mqCmpDir(secondCmp);
              if ((f < 0 && s < 0) || (f > 0 && s > 0)) {
                const e = scanMediaValue(d[1]);
                const third = e[0];
                if (third.length > 0 && e[1].length === 0) {
                  return [new MQRange(first, s2[0], third, s2[1], firstCmp, secondCmp), true];
                }
              }
            }
          }
        }
      }
    }
  }
  return [null, false];
}

// Returns [name, loc, ok]
export function isSingleIdent(tokens         )                            {
  if (tokens.length === 1 && tokens[0].kind === TIdent) {
    return [tokens[0].text, tokens[0].loc, true];
  } else {
    return ["", 0, false];
  }
}

// Returns [cmp, remaining tokens]
export function scanMediaComparison(tokens         )                    {
  if (tokens.length >= 1) {
    switch (tokens[0].kind) {
      case TDelimEquals:
        return [MQCmpEq, tokens.slice(1)];

      case TDelimLessThan:
        // Handle "<=" or "<"
        if (tokens.length >= 2 && tokens[1].kind === TDelimEquals && ((tokens[0].whitespace & WhitespaceAfter) | (tokens[1].whitespace & WhitespaceBefore)) === 0) {
          return [MQCmpLe, tokens.slice(2)];
        }
        return [MQCmpLt, tokens.slice(1)];

      case TDelimGreaterThan:
        // Handle ">=" or ">"
        if (tokens.length >= 2 && tokens[1].kind === TDelimEquals && ((tokens[0].whitespace & WhitespaceAfter) | (tokens[1].whitespace & WhitespaceBefore)) === 0) {
          return [MQCmpGe, tokens.slice(2)];
        }
        return [MQCmpGt, tokens.slice(1)];
    }
  }

  return [MQCmpNone, tokens];
}

// Returns [value, remaining tokens]. Mutates the whitespace of the (shared)
// endpoint tokens like Go does through the slice.
export function scanMediaValue(tokens         )                     {
  let n = 0;

  if (tokens.length >= 1) {
    switch (tokens[0].kind) {
      case TDimension:
      case TIdent:
        n = 1;
        break;

      case TNumber:
        // Potentially recognize a ratio which is "<number> / <number>"
        if (tokens.length >= 3 && tokens[1].kind === TDelimSlash && tokens[2].kind === TNumber) {
          n = 3;
        } else {
          n = 1;
        }
        break;
    }
  }

  // Trim whitespace at the endpoints
  if (n > 0) {
    tokens[0].whitespace &= ~WhitespaceBefore;
    tokens[n - 1].whitespace &= ~WhitespaceAfter;
  }

  return [tokens.slice(0, n), tokens.slice(n)];
}
// generated from css_parser.mts by tools/ts-build.mjs; edit that file
