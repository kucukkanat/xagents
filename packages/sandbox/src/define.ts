import type { SandboxDefinition, SandboxNetworkPolicy } from "eve/sandbox";
import { defineSandbox } from "eve/sandbox";
import type { SandboxBackendKind } from "./backend-kind";
import { resolveBackendKind } from "./backend-kind";
import { createSandboxBackend } from "./backend";
import { DEFAULT_UNTRUSTED_NETWORK_POLICY } from "./network-policy";

export interface DefineAgentSandboxOptions {
  /** Backend to pin. Defaults to {@link resolveBackendKind} (env-driven). */
  readonly backendKind?: SandboxBackendKind;
  /** Egress policy. Defaults to {@link DEFAULT_UNTRUSTED_NETWORK_POLICY}. */
  readonly networkPolicy?: SandboxNetworkPolicy;
}

/**
 * Builds the eve sandbox definition a materialized agent runs in.
 *
 * The backend is supplied in eve's lazy factory form (`backend: () => ...`) so
 * the process doesn't touch the VM runtime at module-load time — it is
 * constructed on first framework access. This is what a materialized agent's
 * `agent/sandbox.ts` re-exports.
 */
export const defineAgentSandbox = (
  opts: DefineAgentSandboxOptions = {},
): SandboxDefinition => {
  const kind = opts.backendKind ?? resolveBackendKind();
  const networkPolicy = opts.networkPolicy ?? DEFAULT_UNTRUSTED_NETWORK_POLICY;
  return defineSandbox({
    description: `@xagents/sandbox: ${kind} backend for untrusted shared-agent code`,
    backend: () => createSandboxBackend(kind, networkPolicy),
  });
};
