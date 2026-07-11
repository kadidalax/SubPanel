import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Flash } from "../components/ui";

const flowSteps = [
  { n: 1, title: "导入数据源", desc: "手工 URI / 远程订阅 / 透传内容", to: "/sources", action: "去导入" },
  { n: 2, title: "整理分组", desc: "节点池确认后编成可下发集合", to: "/groups", action: "去分组" },
  { n: 3, title: "创建订阅入口", desc: "详情页复制各客户端链接", to: "/subscriptions", action: "去创建" },
  { n: 4, title: "用户自助", desc: "「我的订阅」轮换 token 并复制", to: "/me", action: "去查看" },
];

export function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/api/admin/dashboard")
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const cards = data ? [
    { label: "用户", value: data.users, desc: "本地账号" },
    { label: "订阅入口", value: data.subscriptions, desc: "可分发链接" },
    { label: "停用订阅", value: data.disabledSubscriptions, desc: "含到期/超额" },
    { label: "近24h拉取", value: data.accessLast24h ?? 0, desc: "订阅访问" },
    { label: "7天内到期", value: data.expiring7d ?? 0, desc: "需关注" },
    { label: "数据源", value: data.sources, desc: "手工/远程/透传" },
    { label: "异常源", value: data.degradedSources ?? 0, desc: "健康异常" },
    { label: "活跃节点", value: data.nodes, desc: "启用且可用" },
    { label: "失败任务", value: data.failedJobs, desc: "队列失败" },
    { label: "待发通知", value: data.pendingNotifications, desc: "邮件队列" },
  ] : [];

  return (
    <>
      <div className="page-header">
        <div className="page-header-main">
          <h2>总览</h2>
        </div>
        <div className="page-header-subrow">
          <div className="sub">订阅运营状态一览。流量为手工/上游额度，设备为订阅指纹。</div>
          <div className="page-actions">
            <Link className="btn secondary" to="/sources">导入数据源</Link>
            <Link className="btn" to="/subscriptions">管理订阅入口</Link>
          </div>
        </div>
      </div>

      <Flash error={error} onDismissError={() => setError("")} />

      {loading ? (
        <div className="stat-grid dash-stats">
          {Array.from({ length: 10 }).map((_, i) => (
            <div className="stat-card" key={i}>
              <div className="skeleton" style={{ height: 14, width: "40%" }} />
              <div className="skeleton" style={{ height: 28, width: "55%" }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="stat-grid dash-stats">
          {cards.map((c) => (
            <div className="stat-card" key={c.label}>
              <div className="stat-label">{c.label}</div>
              <div>
                <div className="stat-value">{c.value}</div>
                <div className="stat-desc">{c.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card stack">
        <div className="section-head">
          <h3 className="section-title">推荐流程</h3>
          <span className="badge muted">4 步</span>
        </div>
        <div className="flow-grid">
          {flowSteps.map((s) => (
            <Link className="flow-card" key={s.n} to={s.to}>
              <div className="flow-card-top">
                <span className="flow-n">{s.n}</span>
                <strong>{s.title}</strong>
              </div>
              <div className="muted flow-card-desc">{s.desc}</div>
              <span className="chip">{s.action}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
