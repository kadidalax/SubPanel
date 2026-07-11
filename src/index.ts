import { Hono } from "hono";
import type { Env } from "./env.ts";
import { authRoutes } from "./routes/auth.ts";
import { healthRoutes } from "./routes/health.ts";
import { setupRoutes } from "./routes/setup.ts";
import { adminRoutes } from "./routes/admin.ts";
import { subRoutes } from "./routes/sub.ts";
import { userRoutes } from "./routes/user.ts";
import { handleScheduled } from "./jobs/cron.ts";
import { getRequestId } from "./util/request.ts";
import { jsonError } from "./util/json.ts";

type AppEnv = { Bindings: Env };
const app = new Hono<AppEnv>();

function redactPath(pathname: string): string {
  if (pathname.startsWith("/sub/")) {
    const rest = pathname.slice(5);
    const token = rest.split("/")[0] || "";
    if (!token) return "/sub/";
    const prefix = token.slice(0, 8);
    return "/sub/" + prefix + "/[redacted]";
  }
  return pathname;
}

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy":
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:",
};

app.use("*", async (c, next) => {
  const requestId = getRequestId(c.req.raw);
  c.header("x-request-id", requestId);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
  const started = Date.now();
  await next();
  // re-apply after handler Response creation (Hono may replace headers)
  c.header("x-request-id", requestId);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
  const path = redactPath(new URL(c.req.url).pathname);
  console.log(
    JSON.stringify({
      request_id: requestId,
      method: c.req.method,
      path,
      status: c.res.status,
      duration_ms: Date.now() - started,
    }),
  );
});

app.route("/health", healthRoutes);
app.route("/api/setup", setupRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/user", userRoutes);
app.route("/sub", subRoutes);

app.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/sub/") || path.startsWith("/health/")) {
    return jsonError(404, "not_found", "not found");
  }
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text("Sub Panel API", 200);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(event, env));
  },
};
