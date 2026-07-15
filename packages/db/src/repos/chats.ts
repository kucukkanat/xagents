import {
  appError,
  asId,
  err,
  newId,
  ok,
  type AgentId,
  type AppError,
  type Chat,
  type ChatId,
  type ChatRole,
  type ChatStreamEvent,
  type ChatSummary,
  type Message,
  type Result,
  type UserId,
} from "@xagents/core";
import { nowIso } from "../helpers";
import { mapChatRow, mapMessageRow, type ChatRow, type MessageRow } from "../mappers";
import type { Sqlite } from "../sqlite";

/** A chat row joined with its agent name and a last-message preview. */
interface ChatSummaryRow extends ChatRow {
  readonly agent_name: string;
  readonly message_count: number;
  readonly last_message: string | null;
}

const PREVIEW_LEN = 140;

const mapSummaryRow = (row: ChatSummaryRow): ChatSummary => ({
  chat: mapChatRow(row),
  agentName: row.agent_name,
  messageCount: row.message_count,
  lastMessagePreview: row.last_message === null ? null : row.last_message.slice(0, PREVIEW_LEN),
});

export interface MessagesRepo {
  readonly append: (chatId: ChatId, role: ChatRole, content: string) => Message;
  readonly list: (chatId: ChatId) => Message[];
}

export interface EventsRepo {
  readonly append: (chatId: ChatId, seq: number, event: ChatStreamEvent) => void;
  readonly list: (chatId: ChatId) => ChatStreamEvent[];
}

/**
 * Durable turn-progress tracking, separate from the in-process turn hub. One
 * row per chat: `start` marks it running (upserting over any prior row),
 * `complete`/`fail` finalize it. `listRunning` powers boot-time reconciliation —
 * any chat still "running" was mid-turn when the previous process stopped.
 */
export interface TurnsRepo {
  readonly start: (chatId: ChatId) => void;
  readonly complete: (chatId: ChatId) => void;
  readonly fail: (chatId: ChatId, message: string) => void;
  readonly listRunning: () => ChatId[];
}

export interface ChatsRepo {
  readonly create: (agentId: AgentId, userId: UserId, title: string) => Chat;
  readonly get: (id: ChatId) => Result<Chat, AppError>;
  readonly list: (agentId: AgentId) => Chat[];
  /** A user's chats as history summaries, newest first, optionally one agent. */
  readonly listByUser: (userId: UserId, agentId?: AgentId) => ChatSummary[];
  /** The chat backing an eve session, or undefined if none is mapped yet. */
  readonly getBySessionId: (sessionId: string) => Chat | undefined;
  readonly setContinuationToken: (id: ChatId, token: string) => void;
  /** Record the eve session id backing this chat (set once, after the first turn). */
  readonly setEveSessionId: (id: ChatId, sessionId: string) => void;
  /** Hot-swap the per-chat model override; null reverts to the agent default. */
  readonly setOverrideModel: (id: ChatId, modelId: string | null) => void;
  readonly setTitle: (id: ChatId, title: string) => void;
  /** Delete a chat and, via ON DELETE CASCADE, its messages/events/turn row. */
  readonly delete: (id: ChatId) => void;
  readonly messages: MessagesRepo;
  readonly events: EventsRepo;
  readonly turns: TurnsRepo;
}

interface EventDataRow {
  readonly data_json: string;
}

export const createChatsRepo = (db: Sqlite): ChatsRepo => {
  const insertChat = db.prepare(
    `INSERT INTO chats (id, agent_id, user_id, title, eve_continuation_token, override_model_id, eve_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  );
  const getRow = db.prepare<[string], ChatRow>("SELECT * FROM chats WHERE id = ?");
  const getBySessionRow = db.prepare<[string], ChatRow>(
    "SELECT * FROM chats WHERE eve_session_id = ?",
  );
  const listRows = db.prepare<[string], ChatRow>(
    "SELECT * FROM chats WHERE agent_id = ? ORDER BY updated_at DESC",
  );
  // Correlated subqueries carry the preview + count so one read hydrates a summary.
  // The trailing `(? IS NULL OR agent_id = ?)` makes the agent filter optional.
  const summarySelect = `
    SELECT c.*, a.name AS agent_name,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count,
      (SELECT content FROM messages m WHERE m.chat_id = c.id ORDER BY m.rowid DESC LIMIT 1) AS last_message
    FROM chats c
    JOIN agents a ON a.id = c.agent_id
    WHERE c.user_id = ? AND (? IS NULL OR c.agent_id = ?)
    ORDER BY c.updated_at DESC, c.rowid DESC`;
  const listSummaryRows = db.prepare<[string, string | null, string | null], ChatSummaryRow>(
    summarySelect,
  );
  const setToken = db.prepare(
    "UPDATE chats SET eve_continuation_token = ?, updated_at = ? WHERE id = ?",
  );
  const setSessionId = db.prepare(
    "UPDATE chats SET eve_session_id = ?, updated_at = ? WHERE id = ?",
  );
  const setOverrideModelStmt = db.prepare(
    "UPDATE chats SET override_model_id = ?, updated_at = ? WHERE id = ?",
  );
  const setTitleStmt = db.prepare("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?");
  const deleteChatStmt = db.prepare("DELETE FROM chats WHERE id = ?");
  const touchChat = db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?");

  const insertMessage = db.prepare(
    "INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  // rowid ordering keeps insertion order even when timestamps collide.
  const listMessages = db.prepare<[string], MessageRow>(
    "SELECT * FROM messages WHERE chat_id = ? ORDER BY rowid ASC",
  );

  const insertEvent = db.prepare(
    "INSERT INTO events (id, chat_id, seq, type, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const listEvents = db.prepare<[string], EventDataRow>(
    "SELECT data_json FROM events WHERE chat_id = ? ORDER BY seq ASC, rowid ASC",
  );

  const upsertRunningTurn = db.prepare(`
    INSERT INTO turns (chat_id, status, error_message, started_at, updated_at)
    VALUES (?, 'running', NULL, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      status = 'running', error_message = NULL, started_at = excluded.started_at, updated_at = excluded.updated_at
  `);
  const setTurnStatus = db.prepare(
    "UPDATE turns SET status = ?, error_message = ?, updated_at = ? WHERE chat_id = ?",
  );
  const listRunningTurns = db.prepare<[], { chat_id: string }>(
    "SELECT chat_id FROM turns WHERE status = 'running'",
  );

  const create = (agentId: AgentId, userId: UserId, title: string): Chat => {
    const id = newId("ChatId");
    const now = nowIso();
    insertChat.run(id, agentId, userId, title, null, now, now);
    return {
      id,
      agentId,
      userId,
      title,
      eveContinuationToken: null,
      overrideModelId: null,
      createdAt: now,
      updatedAt: now,
    };
  };

  const get = (id: ChatId): Result<Chat, AppError> => {
    const row = getRow.get(id);
    return row === undefined ? err(appError("not_found", `chat ${id} not found`)) : ok(mapChatRow(row));
  };

  const getBySessionId = (sessionId: string): Chat | undefined => {
    const row = getBySessionRow.get(sessionId);
    return row === undefined ? undefined : mapChatRow(row);
  };

  const list = (agentId: AgentId): Chat[] => listRows.all(agentId).map(mapChatRow);

  const listByUser = (userId: UserId, agentId?: AgentId): ChatSummary[] =>
    listSummaryRows.all(userId, agentId ?? null, agentId ?? null).map(mapSummaryRow);

  const setContinuationToken = (id: ChatId, token: string): void => {
    setToken.run(token, nowIso(), id);
  };

  const setEveSessionId = (id: ChatId, sessionId: string): void => {
    setSessionId.run(sessionId, nowIso(), id);
  };

  const setOverrideModel = (id: ChatId, modelId: string | null): void => {
    setOverrideModelStmt.run(modelId, nowIso(), id);
  };

  const setTitle = (id: ChatId, title: string): void => {
    setTitleStmt.run(title, nowIso(), id);
  };

  const deleteChat = (id: ChatId): void => {
    deleteChatStmt.run(id);
  };

  const messages: MessagesRepo = {
    append: (chatId: ChatId, role: ChatRole, content: string): Message => {
      const id = newId("MessageId");
      const now = nowIso();
      db.transaction(() => {
        insertMessage.run(id, chatId, role, content, now);
        touchChat.run(now, chatId);
      })();
      return { id, chatId, role, content, createdAt: now };
    },
    list: (chatId: ChatId): Message[] => listMessages.all(chatId).map(mapMessageRow),
  };

  const events: EventsRepo = {
    append: (chatId: ChatId, seq: number, event: ChatStreamEvent): void => {
      insertEvent.run(newId("ChatEventId"), chatId, seq, event.type, JSON.stringify(event), nowIso());
    },
    list: (chatId: ChatId): ChatStreamEvent[] =>
      listEvents.all(chatId).map((row): ChatStreamEvent => {
        // Deserializing our own serialized union; trusted, so no re-validation.
        const parsed: ChatStreamEvent = JSON.parse(row.data_json);
        return parsed;
      }),
  };

  const turns: TurnsRepo = {
    start: (chatId: ChatId): void => {
      const now = nowIso();
      upsertRunningTurn.run(chatId, now, now);
    },
    complete: (chatId: ChatId): void => {
      setTurnStatus.run("completed", null, nowIso(), chatId);
    },
    fail: (chatId: ChatId, message: string): void => {
      setTurnStatus.run("error", message, nowIso(), chatId);
    },
    listRunning: (): ChatId[] => listRunningTurns.all().map((row) => asId("ChatId", row.chat_id)),
  };

  return {
    create,
    get,
    getBySessionId,
    list,
    listByUser,
    setContinuationToken,
    setEveSessionId,
    setOverrideModel,
    setTitle,
    delete: deleteChat,
    messages,
    events,
    turns,
  };
};
