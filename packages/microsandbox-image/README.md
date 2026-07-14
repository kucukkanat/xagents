# @xagents/microsandbox-image

Bake a custom [microsandbox](https://github.com/microsandbox/microsandbox) microVM
image from a base image plus a provisioning script — **without Docker, a registry,
or any container builder.** If microsandbox runs, this runs.

microsandbox has no `docker build`. This package fills that gap: it boots the base
image as a throwaway VM, runs your script inside it as root, snapshots the whole
rootfs into a single layer, wraps it in a Docker `save`-format archive, and
`msb image load`s it under a tag you choose. The result is an ordinary local image
your workloads boot into.

```
base image ──► boot VM ──► provision (root) ──► tar rootfs ──► Docker archive ──► msb image load
  oven/bun:slim                apt/useradd/…      one layer      config+manifest      my-image:latest
```

## Install

```sh
bun add @xagents/microsandbox-image microsandbox
```

`microsandbox` is a peer requirement — this package drives its bundled `msb` CLI
and SDK. The microsandbox runtime (`msb`) must be installed and on `PATH` on the
host that runs the bake.

## Quick start

```ts
import { ensureImage, warmImage } from "@xagents/microsandbox-image";

// Bake once (no-op if already cached), then prime the boot cache.
const { tag, built } = await ensureImage({
  baseImage: "oven/bun:slim",
  tag: "my-agent-sandbox:latest",
  // Root-run POSIX-sh. Keep it bashism-free, quiet, and heredoc-free (see below).
  provision: `set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends git >/dev/null`,
  log: (m) => console.log(`  ${m}`),
});

if (built) console.log(`baked ${tag}`);
await warmImage(tag); // optional: pay first-boot latency now, not on first use
```

## CLI

The package ships a `microsandbox-image` bin — the same baker, from a shell.
After `bun add`, it's on your `PATH` (or run it with `bunx microsandbox-image`):

```sh
# Bake only if the tag isn't cached; the provision script comes from a file.
microsandbox-image ensure -b oven/bun:slim -t my-image:latest -f ./provision.sh

# Force a rebuild, reading the script from stdin.
cat provision.sh | microsandbox-image bake -b oven/bun:slim -t my-image:latest --provision-stdin

# Prime the boot cache for an already-baked tag.
microsandbox-image warm -t my-image:latest

# Predicate: prints true/false, exits 0 if present and 1 if not — shell-friendly.
if microsandbox-image exists -t my-image:latest; then echo "cached"; fi
```

The bin ships TypeScript source (this monorepo has no build step), so from a
checkout invoke it directly: `bun src/bin.ts --help`.

`microsandbox-image --help` lists every command and flag. Conventions:

- **stdout** carries only the result (the tag, or `true`/`false`) so it pipes
  cleanly; **stderr** carries progress and errors.
- Exit codes: `0` success · `1` bake/runtime failure · `2` usage error.
- A bake needs exactly one provision source: `-f/--provision-file`,
  `-p/--provision`, or `--provision-stdin`.

## API

### `ensureImage(options): Promise<{ tag, built }>`

Idempotent entry point. Returns immediately with `built: false` when `tag` is
already in the local cache; otherwise bakes it and returns `built: true`. This is
what you call at process startup.

### `bakeImage(options): Promise<void>`

Always bakes, unconditionally (used by `ensureImage`). Reach for it directly only
when you want to force a rebuild.

Both take the same `BakeImageOptions`:

| Field           | Type                        | Default        | Notes                                                        |
| --------------- | --------------------------- | -------------- | ------------------------------------------------------------ |
| `baseImage`     | `string`                    | —              | OCI ref to bake from, e.g. `"oven/bun:slim"`.                |
| `tag`           | `string`                    | —              | Local tag to load the result under.                          |
| `provision`     | `string`                    | —              | POSIX-sh, run as **root** in the base VM. See constraints.   |
| `log`           | `(message: string) => void` | none           | Progress sink.                                               |
| `stepTimeoutMs` | `number`                    | `480_000`      | Hard ceiling per `msb` step; trips only on a wedged step.    |

### `imageExists(tag): Promise<boolean>`

`true` when the tag is in microsandbox's local cache. A missing image is `false`;
a missing/broken runtime throws (it is not silently reported as "absent").

### `warmImage(tag, options?): Promise<void>`

Boots and immediately stops a throwaway VM to prime the layer cache, so the first
real boot of `tag` is fast. `options`: `{ name?, memoryMb? }`.

### Errors

Every failure throws a single type, **`ImageBakeError`**, with `.cause` (the
underlying fault) and an optional `.step` naming the stage that failed
(`"boot" | "provision" | "capture-rootfs" | "load" | …`):

```ts
import { ImageBakeError } from "@xagents/microsandbox-image";

try {
  await bakeImage({ baseImage, tag, provision });
} catch (e) {
  if (e instanceof ImageBakeError) console.error(`bake failed at ${e.step}:`, e.cause);
  else throw e;
}
```

## The `provision` script — three hard constraints

The script runs via `msb exec … bash -lc "<script>"`. That transport shapes what
works:

1. **POSIX-sh only, no bashisms.** So the exact same script also works in a
   Dockerfile `RUN` if you ever migrate. (`[[ … ]]`, arrays, etc. are out.)
2. **No heredocs.** A heredoc body stalls the `msb exec` stream. Write files with
   `printf` instead.
3. **Quiet.** Chatty output (e.g. bare `apt-get install`) also stalls the stream —
   redirect it: `apt-get install -y -qq … >/dev/null`.

A realistic example (grant a non-root user passwordless `apt`):

```sh
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends sudo >/dev/null
useradd -m -s /bin/bash worker
printf '%s ALL=(ALL) NOPASSWD:ALL\n' worker > /etc/sudoers.d/worker
chmod 0440 /etc/sudoers.d/worker
```

## How it works (internals)

The bake is deliberately builder-free — it only needs the `msb` CLI:

1. **Boot** `msb run -d … <baseImage> -- sleep 3600` — a throwaway VM we drive by
   name, torn down in `finally` no matter what.
2. **Provision** `msb exec -u root <vm> -- bash -lc "<provision>"`.
3. **Capture** `tar` the live `/` (minus `./proc`, `./sys`, and the layer file
   itself) into one archive. tar's `exit 1` is tolerated: a live rootfs emits
   benign "file changed as we read it" warnings, but the point-in-time snapshot is
   sound. Its stderr is discarded.
4. **Assemble** a Docker `save`-format archive on the host — `layer.tar` plus a
   `config.json` (the base image's `Env`/`Cmd`/`Entrypoint`/`WorkingDir` carried
   forward, rootfs pointing at the layer's `sha256:<diffId>`) and a `manifest.json`
   tying them to the tag. These pure helpers are exported (`renderImageConfig`,
   `renderManifest`, `sha256Hex`) and the config is **byte-stable** — a fixed epoch
   timestamp, no wall-clock — so an unchanged rootfs bakes to an identical config.
5. **Load** `msb image load -i <archive> -t <tag>`.

**Why the `msb` CLI and not the microsandbox SDK?** The SDK's `exec` buffers all
output and returns at the end, which stalls on the minutes-long, output-less
`tar`. `msb exec` streams, so the step completes.

## Testing

Pure archive-assembly logic is covered by fast unit tests:

```sh
vitest run packages/microsandbox-image   # runs the pure tests
```

The end-to-end bake boots real microVMs, so it is opt-in:

```sh
MICROSANDBOX_IMAGE_SMOKE=1 vitest run packages/microsandbox-image
```

The native `microsandbox` addon must not load under `bun test`; the Node/native
tests are named `*.node.test.ts` and run under vitest only.
