import { newId, type User } from "@xagents/core";
import { nowIso } from "../helpers";
import { mapUserRow, type UserRow } from "../mappers";
import type { Sqlite } from "../sqlite";

export interface UsersRepo {
  /** The single seeded local user (auth is stubbed to one identity). */
  readonly getCurrent: () => User;
}

/**
 * Seed the lone local user if the table is empty. Called once at open time so
 * `getCurrent` always has a row to return.
 */
export const seedUser = (db: Sqlite): void => {
  const count = db.prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM users").get();
  if (count !== undefined && count.c > 0) return;
  db.prepare("INSERT INTO users (id, handle, display_name, created_at) VALUES (?, ?, ?, ?)").run(
    newId("UserId"),
    "local",
    "Local User",
    nowIso(),
  );
};

export const createUsersRepo = (db: Sqlite): UsersRepo => {
  const getStmt = db.prepare<[], UserRow>("SELECT * FROM users ORDER BY created_at ASC LIMIT 1");
  return {
    getCurrent: (): User => {
      const row = getStmt.get();
      if (row === undefined) throw new Error("no seeded user; openDb must seed one");
      return mapUserRow(row);
    },
  };
};
