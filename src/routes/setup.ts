import { Hono } from "hono";
import type { Env } from "../env.ts";
import { applySchema, getSchemaStatus } from "../db/schema.ts";
import { jsonError, jsonOk } from "../util/json.ts";
import { sameOrigin } from "../util/request.ts";

type AppEnv = { Bindings: Env };

export const setupRoutes = new Hono<AppEnv>();

setupRoutes.get("/status", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1 AS ok").first();
    const status = await getSchemaStatus(c.env.DB);
    return jsonOk({
      db: true,
      ready: status.ready,
      missing: status.missing,
      tableCount: status.existing.length,
    });
  } catch (err) {
    return jsonError(503, "not_ready", err instanceof Error ? err.message : "database error");
  }
});

/** One-click schema init for a fresh D1. Idempotent, no DROP. */
setupRoutes.post("/init-db", async (c) => {
  const request = c.req.raw;
  const url = new URL(request.url);
  if (!sameOrigin(request, url)) return jsonError(403, "csrf", "invalid origin");

  try {
    await c.env.DB.prepare("SELECT 1 AS ok").first();
  } catch (err) {
    return jsonError(503, "not_ready", err instanceof Error ? err.message : "database not bound");
  }

  const before = await getSchemaStatus(c.env.DB);
  if (before.ready) {
    return jsonOk({ ready: true, applied: false, missing: [], tableCount: before.existing.length });
  }

  try {
    const after = await applySchema(c.env.DB);
    if (!after.ready) {
      return jsonError(
        500,
        "schema_incomplete",
        "schema still missing: " + after.missing.join(", "),
      );
    }
    return jsonOk({
      ready: true,
      applied: true,
      missing: [],
      tableCount: after.existing.length,
      created: before.missing,
    });
  } catch (err) {
    return jsonError(500, "schema_apply_failed", err instanceof Error ? err.message : "apply failed");
  }
});
