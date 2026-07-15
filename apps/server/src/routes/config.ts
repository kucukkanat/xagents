import { Hono } from "hono";
import type { ClientConfig } from "@xagents/core";
import type { AppContext } from "../context";

export const configRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();
  app.get("/", (c) => {
    const body: ClientConfig = {
      models: ctx.registry.models(),
      currentUser: { id: ctx.user.id, handle: ctx.user.handle, displayName: ctx.user.displayName },
      sandboxBackend: ctx.config.sandboxBackend,
      adminAvailable: ctx.config.adminToken !== undefined,
    };
    return c.json(body);
  });
  return app;
};
