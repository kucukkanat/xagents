import { Hono } from "hono";
import { CreateAgentInput, UpdateAgentInput, appError, asId } from "@xagents/core";
import {
  type AppContext,
  exportAgent,
  importAgentArchive,
  invalidateAgent,
  materializeFromDb,
} from "../context";
import { parseBody, readJson, sendError } from "../http";

export const agentRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();

  app.get("/", (c) => c.json(ctx.db.agents.list(ctx.user.id)));

  // Import an agent from an xagents export or a plain eve-project zip. Returns a
  // full ImportReport (log trail + summary) even on validation failure. Pass
  // `?dryRun=true` to validate and preview without writing anything.
  app.post("/import", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return sendError(c, appError("validation", "expected a `file` upload (the exported .zip)"));
    }
    const dryRun = c.req.query("dryRun") === "true";
    const report = await importAgentArchive(ctx, Buffer.from(await file.arrayBuffer()), { dryRun });
    return c.json(report, report.ok ? (report.committed ? 201 : 200) : 422);
  });

  app.post("/", async (c) => {
    const body = parseBody(CreateAgentInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    // The model must be an enabled model of an enabled, keyed provider.
    const usable = ctx.registry.usability(body.value.modelProvider, body.value.modelId);
    if (!usable.ok) return sendError(c, usable.error);
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
    // If the edit touches the model, validate the effective (provider, model).
    if (body.value.modelProvider !== undefined || body.value.modelId !== undefined) {
      const current = ctx.db.agents.get(id);
      if (!current.ok) return sendError(c, current.error);
      const provider = body.value.modelProvider ?? current.value.modelProvider;
      const modelId = body.value.modelId ?? current.value.modelId;
      const usable = ctx.registry.usability(provider, modelId);
      if (!usable.ok) return sendError(c, usable.error);
    }
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

  // Download the agent's materialized eve project as a zip archive.
  app.get("/:id/export", async (c) => {
    const res = await exportAgent(ctx, c.req.param("id"));
    if (!res.ok) return sendError(c, res.error);
    return new Response(res.value.data, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${res.value.filename}"`,
      },
    });
  });

  // Rebuild the on-disk eve project without chatting (useful for debugging).
  app.post("/:id/materialize", async (c) => {
    const res = await materializeFromDb(ctx, c.req.param("id"));
    return res.ok ? c.json({ ok: true }) : sendError(c, res.error);
  });

  return app;
};
