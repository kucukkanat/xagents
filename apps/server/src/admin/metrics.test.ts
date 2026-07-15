import { describe, expect, test } from "bun:test";
import type { ModelPricing } from "@xagents/core";
import {
  deriveLatencies,
  deriveRunMetric,
  type PricingLookup,
  type RunContext,
  type RunTiming,
} from "./metrics";

/** Stand-in for the live registry: prices deepseek-chat, nothing else. */
const pricing: PricingLookup = (provider, modelId): ModelPricing | undefined =>
  provider === "deepseek" && modelId === "deepseek-chat"
    ? { inputPer1M: 0.27, outputPer1M: 1.1 }
    : undefined;

const timing: RunTiming = { startedAtMs: 1000, bootDoneAtMs: 1200, firstTextAtMs: 1500, endedAtMs: 4000 };
const ctx: RunContext = {
  chatId: "cht_1",
  agentId: "agt_1",
  userId: "usr_1",
  modelProvider: "deepseek",
  modelId: "deepseek-chat",
};

describe("deriveLatencies", () => {
  test("computes boot / ttft / duration from stamps", () => {
    expect(deriveLatencies(timing)).toEqual({ bootMs: 200, ttftMs: 500, durationMs: 3000 });
  });

  test("null boot / first-text propagate as null", () => {
    expect(
      deriveLatencies({ startedAtMs: 0, bootDoneAtMs: null, firstTextAtMs: null, endedAtMs: 100 }),
    ).toEqual({ bootMs: null, ttftMs: null, durationMs: 100 });
  });

  test("never negative when stamps are out of order", () => {
    const l = deriveLatencies({ startedAtMs: 5000, bootDoneAtMs: 4000, firstTextAtMs: null, endedAtMs: 4000 });
    expect(l.bootMs).toBe(0);
    expect(l.durationMs).toBe(0);
  });
});

describe("deriveRunMetric", () => {
  test("carries counters + tokens and prices from the injected lookup", () => {
    const row = deriveRunMetric(
      ctx,
      timing,
      { toolCalls: 2, sandboxCalls: 1 },
      { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 },
      "completed",
      null,
      pricing,
    );
    expect(row.toolCalls).toBe(2);
    expect(row.sandboxCalls).toBe(1);
    expect(row.promptTokens).toBe(1_000_000);
    expect(row.durationMs).toBe(3000);
    expect(row.status).toBe("completed");
    expect(row.startedAt).toBe(new Date(1000).toISOString());
    // deepseek-chat input list price is $0.27 / 1M tokens
    expect(row.costUsd).toBeCloseTo(0.27, 9);
  });

  test("no usage → null tokens and null cost, error message preserved", () => {
    const row = deriveRunMetric(ctx, timing, { toolCalls: 0, sandboxCalls: 0 }, undefined, "error", "boom");
    expect(row.totalTokens).toBeNull();
    expect(row.costUsd).toBeNull();
    expect(row.errorMessage).toBe("boom");
  });

  test("unknown model → null cost even with usage", () => {
    const row = deriveRunMetric(
      { ...ctx, modelId: "mystery" },
      timing,
      { toolCalls: 0, sandboxCalls: 0 },
      { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
      "completed",
      null,
      pricing,
    );
    expect(row.costUsd).toBeNull();
    expect(row.totalTokens).toBe(200);
  });
});
