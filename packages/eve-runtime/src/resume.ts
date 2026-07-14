import type { EveResume } from "./types";

/** Persist eve's resume handle as an opaque string on the chat. */
export const encodeResume = (r: EveResume): string => JSON.stringify(r);

export const decodeResume = (raw: string | null): EveResume | null => {
  if (raw === null || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EveResume>;
    return typeof parsed.sessionId === "string" && typeof parsed.continuationToken === "string"
      ? {
          sessionId: parsed.sessionId,
          continuationToken: parsed.continuationToken,
          nextIndex: typeof parsed.nextIndex === "number" ? parsed.nextIndex : 0,
        }
      : null;
  } catch {
    return null;
  }
};
