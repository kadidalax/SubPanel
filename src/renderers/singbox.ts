import type { NormalizedNode } from "../parsers/types.ts";

function tlsObj(node: NormalizedNode) {
  const tls = node.tls || {};
  const extras = node.extras || {};
  if (!(tls.enabled || tls.reality || node.protocol === "trojan" || node.protocol === "hysteria2" || node.protocol === "hysteria" || node.protocol === "tuic" || node.protocol === "anytls" || node.protocol === "naive")) {
    return undefined;
  }
  const cert = tls.certificate || extras.certificate;
  return {
    enabled: true,
    server_name: tls.serverName,
    insecure: Boolean(tls.allowInsecure || tls.insecure),
    certificate: cert ? [String(cert)] : undefined,
    alpn: tls.alpn,
    utls: tls.fingerprint ? { enabled: true, fingerprint: tls.fingerprint } : undefined,
    reality: tls.reality
      ? {
          enabled: true,
          public_key: (tls.reality as any).publicKey || (tls.reality as any).public_key,
          short_id: (tls.reality as any).shortId || (tls.reality as any).short_id,
        }
      : undefined,
  };
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
      return { ...base, type: "vless", uuid: auth.uuid, flow: auth.flow, tls, transport };
    case "hysteria2":
      return {
        ...base,
        type: "hysteria2",
        password: auth.password,
        tls,
        server_ports: extras.ports || extras.mport ? [String(extras.ports || extras.mport)] : undefined,
        obfs: extras.obfs ? { type: extras.obfs, password: extras.obfsPassword } : undefined,
      };
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
