import { describe, expect, it } from "vitest";
import { PROVISION_SCRIPT, SANDBOX_USER } from "./provision";

describe("PROVISION_SCRIPT", () => {
  it("targets eve's hardcoded sandbox user", () => {
    // If this ever drifts from eve's MICROSANDBOX_USER, the sudoers grant and
    // shims would apply to the wrong identity and apt would silently still fail.
    expect(SANDBOX_USER).toBe("vercel-sandbox");
  });

  it("installs sudo and grants the sandbox user passwordless sudo", () => {
    expect(PROVISION_SCRIPT).toContain("apt-get install -y -qq --no-install-recommends sudo");
    expect(PROVISION_SCRIPT).toContain(`%s ALL=(ALL) NOPASSWD:ALL\\n' ${SANDBOX_USER} > /etc/sudoers.d/${SANDBOX_USER}`);
    expect(PROVISION_SCRIPT).toContain(`chmod 0440 /etc/sudoers.d/${SANDBOX_USER}`);
  });

  it("pre-creates the sandbox user idempotently", () => {
    expect(PROVISION_SCRIPT).toContain(
      `id -u ${SANDBOX_USER} >/dev/null 2>&1 || useradd -m -s /bin/bash ${SANDBOX_USER}`,
    );
  });

  it("installs transparent apt + apt-get shims that escalate via sudo", () => {
    expect(PROVISION_SCRIPT).toContain("for prog in apt apt-get; do");
    expect(PROVISION_SCRIPT).toContain(
      `exec sudo -n env DEBIAN_FRONTEND=noninteractive /usr/bin/%s "$@"`,
    );
    expect(PROVISION_SCRIPT).toContain("> /usr/local/bin/$prog");
    expect(PROVISION_SCRIPT).toContain("chmod 0755 /usr/local/bin/$prog");
  });

  it("runs apt quietly and heredoc-free (both stall over `msb exec`)", () => {
    expect(PROVISION_SCRIPT).toContain("apt-get install -y -qq");
    expect(PROVISION_SCRIPT).toContain(">/dev/null");
    expect(PROVISION_SCRIPT).not.toContain("<<'"); // no heredocs
  });

  it("stays POSIX-sh (no bashisms) so it runs under sh and Dockerfile RUN", () => {
    expect(PROVISION_SCRIPT).toContain("set -eu");
    expect(PROVISION_SCRIPT).not.toContain("[[");
  });
});
