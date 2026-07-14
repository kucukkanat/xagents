import {
  appError,
  err,
  newId,
  ok,
  type AppError,
  type CreateSkillInput,
  type Result,
  type Skill,
  type SkillId,
  type SkillResource,
  type UserId,
} from "@xagents/core";
import { nowIso, slugify } from "../helpers";
import {
  SKILL_SELECT,
  mapSkillResourceRow,
  mapSkillRow,
  type SkillResourceRow,
  type SkillRow,
} from "../mappers";
import type { Sqlite } from "../sqlite";

export interface NewResource {
  readonly path: string;
  readonly content: string;
}

export interface SkillsRepo {
  readonly create: (ownerId: UserId, input: CreateSkillInput) => Skill;
  readonly get: (id: SkillId) => Result<Skill, AppError>;
  readonly list: (ownerId: UserId) => Skill[];
  readonly update: (id: SkillId, patch: Partial<CreateSkillInput>) => Result<Skill, AppError>;
  readonly remove: (id: SkillId) => void;
  readonly clone: (sourceId: SkillId, newOwnerId: UserId) => Result<Skill, AppError>;
  readonly setResources: (skillId: SkillId, resources: readonly NewResource[]) => void;
  readonly listResources: (skillId: SkillId) => SkillResource[];
}

interface RawResourceRow {
  readonly path: string;
  readonly content: string;
}

export const createSkillsRepo = (db: Sqlite): SkillsRepo => {
  const getRow = db.prepare<[string], SkillRow>(`${SKILL_SELECT} WHERE s.id = ?`);
  const listRows = db.prepare<[string], SkillRow>(
    `${SKILL_SELECT} WHERE s.owner_id = ? ORDER BY s.updated_at DESC`,
  );
  const insertSkill = db.prepare(
    `INSERT INTO skills
       (id, owner_id, name, slug, description, skill_md, visibility, forked_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateSkill = db.prepare(
    `UPDATE skills SET name = ?, slug = ?, description = ?, skill_md = ?, visibility = ?, updated_at = ?
     WHERE id = ?`,
  );
  const deleteSkill = db.prepare("DELETE FROM skills WHERE id = ?");

  const resourcesBySkill = db.prepare<[string], SkillResourceRow>(
    "SELECT * FROM skill_resources WHERE skill_id = ? ORDER BY path ASC",
  );
  const rawResourcesBySkill = db.prepare<[string], RawResourceRow>(
    "SELECT path, content FROM skill_resources WHERE skill_id = ? ORDER BY path ASC",
  );
  const insertResource = db.prepare(
    "INSERT INTO skill_resources (id, skill_id, path, content) VALUES (?, ?, ?, ?)",
  );
  const clearResources = db.prepare("DELETE FROM skill_resources WHERE skill_id = ?");

  const create = (ownerId: UserId, input: CreateSkillInput): Skill => {
    const id = newId("SkillId");
    const now = nowIso();
    insertSkill.run(id, ownerId, input.name, slugify(input.name), input.description, input.skillMd, input.visibility, null, now, now);
    return {
      id,
      ownerId,
      name: input.name,
      slug: slugify(input.name),
      description: input.description,
      skillMd: input.skillMd,
      visibility: input.visibility,
      forkedFrom: null,
      resourceCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  };

  const get = (id: SkillId): Result<Skill, AppError> => {
    const row = getRow.get(id);
    return row === undefined
      ? err(appError("not_found", `skill ${id} not found`))
      : ok(mapSkillRow(row));
  };

  const list = (ownerId: UserId): Skill[] => listRows.all(ownerId).map(mapSkillRow);

  const update = (id: SkillId, patch: Partial<CreateSkillInput>): Result<Skill, AppError> => {
    const row = getRow.get(id);
    if (row === undefined) return err(appError("not_found", `skill ${id} not found`));
    const existing = mapSkillRow(row);

    const name = patch.name ?? existing.name;
    const slug = patch.name === undefined ? existing.slug : slugify(patch.name);
    const description = patch.description ?? existing.description;
    const skillMd = patch.skillMd ?? existing.skillMd;
    const visibility = patch.visibility ?? existing.visibility;
    const updatedAt = nowIso();
    updateSkill.run(name, slug, description, skillMd, visibility, updatedAt, id);
    return ok({ ...existing, name, slug, description, skillMd, visibility, updatedAt });
  };

  const remove = (id: SkillId): void => {
    deleteSkill.run(id); // cascades skill_resources
  };

  const setResources = (skillId: SkillId, resources: readonly NewResource[]): void => {
    db.transaction(() => {
      clearResources.run(skillId);
      for (const res of resources) insertResource.run(newId("SkillResourceId"), skillId, res.path, res.content);
    })();
  };

  const listResources = (skillId: SkillId): SkillResource[] =>
    resourcesBySkill.all(skillId).map(mapSkillResourceRow);

  const clone = (sourceId: SkillId, newOwnerId: UserId): Result<Skill, AppError> => {
    const row = getRow.get(sourceId);
    if (row === undefined) return err(appError("not_found", `skill ${sourceId} not found`));
    const src = mapSkillRow(row);

    return ok(
      db.transaction((): Skill => {
        const id = newId("SkillId");
        const now = nowIso();
        insertSkill.run(id, newOwnerId, src.name, src.slug, src.description, src.skillMd, src.visibility, sourceId, now, now);
        for (const res of rawResourcesBySkill.all(sourceId)) {
          insertResource.run(newId("SkillResourceId"), id, res.path, res.content);
        }
        return { ...src, id, ownerId: newOwnerId, forkedFrom: sourceId, createdAt: now, updatedAt: now };
      })(),
    );
  };

  return { create, get, list, update, remove, clone, setResources, listResources };
};
