import type { ChatStreamEvent, TokenUsage } from "@xagents/core";
import { openStream, postMessage } from "./client";
import { encodeResume } from "./resume";
import { extractUsage, isTurnTerminal, mapEveEvent, parseNdjson } from "./stream";
import type { AgentHost, EveResume } from "./types";

export { materializeAgent } from "./materialize";
export { zipDirectory, unzipBuffer } from "./zip";
export { parseAgentArchive } from "./import";
export type {
  ImportPlan,
  ImportPlanAgent,
  ImportPlanKnowledgebase,
  ImportPlanSkill,
  ParsedArchive,
} from "./import";
export { HostSupervisor, selectOrphanSandboxPids, countSandboxPids } from "./supervisor";
export type { SupervisorOptions } from "./supervisor";
export type {
  AgentHost,
  AgentMaterializationSpec,
  EveResume,
  HostStatus,
  HostStopReason,
  MaterializedSkill,
  SupervisorEvent,
} from "./types";
export {
  generateAgentModuleSource,
  generateKbSearchToolSource,
  isSupportedAdapterKind,
} from "./codegen";
export { encodeResume, decodeResume } from "./resume";

export interface RunChatTurnArgs {
  readonly host: AgentHost;
  readonly chatId: string;
  readonly message: string;
  readonly resume: EveResume | null;
  /** The server pre-allocates the assistant message id so it can persist the
   *  same id it streamed to the client. */
  readonly assistantMessageId: string;
  /**
   * Called with the eve session id as soon as it is known (right after the
   * message is posted, before the agent starts streaming). The server maps it to
   * this chat so the agent's dynamic-model resolver — which fires during the turn
   * and is keyed by session id — resolves this chat's model override from turn one.
   */
  readonly onSessionStart?: (sessionId: string) => void;
}

/**
 * Drives one chat turn against a running eve host and yields the normalized
 * event timeline. The final `turn_completed` carries the full assistant text
 * and the (re-encoded) resume handle the server must persist on the chat.
 */
/** eve rotates the event stream across some tool boundaries (a sandbox tool
 *  ends its stream segment abruptly). We reconnect from the cursor and keep
 *  reading until the turn's idle terminal, capped to avoid an infinite loop. */
const MAX_STREAM_RECONNECTS = 30;

export async function* runChatTurn(args: RunChatTurnArgs): AsyncGenerator<ChatStreamEvent> {
  const posted = await postMessage(args.host.origin, args.resume, args.message);
  if (!posted.ok) {
    yield { type: "error", message: posted.error.message };
    return;
  }
  const { sessionId, continuationToken, startIndex } = posted.value;
  // Publish the session→chat mapping before we open the stream, so the model
  // resolver's first callback (which may fire as the agent starts) already
  // resolves this chat's override rather than falling back to the default.
  args.onSessionStart?.(sessionId);

  yield { type: "turn_started", chatId: args.chatId };

  let text = "";
  let cursor = startIndex;
  let terminal = false;
  let usage: TokenUsage | undefined;

  for (let attempt = 0; attempt < MAX_STREAM_RECONNECTS && !terminal; attempt++) {
    const stream = await openStream(args.host.origin, sessionId, cursor);
    if (!stream.ok) {
      yield { type: "error", message: stream.error.message };
      return;
    }
    let framesThisConnection = 0;
    try {
      for await (const raw of parseNdjson(stream.value)) {
        framesThisConnection += 1;
        cursor += 1;
        for (const ev of mapEveEvent(raw)) {
          if (ev.type === "text_delta") text += ev.text;
          yield ev;
        }
        if (isTurnTerminal(raw)) {
          // Token usage, when eve reports it, rides the terminal frame.
          usage = extractUsage(raw) ?? usage;
          terminal = true;
          break;
        }
      }
    } catch {
      // Abrupt close ("terminated") mid-turn — fall through to reconnect at cursor.
    }
    // No terminal and no new frames on a fresh connection: nothing more is
    // coming, so stop rather than spin.
    if (!terminal && framesThisConnection === 0) break;
  }

  yield {
    type: "turn_completed",
    messageId: args.assistantMessageId,
    text,
    continuationToken: encodeResume({ sessionId, continuationToken, nextIndex: cursor }),
    ...(usage !== undefined ? { usage } : {}),
  };
}
