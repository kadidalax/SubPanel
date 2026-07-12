import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useSelection } from "../lib/selection";
import { BatchBar, ConfirmDialog, EmptyState, Flash, ListLoading, Modal, PageHeader } from "../components/ui";

export function GroupsPage() {
  const [groups, setGroups] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("default");
  const [previewFormat, setPreviewFormat] = useState("uri");
  const [preview, setPreview] = useState<any>(null);
  const [openEditor, setOpenEditor] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const [q, setQ] = useState("");
  const [protocolFilter, setProtocolFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [pickMode, setPickMode] = useState<"node" | "source">("node");
  const sel = useSelection<number>();
  const nodeSel = useSelection<number>();


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
      const [g, nodes] = await Promise.all([api.get<any>("/api/admin/groups"), loadAllNodes()]);
      setGroups(g.groups || []);
      setNodes(nodes.filter((x: any) => x.enabled && !x.stale));
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

  const filteredNodes = useMemo(() => {
    const k = q.trim().toLowerCase();
    return nodes.filter((n) => {
      if (protocolFilter !== "all" && String(n.protocol || "") !== protocolFilter) return false;
      if (sourceFilter !== "all" && Number(n.source_id) !== Number(sourceFilter)) return false;
      if (groupFilter !== "all") {
        const ids: number[] = Array.isArray(n.groupIds)
          ? n.groupIds.map(Number)
          : Array.isArray(n.groups)
            ? n.groups.map((x: any) => Number(x.id))
            : [];
        if (groupFilter === "0") {
          if (ids.length) return false;
        } else if (!ids.includes(Number(groupFilter))) {
          return false;
        }
      }
      if (!k) return true;
      const groupNames = Array.isArray(n.groups) ? n.groups.map((x: any) => x.name).join(" ") : "";
      const hay = (n.name + " " + n.protocol + " " + n.source_name + " " + groupNames + " " + n.id).toLowerCase();
      return hay.includes(k);
    });
  }, [nodes, q, protocolFilter, sourceFilter, groupFilter]);

  const filteredNodeIds = filteredNodes.map((n) => n.id as number);

  const hasActiveFilter = useMemo(() => {
    return q.trim() !== "" || protocolFilter !== "all" || sourceFilter !== "all" || groupFilter !== "all";
  }, [q, protocolFilter, sourceFilter, groupFilter]);

  const allNodeIds = useMemo(() => nodes.map((n) => n.id as number), [nodes]);
  const selectScopeIds = hasActiveFilter ? filteredNodeIds : allNodeIds;
  const selectScopeAllSelected = selectScopeIds.length > 0 && selectScopeIds.every((id) => nodeSel.has(id));

  function nodesOfSource(sid: number): number[] {
    return nodes
      .filter((n) => Number(n.source_id) === sid)
      .map((n) => n.id as number);
  }

  const sourcePickRows = useMemo(() => {
    const k = q.trim().toLowerCase();
    const rows = sources
      .map((s) => {
        const ids = nodesOfSource(Number(s.id));
        const selectedCount = ids.filter((id) => nodeSel.has(id)).length;
        return {
          id: Number(s.id),
          name: String(s.name || ""),
          nodeIds: ids,
          total: ids.length,
          selectedCount,
          checked: ids.length > 0 && selectedCount === ids.length,
          partial: selectedCount > 0 && selectedCount < ids.length,
        };
      })
      .filter((r) => r.total > 0);
    if (!k) return rows;
    return rows.filter((r) => (r.name + " " + r.id).toLowerCase().includes(k));
  }, [sources, nodes, q, nodeSel.selected]);

  function toggleSelectScope() {
    if (!selectScopeIds.length) return;
    if (selectScopeAllSelected) {
      // deselect current scope only
      nodeSel.set(nodeSel.selected.filter((id) => !selectScopeIds.includes(id)));
    } else {
      // select current scope, preserve previous selection order then append missing
      const seen = new Set(nodeSel.selected);
      const next = [...nodeSel.selected];
      for (const id of selectScopeIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        next.push(id);
      }
      nodeSel.set(next);
    }
  }

  function toggleSourcePick(sid: number) {
    const ids = nodesOfSource(sid);
    if (!ids.length) return;
    const allOn = ids.every((id) => nodeSel.has(id));
    if (allOn) {
      nodeSel.set(nodeSel.selected.filter((id) => !ids.includes(id)));
    } else {
      const seen = new Set(nodeSel.selected);
      const next = [...nodeSel.selected];
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        next.push(id);
      }
      nodeSel.set(next);
    }
  }

  function openCreate() {
    setEditId(null);
    setName("default");
    nodeSel.clear();
    setQ("");
    setProtocolFilter("all");
    setSourceFilter("all");
    setGroupFilter("all");
    setPickMode("node");
    setOpenEditor(true);
  }

  async function openEdit(id: number) {
    setError("");
    try {
      const res = await api.get<any>("/api/admin/groups/" + id);
      setEditId(id);
      setName(res.group?.name || "");
      nodeSel.set((res.nodeIds || []).map(Number));
      setQ("");
      setProtocolFilter("all");
      setSourceFilter("all");
      setGroupFilter("all");
      setPickMode("node");
      setOpenEditor(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载分组失败");
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (editId == null) {
        const res = await api.post<any>("/api/admin/groups", { name, nodeIds: nodeSel.selected });
        setMsg("分组 #" + res.id + " 已创建" + (nodeSel.count ? "，节点 " + nodeSel.count : "（空分组，可稍后加节点）"));
      } else {
        await api.put("/api/admin/groups/" + editId, { name, nodeIds: nodeSel.selected });
        setMsg("分组 #" + editId + " 已更新" + (nodeSel.count ? "，节点 " + nodeSel.count : "（空分组）"));
      }
      setOpenEditor(false);
      nodeSel.clear();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function showPreview(id: number) {
    setError("");
    try {
      const res = await api.get<any>("/api/admin/groups/" + id + "/preview?format=" + previewFormat);
      setPreview(res);
      setMsg("分组 #" + id + " " + previewFormat + " 预览：节点 " + res.nodeCount + "，跳过 " + (res.skipped?.length || 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : "预览失败");
    }
  }

  async function runBatchDelete() {
    setBusy(true);
    try {
      const res = await api.post<any>("/api/admin/groups/batch", { ids: sel.selected, action: "delete" });
      setMsg(`批量删除分组：成功 ${res.deleted}，失败 ${(res.failed || []).length}`);
      if ((res.failed || []).length) setError((res.failed || []).map((f: any) => `#${f.id} ${f.error}`).join("；"));
      sel.clear();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量失败");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const ids = groups.map((g) => g.id as number);

  return (
    <>
      <PageHeader
        title="分组"
        sub="可先建空分组，之后再勾选节点；也可预览多格式输出与 skip 原因。"
        steps={["数据源", "节点池", "分组", "订阅入口"]}
        actions={
          <>
            <button className="btn" onClick={openCreate}>新建分组</button>
            <Link className="btn secondary" to="/subscriptions">去订阅入口</Link>
          </>
        }
      />
      <Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />

      <div className="card table-wrap">
          <div className="list-toolbar">
            <div className="list-toolbar-left">
              <label className="muted">预览格式</label>
              <select
                className="input filter-select"
                value={previewFormat}
                onChange={(e) => setPreviewFormat(e.target.value)}
                title="预览格式"
                aria-label="预览格式"
              >
                <option value="uri">uri</option>
                <option value="uri-base64">uri-base64</option>
                <option value="mihomo">mihomo</option>
                <option value="singbox">singbox</option>
                <option value="surge">surge</option>
              </select>
              <span className="muted">{groups.length} 个分组</span>
            </div>
            <div className="list-toolbar-right">
              <BatchBar count={sel.count} total={groups.length} onClear={sel.clear}>
                <button
                  className="btn danger sm"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      title: "批量删除分组",
                      message: `将删除 ${sel.count} 个分组。若仍被订阅引用会失败。`,
                      action: runBatchDelete,
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
          ) : !groups.length ? (
            <EmptyState title="还没有分组" desc="可先建空分组，后续再加节点并创建订阅入口。" action={<button className="btn" onClick={openCreate}>新建分组</button>} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="check-col"><input type="checkbox" checked={sel.allSelected(ids)} onChange={() => sel.toggleAll(ids)} /></th>
                  <th>ID</th><th>名称</th><th>revision</th><th></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className={sel.has(g.id) ? "selected" : ""}>
                    <td><input type="checkbox" checked={sel.has(g.id)} onChange={() => sel.toggle(g.id)} /></td>
                    <td>{g.id}</td>
                    <td className="name-cell emoji-safe" title={g.name}>{g.name}</td>
                    <td>{g.revision}</td>
                    <td className="toolbar">
                      <button className="btn secondary sm" onClick={() => showPreview(g.id)}>预览</button>
                      <button className="btn secondary sm" onClick={() => openEdit(g.id)}>编辑</button>
                      <button
                        className="btn secondary sm"
                        onClick={() =>
                          setConfirm({
                            title: "删除分组",
                            message: `删除分组 #${g.id}（${g.name}）？`,
                            action: async () => {
                              await api.del("/api/admin/groups/" + g.id);
                              setMsg("分组 #" + g.id + " 已删除");
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

          {preview ? (
            <div style={{ marginTop: 14 }} className="stack">
              {(preview.skipped || []).length ? (
                <div className="warn-box">
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>跳过 {preview.skipped.length} 个节点</div>
                  {(preview.skipped || []).slice(0, 30).map((s: any, i: number) => (
                    <div key={i}>• <span className="emoji-safe">{s.name}</span>: <span className="mono">{s.reason}</span></div>
                  ))}
                </div>
              ) : null}
              <pre className="mono emoji-safe" style={{ whiteSpace: "pre-wrap", background: "var(--bg-soft)", padding: 12, borderRadius: 12, maxHeight: 280, overflow: "auto" }}>{preview.bodyPreview}</pre>
            </div>
          ) : null}
      </div>

      <Modal
        open={openEditor}
        title={editId == null ? "新建分组" : `编辑分组 #${editId}`}
        description="可不选节点直接创建空分组。支持按节点/按来源选择；有筛选时全选仅作用于当前筛选结果。勾选顺序=排序。"
        onClose={() => setOpenEditor(false)}
        wide
        footer={
          <>
            <button type="button" className="btn secondary" onClick={() => setOpenEditor(false)}>取消</button>
            <button form="group-form" className="btn btn-save-count" disabled={busy}>{busy ? "保存中..." : `保存（${nodeSel.count}）`}</button>
          </>
        }
      >
        <form id="group-form" className="stack" onSubmit={save}>
          <div className="field"><label>名称</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field">
            <label>选择节点</label>
            <div className="list-toolbar modal-list-toolbar" style={{ marginBottom: 8 }}>
              <div className="list-toolbar-left">
                <div className="seg-toggle" role="tablist" aria-label="选择方式">
                  <button type="button" className={pickMode === "node" ? "seg active" : "seg"} onClick={() => setPickMode("node")}>按节点</button>
                  <button type="button" className={pickMode === "source" ? "seg active" : "seg"} onClick={() => setPickMode("source")}>按来源</button>
                </div>
                <input className="input filter-search" placeholder="搜索" value={q} onChange={(e) => setQ(e.target.value)} />
                {pickMode === "node" ? (
                  <>
                    <select className="input filter-select" value={protocolFilter} onChange={(e) => setProtocolFilter(e.target.value)} title="节点类型">
                      <option value="all">全部类型</option>
                      {protocols.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <select className="input filter-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} title="数据来源">
                      <option value="all">全部来源</option>
                      {sources.map((s) => (
                        <option key={s.id} value={String(s.id)}>{s.name}</option>
                      ))}
                    </select>
                    <select className="input filter-select" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} title="所属分组">
                      <option value="all">全部分组</option>
                      <option value="0">未分组</option>
                      {groups.map((g) => (
                        <option key={g.id} value={String(g.id)}>{g.name}</option>
                      ))}
                    </select>
                    <span className="muted">可见 {filteredNodes.length}</span>
                  </>
                ) : (
                  <span className="muted">来源 {sourcePickRows.length}</span>
                )}
              </div>
              <div className="list-toolbar-right">
                <span className="sel-count muted">已选 {nodeSel.count}</span>
                {pickMode === "node" ? (
                  <button
                    type="button"
                    className="btn secondary sm"
                    disabled={!selectScopeIds.length}
                    onClick={toggleSelectScope}
                  >
                    {selectScopeAllSelected
                      ? (hasActiveFilter ? "取消全选(筛选)" : "取消全选")
                      : (hasActiveFilter ? "全选(筛选)" : "全选全部")}
                  </button>
                ) : null}
                <button type="button" className="btn ghost sm" disabled={!nodeSel.count} onClick={nodeSel.clear}>清空</button>
              </div>
            </div>
            <div className="check-list">
              {pickMode === "node" ? (
                <>
                  {filteredNodes.map((n) => (
                    <label key={n.id} className="check-item">
                      <input type="checkbox" checked={nodeSel.has(n.id)} onChange={() => nodeSel.toggle(n.id)} />
                      <span className="emoji-safe">
                        #{n.id} {n.name}{" "}
                        <span className="muted">({n.protocol} · {n.source_name || "—"})</span>
                      </span>
                    </label>
                  ))}
                  {!filteredNodes.length ? <div className="muted">暂无匹配节点，调整筛选或先去数据源导入</div> : null}
                </>
              ) : (
                <>
                  {sourcePickRows.map((g) => (
                    <label key={g.id} className="check-item">
                      <input
                        type="checkbox"
                        checked={g.checked}
                        ref={(el) => {
                          if (el) el.indeterminate = g.partial;
                        }}
                        onChange={() => toggleSourcePick(g.id)}
                      />
                      <span className="emoji-safe">
                        {g.name}{" "}
                        <span className="muted">({g.selectedCount}/{g.total} 节点)</span>
                      </span>
                    </label>
                  ))}
                  {!sourcePickRows.length ? <div className="muted">暂无可用来源节点</div> : null}
                </>
              )}
            </div>
          </div>
        </form>
      </Modal>

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
          try { await confirm.action(); }
          catch (e) { setError(e instanceof Error ? e.message : "操作失败"); setConfirm(null); }
          finally { setBusy(false); }
        }}
      />
    </>
  );
}
