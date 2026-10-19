CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('lost', 'found')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  event_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'recovered')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  recovered_at TEXT
) STRICT;

CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX items_owner_created_idx ON items(owner_id, created_at DESC, id DESC);
CREATE INDEX items_created_idx ON items(created_at DESC, id DESC);
CREATE INDEX items_type_status_created_idx ON items(type, status, created_at DESC, id DESC);
CREATE INDEX items_status_created_idx ON items(status, created_at DESC, id DESC);
