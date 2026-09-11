#!/usr/bin/env node
/**
 * coverage-md — render an Istanbul `coverage-final.json` as markdown,
 * with a per-source-file section showing the annotated code.
 *
 * Vendored verbatim from saturngroup/framework-monorepo's
 * scripts/coverage-md.mjs (linked from workbench issue #117) -- this is
 * what feeds scripts/render-coverage-branch.mjs's per-file annotated
 * markdown (invoked with `--split`), so uncovered lines/branches are
 * readable directly in GitHub's own file browser on the `coverage`
 * branch, without needing to download/open the raw HTML report.
 *
 * Zero dependencies. Works with anything that emits the Istanbul JSON
 * format: c8 --reporter=json, nyc, jest --coverageReporters=json,
 * vitest (v8 or istanbul provider), mcr ['json'].
 *
 * Usage:
 *   node coverage-md.mjs coverage/coverage-final.json [more.json ...] [options]
 *
 * Options:
 *   --out <file>        output markdown file (default: coverage/COVERAGE.md)
 *   --split <dir>       write one .md per source file into <dir> instead
 *   --root <dir>        base dir for relative paths (default: cwd)
 *   --context <n>       lines of context around uncovered regions (default: 3)
 *   --full              print the whole file instead of only uncovered regions
 *   --style <s>         "diff" (red uncovered lines) or "gutter" (default: diff)
 *   --max-lines <n>     skip the code block above this many rendered lines (default: 400)
 *   --below <pct>       only include files whose line coverage is below <pct> (default: 100)
 *   --collapse          wrap each file section in a <details> block
 *   --include <re>      only files matching this regex
 *   --exclude <re>      drop files matching this regex
 *   --title <text>      report title
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const opts = {
    inputs: [],
    out: 'coverage/COVERAGE.md',
    split: null,
    root: process.cwd(),
    context: 3,
    full: false,
    style: 'diff',
    maxLines: 400,
    below: 100,
    collapse: false,
    include: null,
    exclude: null,
    title: 'Coverage report'
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--out': opts.out = next(); break;
      case '--split': opts.split = next(); break;
      case '--root': opts.root = path.resolve(next()); break;
      case '--context': opts.context = Number(next()); break;
      case '--full': opts.full = true; break;
      case '--style': opts.style = next(); break;
      case '--max-lines': opts.maxLines = Number(next()); break;
      case '--below': opts.below = Number(next()); break;
      case '--collapse': opts.collapse = true; break;
      case '--include': opts.include = new RegExp(next()); break;
      case '--exclude': opts.exclude = new RegExp(next()); break;
      case '--title': opts.title = next(); break;
      case '-h':
      case '--help':
        console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
        process.exit(0);
        break;
      default:
        if (a.startsWith('-')) throw new Error(`unknown option: ${a}`);
        opts.inputs.push(a);
    }
  }
  if (!opts.inputs.length) opts.inputs.push('coverage/coverage-final.json');
  return opts;
}

// ---------------------------------------------------------------- coverage data

/** Merge several coverage-final.json files by summing their counters. */
function loadCoverage(inputs) {
  const merged = {};
  for (const input of inputs) {
    const data = JSON.parse(fs.readFileSync(input, 'utf8'));
    for (const [file, fc] of Object.entries(data)) {
      const prev = merged[file];
      if (!prev) {
        merged[file] = fc;
        continue;
      }
      // same instrumentation -> sum; otherwise keep the richer one
      if (Object.keys(prev.s).length !== Object.keys(fc.s).length) {
        console.warn(`! incompatible coverage for ${file}, keeping the first one`);
        continue;
      }
      for (const k of Object.keys(fc.s)) prev.s[k] += fc.s[k];
      for (const k of Object.keys(fc.f)) prev.f[k] += fc.f[k];
      for (const k of Object.keys(fc.b)) {
        prev.b[k] = prev.b[k].map((v, i) => v + fc.b[k][i]);
      }
    }
  }
  return merged;
}

/** Istanbul semantics: a line's hit count is the max count of statements starting on it. */
function lineCoverage(fc) {
  const lines = new Map();
  for (const [id, count] of Object.entries(fc.s)) {
    const loc = fc.statementMap[id];
    if (!loc) continue;
    const line = loc.start.line;
    const prev = lines.get(line);
    if (prev === undefined || prev < count) lines.set(line, count);
  }
  return lines;
}

function ratio(covered, total) {
  return { covered, total, pct: total === 0 ? 100 : (covered / total) * 100 };
}

function fileMetrics(fc) {
  const s = Object.values(fc.s);
  const f = Object.values(fc.f);
  const b = Object.values(fc.b).flat();
  const lines = [...lineCoverage(fc).values()];
  return {
    statements: ratio(s.filter((n) => n > 0).length, s.length),
    branches: ratio(b.filter((n) => n > 0).length, b.length),
    functions: ratio(f.filter((n) => n > 0).length, f.length),
    lines: ratio(lines.filter((n) => n > 0).length, lines.length)
  };
}

function addTotals(acc, m) {
  for (const k of ['statements', 'branches', 'functions', 'lines']) {
    acc[k].covered += m[k].covered;
    acc[k].total += m[k].total;
  }
  return acc;
}

function emptyTotals() {
  return {
    statements: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    lines: { covered: 0, total: 0 }
  };
}

/** Lines to flag, plus the reason, so the code block can be annotated. */
function uncoveredDetail(fc) {
  const lines = lineCoverage(fc);
  const uncovered = new Set();
  const partial = new Map(); // line -> "branch path not taken"
  const deadFns = [];        // { line, name }

  for (const [line, count] of lines) {
    if (count === 0) uncovered.add(line);
  }
  for (const [id, count] of Object.entries(fc.f)) {
    if (count === 0 && fc.fnMap[id]) {
      const decl = fc.fnMap[id].decl || fc.fnMap[id].loc;
      uncovered.add(decl.start.line);
      deadFns.push({ line: decl.start.line, name: fc.fnMap[id].name || '(anonymous)' });
    }
  }
  for (const [id, counts] of Object.entries(fc.b)) {
    const meta = fc.branchMap[id];
    if (!meta) continue;
    counts.forEach((count, i) => {
      if (count > 0) return;
      const loc = (meta.locations && meta.locations[i]) || meta.loc;
      // Istanbul's implicit-else branch for an `if` without an `else`
      // clause records its location as `{ start: {}, end: {} }` (no
      // `line`) -- fall back to the overall branch's own `meta.loc`
      // (which does have one) instead of surfacing "Lundefined" (patched
      // vs. the vendored original, which didn't handle this case).
      const line = loc?.start?.line ?? meta.loc?.start?.line;
      if (line === undefined) return;
      if (!uncovered.has(line)) {
        const kind = meta.type || 'branch';
        partial.set(line, kind);
      }
    });
  }
  return { lines, uncovered, partial, deadFns };
}

// The largest common ancestor directory shared by every given file path,
// so split-mode's index.md can be placed there instead of at the split
// root (e.g. `auth-roles/front` when every file is under it). Ignores each
// path's own filename segment, so a single file's common dir is its parent
// directory, not the file itself.
function commonDirPrefix(relPaths) {
  if (relPaths.length === 0) return '';
  const dirSegs = relPaths.map((rel) => rel.split('/').slice(0, -1));
  const minLen = Math.min(...dirSegs.map((segs) => segs.length));
  const common = [];
  for (let i = 0; i < minLen; i++) {
    const seg = dirSegs[0][i];
    if (dirSegs.every((segs) => segs[i] === seg)) common.push(seg);
    else break;
  }
  return common.join('/');
}

/** Strips a known directory prefix (as returned by `commonDirPrefix`) off `rel`. */
function stripCommonDir(rel, commonDir) {
  return commonDir ? rel.slice(commonDir.length + 1) : rel;
}

/** [1,2,3,7] -> "1-3, 7" */
function rangesOf(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const out = [];
  let start = null;
  let prev = null;
  for (const n of sorted) {
    if (start === null) { start = prev = n; continue; }
    if (n === prev + 1) { prev = n; continue; }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  if (start !== null) out.push(start === prev ? `${start}` : `${start}-${prev}`);
  return out;
}

// ---------------------------------------------------------------- rendering

function pct(n) {
  return `${n.toFixed(2)}%`;
}

function bar(n) {
  const filled = Math.round(n / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function badge(n) {
  if (n >= 80) return '🟢';
  if (n >= 50) return '🟡';
  return '🔴';
}

function readSource(file, fc) {
  if (typeof fc.code === 'string') return fc.code.split(/\r?\n/);
  if (Array.isArray(fc.code)) return fc.code;
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    return null;
  }
}

/** Which line numbers to print: uncovered regions +/- context, or everything. */
function visibleLines(total, uncovered, context, full) {
  if (full) return new Set(Array.from({ length: total }, (_, i) => i + 1));
  const keep = new Set();
  for (const line of uncovered) {
    for (let l = line - context; l <= line + context; l++) {
      if (l >= 1 && l <= total) keep.add(l);
    }
  }
  return keep;
}

/** Legend for the symbols used in the code block, matching the chosen style. */
function legend(detail, opts) {
  const items = [];
  if (opts.style === 'diff') {
    if (detail.uncovered.size) items.push('`-` uncovered statement');
    if (detail.partial.size) items.push('`!` branch with an untaken path');
    if (!opts.full) items.push('`\u22ee` covered lines skipped');
    items.push('gutter: line number');
  } else {
    if (detail.uncovered.size) items.push('`\u2717` uncovered statement');
    if (detail.partial.size) items.push('`~` branch with an untaken path');
    if (!opts.full) items.push('`\u22ee` covered lines skipped');
    items.push('gutter: line number | hit count');
  }
  return `_Legend: ${items.join(' \u00b7 ')}._`;
}

function renderCode(source, detail, opts) {
  const { uncovered, partial, lines, deadFns } = detail;
  const deadLines = new Set(deadFns.map((f) => f.line));
  const flagged = new Set([...uncovered, ...partial.keys()]);
  const keep = visibleLines(source.length, flagged, opts.context, opts.full);
  if (!keep.size) return '';
  if (keep.size > opts.maxLines) {
    return `_Code block skipped: ${keep.size} lines to render (over \`--max-lines ${opts.maxLines}\`)._\n`;
  }

  const width = String(source.length).length;
  const sorted = [...keep].sort((a, b) => a - b);
  const rows = [];
  let prev = null;
  for (const line of sorted) {
    if (prev !== null && line > prev + 1) rows.push({ gap: true });
    rows.push({ line });
    prev = line;
  }

  const body = rows.map((row) => {
    if (row.gap) return opts.style === 'diff' ? '  ⋮' : '  ⋮';
    const n = String(row.line).padStart(width, ' ');
    const text = source[row.line - 1] ?? '';
    const isUncovered = uncovered.has(row.line);
    const isPartial = !isUncovered && partial.has(row.line);
    if (opts.style === 'diff') {
      const mark = isUncovered ? '-' : isPartial ? '!' : ' ';
      return `${mark} ${n} | ${text}`;
    }
    const hits = deadLines.has(row.line) ? '0'
      : lines.has(row.line) ? String(lines.get(row.line)) : '';
    const mark = isUncovered ? '✗' : isPartial ? '~' : ' ';
    return `${mark} ${n} | ${hits.padStart(4, ' ')} | ${text}`;
  }).join('\n');

  const lang = opts.style === 'diff' ? 'diff' : 'text';
  return '```' + lang + '\n' + body + '\n```\n';
}

function renderFileSection(relPath, fc, opts) {
  const m = fileMetrics(fc);
  const detail = uncoveredDetail(fc);
  const source = readSource(fc.path || relPath, fc);

  const out = [];
  out.push(`| Metric | Coverage | |`);
  out.push(`| --- | --- | --- |`);
  for (const k of ['statements', 'branches', 'functions', 'lines']) {
    const v = m[k];
    out.push(`| ${k[0].toUpperCase() + k.slice(1)} | ${pct(v.pct)} (${v.covered}/${v.total}) | \`${bar(v.pct)}\` |`);
  }
  out.push('');

  const uncoveredRanges = rangesOf(detail.uncovered);
  if (uncoveredRanges.length) {
    out.push(`**Uncovered lines:** ${uncoveredRanges.join(', ')}`);
    out.push('');
  }
  const partialNotes = [...detail.partial.entries()].sort((a, b) => a[0] - b[0]);
  if (partialNotes.length) {
    out.push(`**Partial branches:** ${partialNotes.map(([l, kind]) => `L${l} (${kind})`).join(', ')}`);
    out.push('');
  }
  if (detail.deadFns.length) {
    out.push(`**Never called:** ${detail.deadFns.map((f) => `\`${f.name}\` (L${f.line})`).join(', ')}`);
    out.push('');
  }

  if (!source) {
    out.push('_Source file not found on disk; code block skipped._');
    out.push('');
  } else if (detail.uncovered.size || detail.partial.size || opts.full) {
    const block = renderCode(source, detail, opts);
    if (block.startsWith('```')) {
      out.push(legend(detail, opts));
      out.push('');
    }
    out.push(block);
  } else {
    out.push('_Fully covered._');
    out.push('');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- main

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const coverage = loadCoverage(opts.inputs);

  const files = Object.keys(coverage)
    .map((abs) => ({ abs, rel: path.relative(opts.root, abs).split(path.sep).join('/') }))
    .filter(({ rel }) => (opts.include ? opts.include.test(rel) : true))
    .filter(({ rel }) => (opts.exclude ? !opts.exclude.test(rel) : true))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  const totals = emptyTotals();
  const rows = [];
  for (const { abs, rel } of files) {
    const m = fileMetrics(coverage[abs]);
    addTotals(totals, m);
    rows.push({ abs, rel, m });
  }

  // Only meaningful in --split mode: where index.md itself is placed, so
  // per-file links can be relative to it instead of to the split root.
  const commonDir = opts.split ? commonDirPrefix(rows.map(({ rel }) => rel)) : '';

  const summaryLines = [];
  summaryLines.push(`# ${opts.title}`);
  summaryLines.push('');
  const totalPct = {};
  for (const k of Object.keys(totals)) {
    totalPct[k] = totals[k].total === 0 ? 100 : (totals[k].covered / totals[k].total) * 100;
  }
  summaryLines.push(
    `**Total:** ${badge(totalPct.lines)} lines ${pct(totalPct.lines)} ` +
    `(${totals.lines.covered}/${totals.lines.total}) · ` +
    `statements ${pct(totalPct.statements)} · branches ${pct(totalPct.branches)} · ` +
    `functions ${pct(totalPct.functions)}`
  );
  summaryLines.push('');
  summaryLines.push('| File | Stmts | Branch | Funcs | Lines | Uncovered |');
  summaryLines.push('| --- | ---: | ---: | ---: | ---: | --- |');
  for (const { abs, rel, m } of rows) {
    const anchor = rel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const missing = rangesOf(uncoveredDetail(coverage[abs]).uncovered);
    const shown = missing.slice(0, 6).join(', ') + (missing.length > 6 ? ', …' : '');
    // Only link to a per-file page when one is actually written below (files
    // at/above --below are skipped from `detailed`, so linking them would 404).
    const hasDetail = m.lines.pct < opts.below;
    const name = opts.split
      ? (hasDetail ? `[${rel}](${encodeURI(stripCommonDir(rel, commonDir))}.md)` : rel)
      : `[${rel}](#${anchor})`;
    summaryLines.push(
      `| ${badge(m.lines.pct)} ${name} | ${pct(m.statements.pct)} | ${pct(m.branches.pct)} ` +
      `| ${pct(m.functions.pct)} | ${pct(m.lines.pct)} | ${shown || '—'} |`
    );
  }
  summaryLines.push('');

  const detailed = rows.filter(({ m }) => m.lines.pct < opts.below);

  if (opts.split) {
    // index.md lives at the files' common ancestor directory (e.g.
    // `auth-roles/front`), not at the split root, so it sits alongside the
    // tree it indexes rather than one or more levels above it.
    const indexDir = commonDir ? path.join(opts.split, ...commonDir.split('/')) : opts.split;
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(path.join(indexDir, 'index.md'), summaryLines.join('\n'));
    for (const { abs, rel } of detailed) {
      // Mirror `rel`'s own full path structure under `opts.split` (e.g.
      // `auth-roles/front/public/config.js.md`) instead of flattening it,
      // so the split output tree matches the source tree.
      const target = path.join(opts.split, ...rel.split('/')) + '.md';
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const body = `# ${rel}\n\n${renderFileSection(rel, coverage[abs], opts)}`;
      fs.writeFileSync(target, body);
    }
    console.log(`Wrote ${detailed.length + 1} files to ${opts.split}`);
    return { indexPath: path.join(indexDir, 'index.md'), fileCount: detailed.length + 1 };
  }

  const parts = [...summaryLines];
  if (detailed.length) {
    parts.push('---');
    parts.push('');
    for (const { abs, rel } of detailed) {
      const section = renderFileSection(rel, coverage[abs], opts);
      if (opts.collapse) {
        parts.push(`<details>\n<summary><code>${rel}</code></summary>\n`);
        parts.push(section);
        parts.push('</details>\n');
      } else {
        parts.push(`## ${rel}`);
        parts.push('');
        parts.push(section);
      }
    }
  }

  fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  fs.writeFileSync(opts.out, parts.join('\n'));
  console.log(`Wrote ${opts.out} (${rows.length} files, ${detailed.length} with details)`);
  return { outPath: path.resolve(opts.out), fileCount: rows.length };
}

// Only run main() when this file is executed directly (`node
// coverage-md.mjs ...`), not when imported for its exports (see
// scripts/render-coverage-branch.mjs, #468).
export { main };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

