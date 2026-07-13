import type { Env } from "../env.ts";
import { sha256Text } from "../crypto/hash.ts";
import { randomToken } from "../util/ids.ts";
import { nowMs } from "../util/time.ts";
import type { DeliveryFormat, NormalizedNode, OutputFormat } from "../parsers/types.ts";
import { detectClient } from "./client_detect.ts";
import { normalizeDeliveryFormat, renderProfile } from "../renderers/index.ts";
import { readVars } from "../env.ts";
import { getSettingNumber, getSettingString } from "./settings.ts";
import { decryptSecret, encryptSecret } from "./credentials.ts";
import {
  countSubscriptionGroupRefs,
  getSubscriptionGroupIds,
  listSubscriptionGroups,
  loadSubscriptionNodeMeta,
  loadSubscriptionNodes,
  normalizeGroupIds,
  setSubscriptionGroups,
} from "./subscription_groups.ts";
export { listSubscriptionGroups, listGroupsForSubscriptionIds, getSubscriptionGroupIds, loadSubscriptionNodeMeta } from "./subscription_groups.ts";

export type UsageMode = "none" | "manual" | "upstream_exclusive";
export type SubFormat = OutputFormat | "uri-base64" | "auto";

export type SubscriptionInput = {
  userId: number;
  groupId?: number;
  groupIds?: number[];
  name: string;
  defaultFormat?: SubFormat;
  deviceLimit?: number | null;
  expireAt?: number | null;
  usageMode?: UsageMode;
  trafficLimitBytes?: number | null;
  exclusiveSourceId?: number | null;
};

export type SubscriptionPatch = {
  name?: string;
  groupId?: number;
  groupIds?: number[];
  enabled?: boolean;
  expireAt?: number | null;
  deviceLimit?: number | null;
  defaultFormat?: SubFormat;
  usageMode?: UsageMode;
  trafficLimitBytes?: number | null;
  manualUsedBytes?: number | null;
  exclusiveSourceId?: number | null;
  disabledReason?: string | null;
};

function assertUsage(mode: UsageMode | undefined, exclusiveSourceId: number | null | undefined) {
  if (mode === "upstream_exclusive" && !exclusiveSourceId) {
    throw new Error("exclusive_source_id required");
  }
  if (mode && !["none", "manual", "upstream_exclusive"].includes(mode)) {
    throw new Error("invalid usage mode");
  }
}

export async function createSubscription(
  env: Env,
  input: SubscriptionInput,
): Promise<{ id: number; token: string; tokenPrefix: string }> {
  assertUsage(input.usageMode, input.exclusiveSourceId ?? null);
  const token = randomToken(32);
  const tokenHash = await sha256Text(token);
  const tokenPrefix = token.slice(0, 8);
  const encryptedToken = await encryptSecret(env, token);
  const now = nowMs();
  const primaryGroupId = normalizeGroupIds(input)[0];
  if (!primaryGroupId) throw new Error("at least one group required");
  const res = await env.DB.prepare(
    `INSERT INTO subscriptions
      (user_id, group_id, name, token_hash, token_prefix, encrypted_token, enabled, expire_at, device_limit,
       default_format, access_policy, usage_mode, traffic_limit_bytes, manual_used_bytes,
       exclusive_source_id, revision, created_at, updated_at, disabled_reason)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'allow', ?, ?, 0, ?, 0, ?, ?, NULL)`,
  )
    .bind(
      input.userId,
      primaryGroupId,
      input.name,
      tokenHash,
      tokenPrefix,
      encryptedToken,
      input.expireAt ?? null,
      input.deviceLimit ?? null,
      input.defaultFormat ?? "auto",
      input.usageMode ?? "none",
      input.trafficLimitBytes ?? null,
      input.exclusiveSourceId ?? null,
      now,
      now,
    )
    .run();
  const id = Number(res.meta.last_row_id);
  await setSubscriptionGroups(env, id, normalizeGroupIds(input));
  return { id, token, tokenPrefix };
}

export async function updateSubscription(env: Env, id: number, patch: SubscriptionPatch): Promise<void> {
  const row = await env.DB.prepare("SELECT * FROM subscriptions WHERE id = ? LIMIT 1").bind(id).first<any>();
  if (!row) throw new Error("subscription not found");

  const usageMode = (patch.usageMode ?? row.usage_mode) as UsageMode;
  const exclusiveSourceId =
    patch.exclusiveSourceId !== undefined ? patch.exclusiveSourceId : row.exclusive_source_id;
  assertUsage(usageMode, exclusiveSourceId);

  const enabled = patch.enabled == null ? row.enabled : patch.enabled ? 1 : 0;
  let disabledReason =
    patch.disabledReason !== undefined ? patch.disabledReason : row.disabled_reason ?? null;
  if (patch.enabled === true) disabledReason = null;
  if (patch.enabled === false && disabledReason == null) disabledReason = "manual";

  const now = nowMs();
  await env.DB.prepare(
    `UPDATE subscriptions SET
      name = ?, group_id = ?, enabled = ?, expire_at = ?, device_limit = ?, default_format = ?,
      usage_mode = ?, traffic_limit_bytes = ?, manual_used_bytes = ?, exclusive_source_id = ?,
      disabled_reason = ?, revision = revision + 1, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      patch.name ?? row.name,
      (patch.groupIds && patch.groupIds.length ? normalizeGroupIds(patch)[0] : null) ?? patch.groupId ?? row.group_id,
      enabled,
      patch.expireAt !== undefined ? patch.expireAt : row.expire_at,
      patch.deviceLimit !== undefined ? patch.deviceLimit : row.device_limit,
      patch.defaultFormat ?? row.default_format,
      usageMode,
      patch.trafficLimitBytes !== undefined ? patch.trafficLimitBytes : row.traffic_limit_bytes,
      patch.manualUsedBytes !== undefined ? patch.manualUsedBytes : row.manual_used_bytes,
      exclusiveSourceId,
      disabledReason,
      now,
      id,
    )
    .run();

  if (patch.groupIds || patch.groupId != null) {
    await setSubscriptionGroups(env, id, normalizeGroupIds({
      groupIds: patch.groupIds,
      groupId: patch.groupId ?? row.group_id,
    }));
  }
}

export async function rotateSubscriptionToken(
  env: Env,
  id: number,
  ownerUserId?: number,
): Promise<{ token: string; tokenPrefix: string }> {
  const row = await env.DB
    .prepare("SELECT id, user_id FROM subscriptions WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: number; user_id: number }>();
  if (!row) throw new Error("subscription not found");
  if (ownerUserId != null && row.user_id !== ownerUserId) throw new Error("forbidden");

  const token = randomToken(32);
  const tokenHash = await sha256Text(token);
  const tokenPrefix = token.slice(0, 8);
  const encryptedToken = await encryptSecret(env, token);
  const now = nowMs();
  await env.DB.prepare(
    "UPDATE subscriptions SET token_hash = ?, token_prefix = ?, encrypted_token = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
  )
    .bind(tokenHash, tokenPrefix, encryptedToken, now, id)
    .run();
  await env.DB.prepare("DELETE FROM subscription_devices WHERE subscription_id = ?").bind(id).run();
  return { token, tokenPrefix };
}

/** Reveal current subscription token without rotating (null if never stored). */
export async function revealSubscriptionToken(
  env: Env,
  id: number,
  ownerUserId?: number,
): Promise<{ token: string; tokenPrefix: string } | null> {
  const row = await env.DB
    .prepare("SELECT id, user_id, token_prefix, encrypted_token FROM subscriptions WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: number; user_id: number; token_prefix: string; encrypted_token: string | null }>();
  if (!row) throw new Error("subscription not found");
  if (ownerUserId != null && row.user_id !== ownerUserId) throw new Error("forbidden");
  if (!row.encrypted_token) return null;
  const token = await decryptSecret(env, row.encrypted_token);
  if (!token) return null;
  return { token, tokenPrefix: row.token_prefix };
}

export async function listSubscriptionDevices(env: Env, subscriptionId: number) {
  const res = await env.DB.prepare(
    "SELECT fingerprint, client_family, first_seen_at, last_seen_at FROM subscription_devices WHERE subscription_id = ? ORDER BY last_seen_at DESC",
  )
    .bind(subscriptionId)
    .all();
  return res.results ?? [];
}

export async function resetSubscriptionDevices(env: Env, subscriptionId: number): Promise<number> {
  const res = await env.DB.prepare("DELETE FROM subscription_devices WHERE subscription_id = ?")
    .bind(subscriptionId)
    .run();
  await env.DB.prepare("UPDATE subscriptions SET revision = revision + 1, updated_at = ? WHERE id = ?")
    .bind(nowMs(), subscriptionId)
    .run();
  return Number(res.meta.changes || 0);
}

export async function deleteSubscriptionDevice(
  env: Env,
  subscriptionId: number,
  fingerprint: string,
): Promise<number> {
  const res = await env.DB.prepare(
    "DELETE FROM subscription_devices WHERE subscription_id = ? AND fingerprint = ?",
  )
    .bind(subscriptionId, fingerprint)
    .run();
  if (res.meta.changes) {
    await env.DB.prepare("UPDATE subscriptions SET revision = revision + 1, updated_at = ? WHERE id = ?")
      .bind(nowMs(), subscriptionId)
      .run();
  }
  return Number(res.meta.changes || 0);
}

export async function createGroup(env: Env, name: string, description?: string) {
  const now = nowMs();
  const res = await env.DB.prepare(
    "INSERT INTO groups (name, description, enabled, revision, created_at, updated_at) VALUES (?, ?, 1, 0, ?, ?)",
  )
    .bind(name, description ?? null, now, now)
    .run();
  return Number(res.meta.last_row_id);
}

export async function setGroupNodes(env: Env, groupId: number, nodeIds: number[]) {
  const now = nowMs();
  await env.DB.prepare("DELETE FROM group_nodes WHERE group_id = ?").bind(groupId).run();
  let order = 0;
  for (const nodeId of nodeIds) {
    await env.DB.prepare(
      "INSERT INTO group_nodes (group_id, node_id, enabled, sort_order) VALUES (?, ?, 1, ?)",
    )
      .bind(groupId, nodeId, order++)
      .run();
  }
  await env.DB.prepare("UPDATE groups SET revision = revision + 1, updated_at = ? WHERE id = ?")
    .bind(now, groupId)
    .run();
}


export async function updateGroup(
  env: Env,
  groupId: number,
  patch: { name?: string; description?: string | null; enabled?: boolean; nodeIds?: number[] },
): Promise<void> {
  const row = await env.DB.prepare("SELECT * FROM groups WHERE id = ? LIMIT 1").bind(groupId).first<any>();
  if (!row) throw new Error("group not found");
  const now = nowMs();
  await env.DB.prepare(
    "UPDATE groups SET name = ?, description = ?, enabled = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
  )
    .bind(
      patch.name ?? row.name,
      patch.description !== undefined ? patch.description : row.description,
      patch.enabled == null ? row.enabled : patch.enabled ? 1 : 0,
      now,
      groupId,
    )
    .run();
  if (Array.isArray(patch.nodeIds)) {
    await setGroupNodes(env, groupId, patch.nodeIds);
  }
}

export async function getGroupNodes(env: Env, groupId: number): Promise<number[]> {
  const res = await env.DB.prepare(
    "SELECT node_id FROM group_nodes WHERE group_id = ? ORDER BY sort_order ASC, node_id ASC",
  )
    .bind(groupId)
    .all<{ node_id: number }>();
  return (res.results ?? []).map((r) => Number(r.node_id));
}

export async function deleteGroup(env: Env, groupId: number): Promise<void> {
  if ((await countSubscriptionGroupRefs(env, groupId)) > 0) throw new Error("group is referenced by subscriptions");
  await env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(groupId).run();
}


export async function deleteSubscription(env: Env, id: number): Promise<void> {
  await env.DB.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
}

export async function batchUpdateSubscriptions(
  env: Env,
  ids: number[],
  patch: { enabled?: boolean; disabledReason?: string | null },
): Promise<number> {
  const clean = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!clean.length) return 0;
  let n = 0;
  for (const id of clean) {
    await updateSubscription(env, id, {
      enabled: patch.enabled,
      disabledReason: patch.disabledReason,
    });
    n += 1;
  }
  return n;
}

export async function batchDeleteSubscriptions(env: Env, ids: number[]): Promise<number> {
  const clean = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  let n = 0;
  for (const id of clean) {
    await deleteSubscription(env, id);
    n += 1;
  }
  return n;
}

export async function batchDeleteGroups(env: Env, ids: number[]): Promise<{ deleted: number; failed: Array<{ id: number; error: string }> }> {
  const clean = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  let deleted = 0;
  const failed: Array<{ id: number; error: string }> = [];
  for (const id of clean) {
    try {
      await deleteGroup(env, id);
      deleted += 1;
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return { deleted, failed };
}

async function loadGroupNodes(env: Env, groupId: number): Promise<NormalizedNode[]> {
  const res = await env.DB.prepare(
    `SELECT sn.normalized_json AS normalized_json
     FROM group_nodes gn
     JOIN source_nodes sn ON sn.id = gn.node_id
     WHERE gn.group_id = ? AND gn.enabled = 1 AND sn.enabled = 1 AND sn.stale = 0
     ORDER BY gn.sort_order ASC, sn.source_order ASC, sn.id ASC`,
  )
    .bind(groupId)
    .all<{ normalized_json: string }>();
  return (res.results ?? []).map((r) => JSON.parse(r.normalized_json) as NormalizedNode);
}

function opaque404(): Response {
  return new Response("", { status: 404 });
}

async function latestSourceUsage(env: Env, sourceId: number) {
  return env.DB.prepare(
    `SELECT upload_bytes, download_bytes, total_bytes, expire_at, captured_at
     FROM source_usage_snapshots WHERE source_id = ? ORDER BY captured_at DESC LIMIT 1`,
  )
    .bind(sourceId)
    .first<{
      upload_bytes: number | null;
      download_bytes: number | null;
      total_bytes: number | null;
      expire_at: number | null;
      captured_at: number;
    }>();
}

function trafficExceeded(sub: any, usage: { total_bytes?: number | null; upload_bytes?: number | null; download_bytes?: number | null } | null): boolean {
  if (sub.usage_mode === "manual") {
    return (
      sub.traffic_limit_bytes != null &&
      Number(sub.manual_used_bytes || 0) >= Number(sub.traffic_limit_bytes)
    );
  }
  if (sub.usage_mode === "upstream_exclusive") {
    if (sub.traffic_limit_bytes == null || !usage) return false;
    const used =
      usage.total_bytes != null
        ? Number(usage.total_bytes)
        : Number(usage.upload_bytes || 0) + Number(usage.download_bytes || 0);
    return used >= Number(sub.traffic_limit_bytes);
  }
  return false;
}

export async function serveSubscription(env: Env, request: Request, token: string): Promise<Response> {
  const tokenHash = await sha256Text(token);
  const sub = await env.DB.prepare(
    `SELECT s.*, u.enabled AS user_enabled, u.expire_at AS user_expire_at
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? LIMIT 1`,
  )
    .bind(tokenHash)
    .first<any>();
  if (!sub) return opaque404();

  const now = nowMs();
  if (sub.enabled !== 1 || sub.user_enabled !== 1) return opaque404();
  if (sub.expire_at != null && Number(sub.expire_at) < now) return opaque404();
  if (sub.user_expire_at != null && Number(sub.user_expire_at) < now) return opaque404();

  let usage: Awaited<ReturnType<typeof latestSourceUsage>> = null;
  if (sub.usage_mode === "upstream_exclusive" && sub.exclusive_source_id) {
    usage = await latestSourceUsage(env, Number(sub.exclusive_source_id));
    if (usage?.expire_at != null && Number(usage.expire_at) < now) return opaque404();
  }
  if (trafficExceeded(sub, usage)) return opaque404();

  const url = new URL(request.url);
  const formatParam = (url.searchParams.get("format") || "auto").toLowerCase();
  const detected = detectClient(request.headers.get("user-agent"));
  let format: DeliveryFormat = detected.format;
  let formatFallback = false;
  if (formatParam && formatParam !== "auto") {
    const normalized = normalizeDeliveryFormat(formatParam);
    format = normalized.format;
    formatFallback = normalized.fallback;
  } else if (sub.default_format && sub.default_format !== "auto") {
    const normalized = normalizeDeliveryFormat(String(sub.default_format));
    format = normalized.format;
    formatFallback = normalized.fallback;
  }

  // passthrough only when EVERY active node across all groups belongs to the same passthrough source
  const subGroupIds = await getSubscriptionGroupIds(env, Number(sub.id));
  const groupIdList = subGroupIds.length ? subGroupIds : [Number(sub.group_id)];
  const placeholders = groupIdList.map(() => "?").join(",");
  const mix = await env.DB.prepare(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN src.kind = 'passthrough' THEN 1 ELSE 0 END) AS pass_n,
        COUNT(DISTINCT src.id) AS src_n,
        MAX(src.id) AS src_id,
        MAX(src.passthrough_format) AS passthrough_format,
        MAX(src.manual_content) AS manual_content
     FROM group_nodes gn
     JOIN source_nodes sn ON sn.id = gn.node_id
     JOIN sources src ON src.id = sn.source_id
     WHERE gn.group_id IN (${placeholders}) AND gn.enabled = 1 AND sn.enabled = 1 AND sn.stale = 0`,
  )
    .bind(...groupIdList)
    .first<any>();
  const purePassthrough =
    Number(mix?.total || 0) > 0 &&
    Number(mix?.pass_n || 0) === Number(mix?.total || 0) &&
    Number(mix?.src_n || 0) === 1;
  const passthrough =
    purePassthrough
      ? {
          id: mix.src_id,
          passthrough_format: mix.passthrough_format,
          manual_content: mix.manual_content,
        }
      : null;

  const vars = readVars(env);
  const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
  const ua = request.headers.get("user-agent") || "";
  const ipPrefix = ip.includes(":")
    ? ip.split(":").slice(0, 4).join(":")
    : ip.split(".").slice(0, 3).join(".");
  const uaNormHash = await sha256Text(ua.toLowerCase());
  const fingerprint = await sha256Text(ipPrefix + "|" + uaNormHash + "|" + detected.family);
  const windowStart = now - vars.deviceWindowMs;

  // device bookkeeping: throttle last_seen writes (5 min)
  const existing = await env.DB.prepare(
    "SELECT fingerprint, last_seen_at FROM subscription_devices WHERE subscription_id = ? AND fingerprint = ? LIMIT 1",
  )
    .bind(sub.id, fingerprint)
    .first<{ fingerprint: string; last_seen_at: number }>();

  if (!existing) {
    if (sub.device_limit != null) {
      const countRow = await env.DB.prepare(
        "SELECT COUNT(*) AS c FROM subscription_devices WHERE subscription_id = ? AND last_seen_at >= ?",
      )
        .bind(sub.id, windowStart)
        .first<{ c: number }>();
      if ((countRow?.c ?? 0) >= Number(sub.device_limit)) return opaque404();
    }
    await env.DB.prepare(
      `INSERT INTO subscription_devices
        (subscription_id, fingerprint, client_family, ip_hash, ua_hash, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(subscription_id, fingerprint) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        client_family = excluded.client_family`,
    )
      .bind(sub.id, fingerprint, detected.family, await sha256Text(ipPrefix), uaNormHash, now, now)
      .run();
    // post-insert recheck (TOCTOU mitigation)
    if (sub.device_limit != null) {
      const countRow = await env.DB.prepare(
        "SELECT COUNT(*) AS c FROM subscription_devices WHERE subscription_id = ? AND last_seen_at >= ?",
      )
        .bind(sub.id, windowStart)
        .first<{ c: number }>();
      if ((countRow?.c ?? 0) > Number(sub.device_limit)) {
        await env.DB.prepare(
          "DELETE FROM subscription_devices WHERE subscription_id = ? AND fingerprint = ?",
        )
          .bind(sub.id, fingerprint)
          .run();
        return opaque404();
      }
    }
  } else if (now - Number(existing.last_seen_at || 0) > 5 * 60 * 1000) {
    await env.DB.prepare(
      "UPDATE subscription_devices SET last_seen_at = ?, client_family = ? WHERE subscription_id = ? AND fingerprint = ?",
    )
      .bind(now, detected.family, sub.id, fingerprint)
      .run();
  }

  let body = "";
  let contentType = "text/plain; charset=utf-8";
  let skippedCount = 0;
  let uriCertNodes = 0;
  let uriV2raynFallback = 0;

  if (passthrough && String(passthrough.passthrough_format || "") === format) {
    body = String(passthrough.manual_content || "");
    if (!body.trim()) return opaque404();
    contentType =
      format === "mihomo"
        ? "text/yaml; charset=utf-8"
        : format === "singbox"
          ? "application/json; charset=utf-8"
          : "text/plain; charset=utf-8";
  } else {
    const nodes = await loadSubscriptionNodes(env, Number(sub.id), Number(sub.group_id));
    const uaLower = (request.headers.get("user-agent") || "").toLowerCase();
    const preferRawV2rayn =
      url.searchParams.get("vendor") === "v2rayn" ||
      (uaLower.includes("v2rayn") && !uaLower.includes("nekobox") && !uaLower.includes("v2rayng"));
    const rendered = await renderProfile(format, nodes, vars.siteName, { preferRawV2rayn });
    if (!rendered.body.trim()) {
      // keep opaque to avoid confirming token validity + node state
      return opaque404();
    }
    body = rendered.body;
    contentType = rendered.contentType;
    skippedCount = rendered.skipped.length;
    uriCertNodes = Number(rendered.meta?.certNodes || 0);
    uriV2raynFallback = Number(rendered.meta?.v2raynFallback || 0);
  }
  const etagValue = (
    await sha256Text([sub.id, sub.revision, groupIdList.join(","), format, body].join(":"))
  ).slice(0, 24);
  const etag = String.fromCharCode(34) + etagValue + String.fromCharCode(34);
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  // access log: sample ~20% after first hit per device in window to reduce write amplification
  // always log new devices; existing ~1/5
  const shouldLog = !existing || Math.random() < 0.2;
  if (shouldLog) {
    await env.DB.prepare(
      `INSERT INTO subscription_access_logs
        (subscription_id, device_fingerprint, client_family, format, response_bytes, status, created_at)
       VALUES (?, ?, ?, ?, ?, 200, ?)`,
    )
      .bind(sub.id, fingerprint, detected.family, format, new TextEncoder().encode(body).byteLength, now)
      .run();
  }

  const updateInterval = await getSettingNumber(env, "profile_update_interval_hours", 24);
  const announce = await getSettingString(env, "announce", "");
  const supportUrl = await getSettingString(env, "support_url", "");
  const profileTitle = String(sub.name || vars.siteName || "Sub Panel");

  const fileExt =
    format === "mihomo" ? "yaml" : format === "singbox" ? "json" : format === "uri-base64" ? "b64.txt" : "txt";
  const asciiName = ("sub-" + String(sub.token_prefix || "profile")).replace(/[^ -~]/g, "_");
  const utf8Name = encodeURIComponent(String(profileTitle || "sub") + "." + fileExt);
  const headers: Record<string, string> = {
    "content-type": contentType,
    ETag: etag,
    "Profile-Title": profileTitle,
    "Profile-Update-Interval": String(Math.max(1, Math.floor(updateInterval || 24))),
    "X-Sub-Skipped-Nodes": String(skippedCount),
    "X-Sub-Client-Family": detected.family,
    "X-Sub-Format": format,
    "X-Sub-Cert-Nodes": String(uriCertNodes),
    "X-Sub-Uri-V2rayn-Fallback": String(uriV2raynFallback),
    "Content-Disposition": `inline; filename="${asciiName}.${fileExt}"; filename*=UTF-8''${utf8Name}`,
  };
  if (formatFallback) headers["X-Sub-Format-Fallback"] = "1";
  if (announce) headers["Announce"] = announce;
  if (supportUrl) headers["Support-URL"] = supportUrl;

  if (sub.usage_mode === "upstream_exclusive" && usage) {
    const upload = Number(usage.upload_bytes || 0);
    const download = Number(usage.download_bytes || 0);
    const total = usage.total_bytes != null ? Number(usage.total_bytes) : upload + download;
    const expire = usage.expire_at != null ? Math.floor(Number(usage.expire_at) / 1000) : 0;
    headers["Subscription-Userinfo"] = `upload=${upload}; download=${download}; total=${total}; expire=${expire}`;
  } else if (sub.usage_mode === "manual") {
    const used = Number(sub.manual_used_bytes || 0);
    const total = sub.traffic_limit_bytes == null ? 0 : Number(sub.traffic_limit_bytes);
    const expire = sub.expire_at != null ? Math.floor(Number(sub.expire_at) / 1000) : 0;
    headers["Subscription-Userinfo"] = `upload=0; download=${used}; total=${total}; expire=${expire}`;
  }

  return new Response(body, { status: 200, headers });
}

export async function getSubscriptionRow(env: Env, id: number) {
  return env.DB.prepare(
    `SELECT s.*, u.username, u.email AS user_email, u.enabled AS user_enabled, u.expire_at AS user_expire_at,
            g.name AS group_name
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN groups g ON g.id = s.group_id
     WHERE s.id = ?
     LIMIT 1`,
  )
    .bind(id)
    .first<any>();
}

export async function listRecentAccess(env: Env, subscriptionId: number, limit = 20) {
  const res = await env.DB.prepare(
    `SELECT id, client_family, format, response_bytes, status, created_at
     FROM subscription_access_logs
     WHERE subscription_id = ?
     ORDER BY id DESC LIMIT ?`,
  )
    .bind(subscriptionId, limit)
    .all();
  return res.results ?? [];
}

