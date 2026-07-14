# @xagents/sandbox

Sandbox-backend configuration that materialized [eve](https://github.com/vercel/eve)
agents use to run tool/skill code inside an isolated microVM (with fallbacks).

It does two things:

1. Picks and constructs an eve sandbox **backend** with a safe default network
   policy for running untrusted, shared-agent code.
2. **Generates** the `agent/sandbox.ts` source that `@xagents/eve-runtime`
   writes into a materialized agent project.

## Backend switch

The backend is chosen by the `SANDBOX_BACKEND` env var, defaulting to
`microsandbox`:

| `SANDBOX_BACKEND` | eve factory                | Isolation | Network policy support        |
| ----------------- | -------------------------- | --------- | ----------------------------- |
| `microsandbox`    | `microsandbox()`           | microVM   | Fine-grained (allow + subnets)|
| `docker`          | `docker()`                 | Container | Coarse (`allow-all`/`deny-all`) |
| `justbash`        | `justbash()`               | None (pure-JS bash) | None (no network stack)     |

Unset, empty, or unrecognized values fall back to `microsandbox` — a bad env
var degrades to the safe default instead of crashing startup.

```ts
import { resolveBackendKind, createSandboxBackend } from "@xagents/sandbox";

const kind = resolveBackendKind(); // reads process.env.SANDBOX_BACKEND
const backend = createSandboxBackend(kind); // eve SandboxBackend
```

### Default network policy

Untrusted agent code needs the public internet but must not reach the host or
private network. `DEFAULT_UNTRUSTED_NETWORK_POLICY` therefore allows every
public domain while denying loopback and RFC1918 / link-local subnets
(`127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` — the last blocks
cloud metadata endpoints).

Only `microsandbox` honors this fine-grained form. `docker` supports only
`allow-all` / `deny-all`, so the policy collapses to `allow-all`
(`toDockerNetworkPolicy`) — prefer microsandbox when the private-subnet deny
matters. `justbash` has no network stack, so no policy applies.

## Defining an agent sandbox

```ts
import { defineAgentSandbox } from "@xagents/sandbox";

// Re-exported from a materialized agent's agent/sandbox.ts
export default defineAgentSandbox();
// or override: defineAgentSandbox({ backendKind: "docker" })
```

The backend is supplied in eve's lazy factory form (`backend: () => ...`), so
the VM runtime is untouched at module-load time and constructed on first
framework access.

## Generating the module source

`@xagents/eve-runtime` uses `generateSandboxModuleSource` to emit the
`agent/sandbox.ts` file for a materialized project. The generated file imports
**only** from `eve/...` (never from `@xagents/sandbox`), so materialized agents
carry no runtime dependency on this package:

```ts
import { generateSandboxModuleSource } from "@xagents/sandbox";

const source = generateSandboxModuleSource({ backendKind: "microsandbox" });
// ->
// import { defineSandbox } from "eve/sandbox";
// import { microsandbox } from "eve/sandbox/microsandbox";
//
// export default defineSandbox({
//   backend: () => microsandbox({ networkPolicy: { allow: ["*"], subnets: { deny: [...] } } }),
// });
```

## Testing

Tests are Node-runtime Vitest (`*.node.test.ts`) because microsandbox is
native and must not run under `bun test`:

```bash
vitest run packages/sandbox
```

No VM is booted in the default run. The boot/construct smoke test is guarded
behind `SANDBOX_SMOKE`:

```bash
SANDBOX_SMOKE=1 vitest run packages/sandbox
```

## eve API used

- `defineSandbox`, `SandboxDefinition`, `SandboxNetworkPolicy` from `eve/sandbox`
- `microsandbox()` from `eve/sandbox/microsandbox`
- `docker()`, `DockerSandboxNetworkPolicy` from `eve/sandbox/docker`
- `justbash()` from `eve/sandbox/just-bash`
