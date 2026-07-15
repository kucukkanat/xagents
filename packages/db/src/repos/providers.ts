import {
  type AdapterKind,
  type AppError,
  type ProviderTestStatus,
  type Result,
  type SealedSecret,
  AdapterKindSchema,
  SealedSecretSchema,
  appError,
  err,
  newId,
  ok,
} from "@xagents/core";
import { z } from "zod";
import { nowIso } from "../helpers";
import type { Sqlite } from "../sqlite";

/**
 * Persistence for admin-managed providers and their models. The repo is
 * deliberately key-agnostic: it stores and returns *sealed* secret blobs and
 * their masked hints, but never encrypts, decrypts, or sees the master key —
 * that policy lives in the server. This keeps the trust boundary crisp (the DB
 * file alone can't yield a plaintext key).
 */

// --- server-facing shapes (carry sealed secrets; never sent to the browser) --

export interface StoredProvider {
  readonly id: string;
  readonly name: string;
  readonly adapterKind: AdapterKind;
  readonly enabled: boolean;
  readonly settings: Record<string, string>;
  readonly sealedSecrets: Record<string, SealedSecret>;
  readonly secretHints: Record<string, string>;
  readonly testStatus: ProviderTestStatus;
  readonly testError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredModel {
  readonly id: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly supportsReasoning: boolean;
  readonly inputPer1M: number | null;
  readonly outputPer1M: number | null;
  readonly isDefault: boolean;
  readonly sortOrder: number;
}

export interface NewProvider {
  readonly id: string;
  readonly name: string;
  readonly adapterKind: AdapterKind;
  readonly settings: Record<string, string>;
}

export interface ProviderPatch {
  readonly name?: string | undefined;
  readonly enabled?: boolean | undefined;
  readonly settings?: Record<string, string> | undefined;
}

export interface NewModel {
  readonly modelId: string;
  readonly label: string;
  readonly supportsReasoning: boolean;
  readonly inputPer1M: number | null;
  readonly outputPer1M: number | null;
}

export interface ModelPatch {
  readonly label?: string | undefined;
  readonly enabled?: boolean | undefined;
  readonly supportsReasoning?: boolean | undefined;
  readonly inputPer1M?: number | null | undefined;
  readonly outputPer1M?: number | null | undefined;
  readonly sortOrder?: number | undefined;
}

/** A secret update: a sealed value + its masked hint, or `null` to clear the field. */
export type SecretUpdate = { readonly sealed: SealedSecret; readonly hint: string } | null;

export interface ProvidersRepo {
  readonly count: () => number;
  readonly listProviders: () => StoredProvider[];
  readonly getProvider: (id: string) => StoredProvider | undefined;
  readonly createProvider: (input: NewProvider) => Result<StoredProvider, AppError>;
  readonly updateProvider: (id: string, patch: ProviderPatch) => boolean;
  readonly deleteProvider: (id: string) => boolean;
  /** Merge secret field updates (value => set, null => clear) into a provider. */
  readonly setSecrets: (id: string, updates: Record<string, SecretUpdate>) => boolean;
  readonly setTestStatus: (id: string, status: ProviderTestStatus, error: string | null) => boolean;

  readonly listModels: () => StoredModel[];
  readonly getModel: (id: string) => StoredModel | undefined;
  readonly addModel: (providerId: string, input: NewModel) => Result<StoredModel, AppError>;
  readonly updateModel: (id: string, patch: ModelPatch) => boolean;
  readonly deleteModel: (id: string) => boolean;
  /** Make this the single platform-default model (clears the flag everywhere else). */
  readonly setDefaultModel: (id: string) => boolean;

  /** Agents referencing a provider (optionally a specific model): the delete warning. */
  readonly usageCount: (providerId: string, modelId?: string) => number;
}

// --- row shapes --------------------------------------------------------------

interface ProviderRow {
  readonly id: string;
  readonly name: string;
  readonly adapter_kind: string;
  readonly enabled: number;
  readonly settings_json: string;
  readonly secrets_json: string;
  readonly secret_hints_json: string;
  readonly test_status: string;
  readonly test_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ModelRow {
  readonly id: string;
  readonly provider_id: string;
  readonly model_id: string;
  readonly label: string;
  readonly enabled: number;
  readonly supports_reasoning: number;
  readonly input_per_1m: number | null;
  readonly output_per_1m: number | null;
  readonly is_default: number;
  readonly sort_order: number;
}

// --- parsers -----------------------------------------------------------------

const asAdapterKind = (v: string): AdapterKind => {
  const parsed = AdapterKindSchema.safeParse(v);
  if (!parsed.success) throw new Error(`invalid adapter kind in db: ${v}`);
  return parsed.data;
};

const asTestStatus = (v: string): ProviderTestStatus =>
  v === "ok" || v === "failed" ? v : "untested";

const parseStringMap = (json: string): Record<string, string> => {
  const parsed = z.record(z.string(), z.string()).safeParse(safeJson(json));
  return parsed.success ? parsed.data : {};
};

const parseSealedMap = (json: string): Record<string, SealedSecret> => {
  const parsed = z.record(z.string(), SealedSecretSchema).safeParse(safeJson(json));
  return parsed.success ? parsed.data : {};
};

const safeJson = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
};

const mapProvider = (row: ProviderRow): StoredProvider => ({
  id: row.id,
  name: row.name,
  adapterKind: asAdapterKind(row.adapter_kind),
  enabled: row.enabled !== 0,
  settings: parseStringMap(row.settings_json),
  sealedSecrets: parseSealedMap(row.secrets_json),
  secretHints: parseStringMap(row.secret_hints_json),
  testStatus: asTestStatus(row.test_status),
  testError: row.test_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapModel = (row: ModelRow): StoredModel => ({
  id: row.id,
  providerId: row.provider_id,
  modelId: row.model_id,
  label: row.label,
  enabled: row.enabled !== 0,
  supportsReasoning: row.supports_reasoning !== 0,
  inputPer1M: row.input_per_1m,
  outputPer1M: row.output_per_1m,
  isDefault: row.is_default !== 0,
  sortOrder: row.sort_order,
});

export const createProvidersRepo = (db: Sqlite): ProvidersRepo => {
  const countStmt = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM providers");
  const listProvidersStmt = db.prepare<[], ProviderRow>("SELECT * FROM providers ORDER BY created_at ASC");
  const getProviderStmt = db.prepare<[string], ProviderRow>("SELECT * FROM providers WHERE id = ?");
  const insertProviderStmt = db.prepare(
    `INSERT INTO providers (id, name, adapter_kind, enabled, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
  );
  const deleteProviderStmt = db.prepare("DELETE FROM providers WHERE id = ?");
  const setSecretsStmt = db.prepare(
    "UPDATE providers SET secrets_json = ?, secret_hints_json = ?, test_status = 'untested', test_error = NULL, updated_at = ? WHERE id = ?",
  );
  const setTestStmt = db.prepare(
    "UPDATE providers SET test_status = ?, test_error = ?, updated_at = ? WHERE id = ?",
  );

  const listModelsStmt = db.prepare<[], ModelRow>(
    "SELECT * FROM provider_models ORDER BY sort_order ASC, label ASC",
  );
  const getModelStmt = db.prepare<[string], ModelRow>("SELECT * FROM provider_models WHERE id = ?");
  const modelExistsStmt = db.prepare<[string, string], { n: number }>(
    "SELECT COUNT(*) AS n FROM provider_models WHERE provider_id = ? AND model_id = ?",
  );
  const insertModelStmt = db.prepare(
    `INSERT INTO provider_models
       (id, provider_id, model_id, label, enabled, supports_reasoning, input_per_1m, output_per_1m, is_default, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0, ?, ?, ?)`,
  );
  const deleteModelStmt = db.prepare("DELETE FROM provider_models WHERE id = ?");
  const clearDefaultsStmt = db.prepare("UPDATE provider_models SET is_default = 0 WHERE is_default = 1");
  const setDefaultStmt = db.prepare("UPDATE provider_models SET is_default = 1, updated_at = ? WHERE id = ?");
  const maxOrderStmt = db.prepare<[string], { m: number | null }>(
    "SELECT MAX(sort_order) AS m FROM provider_models WHERE provider_id = ?",
  );

  const createProvider = (input: NewProvider): Result<StoredProvider, AppError> => {
    if (getProviderStmt.get(input.id) !== undefined) {
      return err(appError("conflict", `provider ${input.id} already exists`));
    }
    const now = nowIso();
    insertProviderStmt.run(input.id, input.name, input.adapterKind, JSON.stringify(input.settings), now, now);
    const row = getProviderStmt.get(input.id);
    return row === undefined
      ? err(appError("internal", "provider vanished after insert"))
      : ok(mapProvider(row));
  };

  // Only the three mutable columns; each patch builds its own statement because
  // the set of present keys varies. Settings replace wholesale (the caller sends
  // the full desired map).
  const updateProvider = (id: string, patch: ProviderPatch): boolean => {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.enabled !== undefined) {
      sets.push("enabled = ?");
      params.push(patch.enabled ? 1 : 0);
    }
    if (patch.settings !== undefined) {
      sets.push("settings_json = ?");
      params.push(JSON.stringify(patch.settings));
    }
    if (sets.length === 0) return getProviderStmt.get(id) !== undefined;
    sets.push("updated_at = ?");
    params.push(nowIso(), id);
    return db.prepare(`UPDATE providers SET ${sets.join(", ")} WHERE id = ?`).run(...params).changes > 0;
  };

  const setSecrets = (id: string, updates: Record<string, SecretUpdate>): boolean => {
    const row = getProviderStmt.get(id);
    if (row === undefined) return false;
    const sealed = parseSealedMap(row.secrets_json);
    const hints = parseStringMap(row.secret_hints_json);
    for (const [field, update] of Object.entries(updates)) {
      if (update === null) {
        delete sealed[field];
        delete hints[field];
      } else {
        sealed[field] = update.sealed;
        hints[field] = update.hint;
      }
    }
    return setSecretsStmt.run(JSON.stringify(sealed), JSON.stringify(hints), nowIso(), id).changes > 0;
  };

  const addModel = (providerId: string, input: NewModel): Result<StoredModel, AppError> => {
    if (getProviderStmt.get(providerId) === undefined) {
      return err(appError("not_found", `provider ${providerId} not found`));
    }
    if ((modelExistsStmt.get(providerId, input.modelId)?.n ?? 0) > 0) {
      return err(appError("conflict", `model ${input.modelId} already exists for ${providerId}`));
    }
    const id = newId("ProviderModelId");
    const now = nowIso();
    const order = (maxOrderStmt.get(providerId)?.m ?? 0) + 1;
    insertModelStmt.run(
      id,
      providerId,
      input.modelId,
      input.label,
      input.supportsReasoning ? 1 : 0,
      input.inputPer1M,
      input.outputPer1M,
      order,
      now,
      now,
    );
    const row = getModelStmt.get(id);
    return row === undefined ? err(appError("internal", "model vanished after insert")) : ok(mapModel(row));
  };

  const updateModel = (id: string, patch: ModelPatch): boolean => {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown): void => {
      sets.push(`${col} = ?`);
      params.push(val);
    };
    if (patch.label !== undefined) push("label", patch.label);
    if (patch.enabled !== undefined) push("enabled", patch.enabled ? 1 : 0);
    if (patch.supportsReasoning !== undefined) push("supports_reasoning", patch.supportsReasoning ? 1 : 0);
    if (patch.inputPer1M !== undefined) push("input_per_1m", patch.inputPer1M);
    if (patch.outputPer1M !== undefined) push("output_per_1m", patch.outputPer1M);
    if (patch.sortOrder !== undefined) push("sort_order", patch.sortOrder);
    if (sets.length === 0) return getModelStmt.get(id) !== undefined;
    sets.push("updated_at = ?");
    params.push(nowIso(), id);
    return db.prepare(`UPDATE provider_models SET ${sets.join(", ")} WHERE id = ?`).run(...params).changes > 0;
  };

  const setDefaultModel = (id: string): boolean =>
    db.transaction((): boolean => {
      if (getModelStmt.get(id) === undefined) return false;
      clearDefaultsStmt.run();
      return setDefaultStmt.run(nowIso(), id).changes > 0;
    })();

  return {
    count: () => countStmt.get()?.n ?? 0,
    listProviders: () => listProvidersStmt.all().map(mapProvider),
    getProvider: (id) => {
      const row = getProviderStmt.get(id);
      return row === undefined ? undefined : mapProvider(row);
    },
    createProvider,
    updateProvider,
    deleteProvider: (id) => deleteProviderStmt.run(id).changes > 0,
    setSecrets,
    setTestStatus: (id, status, error) => setTestStmt.run(status, error, nowIso(), id).changes > 0,
    listModels: () => listModelsStmt.all().map(mapModel),
    getModel: (id) => {
      const row = getModelStmt.get(id);
      return row === undefined ? undefined : mapModel(row);
    },
    addModel,
    updateModel,
    deleteModel: (id) => deleteModelStmt.run(id).changes > 0,
    setDefaultModel,
    usageCount: (providerId, modelId) =>
      modelId === undefined
        ? db.prepare<[string], { n: number }>("SELECT COUNT(*) AS n FROM agents WHERE model_provider = ?").get(providerId)?.n ?? 0
        : db
            .prepare<[string, string], { n: number }>(
              "SELECT COUNT(*) AS n FROM agents WHERE model_provider = ? AND model_id = ?",
            )
            .get(providerId, modelId)?.n ?? 0,
  };
};
