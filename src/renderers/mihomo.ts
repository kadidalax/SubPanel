import YAML from "yaml";
import type { NormalizedNode } from "../parsers/types.ts";

function toMihomoProxy(node: NormalizedNode): Record<string, unknown> | null {
  if (!node.capability.includes("mihomo")) return null;
  const base: Record<string, unknown> = {
    name: node.name,
    server: node.server,
    port: node.port,
    udp: true,
  };
  const auth = node.auth || {};
  const tls = node.tls || {};
  const transport = node.transport || {};
  const extras = node.extras || {};
  switch (node.protocol) {
    case "ss":
    case "ss2022": {
      const proxy: Record<string, unknown> = {
        ...base,
        type: "ss",
        cipher: auth.method,
        password: auth.password,
      };
      const st = (node.extras || {}).shadowtls as any;
      if (st) {
        proxy.plugin = "shadow-tls";
        proxy["plugin-opts"] = {
          host: st.tls?.server_name || tls.serverName || node.server,
          password: st.password,
          version: st.version ?? 3,
          fingerprint: st.tls?.utls?.fingerprint || tls.fingerprint,
        };
      }
      return proxy;
    }
    case "trojan":
      return {
        ...base,
        type: "trojan",
        password: auth.password,
        sni: tls.serverName,
        "skip-cert-verify": Boolean(tls.allowInsecure || tls.insecure),
        "ca-str": (node.extras || {}).certificate || tls.certificate,
      };
    case "vmess":
      return {
        ...base,
        type: "vmess",
        uuid: auth.uuid,
        alterId: auth.alterId ?? 0,
        cipher: auth.cipher || "auto",
        tls: Boolean(tls.enabled),
        servername: tls.serverName,
        network: transport.type || "tcp",
        "ws-opts": transport.type === "ws" ? { path: transport.path, headers: transport.host ? { Host: transport.host } : undefined } : undefined,
      };
    case "vless":
      return {
        ...base,
        type: "vless",
        uuid: auth.uuid,
        flow: auth.flow,
        tls: Boolean(tls.enabled),
        servername: tls.serverName,
        network: transport.type || "tcp",
        "client-fingerprint": tls.fingerprint,
        "reality-opts": tls.reality,
        "skip-cert-verify": Boolean(tls.insecure || tls.allowInsecure),
        "ca-str": (node.extras || {}).certificate || tls.certificate,
        "ws-opts": transport.type === "ws" ? { path: transport.path, headers: transport.host ? { Host: transport.host } : undefined } : undefined,
        "grpc-opts": transport.type === "grpc" ? { "grpc-service-name": transport.serviceName } : undefined,
      };
    case "hysteria2":
      return {
        ...base,
        type: "hysteria2",
        password: auth.password,
        sni: tls.serverName,
        "skip-cert-verify": Boolean(tls.insecure || tls.allowInsecure),
        ports: (node.extras || {}).ports || (node.extras || {}).mport,
        "ca-str": (node.extras || {}).certificate || tls.certificate,
        obfs: (node.extras || {}).obfs,
        "obfs-password": (node.extras || {}).obfsPassword,
      };
    case "tuic":
      return {
        ...base,
        type: "tuic",
        uuid: auth.uuid,
        password: auth.password,
        sni: tls.serverName,
        alpn: tls.alpn,
        "congestion-controller": (node.extras || {}).congestionControl || "bbr",
      };
    case "anytls":
      return {
        ...base,
        type: "anytls",
        password: auth.password,
        sni: tls.serverName,
        "client-fingerprint": tls.fingerprint,
        "skip-cert-verify": Boolean(tls.insecure || tls.allowInsecure),
        "ca-str": (node.extras || {}).certificate || tls.certificate,
      };
    case "naive":
      return {
        ...base,
        type: "naiveproxy",
        username: auth.username,
        password: auth.password,
        sni: tls.serverName,
        "skip-cert-verify": Boolean(tls.insecure || tls.allowInsecure),
        ...((node.extras || {}).quic ? { udp: true } : {}),
      };
    case "wireguard":
      return {
        ...base,
        type: "wireguard",
        "private-key": auth.privateKey,
        "public-key": auth.publicKey,
        "pre-shared-key": auth.preSharedKey,
        ip: extras.ip || (Array.isArray(extras.localAddress) ? extras.localAddress[0] : extras.localAddress),
        ipv6: extras.ipv6,
        mtu: extras.mtu,
        reserved: extras.reserved,
        "allowed-ips": extras.allowedIPs || ["0.0.0.0/0", "::/0"],
        udp: true,
      };
    case "hysteria":
      return {
        ...base,
        type: "hysteria",
        auth_str: auth.password || extras.auth,
        auth: auth.password || extras.auth,
        up: extras.up,
        down: extras.down,
        obfs: extras.obfs,
        sni: tls.serverName,
        alpn: tls.alpn,
        "skip-cert-verify": Boolean(tls.insecure || tls.allowInsecure),
      };
    case "socks":
      return { ...base, type: "socks5", username: auth.username, password: auth.password };
    case "http":
      return { ...base, type: "http", username: auth.username, password: auth.password, tls: Boolean(tls.enabled) };
    default:
      return null;
  }
}

export function renderMihomo(nodes: NormalizedNode[], profileTitle = "Sub Panel"): { body: string; skipped: Array<{ name: string; reason: string }> } {
  const proxies: Record<string, unknown>[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const node of nodes) {
    const proxy = toMihomoProxy(node);
    if (!proxy) {
      skipped.push({ name: node.name, reason: "mihomo_unsupported" });
      continue;
    }
    proxies.push(proxy);
  }
  const names = proxies.map((p) => String(p.name));
  const doc = {
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    proxies,
    "proxy-groups": [
      { name: "PROXY", type: "select", proxies: names.length ? names : ["DIRECT"] },
    ],
    rules: ["MATCH,PROXY"],
    profile_title: profileTitle,
  };
  return { body: YAML.stringify(doc), skipped };
}

