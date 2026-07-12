import { Hono } from "hono";
import type { Env } from "../env.ts";
import { requireUser, publicUser } from "../auth/session.ts";
import { jsonError, jsonOk } from "../util/json.ts";
import { sameOrigin, getClientIp, getRequestId } from "../util/request.ts";
import { writeAudit } from "../db/audit.ts";
import { hashPassword, verifyPassword } from "../crypto/password.ts";
import { assertPassword } from "../util/password_policy.ts";
import { readVars } from "../env.ts";
import { nowMs } from "../util/time.ts";
import { getSubscriptionRow, listGroupsForSubscriptionIds, listSubscriptionGroups, loadSubscriptionNodeMeta, revealSubscriptionToken, rotateSubscriptionToken } from "../services/subscriptions.ts";
import { buildSubscriptionHealthLiteBatch } from "../services/health.ts";

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
            traffic_limit_bytes, manual_used_bytes, exclusive_source_id, disabled_reason, group_id, created_at
     FROM subscriptions WHERE user_id = ? ORDER BY id DESC`,
  )
    .bind(gate.auth.user.id)
    .all<any>();
  const rows = res.results ?? [];
  const groupMap = await listGroupsForSubscriptionIds(
    c.env,
    rows.map((r) => Number(r.id)),
  );
  const healthMap = await buildSubscriptionHealthLiteBatch(c.env, rows, groupMap);
  const subscriptions = rows.map((row) => {
    const groups = groupMap.get(Number(row.id)) || [];
    const health = healthMap.get(Number(row.id));
    return {
      id: row.id,
      name: row.name,
      tokenPrefix: row.token_prefix,
      groupIds: groups.map((g) => g.id),
      groups,
      groupNames: groups.map((g) => g.name).join(", "),
      enabled: row.enabled === 1,
      expireAt: row.expire_at,
      deviceLimit: row.device_limit,
      defaultFormat: row.default_format,
      usageMode: row.usage_mode,
      trafficLimitBytes: row.traffic_limit_bytes,
      manualUsedBytes: row.manual_used_bytes,
      disabledReason: row.disabled_reason,
      createdAt: row.created_at,
      health: health
        ? {
            status: health.status,
            nodeActive: health.nodeActive,
            nodeTotal: health.nodeTotal,
            devices: health.devices,
            usage: health.usage,
            expireAt: health.expireAt,
            daysToExpire: health.daysToExpire,
            warnings: health.warnings,
          }
        : undefined,
    };
  });
  return jsonOk({ subscriptions });
});

userRoutes.get("/subscriptions/:id/token", async (c) => {
  const gate = await requireLogin(c);
  if ("error" in gate) return gate.error;
  try {
    const revealed = await revealSubscriptionToken(c.env, Number(c.req.param("id")), gate.auth.user.id);
    if (!revealed) {
      return jsonError(404, "token_unavailable", "legacy subscription has no stored token; rotate once to enable re-copy");
    }
    return jsonOk({ token: revealed.token, tokenPrefix: revealed.tokenPrefix });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    return jsonError(message === "forbidden" ? 403 : 400, "subscription_error", message);
  }
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
    return jsonOk({ token: rotated.token, tokenPrefix: rotated.tokenPrefix, warning: "old link invalidated" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    return jsonError(message === "forbidden" ? 403 : 400, "subscription_error", message);
  }
});


userRoutes.get("/subscriptions/:id/nodes", async (c) => {
  const gate = await requireLogin(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  const sub = await c.env.DB.prepare(
    "SELECT id, user_id, group_id, enabled FROM subscriptions WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<any>();
  if (!sub || Number(sub.user_id) !== gate.auth.user.id) {
    return jsonError(404, "not_found", "subscription not found");
  }
  const meta = await loadSubscriptionNodeMeta(c.env, id, Number(sub.group_id));
  const nodes = meta.map((row) => {
    let server = "";
    let port: number | null = null;
    try {
      const n = JSON.parse(row.normalized_json || "{}");
      server = String(n.server || n.host || "");
      port = n.port != null ? Number(n.port) : null;
    } catch {
      /* ignore */
    }
    const maskedServer = server
      ? (server.length <= 4 ? "***" : server.slice(0, 2) + "***" + server.slice(-2))
      : "";
    return {
      id: Number(row.id),
      name: row.name,
      protocol: row.protocol,
      server: maskedServer,
      port,
      enabled: Number(row.enabled) === 1,
      stale: Number(row.stale) === 1,
    };
  });
  const groups = await listSubscriptionGroups(c.env, id);
  return jsonOk({ nodes, groupId: groups[0]?.id ?? sub.group_id, groupIds: groups.map((g) => g.id), groups });
});

userRoutes.put("/password", async (c) => {
  const gate = await requireLogin(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  const current = String(body?.currentPassword || "");
  const next = String(body?.newPassword || "");
  try { assertPassword(next); } catch (e) {
    return jsonError(400, "invalid_request", e instanceof Error ? e.message : "invalid password");
  }
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
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(gate.auth.user.id).run();
  return jsonOk({ ok: true, reauth: true });
});
