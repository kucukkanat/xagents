import { describe, expect, it } from "vitest";
import {
  DEFAULT_SANDBOX_BACKEND_KIND,
  SANDBOX_BACKEND_ENV_VAR,
  resolveBackendKind,
} from "./backend-kind";

describe("resolveBackendKind", () => {
  it("defaults to microsandbox when the env var is unset", () => {
    expect(resolveBackendKind({})).toBe("microsandbox");
    expect(DEFAULT_SANDBOX_BACKEND_KIND).toBe("microsandbox");
  });

  it("defaults when the env var is empty or whitespace", () => {
    expect(resolveBackendKind({ [SANDBOX_BACKEND_ENV_VAR]: "" })).toBe("microsandbox");
    expect(resolveBackendKind({ [SANDBOX_BACKEND_ENV_VAR]: "   " })).toBe("microsandbox");
  });

  it("accepts each valid kind", () => {
    expect(resolveBackendKind({ [SANDBOX_BACKEND_ENV_VAR]: "microsandbox" })).toBe("microsandbox");
    expect(resolveBackendKind({ [SANDBOX_BACKEND_ENV_VAR]: "docker" })).toBe("docker");
    expect(resolveBackendKind({ [SANDBOX_BACKEND_ENV_VAR]: "justbash" })).toBe("justbash");
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(resolveBackendKind({ [SANDBOX_BACKEND_ENV_VAR]: "  DOCKER  " })).toBe("docker");
    expect(resolveBackendKind({ [SANDBOX_BACKEND_ENV_VAR]: "Justbash" })).toBe("justbash");
  });

  it("falls back to the default on unrecognized values", () => {
    expect(resolveBackendKind({ [SANDBOX_BACKEND_ENV_VAR]: "vercel" })).toBe("microsandbox");
    expect(resolveBackendKind({ [SANDBOX_BACKEND_ENV_VAR]: "nonsense" })).toBe("microsandbox");
  });
});
