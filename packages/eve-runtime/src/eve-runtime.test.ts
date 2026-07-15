import { describe, expect, test } from "bun:test";
import type { AdapterKind } from "@xagents/core";
import {
  generateAgentModuleSource,
  generateKbSearchToolSource,
} from "./codegen";
import { decodeResume, encodeResume } from "./resume";
import { type EveRawEvent, isTurnTerminal, mapEveEvent, parseNdjson } from "./stream";

const INTERNAL = { internalUrl: "http://127.0.0.1:3000", agentId: "agt_123" };

describe("codegen", () => {
  test("agent module wires the deepseek adapter + a hot-swappable dynamic model", () => {
    const src = generateAgentModuleSource({
      provider: { providerId: "deepseek", adapterKind: "deepseek", settings: {} },
      modelId: "deepseek-chat",
      reasoning: "provider-default",
      ...INTERNAL,
    });
    expect(src).toContain('import { createDeepSeek } from "@ai-sdk/deepseek"');
    expect(src).toContain('import { defineAgent, defineDynamic } from "eve"');
    expect(src).toContain("createDeepSeek({ apiKey: process.env.XAGENTS_PROVIDER_SECRET_APIKEY })");
    // The default model is the agent's model, used as the dynamic fallback.
    expect(src).toContain('const DEFAULT_MODEL = "deepseek-chat"');
    expect(src).toContain("fallback: provider(DEFAULT_MODEL)");
    expect(src).toContain('"step.started"');
    // The resolver calls back to this agent's turn-model endpoint.
    expect(src).toContain('"http://127.0.0.1:3000/internal/agents/agt_123/turn-model"');
    expect(src).not.toContain("reasoning:");
  });

  test("openai-compatible bakes the base URL and reads the key from env", () => {
    const src = generateAgentModuleSource({
      provider: {
        providerId: "groq",
        adapterKind: "openai-compatible",
        settings: { baseURL: "https://api.groq.com/openai/v1" },
      },
      modelId: "llama-3.3-70b",
      reasoning: "provider-default",
      ...INTERNAL,
    });
    expect(src).toContain('import { createOpenAICompatible } from "@ai-sdk/openai-compatible"');
    expect(src).toContain('baseURL: "https://api.groq.com/openai/v1"');
    expect(src).toContain("apiKey: process.env.XAGENTS_PROVIDER_SECRET_APIKEY");
    expect(src).not.toContain('"https://api.groq.com/openai/v1"; DROP'); // sanity: value is JSON-encoded
  });

  test("agent module emits reasoning only when it diverges from default", () => {
    const src = generateAgentModuleSource({
      provider: { providerId: "deepseek", adapterKind: "deepseek", settings: {} },
      modelId: "deepseek-reasoner",
      reasoning: "high",
      ...INTERNAL,
    });
    expect(src).toContain('reasoning: "high"');
  });

  test("unsupported adapter kind throws", () => {
    expect(() =>
      generateAgentModuleSource({
        provider: { providerId: "x", adapterKind: "acme" as unknown as AdapterKind, settings: {} },
        modelId: "x",
        reasoning: "none",
        ...INTERNAL,
      }),
    ).toThrow();
  });

  test("kb_search tool targets the internal endpoint for the agent", () => {
    const src = generateKbSearchToolSource({
      internalUrl: "http://localhost:3000/",
      agentId: "agt_123",
    });
    expect(src).toContain('"http://localhost:3000/internal/agents/agt_123/kb-search"');
    expect(src).toContain('import { defineTool } from "eve/tools"');
  });
});

describe("resume", () => {
  test("round-trips", () => {
    const r = { sessionId: "wrun_1", continuationToken: "eve:abc", nextIndex: 11 };
    expect(decodeResume(encodeResume(r))).toEqual(r);
  });
  test("legacy token without nextIndex defaults to 0", () => {
    expect(decodeResume('{"sessionId":"s","continuationToken":"t"}')).toEqual({
      sessionId: "s",
      continuationToken: "t",
      nextIndex: 0,
    });
  });
  test("null / malformed decode to null", () => {
    expect(decodeResume(null)).toBeNull();
    expect(decodeResume("")).toBeNull();
    expect(decodeResume("{}")).toBeNull();
    expect(decodeResume("not json")).toBeNull();
  });
});

describe("stream mapping", () => {
  const ev = (type: string, data: Record<string, unknown>): EveRawEvent => ({ type, data });

  test("message.appended -> text_delta", () => {
    expect(mapEveEvent(ev("message.appended", { messageDelta: "Hello" }))).toEqual([
      { type: "text_delta", text: "Hello" },
    ]);
  });

  test("empty delta yields nothing", () => {
    expect(mapEveEvent(ev("message.appended", { messageDelta: "" }))).toEqual([]);
  });

  test("reasoning.appended -> reasoning_delta", () => {
    expect(mapEveEvent(ev("reasoning.appended", { reasoningDelta: "think" }))).toEqual([
      { type: "reasoning_delta", text: "think" },
    ]);
  });

  test("actions.requested -> tool_call(s)", () => {
    const out = mapEveEvent(
      ev("actions.requested", {
        actions: [{ callId: "c1", toolName: "bash", input: { cmd: "ls" } }],
      }),
    );
    expect(out).toEqual([
      { type: "tool_call", callId: "c1", toolName: "bash", args: { cmd: "ls" } },
    ]);
  });

  test("action.result marks sandbox tools and surfaces kb citations", () => {
    const sandboxResult = mapEveEvent(ev("action.result", { callId: "c1", toolName: "bash", output: "ok" }));
    expect(sandboxResult[0]).toMatchObject({ type: "tool_result", toolName: "bash", sandbox: true, ok: true });

    const kbResult = mapEveEvent(
      ev("action.result", {
        callId: "c2",
        toolName: "kb_search",
        output: { hits: [{ chunkId: "chk_1", documentId: "doc_1", filename: "a.md", ord: 2, text: "t", score: 1, citation: "a.md:2" }] },
      }),
    );
    expect(kbResult.map((e) => e.type)).toEqual(["tool_result", "kb_citations"]);
    expect(kbResult[1]).toMatchObject({ type: "kb_citations" });
  });

  test("turn terminal detection stops at the idle boundary, not turn.completed", () => {
    expect(isTurnTerminal(ev("session.waiting", {}))).toBe(true);
    expect(isTurnTerminal(ev("session.completed", {}))).toBe(true);
    expect(isTurnTerminal(ev("turn.completed", {}))).toBe(false);
    expect(isTurnTerminal(ev("message.appended", {}))).toBe(false);
  });

  test("parseNdjson splits frames and ignores blanks/garbage", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('{"type":"turn.started","data":{}}\n\n'));
        controller.enqueue(enc.encode("not-json\n"));
        controller.enqueue(enc.encode('{"type":"message.appended","data":{"messageDelta":"hi"}}'));
        controller.close();
      },
    });
    const types: string[] = [];
    for await (const frame of parseNdjson(body)) types.push(frame.type);
    expect(types).toEqual(["turn.started", "message.appended"]);
  });
});
