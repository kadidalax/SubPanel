import type { Env } from "../env.ts";
import type { JobMessage } from "./types.ts";
import { refreshSource } from "../services/sources.ts";
import { sendNotification } from "../services/notifications.ts";
import { nowMs } from "../util/time.ts";
import { getSettingNumber } from "../services/settings.ts";

/** Run job inline (no Cloudflare Queue). */
export async function enqueueJob(env: Env, message: JobMessage): Promise<void> {
  const now = nowMs();
  await env.DB
    .prepare(
      "INSERT OR IGNORE INTO job_runs (job_key, kind, status, attempts, created_at) VALUES (?, ?, 'pending', 0, ?)",
    )
    .bind(message.jobKey, message.kind, now)
    .run();
  await runJob(env, message);
}

export async function runJob(env: Env, body: JobMessage): Promise<void> {
  const now = nowMs();
  const existing = await env.DB.prepare("SELECT status FROM job_runs WHERE job_key = ? LIMIT 1")
    .bind(body.jobKey)
    .first<{ status: string }>();
  if (existing?.status === "succeeded") return;

  await env.DB
    .prepare(
      "UPDATE job_runs SET status = 'running', attempts = attempts + 1, started_at = COALESCE(started_at, ?), last_error = NULL WHERE job_key = ?",
    )
    .bind(now, body.jobKey)
    .run();

  try {
    if (body.kind === "refresh_source") {
      await refreshSource(env, body.sourceId);
    } else if (body.kind === "send_notification") {
      await sendNotification(env, body.notificationId);
    } else if (body.kind === "cleanup_logs") {
      let days = await getSettingNumber(env, "access_log_retention_days", 7);
      if (!Number.isFinite(days) || days < 1) days = 7;
      if (days > 90) days = 90;
      const cutoff = nowMs() - days * 24 * 3600 * 1000;
      await env.DB.prepare("DELETE FROM subscription_access_logs WHERE created_at < ?").bind(cutoff).run();
      await env.DB.prepare("DELETE FROM audit_logs WHERE created_at < ?").bind(cutoff).run();
      await env.DB.prepare("DELETE FROM notifications WHERE created_at < ?").bind(cutoff).run();
      await env.DB.prepare("DELETE FROM job_runs WHERE created_at < ?").bind(cutoff).run();
      await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ? OR idle_expires_at < ?")
        .bind(nowMs(), nowMs())
        .run();
      await env.DB.prepare("DELETE FROM password_reset_tokens WHERE expires_at < ? OR used_at IS NOT NULL")
        .bind(nowMs() - 7 * 86400000)
        .run();
    }

    await env.DB
      .prepare("UPDATE job_runs SET status = 'succeeded', finished_at = ? WHERE job_key = ?")
      .bind(nowMs(), body.jobKey)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB
      .prepare("UPDATE job_runs SET status = 'failed', finished_at = ?, last_error = ? WHERE job_key = ?")
      .bind(nowMs(), message, body.jobKey)
      .run();
    throw err;
  }
}
