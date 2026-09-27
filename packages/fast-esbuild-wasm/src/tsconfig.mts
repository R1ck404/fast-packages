// Port of the parts of internal/resolver that a transform runs for the
// "tsconfigRaw" option:
//
//   - tsconfig_json.go: ParseTSConfigJSON and its helpers
//   - resolver.go: the "tsconfig.json" override of NewResolver
//     (applyTSConfigOverride below), parseTSConfigFromSource for a transform
//     (visited == nil, so "extends" is deliberately not processed), and
//     getProperty/getString/getBool
//   - config.go: TSConfigJSX and its ApplyTo method (defined locally since
//     config.mjs does not have it)
//
// A transform uses a mock file system ("fs.MockFS(..., fs.MockUnix, "/")")
// whose current directory is "/", so the raw tsconfig's key path is
// "/<tsconfig.json>", which is never inside "node_modules": every warning
// below is reported (and therefore bails).
import { bail } from "./bail.mjs";
import {
  Source,
  Path,
  PrettyPaths,
  Range,
  LineColumnTracker,
  Warning,
  MsgID_TSConfigJSON_InvalidTarget,
  MsgID_TSConfigJSON_InvalidImportsNotUsedAsValues,
  MsgID_TSConfigJSON_InvalidJSX,
  MsgID_TSConfigJSON_InvalidPaths,
  MsgID_TSConfigJSON_InvalidTopLevelOption,
} from "./logger.mjs";
import { isInsideNodeModules } from "./helpers.mjs";
import {
  DefineExpr,
  TSConfig,
  TSOptions,
  TSAlwaysStrict,
  TSJSXNone,
  TSJSXPreserve,
  TSJSXReactNative,
  TSJSXReact,
  TSJSXReactJSX,
  TSJSXReactJSXDev,
  True,
  False,
  TSImportsNotUsedAsValues_Remove,
  TSImportsNotUsedAsValues_Preserve,
  TSImportsNotUsedAsValues_Error,
  TSTargetBelowES2022,
  TSTargetAtOrAboveES2022,
} from "./config.mjs";
import { EArray, EObject, EString, EBoolean } from "./js_ast.mjs";
import { isIdentifier } from "./js_ident.mjs";
import { TSConfigJSON as FlavorTSConfigJSON, rangeOfIdentifier } from "./js_lexer.mjs";
import { parseJSON, JSONOptions } from "./json_parser.mjs";

// ---------------------------------------------------------------------------
// config.go: TSConfigJSX

export class TSConfigJSX {
  declare jsxFactory: any;
  declare jsxFragmentFactory: any;
  declare jsxImportSource: any;
  declare jsx: number;
  constructor() {
    // If not empty, these should override the default values
    this.jsxFactory = null; // []string; default if empty: "React.createElement"
    this.jsxFragmentFactory = null; // []string; default if empty: "React.Fragment"
    this.jsxImportSource = null; // *string; default if empty: "react"
    this.jsx = TSJSXNone;
  }

  // (ApplyExtendedConfig is only used for "extends", which a transform skips)

  applyTo(jsxOptions) {
    switch (this.jsx) {
      case TSJSXPreserve:
      case TSJSXReactNative:
        // Deliberately don't set "Preserve = true" here. Some tools from Vercel
        // apparently automatically set "jsx": "preserve" in "tsconfig.json" and
        // people are then confused when esbuild preserves their JSX. Ignoring this
        // value means you now have to explicitly pass "--jsx=preserve" to esbuild
        // to get this behavior.
        break;

      case TSJSXReact:
        jsxOptions.automaticRuntime = false;
        jsxOptions.development = false;
        break;

      case TSJSXReactJSX:
        jsxOptions.automaticRuntime = true;
        // Deliberately don't set "Development = false" here. People want to be
        // able to have "react-jsx" in their "tsconfig.json" file and then swap
        // that to "react-jsxdev" by passing "--jsx-dev" to esbuild.
        break;

      case TSJSXReactJSXDev:
        jsxOptions.automaticRuntime = true;
        jsxOptions.development = true;
        break;
    }

    if (this.jsxFactory !== null && this.jsxFactory.length > 0) {
      jsxOptions.factory = new DefineExpr(null, this.jsxFactory);
    }

    if (this.jsxFragmentFactory !== null && this.jsxFragmentFactory.length > 0) {
      jsxOptions.fragment = new DefineExpr(null, this.jsxFragmentFactory);
    }

    if (this.jsxImportSource !== null) {
      jsxOptions.importSource = this.jsxImportSource;
    }
  }
}

// ---------------------------------------------------------------------------
// tsconfig_json.go

export class TSConfigJSON {
  declare absPath: string;
  declare baseURL: any;
  declare baseURLForPaths: string;
  declare paths: any;
  declare tsTargetKey: tsTargetKey;
  declare tsStrict: any;
  declare tsAlwaysStrict: any;
  declare jsxSettings: TSConfigJSX;
  declare settings: TSConfig;
  constructor() {
    this.absPath = "";

    // The absolute path of "compilerOptions.baseUrl"
    this.baseURL = null; // *string

    // This is used if "Paths" is non-nil. It's equal to "BaseURL" except if
    // "BaseURL" is missing, in which case it is as if "BaseURL" was ".". This
    // is to implement the "paths without baseUrl" feature from TypeScript 4.1.
    // More info: https://github.com/microsoft/TypeScript/issues/31869
    this.baseURLForPaths = "";

    // The verbatim values of "compilerOptions.paths". The keys are patterns to
    // match and the values are arrays of fallback paths to search. Each key and
    // each fallback path can optionally have a single "*" wildcard character.
    // If both the key and the value have a wildcard, the substring matched by
    // the wildcard is substituted into the fallback path. The keys represent
    // module-style path names and the fallback paths are relative to the
    // "baseUrl" value in the "tsconfig.json" file.
    this.paths = null; // TSConfigPaths

    this.tsTargetKey = new tsTargetKey();
    this.tsStrict = null; // *config.TSAlwaysStrict
    this.tsAlwaysStrict = null; // *config.TSAlwaysStrict
    this.jsxSettings = new TSConfigJSX();
    this.settings = new TSConfig();
  }

  // (applyExtendedConfig is only used for "extends", which a transform skips)

  tsAlwaysStrictOrStrict() {
    if (this.tsAlwaysStrict !== null) {
      return this.tsAlwaysStrict;
    }

    // If "alwaysStrict" is absent, it defaults to "strict" instead
    return this.tsStrict;
  }
}

// This information is only used for error messages
class tsTargetKey {
  declare lowerValue: string;
  declare source: any;
  declare range: Range;
  constructor(lowerValue = "", source = null, range = new Range(0, 0)) {
    this.lowerValue = lowerValue;
    this.source = source;
    this.range = range;
  }
}

class TSConfigPath {
  declare text: string;
  declare loc: number;
  constructor(text = "", loc = 0) {
    this.text = text;
    this.loc = loc;
  }
}

class TSConfigPaths {
  declare map: Map<any, any>;
  declare source: any;
  constructor(map = new Map(), source = null) {
    this.map = map; // map[string][]TSConfigPath

    // This may be different from the original "tsconfig.json" source if the
    // "paths" value is from another file via an "extends" clause.
    this.source = source;
  }
}

// The subset of fs.MockFS(..., fs.MockUnix, "/") used here

// Go's path.Clean
function goPathClean(p) {
  if (p === "") return ".";
  const rooted = p.charCodeAt(0) === 47; // '/'
  const out = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!rooted) out.push("..");
      continue;
    }
    out.push(part);
  }
  const s = out.join("/");
  if (rooted) return "/" + s;
  return s === "" ? "." : s;
}

// mockFS.Join (Go's path.Clean(path.Join(parts...)))
function mockJoin(a, b) {
  if (a === "" && b === "") return ".";
  if (a === "") return goPathClean(b);
  if (b === "") return goPathClean(a);
  return goPathClean(a + "/" + b);
}

// mockFS.IsAbs
function mockIsAbs(p) {
  return p.charCodeAt(0) === 47; // '/'
}

// mockFS.Dir (Go's path.Dir)
function mockDir(p) {
  const slash = p.lastIndexOf("/");
  return goPathClean(p.slice(0, slash + 1));
}

// Go's strings.ToLower, as far as it matters here: the result is only
// compared with ASCII strings (and kept for error messages). Go uses simple
// case mappings, under which U+0130 and U+212A are the only non-ASCII
// characters that map to ASCII ("i" and "k"); every other non-ASCII character
// (and every invalid UTF-8 byte of a lone surrogate) stays non-ASCII, so
// replacing it with U+FFFD preserves every comparison.
function goStringsToLower(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i];
    } else if (c === 0x130) {
      out += "i";
    } else if (c === 0x212a) {
      out += "k";
    } else {
      out += String.fromCharCode(0xfffd);
    }
  }
  return out;
}

// resolver.go
function getProperty(json, name) {
  if (json.data instanceof EObject) {
    for (let $i110 = 0, $a110 = json.data.properties; $i110 < $a110.length; $i110++) {
      const prop = $a110[$i110];
      const key = prop.key.data;
      if (key instanceof EString && key.value === name) {
        return [prop.valueOrNil, prop.key.loc, true];
      }
    }
  }
  return [null, 0, false];
}

// (helpers.UTF16ToString turns lone surrogates into WTF-8. Comparing that with
// an ASCII string, or looking at its ASCII characters, gives the same results
// as doing so on the JS string; values that reach the output or are decoded
// rune by rune bail on lone surrogates where they are used.)
function getString(json) {
  if (json.data instanceof EString) {
    return [json.data.value, true];
  }
  return ["", false];
}

function getBool(json) {
  if (json.data instanceof EBoolean) {
    return [json.data.value, true];
  }
  return [false, false];
}

export function parseTSConfigJSON(log, source, fileDir, configDir, extends_) {
  // Unfortunately "tsconfig.json" isn't actually JSON. It's some other
  // format that appears to be defined by the implementation details of the
  // TypeScript compiler.
  //
  // Attempt to parse it anyway by modifying the JSON parser, but just for
  // these particular files. This is likely not a completely accurate
  // emulation of what the TypeScript compiler does (e.g. string escape
  // behavior may also be different).
  // (jsonCache.Parse: each transform has a fresh cache, so this always misses)
  const [json, ok] = parseJSON(log, source, new JSONOptions(0, FlavorTSConfigJSON));
  if (!ok) {
    return null;
  }

  const result = new TSConfigJSON();
  result.absPath = source.keyPath.text;
  const tracker = new LineColumnTracker(source);

  // Parse "extends"
  if (extends_ !== null) {
    const [valueJSON, , ok] = getProperty(json, "extends");
    if (ok) {
      const [value, ok] = getString(valueJSON);
      if (ok) {
        const base = extends_(value, source.rangeOfString(valueJSON.loc));
        if (base !== null) {
          bail(); // (applyExtendedConfig: "extends" is only processed when building)
        }
      } else if (valueJSON.data instanceof EArray) {
        for (let $i111 = 0, $a111 = valueJSON.data.items; $i111 < $a111.length; $i111++) {
          const item = $a111[$i111];
          const [str, ok] = getString(item);
          if (ok) {
            const base = extends_(str, source.rangeOfString(item.loc));
            if (base !== null) {
              bail(); // (applyExtendedConfig: "extends" is only processed when building)
            }
          }
        }
      }
    }
  }

  // Parse "compilerOptions"
  const [compilerOptionsJSON, , hasCompilerOptions] = getProperty(json, "compilerOptions");
  if (hasCompilerOptions) {
    // Parse "baseUrl"
    {
      const [valueJSON, , ok] = getProperty(compilerOptionsJSON, "baseUrl");
      if (ok) {
        let [value, ok] = getString(valueJSON);
        if (ok) {
          value = getSubstitutedPathWithConfigDirTemplate(value, configDir);
          if (!mockIsAbs(value)) {
            value = mockJoin(fileDir, value);
          }
          result.baseURL = value;
        }
      }
    }

    // Parse "jsx"
    {
      const [valueJSON, , ok] = getProperty(compilerOptionsJSON, "jsx");
      if (ok) {
        const [value, ok] = getString(valueJSON);
        if (ok) {
          switch (goStringsToLower(value)) {
            case "preserve":
              result.jsxSettings.jsx = TSJSXPreserve;
              break;
            case "react-native":
              result.jsxSettings.jsx = TSJSXReactNative;
              break;
            case "react":
              result.jsxSettings.jsx = TSJSXReact;
              break;
            case "react-jsx":
              result.jsxSettings.jsx = TSJSXReactJSX;
              break;
            case "react-jsxdev":
              result.jsxSettings.jsx = TSJSXReactJSXDev;
              break;
          }
        }
      }
    }

    // Parse "jsxFactory"
    {
      const [valueJSON, , ok] = getProperty(compilerOptionsJSON, "jsxFactory");
      if (ok) {
        const [value, ok] = getString(valueJSON);
        if (ok) {
          result.jsxSettings.jsxFactory = parseMemberExpressionForJSX(log, source, tracker, valueJSON.loc, value);
        }
      }
    }

    // Parse "jsxFragmentFactory"
    {
      const [valueJSON, , ok] = getProperty(compilerOptionsJSON, "jsxFragmentFactory");
      if (ok) {
        const [value, ok] = getString(valueJSON);
        if (ok) {
          result.jsxSettings.jsxFragmentFactory = parseMemberExpressionForJSX(log, source, tracker, valueJSON.loc, value);
        }
      }
    }

    // Parse "jsxImportSource"
    {
      const [valueJSON, , ok] = getProperty(compilerOptionsJSON, "jsxImportSource");
      if (ok) {
        const [value, ok] = getString(valueJSON);
        if (ok) {
          // (This ends up in an import path. Go would carry lone surrogates
          // along as WTF-8; not worth replicating.)
          if (!value.isWellFormed()) bail();
          result.jsxSettings.jsxImportSource = value;
        }
      }
    }

    // Parse "experimentalDecorators"
    {
      const [valueJSON, , ok] = getProperty(compilerOptionsJSON, "experimentalDecorators");
      if (ok) {
        const [value, ok] = getBool(valueJSON);
        if (ok) {
          if (value) {
            result.settings.experimentalDecorators = True;
          } else {
            result.settings.experimentalDecorators = False;
          }
        }
      }
    }

    // Parse "useDefineForClassFields"
    {
      const [valueJSON, , ok] = getProperty(compilerOptionsJSON, "useDefineForClassFields");
      if (ok) {
        const [value, ok] = getBool(valueJSON);
        if (ok) {
          if (value) {
            result.settings.useDefineForClassFields = True;
          } else {
            result.settings.useDefineForClassFields = False;
          }
        }
      }
    }

    // Parse "target"
    {
      const [valueJSON, keyLoc, ok] = getProperty(compilerOptionsJSON, "target");
      if (ok) {
        const [value, ok] = getString(valueJSON);
        if (ok) {
          const lowerValue = goStringsToLower(value);
          let ok = true;

          // See https://www.typescriptlang.org/tsconfig#target
          switch (lowerValue) {
            case "es3":
            case "es5":
            case "es6":
            case "es2015":
            case "es2016":
            case "es2017":
            case "es2018":
            case "es2019":
            case "es2020":
            case "es2021":
              result.settings.target = TSTargetBelowES2022;
              break;
            case "es2022":
            case "es2023":
            case "es2024":
            case "es2025":
            case "esnext":
              result.settings.target = TSTargetAtOrAboveES2022;
              break;
            default:
              ok = false;
              if (!isInsideNodeModules(source.keyPath.text)) {
                log.addID(MsgID_TSConfigJSON_InvalidTarget, Warning, tracker, source.rangeOfString(valueJSON.loc), "Unrecognized target environment");
              }
          }

          if (ok) {
            result.tsTargetKey = new tsTargetKey(lowerValue, source, source.rangeOfString(keyLoc));
          }
        }
      }
    }

    // Parse "strict"
    {
      const [valueJSON, keyLoc, ok] = getProperty(compilerOptionsJSON, "strict");
      if (ok) {
        const [value, ok] = getBool(valueJSON);
        if (ok) {
          const valueRange = rangeOfIdentifier(source, valueJSON.loc);
          result.tsStrict = new TSAlwaysStrict("strict", source, new Range(keyLoc, valueRange.loc + valueRange.len - keyLoc), value);
        }
      }
    }

    // Parse "alwaysStrict"
    {
      const [valueJSON, keyLoc, ok] = getProperty(compilerOptionsJSON, "alwaysStrict");
      if (ok) {
        const [value, ok] = getBool(valueJSON);
        if (ok) {
          const valueRange = rangeOfIdentifier(source, valueJSON.loc);
          result.tsAlwaysStrict = new TSAlwaysStrict("alwaysStrict", source, new Range(keyLoc, valueRange.loc + valueRange.len - keyLoc), value);
        }
      }
    }

    // Parse "importsNotUsedAsValues"
    {
      const [valueJSON, , ok] = getProperty(compilerOptionsJSON, "importsNotUsedAsValues");
      if (ok) {
        const [value, ok] = getString(valueJSON);
        if (ok) {
          switch (value) {
            case "remove":
              result.settings.importsNotUsedAsValues = TSImportsNotUsedAsValues_Remove;
              break;
            case "preserve":
              result.settings.importsNotUsedAsValues = TSImportsNotUsedAsValues_Preserve;
              break;
            case "error":
              result.settings.importsNotUsedAsValues = TSImportsNotUsedAsValues_Error;
              break;
            default:
              log.addID(MsgID_TSConfigJSON_InvalidImportsNotUsedAsValues, Warning, tracker, source.rangeOfString(valueJSON.loc), "Invalid value");
          }
        }
      }
    }

    // Parse "preserveValueImports"
    {
      const [valueJSON, , ok] = getProperty(compilerOptionsJSON, "preserveValueImports");
      if (ok) {
        const [value, ok] = getBool(valueJSON);
        if (ok) {
          if (value) {
            result.settings.preserveValueImports = True;
          } else {
            result.settings.preserveValueImports = False;
          }
        }
      }
    }

    // Parse "verbatimModuleSyntax"
    {
      const [valueJSON, , ok] = getProperty(compilerOptionsJSON, "verbatimModuleSyntax");
      if (ok) {
        const [value, ok] = getBool(valueJSON);
        if (ok) {
          if (value) {
            result.settings.verbatimModuleSyntax = True;
          } else {
            result.settings.verbatimModuleSyntax = False;
          }
        }
      }
    }

    // Parse "paths"
    {
      const [valueJSON, , ok] = getProperty(compilerOptionsJSON, "paths");
      if (ok) {
        if (valueJSON.data instanceof EObject) {
          const paths = valueJSON.data;
          result.baseURLForPaths = fileDir;
          result.paths = new TSConfigPaths(new Map(), source);
          for (let $i112 = 0, $a112 = paths.properties; $i112 < $a112.length; $i112++) {
            const prop = $a112[$i112];
            const [key, ok] = getString(prop.key);
            if (ok) {
              if (!isValidTSConfigPathPattern(key, log, source, tracker, prop.key.loc)) {
                continue;
              }

              // The "paths" field is an object which maps a pattern to an
              // array of remapping patterns to try, in priority order. See
              // the documentation for examples of how this is used:
              // https://www.typescriptlang.org/docs/handbook/module-resolution.html#path-mapping.
              if (prop.valueOrNil.data instanceof EArray) {
                for (let $i113 = 0, $a113 = prop.valueOrNil.data.items; $i113 < $a113.length; $i113++) {
                  const item = $a113[$i113];
                  let [str, ok] = getString(item);
                  if (ok) {
                    if (isValidTSConfigPathPattern(str, log, source, tracker, item.loc)) {
                      str = getSubstitutedPathWithConfigDirTemplate(str, configDir);
                      let list = result.paths.map.get(key);
                      if (list === undefined) result.paths.map.set(key, (list = []));
                      list.push(new TSConfigPath(str, item.loc));
                    }
                  }
                }
              } else {
                log.addID(MsgID_TSConfigJSON_InvalidPaths, Warning, tracker, source.rangeOfString(prop.valueOrNil.loc), "Substitutions should be an array");
              }
            }
          }
        }
      }
    }
  }

  // Warn about compiler options not wrapped in "compilerOptions".
  // For example: https://github.com/evanw/esbuild/issues/3301
  if (json.data instanceof EObject) {
    loop: for (let $i114 = 0, $a114 = json.data.properties; $i114 < $a114.length; $i114++) {
      const prop = $a114[$i114];
      const keyData = prop.key.data;
      if (keyData instanceof EString) {
        const key = keyData.value; // helpers.UTF16ToString
        switch (key) {
          case "alwaysStrict":
          case "baseUrl":
          case "experimentalDecorators":
          case "importsNotUsedAsValues":
          case "jsx":
          case "jsxFactory":
          case "jsxFragmentFactory":
          case "jsxImportSource":
          case "paths":
          case "preserveValueImports":
          case "strict":
          case "target":
          case "useDefineForClassFields":
          case "verbatimModuleSyntax":
            log.addIDWithNotes(MsgID_TSConfigJSON_InvalidTopLevelOption, Warning, tracker, source.rangeOfString(prop.key.loc), "Expected the option to be nested inside a \"compilerOptions\" object", []);
            break loop;
        }
      }
    }
  }

  return result;
}

// See: https://github.com/microsoft/TypeScript/pull/58042
function getSubstitutedPathWithConfigDirTemplate(value, basePath) {
  if (value.startsWith("${configDir}")) {
    return mockJoin(basePath, "./" + value.slice(12));
  }
  return value;
}

function parseMemberExpressionForJSX(log, source, tracker, loc, text) {
  if (text === "") {
    return null;
  }
  const parts = text.split(".");
  for (const part of parts) {
    if (!isIdentifier(part)) {
      const warnRange = source.rangeOfString(loc);
      log.addID(MsgID_TSConfigJSON_InvalidJSX, Warning, tracker, warnRange, "Invalid JSX member expression");
      return null;
    }
  }
  return parts;
}

function isValidTSConfigPathPattern(text, log, source, tracker, loc) {
  let foundAsterisk = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 42) {
      // '*'
      if (foundAsterisk) {
        const r = source.rangeOfString(loc);
        log.addID(MsgID_TSConfigJSON_InvalidPaths, Warning, tracker, r, "Invalid pattern, must have at most one \"*\" character");
        return false;
      }
      foundAsterisk = true;
    }
  }
  return true;
}

function isSlash(c) {
  return c === 47 || c === 92; // '/' or '\\'
}

// (Only the first three characters and the length are inspected. The
// comparisons are all against ASCII characters, so UTF-16 code units give the
// same results as Go's bytes.)
function isValidTSConfigPathNoBaseURLPattern(text, log, source, tracker, loc) {
  let c0 = 0;
  let c1 = 0;
  let c2 = 0;
  const n = text.length;

  if (n > 0) {
    c0 = text.charCodeAt(0);
    if (n > 1) {
      c1 = text.charCodeAt(1);
      if (n > 2) {
        c2 = text.charCodeAt(2);
      }
    }
  }

  // Relative "." or ".."
  if (c0 === 46 && (n === 1 || (n === 2 && c1 === 46))) {
    return true;
  }

  // Relative "./" or "../" or ".\\" or "..\\"
  if (c0 === 46 && (isSlash(c1) || (c1 === 46 && isSlash(c2)))) {
    return true;
  }

  // Absolute POSIX "/" or UNC "\\"
  if (isSlash(c0)) {
    return true;
  }

  // Absolute DOS "c:/" or "c:\\"
  if (((c0 >= 97 && c0 <= 122) || (c0 >= 65 && c0 <= 90)) && c1 === 58 && isSlash(c2)) {
    return true;
  }

  const r = source.rangeOfString(loc);
  log.addID(MsgID_TSConfigJSON_InvalidPaths, Warning, tracker, r, "Non-relative path is not allowed when \"baseUrl\" is not set");
  return false;
}

// ---------------------------------------------------------------------------
// resolver.go

// resolverQuery.parseTSConfigFromSource with visited == nil (a "transform"
// API call). Returns the TSConfigJSON or null (Go: errParseErrorAlreadyLogged).
function parseTSConfigFromSource(log, source, configDir) {
  const fileDir = mockDir(source.keyPath.text);
  const isExtends = false; // len(visited) > 1

  const result = parseTSConfigJSON(log, source, fileDir, configDir, (extends_, extendsRange) => {
    // If this is nil, then we're in a "transform" API call. In that case we
    // deliberately skip processing "extends" fields. This is because the
    // "transform" API is supposed to be without a file system.
    return null;
  });

  if (result === null) {
    return null;
  }

  // Now that we have parsed the entire "tsconfig.json" file, filter out any
  // paths that are invalid due to being a package-style path without a base
  // URL specified. This must be done here instead of when we're parsing the
  // original file because TypeScript allows one "tsconfig.json" file to
  // specify "baseUrl" and inherit a "paths" from another file via "extends".
  // (Go iterates over a map here; the order doesn't matter since any warning
  // bails.)
  if (!isExtends && result.paths !== null && result.baseURL === null) {
    for (const [key, paths] of result.paths.map) {
      let end = 0;
      for (const path of paths) {
        if (isValidTSConfigPathNoBaseURLPattern(path.text, log, result.paths.source, null, path.loc)) {
          paths[end] = path;
          end++;
        }
      }
      if (end < paths.length) {
        result.paths.map.set(key, paths.slice(0, end));
      }
    }
  }

  return result;
}

// Parsed raw tsconfigs. Parsing is deterministic and a successful parse logs
// nothing (any error or warning bails), so results are shared between
// transforms with the same "tsconfigRaw". They are never mutated.
const parsedRawCache = new Map();

function parseTSConfigRaw(log, contents) {
  let result = parsedRawCache.get(contents);
  if (result === undefined) {
    const cwd = "/"; // fs.Cwd() of the transform's mock file system
    const source = new Source(
      new PrettyPaths("<tsconfig.json>", "<tsconfig.json>"),
      "",
      contents,
      new Path(mockJoin(cwd, "<tsconfig.json>"), "file"),
    );
    result = parseTSConfigFromSource(log, source, cwd);

    // A failed parse always comes with a logged error in Go ("Cannot read
    // file" is only for real files), which bails
    if (result === null) bail();

    if (parsedRawCache.size >= 16) parsedRawCache.clear();
    parsedRawCache.set(contents, result);
  }
  return result;
}

// The "tsconfig.json" override of resolver.NewResolver for a transform
// (config.TransformCall: "TSConfigPath" is never set, only "TSConfigRaw").
// Mutates "options" like Go does; "options" must be a private copy (the
// "jsx" and "ts" sub-objects are replaced, not mutated, since they may be
// shared with other copies).
export function applyTSConfigOverride(log, options) {
  if (options.tsConfigRaw === "") return;
  const tsConfigOverride = parseTSConfigRaw(log, options.tsConfigRaw);

  // Mutate the provided options by settings from "tsconfig.json" if present
  const s = tsConfigOverride.settings;
  options.ts = new TSOptions(
    new TSConfig(s.experimentalDecorators, s.importsNotUsedAsValues, s.preserveValueImports, s.target, s.useDefineForClassFields, s.verbatimModuleSyntax),
    options.ts.parse,
    options.ts.noAmbiguousLessThan,
  );
  const jsx = options.jsx.clone();
  tsConfigOverride.jsxSettings.applyTo(jsx);
  options.jsx = jsx;
  options.tsAlwaysStrict = tsConfigOverride.tsAlwaysStrictOrStrict();
}
