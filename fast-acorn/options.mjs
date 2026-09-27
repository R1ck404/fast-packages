// acorn's getOptions(), without the per-key for-in / keyed stores: the
// result is built as an object literal with defaultOptions' keys in their
// iteration order, reading every key exactly as acorn does (hasOwn on the
// given options, then the value from it or from defaultOptions), followed by
// acorn's normalisation steps verbatim. Used only while defaultOptions
// enumerates exactly its original keys (checked on every call: users may
// modify acorn.defaultOptions); otherwise acorn's own getOptions runs.

import { defaultOptions, SourceLocation, _getOptions as acornGetOptions, _warnAboutEcmaVersionOnce } from "./vendor/acorn.mjs";

const hasOwn = Object.hasOwn;
const NONE = Object.freeze(Object.create(null));
const isArray = Array.isArray;
const KEYS = [
  "ecmaVersion",
  "sourceType",
  "strict",
  "onInsertedSemicolon",
  "onTrailingComma",
  "allowReserved",
  "allowReturnOutsideFunction",
  "allowImportExportEverywhere",
  "allowAwaitOutsideFunction",
  "allowSuperOutsideMethod",
  "allowHashBang",
  "checkPrivateFields",
  "locations",
  "startLocation",
  "onToken",
  "onComment",
  "ranges",
  "program",
  "sourceFile",
  "directSourceFile",
  "preserveParens",
];
const NKEYS = KEYS.length;
{
  const actual = [];
  for (const k in defaultOptions) actual.push(k);
  if (actual.join() !== KEYS.join()) throw new Error("fast-acorn: unexpected acorn defaultOptions");
}

// acorn's pushComment
function pushComment(options, array) {
  return function (block, text, start, end, startLoc, endLoc) {
    const comment = {
      type: block ? "Block" : "Line",
      value: text,
      start: start,
      end: end,
    };
    if (options.locations) comment.loc = new SourceLocation(this, startLoc, endLoc);
    if (options.ranges) comment.range = [start, end];
    array.push(comment);
  };
}

export function getOptions(opts) {
  const d = defaultOptions;
  let i = 0;
  for (const k in d) if (k !== KEYS[i++]) return acornGetOptions(opts);
  if (i !== NKEYS) return acornGetOptions(opts);
  // (acorn: "opts && hasOwn(opts, opt)"; NONE has no own properties)
  const o = opts ? opts : NONE;
  const options = {
    ecmaVersion: hasOwn(o, "ecmaVersion") ? o.ecmaVersion : d.ecmaVersion,
    sourceType: hasOwn(o, "sourceType") ? o.sourceType : d.sourceType,
    strict: hasOwn(o, "strict") ? o.strict : d.strict,
    onInsertedSemicolon: hasOwn(o, "onInsertedSemicolon") ? o.onInsertedSemicolon : d.onInsertedSemicolon,
    onTrailingComma: hasOwn(o, "onTrailingComma") ? o.onTrailingComma : d.onTrailingComma,
    allowReserved: hasOwn(o, "allowReserved") ? o.allowReserved : d.allowReserved,
    allowReturnOutsideFunction: hasOwn(o, "allowReturnOutsideFunction") ? o.allowReturnOutsideFunction : d.allowReturnOutsideFunction,
    allowImportExportEverywhere: hasOwn(o, "allowImportExportEverywhere") ? o.allowImportExportEverywhere : d.allowImportExportEverywhere,
    allowAwaitOutsideFunction: hasOwn(o, "allowAwaitOutsideFunction") ? o.allowAwaitOutsideFunction : d.allowAwaitOutsideFunction,
    allowSuperOutsideMethod: hasOwn(o, "allowSuperOutsideMethod") ? o.allowSuperOutsideMethod : d.allowSuperOutsideMethod,
    allowHashBang: hasOwn(o, "allowHashBang") ? o.allowHashBang : d.allowHashBang,
    checkPrivateFields: hasOwn(o, "checkPrivateFields") ? o.checkPrivateFields : d.checkPrivateFields,
    locations: hasOwn(o, "locations") ? o.locations : d.locations,
    startLocation: hasOwn(o, "startLocation") ? o.startLocation : d.startLocation,
    onToken: hasOwn(o, "onToken") ? o.onToken : d.onToken,
    onComment: hasOwn(o, "onComment") ? o.onComment : d.onComment,
    ranges: hasOwn(o, "ranges") ? o.ranges : d.ranges,
    program: hasOwn(o, "program") ? o.program : d.program,
    sourceFile: hasOwn(o, "sourceFile") ? o.sourceFile : d.sourceFile,
    directSourceFile: hasOwn(o, "directSourceFile") ? o.directSourceFile : d.directSourceFile,
    preserveParens: hasOwn(o, "preserveParens") ? o.preserveParens : d.preserveParens,
  };
  if (options.ecmaVersion === "latest") {
    options.ecmaVersion = 1e8;
  } else if (options.ecmaVersion == null) {
    _warnAboutEcmaVersionOnce();
    options.ecmaVersion = 11;
  } else if (options.ecmaVersion >= 2015) {
    options.ecmaVersion -= 2009;
  }
  if (options.allowReserved == null) options.allowReserved = options.ecmaVersion < 5;
  if (!opts || opts.allowHashBang == null) options.allowHashBang = options.ecmaVersion >= 14;
  if (isArray(options.onToken)) {
    const tokens = options.onToken;
    options.onToken = function (token) {
      return tokens.push(token);
    };
  }
  if (isArray(options.onComment)) options.onComment = pushComment(options, options.onComment);
  if (options.sourceType === "commonjs" && options.allowAwaitOutsideFunction)
    throw new Error("Cannot use allowAwaitOutsideFunction with sourceType: commonjs");
  return options;
}
