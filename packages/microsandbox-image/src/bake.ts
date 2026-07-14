import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Image, ImageNotFoundError } from "microsandbox";
import { type BaseImageConfig, renderImageConfig, renderManifest, sha256Hex } from "./archive";
import { ImageBakeError } from "./errors";
import { DEFAULT_MSB_STEP_TIMEOUT_MS, msb, runProcess } from "./msb";

/** Where inside the VM we stage the captured rootfs layer. */
const GUEST_LAYER_PATH = "/microsandbox-image-rootfs.layer.tar";

/** Sink for progress messages during a bake. */
export type Logger = (message: string) => void;

/** Inputs to {@link bakeImage} / {@link ensureImage}. */
export interface BakeImageOptions {
  /** OCI ref of the base image to bake from (e.g. `"oven/bun:slim"`). */
  readonly baseImage: string;
  /** Local tag to load the baked image under (e.g. `"my-image:latest"`). */
  readonly tag: string;
  /**
   * A POSIX-sh script run as **root** inside the base VM to customize it before
   * the rootfs is snapshotted. Keep it bashism-free and avoid heredocs / chatty
   * output: both stall over `msb exec`.
   */
  readonly provision: string;
  /** Progress sink. */
  readonly log?: Logger;
  /** Per-step timeout override (see {@link DEFAULT_MSB_STEP_TIMEOUT_MS}). */
  readonly stepTimeoutMs?: number;
}

/** Outcome of {@link ensureImage}. */
export interface EnsureImageResult {
  /** The image tag, echoed back for convenience. */
  readonly tag: string;
  /** True when this call baked the image; false when it was already cached. */
  readonly built: boolean;
}

/** Wrap a bake stage so any failure surfaces as a labelled {@link ImageBakeError}. */
const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (cause) {
    if (cause instanceof ImageBakeError) throw cause;
    throw new ImageBakeError(`image bake failed during "${name}"`, { step: name, cause });
  }
};

/** True when `tag` is already in microsandbox's local image cache. */
export const imageExists = async (tag: string): Promise<boolean> => {
  try {
    await Image.get(tag);
    return true;
  } catch (cause) {
    if (cause instanceof ImageNotFoundError) return false;
    // Runtime not installed / other faults must not masquerade as "absent".
    throw new ImageBakeError(`failed to inspect image ${tag}`, { step: "inspect", cause });
  }
};

/**
 * Guarantee `tag` exists, baking it once if missing. A no-op (returns
 * `built: false`) when the image is already cached; otherwise bakes it via
 * {@link bakeImage} and returns `built: true`.
 */
export const ensureImage = async (opts: BakeImageOptions): Promise<EnsureImageResult> => {
  if (await imageExists(opts.tag)) return { tag: opts.tag, built: false };
  opts.log?.(`baking image ${opts.tag} from ${opts.baseImage} (first run only)…`);
  await bakeImage(opts);
  return { tag: opts.tag, built: true };
};

/**
 * Bake a custom microsandbox image without any container builder: boot the base
 * image, run `provision` as root, capture the whole rootfs as one layer, wrap it
 * in a Docker `save`-format archive, and `msb image load` it under `tag`. Runs
 * anywhere microsandbox itself runs, so it needs no Docker/registry.
 *
 * The VM is driven through the `msb` CLI rather than the microsandbox SDK: the
 * SDK's buffered `exec` stalls on the minutes-long, output-less `tar`, whereas
 * `msb exec` streams it cleanly. Throws {@link ImageBakeError} on any failure.
 */
export const bakeImage = async (opts: BakeImageOptions): Promise<void> => {
  const { baseImage, tag, provision, log } = opts;
  const timeout = opts.stepTimeoutMs ?? DEFAULT_MSB_STEP_TIMEOUT_MS;
  const run = (args: readonly string[]): Promise<string> => msb(args, timeout);

  const dir = await mkdtemp(join(tmpdir(), "microsandbox-img-"));
  const archive = `${dir}.tar`;
  // A throwaway VM we drive by name. `sleep` keeps it alive while we provision;
  // it is removed in `finally` regardless of outcome.
  const vm = (await step("boot", () => run(["run", "-d", "--no-tty", baseImage, "--", "sleep", "3600"]))).trim();
  try {
    const base = await step("inspect-base", () => inspectBase(baseImage));

    log?.("provisioning base…");
    await step("provision", () => run(["exec", "-u", "root", vm, "--", "bash", "-lc", provision]));

    log?.("capturing rootfs layer…");
    // Discard tar's stderr and tolerate its exit 1: tarring a live `/` emits
    // benign "file changed as we read it" / "socket ignored" warnings that would
    // otherwise fail the step even though the point-in-time snapshot is sound.
    await step("capture-rootfs", () =>
      run([
        "exec",
        "-u",
        "root",
        vm,
        "--",
        "bash",
        "-lc",
        `tar --numeric-owner -C / --exclude=./proc --exclude=./sys --exclude=.${GUEST_LAYER_PATH} -cf ${GUEST_LAYER_PATH} . 2>/dev/null; rc=$?; [ "$rc" -le 1 ]`,
      ]),
    );

    log?.("assembling image archive…");
    const layerName = "layer.tar";
    const layerPath = join(dir, layerName);
    await step("copy-layer", () => run(["copy", `${vm}:${GUEST_LAYER_PATH}`, layerPath]));
    const diffId = await step("hash-layer", () => sha256File(layerPath));
    const configJson = renderImageConfig(base, diffId);
    const configName = `${sha256Hex(configJson)}.json`;
    await writeFile(join(dir, configName), configJson);
    await writeFile(join(dir, "manifest.json"), renderManifest(configName, tag, layerName));
    // Archive lives outside `dir` so `tar` never tries to include itself.
    await step("pack-archive", () =>
      runProcess("tar", ["-C", dir, "-cf", archive, configName, "manifest.json", layerName], "packing the image archive failed"),
    );

    log?.(`loading ${tag} into the image cache…`);
    await step("load", () => run(["image", "load", "-i", archive, "-t", tag]));
  } finally {
    await run(["stop", vm]).catch(() => {});
    await run(["rm", vm]).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await rm(archive, { force: true }).catch(() => {});
  }
};

/** Read the base image's runtime config (present because `msb run` pulled it). */
const inspectBase = async (baseImage: string): Promise<BaseImageConfig> => {
  const detail = await Image.inspect(baseImage);
  const { config } = detail;
  const { architecture, os } = detail.handle;
  if (config === null || architecture === null || os === null) {
    throw new ImageBakeError(`base image ${baseImage} is missing config/architecture/os metadata`, {
      step: "inspect-base",
    });
  }
  return {
    architecture,
    os,
    env: config.env,
    cmd: config.cmd,
    entrypoint: config.entrypoint,
    workingDir: config.workingDir,
  };
};

/** Streaming SHA-256 of a (large) file — the layer's uncompressed diff id. */
const sha256File = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
