// Port of the parts of internal/cache the resolver and the bundler need:
// cache.go (CacheSet, SourceIndexCache), cache_fs.go (FSCache) and the JSON
// and JS parts of cache_ast.go (JSONCache, and JSCache, which only parses
// Yarn PnP manifests: the bundler parses its files through
// logger.parseWithTempLog, which does what a cache miss does). The caches
// are synchronous (Go's mutexes are no-ops here).
import { newDeferLog, DeferLogAll } from "./logger.mjs";
                                                      
import { parseJSON, JSONOptions } from "./json_parser.mjs";
import { parse as parseJS, Options as JSParserOptions } from "./js_parser.mjs";
import { jsFeatureEqual } from "./compat.mjs";
import { decodeUTF8 } from "./fs.mjs";
                                           

// runtime.SourceIndex
const runtimeSourceIndex = 0;

// A string key for a logger.Path (Go uses the struct as a map key).
// Import attributes are null or a sorted list of [key, value] pairs.
const SEP = String.fromCharCode(0);
function importAttributesKey(attrs     )         {
  if (attrs === null || attrs === undefined) return "";
  let key = "";
  for (let i = 0; i < attrs.length; i++) {
    const k = attrs[i][0];
    const v = attrs[i][1];
    key += k.length + ":" + k + v.length + ":" + v;
  }
  return key;
}
export function pathKey(path      )         {
  return path.namespace + SEP + path.text + SEP + path.ignoredSuffix + SEP + importAttributesKey(path.importAttributes) + SEP + path.flags;
}

// This is a cache of the parsed contents of a set of files. The idea is to be
// able to reuse the results of parsing between builds and make subsequent
// builds faster by avoiding redundant parsing work.
export class CacheSet {
  ;                        
  ;                            
  ;                        
  ;                                          
  constructor() {
    this.fsCache = new FSCache();
    this.jsonCache = new JSONCache();
    this.jsCache = new JSCache();
    this.sourceIndexCache = new SourceIndexCache();
  }
}

export function makeCacheSet()           {
  return new CacheSet();
}

// ---------------------------------------------------------------------------
// SourceIndexCache

// SourceIndexKind
export const SourceIndexNormal = 0;
export const SourceIndexJSStubForCSS = 1;

export class SourceIndexCache {
                                           
                                       
                                  
  constructor() {
    this.globEntries = new Map();
    this.entries = new Map();
    this.nextSourceIndex = runtimeSourceIndex + 1;
  }

  lenHint()         {
    // Add some extra room at the end for a new file or two without reallocating
    const someExtraRoom = 16;
    return this.nextSourceIndex + someExtraRoom;
  }

  get(path      , kind        )         {
    const key = kind + SEP + pathKey(path);
    const sourceIndex = this.entries.get(key);
    if (sourceIndex !== undefined) return sourceIndex;
    const next = this.nextSourceIndex;
    this.nextSourceIndex++;
    this.entries.set(key, next);
    return next;
  }

  getGlob(parentSourceIndex        , globIndex        )         {
    // (Go: (uint64(parentSourceIndex) << 32) | uint64(globIndex); both are
    // uint32 so this key is exact)
    const key = parentSourceIndex * 4294967296 + globIndex;
    const sourceIndex = this.globEntries.get(key);
    if (sourceIndex !== undefined) return sourceIndex;
    const next = this.nextSourceIndex;
    this.nextSourceIndex++;
    this.globEntries.set(key, next);
    return next;
  }
}

// ---------------------------------------------------------------------------
// FSCache: this cache uses information from the "stat" syscall to try to
// avoid re-reading files from the file system during subsequent builds if the
// file hasn't changed.

class fsEntry {
  ;                            
  ;                            // JS-only: the contents decoded as UTF-8
  ;                      
  ;                               
  constructor(contents            , modKey        , isModKeyUsable         ) {
    this.contents = contents;
    this.text = null;
    this.modKey = modKey;
    this.isModKeyUsable = isModKeyUsable;
  }
}

export class FSCache {
  ;                                     
  constructor() {
    this.entries = new Map();
  }

  // Returns [contents (bytes), canonicalError, originalError]
  readFile(fs    , path        )                                {
    const entry = this.readFileEntry(fs, path);
    if (entry instanceof fsEntry) return [entry.contents, null, null];
    return [null, entry[0], entry[1]];
  }

  // JS-only: like readFile, but returns the contents decoded as a Go string
  // (see helpers.decodeGoString). The decoded text is cached with the bytes.
  readFileText(fs    , path        )                     {
    const entry = this.readFileEntry(fs, path);
    if (entry instanceof fsEntry) {
      let text = entry.text;
      if (text === null) text = entry.text = decodeUTF8(entry.contents);
      return [text, null, null];
    }
    return ["", entry[0], entry[1]];
  }

  // Returns the cache entry or [canonicalError, originalError]
  readFileEntry(fs    , path        )                       {
    const entry = this.entries.get(path);

    // If the file's modification key hasn't changed since it was cached, assume
    // the contents of the file are also the same and skip reading the file.
    const mk = fs.modKey(path);
    const modKey = mk[0];
    const modKeyErr = mk[1];
    if (entry !== undefined && entry.isModKeyUsable && modKeyErr === null && entry.modKey.equals(modKey)) {
      return entry;
    }

    const r = fs.readFile(path);
    if (r[1] !== null) return [r[1], r[2]];

    const newEntry = new fsEntry(r[0]              , modKey, modKeyErr === null);
    this.entries.set(path, newEntry);
    return newEntry;
  }
}

// ---------------------------------------------------------------------------
// JSONCache

class jsonCacheEntry {
  ;                 
  ;                   
  ;                      
  ;                            
  ;                   
  constructor(expr     , msgs       , source        , options             , ok         ) {
    this.expr = expr;
    this.msgs = msgs;
    this.source = source;
    this.options = options;
    this.ok = ok;
  }
}

// Go's "entry.source == source" (logger.Source is compared field by field)
function sourcesEqual(a        , b        )          {
  return (
    a.contents === b.contents &&
    a.index === b.index &&
    a.identifierName === b.identifierName &&
    a.prettyPaths.abs === b.prettyPaths.abs &&
    a.prettyPaths.rel === b.prettyPaths.rel &&
    pathKey(a.keyPath) === pathKey(b.keyPath)
  );
}

function jsonOptionsEqual(a             , b             )          {
  return (
    a.flavor === b.flavor &&
    a.errorSuffix === b.errorSuffix &&
    a.isForDefine === b.isForDefine &&
    jsFeatureEqual(a.unsupportedJSFeatures, b.unsupportedJSFeatures)
  );
}

export class JSONCache {
  ;                                            
  constructor() {
    this.entries = new Map();
  }

  // Returns [expr, ok]
  parse(log     , source        , options             )                 {
    // Check the cache
    const key = pathKey(source.keyPath);
    const entry = this.entries.get(key);

    // Cache hit
    if (entry !== undefined && sourcesEqual(entry.source, source) && jsonOptionsEqual(entry.options, options)) {
      for (const msg of entry.msgs) {
        log.addMsg(msg);
      }
      return [entry.expr, entry.ok];
    }

    // Cache miss
    const tempLog = newDeferLog(DeferLogAll, log.overrides);
    const r = parseJSON(tempLog, source, options);
    const msgs = tempLog.done();
    for (const msg of msgs) {
      log.addMsg(msg);
    }

    // Save for next time
    this.entries.set(key, new jsonCacheEntry(r[0], msgs, source, options, r[1]));
    return r;
  }
}

// ---------------------------------------------------------------------------
// JSCache

class jsCacheEntry {
  ;                      
  ;                   
  ;                                
  ;                
  ;                   
  constructor(source        , msgs       , options                 , ast     , ok         ) {
    this.source = source;
    this.msgs = msgs;
    this.options = options;
    this.ast = ast;
    this.ok = ok;
  }
}

export class JSCache {
  ;                                          
  constructor() {
    this.entries = new Map();
  }

  // Returns [ast, ok]. (Only Yarn PnP manifests are parsed through this, all
  // with js_parser.OptionsForYarnPnP(), so "options.Equal" compares that.)
  parse(log     , source        , options                 )                 {
    // Check the cache
    const key = pathKey(source.keyPath);
    const entry = this.entries.get(key);

    // Cache hit
    if (entry !== undefined && sourcesEqual(entry.source, source) && entry.options.decodeHydrateRuntimeStateYarnPnP === options.decodeHydrateRuntimeStateYarnPnP) {
      for (const msg of entry.msgs) {
        log.addMsg(msg);
      }
      return [entry.ast, entry.ok];
    }

    // Cache miss
    const tempLog = newDeferLog(DeferLogAll, log.overrides);
    const r = parseJS(tempLog, source, options);
    const msgs = tempLog.done();
    for (const msg of msgs) {
      log.addMsg(msg);
    }

    // Save for next time
    this.entries.set(key, new jsCacheEntry(source, msgs, options, r[0], r[1]));
    return r;
  }
}
// generated from cache.mts by tools/ts-build.mjs; edit that file
