import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type Chat, CreateAgentInput, generateMasterKey } from "@xagents/core";
import { createApp } from "../app";
import { createContext, type AppContext } from "../context";
import type { ServerConfig } from "../env";

/**
 * End-to-end coverage for the per-chat model hot-swap: the `PATCH /chats/:id/model`
 * validation and the `/internal/agents/:id/turn-model` resolver the materialized
 * agent calls each step. The first-boot seed enables DeepSeek with two models
 * (`deepseek-chat`, `deepseek-reasoner`), which serve as same-provider swap targets.
 */
const config = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  port: 0,
  databasePath: ":memory:",
  agentsWorkspaceDir: "/tmp/xagents-chat-model-test",
  sandboxBackend: "justbash",
  deepseekApiKey: "sk-seed-key",
  encryptionKey: generateMasterKey(),
  internalUrl: "http://127.0.0.1:0",
  webDistDir: "/tmp/xagents-nonexistent-dist",
  adminToken: undefined,
  metricsSampleIntervalMs: 15_000,
  metricsRetentionDays: 7,
  historyRetentionDays: 30,
  ...over,
});

let ctx: AppContext;
beforeEach(() => {
  ctx = createContext(config());
});
afterEach(() => {
  ctx.supervisor.stopAll();
  ctx.db.close();
});

const app = (): ReturnType<typeof createApp> => createApp(ctx);

const seedChat = () => {
  const owner = ctx.db.users.getCurrent();
  const agent = ctx.db.agents.create(
    owner.id,
    CreateAgentInput.parse({
      name: "Bot",
      instructionsMd: "You are helpful.",
      modelProvider: "deepseek",
      modelId: "deepseek-chat",
    }),
  );
  const chat = ctx.db.chats.create(agent.id, owner.id, "Chat");
  return { agentId: agent.id, chatId: chat.id };
};

const patchModel = (chatId: string, modelId: string | null): Promise<Response> =>
  app().fetch(
    new Request(`http://localhost/api/chats/${chatId}/model`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId }),
    }),
  );

const turnModel = (agentId: string, sessionId: string): Promise<Response> =>
  app().fetch(
    new Request(`http://localhost/internal/agents/${agentId}/turn-model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }),
  );

describe("PATCH /chats/:id/model", () => {
  test("swaps to another model of the agent's provider", async () => {
    const { chatId } = seedChat();
    const res = await patchModel(chatId, "deepseek-reasoner");
    expect(res.status).toBe(200);
    expect(((await res.json()) as Chat).overrideModelId).toBe("deepseek-reasoner");
  });

  test("rejects a model not offered by the agent's provider", async () => {
    const { chatId } = seedChat();
    const res = await patchModel(chatId, "gpt-4o");
    expect(res.status).toBeGreaterThanOrEqual(400);
    // The override is not persisted on a rejected swap.
    const reread = ctx.db.chats.get(chatId);
    expect(reread.ok && reread.value.overrideModelId).toBeNull();
  });

  test("null reverts to the agent default", async () => {
    const { chatId } = seedChat();
    await patchModel(chatId, "deepseek-reasoner");
    const res = await patchModel(chatId, null);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Chat).overrideModelId).toBeNull();
  });
});

describe("POST /internal/agents/:id/turn-model", () => {
  test("unmapped session resolves to the agent default", async () => {
    const { agentId } = seedChat();
    const res = await turnModel(agentId, "wrun_unmapped");
    expect(((await res.json()) as { modelId: string }).modelId).toBe("deepseek-chat");
  });

  test("a mapped session with an override resolves to the override", async () => {
    const { agentId, chatId } = seedChat();
    ctx.db.chats.setEveSessionId(chatId, "wrun_1");
    ctx.db.chats.setOverrideModel(chatId, "deepseek-reasoner");
    const res = await turnModel(agentId, "wrun_1");
    expect(((await res.json()) as { modelId: string }).modelId).toBe("deepseek-reasoner");
  });

  test("ignores an override from a chat belonging to a different agent", async () => {
    const first = seedChat();
    const second = seedChat();
    ctx.db.chats.setEveSessionId(first.chatId, "wrun_x");
    ctx.db.chats.setOverrideModel(first.chatId, "deepseek-reasoner");
    // Query with the *other* agent's id for the same session — the override must
    // not leak across agents; it falls back to that agent's own default.
    const res = await turnModel(second.agentId, "wrun_x");
    expect(((await res.json()) as { modelId: string }).modelId).toBe("deepseek-chat");
  });
});
