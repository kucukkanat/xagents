import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppError, type Result, appError, err, ok } from "@xagents/core";
import { generateSandboxModuleSource } from "@xagents/sandbox";
import { materializeSkill } from "@xagents/skills";
import {
  generateAgentModuleSource,
  generateKbSearchToolSource,
  generateProjectPackageJson,
  isSupportedAdapterKind,
} from "./codegen";
import type { AgentMaterializationSpec } from "./types";

/**
 * Writes a self-contained eve project for one agent under `projectDir`. eve
 * auto-discovers everything by path: `agent/instructions.md`, `agent/agent.ts`,
 * `agent/sandbox.ts`, `agent/skills/<slug>/SKILL.md`, `agent/tools/*.ts`.
 * The directory is recreated from scratch so edits to the agent fully re-render.
 */
export const materializeAgent = async (
  spec: AgentMaterializationSpec,
  projectDir: string,
): Promise<Result<{ readonly projectDir: string }, AppError>> => {
  const { agent } = spec;
  if (!isSupportedAdapterKind(spec.provider.adapterKind)) {
    return err(appError("validation", `unsupported provider adapter: ${spec.provider.adapterKind}`));
  }

  try {
    await rm(projectDir, { recursive: true, force: true });
    const agentDir = join(projectDir, "agent");
    await mkdir(agentDir, { recursive: true });

    await writeFile(join(projectDir, "package.json"), generateProjectPackageJson(agent.slug));
    await writeFile(join(agentDir, "instructions.md"), ensureTrailingNewline(agent.instructionsMd));
    await writeFile(
      join(agentDir, "agent.ts"),
      generateAgentModuleSource({
        provider: spec.provider,
        modelId: agent.modelId,
        reasoning: agent.reasoning,
        internalUrl: spec.internalUrl,
        agentId: agent.id,
      }),
    );
    await writeFile(
      join(agentDir, "sandbox.ts"),
      generateSandboxModuleSource({ backendKind: spec.backendKind }),
    );

    if (spec.skills.length > 0) {
      const skillsRoot = join(agentDir, "skills");
      await mkdir(skillsRoot, { recursive: true });
      for (const { skill, resources } of spec.skills) {
        const written = await materializeSkill({ skill, resources, destRoot: skillsRoot });
        if (!written.ok) return written;
      }
    }

    if (spec.hasKnowledgebases) {
      const toolsDir = join(agentDir, "tools");
      await mkdir(toolsDir, { recursive: true });
      await writeFile(
        join(toolsDir, "kb_search.ts"),
        generateKbSearchToolSource({ internalUrl: spec.internalUrl, agentId: agent.id }),
      );
    }

    return ok({ projectDir });
  } catch (cause) {
    return err(appError("agent_runtime_error", "failed to materialize agent project", cause));
  }
};

const ensureTrailingNewline = (s: string): string => (s.endsWith("\n") ? s : `${s}\n`);
