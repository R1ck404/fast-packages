// Mirror of esbuild 0.28.2's JS glue flagsForTransformOptions (pushLogFlags +
// pushCommonFlags + the transform flags, in the glue's order) for the tests,
// which call the engine directly with the flag list the glue would send.
export function flagsFor(o) {
  // (pushLogFlags: transform()'s default log level is "silent")
  const flags = [];
  if (o.color !== undefined) flags.push(`--color=${o.color}`);
  flags.push(`--log-level=${o.logLevel || "silent"}`);
  flags.push(`--log-limit=${o.logLimit || 0}`);
  if (o.logStyle) flags.push(`--log-style=${o.logStyle}`);
  if (o.legalComments) flags.push(`--legal-comments=${o.legalComments}`);
  if (o.sourceRoot !== undefined) flags.push(`--source-root=${o.sourceRoot}`);
  if (o.sourcesContent !== undefined) flags.push(`--sources-content=${o.sourcesContent}`);
  if (o.target) flags.push(`--target=${(Array.isArray(o.target) ? o.target : [o.target]).join(",")}`);
  if (o.format) flags.push(`--format=${o.format}`);
  if (o.globalName) flags.push(`--global-name=${o.globalName}`);
  if (o.platform) flags.push(`--platform=${o.platform}`);
  if (o.tsconfigRaw) flags.push(`--tsconfig-raw=${typeof o.tsconfigRaw === "string" ? o.tsconfigRaw : JSON.stringify(o.tsconfigRaw)}`);
  if (o.minify) flags.push("--minify");
  if (o.minifySyntax) flags.push("--minify-syntax");
  if (o.minifyWhitespace) flags.push("--minify-whitespace");
  if (o.minifyIdentifiers) flags.push("--minify-identifiers");
  if (o.lineLimit) flags.push(`--line-limit=${o.lineLimit}`);
  if (o.charset) flags.push(`--charset=${o.charset}`);
  if (o.treeShaking !== undefined) flags.push(`--tree-shaking=${o.treeShaking}`);
  if (o.ignoreAnnotations) flags.push(`--ignore-annotations`);
  if (o.drop) for (const what of o.drop) flags.push(`--drop:${what}`);
  if (o.dropLabels) flags.push(`--drop-labels=${o.dropLabels.join(",")}`);
  if (o.absPaths) flags.push(`--abs-paths=${o.absPaths.join(",")}`);
  if (o.mangleProps) flags.push(`--mangle-props=${goRegExp(o.mangleProps)}`);
  if (o.reserveProps) flags.push(`--reserve-props=${goRegExp(o.reserveProps)}`);
  if (o.mangleQuoted !== undefined) flags.push(`--mangle-quoted=${o.mangleQuoted}`);
  if (o.jsx) flags.push(`--jsx=${o.jsx}`);
  if (o.jsxFactory) flags.push(`--jsx-factory=${o.jsxFactory}`);
  if (o.jsxFragment) flags.push(`--jsx-fragment=${o.jsxFragment}`);
  if (o.jsxImportSource) flags.push(`--jsx-import-source=${o.jsxImportSource}`);
  if (o.jsxDev) flags.push(`--jsx-dev`);
  if (o.jsxSideEffects) flags.push(`--jsx-side-effects`);
  if (o.define) for (const key in o.define) flags.push(`--define:${key}=${o.define[key]}`);
  if (o.logOverride) for (const key in o.logOverride) flags.push(`--log-override:${key}=${o.logOverride[key]}`);
  if (o.supported) for (const key in o.supported) flags.push(`--supported:${key}=${o.supported[key]}`);
  if (o.pure) for (const fn of o.pure) flags.push(`--pure:${fn}`);
  if (o.keepNames) flags.push(`--keep-names`);
  if (o.sourcemap) flags.push(`--sourcemap=${o.sourcemap === true ? "external" : o.sourcemap}`);
  if (o.sourcefile) flags.push(`--sourcefile=${o.sourcefile}`);
  if (o.loader) flags.push(`--loader=${o.loader}`);
  if (o.banner) flags.push(`--banner=${o.banner}`);
  if (o.footer) flags.push(`--footer=${o.footer}`);
  return flags;
}

// Native esbuild's transformSync for the differential tests. A few inputs
// make esbuild itself panic (e.g. an index out of range in its renamer), which
// stops its service for the rest of the process: then esbuild is reloaded and
// ESBUILD_CRASHED is returned (the case is skipped).
export const ESBUILD_CRASHED = Symbol("esbuild crashed");
export function makeRefTransform(require) {
  let esbuild = require("esbuild");
  return (code, opts) => {
    try {
      return esbuild.transformSync(code, opts);
    } catch (e) {
      // (a transform error has esbuild messages, or is the service's error
      // for a flag it rejects; anything else is a crash: a Go panic, "The
      // service was stopped", a failed child process, ...)
      const crashed = !(e instanceof Error) || /panic:|runtime error:|The service (was stopped|is no longer running)/.test(String(e.message));
      if (!crashed) throw e;
      for (const key of Object.keys(require.cache)) {
        if (/[\\/]node_modules[\\/]esbuild[\\/]/.test(key)) delete require.cache[key];
      }
      esbuild = require("esbuild");
      return ESBUILD_CRASHED;
    }
  };
}

// esbuild-wasm's transformSync (its Node API: Go on wasm in a child process).
// Native esbuild and esbuild-wasm run the same Go code, but a few float to
// int conversions are platform-defined in Go (int(NaN) is MinInt64 on amd64
// and 0 on wasm), which changes some constant folding under minifySyntax
// (e.g. "1 >>> NaN"). The port replaces esbuild-wasm, so a difference from
// native esbuild is re-checked against esbuild-wasm (slow, so only then).
export function makeWasmTransform(require) {
  let wasm = null;
  return (code, opts) => {
    if (wasm === null) wasm = require("esbuild-wasm");
    try {
      return wasm.transformSync(code, opts);
    } catch {
      return null;
    }
  };
}

// The glue's jsRegExpToGoRegExp
function goRegExp(regexp) {
  let result = regexp.source;
  if (regexp.flags) result = `(?${regexp.flags})${result}`;
  return result;
}

// Vite 7's default build.target ("baseline-widely-available")
export const VITE_TARGETS = ["chrome107", "edge107", "firefox104", "safari16"];
// Vite 5/6's default build.target ("modules"). With esbuild 0.28.2, safari14
// makes every destructuring pattern an error.
export const VITE5_TARGETS = ["es2020", "edge88", "firefox78", "chrome87", "safari14"];

// Messages as esbuild's glue returns them (the fast path's response packet
// has the same fields plus "detail", -1 for none, which the glue turns into
// undefined), as comparable JSON: every field, in order
export function messagesJSON(msgs) {
  const loc = (l) => (l === null || l === undefined ? l : { file: l.file, namespace: l.namespace, line: l.line, column: l.column, length: l.length, lineText: l.lineText, suggestion: l.suggestion });
  return JSON.stringify(
    (msgs || []).map((m) => ({
      id: m.id,
      pluginName: m.pluginName,
      text: m.text,
      location: loc(m.location),
      notes: (m.notes || []).map((n) => ({ text: n.text, location: loc(n.location) })),
      detail: m.detail === -1 || m.detail === 4294967295 ? undefined : m.detail,
    })),
  );
}
// null if equal, else a description of the first difference
export function firstMessageDiff(ref, fast) {
  const a = messagesJSON(ref);
  const b = messagesJSON(fast);
  if (a === b) return null;
  const ra = JSON.parse(a);
  const rb = JSON.parse(b);
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    const x = JSON.stringify(ra[i]);
    const y = JSON.stringify(rb[i]);
    if (x !== y) return "  message " + i + " of " + ra.length + "/" + rb.length + "\n    esbuild: " + String(x).slice(0, 600) + "\n    fast:    " + String(y).slice(0, 600);
  }
  return "  (?)";
}

// The category of a transform the fast path answered (or declined) compared
// with esbuild's result ("ref", or the error "refError" it threw):
//   bail / bothFail   the fast path declined (esbuild succeeded / failed)
//   FALSE-ACCEPT      esbuild failed but the fast path returned no errors
//   FALSE-ERROR       the fast path reports errors but esbuild succeeded
//   MSG-MISMATCH      different errors or warnings
//   MISMATCH          different output
//   okError           both failed with identical messages
//   ok
// Returns [category, description of the difference or null].
export function classifyTransform(ref, refError, fast) {
  if (fast === undefined) return [ref === null ? "bothFail" : "bail", null];
  if (fast.error !== undefined) {
    // (the service's error for a flag it rejects: esbuild throws it as is)
    if (ref !== null) return ["FALSE-ERROR", "  fast: " + fast.error];
    if (refError instanceof Error && refError.errors === undefined && refError.message === fast.error) return ["okError", null];
    return ["MSG-MISMATCH", "  esbuild: " + String(refError && refError.message) + "\n  fast:    " + fast.error];
  }
  let d;
  if (ref === null) {
    if (fast.errors.length === 0) return ["FALSE-ACCEPT", "  esbuild: " + (refError && refError.errors ? refError.errors[0].text : String(refError))];
    if (refError === null || !Array.isArray(refError.errors)) return ["MSG-MISMATCH", "  (esbuild threw: " + String(refError) + ")"];
    if ((d = firstMessageDiff(refError.errors, fast.errors) || firstMessageDiff(refError.warnings, fast.warnings)) !== null) return ["MSG-MISMATCH", d];
    return ["okError", null];
  }
  if (fast.errors.length > 0) return ["FALSE-ERROR", "  fast: " + fast.errors[0].text];
  if ((d = firstMessageDiff(ref.warnings, fast.warnings)) !== null) return ["MSG-MISMATCH", d];
  if (fast.code !== ref.code || (fast.legalComments ?? undefined) !== (ref.legalComments ?? undefined) || fast.map !== ref.map) return ["MISMATCH", null];
  if (JSON.stringify(fast.mangleCache) !== JSON.stringify(ref.mangleCache)) return ["MISMATCH", "  (mangle cache)"];
  return ["ok", null];
}
