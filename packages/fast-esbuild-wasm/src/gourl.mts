// A port of the parts of Go's net/url that esbuild uses for source maps
// (url.Parse, URL.ResolveReference, URL.String, URL.EscapedPath) plus
// esbuild's helpers.IsFileURL / FileURLFromFilePath / FilePathFromFileURL.
// Strings are JS strings; Go works on the bytes, so escaping and unescaping
// go through helpers.goStringBytes / decodeGoString. Hosts are checked
// like go1.26.5 (IP literals through net/netip's ParseAddr); esbuild's
// go.mod says "go 1.13", so the GODEBUG default urlstrictcolons=0 applies.
import { goStringBytes, decodeGoString } from "./helpers.mjs";
import { goQuote, goQuoteBytes } from "./gostd.mjs";

// The text of the error of the last failed parseGoURL (url.Error.Error())
export let lastURLParseError = "";
// (the inner error of the failing step)
let urlErr = "";

// url.EscapeError for the escape at s[i:] (at most 3 bytes)
function escapeError(s: string, i: number): string {
  return "invalid URL escape " + goQuoteBytes(goStringBytes(s.slice(i, i + 3)).subarray(0, 3));
}

// encoding
const encodePath = 1;
const encodePathSegment = 2;
const encodeHost = 3;
const encodeZone = 4;
const encodeUserPassword = 5;
const encodeQueryComponent = 6;
const encodeFragment = 7;

// url.Userinfo (immutable)
export class Userinfo {
  declare username: string;
  declare password: string;
  declare passwordSet: boolean;
  constructor(username: string, password: string, passwordSet: boolean) {
    this.username = username;
    this.password = password;
    this.passwordSet = passwordSet;
  }
  toString(): string {
    let s = escape(this.username, encodeUserPassword);
    if (this.passwordSet) {
      s += ":" + escape(this.password, encodeUserPassword);
    }
    return s;
  }
}

export class GoURL {
  declare scheme: string;
  declare opaque: string;
  declare user: Userinfo | null;
  declare host: string;
  declare path: string;
  declare rawPath: string;
  declare omitHost: boolean;
  declare forceQuery: boolean;
  declare rawQuery: string;
  declare fragment: string;
  declare rawFragment: string;
  constructor() {
    this.scheme = "";
    this.opaque = "";
    this.user = null;
    this.host = "";
    this.path = "";
    this.rawPath = "";
    this.omitHost = false;
    this.forceQuery = false;
    this.rawQuery = "";
    this.fragment = "";
    this.rawFragment = "";
  }

  clone(): GoURL {
    const u = new GoURL();
    u.scheme = this.scheme;
    u.opaque = this.opaque;
    u.user = this.user;
    u.host = this.host;
    u.path = this.path;
    u.rawPath = this.rawPath;
    u.omitHost = this.omitHost;
    u.forceQuery = this.forceQuery;
    u.rawQuery = this.rawQuery;
    u.fragment = this.fragment;
    u.rawFragment = this.rawFragment;
    return u;
  }

  // setPath sets the Path and RawPath fields of the URL based on the provided
  // escaped path p. Returns false on an error.
  setPath(p: string): boolean {
    const path = unescape(p, encodePath);
    if (path === null) return false;
    this.path = path;
    const escp = escape(path, encodePath);
    if (p === escp) {
      // Default encoding is fine.
      this.rawPath = "";
    } else {
      this.rawPath = p;
    }
    return true;
  }

  escapedPath(): string {
    if (this.rawPath !== "" && validEncoded(this.rawPath, encodePath)) {
      const p = unescape(this.rawPath, encodePath);
      if (p !== null && p === this.path) {
        return this.rawPath;
      }
    }
    if (this.path === "*") {
      return "*"; // don't escape (Issue 11202)
    }
    return escape(this.path, encodePath);
  }

  setFragment(f: string): boolean {
    const frag = unescape(f, encodeFragment);
    if (frag === null) return false;
    this.fragment = frag;
    const escf = escape(frag, encodeFragment);
    if (f === escf) {
      // Default encoding is fine.
      this.rawFragment = "";
    } else {
      this.rawFragment = f;
    }
    return true;
  }

  escapedFragment(): string {
    if (this.rawFragment !== "" && validEncoded(this.rawFragment, encodeFragment)) {
      const f = unescape(this.rawFragment, encodeFragment);
      if (f !== null && f === this.fragment) {
        return this.rawFragment;
      }
    }
    return escape(this.fragment, encodeFragment);
  }

  toString(): string {
    let buf = "";
    if (this.scheme !== "") {
      buf += this.scheme + ":";
    }
    if (this.opaque !== "") {
      buf += this.opaque;
    } else {
      if (this.scheme !== "" || this.host !== "" || this.user !== null) {
        if (this.omitHost && this.host === "" && this.user === null) {
          // Omit empty host
        } else {
          if (this.host !== "" || this.path !== "" || this.user !== null) {
            buf += "//";
          }
          if (this.user !== null) {
            buf += this.user.toString() + "@";
          }
          if (this.host !== "") {
            buf += escape(this.host, encodeHost);
          }
        }
      }
      const path = this.escapedPath();
      if (path !== "" && path[0] !== "/" && this.host !== "") {
        buf += "/";
      }
      if (buf.length === 0) {
        // RFC 3986 Section 4.2. A path segment that contains a colon character (e.g., "this:that")
        // cannot be used as the first segment of a relative-path reference, as it would
        // be mistaken for a scheme name. Such a path segment must be preceded by a
        // dot-segment (e.g., "./this:that") to make a relative-path reference.
        const slash = path.indexOf("/");
        const segment = slash < 0 ? path : path.slice(0, slash);
        if (segment.includes(":")) {
          buf += "./";
        }
      }
      buf += path;
    }
    if (this.forceQuery || this.rawQuery !== "") {
      buf += "?" + this.rawQuery;
    }
    if (this.fragment !== "") {
      buf += "#" + this.escapedFragment();
    }
    return buf;
  }

  // ResolveReference resolves a URI reference to an absolute URI from an
  // absolute base URI u, per RFC 3986 Section 5.2.
  resolveReference(ref: GoURL): GoURL {
    const url = ref.clone();
    if (ref.scheme === "") {
      url.scheme = this.scheme;
    }
    if (ref.scheme !== "" || ref.host !== "" || ref.user !== null) {
      // The "absoluteURI" or "net_path" cases.
      // We can ignore the error from setPath since we know we provided a
      // validly-escaped path.
      url.setPath(resolvePath(ref.escapedPath(), ""));
      return url;
    }
    if (ref.opaque !== "") {
      url.user = null;
      url.host = "";
      url.path = "";
      return url;
    }
    if (ref.path === "" && !ref.forceQuery && ref.rawQuery === "") {
      url.rawQuery = this.rawQuery;
      if (ref.fragment === "") {
        url.fragment = this.fragment;
        url.rawFragment = this.rawFragment;
      }
    }
    if (ref.path === "" && this.opaque !== "") {
      url.opaque = this.opaque;
      url.user = null;
      url.host = "";
      url.path = "";
      return url;
    }
    // The "abs_path" or "rel_path" cases.
    url.host = this.host;
    url.user = this.user;
    url.setPath(resolvePath(this.escapedPath(), ref.escapedPath()));
    return url;
  }
}

// resolvePath applies special path segments from refs and applies
// them to base, per RFC 3986.
function resolvePath(base: string, ref: string): string {
  let full: string;
  if (ref === "") {
    full = base;
  } else if (ref[0] !== "/") {
    const i = base.lastIndexOf("/");
    full = base.slice(0, i + 1) + ref;
  } else {
    full = ref;
  }
  if (full === "") {
    return "";
  }

  let elem = "";
  let dst = "/";
  let first = true;
  let remaining = full;
  let found = true;
  while (found) {
    const i = remaining.indexOf("/");
    if (i < 0) {
      elem = remaining;
      remaining = "";
      found = false;
    } else {
      elem = remaining.slice(0, i);
      remaining = remaining.slice(i + 1);
    }
    if (elem === ".") {
      first = false;
      // drop
      continue;
    }

    if (elem === "..") {
      // Ignore the leading '/' we already wrote.
      const str = dst.slice(1);
      const index = str.lastIndexOf("/");

      dst = "/";
      if (index === -1) {
        first = true;
      } else {
        dst += str.slice(0, index);
      }
    } else {
      if (!first) {
        dst += "/";
      }
      dst += elem;
      first = false;
    }
  }

  if (elem === "." || elem === "..") {
    dst += "/";
  }

  // We wrote an initial '/', but we don't want two.
  let r = dst;
  if (r.length > 1 && r[1] === "/") {
    r = r.slice(1);
  }
  return r;
}

// Parse parses a raw url into a URL structure. Returns null on an error
// (its text is then in lastURLParseError).
export function parseGoURL(rawURL: string): GoURL | null {
  // Cut off #frag
  const hash = rawURL.indexOf("#");
  const u = hash < 0 ? rawURL : rawURL.slice(0, hash);
  const frag = hash < 0 ? "" : rawURL.slice(hash + 1);
  const url = parse(u);
  if (url === null) {
    lastURLParseError = "parse " + goQuote(u) + ": " + urlErr;
    return null;
  }
  if (frag === "") {
    return url;
  }
  if (!url.setFragment(frag)) {
    lastURLParseError = "parse " + goQuote(rawURL) + ": " + urlErr;
    return null;
  }
  return url;
}

function stringContainsCTLByte(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const b = s.charCodeAt(i);
    if (b < 0x20 || b === 0x7f) {
      return true;
    }
  }
  return false;
}

function parse(rawURL: string): GoURL | null {
  if (stringContainsCTLByte(rawURL)) {
    urlErr = "net/url: invalid control character in URL";
    return null;
  }

  const url = new GoURL();

  if (rawURL === "*") {
    url.path = "*";
    return url;
  }

  // Split off possible leading "http:", "mailto:", etc.
  // Cannot contain escaped characters.
  const $s = getScheme(rawURL);
  if ($s === null) return null;
  url.scheme = $s[0].toLowerCase();
  let rest = $s[1];

  if (rest.endsWith("?") && rest.indexOf("?") === rest.length - 1) {
    url.forceQuery = true;
    rest = rest.slice(0, rest.length - 1);
  } else {
    const q = rest.indexOf("?");
    if (q >= 0) {
      url.rawQuery = rest.slice(q + 1);
      rest = rest.slice(0, q);
    }
  }

  if (!rest.startsWith("/")) {
    if (url.scheme !== "") {
      // We consider rootless paths per RFC 3986 as opaque.
      url.opaque = rest;
      return url;
    }

    // Avoid confusion with malformed schemes, like cache_object:foo/bar.
    // See golang.org/issue/16822.
    const slash = rest.indexOf("/");
    const segment = slash < 0 ? rest : rest.slice(0, slash);
    if (segment.includes(":")) {
      // First path segment has colon. Not allowed in relative URL.
      urlErr = "first path segment in URL cannot contain colon";
      return null;
    }
  }

  if ((url.scheme !== "" || !rest.startsWith("///")) && rest.startsWith("//")) {
    let authority = rest.slice(2);
    rest = "";
    const i = authority.indexOf("/");
    if (i >= 0) {
      rest = authority.slice(i);
      authority = authority.slice(0, i);
    }
    if (!parseAuthority(url, url.scheme, authority)) return null;
  } else if (url.scheme !== "" && rest.startsWith("/")) {
    // OmitHost is set to true when rawURL has an empty host (authority).
    // See golang.org/issue/46059.
    url.omitHost = true;
  }

  // Set Path and, optionally, RawPath.
  // RawPath is a hint of the encoding of Path. We don't want to set it if
  // the default escaping of Path is equivalent, to help make sure that people
  // don't rely on it in general.
  if (!url.setPath(rest)) return null;
  return url;
}

// Returns [scheme, path] or null on an error
function getScheme(rawURL: string): [string, string] | null {
  for (let i = 0; i < rawURL.length; i++) {
    const c = rawURL.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) {
      // do nothing
    } else if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      if (i === 0) {
        return ["", rawURL];
      }
    } else if (c === 58) {
      if (i === 0) {
        urlErr = "missing protocol scheme";
        return null;
      }
      return [rawURL.slice(0, i), rawURL.slice(i + 1)];
    } else {
      // we have encountered an invalid character,
      // so there is no valid scheme
      return ["", rawURL];
    }
  }
  return ["", rawURL];
}

// Sets url.user and url.host; false on an error
function parseAuthority(url: GoURL, scheme: string, authority: string): boolean {
  const i = authority.lastIndexOf("@");
  let host: string | null;
  if (i < 0) {
    host = parseHost(scheme, authority);
  } else {
    host = parseHost(scheme, authority.slice(i + 1));
  }
  if (host === null) {
    return false;
  }
  if (i < 0) {
    url.user = null;
    url.host = host;
    return true;
  }
  let userinfo = authority.slice(0, i);
  if (!validUserinfo(userinfo)) {
    urlErr = "net/url: invalid userinfo";
    return false;
  }
  let user: Userinfo;
  if (!userinfo.includes(":")) {
    const u = unescape(userinfo, encodeUserPassword);
    if (u === null) return false;
    user = new Userinfo(u, "", false);
  } else {
    const colon = userinfo.indexOf(":");
    const username = unescape(userinfo.slice(0, colon), encodeUserPassword);
    if (username === null) return false;
    const password = unescape(userinfo.slice(colon + 1), encodeUserPassword);
    if (password === null) return false;
    user = new Userinfo(username, password, true);
  }
  url.user = user;
  url.host = host;
  return true;
}

// validUserinfo reports whether s is a valid userinfo string per RFC 3986
// Section 3.2.1 (plus "@", see go.dev/issue/3439)
function validUserinfo(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const r = s.charCodeAt(i);
    if ((r >= 0x41 && r <= 0x5a) || (r >= 0x61 && r <= 0x7a) || (r >= 0x30 && r <= 0x39)) {
      continue;
    }
    if ("-._:~!$&'()*+,;=%@".includes(s[i])) {
      continue;
    }
    return false;
  }
  return true;
}

// parseHost parses host as an authority without user information. That is,
// as host[:port]. Returns null on an error.
function parseHost(scheme: string, host: string): string | null {
  const openBracketIdx = host.lastIndexOf("[");
  if (openBracketIdx > 0) {
    urlErr = "invalid IP-literal";
    return null;
  } else if (openBracketIdx === 0) {
    // Parse an IP-Literal in RFC 3986 and RFC 6874.
    // E.g., "[fe80::1]", "[fe80::1%25en0]", "[fe80::1]:80".
    const closeBracketIdx = host.lastIndexOf("]");
    if (closeBracketIdx < 0) {
      urlErr = "missing ']' in host";
      return null;
    }

    const colonPort = host.slice(closeBracketIdx + 1);
    if (!validOptionalPort(colonPort)) {
      urlErr = "invalid port " + goQuote(colonPort) + " after host";
      return null;
    }
    const unescapedColonPort = unescape(colonPort, encodeHost);
    if (unescapedColonPort === null) return null;

    const hostname = host.slice(openBracketIdx + 1, closeBracketIdx);
    let unescapedHostname: string;
    // RFC 6874 defines that %25 (%-encoded percent) introduces the zone
    // identifier, and the zone identifier can use basically any %-encoding it
    // likes. That's different from the host, which can only %-encode
    // non-ASCII bytes.
    const zoneIdx = hostname.indexOf("%25");
    if (zoneIdx >= 0) {
      const hostPart = unescape(hostname.slice(0, zoneIdx), encodeHost);
      if (hostPart === null) return null;
      const zonePart = unescape(hostname.slice(zoneIdx), encodeZone);
      if (zonePart === null) return null;
      unescapedHostname = hostPart + zonePart;
    } else {
      const h = unescape(hostname, encodeHost);
      if (h === null) return null;
      unescapedHostname = h;
    }

    // Per RFC 3986, only a host identified by a valid IPv6 address can be
    // enclosed by square brackets. This excludes any IPv4, but notably not
    // IPv4-mapped addresses.
    const addr = parseAddr(unescapedHostname);
    if (typeof addr === "string") {
      urlErr = "invalid host: " + addr;
      return null;
    }
    if (addr === 4) {
      urlErr = "invalid IP-literal";
      return null;
    }
    return "[" + unescapedHostname + "]" + unescapedColonPort;
  } else {
    let i = host.indexOf(":");
    if (i !== -1) {
      const lastColon = host.lastIndexOf(":");
      if (lastColon !== i) {
        // RFC 3986 does not allow colons to appear in the host subcomponent,
        // but Go historically permitted them. (http and https are strict only
        // with GODEBUG urlstrictcolons=1, which a go 1.13 module does not
        // get.)
        i = lastColon;
      }
      const colonPort = host.slice(i);
      if (!validOptionalPort(colonPort)) {
        urlErr = "invalid port " + goQuote(colonPort) + " after host";
        return null;
      }
    }
  }
  return unescape(host, encodeHost);
}

// net/netip ParseAddr: 4 or 6, or the error text (parseAddrError.Error())
function parseAddr(s: string): 4 | 6 | string {
  for (let i = 0; i < s.length; i++) {
    switch (s.charCodeAt(i)) {
      case 0x2e /* . */: {
        const err = parseIPv4Fields(s, 0, s.length);
        return err !== null ? err : 4;
      }
      case 0x3a /* : */:
        return parseIPv6(s);
      case 0x25 /* % */:
        // Assume that this was trying to be an IPv6 address with a zone
        // specifier, but the address is missing.
        return parseAddrError(s, "missing IPv6 address", "");
    }
  }
  return parseAddrError(s, "unable to parse IP", "");
}

// (strconv.Quote of Go strings: the bytes, so goQuote's UTF-8 view)
function parseAddrError(input: string, msg: string, at: string): string {
  if (at !== "") {
    return "ParseAddr(" + goQuote(input) + "): " + msg + " (at " + goQuote(at) + ")";
  }
  return "ParseAddr(" + goQuote(input) + "): " + msg;
}

// Returns the error or null. (Offsets are byte offsets in Go: the characters
// checked are ASCII, and "at" is a suffix, which is the same in both.)
function parseIPv4Fields(input: string, off: number, end: number): string | null {
  let val = 0;
  let pos = 0;
  let digLen = 0; // number of digits in current octet
  const s = input.slice(off, end);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x30 && c <= 0x39) {
      if (digLen === 1 && val === 0) {
        return parseAddrError(input, "IPv4 field has octet with leading zero", "");
      }
      val = val * 10 + c - 0x30;
      digLen++;
      if (val > 255) {
        return parseAddrError(input, "IPv4 field has value >255", "");
      }
    } else if (c === 0x2e /* . */) {
      // .1.2.3
      // 1.2.3.
      // 1..2.3
      if (i === 0 || i === s.length - 1 || s.charCodeAt(i - 1) === 0x2e) {
        return parseAddrError(input, "IPv4 field must have at least one digit", s.slice(i));
      }
      // 1.2.3.4.5
      if (pos === 3) {
        return parseAddrError(input, "IPv4 address too long", "");
      }
      pos++;
      val = 0;
      digLen = 0;
    } else {
      return parseAddrError(input, "unexpected character", s.slice(i));
    }
  }
  if (pos < 3) {
    return parseAddrError(input, "IPv4 address too short", "");
  }
  return null;
}

// parseIPv6 parses s as an IPv6 address (in form "2001:db8::68"): 6 or the
// error text
function parseIPv6(input: string): 6 | string {
  let s = input;

  // Split off the zone right from the start.
  let zone = "";
  const pct = s.indexOf("%");
  if (pct !== -1) {
    zone = s.slice(pct + 1);
    s = s.slice(0, pct);
    if (zone === "") {
      // Not allowed to have an empty zone if explicitly specified.
      return parseAddrError(input, "zone must be a non-empty string", "");
    }
  }

  let ellipsis = -1; // position of ellipsis in ip

  // Might have leading ellipsis
  if (s.length >= 2 && s.charCodeAt(0) === 0x3a && s.charCodeAt(1) === 0x3a) {
    ellipsis = 0;
    s = s.slice(2);
    // Might be only ellipsis
    if (s.length === 0) {
      return 6;
    }
  }

  // Loop, parsing hex numbers followed by colon.
  let i = 0;
  while (i < 16) {
    let off = 0;
    let acc = 0;
    for (; off < s.length; off++) {
      const c = s.charCodeAt(off);
      if (c >= 0x30 && c <= 0x39) {
        acc = acc * 16 + (c - 0x30);
      } else if (c >= 0x61 && c <= 0x66) {
        acc = acc * 16 + (c - 0x61 + 10);
      } else if (c >= 0x41 && c <= 0x46) {
        acc = acc * 16 + (c - 0x41 + 10);
      } else {
        break;
      }
      if (off > 3) {
        //more than 4 digits in group, fail.
        return parseAddrError(input, "each group must have 4 or less digits", s);
      }
      if (acc > 0xffff) {
        // Overflow, fail.
        return parseAddrError(input, "IPv6 field has value >=2^16", s);
      }
    }
    if (off === 0) {
      // No digits found, fail.
      return parseAddrError(input, "each colon-separated field must have at least one digit", s);
    }

    // If followed by dot, might be in trailing IPv4.
    if (off < s.length && s.charCodeAt(off) === 0x2e) {
      if (ellipsis < 0 && i !== 12) {
        // Not the right place.
        return parseAddrError(input, "embedded IPv4 address must replace the final 2 fields of the address", s);
      }
      if (i + 4 > 16) {
        // Not enough room.
        return parseAddrError(input, "too many hex fields to fit an embedded IPv4 at the end of the address", s);
      }

      let end = input.length;
      if (zone.length > 0) {
        end -= zone.length + 1;
      }
      const err = parseIPv4Fields(input, end - s.length, end);
      if (err !== null) {
        return err;
      }
      s = "";
      i += 4;
      break;
    }

    // Save this 16-bit chunk.
    i += 2;

    // Stop at end of string.
    s = s.slice(off);
    if (s.length === 0) {
      break;
    }

    // Otherwise must be followed by colon and more.
    if (s.charCodeAt(0) !== 0x3a) {
      return parseAddrError(input, "unexpected character, want colon", s);
    } else if (s.length === 1) {
      return parseAddrError(input, "colon must be followed by more characters", s);
    }
    s = s.slice(1);

    // Look for ellipsis.
    if (s.charCodeAt(0) === 0x3a) {
      if (ellipsis >= 0) {
        // already have one
        return parseAddrError(input, "multiple :: in address", s);
      }
      ellipsis = i;
      s = s.slice(1);
      if (s.length === 0) {
        // can be at end
        break;
      }
    }
  }

  // Must have used entire string.
  if (s.length !== 0) {
    return parseAddrError(input, "trailing garbage after address", s);
  }

  // If didn't parse enough, expand ellipsis.
  if (i < 16) {
    if (ellipsis < 0) {
      return parseAddrError(input, "address string too short", "");
    }
  } else if (ellipsis >= 0) {
    // Ellipsis must represent at least one 0 group.
    return parseAddrError(input, "the :: must expand to at least one field of zeros", "");
  }
  return 6;
}

// validOptionalPort reports whether port is either an empty string
// or matches /^:\d*$/
function validOptionalPort(port: string): boolean {
  if (port === "") {
    return true;
  }
  if (port[0] !== ":") {
    return false;
  }
  for (let i = 1; i < port.length; i++) {
    const b = port.charCodeAt(i);
    if (b < 48 || b > 57) {
      return false;
    }
  }
  return true;
}

function ishex(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

function unhex(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 97 + 10;
  if (c >= 65 && c <= 70) return c - 65 + 10;
  return 0;
}

// Return true if the specified character should be escaped when
// appearing in a URL string, according to RFC 3986.
function shouldEscape(c: number, mode: number): boolean {
  // Section 2.3 Unreserved characters (alphanum)
  if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57)) {
    return false;
  }

  if (mode === encodeHost || mode === encodeZone) {
    // Section 3.2.2 Host allows sub-delims as part of reg-name, plus ":",
    // "[", "]", "<", ">" and the quote
    switch (c) {
      case 33: // !
      case 36: // $
      case 38: // &
      case 39: // '
      case 40: // (
      case 41: // )
      case 42: // *
      case 43: // +
      case 44: // ,
      case 59: // ;
      case 61: // =
      case 58: // :
      case 91: // [
      case 93: // ]
      case 60: // <
      case 62: // >
      case 34: // "
        return false;
    }
  }

  switch (c) {
    case 45: // -
    case 95: // _
    case 46: // .
    case 126: // ~
      // Section 2.3 Unreserved characters (mark)
      return false;

    case 36: // $
    case 38: // &
    case 43: // +
    case 44: // ,
    case 47: // /
    case 58: // :
    case 59: // ;
    case 61: // =
    case 63: // ?
    case 64: // @
      // Section 2.2 Reserved characters (reserved)
      switch (mode) {
        case encodePath: // Section 3.3
          // The RFC allows : @ & = + $ but saves / ; , for assigning
          // meaning to individual path segments. This package
          // only manipulates the path as a whole, so we allow those
          // last three as well. That leaves only ? to escape.
          return c === 63;

        case encodePathSegment: // Section 3.3
          // The RFC allows : @ & = + $ but saves / ; , for assigning
          // meaning to individual path segments.
          return c === 47 || c === 59 || c === 44 || c === 63;

        case encodeUserPassword: // Section 3.2.1
          // The RFC allows ';', ':', '&', '=', '+', '$', and ',' in
          // userinfo, so we must escape only '@', '/', and '?'.
          // The parsing of userinfo treats ':' as special so we must escape
          // that too.
          return c === 64 || c === 47 || c === 63 || c === 58;

        case encodeQueryComponent: // Section 3.4
          // The RFC reserves (so we must escape) everything.
          return true;

        case encodeFragment: // Section 4.1
          // The RFC text is silent but the fragment does not end on any
          // of these characters, so we may as well not escape them.
          return false;
      }
  }

  if (mode === encodeFragment) {
    // RFC 3986 Section 2.2 allows not escaping sub-delims. A subset of sub-delims are
    // included in reserved from RFC 2396 Section 2.2. The remaining sub-delims do not
    // need to be escaped. To minimize potential breakage, we apply two restrictions:
    // (1) we always escape sub-delims outside of the fragment, and (2) we always
    // escape single quote to avoid breaking callers that had previously assumed that
    // single quotes would be escaped. See issue #19917.
    switch (c) {
      case 33: // !
      case 40: // (
      case 41: // )
      case 42: // *
        return false;
    }
  }

  // Everything else must be escaped.
  return true;
}

// validEncoded reports whether s is a valid encoded path or fragment,
// according to mode.
function validEncoded(s: string, mode: number): boolean {
  for (let i = 0; i < s.length; i++) {
    // RFC 3986, Appendix A.
    // pchar = unreserved / pct-encoded / sub-delims / ":" / "@".
    const c = s.charCodeAt(i);
    switch (c) {
      case 33: // !
      case 36: // $
      case 38: // &
      case 39: // '
      case 40: // (
      case 41: // )
      case 42: // *
      case 43: // +
      case 44: // ,
      case 59: // ;
      case 61: // =
      case 58: // :
      case 64: // @
        // ok
        break;
      case 91: // [
      case 93: // ]
        // ok - not specified in RFC 3986 but left alone by modern browsers
        break;
      case 37: // %
        // ok - percent encoded, will decode
        break;
      default:
        if (c >= 0x80 || shouldEscape(c, mode)) {
          return false;
        }
    }
  }
  return true;
}


// Go's escape(s, mode) on the UTF-8 bytes of s
function escape(s: string, mode: number): string {
  let needsEscape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x80 || shouldEscape(c, mode)) {
      needsEscape = true;
      break;
    }
  }
  if (!needsEscape) return s;
  // (Go escapes the bytes of the string: see helpers.goStringBytes)
  const bytes = goStringBytes(s);
  const hex = "0123456789ABCDEF";
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (shouldEscape(c, mode)) {
      if (c === 32 && mode === encodeQueryComponent) out += "+";
      else out += "%" + hex[c >> 4] + hex[c & 15];
    } else {
      out += String.fromCharCode(c);
    }
  }
  return out;
}

// Go's unescape(s, mode). Returns null on an error. (The unescaped bytes may
// be invalid UTF-8: see helpers.decodeGoString.)
function unescape(s: string, mode: number): string | null {
  // Count %, check that they're well-formed.
  let n = 0;
  for (let i = 0; i < s.length; ) {
    const c = s.charCodeAt(i);
    if (c === 37) {
      n++;
      if (i + 2 >= s.length || !ishex(s.charCodeAt(i + 1)) || !ishex(s.charCodeAt(i + 2))) {
        urlErr = escapeError(s, i);
        return null;
      }
      // Per https://tools.ietf.org/html/rfc3986#page-21
      // in the host component %-encoding can only be used
      // for non-ASCII bytes.
      if (mode === encodeHost && unhex(s.charCodeAt(i + 1)) < 8 && s.slice(i, i + 3) !== "%25") {
        urlErr = escapeError(s, i);
        return null;
      }
      if (mode === encodeZone) {
        // RFC 6874 says basically "anything goes" for zone identifiers and
        // that even non-ASCII can be redundantly escaped, but it seems
        // prudent to restrict %-escaped bytes here to those that are valid
        // host name bytes in their unescaped form.
        const v = (unhex(s.charCodeAt(i + 1)) << 4) | unhex(s.charCodeAt(i + 2));
        if (s.slice(i, i + 3) !== "%25" && v !== 32 && shouldEscape(v, encodeHost)) {
          urlErr = escapeError(s, i);
          return null;
        }
      }
      i += 3;
    } else {
      if ((mode === encodeHost || mode === encodeZone) && c < 0x80 && shouldEscape(c, mode)) {
        // (InvalidHostError)
        urlErr = "invalid character " + goQuote(s[i]) + " in host name";
        return null;
      }
      i++;
    }
  }

  if (n === 0) {
    return s;
  }

  const bytes = goStringBytes(s);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 37) {
      out.push((unhex(bytes[i + 1]) << 4) | unhex(bytes[i + 2]));
      i += 2;
    } else {
      out.push(c);
    }
  }
  // (the bytes may be invalid UTF-8: see helpers.decodeGoString)
  return decodeGoString(new Uint8Array(out));
}

// helpers.IsFileURL
export function isFileURL(fileURL: GoURL): boolean {
  return fileURL.scheme === "file" && (fileURL.host === "" || fileURL.host === "localhost") && fileURL.path.startsWith("/");
}

// helpers.FileURLFromFilePath
export function fileURLFromFilePath(filePath: string): GoURL {
  // Append a trailing slash so that resolving the URL includes the trailing
  // directory, and turn Windows-style paths with volumes into URL-style paths:
  //
  //   "/Users/User/Desktop" => "/Users/User/Desktop/"
  //   "C:\\Users\\User\\Desktop" => "/C:/Users/User/Desktop/"
  //
  filePath = filePath.replaceAll("\\", "/");
  if (!filePath.startsWith("/")) {
    filePath = "/" + filePath;
  }
  const url = new GoURL();
  url.scheme = "file";
  url.path = filePath;
  return url;
}

// helpers.FilePathFromFileURL
export function filePathFromFileURL(fs: any, fileURL: GoURL): string {
  let path = fileURL.path;

  // Convert URL-style paths back into Windows-style paths if needed:
  //
  //   "/C:/Users/User/foo.js.map" => "C:\\Users\\User\\foo.js.map"
  //
  if (!fs.cwd().startsWith("/")) {
    if (path.startsWith("/")) path = path.slice(1);
    path = path.replaceAll("/", "\\"); // This is needed for "filepath.Rel()" to work
  }

  return path;
}
