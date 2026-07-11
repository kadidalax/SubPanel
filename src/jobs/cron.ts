import type { Env } from "../env.ts";
import { enqueueJob } from "./queue.ts";
import { nowMs } from "../util/time.ts";
import { aggregateAccessLogs, scanLifecycleEvents } from "../services/notifications.ts";
import { getSettingNumber } from "../services/settings.ts";

// Single every-5-min cron: free plan allows only 5 cron triggers account-wide.
export async function handleScheduled(_event: ScheduledEvent, env: Env): Promise<void> {
  const now = nowMs();
  const minute = Math.floor(now / 60000);
  const d = new Date(now);
  const hour = d.getUTCHours();
  const min = d.getUTCMinutes();

  // every 5 min: remote source refresh
  if (minute % 5 === 0) {
    const batchLimit = Math.max(1, Math.floor(await getSettingNumber(env, "refresh_batch_limit", 10)));
    const sources = await env.DB
      .prepare(
        `SELECT id FROM sources
         WHERE enabled = 1 AND kind = 'remote'
           AND failure_count < 5
           AND (next_refresh_at IS NULL OR next_refresh_at <= ?)
         ORDER BY id ASC LIMIT ${batchLimit}`,
      )
      .bind(now)
      .all<{ id: number }>();
    for (const row of sources.results ?? []) {
      await enqueueJob(env, {
        kind: "refresh_source",
        sourceId: row.id,
        jobKey: "refresh_source:" + row.id + ":" + Math.floor(now / 300000),
      });
    }
  }

  // every 15 min: lifecycle mail scan
  if (minute % 15 === 0) {
    await scanLifecycleEvents(env);
  }

  // top of each hour: access log aggregate
  if (min === 0) {
    await aggregateAccessLogs(env);
  }

  // 03:20 UTC daily cleanup
  if (hour === 3 && min === 20) {
    await enqueueJob(env, {
      kind: "cleanup_logs",
      jobKey: "cleanup_logs:" + new Date(now).toISOString().slice(0, 10),
    });
  }
}
