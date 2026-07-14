import {
  appError,
  err,
  newId,
  ok,
  type AgentId,
  type AppError,
  type Chat,
  type ChatId,
  type ChatRole,
  type ChatStreamEvent,
  type Message,
  type Result,
  type UserId,
} from "@xagents/core";
import { nowIso } from "../helpers";
import { mapChatRow, mapMessageRow, type ChatRow, type MessageRow } from "../mappers";
import type { Sqlite } from "../sqlite";

export interface MessagesRepo {
  readonly append: (chatId: ChatId, role: ChatRole, content: string) => Message;
  readonly list: (chatId: ChatId) => Message[];
}

export interface EventsRepo {
  readonly append: (chatId: ChatId, seq: number, event: ChatStreamEvent) => void;
  readonly list: (chatId: ChatId) => ChatStreamEvent[];
}

export interface ChatsRepo {
  readonly create: (agentId: AgentId, userId: UserId, title: string) => Chat;
  readonly get: (id: ChatId) => Result<Chat, AppError>;
  readonly list: (agentId: AgentId) => Chat[];
  readonly setContinuationToken: (id: ChatId, token: string) => void;
  readonly setTitle: (id: ChatId, title: string) => void;
  readonly messages: MessagesRepo;
  readonly events: EventsRepo;
}

interface EventDataRow {
  readonly data_json: string;
}

export const createChatsRepo = (db: Sqlite): ChatsRepo => {
  const insertChat = db.prepare(
    `INSERT INTO chats (id, agent_id, user_id, title, eve_continuation_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const getRow = db.prepare<[string], ChatRow>("SELECT * FROM chats WHERE id = ?");
  const listRows = db.prepare<[string], ChatRow>(
    "SELECT * FROM chats WHERE agent_id = ? ORDER BY updated_at DESC",
  );
  const setToken = db.prepare(
    "UPDATE chats SET eve_continuation_token = ?, updated_at = ? WHERE id = ?",
  );
  const setTitleStmt = db.prepare("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?");
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
      createdAt: now,
      updatedAt: now,
    };
  };

  const get = (id: ChatId): Result<Chat, AppError> => {
    const row = getRow.get(id);
    return row === undefined ? err(appError("not_found", `chat ${id} not found`)) : ok(mapChatRow(row));
  };

  const list = (agentId: AgentId): Chat[] => listRows.all(agentId).map(mapChatRow);

  const setContinuationToken = (id: ChatId, token: string): void => {
    setToken.run(token, nowIso(), id);
  };

  const setTitle = (id: ChatId, title: string): void => {
    setTitleStmt.run(title, nowIso(), id);
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

  return { create, get, list, setContinuationToken, setTitle, messages, events };
};
