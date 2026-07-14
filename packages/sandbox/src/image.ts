/**
 * Images a materialized agent's sandbox boots into.
 *
 * WHY a custom image: eve boots the microVM and runs EVERY agent command as a
 * non-root user (its hardcoded `vercel-sandbox`; see {@link SANDBOX_USER}), and
 * the stock base image ships no `sudo`. So a bare `apt install …` inside an
 * agent fails with `Permission denied` on `/var/lib/apt/lists/lock`. We fix
 * that by baking a small image, from {@link SANDBOX_BASE_IMAGE}, that grants
 * that user scoped passwordless `sudo` plus transparent `apt` shims — see
 * ./provision (the recipe) and ./build (the no-Docker bake).
 */

/**
 * Base image the sandbox image is baked from. Debian-based (so it has `apt`)
 * and ships Bun — matching this platform's runtime, so JS/TS skill code runs
 * without an extra toolchain. (Python-based skills can `apt install python3`
 * now that `apt` works.)
 */
export const SANDBOX_BASE_IMAGE = "oven/bun:slim";

/**
 * Local tag of the baked image every materialized agent boots into. Built once
 * into microsandbox's image cache by `ensureSandboxImage`. With eve's default
 * `if-missing` pull policy the cached tag is used as-is and never fetched from a
 * registry — it exists only locally — so the image MUST be built before the
 * first agent boots (the server does this at startup).
 */
export const SANDBOX_DEFAULT_IMAGE = "xagents-sandbox:latest";
