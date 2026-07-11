-- v1.3: allow operator role (SQLite CHECK rebuild)
PRAGMA foreign_keys=OFF;

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user', 'operator')),
  enabled INTEGER NOT NULL DEFAULT 1,
  expire_at INTEGER,
  session_version INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO users_new (
  id, username, email, password_hash, role, enabled, expire_at, session_version, disabled_reason, created_at, updated_at
)
SELECT
  id, username, email, password_hash, role, enabled, expire_at, session_version, disabled_reason, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

PRAGMA foreign_keys=ON;
