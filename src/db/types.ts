export type UserRole = "admin" | "user";

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  role: UserRole;
  enabled: number;
  expire_at: number | null;
  session_version: number;
  disabled_reason?: string | null;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: number;
  user_id: number;
  token_hash: string;
  session_version: number;
  expires_at: number;
  idle_expires_at: number;
  created_at: number;
  last_seen_at: number;
}

export interface SourceRow {
  id: number;
  name: string;
  kind: "manual" | "remote" | "passthrough";
  format_hint: string | null;
  encrypted_url: string | null;
  encrypted_headers: string | null;
  manual_content: string | null;
  passthrough_format: string | null;
  refresh_interval_minutes: number;
  next_refresh_at: number | null;
  enabled: number;
  failure_count: number;
  last_success_at: number | null;
  last_error: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
}

export interface SubscriptionRow {
  id: number;
  user_id: number;
  group_id: number;
  name: string;
  token_hash: string;
  token_prefix: string;
  enabled: number;
  expire_at: number | null;
  device_limit: number | null;
  default_format: string;
  access_policy: string;
  usage_mode: "none" | "manual" | "upstream_exclusive";
  traffic_limit_bytes: number | null;
  manual_used_bytes: number;
  exclusive_source_id: number | null;
  disabled_reason?: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
}
