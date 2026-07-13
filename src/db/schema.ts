import type { D1Database } from "@cloudflare/workers-types";
import initSql from "../../migrations/0001_init.sql";
import { splitSqlStatements } from "./sql.ts";

const SCHEMA_REQUIRED_TABLES = [
  "users", "sessions", "password_reset_tokens", "sources", "source_nodes",
  "source_usage_snapshots", "groups", "group_nodes", "subscriptions",
  "subscription_groups", "subscription_devices", "subscription_access_logs",
  "subscription_access_daily", "audit_logs", "notifications", "job_runs",
  "settings", "login_rate_limits",
] as const;

const BOOTSTRAP_STATEMENTS = splitSqlStatements(initSql);

export type SchemaStatus = {
  ready: boolean;
  missing: string[];
  existing: string[];
};

export async function getSchemaStatus(db: D1Database): Promise<SchemaStatus> {
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    )
    .all<{ name: string }>();
  const existing = (tables.results ?? []).map((r) => r.name).sort();
  const have = new Set(existing);
  const missing = SCHEMA_REQUIRED_TABLES.filter((n) => !have.has(n));
  return { ready: missing.length === 0, missing: [...missing], existing };
}

/**
 * Initialize a fresh D1 from the single schema migration.
 */
export async function applySchema(db: D1Database): Promise<SchemaStatus> {
  const before = await getSchemaStatus(db);
  if (!before.ready) {
    await db.batch(BOOTSTRAP_STATEMENTS.map((sql) => db.prepare(sql)));
  }
  return getSchemaStatus(db);
}
