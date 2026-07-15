import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CreateAgentInput } from "@xagents/core";
import { openDb, type Db } from "./index";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => {
  db.close();
});

const seedAgent = (name = "Bot") =>
  db.agents.create(
    db.users.getCurrent().id,
    CreateAgentInput.parse({
      name,
      instructionsMd: "hi",
      modelProvider: "deepseek",
      modelId: "deepseek-chat",
    }),
  );

const recordRun = (over: Partial<Parameters<Db["admin"]["recordRunMetric"]>[0]> = {}): void =>
  db.admin.recordRunMetric({
    chatId: "cht_1",
    agentId: "agt_missing",
    userId: db.users.getCurrent().id,
    modelProvider: "deepseek",
    modelId: "deepseek-chat",
    status: "completed",
    errorMessage: null,
    bootMs: null,
    ttftMs: null,
    durationMs: 100,
    toolCalls: 0,
    sandboxCalls: 0,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    costUsd: null,
    startedAt: new Date().toISOString(),
    ...over,
  });

describe("AdminRepo counts + content", () => {
  test("counts reflect seeded content", () => {
    seedAgent();
    const c = db.admin.counts();
    expect(c.users).toBe(1);
    expect(c.agents).toBe(1);
    expect(c.chats).toBe(0);
  });

  test("listAgents carries owner handle, visibility, and model detail", () => {
    seedAgent();
    const items = db.admin.listAgents();
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("agent");
    expect(items[0]?.ownerHandle).toBe("local");
    expect(items[0]?.visibility).toBe("private");
    expect(items[0]?.detail).toContain("deepseek");
  });

  test("setVisibility flips content and reports missing rows", () => {
    const agent = seedAgent();
    expect(db.admin.setVisibility("agent", agent.id, "public")).toBe(true);
    const got = db.agents.get(agent.id);
    expect(got.ok && got.value.visibility).toBe("public");
    expect(db.admin.setVisibility("agent", "agt_nope", "public")).toBe(false);
  });

  test("deleteUser removes the user and cascades their content", () => {
    seedAgent();
    const user = db.users.getCurrent();
    expect(db.admin.deleteUser(user.id)).toBe(true);
    const c = db.admin.counts();
    expect(c.users).toBe(0);
    expect(c.agents).toBe(0);
  });
});

describe("AdminRepo run metrics", () => {
  test("round-trips a run with joined agent name and totals", () => {
    const agent = seedAgent();
    recordRun({ agentId: agent.id, promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0.001 });
    const page = db.admin.runMetrics({ limit: 10 });
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]?.agentName).toBe("Bot");
    expect(page.totals.turns).toBe(1);
    expect(page.totals.completed).toBe(1);
    expect(page.totals.totalTokens).toBe(30);
  });

  test("agentName is null when the agent was deleted", () => {
    recordRun();
    expect(db.admin.runMetrics({ limit: 10 }).runs[0]?.agentName).toBeNull();
  });

  test("paginates newest-first via a keyset cursor with no overlap", () => {
    for (let i = 0; i < 5; i += 1) recordRun({ chatId: `cht_${i}` });
    const first = db.admin.runMetrics({ limit: 2 });
    expect(first.runs).toHaveLength(2);
    if (first.nextCursor === null) throw new Error("expected a next cursor");
    const second = db.admin.runMetrics({ limit: 2, cursor: first.nextCursor });
    expect(second.runs).toHaveLength(2);
    const firstIds = new Set(first.runs.map((r) => r.id));
    expect(second.runs.some((r) => firstIds.has(r.id))).toBe(false);
  });

  test("status counts split completed / error / cancelled", () => {
    recordRun({ status: "completed" });
    recordRun({ status: "error", errorMessage: "x" });
    recordRun({ status: "cancelled" });
    const t = db.admin.runTotals("0000", "9999");
    expect(t.completed).toBe(1);
    expect(t.errors).toBe(1);
    expect(t.cancelled).toBe(1);
  });
});

describe("AdminRepo samples + events", () => {
  test("samples average within an ISO-minute bucket", () => {
    db.admin.recordSamples("2026-07-15T10:00:05.000Z", { "proc.rss": 100 });
    db.admin.recordSamples("2026-07-15T10:00:20.000Z", { "proc.rss": 200 });
    db.admin.recordSamples("2026-07-15T11:00:00.000Z", { "proc.rss": 400 });
    const series = db.admin.series("proc.rss", "2026-07-15T00:00:00.000Z", "2026-07-16T00:00:00.000Z", 16);
    expect(series.points).toHaveLength(2);
    expect(series.points[0]?.value).toBe(150);
    expect(series.points[1]?.value).toBe(400);
  });

  test("admin events read back newest-first with parsed detail", () => {
    const started = db.admin.recordAdminEvent({
      kind: "host_started",
      actor: "system",
      target: "agt_1",
      detail: { bootMs: 42 },
    });
    db.admin.recordAdminEvent({ kind: "admin_action", actor: "admin", target: null, detail: { action: "reap" } });
    const events = db.admin.recentEvents(undefined, 10);
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe("admin_action");
    expect(events[1]?.id).toBe(started.id);
    expect(events[1]?.detail.bootMs).toBe(42);
  });

  test("prune removes aged rows only", () => {
    db.admin.recordSamples("2020-01-01T00:00:00.000Z", { "proc.rss": 1 });
    db.admin.recordSamples("2026-07-15T00:00:00.000Z", { "proc.rss": 2 });
    db.admin.pruneOlderThan("2021-01-01T00:00:00.000Z", "2021-01-01T00:00:00.000Z");
    const series = db.admin.series("proc.rss", "2000-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z", 13);
    expect(series.points).toHaveLength(1);
    expect(series.points[0]?.value).toBe(2);
  });
});
