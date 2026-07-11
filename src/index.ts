import { Hono } from "hono";
import type { Env } from "./env.ts";
import { authRoutes } from "./routes/auth.ts";
import { healthRoutes } from "./routes/health.ts";
import { adminRoutes } from "./routes/admin.ts";
import { subRoutes } from "./routes/sub.ts";
import { userRoutes } from "./routes/user.ts";
import { handleScheduled } from "./jobs/cron.ts";
import { getRequestId } from "./util/request.ts";
import { jsonError } from "./util/json.ts";

type AppEnv = { Bindings: Env };
const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  const requestId = getRequestId(c.req.raw);
  c.header("x-request-id", requestId);
  const started = Date.now();
  await next();
  console.log(JSON.stringify({
    request_id: requestId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    duration_ms: Date.now() - started,
  }));
});

app.route("/health", healthRoutes);
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
