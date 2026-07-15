import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { badgeClass, fmtTime, sourceHealthLabel } from "../lib/format";
import { useSelection } from "../lib/selection";
import { BatchBar, ConfirmDialog, EmptyState, Flash, ListLoading, Modal, PageHeader } from "../components/ui";

export function SourcesPage() {
  const [sources, setSources] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"manual" | "remote" | "pass" | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const sel = useSelection<number>();

  const [name, setName] = useState("manual");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [remoteName, setRemoteName] = useState("remote");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [passName, setPassName] = useState("passthrough");
  const [passContent, setPassContent] = useState("");
  const [passFormat, setPassFormat] = useState("uri");
  const [editId, setEditId] = useState<number | null>(null);
  const [editKind, setEditKind] = useState<string>("");
  const [editRefreshMin, setEditRefreshMin] = useState("60");
  const [editEnabled, setEditEnabled] = useState(true);

  async function load() {
    try {
      const res = await api.get<any>("/api/admin/sources");
      setSources(res.sources || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  async function openEdit(id: number) {
    setError("");
    try {
      const res = await api.get<any>("/api/admin/sources/" + id);
      const s = res.source;
      setEditId(id);
      setEditKind(s.kind);
      setEditEnabled(Boolean(s.enabled));
      setEditRefreshMin(String(s.refresh_interval_minutes || 60));
      if (s.kind === "manual") {
        setName(s.name || "");
        setContent(s.manual_content || "");
        setModal("manual");
      } else if (s.kind === "remote") {
        setRemoteName(s.name || "");
        setRemoteUrl(""); // url encrypted; leave blank unless changing
        setModal("remote");
      } else {
        setPassName(s.name || "");
        setPassContent(s.manual_content || "");
        setPassFormat(s.passthrough_format || "uri");
        setModal("pass");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }

  function openCreate(kind: "manual" | "remote" | "pass") {
    setEditId(null);
    setEditKind(kind);
    setEditEnabled(true);
    setPreview(null);
    setModal(kind);
  }

  async function previewContent() {
    setError("");
    try {
      setPreview(await api.post("/api/admin/sources/preview", { content }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "预览失败");
    }
  }

  async function createManual(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (editId != null) {
        await api.put("/api/admin/sources/" + editId, {
          name,
          manualContent: content,
          enabled: editEnabled,
        });
        setMsg("手工源 #" + editId + " 已更新");
      } else {
        const res = await api.post<any>("/api/admin/sources/manual", { name, content });
        const d = res.diff || {};
        const dedupe =
          d.parsed != null && d.unique != null && d.parsed > d.unique
            ? "，去重 " + d.parsed + "→" + d.unique
            : "";
        setMsg("手工源 #" + res.id + " 已导入 " + res.nodeCount + " 节点（+" + (d.added ?? 0) + dedupe + "）");
      }
      setContent("");
      setPreview(null);
      setModal(null);
      setEditId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function createRemote(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (editId != null) {
        await api.put("/api/admin/sources/" + editId, {
          name: remoteName,
          enabled: editEnabled,
          refreshIntervalMinutes: Number(editRefreshMin) || 60,
          url: remoteUrl || undefined,
          refresh: Boolean(remoteUrl),
        });
        setMsg("远程源 #" + editId + " 已更新" + (remoteUrl ? "并刷新" : ""));
      } else {
        const res = await api.post<any>("/api/admin/sources/remote", { name: remoteName, url: remoteUrl });
        setMsg("远程源 #" + res.id + " 已拉取 " + res.nodeCount + " 节点");
      }
      setRemoteUrl("");
      setModal(null);
      setEditId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function createPass(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (editId != null) {
        await api.put("/api/admin/sources/" + editId, {
          name: passName,
          manualContent: passContent,
          passthroughFormat: passFormat,
          enabled: editEnabled,
        });
        setMsg("透传源 #" + editId + " 已更新");
      } else {
        const res = await api.post<any>("/api/admin/sources/passthrough", {
          name: passName,
          content: passContent,
          passthroughFormat: passFormat,
        });
        setMsg("透传源 #" + res.id + " 已创建");
      }
      setPassContent("");
      setModal(null);
      setEditId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function refresh(id: number) {
    setError("");
    try {
      const res = await api.post<any>("/api/admin/sources/" + id + "/refresh");
      const d = res.diff || {};
      setMsg(`源 #${id} 刷新完成：+${d.added ?? 0} / 更新 ${d.updated ?? 0} / stale ${d.staleMarked ?? 0}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新失败");
    }
  }

  async function runBatch(action: "refresh" | "delete") {
    if (!sel.count) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.post<any>("/api/admin/sources/batch", { ids: sel.selected, action });
      if (action === "refresh") setMsg(`批量刷新完成：成功 ${res.ok}，失败 ${(res.failed || []).length}`);
      else setMsg(`批量删除：成功 ${res.deleted}，失败 ${(res.failed || []).length}`);
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

  const ids = sources.map((s) => s.id as number);

  return (
    <>
      <PageHeader
        title="数据源"
        sub="手工 / 远程 / 透传。失败保留旧版本；连续失败 5 次暂停自动刷新。"
        steps={["导入数据源", "整理节点", "创建分组", "下发订阅"]}
        actions={
          <>
            <button className="btn secondary" onClick={() => openCreate("manual")}>手工导入</button>
            <button className="btn secondary" onClick={() => openCreate("remote")}>远程订阅</button>
            <button className="btn secondary" onClick={() => openCreate("pass")}>透传源</button>
            <Link className="btn" to="/nodes">去节点池</Link>
          </>
        }
      />
      <Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />

      <div className="card table-wrap">
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <span>数据源列表</span>
            <span>{sources.length} 项</span>
          </div>
          <div className="list-toolbar-right">
            <BatchBar count={sel.count} total={sources.length} onClear={sel.clear}>
              <button className="btn secondary sm" disabled={busy} onClick={() => runBatch("refresh")}>批量刷新</button>
              <button
                className="btn danger sm"
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    title: "批量删除数据源",
                    message: `将删除 ${sel.count} 个数据源。若被分组引用会失败并保留。`,
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
        ) : !sources.length ? (
          <EmptyState title="先导入手工节点或远程订阅" desc="导入成功后到节点池勾选进分组，再创建订阅入口。" action={<button className="btn" onClick={() => openCreate("manual")}>开始导入</button>} />
        ) : (
          <table>
            <thead>
              <tr>
                <th className="check-col"><input type="checkbox" checked={sel.allSelected(ids)} onChange={() => sel.toggleAll(ids)} /></th>
                <th>ID</th><th>名称</th><th>类型</th><th>健康</th><th>节点</th><th>影响订阅</th><th>失败</th><th>最近成功</th><th>错误</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className={sel.has(s.id) ? "selected" : ""}>
                  <td><input type="checkbox" checked={sel.has(s.id)} onChange={() => sel.toggle(s.id)} /></td>
                  <td>{s.id}</td>
                  <td className="name-cell emoji-safe" title={s.name}>{s.name}</td>
                  <td>{s.kind}{s.passthrough_format ? "/" + s.passthrough_format : ""}</td>
                  <td><span className={badgeClass(s.health)}>{sourceHealthLabel(s.health)}</span></td>
                  <td className="mono">{s.active_nodes ?? 0}<span className="muted">/{(s.active_nodes ?? 0) + (s.stale_nodes ?? 0)}</span></td>
                  <td>{s.impacted_subscriptions ?? 0}</td>
                  <td>{s.failure_count}</td>
                  <td>{fmtTime(s.last_success_at)}</td>
                  <td className="mono muted">{s.last_error || "—"}</td>
                  <td className="toolbar">
                    <button className="btn secondary sm" onClick={() => openEdit(s.id)}>编辑</button>
                    {s.kind === "remote" || s.kind === "manual" ? <button className="btn secondary sm" onClick={() => refresh(s.id)}>刷新</button> : null}
                    <button
                      className="btn secondary sm"
                      onClick={() =>
                        setConfirm({
                          title: "删除数据源",
                          message: `删除源 #${s.id}（${s.name}）？`,
                          action: async () => {
                            await api.del("/api/admin/sources/" + s.id);
                            setMsg("源 #" + s.id + " 已删除");
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

      <Modal open={modal === "manual"} title={editId ? `编辑手工源 #${editId}` : "手工导入"} description="支持 URI / Base64 / Mihomo / sing-box，保留 emoji 与证书字段。" onClose={() => { setModal(null); setEditId(null); }} wide footer={
        <>
          <button type="button" className="btn secondary" onClick={previewContent}>预览解析</button>
          <button form="manual-form" className="btn" disabled={busy}>{busy ? "导入中..." : "保存"}</button>
        </>
      }>
        <form id="manual-form" className="stack" onSubmit={createManual}>
          <div className="field"><label>名称</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label>节点内容</label><textarea className="textarea" value={content} onChange={(e) => setContent(e.target.value)} placeholder="粘贴节点或订阅原文" /></div>
          <div className="preview-slot">
            {preview ? (
              <div className="info-box">
                格式 <strong>{preview.detectedFormat}</strong> · 节点 <strong>{preview.nodeCount}</strong>
                {(preview.warnings || []).slice(0, 6).map((w: any, i: number) => (
                  <div key={i} className="muted">• {w.code}: {w.message}</div>
                ))}
              </div>
            ) : (
              <div className="muted preview-slot-empty">预览结果将显示在这里</div>
            )}
          </div>
        </form>
      </Modal>

      <Modal open={modal === "remote"} title={editId ? `编辑远程源 #${editId}` : "远程订阅"} description="仅 HTTPS，拒绝私网与危险重定向。" onClose={() => { setModal(null); setEditId(null); }} footer={
        <button form="remote-form" className="btn" disabled={busy}>{busy ? "拉取中..." : "拉取并保存"}</button>
      }>
        <form id="remote-form" className="stack" onSubmit={createRemote}>
          <div className="field"><label>名称</label><input className="input" value={remoteName} onChange={(e) => setRemoteName(e.target.value)} /></div>
          <div className="field"><label>HTTPS URL{editId ? "（留空则不改）" : ""}</label><input className="input" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://example.com/sub" required={editId == null} /></div>
          {editId ? (
            <>
              <div className="field"><label>刷新间隔（分钟）</label><input className="input" value={editRefreshMin} onChange={(e) => setEditRefreshMin(e.target.value)} /></div>
              <label className="check-item"><input type="checkbox" checked={editEnabled} onChange={(e) => setEditEnabled(e.target.checked)} /><span>启用</span></label>
            </>
          ) : null}
        </form>
      </Modal>

      <Modal open={modal === "pass"} title={editId ? `编辑透传源 #${editId}` : "透传源"} description="原样下发锁定格式，不参与节点标准化。" onClose={() => { setModal(null); setEditId(null); }} footer={
        <button form="pass-form" className="btn" disabled={busy}>保存透传</button>
      }>
        <form id="pass-form" className="stack" onSubmit={createPass}>
          <div className="field"><label>名称</label><input className="input" value={passName} onChange={(e) => setPassName(e.target.value)} /></div>
          <div className="field">
            <label>锁定格式</label>
            <select className="input" value={passFormat} onChange={(e) => setPassFormat(e.target.value)}>
              <option value="uri">uri</option>
              <option value="mihomo">mihomo</option>
              <option value="singbox">singbox</option>
              <option value="surge">surge</option>
            </select>
          </div>
          <div className="field"><label>原始内容</label><textarea className="textarea" value={passContent} onChange={(e) => setPassContent(e.target.value)} /></div>
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
