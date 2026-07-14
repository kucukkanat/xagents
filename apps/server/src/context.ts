import { join } from "node:path";
import { type AppError, type Result, type User, asId, err, ok } from "@xagents/core";
import { type Db, openDb } from "@xagents/db";
import {
  type AgentHost,
  type AgentMaterializationSpec,
  type MaterializedSkill,
  HostSupervisor,
  materializeAgent,
} from "@xagents/eve-runtime";
import type { ServerConfig } from "./env";

export interface AppContext {
  readonly config: ServerConfig;
  readonly db: Db;
  readonly supervisor: HostSupervisor;
  readonly user: User;
}

export const createContext = (config: ServerConfig): AppContext => {
  const db = openDb(config.databasePath);
  const supervisor = new HostSupervisor({
    projectDirFor: (agentId) => join(config.agentsWorkspaceDir, agentId),
    // Pass the provider key through to each eve child process.
    env: { DEEPSEEK_API_KEY: config.deepseekApiKey },
    idleMs: 10 * 60_000,
  });
  return { config, db, supervisor, user: db.users.getCurrent() };
};

/** Rebuild the on-disk eve project for an agent from the current DB state. */
export const materializeFromDb = async (
  ctx: AppContext,
  agentId: string,
): Promise<Result<void, AppError>> => {
  const detail = ctx.db.agents.getDetail(asId("AgentId", agentId));
  if (!detail.ok) return detail;

  const skills: MaterializedSkill[] = detail.value.skills.map((skill) => ({
    skill,
    resources: ctx.db.skills.listResources(asId("SkillId", skill.id)),
  }));

  const spec: AgentMaterializationSpec = {
    agent: detail.value.agent,
    skills,
    hasKnowledgebases: detail.value.knowledgebases.length > 0,
    internalUrl: ctx.config.internalUrl,
    backendKind: ctx.config.sandboxBackend,
  };

  const written = await materializeAgent(spec, join(ctx.config.agentsWorkspaceDir, agentId));
  return written.ok ? ok(undefined) : err(written.error);
};

/** Ensure the agent is materialized and its eve host is running; returns the host. */
export const ensureAgentReady = async (
  ctx: AppContext,
  agentId: string,
): Promise<Result<AgentHost, AppError>> => {
  if (!ctx.supervisor.has(agentId)) {
    const materialized = await materializeFromDb(ctx, agentId);
    if (!materialized.ok) return materialized;
  }
  return ctx.supervisor.getOrStart(agentId);
};

/** Drop a running host so the next chat re-materializes (after edits/deletes). */
export const invalidateAgent = (ctx: AppContext, agentId: string): void => {
  ctx.supervisor.stop(agentId);
};
