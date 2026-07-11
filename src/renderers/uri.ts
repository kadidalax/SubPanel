import type { NormalizedNode } from "../parsers/types.ts";

function rebuildUri(node: NormalizedNode): string | null {
  const cert = String(node.tls?.certificate || node.extras?.certificate || "");
  // Keep original raw when it already embeds cert OR is a v2rayn wrapper that carries Cert JSON.
  // Rebuilding v2rayn→hysteria2:// with cert= is not accepted by many clients.
  if (node.raw && node.raw.includes("://") && !node.raw.trim().startsWith("{")) {
    const raw = node.raw.trim();
    if (raw.startsWith("v2rayn://") && cert) return raw;
    if (!raw.startsWith("v2rayn://") && (!cert || raw.includes(cert) || /[?&](cert|certificate|ca-str|ca)=/i.test(raw))) {
      return raw;
    }
  }

  if (node.protocol === "hysteria") {
    const password = String(node.auth?.password || node.extras?.auth || "");
    if (!node.server || !node.port) return null;
    const q = new URLSearchParams();
    const sni = String(node.tls?.serverName || "");
    if (sni) q.set("peer", sni);
    if (node.extras?.up) q.set("up", String(node.extras.up));
    if (node.extras?.down) q.set("down", String(node.extras.down));
    if (node.extras?.obfs) q.set("obfs", String(node.extras.obfs));
    if (node.tls?.insecure || node.tls?.allowInsecure) q.set("insecure", "1");
    const auth = password ? encodeURIComponent(password) + "@" : "";
    return "hysteria://" + auth + node.server + ":" + node.port + "?" + q.toString() + "#" + encodeURIComponent(node.name || "hysteria");
  }

  if (node.protocol === "hysteria2") {
    const password = String(node.auth?.password || "");
    if (!password || !node.server || !node.port) return null;
    const q = new URLSearchParams();
    const sni = String(node.tls?.serverName || "");
    if (sni) q.set("sni", sni);
    const insecure = Boolean(node.tls?.insecure || node.tls?.allowInsecure);
    q.set("insecure", insecure ? "1" : "0");
    q.set("allowInsecure", insecure ? "1" : "0");
    const ports = String(node.extras?.ports || node.extras?.mport || "");
    if (ports) q.set("mport", ports);
    const cert = String(node.tls?.certificate || node.extras?.certificate || "");
    if (cert) q.set("cert", cert);
    if (node.extras?.obfs) q.set("obfs", String(node.extras.obfs));
    if (node.extras?.obfsPassword) q.set("obfs-password", String(node.extras.obfsPassword));
    const name = encodeURIComponent(node.name || "hysteria2");
    return `hysteria2://${encodeURIComponent(password)}@${node.server}:${node.port}?${q.toString()}#${name}`;
  }

  
  if (node.protocol === "anytls") {
    const password = String(node.auth?.password || "");
    if (!password || !node.server || !node.port) return null;
    const q = new URLSearchParams();
    if (node.tls?.serverName) q.set("sni", String(node.tls.serverName));
    if (node.tls?.fingerprint) q.set("fp", String(node.tls.fingerprint));
    const insecure = Boolean(node.tls?.insecure || node.tls?.allowInsecure);
    if (insecure) q.set("insecure", "1");
    const c = String(node.tls?.certificate || node.extras?.certificate || "");
    if (c) q.set("cert", c);
    return "anytls://" + encodeURIComponent(password) + "@" + node.server + ":" + node.port + "?" + q.toString() + "#" + encodeURIComponent(node.name || "anytls");
  }

  if (node.protocol === "naive") {
    const user = String(node.auth?.username || "");
    const password = String(node.auth?.password || "");
    if (!password || !node.server || !node.port) return null;
    const auth = user ? encodeURIComponent(user) + ":" + encodeURIComponent(password) : encodeURIComponent(password);
    const q = new URLSearchParams();
    if (node.tls?.serverName) q.set("sni", String(node.tls.serverName));
    if (node.extras?.quic) q.set("quic", "1");
    return "naive+https://" + auth + "@" + node.server + ":" + node.port + "?" + q.toString() + "#" + encodeURIComponent(node.name || "naive");
  }

  if ((node.protocol === "ss" || node.protocol === "ss2022") && node.extras?.shadowtls) {
    return null;
  }

  if (node.protocol === "tuic") {
    const uuid = String(node.auth?.uuid || "");
    const password = String(node.auth?.password || "");
    if (!uuid || !node.server || !node.port) return null;
    const q = new URLSearchParams();
    if (node.tls?.serverName) q.set("sni", String(node.tls.serverName));
    if (node.extras?.congestionControl) q.set("congestion_control", String(node.extras.congestionControl));
    return "tuic://" + encodeURIComponent(uuid) + ":" + encodeURIComponent(password) + "@" + node.server + ":" + node.port + "?" + q.toString() + "#" + encodeURIComponent(node.name || "tuic");
  }

  if (node.protocol === "trojan" && (!node.raw || node.raw.startsWith("v2rayn://"))) {
    const password = String(node.auth?.password || "");
    if (!password || !node.server || !node.port) return null;
    const q = new URLSearchParams();
    if (node.tls?.serverName) q.set("sni", String(node.tls.serverName));
    return "trojan://" + encodeURIComponent(password) + "@" + node.server + ":" + node.port + "?" + q.toString() + "#" + encodeURIComponent(node.name || "trojan");
  }

// fall back to original raw for other protocols
  if (node.raw && node.raw.includes("://") && !node.raw.trim().startsWith("{")) {
    return node.raw.trim();
  }
  return null;
}

export function renderUriList(nodes: NormalizedNode[]): { body: string; skipped: Array<{ name: string; reason: string }> } {
  const lines: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const node of nodes) {
    if (!node.capability.includes("uri")) {
      skipped.push({ name: node.name, reason: "uri_unsupported" });
      continue;
    }
    const line = rebuildUri(node);
    if (!line) {
      skipped.push({ name: node.name, reason: "uri_rebuild_unsupported" });
      continue;
    }
    lines.push(line);
  }
  const nl = String.fromCharCode(10);
  return { body: lines.join(nl) + (lines.length ? nl : ""), skipped };
}
