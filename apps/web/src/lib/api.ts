import type {
  Agent,
  AgentDetail,
  ApiErrorBody,
  AppErrorCode,
  Chat,
  ChatStreamEvent,
  ChatWithMessages,
  ClientConfig,
  CreateAgentInput,
  CreateChatInput,
  CreateKnowledgebaseInput,
  CreateSkillInput,
  GalleryItem,
  KbDocument,
  Knowledgebase,
  KnowledgebaseDetail,
  SendMessageInput,
  Skill,
  UpdateAgentInput,
} from "@xagents/core";

const API_BASE = "/api";

/** A typed, explicit transport failure. UI catches this to show a toast. */
export class ApiError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const isApiErrorBody = (v: unknown): v is ApiErrorBody =>
  typeof v === "object" &&
  v !== null &&
  "error" in v &&
  typeof (v as ApiErrorBody).error?.message === "string";

async function toApiError(res: Response): Promise<ApiError> {
  let code: AppErrorCode = "internal";
  let message = res.statusText || "Request failed";
  try {
    const body: unknown = await res.json();
    if (isApiErrorBody(body)) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    // non-JSON error body; keep the status-derived message
  }
  return new ApiError(code, message, res.status);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData sets its own multipart boundary — never force a JSON content-type on it.
  const isForm = init?.body instanceof FormData;
  const headers = {
    ...(isForm ? {} : { "Content-Type": "application/json" }),
    ...init?.headers,
  };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("internal", "Network error — is the server running?", 0);
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

// --- Config ----------------------------------------------------------------
export const getConfig = (): Promise<ClientConfig> => request("/config");

// --- Gallery ---------------------------------------------------------------
export const getGallery = (kind?: GalleryItem["kind"]): Promise<GalleryItem[]> =>
  request(`/gallery${kind ? `?kind=${kind}` : ""}`);

// --- Agents ----------------------------------------------------------------
export const listAgents = (): Promise<Agent[]> => request("/agents");
export const getAgent = (id: string): Promise<AgentDetail> => request(`/agents/${id}`);
export const createAgent = (input: CreateAgentInput): Promise<Agent> =>
  request("/agents", { method: "POST", ...json(input) });
export const updateAgent = (id: string, input: UpdateAgentInput): Promise<Agent> =>
  request(`/agents/${id}`, { method: "PATCH", ...json(input) });
export const deleteAgent = (id: string): Promise<void> =>
  request(`/agents/${id}`, { method: "DELETE" });
export const cloneAgent = (id: string): Promise<Agent> =>
  request(`/agents/${id}/clone`, { method: "POST" });

// --- Knowledgebases --------------------------------------------------------
export const listKnowledgebases = (): Promise<Knowledgebase[]> => request("/knowledgebases");
export const getKnowledgebase = (id: string): Promise<KnowledgebaseDetail> =>
  request(`/knowledgebases/${id}`);
export const createKnowledgebase = (
  input: CreateKnowledgebaseInput,
): Promise<Knowledgebase> => request("/knowledgebases", { method: "POST", ...json(input) });
export const deleteKnowledgebase = (id: string): Promise<void> =>
  request(`/knowledgebases/${id}`, { method: "DELETE" });
export const cloneKnowledgebase = (id: string): Promise<Knowledgebase> =>
  request(`/knowledgebases/${id}/clone`, { method: "POST" });
export const uploadDocument = (kbId: string, file: File): Promise<KbDocument> => {
  const form = new FormData();
  form.append("file", file);
  return request(`/knowledgebases/${kbId}/documents`, { method: "POST", body: form });
};
export const deleteDocument = (kbId: string, docId: string): Promise<void> =>
  request(`/knowledgebases/${kbId}/documents/${docId}`, { method: "DELETE" });

// --- Skills ----------------------------------------------------------------
export const listSkills = (): Promise<Skill[]> => request("/skills");
export const getSkill = (id: string): Promise<Skill> => request(`/skills/${id}`);
export const createSkill = (input: CreateSkillInput): Promise<Skill> =>
  request("/skills", { method: "POST", ...json(input) });
export const updateSkill = (id: string, input: Partial<CreateSkillInput>): Promise<Skill> =>
  request(`/skills/${id}`, { method: "PATCH", ...json(input) });
export const deleteSkill = (id: string): Promise<void> =>
  request(`/skills/${id}`, { method: "DELETE" });
export const cloneSkill = (id: string): Promise<Skill> =>
  request(`/skills/${id}/clone`, { method: "POST" });

// --- Chats -----------------------------------------------------------------
export const listChats = (agentId: string): Promise<Chat[]> =>
  request(`/chats?agentId=${agentId}`);
export const getChat = (id: string): Promise<ChatWithMessages> => request(`/chats/${id}`);
export const createChat = (input: CreateChatInput): Promise<Chat> =>
  request("/chats", { method: "POST", ...json(input) });

/**
 * Streams a chat turn. `EventSource` can't POST, so we POST with fetch, read the
 * body as a stream, split SSE frames on the blank-line delimiter, strip the
 * `data:` prefix, and parse each frame into a `ChatStreamEvent`.
 */
export async function* streamChatMessage(
  chatId: string,
  input: SendMessageInput,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch(`${API_BASE}/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw await toApiError(res);
  if (!res.body) throw new ApiError("internal", "Stream body missing", res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const payload = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s?/, ""))
        .join("\n");
      if (payload.trim()) yield JSON.parse(payload) as ChatStreamEvent;
      sep = buffer.indexOf("\n\n");
    }
  }
}
