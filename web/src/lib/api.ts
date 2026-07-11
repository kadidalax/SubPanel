export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = data?.error?.message || data?.message || res.statusText || "request failed";
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  get: <T = any>(path: string) => apiFetch<T>(path),
  post: <T = any>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body: body == null ? undefined : JSON.stringify(body) }),
  put: <T = any>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PUT", body: body == null ? undefined : JSON.stringify(body) }),
  del: <T = any>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
