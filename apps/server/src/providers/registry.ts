import {
  type AdapterKind,
  type AdminProvidersView,
  type AppError,
  type ModelOption,
  type ModelPricing,
  type ModelResolver,
  type ProviderCodegen,
  type ProviderConfig,
  type ProviderModelConfig,
  type Result,
  type SealedSecret,
  type SecretState,
  ADAPTERS,
  ADAPTER_LIST,
  PROVIDER_PRESETS,
  appError,
  err,
  ok,
  openSecret,
  providerSecretEnvVar,
  sealSecret,
} from "@xagents/core";
import type { Db, StoredModel, StoredProvider } from "@xagents/db";

/** A provider with its secrets decrypted, for codegen tests and connectivity checks. */
interface ResolvedProvider {
  readonly adapterKind: AdapterKind;
  readonly settings: Record<string, string>;
  readonly secrets: Record<string, string>;
}

/**
 * The single in-memory source of truth for provider/model configuration. It is
 * hydrated from the DB on boot and rebuilt on every admin mutation, so the many
 * *synchronous* call sites (config route, agent validation, cost pricing) keep
 * working without threading async DB reads through them. The registry owns the
 * master key: it is the only place a secret is ever decrypted, and it never
 * hands plaintext to the client.
 */
export interface ProviderRegistry {
  readonly encryptionConfigured: boolean;
  /** Rebuild the cached snapshot from the DB. Call after any provider mutation. */
  readonly reload: () => void;
  /** Enabled models in picker shape (drives `GET /api/config`). */
  readonly models: () => ModelOption[];
  /** Full admin Providers-tab payload (no plaintext secrets). */
  readonly adminView: () => AdminProvidersView;
  /** Codegen inputs for an agent's provider, or undefined if the provider is gone. */
  readonly codegenFor: (providerId: string) => ProviderCodegen | undefined;
  /** Whether a turn may run on (provider, modelId): enabled + keyed + encryptable. */
  readonly usability: (providerId: string, modelId: string) => Result<void, AppError>;
  readonly pricingFor: (providerId: string, modelId: string) => ModelPricing | undefined;
  /** Decrypted secret env vars for an agent's provider (empty if no key/master key). */
  readonly envFor: (providerId: string) => Record<string, string | undefined>;
  readonly modelResolver: () => ModelResolver;
  /** Seal a plaintext secret, or null when `SECRETS_KEY` is unset. */
  readonly seal: (plaintext: string) => SealedSecret | null;
  /** Probe a provider's key + settings against the live endpoint. */
  readonly test: (providerId: string) => Promise<Result<void, AppError>>;
}

const REQUIRED = (adapterKind: AdapterKind): readonly string[] =>
  ADAPTERS[adapterKind].secretFields.filter((f) => f.required).map((f) => f.name);

const toModelOption = (providerId: string, m: StoredModel): ModelOption => ({
  provider: providerId,
  modelId: m.modelId,
  label: m.label,
  supportsReasoning: m.supportsReasoning,
  ...(m.inputPer1M !== null && m.outputPer1M !== null
    ? { pricing: { inputPer1M: m.inputPer1M, outputPer1M: m.outputPer1M } }
    : {}),
});

const toProviderConfig = (p: StoredProvider): Omit<ProviderConfig, "usage"> => {
  const secrets: Record<string, SecretState> = {};
  for (const field of ADAPTERS[p.adapterKind].secretFields) {
    const configured = p.sealedSecrets[field.name] !== undefined;
    const hint = p.secretHints[field.name];
    secrets[field.name] = { configured, hint: configured && hint ? hint : null };
  }
  return {
    id: p.id,
    name: p.name,
    adapterKind: p.adapterKind,
    enabled: p.enabled,
    settings: p.settings,
    secrets,
    testStatus: p.testStatus,
    testError: p.testError,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
};

const toModelConfig = (m: StoredModel): Omit<ProviderModelConfig, "usage"> => ({
  id: m.id,
  providerId: m.providerId,
  modelId: m.modelId,
  label: m.label,
  enabled: m.enabled,
  supportsReasoning: m.supportsReasoning,
  pricing: m.inputPer1M !== null && m.outputPer1M !== null
    ? { inputPer1M: m.inputPer1M, outputPer1M: m.outputPer1M }
    : null,
  isDefault: m.isDefault,
  sortOrder: m.sortOrder,
});

export const createProviderRegistry = (db: Db, masterKey: Buffer | null): ProviderRegistry => {
  let providers: StoredProvider[] = [];
  let models: StoredModel[] = [];
  let byId = new Map<string, StoredProvider>();
  let modelsByProvider = new Map<string, StoredModel[]>();

  const reload = (): void => {
    providers = db.providers.listProviders();
    models = db.providers.listModels();
    byId = new Map(providers.map((p) => [p.id, p]));
    modelsByProvider = new Map();
    for (const m of models) {
      const list = modelsByProvider.get(m.providerId) ?? [];
      list.push(m);
      modelsByProvider.set(m.providerId, list);
    }
  };
  reload();

  const enabledModel = (providerId: string, modelId: string): StoredModel | undefined =>
    modelsByProvider.get(providerId)?.find((m) => m.modelId === modelId && m.enabled);

  const resolve = (providerId: string): Result<ResolvedProvider, AppError> => {
    const p = byId.get(providerId);
    if (p === undefined) return err(appError("not_found", `provider ${providerId} not found`));
    if (masterKey === null && Object.keys(p.sealedSecrets).length > 0) {
      return err(appError("conflict", "encryption is not configured (set SECRETS_KEY)"));
    }
    const secrets: Record<string, string> = {};
    for (const [field, sealed] of Object.entries(p.sealedSecrets)) {
      if (masterKey === null) continue;
      const opened = openSecret(sealed, masterKey);
      if (!opened.ok) return err(opened.error);
      secrets[field] = opened.value;
    }
    return ok({ adapterKind: p.adapterKind, settings: p.settings, secrets });
  };

  const modelResolver = (): ModelResolver => ({
    isKnownProvider: (providerId) => byId.has(providerId),
    hasModel: (providerId, modelId) => enabledModel(providerId, modelId) !== undefined,
    fallbackFor: (providerId) => {
      const list = (modelsByProvider.get(providerId) ?? []).filter((m) => m.enabled);
      const pick = list.find((m) => m.isDefault) ?? list[0];
      return pick === undefined ? null : { provider: providerId, modelId: pick.modelId };
    },
    knownProviders: () => providers.map((p) => p.id),
  });

  return {
    encryptionConfigured: masterKey !== null,
    reload,
    models: () =>
      providers
        .filter((p) => p.enabled)
        .flatMap((p) => (modelsByProvider.get(p.id) ?? []).filter((m) => m.enabled).map((m) => toModelOption(p.id, m))),
    adminView: () => ({
      providers: providers.map((p) => ({ ...toProviderConfig(p), usage: db.providers.usageCount(p.id) })),
      models: models.map((m) => ({ ...toModelConfig(m), usage: db.providers.usageCount(m.providerId, m.modelId) })),
      adapters: ADAPTER_LIST,
      presets: PROVIDER_PRESETS,
      encryptionConfigured: masterKey !== null,
    }),
    codegenFor: (providerId) => {
      const p = byId.get(providerId);
      return p === undefined ? undefined : { providerId: p.id, adapterKind: p.adapterKind, settings: p.settings };
    },
    usability: (providerId, modelId) => {
      const p = byId.get(providerId);
      if (p === undefined) return err(appError("not_found", `Model provider "${providerId}" is not configured.`));
      if (!p.enabled) return err(appError("conflict", `Model provider "${p.name}" is disabled. An admin must re-enable it.`));
      if (enabledModel(providerId, modelId) === undefined) {
        return err(appError("conflict", `Model "${modelId}" is disabled or no longer available.`));
      }
      const missing = REQUIRED(p.adapterKind).filter((f) => p.sealedSecrets[f] === undefined);
      if (missing.length > 0) {
        return err(appError("conflict", `Provider "${p.name}" is missing its ${missing.join(", ")}.`));
      }
      const missingSettings = ADAPTERS[p.adapterKind].settingFields
        .filter((f) => f.required && (p.settings[f.name] ?? "").length === 0)
        .map((f) => f.label);
      if (missingSettings.length > 0) {
        return err(appError("conflict", `Provider "${p.name}" is missing required settings: ${missingSettings.join(", ")}.`));
      }
      if (masterKey === null) {
        return err(appError("conflict", "Encryption is not configured (SECRETS_KEY unset); provider keys can't be used."));
      }
      return ok(undefined);
    },
    pricingFor: (providerId, modelId) => {
      const m = modelsByProvider.get(providerId)?.find((x) => x.modelId === modelId);
      return m !== undefined && m.inputPer1M !== null && m.outputPer1M !== null
        ? { inputPer1M: m.inputPer1M, outputPer1M: m.outputPer1M }
        : undefined;
    },
    envFor: (providerId) => {
      const resolved = resolve(providerId);
      if (!resolved.ok) return {};
      const env: Record<string, string | undefined> = {};
      for (const [field, value] of Object.entries(resolved.value.secrets)) {
        env[providerSecretEnvVar(field)] = value;
      }
      return env;
    },
    modelResolver,
    seal: (plaintext) => (masterKey === null ? null : sealSecret(plaintext, masterKey)),
    test: async (providerId) => {
      const resolved = resolve(providerId);
      if (!resolved.ok) return resolved;
      return runProviderTest(resolved.value);
    },
  };
};

// ---------------------------------------------------------------------------
// Connectivity test. `buildProviderTest` is pure (unit-testable); `runProviderTest`
// performs the actual request.
// ---------------------------------------------------------------------------

export type ProviderTestPlan =
  | { readonly kind: "http"; readonly url: string; readonly headers: Record<string, string> }
  | { readonly kind: "structural"; readonly ok: boolean; readonly message: string };

/** How to probe each adapter kind for a valid key + reachable endpoint. */
export const buildProviderTest = (r: ResolvedProvider): ProviderTestPlan => {
  const apiKey = r.secrets.apiKey ?? "";
  const baseURL = (r.settings.baseURL ?? "").replace(/\/+$/, "");
  switch (r.adapterKind) {
    case "deepseek":
      return { kind: "http", url: "https://api.deepseek.com/models", headers: { authorization: `Bearer ${apiKey}` } };
    case "openai-compatible":
      return { kind: "http", url: `${baseURL}/models`, headers: { authorization: `Bearer ${apiKey}` } };
    case "anthropic":
      return {
        kind: "http",
        url: "https://api.anthropic.com/v1/models",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      };
    case "google":
      return {
        kind: "http",
        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        headers: {},
      };
    case "azure": {
      const resource = r.settings.resourceName ?? "";
      const version = r.settings.apiVersion ?? "2024-10-01-preview";
      return {
        kind: "http",
        url: `https://${resource}.openai.azure.com/openai/models?api-version=${encodeURIComponent(version)}`,
        headers: { "api-key": apiKey },
      };
    }
    case "google-vertex":
      // A real Vertex probe needs an OAuth token exchange; for now we validate the
      // service-account JSON is structurally usable (see the plan's open risks).
      return structuralVertexTest(r.secrets.credentialsJson ?? "");
  }
};

const structuralVertexTest = (credentialsJson: string): ProviderTestPlan => {
  try {
    const parsed: unknown = JSON.parse(credentialsJson);
    const ok =
      typeof parsed === "object" &&
      parsed !== null &&
      "client_email" in parsed &&
      "private_key" in parsed;
    return {
      kind: "structural",
      ok,
      message: ok
        ? "Service-account JSON looks valid (connectivity not verified for Vertex)."
        : "Service-account JSON is missing client_email / private_key.",
    };
  } catch {
    return { kind: "structural", ok: false, message: "Service-account JSON is not valid JSON." };
  }
};

const runProviderTest = async (r: ResolvedProvider): Promise<Result<void, AppError>> => {
  const plan = buildProviderTest(r);
  if (plan.kind === "structural") {
    return plan.ok ? ok(undefined) : err(appError("validation", plan.message));
  }
  try {
    const res = await fetch(plan.url, { method: "GET", headers: plan.headers });
    if (res.ok) return ok(undefined);
    // 401/403 => bad key; other statuses => reachable but unhappy. Surface briefly.
    const body = await res.text().catch(() => "");
    const detail = body.slice(0, 200).replace(/\s+/g, " ").trim();
    return err(appError("provider_error", `Connection test failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`));
  } catch (cause) {
    return err(appError("provider_error", "Connection test failed (network error)", cause));
  }
};
