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
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(503, "not_ready", err instanceof Error ? err.message : "database error");
  }
});
