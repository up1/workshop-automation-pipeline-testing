---
name: test-failure-triage
description: Analyze JUnit XML test results and group each test failure by root cause into Defect, Script Issue, Environment Issue, or Test Data Issue (plus Flaky and Needs review). Use when the user asks to analyze test results, triage or classify failures, find out why tests failed, do root cause analysis on a junit.xml, or says things like "วิเคราะห์ผลการทดสอบ", "จัดกลุ่ม test failure", "fail เพราะอะไร", "เป็น bug หรือ script พัง".
---

# Test Failure Triage

Classify failed tests from JUnit XML into root-cause groups so the right team acts on each one. Only JUnit XML is supported.

## Categories

| Category | Meaning | Owner |
|---|---|---|
| Defect | Application behaves wrongly; script and environment are fine | Dev |
| Script Issue | Test code, locator, wait or sync is wrong | QA automation |
| Environment Issue | Service down, network, infra, runner problem | DevOps |
| Test Data Issue | Data missing, duplicate or stale | QA / data owner |
| Needs review | No rule matched; a human must decide | - |
| Flaky | Failed, then passed on retry; not a Defect | QA automation |

## Workflow

1. **Find the result files.** Use paths the user gave. Otherwise look for `junit.xml` or `*.xml` under `results/`, `test-results/`, `samples/`. If none exist, say so and stop; do not invent results.
2. **Run the classifier** (from this folder, or use the absolute path to the script):
   ```bash
   node .claude/skills/test-failure-triage/scripts/classify.mjs <junit.xml> [more.xml] --md triage-report.md --json triage-report.json
   ```
3. **Review the output.** Read `references/classification-rules.md` for rule meanings. For each failure:
   - `Needs review` (rule `NONE`): read the evidence in the XML and propose a category with your reasoning, marked as your judgment.
   - `medium`/`low` confidence (e.g. `ENV-500`, `DEFECT-ASSERT`, `SCRIPT-TIMEOUT`): check the full failure text and neighbouring failures. For example, many tests failing with the same connection error means one environment cause, not many defects.
   - Override a classification only with evidence, and say which rule you overrode and why.
4. **Report to the user** in the user's language: totals, a count per category, the failures grouped by category with evidence, flaky tests, and one recommended next action per group. Group repeated failures with a shared root cause.
5. **Do not** file bugs, change tests or restart services unless asked. The report is the deliverable.

## Rules of thumb

- Precedence: Environment > Test Data > Script > Defect. A failure is a Defect only when script, environment and data look healthy and a business assertion fails.
- Never label something Defect just because an assertion failed; check the rules first.
- A passed-on-retry test is Flaky, not Defect. Report the first failure's likely cause as a hint.
- If the XML has no failures, say "no failures" and show totals only.
- If a file cannot be parsed or has no `<testcase>`, report that rather than guessing.
