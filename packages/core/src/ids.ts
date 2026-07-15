import { randomUUID } from "node:crypto";

/**
 * Branded id types. A plain string can't be assigned to `AgentId` by accident,
 * which keeps ids from being passed to the wrong repository at compile time.
 */
declare const brand: unique symbol;
export type Branded<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Branded<string, "UserId">;
export type AgentId = Branded<string, "AgentId">;
export type KnowledgebaseId = Branded<string, "KnowledgebaseId">;
export type KbDocumentId = Branded<string, "KbDocumentId">;
export type KbChunkId = Branded<string, "KbChunkId">;
export type SkillId = Branded<string, "SkillId">;
export type SkillResourceId = Branded<string, "SkillResourceId">;
export type ChatId = Branded<string, "ChatId">;
export type MessageId = Branded<string, "MessageId">;
export type ChatEventId = Branded<string, "ChatEventId">;
export type RunMetricId = Branded<string, "RunMetricId">;
export type MetricSampleId = Branded<string, "MetricSampleId">;
export type AdminEventId = Branded<string, "AdminEventId">;
export type ProviderModelId = Branded<string, "ProviderModelId">;

const PREFIXES = {
  UserId: "usr",
  AgentId: "agt",
  KnowledgebaseId: "kb",
  KbDocumentId: "doc",
  KbChunkId: "chk",
  SkillId: "skl",
  SkillResourceId: "res",
  ChatId: "cht",
  MessageId: "msg",
  ChatEventId: "evt",
  RunMetricId: "rmt",
  MetricSampleId: "msp",
  AdminEventId: "aev",
  ProviderModelId: "pmd",
} as const;

type IdBrand = keyof typeof PREFIXES;

/** Generate a prefixed, sortable-enough unique id, e.g. `agt_1a2b3c…`. */
export const newId = <B extends IdBrand>(brandName: B): Branded<string, B> =>
  `${PREFIXES[brandName]}_${randomUUID().replace(/-/g, "")}` as Branded<string, B>;

/** Cast a raw string (e.g. from the DB or an HTTP param) into a branded id. */
export const asId = <B extends IdBrand>(_brandName: B, raw: string): Branded<string, B> =>
  raw as Branded<string, B>;
