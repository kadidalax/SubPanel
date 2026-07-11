import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { Flash } from "../components/ui";

type CompatCell = { format: string; ok: boolean; note?: string };
type CompatRow = {
  protocol: string;
  formats?: string[];
  cells?: CompatCell[];
  notes?: string[];
  kernels?: Record<string, string>;
};

const FORMAT_COLS = [
  { key: "mihomo", label: "mihomo" },
  { key: "singbox", label: "sing-box" },
  { key: "uri", label: "uri" },
  { key: "surge", label: "surge" },
] as const;

function cellOf(row: CompatRow, format: string): CompatCell {
  const fromCells = row.cells?.find((c) => c.format === format);
  if (fromCells) return fromCells;
  const note = row.kernels?.[format];
  const ok = Array.isArray(row.formats) ? row.formats.includes(format) : false;
  return { format, ok, note };
}

export function SettingsPage() {
  const [siteName, setSiteName] = useState("Sub Panel");
  const [mailFrom, setMailFrom] = useState("");
  const [expireDays, setExpireDays] = useState("7,3,1");
  const [trafficWarn, setTrafficWarn] = useState("80");
  const [retention, setRetention] = useState("7");
  const [autoReenable, setAutoReenable] = useState(false);
  const [mailEnabled, setMailEnabled] = useState(true);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpPassSet, setSmtpPassSet] = useState(false);
  const [updateInterval, setUpdateInterval] = useState("24");
  const [supportUrl, setSupportUrl] = useState("");
  const [announce, setAnnounce] = useState("");
  const [refreshBatch, setRefreshBatch] = useState("10");
  const [matrix, setMatrix] = useState<CompatRow[]>([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api.get<any>("/api/admin/settings"),
      api.get<any>("/api/admin/compat-matrix"),
    ]).then(([r, m]) => {
      const s = r.settings || {};
      if (s.site_name) setSiteName(String(s.site_name));
      if (s.mail_from) setMailFrom(String(s.mail_from));
      if (s.expire_remind_days != null) {
        setExpireDays(Array.isArray(s.expire_remind_days) ? s.expire_remind_days.join(",") : String(s.expire_remind_days));
      }
      if (s.traffic_warn_percent != null) setTrafficWarn(String(s.traffic_warn_percent));
      if (s.access_log_retention_days != null) setRetention(String(s.access_log_retention_days));
      if (s.auto_reenable != null) setAutoReenable(Boolean(s.auto_reenable));
      if (s.mail_enabled != null) setMailEnabled(Boolean(s.mail_enabled));
      if (s.smtp_host != null) setSmtpHost(String(s.smtp_host));
      if (s.smtp_port != null) setSmtpPort(String(s.smtp_port));
      if (s.smtp_secure != null) setSmtpSecure(Boolean(s.smtp_secure));
      if (s.smtp_user != null) setSmtpUser(String(s.smtp_user));
      setSmtpPassSet(Boolean(s.smtp_pass_set));
      setSmtpPass("");
      if (s.profile_update_interval_hours != null) setUpdateInterval(String(s.profile_update_interval_hours));
      if (s.support_url != null) setSupportUrl(String(s.support_url));
      if (s.announce != null) setAnnounce(String(s.announce));
      if (s.refresh_batch_limit != null) setRefreshBatch(String(s.refresh_batch_limit));
      setMatrix(m.matrix || []);
    }).catch((e) => setError(e.message));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      const days = expireDays.split(/[,\s]+/).map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
      await api.put("/api/admin/settings", {
        settings: {
          site_name: siteName,
          mail_from: mailFrom,
          expire_remind_days: days.length ? days : [7, 3, 1],
          traffic_warn_percent: Number(trafficWarn),
          access_log_retention_days: Number(retention),
          auto_reenable: autoReenable,
          mail_enabled: mailEnabled,
          profile_update_interval_hours: Number(updateInterval),
          support_url: supportUrl,
          announce,
          refresh_batch_limit: Number(refreshBatch),
          smtp_host: smtpHost,
          smtp_port: Number(smtpPort || 465),
          smtp_secure: smtpSecure,
          smtp_user: smtpUser,
          smtp_pass: smtpPass,
        },
      });
      setMsg("设置已保存");
      if (smtpPass) { setSmtpPassSet(true); setSmtpPass(""); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-main">
          <h2>设置</h2>
        </div>
        <div className="page-header-subrow">
          <div className="sub">站级默认配置；保存后立即影响下发与扫描逻辑。</div>
        </div>
      </div>
      <Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />

      <form className="card settings-card stack" onSubmit={save}>
        <div className="section-head"><h3 className="section-title">通用设置</h3></div>
        <div className="settings-flow">
          <div className="field f-sm"><label>站点名称</label><input className="input" value={siteName} onChange={(e) => setSiteName(e.target.value)} maxLength={64} /></div>
          <div className="field f-md"><label>到期提前提醒（天）</label><input className="input" value={expireDays} onChange={(e) => setExpireDays(e.target.value)} placeholder="7,3,1" maxLength={32} /></div>
          <div className="field f-md"><label>流量提醒阈值（%）</label><input className="input" value={trafficWarn} onChange={(e) => setTrafficWarn(e.target.value)} maxLength={3} inputMode="numeric" /></div>
          <div className="field f-sm"><label>日志保留天数</label><input className="input" value={retention} onChange={(e) => setRetention(e.target.value)} maxLength={3} inputMode="numeric" /></div>
          <div className="field f-md"><label>更新间隔（小时）</label><input className="input" value={updateInterval} onChange={(e) => setUpdateInterval(e.target.value)} maxLength={4} inputMode="numeric" /></div>
          <div className="field f-sm"><label>远程刷新上限</label><input className="input" value={refreshBatch} onChange={(e) => setRefreshBatch(e.target.value)} maxLength={4} inputMode="numeric" /></div>
          <div className="field f-lg"><label>支持链接 support-url</label><input className="input" value={supportUrl} onChange={(e) => setSupportUrl(e.target.value)} placeholder="https://..." maxLength={256} /></div>
          <div className="field f-xl"><label>公告 announce</label><input className="input" value={announce} onChange={(e) => setAnnounce(e.target.value)} maxLength={200} /></div>
        </div>
        <div className="settings-checks">
          <label className="check-row"><input type="checkbox" checked={autoReenable} onChange={(e) => setAutoReenable(e.target.checked)} /> 条件解除后自动恢复（manual 停用不恢复）</label>
          <button className="btn">保存</button>
        </div>
      </form>

      <form className="card settings-card stack" style={{ marginTop: 16 }} onSubmit={save}>
        <div className="section-head">
          <h3 className="section-title">发件配置</h3>
          <div className="muted">第三方 SMTP；到期 / 流量 / 自动停用提醒。密码 AES 加密存 D1，留空表示不修改。</div>
        </div>
        <div className="settings-flow">
          <div className="field f-md"><label>发件邮箱</label><input className="input" value={mailFrom} onChange={(e) => setMailFrom(e.target.value)} placeholder="noreply@example.com" maxLength={120} /></div>
          <div className="field f-lg"><label>SMTP 主机</label><input className="input" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" maxLength={120} /></div>
          <div className="field f-sm"><label>SMTP 端口</label><input className="input" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="465" maxLength={5} inputMode="numeric" /></div>
          <div className="field f-md"><label>SMTP 用户名</label><input className="input" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="可选" maxLength={120} autoComplete="off" /></div>
          <div className="field f-md"><label>SMTP 密码</label><input className="input" type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder={smtpPassSet ? "已保存，留空不改" : "可选"} maxLength={200} autoComplete="new-password" /></div>
        </div>
        <div className="settings-checks">
          <label className="check-row"><input type="checkbox" checked={mailEnabled} onChange={(e) => setMailEnabled(e.target.checked)} /> 启用邮件发送</label>
          <label className="check-row"><input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} /> SMTP TLS（465 勾选；587 STARTTLS 可不勾）</label>
          <button className="btn">保存</button>
        </div>
      </form>

      <div className="card settings-card stack" style={{ marginTop: 16 }}>
        <div className="section-head">
          <h3 className="section-title">协议兼容矩阵</h3>
          <div className="muted">对照最新 mihomo Meta / sing-box / Surge 主线 + 本面板 emitter；能力不足时 skip，不删 TLS/Reality。</div>
        </div>
        <div className="table-wrap compat-matrix-wrap">
          <table className="compat-matrix">
            <thead>
              <tr>
                <th>协议</th>
                {FORMAT_COLS.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th>条件备注</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.protocol}>
                  <td className="mono">{row.protocol}</td>
                  {FORMAT_COLS.map((c) => {
                    const cell = cellOf(row, c.key);
                    return (
                      <td key={c.key} className={cell.ok ? "compat-ok" : "compat-no"}>
                        <span className="compat-mark">{cell.ok ? "✓" : "✗"}</span>
                        {cell.note ? <span className="compat-note muted">{cell.note}</span> : null}
                      </td>
                    );
                  })}
                  <td className="muted compat-notes">{(row.notes || []).join("；") || "—"}</td>
                </tr>
              ))}
              {!matrix.length ? (
                <tr>
                  <td colSpan={6} className="muted">加载中…</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}