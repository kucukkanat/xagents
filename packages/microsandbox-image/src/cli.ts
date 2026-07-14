import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { bakeImage, ensureImage, imageExists } from "./bake";
import { warmImage } from "./warm";
import { ImageBakeError } from "./errors";
import { type ProvisionSource, HELP, UsageError, parseCliArgs } from "./cli-args";

/**
 * Effectful CLI runner. Parses argv (via ./cli-args), resolves the provision
 * script source, dispatches to the ./bake and ./warm library API, and maps
 * outcomes to conventional exit codes: 0 success, 1 bake/runtime failure,
 * 2 usage error. Progress goes to stderr so stdout carries only the result
 * (the tag, or `true`/`false`) for piping.
 */

const readVersion = (): string => {
  // Runtime require (not a static import) so the JSON stays outside `rootDir`.
  const require_ = createRequire(import.meta.url);
  const pkg = require_("../package.json") as { readonly version: string };
  return pkg.version;
};

const readStdin = async (): Promise<string> => {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
};

const readProvision = async (source: ProvisionSource): Promise<string> => {
  switch (source.from) {
    case "inline":
      return source.value;
    case "file":
      return readFile(source.path, "utf8");
    case "stdin":
      return readStdin();
  }
};

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** Progress logger for a command, unless `quiet`. */
const progress = (quiet: boolean): ((message: string) => void) | undefined =>
  quiet ? undefined : (m) => process.stderr.write(`  ${m}\n`);

export const run = async (argv: readonly string[]): Promise<number> => {
  let command;
  try {
    command = parseCliArgs(argv);
  } catch (cause) {
    if (cause instanceof UsageError) {
      process.stderr.write(`error: ${cause.message}\n\n${HELP}`);
      return 2;
    }
    throw cause;
  }

  try {
    switch (command.kind) {
      case "help":
        process.stdout.write(HELP);
        return 0;
      case "version":
        process.stdout.write(`${readVersion()}\n`);
        return 0;
      case "bake": {
        const log = progress(command.quiet);
        await bakeImage({
          baseImage: command.baseImage,
          tag: command.tag,
          provision: await readProvision(command.provision),
          ...(log === undefined ? {} : { log }),
          ...(command.stepTimeoutMs === undefined ? {} : { stepTimeoutMs: command.stepTimeoutMs }),
        });
        process.stdout.write(`${command.tag}\n`);
        return 0;
      }
      case "ensure": {
        const log = progress(command.quiet);
        const { tag, built } = await ensureImage({
          baseImage: command.baseImage,
          tag: command.tag,
          provision: await readProvision(command.provision),
          ...(log === undefined ? {} : { log }),
          ...(command.stepTimeoutMs === undefined ? {} : { stepTimeoutMs: command.stepTimeoutMs }),
        });
        process.stderr.write(built ? `baked ${tag}\n` : `already cached ${tag}\n`);
        process.stdout.write(`${tag}\n`);
        return 0;
      }
      case "warm": {
        await warmImage(command.tag, {
          ...(command.name === undefined ? {} : { name: command.name }),
          ...(command.memoryMb === undefined ? {} : { memoryMb: command.memoryMb }),
        });
        process.stderr.write(`warmed ${command.tag}\n`);
        return 0;
      }
      case "exists": {
        const exists = await imageExists(command.tag);
        process.stdout.write(`${exists}\n`);
        return exists ? 0 : 1;
      }
      default: {
        const unreachable: never = command;
        throw unreachable;
      }
    }
  } catch (cause) {
    if (cause instanceof ImageBakeError) {
      const at = cause.step === undefined ? "" : ` [${cause.step}]`;
      process.stderr.write(`error${at}: ${cause.message}\n`);
      if (cause.cause !== undefined) process.stderr.write(`  cause: ${describe(cause.cause)}\n`);
      return 1;
    }
    process.stderr.write(`error: ${describe(cause)}\n`);
    return 1;
  }
};
