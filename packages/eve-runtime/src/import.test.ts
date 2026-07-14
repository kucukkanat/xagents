import { describe, expect, test } from "bun:test";
import { EXPORT_SCHEMA_ID } from "@xagents/core";
import { parseAgentArchive } from "./import";

const files = (obj: Record<string, string>): Map<string, Buffer> => {
  const map = new Map<string, Buffer>();
  for (const [k, v] of Object.entries(obj)) map.set(k, Buffer.from(v, "utf8"));
  return map;
};

const SKILL_MD = "---\nname: Demo Skill\ndescription: A demo skill.\n---\n# Demo\nBody.\n";

const manifest = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schema: EXPORT_SCHEMA_ID,
    agent: {
      name: "My Agent",
      description: "desc",
      instructionsPath: "agent/instructions.md",
      modelProvider: "deepseek",
      modelId: "deepseek-chat",
      reasoning: "provider-default",
      visibility: "private",
      ...(overrides.agent as object),
    },
    skills: overrides.skills ?? [{ slug: "demo-skill", name: "Demo Skill", path: "agent/skills/demo-skill" }],
    knowledgebases:
      overrides.knowledgebases ??
      [{ slug: "acme", name: "Acme", description: "", documents: [{ filename: "r.md", mime: "text/markdown", path: "knowledgebases/acme/r.md.txt" }] }],
  });

const hasError = (log: readonly { severity: string }[]): boolean => log.some((e) => e.severity === "error");

describe("parseAgentArchive — xagents export", () => {
  const base = {
    "xagents.agent.json": manifest(),
    "agent/instructions.md": "You are helpful.",
    "agent/skills/demo-skill/SKILL.md": SKILL_MD,
    "agent/skills/demo-skill/scripts/run.sh": "echo hi",
    "knowledgebases/acme/r.md.txt": "Doc body text.",
  };

  test("builds a full plan from a valid manifest", () => {
    const { source, plan, log } = parseAgentArchive(files(base));
    expect(source).toBe("xagents-export");
    expect(hasError(log)).toBe(false);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.agent.name).toBe("My Agent");
    expect(plan.agent.modelProvider).toBe("deepseek");
    expect(plan.agent.instructionsMd).toBe("You are helpful.");
    expect(plan.skills).toHaveLength(1);
    expect(plan.skills[0]?.resources).toEqual([{ path: "scripts/run.sh", content: "echo hi" }]);
    expect(plan.knowledgebases).toHaveLength(1);
    expect(plan.knowledgebases[0]?.documents[0]?.text).toBe("Doc body text.");
  });

  test("forces imported agents to private and logs when source was public", () => {
    const { plan, log } = parseAgentArchive(
      files({ ...base, "xagents.agent.json": manifest({ agent: { visibility: "public" } }) }),
    );
    expect(plan?.agent.visibility).toBe("private");
    expect(log.some((e) => e.severity === "info" && /imported as private/i.test(e.message))).toBe(true);
  });

  test("substitutes an unknown model id with a warning (provider supported)", () => {
    const { plan, log } = parseAgentArchive(
      files({ ...base, "xagents.agent.json": manifest({ agent: { modelId: "deepseek-ultra-9000" } }) }),
    );
    expect(hasError(log)).toBe(false);
    expect(plan?.agent.modelId).toBe("deepseek-chat");
    expect(log.some((e) => e.severity === "warning" && /substituting/i.test(e.message))).toBe(true);
  });

  test("rejects an unsupported provider", () => {
    const { plan, log } = parseAgentArchive(
      files({ ...base, "xagents.agent.json": manifest({ agent: { modelProvider: "openai" } }) }),
    );
    expect(plan).toBeNull();
    expect(log.some((e) => e.severity === "error" && /not supported/i.test(e.message))).toBe(true);
  });

  test("errors on invalid manifest JSON", () => {
    const { plan, log } = parseAgentArchive(files({ ...base, "xagents.agent.json": "{ not json" }));
    expect(plan).toBeNull();
    expect(log.some((e) => e.severity === "error" && /not valid JSON/i.test(e.message))).toBe(true);
  });

  test("errors when instructions are missing", () => {
    const withoutInstructions = { ...base };
    delete (withoutInstructions as Record<string, string>)["agent/instructions.md"];
    const { plan, log } = parseAgentArchive(files(withoutInstructions));
    expect(plan).toBeNull();
    expect(hasError(log)).toBe(true);
  });

  test("skips a missing KB document with a warning, still succeeds", () => {
    const withoutDoc = { ...base };
    delete (withoutDoc as Record<string, string>)["knowledgebases/acme/r.md.txt"];
    const { plan, log } = parseAgentArchive(files(withoutDoc));
    expect(hasError(log)).toBe(false);
    expect(plan?.knowledgebases[0]?.documents).toHaveLength(0);
    expect(log.some((e) => e.severity === "warning" && /missing/i.test(e.message))).toBe(true);
  });
});

describe("parseAgentArchive — plain eve project", () => {
  const agentTs = `import { deepseek } from "@ai-sdk/deepseek";\nexport default defineAgent({\n  model: deepseek("deepseek-reasoner"),\n  reasoning: "high",\n});\n`;

  test("parses model/reasoning/name and discovers skills", () => {
    const { source, plan, log } = parseAgentArchive(
      files({
        "agent/agent.ts": agentTs,
        "agent/instructions.md": "Do the thing.",
        "package.json": JSON.stringify({ name: "xagents-agent-cool-bot" }),
        "agent/skills/helper/SKILL.md": SKILL_MD,
        "agent/tools/kb_search.ts": "// tool",
      }),
    );
    expect(source).toBe("eve-project");
    expect(hasError(log)).toBe(false);
    expect(plan?.agent.name).toBe("cool-bot");
    expect(plan?.agent.modelId).toBe("deepseek-reasoner");
    expect(plan?.agent.reasoning).toBe("high");
    expect(plan?.skills).toHaveLength(1);
    // Custom tools are flagged, not imported.
    expect(log.some((e) => e.severity === "warning" && /tools/i.test(e.step))).toBe(true);
  });

  test("rejects an unsupported provider in agent.ts", () => {
    const { plan, log } = parseAgentArchive(
      files({
        "agent/agent.ts": `export default defineAgent({ model: openai("gpt-4o") });`,
        "agent/instructions.md": "hi",
      }),
    );
    expect(plan).toBeNull();
    expect(log.some((e) => e.severity === "error" && /not supported/i.test(e.message))).toBe(true);
  });

  test("errors when the model call can't be found", () => {
    const { plan, log } = parseAgentArchive(
      files({ "agent/agent.ts": "export default defineAgent({});", "agent/instructions.md": "hi" }),
    );
    expect(plan).toBeNull();
    expect(log.some((e) => e.severity === "error")).toBe(true);
  });

  test("errors on missing instructions", () => {
    const { plan, log } = parseAgentArchive(files({ "agent/agent.ts": agentTs }));
    expect(plan).toBeNull();
    expect(hasError(log)).toBe(true);
  });
});

describe("parseAgentArchive — unrecognized", () => {
  test("errors when neither a manifest nor an agent/ dir is present", () => {
    const { source, plan, log } = parseAgentArchive(files({ "readme.txt": "nope" }));
    expect(source).toBe("unknown");
    expect(plan).toBeNull();
    expect(log.some((e) => e.severity === "error")).toBe(true);
  });
});
