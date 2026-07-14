import { describe, expect, it } from "vitest";
import { type BaseImageConfig, renderImageConfig, renderManifest, sha256Hex } from "./archive";

const BASE: BaseImageConfig = {
  architecture: "arm64",
  os: "linux",
  env: ["PATH=/usr/local/bin:/usr/bin", "BUN_INSTALL_BIN=/usr/local/bin"],
  cmd: ["/usr/local/bin/bun"],
  entrypoint: ["/usr/local/bin/docker-entrypoint.sh"],
  workingDir: "/home/bun/app",
};

describe("sha256Hex", () => {
  it("matches the known empty-string digest", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("renderImageConfig", () => {
  const diffId = "a".repeat(64);
  const config = JSON.parse(renderImageConfig(BASE, diffId));

  it("carries the base runtime config onto a single-layer rootfs", () => {
    expect(config.architecture).toBe("arm64");
    expect(config.os).toBe("linux");
    expect(config.config.Env).toEqual(BASE.env);
    expect(config.config.Cmd).toEqual(BASE.cmd);
    expect(config.config.Entrypoint).toEqual(BASE.entrypoint);
    expect(config.config.WorkingDir).toBe(BASE.workingDir);
    expect(config.rootfs).toEqual({ type: "layers", diff_ids: [`sha256:${diffId}`] });
  });

  it("omits null optional fields rather than emitting nulls", () => {
    const minimal = JSON.parse(renderImageConfig({ ...BASE, cmd: null, entrypoint: null, workingDir: null }, diffId));
    expect("Cmd" in minimal.config).toBe(false);
    expect("Entrypoint" in minimal.config).toBe(false);
    expect("WorkingDir" in minimal.config).toBe(false);
  });

  it("is byte-stable for an unchanged rootfs (no wall-clock in the config)", () => {
    expect(renderImageConfig(BASE, diffId)).toBe(renderImageConfig(BASE, diffId));
  });
});

describe("renderManifest", () => {
  it("ties the config file, tag, and layer together", () => {
    const manifest = JSON.parse(renderManifest("cfg.json", "my-image:latest", "layer.tar"));
    expect(manifest).toEqual([
      { Config: "cfg.json", RepoTags: ["my-image:latest"], Layers: ["layer.tar"] },
    ]);
  });
});
