// Port of internal/resolver/yarnpnp.go: the Yarn PnP specification
// (https://yarnpkg.com/advanced/pnp-spec/).
//
// The "resolverQuery" methods are installed onto the Resolver class of
// resolver.mjs by installYarnPnPMethods() (a hoisted function declaration,
// like package_json.mjs, so the circular import works in either order).
import { goQuote } from "./gostd.mjs";
import { Path, Source, Range, LineColumnTracker, RANGE_ZERO } from "./logger.mjs";
import { EArray, EString, ENull, Expr } from "./js_ast.mjs";
import { JSONOptions } from "./json_parser.mjs";
import { Options as JSParserOptions } from "./js_parser.mjs";
import { compile as regexpCompile, GoRegexp } from "./goregexp.mjs";
import { ENOENT } from "./fs.mjs";
import { goPathJoin } from "./package_json.mjs";
import { makePrettyPaths, getProperty, getString, getBool } from "./resolver.mjs";

export class pnpData {
  // Keys are the package idents, values are sets of references. Combining the
  // ident with each individual reference yields the set of affected locators.
                                                                 

  // A map of locators that all packages are allowed to access, regardless
  // whether they list them in their dependencies or not.
                                                                 

  // A nullable regexp. If set, all project-relative importer paths should be
  // matched against it. If the match succeeds, the resolution should follow
  // the classic Node.js resolution algorithm rather than the Plug'n'Play one.
  // Note that unlike other paths in the manifest, the one checked against this
  // regexp won't begin by `./`.
                                             
                                           

  // This is the main part of the PnP data file. This table contains the list
  // of all packages, first keyed by package ident then by package reference.
  // One entry will have `null` in both fields and represents the absolute
  // top-level package.
                                                                           

                                                                                      

  // If true, should a dependency resolution fail for an importer that isn't
  // explicitly listed in `fallbackExclusionList`, the runtime must first check
  // whether the resolution would succeed for any of the packages in
  // `fallbackPool`; if it would, transparently return this resolution. Note
  // that all dependencies from the top-level package are implicitly part of
  // the fallback pool, even if not listed here.
                                          

                                     
                          
                             
  constructor(absPath        , absDirPath        , tracker                   ) {
    this.fallbackExclusionList = null;
    this.fallbackPool = null;
    this.ignorePatternData = null;
    this.invalidIgnorePatternData = "";
    this.packageRegistryData = null;
    this.packageLocatorsByLocations = null;
    this.enableTopLevelFallback = false;
    this.tracker = tracker;
    this.absPath = absPath;
    this.absDirPath = absDirPath;
  }
}

// This is called both a "locator" and a "dependency target" in the specification.
// When it's used as a dependency target, it can only be in one of three states:
//
//  1. A reference, to link with the dependency name
//     In this case ident is "".
//
//  2. An aliased package
//     In this case neither ident nor reference are "".
//
//  3. A missing peer dependency
//     In this case ident and reference are "".
export class pnpIdentAndReference {
  ;                      // Empty if null
  ;                          // Empty if null
  ;                   
  constructor(ident = "", reference = "", span        = RANGE_ZERO) {
    this.ident = ident;
    this.reference = reference;
    this.span = span;
  }
}

const EMPTY_LOCATOR = new pnpIdentAndReference();

class pnpPackage {
                                                                 
                                  
                                          
                                     
  constructor(packageDependencies                                   , packageLocation        , packageDependenciesRange       , discardFromLookup         ) {
    this.packageDependencies = packageDependencies;
    this.packageLocation = packageLocation;
    this.packageDependenciesRange = packageDependenciesRange;
    this.discardFromLookup = discardFromLookup;
  }
}

class pnpPackageLocatorByLocation {
  ;                                     
  ;                                  
  constructor(locator                      , discardFromLookup         ) {
    this.locator = locator;
    this.discardFromLookup = discardFromLookup;
  }
}

// Returns [ident, modulePath, ok]
function parseBareIdentifier(specifier        )                            {
  let ident        ;
  const slash = specifier.indexOf("/");

  // If specifier starts with "@", then
  if (specifier.startsWith("@")) {
    // If specifier doesn't contain a "/" separator, then
    if (slash === -1) {
      // Throw an error
      return ["", "", false];
    }

    // Otherwise,
    // Set ident to the substring of specifier until the second "/" separator or the end of string, whatever happens first
    const slash2 = specifier.indexOf("/", slash + 1);
    if (slash2 !== -1) {
      ident = specifier.slice(0, slash2);
    } else {
      ident = specifier;
    }
  } else {
    // Otherwise,
    // Set ident to the substring of specifier until the first "/" separator or the end of string, whatever happens first
    if (slash !== -1) {
      ident = specifier.slice(0, slash);
    } else {
      ident = specifier;
    }
  }

  // Set modulePath to the substring of specifier starting from ident.length
  const modulePath = specifier.slice(ident.length);

  // Return {ident, modulePath}
  return [ident, modulePath, true];
}

// pnpStatus
export const pnpErrorGeneric = 0;
export const pnpErrorDependencyNotFound = 1;
export const pnpErrorUnfulfilledPeerDependency = 2;
export const pnpSuccess = 3;
export const pnpSkipped = 4;

export function pnpStatusIsError(status        )          {
  return status < pnpSuccess;
}

export class pnpResult {
  ;                      
  ;                          
  ;                        
  ;                          

  // This is for error messages
  ;                          
  ;                         
  constructor(status        , pkgDirPath = "", pkgIdent = "", pkgSubpath = "", errorIdent = "", errorRange        = RANGE_ZERO) {
    this.status = status;
    this.pkgDirPath = pkgDirPath;
    this.pkgIdent = pkgIdent;
    this.pkgSubpath = pkgSubpath;
    this.errorIdent = errorIdent;
    this.errorRange = errorRange;
  }
}

function quoteOrNullIfEmpty(str        )         {
  if (str !== "") {
    return goQuote(str);
  }
  return "null";
}

// The resolverQuery methods (see the top of this file)
const yarnPnPMethods = {
  // Note: If this returns successfully then the node module resolution algorithm
  // (i.e. NM_RESOLVE in the Yarn PnP specification) is always run afterward
  resolveToUnqualified(specifier        , parentURL        , manifest         )            {
    const r      = this;

    // Let resolved be undefined

    // Let manifest be FIND_PNP_MANIFEST(parentURL)
    // (this is already done by the time we get here)
    if (r.debugLogs !== null) {
      r.debugLogs.addNote("Using Yarn PnP manifest from " + goQuote(manifest.absPath));
      r.debugLogs.addNote("  Resolving " + goQuote(specifier) + " in " + goQuote(parentURL));
    }

    // Let ident and modulePath be the result of PARSE_BARE_IDENTIFIER(specifier)
    const $b = parseBareIdentifier(specifier);
    const ident = $b[0];
    const modulePath = $b[1];
    if (!$b[2]) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("  Failed to parse specifier " + goQuote(specifier) + " into a bare identifier");
      }
      return new pnpResult(pnpErrorGeneric);
    }
    if (r.debugLogs !== null) {
      r.debugLogs.addNote("  Parsed bare identifier " + goQuote(ident) + " and module path " + goQuote(modulePath));
    }

    // Let parentLocator be FIND_LOCATOR(manifest, parentURL)
    const $l = r.findLocator(manifest, parentURL);
    const parentLocator                       = $l[0];

    // If parentLocator is null, then
    // Set resolved to NM_RESOLVE(specifier, parentURL) and return it
    if (!$l[1]) {
      return new pnpResult(pnpSkipped);
    }
    if (r.debugLogs !== null) {
      r.debugLogs.addNote("  Found parent locator: [" + quoteOrNullIfEmpty(parentLocator.ident) + ", " + quoteOrNullIfEmpty(parentLocator.reference) + "]");
    }

    // Let parentPkg be GET_PACKAGE(manifest, parentLocator)
    const $p = r.getPackage(manifest, parentLocator.ident, parentLocator.reference);
    const parentPkg             = $p[0];
    if (!$p[1]) {
      // We aren't supposed to get here according to the Yarn PnP specification
      return new pnpResult(pnpErrorGeneric);
    }
    if (r.debugLogs !== null) {
      r.debugLogs.addNote("  Found parent package at " + goQuote(parentPkg.packageLocation));
    }

    // Let referenceOrAlias be the entry from parentPkg.packageDependencies referenced by ident
    let referenceOrAlias = parentPkg.packageDependencies.get(ident);
    let ok = referenceOrAlias !== undefined;
    if (referenceOrAlias === undefined) referenceOrAlias = EMPTY_LOCATOR;

    // If referenceOrAlias is null or undefined, then
    if (!ok || referenceOrAlias.reference === "") {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("  Failed to find " + goQuote(ident) + ' in "packageDependencies" of parent package');
      }

      // If manifest.enableTopLevelFallback is true, then
      if (manifest.enableTopLevelFallback) {
        if (r.debugLogs !== null) {
          r.debugLogs.addNote('  Searching for a fallback because "enableTopLevelFallback" is true');
        }

        // If parentLocator isn't in manifest.fallbackExclusionList, then
        const set = manifest.fallbackExclusionList !== null ? manifest.fallbackExclusionList.get(parentLocator.ident) : undefined;
        if (set === undefined || !set.has(parentLocator.reference)) {
          // Let fallback be RESOLVE_VIA_FALLBACK(manifest, ident)
          const fallback                       = r.resolveViaFallback(manifest, ident)[0];

          // If fallback is neither null nor undefined
          if (fallback.reference !== "") {
            // Set referenceOrAlias to fallback
            referenceOrAlias = fallback;
            ok = true;
          }
        } else if (r.debugLogs !== null) {
          r.debugLogs.addNote(
            "    Stopping because [" + quoteOrNullIfEmpty(parentLocator.ident) + ", " + quoteOrNullIfEmpty(parentLocator.reference) + '] is in "fallbackExclusionList"',
          );
        }
      }
    }

    // If referenceOrAlias is still undefined, then
    if (!ok) {
      // Throw a resolution error
      return new pnpResult(pnpErrorDependencyNotFound, "", "", "", ident, parentPkg.packageDependenciesRange);
    }

    // If referenceOrAlias is still null, then
    if (referenceOrAlias.reference === "") {
      // Note: It means that parentPkg has an unfulfilled peer dependency on ident
      // Throw a resolution error
      return new pnpResult(pnpErrorUnfulfilledPeerDependency, "", "", "", ident, referenceOrAlias.span);
    }

    if (r.debugLogs !== null) {
      let referenceOrAliasStr        ;
      if (referenceOrAlias.ident !== "") {
        referenceOrAliasStr = "[" + goQuote(referenceOrAlias.ident) + ", " + goQuote(referenceOrAlias.reference) + "]";
      } else {
        referenceOrAliasStr = quoteOrNullIfEmpty(referenceOrAlias.reference);
      }
      r.debugLogs.addNote("  Found dependency locator: [" + quoteOrNullIfEmpty(ident) + ", " + referenceOrAliasStr + "]");
    }

    // Otherwise, if referenceOrAlias is an array, then
    let dependencyPkg            ;
    if (referenceOrAlias.ident !== "") {
      // Let alias be referenceOrAlias
      const alias = referenceOrAlias;

      // Let dependencyPkg be GET_PACKAGE(manifest, alias)
      const $d = r.getPackage(manifest, alias.ident, alias.reference);
      dependencyPkg = $d[0];
      if (!$d[1]) {
        // We aren't supposed to get here according to the Yarn PnP specification
        return new pnpResult(pnpErrorGeneric);
      }
    } else {
      // Otherwise,
      // Let dependencyPkg be GET_PACKAGE(manifest, {ident, reference})
      const $d = r.getPackage(manifest, ident, referenceOrAlias.reference);
      dependencyPkg = $d[0];
      if (!$d[1]) {
        // We aren't supposed to get here according to the Yarn PnP specification
        return new pnpResult(pnpErrorGeneric);
      }
    }
    if (r.debugLogs !== null) {
      r.debugLogs.addNote("  Found package " + goQuote(ident) + " at " + goQuote(dependencyPkg.packageLocation));
    }

    // Return path.resolve(manifest.dirPath, dependencyPkg.packageLocation, modulePath)
    let absDirPath = manifest.absDirPath;
    const isWindows = !absDirPath.startsWith("/");
    if (isWindows) {
      // Yarn converts Windows-style paths with volume labels into Unix-style
      // paths with a "/" prefix for the purpose of joining them together here.
      // So "C:\foo\bar.txt" becomes "/C:/foo/bar.txt". This is very important
      // because Yarn also stores a single global cache on the "C:" drive, many
      // developers do their work on the "D:" drive, and Yarn uses "../C:" to
      // traverse between the "D:" drive and the "C:" drive. Windows doesn't
      // allow you to do that ("D:\.." is just "D:\") so without temporarily
      // swapping to Unix-style paths here, esbuild would otherwise fail in this
      // case while Yarn itself would succeed.
      absDirPath = "/" + absDirPath.replaceAll("\\", "/");
    }
    let pkgDirPath = goPathJoin(absDirPath, dependencyPkg.packageLocation);
    if (isWindows && pkgDirPath.startsWith("/")) {
      // Convert the Unix-style path back into a Windows-style path afterwards
      pkgDirPath = pkgDirPath.slice(1).replaceAll("\\", "//");
    }
    if (r.debugLogs !== null) {
      r.debugLogs.addNote("  Resolved " + goQuote(specifier) + " via Yarn PnP to " + goQuote(pkgDirPath) + " with subpath " + goQuote(modulePath));
    }
    return new pnpResult(pnpSuccess, pkgDirPath, ident, modulePath);
  },

  // Returns [locator, ok]
  findLocator(manifest         , moduleUrl        )                                  {
    const r      = this;

    // Let relativeUrl be the relative path between manifest and moduleUrl
    const $r = r.fs.rel(manifest.absDirPath, moduleUrl);
    let relativeUrl         = $r[0];
    if (!$r[1]) {
      return [EMPTY_LOCATOR, false];
    } else {
      // Relative URLs on Windows will use \ instead of /, which will break
      // everything we do below. Use normal slashes to keep things working.
      relativeUrl = relativeUrl.replaceAll("\\", "/");
    }

    // The relative path must not start with ./; trim it if needed
    if (relativeUrl.startsWith("./")) relativeUrl = relativeUrl.slice(2);

    // If relativeUrl matches manifest.ignorePatternData, then
    if (manifest.ignorePatternData !== null && manifest.ignorePatternData.matchString(relativeUrl)) {
      if (r.debugLogs !== null) {
        r.debugLogs.addNote("  Ignoring " + goQuote(relativeUrl) + ' because it matches "ignorePatternData"');
      }

      // Return null
      return [EMPTY_LOCATOR, false];
    }

    // Note: Make sure relativeUrl always starts with a ./ or ../
    if (!relativeUrl.endsWith("/")) {
      relativeUrl += "/";
    }
    if (!relativeUrl.startsWith("./") && !relativeUrl.startsWith("../")) {
      relativeUrl = "./" + relativeUrl;
    }

    // This is the inner loop from Yarn's PnP resolver implementation. This is
    // different from the specification, which contains a hypothetical slow
    // algorithm instead. The algorithm from the specification can sometimes
    // produce different results from the one used by the implementation, so
    // we follow the implementation.
    const locations = manifest.packageLocatorsByLocations;
    for (;;) {
      const entry = locations !== null ? locations.get(relativeUrl) : undefined;
      if (entry === undefined || entry.discardFromLookup) {
        // Remove the last path component and try again
        relativeUrl = relativeUrl.slice(0, relativeUrl.lastIndexOf("/", relativeUrl.length - 2) + 1);
        if (relativeUrl === "") {
          break;
        }
        continue;
      }
      return [entry.locator, true];
    }

    return [EMPTY_LOCATOR, false];
  },

  // Returns [referenceOrAlias, ok]
  resolveViaFallback(manifest         , ident        )                                  {
    const r      = this;

    // Let topLevelPkg be GET_PACKAGE(manifest, {null, null})
    const $t = r.getPackage(manifest, "", "");
    if (!$t[1]) {
      // We aren't supposed to get here according to the Yarn PnP specification
      return [EMPTY_LOCATOR, false];
    }
    const topLevelPkg             = $t[0];

    // Let referenceOrAlias be the entry from topLevelPkg.packageDependencies referenced by ident
    let referenceOrAlias = topLevelPkg.packageDependencies.get(ident);

    // If referenceOrAlias is defined, then
    if (referenceOrAlias !== undefined) {
      // Return it immediately
      if (r.debugLogs !== null) {
        r.debugLogs.addNote(
          "    Found fallback for " +
            goQuote(ident) +
            ' in "packageDependencies" of top-level package: [' +
            quoteOrNullIfEmpty(referenceOrAlias.ident) +
            ", " +
            quoteOrNullIfEmpty(referenceOrAlias.reference) +
            "]",
        );
      }
      return [referenceOrAlias, true];
    }

    // Otherwise,
    // Let referenceOrAlias be the entry from manifest.fallbackPool referenced by ident
    referenceOrAlias = manifest.fallbackPool !== null ? manifest.fallbackPool.get(ident) : undefined;
    const ok = referenceOrAlias !== undefined;
    if (referenceOrAlias === undefined) referenceOrAlias = EMPTY_LOCATOR;

    // Return it immediately, whether it's defined or not
    if (r.debugLogs !== null) {
      if (ok) {
        r.debugLogs.addNote(
          "    Found fallback for " + goQuote(ident) + ' in "fallbackPool": [' + quoteOrNullIfEmpty(referenceOrAlias.ident) + ", " + quoteOrNullIfEmpty(referenceOrAlias.reference) + "]",
        );
      } else {
        r.debugLogs.addNote("    Failed to find fallback for " + goQuote(ident) + ' in "fallbackPool"');
      }
    }
    return [referenceOrAlias, ok];
  },

  // Returns [pkg, ok]
  getPackage(manifest         , ident        , reference        )                               {
    const r      = this;
    if (manifest.packageRegistryData !== null) {
      const inner = manifest.packageRegistryData.get(ident);
      if (inner !== undefined) {
        const pkg = inner.get(reference);
        if (pkg !== undefined) {
          return [pkg, true];
        }
      }
    }

    if (r.debugLogs !== null) {
      // We aren't supposed to get here according to the Yarn PnP specification:
      // "Note: pkg cannot be undefined here; all packages referenced in any of the
      // Plug'n'Play data tables MUST have a corresponding entry inside packageRegistryData."
      r.debugLogs.addNote("  Yarn PnP invariant violation: GET_PACKAGE failed to find a package: [" + quoteOrNullIfEmpty(ident) + ", " + quoteOrNullIfEmpty(reference) + "]");
    }
    return [null, false];
  },

  // Returns [result (an Expr with a nil Data when missing), source]
  extractYarnPnPDataFromJSON(pnpDataPath        , mode        )                 {
    const r      = this;
    const $f = r.caches.fsCache.readFileText(r.fs, pnpDataPath);
    const err = $f[1];
    const originalError = $f[2];
    if (r.debugLogs !== null && originalError !== null) {
      r.debugLogs.addNote("Failed to read file " + goQuote(pnpDataPath) + ": " + originalError.error());
    }
    if (err !== null) {
      if (mode === pnpReportErrorsAboutMissingFiles || err !== ENOENT) {
        const prettyPaths = makePrettyPaths(r.fs, new Path(pnpDataPath, "file"));
        r.log.addError(null, RANGE_ZERO, "Cannot read file " + goQuote(prettyPaths.select(r.options.logPathStyle)) + ": " + err.error());
      }
      return [new Expr(null, 0), new Source()];
    }
    if (r.debugLogs !== null) {
      r.debugLogs.addNote("The file " + goQuote(pnpDataPath) + " exists");
    }
    const keyPath = new Path(pnpDataPath, "file");
    const source = new Source(makePrettyPaths(r.fs, keyPath), "", $f[0], keyPath);
    const $j = r.caches.jsonCache.parse(r.log, source, new JSONOptions());
    return [$j[0] !== null ? $j[0] : new Expr(null, 0), source];
  },

  // Returns [result (an Expr with a nil Data when missing), source]
  tryToExtractYarnPnPDataFromJS(pnpDataPath        , mode        )                 {
    const r      = this;
    const $f = r.caches.fsCache.readFileText(r.fs, pnpDataPath);
    const err = $f[1];
    const originalError = $f[2];
    if (r.debugLogs !== null && originalError !== null) {
      r.debugLogs.addNote("Failed to read file " + goQuote(pnpDataPath) + ": " + originalError.error());
    }
    if (err !== null) {
      if (mode === pnpReportErrorsAboutMissingFiles || err !== ENOENT) {
        const prettyPaths = makePrettyPaths(r.fs, new Path(pnpDataPath, "file"));
        r.log.addError(null, RANGE_ZERO, "Cannot read file " + goQuote(prettyPaths.select(r.options.logPathStyle)) + ": " + err.error());
      }
      return [new Expr(null, 0), new Source()];
    }
    if (r.debugLogs !== null) {
      r.debugLogs.addNote("The file " + goQuote(pnpDataPath) + " exists");
    }

    const keyPath = new Path(pnpDataPath, "file");
    const source = new Source(makePrettyPaths(r.fs, keyPath), "", $f[0], keyPath);
    const options = new JSParserOptions();
    options.decodeHydrateRuntimeStateYarnPnP = true; // js_parser.OptionsForYarnPnP()
    const ast = r.caches.jsCache.parse(r.log, source, options)[0];
    const manifest = ast !== null && ast.manifestForYarnPnP !== null ? ast.manifestForYarnPnP : new Expr(null, 0);

    if (r.debugLogs !== null && manifest.data !== null) {
      r.debugLogs.addNote("  Extracted JSON data from " + goQuote(pnpDataPath));
    }
    return [manifest, source];
  },
};

export function installYarnPnPMethods(proto     ) {
  Object.assign(proto, yarnPnPMethods);
}

// pnpDataMode
export const pnpIgnoreErrorsAboutMissingFiles = 0;
export const pnpReportErrorsAboutMissingFiles = 1;

export function compileYarnPnPData(absPath        , absDirPath        , json      , source        )          {
  const data = new pnpData(absPath, absDirPath, new LineColumnTracker(source));

  {
    const $v = getProperty(json, "enableTopLevelFallback");
    if ($v[2]) {
      const $b = getBool($v[0]);
      if ($b[1]) {
        data.enableTopLevelFallback = $b[0];
      }
    }
  }

  {
    const $v = getProperty(json, "fallbackExclusionList");
    if ($v[2]) {
      const array = $v[0].data;
      if (array instanceof EArray) {
        data.fallbackExclusionList = new Map();

        for (const item of array.items) {
          const tuple = item.data;
          if (tuple instanceof EArray && tuple.items.length === 2) {
            const $i = getStringOrNull(tuple.items[0]);
            if ($i[1]) {
              const array2 = tuple.items[1].data;
              if (array2 instanceof EArray) {
                const references = new Set        ();

                for (const item2 of array2.items) {
                  const $r = getString(item2);
                  if ($r[1]) {
                    references.add($r[0]);
                  }
                }

                data.fallbackExclusionList.set($i[0], references);
              }
            }
          }
        }
      }
    }
  }

  {
    const $v = getProperty(json, "fallbackPool");
    if ($v[2]) {
      const array = $v[0].data;
      if (array instanceof EArray) {
        data.fallbackPool = new Map();

        for (const item of array.items) {
          const array2 = item.data;
          if (array2 instanceof EArray && array2.items.length === 2) {
            const $i = getString(array2.items[0]);
            if ($i[1]) {
              const $d = getDependencyTarget(array2.items[1]);
              if ($d[1]) {
                data.fallbackPool.set($i[0], $d[0]);
              }
            }
          }
        }
      }
    }
  }

  {
    const $v = getProperty(json, "ignorePatternData");
    if ($v[2]) {
      const $s = getString($v[0]);
      if ($s[1]) {
        let ignorePatternData = $s[0];

        // The Go regular expression engine doesn't support some of the features
        // that JavaScript regular expressions support, including "(?!" negative
        // lookaheads which Yarn uses. This is deliberate on Go's part. See this:
        // https://github.com/golang/go/issues/18868.
        //
        // Yarn uses this feature to exclude the "." and ".." path segments in
        // the middle of a relative path. However, we shouldn't ever generate
        // such path segments in the first place. So as a hack, we just remove
        // the specific character sequences used by Yarn for this so that the
        // regular expression is more likely to be able to be compiled.
        ignorePatternData = ignorePatternData.replaceAll("(?!\\.)", "");
        ignorePatternData = ignorePatternData.replaceAll("(?!(?:^|\\/)\\.)", "");
        ignorePatternData = ignorePatternData.replaceAll("(?!\\.{1,2}(?:\\/|$))", "");
        ignorePatternData = ignorePatternData.replaceAll("(?!(?:^|\\/)\\.{1,2}(?:\\/|$))", "");

        // (Go compiles the bytes of the string: lone surrogates, and raw
        // bytes of invalid UTF-8, are invalid UTF-8, which Go rejects)
        const reg = ignorePatternData.isWellFormed() ? regexpCompile(ignorePatternData) : null;
        if (reg instanceof GoRegexp) {
          data.ignorePatternData = reg;
        } else {
          data.invalidIgnorePatternData = ignorePatternData;
        }
      }
    }
  }

  {
    const $v = getProperty(json, "packageRegistryData");
    if ($v[2]) {
      const array = $v[0].data;
      if (array instanceof EArray) {
        data.packageRegistryData = new Map();
        data.packageLocatorsByLocations = new Map();

        for (const item of array.items) {
          const tuple = item.data;
          if (tuple instanceof EArray && tuple.items.length === 2) {
            const $i = getStringOrNull(tuple.items[0]);
            if (!$i[1]) continue;
            const packageIdent = $i[0];
            const array2 = tuple.items[1].data;
            if (!(array2 instanceof EArray)) continue;
            const references = new Map                    ();
            data.packageRegistryData.set(packageIdent, references);

            for (const item2 of array2.items) {
              const tuple2 = item2.data;
              if (!(tuple2 instanceof EArray && tuple2.items.length === 2)) continue;
              const $r = getStringOrNull(tuple2.items[0]);
              if (!$r[1]) continue;
              const packageReference = $r[0];
              const pkg = tuple2.items[1];

              const $l = getProperty(pkg, "packageLocation");
              if (!$l[2]) continue;
              const $d = getProperty(pkg, "packageDependencies");
              if (!$d[2]) continue;
              const packageDependencies       = $d[0];
              const $ls = getString($l[0]);
              if (!$ls[1]) continue;
              const packageLocation = $ls[0];
              const array3 = packageDependencies.data;
              if (!(array3 instanceof EArray)) continue;
              const deps = new Map                              ();
              let discardFromLookup = false;

              for (const dep of array3.items) {
                const array4 = dep.data;
                if (array4 instanceof EArray && array4.items.length === 2) {
                  const $n = getString(array4.items[0]);
                  if ($n[1]) {
                    const $t = getDependencyTarget(array4.items[1]);
                    if ($t[1]) {
                      deps.set($n[0], $t[0]);
                    }
                  }
                }
              }

              const $dl = getProperty(pkg, "discardFromLookup");
              if ($dl[2]) {
                const $db = getBool($dl[0]);
                if ($db[1]) {
                  discardFromLookup = $db[0];
                }
              }

              references.set(
                packageReference,
                new pnpPackage(deps, packageLocation, new Range(packageDependencies.loc, array3.closeBracketLoc + 1 - packageDependencies.loc), discardFromLookup),
              );

              // This is what Yarn's PnP implementation does (specifically in
              // "hydrateRuntimeState"), so we replicate that behavior here:
              const entry = data.packageLocatorsByLocations.get(packageLocation);
              if (entry === undefined) {
                data.packageLocatorsByLocations.set(
                  packageLocation,
                  new pnpPackageLocatorByLocation(new pnpIdentAndReference(packageIdent, packageReference), discardFromLookup),
                );
              } else {
                const entry2 = new pnpPackageLocatorByLocation(entry.locator, entry.discardFromLookup && discardFromLookup);
                if (!discardFromLookup) {
                  entry2.locator = new pnpIdentAndReference(packageIdent, packageReference);
                }
                data.packageLocatorsByLocations.set(packageLocation, entry2);
              }
            }
          }
        }
      }
    }
  }

  return data;
}

function getStringOrNull(json      )                    {
  const value = json.data;
  if (value instanceof EString) {
    return [value.value, true];
  }
  if (value instanceof ENull) {
    return ["", true];
  }
  return ["", false];
}

function getDependencyTarget(json      )                                  {
  const d = json.data;
  if (d instanceof ENull) {
    return [new pnpIdentAndReference("", "", new Range(json.loc, 4)), true];
  }
  if (d instanceof EString) {
    return [new pnpIdentAndReference("", d.value, new Range(json.loc, 0)), true];
  }
  if (d instanceof EArray) {
    if (d.items.length === 2) {
      const $n = getString(d.items[0]);
      if ($n[1]) {
        const $r = getString(d.items[1]);
        if ($r[1]) {
          return [new pnpIdentAndReference($n[0], $r[0], new Range(json.loc, d.closeBracketLoc + 1 - json.loc)), true];
        }
      }
    }
  }
  return [EMPTY_LOCATOR, false];
}

// generated from yarnpnp.mts by tools/ts-build.mjs; edit that file
