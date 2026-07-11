/** Allow only https (and mailto for support). Blocks javascript:/data:/etc. */
export function safeHttpsHref(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol === "https:") return u.toString();
    return "";
  } catch {
    return "";
  }
}

/** Password reset / panel links: http or https only (local + prod). */
export function safeResetHref(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
    return "";
  } catch {
    return "";
  }
}

export function safeSupportHref(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "mailto:") return u.toString();
    return "";
  } catch {
    return "";
  }
}
