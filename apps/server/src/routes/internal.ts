import { Hono } from "hono";
import { z } from "zod";
import { asId } from "@xagents/core";
import type { AppContext } from "../context";
import { parseBody, readJson, sendError } from "../http";

const SearchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).default(5),
});

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
  return app;
};
