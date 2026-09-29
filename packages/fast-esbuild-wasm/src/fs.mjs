// Port of internal/fs: fs.go (FS, DirEntries, Entry), filepath.go
// (goFilepath, with both the Windows and the Unix behaviour selected at run
// time like Go's WebAssembly build), fs_real.go (realFS), iswin_wasm.go
// (CheckIfWindows), error_wasm+windows.go, modkey_other.go, and fs_zip.go
// (Yarn PnP: ".zip" archives read like directories, see zip.mjs, and the
// virtual paths).
//
// The file system sits on a HOST object instead of Go's "os" package. This
// emulates what esbuild-wasm does: Go's js/wasm port implements "os" with
// syscall/fs_js.go on top of globalThis.fs, which is:
//
//   - host === null: esbuild-wasm in a browser. Its wasm_exec.js installs a
//     stub globalThis.fs where every call fails with code "ENOSYS", so every
//     operation below returns ENOSYS (and CheckIfWindows is false).
//
//   - otherwise host is Node's "fs" module (esbuild-wasm on node sets
//     globalThis.fs = require("fs")). Go calls the asynchronous API; the
//     synchronous API used here gives the same results.
//
// Errors are singleton Errno objects per code (Go's "err == syscall.ENOENT"
// becomes "err === ENOENT"). Go panics on an error code that is not in its
// table (syscall/fs_js.go mapJSError); so does this (a GoPanic).
//
// File contents are raw bytes (Uint8Array; a Node Buffer when host is Node's
// fs). Use decodeUTF8() where Go treats the contents as text.
import { GoPanic } from "./gopanic.mjs";
import { openZipReader,              } from "./zip.mjs";
import { goStringsToLower, goStringsEqualFold as goEqualFold } from "./gostrings.mjs";
import { goStringBytes, decodeGoString } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// syscall errors (syscall/tables_js.go), with Go's Error() texts

export class Errno {
                       
                       
                        
  constructor(code        , text        , errno        ) {
    this.code = code;
    this.text = text;
    this.errno = errno;
  }
  error()         {
    return this.text;
  }
}

// syscall.Errno values of Go's js/wasm port (syscall/tables_js.go): one
// object per number (aliases such as ENOTSUP = EOPNOTSUPP are the same
// object); Error() is errorstr[n], or "errno N"
export const EPERM = new Errno("EPERM", "Operation not permitted", 1);
export const ENOENT = new Errno("ENOENT", "No such file or directory", 2);
export const ESRCH = new Errno("ESRCH", "No such process", 3);
export const EINTR = new Errno("EINTR", "Interrupted system call", 4);
export const EIO = new Errno("EIO", "I/O error", 5);
export const ENXIO = new Errno("ENXIO", "No such device or address", 6);
export const E2BIG = new Errno("E2BIG", "Argument list too long", 7);
export const ENOEXEC = new Errno("ENOEXEC", "Exec format error", 8);
export const EBADF = new Errno("EBADF", "Bad file number", 9);
export const ECHILD = new Errno("ECHILD", "No child processes", 10);
export const EAGAIN = new Errno("EAGAIN", "Try again", 11);
export const ENOMEM = new Errno("ENOMEM", "Out of memory", 12);
export const EACCES = new Errno("EACCES", "Permission denied", 13);
export const EFAULT = new Errno("EFAULT", "Bad address", 14);
export const EBUSY = new Errno("EBUSY", "Device or resource busy", 16);
export const EEXIST = new Errno("EEXIST", "File exists", 17);
export const EXDEV = new Errno("EXDEV", "Cross-device link", 18);
export const ENODEV = new Errno("ENODEV", "No such device", 19);
export const ENOTDIR = new Errno("ENOTDIR", "Not a directory", 20);
export const EISDIR = new Errno("EISDIR", "Is a directory", 21);
export const EINVAL = new Errno("EINVAL", "Invalid argument", 22);
export const ENFILE = new Errno("ENFILE", "File table overflow", 23);
export const EMFILE = new Errno("EMFILE", "Too many open files", 24);
export const ENOTTY = new Errno("ENOTTY", "Not a typewriter", 25);
export const EFBIG = new Errno("EFBIG", "File too large", 27);
export const ENOSPC = new Errno("ENOSPC", "No space left on device", 28);
export const ESPIPE = new Errno("ESPIPE", "Illegal seek", 29);
export const EROFS = new Errno("EROFS", "Read-only file system", 30);
export const EMLINK = new Errno("EMLINK", "Too many links", 31);
export const EPIPE = new Errno("EPIPE", "Broken pipe", 32);
export const EDOM = new Errno("EDOM", "Math arg out of domain of func", 33);
export const ERANGE = new Errno("ERANGE", "Math result not representable", 34);
export const EDEADLK = new Errno("EDEADLK", "Deadlock condition", 35);
export const ENAMETOOLONG = new Errno("ENAMETOOLONG", "File name too long", 36);
export const ENOLCK = new Errno("ENOLCK", "No record locks available", 37);
export const ENOSYS = new Errno("ENOSYS", "not implemented on js", 38);
export const ENOTEMPTY = new Errno("ENOTEMPTY", "Directory not empty", 39);
export const ELOOP = new Errno("ELOOP", "Too many symbolic links", 40);
export const ENOMSG = new Errno("ENOMSG", "No message of desired type", 42);
export const EIDRM = new Errno("EIDRM", "Identifier removed", 43);
export const ECHRNG = new Errno("ECHRNG", "Channel number out of range", 44);
export const EL2NSYNC = new Errno("EL2NSYNC", "Level 2 not synchronized", 45);
export const EL3HLT = new Errno("EL3HLT", "Level 3 halted", 46);
export const EL3RST = new Errno("EL3RST", "Level 3 reset", 47);
export const ELNRNG = new Errno("ELNRNG", "Link number out of range", 48);
export const EUNATCH = new Errno("EUNATCH", "Protocol driver not attached", 49);
export const ENOCSI = new Errno("ENOCSI", "No CSI structure available", 50);
export const EL2HLT = new Errno("EL2HLT", "Level 2 halted", 51);
export const EBADE = new Errno("EBADE", "Invalid exchange", 52);
export const EBADR = new Errno("EBADR", "Invalid request descriptor", 53);
export const EXFULL = new Errno("EXFULL", "Exchange full", 54);
export const ENOANO = new Errno("ENOANO", "No anode", 55);
export const EBADRQC = new Errno("EBADRQC", "Invalid request code", 56);
export const EBADSLT = new Errno("EBADSLT", "Invalid slot", 57);
export const EBFONT = new Errno("EBFONT", "Bad font file fmt", 59);
export const ENOSTR = new Errno("ENOSTR", "Device not a stream", 60);
export const ENODATA = new Errno("ENODATA", "No data (for no delay io)", 61);
export const ETIME = new Errno("ETIME", "Timer expired", 62);
export const ENOSR = new Errno("ENOSR", "Out of streams resources", 63);
export const ENONET = new Errno("ENONET", "Machine is not on the network", 64);
export const ENOPKG = new Errno("ENOPKG", "Package not installed", 65);
export const EREMOTE = new Errno("EREMOTE", "The object is remote", 66);
export const ENOLINK = new Errno("ENOLINK", "The link has been severed", 67);
export const EADV = new Errno("EADV", "Advertise error", 68);
export const ESRMNT = new Errno("ESRMNT", "Srmount error", 69);
export const ECOMM = new Errno("ECOMM", "Communication error on send", 70);
export const EPROTO = new Errno("EPROTO", "Protocol error", 71);
export const EMULTIHOP = new Errno("EMULTIHOP", "Multihop attempted", 72);
export const EDOTDOT = new Errno("EDOTDOT", "Cross mount point (not really error)", 73);
export const EBADMSG = new Errno("EBADMSG", "Trying to read unreadable message", 74);
export const EOVERFLOW = new Errno("EOVERFLOW", "Value too large for defined data type", 75);
export const ENOTUNIQ = new Errno("ENOTUNIQ", "Given log. name not unique", 76);
export const EBADFD = new Errno("EBADFD", "f.d. invalid for this operation", 77);
export const EREMCHG = new Errno("EREMCHG", "Remote address changed", 78);
export const ELIBACC = new Errno("ELIBACC", "Can't access a needed shared lib", 79);
export const ELIBBAD = new Errno("ELIBBAD", "Accessing a corrupted shared lib", 80);
export const ELIBSCN = new Errno("ELIBSCN", ".lib section in a.out corrupted", 81);
export const ELIBMAX = new Errno("ELIBMAX", "Attempting to link in too many libs", 82);
export const ELIBEXEC = new Errno("ELIBEXEC", "Attempting to exec a shared library", 83);
export const EILSEQ = new Errno("EILSEQ", "errno 84", 84);
export const EUSERS = new Errno("EUSERS", "errno 87", 87);
export const ENOTSOCK = new Errno("ENOTSOCK", "Socket operation on non-socket", 88);
export const EDESTADDRREQ = new Errno("EDESTADDRREQ", "Destination address required", 89);
export const EMSGSIZE = new Errno("EMSGSIZE", "Message too long", 90);
export const EPROTOTYPE = new Errno("EPROTOTYPE", "Protocol wrong type for socket", 91);
export const ENOPROTOOPT = new Errno("ENOPROTOOPT", "Protocol not available", 92);
export const EPROTONOSUPPORT = new Errno("EPROTONOSUPPORT", "Unknown protocol", 93);
export const ESOCKTNOSUPPORT = new Errno("ESOCKTNOSUPPORT", "Socket type not supported", 94);
export const EOPNOTSUPP = new Errno("EOPNOTSUPP", "Operation not supported on transport endpoint", 95);
export const EPFNOSUPPORT = new Errno("EPFNOSUPPORT", "Protocol family not supported", 96);
export const EAFNOSUPPORT = new Errno("EAFNOSUPPORT", "Address family not supported by protocol family", 97);
export const EADDRINUSE = new Errno("EADDRINUSE", "Address already in use", 98);
export const EADDRNOTAVAIL = new Errno("EADDRNOTAVAIL", "Address not available", 99);
export const ENETDOWN = new Errno("ENETDOWN", "Network interface is not configured", 100);
export const ENETUNREACH = new Errno("ENETUNREACH", "Network is unreachable", 101);
export const ENETRESET = new Errno("ENETRESET", "errno 102", 102);
export const ECONNABORTED = new Errno("ECONNABORTED", "Connection aborted", 103);
export const ECONNRESET = new Errno("ECONNRESET", "Connection reset by peer", 104);
export const ENOBUFS = new Errno("ENOBUFS", "No buffer space available", 105);
export const EISCONN = new Errno("EISCONN", "Socket is already connected", 106);
export const ENOTCONN = new Errno("ENOTCONN", "Socket is not connected", 107);
export const ESHUTDOWN = new Errno("ESHUTDOWN", "Can't send after socket shutdown", 108);
export const ETOOMANYREFS = new Errno("ETOOMANYREFS", "errno 109", 109);
export const ETIMEDOUT = new Errno("ETIMEDOUT", "Connection timed out", 110);
export const ECONNREFUSED = new Errno("ECONNREFUSED", "Connection refused", 111);
export const EHOSTDOWN = new Errno("EHOSTDOWN", "Host is down", 112);
export const EHOSTUNREACH = new Errno("EHOSTUNREACH", "Host is unreachable", 113);
export const EALREADY = new Errno("EALREADY", "Socket already connected", 114);
export const EINPROGRESS = new Errno("EINPROGRESS", "Connection already in progress", 115);
export const ESTALE = new Errno("ESTALE", "errno 116", 116);
export const EDQUOT = new Errno("EDQUOT", "Quota exceeded", 122);
export const ENOMEDIUM = new Errno("ENOMEDIUM", "No medium (in tape drive)", 123);
export const ECANCELED = new Errno("ECANCELED", "Operation canceled.", 125);
export const ELBIN = new Errno("ELBIN", "Inode is remote (not really error)", 2048);
export const EFTYPE = new Errno("EFTYPE", "Inappropriate file type or format", 2049);
export const ENMFILE = new Errno("ENMFILE", "No more files", 2050);
export const EPROCLIM = new Errno("EPROCLIM", "errno 2051", 2051);
export const ENOSHARE = new Errno("ENOSHARE", "No such host or network path", 2052);
export const ECASECLASH = new Errno("ECASECLASH", "Filename exists with different case", 2053);
export const EDEADLOCK = EDEADLK;
export const ENOTSUP = EOPNOTSUPP;
export const EWOULDBLOCK = EAGAIN;

// syscall/tables_js.go errnoByCode
const ERRNO_BY_CODE = new Map               ([
  ["EPERM", EPERM],
  ["ENOENT", ENOENT],
  ["ESRCH", ESRCH],
  ["EINTR", EINTR],
  ["EIO", EIO],
  ["ENXIO", ENXIO],
  ["E2BIG", E2BIG],
  ["ENOEXEC", ENOEXEC],
  ["EBADF", EBADF],
  ["ECHILD", ECHILD],
  ["EAGAIN", EAGAIN],
  ["ENOMEM", ENOMEM],
  ["EACCES", EACCES],
  ["EFAULT", EFAULT],
  ["EBUSY", EBUSY],
  ["EEXIST", EEXIST],
  ["EXDEV", EXDEV],
  ["ENODEV", ENODEV],
  ["ENOTDIR", ENOTDIR],
  ["EISDIR", EISDIR],
  ["EINVAL", EINVAL],
  ["ENFILE", ENFILE],
  ["EMFILE", EMFILE],
  ["ENOTTY", ENOTTY],
  ["EFBIG", EFBIG],
  ["ENOSPC", ENOSPC],
  ["ESPIPE", ESPIPE],
  ["EROFS", EROFS],
  ["EMLINK", EMLINK],
  ["EPIPE", EPIPE],
  ["ENAMETOOLONG", ENAMETOOLONG],
  ["ENOSYS", ENOSYS],
  ["EDQUOT", EDQUOT],
  ["EDOM", EDOM],
  ["ERANGE", ERANGE],
  ["EDEADLK", EDEADLK],
  ["ENOLCK", ENOLCK],
  ["ENOTEMPTY", ENOTEMPTY],
  ["ELOOP", ELOOP],
  ["ENOMSG", ENOMSG],
  ["EIDRM", EIDRM],
  ["ECHRNG", ECHRNG],
  ["EL2NSYNC", EL2NSYNC],
  ["EL3HLT", EL3HLT],
  ["EL3RST", EL3RST],
  ["ELNRNG", ELNRNG],
  ["EUNATCH", EUNATCH],
  ["ENOCSI", ENOCSI],
  ["EL2HLT", EL2HLT],
  ["EBADE", EBADE],
  ["EBADR", EBADR],
  ["EXFULL", EXFULL],
  ["ENOANO", ENOANO],
  ["EBADRQC", EBADRQC],
  ["EBADSLT", EBADSLT],
  ["EDEADLOCK", EDEADLK],
  ["EBFONT", EBFONT],
  ["ENOSTR", ENOSTR],
  ["ENODATA", ENODATA],
  ["ETIME", ETIME],
  ["ENOSR", ENOSR],
  ["ENONET", ENONET],
  ["ENOPKG", ENOPKG],
  ["EREMOTE", EREMOTE],
  ["ENOLINK", ENOLINK],
  ["EADV", EADV],
  ["ESRMNT", ESRMNT],
  ["ECOMM", ECOMM],
  ["EPROTO", EPROTO],
  ["EMULTIHOP", EMULTIHOP],
  ["EDOTDOT", EDOTDOT],
  ["EBADMSG", EBADMSG],
  ["EOVERFLOW", EOVERFLOW],
  ["ENOTUNIQ", ENOTUNIQ],
  ["EBADFD", EBADFD],
  ["EREMCHG", EREMCHG],
  ["ELIBACC", ELIBACC],
  ["ELIBBAD", ELIBBAD],
  ["ELIBSCN", ELIBSCN],
  ["ELIBMAX", ELIBMAX],
  ["ELIBEXEC", ELIBEXEC],
  ["EILSEQ", EILSEQ],
  ["EUSERS", EUSERS],
  ["ENOTSOCK", ENOTSOCK],
  ["EDESTADDRREQ", EDESTADDRREQ],
  ["EMSGSIZE", EMSGSIZE],
  ["EPROTOTYPE", EPROTOTYPE],
  ["ENOPROTOOPT", ENOPROTOOPT],
  ["EPROTONOSUPPORT", EPROTONOSUPPORT],
  ["ESOCKTNOSUPPORT", ESOCKTNOSUPPORT],
  ["EOPNOTSUPP", EOPNOTSUPP],
  ["EPFNOSUPPORT", EPFNOSUPPORT],
  ["EAFNOSUPPORT", EAFNOSUPPORT],
  ["EADDRINUSE", EADDRINUSE],
  ["EADDRNOTAVAIL", EADDRNOTAVAIL],
  ["ENETDOWN", ENETDOWN],
  ["ENETUNREACH", ENETUNREACH],
  ["ENETRESET", ENETRESET],
  ["ECONNABORTED", ECONNABORTED],
  ["ECONNRESET", ECONNRESET],
  ["ENOBUFS", ENOBUFS],
  ["EISCONN", EISCONN],
  ["ENOTCONN", ENOTCONN],
  ["ESHUTDOWN", ESHUTDOWN],
  ["ETOOMANYREFS", ETOOMANYREFS],
  ["ETIMEDOUT", ETIMEDOUT],
  ["ECONNREFUSED", ECONNREFUSED],
  ["EHOSTDOWN", EHOSTDOWN],
  ["EHOSTUNREACH", EHOSTUNREACH],
  ["EALREADY", EALREADY],
  ["EINPROGRESS", EINPROGRESS],
  ["ESTALE", ESTALE],
  ["ENOTSUP", EOPNOTSUPP],
  ["ENOMEDIUM", ENOMEDIUM],
  ["ECANCELED", ECANCELED],
  ["ELBIN", ELBIN],
  ["EFTYPE", EFTYPE],
  ["ENMFILE", ENMFILE],
  ["EPROCLIM", EPROCLIM],
  ["ENOSHARE", ENOSHARE],
  ["ECASECLASH", ECASECLASH],
  ["EWOULDBLOCK", EAGAIN],
]);

// syscall/fs_js.go mapJSError
function mapJSError(e     )        {
  const code = e !== null && typeof e === "object" ? e.code : undefined;
  const errno = typeof code === "string" ? ERRNO_BY_CODE.get(code) : undefined;
  if (errno === undefined) {
    // (Go panics with the JavaScript error value)
    throw new GoPanic("JavaScript error: " + String(e && e.message));
  }
  return errno;
}

// os.PathError
export class PathError {
  ;                  
  ;                    
  ;                
  constructor(op        , path        , err     ) {
    this.op = op;
    this.path = path;
    this.err = err;
  }
  error()         {
    return this.op + " " + this.path + ": " + this.err.error();
  }
  unwrap()      {
    return this.err;
  }
}

// A plain error (Go's errors.New)
export class GoError {
  ;                    
  constructor(text        ) {
    this.text = text;
  }
  error()         {
    return this.text;
  }
}

// ---------------------------------------------------------------------------
// The "os"/"syscall" layer of Go's js/wasm port on top of the host

// S_IFMT values (Node's stat mode and syscall/syscall_js.go agree)
const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

// syscall/fs_js.go checkPath
function checkPath(path        )               {
  if (path === "") return EINVAL;
  if (path.indexOf("\0") !== -1) return EINVAL;
  return null;
}

// Go's js.ValueOf(string): the host gets the string's bytes decoded like a
// TextDecoder does (the 3 WTF-8 bytes of a lone surrogate become 3 U+FFFD).
// (helpers.decodeGoString: a path may hold raw bytes of invalid UTF-8, e.g.
// from a percent-escaped "file://" URL)
let hostPathDecoder                     = null;
function hostPath(path        )         {
  if (path.isWellFormed()) return path;
  if (hostPathDecoder === null) hostPathDecoder = new TextDecoder();
  return hostPathDecoder.decode(goStringBytes(path));
}

// Go's js.Value.String() encodes the JS string as UTF-8 (TextEncoder), so a
// lone surrogate from the host becomes U+FFFD
function fromHostString(s        )         {
  return s.isWellFormed() ? s : s.toWellFormed();
}

// os.Lstat / os.Stat: the S_IFMT bits of the mode, or an error
// (a PathError wrapping the Errno)
function osLstat(host     , path        )                     {
  const bad = checkPath(path);
  if (bad !== null) return new PathError("lstat", path, bad);
  if (host === null) return new PathError("lstat", path, ENOSYS);
  let st;
  try {
    st = host.lstatSync(hostPath(path), { throwIfNoEntry: false });
  } catch (e) {
    return new PathError("lstat", path, mapJSError(e));
  }
  // (Node only returns undefined for ENOENT and ENOTDIR here; callers never
  // look at which of the two it was)
  if (st === undefined) return new PathError("lstat", path, ENOENT);
  return st.mode & S_IFMT;
}

function osStat(host     , path        )      {
  const bad = checkPath(path);
  if (bad !== null) return new PathError("stat", path, bad);
  if (host === null) return new PathError("stat", path, ENOSYS);
  try {
    return host.statSync(hostPath(path));
  } catch (e) {
    return new PathError("stat", path, mapJSError(e));
  }
}

// os.Readlink
function osReadlink(host     , path        )                     {
  const bad = checkPath(path);
  if (bad !== null) return new PathError("readlink", path, bad);
  if (host === null) return new PathError("readlink", path, ENOSYS);
  try {
    return fromHostString(host.readlinkSync(hostPath(path)));
  } catch (e) {
    return new PathError("readlink", path, mapJSError(e));
  }
}

// os.Open as done by syscall/fs_js.go: "open", then "fstat" (errors ignored),
// then "readdir" for directories. Returns [fd, isDir, entries] or a PathError.
// The caller must close the fd.
function osOpen(host     , path        )                                                       {
  const bad = checkPath(path);
  if (bad !== null) return new PathError("open", path, bad);
  if (host === null) return new PathError("open", path, ENOSYS);
  let fd        ;
  try {
    fd = host.openSync(hostPath(path), "r");
  } catch (e) {
    return new PathError("open", path, mapJSError(e));
  }
  let entries                  = null;
  let isDir = false;
  try {
    isDir = (host.fstatSync(fd).mode & S_IFMT) === S_IFDIR;
  } catch {}
  if (isDir) {
    try {
      entries = host.readdirSync(hostPath(path));
    } catch (e) {
      try {
        host.closeSync(fd);
      } catch {}
      return new PathError("open", path, mapJSError(e));
    }
  }
  return { fd, entries };
}

function osClose(host     , fd        ) {
  try {
    host.closeSync(fd);
  } catch {}
}

// os.ReadFile (via ioutil.ReadFile): [bytes, error]
function osReadFile(host     , path        )                           {
  if (host !== null && checkPath(path) === null) {
    // Fast path: a successful read gives the same bytes as Go's
    // open/fstat/read loop. Failures redo Go's sequence to get its error.
    try {
      return [host.readFileSync(hostPath(path)), null];
    } catch {}
  }
  const f = osOpen(host, path);
  if (f instanceof PathError) return [null, f];
  try {
    let size = 0;
    try {
      size = host.fstatSync(f.fd).size;
    } catch {}
    let data = new Uint8Array(size + 1);
    let len = 0;
    for (;;) {
      let n        ;
      try {
        n = host.readSync(f.fd, data, len, data.length - len, null);
      } catch (e) {
        return [null, new PathError("read", path, mapJSError(e))];
      }
      len += n;
      if (n === 0) return [data.subarray(0, len), null];
      if (len >= data.length) {
        const d = new Uint8Array(data.length * 2);
        d.set(data);
        data = d;
      }
    }
  } finally {
    osClose(host, f.fd);
  }
}

// The working directory of Go's process (esbuild-wasm's Go runs with the
// JavaScript process's, or in the child process of esbuild's Node API with
// the directory it was started in): set by the host, else process.cwd()
let getwdHook                        = null;
export function setGetwd(f                       ) {
  getwdHook = f;
}

// os.Getwd: stat(".") first (which fails without a file system), then
// syscall.Getwd (process.cwd()). The "PWD" shortcut does not apply: the Go
// process has no PWD variable (bin/esbuild keeps four variables, a browser
// none). Returns null for an error.
export function osGetwd(host     )                {
  const dot = osStat(host, ".");
  if (dot instanceof PathError) return null;
  try {
    if (getwdHook !== null) return fromHostString(getwdHook());
    const p = (globalThis       ).process;
    if (p !== undefined && p !== null && typeof p.cwd === "function") return fromHostString(String(p.cwd()));
  } catch {}
  return null;
}

// ioutil.ReadFile for pkg/api (outside of the FS interface)
export function osReadFileHost(host     , path        )                           {
  return osReadFile(host, path);
}

// os.Mkdir
function osMkdir(host     , path        , perm        )                   {
  const bad = checkPath(path);
  if (bad !== null) return new PathError("mkdir", path, bad);
  if (host === null) return new PathError("mkdir", path, ENOSYS);
  try {
    host.mkdirSync(hostPath(path), perm);
  } catch (e) {
    return new PathError("mkdir", path, mapJSError(e));
  }
  return null;
}

// fs.go MkdirAll (the file system's Dir and Join, the os package's Stat,
// Mkdir and Lstat)
export function mkdirAll(fs    , host     , path        , perm        )                   {
  // Run "Join" once to run "Clean" on the path, which removes trailing slashes
  return mkdirAllImpl(fs, host, fs.join(path), perm);
}

function mkdirAllImpl(fs    , host     , path        , perm        )                   {
  // Fast path: if we can tell whether path is a directory or file, stop with success or error.
  const dir = osStat(host, path);
  if (!(dir instanceof PathError)) {
    if ((dir.mode & S_IFMT) === S_IFDIR) {
      return null;
    }
    return new PathError("mkdir", path, ENOTDIR);
  }

  // Slow path: make sure parent exists and then call Mkdir for path.
  const parent = fs.dir(path);
  if (parent !== path) {
    // Create parent.
    const err = mkdirAllImpl(fs, host, parent, perm);
    if (err !== null) {
      return err;
    }
  }

  // Parent now exists; invoke Mkdir and use its result.
  const err = osMkdir(host, path, perm);
  if (err !== null) {
    // Handle arguments like "foo/." by
    // double-checking that directory doesn't exist.
    const dir1 = osLstat(host, path);
    if (typeof dir1 === "number" && dir1 === S_IFDIR) {
      return null;
    }
    return err;
  }
  return null;
}

// os.WriteFile (ioutil.WriteFile): open with O_WRONLY|O_CREATE|O_TRUNC, write
// everything, close. Returns the error or null.
export function osWriteFile(host     , path        , data            , perm        )                   {
  const bad = checkPath(path);
  if (bad !== null) return new PathError("open", path, bad);
  if (host === null) return new PathError("open", path, ENOSYS);
  let fd        ;
  try {
    fd = host.openSync(hostPath(path), "w", perm);
  } catch (e) {
    return new PathError("open", path, mapJSError(e));
  }
  // (syscall/fs_js.go Open reads the entries of a directory it opened)
  let isDir = false;
  try {
    isDir = (host.fstatSync(fd).mode & S_IFMT) === S_IFDIR;
  } catch {}
  if (isDir) {
    try {
      host.readdirSync(hostPath(path));
    } catch (e) {
      osClose(host, fd);
      return new PathError("open", path, mapJSError(e));
    }
  }
  let err                   = null;
  let off = 0;
  while (off < data.length) {
    let n        ;
    try {
      n = host.writeSync(fd, data, off, data.length - off, null);
    } catch (e) {
      err = new PathError("write", path, mapJSError(e));
      break;
    }
    off += n;
  }
  try {
    host.closeSync(fd);
  } catch (e) {
    if (err === null) err = new PathError("close", path, mapJSError(e));
  }
  return err;
}

// os.Remove: the error or null
export function osRemove(host     , path        )                   {
  const bad = checkPath(path);
  if (bad !== null) return new PathError("remove", path, bad);
  if (host === null) return new PathError("remove", path, ENOSYS);
  let e       ;
  try {
    host.unlinkSync(hostPath(path));
    return null;
  } catch (err) {
    e = mapJSError(err);
  }
  let e1       ;
  try {
    host.rmdirSync(hostPath(path));
    return null;
  } catch (err) {
    e1 = mapJSError(err);
  }
  // Both failed: figure out which error to return.
  // OS X and Linux differ on whether unlink(dir)
  // returns EISDIR, so can't use that. However,
  // both agree that rmdir(file) returns ENOTDIR,
  // so we can use that to decide which error is real.
  // Rmdir might also return ENOTDIR if given a bad
  // file path, like /etc/passwd/foo, but in that case,
  // both errors will be ENOTDIR, so it's okay to
  // use the error from unlink.
  if (e1 !== ENOTDIR) {
    e = e1;
  }
  return new PathError("remove", path, e);
}

// ---------------------------------------------------------------------------
// fs.go

// EntryKind
export const DirEntry = 1;
export const FileEntry = 2;

export class Entry {
                            // Go's "symlink" field ("symlink()" is the method)
                      
                       
                         // Go's "kind" field ("kind()" is the method)
                            
                                           // JS-only: the reused result of DirEntries.get()
  constructor(dir        , base        , kind = 0, needStat = false) {
    this.symlink_ = "";
    this.dir = dir;
    this.base = base;
    this.kind_ = kind;
    this.needStat = needStat;
    this.getResult = null;
  }

  kind(fs    )         {
    if (this.needStat) {
      this.needStat = false;
      const r = fs.kind(this.dir, this.base);
      this.symlink_ = r[0];
      this.kind_ = r[1];
    }
    return this.kind_;
  }

  symlink(fs    )         {
    if (this.needStat) {
      this.needStat = false;
      const r = fs.kind(this.dir, this.base);
      this.symlink_ = r[0];
      this.kind_ = r[1];
    }
    return this.symlink_;
  }
}

export class DifferentCase {
  ;                   
  ;                     
  ;                      
  constructor(dir = "", query = "", actual = "") {
    this.dir = dir;
    this.query = query;
    this.actual = actual;
  }
}

const NOT_FOUND               = Object.freeze([null, null])       ;

export class AccessedEntries {
                                           

  // If this is null, "SortedKeys()" was not accessed. This means we should
  // check for whether this directory has changed or not by seeing if any of
  // the entries in the "wasPresent" map have changed in "present or not"
  // status, since the only access was to individual entries via "Get()".
  //
  // If this is non-null, "SortedKeys()" was accessed. This means we should
  // check for whether this directory has changed or not by checking the
  // "allEntries" array for equality with the existing entries list, since the
  // code asked for all entries and may have used the presence or absence of
  // entries in that list.
                                      
  constructor() {
    this.wasPresent = new Map();
    this.allEntries = null;
  }
}

export class DirEntries {
  ;                                       
  ;                                               
  ;                   
  constructor(dir = "", data                            = null) {
    this.data = data;
    this.accessedEntries = null;
    this.dir = dir;
  }

  // Returns [entry, differentCase]. JS-only: the returned array may be shared
  // (never mutate it).
  get(query        )                                       {
    if (this.data !== null) {
      const key = goStringsToLower(query);
      const entry = this.data.get(key);

      // Track whether this specific entry was present or absent for watch mode
      const accessed = this.accessedEntries;
      if (accessed !== null) {
        accessed.wasPresent.set(key, entry !== undefined);
      }

      if (entry !== undefined) {
        if (entry.base !== query) {
          return [entry, new DifferentCase(this.dir, query, entry.base)];
        }
        let r = entry.getResult;
        if (r === null) r = entry.getResult = Object.freeze([entry, null])       ;
        return r;
      }
    }
    return NOT_FOUND;
  }

  // This function lets you "peek" at the number of entries without watch mode
  // considering the number of entries as having been observed.
  peekEntryCount()         {
    if (this.data !== null) return this.data.size;
    return 0;
  }

  sortedKeys()                  {
    if (this.data !== null) {
      const keys           = [];
      for (const entry of this.data.values()) keys.push(entry.base);
      keys.sort(goStringCompare);

      // Track the exact set of all entries for watch mode
      if (this.accessedEntries !== null) {
        this.accessedEntries.allEntries = keys;
      }

      return keys;
    }
    return null;
  }
}

export function makeEmptyDirEntries(dir        )             {
  return new DirEntries(dir, new Map());
}

// Go's sort.Strings order (bytewise UTF-8 = code point order), which differs
// from UTF-16 code unit order only for surrogates vs. U+E000-U+FFFF
export function goStringCompare(a        , b        )         {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i++) {
    let ca = a.charCodeAt(i);
    let cb = b.charCodeAt(i);
    if (ca !== cb) {
      if (ca >= 0xd800 && cb >= 0xd800) {
        // Surrogates sort after U+E000-U+FFFF in code point order
        ca = ca >= 0xe000 ? ca - 0x800 : ca + 0x2000;
        cb = cb >= 0xe000 ? cb - 0x800 : cb + 0x2000;
      }
      return ca - cb;
    }
  }
  return a.length - b.length;
}

// strings.ToLower and strings.EqualFold (gostrings.mts)
export { goStringsToLower, goStringsEqualFold as goEqualFold } from "./gostrings.mjs";

export class ModKey {
                       
                           
                       
  constructor(size = 0, mtimeSec = 0, mode = 0) {
    this.size = size;
    this.mtimeSec = mtimeSec;
    this.mode = mode;
  }
  equals(other        )          {
    return this.size === other.size && this.mtimeSec === other.mtimeSec && this.mode === other.mode;
  }
}

// Some file systems have a time resolution of only a few seconds. If a mtime
// value is too new, we won't be able to tell if it has been recently modified
// or not. So we only use mtimes for comparison if they are sufficiently old.
const modKeySafetyGap = 3; // In seconds
export const modKeyUnusable = new GoError("The modification key is unusable");
const ZERO_MOD_KEY = new ModKey();

// modkey_other.go (js/wasm): [ModKey, error]
function modKey(host     , path        )                {
  const st = osStat(host, path);
  if (st instanceof PathError) return [ZERO_MOD_KEY, st];

  // We can't detect changes if the file system zeros out the modification time
  // (syscall/fs_js.go setStat: Mtime = int(mtimeMs) / 1000)
  const mtimeMs = Math.trunc(st.mtimeMs);
  const mtimeSec = Math.trunc(mtimeMs / 1000);
  if (mtimeMs === 0 || mtimeSec === 0) return [ZERO_MOD_KEY, modKeyUnusable];

  // Don't generate a modification key if the file is too new
  if (mtimeMs + modKeySafetyGap * 1000 > Date.now()) return [ZERO_MOD_KEY, modKeyUnusable];

  // (os.FileMode: the permission bits plus Go's type bits)
  return [new ModKey(Math.trunc(st.size), mtimeSec, goFileMode(st.mode)), null];
}

// os.FileMode from a syscall mode (os/stat_js.go fillFileStatFromSys)
function goFileMode(mode        )         {
  let m = mode & 0o777;
  switch (mode & S_IFMT) {
    case 0o060000:
      m |= 0x4000000; // ModeDevice
      break;
    case 0o020000:
      m |= 0x4000000 | 0x200000; // ModeDevice | ModeCharDevice
      break;
    case S_IFDIR:
      m |= 0x80000000; // ModeDir
      break;
    case 0o010000:
      m |= 0x2000000; // ModeNamedPipe
      break;
    case S_IFLNK:
      m |= 0x8000000; // ModeSymlink
      break;
    case 0o140000:
      m |= 0x1000000; // ModeSocket
      break;
  }
  if ((mode & 0o4000) !== 0) m |= 0x800000; // ModeSetuid
  if ((mode & 0o2000) !== 0) m |= 0x400000; // ModeSetgid
  if ((mode & 0o1000) !== 0) m |= 0x100000; // ModeSticky
  return m >>> 0;
}

export class WatchData {
  ;                                        
  constructor(paths = new Map                      ()) {
    this.paths = paths;
  }
}

// The file system interface (Go's fs.FS)
;                    
                                                                               
                                                          
                                                      
                                                                      
                                                        
                                      
                               
                                       
                            
                             
                            
                                                              
                
                                                       
                                                
                                                    
                         
 

// ---------------------------------------------------------------------------
// filepath.go

const SLASH = 47;
const BACKSLASH = 92;
const DOT = 46;
const COLON = 58;

function isSlash(c        )          {
  return c === BACKSLASH || c === SLASH;
}

// reservedNames lists reserved Windows names
const reservedNames = [
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

// isReservedName returns true, if path is Windows reserved name.
function isReservedName(path        )          {
  if (path.length === 0) return false;
  // (Only non-ASCII characters that fold to "k" or "s" could match an ASCII
  // name case-insensitively, and no reserved name contains those)
  if (path.length !== 3 && path.length !== 4) return false;
  for (const reserved of reservedNames) {
    if (goEqualFold(path, reserved)) return true;
  }
  return false;
}

// Go's lazybuf for goFilepath.clean: "path" is lbPath[lbVolLen:] (lbN code
// units), "volAndPath" is lbPath. The buffer is a reused scratch array.
let cleanBuf = new Uint16Array(256);
let lbPath = "";
let lbVolLen = 0;
let lbN = 0;
let lbBuf                     = null;
let lbW = 0;

function lbIndex(i        )         {
  if (lbBuf !== null) return lbBuf[i];
  return lbPath.charCodeAt(lbVolLen + i);
}

function lbAppend(c        ) {
  if (lbBuf === null) {
    if (lbW < lbN && lbPath.charCodeAt(lbVolLen + lbW) === c) {
      lbW++;
      return;
    }
    if (cleanBuf.length < lbN) cleanBuf = new Uint16Array(lbN * 2);
    lbBuf = cleanBuf;
    for (let i = 0; i < lbW; i++) lbBuf[i] = lbPath.charCodeAt(lbVolLen + i);
  }
  lbBuf[lbW] = c;
  lbW++;
}

function stringFromCharCodes(buf             , n        )         {
  if (n <= 4096) return String.fromCharCode.apply(null, buf.subarray(0, n)       );
  let s = "";
  for (let i = 0; i < n; i += 4096) s += String.fromCharCode.apply(null, buf.subarray(i, Math.min(n, i + 4096))       );
  return s;
}

export class goFilepath {
  ;                   
  ;                          
  ;                              // a char code
  ;                    // JS-only: string(pathSeparator)
  ;                  // JS-only: for "os.Lstat" and "os.Readlink"
  constructor(cwd        , isWindows         , host     ) {
    this.cwd = cwd;
    this.isWindows = isWindows;
    this.pathSeparator = isWindows ? BACKSLASH : SLASH;
    this.sep = isWindows ? "\\" : "/";
    this.host = host;
  }

  // IsAbs reports whether the path is absolute.
  isAbs(path        )          {
    if (!this.isWindows) return path.charCodeAt(0) === SLASH;
    if (isReservedName(path)) return true;
    const l = this.volumeNameLen(path);
    if (l === 0) return false;
    if (l === path.length) return false;
    return isSlash(path.charCodeAt(l));
  }

  // Abs returns an absolute representation of path.
  abs(path        )         {
    if (this.isAbs(path)) return this.clean(path);
    return this.join2(this.cwd, path);
  }

  // IsPathSeparator reports whether c is a directory separator character.
  isPathSeparator(c        )          {
    return c === SLASH || (this.isWindows && c === BACKSLASH);
  }

  // volumeNameLen returns length of the leading volume name on Windows.
  // It returns 0 elsewhere.
  volumeNameLen(path        )         {
    if (!this.isWindows) return 0;
    const l = path.length;
    if (l < 2) return 0;
    // with drive letter
    const c = path.charCodeAt(0);
    if (path.charCodeAt(1) === COLON && ((c >= 97 && c <= 122) || (c >= 65 && c <= 90))) return 2;
    // is it UNC? https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx
    if (l >= 5 && isSlash(path.charCodeAt(0)) && isSlash(path.charCodeAt(1)) && !isSlash(path.charCodeAt(2)) && path.charCodeAt(2) !== DOT) {
      // first, leading `\\` and next shouldn't be `\`. its server name.
      for (let n = 3; n < l - 1; n++) {
        // second, next '\' shouldn't be repeated.
        if (isSlash(path.charCodeAt(n))) {
          n++;
          // third, following something characters. its share name.
          if (!isSlash(path.charCodeAt(n))) {
            if (path.charCodeAt(n) === DOT) break;
            for (; n < l; n++) {
              if (isSlash(path.charCodeAt(n))) break;
            }
            return n;
          }
          break;
        }
      }
    }
    return 0;
  }

  // EvalSymlinks returns the path name after the evaluation of any symbolic
  // links. Returns the path or an error object.
  evalSymlinks(path        )               {
    let volLen = this.volumeNameLen(path);
    const pathSeparator = this.sep;

    if (volLen < path.length && this.isPathSeparator(path.charCodeAt(volLen))) volLen++;
    let vol = path.slice(0, volLen);
    let dest = vol;
    let linksWalked = 0;
    for (let start = volLen, end = volLen; start < path.length; start = end) {
      while (start < path.length && this.isPathSeparator(path.charCodeAt(start))) start++;
      end = start;
      while (end < path.length && !this.isPathSeparator(path.charCodeAt(end))) end++;

      // On Windows, "." can be a symlink.
      // We look it up, and use the value if it is absolute.
      // If not, we just return ".".
      let isWindowsDot = false;
      if (this.isWindows) {
        const v = this.volumeNameLen(path);
        isWindowsDot = path.length === v + 1 && path.charCodeAt(v) === DOT;
      }

      // The next path component is in path[start:end].
      if (end === start) {
        // No more path components.
        break;
      } else if (end - start === 1 && path.charCodeAt(start) === DOT && !isWindowsDot) {
        // Ignore path component ".".
        continue;
      } else if (end - start === 2 && path.charCodeAt(start) === DOT && path.charCodeAt(start + 1) === DOT) {
        // Back up to previous component if possible.
        // Note that volLen includes any leading slash.

        // Set r to the index of the last slash in dest,
        // after the volume.
        let r        ;
        for (r = dest.length - 1; r >= volLen; r--) {
          if (this.isPathSeparator(dest.charCodeAt(r))) break;
        }
        if (r < volLen || dest.slice(r + 1) === "..") {
          // Either path has no slashes
          // (it's empty or just "C:")
          // or it ends in a ".." we had to keep.
          // Either way, keep this "..".
          if (dest.length > volLen) dest += pathSeparator;
          dest += "..";
        } else {
          // Discard everything since the last slash.
          dest = dest.slice(0, r);
        }
        continue;
      }

      // Ordinary path component. Add it to result.

      if (dest.length > this.volumeNameLen(dest) && !this.isPathSeparator(dest.charCodeAt(dest.length - 1))) {
        dest += pathSeparator;
      }

      dest += path.slice(start, end);

      // Resolve symlink.

      const fi = osLstat(this.host, dest);
      if (typeof fi !== "number") return fi;

      if (fi !== S_IFLNK) {
        if (fi !== S_IFDIR && end < path.length) return ENOTDIR;
        continue;
      }

      // Found symlink.

      linksWalked++;
      if (linksWalked > 255) return new GoError("EvalSymlinks: too many links");

      const link = osReadlink(this.host, dest);
      if (typeof link !== "string") return link;

      if (isWindowsDot && !this.isAbs(link)) {
        // On Windows, if "." is a relative symlink,
        // just return ".".
        break;
      }

      path = link + path.slice(end);

      let v = this.volumeNameLen(link);
      if (v > 0) {
        // Symlink to drive name is an absolute path.
        if (v < link.length && this.isPathSeparator(link.charCodeAt(v))) v++;
        vol = link.slice(0, v);
        dest = vol;
        end = vol.length;
      } else if (link.length > 0 && this.isPathSeparator(link.charCodeAt(0))) {
        // Symlink to absolute path.
        dest = link.slice(0, 1);
        end = 1;
      } else {
        // Symlink to relative path; replace last
        // path component in dest.
        let r        ;
        for (r = dest.length - 1; r >= volLen; r--) {
          if (this.isPathSeparator(dest.charCodeAt(r))) break;
        }
        if (r < volLen) {
          dest = vol;
        } else {
          dest = dest.slice(0, r);
        }
        end = 0;
      }
    }
    return this.clean(dest);
  }

  // FromSlash returns the result of replacing each slash ('/') character
  // in path with a separator character.
  fromSlash(path        )         {
    if (!this.isWindows) return path;
    return path.indexOf("/") === -1 ? path : path.replaceAll("/", "\\");
  }

  // Clean returns the shortest path name equivalent to path by purely
  // lexical processing. (Go's lazybuf is emulated with "buf"/"w": the output
  // is only copied once it diverges from the input.)
  clean(originalPath        )         {
    const volLen = this.volumeNameLen(originalPath);
    const n = originalPath.length - volLen;
    if (n === 0) {
      if (volLen > 1 && originalPath.charCodeAt(1) !== COLON) {
        // should be UNC
        return this.fromSlash(originalPath);
      }
      return originalPath + ".";
    }
    // JS-only fast path: a path that is already clean (no empty, "." or ".."
    // elements, no trailing separator) comes out of the loop below unchanged
    // (up to "/" vs "\" on Windows, which fromSlash evens out)
    if (this.isAlreadyClean(originalPath, volLen)) return this.fromSlash(originalPath);

    const sep = this.pathSeparator;
    const rooted = this.isPathSeparator(originalPath.charCodeAt(volLen));

    // Invariants:
    //	reading from path; r is index of next byte to process.
    //	writing to buf; w is index of next byte to write.
    //	dotdot is index in buf where .. must stop, either because
    //		it is the leading slash or it is a leading ../../.. prefix.
    // (Go's lazybuf lives in the module-level "lb*" variables; clean is not
    // reentrant)
    lbPath = originalPath;
    lbVolLen = volLen;
    lbN = n;
    lbBuf = null;
    lbW = 0;
    let r = 0;
    let dotdot = 0;

    if (rooted) {
      lbAppend(sep);
      r = 1;
      dotdot = 1;
    }

    while (r < n) {
      const c = originalPath.charCodeAt(volLen + r);
      if (this.isPathSeparator(c)) {
        // empty path element
        r++;
      } else if (c === DOT && (r + 1 === n || this.isPathSeparator(originalPath.charCodeAt(volLen + r + 1)))) {
        // . element
        r++;
      } else if (
        c === DOT &&
        originalPath.charCodeAt(volLen + r + 1) === DOT &&
        (r + 2 === n || this.isPathSeparator(originalPath.charCodeAt(volLen + r + 2)))
      ) {
        // .. element: remove to last separator
        r += 2;
        if (lbW > dotdot) {
          // can backtrack
          lbW--;
          while (lbW > dotdot && !this.isPathSeparator(lbIndex(lbW))) lbW--;
        } else if (!rooted) {
          // cannot backtrack, but not rooted, so append .. element.
          if (lbW > 0) lbAppend(sep);
          lbAppend(DOT);
          lbAppend(DOT);
          dotdot = lbW;
        }
      } else {
        // real path element.
        // add slash if needed
        if ((rooted && lbW !== 1) || (!rooted && lbW !== 0)) lbAppend(sep);
        // copy element
        for (; r < n; r++) {
          const c2 = originalPath.charCodeAt(volLen + r);
          if (this.isPathSeparator(c2)) break;
          lbAppend(c2);
        }
      }
    }

    // Turn empty string into "."
    if (lbW === 0) lbAppend(DOT);

    let result        ;
    const w = lbW;
    if (lbBuf === null) {
      result = volLen + w === originalPath.length ? originalPath : originalPath.slice(0, volLen + w);
    } else {
      result = originalPath.slice(0, volLen) + stringFromCharCodes(lbBuf, w);
    }
    lbPath = "";
    return this.fromSlash(result);
  }

  // JS-only (see clean)
  isAlreadyClean(p        , volLen        )          {
    const n = p.length;
    let i = volLen;
    if (i < n && this.isPathSeparator(p.charCodeAt(i))) i++;
    if (i === n) return true; // (only the root)
    for (;;) {
      const start = i;
      while (i < n && !this.isPathSeparator(p.charCodeAt(i))) i++;
      const len = i - start;
      if (len === 0) return false;
      if (p.charCodeAt(start) === DOT && (len === 1 || (len === 2 && p.charCodeAt(start + 1) === DOT))) return false;
      if (i === n) return true;
      i++;
      if (i === n) return false;
    }
  }

  // VolumeName returns leading volume name.
  volumeName(path        )         {
    return path.slice(0, this.volumeNameLen(path));
  }

  // Base returns the last element of path.
  base(path        )         {
    if (path === "") return ".";
    // Strip trailing slashes.
    let end = path.length;
    while (end > 0 && this.isPathSeparator(path.charCodeAt(end - 1))) end--;
    if (end !== path.length) path = path.slice(0, end);
    // Throw away volume name
    const vol = this.volumeNameLen(path);
    // Find the last element
    let i = path.length - 1;
    while (i >= vol && !this.isPathSeparator(path.charCodeAt(i))) i--;
    // (i < vol: the whole remainder is the element)
    const start = i >= vol ? i + 1 : vol;
    // If empty now, it had only slashes.
    if (start === path.length) return this.sep;
    return start === 0 ? path : path.slice(start);
  }

  // Dir returns all but the last element of path, typically the path's directory.
  dir(path        )         {
    const volLen = this.volumeNameLen(path);
    let i = path.length - 1;
    while (i >= volLen && !this.isPathSeparator(path.charCodeAt(i))) i--;
    const dir = this.clean(path.slice(volLen, i + 1));
    if (dir === "." && volLen > 2) {
      // must be UNC
      return path.slice(0, volLen);
    }
    return volLen === 0 ? dir : path.slice(0, volLen) + dir;
  }

  // Ext returns the file name extension used by path.
  ext(path        )         {
    for (let i = path.length - 1; i >= 0 && !this.isPathSeparator(path.charCodeAt(i)); i--) {
      if (path.charCodeAt(i) === DOT) return path.slice(i);
    }
    return "";
  }

  // Join joins any number of path elements into a single path.
  join(elem          )         {
    for (let i = 0; i < elem.length; i++) {
      if (elem[i] !== "") {
        if (this.isWindows) return this.joinNonEmpty(i === 0 ? elem : elem.slice(i));
        return this.clean((i === 0 ? elem : elem.slice(i)).join(this.sep));
      }
    }
    return "";
  }

  // JS-only: join([a, b]) without allocating the array
  join2(a        , b        )         {
    if (a === "") {
      if (b === "") return "";
      if (this.isWindows) return this.joinNonEmpty([b]);
      return this.clean(b);
    }
    if (!this.isWindows) return this.clean(a + "/" + b);
    if (a.length === 2 && a.charCodeAt(1) === COLON) {
      // First element is drive letter without terminating slash.
      return this.clean(a + b);
    }
    const p = this.clean(a + "\\" + b);
    if (!this.isUNC(p)) return p;
    return this.joinNonEmpty([a, b]);
  }

  // joinNonEmpty is like join, but it assumes that the first element is non-empty.
  joinNonEmpty(elem          )         {
    const e0 = elem[0];
    if (e0.length === 2 && e0.charCodeAt(1) === COLON) {
      // First element is drive letter without terminating slash.
      // Keep path relative to current directory on that drive.
      // Skip empty elements.
      let i = 1;
      for (; i < elem.length; i++) {
        if (elem[i] !== "") break;
      }
      return this.clean(e0 + elem.slice(i).join(this.sep));
    }
    // The following logic prevents Join from inadvertently creating a
    // UNC path on Windows. Unless the first element is a UNC path, Join
    // shouldn't create a UNC path. See golang.org/issue/9167.
    const p = this.clean(elem.join(this.sep));
    if (!this.isUNC(p)) return p;
    // p == UNC only allowed when the first element is a UNC path.
    const head = this.clean(e0);
    if (this.isUNC(head)) return p;
    // head + tail == UNC, but joining two non-UNC paths should not result
    // in a UNC path. Undo creation of UNC path.
    const tail = this.clean(elem.slice(1).join(this.sep));
    if (head.charCodeAt(head.length - 1) === this.pathSeparator) return head + tail;
    return head + this.sep + tail;
  }

  // isUNC reports whether path is a UNC path.
  isUNC(path        )          {
    return this.volumeNameLen(path) > 2;
  }

  // Rel returns a relative path that is lexically equivalent to targpath when
  // joined to basepath with an intervening separator. Returns null on error.
  rel(basepath        , targpath        )                {
    const baseVolLen = this.volumeNameLen(basepath);
    const targVolLen = this.volumeNameLen(targpath);
    const baseVol = basepath.slice(0, baseVolLen);
    const targVol = targpath.slice(0, targVolLen);
    let base = this.clean(basepath);
    let targ = this.clean(targpath);
    if (this.sameWord(targ, base)) return ".";
    base = base.slice(baseVolLen);
    targ = targ.slice(targVolLen);
    if (base === ".") base = "";
    // Can't use IsAbs - `\a` and `a` are both relative in Windows.
    const sep = this.pathSeparator;
    const baseSlashed = base.length > 0 && base.charCodeAt(0) === sep;
    const targSlashed = targ.length > 0 && targ.charCodeAt(0) === sep;
    if (baseSlashed !== targSlashed || !this.sameWord(baseVol, targVol)) return null;
    // Position base[b0:bi] and targ[t0:ti] at the first differing elements.
    const bl = base.length;
    const tl = targ.length;
    let b0 = 0;
    let bi = 0;
    let t0 = 0;
    let ti = 0;
    for (;;) {
      while (bi < bl && base.charCodeAt(bi) !== sep) bi++;
      while (ti < tl && targ.charCodeAt(ti) !== sep) ti++;
      if (!this.sameWord(targ.slice(t0, ti), base.slice(b0, bi))) break;
      if (bi < bl) bi++;
      if (ti < tl) ti++;
      b0 = bi;
      t0 = ti;
    }
    if (bi - b0 === 2 && base.charCodeAt(b0) === DOT && base.charCodeAt(b0 + 1) === DOT) return null;
    if (b0 !== bl) {
      // Base elements left. Must go up before going down.
      let seps = 0;
      for (let i = b0; i < bl; i++) if (base.charCodeAt(i) === sep) seps++;
      let buf = "..";
      for (let i = 0; i < seps; i++) buf += this.sep + "..";
      if (t0 !== tl) buf += this.sep + targ.slice(t0);
      return buf;
    }
    return targ.slice(t0);
  }

  sameWord(a        , b        )          {
    if (!this.isWindows) return a === b;
    return a === b || goEqualFold(a, b);
  }
}

// ---------------------------------------------------------------------------
// iswin_wasm.go

const checkedIfWindows = new Map              ();

// Hack: Assume that we're on Windows if we're running WebAssembly and
// the "C:\\" directory exists. (Go caches this per process; this caches it
// per host.)
export function checkIfWindows(host     )          {
  let cached = checkedIfWindows.get(host);
  if (cached === undefined) {
    cached = !(osStat(host, "C:\\") instanceof PathError);
    checkedIfWindows.set(host, cached);
  }
  return cached;
}

// ---------------------------------------------------------------------------
// fs_zip.go

// zipFile (Go's "reader" is the list of files here)
class zipFile {
  ;                
  ;                                               
  ;                                                 
  constructor() {
    this.err = null;
    this.dirs = null;
    this.files = null;
  }
}

class compressedDir {
  ;                                     // name -> EntryKind
  ;                    

  // Compatible entries are decoded lazily
  ;                                     
  constructor(path        ) {
    this.entries = new Map();
    this.path = path;
    this.dirEntries = null;
  }
}

class compressedFile {
  ;                           

  // The file is decompressed lazily
  ;                                   
  ;                
  ;                        
  constructor(compressed         ) {
    this.compressed = compressed;
    this.contents = null;
    this.err = null;
    this.wasRead = false;
  }
}

function tryToReadZipArchive(host     , zipPath        , archive         ) {
  // (zip.OpenReader: os.Open, Stat, and reads from the file, which this
  // reads at once)
  const r = osReadFile(host, zipPath);
  if (r[1] !== null) {
    archive.err = r[1];
    return;
  }
  const $z = openZipReader(r[0]              , zipPath);
  if ($z[1] !== null) {
    archive.err = $z[1];
    return;
  }
  const reader = $z[0]             ;

  const dirs = new Map                       ();
  const files = new Map                        ();
  const seeds           = [];

  // Build an index of all files in the archive
  for (const file of reader) {
    let baseName = file.name.endsWith("/") ? file.name.slice(0, -1) : file.name;
    let dirPath = "";
    const slash = baseName.lastIndexOf("/");
    if (slash !== -1) {
      dirPath = baseName.slice(0, slash);
      baseName = baseName.slice(slash + 1);
    }
    if (file.isDir()) {
      // Handle a directory
      const lowerDir = goStringsToLower(dirPath);
      if (!dirs.has(lowerDir)) {
        const dir = new compressedDir(dirPath);

        // List the same directory both with and without the slash
        dirs.set(lowerDir, dir);
        dirs.set(lowerDir + "/", dir);
        seeds.push(lowerDir);
      }
    } else {
      // Handle a file
      files.set(goStringsToLower(file.name), new compressedFile(file));
      const lowerDir = goStringsToLower(dirPath);
      let dir = dirs.get(lowerDir);
      if (dir === undefined) {
        dir = new compressedDir(dirPath);

        // List the same directory both with and without the slash
        dirs.set(lowerDir, dir);
        dirs.set(lowerDir + "/", dir);
        seeds.push(lowerDir);
      }
      dir.entries.set(baseName, FileEntry);
    }
  }

  // Populate child directories
  for (let baseName of seeds) {
    while (baseName !== "") {
      let dirPath = "";
      const slash = baseName.lastIndexOf("/");
      if (slash !== -1) {
        dirPath = baseName.slice(0, slash);
        baseName = baseName.slice(slash + 1);
      }
      const lowerDir = goStringsToLower(dirPath);
      let dir = dirs.get(lowerDir);
      if (dir === undefined) {
        dir = new compressedDir(dirPath);

        // List the same directory both with and without the slash
        dirs.set(lowerDir, dir);
        dirs.set(lowerDir + "/", dir);
      }
      dir.entries.set(baseName, DirEntry);
      baseName = dirPath;
    }
  }

  archive.dirs = dirs;
  archive.files = files;
}

function indexAnySlash(s        , from        )         {
  for (let i = from; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === SLASH || c === BACKSLASH) return i;
  }
  return -1;
}

function lastIndexAnySlash(s        , end        )         {
  for (let i = end - 1; i >= 0; i--) {
    const c = s.charCodeAt(i);
    if (c === SLASH || c === BACKSLASH) return i;
  }
  return -1;
}

// strconv.ParseInt(count, 10, 64) succeeding
function goParseInt(s        )                {
  let i = 0;
  if (s.length > 0 && (s.charCodeAt(0) === 43 || s.charCodeAt(0) === 45)) i = 1;
  if (i === s.length) return null;
  for (let j = i; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c < 48 || c > 57) return null;
  }
  const n = Number(s);
  if (!(Math.abs(n) <= 9223372036854775807)) return null;
  // (Values beyond 2^53 are only compared with zero and counted down while
  // there are directories left, so precision does not matter)
  return n;
}

// Returns [prefix, suffix] or null (Go's ok == false)
export function parseYarnPnPVirtualPath(path        )                          {
  // JS-only fast path: both special segments must appear literally
  if (path.indexOf("__virtual__") === -1 && path.indexOf("$$virtual") === -1) return null;

  let i = 0;
  for (;;) {
    const start = i;
    const slash = indexAnySlash(path, i);
    if (slash === -1) break;
    i = slash + 1;

    // Replace the segments "__virtual__/<segment>/<n>" with N times the ".."
    // operation.
    const segment = path.slice(start, i - 1);
    if (segment === "__virtual__" || segment === "$$virtual") {
      const slash2 = indexAnySlash(path, i);
      if (slash2 !== -1) {
        let count        ;
        let suffix = "";
        const j = slash2 + 1;

        // Find the range of the count
        const slash3 = indexAnySlash(path, j);
        if (slash3 !== -1) {
          count = path.slice(j, slash3);
          suffix = path.slice(slash3);
        } else {
          count = path.slice(j);
        }

        // Parse the count
        let n = goParseInt(count);
        if (n !== null) {
          let prefix = path.slice(0, start);

          // Apply N times the ".." operator
          while (n > 0 && (prefix.endsWith("/") || prefix.endsWith("\\"))) {
            const s = lastIndexAnySlash(prefix, prefix.length - 1);
            if (s === -1) break;
            prefix = prefix.slice(0, s + 1);
            n--;
          }

          // Make sure the prefix and suffix work well when joined together
          if (suffix === "" && indexAnySlash(prefix, 0) !== lastIndexAnySlash(prefix, prefix.length)) {
            prefix = prefix.slice(0, prefix.length - 1);
          } else if (prefix === "") {
            prefix = ".";
          } else if (suffix.startsWith("/") || suffix.startsWith("\\")) {
            suffix = suffix.slice(1);
          }

          return [prefix, suffix];
        }
      }
    }
  }

  return null;
}

function mangleYarnPnPVirtualPath(path        )         {
  const r = parseYarnPnPVirtualPath(path);
  if (r !== null) return r[0] + r[1];
  return path;
}

// ---------------------------------------------------------------------------
// fs_real.go

export class RealFSOptions {
  ;                             
  ;                              
  ;                           
  constructor(absWorkingDir = "", wantWatchData = false, doNotCache = false) {
    this.absWorkingDir = absWorkingDir;
    this.wantWatchData = wantWatchData;
    this.doNotCache = doNotCache;
  }
}

// fs.RealFS: returns [fs, errorText]. (Go returns an error value; its text is
// returned here.) The result also implements Go's zipFS wrapper.
export function realFS(options               , host     )                             {
  const isWindows = checkIfWindows(host);
  const fp = new goFilepath("", isWindows, host);

  // Come up with a default working directory if one was not specified
  fp.cwd = options.absWorkingDir;
  if (fp.cwd === "") {
    const cwd = osGetwd(host);
    if (cwd !== null) {
      fp.cwd = cwd;
    } else if (fp.isWindows) {
      fp.cwd = "C:\\";
    } else {
      fp.cwd = "/";
    }
  } else if (!fp.isAbs(fp.cwd)) {
    return [null, `The working directory ${goQuote(fp.cwd)} is not an absolute path`];
  }

  // Resolve symlinks in the current working directory. This deliberately
  // ignores errors due to e.g. infinite loops.
  const path = fp.evalSymlinks(fp.cwd);
  if (typeof path === "string") fp.cwd = path;

  // Only allocate memory for watch data if necessary
  let watchData                                       = null;
  if (options.wantWatchData) {
    watchData = new Map();
  }

  return [new realFSImpl(fp, options.doNotCache, watchData), null];
}

// watchState
const stateNone = 0;
const stateDirHasAccessedEntries = 1; // Compare "accessedEntries"
const stateDirUnreadable = 2; // Compare directory readability
const stateFileHasModKey = 3; // Compare "modKey"
const stateFileNeedModKey = 4; // Need to transition to "stateFileHasModKey" or "stateFileUnusableModKey" before "WatchData()" returns
const stateFileMissing = 5; // Compare file presence
const stateFileUnusableModKey = 6; // Compare "fileContents"

class privateWatchData {
                                                  
                                           // (Go: a string; null is "")
                         
                        
  constructor(accessedEntries                         = null, fileContents                    = null, modKey = ZERO_MOD_KEY, state = stateNone) {
    this.accessedEntries = accessedEntries;
    this.fileContents = fileContents;
    this.modKey = modKey;
    this.state = state;
  }
  clone()                   {
    return new privateWatchData(this.accessedEntries, this.fileContents, this.modKey, this.state);
  }
}

// Go's string(a) == string(b) for file contents (null is the empty string)
function sameBytes(a                   , b                   )          {
  const n = a === null ? 0 : a.length;
  if (n !== (b === null ? 0 : b.length)) return false;
  for (let i = 0; i < n; i++) if (a [i] !== b [i]) return false;
  return true;
}

// Minimal Go %q for error texts (ASCII printable only; others escaped)
function goQuote(s        )         {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34 || c === 92) out += "\\" + s[i];
    else if (c >= 0x20 && c < 0x7f) out += s[i];
    else if (c === 10) out += "\\n";
    else if (c === 9) out += "\\t";
    else if (c === 13) out += "\\r";
    else out += s[i];
  }
  return out + '"';
}

// Go's realFS wrapped in zipFS (named realFSImpl here because "realFS" is
// the constructor function). The cached readDirectory tuples are returned as
// is (immutable).
export class realFSImpl               {
  ;                                                    
  ;                      
  ;                                  
  ;                 
  ;                                      
  // This stores data that will end up being returned by "WatchData()"
  ;                                                        
  constructor(fp            , doNotCacheEntries         , watchData                                       = null) {
    this.entries = new Map();
    this.fp = fp;
    this.doNotCacheEntries = doNotCacheEntries;
    this.host = fp.host;
    this.zipFiles = new Map();
    this.watchData_ = watchData;
  }

  // zipFS.ReadDirectory + realFS.ReadDirectory
  readDirectory(dir        )                         {
    dir = mangleYarnPnPVirtualPath(dir);
    const result = this.realReadDirectory(dir);

    // Only continue if reading this path as a directory caused an error that's
    // consistent with trying to read a zip file as a directory.
    const canonicalError = result[1];
    if (canonicalError !== ENOENT && canonicalError !== ENOTDIR && canonicalError !== EINVAL) return result;

    // If the directory doesn't exist, try reading from an enclosing zip archive
    const $z = this.checkForZip(dir, DirEntry);
    const zip = $z[0];
    if (zip === null) {
      return result;
    }

    // Does the zip archive have this directory?
    const d = (zip.dirs                              ).get(goStringsToLower($z[1]));
    if (d === undefined) {
      return [new DirEntries(), ENOENT, ENOENT];
    }

    // Check whether it has already been converted
    if (d.dirEntries !== null) {
      return [d.dirEntries, null, null];
    }

    // Otherwise, fill in the entries
    const data = new Map               ();
    for (const [name, kind] of d.entries) {
      data.set(goStringsToLower(name), new Entry(dir, name, kind));
    }
    d.dirEntries = new DirEntries(dir, data);
    return [d.dirEntries, null, null];
  }

  realReadDirectory(dir        )                         {
    if (!this.doNotCacheEntries) {
      // First, check the cache
      const cached = this.entries.get(dir);
      if (cached !== undefined) {
        // Cache hit: stop now
        return cached;
      }
    }

    // Cache miss: read the directory entries
    const r = this.readdir(dir);
    const names = r[0];
    let canonicalError = r[1];
    const originalError = r[2];
    let entries            ;

    // Unwrap to get the underlying error
    if (canonicalError instanceof PathError) canonicalError = canonicalError.unwrap();

    if (canonicalError === null) {
      const data = new Map               ();
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        // Call "stat" lazily for performance.
        data.set(goStringsToLower(name), new Entry(dir, name, 0, true));
      }
      entries = new DirEntries(dir, data);
    } else {
      // Update the cache unconditionally. Even if the read failed, we don't want to
      // retry again later. The directory is inaccessible so trying again is wasted.
      entries = new DirEntries(dir, null);
    }

    // Store data for watch mode
    if (this.watchData_ !== null) {
      let state = stateDirHasAccessedEntries;
      if (canonicalError !== null) {
        state = stateDirUnreadable;
      }
      entries.accessedEntries = new AccessedEntries();
      this.watchData_.set(dir, new privateWatchData(entries.accessedEntries, null, ZERO_MOD_KEY, state));
    }

    const result                         = [entries, canonicalError, originalError];
    if (!this.doNotCacheEntries) this.entries.set(dir, result);
    return result;
  }

  // zipFS.ReadFile + realFS.ReadFile
  readFile(path        )                                {
    path = mangleYarnPnPVirtualPath(path);
    const r = osReadFile(this.host, path);
    const originalError = r[1];
    const canonicalError = this.canonicalizeError(originalError);

    // Store data for watch mode
    if (this.watchData_ !== null) {
      const old = this.watchData_.get(path);
      const data = old !== undefined ? old.clone() : new privateWatchData();
      if (canonicalError !== null) {
        data.state = stateFileMissing;
      } else if (old === undefined || data.state === stateDirUnreadable) {
        // Note: If "ReadDirectory" is called before "ReadFile" with this same
        // path, then "data.state" will be "stateDirUnreadable". In that case
        // we want to transition to "stateFileNeedModKey" because it's a file.
        data.state = stateFileNeedModKey;
      }
      data.fileContents = r[0];
      this.watchData_.set(path, data);
    }

    // (Go returns the partially read contents with an error; nobody uses them)
    if (canonicalError !== ENOENT) {
      return [canonicalError === null ? r[0] : null, canonicalError, originalError];
    }

    // If the file doesn't exist, try reading from an enclosing zip archive
    const $z = this.checkForZip(path, FileEntry);
    const zip = $z[0];
    if (zip === null) {
      return [null, canonicalError, originalError];
    }

    // Does the zip archive have this file?
    const file = (zip.files                               ).get(goStringsToLower($z[1]));
    if (file === undefined) {
      return [null, ENOENT, ENOENT];
    }

    // Check whether it has already been read
    if (file.wasRead) {
      return [file.contents, file.err, file.err];
    }
    file.wasRead = true;

    // If not, try to open it and read it
    const $r = file.compressed.readAll();
    if ($r[1] !== null) {
      file.err = $r[1];
      return [null, $r[1], $r[1]];
    }
    file.contents = $r[0];
    return [file.contents, null, null];
  }

  modKey(path        )                {
    path = mangleYarnPnPVirtualPath(path);
    const [key, err] = modKey(this.host, path);

    // Store data for watch mode
    if (this.watchData_ !== null) {
      const old = this.watchData_.get(path);
      const data = old !== undefined ? old.clone() : new privateWatchData();
      if (old === undefined) {
        if (err === modKeyUnusable) {
          data.state = stateFileUnusableModKey;
        } else if (err !== null) {
          data.state = stateFileMissing;
        } else {
          data.state = stateFileHasModKey;
        }
      } else if (data.state === stateFileNeedModKey) {
        data.state = stateFileHasModKey;
      }
      data.modKey = key;
      this.watchData_.set(path, data);
    }

    return [key, err];
  }

  isAbs(p        )          {
    return this.fp.isAbs(p);
  }

  abs(p        )                    {
    return [this.fp.abs(p), true];
  }

  // zipFS.Dir
  dir(p        )         {
    const v = parseYarnPnPVirtualPath(p);
    if (v !== null && v[1] === "") return v[0];
    return this.fp.dir(p);
  }

  base(p        )         {
    return this.fp.base(p);
  }

  ext(p        )         {
    return this.fp.ext(p);
  }

  // Go's variadic Join(parts...) (up to four parts here)
  join(a        , b         , c         , d         )         {
    const fp = this.fp;
    if (b === undefined) return fp.clean(fp.join([a]));
    if (c === undefined) return fp.clean(fp.join2(a, b));
    if (d === undefined) return fp.clean(fp.join([a, b, c]));
    return fp.clean(fp.join([a, b, c, d]));
  }

  cwd()         {
    return this.fp.cwd;
  }

  rel(base        , target        )                    {
    const rel = this.fp.rel(base, target);
    if (rel !== null) return [rel, true];
    return ["", false];
  }

  evalSymlinks(path        )                    {
    const p = this.fp.evalSymlinks(path);
    if (typeof p === "string") return [p, true];
    return ["", false];
  }

  // Returns [names, canonicalError, originalError]
  readdir(dirname        )                       {
    const host = this.host;
    if (host !== null && checkPath(dirname) === null) {
      // Fast path: a successful "readdir" gives the same names as Go's
      // open/fstat/readdir sequence. Failures redo Go's sequence to get its
      // error.
      let names                  = null;
      try {
        names = host.readdirSync(hostPath(dirname));
      } catch {}
      if (names !== null) {
        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          if (!name.isWellFormed()) names[i] = name.toWellFormed();
        }
        return [names, null, null];
      }
    }

    const f = osOpen(host, dirname);
    if (f instanceof PathError) {
      const canonicalError = this.canonicalizeError(f);
      return [null       , canonicalError, f];
    }
    osClose(host, f.fd);

    // f.Readdirnames(-1): Go's WebAssembly implementation returns EINVAL
    // instead of ENOTDIR if we call "readdir" on a file. Canonicalize this to
    // ENOTDIR so esbuild's path resolution code continues traversing instead
    // of failing with an error.
    if (f.entries === null) {
      return [null       , ENOTDIR, new PathError("readdirent", dirname, EINVAL)];
    }
    const names = f.entries;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (!name.isWellFormed()) names[i] = name.toWellFormed();
    }
    return [names, null, null];
  }

  canonicalizeError(err     )      {
    // Unwrap to get the underlying error
    if (err instanceof PathError) err = err.unwrap();

    // (Windows' ERROR_INVALID_NAME: Go's js/wasm port never produces
    // Errno(123), node reports ENOENT for invalid names)

    // Windows returns ENOTDIR here even though nothing we've done yet has asked
    // for a directory. This really means ENOENT on Windows.
    if (err === ENOTDIR) err = ENOENT;

    return err;
  }

  // Returns [symlink, kind]
  kind(dir        , base        )                   {
    const entryPath = this.fp.join2(dir, base);

    // Use "lstat" since we want information about symbolic links
    let mode = osLstat(this.host, entryPath);
    if (typeof mode !== "number") return ["", 0];
    let symlink = "";

    // Follow symlinks now so the cache contains the translation
    if (mode === S_IFLNK) {
      const link = this.fp.evalSymlinks(entryPath);
      if (typeof link !== "string") return ["", 0]; // Skip over this entry

      // Re-run "lstat" on the symlink target to see if it's a file or not
      const mode2 = osLstat(this.host, link);
      if (typeof mode2 !== "number") return ["", 0]; // Skip over this entry
      mode = mode2;
      if (mode === S_IFLNK) return ["", 0]; // This should no longer be a symlink, so this is unexpected
      symlink = link;
    }

    // We consider the entry either a directory or a file
    return [symlink, mode === S_IFDIR ? DirEntry : FileEntry];
  }

  watchData()            {
    const paths = new Map                      ();
    if (this.watchData_ === null) return new WatchData(paths);
    const host = this.host;

    for (const [path, data0] of this.watchData_) {
      // Each closure below needs its own copy of these loop variables
      const data = data0.clone();

      // Each function should return true if the state has been changed
      if (data.state === stateFileNeedModKey) {
        const [key, err] = modKey(host, path);
        if (err === modKeyUnusable) {
          data.state = stateFileUnusableModKey;
        } else if (err !== null) {
          data.state = stateFileMissing;
        } else {
          data.state = stateFileHasModKey;
          data.modKey = key;
        }
      }

      switch (data.state) {
        case stateDirUnreadable:
          paths.set(path, () => {
            const [, err] = this.readdir(path);
            if (err === null) {
              return path;
            }
            return "";
          });
          break;

        case stateDirHasAccessedEntries:
          paths.set(path, () => {
            const [names, err] = this.readdir(path);
            if (err !== null) {
              return path;
            }
            const allEntries = data.accessedEntries .allEntries;
            if (allEntries !== null) {
              // Check all entries
              if (names.length !== allEntries.length) {
                return path;
              }
              names.sort(goStringCompare);
              for (let i = 0; i < names.length; i++) {
                if (names[i] !== allEntries[i]) {
                  return path;
                }
              }
            } else {
              // Check individual entries
              const lookup = new Map                ();
              for (const name of names) {
                lookup.set(goStringsToLower(name), name);
              }
              // (Go iterates a map in random order: the first changed entry
              // found is reported)
              for (const [name, wasPresent] of data.accessedEntries .wasPresent) {
                const originalName = lookup.get(name);
                if (wasPresent !== (originalName !== undefined)) {
                  return this.join(path, originalName === undefined ? "" : originalName);
                }
              }
            }
            return "";
          });
          break;

        case stateFileMissing:
          paths.set(path, () => {
            const st = osStat(host, path);
            if (!(st instanceof PathError) && (st.mode & S_IFMT) !== S_IFDIR) {
              return path;
            }
            return "";
          });
          break;

        case stateFileHasModKey:
          paths.set(path, () => {
            const [key, err] = modKey(host, path);
            if (err !== null || !key.equals(data.modKey)) {
              return path;
            }
            return "";
          });
          break;

        case stateFileUnusableModKey:
          paths.set(path, () => {
            const [buffer, err] = osReadFile(host, path);
            if (err !== null || !sameBytes(buffer, data.fileContents)) {
              return path;
            }
            return "";
          });
          break;
      }
    }

    return new WatchData(paths);
  }

  // zipFS.checkForZip: [archive or null, pathTail]
  checkForZip(path        , kind        )                           {
    let zipPath        ;
    let pathTail = "";

    // Do a quick check for a ".zip" in the path at all
    path = path.replaceAll("\\", "/");
    const i = path.indexOf(".zip/");
    if (i !== -1) {
      zipPath = path.slice(0, i + ".zip".length);
      pathTail = path.slice(i + ".zip/".length);
    } else if (kind === DirEntry && path.endsWith(".zip")) {
      zipPath = path;
    } else {
      return [null, ""];
    }

    // If there is one, then check whether it's a file on the file system or not
    let archive = this.zipFiles.get(zipPath);
    if (archive === undefined) {
      archive = new zipFile();
      this.zipFiles.set(zipPath, archive);

      // Try reading the zip archive if it's not in the cache
      tryToReadZipArchive(this.host, zipPath, archive);
    }

    if (archive.err !== null) {
      return [null, ""];
    }
    return [archive, pathTail];
  }
}

// ---------------------------------------------------------------------------
// JS-only: text decoding


// Go keeps file contents as bytes; the JS port works on strings. Decode the
// bytes as UTF-8, keeping a BOM like Go does (raw bytes of invalid UTF-8
// become lone surrogates: see helpers.decodeGoString).
export function decodeUTF8(bytes            )         {
  return decodeGoString(bytes);
}
// generated from fs.mts by tools/ts-build.mjs; edit that file
