/**
 * The user eve runs EVERY agent command as inside the microVM. This is eve's
 * hardcoded `MICROSANDBOX_USER`, and we must match it exactly: the sudoers
 * grant and `apt` shims below only help if they target the identity agents
 * actually run as. eve's base-runtime setup creates this user with a plain
 * `useradd` (no privileges) only if it doesn't already exist — we pre-create it
 * in the image so that check is a no-op and our configuration survives.
 *
 * There is no public eve option to change this, so if a future eve release
 * renames the user, this must be updated in lockstep.
 */
export const SANDBOX_USER = "vercel-sandbox";

/**
 * Root-run script that turns a stock Debian/Bun image into one where the
 * non-root {@link SANDBOX_USER} can use `apt`:
 *   - installs `sudo` and grants that user passwordless sudo,
 *   - pre-creates the user (see above),
 *   - drops `apt`/`apt-get` shims ahead of `/usr/bin` on PATH so a bare
 *     `apt install X` transparently escalates via sudo — agents never need to
 *     know, or care, that they run non-root.
 *
 * Kept POSIX-sh (no bashisms) so it runs identically whether executed via
 * `bash -lc` during the bake (./build) or a Dockerfile `RUN`. apt is run quietly
 * with stdout discarded, and the shims are written with `printf` rather than
 * heredocs: driven over `msb exec`, verbose apt output and heredoc bodies both
 * stall the exec, so we avoid them.
 */
export const PROVISION_SCRIPT = `set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends sudo ca-certificates >/dev/null
id -u ${SANDBOX_USER} >/dev/null 2>&1 || useradd -m -s /bin/bash ${SANDBOX_USER}
printf '%s ALL=(ALL) NOPASSWD:ALL\\n' ${SANDBOX_USER} > /etc/sudoers.d/${SANDBOX_USER}
chmod 0440 /etc/sudoers.d/${SANDBOX_USER}
for prog in apt apt-get; do
  printf '#!/bin/sh\\nexec sudo -n env DEBIAN_FRONTEND=noninteractive /usr/bin/%s "$@"\\n' "$prog" > /usr/local/bin/$prog
  chmod 0755 /usr/local/bin/$prog
done
`;
