import { Sandbox } from "microsandbox";
import { ImageBakeError } from "./errors";

/** Tuning for {@link warmImage}. */
export interface WarmImageOptions {
  /** Name of the throwaway warm VM. Defaults to `"microsandbox-warm"`. */
  readonly name?: string;
  /** Memory (MiB) for the throwaway VM. Defaults to 512. */
  readonly memoryMb?: number;
}

/**
 * Prime the local microsandbox layer cache by booting and immediately stopping a
 * throwaway microVM from `tag`. Run this in the background after the image is
 * baked so the first workload that boots the image doesn't pay first-boot
 * latency. The cache is keyed by image ref, so this warms exactly the tag your
 * workloads reuse. Throws {@link ImageBakeError} on failure.
 */
export const warmImage = async (tag: string, opts: WarmImageOptions = {}): Promise<void> => {
  try {
    // `replace` + `ephemeral` avoid a name collision with a leftover warm VM
    // from a prior run and auto-delete this throwaway on stop.
    const sb = await Sandbox.builder(opts.name ?? "microsandbox-warm")
      .image(tag)
      .memory(opts.memoryMb ?? 512)
      .replace()
      .ephemeral(true)
      .create();
    await sb.stop();
  } catch (cause) {
    throw new ImageBakeError(`failed to warm image ${tag}`, { step: "warm", cause });
  }
};
