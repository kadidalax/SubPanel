import { qrDataUrl } from "./qrcode";

export type ClientLink = {
  id: string;
  title: string;
  format: "auto" | "mihomo" | "singbox" | "uri" | "uri-base64" | "surge";
  hint: string;
  vendor?: string;
};

export const CLIENT_LINKS: ClientLink[] = [
  { id: "auto", title: "通用自动", format: "auto", hint: "按客户端 UA 自动识别" },
  { id: "flclash", title: "FlClash / Mihomo", format: "mihomo", hint: "Clash Meta 系" },
  { id: "karing", title: "Karing / sing-box", format: "singbox", hint: "sing-box JSON" },
  { id: "nekobox", title: "NekoBox", format: "uri", hint: "标准 URI 列表" },
  { id: "v2rayn", title: "v2rayN", format: "uri", hint: "保留 v2rayn:// 与证书", vendor: "v2rayn" },
  { id: "v2rayn_b64", title: "v2rayN (Base64)", format: "uri-base64", hint: "URI 列表 Base64", vendor: "v2rayn" },
  { id: "surge", title: "Surge", format: "surge", hint: "常见协议子集" },
];

export function tokenStorageKey(id: number | string) {
  return `sub_token_${id}`;
}

export function saveSubToken(id: number | string, token: string) {
  try {
    sessionStorage.setItem(tokenStorageKey(id), token);
  } catch {
    // ignore
  }
}

export function loadSubToken(id: number | string): string | null {
  try {
    return sessionStorage.getItem(tokenStorageKey(id));
  } catch {
    return null;
  }
}

export function buildSubUrl(
  token: string,
  format: ClientLink["format"] = "auto",
  extra: Record<string, string> = {},
) {
  const base = `${window.location.origin}/sub/${token}`;
  const q = new URLSearchParams();
  if (format && format !== "auto") q.set("format", format);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function buildImportLinks(subUrl: string) {
  const enc = encodeURIComponent(subUrl);
  return {
    clash: "clash://install-config?url=" + enc,
    singbox: "sing-box://import-remote-profile?url=" + enc,
    qr: qrDataUrl(subUrl, 168),
  };
}

export { qrDataUrl };
