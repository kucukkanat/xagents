import type { KbSearchHit } from "./entities";

/**
 * Token accounting for one completed turn, when the model/runtime reports it.
 * Optional on `turn_completed` because eve does not always surface usage — when
 * absent, the platform records the run with null tokens/cost (graceful degrade).
 */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/**
 * Normalized chat-stream events. The server maps eve's raw NDJSON stream into
 * this stable union, persists it, and re-emits it to the browser over SSE.
 * The UI renders a timeline from these, so eve's internal event names never
 * leak into the frontend.
 */
export type ChatStreamEvent =
  | { readonly type: "turn_started"; readonly chatId: string }
  /**
   * Lifecycle signal so the UI can reflect what the background turn is doing
   * before any model output exists — chiefly the cold-start window while the
   * eve host boots. Synthesized by the server, never persisted, never from eve.
   */
  | { readonly type: "status"; readonly state: "preparing" | "thinking" }
  /** An incremental assistant text delta. */
  | { readonly type: "text_delta"; readonly text: string }
  /** Model reasoning/thinking delta (when the model exposes it). */
  | { readonly type: "reasoning_delta"; readonly text: string }
  /** The model decided to call a tool. */
  | {
      readonly type: "tool_call";
      readonly callId: string;
      readonly toolName: string;
      readonly args: unknown;
    }
  /** A tool finished; `sandbox` marks work that ran inside a microVM. */
  | {
      readonly type: "tool_result";
      readonly callId: string;
      readonly toolName: string;
      readonly ok: boolean;
      readonly result: unknown;
      readonly sandbox: boolean;
    }
  /** Knowledgebase retrieval surfaced so the UI can show citations. */
  | { readonly type: "kb_citations"; readonly hits: readonly KbSearchHit[] }
  /** Terminal success: full assistant message text + the resume handle. */
  | {
      readonly type: "turn_completed";
      readonly messageId: string;
      readonly text: string;
      readonly continuationToken: string;
      /** Token usage for this turn, when eve reported it (see `TokenUsage`). */
      readonly usage?: TokenUsage;
    }
  | { readonly type: "error"; readonly message: string };

export type ChatStreamEventType = ChatStreamEvent["type"];
