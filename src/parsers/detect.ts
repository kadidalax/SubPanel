import YAML from "yaml";
import { capabilitiesFor } from "./capabilities.ts";
import { maybeDecodeBase64List, parseUriList, parseGenericUri } from "./uri.ts";
import type { NormalizedNode, ParseResult, ParseWarning, Protocol } from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstNonEmpty(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return undefined;
}

function normalizeReality(reality: unknown): Record<string, unknown> | undefined {
  if (!reality || typeof reality !== "object") return undefined;
  const r = reality as Record<string, unknown>;
  const publicKey = firstNonEmpty(r["public-key"], r.public_key, r.publicKey, r.pbk);
  const shortId = firstNonEmpty(r["short-id"], r.short_id, r.shortId, r.sid);
  if (!publicKey && !shortId && r.enabled == null) return r as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (publicKey) out.publicKey = publicKey;
  if (shortId) out.shortId = shortId;
  if (r.enabled != null) out.enabled = r.enabled;
  if (r["support-x25519mlkem768"] != null) out["support-x25519mlkem768"] = r["support-x25519mlkem768"];
  // preserve unknown keys lightly
  for (const [k, v] of Object.entries(r)) {
    if (["public-key", "public_key", "publicKey", "pbk", "short-id", "short_id", "shortId", "sid", "enabled", "support-x25519mlkem768"].includes(k)) continue;
    if (!(k in out)) out[k] = v;
  }
  return out;
}

function fromMihomoProxy(proxy: Record<string, unknown>, raw: string): NormalizedNode | null {
  const type = String(proxy.type || "").toLowerCase();
  const name = String(proxy.name || type);
  const server = String(proxy.server || ((proxy.peers as any)?.[0]?.server) || "");
  const port = Number(proxy.port || ((proxy.peers as any)?.[0]?.port) || 0);
  if ((!server || !port) && String(proxy.type || "").toLowerCase() !== "wireguard") return null;

  const map: Record<string, Protocol> = {
    vless: "vless",
    vmess: "vmess",
    trojan: "trojan",
    ss: "ss",
    shadowsocks: "ss",
    socks5: "socks",
    http: "http",
    hysteria2: "hysteria2",
    hy2: "hysteria2",
    hysteria: "hysteria",
    tuic: "tuic",
    wireguard: "wireguard",
    anytls: "anytls",
    naive: "naive",
    naiveproxy: "naive",
  };
  const protocol = map[type];
  if (!protocol) return null;

  const cert = proxy["ca-str"] || proxy.certificate || proxy.cert;
  // mihomo: fingerprint = cert pin (DER sha256); client-fingerprint = uTLS profile
  const certPin = firstNonEmpty(proxy.fingerprint, proxy.pinSHA256, proxy.pinSha256);
  const clientFp = firstNonEmpty(proxy["client-fingerprint"], proxy.clientFingerprint);
  const hasTls = Boolean(
    proxy.tls ||
      proxy.sni ||
      proxy.servername ||
      proxy["skip-cert-verify"] != null ||
      proxy["reality-opts"] ||
      cert ||
      certPin ||
      clientFp ||
      protocol === "trojan" ||
      protocol === "hysteria2" ||
      protocol === "hysteria" ||
      protocol === "tuic" ||
      protocol === "anytls",
  );
  const partial = {
    protocol,
    name,
    server,
    port,
    raw,
    auth: {
      uuid: proxy.uuid,
      password: proxy.password || proxy.auth || proxy["auth-str"],
      method: proxy.cipher || proxy.method,
      username: proxy.username,
      flow: proxy.flow,
      privateKey: proxy["private-key"] || proxy.private_key || proxy.privateKey,
      publicKey:
        proxy["public-key"] ||
        proxy.public_key ||
        proxy.publicKey ||
        ((proxy.peers as any)?.[0]?.["public-key"]),
      preSharedKey:
        proxy["pre-shared-key"] ||
        proxy.preshared_key ||
        ((proxy.peers as any)?.[0]?.["pre-shared-key"]),
    },
    tls: hasTls
      ? {
          enabled: Boolean(
            proxy.tls ||
              proxy["reality-opts"] ||
              cert ||
              certPin ||
              protocol === "trojan" ||
              protocol === "hysteria2" ||
              protocol === "hysteria" ||
              protocol === "tuic" ||
              protocol === "anytls",
          ),
          serverName: proxy.sni || proxy.servername || proxy.peer,
          allowInsecure: proxy["skip-cert-verify"],
          insecure: proxy["skip-cert-verify"],
          fingerprint: clientFp,
          alpn: proxy.alpn,
          reality: normalizeReality(proxy["reality-opts"]),
          certificate: cert,
        }
      : undefined,
    transport: {
      type: proxy.network || proxy["network"] || "tcp",
      path: (proxy["ws-opts"] as any)?.path || (proxy["h2-opts"] as any)?.path,
      host: (proxy["ws-opts"] as any)?.headers?.Host,
      serviceName: (proxy["grpc-opts"] as any)?.["grpc-service-name"],
    },
    extras: {
      udp: proxy.udp,
      up: proxy.up,
      down: proxy.down,
      obfs: proxy.obfs,
      obfsPassword: proxy["obfs-password"] || proxy.obfsPassword,
      ports: proxy.ports || proxy.mport,
      mport: proxy.ports || proxy.mport,
      ip: proxy.ip,
      ipv6: proxy.ipv6,
      mtu: proxy.mtu,
      reserved: proxy.reserved,
      allowedIPs: proxy["allowed-ips"] || ((proxy.peers as any)?.[0]?.["allowed-ips"]),
      localAddress: proxy.ip,
      auth: proxy.auth || proxy["auth-str"],
      certificate: cert,
      pinSHA256: certPin,
      congestionControl: proxy["congestion-controller"] || proxy.congestion_control,
      hopInterval: proxy["hop-interval"] ?? proxy.hop_interval ?? proxy.hopInterval,
      earlyData:
        (proxy["ws-opts"] as any)?.["max-early-data"] ?? (proxy["ws-opts"] as any)?.max_early_data,
      earlyDataHeaderName:
        (proxy["ws-opts"] as any)?.["early-data-header-name"] ??
        (proxy["ws-opts"] as any)?.early_data_header_name,
    },
  } as Omit<NormalizedNode, "capability">;
  return { ...partial, capability: capabilitiesFor(partial) };
}

function fromSingboxOutbound(ob: Record<string, unknown>, raw: string): NormalizedNode | null {
  const type = String(ob.type || "").toLowerCase();
  const name = String(ob.tag || type);
  const server = String(ob.server || "");
  const port = Number(ob.server_port || ob.port || 0);
  if ((!server || !port) && String(ob.type || "").toLowerCase() !== "wireguard") return null;
  const map: Record<string, Protocol> = {
    vless: "vless",
    vmess: "vmess",
    trojan: "trojan",
    shadowsocks: "ss",
    socks: "socks",
    http: "http",
    hysteria2: "hysteria2",
    hysteria: "hysteria",
    tuic: "tuic",
    wireguard: "wireguard",
    anytls: "anytls",
    naive: "naive",
  };
  const protocol = map[type];
  if (!protocol) return null;
  const tls = asRecord(ob.tls) || undefined;
  const transport = asRecord(ob.transport) || undefined;
  const utls = asRecord(tls?.utls);
  const clientFp = firstNonEmpty(utls?.fingerprint, tls?.fingerprint);
  const cert = tls
    ? Array.isArray(tls.certificate)
      ? tls.certificate[0]
      : tls.certificate
    : undefined;
  const ports = ob.server_ports || ob.server_port_ranges || ob.ports;
  const obfsObj = asRecord(ob.obfs);
  const partial = {
    protocol,
    name,
    server,
    port,
    raw,
    auth: {
      uuid: ob.uuid,
      password: ob.password || ob.auth || ob.auth_str,
      method: ob.method,
      username: ob.username,
      flow: ob.flow,
      privateKey: ob.private_key || ob.privateKey,
      publicKey: ob.peer_public_key || ob.public_key,
      preSharedKey: ob.pre_shared_key,
    },
    tls: tls
      ? {
          enabled: true,
          serverName: tls.server_name,
          allowInsecure: tls.insecure,
          insecure: tls.insecure,
          alpn: tls.alpn,
          fingerprint: clientFp,
          reality: normalizeReality(tls.reality),
          utls: tls.utls,
          certificate: cert,
        }
      : undefined,
    transport: transport
      ? {
          type: transport.type,
          path: transport.path,
          host: transport.headers && (transport.headers as any).Host,
          serviceName: transport.service_name,
        }
      : undefined,
    extras: {
      up: ob.up_mbps || ob.up,
      down: ob.down_mbps || ob.down,
      obfs: obfsObj ? obfsObj.type : ob.obfs,
      obfsPassword: obfsObj ? obfsObj.password : undefined,
      ports: Array.isArray(ports)
        ? ports.map((x) => String(x).replace(/:/g, "-")).join(",")
        : ports != null
          ? String(ports).replace(/:/g, "-")
          : undefined,
      mport: Array.isArray(ports)
        ? ports.map((x) => String(x).replace(/:/g, "-")).join(",")
        : ports != null
          ? String(ports).replace(/:/g, "-")
          : undefined,
      localAddress: ob.local_address,
      mtu: ob.mtu,
      reserved: ob.reserved,
      allowedIPs: Array.isArray(ob.peers) && ob.peers[0] ? (ob.peers[0] as any).allowed_ips : ob.allowed_ips,
      auth: ob.auth_str || ob.auth,
      certificate: cert,
      congestionControl: ob.congestion_control,
      hopInterval: ob.hop_interval ?? ob.hopInterval,
      pinSHA256: (() => {
        const pk = tls?.certificate_public_key_sha256 ?? tls?.certificatePublicKeySha256;
        if (Array.isArray(pk) && pk[0]) return String(pk[0]);
        if (pk != null && String(pk).trim()) return String(pk);
        return undefined;
      })(),
      earlyData: transport?.max_early_data,
      earlyDataHeaderName: transport?.early_data_header_name,
    },
  } as Omit<NormalizedNode, "capability">;
  return { ...partial, capability: capabilitiesFor(partial) };
}


function extractBalancedJson(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{" && text[i] !== "[") continue;
    const open = text[i];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

function tryParseClashProxyLines(block: string): NormalizedNode[] {
  const nodes: NormalizedNode[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("-")) line = line.replace(/^-\s*/, "");
    if (!line.startsWith("{") || !/\btype\s*:/.test(line)) continue;
    try {
      const proxy = YAML.parse(line) as Record<string, unknown>;
      if (!proxy || typeof proxy !== "object" || !proxy.type) continue;
      const node = fromMihomoProxy(proxy, line);
      if (node) nodes.push(node);
    } catch {
      /* ignore */
    }
  }
  return nodes;
}

function splitMixedBlocks(text: string): string[] {
  const parts = text
    .split(/\r?\n[-=*]{5,}\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^[-=*]{5,}$/.test(p) && !/^\*{5,}/.test(p));
  return parts.length > 1 ? parts : [text.trim()];
}

function parseBlock(text: string, warnings: ParseWarning[]): { nodes: NormalizedNode[]; detectedFormat: string } {
  const block = text.trim();
  if (!block) return { nodes: [], detectedFormat: "empty" };

  // Clash bare proxy lines: "- {name, type, server, ...}"
  if (!block.includes("proxies:") && !block.includes("proxy-groups:") && !block.includes("outbounds")) {
    const flow = tryParseClashProxyLines(block);
    if (flow.length) return { nodes: flow, detectedFormat: "mihomo" };
  }

  const jsonText = (() => {
    if (block.startsWith("{") || block.startsWith("[")) {
      return extractBalancedJson(block)[0] || block;
    }
    return extractBalancedJson(block).find((j) => j.includes("outbounds")) || "";
  })();

  if (jsonText.startsWith("{") || jsonText.startsWith("[")) {
    try {
      const data = JSON.parse(jsonText) as any;
      if (Array.isArray(data) && data[0]?.server && data[0]?.method) {
        const nodes: NormalizedNode[] = [];
        for (const item of data) {
          const partial = {
            protocol: String(item.method || "").startsWith("2022-blake3") ? "ss2022" : "ss",
            name: String(item.remarks || item.name || "ss"),
            server: String(item.server || ""),
            port: Number(item.server_port || item.port || 0),
            raw: JSON.stringify(item),
            auth: { method: item.method, password: item.password },
          } as Omit<NormalizedNode, "capability">;
          if (!partial.server || !partial.port) continue;
          nodes.push({ ...partial, capability: capabilitiesFor(partial) });
        }
        return { nodes, detectedFormat: "sip008" };
      }
      if (data && Array.isArray(data.outbounds)) {
        const nodes: NormalizedNode[] = [];
        const outbounds = data.outbounds.filter((ob: any) => ob && typeof ob === "object");
        const byTag = new Map<string, any>();
        for (const ob of outbounds) {
          if (ob.tag) byTag.set(String(ob.tag), ob);
        }
        const consumed = new Set<string>();
        for (const ob of outbounds) {
          const type = String(ob.type || "");
          if (["direct", "block", "dns", "selector", "urltest"].includes(type)) continue;
          if (type === "shadowtls") continue;
          if (ob.detour && byTag.has(String(ob.detour))) {
            const hop = byTag.get(String(ob.detour));
            if (String(hop?.type) === "shadowtls" && type === "shadowsocks") {
              const partial = {
                protocol: String(ob.method || "").startsWith("2022-blake3") ? "ss2022" : "ss",
                name: String(hop.tag || ob.tag || "ShadowTLS"),
                server: String(hop.server || ""),
                port: Number(hop.server_port || hop.port || 0),
                raw: JSON.stringify({ leaf: ob, hop }),
                auth: { method: ob.method, password: ob.password },
                tls: hop.tls
                  ? {
                      enabled: true,
                      serverName: hop.tls.server_name,
                      fingerprint: hop.tls.utls?.fingerprint,
                      allowInsecure: hop.tls.insecure,
                    }
                  : undefined,
                extras: {
                  shadowtls: {
                    version: hop.version ?? 3,
                    password: hop.password,
                    server: hop.server,
                    server_port: hop.server_port,
                    tls: hop.tls,
                  },
                  multiplex: ob.multiplex,
                  udp_over_tcp: ob.udp_over_tcp,
                },
              } as Omit<NormalizedNode, "capability">;
              if (partial.server && partial.port) {
                nodes.push({ ...partial, capability: capabilitiesFor(partial) });
                consumed.add(String(ob.tag || ""));
                consumed.add(String(hop.tag || ""));
                continue;
              }
            }
          }
          if (consumed.has(String(ob.tag || ""))) continue;
          const node = fromSingboxOutbound(ob, JSON.stringify(ob));
          if (node) nodes.push(node);
          else warnings.push({ code: "singbox_skipped", message: "unsupported outbound", raw: type });
        }
        for (const ob of outbounds) {
          if (String(ob.type) === "shadowtls" && !consumed.has(String(ob.tag || ""))) {
            warnings.push({ code: "singbox_skipped", message: "unpaired shadowtls hop", raw: String(ob.tag || "shadowtls") });
          }
        }
        return { nodes, detectedFormat: "singbox" };
      }
    } catch (err) {
      warnings.push({ code: "json_parse_error", message: err instanceof Error ? err.message : "json parse error" });
    }
  }

  if (block.includes("proxies:") || block.includes("proxy-groups:")) {
    try {
      const data = YAML.parse(block) as any;
      const proxies = Array.isArray(data?.proxies) ? data.proxies : [];
      const nodes: NormalizedNode[] = [];
      for (const proxy of proxies) {
        if (!proxy || typeof proxy !== "object") continue;
        const node = fromMihomoProxy(proxy, YAML.stringify(proxy));
        if (node) nodes.push(node);
        else warnings.push({ code: "mihomo_skipped", message: "unsupported proxy", raw: String(proxy.type || "") });
      }
      if (nodes.length || proxies.length) return { nodes, detectedFormat: "mihomo" };
    } catch (err) {
      warnings.push({ code: "yaml_parse_error", message: err instanceof Error ? err.message : "yaml parse error" });
    }
  }

  const uri = parseUriList(block);
  if (uri.nodes.length) {
    warnings.push(...uri.warnings);
    return { nodes: uri.nodes, detectedFormat: "uri-list" };
  }
  const one = parseGenericUri(block);
  if (one) return { nodes: [one], detectedFormat: "uri" };
  if (/^[a-z0-9+.-]+:\/\//i.test((block.split(/\r?\n/, 1)[0] || "").trim())) {
    warnings.push({ code: "uri_unparsed", message: "unable to parse uri", raw: block.slice(0, 200) });
  }
  return { nodes: [], detectedFormat: "unknown" };
}


function harvestMixed(text: string, warnings: ParseWarning[]): ParseResult {
  const nodes: NormalizedNode[] = [];
  const formats = new Set<string>();

  const uri = parseUriList(text);
  if (uri.nodes.length) {
    nodes.push(...uri.nodes);
    formats.add("uri-list");
  }
  warnings.push(...uri.warnings.filter((w) => w.code !== "uri_unparsed" || (w.raw || "").includes("://")));

  const clash = tryParseClashProxyLines(text);
  if (clash.length) {
    nodes.push(...clash);
    formats.add("mihomo");
  }

  for (const json of extractBalancedJson(text)) {
    if (!json.includes("outbounds") && !json.includes('"type"')) continue;
    const parsed = parseBlock(json, warnings);
    if (parsed.nodes.length) {
      nodes.push(...parsed.nodes);
      formats.add(parsed.detectedFormat);
    }
  }

  if (!nodes.length) {
    return { nodes: [], warnings, detectedFormat: "unknown" };
  }
  return {
    nodes,
    warnings,
    detectedFormat: formats.size === 1 ? [...formats][0] : "mixed",
  };
}

export function parseSubscriptionText(input: string, formatHint?: string | null): ParseResult {
  let text = input.trim();
  const warnings: ParseWarning[] = [];
  if (!text) return { nodes: [], warnings: [{ code: "empty", message: "empty content" }], detectedFormat: "empty" };

  const decoded = maybeDecodeBase64List(text);
  if (decoded) text = decoded.trim();
  const hint = (formatHint || "").toLowerCase();

  const blocks = splitMixedBlocks(text);
  if (blocks.length > 1 && !hint) {
    const nodes: NormalizedNode[] = [];
    const formats = new Set<string>();
    for (const block of blocks) {
      const parsed = parseBlock(block, warnings);
      nodes.push(...parsed.nodes);
      if (parsed.nodes.length) formats.add(parsed.detectedFormat);
    }
    const extra = harvestMixed(text, warnings);
    for (const n of extra.nodes) {
      const key = n.protocol + "|" + n.server + "|" + n.port + "|" + n.name;
      if (nodes.some((x) => x.protocol + "|" + x.server + "|" + x.port + "|" + x.name === key)) continue;
      nodes.push(n);
    }
    if (extra.detectedFormat && extra.detectedFormat !== "unknown") formats.add(extra.detectedFormat);
    if (nodes.length) {
      return {
        nodes,
        warnings,
        detectedFormat: formats.size === 1 ? [...formats][0] : "mixed",
      };
    }
  }

  if (hint === "singbox" || hint === "sip008" || text.startsWith("{") || text.startsWith("[")) {
    const one = parseBlock(text, warnings);
    if (one.nodes.length || one.detectedFormat === "singbox" || one.detectedFormat === "sip008") {
      return { nodes: one.nodes, warnings, detectedFormat: one.detectedFormat };
    }
  }

  if (hint === "mihomo" || hint === "clash" || text.includes("proxies:") || text.includes("proxy-groups:")) {
    const one = parseBlock(text, warnings);
    if (one.nodes.length || one.detectedFormat === "mihomo") {
      return { nodes: one.nodes, warnings, detectedFormat: one.detectedFormat };
    }
  }

  const uri = parseUriList(text);
  if (uri.nodes.length) {
    const looksMixed =
      text.includes("outbounds") ||
      /^-\s*\{/m.test(text) ||
      text.includes("type: hysteria2") ||
      text.includes("type: vless");
    if (looksMixed) {
      const mixed = harvestMixed(text, warnings);
      if (mixed.nodes.length > uri.nodes.length) return mixed;
    }
    return {
      nodes: uri.nodes,
      warnings: [...warnings, ...uri.warnings],
      detectedFormat: decoded ? "base64-uri-list" : "uri-list",
    };
  }

  const one = parseGenericUri(text);
  if (one) return { nodes: [one], warnings, detectedFormat: "uri" };

  if (blocks.length > 1) {
    const nodes: NormalizedNode[] = [];
    for (const block of blocks) nodes.push(...parseBlock(block, warnings).nodes);
    if (nodes.length) return { nodes, warnings, detectedFormat: "mixed" };
  }

  const harvested = harvestMixed(text, warnings);
  if (harvested.nodes.length) return harvested;

  return {
    nodes: [],
    warnings: [...warnings, { code: "unsupported_format", message: "unable to detect subscription format" }],
    detectedFormat: "unknown",
  };
}
