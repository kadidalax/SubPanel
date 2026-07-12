import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { badgeClass, bytesToGbInput, fmtTime, gbToBytes } from "../lib/format";
import { buildSubUrl, copyText, loadSubToken, saveSubToken } from "../lib/sub";
import { useSelection } from "../lib/selection";
import { BatchBar, ConfirmDialog, EmptyState, Flash, ListLoading, Modal, PageHeader } from "../components/ui";

export function SubscriptionsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [createdToken, setCreatedToken] = useState("");
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const sel = useSelection<number>();

  const [userId, setUserId] = useState("");
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [name, setName] = useState("default");
  const [deviceLimit, setDeviceLimit] = useState("2");
  const [usageMode, setUsageMode] = useState("none");
  const [trafficLimit, setTrafficLimit] = useState("");
  const [exclusiveSourceId, setExclusiveSourceId] = useState("");
  const [expireDays, setExpireDays] = useState("");
  const [defaultFormat, setDefaultFormat] = useState("auto");

  async function load() {
    try {
      const [s, u, g, src] = await Promise.all([
        api.get<any>("/api/admin/subscriptions"),
        api.get<any>("/api/admin/users"),
        api.get<any>("/api/admin/groups"),
        api.get<any>("/api/admin/sources"),
      ]);
      setRows(s.subscriptions || []);
      setUsers(u.users || []);
      setGroups(g.groups || []);
      setSources(src.sources || []);
      if (!userId && u.users?.[0]) setUserId(String(u.users[0].id));
      if (!groupIds.length && g.groups?.[0]) setGroupIds([Number(g.groups[0].id)]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  function openCreateModal() {
    setEditId(null);
    setName("default");
    setGroupIds(groups[0] ? [Number(groups[0].id)] : []);
    setDeviceLimit("2");
    setUsageMode("none");
    setTrafficLimit("");
    setExclusiveSourceId("");
    setExpireDays("");
    setDefaultFormat("auto");
    setOpenCreate(true);
  }

  function openEdit(row: any) {
    setEditId(row.id);
    setUserId(String(row.user_id || row.userId || ""));
    const ids = Array.isArray(row.groupIds) && row.groupIds.length
      ? row.groupIds.map(Number).filter((n: number) => n > 0)
      : (row.group_id || row.groupId ? [Number(row.group_id || row.groupId)] : []);
    setGroupIds(ids);
    setName(row.name || "default");
    setDeviceLimit(row.device_limit == null ? "" : String(row.device_limit));
    setUsageMode(row.usage_mode || "none");
    setTrafficLimit(bytesToGbInput(row.traffic_limit_bytes));
    setExclusiveSourceId(row.exclusive_source_id == null ? "" : String(row.exclusive_source_id));
    setExpireDays("");
    setDefaultFormat(row.default_format || "auto");
    setOpenCreate(true);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    setCreatedToken("");
    try {
      const expireAt = expireDays ? Date.now() + Number(expireDays) * 86400000 : null;
      if (editId != null) {
        await api.put("/api/admin/subscriptions/" + editId, {
          name,
          groupIds,
          groupId: groupIds[0],
          deviceLimit: deviceLimit ? Number(deviceLimit) : null,
          usageMode,
          trafficLimitBytes: gbToBytes(trafficLimit),
          exclusiveSourceId: exclusiveSourceId ? Number(exclusiveSourceId) : null,
          expireAt: expireAt,
          defaultFormat,
        });
        setMsg(`订阅 #${editId} 已更新`);
      } else {
        const res = await api.post<any>("/api/admin/subscriptions", {
          userId: Number(userId),
          groupIds,
          groupId: groupIds[0],
          name,
          deviceLimit: deviceLimit ? Number(deviceLimit) : null,
          usageMode,
          trafficLimitBytes: gbToBytes(trafficLimit),
          exclusiveSourceId: exclusiveSourceId ? Number(exclusiveSourceId) : null,
          expireAt,
          defaultFormat,
        });
        setCreatedToken(res.token);
        setCreatedId(res.id);
        saveSubToken(res.id, res.token);
        setMsg(`已创建订阅 #${res.id}，token 仅显示一次`);
      }
      setOpenCreate(false);
      setEditId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(row: any) {
    setBusy(true);
    setError("");
    try {
      await api.put(`/api/admin/subscriptions/${row.id}`, { enabled: !row.enabled });
      setMsg(`订阅 #${row.id} 已${row.enabled ? "停用" : "启用"}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function ensureToken(id: number): Promise<string | null> {
    const cached = loadSubToken(id);
    if (cached) return cached;
    try {
      const res = await api.get<any>(`/api/admin/subscriptions/${id}/token`);
      if (res?.token) {
        saveSubToken(id, res.token);
        return res.token as string;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法读取订阅链接");
    }
    return null;
  }

  async function rotateToken(row: any) {
    setBusy(true);
    setError("");
    try {
      const res = await api.post<any>(`/api/admin/subscriptions/${row.id}/rotate`);
      saveSubToken(row.id, res.token);
      setCreatedToken(res.token);
      setCreatedId(row.id);
      await copyText(buildSubUrl(res.token, "auto")).catch(() => null);
      setMsg(`订阅 #${row.id} 已轮换：旧链接作废，新链接已复制`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "轮换失败");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function copyLink(row: any) {
    setError("");
    const token = await ensureToken(row.id);
    if (!token) {
      setError(`订阅 #${row.id} 无已存链接（旧数据需轮换一次后即可长期复用）`);
      return;
    }
    try {
      await copyText(buildSubUrl(token, "auto"));
      setCreatedToken(token);
      setCreatedId(row.id);
      setMsg(`已复制订阅 #${row.id} 链接（未改动 token）`);
    } catch {
      setError("复制失败");
    }
  }

  async function resetDevices(row: any) {
    setBusy(true);
    setError("");
    try {
      const res = await api.del<any>(`/api/admin/subscriptions/${row.id}/devices`);
      setMsg(`订阅 #${row.id} 已重置 ${res.removed || 0} 个设备`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "重置失败");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function deleteOne(row: any) {
    setBusy(true);
    setError("");
    try {
      await api.del(`/api/admin/subscriptions/${row.id}`);
      setMsg(`订阅 #${row.id} 已删除`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function runBatch(action: "enable" | "disable" | "delete") {
    setBusy(true);
    setError("");
    try {
      const res = await api.post<any>("/api/admin/subscriptions/batch", { ids: sel.selected, action });
      setMsg(action === "delete" ? `已删除 ${res.deleted} 个订阅` : `已${action === "enable" ? "启用" : "停用"} ${res.changed} 个订阅`);
      sel.clear();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量失败");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const ids = rows.map((r) => r.id as number);

  return (
    <>
      <PageHeader
        title="订阅入口"
        sub="为用户下发独立订阅链接。限制的是「拉取设备」指纹，不是代理在线连接数。"
        steps={["分组准备好", "创建订阅", "复制链接", "客户端导入"]}
        actions={<button className="btn" onClick={openCreateModal}>创建订阅</button>}
      />
      <Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />

      {createdToken ? (
        <div className="card">
          <div className="section-head">
            <h3 className="section-title">Token / 链接（可重复复制）</h3>
            {createdId ? <Link className="btn secondary sm" to={`/subscriptions/${createdId}`}>打开详情</Link> : null}
          </div>
          <div className="mono emoji-safe" style={{ wordBreak: "break-all" }}>{createdToken}</div>
          <div className="mono muted" style={{ marginTop: 8, wordBreak: "break-all" }}>{window.location.origin}/sub/{createdToken}</div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button
              className="btn secondary sm"
              onClick={() => copyText(`${window.location.origin}/sub/${createdToken}`).then(() => setMsg("已复制链接")).catch(() => setError("复制失败"))}
            >
              复制链接
            </button>
          </div>
        </div>
      ) : null}

      <div className="card table-wrap">
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <span>订阅列表</span>
            <span>{rows.length} 项</span>
          </div>
          <div className="list-toolbar-right">
            <BatchBar count={sel.count} total={rows.length} onClear={sel.clear}>
              <button className="btn secondary sm" disabled={busy} onClick={() => runBatch("enable")}>批量启用</button>
              <button className="btn secondary sm" disabled={busy} onClick={() => runBatch("disable")}>批量停用</button>
              <button
                className="btn danger sm"
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    title: "批量删除订阅",
                    message: `将删除 ${sel.count} 个订阅入口，不可恢复。`,
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
        ) : !rows.length ? (
          <EmptyState title="还没有订阅入口" desc="先准备分组，再为用户创建订阅并复制客户端链接。" action={<button className="btn" onClick={openCreateModal}>创建订阅</button>} />
        ) : (
          <table>
            <thead>
              <tr>
                <th className="check-col"><input type="checkbox" checked={sel.allSelected(ids)} onChange={() => sel.toggleAll(ids)} /></th>
                <th>ID</th><th>名称</th><th>用户</th><th>前缀</th><th>状态</th><th>拉取设备</th><th>模式</th><th>到期</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={sel.has(r.id) ? "selected" : ""}>
                  <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} /></td>
                  <td>{r.id}</td>
                  <td className="name-cell emoji-safe" title={r.name}>{r.name}</td>
                  <td>{r.username}</td>
                  <td className="mono">{r.token_prefix}</td>
                  <td>
                    <span className={badgeClass(r.enabled)}>{r.enabled ? "启用" : "停用"}</span>
                    {r.disabled_reason ? <div className="muted" style={{ fontSize: 12 }}>{r.disabled_reason}</div> : null}
                  </td>
                  <td>{r.device_limit ?? "不限"}</td>
                  <td>{r.usage_mode}</td>
                  <td>{fmtTime(r.expire_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn secondary sm" disabled={busy} onClick={() => openEdit(r)}>编辑</button>
                      <Link className="btn secondary sm" to={`/subscriptions/${r.id}`}>详情</Link>
                      <button className="btn secondary sm" disabled={busy} onClick={() => toggleEnabled(r)}>{r.enabled ? "停用" : "启用"}</button>
                      <button className="btn secondary sm" disabled={busy} onClick={() => copyLink(r)}>复制</button>
                      <button
                        className="btn secondary sm"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({
                            title: "轮换 Token",
                            message: `订阅 #${r.id} 旧链接立即失效，确认轮换？`,
                            action: () => rotateToken(r),
                          })
                        }
                      >
                        轮换
                      </button>
                      <button
                        className="btn secondary sm"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({
                            title: "重置设备",
                            message: `清空订阅 #${r.id} 的设备指纹，用户需重新拉取。`,
                            action: () => resetDevices(r),
                          })
                        }
                      >
                        重置设备
                      </button>
                      <button
                        className="btn danger sm"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({
                            title: "删除订阅",
                            message: `删除订阅 #${r.id}「${r.name}」，不可恢复。`,
                            action: () => deleteOne(r),
                          })
                        }
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={openCreate}
        title={editId ? `编辑订阅 #${editId}` : "创建订阅"}
        description="创建后可重复复制链接；轮换仅在需要作废旧链接时使用。拉取设备上限按订阅拉取指纹计算。"
        onClose={() => { setOpenCreate(false); setEditId(null); }}
        wide
        footer={
          <>
            <button type="button" className="btn secondary" onClick={() => { setOpenCreate(false); setEditId(null); }}>取消</button>
            <button form="sub-form" className="btn" disabled={busy || !userId || !groupIds.length}>{busy ? "保存中..." : (editId ? "保存" : "创建")}</button>
          </>
        }
      >
        <form id="sub-form" className="stack" onSubmit={create}>
          <div className="form-grid">
            <div className="field-row-compact">
              {editId == null ? (
                <div className="field compact">
                  <label>用户</label>
                  <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                  </select>
                </div>
              ) : null}
              <div className="field compact">
                <label>名称</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            <div className="field full">
              <label>分组（可多选，顺序=节点合并顺序）</label>
              <div className="check-list" style={{maxHeight: 220, overflow: 'auto'}}>
                {groups.map((g) => {
                  const id = Number(g.id);
                  const checked = groupIds.includes(id);
                  return (
                    <label key={id} className="check-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (checked) setGroupIds(groupIds.filter((x) => x !== id));
                          else setGroupIds([...groupIds, id]);
                        }}
                      />
                      <span>#{id} {g.name}</span>
                    </label>
                  );
                })}
                {!groups.length ? <div className="muted">暂无分组</div> : null}
              </div>
              <div className="muted" style={{marginTop: 6}}>已选 {groupIds.length} 个；节点去重，先勾选的分组优先</div>
            </div>
            <div className="field compact"><label>设备上限</label><input className="input" value={deviceLimit} onChange={(e) => setDeviceLimit(e.target.value)} placeholder="空=不限" /></div>
            <div className="field">
              <label>默认格式</label>
              <select className="input" value={defaultFormat} onChange={(e) => setDefaultFormat(e.target.value)}>
                <option value="auto">auto</option>
                <option value="mihomo">mihomo</option>
                <option value="singbox">singbox</option>
                <option value="uri">uri</option>
                <option value="uri-base64">uri-base64</option>
                <option value="surge">surge</option>
              </select>
            </div>
            <div className="field">
              <label>流量模式</label>
              <select className="input" value={usageMode} onChange={(e) => setUsageMode(e.target.value)}>
                <option value="none">none（不统计）</option>
                <option value="manual">manual（手工已用）</option>
                <option value="upstream_exclusive">upstream_exclusive（上游账号总流量）</option>
              </select>
            </div>
            {usageMode !== "none" ? (
              <div className="field"><label>流量上限（GB）</label><input className="input" value={trafficLimit} onChange={(e) => setTrafficLimit(e.target.value)} placeholder="例如 100" inputMode="decimal" /></div>
            ) : null}
            {usageMode === "upstream_exclusive" ? (
              <div className="field">
                <label>独占上游源</label>
                <select className="input" value={exclusiveSourceId} onChange={(e) => setExclusiveSourceId(e.target.value)}>
                  <option value="">选择源</option>
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.name} #{s.id}</option>)}
                </select>
              </div>
            ) : null}
            <div className="field"><label>有效天数（可选）</label><input className="input" value={expireDays} onChange={(e) => setExpireDays(e.target.value)} /></div>
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
