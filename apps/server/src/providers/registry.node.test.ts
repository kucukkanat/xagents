import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { generateMasterKey, parseMasterKey } from "@xagents/core";
import { openDb, type Db } from "@xagents/db";
import { buildProviderTest, createProviderRegistry, type ProviderRegistry } from "./registry";

let db: Db;
const masterKey = parseMasterKey(generateMasterKey());

/** A deepseek provider with one enabled, keyed model. */
const seedKeyed = (registry: ProviderRegistry): void => {
  db.providers.createProvider({ id: "deepseek", name: "DeepSeek", adapterKind: "deepseek", settings: {} });
  db.providers.addModel("deepseek", {
    modelId: "deepseek-chat",
    label: "DeepSeek Chat",
    supportsReasoning: false,
    inputPer1M: 0.27,
    outputPer1M: 1.1,
  });
  const sealed = registry.seal("sk-secret-key");
  if (sealed === null) throw new Error("seal must work with a master key");
  db.providers.setSecrets("deepseek", { apiKey: { sealed, hint: "-key" } });
  db.providers.updateProvider("deepseek", { enabled: true });
  registry.reload();
};

beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => {
  db.close();
});

describe("provider registry (with master key)", () => {
  test("models() exposes only enabled provider + enabled models", () => {
    const registry = createProviderRegistry(db, masterKey);
    seedKeyed(registry);
    expect(registry.models()).toEqual([
      {
        provider: "deepseek",
        modelId: "deepseek-chat",
        label: "DeepSeek Chat",
        supportsReasoning: false,
        pricing: { inputPer1M: 0.27, outputPer1M: 1.1 },
      },
    ]);
    // Disabling the provider hides its models from the picker.
    db.providers.updateProvider("deepseek", { enabled: false });
    registry.reload();
    expect(registry.models()).toEqual([]);
  });

  test("usability gates on enabled provider, enabled model, and key presence", () => {
    const registry = createProviderRegistry(db, masterKey);
    seedKeyed(registry);
    expect(registry.usability("deepseek", "deepseek-chat").ok).toBe(true);
    expect(registry.usability("deepseek", "ghost").ok).toBe(false); // unknown model
    expect(registry.usability("ghost", "x").ok).toBe(false); // unknown provider

    db.providers.updateProvider("deepseek", { enabled: false });
    registry.reload();
    expect(registry.usability("deepseek", "deepseek-chat").ok).toBe(false); // disabled provider

    db.providers.updateProvider("deepseek", { enabled: true });
    db.providers.setSecrets("deepseek", { apiKey: null }); // clear key
    registry.reload();
    expect(registry.usability("deepseek", "deepseek-chat").ok).toBe(false); // no key
  });

  test("envFor decrypts the key into the canonical secret env var", () => {
    const registry = createProviderRegistry(db, masterKey);
    seedKeyed(registry);
    expect(registry.envFor("deepseek")).toEqual({ XAGENTS_PROVIDER_SECRET_APIKEY: "sk-secret-key" });
    expect(registry.envFor("ghost")).toEqual({});
  });

  test("codegenFor returns adapter + settings for materialization", () => {
    const registry = createProviderRegistry(db, masterKey);
    seedKeyed(registry);
    expect(registry.codegenFor("deepseek")).toEqual({
      providerId: "deepseek",
      adapterKind: "deepseek",
      settings: {},
    });
  });

  test("adminView carries usage counts and never leaks sealed secrets", () => {
    const registry = createProviderRegistry(db, masterKey);
    seedKeyed(registry);
    db.agents.create(db.users.getCurrent().id, {
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
    const view = registry.adminView();
    const provider = view.providers.find((p) => p.id === "deepseek");
    expect(provider?.usage).toBe(1);
    expect(provider?.secrets.apiKey).toEqual({ configured: true, hint: "-key" });
    expect(JSON.stringify(view)).not.toContain("sk-secret-key");
    expect(view.models[0]?.usage).toBe(1);
  });

  test("modelResolver substitutes unknown models with the provider default", () => {
    const registry = createProviderRegistry(db, masterKey);
    seedKeyed(registry);
    const r = registry.modelResolver();
    expect(r.isKnownProvider("deepseek")).toBe(true);
    expect(r.hasModel("deepseek", "deepseek-chat")).toBe(true);
    expect(r.fallbackFor("deepseek")).toEqual({ provider: "deepseek", modelId: "deepseek-chat" });
    expect(r.fallbackFor("ghost")).toBeNull();
  });
});

describe("provider registry (no master key)", () => {
  test("keyed provider is unusable and envFor is empty without SECRETS_KEY", () => {
    const registry = createProviderRegistry(db, masterKey); // seed with a key first…
    seedKeyed(registry);
    // …then reopen the registry as if SECRETS_KEY were unset.
    const noKey = createProviderRegistry(db, null);
    expect(noKey.encryptionConfigured).toBe(false);
    expect(noKey.usability("deepseek", "deepseek-chat").ok).toBe(false);
    expect(noKey.envFor("deepseek")).toEqual({});
    expect(noKey.seal("x")).toBeNull();
  });
});

describe("buildProviderTest", () => {
  test("openai-compatible probes {baseURL}/models with a bearer token", () => {
    const plan = buildProviderTest({
      adapterKind: "openai-compatible",
      settings: { baseURL: "https://api.groq.com/openai/v1/" },
      secrets: { apiKey: "k" },
    });
    expect(plan).toEqual({
      kind: "http",
      url: "https://api.groq.com/openai/v1/models",
      headers: { authorization: "Bearer k" },
    });
  });

  test("anthropic uses x-api-key + version header", () => {
    const plan = buildProviderTest({ adapterKind: "anthropic", settings: {}, secrets: { apiKey: "k" } });
    expect(plan).toMatchObject({ kind: "http", url: "https://api.anthropic.com/v1/models" });
    if (plan.kind === "http") expect(plan.headers["x-api-key"]).toBe("k");
  });

  test("vertex is a structural credential check (no network)", () => {
    const good = buildProviderTest({
      adapterKind: "google-vertex",
      settings: { project: "p", location: "us-central1" },
      secrets: { credentialsJson: '{"client_email":"a@b","private_key":"x"}' },
    });
    expect(good).toMatchObject({ kind: "structural", ok: true });
    const bad = buildProviderTest({
      adapterKind: "google-vertex",
      settings: {},
      secrets: { credentialsJson: "not json" },
    });
    expect(bad).toMatchObject({ kind: "structural", ok: false });
  });
});
