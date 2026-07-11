import { Hono } from "hono";
import type { Env } from "../env.ts";
import { requireUser, publicUser } from "../auth/session.ts";
import { jsonError, jsonOk } from "../util/json.ts";
import { sameOrigin, getClientIp, getRequestId } from "../util/request.ts";
import { writeAudit } from "../db/audit.ts";
import { hashPassword, verifyPassword } from "../crypto/password.ts";
import { readVars } from "../env.ts";
import { nowMs } from "../util/time.ts";
import { getSubscriptionRow, rotateSubscriptionToken } from "../services/subscriptions.ts";
import { buildSubscriptionHealth } from "../services/health.ts";

type AppEnv = { Bindings: Env };
export const userRoutes = new Hono<AppEnv>();

userRoutes.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !sameOrigin(c.req.raw, new URL(c.req.url))) {
    return jsonError(403, "csrf", "invalid origin");
  }
  await next();
});

async function requireLogin(c: any) {
  const auth = await requireUser(c.env, c.req.raw);
  if (!auth) return { error: jsonError(401, "unauthorized", "login required") };
  return { auth };
}

userRoutes.get("/me", async (c) => {
  const gate = await requireLogin(c);
  if ("error" in gate) return gate.error;
  return jsonOk({ user: publicUser(gate.auth.user) });
});

userRoutes.get("/subscriptions", async (c) => {
  const gate = await requireLogin(c);
  if ("error" in gate) return gate.error;
  const res = await c.env.DB.prepare(
    `SELECT id, name, token_prefix, enabled, expire_at, device_limit, default_format, usage_mode,
            traffic_limit_bytes, manual_used_bytes, disabled_reason, group_id, created_at
     FROM subscriptions WHERE user_id = ? ORDER BY id DESC`,
  )
    .bind(gate.auth.user.id)
    .all<any>();
  const rows = res.results ?? [];
  const subscriptions = [];
  for (const row of rows) {
    const health = await buildSubscriptionHealth(c.env, row);
    subscriptions.push({
      id: row.id,
      name: row.name,
      tokenPrefix: row.token_prefix,
      enabled: row.enabled === 1,
      expireAt: row.expire_at,
      deviceLimit: row.device_limit,
      defaultFormat: row.default_format,
      usageMode: row.usage_mode,
      trafficLimitBytes: row.traffic_limit_bytes,
      manualUsedBytes: row.manual_used_bytes,
      disabledReason: row.disabled_reason,
      createdAt: row.created_at,
      health: {
        status: health.status,
        nodeActive: health.nodeActive,
        devices: health.devices,
        usage: health.usage,
        expireAt: health.expireAt,
        daysToExpire: health.daysToExpire,
        warnings: health.warnings,
      },
    });
  }
  return jsonOk({ subscriptions });
});

userRoutes.post("/subscriptions/:id/rotate", async (c) => {
  const gate = await requireLogin(c);
  if ("error" in gate) return gate.error;
  try {
    const rotated = await rotateSubscriptionToken(c.env, Number(c.req.param("id")), gate.auth.user.id);
    await writeAudit(c.env.DB, {
      actorUserId: gate.auth.user.id,
      action: "subscription.rotate.self",
      targetType: "subscription",
      targetId: c.req.param("id"),
      after: { tokenPrefix: rotated.tokenPrefix },
      ip: getClientIp(c.req.raw),
      requestId: getRequestId(c.req.raw),
      now: nowMs(),
    });
    return jsonOk({ token: rotated.token, tokenPrefix: rotated.tokenPrefix, warning: "token shown once" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    return jsonError(message === "forbidden" ? 403 : 400, "subscription_error", message);
  }
});

userRoutes.put("/password", async (c) => {
  const gate = await requireLogin(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  const current = String(body?.currentPassword || "");
  const next = String(body?.newPassword || "");
  if (next.length < 10) return jsonError(400, "invalid_request", "password too short");
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
    .bind(gate.auth.user.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return jsonError(400, "invalid_password", "current password incorrect");
  }
  const vars = readVars(c.env);
  const now = nowMs();
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?",
  )
    .bind(await hashPassword(next, vars.passwordIterations), now, gate.auth.user.id)
    .run();
  return jsonOk({ ok: true });
});
