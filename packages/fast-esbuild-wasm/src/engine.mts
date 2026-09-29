// The engine as build.mjs bundles it (the "__fastEngineFactory" function
// returns this module): the transform fast path, the in-process service
// (cmd/esbuild/service.go) and the command line (cmd/esbuild/main.go), plus
// the hooks their hosts set (where Go's stdout, stderr, working directory,
// environment and file system are).

import "./wellformed.mjs";
export { fastTransform, stats, warmup } from "./transform.mjs";
export { Service, esbuildVersion } from "./service.mjs";
export { setStderr, setStderrBytes, setStdout } from "./logger.mjs";
export { setGetwd } from "./fs.mjs";
export { setGoEnv } from "./api_build.mjs";
export { runMain } from "./cli_main.mjs";
export { setPropagateStackOverflow } from "./recover.mjs";
// (deep mode: build.mjs's generator copies use these)
export { __deepM, __deepOwn, __deepRun } from "./deep.mjs";
import { forceDeepFromEnv } from "./deep.mjs";
forceDeepFromEnv();
