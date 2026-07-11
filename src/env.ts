export type Role = "admin" | "user";

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  SITE_NAME: string;
  PASSWORD_ITERATIONS: string;
  SESSION_IDLE_MS: string;
  SESSION_ABSOLUTE_MS: string;
  DEVICE_WINDOW_MS: string;
  ACCESS_LOG_RETENTION_DAYS: string;
  /** Optional. If missing, a key is auto-created in D1 settings. */
  CREDENTIALS_KEY?: string;
}

export interface AppVars {
  siteName: string;
  passwordIterations: number;
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  deviceWindowMs: number;
  accessLogRetentionDays: number;
}

export function readVars(env: Env): AppVars {
  return {
    siteName: env.SITE_NAME || "Sub Panel",
    passwordIterations: Number(env.PASSWORD_ITERATIONS || 100000),
    sessionIdleMs: Number(env.SESSION_IDLE_MS || 7 * 24 * 3600 * 1000),
    sessionAbsoluteMs: Number(env.SESSION_ABSOLUTE_MS || 30 * 24 * 3600 * 1000),
    deviceWindowMs: Number(env.DEVICE_WINDOW_MS || 7 * 24 * 3600 * 1000),
    accessLogRetentionDays: Number(env.ACCESS_LOG_RETENTION_DAYS || 7),
  };
}
