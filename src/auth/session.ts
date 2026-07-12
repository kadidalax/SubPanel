import type { Env } from '../env.ts';
import { readVars } from '../env.ts';
import { sha256Text } from '../crypto/hash.ts';
import {
  createSession,
  deleteSessionByTokenHash,
  findSessionUser,
  touchSession,
} from '../db/sessions.ts';
import type { UserRow } from '../db/types.ts';
import { randomToken } from '../util/ids.ts';
import { nowMs } from '../util/time.ts';

const COOKIE_NAME = 'sp_session';

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      // invalid percent-encoding — skip cookie
    }
  }
  return out;
}

export function sessionCookie(token: string, maxAgeSec: number, secure: boolean): string {
  const securePart = secure ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly${securePart}; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie(secure: boolean): string {
  const securePart = secure ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly${securePart}; SameSite=Strict; Max-Age=0`;
}

export async function issueSession(
  env: Env,
  user: UserRow,
  secure = true,
): Promise<{ token: string; cookie: string }> {
  const vars = readVars(env);
  const now = nowMs();
  const token = randomToken(32);
  const tokenHash = await sha256Text(token);
  await createSession(env.DB, {
    userId: user.id,
    tokenHash,
    sessionVersion: user.session_version,
    expiresAt: now + vars.sessionAbsoluteMs,
    idleExpiresAt: now + vars.sessionIdleMs,
    now,
  });
  return {
    token,
    cookie: sessionCookie(token, Math.floor(vars.sessionAbsoluteMs / 1000), secure),
  };
}

export async function destroySession(env: Env, request: Request): Promise<void> {
  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies[COOKIE_NAME];
  if (!token) return;
  const tokenHash = await sha256Text(token);
  await deleteSessionByTokenHash(env.DB, tokenHash);
}

export async function requireUser(
  env: Env,
  request: Request,
): Promise<{ user: UserRow; sessionId: number } | null> {
  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const tokenHash = await sha256Text(token);
  const now = nowMs();
  const found = await findSessionUser(env.DB, tokenHash, now);
  if (!found) return null;
  const vars = readVars(env);
  if (now - found.session.last_seen_at >= vars.sessionTouchMinMs) {
    await touchSession(env.DB, found.session.id, now + vars.sessionIdleMs, now);
  }
  return { user: found.user, sessionId: found.session.id };
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    enabled: user.enabled === 1,
    expireAt: user.expire_at,
    createdAt: user.created_at,
  };
}
