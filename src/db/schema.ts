import type { D1Database } from "@cloudflare/workers-types";
import { SCHEMA_REQUIRED_TABLES, SCHEMA_SQL } from "./schema_sql.ts";

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

async function ensureSubscriptionTokenColumn(db: D1Database): Promise<void> {
  const hasSubs = await db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions' LIMIT 1")
    .first<{ ok: number }>();
  if (!hasSubs) return;
  const cols = await db.prepare("PRAGMA table_info(subscriptions)").all<{ name: string }>();
  const names = new Set((cols.results ?? []).map((c) => c.name));
  if (!names.has("encrypted_token")) {
    await db.prepare("ALTER TABLE subscriptions ADD COLUMN encrypted_token TEXT").run();
  }
}

async function ensureSubscriptionGroups(db: D1Database): Promise<void> {
  const hasSubs = await db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions' LIMIT 1")
    .first<{ ok: number }>();
  if (!hasSubs) return;
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS subscription_groups (subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE, group_id INTEGER NOT NULL REFERENCES groups(id), sort_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (subscription_id, group_id))",
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_subscription_groups_group ON subscription_groups(group_id)").run();
  await db
    .prepare(
      "INSERT OR IGNORE INTO subscription_groups (subscription_id, group_id, sort_order) SELECT id, group_id, 0 FROM subscriptions WHERE group_id IS NOT NULL",
    )
    .run();
}

/** Safe additive patches for existing DBs. */
export async function ensureSchemaPatches(db: D1Database): Promise<void> {
  await ensureSubscriptionTokenColumn(db);
  await ensureSubscriptionGroups(db);
}

/**
 * Empty DB: full schema.sql.
 * Existing DB: only additive patches (never DROP, never re-run full schema unless users table missing).
 */
export async function applySchema(db: D1Database): Promise<SchemaStatus> {
  const before = await getSchemaStatus(db);
  const needsBootstrap = before.missing.includes("users") || before.existing.length === 0;
  if (needsBootstrap) {
    await db.exec(SCHEMA_SQL);
  }
  await ensureSchemaPatches(db);
  return getSchemaStatus(db);
}
