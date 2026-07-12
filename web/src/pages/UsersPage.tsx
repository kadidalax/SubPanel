import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { badgeClass, fmtTime } from "../lib/format";
import { useSelection } from "../lib/selection";
import { BatchBar, ConfirmDialog, EmptyState, Flash, ListLoading, Modal, PageHeader } from "../components/ui";

export function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [expireDays, setExpireDays] = useState("");
  const [openCreate, setOpenCreate] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const sel = useSelection<number>();

  async function load() {
    try {
      const res = await api.get<any>("/api/admin/users");
      setUsers(res.users || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  function openCreateModal() {
    setEditId(null);
    setEditUsername("");
    setUsername("");
    setPassword("");
    setEmail("");
    setExpireDays("");
    setOpenCreate(true);
  }

  function openEdit(u: any) {
    setEditId(u.id);
    setEditUsername(u.username);
    setUsername(u.username);
    setPassword("");
    setEmail(u.email || "");
    setExpireDays("");
    setOpenCreate(true);
  }

  async function saveUser(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (editId != null) {
        const body: any = { email: email || null };
        if (password) body.password = password;
        if (expireDays !== "") body.expireAt = Date.now() + Number(expireDays) * 86400000;
        await api.put(`/api/admin/users/${editId}`, body);
        setMsg(`用户 #${editId} 已更新`);
      } else {
        await api.post("/api/admin/users", {
          username,
          password,
          email: email || null,
          role: "user",
        });
        setMsg("用户 " + username + " 已创建");
      }
      setOpenCreate(false);
      setEditId(null);
      setUsername("");
      setPassword("");
      setEmail("");
      setExpireDays("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: number, enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/admin/users/${id}/enabled`, { enabled });
      setMsg("用户 #" + id + " 已" + (enabled ? "启用" : "停用"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(u: any) {
    const next = window.prompt(`为用户 ${u.username} 设置新密码（至少 10 位）`);
    if (next == null) return;
    if (next.length < 10) {
      setError("密码至少 10 位");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.put(`/api/admin/users/${u.id}`, { password: next });
      setMsg(`用户 #${u.id} 密码已重置`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置失败");
    } finally {
      setBusy(false);
    }
  }

  async function runBatch(action: "enable" | "disable") {
    setBusy(true);
    try {
      const res = await api.post<any>("/api/admin/users/batch", { ids: sel.selected, action });
      setMsg(`已${action === "enable" ? "启用" : "停用"} ${res.changed} 个用户`);
      sel.clear();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量失败");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const ids = users.map((u) => u.id as number);

  return (
    <>
      <PageHeader
        title="用户"
        sub="管理员 / 次级用户（user）。"
        steps={["创建用户", "下发订阅", "查看使用"]}
        actions={<button className="btn" onClick={openCreateModal}>新建用户</button>}
      />
      <Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />

      <div className="card table-wrap">
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            <span>用户列表</span>
            <span>{users.length} 项</span>
          </div>
          <div className="list-toolbar-right">
            <BatchBar count={sel.count} total={users.length} onClear={sel.clear}>
              <button className="btn secondary sm" disabled={busy} onClick={() => runBatch("enable")}>批量启用</button>
              <button
                className="btn secondary sm"
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    title: "批量停用用户",
                    message: `将停用 ${sel.count} 个用户（跳过自己）。`,
                    action: () => runBatch("disable"),
                  })
                }
              >
                批量停用
              </button>
            </BatchBar>
          </div>
        </div>

        {loading ? (
          <ListLoading />
        ) : !users.length ? (
          <EmptyState title="暂无用户" desc="先创建次级账号，再为其下发订阅。" action={<button className="btn" onClick={openCreateModal}>新建用户</button>} />
        ) : (
          <table>
            <thead>
              <tr>
                <th className="check-col"><input type="checkbox" checked={sel.allSelected(ids)} onChange={() => sel.toggleAll(ids)} /></th>
                <th>ID</th><th>用户名</th><th>角色</th><th>邮箱</th><th>状态</th><th>到期</th><th>创建</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={sel.has(u.id) ? "selected" : ""}>
                  <td><input type="checkbox" checked={sel.has(u.id)} onChange={() => sel.toggle(u.id)} /></td>
                  <td>{u.id}</td>
                  <td className="emoji-safe">{u.username}</td>
                  <td><span className={"badge " + (u.role === "admin" ? "ok" : "muted")}>{u.role}</span></td>
                  <td>{u.email || "—"}</td>
                  <td><span className={badgeClass(u.enabled)}>{u.enabled ? "启用" : "停用"}</span></td>
                  <td>{fmtTime(u.expireAt || u.expire_at)}</td>
                  <td>{fmtTime(u.createdAt || u.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      {u.role !== "admin" ? (
                        <>
                          <button className="btn secondary sm" disabled={busy} onClick={() => openEdit(u)}>编辑</button>
                          <button className="btn secondary sm" disabled={busy} onClick={() => toggle(u.id, !u.enabled)}>{u.enabled ? "停用" : "启用"}</button>
                          <button className="btn secondary sm" disabled={busy} onClick={() => resetPassword(u)}>重置密码</button>
                        </>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>管理员</span>
                      )}
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
        title={editId != null ? `编辑用户 #${editId}（${editUsername}）` : "新建用户"}
        description={editId != null ? "可改邮箱/到期/密码。用户名不可改。" : "密码至少 10 位。角色固定为 user。"}
        onClose={() => { setOpenCreate(false); setEditId(null); }}
        footer={
          <>
            <button type="button" className="btn secondary" onClick={() => { setOpenCreate(false); setEditId(null); }}>取消</button>
            <button form="user-form" className="btn" disabled={busy}>{busy ? "保存中..." : (editId != null ? "保存" : "创建")}</button>
          </>
        }
      >
        <form id="user-form" className="stack" onSubmit={saveUser}>
          {editId == null ? (
            <div className="field"><label>用户名</label><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
          ) : (
            <div className="field"><label>用户名</label><input className="input" value={editUsername} disabled /></div>
          )}
          <div className="field">
            <label>{editId != null ? "新密码（留空不改）" : "密码"}</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={editId == null} minLength={editId == null ? 10 : undefined} />
          </div>
          <div className="field"><label>邮箱（可选）</label><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          {editId != null ? (
            <div className="field"><label>延长有效天数（可选）</label><input className="input" value={expireDays} onChange={(e) => setExpireDays(e.target.value)} placeholder="从现在起算" /></div>
          ) : null}
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
