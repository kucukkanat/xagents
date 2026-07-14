import type { SandboxNetworkPolicy } from "eve/sandbox";
import type { DockerSandboxNetworkPolicy } from "eve/sandbox/docker";

/**
 * Default egress policy for running untrusted, shared-agent code.
 *
 * WHY this shape rather than the coarse `"allow-all"`: agents legitimately need
 * the public internet (package registries, model gateways, web fetches), but
 * they must NOT be able to reach the host or other services on the private
 * network. So we allow every public domain (`allow: ["*"]`) while denying the
 * loopback and RFC1918 / link-local subnets at the firewall. `169.254.0.0/16`
 * in particular blocks cloud metadata endpoints (a common SSRF target).
 *
 * Only the microsandbox backend can honor this fine-grained form; see
 * {@link toDockerNetworkPolicy} for the coarse fallback.
 */
export const DEFAULT_UNTRUSTED_NETWORK_POLICY: SandboxNetworkPolicy = {
  allow: ["*"],
  subnets: {
    deny: [
      "127.0.0.0/8", // loopback / host
      "10.0.0.0/8", // RFC1918 private
      "172.16.0.0/12", // RFC1918 private
      "192.168.0.0/16", // RFC1918 private
      "169.254.0.0/16", // link-local (incl. cloud metadata endpoints)
    ],
  },
};

/**
 * Collapses a full network policy to the coarse form the Docker backend
 * supports (`"allow-all" | "deny-all"`). Docker can only toggle networking on
 * or off, so a fine-grained allow/deny object degrades to `"allow-all"`: agents
 * still need internet, and the private-subnet deny simply cannot be enforced
 * here. Prefer the microsandbox backend when that isolation matters.
 */
export const toDockerNetworkPolicy = (
  policy: SandboxNetworkPolicy,
): DockerSandboxNetworkPolicy => (policy === "deny-all" ? "deny-all" : "allow-all");
