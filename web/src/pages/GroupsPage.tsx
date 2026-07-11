import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useSelection } from "../lib/selection";
import { BatchBar, ConfirmDialog, EmptyState, Flash, Modal, PageHeader } from "../components/ui";

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
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const [q, setQ] = useState("");
  const sel = useSelection<number>();
  const nodeSel = useSelection<number>();

  async function load() {
    const [g, n] = await Promise.all([api.get<any>("/api/admin/groups"), api.get<any>("/api/admin/nodes")]);
    setGroups(g.groups || []);
    setNodes((n.nodes || []).filter((x: any) => x.enabled && !x.stale));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const filteredNodes = useMemo(() => {
    if (!q) return nodes;
    const k = q.toLowerCase();
    return nodes.filter((n) => (n.name + " " + n.protocol + " " + n.id).toLowerCase().includes(k));
  }, [nodes, q]);

  const filteredNodeIds = filteredNodes.map((n) => n.id as number);

  function openCreate() {
    setEditId(null);
    setName("default");
    nodeSel.clear();
    setQ("");
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
              <select className="input" style={{ width: 160 }} value={previewFormat} onChange={(e) => setPreviewFormat(e.target.value)}>
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

          {!groups.length ? (
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
        description="可不选节点直接创建空分组。勾选顺序=排序。支持 emoji 节点名。"
        onClose={() => setOpenEditor(false)}
        wide
        footer={
          <>
            <button type="button" className="btn secondary" onClick={() => setOpenEditor(false)}>取消</button>
            <button form="group-form" className="btn btn-save-count" disabled={!nodeSel.count || busy}>{busy ? "保存中..." : `保存（${nodeSel.count}）`}</button>
          </>
        }
      >
        <form id="group-form" className="stack" onSubmit={save}>
          <div className="field"><label>名称</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field">
            <label>选择节点</label>
            <div className="list-toolbar modal-list-toolbar" style={{ marginBottom: 8 }}>
              <div className="list-toolbar-left">
                <input className="input" style={{ maxWidth: 240 }} placeholder="过滤节点 / emoji" value={q} onChange={(e) => setQ(e.target.value)} />
                <span className="muted">可见 {filteredNodes.length}</span>
              </div>
              <div className="list-toolbar-right">
                <span className="sel-count muted">已选 {nodeSel.count}</span>
                <button type="button" className="btn secondary sm" onClick={() => nodeSel.toggleAll(filteredNodeIds)}>全选可见</button>
                <button type="button" className="btn secondary sm" onClick={() => nodeSel.set(nodes.map((n) => n.id))}>全选全部</button>
                <button type="button" className="btn ghost sm" disabled={!nodeSel.count} onClick={nodeSel.clear}>清空</button>
              </div>
            </div>
            <div className="check-list">
              {filteredNodes.map((n) => (
                <label key={n.id} className="check-item">
                  <input type="checkbox" checked={nodeSel.has(n.id)} onChange={() => nodeSel.toggle(n.id)} />
                  <span className="emoji-safe">#{n.id} {n.name} <span className="muted">({n.protocol})</span></span>
                </label>
              ))}
              {!filteredNodes.length ? <div className="muted">暂无可用节点，先去数据源导入</div> : null}
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
