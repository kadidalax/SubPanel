import type { DeliveryFormat, NormalizedNode, OutputFormat } from "../parsers/types.ts";
import { renderMihomo } from "./mihomo.ts";
import { renderSingbox } from "./singbox.ts";
import { renderUriList } from "./uri.ts";
import { renderSurge } from "./surge.ts";

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function renderProfile(
  format: DeliveryFormat,
  nodes: NormalizedNode[],
  profileTitle = "Sub Panel",
): { body: string; skipped: Array<{ name: string; reason: string }>; contentType: string } {
  if (format === "mihomo") {
    return { ...renderMihomo(nodes, profileTitle), contentType: "text/yaml; charset=utf-8" };
  }
  if (format === "singbox") {
    return { ...renderSingbox(nodes), contentType: "application/json; charset=utf-8" };
  }
  if (format === "surge") {
    return { ...renderSurge(nodes, profileTitle), contentType: "text/plain; charset=utf-8" };
  }
  if (format === "uri-base64") {
    const uri = renderUriList(nodes);
    return {
      body: toBase64(uri.body),
      skipped: uri.skipped,
      contentType: "text/plain; charset=utf-8",
    };
  }
  return { ...renderUriList(nodes), contentType: "text/plain; charset=utf-8" };
}

export function normalizeDeliveryFormat(raw: string | null | undefined): {
  format: DeliveryFormat;
  fallback: boolean;
} {
  const v = String(raw || "auto").toLowerCase();
  if (v === "auto" || !v) return { format: "uri", fallback: false };
  if (v === "mihomo" || v === "singbox" || v === "uri" || v === "surge" || v === "uri-base64") {
    return { format: v, fallback: false };
  }
  return { format: "uri", fallback: true };
}

export type { OutputFormat };
