import YAML from "yaml";
import type { NormalizedNode } from "../parsers/types.ts";
import { normalizeCert } from "./uri.ts";

function firstNonEmpty(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return undefined;
}

/** Clash Meta reality-opts uses kebab-case; internal nodes use camelCase. */
function toMihomoRealityOpts(reality: unknown): Record<string, unknown> | null | undefined {
  if (reality == null || reality === false) return undefined;
  if (typeof reality !== "object") return null;
  const r = reality as Record<string, unknown>;
  const publicKey = firstNonEmpty(r["public-key"], r.public_key, r.publicKey, r.pbk);
  if (!publicKey) return null;
  const opts: Record<string, unknown> = { "public-key": publicKey };
  const shortId = firstNonEmpty(r["short-id"], r.short_id, r.shortId, r.sid);
  if (shortId) opts["short-id"] = shortId;
  if (r["support-x25519mlkem768"] != null) opts["support-x25519mlkem768"] = r["support-x25519mlkem768"];
  return opts;
}

function normalizePin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const hex = raw.replace(/:/g, "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return undefined;
  return hex.toUpperCase().replace(/(.{2})(?=.)/g, "$1:");
}

/** mihomo cert pin = SHA256 of DER, openssl-style. ca-str is not a trusted CA pin field. */
export async function certSha256Fingerprint(input: unknown): Promise<string | undefined> {
  const asPin = normalizePin(String(input ?? ""));
  if (asPin) return asPin;
  const norm = normalizeCert(String(input ?? ""));
  if (!norm) return undefined;
  const body = norm.pem
    .split("\n")
    .filter((line) => line && !/CERTIFICATE/i.test(line))
    .join("")
    .replace(/\s+/g, "");
  if (!body) return undefined;
  try {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  } catch {
    return undefined;
  }
}

async function nodeCertFingerprint(node: NormalizedNode): Promise<string | undefined> {
  const tls = node.tls || {};
  const extras = node.extras || {};
  const pin = firstNonEmpty(
    extras.pinSHA256,
    extras.pinSha256,
    extras.certificateFingerprint,
    (tls as any).certificateFingerprint,
  );
  const fromPin = normalizePin(pin);
  if (fromPin) return fromPin;
  return certSha256Fingerprint(extras.certificate || tls.certificate);
}

async function toMihomoProxy(node: NormalizedNode): Promise<Record<string, unknown> | null> {
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
  const certFp = await nodeCertFingerprint(node);
  const skipCert = Boolean(tls.insecure || tls.allowInsecure);
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
    case "trojan": {
      const realityOpts = toMihomoRealityOpts(tls.reality);
      if (tls.reality && realityOpts === null) return null;
      return {
        ...base,
        type: "trojan",
        password: auth.password,
        sni: tls.serverName,
        "client-fingerprint": tls.fingerprint,
        "reality-opts": realityOpts,
        "skip-cert-verify": skipCert,
        fingerprint: certFp,
      };
    }
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
        "skip-cert-verify": skipCert,
        fingerprint: certFp,
        "ws-opts":
          transport.type === "ws"
            ? { path: transport.path, headers: transport.host ? { Host: transport.host } : undefined }
            : undefined,
      };
    case "vless": {
      const realityOpts = toMihomoRealityOpts(tls.reality);
      if (tls.reality && realityOpts === null) return null;
      return {
        ...base,
        type: "vless",
        uuid: auth.uuid,
        flow: auth.flow || extras.flow,
        tls: Boolean(tls.enabled || realityOpts),
        servername: tls.serverName,
        network: transport.type || "tcp",
        "client-fingerprint": tls.fingerprint,
        "reality-opts": realityOpts,
        "skip-cert-verify": skipCert,
        fingerprint: certFp,
        "ws-opts":
          transport.type === "ws"
            ? { path: transport.path, headers: transport.host ? { Host: transport.host } : undefined }
            : undefined,
        "grpc-opts": transport.type === "grpc" ? { "grpc-service-name": transport.serviceName } : undefined,
      };
    }
    case "hysteria2":
      return {
        ...base,
        type: "hysteria2",
        password: auth.password,
        sni: tls.serverName,
        "skip-cert-verify": skipCert,
        ports: extras.ports || extras.mport,
        fingerprint: certFp,
        alpn: tls.alpn && Array.isArray(tls.alpn) && tls.alpn.length ? tls.alpn : ["h3"],
        obfs: extras.obfs,
        "obfs-password": extras.obfsPassword,
      };
    case "tuic":
      return {
        ...base,
        type: "tuic",
        uuid: auth.uuid,
        password: auth.password,
        sni: tls.serverName,
        alpn: tls.alpn,
        fingerprint: certFp,
        "skip-cert-verify": skipCert,
        "congestion-controller": extras.congestionControl || "bbr",
      };
    case "anytls":
      return {
        ...base,
        type: "anytls",
        password: auth.password,
        sni: tls.serverName,
        "client-fingerprint": tls.fingerprint,
        "skip-cert-verify": skipCert,
        fingerprint: certFp,
      };
    case "naive":
      return null;
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
        fingerprint: certFp,
        "skip-cert-verify": skipCert,
      };
    case "socks":
      return { ...base, type: "socks5", username: auth.username, password: auth.password };
    case "http":
      return {
        ...base,
        type: "http",
        username: auth.username,
        password: auth.password,
        tls: Boolean(tls.enabled),
        "skip-cert-verify": skipCert,
        fingerprint: certFp,
      };
    default:
      return null;
  }
}

export async function renderMihomo(
  nodes: NormalizedNode[],
  profileTitle = "Sub Panel",
): Promise<{ body: string; skipped: Array<{ name: string; reason: string }> }> {
  const proxies: Record<string, unknown>[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const node of nodes) {
    const proxy = await toMihomoProxy(node);
    if (!proxy) {
      const reason = node.tls?.reality ? "mihomo_reality_missing_public_key" : "mihomo_unsupported";
      skipped.push({ name: node.name, reason });
      continue;
    }
    // Drop undefined fields so YAML stays clean.
    for (const key of Object.keys(proxy)) {
      if (proxy[key] === undefined) delete proxy[key];
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
