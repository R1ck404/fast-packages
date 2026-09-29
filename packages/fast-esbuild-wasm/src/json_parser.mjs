// Port of internal/js_parser/json_parser.go (ParseJSON, isValidJSON)
import { goQuote } from "./gostd.mjs";
import { JSFeatureNone, jsFeatureHas, ObjectExtensions } from "./compat.mjs";
                                              
import { LEXER_PANIC } from "./gopanic.mjs";
import { LineColumnTracker, MsgID_JS_DuplicateObjectKey, Warning } from "./logger.mjs";
import { isInsideNodeModules } from "./helpers.mjs";
import {
  newLexerJSON,
  JSON as FlavorJSON,
  TComma,
  TFalse,
  TTrue,
  TNull,
  TStringLiteral,
  TNumericLiteral,
  TMinus,
  TOpenBracket,
  TCloseBracket,
  TOpenBrace,
  TCloseBrace,
  TColon,
  TBigIntegerLiteral,
  TEndOfFile,
} from "./js_lexer.mjs";
import {
  Expr,
  EBoolean,
  ENullShared,
  ENull,
  EString,
  ENumber,
  EArray,
  EObject,
  EBigInt,
  Property,
  PropertyField,
  PropertyIsComputed,
} from "./js_ast.mjs";

class jsonParser {
                   
                      
                       
                     
                       
                                              
  constructor(log, source, tracker, lexer, options, suppressWarningsAboutWeirdCode) {
    this.log = log;
    this.source = source;
    this.tracker = tracker;
    this.lexer = lexer;
    this.options = options;
    this.suppressWarningsAboutWeirdCode = suppressWarningsAboutWeirdCode;
  }

  parseMaybeTrailingComma(closeToken) {
    const p = this;
    const commaRange = p.lexer.range();
    p.lexer.expect(TComma);

    if (p.lexer.token === closeToken) {
      if (p.options.flavor === FlavorJSON) {
        p.log.addError(p.tracker, commaRange, "JSON does not support trailing commas");
      }
      return false;
    }

    return true;
  }

  parseExpr() {
    const p = this;
    const loc = p.lexer.loc();

    switch (p.lexer.token) {
      case TFalse:
        p.lexer.next();
        return new Expr(new EBoolean(false), loc);

      case TTrue:
        p.lexer.next();
        return new Expr(new EBoolean(true), loc);

      case TNull:
        p.lexer.next();
        return new Expr(ENullShared, loc);

      case TStringLiteral: {
        const value = p.lexer.stringLiteral();
        p.lexer.next();
        return new Expr(new EString(value), loc);
      }

      case TNumericLiteral: {
        const value = p.lexer.number;
        p.lexer.next();
        return new Expr(new ENumber(value), loc);
      }

      case TMinus: {
        p.lexer.next();
        const value = p.lexer.number;
        p.lexer.expect(TNumericLiteral);
        return new Expr(new ENumber(-value), loc);
      }

      case TOpenBracket: {
        p.lexer.next();
        let isSingleLine = !p.lexer.hasNewlineBefore;
        const items = [];

        while (p.lexer.token !== TCloseBracket) {
          if (items.length > 0) {
            if (p.lexer.hasNewlineBefore) {
              isSingleLine = false;
            }
            if (!p.parseMaybeTrailingComma(TCloseBracket)) {
              break;
            }
            if (p.lexer.hasNewlineBefore) {
              isSingleLine = false;
            }
          }

          const item = p.parseExpr();
          items.push(item);
        }

        if (p.lexer.hasNewlineBefore) {
          isSingleLine = false;
        }
        const closeBracketLoc = p.lexer.loc();
        p.lexer.expect(TCloseBracket);
        return new Expr(new EArray(items, 0, closeBracketLoc, isSingleLine), loc);
      }

      case TOpenBrace: {
        p.lexer.next();
        let isSingleLine = !p.lexer.hasNewlineBefore;
        const properties = [];
        const duplicates = new Map(); // map[string]logger.Range

        while (p.lexer.token !== TCloseBrace) {
          if (properties.length > 0) {
            if (p.lexer.hasNewlineBefore) {
              isSingleLine = false;
            }
            if (!p.parseMaybeTrailingComma(TCloseBrace)) {
              break;
            }
            if (p.lexer.hasNewlineBefore) {
              isSingleLine = false;
            }
          }

          const keyString = p.lexer.stringLiteral();
          const keyRange = p.lexer.range();
          const key = new Expr(new EString(keyString), keyRange.loc);
          p.lexer.expect(TStringLiteral);

          // Warn about duplicate keys
          if (!p.suppressWarningsAboutWeirdCode) {
            const keyText = keyString; // helpers.UTF16ToString
            const prevRange = duplicates.get(keyText);
            if (prevRange !== undefined) {
              p.log.addIDWithNotes(MsgID_JS_DuplicateObjectKey, Warning, p.tracker, keyRange, "Duplicate key " + goQuote(keyText) + " in object literal", [
                p.tracker.msgData(prevRange, "The original key " + goQuote(keyText) + " is here:"),
              ]);
            } else {
              duplicates.set(keyText, keyRange);
            }
          }

          p.lexer.expect(TColon);
          const value = p.parseExpr();

          const property = new Property(null, key, value, null, [], keyRange.loc, 0, PropertyField, 0);

          // The key "__proto__" must not be a string literal in JavaScript because
          // that actually modifies the prototype of the object. This can be
          // avoided by using a computed property key instead of a string literal.
          if (keyString === "__proto__" && !jsFeatureHas(p.options.unsupportedJSFeatures, ObjectExtensions)) {
            property.flags |= PropertyIsComputed;
          }

          properties.push(property);
        }

        if (p.lexer.hasNewlineBefore) {
          isSingleLine = false;
        }
        const closeBraceLoc = p.lexer.loc();
        p.lexer.expect(TCloseBrace);
        return new Expr(new EObject(properties, 0, closeBraceLoc, isSingleLine), loc);
      }

      case TBigIntegerLiteral: {
        if (!p.options.isForDefine) {
          p.lexer.unexpected();
        }
        const value = p.lexer.identifier;
        p.lexer.next();
        return new Expr(new EBigInt(value), loc);
      }

      default:
        p.lexer.unexpected();
        return null;
    }
  }
}

export function isValidJSON(value)          {
  const e = value.data;
  if (e instanceof ENull || e instanceof EBoolean || e instanceof EString || e instanceof ENumber) {
    return true;
  }
  if (e instanceof EArray) {
    for (const item of e.items) {
      if (!isValidJSON(item)) {
        return false;
      }
    }
    return true;
  }
  if (e instanceof EObject) {
    for (const property of e.properties) {
      if (property.kind !== PropertyField || (property.flags & PropertyIsComputed) !== 0) {
        return false;
      }
      if (!(property.key.data instanceof EString)) {
        return false;
      }
      if (!isValidJSON(property.valueOrNil)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export class JSONOptions {
  ;                                        
  ;                      
  ;                           
  ;                            
  constructor(unsupportedJSFeatures = JSFeatureNone, flavor = FlavorJSON, errorSuffix = "", isForDefine = false) {
    this.unsupportedJSFeatures = unsupportedJSFeatures;
    this.flavor = flavor;
    this.errorSuffix = errorSuffix;
    this.isForDefine = isForDefine;
  }
}

// Returns [result (Expr or null), ok]
export function parseJSON(log, source, options)                  {
  let errorSuffix = options.errorSuffix;
  if (errorSuffix === "") {
    errorSuffix = " in JSON";
  }

  try {
    const p = new jsonParser(
      log,
      source,
      new LineColumnTracker(source),
      newLexerJSON(log, source, options.flavor, errorSuffix),
      options,
      isInsideNodeModules(source.keyPath.text),
    );

    const result = p.parseExpr();
    p.lexer.expect(TEndOfFile);
    return [result, true];
  } catch (e) {
    if (e === LEXER_PANIC) return [null, false];
    throw e;
  }
}
// generated from json_parser.mts by tools/ts-build.mjs; edit that file
