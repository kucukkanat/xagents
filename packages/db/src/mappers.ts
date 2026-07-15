import {
  asId,
  type Agent,
  type Chat,
  type KbDocument,
  type KbSearchHit,
  type Knowledgebase,
  type Message,
  type Skill,
  type SkillResource,
  type User,
} from "@xagents/core";
import { asChatRole, asReasoning, asVisibility } from "./helpers";

// ---------------------------------------------------------------------------
// Row shapes. better-sqlite3 doesn't validate the `Result` generic at runtime,
// so these describe the columns our own SQL selects — the trust boundary is
// that only this package writes these tables.
// ---------------------------------------------------------------------------
export interface UserRow {
  readonly id: string;
  readonly handle: string;
  readonly display_name: string;
  readonly created_at: string;
}

export interface AgentRow {
  readonly id: string;
  readonly owner_id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly instructions_md: string;
  readonly model_provider: string;
  readonly model_id: string;
  readonly reasoning: string;
  readonly visibility: string;
  readonly forked_from: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface KnowledgebaseRow {
  readonly id: string;
  readonly owner_id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly visibility: string;
  readonly forked_from: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly document_count: number;
}

export interface KbDocumentRow {
  readonly id: string;
  readonly knowledgebase_id: string;
  readonly filename: string;
  readonly mime: string;
  readonly byte_length: number;
  readonly created_at: string;
  readonly chunk_count: number;
}

export interface KbSearchRow {
  readonly chunk_id: string;
  readonly document_id: string;
  readonly filename: string;
  readonly ord: number;
  readonly text: string;
  readonly score: number;
}

export interface SkillRow {
  readonly id: string;
  readonly owner_id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly skill_md: string;
  readonly visibility: string;
  readonly forked_from: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly resource_count: number;
}

export interface SkillResourceRow {
  readonly id: string;
  readonly skill_id: string;
  readonly path: string;
  readonly content: string;
}

export interface ChatRow {
  readonly id: string;
  readonly agent_id: string;
  readonly user_id: string;
  readonly title: string;
  readonly eve_continuation_token: string | null;
  readonly override_model_id: string | null;
  /** eve session backing this chat; internal (not surfaced on the `Chat` type). */
  readonly eve_session_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MessageRow {
  readonly id: string;
  readonly chat_id: string;
  readonly role: string;
  readonly content: string;
  readonly created_at: string;
}

// ---------------------------------------------------------------------------
// SELECT fragments. Counts are computed as correlated subqueries so a single
// row read carries the aggregate the domain type exposes.
// ---------------------------------------------------------------------------
export const AGENT_SELECT = "SELECT * FROM agents";

export const KB_SELECT = `SELECT k.*,
  (SELECT COUNT(*) FROM kb_documents d WHERE d.knowledgebase_id = k.id) AS document_count
  FROM knowledgebases k`;

export const DOC_SELECT = `SELECT d.*,
  (SELECT COUNT(*) FROM kb_chunks c WHERE c.document_id = d.id) AS chunk_count
  FROM kb_documents d`;

export const SKILL_SELECT = `SELECT s.*,
  (SELECT COUNT(*) FROM skill_resources r WHERE r.skill_id = s.id) AS resource_count
  FROM skills s`;

// ---------------------------------------------------------------------------
// Row -> domain mappers.
// ---------------------------------------------------------------------------
export const mapUserRow = (row: UserRow): User => ({
  id: asId("UserId", row.id),
  handle: row.handle,
  displayName: row.display_name,
  createdAt: row.created_at,
});

export const mapAgentRow = (
  row: AgentRow,
  knowledgebaseIds: readonly string[],
  skillIds: readonly string[],
): Agent => ({
  id: asId("AgentId", row.id),
  ownerId: asId("UserId", row.owner_id),
  name: row.name,
  slug: row.slug,
  description: row.description,
  instructionsMd: row.instructions_md,
  modelProvider: row.model_provider,
  modelId: row.model_id,
  reasoning: asReasoning(row.reasoning),
  visibility: asVisibility(row.visibility),
  forkedFrom: row.forked_from === null ? null : asId("AgentId", row.forked_from),
  knowledgebaseIds: knowledgebaseIds.map((k) => asId("KnowledgebaseId", k)),
  skillIds: skillIds.map((s) => asId("SkillId", s)),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapKnowledgebaseRow = (row: KnowledgebaseRow): Knowledgebase => ({
  id: asId("KnowledgebaseId", row.id),
  ownerId: asId("UserId", row.owner_id),
  name: row.name,
  slug: row.slug,
  description: row.description,
  visibility: asVisibility(row.visibility),
  forkedFrom: row.forked_from === null ? null : asId("KnowledgebaseId", row.forked_from),
  documentCount: row.document_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapKbDocumentRow = (row: KbDocumentRow): KbDocument => ({
  id: asId("KbDocumentId", row.id),
  knowledgebaseId: asId("KnowledgebaseId", row.knowledgebase_id),
  filename: row.filename,
  mime: row.mime,
  byteLength: row.byte_length,
  chunkCount: row.chunk_count,
  createdAt: row.created_at,
});

export const mapKbSearchRow = (row: KbSearchRow): KbSearchHit => ({
  chunkId: asId("KbChunkId", row.chunk_id),
  documentId: asId("KbDocumentId", row.document_id),
  filename: row.filename,
  ord: row.ord,
  text: row.text,
  score: row.score,
  citation: `${row.filename}:${row.ord}`,
});

export const mapSkillRow = (row: SkillRow): Skill => ({
  id: asId("SkillId", row.id),
  ownerId: asId("UserId", row.owner_id),
  name: row.name,
  slug: row.slug,
  description: row.description,
  skillMd: row.skill_md,
  visibility: asVisibility(row.visibility),
  forkedFrom: row.forked_from === null ? null : asId("SkillId", row.forked_from),
  resourceCount: row.resource_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapSkillResourceRow = (row: SkillResourceRow): SkillResource => ({
  id: asId("SkillResourceId", row.id),
  skillId: asId("SkillId", row.skill_id),
  path: row.path,
  content: row.content,
});

export const mapChatRow = (row: ChatRow): Chat => ({
  id: asId("ChatId", row.id),
  agentId: asId("AgentId", row.agent_id),
  userId: asId("UserId", row.user_id),
  title: row.title,
  eveContinuationToken: row.eve_continuation_token,
  overrideModelId: row.override_model_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapMessageRow = (row: MessageRow): Message => ({
  id: asId("MessageId", row.id),
  chatId: asId("ChatId", row.chat_id),
  role: asChatRole(row.role),
  content: row.content,
  createdAt: row.created_at,
});
