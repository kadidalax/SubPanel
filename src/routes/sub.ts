import { Hono } from "hono";
import type { Env } from "../env.ts";
import { serveSubscription } from "../services/subscriptions.ts";

type AppEnv = { Bindings: Env };
export const subRoutes = new Hono<AppEnv>();

subRoutes.get("/:token", async (c) => {
  return serveSubscription(c.env, c.req.raw, c.req.param("token"));
});
