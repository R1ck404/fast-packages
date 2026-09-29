// esbuild's command line: cmd/esbuild/main.go (main, with main_wasm.go's
// WebAssembly specifics: esbuild-wasm is what bin/esbuild runs), the
// service mode (service.go's runService), and pkg/cli's Run (cli_impl.go
// runImpl, serveImpl, parseServeOptionsImpl, addAnalyzePlugin;
// mangle_cache.go).
//
// The host (node_host.mts) provides the process: its file system, stdin, and
// exit. Go's stdout and stderr are logger's (setStdout / setStderrBytes).

import { useTimer } from "./timer.mjs";
import * as api from "./cli.mjs";
import { parseOptionsImpl, parseOptionsForRun, filterAnalyzeFlags, splitWithEmptyCheck, kindInternal, analyzeDisabled, analyzeVerbose, makeErrorWithNote } from "./cli.mjs";
import {
  API,
  CLIAPI,
  JSAPI,
  Colors,
  LevelSilent,
  LevelInfo,
  Path,
  RANGE_ZERO,
  Range,
  Source,
  LineColumnTracker,
  newStderrLog,
  outputOptionsForArgs,
  printText,
  printTextWithColor,
  printErrorToStderr,
  printErrorWithNoteToStderr,
  writeStdout,
  writeStdoutBytes,
  writeStderr,
  Error as MsgError,
} from "./logger.mjs";
import { Service, esbuildVersion } from "./service.mjs";
import {
  Plugin,
  PluginBuild,
  BuildResult,
  OnEndResult,
  WatchOptions,
  contextImpl,
  build as apiBuild,
  lookupEnv,
  goStringFromBytes,
} from "./api_build.mjs";
import { transformWithOptions } from "./transform.mjs";
import { analyzeMetafileImpl } from "./build.mjs";
import { realFS as makeRealFS, RealFSOptions, checkIfWindows, mkdirAll, osWriteFile, osGetwd, ENOENT } from "./fs.mjs";
import { makePrettyPaths } from "./build_deps.mjs";
import { parseJSON, JSONOptions } from "./json_parser.mjs";
import { EObject, EBoolean, EString } from "./js_ast.mjs";
import { rangeOfIdentifier } from "./js_lexer.mjs";
import { quoteForJSON } from "./helpers.mjs";
import { goQuote } from "./gostd.mjs";
import { compareStringsUTF8 } from "./js_parser.mjs";
import { encodeWTF8 } from "./service_protocol.mjs";

// What the command line needs from its process
                          
                                
                                                   
                                                                     
                                
                           
                                                             
                              
                                                                       
                          
                                                   
                    
 

const helpText = (colors        )         => {
  // Read "NO_COLOR" from the environment. This is a convention that some
  // software follows. See https://no-color.org/ for more information.
  if (lookupEnv("NO_COLOR") !== undefined) {
    colors = new Colors(false);
  }

  return (
    `
` +
    colors.bold +
    `Usage:` +
    colors.reset +
    `
  esbuild [options] [entry points]

` +
    colors.bold +
    `Documentation:` +
    colors.reset +
    `
  ` +
    colors.underline +
    `https://esbuild.github.io/` +
    colors.reset +
    `

` +
    colors.bold +
    `Repository:` +
    colors.reset +
    `
  ` +
    colors.underline +
    `https://github.com/evanw/esbuild` +
    colors.reset +
    `

` +
    colors.bold +
    `Simple options:` +
    colors.reset +
    `
  --bundle              Bundle all dependencies into the output files
  --define:K=V          Substitute K with V while parsing
  --external:M          Exclude module M from the bundle (can use * wildcards)
  --format=...          Output format (iife | cjs | esm, no default when not
                        bundling, otherwise default is iife when platform
                        is browser and cjs when platform is node)
  --loader:X=L          Use loader L to load file extension X, where L is
                        one of: base64 | binary | copy | css | dataurl |
                        empty | file | global-css | js | json | jsx |
                        local-css | text | ts | tsx
  --minify              Minify the output (sets all --minify-* flags)
  --outdir=...          The output directory (for multiple entry points)
  --outfile=...         The output file (for one entry point)
  --packages=...        Set to "external" to avoid bundling any package
  --platform=...        Platform target (browser | node | neutral,
                        default browser)
  --serve=...           Start a local HTTP server on this host:port for outputs
  --sourcemap           Emit a source map
  --splitting           Enable code splitting (currently only for esm)
  --target=...          Environment target (e.g. es2017, chrome58, firefox57,
                        safari11, edge16, node10, ie9, opera45, default esnext)
  --watch               Watch mode: rebuild on file system changes (stops when
                        stdin is closed, use "--watch=forever" to ignore stdin)

` +
    colors.bold +
    `Advanced options:` +
    colors.reset +
    `
  --abs-paths=...           Emit absolute instead of relative paths in these
                            situations (code | log | metafile)
  --allow-overwrite         Allow output files to overwrite input files
  --analyze                 Print a report about the contents of the bundle
                            (use "--analyze=verbose" for a detailed report)
  --asset-names=...         Path template to use for "file" loader files
                            (default "[name]-[hash]")
  --banner:T=...            Text to be prepended to each output file of type T
                            where T is one of: css | js
  --certfile=...            Certificate for serving HTTPS (see also "--keyfile")
  --charset=utf8            Do not escape UTF-8 code points
  --chunk-names=...         Path template to use for code splitting chunks
                            (default "[name]-[hash]")
  --color=...               Force use of color terminal escapes (true | false)
  --cors-origin=...         Allow cross-origin requests from this origin
  --drop:...                Remove certain constructs (console | debugger)
  --drop-labels=...         Remove labeled statements with these label names
  --entry-names=...         Path template to use for entry point output paths
                            (default "[dir]/[name]", can also use "[hash]")
  --footer:T=...            Text to be appended to each output file of type T
                            where T is one of: css | js
  --global-name=...         The name of the global for the IIFE format
  --ignore-annotations      Enable this to work with packages that have
                            incorrect tree-shaking annotations
  --inject:F                Import the file F into all input files and
                            automatically replace matching globals with imports
  --jsx-dev                 Use React's automatic runtime in development mode
  --jsx-factory=...         What to use for JSX instead of React.createElement
  --jsx-fragment=...        What to use for JSX instead of React.Fragment
  --jsx-import-source=...   Override the package name for the automatic runtime
                            (default "react")
  --jsx-side-effects        Do not remove unused JSX expressions
  --jsx=...                 Set to "automatic" to use React's automatic runtime
                            or to "preserve" to disable transforming JSX to JS
  --keep-names              Preserve "name" on functions and classes
  --keyfile=...             Key for serving HTTPS (see also "--certfile")
  --legal-comments=...      Where to place legal comments (none | inline |
                            eof | linked | external, default eof when bundling
                            and inline otherwise)
  --line-limit=...          Lines longer than this will be wrap onto a new line
  --log-level=...           Disable logging (verbose | debug | info | warning |
                            error | silent, default info)
  --log-limit=...           Maximum message count or 0 to disable (default 6)
  --log-override:X=Y        Use log level Y for log messages with identifier X
  --main-fields=...         Override the main file order in package.json
                            (default "browser,module,main" when platform is
                            browser and "main,module" when platform is node)
  --mangle-cache=...        Save "mangle props" decisions to a JSON file
  --mangle-props=...        Rename all properties matching a regular expression
  --mangle-quoted=...       Enable renaming of quoted properties (true | false)
  --metafile=...            Write metadata about the build to a JSON file
                            (see also: ` +
    colors.underline +
    `https://esbuild.github.io/analyze/` +
    colors.reset +
    `)
  --minify-whitespace       Remove whitespace in output files
  --minify-identifiers      Shorten identifiers in output files
  --minify-syntax           Use equivalent but shorter syntax in output files
  --out-extension:.js=.mjs  Use a custom output extension instead of ".js"
  --outbase=...             The base path used to determine entry point output
                            paths (for multiple entry points)
  --preserve-symlinks       Disable symlink resolution for module lookup
  --public-path=...         Set the base URL for the "file" loader
  --pure:N                  Mark the name N as a pure function for tree shaking
  --reserve-props=...       Do not mangle these properties
  --resolve-extensions=...  A comma-separated list of implicit extensions
                            (default ".tsx,.ts,.jsx,.js,.css,.json")
  --serve-fallback=...      Serve this HTML page when the request doesn't match
  --servedir=...            What to serve in addition to generated output files
  --source-root=...         Sets the "sourceRoot" field in generated source maps
  --sourcefile=...          Set the source file for the source map (for stdin)
  --sourcemap=external      Do not link to the source map with a comment
  --sourcemap=inline        Emit the source map with an inline data URL
  --sources-content=false   Omit "sourcesContent" in generated source maps
  --supported:F=...         Consider syntax F to be supported (true | false)
  --tree-shaking=...        Force tree shaking on or off (false | true)
  --tsconfig=...            Use this tsconfig.json file instead of other ones
  --tsconfig-raw=...        Override all tsconfig.json files with this string
  --version                 Print the current version (` +
    esbuildVersion +
    `) and exit
  --watch-delay=...         Wait before watch mode rebuilds (in milliseconds)

` +
    colors.bold +
    `Examples:` +
    colors.reset +
    `
  ` +
    colors.dim +
    `# Produces dist/entry_point.js and dist/entry_point.js.map` +
    colors.reset +
    `
  esbuild --bundle entry_point.js --outdir=dist --minify --sourcemap

  ` +
    colors.dim +
    `# Allow JSX syntax in .js files` +
    colors.reset +
    `
  esbuild --bundle entry_point.js --outfile=out.js --loader:.js=jsx

  ` +
    colors.dim +
    `# Substitute the identifier RELEASE for the literal true` +
    colors.reset +
    `
  esbuild example.js --outfile=out.js --define:RELEASE=true

  ` +
    colors.dim +
    `# Provide input via stdin, get output via stdout` +
    colors.reset +
    `
  esbuild --minify --loader=ts < input.ts > output.js

  ` +
    colors.dim +
    `# Automatically rebuild when input files are changed` +
    colors.reset +
    `
  esbuild app.ts --bundle --watch

  ` +
    colors.dim +
    `# Start a local HTTP server for everything in "www"` +
    colors.reset +
    `
  esbuild app.ts --bundle --servedir=www --outdir=www/js

`
  );
};

// main_wasm.go
function isServeUnsupported()          {
  return true;
}

// main.go main(). "args" is os.Args[1:].
export function runMain(args          , host         ) {
  API.kind = CLIAPI;

  // (os.Args: the program, then the arguments)
  const goArgs = ["esbuild"].concat(args);
  let heapFile = "";
  let traceFile = "";
  let cpuprofileFile = "";
  let isRunningService = false;
  let sendPings = false;
  let isWatch = false;
  let isWatchForever = false;
  let isServe = false;

  // Do an initial scan over the argument list
  const osArgs           = [];
  for (let arg of args) {
    // Show help if a common help flag is provided
    if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "/?") {
      printText(writeStdout, LevelSilent, goArgs, helpText);
      host.exit(0);
      return;
    }

    // Special-case the version flag here
    if (arg === "--version") {
      writeStdout(esbuildVersion + "\n");
      host.exit(0);
      return;
    }

    if (arg.startsWith("--heap=")) {
      heapFile = arg.slice("--heap=".length);
    } else if (arg.startsWith("--trace=")) {
      traceFile = arg.slice("--trace=".length);
    } else if (arg.startsWith("--timing")) {
      // This is a hidden flag because it's only intended for debugging esbuild
      // itself. The output is not documented and not stable.
      useTimer.value = true;
    } else if (arg.startsWith("--cpuprofile=")) {
      cpuprofileFile = arg.slice("--cpuprofile=".length);
    } else if (arg.startsWith("--service=")) {
      // This flag turns the process into a long-running service that uses
      // message passing with the host process over stdin/stdout
      const hostVersion = arg.slice("--service=".length);
      isRunningService = true;

      // Validate the host's version number to make sure esbuild was installed
      // correctly. This check was added because some people have reported
      // errors that appear to indicate an incorrect installation.
      if (hostVersion !== esbuildVersion) {
        printErrorToStderr(args, "Cannot start service: Host version " + goQuote(hostVersion) + " does not match binary version " + goQuote(esbuildVersion));
        host.exit(1);
        return;
      }
    } else if (arg.startsWith("--ping")) {
      sendPings = true;
    } else {
      // Some people want to be able to run esbuild's watch mode such that it
      // never exits. However, esbuild ends watch mode when stdin is closed
      // because stdin is always closed when the parent process terminates, so
      // ending watch mode when stdin is closed is a good way to avoid
      // accidentally creating esbuild processes that live forever.
      //
      // Explicitly allow processes that live forever with "--watch=forever".
      // This may be a reasonable thing to do in a short-lived VM where all
      // processes in the VM are only started once and then the VM is killed
      // when the processes are no longer needed.
      if (arg === "--watch" || arg === "--watch=true") {
        isWatch = true;
      } else if (arg === "--watch=forever") {
        arg = "--watch";
        isWatch = true;
        isWatchForever = true;
      } else if (arg === "--serve" || arg.startsWith("--serve=") || arg.startsWith("--servedir=") || arg.startsWith("--serve-fallback=")) {
        isServe = true;
      }

      // Strip any arguments that were handled above
      osArgs.push(arg);
    }
  }

  // Run in service mode if requested
  if (isRunningService) {
    runService(sendPings, host);
    return;
  }

  // Print help text when there are no arguments. (GetTerminalInfo on
  // GOOS=js is the zero value: stdin is never a TTY.)
  const isStdinTTY = false;
  if (osArgs.length === 0 && isStdinTTY) {
    printText(writeStdout, LevelSilent, osArgs, helpText);
    host.exit(0);
    return;
  }

  // (main_wasm.go: these flags are not supported by the WebAssembly build)
  if (traceFile !== "") {
    printErrorToStderr(osArgs, 'The "--trace" flag is not supported when using WebAssembly');
    host.exit(1);
    return;
  }
  if (heapFile !== "") {
    printErrorToStderr(osArgs, 'The "--heap" flag is not supported when using WebAssembly');
    host.exit(1);
    return;
  }
  if (cpuprofileFile !== "") {
    printErrorToStderr(osArgs, 'The "--cpuprofile" flag is not supported when using WebAssembly');
    host.exit(1);
    return;
  }

  if (!isWatch && !isServe) {
    // (Go disables its garbage collector here)
  } else if (isServe && isServeUnsupported()) {
    // The development server isn't supported on WebAssembly, so we will
    // immediately exit below. Don't listen to stdin in this case.
  } else if (!isStdinTTY && !isWatchForever) {
    // If stdin isn't a TTY, watch stdin and abort in case it is closed.
    // This is necessary when the esbuild binary executable is invoked via
    // the Erlang VM, which doesn't provide a way to exit a child process.
    // See: https://github.com/brunch/brunch/issues/920.
    const stdinClosed = (isEOF         ) => {
      const options = outputOptionsForArgs(osArgs);
      if (options.logLevel <= LevelInfo) {
        if (isWatch) {
          // Mention why watch mode was stopped to reduce confusion, and
          // call out "--watch=forever" to get the alternative behavior
          printTextWithColor(writeStderr, options.color, (colors) => {
            return colors.dim + '[watch] stopped automatically because stdin was closed (use "--watch=forever" to keep watching even after stdin is closed)' + colors.reset + "\n";
          });
        } else if (isServe) {
          printTextWithColor(writeStderr, options.color, (colors) => {
            return colors.dim + "[serve] stopped automatically because stdin was closed (keep stdin open to continue serving)" + colors.reset + "\n";
          });
        }
      }

      // Only exit cleanly if stdin was closed cleanly
      host.exitNow(isEOF ? 0 : 1);
    };
    // (the data is discarded)
    host.stdin.on("data", () => {});
    host.stdin.on("end", () => stdinClosed(true));
    host.stdin.on("error", () => stdinClosed(false));
  }

  run(osArgs, host).then(
    (exitCode) => host.exit(exitCode),
    (e) => host.panic(e),
  );
}


// service.go runService: the service over stdin/stdout
function runService(sendPings         , host         ) {
  API.kind = JSAPI;
  const service = new Service({
    output: (bytes) => writeStdoutBytes(bytes),
    hostFS: host.fs,
    crash: (error) => host.panic(error),
  });

  // Periodically ping the host even when we're idle. This will catch cases
  // where the host has disappeared and will never send us anything else but
  // we incorrectly think we are still needed. In that case we will now try
  // to write to stdout and fail, and then know that we should exit.
  if (sendPings) {
    const timer      = setInterval(() => {
      service.sendRequest({
        command: "ping",
      });
    }, 1000);
    if (timer !== null && typeof timer === "object" && typeof timer.unref === "function") timer.unref();
  }

  // (the process ends once stdin has ended and every request is done)
  host.stdin.on("data", (chunk            ) => service.write(chunk));
  host.stdin.on("error", () => {});
}

// ioutil.ReadAll(os.Stdin): [bytes, error text]
function readAllStdin(host         )                                       {
  return new Promise((resolve) => {
    const chunks               = [];
    let n = 0;
    host.stdin.on("data", (chunk            ) => {
      chunks.push(chunk);
      n += chunk.length;
    });
    host.stdin.on("end", () => {
      const bytes = new Uint8Array(n);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      resolve([bytes, null]);
    });
    host.stdin.on("error", (e     ) => resolve([new Uint8Array(0), "read /dev/stdin: " + String(e && e.message)]));
  });
}

// cli.Run
function run(osArgs          , host         )                  {
  return runImpl(osArgs, [], host);
}

// Print metafile analysis after the build if it's enabled
function addAnalyzePlugin(buildOptions                  , analyze        , osArgs          ) {
  if (buildOptions.plugins === null) buildOptions.plugins = [];
  buildOptions.plugins.push(
    new Plugin("PrintAnalysis", (build             ) => {
      const color = outputOptionsForArgs(osArgs).color;
      build.onEnd(async (result             )                                        => {
        if (result.metafile !== "") {
          printTextWithColor(writeStderr, color, (colors) => {
            return analyzeMetafileImpl(result.metafile, analyze === analyzeVerbose, colors.reset !== "");
          });
          writeStderr("\n");
        }
        return [new OnEndResult(), null];
      });
    }),
  );

  // Always generate a metafile if we're analyzing, even if it won't be written out
  buildOptions.metafile = true;
}

async function runImpl(osArgs          , plugins          , host         )                  {
  // Special-case running a server
  for (const arg of osArgs) {
    if (arg === "--serve" || arg.startsWith("--serve=") || arg.startsWith("--servedir=") || arg.startsWith("--serve-fallback=")) {
      serveImpl(osArgs, host);
      return 1; // There was an error starting the server if we get here
    }
  }

  let analyze        ;
  [osArgs, analyze] = filterAnalyzeFlags(osArgs);
  const [buildOptions, transformOptions, extras, err] = parseOptionsForRun(osArgs);

  // Add any plugins from the caller after parsing the build options
  if (buildOptions !== null) {
    if (buildOptions.plugins === null) buildOptions.plugins = [];
    for (const p of plugins) buildOptions.plugins.push(p);

    // The "--analyze" flag is implemented as a plugin
    if (analyze !== analyzeDisabled) {
      addAnalyzePlugin(buildOptions, analyze, osArgs);
    }
  }

  if (buildOptions !== null) {
    // Read the "NODE_PATH" from the environment. This is part of node's
    // module resolution algorithm. Documentation for this can be found here:
    // https://nodejs.org/api/modules.html#modules_loading_from_the_global_folders
    const value = lookupEnv("NODE_PATH");
    if (value !== undefined) {
      let separator = ":";
      if (checkIfWindows(host.fs)) {
        // On Windows, NODE_PATH is delimited by semicolons instead of colons
        separator = ";";
      }
      buildOptions.nodePaths = splitWithEmptyCheck(value, separator);
    }

    // Read from stdin when there are no entry points
    const entryPointCount = (buildOptions.entryPoints === null ? 0 : buildOptions.entryPoints.length) + (buildOptions.entryPointsAdvanced === null ? 0 : buildOptions.entryPointsAdvanced.length);
    if (entryPointCount === 0) {
      if (buildOptions.stdin === null) {
        buildOptions.stdin = new api.StdinOptions();
      }
      const [bytes, err] = await readAllStdin(host);
      if (err !== null) {
        printErrorToStderr(osArgs, "Could not read from stdin: " + err);
        return 1;
      }
      buildOptions.stdin.contents = goStringFromBytes(bytes);
      const cwd = osGetwd(host.fs);
      buildOptions.stdin.resolveDir = cwd === null ? "" : cwd;
    } else if (buildOptions.stdin !== null) {
      if (buildOptions.stdin.sourcefile !== "") {
        printErrorToStderr(osArgs, '"sourcefile" only applies when reading from stdin');
      } else {
        printErrorToStderr(osArgs, '"loader" without extension only applies when reading from stdin');
      }
      return 1;
    }

    // Validate the metafile absolute path and directory ahead of time so we
    // don't write any output files if it's incorrect. That makes this API
    // option consistent with how we handle all other API options.
    let writeMetafile                                  = null;
    if (extras.metafile !== null) {
      let metafileAbsPath = "";
      let metafileAbsDir = "";

      if (buildOptions.outfile === "" && buildOptions.outdir === "") {
        // Cannot use "metafile" when writing to stdout
        printErrorToStderr(osArgs, 'Cannot use "metafile" without an output path');
        return 1;
      }
      const [realFS, realFSErr] = makeRealFS(new RealFSOptions(buildOptions.absWorkingDir), host.fs);
      if (realFSErr === null) {
        const [absPath, ok] = realFS .abs(extras.metafile);
        if (!ok) {
          printErrorToStderr(osArgs, "Invalid metafile path: " + extras.metafile);
          return 1;
        }
        metafileAbsPath = absPath;
        metafileAbsDir = realFS .dir(absPath);
      } else {
        // Don't fail in this case since the error will be reported by "api.Build"
      }

      writeMetafile = (json        ) => {
        if (json === "" || realFSErr !== null) {
          return; // Don't write out the metafile on build errors
        }
        const mkdirErr = mkdirAll(realFS , host.fs, metafileAbsDir, 0o755);
        if (mkdirErr !== null) {
          printErrorToStderr(osArgs, "Failed to create output directory: " + mkdirErr.error());
        } else {
          const writeErr = osWriteFile(host.fs, metafileAbsPath, encodeWTF8(json), 0o666);
          if (writeErr !== null) {
            printErrorToStderr(osArgs, "Failed to write to output file: " + writeErr.error());
          }
        }
      };
    }

    // Also validate the mangle cache absolute path and directory ahead of time
    // for the same reason
    let writeMangleCache                                                          = null;
    if (extras.mangleCache !== null) {
      let mangleCacheAbsPath = "";
      let mangleCacheAbsDir = "";
      let mangleCacheOrder                  = null;
      const [realFS, realFSErr] = makeRealFS(new RealFSOptions(buildOptions.absWorkingDir), host.fs);
      if (realFSErr === null) {
        const [absPath, ok] = realFS .abs(extras.mangleCache);
        if (!ok) {
          printErrorToStderr(osArgs, "Invalid mangle cache path: " + extras.mangleCache);
          return 1;
        }
        mangleCacheAbsPath = absPath;
        mangleCacheAbsDir = realFS .dir(absPath);
        [buildOptions.mangleCache, mangleCacheOrder] = parseMangleCache(osArgs, realFS, extras.mangleCache);
        if (buildOptions.mangleCache === null) {
          return 1; // Stop now if parsing failed
        }
      } else {
        // Don't fail in this case since the error will be reported by "api.Build"
      }

      writeMangleCache = (mangleCache                         ) => {
        if (mangleCache === null || realFSErr !== null) {
          return; // Don't write out the metafile on build errors
        }
        const mkdirErr = mkdirAll(realFS , host.fs, mangleCacheAbsDir, 0o755);
        if (mkdirErr !== null) {
          printErrorToStderr(osArgs, "Failed to create output directory: " + mkdirErr.error());
        } else {
          const bytes = printMangleCache(mangleCache, mangleCacheOrder , buildOptions.charset === api.CharsetASCII);
          const writeErr = osWriteFile(host.fs, mangleCacheAbsPath, bytes, 0o666);
          if (writeErr !== null) {
            printErrorToStderr(osArgs, "Failed to write to output file: " + writeErr.error());
          }
        }
      };
    }

    // Handle post-build actions with a plugin so they also work in watch mode
    buildOptions.plugins.push(
      new Plugin("PostBuildActions", (build             ) => {
        build.onEnd(async (result             )                                        => {
          // Write the metafile to the file system
          if (writeMetafile !== null) {
            writeMetafile(result.metafile);
          }

          // Write the mangle cache to the file system
          if (writeMangleCache !== null) {
            writeMangleCache(result.mangleCache);
          }

          return [new OnEndResult(), null];
        });
      }),
    );

    // Handle watch mode
    if (extras.watch) {
      const [ctx] = contextImpl(buildOptions, host.fs);

      // Only start watching if the build options passed validation
      if (ctx === null) {
        return 1;
      }

      ctx.Watch(new WatchOptions(extras.watchDelay));

      // Do not exit if we're in watch mode
      host.keepAlive();
      return new Promise(() => {});
    }

    // This prints the summary which the context API doesn't do
    const result = await apiBuild(buildOptions, host.fs);

    // Return a non-zero exit code if there were errors
    if (result.errors.length > 0) {
      return 1;
    }
  } else if (transformOptions !== null) {
    // Read the input from stdin
    const [bytes, err] = await readAllStdin(host);
    if (err !== null) {
      printErrorToStderr(osArgs, "Could not read from stdin: " + err);
      return 1;
    }

    // Run the transform and stop if there were errors
    const result = transformWithOptions(transformOptions, bytes);
    for (const msg of result.msgs) {
      if (msg.kind === MsgError) {
        return 1;
      }
    }

    // Write the output to stdout
    writeStdoutBytes(encodeWTF8(result.code));
  } else if (err !== null) {
    printErrorWithNoteToStderr(osArgs, err.text, err.note);
    return 1;
  }

  return 0;
}

// strconv.ParseInt(s, 10, 32): [value, error text]
function parseInt32(s        )                          {
  const syntaxError = "strconv.ParseInt: parsing " + goQuote(s) + ": invalid syntax";
  if (s === "") return [0, syntaxError];
  let i = 0;
  let neg = false;
  if (s[0] === "+" || s[0] === "-") {
    neg = s[0] === "-";
    i = 1;
    if (s.length === 1) return [0, syntaxError];
  }
  let n = 0;
  let overflow = false;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return [0, syntaxError];
    if (!overflow) {
      n = n * 10 + (c - 48);
      if (n > 2 ** 40) overflow = true;
    }
  }
  if (overflow || (!neg && n > 0x7fffffff) || (neg && n > 0x80000000)) {
    return [neg ? -0x80000000 : 0x7fffffff, "strconv.ParseInt: parsing " + goQuote(s) + ": value out of range"];
  }
  return [neg ? -n : n, null];
}

// net.SplitHostPort: [host, port, error text]
function splitHostPort(hostport        )                                  {
  const missingPort = "missing port in address";
  const tooManyColons = "too many colons in address";
  const addrErr = (addr        , why        )                           => ["", "", "address " + addr + ": " + why];
  let j = 0;
  let k = 0;

  // The port starts after the last colon.
  const i = hostport.lastIndexOf(":");
  if (i < 0) {
    return addrErr(hostport, missingPort);
  }

  let host        ;
  if (hostport[0] === "[") {
    // Expect the first ']' just before the last ':'.
    const end = hostport.indexOf("]");
    if (end < 0) {
      return addrErr(hostport, "missing ']' in address");
    }
    switch (end + 1) {
      case hostport.length:
        // There can't be a ':' behind the ']' now.
        return addrErr(hostport, missingPort);
      case i:
        // The expected result.
        break;
      default:
        // Either ']' isn't followed by a colon, or it is
        // followed by a colon that is not the last one.
        if (hostport[end + 1] === ":") {
          return addrErr(hostport, tooManyColons);
        }
        return addrErr(hostport, missingPort);
    }
    host = hostport.slice(1, end);
    j = 1;
    k = end + 1; // there can't be a '[' resp. ']' before these positions
  } else {
    host = hostport.slice(0, i);
    if (host.indexOf(":") >= 0) {
      return addrErr(hostport, tooManyColons);
    }
  }
  if (hostport.slice(j).indexOf("[") >= 0) {
    return addrErr(hostport, "unexpected '[' in address");
  }
  if (hostport.slice(k).indexOf("]") >= 0) {
    return addrErr(hostport, "unexpected ']' in address");
  }

  const port = hostport.slice(i + 1);
  return [host, port, null];
}

// Returns [options, filteredArgs, error text]
function parseServeOptionsImpl(osArgs          )                                              {
  let host = "";
  let portText = "";
  let servedir = "";
  let keyfile = "";
  let certfile = "";
  let fallback = "";
  let corsOrigin                  = null;

  // Filter out server-specific flags
  const filteredArgs           = [];
  for (const arg of osArgs) {
    if (arg === "--serve") {
      // Just ignore this flag
    } else if (arg.startsWith("--serve=")) {
      portText = arg.slice("--serve=".length);
    } else if (arg.startsWith("--servedir=")) {
      servedir = arg.slice("--servedir=".length);
    } else if (arg.startsWith("--keyfile=")) {
      keyfile = arg.slice("--keyfile=".length);
    } else if (arg.startsWith("--certfile=")) {
      certfile = arg.slice("--certfile=".length);
    } else if (arg.startsWith("--serve-fallback=")) {
      fallback = arg.slice("--serve-fallback=".length);
    } else if (arg.startsWith("--cors-origin=")) {
      corsOrigin = arg.slice("--cors-origin=".length).split(",");
    } else {
      filteredArgs.push(arg);
    }
  }

  // Specifying the host is optional
  if (portText.includes(":")) {
    let err               ;
    [host, portText, err] = splitHostPort(portText);
    if (err !== null) {
      return [new api.ServeOptions(), [], err];
    }
  }

  // Parse the port
  let port = 0;
  if (portText !== "") {
    let err               ;
    [port, err] = parseInt32(portText);
    if (err !== null) {
      return [new api.ServeOptions(), [], err];
    }
    if (port < 0 || port > 0xffff) {
      return [new api.ServeOptions(), [], "Invalid port number: " + portText];
    }
    if (port === 0) {
      // 0 is the default value in Go, which we interpret as "try to
      // pick port 8000". So Go uses -1 as the sentinel value instead.
      port = -1;
    }
  }

  const options = new api.ServeOptions();
  options.port = port;
  options.host = host;
  options.servedir = servedir;
  options.keyfile = keyfile;
  options.certfile = certfile;
  options.fallback = fallback;
  options.corsOrigin = corsOrigin;
  return [options, filteredArgs, null];
}

function serveImpl(osArgs          , host         ) {
  const [serveOptions, filteredArgs0, err] = parseServeOptionsImpl(osArgs);
  if (err !== null) {
    printErrorWithNoteToStderr(osArgs, err, "");
    return;
  }

  const options = new api.BuildOptions();

  // Apply defaults appropriate for the CLI
  options.logLimit = 5;
  options.logLevel = api.LogLevelInfo;

  const [filteredArgs, analyze] = filterAnalyzeFlags(filteredArgs0);
  const [extras, errWithNote] = parseOptionsImpl(filteredArgs, options, null, kindInternal);
  if (errWithNote !== null) {
    printErrorWithNoteToStderr(osArgs, errWithNote.text, errWithNote.note);
    return;
  }
  if (analyze !== analyzeDisabled) {
    addAnalyzePlugin(options, analyze, osArgs);
  }

  // (the request log of the server: the WebAssembly build has no server)

  // Validate build options
  const [ctx] = contextImpl(options, host.fs);
  if (ctx === null) {
    return;
  }

  // Try to enable serve mode
  const [, serveErr] = ctx.Serve(serveOptions);
  if (serveErr !== null) {
    printErrorWithNoteToStderr(osArgs, serveErr, "");
    return;
  }
}

// mangle_cache.go parseMangleCache: [mangleCache, order] or [null, null]
function parseMangleCache(osArgs          , fs     , absPath        )                                             {
  // Log problems with the mangle cache to stderr
  const log = newStderrLog(outputOptionsForArgs(osArgs));
  const done =     (result   )    => {
    log.done();
    log.flushStderr();
    return result;
  };

  // Try to read the existing file
  let prettyPath = absPath;
  const [rel, ok] = fs.rel(fs.cwd(), absPath);
  if (ok) {
    prettyPath = rel;
  }
  prettyPath = prettyPath.replaceAll("\\", "/");
  const [bytes, err, originalError] = fs.readFile(absPath);
  if (err !== null) {
    // It's ok if it's just missing
    if (err === ENOENT) {
      return done([new Map(), []]);
    }

    // Otherwise, report the error
    log.addError(null, RANGE_ZERO, "Failed to read from mangle cache file " + goQuote(prettyPath) + ": " + originalError.error());
    return done([null, null]);
  }

  // Use our JSON parser so we get pretty-printed error messages
  const keyPath = new Path(absPath, "file");
  const source = new Source(makePrettyPaths(fs, keyPath), "", goStringFromBytes(bytes), keyPath);
  const [result, parsed] = parseJSON(log, source, new JSONOptions());
  if (!parsed || log.hasErrors()) {
    // Stop if there were any errors so we don't continue and then overwrite this file
    return done([null, null]);
  }
  const tracker = new LineColumnTracker(source);

  // Validate the top-level object
  const root = result.data;
  if (!(root instanceof EObject)) {
    log.addError(tracker, new Range(result.loc, 0), "Expected a top-level object in mangle cache file");
    return done([null, null]);
  }

  const mangleCache = new Map             ();
  const order           = [];

  for (const property of root.properties) {
    const key         = (property.key.data           ).value;
    order.push(key);

    const v = property.valueOrNil.data;
    if (v instanceof EBoolean) {
      if (v.value) {
        log.addError(tracker, rangeOfIdentifier(source, property.valueOrNil.loc), "Expected " + goQuote(key) + " in mangle cache file to map to either a string or false");
      } else {
        mangleCache.set(key, false);
      }
    } else if (v instanceof EString) {
      mangleCache.set(key, v.value);
    } else {
      log.addError(tracker, new Range(property.valueOrNil.loc, 0), "Expected " + goQuote(key) + " in mangle cache file to map to either a string or false");
    }
  }

  if (log.hasErrors()) {
    return done([null, null]);
  }
  return done([mangleCache, order]);
}

// sort.StringsAreSorted
function stringsAreSorted(a          )          {
  for (let i = a.length - 1; i > 0; i--) {
    if (compareStringsUTF8(a[i], a[i - 1]) < 0) return false;
  }
  return true;
}

// mangle_cache.go printMangleCache
function printMangleCache(mangleCache                  , originalOrder          , asciiOnly         )             {
  let j = "{";

  // Determine the order to print the keys in
  let order = originalOrder;
  if (mangleCache.size > order.length) {
    order = [];
    if (stringsAreSorted(originalOrder)) {
      // If they came sorted, keep them sorted
      for (const key of mangleCache.keys()) {
        order.push(key);
      }
      order.sort(compareStringsUTF8);
    } else {
      // Otherwise add all new keys to the end, and only sort the new keys
      const originalKeys = new Set        (originalOrder);
      for (const key of originalOrder) order.push(key);
      const added           = [];
      for (const key of mangleCache.keys()) {
        if (!originalKeys.has(key)) {
          added.push(key);
        }
      }
      added.sort(compareStringsUTF8);
      for (const key of added) order.push(key);
    }
  }

  // Print the JSON while preserving the existing order of the keys
  for (let i = 0; i < order.length; i++) {
    const key = order[i];
    // Print the key
    if (i > 0) {
      j += ",\n  ";
    } else {
      j += "\n  ";
    }
    j += quoteForJSON(key, asciiOnly);

    // Print the value
    const value = mangleCache.get(key);
    if (value !== false) {
      j += ": ";
      j += quoteForJSON(value, asciiOnly);
    } else {
      j += ": false";
    }
  }

  if (order.length > 0) {
    j += "\n";
  }
  j += "}\n";
  return encodeWTF8(j);
}
// generated from cli_main.mts by tools/ts-build.mjs; edit that file
