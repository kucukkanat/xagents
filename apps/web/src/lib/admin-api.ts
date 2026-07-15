import type {
  AdminContentItem,
  AdminEvent,
  AdminOverview,
  AdminProvidersView,
  AdminRuntimeView,
  AdminStreamEvent,
  AdminUser,
  MetricSeries,
  RunMetricsPage,
  Visibility,
} from "@xagents/core";
import { ApiError } from "@/lib/api";

const API_BASE = "/api/admin";

/**
 * Admin transport: every call carries the operator token as a bearer header.
 * A 403 means the token is wrong/expired — the guard catches it and re-prompts.
 */
async function adminRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const headers = {
    ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${token}`,
    ...init?.headers,
  };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("internal", "Network error — is the server running?", 0);
  }
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    try {
      const body: unknown = await res.json();
      if (typeof body === "object" && body !== null && "error" in body) {
        const err = (body as { error?: { message?: string; code?: string } }).error;
        if (typeof err?.message === "string") message = err.message;
      }
    } catch {
      // keep status-derived message
    }
    throw new ApiError("internal", message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const q = (params: Record<string, string | undefined>): string => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, v);
  const str = s.toString();
  return str.length > 0 ? `?${str}` : "";
};

// --- reads -----------------------------------------------------------------
export const getOverview = (t: string): Promise<AdminOverview> => adminRequest(t, "/overview");
export const getRuntime = (t: string): Promise<AdminRuntimeView> => adminRequest(t, "/runtime");
export const getRuns = (
  t: string,
  params: { from?: string; to?: string; agentId?: string; cursor?: string; limit?: string } = {},
): Promise<RunMetricsPage> => adminRequest(t, `/runs${q(params)}`);
export const getSeries = (
  t: string,
  metric: string,
  from?: string,
  to?: string,
): Promise<MetricSeries> => adminRequest(t, `/metrics/series${q({ metric, from, to })}`);
export const getEvents = (t: string, limit?: string): Promise<AdminEvent[]> =>
  adminRequest(t, `/events${q({ limit })}`);
export const getContent = (
  t: string,
  kind: "agents" | "knowledgebases" | "skills" | "chats",
): Promise<AdminContentItem[]> => adminRequest(t, `/content/${kind}`);
export const getUsers = (t: string): Promise<AdminUser[]> => adminRequest(t, "/users");

// --- controls --------------------------------------------------------------
export const stopHost = (t: string, agentId: string): Promise<{ stopped: boolean }> =>
  adminRequest(t, `/hosts/${agentId}/stop`, { method: "POST" });
export const stopAllHosts = (t: string): Promise<{ stopped: number }> =>
  adminRequest(t, "/hosts/stop-all", { method: "POST" });
export const reapSandboxes = (t: string): Promise<{ reaped: number }> =>
  adminRequest(t, "/sandboxes/reap", { method: "POST" });
export const warmSandbox = (t: string): Promise<{ ok: boolean }> =>
  adminRequest(t, "/sandbox/warm", { method: "POST" });
export const cancelTurn = (t: string, chatId: string): Promise<{ cancelled: boolean }> =>
  adminRequest(t, `/chats/${chatId}/cancel`, { method: "POST" });

// --- moderation ------------------------------------------------------------
export const setVisibility = (
  t: string,
  kind: "agent" | "knowledgebase" | "skill",
  id: string,
  visibility: Visibility,
): Promise<{ ok: boolean }> =>
  adminRequest(t, `/content/${kind}/${id}/visibility`, {
    method: "PATCH",
    body: JSON.stringify({ visibility }),
  });
export const deleteContent = (
  t: string,
  kind: AdminContentItem["kind"],
  id: string,
): Promise<{ ok: boolean }> => adminRequest(t, `/content/${kind}/${id}`, { method: "DELETE" });
export const deleteUser = (t: string, id: string): Promise<{ ok: boolean }> =>
  adminRequest(t, `/users/${id}`, { method: "DELETE" });

// --- providers & models -----------------------------------------------------
const jsonBody = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const getProviders = (t: string): Promise<AdminProvidersView> => adminRequest(t, "/providers");

export const createProvider = (
  t: string,
  input: { id: string; name: string; adapterKind: string; settings: Record<string, string> },
): Promise<AdminProvidersView> => adminRequest(t, "/providers", { method: "POST", ...jsonBody(input) });

export const updateProvider = (
  t: string,
  id: string,
  patch: { name?: string; enabled?: boolean; settings?: Record<string, string> },
): Promise<AdminProvidersView> => adminRequest(t, `/providers/${id}`, { method: "PATCH", ...jsonBody(patch) });

export const deleteProvider = (t: string, id: string): Promise<AdminProvidersView> =>
  adminRequest(t, `/providers/${id}`, { method: "DELETE" });

export const setProviderSecrets = (
  t: string,
  id: string,
  secrets: Record<string, string>,
): Promise<AdminProvidersView> =>
  adminRequest(t, `/providers/${id}/secrets`, { method: "PUT", ...jsonBody({ secrets }) });

export const testProvider = (t: string, id: string): Promise<{ ok: boolean; error?: string }> =>
  adminRequest(t, `/providers/${id}/test`, { method: "POST" });

export const createModel = (
  t: string,
  providerId: string,
  input: {
    modelId: string;
    label: string;
    supportsReasoning: boolean;
    inputPer1M: number | null;
    outputPer1M: number | null;
  },
): Promise<AdminProvidersView> =>
  adminRequest(t, `/providers/${providerId}/models`, { method: "POST", ...jsonBody(input) });

export const updateModel = (
  t: string,
  modelId: string,
  patch: {
    label?: string;
    enabled?: boolean;
    supportsReasoning?: boolean;
    inputPer1M?: number | null;
    outputPer1M?: number | null;
    isDefault?: boolean;
    sortOrder?: number;
  },
): Promise<AdminProvidersView> =>
  adminRequest(t, `/providers/models/${modelId}`, { method: "PATCH", ...jsonBody(patch) });

export const deleteModel = (t: string, modelId: string): Promise<AdminProvidersView> =>
  adminRequest(t, `/providers/models/${modelId}`, { method: "DELETE" });

/**
 * Live feed of gauge samples + lifecycle/audit events over SSE. Reuses the same
 * bearer token; the caller drives it with an AbortController and folds each
 * event into dashboard state.
 */
export async function* streamAdmin(
  token: string,
  signal: AbortSignal,
): AsyncGenerator<AdminStreamEvent> {
  const res = await fetch(`${API_BASE}/stream`, {
    headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) throw new ApiError("internal", "Admin stream failed", res.status);
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
      if (payload.trim()) yield JSON.parse(payload) as AdminStreamEvent;
      sep = buffer.indexOf("\n\n");
    }
  }
}
