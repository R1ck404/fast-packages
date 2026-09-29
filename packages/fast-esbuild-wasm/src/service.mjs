// cmd/esbuild/service.go: the long-running service esbuild's JavaScript API
// talks to over stdin/stdout, run in-process. It reads the same packets
// (write) and produces the same bytes (the host's "output") as the Go
// service does in esbuild-wasm (stdio_protocol.go, see service_protocol.mts).
//
// Go's goroutines are async functions here. Requests that Go answers without
// waiting for anything (transform, format-msgs, analyze-metafile, error) are
// answered synchronously, so that a host can run a synchronous call (the
// *Sync APIs) by writing the request and reading the output right away.

import { encodePacket, decodePacket, Packet, ByteString, encodeWTF8 } from "./service_protocol.mjs";
import * as api from "./cli.mjs";
import { parseBuildOptions, parseLoader } from "./cli.mjs";
import {
  API,
  JSAPI,
  Msg,
  MsgData,
  MsgLocation,
  PrettyPaths,
  printMessageToStderr,
  stringToMaximumMsgID,
  Error as MsgError,
  Warning as MsgWarning,
  StyleDefault,
  StyleVisualStudio,
  msgIDToString,
} from "./logger.mjs";
import { goQuote } from "./gostd.mjs";
import { pluginAppliesToPath } from "./config.mjs";
import { Path } from "./logger.mjs";
import { compileFilterForPlugin, formatMsgsImpl, analyzeMetafileImpl } from "./build.mjs";
import { transformFromFlags, checkTransformFlags, CLIError, TransformResult } from "./transform.mjs";
import {
  APIMessage,
  APILocation,
  APINote,
  BuildResult,
  OutputFile,
  Plugin,
  PluginBuild,
  OnStartResult,
  OnEndResult,
  OnResolveOptions,
  OnResolveArgs,
  OnResolveResult,
  OnLoadOptions,
  OnLoadArgs,
  OnLoadResult,
  ResolveOptions,
  WatchOptions,
  internalContext,
  contextImpl,
  build as apiBuild,
  convertMessagesToPublic,
  goStringFromBytes,
  ResolveNone,
  ResolveEntryPoint,
  ResolveJSImportStatement,
  ResolveJSRequireCall,
  ResolveJSDynamicImport,
  ResolveJSRequireResolve,
  ResolveCSSImportRule,
  ResolveCSSComposesFrom,
  ResolveCSSURLToken,
  SideEffectsTrue,
  SideEffectsFalse,
} from "./api_build.mjs";
import { osReadFileHost, osWriteFile, osRemove } from "./fs.mjs";

export const esbuildVersion = "0.28.2";

// sync.WaitGroup
export class WaitGroup {
                        
                                  
  constructor() {
    this.count = 0;
    this.waiters = [];
  }
  add(n        ) {
    this.count += n;
    this.release();
  }
  done() {
    this.count--;
    this.release();
  }
  release() {
    if (this.count === 0 && this.waiters.length > 0) {
      const waiters = this.waiters;
      this.waiters = [];
      for (const w of waiters) w();
    }
  }
  wait()                {
    if (this.count === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

;                                                                              

class activeBuild {
  ;                                   
  ;                                                   
  ;                                    // Allows "dispose" to wait for all active tasks

  // These are guarded by the mutex
  ;                                           // Allows "cancel" to wait for all active rebuilds
  ;                                  
  ;                             
  constructor() {
    this.ctx = null;
    this.pluginResolve = null;
    this.disposeWaitGroup = new WaitGroup();
    this.rebuildWaitGroup = null;
    this.withinRebuildCount = 0;
    this.didGetCancel = false;
  }
}

// What the service needs from its host
;                             
                                                            
                                  
                                                                           
                                              
              
                                                                          
                                     
                          
 

export class Service {
  ;                         
  ;                                                       
  ;                                              
  ;                             
  ;                          
  ;                       

  // runService
  constructor(host             ) {
    API.kind = JSAPI;
    this.host = host;
    this.callbacks = new Map();
    this.activeBuilds = new Map();
    this.nextRequestID = 0;
    this.stream = new Uint8Array(0);
    this.closed = false;

    // The protocol always starts with the version
    const version = encodeWTF8(esbuildVersion);
    const first = new Uint8Array(4 + version.length);
    writeUint32(first, 0, version.length);
    first.set(version, 4);
    host.output(first);
  }

  // Data from stdin: every complete packet is handled right away
  write(chunk            ) {
    if (this.closed) return;
    let stream = this.stream;
    if (stream.length === 0) {
      stream = chunk;
    } else {
      const joined = new Uint8Array(stream.length + chunk.length);
      joined.set(stream);
      joined.set(chunk, stream.length);
      stream = joined;
    }

    // Process all complete (i.e. not partial) packets
    let offset = 0;
    for (;;) {
      if (offset + 4 > stream.length) break;
      const length = readUint32(stream, offset);
      if (offset + 4 + length > stream.length) break;
      // Clone the input since slices into it may be used later
      const packet = stream.slice(offset + 4, offset + 4 + length);
      offset += 4 + length;
      try {
        this.handleIncomingPacket(packet);
      } catch (e) {
        this.crash(e);
      }
      if (this.closed) return;
    }

    // Keep the remaining partial packet
    this.stream = offset === stream.length ? new Uint8Array(0) : stream.slice(offset);
  }

  // The end of stdin: requests waiting for a response get none ("The
  // service was stopped")
  close() {
    this.closed = true;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback(null);
  }

  // A goroutine panicked: the process ends
  crash(e     ) {
    if (this.closed) return;
    this.closed = true;
    this.callbacks.clear();
    this.host.crash(e);
  }

  // Starts a goroutine: it runs once the current one blocks (Go's wasm port
  // has one thread), and a panic in it ends the process
  go(f                     ) {
    queueMicrotask(() => {
      if (this.closed) return;
      f().catch((e) => this.crash(e));
    });
  }

  sendPacket(packet            ) {
    if (this.closed) return;
    this.host.output(packet);
  }

  // Resolves with the response, or with null when the request could not be
  // sent because stdin was closed
  sendRequest(request     )               {
    if (this.closed) return Promise.resolve(null);
    const id = this.nextRequestID;
    this.nextRequestID = (this.nextRequestID + 1) >>> 0;
    const result = new Promise     ((resolve) => this.callbacks.set(id, resolve));
    this.sendPacket(encodePacket(new Packet(request, id, true)));
    return result;
  }

  getActiveBuild(key        )                          {
    return this.activeBuilds.get(key);
  }

  createActiveBuild(key        )              {
    if (this.activeBuilds.has(key)) {
      throw new Error("Internal error");
    }
    const build = new activeBuild();
    this.activeBuilds.set(key, build);
    return build;
  }

  destroyActiveBuild(key        ) {
    if (!this.activeBuilds.has(key)) {
      throw new Error("Internal error");
    }
    this.activeBuilds.delete(key);
  }

  // This function deliberately processes incoming packets sequentially. We
  // want calling "dispose" on a context to take effect immediately and to fail
  // all future calls on that context. We don't want "dispose" to accidentally
  // be reordered after any future calls on that context, since those future
  // calls are supposed to fail.
  handleIncomingPacket(bytes            ) {
    const p = decodePacket(bytes);
    if (p === null) {
      return;
    }

    if (!p.isRequest) {
      const callback = this.callbacks.get(p.id);
      this.callbacks.delete(p.id);

      if (callback === undefined) {
        throw new Error("callback nil for id " + p.id + ", value " + String(p.value));
      }

      callback(p.value);
      return;
    }

    // Handle the request
    const request = p.value;
    const command         = request["command"];
    switch (command) {
      case "build":
        this.go(async () => this.sendPacket(await this.handleBuildRequest(p.id, request)));
        break;

      case "transform":
        this.sendPacket(this.handleTransformRequest(p.id, request));
        break;

      case "resolve": {
        const key         = request["key"];
        const build = this.getActiveBuild(key);
        if (build !== undefined) {
          const ctx = build.ctx;
          const pluginResolve = build.pluginResolve;
          if (ctx !== null && pluginResolve !== null) {
            build.disposeWaitGroup.add(1);
          }
          if (pluginResolve !== null) {
            this.go(async () => {
              this.sendPacket(await pluginResolve(p.id, request));
              if (ctx !== null) {
                build.disposeWaitGroup.done();
              }
            });
            return;
          }
        }
        this.sendPacket(encodePacket(new Packet({ error: 'Cannot call "resolve" on an inactive build' }, p.id, false)));
        break;
      }

      case "rebuild": {
        const key         = request["key"];
        const build = this.getActiveBuild(key);
        if (build !== undefined) {
          const ctx = build.ctx;
          if (ctx !== null) {
            build.withinRebuildCount++;
            if (build.rebuildWaitGroup === null) {
              build.rebuildWaitGroup = new WaitGroup();
            }
            build.rebuildWaitGroup.add(1);
            build.disposeWaitGroup.add(1);
          }
          if (ctx !== null) {
            this.go(async () => {
              const result = await ctx.Rebuild();
              build.withinRebuildCount--;
              build.rebuildWaitGroup .done();
              if (build.withinRebuildCount === 0) {
                // Clear the cancel flag now that the last rebuild has finished
                build.didGetCancel = false;

                // Clear this to avoid confusion with the next group of rebuilds
                build.rebuildWaitGroup = null;
              }
              this.sendPacket(
                encodePacket(
                  new Packet(
                    {
                      errors: encodeMessages(result.errors),
                      warnings: encodeMessages(result.warnings),
                    },
                    p.id,
                    false,
                  ),
                ),
              );
              build.disposeWaitGroup.done();
            });
            return;
          }
        }
        this.sendPacket(encodePacket(new Packet({ error: "Cannot rebuild" }, p.id, false)));
        break;
      }

      case "watch": {
        const key         = request["key"];
        const build = this.getActiveBuild(key);
        if (build !== undefined) {
          const ctx = build.ctx;
          if (ctx !== null) {
            build.disposeWaitGroup.add(1);
          }
          if (ctx !== null) {
            this.go(async () => {
              const options = new WatchOptions();
              if ("delay" in request) {
                options.delay = request["delay"];
              }
              const err = ctx.Watch(options);
              if (err !== null) {
                this.sendPacket(encodeErrorPacket(p.id, err));
              } else {
                this.sendPacket(encodePacket(new Packet({}, p.id, false)));
              }
              build.disposeWaitGroup.done();
            });
            return;
          }
        }
        this.sendPacket(encodePacket(new Packet({ error: "Cannot watch" }, p.id, false)));
        break;
      }

      case "serve": {
        const key         = request["key"];
        const build = this.getActiveBuild(key);
        if (build !== undefined) {
          const ctx = build.ctx;
          if (ctx !== null) {
            build.disposeWaitGroup.add(1);
          }
          if (ctx !== null) {
            this.go(async () => {
              const options = new api.ServeOptions();
              // (the options are read like Go does; the WebAssembly build has
              // no server, so they only matter for type errors)
              const [, err] = ctx.Serve(options);
              if (err !== null) {
                this.sendPacket(encodeErrorPacket(p.id, err));
              }
              build.disposeWaitGroup.done();
            });
            return;
          }
        }
        this.sendPacket(encodePacket(new Packet({ error: "Cannot serve" }, p.id, false)));
        break;
      }

      case "cancel": {
        const key         = request["key"];
        const build = this.getActiveBuild(key);
        if (build !== undefined) {
          const ctx = build.ctx;
          const rebuildWaitGroup = build.rebuildWaitGroup;
          if (build.withinRebuildCount > 0) {
            // If Go got a "rebuild" message from JS before this, there's a chance
            // that Go hasn't run "ctx.Rebuild()" by the time our "ctx.Cancel()"
            // runs below because both of them are on separate goroutines. To
            // handle this, we set this flag to tell our "OnStart" plugin to cancel
            // the build in case things happen in that order.
            build.didGetCancel = true;
          }
          if (ctx !== null) {
            this.go(async () => {
              await ctx.Cancel();

              // Block until all manual rebuilds that were active at the time the
              // "cancel" packet was originally processed have finished. That way
              // JS can wait for "cancel" to end and be assured that it can call
              // "rebuild" and have it not merge with any other ongoing rebuilds.
              if (rebuildWaitGroup !== null) {
                await rebuildWaitGroup.wait();
              }

              // Only return control to JavaScript once the cancel operation has succeeded
              this.sendPacket(encodePacket(new Packet({}, p.id, false)));
            });
            return;
          }
        }
        this.sendPacket(encodePacket(new Packet({}, p.id, false)));
        break;
      }

      case "dispose": {
        const key         = request["key"];
        const build = this.getActiveBuild(key);
        if (build !== undefined) {
          const ctx = build.ctx;
          build.ctx = null;

          // Release this ref count if it was held
          if (ctx !== null) {
            this.go(async () => {
              // While "Dispose()" will wait for any existing operations on the
              // context to finish, we also don't want to start any new operations.
              // That can happen because operations (e.g. "Rebuild()") are started
              // from a separate goroutine without locking the build mutex. This
              // uses a WaitGroup to handle this case. If that happened, then we'll
              // wait for it here before disposing. Once the wait is over, no more
              // operations can happen on the context because we have already
              // zeroed out the shared context pointer above.
              build.disposeWaitGroup.done();
              await build.disposeWaitGroup.wait();

              await ctx.Dispose();
              this.destroyActiveBuild(key);

              // Only return control to JavaScript once everything relating to this
              // build has gracefully ended. Otherwise JavaScript will unregister
              // everything related to this build and any calls an ongoing build
              // makes into JavaScript will cause errors, which may be observable.
              this.sendPacket(encodePacket(new Packet({}, p.id, false)));
            });
            return;
          }
        }
        this.sendPacket(encodePacket(new Packet({}, p.id, false)));
        break;
      }

      case "error": {
        // This just exists so that errors during JavaScript API setup get printed
        // nicely to the console. This matters if the JavaScript API setup code
        // swallows thrown errors. We still want to be able to see the error.
        const flags = decodeStringArray(request["flags"]);
        const msg = decodeMessageToPrivate(request["error"]);
        printMessageToStderr(flags, msg);
        this.sendPacket(encodePacket(new Packet({}, p.id, false)));
        break;
      }

      case "format-msgs":
        this.sendPacket(this.handleFormatMessagesRequest(p.id, request));
        break;

      case "analyze-metafile":
        this.sendPacket(this.handleAnalyzeMetafileRequest(p.id, request));
        break;

      default:
        this.sendPacket(encodePacket(new Packet({ error: "Invalid command: " + command }, p.id, false)));
    }
  }

  async handleBuildRequest(id        , request     )                      {
    const isContext          = request["context"];
    const key         = request["key"];
    const write          = request["write"];
    const entries        = request["entries"];
    const flags = decodeStringArray(request["flags"]);

    const [options, err] = parseBuildOptions(flags);
    options.absWorkingDir = request["absWorkingDir"];
    options.nodePaths = decodeStringArray(request["nodePaths"]);
    options.mangleCache = decodeMap(request["mangleCache"]);

    for (const entry of entries) {
      const key         = entry[0];
      const value         = entry[1];
      if (options.entryPointsAdvanced === null) options.entryPointsAdvanced = [];
      options.entryPointsAdvanced.push(new api.EntryPoint(value, key));
    }

    // Normally when "write" is true and there is no output file/directory then
    // the output is written to stdout instead. However, we're currently using
    // stdout as a communication channel and writing the build output to stdout
    // would corrupt our protocol. Special-case this to channel this back to the
    // host process and write it to stdout there.
    const writeToStdout = err === null && write && options.outfile === "" && options.outdir === "";

    if (err !== null) {
      return encodeErrorPacket(id, err);
    }

    // Optionally allow input from the stdin channel
    const stdin = request["stdinContents"];
    if (stdin instanceof Uint8Array) {
      if (options.stdin === null) {
        options.stdin = new api.StdinOptions();
      }
      options.stdin.contents = goStringFromBytes(stdin);
      const resolveDir = request["stdinResolveDir"];
      if (typeof resolveDir === "string") {
        options.stdin.resolveDir = resolveDir;
      }
    }

    const build = this.createActiveBuild(key);
    let shouldDestroyActiveBuild = true;
    try {
      let hasOnEndCallbacks = false;
      if ("plugins" in request) {
        const [plugins, hasOnEnd, err] = this.convertPlugins(key, request["plugins"], build);
        if (err !== null) {
          return encodeErrorPacket(id, err);
        } else {
          options.plugins = plugins;
          hasOnEndCallbacks = hasOnEnd;
        }
      }

      const resultToResponse = (result             )      => {
        const response      = {
          errors: encodeMessages(result.errors),
          warnings: encodeMessages(result.warnings),
        };
        if (!write) {
          // Pass the output files back to the caller
          response["outputFiles"] = encodeOutputFiles(result.outputFiles);
        }
        if (options.metafile) {
          response["metafile"] = encodeWTF8(result.metafile);
        }
        if (options.mangleCache !== null) {
          response["mangleCache"] = encodeMangleCache(result.mangleCache);
        }
        if (writeToStdout && result.outputFiles !== null && result.outputFiles.length === 1) {
          response["writeToStdout"] = result.outputFiles[0].contents;
        }
        return response;
      };

      if (!writeToStdout) {
        options.write = write;
      }

      if (isContext) {
        if (options.plugins === null) options.plugins = [];
        options.plugins.push(
          new Plugin("onEnd", (b             ) => {
            b.onStart(async ()                                          => {
              const currentWaitGroup = build.rebuildWaitGroup;
              if (currentWaitGroup !== null && build.didGetCancel) {
                // Cancel the current build now that the current build is active.
                // This catches the case where JS does "rebuild()" then "cancel()"
                // but Go's scheduler runs the original "ctx.Cancel()" goroutine
                // before it runs the "ctx.Rebuild()" goroutine.
                //
                // This adds to the rebuild wait group that other cancel operations
                // are waiting on because we also want those other cancel operations
                // to wait on this cancel operation.
                currentWaitGroup.add(1);
                const ctx = build.ctx ;
                this.go(async () => {
                  await ctx.Cancel();

                  // Use the wait group that was active at the time the "OnStart"
                  // callback ran instead of the latest one on the active build in
                  // case this goroutine is delayed.
                  currentWaitGroup.done();
                });
              }
              return [new OnStartResult(), null];
            });

            b.onEnd(async (result             )                                        => {
              // For performance, we only send JavaScript an "onEnd" message if
              // it's needed. It's only needed if one of the following is true:
              //
              // - There are any "onEnd" callbacks registered
              // - JavaScript has called our "rebuild()" function
              // - We are writing build output to JavaScript's stdout
              //
              // This is especially important if "write" is false since otherwise
              // we'd unnecessarily send the entire contents of all output files!
              //
              //          "If a tree falls in a forest and no one is
              //           around to hear it, does it make a sound?"
              //
              const isWithinRebuild = build.withinRebuildCount > 0;
              if (!hasOnEndCallbacks && !isWithinRebuild && !writeToStdout) {
                return [new OnEndResult(), null];
              }
              const request = resultToResponse(result);
              request["command"] = "on-end";
              request["key"] = key;
              const response = await this.sendRequest(request);
              if (!isMap(response)) {
                return [new OnEndResult(), "The service was stopped"];
              }
              let errors               = [];
              let warnings               = [];
              if (Array.isArray(response["errors"])) {
                errors = decodeMessages(response["errors"]);
              }
              if (Array.isArray(response["warnings"])) {
                warnings = decodeMessages(response["warnings"]);
              }
              return [new OnEndResult(errors, warnings), null];
            });
          }),
        );

        const [ctx, errors] = contextImpl(options, this.host.hostFS);
        if (ctx === null) {
          return encodePacket(
            new Packet(
              {
                errors: encodeMessages(errors),
                warnings: [],
              },
              id,
              false,
            ),
          );
        }

        // Keep the build alive until "dispose" has been called
        build.disposeWaitGroup.add(1);
        build.ctx = ctx;
        shouldDestroyActiveBuild = false;

        return encodePacket(
          new Packet(
            {
              errors: [],
              warnings: [],
            },
            id,
            false,
          ),
        );
      }

      const result = await apiBuild(options, this.host.hostFS);
      const response = resultToResponse(result);

      return encodePacket(new Packet(response, id, false));
    } finally {
      if (shouldDestroyActiveBuild) {
        this.destroyActiveBuild(key);
      }
    }
  }

  // Returns [plugins, hasOnEnd, error text or null]
  convertPlugins(key        , jsPlugins     , build             )                                     {
    class filteredCallback {
                          
                                 
                                
                         
      constructor(filter     , pluginName        , namespace        , id        ) {
        this.filter = filter;
        this.pluginName = pluginName;
        this.namespace = namespace;
        this.id = id;
      }
    }

    const onResolveCallbacks                     = [];
    const onLoadCallbacks                     = [];
    let hasOnEnd = false;

    const filteredCallbacks = (pluginName        , kind        , items       )                                      => {
      const result                     = [];
      for (const item of items) {
        const [filter, err] = compileFilterForPlugin(pluginName, kind, item["filter"]);
        if (err !== null) {
          return [[], err];
        }
        result.push(new filteredCallback(filter, pluginName, item["namespace"], item["id"]));
      }
      return [result, null];
    };

    for (const p of jsPlugins) {
      const pluginName         = p["name"];

      if (p["onEnd"]) {
        hasOnEnd = true;
      }

      {
        const [callbacks, err] = filteredCallbacks(pluginName, "onResolve", p["onResolve"]);
        if (err !== null) {
          return [[], false, err];
        }
        for (const c of callbacks) onResolveCallbacks.push(c);
      }

      {
        const [callbacks, err] = filteredCallbacks(pluginName, "onLoad", p["onLoad"]);
        if (err !== null) {
          return [[], false, err];
        }
        for (const c of callbacks) onLoadCallbacks.push(c);
      }
    }

    // We want to minimize the amount of IPC traffic. Instead of adding one Go
    // plugin for every JavaScript plugin, we just add a single Go plugin that
    // proxies the plugin queries to the list of JavaScript plugins in the host.
    return [
      [
        new Plugin("JavaScript plugins", (b             ) => {
          build.pluginResolve = async (id        , request     )                      => {
            const path         = request["path"];
            const options = new ResolveOptions();
            if ("pluginName" in request) {
              options.pluginName = request["pluginName"];
            }
            if ("importer" in request) {
              options.importer = request["importer"];
            }
            if ("namespace" in request) {
              options.namespace = request["namespace"];
            }
            if ("resolveDir" in request) {
              options.resolveDir = request["resolveDir"];
            }
            if ("kind" in request) {
              const str         = request["kind"];
              const [kind, ok] = stringToResolveKind(str);
              if (!ok) {
                return encodePacket(new Packet({ error: "Invalid kind: " + goQuote(str) }, id, false));
              }
              options.kind = kind;
            }
            if ("pluginData" in request) {
              options.pluginData = request["pluginData"];
            }
            if ("with" in request) {
              const value = request["with"];
              options.with = new Map();
              for (const k of Object.keys(value)) {
                options.with.set(k, value[k]);
              }
            }

            const result = await b.resolve(path, options);
            return encodePacket(
              new Packet(
                {
                  errors: encodeMessages(result.errors),
                  warnings: encodeMessages(result.warnings),
                  path: result.path,
                  external: result.external,
                  sideEffects: result.sideEffects,
                  namespace: result.namespace,
                  suffix: result.suffix,
                  pluginData: result.pluginData,
                },
                id,
                false,
              ),
            );
          };

          // Always register "OnStart" to clear "pluginData"
          b.onStart(async ()                                          => {
            const response = await this.sendRequest({
              command: "on-start",
              key: key,
            });
            if (!isMap(response)) {
              return [new OnStartResult(), "The service was stopped"];
            }
            return [new OnStartResult(decodeMessages(response["errors"]), decodeMessages(response["warnings"])), null];
          });

          // Only register "OnResolve" if needed
          if (onResolveCallbacks.length > 0) {
            b.onResolve(new OnResolveOptions(".*", ""), async (args               )                                            => {
              const ids           = [];
              const applyPath = new Path(args.path, args.namespace);
              for (const item of onResolveCallbacks) {
                if (pluginAppliesToPath(applyPath, item.filter, item.namespace)) {
                  ids.push(item.id);
                }
              }

              const result = new OnResolveResult();
              if (ids.length === 0) {
                return [result, null];
              }

              const with_      = {};
              for (const k of Object.keys(args.with)) {
                setMapKey(with_, k, args.with[k]);
              }

              const response = await this.sendRequest({
                command: "on-resolve",
                key: key,
                ids: ids,
                path: args.path,
                importer: args.importer,
                namespace: args.namespace,
                resolveDir: args.resolveDir,
                kind: resolveKindToString(args.kind),
                pluginData: args.pluginData,
                with: with_,
              });
              if (!isMap(response)) {
                return [result, "The service was stopped"];
              }

              if ("id" in response) {
                const id         = response["id"];
                for (const item of onResolveCallbacks) {
                  if (item.id === id) {
                    result.pluginName = item.pluginName;
                    break;
                  }
                }
              }
              if ("error" in response) {
                return [result, response["error"]];
              }
              if ("pluginName" in response) {
                result.pluginName = response["pluginName"];
              }
              if ("path" in response) {
                result.path = response["path"];
              }
              if ("namespace" in response) {
                result.namespace = response["namespace"];
              }
              if ("suffix" in response) {
                result.suffix = response["suffix"];
              }
              if ("external" in response) {
                result.external = response["external"];
              }
              if ("sideEffects" in response) {
                if (response["sideEffects"]) {
                  result.sideEffects = SideEffectsTrue;
                } else {
                  result.sideEffects = SideEffectsFalse;
                }
              }
              if ("pluginData" in response) {
                result.pluginData = response["pluginData"];
              }
              if ("errors" in response) {
                result.errors = decodeMessages(response["errors"]);
              }
              if ("warnings" in response) {
                result.warnings = decodeMessages(response["warnings"]);
              }
              if ("watchFiles" in response) {
                result.watchFiles = decodeStringArray(response["watchFiles"]);
              }
              if ("watchDirs" in response) {
                result.watchDirs = decodeStringArray(response["watchDirs"]);
              }

              return [result, null];
            });
          }

          // Only register "OnLoad" if needed
          if (onLoadCallbacks.length > 0) {
            b.onLoad(new OnLoadOptions(".*", ""), async (args            )                                         => {
              const ids           = [];
              const applyPath = new Path(args.path, args.namespace);
              for (const item of onLoadCallbacks) {
                if (pluginAppliesToPath(applyPath, item.filter, item.namespace)) {
                  ids.push(item.id);
                }
              }

              const result = new OnLoadResult();
              if (ids.length === 0) {
                return [result, null];
              }

              const with_      = {};
              for (const k of Object.keys(args.with)) {
                setMapKey(with_, k, args.with[k]);
              }

              const response = await this.sendRequest({
                command: "on-load",
                key: key,
                ids: ids,
                path: args.path,
                namespace: args.namespace,
                suffix: args.suffix,
                pluginData: args.pluginData,
                with: with_,
              });
              if (!isMap(response)) {
                return [result, "The service was stopped"];
              }

              if ("id" in response) {
                const id         = response["id"];
                for (const item of onLoadCallbacks) {
                  if (item.id === id) {
                    result.pluginName = item.pluginName;
                    break;
                  }
                }
              }
              if ("error" in response) {
                return [result, response["error"]];
              }
              if ("pluginName" in response) {
                result.pluginName = response["pluginName"];
              }
              if ("loader" in response) {
                const [loader, err] = parseLoader(response["loader"]);
                if (err !== null) {
                  return [result, err.text];
                }
                result.loader = loader;
              }
              if ("contents" in response) {
                result.contents = response["contents"];
              }
              if ("resolveDir" in response) {
                result.resolveDir = response["resolveDir"];
              }
              if ("pluginData" in response) {
                result.pluginData = response["pluginData"];
              }
              if ("errors" in response) {
                result.errors = decodeMessages(response["errors"]);
              }
              if ("warnings" in response) {
                result.warnings = decodeMessages(response["warnings"]);
              }
              if ("watchFiles" in response) {
                result.watchFiles = decodeStringArray(response["watchFiles"]);
              }
              if ("watchDirs" in response) {
                result.watchDirs = decodeStringArray(response["watchDirs"]);
              }

              return [result, null];
            });
          }
        }),
      ],
      hasOnEnd,
      null,
    ];
  }

  handleTransformRequest(id        , request     )             {
    const inputFS          = request["inputFS"];
    const inputBytes             = request["input"];
    const flags = decodeStringArray(request["flags"]);

    // cli.ParseTransformOptions (in transformFromFlags) goes first
    let transformInput             = inputBytes;
    let input = "";
    if (inputFS) {
      // (the input is a file name: Go's string(bytes) of what the glue
      // encoded, i.e. valid UTF-8)
      input = goStringFromBytes(inputBytes);
    }
    const mangleCache = isMap(request["mangleCache"]) ? request["mangleCache"] : null;

    // The flags are parsed before the input file is read (a flag error
    // leaves the file alone)
    let result                            ;
    if (inputFS) {
      const parseErr = checkTransformFlags(flags);
      if (parseErr !== null) {
        return encodeErrorPacket(id, parseErr.text);
      }
      const [bytes, err] = osReadFileHost(this.host.hostFS, input);
      let removeErr      = null;
      if (err === null) {
        removeErr = osRemove(this.host.hostFS, input);
      }
      if (err !== null) {
        return encodeErrorPacket(id, err.error());
      }
      if (removeErr !== null) {
        return encodeErrorPacket(id, removeErr.error());
      }
      transformInput = bytes ;
    }
    result = transformFromFlags(flags, transformInput, mangleCache);
    if (result instanceof CLIError) {
      return encodeErrorPacket(id, result.text);
    }

    let code                      = result.code;
    let map                      = result.map;
    let codeFS = false;
    let mapFS = false;

    if (inputFS && result.code.length > 0) {
      const file = input + ".code";
      if (osWriteFile(this.host.hostFS, file, encodeWTF8(result.code), 0o644) === null) {
        code = file;
        codeFS = true;
      }
    }

    if (inputFS && result.map.length > 0) {
      const file = input + ".map";
      if (osWriteFile(this.host.hostFS, file, encodeWTF8(result.map), 0o644) === null) {
        map = file;
        mapFS = true;
      }
    }

    const response      = {
      errors: encodeMessages(convertMessagesToPublic(MsgError, result.msgs, result.logPathStyle)),
      warnings: encodeMessages(convertMessagesToPublic(MsgWarning, result.msgs, result.logPathStyle)),

      codeFS: codeFS,
      code: code,

      mapFS: mapFS,
      map: map,
    };

    if (result.legalComments !== null) {
      response["legalComments"] = result.legalComments;
    }

    if (result.mangleCache !== null) {
      response["mangleCache"] = encodeMangleCache(result.mangleCache);
    }

    return encodePacket(new Packet(response, id, false));
  }

  handleFormatMessagesRequest(id        , request     )             {
    const msgs = decodeMessages(request["messages"]);

    let kind = MsgError;
    if (request["isWarning"]) {
      kind = MsgWarning;
    }
    let color = false;
    if (typeof request["color"] === "boolean") {
      color = request["color"];
    }
    let terminalWidth = 0;
    if (typeof request["terminalWidth"] === "number") {
      terminalWidth = request["terminalWidth"];
    }
    let logStyle = StyleDefault;
    const style = request["logStyle"];
    if (typeof style === "string") {
      switch (style) {
        case "default":
          logStyle = StyleDefault;
          break;
        case "visualstudio":
          logStyle = StyleVisualStudio;
          break;
        default:
          return encodePacket(new Packet({ error: "Invalid log style: " + goQuote(style) }, id, false));
      }
    }

    const result = formatMsgsImpl(msgs, kind, color, terminalWidth, logStyle);

    return encodePacket(
      new Packet(
        {
          messages: result.map(byteStringValue),
        },
        id,
        false,
      ),
    );
  }

  handleAnalyzeMetafileRequest(id        , request     )             {
    const metafile         = request["metafile"];

    let color = false;
    let verbose = false;
    if (typeof request["color"] === "boolean") {
      color = request["color"];
    }
    if (typeof request["verbose"] === "boolean") {
      verbose = request["verbose"];
    }

    const result = analyzeMetafileImpl(metafile, verbose, color);

    return encodePacket(
      new Packet(
        {
          result: result,
        },
        id,
        false,
      ),
    );
  }
}

function writeUint32(bytes            , offset        , value        ) {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
  bytes[offset + 2] = value >>> 16;
  bytes[offset + 3] = value >>> 24;
}

function readUint32(bytes            , offset        )         {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function isMap(value     )          {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);
}

// A Go map key on a plain object ("__proto__" is an ordinary key)
function setMapKey(obj     , key        , value     ) {
  if (key === "__proto__") Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  else obj[key] = value;
}

// request["mangleCache"].(map[string]interface{}) as a Map, or null
function decodeMap(value     )                          {
  if (!isMap(value)) return null;
  const map = new Map             ();
  for (const k of Object.keys(value)) map.set(k, value[k]);
  return map;
}

function encodeMangleCache(mangleCache                         )      {
  const obj      = {};
  if (mangleCache !== null) {
    for (const [k, v] of mangleCache) setMapKey(obj, k, v);
  }
  return obj;
}

// A byte string (one char per byte) as a Go string value
function byteStringValue(s        )             {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new ByteString(bytes);
}

export function encodeErrorPacket(id        , err        )             {
  return encodePacket(new Packet({ error: err }, id, false));
}

function resolveKindToString(kind        )         {
  switch (kind) {
    case ResolveEntryPoint:
      return "entry-point";

    // JS
    case ResolveJSImportStatement:
      return "import-statement";
    case ResolveJSRequireCall:
      return "require-call";
    case ResolveJSDynamicImport:
      return "dynamic-import";
    case ResolveJSRequireResolve:
      return "require-resolve";

    // CSS
    case ResolveCSSImportRule:
      return "import-rule";
    case ResolveCSSComposesFrom:
      return "composes-from";
    case ResolveCSSURLToken:
      return "url-token";

    default:
      throw new Error("Internal error");
  }
}

function stringToResolveKind(kind        )                    {
  switch (kind) {
    case "entry-point":
      return [ResolveEntryPoint, true];

    // JS
    case "import-statement":
      return [ResolveJSImportStatement, true];
    case "require-call":
      return [ResolveJSRequireCall, true];
    case "dynamic-import":
      return [ResolveJSDynamicImport, true];
    case "require-resolve":
      return [ResolveJSRequireResolve, true];

    // CSS
    case "import-rule":
      return [ResolveCSSImportRule, true];
    case "composes-from":
      return [ResolveCSSComposesFrom, true];
    case "url-token":
      return [ResolveCSSURLToken, true];
  }

  return [ResolveNone, false];
}

function decodeStringArray(values       )           {
  const strings           = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    strings[i] = values[i];
  }
  return strings;
}

function encodeOutputFiles(outputFiles                     )        {
  if (outputFiles === null) return [];
  const values        = new Array(outputFiles.length);
  for (let i = 0; i < outputFiles.length; i++) {
    const outputFile = outputFiles[i];
    values[i] = {
      path: outputFile.path,
      contents: outputFile.contents,
      hash: outputFile.hash,
    };
  }
  return values;
}

function encodeLocation(loc                    )      {
  if (loc === null) {
    return null;
  }
  return {
    file: loc.file,
    namespace: loc.namespace,
    line: loc.line,
    column: loc.column,
    length: loc.length,
    lineText: loc.lineText,
    suggestion: loc.suggestion,
  };
}

export function encodeMessages(msgs              )        {
  const values        = new Array(msgs.length);
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    const value      = {
      id: msg.id,
      pluginName: msg.pluginName,
      text: msg.text,
      location: encodeLocation(msg.location),
    };
    values[i] = value;

    const notes        = new Array(msg.notes.length);
    for (let j = 0; j < msg.notes.length; j++) {
      const note = msg.notes[j];
      notes[j] = {
        text: note.text,
        location: encodeLocation(note.location),
      };
    }
    value["notes"] = notes;

    // Send "-1" to mean "undefined"
    let detail = msg.detail;
    if (typeof detail !== "number") {
      detail = -1;
    }
    value["detail"] = detail;
  }
  return values;
}

function decodeLocation(value     )                     {
  if (value === null || value === undefined) {
    return null;
  }
  const loc = value;
  let namespace         = loc["namespace"];
  if (namespace === "") {
    namespace = "file";
  }
  return new APILocation(loc["file"], namespace, loc["line"], loc["column"], loc["length"], loc["lineText"], loc["suggestion"]);
}

export function decodeMessages(values       )               {
  const msgs               = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const obj = values[i];
    const msg = new APIMessage(obj["id"], obj["pluginName"], obj["text"], decodeLocation(obj["location"]), [], obj["detail"]);
    for (const note of obj["notes"]) {
      msg.notes.push(new APINote(note["text"], decodeLocation(note["location"])));
    }
    msgs[i] = msg;
  }
  return msgs;
}

function decodeLocationToPrivate(value     )                     {
  if (value === null || value === undefined) {
    return null;
  }
  const loc = value;
  let namespace         = loc["namespace"];
  if (namespace === "") {
    namespace = "file";
  }
  const file         = loc["file"];
  return new MsgLocation(new PrettyPaths(file, file), namespace, loc["lineText"], loc["suggestion"], loc["line"], loc["column"], loc["length"]);
}

function decodeMessageToPrivate(obj     )      {
  const msg = new Msg(null, obj["pluginName"], new MsgData(obj["detail"], decodeLocationToPrivate(obj["location"]), obj["text"]), MsgError, stringToMaximumMsgID(obj["id"]));
  for (const note of obj["notes"]) {
    if (msg.notes === null) msg.notes = [];
    msg.notes.push(new MsgData(undefined, decodeLocationToPrivate(note["location"]), note["text"]));
  }
  return msg;
}
// generated from service.mts by tools/ts-build.mjs; edit that file
