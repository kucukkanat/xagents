import { Hono } from "hono";
import { z } from "zod";
import { asId } from "@xagents/core";
import type { AppContext } from "../context";
import { parseBody, readJson, sendError } from "../http";

const SearchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).default(5),
});

const TurnModelInput = z.object({ sessionId: z.string().min(1) });

/**
 * Called by the `kb_search` tool inside a materialized eve agent (a separate
 * process) so the DB stays owned by the server. Resolves the agent's attached
 * knowledgebases and runs BM25 retrieval.
 */
export const internalRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();
  app.post("/agents/:id/kb-search", async (c) => {
    const detail = ctx.db.agents.getDetail(asId("AgentId", c.req.param("id")));
    if (!detail.ok) return sendError(c, detail.error);
    const body = parseBody(SearchInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    const hits = ctx.db.knowledgebases.searchChunks(
      detail.value.agent.knowledgebaseIds,
      body.value.query,
      body.value.limit,
    );
    return c.json({ hits });
  });

  /**
   * Called by the agent's dynamic-model resolver on every step to learn this
   * chat's active model (its hot-swap override, or the agent's default). Keyed
   * by the eve session id, which is mapped to a chat after that chat's first
   * turn — so the first turn (no mapping yet) simply resolves to the default.
   */
  app.post("/agents/:id/turn-model", async (c) => {
    const agent = ctx.db.agents.get(asId("AgentId", c.req.param("id")));
    if (!agent.ok) return sendError(c, agent.error);
    const body = parseBody(TurnModelInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    const chat = ctx.db.chats.getBySessionId(body.value.sessionId);
    // Only honor an override from a chat that actually belongs to this agent.
    const override =
      chat !== undefined && chat.agentId === agent.value.id ? chat.overrideModelId : null;
    return c.json({ modelId: override ?? agent.value.modelId });
  });
  return app;
};
