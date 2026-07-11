import type { UserRole, UserRow } from './types.ts';

export async function findUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 1')
    .bind(username)
    .first<UserRow>();
}

export async function findUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').bind(id).first<UserRow>();
}

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE LIMIT 1')
    .bind(email)
    .first<UserRow>();
}

export async function createUser(
  db: D1Database,
  input: {
    username: string;
    email?: string | null;
    passwordHash: string;
    role: UserRole;
    now: number;
    expireAt?: number | null;
  },
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO users (username, email, password_hash, role, enabled, expire_at, session_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, 0, ?, ?)`,
    )
    .bind(
      input.username.toLowerCase(),
      input.email ?? null,
      input.passwordHash,
      input.role,
      input.expireAt ?? null,
      input.now,
      input.now,
    )
    .run();
  return Number(res.meta.last_row_id);
}

export async function updatePassword(
  db: D1Database,
  userId: number,
  passwordHash: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users
       SET password_hash = ?, session_version = session_version + 1, updated_at = ?
       WHERE id = ?`,
    )
    .bind(passwordHash, now, userId)
    .run();
}

export async function bumpSessionVersion(db: D1Database, userId: number, now: number): Promise<void> {
  await db
    .prepare('UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE id = ?')
    .bind(now, userId)
    .run();
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const res = await db.prepare('SELECT * FROM users ORDER BY id ASC').all<UserRow>();
  return res.results ?? [];
}

export async function setUserEnabled(
  db: D1Database,
  userId: number,
  enabled: boolean,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users
       SET enabled = ?, session_version = session_version + 1, updated_at = ?
       WHERE id = ?`,
    )
    .bind(enabled ? 1 : 0, now, userId)
    .run();
}

export async function updateUserRole(
  db: D1Database,
  userId: number,
  role: UserRole,
  now: number,
): Promise<void> {
  await db
    .prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
    .bind(role, now, userId)
    .run();
}
