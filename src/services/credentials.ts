import type { Env } from "../env.ts";
import { decryptText, encryptText } from "../crypto/secretbox.ts";

/**
 * Shared AES key material for remote source secrets + SMTP password.
 * Prefer env CREDENTIALS_KEY (>=16). D1 fallback only for local/dev.
 */
export async function credentialsKey(env: Env): Promise<string> {
  const fromEnv = (env.CREDENTIALS_KEY || "").trim();
  if (fromEnv.length >= 16) return fromEnv;

  // production should set Secret; still allow D1 for existing installs / local
  const row = await env.DB.prepare("SELECT value_json FROM settings WHERE key = ? LIMIT 1")
    .bind("credentials_key")
    .first<{ value_json: string }>();
  if (row?.value_json) {
    try {
      const v = JSON.parse(row.value_json);
      if (typeof v === "string" && v.length >= 16) return v;
      if (String(row.value_json).length >= 16) return String(row.value_json).replace(/^"|"$/g, "");
    } catch {
      if (row.value_json.length >= 16) return row.value_json;
    }
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
  )
    .bind("credentials_key", JSON.stringify(key), now)
    .run();
  return key;
}

export async function encryptSecret(env: Env, plaintext: string): Promise<string> {
  return encryptText(await credentialsKey(env), plaintext);
}

export async function decryptSecret(env: Env, packed: string): Promise<string> {
  if (!packed) return "";
  if (!packed.startsWith("v1.")) {
    // legacy plaintext — still decrypt path returns as-is; callers should re-encrypt on write
    return packed;
  }
  return decryptText(await credentialsKey(env), packed);
}

export function isEncryptedSecret(packed: string): boolean {
  return typeof packed === "string" && packed.startsWith("v1.");
}
