// Port of internal/js_parser/sourcemap_parser.go (ParseSourceMap)
import { goQuote, goSortStable, goInt32FromFloat } from "./gostd.mjs";
import { Source, Range, LineColumnTracker, Warning, MsgID_SourceMap_InvalidSourceMappings } from "./logger.mjs";
import { E_OBJECT, E_ARRAY, E_STRING, E_NUMBER } from "./js_ast.mjs";
import { parseJSON, JSONOptions } from "./json_parser.mjs";
import { SourceMap, SourceContent, Mapping } from "./sourcemap.mjs";
import { parseGoURL, fileURLFromFilePath } from "./gourl.mjs";

const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const base64IndexOfByte = new Int8Array(256).fill(-1);
for (let i = 0; i < 64; i++) base64IndexOfByte[base64.charCodeAt(i)] = i;

// sourcemap.DecodeVLQUTF16 on encoded[start:]. Returns [value, length, ok]
// (the module-level result avoids allocations).
let vlqValue = 0;
let vlqLength = 0;
function decodeVLQUTF16(encoded        , start        )          {
  const n = encoded.length - start;
  if (n <= 0) {
    vlqValue = 0;
    vlqLength = 0;
    return false;
  }

  // Scan over the input
  let current = 0;
  let shift = 0;
  let vlq = 0;
  for (;;) {
    if (current >= n) {
      vlqValue = 0;
      vlqLength = 0;
      return false;
    }
    // (Go: strings.IndexByte(base64, byte(encoded[current])), so only the low
    // byte of the UTF-16 code unit counts)
    const index = base64IndexOfByte[encoded.charCodeAt(start + current) & 0xff];
    if (index < 0) {
      vlqValue = 0;
      vlqLength = 0;
      return false;
    }

    // Decode a single byte (Go: a shift of 32 or more gives 0)
    if (shift < 32) vlq |= (index & 31) << shift;
    current++;
    shift += 5;

    // Stop if there's no continuation bit
    if ((index & 32) === 0) {
      break;
    }
  }

  // Recover the value
  let value = vlq >> 1;
  if ((vlq & 1) !== 0) {
    value = -value | 0;
  }
  vlqValue = value;
  vlqLength = current;
  return true;
}

class sourceMapSection {
  ;                          
  ;                            
  ;                      
  constructor(lineOffset        , columnOffset        , sourceMap     ) {
    this.lineOffset = lineOffset;
    this.columnOffset = columnOffset;
    this.sourceMap = sourceMap;
  }
}

// Go's int32(float64) for the offsets (on wasm: a saturating conversion to
// int64, then the low 32 bits)
function toInt32(value        )         {
  return goInt32FromFloat(value);
}

// New specification: https://tc39.es/ecma426/
// Old specification: https://sourcemaps.info/spec.html
export function parseSourceMap(log     , source        )                   {
  const $j = parseJSON(log, source, new JSONOptions(undefined, undefined, " in source map"));
  if (!$j[1]) {
    return null;
  }
  const expr = $j[0];

  const tracker = new LineColumnTracker(source);
  if (expr.data.k !== E_OBJECT) {
    log.addError(tracker, new Range(expr.loc, 0), "Invalid source map");
    return null;
  }
  const obj = expr.data;

  let sections                     = [];
  let hasSections = false;

  for (const prop of obj.properties) {
    if (prop.key.data.value !== "sections") {
      continue;
    }

    if (prop.valueOrNil.data.k === E_ARRAY) {
      for (const item of prop.valueOrNil.data.items) {
        if (item.data.k === E_OBJECT) {
          let sectionLineOffset = 0;
          let sectionColumnOffset = 0;
          let sectionSourceMap = null;

          for (const sectionProp of item.data.properties) {
            switch (sectionProp.key.data.value) {
              case "offset":
                if (sectionProp.valueOrNil.data.k === E_OBJECT) {
                  for (const offsetProp of sectionProp.valueOrNil.data.properties) {
                    switch (offsetProp.key.data.value) {
                      case "line":
                        if (offsetProp.valueOrNil.data.k === E_NUMBER) {
                          sectionLineOffset = toInt32(offsetProp.valueOrNil.data.value);
                        }
                        break;

                      case "column":
                        if (offsetProp.valueOrNil.data.k === E_NUMBER) {
                          sectionColumnOffset = toInt32(offsetProp.valueOrNil.data.value);
                        }
                        break;
                    }
                  }
                } else {
                  log.addError(tracker, new Range(sectionProp.valueOrNil.loc, 0), 'Expected "offset" to be an object');
                  return null;
                }
                break;

              case "map":
                if (sectionProp.valueOrNil.data.k === E_OBJECT) {
                  sectionSourceMap = sectionProp.valueOrNil.data;
                } else {
                  log.addError(tracker, new Range(sectionProp.valueOrNil.loc, 0), 'Expected "map" to be an object');
                  return null;
                }
                break;
            }
          }

          if (sectionSourceMap !== null) {
            sections.push(new sourceMapSection(sectionLineOffset, sectionColumnOffset, sectionSourceMap));
          }
        }
      }
    } else {
      log.addError(tracker, new Range(prop.valueOrNil.loc, 0), 'Expected "sections" to be an array');
      return null;
    }

    hasSections = true;
    break;
  }

  if (!hasSections) {
    sections.push(new sourceMapSection(0, 0, obj));
  }

  const sources           = [];
  const sourcesContent                  = [];
  const names           = [];
  const mappings            = [];
  let generatedLine = 0;
  let generatedColumn = 0;
  let needSort = false;

  for (const section of sections) {
    let sourcesArray = null;
    let sourcesContentArray = null;
    let namesArray = null;
    let mappingsRaw = "";
    let mappingsStart = 0;
    let sourceRoot = "";
    let hasVersion = false;

    for (const prop of section.sourceMap.properties) {
      switch (prop.key.data.value) {
        case "version":
          if (prop.valueOrNil.data.k === E_NUMBER && prop.valueOrNil.data.value === 3) {
            hasVersion = true;
          }
          break;

        case "mappings":
          if (prop.valueOrNil.data.k === E_STRING) {
            mappingsRaw = prop.valueOrNil.data.value;
            mappingsStart = prop.valueOrNil.loc + 1;
          }
          break;

        case "sourceRoot":
          if (prop.valueOrNil.data.k === E_STRING) {
            sourceRoot = prop.valueOrNil.data.value;
          }
          break;

        case "sources":
          if (prop.valueOrNil.data.k === E_ARRAY) {
            sourcesArray = prop.valueOrNil.data.items;
          }
          break;

        case "sourcesContent":
          if (prop.valueOrNil.data.k === E_ARRAY) {
            sourcesContentArray = prop.valueOrNil.data.items;
          }
          break;

        case "names":
          if (prop.valueOrNil.data.k === E_ARRAY) {
            namesArray = prop.valueOrNil.data.items;
          }
          break;
      }
    }

    // Silently ignore the section if the version was missing or incorrect
    if (!hasVersion) {
      continue;
    }

    const mappingsLen = mappingsRaw.length;
    const sourcesLen = sourcesArray === null ? 0 : sourcesArray.length;
    const namesLen = namesArray === null ? 0 : namesArray.length;

    // Silently ignore the section if the source map is pointless (i.e. empty)
    if (mappingsLen === 0 || sourcesLen === 0) {
      continue;
    }

    if (section.lineOffset < generatedLine || (section.lineOffset === generatedLine && section.columnOffset < generatedColumn)) {
      needSort = true;
    }

    const lineOffset = section.lineOffset;
    const columnOffset = section.columnOffset;
    const sourceOffset = sources.length;
    const nameOffset = names.length;

    generatedLine = lineOffset;
    generatedColumn = columnOffset;
    let sourceIndex = sourceOffset;
    let originalLine = 0;
    let originalColumn = 0;
    let originalName = nameOffset;

    let current = 0;
    let errorText = "";
    let errorLen = 0;

    // Parse the mappings
    while (current < mappingsLen) {
      // Handle a line break
      if (mappingsRaw.charCodeAt(current) === 59 /* ; */) {
        generatedLine = (generatedLine + 1) | 0;
        generatedColumn = 0;
        current++;
        continue;
      }

      // Read the generated column
      if (!decodeVLQUTF16(mappingsRaw, current)) {
        errorText = "Missing generated column";
        errorLen = vlqLength;
        break;
      }
      const generatedColumnDelta = vlqValue;
      if (generatedColumnDelta < 0) {
        // This would mess up binary search
        needSort = true;
      }
      generatedColumn = (generatedColumn + generatedColumnDelta) | 0;
      if ((generatedLine === lineOffset && generatedColumn < columnOffset) || generatedColumn < 0) {
        errorText = "Invalid generated column value: " + generatedColumn;
        errorLen = vlqLength;
        break;
      }
      current += vlqLength;

      // According to the specification, it's valid for a mapping to have 1,
      // 4, or 5 variable-length fields. Having one field means there's no
      // original location information, which is pretty useless. Just ignore
      // those entries.
      if (current === mappingsLen) {
        break;
      }
      const c = mappingsRaw.charCodeAt(current);
      if (c === 44 /* , */) {
        current++;
        continue;
      } else if (c === 59 /* ; */) {
        continue;
      }

      // Read the original source
      if (!decodeVLQUTF16(mappingsRaw, current)) {
        errorText = "Missing source index";
        errorLen = vlqLength;
        break;
      }
      sourceIndex = (sourceIndex + vlqValue) | 0;
      if (sourceIndex < sourceOffset || sourceIndex >= sourceOffset + sourcesLen) {
        errorText = "Invalid source index value: " + sourceIndex;
        errorLen = vlqLength;
        break;
      }
      current += vlqLength;

      // Read the original line
      if (!decodeVLQUTF16(mappingsRaw, current)) {
        errorText = "Missing original line";
        errorLen = vlqLength;
        break;
      }
      originalLine = (originalLine + vlqValue) | 0;
      if (originalLine < 0) {
        errorText = "Invalid original line value: " + originalLine;
        errorLen = vlqLength;
        break;
      }
      current += vlqLength;

      // Read the original column
      if (!decodeVLQUTF16(mappingsRaw, current)) {
        errorText = "Missing original column";
        errorLen = vlqLength;
        break;
      }
      originalColumn = (originalColumn + vlqValue) | 0;
      if (originalColumn < 0) {
        errorText = "Invalid original column value: " + originalColumn;
        errorLen = vlqLength;
        break;
      }
      current += vlqLength;

      // Read the original name
      let optionalName = -1;
      if (decodeVLQUTF16(mappingsRaw, current)) {
        originalName = (originalName + vlqValue) | 0;
        if (originalName < nameOffset || originalName >= nameOffset + namesLen) {
          errorText = "Invalid name index value: " + originalName;
          errorLen = vlqLength;
          break;
        }
        optionalName = originalName;
        current += vlqLength;
      }

      // Handle the next character
      if (current < mappingsLen) {
        const c2 = mappingsRaw.charCodeAt(current);
        if (c2 === 44 /* , */) {
          current++;
        } else if (c2 !== 59 /* ; */) {
          errorText = "Invalid character after mapping: " + goQuote(mappingsRaw.slice(current, current + 1));
          errorLen = 1;
          break;
        }
      }

      mappings.push(new Mapping(generatedLine, generatedColumn, sourceIndex, originalLine, originalColumn, optionalName));
    }

    if (errorText !== "") {
      const r = new Range(mappingsStart + current, errorLen);
      log.addID(MsgID_SourceMap_InvalidSourceMappings, Warning, tracker, r, 'Bad "mappings" data in source map at character ' + current + ": " + errorText);
      return null;
    }

    // Try resolving relative source URLs into absolute source URLs.
    // See https://tc39.es/ecma426/#resolving-sources for details.
    let sourceURLPrefix = "";
    let baseURL = null;
    if (sourceRoot !== "") {
      const index = sourceRoot.lastIndexOf("/");
      if (index !== -1) {
        sourceURLPrefix = sourceRoot.slice(0, index + 1);
      } else {
        sourceURLPrefix = sourceRoot + "/";
      }
    }
    if (source.keyPath.namespace === "file") {
      baseURL = fileURLFromFilePath(source.keyPath.text);
    }

    for (const item of sourcesArray) {
      if (item.data.k === E_STRING) {
        const sourcePath = sourceURLPrefix + item.data.value;
        let sourceURL = parseGoURL(sourcePath);

        // Ignore URL parse errors (such as "%XY" being an invalid escape)
        if (sourceURL === null) {
          sources.push(sourcePath);
          continue;
        }

        // Resolve this URL relative to the enclosing directory
        if (baseURL !== null) {
          sourceURL = baseURL.resolveReference(sourceURL);
        }
        sources.push(sourceURL.toString());
      } else {
        sources.push("");
      }
    }

    if (sourcesContentArray !== null && sourcesContentArray.length > 0) {
      // It's possible that one of the source maps inside "sections" has
      // different lengths for the "sources" and "sourcesContent" arrays.
      // This is bad because we need to us a single index to get the name
      // of the source from "sources[i]" and the content of the source
      // from "sourcesContent[i]".
      //
      // So if a previous source map had a shorter "sourcesContent" array
      // than its "sources" array (or if the previous source map just had
      // no "sourcesContent" array), expand our aggregated array to the
      // right length by padding it out with empty entries.
      while (sourcesContent.length < sourceOffset) sourcesContent.push(new SourceContent());

      for (let i = 0; i < sourcesContentArray.length; i++) {
        // Make sure we don't ever record more "sourcesContent" entries
        // than there are "sources" entries, which is possible because
        // these are two separate arrays in the source map JSON. We need
        // to avoid this because that would mess up our shared indexing
        // of the "sources" and "sourcesContent" arrays. See the above
        // comment for more details.
        if (i === sourcesLen) {
          break;
        }

        const item = sourcesContentArray[i];
        if (item.data.k === E_STRING) {
          sourcesContent.push(new SourceContent(source.textForRange(source.rangeOfString(item.loc)), item.data.value));
        } else {
          sourcesContent.push(new SourceContent());
        }
      }
    }

    if (namesArray !== null) {
      for (const item of namesArray) {
        if (item.data.k === E_STRING) {
          names.push(item.data.value);
        } else {
          names.push("");
        }
      }
    }
  }

  // Silently fail if the source map is pointless (i.e. empty)
  if (sources.length === 0 || mappings.length === 0) {
    return null;
  }

  if (needSort) {
    // If we get here, some mappings are out of order. Lines can't be out of
    // order by construction but columns can. This is a pretty rare situation
    // because almost all source map generators always write out mappings in
    // order as they write the output instead of scrambling the order.
    // (mappingArray.Less is not strict: Go's exact algorithm decides the
    // order of equal positions)
    goSortStable(mappings, (ai, aj) => ai.generatedLine < aj.generatedLine || (ai.generatedLine === aj.generatedLine && ai.generatedColumn <= aj.generatedColumn));
  }

  return new SourceMap(sources, sourcesContent, mappings, names);
}
// generated from sourcemap_parser.mts by tools/ts-build.mjs; edit that file
