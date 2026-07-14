import type { ChatStreamEvent } from "@xagents/core";
import { postTurn } from "./client";
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
export async function* runChatTurn(args: RunChatTurnArgs): AsyncGenerator<ChatStreamEvent> {
  const posted = await postTurn(args.host.origin, args.resume, args.message);
  if (!posted.ok) {
    yield { type: "error", message: posted.error.message };
    return;
  }

  yield { type: "turn_started", chatId: args.chatId };

  let text = "";
  let framesRead = 0;
  try {
    for await (const raw of parseNdjson(posted.value.stream)) {
      framesRead += 1;
      for (const ev of mapEveEvent(raw)) {
        if (ev.type === "text_delta") text += ev.text;
        yield ev;
      }
      if (isTurnTerminal(raw)) break;
    }
  } catch (cause) {
    yield { type: "error", message: cause instanceof Error ? cause.message : "stream error" };
    return;
  }

  yield {
    type: "turn_completed",
    messageId: args.assistantMessageId,
    text,
    continuationToken: encodeResume({
      sessionId: posted.value.sessionId,
      continuationToken: posted.value.continuationToken,
      nextIndex: posted.value.startIndex + framesRead,
    }),
  };
}
