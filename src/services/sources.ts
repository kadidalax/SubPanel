import type { Env } from "../env.ts";
import { decryptText, encryptText } from "../crypto/secretbox.ts";
import { nowMs } from "../util/time.ts";
import { parseSubscriptionText } from "../parsers/detect.ts";
import type { NormalizedNode, OutputFormat } from "../parsers/types.ts";
import { nodeKey } from "../parsers/node_key.ts";
import { assertSafeRemoteUrl, fetchRemoteSubscription, parseUserinfo, sanitizeRemoteHeaders } from "./ssrf.ts";
import { credentialsKey } from "./credentials.ts";

export type SourceDiff = {
  added: number;
  updated: number;
  staleMarked: number;
  unchanged: number;
  /** unique after node_key dedupe */
  unique: number;
  /** raw parse count before dedupe */
  parsed: number;
};

async function bumpGroupsForSource(env: Env, sourceId: number, now: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE groups SET revision = revision + 1, updated_at = ?
     WHERE id IN (
       SELECT DISTINCT gn.group_id FROM group_nodes gn
       JOIN source_nodes sn ON sn.id = gn.node_id
       WHERE sn.source_id = ?
     )`,
  )
    .bind(now, sourceId)
    .run();
}

export async function createManualSource(
  env: Env,
  input: { name: string; content: string; formatHint?: string | null },
): Promise<{ id: number; nodeCount: number; warnings: unknown[]; revision: number; diff: SourceDiff }> {
  const parsed = parseSubscriptionText(input.content, input.formatHint);
  if (!parsed.nodes.length) throw new Error("no nodes parsed");
  const now = nowMs();
  const res = await env.DB.prepare(
    `INSERT INTO sources
      (name, kind, format_hint, manual_content, refresh_interval_minutes, enabled, failure_count, revision, created_at, updated_at)
     VALUES (?, 'manual', ?, ?, 0, 1, 0, 0, ?, ?)`,
  )
    .bind(input.name, input.formatHint ?? null, input.content, now, now)
    .run();
  const sourceId = Number(res.meta.last_row_id);
  const diff = await upsertSourceNodes(env, sourceId, parsed.nodes, now);
  await env.DB.prepare(
    "UPDATE sources SET revision = 1, last_success_at = ?, updated_at = ? WHERE id = ?",
  )
    .bind(now, now, sourceId)
    .run();
  return { id: sourceId, nodeCount: diff.unique, warnings: parsed.warnings, revision: 1, diff };
}

export async function createRemoteSource(
  env: Env,
  input: {
    name: string;
    url: string;
    headers?: Record<string, string>;
    formatHint?: string | null;
    refreshIntervalMinutes?: number;
  },
): Promise<{ id: number; nodeCount: number; warnings: unknown[]; revision: number; diff: SourceDiff }> {
  const key = await credentialsKey(env);
  const now = nowMs();
  assertSafeRemoteUrl(input.url);
  const headers = sanitizeRemoteHeaders(input.headers || {});
  const encryptedUrl = await encryptText(key, input.url);
  const encryptedHeaders = await encryptText(key, JSON.stringify(headers));
  const interval = Math.max(5, Number(input.refreshIntervalMinutes || 60));
  const res = await env.DB.prepare(
    `INSERT INTO sources
      (name, kind, format_hint, encrypted_url, encrypted_headers, refresh_interval_minutes,
       next_refresh_at, enabled, failure_count, revision, created_at, updated_at)
     VALUES (?, 'remote', ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)`,
  )
    .bind(input.name, input.formatHint ?? null, encryptedUrl, encryptedHeaders, interval, now, now, now)
    .run();
  const sourceId = Number(res.meta.last_row_id);
  const refreshed = await refreshSource(env, sourceId);
  return { id: sourceId, ...refreshed };
}

export async function createPassthroughSource(
  env: Env,
  input: { name: string; content: string; passthroughFormat: OutputFormat },
): Promise<{ id: number }> {
  if (!["mihomo", "singbox", "uri", "surge"].includes(input.passthroughFormat)) {
    throw new Error("invalid passthrough format");
  }
  if (!input.content.trim()) throw new Error("content required");
  const now = nowMs();
  const res = await env.DB.prepare(
    `INSERT INTO sources
      (name, kind, manual_content, passthrough_format, refresh_interval_minutes, enabled, failure_count, revision, created_at, updated_at, last_success_at)
     VALUES (?, 'passthrough', ?, ?, 0, 1, 0, 1, ?, ?, ?)`,
  )
    .bind(input.name, input.content, input.passthroughFormat, now, now, now)
    .run();
  const sourceId = Number(res.meta.last_row_id);
  const synthetic: NormalizedNode = {
    protocol: "unknown",
    name: `${input.name}-passthrough`,
    server: "passthrough.local",
    port: 0,
    raw: input.content.slice(0, 200),
    auth: {},
    capability: [input.passthroughFormat],
  };
  await upsertSourceNodes(env, sourceId, [synthetic], now);
  return { id: sourceId };
}

async function upsertSourceNodes(
  env: Env,
  sourceId: number,
  nodes: NormalizedNode[],
  now: number,
): Promise<SourceDiff> {
  if (nodes.length > 5000) throw new Error("too many nodes");
  const existingRes = await env.DB.prepare(
    "SELECT node_key, normalized_json, stale FROM source_nodes WHERE source_id = ?",
  )
    .bind(sourceId)
    .all<{ node_key: string; normalized_json: string; stale: number }>();
  const existing = new Map((existingRes.results ?? []).map((r) => [r.node_key, r]));

  const seen: string[] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  let order = 0;
  for (const node of nodes) {
    const key = await nodeKey(node);
    if (seen.includes(key)) continue;
    seen.push(key);
    const sourceOrder = order++;
    const prev = existing.get(key);
    const normalized = JSON.stringify(node);
    if (!prev) added++;
    else if (prev.normalized_json !== normalized || Number(prev.stale) === 1) updated++;
    else unchanged++;

    await env.DB.prepare(
      `INSERT INTO source_nodes
        (source_id, node_key, protocol, name, raw_value, normalized_json, capability_flags, enabled, stale, source_order, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)
       ON CONFLICT(source_id, node_key) DO UPDATE SET
        protocol = excluded.protocol,
        name = excluded.name,
        raw_value = excluded.raw_value,
        normalized_json = excluded.normalized_json,
        capability_flags = excluded.capability_flags,
        stale = 0,
        source_order = excluded.source_order,
        last_seen_at = excluded.last_seen_at`,
    )
      .bind(
        sourceId,
        key,
        node.protocol,
        node.name,
        node.raw,
        normalized,
        JSON.stringify(node.capability),
        sourceOrder,
        now,
        now,
      )
      .run();
  }

  let staleMarked = 0;
  if (seen.length === 0) {
    const res = await env.DB.prepare(
      "UPDATE source_nodes SET stale = 1 WHERE source_id = ? AND stale = 0",
    )
      .bind(sourceId)
      .run();
    staleMarked = Number(res.meta.changes || 0);
  } else {
    const placeholders = seen.map(() => "?").join(",");
    const res = await env.DB.prepare(
      "UPDATE source_nodes SET stale = 1 WHERE source_id = ? AND stale = 0 AND node_key NOT IN (" + placeholders + ")",
    )
      .bind(sourceId, ...seen)
      .run();
    staleMarked = Number(res.meta.changes || 0);
  }

  return { added, updated, staleMarked, unchanged, unique: seen.length, parsed: nodes.length };
}

export async function refreshSource(
  env: Env,
  sourceId: number,
): Promise<{ nodeCount: number; warnings: unknown[]; revision: number; diff: SourceDiff }> {
  const source = await env.DB.prepare("SELECT * FROM sources WHERE id = ? LIMIT 1").bind(sourceId).first<any>();
  if (!source) throw new Error("source not found");
  const now = nowMs();

  if (source.kind === "manual") {
    const parsed = parseSubscriptionText(String(source.manual_content || ""), source.format_hint);
    const diff = await upsertSourceNodes(env, sourceId, parsed.nodes, now);
    const revision = Number(source.revision || 0) + 1;
    await env.DB.prepare(
      "UPDATE sources SET revision = ?, last_success_at = ?, last_error = NULL, failure_count = 0, updated_at = ? WHERE id = ?",
    )
      .bind(revision, now, now, sourceId)
      .run();
    await bumpGroupsForSource(env, sourceId, now);
    return { nodeCount: diff.unique, warnings: parsed.warnings, revision, diff };
  }

  if (source.kind === "passthrough") {
    return { nodeCount: 1, warnings: [], revision: Number(source.revision || 1), diff: { added: 0, updated: 0, staleMarked: 0, unchanged: 1, unique: 1, parsed: 1 } };
  }

  if (source.kind !== "remote") throw new Error("unsupported source kind");

  const key = await credentialsKey(env);
  const url = await decryptText(key, String(source.encrypted_url));
  const headers = JSON.parse(await decryptText(key, String(source.encrypted_headers))) as Record<
    string,
    string
  >;
  try {
    const remote = await fetchRemoteSubscription(url, headers);
    const parsed = parseSubscriptionText(remote.body, source.format_hint);
    if (!parsed.nodes.length) throw new Error("no nodes parsed from remote subscription");
    const diff = await upsertSourceNodes(env, sourceId, parsed.nodes, now);
    const usage = parseUserinfo(remote.userinfo || "");
    if (usage.upload != null || usage.download != null || usage.total != null || usage.expire != null) {
      await env.DB.prepare(
        `INSERT INTO source_usage_snapshots
          (source_id, upload_bytes, download_bytes, total_bytes, expire_at, captured_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(sourceId, usage.upload, usage.download, usage.total, usage.expire, now)
        .run();
    }
    const revision = Number(source.revision || 0) + 1;
    const nextRefresh = now + Number(source.refresh_interval_minutes || 60) * 60 * 1000;
    await env.DB.prepare(
      `UPDATE sources SET revision = ?, last_success_at = ?, last_error = NULL, failure_count = 0,
        next_refresh_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(revision, now, nextRefresh, now, sourceId)
      .run();
    await bumpGroupsForSource(env, sourceId, now);
    return { nodeCount: diff.unique, warnings: parsed.warnings, revision, diff };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failureCount = Number(source.failure_count || 0) + 1;
    await env.DB.prepare(
      "UPDATE sources SET failure_count = ?, last_error = ?, updated_at = ?, next_refresh_at = ? WHERE id = ?",
    )
      .bind(failureCount, message, now, now + 15 * 60 * 1000, sourceId)
      .run();
    throw err;
  }
}


export async function updateSource(
  env: Env,
  sourceId: number,
  patch: {
    name?: string;
    enabled?: boolean;
    refreshIntervalMinutes?: number | null;
    formatHint?: string | null;
    manualContent?: string | null;
    url?: string | null;
    headers?: Record<string, string> | null;
    passthroughFormat?: string | null;
  },
): Promise<void> {
  const row = await env.DB.prepare("SELECT * FROM sources WHERE id = ? LIMIT 1").bind(sourceId).first<any>();
  if (!row) throw new Error("source not found");
  const now = nowMs();
  const name = patch.name ?? row.name;
  const enabled = patch.enabled == null ? row.enabled : patch.enabled ? 1 : 0;
  const formatHint = patch.formatHint !== undefined ? patch.formatHint : row.format_hint;
  let refresh = row.refresh_interval_minutes;
  if (patch.refreshIntervalMinutes != null) refresh = Math.max(5, Number(patch.refreshIntervalMinutes));
  let encryptedUrl = row.encrypted_url;
  let encryptedHeaders = row.encrypted_headers;
  let manualContent = row.manual_content;
  let passthroughFormat = row.passthrough_format;

  if (row.kind === "remote") {
    const key = await credentialsKey(env);
    if (patch.url) {
      assertSafeRemoteUrl(String(patch.url));
      encryptedUrl = await encryptText(key, patch.url);
    }
    if (patch.headers) {
      encryptedHeaders = await encryptText(key, JSON.stringify(sanitizeRemoteHeaders(patch.headers)));
    }
  }
  if (row.kind === "manual" && patch.manualContent != null) {
    manualContent = patch.manualContent;
  }
  if (row.kind === "passthrough") {
    if (patch.manualContent != null) manualContent = patch.manualContent;
    if (patch.passthroughFormat) passthroughFormat = patch.passthroughFormat;
  }

  await env.DB.prepare(
    `UPDATE sources SET name = ?, enabled = ?, format_hint = ?, refresh_interval_minutes = ?,
      encrypted_url = ?, encrypted_headers = ?, manual_content = ?, passthrough_format = ?,
      revision = revision + 1, updated_at = ? WHERE id = ?`,
  )
    .bind(
      name,
      enabled,
      formatHint,
      refresh,
      encryptedUrl,
      encryptedHeaders,
      manualContent,
      passthroughFormat,
      now,
      sourceId,
    )
    .run();

  // reparse content when manual/passthrough body changed
  if (row.kind === "manual" && patch.manualContent != null) {
    await refreshSource(env, sourceId);
  }
  if (row.kind === "passthrough" && (patch.manualContent != null || patch.passthroughFormat)) {
    // keep synthetic node in sync with content
    await env.DB.prepare("DELETE FROM source_nodes WHERE source_id = ?").bind(sourceId).run();
    const synthetic = {
      protocol: "unknown" as const,
      name: `${name}-passthrough`,
      server: "passthrough.local",
      port: 0,
      raw: String(manualContent || "").slice(0, 200),
      auth: {},
      capability: [String(passthroughFormat || "uri")] as any,
    };
    await upsertSourceNodes(env, sourceId, [synthetic as any], now);
  }
}

export async function deleteSource(env: Env, sourceId: number): Promise<void> {
  const used = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM group_nodes gn
     JOIN source_nodes sn ON sn.id = gn.node_id
     WHERE sn.source_id = ?`,
  )
    .bind(sourceId)
    .first<{ c: number }>();
  if ((used?.c ?? 0) > 0) throw new Error("source nodes are referenced by groups");
  const exclusive = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM subscriptions WHERE exclusive_source_id = ?",
  )
    .bind(sourceId)
    .first<{ c: number }>();
  if ((exclusive?.c ?? 0) > 0) throw new Error("source is exclusive upstream for subscriptions");
  await env.DB.prepare("DELETE FROM sources WHERE id = ?").bind(sourceId).run();
}

export async function setNodeEnabled(env: Env, nodeId: number, enabled: boolean): Promise<void> {
  await env.DB.prepare("UPDATE source_nodes SET enabled = ? WHERE id = ?")
    .bind(enabled ? 1 : 0, nodeId)
    .run();
}

export async function deleteNode(env: Env, nodeId: number): Promise<void> {
  await env.DB.prepare("DELETE FROM group_nodes WHERE node_id = ?").bind(nodeId).run();
  await env.DB.prepare("DELETE FROM source_nodes WHERE id = ?").bind(nodeId).run();
}

export async function batchSetNodeEnabled(env: Env, ids: number[], enabled: boolean): Promise<number> {
  const clean = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!clean.length) return 0;
  const ph = clean.map(() => "?").join(",");
  const res = await env.DB.prepare(`UPDATE source_nodes SET enabled = ? WHERE id IN (${ph})`)
    .bind(enabled ? 1 : 0, ...clean)
    .run();
  return Number(res.meta.changes || clean.length);
}

export async function batchDeleteNodes(env: Env, ids: number[]): Promise<number> {
  const clean = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  let n = 0;
  for (const id of clean) {
    await deleteNode(env, id);
    n += 1;
  }
  return n;
}

export async function batchDeleteSources(env: Env, ids: number[]): Promise<{ deleted: number; failed: Array<{ id: number; error: string }> }> {
  const clean = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  let deleted = 0;
  const failed: Array<{ id: number; error: string }> = [];
  for (const id of clean) {
    try {
      await deleteSource(env, id);
      deleted += 1;
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return { deleted, failed };
}

export async function batchRefreshSources(env: Env, ids: number[]): Promise<{ ok: number; failed: Array<{ id: number; error: string }> }> {
  const clean = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  let ok = 0;
  const failed: Array<{ id: number; error: string }> = [];
  for (const id of clean) {
    try {
      await refreshSource(env, id);
      ok += 1;
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return { ok, failed };
}

export function sourceHealthStatus(row: { enabled: number; failure_count: number }): "healthy" | "degraded" | "paused" | "disabled" {
  if (Number(row.enabled) !== 1) return "disabled";
  const fails = Number(row.failure_count || 0);
  if (fails >= 5) return "paused";
  if (fails > 0) return "degraded";
  return "healthy";
}

export async function listSources(env: Env) {
  const res = await env.DB.prepare(
    `SELECT s.id, s.name, s.kind, s.format_hint, s.passthrough_format, s.refresh_interval_minutes, s.next_refresh_at,
            s.enabled, s.failure_count, s.last_success_at, s.last_error, s.revision, s.created_at, s.updated_at,
            (SELECT COUNT(*) FROM source_nodes sn WHERE sn.source_id = s.id AND sn.stale = 0) AS active_nodes,
            (SELECT COUNT(*) FROM source_nodes sn WHERE sn.source_id = s.id AND sn.stale = 1) AS stale_nodes,
            (SELECT COUNT(DISTINCT sub.id)
             FROM subscriptions sub
             JOIN group_nodes gn ON gn.group_id = sub.group_id
             JOIN source_nodes sn ON sn.id = gn.node_id
             WHERE sn.source_id = s.id) AS impacted_subscriptions
     FROM sources s ORDER BY s.id DESC`,
  ).all<any>();
  return (res.results ?? []).map((row) => ({
    ...row,
    health: sourceHealthStatus(row),
  }));
}

export async function listSourceNodes(env: Env, sourceId: number) {
  const res = await env.DB.prepare(
    `SELECT id, source_id, protocol, name, capability_flags, enabled, stale, first_seen_at, last_seen_at
     FROM source_nodes WHERE source_id = ? ORDER BY source_order ASC, id ASC`,
  )
    .bind(sourceId)
    .all();
  return res.results ?? [];
}
