import { Hono } from "hono";
import {
  CreateKnowledgebaseInput,
  type KnowledgebaseDetail,
  appError,
  asId,
} from "@xagents/core";
import { ingestDocument } from "@xagents/kb";
import type { AppContext } from "../context";
import { parseBody, readJson, sendError } from "../http";

export const knowledgebaseRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();

  app.get("/", (c) => c.json(ctx.db.knowledgebases.list(ctx.user.id)));

  app.post("/", async (c) => {
    const body = parseBody(CreateKnowledgebaseInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    return c.json(ctx.db.knowledgebases.create(ctx.user.id, body.value), 201);
  });

  app.get("/:id", (c) => {
    const id = asId("KnowledgebaseId", c.req.param("id"));
    const kb = ctx.db.knowledgebases.get(id);
    if (!kb.ok) return sendError(c, kb.error);
    const body: KnowledgebaseDetail = {
      knowledgebase: kb.value,
      documents: ctx.db.knowledgebases.listDocuments(id),
    };
    return c.json(body);
  });

  app.delete("/:id", (c) => {
    ctx.db.knowledgebases.remove(asId("KnowledgebaseId", c.req.param("id")));
    return c.body(null, 204);
  });

  app.post("/:id/documents", async (c) => {
    const kbId = asId("KnowledgebaseId", c.req.param("id"));
    const kb = ctx.db.knowledgebases.get(kbId);
    if (!kb.ok) return sendError(c, kb.error);

    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return sendError(c, appError("validation", "expected a 'file' field"));
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ingested = await ingestDocument({
      filename: file.name,
      mime: file.type.length > 0 ? file.type : "application/octet-stream",
      bytes,
    });
    if (!ingested.ok) return sendError(c, ingested.error);

    const doc = ctx.db.knowledgebases.addDocument(kbId, {
      filename: file.name,
      mime: file.type.length > 0 ? file.type : "application/octet-stream",
      byteLength: bytes.length,
    });
    ctx.db.knowledgebases.insertChunks(kbId, asId("KbDocumentId", doc.id), doc.filename, ingested.value.chunks);
    return c.json(doc, 201);
  });

  app.delete("/:id/documents/:docId", (c) => {
    ctx.db.knowledgebases.removeDocument(asId("KbDocumentId", c.req.param("docId")));
    return c.body(null, 204);
  });

  app.post("/:id/clone", (c) => {
    const source = ctx.db.knowledgebases.get(asId("KnowledgebaseId", c.req.param("id")));
    if (!source.ok) return sendError(c, source.error);
    if (source.value.visibility !== "public" && source.value.ownerId !== ctx.user.id) {
      return sendError(c, appError("forbidden", "cannot clone a private knowledgebase you do not own"));
    }
    const cloned = ctx.db.knowledgebases.clone(asId("KnowledgebaseId", c.req.param("id")), ctx.user.id);
    return cloned.ok ? c.json(cloned.value, 201) : sendError(c, cloned.error);
  });

  return app;
};
