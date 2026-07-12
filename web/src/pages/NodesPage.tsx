import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fmtTime } from "../lib/format";
import { useSelection } from "../lib/selection";
import { BatchBar, ConfirmDialog, EmptyState, Flash, ListLoading, PageHeader } from "../components/ui";

type NodeGroup = { id: number; name: string };

export function NodesPage() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [protocol, setProtocol] = useState("all");
  const [groupId, setGroupId] = useState("all");
  const [sourceId, setSourceId] = useState("all");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const sel = useSelection<number>();


async function loadAllNodes() {
  const pageSize = 500;
  let offset = 0;
  let total = Infinity;
  const all: any[] = [];
  while (offset < total && all.length < 2000) {
    const n = await api.get<any>(`/api/admin/nodes?limit=${pageSize}&offset=${offset}`);
    total = Number(n.total || 0);
    const chunk = n.nodes || [];
    all.push(...chunk);
    if (!chunk.length) break;
    offset += pageSize;
  }
  return all;
}

  async function load() {
    try {
      const [nodes, g] = await Promise.all([
        loadAllNodes(),
        api.get<any>("/api/admin/groups"),
      ]);
      setNodes(nodes);
      setGroups((g.groups || []).map((x: any) => ({ id: Number(x.id), name: String(x.name || "") })));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  const protocols = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) {
      const p = String(n.protocol || "").trim();
      if (p) set.add(p);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [nodes]);

  const sources = useMemo(() => {
    const map = new Map<number, string>();
    for (const n of nodes) {
      const id = Number(n.source_id);
      if (!Number.isFinite(id)) continue;
      if (!map.has(id)) map.set(id, String(n.source_name || ("#" + id)));
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.id - b.id);
  }, [nodes]);

  const filtered = useMemo(() => {
    return nodes.filter((n) => {
      if (onlyActive && (n.stale || !n.enabled)) return false;
      if (protocol !== "all" && String(n.protocol || "") !== protocol) return false;
      if (sourceId !== "all" && Number(n.source_id) !== Number(sourceId)) return false;
      if (groupId !== "all") {
        const ids: number[] = Array.isArray(n.groupIds)
          ? n.groupIds.map(Number)
          : Array.isArray(n.groups)
            ? n.groups.map((x: NodeGroup) => Number(x.id))
            : [];
        if (groupId === "0") {
          if (ids.length) return false;
        } else if (!ids.includes(Number(groupId))) {
          return false;
        }
      }
      if (!q) return true;
      const groupNames = Array.isArray(n.groups) ? n.groups.map((x: NodeGroup) => x.name).join(" ") : "";
      const hay = (n.name + " " + n.protocol + " " + n.source_name + " " + groupNames + " " + n.id).toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [nodes, q, onlyActive, protocol, groupId, sourceId]);

  const ids = filtered.map((n) => n.id as number);

  async function runBatch(action: "enable" | "disable" | "delete") {
    if (!sel.count) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.post<any>("/api/admin/nodes/batch", { ids: sel.selected, action });
      setMsg(
        action === "delete"
          ? `已删除 ${res.deleted} 个节点`
          : `已${action === "enable" ? "启用" : "停用"} ${res.changed} 个节点`,
      );
      sel.clear();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量操作失败");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function toggle(id: number, enabled: boolean) {
    await api.post("/api/admin/nodes/" + id + "/enabled", { enabled });
    setMsg("节点 #" + id + " 已" + (enabled ? "启用" : "停用"));
    await load();
  }

  function groupLabel(n: any): string {
    const list: NodeGroup[] = Array.isArray(n.groups) ? n.groups : [];
    if (!list.length) return "—";
    return list.map((g) => g.name).join(", ");
  }

  return (
    <>
      <PageHeader
        title="节点池"
        sub="标准化节点管理。stale 表示远程刷新后已消失。建议：导入源 → 整理节点 → 建分组。"
        steps={["数据源导入", "节点整理", "分组绑定", "订阅下发"]}
        actions={<Link className="btn secondary" to="/groups">去分组</Link>}
      />
      <Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />
      <div className="card table-wrap">
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <input
              className="input filter-search"
              placeholder="搜索"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="input filter-select"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              title="节点类型"
            >
              <option value="all">全部类型</option>
              {protocols.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select
              className="input filter-select"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              title="数据来源"
            >
              <option value="all">全部来源</option>
              {sources.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.name}</option>
              ))}
            </select>
            <select
              className="input filter-select"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              title="所属分组"
            >
              <option value="all">全部分组</option>
              <option value="0">未分组</option>
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>{g.name}</option>
              ))}
            </select>
            <label className="check-item" style={{ margin: 0 }}>
              <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
              <span>仅启用且非 stale</span>
            </label>
            <span className="muted">{filtered.length} / {nodes.length}</span>
          </div>
          <div className="list-toolbar-right">
            <BatchBar count={sel.count} total={filtered.length} onClear={sel.clear}>
              <button className="btn secondary sm" disabled={busy} onClick={() => runBatch("enable")}>批量启用</button>
              <button className="btn secondary sm" disabled={busy} onClick={() => runBatch("disable")}>批量停用</button>
              <button
                className="btn danger sm"
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    title: "批量删除节点",
                    message: `将删除 ${sel.count} 个节点，并同步从所有分组移除。此操作不可撤销。`,
                    action: () => runBatch("delete"),
                  })
                }
              >
                批量删除
              </button>
            </BatchBar>
          </div>
        </div>

        {loading ? (
          <ListLoading />
        ) : !filtered.length ? (
          <EmptyState title="暂无节点" desc="先去数据源导入，再在这里管理启用状态。" action={<Link className="btn secondary" to="/sources">去数据源</Link>} />
        ) : (
          <table>
            <thead>
              <tr>
                <th className="check-col">
                  <input type="checkbox" checked={sel.allSelected(ids)} onChange={() => sel.toggleAll(ids)} />
                </th>
                <th>ID</th>
                <th>名称</th>
                <th>协议</th>
                <th>来源</th>
                <th>分组</th>
                <th>状态</th>
                <th>最近</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => (
                <tr key={n.id} className={sel.has(n.id) ? "selected" : ""}>
                  <td>
                    <input type="checkbox" checked={sel.has(n.id)} onChange={() => sel.toggle(n.id)} />
                  </td>
                  <td>{n.id}</td>
                  <td className="name-cell emoji-safe" title={n.name}>{n.name}</td>
                  <td>{n.protocol}</td>
                  <td className="emoji-safe">{n.source_name}</td>
                  <td className="emoji-safe muted" title={groupLabel(n)}>{groupLabel(n)}</td>
                  <td>
                    <span className={n.enabled ? "badge ok" : "badge bad"}>{n.enabled ? "启用" : "停用"}</span>
                    {n.stale ? <span className="badge warn" style={{ marginLeft: 6 }}>stale</span> : null}
                  </td>
                  <td>{fmtTime(n.last_seen_at)}</td>
                  <td className="toolbar">
                    <button className="btn secondary sm" onClick={() => toggle(n.id, !n.enabled)}>{n.enabled ? "停用" : "启用"}</button>
                    <button
                      className="btn secondary sm"
                      onClick={() =>
                        setConfirm({
                          title: "删除节点",
                          message: `删除节点 #${n.id}（${n.name}）？会从所有分组移除。`,
                          action: async () => {
                            await api.del("/api/admin/nodes/" + n.id);
                            setMsg("节点 #" + n.id + " 已删除");
                            setConfirm(null);
                            await load();
                          },
                        })
                      }
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ""}
        message={confirm?.message || ""}
        danger
        loading={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          setBusy(true);
          try {
            await confirm.action();
          } catch (e) {
            setError(e instanceof Error ? e.message : "操作失败");
            setConfirm(null);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
