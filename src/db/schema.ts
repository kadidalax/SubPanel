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
  try {
    const cols = await db.prepare("PRAGMA table_info(subscriptions)").all<{ name: string }>();
    const names = new Set((cols.results ?? []).map((c) => c.name));
    if (!names.has("encrypted_token")) {
      await db.exec("ALTER TABLE subscriptions ADD COLUMN encrypted_token TEXT;");
    }
  } catch {
    // table may not exist yet
  }
}

async function ensureSubscriptionGroups(db: D1Database): Promise<void> {
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS subscription_groups (
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subscription_id, group_id)
);`);
    await db.exec("CREATE INDEX IF NOT EXISTS idx_subscription_groups_group ON subscription_groups(group_id);");
    // backfill legacy single group
    await db.exec(`INSERT OR IGNORE INTO subscription_groups (subscription_id, group_id, sort_order)
SELECT id, group_id, 0 FROM subscriptions WHERE group_id IS NOT NULL;`);
  } catch {
    // ignore if base tables missing
  }
}

/** Safe: only CREATE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / additive columns. Never drops data. */
export async function applySchema(db: D1Database): Promise<SchemaStatus> {
  const before = await getSchemaStatus(db);
  if (!before.ready) {
    await db.exec(SCHEMA_SQL);
  }
  await ensureSubscriptionTokenColumn(db);
  await ensureSubscriptionGroups(db);
  return getSchemaStatus(db);
}

/** Best-effort additive patches for already-ready DBs. */
export async function ensureSchemaPatches(db: D1Database): Promise<void> {
  await ensureSubscriptionTokenColumn(db);
  await ensureSubscriptionGroups(db);
}
