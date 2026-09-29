// Port of internal/css_parser/css_nesting.go. See CONVENTIONS.md.
//
// JS port notes (Go value semantics):
// - substituteAmpersandsInCompoundSelector takes its compound selector by
//   value in Go and mutates it, so it works on a copy() here. No compound
//   selector object is ever mutated in place, which is what makes it safe to
//   share compound selector objects where Go copies the structs (appending
//   "replacement.Selectors[:last]" to the results, for example).
// - Where Go mutates a ComplexSelector element of a slice in place
//   ("sel := &r.Selectors[i]; sel.Selectors = ..."), the element is replaced
//   by a new ComplexSelector instead.
// - SSPseudoClassWithSelectorList objects are pointers in Go: they are shared
//   between the parent and child selectors and "class.Selectors = outer"
//   mutates the shared object, exactly like Go does.
// - Go's css_ast.Rule{} (nil data) is null here.
// - Rule slices keep Go's nil-ness where it can end up in RKnownAt.rules or
//   RAtLayer.rules (the printer prints ";" for nil and "{}" for empty).
// - Note: the RSelector rules generated for at-rules share one selector
//   array (context.parentSelectorsWithPseudo), as the slice does in Go.
import { goQuote } from "./gostd.mjs";
import {
  Range,
  MsgID_CSS_UnsupportedCSSNesting,
  Warning,
  MsgData,
} from "./logger.mjs";
import {
  Rule,
  RSelector,
  RKnownAt,
  RAtLayer,
  RAtMedia,
  ComplexSelector,
  CompoundSelector,
  SubclassSelector,
  SSPseudoClass,
  SSPseudoClassWithSelectorList,
  NthIndex,
  PseudoClassIs,
  COMBINATOR_NONE,
} from "./css_ast.mjs";
                                                
import { cssFeatureHas, IsPseudoClass } from "./compat_css.mjs";

// leadingCombinatorStrip
export const keepLeadingCombinator = 0;
export const stripLeadingCombinator = 1;

export class lowerNestingContext {
                                                       
                                                     
                                       // (null for Go's nil)
  constructor(parentSelectorsWithPseudo                    = [], parentSelectorsNoPseudo                    = [], loweredRules                = null) {
    this.parentSelectorsWithPseudo = parentSelectorsWithPseudo;
    this.parentSelectorsNoPseudo = parentSelectorsNoPseudo;
    this.loweredRules = loweredRules;
  }
}

;                                                     

function scope(loc        )                  {
  return new ComplexSelector([new CompoundSelector(null, [new SubclassSelector(new SSPseudoClass("scope", null, false), new Range(loc, 0))], [], COMBINATOR_NONE, false)]);
}

export const nestingMethods = {
  // "results" may be null (Go's nil); the result is never null
  lowerNestingInRule(rule      , results               )         {
    const p = this;
    const r = rule.data;
    if (r instanceof RSelector) {
      const parentSelectorsWithPseudo                    = [];
      const parentSelectorsNoPseudo                    = [];
      for (let i = 0; i < r.selectors.length; i++) {
        const sel = r.selectors[i];

        // Top-level "&" should be replaced with ":scope" to avoid recursion.
        // From https://www.w3.org/TR/css-nesting-1/#nest-selector:
        //
        //   "When used in the selector of a nested style rule, the nesting
        //   selector represents the elements matched by the parent rule. When
        //   used in any other context, it represents the same elements as
        //   :scope in that context (unless otherwise defined)."
        //
        let substituted                     = [];
        for (let j = 0; j < sel.selectors.length; j++) {
          substituted = p.substituteAmpersandsInCompoundSelector(sel.selectors[j], scope, substituted, keepLeadingCombinator);
        }
        r.selectors[i] = new ComplexSelector(substituted);

        // Filter out pseudo elements because they are ignored by nested style
        // rules. This is because pseudo-elements are not valid within :is():
        // https://www.w3.org/TR/selectors-4/#matches-pseudo. This restriction
        // may be relaxed in the future, but this restriction has shipped so
        // we're stuck with it: https://github.com/w3c/csswg-drafts/issues/7433.
        //
        // Note: This is only for the parent selector list that is used to
        // substitute "&" within child rules. Do not filter out the pseudo
        // element from the top-level selector list.
        if (!sel.usesPseudoElement()) {
          parentSelectorsNoPseudo.push(new ComplexSelector(substituted));
        }

        // This filtering is only done conditionally because it seems to only
        // apply sometimes. Specifically it doesn't seem to apply when the
        // nested rule is an at-rule. So we use the unfiltered list in that
        // case. See: https://github.com/evanw/esbuild/issues/4265
        parentSelectorsWithPseudo.push(new ComplexSelector(substituted));
      }

      // Emit this selector before its nested children
      if (results === null) {
        results = [];
      }
      const start = results.length;
      results.push(rule);

      // Lower all children and filter out ones that become empty
      const context = new lowerNestingContext(parentSelectorsWithPseudo, parentSelectorsNoPseudo, results);
      r.rules = p.lowerNestingInRulesAndReturnRemaining(r.rules, context);

      // Omit this selector entirely if it's now empty
      if (r.rules.length === 0) {
        context.loweredRules.splice(start, 1);
      }
      return context.loweredRules;
    } else if (r instanceof RKnownAt) {
      let rules                = null;
      const children = r.rules;
      if (children !== null) {
        for (let i = 0; i < children.length; i++) {
          rules = p.lowerNestingInRule(children[i], rules);
        }
      }
      r.rules = rules;
    } else if (r instanceof RAtLayer) {
      let rules                = null;
      const children = r.rules;
      if (children !== null) {
        for (let i = 0; i < children.length; i++) {
          rules = p.lowerNestingInRule(children[i], rules);
        }
      }
      r.rules = rules;
    } else if (r instanceof RAtMedia) {
      let rules                = null;
      const children = r.rules;
      if (children !== null) {
        for (let i = 0; i < children.length; i++) {
          rules = p.lowerNestingInRule(children[i], rules);
        }
      }
      // (Go stores nil here, which nothing distinguishes from an empty
      // slice for "@media")
      r.rules = rules === null ? [] : rules;
    }

    if (results === null) {
      results = [];
    }
    results.push(rule);
    return results;
  },

  // Lower all children and filter out ones that become empty
  // (null in, null out: Go's "rules[:0]" of a nil slice is nil)
  lowerNestingInRulesAndReturnRemaining(rules               , context                     )                {
    const p = this;
    if (rules === null) {
      return null;
    }
    const count = rules.length;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const child = p.lowerNestingInRuleWithContext(rules[i], context);
      if (child !== null) {
        rules[n] = child;
        n++;
      }
    }
    // (Go writes the kept rules into the same backing array)
    return n === count ? rules : rules.slice(0, n);
  },

  addExpansionError(loc        , n        ) {
    const p = this;
    p.log.addErrorWithNotes(p.tracker, new Range(loc, 0), "CSS nesting is causing too much expansion", [
      new MsgData(
        null,
        null,
        "CSS nesting expansion was terminated because a rule was generated with " +
          n +
          " selectors. " +
          "This limit exists to prevent esbuild from using too much time and/or memory. " +
          "Please change your CSS to use fewer levels of nesting.",
      ),
    ]);
  },

  // Returns null for Go's css_ast.Rule{}
  lowerNestingInRuleWithContext(rule      , context                     )              {
    const p = this;
    const r = rule.data;
    if (r instanceof RSelector) {
      const oldSelectorsLen = r.selectors.length;
      const oldSelectorsComplexity = complexSelectorTermCount(r.selectors);

      // "a { & b {} }" => "a b {}"
      // "a { &b {} }" => "a:is(b) {}"
      // "a { &:hover {} }" => "a:hover {}"
      // ".x { &b {} }" => "b.x {}"
      // "a, b { .c, d {} }" => ":is(a, b) :is(.c, d) {}"
      // "a, b { &.c, & d, e & {} }" => ":is(a, b).c, :is(a, b) d, e :is(a, b) {}"

      // Pass 1: Canonicalize and analyze our selectors
      for (let i = 0; i < r.selectors.length; i++) {
        const sel = r.selectors[i];

        // Inject the implicit "&" now for simplicity later on
        if (sel.isRelative()) {
          const selectors                     = [new CompoundSelector(null, [], [rule.loc], COMBINATOR_NONE, false)];
          for (let j = 0; j < sel.selectors.length; j++) {
            selectors.push(sel.selectors[j]);
          }
          r.selectors[i] = new ComplexSelector(selectors);
        }
      }

      // Pass 2: Substitute "&" for the parent selector
      if (!cssFeatureHas(p.options.unsupportedCSSFeatures, IsPseudoClass) || context.parentSelectorsNoPseudo.length <= 1) {
        // If we can use ":is", or we don't have to because there's only one
        // parent selector, or we are using ":is()" to match zero parent selectors
        // (even if ":is" is unsupported), then substituting "&" for the parent
        // selector is easy.
        for (let i = 0; i < r.selectors.length; i++) {
          const complex = r.selectors[i];
          let results                     = [];
          const parent = p.multipleComplexSelectorsToSingleComplexSelector(context.parentSelectorsNoPseudo);
          for (let j = 0; j < complex.selectors.length; j++) {
            results = p.substituteAmpersandsInCompoundSelector(complex.selectors[j], parent, results, keepLeadingCombinator);
          }
          r.selectors[i] = new ComplexSelector(results);
        }
      } else {
        // Otherwise if we can't use ":is", the transform is more complicated.
        // Avoiding ":is" can lead to a combinatorial explosion of cases so we
        // want to avoid this if possible. For example:
        //
        //   .first, .second, .third {
        //     & > & {
        //       color: red;
        //     }
        //   }
        //
        // If we can use ":is" (the easy case above) then we can do this:
        //
        //   :is(.first, .second, .third) > :is(.first, .second, .third) {
        //     color: red;
        //   }
        //
        // But if we can't use ":is" then we have to do this instead:
        //
        //   .first > .first,
        //   .first > .second,
        //   .first > .third,
        //   .second > .first,
        //   .second > .second,
        //   .second > .third,
        //   .third > .first,
        //   .third > .second,
        //   .third > .third {
        //     color: red;
        //   }
        //
        // That combinatorial explosion is what the loop below implements. Note
        // that PostCSS's implementation of nesting gets this wrong. It generates
        // this instead:
        //
        //   .first > .first,
        //   .second > .second,
        //   .third > .third {
        //     color: red;
        //   }
        //
        // That's not equivalent, so that's an incorrect transformation.
        const selectors                    = [];
        const indices           = [];
        const parentSelectorsNoPseudo = context.parentSelectorsNoPseudo;
        for (;;) {
          // Every time we encounter another "&", add another dimension
          let offset = 0;
          const parent = (loc        )                  => {
            if (offset === indices.length) {
              indices.push(0);
            }
            const index = indices[offset];
            offset++;
            return parentSelectorsNoPseudo[index];
          };

          // Do the substitution for this particular combination
          for (let i = 0; i < r.selectors.length; i++) {
            const complex = r.selectors[i];
            let results                     = [];
            for (let j = 0; j < complex.selectors.length; j++) {
              results = p.substituteAmpersandsInCompoundSelector(complex.selectors[j], parent, results, keepLeadingCombinator);
            }
            selectors.push(new ComplexSelector(results));
            offset = 0;
          }

          // Do addition with carry on the indices across dimensions
          let carry = indices.length;
          while (carry > 0) {
            if (indices[carry - 1] + 1 < parentSelectorsNoPseudo.length) {
              indices[carry - 1]++;
              break;
            }
            indices[carry - 1] = 0;
            carry--;
          }
          if (carry === 0) {
            break;
          }
        }
        r.selectors = selectors;
      }

      // Put limits on the combinatorial explosion to avoid using too much time and/or memory
      const n1 = r.selectors.length;
      if (n1 > oldSelectorsLen && n1 > 0xff00) {
        p.addExpansionError(rule.loc, n1);
        return null;
      }
      const n2 = complexSelectorTermCount(r.selectors);
      if (n2 > oldSelectorsComplexity && n2 > 0xff00) {
        p.addExpansionError(rule.loc, n2);
        return null;
      }

      // Lower all child rules using our newly substituted selector
      context.loweredRules = p.lowerNestingInRule(rule, context.loweredRules);
      return null;
    } else if (r instanceof RKnownAt) {
      const childContext = new lowerNestingContext(context.parentSelectorsWithPseudo, context.parentSelectorsNoPseudo, null);
      r.rules = p.lowerNestingInRulesAndReturnRemaining(r.rules, childContext);

      // "div { @supports (color: red) { color: red } }" "@supports (color: red) { div { color: red } }"
      if (r.rules !== null && r.rules.length > 0) {
        childContext.loweredRules = prependRule(new Rule(new RSelector(context.parentSelectorsWithPseudo, r.rules, 0), rule.loc), childContext.loweredRules);
      }

      // "div { @supports (color: red) { &:hover { color: red } } }" "@supports (color: red) { div:hover { color: red } }"
      if (childContext.loweredRules !== null && childContext.loweredRules.length > 0) {
        r.rules = childContext.loweredRules;
        if (context.loweredRules === null) {
          context.loweredRules = [];
        }
        context.loweredRules.push(rule);
      }

      return null;
    } else if (r instanceof RAtMedia) {
      const childContext = new lowerNestingContext(context.parentSelectorsWithPseudo, context.parentSelectorsNoPseudo, null);
      r.rules = p.lowerNestingInRulesAndReturnRemaining(r.rules, childContext);

      // "div { @media screen { color: red } }" "@media screen { div { color: red } }"
      if (r.rules !== null && r.rules.length > 0) {
        childContext.loweredRules = prependRule(new Rule(new RSelector(context.parentSelectorsWithPseudo, r.rules, 0), rule.loc), childContext.loweredRules);
      }

      // "div { @media screen { &:hover { color: red } } }" "@media screen { div:hover { color: red } }"
      if (childContext.loweredRules !== null && childContext.loweredRules.length > 0) {
        r.rules = childContext.loweredRules;
        if (context.loweredRules === null) {
          context.loweredRules = [];
        }
        context.loweredRules.push(rule);
      }

      return null;
    } else if (r instanceof RAtLayer) {
      // Lower all children and filter out ones that become empty
      const childContext = new lowerNestingContext(context.parentSelectorsWithPseudo, context.parentSelectorsNoPseudo, null);
      r.rules = p.lowerNestingInRulesAndReturnRemaining(r.rules, childContext);

      // "div { @layer foo { color: red } }" "@layer foo { div { color: red } }"
      if (r.rules !== null && r.rules.length > 0) {
        childContext.loweredRules = prependRule(new Rule(new RSelector(context.parentSelectorsWithPseudo, r.rules, 0), rule.loc), childContext.loweredRules);
      }

      // "div { @layer foo { &:hover { color: red } } }" "@layer foo { div:hover { color: red } }"
      // "div { @layer foo {} }" => "@layer foo {}" (layers have side effects, so don't remove empty ones)
      r.rules = childContext.loweredRules;
      if (context.loweredRules === null) {
        context.loweredRules = [];
      }
      context.loweredRules.push(rule);
      return null;
    }

    return rule;
  },

  substituteAmpersandsInCompoundSelector(
    sel                  ,
    replacementFn               ,
    results                    ,
    strip        ,
  )                     {
    const p = this;

    // (Go takes "sel" by value and mutates it)
    sel = sel.copy();

    const nestingSelectorLocs = sel.nestingSelectorLocs;
    for (let k = 0; k < nestingSelectorLocs.length; k++) {
      const nestingSelectorLoc = nestingSelectorLocs[k];
      const replacement = replacementFn(nestingSelectorLoc);

      // Convert the replacement to a single compound selector
      let single                  ;
      if (sel.combinator.byte === 0 && (replacement.selectors.length === 1 || results.length === 0)) {
        // ".foo { :hover & {} }" => ":hover .foo {}"
        // ".foo .bar { &:hover {} }" => ".foo .bar:hover {}"
        const last = replacement.selectors.length - 1;
        for (let j = 0; j < last; j++) {
          results.push(replacement.selectors[j]);
        }
        single = replacement.selectors[last];
        if (strip === stripLeadingCombinator) {
          single = single.copy();
          single.combinator = COMBINATOR_NONE;
        }
        sel.combinator = single.combinator;
      } else if (replacement.selectors.length === 1) {
        // ".foo { > &:hover {} }" => ".foo > .foo:hover {}"
        single = replacement.selectors[0];
        if (strip === stripLeadingCombinator) {
          single = single.copy();
          single.combinator = COMBINATOR_NONE;
        }
      } else {
        // ".foo .bar { :hover & {} }" => ":hover :is(.foo .bar) {}"
        // ".foo .bar { > &:hover {} }" => ".foo .bar > :is(.foo .bar):hover {}"
        p.reportNestingWithGeneratedPseudoClassIs(nestingSelectorLoc);
        single = new CompoundSelector(
          null,
          [new SubclassSelector(new SSPseudoClassWithSelectorList([replacement.clone()], new NthIndex(), PseudoClassIs), new Range(nestingSelectorLoc, 0))],
          [],
          COMBINATOR_NONE,
          false,
        );
      }

      const subclassSelectorPrefix                     = [];

      // Insert the type selector
      if (single.typeSelector !== null) {
        if (sel.typeSelector !== null) {
          p.reportNestingWithGeneratedPseudoClassIs(nestingSelectorLoc);
          subclassSelectorPrefix.push(
            new SubclassSelector(
              new SSPseudoClassWithSelectorList([new ComplexSelector([new CompoundSelector(sel.typeSelector)])], new NthIndex(), PseudoClassIs),
              sel.typeSelector.range(),
            ),
          );
        }
        sel.typeSelector = single.typeSelector;
      }

      // Insert the subclass selectors
      const singleSubclassSelectors = single.subclassSelectors;
      for (let j = 0; j < singleSubclassSelectors.length; j++) {
        subclassSelectorPrefix.push(singleSubclassSelectors[j]);
      }

      // Write the changes back
      if (subclassSelectorPrefix.length > 0) {
        const old = sel.subclassSelectors;
        for (let j = 0; j < old.length; j++) {
          subclassSelectorPrefix.push(old[j]);
        }
        sel.subclassSelectors = subclassSelectorPrefix;
      }
    }
    sel.nestingSelectorLocs = [];

    // "div { :is(&.foo) {} }" => ":is(div.foo) {}"
    const subclassSelectors = sel.subclassSelectors;
    for (let i = 0; i < subclassSelectors.length; i++) {
      const class_ = subclassSelectors[i].data;
      if (class_ instanceof SSPseudoClassWithSelectorList) {
        const outer                    = [];
        const classSelectors = class_.selectors;
        for (let j = 0; j < classSelectors.length; j++) {
          const complex = classSelectors[j];
          let inner                     = [];
          for (let k = 0; k < complex.selectors.length; k++) {
            inner = p.substituteAmpersandsInCompoundSelector(complex.selectors[k], replacementFn, inner, stripLeadingCombinator);
          }
          outer.push(new ComplexSelector(inner));
        }
        class_.selectors = outer;
      }
    }

    results.push(sel);
    return results;
  },

  // Turn the list of selectors into a single selector by wrapping lists
  // without a single element with ":is(...)". Note that this may result
  // in an empty ":is()" selector (which matches nothing).
  multipleComplexSelectorsToSingleComplexSelector(selectors                   )                {
    if (selectors.length === 1) {
      return (loc        )                  => {
        return selectors[0];
      };
    }

    let leadingCombinator             = COMBINATOR_NONE;
    const clones                    = new Array(selectors.length);

    for (let i = 0; i < selectors.length; i++) {
      const sel = selectors[i];
      // "> a, > b" => "> :is(a, b)" (the caller should have already checked that all leading combinators are the same)
      leadingCombinator = sel.selectors[0].combinator;
      clones[i] = sel.clone();
    }

    return (loc        )                  => {
      return new ComplexSelector([
        new CompoundSelector(
          null,
          [new SubclassSelector(new SSPseudoClassWithSelectorList(clones, new NthIndex(), PseudoClassIs), new Range(loc, 0))],
          [],
          leadingCombinator,
          false,
        ),
      ]);
    };
  },

  reportNestingWithGeneratedPseudoClassIs(nestingSelectorLoc        ) {
    const p = this;
    if (cssFeatureHas(p.options.unsupportedCSSFeatures, IsPseudoClass)) {
      // (p.nestingWarnings: Go's map[logger.Loc]struct{}, a Set or null)
      if (p.nestingWarnings != null && p.nestingWarnings.has(nestingSelectorLoc)) {
        // Only warn at each location once
        return;
      }
      if (p.nestingWarnings == null) {
        p.nestingWarnings = new Set();
      }
      p.nestingWarnings.add(nestingSelectorLoc);
      let text = "Transforming this CSS nesting syntax is not supported in the configured target environment";
      if (p.options.originalTargetEnv !== "") {
        text = text + " (" + p.options.originalTargetEnv + ")";
      }
      const r = new Range(nestingSelectorLoc, 1);
      p.log.addIDWithNotes(MsgID_CSS_UnsupportedCSSNesting, Warning, p.tracker, r, text, [
        new MsgData(
          null,
          null,
          'The nesting transform for this case must generate an ":is(...)" but the configured target environment does not support the ":is" pseudo-class.',
        ),
      ]);
    }
  },
};

// Go: append([]css_ast.Rule{rule}, rules...)
function prependRule(rule      , rules               )         {
  const result         = [rule];
  if (rules !== null) {
    for (let i = 0; i < rules.length; i++) {
      result.push(rules[i]);
    }
  }
  return result;
}

export function compoundSelectorTermCount(sel                  )         {
  let count = 0;
  for (let i = 0; i < sel.subclassSelectors.length; i++) {
    count++;
    const list = sel.subclassSelectors[i].data;
    if (list instanceof SSPseudoClassWithSelectorList) {
      count += complexSelectorTermCount(list.selectors);
    }
  }
  return count;
}

export function complexSelectorTermCount(selectors                   )         {
  let count = 0;
  for (let i = 0; i < selectors.length; i++) {
    const sel = selectors[i];
    for (let j = 0; j < sel.selectors.length; j++) {
      count += compoundSelectorTermCount(sel.selectors[j]);
    }
  }
  return count;
}
// generated from css_nesting.mts by tools/ts-build.mjs; edit that file
