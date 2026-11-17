# Test Failure Triage Report

Files: junit-failing.xml

Total 9 | Passed 2 | Failed 6 | Flaky 1 | Skipped 0

## Summary by category

| Category | Count | Suggested action |
|---|---|---|
| Defect | 1 | Open a bug with the evidence; assign to dev team |
| Script Issue | 2 | Fix locator/wait/test code; assign to QA automation |
| Environment Issue | 1 | Check service health/infra; re-run after fixing; assign to DevOps |
| Test Data Issue | 1 | Reset/reseed data or make data unique; assign to QA/data owner |
| Needs review | 1 | Read evidence manually and decide the category |

## Defect (1)

| Test | Project | Confidence | Rule | Evidence |
|---|---|---|---|---|
| POST /api/login › 403 — บัญชีถูกล็อก | api | medium | DEFECT-ASSERT | Error: expect(received).toBe(expected) // Object.is equality |

## Script Issue (2)

| Test | Project | Confidence | Rule | Evidence |
|---|---|---|---|---|
| Login UI › show error on wrong password | ui-real | high | SCRIPT-LOCATOR | Error: expect(locator).toBeVisible() failed |
| Login UI › logout button | ui-real | high | SCRIPT-CODE | TypeError: loginPage.logout is not a function |

## Environment Issue (1)

| Test | Project | Confidence | Rule | Evidence |
|---|---|---|---|---|
| GET /api/me › 200 with valid token | api | high | ENV-NET | Error: apiRequestContext.get: connect ECONNREFUSED 127.0.0.1:3100 |

## Test Data Issue (1)

| Test | Project | Confidence | Rule | Evidence |
|---|---|---|---|---|
| POST /api/register › 201 new user | api | high | DATA-DUP | Error: SQLITE_CONSTRAINT: UNIQUE constraint failed: users.username |

## Needs review (1)

| Test | Project | Confidence | Rule | Evidence |
|---|---|---|---|---|
| Login UI › remember me | ui-real | low | NONE | Error: something odd happened |

## Flaky (1)

Failed first, then passed on retry. Tag as flaky; do not count as Defect.

| Test | Project | First failure looked like | Evidence |
|---|---|---|---|
| Login UI › session refresh (retry) | ui-real | Script Issue | Error: page.waitForResponse: Timeout 5000ms exceeded |

