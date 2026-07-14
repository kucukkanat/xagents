import type { ChatStreamEvent } from "@xagents/core";
import { openStream, postMessage } from "./client";
import { encodeResume } from "./resume";
import { isTurnTerminal, mapEveEvent, parseNdjson } from "./stream";
import type { AgentHost, EveResume } from "./types";

export { materializeAgent } from "./materialize";
export { HostSupervisor } from "./supervisor";
export type { SupervisorOptions } from "./supervisor";
export type { AgentHost, AgentMaterializationSpec, EveResume, MaterializedSkill } from "./types";
export {
  generateAgentModuleSource,
  generateKbSearchToolSource,
  isSupportedProvider,
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

  yield { type: "turn_started", chatId: args.chatId };

  let text = "";
  let cursor = startIndex;
  let terminal = false;

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
  };
}
