import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { badgeClass, bytesToGbInput, fmtBytes, fmtTime, gbToBytes, healthLabel } from "../lib/format";
import { buildImportLinks, buildSubUrl, CLIENT_LINKS, copyText, loadSubToken, saveSubToken } from "../lib/sub";
import { Flash, Modal } from "../components/ui";

type QrState = {
  title: string;
  url: string;
  qr: string;
  clash?: string;
  singbox?: string;
};

export function SubscriptionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const subId = Number(id);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [expireDays, setExpireDays] = useState("");
  const [deviceLimit, setDeviceLimit] = useState("");
  const [manualUsed, setManualUsed] = useState("");
  const [trafficLimit, setTrafficLimit] = useState("");
  const [qr, setQr] = useState<QrState | null>(null);

  async function load() {
    const res = await api.get<any>(`/api/admin/subscriptions/${subId}`);
    setData(res);
    const s = res.subscription;
    setDeviceLimit(s.deviceLimit == null ? "" : String(s.deviceLimit));
    setManualUsed(bytesToGbInput(s.manualUsedBytes || 0) || "0");
    setTrafficLimit(bytesToGbInput(s.trafficLimitBytes));
    setExpireDays("");
    const cached = loadSubToken(subId);
    if (cached) setToken(cached);
    else {
      api.get<any>(`/api/admin/subscriptions/${subId}/token`).then((res) => {
        if (res?.token) {
          saveSubToken(subId, res.token);
          setToken(res.token);
        }
      }).catch(() => null);
    }
  }

  useEffect(() => {
    if (!subId) return;
    load().catch((e) => setError(e.message));
  }, [subId]);

  const links = useMemo(() => {
    if (!token) return [];
    return CLIENT_LINKS.map((c) => ({
      ...c,
      url: buildSubUrl(token, c.format, c.vendor ? { vendor: c.vendor } : {}),
    }));
  }, [token]);

  async function showCopied(url: string, title: string, successMsg = `已复制：${title}`) {
    const imp = buildImportLinks(url);
    setQr({ title, url, qr: imp.qr, clash: imp.clash, singbox: imp.singbox });
    try {
      await copyText(url);
      setMsg(successMsg);
    } catch {
      setMsg(`${title} 二维码已打开，复制失败可手动复制链接`);
    }
  }

  async function copyCurrent() {
    setError("");
    try {
      let tkn = token || loadSubToken(subId);
      if (!tkn) {
        const res = await api.get<any>(`/api/admin/subscriptions/${subId}/token`);
        tkn = res?.token || null;
        if (tkn) {
          saveSubToken(subId, tkn);
          setToken(tkn);
        }
      }
      if (!tkn) {
        setError("无已存链接（旧数据需轮换一次）");
        return;
      }
      const url = buildSubUrl(tkn, "auto");
      await showCopied(url, "通用自动", "已复制通用订阅链接（未改动 token）");
    } catch (err) {
      setError(err instanceof Error ? err.message : "复制失败");
    }
  }

  async function rotateAndCopy() {
    setError("");
    setMsg("");
    try {
      const res = await api.post<any>(`/api/admin/subscriptions/${subId}/rotate`);
      saveSubToken(subId, res.token);
      setToken(res.token);
      const url = buildSubUrl(res.token, "auto");
      await showCopied(url, "通用自动", "已轮换：旧链接作废，新链接已复制");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "轮换失败");
    }
  }

  async function copyLink(url: string, title: string) {
    setError("");
    await showCopied(url, title);
  }

  async function toggleEnabled() {
    if (!data) return;
    await api.put(`/api/admin/subscriptions/${subId}`, { enabled: !data.subscription.enabled });
    setMsg(data.subscription.enabled ? "已停用订阅" : "已启用订阅");
    await load();
  }

  async function resetDevices() {
    if (!confirm("重置全部拉取设备指纹？用户需重新拉取订阅。")) return;
    const res = await api.del<any>(`/api/admin/subscriptions/${subId}/devices`);
    setMsg(`已重置 ${res.removed || 0} 个拉取设备`);
    await load();
  }

  async function removeDevice(fingerprint: string) {
    if (!confirm("移除该拉取设备？")) return;
    const res = await api.del<any>(`/api/admin/subscriptions/${subId}/devices/${encodeURIComponent(fingerprint)}`);
    setMsg(res.removed ? "已移除该拉取设备" : "设备不存在");
    await load();
  }

  async function saveGovernance(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const patch: any = {
        deviceLimit: deviceLimit === "" ? null : Number(deviceLimit),
      };
      if (expireDays !== "") {
        patch.expireAt = Date.now() + Number(expireDays) * 86400000;
      }
      if (data?.subscription?.usageMode === "manual") {
        patch.manualUsedBytes = gbToBytes(manualUsed) ?? 0;
        patch.trafficLimitBytes = gbToBytes(trafficLimit);
      }
      await api.put(`/api/admin/subscriptions/${subId}`, patch);
      setMsg("治理参数已保存");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }

  if (!data && !error) return <div className="muted">加载订阅详情...</div>;
  if (error && !data) {
    return (
      <>
        <Flash error={error} onDismissError={() => setError("")} />
        <div className="muted">加载失败，请返回列表重试。</div>
      </>
    );
  }

  const s = data.subscription;
  const h = data.health;

  return (
    <>
                        <div className="page-header">
        <div className="page-header-main">
          <div className="crumbs">
            <Link to="/subscriptions">订阅入口</Link>
            <span className="sep">/</span>
            <span>#{s.id}</span>
          </div>
          <h2>{s.name}</h2>
        </div>
        <div className="page-header-subrow">
          <div className="sub">
            {s.username} · 分组 {s.groupName || (s.groups||[]).map((g:any)=>g.name).join(" + ")} · 前缀 <span className="mono">{s.tokenPrefix}</span>
          </div>
          <div className="page-actions">
            <button className="btn secondary" onClick={copyCurrent}>复制链接</button>
            <button className="btn" onClick={rotateAndCopy}>轮换并复制</button>
            <button className="btn secondary" onClick={toggleEnabled}>{s.enabled ? "停用" : "启用"}</button>
            <button className="btn secondary" onClick={resetDevices}>重置拉取设备</button>
            <button className="btn secondary" onClick={() => navigate("/subscriptions")}>返回列表</button>
          </div>
        </div>
      </div>
<Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />

      <div className="detail-stack">
        <div className="card stack">
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>订阅体检</h3>
            <span className={badgeClass(h.status)}>{healthLabel(h.status)}</span>
          </div>
          <div className="stat-grid compact">
            <div className="stat-card mini"><div className="stat-label">可用节点</div><div className="stat-value">{h.nodeActive}<span className="muted" style={{ fontSize: 14 }}>/{h.nodeTotal}</span></div></div>
            <div className="stat-card mini"><div className="stat-label">拉取设备</div><div className="stat-value">{h.devices.used}<span className="muted" style={{ fontSize: 14 }}>/{h.devices.limit ?? "∞"}</span></div></div>
            <div className="stat-card mini"><div className="stat-label">{h.usage.label}</div><div className="stat-value" style={{ fontSize: 18 }}>{h.usage.percent != null ? `${h.usage.percent}%` : "—"}</div></div>
            <div className="stat-card mini"><div className="stat-label">到期</div><div className="stat-value" style={{ fontSize: 16 }}>{h.daysToExpire != null ? `${h.daysToExpire}d` : "不限"}</div></div>
          </div>
          <div className="muted">窗口 {h.devices.windowDays} 天内访问过订阅 URL 的客户端指纹，不是代理在线设备。</div>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>各格式可转换</div>
            <div className="chip-row">
              {Object.entries(h.byFormat || {}).map(([fmt, info]: any) => (
                <span className="chip" key={fmt}>{fmt}: {info.renderable}{info.skipped?.length ? ` / skip ${info.skipped.length}` : ""}</span>
              ))}
              {h.skipByProtocol && Object.keys(h.skipByProtocol).length ? Object.entries(h.skipByProtocol).map(([proto, count]: any) => (
                <span className="chip" key={"p-"+proto}>skip {proto}: {count}</span>
              )) : null}
            </div>
          </div>
          {h.warnings?.length ? (
            <div className="warn-box">
              {h.warnings.map((w: string) => <div key={w}>• {w}</div>)}
            </div>
          ) : null}
          {h.usage.mode !== "none" ? (
            <div className="muted">用量 {fmtBytes(h.usage.usedBytes)} / {fmtBytes(h.usage.limitBytes)}</div>
          ) : null}
          <div className="muted">到期时间 {fmtTime(h.expireAt)}</div>
        </div>

        <div className="card stack">
          <h3 style={{ margin: 0 }}>客户端链接</h3>
          {!token ? (
            <div className="warn-box">
              当前浏览器没有明文 token（安全起见数据库不保存）。请点右上角「轮换并复制」，或在创建订阅时复制一次。
            </div>
          ) : (
            <div className="link-list">
              {token ? (() => {
                const autoUrl = buildSubUrl(token, "auto");
                const imp = buildImportLinks(autoUrl);
                return (
                  <div className="link-row" style={{ alignItems: "center" }}>
                    <div>
                      <strong>一键导入</strong>
                      <div className="muted" style={{ marginTop: 4, fontSize: "0.86rem" }}>基于 auto 链接</div>
                      <div className="toolbar" style={{ marginTop: 8 }}>
                        <a className="btn secondary sm" href={imp.clash}>Clash 导入</a>
                        <a className="btn secondary sm" href={imp.singbox}>sing-box 导入</a>
                      </div>
                    </div>
                  </div>
                );
              })() : null}
              {links.map((l) => (
                <div className="link-row" key={l.id}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{l.title}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{l.hint}</div>
                    <div className="mono link-url">{l.url}</div>
                  </div>
                  <button className="btn secondary" onClick={() => copyLink(l.url, l.title)}>复制</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="detail-stack" style={{ marginTop: 16 }}>
        <form className="card stack" onSubmit={saveGovernance}>
          <h3 style={{ margin: 0 }}>治理</h3>
          <div className="field"><label>拉取拉取设备上限（空=不限）</label><input className="input" value={deviceLimit} onChange={(e) => setDeviceLimit(e.target.value)} /></div>
          <div className="field"><label>延长有效天数（从现在起，可选）</label><input className="input" value={expireDays} onChange={(e) => setExpireDays(e.target.value)} placeholder="例如 30" /></div>
          {s.usageMode === "manual" ? (
            <>
              <div className="field"><label>手工已用（GB）</label><input className="input" value={manualUsed} onChange={(e) => setManualUsed(e.target.value)} placeholder="0" inputMode="decimal" /></div>
              <div className="field"><label>流量上限（GB，空=不限）</label><input className="input" value={trafficLimit} onChange={(e) => setTrafficLimit(e.target.value)} placeholder="例如 100" inputMode="decimal" /></div>
            </>
          ) : (
            <div className="muted">流量模式：{s.usageMode}{s.usageMode === "upstream_exclusive" ? "（上游账号总流量）" : ""}</div>
          )}
          <button className="btn">保存治理参数</button>
        </form>

        <div className="card stack">
          <h3 style={{ margin: 0 }}>拉取设备</h3>
          <table>
            <thead><tr><th>指纹</th><th>客户端</th><th>首次</th><th>最近</th><th></th></tr></thead>
            <tbody>
              {(data.devices || []).map((d: any) => (
                <tr key={d.fingerprint}>
                  <td className="mono">{String(d.fingerprint).slice(0, 12)}</td>
                  <td>{d.client_family}</td>
                  <td>{fmtTime(d.first_seen_at)}</td>
                  <td>{fmtTime(d.last_seen_at)}</td>
                  <td><button type="button" className="btn secondary" onClick={() => removeDevice(d.fingerprint)}>移除</button></td>
                </tr>
              ))}
              {!data.devices?.length ? <tr><td colSpan={5} className="muted">暂无拉取设备</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card table-wrap" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>最近访问</h3>
        <table>
          <thead><tr><th>时间</th><th>客户端</th><th>格式</th><th>状态</th><th>字节</th></tr></thead>
          <tbody>
            {(data.recentAccess || []).map((r: any) => (
              <tr key={r.id}>
                <td>{fmtTime(r.created_at)}</td>
                <td>{r.client_family}</td>
                <td>{r.format}</td>
                <td>{r.status}</td>
                <td>{fmtBytes(r.response_bytes)}</td>
              </tr>
            ))}
            {!data.recentAccess?.length ? <tr><td colSpan={5} className="muted">暂无访问</td></tr> : null}
          </tbody>
        </table>
      </div>

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
