import type { Env } from "../env.ts";
import type { DeliveryFormat, NormalizedNode, OutputFormat } from "../parsers/types.ts";
import { renderProfile } from "../renderers/index.ts";
import { readVars } from "../env.ts";
import { nowMs } from "../util/time.ts";
import { getSubscriptionGroupIds, loadSubscriptionNodes } from "./subscription_groups.ts";

export type HealthStatus = "ok" | "warn" | "blocked";

export type FormatHealth = {
  renderable: number;
  skipped: Array<{ name: string; reason: string }>;
};

export type SubscriptionHealth = {
  status: HealthStatus;
  nodeTotal: number;
  nodeActive: number;
  byFormat: Record<DeliveryFormat, FormatHealth>;
  devices: { used: number; limit: number | null; windowDays: number };
  usage: {
    mode: "none" | "manual" | "upstream_exclusive" | string;
    usedBytes: number | null;
    limitBytes: number | null;
    percent: number | null;
    label: string;
  };
  expireAt: number | null;
  daysToExpire: number | null;
  warnings: string[];
  disabledReason: string | null;
  enabled: boolean;
  skipByProtocol: Record<string, number>;
};

const FORMATS: DeliveryFormat[] = ["mihomo", "singbox", "uri", "uri-base64", "surge"];

async function latestSourceUsage(env: Env, sourceId: number) {
  return env.DB.prepare(
    "SELECT upload_bytes, download_bytes, total_bytes, expire_at FROM source_usage_snapshots WHERE source_id = ? ORDER BY captured_at DESC LIMIT 1",
  )
    .bind(sourceId)
    .first<{
      upload_bytes: number | null;
      download_bytes: number | null;
      total_bytes: number | null;
      expire_at: number | null;
    }>();
}

export async function buildSubscriptionHealth(env: Env, sub: any): Promise<SubscriptionHealth> {
  const now = nowMs();
  const vars = readVars(env);
  const warnings: string[] = [];
  const groupIds = await getSubscriptionGroupIds(env, Number(sub.id));
  const gids = groupIds.length ? groupIds : (sub.group_id ? [Number(sub.group_id)] : []);
  const nodes = await loadSubscriptionNodes(env, Number(sub.id), sub.group_id ? Number(sub.group_id) : undefined);

  let nodeTotal = 0;
  if (gids.length) {
    const ph = gids.map(() => "?").join(",");
    const totalRow = await env.DB.prepare(
      "SELECT COUNT(DISTINCT sn.id) AS c FROM group_nodes gn JOIN source_nodes sn ON sn.id = gn.node_id WHERE gn.group_id IN (" + ph + ")",
    )
      .bind(...gids)
      .first<{ c: number }>();
    nodeTotal = Number(totalRow?.c || 0);
  }

  const byFormat = {} as Record<DeliveryFormat, FormatHealth>;
  const skipByProtocol: Record<string, number> = {};
  for (const format of FORMATS) {
    const baseFormat: OutputFormat | "uri-base64" = format;
    const rendered = renderProfile(baseFormat === "uri-base64" ? "uri" : baseFormat, nodes);
    byFormat[format] = {
      renderable: nodes.length - rendered.skipped.length,
      skipped: rendered.skipped.slice(0, 50),
    };
    if (rendered.skipped.length) {
      warnings.push(format + " 跳过 " + rendered.skipped.length + " 个节点");
    }
  }
  for (const fmt of FORMATS) {
    for (const s of byFormat[fmt].skipped) {
      const key = s.name || "unknown";
      skipByProtocol[key] = (skipByProtocol[key] || 0) + 1;
    }
  }
  const nameToProto = new Map(nodes.map((n) => [n.name, n.protocol]));
  const protocolSkip: Record<string, number> = {};
  for (const [name, count] of Object.entries(skipByProtocol)) {
    const proto = nameToProto.get(name) || "unknown";
    protocolSkip[proto] = (protocolSkip[proto] || 0) + count;
  }

  const windowStart = now - vars.deviceWindowMs;
  const deviceUsed = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM subscription_devices WHERE subscription_id = ? AND last_seen_at >= ?",
  )
    .bind(sub.id, windowStart)
    .first<{ c: number }>();

  let usedBytes: number | null = null;
  let label = "不限流量";
  if (sub.usage_mode === "manual") {
    usedBytes = Number(sub.manual_used_bytes || 0);
    label = "手工已用";
  } else if (sub.usage_mode === "upstream_exclusive" && sub.exclusive_source_id) {
    const usage = await latestSourceUsage(env, Number(sub.exclusive_source_id));
    if (usage) {
      usedBytes =
        usage.total_bytes != null
          ? Number(usage.total_bytes)
          : Number(usage.upload_bytes || 0) + Number(usage.download_bytes || 0);
    } else {
      usedBytes = 0;
    }
    label = "上游账号总流量";
  } else {
    label = "未启用流量统计";
  }

  const limitBytes = sub.traffic_limit_bytes == null ? null : Number(sub.traffic_limit_bytes);
  const percent =
    usedBytes != null && limitBytes != null && limitBytes > 0
      ? Math.min(100, Math.floor((usedBytes / limitBytes) * 100))
      : null;

  const expireAt = sub.expire_at == null ? null : Number(sub.expire_at);
  const daysToExpire = expireAt == null ? null : Math.ceil((expireAt - now) / 86400000);
  const enabled = Number(sub.enabled) === 1;
  const disabledReason = sub.disabled_reason ?? null;

  const degraded = gids.length
    ? await env.DB.prepare(
        "SELECT DISTINCT src.name AS name, src.failure_count AS failure_count, src.enabled AS enabled FROM group_nodes gn JOIN source_nodes sn ON sn.id = gn.node_id JOIN sources src ON src.id = sn.source_id WHERE gn.group_id IN (" +
          gids.map(() => "?").join(",") +
          ") AND (src.failure_count > 0 OR src.enabled = 0) LIMIT 10",
      )
        .bind(...gids)
        .all<any>()
    : { results: [] as any[] };
  for (const row of degraded.results ?? []) {
    if (Number(row.enabled) !== 1) warnings.push("源已停用：" + row.name);
    else warnings.push("源异常：" + row.name + "（失败 " + row.failure_count + " 次）");
  }

  if (!enabled) warnings.push(disabledReason ? "已停用（" + disabledReason + "）" : "已停用");
  if (expireAt != null && expireAt <= now) warnings.push("订阅已到期");
  else if (daysToExpire != null && daysToExpire <= 7 && daysToExpire >= 0) warnings.push(daysToExpire + " 天后到期");
  if (percent != null && percent >= 80) warnings.push("流量已用 " + percent + "%");
  if (nodes.length === 0) warnings.push("订阅关联分组无可用节点");

  let status: HealthStatus = "ok";
  const trafficBlocked =
    limitBytes != null && usedBytes != null && usedBytes >= limitBytes && sub.usage_mode !== "none";
  if (!enabled || (expireAt != null && expireAt <= now) || trafficBlocked || nodes.length === 0) {
    status = "blocked";
  } else if (
    (daysToExpire != null && daysToExpire <= 7) ||
    (percent != null && percent >= 80) ||
    byFormat.mihomo.skipped.length > 0 ||
    byFormat.uri.skipped.length > 0
  ) {
    status = "warn";
  }

  return {
    status,
    nodeTotal,
    nodeActive: nodes.length,
    byFormat,
    devices: {
      used: Number(deviceUsed?.c || 0),
      limit: sub.device_limit == null ? null : Number(sub.device_limit),
      windowDays: Math.round(vars.deviceWindowMs / 86400000),
    },
    usage: { mode: sub.usage_mode, usedBytes, limitBytes, percent, label },
    expireAt,
    daysToExpire,
    warnings: [...new Set(warnings)],
    disabledReason,
    enabled,
    skipByProtocol: protocolSkip,
  };
}
