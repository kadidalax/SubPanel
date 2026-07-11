import type { NormalizedNode, OutputFormat, Protocol } from "./types.ts";

/**
 * Base output formats by protocol.
 * Aligned to current mainline:
 * - mihomo Meta (Clash Meta): wiki.metacubex.one
 * - sing-box: sing-box.sagernet.org outbound list
 * - Surge: Mac/iOS stock proxy line (ss / trojan / http only in our emitter)
 * - uri: share-link rebuild or passthrough
 *
 * Naive: sing-box yes; mihomo Meta has no native naive outbound.
 * AnyTLS: both mihomo + sing-box; mihomo rejects AnyTLS+Reality.
 * SSR: legacy share-link only, not rebuilt into modern profiles.
 */
const BASE: Record<Protocol, OutputFormat[]> = {
  vless: ["mihomo", "singbox", "uri"],
  vmess: ["mihomo", "singbox", "uri"],
  trojan: ["mihomo", "singbox", "uri", "surge"],
  ss: ["mihomo", "singbox", "uri", "surge"],
  ss2022: ["mihomo", "singbox", "uri"],
  socks: ["mihomo", "singbox", "uri"],
  http: ["mihomo", "singbox", "uri", "surge"],
  hysteria2: ["mihomo", "singbox", "uri"],
  tuic: ["mihomo", "singbox", "uri"],
  wireguard: ["mihomo", "singbox"],
  hysteria: ["mihomo", "singbox", "uri"],
  ssr: ["uri"],
  anytls: ["mihomo", "singbox", "uri"],
  // mihomo Meta: no native naive / naiveproxy outbound
  naive: ["singbox", "uri"],
  unknown: [],
};

export function capabilitiesFor(node: Omit<NormalizedNode, "capability">): OutputFormat[] {
  let base = [...(BASE[node.protocol] ?? [])];
  const tls = (node.tls || {}) as Record<string, unknown>;
  const transport = (node.transport || {}) as Record<string, unknown>;
  const extras = (node.extras || {}) as Record<string, unknown>;
  const tType = String(transport.type || "").toLowerCase();

  // ShadowTLS hop: not representable as Surge line
  if (extras.shadowtls) base = base.filter((f) => f !== "surge");

  // Reality: Surge stock cannot express; keep mihomo/singbox/uri
  if (tls.reality) {
    base = base.filter((f) => f !== "surge");
    // mihomo: AnyTLS + Reality unsupported (and will not be)
    if (node.protocol === "anytls") base = base.filter((f) => f !== "mihomo");
  }

  // gRPC / h2 / xhttp: Surge stock unsupported
  if (["grpc", "h2", "httpupgrade", "xhttp", "splithttp"].includes(tType)) {
    base = base.filter((f) => f !== "surge");
  }

  if (node.protocol === "anytls" || node.protocol === "naive" || node.protocol === "ss2022") {
    base = base.filter((f) => f !== "surge");
  }

  // ss2022 methods are not classic Surge ss cipher lines
  if (node.protocol === "ss") {
    const method = String((node.auth || {}).method || "");
    if (method.startsWith("2022-blake3")) base = base.filter((f) => f !== "surge");
  }

  return base;
}

export type CompatCell = {
  format: OutputFormat;
  ok: boolean;
  note?: string;
};

export type CompatRow = {
  protocol: Protocol;
  formats: OutputFormat[];
  cells: CompatCell[];
  notes: string[];
  kernels: { mihomo: string; singbox: string; surge: string; uri: string };
};

const ALL_FORMATS: OutputFormat[] = ["mihomo", "singbox", "uri", "surge"];

/** Static matrix for admin UI — reflects mainline kernel support + our emitters. */
export function buildCompatMatrix(): CompatRow[] {
  const protocols: Protocol[] = [
    "vless", "vmess", "trojan", "ss", "ss2022", "socks", "http",
    "hysteria2", "tuic", "wireguard", "hysteria", "ssr", "anytls", "naive",
  ];

  return protocols.map((protocol) => {
    const formats = capabilitiesFor({
      protocol,
      name: protocol,
      server: "example.com",
      port: 443,
      auth: {},
      tls: { enabled: true },
      transport: { type: "tcp" },
      extras: {},
      raw: "",
    });

    const notes: string[] = [];
    const kernels = {
      mihomo: "—",
      singbox: "—",
      surge: "—",
      uri: "—",
    };

    switch (protocol) {
      case "vless":
        kernels.mihomo = "Reality / vision / ws·grpc·xhttp";
        kernels.singbox = "Reality / vision / 多传输";
        kernels.surge = "无原生 VLESS";
        kernels.uri = "vless://";
        notes.push("Reality / gRPC / h2 时自动去掉 surge");
        notes.push("flow=xtls-rprx-vision 需 TLS/Reality");
        break;
      case "vmess":
        kernels.mihomo = "ws / grpc / Reality(有限)";
        kernels.singbox = "完整";
        kernels.surge = "不支持";
        kernels.uri = "vmess://";
        break;
      case "trojan":
        kernels.mihomo = "+ Reality";
        kernels.singbox = "完整";
        kernels.surge = "基础行";
        kernels.uri = "trojan://";
        notes.push("Reality / 复杂传输时 surge skip");
        break;
      case "ss":
        kernels.mihomo = "+ shadow-tls 插件";
        kernels.singbox = "+ shadowtls 链";
        kernels.surge = "经典 cipher";
        kernels.uri = "ss://";
        notes.push("挂 ShadowTLS 时去掉 surge");
        notes.push("method 为 2022-blake3-* 时按 ss2022 处理且无 surge");
        break;
      case "ss2022":
        kernels.mihomo = "完整";
        kernels.singbox = "完整";
        kernels.surge = "无 2022 行";
        kernels.uri = "ss:// (2022 method)";
        break;
      case "socks":
        kernels.mihomo = "socks5";
        kernels.singbox = "完整";
        kernels.surge = "本面板未发";
        kernels.uri = "socks5://";
        break;
      case "http":
        kernels.mihomo = "完整";
        kernels.singbox = "完整";
        kernels.surge = "http/https";
        kernels.uri = "http(s)://";
        break;
      case "hysteria2":
        kernels.mihomo = "ports/mport · salamander obfs";
        kernels.singbox = "server_ports 跳端口";
        kernels.surge = "不支持";
        kernels.uri = "hy2:// · cert/mport 保留";
        notes.push("证书字段透传，不因能力矩阵删除");
        break;
      case "tuic":
        kernels.mihomo = "v5";
        kernels.singbox = "完整";
        kernels.surge = "不支持";
        kernels.uri = "tuic://";
        break;
      case "wireguard":
        kernels.mihomo = "完整";
        kernels.singbox = "endpoint 形态";
        kernels.surge = "不支持";
        kernels.uri = "无通用分享链";
        notes.push("字段不全时渲染 skip");
        break;
      case "hysteria":
        kernels.mihomo = "v1（遗留）";
        kernels.singbox = "v1（遗留，字段将弃用）";
        kernels.surge = "不支持";
        kernels.uri = "hysteria://";
        notes.push("优先 hy2；v1 解析较薄");
        break;
      case "ssr":
        kernels.mihomo = "主线已移除";
        kernels.singbox = "不支持";
        kernels.surge = "不支持";
        kernels.uri = "仅原样透传";
        notes.push("不标准化、不进 mihomo/singbox 节点池输出");
        break;
      case "anytls":
        kernels.mihomo = "支持（不含 Reality）";
        kernels.singbox = "完整";
        kernels.surge = "不支持";
        kernels.uri = "anytls://";
        notes.push("AnyTLS+Reality → mihomo skip（官方明确不支持）");
        break;
      case "naive":
        kernels.mihomo = "无原生 outbound";
        kernels.singbox = "naiveproxy";
        kernels.surge = "不支持";
        kernels.uri = "naive+https://";
        notes.push("最新 mihomo Meta 无 naive 实现，仅 sing-box / uri");
        break;
    }

    const cells: CompatCell[] = ALL_FORMATS.map((format) => ({
      format,
      ok: formats.includes(format),
      note: kernels[format],
    }));

    return { protocol, formats, cells, notes, kernels };
  });
}