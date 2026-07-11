export async function checkLoginRateLimit(
  db: D1Database,
  key: string,
  now: number,
  maxFailures = 8,
  windowMs = 15 * 60 * 1000,
  lockMs = 15 * 60 * 1000,
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const row = await db
    .prepare('SELECT key, failures, window_started_at, locked_until FROM login_rate_limits WHERE key = ?')
    .bind(key)
    .first<{ key: string; failures: number; window_started_at: number; locked_until: number | null }>();

  if (!row) return { allowed: true };
  if (row.locked_until && row.locked_until > now) {
    return { allowed: false, retryAfterMs: row.locked_until - now };
  }
  if (now - row.window_started_at > windowMs) return { allowed: true };
  if (row.failures >= maxFailures) {
    return { allowed: false, retryAfterMs: Math.max(0, (row.locked_until ?? now + lockMs) - now) };
  }
  return { allowed: true };
}

export async function recordLoginFailure(
  db: D1Database,
  key: string,
  now: number,
  maxFailures = 8,
  windowMs = 15 * 60 * 1000,
  lockMs = 15 * 60 * 1000,
): Promise<void> {
  const row = await db
    .prepare('SELECT key, failures, window_started_at, locked_until FROM login_rate_limits WHERE key = ?')
    .bind(key)
    .first<{ key: string; failures: number; window_started_at: number; locked_until: number | null }>();

  if (!row || now - row.window_started_at > windowMs) {
    await db
      .prepare(
        `INSERT INTO login_rate_limits (key, failures, window_started_at, locked_until)
         VALUES (?, 1, ?, NULL)
         ON CONFLICT(key) DO UPDATE SET failures = 1, window_started_at = excluded.window_started_at, locked_until = NULL`,
      )
      .bind(key, now)
      .run();
    return;
  }

  const failures = row.failures + 1;
  const lockedUntil = failures >= maxFailures ? now + lockMs : null;
  await db
    .prepare('UPDATE login_rate_limits SET failures = ?, locked_until = ? WHERE key = ?')
    .bind(failures, lockedUntil, key)
    .run();
}

export async function clearLoginFailures(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM login_rate_limits WHERE key = ?').bind(key).run();
}
