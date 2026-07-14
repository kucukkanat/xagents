import { Hono } from "hono";
import { type ClientConfig, MODEL_CATALOG } from "@xagents/core";
import type { AppContext } from "../context";

export const configRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();
  app.get("/", (c) => {
    const body: ClientConfig = {
      models: MODEL_CATALOG,
      currentUser: { id: ctx.user.id, handle: ctx.user.handle, displayName: ctx.user.displayName },
      sandboxBackend: ctx.config.sandboxBackend,
    };
    return c.json(body);
  });
  return app;
};
