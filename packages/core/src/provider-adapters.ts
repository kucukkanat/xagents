import { z } from "zod";

/**
 * Provider *adapters*: the small set of mechanisms by which a materialized agent
 * instantiates a model. Each adapter maps to one `@ai-sdk/*` factory and
 * declares the config fields it needs — `secretFields` (encrypted at rest,
 * injected as env at spawn) and `settingFields` (non-secret, baked into the
 * generated `agent/agent.ts`). This is what lets an admin add a provider as
 * *data* (name + base URL + key) without a code change: any OpenAI-compatible
 * endpoint rides the one `openai-compatible` adapter.
 *
 * Adding a genuinely new wire protocol (a new adapter kind) still needs a code
 * change here + in `@xagents/eve-runtime`'s codegen + a workspace dependency,
 * because the SDK import is compiled into the agent project.
 */

export const ADAPTER_KINDS = [
  "deepseek",
  "openai-compatible",
  "anthropic",
  "google",
  "google-vertex",
  "azure",
] as const;
export const AdapterKindSchema = z.enum(ADAPTER_KINDS);
export type AdapterKind = z.infer<typeof AdapterKindSchema>;

/** One configurable field of a provider (a secret or a plaintext setting). */
export interface AdapterField {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  readonly placeholder?: string;
  /** UI hint: render as a long text area (e.g. a service-account JSON blob). */
  readonly multiline?: boolean;
}

/** Static description of an adapter kind — drives both codegen and the admin UI. */
export interface AdapterDescriptor {
  readonly kind: AdapterKind;
  readonly label: string;
  /** The `@ai-sdk/*` module the generated agent imports. */
  readonly sdkModule: string;
  /** The named factory export used to build a keyed provider. */
  readonly factory: string;
  /** Encrypted-at-rest fields (API keys, credential blobs). */
  readonly secretFields: readonly AdapterField[];
  /** Plaintext fields baked into the agent project (base URLs, regions). */
  readonly settingFields: readonly AdapterField[];
  /** One-line guidance shown under the adapter in the console. */
  readonly hint: string;
}

const API_KEY: AdapterField = { name: "apiKey", label: "API key", required: true, placeholder: "sk-…" };

export const ADAPTERS: Readonly<Record<AdapterKind, AdapterDescriptor>> = {
  deepseek: {
    kind: "deepseek",
    label: "DeepSeek",
    sdkModule: "@ai-sdk/deepseek",
    factory: "createDeepSeek",
    secretFields: [API_KEY],
    settingFields: [],
    hint: "DeepSeek's native API. Just an API key.",
  },
  "openai-compatible": {
    kind: "openai-compatible",
    label: "OpenAI-compatible",
    sdkModule: "@ai-sdk/openai-compatible",
    factory: "createOpenAICompatible",
    secretFields: [API_KEY],
    settingFields: [
      {
        name: "baseURL",
        label: "Base URL",
        required: true,
        placeholder: "https://api.openai.com/v1",
      },
    ],
    hint: "Any OpenAI-compatible endpoint (OpenAI, Groq, Together, OpenRouter, GitHub Models, local).",
  },
  anthropic: {
    kind: "anthropic",
    label: "Anthropic",
    sdkModule: "@ai-sdk/anthropic",
    factory: "createAnthropic",
    secretFields: [API_KEY],
    settingFields: [],
    hint: "Anthropic's native Messages API. Just an API key.",
  },
  google: {
    kind: "google",
    label: "Google Gemini",
    sdkModule: "@ai-sdk/google",
    factory: "createGoogleGenerativeAI",
    secretFields: [API_KEY],
    settingFields: [],
    hint: "Google's Gemini (Generative Language) API with an API key.",
  },
  "google-vertex": {
    kind: "google-vertex",
    label: "Google Vertex AI",
    sdkModule: "@ai-sdk/google-vertex",
    factory: "createVertex",
    secretFields: [
      {
        name: "credentialsJson",
        label: "Service account JSON",
        required: true,
        placeholder: '{ "type": "service_account", … }',
        multiline: true,
      },
    ],
    settingFields: [
      { name: "project", label: "GCP project", required: true, placeholder: "my-project" },
      { name: "location", label: "Location", required: true, placeholder: "us-central1" },
    ],
    hint: "Vertex AI via a service-account credential (not a simple API key).",
  },
  azure: {
    kind: "azure",
    label: "Azure OpenAI / AI",
    sdkModule: "@ai-sdk/azure",
    factory: "createAzure",
    secretFields: [API_KEY],
    settingFields: [
      { name: "resourceName", label: "Resource name", required: true, placeholder: "my-resource" },
      { name: "apiVersion", label: "API version", required: false, placeholder: "2024-10-01-preview" },
    ],
    hint: "Azure-hosted models. Model id is the Azure deployment name.",
  },
};

export const ADAPTER_LIST: readonly AdapterDescriptor[] = ADAPTER_KINDS.map((k) => ADAPTERS[k]);

/**
 * Curated starting points shown in the "Add provider" flow. A preset pre-fills a
 * provider id, name, adapter kind, and (for openai-compatible) a base URL, so an
 * admin adds OpenRouter/GitHub Models/etc. without knowing their endpoints.
 */
export interface ProviderPreset {
  readonly id: string;
  readonly label: string;
  readonly adapterKind: AdapterKind;
  readonly settings: Readonly<Record<string, string>>;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: "deepseek", label: "DeepSeek", adapterKind: "deepseek", settings: {} },
  { id: "anthropic", label: "Anthropic", adapterKind: "anthropic", settings: {} },
  { id: "google", label: "Google Gemini", adapterKind: "google", settings: {} },
  { id: "google-vertex", label: "Google Vertex AI", adapterKind: "google-vertex", settings: {} },
  { id: "azure", label: "Azure OpenAI", adapterKind: "azure", settings: {} },
  {
    id: "openai",
    label: "OpenAI",
    adapterKind: "openai-compatible",
    settings: { baseURL: "https://api.openai.com/v1" },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    adapterKind: "openai-compatible",
    settings: { baseURL: "https://openrouter.ai/api/v1" },
  },
  {
    id: "github-models",
    label: "GitHub Models",
    adapterKind: "openai-compatible",
    settings: { baseURL: "https://models.github.ai/inference" },
  },
  {
    id: "groq",
    label: "Groq",
    adapterKind: "openai-compatible",
    settings: { baseURL: "https://api.groq.com/openai/v1" },
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible",
    adapterKind: "openai-compatible",
    settings: { baseURL: "" },
  },
];

/**
 * Env var carrying a provider secret field into the eve child process. Both the
 * server (resolving/decrypting at spawn) and the codegen (reading it in the
 * generated agent) derive the name from this one function, so they can never
 * drift. Secrets are NEVER baked into the materialized project on disk.
 */
export const providerSecretEnvVar = (field: string): string =>
  `XAGENTS_PROVIDER_SECRET_${field.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
