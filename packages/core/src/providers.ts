import { z } from "zod";
import { AdapterKindSchema, type AdapterDescriptor, type ProviderPreset } from "./provider-adapters";

/**
 * Provider/model configuration types. Unlike the MVP (a hard-coded catalogue),
 * the enabled providers and models are now admin-managed and persisted; this
 * module holds the shared wire shapes and validation, and the DB/registry own
 * the data. `ModelOption` is deliberately unchanged so the client model picker
 * keeps working against `GET /api/config` without edits.
 */

export const ReasoningEffortSchema = z.enum([
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

/** USD prices per 1M tokens, used to estimate per-turn cost for monitoring. */
export interface ModelPricing {
  readonly inputPer1M: number;
  readonly outputPer1M: number;
}

/** The picker-facing shape of one enabled model (client `GET /api/config`). */
export interface ModelOption {
  readonly provider: string;
  /** Model id as the provider's SDK expects it. */
  readonly modelId: string;
  /** Human-facing label for the picker. */
  readonly label: string;
  /** Whether this model supports a reasoning/thinking effort control. */
  readonly supportsReasoning: boolean;
  /** Token pricing for cost estimation; omit when unknown (cost then unreported). */
  readonly pricing?: ModelPricing;
}

/**
 * Estimated USD cost of a turn from its token counts, or `undefined` when the
 * model has no known pricing. Pure — the single place cost math lives.
 */
export const costUsd = (
  pricing: ModelPricing | undefined,
  promptTokens: number,
  completionTokens: number,
): number | undefined =>
  pricing === undefined
    ? undefined
    : (promptTokens / 1_000_000) * pricing.inputPer1M +
      (completionTokens / 1_000_000) * pricing.outputPer1M;

// ---------------------------------------------------------------------------
// Admin-facing config shapes (no secrets ever cross the wire in cleartext).
// ---------------------------------------------------------------------------

/** State of one configurable secret field: whether set, and a masked hint. */
export interface SecretState {
  readonly configured: boolean;
  /** Last-4 hint (e.g. "1234"), or null when not set / too short to hint. */
  readonly hint: string | null;
}

export type ProviderTestStatus = "ok" | "failed" | "untested";

/** A provider as the admin console sees it — settings + which secrets are set. */
export interface ProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly adapterKind: z.infer<typeof AdapterKindSchema>;
  readonly enabled: boolean;
  readonly settings: Readonly<Record<string, string>>;
  readonly secrets: Readonly<Record<string, SecretState>>;
  readonly testStatus: ProviderTestStatus;
  readonly testError: string | null;
  /** Number of agents currently using this provider (drives the delete warning). */
  readonly usage: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A model row as the admin console sees it (full CRUD surface). */
export interface ProviderModelConfig {
  readonly id: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly supportsReasoning: boolean;
  readonly pricing: ModelPricing | null;
  readonly isDefault: boolean;
  readonly sortOrder: number;
  /** Number of agents currently using this exact model. */
  readonly usage: number;
}

/** The full payload for the admin Providers tab. */
export interface AdminProvidersView {
  readonly providers: readonly ProviderConfig[];
  readonly models: readonly ProviderModelConfig[];
  readonly adapters: readonly AdapterDescriptor[];
  readonly presets: readonly ProviderPreset[];
  /** False when `SECRETS_KEY` is unset — the UI blocks key editing then. */
  readonly encryptionConfigured: boolean;
}

/** Everything eve-runtime needs to emit a provider construction for an agent. */
export interface ProviderCodegen {
  readonly providerId: string;
  readonly adapterKind: z.infer<typeof AdapterKindSchema>;
  readonly settings: Readonly<Record<string, string>>;
}

/**
 * Resolves a (provider, modelId) pair against the live registry. Injected into
 * the (pure) import module so it validates against admin-managed providers
 * without the import code depending on the DB.
 */
export interface ModelResolver {
  readonly isKnownProvider: (provider: string) => boolean;
  readonly hasModel: (provider: string, modelId: string) => boolean;
  /** A safe substitute model for a provider (its default/first), or null. */
  readonly fallbackFor: (provider: string) => { readonly provider: string; readonly modelId: string } | null;
  readonly knownProviders: () => readonly string[];
}

// ---------------------------------------------------------------------------
// Admin mutation payloads.
// ---------------------------------------------------------------------------

const providerId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case");
const settingsMap = z.record(z.string(), z.string());
const price = z.number().nonnegative().nullable();

export const CreateProviderInput = z.object({
  id: providerId,
  name: z.string().min(1).max(120),
  adapterKind: AdapterKindSchema,
  settings: settingsMap.default({}),
});
export type CreateProviderInput = z.infer<typeof CreateProviderInput>;

export const UpdateProviderInput = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  settings: settingsMap.optional(),
});
export type UpdateProviderInput = z.infer<typeof UpdateProviderInput>;

/** Field -> plaintext value. An empty string clears that secret. */
export const SetSecretsInput = z.object({ secrets: z.record(z.string(), z.string()) });
export type SetSecretsInput = z.infer<typeof SetSecretsInput>;

export const CreateModelInput = z.object({
  modelId: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  supportsReasoning: z.boolean().default(false),
  inputPer1M: price.default(null),
  outputPer1M: price.default(null),
});
export type CreateModelInput = z.infer<typeof CreateModelInput>;

export const UpdateModelInput = z.object({
  label: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
  inputPer1M: price.optional(),
  outputPer1M: price.optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateModelInput = z.infer<typeof UpdateModelInput>;
