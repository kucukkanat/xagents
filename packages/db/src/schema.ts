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
  -- Per-chat model hot-swap: a model id overriding the agent's default for this
  -- conversation, or NULL to use the agent's model. \`eve_session_id\` is the eve
  -- session backing this chat, captured after the first turn so the agent's
  -- dynamic-model resolver can look this chat's override up by session id.
  override_model_id     TEXT,
  eve_session_id        TEXT,
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

-- Durable record of turn progress, independent of the in-process turn hub
-- (apps/server/src/turns.ts). Written before a turn's background work starts
-- and finalized when it ends, so a process that starts up mid-turn (after a
-- crash or restart of the *previous* process) can tell "running" apart from
-- "already finished" and reconcile anything left dangling.
CREATE TABLE IF NOT EXISTS turns (
  chat_id       TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,
  error_message TEXT,
  started_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Append-only per-turn telemetry for the admin console. Distinct from \`turns\`
-- (which is PK'd on chat_id and only holds the latest turn): this keeps every
-- turn's timing/tokens/cost as history. \`agent_id\`/\`model_id\` are denormalized
-- so a row survives its agent being deleted. Token/cost columns are nullable —
-- eve does not always report usage, and the run is still recorded without it.
CREATE TABLE IF NOT EXISTS run_metrics (
  id                TEXT PRIMARY KEY,
  chat_id           TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  model_provider    TEXT NOT NULL,
  model_id          TEXT NOT NULL,
  status            TEXT NOT NULL,
  error_message     TEXT,
  boot_ms           INTEGER,
  ttft_ms           INTEGER,
  duration_ms       INTEGER NOT NULL,
  tool_calls        INTEGER NOT NULL DEFAULT 0,
  sandbox_calls     INTEGER NOT NULL DEFAULT 0,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  total_tokens      INTEGER,
  cost_usd          REAL,
  started_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_metrics_created ON run_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_run_metrics_agent ON run_metrics(agent_id);

-- Long/narrow gauge history (one row per metric per sample tick) so adding a
-- new gauge never needs a migration.
CREATE TABLE IF NOT EXISTS metric_samples (
  id     TEXT PRIMARY KEY,
  ts     TEXT NOT NULL,
  metric TEXT NOT NULL,
  value  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metric_samples_metric_ts ON metric_samples(metric, ts);

-- Unified system-lifecycle + operator-action audit trail (\`actor\` distinguishes
-- \`system\` events emitted by the supervisor from \`admin\` actions in the console).
CREATE TABLE IF NOT EXISTS admin_events (
  id          TEXT PRIMARY KEY,
  ts          TEXT NOT NULL,
  kind        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  target      TEXT,
  detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_events_ts ON admin_events(ts);

-- Admin-managed LLM providers. \`secrets_json\` holds AES-256-GCM-sealed API keys
-- (field -> SealedSecret) — the DB never sees plaintext or the master key;
-- \`secret_hints_json\` carries last-4 hints so the console can render "••••1234"
-- without a decrypt. \`settings_json\` is non-secret config (base URL, region…).
CREATE TABLE IF NOT EXISTS providers (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  adapter_kind      TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 0,
  settings_json     TEXT NOT NULL DEFAULT '{}',
  secrets_json      TEXT NOT NULL DEFAULT '{}',
  secret_hints_json TEXT NOT NULL DEFAULT '{}',
  test_status       TEXT NOT NULL DEFAULT 'untested',
  test_error        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- Models an agent may select, scoped to a provider. Pricing is nullable (unknown
-- price => cost simply not reported). A single row across the table may be the
-- platform default (\`is_default\`); the picker orders by (\`sort_order\`, label).
CREATE TABLE IF NOT EXISTS provider_models (
  id                 TEXT PRIMARY KEY,
  provider_id        TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id           TEXT NOT NULL,
  label              TEXT NOT NULL,
  enabled            INTEGER NOT NULL DEFAULT 1,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,
  input_per_1m       REAL,
  output_per_1m      REAL,
  is_default         INTEGER NOT NULL DEFAULT 0,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE(provider_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);
`;

/**
 * Configure the connection and apply the schema. Idempotent: safe to run on
 * every open. `foreign_keys` is per-connection and must be set before use;
 * WAL improves read/write concurrency for the file-backed DB (a no-op for
 * `:memory:`).
 */
/** Add a column to an existing table only if it is missing. `CREATE TABLE IF NOT
 *  EXISTS` never alters an existing table, so additive columns need this for DBs
 *  created before the column existed. Idempotent: a no-op once the column is present. */
const addColumnIfMissing = (db: Sqlite, table: string, column: string, ddl: string): void => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { readonly name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
};

export const migrate = (db: Sqlite): void => {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  // Additive columns for the per-chat model hot-swap, for DBs predating them.
  // These run before any index on them: on an existing DB, `CREATE TABLE IF NOT
  // EXISTS` above is a no-op, so the columns wouldn't exist yet for the index.
  addColumnIfMissing(db, "chats", "override_model_id", "override_model_id TEXT");
  addColumnIfMissing(db, "chats", "eve_session_id", "eve_session_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_chats_session ON chats(eve_session_id)");
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (3, ?)").run(
    new Date().toISOString(),
  );
};
