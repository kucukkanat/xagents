import { z } from "zod";

/**
 * Single platform config of the LLM providers/models users may pick from.
 * The MVP ships DeepSeek. Add entries here to expose more models.
 *
 * `eveModelId` is the string handed to eve's `defineAgent({ model })` via the
 * matching `@ai-sdk/*` provider (e.g. `deepseek("deepseek-chat")`).
 */
export const ProviderIdSchema = z.enum(["deepseek"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

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

export interface ModelOption {
  readonly provider: ProviderId;
  /** Model id as the provider's SDK expects it. */
  readonly modelId: string;
  /** Human-facing label for the picker. */
  readonly label: string;
  /** Whether this model supports a reasoning/thinking effort control. */
  readonly supportsReasoning: boolean;
}

/** The enabled catalogue. Server validates a chosen (provider, modelId) against this. */
export const MODEL_CATALOG: readonly ModelOption[] = [
  {
    provider: "deepseek",
    modelId: "deepseek-chat",
    label: "DeepSeek Chat",
    supportsReasoning: false,
  },
  {
    provider: "deepseek",
    modelId: "deepseek-reasoner",
    label: "DeepSeek Reasoner",
    supportsReasoning: true,
  },
];

export const DEFAULT_MODEL: ModelOption = MODEL_CATALOG[0]!;

export const findModel = (provider: ProviderId, modelId: string): ModelOption | undefined =>
  MODEL_CATALOG.find((m) => m.provider === provider && m.modelId === modelId);

/** Which env var carries each provider's API key. */
export const PROVIDER_ENV_KEY: Record<ProviderId, string> = {
  deepseek: "DEEPSEEK_API_KEY",
};
