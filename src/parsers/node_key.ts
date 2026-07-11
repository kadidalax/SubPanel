import type { NormalizedNode } from "./types.ts";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (key === "name" || key === "raw") continue;
      out[key] = stable(obj[key]);
    }
    return out;
  }
  return value;
}

export async function nodeKey(node: NormalizedNode): Promise<string> {
  const payload = JSON.stringify({
    protocol: node.protocol,
    server: node.server,
    port: node.port,
    auth: stable(node.auth ?? {}),
    tls: stable(node.tls ?? {}),
    transport: stable(node.transport ?? {}),
    extras: stable(node.extras ?? {}),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
