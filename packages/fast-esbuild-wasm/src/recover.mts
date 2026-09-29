// Go's recover() where esbuild uses it to turn a panic into an error
// message: bundler.parseFile ("panic: ... (while parsing ...)") and the
// linker's recoverInternalError ("panic: ... (while printing ...)"). A panic
// is a GoPanic (esbuild's panic(...) and Go's runtime errors), or any other
// exception thrown by the port. The note that Go fills with its goroutine
// stack (helpers.PrettyPrintedStack) holds the JavaScript stack instead.
//
// JS-only: a JavaScript call stack is fixed in size (Go's grows up to 1 GB),
// so deeply nested input can overflow it. Where the host can run the call
// again with a larger stack (Node's main thread: see node_host.mts), the
// overflow propagates (setPropagateStackOverflow); elsewhere it becomes the
// error message of a panic.

import { panicValue } from "./gopanic.mjs";
import { isStackOverflow } from "./deep.mjs";
import { Log, MsgData, RANGE_ZERO } from "./logger.mjs";
import { goQuote } from "./gostd.mjs";

let propagateStackOverflow = false;
export function setPropagateStackOverflow(value: boolean) {
  propagateStackOverflow = value;
}

export { isStackOverflow };

// The "%v" of the recovered value
function recoveredValue(e: any): string {
  if (isStackOverflow(e)) return "runtime error: stack overflow (the input is nested too deeply for the JavaScript call stack)";
  return panicValue(e);
}

// helpers.PrettyPrintedStack: one line per call
export function prettyPrintedStack(e: any): string {
  const stack = e !== null && typeof e === "object" && typeof e.stack === "string" ? e.stack : "";
  const lines: string[] = [];
  for (const line of stack.split("\n")) {
    const m = /^\s*at (.*)$/.exec(line);
    if (m !== null) lines.push(m[1]);
  }
  return lines.join("\n");
}

function checkRecoverable(e: any) {
  if (propagateStackOverflow && isStackOverflow(e)) throw e;
}

// bundler.parseFile's deferred recover()
export function recoverParsePanic(e: any, log: Log, prettyPath: string) {
  checkRecoverable(e);
  log.addErrorWithNotes(null, RANGE_ZERO, "panic: " + recoveredValue(e) + " (while parsing " + goQuote(prettyPath) + ")", [new MsgData(undefined, null, prettyPrintedStack(e))]);
}

// linker.recoverInternalError ("prettyPath" is null for the runtime's source
// index)
export function recoverLinkerPanic(e: any, log: Log, prettyPath: string | null) {
  checkRecoverable(e);
  let text = "panic: " + recoveredValue(e);
  if (prettyPath !== null) {
    text += " (while printing " + goQuote(prettyPath) + ")";
  }
  log.addErrorWithNotes(null, RANGE_ZERO, text, [new MsgData(undefined, null, prettyPrintedStack(e))]);
}
