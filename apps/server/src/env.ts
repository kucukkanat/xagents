import { isAbsolute, resolve } from "node:path";
import { type SandboxBackendKind, resolveBackendKind } from "@xagents/sandbox";

export interface ServerConfig {
  readonly port: number;
  readonly databasePath: string;
  readonly agentsWorkspaceDir: string;
  readonly sandboxBackend: SandboxBackendKind;
  /** Legacy env key, used only to seed the DeepSeek provider on first boot. */
  readonly deepseekApiKey: string | undefined;
  /** Base64 32-byte master key (`SECRETS_KEY`) for sealing provider secrets.
   *  Unset => provider keys are read-only and key-dependent turns fail clearly. */
  readonly encryptionKey: string | undefined;
  /** Loopback base URL the materialized kb_search tool calls back into. */
  readonly internalUrl: string;
  readonly webDistDir: string;
  /** Shared secret gating `/api/admin/*`. When unset, the admin console is off. */
  readonly adminToken: string | undefined;
  /** How often (ms) the metrics sampler snapshots runtime gauges. */
  readonly metricsSampleIntervalMs: number;
  /** Days to keep gauge samples before pruning. */
  readonly metricsRetentionDays: number;
  /** Days to keep run history / audit events before pruning. */
  readonly historyRetentionDays: number;
}

/** Load `.env` from the repo root (Node 24 built-in; no dotenv dependency). */
export const loadEnv = (): void => {
  try {
    process.loadEnvFile(resolve(process.cwd(), ".env"));
  } catch {
    // No .env file — rely on the ambient environment.
  }
};

const abs = (p: string): string => (isAbsolute(p) ? p : resolve(process.cwd(), p));

const posInt = (raw: string | undefined, fallback: number): number => {
  const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const loadConfig = (): ServerConfig => {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const adminToken = process.env.ADMIN_TOKEN;
  return {
    port,
    databasePath: abs(process.env.DATABASE_PATH ?? "./data/xagents.sqlite"),
    agentsWorkspaceDir: abs(process.env.AGENTS_WORKSPACE_DIR ?? "./.agents-workspace"),
    sandboxBackend: resolveBackendKind(process.env),
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    encryptionKey: process.env.SECRETS_KEY,
    internalUrl: `http://127.0.0.1:${port}`,
    webDistDir: abs("./apps/web/dist"),
    // An empty string means "not configured" — treat it like unset.
    adminToken: adminToken !== undefined && adminToken.length > 0 ? adminToken : undefined,
    metricsSampleIntervalMs: posInt(process.env.METRICS_SAMPLE_INTERVAL_MS, 15_000),
    metricsRetentionDays: posInt(process.env.METRICS_RETENTION_DAYS, 7),
    historyRetentionDays: posInt(process.env.METRICS_HISTORY_RETENTION_DAYS, 30),
  };
};
