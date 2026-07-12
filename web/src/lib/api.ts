import { cacheGet, cacheSet, cacheInvalidate } from "./cache";

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const skipCache =
    method !== "GET" ||
    path.startsWith("/api/auth/") ||
    path === "/api/setup/status" ||
    path.includes("/token");

  if (!skipCache) {
    const hit = cacheGet<T>(path);
    if (hit !== undefined) return hit;
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message = data?.error?.message || data?.message || res.statusText || "request failed";
    throw new Error(message);
  }

  if (!skipCache) cacheSet(path, data);
  if (method !== "GET") {
    cacheInvalidate("/api/admin/");
    cacheInvalidate("/api/user/");
  }
  return data as T;
}

export const api = {
  get: <T = any>(path: string) => apiFetch<T>(path),
  post: <T = any>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body == null ? undefined : JSON.stringify(body) }),
  put: <T = any>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: body == null ? undefined : JSON.stringify(body) }),
  del: <T = any>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
  invalidate: (prefix?: string) => cacheInvalidate(prefix),
};
