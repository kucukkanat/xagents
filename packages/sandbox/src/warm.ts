import { Sandbox } from "microsandbox";
import { type AppError, type Result, appError, err, ok } from "@xagents/core";
import { SANDBOX_DEFAULT_IMAGE } from "./image";

/**
 * Prime the local microsandbox layer cache by booting and immediately stopping
 * a throwaway microVM. Run this in the background at startup so the first agent
 * chat that touches a sandbox tool doesn't pay the first-pull latency mid-turn.
 * The cache is shared by image ref, so this warms exactly what eve reuses.
 */
export const warmSandboxImage = async (
  image: string = SANDBOX_DEFAULT_IMAGE,
): Promise<Result<{ readonly image: string }, AppError>> => {
  try {
    // `replace` + `ephemeral` avoid a name collision with a leftover warm VM
    // from a prior run and auto-delete this throwaway on stop.
    const sb = await Sandbox.builder("xagents-warm")
      .image(image)
      .memory(512)
      .replace()
      .ephemeral(true)
      .create();
    await sb.stop();
    return ok({ image });
  } catch (cause) {
    return err(appError("sandbox_error", `failed to warm sandbox image ${image}`, cause));
  }
};
