import { describe, expect, it } from "vitest";
import { type BakeCommand, type WarmCommand, UsageError, parseCliArgs } from "./cli-args";

describe("parseCliArgs — meta flags", () => {
  it("recognizes --help / -h and --version / -v", () => {
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseCliArgs(["-v"])).toEqual({ kind: "version" });
  });

  it("prefers help over version when both are present", () => {
    expect(parseCliArgs(["--version", "--help"])).toEqual({ kind: "help" });
  });
});

describe("parseCliArgs — bake / ensure", () => {
  it("parses a full bake with a provision file and short flags", () => {
    const cmd = parseCliArgs(["bake", "-b", "oven/bun:slim", "-t", "img:latest", "-f", "./p.sh"]);
    expect(cmd).toEqual({
      kind: "bake",
      baseImage: "oven/bun:slim",
      tag: "img:latest",
      provision: { from: "file", path: "./p.sh" },
      stepTimeoutMs: undefined,
      quiet: false,
    } satisfies BakeCommand);
  });

  it("carries inline provision, --step-timeout, and --quiet through", () => {
    const cmd = parseCliArgs([
      "ensure", "--base", "b", "--tag", "t", "--provision", "set -eu", "--step-timeout", "60000", "--quiet",
    ]);
    expect(cmd).toEqual({
      kind: "ensure",
      baseImage: "b",
      tag: "t",
      provision: { from: "inline", value: "set -eu" },
      stepTimeoutMs: 60000,
      quiet: true,
    } satisfies BakeCommand);
  });

  it("accepts --provision-stdin as the source", () => {
    const cmd = parseCliArgs(["bake", "-b", "b", "-t", "t", "--provision-stdin"]) as BakeCommand;
    expect(cmd.provision).toEqual({ from: "stdin" });
  });

  it("requires --base and --tag", () => {
    expect(() => parseCliArgs(["bake", "-t", "t", "-f", "p"])).toThrow(UsageError);
    expect(() => parseCliArgs(["bake", "-b", "b", "-f", "p"])).toThrow(UsageError);
  });

  it("requires exactly one provision source", () => {
    expect(() => parseCliArgs(["bake", "-b", "b", "-t", "t"])).toThrow(/provision script is required/);
    expect(() => parseCliArgs(["bake", "-b", "b", "-t", "t", "-f", "p", "--provision-stdin"])).toThrow(
      /exactly one/,
    );
  });

  it("rejects a non-positive --step-timeout", () => {
    expect(() => parseCliArgs(["bake", "-b", "b", "-t", "t", "-f", "p", "--step-timeout", "0"])).toThrow(
      /positive integer/,
    );
    expect(() => parseCliArgs(["bake", "-b", "b", "-t", "t", "-f", "p", "--step-timeout", "1.5"])).toThrow(
      UsageError,
    );
  });
});

describe("parseCliArgs — warm / exists", () => {
  it("parses warm with optional name + memory", () => {
    expect(parseCliArgs(["warm", "-t", "t", "--name", "w", "--memory", "1024"])).toEqual({
      kind: "warm",
      tag: "t",
      name: "w",
      memoryMb: 1024,
    } satisfies WarmCommand);
  });

  it("defaults warm name/memory to undefined", () => {
    expect(parseCliArgs(["warm", "-t", "t"])).toEqual({
      kind: "warm",
      tag: "t",
      name: undefined,
      memoryMb: undefined,
    } satisfies WarmCommand);
  });

  it("parses exists", () => {
    expect(parseCliArgs(["exists", "-t", "img:latest"])).toEqual({ kind: "exists", tag: "img:latest" });
  });
});

describe("parseCliArgs — errors", () => {
  it("rejects a missing command", () => {
    expect(() => parseCliArgs([])).toThrow(/no command given/);
  });

  it("rejects an unknown command", () => {
    expect(() => parseCliArgs(["frobnicate"])).toThrow(/unknown command/);
  });

  it("wraps an unknown flag as a UsageError", () => {
    expect(() => parseCliArgs(["bake", "--nope"])).toThrow(UsageError);
  });
});
