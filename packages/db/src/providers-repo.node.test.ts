import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { generateMasterKey, parseMasterKey, sealSecret, secretHint } from "@xagents/core";
import { openDb, type Db } from "./db";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => {
  db.close();
});

const seedDeepseek = () => {
  const created = db.providers.createProvider({
    id: "deepseek",
    name: "DeepSeek",
    adapterKind: "deepseek",
    settings: {},
  });
  expect(created.ok).toBe(true);
  return created;
};

describe("providers repo", () => {
  test("starts empty", () => {
    expect(db.providers.count()).toBe(0);
    expect(db.providers.listProviders()).toEqual([]);
  });

  test("create is idempotent-guarded (conflict on duplicate id)", () => {
    seedDeepseek();
    const again = db.providers.createProvider({
      id: "deepseek",
      name: "Dupe",
      adapterKind: "deepseek",
      settings: {},
    });
    expect(again.ok).toBe(false);
    expect(db.providers.count()).toBe(1);
  });

  test("providers are created disabled and can be enabled/patched", () => {
    seedDeepseek();
    expect(db.providers.getProvider("deepseek")?.enabled).toBe(false);
    expect(db.providers.updateProvider("deepseek", { enabled: true, name: "DS" })).toBe(true);
    const p = db.providers.getProvider("deepseek");
    expect(p?.enabled).toBe(true);
    expect(p?.name).toBe("DS");
  });

  test("secrets store sealed blobs + hints, and merge/clear per field", () => {
    seedDeepseek();
    const key = parseMasterKey(generateMasterKey());
    if (key === null) throw new Error("key");
    const plaintext = "sk-abcd1234";
    db.providers.setSecrets("deepseek", {
      apiKey: { sealed: sealSecret(plaintext, key), hint: secretHint(plaintext) },
    });
    const p = db.providers.getProvider("deepseek");
    expect(p?.secretHints.apiKey).toBe("1234");
    // The stored blob is sealed and round-trips only under the same key.
    expect(p?.sealedSecrets.apiKey?.v).toBe(1);
    // Clearing removes the field.
    db.providers.setSecrets("deepseek", { apiKey: null });
    expect(db.providers.getProvider("deepseek")?.sealedSecrets.apiKey).toBeUndefined();
  });

  test("setting secrets resets test status to untested", () => {
    seedDeepseek();
    db.providers.setTestStatus("deepseek", "ok", null);
    expect(db.providers.getProvider("deepseek")?.testStatus).toBe("ok");
    const key = parseMasterKey(generateMasterKey());
    if (key === null) throw new Error("key");
    db.providers.setSecrets("deepseek", {
      apiKey: { sealed: sealSecret("x", key), hint: "" },
    });
    expect(db.providers.getProvider("deepseek")?.testStatus).toBe("untested");
  });

  test("models: add, unique-per-provider, update, single default, delete", () => {
    seedDeepseek();
    const chat = db.providers.addModel("deepseek", {
      modelId: "deepseek-chat",
      label: "DeepSeek Chat",
      supportsReasoning: false,
      inputPer1M: 0.27,
      outputPer1M: 1.1,
    });
    expect(chat.ok).toBe(true);
    const dup = db.providers.addModel("deepseek", {
      modelId: "deepseek-chat",
      label: "dupe",
      supportsReasoning: false,
      inputPer1M: null,
      outputPer1M: null,
    });
    expect(dup.ok).toBe(false);

    const reasoner = db.providers.addModel("deepseek", {
      modelId: "deepseek-reasoner",
      label: "DeepSeek Reasoner",
      supportsReasoning: true,
      inputPer1M: 0.55,
      outputPer1M: 2.19,
    });
    if (!chat.ok || !reasoner.ok) throw new Error("adds must succeed");

    db.providers.setDefaultModel(chat.value.id);
    db.providers.setDefaultModel(reasoner.value.id);
    const defaults = db.providers.listModels().filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(reasoner.value.id);

    expect(db.providers.updateModel(chat.value.id, { enabled: false, label: "Chat" })).toBe(true);
    const updated = db.providers.getModel(chat.value.id);
    expect(updated?.enabled).toBe(false);
    expect(updated?.label).toBe("Chat");

    expect(db.providers.deleteModel(chat.value.id)).toBe(true);
    expect(db.providers.getModel(chat.value.id)).toBeUndefined();
  });

  test("deleting a provider cascades its models", () => {
    seedDeepseek();
    db.providers.addModel("deepseek", {
      modelId: "deepseek-chat",
      label: "c",
      supportsReasoning: false,
      inputPer1M: null,
      outputPer1M: null,
    });
    expect(db.providers.listModels()).toHaveLength(1);
    expect(db.providers.deleteProvider("deepseek")).toBe(true);
    expect(db.providers.listModels()).toHaveLength(0);
  });

  test("usageCount reflects agents referencing a provider/model", () => {
    seedDeepseek();
    const user = db.users.getCurrent();
    db.agents.create(user.id, {
      name: "A",
      description: "",
      instructionsMd: "hi",
      modelProvider: "deepseek",
      modelId: "deepseek-chat",
      reasoning: "provider-default",
      visibility: "private",
      knowledgebaseIds: [],
      skillIds: [],
    });
    expect(db.providers.usageCount("deepseek")).toBe(1);
    expect(db.providers.usageCount("deepseek", "deepseek-chat")).toBe(1);
    expect(db.providers.usageCount("deepseek", "deepseek-reasoner")).toBe(0);
  });
});
