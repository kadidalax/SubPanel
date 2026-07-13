import { Hono } from "hono";
import type { Env } from "../env.ts";
import { requireUser, publicUser } from "../auth/session.ts";
import { jsonError, jsonOk } from "../util/json.ts";
import { sameOrigin, getClientIp, getRequestId } from "../util/request.ts";
import { writeAudit } from "../db/audit.ts";
import { createUser, listUsers, setUserEnabled } from "../db/users.ts";
import { hashPassword } from "../crypto/password.ts";
import { assertPassword } from "../util/password_policy.ts";
import { safeSupportHref } from "../util/safe_href.ts";
import { readVars } from "../env.ts";
import { nowMs } from "../util/time.ts";
import {
  createManualSource,
  createPassthroughSource,
  createRemoteSource,
  deleteNode,
  deleteSource,
  listSourceNodes,
  listSources,
  refreshSource,
  setNodeEnabled,
  batchSetNodeEnabled,
  batchDeleteNodes,
  batchDeleteSources,
  batchRefreshSources,
  updateSource,
} from "../services/sources.ts";
import {
  createGroup,
  createSubscription,
  deleteGroup,
  listSubscriptionDevices,
  deleteSubscriptionDevice,
  resetSubscriptionDevices,
  rotateSubscriptionToken,
  revealSubscriptionToken,
  setGroupNodes,
  updateSubscription,
  getSubscriptionRow,
  listRecentAccess,
  deleteSubscription,
  batchUpdateSubscriptions,
  batchDeleteSubscriptions,
  batchDeleteGroups,
  updateGroup,
  getGroupNodes,
  listSubscriptionGroups,
  listGroupsForSubscriptionIds,
} from "../services/subscriptions.ts";
import { buildSubscriptionHealth } from "../services/health.ts";
import { sendNotification } from "../services/notifications.ts";
import { parseSubscriptionText } from "../parsers/detect.ts";
import { renderProfile } from "../renderers/index.ts";
import { buildCompatMatrix } from "../parsers/capabilities.ts";
import { encryptSecret } from "../services/credentials.ts";

type AppEnv = { Bindings: Env };
export const adminRoutes = new Hono<AppEnv>();

function isStaff(role: string) {
  return role === "admin";
}

async function requireStaff(c: any) {
  const auth = await requireUser(c.env, c.req.raw);
  if (!auth) return { error: jsonError(401, "unauthorized", "login required") };
  if (!isStaff(auth.user.role)) return { error: jsonError(403, "forbidden", "admin only") };
  return { auth };
}

async function requireAdmin(c: any) {
  const auth = await requireUser(c.env, c.req.raw);
  if (!auth) return { error: jsonError(401, "unauthorized", "login required") };
  if (auth.user.role !== "admin") return { error: jsonError(403, "forbidden", "admin only") };
  return { auth };
}

function auditBase(c: any, auth: any) {
  return {
    actorUserId: auth.user.id,
    ip: getClientIp(c.req.raw),
    requestId: getRequestId(c.req.raw),
    now: nowMs(),
  };
}

adminRoutes.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !sameOrigin(c.req.raw, new URL(c.req.url))) {
    return jsonError(403, "csrf", "invalid origin");
  }
  await next();
});

adminRoutes.get("/me", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  return jsonOk({ user: publicUser(gate.auth.user) });
});

adminRoutes.get("/users", async (c) => {
  const gate = await requireAdmin(c);
  if ("error" in gate) return gate.error;
  const users = await listUsers(c.env.DB);
  return jsonOk({ users: users.map(publicUser) });
});

adminRoutes.post("/users", async (c) => {
  const gate = await requireAdmin(c);
  if ("error" in gate) return gate.error;
  const body = await c.req.json<any>().catch(() => ({}));
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const email = body.email ? String(body.email).trim() : null;
  const role = "user";
  if (!username) return jsonError(400, "invalid", "username and password(>=10) required");
  try { assertPassword(password); } catch (e) {
    return jsonError(400, "invalid", e instanceof Error ? e.message : "invalid password");
  }
  const vars = readVars(c.env);
  const passwordHash = await hashPassword(password, vars.passwordIterations);
  const now = nowMs();
  const id = await createUser(c.env.DB, {
    username,
    email,
    passwordHash,
    role,
    now,
  });
  await writeAudit(c.env.DB, {
    action: "user.create",
    targetType: "user",
    targetId: String(id),
    after: { username, role },
    ...auditBase(c, gate.auth),
  });
  return jsonOk({ id, username, role });
});

adminRoutes.post("/users/:id/enabled", async (c) => {
  const gate = await requireAdmin(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => null)) as any;
  const enabled = Boolean(body?.enabled);
  const now = nowMs();
  if (!enabled) {
    const target = await c.env.DB.prepare("SELECT id, role, enabled FROM users WHERE id = ? LIMIT 1").bind(id).first<any>();
    if (target && target.role === "admin") {
      const admins = await c.env.DB.prepare(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND enabled = 1 AND id != ?",
      ).bind(id).first<{ c: number }>();
      if ((admins?.c ?? 0) < 1) return jsonError(400, "last_admin", "cannot disable the last admin");
    }
  }
  await setUserEnabled(c.env.DB, id, enabled, now);
  await c.env.DB.prepare(
    "UPDATE users SET disabled_reason = ?, updated_at = ? WHERE id = ?",
  )
    .bind(enabled ? null : "manual", now, id)
    .run();
  await writeAudit(c.env.DB, {
    ...auditBase(c, gate.auth),
    action: enabled ? "user.enable" : "user.disable",
    targetType: "user",
    targetId: String(id),
  });
  return jsonOk({ ok: true });
});

adminRoutes.put("/users/:id", async (c) => {
  const gate = await requireAdmin(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => null)) as any;
  const now = nowMs();
  const email = body?.email === undefined ? undefined : body.email ? String(body.email).trim().toLowerCase() : null;
  const expireAt = body?.expireAt === undefined ? undefined : body.expireAt;
  if (email !== undefined || expireAt !== undefined) {
    const row = await c.env.DB.prepare("SELECT email, expire_at FROM users WHERE id = ?").bind(id).first<any>();
    if (!row) return jsonError(404, "not_found", "user not found");
    await c.env.DB.prepare("UPDATE users SET email = ?, expire_at = ?, updated_at = ? WHERE id = ?")
      .bind(email === undefined ? row.email : email, expireAt === undefined ? row.expire_at : expireAt, now, id)
      .run();
  }
  if (body?.password) {
    try { assertPassword(String(body.password)); } catch (e) {
      return jsonError(400, "invalid_request", e instanceof Error ? e.message : "invalid password");
    }
    const vars = readVars(c.env);
    await c.env.DB.prepare(
      "UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?",
    )
      .bind(await hashPassword(String(body.password), vars.passwordIterations), now, id)
      .run();
  }
  await writeAudit(c.env.DB, {
    ...auditBase(c, gate.auth),
    action: "user.update",
    targetType: "user",
    targetId: String(id),
  });
  return jsonOk({ ok: true });
});

adminRoutes.post("/sources/preview", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  const parsed = parseSubscriptionText(String(body?.content || ""), body?.formatHint);
  return jsonOk({
    detectedFormat: parsed.detectedFormat,
    nodeCount: parsed.nodes.length,
    warnings: parsed.warnings,
    sample: parsed.nodes.slice(0, 20),
  });
});

adminRoutes.get("/sources", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  return jsonOk({ sources: await listSources(c.env) });
});

adminRoutes.post("/sources/manual", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  try {
    const created = await createManualSource(c.env, {
      name: String(body?.name || "manual"),
      content: String(body?.content || ""),
      formatHint: body?.formatHint,
    });
    await writeAudit(c.env.DB, {
      ...auditBase(c, gate.auth),
      action: "source.create_manual",
      targetType: "source",
      targetId: String(created.id),
      after: { nodeCount: created.nodeCount },
    });
    return jsonOk(created);
  } catch (err) {
    return jsonError(400, "source_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.post("/sources/remote", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  try {
    const created = await createRemoteSource(c.env, {
      name: String(body?.name || "remote"),
      url: String(body?.url || ""),
      headers: body?.headers || {},
      formatHint: body?.formatHint,
      refreshIntervalMinutes: body?.refreshIntervalMinutes,
    });
    await writeAudit(c.env.DB, {
      ...auditBase(c, gate.auth),
      action: "source.create_remote",
      targetType: "source",
      targetId: String(created.id),
      after: { nodeCount: created.nodeCount },
    });
    return jsonOk(created);
  } catch (err) {
    return jsonError(400, "source_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.post("/sources/passthrough", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  try {
    const created = await createPassthroughSource(c.env, {
      name: String(body?.name || "passthrough"),
      content: String(body?.content || ""),
      passthroughFormat: body?.passthroughFormat || "uri",
    });
    await writeAudit(c.env.DB, {
      ...auditBase(c, gate.auth),
      action: "source.create_passthrough",
      targetType: "source",
      targetId: String(created.id),
    });
    return jsonOk(created);
  } catch (err) {
    return jsonError(400, "source_error", err instanceof Error ? err.message : "failed");
  }
});


adminRoutes.put("/sources/:id", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => null)) as any;
  try {
    await updateSource(c.env, id, {
      name: body?.name,
      enabled: body?.enabled,
      refreshIntervalMinutes: body?.refreshIntervalMinutes,
      formatHint: body?.formatHint,
      manualContent: body?.manualContent,
      url: body?.url,
      headers: body?.headers,
      passthroughFormat: body?.passthroughFormat,
    });
    if (body?.refresh === true) {
      try { await refreshSource(c.env, id); } catch { /* keep edit even if refresh fails */ }
    }
    await writeAudit(c.env.DB, {
      ...auditBase(c, gate.auth),
      action: "source.update",
      targetType: "source",
      targetId: String(id),
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(400, "source_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.put("/groups/:id", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => null)) as any;
  try {
    await updateGroup(c.env, id, {
      name: body?.name,
      description: body?.description,
      enabled: body?.enabled,
      nodeIds: Array.isArray(body?.nodeIds) ? body.nodeIds.map(Number) : undefined,
    });
    await writeAudit(c.env.DB, {
      ...auditBase(c, gate.auth),
      action: "group.update",
      targetType: "group",
      targetId: String(id),
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(400, "group_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.get("/groups/:id", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(
    "SELECT id, name, description, enabled, revision, created_at, updated_at FROM groups WHERE id = ? LIMIT 1",
  ).bind(id).first<any>();
  if (!row) return jsonError(404, "not_found", "group not found");
  const nodeIds = await getGroupNodes(c.env, id);
  return jsonOk({ group: row, nodeIds });
});

adminRoutes.get("/sources/:id", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(
    `SELECT id, name, kind, format_hint, passthrough_format, refresh_interval_minutes, next_refresh_at,
            enabled, failure_count, last_success_at, last_error, revision, created_at, updated_at,
            CASE WHEN manual_content IS NULL THEN NULL ELSE substr(manual_content, 1, 20000) END AS manual_content
     FROM sources WHERE id = ? LIMIT 1`,
  ).bind(id).first<any>();
  if (!row) return jsonError(404, "not_found", "source not found");
  return jsonOk({ source: row });
});

adminRoutes.post("/sources/:id/refresh", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  try {
    return jsonOk(await refreshSource(c.env, id));
  } catch (err) {
    return jsonError(400, "refresh_failed", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.delete("/sources/:id", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  try {
    await deleteSource(c.env, Number(c.req.param("id")));
    await writeAudit(c.env.DB, {
      ...auditBase(c, gate.auth),
      action: "source.delete",
      targetType: "source",
      targetId: c.req.param("id"),
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(400, "source_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.get("/sources/:id/nodes", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  return jsonOk({ nodes: await listSourceNodes(c.env, Number(c.req.param("id"))) });
});

adminRoutes.post("/groups", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  const id = await createGroup(c.env, String(body?.name || "default"), body?.description);
  // allow empty group: always write node set (may be [])
  const nodeIds = Array.isArray(body?.nodeIds) ? body.nodeIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0) : [];
  await setGroupNodes(c.env, id, nodeIds);
  await writeAudit(c.env.DB, {
    ...auditBase(c, gate.auth),
    action: "group.create",
    targetType: "group",
    targetId: String(id),
  });
  return jsonOk({ id });
});

adminRoutes.put("/groups/:id/nodes", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  await setGroupNodes(
    c.env,
    Number(c.req.param("id")),
    Array.isArray(body?.nodeIds) ? body.nodeIds.map(Number) : [],
  );
  return jsonOk({ ok: true });
});


adminRoutes.get("/groups/:id/preview", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const groupId = Number(c.req.param("id"));
  const format = String(c.req.query("format") || "uri");
  if (!["mihomo", "singbox", "uri", "uri-base64", "surge"].includes(format)) {
    return jsonError(400, "invalid_format", "unsupported format");
  }
  const res = await c.env.DB.prepare(
    `SELECT sn.normalized_json AS normalized_json, sn.name AS name
     FROM group_nodes gn
     JOIN source_nodes sn ON sn.id = gn.node_id
     WHERE gn.group_id = ? AND gn.enabled = 1 AND sn.enabled = 1 AND sn.stale = 0
     ORDER BY gn.sort_order ASC, sn.source_order ASC, sn.id ASC`,
  )
    .bind(groupId)
    .all<{ normalized_json: string; name: string }>();
  const nodes = (res.results ?? []).map((r) => JSON.parse(r.normalized_json));
  const rendered = await renderProfile(format as any, nodes, readVars(c.env).siteName);
  return jsonOk({
    format,
    nodeCount: nodes.length,
    skipped: rendered.skipped,
    bodyPreview: rendered.body.slice(0, 4000),
  });
});
adminRoutes.delete("/groups/:id", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  try {
    await deleteGroup(c.env, Number(c.req.param("id")));
    await writeAudit(c.env.DB, {
      ...auditBase(c, gate.auth),
      action: "group.delete",
      targetType: "group",
      targetId: c.req.param("id"),
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(400, "group_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.post("/subscriptions", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  try {
    const groupIds = Array.isArray(body?.groupIds)
      ? body.groupIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
      : (body?.groupId != null ? [Number(body.groupId)] : []);
    const created = await createSubscription(c.env, {
      userId: Number(body?.userId),
      groupIds,
      groupId: groupIds[0],
      name: String(body?.name || "default"),
      defaultFormat: body?.defaultFormat || "auto",
      deviceLimit: body?.deviceLimit ?? null,
      expireAt: body?.expireAt ?? null,
      usageMode: body?.usageMode || "none",
      trafficLimitBytes: body?.trafficLimitBytes ?? null,
      exclusiveSourceId: body?.exclusiveSourceId ?? null,
    });
    await writeAudit(c.env.DB, {
      ...auditBase(c, gate.auth),
      action: "subscription.create",
      targetType: "subscription",
      targetId: String(created.id),
      after: { tokenPrefix: created.tokenPrefix },
    });
    return jsonOk({
      id: created.id,
      token: created.token,
      tokenPrefix: created.tokenPrefix,
      warning: "token stored encrypted; can re-copy without rotate",
    });
  } catch (err) {
    return jsonError(400, "subscription_error", err instanceof Error ? err.message : "failed");
  }
});


adminRoutes.get("/subscriptions/:id", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  const row = await getSubscriptionRow(c.env, id);
  if (!row) return jsonError(404, "not_found", "subscription not found");
  const health = await buildSubscriptionHealth(c.env, row);
  const devices = await listSubscriptionDevices(c.env, id);
  const recentAccess = await listRecentAccess(c.env, id, 20);
  const groups = await listSubscriptionGroups(c.env, id);
  return jsonOk({
    subscription: {
      id: row.id,
      userId: row.user_id,
      username: row.username,
      userEmail: row.user_email,
      groupId: groups[0]?.id ?? row.group_id,
      groupName: groups.map((g) => g.name).join(" + ") || row.group_name,
      groupIds: groups.map((g) => g.id),
      groups,
      name: row.name,
      tokenPrefix: row.token_prefix,
      enabled: row.enabled === 1,
      expireAt: row.expire_at,
      deviceLimit: row.device_limit,
      defaultFormat: row.default_format,
      usageMode: row.usage_mode,
      trafficLimitBytes: row.traffic_limit_bytes,
      manualUsedBytes: row.manual_used_bytes,
      exclusiveSourceId: row.exclusive_source_id,
      disabledReason: row.disabled_reason,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    health,
    devices,
    recentAccess,
  });
});

adminRoutes.get("/subscriptions/:id/health", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  const row = await getSubscriptionRow(c.env, id);
  if (!row) return jsonError(404, "not_found", "subscription not found");
  return jsonOk({ health: await buildSubscriptionHealth(c.env, row) });
});
adminRoutes.put("/subscriptions/:id", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  try {
    const groupIds = Array.isArray(body?.groupIds)
      ? body.groupIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
      : undefined;
    await updateSubscription(c.env, Number(c.req.param("id")), {
      name: body?.name,
      groupIds,
      groupId: body?.groupId == null ? undefined : Number(body.groupId),
      enabled: body?.enabled,
      expireAt: body?.expireAt,
      deviceLimit: body?.deviceLimit,
      defaultFormat: body?.defaultFormat,
      usageMode: body?.usageMode,
      trafficLimitBytes: body?.trafficLimitBytes,
      manualUsedBytes: body?.manualUsedBytes,
      exclusiveSourceId: body?.exclusiveSourceId,
      disabledReason: body?.disabledReason,
    });
    await writeAudit(c.env.DB, {
      ...auditBase(c, gate.auth),
      action: "subscription.update",
      targetType: "subscription",
      targetId: c.req.param("id"),
    });
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(400, "subscription_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.get("/subscriptions/:id/token", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  try {
    const revealed = await revealSubscriptionToken(c.env, Number(c.req.param("id")));
    if (!revealed) {
      return jsonError(404, "token_unavailable", "legacy subscription has no stored token; rotate once to enable re-copy");
    }
    return jsonOk({ token: revealed.token, tokenPrefix: revealed.tokenPrefix });
  } catch (err) {
    return jsonError(400, "subscription_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.post("/subscriptions/:id/rotate", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  try {
    const rotated = await rotateSubscriptionToken(c.env, Number(c.req.param("id")));
    await writeAudit(c.env.DB, {
      ...auditBase(c, gate.auth),
      action: "subscription.rotate",
      targetType: "subscription",
      targetId: c.req.param("id"),
      after: { tokenPrefix: rotated.tokenPrefix },
    });
    return jsonOk({ token: rotated.token, tokenPrefix: rotated.tokenPrefix, warning: "token stored encrypted; can re-copy without rotate" });
  } catch (err) {
    return jsonError(400, "subscription_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.get("/subscriptions/:id/devices", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  return jsonOk({ devices: await listSubscriptionDevices(c.env, Number(c.req.param("id"))) });
});

adminRoutes.delete("/subscriptions/:id/devices", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const removed = await resetSubscriptionDevices(c.env, Number(c.req.param("id")));
  await writeAudit(c.env.DB, {
    ...auditBase(c, gate.auth),
    action: "subscription.reset_devices",
    targetType: "subscription",
    targetId: c.req.param("id"),
    after: { removed },
  });
  return jsonOk({ removed });
});

adminRoutes.delete("/subscriptions/:id/devices/:fingerprint", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const fingerprint = decodeURIComponent(c.req.param("fingerprint"));
  const removed = await deleteSubscriptionDevice(c.env, Number(c.req.param("id")), fingerprint);
  await writeAudit(c.env.DB, {
    ...auditBase(c, gate.auth),
    action: "subscription.delete_device",
    targetType: "subscription",
    targetId: c.req.param("id"),
    after: { fingerprint: fingerprint.slice(0, 12), removed },
  });
  return jsonOk({ removed });
});

adminRoutes.get("/groups", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const res = await c.env.DB.prepare(
    "SELECT id, name, description, enabled, revision, created_at, updated_at FROM groups ORDER BY id DESC",
  ).all();
  return jsonOk({ groups: res.results ?? [] });
});

adminRoutes.get("/subscriptions", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const res = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, s.group_id, s.name, s.token_prefix, s.enabled, s.expire_at, s.device_limit,
            s.default_format, s.usage_mode, s.traffic_limit_bytes, s.manual_used_bytes, s.exclusive_source_id,
            s.disabled_reason, s.revision, s.created_at, u.username
     FROM subscriptions s JOIN users u ON u.id = s.user_id
     ORDER BY s.id DESC`,
  ).all<any>();
  const rows = res.results ?? [];
  const groupMap = await listGroupsForSubscriptionIds(
    c.env,
    rows.map((r: any) => Number(r.id)),
  );
  const subscriptions = rows.map((row: any) => {
    const groups = groupMap.get(Number(row.id)) || [];
    return {
      ...row,
      group_id: groups[0]?.id ?? row.group_id,
      groupIds: groups.map((g) => g.id),
      groups,
      groupNames: groups.map((g) => g.name).join(", "),
    };
  });
  return jsonOk({ subscriptions });
});

adminRoutes.get("/nodes", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  try {
    const url = new URL(c.req.url);
    let limit = Number(url.searchParams.get("limit") || 500);
    let offset = Number(url.searchParams.get("offset") || 0);
    if (!Number.isFinite(limit) || limit <= 0) limit = 500;
    // keep page size under D1 bind limits for any follow-up queries
    if (limit > 500) limit = 500;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    const sourceId = url.searchParams.get("sourceId");
    const q = (url.searchParams.get("q") || "").trim();

    const where: string[] = ["1=1"];
    const binds: any[] = [];
    if (sourceId) {
      where.push("sn.source_id = ?");
      binds.push(Number(sourceId));
    }
    if (q) {
      where.push("(sn.name LIKE ? OR sn.protocol LIKE ? OR s.name LIKE ?)");
      const like = "%" + q + "%";
      binds.push(like, like, like);
    }
    const whereSql = where.join(" AND ");

    const countSql =
      `SELECT COUNT(*) AS c FROM source_nodes sn JOIN sources s ON s.id = sn.source_id WHERE ${whereSql}`;
    // Correlated GROUP_CONCAT avoids huge IN (...) bind lists (D1 ~100 variable limit).
    const listSql =
      `SELECT sn.id, sn.source_id, sn.protocol, sn.name, sn.capability_flags, sn.enabled, sn.stale,
              sn.first_seen_at, sn.last_seen_at, s.name AS source_name,
              (
                SELECT GROUP_CONCAT(g.id || ':' || g.name, '|')
                FROM group_nodes gn
                JOIN groups g ON g.id = gn.group_id
                WHERE gn.node_id = sn.id AND gn.enabled = 1
              ) AS groups_csv
       FROM source_nodes sn JOIN sources s ON s.id = sn.source_id
       WHERE ${whereSql}
       ORDER BY sn.source_id ASC, sn.source_order ASC, sn.id ASC
       LIMIT ? OFFSET ?`;

    const totalRow = binds.length
      ? await c.env.DB.prepare(countSql).bind(...binds).first<{ c: number }>()
      : await c.env.DB.prepare(countSql).first<{ c: number }>();
    const total = Number(totalRow?.c || 0);

    const listRes = await c.env.DB.prepare(listSql).bind(...binds, limit, offset).all<any>();
    const nodes = (listRes.results ?? []).map((row: any) => {
      const groups: Array<{ id: number; name: string }> = [];
      if (row.groups_csv) {
        for (const part of String(row.groups_csv).split("|")) {
          if (!part) continue;
          const idx = part.indexOf(":");
          if (idx < 0) continue;
          const id = Number(part.slice(0, idx));
          const name = part.slice(idx + 1);
          if (Number.isFinite(id)) groups.push({ id, name });
        }
      }
      const { groups_csv, ...rest } = row;
      return { ...rest, groups, groupIds: groups.map((g) => g.id) };
    });
    return jsonOk({ nodes, total, limit, offset });
  } catch (err) {
    return jsonError(500, "nodes_query_failed", err instanceof Error ? err.message : "nodes query failed");
  }
});

adminRoutes.post("/nodes/:id/enabled", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  await setNodeEnabled(c.env, Number(c.req.param("id")), Boolean(body?.enabled));
  return jsonOk({ ok: true });
});

adminRoutes.delete("/nodes/:id", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  await deleteNode(c.env, Number(c.req.param("id")));
  await writeAudit(c.env.DB, {
    ...auditBase(c, gate.auth),
    action: "node.delete",
    targetType: "node",
    targetId: c.req.param("id"),
  });
  return jsonOk({ ok: true });
});


adminRoutes.post("/nodes/batch", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number) : [];
  const action = String(body?.action || "");
  try {
    if (action === "enable" || action === "disable") {
      const changed = await batchSetNodeEnabled(c.env, ids, action === "enable");
      await writeAudit(c.env.DB, { ...auditBase(c, gate.auth), action: "node.batch_" + action, targetType: "node", targetId: ids.join(","), after: { changed } });
      return jsonOk({ changed });
    }
    if (action === "delete") {
      const deleted = await batchDeleteNodes(c.env, ids);
      await writeAudit(c.env.DB, { ...auditBase(c, gate.auth), action: "node.batch_delete", targetType: "node", targetId: ids.join(","), after: { deleted } });
      return jsonOk({ deleted });
    }
    return jsonError(400, "invalid_action", "action must be enable|disable|delete");
  } catch (err) {
    return jsonError(400, "batch_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.post("/sources/batch", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number) : [];
  const action = String(body?.action || "");
  try {
    if (action === "refresh") {
      const res = await batchRefreshSources(c.env, ids);
      return jsonOk(res);
    }
    if (action === "delete") {
      const res = await batchDeleteSources(c.env, ids);
      await writeAudit(c.env.DB, { ...auditBase(c, gate.auth), action: "source.batch_delete", targetType: "source", targetId: ids.join(","), after: res });
      return jsonOk(res);
    }
    return jsonError(400, "invalid_action", "action must be refresh|delete");
  } catch (err) {
    return jsonError(400, "batch_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.post("/groups/batch", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number) : [];
  const action = String(body?.action || "");
  try {
    if (action === "delete") {
      const res = await batchDeleteGroups(c.env, ids);
      await writeAudit(c.env.DB, { ...auditBase(c, gate.auth), action: "group.batch_delete", targetType: "group", targetId: ids.join(","), after: res });
      return jsonOk(res);
    }
    return jsonError(400, "invalid_action", "action must be delete");
  } catch (err) {
    return jsonError(400, "batch_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.post("/subscriptions/batch", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number) : [];
  const action = String(body?.action || "");
  try {
    if (action === "enable" || action === "disable") {
      const changed = await batchUpdateSubscriptions(c.env, ids, {
        enabled: action === "enable",
        disabledReason: action === "disable" ? "manual" : null,
      });
      await writeAudit(c.env.DB, { ...auditBase(c, gate.auth), action: "subscription.batch_" + action, targetType: "subscription", targetId: ids.join(","), after: { changed } });
      return jsonOk({ changed });
    }
    if (action === "delete") {
      const deleted = await batchDeleteSubscriptions(c.env, ids);
      await writeAudit(c.env.DB, { ...auditBase(c, gate.auth), action: "subscription.batch_delete", targetType: "subscription", targetId: ids.join(","), after: { deleted } });
      return jsonOk({ deleted });
    }
    return jsonError(400, "invalid_action", "action must be enable|disable|delete");
  } catch (err) {
    return jsonError(400, "batch_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.delete("/subscriptions/:id", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  try {
    await deleteSubscription(c.env, id);
    await writeAudit(c.env.DB, { ...auditBase(c, gate.auth), action: "subscription.delete", targetType: "subscription", targetId: String(id) });
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(400, "subscription_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.post("/users/batch", async (c) => {
  const gate = await requireAdmin(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number) : [];
  const action = String(body?.action || "");
  const now = nowMs();
  try {
    if (action === "enable" || action === "disable") {
      let changed = 0;
      for (const id of ids) {
        if (!id || id === gate.auth.user.id) continue;
        await setUserEnabled(c.env.DB, id, action === "enable", now);
        changed += 1;
      }
      await writeAudit(c.env.DB, { ...auditBase(c, gate.auth), action: "user.batch_" + action, targetType: "user", targetId: ids.join(","), after: { changed } });
      return jsonOk({ changed });
    }
    return jsonError(400, "invalid_action", "action must be enable|disable");
  } catch (err) {
    return jsonError(400, "batch_error", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.get("/audit-logs", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const action = c.req.query("action");
  let sql = "SELECT id, actor_user_id, action, target_type, target_id, ip, request_id, created_at FROM audit_logs WHERE 1=1";
  const binds: any[] = [];
  if (action) { sql += " AND action LIKE ?"; binds.push("%" + action + "%"); }
  sql += " ORDER BY id DESC LIMIT 200";
  const stmt = binds.length ? c.env.DB.prepare(sql).bind(...binds) : c.env.DB.prepare(sql);
  const res = await stmt.all();
  return jsonOk({ logs: res.results ?? [] });
});

adminRoutes.get("/access-logs", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const subscriptionId = c.req.query("subscriptionId");
  const clientFamily = c.req.query("clientFamily");
  let sql = "SELECT id, subscription_id, client_family, format, response_bytes, status, created_at FROM subscription_access_logs WHERE 1=1";
  const binds: any[] = [];
  if (subscriptionId) { sql += " AND subscription_id = ?"; binds.push(Number(subscriptionId)); }
  if (clientFamily) { sql += " AND client_family = ?"; binds.push(clientFamily); }
  sql += " ORDER BY id DESC LIMIT 200";
  const stmt = binds.length ? c.env.DB.prepare(sql).bind(...binds) : c.env.DB.prepare(sql);
  const res = await stmt.all();
  return jsonOk({ logs: res.results ?? [] });
});


adminRoutes.post("/logs/clear", async (c) => {
  const gate = await requireAdmin(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => ({}))) as { tab?: string };
  const tab = String(body.tab || "all");
  let deleted = 0;
  const run = async (sql: string) => {
    const r = await c.env.DB.prepare(sql).run();
    deleted += Number((r as any).meta?.changes || 0);
  };
  // durable clear marker (settings) survives audit wipe
  const marker = {
    at: nowMs(),
    by: gate.auth.user.id,
    tab,
  };
  await c.env.DB.prepare(
    "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
  )
    .bind("logs_last_clear", JSON.stringify(marker), marker.at)
    .run();
  if (tab === "audit" || tab === "all") await run("DELETE FROM audit_logs");
  if (tab === "access" || tab === "all") await run("DELETE FROM subscription_access_logs");
  if (tab === "notifications" || tab === "all") await run("DELETE FROM notifications");
  if (tab === "jobs" || tab === "all") await run("DELETE FROM job_runs");
  await writeAudit(c.env.DB, {
    ...auditBase(c, gate.auth),
    action: "logs.clear",
    targetType: "logs",
    targetId: tab,
    after: { deleted, durable: marker },
  });
  return jsonOk({ ok: true, tab, deleted });
});
adminRoutes.get("/notifications", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const status = c.req.query("status");
  const kind = c.req.query("kind");
  let sql = "SELECT id, event_key, user_id, subscription_id, kind, status, attempts, sent_at, last_error, created_at FROM notifications WHERE 1=1";
  const binds: any[] = [];
  if (status) { sql += " AND status = ?"; binds.push(status); }
  if (kind) { sql += " AND kind = ?"; binds.push(kind); }
  sql += " ORDER BY id DESC LIMIT 200";
  const stmt = binds.length ? c.env.DB.prepare(sql).bind(...binds) : c.env.DB.prepare(sql);
  const res = await stmt.all();
  return jsonOk({ notifications: res.results ?? [] });
});

adminRoutes.post("/notifications/:id/retry", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const id = Number(c.req.param("id"));
  try {
    await c.env.DB.prepare(
      "UPDATE notifications SET status = 'pending', next_attempt_at = ?, last_error = NULL WHERE id = ?",
    )
      .bind(nowMs(), id)
      .run();
    await sendNotification(c.env, id);
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(400, "retry_failed", err instanceof Error ? err.message : "failed");
  }
});

adminRoutes.get("/jobs", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const res = await c.env.DB.prepare(
    "SELECT id, job_key, kind, status, attempts, started_at, finished_at, last_error, created_at FROM job_runs ORDER BY id DESC LIMIT 200",
  ).all();
  return jsonOk({ jobs: res.results ?? [] });
});

adminRoutes.get("/dashboard", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  const now = nowMs();
  const dayAgo = now - 86400000;
  const weekLater = now + 7 * 86400000;
  const stmts = [
    c.env.DB.prepare("SELECT COUNT(*) AS c FROM users"),
    c.env.DB.prepare("SELECT COUNT(*) AS c FROM sources"),
    c.env.DB.prepare("SELECT COUNT(*) AS c FROM source_nodes WHERE stale = 0"),
    c.env.DB.prepare("SELECT COUNT(*) AS c FROM groups"),
    c.env.DB.prepare("SELECT COUNT(*) AS c FROM subscriptions"),
    c.env.DB.prepare("SELECT COUNT(*) AS c FROM job_runs WHERE status = 'failed'"),
    c.env.DB.prepare("SELECT COUNT(*) AS c FROM notifications WHERE status = 'pending'"),
    c.env.DB.prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE enabled = 0"),
    c.env.DB.prepare("SELECT COUNT(*) AS c FROM subscription_access_logs WHERE created_at >= ?").bind(dayAgo),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS c FROM subscriptions WHERE expire_at IS NOT NULL AND expire_at > ? AND expire_at <= ?",
    ).bind(now, weekLater),
    c.env.DB.prepare("SELECT COUNT(*) AS c FROM sources WHERE enabled = 1 AND failure_count > 0"),
  ];
  const rows = await c.env.DB.batch(stmts as any);
  const n = (i: number) => Number((rows[i] as any)?.results?.[0]?.c ?? 0);
  return jsonOk({
    users: n(0),
    sources: n(1),
    nodes: n(2),
    groups: n(3),
    subscriptions: n(4),
    failedJobs: n(5),
    pendingNotifications: n(6),
    disabledSubscriptions: n(7),
    accessLast24h: n(8),
    expiring7d: n(9),
    degradedSources: n(10),
  });
});

adminRoutes.get("/compat-matrix", async (c) => {
  const gate = await requireStaff(c);
  if ("error" in gate) return gate.error;
  return jsonOk({ matrix: buildCompatMatrix() });
});
adminRoutes.get("/settings", async (c) => {
  const gate = await requireAdmin(c);
  if ("error" in gate) return gate.error;
  const res = await c.env.DB.prepare("SELECT key, value_json FROM settings").all<{ key: string; value_json: string }>();
  const settings: Record<string, unknown> = {};
  const deny = new Set(["credentials_key", "initialized"]);
  for (const row of res.results ?? []) {
    if (deny.has(row.key) || /(_key|_secret|_token)$/i.test(row.key)) continue;
    try {
      settings[row.key] = JSON.parse(row.value_json);
    } catch {
      settings[row.key] = row.value_json;
    }
  }
  if (settings.smtp_pass) settings.smtp_pass_set = true;
  if ("smtp_pass" in settings) settings.smtp_pass = "";
  settings.credentials_key_configured = Boolean((c.env.CREDENTIALS_KEY || "").trim().length >= 16);
  return jsonOk({ settings });
});

adminRoutes.put("/settings", async (c) => {
  const gate = await requireAdmin(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as any;
  const allowed = new Set([
    "site_name",
    "mail_from",
    "expire_remind_days",
    "traffic_warn_percent",
    "access_log_retention_days",
    "auto_reenable",
    "mail_enabled",
    "profile_update_interval_hours",
    "support_url",
    "announce",
    "refresh_batch_limit",
    "smtp_host",
    "smtp_port",
    "smtp_secure",
    "smtp_user",
    "smtp_pass",
  ]);
  const settings = body?.settings || {};
  const now = nowMs();
  for (const [key, value] of Object.entries(settings)) {
    if (!allowed.has(key)) continue;
    if (key === "smtp_pass" && (value == null || String(value) === "")) continue;
    let store: unknown = value;
    if (key === "smtp_pass") store = await encryptSecret(c.env, String(value));
    if (key === "support_url") {
      const safe = safeSupportHref(value);
      if (String(value || "").trim() && !safe) return jsonError(400, "invalid_support_url", "support_url must be https or mailto");
      store = safe;
    }
    if (key === "smtp_port") {
      const p = Number(value);
      if (![25, 465, 587, 2525].includes(p)) return jsonError(400, "invalid_smtp_port", "smtp port not allowed");
      store = p;
    }
    await c.env.DB.prepare(
      "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
    )
      .bind(key, JSON.stringify(store), now)
      .run();
  }
  await writeAudit(c.env.DB, {
    ...auditBase(c, gate.auth),
    action: "settings.update",
    targetType: "settings",
    targetId: "global",
  });
  return jsonOk({ ok: true });
});


