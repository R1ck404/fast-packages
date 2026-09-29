// Preloaded by test/no-go.mjs into bin/esbuild's process: reports (on
// stderr) any child process it starts and any WebAssembly module importing
// Go's runtime it instantiates, in the main thread and in worker threads.
const childProcess = require("node:child_process");
for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "fork", "exec", "execSync"]) {
  const orig = childProcess[name];
  childProcess[name] = function (...args) {
    process.stderr.write("SPAWNED " + name + " " + String(args[0]) + "\n");
    return orig.apply(this, args);
  };
}
const OrigInstance = WebAssembly.Instance;
WebAssembly.Instance = function (mod, imports) {
  const modules = WebAssembly.Module.imports(mod).map((i) => i.module);
  if (modules.includes("gojs") || modules.includes("go")) process.stderr.write("GOJS\n");
  return new OrigInstance(mod, imports);
};
WebAssembly.Instance.prototype = OrigInstance.prototype;
// (worker threads get this file too)
const { Worker } = require("node:worker_threads");
const worker_threads = require("node:worker_threads");
const OrigWorker = Worker;
worker_threads.Worker = class extends OrigWorker {
  constructor(file, options = {}) {
    const execArgv = [...(options.execArgv || process.execArgv), "--require", __filename];
    super(file, { ...options, execArgv });
  }
};
