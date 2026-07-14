import { type AppError, type Result, appError, err, ok } from "@xagents/core";
import type { EveResume } from "./types";

export interface TurnStart {
  readonly sessionId: string;
  readonly continuationToken: string;
  /** Event index this turn's stream starts at. */
  readonly startIndex: number;
}

/**
 * Post a user message to a running eve host (new session or follow-up) and
 * return the ids needed to open the event stream. Verified against eve 0.23.0:
 *  - new:    POST /eve/v1/session      { message }            -> { sessionId, continuationToken }
 *  - resume: POST /eve/v1/session/:id  { continuationToken, message }
 */
export const postMessage = async (
  origin: string,
  resume: EveResume | null,
  message: string,
): Promise<Result<TurnStart, AppError>> => {
  try {
    const posted =
      resume === null
        ? await startSession(origin, message)
        : await appendSession(origin, resume, message);
    if (!posted.ok) return posted;
    return ok({ ...posted.value, startIndex: resume?.nextIndex ?? 0 });
  } catch (cause) {
    return err(appError("agent_runtime_error", "eve host request failed", cause));
  }
};

/** Open the NDJSON event stream from a given event index. */
export const openStream = async (
  origin: string,
  sessionId: string,
  startIndex: number,
): Promise<Result<ReadableStream<Uint8Array>, AppError>> => {
  try {
    const res = await fetch(`${origin}/eve/v1/session/${sessionId}/stream?startIndex=${startIndex}`, {
      headers: { accept: "application/x-ndjson" },
    });
    if (!res.ok || res.body === null) {
      return err(appError("agent_runtime_error", `eve stream failed (${res.status})`));
    }
    return ok(res.body);
  } catch (cause) {
    return err(appError("agent_runtime_error", "eve stream request failed", cause));
  }
};

const startSession = async (
  origin: string,
  message: string,
): Promise<Result<{ sessionId: string; continuationToken: string }, AppError>> => {
  const res = await fetch(`${origin}/eve/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const sessionId = pick(body.sessionId) ?? res.headers.get("x-eve-session-id") ?? undefined;
  const continuationToken = pick(body.continuationToken);
  if (sessionId === undefined || continuationToken === undefined) {
    return err(appError("agent_runtime_error", `eve session response missing ids (${res.status})`));
  }
  return ok({ sessionId, continuationToken });
};

const appendSession = async (
  origin: string,
  resume: EveResume,
  message: string,
): Promise<Result<{ sessionId: string; continuationToken: string }, AppError>> => {
  const res = await fetch(`${origin}/eve/v1/session/${resume.sessionId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ continuationToken: resume.continuationToken, message }),
  });
  if (!res.ok) {
    return err(appError("agent_runtime_error", `eve follow-up failed (${res.status})`));
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const continuationToken = pick(body.continuationToken) ?? resume.continuationToken;
  return ok({ sessionId: resume.sessionId, continuationToken });
};

const pick = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
