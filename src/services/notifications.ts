import type { Env } from "../env.ts";
import { nowMs } from "../util/time.ts";
import {
  getExpireRemindDays,
  getSettingBool,
  getSettingNumber,
  getSettingRaw,
  getSettingString,
} from "./settings.ts";
import { sendSmtp } from "./smtp.ts";
import { decryptSecret } from "./credentials.ts";
import { safeResetHref, safeSupportHref } from "../util/safe_href.ts";

export type NotificationKind =
  | "password_reset"
  | "user_expire"
  | "sub_expire"
  | "source_expire"
  | "traffic_warn"
  | "auto_disable"
  | "auto_enable"
  | "source_refresh_fail";

export async function enqueueNotification(
  env: Env,
  input: {
    eventKey: string;
    kind: NotificationKind;
    userId?: number | null;
    subscriptionId?: number | null;
    payload: Record<string, unknown>;
  },
): Promise<number | null> {
  const now = nowMs();
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO notifications
      (event_key, user_id, subscription_id, kind, payload_json, status, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  )
    .bind(
      input.eventKey,
      input.userId ?? null,
      input.subscriptionId ?? null,
      input.kind,
      JSON.stringify(input.payload),
      now,
      now,
    )
    .run();
  if (!res.meta.changes) return null;
  const id = Number(res.meta.last_row_id);
  // inline send (no queue); ignore send errors here, status stored on notification row
  try {
    await sendNotification(env, id);
  } catch {
    /* sendNotification records failure */
  }
  return id;
}

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function usedFromUsage(usage: any): number {
  if (!usage) return 0;
  if (usage.total_bytes != null) return Number(usage.total_bytes);
  return Number(usage.upload_bytes || 0) + Number(usage.download_bytes || 0);
}

export async function scanLifecycleEvents(env: Env): Promise<{ created: number; reenabled: number }> {
  const now = nowMs();
  let created = 0;
  let reenabled = 0;
  const warnPercent = await getSettingNumber(env, "traffic_warn_percent", 80);
  const remindDays = await getExpireRemindDays(env, [7, 3, 1]);
  const autoReenable = await getSettingBool(env, "auto_reenable", false);
  const mailEnabled = await getSettingBool(env, "mail_enabled", true);

  const users = await env.DB.prepare(
    "SELECT id, username, email, enabled, expire_at, disabled_reason FROM users WHERE expire_at IS NOT NULL OR disabled_reason IS NOT NULL",
  ).all<any>();
  for (const u of users.results ?? []) {
    const expireAt = u.expire_at == null ? null : Number(u.expire_at);
    if (expireAt != null && expireAt <= now && u.enabled === 1) {
      await env.DB.prepare(
        "UPDATE users SET enabled = 0, disabled_reason = 'expired', session_version = session_version + 1, updated_at = ? WHERE id = ?",
      )
        .bind(now, u.id)
        .run();
      if (mailEnabled && u.email) {
        const id = await enqueueNotification(env, {
          eventKey: `user:${u.id}:autodisable:expired:${dayKey(now)}`,
          kind: "auto_disable",
          userId: u.id,
          payload: { username: u.username, reason: "expired", email: u.email },
        });
        if (id) created++;
      }
      continue;
    }

    if (
      autoReenable &&
      u.enabled === 0 &&
      u.disabled_reason === "expired" &&
      (expireAt == null || expireAt > now)
    ) {
      await env.DB.prepare(
        "UPDATE users SET enabled = 1, disabled_reason = NULL, session_version = session_version + 1, updated_at = ? WHERE id = ?",
      )
        .bind(now, u.id)
        .run();
      reenabled++;
      if (mailEnabled && u.email) {
        const id = await enqueueNotification(env, {
          eventKey: `user:${u.id}:autoenable:${dayKey(now)}`,
          kind: "auto_enable",
          userId: u.id,
          payload: { username: u.username, reason: "expired_cleared", email: u.email },
        });
        if (id) created++;
      }
    }

    if (expireAt != null && mailEnabled && u.email) {
      for (const d of remindDays) {
        const windowStart = expireAt - d * 86400000;
        const windowEnd = windowStart + 86400000;
        if (now >= windowStart && now < windowEnd) {
          const id = await enqueueNotification(env, {
            eventKey: `user:${u.id}:expire:${d}d:${dayKey(expireAt)}`,
            kind: "user_expire",
            userId: u.id,
            payload: { username: u.username, days: d, expireAt, email: u.email },
          });
          if (id) created++;
        }
      }
    }
  }

  const subs = await env.DB.prepare(
    `SELECT s.*, u.email AS user_email, u.username AS username, u.enabled AS user_enabled
     FROM subscriptions s JOIN users u ON u.id = s.user_id`
  ).all<any>();
  for (const s of subs.results ?? []) {
    const expireAt = s.expire_at == null ? null : Number(s.expire_at);
    if (expireAt != null && expireAt <= now && s.enabled === 1) {
      await env.DB.prepare(
        "UPDATE subscriptions SET enabled = 0, disabled_reason = 'expired', revision = revision + 1, updated_at = ? WHERE id = ?",
      )
        .bind(now, s.id)
        .run();
      if (mailEnabled && s.user_email) {
        const id = await enqueueNotification(env, {
          eventKey: `sub:${s.id}:autodisable:expired:${dayKey(now)}`,
          kind: "auto_disable",
          userId: s.user_id,
          subscriptionId: s.id,
          payload: { name: s.name, reason: "expired", email: s.user_email },
        });
        if (id) created++;
      }
    } else if (expireAt != null && mailEnabled && s.user_email) {
      for (const d of remindDays) {
        const windowStart = expireAt - d * 86400000;
        const windowEnd = windowStart + 86400000;
        if (now >= windowStart && now < windowEnd) {
          const id = await enqueueNotification(env, {
            eventKey: `sub:${s.id}:expire:${d}d:${dayKey(expireAt)}`,
            kind: "sub_expire",
            userId: s.user_id,
            subscriptionId: s.id,
            payload: { name: s.name, days: d, expireAt, email: s.user_email },
          });
          if (id) created++;
        }
      }
    }

    if (s.usage_mode === "manual" && s.traffic_limit_bytes != null && Number(s.traffic_limit_bytes) > 0) {
      const used = Number(s.manual_used_bytes || 0);
      const limit = Number(s.traffic_limit_bytes);
      const pct = Math.floor((used / limit) * 100);
      if (mailEnabled && s.user_email) {
        for (const threshold of [warnPercent, 95, 100]) {
          if (pct >= threshold) {
            const id = await enqueueNotification(env, {
              eventKey: `sub:${s.id}:traffic:${threshold}:${dayKey(now)}`,
              kind: "traffic_warn",
              userId: s.user_id,
              subscriptionId: s.id,
              payload: {
                name: s.name,
                percent: threshold,
                used,
                limit,
                email: s.user_email,
              },
            });
            if (id) created++;
          }
        }
      }
      if (used >= limit && s.enabled === 1) {
        await env.DB.prepare(
          "UPDATE subscriptions SET enabled = 0, disabled_reason = 'traffic_exceeded', revision = revision + 1, updated_at = ? WHERE id = ?",
        )
          .bind(now, s.id)
          .run();
        if (mailEnabled && s.user_email) {
          const id = await enqueueNotification(env, {
            eventKey: `sub:${s.id}:autodisable:traffic:${dayKey(now)}`,
            kind: "auto_disable",
            userId: s.user_id,
            subscriptionId: s.id,
            payload: { name: s.name, reason: "traffic_exceeded", email: s.user_email },
          });
          if (id) created++;
        }
      }
    }

    if (s.usage_mode === "upstream_exclusive" && s.exclusive_source_id) {
      const usage = await env.DB.prepare(
        `SELECT upload_bytes, download_bytes, total_bytes, expire_at
         FROM source_usage_snapshots WHERE source_id = ? ORDER BY captured_at DESC LIMIT 1`
      )
        .bind(s.exclusive_source_id)
        .first<any>();
      if (usage?.expire_at != null) {
        const srcExpire = Number(usage.expire_at);
        if (srcExpire <= now && s.enabled === 1) {
          await env.DB.prepare(
            "UPDATE subscriptions SET enabled = 0, disabled_reason = 'expired', revision = revision + 1, updated_at = ? WHERE id = ?",
          )
            .bind(now, s.id)
            .run();
        } else if (mailEnabled && s.user_email) {
          for (const d of remindDays) {
            const windowStart = srcExpire - d * 86400000;
            const windowEnd = windowStart + 86400000;
            if (now >= windowStart && now < windowEnd) {
              const id = await enqueueNotification(env, {
                eventKey: `source:${s.exclusive_source_id}:expire:${d}d:${dayKey(srcExpire)}:sub:${s.id}`,
                kind: "source_expire",
                userId: s.user_id,
                subscriptionId: s.id,
                payload: { name: s.name, days: d, expireAt: srcExpire, email: s.user_email },
              });
              if (id) created++;
            }
          }
        }
      }
      if (s.traffic_limit_bytes != null && usage) {
        const used = usedFromUsage(usage);
        const limit = Number(s.traffic_limit_bytes);
        if (limit > 0) {
          const pct = Math.floor((used / limit) * 100);
          if (mailEnabled && s.user_email) {
            for (const threshold of [warnPercent, 95, 100]) {
              if (pct >= threshold) {
                const id = await enqueueNotification(env, {
                  eventKey: `sub:${s.id}:traffic:${threshold}:${dayKey(now)}`,
                  kind: "traffic_warn",
                  userId: s.user_id,
                  subscriptionId: s.id,
                  payload: { name: s.name, percent: threshold, used, limit, email: s.user_email },
                });
                if (id) created++;
              }
            }
          }
          if (used >= limit && s.enabled === 1) {
            await env.DB.prepare(
              "UPDATE subscriptions SET enabled = 0, disabled_reason = 'traffic_exceeded', revision = revision + 1, updated_at = ? WHERE id = ?",
            )
              .bind(now, s.id)
              .run();
          }
        }
      }
    }

    if (autoReenable && s.enabled === 0 && ["expired", "traffic_exceeded"].includes(String(s.disabled_reason || ""))) {
      let canEnable = true;
      if (expireAt != null && expireAt <= now) canEnable = false;
      if (s.usage_mode === "manual" && s.traffic_limit_bytes != null) {
        if (Number(s.manual_used_bytes || 0) >= Number(s.traffic_limit_bytes)) canEnable = false;
      }
      if (s.usage_mode === "upstream_exclusive" && s.exclusive_source_id && s.traffic_limit_bytes != null) {
        const usage = await env.DB.prepare(
          `SELECT upload_bytes, download_bytes, total_bytes, expire_at
           FROM source_usage_snapshots WHERE source_id = ? ORDER BY captured_at DESC LIMIT 1`
        )
          .bind(s.exclusive_source_id)
          .first<any>();
        if (usage?.expire_at != null && Number(usage.expire_at) <= now) canEnable = false;
        if (usage && Number(s.traffic_limit_bytes) > 0 && usedFromUsage(usage) >= Number(s.traffic_limit_bytes)) {
          canEnable = false;
        }
      }
      if (canEnable) {
        await env.DB.prepare(
          "UPDATE subscriptions SET enabled = 1, disabled_reason = NULL, revision = revision + 1, updated_at = ? WHERE id = ?",
        )
          .bind(now, s.id)
          .run();
        reenabled++;
        if (mailEnabled && s.user_email) {
          const id = await enqueueNotification(env, {
            eventKey: `sub:${s.id}:autoenable:${dayKey(now)}`,
            kind: "auto_enable",
            userId: s.user_id,
            subscriptionId: s.id,
            payload: { name: s.name, reason: "conditions_cleared", email: s.user_email },
          });
          if (id) created++;
        }
      }
    }
  }

  const sources = await env.DB.prepare(
    "SELECT id, name, failure_count, enabled FROM sources WHERE kind = 'remote' AND failure_count >= 5",
  ).all<any>();
  const admins = await env.DB.prepare(
    "SELECT id, email FROM users WHERE role = 'admin' AND email IS NOT NULL AND enabled = 1",
  ).all<any>();
  if (mailEnabled) {
    for (const src of sources.results ?? []) {
      for (const admin of admins.results ?? []) {
        const id = await enqueueNotification(env, {
          eventKey: `source:${src.id}:refresh_fail:5:${dayKey(now)}:admin:${admin.id}`,
          kind: "source_refresh_fail",
          userId: admin.id,
          payload: {
            sourceId: src.id,
            name: src.name,
            failureCount: src.failure_count,
            email: admin.email,
          },
        });
        if (id) created++;
      }
    }
  }

  return { created, reenabled };
}

export async function aggregateAccessLogs(env: Env): Promise<void> {
  const now = nowMs();
  const day = new Date(now - 86400000).toISOString().slice(0, 10);
  const rows = await env.DB.prepare(
    `SELECT subscription_id,
            COUNT(*) AS requests,
            COALESCE(SUM(response_bytes), 0) AS response_bytes,
            COUNT(DISTINCT device_fingerprint) AS unique_devices
     FROM subscription_access_logs
     WHERE created_at >= ? AND created_at < ?
     GROUP BY subscription_id`
  )
    .bind(Date.parse(day + "T00:00:00.000Z"), Date.parse(day + "T00:00:00.000Z") + 86400000)
    .all<any>();
  for (const r of rows.results ?? []) {
    await env.DB.prepare(
      `INSERT INTO subscription_access_daily
        (subscription_id, day, requests, response_bytes, unique_devices)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(subscription_id, day) DO UPDATE SET
        requests = excluded.requests,
        response_bytes = excluded.response_bytes,
        unique_devices = excluded.unique_devices`
    )
      .bind(r.subscription_id, day, r.requests, r.response_bytes, r.unique_devices)
      .run();
  }
}

function renderMail(kind: string, payload: Record<string, any>, site: string, supportUrl: string): {
  subject: string;
  text: string;
  html: string;
} {
  const safeSupport = safeSupportHref(supportUrl);
  const footer = safeSupport ? `\n支持：${safeSupport}` : "";
  const footerHtml = safeSupport
    ? `<p style="color:#6b7280;font-size:12px">支持：<a href="${escHtml(safeSupport)}">${escHtml(safeSupport)}</a></p>`
    : "";
  if (kind === "user_expire" || kind === "sub_expire" || kind === "source_expire") {
    const days = payload.days;
    const name = payload.username || payload.name || "账号";
    const when = payload.expireAt ? new Date(payload.expireAt).toISOString() : "";
    const subject = `[${site}] ${name} 将在 ${days} 天后到期`;
    const text = `${name} 将在 ${days} 天后到期。到期时间：${when}${footer}`;
    return {
      subject,
      text,
      html: `<div style="font-family:system-ui,sans-serif"><h2 style="margin:0 0 12px">${escHtml(site)}</h2><p>${escHtml(name)} 将在 <b>${escHtml(days)}</b> 天后到期。</p><p>到期时间：${escHtml(when)}</p>${footerHtml}</div>`,
    };
  }
  if (kind === "traffic_warn") {
    const subject = `[${site}] ${payload.name || "订阅"} 流量已达 ${payload.percent}%`;
    const text = `${payload.name || "订阅"} 已使用 ${payload.used}/${payload.limit} 字节（${payload.percent}%）。${footer}`;
    return {
      subject,
      text,
      html: `<div style="font-family:system-ui,sans-serif"><h2 style="margin:0 0 12px">${escHtml(site)}</h2><p>${escHtml(payload.name || "订阅")} 已使用 <b>${escHtml(payload.percent)}%</b>。</p><p>${escHtml(payload.used)} / ${escHtml(payload.limit)} 字节</p>${footerHtml}</div>`,
    };
  }
  if (kind === "auto_disable") {
    const subject = `[${site}] ${payload.name || payload.username || "资源"} 已自动停用`;
    const text = `原因：${payload.reason}${footer}`;
    return {
      subject,
      text,
      html: `<div style="font-family:system-ui,sans-serif"><h2 style="margin:0 0 12px">${escHtml(site)}</h2><p>已自动停用。</p><p>原因：${escHtml(payload.reason)}</p>${footerHtml}</div>`,
    };
  }
  if (kind === "auto_enable") {
    const subject = `[${site}] ${payload.name || payload.username || "资源"} 已自动恢复`;
    const text = `原因：${payload.reason || "条件已解除"}${footer}`;
    return {
      subject,
      text,
      html: `<div style="font-family:system-ui,sans-serif"><h2 style="margin:0 0 12px">${escHtml(site)}</h2><p>已自动恢复。</p><p>原因：${escHtml(payload.reason || "条件已解除")}</p>${footerHtml}</div>`,
    };
  }
  if (kind === "password_reset") {
    const resetUrl = safeResetHref(payload.resetUrl);
    const subject = `[${site}] 密码重置`;
    const text = resetUrl ? `点击链接重置密码：${resetUrl}${footer}` : `请使用面板重置密码。${footer}`;
    return {
      subject,
      text,
      html: resetUrl
        ? `<div style="font-family:system-ui,sans-serif"><h2 style="margin:0 0 12px">${escHtml(site)}</h2><p><a href="${escHtml(resetUrl)}">重置密码</a></p>${footerHtml}</div>`
        : `<div style="font-family:system-ui,sans-serif"><h2 style="margin:0 0 12px">${escHtml(site)}</h2><p>请使用面板重置密码。</p>${footerHtml}</div>`,
    };
  }
  if (kind === "source_refresh_fail") {
    const subject = `[${site}] 远程源刷新失败：${payload.name || payload.sourceId}`;
    const text = `源 #${payload.sourceId} ${payload.name || ""} 连续失败 ${payload.failureCount} 次。${footer}`;
    return {
      subject,
      text,
      html: `<div style="font-family:system-ui,sans-serif"><h2 style="margin:0 0 12px">${escHtml(site)}</h2><p>源 #${escHtml(payload.sourceId)} ${escHtml(payload.name || "")} 连续失败 <b>${escHtml(payload.failureCount)}</b> 次。</p>${footerHtml}</div>`,
    };
  }
  const subject = `[${site}] 通知`;
  const text = JSON.stringify(payload) + footer;
  return {
    subject,
    text,
    html: `<div style="font-family:system-ui,sans-serif"><h2>${escHtml(site)}</h2><pre>${escHtml(JSON.stringify(payload, null, 2))}</pre>${footerHtml}</div>`,
  };
}

export async function sendNotification(env: Env, notificationId: number): Promise<void> {
  const row = await env.DB.prepare("SELECT * FROM notifications WHERE id = ? LIMIT 1")
    .bind(notificationId)
    .first<any>();
  if (!row) return;
  if (row.status === "sent") return;

  const mailEnabled = await getSettingBool(env, "mail_enabled", true);
  const now = nowMs();
  await env.DB.prepare(
    "UPDATE notifications SET status = 'sending', attempts = attempts + 1 WHERE id = ?",
  )
    .bind(notificationId)
    .run();

  const payload = JSON.parse(row.payload_json || "{}") as Record<string, any>;
  if (row.kind === "password_reset" && payload.resetTokenEnc && !payload.resetUrl) {
    try {
      const raw = await decryptSecret(env, String(payload.resetTokenEnc));
      const origin = String(payload.origin || "").replace(/\/$/, "");
      if (raw && (origin.startsWith("https://") || origin.startsWith("http://"))) {
        payload.resetUrl = origin + "/?reset_token=" + encodeURIComponent(raw);
      }
    } catch {
      /* leave without url */
    }
  }
  const to = String(payload.email || "");
  if (!to) {
    await env.DB.prepare(
      "UPDATE notifications SET status = 'failed', last_error = ? WHERE id = ?",
    )
      .bind("missing email", notificationId)
      .run();
    return;
  }

  if (!mailEnabled) {
    await env.DB.prepare(
      "UPDATE notifications SET status = 'failed', last_error = ? WHERE id = ?",
    )
      .bind("mail_disabled", notificationId)
      .run();
    return;
  }

  const site = (await getSettingString(env, "site_name", env.SITE_NAME || "Sub Panel")) || "Sub Panel";
  const supportUrl = await getSettingString(env, "support_url", "");
  const mail = renderMail(row.kind, payload, site, supportUrl);
  const from = (await getSettingString(env, "mail_from", "")) || "noreply@example.com";

  try {
    const host = (await getSettingString(env, "smtp_host", "")).trim();
    const port = Number(await getSettingNumber(env, "smtp_port", 465));
    const secureRaw = await getSettingRaw(env, "smtp_secure");
    const secure = secureRaw == null ? port === 465 : await getSettingBool(env, "smtp_secure", port === 465);
    const user = (await getSettingString(env, "smtp_user", "")).trim();
    const passRaw = (await getSettingString(env, "smtp_pass", "")).trim();
    const pass = (await decryptSecret(env, passRaw)).trim();
    if (!host) throw new Error("SMTP 未配置：请在设置中填写 smtp_host");
    await sendSmtp(
      { host, port: Number.isFinite(port) ? port : 465, secure, user: user || undefined, pass: pass || undefined, from },
      { to, subject: mail.subject, text: mail.text, html: mail.html, fromName: site },
    );
    // scrub one-shot secrets from payload after successful send
    if (row.kind === "password_reset") {
      const scrubbed = { email: payload.email, tokenPrefix: payload.tokenPrefix || null, sent: true };
      await env.DB.prepare(
        "UPDATE notifications SET status = 'sent', sent_at = ?, last_error = NULL, payload_json = ? WHERE id = ?",
      )
        .bind(now, JSON.stringify(scrubbed), notificationId)
        .run();
    } else {
      await env.DB.prepare(
        "UPDATE notifications SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?",
      )
        .bind(now, notificationId)
        .run();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare(
      "UPDATE notifications SET status = 'failed', last_error = ?, next_attempt_at = ? WHERE id = ?",
    )
      .bind(message, now + 15 * 60 * 1000, notificationId)
      .run();
    throw err;
  }
}
