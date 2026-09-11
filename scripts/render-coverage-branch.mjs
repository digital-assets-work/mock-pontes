#!/usr/bin/env node
// Renders the content published to the orphan `coverage` branch on every
// push to `main` (see .github/workflows/publish-coverage.yml, issue #117):
// a README.md summary (overall + per-file table linking to annotated
// per-file pages), an HISTORY.md log, and the raw coverage artifacts
// (lcov.info/coverage-summary.json/html/) copied over verbatim for anyone
// who wants to browse/download the full report. The branch is also served
// as a GitHub Pages site (source: branch `coverage`, path `/`) -- see
// `.nojekyll`/`index.html` below.
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
//
// The per-file annotated markdown under `per-file/` is rendered
// separately by the vendored scripts/coverage-md.mjs (invoked directly by
// the workflow, in `--split` mode, into this same staging directory) --
// this script only links to it from README.md's per-file table.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { formatMetric, formatOverall } from "./coverage-badges.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coverageDir = path.join(repoRoot, "coverage");
const summaryFile = path.join(coverageDir, "coverage-summary.json");

const REPO_SLUG = "digital-assets-work/mock-pontes";
const PAGES_URL = "https://digital-assets-work.github.io/mock-pontes/";

const HISTORY_HEADER = [
  "# Coverage history",
  "",
  "One row is appended here per push to `main` -- the rest of this branch's",
  "content (`README.md`, `per-file/`, raw `lcov.info`/`html/`) is fully overwritten each",
  "run (see the workflow file for why), but this file accumulates so",
  "coverage trends over time stay visible.",
  "",
  "| Date | Commit | Lines | Functions | Branches |",
  "| --- | --- | ---: | ---: | ---: |",
].join("\n");

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

// coverage-md.mjs (--split, --below 100, its default) only writes a
// per-file .md page for files that aren't 100% covered -- mirror that same
// threshold here so we never link to a page that doesn't exist.
function detailLink(file, totals) {
  return totals.lines.pct < 100 ? `per-file/${file}.md` : null;
}

function renderReadme(summary, { shortSha, commitUrl }) {
  const { total, ...files } = summary;
  const lines = [];
  lines.push("## Coverage Report");
  lines.push("");
  lines.push(`Generated from commit [\`${shortSha}\`](${commitUrl}).`);
  lines.push("");
  lines.push(formatOverall(total));
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
      const link = detailLink(file, totals);
      const name = link ? `[${file}](${link})` : file;
      lines.push(
        `| ${name} | ${formatMetric(totals.lines)} | ${formatMetric(totals.statements)} | ${formatMetric(totals.functions)} | ${formatMetric(totals.branches)} |`,
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push(
    `Click a file above for its annotated per-line breakdown (readable directly on GitHub), browse the full interactive HTML report at [${PAGES_URL}](${PAGES_URL}) (or open \`html/index.html\` from this branch), or download the raw \`coverage-summary.json\`/\`lcov.info\`. See [\`HISTORY.md\`](HISTORY.md) for coverage over time.`,
  );
  lines.push("");
  return lines.join("\n");
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>mock-pontes coverage report</title>
<meta http-equiv="refresh" content="0; url=html/index.html">
</head>
<body>
<p>Redirecting to the <a href="html/index.html">interactive coverage report</a>...</p>
<p>See also the <a href="README.md">summary</a> and <a href="per-file/src/index.md">per-file annotated breakdown</a> browsable directly on GitHub.</p>
</body>
</html>
`;

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

  // GitHub Pages is served straight from this branch (source: branch
  // `coverage`, path `/`, see the workflow file) -- `.nojekyll` skips
  // Jekyll processing entirely (we only need static-file serving: Jest's
  // own `html/` report, plus the raw JSON/lcov artifacts and per-file .md
  // pages, none of which need/want Jekyll's Liquid templating applied),
  // and `index.html` gives visitors a friendly landing page instead of a
  // raw directory listing.
  writeFileSync(path.join(args.outDir, ".nojekyll"), "");
  writeFileSync(path.join(args.outDir, "index.html"), INDEX_HTML);

  console.log(`render-coverage-branch: staged content in ${path.relative(repoRoot, args.outDir)}`);
}

main();
