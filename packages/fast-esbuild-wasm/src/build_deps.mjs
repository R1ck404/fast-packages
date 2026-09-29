// The build API's dependencies on the file system and the resolver
// (internal/fs, internal/resolver, internal/cache, pkg/api's path validation),
// in one place for bundler_scan.mts and build.mts.
import { Path, RANGE_ZERO } from "./logger.mjs";
import { realFS, RealFSOptions, ENOENT, DirEntry, FileEntry } from "./fs.mjs";
                                   
import { makeCacheSet, SourceIndexNormal, SourceIndexJSStubForCSS } from "./cache.mjs";
                                            
import { ResolveResult, PathPair, SideEffectsData } from "./resolver.mjs";

export { ENOENT, DirEntry, FileEntry };
export { newResolver, makePrettyPaths, isPackagePath } from "./resolver.mjs";
export { validateExternals, validateAlias, isValidExtension, validateResolveExtensions } from "./build_options.mjs";
export { parseDataURL } from "./dataurl.mjs";

// cache.SourceIndexKind
export const sourceIndexNormal = SourceIndexNormal;
export const sourceIndexJSStubForCSS = SourceIndexJSStubForCSS;

// fs.RealFS(RealFSOptions{AbsWorkingDir, DoNotCache}) on the given host (null:
// esbuild-wasm in a browser, where every syscall fails with ENOSYS).
// Returns [fs, errorText | null].
export function makeRealFS(host     , absWorkingDir        , doNotCache         )                             {
  return realFS(new RealFSOptions(absWorkingDir, false, doNotCache), host);
}

export function newCacheSet()           {
  return makeCacheSet();
}

// caches.FSCache.ReadFile: [contents, canonicalError]
export function fsCacheReadFile(caches          , fs    , path        )                           {
  const $f = caches.fsCache.readFile(fs, path);
  return [$f[0], $f[1]];
}

// api_impl.go's validatePath
export function validatePath(log     , fs    , relPath        , pathKind        )         {
  if (relPath === "") return "";
  const [absPath, ok] = fs.abs(relPath);
  if (!ok) {
    log.addError(null, RANGE_ZERO, "Invalid " + pathKind + ": " + relPath);
  }
  return absPath;
}

// &resolver.ResolveResult{PathPair: {Primary: path, IsExternal}, PluginData,
// PrimarySideEffectsData} for a path returned by an "onResolve" plugin
export function newResolveResultFromPlugin(path      , isExternal         , pluginData     , sideEffectsData                        )                {
  const result = new ResolveResult(new PathPair(path, new Path(), isExternal), null, sideEffectsData);
  result.pluginData = pluginData;
  return result;
}

// A copy of a resolver.ResolveResult (Go copies the struct; the paths are
// shared and must be replaced, not mutated)
export function cloneResolveResult(r               )                {
  const copy = new ResolveResult(new PathPair(r.pathPair.primary, r.pathPair.secondary, r.pathPair.isExternal), r.differentCase, r.primarySideEffectsData);
  copy.pluginData = r.pluginData;
  copy.tsConfigJSX = r.tsConfigJSX;
  copy.tsConfig = r.tsConfig;
  copy.tsAlwaysStrict = r.tsAlwaysStrict;
  copy.moduleTypeData = r.moduleTypeData;
  return copy;
}

// &resolver.SideEffectsData{PluginName: pluginName}
export function newSideEffectsData(pluginName        )                  {
  return new SideEffectsData(null, pluginName);
}
// generated from build_deps.mts by tools/ts-build.mjs; edit that file
