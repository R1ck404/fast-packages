// Port of internal/resolver/package_json.go.
//
// The "resolverQuery" methods defined in package_json.go are installed onto
// the Resolver class of resolver.mjs by installPackageJSONMethods() (a
// hoisted function declaration, so the circular import between the two
// modules works in either evaluation order).
//
// Debug log notes (r.debugLogs) are built like Go builds them (see
// resolver.mjs).
import { goQuote } from "./gostd.mjs";
import {
  Source,
  Path,
  Range,
  LineColumnTracker,
  Warning,
  Debug,
  MsgID_PackageJSON_InvalidType,
  MsgID_PackageJSON_InvalidBrowser,
  MsgID_PackageJSON_InvalidSideEffects,
  MsgID_PackageJSON_InvalidImportsOrExports,
  MsgID_PackageJSON_DeadCondition,
  RANGE_ZERO,
  MsgData,
  goStringLess,
} from "./logger.mjs";
import { isInsideNodeModules, utf8Len } from "./helpers.mjs";
import { PlatformBrowser } from "./config.mjs";
import { ModuleTypeData, ModuleCommonJS_PackageJSON, ModuleESM_PackageJSON, EObject, EArray, EString, EBoolean, ENumber, ENull } from "./js_ast.mjs";
import { rangeOfIdentifier } from "./js_lexer.mjs";
import { JSONOptions } from "./json_parser.mjs";
import { decodeUTF8 } from "./fs.mjs";
import { urlPathUnescapeBytes } from "./dataurl.mjs";
import {
  SideEffectsData,
  makePrettyPaths,
  isPackagePath,
  defaultMainFields,
  mainFieldsForFailure,
  getProperty,
  getString,
  getBool,
  NO_MODULE_TYPE_DATA,
} from "./resolver.mjs";

export class packageJSON {
  declare name: string;
  declare mainFields: Map<string, mainField>;
  declare moduleTypeData: ModuleTypeData;

  // "TypeScript will first check whether package.json contains a "tsconfig"
  // field, and if it does, TypeScript will try to load a configuration file
  // from that field. If neither exists, TypeScript will try to read from a
  // tsconfig.json at the root."
  declare tsconfig: string;

  // Present if the "browser" field is present. This field is intended to be
  // used by bundlers and lets you redirect the paths of certain 3rd-party
  // modules that don't work in the browser to other modules that shim that
  // functionality. Mapping to a null path indicates that the module is
  // disabled.
  //
  // Note that the non-package "browser" map has to be checked twice to match
  // Webpack's behavior: once before resolution and once after resolution. It
  // leads to some unintuitive failure cases that we must emulate around missing
  // file extensions:
  //
  // * Given the mapping "./no-ext": "./no-ext-browser.js" the query "./no-ext"
  //   should match but the query "./no-ext.js" should NOT match.
  //
  // * Given the mapping "./ext.js": "./ext-browser.js" the query "./ext.js"
  //   should match and the query "./ext" should ALSO match.
  //
  declare browserMap: Map<string, string | null> | null;

  // If this is non-null, each entry in this set is the absolute path of a file
  // with side effects. Any entry not in this set should be considered to have
  // no side effects, which means import statements for these files can be
  // removed if none of the imports are used. This is a convention from Webpack:
  // https://webpack.js.org/guides/tree-shaking/.
  declare sideEffectsMap: Set<string> | null;
  declare sideEffectsRegexps: RegExp[] | null;
  declare sideEffectsData: SideEffectsData | null;

  // This represents the "imports" field in this package.json file.
  declare importsMap: pjMap | null;

  // This represents the "exports" field in this package.json file.
  declare exportsMap: pjMap | null;

  declare source: Source;

  constructor(source: Source) {
    this.name = "";
    this.mainFields = new Map();
    this.moduleTypeData = NO_MODULE_TYPE_DATA;
    this.tsconfig = "";
    this.browserMap = null;
    this.sideEffectsMap = null;
    this.sideEffectsRegexps = null;
    this.sideEffectsData = null;
    this.importsMap = null;
    this.exportsMap = null;
    this.source = source;
  }
}

export class mainField {
  declare relPath: string;
  declare keyLoc: number;
  constructor(relPath = "", keyLoc = 0) {
    this.relPath = relPath;
    this.keyLoc = keyLoc;
  }
}

// browserPathKind
export const absolutePathKind = 0;
export const packagePathKind = 1;

// implicitExtensions (checkBrowserMap)
const includeImplicitExtensions = 0;
const skipImplicitExtensions = 1;

// Go's path.Clean
export function goPathClean(p: string): string {
  if (p === "") return ".";
  const rooted = p.charCodeAt(0) === 47; // '/'
  const out: string[] = [];
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

// Go's path.Join(a, b)
export function goPathJoin(a: string, b: string): string {
  if (a === "") return b === "" ? "" : goPathClean(b);
  if (b === "") return goPathClean(a);
  return goPathClean(a + "/" + b);
}

// Reference: https://github.com/fitzgen/glob-to-regexp/blob/2abf65a834259c6504ed3b80e85f893f8cd99127/index.js
// Returns [regexp source, hadWildcard]. (Go builds an RE2 pattern; the
// pattern below means the same thing to a JavaScript RegExp with the "u"
// flag.)
export function globstarToEscapedRegexp(glob: string): [string, boolean] {
  let sb = "^";
  let hadWildcard = false;
  const n = glob.length;

  for (let i = 0; i < n; i++) {
    const c = glob.charCodeAt(i);
    switch (c) {
      case 92: // '\\'
      case 94: // '^'
      case 36: // '$'
      case 46: // '.'
      case 43: // '+'
      case 124: // '|'
      case 40: // '('
      case 41: // ')'
      case 91: // '['
      case 93: // ']'
      case 123: // '{'
      case 125: // '}'
        sb += "\\" + glob[i];
        break;

      case 63: // '?'
        sb += ".";
        hadWildcard = true;
        break;

      case 42: {
        // '*'
        // Move over all consecutive "*"'s.
        // Also store the previous and next characters
        let prevChar = -1;
        if (i > 0) prevChar = glob.charCodeAt(i - 1);
        let starCount = 1;
        while (i + 1 < n && glob.charCodeAt(i + 1) === 42) {
          starCount++;
          i++;
        }
        let nextChar = -1;
        if (i + 1 < n) nextChar = glob.charCodeAt(i + 1);

        // Determine if this is a globstar segment
        const isGlobstar =
          starCount > 1 && // multiple "*"'s
          (prevChar === 47 || prevChar === -1) && // from the start of the segment
          (nextChar === 47 || nextChar === -1); // to the end of the segment

        if (isGlobstar) {
          // It's a globstar, so match zero or more path segments
          sb += "(?:[^/]*(?:/|$))*";
          i++; // Move over the "/"
        } else {
          // It's not a globstar, so only match one path segment
          sb += "[^/]*";
        }

        hadWildcard = true;
        break;
      }

      default:
        sb += glob[i];
    }
  }

  sb += "$";
  return [sb, hadWildcard];
}

// Reference: https://nodejs.org/api/esm.html#esm_resolver_algorithm_specification
export class pjMap {
  declare root: pjEntry;
  declare propertyKey: string;
  declare propertyKeyLoc: number;
  constructor(root: pjEntry, propertyKey: string, propertyKeyLoc: number) {
    this.root = root;
    this.propertyKey = propertyKey;
    this.propertyKeyLoc = propertyKeyLoc;
  }
}

// pjKind
export const pjNull = 0;
export const pjString = 1;
export const pjArray = 2;
export const pjObject = 3;
export const pjInvalid = 4;

export class pjEntry {
  declare strData: string;
  declare arrData: pjEntry[] | null;
  declare mapData: pjMapEntry[] | null; // Can't be a "map" because order matters
  declare expansionKeys: pjMapEntry[] | null;
  declare firstToken: Range;
  declare kind: number;
  constructor(kind: number, firstToken: Range, strData = "", arrData: pjEntry[] | null = null, mapData: pjMapEntry[] | null = null, expansionKeys: pjMapEntry[] | null = null) {
    this.strData = strData;
    this.arrData = arrData;
    this.mapData = mapData;
    this.expansionKeys = expansionKeys;
    this.firstToken = firstToken;
    this.kind = kind;
  }

  valueForKey(key: string): pjEntry | null {
    const mapData = this.mapData;
    if (mapData !== null) {
      for (let i = 0; i < mapData.length; i++) {
        if (mapData[i].key === key) return mapData[i].value;
      }
    }
    return null;
  }

  keysStartWithDot(): boolean {
    return this.mapData !== null && this.mapData.length > 0 && this.mapData[0].key.startsWith(".");
  }
}

export class pjMapEntry {
  declare key: string;
  declare value: pjEntry;
  declare keyRange: Range;
  constructor(key: string, value: pjEntry, keyRange: Range) {
    this.key = key;
    this.value = value;
    this.keyRange = keyRange;
  }
}

// expansionKeysArray.Less (PATTERN_KEY_COMPARE). Go compares byte lengths and
// byte indices.
function expansionKeysLess(a: pjMapEntry, b: pjMapEntry): boolean {
  // Assert: keyA ends with "/" or contains only a single "*".
  // Assert: keyB ends with "/" or contains only a single "*".
  const keyA = a.key;
  const keyB = b.key;

  // Let baseLengthA be the index of "*" in keyA plus one, if keyA contains "*", or the length of keyA otherwise.
  // Let baseLengthB be the index of "*" in keyB plus one, if keyB contains "*", or the length of keyB otherwise.
  const starA = keyA.indexOf("*");
  const starB = keyB.indexOf("*");
  const baseLengthA = starA >= 0 ? utf8Len(keyA.slice(0, starA)) : utf8Len(keyA);
  const baseLengthB = starB >= 0 ? utf8Len(keyB.slice(0, starB)) : utf8Len(keyB);

  // If baseLengthA is greater than baseLengthB, return -1.
  // If baseLengthB is greater than baseLengthA, return 1.
  if (baseLengthA > baseLengthB) return true;
  if (baseLengthB > baseLengthA) return false;

  // If keyA does not contain "*", return 1.
  // If keyB does not contain "*", return -1.
  if (starA < 0) return false;
  if (starB < 0) return true;

  // If the length of keyA is greater than the length of keyB, return -1.
  // If the length of keyB is greater than the length of keyA, return 1.
  const lenA = utf8Len(keyA);
  const lenB = utf8Len(keyB);
  if (lenA > lenB) return true;
  if (lenB > lenA) return false;

  return false;
}

// sort.Stable(expansionKeys) (JavaScript's sort is stable)
function sortExpansionKeys(keys: pjMapEntry[]) {
  if (keys.length > 1) keys.sort((a, b) => (expansionKeysLess(a, b) ? -1 : expansionKeysLess(b, a) ? 1 : 0));
}


export function parseImportsExportsMap(source: Source, log: any, json: any, propertyKey: string, propertyKeyLoc: number): pjMap | null {
  const tracker = new LineColumnTracker(source);

  const visit = (expr: any): pjEntry => {
    let firstToken = new Range(0, 0);
    const data = expr.data;

    if (data instanceof ENull) {
      return new pjEntry(pjNull, rangeOfIdentifier(source, expr.loc));
    }

    if (data instanceof EString) {
      return new pjEntry(pjString, source.rangeOfString(expr.loc), data.value);
    }

    if (data instanceof EArray) {
      const items = data.items;
      const arrData: pjEntry[] = new Array(items.length);
      for (let i = 0; i < items.length; i++) arrData[i] = visit(items[i]);
      return new pjEntry(pjArray, new Range(expr.loc, 1), "", arrData);
    }

    if (data instanceof EObject) {
      const properties = data.properties;
      const mapData: pjMapEntry[] = new Array(properties.length);
      const expansionKeys: pjMapEntry[] = [];
      firstToken = new Range(expr.loc, 1);
      let isConditionalSugar = false;

      let foundDefault = new Range(0, 0);
      let foundImport = new Range(0, 0);
      let foundRequire = new Range(0, 0);
      let deadConditionReason = "";
      let deadConditionRanges: Range[] | null = null;
      let deadConditionNotes: MsgData[] | null = null;

      for (let i = 0; i < properties.length; i++) {
        const property = properties[i];
        const key = property.key.data.value;
        const keyRange = source.rangeOfString(property.key.loc);

        // If exports is an Object with both a key starting with "." and a key
        // not starting with ".", throw an Invalid Package Configuration error.
        const curIsConditionalSugar = !key.startsWith(".");
        if (i === 0) {
          isConditionalSugar = curIsConditionalSugar;
        } else if (isConditionalSugar !== curIsConditionalSugar) {
          const prevEntry = mapData[i - 1];
          log.addIDWithNotes(
            MsgID_PackageJSON_InvalidImportsOrExports,
            Warning,
            tracker,
            keyRange,
            "This object cannot contain keys that both start with \".\" and don't start with \".\"",
            [tracker.msgData(prevEntry.keyRange, "The key " + goQuote(key) + " is incompatible with the previous key " + goQuote(prevEntry.key) + ":")],
          );
          return new pjEntry(pjInvalid, firstToken);
        }

        // Track "dead" conditional branches that can never be reached
        if (foundDefault.len !== 0 || (foundImport.len !== 0 && foundRequire.len !== 0)) {
          if (deadConditionRanges === null) deadConditionRanges = [];
          deadConditionRanges.push(keyRange);
          // Note: Don't warn about the "default" condition as it's supposed to be a catch-all condition
          if (deadConditionReason === "" && key !== "default") {
            if (foundDefault.len !== 0) {
              deadConditionReason = "\"default\"";
              deadConditionNotes = [tracker.msgData(foundDefault, 'The "default" condition comes earlier and will always be chosen:')];
            } else {
              deadConditionReason = "both \"import\" and \"require\"";
              deadConditionNotes = [
                tracker.msgData(foundImport, 'The "import" condition comes earlier and will be used for all "import" statements:'),
                tracker.msgData(foundRequire, 'The "require" condition comes earlier and will be used for all "require" calls:'),
              ];
            }
          }
        } else {
          switch (key) {
            case "default":
              foundDefault = keyRange;
              break;
            case "import":
              foundImport = keyRange;
              break;
            case "require":
              foundRequire = keyRange;
              break;
          }
        }

        const entry = new pjMapEntry(key, visit(property.valueOrNil), keyRange);

        if (key.endsWith("/") || key.indexOf("*") >= 0) {
          expansionKeys.push(entry);
        }

        mapData[i] = entry;
      }

      // Let expansionKeys be the list of keys of matchObj either ending in "/"
      // or containing only a single "*", sorted by the sorting function
      // PATTERN_KEY_COMPARE which orders in descending order of specificity.
      sortExpansionKeys(expansionKeys);

      // Warn about "dead" conditional branches that can never be reached
      if (deadConditionReason !== "") {
        let kind = Warning;
        if (isInsideNodeModules(source.keyPath.text)) {
          kind = Debug;
        }
        const ranges = deadConditionRanges as Range[];
        let conditions = "";
        let conditionWord = "condition";
        let itComesWord = "it comes";
        if (ranges.length > 1) {
          conditionWord = "conditions";
          itComesWord = "they come";
        }
        for (let i = 0; i < ranges.length; i++) {
          if (i > 0) {
            conditions += " and ";
          }
          conditions += source.textForRange(ranges[i]);
        }
        log.addIDWithNotes(
          MsgID_PackageJSON_DeadCondition,
          kind,
          tracker,
          ranges[0],
          "The " + conditionWord + " " + conditions + " here will never be used as " + itComesWord + " after " + deadConditionReason,
          deadConditionNotes,
        );
      }

      return new pjEntry(pjObject, firstToken, "", null, mapData, expansionKeys);
    }

    if (data instanceof EBoolean) {
      firstToken = rangeOfIdentifier(source, expr.loc);
    } else if (data instanceof ENumber) {
      firstToken = source.rangeOfNumber(expr.loc);
    } else {
      firstToken = new Range(expr.loc, 0);
    }

    log.addID(MsgID_PackageJSON_InvalidImportsOrExports, Warning, tracker, firstToken, "This value must be a string, an object, an array, or null");
    return new pjEntry(pjInvalid, firstToken);
  };

  const root = visit(json);

  if (root.kind === pjNull) {
    return null;
  }

  return new pjMap(root, propertyKey, propertyKeyLoc);
}

// pjStatus
export const pjStatusUndefined = 0;
export const pjStatusUndefinedNoConditionsMatch = 1; // A more friendly error message for when no conditions are matched
export const pjStatusNull = 2;
export const pjStatusExact = 3;
export const pjStatusExactEndsWithStar = 4;
export const pjStatusInexact = 5; // This means we may need to try CommonJS-style extension suffixes
export const pjStatusPackageResolve = 6; // Need to re-run package resolution on the result

// Module specifier is an invalid URL, package name or package subpath specifier.
export const pjStatusInvalidModuleSpecifier = 7;

// package.json configuration is invalid or contains an invalid configuration.
export const pjStatusInvalidPackageConfiguration = 8;

// Package exports or imports define a target module for the package that is an invalid type or string target.
export const pjStatusInvalidPackageTarget = 9;

// Package exports do not define or permit a target subpath in the package for the given module.
export const pjStatusPackagePathNotExported = 10;

// Package imports do not define the specifiespecifier
export const pjStatusPackageImportNotDefined = 11;

// The package or module requested does not exist.
export const pjStatusModuleNotFound = 12;
export const pjStatusModuleNotFoundMissingExtension = 13; // The user just needs to add the missing extension

// The resolved path corresponds to a directory, which is not a supported target for module imports.
export const pjStatusUnsupportedDirectoryImport = 14;
export const pjStatusUnsupportedDirectoryImportMissingIndex = 15; // The user just needs to add the missing "/index.js" suffix

export function pjStatusIsUndefined(status: number): boolean {
  return status === pjStatusUndefined || status === pjStatusUndefinedNoConditionsMatch;
}

export class pjDebug {
  // If the status is "pjStatusInvalidPackageTarget" or "pjStatusInvalidModuleSpecifier",
  // then this is the reason. It always starts with " because".
  declare invalidBecause: string;

  // If the status is "pjStatusUndefinedNoConditionsMatch", this is the set of
  // conditions that didn't match, in the order that they were found in the file.
  // This information is used for error messages.
  declare unmatchedConditions: pjMapEntry[] | null;

  // This is the range of the token to use for error messages
  declare token: Range;

  // If true, the token is a "null" literal
  declare isBecauseOfNullLiteral: boolean;

  constructor(token: Range, invalidBecause = "", unmatchedConditions: pjMapEntry[] | null = null, isBecauseOfNullLiteral = false) {
    this.invalidBecause = invalidBecause;
    this.unmatchedConditions = unmatchedConditions;
    this.token = token;
    this.isBecauseOfNullLiteral = isBecauseOfNullLiteral;
  }
}

// (resolved, status, debug) triples
export type pjResult = [string, number, pjDebug];

// If path split on "/" or "\" contains any ".", ".." or "node_modules"
// segments after the first segment, throw an Invalid Package Target error.
export function findInvalidSegment(path: string): string {
  let slash = indexAnySlash(path, 0);
  if (slash === -1) return "";
  let start = slash + 1;
  while (start < path.length) {
    slash = indexAnySlash(path, start);
    const end = slash !== -1 ? slash : path.length;
    const len = end - start;
    if (
      (len === 1 && path.charCodeAt(start) === 46) ||
      (len === 2 && path.charCodeAt(start) === 46 && path.charCodeAt(start + 1) === 46) ||
      (len === 12 && path.startsWith("node_modules", start))
    ) {
      return path.slice(start, end);
    }
    if (slash === -1) break;
    start = slash + 1;
  }
  return "";
}

function indexAnySlash(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 47 || c === 92) return i;
  }
  return -1;
}

// Returns [packageName, packageSubpath, ok]
export function esmParsePackageName(packageSpecifier: string): [string, string, boolean] {
  if (packageSpecifier === "") return ["", "", false];

  let packageName: string;
  const slash = packageSpecifier.indexOf("/");
  if (!packageSpecifier.startsWith("@")) {
    packageName = slash === -1 ? packageSpecifier : packageSpecifier.slice(0, slash);
  } else {
    if (slash === -1) return ["", "", false];
    let slash2 = packageSpecifier.indexOf("/", slash + 1);
    if (slash2 === -1) slash2 = packageSpecifier.length;
    packageName = packageSpecifier.slice(0, slash2);
  }

  if (packageName.startsWith(".") || packageName.indexOf("\\") !== -1 || packageName.indexOf("%") !== -1) {
    return [packageName, "", false];
  }

  return [packageName, "." + packageSpecifier.slice(packageName.length), true];
}

// url.PathUnescape returning a string, or null on an invalid escape (see
// urlPathUnescapeBytes for the error)
function urlPathUnescape(s: string): string | null {
  if (s.indexOf("%") === -1) return s;
  const $b = urlPathUnescapeBytes(s);
  if ($b[0] === null) return null;
  return decodeUTF8($b[0]);
}

// ---------------------------------------------------------------------------
// The resolverQuery methods of package_json.go

// esmReverseKind
const esmReverseExact = 0;
const esmReversePattern = 1;
const esmReversePrefix = 2;

export function installPackageJSONMethods(proto: any) {
  Object.assign(proto, {
    // Returns [ok, subpath, token]
    esmPackageExportsReverseResolve(query: string, root: pjEntry, conditions: Set<string>): [boolean, string, Range] {
      if (root.kind === pjObject && root.keysStartWithDot()) {
        const $r = this.esmPackageImportsExportsReverseResolve(query, root, conditions);
        if ($r[0]) {
          return $r;
        }
      }
      return [false, "", RANGE_ZERO];
    },

    esmPackageImportsExportsReverseResolve(query: string, matchObj: pjEntry, conditions: Set<string>): [boolean, string, Range] {
      if (!query.endsWith("*")) {
        if (matchObj.mapData !== null) {
          for (const entry of matchObj.mapData) {
            const $r = this.esmPackageTargetReverseResolve(query, entry.key, entry.value, esmReverseExact, conditions);
            if ($r[0]) {
              return $r;
            }
          }
        }
      }

      if (matchObj.expansionKeys !== null) {
        for (const expansion of matchObj.expansionKeys) {
          if (expansion.key.endsWith("*")) {
            const $r = this.esmPackageTargetReverseResolve(query, expansion.key, expansion.value, esmReversePattern, conditions);
            if ($r[0]) {
              return $r;
            }
          }

          const $r = this.esmPackageTargetReverseResolve(query, expansion.key, expansion.value, esmReversePrefix, conditions);
          if ($r[0]) {
            return $r;
          }
        }
      }

      return [false, "", RANGE_ZERO];
    },

    esmPackageTargetReverseResolve(query: string, key: string, target: pjEntry, kind: number, conditions: Set<string>): [boolean, string, Range] {
      switch (target.kind) {
        case pjString:
          switch (kind) {
            case esmReverseExact:
              if (query === target.strData) {
                return [true, key, target.firstToken];
              }
              break;

            case esmReversePrefix:
              if (query.startsWith(target.strData)) {
                return [true, key + query.slice(target.strData.length), target.firstToken];
              }
              break;

            case esmReversePattern: {
              const star = target.strData.indexOf("*");
              const keyWithoutTrailingStar = key.endsWith("*") ? key.slice(0, -1) : key;

              // Handle the case of no "*"
              if (star === -1) {
                if (query === target.strData) {
                  return [true, keyWithoutTrailingStar, target.firstToken];
                }
                break;
              }

              // Only support tracing through a single "*"
              const prefix = target.strData.slice(0, star);
              const suffix = target.strData.slice(star + 1);
              if (!suffix.includes("*") && query.startsWith(prefix)) {
                const afterPrefix = query.slice(prefix.length);
                if (afterPrefix.endsWith(suffix)) {
                  const starData = afterPrefix.slice(0, afterPrefix.length - suffix.length);
                  return [true, keyWithoutTrailingStar + starData, target.firstToken];
                }
              }
              break;
            }
          }
          break;

        case pjObject:
          if (target.mapData !== null) {
            for (const p of target.mapData) {
              if (p.key === "default" || conditions.has(p.key)) {
                const $r = this.esmPackageTargetReverseResolve(query, key, p.value, kind, conditions);
                if ($r[0]) {
                  return $r;
                }
              }
            }
          }
          break;

        case pjArray:
          if (target.arrData !== null) {
            for (const targetValue of target.arrData) {
              const $r = this.esmPackageTargetReverseResolve(query, key, targetValue, kind, conditions);
              if ($r[0]) {
                return $r;
              }
            }
          }
          break;
      }

      return [false, "", RANGE_ZERO];
    },

    // Returns undefined if not found (Go: ok == false), null if the path is
    // disabled (Go: remapped == nil), or the remapped path. JS-only: Go's two
    // results are folded into one value.
    checkBrowserMap(resolveDirInfo: any, inputPath: string, kind: number): string | null | undefined {
      const r = this;

      // This only applies if the current platform is "browser"
      if (r.options.platform !== PlatformBrowser) {
        return undefined;
      }

      // There must be an enclosing directory with a "package.json" file with a "browser" map
      if (resolveDirInfo.enclosingBrowserScope === null) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote('No "browser" map found in directory ' + goQuote(resolveDirInfo.absPath));
        }
        return undefined;
      }

      const pkgJSON: packageJSON = resolveDirInfo.enclosingBrowserScope.packageJSON;
      const browserMap = pkgJSON.browserMap as Map<string, string | null>;
      const extensionOrder: string[] = r.options.extensionOrder;

      // (Go's checkPath sets the named results and "inputPath" on a match)
      const checkPath = (pathToCheck: string, implicitExtensions: number): string | null | undefined => {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("Checking for " + goQuote(pathToCheck) + ' in the "browser" map in ' + goQuote(pkgJSON.source.keyPath.text));
        }

        // Check for equality
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("  Checking for " + goQuote(pathToCheck));
        }
        let remapped = browserMap.get(pathToCheck);
        if (remapped !== undefined) {
          inputPath = pathToCheck;
          return remapped;
        }

        // If that failed, try adding implicit extensions
        if (implicitExtensions === includeImplicitExtensions) {
          for (let i = 0; i < extensionOrder.length; i++) {
            const extPath = pathToCheck + extensionOrder[i];
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("  Checking for " + goQuote(extPath));
            }
            remapped = browserMap.get(extPath);
            if (remapped !== undefined) {
              inputPath = extPath;
              return remapped;
            }
          }
        }

        // If that failed, try assuming this is a directory and looking for an "index" file
        let indexPath = goPathJoin(pathToCheck, "index");
        if (isPackagePath(indexPath) && !isPackagePath(pathToCheck)) {
          indexPath = "./" + indexPath;
        }

        // Check for equality
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("  Checking for " + goQuote(indexPath));
        }
        remapped = browserMap.get(indexPath);
        if (remapped !== undefined) {
          inputPath = indexPath;
          return remapped;
        }

        // If that failed, try adding implicit extensions
        if (implicitExtensions === includeImplicitExtensions) {
          for (let i = 0; i < extensionOrder.length; i++) {
            const extPath = indexPath + extensionOrder[i];
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("  Checking for " + goQuote(extPath));
            }
            remapped = browserMap.get(extPath);
            if (remapped !== undefined) {
              inputPath = extPath;
              return remapped;
            }
          }
        }

        return undefined;
      };

      // Turn absolute paths into paths relative to the "browser" map location
      if (kind === absolutePathKind) {
        const rel = r.fs.rel(resolveDirInfo.enclosingBrowserScope.absPath, inputPath);
        if (!rel[1]) {
          return undefined;
        }
        inputPath = rel[0].replaceAll("\\", "/");
      }

      if (inputPath === ".") {
        // No bundler supports remapping ".", so we don't either
        return undefined;
      }

      // First try the import path as a package path
      let result = checkPath(inputPath, includeImplicitExtensions);
      if (result === undefined && isPackagePath(inputPath)) {
        // If a package path didn't work, try the import path as a relative path
        switch (kind) {
          case absolutePathKind:
            result = checkPath("./" + inputPath, includeImplicitExtensions);
            break;

          case packagePathKind: {
            // Browserify allows a browser map entry of "./pkg" to override a package
            // path of "require('pkg')". This is weird, and arguably a bug. But we
            // replicate this bug for compatibility. However, Browserify only allows
            // this within the same package. It does not allow such an entry in a
            // parent package to override this in a child package. So this behavior
            // is disallowed if there is a "node_modules" folder in between the child
            // package and the parent package.
            let isInSamePackage = true;
            for (let info = resolveDirInfo; info !== null && info !== resolveDirInfo.enclosingBrowserScope; info = info.parent) {
              if (info.isNodeModules) {
                isInSamePackage = false;
                break;
              }
            }
            if (isInSamePackage) {
              let relativePathPrefix = "./";

              // Use the relative path from the file containing the import path to the
              // enclosing package.json file. This includes any subdirectories within the
              // package if there are any.
              const rel = r.fs.rel(resolveDirInfo.enclosingBrowserScope.absPath, resolveDirInfo.absPath);
              if (rel[1] && rel[0] !== ".") {
                relativePathPrefix += rel[0].replaceAll("\\", "/") + "/";
              }

              // Browserify lets "require('pkg')" match "./pkg" but not "./pkg.js".
              // So don't add implicit extensions specifically in this place so we
              // match Browserify's behavior.
              result = checkPath(relativePathPrefix + inputPath, skipImplicitExtensions);
            }
            break;
          }
        }
      }

      if (r.debugLogs !== null) {
        if (result !== undefined) {
          if (result === null) {
            r.debugLogs.addNote("Found " + goQuote(inputPath) + " marked as disabled");
          } else {
            r.debugLogs.addNote("Found " + goQuote(inputPath) + " mapping to " + goQuote(result));
          }
        } else {
          r.debugLogs.addNote("Failed to find " + goQuote(inputPath));
        }
      }
      return result;
    },

    parsePackageJSON(inputPath: string): packageJSON | null {
      const r = this;
      const packageJSONPath: string = r.fs.join(inputPath, "package.json");
      const f = r.caches.fsCache.readFileText(r.fs, packageJSONPath);
      if (r.debugLogs !== null && f[2] !== null) {
        r.debugLogs.addNote("Failed to read file " + goQuote(packageJSONPath) + ": " + f[2].error());
      }
      if (f[1] !== null) {
        const prettyPaths = makePrettyPaths(r.fs, new Path(packageJSONPath, "file"));
        r.log.addError(null, new Range(0, 0), "Cannot read file " + goQuote(prettyPaths.select(r.options.logPathStyle)) + ": " + f[1].error());
        return null;
      }
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("The file " + goQuote(packageJSONPath) + " exists");
      }
      const contents: string = f[0];

      const keyPath = new Path(packageJSONPath, "file");
      const jsonSource = new Source(makePrettyPaths(r.fs, keyPath), "", contents, keyPath);
      const tracker = new LineColumnTracker(jsonSource);

      const parsed = r.caches.jsonCache.parse(r.log, jsonSource, DEFAULT_JSON_OPTIONS);
      if (!parsed[1]) {
        return null;
      }
      const json = parsed[0];

      const pj = new packageJSON(jsonSource);

      // Read the "name" field
      {
        const p = getProperty(json, "name");
        if (p[2]) {
          const s = getString(p[0]);
          if (s[1]) pj.name = s[0];
        }
      }

      // Read the "type" field
      {
        const p = getProperty(json, "type");
        if (p[2]) {
          const typeJSON = p[0];
          const s = getString(typeJSON);
          if (s[1]) {
            const typeValue = s[0];
            switch (typeValue) {
              case "commonjs":
                pj.moduleTypeData = new ModuleTypeData(pj.source, jsonSource.rangeOfString(typeJSON.loc), ModuleCommonJS_PackageJSON);
                break;
              case "module":
                pj.moduleTypeData = new ModuleTypeData(pj.source, jsonSource.rangeOfString(typeJSON.loc), ModuleESM_PackageJSON);
                break;
              default: {
                const notes = [new MsgData(null, null, 'The "type" field must be set to either "commonjs" or "module".')];
                let kind = Warning;

                // If someone does something like "type": "./index.d.ts" then they
                // likely meant "types" instead of "type". Customize the message
                // for this and hide it if it's inside a published npm package.
                if (typeValue.endsWith(".d.ts")) {
                  notes[0] = tracker.msgData(jsonSource.rangeOfString(p[1]), 'TypeScript type declarations use the "types" field, not the "type" field:');
                  notes[0].location.suggestion = '"types"';
                  if (isInsideNodeModules(jsonSource.keyPath.text)) {
                    kind = Debug;
                  }
                }

                r.log.addIDWithNotes(MsgID_PackageJSON_InvalidType, kind, tracker, jsonSource.rangeOfString(typeJSON.loc), goQuote(typeValue) + ' is not a valid value for the "type" field', notes);
              }
            }
          } else {
            r.log.addID(MsgID_PackageJSON_InvalidType, Warning, tracker, new Range(typeJSON.loc, 0), "The value for \"type\" must be a string");
          }
        }
      }

      // Read the "tsconfig" field
      {
        const p = getProperty(json, "tsconfig");
        if (p[2]) {
          const s = getString(p[0]);
          if (s[1]) pj.tsconfig = s[0];
        }
      }

      // Read the "main" fields
      let mainFields: string[] | null = r.options.mainFields;
      if (mainFields === null) {
        mainFields = defaultMainFields[r.options.platform];
      }
      for (let i = 0; i < mainFields.length; i++) {
        const field = mainFields[i];
        const p = getProperty(json, field);
        if (p[2]) {
          const s = getString(p[0]);
          if (s[1] && s[0] !== "") {
            pj.mainFields.set(field, new mainField(s[0], p[1]));
          }
        }
      }
      for (let i = 0; i < mainFieldsForFailure.length; i++) {
        const field = mainFieldsForFailure[i];
        if (!pj.mainFields.has(field)) {
          const p = getProperty(json, field);
          if (p[2]) {
            const s = getString(p[0]);
            if (s[1] && s[0] !== "") {
              pj.mainFields.set(field, new mainField(s[0], p[1]));
            }
          }
        }
      }

      // Read the "browser" property, but only when targeting the browser
      {
        const p = getProperty(json, "browser");
        if (p[2] && r.options.platform === PlatformBrowser) {
          // We both want the ability to have the option of CJS vs. ESM and the
          // option of having node vs. browser. The way to do this is to use the
          // object literal form of the "browser" field.
          const browserJSON = p[0];
          if (browserJSON.data instanceof EObject) {
            // The value is an object
            const browserMap = new Map<string, string | null>();

            // Remap all files in the browser field
            const properties = browserJSON.data.properties;
            for (let i = 0; i < properties.length; i++) {
              const prop = properties[i];
              const k = getString(prop.key);
              if (k[1] && prop.valueOrNil !== null) {
                const key = k[0];
                const v = getString(prop.valueOrNil);
                if (v[1]) {
                  // If this is a string, it's a replacement package
                  browserMap.set(key, v[0]);
                } else {
                  const b = getBool(prop.valueOrNil);
                  if (b[1]) {
                    // If this is false, it means the package is disabled
                    if (!b[0]) {
                      browserMap.set(key, null);
                    }
                  } else {
                    r.log.addID(MsgID_PackageJSON_InvalidBrowser, Warning, tracker, new Range(prop.valueOrNil.loc, 0), "Each \"browser\" mapping must be a string or a boolean");
                  }
                }
              }
            }

            pj.browserMap = browserMap;
          }
        }
      }

      // Read the "sideEffects" property
      {
        const p = getProperty(json, "sideEffects");
        if (p[2]) {
          const sideEffectsJSON = p[0];
          const sideEffectsLoc = p[1];
          const data = sideEffectsJSON.data;
          if (data instanceof EBoolean) {
            if (!data.value) {
              // Make an empty map for "sideEffects: false", which indicates all
              // files in this module can be considered to not have side effects.
              pj.sideEffectsMap = new Set();
              pj.sideEffectsData = new SideEffectsData(pj.source, "", jsonSource.rangeOfString(sideEffectsLoc), false);
            }
          } else if (data instanceof EArray) {
            // The "sideEffects: []" format means all files in this module but not in
            // the array can be considered to not have side effects.
            pj.sideEffectsMap = new Set();
            pj.sideEffectsData = new SideEffectsData(pj.source, "", jsonSource.rangeOfString(sideEffectsLoc), true);
            const items = data.items;
            for (let i = 0; i < items.length; i++) {
              const itemJSON = items[i];
              if (!(itemJSON.data instanceof EString)) {
                r.log.addID(MsgID_PackageJSON_InvalidSideEffects, Warning, tracker, new Range(itemJSON.loc, 0), "Expected string in array for \"sideEffects\"");
                continue;
              }

              // Reference: https://github.com/webpack/webpack/blob/ed175cd22f89eb9fecd0a70572a3fd0be028e77c/lib/optimize/SideEffectsFlagPlugin.js
              let pattern = itemJSON.data.value;
              if (pattern.indexOf("/") === -1) {
                pattern = "**/" + pattern;
              }
              let absPattern: string = r.fs.join(inputPath, pattern);
              absPattern = absPattern.replaceAll("\\", "/"); // Avoid problems with Windows-style slashes
              const g = globstarToEscapedRegexp(absPattern);

              // Wildcard patterns require more expensive matching
              if (g[1]) {
                if (pj.sideEffectsRegexps === null) pj.sideEffectsRegexps = [];
                pj.sideEffectsRegexps.push(new RegExp(g[0], "u"));
                continue;
              }

              // Normal strings can be matched with a map lookup
              pj.sideEffectsMap.add(absPattern);
            }
          } else {
            r.log.addID(MsgID_PackageJSON_InvalidSideEffects, Warning, tracker, new Range(sideEffectsJSON.loc, 0), "The value for \"sideEffects\" must be a boolean or an array");
          }
        }
      }

      // Read the "imports" map
      {
        const p = getProperty(json, "imports");
        if (p[2]) {
          const importsMap = parseImportsExportsMap(jsonSource, r.log, p[0], "imports", p[1]);
          if (importsMap !== null) {
            if (importsMap.root.kind !== pjObject) {
              r.log.addID(MsgID_PackageJSON_InvalidImportsOrExports, Warning, tracker, importsMap.root.firstToken, "The value for \"imports\" must be an object");
            }
            pj.importsMap = importsMap;
          }
        }
      }

      // Read the "exports" map
      {
        const p = getProperty(json, "exports");
        if (p[2]) {
          const exportsMap = parseImportsExportsMap(jsonSource, r.log, p[0], "exports", p[1]);
          if (exportsMap !== null) {
            pj.exportsMap = exportsMap;
          }
        }
      }

      return pj;
    },

    esmHandlePostConditions(resolved: string, status: number, debug: pjDebug): pjResult {
      if (status !== pjStatusExact && status !== pjStatusExactEndsWithStar && status !== pjStatusInexact) {
        return [resolved, status, debug];
      }

      const r = this;

      // If resolved contains any percent encodings of "/" or "\" ("%2f" and "%5C"
      // respectively), then throw an Invalid Module Specifier error.
      const resolvedPath = urlPathUnescape(resolved);
      if (resolvedPath === null) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("The path " + goQuote(resolved) + " contains invalid URL escapes: " + urlPathUnescapeBytes(resolved)[1]);
        }
        return [resolved, pjStatusInvalidModuleSpecifier, debug];
      }
      let found = "";
      if (resolved.indexOf("%2f") !== -1) {
        found = "%2f";
      } else if (resolved.indexOf("%2F") !== -1) {
        found = "%2F";
      } else if (resolved.indexOf("%5c") !== -1) {
        found = "%5c";
      } else if (resolved.indexOf("%5C") !== -1) {
        found = "%5C";
      }
      if (found !== "") {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("The path " + goQuote(resolved) + " is not allowed to contain " + goQuote(found));
        }
        return [resolved, pjStatusInvalidModuleSpecifier, debug];
      }

      // If the file at resolved is a directory, then throw an Unsupported Directory
      // Import error.
      if (resolvedPath.endsWith("/") || resolvedPath.endsWith("\\")) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote("The path " + goQuote(resolved) + " is not allowed to end with a slash");
        }
        return [resolved, pjStatusUnsupportedDirectoryImport, debug];
      }

      // Set resolved to the real path of resolved.
      return [resolvedPath, status, debug];
    },

    esmPackageImportsResolve(specifier: string, imports: pjEntry, conditions: Set<string>): pjResult {
      // ALGORITHM DEVIATION: Provide a friendly error message if "imports" is not an object
      if (imports.kind !== pjObject) {
        return ["", pjStatusInvalidPackageConfiguration, new pjDebug(imports.firstToken)];
      }

      const result: pjResult = this.esmPackageImportsExportsResolve(specifier, imports, "/", true, conditions);
      if (result[1] !== pjStatusNull && result[1] !== pjStatusUndefined) {
        return result;
      }

      if (this.debugLogs !== null) {
        this.debugLogs.addNote("The package import " + goQuote(specifier) + " is not defined");
      }
      return [specifier, pjStatusPackageImportNotDefined, new pjDebug(imports.firstToken)];
    },

    esmPackageExportsResolve(packageURL: string, subpath: string, exports: pjEntry, conditions: Set<string>): pjResult {
      if (exports.kind === pjInvalid) {
        if (this.debugLogs !== null) {
          this.debugLogs.addNote("Invalid package configuration");
        }
        return ["", pjStatusInvalidPackageConfiguration, new pjDebug(exports.firstToken)];
      }

      let debugToReturn = new pjDebug(exports.firstToken);
      if (subpath === ".") {
        let mainExport: pjEntry | null = null; // (Go: pjEntry{kind: pjNull})
        if (exports.kind === pjString || exports.kind === pjArray || (exports.kind === pjObject && !exports.keysStartWithDot())) {
          mainExport = exports;
        } else if (exports.kind === pjObject) {
          const dot = exports.valueForKey(".");
          if (dot !== null) {
            if (this.debugLogs !== null) {
              this.debugLogs.addNote('Using the entry for "."');
            }
            mainExport = dot;
          }
        }
        if (mainExport !== null && mainExport.kind !== pjNull) {
          const result: pjResult = this.esmPackageTargetResolve(packageURL, mainExport, "", false, false, conditions);
          if (result[1] !== pjStatusNull && result[1] !== pjStatusUndefined) {
            return result;
          } else {
            debugToReturn = result[2];
          }
        }
      } else if (exports.kind === pjObject && exports.keysStartWithDot()) {
        const result: pjResult = this.esmPackageImportsExportsResolve(subpath, exports, packageURL, false, conditions);
        if (result[1] !== pjStatusNull && result[1] !== pjStatusUndefined) {
          return result;
        } else {
          debugToReturn = result[2];
        }
      }

      if (this.debugLogs !== null) {
        this.debugLogs.addNote("The path " + goQuote(subpath) + " is not exported");
      }
      return ["", pjStatusPackagePathNotExported, debugToReturn];
    },

    esmPackageImportsExportsResolve(matchKey: string, matchObj: pjEntry, packageURL: string, isImports: boolean, conditions: Set<string>): pjResult {
      const r = this;
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Checking object path map for " + goQuote(matchKey));
      }

      // If matchKey is a key of matchObj and does not end in "/" or contain "*", then
      if (!matchKey.endsWith("/") && matchKey.indexOf("*") < 0) {
        const target = matchObj.valueForKey(matchKey);
        if (target !== null) {
          if (r.debugLogs !== null) {
            r.debugLogs.addNote("Found exact match for " + goQuote(matchKey));
          }
          return this.esmPackageTargetResolve(packageURL, target, "", false, isImports, conditions);
        }
      }

      const expansionKeys = matchObj.expansionKeys as pjMapEntry[];
      for (let i = 0; i < expansionKeys.length; i++) {
        const expansion = expansionKeys[i];

        // If expansionKey contains "*", set patternBase to the substring of
        // expansionKey up to but excluding the first "*" character
        const star = expansion.key.indexOf("*");
        if (star >= 0) {
          const patternBase = expansion.key.slice(0, star);

          // If patternBase is not null and matchKey starts with but is not equal
          // to patternBase, then
          if (matchKey.startsWith(patternBase)) {
            // Let patternTrailer be the substring of expansionKey from the index
            // after the first "*" character.
            const patternTrailer = expansion.key.slice(star + 1);

            // If patternTrailer has zero length, or if matchKey ends with
            // patternTrailer and the length of matchKey is greater than or
            // equal to the length of expansionKey, then
            // (the length comparison only says that the prefix and the suffix
            // don't overlap, which is the same in bytes and in UTF-16 units)
            if (patternTrailer === "" || (matchKey.endsWith(patternTrailer) && matchKey.length >= expansion.key.length)) {
              const target = expansion.value;
              const subpath = matchKey.slice(patternBase.length, matchKey.length - patternTrailer.length);
              if (r.debugLogs !== null) {
                r.debugLogs.addNote("The key " + goQuote(expansion.key) + " matched with " + goQuote(subpath) + " left over");
              }
              return this.esmPackageTargetResolve(packageURL, target, subpath, true, isImports, conditions);
            }
          }
        } else {
          // Otherwise if patternBase is null and matchKey starts with
          // expansionKey, then
          if (matchKey.startsWith(expansion.key)) {
            const target = expansion.value;
            const subpath = matchKey.slice(expansion.key.length);
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("The key " + goQuote(expansion.key) + " matched with " + goQuote(subpath) + " left over");
            }
            const result: pjResult = this.esmPackageTargetResolve(packageURL, target, subpath, false, isImports, conditions);
            if (result[1] === pjStatusExact || result[1] === pjStatusExactEndsWithStar) {
              // Return the object { resolved, exact: false }.
              result[1] = pjStatusInexact;
            }
            return result;
          }
        }

        if (r.debugLogs !== null) {
          r.debugLogs.addNote("The key " + goQuote(expansion.key) + " did not match");
        }
      }

      if (r.debugLogs !== null) {
        r.debugLogs.addNote("No keys matched " + goQuote(matchKey));
      }
      return ["", pjStatusNull, new pjDebug(matchObj.firstToken)];
    },

    esmPackageTargetResolve(packageURL: string, target: pjEntry, subpath: string, pattern: boolean, internal: boolean, conditions: Set<string>): pjResult {
      // (Go's "defer r.debugLogs.decreaseIndent()" in the cases below)
      const debugLogs = this.debugLogs;
      if (debugLogs !== null) {
        let deferred = false;
        switch (target.kind) {
          case pjString:
            debugLogs.addNote("Checking path " + goQuote(subpath) + " against target " + goQuote(target.strData));
            debugLogs.increaseIndent();
            deferred = true;
            break;

          case pjObject: {
            const keys: string[] = [];
            for (const key of conditions) {
              keys.push(goQuote(key));
            }
            keys.sort((a, b) => (goStringLess(a, b) ? -1 : goStringLess(b, a) ? 1 : 0));
            debugLogs.addNote("Checking condition map for one of [" + keys.join(", ") + "]");
            debugLogs.increaseIndent();
            deferred = true;
            break;
          }

          case pjArray:
            if ((target.arrData as pjEntry[]).length === 0) {
              debugLogs.addNote("The path " + goQuote(subpath) + " is set to an empty array");
              return ["", pjStatusNull, new pjDebug(target.firstToken)];
            }
            debugLogs.addNote("Checking for " + goQuote(subpath) + " in an array");
            debugLogs.increaseIndent();
            deferred = true;
            break;
        }
        if (deferred) {
          try {
            return this.esmPackageTargetResolveImpl(packageURL, target, subpath, pattern, internal, conditions);
          } finally {
            debugLogs.decreaseIndent();
          }
        }
      }
      return this.esmPackageTargetResolveImpl(packageURL, target, subpath, pattern, internal, conditions);
    },

    esmPackageTargetResolveImpl(packageURL: string, target: pjEntry, subpath: string, pattern: boolean, internal: boolean, conditions: Set<string>): pjResult {
      const r = this;
      switch (target.kind) {
        case pjString: {
          const strData = target.strData;

          // If pattern is false, subpath has non-zero length and target
          // does not end with "/", throw an Invalid Module Specifier error.
          if (!pattern && subpath !== "" && !strData.endsWith("/")) {
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("The target " + goQuote(strData) + ` is invalid because it doesn't end in "/"`);
            }
            return [strData, pjStatusInvalidModuleSpecifier, new pjDebug(target.firstToken, " because it doesn't end in \"/\"")];
          }

          // If target does not start with "./", then...
          if (!strData.startsWith("./")) {
            if (internal && !strData.startsWith("../") && !strData.startsWith("/")) {
              if (pattern) {
                const result = strData.replaceAll("*", subpath);
                if (r.debugLogs !== null) {
                  r.debugLogs.addNote("Substituted " + goQuote(subpath) + ' for "*" in ' + goQuote(strData) + " to get " + goQuote(result));
                }
                return [result, pjStatusPackageResolve, new pjDebug(target.firstToken)];
              }
              const result = strData + subpath;
              if (r.debugLogs !== null) {
                r.debugLogs.addNote("Joined " + goQuote(strData) + " to " + goQuote(subpath) + " to get " + goQuote(result));
              }
              return [result, pjStatusPackageResolve, new pjDebug(target.firstToken)];
            }
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("The target " + goQuote(strData) + ` is invalid because it doesn't start with "./"`);
            }
            return [strData, pjStatusInvalidPackageTarget, new pjDebug(target.firstToken, " because it doesn't start with \"./\"")];
          }

          // If target split on "/" or "\" contains any ".", ".." or "node_modules"
          // segments after the first segment, throw an Invalid Package Target error.
          {
            const invalidSegment = findInvalidSegment(strData);
            if (invalidSegment !== "") {
              if (r.debugLogs !== null) {
                r.debugLogs.addNote("The target " + goQuote(strData) + " is invalid because it contains invalid segment " + goQuote(invalidSegment));
              }
              return [strData, pjStatusInvalidPackageTarget, new pjDebug(target.firstToken, " because it contains invalid segment " + goQuote(invalidSegment))];
            }
          }

          // Let resolvedTarget be the URL resolution of the concatenation of packageURL and target.
          const resolvedTarget = goPathJoin(packageURL, strData);

          // If subpath split on "/" or "\" contains any ".", ".." or "node_modules"
          // segments, throw an Invalid Module Specifier error.
          {
            const invalidSegment = findInvalidSegment(subpath);
            if (invalidSegment !== "") {
              if (r.debugLogs !== null) {
                r.debugLogs.addNote("The path " + goQuote(subpath) + " is invalid because it contains invalid segment " + goQuote(invalidSegment));
              }
              return [subpath, pjStatusInvalidModuleSpecifier, new pjDebug(target.firstToken, " because it contains invalid segment " + goQuote(invalidSegment))];
            }
          }

          if (pattern) {
            // Return the URL resolution of resolvedTarget with every instance of "*" replaced with subpath.
            const result = resolvedTarget.replaceAll("*", subpath);
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("Substituted " + goQuote(subpath) + ' for "*" in ' + goQuote("." + resolvedTarget) + " to get " + goQuote("." + result));
            }
            let status = pjStatusExact;
            if (resolvedTarget.endsWith("*") && resolvedTarget.indexOf("*") === resolvedTarget.length - 1) {
              status = pjStatusExactEndsWithStar;
            }
            return [result, status, new pjDebug(target.firstToken)];
          } else {
            // Return the URL resolution of the concatenation of subpath and resolvedTarget.
            const result = goPathJoin(resolvedTarget, subpath);
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("Joined " + goQuote(subpath) + " to " + goQuote("." + resolvedTarget) + " to get " + goQuote("." + result));
            }
            return [result, pjStatusExact, new pjDebug(target.firstToken)];
          }
        }

        case pjObject: {
          let didFindMapEntry = false;
          let lastMapEntry: pjMapEntry | null = null;

          const mapData = target.mapData as pjMapEntry[];
          for (let i = 0; i < mapData.length; i++) {
            const p = mapData[i];
            if (p.key === "default" || conditions.has(p.key)) {
              if (r.debugLogs !== null) {
                r.debugLogs.addNote("The key " + goQuote(p.key) + " applies");
              }
              const result: pjResult = this.esmPackageTargetResolve(packageURL, p.value, subpath, pattern, internal, conditions);
              if (pjStatusIsUndefined(result[1])) {
                didFindMapEntry = true;
                lastMapEntry = p;
                continue;
              }
              return result;
            }
            if (r.debugLogs !== null) {
              r.debugLogs.addNote("The key " + goQuote(p.key) + " does not apply");
            }
          }

          if (r.debugLogs !== null) {
            r.debugLogs.addNote("No keys in the map were applicable");
          }

          // ALGORITHM DEVIATION: Provide a friendly error message if no conditions matched
          if (mapData.length > 0 && !target.keysStartWithDot()) {
            if (
              didFindMapEntry &&
              lastMapEntry !== null &&
              lastMapEntry.value.kind === pjObject &&
              (lastMapEntry.value.mapData as pjMapEntry[]).length > 0 &&
              !lastMapEntry.value.keysStartWithDot()
            ) {
              // If a top-level condition did match but no sub-condition matched,
              // complain about the sub-condition instead of the top-level condition.
              // This leads to a less confusing error message.
              // More information: https://github.com/evanw/esbuild/issues/1484
              target = lastMapEntry.value;
            }
            return ["", pjStatusUndefinedNoConditionsMatch, new pjDebug(target.firstToken, "", target.mapData)];
          }

          return ["", pjStatusUndefined, new pjDebug(target.firstToken)];
        }

        case pjArray: {
          const arrData = target.arrData as pjEntry[];
          if (arrData.length === 0) {
            return ["", pjStatusNull, new pjDebug(target.firstToken)];
          }
          let lastException = pjStatusUndefined;
          let lastDebug = new pjDebug(target.firstToken);
          for (let i = 0; i < arrData.length; i++) {
            // Let resolved be the result, continuing the loop on any Invalid Package Target error.
            const result: pjResult = this.esmPackageTargetResolve(packageURL, arrData[i], subpath, pattern, internal, conditions);
            if (result[1] === pjStatusInvalidPackageTarget || result[1] === pjStatusNull) {
              lastException = result[1];
              lastDebug = result[2];
              continue;
            }
            if (pjStatusIsUndefined(result[1])) {
              continue;
            }
            return result;
          }

          // Return or throw the last fallback resolution null return or error.
          return ["", lastException, lastDebug];
        }

        case pjNull:
          if (r.debugLogs !== null) {
            r.debugLogs.addNote("The path " + goQuote(subpath) + " is set to null");
          }
          return ["", pjStatusNull, new pjDebug(target.firstToken, "", null, true)];
      }

      if (r.debugLogs !== null) {
        r.debugLogs.addNote("Invalid package target for path " + goQuote(subpath));
      }
      return ["", pjStatusInvalidPackageTarget, new pjDebug(target.firstToken)];
    },
  });
}

// js_parser.JSONOptions{}
const DEFAULT_JSON_OPTIONS = new JSONOptions();
