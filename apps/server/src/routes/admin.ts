import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  type AdminHost,
  type AdminOverview,
  type AdminRuntimeView,
  VisibilitySchema,
  appError,
  asId,
} from "@xagents/core";
import { warmSandboxImage } from "@xagents/sandbox";
import { requireAdmin } from "../admin/gate";
import { type AppContext, invalidateAgent } from "../context";
import { parseBody, readJson, sendError } from "../http";
import { adminProviderRoutes } from "./admin-providers";
import { cancelTurn } from "./chats";

const DAY_MS = 24 * 60 * 60_000;
const nowIso = (): string => new Date().toISOString();
const startOfUtcDay = (): string => `${nowIso().slice(0, 10)}T00:00:00.000Z`;
const clampInt = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, min), max);
};

const CONTENT_KINDS = new Set(["agent", "knowledgebase", "skill"]);

export const adminRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();
  const admin = ctx.db.admin;

  // Every route below requires the admin token (404 when the console is off).
  app.use("*", requireAdmin(ctx.config.adminToken));

  // Provider/model/secret management (inherits the gate above).
  app.route("/providers", adminProviderRoutes(ctx));

  // --- monitoring (read) -----------------------------------------------------

  app.get("/overview", async (c) => {
    const body: AdminOverview = {
      counts: admin.counts(),
      runtime: await ctx.adminHub.runtime(),
      today: admin.runTotals(startOfUtcDay(), nowIso()),
      models: ctx.registry.models(),
    };
    return c.json(body);
  });

  app.get("/runtime", async (c) => {
    const now = Date.now();
    const hosts: AdminHost[] = ctx.supervisor.list().map((h) => {
      const agent = ctx.db.agents.get(asId("AgentId", h.agentId));
      return {
        agentId: h.agentId,
        agentName: agent.ok ? agent.value.name : null,
        origin: h.origin,
        pid: h.pid,
        uptimeMs: h.uptimeMs,
        idleMs: now - h.lastUsed,
      };
    });
    const body: AdminRuntimeView = {
      hosts,
      starting: ctx.supervisor.startingIds(),
      activeTurns: ctx.turns.activeChatIds(),
      sandbox: await ctx.supervisor.sandboxStats(),
    };
    return c.json(body);
  });

  app.get("/runs", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    const agentId = c.req.query("agentId");
    const cursor = c.req.query("cursor");
    return c.json(
      admin.runMetrics({
        limit: clampInt(c.req.query("limit"), 50, 1, 200),
        ...(from !== undefined ? { fromIso: from } : {}),
        ...(to !== undefined ? { toIso: to } : {}),
        ...(agentId !== undefined ? { agentId } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      }),
    );
  });

  app.get("/metrics/series", (c) => {
    const metric = c.req.query("metric");
    if (metric === undefined) return sendError(c, appError("validation", "metric is required"));
    const to = c.req.query("to") ?? nowIso();
    const from = c.req.query("from") ?? new Date(Date.now() - DAY_MS).toISOString();
    // Minute buckets for spans up to 2 days, hourly beyond, to bound point counts.
    const bucketLen = Date.parse(to) - Date.parse(from) <= 2 * DAY_MS ? 16 : 13;
    return c.json(admin.series(metric, from, to, bucketLen));
  });

  app.get("/events", (c) =>
    c.json(admin.recentEvents(c.req.query("from"), clampInt(c.req.query("limit"), 100, 1, 500))),
  );

  app.get("/content/agents", (c) => c.json(admin.listAgents()));
  app.get("/content/knowledgebases", (c) => c.json(admin.listKnowledgebases()));
  app.get("/content/skills", (c) => c.json(admin.listSkills()));
  app.get("/content/chats", (c) => c.json(admin.listChats()));
  app.get("/users", (c) => c.json(admin.listUsers()));

  // Live feed: gauges (from the sampler) + lifecycle/audit events.
  app.get("/stream", (c) =>
    streamSSE(c, async (stream) => {
      for await (const event of ctx.adminHub.subscribe(c.req.raw.signal)) {
        try {
          await stream.writeSSE({ data: JSON.stringify(event) });
        } catch {
          break; // subscriber went away
        }
      }
    }),
  );

  // --- runtime controls (supervisor emits its own audit events) --------------

  app.post("/hosts/:agentId/stop", (c) => {
    const agentId = c.req.param("agentId");
    const stopped = ctx.supervisor.has(agentId);
    ctx.supervisor.stop(agentId, "admin");
    return c.json({ stopped });
  });

  app.post("/hosts/stop-all", (c) => c.json({ stopped: ctx.supervisor.stopHosts() }));

  app.post("/sandboxes/reap", async (c) => c.json({ reaped: await ctx.supervisor.reapOrphanSandboxes() }));

  app.post("/sandbox/warm", async (c) => {
    if (ctx.config.sandboxBackend !== "microsandbox") {
      return sendError(c, appError("conflict", "warm applies only to the microsandbox backend"));
    }
    const result = await warmSandboxImage();
    ctx.adminHub.recordAction("warm_sandbox", null, { ok: result.ok });
    return result.ok ? c.json({ ok: true }) : sendError(c, result.error);
  });

  app.post("/chats/:id/cancel", (c) => {
    const id = asId("ChatId", c.req.param("id"));
    const cancelled = cancelTurn(ctx, id);
    if (cancelled) ctx.adminHub.recordAction("cancel_turn", id, {});
    return c.json({ cancelled });
  });

  // --- moderation ------------------------------------------------------------

  app.patch("/content/:kind/:id/visibility", async (c) => {
    const kind = c.req.param("kind");
    if (!CONTENT_KINDS.has(kind)) return sendError(c, appError("validation", "unknown content kind"));
    const id = c.req.param("id");
    const body = parseBody(z.object({ visibility: VisibilitySchema }), await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    const changed = admin.setVisibility(kind as "agent" | "knowledgebase" | "skill", id, body.value.visibility);
    if (!changed) return sendError(c, appError("not_found", `${kind} ${id} not found`));
    if (kind === "agent") invalidateAgent(ctx, id);
    ctx.adminHub.recordAction("set_visibility", id, { kind, visibility: body.value.visibility });
    return c.json({ ok: true });
  });

  app.delete("/content/:kind/:id", (c) => {
    const kind = c.req.param("kind");
    const id = c.req.param("id");
    switch (kind) {
      case "agent": {
        const found = ctx.db.agents.get(asId("AgentId", id));
        if (!found.ok) return sendError(c, found.error);
        ctx.db.agents.remove(asId("AgentId", id));
        invalidateAgent(ctx, id);
        break;
      }
      case "knowledgebase": {
        const found = ctx.db.knowledgebases.get(asId("KnowledgebaseId", id));
        if (!found.ok) return sendError(c, found.error);
        ctx.db.knowledgebases.remove(asId("KnowledgebaseId", id));
        break;
      }
      case "skill": {
        const found = ctx.db.skills.get(asId("SkillId", id));
        if (!found.ok) return sendError(c, found.error);
        ctx.db.skills.remove(asId("SkillId", id));
        break;
      }
      case "chat": {
        const chatId = asId("ChatId", id);
        const found = ctx.db.chats.get(chatId);
        if (!found.ok) return sendError(c, found.error);
        cancelTurn(ctx, chatId);
        ctx.db.chats.delete(chatId);
        break;
      }
      default:
        return sendError(c, appError("validation", "unknown content kind"));
    }
    ctx.adminHub.recordAction("delete_content", id, { kind });
    return c.json({ ok: true });
  });

  app.delete("/users/:id", (c) => {
    const id = c.req.param("id");
    if (id === ctx.user.id) {
      return sendError(c, appError("forbidden", "cannot delete the current operator user"));
    }
    if (admin.counts().users <= 1) {
      return sendError(c, appError("conflict", "cannot delete the only user"));
    }
    if (!admin.deleteUser(id)) return sendError(c, appError("not_found", `user ${id} not found`));
    ctx.adminHub.recordAction("delete_user", id, {});
    return c.json({ ok: true });
  });

  return app;
};
