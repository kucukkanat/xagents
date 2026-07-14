import { z } from "zod";
import type {
  AgentId,
  ChatId,
  KbChunkId,
  KbDocumentId,
  KnowledgebaseId,
  MessageId,
  SkillId,
  SkillResourceId,
  UserId,
} from "./ids";
import { ProviderIdSchema, ReasoningEffortSchema } from "./providers";

/** Public gallery vs private to the owner. */
export const VisibilitySchema = z.enum(["private", "public"]);
export type Visibility = z.infer<typeof VisibilitySchema>;

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case");
const name = z.string().min(1).max(120);

// ---------------------------------------------------------------------------
// User (auth is stubbed to a single seeded user; schema is multi-user-ready)
// ---------------------------------------------------------------------------
export interface User {
  readonly id: UserId;
  readonly handle: string;
  readonly displayName: string;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------
export interface Agent {
  readonly id: AgentId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly instructionsMd: string;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly reasoning: z.infer<typeof ReasoningEffortSchema>;
  readonly visibility: Visibility;
  readonly forkedFrom: AgentId | null;
  readonly knowledgebaseIds: readonly KnowledgebaseId[];
  readonly skillIds: readonly SkillId[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const CreateAgentInput = z.object({
  name,
  description: z.string().max(500).default(""),
  instructionsMd: z.string().min(1),
  modelProvider: ProviderIdSchema,
  modelId: z.string().min(1),
  reasoning: ReasoningEffortSchema.default("provider-default"),
  visibility: VisibilitySchema.default("private"),
  knowledgebaseIds: z.array(z.string()).default([]),
  skillIds: z.array(z.string()).default([]),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInput>;

export const UpdateAgentInput = CreateAgentInput.partial();
export type UpdateAgentInput = z.infer<typeof UpdateAgentInput>;

// ---------------------------------------------------------------------------
// Knowledgebase (lexical RAG: documents -> chunks -> FTS5/BM25)
// ---------------------------------------------------------------------------
export interface Knowledgebase {
  readonly id: KnowledgebaseId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly visibility: Visibility;
  readonly forkedFrom: KnowledgebaseId | null;
  readonly documentCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KbDocument {
  readonly id: KbDocumentId;
  readonly knowledgebaseId: KnowledgebaseId;
  readonly filename: string;
  readonly mime: string;
  readonly byteLength: number;
  readonly chunkCount: number;
  readonly createdAt: string;
}

export interface KbChunk {
  readonly id: KbChunkId;
  readonly knowledgebaseId: KnowledgebaseId;
  readonly documentId: KbDocumentId;
  readonly ord: number;
  readonly text: string;
}

/** A retrieval hit with its BM25 score and a citation handle. */
export interface KbSearchHit {
  readonly chunkId: KbChunkId;
  readonly documentId: KbDocumentId;
  readonly filename: string;
  readonly ord: number;
  readonly text: string;
  readonly score: number;
  /** e.g. `report.md:3` — rendered as an inline citation. */
  readonly citation: string;
}

export const CreateKnowledgebaseInput = z.object({
  name,
  description: z.string().max(500).default(""),
  visibility: VisibilitySchema.default("private"),
});
export type CreateKnowledgebaseInput = z.infer<typeof CreateKnowledgebaseInput>;

// ---------------------------------------------------------------------------
// Skill (Anthropic-style: SKILL.md + bundled resources)
// ---------------------------------------------------------------------------
export interface Skill {
  readonly id: SkillId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  /** Full SKILL.md content (frontmatter + body). */
  readonly skillMd: string;
  readonly visibility: Visibility;
  readonly forkedFrom: SkillId | null;
  readonly resourceCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SkillResource {
  readonly id: SkillResourceId;
  readonly skillId: SkillId;
  /** Path relative to the skill root, e.g. `scripts/run.py`. */
  readonly path: string;
  readonly content: string;
}

/** Parsed SKILL.md frontmatter (Anthropic Agent Skill shape). */
export const SkillFrontmatterSchema = z.object({
  name,
  description: z.string().min(1).max(1024),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export const CreateSkillInput = z.object({
  name,
  description: z.string().max(500).default(""),
  skillMd: z.string().min(1),
  visibility: VisibilitySchema.default("private"),
});
export type CreateSkillInput = z.infer<typeof CreateSkillInput>;

// ---------------------------------------------------------------------------
// Chat + messages
// ---------------------------------------------------------------------------
export const ChatRoleSchema = z.enum(["user", "assistant", "system"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export interface Chat {
  readonly id: ChatId;
  readonly agentId: AgentId;
  readonly userId: UserId;
  readonly title: string;
  /** eve resume handle for follow-up turns; null before the first turn. */
  readonly eveContinuationToken: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Message {
  readonly id: MessageId;
  readonly chatId: ChatId;
  readonly role: ChatRole;
  readonly content: string;
  readonly createdAt: string;
}

export const SendMessageInput = z.object({
  message: z.string().min(1),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

export const CreateChatInput = z.object({
  agentId: z.string().min(1),
  title: z.string().max(120).optional(),
});
export type CreateChatInput = z.infer<typeof CreateChatInput>;

/** Rename a conversation from the chat header / history row. */
export const UpdateChatInput = z.object({
  title: z.string().min(1).max(120),
});
export type UpdateChatInput = z.infer<typeof UpdateChatInput>;

export { slug as slugSchema };
