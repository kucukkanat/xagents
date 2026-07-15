import type { ChatStreamEvent, KbSearchHit, TokenUsage } from "@xagents/core";

/** Raw eve NDJSON frame: `{ type, data, meta }`. */
export interface EveRawEvent {
  readonly type: string;
  readonly data: Record<string, unknown>;
  /** eve's per-frame metadata; token usage tends to ride here on terminal frames. */
  readonly meta?: Record<string, unknown>;
}

/** eve's built-in sandbox tools — their work runs inside the microVM. */
const SANDBOX_TOOLS = new Set(["bash", "read_file", "write_file", "glob", "grep"]);

/** Parse an NDJSON byte stream into raw eve events. */
export async function* parseNdjson(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<EveRawEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const frame = parseFrame(line);
        if (frame !== undefined) yield frame;
      }
    }
    const tail = parseFrame(buffer);
    if (tail !== undefined) yield tail;
  } finally {
    reader.releaseLock();
  }
}

const parseFrame = (line: string): EveRawEvent | undefined => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof obj.type !== "string") return undefined;
    return {
      type: obj.type,
      data: isRecord(obj.data) ? obj.data : {},
      ...(isRecord(obj.meta) ? { meta: obj.meta } : {}),
    };
  } catch {
    return undefined;
  }
};

/**
 * Map one raw eve event to zero-or-more normalized `ChatStreamEvent`s. Terminal
 * bookkeeping (`turn_started`/`turn_completed`) is handled by the orchestrator,
 * which owns the chat id and resume token — so this stays a pure per-event map.
 * `text` accumulation is the caller's job (we only emit deltas).
 */
export const mapEveEvent = (ev: EveRawEvent): ChatStreamEvent[] => {
  switch (ev.type) {
    case "message.appended": {
      const delta = str(ev.data.messageDelta);
      return delta.length > 0 ? [{ type: "text_delta", text: delta }] : [];
    }
    case "reasoning.appended": {
      const delta = str(ev.data.reasoningDelta) || str(ev.data.messageDelta);
      return delta.length > 0 ? [{ type: "reasoning_delta", text: delta }] : [];
    }
    case "actions.requested": {
      return extractActions(ev.data).map((a) => ({
        type: "tool_call",
        callId: a.callId,
        toolName: a.toolName,
        args: a.args,
      }));
    }
    case "action.result": {
      // eve nests the result under `data.result`; fields may sit there or at the
      // top level, so merge (nested wins) before reading callId/toolName/output.
      const p: Record<string, unknown> = isRecord(ev.data.result)
        ? { ...ev.data, ...ev.data.result }
        : ev.data;
      const callId = str(p.callId) || str(p.actionId);
      const toolName = str(p.toolName) || str(p.name);
      const isError = p.isError === true || p.ok === false;
      const output = p.output ?? p.result ?? p;
      const events: ChatStreamEvent[] = [
        {
          type: "tool_result",
          callId,
          toolName,
          ok: !isError,
          result: output,
          sandbox: SANDBOX_TOOLS.has(toolName),
        },
      ];
      const hits = extractKbHits(toolName, output);
      if (hits.length > 0) events.push({ type: "kb_citations", hits });
      return events;
    }
    default:
      return [];
  }
};

/**
 * True at the idle boundary AFTER a turn. We stop on `session.waiting` /
 * `session.completed` rather than `turn.completed`, so the consumed frame count
 * lands the cursor exactly on the next turn's first event (eve replays the whole
 * session from `startIndex`, so an off-by-N cursor would skip a turn's output).
 */
export const isTurnTerminal = (ev: EveRawEvent): boolean =>
  ev.type === "session.waiting" || ev.type === "session.completed";

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Read a usage object under any of eve's/AI-SDK's common key spellings. */
const readUsage = (src: unknown): TokenUsage | undefined => {
  if (!isRecord(src)) return undefined;
  const prompt =
    num(src.promptTokens) ?? num(src.inputTokens) ?? num(src.prompt_tokens) ?? num(src.input_tokens);
  const completion =
    num(src.completionTokens) ??
    num(src.outputTokens) ??
    num(src.completion_tokens) ??
    num(src.output_tokens);
  if (prompt === undefined && completion === undefined) return undefined;
  const promptTokens = prompt ?? 0;
  const completionTokens = completion ?? 0;
  const totalTokens = num(src.totalTokens) ?? num(src.total_tokens) ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
};

/**
 * Best-effort token usage from an eve frame. eve doesn't guarantee usage, and
 * where it lands (`data.usage`, `meta.usage`, or inline) varies by version, so
 * we probe the likely spots and return `undefined` when nothing is present —
 * the platform then records the run without token/cost (graceful degradation).
 */
export const extractUsage = (ev: EveRawEvent): TokenUsage | undefined =>
  readUsage(ev.data.usage) ??
  readUsage(ev.meta?.usage) ??
  readUsage(ev.data) ??
  readUsage(ev.meta);

interface Action {
  readonly callId: string;
  readonly toolName: string;
  readonly args: unknown;
}

const extractActions = (data: Record<string, unknown>): Action[] => {
  const raw = Array.isArray(data.actions)
    ? data.actions
    : isRecord(data.action)
      ? [data.action]
      : [];
  return raw.filter(isRecord).map((a) => ({
    callId: str(a.callId) || str(a.id),
    toolName: str(a.toolName) || str(a.name),
    args: a.input ?? a.args ?? {},
  }));
};

const extractKbHits = (toolName: string, result: unknown): readonly KbSearchHit[] => {
  if (toolName !== "kb_search" || !isRecord(result) || !Array.isArray(result.hits)) return [];
  return result.hits.filter(isRecord).map((h) => ({
    chunkId: str(h.chunkId) as KbSearchHit["chunkId"],
    documentId: str(h.documentId) as KbSearchHit["documentId"],
    filename: str(h.filename),
    ord: typeof h.ord === "number" ? h.ord : 0,
    text: str(h.text),
    score: typeof h.score === "number" ? h.score : 0,
    citation: str(h.citation),
  }));
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === "string" ? v : "");
