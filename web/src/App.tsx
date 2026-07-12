import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./lib/api";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { DashboardPage } from "./pages/DashboardPage";
import { UsersPage } from "./pages/UsersPage";
import { SourcesPage } from "./pages/SourcesPage";
import { NodesPage } from "./pages/NodesPage";
import { GroupsPage } from "./pages/GroupsPage";
import { SubscriptionsPage } from "./pages/SubscriptionsPage";
import { SubscriptionDetailPage } from "./pages/SubscriptionDetailPage";
import { LogsPage } from "./pages/LogsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { MePage } from "./pages/MePage";
import { PasswordPage } from "./pages/PasswordPage";

function isStaff(role?: string) {
  return role === "admin";
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dbReady, setDbReady] = useState<boolean | null>(null);

  async function checkDb() {
    try {
      const res = await api.get<any>("/api/setup/status");
      setDbReady(!!res?.ready);
      return !!res?.ready;
    } catch {
      setDbReady(false);
      return false;
    }
  }

  async function refresh() {
    try {
      const res = await api.get<any>("/api/auth/me");
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [status, me] = await Promise.all([
          api.get<any>("/api/setup/status"),
          api.get<any>("/api/auth/me").catch(() => null),
        ]);
        if (cancelled) return;
        setDbReady(!!status?.ready);
        setUser(me?.user ?? null);
      } catch {
        if (!cancelled) {
          setDbReady(false);
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await api.post("/api/auth/logout");
    setUser(null);
  }

  if (dbReady === null || loading) return <div className="auth-page muted">加载中...</div>;
  if (!dbReady) return <SetupPage onReady={async () => { setDbReady(true); setLoading(true); await refresh(); }} />;
  if (!user) return <LoginPage onDone={refresh} />;

  return (
    <Routes>
      <Route element={<Layout user={user} onLogout={logout} />}>
        <Route path="/" element={isStaff(user.role) ? <DashboardPage /> : <Navigate to="/me" replace />} />
        <Route path="/users" element={user.role === "admin" ? <UsersPage /> : <Navigate to="/me" replace />} />
        <Route path="/sources" element={isStaff(user.role) ? <SourcesPage /> : <Navigate to="/me" replace />} />
        <Route path="/nodes" element={isStaff(user.role) ? <NodesPage /> : <Navigate to="/me" replace />} />
        <Route path="/groups" element={isStaff(user.role) ? <GroupsPage /> : <Navigate to="/me" replace />} />
        <Route path="/subscriptions" element={isStaff(user.role) ? <SubscriptionsPage /> : <Navigate to="/me" replace />} />
        <Route path="/subscriptions/:id" element={isStaff(user.role) ? <SubscriptionDetailPage /> : <Navigate to="/me" replace />} />
        <Route path="/logs" element={isStaff(user.role) ? <LogsPage /> : <Navigate to="/me" replace />} />
        <Route path="/settings" element={user.role === "admin" ? <SettingsPage /> : <Navigate to="/me" replace />} />
        <Route path="/me" element={<MePage />} />
        <Route path="/password" element={<PasswordPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
