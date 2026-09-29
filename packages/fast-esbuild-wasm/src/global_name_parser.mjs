// Port of internal/js_parser/global_name_parser.go (ParseGlobalName): the
// "globalName" setting and the names of "define" and "pure".
import { LEXER_PANIC } from "./gopanic.mjs";
                                                
import { newLexerGlobalName, TThis, TImport, TDot, TIdentifier, TEndOfFile, TOpenBracket, TStringLiteral, TCloseBracket } from "./js_lexer.mjs";

// Returns [result, ok]
export function parseGlobalName(log     , source        )                             {
  const result           = [];
  try {
    const lexer = newLexerGlobalName(log, source);

    // Start off with an identifier or a keyword that results in an object
    result.push(lexer.identifier);
    switch (lexer.token) {
      case TThis:
        lexer.next();
        break;

      case TImport:
        // Handle "import.meta"
        lexer.next();
        lexer.expect(TDot);
        result.push(lexer.identifier);
        lexer.expectContextualKeyword("meta");
        break;

      default:
        lexer.expect(TIdentifier);
    }

    // Follow with dot or index expressions
    while (lexer.token !== TEndOfFile) {
      switch (lexer.token) {
        case TDot:
          lexer.next();
          if (!lexer.isIdentifierOrKeyword()) {
            lexer.expect(TIdentifier);
          }
          result.push(lexer.identifier);
          lexer.next();
          break;

        case TOpenBracket:
          lexer.next();
          result.push(lexer.stringLiteral());
          lexer.expect(TStringLiteral);
          lexer.expect(TCloseBracket);
          break;

        default:
          lexer.expect(TDot);
      }
    }
  } catch (e) {
    if (e === LEXER_PANIC) return [result, false];
    throw e;
  }
  return [result, true];
}
// generated from global_name_parser.mts by tools/ts-build.mjs; edit that file
