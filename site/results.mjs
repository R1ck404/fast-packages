// Reads the result tables out of README.md, so the site shows the numbers the
// repository publishes instead of a second copy that could drift.

import fs from "node:fs";
import path from "node:path";
import { root } from "./packages.mjs";

const sectionKeys = [
  [/^fast-pako vs/, "pako"],
  [/^fast-acorn/, "acorn"],
  [/^fast-es-module-lexer vs/, "lexer"],
  [/^fast-brotli-wasm vs/, "brotli"],
  [/^fast-noble-hashes vs/, "noble"],
  [/^fast-esbuild-wasm vs/, "esbuild"],
  [/^Startup/, "startup"],
  [/^Size/, "size"],
];

const UNITS = { ns: 1e-6, "µs": 1e-3, us: 1e-3, ms: 1, s: 1e3 };

export function parseTime(text) {
  const m = /^([\d.]+)\s*(ns|µs|us|ms|s)\b/.exec(text.trim());
  return m ? parseFloat(m[1]) * UNITS[m[2]] : null;
}

export function parseSpeedup(text) {
  const m = /([\d.]+)x/.exec(text);
  return m ? parseFloat(m[1]) : null;
}

const splitRow = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function parseResults(readme) {
  const lines = readme.split(/\r?\n/);
  const out = {};
  let key = null;
  let paragraph = []; // the paragraph being read
  let lastParagraph = []; // the last complete one: the caption of a table that follows
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const h = /^#{2,3} (.*)/.exec(line);
    if (h) {
      const title = h[1];
      key = sectionKeys.find(([re]) => re.test(title))?.[1] ?? null;
      if (key && !out[key]) out[key] = { title, tables: [] };
      paragraph = [];
      lastParagraph = [];
      i++;
      continue;
    }
    if (key && /^\|.*\|$/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] ?? "")) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      const table = { caption: lastParagraph.join(" ").replace(/\s+/g, " ").trim(), header, rows };
      const su = header.findIndex((c) => /speedup/i.test(c));
      if (su >= 2) {
        table.speedupCol = su;
        table.fastCol = su - 1;
        table.origCol = su - 2;
      }
      out[key].tables.push(table);
      paragraph = [];
      lastParagraph = [];
      continue;
    }
    if (line.trim() === "") {
      if (paragraph.length) lastParagraph = paragraph;
      paragraph = [];
    } else if (!/^[|*`]|^\d\.|^¹|^²/.test(line.trim()) || /^`compress/.test(line.trim())) paragraph.push(line.trim());
    i++;
  }
  return out;
}

export function loadResults() {
  return parseResults(fs.readFileSync(path.join(root, "README.md"), "utf8"));
}

// the range of speedups a package's tables report, for the landing page
export function speedupRange(section) {
  let lo = Infinity;
  let hi = 0;
  for (const t of section?.tables ?? []) {
    if (t.speedupCol == null) continue;
    for (const r of t.rows) {
      const v = parseSpeedup(r[t.speedupCol] ?? "");
      if (v && parseTime(r[t.origCol] ?? "") != null) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  return lo === Infinity ? null : { lo, hi };
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const NODEPOD = '<a href="https://r1ck404.github.io/Nodepod/">Nodepod</a>';

export function inline(s) {
  return esc(s)
    .replace(/Nodepod/g, NODEPOD)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

const barWidth = (v) => Math.max(4, Math.min(100, (Math.log(v) / Math.log(30)) * 100));

// One results table as HTML: the speedup column gets a bar on a log scale
export function tableHtml(t) {
  const head = t.header
    .map((c, i) => `<th scope="col"${i === t.speedupCol ? ' class="x-col"' : ""}>${inline(c)}</th>`)
    .join("");
  const body = t.rows
    .map((r) => {
      const cells = r
        .map((c, i) => {
          if (i === t.speedupCol || (t.speedupCol != null && /speedup/i.test(t.header[i] ?? ""))) {
            const v = parseSpeedup(c);
            if (v && v >= 1.005) {
              return `<td class="x-col"><span class="xbar" style="--w:${barWidth(v).toFixed(1)}%"></span><span class="xval">${v >= 10 ? Math.round(v) : v.toFixed(1)}x</span></td>`;
            }
            return `<td class="x-col"><span class="xval">${inline(c)}</span></td>`;
          }
          const num = i >= (t.origCol ?? 99) ? " num" : "";
          return `<td class="${num.trim()}">${inline(c)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");
  return `<div class="table-wrap"><table class="results"><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>`;
}

export function sectionHtml(section) {
  if (!section) return "";
  return section.tables
    .map((t) => (t.caption ? `<p class="table-caption">${inline(t.caption)}</p>` : "") + tableHtml(t))
    .join("\n");
}

// ---- the landing page's range chart ----------------------------------------

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * One row per package: the span from its smallest to its largest speedup, with
 * a tick at the median, on a log scale. `rows` is [{ label, href, key }].
 * The esbuild rows come from the browser tables only (the Node table is
 * inflated by esbuild-wasm's timer wait, which the README says), and the bare
 * initialize() row is startup, not work.
 */
export function rangeChartHtml(results, rows) {
  const max = 25;
  const pos = (v) => (Math.log(Math.max(v, 1)) / Math.log(max)) * 100;
  const body = rows
    .map(({ label, href, key }) => {
      const sec = results[key];
      const values = [];
      (sec?.tables ?? []).slice(0, key === "esbuild" ? 2 : undefined).forEach((t) => {
        if (t.speedupCol == null) return;
        for (const r of t.rows) {
          if (/^`initialize\(\)` \(/.test(r[0])) continue;
          const v = parseSpeedup(r[t.speedupCol] ?? "");
          if (v && parseTime(r[t.origCol] ?? "") != null) values.push(v);
        }
      });
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      const mid = median(values);
      const f = (v) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1));
      return `<div class="rc-row">
  <a class="rc-name" href="${href}">${label}</a>
  <div class="rc-track" role="img" aria-label="${label}: ${f(lo)}x to ${f(hi)}x faster, typically ${f(mid)}x">
    ${[2, 5, 10].map((t) => `<span class="rc-grid" style="left:${pos(t).toFixed(1)}%"></span>`).join("")}
    <span class="rc-span" style="left:${pos(lo).toFixed(1)}%;width:${Math.max(0.6, pos(hi) - pos(lo)).toFixed(1)}%"></span>
    <span class="rc-mid" style="left:${pos(mid).toFixed(1)}%"></span>
  </div>
  <div class="rc-label">${f(lo)} to ${f(hi)}x</div>
</div>`;
    })
    .join("\n");
  const ticks = [1, 2, 5, 10, 20].map((t) => `<span style="left:${pos(t).toFixed(1)}%">${t}x</span>`).join("");
  return `<div class="rangechart">
${body}
<div class="rc-axis"><span></span><div class="rc-axis-in">${ticks}</div><span></span></div>
<p class="rc-legend">Each bar spans a package's smallest to largest speedup across the rows of its results table. The dark tick is the median row.</p>
</div>`;
}
