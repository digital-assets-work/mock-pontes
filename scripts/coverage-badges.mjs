// Shared badge/formatting helpers for the coverage-reporting workflow
// (issue #117): reused by both render-coverage-branch.mjs (the `coverage`
// branch's README.md) and coverage-step-summary.mjs (the Actions job's
// $GITHUB_STEP_SUMMARY), so the two renderers can't drift out of sync.
//
// Traffic-light thresholds: below 30% is red, 30-70% is orange, 70% and
// above is green. GitHub's Markdown renderer strips inline CSS/`style`
// attributes (both in repo file previews and job summaries), so plain
// colored text isn't possible -- colored-square emoji are the standard,
// dependency-free way to convey per-cell color in GitHub-flavored
// Markdown.
export function pctBadge(pct) {
  if (pct < 30) return "🟥";
  if (pct < 70) return "🟧";
  return "🟩";
}

export function formatMetric(metric) {
  return `${metric.pct}% (${metric.covered}/${metric.total}) ${pctBadge(metric.pct)}`;
}

export function formatOverall(total) {
  return (
    `${pctBadge(total.lines.pct)} **Overall**: Lines ${total.lines.pct}% (${total.lines.covered}/${total.lines.total}) · ` +
    `Statements ${total.statements.pct}% (${total.statements.covered}/${total.statements.total}) · ` +
    `Functions ${total.functions.pct}% (${total.functions.covered}/${total.functions.total}) · ` +
    `Branches ${total.branches.pct}% (${total.branches.covered}/${total.branches.total})`
  );
}
