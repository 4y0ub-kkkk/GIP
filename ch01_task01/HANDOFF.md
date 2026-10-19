# Task one handoff

The user requested completion of the lost and found API. Task one lives in `ch01_task01`; no frontend is required. Task two (`ch01_task02`) is a separate calculator challenge and must remain untouched.

## Delivery scope

- Node.js 24+, Express 5, and a persistent SQLite database using the built-in driver.
- Registration, asynchronous scrypt password hashing, expiring bearer sessions, account lookup, and logout.
- Authenticated lost/found reports, public details, combined search/filtering, and pagination.
- Owner-only report updates and idempotent recovery. Recovered reports cannot be edited or reopened.
- Strict input validation, consistent JSON errors, request limits, and authentication rate limiting.
- OpenAPI 3.1 specification, a runnable curl walkthrough, editor HTTP requests, HTTP tests, and GitHub Actions.

Read `README.md` for setup, endpoints, constraints, and the example workflow. `openapi.json` is also served at `GET /api/v1/openapi.json`.

## Verification completed — 2026-10-19

- `npm test -- --experimental-test-coverage`: 40 tests passed, zero failures.
- Coverage: 97.81% lines, 94.32% branches, 96.30% functions.
- Verified registration, login, private account lookup, session expiration and logout; lost/found creation, search, details, ownership, updates, and idempotent recovery.
- Verified the real server entrypoint with a temporary database, a custom session lifetime, graceful shutdown, restart persistence, and invalid configuration rejection.
- Verified shared authentication rate limits, JSON errors, request size and media-type limits, and the served OpenAPI document's internal references.
- `git diff --check`: passed.

## Delivery status

All changes remain unstaged and uncommitted. The user will perform the commit and push. Only task one and its GitHub Actions workflow were changed; task two was left untouched. CI is configured but has not been run remotely.

Run instructions and examples are in `README.md`. Runtime SQLite files are excluded from Git. The authentication limiter is process-local, and SQLite substring searches fold ASCII letter case only.
