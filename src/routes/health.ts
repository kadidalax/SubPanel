import { Hono } from "hono";
import type { Env } from "../env.ts";
import { jsonError, jsonOk } from "../util/json.ts";

type AppEnv = { Bindings: Env };

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/live", (c) => jsonOk({ ok: true }));

healthRoutes.get("/ready", async (c) => {
  try {
    const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (!row || row.ok !== 1) return jsonError(503, "not_ready", "database not ready");
    const tables = await c.env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users','subscriptions','sources','groups')",
    ).all<{ name: string }>();
    const names = new Set((tables.results ?? []).map((r) => r.name));
    const required = ["users", "subscriptions", "sources", "groups"];
    const missing = required.filter((n) => !names.has(n));
    if (missing.length) {
      return jsonError(
        503,
        "schema_missing",
        "database tables missing: " + missing.join(", ") + ". Open panel and click initialize database.",
      );
    }
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(503, "not_ready", err instanceof Error ? err.message : "database error");
  }
});
