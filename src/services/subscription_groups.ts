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
  const out: NormalizedNode[] = [];
  const seen = new Set<number>();
  for (const gid of groupIds) {
    const res = await env.DB.prepare(
      `SELECT sn.id AS id, sn.normalized_json AS normalized_json
       FROM group_nodes gn
       JOIN source_nodes sn ON sn.id = gn.node_id
       WHERE gn.group_id = ? AND gn.enabled = 1 AND sn.enabled = 1 AND sn.stale = 0
       ORDER BY gn.sort_order ASC, sn.source_order ASC, sn.id ASC`,
    )
      .bind(gid)
      .all<{ id: number; normalized_json: string }>();
    for (const r of res.results ?? []) {
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
    const res = await env.DB.prepare(
      `SELECT sn.id AS id, sn.protocol AS protocol, sn.name AS name, sn.normalized_json AS normalized_json,
              sn.enabled AS enabled, sn.stale AS stale
       FROM group_nodes gn
       JOIN source_nodes sn ON sn.id = gn.node_id
       WHERE gn.group_id = ? AND gn.enabled = 1
       ORDER BY gn.sort_order ASC, sn.source_order ASC, sn.id ASC`,
    )
      .bind(gid)
      .all<any>();
    for (const r of res.results ?? []) {
      const nid = Number(r.id);
      if (seen.has(nid)) continue;
      seen.add(nid);
      out.push(r);
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
