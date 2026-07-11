import type { NormalizedNode } from "../parsers/types.ts";

function toSurgeLine(node: NormalizedNode): string | null {
  if (!node.capability.includes("surge")) return null;
  const auth = node.auth || {};
  const tls = node.tls || {};
  if (node.protocol === "ss") {
    return node.name + " = ss, " + node.server + ", " + node.port + ", encrypt-method=" + auth.method + ", password=" + auth.password;
  }
  if (node.protocol === "trojan") {
    return node.name + " = trojan, " + node.server + ", " + node.port + ", password=" + auth.password + ", sni=" + (tls.serverName || node.server) + (tls.allowInsecure ? ", skip-cert-verify=true" : "");
  }
  if (node.protocol === "http") {
    return node.name + " = http, " + node.server + ", " + node.port + (auth.username ? ", username=" + auth.username + ", password=" + auth.password : "");
  }
  return null;
}

export function renderSurge(nodes: NormalizedNode[], profileTitle = "Sub Panel"): { body: string; skipped: Array<{ name: string; reason: string }> } {
  const lines: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const names: string[] = [];
  for (const node of nodes) {
    const line = toSurgeLine(node);
    if (!line) {
      skipped.push({ name: node.name, reason: "surge_unsupported" });
      continue;
    }
    lines.push(line);
    names.push(node.name);
  }
  const nl = String.fromCharCode(10);
  const body = [
    "#!MANAGED-CONFIG " + profileTitle,
    "[General]",
    "loglevel = notify",
    "",
    "[Proxy]",
    ...lines,
    "",
    "[Proxy Group]",
    "PROXY = select, " + (names.join(", ") || "DIRECT"),
    "",
    "[Rule]",
    "FINAL,PROXY",
  ].join(nl) + nl;
  return { body, skipped };
}
