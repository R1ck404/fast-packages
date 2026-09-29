// pkg/api/watcher.go: a polling file watcher (it detects when files are
// changed by repeatedly checking their contents).
//
// That said, this polling system is designed to use relatively little CPU vs.
// a more traditional polling system that scans the whole directory tree at
// once. The file system is still scanned regularly but each scan only checks
// a random subset of your files, which means a change to a file will be picked
// up soon after the change is made but not necessarily instantly.
//
// With the current heuristics, large projects should be completely scanned
// around every 2 seconds so in the worst case it could take up to 2 seconds
// for a change to be noticed. However, after a change has been noticed the
// change's path goes on a short list of recently changed paths which are
// checked on every scan, so further changes to recently changed files should
// be noticed almost instantly.
//
// (The goroutine is an async loop; its timers do not keep a Node process
// alive: the host does that while a context is alive, like esbuild's child
// process.)

import { WatchData } from "./fs.mjs";
import type { FS } from "./fs.mjs";
import { Path, printTextWithColor, writeStderr } from "./logger.mjs";
import { goQuote } from "./gostd.mjs";
import { makePrettyPaths } from "./build_deps.mjs";

// The time to wait between watch intervals
const watchIntervalSleep = 100;

// The maximum number of recently-edited items to check every interval
const maxRecentItemCount = 16;

// The minimum number of non-recent items to check every interval
const minItemCountPerIter = 64;

// The maximum number of intervals before a change is detected
const maxIntervalsBeforeUpdate = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer: any = setTimeout(resolve, ms);
    if (timer !== null && typeof timer === "object" && typeof timer.unref === "function") timer.unref();
  });
}

export class watcher {
  declare data: WatchData;
  declare fs: FS;
  declare rebuild: () => Promise<WatchData | null>;
  declare delayInMS: number;
  declare recentItems: string[];
  declare itemsToScan: string[];
  declare itemsPerIteration: number;
  declare shouldStop: boolean;
  declare shouldLog: boolean;
  declare useColor: number;
  declare pathStyle: number;
  declare stopped: Promise<void> | null; // (the stopWaitGroup: the loop's end)
  declare hasData: boolean; // (Go: w.data.Paths != nil)

  constructor(fs: FS, shouldLog: boolean, useColor: number, pathStyle: number, rebuild: () => Promise<WatchData | null>, delayInMS: number) {
    this.data = new WatchData();
    this.hasData = false;
    this.fs = fs;
    this.rebuild = rebuild;
    this.delayInMS = delayInMS;
    this.recentItems = [];
    this.itemsToScan = [];
    this.itemsPerIteration = 0;
    this.shouldStop = false;
    this.shouldLog = shouldLog;
    this.useColor = useColor;
    this.pathStyle = pathStyle;
    this.stopped = null;
  }

  // ("data" is null for Go's zero WatchData, whose Paths map is nil)
  setWatchData(data: WatchData | null) {
    // Print something for the end of the first build
    if (this.shouldLog && !this.hasData) {
      printTextWithColor(writeStderr, this.useColor, (colors) => {
        let delay = "";
        if (this.delayInMS > 0) {
          delay = " with a " + this.delayInMS + "ms delay";
        }
        return colors.dim + "[watch] build finished, watching for changes" + delay + "..." + colors.reset + "\n";
      });
    }

    this.data = data !== null ? data : new WatchData();
    this.hasData = data !== null;
    this.itemsToScan = [];

    // Remove any recent items that weren't a part of the latest build
    let end = 0;
    for (const path of this.recentItems) {
      if (this.data.paths.has(path)) {
        this.recentItems[end] = path;
        end++;
      }
    }
    this.recentItems.length = end;
  }

  start() {
    this.stopped = (async () => {
      // Note: Do not change these log messages without a breaking version change.
      // People want to run regexes over esbuild's stderr stream to look for these
      // messages instead of using esbuild's API.

      while (!this.shouldStop) {
        // Sleep for the watch interval
        await sleep(watchIntervalSleep);

        // Rebuild if we're dirty
        const absPath = this.tryToFindDirtyPath();
        if (absPath !== "") {
          // Optionally wait before rebuilding
          if (this.delayInMS > 0) {
            await sleep(this.delayInMS);
          }

          if (this.shouldLog) {
            printTextWithColor(writeStderr, this.useColor, (colors) => {
              const prettyPaths = makePrettyPaths(this.fs, new Path(absPath, "file"));
              return colors.dim + "[watch] build started (change: " + goQuote(prettyPaths.select(this.pathStyle)) + ")" + colors.reset + "\n";
            });
          }

          // Run the build
          this.setWatchData(await this.rebuild());

          if (this.shouldLog) {
            printTextWithColor(writeStderr, this.useColor, (colors) => {
              return colors.dim + "[watch] build finished" + colors.reset + "\n";
            });
          }
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.shouldStop = true;
    if (this.stopped !== null) await this.stopped;
  }

  tryToFindDirtyPath(): string {
    // If we ran out of items to scan, fill the items back up in a random order
    if (this.itemsToScan.length === 0) {
      const items: string[] = [];
      for (const path of this.data.paths.keys()) {
        items.push(path);
      }
      for (let i = items.length - 1; i > 0; i--) {
        // Fisher-Yates shuffle
        const j = Math.floor(Math.random() * (i + 1));
        const t = items[i];
        items[i] = items[j];
        items[j] = t;
      }
      this.itemsToScan = items;

      // Determine how many items to check every iteration, rounded up
      let perIter = Math.trunc((items.length + maxIntervalsBeforeUpdate - 1) / maxIntervalsBeforeUpdate);
      if (perIter < minItemCountPerIter) {
        perIter = minItemCountPerIter;
      }
      this.itemsPerIteration = perIter;
    }

    // Always check all recent items every iteration
    for (let i = 0; i < this.recentItems.length; i++) {
      const path = this.recentItems[i];
      const dirtyPath = this.data.paths.get(path)!();
      if (dirtyPath !== "") {
        // Move this path to the back of the list (i.e. the "most recent" position)
        this.recentItems.splice(i, 1);
        this.recentItems.push(path);
        return dirtyPath;
      }
    }

    // Check a constant number of items every iteration
    let remainingCount = this.itemsToScan.length - this.itemsPerIteration;
    if (remainingCount < 0) {
      remainingCount = 0;
    }
    const toCheck = this.itemsToScan.slice(remainingCount);
    this.itemsToScan = this.itemsToScan.slice(0, remainingCount);

    // Check if any of the entries in this iteration have been modified
    for (const path of toCheck) {
      const dirtyPath = this.data.paths.get(path)!();
      if (dirtyPath !== "") {
        // Mark this item as recent by adding it to the back of the list
        this.recentItems.push(path);
        if (this.recentItems.length > maxRecentItemCount) {
          // Remove items from the front of the list when we hit the limit
          this.recentItems.shift();
        }
        return dirtyPath;
      }
    }
    return "";
  }
}
