import { Hono } from "hono";
import {
  CreateModelInput,
  CreateProviderInput,
  SetSecretsInput,
  UpdateModelInput,
  UpdateProviderInput,
  appError,
  secretHint,
} from "@xagents/core";
import type { SecretUpdate } from "@xagents/db";
import type { AppContext } from "../context";
import { parseBody, readJson, sendError } from "../http";

/**
 * Admin provider/model/secret management, mounted under `/api/admin/providers`
 * (so it inherits the admin token gate). Every mutation reloads the in-memory
 * registry and audits the action; secret values never appear in a response or an
 * audit detail. Changing a provider's settings or key stops running hosts so the
 * next turn re-materializes with the new config.
 */
export const adminProviderRoutes = (ctx: AppContext): Hono => {
  const app = new Hono();
  const repo = ctx.db.providers;

  const after = (): void => ctx.registry.reload();
  const invalidateHosts = (): number => ctx.supervisor.stopHosts();

  app.get("/", (c) => c.json(ctx.registry.adminView()));

  app.post("/", async (c) => {
    const body = parseBody(CreateProviderInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    const created = repo.createProvider({
      id: body.value.id,
      name: body.value.name,
      adapterKind: body.value.adapterKind,
      settings: body.value.settings,
    });
    if (!created.ok) return sendError(c, created.error);
    after();
    ctx.adminHub.recordAction("provider_create", body.value.id, { adapterKind: body.value.adapterKind });
    return c.json(ctx.registry.adminView(), 201);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = repo.getProvider(id);
    if (existing === undefined) return sendError(c, appError("not_found", `provider ${id} not found`));
    const body = parseBody(UpdateProviderInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    // Honor "test before enable": a provider that failed its last test can't be enabled.
    if (body.value.enabled === true && existing.testStatus === "failed") {
      return sendError(
        c,
        appError("conflict", "This provider failed its last connection test. Re-test it before enabling."),
      );
    }
    repo.updateProvider(id, body.value);
    // Changing settings invalidates a prior successful test and any baked config.
    if (body.value.settings !== undefined) {
      repo.setTestStatus(id, "untested", null);
      invalidateHosts();
    }
    after();
    ctx.adminHub.recordAction("provider_update", id, {
      ...(body.value.enabled !== undefined ? { enabled: body.value.enabled } : {}),
      ...(body.value.settings !== undefined ? { settingsChanged: true } : {}),
    });
    return c.json(ctx.registry.adminView());
  });

  app.delete("/:id", (c) => {
    const id = c.req.param("id");
    if (repo.getProvider(id) === undefined) return sendError(c, appError("not_found", `provider ${id} not found`));
    const usage = repo.usageCount(id);
    repo.deleteProvider(id);
    invalidateHosts();
    after();
    ctx.adminHub.recordAction("provider_delete", id, { agentsAffected: usage });
    return c.json(ctx.registry.adminView());
  });

  // Write-only secrets. Empty string clears a field. Values are sealed here and
  // never echoed back; the audit records only which field names changed.
  app.put("/:id/secrets", async (c) => {
    const id = c.req.param("id");
    if (repo.getProvider(id) === undefined) return sendError(c, appError("not_found", `provider ${id} not found`));
    if (!ctx.registry.encryptionConfigured) {
      return sendError(c, appError("conflict", "Encryption is not configured. Set SECRETS_KEY and restart to manage keys."));
    }
    const body = parseBody(SetSecretsInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    const updates: Record<string, SecretUpdate> = {};
    for (const [field, value] of Object.entries(body.value.secrets)) {
      if (value.length === 0) {
        updates[field] = null;
        continue;
      }
      const sealed = ctx.registry.seal(value);
      if (sealed === null) return sendError(c, appError("internal", "failed to seal secret"));
      updates[field] = { sealed, hint: secretHint(value) };
    }
    repo.setSecrets(id, updates);
    invalidateHosts();
    after();
    ctx.adminHub.recordAction("provider_secrets", id, { fields: Object.keys(updates) });
    return c.json(ctx.registry.adminView());
  });

  app.post("/:id/test", async (c) => {
    const id = c.req.param("id");
    if (repo.getProvider(id) === undefined) return sendError(c, appError("not_found", `provider ${id} not found`));
    const result = await ctx.registry.test(id);
    repo.setTestStatus(id, result.ok ? "ok" : "failed", result.ok ? null : result.error.message);
    after();
    ctx.adminHub.recordAction("provider_test", id, { ok: result.ok });
    return c.json({ ok: result.ok, ...(result.ok ? {} : { error: result.error.message }) });
  });

  // --- models ----------------------------------------------------------------

  app.post("/:id/models", async (c) => {
    const providerId = c.req.param("id");
    const body = parseBody(CreateModelInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    const created = repo.addModel(providerId, {
      modelId: body.value.modelId,
      label: body.value.label,
      supportsReasoning: body.value.supportsReasoning,
      inputPer1M: body.value.inputPer1M,
      outputPer1M: body.value.outputPer1M,
    });
    if (!created.ok) return sendError(c, created.error);
    after();
    ctx.adminHub.recordAction("model_create", providerId, { modelId: body.value.modelId });
    return c.json(ctx.registry.adminView(), 201);
  });

  app.patch("/models/:modelId", async (c) => {
    const modelId = c.req.param("modelId");
    if (repo.getModel(modelId) === undefined) return sendError(c, appError("not_found", `model ${modelId} not found`));
    const body = parseBody(UpdateModelInput, await readJson(c));
    if (!body.ok) return sendError(c, body.error);
    const { isDefault, ...patch } = body.value;
    repo.updateModel(modelId, patch);
    if (isDefault === true) repo.setDefaultModel(modelId);
    after();
    ctx.adminHub.recordAction("model_update", modelId, {});
    return c.json(ctx.registry.adminView());
  });

  app.delete("/models/:modelId", (c) => {
    const modelId = c.req.param("modelId");
    const model = repo.getModel(modelId);
    if (model === undefined) return sendError(c, appError("not_found", `model ${modelId} not found`));
    const usage = repo.usageCount(model.providerId, model.modelId);
    repo.deleteModel(modelId);
    after();
    ctx.adminHub.recordAction("model_delete", modelId, { agentsAffected: usage });
    return c.json(ctx.registry.adminView());
  });

  return app;
};
