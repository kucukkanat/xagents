import { costUsd, type ModelPricing, type RunStatus, type TokenUsage } from "@xagents/core";
import type { NewRunMetric } from "@xagents/db";

/** Looks up token pricing for a (provider, modelId); returns undefined when unknown. */
export type PricingLookup = (provider: string, modelId: string) => ModelPricing | undefined;

/** Absolute wall-clock stamps (epoch millis) captured while driving a turn. */
export interface RunTiming {
  readonly startedAtMs: number;
  /** When the eve host became ready; null when an already-running host was reused. */
  readonly bootDoneAtMs: number | null;
  /** When the first assistant text delta arrived; null if the turn produced none. */
  readonly firstTextAtMs: number | null;
  readonly endedAtMs: number;
}

export interface RunCounters {
  readonly toolCalls: number;
  readonly sandboxCalls: number;
}

/** Identity of the run, resolved from the chat/agent before the turn starts. */
export interface RunContext {
  readonly chatId: string;
  readonly agentId: string;
  readonly userId: string;
  readonly modelProvider: string;
  readonly modelId: string;
}

/** Latency figures derived from raw timing stamps. */
export const deriveLatencies = (
  t: RunTiming,
): { readonly bootMs: number | null; readonly ttftMs: number | null; readonly durationMs: number } => ({
  bootMs: t.bootDoneAtMs === null ? null : Math.max(0, t.bootDoneAtMs - t.startedAtMs),
  ttftMs: t.firstTextAtMs === null ? null : Math.max(0, t.firstTextAtMs - t.startedAtMs),
  durationMs: Math.max(0, t.endedAtMs - t.startedAtMs),
});

/**
 * Assemble a persistable run-metrics row from the turn's context, timing,
 * counters, and (optional) token usage. Pure — the single place the shape and
 * cost math live, so it's fully unit-testable without a live eve host. Pricing
 * is injected (from the live registry) so this stays DB/registry-agnostic;
 * omit it to record the run without a cost figure.
 */
export const deriveRunMetric = (
  ctx: RunContext,
  timing: RunTiming,
  counters: RunCounters,
  usage: TokenUsage | undefined,
  status: RunStatus,
  errorMessage: string | null,
  pricingFor: PricingLookup = () => undefined,
): NewRunMetric => {
  const { bootMs, ttftMs, durationMs } = deriveLatencies(timing);
  const cost =
    usage === undefined
      ? null
      : (costUsd(pricingFor(ctx.modelProvider, ctx.modelId), usage.promptTokens, usage.completionTokens) ??
        null);
  return {
    chatId: ctx.chatId,
    agentId: ctx.agentId,
    userId: ctx.userId,
    modelProvider: ctx.modelProvider,
    modelId: ctx.modelId,
    status,
    errorMessage,
    bootMs,
    ttftMs,
    durationMs,
    toolCalls: counters.toolCalls,
    sandboxCalls: counters.sandboxCalls,
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    costUsd: cost,
    startedAt: new Date(timing.startedAtMs).toISOString(),
  };
};
