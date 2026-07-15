import { secretHint } from "@xagents/core";
import type { Db } from "@xagents/db";
import type { ServerConfig } from "../env";
import type { ProviderRegistry } from "./registry";

/**
 * First-boot seed: recreate the MVP's hard-coded DeepSeek catalogue as data so a
 * deploy that switches to admin-managed providers keeps every existing agent
 * working. Idempotent — only runs when the providers table is empty. When both a
 * master key and a legacy `DEEPSEEK_API_KEY` are present, the key is sealed and
 * the provider enabled, reproducing the prior behavior exactly; otherwise the
 * provider is seeded disabled for an admin to key + enable in the console.
 */
export const seedDefaultProviders = (db: Db, registry: ProviderRegistry, config: ServerConfig): void => {
  if (db.providers.count() > 0) return;

  const created = db.providers.createProvider({
    id: "deepseek",
    name: "DeepSeek",
    adapterKind: "deepseek",
    settings: {},
  });
  if (!created.ok) return;

  const chat = db.providers.addModel("deepseek", {
    modelId: "deepseek-chat",
    label: "DeepSeek Chat",
    supportsReasoning: false,
    inputPer1M: 0.27,
    outputPer1M: 1.1,
  });
  db.providers.addModel("deepseek", {
    modelId: "deepseek-reasoner",
    label: "DeepSeek Reasoner",
    supportsReasoning: true,
    inputPer1M: 0.55,
    outputPer1M: 2.19,
  });
  if (chat.ok) db.providers.setDefaultModel(chat.value.id);

  const key = config.deepseekApiKey;
  const sealed = key !== undefined && key.length > 0 ? registry.seal(key) : null;
  if (key !== undefined && key.length > 0 && sealed !== null) {
    db.providers.setSecrets("deepseek", { apiKey: { sealed, hint: secretHint(key) } });
    db.providers.updateProvider("deepseek", { enabled: true });
    // The env key was already in use pre-migration, so treat it as verified.
    db.providers.setTestStatus("deepseek", "ok", null);
  }

  registry.reload();
};
