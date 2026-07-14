import { Hono } from "hono";
import { CreateSkillInput, appError, asId } from "@xagents/core";
import { validateSkill } from "@xagents/skills";
import type { AppContext } from "../context";
import { parseBody, readJson, sendError } from "../http";

const UpdateSkillInput = CreateSkillInput.partial();

export const skillRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();

  app.get("/", (c) => c.json(ctx.db.skills.list(ctx.user.id)));

  app.post("/", async (c) => {
    const body = parseBody(CreateSkillInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    // Reject malformed SKILL.md up front so agents never materialize a broken skill.
    const valid = validateSkill(body.value);
    if (!valid.ok) return sendError(c, valid.error);
    return c.json(ctx.db.skills.create(ctx.user.id, body.value), 201);
  });

  app.get("/:id", (c) => {
    const skill = ctx.db.skills.get(asId("SkillId", c.req.param("id")));
    return skill.ok ? c.json(skill.value) : sendError(c, skill.error);
  });

  app.patch("/:id", async (c) => {
    const body = parseBody(UpdateSkillInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    if (body.value.skillMd !== undefined) {
      const valid = validateSkill({
        name: body.value.name ?? "placeholder",
        description: body.value.description ?? "",
        skillMd: body.value.skillMd,
        visibility: body.value.visibility ?? "private",
      });
      if (!valid.ok) return sendError(c, valid.error);
    }
    // zod's `.partial()` widens optionals to `T | undefined`; the repo uses
    // exact-optional `Partial<CreateSkillInput>` — identical runtime shape, so a
    // boundary cast reconciles the two annotations.
    const updated = ctx.db.skills.update(
      asId("SkillId", c.req.param("id")),
      body.value as Partial<CreateSkillInput>,
    );
    return updated.ok ? c.json(updated.value) : sendError(c, updated.error);
  });

  app.delete("/:id", (c) => {
    ctx.db.skills.remove(asId("SkillId", c.req.param("id")));
    return c.body(null, 204);
  });

  app.post("/:id/clone", (c) => {
    const source = ctx.db.skills.get(asId("SkillId", c.req.param("id")));
    if (!source.ok) return sendError(c, source.error);
    if (source.value.visibility !== "public" && source.value.ownerId !== ctx.user.id) {
      return sendError(c, appError("forbidden", "cannot clone a private skill you do not own"));
    }
    const cloned = ctx.db.skills.clone(asId("SkillId", c.req.param("id")), ctx.user.id);
    return cloned.ok ? c.json(cloned.value, 201) : sendError(c, cloned.error);
  });

  return app;
};
