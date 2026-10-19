# Challenge 1 — Lost and Found API

This solution is a backend REST API for reporting lost or found items. Anyone can search reports and view their details. Registered users can create reports, update their own reports, and mark an item as recovered.

## Run the solution

**Requirements:** Node.js 24 or newer and npm. No separate database installation is needed.

From the repository root:

```sh
cd ch01_task01
npm ci
npm start
```

The API runs at **http://localhost:3000/api/v1**. Check that it is ready:

```sh
curl http://localhost:3000/api/v1/health
# Expected: {"status":"ok"}
```

The SQLite database and tables are created automatically on the first start. Accounts, sessions, and reports remain available after a restart. For development, `npm run dev` restarts the server when source files change.

## How the solution works

The implementation uses **Express 5** for HTTP routing and **Node's built-in SQLite driver** for persistence. Express is the only application dependency. SQLite keeps the project easy to run and evaluate while providing relational constraints, transactions, and persistent storage.

A report follows this workflow:

1. The user registers an account and logs in to receive a bearer token.
2. The user sends the token with a lost or found report. The API determines the owner from the session, validates the input, and saves the report with status `open`.
3. Anyone can browse reports, combine search filters, and view individual reports.
4. Before an update or recovery, the API checks that the authenticated user owns the report.
5. Recovery changes the status to `recovered` and records the recovery time. Repeating the request preserves the original timestamps. Recovered reports remain searchable but cannot be edited or reopened.

### Code organization

| File | Responsibility |
| --- | --- |
| `src/server.js` | Validate configuration, open the database, start HTTP, and shut down gracefully. |
| `src/app.js` | Connect routes, parse JSON, apply request limits, and format errors. |
| `src/database.js` | Open SQLite, enable foreign keys, and apply the versioned migration in a transaction. |
| `src/auth.js` | Register accounts, verify passwords, issue sessions, and authenticate requests. |
| `src/items.js` | Create, search, read, update, and recover reports. |
| `src/validation.js` | Validate report fields, dates, identifiers, and allowed properties. |
| `src/errors.js`, `src/rate-limit.js` | Shared HTTP errors and account request throttling. |
| `migrations/001_initial.sql` | Database tables, constraints, and indexes. |
| `test/` | HTTP integration tests and real server restart tests. |
| `openapi.json` | Machine-readable API contract with request and response schemas. |

### Database design

| Table | Stored data | Relationship |
| --- | --- | --- |
| `users` | ID, name, unique email, password hash, creation time. | One user can own many reports and sessions. |
| `sessions` | Token hash, user ID, expiration, creation time. | Each session belongs to one user. |
| `items` | Owner ID, report fields, status, creation/update/recovery timestamps. | Each report belongs to one user. |

Foreign keys prevent orphaned records. Database constraints restrict report types and statuses. Indexes support report ordering, owner/status filtering, and session cleanup. SQL values use bound parameters; editable column names come from a fixed allowlist.

### Authentication and validation

Passwords are hashed with asynchronous **scrypt** and a random salt. Login returns a random token; only its SHA-256 hash is stored in SQLite. Tokens expire, and logout immediately revokes the current session without affecting other sessions.

Registration requires a name of 1–80 characters, a valid email of at most 254 characters, and a password of 12–128 characters. Emails are trimmed and lowercased. Password whitespace is preserved. Public reports expose an owner ID but no email, password hash, or token.

All six report fields are required on creation. Updates accept a nonempty subset:

| Field | Validation |
| --- | --- |
| `type` | `lost` or `found`. |
| `title` | 3–120 characters. |
| `description` | 10–2000 characters. |
| `category` | 1–50 characters. |
| `location` | 1–120 characters. |
| `eventDate` | A real `YYYY-MM-DD` date, no later than today in UTC. |

Text fields are trimmed. Unknown fields are rejected. Clients cannot assign ownership, IDs, status, or timestamps directly. JSON bodies are limited to 100kb. Registration and login share a limit of 20 attempts per IP address per 15 minutes.

## API endpoints

All paths below start with `/api/v1`. Send request bodies as `application/json`. Protected routes require `Authorization: Bearer <token>`.

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/health` | Check server health. | Public |
| GET | `/openapi.json` | Read the API specification. | Public |
| POST | `/auth/register` | Create an account. | Public |
| POST | `/auth/login` | Create a session. | Public |
| GET | `/auth/me` | View the current account. | Authenticated |
| POST | `/auth/logout` | Revoke the current session. | Authenticated |
| POST | `/items` | Report a lost or found item. | Authenticated |
| GET | `/items` | Search and filter reports. | Public; `mine=true` requires authentication |
| GET | `/items/:id` | View a report. | Public |
| PATCH | `/items/:id` | Update an open report. | Owner only |
| PATCH | `/items/:id/recover` | Mark a report recovered. | Owner only |

Search supports `q` across title, description, category, and location; exact `type` and `status`; substring `category` and `location`; inclusive event-date bounds `from` and `to`; and `mine=true` for the current user's reports. All supplied filters are combined with AND.

Pagination uses `page` (default `1`, maximum `1000000`) and `limit` (default `20`, maximum `100`). Results are ordered by creation time descending, then ID descending. Responses contain `items` and `pagination: {page, limit, total, totalPages}`. Blank, repeated, or unknown query parameters are rejected.

Errors have a consistent JSON format:

```json
{"error":{"code":"FORBIDDEN","message":"Only the report owner can change this item."}}
```

Validation errors can also include a `details` array identifying invalid fields. Status codes distinguish invalid input (`400`), missing/invalid authentication (`401`), another user's report (`403`), missing resources (`404`), duplicate email or editing a recovered report (`409`), oversized bodies (`413`), unsupported media types (`415`), and rate limits (`429`, with `Retry-After`). Full schemas are in [openapi.json](./openapi.json).

## Walkthrough for evaluation

Keep the server running and execute these commands in a second Bash or Zsh terminal. They use only `curl` and Node.js. Use a different email if the example account already exists.

```sh
API=http://localhost:3000/api/v1

# 1. Register an account. Expected: HTTP 201 with the public user data.
curl -sS -X POST "$API/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sam","email":"sam@example.com","password":"a-long-demo-password"}'

# 2. Log in and save the returned token.
TOKEN=$(curl -sS -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"sam@example.com","password":"a-long-demo-password"}' \
  | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token))')

# 3. Create a report and save its ID. Use type="found" for a found item.
ITEM_ID=$(curl -sS -X POST "$API/items" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"lost","title":"Blue backpack","description":"A blue backpack with a small red keyring.","category":"Bags","location":"Central library","eventDate":"2024-01-01"}' \
  | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).item.id))')

# 4. Read details and search without authentication. Expected: the open report.
curl -sS "$API/items/$ITEM_ID"
curl -sS "$API/items?q=backpack&type=lost&status=open&location=library&page=1&limit=10"

# 5. Update your report. Expected: the new location in the response.
curl -sS -X PATCH "$API/items/$ITEM_ID" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"location":"Library reading room"}'

# 6. Recover it. Expected: status="recovered" and a recovery timestamp.
curl -sS -X PATCH "$API/items/$ITEM_ID/recover" \
  -H "Authorization: Bearer $TOKEN"

# 7. An edit after recovery must fail with HTTP 409 and ITEM_RECOVERED.
curl -i -X PATCH "$API/items/$ITEM_ID" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Updated backpack"}'

# 8. Log out (HTTP 204), then check that the token is rejected (HTTP 401).
curl -i -X POST "$API/auth/logout" -H "Authorization: Bearer $TOKEN"
curl -i "$API/auth/me" -H "Authorization: Bearer $TOKEN"
```

To check persistence manually, stop and restart the server, then request the same item ID. The recovered report should still be present.

## Automated verification

From `ch01_task01`:

```sh
npm test
npm run test:coverage
```

The suite contains **40 tests** covering account validation, password hashing, session expiration/logout, lost/found reports, combined search and pagination, owner-only changes, recovery, invalid requests, rate limits, and persistence. Tests use isolated databases and do not modify the application's saved data.

The server test starts the actual entrypoint, creates and recovers a report, shuts down gracefully, restarts, and verifies that both the saved report and session still work. The GitHub Actions workflow in [lost-and-found-api.yml](../.github/workflows/lost-and-found-api.yml) runs the suite with coverage.

## Configuration and scope

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port, between `1` and `65535`. |
| `DATABASE_PATH` | `ch01_task01/data/lost-and-found.sqlite` | Default path is resolved from the task directory. A custom relative path is resolved from the working directory. `:memory:` enables disposable storage. |
| `SESSION_TTL_SECONDS` | `604800` (7 days) | Session lifetime, between `60` and `2592000` seconds. |

This submission implements the backend only. The rate limiter is process-local and resets on restart. SQLite substring matching ignores ASCII letter case but does not perform Unicode case folding. Runtime database files and installed dependencies are excluded from Git.
