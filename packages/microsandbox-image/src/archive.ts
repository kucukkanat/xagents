import { createHash } from "node:crypto";

/**
 * Pure helpers that assemble a single-layer Docker `save`-format image archive —
 * the format `msb image load` consumes. Kept free of any native/microsandbox
 * import so they unit-test under plain `bun test`; ./bake does the imperative VM
 * work and calls these to produce the `config`/`manifest` JSON.
 */

/** Fixed, so an unchanged rootfs bakes to a byte-stable config (no clock). */
const IMAGE_CREATED = "1970-01-01T00:00:00Z";

/** The subset of a base image's config we carry onto the baked image. */
export interface BaseImageConfig {
  readonly architecture: string;
  readonly os: string;
  readonly env: readonly string[];
  readonly cmd: readonly string[] | null;
  readonly entrypoint: readonly string[] | null;
  readonly workingDir: string | null;
}

/** Lowercase hex SHA-256 of `data` — used for layer diff ids and config names. */
export const sha256Hex = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

/**
 * Docker image config JSON for an image whose entire rootfs is the single
 * uncompressed layer identified by `layerDiffId` (a bare hex digest). We keep
 * the base image's runtime config (Env/Cmd/Entrypoint/WorkingDir) so the baked
 * image behaves like its base; only the rootfs and history are replaced.
 */
export const renderImageConfig = (base: BaseImageConfig, layerDiffId: string): string =>
  JSON.stringify({
    architecture: base.architecture,
    os: base.os,
    config: {
      Env: [...base.env],
      ...(base.cmd === null ? {} : { Cmd: [...base.cmd] }),
      ...(base.entrypoint === null ? {} : { Entrypoint: [...base.entrypoint] }),
      ...(base.workingDir === null ? {} : { WorkingDir: base.workingDir }),
    },
    rootfs: { type: "layers", diff_ids: [`sha256:${layerDiffId}`] },
    history: [{ created: IMAGE_CREATED, created_by: "microsandbox-image bake" }],
  });

/** `manifest.json` tying the config file and single layer to the image tag. */
export const renderManifest = (
  configFileName: string,
  tag: string,
  layerFileName: string,
): string =>
  JSON.stringify([{ Config: configFileName, RepoTags: [tag], Layers: [layerFileName] }]);
