import { Hono } from "hono";
import {
  CreateAgentInput,
  UpdateAgentInput,
  appError,
  asId,
  findModel,
} from "@xagents/core";
import { type AppContext, invalidateAgent, materializeFromDb } from "../context";
import { parseBody, readJson, sendError } from "../http";

export const agentRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();

  app.get("/", (c) => c.json(ctx.db.agents.list(ctx.user.id)));

  app.post("/", async (c) => {
    const body = parseBody(CreateAgentInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    if (findModel(body.value.modelProvider, body.value.modelId) === undefined) {
      return sendError(c, appError("validation", `unknown model ${body.value.modelProvider}/${body.value.modelId}`));
    }
    const agent = ctx.db.agents.create(ctx.user.id, body.value);
    ctx.db.agents.setLinks(asId("AgentId", agent.id), {
      knowledgebaseIds: body.value.knowledgebaseIds,
      skillIds: body.value.skillIds,
    });
    const detail = ctx.db.agents.getDetail(asId("AgentId", agent.id));
    return detail.ok ? c.json(detail.value.agent, 201) : sendError(c, detail.error);
  });

  app.get("/:id", (c) => {
    const detail = ctx.db.agents.getDetail(asId("AgentId", c.req.param("id")));
    return detail.ok ? c.json(detail.value) : sendError(c, detail.error);
  });

  app.patch("/:id", async (c) => {
    const id = asId("AgentId", c.req.param("id"));
    const body = parseBody(UpdateAgentInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    const updated = ctx.db.agents.update(id, body.value);
    if (!updated.ok) return sendError(c, updated.error);
    if (body.value.knowledgebaseIds !== undefined || body.value.skillIds !== undefined) {
      ctx.db.agents.setLinks(id, {
        knowledgebaseIds: body.value.knowledgebaseIds ?? updated.value.knowledgebaseIds,
        skillIds: body.value.skillIds ?? updated.value.skillIds,
      });
    }
    invalidateAgent(ctx, id); // force re-materialize on next chat
    const detail = ctx.db.agents.getDetail(id);
    return detail.ok ? c.json(detail.value.agent) : sendError(c, detail.error);
  });

  app.delete("/:id", (c) => {
    const id = asId("AgentId", c.req.param("id"));
    invalidateAgent(ctx, id);
    ctx.db.agents.remove(id);
    return c.body(null, 204);
  });

  app.post("/:id/clone", (c) => {
    const source = ctx.db.agents.get(asId("AgentId", c.req.param("id")));
    if (!source.ok) return sendError(c, source.error);
    if (source.value.visibility !== "public" && source.value.ownerId !== ctx.user.id) {
      return sendError(c, appError("forbidden", "cannot clone a private agent you do not own"));
    }
    const cloned = ctx.db.agents.clone(asId("AgentId", c.req.param("id")), ctx.user.id);
    return cloned.ok ? c.json(cloned.value, 201) : sendError(c, cloned.error);
  });

  // Rebuild the on-disk eve project without chatting (useful for debugging).
  app.post("/:id/materialize", async (c) => {
    const res = await materializeFromDb(ctx, c.req.param("id"));
    return res.ok ? c.json({ ok: true }) : sendError(c, res.error);
  });

  return app;
};
