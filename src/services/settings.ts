import type { Env } from "../env.ts";

export async function getSettingRaw(env: Env, key: string): Promise<unknown | null> {
  const row = await env.DB.prepare("SELECT value_json FROM settings WHERE key = ? LIMIT 1")
    .bind(key)
    .first<{ value_json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return row.value_json;
  }
}

export async function getSettingNumber(env: Env, key: string, fallback: number): Promise<number> {
  const v = await getSettingRaw(env, key);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function getSettingBool(env: Env, key: string, fallback: boolean): Promise<boolean> {
  const v = await getSettingRaw(env, key);
  if (v == null) return fallback;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

export async function getSettingString(env: Env, key: string, fallback = ""): Promise<string> {
  const v = await getSettingRaw(env, key);
  if (v == null) return fallback;
  return String(v);
}

/** Accept [7,3,1] or "7,3,1" or single number. */
export async function getExpireRemindDays(env: Env, fallback: number[] = [7, 3, 1]): Promise<number[]> {
  const v = await getSettingRaw(env, "expire_remind_days");
  if (v == null) return fallback;
  if (Array.isArray(v)) {
    const days = v.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    return days.length ? days : fallback;
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return [v];
  const days = String(v)
    .split(/[,\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return days.length ? days : fallback;
}

export async function putSetting(env: Env, key: string, value: unknown, now: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
  )
    .bind(key, JSON.stringify(value), now)
    .run();
}
