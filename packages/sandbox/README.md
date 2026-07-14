# @xagents/sandbox

Sandbox-backend configuration that materialized [eve](https://github.com/vercel/eve)
agents use to run tool/skill code inside an isolated microVM (with fallbacks).

It does three things:

1. Picks and constructs an eve sandbox **backend** with a safe default network
   policy for running untrusted, shared-agent code.
2. **Generates** the `agent/sandbox.ts` source that `@xagents/eve-runtime`
   writes into a materialized agent project.
3. **Bakes** the custom microVM **image** agents boot into — the one that lets
   agent code use `apt` (see [Sandbox image](#sandbox-image--apt-support)).

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

### Choosing a backend for your environment

`microsandbox` boots real microVMs, so it needs **nested virtualization** —
`/dev/kvm` on Linux, Hypervisor.framework on macOS. Where that isn't available
(many CI runners and nested cloud VMs) the VMs can't boot; the other two
backends don't need it:

- `docker` — OS containers via a Docker daemon. No nested virt, still isolated;
  the best choice when microsandbox can't run. Note: the generated module pins
  our baked image (see [Sandbox image](#sandbox-image--apt-support)) only for
  microsandbox, so docker currently boots eve's default image (and does not get
  the `apt` fix — build an equivalent image from the same recipe and push it to a
  registry if you need it there).
- `justbash` — pure-JS bash over a virtual FS. Runs **anywhere** (no daemon, no
  virt) but gives **no isolation** and no network — only appropriate for trusted
  agents or throwaway/dev.

### How a switch takes effect

`SANDBOX_BACKEND` is read once per process, and a materialized agent's
`agent/sandbox.ts` *pins* the backend — so switching means re-emitting that file.
`@xagents/eve-runtime`'s `materializeAgent` does a full `rm -rf` + regenerate and
re-materializes whenever an agent's host isn't already running. The recipe is
therefore **set the env var, restart the server**: the next chat with each agent
re-materializes onto the new backend. A host that's already running keeps its old
backend until it is stopped or idle-reaped.

The microsandbox-only machinery cleanly drops out under `docker` / `justbash`:
startup image building/warming (`ensureSandboxImage` / `warmSandboxImage`) is
guarded on the backend kind, and eve-runtime's orphaned-VM reaping finds no `msb`
processes and is a no-op.

## Sandbox image (`apt` support)

eve boots the microVM and runs **every** agent command as a non-root user (its
hardcoded `vercel-sandbox`), and a stock base image ships no `sudo`. So a bare
`apt install …` inside an agent fails with `Permission denied` on
`/var/lib/apt/lists/lock`. eve exposes no option to change the exec user and no
in-VM root hook, so the fix lives in the **image**.

`ensureSandboxImage()` bakes a small custom image — `SANDBOX_DEFAULT_IMAGE`
(`xagents-sandbox:latest`) — from `SANDBOX_BASE_IMAGE` (`oven/bun:slim`, Debian +
Bun). The recipe (`PROVISION_SCRIPT`) installs `sudo`, grants `vercel-sandbox`
passwordless sudo, pre-creates that user so eve's base-runtime setup leaves it
alone, and drops `apt`/`apt-get` shims ahead of `/usr/bin` on PATH so a bare
`apt install X` transparently escalates. Agents stay non-root (least privilege)
with scoped, apt-only escalation.

```ts
import { ensureSandboxImage } from "@xagents/sandbox";

// No-op if already cached; otherwise bakes once (~1–2 min).
const r = await ensureSandboxImage({ log: console.log });
```

### No-Docker bake

The bake mechanics live in [`@xagents/microsandbox-image`](../microsandbox-image/README.md),
a standalone, single-responsibility baker. This package is just its caller: it
pins the base image, tag, and `PROVISION_SCRIPT` recipe and wraps the library's
throwing API back into this repo's `Result` model (`build.ts`).

The bake needs **no container builder and no registry**: it boots the base image
in microsandbox, provisions it as root, captures the whole rootfs as a single
layer, wraps it in a Docker `save`-format archive, and `msb image load`s it into
microsandbox's local cache. It therefore runs anywhere microsandbox itself runs.
With eve's default `if-missing` pull policy the cached tag is used as-is and is
never fetched from a registry (it exists only locally) — so the image must be
built **before** the first agent boots. The server calls `ensureSandboxImage()`
at startup for exactly this reason; a chat that lands mid-bake (first run only)
fails until the bake completes.

The same `PROVISION_SCRIPT` is POSIX-sh, so it doubles as a Dockerfile `RUN` if
you'd rather build with Docker and push to a registry (required for the `docker`
backend).

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

No VM is booted in the default run — the provisioning recipe (`PROVISION_SCRIPT`)
is covered by pure tests here, and the image-archive assembly lives in and is
tested by [`@xagents/microsandbox-image`](../microsandbox-image/README.md). The
end-to-end bake smoke test (boots real microVMs: bakes the image, then confirms
the non-root user can `apt-get install`) is guarded behind `SANDBOX_SMOKE`:

```bash
SANDBOX_SMOKE=1 vitest run packages/sandbox
```

## eve API used

- `defineSandbox`, `SandboxDefinition`, `SandboxNetworkPolicy` from `eve/sandbox`
- `microsandbox()` from `eve/sandbox/microsandbox`
- `docker()`, `DockerSandboxNetworkPolicy` from `eve/sandbox/docker`
- `justbash()` from `eve/sandbox/just-bash`
