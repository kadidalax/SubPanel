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

/** Safe: only CREATE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / additive columns. Never drops data. */
export async function applySchema(db: D1Database): Promise<SchemaStatus> {
  const before = await getSchemaStatus(db);
  if (!before.ready) {
    await db.exec(SCHEMA_SQL);
  }
  await ensureSubscriptionTokenColumn(db);
  return getSchemaStatus(db);
}

/** Best-effort additive patches for already-ready DBs. */
export async function ensureSchemaPatches(db: D1Database): Promise<void> {
  await ensureSubscriptionTokenColumn(db);
}
