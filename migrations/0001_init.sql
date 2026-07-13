CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE,
  email TEXT COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  enabled INTEGER NOT NULL DEFAULT 1,
  expire_at INTEGER,
  session_version INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  session_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_password_reset_user_id ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'remote', 'passthrough')),
  format_hint TEXT,
  encrypted_url TEXT,
  encrypted_headers TEXT,
  manual_content TEXT,
  passthrough_format TEXT,
  refresh_interval_minutes INTEGER NOT NULL DEFAULT 60,
  next_refresh_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER,
  last_error TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_next_refresh ON sources(enabled, next_refresh_at);

CREATE TABLE IF NOT EXISTS source_nodes (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  protocol TEXT NOT NULL,
  name TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  capability_flags TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  stale INTEGER NOT NULL DEFAULT 0,
  source_order INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_nodes_key ON source_nodes(source_id, node_key);

CREATE INDEX IF NOT EXISTS idx_source_nodes_active ON source_nodes(source_id, enabled, stale);

CREATE INDEX IF NOT EXISTS idx_source_nodes_order ON source_nodes(source_id, source_order, id);

CREATE TABLE IF NOT EXISTS source_usage_snapshots (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  upload_bytes INTEGER,
  download_bytes INTEGER,
  total_bytes INTEGER,
  expire_at INTEGER,
  captured_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_usage_source_captured ON source_usage_snapshots(source_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_nodes (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES source_nodes(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_group_nodes_node ON group_nodes(node_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  encrypted_token TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  expire_at INTEGER,
  device_limit INTEGER,
  default_format TEXT NOT NULL DEFAULT 'auto'
    CHECK (default_format IN ('auto', 'mihomo', 'singbox', 'uri', 'surge')),
  access_policy TEXT NOT NULL DEFAULT 'allow',
  usage_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (usage_mode IN ('none', 'manual', 'upstream_exclusive')),
  traffic_limit_bytes INTEGER,
  manual_used_bytes INTEGER NOT NULL DEFAULT 0,
  exclusive_source_id INTEGER REFERENCES sources(id),
  revision INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_token_hash ON subscriptions(token_hash);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_group_id ON subscriptions(group_id);

CREATE TABLE IF NOT EXISTS subscription_groups (
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subscription_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_subscription_groups_group ON subscription_groups(group_id);

CREATE TABLE IF NOT EXISTS subscription_devices (
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  client_family TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (subscription_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_subscription_devices_last_seen ON subscription_devices(subscription_id, last_seen_at);

CREATE TABLE IF NOT EXISTS subscription_access_logs (
  id INTEGER PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  device_fingerprint TEXT,
  client_family TEXT,
  format TEXT,
  response_bytes INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscription_access_logs_created ON subscription_access_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_subscription_access_logs_sub ON subscription_access_logs(subscription_id, created_at);

CREATE TABLE IF NOT EXISTS subscription_access_daily (
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  response_bytes INTEGER NOT NULL DEFAULT 0,
  unique_devices INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subscription_id, day)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  request_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  event_key TEXT NOT NULL,
  user_id INTEGER,
  subscription_id INTEGER,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  sent_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_key ON notifications(event_key);

CREATE INDEX IF NOT EXISTS idx_notifications_status_next ON notifications(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY,
  job_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_runs_job_key ON job_runs(job_key);

CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_rate_limits (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER
);
