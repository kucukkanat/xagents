import { afterEach, describe, expect, test } from "vitest";
import { createApp } from "../app";
import { createContext, type AppContext } from "../context";
import type { ServerConfig } from "../env";

const makeConfig = (over: Partial<ServerConfig>): ServerConfig => ({
  port: 0,
  databasePath: ":memory:",
  agentsWorkspaceDir: "/tmp/xagents-admin-test",
  sandboxBackend: "justbash",
  deepseekApiKey: undefined,
  encryptionKey: undefined,
  internalUrl: "http://127.0.0.1:0",
  webDistDir: "/tmp/xagents-nonexistent-dist",
  adminToken: undefined,
  metricsSampleIntervalMs: 15_000,
  metricsRetentionDays: 7,
  historyRetentionDays: 30,
  ...over,
});

let ctx: AppContext;
afterEach(() => {
  ctx.adminHub.stop();
  ctx.supervisor.stopAll();
  ctx.db.close();
});

const call = (path: string, init?: RequestInit): Promise<Response> => {
  const app = createApp(ctx);
  return app.fetch(new Request(`http://localhost${path}`, init));
};

describe("admin gate", () => {
  test("404 when no ADMIN_TOKEN is configured (feature off, not advertised)", async () => {
    ctx = createContext(makeConfig({}));
    expect((await call("/api/admin/overview")).status).toBe(404);
  });

  test("403 without a token and with a wrong token when enabled", async () => {
    ctx = createContext(makeConfig({ adminToken: "secret" }));
    expect((await call("/api/admin/overview")).status).toBe(403);
    expect(
      (await call("/api/admin/overview", { headers: { Authorization: "Bearer nope" } })).status,
    ).toBe(403);
    expect((await call("/api/admin/overview", { headers: { "x-admin-token": "nope" } })).status).toBe(403);
  });

  test("200 with the correct bearer token, and a well-formed overview", async () => {
    ctx = createContext(makeConfig({ adminToken: "secret" }));
    const res = await call("/api/admin/overview", { headers: { Authorization: "Bearer secret" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      counts: { users: number };
      runtime: { sandboxBackend: string };
      models: unknown[];
    };
    expect(body.counts.users).toBe(1);
    expect(body.runtime.sandboxBackend).toBe("justbash");
    expect(Array.isArray(body.models)).toBe(true);
  });

  test("accepts the x-admin-token header too", async () => {
    ctx = createContext(makeConfig({ adminToken: "secret" }));
    expect((await call("/api/admin/overview", { headers: { "x-admin-token": "secret" } })).status).toBe(200);
  });
});

describe("config exposes adminAvailable", () => {
  test("true when a token is set", async () => {
    ctx = createContext(makeConfig({ adminToken: "secret" }));
    const body = (await (await call("/api/config")).json()) as { adminAvailable: boolean };
    expect(body.adminAvailable).toBe(true);
  });

  test("false when unset, and never leaks the token", async () => {
    ctx = createContext(makeConfig({}));
    const raw = await (await call("/api/config")).text();
    expect(JSON.parse(raw).adminAvailable).toBe(false);
    expect(raw).not.toContain("secret");
  });
});
