export type Protocol =
  | "vless"
  | "vmess"
  | "trojan"
  | "ss"
  | "ss2022"
  | "socks"
  | "http"
  | "hysteria2"
  | "tuic"
  | "wireguard"
  | "hysteria"
  | "ssr"
  | "anytls"
  | "naive"
  | "unknown";

export type OutputFormat = "mihomo" | "singbox" | "uri" | "surge";
export type DeliveryFormat = OutputFormat | "uri-base64";

export interface NormalizedNode {
  protocol: Protocol;
  name: string;
  server: string;
  port: number;
  raw: string;
  auth?: Record<string, unknown>;
  tls?: Record<string, unknown>;
  transport?: Record<string, unknown>;
  extras?: Record<string, unknown>;
  capability: OutputFormat[];
}

export interface ParseWarning {
  code: string;
  message: string;
  raw?: string;
}

export interface ParseResult {
  nodes: NormalizedNode[];
  warnings: ParseWarning[];
  detectedFormat: string;
}
