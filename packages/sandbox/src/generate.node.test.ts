import { describe, expect, it } from "vitest";
import type { SandboxBackendKind } from "./backend-kind";
import { defineAgentSandbox } from "./define";
import { generateSandboxModuleSource } from "./generate";

const EXPECTED: Record<SandboxBackendKind, { factory: string; path: string }> = {
  microsandbox: { factory: "microsandbox", path: "eve/sandbox/microsandbox" },
  docker: { factory: "docker", path: "eve/sandbox/docker" },
  justbash: { factory: "justbash", path: "eve/sandbox/just-bash" },
};

describe("generateSandboxModuleSource", () => {
  for (const kind of Object.keys(EXPECTED) as SandboxBackendKind[]) {
    const { factory, path } = EXPECTED[kind];

    it(`emits the right imports for ${kind}`, () => {
      const src = generateSandboxModuleSource({ backendKind: kind });
      expect(src).toContain(`import { defineSandbox } from "eve/sandbox";`);
      expect(src).toContain(`import { ${factory} } from "${path}";`);
      expect(src).toContain(`export default defineSandbox({`);
      expect(src).toContain(`backend: () => ${factory}(`);
      // Never leak a runtime dependency on this package into generated agents.
      expect(src).not.toContain(`from "@xagents/sandbox"`);
    });
  }

  it("embeds the fine-grained private-subnet deny for microsandbox", () => {
    const src = generateSandboxModuleSource({ backendKind: "microsandbox" });
    expect(src).toContain("networkPolicy");
    expect(src).toContain("169.254.0.0/16");
    expect(src).toContain('"deny"');
  });

  it("collapses to a coarse policy for docker", () => {
    const src = generateSandboxModuleSource({ backendKind: "docker" });
    expect(src).toContain('networkPolicy: "allow-all"');
    expect(src).not.toContain("169.254.0.0/16");
  });

  it("omits any network policy for justbash", () => {
    const src = generateSandboxModuleSource({ backendKind: "justbash" });
    expect(src).toContain("justbash()");
    expect(src).not.toContain("networkPolicy");
  });
});

describe("defineAgentSandbox", () => {
  it("wires a lazy backend factory (does not boot at construction)", () => {
    const def = defineAgentSandbox({ backendKind: "microsandbox" });
    // Factory form keeps the VM runtime untouched until first framework access.
    expect(typeof def.backend).toBe("function");
  });

  // Heavy: actually constructs (not boots) a backend. Guarded so CI stays fast.
  it.runIf(process.env.SANDBOX_SMOKE)("constructs a named backend when invoked", () => {
    const def = defineAgentSandbox({ backendKind: "microsandbox" });
    // `backend` is optional on eve's public SandboxDefinition; we always set it.
    const backend = typeof def.backend === "function" ? def.backend() : def.backend;
    expect(backend?.name).toBeTypeOf("string");
  });
});
