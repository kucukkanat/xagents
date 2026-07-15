import { existsSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import type { AppContext } from "./context";
import { adminRoutes } from "./routes/admin";
import { agentRoutes } from "./routes/agents";
import { chatRoutes } from "./routes/chats";
import { configRoutes } from "./routes/config";
import { galleryRoutes } from "./routes/gallery";
import { internalRoutes } from "./routes/internal";
import { knowledgebaseRoutes } from "./routes/knowledgebases";
import { skillRoutes } from "./routes/skills";

export const createApp = (ctx: AppContext): Hono => {
  const app = new Hono();

  // Dev convenience: the Vite dev server proxies /api, but allow direct calls too.
  app.use("/api/*", cors());

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/config", configRoutes(ctx));
  app.route("/api/agents", agentRoutes(ctx));
  app.route("/api/knowledgebases", knowledgebaseRoutes(ctx));
  app.route("/api/skills", skillRoutes(ctx));
  app.route("/api/gallery", galleryRoutes(ctx));
  app.route("/api/chats", chatRoutes(ctx));
  app.route("/api/admin", adminRoutes(ctx));

  // Loopback-only callback surface for materialized agents (kb_search).
  app.route("/internal", internalRoutes(ctx));

  // Serve the built SPA in production (dev uses the Vite server instead).
  if (existsSync(ctx.config.webDistDir)) {
    app.use("/*", serveStatic({ root: "./apps/web/dist" }));
    app.get("*", serveStatic({ path: "./apps/web/dist/index.html" }));
  }

  return app;
};
