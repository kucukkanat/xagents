import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Thin wrappers for driving the bundled `msb` CLI (microsandbox's package bin)
 * and generic subprocesses. ./bake uses these rather than the microsandbox SDK
 * for the VM work: the SDK's buffered `exec` stalls on the minutes-long,
 * output-less `tar`, whereas `msb exec` streams it cleanly.
 */

/**
 * Default hard ceiling on any single `msb` step. A bake normally finishes in
 * 1–2 min; this only trips on a genuinely stuck step (e.g. a wedged `apt`
 * download), so the bake fails loudly and the VM is cleaned up rather than
 * hanging forever. Override per-bake via `BakeImageOptions.stepTimeoutMs`.
 */
export const DEFAULT_MSB_STEP_TIMEOUT_MS = 8 * 60_000;

const require_ = createRequire(import.meta.url);

/** Absolute path to the bundled `msb` CLI (`microsandbox`'s package bin). */
const msbBin = (): string => {
  // microsandbox's `exports` map exposes neither `./package.json` nor a CJS main,
  // so anchor on its CJS-resolvable `./native` subpath and walk up to the package
  // root (the dir holding package.json).
  let root = dirname(require_.resolve("microsandbox/native"));
  while (!existsSync(join(root, "package.json"))) {
    const up = dirname(root);
    if (up === root) throw new Error("could not locate the microsandbox package root");
    root = up;
  }
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const binRel = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin?.microsandbox ?? pkg.bin?.msb);
  if (binRel === undefined) throw new Error("microsandbox package.json has no `bin` entry to invoke");
  return join(root, binRel);
};

/** Run an `msb` subcommand (via the running Node binary), returning its stdout. */
export const msb = (
  args: readonly string[],
  timeoutMs: number = DEFAULT_MSB_STEP_TIMEOUT_MS,
): Promise<string> =>
  runProcess(process.execPath, [msbBin(), ...args], `msb ${args[0] ?? ""} failed`, timeoutMs);

/** Spawn a process, resolve with captured stdout, reject with stderr/timeout on failure. */
export const runProcess = (
  cmd: string,
  args: readonly string[],
  failMessage: string,
  timeoutMs?: number,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`${failMessage}: timed out after ${timeoutMs}ms`));
          }, timeoutMs);
    const done = <T>(fn: (value: T) => void, value: T): void => {
      if (timer !== undefined) clearTimeout(timer);
      fn(value);
    };
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => done(reject, error));
    child.once("close", (code) =>
      code === 0
        ? done(resolve, stdout)
        : done(reject, new Error(`${failMessage} (exit ${code ?? "?"}): ${stderr.trim().slice(-2000)}`)),
    );
  });
