/** Options carried on an {@link ImageBakeError}. */
export interface ImageBakeErrorOptions {
  /** The bake stage that failed (e.g. "provision", "capture-rootfs", "load"). */
  readonly step?: string;
  /** The underlying error/rejection, preserved for diagnosis. */
  readonly cause?: unknown;
}

/**
 * The single error type this package throws. Every failure — a missing runtime,
 * a wedged `apt` download, a non-zero `msb` exit — surfaces as an
 * `ImageBakeError` whose `.cause` holds the original fault and whose optional
 * `.step` names the stage that failed, so callers can `catch` one type and still
 * see exactly what went wrong.
 */
export class ImageBakeError extends Error {
  override readonly name = "ImageBakeError";
  /** The bake stage that failed, when the failure is attributable to one. */
  readonly step: string | undefined;

  constructor(message: string, options: ImageBakeErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.step = options.step;
  }
}
