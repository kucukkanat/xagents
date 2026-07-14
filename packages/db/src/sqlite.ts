import type Database from "better-sqlite3";

/**
 * The concrete better-sqlite3 connection type. Aliased once so repositories can
 * depend on the instance type without each re-deriving it from the `export =`
 * default (which is the *constructor*, not the instance).
 */
export type Sqlite = Database.Database;
