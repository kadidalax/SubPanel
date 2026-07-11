import type { SessionRow, UserRow } from './types.ts';

export async function createSession(
  db: D1Database,
  input: {
    userId: number;
    tokenHash: string;
    sessionVersion: number;
    expiresAt: number;
    idleExpiresAt: number;
    now: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions
       (user_id, token_hash, session_version, expires_at, idle_expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.userId,
      input.tokenHash,
      input.sessionVersion,
      input.expiresAt,
      input.idleExpiresAt,
      input.now,
      input.now,
    )
    .run();
}

export async function deleteSessionByTokenHash(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function deleteSessionsForUser(db: D1Database, userId: number): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

export async function findSessionUser(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<{ session: SessionRow; user: UserRow } | null> {
  const row = await db
    .prepare(
      `SELECT
         s.id AS s_id, s.user_id AS s_user_id, s.token_hash AS s_token_hash,
         s.session_version AS s_session_version, s.expires_at AS s_expires_at,
         s.idle_expires_at AS s_idle_expires_at, s.created_at AS s_created_at,
         s.last_seen_at AS s_last_seen_at,
         u.id AS u_id, u.username AS u_username, u.email AS u_email,
         u.password_hash AS u_password_hash, u.role AS u_role, u.enabled AS u_enabled,
         u.expire_at AS u_expire_at, u.session_version AS u_session_version,
         u.created_at AS u_created_at, u.updated_at AS u_updated_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<Record<string, unknown>>();
  if (!row) return null;

  const session: SessionRow = {
    id: Number(row.s_id),
    user_id: Number(row.s_user_id),
    token_hash: String(row.s_token_hash),
    session_version: Number(row.s_session_version),
    expires_at: Number(row.s_expires_at),
    idle_expires_at: Number(row.s_idle_expires_at),
    created_at: Number(row.s_created_at),
    last_seen_at: Number(row.s_last_seen_at),
  };
  const user: UserRow = {
    id: Number(row.u_id),
    username: String(row.u_username),
    email: row.u_email == null ? null : String(row.u_email),
    password_hash: String(row.u_password_hash),
    role: row.u_role as UserRow['role'],
    enabled: Number(row.u_enabled),
    expire_at: row.u_expire_at == null ? null : Number(row.u_expire_at),
    session_version: Number(row.u_session_version),
    created_at: Number(row.u_created_at),
    updated_at: Number(row.u_updated_at),
  };

  if (session.expires_at < now || session.idle_expires_at < now) {
    await deleteSessionByTokenHash(db, tokenHash);
    return null;
  }
  if (session.session_version !== user.session_version || user.enabled !== 1) {
    await deleteSessionByTokenHash(db, tokenHash);
    return null;
  }
  return { session, user };
}

export async function touchSession(
  db: D1Database,
  sessionId: number,
  idleExpiresAt: number,
  now: number,
): Promise<void> {
  await db
    .prepare('UPDATE sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?')
    .bind(now, idleExpiresAt, sessionId)
    .run();
}
