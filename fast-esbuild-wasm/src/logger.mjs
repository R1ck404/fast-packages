// Port of the parts of internal/logger used by the transform pipeline.
// Locations are UTF-16 offsets (numbers). Ranges are immutable {loc, len}.
import { BAIL, bail } from "./bail.mjs";

// MsgKind
export const Error = 0;
export const Warning = 1;
export const Info = 2;
export const Note = 3;
export const Debug = 4;
export const Verbose = 5;

// LogLevel
export const LevelNone = 0;
export const LevelVerbose = 1;
export const LevelDebug = 2;
export const LevelInfo = 3;
export const LevelWarning = 4;
export const LevelError = 5;
export const LevelSilent = 6;

// PathStyle
export const RelPath = 0;
export const AbsPath = 1;

export class Range {
  constructor(loc = 0, len = 0) {
    this.loc = loc;
    this.len = len;
  }
  end() {
    return this.loc + this.len;
  }
}
export const RANGE_ZERO = Object.freeze(new Range(0, 0));
export function mkRange(loc, len) {
  return new Range(loc, len);
}
export function rangeEnd(r) {
  return r.loc + r.len;
}

export class Span {
  constructor(text = "", range = RANGE_ZERO) {
    this.text = text;
    this.range = range;
  }
}

// PathFlags
export const PathDisabled = 1;

export class Path {
  constructor(text = "", namespace = "", ignoredSuffix = "", importAttributes = null, flags = 0) {
    this.text = text;
    this.namespace = namespace;
    this.ignoredSuffix = ignoredSuffix;
    this.importAttributes = importAttributes;
    this.flags = flags;
  }
  isDisabled() {
    return (this.flags & PathDisabled) !== 0;
  }
  clone() {
    return new Path(this.text, this.namespace, this.ignoredSuffix, this.importAttributes, this.flags);
  }
}

export class PrettyPaths {
  constructor(abs = "", rel = "") {
    this.abs = abs;
    this.rel = rel;
  }
  select(style) {
    return style === AbsPath ? this.abs : this.rel;
  }
}

export class Source {
  constructor(prettyPaths = new PrettyPaths(), identifierName = "", contents = "", keyPath = new Path(), index = 0) {
    this.prettyPaths = prettyPaths;
    this.identifierName = identifierName;
    this.contents = contents;
    this.keyPath = keyPath;
    this.index = index;
  }

  textForRange(r) {
    return this.contents.slice(r.loc, r.loc + r.len);
  }

  locBeforeWhitespace(loc) {
    const s = this.contents;
    while (loc > 0) {
      const c = s.charCodeAt(loc - 1);
      if (c !== 32 && c !== 9 && c !== 13 && c !== 10) break;
      loc--;
    }
    return loc;
  }

  rangeOfOperatorBefore(loc, op) {
    const index = this.contents.slice(0, loc).lastIndexOf(op);
    if (index >= 0) return new Range(index, op.length);
    return new Range(loc, 0);
  }

  rangeOfOperatorAfter(loc, op) {
    const index = this.contents.indexOf(op, loc);
    if (index >= 0) return new Range(index, op.length);
    return new Range(loc, 0);
  }

  rangeOfString(loc) {
    const text = this.contents;
    const n = text.length;
    if (loc >= n) return new Range(loc, 0);
    const quote = text.charCodeAt(loc);
    if (quote === 34 || quote === 39) {
      for (let i = loc + 1; i < n; i++) {
        const c = text.charCodeAt(i);
        if (c === quote) return new Range(loc, i + 1 - loc);
        else if (c === 92) i++;
      }
    }
    if (quote === 96) {
      for (let i = loc + 1; i < n; i++) {
        const c = text.charCodeAt(i);
        if (c === quote) return new Range(loc, i + 1 - loc);
        else if (c === 92) i++;
        else if (c === 36 && i + 1 < n && text.charCodeAt(i + 1) === 123) break;
      }
    }
    return new Range(loc, 0);
  }

  rangeOfNumber(loc) {
    const text = this.contents;
    const n = text.length;
    let len = 0;
    if (loc < n) {
      const c = text.charCodeAt(loc);
      if (c >= 48 && c <= 57) {
        len = 1;
        while (loc + len < n) {
          const c = text.charCodeAt(loc + len);
          if ((c < 48 || c > 57) && (c < 97 || c > 122) && (c < 65 || c > 90) && c !== 46 && c !== 95) break;
          len++;
        }
      }
    }
    return new Range(loc, len);
  }

  rangeOfLegacyOctalEscape(loc) {
    const text = this.contents;
    const n = text.length;
    let len = 0;
    if (n - loc >= 2 && text.charCodeAt(loc) === 92) {
      len = 2;
      while (len < 4 && loc + len < n) {
        const c = text.charCodeAt(loc + len);
        if (c < 48 || c > 57) break;
        len++;
      }
    }
    return new Range(loc, len);
  }

  // Note: Go counts the initial indent in runes and the U+2028/U+2029 line
  // separators as 3 bytes; the UTF-16 equivalents are code points and 1 unit.
  commentTextWithoutIndent(r) {
    const text = this.contents.slice(r.loc, r.loc + r.len);
    if (text.length < 2 || !text.startsWith("/*")) return text;
    let indent = 0;
    let end = r.loc;
    const src = this.contents;
    while (end > 0) {
      const c = src.charCodeAt(end - 1);
      if (c === 13 || c === 10 || c === 0x2028 || c === 0x2029) break;
      if (c >= 0xdc00 && c <= 0xdfff && end >= 2) {
        const h = src.charCodeAt(end - 2);
        if (h >= 0xd800 && h <= 0xdbff) end--;
      }
      end--;
      indent++;
    }
    const lines = [];
    let start = 0;
    const n = text.length;
    for (let i = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c === 13 || c === 10) {
        if (start <= i) lines.push(text.slice(start, i));
        start = i + 1;
        if (c === 13 && start < n && text.charCodeAt(start) === 10) start++;
      } else if (c === 0x2028 || c === 0x2029) {
        lines.push(text.slice(start, i));
        start = i + 1;
      }
    }
    lines.push(text.slice(start));
    for (let k = 1; k < lines.length; k++) {
      const line = lines[k];
      let lineIndent = 0;
      while (lineIndent < line.length) {
        const c = line.charCodeAt(lineIndent);
        if (c !== 32 && c !== 9) break;
        lineIndent++;
      }
      if (indent > lineIndent) indent = lineIndent;
    }
    for (let k = 1; k < lines.length; k++) lines[k] = lines[k].slice(indent);
    return lines.join("\n");
  }
}

export function platformIndependentPathDirBaseExt(path) {
  let dir = "",
    base = "",
    ext = "";
  let absRootSlash = -1;
  if (path.length > 0 && (path[0] === "/" || path[0] === "\\")) {
    absRootSlash = 0;
  } else if (path.length > 2 && path[1] === ":" && (path[2] === "/" || path[2] === "\\")) {
    const c = path[0];
    if ((c >= "a" && c < "z") || (c >= "A" && c <= "Z")) absRootSlash = 2;
  }
  for (;;) {
    const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    if (i < 0) {
      base = path;
      break;
    }
    if (i === absRootSlash) {
      dir = path.slice(0, i + 1);
      base = path.slice(i + 1);
      break;
    }
    if (i + 1 !== path.length) {
      dir = path.slice(0, i);
      base = path.slice(i + 1);
      break;
    }
    path = path.slice(0, i);
  }
  let dot = base.lastIndexOf(".");
  if (dot >= 0) {
    ext = base.slice(dot);
    if (ext === ".css") {
      const dot2 = base.slice(0, dot).lastIndexOf(".");
      if (dot2 >= 0 && base.slice(dot2) === ".module.css") {
        dot = dot2;
        ext = base.slice(dot);
      }
    }
    base = base.slice(0, dot);
  }
  return [dir, base, ext];
}

// The log: any Error or Warning aborts the fast path (the real esbuild will
// produce the exact messages). Other kinds are dropped since transform results
// only report errors and warnings.
export class Log {
  constructor() {
    this.level = LevelInfo;
  }
  addError() {
    bail();
  }
  addErrorWithNotes() {
    bail();
  }
  addID(id, kind) {
    if (kind === Error || kind === Warning) bail();
  }
  addIDWithNotes(id, kind) {
    if (kind === Error || kind === Warning) bail();
  }
  addMsg(msg) {
    if (msg.kind === Error || msg.kind === Warning) bail();
  }
  addMsgID(id, msg) {
    if (msg.kind === Error || msg.kind === Warning) bail();
  }
  hasErrors() {
    return false;
  }
}

// Minimal stand-ins for logger.LineColumnTracker / MsgData: message data is
// never materialised (errors and warnings bail), so these are inert.
export class LineColumnTracker {
  constructor(source) {
    this.source = source;
  }
  msgData() {
    return null;
  }
}
export class MsgData {
  constructor(text = "", location = null) {
    this.text = text;
    this.location = location;
  }
}

// MsgID (internal/logger/msg_ids.go)
export const MsgID_None = 0;
export const MsgID_JS_AssertToWith = 1;
export const MsgID_JS_AssertTypeJSON = 2;
export const MsgID_JS_AssignToConstant = 3;
export const MsgID_JS_AssignToDefine = 4;
export const MsgID_JS_AssignToImport = 5;
export const MsgID_JS_BigInt = 6;
export const MsgID_JS_CallImportNamespace = 7;
export const MsgID_JS_ClassNameWillThrow = 8;
export const MsgID_JS_CommonJSVariableInESM = 9;
export const MsgID_JS_ConfusingTypeScriptCast = 10;
export const MsgID_JS_DeleteSuperProperty = 11;
export const MsgID_JS_DirectEval = 12;
export const MsgID_JS_DuplicateCase = 13;
export const MsgID_JS_DuplicateClassMember = 14;
export const MsgID_JS_DuplicateObjectKey = 15;
export const MsgID_JS_EmptyImportMeta = 16;
export const MsgID_JS_EqualsNaN = 17;
export const MsgID_JS_EqualsNegativeZero = 18;
export const MsgID_JS_EqualsNewObject = 19;
export const MsgID_JS_HTMLCommentInJS = 20;
export const MsgID_JS_ImpossibleTypeof = 21;
export const MsgID_JS_IndirectRequire = 22;
export const MsgID_JS_PrivateNameWillThrow = 23;
export const MsgID_JS_SemicolonAfterReturn = 24;
export const MsgID_JS_SuspiciousBooleanNot = 25;
export const MsgID_JS_SuspiciousDefine = 26;
export const MsgID_JS_SuspiciousLogicalOperator = 27;
export const MsgID_JS_SuspiciousNullishCoalescing = 28;
export const MsgID_JS_ThisIsUndefinedInESM = 29;
export const MsgID_JS_UnsupportedDynamicImport = 30;
export const MsgID_JS_UnsupportedJSXComment = 31;
export const MsgID_JS_UnsupportedRegExp = 32;
export const MsgID_JS_UnsupportedRequireCall = 33;
export const MsgID_CSS_CSSSyntaxError = 34;
export const MsgID_CSS_InvalidAtCharset = 35;
export const MsgID_CSS_InvalidAtImport = 36;
export const MsgID_CSS_InvalidAtLayer = 37;
export const MsgID_CSS_InvalidCalc = 38;
export const MsgID_CSS_JSCommentInCSS = 39;
export const MsgID_CSS_UndefinedComposesFrom = 40;
export const MsgID_CSS_UnsupportedAtCharset = 41;
export const MsgID_CSS_UnsupportedAtNamespace = 42;
export const MsgID_CSS_UnsupportedCSSProperty = 43;
export const MsgID_CSS_UnsupportedCSSNesting = 44;
export const MsgID_Bundler_AmbiguousReexport = 45;
export const MsgID_Bundler_DifferentPathCase = 46;
export const MsgID_Bundler_EmptyGlob = 47;
export const MsgID_Bundler_IgnoredBareImport = 48;
export const MsgID_Bundler_IgnoredDynamicImport = 49;
export const MsgID_Bundler_ImportIsUndefined = 50;
export const MsgID_Bundler_RequireResolveNotExternal = 51;
export const MsgID_SourceMap_InvalidSourceMappings = 52;
export const MsgID_SourceMap_MissingSourceMap = 53;
export const MsgID_SourceMap_UnsupportedSourceMapComment = 54;
export const MsgID_PackageJSON_FIRST = 55;
export const MsgID_PackageJSON_DeadCondition = 56;
export const MsgID_PackageJSON_InvalidBrowser = 57;
export const MsgID_PackageJSON_InvalidImportsOrExports = 58;
export const MsgID_PackageJSON_InvalidSideEffects = 59;
export const MsgID_PackageJSON_InvalidType = 60;
export const MsgID_PackageJSON_LAST = 61;
export const MsgID_TSConfigJSON_FIRST = 62;
export const MsgID_TSConfigJSON_Cycle = 63;
export const MsgID_TSConfigJSON_InvalidImportsNotUsedAsValues = 64;
export const MsgID_TSConfigJSON_InvalidJSX = 65;
export const MsgID_TSConfigJSON_InvalidPaths = 66;
export const MsgID_TSConfigJSON_InvalidTarget = 67;
export const MsgID_TSConfigJSON_InvalidTopLevelOption = 68;
export const MsgID_TSConfigJSON_Missing = 69;
export const MsgID_TSConfigJSON_LAST = 70;
export const MsgID_END = 71;
