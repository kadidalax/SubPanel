function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n == null) return true;
  const a = (n >>> 24) & 255;
  const b = (n >>> 16) & 255;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function expandIPv6(ip: string): string {
  let v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v.includes("%")) v = v.split("%")[0];
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return "mapped-v4:" + mapped[1];
  const mappedHex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const a = parseInt(mappedHex[1], 16);
    const b = parseInt(mappedHex[2], 16);
    return "mapped-v4:" + [(a >> 8) & 255, a & 255, (b >> 8) & 255, b & 255].join(".");
  }
  return v;
}

function isPrivateIPv6(ip: string): boolean {
  const v = expandIPv6(ip);
  if (v.startsWith("mapped-v4:")) return isPrivateIPv4(v.slice("mapped-v4:".length));
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") ||
      v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff")) return true;
  return false;
}

function isDecimalOrWeirdIPv4Literal(host: string): boolean {
  if (/^\d+$/.test(host)) return true;
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  if (/^\d+(?:\.\d+){1,3}$/.test(host)) return true;
  return false;
}

const BLOCKED_HEADER = /^(host|content-length|transfer-encoding|connection|keep-alive|upgrade|te|trailer|proxy-.*|cf-.*|x-forwarded-.*|x-real-ip|forwarded)$/i;
const ALLOWED_HEADER = /^(authorization|user-agent|token|x-token|x-api-key|api-key|accept|accept-language)$/i;

export function sanitizeRemoteHeaders(input: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input)) {
    const key = String(k || "").trim();
    if (!key || key.length > 64) continue;
    if (BLOCKED_HEADER.test(key)) continue;
    if (!ALLOWED_HEADER.test(key)) continue;
    const val = String(v ?? "").trim();
    if (!val || val.length > 2048) continue;
    if (/[\r\n]/.test(val)) continue;
    out[key] = val;
  }
  return out;
}

export function assertSafeRemoteUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid url");
  }
  if (url.protocol !== "https:") throw new Error("only https remote sources are allowed");
  if (url.username || url.password) throw new Error("url userinfo is not allowed");
  const host = url.hostname;
  if (!host) throw new Error("missing host");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("localhost is not allowed");
  }
  if (isDecimalOrWeirdIPv4Literal(host)) throw new Error("non-standard ip literal is not allowed");

  if (host.includes(":") || host.startsWith("[")) {
    if (isPrivateIPv6(host)) throw new Error("private ipv6 is not allowed");
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIPv4(host)) throw new Error("private ipv4 is not allowed");
  }
  return url;
}

export function assertSafeOutboundHost(hostRaw: string, port: number, allowedPorts: number[]): void {
  const host = String(hostRaw || "").trim().toLowerCase();
  if (!host) throw new Error("host required");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("localhost is not allowed");
  }
  if (!allowedPorts.includes(port)) throw new Error("port not allowed");
  if (isDecimalOrWeirdIPv4Literal(host)) throw new Error("non-standard ip literal is not allowed");
  if (host.includes(":") || host.startsWith("[")) {
    if (isPrivateIPv6(host)) throw new Error("private ipv6 is not allowed");
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIPv4(host)) throw new Error("private ipv4 is not allowed");
  }
}

export async function fetchRemoteSubscription(
  rawUrl: string,
  headers: Record<string, string> = {},
  maxBytes = 5 * 1024 * 1024,
): Promise<{ body: string; userinfo: string | null; finalUrl: string }> {
  const safeHeaders = sanitizeRemoteHeaders(headers);
  let current = assertSafeRemoteUrl(rawUrl).toString();
  for (let i = 0; i < 4; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          "user-agent": safeHeaders["user-agent"] || safeHeaders["User-Agent"] || "sub-panel/0.1",
          ...safeHeaders,
        },
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error("redirect without location");
        current = assertSafeRemoteUrl(new URL(loc, current).toString()).toString();
        continue;
      }
      if (!res.ok) throw new Error("upstream status " + res.status);
      const userinfo = res.headers.get("subscription-userinfo");
      const reader = res.body?.getReader();
      if (!reader) {
        const text = await res.text();
        if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("response too large");
        return { body: text, userinfo, finalUrl: current };
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) throw new Error("response too large");
        chunks.push(value);
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      return { body: new TextDecoder().decode(merged), userinfo, finalUrl: current };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("too many redirects");
}

export function parseUserinfo(header: string | null): {
  upload: number | null;
  download: number | null;
  total: number | null;
  expire: number | null;
} {
  if (!header) return { upload: null, download: null, total: null, expire: null };
  const map: Record<string, string> = {};
  for (const part of header.split(";")) {
    const segs = part.split("=");
    const k = segs[0]?.trim().toLowerCase();
    const v = segs.slice(1).join("=").trim();
    if (k) map[k] = v;
  }
  const num = (k: string) => (map[k] != null && map[k] !== "" ? Number(map[k]) : null);
  const expireRaw = num("expire");
  return {
    upload: num("upload"),
    download: num("download"),
    total: num("total"),
    expire: expireRaw != null ? (expireRaw < 1e12 ? expireRaw * 1000 : expireRaw) : null,
  };
}
