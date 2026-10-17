# Lost and found API

Backend challenge: report lost or found items, search reports, view details, update your own reports, and mark items as recovered. No frontend is planned.

## Current milestone: API foundation

Implemented with Node.js 24 and Express 5. Includes a health endpoint, JSON error responses, request size limits, HTTP tests, and GitHub Actions. Item reporting and authentication are planned; they are not implemented yet.

## Run locally

```sh
cd ch01_task01
npm ci
npm start
```

The default port is 3000. Override it with `PORT=4000 npm start`. Use `npm run dev` for automatic restarts and `npm test` to run the tests.

```sh
curl http://localhost:3000/api/v1/health
```

Expected response: `{"status":"ok"}` (HTTP 200).

Unknown routes return HTTP 404 with `{"error":{"code":"NOT_FOUND","message":"Route not found"}}`. Malformed JSON returns 400; JSON bodies larger than 100kb return 413.

## Next milestones

Complete each milestone in its own branch and pull request, with tests and a short explanation of the behavior added. Check off work only when implemented and verified.

- [x] 1. Foundation: runnable server, health check, error handling, tests, CI.
- [ ] 2. Persistence and accounts: SQLite schema and migrations, registration, password hashing, login, authenticated user identification.
- [ ] 3. Reports: authenticated creation of lost/found reports and public report details, with input validation and persistence tests.
- [ ] 4. Search: text search, type/category/location/status filters, pagination, and combined-filter tests.
- [ ] 5. Ownership: owners can update their reports and mark them recovered; reject unauthenticated and non-owner changes.
- [ ] 6. Delivery: OpenAPI documentation, example requests, end-to-end tests, and final setup review.

Next session starts with milestone 2. Decide the account/session schema before adding report routes.

## Proposed API contract

These routes are a design plan; only the health route currently exists.

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | Health check (implemented) | Public |
| POST | `/api/v1/auth/register` | Create account | Public |
| POST | `/api/v1/auth/login` | Authenticate | Public |
| POST | `/api/v1/items` | Report lost/found item | Authenticated |
| GET | `/api/v1/items` | Search/filter reports | Public |
| GET | `/api/v1/items/:id` | View report details | Public |
| PATCH | `/api/v1/items/:id` | Update report | Owner |
| PATCH | `/api/v1/items/:id/recover` | Mark recovered | Owner |

Planned report fields: id, ownerId, type (`lost`/`found`), title, description, category, location, eventDate, status (`open`/`recovered`), createdAt, updatedAt. Owner identity must come from authentication, never a request body. Public responses must exclude passwords and private account details.

## GitHub workflow

Use descriptive branches such as `feat/accounts` and focused commits describing completed work. Pull requests should explain the change and how it was tested. Keep actual development dates and meaningful commits so the history reflects the work performed.
