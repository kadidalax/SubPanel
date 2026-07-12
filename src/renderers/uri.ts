import type { NormalizedNode } from "../parsers/types.ts";

export type UriRenderMeta = {
  certNodes: number;
  v2raynFallback: number;
};

function nodeCertRaw(node: NormalizedNode): string {
  return String(node.tls?.certificate || node.extras?.certificate || "").trim();
}

export function nodeHasCert(node: NormalizedNode): boolean {
  return nodeCertRaw(node).length > 0;
}

/** Normalize PEM/text cert for share-link export. */
export function normalizeCert(input: string): { pem: string; pemB64: string } | null {
  let s = String(input || "").trim();
  if (!s) return null;
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!s) return null;
  // If it looks like base64 body without headers, wrap as PEM.
  if (!/BEGIN CERTIFICATE/i.test(s) && /^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, "").length > 64) {
    const body = s.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n").replace(/\n$/, "");
    s = "-----BEGIN CERTIFICATE-----\n" + body + "\n-----END CERTIFICATE-----";
  }
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const pemB64 = btoa(bin);
  return { pem: s, pemB64 };
}

export function lineHasCertParam(line: string): boolean {
  try {
    const u = new URL(line);
    for (const key of ["cert", "certificate", "ca", "ca-str", "ca_str"]) {
      const v = u.searchParams.get(key);
      if (v && v.trim()) return true;
    }
  } catch {
    /* ignore */
  }
  return /(?:^|[?&#])(cert|certificate|ca|ca-str)=/i.test(line);
}

function applyCertToSearchParams(q: URLSearchParams, certInput: string): boolean {
  const norm = normalizeCert(certInput);
  if (!norm) return false;
  // Primary: LF-normalized PEM via URLSearchParams encoding.
  q.set("cert", norm.pem);
  // Compatibility alias used by some clash/meta style importers.
  q.set("ca", norm.pemB64);
  return true;
}

function insecureFlag(node: NormalizedNode): boolean {
  return Boolean(node.tls?.insecure || node.tls?.allowInsecure);
}

/**
 * Prefer standard share links for broad client compatibility (NekoBox, v2rayNG, etc.).
 * v2rayn:// private wrappers are only kept when preferRawV2rayn=true, or as single-node
 * fallback when a node has a cert we failed to attach to a standard link.
 */
function rebuildUri(
  node: NormalizedNode,
  preferRawV2rayn = false,
): { line: string | null; usedV2raynFallback: boolean; exportedCert: boolean } {
  const raw = (node.raw || "").trim();
  const certInput = nodeCertRaw(node);
  const hasCert = certInput.length > 0;

  if (preferRawV2rayn && raw.toLowerCase().startsWith("v2rayn://")) {
    return { line: raw, usedV2raynFallback: false, exportedCert: hasCert };
  }

  // Already-standard share link: keep when it still carries cert if needed.
  if (raw.includes("://") && !raw.startsWith("{") && !raw.toLowerCase().startsWith("v2rayn://")) {
    if (!hasCert || lineHasCertParam(raw) || raw.includes(certInput)) {
      return {
        line: raw,
        usedV2raynFallback: false,
        exportedCert: hasCert && (lineHasCertParam(raw) || raw.includes(certInput)),
      };
    }
  }

  let line: string | null = null;

  if (node.protocol === "hysteria") {
    const password = String(node.auth?.password || node.extras?.auth || "");
    if (node.server && node.port) {
      const q = new URLSearchParams();
      const sni = String(node.tls?.serverName || "");
      if (sni) q.set("peer", sni);
      if (node.extras?.up) q.set("up", String(node.extras.up));
      if (node.extras?.down) q.set("down", String(node.extras.down));
      if (node.extras?.obfs) q.set("obfs", String(node.extras.obfs));
      if (insecureFlag(node)) q.set("insecure", "1");
      if (hasCert) applyCertToSearchParams(q, certInput);
      const auth = password ? encodeURIComponent(password) + "@" : "";
      line =
        "hysteria://" +
        auth +
        node.server +
        ":" +
        node.port +
        "?" +
        q.toString() +
        "#" +
        encodeURIComponent(node.name || "hysteria");
    }
  } else if (node.protocol === "hysteria2") {
    const password = String(node.auth?.password || "");
    if (password && node.server && node.port) {
      const q = new URLSearchParams();
      const sni = String(node.tls?.serverName || "");
      if (sni) q.set("sni", sni);
      const insecure = insecureFlag(node);
      q.set("insecure", insecure ? "1" : "0");
      q.set("allowInsecure", insecure ? "1" : "0");
      const ports = String(node.extras?.ports || node.extras?.mport || "");
      if (ports) q.set("mport", ports);
      if (hasCert) applyCertToSearchParams(q, certInput);
      if (node.extras?.obfs) q.set("obfs", String(node.extras.obfs));
      if (node.extras?.obfsPassword) q.set("obfs-password", String(node.extras.obfsPassword));
      line =
        "hysteria2://" +
        encodeURIComponent(password) +
        "@" +
        node.server +
        ":" +
        node.port +
        "?" +
        q.toString() +
        "#" +
        encodeURIComponent(node.name || "hysteria2");
    }
  } else if (node.protocol === "anytls") {
    const password = String(node.auth?.password || "");
    if (password && node.server && node.port) {
      const q = new URLSearchParams();
      if (node.tls?.serverName) q.set("sni", String(node.tls.serverName));
      if (node.tls?.fingerprint) q.set("fp", String(node.tls.fingerprint));
      if (insecureFlag(node)) q.set("insecure", "1");
      if (hasCert) applyCertToSearchParams(q, certInput);
      line =
        "anytls://" +
        encodeURIComponent(password) +
        "@" +
        node.server +
        ":" +
        node.port +
        "?" +
        q.toString() +
        "#" +
        encodeURIComponent(node.name || "anytls");
    }
  } else if (node.protocol === "naive") {
    const user = String(node.auth?.username || "");
    const password = String(node.auth?.password || "");
    if (password && node.server && node.port) {
      const auth = user
        ? encodeURIComponent(user) + ":" + encodeURIComponent(password)
        : encodeURIComponent(password);
      const q = new URLSearchParams();
      if (node.tls?.serverName) q.set("sni", String(node.tls.serverName));
      if (insecureFlag(node)) {
        q.set("insecure", "1");
        q.set("allowInsecure", "1");
      }
      if (hasCert) applyCertToSearchParams(q, certInput);
      if (node.extras?.quic) q.set("quic", "1");
      line =
        "naive+https://" +
        auth +
        "@" +
        node.server +
        ":" +
        node.port +
        "?" +
        q.toString() +
        "#" +
        encodeURIComponent(node.name || "naive");
    }
  } else if ((node.protocol === "ss" || node.protocol === "ss2022") && node.extras?.shadowtls) {
    line = null;
  } else if (node.protocol === "tuic") {
    const uuid = String(node.auth?.uuid || "");
    const password = String(node.auth?.password || "");
    if (uuid && node.server && node.port) {
      const q = new URLSearchParams();
      if (node.tls?.serverName) q.set("sni", String(node.tls.serverName));
      if (node.extras?.congestionControl) q.set("congestion_control", String(node.extras.congestionControl));
      if (hasCert) applyCertToSearchParams(q, certInput);
      if (insecureFlag(node)) q.set("allowInsecure", "1");
      line =
        "tuic://" +
        encodeURIComponent(uuid) +
        ":" +
        encodeURIComponent(password) +
        "@" +
        node.server +
        ":" +
        node.port +
        "?" +
        q.toString() +
        "#" +
        encodeURIComponent(node.name || "tuic");
    }
  } else if (node.protocol === "trojan") {
    const password = String(node.auth?.password || "");
    if (password && node.server && node.port) {
      const q = new URLSearchParams();
      if (node.tls?.serverName) q.set("sni", String(node.tls.serverName));
      if (insecureFlag(node)) q.set("allowInsecure", "1");
      if (hasCert) applyCertToSearchParams(q, certInput);
      line =
        "trojan://" +
        encodeURIComponent(password) +
        "@" +
        node.server +
        ":" +
        node.port +
        "?" +
        q.toString() +
        "#" +
        encodeURIComponent(node.name || "trojan");
    }
  } else if (raw.includes("://") && !raw.startsWith("{") && !raw.toLowerCase().startsWith("v2rayn://")) {
    line = raw;
  }

  if (line && hasCert && !lineHasCertParam(line)) {
    // Standard rebuild failed to carry cert: single-node v2rayn fallback when available.
    if (!preferRawV2rayn && raw.toLowerCase().startsWith("v2rayn://")) {
      return { line: raw, usedV2raynFallback: true, exportedCert: true };
    }
    return { line: null, usedV2raynFallback: false, exportedCert: false };
  }

  if (!line && !preferRawV2rayn && hasCert && raw.toLowerCase().startsWith("v2rayn://")) {
    return { line: raw, usedV2raynFallback: true, exportedCert: true };
  }

  return {
    line,
    usedV2raynFallback: false,
    exportedCert: Boolean(line && hasCert && lineHasCertParam(line)),
  };
}

export function renderUriList(
  nodes: NormalizedNode[],
  opts: { preferRawV2rayn?: boolean } = {},
): {
  body: string;
  skipped: Array<{ name: string; reason: string }>;
  meta: UriRenderMeta;
} {
  const preferRawV2rayn = Boolean(opts.preferRawV2rayn);
  const lines: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  let certNodes = 0;
  let v2raynFallback = 0;
  for (const node of nodes) {
    if (!node.capability.includes("uri")) {
      skipped.push({ name: node.name, reason: "uri_unsupported" });
      continue;
    }
    const out = rebuildUri(node, preferRawV2rayn);
    if (!out.line) {
      skipped.push({
        name: node.name,
        reason: nodeHasCert(node) ? "uri_cert_export_failed" : "uri_rebuild_unsupported",
      });
      continue;
    }
    if (out.usedV2raynFallback) v2raynFallback += 1;
    if (out.exportedCert) certNodes += 1;
    lines.push(out.line);
  }
  const nl = String.fromCharCode(10);
  return {
    body: lines.join(nl) + (lines.length ? nl : ""),
    skipped,
    meta: { certNodes, v2raynFallback },
  };
}
