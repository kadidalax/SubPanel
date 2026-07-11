import { FormEvent, useState } from "react";
import { api } from "../lib/api";
import { Flash, PageHeader } from "../components/ui";

export function PasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    setBusy(true);
    try {
      await api.put("/api/user/password", { currentPassword, newPassword });
      setMsg("密码已修改，即将重新登录…");
      setCurrentPassword("");
      setNewPassword("");
      try {
        await api.post("/api/auth/logout");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        window.location.href = "/";
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "改密失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="修改密码" sub="更新登录密码。修改成功后需重新登录。" />
      <Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />
      <form className="card stack" style={{ maxWidth: 480 }} onSubmit={onSubmit}>
        <div className="field">
          <label>当前密码</label>
          <input className="input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="field">
          <label>新密码（≥10）</label>
          <input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <button className="btn" disabled={busy}>{busy ? "保存中..." : "保存密码"}</button>
      </form>
    </>
  );
}
