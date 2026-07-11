import { Hono } from "hono";
import type { Env } from "../env.ts";
import { readVars } from "../env.ts";
import { hashPassword, needsRehash, verifyPassword } from "../crypto/password.ts";
import { writeAudit } from "../db/audit.ts";
import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from "../db/rate_limit.ts";
import {
  createUser,
  findUserByEmail,
  findUserByUsername,
  updatePassword,
} from "../db/users.ts";
import {
  clearSessionCookie,
  destroySession,
  issueSession,
  publicUser,
  requireUser,
} from "../auth/session.ts";
import { jsonError, jsonOk } from "../util/json.ts";
import { getClientIp, getRequestId, sameOrigin } from "../util/request.ts";
import { nowMs } from "../util/time.ts";
import { randomToken } from "../util/ids.ts";
import { sha256Text } from "../crypto/hash.ts";
import { enqueueNotification } from "../services/notifications.ts";
import { assertPassword } from "../util/password_policy.ts";
import { encryptSecret } from "../services/credentials.ts";

type AppEnv = { Bindings: Env };

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const request = c.req.raw;
  const url = new URL(request.url);
  if (!sameOrigin(request, url)) return jsonError(403, "csrf", "invalid origin");

  const body = (await c.req.json().catch(() => null)) as { username?: string; password?: string } | null;
  const username = body?.username?.trim() ?? "";
  const password = body?.password ?? "";
  if (!username || !password) return jsonError(400, "invalid_request", "username and password required");
  try {
    assertPassword(password);
  } catch (e) {
    return jsonError(400, "invalid_request", e instanceof Error ? e.message : "invalid password");
  }

  const ip = getClientIp(request);
  const requestId = getRequestId(request);
  const now = nowMs();
  const userKey = "u:" + username.toLowerCase();
  const ipKey = "ip:" + ip;
  const rateKey = ip + ":" + username.toLowerCase();
  const rateUser = await checkLoginRateLimit(c.env.DB, userKey, now);
  const rateIp = await checkLoginRateLimit(c.env.DB, ipKey, now, 30, 15 * 60 * 1000, 15 * 60 * 1000);
  const ratePair = await checkLoginRateLimit(c.env.DB, rateKey, now);
  if (!rateUser.allowed || !rateIp.allowed || !ratePair.allowed) {
    return jsonError(429, "rate_limited", "too many attempts");
  }

  const user = await findUserByUsername(c.env.DB, username);
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !ok || user.enabled !== 1) {
    await recordLoginFailure(c.env.DB, rateKey, now);
    await recordLoginFailure(c.env.DB, userKey, now);
    await recordLoginFailure(c.env.DB, ipKey, now, 30);
    await writeAudit(c.env.DB, {
      action: "auth.login_failed",
      targetType: "user",
      targetId: username.toLowerCase(),
      ip,
      requestId,
      now,
    });
    return jsonError(401, "invalid_credentials", "invalid username or password");
  }

  await clearLoginFailures(c.env.DB, rateKey);
  await clearLoginFailures(c.env.DB, userKey);
  await clearLoginFailures(c.env.DB, ipKey);
  const vars = readVars(c.env);
  if (needsRehash(user.password_hash, vars.passwordIterations)) {
    const next = await hashPassword(password, vars.passwordIterations);
    await updatePassword(c.env.DB, user.id, next, now);
    user.session_version += 1;
    user.password_hash = next;
  }

  const session = await issueSession(c.env, user, url.protocol === "https:");
  await writeAudit(c.env.DB, {
    actorUserId: user.id,
    action: "auth.login",
    targetType: "user",
    targetId: String(user.id),
    ip,
    requestId,
    now,
  });
  return jsonOk({ user: publicUser(user) }, { headers: { "set-cookie": session.cookie } });
});
authRoutes.post("/logout", async (c) => {
  const request = c.req.raw;
  const url = new URL(request.url);
  if (!sameOrigin(request, url)) return jsonError(403, "csrf", "invalid origin");
  const auth = await requireUser(c.env, request);
  await destroySession(c.env, request);
  if (auth) {
    await writeAudit(c.env.DB, {
      actorUserId: auth.user.id,
      action: "auth.logout",
      targetType: "user",
      targetId: String(auth.user.id),
      ip: getClientIp(request),
      requestId: getRequestId(request),
      now: nowMs(),
    });
  }
  return jsonOk({ ok: true }, { headers: { "set-cookie": clearSessionCookie(url.protocol === "https:") } });
});

authRoutes.get("/me", async (c) => {
  const auth = await requireUser(c.env, c.req.raw);
  if (!auth) return jsonError(401, "unauthorized", "login required");
  return jsonOk({ user: publicUser(auth.user) });
});

authRoutes.put("/me/password", async (c) => {
  const request = c.req.raw;
  const url = new URL(request.url);
  if (!sameOrigin(request, url)) return jsonError(403, "csrf", "invalid origin");
  const auth = await requireUser(c.env, request);
  if (!auth) return jsonError(401, "unauthorized", "login required");

  const body = (await c.req.json().catch(() => null)) as {
    currentPassword?: string;
    newPassword?: string;
  } | null;
  const currentPassword = body?.currentPassword ?? "";
  const newPassword = body?.newPassword ?? "";
  try {
    assertPassword(newPassword);
  } catch (e) {
    return jsonError(400, "weak_password", e instanceof Error ? e.message : "weak password");
  }
  const ok = await verifyPassword(currentPassword, auth.user.password_hash);
  if (!ok) return jsonError(401, "invalid_credentials", "invalid current password");

  const vars = readVars(c.env);
  const now = nowMs();
  const next = await hashPassword(newPassword, vars.passwordIterations);
  await updatePassword(c.env.DB, auth.user.id, next, now);
  await destroySession(c.env, request);
  const refreshed = {
    ...auth.user,
    password_hash: next,
    session_version: auth.user.session_version + 1,
  };
  const session = await issueSession(c.env, refreshed, url.protocol === "https:");
  await writeAudit(c.env.DB, {
    actorUserId: auth.user.id,
    action: "auth.password_change",
    targetType: "user",
    targetId: String(auth.user.id),
    ip: getClientIp(request),
    requestId: getRequestId(request),
    now,
  });
  return jsonOk({ ok: true }, { headers: { "set-cookie": session.cookie } });
});

authRoutes.post("/forgot-password", async (c) => {
  const request = c.req.raw;
  const url = new URL(request.url);
  if (!sameOrigin(request, url)) return jsonError(403, "csrf", "invalid origin");
  const body = (await c.req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const ip = getClientIp(request);
  const now = nowMs();
  // always rate-limit by IP; also by email when present
  const ipRate = await checkLoginRateLimit(c.env.DB, "forgot:ip:" + ip, now, 5, 15 * 60 * 1000, 30 * 60 * 1000);
  if (!ipRate.allowed) return jsonError(429, "rate_limited", "too many attempts");
  await recordLoginFailure(c.env.DB, "forgot:ip:" + ip, now, 5, 15 * 60 * 1000, 30 * 60 * 1000);
  if (!email) return jsonOk({ ok: true });
  const emailRate = await checkLoginRateLimit(c.env.DB, "forgot:email:" + email, now, 3, 60 * 60 * 1000, 60 * 60 * 1000);
  if (!emailRate.allowed) return jsonOk({ ok: true }); // do not reveal
  await recordLoginFailure(c.env.DB, "forgot:email:" + email, now, 3, 60 * 60 * 1000, 60 * 60 * 1000);

  const user = await findUserByEmail(c.env.DB, email);
  if (user && user.enabled === 1) {
    const raw = randomToken(32);
    const tokenHash = await sha256Text(raw);
    // invalidate previous unused tokens
    await c.env.DB
      .prepare("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL")
      .bind(now, user.id)
      .run();
    await c.env.DB
      .prepare(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)",
      )
      .bind(user.id, tokenHash, now + 30 * 60 * 1000, now)
      .run();
    await writeAudit(c.env.DB, {
      actorUserId: user.id,
      action: "auth.password_reset_requested",
      targetType: "user",
      targetId: String(user.id),
      ip,
      requestId: getRequestId(request),
      now,
    });
    // store only encrypted one-shot token material for send; never leave raw URL in DB long-term
    const encToken = await encryptSecret(c.env, raw);
    await enqueueNotification(c.env, {
      eventKey: `user:${user.id}:password_reset:${tokenHash.slice(0, 12)}`,
      kind: "password_reset",
      userId: user.id,
      payload: {
        email,
        origin: url.origin,
        resetTokenEnc: encToken,
        tokenPrefix: raw.slice(0, 8),
      },
    });
  }
  return jsonOk({ ok: true });
});

authRoutes.post("/reset-password", async (c) => {
  const request = c.req.raw;
  const url = new URL(request.url);
  if (!sameOrigin(request, url)) return jsonError(403, "csrf", "invalid origin");
  const body = (await c.req.json().catch(() => null)) as { token?: string; newPassword?: string } | null;
  const token = body?.token ?? "";
  const newPassword = body?.newPassword ?? "";
  if (!token) return jsonError(400, "invalid_request", "token and password required");
  try {
    assertPassword(newPassword);
  } catch (e) {
    return jsonError(400, "invalid_request", e instanceof Error ? e.message : "invalid password");
  }

  const now = nowMs();
  const ip = getClientIp(request);
  const resetRate = await checkLoginRateLimit(c.env.DB, "reset:ip:" + ip, now, 10, 15 * 60 * 1000, 30 * 60 * 1000);
  if (!resetRate.allowed) return jsonError(429, "rate_limited", "too many attempts");
  await recordLoginFailure(c.env.DB, "reset:ip:" + ip, now, 10, 15 * 60 * 1000, 30 * 60 * 1000);

  const tokenHash = await sha256Text(token);
  const row = await c.env.DB
    .prepare(
      "SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ? LIMIT 1",
    )
    .bind(tokenHash)
    .first<{ id: number; user_id: number; expires_at: number; used_at: number | null }>();
  if (!row || row.used_at != null || row.expires_at < now) {
    return jsonError(400, "invalid_token", "invalid or expired token");
  }

  const vars = readVars(c.env);
  const passwordHash = await hashPassword(newPassword, vars.passwordIterations);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?").bind(now, row.id),
    c.env.DB
      .prepare(
        "UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?",
      )
      .bind(passwordHash, now, row.user_id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id),
    c.env.DB
      .prepare("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL")
      .bind(now, row.user_id),
  ]);
  await writeAudit(c.env.DB, {
    actorUserId: row.user_id,
    action: "auth.password_reset",
    targetType: "user",
    targetId: String(row.user_id),
    ip,
    requestId: getRequestId(request),
    now,
  });
  return jsonOk({ ok: true });
});
authRoutes.post("/bootstrap-admin", async (c) => {
  const request = c.req.raw;
  const url = new URL(request.url);
  if (!sameOrigin(request, url)) return jsonError(403, "csrf", "invalid origin");
  const countRow = await c.env.DB.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
  if ((countRow?.c ?? 0) > 0) return jsonError(409, "already_initialized", "users already exist");
  const init = await c.env.DB.prepare("SELECT value_json FROM settings WHERE key = ? LIMIT 1")
    .bind("initialized")
    .first<{ value_json: string }>();
  if (init) return jsonError(409, "already_initialized", "already initialized");

  const body = (await c.req.json().catch(() => null)) as {
    username?: string;
    password?: string;
    email?: string;
  } | null;
  const username = body?.username?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const email = body?.email?.trim().toLowerCase() || null;
  if (!username) return jsonError(400, "invalid_request", "username and strong password required");
  try {
    assertPassword(password);
  } catch (e) {
    return jsonError(400, "invalid_request", e instanceof Error ? e.message : "invalid password");
  }
  const vars = readVars(c.env);
  const now = nowMs();
  try {
    await c.env.DB.prepare(
      "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)",
    )
      .bind("initialized", JSON.stringify({ at: now }), now)
      .run();
  } catch {
    return jsonError(409, "already_initialized", "already initialized");
  }
  const passwordHash = await hashPassword(password, vars.passwordIterations);
  let id: number;
  try {
    id = await createUser(c.env.DB, {
      username,
      email,
      passwordHash,
      role: "admin",
      now,
    });
  } catch (err) {
    await c.env.DB.prepare("DELETE FROM settings WHERE key = ?").bind("initialized").run();
    throw err;
  }
  await writeAudit(c.env.DB, {
    actorUserId: id,
    action: "auth.bootstrap_admin",
    targetType: "user",
    targetId: String(id),
    ip: getClientIp(request),
    requestId: getRequestId(request),
    now,
  });
  return jsonOk({ id, username, role: "admin" });
});
