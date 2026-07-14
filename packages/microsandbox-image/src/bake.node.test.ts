import { describe, expect, it } from "vitest";

/**
 * End-to-end bake smoke test. Boots real microVMs, so it is opt-in behind
 * MICROSANDBOX_IMAGE_SMOKE and must run under Node (never `bun test`) — hence the
 * dynamic imports, which keep the native `microsandbox` addon out of the default
 * run:
 *
 *   MICROSANDBOX_IMAGE_SMOKE=1 vitest run packages/microsandbox-image
 */
const SMOKE = process.env.MICROSANDBOX_IMAGE_SMOKE === "1";
const smokeIt = SMOKE ? it : it.skip;

const BASE_IMAGE = "oven/bun:slim";
const TAG = "microsandbox-image-smoke:latest";
const MARKER = "/etc/microsandbox-image-smoke";

describe("bakeImage (smoke)", () => {
  smokeIt(
    "bakes a custom image carrying a provision-time marker",
    async () => {
      const { ensureImage, imageExists } = await import("./bake");
      const { Sandbox } = await import("microsandbox");

      const result = await ensureImage({
        baseImage: BASE_IMAGE,
        tag: TAG,
        // POSIX-sh, quiet, heredoc-free — the constraints bakeImage documents.
        provision: `set -eu\nprintf 'baked' > ${MARKER}`,
        log: (m) => console.log(m),
      });
      expect(result.tag).toBe(TAG);
      expect(await imageExists(TAG)).toBe(true);

      const sb = await Sandbox.builder("microsandbox-image-smoke")
        .image(TAG)
        .memory(1024)
        .replace()
        .ephemeral(true)
        .create();
      try {
        const out = await sb.execWith("bash", (b) => b.args(["-lc", `cat ${MARKER}`]));
        expect(out.code).toBe(0);
        expect(out.stdout()).toContain("baked");
      } finally {
        await sb.stop().catch(() => {});
      }
    },
    600_000,
  );
});
