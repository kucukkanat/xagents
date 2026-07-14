import { parseArgs } from "node:util";

/**
 * Pure argument parsing for the `microsandbox-image` CLI. Kept free of any
 * native/microsandbox import (only `node:util`) so it unit-tests without booting
 * a VM; ./cli does the effectful dispatch and ./bin is the shebang entry.
 */

/** A user-facing "you invoked it wrong" error (exit code 2), distinct from bake failures. */
export class UsageError extends Error {
  override readonly name = "UsageError";
}

/** Where the provision script comes from — resolved to text later, in ./cli. */
export type ProvisionSource =
  | { readonly from: "inline"; readonly value: string }
  | { readonly from: "file"; readonly path: string }
  | { readonly from: "stdin" };

export interface BakeCommand {
  readonly kind: "bake" | "ensure";
  readonly baseImage: string;
  readonly tag: string;
  readonly provision: ProvisionSource;
  readonly stepTimeoutMs: number | undefined;
  readonly quiet: boolean;
}
export interface WarmCommand {
  readonly kind: "warm";
  readonly tag: string;
  readonly name: string | undefined;
  readonly memoryMb: number | undefined;
}
export interface ExistsCommand {
  readonly kind: "exists";
  readonly tag: string;
}
export type Command =
  | BakeCommand
  | WarmCommand
  | ExistsCommand
  | { readonly kind: "help" }
  | { readonly kind: "version" };

export const HELP = `microsandbox-image — bake custom microsandbox microVM images (no Docker)

Usage:
  microsandbox-image bake   -b <base> -t <tag> (-f <file> | -p <script> | --provision-stdin) [--step-timeout <ms>] [-q]
  microsandbox-image ensure -b <base> -t <tag> (-f <file> | -p <script> | --provision-stdin) [--step-timeout <ms>] [-q]
  microsandbox-image warm   -t <tag> [--name <name>] [--memory <mib>]
  microsandbox-image exists -t <tag>
  microsandbox-image --help | --version

Commands:
  bake     Bake the image unconditionally.
  ensure   Bake only if the tag is not already in the local cache.
  warm     Boot and stop the tag once to prime the boot cache.
  exists   Print true/false; exit 0 if the tag exists, 1 otherwise.

Options:
  -b, --base <ref>             Base image to bake from (e.g. oven/bun:slim).
  -t, --tag <tag>              Local tag to load/check.
  -f, --provision-file <path>  Read the root-run provision script from a file.
  -p, --provision <script>     Inline provision script.
      --provision-stdin        Read the provision script from stdin.
      --step-timeout <ms>      Per-step timeout (default 480000).
      --name <name>            Warm VM name (default microsandbox-warm).
      --memory <mib>           Warm VM memory in MiB (default 512).
  -q, --quiet                  Suppress progress output.
  -h, --help                   Show this help.
  -v, --version                Print the version.

The provision script runs as root inside the base VM. Keep it POSIX-sh,
heredoc-free, and quiet (redirect chatty output) — see the README.
`;

const OPTIONS = {
  base: { type: "string", short: "b" },
  tag: { type: "string", short: "t" },
  "provision-file": { type: "string", short: "f" },
  provision: { type: "string", short: "p" },
  "provision-stdin": { type: "boolean" },
  "step-timeout": { type: "string" },
  name: { type: "string" },
  memory: { type: "string" },
  quiet: { type: "boolean", short: "q" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** Require a non-empty string option, else fail with a usage error. */
const required = (value: string | undefined, flag: string): string => {
  if (value === undefined || value === "") throw new UsageError(`${flag} is required`);
  return value;
};

/** Parse an optional positive-integer option, else fail with a usage error. */
const positiveInt = (value: string | undefined, flag: string): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`${flag} must be a positive integer`);
  return n;
};

/** Pick exactly one provision source from the mutually-exclusive flags. */
const provisionSource = (
  file: string | undefined,
  inline: string | undefined,
  stdin: boolean,
): ProvisionSource => {
  const count = (file !== undefined ? 1 : 0) + (inline !== undefined ? 1 : 0) + (stdin ? 1 : 0);
  if (count === 0) {
    throw new UsageError("a provision script is required (-f <file>, -p <script>, or --provision-stdin)");
  }
  if (count > 1) {
    throw new UsageError("provide exactly one of --provision-file, --provision, or --provision-stdin");
  }
  if (file !== undefined) return { from: "file", path: file };
  if (inline !== undefined) return { from: "inline", value: inline };
  return { from: "stdin" };
};

/**
 * Parse CLI argv into a {@link Command}. Throws {@link UsageError} on any bad
 * invocation (unknown flag/command, missing required option, ambiguous provision
 * source), so ./cli can render help and exit 2 uniformly.
 */
export const parseCliArgs = (argv: readonly string[]): Command => {
  const { values, positionals } = (() => {
    try {
      return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
    } catch (cause) {
      throw new UsageError(cause instanceof Error ? cause.message : String(cause));
    }
  })();

  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };

  const command = positionals[0];
  if (command === undefined) {
    throw new UsageError("no command given (try bake, ensure, warm, exists, or --help)");
  }

  switch (command) {
    case "bake":
    case "ensure":
      return {
        kind: command,
        baseImage: required(values.base, "--base"),
        tag: required(values.tag, "--tag"),
        provision: provisionSource(values["provision-file"], values.provision, values["provision-stdin"] === true),
        stepTimeoutMs: positiveInt(values["step-timeout"], "--step-timeout"),
        quiet: values.quiet === true,
      };
    case "warm":
      return {
        kind: "warm",
        tag: required(values.tag, "--tag"),
        name: values.name,
        memoryMb: positiveInt(values.memory, "--memory"),
      };
    case "exists":
      return { kind: "exists", tag: required(values.tag, "--tag") };
    default:
      throw new UsageError(`unknown command "${command}" (try bake, ensure, warm, exists, or --help)`);
  }
};
