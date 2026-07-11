import { FormEvent, useEffect, useState } from "react";
import { Flash } from "../components/ui";
import { api } from "../lib/api";
import { applyTheme, cycleTheme, getStoredTheme, resolveTheme, type ThemeMode } from "../lib/theme";
import { BrandMark } from "../components/BrandMark";

type Mode = "login" | "bootstrap" | "forgot" | "reset";

export function LoginPage({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());
  const themeResolved = resolveTheme(themeMode);

  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("reset_token");
    if (t) {
      setResetToken(t);
      setMode("reset");
    }
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMsg("");
    try {
      if (mode === "bootstrap") {
        await api.post("/api/auth/bootstrap-admin", { username, password });
        await api.post("/api/auth/login", { username, password });
        onDone();
        return;
      }
      if (mode === "forgot") {
        await api.post("/api/auth/forgot-password", { email });
        setMsg("若邮箱存在，已发送重置链接（请检查收件箱）。");
        return;
      }
      if (mode === "reset") {
        await api.post("/api/auth/reset-password", { token: resetToken, newPassword: password });
        setMsg("密码已重置，请登录。");
        setMode("login");
        setPassword("");
        // drop token from URL
        window.history.replaceState({}, "", "/");
        return;
      }
      await api.post("/api/auth/login", { username, password });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  const title =
    mode === "login"
      ? "登录后台"
      : mode === "bootstrap"
        ? "初始化管理员"
        : mode === "forgot"
          ? "找回密码"
          : "重置密码";
  const sub =
    mode === "login"
      ? "使用管理员或子账号登录。首次部署请先创建管理员。"
      : mode === "bootstrap"
        ? "创建首个管理员账号后自动登录。"
        : mode === "forgot"
          ? "输入账号邮箱，若存在将发送重置链接（需已配置 SMTP）。"
          : "设置新密码（至少 10 位）。";

  return (
    <div className="auth-page">
      <div className="auth-theme">
        <a
          className="theme-toggle github-btn"
          href="https://github.com/kadidalax/SubPanel"
          target="_blank"
          rel="noreferrer"
          title="GitHub: kadidalax/SubPanel"
          aria-label="打开 GitHub 仓库"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
          </svg>
        </a>
        <button
          type="button"
          className="theme-toggle"
          title={`主题：${themeMode === "system" ? "系统" : themeMode === "dark" ? "暗色" : "亮色"}`}
          aria-label="切换主题"
          onClick={() => setThemeMode(cycleTheme(themeMode))}
        >
          {themeMode === "system" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8M12 18v3" /></svg>
          ) : themeResolved === "dark" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5Z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
          )}
        </button>
      </div>
      <Flash error={error} msg={msg} onDismissError={() => setError("")} onDismissMsg={() => setMsg("")} />
      <form className="card auth-card stack" onSubmit={submit}>
        <div className="auth-brand">
          <BrandMark />
          <div>
            <div style={{ fontWeight: 700 }}>Sub Panel</div>
            <div className="muted" style={{ fontSize: "0.82rem" }}>小范围订阅聚合分发</div>
          </div>
        </div>
        <div>
          <h1>{title}</h1>
          <p>{sub}</p>
        </div>
        {mode === "login" || mode === "bootstrap" ? (
          <>
            <div className="field">
              <label>用户名</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>
            <div className="field">
              <label>密码</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "bootstrap" ? "new-password" : "current-password"} />
            </div>
          </>
        ) : null}
        {mode === "forgot" ? (
          <div className="field">
            <label>邮箱</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
        ) : null}
        {mode === "reset" ? (
          <div className="field">
            <label>新密码</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
        ) : null}
        <button className="btn" disabled={loading}>
          {loading
            ? "处理中..."
            : mode === "login"
              ? "登录"
              : mode === "bootstrap"
                ? "创建并登录"
                : mode === "forgot"
                  ? "发送重置邮件"
                  : "重置密码"}
        </button>
        <div className="auth-links">
          {mode === "login" ? (
            <>
              <button type="button" className="btn secondary" onClick={() => { setMode("bootstrap"); setError(""); setMsg(""); }}>首次初始化管理员</button>
              <button type="button" className="btn secondary" onClick={() => { setMode("forgot"); setError(""); setMsg(""); }}>忘记密码</button>
            </>
          ) : (
            <button type="button" className="btn secondary" onClick={() => { setMode("login"); setError(""); setMsg(""); }}>返回登录</button>
          )}
        </div>
      </form>
      <footer className="app-footer auth-footer">
        <span>Powered by SubPanel</span>
        <a href="https://github.com/kadidalax/SubPanel" target="_blank" rel="noreferrer" className="app-footer-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
          </svg>
          <span>GitHub</span>
        </a>
      </footer>
    </div>
  );
}
