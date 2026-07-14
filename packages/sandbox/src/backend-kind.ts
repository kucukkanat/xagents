/**
 * The sandbox backends we support materializing agents onto. This is a
 * deliberate subset of eve's backends: `vercel` is excluded because it only
 * runs on hosted Vercel and is selected automatically there, not something we
 * pin for a shared agent.
 */
export type SandboxBackendKind = "microsandbox" | "justbash" | "docker";

/** All valid kinds, in preference order (best isolation first). */
export const SANDBOX_BACKEND_KINDS: readonly SandboxBackendKind[] = [
  "microsandbox",
  "docker",
  "justbash",
];

/**
 * Default backend when nothing is configured. microsandbox gives real VM-level
 * isolation with a firewall, which is what untrusted shared-agent code needs.
 */
export const DEFAULT_SANDBOX_BACKEND_KIND: SandboxBackendKind = "microsandbox";

/** Env var that selects the backend for a process. */
export const SANDBOX_BACKEND_ENV_VAR = "SANDBOX_BACKEND";

const isBackendKind = (value: string): value is SandboxBackendKind =>
  (SANDBOX_BACKEND_KINDS as readonly string[]).includes(value);

/**
 * Resolves the backend kind from the environment.
 *
 * Reads `SANDBOX_BACKEND` (case-insensitive, trimmed). Unset, empty, or
 * unrecognized values fall back to {@link DEFAULT_SANDBOX_BACKEND_KIND} rather
 * than throwing: a bad env var should degrade to the safe default, not crash a
 * materialized agent at startup.
 */
export const resolveBackendKind = (
  env: Record<string, string | undefined> = process.env,
): SandboxBackendKind => {
  const raw = env[SANDBOX_BACKEND_ENV_VAR]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return DEFAULT_SANDBOX_BACKEND_KIND;
  return isBackendKind(raw) ? raw : DEFAULT_SANDBOX_BACKEND_KIND;
};
