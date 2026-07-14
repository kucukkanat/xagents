import { describe, expect, test } from "bun:test";
import {
  generateAgentModuleSource,
  generateKbSearchToolSource,
} from "./codegen";
import { decodeResume, encodeResume } from "./resume";
import { type EveRawEvent, isTurnTerminal, mapEveEvent, parseNdjson } from "./stream";

describe("codegen", () => {
  test("agent module wires the deepseek provider + model id", () => {
    const src = generateAgentModuleSource({
      provider: "deepseek",
      modelId: "deepseek-chat",
      reasoning: "provider-default",
    });
    expect(src).toContain('import { deepseek } from "@ai-sdk/deepseek"');
    expect(src).toContain('deepseek("deepseek-chat")');
    expect(src).not.toContain("reasoning:");
  });

  test("agent module emits reasoning only when it diverges from default", () => {
    const src = generateAgentModuleSource({
      provider: "deepseek",
      modelId: "deepseek-reasoner",
      reasoning: "high",
    });
    expect(src).toContain('reasoning: "high"');
  });

  test("unsupported provider throws", () => {
    expect(() =>
      generateAgentModuleSource({ provider: "acme", modelId: "x", reasoning: "none" }),
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
