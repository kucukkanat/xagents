import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type AdminProvidersView, type ClientConfig, generateMasterKey } from "@xagents/core";
import { createApp } from "../app";
import { createContext, type AppContext } from "../context";
import type { ServerConfig } from "../env";

const config = (over: Partial<ServerConfig>): ServerConfig => ({
  port: 0,
  databasePath: ":memory:",
  agentsWorkspaceDir: "/tmp/xagents-providers-test",
  sandboxBackend: "justbash",
  deepseekApiKey: "sk-seed-key",
  encryptionKey: generateMasterKey(),
  internalUrl: "http://127.0.0.1:0",
  webDistDir: "/tmp/xagents-nonexistent-dist",
  adminToken: "secret",
  metricsSampleIntervalMs: 15_000,
  metricsRetentionDays: 7,
  historyRetentionDays: 30,
  ...over,
});

let ctx: AppContext;
const boot = (over: Partial<ServerConfig> = {}): void => {
  ctx = createContext(config(over));
};
afterEach(() => {
  ctx.adminHub.stop();
  ctx.supervisor.stopAll();
  ctx.db.close();
});

const admin = (path: string, init?: RequestInit): Promise<Response> =>
  createApp(ctx).fetch(
    new Request(`http://localhost/api/admin/providers${path}`, {
      ...init,
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json", ...init?.headers },
    }),
  );
const view = async (res: Response): Promise<AdminProvidersView> => (await res.json()) as AdminProvidersView;
const clientModels = async (): Promise<ClientConfig["models"]> => {
  const res = await createApp(ctx).fetch(new Request("http://localhost/api/config"));
  return ((await res.json()) as ClientConfig).models;
};

beforeEach(() => boot());

describe("seed", () => {
  test("first boot seeds DeepSeek enabled with two models and the env key", async () => {
    const v = await view(await admin(""));
    const deepseek = v.providers.find((p) => p.id === "deepseek");
    expect(deepseek?.enabled).toBe(true);
    expect(deepseek?.secrets.apiKey?.configured).toBe(true);
    expect(v.models.filter((m) => m.providerId === "deepseek")).toHaveLength(2);
    expect(v.encryptionConfigured).toBe(true);
    // The client picker sees the seeded models.
    expect((await clientModels()).map((m) => m.modelId).sort()).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

  test("without SECRETS_KEY, the seeded provider is disabled and keys are read-only", async () => {
    boot({ encryptionKey: undefined });
    const v = await view(await admin(""));
    expect(v.encryptionConfigured).toBe(false);
    expect(v.providers.find((p) => p.id === "deepseek")?.enabled).toBe(false);
    expect(await clientModels()).toEqual([]);
    // Secret writes are refused when encryption is off.
    const res = await admin("/deepseek/secrets", { method: "PUT", body: JSON.stringify({ secrets: { apiKey: "x" } }) });
    expect(res.status).toBe(409);
  });
});

describe("provider lifecycle", () => {
  test("create → key → add model → enable surfaces the model to the picker; delete removes it", async () => {
    // Create an OpenAI-compatible provider (disabled, no key yet).
    await admin("", {
      method: "POST",
      body: JSON.stringify({
        id: "groq",
        name: "Groq",
        adapterKind: "openai-compatible",
        settings: { baseURL: "https://api.groq.com/openai/v1" },
      }),
    });
    // Add a key.
    await admin("/groq/secrets", { method: "PUT", body: JSON.stringify({ secrets: { apiKey: "gsk_live_1234" } }) });
    // Add a model.
    await admin("/groq/models", {
      method: "POST",
      body: JSON.stringify({ modelId: "llama-3.3-70b", label: "Llama 3.3 70B", supportsReasoning: false }),
    });

    // Still disabled => not offered to users.
    expect((await clientModels()).some((m) => m.provider === "groq")).toBe(false);

    // Enable it.
    const enabled = await view(await admin("/groq", { method: "PATCH", body: JSON.stringify({ enabled: true }) }));
    expect(enabled.providers.find((p) => p.id === "groq")?.enabled).toBe(true);
    expect((await clientModels()).some((m) => m.modelId === "llama-3.3-70b")).toBe(true);

    // The stored key is never echoed back to the client.
    const raw = await (await admin("")).text();
    expect(raw).not.toContain("gsk_live_1234");

    // Delete the provider.
    await admin("/groq", { method: "DELETE" });
    expect((await view(await admin(""))).providers.some((p) => p.id === "groq")).toBe(false);
  });

  test("a provider that failed its last test can't be enabled", async () => {
    await admin("", {
      method: "POST",
      body: JSON.stringify({ id: "openai", name: "OpenAI", adapterKind: "openai-compatible", settings: { baseURL: "https://api.openai.com/v1" } }),
    });
    // Force a failed status by testing with an unreachable/invalid endpoint offline.
    await admin("/openai/secrets", { method: "PUT", body: JSON.stringify({ secrets: { apiKey: "bad" } }) });
    await admin("/openai", { method: "PATCH", body: JSON.stringify({ settings: { baseURL: "http://127.0.0.1:1/v1" } }) });
    await admin("/openai/test", { method: "POST" }); // will fail (connection refused)

    const res = await admin("/openai", { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    expect(res.status).toBe(409);
  });

  test("default model can be moved and models can be disabled", async () => {
    const v = await view(await admin(""));
    const reasoner = v.models.find((m) => m.modelId === "deepseek-reasoner");
    if (reasoner === undefined) throw new Error("seed missing reasoner");
    const after = await view(await admin(`/models/${reasoner.id}`, { method: "PATCH", body: JSON.stringify({ isDefault: true }) }));
    expect(after.models.filter((m) => m.isDefault)).toHaveLength(1);
    expect(after.models.find((m) => m.isDefault)?.modelId).toBe("deepseek-reasoner");

    // Disabling a model drops it from the picker.
    await admin(`/models/${reasoner.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
    expect((await clientModels()).some((m) => m.modelId === "deepseek-reasoner")).toBe(false);
  });
});
