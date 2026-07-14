import type { Sqlite } from "./sqlite";

/**
 * The full schema. Every statement is idempotent (`IF NOT EXISTS`), so applying
 * it on every open is safe and doubles as the migration. `kb_chunks_fts` is a
 * *standalone* FTS5 table (not external-content): rows are written explicitly
 * alongside `kb_chunks`, trading a little duplication for far simpler indexing.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  handle       TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  description     TEXT NOT NULL,
  instructions_md TEXT NOT NULL,
  model_provider  TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  reasoning       TEXT NOT NULL,
  visibility      TEXT NOT NULL,
  forked_from     TEXT REFERENCES agents(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_id);

CREATE TABLE IF NOT EXISTS knowledgebases (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT NOT NULL,
  visibility  TEXT NOT NULL,
  forked_from TEXT REFERENCES knowledgebases(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledgebases_owner ON knowledgebases(owner_id);

CREATE TABLE IF NOT EXISTS kb_documents (
  id               TEXT PRIMARY KEY,
  knowledgebase_id TEXT NOT NULL REFERENCES knowledgebases(id) ON DELETE CASCADE,
  filename         TEXT NOT NULL,
  mime             TEXT NOT NULL,
  byte_length      INTEGER NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_documents_kb ON kb_documents(knowledgebase_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id               TEXT PRIMARY KEY,
  knowledgebase_id TEXT NOT NULL REFERENCES knowledgebases(id) ON DELETE CASCADE,
  document_id      TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  ord              INTEGER NOT NULL,
  text             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_kb ON kb_chunks(knowledgebase_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(document_id);

-- Standalone FTS5 index powering BM25 lexical retrieval. Only \`text\` is
-- indexed; the rest are UNINDEXED payload columns carried for citations and for
-- filtering hits to a set of knowledgebases. Not FK-cascaded, so deletes here
-- are done explicitly by the repository.
CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
  text,
  chunk_id         UNINDEXED,
  knowledgebase_id UNINDEXED,
  document_id      UNINDEXED,
  filename         UNINDEXED,
  ord              UNINDEXED
);

CREATE TABLE IF NOT EXISTS skills (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT NOT NULL,
  skill_md    TEXT NOT NULL,
  visibility  TEXT NOT NULL,
  forked_from TEXT REFERENCES skills(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skills_owner ON skills(owner_id);

CREATE TABLE IF NOT EXISTS skill_resources (
  id       TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  path     TEXT NOT NULL,
  content  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_resources_skill ON skill_resources(skill_id);

CREATE TABLE IF NOT EXISTS agent_knowledgebases (
  agent_id         TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  knowledgebase_id TEXT NOT NULL REFERENCES knowledgebases(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, knowledgebase_id)
);

CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS chats (
  id                    TEXT PRIMARY KEY,
  agent_id              TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  eve_continuation_token TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chats_agent ON chats(agent_id);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  type       TEXT NOT NULL,
  data_json  TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_chat ON events(chat_id);
`;

/**
 * Configure the connection and apply the schema. Idempotent: safe to run on
 * every open. `foreign_keys` is per-connection and must be set before use;
 * WAL improves read/write concurrency for the file-backed DB (a no-op for
 * `:memory:`).
 */
export const migrate = (db: Sqlite): void => {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(
    new Date().toISOString(),
  );
};
