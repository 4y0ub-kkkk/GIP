# Lost and found API

A REST API for reporting lost and found items, searching reports, and keeping your own reports up to date. Built with Node.js 24+, Express 5, and Node's built-in SQLite driver. No frontend or external database service is required.

## Run locally

```sh
cd ch01_task01
npm ci
npm start
```

The API listens on `http://localhost:3000`. Use `npm run dev` for automatic restarts.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `DATABASE_PATH` | `ch01_task01/data/lost-and-found.sqlite` | SQLite file; the default is resolved from this task's directory. Use an absolute path for a custom location. |
| `SESSION_TTL_SECONDS` | `604800` (7 days) | Session lifetime; an integer from `60` to `2592000`. |

The server creates its database and schema on startup. Reports, accounts, and sessions survive a restart. The database is excluded from Git. For a disposable database, set `DATABASE_PATH=:memory:`; its contents disappear when the process exits.

```sh
curl http://localhost:3000/api/v1/health
# {"status":"ok"}
```

## Endpoints

All paths below start with `/api/v1`. Send JSON bodies with `Content-Type: application/json`. Protected endpoints require `Authorization: Bearer <token>`.

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/health` | Health check | Public |
| GET | `/openapi.json` | OpenAPI 3.1 specification | Public |
| POST | `/auth/register` | Create an account | Public |
| POST | `/auth/login` | Create a session | Public |
| GET | `/auth/me` | Get your account | Authenticated |
| POST | `/auth/logout` | Revoke the current session | Authenticated |
| POST | `/items` | Report a lost or found item | Authenticated |
| GET | `/items` | Search and filter reports | Public; `mine=true` requires authentication |
| GET | `/items/:id` | View a report | Public |
| PATCH | `/items/:id` | Update report fields | Owner |
| PATCH | `/items/:id/recover` | Mark a report recovered | Owner |

The complete schemas are in [openapi.json](./openapi.json). [examples/requests.http](./examples/requests.http) provides requests for editors with an HTTP client extension.

## Try the full workflow

Keep the server running and open a second terminal. These examples use `curl` and Node.js; no `jq` dependency is needed.

```sh
API=http://localhost:3000/api/v1

# Register once. Use a different email if this account already exists.
curl -sS -X POST "$API/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sam","email":"sam@example.com","password":"a-long-demo-password"}'

# Log in and capture your session token.
TOKEN=$(curl -sS -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"sam@example.com","password":"a-long-demo-password"}' \
  | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token))')

curl -sS "$API/auth/me" -H "Authorization: Bearer $TOKEN"

# Report a lost item and capture its ID.
ITEM_ID=$(curl -sS -X POST "$API/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"lost","title":"Blue backpack","description":"A blue backpack with a small red keyring.","category":"Bags","location":"Central library","eventDate":"2026-01-01"}' \
  | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).item.id))')

# Found reports use the same endpoint with type=found.
curl -sS -X POST "$API/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"found","title":"Silver keys","description":"Two silver keys on a plain black keyring.","category":"Keys","location":"Main entrance","eventDate":"2026-01-01"}'

# Public details and combined search filters.
curl -sS "$API/items/$ITEM_ID"
curl -sS --get "$API/items" \
  --data-urlencode 'q=backpack' \
  --data-urlencode 'type=lost' \
  --data-urlencode 'status=open' \
  --data-urlencode 'location=library' \
  --data-urlencode 'from=2026-01-01' \
  --data-urlencode 'to=2026-01-01' \
  --data-urlencode 'page=1' \
  --data-urlencode 'limit=10'

curl -sS "$API/items?mine=true" -H "Authorization: Bearer $TOKEN"

# Owners can edit open reports.
curl -sS -X PATCH "$API/items/$ITEM_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"location":"Central library, reading room"}'

# Recovery is idempotent: repeating it preserves the recovery timestamp.
curl -sS -X PATCH "$API/items/$ITEM_ID/recover" \
  -H "Authorization: Bearer $TOKEN"

# Logout returns HTTP 204 and immediately revokes this token.
curl -i -X POST "$API/auth/logout" -H "Authorization: Bearer $TOKEN"
```

## Validation and search

Registration requires a trimmed name of 1–80 characters, an email of at most 254 characters, and a password of 12–128 characters. Emails are normalized for account lookup; passwords are not trimmed. Login uses the same email and password limits.

Reports require all six fields on creation. Updates accept any nonempty subset of those fields. Unknown fields are rejected; ownership, status, and timestamps cannot be assigned through a report body.

| Report field | Rule |
| --- | --- |
| `type` | `lost` or `found` |
| `title` | 3–120 characters |
| `description` | 10–2000 characters |
| `category` | 1–50 characters |
| `location` | 1–120 characters |
| `eventDate` | A real `YYYY-MM-DD` date, at most today's UTC date |

Report text is trimmed. Reports start with `status: "open"` and `recoveredAt: null`. Recovery sets `status: "recovered"` and the recovery timestamp. Recovered reports remain publicly visible and cannot be edited or reopened.

`GET /items` combines all supplied filters:

| Query parameter | Behavior |
| --- | --- |
| `q` | Case-insensitive literal substring search across title, description, category, and location; 1–200 characters. |
| `type`, `status` | Exact `lost`/`found` and `open`/`recovered` values. |
| `category`, `location` | Case-insensitive substring filters; at most 50 and 120 characters, respectively. |
| `from`, `to` | Inclusive event-date bounds. Both are optional; dates cannot be in the future and `from` cannot exceed `to`. |
| `mine` | `true` restricts results to your reports; requires a valid session. `false` is the default. |
| `page` | Positive integer, default `1`, maximum `1000000`. |
| `limit` | Page size, default `20`, maximum `100`. |

Text matching is case-insensitive for ASCII letters; non-ASCII case folding is not supported by the built-in SQLite LIKE operator. Blank, unknown, and repeated query parameters are rejected. Results are ordered by creation time, newest first, with the ID as a deterministic tie-breaker. The response includes `items` and `pagination: {page, limit, total, totalPages}`.

## Errors and security

Errors use one shape: `{"error":{"code":"VALIDATION_ERROR","message":"…","details":[{"field":"title","message":"…"}]}}`. The `details` array is optional.

| HTTP status | Codes |
| --- | --- |
| `400` | `VALIDATION_ERROR`, `INVALID_JSON` |
| `401` | `UNAUTHORIZED`, `INVALID_CREDENTIALS` |
| `403` | `FORBIDDEN` |
| `404` | `ITEM_NOT_FOUND`, `NOT_FOUND` |
| `409` | `EMAIL_IN_USE`, `ITEM_RECOVERED` |
| `413` | `BODY_TOO_LARGE` (JSON body exceeds 100kb) |
| `415` | `UNSUPPORTED_MEDIA_TYPE` |
| `429` | `TOO_MANY_REQUESTS` |
| `500` | `INTERNAL_ERROR` |

Passwords are hashed with asynchronous scrypt and a random salt. Session tokens are random opaque values; only their hashes are stored. Sessions expire and can be revoked by logging out. Public reports expose an owner ID but no account email, password hash, or session information. Only an owner may update or recover their reports.

Registration and login share a limit of 20 attempts per IP address per 15 minutes, including unsuccessful attempts. A rejected request includes `Retry-After` in seconds. This limiter lives in memory in a single process and resets on restart. Use HTTPS when publishing the API; this challenge runs locally and includes no deployment configuration.

## Verification and GitHub

```sh
npm test
npm run test:coverage
```

The 40 tests exercise the API over HTTP, including persistence, validation, search, authentication, ownership, recovery, and rate limits. They use isolated in-memory or temporary databases. A process-level test starts the real server, completes a report workflow, restarts it, and verifies saved data and sessions. GitHub Actions runs the suite with coverage for task-one changes.

Keep commits focused on completed behavior and describe the checks in each pull request. Use actual development dates and review the diff before pushing. Task two is a separate challenge and is not part of this API.
