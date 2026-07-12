import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtTime } from "../lib/format";
import { ConfirmDialog, Flash } from "../components/ui";

type Tab = "audit" | "access" | "notifications" | "jobs";

export function LogsPage() {
  const [tab, setTab] = useState<Tab>("audit");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [clientFamily, setClientFamily] = useState("");
  const [notifStatus, setNotifStatus] = useState("");
  const [notifKind, setNotifKind] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  async function load() {
    setError("");
    const params = new URLSearchParams();
    let path = "/api/admin/jobs";
    if (tab === "audit") {
      path = "/api/admin/audit-logs";
      if (action) params.set("action", action);
    } else if (tab === "access") {
      path = "/api/admin/access-logs";
      if (subscriptionId) params.set("subscriptionId", subscriptionId);
      if (clientFamily) params.set("clientFamily", clientFamily);
    } else if (tab === "notifications") {
      path = "/api/admin/notifications";
      if (notifStatus) params.set("status", notifStatus);
      if (notifKind) params.set("kind", notifKind);
    }
    const qs = params.toString();
    const r = await api.get<any>(path + (qs ? "?" + qs : ""));
    setRows(r.logs || r.notifications || r.jobs || []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [tab]);

  async function retryNotification(id: number) {
    setError("");
    setMsg("");
    try {
      await api.post("/api/admin/notifications/" + id + "/retry");
      setMsg("通知 #" + id + " 已重试");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试失败");
    }
  }

  async function clearLogs() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await api.post<any>("/api/admin/logs/clear", { tab });
      setMsg(`已清空当前页日志（${tab}），删除 ${res.deleted ?? 0} 条`);
      setConfirmClear(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "清空失败");
    } finally {
      setBusy(false);
    }
  }

  const tabLabel =
    tab === "audit" ? "审计" : tab === "access" ? "访问" : tab === "notifications" ? "通知" : "任务";

  return (
    <>
      <div className="page-header">
        <div className="page-header-main">
          <h2>日志</h2>
        </div>
        <div className="page-header-subrow">
          <div className="sub">仅保留近 7 天（按配置天数），每天自动清理；可手动清空当前类别。</div>
        </div>
      </div>

      <Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />

      <div className="tabs-bar">
        <div className="tabs">
          {([
            ["audit", "审计"],
            ["access", "访问"],
            ["notifications", "通知"],
            ["jobs", "任务"],
          ] as const).map(([t, label]) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>{label}</button>
          ))}
        </div>
        <div className="tabs-filters">
          {tab === "audit" ? (
            <input className="input" style={{ width: 160 }} placeholder="动作过滤" value={action} onChange={(e) => setAction(e.target.value)} />
          ) : null}
          {tab === "access" ? (
            <>
              <input className="input" style={{ width: 110 }} placeholder="订阅 ID" value={subscriptionId} onChange={(e) => setSubscriptionId(e.target.value)} />
              <input className="input" style={{ width: 140 }} placeholder="客户端" value={clientFamily} onChange={(e) => setClientFamily(e.target.value)} />
            </>
          ) : null}
          {tab === "notifications" ? (
            <>
              <select className="input filter-select" value={notifStatus} onChange={(e) => setNotifStatus(e.target.value)}>
                <option value="">全部状态</option>
                <option value="pending">pending</option>
                <option value="sent">sent</option>
                <option value="failed">failed</option>
              </select>
              <input className="input" style={{ width: 120 }} placeholder="kind" value={notifKind} onChange={(e) => setNotifKind(e.target.value)} />
            </>
          ) : null}
          {tab !== "jobs" ? (
            <button className="btn secondary sm" disabled={busy} onClick={() => load().catch((e) => setError(e.message))}>筛选</button>
          ) : (
            <button className="btn secondary sm" disabled={busy} onClick={() => load().catch((e) => setError(e.message))}>刷新</button>
          )}
          <button className="btn danger sm" disabled={busy} onClick={() => setConfirmClear(true)}>清空{tabLabel}</button>
        </div>
      </div>

      <div className="card table-wrap">
        {!rows.length ? <div className="empty"><h3>暂无记录</h3><p className="muted">调整过滤条件或稍后再看。</p></div> : (
        <table>
          <thead>
            <tr>
              {tab === "audit" ? (<><th>ID</th><th>动作</th><th>目标</th><th>操作者</th><th>时间</th></> ) : null}
              {tab === "access" ? (<><th>ID</th><th>订阅</th><th>客户端</th><th>格式</th><th>字节</th><th>时间</th></> ) : null}
              {tab === "notifications" ? (<><th>ID</th><th>事件</th><th>类型</th><th>状态</th><th>错误</th><th>时间</th><th></th></> ) : null}
              {tab === "jobs" ? (<><th>ID</th><th>key</th><th>类型</th><th>状态</th><th>错误</th><th>时间</th></> ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {tab === "audit" ? (<><td>{r.id}</td><td className="mono">{r.action}</td><td>{r.target_type} {r.target_id || ""}</td><td>{r.actor_user_id ?? "—"}</td><td>{fmtTime(r.created_at)}</td></>) : null}
                {tab === "access" ? (<><td>{r.id}</td><td>{r.subscription_id}</td><td>{r.client_family}</td><td>{r.format}</td><td>{r.response_bytes}</td><td>{fmtTime(r.created_at)}</td></>) : null}
                {tab === "notifications" ? (<><td>{r.id}</td><td className="mono">{r.event_key}</td><td>{r.kind}</td><td>{r.status}</td><td className="muted">{r.last_error || "—"}</td><td>{fmtTime(r.created_at)}</td><td>{r.status === "failed" || r.status === "pending" ? <button className="btn secondary sm" onClick={() => retryNotification(r.id)}>重试</button> : null}</td></>) : null}
                {tab === "jobs" ? (<><td>{r.id}</td><td className="mono">{r.job_key}</td><td>{r.kind}</td><td>{r.status}</td><td className="muted">{r.last_error || "—"}</td><td>{fmtTime(r.created_at)}</td></>) : null}
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        title={`清空${tabLabel}日志`}
        message={`将删除当前「${tabLabel}」分类的全部日志，不可恢复。保留策略仍会每日清理超过保留天数的记录。`}
        confirmText="确认清空"
        danger
        loading={busy}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearLogs}
      />
    </>
  );
}