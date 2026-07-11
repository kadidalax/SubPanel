import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { applyTheme, cycleTheme, getStoredTheme, resolveTheme, type ThemeMode } from "../lib/theme";
import { BrandMark } from "./BrandMark";

type NavItem = { to: string; label: string; end?: boolean; icon: string };
type NavGroup = { title: string; items: NavItem[] };

const icons: Record<string, any> = {
  dash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  sub: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16M4 12h10M4 17h7" />
      <circle cx="18" cy="17" r="3" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15 19a4.5 4.5 0 0 1 5.5-4.3" />
    </svg>
  ),
  source: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 19h14" />
    </svg>
  ),
  nodes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <circle cx="12" cy="17" r="2.5" />
      <path d="M8 8.5 10.5 15M16 8.5 13.5 15" />
    </svg>
  ),
  groups: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="8" height="7" rx="1.5" />
      <rect x="13" y="4" width="8" height="7" rx="1.5" />
      <rect x="8" y="13" width="8" height="7" rx="1.5" />
    </svg>
  ),
  logs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 4h10a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2Z" />
      <path d="M9 9h6M9 13h6" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  ),
  me: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19a7 7 0 0 1 14 0" />
    </svg>
  ),
  password: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="16" r="1.2" />
    </svg>
  ),
};

const adminGroups: NavGroup[] = [
  {
    title: "运营",
    items: [
      { to: "/", label: "总览", end: true, icon: "dash" },
      { to: "/subscriptions", label: "订阅入口", icon: "sub" },
      { to: "/users", label: "用户", icon: "users" },
    ],
  },
  {
    title: "资源",
    items: [
      { to: "/sources", label: "数据源", icon: "source" },
      { to: "/nodes", label: "节点池", icon: "nodes" },
      { to: "/groups", label: "分组", icon: "groups" },
    ],
  },
  {
    title: "系统",
    items: [
      { to: "/logs", label: "日志", icon: "logs" },
      { to: "/settings", label: "设置", icon: "settings" },
      { to: "/me", label: "我的订阅", icon: "me" },
      { to: "/password", label: "修改密码", icon: "password" },
    ],
  },
];

const userGroups: NavGroup[] = [
  {
    title: "账户",
    items: [
      { to: "/me", label: "我的订阅", icon: "me" },
      { to: "/password", label: "修改密码", icon: "password" },
    ],
  },
];


const GITHUB_URL = "https://github.com/kadidalax/SubPanel";

function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
    </svg>
  );
}

function GitHubButton() {
  return (
    <a
      className="theme-toggle github-btn"
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer"
      title="GitHub: kadidalax/SubPanel"
      aria-label="打开 GitHub 仓库"
    >
      <GitHubIcon />
    </a>
  );
}

function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => getStoredTheme());
  const [, setTick] = useState(0);
  const resolved = resolveTheme(mode);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getStoredTheme() === "system") {
        applyTheme("system");
        setTick((n) => n + 1);
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function onClick() {
    setMode(cycleTheme(mode));
  }

  const label = mode === "system" ? "系统" : mode === "dark" ? "暗色" : "亮色";
  const icon =
    mode === "system" ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M8 21h8M12 18v3" />
      </svg>
    ) : resolved === "dark" ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5Z" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );

  return (
    <button type="button" className="theme-toggle" onClick={onClick} title={`主题：${label}`} aria-label={`切换主题，当前${label}`}>
      {icon}
    </button>
  );
}

function initials(name = "") {
  return (name || "?").slice(0, 2).toUpperCase();
}

export function Layout({ user, onLogout }: { user: any; onLogout: () => void }) {
  const groups = user?.role === "admin" ? adminGroups : userGroups;
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <div className={`backdrop${open ? " show" : ""}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Sub Panel</h1>
            <p>聚合 · 分发 · 管控</p>
          </div>
        </div>
        <div className="sidebar-scroll">
          <nav className="nav" aria-label="主导航">
            {groups.map((group) => (
              <div className="nav-group" key={group.title}>
                <div className="nav-group-title">{group.title}</div>
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end}>
                    <span className="nav-ico">{icons[item.icon]}</span>
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </div>
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="user-avatar">{initials(user?.username)}</div>
            <div className="user-meta">
              <strong>{user?.username || "user"}</strong>
              <span>{user?.role || "user"}</span>
            </div>
          </div>
          <button className="btn secondary block" onClick={onLogout}>退出登录</button>
        </div>
      </aside>
      <div className="theme-toggle-corner">
        <GitHubButton />
        <ThemeToggle />
      </div>
      <main className="main">
        <div className="mobile-bar">
          <button className="icon-btn" aria-label="打开菜单" onClick={() => setOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <div className="muted" style={{ fontWeight: 600 }}>Sub Panel</div>
          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: "0.72rem" }}>{initials(user?.username)}</div>
        </div>
        <div className="page">
          <Outlet />
        </div>
        <footer className="app-footer">
          <span>Powered by SubPanel</span>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="app-footer-link">
            <GitHubIcon size={14} />
            <span>GitHub</span>
          </a>
        </footer>
      </main>
    </div>
  );
}
