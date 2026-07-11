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

/** Safe: only CREATE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS. Never drops data. */
export async function applySchema(db: D1Database): Promise<SchemaStatus> {
  const before = await getSchemaStatus(db);
  if (before.ready) return before;
  // D1 exec runs multi-statement SQL (semicolon-separated).
  await db.exec(SCHEMA_SQL);
  return getSchemaStatus(db);
}
