import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatRole, ReasoningEffort, Visibility } from "@xagents/core";

/** Single source of "now" for timestamps: ISO-8601 UTC strings everywhere. */
export const nowIso = (): string => new Date().toISOString();

/**
 * Derive a kebab-case slug from a display name. Names aren't unique and the DB
 * doesn't enforce slug uniqueness, so this is presentational only — good enough
 * to build human-friendly URLs without a separate slug input.
 */
export const slugify = (input: string): string => {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return base.length > 0 ? base : "item";
};

/** Ensure the parent directory of a file-backed DB exists before opening it. */
export const ensureParentDir = (filePath: string): void => {
  mkdirSync(dirname(filePath), { recursive: true });
};

// ---------------------------------------------------------------------------
// Enum guards. Columns holding closed unions are only ever written by this
// package, so an out-of-range value means corruption/programmer error — we
// throw rather than model it as a Result. The literal comparisons also narrow
// the string to the union type, so no `as` cast is needed.
// ---------------------------------------------------------------------------
export const asVisibility = (value: string): Visibility => {
  if (value === "private" || value === "public") return value;
  throw new Error(`invalid visibility in db: ${value}`);
};

export const asChatRole = (value: string): ChatRole => {
  if (value === "user" || value === "assistant" || value === "system") return value;
  throw new Error(`invalid chat role in db: ${value}`);
};

export const asReasoning = (value: string): ReasoningEffort => {
  switch (value) {
    case "provider-default":
    case "none":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value;
    default:
      throw new Error(`invalid reasoning effort in db: ${value}`);
  }
};

/**
 * Turn arbitrary user text into a safe FTS5 MATCH expression. Each alphanumeric
 * run is extracted and double-quoted so FTS5 treats it as a literal term,
 * neutralizing operators (AND/OR/NEAR/`*`/`"`), then OR-joined for recall.
 * Returns `undefined` when the query has no usable terms.
 */
export const toFtsMatch = (query: string): string | undefined => {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (terms === null || terms.length === 0) return undefined;
  return terms.map((t) => `"${t}"`).join(" OR ");
};
