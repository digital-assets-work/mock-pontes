#!/usr/bin/env node
// Appends coverage/coverage-summary.json's overall percentages to the
// current GitHub Actions job's step summary ($GITHUB_STEP_SUMMARY), so the
// headline numbers are visible directly on the workflow run's "Summary"
// page -- no need to open the `coverage` branch/Pages site just to see
// them (issue #117).
//
// Deliberately concise (overall only, no per-file table): the full
// per-file breakdown belongs on the `coverage` branch (README.md +
// per-file/ annotated markdown, see render-coverage-branch.mjs), not
// bloated into every job summary.
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatOverall } from "./coverage-badges.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const summaryFile = path.join(repoRoot, "coverage", "coverage-summary.json");

function renderMarkdown(summary) {
  return ["## Coverage Report", "", formatOverall(summary.total), ""].join("\n");
}

function main() {
  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!stepSummaryPath) {
    console.warn("coverage-step-summary: GITHUB_STEP_SUMMARY is not set (not running in a GitHub Actions job) -- printing to stdout instead.");
  }

  const summary = JSON.parse(readFileSync(summaryFile, "utf8"));
  const markdown = renderMarkdown(summary);

  if (stepSummaryPath) {
    appendFileSync(stepSummaryPath, markdown);
  } else {
    console.log(markdown);
  }
}

main();
