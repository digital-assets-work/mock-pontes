#!/usr/bin/env node
// Renders the content published to the orphan `coverage` branch on every
// push to `main` (see .github/workflows/publish-coverage.yml, issue #117):
// a README.md summary (overall + per-file table) and the raw coverage
// artifacts (lcov.info/coverage-summary.json/html/) copied over verbatim
// for anyone who wants to browse/download the full report.
//
// Adapted from saturngroup/framework-monorepo's
// scripts/render-coverage-branch.mjs, simplified for this repo: mock-pontes
// is a single package (no Lerna/workspaces), so there's no per-workspace
// merging/splitting to do -- just one flat file-level breakdown.
//
// This script only *renders content* into a staging directory
// (`coverage-branch-staging/` by default) -- it does not touch git at all.
// The workflow's own steps handle the orphan-branch checkout/commit/
// force-push dance around it: each run's content is force-pushed as a
// single parentless commit, so the `coverage` branch's git history/object
// size stays bounded to roughly one run's worth of content rather than
// growing unbounded across hundreds of pushes -- only HISTORY.md's small
// per-run text rows are carried forward and actually accumulate. That's
// why HISTORY.md's prior content has to be read from `origin/coverage`'s
// current tip (via `--prev-history`, populated by the workflow with
// `git show origin/coverage:HISTORY.md` *before* the branch gets reset)
// and passed in here, rather than this script touching git itself.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coverageDir = path.join(repoRoot, "coverage");
const summaryFile = path.join(coverageDir, "coverage-summary.json");

const REPO_SLUG = "digital-assets-work/mock-pontes";

const HISTORY_HEADER = [
  "# Coverage history",
  "",
  "One row is appended here per push to `main` -- the rest of this branch's",
  "content (`README.md`, raw `lcov.info`/`html/`) is fully overwritten each",
  "run (see the workflow file for why), but this file accumulates so",
  "coverage trends over time stay visible.",
  "",
  "| Date | Commit | Lines | Functions | Branches |",
  "| --- | --- | ---: | ---: | ---: |",
].join("\n");

// Traffic-light thresholds: below 30% is red, 30-70% is orange, 70% and
// above is green. GitHub's Markdown renderer strips inline CSS/`style`
// attributes, so plain colored text isn't possible -- colored-square emoji
// are the standard, dependency-free way to convey per-cell color in
// GitHub-flavored Markdown.
export function pctBadge(pct) {
  if (pct < 30) return "🟥";
  if (pct < 70) return "🟧";
  return "🟩";
}

export function formatMetric(metric) {
  return `${metric.pct}% (${metric.covered}/${metric.total}) ${pctBadge(metric.pct)}`;
}

function parseArgs(argv) {
  const args = {
    outDir: path.join(repoRoot, "coverage-branch-staging"),
    prevHistory: null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out-dir") args.outDir = path.resolve(argv[++i]);
    else if (argv[i] === "--prev-history") args.prevHistory = path.resolve(argv[++i]);
  }
  return args;
}

function resolveCommitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  // Fallback for local/manual runs outside of Actions (GITHUB_SHA unset).
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();
}

function readPrevHistory(prevHistoryPath) {
  if (!prevHistoryPath || !existsSync(prevHistoryPath)) return HISTORY_HEADER;
  const content = readFileSync(prevHistoryPath, "utf8").trim();
  return content.length > 0 ? content : HISTORY_HEADER;
}

// Jest's `json-summary` reporter keys `coverage-summary.json`'s per-file
// entries by *absolute* filesystem path (e.g. the CI runner's own
// `/home/runner/work/.../mock-pontes/src/...`), not a repo-relative one --
// convert to a repo-relative path for stable, portable links/sorting.
function toRelative(absoluteFile) {
  return path.relative(repoRoot, absoluteFile).split(path.sep).join("/");
}

function renderReadme(summary, { shortSha, commitUrl }) {
  const { total, ...files } = summary;
  const lines = [];
  lines.push("## Coverage Report");
  lines.push("");
  lines.push(`Generated from commit [\`${shortSha}\`](${commitUrl}).`);
  lines.push("");
  lines.push(
    `${pctBadge(total.lines.pct)} **Overall**: Lines ${total.lines.pct}% (${total.lines.covered}/${total.lines.total}) · ` +
      `Statements ${total.statements.pct}% (${total.statements.covered}/${total.statements.total}) · ` +
      `Functions ${total.functions.pct}% (${total.functions.covered}/${total.functions.total}) · ` +
      `Branches ${total.branches.pct}% (${total.branches.covered}/${total.branches.total})`,
  );
  lines.push("");

  const fileEntries = Object.entries(files)
    .map(([file, totals]) => [toRelative(file), totals])
    .sort(([a], [b]) => a.localeCompare(b));

  if (fileEntries.length > 0) {
    lines.push("<details><summary>Per-file coverage detail</summary>");
    lines.push("");
    lines.push("| File | Lines | Statements | Functions | Branches |");
    lines.push("| --- | ---: | ---: | ---: | ---: |");
    for (const [file, totals] of fileEntries) {
      lines.push(
        `| ${file} | ${formatMetric(totals.lines)} | ${formatMetric(totals.statements)} | ${formatMetric(totals.functions)} | ${formatMetric(totals.branches)} |`,
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push(
    "Browse the raw `coverage-summary.json`/`lcov.info`, or open `html/index.html`, from this branch's root for the full line-by-line report. See [`HISTORY.md`](HISTORY.md) for coverage over time.",
  );
  lines.push("");
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = JSON.parse(readFileSync(summaryFile, "utf8"));

  const sha = resolveCommitSha();
  const shortSha = sha.slice(0, 7);
  const commitUrl = `https://github.com/${REPO_SLUG}/commit/${sha}`;

  mkdirSync(args.outDir, { recursive: true });

  const readme = renderReadme(summary, { shortSha, commitUrl });
  writeFileSync(path.join(args.outDir, "README.md"), `${readme.trim()}\n`);

  const prevHistory = readPrevHistory(args.prevHistory);
  const date = new Date().toISOString().slice(0, 10);
  const newRow = `| ${date} | [\`${shortSha}\`](${commitUrl}) | ${summary.total.lines.pct}% | ${summary.total.functions.pct}% | ${summary.total.branches.pct}% |`;
  writeFileSync(path.join(args.outDir, "HISTORY.md"), `${prevHistory}\n${newRow}\n`);

  for (const [src, dest] of [
    ["lcov.info", "lcov.info"],
    ["coverage-summary.json", "coverage-summary.json"],
    ["lcov-report", "html"],
  ]) {
    const srcPath = path.join(coverageDir, src);
    if (existsSync(srcPath)) cpSync(srcPath, path.join(args.outDir, dest), { recursive: true });
  }

  console.log(`render-coverage-branch: staged content in ${path.relative(repoRoot, args.outDir)}`);
}

main();
