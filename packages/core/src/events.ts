import type { KbSearchHit } from "./entities";

/**
 * Normalized chat-stream events. The server maps eve's raw NDJSON stream into
 * this stable union, persists it, and re-emits it to the browser over SSE.
 * The UI renders a timeline from these, so eve's internal event names never
 * leak into the frontend.
 */
export type ChatStreamEvent =
  | { readonly type: "turn_started"; readonly chatId: string }
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
    }
  | { readonly type: "error"; readonly message: string };

export type ChatStreamEventType = ChatStreamEvent["type"];
