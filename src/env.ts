export type Role = "admin" | "user";

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  SITE_NAME: string;
  /** Optional. If missing, a key is auto-created in D1 settings. */
  CREDENTIALS_KEY?: string;
}

export interface AppVars {
  siteName: string;
  passwordIterations: number;
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  deviceWindowMs: number;
  sessionTouchMinMs: number;
}

export function readVars(env: Env): AppVars {
  return {
    siteName: env.SITE_NAME || "Sub Panel",
    passwordIterations: 100_000,
    sessionIdleMs: 86_400_000,
    sessionAbsoluteMs: 604_800_000,
    deviceWindowMs: 604_800_000,
    sessionTouchMinMs: 60_000,
  };
}
