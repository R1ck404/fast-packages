// Port of Go's net/http.DetectContentType (net/http/sniff.go), used by
// esbuild's guessMimeType for the "base64" and "dataurl" loaders when the
// file extension has no known MIME type. The data is a byte string (one
// character per byte).

const sniffLen = 512;

// isWS reports whether the provided byte is a whitespace byte (0xWS)
// as defined in https://mimesniff.spec.whatwg.org/#terminology.
function isWS(b: number): boolean {
  return b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;
}

// isTT reports whether the provided byte is a tag-terminating byte (0xTT)
// as defined in https://mimesniff.spec.whatwg.org/#terminology.
function isTT(b: number): boolean {
  return b === 0x20 || b === 0x3e;
}

function bytesOf(...values: (number | string)[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number") out.push(v);
    else for (let i = 0; i < v.length; i++) out.push(v.charCodeAt(i));
  }
  return out;
}

interface sniffSig {
  match(data: string, firstNonWS: number): string;
}

class exactSig implements sniffSig {
  declare sig: number[];
  declare ct: string;
  constructor(sig: number[], ct: string) {
    this.sig = sig;
    this.ct = ct;
  }
  match(data: string, firstNonWS: number): string {
    if (data.length < this.sig.length) return "";
    for (let i = 0; i < this.sig.length; i++) if (data.charCodeAt(i) !== this.sig[i]) return "";
    return this.ct;
  }
}

class maskedSig implements sniffSig {
  declare mask: number[];
  declare pat: number[];
  declare skipWS: boolean;
  declare ct: string;
  constructor(mask: number[], pat: number[], skipWS: boolean, ct: string) {
    this.mask = mask;
    this.pat = pat;
    this.skipWS = skipWS;
    this.ct = ct;
  }
  match(data: string, firstNonWS: number): string {
    // pattern matching algorithm section 6
    // https://mimesniff.spec.whatwg.org/#pattern-matching-algorithm
    if (this.skipWS) {
      data = data.slice(firstNonWS);
    }
    if (this.pat.length !== this.mask.length) {
      return "";
    }
    if (data.length < this.pat.length) {
      return "";
    }
    for (let i = 0; i < this.pat.length; i++) {
      const maskedData = data.charCodeAt(i) & this.mask[i];
      if (maskedData !== this.pat[i]) {
        return "";
      }
    }
    return this.ct;
  }
}

class htmlSig implements sniffSig {
  declare h: number[];
  constructor(h: string) {
    this.h = bytesOf(h);
  }
  match(data: string, firstNonWS: number): string {
    data = data.slice(firstNonWS);
    const h = this.h;
    if (data.length < h.length + 1) {
      return "";
    }
    for (let i = 0; i < h.length; i++) {
      const b = h[i];
      let db = data.charCodeAt(i);
      if (b >= 65 && b <= 90) {
        db &= 0xdf;
      }
      if (b !== db) {
        return "";
      }
    }
    // Next byte must be a tag-terminating byte(0xTT).
    if (!isTT(data.charCodeAt(h.length))) {
      return "";
    }
    return "text/html; charset=utf-8";
  }
}

class mp4Sig implements sniffSig {
  match(data: string, firstNonWS: number): string {
    // https://mimesniff.spec.whatwg.org/#signature-for-mp4
    // c.f. section 6.2.1
    if (data.length < 12) {
      return "";
    }
    const boxSize = ((data.charCodeAt(0) << 24) | (data.charCodeAt(1) << 16) | (data.charCodeAt(2) << 8) | data.charCodeAt(3)) >>> 0;
    if (data.length < boxSize || boxSize % 4 !== 0) {
      return "";
    }
    if (data.slice(4, 8) !== "ftyp") {
      return "";
    }
    for (let st = 8; st < boxSize; st += 4) {
      if (st === 12) {
        // Ignores the four bytes that correspond to the version number of the "major brand".
        continue;
      }
      if (data.slice(st, st + 3) === "mp4") {
        return "video/mp4";
      }
    }
    return "";
  }
}

class textSig implements sniffSig {
  match(data: string, firstNonWS: number): string {
    // c.f. section 5, step 4.
    for (let i = firstNonWS; i < data.length; i++) {
      const b = data.charCodeAt(i);
      if (b <= 0x08 || b === 0x0b || (b >= 0x0e && b <= 0x1a) || (b >= 0x1c && b <= 0x1f)) {
        return "";
      }
    }
    return "text/plain; charset=utf-8";
  }
}

const FF = 0xff;
const sniffSignatures: sniffSig[] = [
  new htmlSig("<!DOCTYPE HTML"),
  new htmlSig("<HTML"),
  new htmlSig("<HEAD"),
  new htmlSig("<SCRIPT"),
  new htmlSig("<IFRAME"),
  new htmlSig("<H1"),
  new htmlSig("<DIV"),
  new htmlSig("<FONT"),
  new htmlSig("<TABLE"),
  new htmlSig("<A"),
  new htmlSig("<STYLE"),
  new htmlSig("<TITLE"),
  new htmlSig("<B"),
  new htmlSig("<BODY"),
  new htmlSig("<BR"),
  new htmlSig("<P"),
  new htmlSig("<!--"),
  new maskedSig([FF, FF, FF, FF, FF], bytesOf("<?xml"), true, "text/xml; charset=utf-8"),
  new exactSig(bytesOf("%PDF-"), "application/pdf"),
  new exactSig(bytesOf("%!PS-Adobe-"), "application/postscript"),

  // UTF BOMs.
  new maskedSig([FF, FF, 0, 0], [0xfe, 0xff, 0, 0], false, "text/plain; charset=utf-16be"),
  new maskedSig([FF, FF, 0, 0], [0xff, 0xfe, 0, 0], false, "text/plain; charset=utf-16le"),
  new maskedSig([FF, FF, FF, 0], [0xef, 0xbb, 0xbf, 0], false, "text/plain; charset=utf-8"),

  // Image types
  new exactSig([0, 0, 1, 0], "image/x-icon"),
  new exactSig([0, 0, 2, 0], "image/x-icon"),
  new exactSig(bytesOf("BM"), "image/bmp"),
  new exactSig(bytesOf("GIF87a"), "image/gif"),
  new exactSig(bytesOf("GIF89a"), "image/gif"),
  new maskedSig([FF, FF, FF, FF, 0, 0, 0, 0, FF, FF, FF, FF, FF, FF], bytesOf("RIFF", 0, 0, 0, 0, "WEBPVP"), false, "image/webp"),
  new exactSig(bytesOf(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a), "image/png"),
  new exactSig([0xff, 0xd8, 0xff], "image/jpeg"),

  // Audio and Video types
  // Enforce the pattern match ordering as prescribed in
  // https://mimesniff.spec.whatwg.org/#matching-an-audio-or-video-type-pattern
  new maskedSig([FF, FF, FF, FF], bytesOf(".snd"), false, "audio/basic"),
  new maskedSig([FF, FF, FF, FF, 0, 0, 0, 0, FF, FF, FF, FF], bytesOf("FORM", 0, 0, 0, 0, "AIFF"), false, "audio/aiff"),
  new maskedSig([FF, FF, FF], bytesOf("ID3"), false, "audio/mpeg"),
  new maskedSig([FF, FF, FF, FF, FF], bytesOf("OggS", 0), false, "application/ogg"),
  new maskedSig([FF, FF, FF, FF, FF, FF, FF, FF], bytesOf("MThd", 0, 0, 0, 6), false, "audio/midi"),
  new maskedSig([FF, FF, FF, FF, 0, 0, 0, 0, FF, FF, FF, FF], bytesOf("RIFF", 0, 0, 0, 0, "AVI "), false, "video/avi"),
  new maskedSig([FF, FF, FF, FF, 0, 0, 0, 0, FF, FF, FF, FF], bytesOf("RIFF", 0, 0, 0, 0, "WAVE"), false, "audio/wave"),
  // 6.2.0.2. video/mp4
  new mp4Sig(),
  // 6.2.0.3. video/webm
  new exactSig([0x1a, 0x45, 0xdf, 0xa3], "video/webm"),

  // Font types
  // (34 NULL bytes followed by the string "LP", with a mask of 34 NULL bytes
  // followed by \xFF\xFF)
  new maskedSig(new Array(34).fill(0).concat([FF, FF]), new Array(34).fill(0).concat(bytesOf("LP")), false, "application/vnd.ms-fontobject"),
  new exactSig([0, 1, 0, 0], "font/ttf"),
  new exactSig(bytesOf("OTTO"), "font/otf"),
  new exactSig(bytesOf("ttcf"), "font/collection"),
  new exactSig(bytesOf("wOFF"), "font/woff"),
  new exactSig(bytesOf("wOF2"), "font/woff2"),

  // Archive types
  new exactSig([0x1f, 0x8b, 0x08], "application/x-gzip"),
  new exactSig(bytesOf("PK", 3, 4), "application/zip"),
  // RAR's signatures are incorrectly defined by the MIME spec as per
  //    https://github.com/whatwg/mimesniff/issues/63
  // However, RAR Labs correctly defines it at:
  //    https://www.rarlab.com/technote.htm#rarsign
  // so we use the definition from RAR Labs.
  new exactSig(bytesOf("Rar!", 0x1a, 0x07, 0x00), "application/x-rar-compressed"), // RAR v1.5-v4.0
  new exactSig(bytesOf("Rar!", 0x1a, 0x07, 0x01, 0x00), "application/x-rar-compressed"), // RAR v5+

  new exactSig([0x00, 0x61, 0x73, 0x6d], "application/wasm"),

  new textSig(), // should be last
];

export function detectContentType(data: string): string {
  if (data.length > sniffLen) {
    data = data.slice(0, sniffLen);
  }

  // Index of the first non-whitespace byte in data.
  let firstNonWS = 0;
  for (; firstNonWS < data.length && isWS(data.charCodeAt(firstNonWS)); firstNonWS++) {}

  for (const sig of sniffSignatures) {
    const ct = sig.match(data, firstNonWS);
    if (ct !== "") {
      return ct;
    }
  }

  return "application/octet-stream"; // fallback
}
