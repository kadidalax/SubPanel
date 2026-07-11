export function fmtTime(ms?: number | null) {
  if (ms == null) return "—";
  return new Date(ms).toLocaleString();
}

export function fmtBytes(n?: number | null) {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function badgeClass(enabled: boolean | number | string) {
  if (enabled === true || enabled === 1 || enabled === "ok" || enabled === "healthy") return "badge ok";
  if (enabled === "warn" || enabled === "degraded" || enabled === "paused") return "badge warn";
  if (enabled === false || enabled === 0 || enabled === "blocked" || enabled === "bad" || enabled === "disabled") return "badge bad";
  return "badge muted";
}

export function healthLabel(status?: string) {
  if (status === "ok" || status === "healthy") return "正常";
  if (status === "warn" || status === "degraded") return "需关注";
  if (status === "paused") return "已暂停";
  if (status === "blocked" || status === "disabled") return "不可用";
  return status || "—";
}

export function sourceHealthLabel(status?: string) {
  if (status === "healthy") return "健康";
  if (status === "degraded") return "降级";
  if (status === "paused") return "暂停刷新";
  if (status === "disabled") return "停用";
  return status || "—";
}

const GB = 1024 * 1024 * 1024;

/** input GB string -> bytes; empty => null */
export function gbToBytes(gb: string | number | null | undefined): number | null {
  if (gb == null || gb === "") return null;
  const n = Number(gb);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * GB);
}

/** bytes -> GB string for form fields */
export function bytesToGbInput(bytes?: number | null): string {
  if (bytes == null) return "";
  const n = Number(bytes) / GB;
  if (!Number.isFinite(n)) return "";
  // trim trailing zeros
  return String(Math.round(n * 1000) / 1000);
}
