import { type AppError, type Result, appError, err, ok } from "@xagents/core";
import type { EveResume } from "./types";

interface PostedTurn {
  readonly sessionId: string;
  readonly continuationToken: string;
  /** Event index this turn's stream starts at (for computing the next cursor). */
  readonly startIndex: number;
  readonly stream: ReadableStream<Uint8Array>;
}

/**
 * Starts (or resumes) a turn against a running eve host and returns the live
 * NDJSON event stream. Endpoints/shape verified against eve 0.23.0:
 *  - new:    POST /eve/v1/session               { message }  -> { sessionId, continuationToken }
 *  - resume: POST /eve/v1/session/:id           { continuationToken, message }
 *  - stream: GET  /eve/v1/session/:id/stream    -> application/x-ndjson
 */
export const postTurn = async (
  origin: string,
  resume: EveResume | null,
  message: string,
): Promise<Result<PostedTurn, AppError>> => {
  try {
    const posted = resume === null
      ? await startSession(origin, message)
      : await appendSession(origin, resume, message);
    if (!posted.ok) return posted;

    // Resume from the cursor so a replayed stream doesn't re-emit prior turns.
    const startIndex = resume?.nextIndex ?? 0;
    const streamRes = await fetch(
      `${origin}/eve/v1/session/${posted.value.sessionId}/stream?startIndex=${startIndex}`,
      { headers: { accept: "application/x-ndjson" } },
    );
    if (!streamRes.ok || streamRes.body === null) {
      return err(appError("agent_runtime_error", `eve stream failed (${streamRes.status})`));
    }
    return ok({ ...posted.value, startIndex, stream: streamRes.body });
  } catch (cause) {
    return err(appError("agent_runtime_error", "eve host request failed", cause));
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
  // The token may rotate each turn; fall back to the prior one if unchanged.
  const continuationToken = pick(body.continuationToken) ?? resume.continuationToken;
  return ok({ sessionId: resume.sessionId, continuationToken });
};

const pick = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
