import type { SandboxBackend, SandboxNetworkPolicy } from "eve/sandbox";
import { docker } from "eve/sandbox/docker";
import { justbash } from "eve/sandbox/just-bash";
import { microsandbox } from "eve/sandbox/microsandbox";
import type { SandboxBackendKind } from "./backend-kind";
import { DEFAULT_UNTRUSTED_NETWORK_POLICY, toDockerNetworkPolicy } from "./network-policy";

/**
 * Instantiates the eve backend for a given kind, applying `networkPolicy` where
 * the backend supports it.
 *
 * Notes on the two backends that don't take the full policy:
 * - `docker` accepts only the coarse `"allow-all" | "deny-all"` form, so we
 *   collapse via {@link toDockerNetworkPolicy}.
 * - `justbash` has no network stack at all (pure-JS bash over a virtual FS), so
 *   there is nothing to police and it takes no policy.
 */
export const createSandboxBackend = (
  kind: SandboxBackendKind,
  networkPolicy: SandboxNetworkPolicy = DEFAULT_UNTRUSTED_NETWORK_POLICY,
): SandboxBackend => {
  switch (kind) {
    case "microsandbox":
      return microsandbox({ networkPolicy });
    case "docker":
      return docker({ networkPolicy: toDockerNetworkPolicy(networkPolicy) });
    case "justbash":
      return justbash();
  }
};
