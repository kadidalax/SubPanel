import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { badgeClass, fmtBytes, fmtTime, healthLabel } from "../lib/format";
import { buildImportLinks, buildSubUrl, CLIENT_LINKS, copyText, loadSubToken, saveSubToken } from "../lib/sub";
import { Flash, ListLoading, Modal } from "../components/ui";

type MeNode = {
  id: number;
  name: string;
  protocol: string;
  server: string;
  port: number | null;
  enabled: boolean;
  stale: boolean;
};

type MeTab = "subs" | "nodes";

type QrState = {
  title: string;
  url: string;
  qr: string;
  clash?: string;
  singbox?: string;
};

function usageText(usage: any) {
  if (!usage || usage.mode === "none") return "未统计";
  const used = fmtBytes(usage.usedBytes);
  const limit = usage.limitBytes == null ? "不限" : fmtBytes(usage.limitBytes);
  const pct = usage.percent != null ? ` (${usage.percent}%)` : "";
  return `${used} / ${limit}${pct}`;
}

export function MePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [tokenMap, setTokenMap] = useState<Record<number, string>>({});
  const [tab, setTab] = useState<MeTab>("subs");
  const [activeSubId, setActiveSubId] = useState<number | null>(null);
  const [nodes, setNodes] = useState<MeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [qr, setQr] = useState<QrState | null>(null);

  async function load() {
    try {
      const res = await api.get<any>("/api/user/subscriptions");
      const list = res.subscriptions || [];
      setRows(list);
      const map: Record<number, string> = {};
      for (const r of list) {
        const cached = loadSubToken(r.id);
        if (cached) map[r.id] = cached;
      }
      setTokenMap(map);
      if (list.length && activeSubId == null) setActiveSubId(list[0].id);
      if (activeSubId != null && !list.some((r: any) => r.id === activeSubId)) {
        setActiveSubId(list[0]?.id ?? null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function ensureToken(id: number): Promise<string | null> {
    const existing = tokenMap[id] || loadSubToken(id);
    if (existing) {
      if (!tokenMap[id]) setTokenMap((m) => ({ ...m, [id]: existing }));
      return existing;
    }
    try {
      const tr = await api.get<any>(`/api/user/subscriptions/${id}/token`);
      if (tr?.token) {
        saveSubToken(id, tr.token);
        setTokenMap((m) => ({ ...m, [id]: tr.token }));
        return tr.token as string;
      }
    } catch {
      /* legacy */
    }
    return null;
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadNodes(id: number) {
    setLoadingNodes(true);
    setError("");
    try {
      const res = await api.get<any>(`/api/user/subscriptions/${id}/nodes`);
      setNodes(res.nodes || []);
    } catch (err) {
      setNodes([]);
      setError(err instanceof Error ? err.message : "加载节点失败");
    } finally {
      setLoadingNodes(false);
    }
  }

  useEffect(() => {
    if (tab !== "nodes" || activeSubId == null) return;
    loadNodes(activeSubId).catch(() => {});
  }, [tab, activeSubId]);

  const activeSub = useMemo(() => rows.find((r) => r.id === activeSubId) || null, [rows, activeSubId]);

    async function showCopied(url: string, title: string) {
    const imp = buildImportLinks(url);
    setQr({ title, url, qr: imp.qr, clash: imp.clash, singbox: imp.singbox });
    try {
      await copyText(url);
      setMsg(`已复制 ${title}`);
    } catch {
      setMsg(`${title} 二维码已打开，复制失败可手动复制链接`);
    }
  }

  async function rotate(id: number) {
    setError("");
    try {
      const res = await api.post<any>(`/api/user/subscriptions/${id}/rotate`);
      saveSubToken(id, res.token);
      setTokenMap((m) => ({ ...m, [id]: res.token }));
      const url = buildSubUrl(res.token, "auto");
      await showCopied(url, "通用自动");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "轮换失败");
    }
  }

  async function copyFormat(id: number, format: any, title: string, vendor?: string) {
    const token = await ensureToken(id);
    if (!token) {
      setError("该订阅暂无可用链接，请先轮换一次以生成可复用链接");
      return;
    }
    await showCopied(buildSubUrl(token, format, vendor ? { vendor } : {}), title);
  }

  function goNodes(id: number) {
    setActiveSubId(id);
    setTab("nodes");
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-main">
          <h2>我的订阅</h2>
        </div>
        <div className="page-header-subrow">
          <div className="sub">复制客户端链接后会弹出对应二维码。设备数为订阅拉取指纹，不是在线存活设备。</div>
        </div>
      </div>

      <div className="tabs-bar">
        <div className="tabs">
          <button type="button" className={tab === "subs" ? "tab active" : "tab"} onClick={() => setTab("subs")}>订阅</button>
          <button type="button" className={tab === "nodes" ? "tab active" : "tab"} onClick={() => setTab("nodes")}>节点列表</button>
        </div>
        {tab === "nodes" && rows.length ? (
          <div className="tabs-filters">
            <label className="muted">订阅</label>
            <select
              className="input filter-select"
              value={activeSubId ?? ""}
              onChange={(e) => setActiveSubId(Number(e.target.value))}
              title="切换订阅"
              aria-label="切换订阅"
            >
              {rows.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />

      {tab === "subs" ? (
        <div className="card-list">
          {loading ? <ListLoading rows={3} /> : null}
          {!loading && rows.map((r) => (
            <div className="card stack me-sub-card" key={r.id}>
              <div className="me-sub-head">
                <div>
                  <h3 className="me-sub-title">{r.name}</h3>
                  <div className="muted mono">prefix {r.tokenPrefix}{r.groupNames ? " · "+r.groupNames : ""}</div>
                </div>
                <span className={badgeClass(r.health?.status || (r.enabled ? "ok" : "blocked"))}>
                  {healthLabel(r.health?.status) || (r.enabled ? "启用" : "停用")}
                </span>
              </div>

              <div className="stat-grid compact me-sub-stats">
                <div className="stat-card mini">
                  <div className="stat-label">流量</div>
                  <div className="stat-value me-sub-stat-value">{usageText(r.health?.usage)}</div>
                </div>
                <div className="stat-card mini">
                  <div className="stat-label">节点</div>
                  <div className="stat-value">{r.health?.nodeActive ?? "—"}</div>
                </div>
                <div className="stat-card mini">
                  <div className="stat-label">设备</div>
                  <div className="stat-value">
                    {r.health?.devices?.used ?? 0}
                    <span className="muted" style={{ fontSize: 14 }}>/{r.health?.devices?.limit ?? "∞"}</span>
                  </div>
                </div>
                <div className="stat-card mini">
                  <div className="stat-label">到期</div>
                  <div className="stat-value me-sub-stat-value">
                    {r.health?.daysToExpire != null ? `${r.health.daysToExpire} 天` : fmtTime(r.expireAt)}
                  </div>
                </div>
              </div>

              {r.health?.warnings?.length ? <div className="warn-box">{r.health.warnings.join("；")}</div> : null}

              <div className="me-sub-actions">
                {CLIENT_LINKS.slice(0, 4).map((c) => (
                  <button
                    key={c.id}
                    className={"btn sm" + (c.id === "auto" ? "" : " secondary")}
                    onClick={() => copyFormat(r.id, c.format, c.title, c.vendor)}
                  >
                    复制 {c.title}
                  </button>
                ))}
                <button className="btn secondary sm" onClick={() => goNodes(r.id)}>节点列表</button>
                <button className="btn danger sm me-rotate-btn" onClick={() => rotate(r.id)}>作废旧链接并复制</button>
              </div>

              {!tokenMap[r.id] ? (
                <div className="muted">旧订阅若无已存链接，需轮换一次后即可长期复用，无需反复轮换。</div>
              ) : null}
            </div>
          ))}
          {!loading && !error && !rows.length ? (
            <div className="card empty">
              <div className="empty-ico" aria-hidden="true" />
              <h3>暂无订阅</h3>
              <p className="muted">请联系管理员为你创建订阅入口。</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="card stack">
          <div className="me-sub-head me-nodes-head">
            <div>
              <h3 className="me-sub-title">节点列表</h3>
              <div className="muted">
                {activeSub ? `可用节点 ${activeSub.health?.nodeActive ?? "—"} · prefix ${activeSub.tokenPrefix}` : "请先选择订阅"}
              </div>
            </div>
            <div className="me-nodes-head-right">
              {rows.length ? (
                <div className="me-nodes-switch">
                  <label className="muted">订阅</label>
                  <select
                    className="input filter-select"
                    value={activeSubId ?? ""}
                    onChange={(e) => setActiveSubId(Number(e.target.value))}
                    title="切换订阅"
                    aria-label="切换订阅"
                  >
                    {rows.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              {activeSub ? (
                <span className={badgeClass(activeSub.health?.status || (activeSub.enabled ? "ok" : "blocked"))}>
                  {healthLabel(activeSub.health?.status) || (activeSub.enabled ? "启用" : "停用")}
                </span>
              ) : null}
            </div>
          </div>

          {loading || loadingNodes ? (
            <ListLoading />
          ) : nodes.length ? (
            <div className="table-wrap me-nodes-wrap">
              <table className="table me-nodes-table">
                <colgroup>
                  <col className="col-name" />
                  <col className="col-proto" />
                  <col className="col-addr" />
                  <col className="col-status" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="col-name">名称</th>
                    <th className="col-proto">协议</th>
                    <th className="col-addr">地址</th>
                    <th className="col-status">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((n) => (
                    <tr key={n.id}>
                      <td className="col-name emoji-safe" title={n.name || `#${n.id}`}>{n.name || `#${n.id}`}</td>
                      <td className="col-proto mono">{n.protocol || "—"}</td>
                      <td className="col-addr mono" title={n.server ? `${n.server}${n.port != null ? `:${n.port}` : ""}` : "—"}>
                        {n.server ? `${n.server}${n.port != null ? `:${n.port}` : ""}` : "—"}
                      </td>
                      <td className="col-status">
                        <span className={badgeClass(n.enabled && !n.stale ? "ok" : n.stale ? "warn" : "blocked")}>
                          {!n.enabled ? "停用" : n.stale ? "陈旧" : "可用"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="muted">
              {error ? "加载失败，请稍后重试。" : !rows.length ? "暂无订阅。" : "该订阅分组暂无节点。"}
            </div>
          )}
        </div>
      )}

      <Modal
        open={!!qr}
        title={qr ? `二维码 · ${qr.title}` : "二维码"}
        description="可直接扫码导入，也可手动复制链接。"
        onClose={() => setQr(null)}
        footer={
          <>
            {qr?.clash ? <a className="btn secondary" href={qr.clash}>Clash 导入</a> : null}
            {qr?.singbox ? <a className="btn secondary" href={qr.singbox}>sing-box 导入</a> : null}
            <button type="button" className="btn secondary" onClick={() => qr && copyText(qr.url).then(() => setMsg("已再次复制链接"))}>再复制链接</button>
            <button type="button" className="btn" onClick={() => setQr(null)}>关闭</button>
          </>
        }
      >
        {qr ? (
          <div className="me-qr-modal">
            <div className="me-qr-box">
              <img src={qr.qr} alt={`${qr.title} 二维码`} />
            </div>
            <div className="mono me-qr-url">{qr.url}</div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
