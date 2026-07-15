import { capabilitiesFor } from "./capabilities.ts";
import type { NormalizedNode, ParseWarning, Protocol } from "./types.ts";

function decodeMaybe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function b64decode(text: string): string {
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  const b64 = (text + pad).replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bin = atob(b64);
    // UTF-8 safe: avoid emoji/CJK mojibake from binary-to-string
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    try {
      return atob(b64);
    } catch {
      return "";
    }
  }
}

function normalizePemLike(input: string): string {
  let s = decodeMaybe(input).trim();
  if (!s) return s;
  // Throne etc.: PEM lines joined by commas
  if (/BEGIN CERTIFICATE/i.test(s) && s.includes(",")) {
    s = s.replace(/,/g, "\n");
  }
  return s;
}

function pickCert(q: Record<string, string | undefined>, data?: Record<string, unknown>): string | undefined {
  const keys = [
    "cert",
    "certificate",
    "ca",
    "ca-str",
    "ca_str",
    "tls_certificate",
    "tls-certificate",
    "tlsCertificate",
  ];
  for (const k of keys) {
    const v = q[k] ?? (data ? data[k] ?? data[k.replace(/-/g, "")] : undefined);
    if (v != null && String(v).trim()) return normalizePemLike(String(v));
  }
  if (data?.Cert != null) return normalizePemLike(String(data.Cert));
  if (data?.Certificate != null) return normalizePemLike(String(data.Certificate));
  return undefined;
}

function extractPin(q: Record<string, string>, data?: Record<string, unknown>): string | undefined {
  const keys = ["pinSHA256", "pinSHA256Cert", "pinSha256", "fingerprint", "hpkp", "publicKeySha256"];
  for (const k of keys) {
    const v = q[k] ?? (data ? data[k] : undefined);
    if (v != null && String(v).trim()) {
      const s = String(v).trim();
      // share-link fingerprint may be cert pin; ignore pure uTLS profile names
      if (["chrome", "firefox", "safari", "ios", "android", "edge", "360", "qq", "random"].includes(s.toLowerCase())) continue;
      return s;
    }
  }
  return undefined;
}

function queryMap(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function baseNode(
  protocol: Protocol,
  name: string,
  server: string,
  port: number,
  raw: string,
  rest: Partial<NormalizedNode> = {},
): NormalizedNode {
  const partial = {
    protocol,
    name: name || protocol + "-" + server + "-" + port,
    server,
    port,
    raw,
    ...rest,
  } as Omit<NormalizedNode, "capability">;
  return { ...partial, capability: capabilitiesFor(partial) };
}

export function parseVmessUri(raw: string): NormalizedNode | null {
  const payload = raw.slice("vmess://".length);
  const jsonText = b64decode(payload);
  if (!jsonText) return null;
  try {
    const data = JSON.parse(jsonText) as Record<string, unknown>;
    const server = String(data.add || data.host || "");
    const port = Number(data.port || 0);
    if (!server || !port) return null;
    return baseNode("vmess", String(data.ps || data.remark || ""), server, port, raw, {
      auth: {
        uuid: String(data.id || ""),
        alterId: Number(data.aid || 0),
        cipher: String(data.scy || "auto"),
      },
      tls: data.tls
        ? {
            enabled: true,
            serverName: String(data.sni || data.host || ""),
            alpn: data.alpn ? String(data.alpn).split(",") : undefined,
            fingerprint: data.fp ? String(data.fp) : undefined,
          }
        : undefined,
      transport: {
        type: String(data.net || "tcp"),
        path: data.path ? String(data.path) : undefined,
        host: data.host ? String(data.host) : undefined,
      },
    });
  } catch {
    return null;
  }
}

export function parseV2raynUri(raw: string): NormalizedNode | null {
  const m = raw.match(/^v2rayn:\/\/([a-z0-9_-]+)\/(.+)$/i);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const payload = b64decode(m[2].trim());
  if (!payload) return null;
  try {
    const data = JSON.parse(payload) as Record<string, unknown>;
    const server = String(data.Address || data.address || "");
    const port = Number(data.Port || data.port || 0);
    if (!server || !port) return null;
    const name = String(data.Remarks || data.remarks || kind + "-" + server + "-" + port);
    const allowInsecure = String(data.AllowInsecure ?? data.allowInsecure ?? "false").toLowerCase();
    const insecure = allowInsecure === "1" || allowInsecure === "true";
    const sni = String(data.Sni || data.sni || "");
    const stream = String(data.StreamSecurity || data.streamSecurity || data.Security || "").toLowerCase();
    const network = String(data.Network || data.network || data.Net || data.net || "tcp").toLowerCase();
    const extra = (data.ProtoExtraObj || data.protoExtraObj || {}) as Record<string, unknown>;
    const cert = data.Cert ? String(data.Cert) : undefined;
    const password = String(data.Password || data.password || "");
    const username = String(data.Username || data.username || "");
    const uuid = String(data.Id || data.id || data.Uuid || data.uuid || password || "");
    const fp = data.Fingerprint ? String(data.Fingerprint) : data.fp ? String(data.fp) : undefined;
    const pbk = data.PublicKey ? String(data.PublicKey) : data.pbk ? String(data.pbk) : undefined;
    const sid = data.ShortId ? String(data.ShortId) : data.sid ? String(data.sid) : undefined;
    const flow = data.Flow ? String(data.Flow) : data.flow ? String(data.flow) : undefined;
    const path = data.Path ? String(data.Path) : data.path ? String(data.path) : undefined;
    const host = data.Host ? String(data.Host) : data.host ? String(data.host) : undefined;
    const serviceName = data.ServiceName
      ? String(data.ServiceName)
      : data.serviceName
        ? String(data.serviceName)
        : undefined;

    if (kind === "hysteria2" || kind === "hy2") {
      const pin = extractPin({}, data);
      return baseNode("hysteria2", name, server, port, raw, {
        auth: { password },
        tls: { enabled: true, serverName: sni, insecure, certificate: cert },
        extras: {
          mport: extra.Ports || extra.ports || data.Ports,
          ports: extra.Ports || extra.ports || data.Ports,
          upMbps: extra.UpMbps || extra.up,
          downMbps: extra.DownMbps || extra.down,
          hopInterval: extra.HopInterval || extra.hopInterval,
          certificate: cert,
          pinSHA256: pin,
        },
      });
    }

    if (kind === "tuic") {
      return baseNode("tuic", name, server, port, raw, {
        auth: { uuid: username || uuid, password },
        tls: {
          enabled: true,
          serverName: sni,
          insecure,
          alpn: data.Alpn ? String(data.Alpn).split(",") : undefined,
          certificate: cert,
        },
        extras: {
          congestionControl: extra.CongestionControl || extra.congestionControl || "bbr",
          certificate: cert,
        },
      });
    }

    if (kind === "trojan") {
      return baseNode("trojan", name, server, port, raw, {
        auth: { password },
        tls: { enabled: true, serverName: sni, allowInsecure: insecure, certificate: cert },
        transport: { type: network === "raw" ? "tcp" : network, path, host },
      });
    }

    if (kind === "vless") {
      const security = stream || (pbk ? "reality" : sni ? "tls" : "none");
      return baseNode("vless", name, server, port, raw, {
        auth: { uuid: uuid || password, flow },
        tls:
          security !== "none"
            ? {
                enabled: true,
                security,
                serverName: sni,
                fingerprint: fp,
                insecure,
                reality: security === "reality" || pbk ? { publicKey: pbk, shortId: sid } : undefined,
                certificate: cert,
              }
            : undefined,
        transport: { type: network === "raw" ? "tcp" : network, path, host, serviceName },
      });
    }

    
    if (kind === "anytls") {
      return baseNode("anytls", name, server, port, raw, {
        auth: { password },
        tls: {
          enabled: true,
          serverName: sni,
          insecure,
          fingerprint: fp,
          certificate: cert,
        },
        extras: { certificate: cert },
      });
    }

    if (kind === "naive") {
      const naiveQuic = Boolean(extra.NaiveQuic || extra.naiveQuic || extra.quic);
      return baseNode("naive", name, server, port, raw, {
        auth: { username: username || undefined, password },
        tls: {
          enabled: true,
          serverName: sni,
          insecure,
          certificate: cert,
        },
        extras: {
          certificate: cert,
          quic: naiveQuic,
          congestionControl: extra.CongestionControl || extra.congestionControl,
        },
      });
    }

return null;
  } catch {
    return null;
  }
}


/** Shadowrocket packs auto:uuid@host:port (or uuid@host:port) as base64 authority. */
function decodeShadowrocketAuthority(token: string): { uuid: string; server: string; port: number } | null {
  const decoded = b64decode(token.trim());
  if (!decoded || !decoded.includes("@")) return null;
  const m = decoded.match(/^(?:[^@]*:)?([^@]+)@([^:]+):(\d+)$/);
  if (!m) return null;
  const port = Number(m[3]);
  if (!m[1] || !m[2] || !port) return null;
  return { uuid: m[1], server: m[2], port };
}

function stripEarlyData(path: string): { path: string; earlyData?: string } {
  const idx = path.indexOf("?ed=");
  if (idx < 0) return { path };
  return { path: path.slice(0, idx), earlyData: path.slice(idx + 4) };
}

export function parseGenericUri(rawLine: string): NormalizedNode | null {
  const raw = rawLine.trim();
  if (!raw || raw.startsWith("#")) return null;
  if (raw.toLowerCase().startsWith("v2rayn://")) return parseV2raynUri(raw);
  const lower = raw.toLowerCase();
  if (lower.startsWith("vmess://")) return parseVmessUri(raw);

  if (lower.startsWith("ss://")) {
    const hashIdx = raw.indexOf("#");
    const body = hashIdx >= 0 ? raw.slice(5, hashIdx) : raw.slice(5);
    const namePart = hashIdx >= 0 ? decodeMaybe(raw.slice(hashIdx + 1)) : "ss";
    if (body && !body.includes("@")) {
      const decoded = b64decode(body);
      if (decoded && decoded.includes("@")) {
        return parseGenericUri("ss://" + decoded + (hashIdx >= 0 ? "#" + encodeURIComponent(namePart) : ""));
      }
    }
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const protocol = url.protocol.replace(":", "").toLowerCase();
  const name = decodeMaybe(url.hash.replace(/^#/, ""));
  const server = url.hostname;
  const port = Number(url.port || 0);
  const q = queryMap(url);

  if (protocol === "vless") {
    let vServer = server;
    let vPort = port;
    let uuid = decodeMaybe(url.username);
    // Shadowrocket: vless://base64(auto:uuid@host:port)?remarks=&obfs=websocket&tls=1&peer=&obfsParam=&path=
    if ((!vPort || !uuid) && vServer) {
      const sr = decodeShadowrocketAuthority(vServer);
      if (sr) {
        uuid = sr.uuid;
        vServer = sr.server;
        vPort = sr.port;
      }
    }
    if (!uuid) {
      const sr2 = decodeShadowrocketAuthority(decodeMaybe(url.username || ""));
      if (sr2) {
        uuid = sr2.uuid;
        vServer = sr2.server;
        vPort = sr2.port;
      }
    }
    if (!vServer || !vPort || !uuid) return null;
    const cert = pickCert(q);
    const pin = extractPin(q);
    const remarkName = name || decodeMaybe(q.remarks || q.remark || "");
    const security = String(q.security || (q.tls === "1" || q.tls === "true" ? "tls" : q.sni || q.peer ? "tls" : "none"));
    let tType = String(q.type || q.obfs || "tcp").toLowerCase();
    if (tType === "websocket") tType = "ws";
    const pathRaw = q.path || "";
    const { path: wsPath, earlyData } = stripEarlyData(pathRaw);
    const hostHeader = q.host || q.obfsParam;
    const sni = q.sni || q.peer || hostHeader;
    return baseNode("vless", remarkName, vServer, vPort, raw, {
      auth: { uuid, flow: q.flow },
      tls:
        security && security !== "none"
          ? {
              enabled: true,
              security,
              serverName: sni,
              fingerprint: q.fp,
              alpn: q.alpn ? q.alpn.split(",") : undefined,
              allowInsecure: q.allowInsecure === "1" || q.allowInsecure === "true",
              reality:
                security === "reality"
                  ? { publicKey: q.pbk, shortId: q.sid, spiderX: q.spx }
                  : undefined,
              certificate: cert,
            }
          : undefined,
      transport: {
        type: tType || "tcp",
        path: wsPath || undefined,
        host: hostHeader,
        serviceName: q.serviceName,
      },
      extras: {
        encryption: q.encryption || "none",
        certificate: cert,
        pinSHA256: pin,
        ...(earlyData ? { earlyData } : {}),
      },
    });
  }

  if (protocol === "trojan") {
    if (!server || !port) return null;
    const cert = pickCert(q);
    const pin = extractPin(q);
    return baseNode("trojan", name, server, port, raw, {
      auth: { password: decodeMaybe(url.username) },
      tls: {
        enabled: true,
        serverName: q.sni,
        alpn: q.alpn ? q.alpn.split(",") : undefined,
        allowInsecure: q.allowInsecure === "1" || q.allowInsecure === "true",
        certificate: cert,
      },
      transport: { type: q.type || "tcp", path: q.path, host: q.host },
      extras: {
        ...(cert ? { certificate: cert } : {}),
        ...(pin ? { pinSHA256: pin } : {}),
      },
    });
  }

  if (protocol === "ss") {
    let method = "";
    let password = "";
    let ssServer = server;
    let ssPort = port;
    if (url.username && url.password) {
      method = decodeMaybe(url.username);
      password = decodeMaybe(url.password);
    } else {
      const userOrHost = decodeMaybe(url.username || server);
      const decoded = b64decode(userOrHost);
      if (decoded && decoded.includes("@")) {
        const at = decoded.lastIndexOf("@");
        const cred = decoded.slice(0, at);
        const hostPort = decoded.slice(at + 1);
        const [m, ...rest] = cred.split(":");
        method = m || "";
        password = rest.join(":");
        const hp = hostPort.split(":");
        if (hp.length >= 2) {
          ssServer = hp.slice(0, -1).join(":") || ssServer;
          ssPort = Number(hp[hp.length - 1] || ssPort);
        }
      } else if (url.username && !url.password) {
        const d = b64decode(decodeMaybe(url.username));
        const at = d.lastIndexOf("@");
        const cred = at >= 0 ? d.slice(0, at) : d;
        const [m, ...rest] = cred.split(":");
        method = m || "";
        password = rest.join(":");
      }
    }
    if (!ssServer || !ssPort) return null;
    const proto: Protocol = method.startsWith("2022-blake3") ? "ss2022" : "ss";
    return baseNode(proto, name, ssServer, ssPort, raw, {
      auth: { method, password },
    });
  }

  if (!server || !port) return null;

  if (protocol === "socks" || protocol === "socks5") {
    return baseNode("socks", name, server, port, raw, {
      auth: {
        username: decodeMaybe(url.username) || undefined,
        password: decodeMaybe(url.password) || undefined,
      },
    });
  }

  if (protocol === "http" || protocol === "https") {
    return baseNode("http", name, server, port, raw, {
      auth: {
        username: decodeMaybe(url.username) || undefined,
        password: decodeMaybe(url.password) || undefined,
      },
      tls: protocol === "https" ? { enabled: true } : undefined,
    });
  }

  if (protocol === "hysteria" || protocol === "hy") {
    const data = Object.fromEntries(url.searchParams.entries()) as Record<string, string>;
    return baseNode("hysteria", name, server, port, raw, {
      auth: { password: decodeMaybe(url.password) || decodeMaybe(url.username) || data.auth || undefined },
      tls: {
        enabled: true,
        serverName: data.peer || data.sni || undefined,
        allowInsecure: data.insecure === "1" || data.allowInsecure === "1",
        alpn: data.alpn ? String(data.alpn).split(",") : undefined,
      },
      extras: {
        up: data.up || data.upmbps,
        down: data.down || data.downmbps,
        obfs: data.obfs,
        auth: data.auth,
      },
    });
  }
  if (protocol === "hysteria2" || protocol === "hy2") {
    const cert = pickCert(q);
    const pin = extractPin(q);
    const sni = q.sni || q.peer;
    const obfs = q.obfs && q.obfs.toLowerCase() !== "none" ? q.obfs : undefined;
    return baseNode("hysteria2", name, server, port, raw, {
      auth: { password: decodeMaybe(url.username) || q.auth },
      tls: {
        enabled: true,
        serverName: sni,
        insecure:
          q.insecure === "1" ||
          q.insecure === "true" ||
          q.allowInsecure === "1" ||
          q.allowInsecure === "true",
        certificate: cert,
      },
      extras: {
        obfs,
        obfsPassword: q["obfs-password"] || q.obfsPassword,
        mport: q.mport || q.ports,
        ports: q.ports || q.mport,
        certificate: cert,
        pinSHA256: pin,
        hopInterval: q.hop_interval || q.hopInterval || q.keepalive,
        upMbps: q.upmbps || q.up,
        downMbps: q.downmbps || q.down,
      },
    });
  }

  if (protocol === "tuic") {
    return baseNode("tuic", name, server, port, raw, {
      auth: { uuid: decodeMaybe(url.username), password: decodeMaybe(url.password) },
      tls: { enabled: true, serverName: q.sni, alpn: q.alpn ? q.alpn.split(",") : undefined },
      extras: { congestionControl: q.congestion_control || q.congestionControl },
    });
  }

  return null;
}

/** Rejoin soft-wrapped share links (long v2rayn/vmess base64 payloads). */
function coalesceUriLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    // Separators / pure punctuation must never join into share-link payloads
    if (/^[-=*_.\s]{3,}$/.test(line) || /^[\u2500-\u257F\s]+$/.test(line)) {
      out.push(line);
      continue;
    }
    const prev = out[out.length - 1];
    // Soft-wrapped base64 body only: has alnum, not pure dashes, no scheme
    const frag =
      !!prev &&
      !line.includes("://") &&
      line.length >= 16 &&
      /^[A-Za-z0-9+/=_-]+$/.test(line) &&
      /[A-Za-z0-9]/.test(line) &&
      !/^[-_=*]+$/.test(line);
    if (frag && /^(v2rayn|vmess):\/\//i.test(prev)) {
      out[out.length - 1] = prev + line;
      continue;
    }
    out.push(line);
  }
  return out;
}

export function parseUriList(text: string): { nodes: NormalizedNode[]; warnings: ParseWarning[] } {
  const nodes: NormalizedNode[] = [];
  const warnings: ParseWarning[] = [];
  const lines = coalesceUriLines(
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
  for (const line of lines) {
    if (
      line.startsWith("#") ||
      /^-{5,}$/.test(line) ||
      /^[-=*]{5,}$/.test(line) ||
      /^\*{5,}/.test(line) ||
      /^[\u2500-\u257F\s│]+$/.test(line) ||
      /[\u2500-\u257F]/.test(line) || // box-drawing titles like "│  V2rayN  │"
      /^(V2rayN|ShadowRocket|Shadowrocket|Clash\s*Verge|Clash|Throne|Sing-?box|Mihomo)\s*$/i.test(line)
    )
      continue;
    const node = parseGenericUri(line);
    if (!node) {
      // Only warn for things that look like share links
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) {
        warnings.push({ code: "uri_unparsed", message: "unable to parse uri", raw: line.slice(0, 200) });
      }
      continue;
    }
    nodes.push(node);
  }
  return { nodes, warnings };
}

export function maybeDecodeBase64List(text: string): string | null {
  const compact = text.replace(/\s+/g, "");
  if (!compact || compact.includes("://") || compact.includes("{") || compact.includes("proxies:")) {
    return null;
  }
  if (!/^[A-Za-z0-9+/=_-]+$/.test(compact)) return null;
  const decoded = b64decode(compact);
  if (!decoded) return null;
  if (decoded.includes("://") || decoded.includes("proxies:") || decoded.includes("outbounds")) {
    return decoded;
  }
  return null;
}
