import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fmtTime } from "../lib/format";
import { useSelection } from "../lib/selection";
import { BatchBar, ConfirmDialog, EmptyState, Flash, PageHeader } from "../components/ui";

export function NodesPage() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const sel = useSelection<number>();

  async function load() {
    const res = await api.get<any>("/api/admin/nodes");
    setNodes(res.nodes || []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    return nodes.filter((n) => {
      if (onlyActive && (n.stale || !n.enabled)) return false;
      if (!q) return true;
      const hay = (n.name + " " + n.protocol + " " + n.source_name + " " + n.id).toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [nodes, q, onlyActive]);

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
            <input className="input" style={{ maxWidth: 280 }} placeholder="搜索名称/协议/来源/emoji" value={q} onChange={(e) => setQ(e.target.value)} />
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

        {!filtered.length ? (
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
                <th>能力</th>
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
                  <td>{n.source_name}</td>
                  <td className="mono muted">{String(n.capability_flags || "").slice(0, 40)}</td>
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
