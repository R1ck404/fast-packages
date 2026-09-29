// pkg/api/api_impl.go's validators that convert the public API's enums
// (cli.mts, Go's values) into the internal ones (config, logger, compat):
// validateColor, validateLogLevel, validateLogStyle, validateLogOverrides,
// validateSourceMap, validateLegalComments, validateASCIIOnly,
// validateTreeShaking, validatePlatform, validateFormat, validateLoader,
// validateExternalPackages, extractPathStyle, and api_js_table.go
// convertEngineName.

import * as api from "./cli.mjs";
import * as config from "./config.mjs";
import * as logger from "./logger.mjs";
import * as compat from "./compat.mjs";

export function validateColor(value        )         {
  switch (value) {
    case api.ColorIfTerminal:
      return logger.ColorIfTerminal;
    case api.ColorNever:
      return logger.ColorNever;
    case api.ColorAlways:
      return logger.ColorAlways;
  }
  throw new Error("Invalid color");
}

export function validateLogLevel(value        )         {
  switch (value) {
    case api.LogLevelVerbose:
      return logger.LevelVerbose;
    case api.LogLevelDebug:
      return logger.LevelDebug;
    case api.LogLevelInfo:
      return logger.LevelInfo;
    case api.LogLevelWarning:
      return logger.LevelWarning;
    case api.LogLevelError:
      return logger.LevelError;
    case api.LogLevelSilent:
      return logger.LevelSilent;
  }
  throw new Error("Invalid log level");
}

export function validateLogStyle(value        )         {
  switch (value) {
    case api.LogStyleDefault:
      return logger.StyleDefault;
    case api.LogStyleVisualStudio:
      return logger.StyleVisualStudio;
  }
  throw new Error("Invalid log style");
}

// (null for an empty map, like Go's nil)
export function validateLogOverrides(input                     )                             {
  let output                             = null;
  for (const [k, v] of input) {
    if (output === null) output = new Map();
    logger.stringToMsgIDs(k, validateLogLevel(v), output);
  }
  return output;
}

export function extractPathStyle(absPaths        , flag        )         {
  if ((absPaths & flag) !== 0) {
    return logger.AbsPath;
  }
  return logger.RelPath;
}

export function validateSourceMap(value        )         {
  switch (value) {
    case api.SourceMapNone:
      return config.SourceMapNone;
    case api.SourceMapLinked:
      return config.SourceMapLinkedWithComment;
    case api.SourceMapInline:
      return config.SourceMapInline;
    case api.SourceMapExternal:
      return config.SourceMapExternalWithoutComment;
    case api.SourceMapInlineAndExternal:
      return config.SourceMapInlineAndExternal;
  }
  throw new Error("Invalid source map");
}

export function validateLegalComments(value        , bundle         )         {
  switch (value) {
    case api.LegalCommentsDefault:
      if (bundle) {
        return config.LegalCommentsEndOfFile;
      } else {
        return config.LegalCommentsInline;
      }
    case api.LegalCommentsNone:
      return config.LegalCommentsNone;
    case api.LegalCommentsInline:
      return config.LegalCommentsInline;
    case api.LegalCommentsEndOfFile:
      return config.LegalCommentsEndOfFile;
    case api.LegalCommentsLinked:
      return config.LegalCommentsLinkedWithComment;
    case api.LegalCommentsExternal:
      return config.LegalCommentsExternalWithoutComment;
  }
  throw new Error("Invalid source map");
}

export function validateASCIIOnly(value        )          {
  switch (value) {
    case api.CharsetDefault:
    case api.CharsetASCII:
      return true;
    case api.CharsetUTF8:
      return false;
  }
  throw new Error("Invalid charset");
}

export function validateExternalPackages(value        )          {
  switch (value) {
    case api.PackagesDefault:
    case api.PackagesBundle:
      return false;
    case api.PackagesExternal:
      return true;
  }
  throw new Error("Invalid packages");
}

export function validateTreeShaking(value        , bundle         , format        )          {
  switch (value) {
    case api.TreeShakingDefault:
      // If we're in an IIFE then there's no way to concatenate additional code
      // to the end of our output so we assume tree shaking is safe. And when
      // bundling we assume that tree shaking is safe because if you want to add
      // code to the bundle, you should be doing that by including it in the
      // bundle instead of concatenating it afterward, so we also assume tree
      // shaking is safe then. Otherwise we assume tree shaking is not safe.
      return bundle || format === api.FormatIIFE;
    case api.TreeShakingFalse:
      return false;
    case api.TreeShakingTrue:
      return true;
  }
  throw new Error("Invalid tree shaking");
}

export function validatePlatform(value        )         {
  switch (value) {
    case api.PlatformDefault:
    case api.PlatformBrowser:
      return config.PlatformBrowser;
    case api.PlatformNode:
      return config.PlatformNode;
    case api.PlatformNeutral:
      return config.PlatformNeutral;
  }
  throw new Error("Invalid platform");
}

export function validateFormat(value        )         {
  switch (value) {
    case api.FormatDefault:
      return config.FormatPreserve;
    case api.FormatIIFE:
      return config.FormatIIFE;
    case api.FormatCommonJS:
      return config.FormatCommonJS;
    case api.FormatESModule:
      return config.FormatESModule;
  }
  throw new Error("Invalid format");
}

export function validateLoader(value        )         {
  switch (value) {
    case api.LoaderBase64:
      return config.LoaderBase64;
    case api.LoaderBinary:
      return config.LoaderBinary;
    case api.LoaderCopy:
      return config.LoaderCopy;
    case api.LoaderCSS:
      return config.LoaderCSS;
    case api.LoaderDataURL:
      return config.LoaderDataURL;
    case api.LoaderDefault:
      return config.LoaderDefault;
    case api.LoaderEmpty:
      return config.LoaderEmpty;
    case api.LoaderFile:
      return config.LoaderFile;
    case api.LoaderGlobalCSS:
      return config.LoaderGlobalCSS;
    case api.LoaderJS:
      return config.LoaderJS;
    case api.LoaderJSON:
      return config.LoaderJSON;
    case api.LoaderJSX:
      return config.LoaderJSX;
    case api.LoaderLocalCSS:
      return config.LoaderLocalCSS;
    case api.LoaderNone:
      return config.LoaderNone;
    case api.LoaderText:
      return config.LoaderText;
    case api.LoaderTS:
      return config.LoaderTS;
    case api.LoaderTSX:
      return config.LoaderTSX;
  }
  throw new Error("Invalid loader");
}

// api_js_table.go convertEngineName
export function convertEngineName(engine        )         {
  switch (engine) {
    case api.EngineChrome:
      return compat.Chrome;
    case api.EngineDeno:
      return compat.Deno;
    case api.EngineEdge:
      return compat.Edge;
    case api.EngineFirefox:
      return compat.Firefox;
    case api.EngineHermes:
      return compat.Hermes;
    case api.EngineIE:
      return compat.IE;
    case api.EngineIOS:
      return compat.IOS;
    case api.EngineNode:
      return compat.Node;
    case api.EngineOpera:
      return compat.Opera;
    case api.EngineRhino:
      return compat.Rhino;
    case api.EngineSafari:
      return compat.Safari;
  }
  throw new Error("Invalid engine name");
}

// The api.Target as transform.mts's validateFeatures takes it: the ES
// edition (0 = default, -1 = esnext, 5 = es5, 2015... = es2015...)
export function targetEdition(target        )         {
  switch (target) {
    case api.DefaultTarget:
      return 0;
    case api.ESNext:
      return -1;
    case api.ES5:
      return 5;
  }
  return 2015 + (target - api.ES2015);
}

// The engines as validateFeatures takes them: [compat engine, version]
export function engineList(engines              )                     {
  return engines.map((e) => [convertEngineName(e.name), e.version]);
}

// logger.OutputOptions as api_impl.go builds it for the log of a transform
// or a build (IncludeSource: true)
export function outputOptionsFor(o                                                                                                                             )                       {
  return new logger.OutputOptions(
    o.logLimit,
    true,
    validateColor(o.color),
    validateLogLevel(o.logLevel),
    validateLogStyle(o.logStyle),
    extractPathStyle(o.absPaths, api.LogAbsPath),
    validateLogOverrides(o.logOverride),
  );
}
// generated from api_validate.mts by tools/ts-build.mjs; edit that file
