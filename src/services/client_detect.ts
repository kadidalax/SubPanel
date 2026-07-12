import type { OutputFormat } from "../parsers/types.ts";

export type ClientFamily = "mihomo" | "singbox" | "surge" | "uri" | "unknown";

export function detectClient(uaRaw: string | null): { family: ClientFamily; format: OutputFormat } {
  const ua = (uaRaw || "").toLowerCase();
  if (!ua) return { family: "unknown", format: "uri" };
  if (ua.includes("surge")) return { family: "surge", format: "surge" };
  // Prefer URI share-list for NekoBox / v2rayNG style clients (user-requested generic format).
  if (
    ua.includes("nekobox") ||
    ua.includes("v2rayng") ||
    ua.includes("shadowrocket") ||
    ua.includes("quantumult")
  ) {
    return { family: "uri", format: "uri" };
  }
  if (ua.includes("sing-box") || ua.includes("singbox") || ua.includes("karing")) {
    return { family: "singbox", format: "singbox" };
  }
  if (
    ua.includes("clash") ||
    ua.includes("mihomo") ||
    ua.includes("flclash") ||
    ua.includes("clashmeta") ||
    ua.includes("clash-meta") ||
    ua.includes("stash") ||
    ua.includes("clashx") ||
    ua.includes("clash-verge") ||
    ua.includes("clashverge")
  ) {
    return { family: "mihomo", format: "mihomo" };
  }
  if (ua.includes("v2rayn")) {
    return { family: "uri", format: "uri" };
  }
  return { family: "unknown", format: "uri" };
}
