// JS-only: "deep mode", for input nested more deeply than the JavaScript
// call stack allows (Go's stacks grow up to 1 GB; a JavaScript thread's
// stack is fixed and small, and in a browser it cannot be made larger).
//
// build.mjs (tools/gen-deep.mjs) gives every function of the bundled engine
// that is part of a recursion (the parsers, visitors, printers, ...) a
// generator copy "name$deep" in which each call to another such function is
// "yield name$deep(...)". deepRun() runs a generator copy with an explicit
// stack of suspended generators instead of the call stack, so the recursion
// depth is limited by memory (DEEP_LIMIT) instead of by the call stack.
//
// Deep mode is much slower than the normal functions, so it is only used to
// run a step again when it overflowed the call stack: the parse of a file
// (parseWithTempLog), the printing of a file or chunk by the linker, and a
// transform as a whole (deepRetry). Beyond DEEP_LIMIT suspended calls the
// result is esbuild's panic for a stack overflow, like before.
//
// The source files run as they are (tests, tools) have no generator copies:
// then "deepCompiled" is false and nothing is run again.

// Whether an exception is the JavaScript engine's stack overflow: a
// RangeError "Maximum call stack size exceeded" (V8, JavaScriptCore) or an
// InternalError "too much recursion" (SpiderMonkey)
export function isStackOverflow(e     )          {
  if (e instanceof RangeError) return /call stack/i.test(e.message);
  return e !== null && typeof e === "object" && e.name === "InternalError" && /too much recursion/i.test(e.message);
}

// (build.mjs replaces "false" with "true" after adding the generator copies)
export var __deepCompiled = false;

// Whether the functions with generator copies run them: set while a step
// runs again in deep mode. A call from other code to one of those functions
// checks it (see tools/gen-deep.mjs).
export var __deepMode = false;

// The number of suspended calls at which deep mode overflows (esbuild's
// panic "runtime error: stack overflow"). Each takes memory like a stack
// frame does (a few hundred bytes to a few KB).
const DEEP_LIMIT = 400000;

// Runs a generator copy to its end with an explicit stack: a generator
// yields the generator of each call it makes (and is resumed with its
// result, or with its exception thrown into it)
export function __deepRun(g                          )      {
  const stack                             = [];
  let cur = g;
  let send      = undefined;
  let error      = undefined;
  let isError = false;
  for (;;) {
    let r                          ;
    try {
      if (isError) {
        isError = false;
        r = cur.throw(error);
      } else {
        r = cur.next(send);
      }
    } catch (e) {
      // the call threw: the exception is thrown where it was made
      if (stack.length === 0) throw e;
      cur = stack.pop() ;
      error = e;
      isError = true;
      continue;
    }
    if (r.done) {
      if (stack.length === 0) return r.value;
      cur = stack.pop() ;
      send = r.value;
    } else if (stack.length >= DEEP_LIMIT) {
      // (like the call stack: the call that does not fit throws)
      error = new RangeError("Maximum call stack size exceeded");
      isError = true;
    } else {
      stack.push(cur);
      cur = r.value;
      send = undefined;
    }
  }
}

// Whether "recv.deepName" is the copy of "recv.name": not when the method is
// an own property of the receiver (e.g. set on an object whose prototype has
// the method) and its copy is not
export function __deepOwn(recv     , name        , deepName        )          {
  return !Object.prototype.hasOwnProperty.call(recv, name) || Object.prototype.hasOwnProperty.call(recv, deepName);
}

// A method call from code that has no generator copy ("recv.name(...args)"
// in deep mode): the generator copy of the method when the receiver has one
export function __deepM(recv     , deepName        , name        , ...args       )      {
  const f = recv[deepName];
  if (f === undefined || !__deepOwn(recv, name, deepName)) return recv[name](...args);
  return __deepRun(f.apply(recv, args));
}

// Runs f (again, in deep mode) when it overflows the call stack. f must be
// safe to run again after it threw. The result of the second run is
// returned, or its exception thrown.
export function deepRetry   (f         )    {
  if (__deepMode || !__deepCompiled) return f();
  try {
    return f();
  } catch (e) {
    if (!isStackOverflow(e)) throw e;
  }
  return runDeep(f);
}

// Runs f in deep mode
export function runDeep   (f         )    {
  const previous = __deepMode;
  __deepMode = true;
  try {
    return f();
  } finally {
    __deepMode = previous;
  }
}

// Whether a stack overflow in the normal functions can be retried in deep
// mode (the recover sites let it propagate to the retry)
export function canRetryDeep()          {
  return __deepCompiled && !__deepMode;
}

// A test hook: FAST_ESBUILD_FORCE_DEEP=1 in the environment (Node) runs
// everything in deep mode
export function forceDeepFromEnv() {
  const p      = (globalThis       ).process;
  if (__deepCompiled && p && p.env && p.env.FAST_ESBUILD_FORCE_DEEP === "1") __deepMode = true;
}
// generated from deep.mts by tools/ts-build.mjs; edit that file
