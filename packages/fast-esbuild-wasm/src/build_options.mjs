// Port of build option validators from pkg/api/api_impl.go: validatePath,
// validateExternals, validateAlias, isValidExtension and
// validateResolveExtensions.
import { Range } from "./logger.mjs";
import { goQuote } from "./gostd.mjs";
import { ExternalSettings, ExternalMatchers, WildcardPattern } from "./config.mjs";
                                   
import { isPackagePath } from "./resolver.mjs";
import { goPathClean } from "./package_json.mjs";

export function validatePath(log     , fs    , relPath        , pathKind        )         {
  if (relPath === "") {
    return "";
  }
  const r = fs.abs(relPath);
  if (!r[1]) {
    log.addError(null, new Range(0, 0), `Invalid ${pathKind}: ${relPath}`);
  }
  return r[0];
}

export function validateExternals(log     , fs    , paths                 )                   {
  const result = new ExternalSettings(new ExternalMatchers(new Map(), []), new ExternalMatchers(new Map(), []));

  if (paths === null) return result;
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const index = path.indexOf("*");
    if (index !== -1) {
      // Wildcard behavior
      if (path.indexOf("*", index + 1) !== -1) {
        log.addError(null, new Range(0, 0), `External path ${goQuote(path)} cannot have more than one "*" wildcard`);
      } else {
        result.preResolve.patterns.push(new WildcardPattern(path.slice(0, index), path.slice(index + 1)));
        if (!isPackagePath(path)) {
          const absPath = validatePath(log, fs, path, "external path");
          if (absPath !== "") {
            const absIndex = absPath.indexOf("*");
            if (absIndex !== -1 && absPath.indexOf("*", absIndex + 1) === -1) {
              result.postResolve.patterns.push(new WildcardPattern(absPath.slice(0, absIndex), absPath.slice(absIndex + 1)));
            }
          }
        }
      }
    } else {
      // Non-wildcard behavior
      result.preResolve.exact.set(path, true);
      if (isPackagePath(path)) {
        result.preResolve.patterns.push(new WildcardPattern(path + "/"));
      } else {
        const absPath = validatePath(log, fs, path, "external path");
        if (absPath !== "") {
          result.postResolve.exact.set(absPath, true);
        }
      }
    }
  }

  return result;
}

// "alias" is a Map (Go: map[string]string). Returns a new Map.
export function validateAlias(log     , fs    , alias                            )                      {
  const valid = new Map                ();
  if (alias === null) return valid;

  for (const [old, new_] of alias) {
    if (new_ === "") {
      log.addError(null, new Range(0, 0), `Invalid alias substitution: ${goQuote(new_)}`);
      continue;
    }

    // Valid alias names:
    //   "foo"
    //   "foo/bar"
    //   "@foo"
    //   "@foo/bar"
    //   "@foo/bar/baz"
    //
    // Invalid alias names:
    //   "./foo"
    //   "../foo"
    //   "/foo"
    //   "C:\\foo"
    //   ".foo"
    //   "foo/"
    //   "@foo/"
    //   "foo/../bar"
    //
    if (!old.startsWith(".") && !old.startsWith("/") && !fs.isAbs(old) && goPathClean(old.replaceAll("\\", "/")) === old) {
      valid.set(old, new_);
      continue;
    }

    log.addError(null, new Range(0, 0), `Invalid alias name: ${goQuote(old)}`);
  }

  return valid;
}

export function isValidExtension(ext        )          {
  // (Go checks byte lengths; for the first and the last character, and for
  // "at least two bytes" vs. "at least two code units" given a leading ".",
  // the answers are the same)
  return ext.length >= 2 && ext.charCodeAt(0) === 46 && ext.charCodeAt(ext.length - 1) !== 46;
}

export function validateResolveExtensions(log     , order                 )           {
  if (order === null) {
    return [".tsx", ".ts", ".jsx", ".js", ".css", ".json"];
  }
  for (let i = 0; i < order.length; i++) {
    if (!isValidExtension(order[i])) {
      log.addError(null, new Range(0, 0), `Invalid file extension: ${goQuote(order[i])}`);
    }
  }
  return order;
}
// generated from build_options.mts by tools/ts-build.mjs; edit that file
