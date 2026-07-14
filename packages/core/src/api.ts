import type { AppErrorCode } from "./result";
import type {
  Agent,
  Chat,
  Knowledgebase,
  KbDocument,
  Message,
  Skill,
} from "./entities";
import type { ChatStreamEvent } from "./events";
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
  /** Display name of the agent this chat belongs to — powers the chat header identity. */
  readonly agentName: string;
  readonly messages: readonly Message[];
  /**
   * Events of a turn that hasn't produced a final assistant message yet — a
   * turn running right now, or one interrupted by a crash/restart. Lets a fresh
   * page load reconstruct the in-progress assistant bubble instead of a blank.
   */
  readonly pending: readonly ChatStreamEvent[];
  /** True when a turn is actively running for this chat on the server. */
  readonly streaming: boolean;
}

/** A chat enriched for history lists: the agent it belongs to plus a preview. */
export interface ChatSummary {
  readonly chat: Chat;
  readonly agentName: string;
  readonly messageCount: number;
  readonly lastMessagePreview: string | null;
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
