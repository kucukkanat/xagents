import {
  appError,
  asId,
  err,
  newId,
  ok,
  type Agent,
  type AgentDetail,
  type AgentId,
  type AppError,
  type CreateAgentInput,
  type Knowledgebase,
  type Result,
  type Skill,
  type UpdateAgentInput,
  type UserId,
} from "@xagents/core";
import { nowIso, slugify } from "../helpers";
import {
  AGENT_SELECT,
  KB_SELECT,
  SKILL_SELECT,
  mapAgentRow,
  mapKnowledgebaseRow,
  mapSkillRow,
  type AgentRow,
  type KnowledgebaseRow,
  type SkillRow,
} from "../mappers";
import type { Sqlite } from "../sqlite";

export interface AgentLinks {
  readonly knowledgebaseIds: readonly string[];
  readonly skillIds: readonly string[];
}

export interface AgentsRepo {
  readonly create: (ownerId: UserId, input: CreateAgentInput) => Agent;
  readonly get: (id: AgentId) => Result<Agent, AppError>;
  readonly getDetail: (id: AgentId) => Result<AgentDetail, AppError>;
  readonly list: (ownerId: UserId) => Agent[];
  readonly update: (id: AgentId, patch: UpdateAgentInput) => Result<Agent, AppError>;
  readonly remove: (id: AgentId) => void;
  readonly setLinks: (agentId: AgentId, links: AgentLinks) => void;
  readonly clone: (sourceId: AgentId, newOwnerId: UserId) => Result<Agent, AppError>;
}

interface LinkRow {
  readonly id: string;
}

export const createAgentsRepo = (db: Sqlite): AgentsRepo => {
  const getRow = db.prepare<[string], AgentRow>(`${AGENT_SELECT} WHERE id = ?`);
  const listRows = db.prepare<[string], AgentRow>(
    `${AGENT_SELECT} WHERE owner_id = ? ORDER BY updated_at DESC`,
  );
  const kbLinks = db.prepare<[string], LinkRow>(
    "SELECT knowledgebase_id AS id FROM agent_knowledgebases WHERE agent_id = ? ORDER BY rowid",
  );
  const skillLinks = db.prepare<[string], LinkRow>(
    "SELECT skill_id AS id FROM agent_skills WHERE agent_id = ? ORDER BY rowid",
  );
  const kbById = db.prepare<[string], KnowledgebaseRow>(`${KB_SELECT} WHERE k.id = ?`);
  const skillById = db.prepare<[string], SkillRow>(`${SKILL_SELECT} WHERE s.id = ?`);

  const insertAgent = db.prepare(
    `INSERT INTO agents
       (id, owner_id, name, slug, description, instructions_md, model_provider,
        model_id, reasoning, visibility, forked_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateAgent = db.prepare(
    `UPDATE agents SET name = ?, slug = ?, description = ?, instructions_md = ?,
       model_provider = ?, model_id = ?, reasoning = ?, visibility = ?, updated_at = ?
     WHERE id = ?`,
  );
  const deleteAgent = db.prepare("DELETE FROM agents WHERE id = ?");
  const insertKbLink = db.prepare(
    "INSERT OR IGNORE INTO agent_knowledgebases (agent_id, knowledgebase_id) VALUES (?, ?)",
  );
  const insertSkillLink = db.prepare(
    "INSERT OR IGNORE INTO agent_skills (agent_id, skill_id) VALUES (?, ?)",
  );
  const clearKbLinks = db.prepare("DELETE FROM agent_knowledgebases WHERE agent_id = ?");
  const clearSkillLinks = db.prepare("DELETE FROM agent_skills WHERE agent_id = ?");

  const writeLinks = (agentId: string, links: AgentLinks): void => {
    clearKbLinks.run(agentId);
    clearSkillLinks.run(agentId);
    for (const kbId of links.knowledgebaseIds) insertKbLink.run(agentId, kbId);
    for (const skillId of links.skillIds) insertSkillLink.run(agentId, skillId);
  };

  const loadAgent = (id: AgentId): Agent | undefined => {
    const row = getRow.get(id);
    if (row === undefined) return undefined;
    return mapAgentRow(
      row,
      kbLinks.all(id).map((r) => r.id),
      skillLinks.all(id).map((r) => r.id),
    );
  };

  const create = (ownerId: UserId, input: CreateAgentInput): Agent =>
    db.transaction((): Agent => {
      const id = newId("AgentId");
      const now = nowIso();
      insertAgent.run(
        id,
        ownerId,
        input.name,
        slugify(input.name),
        input.description,
        input.instructionsMd,
        input.modelProvider,
        input.modelId,
        input.reasoning,
        input.visibility,
        null,
        now,
        now,
      );
      writeLinks(id, { knowledgebaseIds: input.knowledgebaseIds, skillIds: input.skillIds });
      // Freshly written; links come straight from the input we just persisted.
      return mapAgentRow(
        {
          id,
          owner_id: ownerId,
          name: input.name,
          slug: slugify(input.name),
          description: input.description,
          instructions_md: input.instructionsMd,
          model_provider: input.modelProvider,
          model_id: input.modelId,
          reasoning: input.reasoning,
          visibility: input.visibility,
          forked_from: null,
          created_at: now,
          updated_at: now,
        },
        input.knowledgebaseIds,
        input.skillIds,
      );
    })();

  const get = (id: AgentId): Result<Agent, AppError> => {
    const agent = loadAgent(id);
    return agent === undefined ? err(appError("not_found", `agent ${id} not found`)) : ok(agent);
  };

  const getDetail = (id: AgentId): Result<AgentDetail, AppError> => {
    const agent = loadAgent(id);
    if (agent === undefined) return err(appError("not_found", `agent ${id} not found`));
    const knowledgebases: Knowledgebase[] = [];
    for (const kbId of agent.knowledgebaseIds) {
      const row = kbById.get(kbId);
      if (row !== undefined) knowledgebases.push(mapKnowledgebaseRow(row));
    }
    const skills: Skill[] = [];
    for (const skillId of agent.skillIds) {
      const row = skillById.get(skillId);
      if (row !== undefined) skills.push(mapSkillRow(row));
    }
    return ok({ agent, knowledgebases, skills });
  };

  const list = (ownerId: UserId): Agent[] =>
    listRows.all(ownerId).map((row) =>
      mapAgentRow(
        row,
        kbLinks.all(row.id).map((r) => r.id),
        skillLinks.all(row.id).map((r) => r.id),
      ),
    );

  const update = (id: AgentId, patch: UpdateAgentInput): Result<Agent, AppError> => {
    const existing = loadAgent(id);
    if (existing === undefined) return err(appError("not_found", `agent ${id} not found`));

    return ok(
      db.transaction((): Agent => {
        const name = patch.name ?? existing.name;
        const slug = patch.name === undefined ? existing.slug : slugify(patch.name);
        const description = patch.description ?? existing.description;
        const instructionsMd = patch.instructionsMd ?? existing.instructionsMd;
        const modelProvider = patch.modelProvider ?? existing.modelProvider;
        const modelId = patch.modelId ?? existing.modelId;
        const reasoning = patch.reasoning ?? existing.reasoning;
        const visibility = patch.visibility ?? existing.visibility;
        const updatedAt = nowIso();
        updateAgent.run(
          name,
          slug,
          description,
          instructionsMd,
          modelProvider,
          modelId,
          reasoning,
          visibility,
          updatedAt,
          id,
        );

        // UpdateAgentInput can also carry link changes; apply them when present.
        const knowledgebaseIds = patch.knowledgebaseIds ?? existing.knowledgebaseIds;
        const skillIds = patch.skillIds ?? existing.skillIds;
        if (patch.knowledgebaseIds !== undefined || patch.skillIds !== undefined) {
          writeLinks(id, { knowledgebaseIds, skillIds });
        }

        return {
          ...existing,
          name,
          slug,
          description,
          instructionsMd,
          modelProvider,
          modelId,
          reasoning,
          visibility,
          knowledgebaseIds: knowledgebaseIds.map((k) => asId("KnowledgebaseId", k)),
          skillIds: skillIds.map((s) => asId("SkillId", s)),
          updatedAt,
        };
      })(),
    );
  };

  const remove = (id: AgentId): void => {
    deleteAgent.run(id);
  };

  const setLinks = (agentId: AgentId, links: AgentLinks): void => {
    db.transaction(() => writeLinks(agentId, links))();
  };

  const clone = (sourceId: AgentId, newOwnerId: UserId): Result<Agent, AppError> => {
    const src = loadAgent(sourceId);
    if (src === undefined) return err(appError("not_found", `agent ${sourceId} not found`));

    return ok(
      db.transaction((): Agent => {
        const id = newId("AgentId");
        const now = nowIso();
        insertAgent.run(
          id,
          newOwnerId,
          src.name,
          src.slug,
          src.description,
          src.instructionsMd,
          src.modelProvider,
          src.modelId,
          src.reasoning,
          src.visibility,
          sourceId, // forked_from
          now,
          now,
        );
        writeLinks(id, { knowledgebaseIds: src.knowledgebaseIds, skillIds: src.skillIds });
        return {
          ...src,
          id,
          ownerId: newOwnerId,
          forkedFrom: sourceId,
          createdAt: now,
          updatedAt: now,
        };
      })(),
    );
  };

  return { create, get, getDetail, list, update, remove, setLinks, clone };
};
