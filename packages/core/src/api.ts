import type { AppErrorCode } from "./result";
import type {
  Agent,
  Chat,
  Knowledgebase,
  KbDocument,
  Message,
  Skill,
} from "./entities";
import type { ModelOption } from "./providers";

/** Uniform JSON error body returned by the API. */
export interface ApiErrorBody {
  readonly error: { readonly code: AppErrorCode; readonly message: string };
}

/** What a listed/marketplace card needs. `entity` distinguishes the three kinds. */
export interface GalleryItem {
  readonly kind: "agent" | "knowledgebase" | "skill";
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ownerHandle: string;
  readonly updatedAt: string;
}

export interface AgentDetail {
  readonly agent: Agent;
  readonly knowledgebases: readonly Knowledgebase[];
  readonly skills: readonly Skill[];
}

export interface KnowledgebaseDetail {
  readonly knowledgebase: Knowledgebase;
  readonly documents: readonly KbDocument[];
}

export interface ChatWithMessages {
  readonly chat: Chat;
  readonly messages: readonly Message[];
}

/** Response of `GET /api/config` — drives the model picker etc. */
export interface ClientConfig {
  readonly models: readonly ModelOption[];
  readonly currentUser: { readonly id: string; readonly handle: string; readonly displayName: string };
  readonly sandboxBackend: string;
}

/** Base path for all HTTP routes. */
export const API_BASE = "/api";

/** SSE endpoint for streaming a chat turn. */
export const chatStreamPath = (chatId: string): string =>
  `${API_BASE}/chats/${chatId}/stream`;
