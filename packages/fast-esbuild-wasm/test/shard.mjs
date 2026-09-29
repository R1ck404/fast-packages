// Runs a test suite in parallel processes: the suite's jobs (files, builds)
// are split over --jobs processes (default: the number of CPU threads minus
// 4, leaving some for the rest of the machine; --jobs 1 runs it in this
// process as before). Each process runs the same script with "--shard i/n"
// and takes every n-th job; it prints its report lines as usual and, last, a
// summary line that the parent adds up. The parent prints the processes'
// lines in shard order, then the suite's usual summary from the sums, so a
// run is deterministic and fails exactly when the serial run would.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const SUMMARY = "SHARD-SUMMARY ";

export function defaultJobs() {
  return Math.max(1, os.availableParallelism() - 4);
}

// {index, count} for a process that runs one shard, null for the parent (or a
// serial run)
export function shardOf(args) {
  const i = args.indexOf("--shard");
  if (i < 0) return null;
  const [index, count] = args[i + 1].split("/").map(Number);
  return { index, count, take: (n) => n % count === index };
}

// The number of processes to split into (1: no split)
export function jobsOf(args) {
  const i = args.indexOf("--jobs");
  return i >= 0 ? Math.max(1, Number(args[i + 1]) || 1) : defaultJobs();
}

// A shard process's last line
export function printSummary(summary) {
  process.stdout.write(SUMMARY + JSON.stringify(summary) + "\n");
}

// The job list the parent passed to runShards (so that every process splits
// the same list, even if the files it was made from change meanwhile), or
// null
export function shardList(args) {
  const i = args.indexOf("--shard-list");
  return i < 0 ? null : JSON.parse(readFileSync(args[i + 1], "utf8"));
}

// Runs the script (the calling one) in "count" processes and returns their
// summaries (in shard order), after printing their other output in shard
// order. A process that fails without a summary makes this throw. "list"
// (JSON), when given, is what shardList() returns in the processes.
export async function runShards(scriptPath, args, count, env = process.env, list = null) {
  let listDir = null;
  if (list !== null) {
    listDir = mkdtempSync(join(os.tmpdir(), "shard-list-"));
    writeFileSync(join(listDir, "list.json"), JSON.stringify(list));
    args = [...args, "--shard-list", join(listDir, "list.json")];
  }
  const outs = await Promise.all(
    Array.from(
      { length: count },
      (_, i) =>
        new Promise((resolve) => {
          const child = spawn(process.execPath, [scriptPath, ...args.filter((a, j) => a !== "--jobs" && args[j - 1] !== "--jobs"), "--shard", `${i}/${count}`], { env, stdio: ["ignore", "pipe", "pipe"] });
          let out = "";
          let err = "";
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (d) => (out += d));
          child.stderr.on("data", (d) => (err += d));
          child.on("close", (status) => resolve({ out, err, status }));
        }),
    ),
  );
  const summaries = [];
  outs.forEach(({ out, err, status }, i) => {
    const lines = out.split("\n");
    const last = lines.findLastIndex((l) => l.startsWith(SUMMARY));
    for (let j = 0; j < lines.length; j++) if (j !== last && (lines[j] !== "" || j < lines.length - 1)) console.log(lines[j]);
    if (err.trim() !== "") process.stderr.write(err);
    if (last < 0) throw new Error(`shard ${i}/${count} failed (exit status ${status}) without a summary`);
    summaries.push(JSON.parse(lines[last].slice(SUMMARY.length)));
  });
  if (listDir !== null) rmSync(listDir, { recursive: true, force: true });
  return summaries;
}

// Adds up objects of numbers (nested objects too)
export function addUp(objects) {
  const sum = {};
  const add = (into, from) => {
    for (const [k, v] of Object.entries(from)) {
      if (typeof v === "number") into[k] = (into[k] || 0) + v;
      else if (v !== null && typeof v === "object" && !Array.isArray(v)) add((into[k] ??= {}), v);
      else if (Array.isArray(v)) into[k] = (into[k] || []).concat(v);
    }
  };
  for (const o of objects) add(sum, o);
  return sum;
}
