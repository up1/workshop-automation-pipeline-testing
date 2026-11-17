# Classification rules

Rules live in `scripts/rules.json`. First match wins, in this order. The rule is applied to the first `<failure>`/`<error>` type, message and body text.

| Rule | Category | Confidence | Matches | Notes |
|---|---|---|---|---|
| ENV-NET | Environment Issue | high | ECONNREFUSED, ECONNRESET, ENOTFOUND, EAI_AGAIN, ETIMEDOUT, getaddrinfo, socket hang up, net::ERR_* | Service unreachable or DNS |
| ENV-5XX-GW | Environment Issue | high | status 502/503/504, Bad Gateway, Service Unavailable | Gateway or dependency down |
| ENV-INFRA | Environment Issue | high | browserType.launch, missing executable, webServer, ENOSPC, ENOMEM, EADDRINUSE, browser closed | Runner/infra |
| ENV-500 | Environment Issue | medium | status 500, Internal Server Error | Could be a real Defect: check server log |
| DATA-DUP | Test Data Issue | high | duplicate key, UNIQUE constraint, already exists, SQLITE_CONSTRAINT, 409 | Leftover or non-unique data |
| DATA-MISSING | Test Data Issue | medium | no such user/record, record not found, no rows, seed/fixture missing | Seed not loaded |
| SCRIPT-LOCATOR | Script Issue | high | waiting for locator/getBy*, strict mode violation, element(s) not found, not visible/stable/enabled, intercepts pointer events | Selector or UI change. If the UI really lost the element, it can be a Defect: confirm manually |
| SCRIPT-CODE | Script Issue | high | TypeError, ReferenceError, SyntaxError, is not a function, Cannot read property | Bug in test code |
| SCRIPT-TIMEOUT | Script Issue | medium | Test timeout exceeded, waitFor* timeout | Wait/sync, only reached when no env signal matched |
| DEFECT-ASSERT | Defect | medium | expect(...), AssertionError, Expected/Received | Assertion mismatch with healthy script/env |
| NONE | Needs review | low | anything else | Human decides |

## Flaky
A testcase that has `<flakyFailure>`, `<flakyError>`, `<rerunFailure>` or `<rerunError>` and no final `<failure>` is Flaky. It is reported separately with the category its first failure resembled.

## Cross-checks the agent should do
- Many failures with the same connection/5xx evidence: one Environment cause. Report once.
- Many failures with the same missing-data or duplicate evidence: one Test Data cause.
- A 4xx/5xx assertion on an endpoint other tests exercise successfully points to Defect; if every endpoint fails, suspect Environment.
- Locator failure in only one test while sibling tests on the same page pass: likely a Script Issue or a UI Defect; look at the app change history if available.

## Extending
Add an entry to `scripts/rules.json` (`id`, `category`, `confidence`, `pattern`, `flags`, `reason`), placed by precedence, then add a sample case to `samples/junit-failing.xml`.
