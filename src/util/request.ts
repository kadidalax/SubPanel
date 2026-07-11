export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

export function getRequestId(request: Request): string {
  return request.headers.get("cf-ray") || crypto.randomUUID();
}

export function sameOrigin(request: Request, url: URL): boolean {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return true;
  }
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    return o.protocol === url.protocol && o.host === url.host;
  } catch {
    return false;
  }
}
