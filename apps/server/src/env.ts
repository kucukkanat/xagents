import { isAbsolute, resolve } from "node:path";
import { type SandboxBackendKind, resolveBackendKind } from "@xagents/sandbox";

export interface ServerConfig {
  readonly port: number;
  readonly databasePath: string;
  readonly agentsWorkspaceDir: string;
  readonly sandboxBackend: SandboxBackendKind;
  readonly deepseekApiKey: string | undefined;
  /** Loopback base URL the materialized kb_search tool calls back into. */
  readonly internalUrl: string;
  readonly webDistDir: string;
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

export const loadConfig = (): ServerConfig => {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  return {
    port,
    databasePath: abs(process.env.DATABASE_PATH ?? "./data/xagents.sqlite"),
    agentsWorkspaceDir: abs(process.env.AGENTS_WORKSPACE_DIR ?? "./.agents-workspace"),
    sandboxBackend: resolveBackendKind(process.env),
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    internalUrl: `http://127.0.0.1:${port}`,
    webDistDir: abs("./apps/web/dist"),
  };
};
