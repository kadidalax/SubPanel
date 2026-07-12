import type { Env } from "../env.ts";
import { nowMs } from "../util/time.ts";
import type { NormalizedNode } from "../parsers/types.ts";

export function normalizeGroupIds(input: { groupId?: number | null; groupIds?: number[] | null }): number[] {
  const fromList = Array.isArray(input.groupIds) ? input.groupIds : [];
  const ids = [...fromList, input.groupId ?? 0].map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export async function setSubscriptionGroups(env: Env, subscriptionId: number, groupIds: number[]): Promise<number[]> {
  const clean = normalizeGroupIds({ groupIds });
  if (!clean.length) throw new Error("at least one group required");
  for (const gid of clean) {
    const row = await env.DB.prepare("SELECT id FROM groups WHERE id = ? LIMIT 1").bind(gid).first();
    if (!row) throw new Error("group not found: " + gid);
  }
  await env.DB.prepare("DELETE FROM subscription_groups WHERE subscription_id = ?").bind(subscriptionId).run();
  let order = 0;
  for (const gid of clean) {
    await env.DB.prepare(
      "INSERT INTO subscription_groups (subscription_id, group_id, sort_order) VALUES (?, ?, ?)",
    )
      .bind(subscriptionId, gid, order++)
      .run();
  }
  await env.DB.prepare("UPDATE subscriptions SET group_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
    .bind(clean[0], nowMs(), subscriptionId)
    .run();
  return clean;
}

export async function getSubscriptionGroupIds(env: Env, subscriptionId: number): Promise<number[]> {
  const res = await env.DB.prepare(
    "SELECT group_id FROM subscription_groups WHERE subscription_id = ? ORDER BY sort_order ASC, group_id ASC",
  )
    .bind(subscriptionId)
    .all<{ group_id: number }>();
  const ids = (res.results ?? []).map((r) => Number(r.group_id)).filter((n) => n > 0);
  if (ids.length) return ids;
  const row = await env.DB.prepare("SELECT group_id FROM subscriptions WHERE id = ? LIMIT 1")
    .bind(subscriptionId)
    .first<{ group_id: number }>();
  return row?.group_id ? [Number(row.group_id)] : [];
}


export async function listGroupsForSubscriptionIds(
  env: Env,
  subscriptionIds: number[],
): Promise<Map<number, Array<{ id: number; name: string; sortOrder: number }>>> {
  const out = new Map<number, Array<{ id: number; name: string; sortOrder: number }>>();
  const ids = [...new Set(subscriptionIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return out;

  // D1/SQLite bound variable limit is low (~100). Chunk aggressively.
  const chunkSize = 80;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const ph = chunk.map(() => "?").join(",");
    const res = await env.DB.prepare(
      `SELECT sg.subscription_id AS subscription_id, g.id AS id, g.name AS name, sg.sort_order AS sort_order
       FROM subscription_groups sg
       JOIN groups g ON g.id = sg.group_id
       WHERE sg.subscription_id IN (${ph})
       ORDER BY sg.subscription_id ASC, sg.sort_order ASC, g.id ASC`,
    )
      .bind(...chunk)
      .all<any>();
    for (const r of res.results ?? []) {
      const sid = Number(r.subscription_id);
      const list = out.get(sid) || [];
      list.push({ id: Number(r.id), name: String(r.name), sortOrder: Number(r.sort_order || 0) });
      out.set(sid, list);
    }
  }

  const missing = ids.filter((id) => !out.has(id));
  for (let i = 0; i < missing.length; i += chunkSize) {
    const chunk = missing.slice(i, i + chunkSize);
    const ph2 = chunk.map(() => "?").join(",");
    const legacy = await env.DB.prepare(
      `SELECT s.id AS subscription_id, g.id AS id, g.name AS name
       FROM subscriptions s
       JOIN groups g ON g.id = s.group_id
       WHERE s.id IN (${ph2})`,
    )
      .bind(...chunk)
      .all<any>();
    for (const r of legacy.results ?? []) {
      const sid = Number(r.subscription_id);
      if (out.has(sid)) continue;
      out.set(sid, [{ id: Number(r.id), name: String(r.name), sortOrder: 0 }]);
    }
  }
  return out;
}

export async function listSubscriptionGroups(
  env: Env,
  subscriptionId: number,
): Promise<Array<{ id: number; name: string; sortOrder: number }>> {
  const res = await env.DB.prepare(
    `SELECT g.id AS id, g.name AS name, sg.sort_order AS sort_order
     FROM subscription_groups sg
     JOIN groups g ON g.id = sg.group_id
     WHERE sg.subscription_id = ?
     ORDER BY sg.sort_order ASC, g.id ASC`,
  )
    .bind(subscriptionId)
    .all<any>();
  const rows = res.results ?? [];
  if (rows.length) {
    return rows.map((r) => ({ id: Number(r.id), name: String(r.name), sortOrder: Number(r.sort_order || 0) }));
  }
  const legacy = await env.DB.prepare(
    `SELECT g.id AS id, g.name AS name FROM subscriptions s JOIN groups g ON g.id = s.group_id WHERE s.id = ? LIMIT 1`,
  )
    .bind(subscriptionId)
    .first<any>();
  return legacy ? [{ id: Number(legacy.id), name: String(legacy.name), sortOrder: 0 }] : [];
}

export async function loadSubscriptionNodes(
  env: Env,
  subscriptionId: number,
  fallbackGroupId?: number,
): Promise<NormalizedNode[]> {
  let groupIds = await getSubscriptionGroupIds(env, subscriptionId);
  if (!groupIds.length && fallbackGroupId) groupIds = [fallbackGroupId];
  if (!groupIds.length) return [];
  const ph = groupIds.map(() => "?").join(",");
  const res = await env.DB.prepare(
    `SELECT sn.id AS id, sn.normalized_json AS normalized_json, gn.group_id AS group_id
     FROM group_nodes gn
     JOIN source_nodes sn ON sn.id = gn.node_id
     WHERE gn.group_id IN (${ph}) AND gn.enabled = 1 AND sn.enabled = 1 AND sn.stale = 0
     ORDER BY gn.sort_order ASC, sn.source_order ASC, sn.id ASC`,
  )
    .bind(...groupIds)
    .all<{ id: number; normalized_json: string; group_id: number }>();

  const byGroup = new Map<number, Array<{ id: number; normalized_json: string }>>();
  for (const r of res.results ?? []) {
    const gid = Number(r.group_id);
    const list = byGroup.get(gid) || [];
    list.push(r);
    byGroup.set(gid, list);
  }
  const out: NormalizedNode[] = [];
  const seen = new Set<number>();
  for (const gid of groupIds) {
    for (const r of byGroup.get(gid) || []) {
      const nid = Number(r.id);
      if (seen.has(nid)) continue;
      seen.add(nid);
      out.push(JSON.parse(r.normalized_json) as NormalizedNode);
    }
  }
  return out;
}

export async function loadSubscriptionNodeMeta(
  env: Env,
  subscriptionId: number,
  fallbackGroupId?: number,
) {
  let groupIds = await getSubscriptionGroupIds(env, subscriptionId);
  if (!groupIds.length && fallbackGroupId) groupIds = [fallbackGroupId];
  if (!groupIds.length) return [];
  const ph = groupIds.map(() => "?").join(",");
  const res = await env.DB.prepare(
    `SELECT sn.id AS id, sn.protocol AS protocol, sn.name AS name, sn.normalized_json AS normalized_json,
            sn.enabled AS enabled, sn.stale AS stale, gn.group_id AS group_id
     FROM group_nodes gn
     JOIN source_nodes sn ON sn.id = gn.node_id
     WHERE gn.group_id IN (${ph}) AND gn.enabled = 1
     ORDER BY gn.sort_order ASC, sn.source_order ASC, sn.id ASC`,
  )
    .bind(...groupIds)
    .all<any>();

  const byGroup = new Map<number, any[]>();
  for (const r of res.results ?? []) {
    const gid = Number(r.group_id);
    const list = byGroup.get(gid) || [];
    list.push(r);
    byGroup.set(gid, list);
  }
  const out: Array<{
    id: number;
    protocol: string;
    name: string;
    normalized_json: string;
    enabled: number;
    stale: number;
  }> = [];
  const seen = new Set<number>();
  for (const gid of groupIds) {
    for (const r of byGroup.get(gid) || []) {
      const nid = Number(r.id);
      if (seen.has(nid)) continue;
      seen.add(nid);
      out.push({
        id: nid,
        protocol: r.protocol,
        name: r.name,
        normalized_json: r.normalized_json,
        enabled: r.enabled,
        stale: r.stale,
      });
    }
  }
  return out;
}

export async function countSubscriptionGroupRefs(env: Env, groupId: number): Promise<number> {
  const usedA = await env.DB.prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE group_id = ?")
    .bind(groupId)
    .first<{ c: number }>();
  const usedB = await env.DB.prepare("SELECT COUNT(*) AS c FROM subscription_groups WHERE group_id = ?")
    .bind(groupId)
    .first<{ c: number }>();
  return Number(usedA?.c || 0) + Number(usedB?.c || 0);
}
