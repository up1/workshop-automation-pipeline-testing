#!/usr/bin/env node
// Classify test failures from JUnit XML into:
//   Defect | Script Issue | Environment Issue | Test Data Issue | Needs review
// Usage: node classify.mjs <junit.xml> [more.xml ...] [--json out.json] [--md out.md]
// No dependencies (Node >= 18).

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- rules ----------
// Rules live in rules.json (first match wins; order = precedence).
// Environment > Test Data > Script > Defect. See references/classification-rules.md
const rulesPath = fileURLToPath(new URL("./rules.json", import.meta.url));
const RULES = JSON.parse(readFileSync(rulesPath, "utf8")).rules.map((r) => ({
  id: r.id, cat: r.category, conf: r.confidence, why: r.reason, re: new RegExp(r.pattern, r.flags),
}));

const CATEGORIES = ['Defect', 'Script Issue', 'Environment Issue', 'Test Data Issue', 'Needs review'];
const ACTION = {
  'Defect': 'Open a bug with the evidence; assign to dev team',
  'Script Issue': 'Fix locator/wait/test code; assign to QA automation',
  'Environment Issue': 'Check service health/infra; re-run after fixing; assign to DevOps',
  'Test Data Issue': 'Reset/reseed data or make data unique; assign to QA/data owner',
  'Needs review': 'Read evidence manually and decide the category',
};

// ---------- tiny JUnit parser ----------
const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&amp;/g, '&');

function attrs(str) {
  const out = {};
  for (const m of str.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = decode(m[3] ?? m[4]);
  return out;
}

function parseJUnit(xml, file) {
  const cases = [];
  // suites give project name via hostname (Playwright) or name
  const suiteRe = /<testsuite\b([^>]*?)(\/>|>([\s\S]*?)<\/testsuite>)/g;
  let sm;
  while ((sm = suiteRe.exec(xml))) {
    const sa = attrs(sm[1]);
    const body = sm[3] ?? '';
    const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
    let cm;
    while ((cm = caseRe.exec(body))) {
      const ca = attrs(cm[1]);
      const inner = cm[3] ?? '';
      const tag = (name) => {
        const r = new RegExp(`<${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${name}>)`, 'g');
        return [...inner.matchAll(r)].map((m) => ({ ...attrs(m[1]), text: decode(m[2] ?? '').trim() }));
      };
      const fails = [...tag('failure'), ...tag('error')];
      const flaky = [...tag('flakyFailure'), ...tag('flakyError'), ...tag('rerunFailure'), ...tag('rerunError')];
      const skipped = /<skipped\b/.test(inner);
      cases.push({
        file: basename(file),
        suite: sa.name ?? '',
        project: sa.hostname ?? '',
        classname: ca.classname ?? '',
        name: ca.name ?? '',
        time: ca.time ?? '',
        status: fails.length ? 'failed' : skipped ? 'skipped' : flaky.length ? 'flaky' : 'passed',
        failures: fails.length ? fails : flaky,
        stdout: tag('system-out').map((x) => x.text).join('\n'),
      });
    }
  }
  return cases;
}

// ---------- classify ----------
function classify(c) {
  const f = c.failures[0] ?? {};
  const evidence = [f.type, f.message, f.text].filter(Boolean).join('\n');
  for (const r of RULES) {
    if (r.re.test(evidence)) return { category: r.cat, confidence: r.conf, rule: r.id, reason: r.why, evidence };
  }
  return { category: 'Needs review', confidence: 'low', rule: 'NONE', reason: 'No rule matched', evidence };
}

function firstLine(s, n = 160) {
  const line = (s || '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > n ? line.slice(0, n - 1) + '…' : line;
}
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

// ---------- main ----------
const args = process.argv.slice(2);
const files = [];
let jsonOut, mdOut;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') jsonOut = args[++i];
  else if (args[i] === '--md') mdOut = args[++i];
  else files.push(args[i]);
}
if (!files.length) {
  console.error('Usage: node classify.mjs <junit.xml> [...] [--json out.json] [--md out.md]');
  process.exit(2);
}

const all = files.flatMap((f) => parseJUnit(readFileSync(f, 'utf8'), f));
const total = all.length;
const count = (s) => all.filter((c) => c.status === s).length;
const failed = all.filter((c) => c.status === 'failed').map((c) => ({ ...c, ...classify(c) }));
const flaky = all.filter((c) => c.status === 'flaky').map((c) => ({ ...c, ...classify(c) }));

const byCat = Object.fromEntries(CATEGORIES.map((k) => [k, failed.filter((c) => c.category === k)]));

const md = [];
md.push('# Test Failure Triage Report', '');
md.push(`Files: ${files.map((f) => basename(f)).join(', ')}`, '');
md.push(`Total ${total} | Passed ${count('passed')} | Failed ${failed.length} | Flaky ${flaky.length} | Skipped ${count('skipped')}`, '');
if (!failed.length && !flaky.length) {
  md.push('No failures found.');
} else {
  md.push('## Summary by category', '', '| Category | Count | Suggested action |', '|---|---|---|');
  for (const k of CATEGORIES) if (byCat[k].length) md.push(`| ${k} | ${byCat[k].length} | ${ACTION[k]} |`);
  md.push('');
  for (const k of CATEGORIES) {
    if (!byCat[k].length) continue;
    md.push(`## ${k} (${byCat[k].length})`, '', '| Test | Project | Confidence | Rule | Evidence |', '|---|---|---|---|---|');
    for (const c of byCat[k]) {
      md.push(`| ${esc(c.name)} | ${esc(c.project || '-')} | ${c.confidence} | ${c.rule} | ${esc(firstLine(c.failures[0]?.text || c.failures[0]?.message))} |`);
    }
    md.push('');
  }
  if (flaky.length) {
    md.push(`## Flaky (${flaky.length})`, '', 'Failed first, then passed on retry. Tag as flaky; do not count as Defect.', '',
      '| Test | Project | First failure looked like | Evidence |', '|---|---|---|---|');
    for (const c of flaky) md.push(`| ${esc(c.name)} | ${esc(c.project || '-')} | ${c.category} | ${esc(firstLine(c.failures[0]?.text || c.failures[0]?.message))} |`);
    md.push('');
  }
}
const report = md.join('\n');

if (mdOut) writeFileSync(mdOut, report + '\n');
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    totals: { total, passed: count('passed'), failed: failed.length, flaky: flaky.length, skipped: count('skipped') },
    byCategory: Object.fromEntries(CATEGORIES.map((k) => [k, byCat[k].length])),
    failures: failed.map(({ stdout, ...c }) => c),
    flaky: flaky.map(({ stdout, ...c }) => c),
  }, null, 2) + '\n');
}
console.log(report);
