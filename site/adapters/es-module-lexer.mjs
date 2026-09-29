// `impl` is es-module-lexer or @r1ck404/fast-es-module-lexer.
import { init, parse } from "impl";

export async function load() {
  await init;
  return { parse };
}
