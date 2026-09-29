// Port of internal/css_parser/css_decls.go and css_decls_{animation,
// border_radius,box,box_shadow,composes,container,font,font_family,
// font_weight,list_style,transform}.go (esbuild 0.28.2). See CONVENTIONS.md.
//
// JS port notes:
// - "*bool" out-params (wouldClipColor) are "{ value: boolean }" objects or
//   null (Go's nil pointer).
// - A removed rule (Go: "css_ast.Rule{}") is RULE_NONE: data null, loc 0.
// - css_ast.Token is a mutable class: wherever Go copies a token by value and
//   then mutates either copy, the port clones.
// - "*token.Children = x" (css_decls_transform.go) replaces the slice behind
//   the shared pointer, so every Go copy of the token sees it. Token.clone()
//   shares the children array like Go shares the pointer, so the port
//   replaces the array's contents in place (replaceChildren).
import { GoPanic } from "./gopanic.mjs";
import { ImportRecord, ImportComposesFrom, refInner } from "./ast.mjs";
import {
  Token,
  Rule,
  RDeclaration,
  Composes,
  ImportedComposesName,
  WhitespaceBefore,
  WhitespaceAfter,
  cloneTokensWithoutImportRecords,
  tokensEqual,
  tokensEqualIgnoringWhitespace,
  tokensAreCommaSeparated,
  DUnknown,
  DComposes,
  DBackground,
  DBackgroundImage,
  DBorderImage,
  DMaskImage,
  DBackgroundColor,
  DBorderBlockEndColor,
  DBorderBlockStartColor,
  DBorderBottomColor,
  DBorderColor,
  DBorderInlineEndColor,
  DBorderInlineStartColor,
  DBorderLeftColor,
  DBorderRightColor,
  DBorderTopColor,
  DCaretColor,
  DColor,
  DColumnRuleColor,
  DFill,
  DFloodColor,
  DLightingColor,
  DOutlineColor,
  DStopColor,
  DStroke,
  DTextDecorationColor,
  DTextEmphasisColor,
  DTransform,
  DBoxShadow,
  DContainer,
  DContainerName,
  DAnimation,
  DAnimationName,
  DListStyle,
  DListStyleType,
  DFont,
  DFontFamily,
  DFontWeight,
  DMargin,
  DMarginTop,
  DMarginRight,
  DMarginBottom,
  DMarginLeft,
  DPadding,
  DPaddingTop,
  DPaddingRight,
  DPaddingBottom,
  DPaddingLeft,
  DInset,
  DTop,
  DRight,
  DBottom,
  DLeft,
  DBorderRadius,
  DBorderTopLeftRadius,
  DBorderTopRightRadius,
  DBorderBottomRightRadius,
  DBorderBottomLeftRadius,
  DBackgroundClip,
  DPosition,
  DWidth,
  DMinWidth,
  DMaxWidth,
  DHeight,
  DMinHeight,
  DMaxHeight,
  DUserSelect,
  DMaskComposite,
} from "./css_ast.mjs";
import {
  TComma,
  TIdent,
  TNumber,
  TDimension,
  TPercentage,
  TString,
  TURL,
  TFunction,
  TDelimSlash,
  TSymbol,
  TEndOfFile,
  tIsNumeric,
  wouldStartIdentifierWithoutEscapes,
  isNameContinue,
  rangeOfIdentifier,
  tString,
  TBadURL,
  TUnterminatedString,
} from "./css_lexer.mjs";
import { cssFeatureHas, InsetProperty, ColorFunctions, WebkitPrefix, KhtmlPrefix, MozPrefix, MsPrefix, OPrefix } from "./compat_css.mjs";
import { Range, RANGE_ZERO, Path, Warning, MsgID_CSS_CSSSyntaxError } from "./logger.mjs";
import { strconvParseFloat, goToLower, goEqualFold, goQuote } from "./gostd.mjs";
import { symbolModeDisabled, shiftDot } from "./css_parser.mjs";
import { looksLikeColor } from "./css_decls_color.mjs";

// Go: css_ast.Rule{} (a removed rule; immutable, so it can be shared)
const RULE_NONE = new Rule(null       , 0);

// ---------------------------------------------------------------------------
// css_decls.go

// Returns [result ([4]Token, fresh copies), ok]
export function expandTokenQuad(tokens         , allowedIdent        )                            {
  const n = tokens.length;
  if (n < 1 || n > 4) {
    return [null, false];
  }

  // Don't do this if we encounter any unexpected tokens such as "var()"
  for (let i = 0; i < n; i++) {
    const t = tokens[i];
    if (!tIsNumeric(t.kind) && (t.kind !== TIdent || allowedIdent === "" || t.text !== allowedIdent)) {
      return [null, false];
    }
  }

  const result          = new Array(4);
  result[0] = tokens[0].clone();
  if (n > 1) {
    result[1] = tokens[1].clone();
  } else {
    result[1] = result[0].clone();
  }
  if (n > 2) {
    result[2] = tokens[2].clone();
  } else {
    result[2] = result[0].clone();
  }
  if (n > 3) {
    result[3] = tokens[3].clone();
  } else {
    result[3] = result[1].clone();
  }

  return [result, true];
}

export function compactTokenQuad(a       , b       , c       , d       , minifyWhitespace         )          {
  // (Go takes the tokens by value)
  const tokens = [a.clone(), b.clone(), c.clone(), d.clone()];
  if (tokens[3].equalIgnoringWhitespace(tokens[1])) {
    if (tokens[2].equalIgnoringWhitespace(tokens[0])) {
      if (tokens[1].equalIgnoringWhitespace(tokens[0])) {
        tokens.length = 1;
      } else {
        tokens.length = 2;
      }
    } else {
      tokens.length = 3;
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    let whitespace = 0;
    if (!minifyWhitespace || i > 0) {
      whitespace |= WhitespaceBefore;
    }
    if (i + 1 < tokens.length) {
      whitespace |= WhitespaceAfter;
    }
    tokens[i].whitespace = whitespace;
  }
  return tokens;
}

export const declsMethods = {
  commaToken(loc        )        {
    const p = this;
    const t = new Token(null, ",", loc, 0, 0, TComma, 0);
    if (!p.options.minifyWhitespace) {
      t.whitespace = WhitespaceAfter;
    }
    return t;
  },

  processDeclarations(rules        , composesContext                        )         {
    const p = this;
    // JS-only: the trackers are only used when minifying syntax, so they are
    // only allocated then
    const minifySyntax          = p.options.minifySyntax;
    const margin = minifySyntax ? new boxTracker("margin", null, true, false, DMargin) : null;
    const padding = minifySyntax ? new boxTracker("padding", null, false, false, DPadding) : null;
    const inset = minifySyntax ? new boxTracker("inset", null, true, false, DInset) : null;
    const borderRadius = minifySyntax ? new borderRadiusTracker() : null;
    let rewrittenRules         = [];
    let didWarnAboutComposes = false;
    const wouldClipColorFlag = { value: false };
    let declarationKeys                     = null;

    // Don't automatically generate the "inset" property if it's not supported
    if (cssFeatureHas(p.options.unsupportedCSSFeatures, InsetProperty) && inset !== null) {
      inset.key = DUnknown;
      inset.keyText = "";
    }

    // If this is a local class selector, track which CSS properties it declares.
    // This is used to warn when CSS "composes" is used incorrectly.
    if (composesContext !== null) {
      const parentRefs = composesContext.parentRefs;
      for (let k = 0; k < parentRefs.length; k++) {
        const ref = parentRefs[k];
        let composes                       = p.composes.get(ref);
        if (composes === undefined) {
          composes = new Composes();
          p.composes.set(ref, composes);
        }
        let properties = composes.properties;
        if (properties === null) {
          properties = new Map();
          composes.properties = properties;
        }
        for (let j = 0; j < rules.length; j++) {
          const decl = rules[j].data;
          if (decl instanceof RDeclaration && decl.key !== DComposes) {
            properties.set(decl.keyText, decl.keyRange.loc);
          }
        }
      }
    }

    for (let i = 0; i < rules.length; i++) {
      let rule = rules[i];
      rewrittenRules.push(rule);
      let decl = rule.data;
      if (!(decl instanceof RDeclaration)) {
        continue;
      }

      // If the previous loop iteration would have clipped a color, we will
      // duplicate it and insert the clipped copy before the unclipped copy
      let wouldClipColor                            = null;
      if (wouldClipColorFlag.value) {
        wouldClipColorFlag.value = false;
        const clone = decl.clone();
        clone.value = cloneTokensWithoutImportRecords(clone.value) || [];
        decl = clone;
        rule = new Rule(decl, rule.loc);
        const n = rewrittenRules.length - 2;
        const prev = rewrittenRules[n];
        rewrittenRules.length = n;
        rewrittenRules.push(rule, prev);
      } else {
        wouldClipColor = wouldClipColorFlag;
      }

      switch (decl.key) {
        case DComposes:
          // Only process "composes" directives if we're in "local-css" or
          // "global-css" mode. In these cases, "composes" directives will always
          // be removed (because they are being processed) even if they contain
          // errors. Otherwise we leave "composes" directives there untouched and
          // don't check them for errors.
          if (p.options.symbolMode !== symbolModeDisabled) {
            if (composesContext === null) {
              if (!didWarnAboutComposes) {
                didWarnAboutComposes = true;
                p.log.addID(MsgID_CSS_CSSSyntaxError, Warning, p.tracker, decl.keyRange, '"composes" is not valid here');
              }
            } else if (composesContext.problemRange.len > 0) {
              if (!didWarnAboutComposes) {
                didWarnAboutComposes = true;
                p.log.addIDWithNotes(MsgID_CSS_CSSSyntaxError, Warning, p.tracker, decl.keyRange, '"composes" only works inside single class selectors', [
                  p.tracker.msgData(composesContext.problemRange, "The parent selector is not a single class selector because of the syntax here:"),
                ]);
              }
            } else {
              p.handleComposesPragma(composesContext, decl.value);
            }
            rewrittenRules.length = rewrittenRules.length - 1;
          }
          break;

        case DBackground: {
          const value = decl.value;
          for (let j = 0; j < value.length; j++) {
            let t = value[j];
            t = p.lowerAndMinifyColor(t, wouldClipColor);
            t = p.lowerAndMinifyGradient(t, wouldClipColor);
            value[j] = t;
          }
          break;
        }

        case DBackgroundImage:
        case DBorderImage:
        case DMaskImage: {
          const value = decl.value;
          for (let j = 0; j < value.length; j++) {
            value[j] = p.lowerAndMinifyGradient(value[j], wouldClipColor);
          }
          break;
        }

        case DBackgroundColor:
        case DBorderBlockEndColor:
        case DBorderBlockStartColor:
        case DBorderBottomColor:
        case DBorderColor:
        case DBorderInlineEndColor:
        case DBorderInlineStartColor:
        case DBorderLeftColor:
        case DBorderRightColor:
        case DBorderTopColor:
        case DCaretColor:
        case DColor:
        case DColumnRuleColor:
        case DFill:
        case DFloodColor:
        case DLightingColor:
        case DOutlineColor:
        case DStopColor:
        case DStroke:
        case DTextDecorationColor:
        case DTextEmphasisColor:
          if (decl.value.length === 1) {
            decl.value[0] = p.lowerAndMinifyColor(decl.value[0], wouldClipColor);
          }
          break;

        case DTransform:
          if (minifySyntax) {
            decl.value = p.mangleTransforms(decl.value);
          }
          break;

        case DBoxShadow:
          decl.value = p.lowerAndMangleBoxShadows(decl.value, wouldClipColor);
          break;

        // Container name
        case DContainer:
          p.processContainerShorthand(decl.value);
          break;
        case DContainerName:
          p.processContainerName(decl.value);
          break;

        // Animation name
        case DAnimation:
          p.processAnimationShorthand(decl.value);
          break;
        case DAnimationName:
          p.processAnimationName(decl.value);
          break;

        // List style
        case DListStyle:
          p.processListStyleShorthand(decl.value);
          break;
        case DListStyleType:
          if (decl.value.length === 1) {
            p.processListStyleType(decl.value[0]);
          }
          break;

        // Font
        case DFont:
          if (minifySyntax) {
            decl.value = p.mangleFont(decl.value);
          }
          break;
        case DFontFamily:
          if (minifySyntax) {
            const r = p.mangleFontFamily(decl.value);
            if (r[1]) {
              decl.value = r[0];
            }
          }
          break;
        case DFontWeight:
          if (decl.value.length === 1 && minifySyntax) {
            decl.value[0] = p.mangleFontWeight(decl.value[0]);
          }
          break;

        // Margin
        case DMargin:
          if (minifySyntax) {
            margin .mangleSides(rewrittenRules, decl, p.options.minifyWhitespace);
          }
          break;
        case DMarginTop:
          if (minifySyntax) {
            margin .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxTop);
          }
          break;
        case DMarginRight:
          if (minifySyntax) {
            margin .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxRight);
          }
          break;
        case DMarginBottom:
          if (minifySyntax) {
            margin .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxBottom);
          }
          break;
        case DMarginLeft:
          if (minifySyntax) {
            margin .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxLeft);
          }
          break;

        // Padding
        case DPadding:
          if (minifySyntax) {
            padding .mangleSides(rewrittenRules, decl, p.options.minifyWhitespace);
          }
          break;
        case DPaddingTop:
          if (minifySyntax) {
            padding .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxTop);
          }
          break;
        case DPaddingRight:
          if (minifySyntax) {
            padding .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxRight);
          }
          break;
        case DPaddingBottom:
          if (minifySyntax) {
            padding .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxBottom);
          }
          break;
        case DPaddingLeft:
          if (minifySyntax) {
            padding .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxLeft);
          }
          break;

        // Inset
        case DInset:
          if (cssFeatureHas(p.options.unsupportedCSSFeatures, InsetProperty)) {
            const r = p.lowerInset(rule.loc, decl);
            if (r[1]) {
              const decls         = r[0];
              rewrittenRules.length = rewrittenRules.length - 1;
              for (let j = 0; j < decls.length; j++) {
                rewrittenRules.push(decls[j]);
                if (minifySyntax) {
                  inset .mangleSide(rewrittenRules, decls[j].data                , p.options.minifyWhitespace, j);
                }
              }
              break;
            }
          }
          if (minifySyntax) {
            inset .mangleSides(rewrittenRules, decl, p.options.minifyWhitespace);
          }
          break;
        case DTop:
          if (minifySyntax) {
            inset .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxTop);
          }
          break;
        case DRight:
          if (minifySyntax) {
            inset .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxRight);
          }
          break;
        case DBottom:
          if (minifySyntax) {
            inset .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxBottom);
          }
          break;
        case DLeft:
          if (minifySyntax) {
            inset .mangleSide(rewrittenRules, decl, p.options.minifyWhitespace, boxLeft);
          }
          break;

        // Border radius
        case DBorderRadius:
          if (minifySyntax) {
            borderRadius .mangleCorners(rewrittenRules, decl, p.options.minifyWhitespace);
          }
          break;
        case DBorderTopLeftRadius:
          if (minifySyntax) {
            borderRadius .mangleCorner(rewrittenRules, decl, p.options.minifyWhitespace, borderRadiusTopLeft);
          }
          break;
        case DBorderTopRightRadius:
          if (minifySyntax) {
            borderRadius .mangleCorner(rewrittenRules, decl, p.options.minifyWhitespace, borderRadiusTopRight);
          }
          break;
        case DBorderBottomRightRadius:
          if (minifySyntax) {
            borderRadius .mangleCorner(rewrittenRules, decl, p.options.minifyWhitespace, borderRadiusBottomRight);
          }
          break;
        case DBorderBottomLeftRadius:
          if (minifySyntax) {
            borderRadius .mangleCorner(rewrittenRules, decl, p.options.minifyWhitespace, borderRadiusBottomLeft);
          }
          break;
      }

      const cssPrefixData                             = p.options.cssPrefixData;
      if (cssPrefixData !== null) {
        const prefixes = cssPrefixData.get(decl.key);
        if (prefixes !== undefined) {
          if (declarationKeys === null) {
            // Only generate this map if it's needed
            declarationKeys = new Set();
            for (let j = 0; j < rules.length; j++) {
              const d = rules[j].data;
              if (d instanceof RDeclaration) {
                declarationKeys.add(d.keyText);
              }
            }
          }
          if ((prefixes & WebkitPrefix) !== 0) {
            rewrittenRules = p.insertPrefixedDeclaration(rewrittenRules, "-webkit-", rule.loc, decl, declarationKeys);
          }
          if ((prefixes & KhtmlPrefix) !== 0) {
            rewrittenRules = p.insertPrefixedDeclaration(rewrittenRules, "-khtml-", rule.loc, decl, declarationKeys);
          }
          if ((prefixes & MozPrefix) !== 0) {
            rewrittenRules = p.insertPrefixedDeclaration(rewrittenRules, "-moz-", rule.loc, decl, declarationKeys);
          }
          if ((prefixes & MsPrefix) !== 0) {
            rewrittenRules = p.insertPrefixedDeclaration(rewrittenRules, "-ms-", rule.loc, decl, declarationKeys);
          }
          if ((prefixes & OPrefix) !== 0) {
            rewrittenRules = p.insertPrefixedDeclaration(rewrittenRules, "-o-", rule.loc, decl, declarationKeys);
          }
        }
      }

      // If this loop iteration would have clipped a color, the out-of-gamut
      // colors will not be clipped and this flag will be set. We then set up the
      // next iteration of the loop to duplicate this rule and process it again
      // with color clipping enabled.
      if (wouldClipColorFlag.value) {
        if (cssFeatureHas(p.options.unsupportedCSSFeatures, ColorFunctions)) {
          // Only do this if there was no previous instance of that property so
          // we avoid overwriting any manually-specified fallback values
          for (let j = rewrittenRules.length - 2; j >= 0; j--) {
            const prev = rewrittenRules[j].data;
            if (prev instanceof RDeclaration && prev.key === decl.key) {
              wouldClipColorFlag.value = false;
              break;
            }
          }
          if (wouldClipColorFlag.value) {
            // If the code above would have clipped a color outside of the sRGB gamut,
            // process this rule again so we can generate the clipped version next time
            i -= 1;
            continue;
          }
        }
        wouldClipColorFlag.value = false;
      }
    }

    // Compact removed rules
    if (minifySyntax) {
      let end = 0;
      for (let j = 0; j < rewrittenRules.length; j++) {
        const rule = rewrittenRules[j];
        if (rule.data !== null) {
          rewrittenRules[end] = rule;
          end++;
        }
      }
      rewrittenRules.length = end;
    }

    return rewrittenRules;
  },

  insertPrefixedDeclaration(rules        , prefix        , loc        , decl              , declarationKeys             )         {
    let keyText = prefix + decl.keyText;

    // Don't insert a prefixed declaration if there already is one
    if (declarationKeys.has(keyText)) {
      // We found a previous declaration with a matching prefixed property.
      // The value is ignored, which matches the behavior of "autoprefixer".
      return rules;
    }

    // Additional special cases for when the prefix applies
    switch (decl.key) {
      case DBackgroundClip:
        // The prefix is only needed for "background-clip: text"
        if (decl.value.length !== 1 || decl.value[0].kind !== TIdent || !goEqualFold(decl.value[0].text, "text")) {
          return rules;
        }
        break;

      case DPosition:
        // The prefix is only needed for "position: sticky"
        if (decl.value.length !== 1 || decl.value[0].kind !== TIdent || !goEqualFold(decl.value[0].text, "sticky")) {
          return rules;
        }
        break;

      case DWidth:
      case DMinWidth:
      case DMaxWidth:
      case DHeight:
      case DMinHeight:
      case DMaxHeight:
        // The prefix is only needed for "width: stretch"
        if (decl.value.length !== 1 || decl.value[0].kind !== TIdent || !goEqualFold(decl.value[0].text, "stretch")) {
          return rules;
        }
        break;
    }

    // (Go's nil for an empty value)
    const value          = cloneTokensWithoutImportRecords(decl.value) || [];

    // Additional special cases for how to transform the contents
    switch (decl.key) {
      case DPosition:
        // The prefix applies to the value, not the property
        keyText = decl.keyText;
        value[0].text = "-webkit-sticky";
        break;

      case DWidth:
      case DMinWidth:
      case DMaxWidth:
      case DHeight:
      case DMinHeight:
      case DMaxHeight:
        // The prefix applies to the value, not the property
        keyText = decl.keyText;

        // This currently only applies to "stretch" (already checked above)
        switch (prefix) {
          case "-webkit-":
            value[0].text = "-webkit-fill-available";
            break;
          case "-moz-":
            value[0].text = "-moz-available";
            break;
        }
        break;

      case DUserSelect:
        // The prefix applies to the value as well as the property
        if (prefix === "-moz-" && value.length === 1 && value[0].kind === TIdent && goEqualFold(value[0].text, "none")) {
          value[0].text = "-moz-none";
        }
        break;

      case DMaskComposite:
        // WebKit uses different names for these values
        if (prefix === "-webkit-") {
          for (let i = 0; i < value.length; i++) {
            const token = value[i];
            if (token.kind === TIdent) {
              switch (token.text) {
                case "add":
                  value[i].text = "source-over";
                  break;
                case "subtract":
                  value[i].text = "source-out";
                  break;
                case "intersect":
                  value[i].text = "source-in";
                  break;
                case "exclude":
                  value[i].text = "xor";
                  break;
              }
            }
          }
        }
        break;
    }

    // If we didn't change the key, manually search for a previous duplicate rule
    if (keyText === decl.keyText) {
      for (let i = 0; i < rules.length; i++) {
        const prevDecl = rules[i].data;
        if (prevDecl instanceof RDeclaration && prevDecl.keyText === keyText && tokensEqual(prevDecl.value, value, null)) {
          return rules;
        }
      }
    }

    // Overwrite the latest declaration with the prefixed declaration
    rules[rules.length - 1] = new Rule(new RDeclaration(keyText, value, decl.keyRange, DUnknown, decl.important), loc);

    // Re-add the latest declaration after the inserted declaration
    rules.push(new Rule(decl, loc));
    return rules;
  },

  // Returns [rules, ok]
  lowerInset(loc        , decl              )                           {
    const p = this;
    const r = expandTokenQuad(decl.value, "");
    if (r[1]) {
      const tokens = r[0] ;
      let mask = ~WhitespaceAfter;
      if (p.options.minifyWhitespace) {
        mask = 0;
      }
      for (let i = 0; i < tokens.length; i++) {
        tokens[i].whitespace &= mask;
      }
      return [
        [
          new Rule(new RDeclaration("top", [tokens[0]], decl.keyRange, DTop, decl.important), loc),
          new Rule(new RDeclaration("right", [tokens[1]], decl.keyRange, DRight, decl.important), loc),
          new Rule(new RDeclaration("bottom", [tokens[2]], decl.keyRange, DBottom, decl.important), loc),
          new Rule(new RDeclaration("left", [tokens[3]], decl.keyRange, DLeft, decl.important), loc),
        ],
        true,
      ];
    }
    return [null, false];
  },

  // -------------------------------------------------------------------------
  // css_decls_animation.go

  // Scan for animation names in the "animation" shorthand property
  processAnimationShorthand(tokens         ) {
    const p = this;
    // (Go: a "foundFlags" struct)
    let foundTimingFunction = false;
    let foundIterationCount = false;
    let foundDirection = false;
    let foundFillMode = false;
    let foundPlayState = false;
    let foundName = false;

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      switch (t.kind) {
        case TComma:
          // Reset the flags when we encounter a comma
          foundTimingFunction = false;
          foundIterationCount = false;
          foundDirection = false;
          foundFillMode = false;
          foundPlayState = false;
          foundName = false;
          break;

        case TNumber:
          if (!foundIterationCount) {
            foundIterationCount = true;
            continue;
          }
          break;

        case TIdent:
          if (!foundTimingFunction) {
            switch (goToLower(t.text)) {
              case "linear":
              case "ease":
              case "ease-in":
              case "ease-out":
              case "ease-in-out":
              case "step-start":
              case "step-end":
                foundTimingFunction = true;
                continue;
            }
          }

          if (!foundIterationCount && goToLower(t.text) === "infinite") {
            foundIterationCount = true;
            continue;
          }

          if (!foundDirection) {
            switch (goToLower(t.text)) {
              case "normal":
              case "reverse":
              case "alternate":
              case "alternate-reverse":
                foundDirection = true;
                continue;
            }
          }

          if (!foundFillMode) {
            switch (goToLower(t.text)) {
              case "none":
              case "forwards":
              case "backwards":
              case "both":
                foundFillMode = true;
                continue;
            }
          }

          if (!foundPlayState) {
            switch (goToLower(t.text)) {
              case "running":
              case "paused":
                foundPlayState = true;
                continue;
            }
          }

          if (!foundName) {
            p.handleSingleAnimationName(tokens[i]);
            foundName = true;
            continue;
          }
          break;

        case TString:
          if (!foundName) {
            p.handleSingleAnimationName(tokens[i]);
            foundName = true;
            continue;
          }
          break;
      }
    }
  },

  processAnimationName(tokens         ) {
    const p = this;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind === TIdent || t.kind === TString) {
        p.handleSingleAnimationName(tokens[i]);
      }
    }
  },

  handleSingleAnimationName(token       ) {
    const p = this;
    // Do not transform CSS keywords into symbols because they have special
    // meaning in declarations. For example, "animation-name: none" clears
    // the animation name. It does not set it to the animation named "none".
    // You need to use "animation-name: 'none'" to do that.
    //
    // Also don't transform strings containing CSS keywords into global symbols
    // because global symbols are passed through without being renamed, which
    // will print them as keywords. However, we still want to unconditionally
    // transform strings into local symbols because local symbols are always
    // renamed, so they will never be printed as keywords.
    if ((token.kind === TIdent || (token.kind === TString && !p.makeLocalSymbols)) && isInvalidAnimationName(token.text)) {
      return;
    }

    token.kind = TSymbol;
    token.payloadIndex = refInner(p.symbolForName(token.loc, token.text).ref);
  },

  // -------------------------------------------------------------------------
  // css_decls_box_shadow.go

  lowerAndMangleBoxShadow(tokens         , wouldClipColor                           )          {
    const p = this;
    let insetCount = 0;
    let colorCount = 0;
    let numbersBegin = 0;
    let numbersCount = 0;
    let numbersDone = false;
    let foundUnexpectedToken = false;

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind === TNumber || t.kind === TDimension) {
        if (numbersDone) {
          // Track if we found a non-number in between two numbers
          foundUnexpectedToken = true;
        }
        // (Go mutates a copy and stores it back only if it changed, which is
        // the same as mutating the token in place)
        if (p.options.minifySyntax) {
          // "0px" => "0"
          t.turnLengthIntoNumberIfZero();
        }
        if (numbersCount === 0) {
          // Track the index of the first number
          numbersBegin = i;
        }
        numbersCount++;
      } else {
        if (numbersCount !== 0) {
          // Track when we find a non-number after a number
          numbersDone = true;
        }

        if (looksLikeColor(t)) {
          colorCount++;
          tokens[i] = p.lowerAndMinifyColor(t, wouldClipColor);
        } else if (t.kind === TIdent && goEqualFold(t.text, "inset")) {
          insetCount++;
        } else {
          // Track if we found a token other than a number, a color, or "inset"
          foundUnexpectedToken = true;
        }
      }
    }

    // If everything looks like a valid rule, trim trailing zeros off the numbers.
    // There are three valid configurations of numbers:
    //
    //   offset-x | offset-y
    //   offset-x | offset-y | blur-radius
    //   offset-x | offset-y | blur-radius | spread-radius
    //
    // If omitted, blur-radius and spread-radius are implied to be zero.
    if (p.options.minifySyntax && insetCount <= 1 && colorCount <= 1 && numbersCount > 2 && numbersCount <= 4 && !foundUnexpectedToken) {
      const numbersEnd = numbersBegin + numbersCount;
      while (numbersCount > 2 && tokens[numbersBegin + numbersCount - 1].isZero()) {
        numbersCount--;
      }
      tokens.splice(numbersBegin + numbersCount, numbersEnd - (numbersBegin + numbersCount));
    }

    // Set the whitespace flags
    for (let i = 0; i < tokens.length; i++) {
      let whitespace = 0;
      if (i > 0 || !p.options.minifyWhitespace) {
        whitespace |= WhitespaceBefore;
      }
      if (i + 1 < tokens.length) {
        whitespace |= WhitespaceAfter;
      }
      tokens[i].whitespace = whitespace;
    }
    return tokens;
  },

  lowerAndMangleBoxShadows(tokens         , wouldClipColor                           )          {
    const p = this;
    const n = tokens.length;
    let end = 0;
    let i = 0;

    while (i < n) {
      // Find the comma or the end of the token list
      let comma = i;
      while (comma < n && tokens[comma].kind !== TComma) {
        comma++;
      }

      // Mangle this individual shadow. (Go passes the sub-slice
      // "tokens[i:comma]" and copies the result back to "tokens[end:]"; the
      // result never extends past "comma", so a copy of the sub-slice works.)
      const shadow          = p.lowerAndMangleBoxShadow(tokens.slice(i, comma), wouldClipColor);
      for (let k = 0; k < shadow.length; k++) {
        tokens[end + k] = shadow[k];
      }
      end += shadow.length;

      // Skip over the comma
      if (comma < n) {
        tokens[end] = tokens[comma];
        end++;
        comma++;
      }
      i = comma;
    }

    tokens.length = end;
    return tokens;
  },

  // -------------------------------------------------------------------------
  // css_decls_composes.go

  handleComposesPragma(context                 , tokens         ) {
    const p = this;
    // (Go: a slice of "nameWithLoc" structs)
    const nameLocs           = [];
    const nameTexts           = [];
    let fromGlobal = false;

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind === TIdent) {
        // Check for a "from" clause at the end
        if (goEqualFold(t.text, "from") && i + 2 === tokens.length) {
          const last = tokens[i + 1];

          // A string or a URL is an external file
          if (last.kind === TString || last.kind === TURL) {
            let importRecordIndex        ;
            if (last.kind === TString) {
              importRecordIndex = p.importRecords.length;
              const record = new ImportRecord();
              record.kind = ImportComposesFrom;
              record.path = new Path(last.text);
              record.range = p.source.rangeOfString(last.loc);
              p.importRecords.push(record);
            } else {
              importRecordIndex = last.payloadIndex;
              p.importRecords[importRecordIndex].kind = ImportComposesFrom;
            }
            const parentRefs = context.parentRefs;
            for (let k = 0; k < parentRefs.length; k++) {
              const composes           = p.composes.get(parentRefs[k]);
              for (let j = 0; j < nameLocs.length; j++) {
                composes.importedNames.push(new ImportedComposesName(nameTexts[j], nameLocs[j], importRecordIndex));
              }
            }
            return;
          }

          // An identifier must be "global"
          if (last.kind === TIdent) {
            if (goEqualFold(last.text, "global")) {
              fromGlobal = true;
              break;
            }

            p.log.addID(MsgID_CSS_CSSSyntaxError, Warning, p.tracker, rangeOfIdentifier(p.source, last.loc), '"composes" declaration uses invalid location ' + goQuote(last.text));
            p.prevError = t.loc;
            return;
          }
        }

        nameLocs.push(t.loc);
        nameTexts.push(t.text);
        continue;
      }

      // Any unexpected tokens are a syntax error
      let text;
      switch (t.kind) {
        case TURL:
        case TBadURL:
        case TString:
        case TUnterminatedString:
          text = "Unexpected " + tString(t.kind);
          break;
        default:
          text = "Unexpected " + goQuote(t.text);
      }
      p.log.addID(MsgID_CSS_CSSSyntaxError, Warning, p.tracker, new Range(t.loc, 0), text);
      p.prevError = t.loc;
      return;
    }

    // If we get here, all of these names are not references to another file
    const old = p.makeLocalSymbols;
    if (fromGlobal) {
      p.makeLocalSymbols = false;
    }
    const parentRefs = context.parentRefs;
    for (let k = 0; k < parentRefs.length; k++) {
      const composes           = p.composes.get(parentRefs[k]);
      for (let j = 0; j < nameLocs.length; j++) {
        composes.names.push(p.symbolForName(nameLocs[j], nameTexts[j]));
      }
    }
    p.makeLocalSymbols = old;
  },

  // -------------------------------------------------------------------------
  // css_decls_container.go

  // Scan for container names in the "container" shorthand property
  processContainerShorthand(tokens         ) {
    const p = this;
    // Validate the syntax
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind === TIdent) {
        continue;
      }
      if (t.kind === TDelimSlash && i + 2 === tokens.length && tokens[i + 1].kind === TIdent) {
        break;
      }
      return;
    }

    // Convert any local names
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind !== TIdent) {
        break;
      }
      p.handleSingleContainerName(tokens[i]);
    }
  },

  processContainerName(tokens         ) {
    const p = this;
    // Validate the syntax
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].kind !== TIdent) {
        return;
      }
    }

    // Convert any local names
    for (let i = 0; i < tokens.length; i++) {
      p.handleSingleContainerName(tokens[i]);
    }
  },

  handleSingleContainerName(token       ) {
    const p = this;
    const lower = goToLower(token.text);
    if (lower === "none" || cssWideAndReservedKeywords.has(lower)) {
      return;
    }

    token.kind = TSymbol;
    token.payloadIndex = refInner(p.symbolForName(token.loc, token.text).ref);
  },

  // -------------------------------------------------------------------------
  // css_decls_font.go

  // Specification: https://drafts.csswg.org/css-fonts/#font-prop
  // [ <font-style> || <font-variant-css2> || <font-weight> || <font-stretch-css3> ]? <font-size> [ / <line-height> ]? <font-family>
  mangleFont(tokens         )          {
    const p = this;
    // (The tokens in "result" are copies: some are mutated below, and
    // "tokens" must stay unchanged when this gives up)
    const result          = [];

    // Scan up to the font size
    let pos = 0;
    for (; pos < tokens.length; pos++) {
      const token = tokens[pos];
      if (isFontSize(token)) {
        break;
      }

      switch (token.kind) {
        case TIdent:
          switch (goToLower(token.text)) {
            case "normal":
              // "All subproperties of the font property are first reset to their initial values"
              // This implies that "normal" doesn't do anything. Also all of the optional values
              // contain "normal" as an option and they are unordered so it's impossible to say
              // what property "normal" corresponds to. Just drop these tokens to save space.
              continue;

            // <font-style>
            case "italic":
              break;
            case "oblique":
              if (pos + 1 < tokens.length && tokens[pos + 1].isAngle()) {
                result.push(token.clone(), tokens[pos + 1].clone());
                pos++;
                continue;
              }
              break;

            // <font-variant-css2>
            case "small-caps":
              break;

            // <font-weight>
            case "bold":
            case "bolder":
            case "lighter": {
              const w = p.mangleFontWeight(token);
              result.push(w === token ? token.clone() : w);
              continue;
            }

            // <font-stretch-css3>
            case "ultra-condensed":
            case "extra-condensed":
            case "condensed":
            case "semi-condensed":
            case "semi-expanded":
            case "expanded":
            case "extra-expanded":
            case "ultra-expanded":
              break;

            default:
              // All other tokens are unrecognized, so we bail if we hit one
              return tokens;
          }
          result.push(token.clone());
          break;

        case TNumber: {
          // "Only values greater than or equal to 1, and less than or equal to
          // 1000, are valid, and all other values are invalid."
          const r = strconvParseFloat(token.text);
          const value = r[0];
          if (!r[1] || value < 1 || value > 1000) {
            return tokens;
          }
          result.push(token.clone());
          break;
        }

        default:
          // All other tokens are unrecognized, so we bail if we hit one
          return tokens;
      }
    }

    // <font-size>
    if (pos === tokens.length) {
      return tokens;
    }
    result.push(tokens[pos].clone());
    pos++;

    // / <line-height>
    if (pos < tokens.length && tokens[pos].kind === TDelimSlash) {
      if (pos + 1 === tokens.length) {
        return tokens;
      }
      result.push(tokens[pos].clone(), tokens[pos + 1].clone());
      pos += 2;

      // Remove the whitespace around the "/" character
      if (p.options.minifyWhitespace) {
        result[result.length - 3].whitespace &= ~WhitespaceAfter;
        result[result.length - 2].whitespace = 0;
        result[result.length - 1].whitespace &= ~WhitespaceBefore;
      }
    }

    // <font-family>
    const r = p.mangleFontFamily(tokens.slice(pos));
    if (r[1]) {
      const family          = r[0];
      if (result.length > 0 && family.length > 0 && family[0].kind !== TString) {
        family[0].whitespace |= WhitespaceBefore;
      }
      for (let i = 0; i < family.length; i++) {
        result.push(family[i]);
      }
      return result;
    }
    return tokens;
  },

  // -------------------------------------------------------------------------
  // css_decls_font_family.go

  // Specification: https://drafts.csswg.org/css-fonts/#font-family-prop
  // Returns [tokens, ok]
  mangleFontFamily(tokens         )                            {
    const p = this;
    let r = p.mangleFamilyNameOrGenericName([], tokens);
    if (!r[2]) {
      return [null, false];
    }
    let result          = r[0];
    let rest          = r[1];

    while (rest.length > 0 && rest[0].kind === TComma) {
      result.push(rest[0].clone());
      r = p.mangleFamilyNameOrGenericName(result, rest.slice(1));
      if (!r[2]) {
        return [null, false];
      }
      result = r[0];
      rest = r[1];
    }

    if (rest.length > 0) {
      return [null, false];
    }

    return [result, true];
  },

  // Returns [result, rest, ok]. The tokens appended to "result" are copies.
  mangleFamilyNameOrGenericName(result         , tokens         )                                            {
    const p = this;
    if (tokens.length > 0) {
      let t = tokens[0];

      // Handle <generic-family>
      if (t.kind === TIdent && genericFamilyNames.has(t.text)) {
        result.push(t.clone());
        return [result, tokens.slice(1), true];
      }

      // Handle <family-name>
      if (t.kind === TString) {
        // "If a sequence of identifiers is given as a <family-name>, the computed
        // value is the name converted to a string by joining all the identifiers
        // in the sequence by single spaces."
        //
        // More information: https://mathiasbynens.be/notes/unquoted-font-family
        const names = t.text.split(" ");
        for (let i = 0; i < names.length; i++) {
          if (!isValidCustomIdent(names[i], genericFamilyNames)) {
            result.push(t.clone());
            return [result, tokens.slice(1), true];
          }
        }
        for (let i = 0; i < names.length; i++) {
          let whitespace = 0;
          if (i !== 0 || !p.options.minifyWhitespace) {
            whitespace = WhitespaceBefore;
          }
          result.push(new Token(null, names[i], t.loc, 0, 0, TIdent, whitespace));
        }
        return [result, tokens.slice(1), true];
      }

      // "Font family names other than generic families must either be given
      // quoted as <string>s, or unquoted as a sequence of one or more
      // <custom-ident>."
      if (t.kind === TIdent) {
        let start = 0;
        for (;;) {
          if (!isValidCustomIdent(t.text, genericFamilyNames)) {
            return [null, null, false];
          }
          result.push(t.clone());
          start++;
          if (start === tokens.length || tokens[start].kind !== TIdent) {
            break;
          }
          t = tokens[start];
        }
        return [result, tokens.slice(start), true];
      }
    }

    // Anything other than the cases listed above causes us to bail
    return [null, null, false];
  },

  // -------------------------------------------------------------------------
  // css_decls_font_weight.go

  // (Go takes and returns the token by value: this returns the token itself
  // when nothing changes and a modified copy otherwise)
  mangleFontWeight(token       )        {
    if (token.kind !== TIdent) {
      return token;
    }

    switch (goToLower(token.text)) {
      case "normal":
        token = token.clone();
        token.text = "400";
        token.kind = TNumber;
        break;
      case "bold":
        token = token.clone();
        token.text = "700";
        token.kind = TNumber;
        break;
    }

    return token;
  },

  // -------------------------------------------------------------------------
  // css_decls_list_style.go

  processListStyleShorthand(tokens         ) {
    const p = this;
    if (tokens.length < 1 || tokens.length > 3) {
      return;
    }

    let foundImage = false;
    let foundPosition = false;
    let typeIndex = -1;
    let noneCount = 0;

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      switch (t.kind) {
        case TString:
          // "list-style-type" is definitely not a <custom-ident>
          return;

        case TURL:
          if (!foundImage) {
            foundImage = true;
            continue;
          }
          break;

        case TFunction:
          if (!foundImage) {
            switch (goToLower(t.text)) {
              case "src":
              case "linear-gradient":
              case "repeating-linear-gradient":
              case "radial-gradient":
              case "radial-linear-gradient":
                foundImage = true;
                continue;
            }
          }
          break;

        case TIdent: {
          const lower = goToLower(t.text);

          // Note: If "none" is present, it's ambiguous whether it applies to
          // "list-style-image" or "list-style-type". To resolve ambiguity it's
          // applied at the end to whichever property isn't otherwise set.
          if (lower === "none") {
            noneCount++;
            continue;
          }

          if (!foundPosition && (lower === "inside" || lower === "outside")) {
            foundPosition = true;
            continue;
          }

          if (typeIndex === -1) {
            if (cssWideAndReservedKeywords.has(lower) || predefinedCounterStyles.has(lower)) {
              // "list-style-type" is definitely not a <custom-ident>
              return;
            }
            typeIndex = i;
            continue;
          }
          break;
        }
      }

      // Bail if we hit an unexpected token
      return;
    }

    if (typeIndex !== -1) {
      // The first "none" applies to "list-style-image" if it's missing
      if (!foundImage && noneCount > 0) {
        noneCount--;
      }

      if (noneCount > 0) {
        // "list-style-type" is "none", not a <custom-ident>
        return;
      }

      const t = tokens[typeIndex];
      if (t.kind === TIdent) {
        t.kind = TSymbol;
        t.payloadIndex = refInner(p.symbolForName(t.loc, t.text).ref);
      }
    }
  },

  processListStyleType(t       ) {
    const p = this;
    if (t.kind === TIdent) {
      const lower = goToLower(t.text);
      if (lower !== "none" && !cssWideAndReservedKeywords.has(lower) && !predefinedCounterStyles.has(lower)) {
        t.kind = TSymbol;
        t.payloadIndex = refInner(p.symbolForName(t.loc, t.text).ref);
      }
    }
  },

  // -------------------------------------------------------------------------
  // css_decls_transform.go

  // https://www.w3.org/TR/css-transforms-1/#two-d-transform-functions
  // https://drafts.csswg.org/css-transforms-2/#transform-functions
  mangleTransforms(tokens         )          {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.kind === TFunction) {
        const args = token.children;
        if (args === null) {
          throw new GoPanic("runtime error: invalid memory address or nil pointer dereference");
        }
        if (tokensAreCommaSeparated(args)) {
          const n = args.length;

          switch (goToLower(token.text)) {
            ////////////////////////////////////////////////////////////////////////////////
            // 2D transforms

            case "matrix":
              // specifies a 2D transformation in the form of a transformation
              // matrix of the six values a, b, c, d, e, f.
              if (n === 11) {
                // | a c 0 e |
                // | b d 0 f |
                // | 0 0 1 0 |
                // | 0 0 0 1 |
                const a = args[0];
                const b = args[2];
                const c = args[4];
                const d = args[6];
                const e = args[8];
                const f = args[10];
                if (b.isZero() && c.isZero() && e.isZero() && f.isZero()) {
                  // | a 0 0 0 |
                  // | 0 d 0 0 |
                  // | 0 0 1 0 |
                  // | 0 0 0 1 |
                  if (a.equalIgnoringWhitespace(d)) {
                    // "matrix(a, 0, 0, a, 0, 0)" => "scale(a)"
                    token.text = "scale";
                    replaceChildren(token, [args[0]]);
                  } else if (d.isOne()) {
                    // "matrix(a, 0, 0, 1, 0, 0)" => "scaleX(a)"
                    token.text = "scaleX";
                    replaceChildren(token, [args[0]]);
                  } else if (a.isOne()) {
                    // "matrix(1, 0, 0, d, 0, 0)" => "scaleY(d)"
                    token.text = "scaleY";
                    replaceChildren(token, [args[6]]);
                  } else {
                    // "matrix(a, 0, 0, d, 0, 0)" => "scale(a, d)"
                    // (Go: "append(args[:2], d)" stores a copy of "d" in args[2])
                    token.text = "scale";
                    replaceChildren(token, [args[0], args[1], d.clone()]);
                  }

                  // Note: A "matrix" cannot be directly converted into a "translate"
                  // because "translate" requires units while "matrix" requires no
                  // units. I'm not sure exactly what the semantics are so I'm not
                  // sure if you can just add "px" or not. Even if that did work,
                  // you still couldn't substitute values containing "var()" since
                  // units would still not be substituted in that case.
                }
              }
              break;

            case "translate":
              // specifies a 2D translation by the vector [tx, ty], where tx is the
              // first translation-value parameter and ty is the optional second
              // translation-value parameter. If <ty> is not provided, ty has zero
              // as a value.
              if (n === 1) {
                args[0].turnLengthOrPercentageIntoNumberIfZero();
              } else if (n === 3) {
                const tx = args[0];
                const ty = args[2];
                tx.turnLengthOrPercentageIntoNumberIfZero();
                ty.turnLengthOrPercentageIntoNumberIfZero();
                if (ty.isZero()) {
                  // "translate(tx, 0)" => "translate(tx)"
                  replaceChildren(token, args.slice(0, 1));
                } else if (tx.isZero()) {
                  // "translate(0, ty)" => "translateY(ty)"
                  token.text = "translateY";
                  replaceChildren(token, args.slice(2));
                }
              }
              break;

            case "translatex":
              // specifies a translation by the given amount in the X direction.
              if (n === 1) {
                // "translateX(tx)" => "translate(tx)"
                token.text = "translate";
                args[0].turnLengthOrPercentageIntoNumberIfZero();
              }
              break;

            case "translatey":
              // specifies a translation by the given amount in the Y direction.
              if (n === 1) {
                args[0].turnLengthOrPercentageIntoNumberIfZero();
              }
              break;

            case "scale":
              // specifies a 2D scale operation by the [sx,sy] scaling vector
              // described by the 2 parameters. If the second parameter is not
              // provided, it takes a value equal to the first. For example,
              // scale(1, 1) would leave an element unchanged, while scale(2, 2)
              // would cause it to appear twice as long in both the X and Y axes,
              // or four times its typical geometric size.
              if (n === 1) {
                turnPercentIntoNumberIfShorter(args[0]);
              } else if (n === 3) {
                const sx = args[0];
                const sy = args[2];
                turnPercentIntoNumberIfShorter(sx);
                turnPercentIntoNumberIfShorter(sy);
                if (sx.equalIgnoringWhitespace(sy)) {
                  // "scale(s, s)" => "scale(s)"
                  replaceChildren(token, args.slice(0, 1));
                } else if (sy.isOne()) {
                  // "scale(s, 1)" => "scaleX(s)"
                  token.text = "scaleX";
                  replaceChildren(token, args.slice(0, 1));
                } else if (sx.isOne()) {
                  // "scale(1, s)" => "scaleY(s)"
                  token.text = "scaleY";
                  replaceChildren(token, args.slice(2));
                }
              }
              break;

            case "scalex":
              // specifies a 2D scale operation using the [sx,1] scaling vector,
              // where sx is given as the parameter.
              if (n === 1) {
                turnPercentIntoNumberIfShorter(args[0]);
              }
              break;

            case "scaley":
              // specifies a 2D scale operation using the [1,sy] scaling vector,
              // where sy is given as the parameter.
              if (n === 1) {
                turnPercentIntoNumberIfShorter(args[0]);
              }
              break;

            case "rotate":
              // specifies a 2D rotation by the angle specified in the parameter
              // about the origin of the element, as defined by the
              // transform-origin property. For example, rotate(90deg) would
              // cause elements to appear rotated one-quarter of a turn in the
              // clockwise direction.
              if (n === 1) {
                args[0].turnLengthIntoNumberIfZero();
              }
              break;

            // Note: This is considered a 2D transform even though it's specified
            // in terms of a 3D transform because it doesn't trigger Safari's 3D
            // transform bugs.
            case "rotatez":
              // same as rotate3d(0, 0, 1, <angle>), which is a 3d transform
              // equivalent to the 2d transform rotate(<angle>).
              if (n === 1) {
                // "rotateZ(angle)" => "rotate(angle)"
                token.text = "rotate";
                args[0].turnLengthIntoNumberIfZero();
              }
              break;

            case "skew":
              // specifies a 2D skew by [ax,ay] for X and Y. If the second
              // parameter is not provided, it has a zero value.
              if (n === 1) {
                args[0].turnLengthIntoNumberIfZero();
              } else if (n === 3) {
                const ax = args[0];
                const ay = args[2];
                ax.turnLengthIntoNumberIfZero();
                ay.turnLengthIntoNumberIfZero();
                if (ay.isZero()) {
                  // "skew(ax, 0)" => "skew(ax)"
                  replaceChildren(token, args.slice(0, 1));
                }
              }
              break;

            case "skewx":
              // specifies a 2D skew transformation along the X axis by the given
              // angle.
              if (n === 1) {
                // "skewX(ax)" => "skew(ax)"
                token.text = "skew";
                args[0].turnLengthIntoNumberIfZero();
              }
              break;

            case "skewy":
              // specifies a 2D skew transformation along the Y axis by the given
              // angle.
              if (n === 1) {
                args[0].turnLengthIntoNumberIfZero();
              }
              break;

            ////////////////////////////////////////////////////////////////////////////////
            // 3D transforms

            // Note: Safari has a bug where 3D transforms render differently than
            // other transforms. This means we should not minify a 3D transform
            // into a 2D transform or it will cause a rendering difference in
            // Safari.

            case "matrix3d":
              // specifies a 3D transformation as a 4x4 homogeneous matrix of 16
              // values in column-major order.
              if (n === 31) {
                // | m0 m4 m8  m12 |
                // | m1 m5 m9  m13 |
                // | m2 m6 m10 m14 |
                // | m3 m7 m11 m15 |
                let mask = 0;
                for (let k = 0; k < 16; k++) {
                  const arg = args[k * 2];
                  if (arg.isZero()) {
                    mask |= 1 << k;
                  } else if (arg.isOne()) {
                    mask |= (1 << 16) << k;
                  }
                }
                const onlyScale = 0x80007bde; // 0b1000_0000_0000_0000_0111_1011_1101_1110
                if ((mask & onlyScale) >>> 0 === onlyScale) {
                  // | m0 0  0   0 |
                  // | 0  m5 0   0 |
                  // | 0  0  m10 0 |
                  // | 0  0  0   1 |
                  const sx = args[0];
                  const sy = args[10];
                  if (sx.isOne() && sy.isOne()) {
                    token.text = "scaleZ";
                    replaceChildren(token, [args[20]]);
                  } else {
                    // (Go: "append(append(args[0:2], args[10:12]...), args[20])"
                    // stores copies of these in args[2:5])
                    token.text = "scale3d";
                    replaceChildren(token, [args[0], args[1], args[10].clone(), args[11].clone(), args[20].clone()]);
                  }
                }

                // Note: A "matrix3d" cannot be directly converted into a "translate3d"
                // because "translate3d" requires units while "matrix3d" requires no
                // units. I'm not sure exactly what the semantics are so I'm not
                // sure if you can just add "px" or not. Even if that did work,
                // you still couldn't substitute values containing "var()" since
                // units would still not be substituted in that case.
              }
              break;

            case "translate3d":
              // specifies a 3D translation by the vector [tx,ty,tz], with tx,
              // ty and tz being the first, second and third translation-value
              // parameters respectively.
              if (n === 5) {
                const tx = args[0];
                const ty = args[2];
                const tz = args[4];
                tx.turnLengthOrPercentageIntoNumberIfZero();
                ty.turnLengthOrPercentageIntoNumberIfZero();
                tz.turnLengthIntoNumberIfZero();
                if (tx.isZero() && ty.isZero()) {
                  // "translate3d(0, 0, tz)" => "translateZ(tz)"
                  token.text = "translateZ";
                  replaceChildren(token, args.slice(4));
                }
              }
              break;

            case "translatez":
              // specifies a 3D translation by the vector [0,0,tz] with the given
              // amount in the Z direction.
              if (n === 1) {
                args[0].turnLengthIntoNumberIfZero();
              }
              break;

            case "scale3d":
              // specifies a 3D scale operation by the [sx,sy,sz] scaling vector
              // described by the 3 parameters.
              if (n === 5) {
                const sx = args[0];
                const sy = args[2];
                const sz = args[4];
                turnPercentIntoNumberIfShorter(sx);
                turnPercentIntoNumberIfShorter(sy);
                turnPercentIntoNumberIfShorter(sz);
                if (sx.isOne() && sy.isOne()) {
                  // "scale3d(1, 1, sz)" => "scaleZ(sz)"
                  token.text = "scaleZ";
                  replaceChildren(token, args.slice(4));
                }
              }
              break;

            case "scalez":
              // specifies a 3D scale operation using the [1,1,sz] scaling vector,
              // where sz is given as the parameter.
              if (n === 1) {
                turnPercentIntoNumberIfShorter(args[0]);
              }
              break;

            case "rotate3d":
              // specifies a 3D rotation by the angle specified in last parameter
              // about the [x,y,z] direction vector described by the first three
              // parameters. A direction vector that cannot be normalized, such as
              // [0,0,0], will cause the rotation to not be applied.
              if (n === 7) {
                const x = args[0];
                const y = args[2];
                const z = args[4];
                const angle = args[6];
                angle.turnLengthIntoNumberIfZero();
                if (x.isOne() && y.isZero() && z.isZero()) {
                  // "rotate3d(1, 0, 0, angle)" => "rotateX(angle)"
                  token.text = "rotateX";
                  replaceChildren(token, args.slice(6));
                } else if (x.isZero() && y.isOne() && z.isZero()) {
                  // "rotate3d(0, 1, 0, angle)" => "rotateY(angle)"
                  token.text = "rotateY";
                  replaceChildren(token, args.slice(6));
                }
              }
              break;

            case "rotatex":
              // same as rotate3d(1, 0, 0, <angle>).
              if (n === 1) {
                args[0].turnLengthIntoNumberIfZero();
              }
              break;

            case "rotatey":
              // same as rotate3d(0, 1, 0, <angle>).
              if (n === 1) {
                args[0].turnLengthIntoNumberIfZero();
              }
              break;

            case "perspective":
              // specifies a perspective projection matrix. This matrix scales
              // points in X and Y based on their Z value, scaling points with
              // positive Z values away from the origin, and those with negative Z
              // values towards the origin. Points on the z=0 plane are unchanged.
              // The parameter represents the distance of the z=0 plane from the
              // viewer.
              if (n === 1) {
                args[0].turnLengthIntoNumberIfZero();
              }
              break;
          }

          // Trim whitespace at the ends
          const args2 = token.children ;
          if (args2.length > 0) {
            args2[0].whitespace &= ~WhitespaceBefore;
            args2[args2.length - 1].whitespace &= ~WhitespaceAfter;
          }
        }
      }
    }

    return tokens;
  },
};

// Go: "*token.Children = newChildren". Every Go copy of the token shares the
// pointer and sees the new slice; Token.clone() shares the children array,
// so replace the array's contents in place. ("newChildren" must be a fresh
// array.)
function replaceChildren(token       , newChildren         ) {
  const children = token.children ;
  children.length = 0;
  for (let i = 0; i < newChildren.length; i++) {
    children.push(newChildren[i]);
  }
}

// ---------------------------------------------------------------------------
// css_decls_animation.go

export function isInvalidAnimationName(text        )          {
  const lower = goToLower(text);
  return lower === "none" || cssWideAndReservedKeywords.has(lower);
}

// ---------------------------------------------------------------------------
// css_decls_box.go (unitSafetyTracker; defined before the zero values below
// that construct one)

// unitSafetyStatus
export const unitSafe = 0; // "margin: 0 1px 2cm 3%;"
export const unitUnsafeSingle = 1; // "margin: 0 1vw 2vw 3vw;"
export const unitUnsafeMixed = 2; // "margin: 0 1vw 2vh 3ch;"

// We can only compact rules together if they have the same unit safety level.
// We want to avoid a situation where the browser treats some of the original
// rules as valid and others as invalid.
//
//	Safe:
//	  top: 1px; left: 0; bottom: 1px; right: 0;
//	  top: 1Q; left: 2Q; bottom: 3Q; right: 4Q;
//
//	Unsafe:
//	  top: 1vh; left: 2vw; bottom: 3vh; right: 4vw;
//	  top: 1Q; left: 2Q; bottom: 3Q; right: 0;
//	  inset: 1Q 0 0 0; top: 0;
//
// (A Go value type: the trackers stored in boxSide/borderRadiusCorner are
// never mutated after being stored, so they are shared.)
export class unitSafetyTracker {
                       
                         
  constructor(unit = "", status = unitSafe) {
    this.unit = unit;
    this.status = status;
  }

  isSafeWith(b                   )          {
    const a = this;
    return a.status === b.status && a.status !== unitUnsafeMixed && (a.status !== unitUnsafeSingle || a.unit === b.unit);
  }

  includeUnitOf(token       ) {
    const t = this;
    switch (token.kind) {
      case TNumber:
        if (token.text === "0") {
          return;
        }
        break;

      case TPercentage:
        return;

      case TDimension:
        if (token.dimensionUnitIsSafeLength()) {
          return;
        } else {
          const unit = token.dimensionUnit();
          if (t.status === unitSafe) {
            t.status = unitUnsafeSingle;
            t.unit = unit;
            return;
          } else if (t.status === unitUnsafeSingle && t.unit === unit) {
            return;
          }
        }
        break;
    }

    t.status = unitUnsafeMixed;
  }
}

// ---------------------------------------------------------------------------
// css_decls_border_radius.go

export const borderRadiusTopLeft = 0;
export const borderRadiusTopRight = 1;
export const borderRadiusBottomRight = 2;
export const borderRadiusBottomLeft = 3;

export class borderRadiusCorner {
                            
                             
                                        
                             // The index of the originating rule in the rules array
                                  // True if the originating rule was just for this side
  constructor(
    firstToken        = new Token(),
    secondToken        = new Token(),
    unitSafety                    = new unitSafetyTracker(),
    ruleIndex = 0,
    wasSingleRule = false,
  ) {
    this.firstToken = firstToken;
    this.secondToken = secondToken;
    this.unitSafety = unitSafety;
    this.ruleIndex = ruleIndex;
    this.wasSingleRule = wasSingleRule;
  }
}

// The zero value. Corners are replaced wholesale by updateCorner (the only
// field write, "corners[corner].secondToken = t", happens right after all
// four corners were replaced), so the zero value can be shared.
const ZERO_BORDER_RADIUS_CORNER = Object.freeze(new borderRadiusCorner())                      ;

function zeroBorderRadiusCorners()                       {
  const z = ZERO_BORDER_RADIUS_CORNER;
  return [z, z, z, z];
}

export class borderRadiusTracker {
  ;                                      // Go: [4]borderRadiusCorner
  ;                           // True if all active rules were flagged as "!important"
  constructor(corners                              = null, important = false) {
    this.corners = corners !== null ? corners : zeroBorderRadiusCorners();
    this.important = important;
  }

  updateCorner(rules        , corner        , new_                    ) {
    const borderRadius = this;
    const old = borderRadius.corners[corner];
    if (old.firstToken.kind !== TEndOfFile && (!new_.wasSingleRule || old.wasSingleRule) && old.unitSafety.status === unitSafe && new_.unitSafety.status === unitSafe) {
      rules[old.ruleIndex] = RULE_NONE;
    }
    borderRadius.corners[corner] = new_;
  }

  mangleCorners(rules        , decl              , minifyWhitespace         ) {
    const borderRadius = this;
    // Reset if we see a change in the "!important" flag
    if (borderRadius.important !== decl.important) {
      borderRadius.corners = zeroBorderRadiusCorners();
      borderRadius.important = decl.important;
    }

    const tokens = decl.value;
    let beforeSplit = tokens.length;
    let afterSplit = tokens.length;

    // Search for the single slash if present
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].kind === TDelimSlash) {
        if (beforeSplit === tokens.length) {
          beforeSplit = i;
          afterSplit = i + 1;
        } else {
          // Multiple slashes are an error
          borderRadius.corners = zeroBorderRadiusCorners();
          return;
        }
      }
    }

    // Use a single tracker for the whole rule
    const unitSafety = new unitSafetyTracker();
    for (let i = 0; i < beforeSplit; i++) {
      unitSafety.includeUnitOf(tokens[i]);
    }
    for (let i = afterSplit; i < tokens.length; i++) {
      unitSafety.includeUnitOf(tokens[i]);
    }

    const first = expandTokenQuad(tokens.slice(0, beforeSplit), "");
    const last = expandTokenQuad(tokens.slice(afterSplit), "");
    const firstRadiiOk = first[1];
    const lastRadiiOk = last[1];

    // Stop now if the pattern wasn't matched
    if (!firstRadiiOk || (beforeSplit < afterSplit && !lastRadiiOk)) {
      borderRadius.corners = zeroBorderRadiusCorners();
      return;
    }

    // Handle the first radii (the quad's tokens are fresh copies, and the
    // stored tokens are never mutated in place, so one object can be both
    // the first and the second token)
    const firstRadii = first[0] ;
    for (let corner = 0; corner < 4; corner++) {
      const t = firstRadii[corner];
      if (unitSafety.status === unitSafe) {
        t.turnLengthIntoNumberIfZero();
      }
      borderRadius.updateCorner(rules, corner, new borderRadiusCorner(t, t, unitSafety, rules.length - 1, false));
    }

    // Handle the last radii
    if (lastRadiiOk) {
      const lastRadii = last[0] ;
      for (let corner = 0; corner < 4; corner++) {
        const t = lastRadii[corner];
        if (unitSafety.status === unitSafe) {
          t.turnLengthIntoNumberIfZero();
        }
        borderRadius.corners[corner].secondToken = t;
      }
    }

    // Success
    borderRadius.compactRules(rules, decl.keyRange, minifyWhitespace);
  }

  mangleCorner(rules        , decl              , minifyWhitespace         , corner        ) {
    const borderRadius = this;
    // Reset if we see a change in the "!important" flag
    if (borderRadius.important !== decl.important) {
      borderRadius.corners = zeroBorderRadiusCorners();
      borderRadius.important = decl.important;
    }

    const tokens = decl.value;
    if ((tokens.length === 1 && tIsNumeric(tokens[0].kind)) || (tokens.length === 2 && tIsNumeric(tokens[0].kind) && tIsNumeric(tokens[1].kind))) {
      // (Go copies: note that with one token, "secondToken" is copied before
      // "firstToken" is turned into a number below)
      const firstToken = tokens[0].clone();
      let secondToken = firstToken.clone();
      if (tokens.length === 2) {
        secondToken = tokens[1].clone();
      }

      // Check to see if these units are safe to use in every browser
      const unitSafety = new unitSafetyTracker();
      unitSafety.includeUnitOf(firstToken);
      unitSafety.includeUnitOf(secondToken);

      // Only collapse "0unit" into "0" if the unit is safe
      if (unitSafety.status === unitSafe && firstToken.turnLengthIntoNumberIfZero()) {
        tokens[0] = firstToken.clone();
      }
      if (tokens.length === 2) {
        if (unitSafety.status === unitSafe && secondToken.turnLengthIntoNumberIfZero()) {
          tokens[1] = secondToken.clone();
        }

        // If both tokens are equal, merge them into one
        if (firstToken.equalIgnoringWhitespace(secondToken)) {
          tokens[0].whitespace &= ~WhitespaceAfter;
          decl.value = tokens.slice(0, 1);
        }
      }

      borderRadius.updateCorner(rules, corner, new borderRadiusCorner(firstToken, secondToken, unitSafety, rules.length - 1, true));
      borderRadius.compactRules(rules, decl.keyRange, minifyWhitespace);
    } else {
      borderRadius.corners = zeroBorderRadiusCorners();
    }
  }

  compactRules(rules        , keyRange       , minifyWhitespace         ) {
    const borderRadius = this;
    const corners = borderRadius.corners;

    // All tokens must be present
    const eof = TEndOfFile;
    if (corners[0].firstToken.kind === eof || corners[1].firstToken.kind === eof || corners[2].firstToken.kind === eof || corners[3].firstToken.kind === eof) {
      return;
    }

    // All tokens must have the same unit
    for (let i = 1; i < 4; i++) {
      if (!corners[i].unitSafety.isSafeWith(corners[0].unitSafety)) {
        return;
      }
    }

    // Generate the most minimal representation
    let tokens = compactTokenQuad(corners[0].firstToken, corners[1].firstToken, corners[2].firstToken, corners[3].firstToken, minifyWhitespace);
    const secondTokens = compactTokenQuad(corners[0].secondToken, corners[1].secondToken, corners[2].secondToken, corners[3].secondToken, minifyWhitespace);
    if (!tokensEqualIgnoringWhitespace(tokens, secondTokens)) {
      let whitespace = 0;
      if (!minifyWhitespace) {
        whitespace = WhitespaceBefore | WhitespaceAfter;
      }
      tokens.push(new Token(null, "/", tokens[tokens.length - 1].loc, 0, 0, TDelimSlash, whitespace));
      for (let i = 0; i < secondTokens.length; i++) {
        tokens.push(secondTokens[i]);
      }
    }

    // Remove all of the existing declarations
    let minLoc = 0;
    for (let i = 0; i < 4; i++) {
      const corner = corners[i];
      const loc = rules[corner.ruleIndex].loc;
      if (i === 0 || loc < minLoc) {
        minLoc = loc;
      }
      rules[corner.ruleIndex] = RULE_NONE;
    }

    // Insert the combined declaration where the last rule was
    rules[corners[3].ruleIndex] = new Rule(new RDeclaration("border-radius", tokens, keyRange, DBorderRadius, borderRadius.important), minLoc);
  }
}

// ---------------------------------------------------------------------------
// css_decls_box.go

export const boxTop = 0;
export const boxRight = 1;
export const boxBottom = 2;
export const boxLeft = 3;

export class boxSide {
                       
                                        
                             // The index of the originating rule in the rules array
                                  // True if the originating rule was just for this side
  constructor(token        = new Token(), unitSafety                    = new unitSafetyTracker(), ruleIndex = 0, wasSingleRule = false) {
    this.token = token;
    this.unitSafety = unitSafety;
    this.ruleIndex = ruleIndex;
    this.wasSingleRule = wasSingleRule;
  }
}

// The zero value (sides are only ever replaced wholesale, so it can be shared)
const ZERO_BOX_SIDE = Object.freeze(new boxSide())           ;

function zeroBoxSides()            {
  const z = ZERO_BOX_SIDE;
  return [z, z, z, z];
}

export class boxTracker {
  ;                       
  ;                         // Go: [4]boxSide
  ;                           // If true, allow the "auto" keyword
  ;                           // True if all active rules were flagged as "!important"
  ;                   
  constructor(keyText = "", sides                   = null, allowAuto = false, important = false, key = DUnknown) {
    this.keyText = keyText;
    this.sides = sides !== null ? sides : zeroBoxSides();
    this.allowAuto = allowAuto;
    this.important = important;
    this.key = key;
  }

  updateSide(rules        , side        , new_         ) {
    const box = this;
    const old = box.sides[side];
    if (old.token.kind !== TEndOfFile && (!new_.wasSingleRule || old.wasSingleRule) && old.unitSafety.status === unitSafe && new_.unitSafety.status === unitSafe) {
      rules[old.ruleIndex] = RULE_NONE;
    }
    box.sides[side] = new_;
  }

  mangleSides(rules        , decl              , minifyWhitespace         ) {
    const box = this;
    // Reset if we see a change in the "!important" flag
    if (box.important !== decl.important) {
      box.sides = zeroBoxSides();
      box.important = decl.important;
    }

    let allowedIdent = "";
    if (box.allowAuto) {
      allowedIdent = "auto";
    }
    const r = expandTokenQuad(decl.value, allowedIdent);
    if (r[1]) {
      const quad = r[0] ;
      // Use a single tracker for the whole rule
      const unitSafety = new unitSafetyTracker();
      for (let i = 0; i < 4; i++) {
        const t = quad[i];
        if (!box.allowAuto || tIsNumeric(t.kind)) {
          unitSafety.includeUnitOf(t);
        }
      }
      // (The quad's tokens are fresh copies that are not used elsewhere)
      for (let side = 0; side < 4; side++) {
        const t = quad[side];
        if (unitSafety.status === unitSafe) {
          t.turnLengthIntoNumberIfZero();
        }
        box.updateSide(rules, side, new boxSide(t, unitSafety, rules.length - 1, false));
      }
      box.compactRules(rules, decl.keyRange, minifyWhitespace);
    } else {
      box.sides = zeroBoxSides();
    }
  }

  mangleSide(rules        , decl              , minifyWhitespace         , side        ) {
    const box = this;
    // Reset if we see a change in the "!important" flag
    if (box.important !== decl.important) {
      box.sides = zeroBoxSides();
      box.important = decl.important;
    }

    const tokens = decl.value;
    if (tokens.length === 1) {
      const t = tokens[0].clone();
      if (tIsNumeric(t.kind) || (t.kind === TIdent && box.allowAuto && goEqualFold(t.text, "auto"))) {
        const unitSafety = new unitSafetyTracker();
        if (!box.allowAuto || tIsNumeric(t.kind)) {
          unitSafety.includeUnitOf(t);
        }
        if (unitSafety.status === unitSafe && t.turnLengthIntoNumberIfZero()) {
          tokens[0] = t.clone();
        }
        box.updateSide(rules, side, new boxSide(t, unitSafety, rules.length - 1, true));
        box.compactRules(rules, decl.keyRange, minifyWhitespace);
        return;
      }
    }

    box.sides = zeroBoxSides();
  }

  compactRules(rules        , keyRange       , minifyWhitespace         ) {
    const box = this;
    // Don't compact if the shorthand form is unsupported
    if (box.key === DUnknown) {
      return;
    }

    // All tokens must be present
    const sides = box.sides;
    const eof = TEndOfFile;
    if (sides[0].token.kind === eof || sides[1].token.kind === eof || sides[2].token.kind === eof || sides[3].token.kind === eof) {
      return;
    }

    // All tokens must have the same unit
    for (let i = 1; i < 4; i++) {
      if (!sides[i].unitSafety.isSafeWith(sides[0].unitSafety)) {
        return;
      }
    }

    // Generate the most minimal representation
    const tokens = compactTokenQuad(sides[0].token, sides[1].token, sides[2].token, sides[3].token, minifyWhitespace);

    // Remove all of the existing declarations
    let minLoc = 0;
    for (let i = 0; i < 4; i++) {
      const side = sides[i];
      const loc = rules[side.ruleIndex].loc;
      if (i === 0 || loc < minLoc) {
        minLoc = loc;
      }
      rules[side.ruleIndex] = RULE_NONE;
    }

    // Insert the combined declaration where the last rule was
    rules[sides[3].ruleIndex] = new Rule(new RDeclaration(box.keyText, tokens, keyRange, box.key, box.important), minLoc);
  }
}

// ---------------------------------------------------------------------------
// css_decls_composes.go

export class composesContext {
  ;                            
  ;                          
  ;                           
  constructor(parentRefs           = [], parentRange        = RANGE_ZERO, problemRange        = RANGE_ZERO) {
    this.parentRefs = parentRefs;
    this.parentRange = parentRange;
    this.problemRange = problemRange;
  }
}

// ---------------------------------------------------------------------------
// css_decls_font.go

export const fontSizeKeywords              = new Set([
  // <absolute-size>: https://drafts.csswg.org/css-fonts/#valdef-font-size-absolute-size
  "xx-small",
  "x-small",
  "small",
  "medium",
  "large",
  "x-large",
  "xx-large",
  "xxx-large",

  // <relative-size>: https://drafts.csswg.org/css-fonts/#valdef-font-size-relative-size
  "larger",
  "smaller",
]);

// Specification: https://drafts.csswg.org/css-fonts/#font-size-prop
export function isFontSize(token       )          {
  // <length-percentage>
  if (token.kind === TDimension || token.kind === TPercentage) {
    return true;
  }

  // <absolute-size> or <relative-size>
  if (token.kind === TIdent) {
    return fontSizeKeywords.has(goToLower(token.text));
  }

  return false;
}

// ---------------------------------------------------------------------------
// css_decls_font_family.go

// These keywords usually require special handling when parsing.

// Declaring a property to have these values explicitly specifies a particular
// defaulting behavior instead of setting the property to that identifier value.
// As specified in CSS Values and Units Level 3, all CSS properties can accept
// these values.
//
// For example, "font-family: 'inherit'" sets the font family to the font named
// "inherit" while "font-family: inherit" sets the font family to the inherited
// value.
//
// Note that other CSS specifications can define additional CSS-wide keywords,
// which we should copy here whenever new ones are created so we can quote those
// identifiers to avoid collisions with any newly-created CSS-wide keywords.
export const cssWideAndReservedKeywords              = new Set([
  // CSS Values and Units Level 3: https://drafts.csswg.org/css-values-3/#common-keywords
  "initial", // CSS-wide keyword
  "inherit", // CSS-wide keyword
  "unset", // CSS-wide keyword
  "default", // CSS reserved keyword

  // CSS Cascading and Inheritance Level 5: https://drafts.csswg.org/css-cascade-5/#defaulting-keywords
  "revert", // Cascade-dependent keyword
  "revert-layer", // Cascade-dependent keyword
]);

// Font family names that happen to be the same as a keyword value must be
// quoted to prevent confusion with the keywords with the same names. UAs must
// not consider these keywords as matching the <family-name> type.
// Specification: https://drafts.csswg.org/css-fonts/#generic-font-families
export const genericFamilyNames              = new Set([
  "serif",
  "sans-serif",
  "cursive",
  "fantasy",
  "monospace",
  "system-ui",
  "emoji",
  "math",
  "fangsong",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
]);

// Specification: https://drafts.csswg.org/css-values-4/#custom-idents
export function isValidCustomIdent(text        , predefinedKeywords             )          {
  const loweredText = goToLower(text);

  if (predefinedKeywords.has(loweredText)) {
    return false;
  }
  if (cssWideAndReservedKeywords.has(loweredText)) {
    return false;
  }
  if (loweredText === "") {
    return false;
  }

  // validate if it contains characters which needs to be escaped
  if (!wouldStartIdentifierWithoutEscapes(text)) {
    return false;
  }
  // (Go iterates runes. Every code point >= 0x80 is a name character, and so
  // is every UTF-16 surrogate code unit or U+FFFD, so checking code units
  // gives the same result.)
  for (let i = 0; i < text.length; i++) {
    if (!isNameContinue(text.charCodeAt(i))) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// css_decls_list_style.go

// https://drafts.csswg.org/css-counter-styles-3/#predefined-counters
export const predefinedCounterStyles              = new Set([
  // 6.1. Numeric:
  "arabic-indic",
  "armenian",
  "bengali",
  "cambodian",
  "cjk-decimal",
  "decimal-leading-zero",
  "decimal",
  "devanagari",
  "georgian",
  "gujarati",
  "gurmukhi",
  "hebrew",
  "kannada",
  "khmer",
  "lao",
  "lower-armenian",
  "lower-roman",
  "malayalam",
  "mongolian",
  "myanmar",
  "oriya",
  "persian",
  "tamil",
  "telugu",
  "thai",
  "tibetan",
  "upper-armenian",
  "upper-roman",

  // 6.2. Alphabetic:
  "hiragana-iroha",
  "hiragana",
  "katakana-iroha",
  "katakana",
  "lower-alpha",
  "lower-greek",
  "lower-latin",
  "upper-alpha",
  "upper-latin",

  // 6.3. Symbolic:
  "circle",
  "disc",
  "disclosure-closed",
  "disclosure-open",
  "square",

  // 6.4. Fixed:
  "cjk-earthly-branch",
  "cjk-heavenly-stem",

  // 7.1.1. Japanese:
  "japanese-formal",
  "japanese-informal",

  // 7.1.2. Korean:
  "korean-hangul-formal",
  "korean-hanja-formal",
  "korean-hanja-informal",

  // 7.1.3. Chinese:
  "simp-chinese-formal",
  "simp-chinese-informal",
  "trad-chinese-formal",
  "trad-chinese-informal",

  // 7.2. Ethiopic Numeric Counter Style:
  "ethiopic-numeric",
]);

// ---------------------------------------------------------------------------
// css_decls_transform.go

export function turnPercentIntoNumberIfShorter(t       ) {
  if (t.kind === TPercentage) {
    const r = shiftDot(t.percentageValue(), -2);
    if (r[1] && r[0].length < t.text.length) {
      t.kind = TNumber;
      t.text = r[0];
    }
  }
}
// generated from css_decls.mts by tools/ts-build.mjs; edit that file
