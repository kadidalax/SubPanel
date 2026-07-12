type Entry = { exp: number; data: unknown };
const store = new Map<string, Entry>();
const DEFAULT_TTL_MS = 20_000;

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.exp) {
    store.delete(key);
    return undefined;
  }
  return e.data as T;
}

export function cacheSet(key: string, data: unknown, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, { exp: Date.now() + ttlMs, data });
}

export function cacheInvalidate(prefix = ""): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
