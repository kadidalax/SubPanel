import type { NormalizedNode } from "../parsers/types.ts";

/** Normalize PEM for sing-box outbound TLS (string, not array). */
function normalizePem(input: unknown): string | undefined {
  if (input == null) return undefined;
  let s = String(input).trim();
  if (!s) return undefined;
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return s || undefined;
}

function hopPorts(extras: Record<string, unknown>): string[] | undefined {
  const raw = extras.ports ?? extras.mport;
  if (raw == null || raw === "") return undefined;
  if (Array.isArray(raw)) {
    const out = raw.map((x) => String(x).trim().replace(/-/g, ":")).filter(Boolean);
    return out.length ? out : undefined;
  }
  const parts = String(raw)
    .split(/[,\s]+/)
    .map((p) => p.trim().replace(/-/g, ":"))
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function tlsObj(node: NormalizedNode) {
  const tls = node.tls || {};
  const extras = (node.extras || {}) as Record<string, unknown>;
  if (
    !(
      tls.enabled ||
      tls.reality ||
      node.protocol === "trojan" ||
      node.protocol === "hysteria2" ||
      node.protocol === "hysteria" ||
      node.protocol === "tuic" ||
      node.protocol === "anytls" ||
      node.protocol === "naive"
    )
  ) {
    return undefined;
  }
  const cert = normalizePem(tls.certificate || extras.certificate);
  const reality = tls.reality as Record<string, unknown> | undefined;
  const out: Record<string, unknown> = {
    enabled: true,
    server_name: tls.serverName || undefined,
    insecure: Boolean(tls.allowInsecure || tls.insecure),
  };
  // sing-box outbound TLS uses a PEM string (docs), not inbound-style string[].
  if (cert) out.certificate = cert;
  if (tls.alpn && Array.isArray(tls.alpn) && tls.alpn.length) out.alpn = tls.alpn;
  if (tls.fingerprint) out.utls = { enabled: true, fingerprint: String(tls.fingerprint) };
  if (reality) {
    const publicKey = reality.publicKey ?? reality.public_key;
    const shortId = reality.shortId ?? reality.short_id;
    out.reality = {
      enabled: true,
      public_key: publicKey != null ? String(publicKey) : undefined,
      short_id: shortId != null && shortId !== "" ? String(shortId) : undefined,
    };
  }
  return out;
}

function transportObj(node: NormalizedNode) {
  const transport = node.transport || {};
  if (!transport.type || transport.type === "tcp") return undefined;
  return {
    type: transport.type,
    path: transport.path,
    headers: transport.host ? { Host: transport.host } : undefined,
    service_name: transport.serviceName,
  };
}

function toSingboxOutbound(node: NormalizedNode): Record<string, unknown> | Record<string, unknown>[] | null {
  if (!node.capability.includes("singbox")) return null;
  const auth = node.auth || {};
  const extras = node.extras || {};
  const base: Record<string, unknown> = {
    tag: node.name,
    server: node.server,
    server_port: node.port,
  };
  const tls = tlsObj(node);
  const transport = transportObj(node);

  if ((node.protocol === "ss" || node.protocol === "ss2022") && extras.shadowtls) {
    const hop = extras.shadowtls as any;
    const hopTag = node.name + "-shadowtls";
    const hopOb = {
      type: "shadowtls",
      tag: hopTag,
      server: hop.server || node.server,
      server_port: hop.server_port || node.port,
      version: hop.version ?? 3,
      password: hop.password,
      tls: hop.tls
        ? {
            enabled: true,
            server_name: hop.tls.server_name || node.tls?.serverName,
            utls: hop.tls.utls || (node.tls?.fingerprint ? { enabled: true, fingerprint: node.tls.fingerprint } : undefined),
            insecure: hop.tls.insecure,
          }
        : tls,
    };
    const leaf: Record<string, unknown> = {
      type: "shadowsocks",
      tag: node.name,
      method: auth.method,
      password: auth.password,
      detour: hopTag,
      multiplex: extras.multiplex,
      udp_over_tcp: extras.udp_over_tcp,
    };
    return [hopOb, leaf];
  }

  switch (node.protocol) {
    case "ss":
    case "ss2022":
      return { ...base, type: "shadowsocks", method: auth.method, password: auth.password };
    case "trojan":
      return { ...base, type: "trojan", password: auth.password, tls, transport };
    case "vmess":
      return {
        ...base,
        type: "vmess",
        uuid: auth.uuid,
        security: auth.cipher || "auto",
        alter_id: auth.alterId ?? 0,
        tls,
        transport,
      };
    case "vless":
      return { ...base, type: "vless", uuid: auth.uuid, flow: auth.flow || extras.flow, tls, transport };
    case "hysteria2": {
      const ports = hopPorts((extras || {}) as Record<string, unknown>);
      const obfsType = (extras as any).obfs ? String((extras as any).obfs) : "";
      const hy2Tls = tls
        ? {
            ...tls,
            alpn:
              Array.isArray((tls as any).alpn) && (tls as any).alpn.length
                ? (tls as any).alpn
                : ["h3"],
          }
        : tls;
      return {
        ...base,
        type: "hysteria2",
        password: auth.password,
        tls: hy2Tls,
        ...(ports ? { server_ports: ports } : {}),
        ...(obfsType
          ? {
              obfs: {
                type: obfsType,
                password: (extras as any).obfsPassword != null ? String((extras as any).obfsPassword) : undefined,
              },
            }
          : {}),
      };
    }
    case "tuic":
      return {
        ...base,
        type: "tuic",
        uuid: auth.uuid,
        password: auth.password,
        congestion_control: extras.congestionControl || "bbr",
        tls,
      };
    case "anytls":
      return { ...base, type: "anytls", password: auth.password, tls };
    case "naive":
      return {
        ...base,
        type: "naive",
        username: auth.username,
        password: auth.password,
        tls,
        ...(extras.quic ? { quic: true } : {}),
      };
    case "socks":
      return { ...base, type: "socks", username: auth.username, password: auth.password };
    case "http":
      return { ...base, type: "http", username: auth.username, password: auth.password, tls };
    case "wireguard": {
      const localAddress = extras.localAddress || extras.ip;
      return {
        type: "wireguard",
        tag: node.name,
        server: node.server,
        server_port: node.port,
        private_key: auth.privateKey,
        peer_public_key: auth.publicKey,
        pre_shared_key: auth.preSharedKey,
        local_address: Array.isArray(localAddress) ? localAddress : localAddress ? [String(localAddress)] : undefined,
        mtu: extras.mtu,
        reserved: extras.reserved,
      };
    }
    case "hysteria":
      return {
        type: "hysteria",
        tag: node.name,
        server: node.server,
        server_port: node.port,
        auth_str: auth.password || extras.auth,
        up_mbps: Number(extras.up || 100),
        down_mbps: Number(extras.down || 100),
        obfs: extras.obfs ? String(extras.obfs) : undefined,
        tls: tlsObj({ ...node, tls: { ...(node.tls || {}), enabled: true } }),
      };
    default:
      return null;
  }
}

export function renderSingbox(nodes: NormalizedNode[]): { body: string; skipped: Array<{ name: string; reason: string }> } {
  const outbounds: Record<string, unknown>[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const select: string[] = [];
  for (const node of nodes) {
    const ob = toSingboxOutbound(node);
    if (!ob) {
      skipped.push({ name: node.name, reason: "singbox_unsupported" });
      continue;
    }
    if (Array.isArray(ob)) {
      outbounds.push(...ob);
      select.push(node.name);
    } else {
      outbounds.push(ob);
      select.push(String(ob.tag || node.name));
    }
  }
  const doc = {
    log: { level: "info" },
    outbounds: [
      ...outbounds,
      { type: "selector", tag: "proxy", outbounds: select.length ? select : ["direct"] },
      { type: "direct", tag: "direct" },
    ],
  };
  return { body: JSON.stringify(doc, null, 2) + String.fromCharCode(10), skipped };
}
