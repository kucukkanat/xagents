import { bakeImage, ensureImage, imageExists } from "@xagents/microsandbox-image";
import { type AppError, type Result, appError, err, ok } from "@xagents/core";
import { SANDBOX_BASE_IMAGE, SANDBOX_DEFAULT_IMAGE } from "./image";
import { PROVISION_SCRIPT } from "./provision";

/**
 * The xagents sandbox-image recipe. This is the caller side of the generic
 * {@link https://npm.im/@xagents/microsandbox-image} baker: it pins *what* to
 * bake — the {@link SANDBOX_BASE_IMAGE} base, the {@link SANDBOX_DEFAULT_IMAGE}
 * tag, and the {@link PROVISION_SCRIPT} recipe (sudo + apt shims for eve's
 * non-root user) — and wraps the library's throwing API back into this repo's
 * `Result` model. The no-Docker bake mechanics live entirely in the library.
 */

type Logger = (message: string) => void;

/** True when the baked image tag is already in microsandbox's local cache. */
export const sandboxImageExists = (
  tag: string = SANDBOX_DEFAULT_IMAGE,
): Promise<boolean> => imageExists(tag);

/** Bake {@link SANDBOX_DEFAULT_IMAGE} unconditionally (see the baker library). */
export const buildSandboxImage = (log?: Logger): Promise<void> =>
  bakeImage({
    baseImage: SANDBOX_BASE_IMAGE,
    tag: SANDBOX_DEFAULT_IMAGE,
    provision: PROVISION_SCRIPT,
    ...(log === undefined ? {} : { log }),
  });

/**
 * Guarantee the baked sandbox image exists before any agent boots. No-op when it
 * is already cached; otherwise bakes it once from {@link SANDBOX_BASE_IMAGE}.
 */
export const ensureSandboxImage = async (
  opts: { readonly log?: Logger } = {},
): Promise<Result<{ readonly image: string; readonly built: boolean }, AppError>> => {
  try {
    const { built } = await ensureImage({
      baseImage: SANDBOX_BASE_IMAGE,
      tag: SANDBOX_DEFAULT_IMAGE,
      provision: PROVISION_SCRIPT,
      ...(opts.log === undefined ? {} : { log: opts.log }),
    });
    return ok({ image: SANDBOX_DEFAULT_IMAGE, built });
  } catch (cause) {
    return err(appError("sandbox_error", `failed to build sandbox image ${SANDBOX_DEFAULT_IMAGE}`, cause));
  }
};
