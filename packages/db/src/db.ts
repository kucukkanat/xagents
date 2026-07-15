import Database from "better-sqlite3";
import { ensureParentDir } from "./helpers";
import { migrate } from "./schema";
import type { Sqlite } from "./sqlite";
import { createAdminRepo, type AdminRepo } from "./repos/admin";
import { createAgentsRepo, type AgentsRepo } from "./repos/agents";
import { createChatsRepo, type ChatsRepo } from "./repos/chats";
import { createKnowledgebasesRepo, type KnowledgebasesRepo } from "./repos/knowledgebases";
import { createProvidersRepo, type ProvidersRepo } from "./repos/providers";
import { createSkillsRepo, type SkillsRepo } from "./repos/skills";
import { createUsersRepo, seedUser, type UsersRepo } from "./repos/users";

/** The data layer: one repository per aggregate plus lifecycle control. */
export interface Db {
  readonly users: UsersRepo;
  readonly agents: AgentsRepo;
  readonly knowledgebases: KnowledgebasesRepo;
  readonly skills: SkillsRepo;
  readonly chats: ChatsRepo;
  /** Cross-cutting reads/writes for the super-admin console + metrics. */
  readonly admin: AdminRepo;
  /** Admin-managed LLM providers, their models, and sealed secrets. */
  readonly providers: ProvidersRepo;
  /** Underlying connection, for advanced/one-off needs and tests. */
  readonly raw: Sqlite;
  readonly close: () => void;
}

/**
 * Open (creating the parent dir for file paths), migrate, seed the local user,
 * and wire up repositories. Use `":memory:"` for tests. Synchronous throughout
 * because better-sqlite3 is synchronous.
 */
export const openDb = (path: string): Db => {
  if (path !== ":memory:") ensureParentDir(path);
  const db = new Database(path);
  migrate(db);
  seedUser(db);

  return {
    users: createUsersRepo(db),
    agents: createAgentsRepo(db),
    knowledgebases: createKnowledgebasesRepo(db),
    skills: createSkillsRepo(db),
    chats: createChatsRepo(db),
    admin: createAdminRepo(db),
    providers: createProvidersRepo(db),
    raw: db,
    close: () => db.close(),
  };
};

export { migrate };
