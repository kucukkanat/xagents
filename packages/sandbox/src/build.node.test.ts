import { describe, expect, it } from "vitest";

/**
 * End-to-end bake smoke test. Boots real microVMs, so it is opt-in behind
 * SANDBOX_SMOKE and must run under Node (never `bun test`) — hence the dynamic
 * imports, which keep the native `microsandbox` addon out of the default run:
 *
 *   SANDBOX_SMOKE=1 vitest run packages/sandbox
 */
const SMOKE = process.env.SANDBOX_SMOKE === "1";
const smokeIt = SMOKE ? it : it.skip;

describe("buildSandboxImage (smoke)", () => {
  smokeIt(
    "bakes an image where the non-root sandbox user can apt-get install",
    async () => {
      const { ensureSandboxImage, sandboxImageExists } = await import("./build");
      const { SANDBOX_DEFAULT_IMAGE } = await import("./image");
      const { SANDBOX_USER } = await import("./provision");
      const { Sandbox } = await import("microsandbox");

      const result = await ensureSandboxImage({ log: (m) => console.log(m) });
      expect(result.ok).toBe(true);
      expect(await sandboxImageExists()).toBe(true);

      const sb = await Sandbox.builder("xagents-bake-smoke")
        .image(SANDBOX_DEFAULT_IMAGE)
        .memory(1024)
        .replace()
        .ephemeral(true)
        .create();
      try {
        const out = await sb.execWith("bash", (b) =>
          b
            .args([
              "-lc",
              "whoami && sudo -n true && apt-get install -y -qq tree >/dev/null 2>&1 && tree --version | head -1",
            ])
            .user(SANDBOX_USER),
        );
        expect(out.code).toBe(0);
        expect(out.stdout()).toContain(SANDBOX_USER); // agents genuinely run non-root
        expect(out.stdout().toLowerCase()).toContain("tree v");
      } finally {
        await sb.stop().catch(() => {});
      }
    },
    600_000,
  );
});
