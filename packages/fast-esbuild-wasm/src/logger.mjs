// Port of the parts of internal/logger used by the transform pipeline.
// Locations are UTF-16 offsets (numbers). Ranges are immutable {loc, len}.
import { goStringBytes, isRawByteUnit } from "./helpers.mjs";
import { goDecodeRune } from "./gostd.mjs";
import { GoPanic } from "./gopanic.mjs";
import { canRetryDeep, isStackOverflow, runDeep } from "./deep.mjs";
import { utf8Len } from "./helpers.mjs";

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

// JS-only: a range whose Go length is the byte length of a string that is
// not a slice of the source (e.g. "Range{Len: int32(len(name))}" for a
// private name that may have been written with escapes). Only messages use
// it: the tracker reports "byteLen" as the length.
export class ByteRange extends Range {
  ;                       
  constructor(loc        , byteLen        ) {
    super(loc, byteLen);
    this.byteLen = byteLen;
  }
}
export function mkRange(loc, len) {
  return new Range(loc, len);
}
export function rangeEnd(r) {
  return r.loc + r.len;
}

export class Span {
  ;                    
  ;                    
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
  ;                   
  ;                   
  constructor(abs = "", rel = "") {
    this.abs = abs;
    this.rel = rel;
  }
  select(style) {
    return style === AbsPath ? this.abs : this.rel;
  }
}

export class Source {
  ;                                
  ;                              
  ;                        
  ;                     
  ;                     
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

// ---------------------------------------------------------------------------
// Messages (logger.Msg, MsgData, MsgLocation)
//
// Go works on UTF-8: "Column" and "Length" are byte counts, and so are the
// line/column computations. The port's sources are UTF-16 strings, so the
// tracker finds the line in UTF-16 units and converts the column and the
// length to UTF-8 byte counts (lone surrogates count 3 bytes, like WTF-8).

export class MsgLocation {
  ;                         
  ;                         
  ;                        
  ;                          
  ;                     // 1-based
  ;                       // 0-based, in bytes
  ;                       // in bytes
  constructor(file = new PrettyPaths(), namespace = "", lineText = "", suggestion = "", line = 0, column = 0, length = 0) {
    this.file = file;
    this.namespace = namespace;
    this.lineText = lineText;
    this.suggestion = suggestion;
    this.line = line;
    this.column = column;
    this.length = length;
  }
  clone() {
    return new MsgLocation(this.file, this.namespace, this.lineText, this.suggestion, this.line, this.column, this.length);
  }
}

export class MsgData {
  ;                       
  ;                                    
  ;                    
  ;                                    
  constructor(userDetail      = null, location                     = null, text = "", disableMaximumWidth = false) {
    this.userDetail = userDetail;
    this.location = location;
    this.text = text;
    this.disableMaximumWidth = disableMaximumWidth;
  }
}

export class Msg {
  ;                               
  ;                          
  ;                     
  ;                    
  ;                  
  constructor(notes                   = null, pluginName = "", data = new MsgData(), kind = Error, id = 0) {
    this.notes = notes;
    this.pluginName = pluginName;
    this.data = data;
    this.kind = kind;
    this.id = id;
  }
}

// logger.SortableMsgs: sort.Stable with this "Less"
export function msgLess(ai     , aj     )          {
  const aiLoc = ai.data.location;
  const ajLoc = aj.data.location;
  if (aiLoc === null || ajLoc === null) return aiLoc === null && ajLoc !== null;
  if (aiLoc.file.abs !== ajLoc.file.abs || aiLoc.file.rel !== ajLoc.file.rel) {
    return goStringLess(aiLoc.file.abs, ajLoc.file.abs) || (aiLoc.file.abs === ajLoc.file.abs && goStringLess(aiLoc.file.rel, ajLoc.file.rel));
  }
  if (aiLoc.line !== ajLoc.line) return aiLoc.line < ajLoc.line;
  if (aiLoc.column !== ajLoc.column) return aiLoc.column < ajLoc.column;
  if (ai.kind !== aj.kind) return ai.kind < aj.kind;
  return goStringLess(ai.data.text, aj.data.text);
}
export function sortMsgsStable(msgs       ) {
  if (msgs.length > 1) msgs.sort((a, b) => (msgLess(a, b) ? -1 : msgLess(b, a) ? 1 : 0));
}

// Go's string "<": byte-wise on the UTF-8 encoding. UTF-16 code unit order
// only differs from it for surrogates vs U+E000..U+FFFF.
export function goStringLess(a        , b        )          {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let ca = a.charCodeAt(i);
    let cb = b.charCodeAt(i);
    if (ca !== cb) {
      // (surrogates encode code points above U+FFFF, which sort last)
      if (ca >= 0xd800 && ca <= 0xdfff) ca += 0x10000;
      if (cb >= 0xd800 && cb <= 0xdfff) cb += 0x10000;
      return ca < cb;
    }
  }
  return a.length < b.length;
}

// logger.LineColumnTracker (MakeLineColumnTracker: "new LineColumnTracker(source)",
// null for a nil source)
export class LineColumnTracker {
  ;                        
  ;                                
  ;                      
  ;                    
  ;                         
  ;                       
  ;                             
  ;                           
  ;                          
  constructor(source               ) {
    this.offset = 0;
    this.line = 0;
    this.lineStart = 0;
    this.lineEnd = 0;
    this.hasLineEnd = false;
    if (source === null || source === undefined) {
      this.contents = "";
      this.prettyPaths = new PrettyPaths();
      this.hasLineStart = false;
      this.hasSource = false;
    } else {
      this.contents = source.contents;
      this.prettyPaths = source.prettyPaths;
      this.hasLineStart = true;
      this.hasSource = true;
    }
  }

  msgData(r       , text        )          {
    return new MsgData(null, this.msgLocationOrNil(r), text);
  }

  scanTo(offset        ) {
    const contents = this.contents;
    let i = this.offset;

    // Scan forward
    if (i < offset) {
      for (;;) {
        const c = contents.charCodeAt(i);
        i++;
        switch (c) {
          case 10:
            this.hasLineStart = true;
            this.hasLineEnd = false;
            this.lineStart = i;
            if (i === 1 || contents.charCodeAt(i - 2) !== 13) this.line++;
            break;
          case 13:
          case 0x2028:
          case 0x2029:
            this.hasLineStart = true;
            this.hasLineEnd = false;
            this.lineStart = i;
            this.line++;
            break;
        }
        if (i >= offset) {
          this.offset = i;
          return;
        }
      }
    }

    // Scan backward
    if (i > offset) {
      for (;;) {
        i--;
        const c = contents.charCodeAt(i);
        switch (c) {
          case 10:
            this.hasLineStart = false;
            this.hasLineEnd = true;
            this.lineEnd = i;
            if (i === 0 || contents.charCodeAt(i - 1) !== 13) this.line--;
            break;
          case 13:
          case 0x2028:
          case 0x2029:
            this.hasLineStart = false;
            this.hasLineEnd = true;
            this.lineEnd = i;
            this.line--;
            break;
        }
        if (i <= offset) {
          this.offset = i;
          return;
        }
      }
    }
  }

  // Returns [line, column (UTF-16), lineStart, lineEnd]
  computeLineAndColumn(offset        )                                   {
    this.scanTo(offset);
    const contents = this.contents;

    // Scan for the start of the line
    if (!this.hasLineStart) {
      let i = this.offset;
      while (i > 0) {
        const c = contents.charCodeAt(i - 1);
        if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) break;
        i--;
      }
      this.hasLineStart = true;
      this.lineStart = i;
    }

    // Scan for the end of the line
    if (!this.hasLineEnd) {
      let i = this.offset;
      const n = contents.length;
      while (i < n) {
        const c = contents.charCodeAt(i);
        if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) break;
        i++;
      }
      this.hasLineEnd = true;
      this.lineEnd = i;
    }

    return [this.line, offset - this.lineStart, this.lineStart, this.lineEnd];
  }

  msgLocationOrNil(r       )                     {
    if (!this.hasSource) return null;

    // Convert the index into a line and column number
    const loc = r.loc;
    const $ = this.computeLineAndColumn(loc);
    const lineStart = $[2];
    const contents = this.contents;
    return new MsgLocation(
      this.prettyPaths,
      "",
      contents.slice(lineStart, $[3]),
      "",
      $[0] + 1, // 0-based to 1-based
      utf8Len(contents.slice(lineStart, loc)),
      r instanceof ByteRange ? r.byteLen : r.len === 0 ? 0 : utf8Len(contents.slice(loc, loc + r.len)),
    );
  }
}

function msgDataFor(tracker                          , r       , text        )          {
  return tracker === null || tracker === undefined ? new MsgData(null, null, text) : tracker.msgData(r, text);
}

// ---------------------------------------------------------------------------
// The log (logger.Log). One class for Go's three kinds of log:
//   newStderrLog(options)       the API's log: collects every message, prints
//                               the ones the log level lets through to
//                               "stderr" (see setStderr), and returns them
//                               sorted from done()
//   newDeferLog(kind, overrides) collects messages (done() sorts them)
//   DiscardLog                  drops everything (a deferred log whose
//                               messages are never looked at)
//
// Every message is built exactly like Go builds it.

export const DeferLogAll = 0;
export const DeferLogNoVerboseOrDebug = 1;

// UseColor
export const ColorIfTerminal = 0;
export const ColorNever = 1;
export const ColorAlways = 2;

// LogStyle
export const StyleDefault = 0;
export const StyleVisualStudio = 1;

// APIKind: this can be used to customize error messages for the current API
// kind (the service sets JSAPI, the CLI CLIAPI)
export const GoAPI = 0;
export const CLIAPI = 1;
export const JSAPI = 2;
export const API = { kind: JSAPI };

export class OutputOptions {
                               
                                 
                        
                           
                           
                            
                                                
  constructor(messageLimit = 0, includeSource = false, color = ColorIfTerminal, logLevel = LevelNone, logStyle = StyleDefault, pathStyle = RelPath, overrides                             = null) {
    this.messageLimit = messageLimit;
    this.includeSource = includeSource;
    this.color = color;
    this.logLevel = logLevel;
    this.logStyle = logStyle;
    this.pathStyle = pathStyle;
    this.overrides = overrides;
  }
}

export class TerminalInfo {
  ;                      
  ;                                
  ;                     
  ;                      
  constructor(isTTY = false, useColorEscapes = false, width = 0, height = 0) {
    this.isTTY = isTTY;
    this.useColorEscapes = useColorEscapes;
    this.width = width;
    this.height = height;
  }
}

// logger_other.go (GOOS=js, what esbuild-wasm runs): no terminal, no colors
export const SupportsColorEscapes = false;

// Where Go's stderr goes. esbuild-wasm's glue decodes each write with a
// TextDecoder and console.log()s everything up to the last newline (the rest
// waits for the next write); the engine does the same with its own buffer.
// "text" is a byte string (one char per UTF-8 byte). (JS-only: a log holds
// its writes until the call is answered, see Log.flushStderr: a call that
// falls back to Go must not have printed anything.)
let stderrBuffer = "";
let stderrSink                                  = null;
let stderrDecoder                     = null;
export function setStderr(sink                                 ) {
  stderrSink = sink;
}
// Node: Go's stderr is the process's (the raw bytes, no TextDecoder)
let stderrBytesSink                                       = null;
export function setStderrBytes(sink                                      ) {
  stderrBytesSink = sink;
}
export function writeStderr(bytes        ) {
  if (stderrBytesSink !== null) {
    const n = bytes.length;
    const array = new Uint8Array(n);
    for (let i = 0; i < n; i++) array[i] = bytes.charCodeAt(i);
    stderrBytesSink(array);
    return;
  }
  if (stderrDecoder === null) stderrDecoder = new TextDecoder();
  const n = bytes.length;
  const array = new Uint8Array(n);
  for (let i = 0; i < n; i++) array[i] = bytes.charCodeAt(i);
  const text = stderrDecoder.decode(array);
  if (stderrSink !== null) {
    stderrSink(text);
    return;
  }
  stderrBuffer += text;
  const parts = stderrBuffer.split("\n");
  if (parts.length > 1) console.log(parts.slice(0, -1).join("\n"));
  stderrBuffer = parts[parts.length - 1];
}

const LOG_STDERR = 0;
const LOG_DEFER = 1;

export class Log {
                        
                                                
                      
                            // (Go's "hasErrors")
                       
                            
                                     

  // (a stderr log that prints nothing: see newStderrLog for the real one)
  constructor(level = LevelInfo, overrides                             = null) {
    this.level = level;
    this.overrides = overrides;
    this.msgs = [];
    this.errors_ = false;
    this.mode = LOG_STDERR;
    this.deferKind = DeferLogAll;
    this.stderr = null;
  }

  addMsg(msg           ) {
    if (this.mode === LOG_DEFER) {
      if (this.deferKind === DeferLogNoVerboseOrDebug && (msg.kind === Verbose || msg.kind === Debug)) return;
      if (msg.kind === Error) this.errors_ = true;
      this.msgs.push(msg);
      return;
    }
    this.msgs.push(msg);
    if (msg.kind === Error) this.errors_ = true;
    const st = this.stderr;
    if (st !== null) st.add(msg);
  }

  hasErrors()          {
    return this.errors_;
  }

  peek()        {
    if (this.mode === LOG_STDERR) {
      sortMsgsStable(this.msgs);
    }
    return this.msgs.slice();
  }

  done()        {
    if (this.stderr !== null) this.stderr.finalize();
    sortMsgsStable(this.msgs);
    return this.msgs;
  }

  // JS-only: prints what Go would have written to stderr so far
  flushStderr() {
    const st = this.stderr;
    if (st === null) return;
    const pending = st.pending;
    st.pending = [];
    for (let i = 0; i < pending.length; i++) writeStderr(pending[i]);
  }

  addError(tracker                          , r       , text        ) {
    this.addMsg(new Msg(null, "", msgDataFor(tracker, r, text), Error));
  }

  addID(id        , kind        , tracker                          , r       , text        ) {
    const override = allowOverride(this.overrides, id, kind);
    if (override < 0) return;
    this.addMsg(new Msg(null, "", msgDataFor(tracker, r, text), override, id));
  }

  addErrorWithNotes(tracker                          , r       , text        , notes                   ) {
    this.addMsg(new Msg(notes === undefined ? null : notes, "", msgDataFor(tracker, r, text), Error));
  }

  addIDWithNotes(id        , kind        , tracker                          , r       , text        , notes                   ) {
    const override = allowOverride(this.overrides, id, kind);
    if (override < 0) return;
    this.addMsg(new Msg(notes === undefined ? null : notes, "", msgDataFor(tracker, r, text), override, id));
  }

  addMsgID(id        , msg           ) {
    const override = allowOverride(this.overrides, id, msg.kind);
    if (override < 0) return;
    msg.id = id;
    msg.kind = override;
    this.addMsg(msg);
  }
}

// logger.NewDeferLog
export function newDeferLog(kind        , overrides                            )      {
  const log = new Log(LevelInfo, overrides);
  log.mode = LOG_DEFER;
  log.deferKind = kind;
  return log;
}

// What the parse caches of internal/cache do on a cache miss: parse into a
// temporary deferred log, then add its messages (sorted by Done) to "log"
export function parseWithTempLog   (log     , parse                     )    {
  let tempLog = newDeferLog(DeferLogAll, log.overrides);
  let result   ;
  if (canRetryDeep()) {
    // (JS-only: input nested too deeply for the call stack is parsed again
    // in deep mode, see deep.mts)
    try {
      result = parse(tempLog);
    } catch (e) {
      if (!isStackOverflow(e)) throw e;
      const deepLog = newDeferLog(DeferLogAll, log.overrides);
      tempLog = deepLog;
      result = runDeep(() => parse(deepLog));
    }
  } else {
    result = parse(tempLog);
  }
  const msgs = tempLog.done();
  for (let i = 0; i < msgs.length; i++) log.addMsg(msgs[i]);
  return result;
}

// logger.NewStderrLog
export function newStderrLog(options               )      {
  const log = new Log(options.logLevel, options.overrides);
  log.stderr = new StderrState(options);
  return log;
}

// The printing half of NewStderrLog's closures
class StderrState {
  ;                              
  ;                                  
  ;                      
  ;                        
  ;                           
  ;                             
  ;                                            
  ;                               
  ;                         
  constructor(options               ) {
    this.options = options;
    this.pending = [];
    // (GetTerminalInfo(os.Stderr) on GOOS=js is the zero value)
    this.terminalInfo = new TerminalInfo();
    this.errors = 0;
    this.warnings = 0;
    this.shownErrors = 0;
    this.shownWarnings = 0;
    this.remainingMessagesBeforeLimit = options.messageLimit;
    if (this.remainingMessagesBeforeLimit === 0) this.remainingMessagesBeforeLimit = 0x7fffffff;
    this.deferredWarnings = [];
    switch (options.color) {
      case ColorNever:
        this.terminalInfo.useColorEscapes = false;
        break;
      case ColorAlways:
        this.terminalInfo.useColorEscapes = SupportsColorEscapes;
        break;
    }
  }

  write(bytes        ) {
    this.pending.push(bytes);
  }

  finalize() {
    const options = this.options;
    // Print the deferred warning now if there was no error after all
    while (this.remainingMessagesBeforeLimit > 0 && this.deferredWarnings.length > 0) {
      this.shownWarnings++;
      this.write(msgToString(this.deferredWarnings[0], options, this.terminalInfo));
      this.deferredWarnings = this.deferredWarnings.slice(1);
      this.remainingMessagesBeforeLimit--;
    }

    // Print out a summary
    if (options.messageLimit > 0 && this.errors + this.warnings > options.messageLimit) {
      this.write(toBytes(errorAndWarningSummary(this.errors, this.warnings, this.shownErrors, this.shownWarnings) + " shown (disable the message limit with --log-limit=0)\n"));
    } else if (options.logLevel <= LevelInfo && (this.warnings !== 0 || this.errors !== 0)) {
      this.write(toBytes(errorAndWarningSummary(this.errors, this.warnings, this.shownErrors, this.shownWarnings) + "\n"));
    }
  }

  add(msg     ) {
    const options = this.options;
    switch (msg.kind) {
      case Verbose:
        if (options.logLevel <= LevelVerbose) this.write(msgToString(msg, options, this.terminalInfo));
        break;
      case Debug:
        if (options.logLevel <= LevelDebug) this.write(msgToString(msg, options, this.terminalInfo));
        break;
      case Info:
        if (options.logLevel <= LevelInfo) this.write(msgToString(msg, options, this.terminalInfo));
        break;
      case Error:
        if (options.logLevel <= LevelError) this.errors++;
        break;
      case Warning:
        if (options.logLevel <= LevelWarning) this.warnings++;
        break;
    }

    // Be silent if we're past the limit so we don't flood the terminal
    if (this.remainingMessagesBeforeLimit === 0) return;

    switch (msg.kind) {
      case Error:
        if (options.logLevel <= LevelError) {
          this.shownErrors++;
          this.write(msgToString(msg, options, this.terminalInfo));
          this.remainingMessagesBeforeLimit--;
        }
        break;
      case Warning:
        if (options.logLevel <= LevelWarning) {
          if (this.remainingMessagesBeforeLimit > Math.trunc((options.messageLimit + 1) / 2)) {
            this.shownWarnings++;
            this.write(msgToString(msg, options, this.terminalInfo));
            this.remainingMessagesBeforeLimit--;
          } else {
            // If we have less than half of the slots left, wait for potential
            // future errors instead of using up all of the slots with warnings.
            // We want the log for a failed build to always have at least one
            // error in it.
            this.deferredWarnings.push(msg);
          }
        }
        break;
    }
  }
}

// Go's messages drop errors and warnings where the message is never looked at
// (js_parser.ParseDefineExpr, ...): nothing is recorded.
export class DiscardLog extends Log {
  addMsg(msg     ) {}
  addError(tracker , r , text ) {}
  addErrorWithNotes(tracker , r , text , notes ) {}
  addID(id, kind, tracker , r , text ) {}
  addIDWithNotes(id, kind, tracker , r , text , notes ) {}
  addMsgID(id, msg) {}
}

// ---------------------------------------------------------------------------
// For Yarn PnP we sometimes parse JSON embedded in a JS string
// (StringInJSTableEntry, GenerateStringInJSTable, RemapStringInJSLoc and
// NewStringInJSLog). Go works on the bytes of both strings; so does this
// (the table holds byte offsets and byte columns), converting the port's
// UTF-16 locations at the edges.

// The byte offset of every UTF-16 offset of a Go string held in a JS string
// (see helpers.decodeGoString), with one extra entry for the end
function byteOffsetsOf(s        )             {
  const n = s.length;
  const offsets = new Int32Array(n + 1);
  let b = 0;
  for (let i = 0; i < n; i++) {
    offsets[i] = b;
    const c = s.charCodeAt(i);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < n && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      offsets[i + 1] = b + 4; // (the middle of the pair belongs to the next character)
      b += 4;
      i++;
    } else if (isRawByteUnit(c)) b += 1;
    else b += 3;
  }
  offsets[n] = b;
  return offsets;
}

// The UTF-16 offset of a byte offset (a byte inside a character belongs to
// that character)
function utf16OffsetOf(offsets            , byteOffset        )         {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= byteOffset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

class StringInJSTableEntry {
  ;                         
  ;                           
  ;                         // (bytes)
  ;                         // (bytes)
  constructor(innerLine        , innerColumn        , innerLoc        , outerLoc        ) {
    this.innerLine = innerLine;
    this.innerColumn = innerColumn;
    this.innerLoc = innerLoc;
    this.outerLoc = outerLoc;
  }
}

export class StringInJSTable {
  ;                                       
  ;                                
  ;                                
  constructor(entries                        , innerOffsets            , outerOffsets            ) {
    this.entries = entries;
    this.innerOffsets = innerOffsets;
    this.outerOffsets = outerOffsets;
  }
}

// utf8.DecodeRuneInString(s[i:])
function decodeRuneAt(s            , i        )                   {
  if (i >= s.length) return [0xfffd, 0];
  return goDecodeRune(s, i);
}

export function generateStringInJSTable(outerContents        , outerStringLiteralLoc        , innerContents        )                  {
  const outer = goStringBytes(outerContents);
  const inner = goStringBytes(innerContents);
  const outerOffsets = byteOffsetsOf(outerContents);
  const table                         = [];
  let i = 0;
  const n = inner.length;
  let line = 1;
  let column = 0;
  let loc = outerOffsets[outerStringLiteralLoc] + 1;

  while (i < n) {
    // Ignore line continuations. A line continuation is not an escaped newline.
    for (;;) {
      if (decodeRuneAt(outer, loc)[0] !== 92) {
        break;
      }
      const $c = decodeRuneAt(outer, loc + 1);
      const c = $c[0];
      if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) {
        loc += 1 + $c[1];
        if (c === 13 && outer[loc] === 10) {
          // Make sure Windows CRLF counts as a single newline
          loc++;
        }
        continue;
      }
      break;
    }

    let $c = decodeRuneAt(inner, i);
    let c = $c[0];
    let width = $c[1];

    // Compress the table using run-length encoding
    table.push(new StringInJSTableEntry(line, column, i, loc));
    if (table.length > 1) {
      const last = table[table.length - 2];
      if (line === last.innerLine && loc - column === last.outerLoc - last.innerColumn) {
        table.length--;
      }
    }

    // Advance the inner line/column
    switch (c) {
      case 10:
      case 13:
      case 0x2028:
      case 0x2029:
        line++;
        column = 0;

        // Handle newlines on Windows
        if (c === 13 && i + 1 < n && inner[i + 1] === 10) {
          i++;
        }
        break;

      default:
        column += width;
    }
    i += width;

    // Advance the outer loc, assuming the string syntax is already valid
    $c = decodeRuneAt(outer, loc);
    c = $c[0];
    width = $c[1];
    if (c === 13 && outer[loc + 1] === 10) {
      // Handle newlines on Windows in template literal strings
      loc += 2;
    } else if (c !== 92) {
      loc += width;
    } else {
      // Handle an escape sequence
      $c = decodeRuneAt(outer, loc + 1);
      c = $c[0];
      width = $c[1];
      switch (c) {
        case 120: // 'x'
          // 2-digit hexadecimal
          loc += 1 + 2;
          break;

        case 117: // 'u'
          loc++;
          if (outer[loc] === 123) {
            // Variable-length
            while (outer[loc] !== 125) {
              loc++;
            }
            loc++;
          } else {
            // Fixed-length
            loc += 4;
          }
          break;

        case 10:
        case 13:
        case 0x2028:
        case 0x2029:
          // This will be handled by the next iteration
          break;

        default:
          loc += 1 + width;
      }
    }
  }

  return new StringInJSTable(table, byteOffsetsOf(innerContents), outerOffsets);
}

// RemapStringInJSLoc (with UTF-16 locations)
export function remapStringInJSLoc(t                 , innerLocUTF16        )         {
  const table = t.entries;
  const innerLoc = t.innerOffsets[innerLocUTF16 < t.innerOffsets.length ? innerLocUTF16 : t.innerOffsets.length - 1];
  let count = table.length;
  let index = 0;

  // Binary search to find the previous entry
  while (count > 0) {
    const step = count >> 1;
    const i = index + step;
    if (i + 1 < table.length) {
      const entry = table[i + 1];
      if (entry.innerLoc < innerLoc) {
        index = i + 1;
        count -= step + 1;
        continue;
      }
    }
    count = step;
  }

  // (Go indexes table[0], which panics for an empty table: an empty JSON
  // string, which has no locations to remap)
  if (table.length === 0) throw new GoPanic("runtime error: index out of range [0] with length 0");
  const entry = table[index];
  const outerLoc = entry.outerLoc + innerLoc - entry.innerLoc; // Undo run-length compression
  return utf16OffsetOf(t.outerOffsets, outerLoc);
}

// NewStringInJSLog: a log that remaps the locations of its messages (which
// are in the inner source) into the outer source
export function newStringInJSLog(log     , outerTracker                   , t                 )      {
  const table = t.entries;

  const remapLineAndColumnToLoc = (line        , column        )         => {
    let count = table.length;
    let index = 0;

    // Binary search to find the previous entry
    while (count > 0) {
      const step = count >> 1;
      const i = index + step;
      if (i + 1 < table.length) {
        const entry = table[i + 1];
        if (entry.innerLine < line || (entry.innerLine === line && entry.innerColumn < column)) {
          index = i + 1;
          count -= step + 1;
          continue;
        }
      }
      count = step;
    }

    if (table.length === 0) throw new GoPanic("runtime error: index out of range [0] with length 0");
    const entry = table[index];
    return entry.outerLoc + column - entry.innerColumn; // Undo run-length compression
  };

  const remapData = (data         )          => {
    if (data.location === null) {
      return data;
    }

    // Generate a range in the outer source using the line/column/length in the inner source
    const start = remapLineAndColumnToLoc(data.location.line, data.location.column);
    let len = 0;
    if (data.location.length !== 0) {
      len = remapLineAndColumnToLoc(data.location.line, data.location.column + data.location.length) - start;
    }
    const r = new ByteRange(utf16OffsetOf(t.outerOffsets, start), len);

    // Use that range to look up the line in the outer source
    const location = outerTracker.msgData(r, data.text).location               ;
    location.suggestion = data.location.suggestion;
    return new MsgData(data.userDetail, location, data.text, data.disableMaximumWidth);
  };

  const wrapped      = Object.create(log);
  wrapped.addMsg = (msg     ) => {
    const notes = msg.notes === null ? null : msg.notes.map(remapData);
    log.addMsg(new Msg(notes, msg.pluginName, remapData(msg.data), msg.kind, msg.id));
  };
  return wrapped;
}

// logger.allowOverride: the kind, or -1 when the message is silenced
export function allowOverride(overrides                            , id        , kind        )         {
  if (overrides !== null) {
    const logLevel = overrides.get(id);
    if (logLevel !== undefined) {
      switch (logLevel) {
        case LevelVerbose:
          return Verbose;
        case LevelDebug:
          return Debug;
        case LevelInfo:
          return Info;
        case LevelWarning:
          return Warning;
        case LevelError:
          return Error;
        default:
          // Setting the log level to "silent" silences this log message
          return -1;
      }
    }
  }
  return kind;
}

// ---------------------------------------------------------------------------
// Formatting (logger.Msg.String, style_default.go, style_visualstudio.go).
// Go formats bytes: everything here works on byte strings (one char per
// UTF-8 byte, lone surrogates as their 3-byte WTF-8 encoding), which the
// caller decodes like esbuild's glue does (TextDecoder).

// A JS string as a byte string (WTF-8, and the raw bytes of invalid UTF-8:
// see helpers.decodeGoString)
export function toBytes(s        )         {
  let ascii = true;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return s;
  let out = "";
  const n = s.length;
  for (let i = 0; i < n; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out += s[i];
      continue;
    }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        i++;
      }
    } else if (c >= 0xdc80 && c <= 0xdcff) {
      out += String.fromCharCode(c - 0xdc00);
      continue;
    }
    if (c < 0x800) out += String.fromCharCode(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out += String.fromCharCode(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out += String.fromCharCode(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

// A byte string decoded like TextDecoder (invalid bytes become U+FFFD)
export function fromBytes(bytes        )         {
  let ascii = true;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes.charCodeAt(i) >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return bytes;
  if (stderrDecoder === null) stderrDecoder = new TextDecoder();
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return stderrDecoder.decode(array);
}

// utf8.DecodeRuneInString on a byte string: [rune, size]
function decodeRune(s        , i        )                   {
  const n = s.length;
  if (i >= n) return [0xfffd, 0];
  const c0 = s.charCodeAt(i);
  if (c0 < 0x80) return [c0, 1];
  const cont = (k        ) => i + k < n && (s.charCodeAt(i + k) & 0xc0) === 0x80;
  if (c0 >= 0xc2 && c0 <= 0xdf) {
    if (cont(1)) return [((c0 & 0x1f) << 6) | (s.charCodeAt(i + 1) & 0x3f), 2];
  } else if (c0 >= 0xe0 && c0 <= 0xef) {
    if (i + 1 < n) {
      const c1 = s.charCodeAt(i + 1);
      const lo = c0 === 0xe0 ? 0xa0 : 0x80;
      const hi = c0 === 0xed ? 0x9f : 0xbf;
      if (c1 >= lo && c1 <= hi && cont(2)) return [((c0 & 0x0f) << 12) | ((c1 & 0x3f) << 6) | (s.charCodeAt(i + 2) & 0x3f), 3];
    }
  } else if (c0 >= 0xf0 && c0 <= 0xf4) {
    if (i + 1 < n) {
      const c1 = s.charCodeAt(i + 1);
      const lo = c0 === 0xf0 ? 0x90 : 0x80;
      const hi = c0 === 0xf4 ? 0x8f : 0xbf;
      if (c1 >= lo && c1 <= hi && cont(2) && cont(3))
        return [((c0 & 0x07) << 18) | ((c1 & 0x3f) << 12) | ((s.charCodeAt(i + 2) & 0x3f) << 6) | (s.charCodeAt(i + 3) & 0x3f), 4];
    }
  }
  return [0xfffd, 1];
}

// A code point as a byte string (utf8.EncodeRune / WriteRune)
function runeBytes(c        )         {
  return toBytes(String.fromCodePoint(c));
}

function kindString(kind        )         {
  switch (kind) {
    case Error:
      return "ERROR";
    case Warning:
      return "WARNING";
    case Info:
      return "INFO";
    case Note:
      return "NOTE";
    case Debug:
      return "DEBUG";
    case Verbose:
      return "VERBOSE";
  }
  throw new globalThis.Error("Internal error");
}

// (isProbablyWindowsCommandPrompt is false: runtime.GOOS is "js")
function kindIcon(kind        )         {
  switch (kind) {
    case Error:
      return runeBytes(0x2718);
    case Warning:
      return runeBytes(0x25b2);
    case Info:
      return runeBytes(0x25b6);
    case Note:
      return runeBytes(0x2192);
    case Debug:
      return runeBytes(0x25cf);
    case Verbose:
      return runeBytes(0x2b25);
  }
  throw new globalThis.Error("Internal error");
}

export class Colors {
  ;                     
  ;                    
  ;                   
  ;                         
  ;                   
  ;                     
  ;                    
  ;                    
  ;                       
  ;                      
  ;                        
  ;                          
  ;                            
  ;                            
  ;                          
  ;                           
  ;                          
  ;                           
  ;                                
  ;                              
  ;                              
  ;                             
  constructor(on         ) {
    const e = (s        ) => (on ? String.fromCharCode(27) + "[" + s + "m" : "");
    this.reset = e("0");
    this.bold = e("1");
    this.dim = e("37");
    this.underline = e("4");
    this.red = e("31");
    this.green = e("32");
    this.blue = e("34");
    this.cyan = e("36");
    this.magenta = e("35");
    this.yellow = e("33");
    this.redBgRed = e("41;31");
    this.redBgWhite = e("41;97");
    this.greenBgGreen = e("42;32");
    this.greenBgWhite = e("42;97");
    this.blueBgBlue = e("44;34");
    this.blueBgWhite = e("44;97");
    this.cyanBgCyan = e("46;36");
    this.cyanBgBlack = e("46;30");
    this.magentaBgMagenta = e("45;35");
    this.magentaBgBlack = e("45;30");
    this.yellowBgYellow = e("43;33");
    this.yellowBgBlack = e("43;30");
  }
}
export const NO_COLORS = new Colors(false);
export const TERMINAL_COLORS = new Colors(true);

// The number of margin characters in addition to the line number
const extraMarginChars = 9;
const defaultTerminalWidth = 80;

// Msg.String: a byte string
export function msgToString(msg     , options               , terminalInfo              )         {
  switch (options.logStyle) {
    case StyleVisualStudio:
      return msgToStringVisualStudio(msg, options, terminalInfo);
    default:
      return msgToStringDefault(msg, options, terminalInfo);
  }
}

function msgToStringDefault(msg     , options               , terminalInfo              )         {
  // Format the message
  let text = msgString(options.includeSource, options.pathStyle, terminalInfo, msg.id, msg.kind, msg.data, msg.pluginName);

  // Format the notes
  let oldData                 = null;
  const notes = msg.notes;
  if (notes !== null) {
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (options.includeSource && (i === 0 || oldData.text.indexOf("\n") >= 0 || oldData.location !== null)) text += "\n";
      text += msgString(options.includeSource, options.pathStyle, terminalInfo, MsgID_None, Note, note, "");
      oldData = note;
    }
  }

  // Add extra spacing between messages if source code is present
  if (options.includeSource) text += "\n";
  return text;
}

function marginWithLineText(maxMargin        , line        )         {
  const number = String(line);
  return "      " + " ".repeat(Math.max(0, maxMargin - number.length)) + number + " " + runeBytes(0x2502) + " ";
}

function emptyMarginText(maxMargin        , isLast         )         {
  const space = " ".repeat(maxMargin);
  if (isLast) return "      " + space + " " + runeBytes(0x2575) + " ";
  return "      " + space + " " + runeBytes(0x2502) + " ";
}

function msgString(includeSource         , pathStyle        , terminalInfo              , id        , kind        , data         , pluginName        )         {
  const dataText = toBytes(data.text);
  if (!includeSource) {
    const loc = data.location;
    if (loc !== null) return toBytes(loc.file.select(pathStyle)) + ": " + kindString(kind) + ": " + dataText + "\n";
    return kindString(kind) + ": " + dataText + "\n";
  }

  const colors = terminalInfo.useColorEscapes ? TERMINAL_COLORS : NO_COLORS;
  let iconColor = "";
  let kindColorBrackets = "";
  let kindColorText = "";
  let location = "";

  if (data.location !== null) {
    const maxMargin = String(data.location.line).length;
    const d = detailStruct(data, pathStyle, terminalInfo, maxMargin);

    if (d.suggestion !== "") {
      location =
        "\n    " + d.path + ":" + d.line + ":" + d.column + ":\n" +
        colors.dim + d.sourceBefore + colors.green + d.sourceMarked + colors.dim + d.sourceAfter + "\n" +
        emptyMarginText(maxMargin, false) + d.indent + colors.green + d.marker + colors.dim + "\n" +
        emptyMarginText(maxMargin, true) + d.indent + colors.green + d.suggestion + colors.reset + "\n" +
        d.contentAfter;
    } else {
      location =
        "\n    " + d.path + ":" + d.line + ":" + d.column + ":\n" +
        colors.dim + d.sourceBefore + colors.green + d.sourceMarked + colors.dim + d.sourceAfter + "\n" +
        emptyMarginText(maxMargin, true) + d.indent + colors.green + d.marker + colors.reset + "\n" +
        d.contentAfter;
    }
  }

  switch (kind) {
    case Verbose:
      iconColor = colors.cyan;
      kindColorBrackets = colors.cyanBgCyan;
      kindColorText = colors.cyanBgBlack;
      break;
    case Debug:
      iconColor = colors.green;
      kindColorBrackets = colors.greenBgGreen;
      kindColorText = colors.greenBgWhite;
      break;
    case Info:
      iconColor = colors.blue;
      kindColorBrackets = colors.blueBgBlue;
      kindColorText = colors.blueBgWhite;
      break;
    case Error:
      iconColor = colors.red;
      kindColorBrackets = colors.redBgRed;
      kindColorText = colors.redBgWhite;
      break;
    case Warning:
      iconColor = colors.yellow;
      kindColorBrackets = colors.yellowBgYellow;
      kindColorText = colors.yellowBgBlack;
      break;
    case Note: {
      let sb = "";
      for (const line of dataText.split("\n")) {
        // Special-case word wrapping
        let wrapWidth = terminalInfo.width;
        if (wrapWidth > 2) {
          if (!data.disableMaximumWidth && wrapWidth > 100) wrapWidth = 100; // Enforce a maximum paragraph width for readability
          for (const run of wrapWordsInString(line, wrapWidth - 2)) {
            sb += "  " + linkifyText(run, colors.underline, colors.reset) + "\n";
          }
          continue;
        }

        // Otherwise, just write an indented line
        sb += "  " + linkifyText(line, colors.underline, colors.reset) + "\n";
      }
      sb += location;
      return sb;
    }
  }

  if (pluginName !== "") pluginName = " " + colors.bold + colors.magenta + "[plugin " + toBytes(pluginName) + "]" + colors.reset;

  let msgID = msgIDToString(id);
  if (msgID !== "") msgID = " [" + msgID + "]";

  return (
    iconColor + kindIcon(kind) + " " +
    kindColorBrackets + "[" + kindColorText + kindString(kind) + kindColorBrackets + "]" + colors.reset + " " +
    colors.bold + dataText + colors.reset + pluginName + msgID + "\n" +
    location
  );
}

function linkifyText(text        , underline        , reset        )         {
  if (underline === "") return text;
  if (text.indexOf("https://") === -1) return text;
  let sb = "";
  for (;;) {
    const https = text.indexOf("https://");
    if (https === -1) break;
    let end = text.slice(https).indexOf(" ");
    if (end === -1) end = text.length;
    else end += https;

    // Remove trailing punctuation
    if (end > https) {
      switch (text[end - 1]) {
        case ".":
        case ",":
        case "?":
        case "!":
        case ")":
        case "]":
        case "}":
          end--;
      }
    }

    sb += text.slice(0, https) + underline + text.slice(https, end) + reset;
    text = text.slice(end);
  }
  return sb + text;
}

function wrapWordsInString(text        , width        )           {
  const runs           = [];

  outer: while (text !== "") {
    let i = 0;
    let x = 0;
    let wordEndI = 0;

    // Skip over any leading spaces
    while (i < text.length && text[i] === " ") {
      i++;
      x++;
    }

    // Find out how many words will fit in this run
    while (i < text.length) {
      const oldWordEndI = wordEndI;
      const wordStartI = i;

      // Find the end of the word
      while (i < text.length) {
        const $ = decodeRune(text, i);
        if ($[0] === 32) break;
        i += $[1];
        x += 1; // Naively assume that each unicode code point is a single column
      }
      wordEndI = i;

      // Split into a new run if this isn't the first word in the run and the end is past the width
      if (wordStartI > 0 && x > width) {
        runs.push(text.slice(0, oldWordEndI));
        text = text.slice(wordStartI);
        continue outer;
      }

      // Skip over any spaces after the word
      while (i < text.length && text[i] === " ") {
        i++;
        x++;
      }
    }

    // If we get here, this is the last run (i.e. everything fits)
    break;
  }

  // Remove any trailing spaces on the last run
  while (text.length > 0 && text[text.length - 1] === " ") text = text.slice(0, -1);
  runs.push(text);
  return runs;
}

;                    
                       
                       
                      
                 
                 
                     
                       
               
               
                 
 

function detailStruct(data         , pathStyle        , terminalInfo              , maxMargin        )            {
  // Only highlight the first line of the line text
  const loc = data.location.clone();
  const lineTextBytes = toBytes(loc.lineText);
  let endOfFirstLine = lineTextBytes.length;
  {
    const i = lineTextBytes.indexOf("\n");
    if (i >= 0) endOfFirstLine = i;
  }

  const firstLine = lineTextBytes.slice(0, endOfFirstLine);
  let afterFirstLine = lineTextBytes.slice(endOfFirstLine);
  if (afterFirstLine !== "" && !afterFirstLine.endsWith("\n")) afterFirstLine += "\n";

  // Clamp values in range
  if (loc.line < 0) loc.line = 0;
  if (loc.column < 0) loc.column = 0;
  if (loc.length < 0) loc.length = 0;
  if (loc.column > endOfFirstLine) loc.column = endOfFirstLine;
  if (loc.length > endOfFirstLine - loc.column) loc.length = endOfFirstLine - loc.column;

  const spacesPerTab = 2;
  let lineText = renderTabStops(firstLine, spacesPerTab);
  const textUpToLoc = renderTabStops(firstLine.slice(0, loc.column), spacesPerTab);
  let markerStart = textUpToLoc.length;
  let markerEnd = markerStart;
  let indent = " ".repeat(estimateWidthInTerminal(textUpToLoc));
  let marker = "^";

  // Extend markers to cover the full range of the error
  if (loc.length > 0) markerEnd = renderTabStops(firstLine.slice(0, loc.column + loc.length), spacesPerTab).length;

  // Clip the marker to the bounds of the line
  if (markerStart > lineText.length) markerStart = lineText.length;
  if (markerEnd > lineText.length) markerEnd = lineText.length;
  if (markerEnd < markerStart) markerEnd = markerStart;

  // Trim the line to fit the terminal width
  let width = terminalInfo.width;
  if (width < 1) width = defaultTerminalWidth;
  width -= maxMargin + extraMarginChars;
  if (width < 1) width = 1;
  if (loc.column === endOfFirstLine) {
    // If the marker is at the very end of the line, the marker will be a "^"
    // character that extends one column past the end of the line. In this case
    // we should reserve a column at the end so the marker doesn't wrap.
    width -= 1;
  }
  if (lineText.length > width) {
    // Try to center the error
    let sliceStart = Math.trunc((markerStart + markerEnd - width) / 2);
    if (sliceStart > markerStart - Math.trunc(width / 5)) sliceStart = markerStart - Math.trunc(width / 5);
    if (sliceStart < 0) sliceStart = 0;
    if (sliceStart > lineText.length - width) sliceStart = lineText.length - width;
    const sliceEnd = sliceStart + width;

    // Slice the line
    let slicedLine = lineText.slice(sliceStart, sliceEnd);
    markerStart -= sliceStart;
    markerEnd -= sliceStart;
    if (markerStart < 0) markerStart = 0;
    if (markerEnd > slicedLine.length) markerEnd = slicedLine.length;

    // Truncate the ends with "..."
    if (slicedLine.length > 3 && sliceStart > 0) {
      slicedLine = "..." + slicedLine.slice(3);
      if (markerStart < 3) markerStart = 3;
    }
    if (slicedLine.length > 3 && sliceEnd < lineText.length) {
      slicedLine = slicedLine.slice(0, slicedLine.length - 3) + "...";
      if (markerEnd > slicedLine.length - 3) markerEnd = slicedLine.length - 3;
      if (markerEnd < markerStart) markerEnd = markerStart;
    }

    // Now we can compute the indent
    lineText = slicedLine;
    indent = " ".repeat(estimateWidthInTerminal(lineText.slice(0, markerStart)));
  }

  // If marker is still multi-character after clipping, make the marker wider
  if (markerEnd - markerStart > 1) marker = "~".repeat(estimateWidthInTerminal(lineText.slice(markerStart, markerEnd)));

  // Put a margin before the marker indent
  const margin = marginWithLineText(maxMargin, loc.line);

  return {
    path: toBytes(loc.file.select(pathStyle)),

    // Note: We want to deliberately print the unclamped line and column, as it
    // may come from another tool that either didn't set "LineText" at all or
    // at least didn't calculate the column number correctly.
    line: data.location.line,
    column: data.location.column,

    sourceBefore: margin + lineText.slice(0, markerStart),
    sourceMarked: lineText.slice(markerStart, markerEnd),
    sourceAfter: lineText.slice(markerEnd),

    indent,
    marker,
    suggestion: toBytes(loc.suggestion),

    contentAfter: afterFirstLine,
  };
}

// Estimate the number of columns this string will take when printed
function estimateWidthInTerminal(text        )         {
  // For now just assume each code point is one column. This is wrong but is
  // less wrong than assuming each code unit is one column.
  let width = 0;
  let i = 0;
  while (i < text.length) {
    const $ = decodeRune(text, i);
    i += $[1];
    // Ignore the Zero Width No-Break Space character (UTF-8 BOM)
    if ($[0] !== 0xfeff) width++;
  }
  return width;
}

function renderTabStops(withTabs        , spacesPerTab        )         {
  if (withTabs.indexOf("\t") < 0) return withTabs;
  let withoutTabs = "";
  let count = 0;
  let i = 0;
  while (i < withTabs.length) {
    const $ = decodeRune(withTabs, i);
    const c = $[0];
    i += $[1];
    if (c === 9) {
      const spaces = spacesPerTab - (count % spacesPerTab);
      for (let k = 0; k < spaces; k++) {
        withoutTabs += " ";
        count++;
      }
    } else {
      withoutTabs += runeBytes(c);
      count++;
    }
  }
  return withoutTabs;
}

function msgToStringVisualStudio(msg     , options               , terminalInfo              )         {
  let text = "";

  // Write the origin
  const loc = msg.data.location;
  if (loc !== null) {
    // Potentially this needs to always be an absolute path?
    text += toBytes(loc.file.abs);

    // Note: Need to adjust the column from 0-based to 1-based
    if (loc.line > 0) text += "(" + loc.line + "," + (loc.column + 1) + ")";
    text += ": ";
  } else {
    // If there is no file, then we must write a tool name
    text += "esbuild: ";
  }

  // The code appears to be required, so make something up
  const code = "ES" + String(msgIDToVSID(msg.id)).padStart(4, "0");

  // The only valid options for the category seem to be "error" and "warning"
  if (msg.kind === Error) text += "error " + code + ": ";
  else text += "warning " + code + ": ";

  text += toBytes(msg.data.text) + "\n";
  return text;
}

function plural(prefix        , count        , shown        , someAreMissing         )         {
  let text        ;
  if (count === 1) text = count + " " + prefix;
  else text = count + " " + prefix + "s";
  if (shown < count) text = shown + " of " + text;
  else if (someAreMissing && count > 1) text = "all " + text;
  return text;
}

function errorAndWarningSummary(errors        , warnings        , shownErrors        , shownWarnings        )         {
  const someAreMissing = shownWarnings < warnings || shownErrors < errors;
  if (errors === 0) return plural("warning", warnings, shownWarnings, someAreMissing);
  if (warnings === 0) return plural("error", errors, shownErrors, someAreMissing);
  return plural("warning", warnings, shownWarnings, someAreMissing) + " and " + plural("error", errors, shownErrors, someAreMissing);
}

// ---------------------------------------------------------------------------
// The API's side (pkg/api convertMessagesToPublic + cmd/esbuild/service.go
// encodeMessages): the "errors"/"warnings" arrays of a response packet, as
// esbuild's glue decodes them (Go encodes maps with sorted keys; strings are
// UTF-8, which the glue decodes with a TextDecoder: a lone surrogate's 3
// bytes become 3 U+FFFD).

// What the glue gets for a Go string in a response: its bytes (see
// helpers.goStringBytes) through a default TextDecoder, which drops a
// leading BOM and replaces invalid UTF-8 with U+FFFD
let glueDecoder                     = null;
export function packetString(s        )         {
  if (s.charCodeAt(0) !== 0xfeff && s.isWellFormed()) return s;
  if (glueDecoder === null) glueDecoder = new TextDecoder();
  return glueDecoder.decode(goStringBytes(s));
}

function encodeLocation(loc                    , pathStyle        )      {
  if (loc === null) return null;
  return {
    column: loc.column,
    file: packetString(loc.file.select(pathStyle)),
    length: loc.length,
    line: loc.line,
    lineText: packetString(loc.lineText),
    namespace: packetString(loc.namespace),
    suggestion: packetString(loc.suggestion),
  };
}

// "detail": the glue's stash ID of a plugin's "detail" value (Go sends -1 for none;
// ints reach the glue as uint32, so -1 arrives as 4294967295)
export function convertMessagesToPacket(kind        , msgs       , pathStyle        )        {
  const values = [];
  for (const msg of msgs) {
    if (msg.kind !== kind) continue;
    const notes = [];
    if (msg.notes !== null) for (const note of msg.notes) notes.push({ location: encodeLocation(note.location, pathStyle), text: packetString(note.text) });
    const detail = msg.data.userDetail;
    values.push({
      detail: typeof detail === "number" ? (detail | 0) >>> 0 : 4294967295,
      id: msgIDToString(msg.id),
      location: encodeLocation(msg.data.location, pathStyle),
      notes,
      pluginName: packetString(msg.pluginName),
      text: packetString(msg.data.text),
    });
  }
  return values;
}

// ---------------------------------------------------------------------------
// Message IDs (internal/logger/msg_ids.go)

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

// logger.MsgIDToString: the names used by esbuild's "logOverride" setting
// (index = MsgID; the vsID of MsgIDs 1-54 is the MsgID itself)
const MSG_ID_NAMES = [
  "",
  "assert-to-with",
  "assert-type-json",
  "assign-to-constant",
  "assign-to-define",
  "assign-to-import",
  "bigint",
  "call-import-namespace",
  "class-name-will-throw",
  "commonjs-variable-in-esm",
  "confusing-typescript-cast",
  "delete-super-property",
  "direct-eval",
  "duplicate-case",
  "duplicate-class-member",
  "duplicate-object-key",
  "empty-import-meta",
  "equals-nan",
  "equals-negative-zero",
  "equals-new-object",
  "html-comment-in-js",
  "impossible-typeof",
  "indirect-require",
  "private-name-will-throw",
  "semicolon-after-return",
  "suspicious-boolean-not",
  "suspicious-define",
  "suspicious-logical-operator",
  "suspicious-nullish-coalescing",
  "this-is-undefined-in-esm",
  "unsupported-dynamic-import",
  "unsupported-jsx-comment",
  "unsupported-regexp",
  "unsupported-require-call",
  "css-syntax-error",
  "invalid-@charset",
  "invalid-@import",
  "invalid-@layer",
  "invalid-calc",
  "js-comment-in-css",
  "undefined-composes-from",
  "unsupported-@charset",
  "unsupported-@namespace",
  "unsupported-css-property",
  "unsupported-css-nesting",
  "ambiguous-reexport",
  "different-path-case",
  "empty-glob",
  "ignored-bare-import",
  "ignored-dynamic-import",
  "import-is-undefined",
  "require-resolve-not-external",
  "invalid-source-mappings",
  "missing-source-map",
  "unsupported-source-map-comment",
];
export function msgIDToString(id        )         {
  if (id >= MsgID_PackageJSON_FIRST && id <= MsgID_PackageJSON_LAST) return "package.json";
  if (id >= MsgID_TSConfigJSON_FIRST && id <= MsgID_TSConfigJSON_LAST) return "tsconfig.json";
  return id > 0 && id < MSG_ID_NAMES.length ? MSG_ID_NAMES[id] : "";
}
function msgIDToVSID(id        )         {
  if (id >= MsgID_PackageJSON_FIRST && id <= MsgID_PackageJSON_LAST) return 55;
  if (id >= MsgID_TSConfigJSON_FIRST && id <= MsgID_TSConfigJSON_LAST) return 56;
  return id > 0 && id < MSG_ID_NAMES.length ? id : 0;
}

// logger.StringToMsgIDs
export function stringToMsgIDs(str        , logLevel        , overrides                     ) {
  if (str === "package.json") {
    for (let i = MsgID_PackageJSON_FIRST; i <= MsgID_PackageJSON_LAST; i++) overrides.set(i, logLevel);
    return;
  }
  if (str === "tsconfig.json") {
    for (let i = MsgID_TSConfigJSON_FIRST; i <= MsgID_TSConfigJSON_LAST; i++) overrides.set(i, logLevel);
    return;
  }
  if (str === "") return;
  const i = MSG_ID_NAMES.indexOf(str);
  // Ignore invalid entries since this message id may have
  // been renamed/removed since when this code was written
  if (i > 0) overrides.set(i, logLevel);
}

// logger.StringToMaximumMsgID
export function stringToMaximumMsgID(id        )         {
  const overrides = new Map                ();
  let maxID = MsgID_None;
  stringToMsgIDs(id, LevelInfo, overrides);
  for (const k of overrides.keys()) if (k > maxID) maxID = k;
  return maxID;
}

// ---------------------------------------------------------------------------
// Messages coming from the glue (plugins): cmd/esbuild/service.go
// decodeMessages gives api.Message values, which the port keeps in the
// packet's shape (the same object encodeMessages would send back).

function decodePacketLocation(loc     )      {
  if (loc === null || loc === undefined) return null;
  let namespace = loc.namespace;
  if (namespace === "") namespace = "file";
  // (numbers reach Go as int32 bits decoded as uint32: -1 is 4294967295)
  return { column: (loc.column | 0) >>> 0, file: loc.file, length: (loc.length | 0) >>> 0, line: (loc.line | 0) >>> 0, lineText: loc.lineText, namespace, suggestion: loc.suggestion };
}

export function decodePacketMessage(m     )      {
  const notes = [];
  if (Array.isArray(m.notes)) for (const n of m.notes) notes.push({ location: decodePacketLocation(n.location), text: n.text });
  return { detail: m.detail, id: m.id, location: decodePacketLocation(m.location), notes, pluginName: m.pluginName, text: m.text };
}

// api_impl.go convertLocationToInternal (from a packet-shaped location)
function convertLocationToInternal(loc     )                     {
  if (loc === null || loc === undefined) return null;
  let namespace = loc.namespace;
  if (namespace === "") namespace = "file";
  return new MsgLocation(new PrettyPaths(loc.file, loc.file), namespace, loc.lineText, loc.suggestion, loc.line, loc.column, loc.length);
}

// api_impl.go convertMessagesToInternal
export function convertMessagesToInternal(msgs       , kind        , messages       )        {
  for (const message of messages) {
    let notes                   = null;
    if (Array.isArray(message.notes) && message.notes.length > 0) {
      notes = [];
      for (const note of message.notes) notes.push(new MsgData(null, convertLocationToInternal(note.location), note.text));
    }
    msgs.push(new Msg(notes, message.pluginName, new MsgData(message.detail, convertLocationToInternal(message.location), message.text), kind, stringToMaximumMsgID(message.id)));
  }
  return msgs;
}

// api_impl.go convertErrorsAndWarningsToInternal
export function convertErrorsAndWarningsToInternal(errors       , warnings       )        {
  if (errors.length + warnings.length > 0) {
    const msgs        = [];
    convertMessagesToInternal(msgs, Error, errors);
    convertMessagesToInternal(msgs, Warning, warnings);
    sortMsgsStable(msgs);
    return msgs;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Printing outside of a log (logger.go PrintText, PrintTextWithColor,
// OutputOptionsForArgs, PrintMessageToStderr, PrintErrorToStderr,
// PrintErrorWithNoteToStderr, PrintSummary)

// Go's stdout (the CLI)
let stdoutSink                                       = null;
export function setStdout(sink                                      ) {
  stdoutSink = sink;
}
// "bytes" is a byte string
export function writeStdout(bytes        ) {
  const n = bytes.length;
  const array = new Uint8Array(n);
  for (let i = 0; i < n; i++) array[i] = bytes.charCodeAt(i);
  writeStdoutBytes(array);
}
export function writeStdoutBytes(bytes            ) {
  if (stdoutSink !== null) {
    stdoutSink(bytes);
    return;
  }
  // (the browser: wasm_exec.js prints fd 1 like fd 2)
  writeStderr(fromBytesToByteString(bytes));
}
function fromBytesToByteString(bytes            )         {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

// "write" takes a byte string. (GetTerminalInfo(file) is the zero value on
// GOOS=js and SupportsColorEscapes is false: esbuild-wasm prints no colors.)
export function printTextWithColor(write                         , useColor        , callback                            ) {
  let useColorEscapes = false;
  switch (useColor) {
    case ColorNever:
      useColorEscapes = false;
      break;
    case ColorAlways:
      useColorEscapes = SupportsColorEscapes;
      break;
    case ColorIfTerminal:
      useColorEscapes = new TerminalInfo().useColorEscapes;
      break;
  }

  const colors = useColorEscapes ? TERMINAL_COLORS : NO_COLORS;
  write(toBytes(callback(colors)));
}

export function printText(write                         , level        , osArgs          , callback                            ) {
  const options = outputOptionsForArgs(osArgs);

  // Skip logging these if these logs are disabled
  if (options.logLevel > level) {
    return;
  }

  printTextWithColor(write, options.color, callback);
}

export function outputOptionsForArgs(osArgs          )                {
  const options = new OutputOptions(0, true, ColorIfTerminal, LevelNone, StyleDefault);

  // Implement a mini argument parser so these options always work even if we
  // haven't yet gotten to the general-purpose argument parsing code
  for (const arg of osArgs) {
    switch (arg) {
      case "--color=false":
        options.color = ColorNever;
        break;
      case "--color=true":
      case "--color":
        options.color = ColorAlways;
        break;

      case "--log-level=info":
        options.logLevel = LevelInfo;
        break;
      case "--log-level=warning":
        options.logLevel = LevelWarning;
        break;
      case "--log-level=error":
        options.logLevel = LevelError;
        break;
      case "--log-level=silent":
        options.logLevel = LevelSilent;
        break;

      case "--log-style=default":
        options.logStyle = StyleDefault;
        break;
      case "--log-level=visualstudio":
        options.logStyle = StyleVisualStudio;
        break;
    }
  }

  return options;
}

export function printMessageToStderr(osArgs          , msg     ) {
  const log = newStderrLog(outputOptionsForArgs(osArgs));
  log.addMsg(msg);
  log.done();
  log.flushStderr();
}

export function printErrorToStderr(osArgs          , text        ) {
  printMessageToStderr(osArgs, new Msg(null, "", new MsgData(undefined, null, text), Error));
}

export function printErrorWithNoteToStderr(osArgs          , text        , note        ) {
  let notes                   = null;
  if (note !== "") {
    notes = [new MsgData(undefined, null, note)];
  }
  printMessageToStderr(osArgs, new Msg(notes, "", new MsgData(undefined, null, text), Error));
}

export class SummaryTableEntry {
  ;                   
  ;                    
  ;                    
  ;                     
  ;                            
  constructor(dir = "", base = "", size = "", bytes = 0, isSourceMap = false) {
    this.dir = dir;
    this.base = base;
    this.size = size;
    this.bytes = bytes;
    this.isSourceMap = isSourceMap;
  }
}

// SummaryTable.Less
function summaryTableLess(ti                   , tj                   )          {
  // Sort source maps last
  if (!ti.isSourceMap && tj.isSourceMap) {
    return true;
  }
  if (ti.isSourceMap && !tj.isSourceMap) {
    return false;
  }

  // Sort by size first
  if (ti.bytes > tj.bytes) {
    return true;
  }
  if (ti.bytes < tj.bytes) {
    return false;
  }

  // Sort alphabetically by directory first
  if (goStringLess(ti.dir, tj.dir)) {
    return true;
  }
  if (goStringLess(tj.dir, ti.dir)) {
    return false;
  }

  // Then sort alphabetically by file name
  return goStringLess(ti.base, tj.base);
}

const sizeWarningThreshold = 1024 * 1024;

// "start" is the start time (ms, Date.now()) or null. Strings are measured
// in bytes like Go.
export function printSummary(useColor        , table                     , start               ) {
  printTextWithColor(writeStderr, useColor, (colors) => {
    // (GOOS=js: never Windows Command Prompt)
    const isProbablyWindowsCommandPrompt = false;
    let sb = "";

    if (table.length > 0) {
      // (GetTerminalInfo on GOOS=js: the zero value)
      const info = new TerminalInfo();

      // Truncate the table in case it's really long
      let maxLength = Math.trunc(info.height / 2);
      if (info.height === 0) {
        maxLength = 20;
      } else if (maxLength < 5) {
        maxLength = 5;
      }
      const length = table.length;
      // (sort.Sort: the keys are distinct in practice)
      table = table.slice().sort((a, b) => (summaryTableLess(a, b) ? -1 : summaryTableLess(b, a) ? 1 : 0));
      if (length > maxLength) {
        table = table.slice(0, maxLength);
      }

      // Compute the maximum width of the size column
      const spacingBetweenColumns = 2;
      let hasSizeWarning = false;
      let maxPath = 0;
      let maxSize = 0;
      for (const entry of table) {
        const path = utf8Length(entry.dir) + utf8Length(entry.base);
        const size = utf8Length(entry.size) + spacingBetweenColumns;
        if (path > maxPath) {
          maxPath = path;
        }
        if (size > maxSize) {
          maxSize = size;
        }
        if (!entry.isSourceMap && entry.bytes >= sizeWarningThreshold) {
          hasSizeWarning = true;
        }
      }

      const margin = "  ";
      let layoutWidth = info.width;
      if (layoutWidth < 1) {
        layoutWidth = defaultTerminalWidth;
      }
      layoutWidth -= 2 * margin.length;
      if (hasSizeWarning) {
        // Add space for the warning icon
        layoutWidth -= 2;
      }
      if (layoutWidth > maxPath + maxSize) {
        layoutWidth = maxPath + maxSize;
      }
      sb += "\n";

      for (const entry of table) {
        // (Go slices bytes: work on the byte strings)
        let dir = toBytes(entry.dir);
        let base = toBytes(entry.base);
        const pathWidth = layoutWidth - maxSize;

        // Truncate the path with "..." to fit on one line
        if (dir.length + base.length > pathWidth) {
          // Trim the directory from the front, leaving the trailing slash
          if (dir.length > 0) {
            let n = pathWidth - base.length - 3;
            if (n < 1) {
              n = 1;
            }
            dir = "..." + dir.slice(dir.length - n);
          }

          // Trim the file name from the back
          if (dir.length + base.length > pathWidth) {
            let n = pathWidth - dir.length - 3;
            if (n < 0) {
              n = 0;
            }
            base = base.slice(0, n) + "...";
          }
        }

        let spacer = layoutWidth - utf8Length(entry.size) - dir.length - base.length;
        if (spacer < 0) {
          spacer = 0;
        }

        // Put a warning next to the size if it's above a certain threshold
        let sizeColor = colors.cyan;
        let sizeWarning = "";
        if (!entry.isSourceMap && entry.bytes >= sizeWarningThreshold) {
          sizeColor = colors.yellow;

          // Emoji don't work in Windows Command Prompt
          if (!isProbablyWindowsCommandPrompt) {
            sizeWarning = " " + String.fromCharCode(0x26a0, 0xfe0f);
          }
        }

        sb +=
          margin +
          colors.dim +
          fromBytes(dir) +
          colors.reset +
          colors.bold +
          fromBytes(base) +
          colors.reset +
          " ".repeat(spacer) +
          sizeColor +
          entry.size +
          sizeWarning +
          colors.reset +
          "\n";
      }

      // Say how many remaining files are not shown
      if (length > maxLength) {
        let plural = "s";
        if (length === maxLength + 1) {
          plural = "";
        }
        sb += margin + colors.dim + "...and " + (length - maxLength) + " more output file" + plural + "..." + colors.reset + "\n";
      }
    }
    sb += "\n";

    let lightningSymbol = String.fromCharCode(0x26a1) + " ";

    // Emoji don't work in Windows Command Prompt
    if (isProbablyWindowsCommandPrompt) {
      lightningSymbol = "";
    }

    // Printing the time taken is optional
    if (start !== null) {
      sb += lightningSymbol + colors.green + "Done in " + Math.trunc(Date.now() - start) + "ms" + colors.reset + "\n";
    }

    return sb;
  });
}

function utf8Length(s        )         {
  return toBytes(s).length;
}
// generated from logger.mts by tools/ts-build.mjs; edit that file
