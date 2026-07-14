import { warmImage } from "@xagents/microsandbox-image";
import { type AppError, type Result, appError, err, ok } from "@xagents/core";
import { SANDBOX_DEFAULT_IMAGE } from "./image";

/**
 * Prime the local microsandbox layer cache for the baked sandbox image by
 * booting and immediately stopping a throwaway microVM. Run this in the
 * background at startup (after the image is built — see `ensureSandboxImage`) so
 * the first agent chat that touches a sandbox tool doesn't pay first-boot
 * latency mid-turn. Wraps the generic `warmImage` baker into this repo's
 * `Result` model.
 */
export const warmSandboxImage = async (
  image: string = SANDBOX_DEFAULT_IMAGE,
): Promise<Result<{ readonly image: string }, AppError>> => {
  try {
    await warmImage(image, { name: "xagents-warm" });
    return ok({ image });
  } catch (cause) {
    return err(appError("sandbox_error", `failed to warm sandbox image ${image}`, cause));
  }
};
