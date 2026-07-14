/**
 * Default OCI image materialized agents' sandboxes boot into.
 *
 * We override eve's default (`ghcr.io/vercel/eve:latest`, multi-GB and slow to
 * pull) with a small, fast image that still has bash + coreutils + python + pip
 * — enough for eve's built-in sandbox tools and Python-based skill scripts.
 * Every boot after the first pull is cached and sub-second.
 */
export const SANDBOX_DEFAULT_IMAGE = "python:3.12-slim";
