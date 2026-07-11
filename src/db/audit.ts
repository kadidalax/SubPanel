export async function writeAudit(
  db: D1Database,
  input: {
    actorUserId?: number | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
    requestId?: string | null;
    now: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs
       (actor_user_id, action, target_type, target_id, before_json, after_json, ip, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.actorUserId ?? null,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.before == null ? null : JSON.stringify(input.before),
      input.after == null ? null : JSON.stringify(input.after),
      input.ip ?? null,
      input.requestId ?? null,
      input.now,
    )
    .run();
}
