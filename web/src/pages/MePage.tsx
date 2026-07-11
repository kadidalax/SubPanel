import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { badgeClass, fmtBytes, fmtTime, healthLabel } from "../lib/format";
import { buildImportLinks, buildSubUrl, CLIENT_LINKS, copyText, loadSubToken, saveSubToken } from "../lib/sub";
import { Flash } from "../components/ui";

export function MePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [tokenMap, setTokenMap] = useState<Record<number, string>>({});
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  async function load() {
    const res = await api.get<any>("/api/user/subscriptions");
    const list = res.subscriptions || [];
    setRows(list);
    const map: Record<number, string> = {};
    for (const r of list) {
      const t = loadSubToken(r.id);
      if (t) map[r.id] = t;
    }
    setTokenMap(map);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function rotate(id: number) {
    setError("");
    try {
      const res = await api.post<any>(`/api/user/subscriptions/${id}/rotate`);
      saveSubToken(id, res.token);
      setTokenMap((m) => ({ ...m, [id]: res.token }));
      await copyText(buildSubUrl(res.token, "auto"));
      setMsg(`订阅 #${id} 已轮换，通用链接已复制`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "轮换失败");
    }
  }

  async function copyFormat(id: number, format: any, title: string) {
    const token = tokenMap[id];
    if (!token) {
      setError("本会话无明文 token，请先轮换一次");
      return;
    }
    await copyText(buildSubUrl(token, format));
    setMsg(`已复制 ${title}`);
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      await api.put("/api/user/password", { currentPassword, newPassword });
      setMsg("密码已修改，请重新登录");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "改密失败");
    }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-main">
          <h2>我的订阅</h2>
        </div>
        <div className="page-header-subrow">
          <div className="sub">复制客户端链接、查看用量与到期。设备数为订阅拉取指纹，不是在线存活设备。</div>
        </div>
      </div>
      <Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />

      <div className="card-list">
        {rows.map((r) => (
          <div className="card stack" key={r.id}>
            <div className="toolbar" style={{ justifyContent: "space-between" }}>
              <div>
                <h3 style={{ margin: 0 }}>{r.name}</h3>
                <div className="muted mono">prefix {r.tokenPrefix}</div>
              </div>
              <span className={badgeClass(r.health?.status || (r.enabled ? "ok" : "blocked"))}>
                {healthLabel(r.health?.status) || (r.enabled ? "启用" : "停用")}
              </span>
            </div>
            <div className="chip-row">
              <span className="chip">节点 {r.health?.nodeActive ?? "—"}</span>
              <span className="chip">订阅设备 {r.health?.devices?.used ?? 0}/{r.health?.devices?.limit ?? "∞"}</span>
              <span className="chip">{r.health?.usage?.label || r.usageMode} {r.health?.usage?.percent != null ? `${r.health.usage.percent}%` : ""}</span>
              <span className="chip">到期 {r.health?.daysToExpire != null ? `${r.health.daysToExpire}天` : fmtTime(r.expireAt)}</span>
            </div>
            {r.health?.warnings?.length ? <div className="warn-box">{r.health.warnings.join("；")}</div> : null}
            <div className="toolbar">
              {CLIENT_LINKS.slice(0, 4).map((c) => (
                <button key={c.id} className="btn secondary" onClick={() => copyFormat(r.id, c.format, c.title)}>复制 {c.title}</button>
              ))}
              <button className="btn" onClick={() => rotate(r.id)}>轮换并复制</button>
            </div>
            {tokenMap[r.id] ? (() => {
              const autoUrl = buildSubUrl(tokenMap[r.id], "auto");
              const imp = buildImportLinks(autoUrl);
              return (
                <div className="split-2" style={{ alignItems: "center" }}>
                  <div className="stack-sm">
                    <div className="muted">一键导入 / 扫码（通用 auto 链接）</div>
                    <div className="toolbar">
                      <a className="btn secondary" href={imp.clash}>Clash 导入</a>
                      <a className="btn secondary" href={imp.singbox}>sing-box 导入</a>
                      <button type="button" className="btn secondary" onClick={() => copyText(autoUrl).then(() => setMsg("已复制通用链接"))}>复制链接</button>
                    </div>
                  </div>
                  <img src={imp.qr} alt="subscription qr" width={120} height={120} style={{ borderRadius: 12, border: "1px solid var(--line)", background: "#fff" }} />
                </div>
              );
            })() : <div className="muted">当前会话无完整链接，需先轮换一次才能复制各格式 URL / 显示二维码。</div>}
          </div>
        ))}
        {!rows.length ? <div className="card empty"><div className="empty-ico" aria-hidden="true" /><h3>暂无订阅</h3><p className="muted">请联系管理员为你创建订阅入口。</p></div> : null}
      </div>

      <form className="card stack" style={{ maxWidth: 480 }} onSubmit={changePassword}>
        <div className="section-head"><h3 className="section-title">修改密码</h3></div>
        <div className="field"><label>当前密码</label><input className="input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></div>
        <div className="field"><label>新密码（≥10）</label><input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
        <button className="btn">保存密码</button>
      </form>
    </>
  );
}
