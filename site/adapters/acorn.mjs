// `impl` is acorn or @r1ck404/fast-acorn, `jsxplugin` acorn-jsx or @r1ck404/fast-acorn-jsx.
import * as acorn from "impl";
import jsx from "jsxplugin";

let JsxParser;
let TopLevelParser;
let PluginParser;

// Nodepod's topLevelParser() (syntax-transforms.ts): skips function bodies
// token by token. The same class the repository's benchmark and its
// verification run.
function makeTopLevelParser() {
  const tt = acorn.tokTypes;
  return acorn.Parser.extend(
    (Base) =>
      class extends Base {
        parseFunctionBody(node, isArrowFunction, isMethod, forInit) {
          const self = this;
          if (self.type !== tt.braceL) {
            super.parseFunctionBody(node, isArrowFunction, isMethod, forInit);
            return;
          }
          const body = self.startNode();
          let depth = 0;
          do {
            if (self.type === tt.braceL || self.type === tt.dollarBraceL) depth++;
            else if (self.type === tt.braceR) depth--;
            else if (self.type === tt.eof) self.unexpected();
            self.next();
          } while (depth > 0);
          body.body = [];
          node.body = self.finishNode(body, "BlockStatement");
          node.expression = false;
          self.exitScope();
        }
      },
  );
}

// A plugin that adds a method of its own and changes nothing. fast-acorn does
// not recognise it, so it takes the path for unknown plugins.
function makePluginParser() {
  return acorn.Parser.extend(
    (Base) =>
      class extends Base {
        parseLiteral(value) {
          return super.parseLiteral(value);
        }
      },
  );
}

export async function load() {
  return {
    version: acorn.version,
    parse: (code, options) => acorn.parse(code, options),
    parseJsx: (code, options) => (JsxParser ??= acorn.Parser.extend(jsx())).parse(code, options),
    parseTopLevel: (code, options) => (TopLevelParser ??= makeTopLevelParser()).parse(code, options),
    parsePlugin: (code, options) => (PluginParser ??= makePluginParser()).parse(code, options),
    parseExpressionAt: (code, pos, options) => acorn.parseExpressionAt(code, pos, options),
    tokenize: (code, options) => [...acorn.tokenizer(code, options)],
  };
}
